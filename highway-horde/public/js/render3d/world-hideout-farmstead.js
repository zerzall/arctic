// Harlan Farmstead models (world-hideout.js registry): the windmill (with turning blades), hay
// bales, the chicken coop and its run, a vine pergola over the kitchen table, the dock, a
// porch swing, a scarecrow, apples in crates and on the orchard trees.

import {
  T, S, WOOD, RUSTY, CANVAS, METAL, C, DET, shadeHex, mixHex, hash01, atlasUV,
  post, crate, barrel, mug, bulb, lantern, pic, pic2, rod, hubUV,
} from './world-hideout-kit.js';

const HALF = Math.PI / 2;

function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/** A rectangular hay bale (seat): straw-coloured, two twine loops, ragged ends. */
function haybale(P) {
  const { B, L, W } = P;
  const r = B.rng;
  const straw = ['#c9a850', '#bf9d46', '#d2b25c'][Math.floor(r.next() * 3)];
  B.rblock('std', 0, 0, 0, L - 1, 22, W - 1, 3, straw, null, S(DET.fabric, 0.97, 0));
  for (const s of [-1, 1]) {
    B.box('std', s * L * 0.22, 11, 0, 1.2, 23.4, W + 0.3, '#5a4632', null, S(DET.fabric, 0.9, 0));
    B.box('std', s * L * 0.22, 22.2, 0, 1.2, 0.6, W + 0.4, '#5a4632', null, S(DET.fabric, 0.9, 0));
  }
  for (let i = 0; i < 16; i++) {
    B.add('std', T.blade(), [r.range(-L / 2, L / 2), 22.5, r.range(-W / 2, W / 2)], [1.2, r.range(3, 7), 1], [r.range(-0.4, 0.4), r.range(0, 6), r.range(-0.9, 0.9)], mixHex(straw, '#e8d488', r.range(0, 0.6)), S(DET.fabric, 0.95, 0));
  }
  if (hash01(Math.round(P.it.x * 3 + P.it.y)) < 0.4) {
    B.add('std', T.pillow(8, 5, 0.5), [L * 0.1, 25, 0], [L * 0.3, 2.4, W * 0.36], [0, 0.1, 0.05], ['#a63d3d', '#3d6aa6', '#c98a2e', '#5a8a5a'][Math.floor(hash01(P.it.x) * 4)], CANVAS);
  }
}

