// Mill Road, section 2 (Mill Road Gas): the store's coolers, shelving, checkout and office, the
// garage's lift with a sedan up on it, benches, tool chests and tyres, the forecourt canopy and its
// pumps, the price pylon, Deke's tow truck, the fuel tanks, the propane cage and the ice chest, the
// car wash, and the army's overrun roadblock.

import {
  T, S, WOOD, RUSTY, METAL, CORR, CONC, FABRIC, PLAST, RUBBER, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, atlasUV, rod, plank, sign, sign2, decal, floorDecal, glowBox, carton, crate, drum, tyre, toWorld, litter, tubeFixture, lvUV,
} from './millroad-kit.js';
import { wheel } from './millroad-jam.js';
import { buildVehicle } from '../world-veh.js';

const RED = '#b3261e', CREAM = '#f2ead6', GREEN = '#1f5a34';

// ---- the store ---------------------------------------------------------------------------------------------

/** A row of glass-door coolers along a wall (obstacle: length along x, doors facing +z). */
function coolers(P) {
  const { B, L, W, day } = P;
  const H = 96, n = Math.max(1, Math.round(L / 38));
  const dw = L / n;
  B.rblock('std', 0, 0, -2, L, H + 6, W - 4, 1, '#e8e8e4', null, METAL);
  B.box('std', 0, H + 10, -2, L, 12, W - 2, RED, null, S(DET.panel, 0.45, 0.2));
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * dw;
    const open = hash01(i * 7 + Math.round(P.o.x)) < 0.25;
    // the lit inside (dead now: dim), the door with its handle
    B.add(day ? 'lvsign' : 'lvglow', T.plane(), [x, H / 2 + 6, W / 2 - 3.6], [dw - 4, H - 8, 1], null, day ? '#ffffff' : '#6a7078', { uv: lvUV('cooler'), noAO: true, noJitter: true });
    if (open) {
      B.add('std', T.box(), [x - dw / 2 + 2 + Math.cos(1.2) * dw / 2, H / 2 + 6, W / 2 + Math.sin(1.2) * dw / 2], [dw - 2, H - 6, 1.6], [0, -1.2, 0], '#c0c4c8', CHROME);
    } else {
      B.box('vglass', x, H / 2 + 6, W / 2 - 1.8, dw - 3, H - 8, 0.4, '#8fa2ac', null, { noJitter: true, surf: [0, 0.06, 0] });
      B.box('std', x + dw / 2 - 5, H / 2 + 6, W / 2 - 0.6, 1.6, 26, 1.6, '#d8dcdc', null, CHROME);
    }
    B.box('std', x + dw / 2, H / 2 + 6, W / 2 - 2, 1.6, H - 6, 3, '#b8bcc0', null, CHROME);
  }
  sign(B, 'mr_mart', 0, H + 10, W / 2 - 1.4, Math.min(L - 10, 200), 12, 0);
}

/** A gondola: shelves on both faces with product fronts, looted gaps, end caps, price rails. */
function shelf(P) {
  const { B, L, W } = P;
  const r = B.rng;
  const H = 62;
  B.rblock('std', 0, 0, 0, L, 5, W, 0.6, '#4a4e52', null, METAL);
  B.box('std', 0, H / 2 + 2, 0, L - 2, H, 3, '#d8d8d4', null, METAL);
  for (const x of [-L / 2 + 1, L / 2 - 1]) B.box('std', x, H / 2, 0, 2, H + 2, W, '#c8c8c4', null, METAL);
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const y = 6 + k * 15;
      B.box('std', 0, y, sd * W * 0.3, L - 4, 1.2, W * 0.42, '#e8e8e4', null, METAL);
      B.box('std', 0, y + 0.4, sd * (W / 2 - 0.2), L - 4, 2.6, 0.4, '#f0e030', null, PLAST);
      const cell = ['shelfA', 'shelfB', 'shelfC', 'shelfD'][Math.floor(hash01(k * 5 + sd + Math.round(P.o.y)) * 4)];
      sign(B, cell, 0, y + 7.6, sd * (W * 0.26), L - 6, 13, sd > 0 ? 0 : PI);
    }
  }
  // end caps: stacked cases, a chips rack
  for (const s of [-1, 1]) {
    sign(B, 'chips', s * (L / 2 + 0.4), 38, 0, W - 4, 40, s * HALF);
    carton(B, s * (L / 2 + 10), 0, 0, 14, 12, W - 8, 0, false);
  }
  // product on the floor below the looted shelves
  if (P.lod >= 1) for (let i = 0; i < 10; i++) {
    const sd = r.chance(0.5) ? 1 : -1;
    B.add('std', r.chance(0.5) ? T.box() : T.cyl(8), [r.range(-L / 2, L / 2), 1.5, sd * (W / 2 + r.range(4, 26))], [r.range(3, 6), r.range(3, 7), r.range(3, 5)], [r.range(0, 1.5), r.range(0, 6), 0], r.pick(['#c8281e', '#2a5ac4', '#e0a020', '#2f8a4a', '#e8e8e0']), PLAST);
  }
}

