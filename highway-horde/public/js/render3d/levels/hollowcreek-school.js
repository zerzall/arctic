// Hollow Creek, sections 5 and 6: Hollow Creek Elementary (the fence panel the crew cuts, the bus, the
// monument sign, the flag, the portables and the dumpster up to their roof, the court's hoops, the lockers,
// the classrooms, the office, the gym and its bleachers, the hall) and the police station (the sally port's
// gate and frame, the cells, the armory's racks, booking, the front desk, the bullpen, the transport van,
// the station's lettering and sign).

import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CONC, FABRIC, PLAST, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, decal, floorDecal, carton, toWorld, lvUV, litter, tubeFixture,
} from './millroad-kit.js';
import { buildVehicle, buildBus } from '../world-veh.js';
import { lvSub } from './millroad-atlas.js';

const GLASS = { noJitter: true, surf: [0, 0.06, 0] };
const BRICK = { noJitter: true, surf: [DET.brick, 0.9, 0] };

/** An old CRT monitor and keyboard on a desk top at y. */
function crt(B, x, y, z, rot = 0) {
  B.rblock('std', x, y, z, 15, 13, 14, 1.5, '#d8d4c4', [0, rot, 0], PLAST);
  B.box('std', x - Math.sin(rot) * 7.2, y + 7, z - Math.cos(rot) * 7.2, 11, 8.6, 0.4, '#1a2420', [0, rot, 0], S(0, 0.1, 0.2));
  B.box('std', x - Math.sin(rot) * 14, y + 0.6, z - Math.cos(rot) * 14, 16, 1.2, 6, '#c8c4b4', [0, rot, 0], PLAST);
}

/** A school chair (blue plastic shell on a steel frame), maybe knocked over. */
function chair(B, x, z, rot, fallen) {
  if (fallen) {
    B.add('std', T.box(), [x, 5, z], [12, 1.2, 12], [HALF - 0.2, rot, 0], '#2a5ab0', PLAST);
    return;
  }
  B.box('std', x, 15, z, 12, 1.2, 12, '#2a5ab0', [0, rot, 0], PLAST);
  B.box('std', x + Math.sin(rot) * 6, 24, z + Math.cos(rot) * 6, 12, 14, 1.2, '#2a5ab0', [0, rot, 0], PLAST);
  for (const [dx, dz] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) B.box('std', x + dx, 7.5, z + dz, 0.8, 15, 0.8, '#8a8e92', null, CHROME);
}

// ---- the school -------------------------------------------------------------------------------------------------

/** The fence panel (the gate): a chain-link panel on its frame with a NO TRESPASSING plate. */
function schoolpanel(P) {
  const { B, L } = P;
  const H = 96, pole = '#8a8e92';
  for (const s of [-1, 1]) B.cyl('std', s * (L / 2 - 2), 0, 0, 2, H + 6, pole, 8, 1, null, CHROME);
  for (const y of [3, H - 1]) B.add('std', T.cyl(6), [0, y, 0], [1.1, L, 1.1], [0, 0, HALF], pole, { ...CHROME, map: 'cyl' });
  B.add('fence', T.plane(), [0, H / 2, 0], [L - 4, H - 4, 1], null, '#8a9094', { uvScale: [L / 16, H / 16] });
  B.box('std', 0, 60, -0.8, 40, 20, 0.6, '#f0eee6', null, PLAST);
  sign(B, 'mr_closed', 0, 60, -1.2, 26, 19.5, PI);
}

/** The school bus in the loop: the world's school bus, a smear on the door, spray on the side. */
function schoolbus(P) {
  const { B, o } = P;
  buildBus(B, o, false);
  decal(B, 'hc_school_graf', -o.w * 0.15, 40, -o.h / 2 - 0.8, 90, 34, PI);
  decal(B, 'hands', o.w * 0.3, 60, o.h / 2 + 0.8, 26, 26, 0);
  decal(B, 'blood2', o.w * 0.36, 40, o.h / 2 + 0.8, 24, 40, 0);
  const r = B.rng;
  for (let k = 0; k < 6; k++) B.rblock('std', o.w * 0.3 + r.range(-20, 30), 0, o.h / 2 + r.range(8, 40), 9, 11, 5, 2, r.pick(['#c62828', '#2a5ab0', '#e8a020', '#8a3ab0', '#3a9a5a']), [0, r.range(0, 6), r.range(-0.3, 0.3)], FABRIC);
}

/** The school's monument sign (facing local +z): brick piers, the name panel, the letterboard. */
function schoolsign(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 150, 20, 26, 1, '#a85a3a', null, BRICK);
  for (const s of [-1, 1]) B.rblock('std', s * 70, 20, 0, 16, 90, 22, 1, '#a85a3a', null, BRICK);
  B.box('std', 0, 66, 0, 126, 76, 8, '#2a2a2c', null, METAL);
  sign(B, 'hc_school', 0, 66, 4.2, 124, 46.5, 0);
  sign(B, 'hc_school', 0, 66, -4.2, 124, 46.5, PI);
  B.rblock('std', 0, 110, 0, 160, 6, 28, 1, '#c8c0b0', null, CONC);
  B.rblock('std', 0, 0, 30, 170, 5, 30, 2, '#5a4a36', null, { noJitter: true, surf: [DET.dirt, 0.95, 0] });
}

/** A flagpole: the pole, the truck, the flag at half mast, the halyard. */
function flag(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 22, 4, 22, 1, '#a8a498', null, CONC);
  B.cyl('std', 0, 4, 0, 2.2, 220, '#c8ccce', 12, 0.5, null, CHROME);
  B.add('std', T.sphere(8, 6), [0, 226, 0], [3, 3, 3], null, '#d8b040', S(0, 0.3, 0.8));
  for (const z of [-1, 1]) B.add('lvsign', T.plane(), [24, 150, z * 0.4], [46, 30, 1], [0, z > 0 ? 0 : PI, -0.08], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
  rod(B, 'std', [2, 10, 0], [2, 224, 0], 0.15, '#e8e8e0', FABRIC, 3);
}

