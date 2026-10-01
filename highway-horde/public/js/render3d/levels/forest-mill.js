// Blackpine, sections 5 and 6: Harlan Lumber (the log decks, the loader, the head rig's carriage, the band
// mill, the roller deck, the green chain, the saw hall round them and its roof, the wigwam burner and its
// conveyor, the office, the signs, the log pond) and the Harlan farm's fence (its panel, the signal pole,
// the cattle guard); and the forest floor of the whole level (ferns, needles, stumps, deadfall, rocks).

import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CONC, FABRIC, PLAST, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, decal, floorDecal, carton, toWorld, lvUV, litter, pendant, tubeFixture, glowBox,
} from './millroad-kit.js';
import { wheel } from './millroad-jam.js';
import { rock, fallenPine } from './forest-ranger.js';

const BARK = { noJitter: true, surf: [DET.bark, 0.9, 0] };
const LOGC = ['#5a4632', '#6a5038', '#4e3c2a', '#7a5a3a'];

// ---- Harlan Lumber ---------------------------------------------------------------------------------------------

/** A log deck: logs lying across (local z) stacked in a pyramid, the cut ends painted on the two faces. */
function logdeck(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  const R = 7.5;
  const rows = P.lod === 0 ? 3 : 5;
  for (let j = 0; j < rows; j++) {
    const n = Math.floor((L - j * 2 * R) / (2 * R + 0.5));
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + R + j * R + i * (2 * R + 0.5);
      const rr = R * r.range(0.85, 1.05);
      B.add('std', T.cyl(P.lod >= 2 ? 9 : 7), [x, rr + j * R * 1.75, r.range(-3, 3)], [rr, D - r.range(0, 8), rr], [HALF, r.range(-0.03, 0.03), 0], LOGC[(i + j) % 4], { ...BARK, map: 'cyl' });
    }
  }
  const hgt = R * 2 + (rows - 1) * R * 1.75;
  for (const s of [-1, 1]) B.add('lvsign', T.plane(), [0, hgt / 2, s * (D / 2 + 0.4)], [L - 4, hgt, 1], [0, s > 0 ? 0 : PI, 0], '#ffffff', { uv: lvUV('bp_logends'), noAO: true, noJitter: true });
}

/** The log loader: an articulated machine in yellow, big tyres, the cab, the boom with a grapple and its log. */
function loader(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  const yel = o.color || '#d8a020';
  for (const x of [-L * 0.3, L * 0.22]) for (const sd of [-1, 1]) {
    B.add('std', T.cyl(16), [x, 20, sd * (W / 2 - 9)], [20, 16, 20], [HALF, 0, 0], '#1a1a1a', { surf: [DET.rubber, 0.9, 0], map: 'cyl' });
    B.add('std', T.cyl(12), [x, 20, sd * (W / 2 - 0.5)], [11, 1, 11], [HALF, 0, 0], yel, { ...METAL, map: 'cyl' });
  }
  B.rblock('std', -L * 0.25, 22, 0, L * 0.42, 34, W - 18, 3, yel, null, S(DET.panel, 0.5, 0.4));
  B.rblock('std', L * 0.18, 22, 0, L * 0.3, 20, W - 22, 3, yel, null, S(DET.panel, 0.5, 0.4));
  B.box('std', -L * 0.05, 82, 0, 34, 50, W - 26, '#1a2830', null, S(0, 0.08, 0.3));
  B.rblock('std', -L * 0.05, 106, 0, 40, 4, W - 20, 1, yel, null, METAL);
  B.cyl('std', -L * 0.38, 56, 8, 2.4, 30, '#1a1a1a', 8, 1, null, RUSTY);
  plank(B, 'std', [L * 0.2, 40, 0], [L * 0.62, 70, 0], 12, 10, yel, METAL);
  plank(B, 'std', [L * 0.62, 70, 0], [L * 0.72, 30, 0], 10, 8, yel, METAL);
  for (const s of [-1, 1]) plank(B, 'std', [L * 0.72, 30, s * 4], [L * 0.8, 6, s * 16], 3, 3, '#3a3a3a', METAL);
  B.add('std', T.cyl(8), [L * 0.76, 14, 0], [8, 150, 8], [HALF, 0.1, 0], LOGC[1], { ...BARK, map: 'cyl' });
}

