// Blackwater Dam's smaller set pieces: the fallen highway bridge in the river (both abutments, the piers,
// the spans down in the water), the dock and the fishing boat, the Blackwater Depot gate at the east end,
// the stair shafts' glue, the road signs and the storytelling marks (map.levelArt.marks).

import { DAM, DAM_Z } from '../../shared/levels/dam.js';
import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, WOOD, COL, at, pic, postSign, signBoard, quad4, rod, railing, lampGlow, shadeHex, hash01, atlasUV,
} from './dam-kit.js';

const WATER_Y = -16;

/** The fallen highway bridge between the two 'bridgeout' marks (west bank → east bank). */
export function bridgeRuin(P, marks) {
  const { B, gy, halos } = P;
  const ends = marks.filter((m) => m.t === 'bridgeout');
  if (ends.length < 2) return;
  const [wA, eA] = ends[0].x < ends[1].x ? ends : [ends[1], ends[0]];
  const dx = eA.x - wA.x, dy = eA.y - wA.y, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  const Wd = 200, deck = 0;
  const pt = (t) => [wA.x + dx * t, wA.y + dy * t];
  // abutments: the road ends at a broken lip with rebar sticking out
  for (const [t, dir] of [[0, 1], [1, -1]]) {
    const [x, y] = pt(t);
    at(B, gy, x, y, 0, a, 700 + t);
    B.block('std', dir * 20, -120, 0, 60, 120, Wd + 40, COL.concD, null, CONC);
    B.box('std', dir * 60, -4, 0, 60, 8, Wd, '#5a5a58', [0, 0, -dir * 0.1], CONC);
    for (let k = 0; k < 9; k++) rod(B, 'std', [dir * 88, -2, -Wd / 2 + 12 + k * 22], [dir * (104 + hash01(k) * 20), 4 + hash01(k * 3) * 12, -Wd / 2 + 12 + k * 22 + 4], 0.8, '#5a3a2a', RUST, 4);
    for (const s of [-1, 1]) B.box('std', dir * 50, 14, s * (Wd / 2 - 4), 80, 28, 8, COL.conc, null, CONC);
  }
  // two piers in the river
  for (const t of [0.34, 0.67]) {
    const [x, y] = pt(t);
    at(B, gy, x, y, WATER_Y - 40, a, 710 + t * 10);
    B.block('std', 0, 0, 0, 50, 70, Wd + 20, COL.concD, null, CONC);
    B.block('std', 0, 70, 0, 60, 14, Wd + 40, COL.conc, null, CONC);
    B.box('std', 0, 26, 0, 51, 16, Wd + 21, '#46473c', null, CONC);
  }
  // spans: the west one down in the water at an angle, the middle one hanging from the east pier into
  // the river, the east one still standing on its pier and abutment
  const span = (t0, t1, h0, h1, roll, seed) => {
    const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, len = Math.hypot(x1 - x0, y1 - y0);
    at(B, gy, cx, cy, 0, a, seed);
    const pitch = Math.atan2(h1 - h0, len);
    B.add('std', T.box(), [0, (h0 + h1) / 2 - 10, 0], [len, 18, Wd], [roll, 0, pitch], '#8a867c', CONC);
    B.add('std', T.box(), [0, (h0 + h1) / 2 + 0.2, 0], [len - 4, 1.2, Wd - 12], [roll, 0, pitch], '#3a3a3c', S(DET.asphalt, 0.8, 0));
    for (const s of [-1, 1]) B.add('std', T.box(), [0, (h0 + h1) / 2 + 12, s * (Wd / 2 - 4)], [len, 24, 8], [roll, 0, pitch], COL.conc, CONC);
    for (const s of [-0.6, 0.6]) B.add('std', T.box(), [0, (h0 + h1) / 2 - 36, s * Wd / 2], [len, 40, 14], [roll, 0, pitch], '#6a6e70', RUST);
  };
  span(0.02, 0.34, -60, WATER_Y + 10, 0.12, 720);
  span(0.34, 0.67, WATER_Y - 20, 44, -0.08, 721);
  span(0.67, 0.99, 64, 64, 0, 722);
  // a car that went over the edge, nose down in the water by the west pier
  const [cx, cy] = pt(0.2);
  at(B, gy, cx + 40, cy - 60, WATER_Y - 10, a + 0.5, 730);
  B.add('std', T.box(), [0, 10, 0], [84, 30, 42], [0, 0, -0.9], '#6b2d2a', S(DET.panel, 0.5, 0.4));
  // the flares and a warning light on each barricade
  for (const e of [wA, eA]) {
    const dir = e === wA ? -1 : 1;
    const [x, y] = [e.x + Math.cos(a) * dir * 140, e.y + Math.sin(a) * dir * 140];
    at(B, gy, x, y, 0, a + Math.PI / 2, 740);
    postSign(B, 'bridgeout', 0, 0, 44, 30, e === wA ? -Math.PI / 2 : Math.PI / 2);
    lampGlow(B, halos, 0, 82, 0, x, y, '#ffaa20', { size: [4, 4, 4], k: 5, halo: 60, strength: 0.6, flicker: 0.5, y0: 0, shape: 'sphere' });
  }
}

