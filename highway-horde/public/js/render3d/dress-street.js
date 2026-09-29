// Set dressing, part 2 (WORLD): street furniture and signs — park benches, bus stops with
// ads, mailboxes, phone booths, trash cans, parking meters, hydrants, vending machines,
// newspaper boxes, billboards, road signs of many kinds, traffic barrels, chain-link and
// picket fences, bollards, bike racks, planters, flag poles, utility poles with sagging
// wires, old-fashioned lamps and a dead ATM. The picture bits (ads, signs, machine fronts)
// come from dress-atlas.js; ads and machine fronts sit on the dim 'lit' bucket.

import { T, S, DET, rod, plank, pic, dressUV, dressSize, WOOD, WOOD_D, METAL, STEEL, BRIGHT, MUTED, pick, range, cards, card, cardGeo } from './dress-kit.js';
import { LEAF_CELLS } from './world-tex.js';
import { shadeHex } from './world-geo.js';

const GALV = '#8a9096';
const PAINT = (rough = 0.5) => S(DET.panel, rough, 0.5);
const RUST = S(DET.rust, 0.7, 0.6);
const WOODS = S(DET.wood, 0.85, 0);
const CONC = S(DET.concrete, 0.88, 0);

function bench(P) {
  const { D, s } = P;
  const r = D.rng;
  const green = r.chance(0.5);
  const slat = green ? r.pick(['#3a5a3a', '#2f4f3a']) : r.pick(['#6b4a2c', '#7a5a34', '#5a3f26']);
  const iron = '#202224';
  for (const z of [-16, 16]) {
    // cast-iron ends: legs, arm rest, back stay
    D.box('std', 0.5, 4.6, z, 2.2, 9.2, 2.6, iron, null, RUST);
    D.box('std', -6.2, 5, z, 1.8, 10, 2.6, iron, [0, 0, -0.08], RUST);
    D.box('std', 5, 12.4, z, 9, 1.2, 2.6, iron, null, RUST);
    D.box('std', -5.6, 15.6, z, 1.6, 18, 2.4, iron, [0, 0, 0.13], RUST);
    D.box('std', 5.4, 8.4, z, 1.4, 7, 2.4, iron, null, RUST);
  }
  const missing = r.chance(0.3) ? Math.floor(r.next() * 4) : -1;
  for (let i = 0; i < 4; i++) {
    if (i === missing) continue;
    D.rbox('std', -2 + i * 2.6, 9.6 + i * 0.05, 0, 2.3, 1.1, 36, 0.3, slat, [0, 0, 0], WOODS);   // seat slats
  }
  for (let i = 0; i < 3; i++) {
    if (i === missing - 4) continue;
    D.rbox('std', -8 - i * 0.6, 13.4 + i * 3.6, 0, 1.1, 2.7, 36, 0.3, slat, [0, 0, 0.12], WOODS);   // back slats
  }
}

function busStop(P) {
  const { D, s } = P;
  const r = D.rng;
  const frame = r.pick(['#8a9096', '#3a4a5a', '#5a2a2a']);
  const F = PAINT();
  const wide = 54;
  // roof, posts, back and side glass
  D.rblock('std', 0, 66, 0, 24, 2.6, wide + 4, 0.8, frame, [0, 0, 0.03], F);
  D.rblock('std', 0, 68.4, 0, 22, 1, wide + 1, 0.5, shadeHex(frame, 0.15), [0, 0, 0.03], F);
  for (const z of [-wide / 2, wide / 2]) for (const x of [-10, 10]) D.box('std', x, 33, z, 1.8, 66, 1.8, frame, null, F);
  const dmg = (i) => (r.chance(0.35) ? DET.glass : 0) + i * 0;
  D.box('glass', -10, 32, -wide / 4 - 6, 0.8, 58, wide / 2 - 8, '#1a242e', null, { surf: [dmg(0), 0.15, -1] });
  D.box('glass', 0, 33, -wide / 2 + 0.3, 20, 58, 0.8, '#1a242e', null, { surf: [dmg(1), 0.15, -1] });
  if (r.chance(0.55)) D.box('glass', 0, 33, wide / 2 - 0.3, 20, 58, 0.8, '#1a242e', null, { surf: [DET.glass, 0.15, -1] });
  // the ad (lit) on the back panel, facing the street
  const ad = 'ad' + Math.floor(r.next() * 4);
  D.box('std', -10.4, 32, wide / 4 + 6, 1.6, 60, wide / 2 - 6, '#2a2c30', null, F);
  pic(D, ad, -9.4, 32, wide / 4 + 6, wide / 2 - 10, 54, { bucket: 'lit', ry: 0, color: '#ffffff' });
  // bench inside
  D.box('std', -5, 11, 0, 5, 1.2, wide * 0.6, frame, null, F);
  for (const z of [-wide * 0.28, wide * 0.28]) D.box('std', -5, 5, z, 3, 10, 1.6, frame, null, F);
  // sign pole and a bin
  D.cyl('std', 16, 0, wide / 2 + 6, 1.2, 74, GALV, 8, 1, null, S(DET.rust, 0.5, 0.85));
  pic(D, 'busstop', 16.4, 66, wide / 2 + 6, 15, 20, { bucket: 'sign' });
  D.box('std', 15.5, 66, wide / 2 + 6, 0.6, 21, 16, '#7a7e82', null, S(DET.panel, 0.5, 0.8));
  // litter under the roof
  if (r.chance(0.6)) D.add('std', T.pillow(8, 5, 0.5), [0, 1.4, r.range(-10, 10)], [3.5, 1.2, 2.6], [0, r.range(0, 6), 0], r.pick(BRIGHT), S(DET.fabric, 0.9, 0));
}

