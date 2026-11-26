// The modelling kit and the level-art factory of this owner's story levels (Mill Road, Hollow Creek,
// Blackpine). The layouts (shared/levels/<id>.js) tag their obstacles with a `style` and record floors,
// door frames and free props in `map.art`; this module turns them into geometry through the world's geo
// builder, with a few buckets of its own:
//   lvsign   the level atlas (millroad-atlas.js), lit and alpha-tested: signs, posters, product fronts
//   lvglow   the same atlas unlit: back-lit sign boxes, displays (dim paint by day)
//   lvdecal  the atlas blended just off a surface: graffiti, blood smears, grime
//   lvleaf   the atlas alpha-tested on both faces: corn, weeds
//   hub*     the hideouts' atlas, so the Roadhouse's own sign, fence and gate show up on the level
//
// Walls: a wall obstacle's style is 'w:<look>' and its prop says which face is indoors ('in' = local +z,
// the obstacle's local +y). LOOKS gives each look its height, finishes and window rhythm; a wall is drawn
// as two half-thickness skins (outdoor / indoor finish) around real window openings with frames and
// see-through panes, a plinth and coping outside, skirting and trim inside.

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from '../world-geo.js';
import { DET } from '../world-surf.js';
import { atlasUV } from '../world-tex.js';
import { rod, plank } from '../dress-kit.js';
import { lvUV, makeLevelTexture, useAtlas } from './millroad-atlas.js';
import { makeHubTexture } from '../world-hideout-atlas.js';
import { buildDress } from '../../shared/dress.js';

export { T, shadeHex, mixHex, hash01, DET, atlasUV, rod, plank, lvUV };

export const HALF = Math.PI / 2;
export const PI = Math.PI;

/** Surface shorthand: { surf: [layer, roughness, metalness] }. */
export const S = (layer = 0, rough = 0.8, metal = 0) => ({ surf: [layer, rough, metal] });
export const WOOD = S(DET.wood, 0.86, 0);
export const RUSTY = S(DET.rust, 0.55, 0.7);
export const METAL = S(DET.panel, 0.45, 0.6);
export const CORR = S(DET.corrugated, 0.5, 0.55);
export const CONC = S(DET.concrete, 0.9, 0);
export const FABRIC = S(DET.fabric, 0.95, 0);
export const PLAST = S(DET.plastic, 0.5, 0);
export const RUBBER = S(DET.rubber, 0.85, 0);
export const CHROME = S(0, 0.2, 0.95);
export const NJ = { noJitter: true };

/** The extra buckets of a level that uses this kit. */
export const KIT_BUCKETS = {
  lvsign: { uv: true },
  lvglow: { uv: true, ao: false },
  lvdecal: { uv: true },
  lvleaf: { uv: true, ao: false },
  hub: { uv: true },
  hubneon: { uv: true, ao: false },
  hubflick: { uv: true, ao: false },
  lvbeam: { uv: true, ao: false },
};

// ---- small helpers ------------------------------------------------------------------------------------

/** World position of a point (lx, lz) in an object frame at (o.x, o.y, o.a). */
export function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/** A picture from the level atlas on a plane facing local +z, rotated `ry` about y. */
export function sign(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  B.add(o.bucket || 'lvsign', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: o.uv || lvUV(cell), noAO: true, noJitter: true, emissive: o.k });
}

/** The same picture on both faces (a free-standing board). */
export function sign2(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  sign(B, cell, x, y, z, w, h, ry, o);
  sign(B, cell, x, y, z, w, h, ry + PI, o);
}

/**
 * A shelf's front of product pictures from x0 to x1 (centre height y, depth z, facing ry), in pieces of about
 * `piece` units, each a random cell of `cells` (so a long shelf is not one stretched picture).
 */
export function shelfRow(B, cells, x0, x1, y, z, h, ry = 0, piece = 70) {
  const n = Math.max(1, Math.round((x1 - x0) / piece));
  const pw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) sign(B, cells[Math.floor(B.rng.next() * cells.length)], x0 + (i + 0.5) * pw, y, z, pw - 0.3, h, ry);
}

/** A blended decal (graffiti, blood, grime) on a plane facing local +z. */
export function decal(B, cell, x, y, z, w, h, ry = 0, o = {}) {
  B.add('lvdecal', T.plane(), [x, y, z], [w, h, 1], [o.rx || 0, ry, o.rz || 0], o.color || '#ffffff', { uv: lvUV(cell), noAO: true, noJitter: true });
}

/** A decal lying on the floor (rotation `rot` about y). */
export function floorDecal(B, cell, x, z, w, d, rot = 0, y = 0.55, color = '#ffffff') {
  B.add('lvdecal', T.plane(), [x, y, z], [w, d, 1], [-HALF, 0, rot], color, { uv: lvUV(cell), noAO: true, noJitter: true });
}

/** An unlit emissive box (bulbs, tubes, lenses). */
export function glowBox(B, x, y, z, sx, sy, sz, color, k = 3, r = null) {
  B.box('glow', x, y, z, sx, sy, sz, color, r, { emissive: k, uv: atlasUV('white'), noAO: true, noJitter: true });
}

/** A crate / box with straps. */
export function crate(B, x, y0, z, w, h, d, rot = 0, color = '#7a5a38') {
  B.rblock('std', x, y0, z, w, h, d, 0.6, color, [0, rot, 0], WOOD);
  B.box('std', x, y0 + h * 0.5, z, w + 0.4, 1.6, d + 0.4, shadeHex(color, -0.25), [0, rot, 0], WOOD);
}

/** A cardboard box, maybe open. */
export function carton(B, x, y0, z, w, h, d, rot = 0, open = false) {
  const c = mixHex('#a88a5a', '#c8aa78', hash01(Math.round(x * 13 + z * 7)));
  B.rblock('std', x, y0, z, w, h, d, 0.4, c, [0, rot, 0], S(DET.fabric, 0.95, 0));
  B.box('std', x, y0 + h + 0.1, z, w * 0.1, 0.3, d + 0.2, '#c8b890', [0, rot, 0], S(0, 0.6, 0));
  if (open) for (const s of [-1, 1]) B.add('std', T.box(), [x + Math.cos(rot) * s * w * 0.6, y0 + h + 2, z - Math.sin(rot) * s * w * 0.6], [w * 0.5, 0.4, d], [0, rot, s * 0.9], c, S(DET.fabric, 0.95, 0));
}

