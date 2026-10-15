// Props of the hideouts that all three share (world-hideout.js registry): the perimeter
// fence, the fire ring and its log seats, the mission table, the workbench, the upgrade
// board, the range bench, lean-tos, string lights, lanterns, signs, and the little things
// that make a place lived in (a couch, a guitar, a cat, a photo wall, kids' drawings).
//
// Every model is `fn(P)` with P = { B, it (the data record), o (obstacle when it is one),
// L, W (its size), halos, dyn, day, tier, hub, map }. The frame is placed by the caller:
// an obstacle's own frame (local +x along its width `w`, +z along its `h`; the front of a
// counter or board is local +z) or, for free props, x at (it.x, it.y) rotated by it.a with
// local +x = the way the prop FACES. Line props (string lights, bunting) are written in world
// coordinates: the caller puts their frame at the sim origin.

import {
  T, S, WOOD, RUSTY, CANVAS, METAL, CORR, C, DET, shadeHex, mixHex, hash01, hash2, atlasUV,
  slab, post, line, crate, barrel, jerrycan, mug, stump, sandbagArc, sandbagRun, bulb, lantern, stringLights, catenary, pic, pic2, neonWord,
  boardSign, rod, plank, ridgeTent, tarpSheet, cot, hubUV,
} from './world-hideout-kit.js';

const HALF = Math.PI / 2;

// ---- perimeter ---------------------------------------------------------------------------------

/** The scrap fence: pallets, corrugated sheets, doors, plywood and tyre stacks between posts. */
function perimeter(P) {
  const { B, o, L, W } = P;
  const r = B.rng;
  const hide = W > 40;     // the deep wall behind the buildings: a plain wall is enough
  if (hide) {
    B.block('std', 0, 0, 0, L, 74, W, '#6a5a48', null, S(DET.plaster, 0.9, 0));
    return;
  }
  const style = P.hub.id;
  const n = Math.max(1, Math.round(L / 54));
  const plen = L / n;
  const pal = style === 'depot' ? ['#8a8f94', '#7a6a5a', '#5a6a7a', '#a08a5a', '#6a4a3a'] : style === 'farmstead' ? ['#8a6a44', '#a07850', '#6a4a2c', '#b09060', '#7a5a38'] : ['#8a6a44', '#8a9096', '#a06a4a', '#6a7a8a', '#b8a070'];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * plen;
    const h = (style === 'farmstead' ? 60 : 78) + hash01(i * 7 + Math.round(o.x + o.y)) * 12;
    const k = Math.floor(hash01(i * 13 + Math.round(o.x * 3 + o.y)) * 5);
    const col = pal[k % pal.length];
    if (style === 'farmstead') {
      // a whitewashed board fence: posts, three rails, a few boards missing
      for (const y of [16, 32, 48]) B.box('std', x, y, W * 0.15, plen, 5, 2.2, i % 5 === 3 && y === 32 ? shadeHex(col, -0.3) : col, [0, 0, (hash01(i + y) - 0.5) * 0.02], WOOD);
      continue;
    }
    if (k === 0) {
      // pallet stood on end: slats front and back, blocks between
      for (let s = 0; s < 6; s++) B.block('std', x - plen / 2 + 5 + s * ((plen - 10) / 5), 0, W * 0.3, 6.2, h, 2, col, [0, 0, (hash01(s + i) - 0.5) * 0.03], WOOD);
      for (const y of [8, h * 0.5, h - 10]) B.box('std', x, y, -W * 0.12, plen - 2, 5, 3.6, shadeHex(col, -0.15), null, WOOD);
    } else if (k === 1 || k === 4) {
      // corrugated sheet, ribs across, a rust streak
      B.block('std', x, 0, 0, plen - 1.6, h + 2, 2.4, col, [0, 0, (hash01(i * 3) - 0.5) * 0.02], CORR);
      B.box('std', x + plen * 0.2, h * 0.6, 1.4, 5, h * 0.7, 0.3, shadeHex(col, -0.4), null, RUSTY);
    } else if (k === 2) {
      // a house door stood on its edge, painted
      const dc = (style === 'depot' ? ['#4a5a68', '#6a3a30', '#3a5a4a', '#8a7a4a'] : ['#3b5f8a', '#a02a2a', '#2f6a4a', '#c9a02a'])[Math.floor(hash01(i * 5) * 4)];
      B.block('std', x, 0, 0, plen - 6, h - 6, 3, dc, null, WOOD);
      B.box('std', x + plen * 0.28, h * 0.42, 2.2, 2.4, 2.4, 1.6, '#c8b060', null, METAL);
    } else {
      // plywood sheets nailed to rails
      B.block('std', x, 0, 0, plen - 1.4, h, 2.2, '#b9955a', null, WOOD);
      B.box('std', x, h * 0.3, -1.6, plen - 2, 4, 2.2, C.woodD, null, WOOD);
      B.box('std', x, h * 0.75, -1.6, plen - 2, 4, 2.2, C.woodD, null, WOOD);
    }
  }
  // posts and a strand of barbed wire along the top
  const pn = Math.round(L / 108) + 1;
  for (let i = 0; i < pn; i++) {
    const x = -L / 2 + (i * L) / (pn - 1);
    if (style === 'farmstead') { post(B, x, 0, 0, 2.6, 56, C.woodD, WOOD, 5); continue; }
    if (style === 'depot') {
      // rail-iron posts: an I-section with a web and two flanges
      B.box('std', x, 47, 0, 1.6, 94, 6, '#5a5048', null, RUSTY);
      B.box('std', x, 47, -2.8, 6, 94, 1.4, '#5a5048', null, RUSTY);
      B.box('std', x, 47, 2.8, 6, 94, 1.4, '#5a5048', null, RUSTY);
      B.box('std', x, 96, 0, 2, 5, 12, '#3a3630', [0, 0, 0.6], RUSTY);
      continue;
    }
    post(B, x, 0, 0, 2.8, 94, C.woodD, WOOD, 5);
    B.box('std', x, 96, 0, 2, 5, 12, C.woodD, [0, 0, 0.6], WOOD);
  }
  if (style !== 'farmstead') {
    for (const z of [-4, 4]) rod(B, 'std', [-L / 2, 96, z], [L / 2, 96, z], 0.28, '#2a2a2a', RUSTY, 4);
    for (let i = 0; i < L / 14; i++) B.box('std', -L / 2 + i * 14 + 3, 97, 0, 1.6, 0.6, 0.6, '#2a2a2a', [0, i, 0], RUSTY);
  }
}

