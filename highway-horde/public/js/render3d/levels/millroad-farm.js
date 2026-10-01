// Mill Road, sections 4 and 5: the Haskell cornfield (the corn itself, planted row by row as crossed
// alpha cards; the scarecrow; the tractor stuck in the rows; the centre-pivot irrigation line; the
// silos' auger, the grain bins, the barn's board, the machine shed and its combine, the farm gate) and
// the Roadhouse seen from Mill Road (its sign, office and diner from the hideout, the gate, the junk).

import {
  T, S, WOOD, RUSTY, METAL, CORR, CONC, FABRIC, PLAST, RUBBER, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, atlasUV, rod, plank, sign, sign2, decal, floorDecal, glowBox, crate, drum, tyre, toWorld, lvUV,
} from './millroad-kit.js';
import { wheel } from './millroad-jam.js';
import { building, diner } from '../world-bld.js';
import { pic, pic2, lantern } from '../world-hideout-kit.js';
import { COMMON_MODELS } from '../world-hideout-props.js';
import { ROADHOUSE_MODELS } from '../world-hideout-roadhouse.js';
import { hubUV as hubUVp } from '../world-hideout-atlas.js';

// ---- the corn -----------------------------------------------------------------------------------------------

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * Plant the corn of map.art.corn: rows along y every `row` units, a plant every `gap`; each plant two
 * (three on ultra) crossed cards of a corn picture, taller and denser away from the lanes, trampled flat
 * at the lanes' edges, none in the lanes, the clearings or on obstacles.
 */
export function plantCorn(P) {
  const { B, map } = P;
  const corn = map.art && map.art.corn;
  if (!corn) return;
  const lod = P.lod;
  const row = lod === 0 ? 34 : 24, gap = lod === 0 ? 50 : lod >= 2 ? 34 : 40;
  const cards = lod >= 2 ? 3 : 2;
  const cells = ['corn1', 'corn2', 'corn3'].map((c) => lvUV(c));
  const obs = map.obstacles.filter((o) => o.kind !== 'wall' || o.w < 400);
  const blocked = (x, y) => {
    for (const o of obs) {
      if (Math.abs(x - o.x) > 140 || Math.abs(y - o.y) > 140) continue;
      const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0), dx = x - o.x, dy = y - o.y;
      if (Math.abs(dx * c + dy * s) < o.w / 2 + 14 && Math.abs(-dx * s + dy * c) < o.h / 2 + 14) return true;
    }
    return false;
  };
  const seg = 400;   // plant in blocks so the geometry cells stay local
  for (const [x0, y0, x1, y1] of corn.rects) {
    for (let bx = x0; bx < x1; bx += seg) {
      for (let by = y0; by < y1; by += seg) {
        B.obj(bx, by, 0, Math.round(bx * 3 + by));
        B.setJitter(0);
        const r = B.rng;
        for (let x = bx + row / 2; x < Math.min(bx + seg, x1); x += row) {
          for (let y = by + r.range(0, gap); y < Math.min(by + seg, y1); y += gap * r.range(0.8, 1.2)) {
            const px = x + r.range(-3, 3), py = y;
            let edge = Infinity;
            for (const [ax, ay, bx2, by2, w] of corn.paths) edge = Math.min(edge, segDist(px, py, ax, ay, bx2, by2) - w / 2);
            for (const [cx, cy, cr] of corn.clear) edge = Math.min(edge, Math.hypot(px - cx, py - cy) - cr);
            const ragged = r.range(-18, 22);
            if (edge < ragged) continue;
            if (blocked(px, py)) continue;
            const lx = px - bx, lz = py - by;
            const trampled = edge < ragged + 26 && r.chance(0.45);
            const hgt = trampled ? r.range(40, 70) : r.range(92, 118) * (edge < 120 ? 0.92 : 1);
            const wid = hgt * 0.56;
            const tint = mixHex('#ffffff', r.chance(0.3) ? '#e8d8a0' : '#b8c8a0', r.range(0, 0.45));
            const uv = cells[Math.floor(r.next() * 3)];
            const yaw0 = r.range(0, PI);
            for (let k = 0; k < cards; k++) {
              const yaw = yaw0 + (k * PI) / cards;
              const lean = trampled ? r.range(0.9, 1.3) * (r.chance(0.5) ? 1 : -1) : r.range(-0.06, 0.06);
              B.add('lvleaf', T.plane(), [lx, trampled ? hgt * 0.22 : hgt / 2, lz], [wid, hgt, 1], [lean, yaw, 0], tint, { uv, noAO: true, noJitter: true });
            }
          }
        }
      }
    }
  }
  // the lanes: a fringe of fallen stalks along them, ruts down the tractor lane
  if (lod >= 1) {
    for (const [ax, ay, bx2, by2, w] of corn.paths) {
      const len = Math.hypot(bx2 - ax, by2 - ay), a = Math.atan2(by2 - ay, bx2 - ax);
      B.obj((ax + bx2) / 2, (ay + by2) / 2, a, Math.round(ax + ay));
      const r = B.rng;
      for (let i = 0; i < len / 30; i++) {
        const x = r.range(-len / 2, len / 2), z = (r.chance(0.5) ? 1 : -1) * r.range(w * 0.2, w * 0.5);
        B.add('lvleaf', T.plane(), [x, 1.5, z], [r.range(30, 60), r.range(16, 30), 1], [-HALF + r.range(-0.2, 0.2), r.range(0, 6), 0], '#d8c890', { uv: cells[Math.floor(r.next() * 3)], noAO: true, noJitter: true });
      }
    }
  }
}

