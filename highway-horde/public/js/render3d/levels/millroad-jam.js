// Mill Road, section 1 (the Jam): the refrigerated trailer of the semi jackknifed on the creek bridge,
// the logging truck that went over and its spilled logs, the ambulance with its triage, the crop-duster
// down in the field, round bales, the bridge's parapets, fences, chevrons and road signs, the farm's
// windmill and mailbox, and Deke's roll-up shutter in the barricade at the end of the section.

import {
  T, S, WOOD, RUSTY, METAL, CORR, CONC, FABRIC, PLAST, RUBBER, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, atlasUV, rod, plank, sign, sign2, decal, floorDecal, glowBox, carton, crate, drum, tyre, toWorld,
} from './millroad-kit.js';
import { FARM_MODELS } from '../world-hideout-farmstead.js';

const TYRE = '#161617';

/** A road wheel (tyre + rim) with its axle along local z; `sd` which side it faces. */
export function wheel(B, x, r, z, width, sd = 1, rim = '#8a8e92') {
  B.add('std', T.cyl(16), [x, r, z], [r, width, r], [HALF, 0, 0], TYRE, { ...RUBBER, map: 'cyl' });
  B.add('std', T.cyl(12), [x, r, z + sd * width * 0.52], [r * 0.58, 0.8, r * 0.58], [HALF, 0, 0], rim, { ...METAL, map: 'cyl' });
  B.add('std', T.cyl(8), [x, r, z + sd * width * 0.56], [r * 0.18, 1, r * 0.18], [HALF, 0, 0], '#3a3c3e', { ...METAL, map: 'cyl' });
}

// ---- the refrigerated trailer: rear doors swung open, crates of produce spilled on the road ----------------

function reefer(P) {
  const { B, o, L, W } = P;
  const r = B.rng;
  const body = '#e8e4da';
  B.block('std', 0, 13, 0, L, 8, W * 0.8, '#161616', null, RUSTY);
  B.rblock('std', 0, 21, 0, L - 2, 104, W, 1.8, body, null, S(DET.panel, 0.42, 0.45));
  for (let x = -L / 2 + 10; x < L / 2 - 6; x += 18) for (const sd of [-1, 1]) B.box('std', x, 73, sd * (W / 2 + 0.3), 1.2, 102, 0.6, shadeHex(body, -0.08), null, S(DET.panel, 0.45, 0.5));
  for (const sd of [-1, 1]) {
    sign(B, 'mr_reefer', 0, 82, sd * (W / 2 + 0.7), L * 0.86, L * 0.215, sd > 0 ? 0 : PI);
    for (const x of [-0.37, -0.28]) wheel(B, x * L, 13, sd * (W / 2 - 7), 11, sd, '#b0b5ba');
  }
  // the reefer unit on the front face
  B.rblock('std', L / 2 + 4, 70, 0, 10, 46, W * 0.84, 1.4, '#c8ccd0', null, METAL);
  B.box('std', L / 2 + 9.4, 96, 0, 0.6, 16, W * 0.6, '#2a2c2e', null, S(DET.hesco, 0.5, 0.7));
  // the rear: the box open, doors swung round against the sides, cargo inside and spilling out
  B.box('std', -L / 2 + 2, 73, 0, 1, 98, W - 6, '#1a1c1e', null, NJ);
  for (const sd of [-1, 1]) {
    const hz = sd * (W / 2 - 1);
    B.add('std', T.box(), [-L / 2 - 2 + 0.8, 73, hz + sd * (W / 4 + 1)], [1.6, 98, W / 2 - 1], [0, sd * 0.12, 0], shadeHex(body, -0.05), S(DET.panel, 0.45, 0.45));
    for (const y of [30, 110]) B.box('std', -L / 2 - 1, y, hz + sd * (W / 4), 2.2, 3, W / 2 - 4, '#8a8f94', null, CHROME);
  }
  for (let i = 0; i < 12; i++) crate(B, -L / 2 + 12 + (i % 4) * 16, 21 + Math.floor(i / 4) * 14, r.range(-W * 0.3, W * 0.3), 14, 12, 12, r.range(-0.2, 0.2), '#8a6a44');
  // spilled on the road behind: produce crates, cartons, heads of lettuce, a pallet
  for (let i = 0; i < (P.lod >= 1 ? 16 : 6); i++) {
    const x = -L / 2 - 10 - r.range(0, 70), z = r.range(-W, W);
    if (r.chance(0.5)) crate(B, x, 0, z, 16, 10, 12, r.range(0, 6), '#9a7a4a');
    else carton(B, x, 0, z, 14, 10, 12, r.range(0, 6), r.chance(0.5));
    if (r.chance(0.5)) for (let k = 0; k < 4; k++) B.add('std', T.sphere(7, 5), [x + r.range(-12, 12), 3, z + r.range(-12, 12)], [3.4, 3, 3.4], null, r.pick(['#6a9a3a', '#c8a020', '#c8401e', '#7aaa4a']), S(0, 0.6, 0));
  }
  B.rblock('std', -L / 2 - 36, 0, W * 0.2, 44, 6, 36, 0.5, '#8a6a44', [0, 0.3, 0], WOOD);
  void o;
}

