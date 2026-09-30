// Upgrade models (world-hideout.js registry): what each tier of each hideout upgrade adds.
// The hideout's upgrade layer (a separate set of merged meshes, rebuilt when the crew buys
// something) calls `up_<kind>` once per BUILT tier with { tier }, so a model draws only what
// its tier ADDS on top of the tiers below it (tier 0 = the unbuilt "site", drawn only while
// nothing is built). The frame is the slot's: local +x along it.a, +z to its right.
//
//   generator   1 a running genset + cable   2 a tin shed, batteries, drums   3 solar panels, a stack
//   watchtower  1 a stilt platform + guard   2 a second deck, a searchlight  3 a cabin, gun nest, flag
//   infirmary   1 tent, cots, a red-cross lamp   2 floor, shelves, stove   3 a ward with curtains
//   armory      1 tent, gun rack, crates   2 a locker cage, sandbags   3 floor, reloading bench, pegboard
//   radiomast   1 a 200-unit lattice mast   2 a dish and yagis (to 290)  3 a radar bar, beacons (to 400)
//   garden      1 fence and 4 beds   2 8 beds, crops   3 12 beds, a greenhouse, sunflowers
//   palisade    1 the south wall of logs   2 the sides   3 the north, gate towers with braziers

import {
  T, S, WOOD, RUSTY, CANVAS, METAL, CORR, C, DET, shadeHex, mixHex, hash01, atlasUV,
  post, line, crate, barrel, jerrycan, mug, stump, sandbagRun, bulb, lantern, pic, pic2, rod, plank, ridgeTent, tarpSheet, cot, stringLights,
} from './world-hideout-kit.js';

const HALF = Math.PI / 2;

/** Point (world) → the slot frame. */
function toLocal(it, wx, wy) {
  const c = Math.cos(it.a || 0), s = Math.sin(it.a || 0);
  const dx = wx - it.x, dy = wy - it.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}
/** Point (slot frame) → world. */
function toWorld(it, lx, lz) {
  const c = Math.cos(it.a || 0), s = Math.sin(it.a || 0);
  return [it.x + lx * c - lz * s, it.y + lx * s + lz * c];
}

// ---- small models shared by several upgrades --------------------------------------------------------

/** A friendly guard, seen as a dark silhouette with a rim of lamplight: legs, coat, cap, a rifle across the chest. */
function guard(B, x, y0, z, yaw = 0, o = {}) {
  const coat = o.coat || '#2c3238', trousers = '#22262b', skin = '#a87a5a';
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (fx, fy, fz) => [x + fx * c - fz * s, y0 + fy, z + fx * s + fz * c];
  const at = (fx, fy, fz) => P(fx, fy, fz);
  for (const sz of [-1, 1]) rod(B, 'std', at(0, 0, sz * 2.4), at(0, 22, sz * 2.4), 1.9, trousers, S(DET.fabric, 0.9, 0), 6);
  rod(B, 'std', at(0, 20, 0), at(0, 38, 0), 5.2, coat, S(DET.fabric, 0.9, 0), 8, 0.9);
  B.add('std', T.sphere(8, 6), at(0, 43.5, 0), [3.7, 4, 3.7], null, skin, S(DET.fabric, 0.85, 0));
  B.add('std', T.cyl(8, 0.9), at(0, 47.4, 0), [4.4, 2.4, 4.4], null, coat, S(DET.fabric, 0.9, 0));
  B.box('std', ...at(2.6, 46.6, 0), 3, 0.8, 6.4, coat, [0, -yaw, 0], S(DET.fabric, 0.9, 0));
  // arms up to the rifle
  for (const sz of [-1, 1]) rod(B, 'std', at(0, 36, sz * 5), at(4.5, 30, sz * 1.8), 1.5, coat, S(DET.fabric, 0.9, 0), 5);
  rod(B, 'std', at(-8, 27, -3), at(13, 34, 3), 1.1, '#1c1e20', METAL, 5);
  rod(B, 'std', at(-9, 25, -3), at(-4, 30, -3), 1.7, '#5a4028', WOOD, 5);
}

/** A rifle lying along the direction (yaw, pitch) from its middle point. */
function rifle(B, x, y, z, yaw = 0, pitch = 0, len = 34, kind = 'rifle') {
  const cp = Math.cos(pitch), f = [cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw)];
  const P = (t, dy = 0) => [x + f[0] * t, y + f[1] * t + dy, z + f[2] * t];
  const metal = '#24272b', wood = '#6a4a2c';
  if (kind === 'shotgun') {
    rod(B, 'std', P(-len * 0.1), P(len * 0.5), 1.35, metal, METAL, 5);
    rod(B, 'std', P(-len * 0.1, -1.6), P(len * 0.4, -1.6), 1.1, metal, METAL, 5);
    rod(B, 'std', P(-len * 0.5, -1), P(-len * 0.1), 2.2, wood, WOOD, 5);
    rod(B, 'std', P(len * 0.05, -1.6), P(len * 0.32, -1.6), 2, wood, WOOD, 5);
    return;
  }
  rod(B, 'std', P(-len * 0.05), P(len * 0.5), 0.9, metal, METAL, 5);
  rod(B, 'std', P(-len * 0.32), P(len * 0.06), 1.8, metal, METAL, 5);
  rod(B, 'std', P(-len * 0.5, -1.2), P(-len * 0.32), 2, wood, WOOD, 5);
  rod(B, 'std', P(-len * 0.12, -3.6), P(-len * 0.1, -0.5), 1.3, metal, METAL, 5);
  rod(B, 'std', P(len * 0.1), P(len * 0.34), 1.3, wood, WOOD, 5);
  B.box('std', ...P(-len * 0.16, 2.4), 6, 1.6, 1.6, metal, [0, -yaw, pitch], METAL);
}

/** A crate stack with stencilled lettering (an ammunition or supply stash). */
function stash(B, x, z, rot = 0, n = 5, col = C.wood) {
  for (let i = 0; i < n; i++) {
    const row = i < 3 ? 0 : 1;
    const k = i < 3 ? i : i - 3;
    crate(B, x + Math.cos(rot) * (k - 1) * 16 - Math.sin(rot) * row * 1.5, row * 15, z + Math.sin(rot) * (k - 1) * 16 + Math.cos(rot) * row * 1.5, 15, rot + (i - 2) * 0.05, i % 2 ? col : shadeHex(col, -0.08));
  }
}

/** A lattice mast (3 legs) from y0 to y1, radius r0 at y0 and r1 at y1, with rings and diagonals. */
function lattice(B, y0, y1, r0, r1, seg = 34, color = '#9a9ea2') {
  const n = Math.max(1, Math.round((y1 - y0) / seg));
  const rAt = (y) => r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  const leg = (r, y, k) => [Math.cos(HALF + (k * Math.PI * 2) / 3) * r, y, Math.sin(HALF + (k * Math.PI * 2) / 3) * r];
  for (let k = 0; k < 3; k++) rod(B, 'std', leg(r0, y0, k), leg(r1, y1, k), 1.0, color, RUSTY, 5);
  for (let i = 0; i < n; i++) {
    const ya = y0 + (i * (y1 - y0)) / n, yb = y0 + ((i + 1) * (y1 - y0)) / n;
    const ra = rAt(ya), rb = rAt(yb);
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      rod(B, 'std', leg(ra, ya, k), leg(rb, yb, k2), 0.45, color, RUSTY, 4);
      rod(B, 'std', leg(ra, ya, k), leg(ra, ya, k2), 0.5, color, RUSTY, 4);
    }
  }
}

/** A parabolic dish facing local +x (radius r) with its feed horn, centre c. */
function dishAt(B, c, r, tilt = 0.1, color = '#d8dad6') {
  const pts = [[0, 0], [r * 0.25, r * 0.03], [r * 0.5, r * 0.12], [r * 0.75, r * 0.27], [r, r * 0.48], [r, r * 0.5], [r * 0.96, r * 0.5], [r * 0.7, r * 0.26], [r * 0.45, r * 0.1], [0, -0.4]];
  B.add('std', T.lathe('dish' + r, pts, 14), c, [1, 1, 1], [0, 0, -HALF + tilt], color, S(DET.panel, 0.4, 0.5));
  const fx = c[0] + r * 0.62, fy = c[1] + r * 0.12;
  rod(B, 'std', [c[0] + 1, c[1], c[2]], [fx, fy, c[2]], 0.55, '#3a3c40', METAL, 4);
  B.box('std', fx + 0.6, fy, c[2], 2.4, 2.4, 2.4, '#2a2c30', null, METAL);
  rod(B, 'std', c, [c[0] - 4, c[1] - 10, c[2]], 1.6, '#4a4e52', METAL, 5);
}

