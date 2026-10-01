// Set dressing, part 3 (WORLD): the belongings people left behind — strollers, bicycles,
// shopping carts, picnic sets, camp tents with chairs, coolers and grills, sleeping bags,
// garden gnomes, dead campfires, laundry lines, umbrellas, wheelchairs, gurneys, a beach
// ball and a scarecrow.

import { T, S, DET, atlasUV, dressUV, rod, plank, mark, sheet, BRIGHT, MUTED, CANVAS, WOOD, clothGeo } from './dress-kit.js';
import { shadeHex } from './world-geo.js';

const TYRE = [[0.6, -0.5], [0.86, -0.5], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.5], [0.6, 0.5]];
const CHROME = '#c9ced3';
const M = S(0, 0.3, 0.9);
const RUB = S(DET.rubber, 0.85, 0);
const CLOTH = S(DET.fabric, 0.9, 0);
const WOODS = S(DET.wood, 0.85, 0);

/** Rotation of a point (upright bike/cart frame) about the x axis by `t`; the parts' own euler x adds `t`. */
function tilter(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return { p: (x, y, z) => [x, y * c - z * s, y * s + z * c], t };
}

function wheel(D, cx, cy, cz, R, wid, tl, tyre = RUB) {
  const pos = tl.p(cx, cy, cz);
  D.add('std', T.lathe('tyre', TYRE, 12), pos, [R, wid, R], [Math.PI / 2 + tl.t, 0, 0], '#161616', { ...tyre, map: 'cyl' });
}

function stroller(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(BRIGHT.concat(MUTED));
  const lying = r.chance(0.25);
  const tl = tilter(lying ? 1.5 : 0);
  const p = (x, y, z) => tl.p(x, y * s, z);
  for (const z of [-6, 6]) {
    wheel(D, -9, 4.4, z, 4.4, 1.6, tl);
    wheel(D, 10, 3, z * 0.8, 3, 1.4, tl);
    rod(D, 'std', p(-9, 4.4, z), p(-1, 13, z * 0.9), 0.45, CHROME, M, 5);
    rod(D, 'std', p(10, 3, z * 0.8), p(4, 13, z * 0.9), 0.45, CHROME, M, 5);
    rod(D, 'std', p(-1, 13, z * 0.9), p(-7, 26, z * 0.9), 0.45, CHROME, M, 5);
  }
  rod(D, 'std', p(-7, 26, -5.4), p(-7, 26, 5.4), 0.55, '#202224', null, 6);
  D.add('std', T.box(), tl.p(2, 16, 0), [15, 5, 12], [tl.t, 0, 0], col, CLOTH);
  D.add('std', T.sphere(8, 4), tl.p(-1, 21, 0), [8, 9, 6.6], [tl.t, 0, 0.2], shadeHex(col, 0.1), CLOTH);      // hood
  D.add('std', T.pillow(8, 5, 0.5), tl.p(4, 18.6, 0), [4, 1.2, 4], [tl.t, 0, 0], '#e8e4d8', CLOTH);             // blanket
  if (r.chance(0.4)) D.add('std', T.pillow(8, 5, 0.5), tl.p(5, 19.4, 0), [3.4, 1.6, 2.6], [tl.t, 0, 0], '#c8a070', CLOTH);
}