/** An oil drum. */
export function drum(B, x, y0, z, color = '#3b5f8a', h = 30, rad = 10.5, fallen = 0) {
  if (fallen) {
    B.add('std', T.cyl(14), [x, rad, z], [rad, h, rad], [HALF, fallen, 0], color, { ...RUSTY, map: 'cyl' });
    return;
  }
  B.cyl('std', x, y0, z, rad, h, color, 14, 1, null, RUSTY);
  for (const yy of [h * 0.33, h * 0.66]) B.cyl('std', x, y0 + yy, z, rad + 0.4, 1.2, shadeHex(color, -0.25), 14, 1, null, RUSTY);
  B.cyl('std', x, y0 + h - 0.2, z, rad + 0.5, 1.2, shadeHex(color, -0.35), 14, 1, null, RUSTY);
}

/** A tyre lying down or standing. */
export function tyre(B, x, y, z, rad = 9, rot = [HALF, 0, 0]) {
  B.add('std', T.torus(14, 0.42, 6), [x, y, z], [rad, rad, rad * 1.4], rot, '#1b1b1c', RUBBER);
}

/** By day the level's lamps are dim (set by createKitArt). */
let dayMode = false;
/** The direction the sunlight travels in the sim frame (x, up, y), or null at night (set by createKitArt). */
let sunRay = null;

/**
 * A shaft of daylight in through a window of a wall (the wall's frame; indoors on +z): sheets from the
 * window's top and bottom edges down along the sun's rays to the floor, faint, additive, fading with
 * length. Nothing when the sun is behind the wall or below the horizon.
 * @param {object} P model context (P.o: the wall obstacle)
 * @param {object} h the opening { x0, x1, y0, y1 }
 * @param {string} color tint (warm daylight; stained glass passes its own)
 */
export function lightBeam(P, h, color = '#c8b090') {
  if (!sunRay || P.lod < 1) return;
  const { B, o } = P;
  const a = o.a || 0, c = Math.cos(a), s = Math.sin(a);
  // the ray in the wall's frame: along the wall (x), down (y), into the room (z)
  const dx = sunRay[0] * c + sunRay[2] * s, dy = sunRay[1], dz = -sunRay[0] * s + sunRay[2] * c;
  if (dz < 0.12 || dy > -0.05) return;
  const w = h.x1 - h.x0, cx = (h.x0 + h.x1) / 2;
  const maxT = 320;
  const uv = lvUV('beam');
  for (const y of [h.y1, h.y0 + (h.y1 - h.y0) * 0.35]) {
    const t = Math.min(maxT, y / -dy);
    const e2 = [dx * t, dy * t, dz * t];
    B.quad('lvbeam', [cx + e2[0] / 2, y + e2[1] / 2, e2[2] / 2 + 0.6], [w, 0, 0], e2, color, { uv, noAO: true, noJitter: true });
  }
}

/** A fluorescent ceiling fixture at height y (dead / flickering / lit; dim by day). */
export function tubeFixture(B, halos, x, y, z, rot, state, wx, wz) {
  B.box('std', x, y + 1.2, z, 48, 2.4, 11, '#d8d8d4', [0, rot, 0], S(DET.panel, 0.5, 0.3));
  if (state === 'dead') { B.box('std', x, y - 0.4, z, 44, 1.2, 8, '#a8aaa8', [0, rot, 0], PLAST); return; }
  const bucket = state === 'flicker' ? 'flicker' : 'glow';
  B.add(bucket, T.box(), [x, y - 0.3, z], [44, 1, 8], [0, rot, 0], '#eef4ff', { emissive: dayMode ? 0.7 : 3.2, uv: atlasUV('white'), noAO: true, noJitter: true });
  if (halos && wx !== undefined) halos.push({ x: wx, y: wz, h: y - 2, color: '#e8f0ff', size: 70, strength: 0.4, flicker: state === 'flicker' ? 0.6 : 0 });
}

/** A hanging bulb in a cone shade. */
export function pendant(B, halos, x, y, z, wx, wz, color = '#ffd9a0', lit = true) {
  rod(B, 'std', [x, y + 16, z], [x, y + 4, z], 0.3, '#1a1a1a', S(0, 0.7, 0.2), 4);
  B.add('std', T.cyl(10, 0.3, true), [x, y + 2, z], [6, 5, 6], null, '#2a2e2a', { ...METAL, map: 'cyl' });
  if (lit) {
    B.add('glow', T.sphere(6, 4), [x, y - 0.6, z], [2, 2, 2], null, color, { emissive: 3.6, uv: atlasUV('white'), noAO: true, noJitter: true });
    if (halos && wx !== undefined) halos.push({ x: wx, y: wz, h: y - 1, color, size: 60, strength: 0.5 });
  }
}

/** Scattered paper and small debris over a rectangle (local frame, floor at y0). */
export function litter(B, x0, z0, x1, z1, n, y0 = 0.6, o = {}) {
  const r = B.rng;
  for (let i = 0; i < n; i++) {
    const x = r.range(x0, x1), z = r.range(z0, z1);
    const k = r.next();
    if (k < 0.45) B.add('std', T.box(), [x, y0 + 0.15, z], [r.range(5, 9), 0.2, r.range(7, 11)], [0, r.range(0, 6), 0], r.pick(['#e8e2d0', '#f0ead8', '#d8d0bc', '#f2e08a']), S(DET.fabric, 0.95, 0));
    else if (k < 0.62 && o.cans !== false) B.add('std', T.cyl(8), [x, y0 + 1.8, z], [1.8, 5.4, 1.8], [HALF, r.range(0, 6), 0], r.pick(['#c8281e', '#2a5ac4', '#e0a020', '#e8e8e0']), { ...S(DET.plastic, 0.35, 0.6), map: 'cyl' });
    else if (k < 0.78) B.add('std', T.dodeca(), [x, y0 + 0.8, z], [r.range(1.5, 3.5), r.range(0.6, 1.4), r.range(1.5, 3.5)], [r.range(0, 3), r.range(0, 6), 0], r.pick(['#8a8680', '#6a6660', '#a09a90']), S(DET.concrete, 0.9, 0));
    else if (k < 0.9) B.add('glass', T.box(), [x, y0 + 0.2, z], [r.range(1.5, 5), 0.2, r.range(1.5, 4)], [0, r.range(0, 6), 0], '#8aa4b0', S(0, 0.1, 0.2));
    else carton(B, x, y0, z, r.range(8, 14), r.range(6, 11), r.range(8, 12), r.range(0, 6), r.chance(0.5));
  }
}

// ---- looks: walls ---------------------------------------------------------------------------------------

const F = (c, l, r = 0.86, m = 0) => ({ c, l, r, m });
/**
 * Wall looks: h (height), ext / int finishes { c, l (DET layer), r, m }, plinth, cap, band (an outdoor
 * colour band), skirt (indoor base), rail (chair rail height), crown (indoor trim height), win (window
 * rhythm: { w, h, sill, pitch, margin, state }), store (a shop front of glass), draw (a custom drawer).
 */