// ---- the fire ring ---------------------------------------------------------------------------------

function campring(P) {
  const { B, halos, dyn } = P;
  const r = B.rng;
  // stones in a ring, blackened on the inside
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + r.range(-0.05, 0.05);
    const R = 27 + r.range(-1.5, 1.5);
    const s = r.range(5.6, 8);
    B.add('std', T.dodeca(), [Math.cos(a) * R, s * 0.55, Math.sin(a) * R], [s, s * 0.72, s * 0.9], [r.range(0, 6), r.range(0, 6), r.range(0, 6)], mixHex('#7a766e', '#4a4640', r.range(0, 0.5)), { wobble: { amp: 0.18, seed: i }, surf: [DET.rock, 0.88, 0] });
  }
  // ash bed and coals
  B.cyl('std', 0, 0.2, 0, 24, 1.6, '#2a2724', 16, 1, null, S(DET.char, 0.95, 0));
  B.cyl('glow', 0, 1.6, 0, 19, 0.5, '#ff6a1c', 14, 1, null, { emissive: 2.6, uv: atlasUV('white'), noAO: true });
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, 6.3), d = r.range(2, 16);
    B.add('glow', T.dodeca(), [Math.cos(a) * d, 2.4, Math.sin(a) * d], [2.6, 1.8, 2.6], [r.range(0, 6), r.range(0, 6), 0], '#ff9a3a', { emissive: 3.4, uv: atlasUV('white'), noAO: true });
  }
  // logs stacked like a lean-to on the coals
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = 34;
    rod(B, 'std', [Math.cos(a) * 20, 2.6, Math.sin(a) * 20], [Math.cos(a) * 3, 14 + (i % 2) * 3, Math.sin(a) * 3], 3.3, '#3a2c20', S(DET.char, 0.9, 0), 7);
    void len;
  }
  B.cyl('std', 0, 0.5, 0, 26, 0.6, '#1c1a18', 16, 1, null, S(DET.char, 0.95, 0));
  // an iron tripod with a pot over the fire's edge, a kettle on a stone
  const legs = [[-34, 0, -20], [34, 0, -14], [-6, 0, 40]];
  for (const l of legs) rod(B, 'std', l, [0, 60, 10], 0.9, '#2a2a2e', RUSTY, 5, 0.8);
  rod(B, 'std', [0, 58, 10], [0, 42, 10], 0.25, '#2a2622', S(0, 0.6, 0.6), 4);
  B.cyl('std', 0, 26, 10, 7.5, 13, '#2c2c30', 12, 0.86, null, RUSTY);
  B.cyl('std', 0, 39, 10, 7.7, 1.2, '#18181a', 12, 1, null, RUSTY);
  B.cyl('std', 42, 0, -30, 6.8, 10, '#5a6a72', 10, 0.8, null, METAL);
  B.add('std', T.torus(10, 0.14, 4), [42, 10, -30], [6, 6, 6], [HALF, 0, 0], '#2a2a2c', RUSTY);
  rod(B, 'std', [38, 10, -30], [30, 16, -30], 1, '#5a6a72', METAL, 5);
  dyn.smoke.push({ x: P.it.x, y: P.it.y, h: 18, rate: 5, r: 8, warm: 1 });
  halos.push({ x: P.it.x, y: P.it.y, h: 26, color: '#ff8a33', size: 240, strength: 0.45, flicker: 0.9, base: 2 });
}

/** A log seat around the fire (rock 66 × 24; the log is 19.6 high to match the step). */
function logseat(P) {
  const { B, o, L } = P;
  const r = B.rng;
  const rad = 9.8;
  const len = L - 3;
  if (P.hub.id === 'depot') {
    // a railway sleeper on two short stumps: creosote-dark, tie plates and spikes, a folded blanket
    B.rblock('std', 0, 6, 0, len, 13.6, 20, 1, mixHex('#3a2a20', '#4a3a2c', hash01(Math.round(o.x + o.y))), null, S(DET.wood, 0.92, 0));
    for (const s of [-1, 1]) {
      B.box('std', s * len * 0.3, 19.7, 0, 9, 0.5, 14, '#5a5048', null, RUSTY);
      for (const dz of [-4, 4]) B.cyl('std', s * len * 0.3, 19.6, dz, 0.9, 1.8, '#2a2622', 5, 1, null, RUSTY);
    }
    for (const s of [-1, 1]) B.rblock('std', s * len * 0.36, 0, 0, 8, 7, 18, 0.5, '#3a3630', null, S(DET.concrete, 0.9, 0));
    if (hash01(Math.round(o.x * 3 + o.y)) < 0.4) B.add('std', T.pillow(8, 5, 0.5), [len * 0.2, 21, 0], [len * 0.2, 2.4, 9], [0, 0.1, 0.03], ['#a63d3d', '#3d6aa6', '#c98a2e'][Math.floor(hash01(o.x) * 3)], CANVAS);
    return;
  }
  B.cylX('std', 0, rad, 0, rad, len, '#57402a', 10, S(DET.bark, 0.92, 0));
  for (const s of [-1, 1]) B.cylX('std', s * (len / 2 + 0.1), rad, 0, rad * 0.94, 0.5, '#b39064', 10, S(DET.wood, 0.85, 0));
  // a knot, a broken branch, a scrap of bark peeling
  B.add('std', T.dodeca(), [r.range(-len / 3, len / 3), rad * 1.6, r.range(-2, 2)], [2.4, 1.4, 2.4], [0, 1, 0], '#3a2a1c', { wobble: { amp: 0.2, seed: 5 }, surf: [DET.bark, 0.95, 0] });
  // notches cut for the feet
  for (const s of [-1, 1]) B.box('std', s * len * 0.34, 1.2, 0, 8, 2.4, rad * 1.4, '#3a2a1c', null, WOOD);
  if (hash01(Math.round((o?.x || 0) * 3 + (o?.y || 0))) < 0.34) {
    // a wool blanket thrown over one end
    B.add('std', T.pillow(8, 5, 0.5), [len * 0.22, rad * 1.85, 0], [len * 0.2, 2.6, rad * 1.1], [0, 0.1, 0.05], ['#a63d3d', '#3d6aa6', '#c98a2e', '#5a8a5a'][Math.floor(hash01((o?.x || 0) * 3) * 4)], CANVAS);
  }
}