/** The dock (planks on piles over the water) and the boat moored beside it. */
export function dockAndBoat(P, marks) {
  const { B, gy, halos } = P;
  for (const m of marks) {
    if (m.t === 'dock') {
      at(B, gy, m.x, m.y, 0, m.a, 760);
      const Lh = m.l / 2, Wh = m.w / 2;
      for (let x = -Lh + 6; x < Lh; x += 12) B.box('std', x, -1.5, 0, 11, 3, m.w, hash01(x) < 0.5 ? '#6a5238' : '#5a4630', null, WOOD);
      for (let x = -Lh + 20; x < Lh; x += 50) for (const s of [-1, 1]) B.cyl('std', x, WATER_Y - 40, s * (Wh - 4), 4, 44, '#4a3a28', 8, 1, null, WOOD);
      // a lamp post at the end, a life ring, a cleat
      B.cyl('std', Lh - 10, 0, -Wh + 8, 1.6, 90, '#3a3c3e', 8, 1, null, STEEL);
      lampGlow(B, halos, Lh - 10, 92, -Wh + 8, m.x, m.y + 90, '#ffcf8a', { size: [5, 5, 5], k: 3, halo: 70, strength: 0.5, flicker: 0.3, y0: 0, shape: 'sphere' });
      B.add('std', T.torus(12, 0.3, 6), [0, 20, -Wh - 1], [7, 7, 7], null, '#e84a2a', S(DET.plastic, 0.5, 0));
    } else if (m.t === 'boat') {
      // an aluminium fishing boat with an outboard, bobbing low in the water (a little listed)
      at(B, gy, m.x, m.y, WATER_Y - 4, m.a, 770);
      const hull = [[-60, 12], [-62, 2], [-50, -6], [40, -6], [62, 6], [66, 14]];
      B.prism('std', 'c3boat', hull, 0, 44, '#9aa0a4', S(DET.panel, 0.4, 0.6));
      B.box('std', -10, 10, 0, 100, 2, 38, '#6a7074', null, STEEL);
      for (const x of [-30, 10]) B.box('std', x, 11, 0, 8, 2, 40, '#8a6a44', null, WOOD);
      B.rblock('std', -64, 8, 0, 12, 22, 12, 2, '#2a2a2c', null, PAINTED);
      rod(B, 'std', [-64, 8, 0], [-66, -14, 0], 1.6, '#2a2a2c', STEEL, 5);
      B.box('std', 40, 13, 10, 12, 8, 10, '#c83a2a', [0, 0.3, 0], S(DET.plastic, 0.5, 0));
      rod(B, 'std', [60, 14, 0], [-80, 30, -30], 0.3, '#d8d0b0', S(DET.fabric, 0.9, 0), 3);
    }
  }
}

