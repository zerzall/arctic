// Blackpine, sections 3 and 4: the ranger station (its counter, the radio desk and the topo map, the station's
// porch, stove, bunks and gear, the radio mast, the sign, the fire lookout on its tower, the ranger's truck,
// the fuel tank, the generator shed, the helipad, the rockfall over the trail down) and Cutter's Gorge (the
// swinging footbridge, its winch, the road bridge down in the river, the rapids, the boulders, the signs, the
// mill's gate).

import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CONC, FABRIC, PLAST, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, decal, floorDecal, carton, toWorld, lvUV, litter, pendant, tubeFixture, glowBox,
} from './millroad-kit.js';
import { building } from '../world-bld.js';
import { buildVehicle } from '../world-veh.js';

const GLASS = { noJitter: true, surf: [0, 0.06, 0] };
const BARK = { noJitter: true, surf: [DET.bark, 0.9, 0] };
const ROCK = { noJitter: true, surf: [DET.rock, 0.92, 0] };
const STEEL = '#8a9296';

/** A rough rock (a squashed dodecahedron). */
function rock(B, x, y, z, s, color = '#6e6a60', squash = 0.7) {
  const r = B.rng;
  B.add('std', T.dodeca(), [x, y, z], [s * r.range(0.9, 1.2), s * squash * r.range(0.8, 1.1), s * r.range(0.8, 1.1)], [r.range(-0.4, 0.4), r.range(0, 6), r.range(-0.4, 0.4)], mixHex(color, '#8a8478', r.next() * 0.4), ROCK);
}

/** A fallen pine: the trunk on the ground, a few dead limbs, the root plate. */
function fallenPine(B, x, z, len, a, y = 0) {
  const r = B.rng;
  const c = Math.cos(a), s = Math.sin(a);
  B.add('std', T.cyl(8, 0.6), [x, y + 8, z], [8, len, 8], [0, -a, HALF], '#5a4632', { ...BARK, map: 'cyl' });
  B.add('std', T.cyl(10, 0.5), [x - c * len / 2, y + 16, z + s * len / 2], [24, 6, 24], [0, -a, HALF], '#4a3a2a', BARK);
  for (let k = 0; k < 6; k++) {
    const t = r.range(-0.3, 0.5), px = x + c * len * t, pz = z - s * len * t;
    rod(B, 'std', [px, y + 10, pz], [px + r.range(-20, 20), y + r.range(14, 30), pz + r.range(-20, 20)], 1.2, '#4a3a2a', BARK, 4);
  }
}

// ---- the ranger station ------------------------------------------------------------------------------------

function rcounter(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 40, D, 1, '#8a6440', null, WOOD);
  B.box('std', 0, 41, 0, L + 4, 2, D + 4, '#a8845a', null, WOOD);
  B.cyl('std', -L * 0.3, 42, 4, 2, 2, '#c8a040', 10, 0.5, null, CHROME);
  for (let k = 0; k < 6; k++) B.box('std', L * 0.1 + (k % 3) * 8, 46, -4 + Math.floor(k / 3) * 4, 6, 9, 1, ['#2a6a3a', '#c86a1a', '#2a5ab0'][k % 3], [-0.2, 0, 0], NJ);
  sign(B, 'bp_bear', 0, 20, D / 2 + 0.6, 22, 27.5, 0);
}

/** The radio desk: the base station, the mic, the logbook; the topo map with its pins on the wall behind. */
function radiodesk(P) {
  const { B, o, halos } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 30, D, 1, '#6a5a48', null, WOOD);
  B.box('std', 0, 31, 0, L + 2, 2, D + 2, '#8a7058', null, WOOD);
  B.rblock('std', -L * 0.2, 32, -4, 52, 20, 22, 1, '#2a2c2e', null, METAL);
  B.add(P.day ? 'lvsign' : 'lvglow', T.plane(), [-L * 0.2, 42, 7.2], [50, 18.75, 1], null, '#ffffff', { uv: lvUV('bp_radio'), noAO: true, noJitter: true });
  B.cyl('std', L * 0.05, 32, 4, 3, 2, '#1a1a1a', 8, 1, null, METAL);
  rod(B, 'std', [L * 0.05, 34, 4], [L * 0.05 + 2, 44, 2], 0.5, '#1a1a1a', METAL, 4);
  B.add('std', T.sphere(6, 4), [L * 0.05 + 2, 46, 2], [2, 3, 2], null, '#1a1a1a', METAL);
  B.box('std', L * 0.3, 33, 2, 24, 2, 18, '#2a4a2e', [0, 0.2, 0], FABRIC);
  sign(B, 'bp_topo', 0, 80, -D / 2 - 12.4, 80, 60, 0);
  if (!P.day) { const [wx, wy] = toWorld(o, -L * 0.2, 10); halos.push({ x: wx, y: wy, h: 44, color: '#6aff8a', size: 30, strength: 0.4 }); }
}

