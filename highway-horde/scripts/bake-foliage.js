#!/usr/bin/env node
// The photo foliage cards of the leaf atlas (render3d/world-tex.js LEAF_CELLS): `node scripts/bake-foliage.js`.
//
// Poly Haven's plant models (CC0 1.0) model every leaf and needle as geometry on photo-scanned maps, so a
// card is made by rendering them: this script downloads a model's 1K glTF (scripts/fetch-models.js has the
// loader), keeps the leaf / twig materials, renders the whole plant (one of the copies an asset lays out), a few
// copies turned about the vertical laid over each other for density, and rasterises it in software orthographically from the side
// (or from above), 4 × 4 supersampled: colour from the albedo map, lit a little from above
// by the leaves' own normals and darkened toward the inside of the clump, alpha the coverage.
//
// The cells are grey-normalised like the procedural atlas they replace (the vertex colour of each tree
// gives its species' green; the photo keeps its relative light, dark and hue), the colour under the
// transparent texels is the cell's mean (no dark fringes in the mipmaps), and they are written into
// public/textures/foliage/leaves.png: a 2048 × 1024 RGBA atlas in the procedural atlas' layout (canvas
// rows, top first), only the cells listed in CELLS filled; public/textures/foliage/foliage.json lists them
// with their sources. world-tex.js pastes them over the procedural cells once the file has arrived.
//
//   node scripts/bake-foliage.js [--cache dir]

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRetry, cached, primitives, fillNormals, decodeJpg } from './fetch-models.js';
import { encodePNG } from './bake/png.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'textures', 'foliage');
const API = 'https://api.polyhaven.com';
const CELL = 512;           // one cell of the 2048 × 1024 atlas
const SS = 4;               // supersampling

/**
 * cell → how to cut it: [col, row] in the 4 × 2 canvas grid (row 0 = top), the model, the materials to
 * draw, the clump (`r`: radius in metres around a leaf picked `pick` of the way out from the crown's
 * centre; none: the whole model), the view (`top`: looking down; else out of the crown) and a seed.
 */
export const CELLS = {
  pine: { at: [0, 0], id: 'pine_sapling_small', mats: ['pine_sapling_small_twig'], nodes: /_a$/, top: true, spins: 3, about: 'pine needles on twigs, a sapling seen from above' },
  scrub: { at: [1, 0], id: 'searsia_lucida', mats: ['searsia_lucida_leaves', 'searsia_lucida_twigs'], nodes: /_e_LOD0$/, spins: 4, about: 'a leafy shrub, another plant of the same bush, seen from the side' },
  broadA: { at: [0, 1], id: 'tree_small_02', mats: ['tree_small_02_leaves', 'tree_small_02_branches'], spins: 3, about: 'the crown of a young deciduous tree, seen from the side' },
  broadB: { at: [1, 1], id: 'island_tree_02', mats: ['island_tree_02_leaves', 'island_tree_02_branches'], spins: 3, about: 'a round broadleaf crown, seen from the side' },
  birch: { at: [3, 1], id: 'searsia_lucida', mats: ['searsia_lucida_leaves', 'searsia_lucida_twigs'], nodes: /_b_LOD0$/, spins: 3, about: 'small glossy leaves on fine twigs, a bush seen from the side' },
};

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float64Array.from({ length: 256 }, (_, i) => toLin(i / 255));

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function loadModel(id, cache) {
  const files = await fetchRetry(`${API}/files/${id}`, 'json');
  const g = files.gltf['1k'].gltf;
  const inc = g.include;
  const gl = JSON.parse((await cached(cache, id, g)).toString('utf8'));
  const bins = [];
  for (const b of gl.buffers) bins.push(await cached(cache, id, inc[Object.keys(inc).find((k) => k.endsWith(b.uri))]));
  const tex = async (ti) => {
    if (!ti) return null;
    const img = gl.images[gl.textures[ti.index].source];
    return decodeJpg(await cached(cache, id, inc[Object.keys(inc).find((k) => k.endsWith(img.uri))]));
  };
  const info = await fetchRetry(`${API}/info/${id}`, 'json');
  const used = { gltf: { url: g.url, md5: g.md5 } };
  return { gl, bins, tex, info, used, inc };
}

