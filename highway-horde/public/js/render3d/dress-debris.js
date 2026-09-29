// Set dressing, part 1 (WORLD): road debris and the flat marks on the ground — skid marks,
// puddles, mud, stains, leaves, chalk outlines; luggage, shoes, boxes, bags, newspapers,
// cones, warning triangles, road flares, litter, fuel cans, car parts, clothes, toys,
// spilled loads. Every builder gets P = { D, it, s, halos } and draws in the prop's own
// frame (+x = facing, +y up) through the geo builder D.

import { T, S, DET, rod, plank, mark, sheet, pic, dressUV, atlasUV, BRIGHT, MUTED, CANVAS, pick, range } from './dress-kit.js';
import { shadeHex, mixHex } from './world-geo.js';

const RUBBER = '#1b1b1c';
const TYRE_PROFILE = [[0.6, -0.5], [0.86, -0.5], [0.96, -0.44], [1.0, -0.3], [1.0, 0.3], [0.96, 0.44], [0.86, 0.5], [0.6, 0.5]];
const PLASTIC = S(DET.plastic, 0.5, 0);
const CLOTH = S(DET.fabric, 0.9, 0);
const CARDBOARD = ['#a98552', '#b08a56', '#9c7a4a', '#b6935e'];

// ---- flat marks -------------------------------------------------------------------------

export const FLATS = {
  skid(P) { const { D, s } = P; mark(D, 'f_skid', 0, 0, 132 * s, 33 * s, 0, '#050506', 0.22); },
  tread(P) { const { D, s } = P; mark(D, 'f_tread', 0, 0, 110 * s, 28 * s, 0, '#050506', 0.22); },
  puddle(P) { const { D, s } = P; mark(D, 'f_puddle', 0, 0, 64 * s, 52 * s, D.rng.range(0, 6), '#070b0f', 0.3, 'wet'); },
  mud(P) { const { D, s } = P; mark(D, 'f_mud', 0, 0, 52 * s, 44 * s, D.rng.range(0, 6), pick(D, ['#2a2016', '#33261a', '#241c14']), 0.28); },
  stain(P) {
    const { D, s } = P;
    mark(D, 'f_stain', 0, 0, 44 * s, 38 * s, D.rng.range(0, 6), pick(D, ['#060606', '#0a0806', '#1a4a22', '#3a1c08']), 0.24);
  },
  soot(P) { const { D, s } = P; mark(D, 'f_soot', 0, 0, 52 * s, 50 * s, D.rng.range(0, 6), '#050505', 0.24); },
  leaves(P) { const { D, s } = P; mark(D, 'f_leaves', 0, 0, 54 * s, 54 * s, D.rng.range(0, 6), '#ffffff', 0.32); },
  paperf(P) { const { D, s } = P; mark(D, 'f_paper', 0, 0, 40 * s, 40 * s, D.rng.range(0, 6), '#ffffff', 0.34); },
  chalk(P) { const { D, s } = P; mark(D, 'f_chalk', 0, 0, 28 * s, 56 * s, 0, '#e8e8dc', 0.26); },
  glassf(P) { const { D, s } = P; mark(D, 'f_glass', 0, 0, 34 * s, 34 * s, D.rng.range(0, 6), '#bfe0ee', 0.3); },
  blood(P) { const { D, s } = P; mark(D, 'f_blood', 0, 0, 38 * s, 38 * s, D.rng.range(0, 6), '#4a0c0a', 0.27); },
};

// ---- luggage ------------------------------------------------------------------------------

