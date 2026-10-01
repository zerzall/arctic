// Sandstone's props (render3d/maps/sandstone.js): the models of the cover obstacles (crates, low crates,
// barrels, carts, planters, the dry fountain, the well, the market stalls, the window sill, the
// rampart's retaining wall and parapet) and of the free pieces of `map.sandArt` (stairs, the ramp, the
// gates of the town, the passage arches, shade tarps, signs, lanterns, the big doorways, the court's
// window, the tunnels' vaults). Detail follows the tier (P.lod 0 low .. 3 cinematic).

import * as THREE from 'three';
import {
  T, shadeHex, mixHex, hash01, DET, atlasUV, rod, ssUV, HALF, PI, S, STONE, STUCCO, PLASTER, WOOD, IRON, METAL, FABRIC,
  pic, decal, glowBox, archWall, archHead, BLUES,
} from './sandstone-kit.js';

const CRATE = '#a07a4c', CRATE_D = '#6e4f2c';

// ---- cover ---------------------------------------------------------------------------------------------

/** A wooden crate of w × h × d standing on y0 (frame edges, a brace, a stencil). */
export function woodCrate(P, x, y0, z, w, h, d, rot = 0, tone = 0) {
  const { B, lod } = P;
  const c = shadeHex(CRATE, tone), e = shadeHex(CRATE_D, tone);
  B.add('std', T.box(), [x, y0 + h / 2, z], [w - 1, h - 1, d - 1], [0, rot, 0], c, { ...WOOD, noJitter: true });
  if (lod >= 1) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const L = (lx, lz) => [x + lx * cr + lz * sr, z - lx * sr + lz * cr];
    // the frame: four uprights and two rings of rails
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [px, pz] = L(sx * (w / 2 - 2), sz * (d / 2 - 2));
      B.add('std', T.box(), [px, y0 + h / 2, pz], [4.2, h, 4.2], [0, rot, 0], e, { ...WOOD, noJitter: true });
    }
    for (const y of [y0 + 2, y0 + h - 2]) {
      for (const sz of [-1, 1]) { const [px, pz] = L(0, sz * (d / 2 - 2)); B.add('std', T.box(), [px, y, pz], [w, 4, 4.2], [0, rot, 0], e, { ...WOOD, noJitter: true }); }
      for (const sx of [-1, 1]) { const [px, pz] = L(sx * (w / 2 - 2), 0); B.add('std', T.box(), [px, y, pz], [4.2, 4, d], [0, rot, 0], e, { ...WOOD, noJitter: true }); }
    }
    // a diagonal brace on the two broad faces
    for (const sz of [-1, 1]) {
      const [px, pz] = L(0, sz * (d / 2 - 0.4));
      B.add('std', T.box(), [px, y0 + h / 2, pz], [Math.hypot(w, h) * 0.86, 3.4, 1.2], [0, rot, Math.atan2(h, w)], e, { ...WOOD, noJitter: true });
    }
    if (lod >= 2) {
      const [px, pz] = L(w / 2 + 0.3, 0);
      pic(P.B, hash01(Math.round(x * 3 + z)) < 0.5 ? 'stencil' : 'stencil2', px, y0 + h / 2, pz, Math.min(d, h) * 0.7, Math.min(d, h) * 0.7, rot + HALF, { color: '#e0d2b8' });
    }
  }
}

/** An oil drum (blue, red or rusted). */
export function drum(P, x, y0, z, color, h = 34, rad = 11) {
  const { B, lod } = P;
  B.cyl('std', x, y0, z, rad, h, color, lod >= 1 ? 14 : 8, 1, null, S(DET.rust, 0.55, 0.6));
  if (lod >= 1) for (const y of [h * 0.33, h * 0.66]) B.cyl('std', x, y0 + y, z, rad + 0.5, 1.2, shadeHex(color, -0.3), 14, 1, null, S(DET.rust, 0.6, 0.6));
  B.cyl('std', x, y0 + h - 0.3, z, rad + 0.6, 1.2, shadeHex(color, -0.4), 14, 1, null, S(DET.rust, 0.6, 0.6));
}

/** A wooden barrel (lathe: bulging staves) with hoops. */
export function barrel(P, x, y0, z, h = 36) {
  const { B, lod } = P;
  const pts = [[9, 0], [11, h * 0.25], [11.8, h * 0.5], [11, h * 0.75], [9, h]];
  B.add('std', T.lathe('ssbarrel:' + h, pts, lod >= 1 ? 14 : 8), [x, y0, z], [1, 1, 1], null, '#7a5432', { ...WOOD, map: 'cyl' });
  if (lod >= 1) for (const y of [h * 0.15, h * 0.85]) B.cyl('std', x, y0 + y - 1, z, 10.4, 2, '#2a2622', 14, 1, null, IRON);
  B.cyl('std', x, y0 + h - 0.4, z, 8.8, 0.8, '#5a3a20', 12, 1, null, WOOD);
}

