// Blackwater Dam's buildings and rooms: the control building (its art-deco shell, the control room with
// the panel wall, consoles and screens, the radio office, the vestibule and the stair hall), the turbine
// hall (the shell with clerestory windows, the four generators, the bridge crane, the catwalk and the
// breaker), the tailrace yard's transformers, the highway tunnel, the gates' models and the small pieces
// of furniture the layout places as obstacles (by `o.style`).

import { DAM, DAM_Z } from '../../shared/levels/dam.js';
import {
  T, DET, S, CONC, RUST, STEEL, PAINTED, PLASTER, WOOD, CORR, COL, at, pic, flatPic, signBoard, quad4, rod, railing, lampGlow, bulkhead, tubeLamp,
  shadeHex, mixHex, hash01, atlasUV, toWorld,
} from './dam-kit.js';

const K = DAM.control;
const HL = DAM.hall;
const LINO = S(DET.linoleum, 0.55, 0);
const TERR = S(DET.terrazzo, 0.45, 0);
const TWO = { low: '#3f5a50', high: '#d6cfbb', skirt: '#2a2e2c' };   // institutional two-tone paint

/** A wall's inner face: dado, upper paint and skirting on the plane z = zf of the current frame, facing sz. */
function twoTone(B, x0, x1, zf, sz, h, o = {}) {
  const len = x1 - x0, xc = (x0 + x1) / 2;
  const lo = o.low || TWO.low, hi = o.high || TWO.high, dado = o.dado ?? 52;
  B.box('std', xc, dado / 2, zf + sz * 0.6, len, dado, 1.2, lo, null, { ...PAINTED, noJitter: true });
  B.box('std', xc, dado + (h - dado) / 2, zf + sz * 0.4, len, h - dado, 0.8, hi, null, { ...PLASTER, noJitter: true });
  B.box('std', xc, dado + 1, zf + sz * 1.1, len, 2, 1.2, shadeHex(lo, -0.25), null, { ...PAINTED, noJitter: true });
  B.box('std', xc, 3, zf + sz * 1.2, len, 6, 1.6, TWO.skirt, null, { ...PAINTED, noJitter: true });
}

// ---- the control building ------------------------------------------------------------------------------

/**
 * The control building: shell, facade, roof, floors and the rooms' walls (the partitions are obstacles).
 * @param {object} P { B, gy, halos, tier, day }
 */
export function controlBuilding(P) {
  const { B, gy, halos } = P;
  const x0 = 3720, x1 = K.x1 + 10, y0 = K.y0 - 10, y1 = K.y1 + 10;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const L = x1 - x0, D = y1 - y0, H = 172;
  const ext = '#b3ad9f';
  at(B, gy, cx, cy, 0, 0, 3001);
  // exterior skin (north and south walls, the west stair wing's wall), plinth, cornice, pilasters
  B.block('std', 0, 0, -D / 2 + 10, L, H, 20, ext, null, { ...CONC, noJitter: true });
  B.block('std', 0, 0, D / 2 - 10, L, H, 20, ext, null, { ...CONC, noJitter: true });
  for (const s of [-1, 1]) {
    B.block('std', 0, 0, s * (D / 2 + 2), L + 8, 14, 6, '#8a857a', null, CONC);
    B.block('std', 0, H - 4, s * (D / 2 + 3), L + 10, 10, 8, '#c8c2b4', null, CONC);
    for (let x = -L / 2 + 40; x < L / 2; x += 110) B.block('std', x, 0, s * (D / 2 + 3), 16, H - 4, 6, '#bdb7a9', null, CONC);
  }
  // the east facade: sill, big window bays, lintel, pilasters, the door with its canopy and sign
  const ex = L / 2 - 10;
  const bays = [[1310, 1640], [1780, 1900]];
  for (const [ya, yb] of bays) {
    const za = ya - cy, zb = yb - cy, zl = zb - za;
    B.block('std', ex, 0, (za + zb) / 2, 20, 32, zl, ext, null, { ...CONC, noJitter: true });
    B.block('std', ex, 132, (za + zb) / 2, 20, H - 132, zl, ext, null, { ...CONC, noJitter: true });
    const nb = Math.max(1, Math.round(zl / 80));
    for (let k = 0; k < nb; k++) {
      const z0 = za + (zl * k) / nb, z1 = za + (zl * (k + 1)) / nb, zc = (z0 + z1) / 2, wz = z1 - z0;
      // mullions, a transom, the panes (one broken out)
      B.box('std', ex, 82, z0 + 2, 18, 100, 6, '#5a605e', null, STEEL);
      B.box('std', ex, 104, zc, 14, 3, wz - 4, '#5a605e', null, STEEL);
      const broken = hash01(k * 17 + ya) < 0.3;
      if (!broken) B.box('vglass', ex + 2, 81, zc, 1, 96, wz - 6, '#22323a');
      else {
        // shards left in the frame
        B.add('vglass', T.plane(), [ex + 2, 42, zc - wz * 0.2], [wz * 0.4, 18, 1], [0, Math.PI / 2, 0.5], '#22323a');
        B.add('vglass', T.plane(), [ex + 2, 120, zc + wz * 0.2], [wz * 0.3, 14, 1], [0, Math.PI / 2, -0.4], '#22323a');
      }
    }
    B.box('std', ex, 82, zb - 2, 18, 100, 6, '#5a605e', null, STEEL);
  }
  // the door bay: jambs and a lintel with a canopy, the sign
  const dz0 = 1640 - cy, dz1 = 1780 - cy;
  B.block('std', ex, 150, (dz0 + dz1) / 2, 20, H - 150, dz1 - dz0, ext, null, CONC);
  B.box('std', ex + 30, 150, (dz0 + dz1) / 2, 60, 6, dz1 - dz0 + 40, '#8a857a', null, CONC);
  for (const z of [dz0 - 6, dz1 + 6]) B.box('std', ex + 2, 75, z, 22, 150, 12, '#9a9486', null, CONC);
  pic(B, 'control', ex + 11, 138, (dz0 + dz1) / 2, 18, Math.PI / 2);
  pic(B, 'auth', ex + 11, 60, dz1 + 40, 20, Math.PI / 2);
  pic(B, 'd_graf2', ex + 11.5, 70, dz0 - 60, 32, Math.PI / 2);
  lampGlow(B, halos, ex + 22, 145, (dz0 + dz1) / 2, x1 + 12, 1710, '#ffd9a0', { size: [6, 2, 18], k: 3, halo: 70, strength: 0.5, y0: 0 });
  // the roof: slab, parapet, a ventilator, the radio mast with its whip antenna
  B.block('std', 0, H - 2, 0, L + 4, 8, D + 4, '#8a867c', null, CONC);
  for (const s of [-1, 1]) {
    B.block('std', 0, H + 6, s * (D / 2 - 3), L + 4, 16, 6, '#b8b2a4', null, CONC);
    B.block('std', s * (L / 2 - 3), H + 6, 0, 6, 16, D, '#b8b2a4', null, CONC);
  }
  B.rblock('std', -120, H + 6, -80, 60, 30, 40, 2, '#7a7e80', null, STEEL);
  B.cyl('std', 200, H + 6, 180, 3, 200, '#8a8e92', 8, 0.6, null, STEEL);
  for (let k = 0; k < 4; k++) rod(B, 'std', [200, H + 40 + k * 40, 180], [200 + 26 - k * 5, H + 40 + k * 40, 180], 0.7, '#8a8e92', STEEL, 4);
  lampGlow(B, halos, 200, H + 208, 180, cx + 200, cy + 180, '#ff3a2a', { size: [3, 3, 3], k: 6, halo: 80, strength: 0.7, flicker: 0.5, y0: 0, shape: 'sphere' });
  // the floor: terrazzo in the rooms, a darker border
  B.box('std', 0, 0.6, 0, L - 40, 1.2, D - 40, '#6e7468', null, { ...TERR, noJitter: true });
  B.box('std', 0, 0.4, 0, L - 20, 0.8, D - 20, '#4a4e48', null, { ...TERR, noJitter: true });
  // inner faces of the shell (north, south, east around the openings, west against the shaft)
  twoTone(B, -L / 2 + 20, L / 2 - 20, -D / 2 + 20, 1, 150);
  twoTone(B, -L / 2 + 20, L / 2 - 20, D / 2 - 20, -1, 150);
  at(B, gy, x0 + 10, cy, 0, Math.PI / 2, 3002);
  // (the west wall, x = 3720, seen from the control room: it is the shaft's wall below its slope)
  B.block('std', 0, 0, 0, D - 40, 152, 20, COL.concD, null, CONC);
  twoTone(B, -D / 2 + 20, (1740 - cy), -10, -1, 150);
  // the stair hall under the shaft's foot: floor and walls
  at(B, gy, 3620, (1740 + y1) / 2, 0, 0, 3003);
  const sd = y1 - 1740;
  B.box('std', 0, 0.6, 0, 180, 1.2, sd - 20, '#5e645a', null, { ...TERR, noJitter: true });
  B.block('std', 0, 0, sd / 2 - 10, 220, H, 20, ext, null, CONC);
  twoTone(B, -90, 90, sd / 2 - 20, -1, 150, { low: '#5a3a30' });
  pic(B, 'stairs', 0, 128, -sd / 2 + 16, 22, 0);
  pic(B, 'd_graf2', -30, 70, -sd / 2 + 17, 34, 0);
  pic(B, 'd_hand', 60, 60, -sd / 2 + 16.5, 16, 0);
  pic(B, 'd_hand', 40, 84, -sd / 2 + 16.5, 14, 0, { rz: 0.4 });
  // the outer face of the building's west wing (the stair hall) toward the cliff
  at(B, gy, 3530, (1740 + y1) / 2, 0, 0, 3004);
  B.block('std', 0, 0, 0, 20, H, sd, ext, null, CONC);
}

