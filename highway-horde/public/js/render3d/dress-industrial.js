// Set dressing, part 4 (WORLD): industrial and farm clutter — pallets, wooden crates with
// stencils, oil drums, concrete pipes, portable generators, a forklift, hay bales, a
// tractor, a water tower on the horizon, cable reels, wood piles, wheelbarrows, gas
// bottles, IBC totes, a stock trough.

import { T, S, DET, atlasUV, dressUV, rod, mark, BRIGHT, MUTED, pick } from './dress-kit.js';
import { shadeHex } from './world-geo.js';

const TYRE = [[0.6, -0.5], [0.86, -0.5], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.5], [0.6, 0.5]];
const WOODS = S(DET.wood, 0.88, 0);
const RUB = S(DET.rubber, 0.85, 0);
const PANEL = S(DET.panel, 0.45, 0.5);
const RUST = S(DET.rust, 0.7, 0.6);

function palletAt(D, x, y0, z, rot = 0, broken = false) {
  const col = D.rng.pick(['#8a6a44', '#7a5a34', '#9a7a4e']);
  const W = 36, Dd = 27;
  const R = D.rng;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const at = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
  for (const lz of [-Dd / 2 + 2, 0, Dd / 2 - 2]) {
    const [px, pz] = at(0, lz);
    D.rbox('std', px, y0 + 1.6, pz, W, 3.2, 3.2, 0.3, col, [0, -rot, 0], WOODS);
  }
  for (let i = 0; i < 5; i++) {
    if (broken && i === 2) continue;
    const lx = -W / 2 + 2 + i * ((W - 4) / 4);
    const [px, pz] = at(lx, 0);
    D.rbox('std', px, y0 + 4.3, pz, 3.6, 1.3, Dd, 0.3, shadeHex(col, R.range(-0.1, 0.05)), [0, -rot, 0], WOODS);
  }
  for (const lx of [-W / 2 + 2, 0, W / 2 - 2]) {
    const [px, pz] = at(lx, 0);
    D.rbox('std', px, y0 + 0.65, pz, 3.6, 1.3, Dd, 0.3, shadeHex(col, -0.12), [0, -rot, 0], WOODS);
  }
}
function pallet(P) {
  const { D } = P;
  palletAt(D, 0, 0, 0, D.rng.range(0, 6), D.rng.chance(0.25));
  if (D.rng.chance(0.3)) palletAt(D, 4, 0, 30, D.rng.range(0, 6), true);
}



function palletsLoaded(P) {
  const { D } = P;
  const r = D.rng;
  const rot = r.range(0, 6);
  palletAt(D, 0, 0, 0, rot, false);
  const n = 2 + Math.floor(r.next() * 2);
  const col = r.pick(['#a98552', '#b08a56', '#9c7a4a']);
  for (let l = 0; l < n; l++) {
    for (let k = 0; k < 2; k++) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const lx = (k - 0.5) * 16, lz = 0;
      D.add('std', T.rbox(15, 9, 22, 0.6), [lx * c - lz * s, 5 + l * 9.2 + 4.5, lx * s + lz * c], [1, 1, 1], [0, -rot, 0], shadeHex(col, r.range(-0.1, 0.06)), S(DET.wood, 0.9, 0));
    }
  }
  // stretch wrap: a translucent-looking pale sleeve on the top layers
  D.add('std', T.rbox(33, 6, 23, 1.2), [0, 5 + n * 9.2 - 3, 0], [1, 1, 1], [0, -rot, 0], '#dfe6ea', S(DET.plastic, 0.12, 0));
}

