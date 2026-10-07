// The baked gun textures (scripts/bake-guns.js → public/textures/guns/) on the GPU: every
// material family of shared/gun-finish.js is one layer of two RGBA texture arrays,
//   uFamA  albedo.rgb (sRGB) + roughness
//   uFamB  normal.xy + ambient occlusion + metalness
// the skin patterns likewise (uSkinA: albedo + coverage, uSkinB: normal.xy, roughness, metalness)
// and the ageing overlay is one 2D texture (uWear). Layer sizes follow the tier (GUN_TEX_TIERS);
// 'low' never loads them (the guns keep their small procedural atlas, actor-tex.js).
//
// The uniforms are page-global objects every gun material shares (gun-mat.js puts them into its
// shader), so a finished upload switches every gun over at once, without recompiling anything:
// until then (and if a file is missing, the decoder is absent or this is a node test) the
// uniforms point at 1-texel placeholders and uGunTexOn is 0 — the shader's procedural path.
//
// Loading: fetch + createImageBitmap (resized to the layer size off the main thread), drawn into
// a canvas to read the pixels back (one file a frame), packed into the array and uploaded once
// with mipmaps; the CPU copy is dropped after the upload. The one-file build embeds the PNGs (window.__HH_FILES).
// `?guntex=0` in the page address leaves them off (before / after screenshots); a software
// rasterizer (SwiftShader, llvmpipe: no graphics card) leaves them off too unless `?guntex=1`.

import * as THREE from 'three';
import { GUN_FAMILIES, SKIN_PATTERNS, GUN_WEAR_FILE } from '../shared/gun-finish.js';
import { tierRow, tierRank, anisoFor } from './tier.js';

/** Per tier: layer size of the families, the skins and the wear overlay (null: no textures). */
export const GUN_TEX_TIERS = Object.freeze({
  low: null,
  high: { family: 512, skin: 512, wear: 1024 },
  ultra: { family: 1024, skin: 1024, wear: 2048 },
  cinematic: { family: 2048, skin: 1024, wear: 2048 },
});

/** Where a gun texture comes from: the one-file build's embedded copy, else next to the game. */
export function gunTexURL(file) {
  const key = 'textures/guns/' + file;
  const emb = globalThis.__HH_FILES && globalThis.__HH_FILES[key];
  if (emb) return emb;
  try {
    return new URL('../../textures/guns/' + file, import.meta.url).href;
  } catch {
    return key;
  }
}

function placeholderArray(rgba) {
  const t = new THREE.DataArrayTexture(new Uint8Array(rgba), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}
const PH = {
  famA: placeholderArray([128, 128, 128, 128]),
  famB: placeholderArray([128, 128, 255, 0]),
  skinA: placeholderArray([128, 128, 128, 0]),
  skinB: placeholderArray([128, 128, 160, 0]),
  wear: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 128, 0, 128]), 1, 1); t.needsUpdate = true; return t; })(),
};

/** Shared by every gun material (gun-mat.js). */
export const GUN_TEX_UNIFORMS = {
  uFamA: { value: PH.famA },
  uFamB: { value: PH.famB },
  uSkinA: { value: PH.skinA },
  uSkinB: { value: PH.skinB },
  uWear: { value: PH.wear },
  uGunTexOn: { value: 0 },
  uGunSkinOn: { value: 0 },
  uGunWearOn: { value: 0 },
};

const state = {
  tier: null,          // the tier whose sizes are loaded / loading
  gen: 0,              // bumps on every (re)start: stale loads drop their results
  status: 'off',       // 'off' | 'loading' | 'ready' | 'failed'
  textures: [],
  bytes: 0,            // GPU bytes (with mips)
  ms: 0,
  failed: [],
};

/** What is loaded: { status, tier, bytes, mb, ms, failed: [files] }. */
export function gunTexStats() {
  return { status: state.status, tier: state.tier, bytes: state.bytes, mb: Math.round(state.bytes / 1e5) / 10, ms: Math.round(state.ms), failed: state.failed.slice() };
}