/** The control room, radio office and vestibule: panels, consoles, screens, desks, clutter, lamps. */
export function controlInterior(P) {
  const { B, gy, halos, day } = P;
  const cy = (K.y0 + K.y1) / 2;
  // ---- the panel wall along the north side
  at(B, gy, 3950, 1320, 0, 0, 3101);
  B.rblock('std', 0, 0, 0, 404, 124, 26, 1, '#56615c', null, { ...PAINTED, noJitter: true });
  pic(B, 'mimic', 0, 88, 13.2, 62, 0, { w: 360 });
  pic(B, 'gauges', -110, 38, 13.2, 28, 0);
  pic(B, 'e_lamps', 110, 38, 13.2, 8, 0, { w: 64 });
  pic(B, 'chart', 150, 50, 13.2, 18, 0);
  B.box('std', 0, 124, 4, 410, 4, 34, '#3a403e', null, PAINTED);
  for (let k = 0; k < 14; k++) B.box('std', -170 + k * 26, 28, 14, 6, 8, 3, k % 3 ? '#1c1c1e' : '#b8261c', null, PAINTED);
  // ---- the console desk facing the panels: sloped control surface, CRTs, a microphone
  at(B, gy, 3950, 1470, 0, 0, 3102);
  B.rblock('std', 0, 0, 0, 300, 30, 44, 2, '#6a7470', null, PAINTED);
  B.add('std', T.box(), [0, 36, -6], [296, 3, 30], [-0.35, 0, 0], '#4a5450', PAINTED);
  pic(B, 'e_panel', 0, 37, -5, 12, 0, { w: 270, rx: -0.35 - Math.PI / 2 + Math.PI / 2 });
  for (const [x, cell] of [[-100, 'e_crt1'], [0, 'e_crt2'], [100, 'e_crt3']]) {
    B.rblock('std', x, 30, -8, 40, 32, 30, 3, '#c8c0a8', null, S(DET.plastic, 0.5, 0));
    pic(B, cell, x, 47, 7.2, 24, 0, { w: 32 });
  }
  rod(B, 'std', [130, 30, 8], [140, 48, 4], 0.5, '#2a2a2a', STEEL, 4);
  B.add('std', T.sphere(6, 4), [140, 49, 4], [2.2, 2.2, 2.2], null, '#2a2a2a', STEEL);
  for (const [x, rot, fall] of [[-80, 0.2, false], [40, -0.4, false], [120, 1.2, true]]) chair(B, x, 42, rot, fall);
  // ---- work desks with papers, a lamp, a phone, mugs
  for (const [x, y, a] of [[3830, 1640, 0.1], [4060, 1680, -0.2]]) {
    at(B, gy, x, y, 0, a, x);
    officeDesk(B, halos, x, y, day);
  }
  // ---- lockers, racks, the counter (drawn by their obstacles), a water cooler, a filing cabinet on its side
  at(B, gy, 3760, 1850, 0, 0, 3103);
  B.rblock('std', 0, 0, 0, 20, 60, 20, 2, '#d8d8d0', null, S(DET.plastic, 0.5, 0));
  B.cyl('std', 0, 60, 0, 8, 22, '#8ab8d8', 10, 1, null, S(0, 0.2, 0.1));
  at(B, gy, 4100, 1420, 0, 1.4, 3104);
  B.add('std', T.box(), [0, 12, 0], [60, 24, 30], [0, 0, 0], '#7a8288', STEEL);
  // ---- clutter: papers, blood, a drag trail toward the stair hall, a fallen ceiling tile, glass
  at(B, gy, 3950, 1600, 0, 0, 3105);
  const r = B.rng;
  for (let k = 0; k < 26; k++) flatPic(B, k % 5 ? 'paper' : 'clipboard', r.range(-200, 200), 1.4 + k * 0.02, r.range(-200, 220), 10, 13, r.range(0, 6.28));
  flatPic(B, 'd_blood1', -40, 1.3, 60, 70, 70, 0.4);
  flatPic(B, 'd_drag', -170, 1.35, 190, 180, 44, Math.PI + 0.2);
  flatPic(B, 'd_blood2', 380, 1.3, -180, 60, 60, 1.2);
  B.add('std', T.box(), [60, 2, -40], [40, 1.2, 40], [0.05, 0.4, 0.08], '#d8d4c8', S(DET.ceiltile, 0.9, 0));
  for (let k = 0; k < 10; k++) B.add('vglass', T.plane(), [440 + r.range(-10, 20), 1.6, r.range(-240, 200)], [r.range(4, 12), r.range(4, 12), 1], [-Math.PI / 2, r.range(0, 6), 0], '#3a4a52');
  // ---- wall dressing: posters, a calendar, the evacuation plan, a clock, the exit sign, first aid, extinguisher
  const wallN = K.y0 + 12, wallS = K.y1 - 12;
  at(B, gy, 4000, wallS, 0, 0, 3106);
  pic(B, 'poster_a', -180, 90, -0.5, 44, Math.PI);
  pic(B, 'evac', -60, 96, -0.5, 36, Math.PI);
  pic(B, 'calendar', 80, 92, -0.5, 38, Math.PI);
  pic(B, 'd_blood2', 150, 60, -0.8, 60, Math.PI);
  at(B, gy, 4300, wallN, 0, 0, 3107);
  pic(B, 'mapdam', -30, 90, 0.8, 54, 0);
  pic(B, 'radio', 70, 120, 0.8, 18, 0);
  pic(B, 'notices', 70, 80, 0.8, 34, 0);
  at(B, gy, 3780, wallN, 0, 0, 3108);
  pic(B, 'poster_b', 0, 90, 0.8, 44, 0);
  at(B, gy, K.x1 - 12, 1560, 0, -Math.PI / 2, 3109);
  pic(B, 'firstaid', -150, 110, 0.8, 18, 0);
  pic(B, 'fireext', -150, 72, 0.8, 22, 0);
  B.rblock('std', -150, 20, 4, 8, 26, 8, 3, '#b8261c', null, PAINTED);
  at(B, gy, 4200, 1715, 0, Math.PI / 2, 3110);
  B.box('std', 0, 138, 0, 30, 10, 3, '#1a1a1a', null, PAINTED);
  pic(B, 'e_exit', 0, 138, 1.8, 9, 0);
  pic(B, 'e_exit', 0, 138, -1.8, 9, Math.PI);
  // the vestibule's wall by the crest-gate corridor: "DONT OPEN" and handprints
  at(B, gy, 3730, 1820, 0, -Math.PI / 2, 3111);
  pic(B, 'd_graf2', 0, 96, 0.8, 30, 0);
}