/** The checkout: counter with a register, lotto terminal, candy rack, a screen of bulletproof glass. */
function checkout(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 38, W, 1, '#6a4a30', null, WOOD);
  B.rblock('std', 0, 38, 0, L + 4, 2.4, W + 4, 0.6, '#e8e4d8', null, S(DET.plastic, 0.3, 0));
  B.box('std', 0, 18, W / 2 + 0.4, L - 4, 30, 0.8, '#8a6a48', null, WOOD);
  // the register and the card reader, the lotto machine
  B.rblock('std', -L * 0.2, 40.4, -W * 0.1, 18, 7, 16, 1, '#2a2c2e', null, PLAST);
  B.box('std', -L * 0.2, 50, -W * 0.2, 14, 10, 1.2, '#1a1c1e', [0.3, 0, 0], PLAST);
  B.box('glow', -L * 0.2, 50, -W * 0.2 + 0.7, 12, 8, 0.2, '#6ac8ff', [0.3, 0, 0], { emissive: 0.3, uv: atlasUV('white'), noAO: true });
  B.rblock('std', L * 0.25, 40.4, 0, 14, 16, 12, 1, '#e0c020', null, PLAST);
  sign(B, 'mr_lotto', L * 0.25, 58, 0, 14, 7, 0);
  // candy rack on the customer side
  B.rblock('std', 0, 0, W / 2 + 8, L * 0.5, 30, 12, 0.8, '#c8ccd0', null, METAL);
  for (let k = 0; k < 3; k++) sign(B, 'chips', 0, 7 + k * 9, W / 2 + 14.2, L * 0.46, 8, 0, { uv: lvUV('chips') });
  // the security screen: glass on posts, a hole shot through it
  for (const x of [-L / 2 + 2, L / 2 - 2]) B.box('std', x, 64, W / 2 - 2, 2, 50, 2, '#b8bcc0', null, CHROME);
  B.box('vglass', 0, 64, W / 2 - 2, L - 6, 48, 0.6, '#9fb2bc', null, { noJitter: true, surf: [0, 0.05, 0] });
  if (P.lod >= 1) decal(B, 'blood1', L * 0.1, 70, W / 2 - 1.4, 22, 22, 0);
}

/** The office desk: a CRT for the cameras, papers, a mug, a chair; the safe beside it. */
function officedesk(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 28, W, 1, '#5a4a3a', null, WOOD);
  B.rblock('std', 0, 28, 0, L + 2, 2, W + 2, 0.5, '#7a6a52', null, WOOD);
  for (const [x, a] of [[-L * 0.25, 0.1], [L * 0.05, -0.1]]) {
    B.rblock('std', x, 30, -W * 0.15, 20, 17, 18, 2, '#2a2a2c', [0, a, 0], PLAST);
    B.add('glow', T.plane(), [x, 39, -W * 0.15 + 9.2], [16, 12, 1], [0, a, 0], '#8ab0b8', { emissive: 0.5, uv: atlasUV('winTV'), noAO: true });
  }
  for (let i = 0; i < 5; i++) B.add('std', T.box(), [B.rng.range(-L / 2, L / 2), 30.4, B.rng.range(0, W / 2)], [8, 0.3, 11], [0, B.rng.range(0, 6), 0], '#ece6d6', FABRIC);
  // the safe, door hanging open, empty
  B.rblock('std', L / 2 + 18, 0, -W * 0.1, 30, 36, 26, 1.4, '#3a3e42', null, METAL);
  B.add('std', T.box(), [L / 2 + 18 + 12, 18, -W * 0.1 + 20], [2, 30, 24], [0, 1.2, 0], '#3a3e42', METAL);
  B.cyl('std', L / 2 + 18, 20, -W * 0.1 + 13.2, 3, 1, '#c8c8c0', 12, 1, [HALF, 0, 0], CHROME);
  // the chair pushed back
  B.cyl('std', 0, 0, W / 2 + 14, 1.2, 14, '#2a2a2c', 6, 1, null, METAL);
  B.rblock('std', 0, 14, W / 2 + 14, 16, 3, 16, 1, '#2a2a2c', null, FABRIC);
  B.rblock('std', 0, 16, W / 2 + 22, 16, 16, 2.4, 1, '#2a2a2c', [-0.15, 0, 0], FABRIC);
}

/**
 * The store's loose dressing (prop over the whole room, frame at its centre): the magazine rack, the
 * coffee station, an ice cream freezer, the ATM, posters and the sign over the door, fallen stock,
 * broken glass, a blood trail to the back office, the office's cigarette rack and TV, ceiling tubes.
 */
function storestuff(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h, r = B.rng;
  const X0 = -w / 2 + 6, X1 = w / 2 - 6, Z0 = -h / 2 + 6, Z1 = h / 2 - 6;
  // coffee station on the south wall west of the door, the ATM east of it
  B.rblock('std', -120, 0, Z1 - 12, 70, 30, 20, 0.8, '#5a3a2a', null, WOOD);
  for (let i = 0; i < 3; i++) B.cyl('std', -140 + i * 18, 30, Z1 - 12, 4, 14, '#1a1a1a', 10, 1, null, METAL);
  B.rblock('std', 110, 0, Z1 - 10, 20, 52, 16, 1.4, '#3a4a5a', null, METAL);
  B.add('glow', T.plane(), [110, 40, Z1 - 1.8], [12, 9, 1], [0, PI, 0], '#6ab0e0', { emissive: 0.4, uv: atlasUV('white'), noAO: true });
  // the ice cream freezer chest, lid up
  B.rblock('std', -40, 0, Z0 + 150, 50, 30, 26, 2, '#e8e8e4', null, PLAST);
  B.box('vglass', -40, 31, Z0 + 150, 46, 1, 22, '#9fb2bc', null, { noJitter: true, surf: [0, 0.05, 0] });
  // magazines and a newspaper rack by the window
  B.rblock('std', -200, 0, Z1 - 30, 40, 40, 10, 0.6, '#8a8e92', null, METAL);
  sign(B, 'magazines', -200, 26, Z1 - 24.8, 38, 26, 0);
  // stock and cartons everywhere, papers, glass by the door, a toppled display
  litter(B, X0, Z0 + 80, X1 - 60, Z1, P.lod >= 2 ? 70 : P.lod >= 1 ? 36 : 12);
  B.add('std', T.box(), [30, 6, Z1 - 60], [60, 10, 30], [0, 0.4, 1.4], '#c8ccd0', METAL);
  for (let i = 0; i < 16; i++) B.add('glass', T.box(), [r.range(0, 60), 0.6, Z1 - r.range(2, 40)], [r.range(2, 6), 0.3, r.range(2, 5)], [0, r.range(0, 6), 0], '#9fb2bc', S(0, 0.05, 0.1));
  // a blood trail from the door to the office, handprints on the counter side
  if (P.lod >= 1) {
    for (let i = 0; i < 6; i++) floorDecal(B, i % 2 ? 'blood2' : 'blood3', 20 + i * 18, Z1 - 30 - i * 34, 26, 30, -0.7 + r.range(-0.2, 0.2), 0.62);
    decal(B, 'hands', X1 - 0.6, 50, 20, 30, 30, -HALF);
    decal(B, 'graf1', 0, 90, Z0 + 0.7, 110, 40, 0);
  }
  // the office: cigarette rack over the counter, a TV on a bracket, a calendar
  B.rblock('std', 150, 70, Z0 + 155, 70, 36, 8, 0.6, '#3a2a1c', null, WOOD);
  for (let k = 0; k < 3; k++) sign(B, 'shelfB', 150, 76 + k * 10, Z0 + 159.2, 66, 8, 0);
  B.rblock('std', 210, 96, Z0 + 20, 26, 18, 16, 1.5, '#1a1a1c', [0, -0.6, 0], PLAST);
  sign(B, 'poster4', X1 - 0.6, 70, Z0 + 60, 16, 24, -HALF);
  sign(B, 'notice', -60, 70, Z0 + 0.6, 16, 20, 0);
  // the sign over the door, inside, and the ceiling tubes (one flickers, most dead)
  const states = ['dead', 'flicker', 'dead', 'lit', 'dead', 'dead'];
  let k = 0;
  for (let x = -180; x <= 180; x += 120) {
    for (const z of [-90, 60]) {
      const [wx, wz] = toWorld(o, x, z);
      tubeFixture(B, halos, x, 126, z, 0, states[k++ % states.length], wx, wz);
    }
  }
}