/** The station round its rooms: the porch and its roof, the sign, the stove and its pipe, bunks, gear on hooks. */
function station(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  const zf = h / 2 + 7;
  // the porch: a deck along the front, posts, a lean-to roof, the steps
  B.box('std', 0, 4, zf + 28, w - 60, 8, 56, '#7a5a3a', null, WOOD);
  for (const x of [-w / 2 + 40, -40, 80, w / 2 - 40]) B.add('std', T.cyl(8), [x, 64, zf + 52], [5, 120, 5], null, '#6a4a30', { ...BARK, map: 'cyl' });
  B.add('std', T.box(), [0, 124, zf + 30], [w - 40, 3, 70], [0.25, 0, 0], '#3a4a3a', { noJitter: true, surf: [DET.metalroof, 0.6, 0.35] });
  B.box('std', 25, 106, zf + 1, 200, 50, 2, '#5a3a22', null, WOOD);
  sign(B, 'bp_ranger', 25, 106, zf + 2.2, 196, 49, 0);
  // the woodstove and its pipe up through the roof, a woodbox
  B.rblock('std', 120, 0, -h / 2 + 40, 34, 34, 28, 3, '#1a1a1a', null, METAL);
  B.cyl('std', 120, 34, -h / 2 + 40, 4, 120, '#1a1a1a', 8, 1, null, METAL);
  B.cyl('std', 120, 154, -h / 2 + 40, 6, 10, '#1a1a1a', 8, 1, null, METAL);
  B.box('std', 160, 14, -h / 2 + 34, 30, 28, 22, '#6a4a30', null, WOOD);
  // bunks in the east room, gear on hooks along the west wall of the office
  for (const z of [-60, 40]) {
    for (const y of [16, 62]) { B.box('std', w / 2 - 34, y, z, 50, 3, 80, '#6a5a48', null, WOOD); B.box('std', w / 2 - 34, y + 3, z, 44, 4, 74, r.pick(['#3a5a3a', '#6a2a2a', '#2a3a5a']), null, FABRIC); }
    for (const [dx, dz] of [[-24, -38], [24, -38], [-24, 38], [24, 38]]) B.box('std', w / 2 - 34 + dx, 40, z + dz, 3, 80, 3, '#5a4a38', null, WOOD);
  }
  for (let k = 0; k < 5; k++) {
    const x = -50 + k * 22;
    B.box('std', x, 90, -h / 2 + 9, 2, 2, 6, '#2a2a2a', null, METAL);
    if (k % 2) B.add('std', T.sphere(8, 6), [x, 82, -h / 2 + 14], [9, 6, 9], null, r.pick(['#e8c020', '#c8641c']), PLAST);
    else plank(B, 'std', [x, 88, -h / 2 + 12], [x + 4, 30, -h / 2 + 14], 2, 2, '#8a6a48', WOOD);
  }
  B.cyl('std', -10, 0, h / 2 - 20, 5, 22, '#c62828', 10, 1, null, METAL);
  for (const x of [-w / 4, w / 6]) {
    const [wx, wy] = toWorld(o, x, 0);
    pendant(B, P.day ? null : P.halos, x, 110, 0, wx, wy, '#ffd9a0', !P.day);
  }
  litter(B, -w / 2 + 20, -h / 2 + 20, w / 2 - 20, h / 2 - 20, P.lod >= 1 ? 18 : 6, 0.6);
  floorDecal(B, 'blood1', -20, 60, 50, 50, 0.8, 0.6);
}