function chair(B, x, z, rot, fallen) {
  const tilt = fallen ? [Math.PI / 2 - 0.1, rot, 0] : [0, rot, 0];
  const y = fallen ? 10 : 0;
  B.add('std', T.box(), [x, y + 18, z], [16, 3, 16], tilt, '#2a2c2e', S(DET.fabric, 0.9, 0));
  B.add('std', T.box(), [x - (fallen ? 0 : Math.cos(rot) * 7), y + 30, z + (fallen ? -10 : Math.sin(rot) * 7)], [3, 20, 15], tilt, '#2a2c2e', S(DET.fabric, 0.9, 0));
  if (!fallen) {
    B.cyl('std', x, 4, z, 1.2, 14, '#3a3c3e', 6, 1, null, STEEL);
    for (let k = 0; k < 5; k++) { const a = k * 1.257; rod(B, 'std', [x, 4, z], [x + Math.cos(a) * 10, 1.5, z + Math.sin(a) * 10], 0.8, '#3a3c3e', STEEL, 4); }
  }
}

function officeDesk(B, halos, wx, wy, day) {
  B.rblock('std', 0, 26, 0, 120, 3, 50, 1, '#8a6a4a', null, WOOD);
  for (const x of [-52, 52]) B.block('std', x, 0, 0, 12, 26, 46, '#6a6e70', null, STEEL);
  B.rblock('std', -20, 29, -6, 34, 2, 24, 0.4, '#e8e4d8', null, S(0, 0.9, 0));
  B.rblock('std', 30, 29, -8, 18, 6, 12, 1, '#2a2a2c', null, S(DET.plastic, 0.4, 0));
  B.cyl('std', -44, 29, 12, 2, 4.6, '#c85a3a', 8, 0.95, null, S(DET.plastic, 0.4, 0));
  B.cyl('std', 44, 29, 14, 3, 1.4, '#2a2a2c', 8, 1, null, STEEL);
  rod(B, 'std', [44, 30, 14], [40, 44, 10], 0.6, '#2a2a2c', STEEL, 4);
  B.add('std', T.cyl(8, 0.4), [38, 44, 8], [6, 6, 6], [0.5, 0, 0.4], '#2a4a3a', STEEL);
  if (!day) lampGlow(B, null, 38, 41, 8, wx, wy, '#ffe0a8', { size: [3, 1, 3], k: 2.4, halo: 0 });
  chair(B, 0, 36, Math.PI / 2 + 0.3, false);
}

// ---- furniture obstacles -----------------------------------------------------------------------------------

/** Dispatch of the small obstacle models by style. Returns true when drawn. */
export function furniture(P, o) {
  const { B, halos } = P;
  switch (o.style) {
    case 'panelwall': case 'ctrldesk': {
      if (o.x > 5000) {
        // the turbine hall's control desk: a console with a sloped top and a couple of dark screens
        B.rblock('std', 0, 0, 0, o.w, 30, o.h, 2, '#6a7470', null, PAINTED);
        B.add('std', T.box(), [0, 34, 0], [o.w - 4, 3, o.h - 10], [-0.3, 0, 0], '#4a5450', PAINTED);
        pic(B, 'e_crt3', -30, 46, -6, 18, 0, { w: 24 });
        B.rblock('std', -30, 30, -14, 30, 24, 22, 2, '#c8c0a8', null, S(DET.plastic, 0.5, 0));
        pic(B, 'e_lamps', 30, 36, 1, 5, 0, { w: 50, rx: -0.3 });
      }
      return true;   // (the control room's are drawn with the room)
    }
    case 'desk': return true;
    case 'rack': {
      const L = o.w, W = o.h;
      B.rblock('std', 0, 0, 0, L, 150, W, 1.5, '#2a2e32', null, STEEL);
      const fz = W / 2 + 0.3;
      for (let y = 20; y < 140; y += 18) {
        B.box('std', 0, y, fz, L - 8, 14, 0.8, '#3a3e42', null, STEEL);
        pic(B, 'e_lamps', 0, y, fz + 0.3, 3, 0, { w: L * 0.7 });
      }
      return true;
    }
    case 'lockers': {
      const L = o.w, W = o.h;
      const n = Math.max(2, Math.round(L / 22));
      for (let k = 0; k < n; k++) {
        const x = -L / 2 + (k + 0.5) * (L / n);
        const open = hash01(o.id * 7 + k) < 0.3;
        B.rblock('std', x, 0, 0, L / n - 1, 96, W, 0.8, '#5a6a7a', null, STEEL);
        if (open) B.add('std', T.box(), [x - L / n * 0.3, 48, W / 2 + L / n * 0.35], [1, 90, L / n - 2], [0, 1.1, 0], '#5a6a7a', STEEL);
        else for (let v = 0; v < 4; v++) B.box('std', x, 80 - v * 3, W / 2 + 0.3, L / n * 0.5, 1, 0.5, '#2a3440', null, STEEL);
      }
      return true;
    }
    case 'radiodesk': {
      const L = o.w, W = o.h;
      B.rblock('std', 0, 26, 0, L, 3, W, 1, '#6a5a44', null, WOOD);
      for (const x of [-L / 2 + 8, L / 2 - 8]) B.block('std', x, 0, 0, 10, 26, W - 4, '#4a4e52', null, STEEL);
      // the radio stack: transceiver, amplifier, a speaker, dials glowing, a desk mic, headphones
      B.rblock('std', -20, 29, -6, 70, 26, 22, 1.5, '#3a3e3a', null, STEEL);
      B.rblock('std', -20, 55, -6, 60, 16, 20, 1.5, '#2a2e2a', null, STEEL);
      pic(B, 'e_panel', -20, 42, 5.2, 10, 0, { w: 60 });
      pic(B, 'e_scope', 30, 44, 5, 16, 0);
      B.rblock('std', 30, 29, -4, 24, 30, 18, 2, '#3a3e3a', null, STEEL);
      B.cyl('std', 60, 29, 6, 4, 1.6, '#1a1a1a', 10, 1, null, STEEL);
      rod(B, 'std', [60, 30, 6], [62, 42, 2], 0.5, '#1a1a1a', STEEL, 4);
      B.add('std', T.cyl(8, 0.7), [62, 44, 1], [2.4, 6, 2.4], [0.6, 0, 0], '#1a1a1a', STEEL);
      B.add('std', T.torus(10, 0.2, 4), [-60, 30, 8], [7, 7, 7], [Math.PI / 2, 0, 0.3], '#1a1a1a', STEEL);
      const [wx, wy] = toWorld(o, -20, 8);
      lampGlow(B, halos, -20, 46, 6, wx, wy, '#ffb040', { size: [2, 2, 2], k: 4, halo: 36, strength: 0.4, y0: 0 });
      chair(B, 0, 30, -Math.PI / 2, false);
      return true;
    }
    case 'counter': {
      B.rblock('std', 0, 0, 0, o.w, 40, o.h, 1.5, '#7a6a52', null, WOOD);
      B.rblock('std', 0, 40, 0, o.w + 4, 3, o.h + 6, 1, '#4a4038', null, WOOD);
      pic(B, 'clipboard', -40, 43.5, 0, 12, 0, { rx: -Math.PI / 2 });
      return true;
    }
    case 'cabinet': {
      // the gate-control cabinet on the valve platform
      B.rblock('std', 0, 0, 0, o.w, 70, o.h, 2, '#5a6a64', null, PAINTED);
      B.box('std', o.w / 2 + 0.4, 40, 0, 0.8, 50, o.h - 20, '#4a5a54', null, PAINTED);
      pic(B, 'danger_spill', o.w / 2 + 1, 46, 0, 26, Math.PI / 2);
      B.rblock('std', 0, 70, 0, o.w + 6, 4, o.h + 6, 1, '#3a4440', null, PAINTED);
      return true;
    }
    case 'valvewheel': {
      // a pedestal with the big hand wheel of the spillway valve, its stem and a gauge
      B.rblock('std', 0, 0, 0, 30, 30, 26, 3, '#4a5652', null, RUST);
      B.cyl('std', 0, 30, 0, 5, 16, '#3a3e3c', 10, 1, null, RUST);
      B.add('std', T.torus(24, 0.06, 6), [0, 48, 0], [24, 24, 24], [Math.PI / 2, 0, 0], '#b8261c', PAINTED);
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; rod(B, 'std', [0, 48, 0], [Math.cos(a) * 23, 48, Math.sin(a) * 23], 1.2, '#b8261c', PAINTED, 5); }
      B.cyl('std', 0, 46, 0, 4, 5, '#3a3e3c', 10, 1, null, RUST);
      B.cylX('std', 18, 24, 0, 6, 3, '#2a2a2a', 12, STEEL);
      pic(B, 'e_crt1', 19.8, 24, 0, 7, Math.PI / 2, { w: 7, bucket: 'c3sign' });
      pic(B, 'hazard', 0, 8, 13.2, 6, 0, { w: 28 });
      return true;
    }
    case 'generator': return generator(P, o);
    case 'breaker': return breaker(P, o);
    case 'transformer': return transformer(P, o);
    default: return false;
  }
}