// ---- the scarecrow, the tractor, the pivot ------------------------------------------------------------------------

/** The scarecrow on its cross in the clearing: sack head with a stitched face, hat, flannel, straw, crows. */
function scarecrow(P) {
  const { B } = P;
  const r = B.rng;
  rod(B, 'std', [0, 0, 0], [0, 150, 0], 3, '#5a4632', WOOD, 6);
  rod(B, 'std', [0, 112, -46], [0, 112, 46], 2.4, '#5a4632', WOOD, 6);
  // the body: a stuffed flannel shirt, overalls, straw at the cuffs and collar
  B.add('std', T.pillow(10, 8, 0.55), [0, 96, 0], [9, 22, 13], null, '#8a2a2a', FABRIC);
  for (let k = 0; k < 4; k++) B.box('std', 0, 80 + k * 10, 0, 18.4, 1.2, 26.4, '#2a1a1a', null, FABRIC);
  B.add('std', T.pillow(10, 8, 0.55), [0, 70, 0], [8, 12, 12], null, '#3a4a6a', FABRIC);
  for (const s of [-1, 1]) {
    B.add('std', T.pillow(8, 6, 0.55), [0, 110, s * 26], [5, 5, 18], [0.1 * s, 0, 0], '#8a2a2a', FABRIC);
    for (let k = 0; k < 7; k++) B.add('std', T.blade(), [0, 110 + r.range(-3, 3), s * (44 + r.range(0, 4))], [2, r.range(8, 14), 1], [r.range(-1, 1), r.range(0, 6), s * HALF + r.range(-0.5, 0.5)], '#d8c070', NJ);
    B.add('std', T.pillow(8, 6, 0.5), [0, 52, s * 6], [5, 18, 5], null, '#3a4a6a', FABRIC);
    for (let k = 0; k < 6; k++) B.add('std', T.blade(), [r.range(-2, 2), 32, s * 6 + r.range(-3, 3)], [2, r.range(8, 14), 1], [r.range(-0.4, 0.4), r.range(0, 6), 0], '#d8c070', NJ);
  }
  // the head: a burlap sack, tied at the neck, a stitched grin and button eyes; the hat
  B.add('std', T.sphere(12, 10), [0, 128, 0], [10, 12, 10], null, '#a8906a', { ...FABRIC, wobble: { amp: 0.06, seed: 3 } });
  B.cyl('std', 0, 116, 0, 5, 3, '#6a5a3a', 10, 1, null, FABRIC);
  for (const s of [-1, 1]) B.cyl('std', 9.2, 131, s * 3.6, 1.8, 1, '#1a1a1a', 8, 1, [0, 0, HALF], PLAST);
  for (let k = 0; k < 7; k++) B.box('std', 9.4, 123 + Math.sin(k * 0.5) * 1.2, -4.5 + k * 1.5, 0.6, 2.6, 0.5, '#1a1a1a', [0.3 * (k % 2 ? 1 : -1), 0, 0], NJ);
  B.cyl('std', 0, 138, 0, 18, 1, '#8a7040', 16, 1, null, FABRIC);
  B.cyl('std', 0, 139, 0, 9, 10, '#8a7040', 12, 0.8, null, FABRIC);
  // crows: one on the arm, one on the hat, two on the ground
  const crow = (x, y, z, rot) => {
    B.add('std', T.sphere(8, 6), [x, y + 4, z], [5, 4, 3], [0, rot, 0.2], '#141416', S(DET.fabric, 0.9, 0));
    B.add('std', T.sphere(6, 4), [x + Math.cos(rot) * 5, y + 7, z - Math.sin(rot) * 5], [2.6, 2.6, 2.6], null, '#141416', S(DET.fabric, 0.9, 0));
    B.add('std', T.cyl(3, 0.05), [x + Math.cos(rot) * 8, y + 7, z - Math.sin(rot) * 8], [0.9, 3, 0.9], [0, rot, -HALF], '#3a3020', NJ);
  };
  crow(0, 114, 34, 0.4);
  crow(0, 147, 0, 2.2);
  crow(30, 0, 40, 1.2);
  crow(-40, 0, -20, 4.1);
  // the pitchfork leaning on the post, a rotten pumpkin, blood on the post
  plank(B, 'std', [8, 0, -18], [3, 64, -8], 1.2, 1.2, '#6a4a30', WOOD);
  B.add('std', T.sphere(10, 8), [22, 7, 16], [9, 7, 9], null, '#b8641c', { ...PLAST, wobble: { amp: 0.08, seed: 9 } });
  if (P.lod >= 1) decal(B, 'drip', 3.2, 100, 0, 8, 24, HALF);
}