function bicycle(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(BRIGHT.concat(['#2a2a2e', '#5a5e62']));
  const lying = r.chance(0.4);
  const tl = tilter(lying ? 1.42 : 0.16);
  const p = (x, y, z) => tl.p(x, y * s, z * s);
  const R = 10.4;
  for (const x of [-14, 14]) {
    wheel(D, x, R, 0, R, 1.8, tl);
    D.add('std', T.box(), tl.p(x, R, 0), [R * 1.7, 0.25, 0.25], [tl.t, 0, 0.6], '#a0a4a8', M);
    D.add('std', T.box(), tl.p(x, R, 0), [R * 1.7, 0.25, 0.25], [tl.t, 0, -0.6], '#a0a4a8', M);
  }
  const B = 'std';
  const tube = (a, b) => rod(D, B, p(...a), p(...b), 0.6, col, S(DET.panel, 0.35, 0.5), 6);
  tube([-14, R, 0], [-2, 12, 0]);          // chain stay to bottom bracket
  tube([-2, 12, 0], [-8, 22, 0]);          // seat tube
  tube([-14, R, 0], [-8, 22, 0]);          // seat stay
  tube([-8, 22, 0], [10, 22.6, 0]);        // top tube
  tube([-2, 12, 0], [10, 22.6, 0]);        // down tube
  tube([10, 22.6, 0], [12, 27, 0]);        // head tube
  rod(D, B, p(12, 25, 0), p(14, R, 0), 0.55, '#3a3e42', M, 6);   // fork
  rod(D, B, p(12, 27.4, -5), p(12, 27.4, 5), 0.5, '#3a3e42', M, 6);   // handlebar
  for (const z of [-5, 5]) D.add('std', T.cyl(6), p(12, 27.4, z), [0.9, 3, 0.9], [tl.t + Math.PI / 2, 0, 0].map((v, i) => (i === 0 ? v : 0)), '#1a1a1a', RUB);
  D.add('std', T.rbox(7, 1.4, 3, 0.6), p(-9, 24, 0), [1, 1, 1], [tl.t, 0, 0.05], '#1a1a1a', RUB);   // saddle
  rod(D, B, p(-8, 22, 0), p(-9, 24, 0), 0.5, CHROME, M, 5);
  D.add('std', T.cyl(8), p(-2, 12, 0), [2.6, 0.5, 2.6], [tl.t + Math.PI / 2, 0, 0], '#4a4e52', M);      // chain ring
  rod(D, B, p(-2, 12, 0), p(-4, 8, 2.6), 0.4, '#3a3e42', M, 5);
  rod(D, B, p(-2, 12, 0), p(0, 16, -2.6), 0.4, '#3a3e42', M, 5);
  if (!lying && r.chance(0.7)) rod(D, B, p(-6, R, 0), p(-4, 0, 3.4), 0.4, '#3a3e42', M, 5);   // kickstand
  if (r.chance(0.4)) D.add('std', T.rbox(6, 3, 8, 0.6), p(-14, 13, 0), [1, 1, 1], [tl.t, 0, 0], '#c8281e', CLOTH);   // rear basket bag
}

function cart(P) {
  const { D } = P;
  const r = D.rng;
  const lying = r.chance(0.3);
  const tl = tilter(lying ? 1.5 : 0.04);
  const p = (x, y, z) => tl.p(x, y, z);
  const F = S(DET.rust, 0.35, 0.9);
  // basket: mesh sides (blended chain), wire frame
  const bw = 22, bd = 14, y0 = 14, y1 = 27;
  for (const z of [-bd / 2, bd / 2]) {
    D.add('fence', T.plane(), tl.p(0, (y0 + y1) / 2, z), [bw, y1 - y0, 1], [tl.t, 0, 0], '#c9ced3', { uvScale: [bw / 6, (y1 - y0) / 6] });
    rod(D, 'std', p(-bw / 2, y1, z), p(bw / 2, y1, z), 0.4, CHROME, F, 4);
    rod(D, 'std', p(-bw / 2, y0, z), p(bw / 2, y0, z), 0.4, CHROME, F, 4);
  }
  for (const x of [-bw / 2, bw / 2 + 2]) {
    D.add('fence', T.plane(), tl.p(x, (y0 + y1) / 2, 0), [bd, y1 - y0, 1], [tl.t, Math.PI / 2, 0], '#c9ced3', { uvScale: [bd / 6, (y1 - y0) / 6] });
  }
  for (let x = -bw / 2; x <= bw / 2; x += 4) rod(D, 'std', p(x, y0, -bd / 2), p(x, y0, bd / 2), 0.3, CHROME, F, 4);
  rod(D, 'std', p(-bw / 2, y1 + 1, -bd / 2), p(-bw / 2 - 6, y1 + 4, -bd / 2), 0.5, CHROME, F, 5);
  rod(D, 'std', p(-bw / 2, y1 + 1, bd / 2), p(-bw / 2 - 6, y1 + 4, bd / 2), 0.5, CHROME, F, 5);
  rod(D, 'std', p(-bw / 2 - 6, y1 + 4, -bd / 2), p(-bw / 2 - 6, y1 + 4, bd / 2), 0.6, '#c8281e', S(DET.plastic, 0.5, 0), 5);
  for (const [x, z] of [[-bw / 2 + 2, -bd / 2 + 1], [-bw / 2 + 2, bd / 2 - 1], [bw / 2 - 1, -bd / 2 + 1], [bw / 2 - 1, bd / 2 - 1]]) {
    rod(D, 'std', p(x, y0, z), p(x, 4, z), 0.4, CHROME, F, 4);
    D.add('std', T.cyl(8), p(x, 2.4, z), [2.2, 1.4, 2.2], [tl.t + Math.PI / 2, 0, 0], '#161616', { ...RUB, map: 'cyl' });
  }
  if (r.chance(0.35)) D.add('std', T.pillow(8, 5, 0.5), p(0, 17, 0), [5, 3, 4], [0, r.range(0, 6), 0], r.pick(['#131416', '#e8e8e0']), S(DET.plastic, 0.3, 0));
}

