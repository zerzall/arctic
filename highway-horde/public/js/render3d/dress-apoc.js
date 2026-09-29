// Set dressing, part 6 (WORLD): signs of the apocalypse — improvised barricades, plywood
// sheets and doors boarded up with spray-painted messages ("GOD HELP US", "TURN BACK"),
// graffiti and search marks on walls, missing-person posters, body bags, abandoned
// military gear, sandbag arcs, tarps on ropes, field-hospital tents, police tape and
// quarantine banners, roadside memorials, crosses and sawhorse roadblocks.

import { T, S, DET, atlasUV, dressUV, rod, plank, pic, facing, BRIGHT, MUTED, clothGeo } from './dress-kit.js';
import { shadeHex } from './world-geo.js';

const WOODS = S(DET.wood, 0.88, 0);
const CLOTH = S(DET.fabric, 0.92, 0);
const PLASTIC = S(DET.plastic, 0.3, 0);
const OLIVE = ['#4b5320', '#556b2f', '#4a4f35', '#5a5a3c'];
const PLY = ['p_god', 'p_turn', 'p_stay', 'p_dead', 'p_end', 'p_none', 'p_safe', 'p_loot', 'p_run', 'p_help', 'p_theyre', 'p_nofood'];
const GRAF = ['w_god', 'w_turn', 'w_out', 'w_dead', 'w_run', 'w_over'];

