// Set dressing, part 5 (WORLD): nature — fallen logs, stumps, boulder clusters, pebbles,
// shrubs, ferns, wildflowers, tall grass, mushrooms, reeds and cattails, dead trees,
// driftwood, lily pads and a rowboat. Foliage uses the world's alpha-tested leaf cards
// ('leaves'), the rest is vertex-coloured geometry.

import { T, S, DET, rod, cards, card, cardGeo, atlasUV } from './dress-kit.js';
import { shadeHex } from './world-geo.js';
import { LEAF_CELLS } from './world-tex.js';
import { WATER } from './ground.js';

const BARK = S(DET.bark, 0.9, 0);
const ROCK = S(DET.rock, 0.85, 0);
const GREENS = ['#2a4a26', '#31502a', '#3a5a2c', '#40582e', '#4a5a2c', '#56552f'];
const DRY = ['#8a7a3a', '#a08a48', '#7a6a34', '#6a5a2c'];

function log(P) {
  const { D, s } = P;
  const r = D.rng;
  const L = r.range(60, 104) * s, R = r.range(4.4, 6.4) * s;
  const ang = r.range(0, 6);
  const col = r.pick(['#4a3a2a', '#5a4632', '#3f3226', '#6a5a48']);
  D.add('std', T.cyl(9, 0.92), [0, R * 0.9, 0], [R, L, R], [0, ang, Math.PI / 2], col, { ...BARK, wobble: { amp: 0.05, seed: (r.next() * 99) | 0 }, map: 'cyl' });
  const ex = Math.cos(ang) * L / 2, ez = -Math.sin(ang) * L / 2;
  D.add('std', T.cyl(9, 1), [-ex, R * 0.9, -ez], [R * 0.9, 0.7, R * 0.9], [0, ang, Math.PI / 2], '#b89a68', S(DET.wood, 0.8, 0));   // sawn end with rings
  // jagged break at the other end, stubs of branches, moss
  for (let k = 0; k < 4; k++) D.add('std', T.cyl(5, 0.3), [ex * (0.95 - k * 0.02), R * (1.1 + k * 0.1), ez * 0.95 + r.range(-2, 2)], [1, 6 + k, 1], [r.range(-0.6, 0.6), 0, r.range(-0.4, 0.4)], '#c8ac78', S(DET.wood, 0.9, 0));
  for (let k = 0; k < 3; k++) {
    const t = r.range(-0.4, 0.4);
    rod(D, 'std', [Math.cos(ang) * L * t, R * 1.4, -Math.sin(ang) * L * t], [Math.cos(ang) * L * t + r.range(-10, 10), R * 1.4 + r.range(6, 16), -Math.sin(ang) * L * t + r.range(-10, 10)], 0.9, shadeHex(col, -0.1), BARK, 5, 0.5);
  }
  if (r.chance(0.7)) D.add('std', T.pillow(8, 4, 0.5), [r.range(-L * 0.2, L * 0.2) * Math.cos(ang), R * 1.7, r.range(-L * 0.2, L * 0.2) * -Math.sin(ang)], [R * 1.6, 1.2, R * 1.1], [0, ang, 0], '#3a5a2a', S(DET.grass, 0.95, 0));
}

function stump(P) {
  const { D, s } = P;
  const r = D.rng;
  const R = r.range(5, 7.5) * s, H = r.range(7, 13) * s;
  const col = r.pick(['#4a3a2a', '#5a4632', '#3f3226']);
  D.cyl('std', 0, 0, 0, R * 1.35, 3, shadeHex(col, -0.15), 10, 0.75, null, BARK);
  D.cyl('std', 0, 2, 0, R, H, col, 10, 0.92, null, { ...BARK, wobble: { amp: 0.06, seed: 4 } });
  D.cyl('std', 0, H + 1.6, 0, R * 0.9, 0.5, '#b89a68', 10, 1, null, S(DET.wood, 0.8, 0));
  for (let k = 0; k < 3; k++) rod(D, 'std', [R * 0.9 * Math.cos(k * 2.1), 3, R * 0.9 * Math.sin(k * 2.1)], [R * 2.2 * Math.cos(k * 2.1 + 0.3), 0.6, R * 2.2 * Math.sin(k * 2.1 + 0.3)], 1.2, col, BARK, 5, 0.5);
  if (r.chance(0.5)) D.add('std', T.pillow(8, 4, 0.5), [R * 0.7, H + 2.2, 0], [R * 0.5, 0.9, R * 0.4], null, '#3a5a2a', S(DET.grass, 0.95, 0));
}