// =====================================================================================================
// generator

function up_generator(P) {
  const { B, it, dyn, halos } = P;
  const t = it.tier;
  if (t === 0) {
    // the site: a genset under a tarp, jerry cans, a hand-written tag
    crate(B, -8, 0, 0, 24, 0.2, '#6a5a44', { w: 34, d: 26, h: 22 });
    tarpSheet(B, [[-26, 28, -19], [22, 28, -19], [22, 12, 21], [-26, 12, 21]], '#3a5a8a', 3);
    for (const [x, z, r] of [[28, -10, 0.2], [32, -3, 1.3], [30, 8, -0.4]]) jerrycan(B, x, 0, z, r, '#a8382a');
    pic(B, 'tag', 20, 24, 21, 12, 6, 0, { rx: -0.3 });
    return;
  }
  if (t === 1) {
    B.rblock('std', 0, 0, 0, 46, 3, 30, 0.6, '#2f3438', null, METAL);
    B.rblock('std', -6, 3, 0, 26, 20, 22, 1.2, '#4c5a3a', null, METAL);
    for (let i = 0; i < 5; i++) B.box('std', -6, 8 + i * 3.4, 11.4, 24, 0.8, 0.6, '#2a3220', null, METAL);
    B.rblock('std', 14, 3, 0, 16, 15, 19, 1, '#3a4a5a', null, METAL);
    B.cyl('std', 24, 8, 0, 6, 8, '#2a3038', 12, 1, [0, 0, HALF], METAL);
    B.rblock('std', -6, 23, 0, 22, 8, 16, 2, '#a83a2a', null, METAL);
    B.cyl('std', -12, 31, 0, 2.2, 2.6, '#222', 8, 1, null, METAL);
    // muffler and stack
    B.cyl('std', -21, 6, 8, 3.4, 14, '#5a5e62', 8, 1, null, RUSTY);
    rod(B, 'std', [-21, 20, 8], [-21, 44, 8], 1.2, '#3a3c40', RUSTY, 6);
    // control panel with sockets and a green light
    B.rblock('std', 4, 12, 15.6, 16, 9, 2.6, 0.5, '#d8d8d0', null, METAL);
    for (const x of [0, 5, 9]) B.cyl('std', x, 15.8, 17, 1.2, 0.8, '#1a1a1a', 8, 1, [HALF, 0, 0], METAL);
    B.add('blink', T.sphere(6, 4), [9, 20, 16.6], [1, 1, 1], null, '#5dff8a', { emissive: 3.6 });
    halos.push({ x: it.x + 9, y: it.y + 16.6, h: 20, color: '#5dff8a', size: 26, blink: 1, strength: 0.6 });
    // wheels and a handle
    for (const s of [-1, 1]) B.add('std', T.torus(10, 0.32, 5), [-18, 4.6, s * 16.5], [4.6, 4.6, 4.6], [0, 0, 0], '#1b1b1c', S(DET.rubber, 0.9, 0));
    rod(B, 'std', [22, 4, -14], [34, 20, -14], 1, '#3a3e42', METAL, 5);
    rod(B, 'std', [22, 4, 14], [34, 20, 14], 1, '#3a3e42', METAL, 5);
    rod(B, 'std', [34, 20, -14], [34, 20, 14], 1, '#3a3e42', METAL, 5);
    jerrycan(B, 30, 0, -22, 0.1, '#a8382a');
    jerrycan(B, 30, 0, 20, -0.3, '#2f6a3a');
    // the heavy cable to the workbench
    if (it.cable) {
      const pts = it.cable.map(([wx, wy]) => toLocal(it, wx, wy));
      for (let i = 0; i + 1 < pts.length; i++) {
        rod(B, 'std', [pts[i][0], 1.3, pts[i][1]], [pts[i + 1][0], 1.3, pts[i + 1][1]], 1.1, '#1c1c1e', S(DET.rubber, 0.8, 0), 5);
        if (i % 2 === 0) B.box('std', pts[i][0], 0.9, pts[i][1], 4, 0.8, 3, '#e0a020', [0, 0.3, 0], METAL);
      }
    }
    const [wx, wy] = toWorld(it, -21, 8);
    dyn.smoke.push({ x: wx, y: wy, h: 44, rate: 1.6, r: 2, warm: 0, up: 'generator' });
    return;
  }
  if (t === 2) {
    // a tin shed round it, batteries and fuel drums, a breaker pole
    for (const [x, z, h] of [[-40, -30, 64], [40, -30, 64], [-40, 30, 52], [40, 30, 52]]) post(B, x, 0, z, 2, h, C.woodD, WOOD, 5);
    const pitch = Math.atan2(12, 60);
    B.add('std', T.box(), [0, 60, 0], [96, 1.6, 74], [pitch, 0, 0], '#8f979c', CORR);
    B.box('std', 0, 66, -38, 96, 3, 3, '#6a6e72', null, METAL);
    for (const x of [-30, 0, 30]) rod(B, 'std', [x, 64, -30], [x, 52, 30], 1, C.woodD, WOOD, 5);
    // batteries: a row of black boxes with terminals and a heavy cable
    for (let i = 0; i < 3; i++) {
      B.rblock('std', -36 + i * 12, 0, -24, 10, 10, 8, 0.6, '#1e2226', null, METAL);
      B.cyl('std', -38 + i * 12, 10, -24, 0.9, 1.6, '#c9a02a', 5, 1, null, METAL);
      B.cyl('std', -34 + i * 12, 10, -24, 0.9, 1.6, '#a83a2a', 5, 1, null, METAL);
    }
    barrel(B, 44, 0, -14, '#3b5f8a', 30, 10);
    barrel(B, 44, 0, 8, '#8a3b2a', 30, 10);
    // breaker box on a pole
    post(B, 46, 0, 28, 1.8, 50, '#3a3e42', METAL, 5);
    B.rblock('std', 46, 34, 26, 14, 20, 6, 0.6, '#5a5e62', null, METAL);
    B.box('std', 46, 42, 22.6, 8, 3, 0.4, '#e0b020', null, { surf: [0, 0.5, 0.2] });
    lantern(B, P.halos, -30, 62, 4, ...toWorld(it, -30, 4), { h: 9, hang: 6, halo: 40, strength: 0.4 });
    return;
  }
  // tier 3: solar panels on the shed roof, a taller stack and a bank of glowing meters
  for (let i = 0; i < 3; i++) {
    const x = -28 + i * 28;
    B.add('std', T.box(), [x, 68, -8], [24, 1.4, 34], [-0.45, 0, 0], '#1c2a44', S(DET.glass, 0.25, 0.6));
    for (let g = 1; g < 3; g++) B.box('std', x, 68.6, -8, 24, 0.4, 0.5, '#8fa0b8', [-0.45, 0, 0], METAL);
    rod(B, 'std', [x - 10, 60, 4], [x - 10, 70, -18], 0.7, '#5a5e62', METAL, 4);
    rod(B, 'std', [x + 10, 60, 4], [x + 10, 70, -18], 0.7, '#5a5e62', METAL, 4);
  }
  rod(B, 'std', [-21, 44, 8], [-21, 88, 8], 1.4, '#3a3c40', RUSTY, 6);
  B.cyl('std', -21, 88, 8, 2.4, 3, '#2a2c30', 8, 1.4, null, RUSTY);
  for (let i = 0; i < 4; i++) B.add('glow', T.plane(), [-6 + i * 6, 40, 30.6], [4, 3, 1], null, ['#5dff8a', '#ffd15d', '#5dff8a', '#5dff8a'][i], { emissive: 3.4, uv: atlasUV('white'), noAO: true });
  B.rblock('std', 6, 34, 30, 30, 12, 3, 0.6, '#2a2e32', null, METAL);
  halos.push({ x: it.x + 6, y: it.y + 30, h: 40, color: '#8aff9a', size: 44, strength: 0.4 });
}

// =====================================================================================================
// watchtower

