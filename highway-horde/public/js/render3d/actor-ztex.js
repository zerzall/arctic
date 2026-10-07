// The zombies' baked texture sets (scripts/bake-zombies.js → public/textures/zombies/) on the GPU:
// skin in three stages of decay, the five specials' skins, six faces, a scalp, eleven fabrics, a
// wound atlas and a grime / stain set, loaded on high and up and packed into two or three
// mipmapped texture arrays (one sampler per resolution class, so a whole horde still samples a
// handful of textures). The corpse material (actor-zmat.js, `#define HH_ZTEX`) maps them onto the
// models by triplanar projection in rest-pose model space (they stick to the body as it moves),
// the faces by a front projection on the head's anchors (actor-zmodels.js faceAnchors).
//
// Every set is three PNGs (albedo, normal, pack); here they become runtime layers:
//   skin / spec  A: albedo rgb (sRGB) + subsurface thickness · B: normal xy + roughness + AO
//   face         A: albedo rgb + coverage                    · B: normal xy + roughness + "absolute"
//   cloth        one layer: relative brightness, bleach, normal xy
//   scalp        A: albedo rgb + hair coverage                · B: normal xy + roughness + AO
//   wound        A: albedo rgb + coverage                     · B: normal xy + roughness + wetness
//   grime        A: soak, mud, sweat, drips (linear masks)    · B: crust normal xy + roughness + holes
// The PNGs are decoded here (DecompressionStream + the PNG filters: exact bytes, no colour
// management, alpha untouched), box-filtered down to the tier's size and uploaded once. Nothing
// GPU-side is cached at module level; a failed load (no file, no decoder, a node test) resolves
// to null and the zombies keep the procedural corpse shading.

import * as THREE from 'three';
import { FAB, stageOf } from './actor-zlook.js';

export { FAB, stageOf };

/** The baked sets, in the baker's order: [name, kind]. */
export const ZT_SETS = [
  ['skin-fresh', 'skin'], ['skin-weeks', 'skin'], ['skin-months', 'skin'],
  ['skin-bloater', 'skin'], ['skin-spitter', 'skin'], ['skin-brute', 'skin'], ['skin-screamer', 'skin'], ['skin-boss', 'skin'],
  ['face-a', 'face'], ['face-b', 'face'], ['face-c', 'face'], ['face-d', 'face'], ['face-e', 'face'], ['face-f', 'face'],
  ['cloth-denim', 'cloth'], ['cloth-flannel', 'cloth'], ['cloth-tee', 'cloth'], ['cloth-gown', 'cloth'], ['cloth-police', 'cloth'],
  ['cloth-military', 'cloth'], ['cloth-work', 'cloth'], ['cloth-shirt', 'cloth'], ['cloth-suit', 'cloth'], ['cloth-hoodie', 'cloth'], ['cloth-dress', 'cloth'],
  ['scalp', 'scalp'], ['wounds', 'wound'], ['grime', 'grime'],
];

/** The special infected with their own skin: type → index into the spec class. */
export const SPECIAL = { bloater: 0, spitter: 1, brute: 2, screamer: 3, boss: 4 };

/** Model units per texture tile (scripts/zbake: skin 20, cloth 16). */
export const SKIN_TILE = 20, CLOTH_TILE = 16, SCALP_TILE = 12, GRIME_TILE = 30;
/** The face frame (scripts/zbake/face.js FACE / EYE_SPOT): canonical anchors, extent, eye spots. */
export const FACE_FRAME = { EZ: 0.266, EY: 0.074, MY: -0.325, CY: -0.985, Z0: -1.1, Y0: -1.25, SPAN: 2.2, EYE_RZ: 0.162, EYE_RY: 0.1143, SPOT_L: [0.075, 0.075], SPOT_R: [0.925, 0.075], SPOT_R0: 0.065 };
/** Wound atlas: 4 × 2 cells, a cell spans ±WOUND_Q wound radii. */
export const WOUND_Q = 2.2;