// ---- the garage -----------------------------------------------------------------------------------------------

function liftpost(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 16, 120, 16, 1.2, '#c8281e', null, S(DET.panel, 0.5, 0.3));
  B.box('std', 0, 60, 8.4, 6, 100, 0.8, '#1a1a1a', null, METAL);
  B.rblock('std', 0, 0, 0, 22, 3, 22, 0.6, '#4a4e52', null, METAL);
  B.cyl('std', 0, 120, 0, 3, 8, '#2a2a2c', 8, 1, null, METAL);
}

/** The lift's arms and a sedan up on them with its wheels off. */
function liftcar(P) {
  const { B, o } = P;
  const y = 64;
  for (const s of [-1, 1]) for (const z of [-1, 1]) plank(B, 'std', [s * 85, y - 3, 0], [s * 40, y - 3, z * 18], 5, 3, '#8a8e92', METAL);
  B.obj(o.x, o.y, o.a || 0, 77, y);
  buildVehicle(B, { id: 4711, kind: 'car', x: o.x, y: o.y, w: 84, h: 42, a: 0, color: '#6a7078', wrecked: false });
  B.obj(o.x, o.y, o.a || 0, 78);
  // its wheels leaning on the post, a drain pan under the engine
  for (let i = 0; i < 3; i++) tyre(B, -60 + i * 10, 12, 40, 8.5, [0.3, 0, HALF - 0.3]);
  B.cyl('std', 20, 0, 0, 14, 3, '#2a2a2c', 14, 1, null, METAL);
}

function workbench(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 34, W, 1, '#5a5048', null, METAL);
  B.rblock('std', 0, 34, 0, L + 2, 3, W + 2, 0.5, '#6a4a30', null, WOOD);
  // pegboard with outlines of tools, a vice, a work lamp
  B.box('std', 0, 70, -W / 2 + 1, L - 10, 56, 1.4, '#b8905a', null, S(DET.wood, 0.8, 0));
  const r = B.rng;
  for (let i = 0; i < 24; i++) B.add('std', T.box(), [r.range(-L / 2 + 14, L / 2 - 14), r.range(50, 94), -W / 2 + 2.6], [r.range(1.2, 3), r.range(6, 16), 1], [0, 0, r.range(-0.6, 0.6)], r.pick(['#c8281e', '#2a2c2e', '#8a8e92', '#e0a020']), METAL);
  B.rblock('std', -L * 0.3, 37, 0, 10, 8, 12, 1, '#3a4a6a', null, METAL);
  rod(B, 'std', [L * 0.3, 37, -W * 0.3], [L * 0.3, 58, -W * 0.1], 1, '#2a2a2c', METAL, 5);
  glowBox(B, L * 0.3, 57, -W * 0.05, 6, 3, 6, '#fff0d0', 1.2);
  sign(B, 'poster3', L * 0.42, 80, -W / 2 + 2.4, 14, 20, 0);
}

function toolchest(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 2, 0, L, 60, W, 1.4, '#c62828', null, S(DET.panel, 0.4, 0.4));
  for (let k = 0; k < 8; k++) B.box('std', 0, 8 + k * 6.6, W / 2 + 0.3, L - 6, 0.8, 0.8, '#d8dcdc', null, CHROME);
  B.add('std', T.box(), [0, 36, W / 2 + 8], [L - 8, 4, 14], [0, 0.05, 0], '#c62828', METAL);
  for (const s of [-1, 1]) B.cyl('std', s * (L / 2 - 6), 0, 0, 2.4, 2, '#1a1a1a', 8, 1, null, RUBBER);
}