function up_watchtower(P) {
  const { B, it, halos, dyn } = P;
  const t = it.tier;
  const legs = (y0, y1, r0, r1) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(B, 'std', [sx * r0, y0, sz * r0], [sx * r1, y1, sz * r1], 2.4, C.woodD, WOOD, 6);
  };
  const deck = (y, w, rail = true, gap = 'z+') => {
    B.rblock('std', 0, y, 0, w, 3, w, 0.5, '#7a5a38', null, WOOD);
    for (let i = -2; i <= 2; i++) B.box('std', i * (w / 5), y + 3.2, 0, 0.5, 0.3, w - 1, '#3a2a1c', null, WOOD);
    if (!rail) return;
    const h = 24;
    for (const [x, z, w2, d2, skip] of [[0, -w / 2 + 1, w, 2, false], [-w / 2 + 1, 0, 2, w, false], [w / 2 - 1, 0, 2, w, false], [0, w / 2 - 1, w, 2, true]]) {
      if (skip && gap) { for (const sx of [-1, 1]) B.box('std', sx * (w / 2 - 4), y + 3 + h * 0.5, w / 2 - 1, 8, 2, 2, C.woodD, null, WOOD); continue; }
      B.box('std', x, y + 3 + h * 0.5, z, w2, 2, d2, C.woodD, null, WOOD);
      B.box('std', x, y + 3 + h, z, w2, 2.4, d2, C.woodD, null, WOOD);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(B, sx * (w / 2 - 1), y + 3, sz * (w / 2 - 1), 1.4, h, C.woodD, WOOD, 5);
  };
  const braces = (y0, y1, r) => {
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      rod(B, 'std', [ax * r, y0, az * r], [bx * r, y1, bz * r], 1, C.woodD, WOOD, 5);
      rod(B, 'std', [bx * r, y0, bz * r], [ax * r, y1, az * r], 1, C.woodD, WOOD, 5);
    }
  };
  const ladder = (y0, y1, z) => {
    for (const sx of [-1, 1]) rod(B, 'std', [sx * 5, y0, z], [sx * 5, y1, z - 6], 1, C.woodL, WOOD, 5);
    for (let y = y0 + 6; y < y1; y += 8) B.box('std', 0, y, z - ((y - y0) / (y1 - y0)) * 6, 10, 1.2, 1.4, C.woodL, null, WOOD);
  };
  if (t === 0) {
    // the site: a lumber pile, sawhorses, survey stakes with twine, a half-set corner post
    for (let i = 0; i < 6; i++) B.box('std', -6, 2 + i * 3.6, -8 + (i % 2) * 2, 64, 3.2, 9, i % 2 ? '#a8865a' : '#9a7a50', [0, 0.05 * i, 0], WOOD);
    for (let i = 0; i < 4; i++) rod(B, 'std', [-40, 3 + i * 4, 12], [30, 3 + i * 4, 18], 2.4, C.woodL, WOOD, 6);
    for (const s of [-1, 1]) {
      rod(B, 'std', [s * 12, 0, 22], [s * 16, 18, 24], 1, C.woodD, WOOD, 4);
      rod(B, 'std', [s * 12, 0, 22], [s * 8, 18, 24], 1, C.woodD, WOOD, 4);
    }
    B.box('std', 0, 18.5, 24, 34, 3, 6, C.wood, null, WOOD);
    for (const [x, z] of [[-22, -22], [22, -22], [22, 22], [-22, 22]]) { post(B, x, 0, z, 0.7, 26, '#c9a02a', WOOD, 4); B.box('std', x, 26, z, 3, 2, 0.6, '#d84a2a', null, CANVAS); }
    for (const [ax, az, bx, bz] of [[-22, -22, 22, -22], [22, -22, 22, 22], [22, 22, -22, 22], [-22, 22, -22, -22]]) rod(B, 'std', [ax, 22, az], [bx, 22, bz], 0.22, '#e8dcb0', S(DET.fabric, 0.9, 0), 3);
    post(B, -22, 0, -22, 2.4, 44, C.woodD, WOOD, 6);
    pic(B, 'blueprint', 0, 28, -30, 32, 22, Math.PI);
    return;
  }
  if (t === 1) {
    legs(0, 84, 24, 18);
    braces(14, 70, 21);
    B.cyl('std', 0, 0, 0, 26, 1.4, '#5a4e40', 4, 1, [0, Math.PI / 4, 0], S(DET.dirt, 0.95, 0));
    deck(84, 44);
    ladder(0, 84, 27);
    // sandbags along the front rail, a lantern on a bracket
    sandbagRun(B, -18, -18, 18, -18, 1);
    guard(B, -4, 87, -6, HALF, {});
    rod(B, 'std', [16, 108, -16], [16, 118, -16], 0.5, '#2a2622', METAL, 4);
    lantern(B, halos, 16, 114, -16, ...toWorld(it, 16, -16), { h: 9, halo: 60, strength: 0.6 });
    return;
  }
  if (t === 2) {
    legs(84, 132, 18, 14);
    braces(90, 128, 16);
    deck(132, 36, true, '');
    ladder(84, 132, 20);
    guard(B, 5, 135, 4, HALF * 0.4, { coat: '#3a3e2a' });
    // the searchlight: a drum can on a swivel at the front corner
    rod(B, 'std', [-10, 135, -12], [-10, 146, -12], 1.3, '#3a3e42', METAL, 6);
    B.cyl('std', -10, 145, -12, 5.6, 13, '#34383c', 12, 1, [0, 0, HALF], METAL);
    B.cyl('glow', -3.4, 151.6, -12, 4.4, 1, '#fff6e0', 12, 1, [0, 0, HALF], { emissive: 5, uv: atlasUV('white'), noAO: true });
    const [wx, wy] = toWorld(it, -10, -12);
    halos.push({ x: wx, y: wy, h: 151, color: '#fff2d6', size: 90, strength: 0.7 });
    dyn.searchlights.push({ id: 'wt', x: wx, y: wy, h: 151, a0: HALF, arc: 1.15, speed: 0.32, range: 660, up: 'watchtower' });
    return;
  }
  // tier 3: the cabin: legs on to 176, a walled top deck with a roof, a gun nest, a flag
  legs(132, 176, 14, 12);
  braces(138, 172, 13);
  B.rblock('std', 0, 176, 0, 34, 3, 34, 0.5, '#7a5a38', null, WOOD);
  for (const [x, z, w, d] of [[0, -16, 34, 2], [-16, 0, 2, 34], [16, 0, 2, 34]]) B.rblock('std', x, 179, z, w, 22, d, 0.5, '#8a6a44', null, WOOD);
  B.rblock('std', 0, 179, 16, 8, 22, 2, 0.5, '#8a6a44', null, WOOD);
  B.rblock('std', 0, 201, 16, 34, 3, 2, 0.5, '#6a4a30', null, WOOD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(B, sx * 16, 176, sz * 16, 1.6, 40, C.woodD, WOOD, 5);
  const pitch = Math.atan2(10, 20);
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 224, s * 10], [46, 1.6, 26], [s * pitch, 0, 0], '#7a6a5a', CORR);
  B.box('std', 0, 230.6, 0, 46, 2, 3, '#5a5e62', null, METAL);
  // window slits glowing warm, a lamp inside
  B.add('glow', T.plane(), [0, 192, 16.8], [20, 5, 1], null, '#ffcf8a', { emissive: 3, uv: atlasUV('white'), noAO: true });
  // machine-gun nest on the lower deck: a ring of sandbags with a tripod gun
  sandbagRun(B, -16, 14, 16, 14, 2);
  rod(B, 'std', [0, 135, 4], [0, 147, 10], 1, '#24272b', METAL, 5);
  rod(B, 'std', [-4, 135, 8], [0, 147, 10], 1, '#24272b', METAL, 5);
  rod(B, 'std', [4, 135, 8], [0, 147, 10], 1, '#24272b', METAL, 5);
  rod(B, 'std', [-6, 148, 10], [16, 148, 10], 1.4, '#1c1e20', METAL, 6);
  B.box('std', 2, 148, 10, 10, 4, 3, '#24272b', null, METAL);
  // a flag on the roof
  rod(B, 'std', [0, 231, 0], [0, 270, 0], 0.6, '#c8ccd0', METAL, 5);
  B.add('std', T.box(), [8, 264, 0], [16, 10, 0.5], [0, 0, -0.06], '#c0392b', CANVAS);
  B.add('std', T.box(), [8, 264, 0.3], [6, 2, 0.4], [0, 0, -0.06], '#f0e6c8', CANVAS);
  guard(B, 0, 179, 2, HALF, {});
  const [lx, ly] = toWorld(it, 14, -14);
  lantern(B, halos, 14, 206, -14, lx, ly, { h: 9, hang: 8, halo: 60, strength: 0.6 });
}

// =====================================================================================================
// infirmary & armory (a tent at the slot; the entrance faces +x)

function tentShell(P, color, roofColor, wh = 40, rh = 74) {
  const { B, it } = P;
  const L = it.w || 150, W = it.h || 104;
  ridgeTent(B, L - 6, W - 6, wh, rh, color, { open: true });
  // a valance and a doorway frame at the open end
  for (const s of [-1, 1]) post(B, L / 2 - 3, 0, s * (W / 2 - 6), 1.6, wh + 4, C.woodD, WOOD, 5);
  void roofColor;
}