/** The old motel-lobby couch, dragged to the fire. */
function couch(P) {
  const { B } = P;
  const col = '#6b3f4a', dark = '#4c2a34';
  const L = P.L, W = P.W;
  B.rblock('std', 0, 3, 0, L, 12, W * 0.94, 1.5, dark, null, CANVAS);
  for (const s of [-1, 0, 1]) B.add('std', T.pillow(8, 5, 0.5), [s * (L / 3 - 1), 15, 3], [L / 6 - 1, 4.2, W * 0.34], null, col, CANVAS);
  B.rblock('std', 0, 12, -W * 0.36, L * 0.98, 26, 8, 2, col, null, CANVAS);
  for (const s of [-1, 1]) B.rblock('std', s * (L / 2 - 3), 3, 0, 8, 22, W * 0.94, 2, col, null, CANVAS);
  for (const s of [-1, 1]) B.add('std', T.cyl(6), [s * (L / 2 - 6), 1.2, W * 0.4], [2, 3, 2], null, '#2a2018', WOOD);
  // a crocheted blanket and a cushion
  B.add('std', T.pillow(8, 5, 0.4), [-L * 0.2, 19, 4], [L * 0.24, 1.8, W * 0.3], [0, 0.2, 0.05], '#d2a03a', CANVAS);
  B.add('std', T.pillow(8, 5, 0.6), [L * 0.34, 20, -4], [5, 5, 3.4], [0, 0.4, 0.3], '#3a6a7a', CANVAS);
}

// ---- stations ------------------------------------------------------------------------------------------