function suitcase(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.chance(0.6) ? r.pick(MUTED.concat(BRIGHT.slice(0, 4))) : r.pick(['#2a2a2e', '#3a3a3e', '#8a8a86']);
  const dark = shadeHex(col, -0.4);
  const open = r.chance(0.22);
  const sw = 22 * s, sh = 7 * s, sd = 15 * s;
  const HARD = S(DET.plastic, 0.35, 0.05);
  if (open) {
    // open on the ground: shell + lid propped at ~100 degrees, clothes spilling out
    D.rblock('std', 0, 0, 0, sw, sh * 0.9, sd, 1.2, col, [0, 0, 0], HARD);
    D.box('std', 0, sh * 0.85, 0, sw - 2.4, 0.4, sd - 2.4, '#20242a', null, CLOTH);
    D.rblock('std', 0, sh * 0.5, -sd / 2 - 3.2, sw, sd * 0.85, 1.6, 0.6, col, [-0.28, 0, 0], HARD);
    for (let i = 0; i < 4; i++) {
      D.add('std', T.pillow(8, 5, 0.55), [r.range(-sw * 0.3, sw * 0.3), sh * 0.9 + 1, r.range(-sd * 0.3, sd * 0.3)], [r.range(3, 6), 1.6, r.range(3, 5)], [0, r.range(0, 6), 0], r.pick(MUTED.concat(BRIGHT)), CLOTH);
    }
    D.add('std', T.pillow(8, 5, 0.55), [sw * 0.55, 0.9, sd * 0.3], [4.4, 0.9, 3], [0, 0.6, 0], r.pick(BRIGHT), CLOTH);
    return;
  }
  const tip = r.chance(0.25);   // stands on its end
  const y0 = tip ? sw / 2 : 0;
  const cy = y0 + (tip ? 0 : sh / 2);
  D.add('std', T.rbox(sw, sh, sd, 1.4), [0, cy, 0], [1, 1, 1], tip ? [0, 0, Math.PI / 2] : null, col, HARD);
  // equator seam
  if (tip) D.box('std', 0, cy, 0, sw + 0.3, sd + 0.3, 0.5, dark, null, HARD);
  else D.box('std', 0, cy, 0, sw + 0.3, sh * 0.08, sd + 0.3, dark, null, HARD);
  if (!tip) {
    D.box('std', 0, sh + 0.4, 0, 5, 0.9, 5, '#1e1e20', null, S(0, 0.5, 0.3));                 // carry handle
    for (const z of [-sd * 0.3, sd * 0.3]) D.box('std', sw * 0.5 + 0.3, sh * 0.5, z, 0.6, 1.4, 2.2, '#c8b060', null, S(0, 0.3, 0.9));   // latches
    for (const x of [-sw * 0.38, sw * 0.38]) for (const z of [-sd / 2 + 1, sd / 2 - 1]) D.cyl('std', x, -0.2, z, 0.9, 1.2, '#161616', 6);   // wheels
    D.box('std', -sw / 2 - 0.4, sh * 0.65, 0, 0.8, 0.8, 6, '#a0a4a8', null, S(0, 0.3, 0.9));      // telescoping handle stub
    D.box('std', sw / 2 + 0.6, sh * 0.35, sd * 0.2, 0.3, 3.4, 2.2, r.pick(['#e8d020', '#d83020', '#f0f0f0']), [0, 0, 0.3], S(DET.plastic, 0.5, 0));   // luggage tag
  } else {
    D.box('std', 0, sw + 0.4, 0, 5, 0.9, 5, '#1e1e20', null, S(0, 0.5, 0.3));
  }
}

function duffel(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#2f4858', '#4a4f35', '#6b2d2a', '#2a2a2e', '#5b5f63']);
  const L = 26 * s, R = 6.4 * s;
  D.add('std', T.cyl(10), [0, R, 0], [R, L, R], [0, 0, Math.PI / 2], col, { surf: [DET.fabric, 0.9, 0], map: 'cyl' });
  for (const sx of [-1, 1]) D.add('std', T.sphere(8, 5), [sx * L / 2, R, 0], [R * 0.7, R * 0.98, R * 0.98], null, col, { surf: [DET.fabric, 0.9, 0] });
  D.box('std', 0, R * 1.98, 0, L * 0.85, 0.5, 1.4, shadeHex(col, -0.4), null, S(0, 0.5, 0.4));   // zip
  for (const x of [-L * 0.24, L * 0.24]) {
    D.add('std', T.torus(8, 0.16, 6), [x, R * 2.0 + 2.2, 0], [3.2, 2.6, 1], [0, Math.PI / 2, 0], shadeHex(col, -0.55), { surf: [DET.fabric, 0.9, 0] });
    D.box('std', x, R, 0, 1.6, R * 2.06, R * 2.08, shadeHex(col, -0.3), null, { surf: [DET.fabric, 0.9, 0], noAO: true });
  }
  D.box('std', L * 0.34, R * 1.3, R + 0.4, 6, 3.4, 0.6, shadeHex(col, 0.2), null, CLOTH);   // end pocket
}

