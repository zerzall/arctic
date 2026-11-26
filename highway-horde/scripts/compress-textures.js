#!/usr/bin/env node
// The texture library's download format: `npm run textures:compress`.
//
// The bakers (bake-textures.js, bake-guns.js, bake-zombies.js, bake-decals.js — and anything else
// that drops PNGs into public/textures/) write lossless PNGs: the source of truth, kept as they
// are. This step writes a smaller copy of every PNG under public/textures/ next to it and lists
// them in public/textures/compressed.json, which the game reads first (render3d/tex-files.js):
//
//   opaque colour maps (…albedo, the decal sheets)   JPEG 4:4:4 (no chroma subsampling), q 93
//   opaque normal maps and packed data (…normal,     JPEG 4:4:4, q 95: every channel keeps its own
//     rah, orm, pack)                                detail (WebP's 4:2:0 would blur them together)
//   anything with a real alpha channel, masks and    WebP lossless (exact: the colour under a clear
//     other unknown maps                             alpha is kept bit for bit)
//   grey + alpha (the zombies' two-channel normals)  as RGB (grey, alpha, 0), then by its role; the
//                                                    entry says `la: true` (actor-ztex.js reads it)
//
// A map larger than 1024² also gets halved copies (2 × 2 box per channel) down to 1024²,
// `<name>@<size>.<ext>`, listed as the entry's `variants`: a tier that samples it at 1024 (guns and
// zombies on Ultra, the decals' normal sheets) downloads and decodes a quarter of it.
// A copy is used only when it is at least 10 % smaller than its PNG. Every lossy copy is decoded
// again and compared with the PNG (PSNR over all channels; the entry records it), and one that falls
// below the floor of its role is dropped for the PNG. Each entry carries the SHA-1 of its PNG:
// a PNG that changed (a re-bake, a new photo-scanned set) has a stale copy until this runs again,
// which `--check` (and tests/textures-compressed.test.js) reports, and the one-file build
// (build-standalone.js) then ships the PNG itself. Runs are incremental: a PNG whose hash and
// settings match its entry is skipped.
//
//   node scripts/compress-textures.js            convert what changed
//   node scripts/compress-textures.js --check    list stale / missing copies, exit 1 if any
//   node scripts/compress-textures.js --force    convert everything again
//   node scripts/compress-textures.js guns       only paths starting with guns/
//
// Needs ImageMagick (`convert` or `magick`, with libjpeg and libwebp) on the PATH.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { decodePNG } from './bake/png.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = process.env.HH_TEX_DIR ? resolve(process.env.HH_TEX_DIR) : join(ROOT, 'public', 'textures');
export const INDEX_FILE = 'compressed.json';
/** Bump when the rules below change: every copy is made again. */
export const RULES_VERSION = 2;

/** The role of a PNG by its name: how it is stored. */
export function roleOf(path) {
  const name = path.split('/').pop();
  if (/albedo\.png$/.test(name) || /^decals-[a-z0-9]+\.png$/.test(name)) return 'color';
  if (/normal\.png$/.test(name) || /-n\.png$/.test(name)) return 'normal';
  if (/(^|[_-])(rah|orm|pack)\.png$/.test(name)) return 'data';
  return 'exact';
}
/** JPEG quality and the PSNR floor (dB) a lossy copy must reach, per role. */
export const ROLE = {
  color: { q: 93, floor: 30 },
  normal: { q: 95, floor: 30 },
  data: { q: 95, floor: 30 },
  exact: null,
};

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');
const PREFIX = args.filter((a) => !a.startsWith('--'));

function magickBin() {
  for (const b of ['magick', 'convert']) {
    const r = spawnSync(b, ['-version'], { encoding: 'utf8' });
    if (r.status === 0 && /ImageMagick/.test(r.stdout)) return b;
  }
  return null;
}

function listPNGs(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listPNGs(p, base));
    else if (name.endsWith('.png')) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

function run(bin, argv, input) {
  return new Promise((res, rej) => {
    const p = spawn(bin, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res(Buffer.concat(out)) : rej(new Error(`${bin} ${argv.join(' ')}: ${Buffer.concat(err).toString().trim()}`))));
    p.stdin.on('error', () => {});
    p.stdin.end(input || undefined);
  });
}

/** PSNR (dB) between two pixel arrays of the same layout. */
export function psnr(a, b) {
  let se = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; se += d * d; }
  const mse = se / a.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Halve an image (2 × 2 box filter, every channel on its own: alpha never weights the colour). */