function up_infirmary(P) {
  const { B, it, halos } = P;
  const t = it.tier;
  const L = it.w || 150, W = it.h || 104;
  if (t === 0) {
    // the site: bare poles, a torn tarp, one cot on the ground, a crate with a red cross
    for (const [x, z] of [[-L / 2 + 10, -W / 2 + 10], [-L / 2 + 10, W / 2 - 10], [L / 2 - 10, -W / 2 + 10], [L / 2 - 10, W / 2 - 10]]) post(B, x, 0, z, 1.8, 58, C.woodD, WOOD, 5);
    rod(B, 'std', [-L / 2 + 10, 58, -W / 2 + 10], [-L / 2 + 10, 58, W / 2 - 10], 1.2, C.woodD, WOOD, 5);
    tarpSheet(B, [[-L / 2 + 10, 58, -W / 2 + 10], [-L / 2 + 44, 50, -W / 2 + 10], [-L / 2 + 44, 46, W / 2 - 10], [-L / 2 + 10, 58, W / 2 - 10]], '#6a7a6a', 3);
    cot(B, -20, 10, 0.1, '#5a6a7a');
    crate(B, 30, 0, -24, 16, 0.2, '#d8d4c0');
    pic(B, 'cross', 30, 8, -15.4, 10, 10, 0);
    return;
  }
  if (t === 1) {
    tentShell(P, '#d2cfba', '#d8d4c0', 40, 74);
    // the red cross lamp on a pole by the door: a lit cross
    post(B, L / 2 + 6, 0, -W / 2 + 2, 1.6, 84, '#5a5e62', METAL, 6);
    B.box('std', L / 2 + 6, 84, -W / 2 + 2, 2, 16, 16, '#e8e8e0', null, METAL);
    B.box('glow', L / 2 + 7.2, 84, -W / 2 + 2, 0.5, 14, 4.4, '#ff2a2a', null, { emissive: 4.2, uv: atlasUV('white'), noAO: true });
    B.box('glow', L / 2 + 7.2, 84, -W / 2 + 2, 0.5, 4.4, 14, '#ff2a2a', null, { emissive: 4.2, uv: atlasUV('white'), noAO: true });
    halos.push({ x: it.x + L / 2 + 8, y: it.y - W / 2 + 2, h: 84, color: '#ff3a3a', size: 110, strength: 0.7 });
    pic(B, 'cross', L / 2 - 4, 46, 0, 22, 22, HALF);
    // two cots with blankets, a supply crate, an IV stand
    cot(B, -22, -22, 0, '#7a3a3a');
    cot(B, -22, 22, 0, '#3a5a7a');
    crate(B, -L / 2 + 14, 0, 0, 16, 0.1, '#d8d4c0');
    pic(B, 'cross', -L / 2 + 22.2, 8, 0, 9, 9, HALF);
    rod(B, 'std', [8, 0, -32], [8, 44, -32], 0.7, '#c8ccd0', METAL, 5);
    rod(B, 'std', [8, 44, -32], [14, 44, -32], 0.6, '#c8ccd0', METAL, 5);
    B.add('std', T.pillow(8, 5, 0.5), [14, 40, -32], [2.2, 3.4, 1.4], null, '#e8e2c8', S(DET.plastic, 0.4, 0));
    rod(B, 'std', [14, 37, -32], [14, 24, -30], 0.18, '#d8d8d0', S(0, 0.5, 0), 3);
    return;
  }
  if (t === 2) {
    // a plank floor, a medicine shelf, a camp stove with a sterilising pot, a basin on a stool
    B.rblock('std', 0, 0, 0, L - 10, 2.4, W - 10, 0.5, '#8a6a44', null, WOOD);
    for (let i = 1; i < 8; i++) B.box('std', 0, 2.5, -W / 2 + 5 + (i * (W - 10)) / 8, L - 10, 0.2, 0.5, '#3a2a1c', null, WOOD);
    B.box('std', -L / 2 + 8, 34, 0, 3, 2, 60, C.woodD, null, WOOD);
    B.box('std', -L / 2 + 8, 46, 0, 3, 2, 60, C.woodD, null, WOOD);
    const rnd = B.rng;
    for (let i = 0; i < 11; i++) {
      const z = -26 + (i % 6) * 10.4, y = i < 6 ? 35 : 47;
      B.cyl('glass', -L / 2 + 8, y, z, 2 + rnd.next(), 5 + rnd.next() * 3, ['#9fc8a0', '#c8a870', '#a0b8d8', '#d8d0c0'][i % 4], 8, 1, null, S(0, 0.15, 0.1));
      B.cyl('std', -L / 2 + 8, y + 6, z, 1.4, 1.2, '#e8e2d0', 6, 1, null, S(DET.plastic, 0.4, 0));
    }
    B.rblock('std', 20, 0, 34, 14, 10, 12, 0.8, '#3a3e42', null, METAL);
    B.cyl('std', 20, 10, 34, 4.8, 8, '#a8acb0', 10, 1, null, METAL);
    B.cyl('std', 20, 18, 34, 5, 0.8, '#8a8e92', 10, 1, null, METAL);
    stump(B, 4, 2.4, 36, 5, 12, '#7a5a38');
    B.cyl('std', 4, 14.4, 36, 5.6, 1.4, '#c8ccd0', 10, 0.8, null, METAL);
    // a folding screen
    for (let i = 0; i < 3; i++) B.box('std', -6 + i * 12, 22, 3 + (i % 2) * 2.4, 11.4, 44, 1, '#c8c0a0', [0, (i - 1) * 0.08, 0], CANVAS);
    // herbs hung to dry
    for (let i = 0; i < 4; i++) { rod(B, 'std', [-8 + i * 6, 72, 42], [-8 + i * 6, 62, 42], 0.16, '#5a4a30', S(0, 0.9, 0), 3); B.add('std', T.dodeca(), [-8 + i * 6, 60, 42], [1.6, 3, 1.6], null, ['#6a8a4a', '#8a9a5a', '#7a5a3a'][i % 3], S(DET.fabric, 0.95, 0)); }
    return;
  }
  // tier 3: a proper ward: two more cots, curtains on a rail, a gurney, a wall chart, warm bulbs and a rocking chair
  cot(B, 20, -24, 0, '#3a7a5a');
  cot(B, 20, 24, 0, '#8a6a3a');
  const rail = 62;
  rod(B, 'std', [-40, rail, -46], [40, rail, -46], 0.5, '#8a8e92', METAL, 4);
  rod(B, 'std', [-40, rail, 46], [40, rail, 46], 0.5, '#8a8e92', METAL, 4);
  for (const z of [-46, 46]) for (let i = 0; i < 4; i++) B.add('std', T.box(), [-30 + i * 20, rail - 16, z], [14, 30, 0.5], [0, 0, 0.02 * (i - 1.5)], i % 2 ? '#c0d0e0' : '#a8c0d8', CANVAS);
  // a gurney by the door
  B.rblock('std', L / 2 - 26, 16, 22, 34, 3, 14, 0.5, '#d8d8d0', null, METAL);
  for (const [x, z] of [[-14, -5], [14, -5], [-14, 5], [14, 5]]) { rod(B, 'std', [L / 2 - 26 + x, 16, 22 + z], [L / 2 - 26 + x, 3, 22 + z], 0.6, '#8a8e92', METAL, 4); B.add('std', T.torus(8, 0.3, 4), [L / 2 - 26 + x, 2.4, 22 + z], [2.4, 2.4, 2.4], [0, HALF, 0], '#222', S(DET.rubber, 0.9, 0)); }
  B.add('std', T.pillow(8, 5, 0.5), [L / 2 - 26, 19, 22], [16, 2, 6.4], null, '#e8e4d4', CANVAS);
  pic(B, 'p_medic', -L / 2 + 22, 68, 0, 30, 11, HALF);
  // bulbs strung under the ridge
  const pts = [[-52, 64, -6], [0, 68, 0], [52, 64, 6]];
  void pts;
  for (let i = -3; i <= 3; i++) {
    const wx = it.x + i * 18 * Math.cos(it.a || 0), wy = it.y + i * 18 * Math.sin(it.a || 0);
    B.cyl('std', i * 18, 66, 0, 0.6, 1.4, '#2a2622', 5, 1, null, S(0, 0.7, 0.2));
    bulb(B, halos, wx, wy, 64, '#ffe0b0', { lx: i * 18, lz: 0, r: 1.5, halo: 34, strength: 0.4 });
  }
  rod(B, 'std', [-56, 67, 0], [56, 67, 0], 0.25, '#1e1c1a', S(0, 0.8, 0.1), 3);
  // a rocking chair for Mara, a jar of wildflowers
  B.rblock('std', L / 2 - 14, 8, -30, 12, 2, 12, 0.5, '#6a4a2c', null, WOOD);
  B.rblock('std', L / 2 - 20, 8, -30, 2, 22, 12, 0.5, '#6a4a2c', null, WOOD);
  for (const s of [-1, 1]) B.add('std', T.torus(10, 0.14, 4), [L / 2 - 14, 5.4, -30 + s * 5.6], [11, 5, 5], [0, HALF, 0], '#5a3a20', WOOD);
  B.cyl('glass', -L / 2 + 20, 2.4, 30, 3, 6, '#b8d0c8', 8, 1, null, S(0, 0.15, 0.1));
  for (let k = 0; k < 5; k++) B.add('std', T.sphere(5, 4), [-L / 2 + 20 + (k - 2) * 1.2, 10 + (k % 2) * 2, 30 + (k - 2) * 0.8], [1.5, 1.5, 1.5], null, ['#e8c04a', '#d84a4a', '#f0e8d0', '#9a6ac8', '#e87ab8'][k], S(DET.fabric, 0.9, 0));
}