function backpack(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(BRIGHT.concat(['#2a2a2e', '#4a4f35', '#2f4858']));
  const F = S(DET.fabric, 0.9, 0);
  D.rblock('std', 0, 0, 0, 12 * s, 6.4 * s, 14 * s, 2, col, null, F);
  D.box('std', 6.6 * s, 2.6, 0, 3.8 * s, 4.2 * s, 10 * s, shadeHex(col, -0.2), null, F);
  D.box('std', 8.6 * s, 3.6, 0, 0.5, 0.8, 8 * s, '#d0d0c8', null, S(0, 0.4, 0.4));
  D.box('std', -2 * s, 6.8 * s, 0, 1, 1, 5, shadeHex(col, -0.5), null, F);
  for (const z of [-3.6 * s, 3.6 * s]) D.box('std', -4 * s, 3.4 * s, z, 8, 0.7, 1.6, '#1e1e20', [0, 0.4 * Math.sign(z), 0], F);
  if (r.chance(0.4)) D.cyl('std', -6 * s, 0, 5.5 * s, 1.5, 6, r.pick(['#3a7ac8', '#c83a3a']), 6, 1, [0, 0, Math.PI / 2], PLASTIC);
}

// ---- shoes ------------------------------------------------------------------------------------

function shoeOne(D, x, z, rot, col, r, side = false) {
  const F = S(DET.rubber, 0.85, 0);
  const A = side ? [0, rot, 1.5] : [0, rot, 0];
  const yo = side ? 2 : 0;
  const c = Math.cos(rot), sn = Math.sin(rot);
  D.add('std', T.box(), [x, 0.8 + yo, z], [12.5, 1.5, 4.8], [0, -rot, side ? 1.5 : 0], '#e8e6e0', F);            // sole
  D.add('std', T.pillow(6, 3, 0.6), [x + c * 0.4, 2.8 + yo, z - sn * 0.4], [5.8, 2.4, 2.6], [0, -rot, side ? 1.5 : 0], col, { surf: [DET.fabric, 0.8, 0] });   // upper
  D.add('std', T.pillow(6, 3, 0.6), [x - c * 3.8, 3.4 + yo, z + sn * 3.8], [2.6, 2.4, 2.3], [0, -rot, side ? 1.5 : 0], shadeHex(col, -0.15), { surf: [DET.fabric, 0.8, 0] });
  void A; void r;
}
function shoe(P) {
  const { D } = P;
  shoeOne(D, 0, 0, D.rng.range(0, 6), pick(D, BRIGHT.concat(['#2a2a2e', '#4a3a2a'])), D.rng, D.rng.chance(0.3));
}
function shoes(P) {
  const { D } = P;
  const c = pick(D, BRIGHT.concat(['#2a2a2e', '#5a4632']));
  const a = D.rng.range(0, 6);
  shoeOne(D, 0, -4, a, c, D.rng);
  shoeOne(D, D.rng.range(-4, 6), 4.5, a + D.rng.range(-0.6, 0.6), c, D.rng, D.rng.chance(0.4));
}

// ---- car parts ---------------------------------------------------------------------------------

function carDoor(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(MUTED.concat(['#d8d8d0', '#2a2a2e']));
  const paint = { surf: [DET.panel, 0.4, 0.35] };
  const L = 34 * s, Hh = 21 * s;
  // lying face-up, one edge propped on a kerb of dirt
  const tilt = [0.06, r.range(0, 6), 0.05];
  D.add('paint', T.rbox(L, 2.4, Hh, 0.9), [0, 1.6, 0], [1, 1, 1], tilt, col, paint);
  D.add('glass', T.box(), [L * 0.06, 2.9, 0], [L * 0.62, 0.3, Hh * 0.3], tilt, '#1a242e');
  D.add('std', T.box(), [L * 0.06, 2.85, 0], [L * 0.66, 0.5, Hh * 0.36], tilt, '#101214', S(DET.rubber, 0.8, 0));
  D.add('std', T.rbox(5, 0.9, 1, 0.3), [-L * 0.3, 3.1, Hh * 0.28], [1, 1, 1], tilt, '#c9ced3', S(0, 0.2, 1));
  D.add('std', T.box(), [L * 0.4, 1.3, -Hh * 0.2], [2.4, 1.4, 4], tilt, '#20221f', S(DET.plastic, 0.6, 0));   // hinge stubs
}

