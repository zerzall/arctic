#!/usr/bin/env node
// Replaces sets of the baked texture library (public/textures/, scripts/bake-textures.js) with real
// photo-scanned PBR materials from Poly Haven (CC0 1.0): `node scripts/fetch-photo-textures.js`.
//
// For each set in PHOTO below it downloads the material's 2K JPG maps (diffuse, OpenGL normal,
// AO / roughness / metal "arm", displacement) from dl.polyhaven.org into a cache, and packs them into
// exactly the library's own format (scripts/bake/surface.js has the layout):
//   albedo.png  sRGB colour            normal.png  tangent normal, OpenGL (green = up = +v)
//   rah.png     roughness / AO / height (0 = deepest)   mask.png  metalness / tint
// at the library's 1024², quantised like the baker's output. The tile of a set covers a fixed size
// in the world (manifest `tile`, metres; the geometry's DET_TILE): the photo is box-filtered down,
// never cropped, and repeated `k` times across the tile, k = the whole number of the photo's real
// size that fits best — so the tiling stays seamless and the scale stays close to real.
//
// Art direction: the photo's mean luminance is matched to the baked set it replaces (the lighting
// was tuned against those) and its chroma pulled part of the way toward it, so a map keeps its
// palette (a dusty US highway town, Sandstone's sun-bleached desert town). The tint mask (where the
// object's own colour replaces the set's: paint, a brick's body) keeps the replaced set's mean
// amount, optionally following the height (brick faces take the colour, mortar keeps its own).
//
// Deterministic and re-runnable: the same downloaded files give the same bytes. The manifest records
// each file's URL and md5; a later run refuses files whose md5 differs (pass --update to accept new
// versions). Sets not listed here are left untouched; so is everything a set does not own.
//
//   node scripts/fetch-photo-textures.js [--only a,b] [--cache dir] [--update] [--list] [--fast]
//
// The cache defaults to .cache/photo-textures/ under highway-horde/ (ignored by git).
// Licence and credits: public/textures/CREDITS.md (written by this script).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { encodePNG } from './bake/png.js';
import { toLin, toSrgb, quantizeMaps } from './bake/surface.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'public', 'textures');
const STORE = 1024;
const API = 'https://api.polyhaven.com';

const ANY = [0.43, 0.29];
const NONE = [0, 0];
/** Element layouts the photo does not share: no per-element toning, a light large-scale tone blend instead. */
const FLAT_CELLS = [0, 0, 0, -0.3];

/**
 * set → the Poly Haven material that replaces it and how to pack it:
 *   id         Poly Haven asset id
 *   shift      the tile-breaking shift (ANY on organic surfaces; NONE where the photo's own elements
 *              — bricks, boards, ribs, tiles — would not line up with a shifted copy)
 *   cells      element grid override (FLAT_CELLS for element photos; omitted → the surface's default)
 *   chroma     how far the chroma is pulled to the replaced set's (0 = the photo's own, 1 = the old)
 *   desat      how much of the photo's hue variation is flattened to its mean hue (sets that mostly
 *              take the object's own colour: the paint's blotches must not tint a yellow bus green)
 *   tintH      the tint follows the height by this gain (brick faces vs mortar)
 *   metal      [max, saturation below which a texel counts as bare metal] (galvanising, tread plate)
 *   about      what the set now is
 */