function picnic(P) {
  const { D } = P;
  const r = D.rng;
  const W = 46, Dd = 26;
  const F = WOODS;
  const col = r.pick(['#8a6a44', '#6b4a2c', '#7a5a34']);
  for (let i = 0; i < 6; i++) D.rbox('std', 0, 16.4, -Dd / 2 + 2.2 + i * 4.3, W, 1.4, 4, 0.3, col, null, F);
  for (const x of [-W * 0.32, W * 0.32]) {
    rod(D, 'std', [x, 16, -Dd / 2 + 2], [x - 5, 0, -Dd / 2 - 8], 0.9, col, F, 5);
    rod(D, 'std', [x, 16, Dd / 2 - 2], [x - 5, 0, Dd / 2 + 8], 0.9, col, F, 5);
    rod(D, 'std', [x, 16, -Dd / 2 + 2], [x + 5, 0, -Dd / 2 - 8], 0.9, col, F, 5);
    rod(D, 'std', [x, 16, Dd / 2 - 2], [x + 5, 0, Dd / 2 + 8], 0.9, col, F, 5);
    D.box('std', x, 11, 0, 1.4, 2.4, Dd + 14, col, null, F);
  }
  for (const z of [-Dd / 2 - 8, Dd / 2 + 8]) {
    for (let k = 0; k < 2; k++) D.rbox('std', 0, 9.4, z + (z > 0 ? 1 : -1) * (k * 3.6 - 1.8), W, 1.3, 3.4, 0.3, col, null, F);
  }
  // checkered cloth, plates, a basket, cups
  if (r.chance(0.7)) {
    D.add('sign', T.plane(), [0, 17.3, 0], [W * 0.7, Dd * 0.9, 1], [-Math.PI / 2, 0, 0.1], '#ffffff', { uv: dressUV('checker'), noAO: true, noJitter: true });
  }
  for (let i = 0; i < 3; i++) D.cyl('std', r.range(-16, 16), 17.1, r.range(-7, 7), 3, 0.5, '#e8e6e0', 10, 1, null, S(DET.plastic, 0.3, 0));
  D.add('std', T.cyl(10, 0.9), [10, 21, 4], [4.4, 7, 4.4], null, '#8a6a3a', { ...S(DET.wood, 0.9, 0), map: 'cyl' });
  D.add('std', T.torus(10, 0.18, 4), [10, 26.4, 4], [4, 4, 1], [0, 0, 0], '#6a4a2a', WOODS);
  D.add('std', T.pillow(8, 5, 0.5), [-8, 18.4, -5], [3.4, 1.6, 2.6], [0, 0.4, 0], '#e8d8a8', CLOTH);
}

function tentCamp(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(CANVAS.concat(['#c8541c', '#2a5ac4', '#2f8a4a', '#e0a020']));
  const F = S(DET.fabric, 0.9, 0);
  const A = 22 * s, Hh = 18 * s, B = 19 * s;
  D.add('std', T.sphere(14, 7), [0, 0, 0], [A, Hh, B], null, col, { ...F, map: 'box' });
  // ground sheet, door with an opened flap, poles, rain fly stripe, guy lines
  D.add('std', T.box(), [0, 0.15, 0], [A * 2.1, 0.3, B * 2.1], null, shadeHex(col, -0.4), F);
  D.add('std', T.cyl(10, 1), [A * 0.86, Hh * 0.36, 0], [B * 0.42, 0.6, B * 0.42].map((v, i) => v), [0, 0, -Math.PI / 2 + 0.3], '#0c0c0a', F);
  D.add('std', T.sphere(8, 4), [A * 0.8, Hh * 0.62, B * 0.34], [A * 0.2, Hh * 0.34, 0.9], [0.3, 0.3, -0.5], shadeHex(col, 0.15), F);
  rod(D, 'std', [-A * 0.9, 0, -B * 0.1], [A * 0.9, 0, -B * 0.1], 0.5, '#2a2a2c', null, 5);
  D.add('std', T.torus(16, 0.04, 4), [0, 0.3, 0], [A, B, 1], [Math.PI / 2, 0, 0], shadeHex(col, -0.3), F);
  for (const [gx, gz] of [[1.5, 1.4], [-1.5, 1.4], [1.5, -1.4], [-1.5, -1.4]]) {
    rod(D, 'std', [gx * A * 0.4, Hh * 0.5, gz * B * 0.34], [gx * A * 0.95, 0.6, gz * B * 0.95], 0.18, '#e0d8b8', null, 4);
    rod(D, 'std', [gx * A * 0.95, 0, gz * B * 0.95], [gx * A * 0.95 + 1, 3.4, gz * B * 0.95 + 1], 0.4, '#b8bcc0', M, 4);
  }
  if (r.chance(0.5)) D.add('std', T.cyl(10, 0.9), [A * 1.3, 8, B * 0.5], [4.6, 15, 4.6], [0, 0, 1.4], r.pick(BRIGHT), { ...F, map: 'cyl' });   // a rolled mat
}