function barricade(P) {
  const { D, it } = P;
  const r = D.rng;
  const wood = () => r.pick(['#5a4632', '#6b5a44', '#4a3a2a', '#7a6a4e']);
  // two crossed beams as the frame, planks nailed across, coils of wire, a message board
  for (const z of [-22, 22]) {
    rod(D, 'std', [0, 0, z - 6], [0, 40, z + 6], 1.9, wood(), WOODS, 6);
    rod(D, 'std', [0, 0, z + 6], [0, 40, z - 6], 1.9, wood(), WOODS, 6);
  }
  const n = 5;
  for (let i = 0; i < n; i++) {
    const y = 8 + i * 7 + r.range(-1, 1);
    plank(D, 'std', [1.2, y + r.range(-2, 2), -30], [1.2, y + r.range(-2, 2), 30], 5, 1.4, wood(), WOODS);
  }
  plank(D, 'std', [2.4, 6, -24], [2.4, 42, 26], 4, 1.2, wood(), WOODS);
  for (let k = 0; k < 4; k++) D.add('std', T.torus(10, 0.2, 4), [-1.5, 44 + k * 0.4, -22 + k * 14], [3.6, 3.6, 1], [0.3, Math.PI / 2, r.range(0, 3)], '#6a6e72', S(DET.rust, 0.5, 0.8));
  rod(D, 'std', [-1.4, 43, -34], [-1.4, 43, 34], 0.3, '#6a6e72', S(DET.rust, 0.5, 0.8), 4);
  const cell = PLY[it.v % PLY.length];
  D.add('std', T.box(), [3.4, 24, 4], [0.8, 17, 30], [0.03, 0, 0.03], '#cdc6b0', WOODS);
  D.add('sign', T.plane(), [3.9, 24, 4], [30, 11.2, 1], [0.03, Math.PI / 2, 0.03], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
  // sandbag feet
  for (const z of [-30, 30]) D.add('std', T.pillow(7, 4, 0.5), [-3, 3, z], [5, 3, 7], [0, r.range(0, 3), 0], '#8a7a55', S(DET.fabric, 0.95, 0));
}

function plywood(P) {
  const { D, it } = P;
  const r = D.rng;
  const cell = PLY[it.v % PLY.length];
  const lean = r.range(0.12, 0.3);
  const H = 40, W = 28;
  // the sheet leans back against whatever is behind it (-x); the message faces +x
  const cx = -(H / 2) * Math.sin(lean), cy = (H / 2) * Math.cos(lean);
  D.add('std', T.box(), [cx, cy, 0], [0.9, H, W], [0, 0, lean], r.pick(['#b09a70', '#a08a60', '#8a7a58']), WOODS);
  facing(D, 'sign', cell, [cx + 0.55 * Math.cos(lean), cy + 0.55 * Math.sin(lean), 0], W - 0.6, (W - 0.6) * 96 / 256, [Math.cos(lean), Math.sin(lean), 0]);
  for (const y of [8, 32]) D.box('std', cx + (y - cy) * -Math.sin(lean) + 0.4, y, 0, 0.5, 2.4, W + 1, '#6b5a44', [0, 0, lean], WOODS);
  if (r.chance(0.5)) D.box('std', -H * Math.sin(lean) - 4, 3, 0, 1.6, 6, 1.6, '#5a4632', [0, 0, 0.5], WOODS);
}

function boardDoor(P) {
  const { D } = P;
  const r = D.rng;
  const col = () => r.pick(['#5a4632', '#6b5a44', '#4a3a2a', '#7a6a4e']);
  const ys = [6, 15, 24, 33];
  ys.forEach((y, i) => {
    if (r.chance(0.12)) return;
    D.add('std', T.box(), [1.6 + (i % 2) * 0.35, y + r.range(-0.5, 0.5), 0], [1.3, 4.6, 24 + r.range(0, 4)], [r.range(-0.03, 0.03), 0, r.range(-0.05, 0.05)], col(), WOODS);
  });
  plank(D, 'std', [2.6, 4, -10], [2.6, 36, 10], 4.2, 1.1, col(), WOODS);
  if (r.chance(0.6)) D.add('sign', T.plane(), [3.4, 22, r.range(-4, 4)], [17, 6.4, 1], [0, Math.PI / 2, r.range(-0.06, 0.06)], '#ffffff', { uv: dressUV(r.pick(['w_dead', 'w_out', 'w_turn', 'w_god'])), noAO: true, noJitter: true });
}

function graf(P) {
  const { D, it } = P;
  const r = D.rng;
  const t = it.v % 12;
  if (t < 6) pic(D, GRAF[t % GRAF.length], 0.35, r.range(20, 34), 0, 44, 16.5, { bucket: 'sign' });
  else if (t < 8) pic(D, 'x' + (t - 6), 0.35, r.range(22, 34), 0, 19, 19, { bucket: 'sign' });
  else if (t < 10) pic(D, 'skull', 0.35, r.range(22, 34), 0, 18, 18, { bucket: 'sign' });
  else pic(D, GRAF[(t + 2) % GRAF.length], 0.35, r.range(18, 30), 0, 40, 15, { bucket: 'sign', rz: r.range(-0.08, 0.08) });
}

function poster(P) {
  const { D, it } = P;
  const r = D.rng;
  const y = r.range(50, 100);
  const cell = 'miss' + (it.v % 6);
  D.add('sign', T.plane(), [3.4, y, 0], [8.4, 12.6, 1], [0, Math.PI / 2, r.range(-0.08, 0.08)], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
  D.add('std', T.box(), [3.1, y, 0], [0.4, 12.9, 8.7], null, '#cfc9b4', S(0, 0.9, 0));
  if (r.chance(0.5)) D.add('sign', T.plane(), [3.42, y - 14, r.range(-1, 1)], [7, 5, 1], [0, Math.PI / 2, r.range(-0.2, 0.2)], '#ffffff', { uv: dressUV('news' + (it.v % 6)), noAO: true, noJitter: true });
}

function wposter(P) {
  const { D, it } = P;
  const r = D.rng;
  const y = r.range(26, 50);
  D.add('sign', T.plane(), [0.2, y, 0], [9, 13.5, 1], [0, Math.PI / 2, r.range(-0.1, 0.1)], '#ffffff', { uv: dressUV('miss' + (it.v % 6)), noAO: true, noJitter: true });
  if (r.chance(0.5)) D.add('sign', T.plane(), [0.25, y + r.range(-6, 6), r.range(6, 10)], [8, 12, 1], [0, Math.PI / 2, r.range(-0.2, 0.2)], '#ffffff', { uv: dressUV('miss' + ((it.v + 3) % 6)), noAO: true, noJitter: true });
  if (r.chance(0.4)) D.add('sign', T.plane(), [0.3, y - 14, r.range(-6, -2)], [10, 7.5, 1], [0, Math.PI / 2, r.range(-0.2, 0.2)], '#ffffff', { uv: dressUV('news' + (it.v % 6)), noAO: true, noJitter: true });
}

function bodybag(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#151618', '#151618', '#2a2f22', '#d8d8d0']);
  const F = S(DET.plastic, 0.3, 0);
  D.add('std', T.pillow(12, 6, 0.45), [0, 2.4, 0], [15, 2.6, 5.4], [0, 0, 0], col, { ...F, wobble: { amp: 0.06, seed: 1 } });         // torso + legs
  D.add('std', T.pillow(10, 5, 0.5), [-14.5, 2.6, 0], [4, 2.4, 3.6], null, col, F);                                             // head
  D.add('std', T.pillow(10, 5, 0.5), [15, 1.6, 0], [4.4, 1.5, 3.4], null, col, F);                                              // feet
  D.box('std', 0, 5.0, 0, 30, 0.2, 0.5, shadeHex(col, 0.35), null, S(0, 0.5, 0.6));
  D.box('std', 6, 4.9, 1.2, 3, 0.3, 1.8, '#e8e0c8', [0, 0.4, 0], S(0, 0.9, 0));
  if (r.chance(0.4)) D.add('flat', T.plane(), [r.range(-6, 6), 0.3, r.range(4, 8)], [8, 6, 1], [-Math.PI / 2, 0, r.range(0, 6)], '#3a0a08', { uv: dressUV('f_blood'), noAO: true, noJitter: true });
}

function helmet(P) {
  const { D } = P;
  const col = D.rng.pick(OLIVE);
  D.add('std', T.sphere(12, 5), [0, 2.6, 0], [4.8, 3.8, 4.8], [0, D.rng.range(0, 6), 0], col, S(DET.panel, 0.7, 0.2));
  D.cyl('std', 0, 0.2, 0, 5.6, 0.7, shadeHex(col, -0.15), 12, 1, null, S(DET.panel, 0.7, 0.2));
  D.add('std', T.box(), [0, 3.5, 0], [8, 0.4, 0.6], [0, 0, 0], '#2a2a26', S(DET.fabric, 0.9, 0));
  D.add('std', T.torus(10, 0.2, 4), [0, 0.6, 3.5], [1.8, 2.4, 1], [0.6, 0, 0], '#2a2a26', S(DET.fabric, 0.9, 0));
}

function milcrate(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(OLIVE);
  const F = S(DET.panel, 0.55, 0.4);
  D.add('std', T.rbox(24 * s, 12, 12, 0.9), [0, 6, 0], [1, 1, 1], null, col, F);
  D.add('std', T.rbox(24.6 * s, 2.4, 12.6, 0.6), [0, 12.4, 0], [1, 1, 1], null, shadeHex(col, -0.1), F);
  for (const x of [-8, 8]) D.box('std', x, 8, 6.4, 3, 2.6, 0.7, '#6a6e72', null, S(0, 0.4, 0.8));
  D.add('sign', T.plane(), [0, 6.5, 6.25], [11, 5.5, 1], null, '#ffffff', { uv: dressUV(r.pick(['st_ammo', 'st_mre', 'st_med', 'st_water'])), noAO: true, noJitter: true });
  D.add('std', T.torus(8, 0.2, 4), [12.2, 8, 0], [2.4, 1.6, 1], [0, Math.PI / 2, 0], '#161616', S(DET.fabric, 0.9, 0));
  if (r.chance(0.4)) D.add('std', T.rbox(18, 9, 10, 0.8), [3, 12 + 4.5, 0], [1, 1, 1], [0, r.range(-0.3, 0.3), 0], shadeHex(col, 0.05), F);
}

function milBox(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(OLIVE);
  const F = S(DET.panel, 0.5, 0.5);
  const n = 1 + Math.floor(r.next() * 2);
  for (let i = 0; i < n; i++) {
    const y = i * 8;
    D.add('std', T.rbox(12, 8, 7, 0.7), [i * 1.5, y + 4, 0], [1, 1, 1], [0, r.range(-0.2, 0.2) + 0.2, 0], col, F);
    D.box('std', i * 1.5, y + 8.3, 0, 8, 0.8, 1, '#1a1c14', null, F);
    D.box('std', i * 1.5 + 6.05, y + 4.4, 0, 0.3, 2, 6, '#d8b43a', [0, 0.2, 0], S(0, 0.6, 0));
  }
}

function sandArc(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#8a7a55', '#7a6c4c', '#96866a']);
  const F = S(DET.fabric, 0.95, 0);
  const rad = 24;
  const n = 8;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n - row; i++) {
      const a = -1.05 + ((i + row * 0.5) / (n - 1)) * 2.1;
      D.add('std', T.pillow(7, 4, 0.5), [Math.cos(a) * rad, 3.4 + row * 5.6, Math.sin(a) * rad], [3.2, 2.9, 6.2], [0, -a, 0], shadeHex(col, r.range(-0.1, 0.06)), { ...F, wobble: { amp: 0.06, seed: i } });
    }
  }
  D.add('std', T.pillow(7, 4, 0.5), [Math.cos(0.1) * rad, 14, Math.sin(0.1) * rad], [3.2, 2.9, 6.2], [0, -0.1, 0], col, F);
}

