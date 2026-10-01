// Fort Harlan's flight line: the three arched hangars (their door leaves are the layout's wall pieces),
// the fuel depot, the control tower (the base's stair and radio room, the shaft and the glass cab with
// its beacon), the crash-rescue station, the motor pool's shelter, and the runway's furniture: edge and
// threshold lights, the numbers, the approach lights marching off past the end of the map, the PAPI,
// the glide slope shelter, the windsock and the flare path.

import { BASE } from '../../shared/levels/airbase.js';
import { LOOK, doorHead } from './airbase-build.js';
import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, PLASTER, COL, at, pic, flatPic, rod, lampGlow, shadeHex, hash01,
} from './dam-kit.js';

const HALF = Math.PI / 2;
const CLAD = S(DET.corrugated, 0.55, 0.45);
const LINO = S(DET.linoleum, 0.55, 0);
const TERR = S(DET.terrazzo, 0.45, 0);

/** Eave height, door height and vault rise of a hangar. */
export function hangarDims(h) {
  return h.n === 2 ? { Hs: 340, doorH: 330, rise: 220 } : { Hs: 240, doorH: 230, rise: 140 };
}

// ---- the hangars ------------------------------------------------------------------------------------------------

/** One hangar (roof style 'hangar'): the gables, the side walls, the vault with skylights, ribs, lamps, floor. */
export function hangar(P, h) {
  const { B, gy, halos, tier, day } = P;
  const W = h.x1 - h.x0, D = h.y1 - h.y0;
  const cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
  const { Hs, doorH, rise } = hangarDims(h);
  const n = tier === 'low' ? 12 : 20;
  const clad = h.n === 3 ? '#5e6a62' : '#56605a', inner = '#b8b8ac';
  const arc = (a, k = 1) => [Math.cos(a) * (W / 2) * k, Hs + Math.sin(a) * rise * k];
  at(B, gy, cx, cy, 0, 0, 8001 + h.n);
  // the side walls: a concrete plinth, cladding outside, a lined inside, a band of translucent panels
  for (const s of [-1, 1]) {
    const x = s * (W / 2);
    B.block('std', x, 0, 0, 26, 30, D, COL.concD, null, CONC);
    B.block('std', x + s * 4, 30, 0, 4, Hs - 30, D, clad, null, CLAD);
    B.block('std', x - s * 6, 30, 0, 2, Hs - 90, D - 20, inner, null, S(DET.panel, 0.7, 0.2));
    B.box('vglass', x + s * 4.5, Hs - 40, 0, 1, 36, D - 40, '#c8d2d4');
  }
  // the vault: cladding outside and a lining inside, two skylight strips near the crown
  const skylit = (k) => k === Math.floor(n * 0.35) || k === Math.ceil(n * 0.65) - 1;
  const seg = (a0, a1, k, zc, depth, th, col, bucket, surf) => {
    const [x0, y0] = arc(a0, k), [x1, y1] = arc(a1, k);
    B.add(bucket, T.box(), [(x0 + x1) / 2, (y0 + y1) / 2, zc], [Math.hypot(x1 - x0, y1 - y0) + 1, th, depth], [0, 0, Math.atan2(y1 - y0, x1 - x0)], col, surf);
  };
  for (let k = 0; k < n; k++) {
    const a0 = Math.PI * (k / n), a1 = Math.PI * ((k + 1) / n);
    if (skylit(k)) seg(a0, a1, 1, 0, D + 20, 1, '#c8d6dc', 'vglass');
    else {
      seg(a0, a1, 1, 0, D + 20, 3, clad, 'std', CLAD);
      seg(a0, a1, 0.985, 0, D - 4, 1, inner, 'std', S(DET.panel, 0.7, 0.2));
    }
  }
  // steel arch ribs every bay, purlins along the vault, tie rods
  for (let z = -D / 2 + 50; z < D / 2 - 20; z += 100) {
    for (let k = 0; k < n; k++) seg(Math.PI * (k / n), Math.PI * ((k + 1) / n), 0.965, z, 6, 10, '#4a4e52', 'std', STEEL);
    for (const s of [-1, 1]) B.box('std', s * (W / 2 - 10), Hs / 2, z, 8, Hs, 10, '#4a4e52', null, STEEL);
    if (tier !== 'low') rod(B, 'std', [-W / 2 + 10, Hs, z], [W / 2 - 10, Hs, z], 1.2, '#3a3e42', STEEL, 4);
  }
  // the gables: the back one closed, the front one above the doors (the leaves are the wall pieces)
  const vault = [];
  for (let k = 0; k <= 18; k++) vault.push(arc(Math.PI * (k / 18)));
  B.add('std', T.profile('c3hangarB' + h.n, [[-W / 2, 0], [W / 2, 0], ...vault], 0, 1), [0, 0, -D / 2], [1, 1, 18], null, clad, CLAD);
  B.add('std', T.profile('c3hangarF' + h.n, [[-W / 2, doorH], [W / 2, doorH], ...vault], 0, 1), [0, 0, D / 2], [1, 1, 18], null, clad, CLAD);
  B.box('std', 0, doorH + 6, D / 2 + 10, W + 8, 12, 8, '#3a3e3a', null, STEEL);
  pic(B, 'hangar' + h.n, -W * 0.22, doorH + (Hs + rise - doorH) * 0.45, D / 2 + 10, Math.min(110, (Hs + rise - doorH) * 0.7), 0);
  pic(B, 'usarmy', W * 0.18, doorH + 40, D / 2 + 10, 22, 0, { w: 150 });
  pic(B, 'd_streak', W * 0.32, doorH + 60, D / 2 + 9.8, 120, 0, { w: 40 });
  // the floor: sealed concrete, painted bay lines, oil
  B.box('std', 0, 0.4, 0, W - 30, 0.8, D - 30, '#7a7a74', null, { ...S(DET.slab, 0.6, 0), noJitter: true });
  for (const s of [-1, 1]) B.box('std', s * (W / 2 - 70), 0.9, 0, 8, 0.4, D - 80, '#c8a020', null, PAINTED);
  B.box('std', 0, 0.9, D / 2 - 40, W - 140, 0.4, 8, '#c8a020', null, PAINTED);
  flatPic(B, 'd_soot', -W * 0.15, 1.1, -D * 0.1, 120, 90, 0.4);
  flatPic(B, 'd_blood1', W * 0.2, 1.1, D * 0.2, 60, 60, 1.1);
  // high-bay lamps over the floor (and their cones at night)
  for (let x = -W / 2 + 150; x < W / 2 - 100; x += 300) {
    for (const z of [-D / 4, D / 4]) {
      const y = Hs + rise * Math.sqrt(Math.max(0, 1 - (x / (W / 2)) ** 2)) * 0.9 - 20;
      rod(B, 'std', [x, y + 20, z], [x, y, z], 0.6, '#1a1a1a', STEEL, 4);
      B.add('std', T.cyl(12, 0.35, true), [x, y - 6, z], [16, 14, 16], [Math.PI, 0, 0], '#4a4e52', STEEL);
      const flick = hash01(h.n * 31 + x + z) < 0.2 ? 0.4 : 0;
      lampGlow(B, halos, x, y - 12, z, cx + x, cy + z, '#ffd6a0', { size: [18, 1.5, 18], k: day ? 1.2 : 3.4, halo: 150, strength: 0.6, flicker: flick, y0: 0 });
      if (!day && P.shafts) P.shafts.push({ x: cx + x, y: cy + z, h: y - 12, base: 0, abs: true, color: '#ffd6a0', radius: 170, strength: 0.45 });
    }
  }
  // an exterior floodlight over the door
  lampGlow(B, halos, 0, doorH + 20, D / 2 + 20, cx, h.y1 + 20, '#eef4ff', { size: [24, 4, 6], k: day ? 0.4 : 4, halo: day ? 0 : 160, strength: 0.7, y0: 0 });
}