/** The head rig's carriage on its track: steel rails, the frame with its knees and dogs, a big log on it. */
function carriage(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  for (const z of [-D / 2 + 4, D / 2 - 4]) B.box('std', 0, 2, z, L + 160, 4, 4, '#6a6e72', null, METAL);
  B.box('std', -L * 0.1, 12, 0, L * 0.7, 16, D, '#4a5a6a', null, S(DET.panel, 0.5, 0.6));
  for (const x of [-L * 0.35, -L * 0.1, L * 0.15]) B.box('std', x, 34, D / 2 - 8, 12, 30, 14, '#3a4a5a', null, METAL);
  B.add('std', T.cyl(14), [-L * 0.1, 40, -2], [17, L * 0.68, 17], [0, 0, HALF], LOGC[2], { ...BARK, map: 'cyl' });
  B.rblock('std', L * 0.42, 0, 0, 40, 70, D, 2, '#3a4a5a', null, METAL);
  B.box('std', L * 0.42, 50, D / 2 + 0.4, 30, 20, 0.6, '#1a2830', null, S(0, 0.1, 0.3));
}

/** The band mill: two great wheels in a steel frame, the blade between them, guards. */
function bandsaw(P) {
  const { B, o } = P;
  const L = o.w;
  B.rblock('std', 0, 0, 0, L, 20, L, 2, '#4a5a6a', null, METAL);
  for (const y of [40, 130]) B.add('std', T.cyl(22), [0, y, 0], [30, 8, 30], [HALF, 0, 0], '#5a6a7a', { ...METAL, map: 'cyl' });
  for (const s of [-1, 1]) B.box('std', s * 24, 90, -12, 10, 170, 10, '#4a5a6a', null, METAL);
  B.box('std', 0, 85, 10, 2, 100, 0.6, '#c8ccd0', null, S(0, 0.2, 0.95));
  B.box('std', 0, 160, 0, 60, 8, 30, '#c8a020', null, METAL);
  sign(B, 'mr_flammable', 0, 60, L / 2 + 0.4, 14, 14, 0);
}

/** A live roller deck: rollers across in a frame, boards riding on it. */
function rollers(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  for (const z of [-D / 2 + 2, D / 2 - 2]) B.box('std', 0, 22, z, L, 8, 3, '#4a5a6a', null, METAL);
  for (let x = -L / 2 + 6; x < L / 2; x += 12) B.add('std', T.cyl(8), [x, 26, 0], [3, D - 6, 3], [HALF, 0, 0], '#8a8e92', { ...CHROME, map: 'cyl' });
  for (let x = -L / 2 + 20; x < L / 2; x += 80) for (const s of [-1, 1]) B.box('std', x, 11, s * (D / 2 - 2), 4, 22, 4, '#3a4a5a', null, METAL);
  for (let k = 0; k < 3; k++) B.box('std', r.range(-L / 3, L / 3), 31, r.range(-6, 6), r.range(80, 140), 3, r.range(8, 14), '#c8a070', [0, r.range(-0.05, 0.05), 0], WOOD);
}

/** The green chain: a long transfer table, chains running across, lumber laid out, a step along it. */
function greenchain(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  B.box('std', 0, 30, 0, L, 4, D, '#5a5a58', null, METAL);
  for (let x = -L / 2 + 20; x < L / 2; x += 50) {
    B.box('std', x, 32.6, 0, 3, 1.4, D, '#2a2a2a', null, RUSTY);
    for (const s of [-1, 1]) B.box('std', x, 14, s * (D / 2 - 3), 4, 28, 4, '#4a4a48', null, METAL);
  }
  for (let k = 0; k < 14; k++) B.box('std', r.range(-L / 2 + 20, L / 2 - 20), 34 + (k % 3) * 2.2, r.range(-D / 3, D / 3), r.range(6, 12), 2, D * r.range(0.6, 0.9), r.pick(['#c8a070', '#b89060', '#d8b080']), [0, r.range(-0.05, 0.05), 0], WOOD);
  B.box('std', 0, 8, D / 2 + 12, L, 2, 18, '#6a6e72', null, METAL);
}

