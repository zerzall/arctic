// Hollow Creek, sections 3 and 4: the Rexall (its grille and fascia, the looted sales floor, the pharmacy
// counter and the dispensary's bins, the till, the stock room; the bank and the laundromat on its lot) and
// St. Anne's (the churchyard gate and its piers, the nave's roof and trusses, the pews, the altar and the
// chancel, the shelter cots, the bell tower's steeple and bell, the signboard, the mausoleum).

import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CONC, FABRIC, PLAST, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, shelfRow, decal, floorDecal, glowBox, carton, toWorld, lvUV, litter, pendant, tubeFixture,
} from './millroad-kit.js';
import { building } from '../world-bld.js';

const GLASS = { noJitter: true, surf: [0, 0.06, 0] };
const STONE = { noJitter: true, surf: [DET.rock, 0.9, 0] };

/** A candle (lit at night). */
function candle(P, x, y, z, h = 8) {
  const { B, o, halos } = P;
  B.cyl('std', x, y, z, 1.2, h, '#f0ead8', 8, 1, null, S(0, 0.6, 0));
  if (!P.day) {
    B.add('glow', T.sphere(6, 4), [x, y + h + 1.2, z], [0.8, 1.6, 0.8], null, '#ffb050', { emissive: 3, uv: atlasUV('white'), noAO: true, noJitter: true });
    if (halos) { const [wx, wy] = toWorld(o, x, z); halos.push({ x: wx, y: wy, h: y + h + 1, color: '#ffb050', size: 22, strength: 0.5, flicker: 0.6 }); }
  }
}

// ---- the Rexall ---------------------------------------------------------------------------------------------

/** The roll-down grille over the Rexall's front (the gate): slats of steel mesh, the bottom bar, a padlock. */
function grille(P) {
  const { B, L } = P;
  const H = 96;
  B.add('fence', T.plane(), [0, H / 2, 0], [L, H, 1], null, '#9aa0a4', { uvScale: [L / 10, H / 10] });
  B.add('fence', T.plane(), [0, H / 2, 0], [L, H, 1], [0, PI, 0], '#9aa0a4', { uvScale: [L / 10, H / 10] });
  for (let y = 4; y < H; y += 8) B.box('std', 0, y, 0, L, 1.2, 1.6, '#8a8e92', null, S(DET.panel, 0.45, 0.7));
  B.box('std', 0, 2.5, 0, L, 5, 3, '#6a6e72', null, RUSTY);
  B.rblock('std', L * 0.2, 0, -2.4, 6, 8, 3, 0.8, '#c8a040', null, S(0, 0.3, 0.9));
  decal(B, 'graf4', -L * 0.1, 50, -1.2, L * 0.6, 26, PI);
}

/** The Rexall's fascia on the front, the Rx blade sign out over the sidewalk (lit at night). */
function pharmsign(P) {
  const { B, o, halos } = P;
  sign(B, 'hc_rexall', 3.6, 127, 0, 230, 23, HALF);
  B.box('std', 2.2, 127, 0, 2, 25, 234, '#1a4a8a', null, { noJitter: true, ...S(DET.panel, 0.5, 0.3) });
  const z = -160;
  B.box('std', 30, 108, z, 50, 3, 3, '#3a3c3e', null, METAL);
  B.box('std', 32, 96, z, 44, 24, 5, '#1a4a8a', null, METAL);
  for (const s of [-1, 1]) sign(B, 'hc_rx', 32, 96, z + s * 2.8, 42, 11, s > 0 ? 0 : PI, P.day ? {} : { bucket: 'lvglow' });
  if (!P.day) { const [wx, wy] = toWorld(o, 32, z); halos.push({ x: wx, y: wy, h: 96, color: '#8ab0ff', size: 70, strength: 0.4 }); }
  // posters in the windows
  for (const [zz, cell] of [[-160, 'poster2'], [150, 'hc_notice2'], [190, 'poster4']]) sign(B, cell, -0.4, 60, zz, 20, 30, HALF);
}

/** Shelving along a wall (local +z faces the room): uprights, shelves of product, most of it gone. */
function wallshelf(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 84;
  B.box('std', 0, H / 2, -D / 2 + 1, L, H, 2, '#d8dcdc', null, S(DET.panel, 0.6, 0.2));
  for (let x = -L / 2; x <= L / 2 + 0.1; x += L / Math.round(L / 90)) B.box('std', x, H / 2, 0, 2, H, D, '#8a9296', null, METAL);
  for (const y of [8, 26, 44, 62, 80]) {
    B.box('std', 0, y, 0, L, 1.4, D - 2, '#c8ccce', null, METAL);
    shelfRow(B, ['hc_meds', 'hc_meds', 'shelfD', 'shelfB', 'shelfC'], -L / 2 + 2, L / 2 - 2, y + 8, D / 2 - 1, 14, 0, 60);
  }
  if (P.lod >= 1) for (let k = 0; k < 14; k++) B.rblock('std', r.range(-L / 2, L / 2), 0, D / 2 + r.range(4, 50), r.range(4, 8), r.range(2, 5), r.range(3, 6), 0.4, r.pick(['#e8e8e8', '#2a6ab0', '#c62828', '#f0c020']), [0, r.range(0, 6), 0], PLAST);
}