/** A portable classroom on blocks (its roof is the stand-on top): siding, windows, the door and its steps,
 *  skirting, an AC unit, a ladder someone left against it. */
function portable(P) {
  const { B, o } = P;
  const L = o.w, W = o.h, r = B.rng;
  const H = 84;
  B.box('std', 0, 6, 0, L - 6, 12, W - 6, '#6a6a66', null, { noJitter: true, surf: [DET.panel, 0.7, 0.2] });
  B.box('std', 0, 12 + (H - 16) / 2, 0, L, H - 16, W, o.color || '#d8d0bc', null, { noJitter: true, surf: [DET.siding, 0.85, 0] });
  B.box('std', 0, H - 2, 0, L + 6, 4, W + 6, '#8a8e92', null, { noJitter: true, surf: [DET.metalroof, 0.6, 0.4] });
  for (const sd of [-1, 1]) {
    for (let x = -L / 2 + 40; x < L / 2 - 30; x += 50) {
      if (sd > 0 && Math.abs(x - 10) < 30) continue;
      B.box('std', x, 50, sd * (W / 2 + 0.4), 30, 22, 0.6, '#2a3438', null, { noJitter: true, surf: [0, 0.1, 0.2] });
      B.box('std', x, 38, sd * (W / 2 + 1.2), 34, 2, 2.4, '#e8e4dc', null, PLAST);
    }
  }
  B.box('std', 10, 40, W / 2 + 0.6, 22, 56, 1, '#6a7a8a', null, METAL);
  B.rblock('std', 10, 0, W / 2 + 14, 34, 12, 26, 1, '#8a8e92', null, METAL);
  rod(B, 'std', [-6, 12, W / 2 + 26], [-6, 40, W / 2 + 26], 0.8, '#c8ccce', CHROME, 4);
  B.rblock('std', L / 2 + 8, 30, 0, 14, 24, 28, 1, '#c8c4b8', null, METAL);
  sign(B, 'hc_kids', -L / 4, 50, W / 2 + 1, 50, 25, 0);
  if (P.lod >= 1) decal(B, 'grime', r.range(-60, 60), 40, -W / 2 - 1, 120, 60, PI);
}

/** The ladder up the portable from beside the dumpster (an aluminium extension ladder). */
function dumpster(P) {
  const { B, o } = P;
  const L = o.w, W = o.h, r = B.rng;
  const H = 54;
  B.rblock('std', 0, 6, 0, L, H, W, 2, o.color || '#2e5d3a', null, S(DET.rust, 0.7, 0.4));
  B.box('std', 0, H + 6, -W / 4, L + 2, 2, W / 2 + 1, '#1a1a1a', [0.04, 0, 0], PLAST);
  B.add('std', T.box(), [0, H + 6 + 12, W / 4 + 10], [L + 2, 2, W / 2 + 1], [-1.1, 0, 0], '#1a1a1a', PLAST);
  for (const s of [-1, 1]) for (const z of [-1, 1]) B.cyl('std', s * (L / 2 - 6), 0, z * (W / 2 - 6), 3, 6, '#1a1a1a', 8, 1, null, METAL);
  for (let k = 0; k < 4; k++) B.add('std', T.pillow(8, 6, 0.4), [r.range(-L / 2, L / 2), 6, W / 2 + r.range(6, 18)], [8, 6, 7], [0, r.range(0, 6), 0], '#1a1a1c', S(DET.plastic, 0.3, 0));
  // the ladder from the ground to the portable's roof edge, set against the dumpster's end
  for (const s of [-1, 1]) plank(B, 'std', [-L / 2 - 30, 0, s * 9], [-L / 2 - 6, 88, s * 9], 3, 1.4, '#c8ccce', CHROME);
  for (let k = 1; k < 9; k++) { const t = k / 9; B.box('std', -L / 2 - 30 + 24 * t, 88 * t, 0, 1.2, 1.2, 18, '#c8ccce', null, CHROME); }
}

/** An outdoor basketball hoop on a pole (the board facing local +x). */
function hoop(P) {
  const { B } = P;
  B.cyl('std', -20, 0, 0, 3, 110, '#3a5a8a', 10, 1, null, METAL);
  plank(B, 'std', [-20, 104, 0], [-4, 108, 0], 3, 3, '#3a5a8a', METAL);
  B.box('std', -2, 112, 0, 2, 34, 52, '#f0f0ea', null, PLAST);
  B.box('std', -0.6, 108, 0, 0.4, 14, 18, '#c62828', null, PLAST);
  B.add('std', T.torus(14, 0.06, 4), [6, 100, 0], [7, 7, 7], [HALF, 0, 0], '#e0601a', METAL);
}

/** A bank of hall lockers (facing local +z): doors with vents, some hanging open, stickers. */
function lockers(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 78, n = Math.round(L / 13);
  const col = r.pick(['#2a5ab0', '#c62828', '#3a8a5a']);
  B.box('std', 0, 3, 0, L, 6, D, '#2a2c2e', null, METAL);
  B.box('std', 0, 6 + H / 2, -1, L, H, D - 2, shadeHex(col, -0.2), null, METAL);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * (L / n);
    const open = r.chance(0.18);
    if (open) {
      B.box('std', x, 6 + H / 2, D / 2 - 2.4, L / n - 1.4, H - 2, 0.6, '#1a1a1a', null, NJ);
      B.add('std', T.box(), [x - L / n / 2 + 1 + Math.cos(1.2) * (L / n) / 2, 6 + H / 2, D / 2 + Math.sin(1.2) * (L / n) / 2], [L / n - 1.4, H - 2, 1], [0, -1.2, 0], col, METAL);
    } else B.box('std', x, 6 + H / 2, D / 2 - 0.6, L / n - 1.4, H - 2, 1.2, col, null, METAL);
    if (P.lod >= 1 && !open) for (let k = 0; k < 3; k++) B.box('std', x, H - 6 - k * 3, D / 2 + 0.1, L / n * 0.5, 0.8, 0.4, '#1a1a1a', null, NJ);
  }
}