/** The tractor stuck in the rows: big rear wheels, the hood, a glass cab with its door open, a disc harrow. */
function tractor(P) {
  const { B, L, W } = P;
  const green = '#2f6a3a', yel = '#e0b020';
  // wheels
  for (const sd of [-1, 1]) {
    B.add('std', T.cyl(18), [-L * 0.22, 26, sd * (W / 2 - 8)], [26, 16, 26], [HALF, 0, 0], '#1a1a1a', { ...RUBBER, map: 'cyl' });
    B.add('std', T.cyl(14), [-L * 0.22, 26, sd * (W / 2 - 8 - 8.5 * sd * -1)], [16, 1, 16], [HALF, 0, 0], yel, { ...METAL, map: 'cyl' });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      B.add('std', T.box(), [-L * 0.22 + Math.cos(a) * 25, 26 + Math.sin(a) * 25, sd * (W / 2 - 8)], [4, 3, 17], [0, 0, a + 0.5], '#101010', RUBBER);
    }
    wheel(B, L * 0.3, 14, sd * (W / 2 - 10), 9, sd, yel);
  }
  // the chassis, the hood with its grille, the exhaust stack
  B.rblock('std', L * 0.1, 18, 0, L * 0.62, 12, 22, 2, '#2a2a2c', null, METAL);
  B.rblock('paint', L * 0.18, 26, 0, L * 0.5, 26, 24, 4, green, null, { surf: [DET.panel, -1, -1] });
  B.box('std', L * 0.43 + 0.6, 38, 0, 1, 18, 18, '#1a1a1a', null, S(DET.hesco, 0.5, 0.7));
  B.cyl('std', L * 0.3, 52, 7, 2.2, 26, '#1a1a1a', 8, 1, null, RUSTY);
  sign(B, 'mr_harvest', L * 0.18, 44, 12.4, 36, 9, 0);
  sign(B, 'mr_harvest', L * 0.18, 44, -12.4, 36, 9, PI);
  // the cab: roof, pillars, glass all round, the door hanging open
  const cx = -L * 0.2;
  B.rblock('paint', cx, 30, 0, 34, 20, W - 16, 2, green, null, { surf: [DET.panel, -1, -1] });
  for (const [x, z] of [[-16, -18], [16, -18], [-16, 18], [16, 18]]) B.box('std', cx + x, 66, z, 2, 52, 2, '#1a1a1a', null, METAL);
  B.rblock('std', cx, 92, 0, 40, 5, W - 12, 2, yel, null, METAL);
  for (const sd of [-1, 1]) B.box('glass', cx, 66, sd * 18.4, 30, 44, 0.5, '#1a2830', null, S(0, 0.08, 0.3));
  B.box('glass', cx + 16.4, 66, 0, 0.5, 44, 34, '#1a2830', null, S(0, 0.08, 0.3));
  B.add('std', T.box(), [cx - 4, 66, 30], [30, 44, 1.2], [0, 0.9, 0], '#1a2830', S(0, 0.08, 0.3));
  B.rblock('std', cx - 6, 42, 0, 14, 16, 16, 2, '#2a2a2c', null, FABRIC);
  // the disc harrow behind, tilted in the furrow
  B.box('std', -L / 2 - 20, 12, 0, 8, 6, W + 30, '#c62828', null, METAL);
  for (let i = -3; i <= 3; i++) B.add('std', T.cyl(16), [-L / 2 - 26, 9, i * 12], [9, 1.2, 9], [HALF, 0, 0.3], '#6a6e72', { ...RUSTY, map: 'cyl' });
  // mud on it, a smear on the door glass
  if (P.lod >= 1) floorDecal(B, 'grime', 0, 0, 180, 110, 0.2, 0.5, '#4a3a28');
}