function gunRack(B, x, z, rot, n = 5, y0 = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = 18 + n * 7;
  B.add('std', T.box(), [x, y0 + 4, z], [4, 3, W], [0, -rot, 0], C.woodD, WOOD);
  B.add('std', T.box(), [x, y0 + 40, z], [4, 3, W], [0, -rot, 0], C.woodD, WOOD);
  for (const sgn of [-1, 1]) B.add('std', T.box(), [x - s * sgn * (W / 2 - 1) * 0 + c * 0, y0 + 24, z + c * sgn * (W / 2 - 1) * 0 + 0], [4, 44, 3], [0, -rot, 0], C.woodD, WOOD);
  B.add('std', T.box(), [x, y0 + 24, z], [1.2, 40, W], [0, -rot, 0], '#5a4632', WOOD);
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + 9 + i * ((W - 18) / Math.max(1, n - 1));
    const gx = x + (-s) * u, gz = z + c * u;
    rifle(B, gx + c * 3.4, y0 + 24, gz + s * 3.4, Math.PI / 2, HALF - 0.05, i % 3 === 2 ? 38 : 44, i % 3 === 2 ? 'shotgun' : 'rifle');
  }
}

function up_armory(P) {
  const { B, it, halos } = P;
  const t = it.tier;
  const L = it.w || 150, W = it.h || 104;
  if (t === 0) {
    // the site: crates under a tarp, a rack with two rifles
    stash(B, -30, 10, 0.1, 6, '#5a5e40');
    tarpSheet(B, [[-56, 40, -10], [-4, 40, -10], [-4, 20, 32], [-56, 20, 32]], '#4a5a3a', 3);
    gunRack(B, 20, -26, 0, 2);
    pic(B, 'tag', 10, 24, 30, 12, 6, 0);
    return;
  }
  if (t === 1) {
    tentShell(P, '#59632f', '#6a7440', 40, 74);
    gunRack(B, -L / 2 + 10, 0, 0, 6);
    stash(B, -26, -32, 0.2, 5, '#5a5e40');
    // a table with a cleaning kit and a lantern
    B.rblock('std', 14, 20, 26, 38, 3, 20, 0.5, '#6a4a2c', null, WOOD);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) post(B, 14 + x * 15, 0, 26 + z * 7, 1.2, 20, C.woodD, WOOD, 4);
    rifle(B, 14, 24, 26, 0.2, 0, 38);
    B.box('std', 24, 22, 30, 8, 3, 6, '#5a3a2a', null, WOOD);
    lantern(B, halos, 8, 23, 22, ...toWorld(it, 8, 22), { h: 9, halo: 44, strength: 0.5 });
    // ammo cans
    for (let i = 0; i < 4; i++) { B.rblock('std', -30 + (i % 2) * 12, Math.floor(i / 2) * 9, 36, 11, 8, 6, 0.6, '#4b5320', null, METAL); B.box('std', -30 + (i % 2) * 12, Math.floor(i / 2) * 9 + 8.2, 36, 6, 0.8, 3, '#d8b43a', null, { surf: [0, 0.5, 0] }); }
    return;
  }
  if (t === 2) {
    // a locker cage across the back and a bunker of sandbags in front of the tent
    for (let i = 0; i < 3; i++) {
      B.rblock('std', 2 + i * 15, 0, -34, 14, 46, 9, 0.6, ['#5a6a5a', '#6a7a6a', '#4a5a4a'][i], null, METAL);
      B.box('std', 2 + i * 15, 30, -29, 10, 2, 0.4, '#1c1e20', null, METAL);
      B.box('std', 6 + i * 15, 20, -29.4, 1.2, 4, 0.5, '#c9a02a', null, METAL);
    }
    sandbagRun(B, L / 2 + 6, -W / 2 + 8, L / 2 + 6, -12, 3);
    sandbagRun(B, L / 2 + 6, 12, L / 2 + 6, W / 2 - 8, 3);
    pic(B, 'p_armory', L / 2 + 5, 62, 0, 44, 11, HALF);
    post(B, L / 2 + 5, 0, -14, 1.4, 56, C.woodD, WOOD, 5);
    post(B, L / 2 + 5, 0, 14, 1.4, 56, C.woodD, WOOD, 5);
    // paper targets pinned to a board
    B.box('std', -10, 26, 30, 1.4, 30, 26, C.wood, null, WOOD);
    pic(B, 'target', -9, 26, 30, 22, 22, HALF);
    gunRack(B, -L / 2 + 10, 34, 0, 4);
    return;
  }
  // tier 3: a plank floor, a reloading bench, a pegboard of pistols, more racks and a pyramid of ammo cans
  B.rblock('std', 0, 0, 0, L - 10, 2.4, W - 10, 0.5, '#8a6a44', null, WOOD);
  B.rblock('std', 28, 24, -22, 40, 3, 16, 0.5, '#5a4630', null, WOOD);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) post(B, 28 + x * 17, 2.4, -22 + z * 6, 1.4, 22, C.woodD, WOOD, 4);
  B.rblock('std', 20, 27, -22, 8, 12, 7, 0.6, '#3a3e42', null, METAL);
  rod(B, 'std', [20, 39, -22], [20, 44, -22], 1, '#a8acb0', METAL, 5);
  B.box('std', 40, 27, -22, 6, 4, 6, '#a83a2a', null, METAL);
  B.box('std', 0, 42, -W / 2 + 3, 58, 30, 1.4, '#5a4a36', null, WOOD);
  for (let i = 0; i < 6; i++) {
    const x = -24 + i * 9.6;
    B.box('std', x, 46, -W / 2 + 4, 6, 3.6, 1.6, '#24272b', null, METAL);
    B.box('std', x + 2, 42, -W / 2 + 4, 2, 5, 1.6, '#24272b', [0, 0, 0.1], METAL);
  }
  for (let i = 0; i < 6; i++) {
    const row = i < 3 ? 0 : i < 5 ? 1 : 2;
    const k = i < 3 ? i : i < 5 ? i - 3 : 0;
    const x = -20 + k * 12 + row * 6;
    B.rblock('std', x, 2.4 + row * 8, 30, 11, 8, 6, 0.6, '#4b5320', null, METAL);
  }
  // a target stand and a hanging row of bulbs
  post(B, -40, 2.4, 30, 1.2, 46, C.woodD, WOOD, 4);
  pic(B, 'bullseye', -40, 40, 30, 22, 22, HALF);
  for (let i = -2; i <= 2; i++) {
    const wx = it.x + i * 18 * Math.cos(it.a || 0), wy = it.y + i * 18 * Math.sin(it.a || 0);
    bulb(B, halos, wx, wy, 62, '#ffe0b0', { lx: i * 18, lz: 0, r: 1.4, halo: 30, strength: 0.4 });
  }
  rod(B, 'std', [-40, 65, 0], [40, 65, 0], 0.25, '#1e1c1a', S(0, 0.8, 0.1), 3);
}

// =====================================================================================================
// radio mast