/** The radio mast: a lattice tower with whips and a dish, guy wires, a red beacon on top. */
function radiomast(P) {
  const { B, o, halos } = P;
  const H = 300, d = 9;
  for (const [x, z] of [[-d, -d], [d, -d], [d, d], [-d, d]]) B.box('std', x * 0.6, H / 2, z * 0.6, 1.6, H, 1.6, '#c8ccce', null, CHROME);
  for (let y = 10; y < H; y += 24) for (let f = 0; f < 4; f++) {
    const a = (f * PI) / 2, c = Math.cos(a), s = Math.sin(a);
    rod(B, 'std', [c * 5.4 - s * 5.4, y, s * 5.4 + c * 5.4], [c * 5.4 + s * 5.4, y + 24, s * 5.4 - c * 5.4], 0.4, '#c8ccce', CHROME, 3);
  }
  for (const y of [180, 240, 290]) rod(B, 'std', [-30, y, 0], [30, y, 0], 0.6, '#c8ccce', CHROME, 3);
  B.add('std', T.cyl(14, 1, true), [8, 220, 0], [10, 2, 10], [0, 0, HALF], '#e8e8e4', METAL);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * PI * 2 + 0.5; rod(B, 'std', [0, H * 0.75, 0], [Math.cos(a) * 140, 0, Math.sin(a) * 140], 0.2, '#6a6e72', CHROME, 3); }
  if (P.day) B.add('std', T.sphere(6, 4), [0, H + 4, 0], [3, 3, 3], null, '#6a1a14', S(0, 0.2, 0));
  else {
    B.add('blink', T.sphere(6, 4), [0, H + 4, 0], [3, 3, 3], null, '#ff2a1a', { emissive: 3 });
    const [wx, wy] = toWorld(o, 0, 0); halos.push({ x: wx, y: wy, h: H + 4, color: '#ff3a1a', size: 50, blink: 1, strength: 0.7 });
  }
}

function rangersign(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * 74, 55, 0], [7, 110, 7], null, '#6a4a30', { ...BARK, map: 'cyl' });
  B.box('std', 0, 66, 0, 140, 38, 5, '#5a3a22', null, WOOD);
  sign(B, 'bp_ranger', 0, 66, 2.7, 136, 34, 0);
  sign(B, 'bp_ranger', 0, 66, -2.7, 136, 34, PI);
  B.rblock('std', 0, 0, 0, 170, 8, 30, 2, '#6a665e', null, ROCK);
}

/** The fire lookout: a steel tower with X-braced panels and a zigzag stair inside, the cab on top with windows
 *  all round, its catwalk and pyramid roof, a lightning rod; a lamp in the cab at night. */
function lookout(P) {
  const { B, o, halos } = P;
  const H = 520, b0 = 55, b1 = 30;
  const steel = '#9aa4a8';
  const mo = S(DET.panel, 0.5, 0.55);
  const legAt = (sx, sz, y) => [sx * (b0 + (b1 - b0) * (y / H)), y, sz * (b0 + (b1 - b0) * (y / H))];
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) {
    rod(B, 'std', legAt(sx, sz, 0), legAt(sx, sz, H), 2.6, steel, mo, 8);
    B.rblock('std', sx * b0, 0, sz * b0, 20, 10, 20, 1, '#a8a498', null, CONC);
  }
  const panel = P.lod === 0 ? 104 : 65;
  for (let y = 0; y < H - 1; y += panel) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
      const a0 = legAt(ax, az, y), b0p = legAt(bx, bz, y), a1 = legAt(ax, az, y + panel), b1p = legAt(bx, bz, y + panel);
      rod(B, 'std', a0, b0p, 1.2, steel, mo, 4);
      rod(B, 'std', a0, b1p, 0.6, steel, mo, 3);
      rod(B, 'std', b0p, a1, 0.6, steel, mo, 3);
    }
    // a flight of the stair and its landing inside the tower
    const w = b0 + (b1 - b0) * (y / H) - 10;
    const dir = Math.round(y / panel) % 2 ? 1 : -1;
    plank(B, 'std', [-dir * w * 0.7, y + 2, -6], [dir * w * 0.7, y + panel - 2, -6], 14, 1.4, '#6a6e72', METAL, 0);
    B.box('std', dir * w * 0.75, y + panel, -6, 20, 1.4, 24, '#6a6e72', null, METAL);
  }
  // the cab: floor, walls below the sill, windows all round, roof, the catwalk and railing
  const y0 = H, cw = 74;
  B.box('std', 0, y0, 0, cw + 30, 4, cw + 30, '#6a6e72', null, METAL);
  for (let f = 0; f < 4; f++) {
    const ry = (f * PI) / 2, c = Math.cos(ry), s = Math.sin(ry);
    const at = (x, z) => [x * c + z * s, -x * s + z * c];
    const [px, pz] = at(0, cw / 2);
    B.add('std', T.box(), [px, y0 + 18, pz], [cw, 32, 3], [0, ry, 0], '#d8d4c8', S(DET.siding, 0.8, 0));
    B.add('glass', T.box(), [px, y0 + 52, pz], [cw - 4, 36, 0.6], [0, ry, 0], '#8aa0aa', S(0, 0.06, 0.2));
    for (const k of [-1, 0, 1]) { const [qx, qz] = at(k * cw / 3, cw / 2 + 0.5); B.add('std', T.box(), [qx, y0 + 52, qz], [2, 36, 2], [0, ry, 0], '#e8e4dc', PLAST); }
    const [rx, rz] = at(0, cw / 2 + 14);
    B.add('std', T.box(), [rx, y0 + 26, rz], [cw + 28, 2, 2], [0, ry, 0], steel, mo);
    for (const k of [-2, -1, 0, 1, 2]) { const [qx, qz] = at(k * (cw + 28) / 4, cw / 2 + 14); B.add('std', T.box(), [qx, y0 + 13, qz], [1.4, 26, 1.4], [0, ry, 0], steel, mo); }
  }
  B.add('std', T.cyl(4, 0.02), [0, y0 + 84, 0], [cw * 0.82, 26, cw * 0.82], [0, PI / 4, 0], '#3a4a3a', { noJitter: true, surf: [DET.metalroof, 0.6, 0.35] });
  rod(B, 'std', [0, y0 + 96, 0], [0, y0 + 124, 0], 0.5, '#8a8e92', CHROME, 4);
  B.rblock('std', 0, y0 + 2, 0, 18, 30, 18, 1, '#6a5a48', null, WOOD);
  if (!P.day) {
    B.add('glow', T.box(), [0, y0 + 60, 0], [cw - 8, 30, cw - 8], null, '#ffd090', { emissive: 0.9, uv: atlasUV('white'), noAO: true, noJitter: true });
    const [wx, wy] = toWorld(o, 0, 0);
    halos.push({ x: wx, y: wy, h: y0 + 56, color: '#ffd090', size: 160, strength: 0.35 });
  }
}

