// Fort Harlan's fences, gates, towers and furniture: the chain-link fence lines with razor wire, the
// gates' models (the engine animates them), the guard tower and the searchlight and floodlight towers, the
// signs, the parade ground's flag and tents, and the small obstacle models of the rooms (bunks, sinks,
// gun racks, the serving line, cots, consoles...), each drawn by `o.style` in the obstacle's own frame
// (local x along o.w, z along o.h, y up from the ground).

import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, WOOD, COL, at, pic, postSign, rod, lampGlow, shadeHex, mixHex, hash01, toWorld,
} from './dam-kit.js';
import { furniture } from './dam-rooms.js';
import { yardProp } from './railyard-build.js';

const HALF = Math.PI / 2;
const FABRIC = S(DET.fabric, 0.92, 0);
const CANVAS = S(DET.fabric, 0.95, 0);
const STAINLESS = S(DET.panel, 0.3, 0.85);
const OD = '#4b5320';

// ---- fences ------------------------------------------------------------------------------------------------------

/** Chain link both ways on a rect (local), with the world-repeat the chain texture wants. */
function chain(B, x, y, z, L, H, ry = 0) {
  B.add('fence', T.plane(), [x, y, z], [L, H, 1], [0, ry, 0], '#9aa0a4', { uvScale: [L / 26, H / 26] });
  B.add('fence', T.plane(), [x, y, z], [L, H, 1], [0, ry + Math.PI, 0], '#9aa0a4', { uvScale: [L / 26, H / 26] });
}

/** Concertina wire along local x at height y: a mesh tube (chain texture) with a few hoops. */
function concertina(B, x0, x1, y, z, r = 9) {
  const L = x1 - x0;
  B.add('fence', T.cyl(8, 1, true), [(x0 + x1) / 2, y, z], [r, L, r], [0, 0, HALF], '#b0b4b8', { uvScale: [3, L / 18] });
  for (let x = x0 + 12; x < x1; x += 30) B.add('std', T.torus(10, 0.05, 3), [x, y, z], [r, r, r], [0, HALF, 0], '#8a8e92', STEEL);
}

/**
 * A fence piece (style 'perimfence'): chain link 120 high on steel posts every 100 with Y-arms, barbed
 * wire and a coil of razor wire on top; the taxiway's gate chained shut (style 'taxigate').
 */
export function fencePiece(P, o) {
  const { B, tier } = P;
  const along = o.w >= o.h, L = along ? o.w : o.h;
  B.obj(o.x, o.y, (o.a || 0) + (along ? 0 : HALF), o.id * 31);
  const H = 120;
  if (o.style === 'taxigate') {
    // a rolling gate shut and chained, an X on it, a jersey barrier and the wreck behind (layout)
    for (const e of [-1, 1]) B.box('std', e * (L / 2 - 4), H / 2 + 5, 0, 8, H + 10, 8, '#5a5e62', null, STEEL);
    for (const y of [10, H / 2, H]) B.box('std', 0, y, 0, L, 5, 5, '#6a6e72', null, STEEL);
    chain(B, 0, H / 2 + 5, 0, L - 8, H - 10);
    rod(B, 'std', [-L / 2, 12, 0], [L / 2, H - 4, 0], 2, '#6a6e72', STEEL, 5);
    rod(B, 'std', [-L / 2, H - 4, 0], [L / 2, 12, 0], 2, '#6a6e72', STEEL, 5);
    B.box('std', -6, 64, 3, 10, 14, 2, '#8a7a3a', null, STEEL);
    pic(B, 'chevron', 0, 40, -4, 10, Math.PI, { w: L - 20 });
    pic(B, 'taxi', 0, 90, 4, 18, 0);
    if (tier !== 'low') concertina(B, -L / 2, L / 2, H + 10, 0);
    return true;
  }
  const step = 100;
  const n = Math.max(1, Math.round(L / step));
  for (let k = 0; k <= n; k++) {
    const x = -L / 2 + (L * k) / n;
    B.cyl('std', x, 0, 0, 2.4, H + 4, '#7a7e82', 6, 1, null, STEEL);
    rod(B, 'std', [x, H + 2, 0], [x, H + 22, -12], 1.2, '#7a7e82', STEEL, 4);
    rod(B, 'std', [x, H + 2, 0], [x, H + 22, 12], 1.2, '#7a7e82', STEEL, 4);
    if (k % 4 === 0) B.block('std', x, 0, 0, 12, 6, 12, COL.concD, null, CONC);
  }
  chain(B, 0, H / 2 + 2, 0, L, H - 4);
  rod(B, 'std', [-L / 2, H, 0], [L / 2, H, 0], 1, '#7a7e82', STEEL, 4);
  for (const [y, z] of [[H + 9, -5], [H + 15, -9], [H + 21, -12], [H + 9, 5], [H + 15, 9], [H + 21, 12]]) rod(B, 'std', [-L / 2, y, z], [L / 2, y, z], 0.3, '#4a4a4a', STEEL, 3);
  if (tier !== 'low') concertina(B, -L / 2, L / 2, H + 18, 0, 8);
  // warning signs every few posts
  for (let x = -L / 2 + 250; x < L / 2 - 100; x += 700) pic(B, hash01(o.id + x) < 0.5 ? 'restricted' : 'usarmy', x, 70, 1.2, hash01(o.id + x) < 0.5 ? 26 : 10, 0, { w: hash01(o.id + x) < 0.5 ? 52 : 54 });
  return true;
}

// ---- the gates' models ---------------------------------------------------------------------------------------------