function boulders(P) {
  const { D, s } = P;
  const r = D.rng;
  const base = r.pick(['#6d6a63', '#77726a', '#5f5b55', '#7a7264']);
  const n = 3 + Math.floor(r.next() * 4);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, 6.28), d = i === 0 ? 0 : r.range(10, 24) * s;
    const sz = (i === 0 ? r.range(11, 17) : r.range(4, 10)) * s;
    D.add('std', T.dodeca(), [Math.cos(a) * d, sz * 0.5, Math.sin(a) * d], [sz * r.range(0.9, 1.4), sz * r.range(0.6, 0.95), sz * r.range(0.9, 1.3)], [r.range(-0.2, 0.2), r.range(0, 6), r.range(-0.2, 0.2)], shadeHex(base, r.range(-0.12, 0.1)), { ...ROCK, wobble: { amp: 0.25, seed: i * 7 + 1 } });
    if (r.chance(0.35)) D.add('std', T.pillow(8, 4, 0.5), [Math.cos(a) * d, sz * 0.85, Math.sin(a) * d], [sz * 0.7, 0.8, sz * 0.5], [0, r.range(0, 6), 0], r.pick(['#4a6a30', '#6a7a3a', '#8a9a5a']), S(DET.grass, 0.95, 0));   // moss / lichen
  }
  for (let i = 0; i < 6; i++) D.add('std', T.dodeca(), [r.range(-30, 30) * s, 0.9, r.range(-30, 30) * s], [r.range(1, 2.4), 0.9, r.range(1, 2.4)], [0, r.range(0, 6), 0], shadeHex(base, r.range(0, 0.15)), { ...ROCK, wobble: { amp: 0.2, seed: 9 + i } });
}

function pebbles(P) {
  const { D, s } = P;
  const r = D.rng;
  const base = r.pick(['#8a857a', '#77726a', '#9a927e']);
  const n = 4 + Math.floor(r.next() * 4);
  for (let i = 0; i < n; i++) D.add('std', T.ico(0), [r.range(-9, 9) * s, 0.9, r.range(-9, 9) * s], [r.range(0.9, 2.4), r.range(0.6, 1.3), r.range(0.9, 2.2)], [r.range(0, 3), r.range(0, 6), 0], shadeHex(base, r.range(-0.15, 0.12)), { ...ROCK, wobble: { amp: 0.2, seed: i } });
}