/** A hangar's door leaves (style 'hdoor', a wall piece beside the opening): telescoping leaves. */
export function hangarDoor(P, o) {
  const { B } = P;
  const h = BASE.hangars.find((q) => String(q.n) === o.label) || BASE.hangars[0];
  const { doorH } = hangarDims(h);
  const L = o.w;
  const leaves = Math.max(1, Math.round(L / 140));
  const lw = L / leaves;
  for (let k = 0; k < leaves; k++) {
    const x = -L / 2 + (k + 0.5) * lw, z = (k % 2 ? -5 : 5);
    B.block('std', x, 2, z, lw + 6, doorH - 4, 5, k % 2 ? '#5e6862' : '#56605a', null, CLAD);
    B.box('std', x, doorH * 0.82, z + (z > 0 ? 3 : -3), lw - 20, 22, 1, '#c8d2d4', null, S(DET.glass, 0.2, 0.2));
    for (const s of [-1, 1]) B.box('std', x + s * (lw / 2 - 1), doorH / 2, z + (z > 0 ? 3 : -3), 3, doorH - 6, 2, '#3a3e3a', null, STEEL);
    B.cylZ('std', x - lw / 3, 4, z, 4, 6, '#2a2a2a', 8, STEEL);
    B.cylZ('std', x + lw / 3, 4, z, 4, 6, '#2a2a2a', 8, STEEL);
  }
  B.box('std', 0, 1, 0, L, 2, 20, '#3a3e3a', null, STEEL);
  pic(B, 'hazard', 0, 14, 8.2, 8, 0, { w: L - 10 });
  if (L > 200) pic(B, 'd_graf' + (1 + (o.id % 3)), 0, 90, 8.3, 30, 0);
  return true;
}