/** The chicken coop: a little red house on legs with a ramp, nesting boxes and a run fenced with pickets. */
function coop(P) {
  const { B, it, halos } = P;
  const red = '#a3382a', trim = '#efe8d4';
  // legs and the floor
  for (const [x, z] of [[-22, -16], [22, -16], [22, 16], [-22, 16]]) post(B, x, 0, z, 1.8, 12, C.woodD, WOOD, 5);
  B.rblock('std', 0, 11, 0, 52, 3, 40, 0.5, '#6a4a2c', null, WOOD);
  // the walls, a gable roof, a round pop-hole with a ramp
  B.block('std', 0, 14, 0, 48, 24, 36, red, null, S(DET.siding, 0.86, 0));
  for (const s of [-1, 1]) B.add('std', T.box(), [0, 44, s * 10.5], [54, 1.6, 26], [s * 0.6, 0, 0], '#5a4a3a', S(DET.shingle, 0.9, 0));
  B.add('std', T.profile('coopgable', [[-18, 0], [18, 0], [0, 15]], 0, 1), [-24.4, 38, 0], [1, 1, 1], [0, HALF, 0], shadeHex(red, -0.1), S(DET.siding, 0.86, 0));
  B.add('std', T.profile('coopgable', [[-18, 0], [18, 0], [0, 15]], 0, 1), [24.4, 38, 0], [1, 1, 1], [0, HALF, 0], shadeHex(red, -0.1), S(DET.siding, 0.86, 0));
  B.box('std', 0, 26, 18.4, 12, 14, 0.8, '#1c1410', null, WOOD);
  B.box('std', 0, 26, 18.8, 14, 16, 0.6, trim, null, WOOD);
  rod(B, 'std', [0, 12, 28], [0, 26, 19], 0.2, '#3a2a1c', WOOD, 4);
  B.add('std', T.box(), [0, 19, 24], [8, 0.8, 16], [-0.55, 0, 0], '#8a6a44', WOOD);
  for (let i = 0; i < 4; i++) B.box('std', 0, 15 + i * 2.6, 22.6 + i * 1.8, 8, 0.5, 0.6, C.woodD, null, WOOD);
  // nesting boxes on the side with an egg or two
  B.rblock('std', 30, 16, -6, 8, 14, 22, 0.5, '#8a6a44', null, WOOD);
  B.add('std', T.box(), [31, 32, -6], [12, 1, 26], [0, 0, -0.3], '#5a4a3a', S(DET.shingle, 0.9, 0));
  for (const z of [-12, 0]) B.add('std', T.sphere(6, 4), [30.4, 17.6, z], [1.5, 2, 1.5], null, '#f0e8d4', S(DET.plastic, 0.5, 0));
  pic(B, 'p_eggs', 0, 50, 19, 26, 8, 0, {});
  // the run: low picket fence round the yard, a feeder, a water dish, a perch
  const R = 66, n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, x = Math.cos(a) * R * 1.04, z = Math.sin(a) * R * 1.04;
    if (Math.abs(a - HALF) < 0.4) continue;   // the gate side
    post(B, x, 0, z, 1.1, 20, '#efe8d4', WOOD, 5);
    B.add('std', T.box(), [Math.cos(a + Math.PI / n) * R * 1.04, 12, Math.sin(a + Math.PI / n) * R * 1.04], [2 * Math.PI * R * 1.04 / n, 1.4, 1.2], [0, -(a + Math.PI / n + HALF), 0], '#efe8d4', WOOD);
  }
  B.cyl('std', -36, 0, 40, 5, 4, '#7a7e82', 10, 1, null, METAL);
  B.cyl('std', -36, 4, 40, 4, 0.8, '#6a4a3a', 10, 1, null, S(DET.grain || DET.dirt, 0.95, 0));
  B.cyl('std', -50, 0, 30, 4, 3, '#3b5f8a', 10, 1, null, METAL);
  B.cyl('std', 44, 0, 44, 1.4, 22, C.woodD, 5, 1, null, WOOD);
  B.add('std', T.box(), [44, 22, 44], [24, 1.6, 1.6], [0, 0.3, 0], C.woodD, WOOD);
  void it; void halos;
}

/** The farm windmill: a lattice tower, a platform, a tail vane; the wheel of blades is a spinner. */
function windmill(P) {
  const { B, it, dyn, halos } = P;
  const H = 250;
  const r0 = 30, r1 = 10;
  const rAt = (y) => r0 + (r1 - r0) * (y / H);
  const wood = '#8a7350', iron = '#3a3630';
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    rod(B, 'std', [sx * r0, 0, sz * r0], [sx * r1, H, sz * r1], 2.2, wood, S(DET.wood, 0.88, 0), 6);
    B.box('std', sx * r0, 2, sz * r0, 10, 4, 10, '#8a877e', null, S(DET.concrete, 0.9, 0));
  }
  const n = 7;
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * H, y1 = ((i + 1) / n) * H, a = rAt(y0), b = rAt(y1);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      rod(B, 'std', [ax * a, y0, az * a], [bx * b, y1, bz * b], 0.9, iron, RUSTY, 4);
      rod(B, 'std', [bx * a, y0, bz * a], [ax * b, y1, az * b], 0.9, iron, RUSTY, 4);
      rod(B, 'std', [ax * a, y0, az * a], [bx * a, y0, bz * a], 1.4, wood, WOOD, 4);
    }
  }
  // the platform, the head (gearbox) and the tail vane, a ladder up one leg
  B.rblock('std', 0, H - 2, 0, 30, 4, 30, 0.5, wood, null, WOOD);
  B.rblock('std', 0, H + 2, 0, 24, 18, 18, 2, '#3f5a72', null, METAL);
  B.cyl('std', 10, H + 11, 0, 5, 12, '#2a2622', 10, 1, [0, 0, HALF], RUSTY);
  rod(B, 'std', [-12, H + 12, 0], [-92, H + 12, 0], 1.6, iron, RUSTY, 6);
  B.add('std', T.profile('vane', [[0, -13], [42, -8], [46, 13], [0, 9]], 0, 1), [-92, H + 14, 0], [1, 1, 0.8], [0, 0, 0], '#c0392b', METAL);
  for (const s of [-1, 1]) rod(B, 'std', [-6 + s * 5, 0, 32], [-4 + s * 4, H - 4, 12], 0.9, iron, RUSTY, 5);
  for (let y = 10; y < H - 10; y += 12) rod(B, 'std', [-11, y, 32 - (y / H) * 20], [1, y, 32 - (y / H) * 20], 0.7, iron, RUSTY, 4);
  // a well-head and pump trough at the foot
  B.rblock('std', 0, 0, 44, 30, 10, 20, 0.6, '#5a4a3a', null, WOOD);
  B.box('std', 0, 9.4, 44, 26, 1, 16, '#1a2a34', null, S(DET.glass, 0.1, 0.4));
  rod(B, 'std', [-8, 10, 44], [-8, 40, 44], 2, iron, RUSTY, 6);
  // the wheel: 18 curved blades on rings, spinning about the wind axis (local x)
  dyn.spinners.push({
    x: it.x, y: it.y, h: H + 11, a: it.a || 0, axis: 'x', speed: 0.55, phase: 0.4,
    build(SB) {
      const R = 56;
      SB.cyl('std', -2, 0, 0, 5.6, 8, '#2a2622', 10, 1, [0, 0, HALF]);
      for (const rr of [R * 0.45, R]) SB.add('std', T.torus(28, 0.02, 4), [0, 0, 0], [rr, rr, 1], [0, HALF, 0], iron);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        rod(SB, 'std', [0, Math.cos(a) * 5, Math.sin(a) * 5], [0, Math.cos(a) * R, Math.sin(a) * R], 0.6, iron, null, 4);
        SB.add('std', T.box(), [0.6, Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74], [5.4, R * 0.5, 0.8], [a, 0, 0.42], '#d8d0c0');
      }
    },
  });
  void halos;
}

