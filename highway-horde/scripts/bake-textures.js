#!/usr/bin/env node
// Bakes the game's own texture library: `node scripts/bake-textures.js` → public/textures/.
//
// Every material of scripts/bake/materials/* is rendered at 2048² (tileable: every field wraps) and
// stored as four PNGs under public/textures/<material>/ (scripts/bake/surface.js has the layout):
//   albedo.png  sRGB colour                      normal.png  tangent normal (OpenGL, green = up)
//   rah.png     roughness / AO / height          mask.png    metalness / tint
// public/textures/manifest.json lists them with what the renderer needs (the mean colour of the
// tinted texels, the mean roughness, the element grid, the parallax depth; world-surf-bake.js).
//
// Stored size: the library keeps every material at 1024² by default, box-filtered from the 2048²
// render (4 samples per texel: the fine grain is resolved, not aliased). Stored at 2048², the four
// maps of one material take 10 – 20 MB of PNG (the grain that makes them read as real is exactly
// what a lossless format cannot squeeze), so the full library would pass 700 MB; at 1024² it is
// about a quarter of that. A recipe may ask for its own stored size (`store`).
//
// The output is a pure function of the seed: the same seed and code give the same bytes. The PNGs
// are committed; rerun this after changing a recipe.
//
//   node scripts/bake-textures.js [--size 2048] [--store 1024] [--seed 1] [--only a,b] [--out dir]
//                                 [--jobs 4] [--preview dir] [--no-write] [--list] [--fast]
//
// --fast compresses at zlib level 4 (for trying recipes; the committed set uses 9). --preview writes
// lit previews of each material (and sheet.png) to the given directory.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { encodePNG } from './bake/png.js';
import { Surface, downsampleMaps, quantizeMaps } from './bake/surface.js';
import { shade, sheet } from './bake/preview.js';
import { RECIPES, recipeTile } from './bake/materials/index.js';
import { hash3 } from './bake/noise.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_VERSION = 1;

/** Seed of one material from the library seed and its name. */
export function materialSeed(seed, name) {
  let h = 0;
  for (let k = 0; k < name.length; k++) h = (Math.imul(h, 31) + name.charCodeAt(k)) | 0;
  return hash3(seed, h, 0x5eed) % 1000003;
}

/**
 * Bake one material in memory: rendered at `size`², stored at `store`² (≤ size).
 * @returns {{ name, files: { albedo, normal, rah, mask } PNG buffers, stats, maps (stored size), full (render size), store, ms }}
 */
export function bakeOne(recipe, size, seed, o = {}) {
  const level = o.level ?? 9;
  const store = Math.min(size, recipe.store ?? o.store ?? size);
  const t0 = Date.now();
  const m = new Surface(size, recipeTile(recipe), recipe.depth ?? 10);
  recipe.bake(m, materialSeed(seed, recipe.name));
  const full = m.finish();
  const maps = quantizeMaps(downsampleMaps(full, size, size / store));
  const files = {
    albedo: encodePNG(maps.albedo, store, store, 3, { level }),
    normal: encodePNG(maps.normal, store, store, 3, { level }),
    rah: encodePNG(maps.rah, store, store, 3, { level }),
    mask: encodePNG(maps.mask, store, store, 3, { level }),
  };
  return { name: recipe.name, files, stats: full.stats, maps, full, store, ms: Date.now() - t0 };
}

/** The manifest entry of a baked material. */
export function manifestEntry(recipe, name, stats, sizes, store, size) {
  return {
    about: recipe.about || '',
    size: store,
    render: size,
    tile: Math.round(recipeTile(recipe) * 1e4) / 1e4,
    files: { albedo: `${name}/albedo.png`, normal: `${name}/normal.png`, rah: `${name}/rah.png`, mask: `${name}/mask.png` },
    bytes: Object.values(sizes).reduce((s, v) => s + v, 0),
    mean: stats.mean, meanAll: stats.meanAll, rough: stats.rough, height: stats.height, metal: stats.metal, tint: stats.tint,
    ...(recipe.cells ? { cells: recipe.cells } : null),
    ...(recipe.shift ? { shift: recipe.shift } : null),
    ...(recipe.parallax != null ? { parallax: recipe.parallax } : null),
  };
}