// ---- the logging truck's trailer and its logs ----------------------------------------------------------------

function logtrailer(P) {
  const { B, L, W } = P;
  const r = B.rng;
  // the frame: two I-beams, cross members, the tandem axles at the back
  for (const sd of [-1, 1]) B.box('std', 0, 22, sd * W * 0.22, L, 7, 5, '#1c1c1e', null, RUSTY);
  for (let x = -L / 2 + 10; x < L / 2; x += 40) B.box('std', x, 22, 0, 4, 5, W * 0.5, '#1c1c1e', null, RUSTY);
  for (const x of [-0.38, -0.28, 0.3]) for (const sd of [-1, 1]) wheel(B, x * L, 13, sd * (W / 2 - 7), 11, sd);
  // bolsters with stakes (one bent flat where the load broke through)
  const bol = [-0.3, -0.05, 0.2, 0.42];
  bol.forEach((b, i) => {
    B.box('std', b * L, 28, 0, 6, 5, W, '#2a2a2c', null, RUSTY);
    for (const sd of [-1, 1]) {
      const bent = i === 1 && sd > 0;
      B.add('std', T.box(), [b * L, bent ? 34 : 52, sd * (W / 2 - 2) + (bent ? sd * 14 : 0)], [4, bent ? 3 : 46, 4], [bent ? sd * 1.3 : 0, 0, 0], '#2a2a2c', RUSTY);
    }
  });
  // the remaining load: long logs, slewed, a chain hanging loose
  for (let i = 0; i < 7; i++) {
    const z = -W * 0.3 + (i % 4) * W * 0.2, y = 36 + Math.floor(i / 4) * 12;
    const len = L * r.range(0.82, 0.98), rad = r.range(5, 6.5);
    logModel(B, r.range(-6, 6), y + rad * 0.4, z, len, rad, r.range(-0.04, 0.04), r);
  }
  for (let k = 0; k < 10; k++) B.add('std', T.torus(6, 0.25, 3), [0.1 * L, 56 - k * 3.2, W / 2 + 1], [1.6, 1.6, 1.6], [k % 2 ? HALF : 0, 0, 0], '#6a6e72', METAL);
}

/** A log lying along local x (bark, cut ends with rings). */
function logModel(B, x, y, z, len, rad, yaw, r) {
  const bark = mixHex('#4a3a28', '#5e4a34', r.next());
  B.add('std', T.cyl(10), [x, y, z], [rad, len, rad], [0, yaw, HALF], bark, { ...S(DET.bark, 0.92, 0), map: 'cyl', wobble: { amp: 0.06, seed: Math.round(len) } });
  for (const s of [-1, 1]) {
    const ex = x + Math.cos(yaw) * s * (len / 2 + 0.2), ez = z - Math.sin(yaw) * s * (len / 2 + 0.2);
    B.add('std', T.cyl(10), [ex, y, ez], [rad * 0.92, 0.6, rad * 0.92], [0, yaw, HALF], '#c8a070', { ...S(DET.wood, 0.8, 0), map: 'cyl' });
  }
}