/** A classroom: rows of desks and chairs facing the board on the west wall, the teacher's desk, the
 *  chalkboard, the alphabet and the children's drawings, cubbies, the clock and flag, tube lights. */
function classroom(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  const xb = -w / 2 + 8;
  B.box('std', xb, 70, 0, 2, 50, Math.min(150, h - 40), '#6a4a30', null, WOOD);
  B.add('lvsign', T.plane(), [xb + 1.4, 70, 0], [Math.min(146, h - 44), 46, 1], [0, HALF, 0], '#ffffff', { uv: lvUV('hc_chalk'), noAO: true, noJitter: true });
  B.add('lvsign', T.plane(), [xb + 1.2, 104, 0], [Math.min(146, h - 44), 9, 1], [0, HALF, 0], '#ffffff', { uv: lvUV('hc_abc'), noAO: true, noJitter: true });
  sign(B, 'hc_kids', 0, 64, h / 2 - 7.6, 80, 40, PI);
  sign(B, 'hc_kids', w / 2 - 80, 64, h / 2 - 7.6, 60, 30, PI, { uv: [lvUV('hc_kids')[2], lvUV('hc_kids')[1], lvUV('hc_kids')[0], lvUV('hc_kids')[3]] });
  // the clock and the flag over the board
  B.cyl('std', xb + 1, 112, -50, 7, 1.4, '#f0f0ea', 16, 1, [0, 0, HALF], PLAST);
  B.add('lvsign', T.plane(), [xb + 3, 108, 50], [22, 14, 1], [0, HALF, 0], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
  // the teacher's desk
  B.rblock('std', xb + 34, 0, 30, 30, 28, 50, 1, '#8a6a48', null, WOOD);
  B.add('std', T.sphere(8, 6), [xb + 34, 31, 20], [3.6, 3.6, 3.6], null, '#c8281e', PLAST);
  for (let k = 0; k < 4; k++) B.box('std', xb + 30 + r.range(-6, 6), 28.6 + k * 0.6, 40, 9, 0.5, 12, '#f0ece0', [0, r.range(-0.3, 0.3), 0], NJ);
  // rows of desks facing the board (some pushed into a barricade by the door)
  const cols = Math.max(2, Math.floor((w - 110) / 52)), rows = Math.max(2, Math.floor((h - 60) / 44));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = xb + 90 + i * 52 + r.range(-4, 4), z = -h / 2 + 40 + j * 44 + r.range(-4, 4);
      const rot = HALF + r.range(-0.15, 0.15);
      if (r.chance(0.12)) { B.add('std', T.box(), [x, 8, z], [22, 1.6, 16], [HALF - 0.1, rot, 0], '#c8b08a', WOOD); continue; }
      B.box('std', x, 22, z, 16, 1.6, 22, '#c8b08a', [0, rot - HALF, 0], WOOD);
      for (const [dx, dz] of [[-6, -9], [6, -9], [6, 9], [-6, 9]]) B.box('std', x + dx, 11, z + dz, 0.8, 22, 0.8, '#8a8e92', null, CHROME);
      chair(B, x + 12, z, rot, r.chance(0.15));
      if (r.chance(0.25)) B.rblock('std', x + r.range(-10, 10), 0, z + r.range(-10, 10), 9, 11, 5, 2, r.pick(['#c62828', '#2a5ab0', '#e8a020', '#8a3ab0']), [0, r.range(0, 6), r.range(-0.6, 0.6)], FABRIC);
    }
  }
  // cubbies along the east wall, tube lights, litter
  B.box('std', w / 2 - 14, 22, 0, 18, 44, Math.min(160, h - 40), '#c8b08a', null, WOOD);
  for (let k = 0; k < 8; k++) B.rblock('std', w / 2 - 22, 4 + (k % 3) * 14, -60 + k * 15, 6, 10, 9, 1.5, r.pick(['#c62828', '#2a5ab0', '#e8a020', '#3a9a5a']), null, FABRIC);
  for (const x of [-w / 4, w / 4]) tubeFixture(B, P.halos, x, 114, 0, HALF, hash01(o.x + x) < 0.3 ? 'dead' : 'lit');
  litter(B, -w / 2 + 20, -h / 2 + 20, w / 2 - 20, h / 2 - 20, P.lod >= 1 ? 16 : 6, 0.6, { cans: false });
}

/** The office counter: laminate over a panelled front, the sign-in clipboard, the bell, lost-and-found. */
function officecounter(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 40, D, 1, '#8a6a48', null, WOOD);
  B.box('std', 0, 41, 0, L + 4, 2, D + 4, '#d8d0bc', null, S(0, 0.4, 0));
  B.box('std', -L * 0.3, 42.4, 4, 10, 0.6, 14, '#c8a060', [0, 0.2, 0], WOOD);
  B.cyl('std', L * 0.1, 42, 0, 2.2, 2, '#c8a040', 10, 0.5, null, CHROME);
  B.rblock('std', L * 0.35, 0, D / 2 + 14, 22, 18, 18, 1, '#2a5ab0', null, PLAST);
}

