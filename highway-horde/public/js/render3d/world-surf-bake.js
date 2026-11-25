// The baked texture library at run time (WORLD, SPEC §7.5): on 'high' and up, the world's surfaces
// trade the procedural detail layers (world-surf.js) for the sets of public/textures/ that
// scripts/bake-textures.js renders ahead of time. The geometry keeps its per-vertex (u, v, layer)
// attribute and its DET ids: only the textures behind them change.
//
// Layout on the GPU: two texture arrays with one layer per set the map needs (world-surf-sets.js
// planSlots — the sets its geometry and its ground use, after the map's theme):
//   D  RGBA8          R, G = tangent normal x, y; B = roughness; A = tint / metal (0.5 neutral,
//                     above = takes the object's own colour, below = bare metal)
//   C  SRGB8_ALPHA8   RGB = albedo with the occlusion folded in; A = height (parallax, puddles, grime)
// and a small float table (uDetTab: per surface id the parallax / grain / mip variance / class row,
// the element grid, the slots and the self-mapping shift, the set's mean colour and roughness) that
// both paths fill, so the shaders (world-mat.js, ground.js) look a surface up the same way. The
// procedural array stays bound as uDetailP for the weathering's noise fields (layer 23).
//
// Each set's four maps (their download copies, tex-files.js: JPEG / lossless WebP, else the PNGs) are
// fetched, decoded and packed into the set's two layers by a decode worker (packWorldSet below,
// tex-worker.js); the jobs are queued while the world is still being built, so the main thread only
// uploads the finished layers. Without a worker (or for a test's own source) they are decoded with
// createImageBitmap, uploaded to scratch textures and packed into the arrays' layers by a tiny
// shader pass. Then the arrays get their mips and anisotropy. Memory policy: one array layer per set
// the map uses, at the tier's size (high 512², ultra and cinematic up to the library's 1024²; each
// tier has a byte budget the size halves to fit). Anything failing — no WebGL 2, a missing file, a
// decode error, too slow — leaves the procedural layers in place, silently.

import * as THREE from 'three';
import { DET, DET_COUNT, DET_LAYERS, DET_BASE, DET_PARAMS, DET_CELLS, DET_SHIFT } from './world-surf-gen.js';
import { planSlots } from './world-surf-sets.js';
import { embeddedStore, textureBlob, textureURL, textureSource, textureSourceNow, textureIndex } from './tex-files.js';
import { keptTexWorker } from './tex-worker.js';

/** Per tier: the largest layer size used and the byte budget of both arrays (mips included). */
export const BAKED_TIERS = Object.freeze({
  low: null,
  high: { cap: 512, budget: 360e6 },
  ultra: { cap: 1024, budget: 800e6 },
  cinematic: { cap: 2048, budget: 1400e6 },
});

/** Bytes of the two arrays (D + C, RGBA8, a full mip chain) for `slots` layers of n². */
export function bakedBytes(n, slots) {
  return Math.round(slots * 2 * n * n * 4 * (4 / 3));
}

/**
 * The layer size for a tier: the library's stored size, capped by the tier, halved until both
 * arrays fit the tier's budget (never below 256). null on 'low'.
 */
export function bakedSize(tier, slots, stored = 1024) {
  const t = BAKED_TIERS[tier];
  if (!t) return null;
  let n = Math.min(t.cap, stored);
  while (n > 256 && bakedBytes(n, slots) > t.budget) n >>= 1;
  return n;
}

// ---- the per-surface table (both paths) ---------------------------------------------------------

const ROWS = 4;

/** Table rows for the procedural path. */
export function proceduralTable(out = new Float32Array(DET_COUNT * 4 * ROWS)) {
  for (let id = 0; id < DET_COUNT; id++) {
    const b = DET_BASE[id];
    out.set(DET_PARAMS.subarray(id * 4, id * 4 + 4), (0 * DET_COUNT + id) * 4);
    out.set(DET_CELLS.subarray(id * 4, id * 4 + 4), (1 * DET_COUNT + id) * 4);
    out.set([b, b + DET_LAYERS, DET_SHIFT[id * 2], DET_SHIFT[id * 2 + 1]], (2 * DET_COUNT + id) * 4);
    out.set([0.5, 0.5, 0.5, 0.5], (3 * DET_COUNT + id) * 4);
  }
  return out;
}

/**
 * Table rows for the baked path: every surface id drawn by its set (the set's own grid, shift and
 * parallax depth where the manifest gives them, else its home surface's), slot -1 where none.
 */