/** The centre-pivot irrigation line across the field: the pivot, spans of truss on wheeled A-frames. */
function pivot(P) {
  const { B, o } = P;
  const len = o.len;
  const H = 128;
  // the pivot point: a pyramid tower with the gearbox and the swivel
  for (const [x, z] of [[-20, -20], [20, -20], [20, 20], [-20, 20]]) rod(B, 'std', [x, 0, z], [0, H, 0], 2, '#a8acb0', CHROME, 6);
  B.rblock('std', 0, H - 6, 0, 16, 16, 16, 1, '#6a6e72', null, METAL);
  B.rblock('std', 0, 0, 0, 60, 6, 60, 1, '#a8a498', null, CONC);
  const span = 205;
  const n = Math.floor(len / span);
  for (let i = 0; i < n; i++) {
    const x0 = i * span, x1 = (i + 1) * span;
    // the pipe and its truss: the pipe arches between towers, rods underneath
    const sag = 10;
    const pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([x0 + (x1 - x0) * t, H - Math.sin(t * PI) * -sag]); }
    for (let k = 0; k < 6; k++) rod(B, 'std', [pts[k][0], pts[k][1], 0], [pts[k + 1][0], pts[k + 1][1], 0], 3.4, '#b8bcc0', CHROME, 8);
    for (const sd of [-1, 1]) {
      rod(B, 'std', [x0, H, 0], [(x0 + x1) / 2, H - 34, sd * 8], 0.8, '#a8acb0', CHROME, 4);
      rod(B, 'std', [(x0 + x1) / 2, H - 34, sd * 8], [x1, H, 0], 0.8, '#a8acb0', CHROME, 4);
    }
    rod(B, 'std', [x0 + 20, H - 26, 0], [x1 - 20, H - 26, 0], 0.7, '#a8acb0', CHROME, 4);
    if (P.lod >= 1) for (let k = 1; k < 6; k++) rod(B, 'std', [x0 + k * span / 6, pts[k][1], 0], [x0 + k * span / 6, 40, 0], 0.3, '#2a2a2a', RUBBER, 3);
    // the tower at the span's outer end: an A-frame on two wheels, a motor box
    for (const sd of [-1, 1]) {
      rod(B, 'std', [x1, H, 0], [x1 + sd * 30, 20, 0], 1.8, '#a8acb0', CHROME, 6);
      B.add('std', T.cyl(14), [x1 + sd * 30, 18, 0], [18, 10, 18], [HALF, 0, 0], '#1a1a1a', { ...RUBBER, map: 'cyl' });
    }
    B.box('std', x1, 22, 0, 64, 4, 6, '#a8acb0', null, CHROME);
    B.rblock('std', x1, 28, 6, 10, 12, 8, 1, '#c8a020', null, METAL);
  }
  // the overhang and the end gun
  rod(B, 'std', [n * span, H, 0], [n * span + 70, H - 10, 0], 2, '#b8bcc0', CHROME, 6);
  B.add('std', T.cyl(8), [n * span + 72, H - 6, 0], [1.6, 12, 1.6], [0, 0, -0.6], '#c8ccd0', { ...CHROME, map: 'cyl' });
}

