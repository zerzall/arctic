// Blackpine, sections 1 and 2: the trailhead (wheel stops, the car left open, the map kiosk, the vault
// toilet, bear-proof bins, the routed signs, the campground's log gate and arch) and Blackpine Campground
// (the check-in booth, the host's sign, the campfire circle and its benches and screen, the sites' tables,
// rings, tents and posts, the RV and its camp, the shower block inside, spigots, the board, firewood).

import {
  atlasUV, T, S, WOOD, RUSTY, METAL, CONC, FABRIC, PLAST, CHROME, NJ, HALF, PI, shadeHex, mixHex, hash01,
  DET, rod, plank, sign, sign2, decal, floorDecal, carton, toWorld, lvUV, litter, pendant, tubeFixture,
} from './millroad-kit.js';
import { lvSub } from './millroad-atlas.js';
import { wheel } from './millroad-jam.js';

const GLASS = { noJitter: true, surf: [0, 0.06, 0] };
const BARK = { noJitter: true, surf: [DET.bark, 0.9, 0] };
const LOG = '#7a5a3a';

/** A log (along local x between x0 and x1 at height y, radius rad). */
function log(B, x0, x1, y, z, rad, color = LOG) {
  B.add('std', T.cyl(8), [(x0 + x1) / 2, y, z], [rad, x1 - x0, rad], [0, 0, HALF], color, { ...BARK, map: 'cyl' });
}

// ---- the trailhead -----------------------------------------------------------------------------------------

function wheelstop(P) {
  P.B.rblock('std', 0, 0, 0, 40, 5, 8, 1.5, '#a8a498', null, CONC);
}

/** The car someone left: the hatch up, a door open, bags dragged out onto the gravel. */
function opencar(P) {
  const { B } = P;
  const r = B.rng;
  const L = 92, W = 46;
  B.add('std', T.box(), [-L / 2 - 6, 54, 0], [2, 34, W - 8], [0, 0, -0.9], '#7a2a24', S(DET.panel, 0.4, 0.3));
  B.add('glass', T.box(), [-L / 2 - 7, 56, 0], [0.6, 24, W - 14], [0, 0, -0.9], '#1a2830', S(0, 0.08, 0.3));
  B.add('std', T.box(), [8, 28, W / 2 + 14], [30, 26, 2], [0, -1.1, 0], '#7a2a24', S(DET.panel, 0.4, 0.3));
  for (let k = 0; k < 4; k++) B.add('std', T.pillow(8, 6, 0.4), [-L / 2 - 20 - r.range(0, 30), 5, r.range(-20, 20)], [r.range(8, 12), 5, r.range(6, 9)], [0, r.range(0, 6), 0], r.pick(['#2a4a7a', '#c86a1a', '#3a3a3a', '#6a2a5a']), FABRIC);
  B.rblock('std', -L / 2 - 30, 0, 18, 18, 22, 12, 3, '#3a5a3a', [0, 0.4, 0.2], FABRIC);
  floorDecal(B, 'blood3', -L / 2 - 40, -10, 40, 30, 0.6, 0.5);
  litter(B, -L / 2 - 60, -40, -L / 2, 40, 8, 0.5);
}

/** The trail map kiosk: log posts, a shingled gable roof, the map (local -z), notices on the back. */
function kiosk(P) {
  const { B, o } = P;
  const L = o.w;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * (L / 2 - 4), 70, 0], [5, 140, 5], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 78, 0, L - 8, 62, 4, '#5a3a22', null, WOOD);
  sign(B, 'bp_trailmap', 0, 78, -2.2, L - 14, (L - 14) * 0.625, PI);
  sign(B, 'bp_rules', -24, 82, 2.2, 22, 33, 0);
  sign(B, 'bp_missing', 4, 84, 2.2, 22, 33, 0);
  sign(B, 'bp_bear', 30, 80, 2.2, 22, 27.5, 0);
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 146, s * 14], [L + 16, 2.4, 34], [s * 0.6, 0, 0], '#3a3430', { noJitter: true, surf: [DET.shingle, 0.85, 0] });
  B.box('std', 0, 138, 0, L, 6, 6, '#5a3a22', null, WOOD);
}