export const PHOTO = {
  brick_red: { id: 'red_brick', shift: NONE, cells: FLAT_CELLS, chroma: 0.3, tintH: 2.5, about: 'red clay brick wall in running bond, photo-scanned' },
  brick_yellow: { id: 'yellow_bricks', shift: NONE, cells: FLAT_CELLS, chroma: 0.4, tintH: 2.5, about: 'old yellow stock brick wall, photo-scanned' },
  cinder_block: { id: 'concrete_block_wall_03', shift: NONE, cells: FLAT_CELLS, chroma: 0.6, tintH: 1.5, about: 'concrete block (CMU) wall, photo-scanned' },
  concrete: { id: 'dirty_concrete', shift: ANY, chroma: 0.5, about: 'dirty poured concrete wall with stains, photo-scanned' },
  concrete_dam: { id: 'concrete', shift: NONE, cells: [0, 0, 0, -0.6], chroma: 0.5, about: 'board-formed concrete with vertical form marks (dam), photo-scanned' },
  concrete_slab: { id: 'concrete_floor_worn_001', shift: ANY, chroma: 0.5, about: 'worn concrete floor slab, photo-scanned' },
  runway: { id: 'hangar_concrete_floor', shift: ANY, chroma: 0.5, about: 'stained hangar / apron concrete, photo-scanned' },
  sidewalk: { id: 'concrete_pavement', shift: NONE, cells: FLAT_CELLS, chroma: 0.5, about: 'concrete sidewalk slabs, photo-scanned' },
  stucco: { id: 'white_stucco_02', desat: 0.5, shift: ANY, chroma: 0.5, about: 'rough stucco render, photo-scanned' },
  plaster: { id: 'worn_plaster_wall', desat: 0.4, shift: ANY, chroma: 0.5, about: 'worn plaster wall with flaked patches, photo-scanned' },
  plaster_bleached: { id: 'coral_fort_wall_01', shift: ANY, chroma: 0.5, about: 'sun-bleached lime plaster on an old fort wall, photo-scanned' },
  adobe: { id: 'rough_plaster_broken', shift: ANY, chroma: 0.4, about: 'broken mud / lime render over stone, photo-scanned' },
  asphalt: { id: 'worn_asphalt', shift: ANY, chroma: 0.6, about: 'worn asphalt road surface, photo-scanned' },
  grass: { id: 'sparse_grass', shift: ANY, chroma: 0.5, about: 'sparse, patchy grass over soil, photo-scanned' },
  dirt: { id: 'brown_mud_dry', shift: ANY, chroma: 0.4, about: 'dry packed earth with crumbs, photo-scanned' },
  mud: { id: 'brown_mud_02', shift: ANY, chroma: 0.4, about: 'wet churned mud, photo-scanned' },
  gravel: { id: 'ground_grey', shift: ANY, chroma: 0.4, about: 'grey crushed-aggregate ground, photo-scanned' },
  ballast: { id: 'rock_ground', shift: ANY, chroma: 0.4, about: 'rocky crushed-stone ground (rail ballast), photo-scanned' },
  sand: { id: 'sand_01', shift: ANY, chroma: 0.4, about: 'compacted, trampled sand, photo-scanned' },
  rock: { id: 'rock_boulder_dry', shift: ANY, chroma: 0.4, about: 'dry weathered boulder rock face, photo-scanned' },
  sandstone: { id: 'cliff_side', shift: ANY, chroma: 0.3, about: 'layered sandstone cliff face, photo-scanned' },
  cracked_earth: { id: 'mud_cracked_dry_03', shift: ANY, chroma: 0.4, about: 'dry cracked mud plates, photo-scanned' },
  metal_painted: { id: 'blue_metal_plate', desat: 0.85, shift: ANY, chroma: 0.8, about: 'painted sheet steel with wear and streaks, photo-scanned' },
  corrugated: { id: 'corrugated_iron', desat: 0.6, shift: NONE, chroma: 0.6, about: 'corrugated iron sheet, photo-scanned' },
  corrugated_rust: { id: 'rusty_corrugated_iron', shift: NONE, chroma: 0.3, metal: [0.75, 0.12], about: 'galvanised corrugated iron rusting through, photo-scanned' },
  metal_roof: { id: 'box_profile_metal_sheet', desat: 0.5, shift: NONE, cells: FLAT_CELLS, chroma: 0.6, about: 'box-profile metal roof sheet, photo-scanned' },
  steel_rusted: { id: 'rusty_metal_05', shift: ANY, chroma: 0.3, about: 'rusted steel plate, photo-scanned' },
  rail_rust: { id: 'rust_coarse_01', shift: ANY, chroma: 0.3, about: 'coarse rust on steel, photo-scanned' },
  diamond_plate: { id: 'metal_plate', shift: NONE, chroma: 0.5, metal: [0.85, 0.14], about: 'worn steel diamond tread plate, photo-scanned' },
  planks: { id: 'weathered_planks', shift: NONE, chroma: 0.5, about: 'weathered wooden boards, photo-scanned' },
  siding: { id: 'brown_planks_07', desat: 0.4, shift: NONE, chroma: 0.6, about: 'weathered lap siding boards, photo-scanned' },
  shutter_blue: { id: 'blue_painted_planks', shift: NONE, chroma: 0.3, about: 'sun-faded blue painted boards (shutters), photo-scanned' },
  bark: { id: 'bark_brown_02', shift: ANY, chroma: 0.4, about: 'tree bark, photo-scanned' },
  shingles: { id: 'grey_roof_tiles_02', shift: NONE, cells: FLAT_CELLS, chroma: 0.6, tintH: 1, about: 'grey slate roof tiles, photo-scanned' },
  terracotta: { id: 'roof_tiles_14', shift: NONE, cells: FLAT_CELLS, chroma: 0.3, tintH: 1, about: 'clay barrel roof tiles, photo-scanned' },
  linoleum: { id: 'old_linoleum_flooring_01', shift: NONE, chroma: 0.7, about: 'old patterned linoleum flooring, photo-scanned' },
  carpet: { id: 'dirty_carpet', shift: ANY, cells: FLAT_CELLS, chroma: 0.6, about: 'dirty commercial carpet, photo-scanned' },
  drywall: { id: 'ceiling_interior', desat: 0.6, shift: ANY, chroma: 0.6, about: 'painted interior wall / ceiling stipple, photo-scanned' },
  wallpaper: { id: 'decrepit_wallpaper', shift: NONE, chroma: 0.4, about: 'decrepit peeling patterned wallpaper, photo-scanned' },
  terrazzo: { id: 'terrazzo_tiles', shift: NONE, cells: FLAT_CELLS, chroma: 0.5, about: 'terrazzo floor tiles, photo-scanned' },
  marble: { id: 'marble_01', shift: NONE, cells: FLAT_CELLS, chroma: 0.5, about: 'polished stone floor slabs, photo-scanned' },
  tile_hospital: { id: 'interior_tiles', shift: NONE, cells: FLAT_CELLS, chroma: 0.6, about: 'white glazed wall tiles, photo-scanned' },
  tile_metro: { id: 'long_white_tiles', shift: NONE, cells: FLAT_CELLS, chroma: 0.5, about: 'long white glazed subway tiles, photo-scanned' },
  tile_ceramic: { id: 'floor_tiles_08', shift: NONE, cells: FLAT_CELLS, chroma: 0.6, about: 'unglazed square floor tiles, photo-scanned' },
};