function bumper(P) {
  const { D, s } = P;
  const chrome = D.rng.chance(0.4);
  const col = chrome ? '#c9ced3' : '#1e1f21';
  const F = chrome ? S(0, 0.18, 1) : S(DET.plastic, 0.6, 0);
  D.add('std', T.rbox(26 * s, 4.4, 5, 1.6), [0, 2.2, 0], [1, 1, 1], [0, 0, 0.08], col, F);
  D.add('std', T.rbox(9 * s, 4.4, 5, 1.6), [17 * s, 2, 4 * s], [1, 1, 1], [0, 0.5, 0], col, F);
  D.add('std', T.rbox(9 * s, 4.4, 5, 1.6), [-17 * s, 2, 4 * s], [1, 1, 1], [0, -0.5, 0], col, F);
  D.box('std', 0, 4.9, 0, 12, 0.5, 2, '#3a3a3a', null, S(DET.rust, 0.7, 0.3));
}

function panel(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(MUTED.concat(['#d8d8d0']));
  D.add('paint', T.box(), [0, 1, 0], [22 * s, 0.6, 15 * s], [0.12, r.range(0, 6), 0.1], col, { surf: [DET.panel, 0.45, 0.35] });
  D.add('paint', T.box(), [7 * s, 1.6, 3], [9 * s, 0.6, 7 * s], [-0.2, r.range(0, 6), 0.3], shadeHex(col, -0.15), { surf: [DET.rust, 0.6, 0.4] });
  D.add('std', T.box(), [-3, 0.4, -2], [6, 0.3, 8], [0, 0.4, 0], '#4a4a4c', S(DET.rust, 0.7, 0.6));
}

function hubcap(P) {
  const { D, s } = P;
  const up = D.rng.chance(0.5);
  const A = up ? [0.2, 0, 0.1] : [1.2, D.rng.range(0, 6), 0];
  D.add('std', T.cyl(12, 0.82), [0, up ? 0.7 : 4.2, 0], [5.8 * s, 1.3, 5.8 * s], A, '#b8bcc0', S(DET.panel, 0.3, 0.9));
  D.add('std', T.cyl(8, 0.6), [0, up ? 1.5 : 4.8, 0], [2, 0.8, 2], A, '#8a8e92', S(0, 0.3, 0.9));
}