export const MODELS = {
  /** A big crate (62 high: stand on it). */
  crate(P) {
    const { o } = P;
    woodCrate(P, 0, 0, 0, o.w, 62, o.h, 0, hash01(o.id) * 0.2 - 0.1);
  },
  /** Low cover: one or two smaller crates filling the footprint (40 high). */
  lowcrate(P) {
    const { o } = P;
    const long = o.w >= o.h;
    const L = long ? o.w : o.h, D = long ? o.h : o.w;
    const n = L > D * 1.6 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const t = -L / 2 + (i + 0.5) * (L / n);
      const hh = 36 + (i % 2) * 4;
      woodCrate(P, long ? t : 0, 0, long ? 0 : t, long ? L / n - 2 : D, hh, long ? D : L / n - 2, (hash01(o.id * 7 + i) - 0.5) * 0.12, -0.05 * i);
    }
  },
  /** Drums and wooden barrels in a huddle (40 high). */
  barrels(P) {
    const { o } = P;
    const r = (k) => hash01(o.id * 13 + k);
    const n = Math.max(2, Math.min(4, Math.round((o.w * o.h) / 700)));
    const pts = [[-0.25, -0.25], [0.25, 0.22], [0.24, -0.26], [-0.22, 0.26]];
    for (let i = 0; i < n; i++) {
      const x = pts[i][0] * o.w, z = pts[i][1] * o.h;
      if (r(i) < 0.45) barrel(P, x, 0, z, 34 + r(i + 5) * 6);
      else drum(P, x, 0, z, ['#2f5f8a', '#8a2a1e', '#6a4a2a', '#3a6a4a'][Math.floor(r(i + 9) * 4)], 34 + r(i + 3) * 6, 10.5);
    }
  },
  /** A wooden hand cart with two wheels, its goods under a cloth. */
  cart(P) {
    const { B, o, lod } = P;
    const long = o.w >= o.h;
    const ry = long ? 0 : HALF;
    const L = Math.max(o.w, o.h), D = Math.min(o.w, o.h);
    const R = (lx, lz) => (long ? [lx, lz] : [lz, -lx]);
    B.add('std', T.box(), [0, 20, 0], [L - 18, 4, D - 6], [0, ry, 0], '#7a5432', { ...WOOD, noJitter: true });
    for (const s of [-1, 1]) {
      const [sx, sz] = R(0, s * (D / 2 - 4));
      B.add('std', T.box(), [sx, 27, sz], [L - 18, 10, 2], [0, ry, 0], '#6a4a2c', { ...WOOD, noJitter: true });
      const [wx, wz] = R(-L * 0.08, s * (D / 2 - 1));
      B.add('std', T.torus(lod >= 1 ? 16 : 8, 0.16, 4), [wx, 16, wz], [15, 15, 15], [0, ry, 0], '#4a3420', WOOD);
      if (lod >= 1) for (let k = 0; k < 4; k++) B.add('std', T.box(), [wx, 16, wz], [28, 1.6, 1.6], [0, ry, (k / 4) * PI], '#4a3420', WOOD);
      const [hx, hz] = R(L / 2 - 6, s * (D / 2 - 8));
      const [hx2, hz2] = R(L / 2 + 10, s * (D / 2 - 8));
      rod(B, 'std', [hx, 24, hz], [hx2, 30, hz2], 1.4, '#5a3a22', WOOD, 5);
    }
    // the load: sacks and boxes under a striped cloth
    for (let k = 0; k < 3; k++) {
      const [bx, bz] = R(-L * 0.25 + k * L * 0.22, (hash01(o.id + k) - 0.5) * D * 0.3);
      B.add('std', T.pillow(), [bx, 30, bz], [9, 7, 7], [0, hash01(o.id * 3 + k) * 3, 0], ['#c8b48a', '#a89068', '#d8c8a0'][k], FABRIC);
    }
    if (lod >= 1) B.add('sscloth', T.plane(), [0, 37, 0], [L - 22, D - 8, 1], [-HALF, 0, ry ? HALF : 0], '#ffffff', { uv: ssUV(['rug1', 'rug2', 'st_red'][o.id % 3]), noAO: true, noJitter: true });
  },
  /** A stone planter with a shrub and flowers (40 high). */
  planter(P) {
    const { B, o, lod } = P;
    B.rblock('std', 0, 0, 0, o.w, 30, o.h, 2, '#c4a982', null, STONE);
    B.block('std', 0, 30, 0, o.w + 2, 3, o.h + 2, '#b39a74', null, STONE);
    B.block('std', 0, 31, 0, o.w - 6, 1, o.h - 6, '#5a4028', null, S(DET.dirt, 0.95, 0));
    const n = Math.max(2, Math.round(Math.max(o.w, o.h) / 22));
    const long = o.w >= o.h;
    for (let i = 0; i < n; i++) {
      const t = -0.5 + (i + 0.5) / n;
      const x = long ? t * (o.w - 14) : 0, z = long ? 0 : t * (o.h - 14);
      B.add('std', T.ico(1), [x, 40, z], [11, 10, 11], null, i % 3 === 1 ? '#5a7a32' : '#4a6a2a', { surf: [DET.fabric, 0.9, 0], wobble: { amp: 0.3, seed: o.id + i } });
      if (lod >= 1 && i % 2 === 0) for (let k = 0; k < 4; k++) B.add('std', T.sphere(5, 3), [x + (k - 1.5) * 4, 46, z + (k % 2) * 4 - 2], [1.8, 1.8, 1.8], null, ['#c83a5a', '#e8c84a', '#e86a2a', '#ece6e0'][k], FABRIC);
    }
  },
  /** The dry fountain of the square: an octagonal basin, a tiled skirt, a column with a bowl. */
  fountain(P) {
    const { B, o, lod } = P;
    const R = Math.min(o.w, o.h) / 2;
    B.cyl('std', 0, 0, 0, R, 30, '#d4bf98', 8, 1, null, STONE);
    B.cyl('std', 0, 30, 0, R + 2, 6, '#c2ab82', 8, 1, null, STONE);
    B.cyl('std', 0, 33, 0, R - 8, 3.5, '#6a5a44', 8, 1, null, S(DET.dirt, 0.95, 0));
    if (lod >= 1) {
      // the tile skirt on the eight faces
      const apothem = R * Math.cos(PI / 8) + 0.4;
      const side = 2 * R * Math.sin(PI / 8);
      for (let k = 0; k < 8; k++) {
        // (an 8-sided cylinder has its faces between its vertices at 0, 45°, ...)
        const a = ((k + 0.5) / 8) * Math.PI * 2;
        pic(B, k % 2 ? 'zel1' : 'zel2', Math.cos(a) * apothem, 16, Math.sin(a) * apothem, side - 4, 20, HALF - a, { color: '#f0eadc' });
      }
    }
    B.cyl('std', 0, 33, 0, 8, 46, '#cdb690', 12, 0.8, null, STONE);
    B.add('std', T.lathe('ssbowl', [[3, 0], [14, 6], [20, 10], [20, 12], [16, 12], [3, 6]], 16), [0, 76, 0], [1, 1, 1], null, '#cdb690', { ...STONE, map: 'cyl' });
    if (lod >= 1) B.cyl('std', 0, 86, 0, 3.4, 10, '#b89a6a', 10, 0.5, null, METAL);
  },
  /** The well of Well Square: a round stone wall, a timber frame, a pulley, a rope and a bucket. */
  well(P) {
    const { B, o, lod } = P;
    const R = Math.min(o.w, o.h) / 2 - 2;
    B.cyl('std', 0, 0, 0, R, 38, '#c8b088', lod >= 1 ? 16 : 10, 1, null, STONE);
    B.cyl('std', 0, 38, 0, R + 1.5, 4, '#b39a74', lod >= 1 ? 16 : 10, 1, null, STONE);
    B.cyl('std', 0, 39, 0, R - 7, 3.2, '#0a0806', 12, 1, null, S(0, 1, 0));
    for (const s of [-1, 1]) B.box('std', s * (R - 2), 70, 0, 5, 64, 5, '#5a3a22', null, WOOD);
    B.box('std', 0, 100, 0, R * 2 + 6, 5, 5, '#5a3a22', null, WOOD);
    B.add('std', T.torus(lod >= 1 ? 14 : 8, 0.25, 5), [0, 94, 0], [5, 5, 5], [0, HALF, 0], '#4a3420', WOOD);
    rod(B, 'std', [0, 90, 0], [0, 58, 0], 0.4, '#b89a6a', FABRIC, 4);
    B.cyl('std', 0, 50, 0, 5, 8, '#6a4a2a', 10, 1.2, null, WOOD);
    if (lod >= 1) {
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        B.box('std', Math.cos(a) * (R + 0.3), 12 + (k % 3) * 9, Math.sin(a) * (R + 0.3), 4, 0.8, 0.3, '#8a7656', [0, -a, 0], STONE);
      }
    }
  },
  /** A market stall: a counter with goods, posts, a back board with rugs, a striped awning. */
  stall(P) {
    const { B, o, lod } = P;
    const L = o.w, D = o.h;
    const cell = { '#b8452f': 'st_red', '#2e6a8f': 'st_blue', '#d7a43a': 'st_ochre', '#3f7d4d': 'st_green', '#e2d7c0': 'st_plain', '#8a3a5c': 'st_red' }[o.roof] || 'st_red';
    // the counter (front, +z) and the back board (−z)
    B.add('std', T.box(), [0, 20, D / 2 - 8], [L - 4, 40, 14], null, '#7a5432', { ...WOOD, noJitter: true });
    B.add('std', T.box(), [0, 41, D / 2 - 6], [L + 2, 3, 20], null, '#5a3a20', { ...WOOD, noJitter: true });
    B.add('std', T.box(), [0, 45, -D / 2 + 3], [L - 4, 90, 4], null, '#6a4a2c', { ...WOOD, noJitter: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('std', T.box(), [sx * (L / 2 - 2), 55, sz * (D / 2 - 2)], [3.4, 110, 3.4], null, '#4a3018', WOOD);
    // the goods on the counter
    const goods = ['fruit', 'spice', 'baskets'];
    const n = Math.max(2, Math.round(L / 34));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 8 + (i + 0.5) * ((L - 16) / n);
      B.add('std', T.box(), [x, 46, D / 2 - 6], [(L - 16) / n - 3, 6, 15], null, '#8a6440', { ...WOOD, noJitter: true });
      pic(B, goods[(o.id + i) % 3], x, 49.2, D / 2 - 6, (L - 16) / n - 4, 14, 0, { rx: -HALF });
    }
    if (lod >= 1) {
      // rugs hung on the back board, a crate of stock behind the counter
      pic(B, ['rug1', 'rug2', 'rug3', 'rug4'][o.id % 4], -L * 0.2, 62, -D / 2 + 5.2, L * 0.45, 34, 0);
      pic(B, ['rug3', 'rug4', 'rug1', 'rug2'][o.id % 4], L * 0.25, 58, -D / 2 + 5.3, L * 0.38, 28, 0);
      woodCrate(P, -L * 0.3, 0, -D / 2 + 16, 22, 22, 18, 0.2);
    }
    // the awning: a sloped canvas over the stall and a valance at the front
    const slope = 0.26;
    B.add('sscloth', T.plane(), [0, 112, 4], [L + 14, D + 22, 1], [-HALF + slope, 0, 0], '#ffffff', { uv: ssUV(cell), noAO: true, noJitter: true });
    if (lod >= 1) B.add('sscloth', T.plane(), [0, 104, D / 2 + 15], [L + 14, 9, 1], null, '#ffffff', { uv: ssUV(cell), noAO: true, noJitter: true });
  },
  /** The court's window: a low wall up to the sill (the obstacle), the lintel and wall above, shutters. */
  sill(P) {
    const { B, o } = P;
    const col = '#cbb089';
    B.block('std', 0, 0, 0, o.w, 38, o.h, col, null, STONE);
    B.block('std', 0, 38, 0, o.w + 4, 4, o.h + 2, '#b8a07a', null, STONE);
    B.block('std', 0, 104, 0, o.w, 26, o.h, col, null, STONE);
    B.block('std', 0, 102, 0, o.w + 4, 4, o.h + 2, '#b8a07a', null, STONE);
    for (const s of [-1, 1]) B.box('std', o.w / 2 + 2, 71, s * (o.h / 2 + 10), 1.4, 62, 20, BLUES[0], null, WOOD);
  },
  /** The rampart's retaining wall over the Long Hall: ashlar courses, a string course, drain spouts. */
  retain(P) {
    const { B, o, lod } = P;
    const H = 76;
    const col = '#c6a87c';
    B.block('std', 0, 0, 0, o.w, H, o.h, col, null, STONE);
    B.block('std', 0, 0, 0, o.w + 4, 14, o.h, shadeHex(col, -0.15), null, STONE);
    B.block('std', -1, H - 4, 0, o.w + 2, 4, o.h, shadeHex(col, -0.08), null, STONE);
    if (lod >= 1) {
      for (let y = 14; y < H - 4; y += 15) B.box('std', o.w / 2 + 0.2, y, 0, 0.4, 0.8, o.h, shadeHex(col, -0.32), null, STONE);
      for (let z = -o.h / 2 + 30; z < o.h / 2; z += 70) {
        B.box('std', o.w / 2 + 3, H - 12, z, 7, 3, 3, '#8a7656', null, STONE);
        if (lod >= 2) decal(B, 'streak', o.w / 2 + 0.5, H - 46, z, 12, 64, HALF);
      }
    }
  },
  /** The rampart walk's parapet: a low stone wall with a rounded coping (shoot over it). */
  parapet(P) {
    const { B, o, lod } = P;
    const col = '#cdb38b';
    B.block('std', 0, 0, 0, o.w, 40, o.h, col, null, STONE);
    B.add('std', T.cyl(lod >= 1 ? 10 : 6), [0, 41, 0], [o.w / 2 + 1, o.h, o.w / 2 + 1], [HALF, 0, 0], shadeHex(col, -0.08), { ...STONE, map: 'cyl' });
  },
};