function shrub(P) {
  const { D, s } = P;
  const r = D.rng;
  const R = 13 * s;
  const dryMap = P.map && P.map.id === 'truckstop';
  const kind = dryMap ? 0.6 + r.next() * 0.2 : r.next();
  const col = kind < 0.55 ? r.pick(GREENS) : kind < 0.8 ? r.pick(DRY) : r.pick(['#6a3a1c', '#8a4a1c', '#7a5a1c']);
  const L = cards();
  const n = 13 + Math.floor(r.next() * 6);
  D.add('std', T.ico(0), [0, R * 0.5, 0], [R * 0.55, R * 0.45, R * 0.55], [0, r.range(0, 6), 0], shadeHex(col, -0.55), { surf: [DET.grass, 0.95, 0], wobble: { amp: 0.2, seed: 5 }, noAO: true });
  for (let m = 0; m < n; m++) {
    const a = r.range(0, 6.28), u = r.range(0.1, 1);
    const f = [Math.cos(a) * 0.7, r.range(0.3, 1), Math.sin(a) * 0.7];
    card(L, [Math.cos(a) * R * 0.6 * u, R * (0.35 + u * 0.55), Math.sin(a) * R * 0.6 * u], f, r.range(0, 6.28), R * r.range(0.8, 1.2), R * r.range(0.8, 1.2), LEAF_CELLS.scrub, R * 0.1);
  }
  D.add('leaves', cardGeo(L), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  for (let k = 0; k < 4; k++) rod(D, 'std', [0, 0, 0], [r.range(-R, R) * 0.6, R * 0.7, r.range(-R, R) * 0.6], 0.5, '#3a2c1c', BARK, 4, 0.5);
  if (kind < 0.35 && r.chance(0.5)) for (let k = 0; k < 8; k++) D.add('std', T.sphere(5, 3), [r.range(-R, R) * 0.7, R * r.range(0.4, 1.0), r.range(-R, R) * 0.7], [0.7, 0.7, 0.7], null, r.pick(['#c8181c', '#3a1a5a', '#e8a020']), S(DET.plastic, 0.4, 0));
}

function fern(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(GREENS.concat(['#4a6a30']));
  const L = cards();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r.range(-0.2, 0.2);
    const len = r.range(11, 17) * s;
    const f = [Math.cos(a) * 0.5, 0.86, Math.sin(a) * 0.5];
    card(L, [Math.cos(a) * len * 0.38, len * 0.42, Math.sin(a) * len * 0.38], f, a + Math.PI / 2, len * 0.55, len, LEAF_CELLS.pine, len * 0.25);
  }
  D.add('leaves', cardGeo(L), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
}

function flowers(P) {
  const { D, s } = P;
  const r = D.rng;
  const petals = r.pick([['#f2d020', '#e8b010'], ['#c8b8f0', '#e0d0ff'], ['#8a4ab8', '#a86ad0'], ['#d8281e', '#e84a2a'], ['#e870a8', '#f090c0'], ['#3a6ad8', '#5a8af0']]);
  const n = 6 + Math.floor(r.next() * 5);
  for (let i = 0; i < n; i++) {
    const x = r.range(-11, 11) * s, z = r.range(-11, 11) * s, h = r.range(7, 15) * s;
    const lean = r.range(-0.3, 0.3);
    D.add('std', T.blade(), [x, 0, z], [0.9, h, 1], [lean, r.range(0, 6), lean * 0.6], '#3a5a26', { noAO: true, surf: [0, 0.9, 0] });
    D.add('std', T.cyl(5, 1), [x + Math.sin(lean) * h * 0.9, h * 0.97, z], [1.25 * s, 0.35, 1.25 * s], [lean * 0.5 + r.range(-0.3, 0.3), r.range(0, 6), r.range(-0.3, 0.3)], r.chance(0.8) ? petals[0] : petals[1], { noAO: true, surf: [0, 0.8, 0], map: 'cyl' });
    D.add('std', T.blade(), [x, 0, z], [2.2, h * 0.4, 1], [0.9, r.range(0, 6), 0], '#3a5a26', { noAO: true, surf: [0, 0.9, 0] });
  }
}

function tallGrass(P) {
  const { D, s } = P;
  const r = D.rng;
  const dry = r.chance(0.6);
  const cols = dry ? ['#a08a48', '#b09a58', '#8a7a3a', '#c0aa68'] : GREENS.concat(['#5a7a30']);
  const n = 26 + Math.floor(r.next() * 14);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, 6.28), d = Math.sqrt(r.next()) * 13 * s;
    const h = r.range(12, 26) * s;
    D.add('std', T.blade(), [Math.cos(a) * d, 0, Math.sin(a) * d], [r.range(1.4, 2.6), h, 1], [r.range(-0.4, 0.4), r.range(0, 6.28), r.range(-0.5, 0.5)], r.pick(cols), { noAO: true, surf: [0, 0.9, 0] });
    if (dry && r.chance(0.18)) D.add('std', T.cyl(4, 0.6), [Math.cos(a) * d, h * 0.94, Math.sin(a) * d], [0.5, 3, 0.5], null, '#8a6a30', { noAO: true, surf: [0, 0.9, 0] });
  }
}