/** The map table: the route with pins, a radio set, a lamp, mugs, rolled maps. */
function maptable(P) {
  const { B, L, W, halos } = P;
  const topY = 33;
  B.rblock('std', 0, topY - 3, 0, L, 3.2, W, 0.6, '#6f5232', null, WOOD);
  B.box('std', 0, topY - 5.6, 0, L - 6, 2, W - 6, C.woodD, null, WOOD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.block('std', sx * (L / 2 - 6), 0, sz * (W / 2 - 6), 4, topY - 3.2, 4, C.woodD, null, WOOD);
  // the map, pinned down; the route in red
  B.add('hub', T.plane(), [-6, topY + 0.35, 0.5], [92, 68, 1], [-HALF, 0, 0], '#ffffff', { uv: hubUV('map'), noAO: true, noJitter: true });
  for (const [x, z, c] of [[-46, 30, '#c62828'], [42, 30, '#c62828'], [-46, -28, '#c62828'], [30, -30, '#1565c0'], [-16, 6, '#2e7d32'], [10, -10, '#f9a825'], [22, 12, '#c62828']]) {
    B.add('std', T.sphere(6, 4), [x, topY + 2.2, z], [1.4, 1.4, 1.4], null, c, S(DET.plastic, 0.35, 0));
    B.cyl('std', x, topY + 0.3, z, 0.25, 1.9, '#d8d8d0', 4, 1, null, METAL);
  }
  // a handheld radio: olive box, a big dial, a speaker grille, a whip antenna, a headset
  const rx = L / 2 - 18, rz = -W / 2 + 14;
  B.rblock('std', rx, topY, rz, 22, 12, 13, 0.8, '#4c5a3a', null, METAL);
  B.cyl('std', rx - 5, topY + 12, rz + 2, 3, 1.2, '#d8d0b8', 10, 1, null, METAL);
  B.cyl('std', rx + 5, topY + 12, rz + 2, 2, 1.2, '#2a2a2a', 10, 1, null, METAL);
  B.box('glow', rx - 5, topY + 12.7, rz + 2, 3.4, 0.4, 1.4, '#ffb545', null, { emissive: 3, uv: atlasUV('white'), noAO: true });
  rod(B, 'std', [rx + 8, topY + 12, rz - 4], [rx + 12, topY + 58, rz - 8], 0.28, '#c8ccd0', METAL, 4);
  B.add('std', T.torus(10, 0.22, 4), [rx - 8, topY + 3.2, rz + 14], [4.6, 4.6, 4.6], [HALF, 0, 0], '#222', S(DET.rubber, 0.8, 0));
  B.add('std', T.sphere(6, 4), [rx - 8, topY + 2.4, rz + 14 - 4.4], [1.6, 2.2, 1.4], null, '#222', S(DET.rubber, 0.8, 0));
  // a hurricane lamp, two mugs, a stack of paper, a rolled map
  lantern(B, halos, -L / 2 + 12, topY, W / 2 - 12, P.it.x + (-L / 2 + 12), P.it.y + (W / 2 - 12), { h: 10, halo: 46, strength: 0.5 });
  mug(B, L / 2 - 30, topY, W / 2 - 10, '#e0d8c0');
  mug(B, -8, topY, W / 2 - 8, '#b6543a');
  B.add('std', T.cyl(8), [L / 2 - 10, topY + 3, 6], [2.6, 34, 2.6], [HALF, 0, 0.3], '#d8caa0', CANVAS);
  B.rblock('std', -L / 2 + 10, topY, -W / 2 + 11, 12, 2.6, 16, 0.4, '#e8e4d4', [0, 0.3, 0], CANVAS);
}

/** The workbench: a heavy top, a vise, an anvil, a pegboard of tools, scraps and a work lamp. */
function workbench(P) {
  const { B, L, W, halos } = P;
  const topY = 33;
  B.rblock('std', 0, topY - 4, 0, L, 4, W, 0.6, '#5a4630', null, WOOD);
  B.box('std', 0, topY - 8, 0, L - 4, 3, W - 4, '#3a3e42', null, METAL);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.block('std', sx * (L / 2 - 5), 0, sz * (W / 2 - 5), 4.4, topY - 4, 4.4, '#3a3e42', null, METAL);
  // a lower shelf with a toolbox
  B.box('std', 0, 9, 0, L - 12, 1.8, W - 10, C.woodD, null, WOOD);
  B.rblock('std', -L * 0.2, 9.8, 0, 26, 9, 12, 0.8, '#b8322a', null, METAL);
  // vise at the -x end
  B.rblock('std', -L / 2 + 14, topY, W / 2 - 12, 10, 8, 9, 0.6, '#2c3236', null, METAL);
  B.box('std', -L / 2 + 14, topY + 8.6, W / 2 - 7, 3, 3, 8, '#2c3236', null, METAL);
  rod(B, 'std', [-L / 2 + 14, topY + 6, W / 2 - 1], [-L / 2 + 14, topY + 6, W / 2 + 9], 0.6, '#8a8f94', METAL, 5);
  // an anvil on a stump
  stump(B, L * 0.12, 0, W / 2 - 4 + 6, 8, 17);
  B.add('std', T.profile('anvil', [[-9, 0], [9, 0], [8, 3], [4, 5], [12, 6], [12, 8], [-11, 8], [-12, 5], [-5, 4], [-4, 3]], 0.5, 8), [L * 0.12, 17.5, W / 2 + 2], [1, 1, 1], null, '#2f3236', S(DET.rust, 0.5, 0.8));
  // pegboard behind the bench, hung with tools
  const bz = -W / 2 - 2;
  B.box('std', 0, 60, bz, L - 8, 46, 1.6, '#5a4a36', null, WOOD);
  for (let i = 0; i < 9; i++) {
    const x = -L / 2 + 10 + i * ((L - 20) / 8);
    const kind = i % 3;
    if (kind === 0) { B.box('std', x, 62, bz + 1.6, 1.4, 22, 1, '#a8acb0', [0, 0, 0.04 * i], METAL); B.box('std', x, 74, bz + 1.6, 6, 3, 1.2, '#a8acb0', null, METAL); }
    else if (kind === 1) { B.box('std', x, 60, bz + 1.6, 2, 26, 1.2, '#7a5a38', null, WOOD); B.box('std', x, 74, bz + 1.6, 9, 6, 1.6, '#4a4e54', null, METAL); }
    else { B.cyl('std', x, 64, bz + 2.4, 1.1, 22, '#c9a02a', 6, 1, [HALF, 0, 0], METAL); }
  }
  pic2(B, 'p_deke', 0, 90, bz + 0.6, 66, 16, 0);
  // clutter on the bench: a can of nails, wrenches, a hand drill, sparks' scorch
  B.cyl('std', L * 0.34, topY, -W * 0.18, 4, 7, '#7a6a4a', 10, 1, null, METAL);
  for (let i = 0; i < 4; i++) B.box('std', -L * 0.02 + i * 5, topY + 0.7, W * 0.1 + i * 2, 12, 1.2, 2, '#9a9ea2', [0, 0.3 + i * 0.4, 0], METAL);
  jerrycan(B, L / 2 + 6, 0, W / 2 - 4, 0.3, '#2f6a3a');
  // a work lamp on a bracket
  const lx = L / 2 - 8, lz = -W / 2 + 6;
  rod(B, 'std', [lx, topY, lz], [lx, topY + 32, lz], 0.9, '#3a3e42', METAL, 5);
  rod(B, 'std', [lx, topY + 32, lz], [lx - 12, topY + 30, lz + 8], 0.7, '#3a3e42', METAL, 5);
  B.rblock('std', lx - 13, topY + 26, lz + 9, 9, 6, 6, 0.8, '#e0b020', [0.3, 0.6, 0], METAL);
  B.box('glow', lx - 14, topY + 25, lz + 12.4, 6.4, 3.6, 0.5, '#fff0d0', [0.3, 0.6, 0], { emissive: 4.2, uv: atlasUV('white'), noAO: true });
  halos.push({ x: P.it.x + lx * Math.cos(P.o.a) - (lz + 12) * Math.sin(P.o.a), y: P.it.y + lx * Math.sin(P.o.a) + (lz + 12) * Math.cos(P.o.a), h: topY + 26, color: '#fff0d0', size: 56, strength: 0.5 });
  P.dyn.sparks.push({ x: P.it.x, y: P.it.y, h: topY + 6 });
}

/** The upgrade board: plywood on posts, the "Haven Fund" header, a chalk tally, blueprints and notes. */
function signboard(P) {
  const { B, L } = P;
  const w = Math.min(112, L - 6);
  for (const s of [-1, 1]) post(B, s * (w / 2 - 4), 0, -1.5, 2.2, 88, C.woodD);
  B.rblock('std', 0, 22, 0, w, 62, 2.6, 0.5, '#8a7048', null, WOOD);
  B.box('std', 0, 22.6, 1.5, w + 2, 2, 2, C.woodD, null, WOOD);
  B.box('std', 0, 83.4, 1.5, w + 2, 2, 2, C.woodD, null, WOOD);
  pic(B, 'p_fund', 0, 75, 1.6, w - 8, 16, 0);
  pic(B, 'tally', -w * 0.26, 47, 1.8, w * 0.36, w * 0.36 * 1.25, -0.03);
  pic(B, 'blueprint', w * 0.2, 55, 1.8, w * 0.44, w * 0.44 * 0.7, 0.03);
  pic(B, 'notes', w * 0.22, 32, 1.8, w * 0.36, w * 0.27, -0.02);
  pic(B, 'tag', w * 0.02, 30, 1.8, 14, 7, 0.1);
  // a coin jar (a glass jar of scrap) on a shelf below
  B.box('std', 0, 20, 4, w * 0.5, 2, 9, C.woodD, null, WOOD);
  B.cyl('glass', -w * 0.06, 21, 4, 4, 9, '#9fb8b0', 10, 1, null, { surf: [0, 0.1, 0.1] });
  B.cyl('std', -w * 0.06, 21, 4, 3.2, 5, '#c9a02a', 8, 1, null, METAL);
}

/** The range bench: sandbag rests, ammo cans, ear muffs, a score card on a post. */
function rangebench(P) {
  const { B, L, W } = P;
  B.rblock('std', 0, 26, 0, L, 3, W, 0.6, '#6a4a2c', null, WOOD);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) B.block('std', sx * (L / 2 - 4), 0, sz * (W / 2 - 6), 4, 26, 4, C.woodD, null, WOOD);
  B.box('std', 0, 14, 0, L - 6, 2, W - 8, C.woodD, null, WOOD);
  // sandbag rests along the top, ammo cans, ear muffs on a nail
  for (const z of [-W * 0.34, 0, W * 0.34]) B.add('std', T.pillow(10, 6, 0.4), [0, 31, z], [L * 0.32, 3.4, 9], [0, 0, 0], '#8a7a55', CANVAS);
  for (let i = 0; i < 3; i++) {
    const z = -W * 0.3 + i * 22;
    B.rblock('std', -L * 0.2, 29, z, 11, 8, 15, 0.6, '#4b5320', [0, 0.1 * i, 0], METAL);
    B.box('std', -L * 0.2, 33.4, z, 6, 1.6, 4, '#d8b43a', null, { surf: [0, 0.5, 0] });
  }
  const mz = W * 0.4;
  B.add('std', T.torus(10, 0.18, 4), [L * 0.2, 36, mz], [5.4, 5.4, 5.4], [0, HALF, 0], '#e0b020', S(DET.rubber, 0.7, 0));
  for (const s of [-1, 1]) B.rblock('std', L * 0.2, 31.5, mz + s * 5.4, 3.2, 6, 4, 1, '#222', null, S(DET.rubber, 0.7, 0));
  // the score post at the end
  post(B, 0, 0, W / 2 + 16, 2, 82, C.woodD);
  pic2(B, 'p_range', -L / 2 - 6, 72, W / 2 + 18, 48, 12, HALF);
}