// the runtime classes: which sets, and how many layers each set takes (2 for A and B, 1 for cloth)
const CLASSES = {
  skinA: { sets: ['skin-fresh', 'skin-weeks', 'skin-months'], part: 'A' },
  skinB: { sets: ['skin-fresh', 'skin-weeks', 'skin-months'], part: 'B' },
  specA: { sets: ['skin-bloater', 'skin-spitter', 'skin-brute', 'skin-screamer', 'skin-boss'], part: 'A' },
  specB: { sets: ['skin-bloater', 'skin-spitter', 'skin-brute', 'skin-screamer', 'skin-boss'], part: 'B' },
  faceA: { sets: ['face-a', 'face-b', 'face-c', 'face-d', 'face-e', 'face-f'], part: 'A' },
  faceB: { sets: ['face-a', 'face-b', 'face-c', 'face-d', 'face-e', 'face-f'], part: 'B' },
  cloth: { sets: ZT_SETS.filter((s) => s[1] === 'cloth').map((s) => s[0]), part: 'C' },
  scalpA: { sets: ['scalp'], part: 'A' }, scalpB: { sets: ['scalp'], part: 'B' },
  woundA: { sets: ['wounds'], part: 'A' }, woundB: { sets: ['wounds'], part: 'B' },
  grimeA: { sets: ['grime'], part: 'A' }, grimeB: { sets: ['grime'], part: 'B' },
};
export const ZT_CLASSES = Object.keys(CLASSES);

/**
 * Per tier: the texture arrays as [size, classes]. VRAM (RGBA8 + mips): ultra ≈ 294 MB,
 * cinematic ≈ 436 MB, high ≈ 130 MB (ztexBytes). Low keeps the procedural shading.
 */
export const ZTEX_TIERS = Object.freeze({
  low: null,
  high: [[1024, ['skinA', 'skinB', 'specA', 'specB']], [512, ['faceA', 'faceB', 'cloth', 'scalpA', 'scalpB', 'woundA', 'woundB', 'grimeA', 'grimeB']]],
  ultra: [[2048, ['skinA']], [1024, ['skinB', 'specA', 'specB', 'faceA', 'faceB', 'cloth', 'scalpA', 'scalpB', 'woundA', 'woundB']], [512, ['grimeA', 'grimeB']]],
  cinematic: [[2048, ['skinA', 'skinB', 'specA']], [1024, ['specB', 'faceA', 'faceB', 'cloth', 'scalpA', 'scalpB', 'woundA', 'woundB', 'grimeA', 'grimeB']]],
});

/**
 * The layout of a tier: groups [{ size, layers: [[class, set], ...] }] and per class its
 * group index and first layer. null on low (or an unknown table row).
 */
export function ztexLayout(tier) {
  const row = ZTEX_TIERS[tier] === undefined ? ZTEX_TIERS.high : ZTEX_TIERS[tier];
  if (!row) return null;
  const groups = [], slot = {};
  row.forEach(([size, classes], g) => {
    const layers = [];
    for (const c of classes) {
      slot[c] = { g, base: layers.length };
      for (const s of CLASSES[c].sets) layers.push([c, s]);
    }
    groups.push({ size, layers });
  });
  return { tier, groups, slot };
}

/** Bytes of GPU memory a layout takes (RGBA8, a full mip chain ≈ 4/3). */
export function ztexBytes(layout) {
  if (!layout) return 0;
  let b = 0;
  for (const g of layout.groups) b += g.size * g.size * 4 * g.layers.length * 4 / 3;
  return Math.round(b);
}

/**
 * GLSL for a layout: the samplers and per-class macros ZS_<class> (sampler) and ZB_<class>
 * (first layer, float), used by actor-zmat.js's HH_ZTEX code.
 */
export function ztexGLSL(layout) {
  let s = '';
  layout.groups.forEach((g, i) => { s += `uniform highp sampler2DArray uZT${i};\n`; });
  for (const c of ZT_CLASSES) {
    const sl = layout.slot[c];
    s += `#define ZS_${c} uZT${sl.g}\n#define ZB_${c} ${sl.base.toFixed(1)}\n`;
  }
  return s;
}