/** The school office: desks with old monitors, filing cabinets, the PA microphone, papers everywhere. */
function office(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (const [x, z] of [[-60, 20], [80, 20]]) {
    B.rblock('std', x, 0, z, 60, 28, 30, 1, '#8a6a48', null, WOOD);
    crt(B, x, 28, z - 4, 0);
    chair(B, x, z - 24, PI, r.chance(0.3));
  }
  for (let k = 0; k < 4; k++) B.rblock('std', w / 2 - 20, 0, -h / 2 + 22 + k * 22, 18, 52, 20, 0.8, '#8a8e92', null, METAL);
  B.add('std', T.box(), [w / 2 - 46, 6, -20], [18, 52, 20], [HALF - 0.2, 0.4, 0], '#8a8e92', METAL);
  B.cyl('std', -20, 28, 10, 2, 1, '#1a1a1a', 8, 1, null, METAL);
  rod(B, 'std', [-20, 29, 10], [-18, 40, 8], 0.4, '#2a2a2a', METAL, 3);
  B.add('std', T.sphere(6, 4), [-18, 41, 8], [2, 2.6, 2], null, '#3a3a3a', METAL);
  for (let k = 0; k < (P.lod >= 1 ? 30 : 10); k++) B.box('std', r.range(-w / 2 + 20, w / 2 - 20), 0.7, r.range(-h / 2 + 10, h / 2 - 10), 8, 0.3, 11, r.pick(['#f0ece0', '#e8e4d8', '#f2e08a', '#e8c8c8']), [0, r.range(0, 6), 0], NJ);
  tubeFixture(B, P.halos, 0, 114, 0, 0, 'flicker');
}

/** Folding wooden bleachers against the gym's wall (rising toward local -z). */
function bleachers(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  const tiers = 4, step = D / tiers;
  for (let k = 0; k < tiers; k++) {
    const z = D / 2 - (k + 0.5) * step, y = 10 + k * 12;
    B.box('std', 0, y, z, L, 2.4, step - 1, '#c8985a', null, WOOD);
    B.box('std', 0, y - 6, z + step / 2 - 1, L, 10, 1.2, '#8a8e92', null, METAL);
  }
  for (let x = -L / 2 + 10; x < L / 2; x += 60) B.box('std', x, 26, 0, 3, 52, D - 4, '#6a6e72', null, METAL);
  const r = B.rng;
  for (let k = 0; k < 8; k++) B.rblock('std', r.range(-L / 2 + 10, L / 2 - 10), 12 + Math.floor(r.range(0, 4)) * 12, r.range(-D / 2, D / 2), 8, 10, 5, 2, r.pick(['#c62828', '#2a5ab0', '#e8a020', '#3a9a5a']), [0, r.range(0, 6), 0], FABRIC);
}

/** The gym: court lines and the hornet at centre court, the hoops at both ends, the scoreboard, banners,
 *  the shelter's cots in rows, mats, high-bay lamps. */
function gym(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  const y = 0.62;
  const line = (x, z, lx, lz) => B.quad('std', [x, y, z], [0, 0, lz], [lx, 0, 0], '#f0f0ea', { noJitter: true, surf: [0, 0.4, 0] });
  line(0, -h / 2 + 22, w - 44, 2.4);
  line(0, h / 2 - 22, w - 44, 2.4);
  line(-w / 2 + 22, 0, 2.4, h - 44);
  line(w / 2 - 22, 0, 2.4, h - 44);
  line(0, 0, 2.4, h - 44);
  for (const s of [-1, 1]) {
    B.quad('std', [s * (w / 2 - 22 - 50), y - 0.02, 0], [0, 0, 120], [100, 0, 0], '#b3261e', { noJitter: true, surf: [0, 0.4, 0] });
    // the hoops: backboard on a frame from the end walls
    plank(B, 'std', [s * (w / 2 - 6), 140, 0], [s * (w / 2 - 34), 116, 0], 4, 4, '#8a8e92', METAL);
    B.box('std', s * (w / 2 - 36), 116, 0, 2, 36, 56, '#e8f0f4', null, GLASS);
    B.add('std', T.torus(14, 0.06, 4), [s * (w / 2 - 44), 104, 0], [7, 7, 7], [HALF, 0, 0], '#e0601a', METAL);
  }
  B.add('lvsign', T.plane(), [0, y + 0.1, 0], [90, 90, 1], [-HALF, 0, 0], '#ffffff', { uv: lvUV('hc_hornet'), noAO: true, noJitter: true });
  // the scoreboard and banners on the walls
  B.box('std', 0, 122, h / 2 - 9, 90, 34, 4, '#1a1a1a', null, METAL);
  for (let k = 0; k < 6; k++) B.box('std', -30 + k * 12, 122, h / 2 - 11.2, 8, 12, 0.4, k === 2 ? '#3a3a3a' : '#c83a1a', null, NJ);
  for (const x of [-140, 140]) { B.box('std', x, 112, -h / 2 + 64, 40, 50, 1, x < 0 ? '#1a3a6a' : '#e8b820', null, FABRIC); }
  // the shelter's cots (the gym was the county's shelter)
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    if (r.chance(0.2)) continue;
    const x = -w / 2 + 70 + i * 80, z = -40 + j * 70, a = r.range(-0.1, 0.1);
    B.box('std', x, 12, z, 60, 1.6, 24, '#4a5a3a', [0, a, 0], FABRIC);
    for (const dx of [-26, 26]) for (const dz of [-10, 10]) B.box('std', x + dx, 6, z + dz, 1.2, 12, 1.2, '#6a6e72', null, METAL);
    if (r.chance(0.6)) B.add('std', T.pillow(8, 6, 0.4), [x + r.range(-10, 10), 15, z], [20, 3, 10], [0, r.range(-0.4, 0.4), 0], r.pick(['#8a2a2a', '#2a4a7a', '#6a6a5a', '#8a7a4a']), FABRIC);
    if (r.chance(0.2)) floorDecal(B, 'blood3', x, z, 50, 40, r.range(0, 6), 0.7);
  }
  for (const x of [-w / 2 + 40, w / 2 - 40]) B.box('std', x, 4, h / 2 - 60, 50, 8, 80, '#2a4a8a', null, FABRIC);
  for (const x of [-w / 4, w / 4]) for (const z of [-h / 4, h / 4]) {
    rod(B, 'std', [x, 150, z], [x, 140, z], 0.4, '#2a2a2a', METAL, 3);
    B.add('std', T.cyl(12, 0.4, true), [x, 135, z], [12, 10, 12], [PI, 0, 0], '#6a6e72', METAL);
    if (!P.day && hash01(x + z) > 0.3) {
      B.add('glow', T.sphere(8, 4), [x, 131, z], [6, 3, 6], null, '#fff0d8', { emissive: 2.6, uv: atlasUV('white'), noAO: true, noJitter: true });
      const [wx, wy] = toWorld(o, x, z);
      P.halos.push({ x: wx, y: wy, h: 130, color: '#fff0d8', size: 90, strength: 0.35 });
    }
  }
}