function crateAt(D, x, y0, z, rot, w, h, d, cell) {
  const col = D.rng.pick(['#7a5a32', '#8a6a3c', '#6b4a2c', '#5a4a30']);
  const dark = shadeHex(col, -0.3);
  D.add('std', T.rbox(w, h, d, 0.5), [x, y0 + h / 2, z], [1, 1, 1], [0, rot, 0], col, WOODS);
  const c = Math.cos(rot), s = Math.sin(rot);
  const at = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];
  // corner posts and rails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = at(sx * (w / 2 - 0.6), sz * (d / 2 - 0.6));
    D.add('std', T.box(), [px, y0 + h / 2, pz], [1.6, h + 0.2, 1.6], [0, rot, 0], dark, WOODS);
  }
  for (const yy of [1.1, h - 1.1]) D.add('std', T.box(), [x, y0 + yy, z], [w + 0.4, 1.4, d + 0.4], [0, rot, 0], dark, WOODS);
  // diagonal brace on the long side
  for (const sz of [-1, 1]) {
    const [px, pz] = at(0, sz * (d / 2 + 0.3));
    D.add('std', T.box(), [px, y0 + h / 2, pz], [Math.hypot(w, h) * 0.7, 1.2, 0.5], [0, rot, Math.atan2(h, w)], dark, WOODS);
  }
  if (cell) {
    const [px, pz] = at(w / 2 + 0.2, 0);
    D.add('sign', T.plane(), [px, y0 + h / 2, pz], [d * 0.8, d * 0.4, 1], [0, Math.PI / 2 + rot, 0], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
  }
}

const STENCILS = ['st_ammo', 'st_med', 'st_mre', 'st_fuel', 'st_food', 'st_water', null, null];
function crate(P) {
  const { D, s } = P;
  const r = D.rng;
  crateAt(D, 0, 0, 0, r.range(0, 6), 22 * s, 15 * s, 16 * s, r.pick(STENCILS));
  if (r.chance(0.4)) D.add('std', T.box(), [r.range(-14, 14), 0.5, r.range(-14, 14)], [8, 0.6, 1.6], [0, r.range(0, 6), 0], '#7a5a32', WOODS);   // a loose board
}
function crates(P) {
  const { D } = P;
  const r = D.rng;
  const base = r.range(0, 6);
  crateAt(D, -12, 0, 0, base, 22, 15, 16, r.pick(STENCILS));
  crateAt(D, 12, 0, 2, base + r.range(-0.2, 0.2), 22, 15, 16, r.pick(STENCILS));
  crateAt(D, 0, 15, 1, base + r.range(-0.3, 0.3), 22, 15, 16, r.pick(STENCILS));
  if (r.chance(0.5)) crateAt(D, 4, 0, -22, base + 0.6, 18, 12, 14, r.pick(STENCILS));
}

function drumAt(D, x, z, lying, col, rot = 0) {
  const R = 8.5, H = 26;
  const F = S(DET.rust, 0.55, 0.65);
  if (!lying) {
    D.cyl('std', x, 0, z, R, H, col, 10, 1, null, F);
    for (const y of [5, 13, 21]) D.cyl('std', x, y, z, R + 0.35, 1, shadeHex(col, -0.25), 10, 1, null, F);
    D.cyl('std', x, H, z, R + 0.5, 1.2, shadeHex(col, -0.3), 10, 1, null, F);
    D.cyl('std', x + 3, H + 1.2, z + 2, 1.5, 0.9, '#2a2a2a', 8, 1, null, F);
    D.cyl('std', x - 3, H + 1.2, z - 2, 1.1, 0.7, '#6a6e72', 8, 1, null, F);
  } else {
    const c = Math.cos(rot), s = Math.sin(rot);
    D.add('std', T.cyl(10), [x, R, z], [R, H, R], [0, rot, Math.PI / 2], col, { ...F, map: 'cyl' });
    mark(D, 'f_stain', x + c * 18, z - s * 18, 24, 18, rot, '#070605', 0.25);
  }
}
const DRUM_COLS = ['#2a5a9a', '#a02a1c', '#3a6a3a', '#7a6a3a', '#5a5e62', '#8a4a1c'];
function drum(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(DRUM_COLS);
  drumAt(D, 0, 0, r.chance(0.2), col, r.range(0, 6));
  if (r.chance(0.5)) D.add('sign', T.plane(), [8.9, 15, 0], [6, 6, 1], [0, Math.PI / 2, 0], '#ffffff', { uv: dressUV('haz_diamond'), noAO: true });
}
function drums(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(DRUM_COLS);
  const pts = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
  const n = 3 + Math.floor(r.next() * 2);
  for (let i = 0; i < n; i++) drumAt(D, pts[i][0] + r.range(-1, 1), pts[i][1] + r.range(-1, 1), i === 3 && r.chance(0.5), r.chance(0.7) ? col : r.pick(DRUM_COLS), r.range(0, 6));
  D.add('sign', T.plane(), [9.1, 15, -9], [6, 6, 1], [0, Math.PI / 2, 0], '#ffffff', { uv: dressUV('haz_diamond'), noAO: true });
}