/** The saw hall round its machines: sawdust heaps, stacks of lumber, a forklift, hanging lamps, the sawyer's
 *  booth, a body in the sawdust. */
function sawhall(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let k = 0; k < 7; k++) {
    const x = r.range(-w / 2 + 60, w / 2 - 60), z = r.range(-h / 2 + 40, h / 2 - 40);
    B.add('std', T.sphere(10, 6), [x, 0, z], [r.range(18, 40), r.range(6, 14), r.range(18, 34)], null, '#c8a46a', { noJitter: true, surf: [DET.sand, 0.95, 0] });
    floorDecal(B, 'grime', x, z, 90, 70, r.range(0, 6), 0.5, '#e8c890');
  }
  for (const [x, z] of [[w / 2 - 90, -h / 2 + 50], [w / 2 - 200, -h / 2 + 50], [-w / 2 + 100, h / 2 - 50]]) {
    for (let k = 0; k < 6; k++) B.box('std', x, 3 + k * 6.2, z, 110, 5, 40, mixHex('#c8a070', '#a88050', r.next()), [0, r.range(-0.02, 0.02), 0], WOOD);
    for (let k = 0; k < 5; k++) B.box('std', x, 6 + k * 6.2, z, 4, 1.2, 42, '#8a6a48', null, WOOD);
  }
  // a forklift parked with its forks up
  const fx = -w / 2 + 160, fz = h / 2 - 90;
  B.rblock('std', fx, 10, fz, 50, 26, 30, 2, '#d85a1a', null, METAL);
  B.box('std', fx - 6, 50, fz, 26, 2, 28, '#1a1a1a', null, METAL);
  for (const s of [-1, 1]) B.box('std', fx - 18 + 12, 30, fz + s * 13, 2, 40, 2, '#1a1a1a', null, METAL);
  for (const s of [-1, 1]) B.box('std', fx + 30, 45, fz + s * 10, 3, 70, 3, '#3a3a3a', null, METAL);
  for (const s of [-1, 1]) plank(B, 'std', [fx + 32, 30, fz + s * 8], [fx + 62, 30, fz + s * 8], 1.6, 4, '#3a3a3a', METAL);
  for (const x of [fx - 16, fx + 16]) for (const s of [-1, 1]) wheel(B, x, 9, fz + s * 16, 5, s);
  // the sawyer's booth
  B.rblock('std', -w / 2 + 330, 0, -40, 50, 80, 40, 2, '#4a5a6a', null, METAL);
  B.box('std', -w / 2 + 330, 60, -19.4, 44, 30, 0.6, '#1a2830', null, S(0, 0.1, 0.3));
  // hanging lamps
  for (const x of [-300, 0, 300]) {
    const [wx, wy] = toWorld(o, x, 0);
    rod(B, 'std', [x, 190, 0], [x, 150, 0], 0.4, '#2a2a2a', METAL, 3);
    B.add('std', T.cyl(12, 0.4, true), [x, 146, 0], [14, 10, 14], [PI, 0, 0], '#3a4a3a', METAL);
    if (!P.day) { B.add('glow', T.sphere(6, 4), [x, 142, 0], [5, 3, 5], null, '#ffd49a', { emissive: 2.6, uv: atlasUV('white'), noAO: true, noJitter: true }); P.halos.push({ x: wx, y: wy, h: 142, color: '#ffd49a', size: 90, strength: 0.4 }); }
  }
  B.add('std', T.pillow(10, 6, 0.3), [120, 4, 120], [26, 4, 10], [0, 0.6, 0], '#3a4a5a', FABRIC);
  floorDecal(B, 'blood1', 130, 110, 70, 70, 0.6, 0.6);
  sign(B, 'bp_trespass', -w / 2 + 7.6, 100, 60, 50, 25, HALF);
  litter(B, -w / 2 + 30, -h / 2 + 30, w / 2 - 30, h / 2 - 30, P.lod >= 1 ? 24 : 8, 0.6);
}

