// Saint Mercy's props (render3d/levels/hospital.js): the obstacles by their style tag (beds, trolleys,
// the nurses' stations, shelving, the generator, the operating tables, the ambulances...) and the free
// items of `map.levelArt` (curtains, signs, lamps, the canopy, the stair flights, the roofs, the helipad,
// the mast). Every model is written in its frame: local +x along the obstacle's `w` (a vehicle's front),
// +z along its `h`, +y up; the kit placed the frame (on the terrain, for the roof's props).
//
// `lampsOf` draws the switchable lights of the level (the theatre lamps, the canopy strips, the stair's
// bulkheads, the helipad's edge lights...) into the per-section fixture meshes of the kit.

import * as THREE from 'three';
import { T, DET, S, STEEL, CHROME, PAINT, PLAST, FABRIC, WOODS, CONC, shadeHex, mixHex, hash01 } from './hospital-kit.js';
import { rod } from '../dress-kit.js';
import { ridgeTent } from '../world-hideout-kit.js';

const HALF = Math.PI / 2;
const SHEET = '#e6e8e2', SHEET_B = '#b8d0dc', STEELC = '#a8aeb2', PLASTIC_T = '#3f7f86';
const RUBBER = S(DET.rubber, 0.9, 0);

// ---------------------------------------------------------------------------------------------
// small parts

/** A castor wheel at (x, z). */
function castor(B, x, z, r = 2.6) {
  B.cylZ('std', x, r, z, r, 1.6, '#2a2c2e', 8, RUBBER);
  B.box('std', x, r * 2 + 1, z, 1.2, 2.4, 1.2, '#8a9096', null, STEEL);
}

/** A mattress with a sheet, a pillow and (sometimes) a body under the sheet or a blood stain. */
function mattress(P, x, y, z, L, W, seed, o = {}) {
  const { B } = P;
  B.rblock('std', x, y, z, L, 5, W, 1.8, o.mat || '#5d7f96', null, PLAST);
  B.rblock('std', x + 2, y + 4.2, z, L - 6, 1.2, W + 0.6, 0.5, o.sheet || SHEET, [0, 0, 0.01], FABRIC);
  B.add('std', T.pillow(8, 5, 0.5), [x - L / 2 + 8, y + 7.4, z], [6, 2.2, W / 2 - 3], null, '#f0f0ea', FABRIC);
  const h = hash01(seed);
  if (h < (o.body ?? 0.25)) {
    // someone lies under the sheet
    B.add('std', T.pillow(10, 6, 0.55), [x + 2, y + 9, z], [L * 0.36, 3.6, W * 0.3], [0, 0, 0.02], o.sheet || SHEET, FABRIC);
    B.add('std', T.sphere(7, 5), [x - L / 2 + 10, y + 11, z], [5, 4, 4.6], null, o.sheet || SHEET, FABRIC);
    if (h < 0.12 && P.lod() >= 1) P.flat(B, 'blood_splat', x - L * 0.12, y + 12.8, z, W * 1.1, W * 1.1, h * 20);
  } else if (h > 0.72) {
    P.flat(B, h > 0.86 ? 'blood_pool' : 'blood_splat', x, y + 5.6, z, W * 1.3, W * 1.1, h * 30);
    // a blanket thrown back
    B.rblock('std', x + L * 0.25, y + 5.2, z, L * 0.42, 1.6, W + 2, 0.6, o.blanket || SHEET_B, [0.05, 0.2, 0], FABRIC);
  } else {
    B.rblock('std', x + L * 0.12, y + 5.4, z, L * 0.6, 1.4, W + 1.4, 0.6, o.blanket || SHEET_B, null, FABRIC);
  }
}

/** A wire shelf unit along local x (long side L, depth D), `levels` shelves, pictures of its contents on both faces. */
function wireShelf(P, L, D, H, levels, cell, o = {}) {
  const { B } = P;
  const col = o.color || '#9aa0a4';
  for (const x of [-L / 2 + 1, L / 2 - 1, ...(L > 160 ? [0] : [])]) for (const z of [-D / 2 + 1, D / 2 - 1]) B.box('std', x, H / 2, z, 1.6, H, 1.6, col, null, STEEL);
  const dh = (H - 6) / levels;
  for (let i = 0; i <= levels; i++) {
    const y = 4 + i * dh;
    B.box('std', 0, y, 0, L, 1, D, shadeHex(col, -0.1), null, S(DET.hesco, 0.5, 0.6));
    if (i < levels && cell) {
      // the goods: a picture per face, a little inset, plus a few real boxes
      P.pic(P.B, cell, 0, y + dh / 2, D / 2 - 3, L - 4, dh - 2, 0, { rx: 0 });
      P.pic(P.B, cell, 0, y + dh / 2, -D / 2 + 3, L - 4, dh - 2, Math.PI);
      if (P.lod() >= 2 && o.boxes !== false) {
        const r = hash01(Math.round(P.o.x + P.o.y) + i * 7);
        const n = 2 + Math.floor(r * 3);
        for (let k = 0; k < n; k++) {
          const bx = -L / 2 + 10 + hash01(k * 13 + i + Math.round(P.o.x)) * (L - 20);
          B.rblock('std', bx, y + 0.5, 0, 12 + r * 8, dh * (0.4 + r * 0.3), D - 8, 0.4, o.boxColor || ['#d8d0c0', '#c8b89a', '#e8e4d8'][k % 3], [0, (r - 0.5) * 0.3, 0], S(DET.fabric, 0.9, 0));
        }
      }
    }
  }
}

/** Curtain panel along local x from x0 to x1 at z, from y0 to y1, folded (a zig-zag), open part bunched. */
function curtain(B, x0, x1, z, y0, y1, color, seed) {
  const len = x1 - x0;
  const n = Math.max(2, Math.round(Math.abs(len) / 8));
  const s = FABRIC;
  for (let i = 0; i < n; i++) {
    const a = x0 + (len * i) / n, b = x0 + (len * (i + 1)) / n;
    const d0 = (i % 2 ? 2.2 : -2.2), d1 = ((i + 1) % 2 ? 2.2 : -2.2);
    const cx = (a + b) / 2, cz = z + (d0 + d1) / 2;
    const dx = b - a, dz = d1 - d0;
    // a vertical quad from (a, z+d0) to (b, z+d1)
    B.quad('std', [cx, (y0 + y1) / 2, cz], [dx, 0, dz], [0, y1 - y0, 0], shadeHex(color, (i % 2 ? -0.08 : 0.04) + (hash01(seed + i) - 0.5) * 0.04), s);
    B.quad('std', [cx, (y0 + y1) / 2, cz], [-dx, 0, -dz], [0, y1 - y0, 0], shadeHex(color, -0.15), s);
  }
}

// ---------------------------------------------------------------------------------------------
// obstacles by style

/** A row of linked waiting-room seats facing local +z. */
function seats(P) {
  const { B, L } = P;
  const n = Math.max(2, Math.floor(L / 32));
  const sw = L / n;
  B.box('std', 0, 10, -2, L, 2.4, 3.2, '#3a3f44', null, STEEL);
  for (const e of [-1, 1]) {
    B.box('std', e * (L / 2 - 10), 5, -2, 3, 10, 3, '#3a3f44', null, STEEL);
    B.box('std', e * (L / 2 - 10), 0.8, -2, 3, 1.6, 20, '#3a3f44', null, STEEL);
  }
  const col = hash01(Math.round(P.o.x)) < 0.5 ? PLASTIC_T : '#2f5d8a';
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * sw;
    const r = hash01(Math.round(P.o.x * 3 + P.o.y) + i * 17);
    if (r < 0.08) continue;                        // a seat torn off
    const tilt = r > 0.9 ? 0.4 : 0;
    B.rblock('std', x, 12, 2, sw - 4, 2.4, 16, 1, col, [tilt, 0, 0], PLAST);
    B.rblock('std', x, 14, -7, sw - 4, 17, 2.2, 1, col, [-0.16 + tilt, 0, 0], PLAST);
    if (i > 0) B.box('std', x - sw / 2, 19, 1, 1.6, 1.6, 14, '#2a2d30', null, STEEL);
    if (r > 0.82 && P.lod() >= 1) P.flat(B, 'blood_splat', x, 14.6, 2, 13, 12, r * 9);
  }
}

/** A vending machine: the body, the lit front (dim: on emergency power). */
function vend(P, cell) {
  const { B, L, W } = P;
  const H = 72;
  B.rblock('std', 0, 0, 0, L, H, W, 1, cell === 'hs_vend2' ? '#8a1a1e' : '#2a2d32', null, S(DET.panel, 0.5, 0.4));
  P.pic(B, cell, L / 2 + 0.3, H * 0.52, 0, W - 4, H - 8, HALF, { lit: !P.day, k: 0.9 });
  P.glow(B, L / 2 + 0.6, H - 3, 0, 0.4, 2.6, W - 8, '#cfe6ff', 1.2);
}

/** The reception / triage desk: a counter with a raised ledge and a glass screen on the visitors' side (-z). */
function triageDesk(P) {
  const { B, L, W } = P;
  const wood = S(DET.wood, 0.55, 0);
  B.rblock('std', 0, 0, 0, L, 32, W, 1, '#b9ad96', null, wood);
  B.rblock('std', 0, 32, 0, L + 4, 2.4, W + 4, 0.8, '#e4ded2', null, S(DET.terrazzo, 0.35, 0));
  B.rblock('std', 0, 34, -W / 2 + 5, L + 2, 12, 10, 0.8, '#b9ad96', null, wood);
  B.rblock('std', 0, 46, -W / 2 + 5, L + 4, 1.6, 12, 0.6, '#e4ded2', null, S(DET.terrazzo, 0.35, 0));
  B.box('std', 0, 16, -W / 2 - 0.2, L - 10, 3, 0.8, '#5f8f96', null, PLAST);
  // the screen: glass panels between steel posts, one smashed
  const np = Math.max(2, Math.round(L / 70));
  for (let i = 0; i <= np; i++) B.box('std', -L / 2 + (i * L) / np, 62, -W / 2 + 5, 1.4, 32, 1.4, '#9aa2a8', null, CHROME);
  for (let i = 0; i < np; i++) {
    if (i === 1) continue;
    B.box('glass', -L / 2 + ((i + 0.5) * L) / np, 62, -W / 2 + 5, L / np - 2, 30, 0.5, '#1a262c', null, S(DET.glass, 0.08, 0.2));
  }
  // monitors, keyboard, the phone, binders, papers
  for (const x of [-L * 0.25, L * 0.2]) {
    B.rblock('std', x, 34.4, W * 0.1, 18, 12, 2, 0.5, '#1a1c1f', [0, 0.1, 0], S(0, 0.4, 0.4));
    P.pic(B, 'hs_monitor_off', x, 40.6, W * 0.1 - 1.2, 16, 9, Math.PI);
    B.box('std', x, 34.4, W * 0.22, 14, 0.8, 5, '#2a2c2e', null, PLAST);
  }
  B.box('std', L * 0.4, 35, W * 0.15, 6, 2, 8, '#d8d4c8', null, PLAST);
  for (let i = 0; i < 4; i++) B.box('std', -L * 0.42 + i * 3.2, 38, W * 0.2, 2.6, 10, 8, ['#c62828', '#1d5ec8', '#2e7d32', '#f2c21a'][i], null, PLAST);
  if (P.lod() >= 1) {
    P.flat(B, 'blood_hand', L * 0.1, 48, -W / 2 + 5, 14, 10, 0.4);
    P.pic(B, 'hs_emergency_in', 0, 88, 0, 60, 12, Math.PI);     // hanging sign facing the visitors
    for (const e of [-1, 1]) B.cyl('std', e * 26, 94, 0, 0.3, 26, '#555', 4);
  }
}

/** A square clad column to the ceiling (ipillar) or a round concrete column (the canopy's pillars). */
function column(P) {
  const { B, o, L, W } = P;
  if (o.kind === 'pillar') {
    B.cyl('std', 0, 0, 0, L / 2, 132, '#d6d2c8', 18, 1, null, S(DET.concrete, 0.7, 0));
    B.cyl('std', 0, 0, 0, L / 2 + 1.6, 8, '#6d6a64', 18, 1, null, CONC);
    P.pic(B, 'hs_caution', 0, 20, L / 2 + 0.2, L * 1.4, 6, 0);
    return;
  }
  const H = o.top || 120;
  B.rblock('std', 0, 0, 0, L, H, W, 1, '#d9dbd2', null, S(DET.drywall, 0.8, 0));
  B.box('std', 0, 2.5, 0, L + 1.6, 5, W + 1.6, '#2f4448', null, PLAST);
  if (P.lod() >= 1) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', sx * L / 2, 32, sz * W / 2, 3, 60, 3, '#a8aeb2', null, CHROME);
  if (hash01(o.id) < 0.5) {
    // a fire extinguisher, or the hand-gel dispenser
    B.rblock('std', 0, 30, W / 2 + 3, 5, 15, 5, 0.6, '#c62828', null, PAINT);
    P.pic(B, 'hs_handgel', L / 2 + 0.4, 58, 0, 5, 7, HALF);
  } else {
    P.pic(B, ['hs_poster1', 'hs_poster2', 'hs_poster3'][o.id % 3], 0, 62, W / 2 + 0.3, 16, 22, 0);
  }
}

