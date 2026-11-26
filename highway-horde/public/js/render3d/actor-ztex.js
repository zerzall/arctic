// The zombies' baked texture sets (scripts/bake-zombies.js → public/textures/zombies/) on the GPU:
// the body atlases on the MakeHuman UV layout (three stages of decay and the five specials' own),
// three tiling skins for growths and gear in skin, eleven photo-scanned fabrics, a wound atlas and a
// grime / stain set, loaded on high and up and packed into two or three mipmapped texture arrays
// (one sampler per resolution class, so a whole horde still samples a handful of textures). The
// corpse material (actor-zmat.js, `#define HH_ZTEX`) samples the body atlases by the body's own UVs
// (vMH) and maps the rest by triplanar projection in rest-pose model space (they stick to the body
// as it moves).
//
// Every set is three PNGs (albedo, normal, pack); here they become runtime layers:
//   body / skin  A: albedo rgb (sRGB) + hair coverage (body) or subsurface thickness (skin)
//                B: normal xy + roughness + AO
//   cloth        one layer: relative brightness, bleach, normal xy
//   wound        A: albedo rgb + coverage                     · B: normal xy + roughness + wetness
//   grime        A: soak, mud, sweat, drips (linear masks)    · B: crust normal xy + roughness + holes
// The files are the PNGs' download copies at the size the tier uses (tex-files.js), decoded in a
// worker by the browser (ImageDecoder: no colour management, alpha untouched), or the PNGs themselves
// (DecompressionStream + the PNG filters below: exact bytes), box-filtered down to the tier's size and
// uploaded once. Nothing
// GPU-side is cached at module level; a failed load (no file, no decoder, a node test) resolves
// to null and the zombies keep the procedural corpse shading.

import * as THREE from 'three';
import { FAB, stageOf } from './actor-zlook.js';
import { textureSource, textureQueue } from './tex-files.js';
import { makeTexWorker, decodeRGBA, texBytes } from './tex-worker.js';
import { phoneProfile } from './tier.js';

export { FAB, stageOf };

/** The baked sets, in the baker's order: [name, kind]. */
export const ZT_SETS = [
  ['body-fresh', 'body'], ['body-weeks', 'body'], ['body-months', 'body'],
  ['body-bloater', 'body'], ['body-spitter', 'body'], ['body-brute', 'body'], ['body-screamer', 'body'], ['body-boss', 'body'],
  ['skin-fresh', 'skin'], ['skin-weeks', 'skin'], ['skin-months', 'skin'],
  ['cloth-denim', 'cloth'], ['cloth-flannel', 'cloth'], ['cloth-tee', 'cloth'], ['cloth-gown', 'cloth'], ['cloth-police', 'cloth'],
  ['cloth-military', 'cloth'], ['cloth-work', 'cloth'], ['cloth-shirt', 'cloth'], ['cloth-suit', 'cloth'], ['cloth-hoodie', 'cloth'], ['cloth-dress', 'cloth'],
  ['wounds', 'wound'], ['grime', 'grime'],
];

/** The special infected with their own body atlas: type → index after the three decay stages. */
export const SPECIAL = { bloater: 0, spitter: 1, brute: 2, screamer: 3, boss: 4 };

/** Model units per texture tile (1 unit = 3 cm: a skin tile spans 33 cm, a fabric 48 cm). */
export const SKIN_TILE = 11, CLOTH_TILE = 16, GRIME_TILE = 18;
/** Wound atlas: 4 × 2 cells, a cell spans ±WOUND_Q wound radii. */
export const WOUND_Q = 2.2;

// the runtime classes: which sets, and how many layers each set takes (2 for A and B, 1 for cloth)
const BODY = ZT_SETS.filter((s) => s[1] === 'body').map((s) => s[0]);
const CLASSES = {
  bodyA: { sets: BODY, part: 'A' },
  bodyB: { sets: BODY, part: 'B' },
  skinA: { sets: ['skin-fresh', 'skin-weeks', 'skin-months'], part: 'A' },
  skinB: { sets: ['skin-fresh', 'skin-weeks', 'skin-months'], part: 'B' },
  cloth: { sets: ZT_SETS.filter((s) => s[1] === 'cloth').map((s) => s[0]), part: 'C' },
  woundA: { sets: ['wounds'], part: 'A' }, woundB: { sets: ['wounds'], part: 'B' },
  grimeA: { sets: ['grime'], part: 'A' }, grimeB: { sets: ['grime'], part: 'B' },
};
export const ZT_CLASSES = Object.keys(CLASSES);