/** A gate piece's model by style (also art.gateModel; the engine animates it). */
export function gatePiece(P, o) {
  const { B, tier } = P;
  const along = o.w >= o.h, L = along ? o.w : o.h, t = along ? o.h : o.w;
  B.obj(o.x, o.y, (o.a || 0) + (along ? 0 : HALF), o.id * 31);
  switch (o.style) {
    case 'basegate': {
      // a heavy sliding gate: a welded tube frame with palisade bars, razor wire on top, the base's plate
      const H = 130;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 4), H / 2 + 6, 0, 8, H, 8, '#3e4438', null, PAINTED);
      for (const y of [12, H * 0.5, H]) B.box('std', 0, y + 2, 0, L, 7, 7, '#3e4438', null, PAINTED);
      for (let x = -L / 2 + 10; x < L / 2 - 6; x += 9) {
        B.box('std', x, H / 2 + 6, 0, 2.6, H - 6, 2.6, '#454b3e', null, PAINTED);
        B.add('std', T.cyl(4, 0), [x, H + 12, 0], [3, 10, 3], null, '#454b3e', PAINTED);
      }
      rod(B, 'std', [-L / 2 + 6, 16, 0], [L / 2 - 6, H - 4, 0], 2.2, '#3e4438', PAINTED, 5);
      for (let x = -L / 2 + 30; x < L / 2; x += L / 3) B.cylZ('std', x, 5, 0, 5, 5, '#2a2a2a', 10, STEEL);
      if (tier !== 'low') concertina(B, -L / 2, L / 2, H + 22, 0, 8);
      pic(B, 'restricted', 0, 70, -t / 2 - 2, 34, Math.PI, { w: 68 });
      pic(B, 'd_graf2', -50, 50, t / 2 + 2, 18, 0, { w: 70 });
      return true;
    }
    case 'flightfence': {
      // a chain-link panel in a tube frame, the flight line's sign, red flags tied on
      const H = 120;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 3), H / 2, 0, 5, H, 5, '#8a8e92', null, STEEL);
      for (const y of [4, H]) B.box('std', 0, y, 0, L, 4, 4, '#8a8e92', null, STEEL);
      chain(B, 0, H / 2, 0, L - 6, H - 4);
      for (const [y, z] of [[H + 8, -4], [H + 14, -7]]) rod(B, 'std', [-L / 2, y, z], [L / 2, y, z], 0.3, '#4a4a4a', STEEL, 3);
      pic(B, 'taxi', 0, 72, -2, 20, Math.PI, { w: 80 });
      pic(B, 'restricted', 0, 70, 2, 30, 0, { w: 60 });
      for (const x of [-60, 20, 70]) B.add('std', T.plane(), [x, 100 - (x % 3), 1.5], [8, 6, 1], [0, 0, 0.3], '#c8261c', FABRIC);
      return true;
    }
    case 'towerdoor': {
      // a steel door painted the tower's grey-green, a wired glass light, a push plate, a bloody print
      const H = 112;
      B.box('std', 0, H + 6, 0, L + 10, 12, t + 4, '#3a3e40', null, STEEL);
      B.box('std', 0, H / 2, 0, L - 4, H, 5, '#4e5e5a', null, PAINTED);
      B.box('vglass', L * 0.2, 80, 3, 18, 30, 0.5, '#2a3a40');
      B.box('vglass', L * 0.2, 80, -3, 18, 30, 0.5, '#2a3a40');
      B.box('std', -L * 0.32, 56, 3.2, 4, 20, 2, '#8a8e92', null, STEEL);
      pic(B, 'd_hand', -L * 0.2, 66, -2.8, 14, Math.PI);
      pic(B, 'd_blood2', 0, 40, -2.8, 40, Math.PI);
      return true;
    }
    case 'runwaygate': {
      // the airfield's crash gate: a yellow tube frame with chain link, black hazard bands, razor wire
      const H = 120;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 4), H / 2 + 4, 0, 7, H, 7, '#c8a020', null, PAINTED);
      for (const y of [10, H * 0.5, H]) B.box('std', 0, y, 0, L, 6, 6, '#c8a020', null, PAINTED);
      chain(B, 0, H / 2 + 4, 0, L - 8, H - 8);
      rod(B, 'std', [-L / 2 + 4, 12, 0], [L / 2 - 4, H - 2, 0], 2, '#c8a020', PAINTED, 5);
      for (let x = -L / 2 + 30; x < L / 2; x += L / 3) B.cylZ('std', x, 5, 0, 5, 5, '#2a2a2a', 10, STEEL);
      pic(B, 'hazard', 0, H, 3.2, 6, 0, { w: L });
      pic(B, 'hazard', 0, H, -3.2, 6, Math.PI, { w: L });
      pic(B, 'hold', 0, 70, -2, 18, Math.PI);
      if (tier !== 'low') concertina(B, -L / 2, L / 2, H + 14, 0, 8);
      return true;
    }
    default: return false;
  }
}

// ---- towers ----------------------------------------------------------------------------------------------------------

/** Four splayed legs braced every `step` from 0 to h, half-spread a at the foot and b at the top. */
function legs(B, a, b, h, step, col, r = 1.8) {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of c) rod(B, 'std', [sx * a, 0, sz * a], [sx * b, h, sz * b], r, col, STEEL, 5);
  for (let y = step; y < h - 4; y += step) {
    const k0 = a + (b - a) * ((y - step) / h), k1 = a + (b - a) * (y / h);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4];
      rod(B, 'std', [ax * k0, y - step, az * k0], [bx * k1, y, bz * k1], r * 0.4, col, STEEL, 3);
      rod(B, 'std', [ax * k1, y, az * k1], [bx * k1, y, bz * k1], r * 0.45, col, STEEL, 3);
    }
  }
  for (const [sx, sz] of c) B.block('std', sx * a, 0, sz * a, 12, 8, 12, COL.concD, null, CONC);
}