/** A trolley bed / gurney: a base on castors, the platform, the mattress, rails, an IV pole. */
function trolley(P, o2 = {}) {
  const { B, L, W } = P;
  const seed = Math.round(P.o.x * 7 + P.o.y);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) castor(B, sx * (L / 2 - 8), sz * (W / 2 - 5));
  B.rblock('std', 0, 6, 0, L - 10, 3, W - 8, 0.8, '#6d7378', null, STEEL);
  B.cyl('std', -L * 0.2, 9, 0, 3, 12, '#8a9096', 10, 1, null, CHROME);
  B.cyl('std', L * 0.2, 9, 0, 3, 12, '#8a9096', 10, 1, null, CHROME);
  B.rblock('std', 0, 21, 0, L, 2.6, W, 0.8, '#c9ccc8', null, STEEL);
  if (o2.bare) {
    B.rblock('std', 0, 23.6, 0, L - 4, 3.4, W - 4, 1.2, '#4a6a7e', null, PLAST);
    B.add('std', T.pillow(8, 5, 0.4), [L * 0.2, 25, W * 0.2], [14, 1.4, 10], [0, 0.6, 0.08], SHEET, FABRIC);
  } else {
    mattress(P, 0, 23.6, 0, L - 4, W - 4, seed, { mat: '#4a6a7e', body: o2.body ?? 0.3 });
  }
  for (const e of [-1, 1]) {
    const up = hash01(seed + e) < 0.6;
    B.box('std', 4, up ? 33 : 24, e * (W / 2 + 0.8), L * 0.6, 1.4, 1.2, '#b8bec2', null, CHROME);
    for (const x of [-L * 0.25, L * 0.3]) B.box('std', x, up ? 28.5 : 22.5, e * (W / 2 + 0.8), 1.2, up ? 9 : 3, 1.2, '#b8bec2', null, CHROME);
  }
  if (hash01(seed + 5) < 0.6) {
    // IV pole and a bag
    B.cyl('std', -L / 2 + 3, 23, W / 2 - 3, 0.6, 58, '#c9ced3', 6, 1, null, CHROME);
    B.box('std', -L / 2 + 3, 80, W / 2 - 3, 7, 0.6, 0.6, '#c9ced3', null, CHROME);
    B.rblock('std', -L / 2 + 6, 70, W / 2 - 3, 5, 9, 2, 1, '#e8e4c0', null, S(DET.plastic, 0.3, 0));
  }
}

/** A hospital bed: head and foot boards, a frame on castors, a mattress, rails, the bedside cabinet. */
function bed(P) {
  const { B, L, W } = P;
  const seed = Math.round(P.o.x * 3 + P.o.y * 5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) castor(B, sx * (L / 2 - 5), sz * (W / 2 - 4));
  B.rblock('std', 0, 8, 0, L - 6, 4, W - 6, 0.8, '#7d8388', null, STEEL);
  B.rblock('std', 0, 16, 0, L, 3, W, 0.6, '#c9ccc8', null, STEEL);
  // head (-x) and foot (+x) boards
  B.rblock('std', -L / 2 + 1.5, 6, 0, 3, 34, W + 2, 1.2, '#d8d4c8', null, PLAST);
  B.rblock('std', -L / 2 + 1.5, 36, 0, 3.4, 3, W + 3, 1.2, '#8aa4a8', null, PLAST);
  B.rblock('std', L / 2 - 1.5, 8, 0, 3, 22, W + 2, 1.2, '#d8d4c8', null, PLAST);
  mattress(P, 0, 19, 0, L - 6, W - 2, seed, { mat: '#5d7f96', blanket: ['#b8d0dc', '#c8d8c0', '#dcc8c0'][seed % 3], body: 0.22 });
  // rails: up on one side, down on the other; restraints on some
  const up = hash01(seed + 3) < 0.5 ? 1 : -1;
  B.rblock('std', -L * 0.1, 27, up * (W / 2 + 1), L * 0.55, 8, 1.2, 0.5, '#c9ced0', null, PLAST);
  B.box('std', -L * 0.1, 18, -up * (W / 2 + 1), L * 0.55, 3, 1.2, '#c9ced0', null, PLAST);
  if (hash01(seed + 9) < 0.35 && P.lod() >= 1) {
    for (const x of [-L * 0.15, L * 0.2]) B.box('std', x, 26.2, 0, 4, 1.2, W + 2.5, '#6a5a3a', null, S(DET.fabric, 0.9, 0));
  }
  // bedside cabinet and a chart at the foot
  if (P.lod() >= 1) {
    B.rblock('std', -L / 2 + 10, 0, up * -(W / 2 + 12), 16, 30, 16, 0.8, '#d4cebe', null, PLAST);
    B.box('std', -L / 2 + 10, 30.5, up * -(W / 2 + 12), 10, 1, 6, '#f0f0ea', [0, 0.3, 0], PLAST);
    P.pic(B, 'hs_chart', L / 2 + 0.2, 20, 0, 8, 12, HALF);
  }
}

/** The nurses' station counter, facing local -z (the visitors' side). */
function nstation(P, back = false) {
  const { B, L, W } = P;
  const lam = S(DET.plastic, 0.45, 0);
  B.rblock('std', 0, 0, 0, L, 30, W, 1, back ? '#c8c0ae' : '#d4ccb8', null, lam);
  B.rblock('std', 0, 30, 0, L + 3, 2.2, W + 3, 0.8, '#e8e2d4', null, S(DET.terrazzo, 0.35, 0));
  B.box('std', 0, 3, 0, L + 1, 6, W + 1, '#2f4a50', null, lam);
  if (!back) {
    // the raised front with the lit strip and the station's name
    B.rblock('std', 0, 32, -W / 2 + 4, L + 2, 12, 8, 0.8, '#d4ccb8', null, lam);
    B.rblock('std', 0, 44, -W / 2 + 4, L + 4, 1.6, 10, 0.6, '#5f8f96', null, lam);
    B.box('std', 0, 18, -W / 2 - 0.3, L - 8, 4, 0.6, '#5f8f96', null, lam);
  }
  const seed = Math.round(P.o.x + P.o.y);
  for (let i = 0; i < Math.max(2, Math.round(L / 110)); i++) {
    const x = -L / 2 + 40 + i * 110;
    if (x > L / 2 - 20) break;
    const tip = hash01(seed + i) < 0.2;
    B.rblock('std', x, 32.2, W * 0.12, 18, 12, 2, 0.5, '#1a1c1f', tip ? [1.2, 0.2, 0] : [0, back ? Math.PI : 0, 0], S(0, 0.4, 0.4));
    if (!tip) P.pic(B, hash01(seed + i * 3) < 0.25 ? 'hs_monitor' : 'hs_monitor_off', x, 38.4, W * 0.12 + (back ? 1.2 : -1.2), 16, 9, back ? 0 : Math.PI, { lit: !P.day && hash01(seed + i * 3) < 0.25, k: 1.2 });
    B.box('std', x, 32.4, W * 0.28 * (back ? -1 : 1), 14, 0.8, 5, '#2a2c2e', null, PLAST);
  }
  for (let i = 0; i < 6; i++) B.box('std', L / 2 - 30 + i * 3, 37, W * 0.2, 2.4, 9 + (i % 2), 8, ['#c62828', '#1d5ec8', '#2e7d32', '#f2c21a', '#8a5ab8', '#e8943a'][i], null, PLAST);
  for (let i = 0; i < 5; i++) B.box('std', -L * 0.3 + i * 22 * hash01(seed + i), 32.4, (hash01(seed + i * 5) - 0.5) * W * 0.6, 9, 0.3, 12, '#f0ece0', [0, hash01(i + seed) * 3, 0], PLAST);
  // a desk lamp
  if (!back) {
    B.cyl('std', -L / 2 + 20, 32.2, W * 0.2, 3, 1, '#2a2c2e', 8, 1, null, STEEL);
    rod(B, 'std', [-L / 2 + 20, 33, W * 0.2], [-L / 2 + 24, 46, W * 0.1], 0.5, '#2a2c2e', STEEL);
    B.cyl('std', -L / 2 + 26, 43, W * 0.05, 3, 4, '#2a2c2e', 8, 0.5, [0.4, 0, 0.3], STEEL);
  }
  if (P.lod() >= 1) P.flat(B, 'blood_hand', L * 0.25, 32.4, 0, 16, 12, 1.1);
}

/** Filing cabinets side by side, a drawer open. */
function filing(P) {
  const { B, L, W } = P;
  const along = L >= W;
  const len = along ? L : W, d = along ? W : L;
  const n = Math.max(1, Math.round(len / 36));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + ((i + 0.5) * len) / n, w = len / n - 1;
    const pos = (a, b) => (along ? [a, b] : [b, a]);
    const [x, z] = pos(t, 0);
    B.rblock('std', x, 0, z, along ? w : d, 52, along ? d : w, 0.6, '#7d8489', null, S(DET.panel, 0.5, 0.6));
    for (let k = 0; k < 4; k++) {
      const open = hash01(i * 7 + k + Math.round(P.o.x)) < 0.12;
      const [fx, fz] = pos(t, -(d / 2 + (open ? 10 : 0.3)));
      B.box('std', fx, 6 + k * 12.5, fz, along ? w - 3 : (open ? 20 : 0.6), 10, along ? (open ? 20 : 0.6) : w - 3, open ? '#6d7479' : '#8a9196', null, STEEL);
    }
  }
}

/** A table with chairs and the debris of a last meal. */
function table(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 26, 0, L, 2.4, W, 0.8, '#b8a888', null, WOODS);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', sx * (L / 2 - 4), 13, sz * (W / 2 - 4), 2, 26, 2, '#3a3d40', null, STEEL);
  const seed = Math.round(P.o.x);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * (L / 2 + 6), z = Math.sin(a) * (W / 2 + 6);
    const fall = hash01(seed + i) < 0.25;
    B.rblock('std', x, fall ? 2 : 14, z, 14, 2, 14, 0.6, '#3f6f7a', [fall ? HALF : 0, a, 0], PLAST);
    if (!fall) B.rblock('std', x + Math.cos(a) * 7, 16, z + Math.sin(a) * 7, 2, 16, 14, 0.6, '#3f6f7a', [0, a, 0], PLAST);
  }
  for (let i = 0; i < 3; i++) B.cyl('std', (hash01(seed + i) - 0.5) * L * 0.6, 28.4, (hash01(seed + i * 3) - 0.5) * W * 0.5, 1.8, 3.6, ['#e8e2d0', '#c62828', '#1d5ec8'][i], 8, 0.95, null, PLAST);
  B.box('std', L * 0.2, 28.6, 0, 16, 1.2, 16, '#c8a878', [0, 0.4, 0], S(DET.fabric, 0.9, 0));
}

/** The staff room sofa. */
function sofa(P) {
  const { B, L, W } = P;
  const c = '#6a5a7a';
  B.rblock('std', 0, 3, 0, L, 12, W, 2, shadeHex(c, -0.2), null, FABRIC);
  B.rblock('std', 0, 15, W / 2 - 6, L, 20, 10, 3, c, [0.08, 0, 0], FABRIC);
  for (const e of [-1, 1]) B.rblock('std', e * (L / 2 - 5), 12, 2, 10, 12, W - 4, 2.6, c, null, FABRIC);
  for (let i = 0; i < 2; i++) B.add('std', T.pillow(10, 6, 0.4), [-L / 4 + i * L / 2, 17, -4], [L / 4 - 4, 3.2, W / 2 - 8], null, shadeHex(c, 0.08), FABRIC);
  B.add('std', T.pillow(8, 5, 0.5), [L * 0.2, 20, 2], [14, 2, 12], [0.1, 0.8, 0], '#b8a07a', FABRIC);
}

/** An office desk with a monitor, papers and a chair. */
function officedesk(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 24, 0, L, 2.4, W, 0.8, '#b8a888', null, WOODS);
  B.rblock('std', -L / 2 + 10, 0, 0, 18, 24, W - 4, 0.8, '#7d8489', null, STEEL);
  B.box('std', L / 2 - 2, 12, 0, 2, 24, W - 4, '#7d8489', null, STEEL);
  B.rblock('std', 0, 26.4, -W * 0.2, 18, 12, 2, 0.5, '#1a1c1f', null, S(0, 0.4, 0.4));
  P.pic(B, 'hs_monitor_off', 0, 32.6, -W * 0.2 + 1.2, 16, 9, 0);
  for (let i = 0; i < 4; i++) B.box('std', -L * 0.3 + i * 8, 26.6 + i * 0.3, W * 0.1, 9, 0.3, 12, '#f0ece0', [0, i * 0.4, 0], PLAST);
  B.rblock('std', 0, 0, W * 0.85, 16, 16, 16, 2, '#2a2d33', [0, 0.5, 0], FABRIC);
}