// ---- canopies --------------------------------------------------------------------------------------------

/** A lean-to: four posts, a pitched roof (canvas or corrugated) with its high edge at local -z. */
function leanto(P) {
  const { B, it, halos } = P;
  const w = it.w || 160, d = it.d || 110, hi = it.hi || 100, lo = it.lo || 80;
  const metal = !!it.metal;
  const col = it.cloth || (metal ? '#8f979c' : '#a8a084');
  for (const sx of [-1, 1]) {
    post(B, sx * (w / 2 - 3), 0, -d / 2 + 3, 2.4, hi, C.woodD);
    post(B, sx * (w / 2 - 3), 0, d / 2 - 3, 2.4, lo, C.woodD);
  }
  // rafters and the roof sheet
  const pitch = Math.atan2(hi - lo, d);
  const slen = Math.hypot(d, hi - lo) + 10;
  const cy = (hi + lo) / 2 + 1.2;
  B.add('std', T.box(), [0, cy, 0], [w + 12, 1.5, slen], [pitch, 0, 0], col, metal ? CORR : CANVAS);
  for (const sx of [-1, 0, 1]) rod(B, 'std', [sx * (w / 2 - 3), hi - 1, -d / 2 + 3], [sx * (w / 2 - 3), lo - 1, d / 2 - 3], 1.2, C.woodD, WOOD, 5);
  if (!metal) {
    // canvas valance along the low edge
    B.box('std', 0, lo - 3, d / 2 + 4, w + 12, 6, 0.8, shadeHex(col, -0.14), [0.05, 0, 0], CANVAS);
  } else {
    B.box('std', 0, hi + 0.8, -d / 2 - 4, w + 14, 2, 3, '#6a6e72', null, METAL);
  }
  // a lantern hung from the middle of the front rafter
  lantern(B, halos, 0, lo - 19, d / 2 - 12, it.x + Math.cos(it.a) * 0 - Math.sin(it.a) * (d / 2 - 12), it.y + Math.sin(it.a) * 0 + Math.cos(it.a) * (d / 2 - 12), { h: 9, hang: 10, halo: 56, strength: 0.5 });
}

// ---- lights and signs ------------------------------------------------------------------------------------

function stringlightsModel(P) {
  const it = P.it;
  const tierK = P.tier === 'low' ? 1.6 : 1;
  stringLights(P.B, P.halos, it.pts, it.sag ?? 10, { palette: it.palette, gap: 20 * tierK, halo: P.tier === 'low' ? 0 : 36 });
}

function lanternModel(P) {
  const { B, it, halos } = P;
  // a standing lantern on a low crate / the ground
  const z = it.z || 0;
  if (z > 4) B.cyl('std', 0, 0, 0, 5, z, C.woodD, 6, 0.9, null, WOOD);
  lantern(B, halos, 0, z, 0, it.x, it.y, { h: 9, halo: 42, strength: 0.45 });
}

function bunting(P) {
  const { B, it } = P;
  const cols = ['#c0392b', '#e0a020', '#2e86c1', '#e8e2d0', '#2e7d4f', '#d35400'];
  const path = catenary(it.pts.map(([x, y, h]) => [x, h, y]), it.sag ?? 8, 9);
  let k = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    rod(B, 'std', a, b, 0.25, '#1e1c1a', S(0, 0.8, 0.1), 4);
    if (i % 1 === 0) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      const yaw = Math.atan2(b[2] - a[2], b[0] - a[0]);
      B.add('std', T.profile('bunt', [[-4, 0], [4, 0], [0, -9]], 0, 1), [mx, my, mz], [1, 1, 0.4], [0, -yaw, 0], cols[k++ % cols.length], CANVAS);
    }
  }
}

/** The tall pole sign by the road: ROADHOUSE in pink, VACANCY in cyan with a flickering NO. */
function signpole(P) {
  const { B, it, halos } = P;
  const H = it.h || 250;
  B.cyl('std', 0, 0, 0, 5.5, H - 40, '#5a5e62', 10, 0.8, null, RUSTY);
  B.cyl('std', 0, 0, 0, 9, 8, '#4a4e52', 10, 1, null, S(DET.concrete, 0.9, 0));
  // cabinets and the neon words, seen from both sides (front = local +x)
  const cab = (y, w, h) => {
    B.box('std', 0, y, 0, 8, h, w, '#17131a', null, METAL);
    B.box('std', 0, y + h / 2 + 0.8, 0, 9.6, 1.6, w + 3, '#2a2a30', null, METAL);
    B.box('std', 0, y - h / 2 - 0.8, 0, 9.6, 1.6, w + 3, '#2a2a30', null, METAL);
  };
  cab(H - 20, 176, 44);
  cab(H - 66, 100, 26);
  cab(H - 104, 134, 34);
  neonWord(B, 'n_roadhouse', 4.4, H - 20, 0, 166, 36, HALF, 3.2, true);
  neonWord(B, 'n_motel', 4.4, H - 66, 0, 86, 21, HALF, 3, true);
  neonWord(B, 'n_vacancy', 4.4, H - 104, 8, 96, 24, HALF, 3, true);
  neonWord(B, 'n_no', 4.4, H - 104, -48, 30, 22, HALF, 3.4, true, 'hubflick');
  // brackets and cross-braces
  for (const s of [-1, 1]) rod(B, 'std', [0, H - 128, 0], [0, H - 96, s * 62], 1.1, '#3a3a40', METAL, 5);
  const wx = it.x, wy = it.y;
  halos.push({ x: wx, y: wy, h: H - 20, color: '#ff4f9a', size: 330, strength: 0.6 });
  halos.push({ x: wx, y: wy, h: H - 66, color: '#ffb03a', size: 170, strength: 0.4 });
  halos.push({ x: wx, y: wy, h: H - 104, color: '#38e8ff', size: 240, strength: 0.5 });
}