export const LOOKS = {
  // Mill Road
  store: { h: 150, ext: F('#d6c7a6', DET.stucco), int: F('#e6dcc4', DET.drywall, 0.8), plinth: '#8a8276', cap: '#b3261e', band: { c: '#b3261e', y0: 118, y1: 132 }, skirt: '#3a3430', crown: 128, win: { w: 46, h: 44, sill: 44, pitch: 150, margin: 60, state: 'mix' } },
  storefront: { h: 150, ext: F('#d6c7a6', DET.stucco), int: F('#e6dcc4', DET.drywall, 0.8), plinth: '#8a8276', cap: '#b3261e', band: { c: '#b3261e', y0: 118, y1: 132 }, skirt: '#3a3430', crown: 128, store: { sill: 16, head: 98, pitch: 58, frame: '#b8bcc0' } },
  office: { h: 132, ext: F('#7a5a3a', DET.wood, 0.7), int: F('#7a5a3a', DET.wood, 0.7), skirt: '#2a1e14', crown: 128 },
  garage: { h: 170, ext: F('#c8c0ac', DET.brick, 0.9), int: F('#a8aaa6', DET.concrete, 0.9), plinth: '#6a665e', cap: '#1f5a34', band: { c: '#1f5a34', y0: 138, y1: 150 }, skirt: '#2a2c2e', win: { w: 60, h: 30, sill: 96, pitch: 170, margin: 70, state: 'mix' } },
  carwash: { h: 118, ext: F('#e8e6de', DET.concrete), int: F('#c8ccd0', DET.tile, 0.4), plinth: '#1a6ab0', cap: '#1a6ab0', band: { c: '#1a6ab0', y0: 96, y1: 110 } },
  trailerint: { h: 104, ext: F('#e2dccb', DET.siding, 0.8), int: F('#8a6a48', DET.wood, 0.75), plinth: '#9a968c', cap: '#8a8d8a', skirt: '#2a1e14', crown: 102, win: { w: 40, h: 32, sill: 40, pitch: 110, margin: 50, state: 'mix', shutters: '#5a7a8a' } },
  block: { h: 110, ext: F('#d8d4c8', DET.brick, 0.9), int: F('#dcdcd4', DET.brick, 0.85), plinth: '#8a8680', cap: '#8a8680', skirt: '#4a8aa8', win: { w: 44, h: 18, sill: 78, pitch: 120, margin: 50, state: 'mix' } },
  shack: { h: 100, ext: F('#7a6448', DET.siding, 0.92), int: F('#a8885a', DET.wood, 0.85), plinth: '#4a4038', cap: '#5a4a3a', skirt: '#3a2a1c', win: { w: 40, h: 30, sill: 44, pitch: 120, margin: 44, state: 'mix' } },
  shed: { h: 140, ext: F('#8a8e90', DET.corrugated, 0.5, 0.5), int: F('#7a7e80', DET.corrugated, 0.55, 0.45), plinth: '#6a665e', cap: '#5a5e62' },
  // fences and barriers (custom drawers: see WALL_DRAW)
  junk: { h: 150, draw: 'junk' },
  twall: { h: 150, draw: 'twall' },
  bund: { h: 26, draw: 'bund' },
  chain: { h: 96, draw: 'chain' },
  chainslat: { h: 96, draw: 'chain', slats: '#3a5a4a' },
  poolfence: { h: 76, draw: 'chain', low: true },
  scrap: { h: 100, draw: 'scrap' },
};

/** Floor looks: c1 (base), c2 (the checker's other tile), tile size, detail layer, roughness. */
export const FLOORS = {
  'lino-check': { c1: '#e8e4d8', c2: '#3a3c3e', tile: 26, l: DET.linoleum, r: 0.35 },
  lino: { c1: '#c8c0a8', l: DET.linoleum, r: 0.45 },
  garage: { c1: '#8a8c88', l: DET.concrete, r: 0.55, stains: true },
  'carpet-blue': { c1: '#3a4a6a', l: DET.carpet, r: 0.95 },
  'carpet-brown': { c1: '#6a5040', l: DET.carpet, r: 0.95 },
  wood: { c1: '#8a6440', l: DET.wood, r: 0.6, planks: 9 },
  'wood-old': { c1: '#6a5238', l: DET.wood, r: 0.8, planks: 11 },
  'tile-white': { c1: '#d8dcd8', c2: '#c8ccc8', tile: 18, l: DET.tile, r: 0.3 },
  wash: { c1: '#6a6e70', l: DET.concrete, r: 0.2, stains: true },
  terrazzo: { c1: '#c8c0b0', l: DET.terrazzo, r: 0.3 },
};

// ---- walls --------------------------------------------------------------------------------------------

const GLASS_PANE = '#aebfc8';

/**
 * A slab of wall between along-positions x0..x1 and heights y0..y1, t thick: an outdoor skin (local -z
 * half) and an indoor skin (+z half), each with its look's finish ('both' = indoor finish both sides).
 */
function skins(B, x0, x1, y0, y1, t, look, side) {
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return;
  const e = look.ext, n = look.int || look.ext;
  const out = side === 'both' ? n : e;
  const inn = side === 'out' ? e : n;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
  B.box('std', cx, cy, -t / 4, w, h, t / 2, out.c, null, { noJitter: true, surf: [out.l, out.r, out.m || 0] });
  B.box('std', cx, cy, t / 4, w, h, t / 2, inn.c, null, { noJitter: true, surf: [inn.l, inn.r, inn.m || 0] });
}

/** Window rhythm along a piece of wall of length L: the window centres. */
function windowsAlong(L, win) {
  const avail = L - 2 * win.margin;
  if (avail < win.w) return [];
  const n = Math.max(1, Math.floor(avail / win.pitch) + 1);
  const step = n > 1 ? (avail - win.w) / (n - 1) : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(n > 1 ? -avail / 2 + win.w / 2 + i * step : 0);
  return out;
}

/**
 * Draw one wall obstacle (frame already at the obstacle): its look from o.style ('w:<look>').
 * @param {object} P model context
 */