/** The ranger's truck: the world's pickup in forestry green, a white stripe and the shield, an amber bar, the
 *  slip-on tank and hose reel in the bed. */
function rangertruck(P) {
  const { B, o, halos } = P;
  const L = o.w, W = o.h;
  buildVehicle(B, { ...o, kind: 'pickup' });
  for (const sd of [-1, 1]) {
    B.box('paint', 0.1 * L, 24, sd * (W / 2 + 0.1), 0.3 * L, 4, 0.5, '#e8e4dc', null, { surf: [DET.panel, 0.4, 0.3] });
    sign(B, 'bp_ranger', 0.1 * L, 30, sd * (W / 2 + 0.4), 0.28 * L, 0.07 * L, sd > 0 ? 0 : PI);
  }
  B.rblock('std', 0.06 * L, 42, 0, 7, 2, W * 0.7, 0.6, '#1a1a1a', null, METAL);
  for (const z of [-W * 0.18, W * 0.18]) {
    if (P.day) B.rbox('std', 0.06 * L, 45.5, z, 6, 3, W * 0.26, 1, '#8a5a10', null, S(0, 0.2, 0.1));
    else { B.add('blink', T.box(), [0.06 * L, 45.5, z], [6, 3, W * 0.26], null, '#ffb020', { emissive: 3 }); const [wx, wy] = toWorld(o, 0.06 * L, z); halos.push({ x: wx, y: wy, h: 46, color: '#ffb020', size: 60, blink: 1, strength: 0.6 }); }
  }
  B.rblock('std', -0.3 * L, 22, 0, 0.26 * L, 16, W * 0.7, 2, '#c8c4b8', null, PLAST);
  B.add('std', T.cyl(12), [-0.18 * L, 42, 0], [8, 14, 8], [HALF, 0, 0], '#c62828', { ...METAL, map: 'cyl' });
}

function fueltank(P) {
  const { B, o } = P;
  const R = o.w / 2 - 2;
  B.rblock('std', 0, 0, 0, R * 2 + 10, 6, R * 2 + 10, 1, '#a8a498', null, CONC);
  B.cyl('std', 0, 6, 0, R, 84, o.color || '#c8c4b8', 18, 1, null, S(DET.panel, 0.5, 0.5));
  B.add('std', T.sphere(18, 6), [0, 90, 0], [R, 8, R], null, o.color || '#c8c4b8', S(DET.panel, 0.5, 0.5));
  for (let y = 10; y < 90; y += 9) B.box('std', R + 2, y, 0, 1, 1, 9, '#6a6e72', null, METAL);
  sign(B, 'mr_flammable', 0, 50, R + 0.6, 18, 18, 0);
  B.cyl('std', -R - 6, 0, 0, 2, 30, '#c62828', 8, 1, null, METAL);
}