/** The vault toilet: block walls, a steel door with its sign, a vent stack, a gravel apron. */
function outhouse(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  B.rblock('std', 0, 0, 0, L, 96, W, 1, '#a8a294', null, { noJitter: true, surf: [DET.brick, 0.9, 0] });
  B.add('std', T.box(), [0, 104, 0], [L + 14, 4, W + 14], [0.08, 0, 0], '#4a3a2a', { noJitter: true, surf: [DET.metalroof, 0.6, 0.3] });
  B.box('std', -L * 0.22, 38, W / 2 + 0.6, 30, 76, 1.4, '#5a4a3a', null, METAL);
  sign(B, 'bp_men', -L * 0.22, 84, W / 2 + 1.6, 26, 9.75, 0);
  B.box('std', L * 0.22, 38, W / 2 + 0.6, 30, 76, 1.4, '#5a4a3a', null, METAL);
  sign(B, 'bp_women', L * 0.22, 84, W / 2 + 1.6, 26, 9.75, 0);
  B.cyl('std', L / 2 - 14, 96, -W / 2 + 14, 4, 50, '#2a2a2a', 8, 1, null, METAL);
  B.box('std', 0, 1, W / 2 + 22, L + 20, 2, 40, '#8a8478', null, CONC);
  decal(B, 'grime', 0, 50, W / 2 + 0.8, L, 90, 0);
}

/** A bear-proof bin: a brown steel box with a sloped lid and a latch. */
function bearbin(P) {
  const { B, o } = P;
  B.rblock('std', 0, 0, 0, o.w, 40, o.h, 1, '#5a4430', null, METAL);
  B.add('std', T.box(), [0, 42, -2], [o.w + 2, 2, o.h + 2], [0.2, 0, 0], '#4a3624', METAL);
  B.box('std', 0, 34, o.h / 2 + 1, 10, 4, 2, '#8a8e92', null, CHROME);
}

/** A routed trail sign on its post (both faces). */
function trailsign(P) {
  const { B } = P;
  B.add('std', T.cyl(8), [0, 45, 0], [4, 90, 4], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 72, 0, 64, 32, 3, '#5a3a22', null, WOOD);
  sign(B, 'bp_trailsign', 0, 72, 1.7, 62, 31, 0);
  sign(B, 'bp_trailsign', 0, 72, -1.7, 62, 31, PI);
}

/** The state forest's entrance sign: a routed board between log posts under a little roof. */
function forestsign(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * 66, 60, 0], [7, 120, 7], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 74, 0, 124, 48, 5, '#5a3a22', null, WOOD);
  sign(B, 'bp_forest', 0, 74, 2.7, 120, 45, 0);
  sign(B, 'bp_forest', 0, 74, -2.7, 120, 45, PI);
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 112, s * 8], [150, 2.4, 20], [s * 0.5, 0, 0], '#3a3430', { noJitter: true, surf: [DET.shingle, 0.85, 0] });
  B.rblock('std', 0, 0, 0, 150, 8, 30, 2, '#6a665e', null, { noJitter: true, surf: [DET.rock, 0.9, 0] });
}

