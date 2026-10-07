#!/usr/bin/env node
// Bakes the zombies' high-resolution texture sets into public/textures/zombies/ (our own art,
// procedurally painted: no photos, no show assets). Plain node, no dependencies; PNGs are
// written with node's zlib and the bake is deterministic (same code → same pixels; every map's
// pixel hash goes into manifest.json, which tests/zombie-textures.test.js checks).
//
//   node scripts/bake-zombies.js                     every set, painted at 2048²
//   node scripts/bake-zombies.js --size 256 --out /tmp/z --only skin-fresh,face-a
//
// Sets (scripts/zbake/*): skin in three stages of decay (fresh-turned, weeks, months), the five
// special infected (bloater, spitter, brute, screamer, boss), six faces, a scalp, eleven
// fabrics, a wound atlas and a grime / stain set. Each set is three maps:
//   <set>-albedo.png   sRGB colour (RGBA where the set has a coverage: faces, wounds, scalp, grime)
//   <set>-normal.png   tangent-space normal x, y (grey + alpha; z = √(1 − x² − y²)), +v up
//   <set>-pack.png     R roughness · G ambient occlusion · B per kind (skin: subsurface
//                      thickness; face: "absolute" paint that ignores the skin tone; cloth:
//                      bleach; wound: wetness; grime: holes)
// Everything is painted at --size (2048); a map is written at the largest size the runtime ever
// samples it at (actor-ztex.js ZTEX_TIERS, box-filtered down: supersampled), so the download
// carries no texel that is never shown: the decay-stage skins in full, the specials' colour and
// pack in full and their normals at half, the faces, scalp, fabrics, wounds and grime at half
// (a face spans ~600 texels of its 1024² frame, more than a 4K screen shows of a head at arm's
// length; a 4096² face would not pay off).
// The runtime (public/js/render3d/actor-ztex.js) packs them into two or three texture arrays.
// Rows are written top-down with +v up, so the files look the right way round.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, normals, toSrgb8, to8 } from './zbake/lib.js';
import { SKIN_SETS } from './zbake/skin.js';
import { FACE_SETS } from './zbake/face.js';
import { CLOTH_SETS } from './zbake/cloth.js';
import { MISC_SETS } from './zbake/misc.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STAGES = new Set(['skin-fresh', 'skin-weeks', 'skin-months']);
/** Written size of each map as a fraction of the painted size (see the header). */
function shipScale(name, kind) {
  if (kind === 'skin') return STAGES.has(name) ? { albedo: 1, normal: 1, pack: 1 } : { albedo: 1, normal: 0.5, pack: 1 };
  return { albedo: 0.5, normal: 0.5, pack: 0.5 };
}

/** Every set: { name, kind, fn(N), ship }. The order is the manifest's (and the runtime's). */
export const SETS = [
  ...Object.entries(SKIN_SETS).map(([name, fn]) => ({ name, kind: 'skin', fn })),
  ...Object.entries(FACE_SETS).map(([name, fn]) => ({ name, kind: 'face', fn })),
  ...Object.entries(CLOTH_SETS).map(([name, fn]) => ({ name, kind: 'cloth', fn })),
  ...Object.entries(MISC_SETS).map(([name, s]) => ({ name, kind: s.kind, fn: s.fn })),
].map((s) => ({ ...s, ship: shipScale(s.name, s.kind) }));

/**
 * Turn a generator's result into the three 8-bit maps (rows top-down):
 * { alb: Rgb, alpha?, h | nx+ny, rough, ao, b?, thick?, nStrength, wrap?, linear? } → { albedo, normal, pack } as { ch, px }.
 */
export function encodeSet(res, N) {
  const n = N * N;
  const wrap = res.wrap !== false;
  const nm = res.nx ? { nx: res.nx, ny: res.ny } : normals(res.h, N, res.nStrength ?? 3, wrap);
  const hasA = !!res.alpha;
  const albedo = new Uint8Array(n * (hasA ? 4 : 3));
  const normal = new Uint8Array(n * 2);
  const pack = new Uint8Array(n * 3);
  const bch = res.b || res.thick;
  // (masks are stored linear; colours sRGB)
  const enc = res.linear ? to8 : toSrgb8;
  for (let y = 0; y < N; y++) {
    // file rows top-down; field rows bottom-up (+v up)
    const fy = N - 1 - y;
    for (let x = 0; x < N; x++) {
      const i = fy * N + x, o = y * N + x;
      if (hasA) {
        albedo[o * 4] = enc(res.alb.r[i]); albedo[o * 4 + 1] = enc(res.alb.g[i]); albedo[o * 4 + 2] = enc(res.alb.b[i]); albedo[o * 4 + 3] = to8(res.alpha[i]);
      } else {
        albedo[o * 3] = enc(res.alb.r[i]); albedo[o * 3 + 1] = enc(res.alb.g[i]); albedo[o * 3 + 2] = enc(res.alb.b[i]);
      }
      normal[o * 2] = to8(nm.nx[i] * 0.5 + 0.5); normal[o * 2 + 1] = to8(nm.ny[i] * 0.5 + 0.5);
      pack[o * 3] = to8(res.rough[i]);
      pack[o * 3 + 1] = to8(res.ao ? res.ao[i] : 1);
      pack[o * 3 + 2] = to8(bch ? bch[i] : 0);
    }
  }
  return { albedo: { ch: hasA ? 4 : 3, px: albedo }, normal: { ch: 2, px: normal }, pack: { ch: 3, px: pack } };
}

