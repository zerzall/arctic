#!/usr/bin/env node
// Bakes the decal library (graffiti, posters, signs, damage, clutter) into 4096² atlas sheets, all
// drawn in code by our own rasteriser (scripts/decals/*.js; no canvas, no dependencies):
//
//   public/textures/decals/decals-<sheet>.png     albedo, straight alpha (sRGB)
//   public/textures/decals/decals-<sheet>-n.png   normal map (RGB, tangent space: +x right, +y DOWN
//                                                 the image) and roughness (A)
//   public/js/render3d/decals-manifest.js         the atlas rects, world sizes, surfaces and tags
//
//   node scripts/bake-decals.js                   bake everything (about a minute)
//   node scripts/bake-decals.js --preview <dir> [--only <prefix>]
//                                                 one PNG per decal (albedo over grey | lit relief) for review
//   node scripts/bake-decals.js --list            the decal ids
//   node scripts/bake-decals.js --manifest        rewrite only the manifest (world sizes, tags; same pixels)
//
// Deterministic: the same code always writes the same bytes (tests/decals.test.js re-bakes a few
// decals and compares). Every decal is seeded by its id.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, rngOf, seedOf } from './decals/raster.js';
import { encodePNG } from './decals/png.js';
import { register as regPaper } from './decals/recipes-paper.js';
import { register as regSigns } from './decals/recipes-signs.js';
import { register as regPaint } from './decals/recipes-paint.js';
import { register as regDamage } from './decals/recipes-damage.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'public', 'textures', 'decals');
export const MANIFEST = join(ROOT, 'public', 'js', 'render3d', 'decals-manifest.js');
export const SHEET = 4096;
export const SHEETS = ['a', 'b', 'c', 'd'];
// (the recipes' groups: every group may land on any sheet, they share one material)
export const GROUPS = ['paper', 'signs', 'paint', 'damage'];
const GUTTER = 8;
const SNAP = 16;

/**
 * The registry. A recipe: { id, sheet, px: [w, h] (inner pixels), size: [w, h] (world units),
 * surf: 'wall' | 'floor' | 'any', tags, variants: ['clean', 'worn', ...], draw(c, rng, variant) }.
 * Each variant becomes its own decal: `<id>` for the first, `<id>.<variant>` for the others.
 */
export function recipes() {
  const list = [];
  const R = (id, opts, draw) => {
    const vars = opts.variants || ['clean'];
    vars.forEach((v, i) => {
      list.push({
        id: i === 0 ? id : `${id}.${v}`, base: id, variant: v, sheet: opts.sheet, px: opts.px, size: opts.size,
        surf: opts.surf || 'wall', tags: (opts.tags || []).concat(i === 0 ? [] : [v]), draw,
      });
    });
  };
  regPaper(R);
  regSigns(R);
  regPaint(R);
  regDamage(R);
  const seen = new Set();
  for (const r of list) {
    if (seen.has(r.id)) throw new Error(`duplicate decal id ${r.id}`);
    seen.add(r.id);
    if (!GROUPS.includes(r.sheet)) throw new Error(`${r.id}: unknown group ${r.sheet}`);
  }
  return list;
}

/** Draw one decal; returns its canvas (inner size). */
export function drawDecal(r) {
  const c = new Canvas(r.px[0], r.px[1]);
  const rng = rngOf(seedOf(r.id));
  r.draw(c, rng, r.variant);
  return c;
}

/**
 * Skyline packing of every decal into the sheets (first fit, tallest first): sets r.at = [x, y]
 * (outer rect incl. gutter) and r.sheetIndex. Returns the used height of each sheet.
 */
export function pack(list) {
  const cols = SHEET / SNAP;
  const skies = SHEETS.map(() => new Int32Array(cols));
  const order = list.slice().sort((a, b) => (b.px[1] - a.px[1]) || (b.px[0] - a.px[0]) || (a.id < b.id ? -1 : 1));
  for (const r of order) {
    const w = Math.ceil((r.px[0] + GUTTER * 2) / SNAP), h = Math.ceil((r.px[1] + GUTTER * 2) / SNAP);
    let placed = false;
    for (let s = 0; s < skies.length && !placed; s++) {
      const sky = skies[s];
      let best = -1, bestY = Infinity;
      for (let x = 0; x + w <= cols; x++) {
        let y = 0;
        for (let k = x; k < x + w; k++) if (sky[k] > y) y = sky[k];
        if (y < bestY) { bestY = y; best = x; }
      }
      if (best < 0 || (bestY + h) * SNAP > SHEET) continue;
      for (let k = best; k < best + w; k++) sky[k] = bestY + h;
      r.at = [best * SNAP, bestY * SNAP];
      r.sheetIndex = s;
      placed = true;
    }
    if (!placed) throw new Error(`the decal sheets are full at ${r.id}`);
  }
  return skies.map((sky) => Math.max(...sky) * SNAP);
}

/**
 * Straight colour + push-pull fill of the transparent pixels (so mip levels and bilinear taps at
 * the edges do not pull in black), normals from the height field, roughness. Writes into the sheet
 * buffers at (ox, oy), padding the gutter by edge extension.
 */