/**
 * New sets (no baked set before them): the surfaces of props, vehicles, furniture and trees that used to
 * borrow a building material (a crate drawn with the siding's planks, a cone with the tarp's weave, a car
 * with a blue steel plate). Each draws its own surface id (world-surf-gen.js DET, a library-only id) and
 * keeps the photo's own colour and luminance; the fields are the ones above plus
 *   det        the surface name it draws
 *   tile       metres one tile of the set covers (= DET_TILE / 32)
 *   tint       how much of the object's own colour replaces the photo's (0..1; the mask's mean)
 *   lum        optional linear luminance the photo's mean is scaled to (else its own)
 */
export const PHOTO_NEW = {
  crate_wood: { id: 'rough_wood', det: 'crate', tile: 1.0, tint: 0.75, desat: 0.3, shift: ANY, about: 'rough-sawn lumber (crates, pallets, sawhorses), photo-scanned' },
  plywood: { id: 'plywood', det: 'plywood', tile: 1.0, tint: 0.55, shift: ANY, about: 'plywood sheet face (boarded windows, barricades), photo-scanned' },
  osb: { id: 'oriented_strand_board', det: 'osb', tile: 2.5, tint: 0.4, shift: ANY, about: 'oriented strand board (boarded doors, site hoarding), photo-scanned' },
  paint_metal: { id: 'green_metal_rust', det: 'paintmetal', tile: 1.0, tint: 0.92, desat: 0.92, shift: ANY, about: 'painted steel with scratches, chips and rust spots (drums, bins, cylinders, machines), photo-scanned' },
  paint_rust: { id: 'rusty_painted_metal', det: 'paintrust', tile: 2.2, tint: 0.55, desat: 0.75, shift: ANY, about: 'paint flaking off rusting steel (old drums, dumpsters, wrecks), photo-scanned' },
  car_paint: { id: 'container_side', det: 'carpaint', tile: 2.0, tint: 0.97, desat: 0.97, shift: ANY, about: 'painted body steel with road dust and streaks (car bodies), photo-scanned' },
  burlap: { id: 'hessian_230', det: 'burlap', tile: 0.27, tint: 0.7, desat: 0.4, shift: ANY, about: 'coarse hessian / burlap weave (sandbags, sacks), photo-scanned' },
  kraft: { id: 'hessian_380', det: 'cardboard', tile: 0.54, tint: 0.85, desat: 0.5, shift: ANY, lum: 0.3, about: 'fine kraft-paper fibre (cardboard boxes; a fine hessian scan read at paper scale), photo-scanned' },
  leather: { id: 'fabric_leather_01', det: 'leather', tile: 0.4, tint: 0.9, desat: 0.6, shift: ANY, about: 'worn leather with a seam (seats, sofas, bags), photo-scanned' },
  linen: { id: 'rough_linen', det: 'linen', tile: 0.27, tint: 0.95, desat: 0.9, shift: ANY, about: 'rough linen / upholstery weave (mattresses, cushions, clothes), photo-scanned' },
  veneer: { id: 'kitchen_wood', det: 'veneer', tile: 0.6, tint: 0.6, shift: ANY, about: 'worn wood veneer (furniture, counters, shelves, doors), photo-scanned' },
  bark_pine: { id: 'pine_bark', det: 'pinebark', tile: 2.0, tint: 0.5, shift: ANY, about: 'plated pine bark (pines and spruces), photo-scanned' },
  plastic_worn: { id: 'weathered_pvc_tank', det: 'plasticworn', tile: 1.0, tint: 0.95, desat: 0.95, shift: ANY, about: 'weathered moulded plastic with streaks and grime (cones, bins, tanks, coolers), photo-scanned' },
};