function tyrerack(P) {
  const { B, L, W } = P;
  for (const x of [-L / 2 + 2, L / 2 - 2]) for (const z of [-W / 2 + 2, W / 2 - 2]) B.box('std', x, 50, z, 2.4, 100, 2.4, '#3a5a8a', null, METAL);
  for (const y of [24, 60, 96]) {
    for (const z of [-W / 2 + 2, W / 2 - 2]) B.box('std', 0, y, z, L, 2, 2, '#3a5a8a', null, METAL);
    for (let x = -L / 2 + 10; x < L / 2 - 6; x += 12) if (hash01(x * 3 + y) < 0.8) tyre(B, x, y + 10, 0, 9.5, [0, 0, HALF]);
  }
}

/** The garage's loose dressing: compressor, oil drums, an engine hoist with a block, a creeper, the calendar. */
function garagestuff(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h, r = B.rng;
  B.cyl('std', -w / 2 + 40, 0, -h / 2 + 60, 16, 50, '#c62828', 14, 1, null, METAL);
  B.cyl('std', -w / 2 + 40, 50, -h / 2 + 60, 8, 12, '#2a2a2c', 10, 1, null, METAL);
  for (let i = 0; i < 4; i++) drum(B, w / 2 - 60 + (i % 2) * 22, 0, -h / 2 + 40 + Math.floor(i / 2) * 22, r.pick(['#1a4a8a', '#2a2a2c', '#c8a020']), 30, 10);
  // the engine hoist with a V8 hanging from it
  const hx = 60, hz = 20;
  plank(B, 'std', [hx - 40, 6, hz], [hx + 30, 6, hz], 6, 4, '#c8a020', METAL);
  plank(B, 'std', [hx - 30, 6, hz], [hx - 30, 70, hz], 6, 5, '#c8a020', METAL);
  plank(B, 'std', [hx - 30, 70, hz], [hx + 20, 60, hz], 6, 5, '#c8a020', METAL);
  rod(B, 'std', [hx + 20, 60, hz], [hx + 20, 44, hz], 0.6, '#3a3a3a', METAL, 4);
  B.rblock('std', hx + 20, 22, hz, 22, 20, 16, 2, '#3a4a5a', null, RUSTY);
  B.rblock('std', hx + 10, 0, hz + 30, 30, 3, 12, 0.6, '#2a2a2c', [0, 0.3, 0], METAL);
  floorDecal(B, 'blood3', hx, hz + 20, 60, 50, 0.4, 0.6, '#3a3024');
  litter(B, -w / 2 + 20, -h / 2 + 90, w / 2 - 20, h / 2 - 40, P.lod >= 2 ? 30 : 12, 0.6, { cans: false });
  sign(B, 'poster1', -w / 2 + 0.8 + 6, 76, 0, 18, 26, HALF);
  sign(B, 'mr_evac', 0, 100, -h / 2 + 6.8, 56, 28, 0);
  for (const x of [-w / 4, w / 4]) {
    B.box('std', x, 146, 0, 3, 2, 2, '#2a2a2c', null, METAL);
    rod(B, 'std', [x, 146, 0], [x, 128, 0], 0.4, '#1a1a1a', METAL, 4);
    B.add('std', T.cyl(12, 0.35, true), [x, 124, 0], [14, 8, 14], null, '#3a4a3a', { ...METAL, map: 'cyl' });
    B.add('glow', T.sphere(8, 4), [x, 120, 0], [4, 2, 4], null, '#ffc680', { emissive: 3, uv: atlasUV('white'), noAO: true });
    const [wx, wz] = toWorld(o, x, 0);
    halos.push({ x: wx, y: wz, h: 120, color: '#ffc680', size: 80, strength: 0.5 });
  }
}

// ---- the forecourt ---------------------------------------------------------------------------------------------

function canopycol(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 30, 10, 30, 2, '#b8b4aa', null, CONC);
  B.rblock('std', 0, 10, 0, 18, 140, 18, 2, CREAM, null, S(DET.panel, 0.4, 0.3));
  B.box('std', 0, 30, 0, 18.6, 20, 18.6, RED, null, S(DET.panel, 0.4, 0.3));
  B.box('std', 0, 60, 9.4, 12, 20, 0.4, '#e8e8e0', null, PLAST);
}