/** The campground's gate (the gate): a heavy timber gate, braced, a chain and padlock, a CLOSED board. */
function campgate(P) {
  const { B, L } = P;
  const H = 96;
  for (const y of [10, 48, 88]) log(B, -L / 2 + 2, L / 2 - 2, y, 0, 5);
  for (let x = -L / 2 + 6; x < L / 2; x += 14) B.box('std', x, H / 2, 3, 10, H - 4, 3, mixHex('#8a6a48', '#6a5038', hash01(x)), null, WOOD);
  plank(B, 'std', [-L / 2 + 6, 10, -4], [L / 2 - 6, 86, -4], 8, 4, '#5a4632', WOOD);
  for (let k = 0; k < 8; k++) B.add('std', T.torus(6, 0.2, 3), [-6 + k * 2.2, 50, -6], [1.6, 1.6, 1.6], [k % 2 ? HALF : 0, 0, 0], '#6a6e72', RUSTY);
  B.rblock('std', 4, 44, -7, 6, 8, 3, 0.8, '#c8a040', null, S(0, 0.3, 0.9));
  B.box('std', -L * 0.25, 66, -6.4, 60, 30, 1.6, '#c8b088', null, WOOD);
  sign(B, 'hc_closed', -L * 0.25, 66, -7.4, 58, 29, PI);
}

/** The log arch over the campground's entrance: two posts, the beam, the routed name hanging under it. */
function camparch(P) {
  const { B, o, halos } = P;
  const w = o.w;
  for (const s of [-1, 1]) {
    B.add('std', T.cyl(10), [s * (w / 2 + 18), 95, 0], [11, 190, 11], null, LOG, { ...BARK, map: 'cyl' });
    B.add('std', T.cyl(8), [s * (w / 2 + 18) - s * 30, 150, 0], [4, 60, 4], [0, 0, s * 0.85], LOG, { ...BARK, map: 'cyl' });
  }
  log(B, -w / 2 - 40, w / 2 + 40, 186, 0, 9);
  for (const s of [-1, 1]) rod(B, 'std', [s * 80, 178, 0], [s * 80, 160, 0], 0.5, '#2a2a2a', METAL, 4);
  B.box('std', 0, 146, 0, 190, 34, 4, '#5a3a22', null, WOOD);
  sign(B, 'bp_camp', 0, 146, 2.2, 186, 46.5 * 0.68, 0);
  sign(B, 'bp_camp', 0, 146, -2.2, 186, 46.5 * 0.68, PI);
  // a lantern on the north post (lit at night)
  const lx = -w / 2 - 18, lz = -14;
  B.box('std', lx, 120, lz, 6, 10, 6, '#2a2a2a', null, METAL);
  if (!P.day) {
    B.add('glow', T.box(), [lx, 120, lz], [4, 7, 4], null, '#ffc070', { emissive: 2.6, uv: atlasUV('white'), noAO: true, noJitter: true });
    const [wx, wy] = toWorld(o, lx, lz);
    halos.push({ x: wx, y: wy, h: 120, color: '#ffc070', size: 50, strength: 0.6, flicker: 0.3 });
  }
}

// ---- the campground -----------------------------------------------------------------------------------------

/** The check-in booth: a little log cabin with a sliding window, a shelf, the host's notes. */
function checkin(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  B.rblock('std', 0, 0, 0, L, 96, W, 1, '#7a5a3a', null, { noJitter: true, surf: [DET.siding, 0.9, 0] });
  B.box('std', 0, 62, W / 2 + 0.4, L * 0.6, 30, 0.6, '#1a2024', null, S(0, 0.1, 0.2));
  B.box('vglass', L * 0.12, 62, W / 2 + 1, L * 0.3, 28, 0.4, '#8fa2ac', null, GLASS);
  B.box('std', 0, 46, W / 2 + 6, L * 0.62, 2, 12, '#6a4a30', null, WOOD);
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 104, s * (W / 4)], [L + 16, 2.4, W / 2 + 14], [s * 0.45, 0, 0], '#3a3430', { noJitter: true, surf: [DET.shingle, 0.85, 0] });
  sign(B, 'bp_host', 0, 86, W / 2 + 0.8, 44, 11, 0);
  sign(B, 'bp_rules', L / 2 + 0.6, 56, 0, 18, 27, HALF);
}

