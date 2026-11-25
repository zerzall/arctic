// Fabrics (scripts/bake-zombies.js): eleven real cloths for the dead, from photographed, CC0 scans
// (Poly Haven, https://polyhaven.com — see public/textures/CREDITS.md): denim, a plaid flannel,
// cotton jersey, the thin cotton of a hospital gown, a uniform's synthetic shirting, military plain
// weave, a worn work twill, poplin shirting, wool herringbone suiting, sweatshirt melange, a crepe
// dress fabric. Each scan's colour, normal (OpenGL), roughness and occlusion maps are fetched once
// (into $ZBAKE_CACHE or the system temp dir), resampled so a tile holds a whole number of the scan's
// repeats at its real size (a tile spans 16 model units, 48 cm), then worn: sun-bleached blotches
// and a faded thread or two (pack B, "bleach"). Holes, blood, mud and stains are the runtime's (the
// grime set, actor-zmat.js), shared by every fabric.
//
// The albedo is a relative brightness (0.5 = the garment's own colour, which the runtime takes from
// the zombie's look), so one tile serves every colour: plaid, herringbone and melange keep their
// pattern in it.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Rgb, fbm, smooth, clamp01 } from './lib.js';

const CACHE = process.env.ZBAKE_CACHE || join(tmpdir(), 'hh-zbake-cache');
const TILE_MM = 480;

/** Fabric → Poly Haven asset id (CC0); the scan's real width comes from its info (millimetres). */
export const FABRICS = {
  'cloth-denim': { id: 'denim_fabric_03' },
  'cloth-flannel': { id: 'fabric_pattern_05' },
  'cloth-tee': { id: 'cotton_jersey' },
  'cloth-gown': { id: 'rough_linen' },
  'cloth-police': { id: 'terlenka' },
  'cloth-military': { id: 'book_pattern' },
  'cloth-work': { id: 'denim_fabric_06' },
  'cloth-shirt': { id: 'stretch_poplin' },
  'cloth-suit': { id: 'poly_wool_herringbone' },
  'cloth-hoodie': { id: 'jogging_melange' },
  'cloth-dress': { id: 'crepe_georgette' },
};

const MAPS = { diff: 'Diffuse', nor: 'nor_gl', rough: 'Rough', ao: 'AO' };

async function fetchCached(url) {
  const file = join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
  if (existsSync(file)) return readFile(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  return buf;
}

/** A scan's maps (2k JPEGs) → { diff, nor, rough, ao } as { w, h, data RGBA } (ao may be null). */
export async function loadScan(id) {
  const files = JSON.parse((await fetchCached(`https://api.polyhaven.com/files/${id}`)).toString('utf8'));
  const info = JSON.parse((await fetchCached(`https://api.polyhaven.com/info/${id}`)).toString('utf8'));
  const jpeg = (await import('jpeg-js')).default;
  const out = { mm: (info.dimensions && info.dimensions[0]) || 500 };
  for (const [k, m] of Object.entries(MAPS)) {
    const src = files[m] || (k === 'diff' ? files.col_01 || files.col1 || files.col_1 : null);
    const f = src && (src['2k'] || src['1k']);
    const url = f && f.jpg && f.jpg.url;
    if (!url) { out[k] = null; continue; }
    out[k] = jpeg.decode(await fetchCached(url), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  }
  return out;
}

const s2l = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** Bilinear sample of channel ch (0..3) at (u, v) in repeats (wrapping), rows top-down. */
function sample(img, u, v, ch) {
  const w = img.width, h = img.height, d = img.data;
  const x = ((u % 1) + 1) % 1 * w - 0.5, y = ((v % 1) + 1) % 1 * h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const X0 = (x0 + w) % w, X1 = (x0 + 1 + w) % w, Y0 = (y0 + h) % h, Y1 = (y0 + 1 + h) % h;
  const a = d[(Y0 * w + X0) * 4 + ch], b = d[(Y0 * w + X1) * 4 + ch], c = d[(Y1 * w + X0) * 4 + ch], e = d[(Y1 * w + X1) * 4 + ch];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/** One fabric at N² → the encodeSet record (linear relative brightness, normal, rough, ao, bleach). */
export async function paintFabric(name, N) {
  const F = FABRICS[name];
  const scan = await loadScan(F.id);
  const K = Math.max(1, Math.round(TILE_MM / scan.mm));     // the scan's repeats across a tile
  const n = N * N;
  const lum = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), rough = new Float32Array(n), ao = new Float32Array(n), bleach = new Float32Array(n);
  // supersample 2×2 per texel when the scan has more pixels per repeat than the texel grid
  const ss = scan.diff.width * K > N ? 2 : 1;
  let sum = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // field rows bottom-up (+v up): row y is the scan's row N - 1 - y
      let L = 0, X = 0, Y = 0, R = 0, A = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const u = ((x + (sx + 0.5) / ss) / N) * K, v = ((N - 1 - y + (sy + 0.5) / ss) / N) * K;
        L += 0.2126 * s2l(sample(scan.diff, u, v, 0)) + 0.7152 * s2l(sample(scan.diff, u, v, 1)) + 0.0722 * s2l(sample(scan.diff, u, v, 2));
        X += sample(scan.nor, u, v, 0) / 127.5 - 1; Y += sample(scan.nor, u, v, 1) / 127.5 - 1;
        R += sample(scan.rough, u, v, 0) / 255; A += scan.ao ? sample(scan.ao, u, v, 0) / 255 : 1;
      }
      const q = ss * ss, i = y * N + x;
      lum[i] = L / q; nx[i] = X / q; ny[i] = Y / q; rough[i] = R / q; ao[i] = A / q;
      sum += lum[i];
    }
  }
  const mean = sum / n;
  const alb = new Rgb(N);
  // wear: sun-bleached blotches and streaks (tileable noise at the tile's period)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, u = x / N, v = y / N;
      const blot = fbm(u, v, 3, 4, 101 + name.length);
      const streak = fbm(u * 0.5, v * 4, 2, 3, 7 + name.length);
      bleach[i] = clamp01(smooth(0.58, 0.8, blot) * 0.8 + smooth(0.7, 0.85, streak) * 0.3);
      // relative brightness: the garment's colour at 0.5 (the weave's light and shade around it)
      const rel = clamp01((lum[i] / mean) * 0.5);
      alb.r[i] = alb.g[i] = alb.b[i] = rel;
      // (the scans' normal maps are gentle; cloth on a dead body is creased and coarse)
      const k = 1.35;
      nx[i] *= k; ny[i] *= k;
      const l = Math.hypot(nx[i], ny[i]);
      if (l > 0.92) { nx[i] *= 0.92 / l; ny[i] *= 0.92 / l; }
      rough[i] = clamp01(0.55 + rough[i] * 0.45);
      ao[i] = clamp01(0.4 + ao[i] * 0.6);
    }
  }
  return { alb, nx, ny, rough, ao, b: bleach, linear: true };
}

/** The sets: name → async fn(N). */
export const FABRIC_SETS = Object.fromEntries(Object.keys(FABRICS).map((name) => [name, (N) => paintFabric(name, N)]));