/** A vine-covered pergola over the kitchen table: posts, beams, slats, leaves, jars with candles. */
function pergola2(P) {
  const { B, it, halos } = P;
  const w = it.w || 180, d = it.d || 110, h = 96;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(B, sx * (w / 2 - 4), 0, sz * (d / 2 - 4), 2.6, h, '#efe8d4', WOOD, 6);
  for (const sz of [-1, 1]) B.box('std', 0, h + 2, sz * (d / 2 - 4), w + 6, 5, 5, '#efe8d4', null, WOOD);
  for (let i = 0; i < 9; i++) B.box('std', -w / 2 + 6 + i * ((w - 12) / 8), h + 5.6, 0, 3, 3, d + 4, '#efe8d4', null, WOOD);
  const r = B.rng;
  for (let i = 0; i < 26; i++) {
    B.add('std', T.dodeca(), [r.range(-w / 2, w / 2), h + 8 + r.range(0, 4), r.range(-d / 2, d / 2)], [r.range(6, 11), r.range(2.6, 4), r.range(6, 11)], [r.range(0, 6), r.range(0, 6), 0], mixHex('#4f7a3a', '#7aa04a', r.range(0, 1)), S(DET.fabric, 0.9, 0));
  }
  // grapes
  for (let i = 0; i < 8; i++) B.add('std', T.sphere(6, 4), [r.range(-w / 2 + 10, w / 2 - 10), h - 3, r.range(-d / 2 + 10, d / 2 - 10)], [2, 2.6, 2], null, '#5a2a6a', S(DET.plastic, 0.4, 0));
  // jars with candles hung from the beams
  for (let i = -2; i <= 2; i++) {
    const lx = i * (w / 5), lz = (i % 2) * 16;
    const [wx, wy] = toWorld(it, lx, lz);
    rod(B, 'std', [lx, h, lz], [lx, h - 12, lz], 0.2, '#3a2a1c', WOOD, 3);
    B.cyl('glass', lx, h - 22, lz, 3.6, 10, '#ffe8c0', 8, 1, null, S(0, 0.1, 0.1));
    B.cyl('glow', lx, h - 20, lz, 1.4, 6, '#ffb545', 6, 1, null, { emissive: 4.2, uv: atlasUV('white'), noAO: true });
    halos.push({ x: wx, y: wy, h: h - 16, color: '#ffb545', size: 46, strength: 0.5, flicker: 0.6 });
  }
  void mug;
}