/**
 * Per tier: the texture arrays as [size, classes]. VRAM (RGBA8 + mips, ztexBytes): high ≈ 119 MB,
 * ultra ≈ 307 MB, cinematic ≈ 475 MB. Low keeps the procedural shading.
 */
export const ZTEX_TIERS = Object.freeze({
  low: null,
  high: [[1024, ['bodyA', 'bodyB']], [512, ['skinA', 'skinB', 'cloth', 'woundA', 'woundB', 'grimeA', 'grimeB']]],
  ultra: [[2048, ['bodyA']], [1024, ['bodyB', 'cloth', 'woundA', 'woundB']], [512, ['skinA', 'skinB', 'grimeA', 'grimeB']]],
  cinematic: [[2048, ['bodyA', 'bodyB']], [1024, ['cloth', 'skinA', 'skinB', 'woundA', 'woundB', 'grimeA', 'grimeB']]],
});
/** The phone profile (tier.js) on every tier but 'low': the bodies at 512², the rest at 256² (≈ 30 MB). */
export const ZTEX_PHONE = Object.freeze([[512, ['bodyA', 'bodyB']], [256, ['skinA', 'skinB', 'cloth', 'woundA', 'woundB', 'grimeA', 'grimeB']]]);

/**
 * The layout of a tier: groups [{ size, layers: [[class, set], ...] }] and per class its
 * group index and first layer. null on low (or an unknown table row).
 */