/** A double-sided gondola of medicine and toiletries, end caps, stock swept onto the floor. */
function gondola(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 62;
  B.box('std', 0, 3, 0, L, 6, D, '#6a7074', null, METAL);
  B.box('std', 0, H / 2, 0, L, H, 2, '#d8dcdc', null, S(DET.panel, 0.6, 0.2));
  for (const s of [-1, 1]) {
    for (const y of [16, 34, 52]) {
      B.box('std', 0, y, s * D / 4, L, 1.2, D / 2 - 1, '#c8ccce', null, METAL);
      shelfRow(B, ['hc_meds', 'hc_meds', 'shelfD', 'shelfC'], -L / 2 + 2, L / 2 - 2, y + 7, s * (D / 2 - 0.8), 13, s > 0 ? 0 : PI, 60);
    }
    for (let k = 0; k < (P.lod >= 1 ? 16 : 5); k++) B.rblock('std', r.range(-L / 2, L / 2), 0, s * (D / 2 + r.range(3, 40)), r.range(4, 8), r.range(2, 5), r.range(3, 6), 0.4, r.pick(['#e8e8e8', '#2a6ab0', '#c62828', '#f0c020', '#3a9a5a']), [0, r.range(0, 6), 0], PLAST);
  }
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 + 8), 30, 0, 16, 60, D, '#1a4a8a', null, METAL);
    sign(B, 'hc_meds', s * (L / 2 + 16.2), 40, 0, D - 4, 30, s * HALF);
  }
}

/** The pharmacy counter (customers on local -z): the Rx sign hung over it, the register, the pickup bins. */
function pcounter(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.rblock('std', 0, 0, 0, L, 40, D, 1, '#e8e4d8', null, S(DET.panel, 0.6, 0.1));
  B.box('std', 0, 20, -D / 2 - 0.4, L, 30, 0.8, '#1a4a8a', null, S(DET.panel, 0.5, 0.2));
  B.box('std', 0, 41, 0, L + 4, 2, D + 4, '#c8c0a8', null, S(0, 0.4, 0));
  B.box('vglass', L * 0.1, 54, -D / 2 + 2, L * 0.6, 24, 0.5, '#9ab0b8', null, GLASS);
  B.rblock('std', -L * 0.3, 42, 2, 18, 10, 14, 1, '#3a3c3e', null, METAL);
  for (let k = 0; k < 6; k++) B.rblock('std', L * 0.3 + (k % 3) * 9 - 9, 42, 6 + Math.floor(k / 3) * 7, 7, 6, 5, 0.4, '#f0f0e8', [0, r.range(-0.2, 0.2), 0], PLAST);
  // the Rx sign on chains from the ceiling
  for (const s of [-1, 1]) rod(B, 'std', [s * 50, 112, 0], [s * 50, 128, 0], 0.3, '#2a2a2a', METAL, 3);
  B.box('std', 0, 104, 0, 124, 18, 2, '#1a4a8a', null, METAL);
  sign(B, 'hc_rx', 0, 104, -1.2, 120, 16, PI);
  sign(B, 'hc_rx', 0, 104, 1.2, 120, 16, 0);
  // prescriptions in bags, papers, a spilled bottle of pills on the floor in front
  if (P.lod >= 1) for (let k = 0; k < 20; k++) B.add('std', T.sphere(4, 3), [r.range(-40, 40), 0.8, -D / 2 - r.range(4, 30)], [0.8, 0.5, 0.8], null, r.pick(['#f0f0e8', '#e8c040', '#c84a4a']), NJ);
  floorDecal(B, 'papers', 0, -D / 2 - 30, 60, 50, 0.3, 0.6);
}

/** The dispensary's wall of drug bins (facing local -z): a grid of drawers, many pulled out and emptied. */
function bins(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 96;
  B.box('std', 0, H / 2, D / 2 - 4, L, H, 8, '#d8d4c8', null, S(DET.panel, 0.6, 0.1));
  const cols = Math.round(L / 16), rows = 8;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -L / 2 + (i + 0.5) * (L / cols), y = 10 + j * 10.5;
      const out = r.chance(0.3) ? r.range(4, 12) : 0;
      if (r.chance(0.08)) continue;
      B.box('std', x, y, -D / 2 + 8 - out, L / cols - 1.6, 9, 12, r.pick(['#e8e4d8', '#c8d8e8', '#e8d8c8']), null, PLAST);
      if (P.lod >= 1) B.box('std', x, y + 2, -D / 2 + 1.8 - out, 4, 1, 0.6, '#3a3c3e', null, METAL);
    }
  }
  B.box('std', 0, 3, -D / 2 + 6, L, 6, 14, '#6a6e72', null, METAL);
}