function mailbox(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#2a2a2e', '#5b5f63', '#1c4fa8', '#3b4a3a', '#8a8d8f']);
  D.box('std', 0, 16, 0, 2.6, 32, 2.6, '#6b4a2c', null, WOODS);
  D.box('std', 3, 31, 0, 8, 1.4, 1.6, '#6b4a2c', null, WOODS);                 // arm
  D.add('std', T.cyl(10), [5, 35.4, 0], [3.4, 13, 2.8], [0, 0, Math.PI / 2], col, { ...S(DET.panel, 0.4, 0.5), map: 'cyl' });   // the box: a half-round tunnel
  D.add('std', T.sphere(8, 4), [11.6, 35.4, 0], [0.6, 2.8, 3.4], null, col, S(DET.panel, 0.4, 0.5));
  const open = r.chance(0.3);
  if (open) {
    D.box('std', 11.8, 32.6, 0, 0.6, 6.4, 6, col, [0, 0, 1.5], S(DET.panel, 0.4, 0.5));
    D.add('sign', T.plane(), [10, 33.4, 1], [4, 2, 1], [-1.2, 0.3, 0.2], '#f0eee0', { uv: dressUV('f_paper'), noAO: true });
  } else D.box('std', 11.8, 35.4, 0, 0.6, 6, 6.4, shadeHex(col, -0.15), null, S(DET.panel, 0.4, 0.5));
  D.box('std', 5, 38.6, 3.6, 0.8, 5.4, 0.6, r.pick(['#c8281e', '#c8281e', '#e0a020']), [0, 0, r.chance(0.5) ? 0 : 1.5], S(DET.panel, 0.5, 0.2));   // flag
  pic(D, 'numbers', 4, 35.6, 3.4, 5, 1.7, { ry: -Math.PI / 2 });
}

function postbox(P) {
  const { D } = P;
  const col = D.rng.pick(['#1c4fa8', '#1c4fa8', '#a01818']);
  const F = S(DET.panel, 0.4, 0.5);
  D.cyl('std', 0, 0, 0, 5.6, 3, '#2a2c30', 12, 0.9, null, F);
  D.rblock('std', 0, 3, 0, 9, 30, 9, 2.4, col, null, F);
  D.add('std', T.sphere(12, 5), [0, 33, 0], [4.7, 3.4, 4.7], null, col, F);
  D.box('std', 4.6, 26, 0, 0.6, 1.8, 6.4, '#101012', null, F);                    // mail slot
  D.box('std', 4.7, 20, 0, 0.5, 8, 6, shadeHex(col, -0.15), null, F);              // pull-down door
  pic(D, 'mail', 4.9, 30, 0, 6.5, 2.7, { bucket: 'sign' });
  D.box('std', 4.9, 20, 0, 0.3, 1, 3.4, '#d0d0c8', null, F);
}

function phone(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#a01818', '#3a4a5a', '#8a9096']);
  const F = PAINT();
  D.rblock('std', 0, 0, 0, 20, 3, 20, 0.8, '#3a3c40', null, CONC);
  for (const x of [-9, 9]) for (const z of [-9, 9]) D.box('std', x, 40, z, 2, 78, 2, col, null, F);
  D.rblock('std', 0, 77, 0, 22, 4, 22, 1, col, null, F);
  D.rblock('std', 0, 81, 0, 17, 2, 17, 0.6, shadeHex(col, 0.15), null, F);
  pic(D, 'phone_sign', 0, 72, 10.4, 14, 5, { bucket: 'lit', ry: -Math.PI / 2 });
  pic(D, 'phone_sign', 10.4, 72, 0, 14, 5, { bucket: 'lit' });
  for (const [x, z, w, d] of [[0, -9.4, 16, 0.5], [0, 9.4, 16, 0.5], [-9.4, 0, 0.5, 16]]) {
    D.box('glass', x, 36, z, w, 60, d, '#3a4c56', null, { surf: [r.chance(0.4) ? DET.glass : 0, 0.15, -1] });
    D.box('std', x, 8, z, w + 0.2, 0.8, d + 0.2, col, null, F);
    D.box('std', x, 40, z, w + 0.2, 0.8, d + 0.2, col, null, F);
  }
  // the phone on the back wall
  D.rbox('std', -7.6, 44, 0, 3, 11, 8, 0.6, '#202224', null, S(DET.plastic, 0.4, 0.3));
  D.rbox('std', -6.4, 46, 0, 1.4, 6, 2, 0.5, '#101012', [0, 0, 0.05], S(DET.plastic, 0.5, 0));
  rod(D, 'std', [-6, 40, 0.6], [-4.5, 32, 1.2], 0.35, '#202224', null, 5);                  // cord
  D.rbox('std', -4.2, 30, 1.2, 1.4, 6, 2, 0.5, '#101012', null, S(DET.plastic, 0.5, 0));       // handset hanging
}