export function drawWall(P) {
  const { B, o } = P;
  const look = LOOKS[o.style.slice(2)];
  if (!look) return false;
  if (look.draw) { WALL_DRAW[look.draw](P, look); return true; }
  const L = o.w, t = o.h, side = o.prop || 'out', H = look.h;
  const lod = P.lod;
  const half = L / 2;
  const indoor = side === 'in' || side === 'both';
  // openings: windows or a shop front
  const holes = [];
  if (look.store) {
    const st = look.store;
    const n = Math.max(1, Math.round((L - 8) / st.pitch));
    const pw = (L - 8) / n;
    for (let i = 0; i < n; i++) holes.push({ x0: -half + 4 + i * pw + 1.6, x1: -half + 4 + (i + 1) * pw - 1.6, y0: st.sill, y1: st.head, store: true, i });
  } else if (look.win && L >= look.win.w + 2 * look.win.margin) {
    for (const cx of windowsAlong(L, look.win)) holes.push({ x0: cx - look.win.w / 2, x1: cx + look.win.w / 2, y0: look.win.sill, y1: look.win.sill + look.win.h, i: holes.length });
  }
  // the skins around the openings
  if (!holes.length) skins(B, -half, half, 0, H, t, look, side);
  else {
    const y0 = Math.min(...holes.map((h) => h.y0)), y1 = Math.max(...holes.map((h) => h.y1));
    skins(B, -half, half, 0, y0, t, look, side);
    skins(B, -half, half, y1, H, t, look, side);
    let cur = -half;
    for (const h of holes) { skins(B, cur, h.x0, y0, y1, t, look, side); cur = h.x1; }
    skins(B, cur, half, y0, y1, t, look, side);
  }
  // window units
  for (const h of holes) windowUnit(P, h, t, look, side);
  // outdoor trim: plinth, colour band, coping (not on an indoor partition)
  if (side !== 'both') {
    if (look.plinth) B.box('std', 0, 5, -t / 2 - 0.6, L, 10, 1.2, look.plinth, null, { noJitter: true, ...CONC });
    if (look.band && lod >= 1) B.box('std', 0, (look.band.y0 + look.band.y1) / 2, -t / 2 - 0.5, L, look.band.y1 - look.band.y0, 1, look.band.c, null, { noJitter: true, ...S(DET.panel, 0.45, 0.2) });
    if (look.cap) B.box('std', 0, H + 1.2, -0.6, L + 0.2, 2.4, t + 2.6, look.cap, null, { noJitter: true, ...S(DET.panel, 0.5, 0.3) });
  } else if (look.cap || true) B.box('std', 0, H + 0.6, 0, L, 1.2, t + 0.6, shadeHex(look.int.c, -0.2), null, { noJitter: true, ...WOOD });
  // indoor trim: skirting, chair rail, crown
  if (indoor && lod >= 1) {
    const faces = side === 'both' ? [-1, 1] : [1];
    for (const f of faces) {
      if (look.skirt) B.box('std', 0, 3.2, f * (t / 2 + 0.45), L, 6.4, 0.9, look.skirt, null, { noJitter: true, ...S(DET.panel, 0.5, 0.1) });
      if (look.crown) B.box('std', 0, look.crown, f * (t / 2 + 0.4), L, 2.6, 0.8, shadeHex(look.int.c, 0.1), null, { noJitter: true, ...S(DET.plaster, 0.7, 0) });
      if (look.rail) B.box('std', 0, look.rail, f * (t / 2 + 0.4), L, 2, 0.8, shadeHex(look.int.c, -0.25), null, { noJitter: true, ...WOOD });
    }
  }
  // grime: a streak or two on the outdoor face, blood inside now and then
  if (lod >= 2 && L > 60) {
    const r = B.rng;
    if (side !== 'both' && r.chance(0.6)) decal(B, 'grime', r.range(-half * 0.6, half * 0.6), H * 0.62, -t / 2 - 0.9, Math.min(L * 0.6, 90), H * 0.7, PI);
    if (indoor && r.chance(0.28)) decal(B, r.pick(['blood2', 'hands', 'blood1', 'drip']), r.range(-half * 0.6, half * 0.6), r.range(30, 60), t / 2 + 0.95, r.range(28, 46), r.range(30, 50), 0);
  }
  return true;
}

function windowUnit(P, h, t, look, side) {
  // a look may draw its own windows (a church's lancets)
  if (look.win && look.win.draw) { look.win.draw(P, h, t, look, side); return; }
  const { B, o } = P;
  const lod = P.lod;
  const w = h.x1 - h.x0, hh = h.y1 - h.y0, cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
  const seed = Math.round(o.x * 7 + o.y * 13) + h.i * 31;
  const win = look.win || {};
  const st = look.store;
  let state = 'glass';
  const roll = hash01(seed);
  if (st) state = roll < 0.35 ? 'broken' : roll < 0.45 ? 'boarded' : 'glass';
  else if (win.state === 'mix') state = roll < 0.3 ? 'broken' : roll < 0.48 ? 'boarded' : 'glass';
  else if (win.state) state = win.state;
  const frame = st ? st.frame : '#e8e4da';
  const fo = { noJitter: true, ...S(DET.panel, 0.45, st ? 0.7 : 0.1) };
  // reveals (the wall's thickness inside the opening)
  const rev = shadeHex(look.ext.c, -0.2);
  B.box('std', cx, h.y0 - 0.6, 0, w, 1.2, t, rev, null, { noJitter: true, ...CONC });
  B.box('std', cx, h.y1 + 0.6, 0, w, 1.2, t, rev, null, { noJitter: true, ...CONC });
  // the frame: head, sill and jambs around the pane, mid-thickness
  const fb = st ? 2.2 : 1.6;
  B.box('std', cx, h.y1 - fb / 2, 0, w, fb, 3, frame, null, fo);
  B.box('std', cx, h.y0 + fb / 2, 0, w, fb, 3, frame, null, fo);
  B.box('std', h.x0 + fb / 2, cy, 0, fb, hh, 3, frame, null, fo);
  B.box('std', h.x1 - fb / 2, cy, 0, fb, hh, 3, frame, null, fo);
  if (!st && lod >= 1) B.box('std', cx, cy, 0, 1.2, hh, 2.4, frame, null, fo);
  if (st) B.box('std', cx, h.y1 - 16, 0, w, 1.6, 2.6, frame, null, fo);
  // the pane: see-through glass, broken teeth, or boarded over outside
  if (state === 'glass') {
    B.box('vglass', cx, cy, 0, w - 2, hh - 2, 0.4, '#8fa2ac', null, { noJitter: true, surf: [0, 0.06, 0] });
    // posters and decals on shop windows
    if (st && lod >= 1 && hash01(seed + 3) < 0.6) {
      const cell = ['mr_hours', 'poster2', 'mr_lotto', 'poster1', 'mr_beer', 'poster4'][Math.floor(hash01(seed + 5) * 6)];
      sign(B, cell, cx + (hash01(seed + 9) - 0.5) * w * 0.4, h.y0 + 30, -0.6, 20, cell === 'mr_lotto' || cell === 'mr_beer' ? 11 : 28, PI);
    }
  } else if (state === 'broken') {
    const r = B.rng;
    for (let k = 0; k < (lod >= 1 ? 5 : 2); k++) {
      const top = r.chance(0.5);
      const x = h.x0 + 2 + r.next() * (w - 4);
      B.add('vglass', T.box(), [x, top ? h.y1 - 4 - r.next() * 5 : h.y0 + 3 + r.next() * 4, 0], [r.range(3, 8), r.range(4, 11), 0.4], [0, 0, r.range(-0.5, 0.5)], '#8fa2ac', { noJitter: true, surf: [0, 0.06, 0] });
    }
  } else if (state === 'boarded') {
    const n = Math.max(2, Math.round(hh / 12));
    const woods = ['#6a5a44', '#7a6a52', '#5a4a36', '#8a7a5c'];
    for (let k = 0; k < n; k++) {
      const py = h.y0 + (k + 0.5) * (hh / n);
      B.add('std', T.box(), [cx, py, -t / 2 - 1.2], [w + 8, hh / n - 1.2, 1], [0, 0, (hash01(seed + k) - 0.5) * 0.12], woods[(k + seed) % 4], { noJitter: true, ...WOOD });
    }
    B.box('std', cx, cy, 0, w - 2, hh - 2, 1, '#4a3c2c', null, { noJitter: true, ...WOOD });
  }
  // daylight in through it
  if (state !== 'boarded' && (side === 'in')) lightBeam(P, h, st ? '#b8a080' : '#c8b090');
  // sill outside, stool inside
  if (!st) {
    B.box('std', cx, h.y0 - 1.4, -t / 2 - 1.4, w + 5, 2.4, 4, shadeHex(look.plinth || look.ext.c, 0.1), null, { noJitter: true, ...CONC });
    if (side === 'in' && lod >= 1) B.box('std', cx, h.y0 - 0.8, t / 2 + 1, w + 4, 1.6, 2.4, shadeHex(look.int.c, 0.1), null, { noJitter: true, ...WOOD });
    if (win.shutters && lod >= 1) for (const s of [-1, 1]) B.box('std', cx + s * (w / 2 + 6), cy, -t / 2 - 0.9, 11, hh + 2, 1.2, win.shutters, null, { noJitter: true, ...S(DET.siding, 0.8, 0) });
  }
}