function hostsign(P) {
  const { B } = P;
  B.add('std', T.cyl(8), [0, 40, 0], [3.4, 80, 3.4], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 70, 0, 52, 15, 3, '#2a4a2e', null, WOOD);
  sign(B, 'bp_host', 0, 70, 1.7, 50, 12.5, 0);
  sign(B, 'bp_host', 0, 70, -1.7, 50, 12.5, PI);
}

/** The campfire circle's ring: big stones round a bed of ash, charred logs. */
function firering(P) {
  const { B, o } = P;
  const R = o.w / 2 - 6, r = B.rng;
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2;
    B.add('std', T.dodeca(), [Math.cos(a) * R, 6, Math.sin(a) * R], [r.range(8, 11), r.range(6, 9), r.range(8, 11)], [r.range(0, 3), r.range(0, 6), 0], mixHex('#7a7670', '#5a5650', r.next()), { noJitter: true, surf: [DET.rock, 0.9, 0] });
  }
  B.cyl('std', 0, 0, 0, R - 6, 1.6, '#3a3632', 18, 1, null, { noJitter: true, surf: [DET.char, 0.95, 0] });
  for (let k = 0; k < 5; k++) B.add('std', T.cyl(8), [r.range(-10, 10), 4, r.range(-10, 10)], [3, r.range(16, 26), 3], [HALF, r.range(0, 6), 0], '#1e1a16', { noJitter: true, surf: [DET.char, 0.9, 0], map: 'cyl' });
}

/** A half-log bench on two stumps. */
function logbench(P) {
  const { B, o } = P;
  const L = o.w;
  for (const s of [-1, 1]) B.cyl('std', s * (L / 2 - 14), 0, 0, 7, 14, LOG, 10, 1, null, BARK);
  B.add('std', T.cyl(10, 1, false), [0, 16, 0], [8, L, 8], [0, 0, HALF], '#8a6a48', { ...BARK, map: 'cyl' });
  B.box('std', 0, 22.6, 0, L - 2, 1, 12, '#a8845a', null, WOOD);
}

/** The amphitheatre's screen on posts and a lectern for the ranger talks. */
function campscreen(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * 80, 70, 0], [6, 140, 6], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 92, 0, 150, 84, 3, '#e8e4dc', null, S(0, 0.7, 0));
  decal(B, 'graf2', 0, 90, 1.8, 120, 44, 0);
  B.rblock('std', 0, 0, 40, 20, 40, 14, 1, '#6a4a30', null, WOOD);
  B.box('std', 0, 41, 38, 24, 2, 16, '#6a4a30', [-0.3, 0, 0], WOOD);
}

/** A picnic table with its benches (the world's own timber, weathered). */
function picnic(P) {
  const { B, o } = P;
  const L = o.w, D = o.h;
  const wood = '#8a7058';
  B.box('std', 0, 28, 0, L, 2.4, D * 0.5, wood, null, WOOD);
  for (const s of [-1, 1]) {
    B.box('std', 0, 16, s * D * 0.4, L, 2.4, 9, wood, null, WOOD);
    for (const x of [-L / 2 + 8, L / 2 - 8]) plank(B, 'std', [x, 0, s * D * 0.45], [x, 28, s * 3], 3, 3, shadeHex(wood, -0.2), WOOD);
  }
  const r = B.rng;
  if (r.chance(0.6)) for (let k = 0; k < 3; k++) B.cyl('std', r.range(-L / 3, L / 3), 29.2, r.range(-6, 6), r.range(2, 4), r.range(3, 8), r.pick(['#c8281e', '#e8e4dc', '#2a5ab0', '#3a3a3a']), 8, 1, null, PLAST);
}

function ringsmall(P) {
  const { B } = P;
  B.cyl('std', 0, 0, 0, 16, 9, '#3a3632', 14, 1, null, RUSTY);
  B.cyl('std', 0, 0.2, 0, 14.6, 9.4, '#2a2622', 14, 1, null, { noJitter: true, surf: [DET.char, 0.9, 0] });
  B.box('std', 8, 10, 0, 14, 0.8, 14, '#2a2a2a', null, METAL);
}

