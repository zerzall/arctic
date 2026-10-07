#!/usr/bin/env node
// Bakes the gun materials (SPEC §7.5 "Gun materials and skins"): tileable PBR texture sets drawn
// in code (scripts/guns/*.js: noise, cellular grain, strokes; no canvas, no dependencies; PNGs
// written with node's zlib), one set per material family of shared/gun-finish.js, one per skin
// pattern, and the shared ageing overlay:
//
//   public/textures/guns/<family>_albedo.png      albedo, sRGB RGB
//   public/textures/guns/<family>_normal.png      tangent-space normal (RGB; +x = u, +y = v, the image rows)
//   public/textures/guns/<family>_orm.png         R ambient occlusion, G roughness, B metalness (linear)
//   public/textures/guns/skin_<pattern>_*.png     the same for a skin pattern; the albedo's alpha = coverage
//   public/textures/guns/wear.png                 R scratches, G edge-chip breakup, B fingerprints, A grime
//
//   node scripts/bake-guns.js                     bake everything (a few minutes; --jobs N workers, default 3)
//   node scripts/bake-guns.js --only walnut,skin_gold,wear   just these
//   node scripts/bake-guns.js --size 512          every set at this size (review; the game wants the real sizes)
//   node scripts/bake-guns.js --preview <dir>     also a review sheet per set: albedo | lit relief | roughness
//   node scripts/bake-guns.js --list              the set names
//
// Deterministic: every set is seeded by its name; the same code writes the same bytes
// (tests/gun-textures.test.js bakes small sets twice and compares).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { encodePNG } from './guns/png.js';
import { normalMap, cavity, srgbBytes, bytes, rngOf, seedOf, clamp01, blur } from './guns/field.js';
import { FAMILY_RECIPES, wearRecipe } from './guns/recipes-base.js';
import { SKIN_RECIPES } from './guns/recipes-skins.js';
import { GUN_FAMILIES, SKIN_PATTERNS, SKIN_SIZE, GUN_WEAR_FILE } from '../public/js/shared/gun-finish.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'public', 'textures', 'guns');
export const WEAR_SIZE = 2048;

/** Every set: { name, kind: 'family' | 'skin' | 'wear', id, size }. */
export function sets() {
  const out = GUN_FAMILIES.map((f) => ({ name: f.id, kind: 'family', id: f.id, size: f.size }));
  for (const p of SKIN_PATTERNS) out.push({ name: 'skin_' + p, kind: 'skin', id: p, size: SKIN_SIZE });
  out.push({ name: GUN_WEAR_FILE, kind: 'wear', id: GUN_WEAR_FILE, size: WEAR_SIZE });
  return out;
}

/**
 * Bake one set at size n. Returns { files: { '<file>.png': Buffer }, maps } (maps: the raw bytes
 * for previews).
 */