/** A hand-painted board (HAVEN OR BUST) hung on the gate. */
function paintedsign(P) {
  const { B, it } = P;
  const w = it.w || 190, h = it.h || 40;
  const cell = { 'HAVEN OR BUST': 'p_haven' }[it.text] || 'p_haven';
  pic2(B, cell, 0, it.z || 60, 0, w, h, HALF);
  for (const s of [-1, 1]) B.box('std', 0, (it.z || 60) + s * h * 0.42, 0, 2, 2, w + 4, C.woodD, null, WOOD);
}

// ---- lived-in details --------------------------------------------------------------------------------------

/** A picnic table with benches, a game of checkers, a lantern and mugs. */
function picnic(P) {
  const { B, halos, it } = P;
  const L = 70, W = 34;
  B.rblock('std', 0, 25, 0, L, 2.6, W, 0.5, '#7a5a38', null, WOOD);
  for (const s of [-1, 1]) {
    B.rblock('std', 0, 14, s * (W / 2 + 10), L - 6, 2.4, 11, 0.5, '#6a4a2c', null, WOOD);
    for (const x of [-L / 2 + 10, L / 2 - 10]) {
      rod(B, 'std', [x, 25, s * (W / 2 - 3)], [x, 0, s * (W / 2 + 12)], 1.5, C.woodD, WOOD, 5);
      rod(B, 'std', [x, 14, s * (W / 2 + 10)], [x, 0, s * (W / 2 + 12)], 1.4, C.woodD, WOOD, 5);
    }
  }
  // a checker board with pieces
  B.box('std', -8, 26.6, 0, 22, 0.8, 22, '#e8dcb0', null, WOOD);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) B.box('std', -8 - 8.25 + i * 5.5 + 2.75, 27.1, -8.25 + j * 5.5 + 2.75, 5.5, 0.4, 5.5, '#3a2c1c', null, WOOD);
  for (const [i, j, c] of [[0, 1, '#b02a2a'], [1, 0, '#b02a2a'], [2, 1, '#b02a2a'], [1, 2, '#e8e0c8'], [3, 2, '#e8e0c8'], [2, 3, '#e8e0c8']]) B.cyl('std', -8 - 8.25 + i * 5.5 + 2.75, 27.4, -8.25 + j * 5.5 + 2.75, 1.9, 1.2, c, 8, 1, null, S(DET.plastic, 0.4, 0));
  mug(B, 20, 27.6, -8, '#c8b078');
  mug(B, 14, 27.6, 10, '#7a9ab0');
  // playing cards fanned out
  for (let i = 0; i < 4; i++) B.box('std', 24 + i * 1.4, 27.8 + i * 0.05, 4 + i * 1.6, 5, 0.2, 3.4, '#f0ece0', [0, 0.3 + i * 0.25, 0], CANVAS);
  lantern(B, halos, 0, 27.6, 0, it.x, it.y, { h: 9, halo: 46, strength: 0.5 });
  B.add('std', T.pillow(8, 5, 0.5), [-24, 30, 8], [4.6, 3.4, 4.6], [0, 0.4, 0], '#9a7a58', S(DET.fabric, 0.9, 0));
}

/** An acoustic guitar propped against a log (facing = the way the soundhole points). */
function guitar(P) {
  const { B } = P;
  const lean = 0.34;
  B.add('std', T.sphere(12, 8), [0, 20, 0], [12, 3.4, 9], [0, 0, lean], '#a8642a', S(DET.wood, 0.45, 0));
  B.add('std', T.sphere(12, 8), [0.6, 8, 0], [10.5, 3, 7.6], [0, 0, lean], '#a8642a', S(DET.wood, 0.45, 0));
  B.cyl('std', 1.6, 12, 0, 3.6, 0.6, '#1a1612', 12, 1, [HALF * 0.0, 0, lean + HALF * 0.0], S(0, 0.6, 0));
  rod(B, 'std', [0, 22, 0], [-6, 46, 0], 1.3, '#4a3020', WOOD, 5);
  B.box('std', -6.4, 48, 0, 2.4, 5, 2, '#2a1c14', [0, 0, lean], WOOD);
}

/** A cat asleep on a crate, curled up (a fat pillow with ears and a tail). */
function cat(P) {
  const { B } = P;
  crate(B, 0, 0, 0, 16, 0.2, '#7a5a38');
  const fur = '#c98a3a';
  B.add('std', T.pillow(10, 7, 0.7), [0, 20, 0], [8, 4.4, 5.6], [0, 0.5, 0], fur, S(DET.fabric, 0.95, 0));
  B.add('std', T.sphere(8, 6), [5.4, 21.6, 2.4], [3, 2.7, 2.7], null, fur, S(DET.fabric, 0.95, 0));
  for (const s of [-1, 1]) B.add('std', T.cyl(3, 0.05), [6.2, 24.4, 2.4 + s * 1.5], [1.1, 2, 1.1], null, fur, S(DET.fabric, 0.95, 0));
  B.add('std', T.cyl(6), [-4, 18.4, -3.6], [1.2, 9, 1.2], [HALF, 0.4, 0], shadeHex(fur, -0.2), S(DET.fabric, 0.95, 0));
  for (const [x, z] of [[-1, 2.6], [1.6, -3]]) B.add('std', T.sphere(6, 4), [x, 16.6, z], [1.5, 1.2, 1.5], null, '#f0e8d8', S(DET.fabric, 0.95, 0));
}