/** One spilled log (a low 'rock' obstacle). */
function log(P) {
  const { B, L, W } = P;
  logModel(B, 0, W * 0.5, 0, L, W * 0.5, 0, B.rng);
  if (P.lod >= 1) for (let k = 0; k < 3; k++) B.add('std', T.box(), [B.rng.range(-L / 2, L / 2), 0.4, B.rng.range(-8, 8)], [B.rng.range(4, 9), 0.6, 1.4], [0, B.rng.range(0, 6), 0], '#5a4632', S(DET.bark, 0.9, 0));
}

// ---- the ambulance: a box ambulance, rear doors open, the light bar still going ------------------------------

function ambulance(P) {
  const { B, o, L, W, halos } = P;
  const white = '#ecebe4', red = '#c62828';
  const cabL = L * 0.3, boxL = L * 0.66;
  const bx = -L / 2 + boxL / 2 + 1;
  // chassis and wheels
  B.block('std', 0, 9, 0, L - 6, 6, W * 0.7, '#1a1a1c', null, RUSTY);
  for (const [x, sd] of [[L * 0.32, 1], [L * 0.32, -1], [-L * 0.3, 1], [-L * 0.3, -1]]) wheel(B, x, 10, sd * (W / 2 - 5), 8, sd, '#c8ccd0');
  // the cab: hood, windscreen, doors (driver's open)
  const cx = L / 2 - cabL / 2;
  B.rblock('paint', cx + cabL * 0.22, 14, 0, cabL * 0.56, 18, W - 4, 3, white, null, { surf: [DET.panel, -1, -1] });
  B.rblock('paint', cx - cabL * 0.18, 14, 0, cabL * 0.64, 44, W - 2, 3, white, null, { surf: [DET.panel, -1, -1] });
  B.box('glass', cx + cabL * 0.12, 46, 0, 1, 18, W - 8, '#1a2028', [0, 0, -0.35], S(0, 0.08, 0.3));
  for (const sd of [-1, 1]) B.box('glass', cx - cabL * 0.18, 46, sd * (W / 2 - 0.4), cabL * 0.5, 14, 0.6, '#1a2028', null, S(0, 0.08, 0.3));
  B.add('paint', T.box(), [cx - cabL * 0.34 + 10, 30, -W / 2 - 12], [cabL * 0.5, 30, 2], [0, 1.1, 0], white, { surf: [DET.panel, -1, -1] });
  glowBox(B, L / 2 + 0.2, 22, W * 0.32, 0.6, 5, 7, '#fff4d8', 0.6);
  glowBox(B, L / 2 + 0.2, 22, -W * 0.32, 0.6, 5, 7, '#fff4d8', 0.6);
  B.box('std', L / 2 + 1, 13, 0, 2, 6, W - 2, '#2a2a2c', null, CHROME);
  // the box body with the red band, the star of life, lettering, the light bar
  B.rblock('paint', bx, 16, 0, boxL, 62, W + 2, 2.4, white, null, { surf: [DET.panel, -1, -1] });
  for (const sd of [-1, 1]) {
    B.box('std', bx, 44, sd * (W / 2 + 1.3), boxL - 4, 8, 0.4, red, null, S(DET.panel, 0.45, 0.2));
    sign(B, 'mr_ambulance', bx + 6, 60, sd * (W / 2 + 1.4), boxL * 0.66, boxL * 0.165, sd > 0 ? 0 : PI, { color: '#ffffff' });
    B.box('std', bx - boxL * 0.3, 30, sd * (W / 2 + 1.3), 14, 14, 0.4, '#1a4a9a', null, PLAST);
  }
  B.box('std', bx, 78.6, 0, boxL - 10, 1.2, W * 0.6, '#d8d8d4', null, METAL);
  const on = [['#ff2a1a', -1], ['#ffffff', 1]];
  for (const [c, sd] of on) {
    B.box('blink', bx + boxL / 2 - 4, 80, sd * W * 0.3, 4, 3.4, W * 0.24, c, null, { emissive: 3.6 });
    B.box('blink', bx - boxL / 2 + 3, 72, sd * W * 0.36, 2, 5, 6, c, null, { emissive: 3.4 });
    const [wx, wy] = toWorld(o, bx + boxL / 2 - 4, sd * W * 0.3);
    halos.push({ x: wx, y: wy, h: 82, color: c, size: 70, strength: 0.7, blink: 1 });
  }
  // the rear doors open, the interior: a stretcher pulled half out, cabinets, a lit dome lamp
  const rx = -L / 2;
  B.box('std', rx + 2, 47, 0, 1, 58, W - 4, '#0c1014', null, NJ);
  B.box('std', rx + boxL * 0.5, 17, 0, boxL - 6, 1, W - 6, '#8a9296', null, S(DET.linoleum, 0.5, 0));
  for (const sd of [-1, 1]) {
    B.add('paint', T.box(), [rx - 1, 47, sd * (W / 2 + 12)], [2, 58, W / 2 - 2], [0, sd * 0.25, 0], white, { surf: [DET.panel, -1, -1] });
    B.add('std', T.box(), [rx - 2.2, 47, sd * (W / 2 + 12)], [0.4, 8, W / 2 - 4], [0, sd * 0.25, 0], red, PLAST);
    B.box('std', rx + boxL * 0.5, 50, sd * (W / 2 - 7), boxL * 0.7, 30, 8, '#c8ccd0', null, METAL);
  }
  B.add('glow', T.plane(), [rx + boxL * 0.5, 76, 0], [18, 10, 1], [HALF, 0, 0], '#f0f4ff', { emissive: 2.4, uv: atlasUV('white'), noAO: true });
  // the stretcher: half out of the back, its legs down, a sheet and a dark stain
  B.box('std', rx - 18, 26, 0, 58, 2, 18, '#b8bcc0', [0, 0, -0.18], METAL);
  B.add('std', T.pillow(8, 5, 0.5), [rx - 20, 30, 0], [26, 2.4, 9], [0, 0, -0.18], '#e8e8e4', FABRIC);
  for (const x of [-40]) for (const sd of [-1, 1]) B.box('std', rx + x, 10, sd * 7, 1.4, 20, 1.4, '#8a8e92', null, CHROME);
  if (P.lod >= 1) floorDecal(B, 'blood3', rx - 34, 6, 50, 40, 0.4, 0.5);
}