export function bakedTable(plan, manifest, out = new Float32Array(DET_COUNT * 4 * ROWS)) {
  for (let id = 0; id < DET_COUNT; id++) {
    const slot = plan.slotOf[id];
    const name = plan.setOf[id];
    const e = name && manifest.sets[name];
    const home = e && e.det != null && DET[e.det] != null ? DET[e.det] : id;
    const p = DET_PARAMS.subarray(home * 4, home * 4 + 4);
    out.set([e && e.parallax != null ? e.parallax / ((e.tile || 1) / 0.03) : p[0], p[1], p[2], p[3]], (0 * DET_COUNT + id) * 4);
    out.set(e && e.cells ? e.cells : DET_CELLS.subarray(home * 4, home * 4 + 4), (1 * DET_COUNT + id) * 4);
    const sh = e && e.shift ? e.shift : [DET_SHIFT[home * 2], DET_SHIFT[home * 2 + 1]];
    out.set([slot, slot, sh[0], sh[1]], (2 * DET_COUNT + id) * 4);
    const m = e && e.mean ? e.mean : [0.5, 0.5, 0.5];
    out.set([m[0], m[1], m[2], e ? e.rough : 0.5], (3 * DET_COUNT + id) * 4);
  }
  return out;
}

/**
 * The detail uniforms every world material and the ground share: the D / C arrays (both the
 * procedural array until a baked set is in), the procedural array for the noise fields, the table
 * and the path flag.
 * @param {THREE.DataArrayTexture|null} proc the procedural array (null on 'low')
 */
export function createDetailUniforms(proc) {
  const tab = new THREE.DataTexture(proceduralTable(), DET_COUNT, ROWS, THREE.RGBAFormat, THREE.FloatType);
  tab.magFilter = tab.minFilter = THREE.NearestFilter;
  tab.generateMipmaps = false;
  tab.needsUpdate = true;
  const u = {
    uDetail: { value: proc }, uDetailC: { value: proc }, uDetailP: { value: proc },
    uDetTab: { value: tab }, uDetBaked: { value: 0 },
  };
  let baked = null;
  return {
    uniforms: u,
    /** Is the baked library drawing the world? */
    get baked() { return !!baked; },
    get info() { return baked ? baked.info : null; },
    /** Swap in (or back to) a procedural array. */
    setProcedural(tex) {
      u.uDetailP.value = tex;
      if (!baked) { u.uDetail.value = tex; u.uDetailC.value = tex; }
      // (the table's first row carries the mip variance, filled in when the layers are generated)
      proceduralTable(tab.image.data); if (baked) bakedTable(baked.plan, baked.manifest, tab.image.data);
      tab.needsUpdate = true;
    },
    /** Use a loaded baked library (loadBaked result). */
    setBaked(b) {
      if (baked && baked !== b) baked.dispose();
      baked = b;
      u.uDetail.value = b.D; u.uDetailC.value = b.C; u.uDetBaked.value = 1;
      bakedTable(b.plan, b.manifest, tab.image.data);
      tab.needsUpdate = true;
    },
    /** Drop the baked library (back to the procedural layers). */
    clearBaked() {
      if (!baked) return;
      baked.dispose();
      baked = null;
      u.uDetail.value = u.uDetailP.value; u.uDetailC.value = u.uDetailP.value; u.uDetBaked.value = 0;
      proceduralTable(tab.image.data);
      tab.needsUpdate = true;
    },
    dispose() { if (baked) baked.dispose(); baked = null; tab.dispose(); },
  };
}

/**
 * The page's last baked-library load, for the dev tools and the screenshot script: state 'off' |
 * 'loading' | 'done' | 'failed', info (layers, size, bytes, ms), error.
 */
export const bakedState = { state: 'off', info: null, error: null, ms: 0 };
if (typeof globalThis !== 'undefined') globalThis.__hhTextures = bakedState;

/**
 * Is the baked library turned off? `?textures=procedural` in the page's address (or the
 * localStorage key 'hh-textures' = 'procedural') keeps the procedural layers, for comparison.
 */
export function bakedDisabled() {
  try {
    if (typeof location !== 'undefined' && /(?:^|[?&])textures=procedural(?:&|$)/.test(location.search)) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('hh-textures') === 'procedural') return true;
  } catch { /* no storage */ }
  return false;
}

// ---- the files --------------------------------------------------------------------------------

/**
 * Where the files come from: the one-file build's embedded store (window.__HH_TEX, scripts/
 * build-standalone.js), else the textures/ folder next to the game; either way through tex-files.js,
 * which picks each PNG's download copy (compressed.json) at the layer size. Tests may set their own
 * { manifest(), blob(path, size) }.
 */