// ---- the farmyard ---------------------------------------------------------------------------------------------

/** The silos' auger up to the top, a catwalk between them, a grain truck's chute. */
function siloextras(P) {
  const { B } = P;
  // the auger: a long tube from a hopper on the ground up to the big silo's roof
  plank(B, 'std', [120, 10, 60], [20, 262, 10], 8, 8, '#8a8e92', METAL);
  rod(B, 'std', [120, 10, 60], [20, 262, 10], 5, '#9aa0a4', CHROME, 10);
  B.rblock('std', 130, 0, 66, 30, 20, 30, 2, '#c8a020', null, METAL);
  for (const sd of [-1, 1]) wheel(B, 90, 10, 50 + sd * 18, 5, sd);
  // a catwalk to the second silo
  plank(B, 'std', [-30, 262, -30], [-120, 250, -80], 10, 2, '#6a6e72', METAL);
  for (const s of [-1, 1]) rod(B, 'std', [-30, 272, -30 + s * 5], [-120, 260, -80 + s * 5], 0.5, '#6a6e72', METAL, 4);
  sign(B, 'mr_haskell', 0, 180, 51.4, 90, 22, 0);
}

/** A grain bin: a round corrugated bin on a slab, the conical roof, a ladder, the fan. */
function grainbin(P) {
  const { B, L } = P;
  const R = L / 2 - 4, H = 150;
  B.cyl('std', 0, 0, 0, R + 6, 6, '#a8a498', 22, 1, null, CONC);
  B.cyl('std', 0, 6, 0, R, H, '#c0c4c6', 24, 1, null, CORR);
  for (let y = 30; y < H; y += 30) B.cyl('std', 0, 6 + y, 0, R + 0.6, 1.6, '#9aa0a4', 24, 1, null, METAL);
  B.add('std', T.cyl(24, 0.12), [0, H + 6 + 20, 0], [R + 3, 40, R + 3], null, '#b8bcbe', { ...S(DET.metalroof, 0.5, 0.6), map: 'cyl' });
  B.cyl('std', 0, H + 44, 0, 5, 8, '#8a8e92', 10, 1, null, METAL);
  for (const z of [-4, 4]) B.box('std', R + 2, (H + 6) / 2, z, 1, H, 1, '#6a6e72', null, METAL);
  for (let y = 10; y < H; y += 10) B.box('std', R + 2, y, 0, 1, 0.8, 8, '#6a6e72', null, METAL);
  B.rblock('std', -R - 10, 6, 0, 18, 22, 22, 2, '#6a6e72', null, METAL);
  B.cyl('std', -R - 20, 17, 0, 9, 2, '#2a2a2c', 12, 1, [0, 0, HALF], METAL);
}

/** The barn's board and a hay loft door ajar, a manure spreader by it. */
function barnsign(P) {
  const { B, o } = P;
  const h = o.h;
  B.box('std', 0, 112, h / 2 + 2, 150, 38, 2, '#f0e8d0', null, WOOD);
  sign(B, 'mr_haskell', 0, 112, h / 2 + 3.2, 146, 36.5, 0);
  B.add('std', T.box(), [50, 60, h / 2 + 20], [50, 70, 2], [0, 0.6, 0], '#7d3a2c', WOOD);
  // hay spilling from the door, a spreader, a trough
  for (let i = 0; i < 12; i++) B.add('std', T.blade(), [B.rng.range(-40, 40), 0, h / 2 + B.rng.range(10, 50)], [4, B.rng.range(4, 10), 1], [B.rng.range(-1.2, 1.2), B.rng.range(0, 6), 0], '#d8c070', NJ);
  B.rblock('std', -150, 14, h / 2 + 60, 80, 24, 40, 2, '#c62828', null, METAL);
  for (const sd of [-1, 1]) wheel(B, -170, 14, h / 2 + 60 + sd * 22, 6, sd);
}