export function halve(px, w, h, ch) {
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * ch);
  for (let y = 0; y < H; y++) {
    const r0 = y * 2 * w * ch, r1 = r0 + w * ch, o = y * W * ch;
    for (let x = 0; x < W; x++) {
      const a = r0 + x * 2 * ch, b = r1 + x * 2 * ch;
      for (let c = 0; c < ch; c++) out[o + x * ch + c] = (px[a + c] + px[a + ch + c] + px[b + c] + px[b + ch + c] + 2) >> 2;
    }
  }
  return out;
}

/** Encode pixels by a role (null: lossless): { fmt, enc, q?, psnr? } or { keep: why }. */
async function encode(bin, px, w, h, pch, role) {
  const raw = pch === 4 ? 'rgba' : 'rgb';
  const input = ['-size', `${w}x${h}`, '-depth', '8', `${raw}:-`];
  const data = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
  if (role && pch === 3) {
    const enc = await run(bin, [...input, '-strip', '-sampling-factor', '1x1', '-quality', String(role.q), 'jpg:-'], data);
    const back = await run(bin, ['jpg:-', '-depth', '8', 'rgb:-'], enc);
    if (back.length !== px.length) return { keep: 'round trip size mismatch' };
    const p = psnr(px, back);
    if (p < role.floor) return { keep: `psnr ${p.toFixed(1)} below ${role.floor}` };
    return { fmt: 'jpg', enc, q: role.q, psnr: Math.round(p * 10) / 10 };
  }
  const enc = await run(bin, [...input, '-define', 'webp:lossless=true', '-define', 'webp:exact=true', '-define', 'webp:method=6', '-quality', '100', 'webp:-'], data);
  const back = await run(bin, ['webp:-', '-depth', '8', `${raw}:-`], enc);
  if (back.length !== px.length || psnr(px, back) !== Infinity) return { keep: 'lossless round trip differs' };
  return { fmt: 'webp', enc };
}

/** The smallest size a reduced copy is made for (each halving of a larger map down to it). */
export const MIN_VARIANT = 1024;

/**
 * Make the copies of one PNG: { full: { fmt, enc, q?, psnr? } | { keep }, la, size, variants:
 * [{ size, fmt, enc, ... }] } — the variants are the map halved (2 × 2 box) down to MIN_VARIANT, for
 * the tiers that never sample it at full size.
 */
async function convertOne(bin, rel, buf) {
  let img;
  try { img = decodePNG(buf); } catch (err) { return { full: { keep: `undecodable: ${err.message}` }, variants: [] }; }
  const { width: w, height: h, channels: ch } = img;
  let px = img.data;
  let la = false;
  let alpha = false;
  if (ch === 2 || ch === 4) for (let i = ch - 1; i < px.length; i += ch) if (px[i] !== 255) { alpha = true; break; }
  let pch;
  if (ch === 2) {
    // grey + alpha → RGB (grey, alpha, 0)
    const o = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 2, j += 3) { o[j] = px[i]; o[j + 1] = px[i + 1]; }
    px = o; pch = 3; la = true;
  } else if (ch === 4 && !alpha) {
    const o = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { o[j] = px[i]; o[j + 1] = px[i + 1]; o[j + 2] = px[i + 2]; }
    px = o; pch = 3;
  } else if (ch === 1) {
    const o = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i++, j += 3) { o[j] = o[j + 1] = o[j + 2] = px[i]; }
    px = o; pch = 3;
  } else pch = ch;
  const role = ROLE[roleOf(rel)];
  const full = await encode(bin, px, w, h, pch, role);
  const variants = [];
  let cw = w, chh = h, cpx = px;
  while (cw >= MIN_VARIANT * 2 && chh >= MIN_VARIANT * 2 && cw === chh) {
    cpx = halve(cpx, cw, chh, pch);
    cw >>= 1; chh >>= 1;
    const v = await encode(bin, cpx, cw, chh, pch, role);
    if (!v.keep) variants.push({ size: cw, ...v });
  }
  return { full, la, size: w, variants };
}