/** A searchlight drum on a yoke at (x, y, z) pointing along ry (about y) and down by `tilt`. */
function searchlight(B, halos, x, y, z, ry, tilt, wx, wy, day) {
  B.box('std', x, y - 8, z, 14, 3, 14, '#2a2c2e', null, STEEL);
  for (const s of [-1, 1]) B.box('std', x + Math.sin(ry) * s * 9, y, z + Math.cos(ry) * s * 9, 2, 14, 2, '#2a2c2e', [0, ry, 0], STEEL);
  B.add('std', T.cyl(14, 1), [x, y + 2, z], [9, 22, 9], [HALF - tilt, ry + HALF, 0], '#3a3e3a', STEEL);
  const lx = x + Math.cos(-ry) * 11, lz = z + Math.sin(-ry) * 11;
  lampGlow(B, halos, lx, y + 2 - Math.sin(tilt) * 11, lz, wx, wy, '#f2f6ff', { size: [8, 8, 8], k: day ? 0.5 : 6, halo: day ? 0 : 150, strength: 0.8, y0: 0, shape: 'sphere' });
}

/** The guard tower at the outer checkpoint, the searchlight towers at the gate, the floodlight towers. */
export function lightTower(P, o) {
  const { B, halos, day } = P;
  if (o.style === 'guardtower') {
    // steel legs, a cab with windows all round under a hipped tin roof, a searchlight, a ladder
    const H = 240;
    legs(B, 34, 26, H, 60, '#4a4e44', 2.4);
    B.block('std', 0, H, 0, 80, 4, 80, '#4a4e44', null, STEEL);
    for (const s of [-1, 1]) {
      B.block('std', 0, H + 4, s * 38, 80, 34, 4, '#5a6048', null, WOOD);
      B.block('std', s * 38, H + 4, 0, 4, 34, 72, '#5a6048', null, WOOD);
      B.block('std', 0, H + 38, s * 38, 80, 6, 4, '#4a4e44', null, WOOD);
    }
    for (const [x, z] of [[-38, -38], [38, -38], [38, 38], [-38, 38]]) B.block('std', x, H + 4, z, 5, 70, 5, '#4a4e44', null, STEEL);
    B.block('std', 0, H + 74, 0, 96, 4, 96, '#3a3e34', null, S(DET.metalroof, 0.6, 0.4));
    B.add('std', T.cyl(4, 0.05), [0, H + 86, 0], [68, 22, 68], [0, Math.PI / 4, 0], '#3a3e34', S(DET.metalroof, 0.6, 0.4));
    for (let y = 8; y < H; y += 12) B.box('std', 30, y, -40, 22, 1.4, 1.4, '#3a3e34', null, STEEL);
    for (const s of [-1, 1]) rod(B, 'std', [30 + s * 11, 0, -40], [30 + s * 11, H, -40], 0.8, '#3a3e34', STEEL, 4);
    for (let k = 0; k < 6; k++) B.rblock('std', -28 + (k % 3) * 28, H + 4, (k < 3 ? -1 : 1) * 32, 26, 10, 12, 4, '#8a7a55', null, CANVAS);
    searchlight(B, halos, 0, H + 96, 0, 0.6, 0.35, o.x, o.y, day);
    pic(B, 'usarmy', 0, H + 20, 40.3, 6, 0, { w: 40 });
    return true;
  }
  if (o.style === 'searchtower') {
    // a lattice mast with a railed platform and a big searchlight (its beam is the fx's)
    const H = 300;
    legs(B, 20, 9, H, 40, '#6a6e72', 1.6);
    B.block('std', 0, H, 0, 50, 3, 50, '#4a4e52', null, STEEL);
    for (const s of [-1, 1]) {
      rod(B, 'std', [-25, H + 24, s * 25], [25, H + 24, s * 25], 0.8, COL.yellow, PAINTED, 4);
      rod(B, 'std', [s * 25, H + 24, -25], [s * 25, H + 24, 25], 0.8, COL.yellow, PAINTED, 4);
    }
    for (const [x, z] of [[-25, -25], [25, -25], [25, 25], [-25, 25]]) B.cyl('std', x, H, z, 0.8, 24, COL.yellow, 4, 1, null, PAINTED);
    searchlight(B, halos, 0, H + 16, 0, Number(o.label) ? -0.6 : 0.6, 0.4, o.x, o.y, day);
    lampGlow(B, halos, 0, H + 40, 0, o.x, o.y, '#ff3a2a', { size: [3, 3, 3], k: 6, halo: 70, strength: 0.6, blink: 1, y0: 0, shape: 'sphere' });
    rod(B, 'std', [0, H, 0], [0, H + 38, 0], 0.6, '#2a2a2a', STEEL, 3);
    return true;
  }
  // a floodlight tower: a tapering pole, a ladder cage, a head of six cool-white floods
  const H = 400;
  B.cyl('std', 0, 0, 0, 9, H, '#8a8e92', 10, 0.45, null, S(DET.panel, 0.4, 0.7));
  B.block('std', 0, 0, 0, 34, 10, 34, COL.concD, null, CONC);
  for (let y = 40; y < H - 30; y += 50) B.add('std', T.torus(8, 0.04, 3), [12, y, 0], [8, 8, 8], [HALF, 0, 0], '#7a7e82', STEEL);
  B.box('std', 0, H, 0, 70, 4, 20, '#4a4e52', null, STEEL);
  for (let k = 0; k < 6; k++) {
    const x = -27 + (k % 3) * 27, z = k < 3 ? -7 : 7;
    B.rbox('std', x, H + 12, z, 20, 16, 8, 1.5, '#3a3c3e', [z < 0 ? -0.5 : 0.5, 0, 0], STEEL);
    lampGlow(B, k === 0 ? halos : null, x, H + 10, z + (z < 0 ? -4.6 : 4.6), o.x, o.y, '#eef4ff', { size: [16, 12, 1], k: day ? 0.5 : 5, halo: 200, strength: 0.85, y0: 0, rot: [z < 0 ? -0.5 : 0.5, 0, 0] });
  }
  if (!day && P.shafts) P.shafts.push({ x: o.x, y: o.y, h: H + 6, base: 0, abs: true, color: '#dfe8ff', radius: 230, strength: 0.55 });
  return true;
}