/** Where a texture file comes from: the one-file build's embedded copy, else next to the game. */
export function ztexFileURL(file) {
  const key = 'textures/zombies/' + file;
  const emb = globalThis.__HH_FILES && globalThis.__HH_FILES[key];
  if (emb) return emb;
  try {
    return new URL('../../textures/zombies/' + file, import.meta.url).href;
  } catch {
    return key;
  }
}

// ---------------------------------------------------------------------------------------
// PNG decoding (8-bit, non-interlaced; grey, grey+alpha, RGB, RGBA)

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode a PNG → { w, h, ch, px } (rows top to bottom). */
export async function decodePNG(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, ch = 0;
  const idat = [];
  let total = 0;
  while (o + 8 <= b.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8); h = dv.getUint32(o + 12);
      if (b[o + 16] !== 8 || b[o + 20] !== 0) throw new Error('unsupported PNG');
      ch = { 0: 1, 4: 2, 2: 3, 6: 4 }[b[o + 17]];
      if (!ch) throw new Error('unsupported PNG colour type');
    } else if (type === 'IDAT') { idat.push(b.subarray(o + 8, o + 8 + len)); total += len; } else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!w || !idat.length) throw new Error('truncated PNG');
  let z;
  if (idat.length === 1) z = idat[0];
  else { z = new Uint8Array(total); let k = 0; for (const c of idat) { z.set(c, k); k += c.length; } }
  const raw = await inflate(z);
  const stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error('bad PNG data');
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    if (f === 0) { px.set(raw.subarray(src, src + stride), row); continue; }
    if (f === 1) {
      for (let i = 0; i < ch; i++) px[row + i] = raw[src + i];
      for (let i = ch; i < stride; i++) px[row + i] = (raw[src + i] + px[row + i - ch]) & 255;
    } else if (f === 2) {
      if (y === 0) px.set(raw.subarray(src, src + stride), row);
      else for (let i = 0; i < stride; i++) px[row + i] = (raw[src + i] + px[prev + i]) & 255;
    } else if (f === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[row + i - ch] : 0, up = y > 0 ? px[prev + i] : 0;
        px[row + i] = (raw[src + i] + ((a + up) >> 1)) & 255;
      }
    } else if (f === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? px[row + i - ch] : 0, up = y > 0 ? px[prev + i] : 0, c = y > 0 && i >= ch ? px[prev + i - ch] : 0;
        const p = a + up - c, pa = p > a ? p - a : a - p, pb = p > up ? p - up : up - p, pc = p > c ? p - c : c - p;
        px[row + i] = (raw[src + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255;
      }
    } else throw new Error('bad PNG filter');
  }
  return { w, h, ch, px };
}

/** Halve an image (2×2 box filter) → same layout. */
export function halve(img) {
  const { w, h, ch, px } = img;
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * ch);
  for (let y = 0; y < H; y++) {
    const r0 = y * 2 * w * ch, r1 = r0 + w * ch, o = y * W * ch;
    for (let x = 0; x < W; x++) {
      const a = r0 + x * 2 * ch, b = r1 + x * 2 * ch;
      for (let c = 0; c < ch; c++) out[o + x * ch + c] = (px[a + c] + px[a + ch + c] + px[b + c] + px[b + ch + c] + 2) >> 2;
    }
  }
  return { w: W, h: H, ch, px: out };
}

/** Double an image (nearest-bilinear, for a file smaller than its tier's size). */
function grow(img) {
  const { w, h, ch, px } = img;
  const W = w * 2, H = h * 2, out = new Uint8Array(W * H * ch);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y - 0.5) / 2)), y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x - 0.5) / 2)), x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < ch; c++) {
        const a = px[(y0 * w + x0) * ch + c], b = px[(y0 * w + x1) * ch + c], d = px[(y1 * w + x0) * ch + c], e = px[(y1 * w + x1) * ch + c];
        out[(y * W + x) * ch + c] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy);
      }
    }
  }
  return { w: W, h: H, ch, px: out };
}