/** The hall: tube lights, the trophy case, bulletin boards, EXIT signs, a mop bucket, a barricade of desks. */
function hall(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let x = -w / 2 + 60; x < w / 2; x += 160) tubeFixture(B, P.halos, x, 114, 0, 0, hash01(x) < 0.3 ? 'dead' : hash01(x + 1) < 0.25 ? 'flicker' : 'lit');
  // the trophy case on the south wall
  const zs = h / 2 - 7;
  B.box('std', 260, 50, zs - 9, 90, 60, 14, '#6a4a30', null, WOOD);
  B.box('vglass', 260, 56, zs - 16.4, 84, 44, 0.4, '#a8b8c0', null, GLASS);
  for (let k = 0; k < 6; k++) B.cyl('std', 230 + k * 12, 40, zs - 9, 2.4, 10 + (k % 3) * 4, '#d8b040', 8, 0.6, null, S(0, 0.25, 0.9));
  // bulletin boards, kids' drawings, EXIT signs
  for (const x of [-420, -60, 420]) { B.box('std', x, 64, zs - 1, 60, 40, 1.4, '#a8804a', null, FABRIC); sign(B, 'hc_kids', x, 64, zs - 2, 56, 28, PI); }
  for (const x of [-w / 2 + 30, w / 2 - 30]) {
    B.box(P.day ? 'std' : 'glow', x, 104, 0, 18, 7, 2, P.day ? '#c83a2a' : '#ff3a2a', null, P.day ? PLAST : { emissive: 2.4, uv: atlasUV('white'), noAO: true });
  }
  // the barricade of desks pushed against the gym doors, the mop bucket
  for (let k = 0; k < 5; k++) B.add('std', T.box(), [-w / 2 + 40 + r.range(0, 30), 10 + k * 7, r.range(-30, 30)], [22, 2, 16], [r.range(-0.4, 0.4), r.range(0, 6), r.range(-0.4, 0.4)], '#c8b08a', WOOD);
  B.cyl('std', 100, 0, -40, 8, 14, '#e0b020', 12, 1, null, PLAST);
  litter(B, -w / 2 + 20, -h / 2 + 10, w / 2 - 20, h / 2 - 10, P.lod >= 1 ? 30 : 10, 0.6, { cans: false });
  if (P.lod >= 1) { floorDecal(B, 'blood1', 380, 0, 60, 60, 0.4, 0.62); decal(B, 'blood2', 360, 50, -h / 2 + 7.2, 40, 50, 0); }
}

// ---- the police station -----------------------------------------------------------------------------------------------

/** The sally port's gate (the gate): a heavy sliding gate of bars on a braced frame, razor wire on top. */
function sallybars(P) {
  const { B, L } = P;
  const H = 110, c = '#4a5258';
  const mo = { noJitter: true, ...S(DET.panel, 0.45, 0.75) };
  for (const y of [4, 55, H - 3]) B.box('std', 0, y, 0, L, 5, 4, c, null, mo);
  for (const x of [-L / 2 + 2, L / 2 - 2]) B.box('std', x, H / 2, 0, 5, H, 4, c, null, mo);
  for (let x = -L / 2 + 8; x < L / 2 - 4; x += 7) B.add('std', T.cyl(6), [x, H / 2, 0], [1, H - 4, 1], null, c, { ...mo, map: 'cyl' });
  for (const s of [-1, 1]) plank(B, 'std', [s * (L / 2 - 4), 6, 2.4], [0, H - 6, 2.4], 4, 2, c, mo);
  if (P.lod >= 1) for (let x = -L / 2 + 8; x < L / 2; x += 14) B.add('std', T.torus(8, 0.05, 3), [x, H + 6, 0], [8, 8, 8], [0, HALF + 0.2, 0], '#8a8e92', CHROME);
  for (const s of [-1, 1]) B.cyl('std', s * (L / 2 - 24), 0, 3, 3.6, 3, '#1a1a1a', 10, 1, [HALF, 0, 0], METAL);
}

/** The sally port's frame: steel posts, the sign facing the school side, a camera, amber lamps, the track. */
function sallyframe(P) {
  const { B, o, halos } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 + 10);
    B.box('std', x, 70, 0, 12, 140, 12, '#3a3e42', null, METAL);
    B.box('std', x, 141, 0, 16, 2, 16, '#2a2c2e', null, METAL);
    if (P.day) B.add('std', T.sphere(6, 4), [x, 146, 0], [3, 3, 3], null, '#8a6a20', S(0, 0.3, 0));
    else {
      B.add('blink', T.sphere(6, 4), [x, 146, 0], [3, 3, 3], null, '#ffb020', { emissive: 3 });
      const [wx, wy] = toWorld(o, x, 0);
      halos.push({ x: wx, y: wy, h: 146, color: '#ffb020', size: 56, blink: 1, strength: 0.6 });
    }
  }
  B.box('std', 0, 150, 0, w + 34, 8, 8, '#3a3e42', null, METAL);
  B.box('std', 0, 170, -2, 110, 40, 2, '#f0eee6', null, METAL);
  sign(B, 'hc_sally', 0, 170, -3.2, 106, 39, PI);
  B.rblock('std', w / 2 + 10, 128, -10, 8, 6, 14, 1, '#e8e8e0', [0, 0.4, 0.3], PLAST);
  B.box('std', 0, 0.6, 0, w * 2.1, 1.2, 5, '#3a3c3e', null, RUSTY);
  B.cyl('std', -w / 2 - 40, 0, -30, 2, 46, '#3a3e42', 8, 1, null, METAL);
  B.rblock('std', -w / 2 - 40, 46, -30, 10, 14, 6, 1, '#2a2c2e', null, METAL);
}