/** Rasterise triangles (positions already in pixel space x, y and depth z) into colour / coverage buffers. */
function raster(W, H, tris, shadeAt) {
  const col = new Float32Array(W * H * 3), dep = new Float32Array(W * H).fill(-Infinity), cov = new Uint8Array(W * H);
  for (const t of tris) {
    const [a, b, c] = t.p;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = a[2] * w0 + b[2] * w1 + c[2] * w2;
        const i = y * W + x;
        if (z <= dep[i]) continue;
        dep[i] = z;
        cov[i] = 1;
        const s = shadeAt(t, w0, w1, w2, z);
        col[i * 3] = s[0]; col[i * 3 + 1] = s[1]; col[i * 3 + 2] = s[2];
      }
    }
  }
  return { col, cov, dep };
}

async function bakeCell(name, cfg, cache) {
  const M = await loadModel(cfg.id, cache);
  const { gl } = M;
  const keep = (mi) => !cfg.mats || cfg.mats.includes(gl.materials[mi].name);
  const prims = primitives(gl, M.bins, cfg.nodes || null).filter((p) => keep(p.mat));
  for (const p of prims) fillNormals(p);
  const albedo = new Map();
  for (const p of prims) {
    if (albedo.has(p.mat)) continue;
    const pbr = gl.materials[p.mat].pbrMetallicRoughness || {};
    albedo.set(p.mat, await M.tex(pbr.baseColorTexture));
    const img = pbr.baseColorTexture ? gl.images[gl.textures[pbr.baseColorTexture.index].source] : null;
    if (img) { const k = Object.keys(M.inc).find((x) => x.endsWith(img.uri)); M.used[k] = { url: M.inc[k].url, md5: M.inc[k].md5 }; }
  }
  for (const b of gl.buffers) { const k = Object.keys(M.inc).find((x) => x.endsWith(b.uri)); M.used[k] = { url: M.inc[k].url, md5: M.inc[k].md5 }; }
  // the crown's centre and reach (over the vertices: a big tree has two million triangles)
  let cx = 0, cy = 0, cz = 0, nv = 0;
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) { cx += p.pos[i]; cy += p.pos[i + 1]; cz += p.pos[i + 2]; nv++; }
  cx /= nv; cy /= nv; cz /= nv;
  let far = 0;
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) far = Math.max(far, Math.hypot(p.pos[i] - cx, p.pos[i + 1] - cy, p.pos[i + 2] - cz));
  // the whole plant, seen from the side (or from above), `spins` copies turned about the vertical and
  // laid over each other so the card is dense where a single crown is airy
  const view = cfg.top ? [0, -1, 0] : [0, 0, -1];
  const tris = [];
  const n = cfg.spins || 1;
  for (let q = 0; q < n; q++) {
    const ang = (q / n) * Math.PI * 2 + 0.4, ca = Math.cos(ang), sa = Math.sin(ang);
    const rot = (x, y, z) => [cx + (x - cx) * ca - (z - cz) * sa, y, cz + (x - cx) * sa + (z - cz) * ca];
    for (const p of prims) {
      for (let t = 0; t < p.idx.length; t += 3) {
        const ids = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
        tris.push({
          P: ids.map((v) => rot(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2])),
          N: ids.map((v) => [p.nor[v * 3] * ca - p.nor[v * 3 + 2] * sa, p.nor[v * 3 + 1], p.nor[v * 3] * sa + p.nor[v * 3 + 2] * ca]),
          U: ids.map((v) => [p.uv[v * 2], p.uv[v * 2 + 1]]), mat: p.mat,
        });
      }
    }
  }
  // an orthonormal frame: the view along -w
  const w = view.map((v) => -v);
  const up0 = Math.abs(w[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let u = [up0[1] * w[2] - up0[2] * w[1], up0[2] * w[0] - up0[0] * w[2], up0[0] * w[1] - up0[1] * w[0]];
  let ul = Math.hypot(...u); u = u.map((x) => x / ul);
  const vv = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // bounds in the frame → a square that fits the clump with a small margin
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of tris) for (const P of t.P) {
    const x = dot(P, u), y = dot(P, vv), z = dot(P, w);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  // (fitted to the square cell on each axis, stretched by at most 1.6: a wide crown still fills its card)
  let sx = (x1 - x0) * 1.04, sy = (y1 - y0) * 1.04;
  if (sx > sy * 1.6) sy = sx / 1.6; else if (sy > sx * 1.6) sx = sy / 1.6;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const W = CELL * SS;
  const kx = W / sx, ky = W / sy;
  const proj = (P) => [(dot(P, u) - mx) * kx + W / 2, W / 2 - (dot(P, vv) - my) * ky, dot(P, w)];
  const ptris = tris.map((t) => ({ ...t, p: t.P.map(proj) }));
  const light = [0.3, 0.8, 0.5].map((x) => x / Math.hypot(0.3, 0.8, 0.5));
  const shadeAt = (t, a, b, c, z) => {
    const img = albedo.get(t.mat);
    const U = t.U[0][0] * a + t.U[1][0] * b + t.U[2][0] * c, V = t.U[0][1] * a + t.U[1][1] * b + t.U[2][1] * c;
    let r = 0.3, g = 0.4, bb = 0.2;
    if (img) {
      const ix = ((Math.floor((U - Math.floor(U)) * img.w) % img.w) + img.w) % img.w, iy = ((Math.floor((V - Math.floor(V)) * img.h) % img.h) + img.h) % img.h;
      const o = (iy * img.w + ix) * img.ch;
      r = LIN[img.data[o]]; g = LIN[img.data[o + 1]]; bb = LIN[img.data[o + 2]];
    }
    const n = [0, 1, 2].map((q) => t.N[0][q] * a + t.N[1][q] * b + t.N[2][q] * c);
    const nl = Math.hypot(...n) || 1;
    const ndl = Math.abs(dot(n, light) / nl);
    // depth into the clump: the front leaves lighter, the inside in shade
    const depth = (z1 - z) / Math.max(1e-6, z1 - z0);
    const sh = (0.62 + 0.38 * ndl) * (1 - 0.45 * depth);
    return [r * sh, g * sh, bb * sh];
  };
  const R0 = raster(W, W, ptris, shadeAt);
  // down to the cell: colour averaged over the covered samples, alpha the coverage
  const out = new Float64Array(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = (y * SS + dy) * W + x * SS + dx;
        if (!R0.cov[i]) continue;
        r += R0.col[i * 3]; g += R0.col[i * 3 + 1]; b += R0.col[i * 3 + 2]; n++;
      }
      const o = (y * CELL + x) * 4;
      if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; }
      out[o + 3] = n / (SS * SS);
    }
  }
  // coverage thickened by one texel (a needle a texel wide vanishes in the first mips) and faded out before
  // the cell's border (a card never shows a straight edge)
  {
    const A = new Float64Array(CELL * CELL);
    for (let i = 0; i < CELL * CELL; i++) A[i] = out[i * 4 + 3];
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        let m = A[y * CELL + x];
        if (x > 0) m = Math.max(m, A[y * CELL + x - 1] * 0.8);
        if (x < CELL - 1) m = Math.max(m, A[y * CELL + x + 1] * 0.8);
        if (y > 0) m = Math.max(m, A[(y - 1) * CELL + x] * 0.8);
        if (y < CELL - 1) m = Math.max(m, A[(y + 1) * CELL + x] * 0.8);
        const rx = (x + 0.5) / CELL - 0.5, ry = (y + 0.5) / CELL - 0.5;
        const r = Math.max(Math.abs(rx), Math.abs(ry)) * 0.55 + Math.hypot(rx, ry) * 0.45;
        const edge = Math.max(0, Math.min(1, (0.485 - r) / 0.06));
        const i = y * CELL + x;
        if (m > out[i * 4 + 3] && out[i * 4 + 3] === 0) {
          // (a texel the dilation covered takes a neighbour's colour)
          for (const j of [i - 1, i + 1, i - CELL, i + CELL]) if (j >= 0 && j < CELL * CELL && A[j] > 0) { out[i * 4] = out[j * 4]; out[i * 4 + 1] = out[j * 4 + 1]; out[i * 4 + 2] = out[j * 4 + 2]; break; }
        }
        out[i * 4 + 3] = m * edge;
      }
    }
  }
  // grey-normalise: the luminance relative to the cell's mean, scaled to the procedural atlas' mean shade;
  // the hue kept at 35 % (the tree's vertex colour gives the species' green, the photo its yellow-green
  // tips, darker leaves and brown twigs)
  const Yf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let mY = 0, mw = 0;
  for (let i = 0; i < CELL * CELL; i++) { const a = out[i * 4 + 3]; mY += Yf(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]) * a; mw += a; }
  mY /= mw;
  const target = toLin(170 / 255);
  const px = new Uint8Array(CELL * CELL * 4);
  for (let i = 0; i < CELL * CELL; i++) {
    const a = out[i * 4 + 3];
    let r = target, g = target, b = target;
    if (a > 0) {
      const y = Yf(out[i * 4], out[i * 4 + 1], out[i * 4 + 2]);
      const k = (y / mY) * target;
      const c = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]].map((v) => (y > 1e-6 ? v / y : 1));
      [r, g, b] = c.map((v) => k * (1 + (v - 1) * 0.35));
    }
    px[i * 4] = Math.round(toSrgb(Math.min(1, r)) * 255);
    px[i * 4 + 1] = Math.round(toSrgb(Math.min(1, g)) * 255);
    px[i * 4 + 2] = Math.round(toSrgb(Math.min(1, b)) * 255);
    // (a crisp edge for the alpha test: coverage pushed toward 0 / 1, the soft rim kept for the mips)
    px[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, (a - 0.5) * 1.6 + 0.5)) * 255);
  }
  let cover = 0;
  for (let i = 0; i < CELL * CELL; i++) cover += px[i * 4 + 3] > 127 ? 1 : 0;
  return {
    px, cover: cover / (CELL * CELL), tris: tris.length,
    source: { library: 'Poly Haven', id: cfg.id, name: M.info.name, url: `https://polyhaven.com/a/${cfg.id}`, license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', authors: M.info.authors || {}, files: M.used },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const cache = argv[0] === '--cache' ? resolve(argv[1]) : join(ROOT, '.cache', 'photo-models');
  mkdirSync(OUT, { recursive: true });
  const AW = CELL * 4, AH = CELL * 2;
  const atlas = new Uint8Array(AW * AH * 4);
  const man = { version: 1, width: AW, height: AH, cell: CELL, cells: {} };
  for (const [name, cfg] of Object.entries(CELLS)) {
    const r = await bakeCell(name, cfg, cache);
    const [cx, cy] = cfg.at;
    for (let y = 0; y < CELL; y++) atlas.set(r.px.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((cy * CELL + y) * AW + cx * CELL) * 4);
    man.cells[name] = { at: cfg.at, about: cfg.about, cover: Math.round(r.cover * 1000) / 1000, triangles: r.tris, source: r.source };
    console.log(`  ${name.padEnd(7)} ← ${cfg.id.padEnd(20)} ${r.tris} triangles, ${(r.cover * 100).toFixed(0)} % covered`);
  }
  writeFileSync(join(OUT, 'leaves.png'), encodePNG(atlas, AW, AH, 4, { level: 9 }));
  writeFileSync(join(OUT, 'foliage.json'), JSON.stringify(man, null, 1) + '\n');
  console.log('wrote textures/foliage/leaves.png and foliage.json');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