// ---- the fuel depot ------------------------------------------------------------------------------------------------

/** The fuel depot's pieces: the bund wall, the tanks, the pump house, the pump stands. */
export function fuelPiece(P, o) {
  const { B, halos, tier } = P;
  switch (o.style) {
    case 'bund': {
      const along = o.w >= o.h, L = along ? o.w : o.h, t = along ? o.h : o.w;
      if (!along) B.obj(o.x, o.y, (o.a || 0) + HALF, o.id * 31);
      B.block('std', 0, 0, 0, L, 40, t, '#9a968c', null, CONC);
      B.block('std', 0, 40, 0, L + 2, 4, t + 4, '#8a867c', null, CONC);
      if (L > 300) pic(B, 'fuel', 0, 22, t / 2 + 0.4, 18, 0);
      return true;
    }
    case 'fueltank': {
      const R = o.w / 2 - 6, H = 170;
      const seg = tier === 'low' ? 16 : 32;
      B.cyl('std', 0, 0, 0, R + 4, 6, COL.concD, seg, 1, null, CONC);
      B.cyl('std', 0, 6, 0, R, H, '#c8ccc8', seg, 1, null, S(DET.panel, 0.45, 0.4));
      for (let y = 40; y < H; y += 44) B.cyl('std', 0, y, 0, R + 0.6, 2, '#a8aca8', seg, 1, null, STEEL);
      B.cyl('std', 0, H + 6, 0, R + 2, 26, '#b8bcb8', seg, 0.15, null, S(DET.panel, 0.45, 0.4));
      // the spiral stair and its rail, a gauge board, the placards and a long rust run
      for (let k = 0; k < 18; k++) {
        const a = -0.3 + k * 0.16, y = 10 + k * 9.4;
        B.box('std', Math.cos(a) * (R + 9), y, Math.sin(a) * (R + 9), 16, 2, 10, '#5a5e62', [0, -a, 0], STEEL);
      }
      for (let k = 0; k < 18; k += 2) {
        const a = -0.3 + k * 0.16;
        rod(B, 'std', [Math.cos(a) * (R + 16), 10 + k * 9.4, Math.sin(a) * (R + 16)], [Math.cos(a) * (R + 16), 46 + k * 9.4, Math.sin(a) * (R + 16)], 0.6, COL.yellow, PAINTED, 4);
      }
      pic(B, 'fuel', 0, 90, R + 0.8, 34, 0);
      pic(B, 'd_rust', -40, 120, R + 0.6, 90, 0, { w: 24 });
      B.box('std', -R * 0.7, 80, -R * 0.72, 4, 140, 4, '#3a3e42', [0, 0.8, 0], STEEL);
      return true;
    }
    case 'pumphouse': {
      B.block('std', 0, 0, 0, o.w, 70, o.h, '#b8b2a4', null, CONC);
      B.block('std', 0, 70, 0, o.w + 10, 5, o.h + 10, '#5a5e58', null, S(DET.metalroof, 0.6, 0.4));
      B.box('std', 0, 34, o.h / 2 + 0.6, 30, 60, 1, '#4a5a5a', null, PAINTED);
      for (const s of [-1, 1]) B.cylX('std', s * (o.w / 2 + 40), 20, s * 10, 5, 80, '#8a6a3a', 10, RUST);
      pic(B, 'hv', 0, 54, o.h / 2 + 1.2, 18, 0);
      lampGlow(B, halos, 0, 64, o.h / 2 + 4, o.x, o.y + o.h / 2 + 4, '#ffd9a0', { size: [6, 3, 3], k: P.day ? 0.3 : 3, halo: 60, strength: 0.4, flicker: 0.2, y0: 0 });
      return true;
    }
    case 'fuelpump': {
      B.rblock('std', 0, 0, 0, o.w, 60, o.h, 2, '#c8c4b8', null, PAINTED);
      B.box('std', 0, 44, o.h / 2 + 0.4, o.w - 12, 12, 0.6, '#2a2e2e', null, STEEL);
      pic(B, 'e_crt2', 0, 44, o.h / 2 + 0.8, 10, 0, { w: 16 });
      B.cylX('std', o.w / 2 + 6, 30, 0, 12, 8, '#2a2a2a', 12, S(DET.rubber, 0.9, 0));
      rod(B, 'std', [o.w / 2 + 6, 18, 6], [o.w / 2 + 40, 1, 30], 1.4, '#1a1a1a', S(DET.rubber, 0.9, 0), 5);
      pic(B, 'fuel', 0, 24, o.h / 2 + 0.5, 14, 0);
      return true;
    }
    default: return false;
  }
}