function bin(P) {
  const { D } = P;
  const r = D.rng;
  const kind = r.next();
  if (kind < 0.55) {
    // steel mesh basket bin
    const col = r.pick(['#3a4a3a', '#2a2c30', '#5a5e62']);
    D.cyl('std', 0, 0, 0, 5.6, 2, '#1a1c1e', 8, 0.9, null, RUST);
    D.cyl('std', 0, 2, 0, 5.6, 22, col, 10, 0.86, null, S(DET.corrugated, 0.6, 0.6));
    for (const y of [6, 14]) D.cyl('std', 0, y, 0, 5.5 - y * 0.008, 0.8, shadeHex(col, 0.2), 10, 1, null, S(0, 0.5, 0.7));
    D.cyl('std', 0, 23.4, 0, 5.1, 1.2, shadeHex(col, -0.2), 10, 0.96, null, S(0, 0.5, 0.7));
    if (r.chance(0.7)) for (let i = 0; i < 3; i++) D.add('std', T.pillow(7, 5, 0.5), [r.range(-2, 2), 23 + i, r.range(-2, 2)], [2.6, 1.6, 2.6], [0, r.range(0, 6), 0], r.pick(['#131416', '#e8e8e0', '#c8281e']), S(DET.plastic, 0.3, 0));
  } else {
    // wheelie bin: body, sloped lid, wheels, label
    const col = r.pick(['#2f5a3a', '#1c4fa8', '#2a2c30', '#5a5e62']);
    D.add('std', T.profile('wheelie', [[-4.6, 0], [4.6, 0], [5.2, 26], [-5.2, 26]], 0.8, 8.6), [0, 1.4, 0], [1, 1, 1], null, col, S(DET.plastic, 0.45, 0));
    D.rbox('std', 0, 28, 0, 11.6, 2.2, 9.4, 0.8, shadeHex(col, -0.12), [0, 0, r.chance(0.5) ? 0 : -0.5], S(DET.plastic, 0.4, 0));
    for (const z of [-4.2, 4.2]) D.cylZ('std', -3.8, 2, z, 2, 1.6, '#151515', 8);
    pic(D, 'bin_label', 5.4, 15, 0, 7, 3.5, { bucket: 'sign' });
  }
}

function binFall(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#3a4a3a', '#2a2c30', '#2f5a3a']);
  const ang = r.range(0, 6);
  D.add('std', T.cyl(12, 0.9), [0, 5.5, 0], [5.4, 22, 5.4], [0, ang, Math.PI / 2 - 0.05], col, { ...S(DET.corrugated, 0.6, 0.6), map: 'cyl' });
  D.add('std', T.torus(14, 0.25, 5), [Math.cos(ang) * -11, 5.5, Math.sin(ang) * 11], [4.9, 4.9, 1], [0, ang + Math.PI / 2, 0], shadeHex(col, -0.2), S(0, 0.5, 0.7));
  for (let i = 0; i < 7; i++) {
    const t = r.next();
    const x = 11 + r.range(0, 14), z = r.range(-9, 9);
    if (t < 0.45) D.add('std', T.pillow(8, 5, 0.5), [x, 2, z], [3.2, 2, 3], [0, r.range(0, 6), 0], r.pick(['#131416', '#e8e8e0', '#2a3a2a']), { ...S(DET.plastic, 0.3, 0), wobble: { amp: 0.2, seed: i } });
    else if (t < 0.7) D.add('std', T.cyl(8), [x, 1.7, z], [1.7, 4.4, 1.7], [0, r.range(0, 6), Math.PI / 2], r.pick(['#c0c4c8', '#b81c1c']), { ...S(DET.panel, 0.3, 0.85), map: 'cyl' });
    else D.add('std', T.box(), [x, 0.7, z], [4, 1.2, 3], [0, r.range(0, 6), 0], r.pick(['#a98552', '#d8d0b8']), S(0, 0.8, 0));
  }
}