function pipes(P) {
  const { D } = P;
  const r = D.rng;
  const steel = r.chance(0.4);
  const R = steel ? 5 : 8, Rin = steel ? 4.2 : 6, L = steel ? 60 : 30;
  const col = steel ? '#5a5e62' : '#8a877e';
  const F = steel ? S(DET.rust, 0.6, 0.7) : S(DET.concrete, 0.9, 0);
  const rows = steel ? [4, 3, 2] : [3, 2];
  const geo = T.lathe('pipe' + R + '_' + Rin, [[Rin, 0], [R, 0], [R, 1], [Rin, 1]], 12);
  let y = R;
  rows.forEach((n, ri) => {
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * (R * 2 + 0.3);
      D.add('std', geo, [-L / 2, y, z], [1, L, 1], [0, 0, -Math.PI / 2], shadeHex(col, r.range(-0.08, 0.05)), { ...F, map: 'cyl' });
      D.add('std', T.cyl(12), [-L / 2 + 0.1, y, z], [Rin - 0.2, L - 0.2, Rin - 0.2], [0, 0, Math.PI / 2], '#0c0b0a', { surf: [0, 0.95, 0] });
    }
    y += R * 1.75;
  });
}

function generator(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#d8281e', '#e0a020', '#2a5ac4', '#5a5e62']);
  const F = PANEL;
  rod(D, 'std', [-9, 6, -8], [-9, 0, -8], 0.5, '#2a2c30', null, 5); rod(D, 'std', [9, 6, -8], [9, 0, -8], 0.5, '#2a2c30', null, 5);
  D.box('std', 0, 6.4, 0, 22, 1.2, 18, '#2a2c30', null, F);
  for (const [x, z] of [[-9, -8], [9, -8], [-9, 8], [9, 8]]) rod(D, 'std', [x, 6.4, z], [x, 22, z], 0.55, '#2a2c30', F, 5);
  D.rbox('std', 0, 13, 0, 18, 12, 15, 1.4, col, null, F);
  D.rbox('std', -3, 22, 0, 12, 6, 14, 1.2, shadeHex(col, -0.15), null, F);
  D.box('std', 9.4, 13, 0, 0.6, 9, 12, '#1a1c1e', null, F);
  for (const z of [-3.6, 0, 3.6]) D.cyl('std', 9.9, 15, z, 0.9, 0.6, '#c9ced3', 8, 1, [0, 0, Math.PI / 2], S(0, 0.3, 0.9));
  D.box('glow', 9.9, 10, 3, 0.4, 1.3, 1.3, '#7dff7a', null, { emissive: 1.8, uv: atlasUV('white') });
  D.cyl('std', -6, 24, 5, 1.1, 5, '#3a3a3a', 8, 1, null, RUST);
  D.cyl('std', -3, 0, -12, 2.6, 2.4, '#161616', 10, 1, [0, 0, Math.PI / 2], RUB);
  D.add('std', T.torus(10, 0.3, 4), [-8, 22, -9], [3, 3, 1], [0, 0, 0], '#c9ced3', S(0, 0.3, 0.9));
}