function wheelLoose(P) {
  const { D, s } = P;
  const r = D.rng;
  const ang = r.range(0, 6);
  const lay = r.chance(0.55);
  if (lay) {
    D.add('std', T.lathe('tyre', TYRE_PROFILE, 16), [0, 2.4, 0], [8.4 * s, 4.6, 8.4 * s], [0.06, ang, 0.05], RUBBER, { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
    D.add('std', T.cyl(14, 0.98), [0, 2.9, 0], [4.9 * s, 0.7, 4.9 * s], [0.06, ang, 0.05], '#9aa0a6', S(DET.panel, 0.32, 0.85));
  } else {
    D.add('std', T.lathe('tyre', TYRE_PROFILE, 16), [0, 8.2, 0], [8.2 * s, 4.6, 8.2 * s], [Math.PI / 2 - 0.05, ang, 0], RUBBER, { surf: [DET.rubber, 0.85, 0], map: 'cyl' });
    D.add('std', T.cyl(14, 0.98), [0, 8.2, 2.7], [4.9 * s, 0.7, 4.9 * s], [Math.PI / 2 - 0.05, ang, 0], '#9aa0a6', S(DET.panel, 0.32, 0.85));
  }
}

// ---- boxes and bags ----------------------------------------------------------------------------

function cardboardBox(D, x, y0, z, w, h, d, rot, label) {
  const col = pick(D, CARDBOARD);
  D.add('std', T.rbox(w, h, d, 0.5), [x, y0 + h / 2, z], [1, 1, 1], [0, rot, 0], col, { surf: [DET.wood, 0.9, 0], noJitter: false });
  D.add('std', T.box(), [x, y0 + h + 0.05, z], [w * 0.16, 0.2, d + 0.2], [0, rot, 0], '#d6c292', S(0, 0.5, 0));   // tape
  if (label) {
    const c = Math.cos(rot), s2 = Math.sin(rot);
    D.add('sign', T.plane(), [x + c * (w / 2 + 0.15), y0 + h * 0.5, z - s2 * (w / 2 + 0.15)], [Math.min(d, h) * 0.85, Math.min(d, h) * 0.85, 1], [0, Math.PI / 2 + rot, 0], '#ffffff', { uv: dressUV(label), noAO: true, noJitter: true });
  }
}
function box(P) {
  const { D, s } = P;
  const r = D.rng;
  cardboardBox(D, 0, 0, 0, r.range(9, 14) * s, r.range(7, 12) * s, r.range(8, 12) * s, r.range(0, 6), r.pick(['box_frag', 'box_plain', 'box_plain', null]));
}
function boxStack(P) {
  const { D, s } = P;
  const r = D.rng;
  const n = 2 + Math.floor(r.next() * 3);
  let y = 0;
  const base = r.range(0, 6);
  for (let i = 0; i < n; i++) {
    const w = r.range(12, 18) * s, d = r.range(10, 14) * s, h = r.range(7, 11) * s;
    cardboardBox(D, r.range(-2, 2), y, r.range(-2, 2), w * (1 - i * 0.05), h, d, base + r.range(-0.3, 0.3), r.pick(['box_frag', 'box_plain', 'box_plain']));
    y += h;
    if (i === 0 && r.chance(0.5)) cardboardBox(D, r.range(9, 13), 0, r.range(-6, 6), 10 * s, 8 * s, 9 * s, base + r.range(-0.6, 0.6), 'box_plain');
  }
}
function boxOpen(P) {
  const { D, s } = P;
  const r = D.rng;
  const w = 13 * s, h = 10 * s, d = 11 * s;
  const rot = r.range(0, 6);
  const col = r.pick(CARDBOARD);
  const F = { surf: [DET.wood, 0.9, 0] };
  D.add('std', T.rbox(w, h, d, 0.4), [0, h / 2, 0], [1, 1, 1], [0, rot, 0], col, F);
  D.add('std', T.box(), [0, h + 0.05, 0], [w - 1.6, 0.3, d - 1.6], [0, rot, 0], '#1a140e', F);
  const flap = (x, z, rx, rz) => D.add('std', T.box(), [x, h + 2.4, z], [w * 0.5, 0.35, d * 0.48], [rx, rot, rz], shadeHex(col, -0.08), F);
  flap(0, -d * 0.62, -1.1, 0); flap(0, d * 0.62, 1.1, 0);
  D.add('std', T.pillow(8, 5, 0.5), [0, h + 0.5, 0], [w * 0.32, 2, d * 0.3], [0, rot, 0], r.pick(MUTED.concat(BRIGHT)), CLOTH);
  if (r.chance(0.5)) D.add('std', T.pillow(8, 5, 0.5), [w * 0.7, 1.4, d * 0.4], [4, 1.4, 3], [0, r.range(0, 6), 0], r.pick(MUTED.concat(BRIGHT)), CLOTH);
}
function bag(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#e8e8e0', '#dcdcd4', '#2a2a2c', '#c8281e', '#e8e8e0']);
  const F = S(DET.plastic, 0.22, 0);
  D.add('std', T.pillow(7, 4, 0.55), [0, 2.6 * s, 0], [4.8 * s, 3.1 * s, 4 * s], [0, r.range(0, 6), 0], col, { ...F, wobble: { amp: 0.2, seed: (r.next() * 100) | 0 } });
  D.add('std', T.pillow(6, 3, 0.55), [3.4 * s, 1.4, 1.4], [3 * s, 1.4, 2.4 * s], [0, r.range(0, 6), 0], col, { ...F, wobble: { amp: 0.25, seed: 3 } });
  D.box('std', -1 * s, 5.6 * s, 0, 0.5, 1.2, 2.6, col, [0, 0, 0.3], F);
}
function newsp(P) {
  const { D, s } = P;
  const r = D.rng;
  const cell = 'news' + Math.floor(r.next() * 6);
  sheet(D, cell, 0, 0.5, 0, 18 * s, 13 * s, r.range(0, 6), '#e8e4d8', [r.range(-0.06, 0.06), 0]);
  if (r.chance(0.6)) sheet(D, 'news' + Math.floor(r.next() * 6), r.range(-7, 7), 0.9, r.range(-5, 5), 17 * s, 12 * s, r.range(0, 6), '#dcd8cc', [r.range(-0.1, 0.1), 0]);
}

// ---- traffic and roadside safety -----------------------------------------------------------------

const CONE_S = S(DET.plastic, 0.5, 0);
function coneDown(P) {
  const { D, s } = P;
  const R = 6 * s;
  D.add('std', T.cyl(12, 0.18), [0, R * 0.95, 0], [R, R * 3, R], [0, D.rng.range(0, 6), Math.PI / 2], '#e8641c', { ...CONE_S, map: 'cyl' });
  D.add('std', T.cyl(12, 0.66), [0, R * 0.98, 0], [R * 0.55, R * 0.45, R * 0.55], [0, 0, Math.PI / 2], '#e8e8e0', { ...CONE_S, map: 'cyl' });
  D.rblock('std', -R * 1.6, 0, 0, 1.6, R * 2.1, R * 2.1, 0.4, '#1c1c1c', null, S(DET.rubber, 0.8, 0));
}
function coneUp(P) {
  const { D, s } = P;
  const R = 6 * s;
  D.rblock('std', 0, 0, 0, R * 2.1, 1.5, R * 2.1, 0.4, '#1c1c1c', null, S(DET.rubber, 0.8, 0));
  D.cyl('std', 0, 1.5, 0, R * 0.95, R * 3, '#e8641c', 12, 0.18, null, CONE_S);
  D.cyl('std', 0, R * 1.2, 0, R * 0.7, R * 0.45, '#e8e8e0', 12, 0.8, null, S(DET.plastic, 0.3, 0));
  D.cyl('std', 0, R * 2.0, 0, R * 0.46, R * 0.3, '#e8e8e0', 12, 0.75, null, S(DET.plastic, 0.3, 0));
}
function triangle(P) {
  const { D, s } = P;
  const h = 16 * s, half = 9.5 * s;
  const lean = D.rng.range(-0.15, 0.15);
  const P0 = [0, 5, -half], P1 = [0, 5, half], P2 = [lean, 5 + h, 0];
  for (const [a, b] of [[P0, P1], [P1, P2], [P2, P0]]) plank(D, 'std', a, b, 1.5, 1.2, '#c8281e', S(DET.plastic, 0.4, 0));
  const q0 = [0.15, 6.4, -half * 0.68], q1 = [0.15, 6.4, half * 0.68], q2 = [lean + 0.15, 5 + h * 0.72, 0];
  for (const [a, b] of [[q0, q1], [q1, q2], [q2, q0]]) plank(D, 'std', a, b, 1.9, 0.6, '#f2f0e6', S(DET.plastic, 0.25, 0));
  // stand legs
  rod(D, 'std', [0, 5, -half * 0.6], [-4, 0, -half * 0.9], 0.5, '#2a2a2c');
  rod(D, 'std', [0, 5, half * 0.6], [-4, 0, half * 0.9], 0.5, '#2a2a2c');
  rod(D, 'std', [0, 5, 0], [5, 0, 0], 0.5, '#2a2a2c');
}
function flare(P) {
  const { D, halos, it } = P;
  const r = D.rng;
  const ang = r.range(0, 6);
  D.add('std', T.cyl(8), [0, 0.9, 0], [0.9, 10, 0.9], [0, ang, Math.PI / 2], '#b81c1c', { ...S(DET.plastic, 0.6, 0), map: 'cyl' });
  D.add('std', T.cyl(8), [-3, 0.9, 0], [0.95, 2, 0.95], [0, ang, Math.PI / 2], '#e8d020', { ...S(0, 0.6, 0), map: 'cyl' });
  const tip = [Math.cos(ang) * 5.4, 1.2, -Math.sin(ang) * 5.4];
  D.add('glow', T.sphere(6, 4), tip, [1.4, 1.2, 1.4], null, '#ff5a3a', { emissive: 5, uv: atlasUV('white') });
  // a small hot core and the halo the world draws for it (flickers)
  D.add('glow', T.sphere(5, 3), [tip[0], 2.0, tip[2]], [0.8, 1.6, 0.8], null, '#ffd0a0', { emissive: 6, uv: atlasUV('white') });
  if (halos) {
    const c = Math.cos(it.a), sn = Math.sin(it.a);
    halos.push({ x: it.x + c * tip[0] - sn * tip[2], y: it.y + sn * tip[0] + c * tip[2], h: 4, color: '#ff3a1c', size: 56, flicker: 0.9, strength: 0.75 });
  }
  D.add('flat', T.plane(), [tip[0], 0.3, tip[2]], [30, 30, 1], [-Math.PI / 2, 0, 0], '#ff2a12', { uv: dressUV('f_stain'), noAO: true, noJitter: true });
}
function litter(P) {
  const { D } = P;
  const r = D.rng;
  const n = 3 + Math.floor(r.next() * 3);
  for (let i = 0; i < n; i++) {
    const x = r.range(-8, 8), z = r.range(-8, 8), t = r.next();
    if (t < 0.32) {
      D.add('std', T.cyl(6), [x, 1.6, z], [1.6, 4.2, 1.6], [0, r.range(0, 6), Math.PI / 2 + r.range(-0.3, 0.3)], r.pick(['#c0c4c8', '#b81c1c', '#1c4fa8', '#2a8a4a', '#c0c4c8']), { surf: [DET.panel, 0.3, 0.85], map: 'cyl' });
    } else if (t < 0.5) {
      D.add('std', T.cyl(6), [x, 1.5, z], [1.5, 6, 1.5], [0, r.range(0, 6), Math.PI / 2], r.pick(['#2a6a3a', '#4a2a1a', '#cfe0e8']), { surf: [DET.glass, 0.15, 0.1], map: 'cyl' });
    } else if (t < 0.7) {
      D.add('std', T.cyl(6, 0.7), [x, 1.8, z], [1.7, 3.6, 1.7], [0.2, 0, Math.PI / 2 + r.range(-0.6, 0.6)], r.pick(['#f0f0ea', '#c8281e']), { surf: [DET.plastic, 0.4, 0], map: 'cyl' });
    } else if (t < 0.9) {
      D.add('std', T.box(), [x, 0.6, z], [2.6, 0.7, 1.8], [0, r.range(0, 6), 0], r.pick(BRIGHT), CLOTH);
    } else {
      D.add('std', T.box(), [x, 0.6, z], [2.6, 1.2, 1.6], [0, r.range(0, 6), 0], '#d8d0b8', S(0, 0.7, 0));
    }
  }
}
function fuelCan(P) {
  const { D, s } = P;
  const col = D.rng.chance(0.7) ? '#b81c1c' : '#c8b020';
  const lay = D.rng.chance(0.25);
  const A = lay ? [0, D.rng.range(0, 6), 1.5] : [0, D.rng.range(0, 6), 0];
  const y = lay ? 2.2 : 0;
  const f = S(DET.panel, 0.42, 0.5);
  D.add('std', T.rbox(8 * s, 11 * s, 3.6 * s, 0.7), [0, y + 5.5 * s, 0], [1, 1, 1], A, col, f);
  D.add('std', T.cyl(8, 0.8), [2.4 * s, y + 12 * s, 0], [1.1, 2.4, 1.1], A, '#2a2a2c', f);
  D.add('std', T.torus(8, 0.12, 4), [-2 * s, y + 11.6 * s, 0], [1.9, 1.9, 1], A, shadeHex(col, -0.3), f);
  D.add('std', T.box(), [0, y + 5.5 * s, 1.85 * s], [6 * s, 0.25, 0.3], A, shadeHex(col, -0.4), f);
}
function clothes(P) {
  const { D, s } = P;
  const r = D.rng;
  const n = 2 + Math.floor(r.next() * 3);
  for (let i = 0; i < n; i++) {
    const col = r.pick(MUTED.concat(BRIGHT));
    D.add('std', T.pillow(8, 5, 0.5), [r.range(-5, 5), 0.9 + i * 0.7, r.range(-4, 4)], [r.range(4, 7) * s, 1.1, r.range(3, 5) * s], [0, r.range(0, 6), 0], col, CLOTH);
  }
  if (r.chance(0.6)) {   // a jacket with sleeves
    const col = r.pick(['#2f4858', '#6b2d2a', '#3b4a3a', '#c8b060']);
    D.add('std', T.pillow(8, 5, 0.5), [0, 2.4, 0], [4.2 * s, 1.2, 5 * s], [0, r.range(0, 6), 0], col, CLOTH);
    for (const sd of [-1, 1]) D.add('std', T.pillow(6, 4, 0.5), [1.6, 1.6, sd * 6.4 * s], [1.2, 0.8, 4 * s], [0, sd * 0.5, 0], col, CLOTH);
  }
}
function teddy(P) {
  const { D, s } = P;
  const r = D.rng;
  const col = r.pick(['#8a5a34', '#c8a070', '#d8c8b0', '#a06a8a']);
  const F = { surf: [DET.fabric, 0.95, 0] };
  const sit = r.chance(0.5);
  const A = sit ? [0, r.range(0, 6), 0] : [0, r.range(0, 6), 1.3];
  const y = sit ? 0 : 3.2;
  const w = (lx, ly, lz, sx, sy, sz) => D.add('std', T.ico(0), [lx, y + ly, lz], [sx * s, sy * s, sz * s], A, col, F);
  w(0, 3.6, 0, 3.6, 3.8, 3.2);               // body
  w(0.6, 7.6, 0, 2.7, 2.7, 2.6);             // head
  w(2.9, 7.2, 0, 1.1, 1, 1.3);               // muzzle
  for (const sd of [-1, 1]) {
    w(0.4, 9.6, sd * 2.1, 1, 1, 1);          // ears
    w(2.4, 4.8, sd * 3.6, 1.1, 2.2, 1.1);    // arms
    w(2.6, 1.2, sd * 2.2, 1.7, 1.2, 1.2);    // legs
  }
  D.add('std', T.sphere(5, 3), [y * 0 + 3.9 * s + (sit ? 0 : 0), y + 7.6, 0], [0.5, 0.5, 0.5], A, '#151515', F);
}
function toy(P) {
  const { D } = P;
  const r = D.rng;
  const t = r.next();
  if (t < 0.4) {
    const col = r.pick(BRIGHT);
    D.rblock('std', 0, 1.4, 0, 8, 2.6, 4, 0.8, col, [0, r.range(0, 6), 0], PLASTIC);
    D.rblock('std', -0.6, 4, 0, 4.4, 1.8, 3.4, 0.6, shadeHex(col, 0.2), [0, 0, 0], PLASTIC);
    for (const x of [-2.6, 2.6]) for (const z of [-2.2, 2.2]) D.cylZ('std', x, 1.1, z, 1.1, 0.8, '#161616', 8);
  } else if (t < 0.7) {
    D.add('std', T.sphere(10, 7), [0, 3.6, 0], [3.6, 3.6, 3.6], null, r.pick(BRIGHT), S(DET.plastic, 0.35, 0));
    D.add('std', T.torus(12, 0.06, 4), [0, 3.6, 0], [3.65, 3.65, 3.65], [1.5, 0.4, 0], '#f0f0ea', S(DET.plastic, 0.35, 0));
  } else {
    for (let i = 0; i < 4; i++) D.rblock('std', r.range(-4, 4), i > 2 ? 3 : 0, r.range(-3, 3), 3, 3, 3, 0.4, r.pick(BRIGHT), [0, r.range(0, 6), 0], S(DET.wood, 0.6, 0));
  }
}
function spill(P) {
  const { D, s } = P;
  const r = D.rng;
  const kind = r.pick(['oranges', 'cans', 'boxes', 'paper']);
  const n = 10 + Math.floor(r.next() * 8);
  D.add('flat', T.plane(), [0, 0.24, 0], [46 * s, 34 * s, 1], [-Math.PI / 2, 0, r.range(0, 6)], '#0c0a08', { uv: dressUV('f_stain'), noAO: true, noJitter: true });
  cardboardBox(D, -8, 0, -6, 15, 10, 12, r.range(-0.6, 0.6), 'box_plain');
  D.add('std', T.rbox(15, 10, 12, 0.5), [10, 5, 8], [1, 1, 1], [0.5, r.range(0, 6), 0.2], '#a98552', { surf: [DET.wood, 0.9, 0] });   // a crushed carton
  for (let i = 0; i < n; i++) {
    const x = r.range(-22, 22) * s, z = r.range(-16, 16) * s;
    if (kind === 'oranges') D.add('std', T.sphere(7, 5), [x, 1.9, z], [1.9, 1.9, 1.9], null, r.pick(['#e8801c', '#d8701c', '#f09a2a']), S(DET.plastic, 0.5, 0));
    else if (kind === 'cans') D.add('std', T.cyl(8), [x, 1.7, z], [1.7, 4.4, 1.7], [0, r.range(0, 6), Math.PI / 2], r.pick(['#c0c4c8', '#b81c1c', '#2a8a4a']), { surf: [DET.panel, 0.3, 0.85], map: 'cyl' });
    else if (kind === 'boxes') D.add('std', T.rbox(6, 4, 5, 0.4), [x, 2, z], [1, 1, 1], [0, r.range(0, 6), 0], r.pick(CARDBOARD), { surf: [DET.wood, 0.9, 0] });
    else D.add('std', T.cyl(10), [x, 2.6, z], [2.6, 5, 2.6], [r.range(0, 1.3), 0, r.range(0, 1.3)], '#e8e6dc', { surf: [DET.fabric, 0.9, 0], map: 'cyl' });
  }
}

export const DEBRIS = {
  suitcase, duffel, backpack, shoe, shoes, car_door: carDoor, box, box_stack: boxStack, box_open: boxOpen, bag, newsp,
  cone_dn: coneDown, cone_up: coneUp, triangle, flare, litter, fuel_can: fuelCan, hubcap, bumper, panel, clothes, teddy, toy,
  spill, wheel_loose: wheelLoose,
};
void pic; void mixHex; void CANVAS; void range;