/** A dome tent (o.color fly over a grey inner), guy lines; some flattened. */
function tent(P) {
  const { B, o } = P;
  const L = o.w, W = o.h, r = B.rng;
  const flat = hash01(Math.round(o.x + o.y)) < 0.25;
  const col = o.color || '#c8641c';
  if (flat) {
    B.add('std', T.pillow(10, 6, 0.3), [0, 4, 0], [L / 2, 4, W / 2], [0, r.range(-0.3, 0.3), 0], col, FABRIC);
    floorDecal(B, 'blood3', 10, 10, 40, 30, 0.4, 0.4);
    return;
  }
  B.add('std', T.sphere(14, 8), [0, 0, 0], [L / 2, 42, W / 2], null, col, { ...FABRIC, wobble: { amp: 0.04, seed: 5 } });
  B.add('std', T.sphere(10, 6), [0, 0, W / 2 - 4], [L / 4, 30, 10], null, shadeHex(col, -0.15), FABRIC);
  B.add('std', T.box(), [0, 13, W / 2 + 5], [16, 24, 1], [-0.3, 0, 0], '#1a1a1a', NJ);
  for (const [x, z] of [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]]) rod(B, 'std', [x * 0.6, 26, z * 0.6], [x * 1.25, 0, z * 1.25], 0.15, '#e8e8e0', FABRIC, 3);
}

/** An A-frame tent: two pitched panels, the doors tied open, a sleeping bag half out. */
function tent2(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  const col = o.color || '#2a5a8a';
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 17, s * W * 0.22], [L, 1, W * 0.6], [s * 0.95, 0, 0], col, FABRIC);
  B.box('std', 0, 1, 0, L, 1.6, W * 0.85, shadeHex(col, -0.3), null, FABRIC);
  B.add('std', T.pillow(8, 6, 0.4), [L / 2 + 10, 3, 0], [16, 3, 8], [0, 0.3, 0], '#3a6a3a', FABRIC);
  rod(B, 'std', [-L / 2 - 2, 0, 0], [-L / 2 - 2, 34, 0], 0.6, '#8a8e92', CHROME, 4);
  rod(B, 'std', [L / 2 + 2, 0, 0], [L / 2 + 2, 34, 0], 0.6, '#8a8e92', CHROME, 4);
}

/** A site's post with its routed number and a lantern hook. */
function sitepost(P) {
  const { B, o } = P;
  const n = Math.max(1, Math.min(10, o.n || 1)) - 1;
  B.box('std', 0, 24, 0, 8, 48, 8, '#5a3a22', null, WOOD);
  for (const ry of [0, PI]) B.add('lvsign', T.plane(), [Math.sin(ry) * 4.3, 40, Math.cos(ry) * 4.3], [7, 7, 1], [0, ry, 0], '#ffffff', { uv: lvSub('bp_sitenums', n / 10, 0, (n + 1) / 10, 1), noAO: true, noJitter: true });
  B.cyl('std', 0, 48, 0, 1, 30, '#2a2a2a', 6, 1, null, METAL);
  plank(B, 'std', [0, 76, 0], [10, 76, 0], 1, 1, '#2a2a2a', METAL);
}

/** The motorhome: a tall box with a rounded nose, the windshield, side windows, the door, the livery,
 *  ladder and roof units, wheels. */