/** The canopy over the pumps: a deep fascia with the logo, lights underneath (lit at night). */
function canopy(P) {
  const { B, o, halos, day } = P;
  const w = o.w, d = o.d, H = o.h;
  B.rblock('std', 0, H, 0, w, 6, d, 2, '#e8e4dc', null, S(DET.panel, 0.4, 0.3));
  for (const s of [-1, 1]) {
    B.box('std', 0, H + 14, s * (d / 2 + 0.6), w + 2, 22, 1.2, CREAM, null, S(DET.panel, 0.4, 0.25));
    B.box('std', s * (w / 2 + 0.6), H + 14, 0, 1.2, 22, d + 2, CREAM, null, S(DET.panel, 0.4, 0.25));
    B.box('std', 0, H + 4, s * (d / 2 + 0.8), w + 2.4, 4, 1.4, RED, null, S(DET.panel, 0.4, 0.25));
    B.box('std', s * (w / 2 + 0.8), H + 4, 0, 1.4, 4, d + 2.4, RED, null, S(DET.panel, 0.4, 0.25));
    B.box('std', 0, H + 25.6, s * (d / 2 + 0.8), w + 2.4, 2, 1.4, GREEN, null, S(DET.panel, 0.4, 0.25));
    sign(B, 'mr_fascia', -w * 0.08, H + 14, s * (d / 2 + 1.3), w * 0.62, w * 0.62 / 8, s > 0 ? 0 : PI, { bucket: day ? 'lvsign' : 'lvglow', color: day ? '#ffffff' : '#8a8680' });
    sign(B, 'mr_logo', w * 0.38, H + 14, s * (d / 2 + 1.3), 24, 24, s > 0 ? 0 : PI, { bucket: day ? 'lvsign' : 'lvglow', color: day ? '#ffffff' : '#8a8680' });
  }
  // the underside: panels and recessed lights, one hanging out of its housing
  B.box('std', 0, H - 0.4, 0, w - 4, 0.8, d - 4, '#c8c4bc', null, S(DET.panel, 0.5, 0.2));
  let n = 0;
  for (let x = -w / 2 + 60; x < w / 2 - 30; x += 110) {
    for (const z of [-d / 4, d / 4]) {
      const dead = n++ % 3 === 1;
      B.box('std', x, H - 1.4, z, 30, 1.2, 30, '#8a8e92', null, METAL);
      if (dead) { B.add('std', T.box(), [x + 6, H - 12, z], [28, 2, 28], [0.5, 0, 0.2], '#8a8e92', METAL); continue; }
      B.add('glow', T.plane(), [x, H - 2.2, z], [26, 26, 1], [HALF, 0, 0], '#eef4ff', { emissive: day ? 0.8 : 3.4, uv: atlasUV('white'), noAO: true });
      const [wx, wz] = toWorld(o, x, z);
      halos.push({ x: wx, y: wz, h: H - 4, color: '#eef4ff', size: 90, strength: 0.35 });
    }
  }
  // the pump islands' curbs and bollards
  for (const x of [-95, 95]) {
    B.rblock('std', x, 0, 0, 110, 7, 64, 2, '#c8c4b8', null, CONC);
    B.box('std', x, 7.2, 0, 104, 0.6, 58, '#e8c21a', null, S(DET.panel, 0.6, 0));
    for (const s of [-1, 1]) {
      B.cyl('std', x + s * 62, 0, 0, 3.4, 34, '#e8c21a', 10, 1, null, S(DET.panel, 0.5, 0.2));
      B.cyl('std', x + s * 62, 34, 0, 3.6, 2, '#c8a810', 10, 0.6, null, S(DET.panel, 0.5, 0.2));
    }
    // a squeegee bucket, a trash can
    B.cyl('std', x + 40, 7, 22, 5, 12, '#2a5ac4', 10, 1.1, null, PLAST);
    B.cyl('std', x - 40, 7, -24, 7, 22, '#3a3c3e', 10, 1, null, METAL);
  }
}

/** A modern pump with the station's colours, a hose in its holster or pulled out on the concrete. */
function pump(P) {
  const { B, L, W } = P;
  const r = B.rng;
  B.rblock('std', 0, 7, 0, L * 0.9, 58, W * 0.8, 2, '#e8e4dc', null, S(DET.panel, 0.42, 0.3));
  B.box('std', 0, 44, 0, L * 0.92, 10, W * 0.82, RED, null, S(DET.panel, 0.42, 0.3));
  B.box('std', 0, 66, 0, L * 0.96, 8, W * 0.84, GREEN, null, S(DET.panel, 0.42, 0.3));
  for (const s of [-1, 1]) {
    B.box('std', s * (L * 0.45 + 0.3), 56, 0, 0.4, 7, W * 0.5, '#101214', null, PLAST);
    B.add('glow', T.plane(), [s * (L * 0.45 + 0.6), 56, 0], [W * 0.46, 6, 1], [0, s * HALF, 0], '#ff3a1a', { emissive: 0.25, uv: atlasUV('white'), noAO: true });
    sign(B, 'mr_logo', s * (L * 0.45 + 0.5), 30, 0, 14, 14, s * HALF);
    // the nozzle: holstered or on the ground at the end of its hose
    if (r.chance(0.5)) B.box('std', s * (L * 0.45 + 2), 36, W * 0.25, 3, 8, 3, '#1a1a1a', null, PLAST);
    else {
      rod(B, 'std', [s * (L * 0.45 + 1), 40, W * 0.25], [s * (L * 0.45 + 16), 1, W * 0.7], 0.9, '#1a1a1a', RUBBER, 5);
      B.box('std', s * (L * 0.45 + 18), 1.6, W * 0.75, 6, 3, 3, '#1a1a1a', null, PLAST);
      if (P.lod >= 1) floorDecal(B, 'grime', s * (L * 0.45 + 18), W * 0.8, 20, 20, r.range(0, 6), 0.4, '#302018');
    }
  }
}

/** The price pylon at the road: two posts, the roundel on top, the price board under it. */
function pylon(P) {
  const { B, day } = P;
  const H = 300;
  for (const x of [-18, 18]) B.cyl('std', x, 0, 0, 4, H - 40, '#6a6e72', 10, 1, null, METAL);
  B.rblock('std', 0, 0, 0, 60, 10, 20, 2, '#a8a498', null, CONC);
  B.rblock('std', 0, H - 110, 0, 84, 84, 10, 2, '#2a2c2e', null, METAL);
  B.rblock('std', 0, H - 26, 0, 96, 96, 12, 3, '#e8e4dc', null, METAL);
  for (const s of [-1, 1]) {
    sign(B, 'mr_prices', 0, H - 68, s * 5.2, 80, 80, s > 0 ? 0 : PI, { bucket: day ? 'lvsign' : 'lvglow', color: day ? '#ffffff' : '#7a7470' });
    sign(B, 'mr_logo', 0, H + 22, s * 6.2, 88, 88, s > 0 ? 0 : PI, { bucket: day ? 'lvsign' : 'lvglow', color: day ? '#ffffff' : '#6a6460' });
  }
  if (P.lod >= 1) for (let i = 0; i < 2; i++) B.add('std', T.box(), [20, H - 108 - i * 6, 7], [14, 7, 1], [0, 0.2, 0.5 + i], '#1a1a1a', PLAST);
}