/** The wall of the missing: photographs, a candle shelf, flowers. */
function photowall(P) {
  const { B, halos, it } = P;
  const w = 96, h = 60;
  for (const s of [-1, 1]) post(B, -1.5, 0, s * (w / 2 - 3), 2, h + 24, C.woodD);
  B.rblock('std', 0, 26, 0, 2.4, h, w, 0.5, '#6a5238', null, WOOD);
  B.add('hub', T.plane(), [1.5, 26 + h * 0.58, 0], [w - 8, (w - 8) / 2, 1], [0, HALF, 0], '#ffffff', { uv: hubUV('polaroids'), noAO: true, noJitter: true });
  pic(B, 'cross', 1.6, 26 + h - 6, 0, 12, 12, HALF);
  // the shelf of candles and dried flowers
  B.box('std', 6, 26, 0, 12, 2, w - 4, C.woodD, null, WOOD);
  const r = B.rng;
  for (let i = 0; i < 7; i++) {
    const z = -w / 2 + 10 + i * ((w - 20) / 6);
    const hh = r.range(4, 9);
    B.cyl('std', 6.4, 27, z, 1.6, hh, ['#efe6c8', '#d8c8a0', '#efe6c8'][i % 3], 6, 1, null, S(DET.plastic, 0.6, 0));
    B.box('glow', 6.4, 27 + hh + 1, z, 0.9, 1.6, 0.9, '#ffb545', null, { emissive: 5, uv: atlasUV('white'), noAO: true });
    halos.push({ x: it.x + Math.cos(it.a) * 6.4 - Math.sin(it.a) * z, y: it.y + Math.sin(it.a) * 6.4 + Math.cos(it.a) * z, h: 27 + hh + 1, color: '#ffb545', size: 26, strength: 0.6, flicker: 0.8 });
  }
  for (const z of [-w / 2 + 4, w / 2 - 4]) {
    for (let k = 0; k < 4; k++) B.add('std', T.sphere(5, 4), [5 + r.range(-2, 2), 30 + k * 2.4, z + r.range(-2, 2)], [1.6, 1.6, 1.6], null, ['#d84a4a', '#e8c04a', '#e8e0d0', '#9a6ac8'][k], S(DET.fabric, 0.9, 0));
  }
}

/** A cork board on a wall: kids' drawings, notes, a calendar. */
function pinboard(P) {
  const { B } = P;
  B.rblock('std', 0.6, 30, 0, 1.6, 44, 74, 0.5, '#8a6a44', null, WOOD);
  B.add('hub', T.plane(), [1.6, 52, 0], [68, 34, 1], [0, HALF, 0], '#ffffff', { uv: hubUV('cork'), noAO: true, noJitter: true });
  B.add('hub', T.plane(), [1.9, 52, -6], [58, 29, 1], [0, HALF, 0.02], '#ffffff', { uv: hubUV('kids'), noAO: true, noJitter: true });
  B.add('hub', T.plane(), [1.9, 40, 22], [26, 19, 1], [0, HALF, -0.04], '#ffffff', { uv: hubUV('notes'), noAO: true, noJitter: true });
  B.add('hub', T.plane(), [1.9, 40, -22], [18, 24, 1], [0, HALF, 0.05], '#ffffff', { uv: hubUV('calendar'), noAO: true, noJitter: true });
}

/** Porch lamp on a post with a doormat and a pair of slippers by the door. */
function bedlamp(P) {
  const { B, halos, it } = P;
  post(B, 0, 0, 0, 1.8, 56, '#3a3a40', METAL, 6);
  lantern(B, halos, 0, 52, 0, it.x, it.y, { h: 9, halo: 50, strength: 0.5 });
  B.add('std', T.box(), [12, 0.5, 0], [30, 1, 44], [0, 0, 0], '#7a3a2a', CANVAS);
  B.add('hub', T.plane(), [12, 1.05, 0], [24, 36, 1], [-HALF, HALF, 0], '#ffffff', { uv: hubUV('paper'), noAO: true, noJitter: true });
  for (const s of [-1, 1]) B.add('std', T.pillow(6, 4, 0.6), [12, 2.6, s * 4], [6, 2, 2.4], [0, s * 0.2, 0], '#a86a8a', CANVAS);
  B.cyl('std', 6, 0, 26, 5, 9, '#a0522d', 9, 0.8, null, S(DET.tile, 0.8, 0));
  B.cyl('std', 6, 2, 26, 1.4, 22, '#4a7a3a', 5, 0.8, null, S(DET.fabric, 0.9, 0));
}

/** A lookout's nest on a roof: sandbags, a folding chair, a lantern, binoculars (y offset = the roof). */
function lookoutnest(P) {
  const { B, it, halos } = P;
  const z = it.z || 96;
  B.add('std', T.box(), [0, z + 1, 0], [58, 2, 42], null, '#6a5a44', WOOD);
  sandbagArc(B, 0, 0, 24, Math.PI * 0.05, Math.PI * 1.95, 2, '#8a7a55');
  // (sandbags stack from y = 0: lift them by the roof height)
  void z;
  crate(B, -14, z + 2, -8, 10, 0.3);
  lantern(B, halos, -14, z + 12, -8, it.x - 14, it.y - 8, { h: 9, halo: 46, strength: 0.5 });
  // a folding chair and a blanket
  B.box('std', 10, z + 12, 2, 12, 1.4, 12, '#3a5a8a', [0, 0.3, 0], CANVAS);
  B.box('std', 4, z + 20, 2, 1.4, 16, 12, '#3a5a8a', [0, 0.3, 0.1], CANVAS);
  rod(B, 'std', [4, z + 2, -3], [16, z + 12, 8], 0.5, '#2a2a2c', METAL, 4);
  rod(B, 'std', [16, z + 2, -3], [4, z + 12, 8], 0.5, '#2a2a2c', METAL, 4);
}

/** The radio room's wire antenna on the office roof. */
function roofantenna(P) {
  const { B, it } = P;
  const y0 = it.z || 128;
  for (const s of [-1, 1]) {
    rod(B, 'std', [0, y0, s * 42], [0, y0 + 34, s * 42], 0.7, '#8a8e92', METAL, 5);
    B.add('std', T.torus(8, 0.2, 4), [0, y0 + 34, s * 42], [2, 2, 2], [HALF, 0, 0], '#e8e8e0', S(DET.plastic, 0.4, 0));
  }
  rod(B, 'std', [0, y0 + 33, -42], [0, y0 + 33, 42], 0.22, '#c9906a', METAL, 4);
  rod(B, 'std', [0, y0 + 33, 0], [-6, y0 + 8, 0], 0.2, '#222', METAL, 4);
  rod(B, 'std', [0, y0 + 33, 0], [0, y0 + 50, 0], 0.5, '#8a8e92', METAL, 4);
  B.add('blink', T.sphere(6, 4), [0, y0 + 51, 0], [1.6, 1.6, 1.6], null, '#ff2a1a', { emissive: 3.4 });
  P.halos.push({ x: it.x, y: it.y, h: y0 + 51, color: '#ff2a1a', size: 46, blink: 1, strength: 0.7 });
}