/** The combine harvester parked in the shed: the header, the feeder, the cab, the tank, the unloader. */
function combine(P) {
  const { B, L, W } = P;
  const green = '#2f7a3a', yel = '#e0c020';
  for (const sd of [-1, 1]) {
    B.add('std', T.cyl(18), [L * 0.18, 30, sd * (W / 2 - 10)], [30, 18, 30], [HALF, 0, 0], '#1a1a1a', { ...RUBBER, map: 'cyl' });
    B.add('std', T.cyl(14), [L * 0.18, 30, sd * (W / 2 - 1)], [17, 1, 17], [HALF, 0, 0], yel, { ...METAL, map: 'cyl' });
    wheel(B, -L * 0.34, 16, sd * (W / 2 - 12), 10, sd, yel);
  }
  B.rblock('paint', -L * 0.05, 34, 0, L * 0.72, 70, W - 14, 4, green, null, { surf: [DET.panel, -1, -1] });
  B.rblock('paint', -L * 0.12, 104, 0, L * 0.46, 30, W - 10, 3, shadeHex(green, 0.08), null, { surf: [DET.panel, -1, -1] });
  // the cab up front
  B.rblock('paint', L * 0.26, 104, -8, 34, 8, 36, 2, green, null, { surf: [DET.panel, -1, -1] });
  B.box('glass', L * 0.26, 128, -8, 30, 38, 32, '#1a2830', null, S(0, 0.08, 0.3));
  B.rblock('std', L * 0.26, 148, -8, 38, 4, 40, 2, '#e8e4dc', null, METAL);
  // the feeder and the header (the wide cutter bar with its reel)
  B.add('std', T.box(), [L * 0.46, 40, 0], [40, 20, 36], [0, 0, -0.35], green, METAL);
  B.rblock('std', L * 0.62, 10, 0, 30, 16, W * 2.2, 2, yel, null, METAL);
  B.add('std', T.cyl(12), [L * 0.66, 34, 0], [8, W * 2.1, 8], [HALF, 0, 0], '#c8a010', { ...METAL, map: 'cyl' });
  for (let z = -W; z <= W; z += 8) B.box('std', L * 0.7, 10, z, 10, 2, 1.4, '#8a8e92', null, METAL);
  // the unloading auger folded along the side
  rod(B, 'std', [-L * 0.3, 120, W / 2 - 4], [L * 0.2, 128, W / 2 + 6], 4, green, METAL, 8);
  sign(B, 'mr_harvest', 0, 80, W / 2 - 6.8, 50, 12, 0);
}

/** The machine shed's roof: a corrugated lean-to on trusses, open to the south. */
function shedroof(P) {
  const { B, o } = P;
  const w = o.w, h = o.h;
  B.add('std', T.box(), [0, 148, 0], [w + 10, 2, h + 16], [-0.1, 0, 0], '#8a8e90', S(DET.corrugated, 0.5, 0.5));
  for (let x = -w / 2 + 20; x < w / 2; x += 60) {
    plank(B, 'std', [x, 138, -h / 2], [x, 138, h / 2], 5, 4, '#6a6e72', METAL);
    plank(B, 'std', [x, 138, 0], [x, 150, -h / 2 + 10], 3, 3, '#6a6e72', METAL);
  }
  for (const x of [-w / 2 + 8, 0, w / 2 - 8]) B.box('std', x, 70, h / 2 - 20, 6, 140, 6, '#6a6e72', null, METAL);
}