/** Deke's tow truck: a medium-duty cab, the wrecker body with its boom and hook, the light bar. */
function tow(P) {
  const { B, o, L, W, halos } = P;
  const paint = o.color || '#b8412a';
  // chassis and wheels (duals at the back)
  B.block('std', 0, 12, 0, L - 8, 8, W * 0.62, '#1a1a1c', null, RUSTY);
  wheel(B, L * 0.33, 13, W / 2 - 6, 9, 1);
  wheel(B, L * 0.33, 13, -W / 2 + 6, 9, -1);
  for (const x of [-L * 0.2, -L * 0.34]) { wheel(B, x, 13, W / 2 - 6, 10, 1); wheel(B, x, 13, -W / 2 + 6, 10, -1); }
  // the cab: hood, grille, doors, windows, a sun visor
  const cx = L * 0.28;
  B.rblock('paint', cx + 16, 18, 0, 34, 24, W - 8, 3, paint, null, { surf: [DET.panel, -1, -1] });
  B.box('std', cx + 33.6, 28, 0, 1, 16, W - 14, '#1a1a1a', null, S(DET.hesco, 0.4, 0.8));
  B.box('std', cx + 34, 14, 0, 3, 5, W - 2, '#c8ccd0', null, CHROME);
  B.rblock('paint', cx - 12, 18, 0, 26, 54, W - 4, 3, paint, null, { surf: [DET.panel, -1, -1] });
  B.box('glass', cx + 1.4, 56, 0, 1, 16, W - 10, '#141a20', [0, 0, -0.1], S(0, 0.08, 0.3));
  for (const sd of [-1, 1]) {
    B.box('glass', cx - 12, 56, sd * (W / 2 - 1.8), 20, 14, 0.6, '#141a20', null, S(0, 0.08, 0.3));
    sign(B, 'mr_service', cx - 12, 36, sd * (W / 2 - 1.6), 24, 3, sd > 0 ? 0 : PI);
    glowBox(B, cx + 33.4, 24, sd * (W / 2 - 7), 0.6, 5, 7, '#fff4d8', 0.5);
  }
  // the light bar (amber, still flashing on the battery that's left)
  B.rbox('std', cx - 12, 73, 0, 6, 3, W - 10, 1, '#1a1a1a', null, PLAST);
  for (const sd of [-1, 1]) {
    B.box('blink', cx - 12, 75.4, sd * (W * 0.22), 5, 2.4, W * 0.3, '#ffb020', null, { emissive: 3.2 });
    const [wx, wy] = toWorld(o, cx - 12, sd * W * 0.22);
    halos.push({ x: wx, y: wy, h: 76, color: '#ffb020', size: 60, strength: 0.5, blink: 1 });
  }
  // the wrecker body: toolboxes both sides, the boom rising back over the rear, winch, hook, chains
  const bx = -L * 0.18;
  for (const sd of [-1, 1]) B.rblock('paint', bx, 20, sd * (W / 2 - 8), L * 0.44, 26, 14, 1.6, paint, null, { surf: [DET.panel, -1, -1] });
  B.box('std', bx, 22, 0, L * 0.44, 3, W * 0.4, '#2a2a2c', null, RUSTY);
  B.rblock('std', bx + 18, 22, 0, 14, 14, 20, 1, '#2a2c2e', null, METAL);
  B.cyl('std', bx + 18, 32, 0, 5, 16, '#3a3a3c', 12, 1, [HALF, 0, 0], METAL);
  plank(B, 'std', [bx + 20, 36, 0], [-L / 2 - 14, 78, 0], 8, 10, '#c8a020', METAL);
  plank(B, 'std', [bx - 10, 22, 0], [bx - 4, 60, 0], 5, 6, '#c8a020', METAL);
  rod(B, 'std', [-L / 2 - 14, 76, 0], [-L / 2 - 14, 30, 0], 0.45, '#2a2a2a', METAL, 4);
  B.add('std', T.torus(8, 0.3, 4), [-L / 2 - 14, 27, 0], [3, 3, 3], [0, HALF, 0], '#3a3a3c', METAL);
  // the wheel-lift under the rear
  B.box('std', -L / 2 - 8, 8, 0, 18, 4, 8, '#2a2a2c', null, METAL);
  B.box('std', -L / 2 - 16, 8, 0, 4, 4, W * 0.8, '#c8a020', null, METAL);
  // the open battery box and the empty fuel cap: what it needs
  B.add('std', T.box(), [cx - 30, 30, W / 2 + 4], [16, 1.6, 10], [HALF - 0.3, 0, 0], '#2a2a2c', METAL);
  B.box('std', cx - 30, 22, W / 2 - 4, 14, 10, 10, '#101012', null, METAL);
}

// ---- the fuel tanks, propane, ice, air ------------------------------------------------------------------------

/** A horizontal fuel tank on two saddles (a big 'container'). */
function tank(P) {
  const { B, L, W, o } = P;
  const R = W / 2 - 2;
  for (const x of [-L * 0.3, L * 0.3]) B.rblock('std', x, 0, 0, 16, R + 8, W - 4, 1, '#a8a498', null, CONC);
  B.add('std', T.cyl(20), [0, R + 10, 0], [R, L - 20, R], [0, 0, HALF], o.color || '#d8d4c8', { ...S(DET.panel, 0.45, 0.4), map: 'cyl' });
  for (const s of [-1, 1]) B.add('std', T.sphere(16, 8), [s * (L / 2 - 10), R + 10, 0], [8, R, R], null, shadeHex(o.color || '#d8d4c8', -0.05), S(DET.panel, 0.45, 0.4));
  for (const x of [-L * 0.3, 0, L * 0.3]) B.add('std', T.torus(18, 0.04, 3), [x, R + 10, 0], [R + 0.6, R + 0.6, R + 0.6], [0, HALF, 0], '#8a8680', RUSTY);
  // fittings on top: vents, a manhole, the gauge; the hazard diamond and the name on the side
  B.cyl('std', -L * 0.2, 2 * R + 10, 0, 4, 10, '#6a6e72', 10, 1, null, METAL);
  B.cyl('std', L * 0.1, 2 * R + 8, 0, 9, 4, '#8a8e92', 14, 1, null, METAL);
  rod(B, 'std', [L * 0.3, 2 * R + 10, 0], [L * 0.3, 2 * R + 26, 0], 1.4, '#6a6e72', METAL, 6);
  for (const sd of [-1, 1]) {
    sign(B, 'mr_flammable', -L * 0.05, R + 10, sd * (R + 0.4), 22, 22, sd > 0 ? 0 : PI);
    sign(B, 'mr_fascia', L * 0.2, R + 18, sd * (R * 0.94 + 0.6), 80, 10, sd > 0 ? 0 : PI, { rx: -sd * 0.35 });
  }
  // pipes down to the fill station
  rod(B, 'std', [-L / 2 + 6, R + 4, W * 0.3], [-L / 2 - 10, 10, W * 0.5], 1.6, '#3a3c3e', METAL, 6);
}