function meter(P) {
  const { D } = P;
  const F = S(DET.panel, 0.4, 0.6);
  D.cyl('std', 0, 0, 0, 1.1, 30, '#4a4e52', 8, 1, null, F);
  D.rbox('std', 0, 34, 0, 5.4, 9, 3.6, 1.2, '#5a5e62', null, F);
  D.add('glass', T.cyl(12), [0, 36, 1.8], [1.9, 0.5, 1.9], [Math.PI / 2, 0, 0], '#9aa4ac');
  D.box('std', 0, 31.6, 1.85, 2.2, 1, 0.3, '#101012', null, F);
  D.box('std', 0, 39.4, 0, 3.6, 0.9, 2.4, '#3a3e42', null, F);
  D.box('std', 0.6, 33, 1.9, 1.6, 0.6, 0.2, '#d8281e', null, F);
}

function hydrant(P) {
  const { D } = P;
  const r = D.rng;
  const col = r.pick(['#c8281e', '#c8281e', '#d8b020', '#a01818']);
  const F = S(DET.panel, 0.45, 0.6);
  D.cyl('std', 0, 0, 0, 4.4, 2, '#2a2c30', 10, 0.9, null, RUST);
  D.cyl('std', 0, 2, 0, 3.3, 13, col, 8, 0.94, null, F);
  D.add('std', T.sphere(8, 4), [0, 15, 0], [3.4, 2.3, 3.4], null, col, F);
  D.cyl('std', 0, 16.4, 0, 1.3, 2.2, shadeHex(col, -0.3), 6, 0.9, null, F);
  D.cyl('std', 0, 11, 0, 3.7, 1.4, shadeHex(col, -0.25), 12, 1, null, F);
  for (const z of [-1, 1]) {
    D.cyl('std', 0, 9.2, z * 3.4, 1.7, 3, shadeHex(col, 0.05), 8, 1, [Math.PI / 2 * z, 0, 0], F);
    D.cyl('std', 0, 9.2, z * 5.6, 2.1, 1.1, shadeHex(col, -0.3), 8, 1, [Math.PI / 2 * z, 0, 0], F);
  }
  D.cyl('std', 3.6, 8.4, 0, 2.2, 3.4, col, 10, 1, [0, 0, -Math.PI / 2], F);
  D.cyl('std', 6.4, 8.4, 0, 2.7, 1.2, shadeHex(col, -0.3), 10, 1, [0, 0, -Math.PI / 2], F);
  rod(D, 'std', [6, 8.4, 0], [4.5, 4, 3], 0.25, '#9a9a9a');
}

function vend(P) {
  const { D } = P;
  const r = D.rng;
  const v = Math.floor(r.next() * 3);
  const body = ['#c91d24', '#1c4f9a', '#3a2a20'][v];
  const F = S(DET.panel, 0.4, 0.4);
  D.rblock('std', 0, 2, 0, 15, 60, 30, 1.6, body, [0, 0, 0], F);
  D.box('std', 0, 1, 0, 14, 2, 28, '#1a1c1e', null, F);
  pic(D, 'vend' + v, 7.7, 34, -2.5, 22, 44, { bucket: 'lit', color: '#ffffff' });
  D.box('std', 7.4, 34, -2.5, 0.5, 45, 23, '#101214', null, F);
  D.box('std', 7.8, 13, -2.5, 0.6, 6, 22, '#050607', null, F);
  D.box('std', 7.8, 33, 11.6, 0.6, 30, 6, '#202226', null, F);
  for (let i = 0; i < 5; i++) D.box('std', 8.2, 44 - i * 5, 11.6, 0.5, 2.6, 4, '#8a8e92', null, S(DET.plastic, 0.4, 0.4));
  D.box('glass', 8.1, 51, -2.5, 0.4, 3, 22, '#080a0c', null);
  if (r.chance(0.25)) D.add('std', T.cyl(8), [11, 1.6, r.range(-10, 6)], [1.7, 4.4, 1.7], [0, r.range(0, 6), Math.PI / 2], '#c0c4c8', { ...S(DET.panel, 0.3, 0.85), map: 'cyl' });
}

function newsbox(P) {
  const { D } = P;
  const col = D.rng.pick(['#c8281e', '#1c4fa8', '#e0a020', '#2f8a4a']);
  const F = S(DET.panel, 0.4, 0.5);
  for (const z of [-3.6, 3.6]) D.box('std', 0, 6, z, 1.6, 12, 1.4, '#3a3c40', null, F);
  D.rbox('std', 0, 20, 0, 9, 16, 10.4, 1.2, col, null, F);
  D.box('glass', 4.6, 24, 0, 0.4, 8, 7, '#1a242e', null);
  pic(D, 'news' + Math.floor(D.rng.next() * 6), 4.4, 24, 0, 6.2, 7.2, { bucket: 'sign' });
  D.box('std', 4.7, 14, 0, 0.5, 4, 4.4, '#2a2c30', null, F);
  D.box('std', 4.9, 12.4, 3.4, 0.4, 1, 1.4, '#c9ced3', null, S(0, 0.2, 1));
}

