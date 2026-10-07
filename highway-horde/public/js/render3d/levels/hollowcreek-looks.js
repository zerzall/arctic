// Hollow Creek's wall looks, door kinds and floors, added to the kit's tables (millroad-kit.js): the brick
// and glass of Main Street's shops, the diner's steel and tile, the Rexall, St. Anne's stone and its
// lancet windows, the school's brick and block, the station's; the town's fences (a board privacy fence,
// the churchyard's fieldstone wall, the hedge), the cells' bars; church and gym double doors, the stock
// room's swing doors, the cell doors, the pharmacy's grille housing; flagstone and gym maple floors.

import {
  LOOKS, FLOORS, WALL_DRAW, DOORS, DOOR_TRIM, DOOR_H, T, S, WOOD, METAL, RUSTY, CONC, CHROME, HALF, PI,
  shadeHex, mixHex, hash01, DET, rod, plank, sign, decal, lvUV, lightBeam,
} from './millroad-kit.js';
import { card, cardList, listGeo, randDir } from '../world-flora.js';
import { LEAF_CELLS } from '../world-tex.js';

const F = (c, l, r = 0.86, m = 0) => ({ c, l, r, m });
const STONE = F('#b3a893', DET.rock, 0.92);

// ---- St. Anne's lancets ------------------------------------------------------------------------------

/**
 * A pointed-arch window of stained glass in a hole of the wall: stepped stone filling the arch's
 * shoulders, the leaded glass (lit by the sky from inside by day, dark and glinting from outside), a
 * stone sill, a hood moulding.
 */
function lancetWindow(P, h, t, look, side) {
  const { B, o } = P;
  const w = h.x1 - h.x0, hh = h.y1 - h.y0, cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
  const rev = shadeHex(look.ext.c, -0.12);
  B.box('std', cx, h.y0 - 0.6, 0, w, 1.2, t, rev, null, { noJitter: true, ...CONC });
  // the arch's shoulders: bands of stone narrowing the opening toward the apex
  const archH = Math.min(hh * 0.3, w * 0.9);
  const bands = P.lod >= 1 ? 6 : 3;
  for (let k = 0; k < bands; k++) {
    const d0 = k / bands, d1 = (k + 1) / bands, dm = (d0 + d1) / 2;
    const half = (w / 2) * Math.sqrt(1 - (1 - dm) * (1 - dm));
    const fill = w / 2 - half;
    if (fill < 0.3) continue;
    const y = h.y1 - archH * dm, bh = archH / bands + 0.2;
    for (const s of [-1, 1]) B.box('std', cx + s * (w / 2 - fill / 2), y, 0, fill, bh, t, rev, null, { noJitter: true, surf: [DET.rock, 0.9, 0] });
  }
  const seed = Math.round(o.x * 7 + o.y * 13) + h.i * 31;
  const cell = ['hc_glass1', 'hc_glass2', 'hc_glass3'][Math.floor(hash01(seed) * 3)];
  const broken = hash01(seed + 5) < 0.2;
  const uv = lvUV(cell);
  // outside: dark glass with a sheen; inside: the sky through it (dim at night)
  B.add('lvsign', T.plane(), [cx, cy, -0.5], [w - 1, hh - 1, 1], [0, PI, 0], P.day ? '#7a7a88' : '#2a2a34', { uv, noAO: true, noJitter: true });
  if (side !== 'out') B.add('lvglow', T.plane(), [cx, cy, 0.5], [w - 1, hh - 1, 1], null, P.day ? '#fff4e8' : '#3a3c50', { uv, noAO: true, noJitter: true });
  if (broken && P.lod >= 1) {
    // a pane knocked out low down: a dark hole in the glass
    B.box('std', cx + (hash01(seed + 7) - 0.5) * w * 0.4, h.y0 + hh * 0.18, 0, w * 0.3, hh * 0.14, 1.4, '#0a0a0c', null, { noJitter: true, surf: [0, 0.9, 0] });
  }
  // coloured daylight in through the glass
  if (side !== 'out') lightBeam(P, h, ['#a8a0d0', '#d0a090', '#a0c8a8'][Math.floor(hash01(seed) * 3)]);
  // the sill and a hood moulding over the arch (outside)
  B.box('std', cx, h.y0 - 1.6, -t / 2 - 1.4, w + 6, 3, 4, shadeHex(look.ext.c, 0.08), null, { noJitter: true, ...CONC });
  if (P.lod >= 1) {
    for (const s of [-1, 1]) B.add('std', T.box(), [cx + s * w * 0.27, h.y1 - archH * 0.35, -t / 2 - 1], [w * 0.62, 2.4, 2.4], [0, 0, s * -0.95], shadeHex(look.ext.c, 0.08), { noJitter: true, ...CONC });
  }
}