/** The pharmacy fridge: a glass door (lit shelves at night), a temperature display. */
function medfridge(P) {
  const { B, L, W } = P;
  const H = 76;
  B.rblock('std', 0, 0, 0, L, H, W, 1, '#e8e8e4', null, S(DET.panel, 0.45, 0.2));
  // the door faces local -x
  P.pic(B, 'hs_medboxes', -L / 2 - 0.4, H * 0.48, 0, W - 8, H - 18, -HALF, { lit: !P.day, k: 0.9 });
  B.box('glass', -L / 2 - 1, H * 0.48, 0, 0.6, H - 14, W - 6, '#2a4050', null, S(DET.glass, 0.08, 0.2));
  B.box('std', -L / 2 - 1.4, H * 0.48, W / 2 - 4, 1.4, 20, 1.6, '#c9ced3', null, CHROME);
  P.glow(B, -L / 2 - 1.2, H - 5, 0, 0.3, 3, 10, '#5ac8ff', 2);
  P.pic(B, 'hs_biohazard', -L / 2 - 1.3, H - 14, -W / 2 + 8, 7, 7, -HALF);
}

/** Lockers: a row of steel doors with vents and name tags, one open. */
function lockers(P) {
  const { B, L, W } = P;
  const along = L >= W;
  const len = along ? L : W, d = along ? W : L;
  const n = Math.max(2, Math.round(len / 18));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + ((i + 0.5) * len) / n, w = len / n - 0.6;
    const c = ['#3f6f8a', '#4a7a94', '#3a6680'][i % 3];
    const open = hash01(i + Math.round(P.o.y)) < 0.18;
    if (along) {
      B.rblock('std', t, 0, 0, w, 80, d, 0.4, c, null, S(DET.panel, 0.5, 0.5));
      if (!open) P.pic(B, 'hs_vent', t, 70, d / 2 + 0.3, w * 0.6, 6, 0);
    } else {
      B.rblock('std', 0, 0, t, d, 80, w, 0.4, c, null, S(DET.panel, 0.5, 0.5));
      if (!open) P.pic(B, 'hs_vent', d / 2 + 0.3, 70, t, w * 0.6, 6, HALF);
      else B.box('std', d / 2 + 7, 40, t - w / 2, 14, 76, 1, c, [0, -0.6, 0], S(DET.panel, 0.5, 0.5));
    }
  }
}

/** A stainless sink bench (the sluice) or the long scrub trough with its taps. */
function sinkBench(P, scrub = false) {
  const { B, L, W } = P;
  const along = L >= W;
  const len = along ? L : W, d = along ? W : L;
  const pos = (a, b) => (along ? [a, b] : [b, a]);
  const [cx, cz] = pos(0, 0);
  B.rblock('std', cx, 0, cz, along ? len : d, 32, along ? d : len, 0.8, '#9aa2a6', null, STEEL);
  B.rblock('std', cx, 32, cz, along ? len + 2 : d + 2, 2, along ? d + 2 : len + 2, 0.5, '#c9ced3', null, CHROME);
  const n = scrub ? 4 : Math.max(1, Math.round(len / 120));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + ((i + 0.5) * len) / n;
    const [x, z] = pos(t, 0);
    B.rblock('std', x, 26, z, along ? (scrub ? len / n - 8 : 40) : d - 8, 7, along ? d - 8 : (scrub ? len / n - 8 : 40), 1.2, '#6d757a', null, CHROME);
    // the tap on a gooseneck at the back
    const [bx, bz] = pos(t, (along ? -1 : 1) * (d / 2 - 3) * (along ? 1 : -1));
    B.cyl('std', bx, 34, bz, 0.8, 18, '#c9ced3', 6, 1, null, CHROME);
    const [tx, tz] = pos(t, (along ? -1 : 1) * (d / 2 - 9) * (along ? 1 : -1));
    B.box('std', (bx + tx) / 2, 51, (bz + tz) / 2, along ? 1.4 : 7, 1.4, along ? 7 : 1.4, '#c9ced3', null, CHROME);
  }
  if (scrub) {
    // the splashback tiles and soap dispensers on the wall behind (local +x side when the trough runs along z)
    const [sx, sz] = pos(0, (along ? -1 : 1) * (d / 2 + 1) * (along ? 1 : -1));
    B.box('std', sx, 60, sz, along ? len : 1.6, 50, along ? 1.6 : len, '#d6e0dc', null, S(DET.tile, 0.3, 0));
    for (let i = 0; i < n; i++) {
      const [x, z] = pos(-len / 2 + ((i + 0.5) * len) / n, (along ? -1 : 1) * (d / 2 - 1) * (along ? 1 : -1));
      B.rblock('std', x, 62, z, 5, 10, 5, 0.8, '#e8e8e4', null, PLAST);
    }
  }
}

/** The ward's generator: a diesel set on a skid, radiator, alternator, control panel, the exhaust up the wall. */
function generator(P) {
  const { B, L, W } = P;
  const Y = '#c9a227', G = '#3f5f4a';
  B.rblock('std', 0, 0, 0, L, 8, W, 1, '#2f3336', null, STEEL);
  for (const e of [-1, 1]) B.box('std', 0, 4, e * (W / 2 - 2), L + 4, 8, 4, '#1f2224', null, STEEL);
  // engine block and rocker covers
  B.rblock('std', -L * 0.12, 8, 0, L * 0.5, 34, W * 0.62, 2, Y, null, PAINT);
  B.rblock('std', -L * 0.12, 42, 0, L * 0.44, 8, W * 0.3, 2, shadeHex(Y, -0.15), null, PAINT);
  for (let i = 0; i < 6; i++) B.cyl('std', -L * 0.32 + i * L * 0.08, 48, W * 0.2, 2.4, 6, '#2a2c2e', 8, 1, null, STEEL);
  // radiator end (+x) with its grille and guard
  B.rblock('std', L * 0.32, 8, 0, L * 0.18, 52, W * 0.86, 1.4, G, null, PAINT);
  P.pic(B, 'hs_vent', L * 0.41 + 0.6, 34, 0, W * 0.7, 40, HALF);
  // alternator (-x): a cylinder along x
  B.cylX('std', -L * 0.4, 28, 0, W * 0.28, L * 0.2, G, 16, PAINT);
  B.cylX('std', -L * 0.5, 28, 0, W * 0.2, 2, '#2a2c2e', 16, STEEL);
  // control panel on a stand at the +z side (the side the anchor is on is -z: the panel faces -z)
  B.rblock('std', -L * 0.1, 50, -W * 0.34, 40, 34, 10, 1, '#d8d4c4', null, PAINT);
  P.pic(B, 'hs_gauges', -L * 0.1, 70, -W * 0.34 - 5.2, 34, 16, Math.PI);
  P.pic(B, 'hs_generator', L * 0.32, 50, -W * 0.44, 26, 12, Math.PI);
  P.glow(B, -L * 0.1 - 14, 58, -W * 0.34 - 5.4, 2, 2, 0.4, '#ff3a2a', 3);
  P.glow(B, -L * 0.1 + 14, 58, -W * 0.34 - 5.4, 2, 2, 0.4, '#3aff6a', 1.6);
  // exhaust: up from the engine to the ceiling, lagged
  B.cyl('std', -L * 0.12, 50, W * 0.2, 5, 70, '#8a8f94', 12, 1, null, S(DET.fabric, 0.9, 0.2));
  // cables across the floor to the switchboard, oil on the floor
  if (P.lod() >= 1) {
    rod(B, 'std', [-L * 0.3, 1, -W * 0.5], [-L * 0.8, 1, -W * 1.4], 1.6, '#1a1a1a', RUBBER);
    rod(B, 'std', [-L * 0.25, 1, -W * 0.5], [-L * 0.9, 1, -W * 1.2], 1.3, '#1a1a1a', RUBBER);
    P.flat(B, 'grime2', 0, 0.3, W * 0.2, L * 0.9, W * 1.1, 0.3);
  }
}

/** The electrical switchboard: panels with breakers, conduits up. */
function switchboard(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 84, W, 0.8, '#b8b6aa', null, S(DET.panel, 0.5, 0.4));
  // faces local -x (into the room)
  for (let i = 0; i < Math.round(W / 50); i++) {
    const z = -W / 2 + 25 + i * 50;
    P.pic(B, 'hs_panel', -L / 2 - 0.3, 46, z, 44, 60, -HALF);
    B.cyl('std', 0, 84, z, 2.4, 40, '#8a9096', 8, 1, null, STEEL);
  }
  P.pic(B, 'hs_generator', -L / 2 - 0.4, 80, 0, 26, 11, -HALF);
}

/** The fuel day tank: a horizontal cylinder on saddles, a gauge, hazard labels. */
function daytank(P) {
  const { B, L, W } = P;
  const along = W > L;
  const len = Math.max(L, W), r = Math.min(L, W) / 2 - 2;
  const pos = (t) => (along ? [0, t] : [t, 0]);
  for (const t of [-len * 0.3, len * 0.3]) { const [x, z] = pos(t); B.rblock('std', x, 0, z, along ? L - 4 : 10, 20, along ? 10 : W - 4, 1, '#3a3e42', null, STEEL); }
  if (along) B.cylZ('std', 0, 20 + r, 0, r, len - 6, '#c9a227', 18, PAINT);
  else B.cylX('std', 0, 20 + r, 0, r, len - 6, '#c9a227', 18, PAINT);
  const [gx, gz] = pos(len * 0.1);
  B.cyl('std', gx, 20 + 2 * r, gz, 3, 6, '#2a2c2e', 8, 1, null, STEEL);
  P.pic(B, 'hs_caution', along ? -r - 0.5 : 0, 20 + r, along ? 0 : -r - 0.5, 30, 5, along ? -HALF : Math.PI);
}

/** The operating table: a pedestal, the padded top, arm boards, straps; the aftermath. */
function ortable(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L * 0.4, 3, W * 0.7, 1, '#5a6066', null, STEEL);
  B.cyl('std', 0, 3, 0, 5, 24, '#9aa2a6', 12, 0.9, null, CHROME);
  B.rblock('std', 0, 27, 0, L, 3, W - 4, 0.8, '#b8bec2', null, CHROME);
  B.rblock('std', 0, 30, 0, L - 2, 3.4, W - 6, 1.2, '#2f3a44', null, PLAST);
  for (const e of [-1, 1]) B.rblock('std', -L * 0.1, 30, e * (W / 2 + 10), 8, 2, 18, 0.6, '#2f3a44', [0, e * 0.2, 0], PLAST);
  B.add('std', T.pillow(10, 6, 0.4), [L * 0.1, 34.5, 0], [L * 0.4, 1.4, W * 0.45], [0, 0.05, 0.02], '#5a8a9a', FABRIC);
  P.flat(B, 'blood_pool', 0, 36.2, 0, W * 1.6, W * 1.4, 0.7);
  P.flat(B, 'blood_splat', L * 0.4, 0.4, W * 0.6, 50, 50, 1.3);
}

/** The anaesthesia machine: a cart with drawers, monitors, vaporisers, the bellows. */
function anesthesia(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 40, W, 1, '#d8dcd8', null, PLAST);
  for (let k = 0; k < 3; k++) B.box('std', 0, 8 + k * 11, W / 2 + 0.3, L - 8, 9, 0.6, '#c4c8c4', null, PLAST);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) castor(B, sx * (L / 2 - 4), sz * (W / 2 - 4), 2);
  B.rblock('std', 0, 40, 0, L + 2, 2, W + 2, 0.6, '#9aa2a6', null, STEEL);
  B.rblock('std', 0, 42, -W * 0.1, L * 0.8, 26, 4, 0.6, '#2a2d30', null, STEEL);
  P.pic(B, 'hs_monitor', 0, 55, -W * 0.1 + 2.2, L * 0.72, 20, 0, { lit: !P.day, k: 1.2 });
  B.cyl('glass', L * 0.3, 42, W * 0.25, 4, 14, '#8ab0c0', 12, 1, null, S(0, 0.1, 0.2));
  for (let i = 0; i < 2; i++) B.rblock('std', -L * 0.25 + i * 10, 42, W * 0.25, 7, 12, 7, 0.8, ['#8a5ab8', '#f2c21a'][i], null, PLAST);
  rod(B, 'std', [L * 0.4, 44, W * 0.3], [L * 0.8, 36, W * 1.2], 1.2, '#4a7ab0', PLAST);
}