/** The generator shed: the world's shack with its door open on the generator, the exhaust, the fuel cans. */
function genshed(P) {
  const { B, o } = P;
  building(B, o, o.w, o.h, null);
  const W = o.h;
  B.box('std', 0, 34, W / 2 + 0.6, 36, 66, 1, '#0c0c0e', null, NJ);
  B.rblock('std', 0, 0, W / 2 - 18, 34, 28, 24, 2, '#c8a020', null, METAL);
  B.cyl('std', 30, 80, -W / 2 + 10, 3, 60, '#3a3a3a', 8, 1, null, RUSTY);
  for (let k = 0; k < 3; k++) B.rblock('std', 30 + k * 10, 0, W / 2 + 14, 8, 14, 12, 1, '#c8281e', null, PLAST);
}

/** The helipad's H, its edge lights, the windsock. */
function helipad(P) {
  const { B, o, halos } = P;
  B.add('lvdecal', T.plane(), [0, 0.6, 0], [180, 180, 1], [-HALF, 0, 0], '#ffffff', { uv: lvUV('bp_heli'), noAO: true, noJitter: true });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2, x = Math.cos(a) * 96, z = Math.sin(a) * 96;
    B.cyl('std', x, 0, z, 2.4, 4, '#2a2a2a', 8, 1, null, METAL);
    if (P.day) B.add('std', T.sphere(6, 4), [x, 5, z], [1.6, 1.6, 1.6], null, '#4a6a3a', S(0, 0.2, 0));
    else { B.add('glow', T.sphere(6, 4), [x, 5, z], [1.6, 1.6, 1.6], null, '#60ff80', { emissive: 2.6, uv: atlasUV('white'), noAO: true, noJitter: true }); const [wx, wy] = toWorld(o, x, z); halos.push({ x: wx, y: wy, h: 5, color: '#60ff80', size: 24, strength: 0.5 }); }
  }
  B.cyl('std', 130, 0, -80, 1.6, 90, '#c8ccce', 8, 1, null, CHROME);
  B.add('std', T.cyl(10, 0.4, true), [148, 86, -80], [5, 30, 5], [0, 0, -HALF + 0.2], '#e86a1a', { ...FABRIC, map: 'cyl' });
}

/** The rockfall across the trail down (the gate): a heap of boulders, broken rock, a pine down across it. */
function rockfall(P) {
  const { B, L } = P;
  const r = B.rng;
  for (let i = 0; i < (P.lod >= 1 ? 26 : 12); i++) {
    const x = r.range(-L / 2, L / 2), y = r.range(0, 80) * (1 - Math.abs(x) / L);
    rock(B, x, y + 10, r.range(-20, 20), r.range(20, 42), '#7a7468');
  }
  for (let i = 0; i < 20; i++) rock(B, r.range(-L / 2, L / 2), 2, r.range(-40, 40), r.range(4, 9), '#8a8478', 0.6);
  fallenPine(B, 10, -6, L * 0.9, 0.15, 50);
}

/** Beside the rockfall: scree into the cliffs, TRAIL CLOSED, a second pine. */
function rockfallside(P) {
  const { B, o } = P;
  const w = o.w, r = B.rng;
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) rock(B, s * (w / 2 + r.range(0, 60)), r.range(0, 40), r.range(-50, 50), r.range(16, 34), '#7a7468');
  B.cyl('std', -w / 2 - 20, 0, -60, 2, 60, '#5a3a22', 6, 1, null, WOOD);
  B.box('std', -w / 2 - 20, 54, -60, 50, 18, 2, '#e8e4dc', [0, 0, 0.12], WOOD);
  sign(B, 'hc_closed', -w / 2 - 20, 54, -61.2, 48, 17, PI, { rz: 0.12 });
  fallenPine(B, w / 2 + 40, -120, 260, 1.2, 0);
}

// ---- Cutter's Gorge --------------------------------------------------------------------------------------------

/** The swinging footbridge over the river (along local x, `len` long, deck `w` wide): timber towers on each
 *  bank, the main cables over them to their anchors, hangers, the plank deck sagging in the middle, hand lines. */