// ---- looks -----------------------------------------------------------------------------------------------

Object.assign(LOOKS, {
  // Main Street
  hardware: { h: 150, ext: F('#8a4a3a', DET.brick, 0.9), int: F('#d8d0bc', DET.brick, 0.85), plinth: '#6a5a4a', cap: '#5a5048', skirt: '#3a3430', crown: 140, win: { w: 50, h: 30, sill: 96, pitch: 170, margin: 70, state: 'mix' } },
  hwfront: { h: 150, ext: F('#8a4a3a', DET.brick, 0.9), int: F('#d8d0bc', DET.brick, 0.85), plinth: '#6a5a4a', cap: '#5a5048', band: { c: '#1f3a5a', y0: 108, y1: 142 }, skirt: '#3a3430', crown: 140, store: { sill: 16, head: 96, pitch: 62, frame: '#2a2622' } },
  diner: { h: 130, ext: F('#c8ccce', DET.panel, 0.32, 0.7), int: F('#f2ece0', DET.tile, 0.4), plinth: '#b3261e', cap: '#b8bcc0', band: { c: '#b3261e', y0: 100, y1: 110 }, skirt: '#b3261e', crown: 124, rail: 58, win: { w: 56, h: 36, sill: 54, pitch: 90, margin: 40, state: 'mix' } },
  dinerfront: { h: 130, ext: F('#c8ccce', DET.panel, 0.32, 0.7), int: F('#f2ece0', DET.tile, 0.4), plinth: '#b3261e', cap: '#b8bcc0', band: { c: '#b3261e', y0: 104, y1: 128 }, skirt: '#b3261e', crown: 124, store: { sill: 40, head: 96, pitch: 58, frame: '#c0c4c8' } },
  dinerint: { h: 130, ext: F('#e8ece8', DET.tile, 0.4), int: F('#e8ece8', DET.tile, 0.4), skirt: '#3a3c3e', crown: 124 },
  // the Rexall
  pharm: { h: 140, ext: F('#c8a47a', DET.brick, 0.9), int: F('#e8ecee', DET.drywall, 0.8), plinth: '#7a6a5a', cap: '#1a4a8a', band: { c: '#e06a1a', y0: 118, y1: 126 }, skirt: '#3a5a6a', crown: 132, win: { w: 60, h: 36, sill: 64, pitch: 190, margin: 90, state: 'mix' } },
  pharmfront: { h: 140, ext: F('#c8a47a', DET.brick, 0.9), int: F('#e8ecee', DET.drywall, 0.8), plinth: '#7a6a5a', cap: '#1a4a8a', band: { c: '#1a4a8a', y0: 115, y1: 139 }, skirt: '#3a5a6a', crown: 132, store: { sill: 18, head: 96, pitch: 70, frame: '#b8bcc0' } },
  pharmint: { h: 130, ext: F('#e0e4e4', DET.drywall, 0.8), int: F('#e0e4e4', DET.drywall, 0.8), skirt: '#3a5a6a', crown: 126 },
  brickwall: { h: 104, ext: F('#8a4a3a', DET.brick, 0.9), plinth: '#6a5e54', cap: '#9a948a' },
  // St. Anne's
  nave: { h: 170, ext: STONE, int: F('#efe6d4', DET.plaster, 0.85), plinth: '#7a7468', cap: '#8a8478', skirt: '#4a3424', rail: 46, crown: 160, win: { w: 34, h: 96, sill: 52, pitch: 150, margin: 100, draw: lancetWindow } },
  tower: { h: 170, ext: STONE, int: F('#c8c0b0', DET.rock, 0.9), plinth: '#7a7468', cap: '#8a8478', win: { w: 26, h: 64, sill: 76, pitch: 300, margin: 70, draw: lancetWindow } },
  // the school
  school: { h: 150, ext: F('#a85a3a', DET.brick, 0.9), int: F('#e8e4d4', DET.brick, 0.8), plinth: '#6a6056', cap: '#e8e4dc', skirt: '#3a3c3e', crown: 112, win: { w: 84, h: 44, sill: 36, pitch: 130, margin: 70, state: 'mix' } },
  gymwall: { h: 150, ext: F('#e0dccc', DET.brick, 0.8), int: F('#e0dccc', DET.brick, 0.8), skirt: '#2a4a6a', crown: 112 },
  schoolint: { h: 120, ext: F('#e0dccc', DET.brick, 0.8), int: F('#e0dccc', DET.brick, 0.8), skirt: '#2a4a6a', rail: 40, crown: 112 },
  // the police station
  police: { h: 125, ext: F('#9a7a60', DET.brick, 0.9), int: F('#e4e2d8', DET.brick, 0.8), plinth: '#5a524a', cap: '#4a4e52', band: { c: '#1a3a6a', y0: 102, y1: 110 }, skirt: '#2a2c2e', crown: 118, win: { w: 50, h: 24, sill: 70, pitch: 160, margin: 70, state: 'glass' } },
  policeint: { h: 125, ext: F('#dcdad0', DET.brick, 0.8), int: F('#dcdad0', DET.brick, 0.8), skirt: '#2a3a4a', crown: 118 },
  // fences and bars (WALL_DRAW below)
  woodfence: { h: 64, draw: 'woodfence' },
  stonewall: { h: 64, draw: 'stonewall' },
  hedge: { h: 88, draw: 'hedge' },
  bars: { h: 125, draw: 'bars' },
});