// ---- helpers -----------------------------------------------------------------------------------

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const q8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
const md5 = (b) => createHash('md5').update(b).digest('hex');

async function fetchRetry(url, kind = 'buffer') {
  let err;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'highway-horde-texture-fetch' } });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return kind === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { err = e; await new Promise((res) => setTimeout(res, 1000 * 2 ** a)); }
  }
  throw err;
}

/** The 2K JPG maps of an asset: { diff, nor, arm|ao+rough, disp } → { url, md5 } (nor: OpenGL if offered). */
async function resolveFiles(id) {
  const j = await fetchRetry(`${API}/files/${id}`, 'json');
  const pick = (k) => (j[k] && j[k]['2k'] && j[k]['2k'].jpg) || null;
  const f = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm'), ao: pick('AO'), rough: pick('Rough'), disp: pick('Displacement') };
  let dx = false;
  if (!f.nor) { f.nor = pick('nor_dx'); dx = true; }
  if (!f.diff || !f.nor) throw new Error(`${id}: no 2K diffuse / normal`);
  const out = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k] = { url: v.url, md5: v.md5 };
  if (out.arm) { delete out.ao; delete out.rough; }
  return { files: out, dx };
}

async function download(cache, id, map, file) {
  const dir = join(cache, id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file.url.split('/').pop());
  if (existsSync(p)) {
    const b = readFileSync(p);
    if (md5(b) === file.md5) return b;
  }
  const b = await fetchRetry(file.url);
  if (md5(b) !== file.md5) throw new Error(`${id}/${map}: md5 mismatch on download`);
  writeFileSync(p, b);
  return b;
}

function decodeJpg(buf) {
  const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 2048, maxResolutionInMP: 300 });
  const ch = d.data.length / (d.width * d.height);
  return { w: d.width, h: d.height, ch, data: d.data };
}