function billboard(P) {
  const { D, s } = P;
  const r = D.rng;
  const cell = 'bb' + Math.floor(r.next() * 8);
  const W = 256, H = 96, y0 = 190;
  const F = RUST;
  for (const z of [-W * 0.34, W * 0.34]) {
    D.cyl('std', -6, 0, z, 4.2, y0 + 8, '#6a6e72', 10, 0.86, null, F);
    D.rblock('std', -6, 0, z, 16, 6, 16, 1, '#7a776e', null, CONC);
  }
  // panel: frame, face (lit), catwalk with rail under it, flood lamps on arms over the top
  D.rbox('std', 0, y0 + H / 2, 0, 7, H + 6, W + 6, 1, '#2c2f33', null, S(DET.panel, 0.55, 0.6));
  D.box('std', 3.7, y0 + H / 2, 0, 0.6, H, W, '#ffffff', null, { noAO: true });
  pic(D, cell, 4.1, y0 + H / 2, 0, W, H, { bucket: 'lit', color: '#ffffff' });
  D.box('std', 8, y0 - 3, 0, 14, 1.4, W * 0.9, '#5a5e62', null, S(DET.corrugated, 0.6, 0.6));
  rod(D, 'std', [15, y0 + 8, -W * 0.45], [15, y0 + 8, W * 0.45], 0.5, '#8a8e92');
  for (let z = -W * 0.45; z <= W * 0.45; z += W * 0.3) rod(D, 'std', [15, y0 - 3, z], [15, y0 + 8, z], 0.5, '#8a8e92');
  for (const z of [-W * 0.3, 0, W * 0.3]) {
    rod(D, 'std', [3, y0 + H + 2, z], [22, y0 + H + 10, z], 0.7, '#5a5e62');
    D.rbox('std', 22, y0 + H + 10, z, 8, 3, 6, 0.8, '#202224', [0, 0, -0.3], S(DET.panel, 0.5, 0.5));
  }
  // braces down to the posts
  for (const z of [-W * 0.34, W * 0.34]) rod(D, 'std', [-6, y0 - 6, z], [-6, 30, z * 0.98], 0.6, '#6a6e72', null, 5);
  rod(D, 'std', [-6, 60, -W * 0.34], [-6, y0 - 20, W * 0.34], 0.6, '#6a6e72', null, 5);
  rod(D, 'std', [-6, 60, W * 0.34], [-6, y0 - 20, -W * 0.34], 0.6, '#6a6e72', null, 5);
  void s;
}

// -- road signs (item.v picks the sign) ------------------------------------------------------------
const SIGN_SET = [
  ['stop', 4], ['stop', 0], ['yield', 2], ['speed25', 1.5], ['speed45', 2], ['speed65', 2], ['oneway', 1], ['dne', 1.4], ['nopark', 1.4],
  ['ped', 1], ['school', 0.8], ['deer', 1], ['curve', 1.2], ['work', 1.4], ['rrx', 0.5], ['closed', 1.4], ['detour', 1.2], ['hospital', 0.8],
  ['parking', 0.8], ['busstop', 0.6], ['exit', 1.1], ['shield', 0.9], ['mile', 0.8], ['street0', 0.8], ['street1', 0.8], ['street2', 0.8], ['street3', 0.8],
];
function rsign(P) {
  const { D, it } = P;
  const r = D.rng;
  let tot = 0;
  for (const [, w] of SIGN_SET) tot += w;
  let pk = ((it.v * 0.61803) % 1) * tot;
  let cell = SIGN_SET[0][0];
  for (const [c, w] of SIGN_SET) { pk -= w; if (pk < 0) { cell = c; break; } }
  const [pw, ph] = dressSize(cell);
  const wide = cell === 'exit' ? 62 : cell.startsWith('street') ? 40 : cell === 'closed' || cell === 'detour' || cell === 'oneway' || cell === 'rrx' ? 40 : 0;
  const hh = wide ? wide * ph / pw : cell === 'exit' ? 20 : 22 + (cell === 'mile' ? -2 : 0);
  const ww = wide || hh * pw / ph;
  const cy = 70;
  const lean = r.chance(0.18) ? r.range(-0.22, 0.22) : 0;
  const fallen = r.chance(0.06);
  const A = fallen ? [0, 0, Math.PI / 2 - 0.1] : [lean, 0, lean * 0.6];
  const F = S(DET.rust, 0.45, 0.85);
  if (fallen) {
    D.cyl('std', 0, 0, 0, 1.3, 40, GALV, 8, 1, [0, 0, Math.PI / 2 - 0.12], F);
    pic(D, cell, 0, 3, 34, ww, hh, { bucket: 'sign', rx: -Math.PI / 2, ry: Math.PI });
    return;
  }
  const poleX = wide > 45 ? [-wide * 0.33, wide * 0.33] : [0];
  for (const z of poleX) D.cyl('std', -1.6, 0, z, 1.25, cy - hh * 0.35 + 6, GALV, 8, 1, null, F);
  // the sign face on a backing plate, both slightly tilted with the post
  D.add('std', T.box(), [-1.2, cy, 0], [0.9, hh + 1, ww + 1], A, '#7a7e82', S(DET.panel, 0.5, 0.8));
  D.add('sign', T.plane(), [-0.6, cy, 0], [ww, hh, 1], [A[0], Math.PI / 2 + A[1], A[2]], '#ffffff', { uv: dressUV(cell), noAO: true, noJitter: true });
  if (cell === 'stop' && r.chance(0.5)) D.add('sign', T.plane(), [-0.55, cy - hh * 0.62, 0], [ww * 0.7, hh * 0.24, 1], [A[0], Math.PI / 2 + A[1], A[2]], '#ffffff', { uv: dressUV('closed'), noAO: true });
  if (cell === 'speed25' || cell === 'speed45') void 0;
}