Object.assign(FLOORS, {
  stone: { c1: '#8a8478', c2: '#7a7468', tile: 30, l: DET.slab, r: 0.8 },
  gym: { c1: '#c8985a', l: DET.wood, r: 0.35, planks: 4 },
});

// ---- fences and bars ---------------------------------------------------------------------------------------

Object.assign(WALL_DRAW, {
  /** A board privacy fence: posts, two rails on the back, dog-eared boards (a few missing or kicked in). */
  woodfence(P, look) {
    const { B, o } = P;
    const L = o.w, H = look.h, r = B.rng;
    const post = '#5a4632';
    for (let x = -L / 2; x <= L / 2 + 0.1; x += L / Math.max(1, Math.round(L / 80))) B.box('std', x, H / 2 + 2, 2, 4, H + 4, 4, post, null, WOOD);
    for (const y of [12, H - 10]) B.box('std', 0, y, 3.6, L, 4, 2.4, post, null, WOOD);
    if (P.lod === 0) {
      B.box('std', 0, H / 2, 0, L, H, 1.4, '#8a6a48', null, { noJitter: true, ...WOOD });
      return;
    }
    const bw = 5.6;
    const n = Math.floor(L / bw);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + (i + 0.5) * bw;
      if (r.chance(0.025)) continue;
      const kicked = r.chance(0.02);
      const c = mixHex('#8a6a48', '#a88a62', r.next() * 0.7);
      const h = H - r.range(0, 2);
      if (kicked) { B.add('std', T.box(), [x, 4, -8], [bw - 0.6, 1.2, h * 0.8], [0, r.range(-0.3, 0.3), 0], shadeHex(c, -0.1), WOOD); continue; }
      B.box('std', x, h / 2, 0, bw - 0.5, h, 1.2, c, [0, 0, r.range(-0.01, 0.01)], { noJitter: true, ...WOOD });
    }
    if (P.lod >= 2 && L > 200 && r.chance(0.5)) decal(B, r.pick(['graf2', 'graf3', 'hc_church_graf', 'graf4']), r.range(-L * 0.3, L * 0.3), 34, -0.8, 110, 40, PI);
  },
  /** St. Anne's churchyard wall: courses of fieldstone, a rounded coping, moss at the foot. */
  stonewall(P, look) {
    const { B, o } = P;
    const L = o.w, t = o.h, H = look.h, r = B.rng;
    B.box('std', 0, H / 2, 0, L, H, t - 3, '#7a7466', null, { noJitter: true, surf: [DET.rock, 0.95, 0] });
    if (P.lod >= 1) {
      // the facing stones on both sides, course by course
      for (const f of [-1, 1]) {
        for (let y = 5; y < H - 6; y += 11) {
          let x = -L / 2 + r.range(0, 8);
          while (x < L / 2 - 4) {
            const sw = Math.min(r.range(12, 26), L / 2 - x);
            const c = mixHex('#9a9282', '#6e6a5e', r.next());
            B.box('std', x + sw / 2, y + r.range(-1, 1), f * (t / 2 - 1.2), sw - 1.4, r.range(8.5, 11), 3, c, [r.range(-0.03, 0.03), 0, r.range(-0.05, 0.05)], { noJitter: true, surf: [DET.rock, 0.95, 0] });
            x += sw;
          }
        }
      }
    }
    // the coping: rounded capstones
    B.add('std', T.cyl(10, 1, false), [0, H, 0], [t / 2 + 1, L, 5], [0, 0, HALF], '#a8a092', { noJitter: true, surf: [DET.rock, 0.9, 0], map: 'cyl' });
    if (P.lod >= 2) for (let x = -L / 2 + 20; x < L / 2; x += r.range(60, 140)) B.add('std', T.sphere(6, 4), [x, 2, (r.chance(0.5) ? 1 : -1) * (t / 2 + 1)], [r.range(8, 16), 3, 4], null, '#4a5a2a', { noJitter: true, surf: [DET.grass, 0.95, 0] });
  },
  /** A clipped privet hedge: a dark core, leaf cards over it, a gap worn at the foot here and there. */
  hedge(P, look) {
    const { B, o } = P;
    const L = o.w, t = Math.max(o.h, 24), H = look.h, r = B.rng;
    const col = '#3a5a2a';
    B.rblock('std', 0, 0, 0, L, H - 6, t, 6, shadeHex(col, -0.45), null, { noJitter: true, surf: [DET.grass, 0.95, 0] });
    const cards = cardList();
    const n = Math.round(L / (P.lod >= 2 ? 5 : P.lod >= 1 ? 8 : 16));
    const cc = [0, H * 0.4, 0];
    for (let i = 0; i < n; i++) {
      const f = randDir(r);
      const side = r.chance(0.5) ? 1 : -1;
      const top = r.chance(0.3);
      const c = [r.range(-L / 2, L / 2), top ? H - 6 + r.range(-2, 3) : r.range(8, H - 8), top ? r.range(-t / 2, t / 2) : side * (t / 2 + r.range(-1, 2))];
      if (!top) f.z = side * Math.abs(f.z) + side * 0.6;
      else f.y = Math.abs(f.y) + 0.8;
      f.normalize();
      card(cards, c, f, r.range(0, 6.28), r.range(16, 24), r.range(16, 24), [c[0], cc[1], 0], LEAF_CELLS.scrub, 1.5);
    }
    B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  },
  /** A line of cell bars: flat bar frame, round bars, cross straps. */
  bars(P, look) {
    const { B, o } = P;
    const L = o.w, H = look.h;
    const c = '#4a5258';
    const mo = { noJitter: true, ...S(DET.panel, 0.4, 0.8) };
    for (const y of [2, 44, 90, H - 2]) B.box('std', 0, y, 0, L, 3, 2.4, c, null, mo);
    for (let x = -L / 2 + 3; x < L / 2; x += 6) B.add('std', T.cyl(6), [x, H / 2, 0], [0.8, H, 0.8], null, c, { ...mo, map: 'cyl' });
  },
});