/** The front till by the door: the register and scanner, a candy rack on the customer side, lotto. */
function till(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.rblock('std', 0, 0, 0, L, 38, D, 1, '#1a4a8a', null, S(DET.panel, 0.5, 0.2));
  B.box('std', 0, 39, 0, L + 3, 2, D + 3, '#e8e4d8', null, S(0, 0.4, 0));
  B.rblock('std', 0, 40, -4, 16, 10, 14, 1, '#3a3c3e', null, METAL);
  B.box('std', 0, 44, -12, 14, 3, 6, '#2a2c2e', [0.3, 0, 0], METAL);
  for (let k = 0; k < 3; k++) sign(B, 'chips', -L * 0.3 + k * 26, 20, D / 2 + 1, 24, 24, 0);
  sign(B, 'mr_lotto', L * 0.3, 52, 0, 24, 12, 0);
  B.box('std', L * 0.3, 44, 0, 2, 12, 2, '#3a3c3e', null, METAL);
  for (let k = 0; k < 6; k++) B.rblock('std', r.range(-L / 2, L / 2), 0, D / 2 + r.range(4, 26), 5, 1.4, 3, 0.3, r.pick(['#c8281e', '#e8c020', '#2a5ab0']), [0, r.range(0, 6), 0], PLAST);
}

/** Steel pallet racking (open face on local -z): orange beams, blue uprights, cartons on three levels. */
function rack(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 120;
  for (let x = -L / 2 + 2; x <= L / 2; x += (L - 4) / 3) for (const z of [-D / 2 + 2, D / 2 - 2]) B.box('std', x, H / 2, z, 3, H, 3, '#2a4a8a', null, METAL);
  for (const y of [4, 44, 84]) {
    for (const z of [-D / 2 + 2, D / 2 - 2]) B.box('std', 0, y + 3, z, L, 5, 2.4, '#e0701a', null, METAL);
    B.box('std', 0, y + 5.4, 0, L - 4, 0.8, D - 4, '#8a8e92', null, METAL);
    for (let x = -L / 2 + 14; x < L / 2 - 10; x += r.range(20, 30)) if (r.chance(0.92)) carton(B, x, y + 6, r.range(-4, 4), r.range(16, 24), r.range(14, 28), r.range(18, 26), r.range(-0.1, 0.1), false);
  }
}

/** The controlled-substance safe: a heavy steel cabinet, shut and locked (the looters never got back here),
 *  the dial, the handle, a sticker; boxes of stock on top. */
function drugsafe(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 80, D, 1.5, '#4a5058', null, S(DET.panel, 0.4, 0.8));
  B.box('std', 0, 40, -D / 2 - 0.2, L - 8, 72, 0.6, '#3a4048', null, S(DET.panel, 0.4, 0.8));
  B.cyl('std', -L * 0.15, 48, -D / 2 - 1, 5, 2, '#c8ccce', 16, 1, [HALF, 0, 0], CHROME);
  B.box('std', L * 0.22, 40, -D / 2 - 1.6, 4, 16, 3, '#c8ccce', null, CHROME);
  sign(B, 'hc_rx', 0, 66, -D / 2 - 0.8, 30, 7.5, PI);
  for (let k = 0; k < 3; k++) carton(B, -L * 0.2 + k * 12, 80, 0, 10, 8, 14, 0.1 * k, false);
}

/** A pallet of cartons, shrink-wrapped, the wrap slit open. */
function pallet(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  for (let k = 0; k < 3; k++) B.box('std', 0, 2, -D / 2 + 6 + k * (D - 12) / 2, L, 4, 6, '#a8844e', null, WOOD);
  B.box('std', 0, 5, 0, L, 2, D, '#b9955a', null, WOOD);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < (i + j) % 2 + 2; k++) carton(B, -L / 4 + i * L / 2, 6 + k * 14, -D / 4 + j * D / 2, L / 2 - 2, 14, D / 2 - 2, r.range(-0.05, 0.05), false);
  B.box('vglass', 0, 26, 0, L + 1, 40, D + 1, '#dce4e8', null, { noJitter: true, surf: [0, 0.2, 0] });
}

/** The sales floor: tube lights in a grid, a round security mirror, aisle litter, a body under a sheet. */
function pstuff(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let x = -w / 2 + 80; x < w / 2 - 40; x += 150) {
    for (const z of [-140, 0, 140]) tubeFixture(B, P.halos, x, 126, z, 0, hash01(x * 3 + z) < 0.25 ? 'dead' : hash01(x + z * 7) < 0.2 ? 'flicker' : 'lit');
  }
  B.add('std', T.sphere(12, 8), [w / 2 - 20, 110, -h / 2 + 20], [12, 12, 5], [0, -PI / 4, 0], '#c8d0d4', S(0, 0.05, 0.95));
  litter(B, -w / 2 + 20, -h / 2 + 20, w / 2 - 20, h / 2 - 20, P.lod >= 1 ? 40 : 12, 0.6);
  // the pharmacist, under a sheet by the counter, a trail toward the stock room
  B.add('std', T.pillow(10, 6, 0.3), [-w / 2 + 70, 5, 40], [32, 6, 12], [0, 0.3, 0], '#e8e8e4', FABRIC);
  floorDecal(B, 'blood3', -w / 2 + 70, 52, 50, 30, 0.3, 0.6);
  if (P.lod >= 1) for (let k = 0; k < 6; k++) floorDecal(B, 'blood3', -w / 2 + 50 - k * 6, 10 - k * 12, 14, 10, r.range(0, 6), 0.62);
  decal(B, 'hands', -w / 2 + 6.4, 50, -120, 34, 34, HALF);
}