function propane(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 4, W, 0.5, '#8a8e92', null, METAL);
  for (let i = 0; i < 6; i++) B.cyl('std', (i % 2 - 0.5) * 16, 4, -W / 2 + 8 + Math.floor(i / 2) * 20, 5.6, 22, '#e8e8e4', 12, 1, null, METAL);
  for (let x = -L / 2; x <= L / 2; x += 8) for (const z of [-W / 2, W / 2]) B.box('std', x, 26, z, 0.8, 50, 0.8, '#6a6e72', null, CHROME);
  for (let z = -W / 2; z <= W / 2; z += 8) for (const x of [-L / 2, L / 2]) B.box('std', x, 26, z, 0.8, 50, 0.8, '#6a6e72', null, CHROME);
  B.box('std', 0, 51, 0, L + 1, 2, W + 1, '#e8e4dc', null, METAL);
  B.box('std', 0, 56, W / 2 + 0.4, L, 8, 0.4, '#1a4a8a', null, PLAST);
}

function icechest(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 0, 0, L, 44, W, 2, '#e8ecf0', null, METAL);
  B.box('std', 0, 30, W / 2 + 0.3, L - 6, 14, 0.4, '#2a7ad8', null, PLAST);
  sign(B, 'white', 0, 30, W / 2 + 0.6, L * 0.4, 8, 0, { color: '#ffffff' });
  B.box('std', 0, 44.6, 0, L + 1, 1.2, W + 1, '#c8ccd0', null, METAL);
}

function airstand(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 16, 50, 14, 2, '#c62828', null, METAL);
  B.box('std', 0, 42, 7.2, 10, 8, 0.4, '#e8e8e4', null, PLAST);
  rod(B, 'std', [0, 30, 7], [18, 0.5, 20], 0.7, '#1a1a1a', RUBBER, 4);
  B.rblock('std', 50, 0, 0, 26, 46, 18, 2, '#1a5a9a', null, METAL);
  rod(B, 'std', [50, 40, 9], [62, 60, 20], 2, '#3a3c3e', RUBBER, 6);
}

// ---- the car wash ----------------------------------------------------------------------------------------------

/** The wash tunnel's machinery: an arch, two big roller brushes, the side brushes, the sign, hoses. */
function carwash(P) {
  const { B, o, halos } = P;
  const w = o.w, d = o.d;
  // arches across the tunnel
  for (const x of [-w * 0.3, w * 0.15]) {
    for (const s of [-1, 1]) B.box('std', x, 50, s * (d / 2 - 12), 6, 100, 6, '#c8ccd0', null, METAL);
    B.box('std', x, 100, 0, 6, 6, d - 18, '#c8ccd0', null, METAL);
  }
  // the top roller and two side brushes (fabric strips round a core)
  const brush = (x, y, z, rad, len, rot) => {
    B.add('std', T.cyl(18), [x, y, z], [rad, len, rad], rot, '#2a6ad8', { ...S(DET.fabric, 0.95, 0), map: 'cyl', wobble: { amp: 0.12, seed: Math.round(x + z) } });
    B.add('std', T.cyl(8), [x, y, z], [2, len + 6, 2], rot, '#8a8e92', { ...METAL, map: 'cyl' });
  };
  brush(-w * 0.3 + 10, 76, 0, 16, d - 40, [HALF, 0, 0]);
  for (const s of [-1, 1]) brush(w * 0.15 + 10, 44, s * (d / 2 - 34), 18, 80, null);
  // hanging cloth strips at the entrance
  for (let z = -d / 2 + 20; z < d / 2 - 20; z += 7) B.box('std', w * 0.42, 70, z, 0.6, 40, 5, '#d8e4f0', [0, 0, (hash01(z) - 0.5) * 0.3], FABRIC);
  // the signs at both ends
  for (const s of [-1, 1]) sign(B, 'mr_wash', s * (w / 2 + 1), 106, 0, 80, 20, s * HALF);
  // hoses and a dryer blower
  B.rblock('std', -w * 0.05, 88, 0, 40, 18, 60, 3, '#e8e8e4', null, PLAST);
  for (let i = 0; i < 3; i++) rod(B, 'std', [-w * 0.45 + i * 30, 110, -d / 2 + 10], [-w * 0.45 + i * 30 + 10, 5, -d / 2 + 26], 1.2, '#1a1a1a', RUBBER, 5);
  const [wx, wz] = toWorld(o, 0, 0);
  halos.push({ x: wx, y: wz, h: 100, color: '#dfe8ff', size: 90, strength: 0.4, flicker: 0.4 });
}

/** The car wash roof (its own style): a flat slab with a blue fascia. */
function carwashRoof(P) {
  const { B, o } = P;
  B.rblock('std', 0, 118, 0, o.w + 4, 6, o.h + 4, 1.5, '#e8e6de', null, CONC);
  for (const s of [-1, 1]) B.box('std', 0, 124, s * (o.h / 2 + 2.4), o.w + 6, 14, 1.2, '#1a6ab0', null, S(DET.panel, 0.45, 0.3));
  B.box('std', 0, 117.4, 0, o.w - 8, 0.6, o.h - 8, '#c8ccd0', null, METAL);
}