/**
 * A photo a few texels off square (the fabric scans): its top-left power-of-two square. (A woven or
 * fibrous surface loses only the seam's few texels of continuity.)
 */
function squareOf(img) {
  let n = 1;
  while (n * 2 <= Math.min(img.w, img.h)) n *= 2;
  const data = new Uint8Array(n * n * img.ch);
  for (let y = 0; y < n; y++) data.set(img.data.subarray(y * img.w * img.ch, (y * img.w + n) * img.ch), y * n * img.ch);
  return { w: n, h: n, ch: img.ch, data };
}

/**
 * Box-filter a square image down by the integer factor f with `fn(acc, src, p)` channel handling,
 * then repeat the result k × k times into an n² tile. (f divides the size, so the result tiles.)
 */
function packTile(img, n, k, comps, per) {
  if (img.w !== img.h) img = squareOf(img);
  const m = n / k;                 // texels of one repeat
  const f = img.w / m;
  if (!Number.isInteger(f) || f < 1) throw new Error(`size ${img.w} does not reduce to ${m}`);
  const one = new Float64Array(m * m * comps);
  const acc = new Float64Array(comps);
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      acc.fill(0);
      for (let dy = 0; dy < f; dy++) {
        let p = ((y * f + dy) * img.w + x * f) * img.ch;
        for (let dx = 0; dx < f; dx++, p += img.ch) per(acc, img.data, p);
      }
      const q = (y * m + x) * comps;
      for (let c = 0; c < comps; c++) one[q + c] = acc[c] / (f * f);
    }
  }
  const out = new Float64Array(n * n * comps);
  for (let y = 0; y < n; y++) {
    const sy = y % m;
    for (let x = 0; x < n; x++) {
      const s = (sy * m + (x % m)) * comps, d = (y * n + x) * comps;
      for (let c = 0; c < comps; c++) out[d + c] = one[s + c];
    }
  }
  return out;
}

const LIN = Float64Array.from({ length: 256 }, (_, v) => toLin(v / 255));

/** Ambient occlusion from a height field when the photo has none: how far each texel lies below its neighbourhood. */
function aoFromHeight(h, n) {
  const blur = (src, r) => {
    const t = new Float64Array(n * n), o = new Float64Array(n * n), w = 2 * r + 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let d = -r; d <= r; d++) s += src[y * n + ((x + d + n) % n)]; t[y * n + x] = s / w; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0; for (let d = -r; d <= r; d++) s += t[((y + d + n) % n) * n + x]; o[y * n + x] = s / w; }
    return o;
  };
  const ao = new Float64Array(n * n).fill(1);
  for (const [r, wgt] of [[3, 0.6], [12, 0.6]]) {
    const b = blur(h, r);
    for (let i = 0; i < n * n; i++) ao[i] -= wgt * Math.max(0, b[i] - h[i]);
  }
  return ao;
}