export function bakeSet(set, n = set.size) {
  const seed = seedOf(set.name);
  const rng = rngOf(seed);
  const files = {};
  if (set.kind === 'wear') {
    const w = wearRecipe(n, rng, seed);
    const px = bytes([w.R, w.G, w.B, w.A], n);
    files[`${set.name}.png`] = encodePNG(n, n, 4, px);
    return { files, maps: { wear: px } };
  }
  const r = set.kind === 'family' ? FAMILY_RECIPES[set.id](n, rng, seed) : SKIN_RECIPES[set.id](n, rng, seed);
  const nominal = set.kind === 'family' ? 2048 : 1024;
  const k = n / nominal;
  // heights are in texels of the nominal bake: scale them so the slopes hold at any size
  const h = r.height;
  // a texel-wide softening of every channel: detail finer than ~3 texels is lost in the mips at
  // any viewing distance anyway, and the smoother bytes keep the PNGs a third the size
  const soft = Math.max(0, Math.round(k * (r.soft ?? 1)));
  if (soft) {
    blur(h, n, soft, 1);
    for (const f of r.albedo) blur(f, n, soft, 1);
    // (roughness and AO hold the meso scale only: the grain's own variation is in the normals)
    if (r.rough instanceof Float32Array) blur(r.rough, n, soft * 2, 1);
  }
  const nrm = normalMap(h, n, k);
  const hm = soft ? blur(new Float32Array(h), n, soft * 2, 1) : h;
  const ao = cavity(hm, n, Math.max(1, Math.round((r.aoR || 3) * k)), (r.aoK ?? 1) * 0.35 * k);
  if (r.ao) for (let i = 0; i < ao.length; i++) ao[i] *= r.ao[i];
  const metal = typeof r.metal === 'number' ? new Float32Array(n * n).fill(r.metal) : r.metal;
  const alb = srgbBytes(r.albedo[0], r.albedo[1], r.albedo[2], n);
  const orm = bytes([ao, r.rough, metal], n);
  // quantise: the normals of grainy finishes (crystals, stipple, bead-blast: noise at the texel
  // scale) to 4-level steps (about 0.9 degrees), the rest to 2; AO and roughness to 4 steps (1.6 %).
  // A third smaller PNGs; nothing a lit surface shows.
  quantNormals(nrm, r.grain ? 4 : 2);
  for (let i = 0; i < orm.length; i += 3) { orm[i] = Math.min(255, Math.round(orm[i] / 4) * 4); orm[i + 1] = Math.min(255, Math.round(orm[i + 1] / 4) * 4); }
  const prefix = set.name;
  if (set.kind === 'skin') {
    const rgba = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      rgba[i * 4] = alb[i * 3]; rgba[i * 4 + 1] = alb[i * 3 + 1]; rgba[i * 4 + 2] = alb[i * 3 + 2];
      rgba[i * 4 + 3] = Math.round(clamp01(r.cover[i]) * 255);
    }
    files[`${prefix}_albedo.png`] = encodePNG(n, n, 4, rgba);
  } else {
    files[`${prefix}_albedo.png`] = encodePNG(n, n, 3, alb);
  }
  files[`${prefix}_normal.png`] = encodePNG(n, n, 3, nrm);
  files[`${prefix}_orm.png`] = encodePNG(n, n, 3, orm);
  return { files, maps: { alb, nrm, orm } };
}

/** Snap a normal map's x / y bytes to multiples of q (round to nearest) and rebuild z. In place. */
function quantNormals(nrm, q) {
  if (q <= 1) return;
  for (let i = 0; i < nrm.length; i += 3) {
    const x = Math.min(255, Math.round(nrm[i] / q) * q), y = Math.min(255, Math.round(nrm[i + 1] / q) * q);
    const nx = x / 127.5 - 1, ny = y / 127.5 - 1;
    nrm[i] = x; nrm[i + 1] = y;
    nrm[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.5 + 0.5) * 255);
  }
}

/** Review sheet: a 512² crop of albedo | the relief lit from the top left with a specular glint | roughness. */
function previewSheet(maps, n) {
  const C = Math.min(512, n), W = C * 3;
  const out = new Uint8Array(W * C * 3);
  const L = [-0.45, -0.55, 0.7], ll = Math.hypot(...L);
  const toLin = (v) => Math.pow(v / 255, 2.2);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const i = y * n + x;
      const o = (y * W + x) * 3;
      out[o] = maps.alb[i * 3]; out[o + 1] = maps.alb[i * 3 + 1]; out[o + 2] = maps.alb[i * 3 + 2];
      const nx = maps.nrm[i * 3] / 127.5 - 1, ny = maps.nrm[i * 3 + 1] / 127.5 - 1, nz = maps.nrm[i * 3 + 2] / 127.5 - 1;
      const d = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
      const rough = maps.orm[i * 3 + 1] / 255, metal = maps.orm[i * 3 + 2] / 255, ao = maps.orm[i * 3] / 255;
      // half vector toward a viewer straight above
      const hx = L[0] / ll, hy = L[1] / ll, hz = L[2] / ll + 1, hl = Math.hypot(hx, hy, hz);
      const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
      const sp = Math.pow(nh, 2 / Math.max(0.002, rough ** 4) + 2) * (1 - rough) * 0.8;
      for (let c = 0; c < 3; c++) {
        const a = toLin(maps.alb[i * 3 + c]);
        const v = (a * (1 - metal) * (d * 0.9 + 0.15) * ao + sp * (metal * a * 2 + (1 - metal) * 0.06));
        out[o + C * 3 + c] = Math.round(Math.pow(clamp01(v * 1.6), 1 / 2.2) * 255);
      }
      out[o + C * 6] = out[o + C * 6 + 1] = out[o + C * 6 + 2] = Math.round(rough * 255);
    }
  }
  return encodePNG(W, C, 3, out);
}