/** The triage around the ambulance: a gurney, body bags, kit bags, an IV pole, gloves, blood. */
function triage(P) {
  const { B } = P;
  const r = B.rng;
  // the gurney with a body bag, tipped against the shoulder
  B.box('std', 20, 22, 30, 60, 2, 20, '#b8bcc0', [0, 0.3, 0.04], METAL);
  for (const [x, z] of [[-6, 22], [44, 36], [-2, 40], [40, 20]]) B.box('std', x + 2, 11, z, 1.4, 22, 1.4, '#8a8e92', null, CHROME);
  B.add('std', T.pillow(9, 6, 0.5), [20, 26, 30], [28, 4, 9], [0, 0.3, 0], '#1a1c20', PLAST);
  // three body bags in a row on the verge, one open
  for (let i = 0; i < 3; i++) {
    const x = -30 - i * 26, z = 70 + i * 4;
    B.add('std', T.pillow(9, 6, 0.5), [x, 4, z], [10, 4, 30], [0, 0.08 * i, 0], i === 2 ? '#2a2e34' : '#1a1c20', PLAST);
    if (i === 2) B.add('std', T.sphere(8, 6), [x, 6, z + 20], [5, 4.4, 5.4], null, '#6a5a4a', S(0, 0.8, 0));
  }
  // kit bags, a defib, gloves and dressings, an oxygen cylinder
  B.rblock('std', 60, 0, -10, 18, 10, 12, 1.5, '#c62828', [0, 0.4, 0], FABRIC);
  B.rblock('std', 70, 0, 12, 14, 8, 10, 1.2, '#e0a020', [0, -0.3, 0], PLAST);
  B.add('std', T.cyl(10), [48, 4, 50], [3.2, 36, 3.2], [HALF, 0.7, 0], '#2a8a4a', { ...METAL, map: 'cyl' });
  rod(B, 'std', [-4, 0, -26], [-4, 60, -26], 0.6, '#b8bcc0', CHROME, 5);
  B.add('std', T.box(), [-4, 56, -22], [5, 8, 1], [0, 0.2, 0], '#e8f0f4', S(0, 0.3, 0));
  for (let i = 0; i < 14; i++) B.add('std', T.box(), [r.range(-60, 80), 0.5, r.range(-30, 90)], [r.range(2, 5), 0.3, r.range(2, 4)], [0, r.range(0, 6), 0], r.pick(['#4a8ad8', '#e8e8e4', '#f0f0ec']), FABRIC);
  if (P.lod >= 1) {
    floorDecal(B, 'blood3', 10, 50, 60, 50, 0.3, 0.6);
    floorDecal(B, 'blood1', -40, 20, 40, 40, 1.2, 0.62);
  }
}