// ---- the control tower -------------------------------------------------------------------------------------------------

/**
 * The tower (roof style 'towerbase'): the lobby's floor and ceiling, the stair, the radio room's floor and
 * ceiling, the base's roof, the shaft and the glass cab on top with its catwalk, antennas and beacon.
 */
export function tower(P, r) {
  const { B, gy, halos, tier, day } = P;
  const Tw = BASE.tower, st = Tw.stair, f = Tw.floor;
  const cx = (Tw.x0 + Tw.x1) / 2, cy = (Tw.y0 + Tw.y1) / 2;
  const w = Tw.x1 - Tw.x0, d = Tw.y1 - Tw.y0, H = 250;
  void r;
  // the lobby (ground) and its terrazzo floor, the radio room's slab on its floor plateau
  at(B, gy, (Tw.x0 + st.x1) / 2, (st.y1 + Tw.y1) / 2, 0, 0, 8101);
  B.box('std', 0, 0.6, 0, st.x1 - Tw.x0 - 20, 1.2, Tw.y1 - st.y1 - 20, '#6e7468', null, { ...TERR, noJitter: true });
  pic(B, 'd_drag', 0, 1.4, 20, 40, 0, { rx: -HALF, rz: 0.4, w: 120 });
  at(B, gy, (st.x1 + Tw.x1 - 10) / 2, cy, 0, 0, 8102);
  const rw = Tw.x1 - 10 - st.x1, rd = d - 20;
  B.block('std', 0, f - 10, 0, rw, 10.6, rd, '#6a6e62', null, { ...LINO, noJitter: true });
  // the stair: concrete treads with steel nosings, the wall string on the north side
  const n = Math.max(1, Math.ceil(f / 11.5)), run = (st.x1 - st.x0) / n, rise = f / n;
  at(B, gy, st.x0, (st.y0 + st.y1) / 2, 0, 0, 8103);
  for (let k = 0; k < n; k++) {
    B.block('std', run * (k + 0.5), 0, 0, run + 0.4, rise * (k + 1), st.y1 - st.y0, '#8a867c', null, CONC);
    B.box('std', run * k + 1, rise * (k + 1) - 0.5, 0, 2, 1.2, st.y1 - st.y0 - 2, '#c8a020', null, STEEL);
  }
  rod(B, 'std', [0, 40, -(st.y1 - st.y0) / 2 + 4], [st.x1 - st.x0, f + 40, -(st.y1 - st.y0) / 2 + 4], 1.2, '#3a4a5a', PAINTED, 6);
  pic(B, 'stairs', 40, 150, (st.y1 - st.y0) / 2 + 6, 18, 0);
  // ceilings: one tiled ceiling at H over the whole base, its lamps (the lobby's and the radio room's)
  at(B, gy, cx, cy, 0, 0, 8104);
  const nx = Math.round((w - 20) / 40), nz = Math.round((d - 20) / 40);
  B.box('std', 0, H + 22, 0, w - 20, 2, d - 20, '#1c1c1c', null, CONC);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (hash01(i * 31 + j * 7 + 8104) < 0.06) continue;
    B.box('std', -(w - 20) / 2 + (i + 0.5) * ((w - 20) / nx), H - 2, -(d - 20) / 2 + (j + 0.5) * ((d - 20) / nz), (w - 20) / nx - 1.2, 1.2, (d - 20) / nz - 1.2, '#d6d2c6', null, S(DET.ceiltile, 0.95, 0));
  }
  for (const [x, z, lit] of [[-140, 60, true], [-140, -60, false], [80, -80, true], [80, 80, true]]) {
    B.box('std', x, H - 4, z, 50, 2.4, 9, '#c8ccd0', null, PAINTED);
    if (lit) lampGlow(B, halos, x, H - 5.4, z, cx + x, cy + z, x > 0 ? '#e8fff0' : '#fff0d8', { size: [44, 1.2, 6], k: day ? 1.2 : 3, halo: 70, strength: 0.4, flicker: x < 0 ? 0.3 : 0.08, y0: 0 });
  }
  // the base's roof and the shaft rising from it to the cab
  B.block('std', 0, H + 24, 0, w + 6, 10, d + 6, '#7a766c', null, CONC);
  for (const s of [-1, 1]) {
    B.block('std', 0, H + 34, s * (d / 2 + 1), w + 8, 16, 6, '#b2ada2', null, CONC);
    B.block('std', s * (w / 2 + 1), H + 34, 0, 6, 16, d, '#b2ada2', null, CONC);
  }
  const sx = 8730 - cx, sz = 1580 - cy, S0 = H + 34, top = 600;
  B.block('std', sx, S0, sz, 150, top - S0, 150, '#b8b3a8', null, { ...CONC, noJitter: true });
  for (let y = S0 + 40; y < top - 40; y += 70) for (const s of [-1, 1]) B.box('glass', sx + s * 75.4, y, sz, 0.6, 40, 12, '#141c22');
  for (let y = S0 + 60; y < top; y += 100) B.box('std', sx, y, sz, 154, 4, 154, '#9a968c', null, CONC);
  pic(B, 'd_streak', sx, top - 120, sz + 75.4, 160, 0, { w: 60 });
  // the cab: an octagon that leans out, a floor slab with a catwalk, its roof, antennas, the beacon
  const Rf = 112, Rt = 128, ch = 84, nseg = 8;
  at(B, gy, 8730, 1580, top, 0, 8105);
  B.cyl('std', 0, -12, 0, Rf + 22, 12, '#8a867c', nseg, 1, [0, Math.PI / 8, 0], CONC);
  for (let k = 0; k < nseg; k++) {
    const a0 = (k / nseg) * Math.PI * 2 + Math.PI / 8, a1 = ((k + 1) / nseg) * Math.PI * 2 + Math.PI / 8, am = (a0 + a1) / 2;
    // a slanted pane between mullions (outward lean), lit green from the consoles at night
    const p0 = [Math.cos(am) * Rf, 0, Math.sin(am) * Rf], p1 = [Math.cos(am) * Rt, ch, Math.sin(am) * Rt];
    const wseg = 2 * Rf * Math.sin(Math.PI / nseg) + 4;
    const lean = Math.atan2(Rt - Rf, ch);
    B.add('vglass', T.box(), [(p0[0] + p1[0]) / 2, ch / 2 + 6, (p0[2] + p1[2]) / 2], [wseg, ch - 10, 0.8], [lean, -am + HALF, 0], '#28403a');
    B.add('std', T.box(), [Math.cos(a0) * (Rf + Rt) / 2, ch / 2, Math.sin(a0) * (Rf + Rt) / 2], [4, ch + 4, 4], [0, -a0, lean], '#2a2e2e', STEEL);
    B.add('std', T.box(), [Math.cos(am) * (Rf + 4), 4, Math.sin(am) * (Rf + 4)], [wseg, 8, 10], [0, -am + HALF, 0], '#3a3e3e', STEEL);
    // the catwalk's rail
    rod(B, 'std', [Math.cos(a0) * (Rf + 20), 34, Math.sin(a0) * (Rf + 20)], [Math.cos(a1) * (Rf + 20), 34, Math.sin(a1) * (Rf + 20)], 0.9, '#c8c8c0', PAINTED, 4);
    B.cyl('std', Math.cos(a0) * (Rf + 20), 0, Math.sin(a0) * (Rf + 20), 0.9, 34, '#c8c8c0', 4, 1, null, PAINTED);
  }
  B.cyl('std', 0, ch, 0, Rt + 10, 8, '#3a3e3e', nseg, 1, [0, Math.PI / 8, 0], STEEL);
  B.cyl('std', 0, ch + 8, 0, Rt - 10, 16, '#4a4e4e', nseg, 0.8, [0, Math.PI / 8, 0], STEEL);
  // inside the cab: consoles all round, glowing screens, a dark figure slumped at one
  for (let k = 0; k < nseg; k++) {
    const a = (k / nseg) * Math.PI * 2 + Math.PI / 8 + Math.PI / nseg;
    B.add('std', T.box(), [Math.cos(a) * (Rf - 18), 14, Math.sin(a) * (Rf - 18)], [70, 28, 20], [0, -a + HALF, 0], '#4a5252', PAINTED);
    if (k % 2 === 0) pic(B, ['e_scope', 'e_atc', 'e_strips', 'e_scope'][k / 2], Math.cos(a) * (Rf - 29), 34, Math.sin(a) * (Rf - 29), 16, Math.atan2(-Math.cos(a), -Math.sin(a)), { w: 22 });
  }
  lampGlow(B, halos, 0, 70, 0, 8730, 1580, '#7affb0', { size: [1, 1, 1], k: 0.1, halo: day ? 0 : 260, strength: 0.35, y0: top });
  // antennas and the beacon on a short mast; obstruction lights at the roof's corners
  rod(B, 'std', [-40, ch + 24, -30], [-40, ch + 140, -30], 1.2, '#c8c8c0', STEEL, 5);
  rod(B, 'std', [50, ch + 24, 20], [50, ch + 100, 20], 0.8, '#c8c8c0', STEEL, 5);
  for (let k = 0; k < 3; k++) rod(B, 'std', [50, ch + 60 + k * 12, 20], [70, ch + 60 + k * 12, 20], 0.5, '#c8c8c0', STEEL, 3);
  B.cyl('std', 0, ch + 24, 0, 4, 40, '#c8c8c0', 8, 1, null, STEEL);
  B.cyl('std', 0, ch + 64, 0, 12, 18, '#2a2a2a', 12, 1, null, STEEL);
  lampGlow(B, halos, 0, ch + 74, 0, 8730, 1580, '#bfffd0', { size: [10, 10, 10], k: day ? 1 : 5, halo: 220, strength: 0.8, blink: 1, y0: top, shape: 'sphere' });
  lampGlow(B, halos, -40, ch + 142, -30, 8690, 1550, '#ff3a2a', { size: [3, 3, 3], k: 6, halo: 90, strength: 0.6, blink: 1, y0: top, shape: 'sphere' });
  // the heads over the door from the apron and the lobby's exit into the compound
  doorHead(P, 'y', Tw.x0, Tw.door[0], Tw.door[1], 20, H, LOOK.tower, 116);
  doorHead(P, 'x', Tw.y1, Tw.exit[0], Tw.exit[1], 20, H, LOOK.tower, 112);
  // the base: the sign over the door, the stencilled number, a floodlight on the apron side
  at(B, gy, Tw.x0, (Tw.door[0] + Tw.door[1]) / 2, 0, HALF, 8106);   // (local +z faces west, onto the apron)
  pic(B, 'atc', 0, 140, 11, 22, 0);
  pic(B, 'd_graf1', 120, 40, 10.8, 26, 0);
  lampGlow(B, halos, 0, 126, 16, Tw.x0 - 16, (Tw.door[0] + Tw.door[1]) / 2, '#ffe0b0', { size: [10, 2, 6], k: day ? 0.4 : 3, halo: day ? 0 : 80, strength: 0.5, flicker: 0.2, y0: 0 });
  void tier; void sx; void PLASTER;
}