function footbridge(P) {
  const { B, o } = P;
  const len = o.len, w = o.w, r = B.rng;
  const span = 140;               // the towers stand at ±span
  const half = w / 2;
  const deckY = (x) => 7 - 6 * (1 - (x / span) ** 2) * (Math.abs(x) < span ? 1 : 0);
  // the deck: cross planks on two stringers, a gap or two
  for (const z of [-half + 8, half - 8]) for (let k = -10; k < 10; k++) {
    const x0 = (k / 10) * (span + 30), x1 = ((k + 1) / 10) * (span + 30);
    plank(B, 'std', [x0, deckY(x0) - 2, z], [x1, deckY(x1) - 2, z], 4, 5, '#4a3a2a', WOOD);
  }
  for (let x = -span - 30; x < span + 30; x += 6) {
    if (r.chance(0.03) && Math.abs(x) < span - 20) continue;
    B.box('std', x, deckY(x), r.range(-1, 1), 5, 1.8, w - 4, mixHex('#7a6248', '#5a4632', r.next()), [0, r.range(-0.02, 0.02), 0], WOOD);
  }
  // the towers: two timber A-frames each side, a cap beam
  for (const s of [-1, 1]) {
    const x = s * span;
    for (const z of [-half - 6, half + 6]) {
      rod(B, 'std', [x, 0, z], [x, 120, z], 5, '#5a4632', BARK, 8);
      rod(B, 'std', [x - s * 30, 0, z], [x, 110, z], 3, '#5a4632', BARK, 6);
    }
    B.box('std', x, 122, 0, 12, 10, w + 26, '#5a4632', null, WOOD);
    B.rblock('std', s * (len / 2 - 20), 0, 0, 40, 3, w + 30, 1, '#8a8478', null, CONC);
  }
  // the main cables (catenaries over the towers to the anchors), hangers, hand lines
  for (const z of [-half - 6, half + 6]) {
    const pts = [];
    pts.push([-len / 2 + 20, 4]);
    for (let k = 0; k <= 12; k++) { const x = -span + (k / 12) * span * 2; pts.push([x, 126 - 70 * (1 - (x / span) ** 2)]); }
    pts.push([len / 2 - 20, 4]);
    for (let k = 0; k < pts.length - 1; k++) rod(B, 'std', [pts[k][0], pts[k][1], z], [pts[k + 1][0], pts[k + 1][1], z], 0.9, '#3a3c3e', RUSTY, 4);
    for (let k = 1; k < 12; k++) { const x = -span + (k / 12) * span * 2; rod(B, 'std', [x, 126 - 70 * (1 - (x / span) ** 2), z], [x, deckY(x) + 1, z * 0.96], 0.3, '#3a3c3e', RUSTY, 3); }
    for (let k = 0; k < 12; k++) {
      const xa = -span + (k / 12) * span * 2, xb = -span + ((k + 1) / 12) * span * 2;
      rod(B, 'std', [xa, deckY(xa) + 40, z * 0.96], [xb, deckY(xb) + 40, z * 0.96], 0.5, '#5a5a58', RUSTY, 3);
    }
  }
  sign2(B, 'bp_gorge', -span - 40, 60, half + 30, 50, 25, 0);
  // a storm lantern hung on each tower (lit at night)
  for (const s of [-1, 1]) {
    const x = s * span, z = half + 6;
    B.box('std', x, 104, z + 6, 6, 10, 6, '#2a2a2a', null, METAL);
    if (!P.day) {
      B.add('glow', T.box(), [x, 104, z + 6], [4, 7, 4], null, '#ffc070', { emissive: 2.6, uv: atlasUV('white'), noAO: true, noJitter: true });
      const [wx, wy] = toWorld(o, x, z + 6);
      P.halos.push({ x: wx, y: wy, h: 104, color: '#ffc070', size: 50, strength: 0.6, flicker: 0.3 });
    }
  }
}

/** The winch on the near rim: a steel frame bolted to a block, the drum and its cable, the crank. */
function winch(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 14, D, 1, '#8a8478', null, CONC);
  for (const s of [-1, 1]) B.box('std', s * (L / 2 - 8), 32, 0, 6, 36, D - 10, '#3a5a8a', null, METAL);
  B.add('std', T.cyl(16), [0, 34, 0], [12, L - 22, 12], [0, 0, HALF], '#5a5a58', { ...RUSTY, map: 'cyl' });
  for (let k = 0; k < 8; k++) B.add('std', T.torus(16, 0.06, 4), [-L / 2 + 16 + k * 4, 34, 0], [12.6, 12.6, 12.6], [0, HALF, 0], '#3a3c3e', RUSTY);
  B.add('std', T.cyl(12), [L / 2 - 2, 34, 0], [16, 3, 16], [0, 0, HALF], '#3a5a8a', { ...METAL, map: 'cyl' });
  plank(B, 'std', [L / 2 + 2, 34, 0], [L / 2 + 2, 52, 12], 2, 2, '#3a3c3e', METAL);
  rod(B, 'std', [L / 2 + 2, 52, 12], [L / 2 + 14, 52, 12], 1.4, '#c62828', PLAST, 6);
  rod(B, 'std', [0, 46, 0], [220, 40, 260], 0.6, '#3a3c3e', RUSTY, 4);
}