/** The cells: steel bunks, a toilet and sink, a mattress, tally marks, a dropped tray. */
function cells(P) {
  const { B } = P;
  const r = B.rng;
  for (const x of [-167, 0, 162]) {
    B.box('std', x, 26, -60, 70, 3, 26, '#8a8e92', null, METAL);
    B.box('std', x, 30, -60, 64, 5, 22, r.pick(['#3a5a8a', '#6a6a5a', '#8a7a4a']), null, FABRIC);
    B.box('std', x, 52, -60, 70, 2, 26, '#8a8e92', null, METAL);
    if (r.chance(0.6)) B.add('std', T.pillow(8, 6, 0.4), [x + r.range(-20, 20), 4, -20 + r.range(-10, 10)], [24, 3, 14], [0, r.range(0, 6), 0], '#6a6a5a', FABRIC);
    B.rblock('std', x + 50, 0, -56, 18, 26, 22, 4, '#c8ccce', null, CHROME);
    B.cyl('std', x + 50, 26, -50, 6, 2, '#b8bcc0', 12, 1, null, CHROME);
    decal(B, 'xcode', x - 10, 80, -73.6, 30, 30, 0);
    if (r.chance(0.5)) floorDecal(B, 'blood3', x, -10, 40, 34, r.range(0, 6), 0.62);
  }
}

/** A steel gun cabinet (facing local +z): wire-mesh doors hanging open, empty racks, a rifle or two left. */
function gunrack(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const H = 86;
  B.box('std', 0, H / 2, -D / 2 + 2, L, H, 4, '#5a6268', null, METAL);
  for (const y of [0, H]) B.box('std', 0, y + (y ? -1 : 1), 0, L, 2, D, '#4a5258', null, METAL);
  for (let x = -L / 2; x <= L / 2 + 0.1; x += L / Math.round(L / 60)) B.box('std', x, H / 2, 0, 2, H, D, '#4a5258', null, METAL);
  B.box('std', 0, 18, 2, L - 4, 2, D - 6, '#3a3e42', null, METAL);
  for (let x = -L / 2 + 10; x < L / 2 - 6; x += 9) {
    if (r.chance(0.82)) { B.box('std', x, 20.4, 4, 2, 2.4, 6, '#2a2c2e', null, METAL); continue; }
    B.add('std', T.box(), [x, 48, 3], [2.4, 60, 3], [0, 0, r.range(-0.08, 0.08)], '#1a1a1a', S(DET.panel, 0.4, 0.6));
    B.box('std', x, 26, 3, 3, 14, 4, '#5a3a22', null, WOOD);
  }
  for (const y of [60, 74]) B.box('std', 0, y, -D / 2 + 8, L - 4, 1.2, 10, '#3a3e42', null, METAL);
  for (let k = 0; k < 6; k++) if (r.chance(0.5)) B.rblock('std', r.range(-L / 2 + 10, L / 2 - 10), 61.2, -D / 2 + 8, 10, 6, 7, 0.4, '#3a4a2a', null, METAL);
  if (P.lod >= 1) B.add('fence', T.plane(), [-L / 2 + 30 - Math.cos(1.2) * 0, H / 2, D / 2 + 26], [56, H - 4, 1], [0, -1.2, 0], '#6a7074', { uvScale: [4, 6] });
}

/** The armory: a workbench with a vise, ammo crates, a vest on a hook, the sign, a cleaning kit. */
function armory(P) {
  const { B } = P;
  const r = B.rng;
  B.rblock('std', -150, 0, 60, 90, 34, 30, 1, '#6a5a48', null, WOOD);
  B.box('std', -150, 34.6, 60, 92, 1.2, 32, '#8a7a62', null, WOOD);
  B.rblock('std', -190, 35, 60, 10, 8, 8, 1, '#2a4a8a', null, METAL);
  for (let k = 0; k < 5; k++) B.rblock('std', -40 + k * 14 + r.range(-3, 3), 0, 70 + r.range(-6, 6), 12, 9, 18, 0.5, '#3a4a2a', [0, r.range(-0.2, 0.2), 0], METAL);
  for (let k = 0; k < 3; k++) B.rblock('std', -26 + k * 14, 9, 70, 12, 9, 18, 0.5, '#3a4a2a', null, METAL);
  B.rblock('std', 120, 50, -100, 26, 30, 6, 4, '#1a1a1c', null, FABRIC);
  sign(B, 'hc_sally', 0, 100, -116.6, 60, 22, 0);
  for (let i = 0; i < 40; i++) B.add('std', T.cyl(6), [r.range(-200, 160), 0.6, r.range(-80, 120)], [0.7, 2.4, 0.7], [HALF, r.range(0, 6), 0], '#c8a040', { ...S(0, 0.3, 0.9), map: 'cyl' });
}