/** The Blackwater Depot gate at the east edge: a steel gantry with the sign, the closed gate, floods, a tower. */
export function depotGate(P, m) {
  const { B, gy, halos } = P;
  at(B, gy, m.x, m.y, 0, 0, 780);
  const span = 260;
  // posts and the gantry across the road
  for (const s of [-1, 1]) {
    B.rblock('std', 0, 0, s * span / 2, 26, 200, 26, 2, '#4a4e52', null, STEEL);
    B.block('std', 0, 0, s * span / 2, 40, 12, 40, COL.concD, null, CONC);
  }
  B.box('std', 0, 204, 0, 30, 18, span + 40, '#4a4e52', null, STEEL);
  signBoard(B, 'depot', -18, 236, 0, 46, -Math.PI / 2, { depth: 6 });
  // the gate: two leaves of steel sheet with a rail-yard look, chained
  for (const s of [-1, 1]) {
    B.box('std', -4, 70, s * span / 4, 6, 130, span / 2 - 6, '#5a3a2a', null, RUST);
    for (let k = 0; k < 4; k++) B.box('std', -8, 20 + k * 34, s * span / 4, 2, 4, span / 2 - 10, '#3a2a20', null, RUST);
  }
  B.cylX('std', -8, 80, 0, 3, 8, '#8a8e92', 8, STEEL);
  pic(B, 'd_graf1', -8.5, 80, span / 4, 30, -Math.PI / 2);
  // floodlights on the posts (on at night) and a lookout tower behind the gate
  for (const s of [-1, 1]) {
    B.rbox('std', -10, 200, s * (span / 2 + 20), 16, 12, 16, 2, '#2a2c2e', null, STEEL);
    lampGlow(B, halos, -18.5, 200, s * (span / 2 + 20), m.x - 18, m.y + s * (span / 2 + 20), '#f4f0e0', { size: [1, 9, 12], k: P.day ? 1 : 4.5, halo: 120, strength: 0.7, y0: 0 });
  }
  at(B, gy, m.x + 60, m.y - 220, 0, 0, 781);
  for (const [x, z] of [[-24, -24], [24, -24], [24, 24], [-24, 24]]) rod(B, 'std', [x, 0, z], [x * 0.8, 200, z * 0.8], 3, '#4a3a2a', WOOD, 6);
  B.box('std', 0, 200, 0, 60, 6, 60, '#5a4630', null, WOOD);
  B.box('std', 0, 222, 0, 56, 40, 56, '#6a5238', null, WOOD);
  B.add('std', T.box(), [0, 250, 0], [72, 4, 72], [0.1, 0, 0], '#4a4e52', S(DET.metalroof, 0.6, 0.4));
}

/** The road signs and wall pictures of the route (hand placed). */
export function signage(P) {
  const { B, gy } = P;
  const put = (cell, x, y, h, y0, ry) => { at(B, gy, x, y, 0, 0, Math.round(x + y)); postSign(B, cell, 0, 0, h, y0, ry); };
  // the canyon road: the green highway sign after the tunnel, the bridge warnings, the detour to the dam
  put('hwy', 1250, 3200, 60, 80, Math.PI / 2);
  put('bridgeout', 2750, 2860, 40, 40, Math.PI / 2);
  put('detour', 3300, 2760, 34, 44, Math.PI / 2);
  put('damroad', 3660, 2760, 30, 50, -Math.PI / 2);
  put('deep', 4620, 3100, 30, 40, Math.PI / 2);
  // the spillway yard
  put('danger_spill', 4600, 2000, 44, 30, Math.PI / 2);
  put('hardhat', 3900, 2600, 22, 50, Math.PI);
  put('deep', 4640, 1420, 30, 36, Math.PI / 2);
  // the village
  put('welcome', 7560, 2600, 44, 40, Math.PI / 2);
  put('trespass', 7300, 2230, 30, 40, 0);
  // the dam face's gallery landing and the turbine yard
  put('hv', 6600, 2030, 22, 40, Math.PI);
  put('hv', 7250, 2020, 22, 40, Math.PI);
}