/** The road bridge upstream, down: abutments on both walls, a deck span broken into the river, the rail. */
function roadbridge(P) {
  const { B, o } = P;
  const len = o.len;
  const conc = { noJitter: true, surf: [DET.concrete, 0.9, 0] };
  for (const s of [-1, 1]) {
    B.rblock('std', s * (len / 2 - 10), 0, 0, 60, 300, 200, 2, '#9a968c', null, conc);
    B.add('std', T.box(), [s * (len / 2 - 70), 290, 0], [90, 16, 190], [0, 0, s * 0.08], '#a8a498', conc);
    for (const z of [-90, 90]) B.add('std', T.box(), [s * (len / 2 - 70), 304, z], [90, 10, 6], [0, 0, s * 0.08], '#b8bcc0', S(DET.panel, 0.5, 0.6));
  }
  // the fallen span: one end on the river bed, the other hanging from the north abutment
  B.add('std', T.box(), [-20, 140, 0], [len * 0.7, 18, 190], [0, 0, -0.9], '#a8a498', conc);
  B.add('std', T.box(), [60, 30, -20], [120, 18, 160], [0.2, 0.3, 0.3], '#a09c92', conc);
  for (let k = 0; k < 10; k++) rod(B, 'std', [-120 + k * 20, 280 - k * 25, 90], [-100 + k * 20, 250 - k * 25, 95], 0.6, '#6a6e72', RUSTY, 3);
  B.add('std', T.box(), [-60, 196, 100], [140, 12, 4], [0.3, 0, -0.9], '#b8bcc0', S(DET.panel, 0.5, 0.6));
}

/** White water along the river (local x = downstream): foam streaks behind rocks, a few rocks breaking the surface. */
function rapids(P) {
  const { B, o } = P;
  const len = o.len, w = o.w, r = B.rng;
  const n = Math.round(len / (P.lod >= 1 ? 40 : 90));
  for (let i = 0; i < n; i++) {
    const x = r.range(-len / 2, len / 2), z = r.range(-w / 2 + 10, w / 2 - 10);
    if (Math.abs(x - (2000 - len / 2)) < 120) continue;
    if (r.chance(0.35)) rock(B, x, 2, z, r.range(8, 20), '#4a4842', 0.6);
    B.add('std', T.box(), [x + r.range(10, 30), 1.2, z], [r.range(30, 80), 0.4, r.range(4, 12)], [0, r.range(-0.15, 0.15), 0], '#e8eef0', { noJitter: true, surf: [0, 0.4, 0] });
  }
}

function boulder(P) {
  const { B, o } = P;
  const s = Math.max(o.w, o.h) / 2;
  rock(B, 0, s * 0.35, 0, s, '#6a6a64', 0.75);
  rock(B, s * 0.4, s * 0.15, s * 0.3, s * 0.5, '#6a6a64', 0.7);
  decal(B, 'bp_moss', 0, s * 0.5, s * 0.6, s * 1.2, s * 0.6, 0);
}

function gorgesign(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * 34, 40, 0], [4, 80, 4], null, '#6a4a30', { ...BARK, map: 'cyl' });
  B.box('std', 0, 60, 0, 66, 34, 3, '#5a3a22', null, WOOD);
  sign(B, 'bp_gorge', 0, 60, 1.7, 64, 32, 0);
  sign(B, 'bp_gorge', 0, 60, -1.7, 64, 32, PI);
}