// ---- the crop-duster that came down in the field ---------------------------------------------------------------

function plane(P) {
  const { B, L, W } = P;
  const yel = '#d8b020', blk = '#1c1c1e';
  // nose down: the whole airframe pitched, the engine buried in a furrow of earth
  const pitch = -0.32;
  const tilt = [0.12, 0, pitch];
  const up = (x, y) => [x * Math.cos(pitch) - y * Math.sin(pitch), x * Math.sin(pitch) + y * Math.cos(pitch)];
  const at = (x, y, z) => { const [px, py] = up(x, y); return [px, py + 26, z]; };
  // fuselage: a tapered box from the cockpit back to the tail
  B.add('paint', T.rbox(L * 0.62, 16, 16, 3), at(-L * 0.12, 16, 0), [1, 1, 1], tilt, yel, { surf: [DET.panel, -1, -1] });
  B.add('paint', T.rbox(L * 0.3, 10, 8, 2), at(-L * 0.46, 20, 0), [1, 1, 1], tilt, yel, { surf: [DET.panel, -1, -1] });
  // the hopper and the canopy (glass cracked)
  B.add('paint', T.rbox(20, 10, 14, 2), at(L * 0.12, 26, 0), [1, 1, 1], tilt, yel, { surf: [DET.panel, -1, -1] });
  B.add('glass', T.rbox(18, 10, 12, 3), at(-L * 0.02, 29, 0), [1, 1, 1], tilt, '#1a2830', S(0, 0.08, 0.3));
  // the engine cowl crumpled into the dirt, the prop bent back
  B.add('std', T.cyl(12, 0.8), at(L * 0.34, 14, 0), [9, 16, 9], [0, 0, pitch - HALF], blk, { ...METAL, map: 'cyl' });
  for (const a of [0.3, 2.4, 4.4]) B.add('std', T.box(), at(L * 0.42 + Math.cos(a) * 3, 14 + Math.sin(a) * 10, Math.sin(a) * 8), [2, 22, 4], [a, 0, pitch - 0.6], '#3a3a3a', METAL);
  // the lower wing still on (left), the right wing torn off and lying behind
  B.add('paint', T.rbox(24, 2.6, 110, 1.2), at(L * 0.08, 6, -56), [1, 1, 1], [0.2, 0, pitch], yel, { surf: [DET.panel, -1, -1] });
  B.add('paint', T.rbox(22, 2.6, 96, 1.2), [-L * 0.9, 1.4, 64], [1, 1, 1], [0.02, 0.5, 0.04], shadeHex(yel, -0.15), { surf: [DET.panel, -1, -1] });
  for (let i = 0; i < 6; i++) B.add('std', T.cyl(6), [-L * 0.9 - 30 + i * 12, 3, 30 + i * 12], [0.7, 12, 0.7], [HALF, 0.4, 0], '#8a8e92', { ...METAL, map: 'cyl' });
  // the tail: fin with the number, elevators
  B.add('paint', T.rbox(18, 24, 2, 1), at(-L * 0.58, 34, 0), [1, 1, 1], tilt, yel, { surf: [DET.panel, -1, -1] });
  B.add('paint', T.rbox(14, 1.8, 46, 0.8), at(-L * 0.57, 22, 0), [1, 1, 1], tilt, yel, { surf: [DET.panel, -1, -1] });
  for (const sd of [-1, 1]) {
    B.add('std', T.box(), at(-L * 0.12, 16, sd * 8.3), [L * 0.5, 3, 0.4], [0.12, 0, pitch], blk, PLAST);
  }
  const [nx, ny] = at(-L * 0.3, 22, 8.4);
  sign(B, 'mr_agair', nx, ny, 8.5, 40, 10, 0, { rz: pitch });
  // landing gear, one leg snapped
  rod(B, 'std', at(L * 0.12, 6, 10), [L * 0.2, 2, 18], 1.2, blk, METAL, 5);
  B.add('std', T.cyl(10), [L * 0.2, 5, 20], [5, 3, 5], [HALF, 0, 0], TYRE, { ...RUBBER, map: 'cyl' });
  // the furrow: heaped earth in front, clods, a smoking hole
  for (let i = 0; i < 9; i++) B.add('std', T.dodeca(), [L * 0.46 + B.rng.range(-10, 22), 3, B.rng.range(-26, 26)], [B.rng.range(6, 14), B.rng.range(3, 7), B.rng.range(6, 12)], [0, B.rng.range(0, 6), 0], '#4a3a28', S(DET.dirt, 0.95, 0));
  if (P.lod >= 1) floorDecal(B, 'grime', -L * 0.4, 0, 120, 60, 0, 0.4);
  void W;
}