// ---- free pieces of map.sandArt -------------------------------------------------------------------------

/**
 * Stone steps over a flight's slope (the terrain is a straight slope between its steps' edges: a step
 * stands from the ground to the slope's top over it, so the treads sit on it).
 */
function stairs(P, it) {
  const { B, lod } = P;
  const n = it.n, H = it.h1 - it.h0;
  const alongX = it.axis === 'x';
  const a0 = alongX ? it.x0 : it.y0, a1 = alongX ? it.x1 : it.y1;
  const c0 = alongX ? it.y0 : it.x0, c1 = alongX ? it.y1 : it.x1;
  const run = (a1 - a0) / n, dh = H / n;
  const col = '#cdb690';
  P.objAbs(B, (it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, 0, 9100 + Math.round(it.x0));
  const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
  for (let j = 0; j < n; j++) {
    // the j-th tread, counted from the foot
    const lo = it.dir > 0 ? a0 + j * run : a1 - (j + 1) * run;
    const top = it.h0 + (j + 1) * dh;
    const mid = lo + run / 2 - (alongX ? cx : cy);
    const tone = shadeHex(col, (hash01(j * 7 + Math.round(a0)) - 0.5) * 0.1);
    if (alongX) B.block('std', mid, 0, 0, run + 0.4, top, c1 - c0, tone, null, STONE);
    else B.block('std', 0, 0, mid, c1 - c0, top, run + 0.4, tone, null, STONE);
    if (lod >= 2) {
      // a worn nosing on every tread
      if (alongX) B.box('std', mid - (it.dir > 0 ? run / 2 : -run / 2), top - 0.6, 0, 1.4, 1.4, c1 - c0 + 0.2, shadeHex(col, -0.18), null, STONE);
      else B.box('std', 0, top - 0.6, mid - (it.dir > 0 ? run / 2 : -run / 2), c1 - c0 + 0.2, 1.4, 1.4, shadeHex(col, -0.18), null, STONE);
    }
  }
  // cheek walls and an iron rail on the open side of the flight
  if (lod >= 1) {
    for (const s of [-1, 1]) {
      const c = s * ((c1 - c0) / 2 - 2);
      for (let j = 0; j < n; j += 2) {
        const lo = it.dir > 0 ? a0 + j * run : a1 - (j + 2) * run;
        const top = it.h0 + (j + 2) * dh;
        const mid = lo + run - (alongX ? cx : cy);
        if (alongX) B.block('std', mid, 0, c, run * 2 + 0.4, top + 8, 4, '#c4a982', null, STONE);
        else B.block('std', c, 0, mid, 4, top + 8, run * 2 + 0.4, '#c4a982', null, STONE);
      }
    }
  }
}

/** The ramp out of the Long Hall: a cobbled slab over the slope, kerbs, a worn middle. */
function ramp(P, it) {
  const { B, lod } = P;
  const H = it.h1 - it.h0;
  const len = it.y1 - it.y0, w = it.x1 - it.x0;
  P.objAbs(B, (it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, 0, 9300);
  const ang = Math.atan2(H, len);
  // rising toward −y (north): the slab's top passes through (y1, h0) and (y0, h1)
  B.add('std', T.box(), [0, (it.h0 + it.h1) / 2 - 0.9, 0], [w, 3, Math.hypot(len, H)], [ang, 0, 0], '#bda57c', { ...S(DET.paver, 0.9, 0), noJitter: true });
  if (lod >= 1) for (const s of [-1, 1]) {
    B.add('std', T.box(), [s * (w / 2 - 3), (it.h0 + it.h1) / 2 + 2, 0], [6, 6, Math.hypot(len, H)], [ang, 0, 0], '#a88f68', { ...STONE, noJitter: true });
  }
}

/** A monumental gate of the town at an entrance: two towers, an arch, crenellations (a breach: broken). */
function gateArch(P, it) {
  const { B, lod } = P;
  const w = it.w || 220;
  const H = 210, R = w / 2;
  const col = '#c7a97e';
  const broken = !!it.broken;
  for (const s of [-1, 1]) {
    B.block('std', s * (R + 22), 0, 0, 44, H + (broken && s > 0 ? -70 : 30), 56, col, null, STONE);
    if (lod >= 1 && !(broken && s > 0)) for (let i = 0; i < 2; i++) B.block('std', s * (R + 22) + (i - 0.5) * 22, H + 30, 0, 12, 12, 56, col, null, STONE);
  }
  if (!broken) {
    archWall(B, 'std', 0, H - R - 30, 0, R, R + 30, 50, col, 0, STONE, lod >= 1 ? 12 : 6);
    B.block('std', 0, H, 0, w + 88, 12, 58, shadeHex(col, -0.08), null, STONE);
    if (lod >= 1) for (let i = 0; i < Math.floor((w + 80) / 28); i += 2) B.block('std', -w / 2 - 40 + (i + 0.5) * 28, H + 12, 0, 14, 12, 50, col, null, STONE);
    // the gate's name on both faces of the lintel
    if (it.name && lod >= 1) for (const s of [-1, 1]) {
      pic(B, 'white', 0, H - 14, s * 25.4, Math.min(w, 140) + 8, 22, s > 0 ? 0 : PI, { color: '#d8c49a' });
    }
  } else {
    // rubble where the wall came down
    for (let k = 0; k < (lod >= 1 ? 9 : 4); k++) {
      const r = hash01(Math.round(it.x) + k * 31);
      B.add('std', T.dodeca(), [R * (r - 0.3), 5 + r * 6, (hash01(k * 13) - 0.5) * 50], [10 + r * 12, 7 + r * 8, 9 + r * 10], [r * 3, r * 5, 0], shadeHex(col, -0.1 * r), STONE);
    }
  }
}

/** An arch over a passage (a tunnel mouth, an alley). */
function passArch(P, it) {
  const { B, lod } = P;
  const w = it.w || 180, H = it.h || 130;
  const R = w / 2;
  const col = '#c9ae86';
  const spring = Math.max(40, H - R);
  for (const s of [-1, 1]) B.block('std', s * (R + 9), 0, 0, 18, spring + R + 22, 34, col, null, STONE);
  archWall(B, 'std', 0, spring, 0, R, R + 22, 30, col, 0, STONE, lod >= 1 ? 12 : 6);
  if (lod >= 1) {
    // voussoirs: a darker band round the arch's intrados
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * PI;
      B.box('std', Math.cos(a) * (R + 3), spring + Math.sin(a) * (R + 3), 15.4, 6, 3, 0.6, shadeHex(col, -0.14), [0, 0, a - HALF], STONE);
      B.box('std', Math.cos(a) * (R + 3), spring + Math.sin(a) * (R + 3), -15.4, 6, 3, 0.6, shadeHex(col, -0.14), [0, 0, a - HALF], STONE);
    }
  }
}

/** A shade tarp across a lane: a striped cloth sagging between ropes. */
function tarp(P, it) {
  const { B, lod } = P;
  const w = it.w, d = it.d, h = it.h;
  const cell = ['st_red', 'st_blue', 'st_ochre', 'st_plain', 'st_green'][Math.floor(hash01(Math.round(it.x + it.y)) * 5)];
  const sag = 8;
  const n = lod >= 1 ? 3 : 1;
  for (let k = 0; k < n; k++) {
    // three strips across the cloth, the middle one lowest
    const z0 = -d / 2 + (k / n) * d, z1 = -d / 2 + ((k + 1) / n) * d;
    const y0 = h - sag * Math.sin((k / n) * PI), y1 = h - sag * Math.sin(((k + 1) / n) * PI);
    const dz = z1 - z0, dy = y1 - y0;
    const uv = ssUV(cell);
    const vv = [uv[0], uv[1] + (uv[3] - uv[1]) * (k / n), uv[2], uv[1] + (uv[3] - uv[1]) * ((k + 1) / n)];
    B.add('sscloth', T.plane(), [0, (y0 + y1) / 2, (z0 + z1) / 2], [w, Math.hypot(dz, dy), 1], [-HALF - Math.atan2(dy, dz), 0, 0], '#ffffff', { uv: vv, noAO: true, noJitter: true });
  }
  if (lod >= 1 && !it.posts) for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(B, 'std', [sx * w / 2, h, sz * d / 2], [sx * (w / 2 + 8), h + 6, sz * (d / 2 + 4)], 0.35, '#8a7a5a', FABRIC, 4);
  if (it.posts) {
    // a pergola: four posts and two beams under the cloth
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) B.cyl('std', sx * (w / 2 - 4), 0, sz * (d / 2 - 4), 2.6, h + 2, '#5a3a22', 8, 0.9, null, WOOD);
      B.box('std', sx * (w / 2 - 4), h + 1, 0, 4, 4, d, '#4a3018', null, WOOD);
    }
  }
}