/** The stock room: cartons, a hand truck, the loading door's dock plate, a desk with a lamp, a bare bulb. */
function stock(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let i = 0; i < 8; i++) carton(B, r.range(20, w / 2 - 20), 0, r.range(40, 200), r.range(14, 22), r.range(10, 18), r.range(14, 20), r.range(0, 6), r.chance(0.5));
  plank(B, 'std', [60, 0, -120], [56, 50, -126], 16, 1.6, '#c8281e', METAL);
  for (const s of [-1, 1]) B.add('std', T.cyl(10), [60 + s * 7, 4, -118], [4, 2, 4], [0, 0, HALF], '#1a1a1a', { ...METAL, map: 'cyl' });
  B.box('std', 0, 0.8, -h / 2 + 22, 160, 1.6, 30, '#8a8e92', null, S(DET.panel, 0.5, 0.7));
  B.rblock('std', w / 2 - 34, 0, 150, 40, 30, 24, 1, '#6a6e72', null, METAL);
  B.cyl('std', w / 2 - 44, 30, 150, 3, 12, '#2a2a2a', 8, 1, null, METAL);
  B.add('std', T.cyl(10, 0.5, true), [w / 2 - 44, 44, 152], [5, 6, 5], [0.4, 0, 0], '#2a6a3a', METAL);
  const [wx, wy] = toWorld(o, 0, 40);
  pendant(B, P.day ? null : P.halos, 0, 110, 40, wx, wy, '#ffd9a0', !P.day);
  B.cyl('std', -w / 2 + 40, 0, 200, 8, 14, '#e0b020', 12, 1, null, PLAST);
  rod(B, 'std', [-w / 2 + 40, 10, 200], [-w / 2 + 44, 70, 206], 0.8, '#8a6a48', WOOD, 4);
  litter(B, -w / 2 + 20, -h / 2 + 30, w / 2 - 20, h / 2 - 30, P.lod >= 1 ? 16 : 5, 0.6);
}

/** First National Bank: the world's office block, pilasters and an entablature with the name, the ATM. */
function bank(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  const L = o.w, W = o.h;
  const z = W / 2 + 3;
  for (const x of [-150, -75, 75, 150]) {
    B.cyl('std', x, 8, z, 8, 136, '#d8d0bc', 12, 1, null, STONE);
    B.rblock('std', x, 0, z, 20, 8, 12, 1, '#c8c0ac', null, STONE);
    B.rblock('std', x, 144, z, 20, 6, 12, 1, '#c8c0ac', null, STONE);
  }
  B.box('std', 0, 164, z + 2, L - 20, 28, 8, '#d0c8b4', null, STONE);
  sign(B, 'hc_bank', 0, 164, z + 6.2, 330, 24, 0);
  B.rblock('std', 0, 0, z + 12, 120, 3, 20, 1, '#b8b0a0', null, STONE);
  // the ATM, screen smashed
  B.rblock('std', 110, 30, W / 2 + 1, 26, 40, 4, 1, '#3a3c40', null, METAL);
  B.box('std', 110, 58, W / 2 + 3.4, 16, 10, 0.4, '#1a2a34', null, S(0, 0.1, 0.2));
  decal(B, 'graf3', -60, 60, W / 2 + 1, 120, 44, 0);
}

/** The coin laundry: the world's shop building, its sign, a bench out front, a cart. */
function laundromat(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  const W = o.h;
  B.box('std', 0, 124, W / 2 + 1.2, 260, 34, 2, '#2a8a9a', null, METAL);
  sign(B, 'hc_laundry', 0, 124, W / 2 + 2.4, 256, 32, 0);
  plank(B, 'std', [100, 18, W / 2 + 12], [150, 18, W / 2 + 12], 12, 2, '#6a4a30', WOOD);
  for (const x of [104, 146]) B.box('std', x, 9, W / 2 + 12, 3, 18, 10, '#2a2a2a', null, METAL);
  B.rblock('std', -120, 8, W / 2 + 20, 24, 16, 18, 1, '#c8ccce', [0, 0.3, 0], CHROME);
}

// ---- St. Anne's ----------------------------------------------------------------------------------------------------

/** The churchyard's wrought-iron double gate (the gate): bars with spear finials, scrolls, an arched top rail. */
function irongate(P) {
  const { B, L } = P;
  const iron = '#1c1c1e';
  const mo = { noJitter: true, ...S(DET.panel, 0.55, 0.6) };
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 1 : -L / 2 + 1, x1 = s > 0 ? L / 2 - 1 : -1;
    for (const y of [8, 40, 74]) B.box('std', (x0 + x1) / 2, y, 0, x1 - x0, 2.4, 2, iron, null, mo);
    for (let x = x0 + 4; x < x1; x += 9) {
      const hTop = 80 + Math.cos(((x / (L / 2)) * PI) / 2) * 24;
      B.box('std', x, hTop / 2, 0, 1.4, hTop, 1.4, iron, null, mo);
      B.add('std', T.cyl(4, 0), [x, hTop + 3, 0], [2, 7, 2], null, iron, mo);
    }
    if (P.lod >= 1) for (let k = 0; k < 4; k++) B.add('std', T.torus(10, 0.08, 3), [(x0 + x1) / 2 + (k - 1.5) * 24, 57, 0], [8, 8, 8], null, iron, mo);
    rod(B, 'std', [x0, 86, 0], [s * 1, 104, 0], 1, iron, mo, 4);
  }
  B.rblock('std', 3, 38, -2.4, 6, 12, 3, 0.8, '#6a6a6a', null, RUSTY);
}