// ---- signs -------------------------------------------------------------------------------------------------------------

function signs(P, o) {
  const { B, halos, day } = P;
  switch (o.style) {
    case 'signrestricted': postSign(B, 'restricted', 0, 0, 44, 30, Math.PI, { posts: 2 }); return true;
    case 'signbase': {
      // a low stone wall with the base's name in cast letters, the unit crest, two spotlights
      B.rblock('std', 0, 0, 0, o.w, 40, o.h, 2, '#8a8478', null, S(DET.rock, 0.9, 0));
      B.rblock('std', 0, 40, 0, o.w - 20, 46, o.h - 8, 2, '#a8a294', null, CONC);
      B.rblock('std', 0, 86, 0, o.w - 14, 5, o.h - 4, 1, '#7a7468', null, CONC);
      pic(B, 'basename', 10, 63, o.h / 2 - 3.6, 30, 0, { w: o.w - 70 });
      pic(B, 'insignia', -o.w / 2 + 28, 63, o.h / 2 - 3.6, 38, 0);
      for (const x of [-60, 60]) {
        B.rblock('std', x, 0, o.h / 2 + 30, 10, 8, 8, 2, '#2a2c2e', [-0.5, 0, 0], STEEL);
        lampGlow(B, halos, x, 6, o.h / 2 + 25, o.x + x, o.y + o.h / 2 + 25, '#fff0d8', { size: [6, 4, 1], k: day ? 0 : 3, halo: day ? 0 : 50, strength: 0.4, y0: 0, rot: [-0.5, 0, 0] });
      }
      return true;
    }
    case 'signquarantine': {
      // a banner strung between two posts over the way into the tents
      for (const e of [-1, 1]) B.cyl('std', e * (o.w / 2 - 4), 0, 0, 2.4, 110, '#6a6e72', 8, 1, null, STEEL);
      B.add('std', T.plane(), [0, 86, 0.5], [o.w - 12, 30, 1], null, '#ffffff', FABRIC);
      pic(B, 'quarantine', 0, 86, 1.2, 30, 0, { w: o.w - 14 });
      pic(B, 'quarantine', 0, 86, -0.2, 30, Math.PI, { w: o.w - 14 });
      return true;
    }
    default: return false;
  }
}

// ---- furniture and yard props -------------------------------------------------------------------------------------------

function bunk(B, o) {
  const L = o.h, W = o.w;   // (the layout stands bunks along y: local z is their length)
  for (const [x, z] of [[-W / 2 + 2, -L / 2 + 2], [W / 2 - 2, -L / 2 + 2], [W / 2 - 2, L / 2 - 2], [-W / 2 + 2, L / 2 - 2]]) B.box('std', x, 50, z, 3, 100, 3, '#4a5a4a', null, STEEL);
  for (const y of [20, 70]) {
    B.box('std', 0, y, 0, W, 3, L, '#4a5a4a', null, STEEL);
    B.rblock('std', 0, y + 1.5, 0, W - 4, 6, L - 6, 2, '#6a7a5a', [0, (hash01(o.id + y) - 0.5) * 0.08, 0], FABRIC);
    B.rblock('std', 0, y + 7, -L / 2 + 10, W - 10, 5, 12, 2, '#d8d4c8', null, FABRIC);
    if (hash01(o.id * 3 + y) < 0.5) B.add('std', T.box(), [3, y + 8, 8], [W - 2, 2, L * 0.5], [0, 0.2, 0.06], '#3a4a3a', FABRIC);
  }
  for (let y = 26; y < 70; y += 12) B.box('std', W / 2 + 1, y, L / 2 - 6, 1.2, 1.2, 10, '#4a5a4a', null, STEEL);
  if (o.label === 'blood') pic(B, 'd_blood1', 0, 26.6, 4, 30, 0, { rx: -HALF });
}

function cot(B, o) {
  const L = o.h, W = o.w;
  for (const s of [-1, 1]) {
    B.box('std', s * (W / 2 - 3), 22, 0, 2, 2, L, '#5a5e4a', null, STEEL);
    for (const z of [-L / 2 + 4, L / 2 - 4]) rod(B, 'std', [s * (W / 2 - 3), 22, z], [-s * (W / 2 - 3), 0, z], 0.8, '#5a5e4a', STEEL, 3);
  }
  B.box('std', 0, 22, 0, W - 6, 1, L - 4, '#5a6040', null, CANVAS);
  if (o.label === 'bag') {
    B.add('std', T.pillow(10, 6, 0.4), [0, 29, 0], [W * 0.42, 6, L * 0.46], null, '#1e2224', S(DET.plastic, 0.35, 0));
    B.box('std', 0, 35, -L * 0.3, 1, 0.6, L * 0.5, '#8a8e92', null, STEEL);
    B.add('std', T.box(), [0, 36, L * 0.3], [8, 0.4, 5], [0, 0.4, 0], '#e8e2d0', S(0, 0.9, 0));
  } else {
    B.add('std', T.box(), [0, 24, 6], [W - 8, 2, L * 0.5], [0, 0.1, 0.04], '#6a7a8a', FABRIC);
    if (hash01(o.id) < 0.5) pic(B, 'd_blood2', 0, 23.4, -6, 22, 0, { rx: -HALF });
  }
}