function tarp(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#2a5ac4', '#3a6a4a', '#c8781c', '#5a6a70', '#2a8aa0']);
  const W = 42;
  for (const z of [-W / 2, W / 2]) {
    rod(D, 'std', [0, 0, z], [0, 52, z], 0.9, '#6b4a2c', WOODS, 6);
    rod(D, 'std', [0, 52, z], [z > 0 ? -6 : -6, 30, z * 1.5], 0.25, '#e0d8c0', null, 4);
  }
  rod(D, 'std', [0, 50, -W / 2], [0, 50, W / 2], 0.35, '#e0d8c0', null, 4);
  const H = r.range(22, 32);
  D.add('cloth', clothGeo(4, 6), [0, 50 - H / 2, 0], [H, W - 2, 1], [0, Math.PI / 2, -Math.PI / 2], col, { noAO: true });
  for (let k = 0; k < 4; k++) D.box('std', 0.2, 50, -W / 2 + 3 + k * 12, 0.5, 1, 1, '#c9ced3', null, S(0, 0.3, 0.9));
  if (r.chance(0.5)) D.add('std', T.pillow(10, 5, 0.5), [-6, 3, r.range(-8, 8)], [10, 3, 5], [0, r.range(0, 6), 0], r.pick(MUTED), CLOTH);
}