/** Equipment under a dust sheet. */
function sheeted(P) {
  const { B, L, W } = P;
  const s = hash01(Math.round(P.o.x));
  B.add('std', T.pillow(12, 8, 0.25), [0, 22 + s * 10, 0], [L / 2, 22 + s * 10, W / 2], [0, s, 0], '#c8c6be', FABRIC);
  B.add('std', T.pillow(10, 6, 0.4), [L * 0.1, 50 + s * 16, 0], [L * 0.3, 10, W * 0.32], [0, s * 2, 0.1], '#bebcb4', FABRIC);
}

/** A comms cabinet with its door open: the radio set (lit dials), a handset, a chair, cables up to the mast. */
function radio(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 76, W, 1, '#6d7a6a', null, S(DET.panel, 0.5, 0.5));
  // (the front faces local -x) the open doors
  for (const e of [-1, 1]) B.box('std', -L / 2 - 14, 38, e * (W / 2 + 4), 28, 72, 1.4, '#6d7a6a', [0, e * 0.7, 0], S(DET.panel, 0.5, 0.5));
  B.box('std', -L / 2 + 1, 38, 0, 1, 68, W - 8, '#1e2124', null, STEEL);
  for (let k = 0; k < 3; k++) {
    B.rblock('std', -L / 2 + 6, 20 + k * 18, 0, 10, 12, W - 20, 0.6, '#2a2d30', null, STEEL);
    P.pic(B, k === 1 ? 'hs_monitor' : 'hs_gauges', -L / 2 + 0.6, 26 + k * 18, 0, W - 26, 8, -HALF, { lit: k === 1 && !P.day, k: 1.4 });
  }
  P.glow(B, -L / 2 + 0.4, 62, -W * 0.3, 0.4, 2, 2, '#3aff6a', 3);
  P.glow(B, -L / 2 + 0.4, 62, -W * 0.2, 0.4, 2, 2, '#ffb030', 3);
  // the handset hanging on its cord, a folding chair, a battery
  rod(B, 'std', [-L / 2 - 2, 50, W * 0.3], [-L / 2 - 8, 30, W * 0.35], 0.4, '#111', PLAST);
  B.rblock('std', -L / 2 - 8, 26, W * 0.35, 3, 8, 3, 0.6, '#1a1a1a', null, PLAST);
  B.rblock('std', -L / 2 - 30, 0, 0, 14, 16, 14, 1, '#4a5a4a', [0, 0.4, 0], STEEL);
  B.rblock('std', -L / 2 - 30, 16, 5, 14, 14, 2, 0.6, '#4a5a4a', [0, 0.4, 0], STEEL);
  B.rblock('std', -L / 2 - 12, 0, -W * 0.35, 12, 9, 8, 0.6, '#2a2c2e', null, PLAST);
  // cables to the mast
  rod(B, 'std', [0, 76, 0], [40, 76, -200 * 0 + -180], 1, '#1a1a1a', RUBBER);
}

/** An ambulance (Type III): the cab (+x), the box body, the livery, light bars, open rear doors; crashed ones buckled. */
function ambulance(P) {
  const { B, L, W, o } = P;
  const crashed = o.label === 'crashed';
  const body = '#eeece6';
  const paint = S(DET.panel, 0.4, 0.3);
  const boxL = L * 0.66, cabL = L - boxL;
  const bx = -L / 2 + boxL / 2, cx = L / 2 - cabL / 2;
  // wheels
  for (const [x, z] of [[-L * 0.3, 1], [-L * 0.3, -1], [L * 0.3, 1], [L * 0.3, -1]]) {
    B.cylZ('std', x, 9, z * (W / 2 - 4), 9, 7, '#1c1c1c', 14, RUBBER);
    B.cylZ('std', x, 9, z * (W / 2 - 0.4), 5, 1, '#9aa0a4', 10, CHROME);
  }
  B.rblock('std', 0, 6, 0, L - 8, 10, W - 8, 1, '#2a2c2e', null, STEEL);
  // the box body
  B.rblock('paint', bx, 14, 0, boxL, 66, W, 2.5, body, null, paint);
  P.pic(B, 'hs_amb_side', bx, 42, W / 2 + 0.3, boxL - 6, 16, 0);
  P.pic(B, 'hs_amb_side', bx, 42, -W / 2 - 0.3, boxL - 6, 16, Math.PI);
  P.pic(B, 'hs_star', bx, 66, W / 2 + 0.3, 12, 12, 0);
  P.pic(B, 'hs_star', bx, 66, -W / 2 - 0.3, 12, 12, Math.PI);
  // rear doors (-x): one open on crashed / abandoned ones
  const open = crashed || hash01(o.id) < 0.5;
  B.box('std', -L / 2 - 0.3, 46, 0, 0.6, 58, W - 6, '#1a1c1e', null, STEEL);
  B.rblock('paint', -L / 2 - 1, 16, W / 4, 2, 60, W / 2 - 2, 1, body, null, paint);
  if (open) B.rblock('paint', -L / 2 - W / 4, 16, -W / 2 - 1, W / 2 - 2, 60, 2, 1, body, null, paint);
  else B.rblock('paint', -L / 2 - 1, 16, -W / 4, 2, 60, W / 2 - 2, 1, body, null, paint);
  B.box('std', -L / 2 - 2, 10, 0, 4, 5, W, '#3a3d40', null, STEEL);
  // the cab
  const tilt = crashed ? [0.02, 0, -0.05] : null;
  B.rblock('paint', cx, 14, 0, cabL, 32, W - 4, 2, body, tilt, paint);
  B.rblock('paint', cx - 2, 46, 0, cabL - 10, 22, W - 8, 2, body, tilt, paint);
  B.box('glass', cx + cabL / 2 - 8, 56, 0, 1, 16, W - 12, '#18222a', [0, 0, -0.35], S(DET.glass, 0.08, 0.3));
  for (const e of [-1, 1]) B.box('glass', cx - 2, 56, e * (W / 2 - 3.8), cabL - 16, 14, 0.8, '#18222a', null, S(DET.glass, 0.08, 0.3));
  P.pic(B, 'hs_amb_front', L / 2 + 0.4, 30, 0, W - 16, 7, HALF);
  B.box('std', L / 2 + 1, 12, 0, 3, 7, W, '#2a2c2e', null, STEEL);
  for (const e of [-1, 1]) {
    if (P.day || crashed) B.box('std', L / 2 + 0.5, 22, e * (W / 2 - 7), 1, 5, 9, '#d8d4c8', null, S(0, 0.2, 0.5)); else P.glow(B, L / 2 + 0.5, 22, e * (W / 2 - 7), 1, 5, 9, '#fff4d8', 3);
    B.box('std', cx - cabL * 0.1, 50, e * (W / 2 + 3), 1.6, 7, 4, '#1a1c1e', null, STEEL);   // mirrors
  }
  // the light bars: flashing red and white, on the cab roof and the box's corners
  const blink = !crashed || hash01(o.id + 3) < 0.5;
  B.rblock('std', cx - 4, 68, 0, 12, 4, W - 12, 1, '#2a2c2e', null, STEEL);
  for (const [x, y, z, c] of [[cx - 4, 72, -W * 0.3, '#ff2a1a'], [cx - 4, 72, W * 0.3, '#ff2a1a'], [cx - 4, 72, 0, '#f4f8ff'], [-L / 2 + 2, 78, W / 2 - 2, '#ff2a1a'], [-L / 2 + 2, 78, -W / 2 + 2, '#ff2a1a'], [bx + boxL / 2 - 2, 78, W / 2 - 2, '#ff2a1a'], [bx + boxL / 2 - 2, 78, -W / 2 + 2, '#ff2a1a']]) {
    B.add(blink ? 'blink' : 'std', T.box(), [x, y, z], [4, 3, 6], null, c, blink ? { emissive: 3.6 } : S(0, 0.3, 0.2));
  }
  if (blink && !P.day) { const [wx, wy] = P.toWorld(o, cx - 4, 0); P.halos.push({ x: wx, y: wy, h: 74 + P.gy(o.x, o.y), color: '#ff3a2a', size: 90, strength: 0.5, blink: 1 }); }
  if (crashed) {
    // the buckled front: a crumpled bonnet, a burst tyre, glass on the ground
    B.rblock('paint', L / 2 - 4, 26, 2, 14, 8, W - 2, 2, shadeHex(body, -0.2), [0.3, 0.2, 0.4], paint);
    P.flat(B, 'blood_trail', -L * 0.2, 0.3, W * 0.9, 90, 26, 0.3, { bucket: 'lvgrime' });
  }
}

/** A military medical tent: a ridge tent with red crosses, an open flap, cots inside. */
function medtent(P) {
  const { B, L, W } = P;
  ridgeTent(B, L, W, 40, 74, '#56603f', { open: true });
  P.pic(B, 'hs_redcross', 0, 62, W / 4 + 1, 26, 26, 0, { rx: -0.6 });
  P.pic(B, 'hs_redcross', 0, 62, -W / 4 - 1, 26, 26, Math.PI, { rx: -0.6 });
  for (let i = 0; i < 3; i++) {
    const x = -L / 2 + 30 + i * 40;
    B.box('std', x, 9, 0, 22, 1.2, 60, '#8a8060', null, FABRIC);
    for (const e of [-1, 1]) B.box('std', x, 4.5, e * 28, 22, 9, 1, '#5a5e62', null, STEEL);
    if (i === 1) B.add('std', T.pillow(10, 6, 0.5), [x, 13, 0], [9, 3, 22], null, '#2a3a28', FABRIC);
  }
}

/** A trailer-mounted army generator. */
function armygen(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 10, 0, L, 36, W - 6, 1.5, '#4b5320', null, PAINT);
  for (const e of [-1, 1]) B.cylZ('std', 0, 8, e * (W / 2 - 3), 8, 5, '#1c1c1c', 12, RUBBER);
  P.pic(B, 'hs_vent', L / 2 + 0.3, 30, 0, W * 0.6, 18, HALF);
  B.box('std', -L / 2 - 14, 8, 0, 28, 2, 3, '#3a3d20', null, STEEL);
  rod(B, 'std', [L * 0.3, 20, W / 2], [L * 1.5, 1, W * 2.4], 1.2, '#1a1a1a', RUBBER);
}

/** A concrete planter with a dead shrub. */
function planter(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 26, W, 2, '#b6b0a2', null, S(DET.concrete, 0.8, 0));
  B.rblock('std', 0, 22, 0, L - 8, 4, W - 8, 1, '#3a2c20', null, S(DET.dirt, 0.95, 0));
  for (let i = 0; i < 6; i++) rod(B, 'std', [0, 26, 0], [(hash01(i + P.o.x) - 0.5) * L * 0.8, 40 + hash01(i * 3) * 20, (hash01(i * 7 + P.o.y) - 0.5) * W * 0.8], 0.8, '#4a3a2a', S(DET.bark, 0.9, 0));
}

/** The water tank on a steel stand (roof). */
function watertank(P) {
  const { B, L } = P;
  const r = L / 2 - 4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', sx * r * 0.7, 12, sz * r * 0.7, 3, 24, 3, '#5a6066', null, STEEL);
  B.cyl('std', 0, 24, 0, r, 50, '#9aa4a8', 20, 1, null, S(DET.corrugated, 0.5, 0.5));
  B.cyl('std', 0, 74, 0, r + 1, 6, '#7d8588', 20, 0.3, null, STEEL);
  B.cyl('std', r * 0.6, 24, 0, 2, 50, '#6d7275', 8, 1, null, STEEL);
}

/** A steel palisade fence and chained gate across a yard entrance. */
function yardgate(P) {
  const { B, o } = P;
  const L = Math.max(o.w, o.h), a = o.w >= o.h ? 0 : HALF;
  P.at(B, o.x, o.y, a, o.id * 17, 0);
  B.box('std', 0, 20, 0, L, 3, 3, '#2f3a3a', null, STEEL);
  B.box('std', 0, 90, 0, L, 3, 3, '#2f3a3a', null, STEEL);
  for (let x = -L / 2 + 4; x <= L / 2 - 4; x += 8) {
    B.box('std', x, 52, 1.6, 4, 104, 1, '#2f3a3a', null, STEEL);
    B.add('std', T.cyl(3, 0), [x, 106, 1.6], [2.4, 6, 1], null, '#2f3a3a', STEEL);
  }
  for (const x of [-L / 2, L / 2, 0]) B.box('std', x, 55, 0, 8, 110, 8, '#252c2c', null, STEEL);
  B.cyl('std', 0, 50, 3, 3, 10, '#8a8f94', 8, 1, [HALF, 0, 0], CHROME);
  P.pic(B, 'hs_nostop', 30, 70, 4, 22, 22, 0);
  P.pic(B, 'hs_nostop', 30, 70, -4, 22, 22, Math.PI);
}