export function compose(c, albedo, normal, stride, ox, oy) {
  const { w, h } = c;
  const W = w + GUTTER * 2, H = h + GUTTER * 2;
  // straight colour with weights, gutter included
  const col = new Float32Array(W * H * 3), wt = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4, a = c.c[j + 3];
    const o = (y + GUTTER) * W + x + GUTTER;
    if (a > 1e-4) { col[o * 3] = c.c[j]; col[o * 3 + 1] = c.c[j + 1]; col[o * 3 + 2] = c.c[j + 2]; wt[o] = a; }
  }
  pushPull(col, wt, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = y * W + x;
    const ix = x - GUTTER, iy = y - GUTTER;
    const inside = ix >= 0 && iy >= 0 && ix < w && iy < h;
    const a = inside ? Math.min(1, c.c[(iy * w + ix) * 4 + 3]) : 0;
    const p = ((oy + y) * stride + ox + x) * 4;
    const k = a > 1e-4 ? 1 / a : 1;
    const premul = a > 1e-4;
    for (let ch = 0; ch < 3; ch++) {
      const v = premul ? c.c[(iy * w + ix) * 4 + ch] * k : col[o * 3 + ch];
      albedo[p + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    albedo[p + 3] = Math.round(a * 255);
    // normal (Sobel on the height field) and roughness
    let nx = 0, ny = 0, rough = 0.85;
    if (inside) {
      const H0 = (xx, yy) => c.ht[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
      nx = -((H0(ix + 1, iy - 1) + 2 * H0(ix + 1, iy) + H0(ix + 1, iy + 1)) - (H0(ix - 1, iy - 1) + 2 * H0(ix - 1, iy) + H0(ix - 1, iy + 1))) / 8;
      ny = -((H0(ix - 1, iy + 1) + 2 * H0(ix, iy + 1) + H0(ix + 1, iy + 1)) - (H0(ix - 1, iy - 1) + 2 * H0(ix, iy - 1) + H0(ix + 1, iy - 1))) / 8;
      rough = c.ro[iy * w + ix];
    }
    const L = Math.hypot(nx, ny, 1);
    normal[p] = Math.round((nx / L * 0.5 + 0.5) * 255);
    normal[p + 1] = Math.round((ny / L * 0.5 + 0.5) * 255);
    normal[p + 2] = Math.round((1 / L * 0.5 + 0.5) * 255);
    normal[p + 3] = Math.round(Math.max(0.02, Math.min(1, rough)) * 255);
  }
}

/** Fill colour where the weight is ~0 from coarser, weight-averaged levels. In place. */
function pushPull(col, wt, W, H) {
  const levels = [{ col, wt, W, H }];
  while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
    const p = levels[levels.length - 1];
    const w2 = Math.max(1, Math.ceil(p.W / 2)), h2 = Math.max(1, Math.ceil(p.H / 2));
    const c2 = new Float32Array(w2 * h2 * 3), t2 = new Float32Array(w2 * h2);
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const o = y * p.W + x, q = (y >> 1) * w2 + (x >> 1), a = p.wt[o];
      if (a <= 0) continue;
      c2[q * 3] += p.col[o * 3] * a; c2[q * 3 + 1] += p.col[o * 3 + 1] * a; c2[q * 3 + 2] += p.col[o * 3 + 2] * a;
      t2[q] += a;
    }
    for (let q = 0; q < w2 * h2; q++) if (t2[q] > 0) { c2[q * 3] /= t2[q]; c2[q * 3 + 1] /= t2[q]; c2[q * 3 + 2] /= t2[q]; t2[q] = Math.min(1, t2[q]); }
    levels.push({ col: c2, wt: t2, W: w2, H: h2 });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l], q = levels[l + 1];
    for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
      const o = y * p.W + x;
      const a = Math.min(1, p.wt[o]);
      if (a >= 0.999) continue;
      const s = (y >> 1) * q.W + (x >> 1);
      for (let ch = 0; ch < 3; ch++) p.col[o * 3 + ch] = p.col[o * 3 + ch] * a + q.col[s * 3 + ch] * (1 - a);
      p.wt[o] = 1;
    }
  }
}