function medTent(B, o) {
  // a GP-medium tent: low walls, a ridge roof over a frame, the door flaps rolled up, guy lines and pegs
  const L = o.w, W = o.h, wallH = 60, ridge = 120;
  const col = o.label === 'white' ? '#c8c4b8' : '#5a6340';
  const dark = shadeHex(col, -0.15);
  for (const s of [-1, 1]) {
    B.block('std', 0, 0, s * (W / 2 - 1), L, wallH, 2, col, null, CANVAS);
    const len = Math.hypot(W / 2, ridge - wallH);
    B.add('std', T.box(), [0, (wallH + ridge) / 2, s * W / 4], [L + 12, 2, len + 4], [s * Math.atan2(ridge - wallH, W / 2), 0, 0], dark, CANVAS);
  }
  for (const e of [-1, 1]) {
    B.add('std', T.profile('c3tentend' + Math.round(W), [[-W / 2, 0], [W / 2, 0], [W / 2, wallH], [0, ridge], [-W / 2, wallH]], 0, 1), [e * L / 2, 0, 0], [1, 1, 2], [0, HALF, 0], col, CANVAS);
    // the door: a dark opening and the flap rolled over it
    B.box('std', e * (L / 2 + 1.2), 42, 0, 1, 84, 40, '#14140f', null, CANVAS);
    B.cylZ('std', e * (L / 2 + 3), 88, 0, 4, 44, dark, 8, CANVAS);
    for (const s of [-1, 1]) {
      rod(B, 'std', [e * (L / 2 + 6), ridge - 6, 0], [e * (L / 2 + 50), 0, s * 30], 0.25, '#c8c0a8', S(0, 0.9, 0), 3);
      rod(B, 'std', [e * L / 3, wallH, s * W / 2], [e * L / 3, 0, s * (W / 2 + 40)], 0.25, '#c8c0a8', S(0, 0.9, 0), 3);
    }
  }
  if (o.label === 'red' || o.label === 'white') {
    // (lying on each slope: the normal leans out from the vertical by the slope's angle)
    const slope = Math.atan2(ridge - wallH, W / 2);
    for (const s of [-1, 1]) pic(B, 'firstaid', 0, (wallH + ridge) / 2 + 2, s * (W / 4 + 1), 30, s > 0 ? 0 : Math.PI, { rx: -(Math.PI / 2 - slope) * s });
  }
}

function flag(P, o) {
  const { B } = P;
  B.block('std', 0, 0, 0, 40, 6, 40, COL.concL, null, CONC);
  B.cyl('std', 0, 6, 0, 2.6, 300, '#d8d8d4', 10, 0.5, null, S(DET.panel, 0.3, 0.6));
  B.add('std', T.sphere(8, 6), [0, 307, 0], [4, 4, 4], null, '#c8a24a', STEEL);
  // the flag at half-staff: stripes and the canton on a gently waved strip
  const fy = 210, fw = 96, fh = 52;
  for (let k = 0; k < 7; k++) {
    for (let i = 0; i < 6; i++) {
      const x0 = 3 + (fw / 6) * i, wave = Math.sin(i * 0.9) * 4;
      B.box('std', x0 + fw / 12, fy - k * (fh / 7) - fh / 14, wave, fw / 6 + 0.3, fh / 7, 0.6, k % 2 ? '#e8e4dc' : '#a8241c', [0, Math.cos(i * 0.9) * 0.25, 0], FABRIC);
    }
  }
  B.box('std', 3 + fw * 0.2, fy - fh * 0.27, Math.sin(0.9) * 2, fw * 0.4, fh * 0.54, 0.8, '#1e2a5a', [0, 0.15, 0], FABRIC);
  rod(B, 'std', [2, 300, 0], [2, 6, 0], 0.2, '#e8e2d0', S(0, 0.9, 0), 3);
}

function pallets(B, o) {
  const L = o.w, W = o.h;
  const n = Math.max(1, Math.round(L / 90)), m = Math.max(1, Math.round(W / 90));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const x = -L / 2 + (i + 0.5) * (L / n), z = -W / 2 + (j + 0.5) * (W / m);
      const h = hash01(o.id * 7 + i * 3 + j);
      B.block('std', x, 0, z, L / n - 6, 8, W / m - 6, '#8a7458', null, WOOD);
      const rows = 1 + Math.floor(h * 3);
      for (let r = 0; r < rows; r++) B.rblock('std', x, 8 + r * 18, z, L / n - 14, 17, W / m - 14, 1, h < 0.5 ? '#9a8a64' : '#5a6040', [0, (hash01(r + i) - 0.5) * 0.08, 0], h < 0.5 ? S(0, 0.9, 0) : CANVAS);
      // the cargo net over the load
      B.add('fence', T.box(), [x, 8 + rows * 9, z], [L / n - 12, rows * 18 + 2, W / m - 12], null, '#3a3a2a', { uvScale: [2, 2] });
      if (h < 0.5) pic(B, 'usarmy', x, 8 + rows * 9, z + W / m / 2 - 6.8, 6, 0, { w: 30 });
    }
  }
}

function sinks(B, o) {
  const L = o.w;
  B.rblock('std', 0, 0, 0, L, 34, o.h, 1, '#d8d4c8', null, S(DET.tile, 0.5, 0));
  for (let x = -L / 2 + 25; x < L / 2; x += 50) {
    B.cyl('std', x, 30, -2, 10, 5, '#e8e8e4', 12, 1, null, S(0, 0.2, 0.1));
    B.cyl('std', x, 35, -11, 1, 8, '#9a9ea2', 6, 1, null, STAINLESS);
    B.box('glass', x, 66, o.h / 2 - 0.5 + 15, 36, 40, 0.5, '#7a8a90');
  }
  pic(B, 'd_blood2', 30, 66, o.h / 2 + 14.2, 30, Math.PI);
}