// ---- custom wall drawers: barricades and fences ---------------------------------------------------------

/** Custom wall drawers by look.draw (the levels add theirs). */
export const WALL_DRAW = {
  /** Deke's barricade: wrecked cars on their sides, corrugated sheets, plywood, tyres, razor wire. */
  junk(P) {
    const { B, o } = P;
    const L = o.w, t = o.h, r = B.rng;
    const half = L / 2;
    // the core: sheets of corrugated steel and plywood on a timber frame
    const n = Math.max(1, Math.round(L / 46));
    const pw = L / n;
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * pw, h = 118 + r.range(-10, 22);
      const k = r.next();
      const z = -t * 0.25 + r.range(-3, 3);
      if (k < 0.5) B.block('std', x, 0, z, pw + 6, h, 2.4, r.pick(['#6e7274', '#7a6048', '#5e686c', '#84786a', '#6a4a3a']), [r.range(-0.03, 0.03), r.range(-0.06, 0.06), r.range(-0.04, 0.04)], S(DET.rust, 0.6, 0.5));
      else if (k < 0.8) B.block('std', x, 0, z, pw + 4, h - r.range(0, 24), 2.2, r.pick(['#9a7a4e', '#8a6c44', '#a88a5c', '#6e5a40']), [r.range(-0.03, 0.03), r.range(-0.06, 0.06), r.range(-0.05, 0.05)], WOOD);
      else B.block('std', x, 0, z, pw - 2, h - r.range(10, 30), 3, r.pick(['#4a5a6a', '#6a3a30', '#3a4a3a', '#8a7a4a']), [0, r.range(-0.08, 0.08), r.range(-0.05, 0.05)], S(DET.panel, 0.7, 0.2));
      if (P.lod >= 1 && r.chance(0.5)) decal(B, 'grime', x, h * 0.5, z - 1.4, pw + 6, h, PI);
      if (P.lod >= 1 && r.chance(0.3)) decal(B, r.pick(['graf2', 'graf3', 'graf1', 'xcode']), x, h * 0.55, -t * 0.25 - 1.6, pw * 1.3, pw * 0.5, PI);
    }
    // posts and a back brace
    for (let x = -half + 10; x < half; x += 60) {
      B.block('std', x, 0, t * 0.05, 7, 150, 7, '#4a3a2a', null, WOOD);
      plank(B, 'std', [x, 140, t * 0.08], [x, 6, t * 0.45], 5, 3, '#5a4632', WOOD);
    }
    // wrecks piled against the outside, tyres, sandbags at the foot
    for (let x = -half + 60; x < half - 50; x += r.range(130, 190)) {
      const on = r.chance(0.5);
      const c = r.pick(['#5a3a2a', '#3a4450', '#6a6a60', '#2a3a2a', '#7a5a2a']);
      if (on) {
        // a car on its side: body, roof, wheels facing out
        B.add('paint', T.rbox(84, 38, 42, 5), [x, 21, -t / 2 - 22], [1, 1, 1], [HALF, r.range(-0.1, 0.1), 0], shadeHex(c, -0.2), { surf: [DET.rust, 0.7, 0.4] });
        for (const s of [-1, 1]) B.add('std', T.cyl(12), [x + s * 28, 30, -t / 2 - 44], [8.5, 7, 8.5], [0, 0, 0], '#161617', { ...RUBBER, map: 'cyl' });
      } else {
        for (let k = 0; k < 3; k++) tyre(B, x + r.range(-10, 10), 5 + k * 8.5, -t / 2 - 16, 10, [HALF, 0, r.range(-0.1, 0.1)]);
      }
    }
    for (let x = -half + 12; x < half - 12; x += 16) B.add('std', T.pillow(8, 5, 0.4), [x, 4, -t / 2 - 6], [8.4, 4, 6], [0, r.range(-0.1, 0.1), 0], mixHex('#8a7a55', '#6a5e40', r.next()), FABRIC);
    // razor wire coils along the top
    if (P.lod >= 1) for (let x = -half + 8; x < half; x += 14) B.add('std', T.torus(8, 0.05, 3), [x, 150, -t * 0.2], [8, 8, 8], [0, HALF + 0.2, 0], '#8a8e92', CHROME);
  },
  /** Concrete T-walls (Texas barriers), stencilled, graffitied, with a blood smear or two. */
  twall(P) {
    const { B, o } = P;
    const L = o.w, t = o.h, r = B.rng;
    const n = Math.max(1, Math.round(L / 40));
    const pw = L / n;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * pw;
      const c = mixHex('#a8a498', '#8a867c', r.next());
      const tilt = r.range(-0.012, 0.012);
      B.block('std', x, 0, 0, pw - 1.4, 12, t, shadeHex(c, -0.08), null, { noJitter: true, ...CONC });
      B.add('std', T.profile('twall', [[-t * 0.18, 0], [t * 0.18, 0], [t * 0.1, 138], [-t * 0.1, 138]], 0, 1), [x, 12, 0], [1, 1, pw - 1.6], [0, HALF, tilt], c, { noJitter: true, ...CONC });
      B.box('std', x, 150, 0, pw - 1.8, 2, t * 0.2, shadeHex(c, -0.1), null, CONC);
      if (P.lod >= 1 && i % 3 === 1) sign(B, 'mr_closed', x, 80, -t * 0.16 - 0.4, pw * 0.8, pw * 0.6, PI);
      if (P.lod >= 2 && r.chance(0.25)) decal(B, r.pick(['graf3', 'graf4', 'xcode', 'blood2']), x, r.range(40, 90), t * 0.16 + 0.6, pw * 1.1, pw * 0.5, 0);
    }
  },
  /** The low concrete bund round the fuel tanks. */
  bund(P) {
    const { B, o } = P;
    B.rblock('std', 0, 0, 0, o.w + 2, 26, o.h, 1.2, '#a09c90', null, { noJitter: true, ...CONC });
    B.box('std', 0, 26.4, 0, o.w + 2, 0.8, o.h + 1, '#c8b020', null, { noJitter: true, ...S(DET.panel, 0.6, 0) });
  },
  /** Chain-link: posts, top rail, the mesh (the world's fence bucket), privacy slats, barbed wire. */
  chain(P, look) {
    const { B, o } = P;
    const L = o.w, H = look.h;
    const pole = '#8a8e92';
    const n = Math.max(1, Math.round(L / 80));
    for (let i = 0; i <= n; i++) B.cyl('std', -L / 2 + (i * L) / n, 0, 0, 1.6, H + (look.low ? 0 : 6), pole, 8, 1, null, CHROME);
    B.add('std', T.cyl(6), [0, H - 1, 0], [1.1, L, 1.1], [0, 0, HALF], pole, { ...CHROME, map: 'cyl' });
    B.add('fence', T.plane(), [0, H / 2, 0], [L, H - 2, 1], null, '#8a9094', { uvScale: [L / 16, (H - 2) / 16] });
    if (look.slats && P.lod >= 1) {
      const r = B.rng;
      for (let x = -L / 2 + 3; x < L / 2 - 2; x += 5.2) {
        if (r.chance(0.08)) continue;
        B.box('std', x, H / 2 - 2, 0.6, 3.6, H - 8 - (r.chance(0.1) ? r.range(10, 40) : 0), 0.5, look.slats, null, { noJitter: true, ...PLAST });
      }
    }
    if (!look.low && P.lod >= 1) {
      for (let i = 0; i <= n; i++) B.add('std', T.box(), [-L / 2 + (i * L) / n, H + 7, -3], [1.2, 12, 1.2], [0.6, 0, 0], pole, CHROME);
      for (const z of [-3.5, -6.5]) rod(B, 'std', [-L / 2, H + 5 + (z < -5 ? 4 : 0), z], [L / 2, H + 5 + (z < -5 ? 4 : 0), z], 0.25, '#4a4c4e', RUSTY, 3);
    }
  },
  /** The Roadhouse's scrap wall: the hideout's own perimeter model. */
  scrap(P) {
    const fn = P.hubModels && P.hubModels.perimeter;
    if (fn) fn({ ...P, L: P.o.w, W: Math.min(P.o.h, 20), hub: { id: 'roadhouse' } });
  },
};