function medTent(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#e2ddc8', '#dcd8c4']);
  const F = S(DET.fabric, 0.9, 0);
  const L = 58, Wd = 40, wall = 14, ridge = 34;
  // walls, pitched roof (prism), the cross on both long sides, an open front with cots inside
  for (const z of [-Wd / 2, Wd / 2]) D.box('std', 0, wall / 2, z, L, wall, 0.8, col, null, F);
  D.box('std', -L / 2, wall / 2, 0, 0.8, wall, Wd, col, null, F);
  D.add('std', T.profile('medroof', [[-Wd / 2 - 3, 0], [Wd / 2 + 3, 0], [0, ridge - wall]], 0.8, L + 6), [0, wall, 0], [1, 1, 1], [0, Math.PI / 2, 0], shadeHex(col, 0.04), F);
  D.box('std', 0, wall + 0.4, 0, L + 6, 1, 1, shadeHex(col, -0.2), null, F);
  for (const z of [-Wd / 2 - 0.5, Wd / 2 + 0.5]) D.add('sign', T.plane(), [4, wall + 8, z], [12, 12, 1], [0, z > 0 ? 0 : Math.PI, 0], '#ffffff', { uv: dressUV('redcross'), noAO: true, noJitter: true });
  D.add('sign', T.plane(), [L / 2 + 0.3, wall + 4, 0], [26, 9.75, 1], [0, Math.PI / 2, 0], '#ffffff', { uv: dressUV('cross_banner'), noAO: true, noJitter: true });
  D.box('std', L / 2 - 1, 0.2, 0, 1, 0.4, Wd, shadeHex(col, -0.3), null, F);
  for (const z of [-10, 10]) {
    D.rbox('std', -4, 7, z, 30, 2.4, 11, 0.6, '#5a6a4a', null, F);
    for (const x of [-16, 8]) for (const zz of [z - 4, z + 4]) rod(D, 'std', [x, 6, zz], [x, 0, zz], 0.4, '#8a8e92', S(0, 0.4, 0.8), 4);
    D.add('std', T.pillow(8, 4, 0.5), [-16, 8.6, z], [4.4, 1.4, 4], null, '#d8d4c8', F);
  }
  for (let k = 0; k < 6; k++) rod(D, 'std', [L / 2 * (k % 2 ? 1 : -1) * 1.15, 0, Wd / 2 * (k < 3 ? 1.3 : -1.3)], [L / 2 * (k % 2 ? 0.9 : -0.9), wall + 3, Wd / 2 * (k < 3 ? 1 : -1)], 0.2, '#e0d8b8', null, 4);
  if (r.chance(0.6)) D.add('std', T.rbox(12, 8, 8, 0.6), [-L / 2 - 8, 4, r.range(-8, 8)], [1, 1, 1], [0, r.range(0, 6), 0], '#dcd8cc', S(DET.panel, 0.5, 0.4));
}

