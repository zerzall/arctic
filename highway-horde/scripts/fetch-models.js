#!/usr/bin/env node
// Photo-scanned prop models from Poly Haven (CC0 1.0) for the set dressing: `node scripts/fetch-models.js`.
//
// For each model in MODELS below it downloads the asset's 1K glTF (the .gltf, its .bin and its JPG maps)
// into a cache and converts it for the game (render3d/props3d.js draws it, instanced):
//   - every node's transform baked in, the primitives of the materials asked for merged into one mesh,
//     standing on y = 0 and centred on x / z, in metres (the game scales it to the prop it stands for);
//   - two levels of detail simplified with meshoptimizer (LOD 0 ≈ `tris` triangles, LOD 1 a sixth of
//     that), the vertices compacted per level;
//   - every material a texture layer of three 512² maps under public/textures/models/<layer>/:
//     albedo.png (sRGB), normal.png (OpenGL tangent space) and orm.png (AO, roughness, metalness);
//   - public/models/props.bin (all the levels: float32 positions, int8 normals, float32 uvs, uint8
//     layer per vertex, uint16 / uint32 indices) and props.json (the offsets, sizes, layers and sources).
//
// Deterministic and re-runnable (the manifest records each file's URL and md5; a file whose md5 changed
// upstream stops the run unless --update). Licence and credits: public/models/CREDITS.md.
//
//   node scripts/fetch-models.js [--only a,b] [--cache dir] [--update] [--list]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { encodePNG } from './bake/png.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models');
const TEX = join(ROOT, 'public', 'textures', 'models');
const API = 'https://api.polyhaven.com';
/** Stored texture size (props are at most a metre or two: ~500 texels a metre). */
const STORE = 512;

/**
 * name → the Poly Haven model and how to convert it:
 *   id     asset id            tris  LOD 0 triangle budget        mats  material names to keep (default all)
 *   nodes  a pattern the names of the mesh nodes to keep match (an asset that lays out several copies)
 *   about  what it is in the game
 */
export const MODELS = {
  drum_a: { id: 'Barrel_01', tris: 900, about: 'steel 200-litre drum, painted' },
  drum_b: { id: 'Barrel_02', tris: 900, about: 'steel 200-litre drum, rusted' },
  drum_c: { id: 'barrel_03', tris: 900, about: 'steel drum with a dented body' },
  crate_a: { id: 'wooden_crate_01', tris: 900, about: 'long wooden crate' },
  crate_b: { id: 'wooden_crate_02', tris: 900, about: 'tall wooden crate' },
  milcrate: { id: 'old_military_crate', tris: 1200, nodes: /_a$/, about: 'olive military crate with latches' },
  cardboard: { id: 'cardboard_box_01', tris: 900, about: 'taped cardboard box' },
  propane: { id: 'propane_tank', tris: 800, about: 'propane cylinder' },
  jerrycan: { id: 'metal_jerrycan', tris: 1000, about: 'steel jerrycan' },
  trashcan: { id: 'metal_trash_can', tris: 1200, mats: ['metal_trash_can'], nodes: /^metal_trash_can(_handle_(left|right))?$/, about: 'galvanised trash can' },
  trashcan_rust: { id: 'metal_trash_can', tris: 1200, mats: ['metal_trash_can_rust'], nodes: /^metal_trash_can_rust(_handle_(left|right))?$/, about: 'rusting galvanised trash can' },
  hydrant: { id: 'fire_hydrant', tris: 1400, mats: ['fire_hydrant'], about: 'cast-iron fire hydrant' },
  bench: { id: 'painted_wooden_bench', tris: 630, about: 'painted wooden park bench' },
  generator: { id: 'portable_generator', tris: 1800, about: 'portable petrol generator in its frame' },
  tyre: { id: 'old_tyre', tris: 1000, about: 'worn car tyre' },
  trashbag: { id: 'trashbag', tris: 700, about: 'tied black trash bag' },
  picnic: { id: 'wooden_picnic_table', tris: 1600, about: 'wooden picnic table with benches' },
  chair: { id: 'plastic_monobloc_chair_01', tris: 1000, about: 'white plastic garden chair' },
  stump: { id: 'tree_stump_01', tris: 1400, about: 'sawn tree stump with roots' },
  log: { id: 'dead_tree_trunk', tris: 1400, about: 'fallen dead trunk' },
  boulder: { id: 'boulder_01', tris: 1400, about: 'weathered boulder' },
  wheelchair: { id: 'wheelchair_01', tris: 1800, about: 'hospital wheelchair' },
};