let source = null;
export function setTextureSource(s) { source = s; manifestP = null; manifestNow = undefined; }
function defaultSource() {
  const emb = embeddedStore();
  return {
    async manifest() {
      if (emb) return emb.manifest();
      const r = await fetch(textureURL('manifest.json'));
      if (!r.ok) throw new Error(`textures: manifest ${r.status}`);
      return r.json();
    },
    async blob(path, size) {
      return (await textureBlob(path, size)).blob;
    },
  };
}
let manifestP = null, manifestNow;
/** The library's manifest (cached; null if there is none). */
export function libraryManifest() {
  if (!manifestP) {
    const s = source || defaultSource();
    const p = Promise.resolve().then(() => s.manifest()).then((m) => (m && m.sets ? m : null)).catch(() => null)
      .then((m) => { if (manifestP === p) manifestNow = m; return m; });
    manifestP = p;
    manifestNow = undefined;
  }
  return manifestP;
}

/**
 * Ask for the manifest and the copies' index ahead (renderer3d does when it loads, while the menus
 * are up), so a world's build can hand the library's files to the decode worker at once.
 */
export function prefetchLibrary() {
  if (typeof window === 'undefined' || bakedDisabled()) return;
  libraryManifest();
  textureIndex();
  keptTexWorker(packWorldSet, [], 3);
}

// ---- GL packing --------------------------------------------------------------------------------

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS_D = `#version 300 es
precision highp float;
uniform sampler2D uN, uR, uM;
uniform int uSize;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  c.y = uSize - 1 - c.y;   // (the PNGs run top row first; the layer's v runs up)
  vec3 n = texelFetch(uN, c, 0).xyz;
  vec3 r = texelFetch(uR, c, 0).xyz;
  vec2 mk = texelFetch(uM, c, 0).xy;
  float tm = mk.x > 0.02 ? 0.5 - 0.5 * mk.x : 0.5 + 0.5 * mk.y;
  o = vec4(n.xy, r.x, tm);
}`;
const FS_C = `#version 300 es
precision highp float;
uniform sampler2D uA, uR;
uniform int uSize;
uniform float uAoK;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  c.y = uSize - 1 - c.y;
  vec3 a = texelFetch(uA, c, 0).rgb;
  vec3 r = texelFetch(uR, c, 0).xyz;
  o = vec4(a * mix(1.0, r.y, uAoK), r.z);
}`;