function parseArgs(argv) {
  const a = { size: 2048, store: 1024, seed: 1, only: null, out: join(ROOT, 'public', 'textures'), jobs: Math.max(1, Math.min(4, os.cpus().length)), preview: null, write: true, list: false, level: 9 };
  for (let k = 0; k < argv.length; k++) {
    const v = argv[k];
    if (v === '--size') a.size = Number(argv[++k]);
    else if (v === '--store') a.store = Number(argv[++k]);
    else if (v === '--seed') a.seed = Number(argv[++k]);
    else if (v === '--only') a.only = argv[++k].split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === '--out') a.out = resolve(argv[++k]);
    else if (v === '--jobs') a.jobs = Math.max(1, Number(argv[++k]));
    else if (v === '--preview') a.preview = resolve(argv[++k]);
    else if (v === '--no-write') a.write = false;
    else if (v === '--list') a.list = true;
    else if (v === '--fast') a.level = 4;
    else throw new Error(`unknown argument ${v}`);
  }
  const p2 = (n) => n >= 16 && (n & (n - 1)) === 0;
  if (!p2(a.size) || !p2(a.store)) throw new Error('--size and --store must be powers of two ≥ 16');
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.list) {
    for (const r of RECIPES) console.log(`${r.name.padEnd(20)} ${recipeTile(r).toFixed(2).padStart(5)} m  ${r.about || ''}`);
    return;
  }
  const list = a.only ? a.only.map((n) => {
    const r = RECIPES.find((x) => x.name === n);
    if (!r) throw new Error(`no material ${n}`);
    return r;
  }) : RECIPES;
  const t0 = Date.now();
  const results = new Map();
  const queue = list.map((r) => r.name);
  const jobs = Math.min(a.jobs, queue.length);
  const self = fileURLToPath(import.meta.url);
  await Promise.all(Array.from({ length: jobs }, () => new Promise((res, rej) => {
    const w = new Worker(self, { workerData: { size: a.size, store: a.store, seed: a.seed, out: a.out, write: a.write, preview: a.preview, level: a.level } });
    const next = () => w.postMessage(queue.shift() ?? null);
    w.on('message', (msg) => {
      if (msg.error) { rej(new Error(`${msg.name}: ${msg.error}`)); w.terminate(); return; }
      results.set(msg.name, msg);
      console.log(`  ${msg.name.padEnd(20)} ${String(msg.store).padStart(4)}²  ${(msg.bytes / 1e6).toFixed(2).padStart(6)} MB  ${(msg.ms / 1000).toFixed(1)} s`);
      next();
    });
    w.on('error', rej);
    w.on('exit', () => res());
    next();
  })));
  // the manifest (merged with the one there when baking a subset)
  const mPath = join(a.out, 'manifest.json');
  let man = { version: MANIFEST_VERSION, seed: a.seed, sets: {} };
  if (a.only && existsSync(mPath)) {
    try { man = JSON.parse(readFileSync(mPath, 'utf8')); } catch { /* rewrite it */ }
    man.sets = man.sets || {};
  }
  for (const r of list) {
    const res = results.get(r.name);
    man.sets[r.name] = manifestEntry(r, r.name, res.stats, res.sizes, res.store, a.size);
  }
  // (in recipe order, so the file does not churn)
  const ordered = {};
  for (const r of RECIPES) if (man.sets[r.name]) ordered[r.name] = man.sets[r.name];
  man = { version: MANIFEST_VERSION, seed: a.seed, render: a.size, bytes: Object.values(ordered).reduce((s, e) => s + e.bytes, 0), sets: ordered };
  if (a.write) {
    mkdirSync(a.out, { recursive: true });
    writeFileSync(mPath, JSON.stringify(man, null, 1) + '\n');
  }
  if (a.preview) {
    const tiles = list.map((r) => results.get(r.name).preview).filter(Boolean).map((b) => new Uint8Array(b));
    writeFileSync(join(a.preview, 'sheet.png'), sheet(tiles, 384, 6));
  }
  console.log(`baked ${list.length} materials (render ${a.size}², stored ${a.store}²) in ${((Date.now() - t0) / 1000).toFixed(1)} s; the library holds ${(man.bytes / 1e6).toFixed(1)} MB`);
}

function workerMain() {
  const { size, store, seed, out, write, preview, level } = workerData;
  parentPort.on('message', (name) => {
    if (name === null) process.exit(0);
    try {
      const recipe = RECIPES.find((x) => x.name === name);
      const r = bakeOne(recipe, size, seed, { level, store });
      if (write) {
        const dir = join(out, name);
        mkdirSync(dir, { recursive: true });
        for (const [k, buf] of Object.entries(r.files)) writeFileSync(join(dir, `${k}.png`), buf);
      }
      let small = null;
      if (preview) {
        mkdirSync(preview, { recursive: true });
        // close up: a quarter of the tile at the full render size; the whole tile from the stored maps
        writeFileSync(join(preview, `${name}-near.png`), encodePNG(shade(r.full, size, 1024, { crop: Math.min(1, 1024 / size * 2) * 0.5 }), 1024, 1024, 3, { level: 6 }));
        writeFileSync(join(preview, `${name}.png`), encodePNG(shade(r.maps, r.store, 768, { crop: 1 }), 768, 768, 3, { level: 6 }));
        small = shade(r.maps, r.store, 384, { crop: 1 });
      }
      const sizes = Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, v.length]));
      parentPort.postMessage({ name, ms: r.ms, stats: r.stats, sizes, store: r.store, bytes: Object.values(sizes).reduce((s, v) => s + v, 0), preview: small });
    } catch (err) {
      parentPort.postMessage({ name, error: String((err && err.stack) || err) });
    }
  });
}

if (!isMainThread) workerMain();
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