// ---- doors -------------------------------------------------------------------------------------------------------

Object.assign(DOOR_TRIM, { grille: '#9aa0a4', swing: '#6a6e72', wood2: '#5a3a22', cell: '#4a5258', bars: '#4a5258' });
Object.assign(DOOR_H, { wood2: 96, grille: 96 });

/** A barred door leaf (hinged at x0, swung `a`). */
function barLeaf(B, x0, len, dh, a, zoff = 0) {
  const c = '#4a5258';
  const mo = { noJitter: true, ...S(DET.panel, 0.4, 0.8) };
  const ux = Math.cos(a) * Math.sign(len), uz = Math.sin(Math.abs(a));
  const at = (s) => [x0 + ux * s, zoff + uz * s];
  const L = Math.abs(len);
  for (const y of [3, dh * 0.45, dh - 3]) {
    const [mx, mz] = at(L / 2);
    B.add('std', T.box(), [mx, y, mz], [L, 2.6, 2], [0, -Math.atan2(uz, ux), 0], c, mo);
  }
  for (let s = 3; s < L - 1; s += 6) {
    const [bx, bz] = at(s);
    B.add('std', T.cyl(6), [bx, dh / 2, bz], [0.8, dh - 2, 0.8], null, c, { ...mo, map: 'cyl' });
  }
  const [lx, lz] = at(L - 4);
  B.box('std', lx, dh * 0.5, lz, 6, 10, 4, '#3a3e42', null, mo);
}