/** An interior partition (style 'cwall'): two-tone both sides, a door-frame trim at its ends. */
export function partition(P, o) {
  const { B } = P;
  const L = Math.max(o.w, o.h), along = o.w >= o.h;
  if (!along) B.obj(o.x, o.y, Math.PI / 2, o.id * 31);
  const t = Math.min(o.w, o.h);
  B.block('std', 0, 0, 0, L, 152, t, '#c8c0ac', null, PLASTER);
  for (const s of [-1, 1]) {
    B.box('std', 0, 26, s * (t / 2 + 0.6), L, 52, 1.2, TWO.low, null, { ...PAINTED, noJitter: true });
    B.box('std', 0, 3, s * (t / 2 + 1.1), L, 6, 1.6, TWO.skirt, null, { ...PAINTED, noJitter: true });
  }
  for (const e of [-1, 1]) B.box('std', e * (L / 2 - 1.5), 64, 0, 3, 128, t + 4, '#6a5a44', null, WOOD);
  return true;
}

// ---- the turbine hall --------------------------------------------------------------------------------------

const HALL_H = 300;

/** The turbine hall's shell: walls with pilasters, clerestory windows, the doors, lettering, the floor. */
export function turbineHall(P) {
  const { B, gy, halos, tier } = P;
  const x0 = HL.x0, x1 = HL.x1, y0 = HL.y0, y1 = HL.y1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const L = x1 - x0, D = y1 - y0;
  const wallC = '#a8a294', inC = '#8e8a80';
  at(B, gy, cx, cy, 0, 0, 4001);
  // north wall (against the dam's toe) and its inner face with the penstock entries
  B.block('std', 0, 0, -D / 2, L + 24, HALL_H + 20, 24, wallC, null, CONC);
  // south wall: solid base, the big door opening, the clerestory band, a parapet
  const door0 = 6130 - cx, door1 = 6450 - cx;
  for (const [a, b] of [[-L / 2 - 12, door0], [door1, L / 2 + 12]]) {
    B.block('std', (a + b) / 2, 0, D / 2, b - a, 170, 24, wallC, null, CONC);
  }
  B.block('std', (door0 + door1) / 2, 150, D / 2, door1 - door0, 20, 24, wallC, null, CONC);
  B.block('std', 0, 260, D / 2, L + 24, HALL_H + 20 - 260, 24, wallC, null, CONC);
  // the clerestory: glazing between pilasters from 170 to 260 on the south wall
  const bayW = 90;
  for (let x = -L / 2 + 20; x < L / 2 - 20; x += bayW) {
    B.block('std', x, 170, D / 2, 14, 90, 24, wallC, null, CONC);
    B.box('std', x + bayW / 2, 215, D / 2, bayW - 14, 3, 6, '#4a4e52', null, STEEL);
    B.box('vglass', x + bayW / 2, 215, D / 2, bayW - 14, 88, 1, '#2a3a42');
    for (const zs of [-1, 1]) B.block('std', x, 0, D / 2 + zs * 16, 18, HALL_H + 10, 10, zs > 0 ? '#b4ae9f' : inC, null, CONC);
  }
  // west gable toward the river: a tall window, the tailrace outlet arches below it
  B.block('std', -L / 2, 0, 0, 24, HALL_H + 20, D + 24, wallC, null, CONC);
  B.box('vglass', -L / 2 - 12.5, 160, 0, 1, 160, 240, '#2a3a42');
  for (let z = -120; z <= 120; z += 60) B.box('std', -L / 2 - 13, 160, z, 3, 160, 5, '#4a4e52', null, STEEL);
  for (let y = 100; y <= 220; y += 40) B.box('std', -L / 2 - 13, y, 0, 3, 4, 240, '#4a4e52', null, STEEL);
  // east wall (the stair shaft's wall seen from the hall) with the side door's frame
  const sz0 = 1760 - cy, sz1 = 1880 - cy;
  B.block('std', L / 2 - 6, 0, (-D / 2 + sz0) / 2, 12, HALL_H + 10, sz0 + D / 2, inC, null, CONC);
  B.block('std', L / 2 - 6, 0, (sz1 + D / 2) / 2, 12, HALL_H + 10, D / 2 - sz1, inC, null, CONC);
  B.block('std', L / 2 - 6, 132, (sz0 + sz1) / 2, 12, HALL_H - 122, sz1 - sz0, inC, null, CONC);
  for (const z of [sz0 - 4, sz1 + 4]) B.box('std', L / 2 - 14, 66, z, 8, 132, 8, COL.yellow, null, PAINTED);
  pic(B, 'hazard', L / 2 - 12.5, 136, (sz0 + sz1) / 2, 7, -Math.PI / 2, { w: sz1 - sz0 });
  // inner faces: a painted dado all round
  for (const [zf, sz] of [[-D / 2 + 12, 1], [D / 2 - 12, -1]]) {
    B.box('std', 0, 40, zf + sz * 0.8, L - 30, 80, 1, '#5a6a64', null, { ...PAINTED, noJitter: true });
    B.box('std', 0, 81, zf + sz * 1.1, L - 30, 3, 1, COL.yellow, null, { ...PAINTED, noJitter: true });
  }
  // the lettering and lamps on the south facade, downpipes
  pic(B, 'powerhouse', (door0 + door1) / 2 + 420, 290, D / 2 + 12.6, 36, 0, { w: 330 });
  for (let x = -L / 2 + 60; x < L / 2; x += 360) {
    rod(B, 'std', [x, HALL_H + 10, D / 2 + 16], [x, 0, D / 2 + 16], 3, '#5a5e62', STEEL, 8);
  }
  lampGlow(B, halos, (door0 + door1) / 2, 176, D / 2 + 20, (6130 + 6450) / 2, y1 + 20, '#ffd9a0', { size: [30, 3, 6], k: 3.2, halo: 110, strength: 0.6, y0: 0 });
  // the big door rolled up in its box over the opening, its guides
  B.box('std', (door0 + door1) / 2, 158, D / 2 + 20, door1 - door0 + 16, 22, 16, '#6a7076', null, CORR);
  for (const x of [door0 - 4, door1 + 4]) B.box('std', x, 75, D / 2 + 14, 6, 150, 8, '#4a4e52', null, STEEL);
  // the floor: polished concrete, the yellow walkway lines, hatching round the units
  B.box('std', 0, 0.5, 0, L - 24, 1, D - 24, '#8a8a84', null, { ...S(DET.slab, 0.35, 0.05), noJitter: true });
  for (const z of [1610 - cy, 1870 - cy]) B.box('std', 0, 1.1, z, L - 60, 0.3, 5, COL.yellow, null, { ...PAINTED, noJitter: true });
  for (let k = 0; k < 4; k++) {
    const gx = 6180 + k * 360 - cx, gz = 1470 - cy;
    for (let t = 0; t < 4; t++) {
      const a = (t / 4) * Math.PI * 2 + Math.PI / 4;
      flatPic(B, 'hazard', gx + Math.cos(a) * 118, 1.2, gz + Math.sin(a) * 118, 40, 10, -a + Math.PI / 2);
    }
  }
  // the penstock entries on the north wall's inner face
  for (let k = 0; k < 4; k++) {
    const gx = 6180 + k * 360 - cx;
    B.cylZ('std', gx, 190, -D / 2 + 20, 30, 16, '#5a605e', 18, RUST);
    B.cylZ('std', gx, 190, -D / 2 + 29, 33, 3, '#4a4e4c', 18, RUST);
    pic(B, 'penstock', gx, 238, -D / 2 + 13, 12, 0);
  }
  // the catwalk along the north wall at 170 with its railing, and the stair down at the west end
  B.box('std', 0, 170, -D / 2 + 34, L - 60, 4, 40, '#5a605e', null, S(DET.panel, 0.5, 0.6));
  railing(B, -L / 2 + 30, -D / 2 + 54, L / 2 - 40, -D / 2 + 54, 172, 36, COL.yellow, { step: 60 });
  for (let x = -L / 2 + 60; x < L / 2; x += 150) rod(B, 'std', [x, 168, -D / 2 + 14], [x, 150, -D / 2 + 13], 1.6, '#4a4e52', STEEL, 5);
  for (let k = 0; k < 12; k++) B.box('std', -L / 2 + 50 + k * 10, 168 - k * 14, -D / 2 + 34, 10, 2, 36, '#5a605e', null, STEEL);
  // the crane runway beams along both long walls, and the bridge crane parked over unit 2
  for (const z of [-D / 2 + 30, D / 2 - 30]) {
    B.box('std', 0, 252, z, L - 30, 14, 12, COL.yellow, null, PAINTED);
    for (let x = -L / 2 + 60; x < L / 2; x += 180) B.box('std', x, 200, z + (z < 0 ? -8 : 8), 10, 100, 10, '#6a6e70', null, STEEL);
  }
  const bx = 6540 - cx;
  for (const s of [-1, 1]) B.box('std', bx + s * 22, 268, 0, 12, 26, D - 50, COL.yellow, null, PAINTED);
  for (let z = -D / 2 + 60; z < D / 2 - 40; z += 40) B.box('std', bx, 268, z, 44, 2, 1.5, '#a87a14', null, PAINTED);
  pic(B, 'hazard', bx - 29, 268, 0, 10, -Math.PI / 2, { w: 200 });
  pic(B, 'hazard', bx + 29, 268, 0, 10, Math.PI / 2, { w: 200 });
  B.rblock('std', bx, 280, 60, 60, 24, 50, 2, '#c89818', null, PAINTED);
  for (const dx of [-6, 6]) rod(B, 'std', [bx + dx, 280, 60], [bx + dx, 120, 60], 0.7, '#1c1c1e', STEEL, 4);
  B.rblock('std', bx, 102, 60, 20, 18, 12, 2, COL.yellow, null, PAINTED);
  B.add('std', T.torus(10, 0.3, 6), [bx, 94, 60], [7, 7, 7], null, '#3a3a3a', STEEL);
  // high-bay lamps hanging from the roof where the layout put the hall's lights
  for (let k = 0; k < 4; k++) {
    const gx = 6180 + k * 360 - cx, gz = 1700 - cy;
    rod(B, 'std', [gx, HALL_H, gz], [gx, HALL_H - 16, gz], 0.6, '#2a2a2a', STEEL, 4);
    B.add('std', T.cyl(12, 0.35, true), [gx, HALL_H - 26, gz], [14, 12, 14], [Math.PI, 0, 0], '#5a5e62', STEEL);
    lampGlow(B, halos, gx, HALL_H - 30, gz, 6180 + k * 360, 1700, k === 2 ? '#ffe8c8' : '#ffd9a8', { size: [18, 1.5, 18], k: 3, halo: 140, strength: 0.55, flicker: k === 2 ? 0.25 : 0, y0: 0 });
  }
  // clutter: drums, pallets of parts, a tool cart, a sandbag stand by the east door, blood and a body bag
  const r = B.rng;
  for (let k = 0; k < 6; k++) {
    const x = r.range(-L / 2 + 80, L / 2 - 80), z = r.range(160, 230) - D / 2 + 300;
    B.cyl('std', x, 0, z, 11, 30, r.pick(['#3a5a7a', '#7a3a2a', '#4a5a3a']), 14, 1, null, RUST);
  }
  B.rblock('std', 7050 - cx, 0, 1600 - cy, 60, 6, 44, 0.5, '#6a4a2c', null, WOOD);
  B.rblock('std', 7050 - cx, 6, 1600 - cy, 40, 26, 30, 2, '#5a605e', null, RUST);
  flatPic(B, 'd_blood1', 6900 - cx, 1.3, 1720 - cy, 90, 90, 0.7);
  flatPic(B, 'd_drag', 6700 - cx, 1.35, 1800 - cy, 200, 50, 0.1);
  if (tier !== 'low') {
    B.add('std', T.pillow(10, 6, 0.5), [7200 - cx, 6, 1760 - cy], [34, 6, 12], [0, 0.3, 0], '#2a2e2c', S(DET.plastic, 0.5, 0));
  }
  // the side door's stand: sandbags, an overturned table
  at(B, gy, 7330, 1820, 0, 0, 4002);
  for (let k = 0; k < 3; k++) B.add('std', T.pillow(10, 6, 0.4), [0, 4 + k * 7, -40 + k * 3], [16, 3.6, 6], [0, Math.PI / 2, 0], '#8a7a55', S(DET.fabric, 0.9, 0));
  B.add('std', T.box(), [-20, 16, 40], [60, 3, 30], [Math.PI / 2 - 0.1, 0.2, 0], '#6a5a44', WOOD);
}