/** The saw hall's roof: a low corrugated gable on steel trusses, skylight panels, open eaves. */
function sawroof(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, y0 = 190;
  const pitch = 0.22, half = h / 2 + 10;
  const rise = half * Math.tan(pitch), slope = half / Math.cos(pitch);
  for (const s of [-1, 1]) {
    B.add('std', T.box(), [0, y0 + rise / 2 + 2, s * half / 2], [w + 20, 2.4, slope + 4], [s * pitch, 0, 0], '#7a6656', { noJitter: true, surf: [DET.corrugated, 0.6, 0.45] });
    for (let x = -w / 2 + 120; x < w / 2 - 60; x += 240) B.add('vglass', T.box(), [x, y0 + rise / 2 + 3.6, s * half / 2], [60, 0.4, slope * 0.6], [s * pitch, 0, 0], '#c8d8e0', { noJitter: true, surf: [0, 0.2, 0] });
  }
  B.box('std', 0, y0 + rise + 3, 0, w + 22, 4, 8, '#5a5048', null, METAL);
  for (let x = -w / 2 + 60; x < w / 2; x += 120) {
    B.box('std', x, y0 - 4, 0, 4, 6, h - 10, '#4a4e52', null, METAL);
    for (const s of [-1, 1]) plank(B, 'std', [x, y0 - 2, s * (h / 2 - 6)], [x, y0 + rise - 2, 0], 4, 4, '#4a4e52', METAL);
    B.box('std', x, y0 + rise / 2 - 2, 0, 3, rise, 3, '#4a4e52', null, METAL);
  }
}

/** The wigwam burner: a steel cone rusted orange, the screened dome on top, a door at the foot, the chute. */
function burner(P) {
  const { B, o } = P;
  const R = o.w / 2, H = 340;
  B.cyl('std', 0, 0, 0, R + 6, 8, '#8a8478', 28, 1, null, CONC);
  B.add('std', T.cyl(28, 0.3, true), [0, 8 + H / 2, 0], [R, H, R], null, '#7a4a30', { surf: [DET.rust, 0.7, 0.5], map: 'cyl' });
  for (let k = 1; k < 6; k++) { const y = 8 + (k / 6) * H, rr = R * (1 - 0.7 * (k / 6)); B.add('std', T.torus(28, 0.02, 3), [0, y, 0], [rr + 0.6, rr + 0.6, rr + 0.6], [HALF, 0, 0], '#5a3424', RUSTY); }
  B.add('fence', T.sphere(18, 8), [0, 8 + H, 0], [R * 0.3, R * 0.2, R * 0.3], null, '#5a5a58', { uvScale: [6, 3] });
  // the embers under the screen and through the door (by night a glow; by day a haze of smoke does it)
  if (!P.day) {
    B.add('glow', T.sphere(14, 8), [0, 8 + H - 4, 0], [R * 0.26, R * 0.12, R * 0.26], null, '#ff7a2a', { emissive: 1.8, uv: atlasUV('white'), noAO: true, noJitter: true });
    B.box('glow', 0, 26, R + 1.4, 12, 38, 0.6, '#ff6a1a', null, { emissive: 1.4, uv: atlasUV('white'), noAO: true, noJitter: true });
    const [wx, wy] = toWorld(o, 0, 0);
    P.halos.push({ x: wx, y: wy, h: 8 + H, color: '#ff7a2a', size: 160, strength: 0.5, flicker: 0.4 });
  }
  B.box('std', 0, 26, R - 2, 40, 44, 6, '#3a2a20', null, RUSTY);
  B.box('std', 0, 260, -R * 0.5, 30, 24, 30, '#5a4434', [0.4, 0, 0], RUSTY);
  for (let k = 0; k < 8; k++) { const th = (k / 8) * PI * 2; decal(B, 'grime', Math.sin(th) * R * 0.86, H * 0.4, Math.cos(th) * R * 0.86, 90, H * 0.6, th, { rx: -0.25 }); }
  sign(B, 'bp_burnsign', 0, 60, R + 1, 60, 22, 0);
}