/** A big rectangular duct on supports across the roof. */
function duct(P) {
  const { B, L } = P;
  for (let x = -L / 2 + 20; x <= L / 2 - 20; x += 80) {
    B.box('std', x, 10, 0, 3, 20, 26, '#5a6066', null, STEEL);
  }
  B.rblock('std', 0, 20, 0, L, 30, 22, 1, '#a8aeb2', null, S(DET.panel, 0.4, 0.6));
  for (let x = -L / 2 + 30; x < L / 2; x += 60) B.box('std', x, 35, 0, 2, 32, 24, '#8a9096', null, STEEL);
}

/** Hospital shelving variants. */
function shelfMeds(P) { const L = Math.max(P.L, P.W); flip(P, () => wireShelf(P, L, Math.min(P.L, P.W), 84, 4, 'hs_medboxes')); }
function shelfSupply(P) { const L = Math.max(P.L, P.W); flip(P, () => wireShelf(P, L, Math.min(P.L, P.W), 88, 4, 'hs_supplies')); }
function shelfFiles(P) {
  const L = Math.max(P.L, P.W);
  flip(P, () => wireShelf(P, L, Math.min(P.L, P.W), 86, 4, 'hs_files', { color: '#6d7479', boxes: false }));
  // files spilled on the floor
  if (P.lod() >= 1) for (let i = 0; i < 4; i++) P.flat(P.B, 'hs_chart', (hash01(i + P.o.y) - 0.5) * L, 0.35, 24 * (i % 2 ? 1 : -1), 10, 14, hash01(i * 3 + P.o.x) * 6, { bucket: 'lvpic' });
}
function shelfGowns(P) {
  const L = Math.max(P.L, P.W);
  flip(P, () => {
    wireShelf(P, L, Math.min(P.L, P.W), 84, 4, null);
    for (let lv = 0; lv < 4; lv++) for (let k = 0; k < Math.floor(L / 24); k++) P.B.rblock('std', -L / 2 + 12 + k * 24, 5 + lv * 19.5, 0, 20, 6 + hash01(k + lv) * 5, Math.min(P.L, P.W) - 6, 1, ['#5a8a9a', '#6a9a7a', '#8aa0b8'][(k + lv) % 3], null, FABRIC);
  });
}
/** Run `fn` in a frame turned so the long side is local x. */
function flip(P, fn) {
  if (P.L >= P.W) { fn(); return; }
  const { o } = P;
  P.B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31, 0);
  const L = P.L; P.L = P.W; P.W = L;
  fn();
}

/** The x-ray table (a slab on a pedestal). */
function xrayTable(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L * 0.3, 24, W * 0.6, 1.5, '#d8dcd8', null, PLAST);
  B.rblock('std', 0, 24, 0, L, 3, W, 1, '#e8ece8', null, PLAST);
  B.rblock('std', 0, 27, 0, L - 4, 2, W - 4, 1, '#2f3a44', null, PLAST);
}

export const OBSTACLES = {
  seats, vend: (P) => vend(P, 'hs_vend'), vend2: (P) => vend(P, 'hs_vend2'), 'triage-desk': triageDesk, 'hosp-col': column,
  'gurney-bed': (P) => trolley(P), gurney: (P) => trolley(P, { bare: hash01(P.o.id) < 0.5, body: 0.15 }), bed,
  nstation: (P) => nstation(P), 'nstation-back': (P) => nstation(P, true), 'nstation-end': (P) => nstation(P, true),
  'shelf-meds': shelfMeds, 'shelf-supply': shelfSupply, 'shelf-files': shelfFiles, 'shelf-gowns': shelfGowns,
  medfridge, 'xray-table': xrayTable, lockers, sofa, table, officedesk, filing, sluice: (P) => sinkBench(P), scrubsink: (P) => sinkBench(P, true),
  generator, switchboard, daytank, ortable, anesthesia, sheeted, radio, ambulance, medtent, armygen, planter, watertank,
  yardgate, duct,
};

// ---------------------------------------------------------------------------------------------
// free items (map.levelArt)

/** A sign plate on a wall (face ±1 = local ±z), at height y. */
function sign(P) {
  const { B, it } = P;
  const f = it.face || 1;
  P.pic(B, it.cell, 0, it.hy || 90, f * 0.9, it.w, it.h, f > 0 ? 0 : Math.PI, { lit: it.lit && !P.day, k: 1.4 });
  B.box('std', 0, it.hy || 90, f * 0.4, it.w + 1.5, it.h + 1.5, 0.8, '#e8e8e4', null, PLAST);
}

/** A lit EXIT sign box over a door. */
function exitsign(P) {
  const { B, it } = P;
  B.rbox('std', 0, it.hy || 88, 0, 26, 11, 4, 0.8, '#e8e8e4', null, PLAST);
  for (const f of [-1, 1]) P.pic(B, 'hs_exit', 0, it.hy || 88, f * 2.1, 22, 8, f > 0 ? 0 : Math.PI, { lit: true, k: 1.8 });
}

/** A TV on a wall bracket showing the emergency broadcast. */
function tvwall(P) {
  const { B, it } = P;
  B.box('std', 0, 96, 3, 8, 8, 6, '#2a2c2e', null, STEEL);
  B.rblock('std', 0, 84, 7, it.w || 80, 46, 4, 1, '#111214', [-0.12, 0, 0], PLAST);
  P.pic(B, 'hs_tv', 0, 107, 9.4, (it.w || 80) - 6, 40, 0, { lit: true, k: 1.1, rx: -0.12 });
}

/** A cork noticeboard with papers, a clock, a poster. */
function noticeboard(P) {
  const { B, it } = P;
  B.box('std', 0, 66, 0.6, it.w + 4, it.h + 4, 1.2, '#6b4a2c', null, WOODS);
  P.pic(B, 'hs_notice', 0, 66, 1.3, it.w, it.h, 0);
  P.pic(B, 'hs_clock', -it.w * 0.8, 100, 0.8, 14, 14, 0);
  P.pic(B, 'hs_poster2', it.w * 0.85, 64, 0.8, 22, 31, 0);
  P.pic(B, 'hs_evac', it.w * 1.35, 66, 0.8, 22, 17, 0);
}

/** The kids' corner: a mural, a little table and chairs, toys. */
function kidscorner(P) {
  const { B } = P;
  P.pic(B, 'hs_kids', 0, 58, 101.2, 120, 60, Math.PI);
  B.rblock('std', 0, 12, 40, 50, 2, 30, 1, '#f2c21a', null, PLAST);
  for (const [x, z] of [[-18, 26], [18, 26], [-18, 56], [18, 56]]) B.box('std', x, 6, z, 2, 12, 2, '#d8231b', null, PLAST);
  for (const [x, z, c] of [[-38, 40, '#1d5ec8'], [38, 40, '#2e7d32'], [0, 70, '#d8231b']]) B.rblock('std', x, 0, z, 12, 8, 12, 1, c, null, PLAST);
  B.add('std', T.sphere(8, 6), [20, 5, 80], [5, 5, 5], null, '#e8943a', PLAST);
  B.rblock('std', -40, 0, 80, 30, 14, 18, 1, '#8a5ab8', [0, 0.2, 0], PLAST);
}

/** A curtained triage bay: the track round three sides, curtains (some drawn), the headwall with gases and a monitor. */
function bay(P) {
  const { B, it } = P;
  const w = it.w, d = it.d, H = 112;
  const seed = (it.i || 0) * 37 + 11;
  const cols = ['#9fc4c2', '#a8b8d0', '#c4b8a8', '#b8c8a8'];
  const col = cols[(it.i || 0) % cols.length];
  // track (a rectangle open at +x)
  for (const e of [-1, 1]) B.box('std', 0, H, e * (d / 2 - 4), w - 20, 1.4, 2, '#c9ced3', null, CHROME);
  B.box('std', w / 2 - 10, H, 0, 2, 1.4, d - 8, '#c9ced3', null, CHROME);
  // side curtains: partly drawn from the back wall
  for (const e of [-1, 1]) {
    const k = hash01(seed + e);
    const x1 = -w / 2 + 10 + (w - 40) * (0.3 + 0.7 * k);
    curtain(B, -w / 2 + 12, x1, e * (d / 2 - 4), 18, H - 2, col, seed + e * 5);
  }
  // the front curtain: bunched at one corner, or drawn across (hiding something)
  const drawn = hash01(seed + 9) < 0.3;
  const fx = w / 2 - 10;
  const z0 = -d / 2 + 6, z1 = drawn ? d / 2 - 6 : -d / 2 + 30;
  for (let i = 0; i < Math.round((z1 - z0) / 8); i++) {
    const a = z0 + i * 8, b = a + 8;
    const dx = i % 2 ? 2 : -2;
    B.quad('std', [fx + dx, (18 + H) / 2, (a + b) / 2], [0, 0, 8], [0, H - 20, 0], shadeHex(col, i % 2 ? -0.1 : 0), FABRIC);
    B.quad('std', [fx + dx, (18 + H) / 2, (a + b) / 2], [0, 0, -8], [0, H - 20, 0], shadeHex(col, -0.18), FABRIC);
  }
  // headwall: a horizontal service panel with gas outlets, a monitor on an arm, a sharps bin
  const hx = -w / 2 + 1.5;
  B.box('std', hx, 56, 0, 3, 14, d * 0.6, '#d8dcd8', null, PLAST);
  for (let k = 0; k < 4; k++) B.cyl('std', hx + 2, 56, -d * 0.2 + k * d * 0.13, 1.4, 2, ['#2a6ab0', '#ffffff', '#c9a227', '#2e7d32'][k], 8, 1, [0, 0, HALF], PLAST);
  B.box('std', hx + 8, 80, d * 0.25, 14, 1.6, 1.6, '#3a3d40', null, STEEL);
  B.rblock('std', hx + 14, 74, d * 0.25, 2, 12, 16, 0.5, '#1a1c1f', null, S(0, 0.4, 0.4));
  P.pic(B, hash01(seed) < 0.3 ? 'hs_monitor' : 'hs_monitor_off', hx + 15.2, 80, d * 0.25, 14, 9, HALF, { lit: !P.day && hash01(seed) < 0.3, k: 1.2 });
  B.rblock('std', hx + 4, 30, -d * 0.35, 6, 9, 7, 0.6, '#f2c21a', null, PLAST);
  if (P.lod() >= 1) {
    P.flat(B, hash01(seed + 3) < 0.5 ? 'blood_pool' : 'blood_splat', w * 0.1, 0.4, (hash01(seed + 4) - 0.5) * d * 0.5, 60, 50, seed);
    P.decal(B, 'blood_hand', hx + 0.7, 40 + hash01(seed) * 20, -d * 0.1, 26, 26, HALF);
  }
}

/** A privacy curtain round a bed, on a ceiling track (part drawn). */
function bedcurtain(P) {
  const { B, it } = P;
  const seed = (it.i || 1) * 13;
  const H = 112;
  const col = ['#9fc4c2', '#a8b8d0', '#c9b8c8', '#b8c8a8'][seed % 4];
  const hl = 48, hw = 34;
  B.box('std', 0, H, hw, hl * 2, 1.2, 1.6, '#c9ced3', null, CHROME);
  B.box('std', 0, H, -hw, hl * 2, 1.2, 1.6, '#c9ced3', null, CHROME);
  B.box('std', hl, H, 0, 1.6, 1.2, hw * 2, '#c9ced3', null, CHROME);
  const k = hash01(seed);
  if (k < 0.4) curtain(B, -hl, -hl + 30, hw, 16, H - 2, col, seed);
  else curtain(B, -hl, hl * (k - 0.2), hw, 16, H - 2, col, seed);
  if (k > 0.55) curtain(B, hl, hl - 40, -hw, 16, H - 2, col, seed + 3);
}

/** Quarantine plastic hung from the ceiling, torn through. */
function plastic(P) {
  const { B, it } = P;
  const w = it.w, H = it.h || 120;
  const n = Math.max(4, Math.round(w / 18));
  B.box('std', 0, H - 3, 0, w, 2, 2, '#8a8f94', null, STEEL);
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + (i * w) / n, b = a + w / n;
    if (Math.abs((a + b) / 2) < w * 0.12) continue;              // the torn opening
    const z0 = Math.sin(i * 1.7) * 3, z1 = Math.sin((i + 1) * 1.7) * 3;
    const bottom = 4 + hash01(i + Math.round(it.x)) * 12;
    B.add('lvplastic', T.plane(), [(a + b) / 2, (H - 4 + bottom) / 2, (z0 + z1) / 2], [Math.hypot(b - a, z1 - z0), H - 4 - bottom, 1], [0, -Math.atan2(z1 - z0, b - a), 0], '#e8f0f4', { uv: P.atlas.uv('hs_plastic'), noAO: true, noJitter: true });
  }
  // the torn flaps
  for (const e of [-1, 1]) B.add('lvplastic', T.plane(), [e * w * 0.1, H * 0.5, 6], [w * 0.1, H * 0.8, 1], [0.2, e * 0.9, 0.1 * e], '#e8f0f4', { uv: P.atlas.uv('hs_plastic'), noAO: true, noJitter: true });
  P.pic(B, 'hs_biohazard', w * 0.3, 80, 1.5, 16, 16, 0);
  P.pic(B, 'hs_biohazard', w * 0.3, 80, -1.5, 16, 16, Math.PI);
}