export function ztexLayout(tier, phone = phoneProfile()) {
  let row = ZTEX_TIERS[tier] === undefined ? ZTEX_TIERS.high : ZTEX_TIERS[tier];
  if (row && phone) row = ZTEX_PHONE;
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

/** A set file's PNG next to the game (the loader itself goes through tex-files.js textureSource). */
export function ztexFileURL(file) {
  const key = 'textures/zombies/' + file;
  try {
    return new URL('../../textures/zombies/' + file, import.meta.url).href;
  } catch {
    return key;
  }
}

// ---------------------------------------------------------------------------------------
// PNG decoding (8-bit, non-interlaced; grey, grey+alpha, RGB, RGBA)

async function inflate(bytes) {
  // (also stringified into the decode worker: keep it self-contained)
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
        w = kind === 'skin' || kind === 'body' ? p.px[pi + 2] : ac === 4 ? a.px[ai + 3] : 255;
      } else {
        r = n.px[ni]; g = n.px[ni + 1]; b = p.px[pi];
        w = kind === 'skin' || kind === 'body' ? p.px[pi + 1] : p.px[pi + 2];
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = w;
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------------------
// One map file → { w, h, ch, px }. A file is { buf | blob | url, type, png, fallback? }: a PNG goes
// through decodePNG above (exact, as baked); a download copy (JPEG, lossless WebP: tex-files.js)
// through the browser's own decoders (tex-worker.js decodeRGBA: alpha untouched; a grey + alpha
// normal map's copy is RGB = grey, alpha, 0, read at the same offsets). A copy that fails falls
// back to its PNG when there is one.

async function decodeFile(f) {
  if (f.png) return decodePNG(new Uint8Array(await texBytes(f)));
  try {
    const r = await decodeRGBA({ ...f, fallback: null }, 0);
    return { w: r.w, h: r.h, ch: 4, px: r.px };
  } catch (err) {
    if (f.fallback) return decodeFile(f.fallback);
    throw err;
  }
}

/**
 * Decode a set's three maps and pack every layer that wants them: [{ size, part }] → one
 * Uint8Array (size² RGBA) per use. Runs in the decode worker, or here when there is none.
 */
async function decodeSet(kind, uses, files) {
  const [albedo, normal, pack] = await Promise.all(['albedo', 'normal', 'pack'].map((k) => decodeFile(files[k])));
  const maps = { albedo, normal, pack };
  const out = [];
  for (const u of uses) {
    const m = { albedo: fit(maps.albedo, u.size), normal: fit(maps.normal, u.size), pack: fit(maps.pack, u.size) };
    const buf = new Uint8Array(u.size * u.size * 4);
    packLayer(buf, 0, u.size, kind, u.part, m);
    out.push(buf);
  }
  return out;
}

/** The decode worker's job (tex-worker.js: these functions run there as source). */
async function zombieSetJob(d) {
  const out = await decodeSet(d.kind, d.uses, d.files);
  return { out, transfer: out.map((b) => b.buffer) };
}

/** The decoder: the worker, else decodeSet right here (a node test). */
function makeDecoder(limit) {
  const w = makeTexWorker(zombieSetJob, [inflate, decodePNG, halve, grow, fit, packLayer, decodeFile, decodeSet], limit);
  if (!w) return { run: (kind, uses, files) => decodeSet(kind, uses, files), close() {}, worker: false };
  return {
    worker: true,
    // (a URL is fetched by the worker itself; bytes already here move over)
    run: (kind, uses, files) => w.run({ kind, uses, files }, Object.values(files).map((f) => f.buf).filter(Boolean)).catch(() => decodeSet(kind, uses, files)),
    close() { w.close(); },
  };
}

/** Sets decoded at once (each holds its three maps at full size while it is packed). */
const IN_FLIGHT = 4;
/** IN_FLIGHT, or one set at a time on the phone profile (tier.js). */
const inFlight = () => (phoneProfile() ? 1 : IN_FLIGHT);

/**
 * Load a tier's sets and build its texture arrays: the files (their download copies at the size
 * the tier uses, tex-files.js) are fetched, decoded and packed in a worker (or here, a set at a
 * time with breaks between), a few sets at once, then uploaded once. They wait for the world's
 * texture library first (textureQueue). Resolves { layout, textures: [DataArrayTexture], bytes, ms,
 * worker } or null when anything is missing or fails (the caller keeps the procedural shading).
 * @param {string} tier
 * @param {{ anisotropy?: number, fetch?: Function, signal?: { gone: boolean }, worker?: boolean }} [opts]
 *   fetch: read the PNGs through this (by ztexFileURL; the tests), no download copies, no queue
 */
export async function loadZombieTextures(tier, opts = {}) {
  const layout = ztexLayout(tier);
  if (!layout) return null;
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || typeof DecompressionStream === 'undefined') return null;
  if (!opts.fetch) await textureQueue();
  if (opts.signal && opts.signal.gone) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const dec = opts.worker === false ? { run: decodeSet, close() {}, worker: false } : makeDecoder(inFlight());
  try {
    const kinds = new Map(ZT_SETS);
    const datas = layout.groups.map((g) => new Uint8Array(g.size * g.size * 4 * g.layers.length));
    // each set's maps are decoded once and written into every layer that wants them
    const want = new Map();
    layout.groups.forEach((g, gi) => g.layers.forEach(([c, s], li) => {
      if (!want.has(s)) want.set(s, []);
      want.get(s).push({ gi, li, part: CLASSES[c].part, size: g.size });
    }));
    const getFiles = async (set, size) => {
      const files = {};
      await Promise.all(['albedo', 'normal', 'pack'].map(async (k) => {
        const name = `${set}-${k}.png`;
        if (opts.fetch) {
          const res = await doFetch(ztexFileURL(name));
          if (!res || !res.ok) throw new Error(`no ${name}`);
          files[k] = { buf: await res.arrayBuffer(), png: true };
        } else {
          files[k] = await textureSource('zombies/' + name, size);
        }
      }));
      return files;
    };
    const sets = [...want.keys()];
    let next = 0, failed = null;
    const runOne = async () => {
      while (!failed && next < sets.length) {
        const set = sets[next++];
        if (opts.signal && opts.signal.gone) { failed = failed || new Error('gone'); return; }
        const uses = want.get(set);
        try {
          const files = await getFiles(set, Math.max(...uses.map((u) => u.size)));
          const out = await dec.run(kinds.get(set), uses.map((u) => ({ size: u.size, part: u.part })), files);
          uses.forEach((u, k) => datas[u.gi].set(out[k], u.li * u.size * u.size * 4));
        } catch (err) {
          failed = failed || err;
        }
        if (!dec.worker) await tick();
      }
    };
    await Promise.all(Array.from({ length: dec.worker ? inFlight() : 1 }, runOne));
    if (failed) throw failed;
    if (opts.signal && opts.signal.gone) return null;
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
    return { layout, textures, bytes: ztexBytes(layout), ms, worker: dec.worker };
  } catch (err) {
    if (typeof console !== 'undefined' && opts.quiet !== true) console.info('zombie textures unavailable, keeping the procedural shading:', err && err.message);
    return null;
  } finally {
    dec.close();
  }
}