function barrelT(P) {
  const { D } = P;
  const r = D.rng;
  const down = r.chance(0.2);
  const F = S(DET.plastic, 0.5, 0);
  const A = down ? [0, r.range(0, 6), Math.PI / 2] : null;
  const y = down ? 5.2 : 0;
  const base = (b) => (down ? [0, y, 0] : [0, b, 0]);
  void base;
  if (!down) {
    D.cyl('std', 0, 0, 0, 5.4, 26, '#e8641c', 12, 0.72, null, F);
    D.cyl('std', 0, 9, 0, 4.9, 4.4, '#ecece4', 12, 0.94, null, S(DET.plastic, 0.3, 0));
    D.cyl('std', 0, 16.4, 0, 4.4, 4.4, '#ecece4', 12, 0.93, null, S(DET.plastic, 0.3, 0));
    D.cyl('std', 0, 0, 0, 5.8, 2.2, '#1a1a1a', 12, 0.95, null, S(DET.rubber, 0.8, 0));
    D.add('std', T.torus(12, 0.2, 4), [0, 26, 0], [3.9, 3.9, 1], [Math.PI / 2, 0, 0], '#c8541c', F);
  } else {
    D.add('std', T.cyl(12, 0.72), [0, y, 0], [5.4, 26, 5.4], A, '#e8641c', { ...F, map: 'cyl' });
    D.add('std', T.cyl(12, 0.94), [-2, y, 0], [4.9, 4.4, 4.9], A, '#ecece4', { ...S(DET.plastic, 0.3, 0), map: 'cyl' });
  }
}

function fenceCL(P) {
  const { D, it } = P;
  const len = it.w || 80;
  const H = 36;
  const F = S(DET.rust, 0.5, 0.85);
  const n = Math.max(1, Math.round(len / 60));
  const step = len / n;
  const r = D.rng;
  for (let i = 0; i <= n; i++) {
    D.cyl('std', i * step, 0, 0, 1, H + 2, GALV, 6, 1, null, F);
    D.add('std', T.sphere(5, 3), [i * step, H + 2.4, 0], [1.4, 1, 1.4], null, GALV, F);
  }
  rod(D, 'std', [0, H, 0], [len, H, 0], 0.7, GALV, null, 5);
  rod(D, 'std', [0, 1.4, 0], [len, 1.4, 0], 0.35, GALV, null, 4);
  for (let i = 0; i < n; i++) {
    if (r.chance(0.12)) continue;   // a torn panel
    const sag = r.chance(0.2) ? r.range(-0.06, 0.06) : 0;
    D.add('fence', T.plane(), [(i + 0.5) * step, H / 2 + 0.6, sag * 10], [step, H - 1.4, 1], [sag, 0, 0], '#8a9094', { uvScale: [step / 12, (H - 1.4) / 12] });
  }
}

function fencePK(P) {
  const { D, it } = P;
  const len = it.w || 80;
  const r = D.rng;
  const col = r.chance(0.7) ? r.pick(['#d8d4c8', '#cfcabb', '#e2ddd0']) : r.pick(['#8a8478', '#7a6a50']);
  const F = WOODS;
  const n = Math.round(len / 4.6);
  const pts = [[-1.05, 0], [1.05, 0], [1.05, 20], [0, 23.2], [-1.05, 20]];
  for (let i = 0; i < n; i++) {
    if (r.chance(0.05)) continue;
    const lean = r.chance(0.08) ? r.range(-0.3, 0.3) : r.range(-0.015, 0.015);
    D.add('std', T.profile('picket', pts, 0, 1), [(i + 0.5) * (len / n), 0, 0], [1, 1, 0.9], [0, 0, lean], col, F);
  }
  for (const y of [5, 15]) D.box('std', len / 2, y, -1.2, len, 2, 1, shadeHex(col, -0.15), null, F);
  for (let x = 0; x <= len; x += 50) D.box('std', x, 12, -0.6, 2.6, 26, 2.6, shadeHex(col, -0.1), null, F);
}