// ---- small things of the fields and the road ------------------------------------------------------------------

/** A round hay bale on its side (a 'rock' obstacle). */
function bale(P) {
  const { B, L } = P;
  const straw = mixHex('#c9a850', '#b89840', B.rng.next());
  B.add('std', T.cyl(18), [0, L * 0.46, 0], [L * 0.48, L * 0.9, L * 0.48], [HALF, 0, 0], straw, { ...S(DET.fabric, 0.97, 0), map: 'cyl', wobble: { amp: 0.04, seed: 3 } });
  for (const s of [-1, 1]) B.add('std', T.cyl(18), [0, L * 0.46, s * L * 0.451], [L * 0.44, 0.6, L * 0.44], [HALF, 0, 0], shadeHex(straw, -0.12), { ...S(DET.fabric, 0.97, 0), map: 'cyl' });
  if (P.lod >= 1) for (const zz of [-0.25, 0.1, 0.3]) B.add('std', T.torus(18, 0.012, 3), [0, L * 0.46, zz * L], [L * 0.485, L * 0.485, L * 0.485], null, '#e8e0c8', PLAST);
}

/** The creek bridge: concrete parapets with railings along both water edges, the deck's kerbs. */
function bridge(P) {
  const { B, o } = P;
  const len = o.len, deck = o.deck;
  for (const sd of [-1, 1]) {
    const z = sd * (deck / 2 - 6);
    B.rblock('std', 0, 0, z, len, 22, 12, 1.2, '#a8a498', null, { noJitter: true, ...CONC });
    for (let x = -len / 2 + 6; x < len / 2; x += 28) B.block('std', x, 22, z, 3, 16, 3, '#6a6e72', null, RUSTY);
    B.box('std', 0, 40, z, len, 3, 4, '#8a8e92', null, RUSTY);
    B.box('std', 0, 31, z, len, 2, 2, '#8a8e92', null, RUSTY);
    // a plaque on the parapet
    if (sd > 0) sign(B, 'notice', 20, 12, z + 6.2, 14, 16, 0, { color: '#c8c0a0' });
  }
  // the old guard rail bent out where the semi hit it
  B.add('std', T.box(), [-len * 0.2, 30, -deck / 2 - 4], [60, 8, 2], [0.4, 0.3, 0], '#9aa0a4', METAL);
}