/** The piers either side of the churchyard gate: stone, caps with lanterns (lit at night). */
function gateposts(P) {
  const { B, o, halos } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 14);
    B.rblock('std', x, 0, 0, 28, 100, 28, 1.5, '#9a9282', null, STONE);
    B.rblock('std', x, 100, 0, 34, 6, 34, 1, '#a8a092', null, STONE);
    B.rblock('std', x, 106, 0, 12, 4, 12, 1, '#1a1a1a', null, METAL);
    B.box(P.day ? 'std' : 'glow', x, 117, 0, 9, 16, 9, P.day ? '#c8c0a0' : '#ffc070', null, P.day ? S(0, 0.2, 0) : { emissive: 2.6, uv: atlasUV('white'), noAO: true });
    B.add('std', T.cyl(4, 0.1), [x, 128, 0], [8, 6, 8], null, '#1a1a1a', METAL);
    if (!P.day) { const [wx, wy] = toWorld(o, x, 0); halos.push({ x: wx, y: wy, h: 117, color: '#ffc070', size: 50, strength: 0.6 }); }
  }
}

/** A pew facing the altar (local -z): the seat, the back, carved ends, the kneeler, hymnals in the rack. */
function pew(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const oak = '#6a4428';
  B.box('std', 0, 17, -1, L - 6, 2.4, D - 6, oak, null, WOOD);
  B.box('std', 0, 30, D / 2 - 3, L - 6, 26, 2.4, oak, [-0.12, 0, 0], WOOD);
  B.box('std', 0, 44, D / 2 - 1.4, L - 4, 2.4, 4, shadeHex(oak, 0.1), null, WOOD);
  for (const s of [-1, 1]) {
    B.box('std', s * (L / 2 - 2), 22, 0, 3, 44, D, shadeHex(oak, -0.1), null, WOOD);
    B.add('std', T.cyl(10, 1, false), [s * (L / 2 - 2), 44, 2], [6, 3, 6], [0, 0, HALF], shadeHex(oak, -0.1), { ...WOOD, map: 'cyl' });
  }
  B.box('std', 0, 5, -D / 2 - 5, L - 10, 3, 6, '#5a1a1a', null, FABRIC);
  B.box('std', 0, 34, D / 2 + 1.4, L - 12, 8, 3, oak, null, WOOD);
  if (P.lod >= 1) for (let x = -L / 2 + 14; x < L / 2 - 10; x += r.range(16, 30)) B.box('std', x, 37, D / 2 + 1.6, 6, 8, 2.4, r.pick(['#5a1a1a', '#1a2a4a', '#2a3a2a']), [0, 0, r.range(-0.2, 0.2)], FABRIC);
  if (r.chance(0.2)) B.add('std', T.box(), [r.range(-40, 40), 1.2, -D / 2 - 14], [10, 2.4, 7], [0, r.range(0, 6), 0], '#5a1a1a', FABRIC);
}

/** The altar: stone with a white cloth, candlesticks, the book. */
function altar(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 40, D, 1, '#d8d0bc', null, STONE);
  B.box('std', 0, 40.6, 0, L + 4, 1.2, D + 2, '#f4f0e6', null, FABRIC);
  B.box('std', 0, 30, D / 2 + 1.4, L * 0.8, 20, 0.6, '#f4f0e6', null, FABRIC);
  B.box('std', 0, 30, D / 2 + 1.8, 20, 16, 0.4, '#c8a040', null, S(0, 0.3, 0.8));
  for (const x of [-L / 2 + 14, L / 2 - 14]) { B.cyl('std', x, 41, 0, 2, 16, '#c8a040', 10, 0.6, null, S(0, 0.3, 0.8)); candle(P, x, 57, 0, 10); }
  B.box('std', 10, 42, 6, 16, 3, 12, '#5a1a1a', [0, 0.2, 0], FABRIC);
}

/** The nave round the pews: the chancel step and rail, the crucifix, the pulpit, the hymn board, the red runner,
 *  the hanging lamps, the shelter's cots along the aisles, the font by the doors, the damage. */