/** Build one set's four maps and its stats. */
export function packSet(name, cfg, old, imgs, dx, k) {
  const n = STORE, NN = n * n;
  // albedo, averaged in linear light
  const alb = packTile(imgs.diff, n, k, 3, (a, s, p) => { a[0] += LIN[s[p]]; a[1] += LIN[s[p + 1]]; a[2] += LIN[s[p + 2]]; });
  // normal, as vectors (renormalised below)
  const nor = packTile(imgs.nor, n, k, 3, (a, s, p) => { a[0] += s[p] / 127.5 - 1; a[1] += (s[p + 1] / 127.5 - 1) * (dx ? -1 : 1); a[2] += s[p + 2] / 127.5 - 1; });
  const g1 = (img) => packTile(img, n, k, 1, (a, s, p) => { a[0] += s[p] / 255; });
  let ao, rough, metalSrc = null;
  if (imgs.arm) {
    const arm = packTile(imgs.arm, n, k, 3, (a, s, p) => { a[0] += s[p] / 255; a[1] += s[p + 1] / 255; a[2] += s[p + 2] / 255; });
    ao = new Float64Array(NN); rough = new Float64Array(NN); metalSrc = new Float64Array(NN);
    for (let i = 0; i < NN; i++) { ao[i] = arm[i * 3]; rough[i] = arm[i * 3 + 1]; metalSrc[i] = arm[i * 3 + 2]; }
  } else {
    rough = imgs.rough ? g1(imgs.rough) : new Float64Array(NN).fill(0.8);
    ao = imgs.ao ? g1(imgs.ao) : null;
  }
  // height: the displacement stretched to 0..1 between its 0.5th and 99.5th percentiles
  let h = imgs.disp ? g1(imgs.disp) : null;
  if (h) {
    const sorted = Float64Array.from(h).sort();
    const lo = sorted[Math.floor(NN * 0.005)], hi = sorted[Math.floor(NN * 0.995)];
    const sc = hi - lo > 1e-4 ? 1 / (hi - lo) : 0;
    for (let i = 0; i < NN; i++) h[i] = sc ? clamp01((h[i] - lo) * sc) : 0.5;
  } else {
    h = new Float64Array(NN);
    for (let i = 0; i < NN; i++) h[i] = clamp01(0.5 + (alb[i * 3] + alb[i * 3 + 1] + alb[i * 3 + 2]) - 0.3);
  }
  if (!ao) ao = aoFromHeight(h, n);

  // colour: the photo's mean luminance onto the old set's, its chroma part of the way to the old's
  const Y = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < NN; i++) { mr += alb[i * 3]; mg += alb[i * 3 + 1]; mb += alb[i * 3 + 2]; }
  mr /= NN; mg /= NN; mb /= NN;
  // (a new set has no baked look to match: its own colour, at `lum` when given)
  const own = [mr, mg, mb].map((v) => (cfg.lum ? v * cfg.lum / Y(mr, mg, mb) : v));
  const oldM = old.meanAll || old.mean || own;
  const yNew = Y(mr, mg, mb), yOld = Y(...oldM);
  const t = cfg.chroma ?? 0.5;
  const gain = [0, 1, 2].map((c) => {
    const cn = [mr, mg, mb][c] / yNew, co = oldM[c] / yOld;            // chroma (colour / luminance)
    const want = Math.exp(Math.log(cn) * (1 - t) + Math.log(co) * t);   // blended chroma
    return (want / cn) * (yOld / yNew);
  });
  // (renormalise: the chroma blend must not move the luminance)
  const yAfter = Y(mr * gain[0], mg * gain[1], mb * gain[2]);
  for (let c = 0; c < 3; c++) gain[c] *= yOld / yAfter;

  const albedo = new Uint8Array(NN * 3), normal = new Uint8Array(NN * 3), rah = new Uint8Array(NN * 3), mask = new Uint8Array(NN * 3);
  let hMean = 0;
  for (let i = 0; i < NN; i++) hMean += h[i];
  hMean /= NN;
  const baseTint = old.tint ?? 0.7;
  const ds = cfg.desat || 0;
  const cm = [mr * gain[0], mg * gain[1], mb * gain[2]].map((v) => v / yOld);   // mean chroma
  for (let i = 0; i < NN; i++) {
    const p = i * 3;
    let lr = alb[p] * gain[0], lg = alb[p + 1] * gain[1], lb = alb[p + 2] * gain[2];
    if (ds) {
      const y = Y(lr, lg, lb);
      lr += (y * cm[0] - lr) * ds; lg += (y * cm[1] - lg) * ds; lb += (y * cm[2] - lb) * ds;
    }
    albedo[p] = q8(toSrgb(clamp01(lr))); albedo[p + 1] = q8(toSrgb(clamp01(lg))); albedo[p + 2] = q8(toSrgb(clamp01(lb)));
    let nx = nor[p], ny = nor[p + 1], nz = Math.max(1e-3, nor[p + 2]);
    const l = Math.hypot(nx, ny, nz);
    normal[p] = q8(nx / l * 0.5 + 0.5); normal[p + 1] = q8(ny / l * 0.5 + 0.5); normal[p + 2] = q8(nz / l * 0.5 + 0.5);
    rah[p] = q8(clamp01(rough[i])); rah[p + 1] = q8(Math.max(0.08, clamp01(ao[i]))); rah[p + 2] = q8(h[i]);
    let met = 0;
    if (cfg.metal) {
      const mx = Math.max(lr, lg, lb), mn = Math.min(lr, lg, lb);
      const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
      const k2 = clamp01((cfg.metal[1] - sat) / (cfg.metal[1] * 0.5));
      met = cfg.metal[0] * k2 * k2 * (3 - 2 * k2);
    } else if (metalSrc) met = clamp01(metalSrc[i]);
    let tn = cfg.tintH ? clamp01(baseTint + cfg.tintH * (h[i] - hMean)) : baseTint;
    if (met > 0.02) tn *= 1 - met;
    mask[p] = q8(met); mask[p + 1] = q8(tn); mask[p + 2] = 0;
  }
  // the PNGs run top row first, the photos too (and the normal is OpenGL: green = up the image)
  quantizeMaps({ albedo, normal, rah, mask });
  // stats, from the stored bytes
  let tr = 0, tg = 0, tb = 0, tw = 0, ar = 0, ag = 0, ab = 0, rs = 0, hs = 0, ms = 0;
  for (let i = 0; i < NN; i++) {
    const p = i * 3;
    const lr = LIN[albedo[p]], lg = LIN[albedo[p + 1]], lb = LIN[albedo[p + 2]];
    const tt = mask[p + 1] / 255;
    tr += lr * tt; tg += lg * tt; tb += lb * tt; tw += tt;
    ar += lr; ag += lg; ab += lb; rs += rah[p] / 255; hs += rah[p + 2] / 255; ms += mask[p] / 255;
  }
  const meanAll = [ar / NN, ag / NN, ab / NN];
  const mean = tw > NN * 0.01 ? [tr / tw, tg / tw, tb / tw] : meanAll;
  const stats = { mean: mean.map(r4), meanAll: meanAll.map(r4), rough: r4(rs / NN), height: r4(hs / NN), metal: r4(ms / NN), tint: r4(tw / NN) };
  return { maps: { albedo, normal, rah, mask }, stats };
}