/** The farm gate onto Mill Road: two posts, a five-bar steel gate swung open, a HASKELL mailbox. */
function farmgate(P) {
  const { B, o } = P;
  const w = o.w;
  for (const s of [-1, 1]) B.cyl('std', s * (w / 2 + 6), 0, 0, 4, 60, '#5a4632', 8, 1, null, WOOD);
  // the gate: swung back along the fence line
  const g = w / 2 + 4;
  for (const y of [10, 20, 30, 40, 50]) plank(B, 'std', [w / 2 + 6, y, 0], [w / 2 + 6 - Math.cos(1.7) * g, y, -Math.sin(1.7) * g], 2, 1.6, '#8a8e92', METAL);
  plank(B, 'std', [w / 2 + 6, 8, 0], [w / 2 + 6 - Math.cos(1.7) * g, 50, -Math.sin(1.7) * g], 2, 1.6, '#8a8e92', METAL);
  B.cyl('std', -w / 2 - 30, 0, 20, 2, 36, '#5a4632', 6, 1, null, WOOD);
  B.rblock('std', -w / 2 - 30, 36, 20, 16, 9, 9, 3, '#8a2a2a', null, METAL);
  sign(B, 'mr_haskell', 0, 76, 0.9, 120, 30, 0);
  sign(B, 'mr_haskell', 0, 76, -0.9, 120, 30, PI);
  B.box('std', 0, 76, 0, 124, 34, 1.4, '#e8e0cc', null, WOOD);
  for (const s of [-1, 1]) rod(B, 'std', [s * 58, 60, 0], [s * 58, 94, 0], 1.6, '#5a4632', WOOD, 5);
}

// ---- the Roadhouse -----------------------------------------------------------------------------------------------

/** The hideout's own models on the level: the context they read. */
function hubP(P, it, L, W) {
  return { ...P, it, o: it, L, W, hub: { id: 'roadhouse' }, dyn: P.dyn, tier: P.full };
}

/** The motel office: a house-type building with the hideout office's sign, lantern and firewood. */
function rhoffice(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  ROADHOUSE_MODELS.rhoffice(hubP(P, o, o.w, o.h));
}

/** The diner with its neon (the truck stop's), plus the hideout diner's OPEN and CAFE and the chalkboard. */
function rhdiner(P) {
  const { B, o, halos } = P;
  diner(B, o.w, o.h, halos, o);
  ROADHOUSE_MODELS.rhdiner(hubP(P, o, o.w, o.h));
}

/** The ROADHOUSE pole sign: the hideout's neon sign, taller, on a concrete base. */
function rhsign(P) {
  const { B, o } = P;
  COMMON_MODELS.signpole(hubP(P, { ...o, h: 320 }, 0, 0));
  // by day the tubes are pale glass: the letters painted on the cabinets behind them still read
  const H = 320;
  for (const [cell, y, z, w, h] of [['n_roadhouse', H - 20, 0, 166, 36], ['n_motel', H - 66, 0, 86, 21], ['n_vacancy', H - 104, 8, 96, 24]]) {
    for (const s of [-1, 1]) B.add('hub', T.plane(), [s * 4.2, y, z], [w, h, 1], [0, s * HALF, 0], P.day ? '#d8c8c0' : '#3a3036', { uv: hubUVp(cell), noAO: true, noJitter: true });
  }
  B.rblock('std', 0, 0, 0, 30, 12, 30, 1, '#a8a498', null, CONC);
}

/** The Roadhouse's gate (the gate obstacle, slides open): scrap sheets on a steel frame, HAVEN OR BUST. */
function rhgate(P) {
  const { B, L } = P;
  const H = 100;
  const r = B.rng;
  B.box('std', 0, 3, 0, L, 6, 5, '#3a3c3e', null, RUSTY);
  B.box('std', 0, H - 2, 0, L, 4, 5, '#3a3c3e', null, RUSTY);
  for (const x of [-L / 2 + 2, 0, L / 2 - 2]) B.box('std', x, H / 2, 0, 4, H, 5, '#3a3c3e', null, RUSTY);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const k = r.next();
    B.block('std', x, 6, -1.5, L / n - 2, H - 10, 2.2, k < 0.5 ? r.pick(['#8f979c', '#7a8a92', '#9a8a6a']) : r.pick(['#b9955a', '#a8844e']), [0, 0, r.range(-0.02, 0.02)], k < 0.5 ? CORR : WOOD);
  }
  B.add('hub', T.plane(), [0, 58, -3], [L * 0.8, L * 0.2, 1], [0, PI, 0], '#ffffff', { uv: hubUVp('p_haven'), noAO: true, noJitter: true });
  B.add('hub', T.plane(), [0, 58, 3], [L * 0.8, L * 0.2, 1], null, '#ffffff', { uv: hubUVp('p_haven'), noAO: true, noJitter: true });
  for (let i = 0; i < 9; i++) B.add('std', T.torus(6, 0.2, 3), [-9 + i * 2.3, 40, -4.4], [1.5, 1.5, 1.5], [i % 2 ? HALF : 0, 0, 0], '#9a9ea2', METAL);
}