function forklift(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#e0a020', '#e0a020', '#c8281e', '#d8d8d0']);
  const F = PANEL;
  // chassis + counterweight, seat, overhead guard, mast + carriage + forks
  D.rbox('std', -6, 13, 0, 34, 12, 22, 2.2, col, null, F);
  D.rbox('std', -20, 19, 0, 12, 18, 22, 2.4, shadeHex(col, -0.1), null, F);
  D.rbox('std', 8, 21, 0, 12, 6, 20, 1.4, '#2a2c30', null, F);
  D.rbox('std', -6, 24, 0, 8, 3, 9, 0.8, '#1a1a1c', null, S(DET.fabric, 0.9, 0));
  D.rbox('std', -10, 30, 0, 2, 9, 8, 0.8, '#1a1a1c', [0, 0, 0.15], S(DET.fabric, 0.9, 0));
  for (const [x, z] of [[2, -9], [2, 9], [-14, -9], [-14, 9]]) rod(D, 'std', [x, 20, z], [x, 52, z], 0.9, '#2a2c30', F, 6);
  for (let z = -9; z <= 9; z += 3) D.box('std', -6, 52.4, z, 20, 0.6, 1.2, '#2a2c30', null, F);
  D.box('std', -6, 52.9, 0, 20, 0.5, 20, '#2a2c30', null, F);
  D.add('std', T.torus(12, 0.4, 4), [6, 30, 0], [4, 4, 1], [1.1, 0, 0], '#1a1a1c', RUB);
  D.cyl('std', 6, 20, 0, 0.6, 12, '#2a2c30', 6, 1, [0, 0, -0.6], F);
  for (const z of [-7, 7]) rod(D, 'std', [15, 4, z], [15, 44 * s, z], 1.2, '#4a4e52', F, 6);
  D.box('std', 15.6, 20, 0, 1.6, 4, 18, '#4a4e52', null, F);
  const fy = r.range(3, 14);
  D.box('std', 16.5, fy + 10, 0, 1.2, 22, 22, '#3a3e42', null, F);
  for (const z of [-6, 6]) D.box('std', 26, fy + 1, z, 22, 1.6, 3.2, '#2a2c30', null, F);
  for (const [x, z, R] of [[8, -10, 6], [8, 10, 6], [-18, -9, 5], [-18, 9, 5]]) {
    D.add('std', T.lathe('tyre', TYRE, 14), [x, R, z], [R, 6, R], [Math.PI / 2, 0, 0], '#161616', { ...RUB, map: 'cyl' });
    D.add('std', T.cyl(10), [x, R, z + (z > 0 ? 3.2 : -3.2)], [R * 0.55, 0.6, R * 0.55], [Math.PI / 2, 0, 0], '#8a8e92', PANEL);
  }
  D.box('blink', -26.6, 27, 0, 0.8, 3, 3, '#ff9a1a', null, { emissive: 3 });
  D.box('std', -26.6, 15, 0, 0.6, 3, 8, '#e8e8e0', null, S(DET.plastic, 0.4, 0));
  if (r.chance(0.5)) palletAt(D, 27, fy + 2.6, 0, 0, false);
}