/** The radio room's console wall and map table come from props; this is the crash-rescue station. */
export function fireStation(P, o) {
  const { B, halos, day } = P;
  const W = o.w, D = o.h, H = 130;
  B.block('std', 0, 0, 0, W, H, D, '#c8c0ac', null, S(DET.stucco, 0.9, 0));
  B.block('std', 0, H, 0, W + 8, 8, D + 8, '#6a665e', null, CONC);
  for (const s of [-1, 1]) B.block('std', 0, H + 8, s * (D / 2 + 1), W + 10, 12, 6, '#b8b0a0', null, CONC);
  // two bays on the north side: one roller door shut, one open on the dark garage
  const z = -D / 2 - 0.5;
  for (const [x, open] of [[-90, false], [90, true]]) {
    B.box('std', x, 56, z - 1, 150, 116, 2, '#3a3a38', null, CONC);
    if (open) {
      B.box('std', x, 56, z + 1, 140, 110, 2, '#0e0e0d', null, CONC);
      B.box('std', x, 106, z - 1.5, 140, 12, 2, '#b8161a', null, CORR2);
    } else {
      for (let y = 4; y < 112; y += 6) B.box('std', x, y, z - 1.5, 140, 5.4, 2, y % 12 < 6 ? '#b8161a' : '#a8141a', null, CORR2);
    }
    pic(B, 'hazard', x, 2, z - 2.6, 4, Math.PI, { w: 140 });
  }
  pic(B, 'crashfire', 0, 124, z - 2.4, 16, Math.PI, { w: 220 });
  // the hose tower at the south-east corner, a red beacon, windows on the west
  B.block('std', W / 2 - 40, 0, D / 2 - 40, 70, 280, 70, '#b8b0a0', null, S(DET.stucco, 0.9, 0));
  B.block('std', W / 2 - 40, 280, D / 2 - 40, 80, 8, 80, '#6a665e', null, CONC);
  for (const y of [100, 180, 240]) B.box('glass', W / 2 - 40, y, D / 2 - 40 - 35.4, 16, 30, 0.6, '#141c22');
  lampGlow(B, halos, W / 2 - 40, 296, D / 2 - 40, o.x + W / 2 - 40, o.y + D / 2 - 40, '#ff3a2a', { size: [6, 6, 6], k: 6, halo: 120, strength: 0.7, blink: 1, y0: 0, shape: 'sphere' });
  for (let x = -W / 2 + 60; x < W / 2; x += 90) B.box('glass', x, 80, D / 2 + 0.6, 50, 40, 0.6, '#141c22');
  lampGlow(B, halos, 0, 118, z - 8, o.x, o.y - D / 2 - 8, '#ffe0b0', { size: [30, 2, 6], k: day ? 0.4 : 3, halo: day ? 0 : 120, strength: 0.6, y0: 0 });
  return true;
}
const CORR2 = S(DET.corrugated, 0.55, 0.35);