function tape(P) {
  const { D, it } = P;
  const len = it.w || 60;
  const col = '#f0c820';
  for (const x of [0, len]) {
    rod(D, 'std', [x, 0, 0], [x, 34, 0], 0.7, '#5a4632', WOODS, 5);
    D.add('std', T.sphere(5, 3), [x, 34.6, 0], [1, 0.8, 1], null, '#5a4632', WOODS);
  }
  for (const y of [30, 24]) D.add('cloth', clothGeo(8, 1), [len / 2, y, 0], [len, 2.6, 1], [0, 0, 0], y === 30 ? col : shadeHex(col, -0.1), { noAO: true });
}

function banner(P) {
  const { D, it } = P;
  const len = it.w || 200;
  const r = D.rng;
  for (const x of [-2, len + 2]) {
    rod(D, 'std', [x, 0, 0], [x, 118, 0], 1.6, '#6a6e72', S(DET.rust, 0.5, 0.8), 6);
    D.rblock('std', x, 0, 0, 8, 3, 8, 0.6, '#7a776e', null, S(DET.concrete, 0.9, 0));
  }
  const w = Math.min(len - 6, 240), h = w * 96 / 512;
  const sag = r.range(-0.02, 0.04);
  D.add('sign', T.plane(), [len / 2, 100, -0.4], [w, h, 1], [0, 0, sag], '#ffffff', { uv: dressUV('quar'), noAO: true, noJitter: true });
  D.add('sign', T.plane(), [len / 2, 100, 0.4], [w, h, 1], [0, Math.PI, sag], '#ffffff', { uv: dressUV('quar'), noAO: true, noJitter: true });
  rod(D, 'std', [0, 110, 0], [len / 2 - w / 2, 100 + h / 2, 0], 0.3, '#3a3e42', null, 4);
  rod(D, 'std', [len, 110, 0], [len / 2 + w / 2, 100 + h / 2, 0], 0.3, '#3a3e42', null, 4);
  rod(D, 'std', [0, 90, 0], [len / 2 - w / 2, 100 - h / 2, 0], 0.3, '#3a3e42', null, 4);
  rod(D, 'std', [len, 90, 0], [len / 2 + w / 2, 100 - h / 2, 0], 0.3, '#3a3e42', null, 4);
}