/** Booking: the desk with its computer, the fingerprint pad; the height chart and camera for mugshots. */
function booking(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 40, D, 1, '#6a6e72', null, METAL);
  B.box('std', 0, 41, 0, L + 3, 2, D + 3, '#c8c4b8', null, S(0, 0.4, 0));
  crt(B, -L * 0.25, 42, -4, PI);
  B.rblock('std', L * 0.2, 42, 0, 10, 3, 8, 0.5, '#1a1a1a', null, METAL);
  // the height chart on the wall behind, the camera on its tripod
  const zw = -o.h / 2 - 118;
  for (let k = 0; k < 8; k++) B.box('std', 30, 20 + k * 10, zw, 50, 0.6, 0.4, k % 2 ? '#1a1a1a' : '#5a5a5a', null, NJ);
  B.box('std', 30, 60, zw - 0.6, 56, 90, 0.4, '#e8e4d8', null, NJ);
  for (const a of [0, 2.1, 4.2]) rod(B, 'std', [30 + Math.cos(a) * 8, 0, zw + 70 + Math.sin(a) * 8], [30, 46, zw + 70], 0.5, '#2a2a2a', METAL, 3);
  B.rblock('std', 30, 46, zw + 70, 8, 6, 10, 1, '#1a1a1a', null, METAL);
}

/** The front desk behind bulletproof glass: the radio console, the logbook, the corkboard behind it. */
function frontdesk(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 42, D, 1, '#5a4a3a', null, WOOD);
  B.box('std', 0, 43, 0, L + 4, 2, D + 4, '#c8c0a8', null, S(0, 0.4, 0));
  B.box('vglass', 0, 70, D / 2 - 2, L, 52, 1.2, '#a8bcc4', null, GLASS);
  for (const s of [-1, 1]) B.box('std', s * L / 2, 70, D / 2 - 2, 3, 54, 3, '#3a3c3e', null, METAL);
  B.rblock('std', -L * 0.25, 44, -4, 40, 12, 18, 1, '#2a2c2e', null, METAL);
  for (let k = 0; k < 4; k++) B.box(P.day ? 'std' : 'glow', -L * 0.25 - 14 + k * 9, 52, 5.4, 6, 3, 0.4, P.day ? '#2a3a2a' : '#6aff8a', null, P.day ? NJ : { emissive: 1.6, uv: atlasUV('white'), noAO: true });
  crt(B, L * 0.2, 44, -2, PI);
  B.box('std', 0, 76, -D / 2 - 66, 120, 90, 1.4, '#a8804a', null, FABRIC);
  sign(B, 'hc_wanted', 0, 76, -D / 2 - 65, 116, 87, 0);
}

/** A desk in the bullpen: the monitor, the phone off the hook, files, a mug, the chair pushed back. */
function copdesk(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.rblock('std', 0, 0, 0, L, 28, D, 1, '#6a6e72', null, METAL);
  B.box('std', 0, 28.6, 0, L + 2, 1.2, D + 2, '#8a7a62', null, WOOD);
  crt(B, -L * 0.2, 29.2, -6, 0);
  B.rblock('std', L * 0.25, 29.2, -8, 10, 3, 8, 1, '#1a1a1a', null, PLAST);
  B.add('std', T.box(), [L * 0.3, 29.6, 6], [8, 2, 2.6], [0, 0.6, 0], '#1a1a1a', PLAST);
  for (let k = 0; k < 3; k++) B.box('std', L * 0.05 + r.range(-6, 6), 29.4 + k * 1.2, 8, 10, 1, 13, r.pick(['#d8c890', '#e8e4d8', '#c8b080']), [0, r.range(-0.3, 0.3), 0], NJ);
  B.cyl('std', L * 0.38, 29.2, 10, 2, 4.4, '#e8e4dc', 10, 1, null, S(0, 0.4, 0));
  chair(B, 0, D / 2 + 14, 0, r.chance(0.3));
}

/** The station round its rooms: the lettering over the doors, tube lights, the flag and seal in the lobby, the
 *  water cooler, filing cabinets pushed across the hall, papers and blood. */