/** The dock: planks on posts along local +x, ropes, a lantern post and a bucket. `len` long, 40 wide. */
function dock(P) {
  const { B, it, halos } = P;
  const len = it.len || 370, w = 40;
  const r = B.rng;
  const n = Math.round(len / 8);
  for (let i = 0; i < n; i++) {
    B.rblock('std', 4 + i * (len / n), 3.4, 0, len / n - 0.8, 2.4, w + r.range(-1, 1), 0.3, mixHex('#8a6a44', '#a08256', r.range(0, 0.6)), [0, r.range(-0.01, 0.01), 0], S(DET.wood, 0.9, 0));
  }
  for (const s of [-1, 1]) B.rblock('std', len / 2, 1.6, s * (w / 2 - 2), len, 3, 3.6, 0.4, '#5a4632', null, WOOD);
  for (let x = 20; x < len; x += 60) for (const s of [-1, 1]) post(B, x, -8, s * (w / 2 + 1), 2, 26, '#5a4632', WOOD, 6);
  for (const s of [-1, 1]) {
    rod(B, 'std', [20, 20, s * (w / 2 + 1)], [len - 2, 20, s * (w / 2 + 1)], 0.5, '#bdb090', S(DET.fabric, 0.9, 0), 4);
  }
  const lx = 24, lz = w / 2 + 1;
  const [wx, wy] = toWorld(it, lx, lz);
  post(B, lx, 3, lz, 1.4, 42, '#3a3a40', METAL, 6);
  lantern(B, halos, lx, 46, lz, wx, wy, { h: 9, halo: 60, strength: 0.6 });
  B.cyl('std', len - 20, 5, -10, 4.4, 8, '#7a7e82', 10, 0.9, null, METAL);
  rod(B, 'std', [len - 24, 12, -10], [len - 16, 12, -10], 0.6, '#3a3630', METAL, 4);
  // a coil of rope and a fishing rod resting on the rail
  B.add('std', T.torus(10, 0.3, 5), [len - 60, 6, 12], [5, 5, 5], [HALF, 0, 0], '#bdb090', S(DET.fabric, 0.9, 0));
  rod(B, 'std', [len - 90, 6, 14], [len - 30, 22, 30], 0.4, '#3a2a1c', WOOD, 4);
}

/** A porch swing on an A-frame with a quilt and a mug. */
function porchswing(P) {
  const { B, it, halos } = P;
  for (const s of [-1, 1]) {
    rod(B, 'std', [s * 34, 0, -12], [s * 30, 84, 0], 2, '#efe8d4', WOOD, 6);
    rod(B, 'std', [s * 34, 0, 12], [s * 30, 84, 0], 2, '#efe8d4', WOOD, 6);
  }
  rod(B, 'std', [-32, 84, 0], [32, 84, 0], 2, '#efe8d4', WOOD, 6);
  for (const s of [-1, 1]) for (const z of [-1, 1]) rod(B, 'std', [s * 27, 84, z * 6], [s * 27, 26, z * 6], 0.4, '#2a2622', S(0, 0.6, 0.5), 3);
  B.rblock('std', 0, 22, 0, 60, 3, 20, 0.5, '#8a6a44', null, WOOD);
  B.rblock('std', 0, 24, -8, 60, 24, 3, 0.5, '#8a6a44', [-0.2, 0, 0], WOOD);
  B.add('std', T.pillow(8, 5, 0.5), [-10, 27, 1], [22, 3.4, 8], [0, 0.05, 0.03], '#c0392b', CANVAS);
  B.add('std', T.pillow(8, 5, 0.5), [18, 29, -2], [7, 4.6, 5], [0, 0.4, 0.2], '#3d6aa6', CANVAS);
  B.add('std', T.pillow(8, 5, 0.4), [4, 26.6, 6], [17, 2, 9], [0, 0, 0], '#e8d8a0', CANVAS);
  mug(B, 48, 0, 8, '#e8e2d0');
  lantern(B, halos, 44, 0, -10, it.x + Math.cos(it.a) * 44 - Math.sin(it.a) * -10, it.y + Math.sin(it.a) * 44 + Math.cos(it.a) * -10, { h: 9, halo: 44, strength: 0.5 });
}