/** GPU memory the textures of a tier take (bytes, mips included). */
export function gunTexBudget(tier) {
  const row = tierRow(GUN_TEX_TIERS, tier);
  if (!row) return 0;
  const mip = 4 / 3;
  return Math.round((2 * GUN_FAMILIES.length * row.family * row.family * 4 + 2 * SKIN_PATTERNS.length * row.skin * row.skin * 4 + row.wear * row.wear * 4) * mip);
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;
/** A software rasterizer (no graphics card): every texel is CPU time there. */
export function isSoftwareGL(gl) {
  try {
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : '';
    return SOFTWARE_GL.test(String(name || ''));
  } catch {
    return false;
  }
}

function canLoad(gl) {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return false;
  if (typeof OffscreenCanvas !== 'function' && typeof document === 'undefined') return false;
  let q = '';
  try { q = typeof location !== 'undefined' ? location.search || '' : ''; } catch { /* (no location) */ }
  if (/[?&]guntex=0\b/.test(q)) return false;
  // a software renderer keeps the procedural finish unless asked (?guntex=1: screenshots)
  if (isSoftwareGL(gl) && !/[?&]guntex=1\b/.test(q)) return false;
  return true;
}

async function decode(file, size) {
  const bmp = await decodeBitmap(file, size);
  // (the copy into the arrays runs on the main thread: one file a frame keeps the game smooth)
  await packTurn();
  return bmp;
}

async function decodeBitmap(file, size) {
  const res = await fetch(gunTexURL(file));
  if (!res.ok) throw new Error(`${res.status} ${file}`);
  const blob = await res.blob();
  const base = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  try {
    return await createImageBitmap(blob, { ...base, resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  } catch {
    return createImageBitmap(blob, base);
  }
}

let scratch = null;
/** RGBA pixels of a bitmap at size² (drawn through a 2D canvas). */
function pixelsOf(bmp, size) {
  if (!scratch || scratch.width !== size) {
    scratch = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
    scratch.ctx = scratch.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  }
  const g = scratch.ctx;
  g.globalCompositeOperation = 'copy';
  g.drawImage(bmp, 0, 0, size, size);
  if (bmp.close) bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

/** The next frame (or 50 ms, whichever first: a hidden tab gets no frames): one decoded file is packed per frame. */
function nextFrame() {
  return new Promise((r) => {
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}

let packGate = Promise.resolve();
/** Resolves on a frame of its own: the decoded files take turns, one a frame. */
function packTurn() {
  const p = packGate.then(nextFrame);
  packGate = p;
  return p;
}

/** A pool running jobs `limit` at a time. */
async function pool(jobs, limit) {
  let i = 0;
  const run = async () => { while (i < jobs.length) { const j = jobs[i++]; await j(); } };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, run));
}

function makeArray(data, size, layers, srgb, aniso) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.unpackAlignment = 4;
  // (the CPU copy goes once it is on the GPU: up to 350 MB on 'cinematic')
  t.onUpdate = () => { t.image.data = null; };
  t.needsUpdate = true;
  return t;
}

/** Will the textures load for this tier and context (else the guns draw the procedural finish only)? */
export function gunTexEnabled(tier, gl) {
  return !!tierRow(GUN_TEX_TIERS, tier) && canLoad(gl);
}

/**
 * Load (or keep) the textures for a tier. Idempotent: a tier whose sizes are already loaded or
 * loading does nothing; another tier reloads at its sizes; 'low' leaves what is there alone.
 * @param {string} tier
 * @param {{ maxAniso?: number, gl?: WebGL2RenderingContext }} opts (gl: a software rasterizer loads nothing unless ?guntex=1)
 * @returns {Promise<boolean>} true once the textures of this call are in use
 */
export function loadGunTextures(tier, opts = {}) {
  const row = tierRow(GUN_TEX_TIERS, tier);
  if (!row || !canLoad(opts.gl)) return Promise.resolve(false);
  const key = JSON.stringify(row);
  if (state.tier === key && (state.status === 'loading' || state.status === 'ready')) return state.promise;
  const gen = ++state.gen;
  state.tier = key;
  state.status = 'loading';
  state.failed = [];
  const t0 = performance.now();
  const aniso = anisoFor(tierRank(tier) >= tierRank('ultra') ? tier : 'high', opts.maxAniso || 16);
  const stale = () => gen !== state.gen;
  state.promise = (async () => {
    const L = GUN_FAMILIES.length, P = SKIN_PATTERNS.length;
    const fs = row.family, ss = row.skin;
    const famA = new Uint8Array(fs * fs * 4 * L), famB = new Uint8Array(fs * fs * 4 * L);
    const skinA = new Uint8Array(ss * ss * 4 * P), skinB = new Uint8Array(ss * ss * 4 * P);
    const jobs = [];
    const put = (dst, layer, size, px, map) => {
      const o = layer * size * size * 4;
      for (let i = 0, n = size * size; i < n; i++) {
        const s = i * 4, d = o + s;
        for (let c = 0; c < 4; c++) { const src = map[c]; if (src >= 0) dst[d + c] = px[s + src]; }
      }
    };
    // family maps: albedo → A.rgb, orm.g → A.a; normal.rg → B.rg, orm.r → B.b, orm.b → B.a
    GUN_FAMILIES.forEach((f, i) => {
      jobs.push(async () => { const px = pixelsOf(await decode(`${f.id}_albedo.png`, fs), fs); put(famA, i, fs, px, [0, 1, 2, -1]); });
      jobs.push(async () => { const px = pixelsOf(await decode(`${f.id}_normal.png`, fs), fs); put(famB, i, fs, px, [0, 1, -1, -1]); });
      jobs.push(async () => { const px = pixelsOf(await decode(`${f.id}_orm.png`, fs), fs); put(famA, i, fs, px, [-1, -1, -1, 1]); put(famB, i, fs, px, [-1, -1, 0, 2]); });
    });
    SKIN_PATTERNS.forEach((p, i) => {
      jobs.push(async () => { const px = pixelsOf(await decode(`skin_${p}_albedo.png`, ss), ss); put(skinA, i, ss, px, [0, 1, 2, 3]); });
      jobs.push(async () => { const px = pixelsOf(await decode(`skin_${p}_normal.png`, ss), ss); put(skinB, i, ss, px, [0, 1, -1, -1]); });
      jobs.push(async () => { const px = pixelsOf(await decode(`skin_${p}_orm.png`, ss), ss); put(skinB, i, ss, px, [-1, -1, 1, 2]); });
    });
    let wearPx = null;
    jobs.push(async () => { wearPx = new Uint8Array(pixelsOf(await decode(`${GUN_WEAR_FILE}.png`, row.wear), row.wear)); });
    // (one at a time per decode slot: each failure is recorded, the rest carry on)
    const guarded = jobs.map((j) => async () => {
      if (stale()) return;
      try { await j(); } catch (err) { state.failed.push(String(err && err.message || err).slice(0, 80)); if (state.failed.length === 1) console.warn('gun textures: a file failed', err && err.message ? err.message : err); }
    });
    await pool(guarded, 4);
    if (stale()) return false;
    if (state.failed.length) { state.status = 'failed'; return false; }
    disposeTextures();
    const tA = makeArray(famA, fs, L, true, aniso), tB = makeArray(famB, fs, L, false, Math.min(aniso, 8));
    const sA = makeArray(skinA, ss, P, true, aniso), sB = makeArray(skinB, ss, P, false, Math.min(aniso, 8));
    const w = new THREE.DataTexture(wearPx, row.wear, row.wear, THREE.RGBAFormat, THREE.UnsignedByteType);
    w.wrapS = w.wrapT = THREE.RepeatWrapping;
    w.minFilter = THREE.LinearMipmapLinearFilter;
    w.magFilter = THREE.LinearFilter;
    w.generateMipmaps = true;
    w.anisotropy = Math.min(aniso, 8);
    w.onUpdate = () => { w.image.data = null; };
    w.needsUpdate = true;
    state.textures = [tA, tB, sA, sB, w];
    const U = GUN_TEX_UNIFORMS;
    U.uFamA.value = tA; U.uFamB.value = tB; U.uSkinA.value = sA; U.uSkinB.value = sB; U.uWear.value = w;
    U.uGunTexOn.value = 1; U.uGunSkinOn.value = 1; U.uGunWearOn.value = 1;
    state.bytes = gunTexBudget(tier);
    state.ms = performance.now() - t0;
    state.status = 'ready';
    return true;
  })().catch((err) => {
    if (!stale()) { state.status = 'failed'; state.failed.push(String(err && err.message || err)); }
    console.warn('gun textures: unavailable, guns keep the procedural finish', err);
    return false;
  });
  return state.promise;
}

function disposeTextures() {
  for (const t of state.textures) t.dispose();
  state.textures = [];
  const U = GUN_TEX_UNIFORMS;
  U.uFamA.value = PH.famA; U.uFamB.value = PH.famB; U.uSkinA.value = PH.skinA; U.uSkinB.value = PH.skinB; U.uWear.value = PH.wear;
  U.uGunTexOn.value = 0; U.uGunSkinOn.value = 0; U.uGunWearOn.value = 0;
}

/**
 * Drop the textures (renderer3d destroy() → releaseSharedGuns()): the GPU copies and the
 * placeholders' uploads; a pending load is abandoned. The next renderer loads them again.
 */
export function releaseGunTextures() {
  state.gen++;
  state.tier = null;
  state.status = 'off';
  state.bytes = 0;
  disposeTextures();
  for (const k in PH) PH[k].dispose();
}