function hay(P) {
  const { D, s } = P;
  const r = D.rng;
  const wrapped = r.chance(0.3);
  const col = wrapped ? r.pick(['#e8ecec', '#e8ecec', '#5a7a4a']) : r.pick(['#b09a50', '#a89040', '#c0aa60']);
  const R = 17 * s, Ln = 22 * s;
  const F = wrapped ? S(DET.plastic, 0.25, 0) : S(DET.wood, 0.95, 0);
  const upright = r.chance(0.25);
  if (upright) {
    D.cyl('std', 0, 0, 0, R, Ln, col, 14, 1, null, F);
    D.add('std', T.cyl(14, 0.9), [0, Ln + 0.2, 0], [R * 0.95, 0.6, R * 0.95], null, shadeHex(col, 0.1), F);
  } else {
    D.add('std', T.cyl(14), [0, R, 0], [R, Ln, R], [0, 0, Math.PI / 2], col, { ...F, map: 'cyl' });
    for (const d of [-Ln * 0.3, Ln * 0.3]) D.add('std', T.torus(14, 0.14, 4), [d, R, 0], [R + 0.2, R + 0.2, 1], [0, Math.PI / 2, 0], wrapped ? '#c8d0d0' : '#4a4a3a', F);
    for (const sx of [-1, 1]) D.add('std', T.cyl(14, 0.96), [sx * (Ln / 2 + 0.1), R, 0], [R * 0.97, 0.5, R * 0.97], [0, 0, Math.PI / 2], shadeHex(col, sx * 0.08), F);
  }
  if (r.chance(0.5)) for (let i = 0; i < 6; i++) D.add('std', T.box(), [r.range(-R * 1.3, R * 1.3), 0.4, r.range(-R * 1.3, R * 1.3)], [r.range(3, 7), 0.4, 0.5], [0, r.range(0, 6), 0], '#c8b060', S(0, 0.95, 0));
}
function haySq(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#b09a50', '#a89040', '#c0aa60']);
  const rot = r.range(0, 6);
  const n = 1 + Math.floor(r.next() * 3);
  for (let i = 0; i < n; i++) {
    const x = (i % 2) * 2 - 1, y = i > 1 ? 12 : 0;
    D.add('std', T.rbox(24, 12, 13, 1.2), [x * 6, y + 6, 0], [1, 1, 1], [0, rot + r.range(-0.1, 0.1), 0], shadeHex(col, r.range(-0.1, 0.06)), S(DET.wood, 0.95, 0));
    for (const t of [-7, 7]) D.add('std', T.box(), [x * 6 + t * Math.cos(rot), y + 6, -t * Math.sin(rot)], [0.5, 12.4, 13.4], [0, rot, 0], '#5a4a30', S(0, 0.9, 0));
  }
}

function tractor(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#2f6a3a', '#a02a1c', '#2a5ac4', '#c8781c']);
  const F = PANEL;
  // engine, hood, grille, chassis, cab frame
  D.rbox('std', 14, 22, 0, 34, 16, 20, 2.4, col, null, F);
  D.rbox('std', 4, 24, 0, 16, 8, 21, 1.4, shadeHex(col, -0.15), null, F);
  D.box('std', 31.4, 22, 0, 0.8, 12, 14, '#1a1c1e', null, S(DET.corrugated, 0.5, 0.7));
  D.rbox('std', -8, 27, 0, 24, 6, 22, 1.4, '#2a2c30', null, F);
  D.cyl('std', 20, 30, 6, 1.4, 22, '#2a2a2a', 8, 1, null, RUST);
  D.cyl('std', 20, 52, 6, 2, 2, '#2a2a2a', 8, 1.3, null, RUST);
  for (const [x, z] of [[-18, -9], [-18, 9], [4, -9], [4, 9]]) rod(D, 'std', [x, 31, z], [x, 62, z], 1, '#2a2c30', F, 6);
  D.rbox('std', -7, 63, 0, 30, 2.4, 22, 1, col, null, F);
  for (const z of [-9, 9]) D.box('glass', -7, 46, z * 1.0, 22, 24, 0.5, '#1a242e', null);
  D.box('glass', -19, 46, 0, 0.5, 24, 18, '#1a242e', null);
  D.rbox('std', -8, 36, 0, 7, 3, 8, 1, '#1a1a1c', null, S(DET.fabric, 0.9, 0));
  D.rbox('std', -11, 41, 0, 2, 9, 8, 0.8, '#1a1a1c', [0, 0, 0.12], S(DET.fabric, 0.9, 0));
  // wheels: big rear, small front
  for (const z of [-15, 15]) {
    D.add('std', T.lathe('tyre', TYRE, 18), [-10, 15, z], [15, 9, 15], [Math.PI / 2, 0, 0], '#171717', { ...RUB, map: 'cyl' });
    D.add('std', T.cyl(14), [-10, 15, z + (z > 0 ? 4.6 : -4.6)], [9, 0.8, 9], [Math.PI / 2, 0, 0], shadeHex(col, -0.1), F);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 6.283;
      D.box('std', -10 + Math.cos(a) * 15, 15 + Math.sin(a) * 15, z, 2, 2.4, 8, '#171717', [0, 0, a], RUB);   // lugs
    }
    D.add('std', T.lathe('tyre', TYRE, 14), [26, 8.6, z * 0.62], [8.6, 5, 8.6], [Math.PI / 2, 0, 0], '#171717', { ...RUB, map: 'cyl' });
    D.add('std', T.cyl(10), [26, 8.6, z * 0.62 + (z > 0 ? 2.6 : -2.6)], [4.6, 0.6, 4.6], [Math.PI / 2, 0, 0], shadeHex(col, -0.1), F);
  }
  for (const z of [-12, 12]) D.box('glow', 32, 26, z, 0.8, 3.4, 3.4, '#fff2c8', null, { emissive: 0.4, uv: atlasUV('white') });
  rod(D, 'std', [-24, 12, 0], [-30, 10, 0], 1.2, '#3a3e42', RUST, 6);
  D.box('std', -31, 10, 0, 2, 3, 10, '#3a3e42', null, RUST);
  if (r.chance(0.5)) D.box('paint', 0, 24, 0, 0.001, 0.001, 0.001, col);
}