// ---- door frames ------------------------------------------------------------------------------------------

/** More door kinds (the levels add theirs): kind → fn(P) with P.w, P.t, P.dh, P.look, P.side, P.d, P.open(x0, len, color, surf, angle, zside). */
export const DOORS = {};
/** The casing colour of a door kind, and its opening height when not the default. */
export const DOOR_TRIM = {};
export const DOOR_H = {};

/**
 * A door frame in an opening (map.art.doors record; frame at the opening's centre, local x along the wall):
 * the wall above the opening (in the wall's look), casings both sides, a threshold and the leaves.
 */
export function drawDoor(P, d) {
  const { B } = P;
  const look = LOOKS[d.wall] || LOOKS.store;
  const w = d.w, t = d.t, side = d.side || 'in';
  const kind = d.look;
  const dh = kind === 'rollup' ? Math.min(look.h - 20, 118) : DOOR_H[kind] || d.h || 76;
  // a door in a custom-drawn wall (a fence, a line of bars): only the leaves, no header or casings
  if (look.draw) { if (DOORS[kind]) DOORS[kind]({ ...P, w, t, dh, look, side, d }); return; }
  const H = look.h;
  // the wall over the opening
  skins(B, -w / 2 - 0.2, w / 2 + 0.2, dh, H, t, look, side);
  if (!look.draw && look.cap && side !== 'both') B.box('std', 0, H + 1.2, -0.6, w + 0.4, 2.4, t + 2.6, look.cap, null, { noJitter: true, ...S(DET.panel, 0.5, 0.3) });
  if (look.band && side !== 'both' && P.lod >= 1) B.box('std', 0, (look.band.y0 + look.band.y1) / 2, -t / 2 - 0.5, w, look.band.y1 - look.band.y0, 1, look.band.c, null, { noJitter: true, ...S(DET.panel, 0.45, 0.2) });
  const r = B.rng;
  const trim = DOOR_TRIM[kind] || (kind === 'glass2' ? '#b8bcc0' : kind === 'steel' || kind === 'rollup' ? '#4a4e52' : '#e8e2d0');
  const tro = { noJitter: true, ...(kind === 'glass2' ? CHROME : S(DET.panel, 0.55, 0.2)) };
  // casings (both faces) and the jambs
  for (const f of [-1, 1]) {
    B.box('std', 0, dh + 2, f * (t / 2 + 0.5), w + 8, 4, 1, trim, null, tro);
    for (const s of [-1, 1]) B.box('std', s * (w / 2 + 2), dh / 2, f * (t / 2 + 0.5), 4, dh, 1, trim, null, tro);
  }
  for (const s of [-1, 1]) B.box('std', s * (w / 2 - 0.6), dh / 2, 0, 1.2, dh, t, shadeHex(trim, -0.15), null, tro);
  B.box('std', 0, 0.6, 0, w, 1.2, t + 2, '#6a665e', null, CONC);
  const open = (x0, len, color, o2, a, zside = 1) => {
    // a leaf hinged at x0 (local), swung `a` into the +z (indoor) side
    const cx = x0 + Math.cos(a) * len / 2 * Math.sign(len), cz = zside * (t / 2 + Math.sin(Math.abs(a)) * Math.abs(len) / 2);
    B.add('std', T.box(), [cx, dh / 2, cz], [Math.abs(len), dh - 2, 2.2], [0, -zside * a * Math.sign(len), 0], color, o2);
  };
  if (DOORS[kind]) { DOORS[kind]({ ...P, w, t, dh, look, side, d, open }); return; }
  switch (kind) {
    case 'glass2': {
      // aluminium double doors: one shut, one hanging open; push bars; a broken pane
      const lw = w / 2 - 1;
      const al = '#b8bcc0';
      for (const s of [-1, 1]) {
        const ang = s < 0 ? 0.05 : 1.35 + r.range(-0.2, 0.2);
        const hx = s * (w / 2 - 1);
        const dir = -s;
        const cx = hx + dir * Math.cos(ang) * lw / 2, cz = Math.sin(ang) * lw / 2 + t / 2;
        const rot = [0, dir > 0 ? -ang : ang, 0];
        B.add('std', T.box(), [cx, dh / 2, cz], [lw, dh - 2, 2.4], rot, al, CHROME);
        B.add('vglass', T.box(), [cx, dh / 2 + 4, cz], [lw - 7, dh - 20, 2.6], rot, '#8fa2ac', { noJitter: true, surf: [0, 0.06, 0] });
        B.add('std', T.box(), [cx, dh * 0.45, cz + 1.4], [lw - 8, 2, 2], rot, '#d8dcdc', CHROME);
      }
      break;
    }
    case 'rollup': {
      // the roll-up door's drum under the header and its guide rails; the door itself rolled up
      B.cyl('std', 0, dh + 8, t / 2 + 7, 7, w + 6, '#6a6e72', 12, 1, [0, 0, HALF], RUSTY);
      B.box('std', 0, dh + 1.5, t / 2 + 7, w, 3, 10, '#8a8e92', null, CORR);
      for (const s of [-1, 1]) B.box('std', s * (w / 2 - 1), dh / 2, t / 2 + 2, 3, dh, 4, '#4a4e52', null, RUSTY);
      if (P.lod >= 1) sign(B, 'mr_flammable', w / 2 + 16, dh * 0.6, -t / 2 - 0.4, 14, 14, PI);
      break;
    }
    case 'screen': {
      open(-w / 2 + 1, w - 2, '#e8e4d8', { ...S(DET.panel, 0.6, 0.1) }, 1.5 + r.range(-0.3, 0.2), -1);
      open(w / 2 - 1, -(w - 2), '#6a4a30', WOOD, 1.7, 1);
      break;
    }
    case 'steel': {
      open(-w / 2 + 1, w - 2, '#5a6a72', METAL, 1.2 + r.range(-0.3, 0.4), 1);
      break;
    }
    case 'none': break;
    default: {
      // a panelled wooden door, open inward, sometimes off its hinges on the floor
      if (r.chance(0.2)) B.add('std', T.box(), [r.range(-10, 10), 1.6, t / 2 + 26], [w - 4, 2.4, dh - 4], [0, r.range(-0.5, 0.5), 0], '#6a4a30', WOOD);
      else open(-w / 2 + 1, w - 2, r.pick(['#6a4a30', '#8a6a48', '#e8e2d0', '#4a5a4a']), WOOD, 1.2 + r.range(-0.4, 0.4), 1);
    }
  }
}