function stalls(B, o) {
  const L = o.h, W = o.w;
  for (let z = -L / 2; z <= L / 2 + 0.1; z += L / 2) B.box('std', 0, 50, z, W, 80, 1.6, '#7a8a8a', null, PAINTED);
  B.box('std', W / 2, 50, -L / 4, 1.6, 80, L / 2 - 8, '#7a8a8a', null, PAINTED);
  B.add('std', T.box(), [W / 2 + 14, 50, L / 4], [1.6, 80, L / 2 - 10], [0, 0.9, 0], '#7a8a8a', PAINTED);
  for (const z of [-L / 4, L / 4]) B.rblock('std', -W / 4, 0, z, 16, 20, 18, 4, '#e8e8e4', null, S(0, 0.2, 0.1));
}

function gunRack(B, o) {
  const L = o.w >= o.h ? o.w : o.h;
  if (o.w < o.h) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
  B.block('std', 0, 0, 0, L, 8, 20, '#3a4038', null, STEEL);
  B.block('std', 0, 60, -6, L, 4, 8, '#3a4038', null, STEEL);
  for (const e of [-1, 1]) B.block('std', e * (L / 2 - 2), 0, -6, 4, 90, 8, '#3a4038', null, STEEL);
  for (let x = -L / 2 + 8; x < L / 2 - 4; x += 9) {
    if (hash01(o.id * 5 + x) < 0.55) continue;   // signed out
    B.add('std', T.box(), [x, 44, 2], [2.6, 70, 4], [0.12, 0, 0], '#1e1e1c', STEEL);
    B.add('std', T.box(), [x, 14, 4], [3, 14, 7], [0.12, 0, 0], '#2a2a26', S(DET.plastic, 0.5, 0));
  }
  B.add('fence', T.plane(), [0, 50, 10.5], [L, 100, 1], null, '#6a6e72', { uvScale: [L / 14, 100 / 14] });
}

function servingLine(B, o) {
  const L = o.w;
  B.rblock('std', 0, 0, 0, L, 36, o.h, 1, '#a8acb0', null, STAINLESS);
  for (let x = -L / 2 + 30; x < L / 2 - 20; x += 46) {
    B.box('std', x, 36.2, 0, 40, 0.6, o.h - 8, '#5a5e62', null, STAINLESS);
    if (hash01(o.id + x) < 0.6) B.box('std', x, 34, 0, 36, 4, o.h - 12, ['#8a6a3a', '#c8b88a', '#6a7a3a'][Math.floor(hash01(x) * 3)], null, S(0, 0.6, 0));
  }
  // the sneeze guard and its lamps, a tray rail on the hall side
  for (const x of [-L / 2 + 4, 0, L / 2 - 4]) rod(B, 'std', [x, 36, 0], [x, 70, 0], 0.7, '#a8acb0', STAINLESS, 4);
  B.add('vglass', T.box(), [0, 66, 4], [L, 1, 20], [0.5, 0, 0], '#a8c0c8');
  B.box('std', 0, 30, o.h / 2 + 8, L, 2, 14, '#a8acb0', null, STAINLESS);
  for (let k = 0; k < 6; k++) B.box('std', -L / 2 + 40 + k * 8, 38 + k * 0.8, o.h / 2 + 8, 30, 0.8, 22, '#8a7a6a', [0, 0, 0.02], S(DET.plastic, 0.4, 0));
}

function messTable(B, o) {
  const L = o.w, W = o.h;
  B.rblock('std', 0, 28, 0, L, 3, W, 1, '#b8b0a0', null, S(DET.plastic, 0.4, 0));
  for (const x of [-L / 2 + 10, L / 2 - 10]) B.block('std', x, 0, 0, 4, 28, W - 10, '#5a5e62', null, STEEL);
  for (const s of [-1, 1]) {
    const fallen = hash01(o.id * 3 + s) < 0.25;
    if (fallen) B.add('std', T.box(), [0, 6, s * (W / 2 + 22)], [L - 10, 3, 12], [HALF - 0.1, 0, 0.05], '#7a6a52', WOOD);
    else B.block('std', 0, 16, s * (W / 2 + 12), L - 10, 3, 12, '#7a6a52', null, WOOD);
  }
  for (let x = -L / 2 + 20; x < L / 2; x += 34) if (hash01(o.id * 7 + x) < 0.5) {
    B.box('std', x, 31.6, (hash01(x) - 0.5) * 10, 20, 1.2, 14, '#8a7a6a', [0, hash01(x + 1) * 0.6, 0], S(DET.plastic, 0.4, 0));
    B.cyl('std', x + 12, 31, 8, 2, 6, '#d8d4c8', 8, 1.1, null, S(DET.plastic, 0.4, 0));
  }
}

function stoves(B, o) {
  const L = o.w;
  B.rblock('std', 0, 0, 0, L, 36, o.h, 1, '#8a8e92', null, STAINLESS);
  for (let x = -L / 2 + 30; x < L / 2; x += 60) {
    for (const dz of [-6, 6]) B.add('std', T.torus(10, 0.15, 4), [x + dz, 36.5, dz], [5, 5, 5], [HALF, 0, 0], '#1a1a1a', STEEL);
    B.box('std', x, 18, o.h / 2 + 0.3, 40, 20, 0.6, '#2a2c2e', null, STEEL);
  }
  B.add('std', T.box(), [0, 118, 0], [L, 30, o.h + 10], null, '#9a9ea2', STAINLESS);
  B.cyl('std', 0, 133, 0, 8, 30, '#8a8e92', 10, 1, null, STAINLESS);
  B.cyl('std', 60, 36, 0, 12, 20, '#9a9ea2', 12, 1, null, STAINLESS);
}