function watertower(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#c8ccc8', '#8fa0b0', '#a07a5a']);
  const F = S(DET.rust, 0.6, 0.7);
  const legs = 6, R0 = 44, R1 = 34, H = 240;
  for (let k = 0; k < legs; k++) {
    const a = (k / legs) * 6.283;
    rod(D, 'std', [Math.cos(a) * R0, 0, Math.sin(a) * R0], [Math.cos(a) * R1, H, Math.sin(a) * R1], 2.2, '#5a5e62', F, 6);
    D.rblock('std', Math.cos(a) * R0, 0, Math.sin(a) * R0, 10, 6, 10, 1, '#7a776e', null, S(DET.concrete, 0.9, 0));
    const b = ((k + 1) / legs) * 6.283;
    for (const t of [0.3, 0.62]) {
      const rr = R0 + (R1 - R0) * t, y = H * t;
      rod(D, 'std', [Math.cos(a) * rr, y, Math.sin(a) * rr], [Math.cos(b) * (R0 + (R1 - R0) * (t + 0.32)), H * (t + 0.32), Math.sin(b) * (R0 + (R1 - R0) * (t + 0.32))], 0.7, '#4a4e52', F, 5);
      rod(D, 'std', [Math.cos(b) * rr, y, Math.sin(b) * rr], [Math.cos(a) * (R0 + (R1 - R0) * (t + 0.32)), H * (t + 0.32), Math.sin(a) * (R0 + (R1 - R0) * (t + 0.32))], 0.7, '#4a4e52', F, 5);
    }
  }
  D.add('std', T.sphere(16, 5), [0, H, 0], [40, 14, 40], null, col, S(DET.corrugated, 0.6, 0.4));
  D.cyl('std', 0, H + 4, 0, 40, 42, col, 20, 1, null, S(DET.corrugated, 0.6, 0.4));
  D.cyl('std', 0, H + 46, 0, 40.5, 3, shadeHex(col, -0.3), 20, 1, null, F);
  D.cyl('std', 0, H + 48, 0, 40, 16, shadeHex(col, -0.05), 20, 0.05, null, S(DET.corrugated, 0.6, 0.4));
  D.add('std', T.torus(20, 0.6, 4), [0, H + 6, 0], [41, 41, 1], [Math.PI / 2, 0, 0], '#4a4e52', F);
  D.cyl('std', 0, H + 64, 0, 1.2, 12, '#8a8e92', 6, 1, null, F);
  D.box('blink', 0, H + 77, 0, 3, 3, 3, '#ff2a1a', null, { emissive: 3.2 });
  rod(D, 'std', [40, H + 4, 0], [40, 0, 0], 0.5, '#8a8e92', F, 4);
  // spray-painted town name on the tank would need the atlas; a dark band does the job
  D.cyl('std', 0, H + 24, 0, 40.4, 10, '#2a2f34', 20, 1, null, S(DET.panel, 0.6, 0.2));
}