const md5 = (b) => createHash('md5').update(b).digest('hex');
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export async function fetchRetry(url, kind = 'buffer') {
  let err;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'highway-horde-model-fetch' } });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return kind === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 1000 * 2 ** a)); }
  }
  throw err;
}

export async function cached(cache, id, file) {
  const dir = join(cache, id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file.url.split('/').pop());
  if (existsSync(p)) {
    const b = readFileSync(p);
    if (!file.md5 || md5(b) === file.md5) return b;
  }
  const b = await fetchRetry(file.url);
  if (file.md5 && md5(b) !== file.md5) throw new Error(`${id}: md5 mismatch on ${file.url}`);
  writeFileSync(p, b);
  return b;
}

// ---- glTF -----------------------------------------------------------------------------------------

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function accessor(gl, bins, i) {
  const a = gl.accessors[i];
  const bv = gl.bufferViews[a.bufferView];
  const T = COMP[a.componentType];
  const n = NCOMP[a.type];
  const buf = bins[bv.buffer];
  const base = buf.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const out = new Float64Array(a.count * n);
  const dv = new DataView(buf.buffer);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const sz = T.BYTES_PER_ELEMENT;
  const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      let v = dv[get](base + k * stride + c * sz, true);
      if (norm) v = Math.max(-1, v / norm);
      out[k * n + c] = v;
    }
  }
  return out;
}

function mat4(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** Every primitive of the scene with its world matrix baked in: { mat, pos, nor, uv, idx }. */
export function primitives(gl, bins, keepNode = null) {
  const out = [];
  const visit = (ni, parent) => {
    const node = gl.nodes[ni];
    const m = mul(parent, mat4(node));
    if (node.mesh != null && (!keepNode || keepNode.test(node.name || ''))) {
      for (const p of gl.meshes[node.mesh].primitives) {
        if (p.mode != null && p.mode !== 4) continue;
        const pos = accessor(gl, bins, p.attributes.POSITION);
        const nor = p.attributes.NORMAL != null ? accessor(gl, bins, p.attributes.NORMAL) : null;
        const uv = p.attributes.TEXCOORD_0 != null ? accessor(gl, bins, p.attributes.TEXCOORD_0) : new Float64Array((pos.length / 3) * 2);
        const n = pos.length / 3;
        const idx = p.indices != null ? accessor(gl, bins, p.indices) : Float64Array.from({ length: n }, (_, i) => i);
        // (normals by the inverse transpose; node scales here are uniform or near enough: the matrix itself, renormalised)
        const P = new Float64Array(n * 3), N = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          P[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
          P[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          P[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          if (nor) {
            const a = nor[i * 3], b = nor[i * 3 + 1], c = nor[i * 3 + 2];
            let nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
          }
        }
        out.push({ mat: p.material ?? 0, pos: P, nor: nor ? N : null, uv, idx, det: m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) });
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = gl.scenes[gl.scene || 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const n of scene.nodes) visit(n, I);
  return out;
}

/** Face normals where a primitive has none (area-weighted per vertex). */
export function fillNormals(p) {
  if (p.nor) return;
  const N = new Float64Array(p.pos.length);
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3, P = p.pos;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  p.nor = N;
}

// ---- textures --------------------------------------------------------------------------------------

export function decodeJpg(buf) {
  const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 2048 });
  return { w: d.width, h: d.height, ch: d.data.length / (d.width * d.height), data: d.data };
}
/** Box-filter to n² (a power-of-two reduction), `c` channels out. */
function shrink(img, n, c = 3) {
  const f = img.w / n;
  if (!Number.isInteger(f) || img.h !== img.w) throw new Error(`texture ${img.w}x${img.h} does not reduce to ${n}`);
  const out = new Uint8Array(n * n * c);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += img.data[((y * f + dy) * img.w + x * f + dx) * img.ch + Math.min(k, img.ch - 1)];
        out[(y * n + x) * c + k] = Math.round(s / (f * f));
      }
    }
  }
  return out;
}
const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// ---- main ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { only: null, cache: join(ROOT, '.cache', 'photo-models'), update: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--only') a.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === '--cache') a.cache = resolve(argv[++i]);
    else if (v === '--update') a.update = true;
    else if (v === '--list') a.list = true;
    else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