/** The hall's roof (roof style 'hall'): trusses, purlins, corrugated panels, a skylight strip along the ridge. */
export function hallRoof(P) {
  const { B, gy } = P;
  const x0 = HL.x0, x1 = HL.x1, y0 = HL.y0, y1 = HL.y1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const L = x1 - x0, D = y1 - y0;
  at(B, gy, cx, cy, 0, 0, 4101);
  const rise = 50;
  const ridge = (z) => HALL_H + rise * (1 - Math.abs(z) / (D / 2));
  for (let x = -L / 2 + 90; x < L / 2; x += 180) {
    // a Pratt truss across the hall: bottom chord, rafters to the ridge, verticals and diagonals
    B.box('std', x, HALL_H - 4, 0, 8, 8, D, '#4a4e52', null, STEEL);
    for (const s of [-1, 1]) {
      rod(B, 'std', [x, HALL_H, s * D / 2], [x, HALL_H + rise, 0], 3, '#4a4e52', STEEL, 5);
      for (let k = 1; k < 5; k++) {
        const z = s * (D / 2) * (1 - k / 5);
        rod(B, 'std', [x, HALL_H, z], [x, ridge(z), z], 1.4, '#555a5e', STEEL, 4);
        const z2 = s * (D / 2) * (1 - (k + 1) / 5);
        rod(B, 'std', [x, HALL_H, z], [x, ridge(z2), z2], 1.2, '#555a5e', STEEL, 4);
      }
    }
  }
  // purlins and the roof skin (two pitches), with a glazed strip each side of the ridge
  for (const s of [-1, 1]) {
    for (let k = 0; k <= 6; k++) {
      const z = s * (D / 2) * (k / 6);
      B.box('std', 0, ridge(z) + 3, z, L, 5, 4, '#5a5e62', null, STEEL);
    }
    const slope = Math.atan2(rise, D / 2);
    const len = Math.hypot(rise, D / 2);
    B.add('std', T.box(), [0, HALL_H + rise / 2 + 7, s * D / 4], [L + 30, 2, len * 0.62], [s * slope, 0, 0], '#5a6064', CORR);
    B.add('std', T.box(), [0, HALL_H + rise / 2 + 7 - rise * 0.31, s * (D / 4 + D * 0.155)], [L + 30, 2, len * 0.22], [s * slope, 0, 0], '#5a6064', CORR);
    B.add('vglass', T.box(), [0, HALL_H + rise * 0.84 + 7, s * D * 0.08], [L, 1, len * 0.18], [s * slope, 0, 0], '#8aa0aa');
  }
}