function vacuum(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 20, 60, 20, 2, '#e0a020', null, METAL);
  B.box('std', 0, 50, 10.4, 16, 12, 0.4, '#1a1a1a', null, PLAST);
  B.cyl('std', 0, 60, 0, 3, 50, '#c8ccd0', 8, 1, null, METAL);
  rod(B, 'std', [0, 110, 0], [40, 104, 0], 1.6, '#c8ccd0', METAL, 6);
  rod(B, 'std', [40, 104, 0], [36, 4, 20], 1.2, '#1a1a1a', RUBBER, 5);
}

// ---- the army's roadblock ---------------------------------------------------------------------------------------

/** The overrun quarantine post: a fence line, signs, a checkpoint booth, medical waste, body bags, a burn pit. */
function quarantine(P) {
  const { B } = P;
  const r = B.rng;
  // the checkpoint booth with its barrier arm raised
  B.rblock('std', 60, 0, 290, 60, 90, 50, 2, '#6a7050', null, METAL);
  B.box('vglass', 60, 64, 290 + 25.4, 50, 26, 0.4, '#8fa2ac', null, { noJitter: true, surf: [0, 0.06, 0] });
  B.box('std', 60, 92, 290, 70, 4, 60, '#4b5320', null, METAL);
  B.box('std', 110, 30, 360, 8, 60, 8, '#e8e8e0', null, METAL);
  B.add('std', T.box(), [110, 110, 360], [4, 160, 4], [0, 0, 0.1], '#e8e8e0', PLAST);
  for (let i = 0; i < 6; i++) B.box('std', 110 + Math.sin(0.1) * (i * 26 - 60), 50 + i * 26, 360, 4.4, 10, 4.4, '#c62828', null, PLAST);
  // the fence line: posts and razor wire pulled down
  for (let z = -600; z < 1300; z += 60) {
    if (z > 330 && z < 680) continue;   // (the road)
    B.cyl('std', 250, 0, z, 2, 60, '#6a6e72', 6, 1, null, METAL);
    if (P.lod >= 1) B.add('std', T.torus(10, 0.04, 3), [250, 20 + (hash01(z) < 0.5 ? 40 : 0), z + 30], [14, 14, 14], [0, HALF, 0], '#8a8e92', CHROME);
  }
  // signs on the posts
  for (const z of [-400, 200, 800]) sign(B, 'mr_closed', 252, 50, z, 36, 27, HALF);
  // medical waste bins, crates, a burn pit with ash
  for (let i = 0; i < 6; i++) B.rblock('std', r.range(-200, 200), 0, r.range(-500, -300), 16, 22, 16, 1.5, r.chance(0.5) ? '#c62828' : '#e0c020', [0, r.range(0, 6), 0], PLAST);
  for (let i = 0; i < 8; i++) crate(B, r.range(-150, 150), 0, r.range(-100, 200), 18, 14, 18, r.range(0, 6), '#4b5320');
  B.cyl('std', -100, 0, 700, 60, 4, '#1a1816', 18, 1, null, S(DET.char, 0.95, 0));
  for (let i = 0; i < 10; i++) B.add('std', T.dodeca(), [-100 + r.range(-40, 40), 4, 700 + r.range(-40, 40)], [r.range(4, 10), r.range(2, 5), r.range(4, 10)], [0, r.range(0, 6), 0], '#2a2622', S(DET.char, 0.95, 0));
  if (P.lod >= 1) for (let i = 0; i < 5; i++) floorDecal(B, 'blood3', r.range(-200, 200), r.range(-400, 900), 50, 40, r.range(0, 6), 0.5);
}

/** On the T-walls' east face: a big ROAD CLOSED board, barrels, a light tower gone dark. */
function roadclosed(P) {
  const { B } = P;
  B.box('std', 18, 70, 0, 2, 50, 140, '#e8e8e0', null, METAL);
  sign(B, 'mr_closed', 19.2, 70, 0, 130, 97, HALF);
  for (const z of [-120, -90, 100, 130]) drum(B, 40, 0, z, '#e0641c', 34, 11);
  // a light tower on its trailer
  B.rblock('std', 80, 12, -200, 60, 20, 30, 2, '#e0c020', null, METAL);
  B.cyl('std', 90, 32, -200, 3, 180, '#8a8e92', 8, 1, null, METAL);
  B.box('std', 90, 212, -200, 6, 6, 60, '#3a3c3e', null, METAL);
  for (const z of [-222, -206, -194, -178]) B.rbox('std', 94, 214, z, 8, 10, 12, 1, '#2a2c2e', [0, 0, 0.3], METAL);
}

export const GAS_MODELS = {
  'mr-coolers': coolers, 'mr-shelf': shelf, 'mr-checkout': checkout, 'mr-officedesk': officedesk, 'mr-storestuff': storestuff,
  'mr-liftpost': liftpost, 'mr-liftcar': liftcar, 'mr-workbench': workbench, 'mr-toolchest': toolchest, 'mr-tyrerack': tyrerack, 'mr-garagestuff': garagestuff,
  'mr-canopycol': canopycol, 'mr-canopy': canopy, 'mr-pump': pump, 'mr-pylon': pylon, 'mr-tow': tow, 'mr-tank': tank, 'mr-propane': propane,
  'mr-icechest': icechest, 'mr-airstand': airstand, 'mr-carwash': carwash, 'mr-vacuum': vacuum, 'mr-quarantine': quarantine, 'mr-roadclosed': roadclosed,
};
export const GAS_ROOFS = { 'mr-carwash': carwashRoof };
void [CORR, FABRIC, mixHex, sign2, NJ, WOOD];