/** Chevron boards round the corner. */
function chevrons(P) {
  const { B, o } = P;
  const n = o.n || 4;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 60;
    B.cyl('std', x, 0, 0, 1.4, 54, '#8a8e92', 6, 1, null, METAL);
    B.box('std', x, 50, 0.4, 18, 22, 1, '#e8c020', null, PLAST);
    for (const s of [-1, 1]) B.add('std', T.box(), [x + s * 0.2, 50, 1], [3, 14, 0.4], [0, 0, s * 0.7], '#1a1a1a', PLAST);
  }
}

/** A rural fence: timber posts, three strands of barbed wire, broken where something went through. */
function farmfence(P) {
  const { B, o } = P;
  const len = o.len;
  const along = Math.abs(o.a) < 0.1 ? o.x : o.y;
  const gaps = (o.gaps || []).map(([a, b]) => [a - along, b - along]);
  const inGap = (x) => gaps.some(([a, b]) => x > a && x < b);
  const r = B.rng;
  const step = 70;
  let prev = null;
  for (let x = -len / 2; x <= len / 2; x += step) {
    if (inGap(x)) { prev = null; continue; }
    const lean = r.range(-0.06, 0.06);
    B.add('std', T.cyl(6, 0.9), [x, 20, 0], [2.2, 40, 2.2], [lean, 0, r.range(-0.04, 0.04)], '#5a4a38', { ...S(DET.wood, 0.9, 0), map: 'cyl' });
    if (prev !== null && P.lod >= 1) for (const y of [14, 25, 36]) rod(B, 'std', [prev, y, 0], [x, y - r.range(0, 2), 0], 0.18, '#4a4642', RUSTY, 3);
    prev = x;
  }
}

/** A sign on posts by the road: `text` names the kind. */
function roadsign(P) {
  const { B, o } = P;
  const k = o.text;
  if (k === 'millrd') {
    B.cyl('std', 0, 0, 0, 1.6, 96, '#8a8e92', 6, 1, null, METAL);
    for (const ry of [0, HALF]) sign2(B, 'mr_millrd', 0, 94, 0, 44, 11, ry);
    B.box('std', 0, 76, 0.8, 16, 20, 1, '#f0f0e8', null, PLAST);
    sign(B, 'white', 0, 76, 1.4, 14, 18, 0, { color: '#c62828' });
    return;
  }
  const cell = { gas2: 'mr_gas2', shady: 'mr_shadysign', roadhouse: 'mr_rhsign' }[k] || 'mr_gas2';
  for (const x of [-26, 26]) B.cyl('std', x, 0, 0, 1.8, 84, '#8a8e92', 6, 1, null, METAL);
  B.box('std', 0, 70, -0.8, 80, 40, 1.2, '#6a6e72', null, METAL);
  sign(B, cell, 0, 70, 0.1, 78, 38, 0);
}

/** A rural mailbox on a post. */
function mailbox(P) {
  const { B } = P;
  B.cyl('std', 0, 0, 0, 2, 36, '#5a4a38', 6, 1, null, WOOD);
  B.rblock('std', 0, 36, 0, 16, 9, 9, 3, '#3a4a5a', null, METAL);
  B.box('std', -3, 44, 5, 1, 7, 1, '#c62828', [0, 0, 0.3], PLAST);
}

/** The farm's windmill: the hideout's model, its wheel drawn standing still. */
function windmill(P) {
  const fn = FARM_MODELS.windmill;
  const dyn = { spinners: [] };
  fn({ ...P, dyn });
  const sp = dyn.spinners[0];
  if (sp) {
    P.B.obj(sp.x, sp.y, sp.a, 991, sp.h);
    sp.build(P.B);
  }
}