/** A generator unit (obstacle 200 × 200): the stator housing, the bracket, the exciter, the deck railing. */
export function generator(P, o) {
  const { B } = P;
  const k = Number((o.label || 'G1').slice(1)) || 1;
  const col = '#5f7e74', dark = '#3e5650';
  const R = 94;
  const seg = P.tier === 'low' ? 20 : 36;
  B.cyl('std', 0, 0, 0, R + 6, 10, COL.concD, seg, 1, null, CONC);
  B.cyl('std', 0, 10, 0, R, 70, col, seg, 1, null, PAINTED);
  for (let t = 0; t < 24; t++) {
    const a = (t / 24) * Math.PI * 2;
    B.box('std', Math.cos(a) * (R + 1.5), 45, Math.sin(a) * (R + 1.5), 3, 66, 5, dark, [0, -a, 0], PAINTED);
  }
  B.cyl('std', 0, 80, 0, R + 3, 6, dark, seg, 1, null, PAINTED);
  // the upper bracket's spider arms and the exciter housing on top
  for (let t = 0; t < 6; t++) {
    const a = (t / 6) * Math.PI * 2 + 0.3;
    B.add('std', T.box(), [Math.cos(a) * 50, 92, Math.sin(a) * 50], [90, 12, 10], [0, -a, 0], dark, PAINTED);
  }
  B.cyl('std', 0, 86, 0, 44, 46, col, seg, 1, null, PAINTED);
  B.cyl('std', 0, 132, 0, 36, 10, dark, seg, 0.9, null, PAINTED);
  B.cyl('std', 0, 142, 0, 12, 12, '#8a8e92', 12, 1, null, STEEL);
  // the deck railing round the top, a ladder
  for (let t = 0; t < 20; t++) {
    const a = (t / 20) * Math.PI * 2;
    B.cyl('std', Math.cos(a) * (R - 2), 86, Math.sin(a) * (R - 2), 0.9, 34, COL.yellow, 5, 1, null, PAINTED);
  }
  B.add('std', T.torus(seg, 0.012, 4), [0, 120, 0], [R - 2, R - 2, R - 2], [Math.PI / 2, 0, 0], COL.yellow, PAINTED);
  for (const s of [-6, 6]) rod(B, 'std', [s, 0, R + 10], [s, 86, R + 2], 0.8, COL.yellow, PAINTED, 4);
  for (let y = 8; y < 86; y += 10) rod(B, 'std', [-6, y, R + 10 - y * 0.09], [6, y, R + 10 - y * 0.09], 0.6, COL.yellow, PAINTED, 4);
  // the unit number on the housing (both road-facing sides), an inspection hatch
  pic(B, 'gen' + Math.min(4, Math.max(1, k)), 0, 46, R + 1.6, 40, 0);
  pic(B, 'gen' + Math.min(4, Math.max(1, k)), 0, 46, -R - 1.6, 40, Math.PI);
  B.box('std', R * 0.7, 40, R * 0.7, 30, 36, 3, dark, [0, -Math.PI / 4, 0], PAINTED);
  if (k === 3) {
    // unit 3 was down for maintenance: a cover panel off on the floor, tools, a chain hoist
    B.add('std', T.box(), [140, 3, -20], [80, 4, 50], [0, 0.4, 0.05], col, PAINTED);
    for (let t = 0; t < 4; t++) B.box('std', 130 + t * 8, 1, 40, 12, 2, 3, '#8a8e92', null, STEEL);
  }
  return true;
}