function up_radiomast(P) {
  const { B, it, halos, dyn } = P;
  const t = it.tier;
  const blink = (y, r) => {
    B.add('blink', T.sphere(6, 4), [0, y, 0], [2.4, 2.4, 2.4], null, '#ff2a1a', { emissive: 3.4 });
    halos.push({ x: it.x, y: it.y, h: y, color: '#ff2a1a', size: 90, blink: 1, strength: 0.9 });
    void r;
  };
  if (t === 0) {
    // the site: a leaning telephone pole with insulators, a crate radio at its foot and coiled wire
    rod(B, 'std', [0, 0, 0], [8, 150, 4], 2.6, C.woodD, S(DET.bark, 0.9, 0), 7);
    B.box('std', 7, 132, 3.6, 30, 3, 3, C.woodD, [0, 0, 0.05], WOOD);
    for (const x of [-6, 6, 18]) B.cyl('std', 7 + x * 0.8, 134, 3.6, 1.2, 3, '#5a8a7a', 6, 1, null, S(DET.glass, 0.3, 0.1));
    crate(B, 12, 0, 12, 14, 0.3, '#5a5e40');
    B.cyl('std', -10, 0, 14, 5, 6, '#2a2622', 12, 1, null, S(DET.rubber, 0.9, 0));
    return;
  }
  if (t === 1) {
    lattice(B, 0, 200, 13, 4.5, 40);
    B.cyl('std', 0, 0, 0, 9, 4, '#8a877e', 8, 1, null, S(DET.concrete, 0.9, 0));
    // guy wires to the ground and a yagi antenna
    for (let k = 0; k < 3; k++) {
      const a = HALF + (k * Math.PI * 2) / 3 + 0.5;
      rod(B, 'std', [Math.cos(a) * 5, 170, Math.sin(a) * 5], [Math.cos(a) * 92, 1, Math.sin(a) * 92], 0.3, '#3a3a3e', S(0, 0.7, 0.4), 3);
      B.box('std', Math.cos(a) * 92, 1, Math.sin(a) * 92, 4, 6, 4, '#8a877e', null, S(DET.concrete, 0.9, 0));
    }
    rod(B, 'std', [-2, 160, 0], [-2, 196, 0], 0.8, '#c8ccd0', METAL, 5);
    rod(B, 'std', [-16, 178, 0], [24, 178, 0], 0.5, '#c8ccd0', METAL, 4);
    for (const x of [-12, -4, 6, 16]) rod(B, 'std', [x, 178, -8], [x, 178, 8], 0.4, '#c8ccd0', METAL, 4);
    rod(B, 'std', [0, 200, 0], [0, 216, 0], 0.6, '#c8ccd0', METAL, 4);
    blink(218);
    return;
  }
  if (t === 2) {
    lattice(B, 200, 290, 4.5, 3.2, 30);
    dishAt(B, [10, 248, 0], 16, 0.15);
    // a second yagi pointing the other way, an equipment box halfway up
    rod(B, 'std', [0, 276, 0], [0, 288, 0], 0.5, '#c8ccd0', METAL, 4);
    rod(B, 'std', [-22, 270, 0], [14, 270, 0], 0.5, '#c8ccd0', METAL, 4);
    for (const x of [-16, -8, 2, 10]) rod(B, 'std', [x, 270, 0], [x, 270, -7], 0.35, '#c8ccd0', METAL, 4);
    B.rblock('std', 6, 130, 6, 12, 14, 9, 0.6, '#5a5e62', null, METAL);
    B.add('glow', T.plane(), [6, 132, 10.6], [6, 3, 1], null, '#5dff8a', { emissive: 3.4, uv: atlasUV('white'), noAO: true });
    return;
  }
  lattice(B, 290, 400, 3.2, 2.2, 30);
  blink(410);
  B.add('blink', T.sphere(6, 4), [3, 296, 0], [2, 2, 2], null, '#ff2a1a', { emissive: 3.4 });
  halos.push({ x: it.x, y: it.y, h: 296, color: '#ff2a1a', size: 70, blink: 1, strength: 0.8 });
  B.add('blink', T.sphere(6, 4), [-3, 200, 0], [2, 2, 2], null, '#ff2a1a', { emissive: 3.4 });
  halos.push({ x: it.x, y: it.y, h: 200, color: '#ff2a1a', size: 70, blink: 1, strength: 0.8 });
  rod(B, 'std', [0, 400, 0], [0, 424, 0], 0.5, '#c8ccd0', METAL, 4);
  // the radar bar turns on top: a spinner (a private mesh turning about the vertical axis)
  dyn.spinners.push({
    x: it.x, y: it.y, h: 392, a: 0, axis: 'y', speed: 1.6, up: 'radiomast',
    build(SB) {
      SB.box('std', 0, 0, 0, 3, 3, 3, '#3a3c40');
      SB.box('std', 0, 2, 0, 5, 1.6, 40, '#c8ccd0');
      SB.box('std', 0, 0.6, 0, 3, 1.4, 42, '#d8dad6');
      SB.box('std', -2, 4, 0, 1.4, 4, 8, '#3a3c40');
    },
  });
  // a big fixed dish lower down, aimed at the sky
  dishAt(B, [-8, 330, 0], 22, -0.5, '#e6e8e4');
}

// =====================================================================================================
// garden

function plant(B, kind, x, z, r) {
  const rnd = B.rng;
  if (kind === 'cabbage') {
    B.add('std', T.pillow(8, 5, 0.6), [x, 3.4, z], [4.4, 3.4, 4.4], [0, r.range(0, 6), 0], mixHex('#5a9a5a', '#a8d0a0', r.range(0, 0.4)), S(DET.fabric, 0.9, 0));
  } else if (kind === 'tomato') {
    rod(B, 'std', [x, 0, z], [x, 24, z], 0.5, C.woodL, WOOD, 4);
    for (let i = 0; i < 5; i++) B.add('std', T.dodeca(), [x + r.range(-3, 3), 6 + i * 4, z + r.range(-3, 3)], [3, 2.4, 3], [r.range(0, 6), 0, 0], '#3f7a3a', S(DET.fabric, 0.9, 0));
    for (let i = 0; i < 3; i++) B.add('std', T.sphere(6, 4), [x + r.range(-3, 3), 7 + i * 5, z + r.range(-3, 3)], [1.7, 1.7, 1.7], null, '#d0361f', S(DET.plastic, 0.4, 0));
  } else if (kind === 'corn') {
    rod(B, 'std', [x, 0, z], [x + r.range(-1, 1), 36 + r.range(0, 8), z], 0.9, '#7aa040', S(DET.fabric, 0.85, 0), 5);
    for (let i = 0; i < 3; i++) B.add('std', T.box(), [x + (i - 1) * 3.4, 22 + i * 4, z], [8, 0.3, 1.6], [0, r.range(0, 6), (i - 1) * 0.5 + 0.3], '#8ab04a', S(DET.fabric, 0.85, 0));
    B.add('std', T.sphere(6, 4), [x + 1.4, 24, z], [1.2, 3.4, 1.2], null, '#e8c04a', S(DET.fabric, 0.85, 0));
  } else if (kind === 'pumpkin') {
    B.add('std', T.sphere(9, 6), [x, 3.6, z], [5, 3.8, 5], null, '#e0782a', S(DET.plastic, 0.6, 0));
    B.cyl('std', x, 7, z, 0.7, 2.4, '#5a7a2a', 5, 1, null, S(DET.fabric, 0.9, 0));
  } else if (kind === 'sunflower') {
    rod(B, 'std', [x, 0, z], [x, 44 + r.range(0, 8), z], 0.9, '#4a7a2a', S(DET.fabric, 0.85, 0), 5);
    B.cyl('std', x, 45, z, 5, 1.4, '#e8b820', 12, 1, [0, 0, HALF * 0.4], S(DET.fabric, 0.8, 0));
    B.cyl('std', x + 0.6, 45.4, z, 2.6, 1.6, '#4a3020', 10, 1, [0, 0, HALF * 0.4], S(DET.fabric, 0.9, 0));
    B.add('std', T.box(), [x, 30, z], [7, 0.3, 3], [0, r.range(0, 6), 0.4], '#6a9a3a', S(DET.fabric, 0.85, 0));
  } else if (kind === 'bean') {
    for (let i = 0; i < 3; i++) B.add('std', T.dodeca(), [x + r.range(-2, 2), 4 + i * 5, z + r.range(-2, 2)], [2.6, 2, 2.6], [r.range(0, 6), 0, 0], '#4f8a3a', S(DET.fabric, 0.9, 0));
  } else {
    B.add('std', T.pillow(8, 5, 0.6), [x, 2.4, z], [3.2, 2, 3.2], null, '#8ac068', S(DET.fabric, 0.9, 0));
  }
  void rnd;
}