/** The conveyor from the saw hall up to the burner (along local -z, rising): a truss, the belt, legs. */
function conveyor(P) {
  const { B } = P;
  const z0 = 440, z1 = -360, y0 = 60, y1 = 270;
  const n = 8;
  for (const s of [-1, 1]) rod(B, 'std', [s * 10, y0, z0], [s * 10, y1, z1], 1.6, '#6a6e72', METAL, 6);
  plank(B, 'std', [0, y0 + 3, z0], [0, y1 + 3, z1], 18, 1.4, '#2a2a2a', RUSTY, HALF);
  // the gallery over the belt: a corrugated tube with a peaked lid
  plank(B, 'std', [0, y0 + 14, z0], [0, y1 + 14, z1], 22, 26, '#7a6656', { noJitter: true, surf: [DET.corrugated, 0.6, 0.45] });
  plank(B, 'std', [0, y0 + 26, z0], [0, y1 + 26, z1], 3, 30, '#5a5048', METAL);
  for (let k = 0; k <= n; k++) {
    const t = k / n, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
    B.box('std', 0, y - 1, z, 24, 2, 3, '#6a6e72', null, METAL);
    if (k % 2 === 0 && k < n) for (const s of [-1, 1]) rod(B, 'std', [s * 14, 0, z], [s * 10, y - 2, z], 1.2, '#6a6e72', METAL, 4);
  }
  for (const s of [-1, 1]) for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    rod(B, 'std', [s * 10, y0 + (y1 - y0) * t0, z0 + (z1 - z0) * t0], [s * 10, y0 + (y1 - y0) * t1 + 14, z0 + (z1 - z0) * t1], 0.5, '#6a6e72', METAL, 3);
  }
}

function milldesk(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  B.rblock('std', 0, 0, 0, L, 28, D, 1, '#6a4a30', null, WOOD);
  B.box('std', 0, 28.6, 0, L + 2, 1.2, D + 2, '#5a3a22', null, WOOD);
  B.box('std', -L * 0.2, 30, 0, 26, 3, 18, '#2a3a2a', [0, 0.1, 0], FABRIC);
  B.rblock('std', L * 0.25, 29.2, -6, 16, 8, 14, 1, '#4a4a48', null, METAL);
  B.cyl('std', L * 0.38, 29.2, 8, 3, 1, '#2a2a2a', 8, 1, null, METAL);
  rod(B, 'std', [L * 0.38, 30, 8], [L * 0.34, 46, 4], 0.5, '#2a2a2a', METAL, 3);
  B.add('std', T.cyl(10, 0.5, true), [L * 0.33, 46, 3], [5, 5, 5], [0.6, 0, 0], '#2a5a3a', METAL);
}