function naveProps(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h, r = B.rng;
  const zc = -h / 2 + 150;           // the chancel's edge
  B.box('std', 0, 3, -h / 2 + 76, w - 20, 6, 150, '#8a6440', null, WOOD);
  B.box('std', 0, 5.8, -h / 2 + 76, w - 30, 0.8, 140, '#5a1a1a', null, FABRIC);
  // the altar rail with its gate open
  for (let x = -w / 2 + 20; x < w / 2 - 20; x += 12) if (Math.abs(x) > 34) B.box('std', x, 20, zc, 2.4, 28, 2.4, '#c8b89a', null, WOOD);
  for (const s of [-1, 1]) B.box('std', s * (w / 4 + 12), 34, zc, w / 2 - 70, 3, 6, '#6a4428', null, WOOD);
  // the crucifix on the north wall, the pulpit, the hymn board, candle stands
  B.box('std', 0, 120, -h / 2 + 10, 4, 60, 3, '#4a2e1a', null, WOOD);
  B.box('std', 0, 132, -h / 2 + 10, 30, 4, 3, '#4a2e1a', null, WOOD);
  B.add('std', T.pillow(8, 6, 0.4), [0, 124, -h / 2 + 12.5], [3, 16, 2], null, '#d8c8a8', S(0, 0.5, 0));
  B.cyl('std', -w / 2 + 70, 6, zc - 30, 12, 40, '#6a4428', 10, 1.1, null, WOOD);
  B.cyl('std', -w / 2 + 70, 46, zc - 30, 14, 3, '#5a3a22', 12, 1, null, WOOD);
  sign(B, 'hc_hymns', w / 2 - 30, 90, -h / 2 + 9.6, 26, 39, 0);
  for (const x of [-60, 60]) { B.cyl('std', x, 6, -h / 2 + 50, 1.4, 44, '#c8a040', 8, 1, null, S(0, 0.3, 0.8)); candle(P, x, 50, -h / 2 + 50, 8); }
  // the runner up the centre aisle, the lamps on chains
  B.box('std', 0, 0.9, 60, 36, 0.8, h - 250, '#6a1a1a', null, FABRIC);
  for (let z = -h / 2 + 230; z < h / 2 - 60; z += 200) {
    rod(B, 'std', [0, 160, z], [0, 128, z], 0.4, '#1a1a1a', METAL, 3);
    B.add('std', T.cyl(8, 0.7), [0, 122, z], [10, 12, 10], null, '#2a2420', METAL);
    if (!P.day) {
      B.add('glow', T.sphere(8, 6), [0, 118, z], [5, 4, 5], null, '#ffc070', { emissive: 2.4, uv: atlasUV('white'), noAO: true, noJitter: true });
      const [wx, wy] = toWorld(o, 0, z);
      halos.push({ x: wx, y: wy, h: 118, color: '#ffc070', size: 60, strength: 0.45 });
    }
  }
  // the shelter: cots in the side aisles, blankets, water, a table of supplies at the back
  for (const s of [-1, 1]) {
    for (let z = -h / 2 + 250; z < h / 2 - 120; z += 70) {
      if (r.chance(0.15)) continue;
      const x = s * (w / 2 - 36);
      const a = r.range(-0.06, 0.06);
      B.box('std', x, 12, z, 24, 1.6, 60, '#4a5a3a', [0, a, 0], FABRIC);
      for (const dz of [-26, 26]) for (const dx of [-10, 10]) B.box('std', x + dx, 6, z + dz, 1.2, 12, 1.2, '#6a6e72', null, METAL);
      if (r.chance(0.7)) B.add('std', T.pillow(8, 6, 0.4), [x, 15, z + r.range(-10, 10)], [11, 3, 22], [0, r.range(-0.4, 0.4), 0], r.pick(['#8a2a2a', '#2a4a7a', '#6a6a5a', '#8a7a4a']), FABRIC);
      if (r.chance(0.3)) floorDecal(B, 'blood3', x, z, 40, 34, r.range(0, 6), 0.62);
    }
  }
  B.box('std', -w / 2 + 60, 26, h / 2 - 60, 60, 2, 30, '#c8b89a', null, WOOD);
  for (const [dx, dz] of [[-26, -12], [26, -12], [-26, 12], [26, 12]]) B.box('std', -w / 2 + 60 + dx, 13, h / 2 - 60 + dz, 2, 26, 2, '#6a4428', null, WOOD);
  for (let k = 0; k < 12; k++) B.cyl('std', -w / 2 + 40 + (k % 6) * 7, 27, h / 2 - 66 + Math.floor(k / 6) * 10, 2.4, 9, '#c8e0f0', 8, 1, null, GLASS);
  // the font by the doors
  B.cyl('std', w / 2 - 70, 0, h / 2 - 70, 7, 30, '#d8d0bc', 10, 1, null, STONE);
  B.add('std', T.lathe('hcfont', [[6, 0], [16, 6], [18, 12], [16, 13], [6, 8]], 14), [w / 2 - 70, 30, h / 2 - 70], [1, 1, 1], null, '#d8d0bc', STONE);
  litter(B, -w / 2 + 30, -h / 2 + 170, w / 2 - 30, h / 2 - 30, P.lod >= 1 ? 26 : 8, 0.6, { cans: false });
  floorDecal(B, 'blood1', 20, zc + 30, 70, 70, 0.6, 7);
  decal(B, 'blood2', w / 2 - 8.6, 50, 120, 40, 50, -HALF);
}