function station(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  // the lettering over the front doors (outside the south wall)
  B.box('std', 350, 112, h / 2 + 7.6, 260, 24, 1.4, '#3a3c3e', null, METAL);
  sign(B, 'hc_police', 350, 112, h / 2 + 8.6, 256, 48, 0);
  sign(B, 'hc_badge', 350, 84, h / 2 + 8.6, 22, 22, 0);
  // tube lights through the rooms
  for (let x = -w / 2 + 90; x < w / 2; x += 170) for (const z of [-200, 40, 200]) tubeFixture(B, P.halos, x, 118, z, 0, hash01(x * 5 + z) < 0.25 ? 'dead' : hash01(x + z * 3) < 0.25 ? 'flicker' : 'lit');
  // the lobby: the flag on a stand, the seal on the wall, a bench, the water cooler
  B.cyl('std', 470, 0, h / 2 - 40, 1.4, 90, '#c8a040', 8, 1, null, S(0, 0.3, 0.8));
  B.add('lvsign', T.plane(), [482, 76, h / 2 - 40], [24, 16, 1], [0, 0.2, 0.1], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
  B.add('lvsign', T.plane(), [482, 76, h / 2 - 40], [24, 16, 1], [0, 0.2 + PI, -0.1], '#ffffff', { uv: lvUV('hc_flag'), noAO: true, noJitter: true });
  sign(B, 'hc_badge', w / 2 - 7.6, 80, 200, 36, 36, -HALF);
  plank(B, 'std', [200, 16, h / 2 - 20], [300, 16, h / 2 - 20], 12, 2.4, '#6a4a30', WOOD);
  B.rblock('std', w / 2 - 20, 0, 230, 14, 30, 14, 1, '#e8e4dc', null, PLAST);
  B.cyl('std', w / 2 - 20, 30, 230, 6, 14, '#8ab8e0', 12, 1, null, GLASS);
  // filing cabinets pushed across the hall, papers, the blood trail to the cells
  for (let k = 0; k < 3; k++) B.add('std', T.box(), [-200 + k * 22, 26, 40 + r.range(-10, 10)], [18, 52, 22], [0, r.range(-0.3, 0.3), k === 1 ? 1.3 : 0], '#8a8e92', METAL);
  for (let k = 0; k < (P.lod >= 1 ? 40 : 12); k++) B.box('std', r.range(-w / 2 + 20, w / 2 - 20), 0.7, r.range(-h / 2 + 20, h / 2 - 20), 8, 0.3, 11, r.pick(['#f0ece0', '#e8e4d8', '#f2e08a']), [0, r.range(0, 6), 0], NJ);
  if (P.lod >= 1) for (let k = 0; k < 8; k++) floorDecal(B, 'blood3', -400 + k * 30, 40 + Math.sin(k) * 10, 18, 12, r.range(0, 6), 0.62);
}

/** The prisoner transport van: the world's van in black and white, POLICE, the light bar, caged windows. */
function copvan(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  buildVehicle(B, { ...o, color: '#16181c' });
  for (const sd of [-1, 1]) {
    B.box('paint', -0.1 * L, 30, sd * (W / 2 + 0.2), 0.6 * L, 20, 0.6, '#eceae4', null, { surf: [DET.panel, 0.4, 0.3] });
    sign(B, 'hc_cruiser', -0.1 * L, 31, sd * (W / 2 + 0.6), 0.56 * L, 14, sd > 0 ? 0 : PI);
  }
  B.rblock('std', 0.2 * L, 66, 0, 8, 3, W * 0.7, 0.6, '#1a1a1a', null, METAL);
  for (const [z, c] of [[-W * 0.17, '#5a1a14'], [W * 0.17, '#1a2a5a']]) B.rbox('std', 0.2 * L, 70, z, 7, 3, W * 0.26, 1, c, null, S(0, 0.2, 0.1));
}

/** The station's monument sign (facing local +z). */
function policesign(P) {
  const { B } = P;
  B.rblock('std', 0, 0, 0, 170, 40, 24, 1, '#9a7a60', null, BRICK);
  B.rblock('std', 0, 40, 0, 176, 4, 28, 1, '#a8a498', null, CONC);
  B.box('std', 0, 22, 12.4, 160, 30, 0.6, '#2a2c2e', null, METAL);
  sign(B, 'hc_police', 0, 22, 12.9, 154, 29, 0);
  sign(B, 'hc_police', 0, 22, -12.4, 154, 29, PI);
  B.rblock('std', 0, 0, 34, 180, 5, 30, 2, '#5a4a36', null, { noJitter: true, surf: [DET.dirt, 0.95, 0] });
}

/** The school's front (the south wall, outside): the entrance canopy on posts, the name in letters over it, the
 *  hornet painted on the gym, a bike rack, the drop-off kerb's paint. */
function schoolfront(P) {
  const { B, o } = P;
  const w = o.w;
  const z0 = 8;
  const xe = -160;                 // the glass doors
  B.box('std', xe, 104, z0 + 40, 170, 5, 80, '#e8e4dc', null, S(DET.panel, 0.5, 0.2));
  B.box('std', xe, 100, z0 + 80, 172, 8, 2, '#1a3a6a', null, METAL);
  for (const x of [xe - 80, xe + 80]) B.cyl('std', x, 0, z0 + 76, 2.4, 100, '#e8e4dc', 10, 1, null, METAL);
  B.box('std', xe, 128, z0 + 0.8, 220, 26, 1.2, '#efe8d6', null, S(0, 0.6, 0));
  B.add('lvsign', T.plane(), [xe, 128, z0 + 1.6], [216, 24, 1], null, '#ffffff', { uv: lvSub('hc_school', 0, 0.56, 1, 1), noAO: true, noJitter: true });
  // the hornet on the gym's wall, a bike rack, a bench
  B.add('lvsign', T.plane(), [-650, 114, z0 + 0.8], [60, 60, 1], null, '#ffffff', { uv: lvUV('hc_hornet'), noAO: true, noJitter: true });
  for (let k = 0; k < 6; k++) B.add('std', T.torus(10, 0.06, 4), [xe + 140 + k * 10, 12, z0 + 30], [10, 10, 10], null, '#2a5ab0', METAL);
  B.box('std', xe + 165, 2, z0 + 30, 64, 1.4, 4, '#2a5ab0', null, METAL);
  B.rblock('std', 160, 0, z0 + 24, 70, 16, 18, 1, '#6a4a30', null, WOOD);
  B.box('std', 0, 0.5, z0 + 120, w * 0.6, 0.4, 3, '#e8c020', null, NJ);
}

/** Models by obstacle style or prop name: fn(P), P the kit's model context (createKitArt). */
export const SCHOOL_MODELS = {
  'hc-schoolfront': schoolfront,
  'hc-schoolbus': schoolbus, 'hc-schoolsign': schoolsign, 'hc-flag': flag, 'hc-portable': portable, 'hc-dumpster': dumpster, 'hc-hoop': hoop,
  'hc-lockers': lockers, 'hc-classroom': classroom, 'hc-officecounter': officecounter, 'hc-office': office, 'hc-bleachers': bleachers, 'hc-gym': gym,
  'hc-hall': hall, 'hc-sallyframe': sallyframe, 'hc-cells': cells, 'hc-gunrack': gunrack, 'hc-armory': armory, 'hc-booking': booking,
  'hc-frontdesk': frontdesk, 'hc-copdesk': copdesk, 'hc-station': station, 'hc-copvan': copvan, 'hc-policesign': policesign,
};
/** Gate models by style, drawn in the gate obstacle's frame (the engine animates them open). */
export const SCHOOL_GATES = { 'hc-schoolpanel': schoolpanel, 'hc-sallybars': sallybars };
void [RUSTY, mixHex, sign2, carton, CONC];