/** Bake everything. Returns { sheets: { name: { albedo, normal, used } }, list }. */
export function bakeAll(log = () => {}) {
  const list = recipes();
  const sheets = {};
  const usedAll = pack(list);
  SHEETS.forEach((name, si) => {
    const mine = list.filter((r) => r.sheetIndex === si);
    const used = usedAll[si];
    const albedo = new Uint8Array(SHEET * SHEET * 4), normal = new Uint8Array(SHEET * SHEET * 4);
    // an empty normal texel is flat and rough
    for (let i = 0; i < SHEET * SHEET; i++) { normal[i * 4] = 128; normal[i * 4 + 1] = 128; normal[i * 4 + 2] = 255; normal[i * 4 + 3] = 217; }
    const t0 = Date.now();
    for (const r of mine) {
      const c = drawDecal(r);
      compose(c, albedo, normal, SHEET, r.at[0], r.at[1]);
    }
    log(`sheet ${name}: ${mine.length} decals, ${used} px of ${SHEET} used, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    sheets[name] = { albedo, normal, used };
  });
  return { sheets, list };
}

/** The manifest module's source. */
export function manifestSource(list) {
  const tagMap = {};
  const rows = list.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => {
    for (const t of r.tags) (tagMap[t] = tagMap[t] || []).push(r.id);
    const s = r.sheetIndex;
    const u0 = r.at[0] + GUTTER, v0 = r.at[1] + GUTTER;
    const surf = r.surf === 'floor' ? 1 : r.surf === 'wall' ? 2 : 3;
    return `  ${JSON.stringify(r.id)}: [${s}, ${u0}, ${v0}, ${r.px[0]}, ${r.px[1]}, ${r.size[0]}, ${r.size[1]}, ${surf}],`;
  });
  const tags = Object.keys(tagMap).sort().map((t) => `  ${JSON.stringify(t)}: ${JSON.stringify(tagMap[t].sort())},`);
  return `// GENERATED by scripts/bake-decals.js: do not edit by hand (re-run the baker).
//
// The decal library's atlas: DECALS[id] = [sheet, x, y, w, h (pixels of the sheet, y down), world w,
// world h (units, 1 ≈ 3 cm), surfaces (1 floor, 2 wall, 3 both)]. Sheets are DECAL_SHEET_SIZE²:
// textures/decals/decals-<name>.png (albedo + alpha) and decals-<name>-n.png (normal + roughness).

export const DECAL_SHEET_SIZE = ${SHEET};
export const DECAL_SHEETS = ${JSON.stringify(SHEETS)};
export const DECAL_COUNT = ${list.length};

export const DECALS = {
${rows.join('\n')}
};

/** Decal ids by tag (category, surface, variant). */
export const DECAL_TAGS = {
${tags.join('\n')}
};
`;
}

// ---- preview -------------------------------------------------------------------------------

function preview(dir, only) {
  mkdirSync(dir, { recursive: true });
  const list = recipes().filter((r) => !only || r.id.startsWith(only));
  for (const r of list) {
    const t0 = Date.now();
    const c = drawDecal(r);
    const { w, h } = c;
    const W = w * 2 + 8;
    const px = new Uint8Array(W * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      px[p] = px[p + 1] = px[p + 2] = 92; px[p + 3] = 255;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4, a = Math.min(1, c.c[j + 3]);
      const H0 = (xx, yy) => c.ht[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
      const nx = -(H0(x + 1, y) - H0(x - 1, y)) / 2, ny = -(H0(x, y + 1) - H0(x, y - 1)) / 2;
      const L = Math.hypot(nx, ny, 1);
      // light from the upper left
      const lit = Math.max(0, (nx * -0.5 + ny * -0.5 + 0.7) / L / Math.hypot(0.5, 0.5, 0.7));
      for (let ch = 0; ch < 3; ch++) {
        const bg = 92 / 255, v = c.c[j + ch] + bg * (1 - a);
        px[(y * W + x) * 4 + ch] = Math.round(Math.min(1, v) * 255);
        const v2 = (c.c[j + ch] * lit * 1.1 + bg * (1 - a));
        px[(y * W + x + w + 8) * 4 + ch] = Math.round(Math.min(1, v2) * 255);
      }
    }
    writeFileSync(join(dir, r.id + '.png'), encodePNG(W, h, px, 3));
    console.log(`${r.id} ${w}x${h} ${Date.now() - t0} ms`);
  }
}

// ---- main ------------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--list')) {
    for (const r of recipes()) console.log(r.id, r.sheet, r.px.join('x'), r.size.join('x'), r.surf, r.tags.join(','));
  } else if (args.includes('--manifest')) {
    // (only the manifest: the packing depends on the pixel sizes alone, so a change of world size,
    // tags or surfaces needs no re-draw)
    const list = recipes();
    pack(list);
    writeFileSync(MANIFEST, manifestSource(list));
    console.log(`wrote ${MANIFEST} (${list.length} decals)`);
  } else if (opt('--preview')) {
    preview(opt('--preview'), opt('--only'));
  } else {
    const t0 = Date.now();
    const { sheets, list } = bakeAll((s) => console.log(s));
    mkdirSync(OUT_DIR, { recursive: true });
    for (const name of SHEETS) {
      const a = encodePNG(SHEET, SHEET, sheets[name].albedo);
      const n = encodePNG(SHEET, SHEET, sheets[name].normal);
      writeFileSync(join(OUT_DIR, `decals-${name}.png`), a);
      writeFileSync(join(OUT_DIR, `decals-${name}-n.png`), n);
      console.log(`decals-${name}.png ${(a.length / 1e6).toFixed(1)} MB, -n ${(n.length / 1e6).toFixed(1)} MB`);
    }
    writeFileSync(MANIFEST, manifestSource(list));
    console.log(`${list.length} decals, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