function mushrooms(P) {
  const { D, s } = P;
  const r = D.rng;
  const cap = r.pick(['#c8281e', '#c8a070', '#e8e0c8', '#8a5a34', '#c85a1c']);
  const n = 3 + Math.floor(r.next() * 3);
  for (let i = 0; i < n; i++) {
    const h = r.range(2.5, 5.5) * s, R = r.range(1.6, 3) * s;
    const x = r.range(-5, 5), z = r.range(-5, 5);
    D.cyl('std', x, 0, z, 0.55 * s, h, '#e8e2cc', 5, 0.8, null, S(DET.fabric, 0.8, 0));
    D.add('std', T.sphere(6, 3), [x, h, z], [R, R * 0.55, R], [0, 0, 0], cap, S(DET.plastic, 0.6, 0));
    if (cap === '#c8281e' && i === 0) for (let k = 0; k < 3; k++) D.add('std', T.sphere(4, 3), [x + r.range(-R, R) * 0.5, h + R * 0.45, z + r.range(-R, R) * 0.5], [0.4, 0.2, 0.4], null, '#f4f0e0', S(0, 0.7, 0));
  }
}

function reeds(P) {
  const { D, s } = P;
  const r = D.rng;
  const cols = ['#5a6a30', '#6a7a38', '#7a7a3c', '#4a5a2a', '#8a8a4a'];
  const n = 12 + Math.floor(r.next() * 8);
  for (let i = 0; i < n; i++) {
    const a = r.range(0, 6.28), d = Math.sqrt(r.next()) * 12 * s;
    const h = r.range(26, 48) * s;
    D.add('std', T.blade(), [Math.cos(a) * d, -8, Math.sin(a) * d], [r.range(1.2, 2), h + 8, 1], [r.range(-0.25, 0.25), r.range(0, 6.28), r.range(-0.3, 0.3)], r.pick(cols), { noAO: true, surf: [0, 0.9, 0] });
  }
  for (let i = 0; i < 5; i++) {
    const a = r.range(0, 6.28), d = Math.sqrt(r.next()) * 9 * s;
    const h = r.range(32, 50) * s;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    rod(D, 'std', [x, -8, z], [x, h, z], 0.32, '#6a7a38', null, 4);
    D.add('std', T.cyl(6, 0.9), [x, h - 2, z], [1, 6.5, 1], null, '#4a2c18', { noAO: true, surf: [DET.fabric, 0.9, 0], map: 'cyl' });
  }
}

function deadTree(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#4a4238', '#544a3e', '#3a342c', '#6a6252']);
  const H = r.range(95, 150) * s;
  const lean = r.range(-0.06, 0.06);
  D.add('std', T.cyl(9, 0.32), [Math.sin(lean) * H / 2, H / 2, 0], [5 * s, H, 5 * s], [0, 0, -lean], col, { ...BARK, wobble: { amp: 0.06, seed: 2 }, map: 'cyl' });
  D.cyl('std', 0, 0, 0, 7.4 * s, 10, shadeHex(col, -0.15), 9, 0.7, null, BARK);
  const branch = (x, y, z, dx, dy, dz, rad, depth) => {
    const L = Math.hypot(dx, dy, dz);
    const ex = x + dx, ey = y + dy, ez = z + dz;
    rod(D, 'std', [x, y, z], [ex, ey, ez], rad, col, BARK, 5, 0.45);
    if (depth > 0) {
      const n = depth > 1 ? 2 : 1 + (r.chance(0.5) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = r.range(0, 6.28);
        branch(ex, ey, ez, Math.cos(a) * L * 0.55 + dx * 0.25, L * r.range(0.25, 0.6), Math.sin(a) * L * 0.55 + dz * 0.25, rad * 0.55, depth - 1);
      }
    }
  };
  const nb = 5 + Math.floor(r.next() * 3);
  for (let i = 0; i < nb; i++) {
    const a = r.range(0, 6.28), y = H * r.range(0.4, 0.92);
    const len = H * r.range(0.2, 0.36) * (1.1 - y / H * 0.5);
    branch(Math.sin(lean) * y, y, 0, Math.cos(a) * len, len * r.range(0.4, 0.9), Math.sin(a) * len, 1.9 * s, 2);
  }
  rod(D, 'std', [Math.sin(lean) * H, H, 0], [Math.sin(lean) * H + r.range(-6, 6), H + 14 * s, r.range(-6, 6)], 1.1 * s, col, BARK, 5, 0.3);
}