/** A ceiling-mounted examination lamp (its lit face is in the lamps set). */
function ceilinglamp(P) {
  const { B, it } = P;
  const H = it.h || 120;
  B.cyl('std', 0, H - 6, 0, 5, 6, '#d8dcd8', 12, 1, null, PLAST);
  rod(B, 'std', [0, H - 6, 0], [12, H - 30, 6], 1.4, '#c9ced3', CHROME);
  B.cyl('std', 12, H - 36, 6, 12, 6, '#e8ece8', 16, 0.7, null, PLAST);
}

/** An instrument trolley (Mayo stand) with instruments and a kidney bowl. */
function instrument(P) {
  const { B } = P;
  for (const [x, z] of [[-10, -8], [10, -8], [10, 8], [-10, 8]]) { castor(B, x, z, 1.6); B.box('std', x, 18, z, 1.2, 30, 1.2, '#c9ced3', null, CHROME); }
  B.rblock('std', 0, 32, 0, 26, 1.2, 20, 0.4, '#c9ced3', null, CHROME);
  B.rblock('std', 0, 12, 0, 24, 1, 18, 0.4, '#b8bec2', null, CHROME);
  for (let i = 0; i < 6; i++) B.box('std', -8 + i * 3, 33.4, (hash01(i + P.it.x) - 0.5) * 12, 1, 0.5, 8, '#e8ecee', [0, hash01(i) * 0.5, 0], CHROME);
  B.add('std', T.sphere(8, 4), [6, 33.4, 4], [5, 1.6, 3], null, '#c9ced3', CHROME);
  P.flat(B, 'blood_splat', -2, 33.5, -3, 12, 10, 0.4);
}

/** A patient monitor on a roll stand. */
function monitor(P) {
  const { B } = P;
  const on = !P.day && hash01(Math.round(P.it.x + P.it.y)) < 0.5;
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; B.box('std', Math.cos(a) * 6, 1.6, Math.sin(a) * 6, 12, 1.4, 2, '#3a3d40', [0, -a, 0], STEEL); castor(B, Math.cos(a) * 11, Math.sin(a) * 11, 1.4); }
  B.cyl('std', 0, 2, 0, 1, 52, '#c9ced3', 8, 1, null, CHROME);
  B.rblock('std', 0, 54, 0, 4, 14, 20, 0.6, '#d8dcd8', null, PLAST);
  P.pic(B, on ? 'hs_monitor' : 'hs_monitor_off', 2.2, 61, 0, 17, 11, HALF, { lit: on, k: 1.3 });
}

/** The red crash cart with the defibrillator on top. */
function crashcart(P) {
  const { B } = P;
  for (const [x, z] of [[-10, -8], [10, -8], [10, 8], [-10, 8]]) castor(B, x, z, 2);
  B.rblock('std', 0, 5, 0, 26, 38, 20, 1, '#c62828', null, PAINT);
  for (let k = 0; k < 4; k++) B.box('std', 0, 10 + k * 8.5, 10.3, 22, 7, 0.6, '#a82020', null, PAINT);
  B.rblock('std', 0, 43, 0, 18, 10, 14, 1, '#f2c21a', null, PLAST);
  P.pic(B, 'hs_monitor', 0, 48, 7.4, 12, 6, 0, { lit: !P.day, k: 1.2 });
}

/** The surgical lights: a ceiling boom with two dish heads (their faces are in the lamps set). */
function orlamp(P) {
  const { B, it } = P;
  const H = it.h || 130;
  B.cyl('std', 0, H - 8, 0, 7, 8, '#e8ece8', 14, 1, null, PLAST);
  for (const [dx, dz, r, y] of [[-24, 10, 20, 70], [22, -14, 15, 76]]) {
    rod(B, 'std', [0, H - 10, 0], [dx * 0.6, H - 26, dz * 0.6], 1.6, '#d8dcd8', PLAST);
    rod(B, 'std', [dx * 0.6, H - 26, dz * 0.6], [dx, y + 10, dz], 1.4, '#d8dcd8', PLAST);
    B.cyl('std', dx, y, dz, r, 8, '#eef0ee', 20, 0.75, null, PLAST);
  }
}

/** The IN USE lamp over a theatre door. */
function inuse(P) {
  const { B } = P;
  B.rbox('std', 0, 102, 0, 18, 6, 3, 0.6, '#2a2c2e', null, PLAST);
  P.pic(B, 'hs_inuse', 0, 102, -1.8, 16, 5, Math.PI, { lit: !P.day, k: 2.4 });
}

/** The freight lift car: steel walls (the room), handrails, the control panel, a hatch open in the roof. */
function liftcar(P) {
  const { B, it } = P;
  const w = it.w, d = it.d;
  for (const [x, z, len, ry] of [[w / 2 - 4, 0, d - 20, HALF], [0, -d / 2 + 4, w - 20, 0], [0, d / 2 - 4, w - 20, 0]]) {
    B.add('std', T.cyl(8), [x, 34, z], [1.4, len, 1.4], [0, ry, HALF], '#c9ced3', { ...CHROME, map: 'cyl' });
  }
  for (let x = -w / 2 + 20; x < w / 2; x += 40) {
    B.box('std', x, 16, d / 2 - 2, 2, 30, 2, '#6d7275', null, STEEL);
    B.box('std', x, 16, -d / 2 + 2, 2, 30, 2, '#6d7275', null, STEEL);
  }
  // the control panel by the door (the door is on the -x side)
  B.box('std', -w / 2 + 3, 50, d / 2 - 40, 2, 34, 14, '#9aa2a6', null, CHROME);
  for (let k = 0; k < 6; k++) P.glow(B, -w / 2 + 4.2, 40 + k * 5, d / 2 - 40, 0.4, 2, 2, k === 2 ? '#ff3a2a' : '#ffd060', k === 2 ? 3 : 0.8);
  // the hatch: a dark square in the ceiling, a ladder, blood running down the back wall
  B.quad('std', [w * 0.2, (it.h || 120) - 0.6, 0], [60, 0, 0], [0, 0, 60], '#070808', { noAO: true, surf: [0, 1, 0] });
  if (P.lod() >= 1) {
    P.decal(B, 'blood_drip', w / 2 - 6.4, 60, 0, 60, 110, -HALF);
    P.flat(B, 'blood_pool', w * 0.25, 0.4, 0, 120, 110, 0.8);
    P.pic(B, 'hs_lift', -w / 2 - 17.6, 104, 0, 60, 15, -HALF);
  }
}

/** The ER canopy: a slab on the two columns and the façade, fascia with the EMERGENCY letters, strips under it. */
function canopy(P) {
  const { B, it } = P;
  const w = it.w, d = it.d, H = it.h;
  const S1 = S(DET.panel, 0.5, 0.4);
  // (local +z runs south to the façade)
  B.rblock('std', 0, H, 0, w, 12, d, 1, '#d8d4ca', null, CONC);
  for (const e of [-1, 1]) B.box('std', e * w / 2, H + 6, 0, 3, 24, d, '#b3261e', null, S1);
  B.box('std', 0, H + 6, -d / 2, w, 24, 3, '#b3261e', null, S1);
  // the lit letters on the north fascia (they stay lit: the ER's own supply)
  P.pic(B, 'hs_emergency', 0, H + 6, -d / 2 - 2, w * 0.62, 20, Math.PI, { lit: true, k: P.day ? 0.6 : 2.6 });
  for (const e of [-1, 1]) P.pic(B, 'hs_emergency', e * (w / 2 + 2), H + 6, 0, d * 0.5, 16, e * HALF, { lit: true, k: P.day ? 0.6 : 2.2 });
  // steel beams under the slab
  for (let x = -w / 2 + 60; x < w / 2; x += 120) B.box('std', x, H - 5, 0, 6, 10, d, '#5a6066', null, STEEL);
  P.flat(P.B, 'hs_ambonly', 0, 0.4, -d * 0.1, 260, 48, Math.PI, { bucket: 'lvpic' });
  const [wx, wy] = P.toWorld(it, 0, -d / 2 - 8);
  P.halo(wx, wy, H + 6, '#ff3a2a', 150, P.day ? 0.1 : 0.55);
}

/** The hospital's monument sign at the car park entrance. */
function monument(P) {
  const { B, it } = P;
  const w = it.w;
  B.rblock('std', 0, 0, 0, w + 20, 14, 30, 2, '#6d6a64', null, CONC);
  B.rblock('std', 0, 14, 0, w, 84, 16, 1.5, '#a8a298', null, S(DET.concrete, 0.7, 0));
  for (const f of [-1, 1]) P.pic(B, 'hs_sign', 0, 56, f * 8.4, w - 12, 76, f > 0 ? 0 : Math.PI);
  P.glow(B, 0, 102, 0, w * 0.9, 1, 4, '#ffe8c0', P.day ? 0.3 : 1.2);
  if (P.lod() >= 1) { P.decal(B, 'g_notsafe', 20, 30, 8.8, 90, 34, 0); for (let i = 0; i < 5; i++) B.add('std', T.dodeca(), [-w / 2 - 30 + i * 18, 4, 22], [6, 4, 6], null, '#5a5650', CONC); }
}

/** A parking barrier: the booth post and a snapped arm on the ground. */
function barrierarm(P) {
  const { B, it } = P;
  B.rblock('std', -it.w / 2, 0, 0, 18, 40, 18, 1, '#e8e4d8', null, PAINT);
  B.box('std', -it.w / 2, 42, 0, 20, 4, 20, '#c62828', null, PAINT);
  B.box('std', 0, 2, 12, it.w * 0.8, 3, 3, '#e8e4d8', [0, 0.25, 0], PAINT);
  for (let x = -it.w * 0.35; x < it.w * 0.4; x += 24) B.box('std', x, 2, 12 + x * 0.25, 10, 3.2, 3.2, '#c62828', [0, 0.25, 0], PAINT);
}

/** An army light tower: a trailer, the mast, four lamp heads (their light: the lamps set). */
function floodtower(P) {
  const { B, it } = P;
  const H = it.h || 190;
  B.rblock('std', 0, 12, 0, 70, 30, 34, 1.5, '#4b5320', null, PAINT);
  for (const e of [-1, 1]) B.cylZ('std', 0, 9, e * 19, 9, 5, '#1c1c1c', 12, RUBBER);
  for (const [x, z] of [[-40, -30], [40, -30], [40, 30], [-40, 30]]) rod(B, 'std', [x * 0.5, 12, z * 0.5], [x, 0, z], 1.4, '#3a3d20', STEEL);
  B.cyl('std', 20, 42, 0, 3.4, H - 42, '#6d7275', 8, 0.7, null, STEEL);
  B.box('std', 20, H, 0, 3, 3, 44, '#3a3d40', null, STEEL);
  for (const z of [-16, -6, 6, 16]) B.rblock('std', 24, H - 4, z, 5, 9, 9, 0.8, '#2a2c2e', [0, 0, -0.4], STEEL);
}

/** A free-standing sign board on two legs. */
function signboard(P) {
  const { B, it } = P;
  for (const e of [-1, 1]) B.box('std', 0, (it.h + 30) / 2, e * (it.w / 2 - 3), 2, it.h + 30, 2, '#3a3d40', null, STEEL);
  for (const f of [-1, 1]) P.pic(B, it.text, f * 1.2, 30 + it.h / 2, 0, it.w, it.h, f * HALF);
}

/** An outdoor bench. */
function bench(P) {
  const { B } = P;
  for (const e of [-1, 1]) B.box('std', e * 30, 8, 0, 3, 16, 18, '#2f3336', null, STEEL);
  for (let k = 0; k < 3; k++) B.box('std', 0, 16, -6 + k * 6, 72, 2, 5, '#6b4a2c', null, WOODS);
  for (let k = 0; k < 2; k++) B.box('std', 0, 22 + k * 7, -10, 72, 5, 2, '#6b4a2c', [-0.15, 0, 0], WOODS);
}

/** The x-ray tube on its column. */
function xrayArm(P) {
  const { B } = P;
  B.box('std', -60, 60, 0, 10, 120, 10, '#d8dcd8', null, PLAST);
  B.box('std', -30, 88, 0, 60, 8, 8, '#d8dcd8', null, PLAST);
  B.rblock('std', 0, 76, 0, 22, 16, 22, 2, '#e8ece8', null, PLAST);
  P.pic(B, 'hs_xrayfilm', -64, 60, 6, 30, 22, 0, { lit: !P.day, k: 0.8 });
}