/** The bell up in the tower and its rope, the ladder to the belfry. */
function bell(P) {
  const { B } = P;
  B.add('std', T.lathe('hcbell', [[3, 30], [8, 28], [11, 16], [14, 4], [18, 0], [16, 0], [12, 4], [9, 16], [6, 26], [0, 27]], 16), [0, 186, 0], [1, 1, 1], null, '#8a6a2a', S(0, 0.35, 0.85));
  B.box('std', 0, 222, 0, 70, 6, 6, '#4a3424', null, WOOD);
  for (const s of [-1, 1]) B.box('std', s * 34, 196, 0, 5, 56, 5, '#4a3424', null, WOOD);
  rod(B, 'std', [4, 188, 0], [10, 20, 4], 0.7, '#c8b89a', FABRIC, 4);
  B.add('std', T.cyl(8), [10, 18, 4], [1.6, 6, 1.6], null, '#c8b89a', { ...FABRIC, map: 'cyl' });
  for (let y = 6; y < 172; y += 10) B.box('std', -60, y, -60, 14, 1.4, 1.4, '#6a4a30', [0, PI / 4, 0], WOOD);
  for (const s of [-1, 1]) rod(B, 'std', [-60 + s * 5, 0, -60 - s * 5], [-60 + s * 5, 176, -60 - s * 5], 1.2, '#6a4a30', WOOD, 4);
}

/** The church's roadside board on a brick base (facing local +z). */
function churchsign(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 110, 26, 22, 1, '#8a4a3a', null, { noJitter: true, surf: [DET.brick, 0.9, 0] });
  for (const s of [-1, 1]) B.rblock('std', s * 50, 26, 0, 12, 76, 16, 1, '#8a4a3a', null, { noJitter: true, surf: [DET.brick, 0.9, 0] });
  B.box('std', 0, 64, 0, 88, 66, 8, '#4a3424', null, WOOD);
  sign(B, 'hc_stanne', 0, 64, 4.2, 84, 63, 0);
  B.box('vglass', 0, 60, 4.6, 80, 44, 0.4, '#b0c0c8', null, GLASS);
  B.rblock('std', 0, 102, 0, 120, 6, 24, 1, '#5a3a2a', null, WOOD);
}

/** The mausoleum: a small stone temple with a pediment, two columns, an iron door ajar. */
function mausoleum(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  B.rblock('std', 0, 0, 0, L + 10, 8, W + 10, 1, '#8a8478', null, STONE);
  B.rblock('std', 0, 8, -6, L, 110, W - 12, 1, '#b8b0a0', null, STONE);
  for (const s of [-1, 1]) {
    B.cyl('std', s * (L / 2 - 18), 8, W / 2 - 8, 7, 106, '#c8c0b0', 12, 1, null, STONE);
    B.add('std', T.box(), [0, 136, 0], [L + 6, 4, W / 2 + 18], [s * 0.42, HALF - HALF, 0], '#8a8478', STONE);
  }
  B.box('std', 0, 118, 0, L + 8, 12, W + 4, '#c8c0b0', null, STONE);
  B.add('std', T.box(), [0, 138, W / 4 - 6], [L + 4, 3.4, W / 2 + 20], [0.45, 0, 0], '#6a6a66', STONE);
  B.add('std', T.box(), [0, 138, -W / 4 + 6], [L + 4, 3.4, W / 2 + 20], [-0.45, 0, 0], '#6a6a66', STONE);
  B.box('std', 0, 44, W / 2 - 17.4, 40, 70, 1, '#0c0c0e', null, NJ);
  B.add('std', T.box(), [-28, 44, W / 2 - 4], [36, 68, 2], [0, 1.0, 0], '#2a3a34', S(DET.panel, 0.5, 0.7));
  B.box('std', 0, 100, W / 2 - 16, 70, 10, 2, '#8a8478', null, STONE);
}

// ---- St. Anne's roofs --------------------------------------------------------------------------------------------

/** The nave's steep slate roof along its length, stone gables (the rose window south), trusses and boards inside. */
function naveRoof(P) {
  const { B, o } = P;
  const w = o.w, h = o.h;
  const y0 = 170, pitch = 0.8;
  const half = w / 2 + 12;
  const rise = half * Math.tan(pitch);
  const slope = half / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const cx = s * half / 2, cy = y0 + rise / 2;
    B.add('std', T.box(), [cx, cy + 2.5, 0], [slope + 4, 5, h + 24], [0, 0, -s * pitch], '#4a4e58', { noJitter: true, surf: [DET.shingle, 0.8, 0.1] });
    B.add('std', T.box(), [cx * 0.98, cy - 1.6, 0], [slope - 6, 2, h - 8], [0, 0, -s * pitch], '#5a3a24', { noJitter: true, ...WOOD });
  }
  B.box('std', 0, y0 + rise + 4, 0, 8, 6, h + 26, '#3a3e46', null, METAL);
  // the gables: stone triangles at both ends, the rose window in the south one, a cross on the apex
  for (const s of [-1, 1]) {
    const z = s * (h / 2 - 8);
    B.prism('std', 'hcgable' + Math.round(w), [[-w / 2 - 8, y0], [w / 2 + 8, y0], [0, y0 + rise + 8]], z - 8, 16, '#b3a893', { noJitter: true, surf: [DET.rock, 0.92, 0] });
    if (s > 0) {
      B.add('lvsign', T.plane(), [0, y0 + rise * 0.42, z + 8.6], [90, 90, 1], null, P.day ? '#7a7a88' : '#2a2a34', { uv: lvUV('hc_rose'), noAO: true, noJitter: true });
      B.add('lvglow', T.plane(), [0, y0 + rise * 0.42, z - 8.6], [90, 90, 1], [0, PI, 0], P.day ? '#fff4e8' : '#3a3c50', { uv: lvUV('hc_rose'), noAO: true, noJitter: true });
      B.add('std', T.torus(24, 0.08, 4), [0, y0 + rise * 0.42, z + 8.8], [47, 47, 47], null, '#9a9282', STONE);
    }
    B.box('std', 0, y0 + rise + 30, z, 4, 40, 4, '#c8b060', null, S(0, 0.3, 0.8));
    B.box('std', 0, y0 + rise + 38, z, 20, 4, 4, '#c8b060', null, S(0, 0.3, 0.8));
  }
  // the trusses inside: a tie beam, two rafters and a king post every bay
  if (P.lod >= 1) {
    for (let z = -h / 2 + 90; z < h / 2 - 60; z += 150) {
      B.box('std', 0, y0 - 6, z, w - 10, 7, 8, '#4a2e1a', null, WOOD);
      for (const s of [-1, 1]) plank(B, 'std', [s * (w / 2 - 6), y0 - 4, z], [0, y0 + rise - 10, z], 7, 8, '#4a2e1a', WOOD);
      B.box('std', 0, y0 + (rise - 10) / 2, z, 6, rise - 10, 7, '#4a2e1a', null, WOOD);
    }
  }
  // buttresses along the side walls
  for (const s of [-1, 1]) for (let z = -h / 2 + 90; z < h / 2 - 60; z += 150) {
    B.rblock('std', s * (w / 2 + 14), 0, z, 16, 120, 22, 1, '#a89e8a', null, STONE);
    B.add('std', T.box(), [s * (w / 2 + 11), 128, z], [10, 26, 22], [0, 0, s * 0.45], '#a89e8a', STONE);
  }
}