function rv(P) {
  const { B, o } = P;
  const L = o.w, W = o.h;
  const body = o.color || '#e8e4d8';
  const sk = { surf: [DET.panel, 0.45, 0.25] };
  B.block('std', 0, 8, 0, L * 0.94, 10, W * 0.86, '#1a1a1a', null, METAL);
  B.rblock('paint', -4, 16, 0, L - 8, 80, W, 6, body, null, sk);
  B.rblock('paint', L / 2 - 14, 16, 0, 20, 64, W - 2, 8, body, null, sk);
  B.box('std', L / 2 - 4, 66, 0, 6, 28, W - 8, '#1a2830', [0, 0, -0.2], S(0, 0.08, 0.3));
  for (const sd of [-1, 1]) {
    const z = sd * (W / 2 + 0.3);
    for (const [x, w] of [[-L * 0.32, 40], [-L * 0.08, 30], [L * 0.16, 34]]) B.box('std', x, 64, z, w, 20, 0.6, '#1a2024', null, S(0, 0.1, 0.2));
    B.add('lvsign', T.plane(), [-L * 0.05, 42, sd * (W / 2 + 0.5)], [L * 0.9, L * 0.9 / 8, 1], [0, sd > 0 ? 0 : PI, 0], '#ffffff', { uv: lvUV('bp_rv'), noAO: true, noJitter: true });
  }
  B.box('std', L * 0.28, 44, -W / 2 - 0.4, 24, 56, 0.8, shadeHex(body, -0.1), null, sk);
  B.rblock('std', L * 0.28, 0, -W / 2 - 12, 26, 14, 18, 1, '#6a6e72', null, METAL);
  for (let y = 24; y < 96; y += 9) B.box('std', -L / 2 - 1.2, y, W * 0.3, 1, 1, 10, '#8a8e92', null, CHROME);
  B.rblock('std', -L * 0.2, 96, 0, 30, 10, 24, 2, '#d8d8d0', null, PLAST);
  B.rblock('std', L * 0.15, 96, 0, 26, 8, 22, 2, '#d8d8d0', null, PLAST);
  for (const x of [-L * 0.3, L * 0.32]) for (const sd of [-1, 1]) wheel(B, x, 14, sd * (W / 2 - 6), 8, sd);
}

/** The RV's camp: the awning out on the road side, a rug, lawn chairs, a grill, a cooler, string lights. */
function rvcamp(P) {
  const { B, o, halos } = P;
  const L = 250, W = 62, r = B.rng;
  const z = -W / 2 - 50;
  B.add('std', T.box(), [0, 82, z + 4], [L * 0.6, 1.2, 96], [0.12, 0, 0], '#2a6a8a', FABRIC);
  for (let k = 0; k < 8; k++) B.box('std', -L * 0.3 + k * L * 0.6 / 7, 80, z + 4, L * 0.6 / 14, 1.4, 96, k % 2 ? '#e8e4dc' : '#2a6a8a', [0.12, 0, 0], FABRIC);
  for (const s of [-1, 1]) rod(B, 'std', [s * L * 0.3, 0, z - 40], [s * L * 0.3, 76, z - 40], 0.8, '#c8ccce', CHROME, 4);
  B.box('std', 0, 0.5, z, 120, 1, 70, '#8a3a2a', null, FABRIC);
  for (const [x, zz, a] of [[-30, z - 10, 0.3], [20, z - 20, -0.4]]) {
    B.box('std', x, 14, zz, 18, 1.4, 18, '#2a5a8a', [0, a, 0], FABRIC);
    B.add('std', T.box(), [x - Math.sin(a) * 9, 24, zz - Math.cos(a) * 9], [18, 20, 1.4], [-0.3, a, 0], '#2a5a8a', FABRIC);
  }
  B.add('std', T.box(), [70, 8, z - 30], [18, 1.4, 18], [HALF, 1.0, 0], '#2a5a8a', FABRIC);
  B.cyl('std', -80, 0, z - 20, 1.4, 26, '#2a2a2a', 6, 1, null, METAL);
  B.add('std', T.sphere(10, 6), [-80, 30, z - 20], [10, 6, 10], null, '#1a1a1a', METAL);
  B.rblock('std', 60, 0, z + 20, 26, 16, 16, 2, '#c62828', null, PLAST);
  B.box('std', 60, 16.4, z + 20, 26, 1.6, 16, '#e8e4dc', null, PLAST);
  // string lights along the awning's edge
  for (let k = 0; k < 14; k++) {
    const x = -L * 0.3 + k * (L * 0.6 / 13), y = 76 - Math.sin((k / 13) * PI) * 6;
    if (P.day) B.add('std', T.sphere(6, 4), [x, y, z - 42], [1.2, 1.6, 1.2], null, '#e8e0c8', S(0, 0.2, 0));
    else B.add('glow', T.sphere(6, 4), [x, y, z - 42], [1.2, 1.6, 1.2], null, r.pick(['#ffd080', '#ff9060', '#a0d0ff']), { emissive: 2.4, uv: atlasUV('white'), noAO: true, noJitter: true });
  }
  if (!P.day) { const [wx, wy] = toWorld(o, 0, z - 30); halos.push({ x: wx, y: wy, h: 70, color: '#ffd080', size: 120, strength: 0.4 }); }
  litter(B, -100, z - 50, 100, z + 20, 10, 0.5);
}