/** A whiteboard on the wall (the ward's patient board). */
function whiteboard(P) {
  const { B, it } = P;
  B.box('std', 0, 66, 0.6, it.w + 4, it.h + 4, 1.2, '#b8bec2', null, CHROME);
  P.pic(B, 'hs_whiteboard', 0, 66, 1.3, it.w, it.h, 0);
  P.pic(B, 'hs_note', it.w * 0.7, 60, 0.9, 26, 18, 0);
}

// ---- the stair ----------------------------------------------------------------------------------------

/**
 * A lane of Stair B: 20 concrete steps between two landings (the terrain climbs in micro steps under
 * them), nosings, the handrails, a painted dado following the flight, the landing floors, the soffit.
 */
function flight(P) {
  const { B, it } = P;
  const cx = it.x, cy = it.y;
  P.at(B, cx, cy, 0, Math.round(cx + cy), 0);
  const X0 = it.x0 - cx, X1 = it.x1 - cx, Z0 = it.y0 - cy, Z1 = it.y1 - cy, F0 = it.f0 - cx, F1 = it.f1 - cx;
  const h0 = it.h0, h1 = it.h1;
  const n = 20, run = (F1 - F0) / n, rise = (h1 - h0) / n;
  const east = it.east === 1;
  const wid = Z1 - Z0, zc = (Z0 + Z1) / 2;
  const concrete = S(DET.concrete, 0.85, 0);
  const stepC = '#8f8d86';
  // the steps: blocks from the ground up (the lane's lower landing level, when raised, is a block too)
  if (h0 > 0) B.block('std', (X0 + X1) / 2, 0, zc, X1 - X0, h0, wid, '#7d7b74', null, concrete);
  for (let i = 0; i < n; i++) {
    const top = h0 + (i + 1) * rise;
    const x = east ? F0 + (i + 0.5) * run : F1 - (i + 0.5) * run;
    B.block('std', x, h0, zc, run + 0.2, top - h0, wid, stepC, null, concrete);
    const nx = east ? x - run / 2 + 1.2 : x + run / 2 - 1.2;
    B.box('std', nx, top - 0.3, zc, 2.4, 0.8, wid - 2, '#d6b02a', null, S(0, 0.6, 0.1));
  }
  // the upper landing block and the landing floors
  const up0 = east ? F1 : X0, up1 = east ? X1 : F0;
  B.block('std', (up0 + up1) / 2, h0, zc, up1 - up0, h1 - h0, wid, '#7d7b74', null, concrete);
  const lo0 = east ? X0 : F1, lo1 = east ? F0 : X1;
  const land = (a, b, h) => B.quad('lvfloor', [(a + b) / 2, h + 0.05, zc], [b - a, 0, 0], [0, 0, -wid], '#8a8880', { noAO: true, surf: [DET.concrete, 0.8, 0] });
  land(lo0, lo1, h0);
  land(up0, up1, h1);
  // handrails on both walls: sloped along the flight, level along the landings
  const railY = 34;
  for (const z of [Z0 + 4, Z1 - 4]) {
    const a = [east ? F0 : F1, h0 + railY, z], b = [east ? F1 : F0, h1 + railY, z];
    rod(B, 'std', a, b, 1, '#c9a227', PAINT, 6);
    rod(B, 'std', [lo0 + 10, h0 + railY, z], [lo1, h0 + railY, z], 1, '#c9a227', PAINT, 6);
    rod(B, 'std', [up0, h1 + railY, z], [up1 - 10, h1 + railY, z], 1, '#c9a227', PAINT, 6);
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      B.box('std', x, y - 3, z + (z < zc ? -2.5 : 2.5), 1.2, 6, 5, '#5a5e62', null, STEEL);
    }
    // the dado band (painted green) and a black skirting following the steps' line
    const zf = z < zc ? Z0 + 0.35 : Z1 - 0.35, sgn = z < zc ? 1 : -1;
    const dq = (xa, ya, xb, yb, y0, y1, c) => {
      if (xb < xa) { const tx = xa, ty = ya; xa = xb; ya = yb; xb = tx; yb = ty; }
      const len = Math.hypot(xb - xa, yb - ya);
      const ang = Math.atan2(yb - ya, xb - xa);
      B.add('std', T.plane(), [(xa + xb) / 2, (ya + yb) / 2 + (y0 + y1) / 2, zf], [len, y1 - y0, 1], new THREE.Euler(0, sgn > 0 ? 0 : Math.PI, sgn > 0 ? ang : -ang, 'YXZ'), c, S(DET.brick, 0.8, 0));
    };
    const fa = east ? F0 : F1, fb = east ? F1 : F0;
    dq(fa, h0, fb, h1, 6, 28, '#2e5a44');
    dq(fa, h0, fb, h1, 0, 6, '#222522');
    dq(lo0, h0, lo1, h0, 6, 28, '#2e5a44');
    dq(up0, h1, up1, h1, 6, 28, '#2e5a44');
  }
  // the soffit: sloped over the flight, flat over the landings (150 up)
  const SOF = 150, sc = '#9c9a92';
  const ang = (east ? 1 : -1) * Math.atan2(h1 - h0, F1 - F0);
  const len = Math.hypot(F1 - F0, h1 - h0);
  B.add('std', T.plane(), [(F0 + F1) / 2, (h0 + h1) / 2 + SOF, zc], [len, wid, 1], new THREE.Euler(HALF, 0, ang, 'ZXY'), sc, S(DET.concrete, 0.9, 0));
  B.quad('std', [(lo0 + lo1) / 2, h0 + SOF, zc], [lo1 - lo0, 0, 0], [0, 0, wid], sc, { noAO: true, surf: [DET.concrete, 0.9, 0] });
  B.quad('std', [(up0 + up1) / 2, h1 + SOF, zc], [up1 - up0, 0, 0], [0, 0, wid], sc, { noAO: true, surf: [DET.concrete, 0.9, 0] });
  // bulkhead lamps on the end walls of the landings (their light: the lamps set), pipes, a hose reel
  for (const [x, h, e] of [[X0 + 0.5, h0 + (east ? 0 : h1 - h0), 1], [X1 - 0.5, (east ? h1 : h0), -1]]) {
    B.rbox('std', x + e * 2, h + 108, zc, 4, 8, 16, 1, '#3a3d40', null, STEEL);
  }
  B.cylX('std', 0, h1 + SOF - 8, Z0 + 10, 2.2, X1 - X0, '#b8433a', 8, S(0, 0.5, 0.3));
  if (P.lod() >= 1) {
    const k = it.k;
    const cells = ['g_roof', 'blood_hand', 'g_tally', 'blood_drip'];
    P.decal(B, cells[k % 4], (F0 + F1) / 2, (h0 + h1) / 2 + 60, k % 2 ? Z0 + 0.4 : Z1 - 0.4, 80, 44, k % 2 ? 0 : Math.PI);
    P.flat(B, 'blood_trail', (lo0 + lo1) / 2, h0 + 0.5, zc, 100, 34, east ? 0.2 : 2.9);
  }
}

/** A floor number stencilled on the landing's end wall. */
function stairfloor(P) {
  const { B, it } = P;
  const f = it.face || 1;
  P.at(B, it.x, it.y, 0, 7, 0);
  P.pic(B, 'hs_floor' + it.n, -f * 69.3, it.h + 60, 0, 38, 52, f * HALF);
}

// ---- roofs --------------------------------------------------------------------------------------------

/** The podium's flat roof at h: membrane, a parapet's inner face, skylights, plant, vents, puddles. */
function rooftop(P) {
  const { B, it } = P;
  const w = it.w, d = it.d, h = it.h;
  P.at(B, it.x, it.y, 0, 91, 0);
  const R = h - 12;
  B.quad('std', [0, R, 0], [w - 24, 0, 0], [0, 0, -(d - 24)], '#5f615e', { noAO: true, surf: [DET.gravel, 0.95, 0] });
  // the parapet's inner faces (the façade walls rise to h)
  const pc = '#a9a49a';
  B.quad('std', [0, (R + h) / 2, -d / 2 + 12.1], [w - 24, 0, 0], [0, h - R, 0], pc, CONC);
  B.quad('std', [0, (R + h) / 2, d / 2 - 12.1], [-(w - 24), 0, 0], [0, h - R, 0], pc, CONC);
  B.quad('std', [-w / 2 + 12.1, (R + h) / 2, 0], [0, 0, -(d - 24)], [0, h - R, 0], pc, CONC);
  // skylights over the waiting room and the corridors, plant, vents, walkway pads
  const rr = (x, z) => [x - it.x, z - it.y];
  for (const [x, z] of [[900, 1980], [1500, 1980], [3700, 2350], [3700, 3530], [5800, 3000], [1400, 3000]]) {
    const [lx, lz] = rr(x, z);
    B.rblock('std', lx, R, lz, 110, 10, 70, 1, '#8a8f94', null, STEEL);
    B.add('std', T.profile('skyl', [[-55, 0], [55, 0], [0, 26]]), [lx, R + 10, lz], [1, 1, 70], null, '#2a3a44', S(DET.glass, 0.1, 0.4));
  }
  for (const [x, z, ww, dd] of [[700, 2800, 120, 80], [2100, 3300, 100, 70], [3100, 2000, 140, 90], [4400, 2800, 120, 80], [5300, 1900, 160, 100], [6300, 2700, 120, 80], [5000, 3900, 110, 70], [2600, 4000, 110, 70]]) {
    const [lx, lz] = rr(x, z);
    B.rblock('std', lx, R, lz, ww, 36, dd, 1.5, '#9aa0a4', null, S(DET.panel, 0.45, 0.6));
    B.cyl('std', lx + ww * 0.2, R + 36, lz, Math.min(ww, dd) * 0.28, 2, '#2a2d30', 16, 1, null, S(DET.hesco, 0.5, 0.7));
    for (let k = 0; k < 5; k++) B.box('std', lx - ww / 2 + 10 + k * (ww - 20) / 4, R + 18, lz + dd / 2 + 0.4, 1.4, 26, 0.6, '#2a2d30', null, STEEL);
  }
  if (P.lod() >= 1) {
    for (let k = 0; k < 18; k++) {
      const lx = (hash01(k * 7) - 0.5) * (w - 200), lz = (hash01(k * 13) - 0.5) * (d - 200);
      B.cyl('std', lx, R, lz, 3, 16 + hash01(k) * 10, '#6d7275', 8, 1, null, STEEL);
      B.cyl('std', lx, R + 16 + hash01(k) * 10, lz, 5, 3, '#5a5e62', 8, 0.6, null, STEEL);
    }
    for (let k = 0; k < 10; k++) P.flat(B, 'grime2', (hash01(k * 3) - 0.5) * w * 0.9, R + 0.3, (hash01(k * 5) - 0.5) * d * 0.8, 200, 160, k, { bucket: 'lvgrime', color: '#8a9aa8' });
  }
}

/** The tower roof's membrane (over the terrain's concrete), drains and walkway pads. */
function roofdeck(P) {
  const { B, it } = P;
  const w = it.w, d = it.d, h = it.h;
  P.at(B, it.x, it.y, 0, 93, 0);
  B.quad('lvfloor', [0, h, 0], [w, 0, 0], [0, 0, -d], '#595b58', { noAO: true, surf: [DET.asphalt, 0.8, 0] });
  for (let k = 0; k < 14; k++) {
    const lx = -w / 2 + 80 + hash01(k * 5) * (w - 160), lz = -d / 2 + 80 + hash01(k * 11) * (d - 160);
    B.quad('lvfloor', [lx, h + 0.1, lz], [60, 0, 0], [0, 0, -60], '#7d7b74', { noAO: true, surf: [DET.slab, 0.85, 0] });
  }
  if (P.lod() >= 1) for (let k = 0; k < 8; k++) P.flat(B, 'grime', (hash01(k * 3) - 0.5) * w * 0.9, h + 0.3, (hash01(k * 7) - 0.5) * d * 0.9, 240, 200, k);
}