/** A scarecrow on a cross: plaid shirt, sack head, straw hat, a crow on his shoulder. */
function scarecrow(P) {
  const { B } = P;
  rod(B, 'std', [0, 0, 0], [0, 62, 0], 1.6, '#6a4a2c', WOOD, 6);
  rod(B, 'std', [0, 44, -22], [0, 44, 22], 1.4, '#6a4a2c', WOOD, 6);
  B.add('std', T.pillow(10, 8, 0.55), [0, 38, 0], [6.6, 12, 8], null, '#a83a2a', CANVAS);
  for (const s of [-1, 1]) B.add('std', T.pillow(8, 6, 0.55), [0, 44, s * 13], [3, 3.2, 10], null, '#a83a2a', CANVAS);
  B.add('std', T.sphere(10, 8), [0, 58, 0], [6, 6.6, 6], null, '#b39a68', CANVAS);
  B.cyl('std', 0, 63, 0, 11, 0.8, '#c9a850', 14, 1);
  B.cyl('std', 0, 63.4, 0, 6, 6, '#c9a850', 12, 0.8);
  for (const s of [-1, 1]) B.box('std', 5.8, 58.6, s * 2.4, 0.6, 1.6, 0.6, '#1c1a16');
  for (let k = 0; k < 5; k++) B.box('std', 1, 30 - k * 3, 6.4, 0.5, 3, 0.5, '#d8c070', [0, 0, 0.3 * (k - 2)]);
  B.add('std', T.sphere(6, 4), [0, 50, 18], [3, 2.6, 4.4], [0, 0.4, 0], '#141416', S(DET.fabric, 0.9, 0));
  B.add('std', T.sphere(6, 4), [1.6, 53, 20], [2, 2, 2], null, '#141416', S(DET.fabric, 0.9, 0));
  B.add('std', T.cyl(3, 0.05), [3.4, 53, 21], [0.8, 2, 0.8], [0, 0, -HALF], '#d8a020');
}

/** Crates of red apples, a ladder, a basket, apples in the grass. */
function orchardcrates(P) {
  const { B } = P;
  const r = B.rng;
  for (const [x, z, rot] of [[-14, 0, 0.1], [12, 4, -0.15], [0, -16, 0.3]]) {
    crate(B, x, 0, z, 20, rot, C.wood, { w: 24, d: 18, h: 14 });
    for (let i = 0; i < 9; i++) B.add('std', T.sphere(6, 4), [x + r.range(-9, 9), 14.4, z + r.range(-6, 6)], [2.7, 2.5, 2.7], null, ['#c0261c', '#d23a26', '#a01e18'][i % 3], S(DET.plastic, 0.35, 0));
  }
  B.add('std', T.box(), [12, 20, 4], [3, 2, 60], [0, 0, 0.0], C.woodL, WOOD);
  rod(B, 'std', [30, 0, -20], [22, 60, -10], 0.9, C.woodL, WOOD, 4);
  rod(B, 'std', [36, 0, -14], [28, 60, -4], 0.9, C.woodL, WOOD, 4);
  for (let y = 8; y < 56; y += 9) rod(B, 'std', [30 - (y / 60) * 8 + 2, y, -20 + (y / 60) * 10], [36 - (y / 60) * 8 + 2, y, -14 + (y / 60) * 10], 0.6, C.woodL, WOOD, 4);
  B.cyl('std', -26, 0, 20, 7, 8, '#8a6a44', 10, 1.2, null, S(DET.fabric, 0.95, 0));
  for (let i = 0; i < 5; i++) B.add('std', T.sphere(6, 4), [-26 + r.range(-4, 4), 9, 20 + r.range(-4, 4)], [2.5, 2.4, 2.5], null, '#c0261c', S(DET.plastic, 0.35, 0));
  for (let i = 0; i < 8; i++) B.add('std', T.sphere(6, 4), [r.range(-40, 40), 2, r.range(-30, 30)], [2.3, 2.1, 2.3], null, '#b8261c', S(DET.plastic, 0.35, 0));
}

/** Extras on an orchard tree (the default trunk and crown are drawn after): red apples in the crown. */
function orchardtree(P) {
  const { B } = P;
  const r = B.rng;
  for (let i = 0; i < 18; i++) {
    const a = r.range(0, 6.28), d = 18 + r.range(0, 24);
    B.add('std', T.sphere(6, 4), [Math.cos(a) * d, 66 + r.range(0, 56), Math.sin(a) * d], [2.9, 2.7, 2.9], null, ['#c0261c', '#d23a26', '#a01e18'][i % 3], S(DET.plastic, 0.35, 0));
  }
  for (let i = 0; i < 5; i++) B.add('std', T.sphere(6, 4), [r.range(-30, 30), 2, r.range(-30, 30)], [2.3, 2.1, 2.3], null, '#b8261c', S(DET.plastic, 0.35, 0));
}

export const FARM_MODELS = { haybale, coop, windmill, pergola2, dock, porchswing, scarecrow, orchardcrates, orchardtree };
void barrel; void bulb; void pic2; void hubUV; void hash01; void mixHex;