function program(gl, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('textures: pack shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('textures: pack link: ' + gl.getProgramInfoLog(p));
  return p;
}

/** Decode one PNG blob to an ImageBitmap of n² (resized by the browser when it differs). */
async function decode(blob, n, stored) {
  const o = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  if (n !== stored) Object.assign(o, { resizeWidth: n, resizeHeight: n, resizeQuality: 'high' });
  return createImageBitmap(blob, o);
}

/**
 * The decode worker's job (tex-worker.js; self-contained, it runs as source there): a set's four
 * maps at n² → its two layers, exactly what the GL pass (FS_D, FS_C) writes: D = normal x, y,
 * roughness, tint / metal; C = albedo × the folded occlusion (in linear light, sRGB bytes) and the
 * height. Rows bottom-up (the layer's v runs up).
 */
async function packWorldSet(d) {
  const n = d.n, aoK = d.aoK;
  const maps = await Promise.all(['albedo', 'normal', 'rah', 'mask'].map((k) => decodeRGBA(d.files[k], n)));
  for (const m of maps) if (m.w !== n || m.h !== n) throw new Error(`decoded at ${m.w}x${m.h}, not ${n}`);
  const [a, nm, r, m] = maps.map((x) => x.px);
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LUT = 16383, toS = new Uint8Array(LUT + 1);
  for (let i = 0; i <= LUT; i++) { const l = i / LUT; toS[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }
  const D = new Uint8Array(n * n * 4), C = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const src = (n - 1 - y) * n * 4, dst = y * n * 4;
    for (let x = 0; x < n * 4; x += 4) {
      const i = src + x, o = dst + x;
      D[o] = nm[i]; D[o + 1] = nm[i + 1]; D[o + 2] = r[i];
      const mx = m[i] / 255;
      D[o + 3] = Math.round(255 * (mx > 0.02 ? 0.5 - 0.5 * mx : 0.5 + 0.5 * (m[i + 1] / 255)));
      const k = 1 + (r[i + 1] / 255 - 1) * aoK;
      for (let c = 0; c < 3; c++) C[o + c] = toS[Math.round(Math.min(1, toLin[a[i + c]] * k) * LUT)];
      C[o + 3] = r[i + 2];
    }
  }
  return { out: { D: D.buffer, C: C.buffer }, transfer: [D.buffer, C.buffer] };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Load a map's baked sets into GPU arrays.
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {string} o.mapId
 * @param {Iterable<number>} o.usedIds surface ids the world's geometry uses
 * @param {string} o.tier 'high' | 'ultra' | 'cinematic'
 * @param {number} [o.anisotropy]
 * @param {(done: number, total: number) => void} [o.onProgress]
 * @param {() => boolean} [o.cancelled] polled between sets: true aborts (the arrays are freed)
 * @returns {Promise<{ D, C, plan, manifest, info, dispose() }>}
 */
export async function loadBaked(o) {
  const t0 = now();
  const gl = o.renderer && o.renderer.getContext ? o.renderer.getContext() : null;
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('textures: WebGL 2 needed');
  if (typeof createImageBitmap !== 'function') throw new Error('textures: no createImageBitmap');
  // (no wait when the manifest is in: the jobs below go to the worker before this call returns,
  // so the files decode while the rest of the world and the renderer are still being built)
  const manifest = manifestNow !== undefined && !source ? manifestNow : await libraryManifest();
  if (!manifest) throw new Error('textures: no library');
  const plan = planSlots(o.mapId, o.usedIds);
  for (const s of plan.sets) if (!manifest.sets[s]) throw new Error(`textures: the library has no ${s}`);
  const src = source || defaultSource();
  const stored = Math.max(...plan.sets.map((s) => manifest.sets[s].size || 1024));
  const n = bakedSize(o.tier, plan.sets.length, stored);
  if (!n) throw new Error('textures: not on this tier');
  const levels = Math.floor(Math.log2(n)) + 1;
  const L = plan.sets.length;

  const made = [];
  const texD = gl.createTexture(), texC = gl.createTexture();
  made.push(texD, texC);
  const scratch = [gl.createTexture(), gl.createTexture(), gl.createTexture(), gl.createTexture()];
  const fbo = gl.createFramebuffer();
  let progD = null, progC = null, vao = null;
  const cleanupScratch = () => {
    for (const t of scratch) gl.deleteTexture(t);
    gl.deleteFramebuffer(fbo);
    if (progD) gl.deleteProgram(progD);
    if (progC) gl.deleteProgram(progC);
    if (vao) gl.deleteVertexArray(vao);
    o.renderer.resetState();
  };
  const freeAll = () => { for (const t of made) gl.deleteTexture(t); };
  let viaWorker = false;
  try {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texD);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, n, n, L);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texC);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.SRGB8_ALPHA8, n, n, L);
    o.renderer.resetState();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('textures: could not allocate the arrays');

    let done = 0;
    let gpuMs = 0;
    const packOne = (slot, bm) => {
      const t1 = now();
      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      const order = ['albedo', 'normal', 'rah', 'mask'];
      for (let k = 0; k < 4; k++) {
        gl.activeTexture(gl.TEXTURE0 + k);
        gl.bindTexture(gl.TEXTURE_2D, scratch[k]);
        gl.texImage2D(gl.TEXTURE_2D, 0, order[k] === 'albedo' ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm[order[k]]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, n, n);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texD, 0, slot);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.useProgram(progD);
      gl.uniform1i(gl.getUniformLocation(progD, 'uN'), 1);
      gl.uniform1i(gl.getUniformLocation(progD, 'uR'), 2);
      gl.uniform1i(gl.getUniformLocation(progD, 'uM'), 3);
      gl.uniform1i(gl.getUniformLocation(progD, 'uSize'), n);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texC, 0, slot);
      gl.useProgram(progC);
      gl.uniform1i(gl.getUniformLocation(progC, 'uA'), 0);
      gl.uniform1i(gl.getUniformLocation(progC, 'uR'), 2);
      gl.uniform1i(gl.getUniformLocation(progC, 'uSize'), n);
      gl.uniform1f(gl.getUniformLocation(progC, 'uAoK'), 0.65);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      o.renderer.resetState();
      gpuMs += now() - t1;
    };
    const kinds = ['albedo', 'normal', 'rah', 'mask'];
    const progress = () => { done++; if (o.onProgress) { try { o.onProgress(done, L); } catch { /* the UI's problem */ } } };
    const cancelled = () => !!(o.cancelled && o.cancelled());
    /** Upload a set's two packed layers (the worker's result). */
    const uploadOne = (slot, D, C) => {
      const t1 = now();
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texD);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, n, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(D));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texC);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, n, n, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(C));
      o.renderer.resetState();
      gpuMs += now() - t1;
    };
    // The worker path (the files' own source: not a test's): every set's files are fetched, decoded
    // and packed in the worker, all queued at once; the main thread only uploads each set's layers as
    // they come back (one turn of it per set, not one per fetch, decode and pack).
    const tw = source ? null : keptTexWorker(packWorldSet, [], 3);
    let stop = false;
    if (tw) {
      try {
        await Promise.all(plan.sets.map(async (name, slot) => {
          const e = manifest.sets[name];
          // (the sources at once where they can be had: this runs before the first await)
          let files = {};
          for (const k of kinds) { files[k] = textureSourceNow(e.files[k], n); if (!files[k]) { files = null; break; } }
          if (!files) {
            files = {};
            await Promise.all(kinds.map(async (k) => { files[k] = await textureSource(e.files[k], n); }));
          }
          if (cancelled()) throw new Error('textures: cancelled');
          const r = await tw.run({ n, aoK: 0.65, files });
          if (stop) return;
          if (cancelled()) throw new Error('textures: cancelled');
          uploadOne(slot, r.D, r.C);
          progress();
        }));
        viaWorker = true;
      } catch (err) {
        stop = true;
        if (cancelled()) throw err;
        // (the worker could not do it: the main thread's own path below, from the start)
        done = 0;
        if (typeof console !== 'undefined' && console.info) console.info('textures: the decode worker failed, decoding here —', String((err && err.message) || err));
      } finally {
        tw.close();
      }
    }
    // decode several sets at a time (the browser decodes off the main thread; every await is a turn
    // of the main thread, a whole frame on a slow machine), pack each as it lands
    const queue = viaWorker ? [] : plan.sets.map((name, slot) => ({ name, slot }));
    const width = 6;
    let failed = null;
    const worker = async () => {
      for (;;) {
        if (failed) return;
        const job = queue.shift();
        if (!job) return;
        if (o.cancelled && o.cancelled()) { failed = new Error('textures: cancelled'); return; }
        const e = manifest.sets[job.name];
        const bm = {};
        try {
          const blobs = await Promise.all(kinds.map((k) => src.blob(e.files[k], n)));
          const maps = await Promise.all(blobs.map((b) => decode(b, n, e.size || 1024)));
          kinds.forEach((k, i) => { bm[k] = maps[i]; });
          if (o.cancelled && o.cancelled()) throw new Error('textures: cancelled');
          for (const k of kinds) if (bm[k].width !== n || bm[k].height !== n) throw new Error(`textures: ${job.name}/${k} decoded at ${bm[k].width}²`);
          packOne(job.slot, bm);
        } catch (err) {
          failed = failed || err;
        } finally {
          for (const k of Object.keys(bm)) { try { bm[k].close(); } catch { /* closed */ } }
        }
        progress();
      }
    };
    if (queue.length) {
      // (the GL pass that packs the layers here: compiled only when this path runs)
      progD = program(gl, FS_D);
      progC = program(gl, FS_C);
      vao = gl.createVertexArray();
      o.renderer.resetState();
      await Promise.all(Array.from({ length: Math.min(width, L) }, worker));
    }
    if (failed) throw failed;
    // mips and sampling state
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    for (const t of [texD, texC]) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (ext && o.anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, o.anisotropy);
    }
    o.renderer.resetState();
    if (gl.getError() !== gl.NO_ERROR) throw new Error('textures: GL error while packing');
  } catch (err) {
    cleanupScratch();
    freeAll();
    throw err;
  }
  cleanupScratch();
  const D = new THREE.ExternalTexture(texD), C = new THREE.ExternalTexture(texC);
  // (three only binds an external texture; the sampler state set above stays)
  const info = {
    size: n, stored, sets: plan.sets.slice(), layers: L, bytes: bakedBytes(n, L), ms: Math.round(now() - t0), worker: viaWorker,
  };
  let gone = false;
  return {
    D, C, plan, manifest, info,
    dispose() {
      if (gone) return;
      gone = true;
      gl.deleteTexture(texD); gl.deleteTexture(texC);
      D.dispose(); C.dispose();
    },
  };
}

/** Surface ids used by the meshes under `root` (their aDet attribute's third component). */
export function usedSurfaceIds(root) {
  const ids = new Set();
  root.traverse((o) => {
    const a = o.geometry && o.geometry.attributes && o.geometry.attributes.aDet;
    if (!a) return;
    const arr = a.array, st = a.itemSize || 3;
    for (let i = 2; i < arr.length; i += st) {
      const v = Math.floor(arr[i] + 0.5);
      if (v > 0 && v < DET_COUNT) ids.add(v);
    }
  });
  return ids;
}