function chair(P) {
  const { D } = P;
  const col = D.rng.pick(BRIGHT.concat(MUTED));
  for (const z of [-6, 6]) {
    rod(D, 'std', [-4, 0, z], [4, 11, z], 0.45, '#5a5e62', M, 5);
    rod(D, 'std', [4, 0, z], [-4, 11, z], 0.45, '#5a5e62', M, 5);
    rod(D, 'std', [-4.4, 11.4, z], [-8, 19, z], 0.45, '#5a5e62', M, 5);
    rod(D, 'std', [4, 11, z], [4, 15, z], 0.45, '#5a5e62', M, 5);
    D.box('std', 0, 15.4, z, 9, 0.8, 1.2, '#2a2c30', null, RUB);
  }
  D.add('std', T.pillow(8, 5, 0.5), [0, 11.3, 0], [4.8, 0.9, 6.6], null, col, CLOTH);
  D.add('std', T.pillow(8, 5, 0.5), [-7, 16, 0], [0.9, 5, 6.6], [0, 0, 0.35], col, CLOTH);
  D.cyl('std', 6, 15.5, -8.5, 1.4, 2, '#1a1a1a', 8, 1, null, RUB);
}

function sleepingBag(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#2f4858', '#4a4f35', '#7a3a2a', '#3a5a3a', '#8a5a2a']);
  D.add('std', T.pillow(10, 6, 0.5), [0, 2.2, 0], [12, 2.2, 5], [0, 0, 0], col, CLOTH);
  D.add('std', T.pillow(8, 5, 0.5), [-9.5, 3, 0], [3.2, 1.6, 3.4], [0, 0, 0], '#d8d0c0', CLOTH);
  D.add('std', T.box(), [0, 4.36, 0], [21, 0.2, 0.5], null, shadeHex(col, 0.3), CLOTH);
  if (r.chance(0.5)) D.add('std', T.pillow(8, 5, 0.5), [4, 4.2, 2.5], [5, 0.9, 2.2], [0, 0.4, 0], r.pick(BRIGHT), CLOTH);
}

function cooler(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#c8281e', '#1c4fa8', '#2f8a4a', '#e0a020']);
  const F = S(DET.plastic, 0.4, 0);
  D.rblock('std', 0, 0, 0, 18, 10, 11, 1.4, col, null, F);
  D.rblock('std', r.chance(0.3) ? -3 : 0, 10, 0, 18.6, 2.4, 11.6, 0.8, '#ecece4', r.chance(0.3) ? [0, 0, 0.12] : null, F);
  D.add('std', T.torus(10, 0.16, 4), [0, 8, 6], [2.8, 1.6, 1], null, '#2a2a2c', RUB);
  D.box('std', 9.2, 8, 0, 0.6, 2.4, 3.6, '#ecece4', null, F);
  for (const x of [-7, 7]) D.box('std', x, 5, 5.8, 3, 2.4, 0.4, '#202224', null, F);
}