function bed(B, x, z, w, d, kind, grown = true) {
  const r = B.rng;
  B.rblock('std', x, 0, z, w, 8, d, 0.6, '#6a4a2c', null, WOOD);
  B.rblock('std', x, 5.4, z, w - 3, 4.6, d - 3, 1, '#2f2418', null, S(DET.dirt, 0.95, 0));
  for (let i = 0; i < 6; i++) B.add('std', T.dodeca(), [x + r.range(-w / 2 + 3, w / 2 - 3), 8, z + r.range(-d / 2 + 3, d / 2 - 3)], [1.6, 1, 1.6], null, '#4a3828', S(DET.dirt, 0.95, 0));
  if (!grown) return;
  const nx = Math.max(2, Math.round(w / 14)), nz = Math.max(1, Math.round(d / 14));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const px = x - w / 2 + (i + 0.5) * (w / nx), pz = z - d / 2 + (j + 0.5) * (d / nz);
    if (kind === 'mixed') plant(B, ['cabbage', 'tomato', 'lettuce', 'pumpkin', 'bean'][(i + j * 3) % 5], px, pz + 0, r);
    else plant(B, kind, px, pz, r);
  }
  void hash01;
}

function up_garden(P) {
  const { B, it } = P;
  const t = it.tier;
  const w = it.w || 430, h = it.h || 250;
  const hw = w / 2, hh = h / 2;
  const r = B.rng;
  const fenceRun = (x0, z0, x1, z1, chicken, tall = 34) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 34));
    for (let i = 0; i <= n; i++) post(B, x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, 1.5, tall, C.woodD, WOOD, 5);
    for (const y of [10, 22, tall - 2]) rod(B, 'std', [x0, y, z0], [x1, y, z1], 0.9, C.woodL, WOOD, 5);
    if (chicken) {
      const a = Math.atan2(z1 - z0, x1 - x0);
      B.add('fence', T.plane(), [(x0 + x1) / 2, tall / 2, (z0 + z1) / 2], [len, tall - 4, 1], [0, -a, 0], '#8a9094', { uvScale: [len / 14, (tall - 4) / 14] });
    }
  };
  if (t === 0) {
    // the site: a sagging split-rail fence, weeds, a wheelbarrow, a shovel in the ground, twine between stakes
    for (const [x0, z0, x1, z1] of [[-hw, -hh, hw, -hh], [-hw, hh, hw, hh], [-hw, -hh, -hw, hh], [hw, -hh, hw, -42]]) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 60));
      for (let i = 0; i <= n; i++) post(B, x0 + ((x1 - x0) * i) / n + r.range(-2, 2), 0, z0 + ((z1 - z0) * i) / n, 1.6, 30 + r.range(-4, 2), C.woodD, WOOD, 5);
      for (const y of [12, 24]) if (r.chance(0.8)) rod(B, 'std', [x0, y + r.range(-3, 0), z0], [x1, y + r.range(-3, 0), z1], 1, C.woodL, WOOD, 5);
    }
    for (let i = 0; i < 26; i++) B.add('std', T.blade(), [r.range(-hw + 10, hw - 10), 5, r.range(-hh + 10, hh - 10)], [3, r.range(8, 14), 1], [0, r.range(0, 6), r.range(-0.3, 0.3)], mixHex('#7a8a3a', '#a09a4a', r.range(0, 1)), S(DET.grass, 0.9, 0));
    for (const [x, z] of [[-140, -40], [-140, 40], [-60, -40], [-60, 40]]) { post(B, x, 0, z, 0.6, 18, '#c9a02a', WOOD, 4); }
    rod(B, 'std', [-140, 16, -40], [-60, 16, -40], 0.2, '#e8dcb0', S(DET.fabric, 0.9, 0), 3);
    rod(B, 'std', [-140, 16, 40], [-60, 16, 40], 0.2, '#e8dcb0', S(DET.fabric, 0.9, 0), 3);
    // wheelbarrow, a shovel, a watering can
    B.rblock('std', 150, 8, 60, 22, 8, 16, 0.6, '#5a5e62', null, RUSTY);
    rod(B, 'std', [160, 10, 52], [176, 12, 48], 0.8, C.woodD, WOOD, 4);
    rod(B, 'std', [160, 10, 68], [176, 12, 72], 0.8, C.woodD, WOOD, 4);
    B.add('std', T.torus(10, 0.3, 4), [140, 5, 60], [5, 5, 5], [0, HALF, 0], '#1b1b1c', S(DET.rubber, 0.9, 0));
    rod(B, 'std', [96, 0, -70], [96, 34, -70], 0.8, C.woodD, WOOD, 4);
    B.box('std', 96, 1, -70, 6, 8, 1, '#8a8e92', [0.1, 0, 0], RUSTY);
    return;
  }
  const bedPos = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) bedPos.push([-hw + 62 + col * 92, -hh + 38 + row * 78 + (row === 1 ? 6 : 0)]);
  if (t === 1) {
    fenceRun(-hw, -hh, hw, -hh, false);
    fenceRun(-hw, hh, hw, hh, false);
    fenceRun(-hw, -hh, -hw, hh, false);
    fenceRun(hw, -hh, hw, -42, false);
    for (let i = 0; i < 4; i++) bed(B, bedPos[i][0], bedPos[i][1], 76, 30, ['cabbage', 'lettuce', 'bean', 'cabbage'][i], true);
    // a scarecrow, a watering can
    rod(B, 'std', [hw - 60, 0, hh - 40], [hw - 60, 50, hh - 40], 1.2, C.woodD, WOOD, 5);
    rod(B, 'std', [hw - 60, 38, hh - 60], [hw - 60, 38, hh - 20], 1, C.woodD, WOOD, 5);
    B.add('std', T.sphere(8, 6), [hw - 60, 54, hh - 40], [5, 5.6, 5], null, '#c8a878', S(DET.fabric, 0.9, 0));
    B.cyl('std', hw - 60, 58, hh - 40, 8, 1, '#4a4038', 10, 1);
    B.cyl('std', hw - 60, 58.4, hh - 40, 4.4, 5, '#4a4038', 10, 0.8);
    B.add('std', T.pillow(8, 6, 0.6), [hw - 60, 32, hh - 40], [7, 12, 6], null, '#6a7a8a', CANVAS);
    pic2(B, 'p_garden', -hw + 30, 26, -hh - 6, 42, 13, 0);
    return;
  }
  if (t === 2) {
    for (let i = 4; i < 8; i++) bed(B, bedPos[i][0], bedPos[i][1], 76, 30, ['tomato', 'corn', 'tomato', 'pumpkin'][i - 4], true);
    // a rain barrel with a drip line and a bench
    barrel(B, -hw + 22, 0, hh - 26, '#3b5f8a', 34, 12, true);
    rod(B, 'std', [-hw + 22, 8, hh - 38], [-hw + 60, 2, hh - 60], 0.5, '#1c1c1e', S(DET.rubber, 0.8, 0), 4);
    B.rblock('std', 0, 12, hh - 16, 50, 2.4, 11, 0.5, '#7a5a38', null, WOOD);
    for (const x of [-20, 20]) post(B, x, 0, hh - 16, 1.4, 12, C.woodD, WOOD, 5);
    return;
  }
  for (let i = 8; i < 12; i++) bed(B, bedPos[i][0], bedPos[i][1], 76, 30, ['corn', 'mixed', 'bean', 'mixed'][i - 8], true);
  // sunflowers along the back fence
  for (let i = 0; i < 9; i++) plant(B, 'sunflower', -hw + 26 + i * 44, -hh + 10, r);
  // chicken wire on every fence
  fenceRun(-hw, -hh, hw, -hh, true);
  fenceRun(-hw, hh, hw, hh, true);
  fenceRun(-hw, -hh, -hw, hh, true);
  // the greenhouse made of old windows: a wood frame with panes, a lit door
  const gx = hw - 90, gz = hh - 56, gw = 70, gd = 46, gh = 44;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(B, gx + sx * gw / 2, 0, gz + sz * gd / 2, 1.8, gh, C.woodD, WOOD, 5);
  for (const sz of [-1, 1]) rod(B, 'std', [gx - gw / 2, gh, gz + sz * gd / 2], [gx + gw / 2, gh, gz + sz * gd / 2], 1.2, C.woodD, WOOD, 5);
  for (const sx of [-1, 1]) rod(B, 'std', [gx + sx * gw / 2, gh, gz - gd / 2], [gx + sx * gw / 2, gh, gz + gd / 2], 1.2, C.woodD, WOOD, 5);
  rod(B, 'std', [gx - gw / 2, gh + 12, gz], [gx + gw / 2, gh + 12, gz], 1.2, C.woodD, WOOD, 5);
  const paneCols = ['#9fd0c8', '#a8c8d8', '#b8d8c0'];
  for (let i = 0; i < 6; i++) {
    const x = gx - gw / 2 + (i + 0.5) * (gw / 6);
    for (const sz of [-1, 1]) {
      B.add('glass', T.plane(), [x, gh * 0.5, gz + sz * gd / 2], [gw / 6 - 1.2, gh - 4, 1], [0, sz > 0 ? 0 : Math.PI, 0], paneCols[i % 3], { surf: [0, 0.08, 0.1] });
      B.box('std', x + gw / 12, gh * 0.5, gz + sz * gd / 2, 0.8, gh - 2, 0.8, '#e8e2d0', null, WOOD);
    }
    const y2 = gh + 6;
    B.add('glass', T.plane(), [x, y2, gz - gd / 4], [gw / 6 - 1.2, 15, 1], [-0.85, 0, 0], paneCols[(i + 1) % 3], { surf: [0, 0.08, 0.1] });
    B.add('glass', T.plane(), [x, y2, gz + gd / 4], [gw / 6 - 1.2, 15, 1], [0.85, Math.PI, 0], paneCols[(i + 2) % 3], { surf: [0, 0.08, 0.1] });
  }
  for (const sx of [-1, 1]) B.add('glass', T.plane(), [gx + sx * gw / 2, gh * 0.5, gz], [gd - 2, gh - 4, 1], [0, sx * HALF, 0], '#a8c8d0', { surf: [0, 0.08, 0.1] });
  for (let i = 0; i < 4; i++) B.add('std', T.pillow(8, 5, 0.6), [gx - 24 + i * 16, 4, gz], [5, 4, 5], null, '#4f9a4f', S(DET.fabric, 0.9, 0));
  B.add('glow', T.sphere(6, 4), [gx, gh - 6, gz], [2, 2, 2], null, '#ffe0a0', { emissive: 3.6, uv: atlasUV('white'), noAO: true });
  P.halos.push({ x: it.x + gx, y: it.y + gz, h: gh - 6, color: '#ffe0a0', size: 70, strength: 0.4 });
  // bean poles
  for (let i = 0; i < 4; i++) rod(B, 'std', [-60 + i * 10, 0, hh - 20], [-50 + i * 10, 56, hh - 20], 0.6, C.woodL, WOOD, 4);
}