/** The motor pool's canopy (roof style 'shelter'): a mono-pitch corrugated roof on trusses, lamps, the sign. */
export function shelterRoof(P, r) {
  const { B, gy, halos, day } = P;
  at(B, gy, r.x, r.y, 0, 0, 8201);
  const w = r.w, d = r.h, H = 170;
  B.add('std', T.box(), [0, H + 14, 0], [w + 20, 3, d + 10], [0.05, 0, 0], '#5a6258', CLAD);
  for (let x = -w / 2 + 20; x < w / 2; x += (w - 40) / 2) {
    B.box('std', x, H, 0, 8, 10, d, '#4a4e52', null, STEEL);
    rod(B, 'std', [x, H + 4, -d / 2], [x, H + 22, d / 2], 1.2, '#4a4e52', STEEL, 4);
  }
  for (const z of [-d / 4, d / 4]) {
    B.box('std', 0, H - 6, z, 50, 2.4, 9, '#c8ccd0', null, PAINTED);
    lampGlow(B, halos, 0, H - 8, z, r.x, r.y + z, '#ffc070', { size: [44, 1.2, 6], k: day ? 0.8 : 3, halo: 110, strength: 0.5, y0: 0 });
  }
  pic(B, 'motorpool', 0, H - 18, d / 2 - 18, 18, 0);
}