function driftwood(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#b8b09a', '#a8a08a', '#c8c0aa']);
  const A = r.range(0, 6);
  const S2 = S(DET.wood, 0.9, 0);
  const seg = (x0, z0, x1, z1, rad) => rod(D, 'std', [x0, rad, z0], [x1, rad * 1.1, z1], rad, col, S2, 6, 0.75);
  const L = 44 * s;
  seg(-L / 2 * Math.cos(A), -L / 2 * Math.sin(A), 0, 0, 3.2);
  seg(0, 0, L / 2 * Math.cos(A + 0.2), L / 2 * Math.sin(A + 0.2), 2.6);
  seg(0, 0, 12 * Math.cos(A + 1.4), 12 * Math.sin(A + 1.4), 1.4);
  seg(-8 * Math.cos(A), -8 * Math.sin(A), -8 * Math.cos(A) + 10 * Math.cos(A - 1.2), -8 * Math.sin(A) + 10 * Math.sin(A - 1.2), 1.1);
}

function lily(P) {
  const { D, s } = P;
  const r = D.rng;
  const n = 3 + Math.floor(r.next() * 4);
  const y = WATER.surface + 0.6;
  for (let i = 0; i < n; i++) {
    const x = r.range(-14, 14) * s, z = r.range(-14, 14) * s, R = r.range(3, 6) * s;
    D.add('std', T.cyl(10, 1), [x, y, z], [R, 0.5, R], [0, 0, 0], r.pick(['#3a5a26', '#456a2c', '#2f4a22']), { noAO: true, surf: [DET.grass, 0.4, 0] });
    D.add('std', T.box(), [x + R * 0.5, y + 0.05, z], [R * 0.5, 0.6, 0.35], [0, r.range(0, 6), 0], '#0a1a12', { noAO: true, surf: [0, 0.4, 0] });
    if (r.chance(0.25)) D.add('std', T.ico(0), [x, y + 0.8, z], [1.6, 1, 1.6], null, r.pick(['#f090c0', '#f4f4ec']), { noAO: true, surf: [0, 0.7, 0] });
  }
}

function rowboat(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#3a5a7a', '#7a3a2a', '#d8d4c8', '#3a6a4a']);
  const F = S(DET.wood, 0.7, 0);
  const A = [0, 0, r.range(-0.1, 0.1)];
  D.add('std', T.sphere(16, 6), [0, 6, 0], [26 * s, 10, 10 * s], A, col, F);
  D.add('std', T.sphere(14, 5), [0, 8.4, 0], [24 * s, 5, 8.6 * s], [0, 0, 0], '#5a4632', S(DET.wood, 0.85, 0));   // the inside
  D.add('std', T.torus(20, 0.35, 4), [0, 9.6, 0], [24.6 * s, 9.4 * s, 1], [Math.PI / 2, 0, 0], shadeHex(col, 0.2), F);   // gunwale
  for (const x of [-8, 2, 12]) D.box('std', x * s, 9, 0, 2.4, 0.8, 17 * s, '#6b4a2c', null, S(DET.wood, 0.85, 0));
  rod(D, 'std', [-16, 16, 6], [10, 6, 24], 0.7, '#6b4a2c', S(DET.wood, 0.85, 0), 5);
  rod(D, 'std', [-12, 14, -7], [12, 5, -26], 0.7, '#6b4a2c', S(DET.wood, 0.85, 0), 5);
  D.add('std', T.pillow(8, 4, 0.5), [20, 8.6, 2], [3, 0.9, 3], null, '#c8b060', S(DET.fabric, 0.9, 0));
}