function runSet(set, size, previewDir) {
  const n = size || set.size;
  const t0 = Date.now();
  const { files, maps } = bakeSet(set, n);
  let bytesOut = 0;
  for (const [name, buf] of Object.entries(files)) {
    writeFileSync(join(OUT_DIR, name), buf);
    bytesOut += buf.length;
  }
  if (previewDir && maps.alb) writeFileSync(join(previewDir, `${set.name}.png`), previewSheet(maps, n));
  return { name: set.name, ms: Date.now() - t0, bytes: bytesOut };
}

// ---- worker side ----
if (!isMainThread && workerData && workerData.hhGunBake) {
  const all = sets();
  parentPort.on('message', (m) => {
    if (m === 'exit') { process.exit(0); }
    const set = all.find((s) => s.name === m.name);
    try {
      parentPort.postMessage({ ok: true, ...runSet(set, workerData.size, workerData.preview) });
    } catch (err) {
      parentPort.postMessage({ ok: false, name: m.name, err: String(err && err.stack || err) });
    }
  });
}

// ---- CLI ----
const isMain = isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  if (args.includes('--list')) {
    for (const s of sets()) console.log(`${s.name}\t${s.kind}\t${s.size}`);
    process.exit(0);
  }
  const only = opt('--only') ? opt('--only').split(',') : null;
  const size = opt('--size') ? Number(opt('--size')) : 0;
  const preview = opt('--preview') ? resolve(opt('--preview')) : null;
  const jobs = Math.max(1, Math.min(cpus().length, Number(opt('--jobs') || 3)));
  const todo = sets().filter((s) => !only || only.includes(s.name));
  if (!todo.length) { console.error('nothing to bake'); process.exit(2); }
  mkdirSync(OUT_DIR, { recursive: true });
  if (preview) mkdirSync(preview, { recursive: true });
  const t0 = Date.now();
  // big sets first so the workers finish together
  const queue = todo.slice().sort((a, b) => b.size - a.size);
  let total = 0, failed = 0, running = 0;
  await new Promise((done) => {
    const workers = [];
    const next = (w) => {
      const s = queue.shift();
      if (!s) { w.postMessage('exit'); if (--running === 0) done(); return; }
      w.postMessage({ name: s.name });
    };
    for (let k = 0; k < Math.min(jobs, queue.length); k++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { hhGunBake: true, size, preview } });
      running++;
      w.on('message', (r) => {
        if (r.ok) { total += r.bytes; console.log(`${r.name.padEnd(16)} ${(r.bytes / 1e6).toFixed(2).padStart(6)} MB  ${(r.ms / 1000).toFixed(1)} s`); } else { failed++; console.error(`${r.name} FAILED\n${r.err}`); }
        next(w);
      });
      w.on('error', (e) => { failed++; console.error(e); if (--running === 0) done(); });
      workers.push(w);
      next(w);
    }
  });
  console.log(`baked ${todo.length} sets, ${(total / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${OUT_DIR}`);
  process.exit(failed ? 1 : 0);
}