function grill(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#1a1a1c', '#a01818', '#2a2a2e']);
  const F = S(DET.panel, 0.4, 0.5);
  D.add('std', T.sphere(14, 6), [0, 20, 0], [10, 6.5, 10], [0, 0, 0], col, F);                          // bowl
  D.add('std', T.sphere(14, 6), [0, 21.6, 0], [10.4, 7.5, 10.4], [Math.PI, 0, 0], shadeHex(col, 0.06), F);   // lid resting a bit off
  D.cyl('std', 0, 26, 0, 1.4, 1.4, '#1a1a1c', 8, 1, null, F);
  D.add('std', T.torus(8, 0.3, 4), [0, 25.4, 6.2], [2.2, 2.2, 1], null, '#c9ced3', M);
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.4;
    rod(D, 'std', [Math.cos(a) * 3, 14, Math.sin(a) * 3], [Math.cos(a) * 8, 0, Math.sin(a) * 8], 0.55, '#2a2a2c', F, 5);
  }
  for (const [x, z] of [[8, 0], [-4, 6.9]]) D.cyl('std', x, 0, z, 1.3, 2, '#161616', 8, 1, null, RUB);
  D.cyl('std', 0, 11.4, 0, 6, 0.6, '#3a3a3c', 12, 1, null, F);
  if (r.chance(0.5)) for (let i = 0; i < 4; i++) D.add('std', T.dodeca(), [r.range(-3, 3), 22, r.range(-3, 3)], [1.3, 1, 1.3], [r.range(0, 3), r.range(0, 3), 0], '#1a1a1a', S(DET.char, 0.95, 0));
}

function gnome(P) {
  const { D, s } = P;
  const r = D.rng;
  const coat = r.pick(['#1c4fa8', '#2f8a4a', '#8a3a9a', '#c8781c']);
  const F = S(DET.plastic, 0.4, 0);
  D.cyl('std', 0, 0, 0, 2.2 * s, 5 * s, coat, 10, 0.85, null, F);
  D.cyl('std', 0, 4.6 * s, 0, 2.4 * s, 0.7, '#1a1a1c', 10, 1, null, F);                       // belt
  D.add('std', T.sphere(8, 5), [0.4, 6.4 * s, 0], [1.7 * s, 1.7 * s, 1.7 * s], null, '#e8b898', F);   // face
  D.add('std', T.cone ? T.cone() : T.cyl(8, 0.08), [0, 10.4 * s, 0], [1.9 * s, 4.6 * s, 1.9 * s], [0, 0, 0.12], '#c8281e', F);   // hat
  D.add('std', T.cyl(8, 0.1), [1.3 * s, 4.6 * s, 0], [1.5 * s, 3.4 * s, 1.5 * s], [0, 0, 3.05], '#f0f0ea', F);          // beard
  D.add('std', T.sphere(6, 4), [1.8 * s, 6.6 * s, 0], [0.4, 0.4, 0.4], null, '#d08070', F);   // nose
  for (const z of [-1, 1]) D.add('std', T.sphere(5, 3), [0.5, 3.4 * s, z * 2.4 * s], [0.9, 0.9, 0.9], null, '#e8b898', F);
  if (r.chance(0.3)) D.cyl('std', 0.6, 0, -2.6 * s, 1.6 * s, 0.6, '#5a4a30', 8, 1, null, F);
}

function campfire(P) {
  const { D } = P;
  const r = D.rng;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * 6.283;
    D.add('std', T.dodeca(), [Math.cos(a) * 8.5, 1.6, Math.sin(a) * 8.5], [r.range(1.8, 3), r.range(1.4, 2.2), r.range(1.8, 3)], [r.range(0, 3), r.range(0, 3), 0], r.pick(['#6d6a63', '#77726a', '#5f5b55']), { surf: [DET.rock, 0.85, 0], wobble: { amp: 0.25, seed: k } });
  }
  mark(D, 'f_soot', 0, 0, 22, 22, r.range(0, 6), '#050505', 0.24);
  for (let k = 0; k < 4; k++) D.add('std', T.cyl(7, 0.8), [0, 1.8 + (k > 1 ? 1.6 : 0), 0], [1.5, 14, 1.5], [0, k * 0.8 + r.range(-0.2, 0.2), Math.PI / 2 - 0.05], '#1c1612', { surf: [DET.char, 0.95, 0], map: 'cyl' });
  if (r.chance(0.5)) {
    for (let k = 0; k < 5; k++) D.add('glow', T.sphere(4, 3), [r.range(-3, 3), 2.4, r.range(-3, 3)], [0.8, 0.5, 0.8], null, '#ff6a1a', { emissive: 2.2, uv: atlasUV('white') });
  }
}