function fit(img, size) {
  while (img.w > size) img = halve(img);
  while (img.w < size) img = grow(img);
  return img;
}

/**
 * Write one runtime layer (size², RGBA, rows bottom-up: +v up) of a set from its decoded maps.
 * part 'A' | 'B' | 'C' (cloth's single layer); kind as in ZT_SETS.
 */
export function packLayer(out, offset, size, kind, part, maps) {
  const { albedo: a, normal: n, pack: p } = maps;
  const ac = a.ch, nc = n.ch, pc = p.ch;
  for (let y = 0; y < size; y++) {
    const sy = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const i = sy * size + x, o = offset + (y * size + x) * 4;
      const ai = i * ac, ni = i * nc, pi = i * pc;
      let r, g, b, w;
      if (part === 'C') { r = a.px[ai]; g = p.px[pi + 2]; b = n.px[ni]; w = n.px[ni + 1]; }
      else if (part === 'A') {
        r = a.px[ai]; g = a.px[ai + 1]; b = a.px[ai + 2];
        w = kind === 'skin' ? p.px[pi + 2] : ac === 4 ? a.px[ai + 3] : 255;
      } else {
        r = n.px[ni]; g = n.px[ni + 1]; b = p.px[pi];
        w = kind === 'skin' || kind === 'scalp' ? p.px[pi + 1] : p.px[pi + 2];
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = w;
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Load a tier's sets and build its texture arrays (one at a time, yielding between files so a
 * frame never waits long). Resolves { layout, textures: [DataArrayTexture], bytes, ms } or null
 * when anything is missing or fails (the caller keeps the procedural shading).
 * @param {string} tier
 * @param {{ anisotropy?: number, fetch?: Function, signal?: { gone: boolean } }} [opts]
 */
export async function loadZombieTextures(tier, opts = {}) {
  const layout = ztexLayout(tier);
  if (!layout) return null;
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || typeof DecompressionStream === 'undefined') return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const kinds = new Map(ZT_SETS);
    const datas = layout.groups.map((g) => new Uint8Array(g.size * g.size * 4 * g.layers.length));
    // each set's maps are decoded once and written into every layer that wants them
    const want = new Map();
    layout.groups.forEach((g, gi) => g.layers.forEach(([c, s], li) => {
      if (!want.has(s)) want.set(s, []);
      want.get(s).push({ gi, li, part: CLASSES[c].part, size: g.size });
    }));
    for (const [set, uses] of want) {
      if (opts.signal && opts.signal.gone) return null;
      const maps = {};
      for (const k of ['albedo', 'normal', 'pack']) {
        const res = await doFetch(ztexFileURL(`${set}-${k}.png`));
        if (!res || !res.ok) throw new Error(`no ${set}-${k}.png`);
        maps[k] = await decodePNG(new Uint8Array(await res.arrayBuffer()));
        await tick();
      }
      for (const u of uses) {
        const m = { albedo: fit(maps.albedo, u.size), normal: fit(maps.normal, u.size), pack: fit(maps.pack, u.size) };
        packLayer(datas[u.gi], u.li * u.size * u.size * 4, u.size, kinds.get(set), u.part, m);
      }
      await tick();
    }
    const textures = layout.groups.map((g, gi) => {
      const tex = new THREE.DataArrayTexture(datas[gi], g.size, g.size, g.layers.length);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = opts.anisotropy || 1;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      tex.name = `ztex-${tier}-${gi}`;
      return tex;
    });
    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return { layout, textures, bytes: ztexBytes(layout), ms };
  } catch (err) {
    if (typeof console !== 'undefined' && opts.quiet !== true) console.info('zombie textures unavailable, keeping the procedural shading:', err && err.message);
    return null;
  }
}