/** A sign over a doorway (an atlas board on the wall). */
function signItem(P, it) {
  const { B } = P;
  const cell = { 'BAB EL-KEBIR': 's_gate', CISTERN: 's_cistern', CARAVANSERAI: 's_caravan', SOUK: 's_souk' }[it.text] || 's_souk';
  const w = it.w || 100;
  const h = cell === 's_gate' || cell === 's_caravan' ? w * 0.19 : w * 0.375;
  // (the frame faces along the item's angle: local +x)
  pic(B, cell, 2.2, it.h || 150, 0, w, h, HALF);
  B.box('std', 1, it.h || 150, 0, 1.6, h + 4, w + 4, '#5a3a20', null, WOOD);
}

/**
 * A lantern at a light of the map: on a bracket off the nearest wall when there is one within reach,
 * else on a wooden post.
 */
function lantern(P, it) {
  const { B, lod, day } = P;
  // (a light's height is absolute; the frame stands on the ground under it)
  const h = (it.h || 80) - P.gy(it.x, it.y);
  const wall = P.nearWall(it.x, it.y, 46);
  const k = day ? 0.35 : 2.6;
  const body = (x, y, z) => {
    B.add('std', T.cyl(6, 0.6), [x, y + 9, z], [5, 4, 5], null, '#2a2420', IRON);
    glowBox(B, x, y, z, 6.4, 11, 6.4, '#ffc070', k);
    if (lod >= 1) for (const [dx, dz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) B.box('std', x + dx, y, z + dz, 0.9, 12, 0.9, '#2a2420', null, IRON);
    B.cyl('std', x, y - 7.2, z, 3.6, 1.6, '#2a2420', 6, 1, null, IRON);
  };
  if (wall) {
    // the frame was put at the light; the bracket reaches back to the wall
    const [wx, wz] = wall;
    rod(B, 'std', [wx, h + 12, wz], [0, h + 14, 0], 0.7, '#2a2420', IRON, 5);
    rod(B, 'std', [wx, h + 2, wz], [wx * 0.5, h + 13, wz * 0.5], 0.5, '#2a2420', IRON, 4);
    rod(B, 'std', [0, h + 14, 0], [0, h + 11, 0], 0.4, '#2a2420', IRON, 4);
    body(0, h + 2, 0);
  } else {
    B.cyl('std', 0, 0, 0, 2.6, h + 16, '#4a3420', 8, 0.8, null, WOOD);
    rod(B, 'std', [0, h + 14, 0], [12, h + 14, 0], 0.8, '#2a2420', IRON, 5);
    body(12, h + 2, 0);
  }
  if (P.halos && !day) P.halos.push({ x: it.x, y: it.y, h: h + 2, color: '#ffb562', size: 46, strength: 0.6, flicker: 0.12 });
}

/** The great doorways: an arch and its lintel over the gap between two gatehouse walls, or a stone frame. */
function doorway(P, it) {
  const { B, lod } = P;
  const w = it.w, H = it.h || 160;
  const th = it.th || 22;
  const col = it.kind === 'great' ? '#c9ad84' : '#cbb089';
  const R = w / 2;
  const spring = H - R * 0.55;
  // a shallow (segmental) arch: the spandrel up to the lintel's top
  archWall(B, 'std', 0, spring, 0, R, R * 0.55 + 22, th, col, 0, STONE, lod >= 1 ? 12 : 6);
  B.block('std', 0, H + 22, 0, w + 20, 10, th + 6, shadeHex(col, -0.1), null, STONE);
  if (it.kind === 'great') {
    if (lod >= 1) for (let i = 0; i < Math.floor((w + 20) / 24); i += 2) B.block('std', -w / 2 - 10 + (i + 0.5) * 24, H + 32, 0, 12, 12, th, col, null, STONE);
    // the carved name on both faces
    for (const s of [-1, 1]) pic(B, 's_gate', 0, H + 6, s * (th / 2 + 0.3), w * 0.9, w * 0.17, s > 0 ? 0 : PI);
    // the iron pins of the leaves' hinges
    if (lod >= 2) for (const s of [-1, 1]) for (const y of [20, 80, 140]) B.cyl('std', s * (R - 2), y, 0, 1.6, 6, '#1e1c1a', 6, 1, null, IRON);
  } else {
    for (const s of [-1, 1]) B.block('std', s * (R + 4), 0, 0, 8, H, th + 4, shadeHex(col, -0.06), null, STONE);
  }
}

/** The court's window: its head and shutters are the sill's model; a tile frieze under the lintel. */
function windowItem(P, it) {
  const { B, lod } = P;
  if (lod >= 1) pic(B, 'frieze', 0, 98, 11.2, it.w, 8, 0);
}

/**
 * The vault of a tunnel (the roof's own ceiling, art.roof): a barrel vault of stone on the houses'
 * walls, ribs every few metres, bulbs on a cable, and a flat roof over it.
 */
export function tunnelVault(P, r) {
  const { B, lod } = P;
  const alongX = r.w >= r.h;
  const L = alongX ? r.w : r.h, W = alongX ? r.h : r.w;
  const H = r.height || 120;
  const spring = H - W / 2 * 0.5;
  // (the vault's own length runs along its local z: turned to x for a tunnel along x)
  const ry = alongX ? HALF : 0;
  const col = '#a8957a';
  // the vault: a half cylinder, its axis along the tunnel, its inside facing down
  B.add('std', T.custom('ss-vault', vaultGeometry), [0, spring, 0], [W / 2, W / 2 * 0.5, L], [0, ry, 0], col, { ...S(DET.stucco, 0.95, 0), noAO: true });
  // the haunches: walls up to the springing between the houses' faces (a high vault only)
  if (spring > 96) for (const s of [-1, 1]) {
    if (alongX) B.block('std', 0, 96, s * (W / 2 - 2), L, spring - 96, 4, col, null, STONE);
    else B.block('std', s * (W / 2 - 2), 96, 0, 4, spring - 96, L, col, null, STONE);
  }
  // ribs
  if (lod >= 1) {
    const n = Math.floor(L / 120);
    for (let k = 1; k < n; k++) {
      const t = -L / 2 + (k / n) * L;
      B.add('std', T.custom('ss-rib', ribGeometry), [alongX ? t : 0, spring, alongX ? 0 : t], [W / 2, W / 2 * 0.5, 10], [0, ry, 0], shadeHex(col, -0.12), { ...STONE, noAO: true });
    }
  }
  // the roof over it
  B.block('std', 0, H + 4, 0, alongX ? L : W + 8, 6, alongX ? W + 8 : L, '#b9a27c', null, PLASTER);
}

/** A half cylinder of radius 1 (x −1..1, y 0..1 up), length 1 along z, faces pointing inward. */
function vaultGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true, -HALF, PI);
  // the cylinder's axis is y and the half is on +z: turn the axis to z and the half up
  g.rotateX(-HALF);
  const ng = g.toNonIndexed();
  const p = ng.attributes.position.array, n = ng.attributes.normal.array;
  // flip the winding and the normals: we look at the inside
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const a = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = a;
      const b = n[i + 3 + k]; n[i + 3 + k] = n[i + 6 + k]; n[i + 6 + k] = b;
    }
  }
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  ng.deleteAttribute('uv');
  return ng;
}