// ---- main --------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { only: null, cache: join(ROOT, '.cache', 'photo-textures'), update: false, list: false, level: 9 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--only') a.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (v === '--cache') a.cache = resolve(argv[++i]);
    else if (v === '--update') a.update = true;
    else if (v === '--list') a.list = true;
    else if (v === '--fast') a.level = 4;
    else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

function credits(man) {
  const rows = Object.entries(man.sets).filter(([, e]) => e.source).map(([n, e]) => {
    const s = e.source;
    return `| \`${n}\` | [${s.name}](${s.url}) (\`${s.id}\`) | ${Object.keys(s.authors || {}).join(', ')} | ${s.license} | ${s.repeat}×${s.repeat} over ${e.tile} m (photo ${s.sizeM} m) |`;
  });
  const kept = Object.entries(man.sets).filter(([, e]) => !e.source).map(([n]) => `\`${n}\``);
  return `# Texture credits

The world's surface sets in this folder come from two places:

* **Photo-scanned materials from [Poly Haven](https://polyhaven.com)**, all released under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain; no attribution
  required — credited here anyway, with thanks to the authors). They were downloaded as 2K JPG
  maps and repacked into the game's own format by \`scripts/fetch-photo-textures.js\`
  (box-filtered to 1024², repeated a whole number of times across each set's tile so the tiling
  stays seamless, mean luminance matched to the game's lighting). Each set's manifest entry has a
  \`source\` field with the asset id, page, licence and the exact file URLs and md5 sums.
* **The game's own procedural bake** (\`scripts/bake-textures.js\`, MIT like the rest of the game)
  for the sets no photo material fits.

## Photo materials (CC0 1.0)

| Set | Source asset | Authors | Licence | Scale |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## Procedurally baked (this repository)

${kept.join(', ')}

The decals, guns and zombies folders are the game's own bakes as well.
`;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const mPath = join(LIB, 'manifest.json');
  const man = JSON.parse(readFileSync(mPath, 'utf8'));
  const ALL = { ...PHOTO, ...PHOTO_NEW };
  const names = a.only || Object.keys(ALL);
  if (a.list) { for (const n of Object.keys(ALL)) console.log(`${n.padEnd(20)} ${ALL[n].id}${PHOTO_NEW[n] ? '  (new)' : ''}`); return; }
  const t0 = Date.now();
  for (const name of names) {
    const cfg = ALL[name];
    if (!cfg) throw new Error(`no photo material configured for ${name}`);
    const fresh = !!PHOTO_NEW[name];
    const old = man.sets[name] || (fresh ? { det: cfg.det, tile: cfg.tile } : null);
    if (!old) throw new Error(`the manifest has no set ${name}`);
    if (fresh) { old.det = cfg.det; old.tile = cfg.tile; }
    // the replaced set's baked look, kept for the colour match (the first run records it); a new set
    // matches nothing: its own colour, the configured tint
    const ref = fresh ? { tint: cfg.tint, about: cfg.about } : (old.source && old.source.baked) || { meanAll: old.meanAll, mean: old.mean, tint: old.tint, rough: old.rough, about: old.about };
    const info = await fetchRetry(`${API}/info/${cfg.id}`, 'json');
    const { files, dx } = await resolveFiles(cfg.id);
    if (old.source && old.source.id === cfg.id && !a.update) {
      for (const [k, f] of Object.entries(files)) {
        const was = old.source.files && old.source.files[k];
        if (was && was.md5 !== f.md5) throw new Error(`${name}: ${cfg.id} ${k} changed upstream (md5 ${f.md5} ≠ ${was.md5}); rerun with --update to accept`);
      }
    }
    const imgs = {};
    for (const [k, f] of Object.entries(files)) imgs[k] = decodeJpg(await download(a.cache, cfg.id, k, f));
    const sizeM = Math.round((info.dimensions ? info.dimensions[0] : 2000) / 10) / 100;
    // repeats across the tile: the power of two (they divide the 2K photo) closest in log scale to
    // tile / photo size, so the scale stays within √2 of real where it can
    const kPow = 2 ** Math.max(0, Math.min(3, Math.round(Math.log2(old.tile / sizeM))));
    const res = packSet(name, cfg, ref, imgs, dx, kPow);
    const dir = join(LIB, name);
    mkdirSync(dir, { recursive: true });
    const sizes = {};
    for (const [kind, px] of Object.entries(res.maps)) {
      const buf = encodePNG(px, STORE, STORE, 3, { level: a.level });
      writeFileSync(join(dir, `${kind}.png`), buf);
      sizes[kind] = buf.length;
    }
    const e = {
      about: cfg.about,
      det: old.det,
      size: STORE,
      render: imgs.diff.w,
      tile: old.tile,
      files: { albedo: `${name}/albedo.png`, normal: `${name}/normal.png`, rah: `${name}/rah.png`, mask: `${name}/mask.png` },
      bytes: Object.values(sizes).reduce((s, v) => s + v, 0),
      ...res.stats,
      ...(cfg.cells ? { cells: cfg.cells } : null),
      shift: cfg.shift,
      source: {
        library: 'Poly Haven', id: cfg.id, name: info.name, url: `https://polyhaven.com/a/${cfg.id}`,
        license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        authors: info.authors || {}, sizeM, repeat: kPow, normal: dx ? 'directx→opengl' : 'opengl',
        files, ...(fresh ? null : { baked: ref }),
      },
    };
    man.sets[name] = e;
    console.log(`  ${name.padEnd(18)} ← ${cfg.id.padEnd(26)} ${kPow}×  ${(e.bytes / 1e6).toFixed(2)} MB  (photo ${sizeM} m, tile ${old.tile} m)`);
    // (written after every set: an interrupted run keeps what it finished)
    man.bytes = Object.values(man.sets).reduce((s, x) => s + x.bytes, 0);
    writeFileSync(mPath, JSON.stringify(man, null, 1) + '\n');
  }
  writeFileSync(join(LIB, 'CREDITS.md'), credits(man));
  console.log(`replaced ${names.length} sets in ${((Date.now() - t0) / 1000).toFixed(0)} s; the library holds ${(man.bytes / 1e6).toFixed(1)} MB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