function bollard(P) {
  const { D } = P;
  const F = S(DET.panel, 0.45, 0.5);
  D.cyl('std', 0, 0, 0, 2.2, 15, '#3a3e42', 10, 1, null, F);
  D.add('std', T.sphere(10, 4), [0, 15, 0], [2.2, 1.5, 2.2], null, '#3a3e42', F);
  D.cyl('std', 0, 9, 0, 2.3, 3, '#e8e8e0', 10, 1, null, S(DET.plastic, 0.3, 0));
  if (D.rng.chance(0.4)) D.cyl('std', 0, 3, 0, 2.3, 2, '#e8c020', 10, 1, null, S(DET.plastic, 0.3, 0));
}

function bikerack(P) {
  const { D } = P;
  const M = S(0, 0.35, 0.9);
  for (let i = 0; i < 4; i++) {
    const z = -9 + i * 6;
    rod(D, 'std', [0, 0, z], [0, 12, z], 0.55, '#9aa0a4', M, 6);
    rod(D, 'std', [0, 12, z], [0, 12, z + 3], 0.55, '#9aa0a4', M, 6);
    rod(D, 'std', [0, 12, z + 3], [0, 0, z + 3], 0.55, '#9aa0a4', M, 6);
  }
  D.box('std', 0, 0.6, 0, 3, 0.6, 30, '#6a6e72', null, RUST);
}

function planter(P) {
  const { D } = P;
  const r = D.rng;
  D.rbox('std', 0, 6.5, 0, 22, 13, 12, 1.4, '#8a877e', null, CONC);
  D.box('std', 0, 12.8, 0, 19, 0.6, 9, '#2a2016', null, S(DET.dirt, 0.95, 0));
  const dead = r.chance(0.6);
  const col = dead ? '#6a5a30' : '#2f4a26';
  const L = cards();
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, 6.28), d = r.range(0, 6);
    const f = [Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5];
    card(L, [Math.cos(a) * d, 17 + r.range(0, 5), Math.sin(a) * d * 0.6], f, r.range(0, 6), r.range(9, 15), r.range(9, 15), LEAF_CELLS.scrub);
  }
  D.add('leaves', cardGeo(L), [0, 0, 0], [1, 1, 1], null, col, { noAO: true });
  for (let i = 0; i < 4; i++) rod(D, 'std', [r.range(-3, 3), 12.6, r.range(-3, 3)], [r.range(-6, 6), 18 + r.range(0, 5), r.range(-4, 4)], 0.4, '#5a4a2a', null, 4);
}

function flagpole(P) {
  const { D } = P;
  const F = S(DET.rust, 0.4, 0.85);
  D.rblock('std', 0, 0, 0, 12, 4, 12, 1, '#8a877e', null, CONC);
  D.cyl('std', 0, 4, 0, 1.9, 176, '#c9ced3', 10, 0.5, null, F);
  D.add('std', T.sphere(8, 5), [0, 181, 0], [2.4, 2.4, 2.4], null, '#d8b020', S(0, 0.3, 1));
  rod(D, 'std', [1, 20, 0], [1, 150, 0], 0.15, '#c8c0a8', null, 4);
  // a tattered flag at half mast (waves on the GPU)
  const stripes = ['#8a1c1c', '#e3e3e3', '#1c3a8a'];
  const hoist = D.rng.chance(0.5) ? 118 : 165;
  for (let i = 0; i < 3; i++) {
    D.add('cloth', clothGeoLocal(), [2 + 22, hoist - 5 - i * 9, 0], [44, 9, 1], [0, 0, 0], stripes[i], { noAO: true });
  }
}
import { clothGeo } from './dress-kit.js';
function clothGeoLocal() { return clothGeo(8, 2); }