// ---- floors --------------------------------------------------------------------------------------------------

/** A floor (map.art.floors record; frame at its centre): the base, the pattern, wear and stains. */
export function drawFloor(P, f) {
  const { B } = P;
  const fl = FLOORS[f.look] || FLOORS.lino;
  const w = f.w, d = f.h, y = 0.35;
  const base = { noJitter: true, surf: [fl.l, fl.r, 0] };
  B.quad('std', [0, y, 0], [0, 0, d], [w, 0, 0], fl.c1, base);
  const r = B.rng;
  if (fl.c2 && P.lod >= 1) {
    // checker: every other tile in the second colour, a few lifted or missing
    const nx = Math.floor(w / fl.tile), nz = Math.floor(d / fl.tile);
    const ox = -((nx * fl.tile) / 2), oz = -((nz * fl.tile) / 2);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if ((i + j) % 2) continue;
        const miss = r.chance(0.03);
        B.quad('std', [ox + (i + 0.5) * fl.tile, y + 0.04, oz + (j + 0.5) * fl.tile], [0, 0, fl.tile - 0.3], [fl.tile - 0.3, 0, 0], miss ? '#4a4640' : fl.c2, base);
      }
    }
  }
  if (fl.planks && P.lod >= 1) {
    // plank seams across the width
    for (let z = -d / 2 + fl.planks; z < d / 2; z += fl.planks) B.quad('std', [0, y + 0.03, z], [0, 0, 0.5], [w, 0, 0], shadeHex(fl.c1, -0.35), base);
  }
  if (P.lod >= 2) {
    // traffic wear down the middle, stains, grime at the edges
    const n = Math.round((w * d) / 12000);
    for (let i = 0; i < n; i++) floorDecal(B, r.pick(fl.stains ? ['blood3', 'grime', 'blood3'] : ['grime', 'papers', 'blood3', 'grime']), r.range(-w / 2 + 20, w / 2 - 20), r.range(-d / 2 + 20, d / 2 - 20), r.range(20, 50), r.range(20, 50), r.range(0, 6), y + 0.1);
  }
}

// ---- the level-art factory -------------------------------------------------------------------------------------

function neonMaterial(tex, k) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, alphaTest: 0.02 });
  m.color.setScalar(k);
  return m;
}

function inRect(r, x, y, pad = 0) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const dx = x - r.x, dy = y - r.y;
  return Math.abs(dx * c + dy * s) <= r.w / 2 + pad && Math.abs(-dx * s + dy * c) <= r.h / 2 + pad;
}

/**
 * The set dressing of a level: the automatic road debris of shared/dress.js minus what would land
 * indoors or in the corn, plus the layout's hand-placed items (map.art.dress). Set as map.dressItems,
 * which the world's dressing (world-dress.js) uses in place of its own list.
 */
export function levelDress(map, extraSkip = null) {
  const art = map.art || {};
  const auto = buildDress(map);
  const rooms = (map.roofs || []).concat(art.floors || []);
  const keep = auto.filter((it) => !rooms.some((r) => inRect(r, it.x, it.y, 6)) && !(extraSkip && extraSkip(it)));
  const hand = (art.dress || []).map(([k, x, y, a, s], i) => ({ k, x, y, a: a || 0, s: s || 1, h: 1, v: (Math.round(x * 31 + y * 17) >>> 0) % 65536, q: Math.round((0.004 + (i % 50) * 0.004) * 1e4) / 1e4 }));
  return keep.concat(hand);
}

/**
 * Build a level's art object (the seams of JOURNEY.md §5) from its model tables.
 * @param {object} ctx renderer ctx
 * @param {object} deps world deps
 * @param {object} spec { models: style/prop → fn(P), roofs: style → fn(P), gates: style → fn(P), finish(P), update(dt, P), extraSkip(item) }
 */