/** A rib under the vault: a half ring of radius 0.88..1. */
function ribGeometry() {
  const shape = new THREE.Shape();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * PI;
    if (i === 0) shape.moveTo(Math.cos(a), Math.sin(a)); else shape.lineTo(Math.cos(a), Math.sin(a));
  }
  for (let i = n; i >= 0; i--) {
    const a = (i / n) * PI;
    shape.lineTo(Math.cos(a) * 0.86, Math.sin(a) * 0.86);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -0.5);
  return g;
}

/** The terrace's floor dressing: a mosaic inlay in front of the site's mark and the site marks on the walls. */
function terrace(P, it) {
  const { B, lod } = P;
  if (lod < 1) return;
  P.objAbs(B, (it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, 0, 9500);
  const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
  // a tiled rosette set in the paving
  B.add('sssign', T.plane(), [3150 - cx, it.h + 0.35, 760 - cy], [90, 90, 1], [-HALF, 0, 0], '#ffffff', { uv: ssUV('zel3'), noAO: true, noJitter: true });
  // the site's sun on the wall of the house north of it
  pic(B, 'm_sun', 3150 - cx, it.h + 70, it.y0 + 0.4 - cy, 70, 70, 0, { bucket: 'ssdecal' });
}

/** The Cistern Court's mark and the square's frieze. */
function marks(P) {
  const { B } = P;
  P.objAbs(B, 765, 252, 0, 9600);
  decal(B, 'm_drop', 0, 80, 0.5, 70, 70, 0);
}

export const ITEMS = { stairs, ramp, gatearch: gateArch, arch: passArch, tarp, sign: signItem, lantern, doorway, window: windowItem, terrace, rampart() {}, tunnel() {}, marks };