// =====================================================================================================
// palisade: sharpened log walls along the perimeter (world coordinates relative to the slot)

function logPost(B, x, z, h, rad = 3.6, r) {
  const hh = h + r.range(-6, 6);
  B.cyl('std', x, 0, z, rad, hh, mixHex('#6b4a2c', '#8a6a44', r.range(0, 0.5)), 7, 0.92, null, S(DET.bark, 0.92, 0));
  B.add('std', T.cyl(7, 0.08), [x, hh + 5, z], [rad * 0.92, 10, rad * 0.92], null, mixHex('#a08256', '#c0a070', r.range(0, 0.4)), S(DET.wood, 0.85, 0));
}

function up_palisade(P) {
  const { B, it, map, halos } = P;
  const t = it.tier;
  const b = map.hub.bounds;
  const r = B.rng;
  const cx = it.x, cy = it.y;
  // wall lines just inside the perimeter fence, as [x0, y0, x1, y1] in world coordinates
  const sx0 = 190, sx1 = map.width - 190;
  const lines = {
    south: [[sx0 + 6, b.y1 - 6, sx1 - 6, b.y1 - 6]],
    east: [[map.hub.bounds.x1 - 4, b.y0 + 6, map.hub.bounds.x1 - 4, b.y1 - 6]],
    west: [[b.x0 + 4, b.y0 + 6, b.x0 + 4, b.y1 - 6]],
    north: [[b.x0 + 6, b.y0 + 6, b.x1 - 6, b.y0 + 6]],
  };
  const wall = (seg, h, gaps = []) => {
    const [x0, y0, x1, y1] = seg;
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.round(len / 11);
    for (let i = 0; i <= n; i++) {
      const u = i / n, wx = x0 + (x1 - x0) * u, wy = y0 + (y1 - y0) * u;
      if (gaps.some(([a, bb]) => (Math.abs(x1 - x0) > Math.abs(y1 - y0) ? wx : wy) > a && (Math.abs(x1 - x0) > Math.abs(y1 - y0) ? wx : wy) < bb)) continue;
      logPost(B, wx - cx, wy - cy, h, 3.6, r);
    }
    // a walkway rail and lashing along the wall
    rod(B, 'std', [x0 - cx, h * 0.45, y0 - cy], [x1 - cx, h * 0.45, y1 - cy], 1.2, '#4a3422', WOOD, 5);
  };
  if (t === 0) {
    // the site: a heap of logs, a chopping block with an axe, a few sharpened stakes leaning on the fence
    for (let i = 0; i < 12; i++) rod(B, 'std', [-160 + (i % 4) * 9, 4 + Math.floor(i / 4) * 7, -30 + (i % 3)], [-60 + (i % 4) * 9, 4 + Math.floor(i / 4) * 7, -26 + (i % 3)], 3.6, '#6b4a2c', S(DET.bark, 0.92, 0), 7);
    stump(B, -20, 0, -40, 11, 22, '#7a5a3a');
    rod(B, 'std', [-20, 24, -44], [-8, 40, -30], 0.8, '#6a4a2c', WOOD, 4);
    B.box('std', -6, 42, -28, 7, 4, 1, '#8a8e92', [0, 0, 0.5], METAL);
    for (let i = 0; i < 5; i++) logPost(B, 40 + i * 9, -18, 70, 3, r);
    return;
  }
  const gate = [[1080 - 130, 1080 + 130]];
  if (t === 1) {
    wall(lines.south[0], 118, gate);
    // gate towers: two stout posts with a lamp each and a brazier
    for (const s of [-1, 1]) {
      const gx = 1080 + s * 150 - cx;
      for (let k = 0; k < 4; k++) logPost(B, gx + (k % 2) * 8 - 4, -(1362 - b.y1) - 4 + Math.floor(k / 2) * 8 - 6, 150, 4.6, r);
      B.rblock('std', gx, 152, -12, 26, 3, 26, 0.5, '#7a5a38', null, WOOD);
    }
    sandbagRun(B, -140, -22, -68, -22, 3);
    sandbagRun(B, 68, -22, 140, -22, 3);
    return;
  }
  if (t === 2) {
    wall(lines.east[0], 112);
    wall(lines.west[0], 112);
    // corner lookouts
    for (const [px, py] of [[b.x0 + 24, b.y1 - 24], [b.x1 - 24, b.y1 - 24]]) {
      for (const [dx, dz] of [[-9, -9], [9, -9], [9, 9], [-9, 9]]) B.cyl('std', px - cx + dx, 0, py - cy + dz, 2.8, 100, '#6b4a2c', 7, 1, null, S(DET.bark, 0.92, 0));
      B.rblock('std', px - cx, 100, py - cy, 34, 3, 34, 0.5, '#7a5a38', null, WOOD);
      sandbagRun(B, px - cx - 14, py - cy - 14, px - cx + 14, py - cy - 14, 2);
    }
    return;
  }
  // tier 3: the north wall, spikes in a row on top, braziers at the gate towers and a hazard glow
  wall(lines.north[0], 106);
  for (let i = 0; i < 6; i++) {
    const wx = 260 + i * 300;
    if (wx > b.x1 - 20) continue;
    B.add('glow', T.sphere(6, 4), [wx - cx, 122, b.y1 - 10 - cy], [1.6, 1.6, 1.6], null, '#ffb04a', { emissive: 3.4, uv: atlasUV('white'), noAO: true });
    halos.push({ x: wx, y: b.y1 - 10, h: 122, color: '#ffb04a', size: 48, strength: 0.4 });
  }
  for (const s of [-1, 1]) {
    const gx = 1080 + s * 150, gy = b.y1 - 12;
    B.cyl('std', gx - cx, 152, gy - cy, 8, 5, '#3a3e42', 10, 1.2, null, RUSTY);
    B.add('glow', T.dodeca(), [gx - cx, 158, gy - cy], [5, 3, 5], null, '#ff8a2a', { emissive: 3.2, uv: atlasUV('white'), noAO: true });
    halos.push({ x: gx, y: gy, h: 160, color: '#ff8a2a', size: 130, strength: 0.7, flicker: 0.8 });
  }
}

export const UP_MODELS = { up_generator, up_watchtower, up_infirmary, up_armory, up_radiomast, up_garden, up_palisade };
void line; void mug; void barrel; void pic2; void plank; void stringLights; void CANVAS; void CORR; void shadeHex;