// ---- the runway --------------------------------------------------------------------------------------------------------

function stud(B, halos, x, z, wx, wy, color, day, o = {}) {
  B.cyl('std', x, 0, z, 2.6, 10, '#2a2a28', 8, 1, null, STEEL);
  lampGlow(B, halos, x, 11, z, wx, wy, color, { size: [3.2, 3.2, 3.2], k: day ? 0.8 : 5, halo: day ? 0 : (o.halo || 34), strength: o.strength || 0.5, blink: o.blink || 0, y0: 0, shape: 'sphere' });
}

/** The runway's lights, numbers, approach lights past the end, the flare path. */
export function runway(P, m) {
  const { B, gy, halos, day, tier } = P;
  const cy = (m.y0 + m.y1) / 2, hw = (m.y1 - m.y0) / 2;
  at(B, gy, m.x0, cy, 0, 0, 8301);
  const end = 12400 - m.x0;
  // edge lights both sides every 200 (white), the threshold bar (green) at the west end
  for (let x = 0; x <= end; x += 200) for (const s of [-1, 1]) stud(B, halos, x, s * (hw + 8), m.x0 + x, cy + s * (hw + 8), x > end - 600 ? '#ffd27a' : '#fff4dc', day);
  for (let z = -hw + 20; z < hw; z += 50) stud(B, halos, -6, z, m.x0 - 6, cy + z, '#6aff8a', day, { halo: 28 });
  // the far end: a red end bar beyond the threshold, the 27 numbers, the overrun's chevrons
  for (let z = -hw + 20; z < hw; z += 50) stud(B, halos, end, z, m.x0 + end, cy + z, '#ff3a2a', day, { halo: 30 });
  flatPic(B, 'rwy27', 11620 - m.x0, 0.8, 0, 280, 240, HALF);
  flatPic(B, 'rwy09', 420, 0.8, 0, 200, 240, -HALF);
  for (let x = 12030 - m.x0; x < end - 20; x += 90) {
    for (const s of [-1, 1]) B.add('std', T.box(), [x, 0.6, s * hw * 0.45], [14, 0.6, hw * 1.0], [0, s * 0.9, 0], '#c8a020', { ...PAINTED, noJitter: true });
  }
  // the approach lights: bars of five on poles marching off into the trees, one sequenced flasher each
  if (tier !== 'low') {
    for (let k = 0; k < 12; k++) {
      const x = end + 120 + k * 110, ph = 4 + k * 1.6;
      B.cyl('std', x, 0, 0, 2, ph, '#c8c8c0', 6, 1, null, STEEL);
      B.box('std', x, ph, 0, 4, 3, 90, '#c8c8c0', null, STEEL);
      for (let j = -2; j <= 2; j++) lampGlow(B, j === 0 ? halos : null, x, ph + 4, j * 20, m.x0 + x, cy + j * 20, '#fff4e0', { size: [4, 4, 4], k: day ? 0.6 : 5, halo: day ? 0 : 60, strength: 0.6, y0: 0, shape: 'sphere' });
      lampGlow(B, halos, x, ph + 10, 0, m.x0 + x, cy, '#e8f0ff', { size: [3, 3, 3], k: day ? 0.6 : 7, halo: day ? 0 : 90, strength: 0.8, blink: 1, y0: 0, shape: 'sphere' });
    }
  }
}