/** One model → { lods: [{ pos, nor, uv, layer, idx }], layers: [{ mat, maps }], size, source }. */
async function convert(name, cfg, a, prev) {
  const files = await fetchRetry(`${API}/files/${cfg.id}`, 'json');
  const info = await fetchRetry(`${API}/info/${cfg.id}`, 'json');
  const g = files.gltf['1k'].gltf;
  const inc = g.include;
  if (prev && prev.id === cfg.id && !a.update) {
    for (const [k, f] of Object.entries(prev.files || {})) {
      const now = k === 'gltf' ? g : inc[k];
      if (now && now.md5 !== f.md5) throw new Error(`${name}: ${cfg.id} ${k} changed upstream; rerun with --update to accept`);
    }
  }
  const gl = JSON.parse((await cached(a.cache, cfg.id, g)).toString('utf8'));
  const bins = [];
  for (const b of gl.buffers) {
    const key = Object.keys(inc).find((k) => k.endsWith(b.uri));
    bins.push(await cached(a.cache, cfg.id, inc[key]));
  }
  const keepMat = (mi) => !cfg.mats || cfg.mats.includes(gl.materials[mi].name);
  const prims = primitives(gl, bins, cfg.nodes || null).filter((p) => keepMat(p.mat));
  for (const p of prims) fillNormals(p);
  // the kept materials, in first-use order → layer indices
  // (two materials over the same maps share one layer)
  const texKey = (mi) => { const t = (gl.materials[mi].pbrMetallicRoughness || {}).baseColorTexture; return t ? 'img:' + gl.images[gl.textures[t.index].source].uri : 'mat' + mi; };
  const mats = [];
  for (const p of prims) if (!mats.some((m) => texKey(m) === texKey(p.mat))) mats.push(p.mat);
  const layerOf = (mi) => mats.findIndex((m) => texKey(m) === texKey(mi));
  // merge
  let nv = 0, ni = 0;
  for (const p of prims) { nv += p.pos.length / 3; ni += p.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), layer = new Uint8Array(nv), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of prims) {
    const n = p.pos.length / 3;
    pos.set(p.pos, vo * 3); nor.set(p.nor, vo * 3); uv.set(p.uv, vo * 2); layer.fill(layerOf(p.mat), vo, vo + n);
    for (let t = 0; t < p.idx.length; t += 3) {
      // (a mirrored node flips the winding)
      const flip = p.det < 0;
      idx[io++] = vo + p.idx[t]; idx[io++] = vo + p.idx[flip ? t + 2 : t + 1]; idx[io++] = vo + p.idx[flip ? t + 1 : t + 2];
    }
    vo += n;
  }
  // stand it on y = 0, centred on x / z
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  const off = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] -= off[k];
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  // levels of detail: simplified against position, normal and uv (seams keep their vertices)
  await MeshoptSimplifier.ready;
  const attrs = new Float32Array(nv * 5);
  for (let i = 0; i < nv; i++) { attrs.set(nor.subarray(i * 3, i * 3 + 3), i * 5); attrs[i * 5 + 3] = uv[i * 2]; attrs[i * 5 + 4] = uv[i * 2 + 1]; }
  const lods = [];
  const targets = [Math.min(ni / 3, cfg.tris), Math.max(48, Math.round(Math.min(ni / 3, cfg.tris) / 6))];
  for (const [li, tt] of targets.entries()) {
    let out = idx;
    if (tt * 3 < ni) {
      [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, tt * 3, li ? 0.08 : 0.02);
      if (out.length > tt * 3 * 1.6) [out] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, tt * 3, li ? 0.12 : 0.04);
    }
    // compact the vertices this level uses
    const remap = new Int32Array(nv).fill(-1);
    let k = 0;
    const order = [];
    for (const v of out) if (remap[v] < 0) { remap[v] = k++; order.push(v); }
    const L = { pos: new Float32Array(k * 3), nor: new Int8Array(k * 3), uv: new Float32Array(k * 2), layer: new Uint8Array(k), idx: k > 65535 ? new Uint32Array(out.length) : new Uint16Array(out.length) };
    order.forEach((v, j) => {
      L.pos.set(pos.subarray(v * 3, v * 3 + 3), j * 3);
      for (let c = 0; c < 3; c++) L.nor[j * 3 + c] = Math.round(Math.max(-1, Math.min(1, nor[v * 3 + c])) * 127);
      // (glTF uv has its origin at the image's top left, like the arrays' layers: rows stored top first, no flip)
      L.uv[j * 2] = uv[v * 2]; L.uv[j * 2 + 1] = uv[v * 2 + 1];
      L.layer[j] = layer[v];
    });
    for (let t = 0; t < out.length; t++) L.idx[t] = remap[out[t]];
    lods.push(L);
  }
  // textures per kept material
  const layers = [];
  const usedFiles = { gltf: { url: g.url, md5: g.md5 } };
  for (const [bi, b] of gl.buffers.entries()) { const key = Object.keys(inc).find((k) => k.endsWith(b.uri)); usedFiles[key] = { url: inc[key].url, md5: inc[key].md5 }; void bi; }
  for (const mi of mats) {
    const m = gl.materials[mi];
    const pbr = m.pbrMetallicRoughness || {};
    const texFile = (ti) => {
      if (ti == null) return null;
      const img = gl.images[gl.textures[ti.index].source];
      const key = Object.keys(inc).find((k) => k.endsWith(img.uri));
      usedFiles[key] = { url: inc[key].url, md5: inc[key].md5 };
      return inc[key];
    };
    const fd = texFile(pbr.baseColorTexture), fn = texFile(m.normalTexture), fa = texFile(pbr.metallicRoughnessTexture);
    const n = STORE;
    let albedo, normal, orm;
    if (fd) albedo = shrink(decodeJpg(await cached(a.cache, cfg.id, fd)), n);
    else { albedo = new Uint8Array(n * n * 3); const c = (pbr.baseColorFactor || [0.5, 0.5, 0.5]).map((v) => Math.round(Math.pow(v, 1 / 2.2) * 255)); for (let i = 0; i < n * n; i++) albedo.set(c.slice(0, 3), i * 3); }
    if (fn) normal = shrink(decodeJpg(await cached(a.cache, cfg.id, fn)), n);
    else { normal = new Uint8Array(n * n * 3); for (let i = 0; i < n * n; i++) normal.set([128, 128, 255], i * 3); }
    // glTF metallicRoughness: G roughness, B metalness; Poly Haven packs AO in R ("arm")
    if (fa) {
      const arm = shrink(decodeJpg(await cached(a.cache, cfg.id, fa)), n);
      orm = arm;
    } else { orm = new Uint8Array(n * n * 3); for (let i = 0; i < n * n; i++) orm.set([255, Math.round((pbr.roughnessFactor ?? 0.8) * 255), Math.round((pbr.metallicFactor ?? 0) * 255)], i * 3); }
    // mean linear albedo (the tint's reference)
    let r = 0, gg = 0, bb = 0;
    for (let i = 0; i < n * n; i++) { r += toLin(albedo[i * 3] / 255); gg += toLin(albedo[i * 3 + 1] / 255); bb += toLin(albedo[i * 3 + 2] / 255); }
    layers.push({ name: `${name}${mats.length > 1 ? '_' + mats.indexOf(mi) : ''}`, material: m.name, maps: { albedo, normal, orm }, mean: [r, gg, bb].map((v) => r4(v / (n * n))) });
  }
  return {
    lods, layers, size: size.map(r4),
    source: {
      library: 'Poly Haven', id: cfg.id, name: info.name, url: `https://polyhaven.com/a/${cfg.id}`,
      license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', authors: info.authors || {}, files: usedFiles,
    },
    srcTris: ni / 3,
  };
}