/** The gate's frame: posts, amber lamps, a sandbag nest, a watch platform with a lantern. */
function rhgateframe(P) {
  const { B, o, halos } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 12);
    B.box('std', x, 65, 0, 14, 130, 14, '#4a3a2a', null, WOOD);
    B.box('std', x, 131, 0, 18, 3, 18, '#3a3e42', null, METAL);
    B.add('blink', T.sphere(6, 4), [x, 136, 0], [2.4, 2.4, 2.4], null, '#ffb020', { emissive: 3 });
    const [wx, wy] = toWorld(o, x, 0);
    halos.push({ x: wx, y: wy, h: 136, color: '#ffb020', size: 64, blink: 1, strength: 0.6 });
  }
  // the track and a lookout on the east post
  B.box('std', w / 2 + 130, 0.6, 0, w + 20, 1.2, 4, '#3a3c3e', null, RUSTY);
  B.rblock('std', w / 2 + 40, 120, 20, 60, 3, 50, 0.5, '#6a4a30', null, WOOD);
  for (const [x, z] of [[20, 0], [60, 0], [20, 40], [60, 40]]) B.box('std', w / 2 + x, 60, z, 4, 120, 4, '#4a3a2a', null, WOOD);
  for (const s of [-1, 1]) B.box('std', w / 2 + 40, 132, 20 + s * 25, 60, 2, 2, '#6a4a30', null, WOOD);
  const [lx, ly] = toWorld(o, w / 2 + 40, 20);
  lantern(B, halos, w / 2 + 40, 123, 20, lx, ly, { h: 9, halo: 60, strength: 0.6 });
  // HAVEN OR BUST over the gate
  sign(B, 'mr_rhboard', 0, 150, 0.9, 150, 37.5, 0);
  sign(B, 'mr_rhboard', 0, 150, -0.9, 150, 37.5, PI);
  B.box('std', 0, 150, 0, 156, 42, 1.4, '#6a4a30', null, WOOD);
}

/** The junk yard east of the motel: stacks of crushed cars, tyres, an engine block, a rusty sign. */
function junk(P) {
  const { B } = P;
  const r = B.rng;
  for (let s = 0; s < 4; s++) {
    const x = r.range(-150, 150), z = r.range(-250, 250);
    for (let k = 0; k < 3; k++) {
      const c = r.pick(['#5a3a2a', '#3a4450', '#6a6a60', '#2a3a2a', '#7a5a2a', '#8a2a2a']);
      B.add('std', T.rbox(84, 16, 40, 3), [x + r.range(-4, 4), 8 + k * 16.4, z + r.range(-4, 4)], [1, 1, 1], [r.range(-0.05, 0.05), r.range(-0.3, 0.3), r.range(-0.05, 0.05)], shadeHex(c, -0.2), S(DET.rust, 0.7, 0.4));
    }
  }
  for (let i = 0; i < 16; i++) tyre(B, r.range(-180, 180), 4 + (i % 3) * 7, r.range(-280, 280), 9, [HALF, 0, r.range(-0.2, 0.2)]);
  for (let i = 0; i < 5; i++) drum(B, r.range(-150, 150), 0, r.range(-280, 280), r.pick(['#3b5f8a', '#6a4a38', '#c8a020']), 30, 10, r.chance(0.4) ? r.range(0, 3) : 0);
}

export const FARM_MODELS_LV = {
  'mr-scarecrow': scarecrow, 'mr-tractor': tractor, 'mr-pivot': pivot, 'mr-siloextras': siloextras, 'mr-grainbin': grainbin, 'mr-barnsign': barnsign,
  'mr-combine': combine, 'mr-farmgate': farmgate, 'mr-rhoffice': rhoffice, 'mr-rhdiner': rhdiner, 'mr-rhsign': rhsign, 'mr-rhgateframe': rhgateframe, 'mr-junk': junk,
};
export const FARM_GATES = { 'mr-rhgate': rhgate };
export const FARM_ROOFS = { 'mr-shedroof': shedroof };
void [CORR, FABRIC, NJ, glowBox, crate, atlasUV, pic, CHROME, WOOD];