/** The mill office: filing cabinets, the safe, the time clock and its card rack, the tract map, the sign outside. */
function milloffice(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let k = 0; k < 3; k++) B.rblock('std', -w / 2 + 20, 0, -h / 2 + 30 + k * 22, 18, 52, 20, 0.8, '#6a6e5a', null, METAL);
  B.rblock('std', w / 2 - 26, 0, h / 2 - 30, 30, 44, 28, 2, '#2a2c2e', null, METAL);
  B.add('std', T.box(), [w / 2 - 26 - 10, 22, h / 2 - 30 - 22], [26, 40, 3], [0, 1.0, 0], '#2a2c2e', METAL);
  B.rblock('std', 30, 60, h / 2 - 9, 18, 22, 8, 1, '#c8c4b4', null, METAL);
  for (let k = 0; k < 10; k++) B.box('std', 60 + (k % 5) * 4, 52 + Math.floor(k / 5) * 14, h / 2 - 8.6, 3, 12, 0.6, '#e8e0c8', null, NJ);
  sign(B, 'bp_topo', -20, 80, -h / 2 + 7.6, 60, 45, 0);
  sign(B, 'bp_harlan', 50, 112, -h / 2 - 8.4, 80, 20, PI);
  for (let k = 0; k < 20; k++) B.box('std', r.range(-w / 2 + 20, w / 2 - 20), 0.7, r.range(-h / 2 + 15, h / 2 - 15), 8, 0.3, 11, r.pick(['#f0ece0', '#e8e4d8', '#f2e08a']), [0, r.range(0, 6), 0], NJ);
  const [wx, wy] = toWorld(o, 0, 0);
  pendant(B, P.day ? null : P.halos, 0, 104, 0, wx, wy, '#ffd9a0', !P.day);
}

function millsign(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.cyl('std', s * 100, 0, 0, 3.4, 150, '#5a4632', 8, 1, null, WOOD);
  B.box('std', 0, 120, 0, 210, 54, 4, '#e8dcc0', null, WOOD);
  sign(B, 'bp_harlan', 0, 120, 2.2, 206, 51.5, 0);
  sign(B, 'bp_harlan', 0, 120, -2.2, 206, 51.5, PI);
  B.box('std', 0, 60, 0, 90, 46, 2, '#f0ece0', null, METAL);
  sign(B, 'bp_trespass', 0, 60, 1.2, 88, 44, 0);
}

/** Logs floating in the pond, a boom of chained logs, a little dock with a pike pole. */
function pondlogs(P) {
  const { B, o } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (let k = 0; k < (P.lod >= 1 ? 30 : 14); k++) B.add('std', T.cyl(8), [r.range(-w / 2 + 40, w / 2 - 40), 1.5, r.range(-h / 2 + 40, h / 2 - 40)], [7, r.range(80, 140), 7], [HALF, r.range(0, 6), 0], LOGC[k % 4], { ...BARK, map: 'cyl' });
  for (let x = -w / 2 + 40; x < w / 2 - 40; x += 90) B.add('std', T.cyl(8), [x + 45, 1.5, -h / 2 + 20], [6, 86, 6], [HALF, HALF, 0], LOGC[2], { ...BARK, map: 'cyl' });
  B.box('std', -w / 2 - 20, 4, 0, 60, 3, 40, '#6a5038', null, WOOD);
  for (const [dx, dz] of [[-20, -16], [20, -16], [-20, 16], [20, 16]]) B.box('std', -w / 2 - 20 + dx, 2, dz, 4, 8, 4, '#4a3a2a', null, WOOD);
  plank(B, 'std', [-w / 2 - 30, 5.6, 6], [-w / 2 + 50, 5.6, 14], 1.6, 1.6, '#8a6a48', WOOD);
}

// ---- the farm --------------------------------------------------------------------------------------------------

/** The fence panel the crew pushes in (the gate): posts and four boards, HARLAN FARM painted on a board, the
 *  graffiti on the mill side. */
function farmpanel(P) {
  const { B, L } = P;
  for (const s of [-1, 1]) B.box('std', s * (L / 2 - 4), 37, 0, 7, 74, 7, '#8a8478', null, WOOD);
  for (const y of [14, 30, 46, 62]) B.box('std', 0, y, -4, L, 9, 1.6, '#d0ccc0', null, { noJitter: true, ...WOOD });
  B.box('std', 0, 44, 2, 90, 54, 1.6, '#e8e0cc', null, WOOD);
  sign(B, 'bp_farm', 0, 44, 3, 88, 55, 0);
  decal(B, 'bp_graf', -L * 0.32, 22, 3.2, 60, 22, 0);
}