function laundry(P) {
  const { D } = P;
  const r = D.rng;
  const L = 60;
  for (const z of [-L / 2, L / 2]) {
    rod(D, 'std', [0, 0, z], [0, 50, z], 0.9, '#6b4a2c', WOODS, 6);
    rod(D, 'std', [0, 46, z], [0, 50, z + (z > 0 ? -4 : 4)], 0.5, '#6b4a2c', WOODS, 5);
  }
  rod(D, 'std', [0, 48, -L / 2], [0, 45, 0], 0.22, '#e0d8c0', null, 4);
  rod(D, 'std', [0, 45, 0], [0, 48, L / 2], 0.22, '#e0d8c0', null, 4);
  let z = -L / 2 + 9;
  while (z < L / 2 - 8) {
    const w = r.range(7, 12), h = r.range(10, 18);
    const col = r.pick(MUTED.concat(BRIGHT, ['#e8e4d8', '#e8e4d8']));
    D.add('cloth', clothGeo(3, 4), [0, 45 - h / 2 - 0.5, z + w / 2], [h, w, 1], [0, Math.PI / 2, -Math.PI / 2], col, { noAO: true });
    z += w + r.range(2, 6);
  }
}

function umbrella(P) {
  const { D } = P;
  const r = D.rng;
  const tip = r.chance(0.3);
  const col1 = r.pick(['#c8281e', '#2a5ac4', '#e0a020', '#2f8a4a']), col2 = '#ecece4';
  const A = tip ? [0, 0, 0.5] : null;
  rod(D, 'std', [0, 0, 0], tip ? [-14, 22, 0] : [0, 40, 0], 0.9, '#c9ced3', M, 6);
  D.cyl('std', 0, 0, 0, 7, 1.6, '#5a5e62', 12, 0.9, null, CONC());
  const cy = tip ? 22 : 40;
  for (let k = 0; k < 8; k++) {
    D.add('std', T.cyl(3, 0.05), [tip ? -14 : 0, cy + 0.5, 0], [24, 5, 24], [0, k * 0.785 + 0.39, 0.0], k % 2 ? col2 : col1, { ...CLOTH, map: 'cyl' });
  }
  void A;
}
function CONC() { return S(DET.concrete, 0.88, 0); }

function wheelchair(P) {
  const { D, s } = P;
  const F = S(DET.panel, 0.4, 0.6);
  const tl = tilter(D.rng.chance(0.2) ? 1.5 : 0);
  for (const z of [-7.6, 7.6]) {
    wheel(D, -3, 9, z, 9, 1.4, tl);
    D.add('std', T.torus(16, 0.05, 4), tl.p(-3, 9, z * 1.06), [7.6, 7.6, 1], [tl.t, 0, 0], '#c9ced3', M);
    wheel(D, 9, 2.4, z * 0.7, 2.4, 1.2, tl);
    rod(D, 'std', tl.p(-3, 9, z), tl.p(-3, 15, z), 0.4, '#202224', F, 5);
  }
  D.add('std', T.rbox(10, 1.2, 12.4, 0.5), tl.p(0, 15, 0), [1, 1, 1], [tl.t, 0, 0], '#1a1c2a', CLOTH);
  D.add('std', T.rbox(1.2, 11, 12.4, 0.5), tl.p(-5.4, 21, 0), [1, 1, 1], [tl.t, 0, 0], '#1a1c2a', CLOTH);
  for (const z of [-6.4, 6.4]) {
    rod(D, 'std', tl.p(-5.6, 15, z), tl.p(-8, 27, z), 0.5, '#202224', F, 5);
    rod(D, 'std', tl.p(-5.6, 27, z), tl.p(-8.8, 27, z), 0.5, '#101012', RUB, 5);
    rod(D, 'std', tl.p(-4, 15, z), tl.p(4, 15, z), 0.4, '#202224', F, 5);
    rod(D, 'std', tl.p(4, 15, z), tl.p(8, 6, z * 0.7), 0.4, '#202224', F, 5);
    D.add('std', T.rbox(4, 0.6, 3, 0.2), tl.p(9, 5, z * 0.7), [1, 1, 1], [tl.t, 0, 0], '#202224', F);
  }
  void s;
}