/** A gate in the perimeter: two corrugated leaves, a chain, hazard tape, a no-parking sign. */
function gate(P) {
  const { B, it, halos } = P;
  const w = it.w || 200;
  if (it.farm) {
    // a farm lane gate: whitewashed posts, two five-bar leaves, an arch with the farm's name, lanterns
    for (const s of [-1, 1]) {
      post(B, s * (w / 2 + 6), 0, 0, 4.4, 128, '#efe8d4', WOOD, 6);
      B.box('std', s * (w / 2 + 6), 130, 0, 11, 3, 11, '#c9c0a8', null, WOOD);
    }
    B.box('std', 0, 122, 0, w + 20, 6, 5, '#efe8d4', null, WOOD);
    pic2(B, 'p_farm', 0, 138, 0, 118, 30, HALF);
    for (const s of [-1, 1]) {
      const x0 = s * 4, x1 = s * (w / 2 - 2);
      for (const y of [16, 34, 52, 70, 86]) B.box('std', (x0 + x1) / 2, y, 0, Math.abs(x1 - x0), 5, 2.4, '#efe8d4', null, WOOD);
      for (const x of [x0, (x0 + x1) / 2, x1]) B.box('std', x, 50, 0, 3.6, 78, 2.6, '#efe8d4', null, WOOD);
      rod(B, 'std', [x0, 18, 0], [x1, 84, 0], 1.4, '#efe8d4', WOOD, 5);
    }
    for (const s of [-1, 1]) {
      rod(B, 'std', [s * (w / 2 + 6), 116, 6], [s * (w / 2 + 6), 108, 6], 0.3, '#2a2622', METAL, 3);
      lantern(B, halos, s * (w / 2 + 6), 98, 6, it.x + s * (w / 2 + 6), it.y + 6, { h: 9, halo: 60, strength: 0.6 });
    }
    return;
  }
  for (const s of [-1, 1]) {
    post(B, s * (w / 2 + 6), 0, 0, 4.4, 112, C.woodD);
    B.box('std', s * (w / 2 + 6), 113, 0, 12, 3, 12, '#3a3e42', null, METAL);
  }
  for (const s of [-1, 1]) {
    const cx = s * (w / 4 - 1);
    B.block('std', cx, 3, 0, w / 2 - 3, 84, 3.2, s < 0 ? '#8f979c' : '#7a8a92', null, CORR);
    B.box('std', cx, 12, 2.4, w / 2 - 3, 5, 2, C.woodD, null, WOOD);
    B.box('std', cx, 50, 2.4, w / 2 - 3, 5, 2, C.woodD, null, WOOD);
    B.box('std', cx, 76, 2.4, w / 2 - 3, 5, 2, C.woodD, null, WOOD);
    // stripes of hazard tape
    B.add('glow', T.plane(), [cx, 62, 2.2], [w / 2 - 6, 7, 1], null, '#ffffff', { uv: atlasUV('stripeYB'), emissive: 0.5, noAO: true });
  }
  // the chain and lock across the middle
  for (let i = 0; i < 9; i++) B.add('std', T.torus(6, 0.2, 3), [-9 + i * 2.3, 44, 4.4], [1.5, 1.5, 1.5], [i % 2 ? HALF : 0, 0, 0], '#9a9ea2', METAL);
  B.rblock('std', 0, 38, 4.4, 5, 6, 3, 0.6, '#c9a02a', null, METAL);
  // hazard lamps on the posts (amber, blinking)
  for (const s of [-1, 1]) {
    B.add('blink', T.sphere(6, 4), [s * (w / 2 + 6), 118, 0], [2.4, 2.4, 2.4], null, '#ffb020', { emissive: 3 });
    halos.push({ x: it.x + s * (w / 2 + 6), y: it.y, h: 118, color: '#ffb020', size: 64, blink: 1, strength: 0.6 });
  }
  pic(B, 'p_noparking', -w / 4, 100, 4.4, 20, 20, 0);
  if (it.rail) {
    // (the track gates are taller and marked for trains)
    B.box('std', 0, 96, 0, w + 24, 5, 6, '#3a3e42', null, METAL);
    B.add('glow', T.plane(), [w / 4, 62, 4.6], [w / 2 - 12, 8, 1], null, '#ffffff', { uv: atlasUV('stripeRW'), emissive: 0.5, noAO: true });
  }
}

/** A floodlight on a pole aimed along `aim`. */
function floodlight(P) {
  const { B, it, halos } = P;
  const z = it.z || 140;
  post(B, 0, 0, 0, 2.2, z, '#4a4e52', METAL, 6);
  B.rblock('std', 5, z, 0, 14, 8, 20, 0.8, '#3a3e42', [0, 0, -0.35], METAL);
  B.box('glow', 12, z - 3, 0, 1, 6, 16, '#fff6e0', [0, 0, -0.35], { emissive: 4.4, uv: atlasUV('white'), noAO: true });
  halos.push({ x: it.x + 8, y: it.y, h: z - 2, color: '#fff2d6', size: 120, strength: 0.7 });
}

/** A crate stack with a tarp over it. */
function tarpcrates(P) {
  const { B, L, W } = P;
  crate(B, -L * 0.2, 0, 0, 22, 0.1);
  crate(B, L * 0.2, 0, W * 0.1, 20, -0.15);
  crate(B, 0, 22, 0, 18, 0.2);
  tarpSheet(B, [[-L / 2, 30, -W / 2], [L / 2, 30, -W / 2], [L / 2, 12, W / 2], [-L / 2, 12, W / 2]], '#3a5a8a', 3);
}

/** A crate (collision) drawn as a small stack. */
function crateModel(P) {
  const { B, L, W } = P;
  crate(B, 0, 0, 0, Math.min(L, W) * 0.9, 0.1, C.wood, { w: L * 0.9, d: W * 0.9 });
}

const MODELS = {
  perimeter, campring, logseat, couch, maptable, workbench, signboard, rangebench, leanto,
  stringlights: stringlightsModel, lantern: lanternModel, bunting, signpole, paintedsign, picnic, guitar, cat, photowall, pinboard,
  bedlamp, lookoutnest, roofantenna, gate, floodlight, tarpcrates, crate: crateModel,
};

export { MODELS as COMMON_MODELS, HALF };