/** The farm's signal: a tall pole with a rotating amber beacon and a siren horn, the painted board, a flare drum. */
function signal(P) {
  const { B, o, halos } = P;
  B.add('std', T.cyl(10, 0.8), [0, 130, 0], [7, 260, 7], null, '#5a4632', { noJitter: true, surf: [DET.wood, 0.9, 0], map: 'cyl' });
  for (let y = 20; y < 240; y += 14) B.box('std', 7, y, 0, 6, 1.4, 1.4, '#6a6e72', null, METAL);
  B.box('std', 0, 262, 0, 16, 4, 16, '#3a3a3a', null, METAL);
  if (P.day) B.add('std', T.cyl(12), [0, 270, 0], [6, 12, 6], null, '#c87a10', S(0, 0.2, 0));
  else {
    B.add('blink', T.cyl(12), [0, 270, 0], [6, 12, 6], null, '#ffb020', { emissive: 3 });
    const [wx, wy] = toWorld(o, 0, 0); halos.push({ x: wx, y: wy, h: 270, color: '#ffb020', size: 130, blink: 1, strength: 0.8 });
  }
  B.add('std', T.cyl(10, 2.2, true), [0, 246, 12], [4, 14, 4], [HALF, 0, 0], '#c8c4b8', METAL);
  B.box('std', 0, 90, 10, 80, 50, 2, '#e8e0cc', null, WOOD);
  sign(B, 'bp_farm', 0, 90, 11.2, 78, 48.75, 0);
  B.cyl('std', 30, 0, 20, 10, 30, '#3a4a3a', 12, 1, null, RUSTY);
}

function cattleguard(P) {
  const { B } = P;
  B.box('std', 0, 0.3, 0, 60, 0.6, 170, '#141210', null, NJ);
  for (let x = -26; x <= 26; x += 7) B.add('std', T.cyl(8), [x, 1.6, 0], [2, 170, 2], [HALF, 0, 0], '#6a6e72', { ...RUSTY, map: 'cyl' });
  for (const s of [-1, 1]) B.box('std', 0, 1.4, s * 88, 64, 2.8, 6, '#8a8478', null, CONC);
}

// ---- the forest floor ------------------------------------------------------------------------------------------

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/**
 * The undergrowth of the whole level (drawn in blocks so the geometry cells stay local): fern clumps of crossed
 * alpha cards, needle litter under the pines, stumps, deadfall and mossy rocks, none on the trails, in the
 * clearings, indoors, in the water or on anything built.
 */