// ---- Deke's roll-up shutter in the barricade (the gate), and its frame ----------------------------------

/** The shutter itself (the gate obstacle: w = the opening, the model rolls up). */
function shutter(P) {
  const { B, L, W } = P;
  const H = 128;
  // corrugated slats, dented, a painted message across them, a bottom bar and handles
  const n = Math.round(H / 5);
  for (let i = 0; i < n; i++) {
    const y = 3 + i * 5;
    B.box('std', 0, y + 2.4, 0, L - 4, 4.6, 2.6, i % 2 ? '#8a9092' : '#7e8486', [(hash01(i * 7) - 0.5) * 0.02, 0, 0], CORR);
  }
  B.box('std', 0, 2.4, 0, L - 2, 4.8, 4, '#3a3c3e', null, RUSTY);
  for (const f of [-1, 1]) {
    sign(B, 'mr_deke', 0, 64, f * 1.8, L * 0.7, L * 0.35, f > 0 ? 0 : PI);
    for (const x of [-L * 0.3, L * 0.3]) B.box('std', x, 14, f * 2.4, 10, 2, 2, '#1a1a1a', null, METAL);
  }
  void W;
}

/** The shutter's frame: steel posts, the drum housing, two crushed cars stood on end as bastions. */
function shutterframe(P) {
  const { B, o, halos } = P;
  const w = o.w, H = 140;
  const steel = '#3a3e42';
  for (const s of [-1, 1]) {
    B.box('std', s * (w / 2 + 5), H / 2, 0, 10, H, 16, steel, null, RUSTY);
    B.box('std', s * (w / 2 + 5), H / 2, -9, 12, H, 2, steel, null, RUSTY);
  }
  B.rblock('std', 0, H - 6, 0, w + 24, 22, 26, 2, '#4a4e52', null, METAL);
  sign2(B, 'mr_deke', 0, H + 26, -10, 100, 50, PI);
  // floodlights on the header, one still working
  for (const s of [-1, 1]) {
    B.rbox('std', s * w * 0.35, H + 20, -12, 12, 9, 7, 1, '#2a2c2e', [0.5, 0, 0], METAL);
    if (s > 0) {
      glowBox(B, s * w * 0.35, H + 18, -16, 10, 7, 0.5, '#fff0d0', 3.6, [0.5, 0, 0]);
      const [wx, wy] = toWorld(o, s * w * 0.35, -16);
      halos.push({ x: wx, y: wy, h: H + 18, color: '#fff0d0', size: 90, strength: 0.6 });
    }
  }
  // the bastions: cars stood on their noses against the posts
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 50);
    B.add('paint', T.rbox(40, 84, 44, 5), [x, 42, -34], [1, 1, 1], [0, s * 0.1, 0], s > 0 ? '#5a3a2a' : '#3a4450', { surf: [DET.rust, 0.7, 0.4] });
    B.box('glass', x, 60, -34 - 22.4, 30, 20, 0.6, '#101418', null, S(0, 0.1, 0.3));
  }
  // a painted arrow and HONK on the road in front
  if (P.lod >= 1) for (let i = 0; i < 3; i++) floorDecal(B, 'graf2', 0, -80 - i * 2, 90, 30, HALF, 0.5 + i * 0.01, '#ffffff');
}

export const JAM_MODELS = {
  'mr-reefer': reefer, 'mr-logtrailer': logtrailer, 'mr-log': log, 'mr-ambulance': ambulance, 'mr-triage': triage, 'mr-plane': plane,
  'mr-bale': bale, 'mr-bridge': bridge, 'mr-chevrons': chevrons, 'mr-farmfence': farmfence, 'mr-roadsign': roadsign, 'mr-mailbox': mailbox,
  'mr-windmill': windmill, 'mr-shutterframe': shutterframe,
};
export const JAM_GATES = { 'mr-shutter': shutter };
void [WOOD, METAL, drum, decal, plank, CONC, NJ, tyre];