function credits(man) {
  const rows = Object.entries(man.models).map(([n, e]) => {
    const s = e.source;
    return `| \`${n}\` | [${s.name}](${s.url}) (\`${s.id}\`) | ${Object.keys(s.authors || {}).join(', ')} | ${s.license} | ${e.lods.map((l) => l.tris).join(' / ')} (source ${e.srcTris}) |`;
  });
  return `# Model credits

The prop models in \`props.bin\` / \`props.json\` (drawn by \`render3d/props3d.js\`) and their texture layers in
\`../textures/models/\` are **photo-scanned models from [Poly Haven](https://polyhaven.com)**, all released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain; no attribution required — credited
here anyway, with thanks to the authors). \`scripts/fetch-models.js\` downloaded each as its 1K glTF, baked the node
transforms, simplified two levels of detail with meshoptimizer and stored the maps at 512². \`props.json\` records
each asset's page, licence and the exact file URLs and md5 sums.

| Model | Source asset | Authors | Licence | Triangles (LOD 0 / 1) |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.list) { for (const [n, c] of Object.entries(MODELS)) console.log(`${n.padEnd(12)} ${c.id}`); return; }
  mkdirSync(OUT, { recursive: true });
  const mPath = join(OUT, 'props.json');
  const old = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : { models: {} };
  const names = a.only || Object.keys(MODELS);
  const results = {};
  for (const name of Object.keys(MODELS)) {
    if (!names.includes(name)) continue;
    const r = await convert(name, MODELS[name], a, old.models[name] && old.models[name].source);
    results[name] = r;
    console.log(`  ${name.padEnd(11)} ← ${MODELS[name].id.padEnd(26)} ${r.srcTris} → ${r.lods.map((l) => l.idx.length / 3).join(' / ')} tris, ${r.layers.length} layer(s), ${r.size.map((v) => v.toFixed(2)).join(' × ')} m`);
  }
  // models not converted this run keep their bytes: read them back from the old bin
  const oldBin = existsSync(join(OUT, 'props.bin')) ? readFileSync(join(OUT, 'props.bin')) : null;
  const chunks = [];
  let at = 0;
  const put = (arr) => {
    const pad = (4 - (at % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); at += pad; }
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    chunks.push(b);
    const o = at;
    at += b.length;
    return o;
  };
  const man = { version: 1, store: STORE, models: {}, layers: [] };
  for (const name of Object.keys(MODELS)) {
    let e;
    if (results[name]) {
      const r = results[name];
      const layerBase = man.layers.length;
      for (const L of r.layers) {
        const dir = join(TEX, L.name);
        mkdirSync(dir, { recursive: true });
        for (const k of ['albedo', 'normal', 'orm']) writeFileSync(join(dir, `${k}.png`), encodePNG(L.maps[k], STORE, STORE, 3, { level: 9 }));
        man.layers.push({ name: L.name, model: name, material: L.material, mean: L.mean, files: { albedo: `models/${L.name}/albedo.png`, normal: `models/${L.name}/normal.png`, orm: `models/${L.name}/orm.png` } });
      }
      e = {
        about: MODELS[name].about, size: r.size, layer0: layerBase, layers: r.layers.length, srcTris: r.srcTris, source: r.source,
        lods: r.lods.map((L) => ({
          verts: L.layer.length, tris: L.idx.length / 3, index32: L.idx instanceof Uint32Array,
          pos: put(L.pos), nor: put(L.nor), uv: put(L.uv), layer: put(L.layer), idx: put(L.idx),
        })),
      };
    } else if (old.models[name] && oldBin) {
      const o = old.models[name];
      const layerBase = man.layers.length;
      for (let k = 0; k < o.layers; k++) man.layers.push(old.layers[o.layer0 + k]);
      e = { ...o, layer0: layerBase, lods: o.lods.map((l) => {
        const sl = (off, bytes) => oldBin.subarray(off, off + bytes);
        return { ...l, pos: put(sl(l.pos, l.verts * 12)), nor: put(sl(l.nor, l.verts * 3)), uv: put(sl(l.uv, l.verts * 8)), layer: put(sl(l.layer, l.verts)), idx: put(sl(l.idx, l.tris * 3 * (l.index32 ? 4 : 2))) };
      }) };
    } else continue;
    man.models[name] = e;
  }
  man.bytes = at;
  writeFileSync(join(OUT, 'props.bin'), Buffer.concat(chunks));
  writeFileSync(mPath, JSON.stringify(man, null, 1) + '\n');
  writeFileSync(join(OUT, 'CREDITS.md'), credits(man));
  console.log(`${Object.keys(man.models).length} models, ${man.layers.length} texture layers, props.bin ${(at / 1e3).toFixed(0)} kB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