async function main() {
  if (!existsSync(TEX)) { console.error(`no texture folder at ${TEX}`); process.exit(2); }
  const indexPath = join(TEX, INDEX_FILE);
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { files: {} };
  if (!index.files) index.files = {};
  const all = listPNGs(TEX);
  const pngs = all.filter((p) => !PREFIX.length || PREFIX.some((x) => p.startsWith(x)));
  const stale = [];
  const hashes = new Map();
  for (const rel of pngs) {
    const h = sha1(readFileSync(join(TEX, rel)));
    hashes.set(rel, h);
    const e = index.files[rel];
    const ok = e && e.sha1 === h && e.rules === RULES_VERSION && [e.file, ...(e.variants || []).map((v) => v.file)].every((f) => existsSync(join(TEX, f)));
    if (!ok || FORCE) stale.push(rel);
  }
  // entries whose PNG is gone
  const gone = Object.keys(index.files).filter((k) => !all.includes(k));
  if (CHECK) {
    for (const r of stale) console.log(`stale: ${r}`);
    for (const r of gone) console.log(`orphan entry: ${r}`);
    console.log(stale.length || gone.length ? `${stale.length + gone.length} texture copies out of date: run npm run textures:compress` : `all ${pngs.length} texture copies up to date`);
    process.exit(stale.length || gone.length ? 1 : 0);
  }
  for (const k of gone) {
    const e = index.files[k];
    for (const f of [e.file, ...(e.variants || []).map((v) => v.file)]) if (f !== k && existsSync(join(TEX, f))) rmSync(join(TEX, f));
    delete index.files[k];
  }
  if (!stale.length) { console.log(`all ${pngs.length} texture copies up to date`); if (gone.length) save(); return; }
  const bin = magickBin();
  if (!bin) { console.error('compress-textures: ImageMagick (convert / magick) is not installed; the PNGs stay in use'); process.exit(2); }
  console.log(`compressing ${stale.length} of ${pngs.length} PNGs with ${bin}…`);
  let i = 0, done = 0, pngBytes = 0, outBytes = 0;
  const t0 = Date.now();
  const width = Math.max(1, Math.min(8, cpus().length));
  function save() {
    const files = {};
    for (const k of Object.keys(index.files).sort()) files[k] = index.files[k];
    writeFileSync(indexPath, JSON.stringify({
      version: 1,
      about: 'The download copies of the PNGs here (scripts/compress-textures.js): PNG path → the file the game loads, the SHA-1 of the PNG it was made from. Generated: do not edit.',
      files,
    }, null, 1) + '\n');
  }
  const worker = async () => {
    while (i < stale.length) {
      const rel = stale[i++];
      const buf = readFileSync(join(TEX, rel));
      const old = index.files[rel];
      let r;
      try { r = await convertOne(bin, rel, buf); } catch (err) { r = { full: { keep: String(err.message || err).slice(0, 200) }, variants: [] }; }
      const base = rel.replace(/\.png$/, '');
      if (old) for (const f of [old.file, ...(old.variants || []).map((v) => v.file)]) if (f !== rel && existsSync(join(TEX, f))) rmSync(join(TEX, f));
      let entry;
      const f0 = r.full;
      if (f0.keep || f0.enc.length > buf.length * 0.9) {
        entry = { file: rel, sha1: hashes.get(rel), rules: RULES_VERSION, bytes: buf.length };
        if (f0.keep) console.log(`  ${rel}: keeps the PNG (${f0.keep})`);
      } else {
        const file = `${base}.${f0.fmt}`;
        writeFileSync(join(TEX, file), f0.enc);
        entry = { file, sha1: hashes.get(rel), rules: RULES_VERSION, bytes: f0.enc.length, png: buf.length };
        if (f0.q) { entry.q = f0.q; entry.psnr = f0.psnr; }
      }
      if (r.size) entry.size = r.size;
      // (a kept PNG stays grey + alpha: its reader decodes it as it always did)
      if (r.la && entry.file !== rel) entry.la = true;
      if (r.variants.length && entry.file !== rel) {
        entry.variants = r.variants.map((v) => {
          const file = `${base}@${v.size}.${v.fmt}`;
          writeFileSync(join(TEX, file), v.enc);
          const o = { size: v.size, file, bytes: v.enc.length };
          if (v.q) { o.q = v.q; o.psnr = v.psnr; }
          return o;
        });
      }
      index.files[rel] = entry;
      pngBytes += buf.length; outBytes += entry.bytes;
      done++;
      if (done % 20 === 0 || done === stale.length) {
        console.log(`  ${done} / ${stale.length}: ${(pngBytes / 1e6).toFixed(1)} MB of PNG → ${(outBytes / 1e6).toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        save();
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  save();
  let a = 0, b = 0;
  for (const rel of all) { const e = index.files[rel]; if (!e) continue; a += statSync(join(TEX, rel)).size; b += e.bytes; }
  console.log(`library: ${(a / 1e6).toFixed(1)} MB of PNG, ${(b / 1e6).toFixed(1)} MB to download`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