/** The shower block inside: stalls with curtains along the back wall, sinks and mirrors on the partition,
 *  benches, the signs over the doors, a light at each door. */
function showers(P) {
  const { B, o, halos } = P;
  const w = o.w, h = o.h, r = B.rng;
  for (const s of [-1, 1]) {
    const xc = s * w / 4;
    // stalls: partitions and curtains along the north wall
    for (let k = 0; k < 3; k++) {
      const x = xc + (k - 1) * 46;
      B.box('std', x - 23, 50, -h / 2 + 34, 2, 90, 56, '#c8ccd0', null, S(DET.panel, 0.4, 0.3));
      const open = r.chance(0.4);
      B.add('std', T.box(), [x + (open ? -10 : 0), 52, -h / 2 + 62], [open ? 16 : 40, 86, 1], [0, open ? 0.3 : 0, 0], r.pick(['#e8e4dc', '#8ab0c8', '#c8d8c0']), FABRIC);
      B.cyl('std', x, 100, -h / 2 + 16, 2, 4, '#c8ccce', 8, 1, [HALF, 0, 0], CHROME);
    }
    B.box('std', xc + 70, 50, -h / 2 + 34, 2, 90, 56, '#c8ccd0', null, S(DET.panel, 0.4, 0.3));
    // sinks on the partition, a mirror over them
    const xs = s * 14;
    B.box('std', xs, 34, 30, 16, 6, 70, '#e8e8e4', null, S(0, 0.3, 0));
    for (const z of [10, 50]) B.cyl('std', xs + s * 0.4, 36, z, 6, 2, '#f0f0ec', 12, 1, null, S(0, 0.2, 0));
    B.box('std', s * 7.4, 66, 30, 0.6, 30, 64, '#a8b8c0', null, S(0, 0.05, 0.9));
    B.rblock('std', xc, 0, h / 2 - 34, 60, 16, 14, 1, '#6a4a30', null, WOOD);
    // the signs over the doors outside, the lamps
    sign(B, s < 0 ? 'bp_men' : 'bp_women', s * 90, 92, h / 2 + 8.4, 32, 12, 0);
    B.box('std', s * 90, 100, h / 2 + 10, 10, 6, 6, '#2a2a2a', null, METAL);
    if (!P.day) { const [wx, wy] = toWorld(o, s * 90, h / 2 + 14); halos.push({ x: wx, y: wy, h: 98, color: '#fff0d0', size: 50, strength: 0.6 }); B.add('glow', T.box(), [s * 90, 97, h / 2 + 12], [7, 2, 4], null, '#fff0d0', { emissive: 2.6, uv: atlasUV('white'), noAO: true }); }
    tubeFixture(B, P.halos, xc, 104, 0, 0, r.chance(0.3) ? 'flicker' : 'lit');
  }
  for (let k = 0; k < 5; k++) floorDecal(B, r.pick(['grime', 'blood3', 'grime']), r.range(-w / 2 + 30, w / 2 - 30), r.range(-h / 2 + 30, h / 2 - 30), r.range(20, 50), r.range(20, 40), r.range(0, 6), 0.55);
  decal(B, 'hands', -w / 2 + 7.4, 50, 20, 30, 30, HALF);
}