function shrine(P) {
  const { D } = P;
  const r = D.rng;
  D.rbox('std', 0, 1, 0, 26, 2, 20, 0.5, '#6a665c', null, S(DET.concrete, 0.9, 0));
  D.add('std', T.pillow(8, 5, 0.5), [0, 2.4, 0], [10, 2, 8], [0, r.range(0, 6), 0], '#3a2c22', S(DET.dirt, 0.95, 0));
  for (let i = 0; i < 16; i++) {
    const c = r.pick(['#d8281e', '#f2d020', '#f4f4ec', '#e870a8', '#8a4ab8', '#e0641c']);
    D.add('std', T.ico(0), [r.range(-10, 10), 2.8 + r.range(0, 1.4), r.range(-8, 8)], [1.5, 1.1, 1.5], null, c, S(0, 0.8, 0));
    if (i % 3 === 0) rod(D, 'std', [0, 2, 0], [0, 2, 0], 0.01, c);
  }
  for (let i = 0; i < 5; i++) {
    const x = r.range(-9, 9), z = r.range(-7, 7), h = r.range(3, 7);
    D.cyl('std', x, 2, z, 1.2, h, r.pick(['#f4f0e0', '#f4f0e0', '#c8281e']), 8, 1, null, S(DET.plastic, 0.5, 0));
    D.add('glow', T.sphere(5, 3), [x, 2 + h + 0.9, z], [0.5, 1, 0.5], null, '#ffb04a', { emissive: 3, uv: atlasUV('white') });
  }
  D.rbox('std', 3, 12, 0, 1, 13, 10, 0.4, '#8a6a44', [0, 0, -0.1], WOODS);
  D.add('sign', T.plane(), [3.6, 12, 0], [8, 11, 1], [0, Math.PI / 2, -0.1], '#ffffff', { uv: dressUV('miss' + (D.rng.next() * 6 | 0)), noAO: true, noJitter: true });
  if (r.chance(0.6)) D.add('std', T.ico(1), [-6, 5, -4], [2, 2.4, 1.7], [0, 0.4, 0.5], r.pick(['#8a5a34', '#c8a070']), S(DET.fabric, 0.95, 0));
}

function cross(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#e8e4d8', '#e8e4d8', '#6b4a2c']);
  const lean = r.range(-0.1, 0.1);
  D.box('std', 0, 22, 0, 2.2, 44, 2.2, col, [lean, 0, 0], WOODS);
  D.box('std', 0, 34, 0, 2.2, 2.2, 18, col, [lean, 0, 0], WOODS);
  D.add('std', T.torus(12, 0.6, 4), [1.4, 34, 0], [5, 5, 1], [0, Math.PI / 2, 0], '#3a5a2a', S(DET.grass, 0.9, 0));
  for (let i = 0; i < 6; i++) D.add('std', T.ico(0), [r.range(-5, 5), 1.2, r.range(-5, 5)], [1.5, 1.1, 1.5], null, r.pick(['#d8281e', '#f2d020', '#f4f4ec', '#e870a8']), S(0, 0.8, 0));
  D.add('std', T.dodeca(), [0, 1.4, 0], [6, 1.6, 5], [0, 0.2, 0], '#6d6a63', { surf: [DET.rock, 0.85, 0], wobble: { amp: 0.2, seed: 2 } });
}

function sawhorse(P) {
  const { D } = P;
  const F = WOODS;
  for (const z of [-20, 20]) {
    rod(D, 'std', [0, 0, z - 4], [0, 26, z], 1, '#6b4a2c', F, 5);
    rod(D, 'std', [0, 0, z + 4], [0, 26, z], 1, '#6b4a2c', F, 5);
  }
  for (let i = 0; i < 5; i++) D.box('std', 0.6, 25 + (i % 2 ? 0 : 0), -20 + i * 8 + 4, 1.4, 5, 8, i % 2 ? '#e8e8e0' : '#c8281e', null, S(DET.plastic, 0.4, 0));
  for (let i = 0; i < 5; i++) D.box('std', 0.6, 17, -20 + i * 8 + 4, 1.4, 5, 8, i % 2 ? '#c8281e' : '#e8e8e0', null, S(DET.plastic, 0.4, 0));
  D.box('blink', 1.6, 32, 0, 2.6, 2.6, 2.6, '#ff9a1a', null, { emissive: 3.2 });
}

void BRIGHT; void plank;

export const APOCALYPSE = {
  barricade, plywood, board_door: boardDoor, graf, poster, wposter, bodybag, helmet, milcrate, mil_box: milBox, sandarc: sandArc, tarp,
  medtent: medTent, tape, banner, shrine, cross, sawhorse,
};