/** Halve an 8-bit image (2×2 box filter). */
export function halve(px, N, ch) {
  const H = N >> 1, out = new Uint8Array(H * H * ch);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      const a = ((y * 2) * N + x * 2) * ch, b = a + N * ch, o = (y * H + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = (px[a + c] + px[a + ch + c] + px[b + c] + px[b + ch + c] + 2) >> 2;
    }
  }
  return out;
}

const pixelHash = (px) => createHash('sha256').update(px).digest('hex').slice(0, 16);

/** Bake one set painted at N → { maps: { albedo, normal, pack } as { ch, px, size }, hashes }. */
export function bakeSet(set, N) {
  const res = set.fn(N);
  const enc = encodeSet(res, N);
  const maps = {}, hashes = {};
  for (const k of ['albedo', 'normal', 'pack']) {
    let px = enc[k].px, size = N;
    const want = Math.max(16, Math.round(N * set.ship[k]));
    while (size > want) { px = halve(px, size, enc[k].ch); size >>= 1; }
    maps[k] = { ch: enc[k].ch, px, size };
    hashes[k] = pixelHash(px);
  }
  return { maps, hashes };
}

/** Bake a set and write its three PNGs → its manifest entry. */
export function writeSet(set, SIZE, OUT) {
  const { maps, hashes } = bakeSet(set, SIZE);
  const files = {};
  for (const k of ['albedo', 'normal', 'pack']) {
    const m = maps[k];
    const png = encodePNG(m.size, m.size, m.ch, m.px);
    const file = `${set.name}-${k}.png`;
    writeFileSync(join(OUT, file), png);
    files[k] = { file, size: m.size, bytes: png.length };
  }
  return { name: set.name, kind: set.kind, files, hashes };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
  const SIZE = parseInt(opt('size', '2048'), 10);
  const OUT = resolve(opt('out', join(ROOT, 'public/textures/zombies')));
  const ONLY = opt('only', '') ? new Set(opt('only', '').split(',')) : null;
  // (sets bake in parallel on worker threads; the result does not depend on how many)
  const JOBS = Math.max(1, parseInt(opt('jobs', String(Math.min(4, availableParallelism()))), 10));
  mkdirSync(OUT, { recursive: true });
  const todo = SETS.filter((s) => !ONLY || ONLY.has(s.name));
  const t0 = Date.now();
  const entries = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, todo.length) }, () => new Promise((done, fail) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { SIZE, OUT } });
    const feed = () => { if (next < todo.length) w.postMessage(todo[next++].name); else { w.terminate(); done(); } };
    w.on('message', (m) => { entries.set(m.entry.name, m.entry); console.log(`${m.entry.name.padEnd(16)} ${(m.ms / 1000).toFixed(1)}s`); feed(); });
    w.on('error', fail);
    feed();
  })));
  // (a partial bake updates its sets' entries in an existing manifest of the same size)
  let old = null;
  try { old = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')); } catch { old = null; }
  if (old && old.size === SIZE) for (const s of old.sets) if (!entries.has(s.name)) entries.set(s.name, s);
  const manifest = { size: SIZE, sets: SETS.filter((s) => entries.has(s.name)).map((s) => entries.get(s.name)) };
  const bytes = manifest.sets.filter((s) => !ONLY || ONLY.has(s.name)).reduce((b, s) => b + s.files.albedo.bytes + s.files.normal.bytes + s.files.pack.bytes, 0);
  if (!ONLY || (old && old.size === SIZE)) writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`baked ${todo.length} sets at ${SIZE}² in ${((Date.now() - t0) / 1000).toFixed(0)} s (${(bytes / 1e6).toFixed(1)} MB) → ${OUT}`);
}

if (!isMainThread && workerData && workerData.OUT) {
  parentPort.on('message', (name) => {
    const t = Date.now();
    const entry = writeSet(SETS.find((s) => s.name === name), workerData.SIZE, workerData.OUT);
    parentPort.postMessage({ entry, ms: Date.now() - t });
  });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