function spigot(P) {
  const { B } = P;
  B.cyl('std', 0, 0, 0, 1.6, 30, '#6a6e72', 8, 1, null, RUSTY);
  B.box('std', 3, 28, 0, 6, 2, 2, '#8a8e92', null, CHROME);
  B.rblock('std', 0, 0, 0, 30, 2, 30, 2, '#8a8478', null, CONC);
  floorDecal(B, 'grime', 4, 6, 26, 20, 0.3, 2.5, '#6a7a8a');
}

/** The campground's bulletin board: rules, the fire danger dial, a missing poster, the bear warning. */
function campboard(P) {
  const { B } = P;
  for (const s of [-1, 1]) B.add('std', T.cyl(8), [s * 52, 60, 0], [5, 120, 5], null, LOG, { ...BARK, map: 'cyl' });
  B.box('std', 0, 80, 0, 100, 70, 4, '#5a3a22', null, WOOD);
  sign(B, 'bp_danger', -22, 84, 2.2, 52, 39, 0);
  sign(B, 'bp_missing', 22, 86, 2.2, 22, 33, 0);
  sign(B, 'bp_rules', 42, 80, 2.2, 14, 21, 0);
  sign(B, 'bp_bear', -22, 84, -2.2, 26, 32.5, PI);
  sign(B, 'bp_tally', 20, 84, -2.2, 50, 25, PI, { bucket: 'lvdecal' });
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 122, s * 9], [116, 2.4, 22], [s * 0.5, 0, 0], '#3a3430', { noJitter: true, surf: [DET.shingle, 0.85, 0] });
}

/** The firewood stand: a rack of split bundles under a little roof, the honour box. */
function firewood(P) {
  const { B, o } = P;
  const L = o.w, D = o.h, r = B.rng;
  for (const [x, z] of [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]]) B.box('std', x, 34, z, 4, 68, 4, '#5a3a22', null, WOOD);
  B.add('std', T.box(), [0, 70, 0], [L + 10, 2, D + 10], [0.15, 0, 0], '#4a3a2a', { noJitter: true, surf: [DET.metalroof, 0.6, 0.3] });
  for (let i = 0; i < 4; i++) for (let k = 0; k < 2; k++) {
    const x = -L / 2 + 12 + i * (L - 24) / 3, y = 4 + k * 14;
    for (let j = 0; j < 5; j++) B.add('std', T.cyl(5), [x + r.range(-4, 4), y + (j % 2) * 4, r.range(-D / 3, D / 3)], [2.4, 20, 2.4], [HALF, HALF, 0], '#a8845a', { ...BARK, map: 'cyl' });
  }
  B.rblock('std', L / 2 + 8, 30, 0, 8, 12, 8, 1, '#3a5a3a', null, METAL);
}

export const CAMP_MODELS = {
  'bp-wheelstop': wheelstop, 'bp-opencar': opencar, 'bp-kiosk': kiosk, 'bp-outhouse': outhouse, 'bp-bearbin': bearbin, 'bp-trailsign': trailsign,
  'bp-forestsign': forestsign, 'bp-camparch': camparch, 'bp-checkin': checkin, 'bp-hostsign': hostsign, 'bp-firering': firering, 'bp-logbench': logbench,
  'bp-campscreen': campscreen, 'bp-picnic': picnic, 'bp-ringsmall': ringsmall, 'bp-tent': tent, 'bp-tent2': tent2, 'bp-sitepost': sitepost, 'bp-rv': rv,
  'bp-rvcamp': rvcamp, 'bp-showers': showers, 'bp-spigot': spigot, 'bp-campboard': campboard, 'bp-firewood': firewood,
};
export const CAMP_GATES = { 'bp-campgate': campgate };
void [pendant, carton, hash01, PLAST, CONC];