/** The mill's gate (the gate): chain-link in a pipe frame, braced, barbed wire, NO TRESPASSING, chained shut. */
function millgate(P) {
  const { B, L } = P;
  const H = 100, pipe = '#8a8e92';
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 1 : -L / 2 + 1, x1 = s > 0 ? L / 2 - 1 : -1, xc = (x0 + x1) / 2, wl = x1 - x0;
    for (const y of [3, H / 2, H - 2]) B.add('std', T.cyl(6), [xc, y, 0], [1.4, wl, 1.4], [0, 0, HALF], pipe, { ...CHROME, map: 'cyl' });
    for (const x of [x0, x1]) B.cyl('std', x, 0, 0, 1.6, H, pipe, 8, 1, null, CHROME);
    B.add('fence', T.plane(), [xc, H / 2, 0], [wl - 2, H - 4, 1], null, '#8a9094', { uvScale: [wl / 16, H / 16] });
    plank(B, 'std', [x0, 4, 0.6], [x1, H - 4, 0.6], 1.6, 1.6, pipe, CHROME);
  }
  for (let x = -L / 2 + 8; x < L / 2; x += 14) B.add('std', T.torus(8, 0.05, 3), [x, H + 8, 0], [7, 7, 7], [0, HALF + 0.2, 0], '#8a8e92', CHROME);
  for (let k = 0; k < 8; k++) B.add('std', T.torus(6, 0.2, 3), [-8 + k * 2.2, 52, 2], [1.6, 1.6, 1.6], [k % 2 ? HALF : 0, 0, 0], '#6a6e72', RUSTY);
  B.box('std', -L * 0.25, 70, 1.4, 50, 25, 0.8, '#f0ece0', null, METAL);
  sign(B, 'bp_trespass', -L * 0.25, 70, 2, 48, 24, 0);
}

/** The gate's posts and the HARLAN LUMBER CO. board over it on a pipe frame, a floodlight. */
function millgatesign(P) {
  const { B, o, halos } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    B.cyl('std', s * (w / 2 + 8), 0, 0, 4, 190, '#6a6e72', 10, 1, null, METAL);
  }
  B.box('std', 0, 186, 0, w + 24, 5, 5, '#6a6e72', null, METAL);
  B.box('std', 0, 158, 0, 200, 50, 4, '#e8dcc0', null, WOOD);
  sign(B, 'bp_harlan', 0, 158, -2.2, 196, 46, PI);
  sign(B, 'bp_harlan', 0, 158, 2.2, 196, 46, 0);
  B.box('std', w / 2 + 8, 196, -6, 12, 8, 10, '#2a2a2a', [0.4, 0, 0], METAL);
  if (!P.day) { glowBox(B, w / 2 + 8, 194, -11, 10, 6, 1, '#f0f4ff', 3); const [wx, wy] = toWorld(o, w / 2 + 8, -20); halos.push({ x: wx, y: wy, h: 194, color: '#e8f0ff', size: 90, strength: 0.6 }); }
}

/** The signal fire laid ready by the lookout: a cone of split logs and brush on a stone ring, a fuel can. */
function pyre(P) {
  const { B } = P;
  const r = B.rng;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * PI * 2;
    rock(B, Math.cos(a) * 40, 3, Math.sin(a) * 40, 9, '#6a6660', 0.6);
  }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * PI * 2 + r.range(-0.1, 0.1);
    rod(B, 'std', [Math.cos(a) * 32, 0, Math.sin(a) * 32], [Math.cos(a) * 3, 70, Math.sin(a) * 3], 3.4, r.pick(['#6a5038', '#7a5a3a', '#5a4632']), BARK, 6);
  }
  for (let k = 0; k < 10; k++) B.add('std', T.sphere(6, 4), [r.range(-20, 20), r.range(10, 40), r.range(-20, 20)], [r.range(8, 14), r.range(6, 10), r.range(8, 14)], null, r.pick(['#5a5a30', '#6a6038', '#4a4a28']), { noJitter: true, surf: [DET.grass, 0.95, 0] });
  B.rblock('std', 60, 0, 20, 10, 16, 14, 1, '#c8281e', [0, 0.4, 0], PLAST);
  B.add('std', T.box(), [70, 1, 0], [30, 2, 8], [0, 1.1, 0], '#4a4a48', METAL);
}

/** Models by obstacle style or prop name: fn(P), P the kit's model context (createKitArt). */
export const RANGER_MODELS = {
  'bp-pyre': pyre,
  'bp-rcounter': rcounter, 'bp-radiodesk': radiodesk, 'bp-station': station, 'bp-radiomast': radiomast, 'bp-rangersign': rangersign,
  'bp-lookout': lookout, 'bp-rangertruck': rangertruck, 'bp-fueltank': fueltank, 'bp-genshed': genshed, 'bp-helipad': helipad,
  'bp-rockfallside': rockfallside, 'bp-footbridge': footbridge, 'bp-winch': winch, 'bp-roadbridge': roadbridge, 'bp-rapids': rapids,
  'bp-boulder': boulder, 'bp-gorgesign': gorgesign, 'bp-millgatesign': millgatesign,
};
/** Gate models by style, drawn in the gate obstacle's frame (the engine animates them open). */
export const RANGER_GATES = { 'bp-rockfall': rockfall, 'bp-millgate': millgate };
export { rock, fallenPine };
void [carton, tubeFixture, hash01, shadeHex, GLASS, NJ, PLAST];