/** The flare path: crates and unlit flares along the centreline, five lit by the drop zone. */
export function flarePath(P, m) {
  const { B, gy, halos } = P;
  at(B, gy, m.x0, m.y, 0, 0, 8401);
  for (let x = 0; x < m.x1 - m.x0; x += 300) {
    const wx = m.x0 + x;
    const lit = Math.abs(wx - m.at) <= 420;
    for (const s of [-1, 1]) {
      const z = s * (lit ? 80 : 60);
      B.add('std', T.cyl(6, 1), [x, 1.6, z], [1.6, 20, 1.6], [HALF, hash01(x + s) * 3, 0], '#b81a14', S(DET.plastic, 0.5, 0));
      if (lit) lampGlow(B, halos, x + 9, 2.4, z, wx + 9, m.y + z, '#ff4a2a', { size: [2.4, 2.4, 2.4], k: 8, halo: 70, strength: 0.7, flicker: 0.6, y0: 0, shape: 'sphere' });
    }
  }
}

/** Small runway furniture: the windsock, the PAPI, the glide slope's shelter and mast. */
export function fieldProp(P, o) {
  const { B, halos, day } = P;
  switch (o.style) {
    case 'windsock': {
      B.block('std', 0, 0, 0, 30, 6, 30, COL.concD, null, CONC);
      B.cyl('std', 0, 6, 0, 2.4, 150, '#c8c8c0', 8, 0.7, null, STEEL);
      B.add('std', T.torus(12, 0.06, 4), [8, 150, 0], [10, 10, 10], [0, HALF, 0], '#c8c8c0', STEEL);
      // the sock streams downwind in bands of orange and white
      for (let k = 0; k < 5; k++) B.add('std', T.cyl(10, 0.9, true), [14 + k * 13, 150 - k * 3, 0], [9.5 - k * 1.1, 13, 9.5 - k * 1.1], [0, 0, HALF + 0.22], k % 2 ? '#e8e4dc' : '#e8601a', S(DET.fabric, 0.9, 0));
      lampGlow(B, halos, 0, 162, 0, o.x, o.y, '#ff3a2a', { size: [3, 3, 3], k: 5, halo: 60, strength: 0.5, blink: 1, y0: 0, shape: 'sphere' });
      return true;
    }
    case 'papi': {
      for (let k = 0; k < 4; k++) {
        const z = -45 + k * 30;
        B.rblock('std', 0, 6, z, 26, 16, 20, 2, '#d8d8d4', null, PAINTED);
        for (const dz of [-4, 4]) B.cyl('std', 0, 0, z + dz, 1.6, 8, '#3a3a3a', 6, 1, null, STEEL);
        lampGlow(B, halos, -13.4, 14, z, o.x - 13, o.y + z, k < 2 ? '#ff3a2a' : '#fff4e0', { size: [0.8, 6, 6], k: day ? 0.6 : 6, halo: day ? 0 : 50, strength: 0.6, y0: 0 });
      }
      return true;
    }
    case 'glideslope': {
      B.block('std', 0, 0, 0, o.w, 50, o.h, '#d8d4c8', null, S(DET.panel, 0.6, 0.2));
      B.block('std', 0, 50, 0, o.w + 6, 4, o.h + 6, '#8a8e92', null, STEEL);
      B.cyl('std', -o.w / 2 - 30, 0, 0, 3.4, 300, '#c8302a', 8, 0.6, null, PAINTED);
      for (const y of [120, 200, 280]) B.box('std', -o.w / 2 - 30, y, 0, 6, 10, 30, '#d8d8d4', null, STEEL);
      lampGlow(B, halos, -o.w / 2 - 30, 304, 0, o.x - o.w / 2 - 30, o.y, '#ff3a2a', { size: [3, 3, 3], k: 6, halo: 80, strength: 0.6, blink: 1, y0: 0, shape: 'sphere' });
      return true;
    }
    default: return false;
  }
}

void shadeHex; void RUST;