/** The stair house: the shaft's walls above the roof (the roof door in its north face), its roof, a lamp. */
function stairhouse(P) {
  const { B, it, map } = P;
  const h = it.h, top = it.top;
  P.at(B, 0, 0, 0, 97, 0);
  const C = '#bdb8ac';
  // a face between world corners (x0, z0) → (x1, z1), y0..top, with holes [t0, t1, top of the hole] along it
  const face = (x0, z0, x1, z1, y0, holes = []) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const q = (a, b, ya, yb) => {
      if (b - a < 0.1 || yb - ya < 0.1) return;
      const m = (a + b) / 2;
      B.quad('std', [x0 + ux * m, (ya + yb) / 2, z0 + uz * m], [ux * (b - a), 0, uz * (b - a)], [0, yb - ya, 0], C, CONC);
    };
    let cur = 0;
    for (const [a, b, yb] of holes) { q(cur, a, y0, top); q(a, b, yb, top); cur = b; }
    q(cur, len, y0, top);
  };
  const { x0, y0, x1, y1 } = it;
  // the roof door, in the north face
  const g = (map.gates || []).find((e) => e.id === 'roof_door');
  const o = g ? map.obstacles[g.obstacles[0]] : null;
  // (a quad's normal is its direction × up: going -x faces -z (north), +x faces +z, +z faces -x, -z faces +x)
  face(x1, y0, x0, y0, h, o ? [[x1 - (o.x + o.w / 2), x1 - (o.x - o.w / 2), h + 110]] : []);
  face(x0, y1, x1, y1, 494);
  face(x1, y1, x1, y0, h);
  face(x0, y0, x0, y1, 494);
  B.quad('std', [(x0 + x1) / 2, top, (y0 + y1) / 2], [x1 - x0, 0, 0], [0, 0, -(y1 - y0)], '#6d6a64', { noAO: true, surf: [DET.gravel, 0.95, 0] });
  B.box('std', (x0 + x1) / 2, top + 2, y0, x1 - x0 + 2, 4, 3, '#7d8286', null, STEEL);
  if (o) {
    P.pic(B, 'hs_stairb', o.x, h + 132, y0 - 0.8, 50, 17, Math.PI);
    B.rbox('std', o.x + 70, h + 118, y0 - 3, 12, 8, 6, 1, '#3a3d40', null, STEEL);
    P.decal(B, 'g_roof', o.x + 150, h + 60, y0 - 0.5, 100, 36, Math.PI);
  }
  // an exhaust fan on the house roof
  B.cyl('std', x1 - 120, top, y1 - 200, 16, 14, '#8a9096', 14, 1, null, STEEL);
  B.cyl('std', x1 - 120, top + 14, y1 - 200, 20, 4, '#6d7275', 14, 0.4, null, STEEL);
}

/** The helipad: the painted pad, tie-downs, the edge lights (lit: the lamps set), a fire cabinet. */
function helipad(P) {
  const { B, it } = P;
  const r = it.r;
  P.at(B, it.x, it.y, 0, 101, it.h);
  B.add('lvpic', T.plane(), [0, 0.35, 0], [r * 2, r * 2, 1], [-HALF, 0, 0], '#ffffff', { uv: P.atlas.uv('hs_helipad'), noAO: true, noJitter: true });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    B.cyl('std', Math.cos(a) * (r + 10), 0, Math.sin(a) * (r + 10), 3.6, 3, '#2a2c2e', 10, 1, null, STEEL);
  }
  for (const [x, z] of [[-r * 0.4, -r * 0.4], [r * 0.4, -r * 0.4], [r * 0.4, r * 0.4], [-r * 0.4, r * 0.4]]) B.cyl('std', x, 0, z, 2.4, 1, '#8a8f94', 8, 1, null, CHROME);
  B.rblock('std', r + 60, 0, -r * 0.6, 24, 40, 14, 1, '#c62828', null, PAINT);
  P.pic(B, 'hs_star', r + 60, 30, -r * 0.6 - 7.2, 12, 12, Math.PI);
}

/** The comms mast: a lattice tower with antennas, a dish and the red beacon on top. */
function mast(P) {
  const { B, it } = P;
  P.at(B, it.x, it.y, 0, 103, it.h);
  const H = it.top - it.h;
  const w0 = 14, w1 = 4;
  const cw = (y) => w0 + (w1 - w0) * (y / H);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) rod(B, 'std', [sx * w0, 0, sz * w0], [sx * w1, H, sz * w1], 1.3, '#a3a8ad', STEEL, 5);
  const stepY = P.lod() >= 1 ? 30 : 60;
  for (let y = 0; y < H - stepY; y += stepY) {
    const a = cw(y), b = cw(y + stepY);
    for (const [px, pz, qx, qz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      rod(B, 'std', [px * a, y, pz * a], [qx * b, y + stepY, qz * b], 0.6, '#a3a8ad', STEEL, 4);
      rod(B, 'std', [px * a, y, pz * a], [qx * a, y, qz * a], 0.6, '#a3a8ad', STEEL, 4);
    }
  }
  B.cyl('std', 0, H, 0, 1, 50, '#a3a8ad', 6, 1, null, STEEL);
  B.add('std', T.cyl(14, 1), [cw(H * 0.55) + 8, H * 0.55, 0], [12, 3, 12], [0, 0, HALF], '#e8e8e0', S(DET.panel, 0.5, 0.3));
  for (const y of [H * 0.4, H * 0.7]) for (const e of [-1, 1]) B.box('std', 0, y, e * (cw(y) + 6), 3, 36, 5, '#d8d8d0', null, PLAST);
  B.add('blink', T.sphere(6, 4), [0, H + 52, 0], [3.2, 3.2, 3.2], null, '#ff2a1a', { emissive: 3.6 });
  B.add('blink', T.sphere(6, 4), [0, H * 0.5, cw(H * 0.5) + 1], [2.4, 2.4, 2.4], null, '#ff2a1a', { emissive: 3.2 });
  P.halos.push({ x: it.x, y: it.y, h: it.top + 52, color: '#ff2a1a', size: 110, blink: 1, strength: 0.8 });
}

/** A windsock on its pole. */
function windsock(P) {
  const { B, it } = P;
  P.at(B, it.x, it.y, 0, 107, it.h);
  B.cyl('std', 0, 0, 0, 1.6, 70, '#c9ced3', 8, 1, null, STEEL);
  for (let k = 0; k < 4; k++) B.add('std', T.cyl(10, 0.78, true), [10 + k * 12, 64 - k * 3, 4 + k * 3], [7 - k * 1.3, 12, 7 - k * 1.3], [0, 0.3, HALF + 0.25], k % 2 ? '#f4f4f0' : '#e8641c', FABRIC);
}

/** SAINT MERCY in lit letters on a frame over the tower's north parapet (facing the car park). */
function bigsign(P) {
  const { B, it } = P;
  P.at(B, it.x, it.y, 0, 109, 0);
  const y = 494 + it.h / 2 + 8;
  for (let x = -it.w / 2 + 40; x <= it.w / 2 - 40; x += 120) {
    B.box('std', x, 494 + it.h / 2 + 4, 16, 3, it.h + 8, 3, '#3a3d40', null, STEEL);
    rod(B, 'std', [x, 494 + it.h, 16], [x, 450, 60], 1.2, '#3a3d40', STEEL);
  }
  B.box('std', 0, 494 + 6, 16, it.w, 3, 3, '#3a3d40', null, STEEL);
  P.pic(B, 'hs_bigsign', 0, y, 10, it.w, it.h, Math.PI, { lit: true, k: P.day ? 0.35 : 2.4, color: '#e8f0ff' });
  for (let k = -2; k <= 2; k++) P.halo(it.x + k * it.w * 0.2, it.y - 10, y, '#cfe0ff', 200, P.day ? 0.05 : 0.35);
}

/** A red cross on a pylon (seen from the car park and the street). */
function redcross(P) {
  const { B, it } = P;
  P.at(B, it.x, it.y, 0, 111, 450);
  B.box('std', 0, (it.hy - 450) / 2, 0, 6, it.hy - 450, 6, '#3a3d40', null, STEEL);
  for (const f of [-1, 1]) P.pic(B, 'hs_redcross', 0, it.hy - 450 + 10, f * 3.4, 90, 90, f > 0 ? 0 : Math.PI, { lit: true, k: P.day ? 0.4 : 2.6 });
  P.halo(it.x, it.y, it.hy + 10, '#ff3a2a', 260, P.day ? 0.05 : 0.6);
}

export const ITEMS = {
  sign, exitsign, tvwall, noticeboard, kidscorner, bay, bedcurtain, plastic, ceilinglamp, instrument, monitor, crashcart,
  orlamp, inuse, liftcar, canopy, monument, barrierarm, floodtower, signboard, bench, 'xray-arm': xrayArm, whiteboard,
  flight, stairfloor, rooftop, roofdeck, stairhouse, helipad, mast, windsock, bigsign, redcross,
};

// ---------------------------------------------------------------------------------------------
// the switchable lights: drawn into the kit's per-section builders (they go dark with their section)

/**
 * @param {object} L { builderFor(section, flicker) → geo builder, at, glow, halo, day, lod, ... }
 * @param {object} map the level
 */
export function lampsOf(L, map) {
  const items = map.levelArt || [];
  const byT = (t) => items.filter((it) => it.t === t);
  // the theatre lamps: two dish faces glowing
  for (const it of byT('orlamp')) {
    const B = L.builderFor('surgery', false);
    L.at(B, it.x, it.y, 0, 5, 0);
    for (const [dx, dz, r, y] of [[-24, 10, 20, 70], [22, -14, 15, 76]]) {
      B.add('glow', T.cyl(20), [dx, y - 0.4, dz], [r * 0.7, 0.6, r * 0.7], null, '#f4fbff', { emissive: 4, noAO: true, noJitter: true });
      L.halo(it.x + dx, it.y + dz, y - 2, '#e8f4ff', 70, 0.45);
    }
  }
  for (const it of byT('ceilinglamp')) {
    const B = L.builderFor('er', true);
    L.at(B, it.x, it.y, 0, 6, 0);
    B.add('glow', T.cyl(16), [12, (it.h || 120) - 39.4, 6], [9, 0.6, 9], null, '#f4f8ff', { emissive: 3.4, noAO: true, noJitter: true });
  }
  // the canopy's fluorescent strips
  for (const it of byT('canopy')) {
    const B = L.builderFor('parking', false);
    L.at(B, it.x, it.y, 0, 7, 0);
    for (let x = -it.w / 2 + 60; x < it.w / 2; x += 120) for (const z of [-it.d * 0.25, it.d * 0.2]) L.glow(B, x + 60, it.h - 0.8, z, 60, 1, 5, '#e8f0ff', 3);
  }
  // the army light towers
  for (const it of byT('floodtower')) {
    const B = L.builderFor('parking', false);
    L.at(B, it.x, it.y, it.a, 8, 0);
    for (const z of [-16, -6, 6, 16]) B.add('glow', T.box(), [26.8, (it.h || 190) - 4, z], [0.6, 7, 7], [0, 0, -0.4], '#f4f8ff', { emissive: 4, noAO: true, noJitter: true });
    const [wx, wy] = L.toWorld(it, 30, 0);
    L.halo(wx, wy, (it.h || 190) - 4, '#eef4ff', 160, 0.8);
  }
  // the stair's bulkhead lamps (amber) and the lanes' EXIT signs
  for (const it of byT('flight')) {
    const B = L.builderFor('stairwell', it.k === 2);
    const cx = it.x, cy = it.y;
    L.at(B, cx, cy, 0, 9 + it.k, 0);
    const east = it.east === 1;
    for (const [x, h, e] of [[it.x0 - cx + 0.5, east ? it.h0 : it.h1, 1], [it.x1 - cx - 0.5, east ? it.h1 : it.h0, -1]]) {
      L.glow(B, x + e * 4.2, h + 108, 0, 0.6, 5.5, 13, '#ffc27a', 3);
      L.halo(cx + x + e * 6, cy, h + 108, '#ffb35a', 60, 0.5);
    }
    const B2 = L.builderFor('stairwell', false);
    L.at(B2, cx, cy, 0, 19, 0);
    const xe = east ? it.x1 - cx - 1 : it.x0 - cx + 1, he = east ? it.h1 : it.h0;
    B2.add('glow', T.box(), [xe, he + 128, 0], [0.8, 8, 22], null, '#3cff7a', { emissive: 2.6, noAO: true, noJitter: true });
  }
  // the roof: the helipad's edge lights, the lamp over the roof door
  for (const it of byT('helipad')) {
    const B = L.builderFor('roof', false);
    L.at(B, it.x, it.y, 0, 11, it.h);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const c = k % 4 === 0 ? '#ffd35a' : '#59ff8a';
      B.add('glow', T.sphere(6, 4), [Math.cos(a) * (it.r + 10), 4.2, Math.sin(a) * (it.r + 10)], [2.6, 2, 2.6], null, c, { emissive: 3.4, noAO: true, noJitter: true });
      if (L.lod() >= 1) L.halo(it.x + Math.cos(a) * (it.r + 10), it.y + Math.sin(a) * (it.r + 10), it.h + 5, c, 40, 0.5);
    }
  }
  for (const it of byT('stairhouse')) {
    const g = (map.gates || []).find((e) => e.id === 'roof_door');
    if (!g) continue;
    const o = map.obstacles[g.obstacles[0]];
    const B = L.builderFor('roof', true);
    L.at(B, o.x + 70, it.y0 - 6.2, 0, 12, it.h);
    L.glow(B, 0, 116, 0, 10, 5, 2, '#fff0c8', 3);
    L.halo(o.x + 70, it.y0 - 8, it.h + 116, '#ffe8c0', 70, 0.6);
  }
  void mixHex; void CHROME;
}