function reel(P) {
  const { D } = P;
  const r = D.rng;
  const F = WOODS;
  const lay = r.chance(0.5);
  const A = lay ? [Math.PI / 2, r.range(0, 6), 0] : [0, r.range(0, 6), 0];
  const y = lay ? 14 : 0;
  void y;
  if (lay) {
    for (const z of [-7, 7]) D.add('std', T.cyl(14), [0, 14, z], [14, 1.6, 14], [Math.PI / 2, 0, 0], '#7a5a34', { ...F, map: 'cyl' });
    D.add('std', T.cyl(12), [0, 14, 0], [10.5, 13, 10.5], [Math.PI / 2, 0, 0], '#161616', { surf: [DET.rubber, 0.7, 0], map: 'cyl' });
  } else {
    D.cyl('std', 0, 0, 0, 14, 1.6, '#7a5a34', 14, 1, null, F);
    D.cyl('std', 0, 1.6, 0, 10.5, 12, '#161616', 12, 1, null, S(DET.rubber, 0.7, 0));
    D.cyl('std', 0, 13.6, 0, 14, 1.6, '#7a5a34', 14, 1, null, F);
  }
  void A;
}

function woodpile(P) {
  const { D } = P;
  const r = D.rng;
  const rows = [8, 7, 6, 4];
  rows.forEach((n, ri) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 4.6;
      D.add('std', T.cyl(6), [0, 2.3 + ri * 4, x], [2.3, 24 + r.range(-2, 2), 2.3], [0, r.range(-0.05, 0.05), Math.PI / 2], r.pick(['#6b4a2c', '#7a5a34', '#5a3f26', '#8a6a44']), { surf: [DET.bark, 0.9, 0], map: 'cyl' });
    }
  });
  for (const x of [-20, 20]) for (const z of [-14, 14]) rod(D, 'std', [x * 0.6, 0, z * 1.2 * 0 + (z > 0 ? 17 : -17)], [x * 0.6, 20, z > 0 ? 17 : -17], 0.9, '#4a3a22', WOODS, 5);
}

function wheelbarrow(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#2f6a3a', '#c8281e', '#2a5ac4', '#5a5e62']);
  const F = PANEL;
  D.add('std', T.profile('barrow', [[-11, 6], [11, 11], [11, 18], [-11, 20]], 0.8, 16), [0, 0, 0], [1, 1, 1], null, col, F);
  D.add('std', T.lathe('tyre', TYRE, 12), [14, 4.4, 0], [4.4, 2.6, 4.4], [Math.PI / 2, 0, 0], '#171717', { ...RUB, map: 'cyl' });
  for (const z of [-5, 5]) {
    rod(D, 'std', [12, 6, z], [-26, 18, z * 1.3], 0.8, '#6b4a2c', WOODS, 5);
    rod(D, 'std', [-8, 14, z], [-8, 0, z * 1.4], 0.7, '#4a4e52', F, 5);
  }
  if (r.chance(0.4)) D.add('std', T.dodeca(), [0, 20, 0], [8, 3, 6], [0, 0.4, 0], '#3a2a1c', S(DET.dirt, 0.95, 0));
}