/** The bell tower above the nave: the shaft, the louvred belfry, the pinnacles, the slate spire and its cross. */
function steeple(P) {
  const { B, o } = P;
  const w = o.w - 16, y0 = 170, yb = 300, top = yb + 30;
  const stone = '#b3a893';
  const mo = { noJitter: true, surf: [DET.rock, 0.92, 0] };
  // the shaft above the walls, with belfry openings on each face (a louvre in each)
  for (let f = 0; f < 4; f++) {
    const ry = (f * PI) / 2;
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (x, z) => [x * c + z * s, -x * s + z * c];
    const d = w / 2;
    const face = (x, y, z, sx, sy, sz) => { const [px, pz] = at(x, z); B.add('std', T.box(), [px, y, pz], [sx, sy, sz], [0, ry, 0], stone, mo); };
    face(0, (y0 + 230) / 2, d - 8, w + 16, 230 - y0, 16);
    face(-w / 2 + 16, (230 + yb) / 2, d - 8, 32, yb - 230, 16);
    face(w / 2 - 16, (230 + yb) / 2, d - 8, 32, yb - 230, 16);
    face(0, (yb + top) / 2, d - 8, w + 16, top - yb, 16);
    for (let k = 0; k < 6; k++) { const [px, pz] = at(0, d - 8); B.add('std', T.box(), [px, 238 + k * 10, pz], [w - 64, 1.4, 12], [0.5, ry, 0], '#5a4a3a', WOOD); }
    const [cx, cz] = at(0, d + 1);
    B.add('std', T.box(), [cx, top + 2, cz], [w + 20, 4, 6], [0, ry, 0], '#a89e8a', mo);
  }
  // the belfry floor seen from below (the tower's ceiling)
  B.box('std', 0, y0 + 2, 0, w, 4, w, '#4a3424', null, WOOD);
  // pinnacles at the corners, the spire, the cross
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.add('std', T.cyl(4, 0), [x * (w / 2 + 2), top + 24, z * (w / 2 + 2)], [8, 44, 8], [0, PI / 4, 0], stone, mo);
  B.add('std', T.cyl(8, 0.02), [0, top + 120, 0], [w / 2 + 4, 240, w / 2 + 4], [0, PI / 8, 0], '#4a4e58', { noJitter: true, surf: [DET.shingle, 0.8, 0.1], map: 'cyl' });
  B.box('std', 0, top + 262, 0, 3, 44, 3, '#c8b060', null, S(0, 0.3, 0.8));
  B.box('std', 0, top + 270, 0, 22, 3, 3, '#c8b060', null, S(0, 0.3, 0.8));
}

export const CHURCH_MODELS = {
  'hc-pharmsign': pharmsign, 'hc-wallshelf': wallshelf, 'hc-gondola': gondola, 'hc-pcounter': pcounter, 'hc-bins': bins, 'hc-till': till,
  'hc-rack': rack, 'hc-drugsafe': drugsafe, 'hc-pallet': pallet, 'hc-pstuff': pstuff, 'hc-stock': stock, 'hc-bank': bank, 'hc-laundromat': laundromat,
  'hc-gateposts': gateposts, 'hc-pew': pew, 'hc-altar': altar, 'hc-nave': naveProps, 'hc-bell': bell, 'hc-churchsign': churchsign, 'hc-mausoleum': mausoleum,
};
export const CHURCH_GATES = { 'hc-grille': grille, 'hc-irongate': irongate };
export const CHURCH_ROOFS = { 'hc-nave': naveRoof, 'hc-steeple': steeple };
void [mixHex, sign2, glowBox, CONC];