export function forestFloor(P) {
  const { B, map } = P;
  const keep = (map.art && map.art.keep) || { paths: [], clear: [], rects: [] };
  const lod = P.lod;
  const obs = map.obstacles.filter((o) => o.kind !== 'wall' || o.w < 600);
  const waters = map.areas.filter((a) => a.kind === 'water');
  const blocked = (x, y, pad) => {
    for (const o of obs) {
      if (Math.abs(x - o.x) > 300 || Math.abs(y - o.y) > 300) continue;
      const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0), dx = x - o.x, dy = y - o.y;
      if (Math.abs(dx * c + dy * s) < o.w / 2 + pad && Math.abs(-dx * s + dy * c) < o.h / 2 + pad) return o;
    }
    return null;
  };
  const free = (x, y, pad) => {
    if (keep.paths.some(([ax, ay, bx, by, w]) => segDist(x, y, ax, ay, bx, by) < w / 2 + pad)) return false;
    if (keep.clear.some(([cx, cy, cr]) => Math.hypot(x - cx, y - cy) < cr - 30)) return false;
    if (keep.rects.some(([ax, ay, bx, by]) => x > ax && x < bx && y > ay && y < by)) return false;
    if (waters.some((a) => Math.abs(x - a.x) < a.w / 2 + pad && Math.abs(y - a.y) < a.h / 2 + pad)) return false;
    if ((map.roofs || []).some((r) => Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(y - r.y) < r.h / 2 + pad)) return false;
    return true;
  };
  const ferns = [lvUV('bp_fern1'), lvUV('bp_fern2')];
  const block = 600;
  for (let bx = 0; bx < map.width; bx += block) {
    for (let by = 0; by < map.height; by += block) {
      B.obj(bx + block / 2, by + block / 2, 0, Math.round(bx * 7 + by * 3));
      B.setJitter(0);
      const r = B.rng;
      const ox = bx + block / 2, oy = by + block / 2;
      const nF = lod === 0 ? 10 : lod === 1 ? 26 : 40;
      for (let i = 0; i < nF; i++) {
        const x = bx + r.next() * block, y = by + r.next() * block;
        if (!free(x, y, 20) || blocked(x, y, 14)) continue;
        const s = r.range(16, 30), uv = ferns[r.chance(0.75) ? 0 : 1];
        const cards = lod >= 2 ? 3 : 2, yaw0 = r.range(0, PI);
        const tint = mixHex('#ffffff', '#c8d0a0', r.next() * 0.5);
        for (let k = 0; k < cards; k++) B.add('lvleaf', T.plane(), [x - ox, s * 0.42, y - oy], [s * 1.4, s, 1], [r.range(-0.2, 0.2), yaw0 + (k * PI) / cards, 0], tint, { uv, noAO: true, noJitter: true });
      }
      // needle litter round the trunks, stumps, rocks, deadfall
      const trees = obs.filter((o) => o.kind === 'tree' && o.x >= bx && o.x < bx + block && o.y >= by && o.y < by + block);
      if (lod >= 1) for (const t of trees) if (r.chance(0.5)) B.add('lvdecal', T.plane(), [t.x - ox + r.range(-10, 10), 0.4, t.y - oy + r.range(-10, 10)], [r.range(70, 120), r.range(70, 120), 1], [-HALF, 0, r.range(0, 6)], '#ffffff', { uv: lvUV('bp_needles'), noAO: true, noJitter: true });
      for (let i = 0; i < (lod === 0 ? 1 : 3); i++) {
        const x = bx + r.next() * block, y = by + r.next() * block;
        if (!free(x, y, 40) || blocked(x, y, 30)) continue;
        const k = r.next();
        if (k < 0.35) {
          B.cyl('std', x - ox, 0, y - oy, r.range(7, 12), r.range(8, 20), '#5a4632', 9, 1, null, BARK);
          B.cyl('std', x - ox, r.range(8, 20), y - oy, r.range(6, 11), 0.6, '#a8845a', 9, 1, null, WOOD);
        } else if (k < 0.7) rock(B, x - ox, 4, y - oy, r.range(10, 24), '#6a6a64');
        else if (lod >= 1) fallenPine(B, x - ox, y - oy, r.range(100, 200), r.range(0, PI));
      }
    }
  }
}

/** Models by obstacle style or prop name: fn(P), P the kit's model context (createKitArt). */
export const MILL_MODELS = {
  'bp-logdeck': logdeck, 'bp-loader': loader, 'bp-carriage': carriage, 'bp-bandsaw': bandsaw, 'bp-rollers': rollers, 'bp-greenchain': greenchain,
  'bp-sawhall': sawhall, 'bp-burner': burner, 'bp-conveyor': conveyor, 'bp-milldesk': milldesk, 'bp-milloffice': milloffice, 'bp-millsign': millsign,
  'bp-pondlogs': pondlogs, 'bp-signal': signal, 'bp-cattleguard': cattleguard,
};
/** Gate models by style, drawn in the gate obstacle's frame (the engine animates them open). */
export const MILL_GATES = { 'bp-farmpanel': farmpanel };
/** Roof models by style, drawn in the roof's frame (the art draws that ceiling itself). */
export const MILL_ROOFS = { 'bp-sawroof': sawroof };
void [carton, tubeFixture, glowBox, hash01, shadeHex, sign2, PLAST, CHROME];