function gurney(P) {
  const { D } = P;
  const r = D.rng;
  const F = S(DET.panel, 0.4, 0.6);
  D.add('std', T.rbox(38, 3, 12.6, 0.8), [0, 16, 0], [1, 1, 1], null, '#e8e8e2', CLOTH);
  D.add('std', T.rbox(38.4, 1.4, 13, 0.5), [0, 14, 0], [1, 1, 1], null, '#8a8e92', F);
  for (const x of [-15, 15]) for (const z of [-5, 5]) {
    rod(D, 'std', [x, 14, z], [x, 4, z], 0.6, '#9aa0a4', F, 5);
    D.add('std', T.cyl(8), [x, 2.4, z], [2.2, 1.2, 2.2], [Math.PI / 2, 0, 0], '#202224', { ...RUB, map: 'cyl' });
  }
  for (const z of [-6.6, 6.6]) rod(D, 'std', [-17, 19.6, z], [17, 19.6, z], 0.4, '#9aa0a4', F, 5);
  if (r.chance(0.6)) {
    D.add('std', T.pillow(12, 6, 0.5), [2, 18.2, 0], [15, 2.2, 5.2], [0, 0, 0], r.chance(0.5) ? '#d8d4c8' : '#1a1a1c', CLOTH);
    D.add('flat', T.plane(), [1, 20.4, 0.5], [9, 6, 1], [-Math.PI / 2, 0, 0.2], '#4a0c0a', { uv: dressUV('f_blood'), noAO: true, noJitter: true });
  }
  rod(D, 'std', [-10, 14, 7], [-10, 44, 7], 0.35, '#9aa0a4', F, 5);
  D.add('std', T.pillow(8, 5, 0.5), [-10, 40, 7], [1.6, 3, 1.2], null, '#cfe0e8', S(DET.plastic, 0.3, 0));
}

function beachball(P) {
  const { D } = P;
  D.add('std', T.sphere(12, 8), [0, 6.4, 0], [6.4, 6.4, 6.4], null, D.rng.pick(['#e0a020', '#c8281e', '#20a0b0']), S(DET.plastic, 0.35, 0));
  for (let k = 0; k < 3; k++) D.add('std', T.torus(16, 0.06, 4), [0, 6.4, 0], [6.5, 6.5, 6.5], [k * 1.05, k * 0.7, 0], '#f0f0ea', S(DET.plastic, 0.35, 0));
}

function scarecrow(P) {
  const { D } = P;
  const r = D.rng;
  const F = WOODS;
  rod(D, 'std', [0, 0, 0], [0, 60, 0], 1.3, '#5a4632', F, 6);
  rod(D, 'std', [0, 48, -19], [0, 48, 19], 1.1, '#5a4632', F, 6);
  const shirt = r.pick(['#6b2d2a', '#2f4858', '#8a7a55']);
  D.add('std', T.pillow(8, 6, 0.5), [0, 40, 0], [5.6, 10, 8.4], null, shirt, CLOTH);
  for (const z of [-1, 1]) D.add('std', T.pillow(8, 4, 0.5), [0, 46, z * 13], [3, 3.6, 8], [0, 0, 0], shirt, CLOTH);
  D.add('std', T.sphere(8, 6), [0, 60.5, 0], [4.4, 4.8, 4.4], null, '#c8b070', CLOTH);
  D.cyl('std', 0, 63.6, 0, 5.6, 1, '#4a3a20', 10, 1, null, CLOTH);
  D.cyl('std', 0, 64.4, 0, 3.2, 5, '#4a3a20', 10, 0.8, null, CLOTH);
  for (const z of [-1, 1]) for (let i = 0; i < 6; i++) rod(D, 'std', [0, 46 + (i % 2), z * 21], [r.range(-2, 2), 42 - i * 1.4, z * (23 + r.range(0, 3))], 0.25, '#d0b060', null, 3);
  D.add('std', T.pillow(8, 6, 0.5), [0, 30, 0], [5, 6, 7.4], null, '#4a4f35', CLOTH);
  for (let i = 0; i < 8; i++) rod(D, 'std', [0, 34 - i * 0.4, r.range(-3, 3)], [r.range(-3, 3), 22 - r.range(0, 4), r.range(-4, 4)], 0.25, '#d0b060', null, 3);
}

// keep helper imports referenced in one place (tree-shaking friendly)
void plank; void sheet; void mark; void WOOD;

export const LIFE_PROPS = {
  stroller, bicycle, cart, picnic, tent_camp: tentCamp, chair, sleeping_bag: sleepingBag, cooler, grill, gnome, campfire,
  laundry, umbrella, wheelchair, gurney, beachball, scarecrow,
};