/** The main breaker (obstacle 50 × 140): switchgear cabinets, a big lever, cables up into the wall. */
export function breaker(P, o) {
  const { B, halos } = P;
  const L = o.w, W = o.h;
  B.rblock('std', 0, 0, 0, L, 150, W, 1.5, '#8a9094', null, PAINTED);
  for (let k = 0; k < 3; k++) {
    const z = -W / 2 + (k + 0.5) * (W / 3);
    B.box('std', L / 2 + 0.5, 80, z, 1, 120, W / 3 - 6, '#7a8084', null, PAINTED);
    B.box('std', L / 2 + 1.2, 110, z, 1, 10, 20, '#2a2a2a', null, STEEL);
    pic(B, 'e_lamps', L / 2 + 1.4, 128, z, 4, Math.PI / 2, { w: 30 });
  }
  // the big lever with a red handle
  B.box('std', L / 2 + 4, 70, 0, 8, 30, 12, '#3a3e42', null, STEEL);
  rod(B, 'std', [L / 2 + 8, 70, 0], [L / 2 + 30, 96, 0], 2, '#3a3e42', STEEL, 6);
  B.cyl('std', L / 2 + 30, 94, 0, 3.4, 12, '#b8261c', 8, 1, [Math.PI / 2, 0, 0], PAINTED);
  pic(B, 'breaker', L / 2 + 1.6, 142, 0, 12, Math.PI / 2);
  pic(B, 'hv', L / 2 + 1.6, 40, -W / 2 + 26, 20, Math.PI / 2);
  for (let k = 0; k < 4; k++) rod(B, 'std', [-L / 2 + 8 + k * 10, 150, -W / 2 + 20 + k * 30], [-L / 2 - 6, 290, -W / 2 + 20 + k * 30], 2.2, '#1c1c1e', S(DET.rubber, 0.8, 0), 5);
  const [wx, wy] = toWorld(o, L / 2 + 2, 0);
  lampGlow(B, halos, L / 2 + 2, 128, 0, wx, wy, '#ff4030', { size: [2, 2, 2], k: 4, halo: 30, strength: 0.4, flicker: 0.5, y0: 0 });
  return true;
}

/** A transformer (obstacle): the tank, radiator fins, bushings and a conservator. */
export function transformer(P, o) {
  const { B } = P;
  const L = o.w, W = o.h;
  B.block('std', 0, 0, 0, L + 14, 8, W + 14, COL.concD, null, CONC);
  B.rblock('std', 0, 8, 0, L - 30, 90, W - 20, 3, '#6a7470', null, PAINTED);
  for (const s of [-1, 1]) for (let k = 0; k < 7; k++) B.box('std', -L / 2 + 16 + k * ((L - 32) / 6), 50, s * (W / 2 - 4), 3, 70, 12, '#5a6460', null, PAINTED);
  for (let k = -1; k <= 1; k++) {
    B.cyl('std', k * 26, 98, -10, 6, 8, '#5a6460', 10, 1, null, PAINTED);
    for (let t = 0; t < 6; t++) B.cyl('std', k * 26, 106 + t * 6, -10, 7 - (t % 2) * 2, 5, '#a86a3a', 10, 1, null, S(DET.plastic, 0.3, 0));
    rod(B, 'std', [k * 26, 142, -10], [k * 26, 190, -60], 1, '#8a8e92', STEEL, 4);
  }
  B.cylX('std', 0, 124, 20, 12, 60, '#6a7470', 12, PAINTED);
  pic(B, 'hv', L / 2 - 14, 60, W / 2 - 9.6, 18, 0);
  return true;
}

// ---- gates -------------------------------------------------------------------------------------------------------

/**
 * The model of a gate piece (also art.gateModel for the engine). Local frame of the obstacle: +x along
 * its length (o.w), z across (o.h); drawn standing on y = 0.
 */
export function gateModel(P, o) {
  const { B } = P;
  const L = Math.max(o.w, o.h), along = o.w >= o.h;
  if (!along) B.obj(o.x, o.y, (o.a || 0) + Math.PI / 2, o.id * 31);
  const t = Math.min(o.w, o.h);
  switch (o.style) {
    case 'yardgate': {
      // a sliding steel gate: a frame of box section, chain link, a diagonal brace, wheels on a track
      const H = 110;
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 3), H / 2 + 4, 0, 6, H, 6, '#6a7076', null, STEEL);
      for (const y of [8, H, H * 0.55]) B.box('std', 0, y, 0, L, 5, 5, '#6a7076', null, STEEL);
      rod(B, 'std', [-L / 2 + 4, 10, 0], [L / 2 - 4, H - 2, 0], 1.8, '#6a7076', STEEL, 5);
      B.add('fence', T.plane(), [0, H / 2 + 4, 0], [L - 6, H - 8, 1], null, '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 8) / 26] });
      B.add('fence', T.plane(), [0, H / 2 + 4, 0], [L - 6, H - 8, 1], [0, Math.PI, 0], '#9aa0a4', { uvScale: [(L - 6) / 26, (H - 8) / 26] });
      for (let x = -L / 2 + 20; x < L / 2; x += L / 3) B.cylZ('std', x, 5, 0, 5, 4, '#2a2a2a', 10, STEEL);
      // barbed wire on top and the sign
      for (const z of [-3, 3]) rod(B, 'std', [-L / 2, H + 12, z], [L / 2, H + 12, z], 0.4, '#5a5a5a', STEEL, 3);
      pic(B, o.x > 7000 ? 'hv' : 'auth', 0, 60, 3.4, 20, 0, { bucket: 'c3sign' });
      return true;
    }
    case 'steeldoor': {
      // a double steel door in a frame, wired glass panes, a push bar, scuffs and a bloody handprint
      const H = 134;
      B.box('std', 0, H + 4, 0, L + 8, 8, t + 6, '#3a3e40', null, STEEL);
      for (const s of [-1, 1]) {
        B.box('std', s * L / 4, H / 2, 0, L / 2 - 2, H, 4, '#4e5e62', null, PAINTED);
        B.box('vglass', s * L / 4, 96, 2.2, L / 2 - 30, 40, 0.5, '#2a3a40');
        B.box('std', s * L / 4, 62, 3, L / 2 - 20, 3, 2.4, '#8a8e92', null, STEEL);
      }
      pic(B, 'd_hand', L / 4, 70, 2.4, 14, 0);
      pic(B, 'd_blood2', -L / 5, 50, 2.3, 40, 0);
      return true;
    }
    case 'cagebars': {
      // a barred cage gate rising into its frame: vertical bars, cross bars, a padlocked hasp
      const H = 150;
      B.box('std', 0, H + 6, 0, L + 10, 12, 18, '#3a3e40', null, STEEL);
      for (let x = -L / 2 + 6; x <= L / 2 - 6; x += 12) B.cyl('std', x, 0, 0, 1.3, H, '#4a4e52', 6, 1, null, RUST);
      for (const y of [10, 70, 140]) B.box('std', 0, y, 0, L - 4, 4, 5, '#4a4e52', null, RUST);
      B.box('std', 10, 72, 3, 8, 10, 3, '#8a7a3a', null, STEEL);
      pic(B, 'd_graf2', 0, 110, 3.5, 20, 0, { w: 70 });
      return true;
    }
    case 'rollshutter': {
      // a roller shutter: slats, the coil box on top, side guides, a hazard band
      const H = 132;
      for (let y = 4; y < H; y += 6) B.box('std', 0, y, 0, L - 8, 5.6, 3, y % 12 < 6 ? '#7a8084' : '#6e7478', null, CORR);
      B.box('std', 0, H + 8, 0, L + 10, 18, 16, '#5a6064', null, STEEL);
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 2), H / 2, 0, 5, H + 6, 8, '#4a4e52', null, STEEL);
      pic(B, 'hazard', 0, 12, 1.7, 8, 0, { w: L - 10 });
      pic(B, 'hazard', 0, 12, -1.7, 8, Math.PI, { w: L - 10 });
      pic(B, 'powerhouse', 0, 90, -1.8, 12, Math.PI, { w: L - 20 });
      return true;
    }
    default: return false;
  }
}

// ---- walls of the yard, the tunnel and the toe -----------------------------------------------------------------