// -- utility poles and wires ------------------------------------------------------------------------
function pole(P) {
  const { D } = P;
  const r = D.rng;
  const F = S(DET.wood, 0.85, 0);
  const lean = r.range(-0.012, 0.012);
  D.add('std', T.cyl(9, 0.68), [0, 150, 0], [4.6, 300, 4.6], [lean, 0, lean * 0.7], '#4a3a2a', { ...F, map: 'cyl' });
  D.cyl('std', 0, 0, 0, 5.6, 6, '#3a3128', 9, 0.85, null, F);
  // crossarms (perpendicular to the line = along local x), braces, insulators
  D.box('std', 0, 289, 0, 64, 3.6, 3.6, '#3d3022', null, F);
  D.box('std', 0, 277, 0, 46, 3.2, 3.2, '#3d3022', null, F);
  for (const s of [-1, 1]) rod(D, 'std', [s * 6, 272, 0], [s * 18, 288, 0], 0.7, '#3d3022', F, 5);
  for (const x of [-26, -9, 9, 26]) {
    D.cyl('std', x, 289.4, 0, 1.7, 5.6, '#6a8a8a', 8, 0.7, null, S(DET.glass, 0.2, 0.3));
    D.cyl('std', x, 294.6, 0, 1.0, 2, '#4a6a6a', 8, 1, null, S(DET.glass, 0.2, 0.3));
  }
  D.cyl('std', 0, 300, 0, 0.5, 8, '#8a8e92', 5, 1, null, S(0, 0.4, 0.8));   // lightning rod
  if (r.chance(0.55)) {
    D.cyl('std', 6, 236, 0, 7, 22, '#6a6e72', 12, 0.95, null, S(DET.panel, 0.5, 0.6));   // transformer can
    D.cyl('std', 6, 258, 0, 7.4, 1.6, '#5a5e62', 12, 1, null, S(DET.panel, 0.5, 0.6));
  }
  // steps, a tag plate, ground wire down the side, guy wire
  for (let y = 40; y < 200; y += 24) D.box('std', 0, y, r.chance(0.5) ? 4.6 : -4.6, 2, 0.8, 8, '#8a8e92', null, RUST);
  rod(D, 'std', [-4.6, 20, 0], [-4.6, 270, 0], 0.3, '#a0602a', null, 4);
  if (r.chance(0.4)) {
    rod(D, 'std', [0, 268, 0], [-90, 0, 30], 0.35, '#5a5e62', null, 4);
    D.box('std', -90, 3, 30, 5, 5, 5, '#6a6e72', null, CONC);
  }
  D.box('std', 4.7, 120, 0, 0.5, 6, 4, '#e8e8e0', null, S(DET.plastic, 0.5, 0));
}

function wire(P) {
  const { D, it } = P;
  const len = it.w || 300;
  const n = 6;
  const sag = len * 0.035;
  for (const z of [-26, -9, 9, 26]) {
    let prev = [0, 292, z];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = [len * t, 292 - sag * 4 * t * (1 - t) - (z === -26 || z === 26 ? 0 : 0), z];
      plank(D, 'std', prev, p, 0.55, 0.55, '#141414', null);
      prev = p;
    }
  }
}

function lampOld(P) {
  const { D } = P;
  const F = S(DET.panel, 0.5, 0.7);
  const col = '#1e2a26';
  D.cyl('std', 0, 0, 0, 5, 10, col, 10, 0.55, null, F);
  D.cyl('std', 0, 10, 0, 2.6, 92, col, 10, 0.72, null, F);
  D.add('std', T.torus(10, 0.3, 4), [0, 30, 0], [2.9, 2.9, 1], [Math.PI / 2, 0, 0], shadeHex(col, 0.15), F);
  D.cyl('std', 0, 100, 0, 3.4, 3, shadeHex(col, 0.1), 10, 1.5, null, F);
  D.cyl('glass', 0, 103, 0, 4.4, 14, '#3a3e40', 6, 1.15);
  for (let k = 0; k < 6; k++) { const a = k * 1.047; D.box('std', Math.cos(a) * 4.5, 110, Math.sin(a) * 4.5, 0.6, 15, 0.6, col, null, F); }
  D.cyl('std', 0, 117, 0, 5.6, 4, col, 6, 0.3, null, F);
  D.add('std', T.sphere(8, 4), [0, 122, 0], [1.6, 1.8, 1.6], null, col, F);
}

function atm(P) {
  const { D } = P;
  const F = S(DET.panel, 0.4, 0.5);
  D.rblock('std', 0, 0, 0, 14, 62, 22, 1.4, '#8a8e92', null, F);
  D.box('std', 7.2, 44, 0, 0.6, 14, 15, '#0b1218', null, F);
  pic(D, 'atm', 7.6, 44, 0, 14, 9.4, { bucket: 'lit' });
  D.box('std', 7.4, 30, 0, 0.8, 8, 14, '#2a2c30', null, F);
  D.box('std', 7.8, 30, 0, 0.5, 1, 9, '#050607', null, F);
  D.box('std', 7.4, 22, 4, 1, 6, 6, '#3a3e42', null, F);
  for (let i = 0; i < 9; i++) D.box('std', 8, 24 + (i % 3) * 1.8 + 6, -2 + Math.floor(i / 3) * 2, 0.4, 1.3, 1.3, '#c8ccd0', null, F);
  D.rbox('std', 0, 63.2, 0, 15, 2, 23, 0.8, '#3a3e42', null, F);
}

// `void` keeps tree-shakers and linters quiet about helpers used by later parts
void WOOD; void WOOD_D; void METAL; void STEEL; void MUTED; void pick; void range;

export const STREET = {
  bench, busstop: busStop, mailbox, postbox, phone, bin, bin_fall: binFall, meter, hydrant, vend, newsbox, billboard, rsign,
  barrel_t: barrelT, fence_cl: fenceCL, fence_pk: fencePK, bollard, bikerack, planter, flagpole, pole, wire, lamp_old: lampOld, atm,
};