Object.assign(DOORS, {
  /** The Rexall's front: the grille's coil box and guide channels outside, smashed glass doors set back. */
  grille(P) {
    const { B, w, t, dh } = P;
    const z = -t / 2 - 5;
    B.rblock('std', 0, dh + 1, z, w + 16, 15, 12, 1, '#8a8e92', null, { noJitter: true, ...S(DET.panel, 0.45, 0.6) });
    for (const s of [-1, 1]) B.box('std', s * (w / 2 + 3), dh / 2, z + 2, 5, dh, 6, '#7a7e82', null, { noJitter: true, ...RUSTY });
    const al = '#b8bcc0';
    const lw = w / 4;
    for (const s of [-1, 1]) {
      // two leaves each side of the opening's middle, one pushed in, one shut and smashed
      B.add('std', T.box(), [s * (w / 2 - lw / 2 - 2), dh / 2, t / 2 - 2], [lw, dh - 2, 2.2], null, al, CHROME);
      B.add('std', T.box(), [s * (lw * 0.6), dh / 2, t / 2 + lw * 0.45], [lw, dh - 2, 2.2], [0, s * 1.1, 0], al, CHROME);
      B.add('vglass', T.box(), [s * (lw * 0.6), dh / 2 + 4, t / 2 + lw * 0.45], [lw - 6, dh - 20, 2.4], [0, s * 1.1, 0], '#8fa2ac', { noJitter: true, surf: [0, 0.06, 0] });
    }
    if (P.lod >= 1) for (let k = 0; k < 14; k++) B.add('glass', T.box(), [B.rng.range(-w / 2, w / 2), 0.7, t / 2 + B.rng.range(2, 40)], [B.rng.range(2, 6), 0.3, B.rng.range(2, 5)], [0, B.rng.range(0, 6), 0], '#9ab4c0', S(0, 0.1, 0.2));
  },
  /** Double swing doors with round windows (a stock room): one pushed wide open. */
  swing(P) {
    const { B, w, t, dh, r = B.rng } = P;
    const lw = w / 2 - 1;
    const col = '#8a8e92';
    for (const s of [-1, 1]) {
      const ang = s < 0 ? 0.15 : 1.4 + r.range(-0.2, 0.1);
      const hx = s * (w / 2 - 1), dir = -s;
      const cx = hx + dir * Math.cos(ang) * lw / 2, cz = Math.sin(ang) * lw / 2 + t / 2;
      const rot = [0, dir > 0 ? -ang : ang, 0];
      B.add('std', T.box(), [cx, dh / 2, cz], [lw, dh - 2, 2.4], rot, col, { noJitter: true, ...S(DET.panel, 0.5, 0.5) });
      B.add('std', T.box(), [cx, 10, cz], [lw, 16, 2.8], rot, '#6a6e72', { noJitter: true, ...S(DET.panel, 0.4, 0.8) });
      B.add('vglass', T.cyl(12), [cx, dh * 0.66, cz], [7, 3, 7], [HALF, rot[1], 0], '#8fa2ac', { noJitter: true, surf: [0, 0.06, 0] });
    }
  },
  /** Tall double doors of oak with iron strap hinges (the church, the gym): both leaves open. */
  wood2(P) {
    const { B, w, t, dh, side } = P;
    const r = B.rng;
    const lw = w / 2 - 1;
    const col = '#6a4428';
    const zs = side === 'out' ? -1 : 1;
    for (const s of [-1, 1]) {
      const ang = 1.25 + r.range(-0.25, 0.2);
      const hx = s * (w / 2 - 1), dir = -s;
      const cx = hx + dir * Math.cos(ang) * lw / 2, cz = zs * (Math.sin(ang) * lw / 2 + t / 2);
      const ry = (dir > 0 ? -ang : ang) * zs;
      B.add('std', T.box(), [cx, dh / 2, cz], [lw, dh - 2, 3], [0, ry, 0], col, { noJitter: true, ...WOOD });
      if (P.lod >= 1) for (const y of [dh * 0.2, dh * 0.8]) B.add('std', T.box(), [cx, y, cz], [lw * 0.8, 2.4, 3.6], [0, ry, 0], '#1a1a1a', { noJitter: true, ...RUSTY });
    }
  },
  /** A cell door hanging open on its hinges (in a line of bars). */
  cell(P) {
    const { B, w, dh } = P;
    const H = Math.min(P.look.h, 110);
    barLeaf(B, -w / 2, w, Math.min(dh + 20, H), 1.2 + B.rng.range(-0.3, 0.3), 0);
    B.box('std', 0, H + 1, 0, w, 3, 2.4, '#4a5258', null, { noJitter: true, ...S(DET.panel, 0.4, 0.8) });
  },
  /** A barred gate in a partition (the cell block's door), swung open. */
  bars(P) {
    const { B, w, t, dh } = P;
    barLeaf(B, -w / 2 + 1, w - 2, dh, 1.35, t / 2 + 1);
  },
});

void [METAL, rod, plank, sign];