/** Styled wall obstacles that are drawn per piece. Returns true when drawn. */
export function styledWall(P, o) {
  const { B } = P;
  const L = Math.max(o.w, o.h), along = o.w >= o.h;
  const t = Math.min(o.w, o.h);
  switch (o.style) {
    case 'yardwall': {
      if (!along) B.obj(o.x, o.y, Math.PI / 2, o.id * 31);
      // precast panels between posts, a coping, chain link and barbed wire above
      B.block('std', 0, 0, 0, L, 70, t, '#a09a8c', null, CONC);
      for (let x = -L / 2; x <= L / 2; x += 120) B.block('std', x, 0, 0, 12, 118, t + 6, '#8a857a', null, CONC);
      B.block('std', 0, 70, 0, L, 4, t + 4, '#8e897e', null, CONC);
      B.add('fence', T.plane(), [0, 94, 0], [L, 44, 1], null, '#9aa0a4', { uvScale: [L / 26, 44 / 26] });
      B.add('fence', T.plane(), [0, 94, 0], [L, 44, 1], [0, Math.PI, 0], '#9aa0a4', { uvScale: [L / 26, 44 / 26] });
      for (const z of [-4, 4]) rod(B, 'std', [-L / 2, 122, z], [L / 2, 122, z], 0.4, '#5a5a5a', STEEL, 3);
      if (L > 300 && o.x < 5000) pic(B, 'danger_spill', 0, 38, -t / 2 - 0.3, 46, Math.PI);
      return true;
    }
    case 'tunnelwall': {
      if (!along) B.obj(o.x, o.y, Math.PI / 2, o.id * 31);
      // tiled walls, a kerb, a cable tray; the vault above is the roof (roof style 'tunnel')
      const s = o.y < 3360 ? 1 : -1;       // the tunnel's inside is toward y 3360
      B.block('std', 0, 0, 0, L, 120, t, '#8a867c', null, CONC);
      B.box('std', 0, 60, s * (t / 2 + 0.6), L, 100, 1, '#c8c4b4', null, S(DET.tile, 0.5, 0));
      B.box('std', 0, 6, s * (t / 2 + 6), L, 12, 12, '#7a766c', null, CONC);
      B.box('std', 0, 112, s * (t / 2 + 3), L, 4, 6, '#3a3e42', null, STEEL);
      pic(B, 'd_soot', 0, 90, s * (t / 2 + 1.4), 60, s > 0 ? 0 : Math.PI, { w: L * 0.6 });
      return true;
    }
    case 'rubblewall': {
      // the caved-in bore: slabs, rock and a crushed car roof
      const r = B.rng;
      for (let k = 0; k < 14; k++) {
        B.add('std', T.dodeca(), [r.range(-10, 20), r.range(10, 90), r.range(-100, 100)], [r.range(14, 30), r.range(10, 24), r.range(14, 30)], [r.range(0, 3), r.range(0, 3), 0], r.pick(['#6d6a63', '#77726a', '#5f5b55']), { wobble: { amp: 0.3, seed: k }, surf: [DET.rock, 0.9, 0] });
      }
      for (let k = 0; k < 4; k++) B.add('std', T.box(), [r.range(0, 30), r.range(30, 120), r.range(-80, 80)], [18, 60, 80], [r.range(-0.6, 0.6), 0, r.range(-0.8, 0.8)], '#8a867c', CONC);
      B.add('std', T.box(), [30, 20, 40], [70, 12, 44], [0.2, 0.3, 0.1], '#5a3a2a', S(DET.panel, 0.6, 0.3));
      return true;
    }
    case 'dockrail': {
      if (!along) B.obj(o.x, o.y, Math.PI / 2, o.id * 31);
      for (let x = -L / 2; x <= L / 2; x += 40) B.cyl('std', x, -30, 0, 3, 64, '#5a4630', 8, 1, null, WOOD);
      rod(B, 'std', [-L / 2, 30, 0], [L / 2, 30, 0], 1.6, '#6a5238', WOOD, 5);
      return true;
    }
    default: return false;
  }
}

/** The tunnel's vault (roof style 'tunnel'), its lamps and the portal on the cliff. */
export function tunnel(P, r) {
  const { B, gy, halos } = P;
  at(B, gy, r.x, r.y, 0, 0, 5001);
  const L = r.w + 40, hw = r.h / 2;
  // a segmental vault from the wall tops (120) to the crown (190)
  const N = 10;
  for (let k = 0; k < N; k++) {
    const a0 = Math.PI * (k / N), a1 = Math.PI * ((k + 1) / N);
    const p = (a) => [Math.cos(a) * hw, 120 + Math.sin(a) * 70];
    const [z0, y0] = p(a0), [z1, y1] = p(a1);
    quad4(B, 'std', [-L / 2, y0, z0], [L / 2, y0, z0], [L / 2, y1, z1], [-L / 2, y1, z1], '#6e6a62', CONC);
  }
  for (let x = -L / 2 + 40; x < L / 2; x += 120) {
    B.box('std', x, 186, 0, 30, 4, 12, '#3a3e42', null, STEEL);
    lampGlow(B, halos, x, 183, 0, r.x + x, r.y, '#ffb35a', { size: [24, 1.5, 8], k: 3.2, halo: 80, strength: 0.5, y0: 0 });
  }
  // the portal: a massive concrete surround with the date and the authority's plaque
  const px = 380;
  at(B, gy, px, r.y, 0, 0, 5002);
  B.block('std', 12, 0, -hw - 40, 24, 260, 60, COL.concD, null, CONC);
  B.block('std', 12, 0, hw + 40, 24, 260, 60, COL.concD, null, CONC);
  B.block('std', 12, 200, 0, 24, 90, r.h + 80, COL.concD, null, CONC);
  B.block('std', 20, 260, 0, 30, 12, r.h + 140, '#8a857a', null, CONC);
  pic(B, 'dam1936', 25.2, 240, 0, 26, Math.PI / 2);
  pic(B, 'authority', 25.2, 212, 0, 18, Math.PI / 2);
  pic(B, 'd_streak', 25.1, 180, -60, 120, Math.PI / 2, { w: 60 });
}

/** A plain ceiling at `h` over a roof rect, with its lamps (roof styles 'controlroom' and 'stairhall'). */
export function flatCeiling(P, r, o = {}) {
  const { B, gy, halos } = P;
  at(B, gy, r.x, r.y, 0, 0, 5101 + Math.round(r.x));
  const h = o.h ?? 150;
  if (o.tiles) {
    // a suspended grid of ceiling tiles, a few missing (the dark void above shows), one hanging
    const nx = Math.round(r.w / 40), nz = Math.round(r.h / 40);
    B.box('std', 0, h + 30, 0, r.w, 2, r.h, '#1c1c1c', null, CONC);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = -r.w / 2 + (i + 0.5) * (r.w / nx), z = -r.h / 2 + (j + 0.5) * (r.h / nz);
        if (hash01(i * 97 + j * 13 + 5) < 0.06) continue;
        B.box('std', x, h + 1, z, r.w / nx - 1.2, 1.2, r.h / nz - 1.2, '#d6d2c6', null, S(DET.ceiltile, 0.95, 0));
      }
    }
    for (let i = 0; i <= nx; i++) B.box('std', -r.w / 2 + i * (r.w / nx), h + 0.4, 0, 1, 1, r.h, '#8a8e92', null, STEEL);
    for (let j = 0; j <= nz; j++) B.box('std', 0, h + 0.4, -r.h / 2 + j * (r.h / nz), r.w, 1, 1, '#8a8e92', null, STEEL);
  } else {
    B.box('std', 0, h + 3, 0, r.w, 6, r.h, '#8a867c', null, CONC);
  }
  for (const l of o.lamps || []) tubeLamp(B, halos, l[0] - r.x, h - 3, l[1] - r.y, 60, l[0], l[1], { y0: 0, lit: l[2] !== false, flicker: l[3] || 0 });
}