function cactus(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#4a6a3a', '#3f6a44', '#56763c']);
  const F = S(DET.grass, 0.85, 0);
  const H = r.range(55, 90) * s, R0 = 4.2 * s;
  D.cyl('std', 0, 0, 0, R0, H, col, 8, 0.86, null, F);
  D.add('std', T.sphere(8, 4), [0, H, 0], [R0 * 0.86, R0 * 0.9, R0 * 0.86], null, col, F);
  for (let k = 0; k < 8; k++) D.box('std', Math.cos(k * 0.785) * R0, H * 0.5, Math.sin(k * 0.785) * R0, 0.25, H * 0.9, 0.25, shadeHex(col, -0.25), null, F);
  const arms = Math.floor(r.next() * 3);
  for (let i = 0; i < arms; i++) {
    const a = i * Math.PI + r.range(-0.4, 0.4), y = H * r.range(0.35, 0.6), len = H * 0.28;
    const ex = Math.cos(a) * (R0 + len), ez = Math.sin(a) * (R0 + len);
    rod(D, 'std', [Math.cos(a) * R0 * 0.8, y, Math.sin(a) * R0 * 0.8], [ex, y, ez], R0 * 0.55, col, F, 7);
    rod(D, 'std', [ex, y, ez], [ex, y + H * 0.28, ez], R0 * 0.55, col, F, 7);
    D.add('std', T.sphere(6, 3), [ex, y + H * 0.28, ez], [R0 * 0.5, R0 * 0.5, R0 * 0.5], null, col, F);
  }
  if (r.chance(0.5)) D.add('std', T.ico(0), [R0 * 0.4, H * 0.98, R0 * 0.3], [1.1, 0.7, 1.1], null, r.pick(['#e8c020', '#e05a8a']), S(0, 0.8, 0));
}

function tumbleweed(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#a08a58', '#8a7648', '#b09a68']);
  for (let k = 0; k < 6; k++) {
    D.add('std', T.torus(8, 0.05, 3), [0, 7 * s, 0], [6.4 * s, 6.4 * s, 6.4 * s], [k * 0.52 + r.range(0, 0.3), k * 0.9, k * 0.4], col, { surf: [0, 0.95, 0], noAO: true });
  }
  D.add('std', T.ico(0), [0, 7 * s, 0], [4.6 * s, 4.6 * s, 4.6 * s], null, shadeHex(col, -0.3), { surf: [0, 0.95, 0], noAO: true });
}

function bones(P) {
  const { D } = P;
  const r = D.rng;
  const F = S(DET.rock, 0.85, 0);
  D.add('std', T.sphere(7, 4), [0, 2, 0], [3.4, 2.6, 2.8], [0, r.range(0, 6), 0], '#dcd6c4', F);
  for (const z of [-1, 1]) D.add('std', T.cyl(5, 0.4), [3, 2, z * 2], [0.5, 4, 0.5], [0.3, 0, Math.PI / 2 - z * 0.3], '#dcd6c4', F);
  for (let i = 0; i < 5; i++) rod(D, 'std', [r.range(-4, 12), 1, r.range(-9, 9)], [r.range(-4, 12), 1.4, r.range(-9, 9)], 0.7, '#dcd6c4', F, 4);
}

void atlasUV;

export const NATURE = {
  log, stump, boulders, pebbles, shrub, fern, flowers, tallgrass: tallGrass, mushrooms, reeds, deadtree: deadTree, driftwood, lily, rowboat,
  cactus, tumbleweed, bones,
};