export function createKitArt(ctx, deps, spec) {
  const map = ctx.map;
  useAtlas(map.id);
  dayMode = !!deps.day;
  const dl = map.look && map.look.day;
  sunRay = null;
  if (dayMode && dl && Number.isFinite(dl.az) && Number.isFinite(dl.el) && dl.el > 3) {
    const az = (dl.az * Math.PI) / 180, el = (dl.el * Math.PI) / 180;
    sunRay = [-Math.cos(el) * Math.cos(az), -Math.sin(el), -Math.cos(el) * Math.sin(az)];
  }
  const art = map.art || { floors: [], doors: [], props: [] };
  const day = deps.day;
  const full = deps.full || deps.tier || 'high';
  const lod = full === 'low' ? 0 : full === 'high' ? 1 : full === 'ultra' ? 2 : 3;
  const tex = makeLevelTexture(deps.aniso || 8);
  const hubTex = makeHubTexture(deps.aniso || 8);
  const neonK = day ? 0.34 : 1;
  const own = {
    hi: {
      lvsign: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, roughness: 0.6, metalness: 0.05, envMapIntensity: 0.6 }),
      lvglow: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
      lvdecal: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.4 }),
      lvleaf: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, envMapIntensity: 0.35 }),
      hub: new THREE.MeshStandardMaterial({ vertexColors: true, map: hubTex, alphaTest: 0.5, roughness: 0.75, metalness: 0, envMapIntensity: 0.55 }),
      hubneon: neonMaterial(hubTex, neonK),
      hubflick: neonMaterial(hubTex, neonK),
      lvbeam: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true }),
    },
  };
  own.low = {
    lvsign: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
    lvglow: own.hi.lvglow,
    lvdecal: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    lvleaf: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
    hub: new THREE.MeshLambertMaterial({ vertexColors: true, map: hubTex, alphaTest: 0.5 }),
    hubneon: own.hi.hubneon,
    hubflick: own.hi.hubflick,
    lvbeam: own.hi.lvbeam,
  };
  own.hi.lvbeam.color.setScalar(day ? 0.32 : 0);
  // by day a back-lit sign is just paint in the sun (dimmer than a lit face would be at night)
  own.hi.lvglow.color.setScalar(day ? 0.82 : 1);
  const warned = new Set();
  const dyn = { smoke: [], sparks: [], chimneys: [], chickens: [], searchlights: [], spinners: [] };
  const P0 = { day, lod, full, tier: deps.tier, map, art, halos: deps.halos, shafts: deps.shafts, gy: deps.gy, dyn, hubModels: spec.hubModels || null, ctx };
  const ctxOf = (B, o, extra) => ({ ...P0, B, o, it: o, L: o.w || 0, W: o.h || 0, ...(extra || null) });

  function run(table, key, B, o, extra) {
    const fn = table[key];
    if (!fn) {
      if (!warned.has(key)) { warned.add(key); console.warn('level art: no model for', key); }
      return false;
    }
    try {
      fn(ctxOf(B, o, extra));
    } catch (err) {
      if (!warned.has('!' + key)) { warned.add('!' + key); console.warn('level art: model failed', key, err); }
    }
    return true;
  }

  // the set dressing: set before world.js builds it (createDress runs after the level art is made)
  try { map.dressItems = levelDress(map, spec.extraSkip); } catch (err) { console.warn('level art: dressing failed', err); }

  let seq = 0;
  let roofCalled = false;
  const self = {
    buckets: KIT_BUCKETS,
    dyn,
    material(bucket, t) { return (t === 'low' ? own.low : own.hi)[bucket] || null; },
    obstacle(B, o) {
      if (o.gate) return self.gateModel(B, null, o);
      const st = o.style;
      if (!st) return false;
      if (st === 'nodraw') return true;
      if (st.startsWith('w:')) return drawWall(ctxOf(B, o)) !== false;
      return run(spec.models, st, B, o);
    },
    gateModel(B, gate, o) {
      const st = o.style;
      if (!st || !spec.gates || !spec.gates[st]) return false;
      return run(spec.gates, st, B, o, { gate });
    },
    objective() { return false; },
    roof(B, r) {
      roofCalled = true;
      if (!r.style || !spec.roofs || !spec.roofs[r.style]) return false;
      B.obj(r.x, r.y, r.a || 0, 7000 + (seq++));
      return run(spec.roofs, r.style, B, r);
    },
    props(B) {
      // a world without the roof seam (roofs3d.js calls roof() before props()): draw the level's own roofs here
      if (!roofCalled) for (const r of map.roofs || []) if (r.style && spec.roofs && spec.roofs[r.style]) self.roof(B, r);
      for (const f of art.floors || []) {
        B.obj(f.x, f.y, f.a || 0, 3000 + (seq++));
        B.setJitter(0);
        try { drawFloor(ctxOf(B, f), f); } catch (err) { if (!warned.has('floor')) { warned.add('floor'); console.warn('level art: floor failed', err); } }
      }
      for (const d of art.doors || []) {
        B.obj(d.x, d.y, d.a || 0, 4000 + (seq++));
        B.setJitter(0.02);
        try { drawDoor(ctxOf(B, d), d); } catch (err) { if (!warned.has('door')) { warned.add('door'); console.warn('level art: door failed', err); } }
      }
      for (const p of art.props || []) {
        B.obj(p.x, p.y, p.a || 0, 5000 + (seq++) * 7);
        B.setJitter(0.04);
        run(spec.models, p.t, B, p);
      }
      if (spec.props) {
        try { spec.props(ctxOf(B, {})); } catch (err) { console.warn('level art: props failed', err); }
      }
    },
    finish() { if (spec.finish) spec.finish(P0, deps); },
    update(view, frame) {
      const dt = Math.min(0.1, (frame && frame.dt) || 0.016);
      time += dt;
      const st = Math.sin(time * 1.3) + Math.sin(time * 3.7 + 1) * 0.6;
      own.hi.hubneon.color.setScalar(neonK * (st > 1.35 ? (Math.sin(time * 60) > 0 ? 0.35 : 1) : 1));
      const fl = Math.sin(time * 0.9) + Math.sin(time * 2.3 + 2) * 0.7;
      own.hi.hubflick.color.setScalar(neonK * (fl > 0.6 ? (Math.sin(time * 41) > -0.2 ? 1 : 0.05) : fl > -0.9 ? 1 : 0.12));
      if (spec.update) spec.update(dt, P0, view, frame);
    },
    setQuality() {},
    dispose() {
      for (const set of [own.hi, own.low]) for (const m of Object.values(set)) m.dispose();
      tex.dispose();
      hubTex.dispose();
      if (spec.dispose) spec.dispose();
    },
  };
  let time = 0;
  return self;
}