function gascyl(P) {
  const { D } = P;
  const col = D.rng.pick(['#c8ccc8', '#2a5ac4', '#c8281e', '#2f8a4a']);
  const lay = D.rng.chance(0.2);
  const F = S(DET.panel, 0.35, 0.6);
  const A = lay ? [0, D.rng.range(0, 6), Math.PI / 2] : null;
  if (!lay) {
    D.cyl('std', 0, 0, 0, 5, 16, col, 12, 1, null, F);
    D.add('std', T.sphere(12, 5), [0, 16, 0], [5, 3.4, 5], null, col, F);
    D.cyl('std', 0, 19, 0, 1.2, 2, '#c9ced3', 8, 1, null, S(0, 0.3, 0.9));
    D.add('std', T.torus(10, 0.3, 4), [0, 20.6, 0], [2.6, 2.6, 1], [Math.PI / 2, 0, 0], '#3a3e42', F);
    D.cyl('std', 0, 0, 0, 5.4, 1.2, '#2a2c30', 12, 1, null, F);
  } else {
    D.add('std', T.cyl(12), [0, 5, 0], [5, 16, 5], A, col, { ...F, map: 'cyl' });
    D.add('std', T.sphere(12, 5), [Math.cos(A[1]) * 8, 5, -Math.sin(A[1]) * 8], [3.4, 5, 5], [0, A[1], 0], col, F);
  }
}

function ibc(P) {
  const { D } = P;
  const F = S(DET.rust, 0.5, 0.8);
  palletAt(D, 0, 0, 0, 0, false);
  D.rbox('std', 0, 19, 0, 28, 30, 24, 2.4, '#dfe6ea', null, S(DET.plastic, 0.2, 0));
  D.add('glass', T.box(), [0, 19, 0], [27, 29, 23], null, '#a8b8c0');
  for (let y = 6; y <= 32; y += 6.5) {
    D.box('std', 0, y + 4, 12.2, 29, 0.7, 0.7, '#9aa0a4', null, F);
    D.box('std', 0, y + 4, -12.2, 29, 0.7, 0.7, '#9aa0a4', null, F);
    D.box('std', 14.4, y + 4, 0, 0.7, 0.7, 25, '#9aa0a4', null, F);
    D.box('std', -14.4, y + 4, 0, 0.7, 0.7, 25, '#9aa0a4', null, F);
  }
  for (const x of [-14, -7, 0, 7, 14]) { D.box('std', x, 19, 12.2, 0.7, 31, 0.7, '#9aa0a4', null, F); D.box('std', x, 19, -12.2, 0.7, 31, 0.7, '#9aa0a4', null, F); }
  D.cyl('std', 0, 34.4, 0, 3, 1.4, '#2a2c30', 10, 1, null, S(DET.plastic, 0.5, 0));
  D.cyl('std', 14.4, 9, 6, 1.6, 4, '#c8281e', 8, 1, [0, 0, Math.PI / 2], S(DET.plastic, 0.4, 0));
}

function trough(P) {
  const { D } = P;
  const F = S(DET.rust, 0.6, 0.7);
  D.rbox('std', 0, 8, 0, 44, 10, 12, 1.4, '#7a7e82', null, F);
  D.box('glass', 0, 12.6, 0, 40, 0.4, 8, '#0c1a20', null);
  for (const x of [-16, 16]) D.box('std', x, 3, 0, 4, 6, 10, '#5a5e62', null, F);
  D.box('std', 0, 13.2, 0, 44.4, 0.8, 12.4, '#6a6e72', null, F);
  if (D.rng.chance(0.5)) D.add('glass', T.cyl(10), [0, 12.8, 0], [12, 0.3, 4], [0, D.rng.range(0, 3), 0], '#1a2a30');
}

void MUTED; void BRIGHT; void pick;

export const INDUSTRIAL = {
  pallet, pallets: palletsLoaded, crate, crates, drum, drums, pipes, generator, forklift, hay, hay_sq: haySq, tractor, watertower,
  reel, woodpile, wheelbarrow, gascyl, ibc, trough,
};