function consoles(P, o) {
  // the radio room's consoles under the east windows: a sloped desk with radar and radio screens
  const { B, halos } = P;
  const L = o.h;
  B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
  // (local x along the wall, local z: +z is west, the room side)
  B.rblock('std', 0, 0, 0, L, 30, o.w, 2, '#5a6262', null, PAINTED);
  B.add('std', T.box(), [0, 36, -2], [L - 4, 3, o.w - 6], [0.35, 0, 0], '#3e4646', PAINTED);
  for (let x = -L / 2 + 30; x < L / 2 - 10; x += 52) {
    const cell = ['e_scope', 'e_atc', 'e_strips', 'e_scope'][Math.floor(hash01(o.id + x) * 4)];
    B.rblock('std', x, 30, -8, 40, 30, 16, 2, '#2a2e2e', [-0.1, 0, 0], STEEL);
    pic(B, cell, x, 46, 0.4, 20, 0, { w: cell === 'e_scope' ? 20 : 26 });
    pic(B, 'e_lamps', x, 34.5, 6, 3, 0, { w: 34, rx: -1.2 });
  }
  const [wx, wy] = toWorld({ x: o.x, y: o.y, a: HALF }, 0, 10);
  lampGlow(B, halos, 0, 48, 4, wx, wy, '#7affb0', { size: [1, 1, 1], k: 0.1, halo: 140, strength: 0.4, y0: 120 });
}

/** Furniture and yard props by style. Returns true when drawn. */
export function prop(P, o) {
  const { B } = P;
  switch (o.style) {
    case 'bunk': bunk(B, o); return true;
    case 'cot': cot(B, o); return true;
    case 'medtent': medTent(B, o); return true;
    case 'flagpole': flag(P, o); return true;
    case 'pallets': pallets(B, o); return true;
    case 'sinks': sinks(B, o); return true;
    case 'stalls': stalls(B, o); return true;
    case 'gunrack': gunRack(B, o); return true;
    case 'servingline': servingLine(B, o); return true;
    case 'messtable': messTable(B, o); return true;
    case 'stoves': stoves(B, o); return true;
    case 'consoles': consoles(P, o); return true;
    case 'cage': {
      // the armory's issue cage: welded mesh floor to ceiling on steel posts, the door by the hatch open
      const along = o.w >= o.h, L = along ? o.w : o.h;
      if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
      const H = 130;
      for (let x = -L / 2; x <= L / 2 + 0.1; x += L / Math.max(1, Math.round(L / 60))) B.box('std', x, H / 2, 0, 4, H, 4, '#3a3e3a', null, STEEL);
      for (const y of [2, 60, H - 2]) B.box('std', 0, y, 0, L, 3, 3, '#3a3e3a', null, STEEL);
      B.add('fence', T.plane(), [0, H / 2, 0], [L, H - 4, 1], null, '#7a7e82', { uvScale: [L / 12, H / 12] });
      B.add('fence', T.plane(), [0, H / 2, 0], [L, H - 4, 1], [0, Math.PI, 0], '#7a7e82', { uvScale: [L / 12, H / 12] });
      if (o.x > 3900) B.add('std', T.box(), [-L / 2 - 30, H / 2 - 4, 26], [58, H - 10, 3], [0, -1.1, 0], '#3a3e3a', STEEL);
      pic(B, 'restricted', 0, 100, 2, 18, 0, { w: 36 });
      return true;
    }
    case 'lockers': {
      if (o.w < o.h) {
        B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
        return furniture(P, { ...o, w: o.h, h: o.w });
      }
      return furniture(P, o);
    }
    case 'radiodesk': {
      // (the operator sits on the room's side: the desk faces north)
      B.obj(o.x, o.y, (o.a || 0) + Math.PI, o.id * 31);
      return furniture(P, o);
    }
    case 'drums': return yardProp(P, o);
    case 'couch': {
      B.rblock('std', 0, 0, 0, o.w, 22, o.h, 4, '#5a4a3a', null, FABRIC);
      B.rblock('std', 0, 20, -o.h / 2 + 6, o.w, 22, 10, 4, '#5a4a3a', null, FABRIC);
      for (const e of [-1, 1]) B.rblock('std', e * (o.w / 2 - 5), 20, 0, 10, 10, o.h, 3, '#4a3a2a', null, FABRIC);
      return true;
    }
    case 'tvstand': {
      B.block('std', 0, 0, 0, o.w, 30, o.h, '#5a4a3a', null, WOOD);
      B.rblock('std', 0, 30, 0, 14, 30, 40, 2, '#1a1a1a', [0, 0, 0.05], S(DET.plastic, 0.3, 0));
      pic(B, 'd_graf4', -7.2, 46, 0, 12, -HALF);
      return true;
    }
    case 'gateconsole': {
      B.rblock('std', 0, 0, 0, o.w, 30, o.h, 2, '#5a6262', null, PAINTED);
      B.add('std', T.box(), [0, 33, 0], [o.w - 4, 3, o.h - 6], [0.3, 0, 0], '#3e4646', PAINTED);
      pic(B, 'e_crt2', -24, 46, -4, 18, 0, { w: 24 });
      pic(B, 'e_crt1', 6, 46, -4, 18, 0, { w: 24 });
      B.rblock('std', 34, 33, 4, 14, 6, 10, 2, '#2a2c2e', null, STEEL);
      B.cyl('std', 34, 39, 4, 3, 2, '#c8261c', 10, 1, null, S(DET.plastic, 0.3, 0));
      pic(B, 'e_lamps', 0, 34.5, 8, 3, 0, { w: 50, rx: -1.2 });
      return true;
    }
    case 'issuecounter': {
      B.rblock('std', 0, 0, 0, o.w, 40, o.h, 1.5, '#5a5e56', null, PAINTED);
      B.rblock('std', 0, 40, 0, o.w + 4, 3, o.h + 4, 1, '#3a3e36', null, STEEL);
      pic(B, 'clipboard', -30, 43.5, 0, 12, 0, { rx: -HALF });
      B.rblock('std', 30, 43, 0, 30, 8, 14, 1, '#4b5320', null, S(DET.panel, 0.6, 0.4));
      return true;
    }
    case 'fridge': {
      B.rblock('std', 0, 0, 0, o.w, 100, o.h, 2, '#b8bcc0', null, STAINLESS);
      B.box('std', o.w / 2 + 0.5, 60, -o.h / 4, 1, 30, 3, '#5a5e62', null, STEEL);
      return true;
    }
    case 'shelving': {
      const along = o.w >= o.h, L = along ? o.w : o.h, W = along ? o.h : o.w;
      if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
      for (const e of [-1, 1]) for (const s of [-1, 1]) B.box('std', e * (L / 2 - 2), 75, s * (W / 2 - 2), 3, 150, 3, '#3a5a8a', null, PAINTED);
      for (let y = 6; y < 150; y += 36) {
        B.box('std', 0, y, 0, L, 2, W, '#8a6a44', null, WOOD);
        for (let x = -L / 2 + 10; x < L / 2 - 6; x += 18) {
          const h = hash01(o.id * 11 + x * 3 + y);
          if (h < 0.35) continue;
          B.rblock('std', x, y + 1, 0, 14, 8 + h * 18, W - 6, 0.8, h < 0.6 ? '#9a8a64' : h < 0.8 ? '#4b5320' : '#6a6e72', null, h < 0.6 ? S(0, 0.9, 0) : STEEL);
        }
      }
      return true;
    }
    case 'bench': {
      const along = o.w >= o.h, L = along ? o.w : o.h, W = along ? o.h : o.w;
      if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
      B.rblock('std', 0, 34, 0, L, 4, W, 1, '#6a5a44', null, WOOD);
      for (const x of [-L / 2 + 8, L / 2 - 8]) B.block('std', x, 0, 0, 8, 34, W - 6, '#3a3e42', null, STEEL);
      B.rblock('std', -L / 4, 38, 0, 24, 10, 14, 1, '#b8261c', null, PAINTED);
      B.cyl('std', L / 4, 38, 0, 4, 12, '#5a6a3a', 10, 1, null, STEEL);
      B.block('std', 0, 6, 0, L - 20, 2, W - 8, '#3a3e42', null, STEEL);
      return true;
    }
    case 'toolcart': {
      B.rblock('std', 0, 6, 0, o.w, 40, o.h, 2, '#b8261c', null, PAINTED);
      for (let k = 0; k < 4; k++) B.box('std', o.w / 2 + 0.4, 14 + k * 9, 0, 0.6, 7, o.h - 6, '#8a1a14', null, PAINTED);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cylZ('std', x * (o.w / 2 - 4), 3, z * (o.h / 2 - 4), 3, 2, '#1a1a1a', 8, STEEL);
      return true;
    }
    case 'maptable': {
      B.rblock('std', 0, 30, 0, o.w, 3, o.h, 1, '#5a4a3a', null, WOOD);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', x * (o.w / 2 - 4), 0, z * (o.h / 2 - 4), 4, 30, 4, '#3a3e42', null, STEEL);
      pic(B, 'briefing', 0, 33.4, 0, o.w - 10, 0, { rx: -HALF, rz: HALF, w: (o.w - 10) * 4 / 3 });
      B.cyl('std', 14, 33, -20, 2.4, 6, '#d8d4c8', 8, 1.1, null, S(DET.plastic, 0.4, 0));
      return true;
    }
    case 'flarecrate': {
      B.rblock('std', 0, 0, 0, o.w, 22, o.h, 1, '#6a5a3a', null, WOOD);
      for (let k = 0; k < 7; k++) B.add('std', T.cyl(6, 1), [-o.w / 2 + 6 + k * 6, 24, (hash01(k) - 0.5) * 10], [1.6, 22, 1.6], [HALF, (hash01(k + 3) - 0.5) * 0.4, 0], k % 2 ? '#c8261c' : '#b81a14', S(DET.plastic, 0.5, 0));
      pic(B, 'hazard', 0, 11, o.h / 2 + 0.3, 5, 0, { w: o.w - 6 });
      return true;
    }
    case 'shelterpost': {
      B.box('std', 0, 85, 0, 8, 170, 8, '#5a5e62', null, STEEL);
      B.block('std', 0, 0, 0, 16, 10, 16, COL.concD, null, CONC);
      pic(B, 'hazard', 0, 20, 4.3, 30, 0, { w: 8 });
      return true;
    }
    case 'screenbooth': case 'flightbooth': {
      const W = o.w, D = o.h;
      B.block('std', 0, 0, 0, W, 40, D, '#c8c0a8', null, S(DET.siding, 0.85, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', x * (W / 2 - 2), 40, z * (D / 2 - 2), 4, 56, 4, '#c8c0a8', null, PAINTED);
      B.box('vglass', 0, 68, D / 2 - 1, W - 6, 50, 0.6, '#22323a');
      B.box('vglass', W / 2 - 1, 68, 0, 0.6, 50, D - 6, '#22323a');
      B.box('vglass', -W / 2 + 1, 68, 0, 0.6, 50, D - 6, '#22323a');
      B.block('std', 0, 96, 0, W + 12, 6, D + 12, '#4a5040', null, PAINTED);
      pic(B, o.style === 'screenbooth' ? 'quarantine' : 'taxi', 0, 24, D / 2 + 0.4, 12, 0, { w: W - 6 });
      return true;
    }
    default: return signs(P, o);
  }
}

void RUST; void mixHex; void at;
