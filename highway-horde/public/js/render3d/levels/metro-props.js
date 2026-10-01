// Harlan Metro's props (render3d/levels/metro.js): the obstacles by their style tag (the turnstiles,
// benches, ticket machines, the newsstand, the café, the train's seats and cab, the works' benches,
// pumps and switchgear, the statue...) and the free items of `map.levelArt` (the stair flights, the
// shop fronts, the rails, the platform edge, the train's cars, the collapse, signals, cables, pipes, the
// gantry crane, the flood water, the entrances). Every model is written in its frame: local +x along
// the obstacle's `w`, +z along its `h`, +y up; the world placed the frame on the terrain.
//
// `metroProps(state)` binds the models to one build: water goes to `state.waters`, see-through glass
// (the stairwell's lantern) to `state.glass`.

import * as THREE from 'three';
import { T, DET, S, STEEL, CHROME, PAINT, PLAST, FABRIC, WOODS, CONC, shadeHex, hash01 } from './hospital-kit.js';
import { OBSTACLES as HOSP } from './hospital-props.js';
import { long, faceTo, slopedWall } from './mall-props.js';
import { rod } from '../dress-kit.js';
import { METRO } from '../../shared/levels/metro.js';

const HALF = Math.PI / 2;
const RUBBER = S(DET.rubber, 0.9, 0);
const GLASSY = S(DET.glass, 0.08, 0.3);
const TILE = S(DET.tile, 0.35, 0);
const BRONZE = S(DET.panel, 0.45, 0.85);

/** A heap of rubble: concrete chunks, a slab, rebar, broken tiles (local frame, L x W footprint). */
function rubbleHeap(P, L, W, H, seed) {
  const { B } = P;
  const n = Math.max(4, Math.round((L * W) / 1800));
  for (let i = 0; i < n; i++) {
    const r = (k) => hash01(seed * 13 + i * 7 + k);
    const x = (r(1) - 0.5) * L * 0.85, z = (r(2) - 0.5) * W * 0.85;
    const s = 8 + r(3) * 18 * Math.min(1, H / 40);
    const y = Math.max(0, H * (1 - Math.hypot(x / (L / 2), z / (W / 2))) * r(4));
    B.add('std', T.dodeca(), [x, y + s * 0.4, z], [s * (0.8 + r(5) * 0.6), s * 0.6, s * (0.8 + r(6) * 0.5)], [r(7) * 3, r(8) * 6, r(9)], ['#8a867c', '#9a968c', '#7a766e', '#a8a49a'][i % 4], CONC);
  }
  // a broken slab leaning on the heap, rebar sticking out
  B.box('std', 0, H * 0.45, 0, L * 0.6, 8, W * 0.4, '#9a968c', [0.3, hash01(seed) * 2, 0.25], CONC);
  if (P.lod() >= 1) for (let k = 0; k < 6; k++) rod(B, 'std', [(hash01(seed + k) - 0.5) * L * 0.5, H * 0.4, (hash01(seed * 3 + k) - 0.5) * W * 0.4], [(hash01(seed + k * 5) - 0.5) * L * 0.7, H * 0.4 + 20 + hash01(k) * 20, (hash01(seed * 7 + k) - 0.5) * W * 0.6], 0.6, '#5a3a2a', S(DET.rust, 0.8, 0.4));
  if (P.lod() >= 1) for (let k = 0; k < 4; k++) P.flat(B, 'soot', (hash01(seed + k * 9) - 0.5) * L * 1.2, 0.4, (hash01(seed + k * 11) - 0.5) * W * 1.2, 120, 100, k);
}

/** A wall-mounted EXIT box (local frame), facing local +z. */
function exitBox(P, x, y, z, ry = 0) {
  P.B.rbox('std', x, y, z, ry ? 4 : 26, 11, ry ? 26 : 4, 0.8, '#e8e8e4', null, PLAST);
  const dx = Math.sin(ry) * 2.2, dz = Math.cos(ry) * 2.2;
  P.pic(P.B, 'mt_exit', x + dx, y, z + dz, 22, 8, ry, { lit: true, k: 1.6 });
}

/**
 * The models of one build.
 * @param {object} state { waters: [], glass: [] }
 */
export function metroProps(state) {
  const OBSTACLES = {
    /** The turnstile line: units with glass paddles and their lit arrows / crosses. */
    turnstiles(P) {
      const { B } = P;
      const [L, D] = long(P);
      const n = Math.max(1, Math.floor(L / 60));
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 + (i * L) / n;
        B.rblock('std', x, 0, 0, 16, 36, D, 2, '#b8bcc0', null, CHROME);
        B.box('std', x, 36.5, 0, 17, 1, D + 1, '#2a2c2e', null, PLAST);
        for (const f of [1, -1]) {
          P.glow(B, x, 30, f * (D / 2 + 0.3), 6, 6, 0.3, i % 3 === 0 ? '#ff3a2a' : '#3cff7a', P.day ? 0.6 : 2.2);
          P.pic(B, 'mt_tvm', x, 22, f * (D / 2 + 0.4), 10, 10, f > 0 ? 0 : Math.PI);
        }
        if (i < n) {
          const mid = x + L / n / 2;
          for (const e of [-1, 1]) B.add('vglass', T.plane(), [mid + e * 12, 30, 0], [22, 26, 1], null, '#c8d4d8', { noAO: true, noJitter: true });
          B.box('std', mid, 2, 0, L / n - 16, 4, 6, '#3a3d40', null, STEEL);
        }
      }
    },
    /** A steel bench of perforated seats on a rail. */
    'mt-bench'(P) {
      const { B } = P;
      const [L, D] = long(P);
      for (const e of [-1, 1]) B.rblock('std', e * (L / 2 - 14), 0, 0, 6, 16, D - 6, 0.6, '#3a3d40', null, STEEL);
      B.box('std', 0, 15, 0, L, 2, 4, '#3a3d40', null, STEEL);
      const n = Math.max(2, Math.round(L / 46));
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (i + 0.5) * (L / n);
        B.rblock('std', x, 16, 0, L / n - 4, 2, D - 4, 0.8, '#5a7a9a', null, S(DET.hesco, 0.5, 0.6));
        B.rblock('std', x, 18, D / 2 - 3, L / n - 4, 16, 2, 0.8, '#5a7a9a', [-0.15, 0, 0], S(DET.hesco, 0.5, 0.6));
      }
    },
    /** A map board on two legs (the line map on one side, the local map on the other). */
    'mt-mapboard'(P) {
      const { B } = P;
      const [L] = long(P);
      for (const e of [-1, 1]) B.box('std', e * (L / 2 - 4), 45, 0, 4, 90, 4, '#3a3d40', null, STEEL);
      B.box('std', 0, 66, 0, L, 48, 4, '#2a2c30', null, PAINT);
      P.pic(B, 'mt_linemap', 0, 66, 2.2, L - 6, 42, 0);
      P.pic(B, 'mt_map', 0, 66, -2.2, Math.min(L - 6, 36), 44, Math.PI);
    },
    /** The street's newsstand: a kiosk with its papers out front, a shutter half down. */
    newsstand(P) {
      const { B, L, W } = P;
      B.block('std', 0, 0, 0, L, 76, W, '#2a4a3a', null, PAINT);
      B.box('std', 0, 80, 4, L + 20, 6, W + 24, '#1d3a2c', [0.06, 0, 0], PAINT);
      P.pic(B, 'mt_news', 0, 70, W / 2 + 0.4, L - 10, 12, 0);
      B.block('std', 0, 34, W / 2 + 6, L - 16, 2, 14, '#5a4a3a', [0.4, 0, 0], WOODS);
      P.pic(B, 'mt_papers', 0, 44, W / 2 + 10, L - 20, 22, 0, { rx: -0.6 });
      B.block('std', 0, 46, W / 2 + 0.3, L - 12, 18, 1, '#9aa0a4', null, S(DET.corrugated, 0.5, 0.6));
      for (let k = 0; k < 6; k++) B.box('std', (hash01(k + P.o.id) - 0.5) * L, 0.6, W / 2 + 20 + hash01(k * 3) * 30, 12, 0.6, 16, '#f0ece0', [0, k, 0], PLAST);
    },
    /** A phone box: steel posts, glass, the handset inside. */
    phonebox(P) {
      const { B } = P;
      B.block('std', 0, 0, 0, 34, 2, 34, '#3a3d40', null, STEEL);
      for (const [x, z] of [[-16, -16], [16, -16], [16, 16], [-16, 16]]) B.box('std', x, 45, z, 3, 90, 3, '#b3120e', null, PAINT);
      B.block('std', 0, 90, 0, 36, 8, 36, '#b3120e', null, PAINT);
      for (const [x, z, ry] of [[0, -16, 0], [16, 0, HALF], [-16, 0, HALF]]) B.add('vglass', T.plane(), [x, 50, z], [30, 70, 1], [0, ry, 0], '#c8d4d8', { noAO: true, noJitter: true });
      B.rblock('std', 0, 46, -14, 12, 18, 4, 0.6, '#2a2c2e', null, PLAST);
    },
    /** A ticket machine: the blue body, its dead screen, coin slot (facing local +z). */
    ticketmachine(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 78, W, 1.5, '#1d3f7a', null, PAINT);
      P.pic(B, 'mt_tvm', 0, 48, W / 2 + 0.3, L - 12, 40, 0, { lit: !P.day && hash01(P.o.id) < 0.3, k: 0.7 });
      B.box('std', 0, 16, W / 2 + 0.6, L - 16, 10, 1, '#2a2c2e', null, STEEL);
      P.pic(B, 'mt_tickets', 0, 72, W / 2 + 0.3, L - 6, 10, 0);
    },
    /** The ticket office's counter behind the glass: till, phone, a chair. */
    'mt-ticketdesk'(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 30, W, 1, '#8a6a4a', null, WOODS);
      B.box('std', 0, 31, 0, L + 4, 2, W + 4, '#2a2c30', null, S(DET.terrazzo, 0.4, 0));
      B.rblock('std', -L * 0.25, 32, -4, 16, 8, 12, 0.6, '#2a2c2e', null, PLAST);
      B.rblock('std', L * 0.2, 32, -4, 18, 12, 2, 0.5, '#16181a', null, PLAST);
      P.pic(B, 'mt_dep', L * 0.2, 38, -2.8, 16, 9, 0, { lit: !P.day, k: 0.8 });
      B.rblock('std', 0, 0, -W - 14, 16, 16, 16, 2, '#2a2d33', [0, 0.4, 0], FABRIC);
    },
    /** A floor safe, its door ajar. */
    'mt-safe'(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 44, W, 1.2, '#4a4e52', null, STEEL);
      B.box('std', -L / 2 - 8, 22, 0, 2, 38, W - 6, '#4a4e52', [0, 0.9, 0], STEEL);
    },
    /** The public stairs to the trains: a shutter down over the opening, the CLOSED notice. */
    'mt-shutter-closed'(P) {
      const { B } = P;
      const [L] = long(P);
      B.block('std', 0, 0, 0, L, 110, 2, '#8a9096', null, S(DET.corrugated, 0.5, 0.6));
      for (let y = 6; y < 110; y += 6) B.box('std', 0, y, 1.3, L, 0.8, 0.6, '#6d7378', null, STEEL);
      B.box('std', 0, 116, 0, L + 10, 14, 12, '#5a6066', null, STEEL);
      for (const f of [1, -1]) {
        P.pic(B, 'mt_closed', 0, 70, f * 1.6, 110, 28, f > 0 ? 0 : Math.PI);
        P.pic(B, 'mt_trains', 0, 132, f * 6.4, 110, 28, f > 0 ? 0 : Math.PI);
      }
      P.decal(B, 'g_quarantine', -L * 0.2, 40, 1.8, 110, 34, 0);
    },
    /** Rubble: a heap of concrete off a collapse. */
    rubble(P) {
      const { o } = P;
      rubbleHeap(P, P.L, P.W, Math.min(70, Math.min(P.L, P.W) * 0.5), o.id + 3);
    },
    /** The concourse's columns: white tiles below a coloured band, plaster above. */
    'mt-col'(P) {
      const { B, o, L } = P;
      const top = (o.top || 330) - P.gy(o.x, o.y);
      B.block('std', 0, 0, 0, L, 70, L, '#eceae0', null, TILE);
      B.block('std', 0, 70, 0, L + 0.6, 8, L + 0.6, '#1d3f7a', null, TILE);
      B.block('std', 0, 78, 0, L, top - 78, L, '#e4e0d4', null, S(DET.plaster, 0.7, 0));
      B.block('std', 0, top - 10, 0, L + 10, 10, L + 10, '#d8d4c8', null, S(DET.plaster, 0.7, 0));
      if (hash01(o.id) < 0.5) P.decal(B, ['g_tag1', 'g_tag2', 'blood_hand'][o.id % 3], 0, 40, L / 2 + 0.4, L - 4, 24, 0);
    },
    /** The café's counter: the espresso machine, cups, the cake case. */
    cafecounter(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 32, W, 1, '#5a3a24', null, WOODS);
      B.box('std', 0, 33, 0, L + 4, 2, W + 4, '#2a2826', null, S(DET.terrazzo, 0.4, 0));
      B.rblock('std', -L * 0.3, 34, 4, 40, 22, 20, 1.5, '#b8bcc0', null, CHROME);
      B.add('vglass', T.plane(), [L * 0.15, 44, -W / 2 + 2], [60, 18, 1], [0, Math.PI, 0], '#d8e4e8', { noAO: true, noJitter: true });
      for (let i = 0; i < 5; i++) B.cyl('std', L * 0.3 + i * 7, 34, 6, 2.2, 4, '#f4f0e8', 8, 0.8, null, PLAST);
      P.pic(B, 'mt_menu', 0, 76, W / 2 + 22, 80, 30, Math.PI);
    },
    /** A bistro table with two chairs. */
    cafetable(P) {
      const { B, L, o } = P;
      B.cyl('std', 0, 0, 0, 8, 1.2, '#2a2c2e', 10, 1, null, STEEL);
      B.cyl('std', 0, 1, 0, 1.2, 24, '#2a2c2e', 6, 1, null, STEEL);
      B.cyl('std', 0, 25, 0, L / 2 - 6, 1.6, '#e8e4dc', 14, 1, null, S(DET.terrazzo, 0.35, 0));
      for (const e of [-1, 1]) {
        const fall = hash01(o.id + e) < 0.3;
        B.rblock('std', e * (L / 2 + 6), fall ? 1 : 15, 0, 14, 2, 14, 0.6, '#3a2a1c', fall ? [HALF, 0, 0.4] : null, WOODS);
        if (!fall) B.rblock('std', e * (L / 2 + 13), 17, 0, 2, 16, 14, 0.6, '#3a2a1c', null, WOODS);
      }
    },
    /** The florist's counter and its buckets of wilting flowers. */
    florist(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 30, W, 1, '#e8e0d4', null, WOODS);
      for (let i = 0; i < 6; i++) {
        const x = -L / 2 + 25 + i * (L - 50) / 5;
        B.cyl('std', x, 0, -W / 2 - 18, 8, 16, '#5a6066', 10, 0.9, null, STEEL);
        P.pic(B, 'mt_flowers', x, 26, -W / 2 - 18, 18, 18, Math.PI);
      }
      P.pic(B, 'mt_flowers', 0, 60, W / 2 + 20, L * 0.6, 40, Math.PI);
    },
    /** A snack machine (its front: a cola advert, lit at night). */
    'mt-vend'(P) {
      const { B, L, W, o } = P;
      const [lx] = long(P);
      void lx;
      const f = faceTo(P, o.x - 300, o.y);
      B.rblock('std', 0, 0, 0, Math.max(L, W), 76, Math.min(L, W), 1, '#8a1a1e', null, S(DET.panel, 0.5, 0.4));
      P.pic(B, 'mt_ad3', 0, 44, f * (Math.min(L, W) / 2 + 0.3), Math.max(L, W) - 8, 56, f > 0 ? 0 : Math.PI, { lit: !P.day, k: 0.8 });
    },
    /** A train's bench seat against the car side (its back toward local +z). */
    trainseat(P) {
      const { B, L, W, o } = P;
      const c = ['#2a4a8a', '#8a2a3a'][o.id % 2];
      B.block('std', 0, 0, 2, L - 2, 14, W - 4, '#4a4e52', null, STEEL);
      B.rblock('std', 0, 14, 0, L - 2, 4, W - 2, 1.5, c, null, FABRIC);
      B.rblock('std', 0, 18, W / 2 - 3, L - 2, 18, 4, 1.5, c, [-0.12, 0, 0], FABRIC);
      if (hash01(o.id * 3) < 0.25 && P.lod() >= 1) P.flat(B, 'blood_splat', 0, 18.2, -2, L * 0.6, W, o.id);
    },
    /** The driver's desk in the cab: the console, the master controller, the seat. */
    cabdesk(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 30, W, 1, '#2a2d30', null, PAINT);
      B.add('std', T.box(), [-2, 34, 0], [L, 2, W - 8], [0, 0, 0.5], '#1a1c1e', PLAST);
      P.pic(B, 'mt_cabpanel', -L / 2 - 0.2, 33, 0, W - 10, 18, -HALF, { rx: 0, rz: 0, lit: !P.day, k: 0.5 });
      B.cyl('std', -L / 2 - 4, 30, -W * 0.3, 1, 12, '#c9ced3', 6, 1, null, CHROME);
      B.rblock('std', -L / 2 - 30, 0, 0, 16, 18, 18, 2, '#1a1c20', null, FABRIC);
    },
    'mt-bin'(P) {
      const { B, L } = P;
      B.cyl('std', 0, 0, 0, L / 2, 28, '#1a1c1e', 12, 0.95, null, PLAST);
      B.cyl('std', 0, 28, 0, L / 2 + 0.6, 2, '#3a3d40', 12, 1, null, STEEL);
    },
    /** A derailed engineering wagon: a yellow flatbed, its crane, tipped over the rails. */
    workscar(P) {
      const { B, L, W, o } = P;
      const tilt = [0.12 * (o.id % 2 ? 1 : -1), 0, 0.05];
      B.block('std', 0, 10, 0, L, 18, W, '#d8a81a', tilt, PAINT);
      for (const e of [-1, 1]) for (const z of [-W / 2 + 14, W / 2 - 14]) B.cylZ('std', e * (L / 2 - 40), 12, z, 12, 6, '#2a2a2a', 12, STEEL);
      B.block('std', L / 4, 28, 0, L / 3, 50, W - 20, '#c89a1a', tilt, PAINT);
      B.add('glass', T.box(), [L / 4, 62, 0], [L / 3 - 4, 14, W - 18], tilt, '#1a2830', GLASSY);
      B.box('std', -L / 5, 60, 0, L * 0.5, 6, 8, '#d8a81a', [0, 0, 0.4], PAINT);
      P.pic(B, 'mt_track', -L / 4, 22, W / 2 + 1, 60, 22, 0);
    },
    /** A stack of sleepers. */
    sleepers(P) {
      const { B } = P;
      const [L, D] = long(P);
      for (let j = 0; j < 4; j++) for (let i = 0; i < Math.floor(D / 14); i++) B.box('std', 0, 4 + j * 8, -D / 2 + 7 + i * 14 + (j % 2) * 3, L, 7, 11, j % 2 ? '#8a867c' : '#5a4a3a', null, j % 2 ? CONC : WOODS);
    },
    /** A hand trolley on the rails. */
    railtrolley(P) {
      const { B } = P;
      const [L, D] = long(P);
      B.block('std', 0, 10, 0, L, 4, D, '#5a6066', null, STEEL);
      for (const e of [-1, 1]) for (const z of [-D / 2 + 6, D / 2 - 6]) B.cylZ('std', e * (L / 2 - 10), 8, z, 7, 3, '#2a2a2a', 10, STEEL);
      rod(B, 'std', [-L / 2, 14, 0], [-L / 2 - 14, 40, 0], 1.2, '#3a3d40', STEEL);
      B.rblock('std', 0, 14, 0, L * 0.6, 12, D * 0.5, 1, '#c8583a', null, PAINT);
    },
    /** A drainage pump: the motor, the volute, its pipes into the floor. */
    pump(P) {
      const { B, L, W } = P;
      B.block('std', 0, 0, 0, L, 10, W, '#5a5e62', null, CONC);
      B.cylX('std', -L * 0.15, 32, 0, 22, L * 0.5, '#2a5a7a', 16, PAINT);
      B.cylZ('std', L * 0.25, 30, 0, 26, W * 0.5, '#3a6a8a', 18, PAINT);
      B.cyl('std', L * 0.25, 54, 0, 8, 90, '#5a6066', 10, 1, null, STEEL);
      B.cyl('std', L * 0.25, 0, W * 0.3, 8, 30, '#5a6066', 10, 1, null, STEEL);
      P.pic(B, 'mt_hv', -L * 0.15, 32, 22.5, 14, 14, 0);
    },
    /** The pump control panel on the wall: gauges, lamps, a dead screen (facing into the room). */
    pumppanel(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x + 300, o.y);
      B.block('std', 0, 0, 0, L, 90, D * 0.6, '#c8c4b8', null, PAINT);
      P.pic(B, 'mt_gauges', -L * 0.25, 64, f * (D * 0.3 + 0.3), 50, 25, f > 0 ? 0 : Math.PI);
      P.pic(B, 'mt_breaker', L * 0.2, 44, f * (D * 0.3 + 0.3), 60, 30, f > 0 ? 0 : Math.PI);
      P.pic(B, 'mt_pump', 0, 98, f * (D * 0.3 + 0.3), 80, 20, f > 0 ? 0 : Math.PI);
      for (let i = 0; i < 4; i++) P.glow(B, -L * 0.3 + i * 12, 82, f * (D * 0.3 + 0.6), 3, 3, 0.4, i === 1 ? '#ff3a2a' : '#3a3a30', P.day ? 0.6 : 2);
    },
    /** The sump valve: a manifold of pipes on the wall, the big handwheel. */
    valve(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x, o.y - 300);
      B.cylX('std', 0, 40, 0, 12, L, '#4a5a4a', 14, PAINT);
      for (const x of [-L * 0.35, L * 0.35]) B.cyl('std', x, 0, 0, 10, 80, '#4a5a4a', 12, 1, null, PAINT);
      B.cyl('std', 0, 40, 0, 18, 30, '#3a4a3a', 14, 1, [HALF, 0, 0], PAINT);
      B.add('std', T.torus(16, 0.12, 6), [0, 40, f * (D / 2 + 6)], [22, 22, 22], null, '#b3120e', PAINT);
      for (let k = 0; k < 3; k++) B.box('std', 0, 40, f * (D / 2 + 6), 44, 2, 2, '#b3120e', [0, 0, (k * Math.PI) / 3], PAINT);
      P.pic(B, 'mt_bulkhead', 0, 90, f * (D / 2 - 1), 80, 20, f > 0 ? 0 : Math.PI);
    },
    /** A brick pier holding the sump's vault. */
    'mt-brickcol'(P) {
      const { B, o, L } = P;
      const top = o.top || 190;
      B.block('std', 0, 0, 0, L, top, L, '#7a4a3a', null, S(DET.brick, 0.85, 0));
      B.block('std', 0, 0, 0, L + 6, 20, L + 6, '#5a5a52', null, CONC);
      if (P.lod() >= 1) P.decal(B, 'wstain', 0, 60, L / 2 + 0.4, L, 100, 0);
    },
    /** Switchgear: tall grey cabinets with breakers, a warning plate. */
    switchgear(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L - 2, 100, W, 0.6, '#8a9096', null, S(DET.panel, 0.5, 0.5));
      P.pic(B, 'mt_breaker', 0, 56, W / 2 + 0.3, L - 14, 54, 0);
      P.pic(B, 'mt_hv', L * 0.3, 90, W / 2 + 0.4, 14, 14, 0);
      B.box('std', -L / 2 + 6, 50, W / 2 + 1, 2, 30, 2, '#2a2c2e', null, STEEL);
    },
    /** A steel workbench: a vice, tools, a toolbox, a lamp. */
    workbench(P) {
      const { B, L, W, o } = P;
      B.box('std', 0, 30, 0, L, 3, W, '#5a4a3a', null, WOODS);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', x * (L / 2 - 3), 15, z * (W / 2 - 3), 3, 30, 3, '#3a4a5a', null, STEEL);
      B.box('std', 0, 8, 0, L - 6, 2, W - 6, '#3a4a5a', null, STEEL);
      B.rblock('std', -L * 0.35, 31.5, 0, 14, 8, 10, 0.5, '#2a5a8a', null, STEEL);
      B.rblock('std', L * 0.2, 31.5, -4, 30, 12, 14, 1, '#c8231b', null, PAINT);
      for (let i = 0; i < 5; i++) B.box('std', (hash01(o.id + i) - 0.5) * L * 0.7, 32, (hash01(o.id * 3 + i) - 0.5) * W * 0.6, 12, 1.2, 2, '#8a9096', [0, hash01(i) * 3, 0], STEEL);
      B.block('std', 0, 33, -W / 2 + 2, L, 50, 2, '#7a7a72', null, S(DET.panel, 0.6, 0.3));
    },
    /** A lathe. */
    lathe(P) {
      const { B, L, W } = P;
      B.block('std', 0, 0, 0, L * 0.9, 30, W * 0.6, '#3a5a4a', null, PAINT);
      B.block('std', -L * 0.35, 30, 0, L * 0.2, 26, W * 0.6, '#3a5a4a', null, PAINT);
      B.cylX('std', 0, 44, 0, 4, L * 0.6, '#b8bcc0', 10, CHROME);
      B.block('std', L * 0.3, 30, 0, L * 0.12, 18, W * 0.5, '#3a5a4a', null, PAINT);
    },
    /** A rail maintenance cart: a flatbed on wheels, its little cab, cable drums. */
    railcart(P) {
      const { B, L, W } = P;
      B.block('std', 0, 14, 0, L, 10, W, '#c8583a', null, PAINT);
      for (const e of [-1, 1]) for (const z of [-W / 2 + 14, W / 2 - 14]) B.cylZ('std', e * (L / 2 - 30), 11, z, 11, 6, '#2a2a2a', 12, STEEL);
      B.block('std', L / 2 - 40, 24, 0, 70, 50, W - 10, '#d8a81a', null, PAINT);
      B.add('glass', T.box(), [L / 2 - 40, 58, 0], [66, 14, W - 8], null, '#1a2830', GLASSY);
      for (const x of [-L * 0.3, -L * 0.1]) B.cylZ('std', x, 44, 0, 20, 30, '#7a5a3a', 14, WOODS);
    },
    /** Steel racking of parts: cable drums, boxes, pipes. */
    'shelf-parts'(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      for (let x = -L / 2 + 2; x <= L / 2 - 2; x += Math.min(100, L - 4)) for (const e of [-1, 1]) B.box('std', x, 50, e * (D / 2 - 1.5), 3, 100, 3, '#3a5a8a', null, PAINT);
      for (const y of [30, 64, 98]) B.box('std', 0, y, 0, L, 2, D, '#5a6066', null, STEEL);
      for (let k = 0; k < Math.floor(L / 30); k++) {
        const r = hash01(o.id * 7 + k);
        if (r < 0.3) continue;
        const y = [31, 65][k % 2];
        if (r < 0.6) B.cylZ('std', -L / 2 + 15 + k * 30, y + 11, 0, 11, D - 8, '#7a5a3a', 12, WOODS);
        else B.rblock('std', -L / 2 + 15 + k * 30, y, 0, 22, 16, D - 8, 0.5, '#b89a6a', null, S(DET.fabric, 0.9, 0));
      }
    },
    /** The statue of Elias Harlan on his plinth: a figure in a long coat, an arm raised, pigeons' streaks. */
    statue(P) {
      const { B, L } = P;
      B.block('std', 0, 0, 0, L, 12, L, '#8a867c', null, S(DET.terrazzo, 0.4, 0));
      B.block('std', 0, 12, 0, L * 0.7, 60, L * 0.7, '#a8a296', null, S(DET.terrazzo, 0.4, 0));
      B.block('std', 0, 72, 0, L * 0.78, 6, L * 0.78, '#8a867c', null, S(DET.terrazzo, 0.4, 0));
      P.pic(B, 'mt_plaque', 0, 46, L * 0.35 + 0.3, 40, 20, 0);
      const bz = '#4a5a48';
      B.add('std', T.cyl(12, 0.8), [0, 78 + 34, 0], [16, 68, 13], null, bz, BRONZE);          // the coat
      B.add('std', T.sphere(10, 8), [0, 78 + 76, 0], [10, 11, 9], null, bz, BRONZE);          // shoulders
      B.add('std', T.sphere(10, 8), [0, 78 + 92, 0], [6, 7.5, 6.5], null, bz, BRONZE);         // head
      B.add('std', T.cyl(8, 0.7), [-12, 78 + 92, 0], [3, 34, 3], [0, 0, 0.5], bz, BRONZE);    // the raised arm
      B.add('std', T.cyl(8, 0.7), [11, 78 + 62, 2], [3, 28, 3], [0, 0, -0.15], bz, BRONZE);
      if (P.lod() >= 1) P.decal(B, 'wstain', 0, 50, L * 0.35 + 0.5, 50, 60, 0, { color: '#e8e8e0' });
    },
    filing: HOSP.filing,
  };

  // ---------------------------------------------------------------------------------------------
  // the free items

  const ITEMS = {
    /** HARLAN METRO over the station's doors, roundels on posts either side (faces west, onto the street). */
    bigsign(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, HALF, 41, 0);
      const H = it.hy || 510, w = it.w || 460;
      B.box('std', 0, H, -1, w + 20, 80, 6, '#1a1c20', null, PAINT);
      P.pic(B, 'mt_name', 0, H, 2.2, w, w * 112 / 768, 0, { lit: !P.day, k: 1.1 });
      for (const e of [-1, 1]) {
        const x = e * 230, g = P.gy(it.x - 60, it.y + x * -1);
        B.cyl('std', x, g, 60, 3, 120, '#3a3d40', 8, 1, null, STEEL);
        for (const f of [1, -1]) P.pic(B, 'mt_roundel', x, g + 132, 60 + f * 1.6, 40, 40, f > 0 ? 0 : Math.PI, { lit: !P.day, k: 1.2 });
      }
    },
    /** A flight of stairs over the terrain's: steps with nosings, the handrails, the sloped soffit and its lamps. */
    stairflight(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 43, 0);
      const { x0, x1, y0, y1, h0, h1 } = it;
      const rise = h1 - h0, run = x1 - x0, wid = y1 - y0, yc = (y0 + y1) / 2;
      const n = Math.max(4, Math.round(rise / 8));
      const sr = run / n, sh = rise / n;
      const svc = !!it.service;
      // (dir -1: the top, h1, at x0; the foot, h0, at x1)
      for (let i = 0; i < n; i++) {
        const top = h0 + (i + 1) * sh, xa = x1 - (i + 1) * sr;
        B.block('std', xa + sr / 2, top - sh - 6, yc, sr, sh + 6, wid, svc ? '#7a7a72' : '#9a948a', null, svc ? CONC : S(DET.terrazzo, 0.45, 0));
        B.box('std', xa + 1.5, top - 0.6, yc, 3, 1.4, wid, svc ? '#c8a01a' : '#3a3d40', null, svc ? PAINT : STEEL);
      }
      // the side handrails, a centre rail on the wide ones
      const ang = Math.atan2(rise, run);
      const len = Math.hypot(rise, run);
      for (const z of [y0 + 6, y1 - 6, ...(wid > 200 ? [yc] : [])]) {
        B.add('std', T.box(), [(x0 + x1) / 2, (h0 + h1) / 2 + 36, z], [len, 2.6, 2.6], [0, 0, -ang], z === yc ? '#b8bcc0' : '#8a9096', z === yc ? CHROME : STEEL);
        if (z === yc) for (let k = 1; k < 4; k++) { const x = x1 - (k * run) / 4; B.cyl('std', x, h0 + (k * rise) / 4, z, 1.4, 36, '#b8bcc0', 6, 1, null, CHROME); }
      }
      // the soffit (a sloped ceiling over the flight), its strip lamps
      const clear = svc ? 120 : 150;
      const sx0 = it.lantern ? x0 + 220 : x0;
      const hs0 = h1 + clear - ((sx0 - x0) / run) * rise;
      B.quad('std', [(sx0 + x1) / 2, (hs0 + h0 + clear) / 2, yc], [x1 - sx0, h0 - (h1 - ((sx0 - x0) / run) * rise), 0], [0, 0, wid], svc ? '#9a9a90' : '#e4e0d4', S(DET.plaster, 0.8, 0));
      if (it.lantern) {
        // a glazed lantern over the stair's head: the day falls down the stairwell
        const hy = h1 + clear + 20;
        for (let x = x0; x <= sx0 + 0.1; x += 44) B.box('std', x, hy, yc, 3, 3, wid, '#3a3d40', null, STEEL);
        B.box('std', (x0 + sx0) / 2, hy, y0 + 2, sx0 - x0, 6, 4, '#3a3d40', null, STEEL);
        B.box('std', (x0 + sx0) / 2, hy, y1 - 2, sx0 - x0, 6, 4, '#3a3d40', null, STEEL);
        state.glass.push({ c: [(x0 + sx0) / 2, hy + 1, yc], e1: [sx0 - x0, 0, 0], e2: [0, 0, -wid] });
        // (the well's sides face in; its end over the soffit faces down the flight)
        for (const z of [y0, y1]) B.quad('std', [(x0 + sx0) / 2, (hs0 + hy) / 2, z], [z === y0 ? sx0 - x0 : -(sx0 - x0), 0, 0], [0, hy - hs0, 0], '#e4e0d4', S(DET.plaster, 0.8, 0));
        B.quad('std', [sx0, (hs0 + hy) / 2, yc], [0, 0, -wid], [0, hy - hs0, 0], '#e4e0d4', S(DET.plaster, 0.8, 0));
      }
      if (P.lod() >= 1 && P.lod() < 3) for (let k = 0; k < 3; k++) P.flat(B, 'grime', x0 + run * (0.2 + 0.3 * k), h1 - rise * (0.2 + 0.3 * k) + 1, yc + (k - 1) * 40, 60, 40, k);
    },
    /** A shuttered shop front with its fascia. */
    shopfront(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, it.a || 0, Math.round(it.x), it.base || 0);
      const w = it.w, H = it.h - 30;
      B.block('std', 0, H, -1, w + 10, 26, 4, '#1a1c20', null, PAINT);
      P.pic(B, 'mt_' + it.name, 0, H + 13, 1.2, Math.min(w - 10, 300), 20, 0);
      B.block('std', 0, 0, 1, w, H, 1.6, '#9aa0a4', null, S(DET.corrugated, 0.5, 0.6));
      B.box('std', 0, H - 6, 2, w, 12, 10, '#5a6066', null, STEEL);
      P.decal(B, 'g_tag2', w * 0.15, H * 0.5, 2.1, 90, 34, 0);
    },
    /** A shop's fascia over its windows. */
    fascia(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, it.a || 0, Math.round(it.x), it.base || 0);
      B.block('std', 0, 100, -1.5, it.w, 26, 3, '#1a1c20', null, PAINT);
      P.pic(B, 'mt_' + it.name, 0, 113, 0.4, Math.min(it.w - 20, 320), 20, 0, { lit: !P.day, k: 0.8 });
    },
    /** Pavement lights: glass-block panels in the concourse ceiling (the street's lights from below). */
    pavementlights(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 45, 0);
      for (const p of PAVEMENT) {
        B.box('std', (p.x0 + p.x1) / 2, it.h - 2, (p.y0 + p.y1) / 2, p.x1 - p.x0 + 12, 4, p.y1 - p.y0 + 12, '#5a6066', null, STEEL);
        // glass blocks: a lit panel by day, dark by night, the grid of the frame over it
        B.add('lvlit', T.plane(), [(p.x0 + p.x1) / 2, it.h - 4.2, (p.y0 + p.y1) / 2], [p.x1 - p.x0, p.y1 - p.y0, 1], [HALF, 0, 0], P.day ? '#d8e8f0' : '#202830', { uv: P.atlas.uv('white'), noAO: true, noJitter: true, emissive: P.day ? 1.4 : 0.3 });
        for (let x = p.x0 + 20; x < p.x1; x += 20) B.box('std', x, it.h - 4.6, (p.y0 + p.y1) / 2, 1.4, 1, p.y1 - p.y0, '#3a3d40', null, STEEL);
        for (let y = p.y0 + 20; y < p.y1; y += 20) B.box('std', (p.x0 + p.x1) / 2, it.h - 4.6, y, p.x1 - p.x0, 1, 1.4, '#3a3d40', null, STEEL);
      }
    },
    /** Rails: per track two rails on concrete sleepers in ballast, the conductor rail on its insulators. */
    rails(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 47, 0);
      const ax = it.axis !== 'y';
      const a0 = ax ? it.x0 : it.y0, a1 = ax ? it.x1 : it.y1;
      const len = a1 - a0, mid = (a0 + a1) / 2;
      const G = 23;
      for (const c of ax ? it.ys : it.xs) {
        const box = (along, y, across, sa, sy, sc, color, surf) => (ax ? B.box('std', along, y, c + across, sa, sy, sc, color, null, surf) : B.box('std', c + across, y, along, sc, sy, sa, color, null, surf));
        const flat = (along, across, sa, sc, color) => (ax ? B.quad('lvfloor', [along, 0.06, c + across], [sa, 0, 0], [0, 0, -sc], color, { noAO: true, surf: [DET.gravel, 0.95, 0] }) : B.quad('lvfloor', [c + across, 0.06, along], [sc, 0, 0], [0, 0, -sa], color, { noAO: true, surf: [DET.gravel, 0.95, 0] }));
        flat(mid, 0, len, 90, '#4a4640');
        for (const e of [-1, 1]) box(mid, 3.4, e * G, len, 3.2, 2.2, '#6d6a66', S(DET.rust, 0.4, 0.8));
        for (const e of [-1, 1]) box(mid, 5.2, e * G, len, 0.6, 2.4, '#b8bcc0', CHROME);
        if (P.lod() >= 1) {
          for (let s = a0 + 10; s < a1; s += 24) box(s, 1, 0, 9, 2.4, 70, '#8a867c', CONC);
        }
        box(mid, 6, G + 22, len, 3, 5, '#d8b01a', PAINT);
      }
    },
    /** The platform's edge: the coping, the yellow line, the tactile strip, the face down to the track. */
    platformedge(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 49, 0);
      const h = it.h, z = it.y;
      const L = it.x1 - it.x0, cx = (it.x0 + it.x1) / 2;
      B.box('std', cx, h - 2, z + 8, L, 4.4, 16, '#c8c4b8', null, S(DET.slab, 0.6, 0));
      B.quad('lvfloor', [cx, h + 0.25, z + 22], [L, 0, 0], [0, 0, -5], '#f2c21a', { noAO: true, surf: [0, 0.6, 0] });
      B.quad('lvfloor', [cx, h + 0.22, z + 34], [L, 0, 0], [0, 0, -14], '#d8c8a0', { noAO: true, surf: [DET.hesco, 0.7, 0] });
      B.quad('std', [cx, h / 2, z], [-L, 0, 0], [0, h, 0], '#6d6a62', CONC);
      for (let x = it.x0 + 300; x < it.x1; x += 700) P.flat(B, 'mt_mind', x, h + 0.3, z + 50, 110, 14, 0, { bucket: 'lvpic' });
    },
    /** A car of the dead train: the roof, the underframe and bogies, couplers, poles and rails inside, the blind. */
    traincar(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 51 + it.k, 0);
      const L = it.x1 - it.x0, Wd = it.y1 - it.y0, h = it.h;
      const top = h + 92;
      // the roof: a low curve over the car
      for (const [dz, dy, wz, rx] of [[0, 8, Wd * 0.5, 0], [Wd * 0.33, 4, Wd * 0.3, -0.22], [-Wd * 0.33, 4, Wd * 0.3, 0.22]]) B.box('std', 0, top + dy, dz, L, 4, wz, '#b8bcc0', [rx, 0, 0], STEEL);
      // the underframe's skirts and the bogies' wheels (the car's floor is the terrain's raised block)
      for (const ez of [-1, 1]) {
        B.box('std', 0, h / 2 + 4, ez * (Wd / 2 + 1), L - 30, h - 6, 1.2, '#2a2c2e', null, STEEL);
        for (const e of [-1, 1]) {
          B.box('std', e * (L / 2 - 90), 14, ez * (Wd / 2 + 2.4), 120, 18, 2, '#1a1c1e', null, STEEL);
          for (const ex of [-1, 1]) B.cylZ('std', e * (L / 2 - 90) + ex * 38, 12, ez * (Wd / 2 + 4), 11, 3, '#3a3a3a', 14, STEEL);
        }
      }
      if (it.k < 2) B.box('std', L / 2 + 10, h + 20, 0, 22, 12, 30, '#1a1c1e', null, STEEL);
      // inside: grab poles, overhead rails, an advert strip along the cove
      if (P.lod() >= 1) {
        for (let x = -L / 2 + 100; x < L / 2 - 60; x += 180) B.cyl('std', x, h, 0, 1.4, 92, '#c9ced3', 8, 1, null, CHROME);
        for (const z of [-Wd / 2 + 30, Wd / 2 - 30]) B.cylX('std', 0, top - 12, z, 1, L - 40, '#c9ced3', 8, CHROME);
        for (let x = -L / 2 + 80; x < L / 2 - 80; x += 160) for (const [z, ry] of [[Wd / 2 - 12.5, Math.PI], [-Wd / 2 + 12.5, 0]]) P.pic(B, ['mt_ad1', 'mt_ad2', 'mt_ad3', 'mt_ad4'][Math.abs(Math.round(x + z)) % 4], x, top - 8, z, 40, 12, ry, { rx: ry ? -0.3 : 0.3 });
      }
      // the head: the destination blind and the headlights at the cab end
      if (it.cab) {
        const xf = L / 2 + 1;
        P.pic(B, 'mt_dest', xf, top - 10, 0, 50, 10, HALF, { lit: !P.day, k: 1.2 });
        for (const e of [-1, 1]) B.cylX('std', xf, h + 18, e * 50, 6, 3, '#f4f0e0', 10, PLAST);
        B.box('std', xf - 1, h + 4, 0, 4, 10, Wd - 10, '#d8b01a', null, PAINT);
      }
      for (const [z, ry] of [[Wd / 2 + 0.7, 0], [-Wd / 2 - 0.7, Math.PI]]) P.pic(B, 'mt_carno', -L / 2 + 50, top - 18, z, 24, 9, ry);
      if (P.lod() >= 1) P.decal(B, it.k === 1 ? 'g_tag1' : 'g_tag2', L * 0.2, h + 40, -Wd / 2 - 0.9, 110, 40, Math.PI);
    },
    /** The collapse over the platform: the broken vault, hanging slabs and cables, dust. */
    collapse(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 53, 0);
      const H = 240 + 40;
      for (let k = 0; k < 5; k++) {
        const x = (hash01(k + 3) - 0.5) * it.w * 0.8, z = (hash01(k * 7) - 0.5) * it.d * 0.8;
        B.box('std', x, H - 30 - k * 10, z, 80 + k * 10, 8, 60, '#d8d4c8', [0.4 + k * 0.1, k, 0.3], S(DET.tile, 0.6, 0));
        rod(B, 'std', [x, H + 20, z], [x + 10, H - 60 - k * 12, z + 6], 0.5, '#1a1a1a', STEEL);
      }
      for (let k = 0; k < 8; k++) P.flat(B, 'soot', (hash01(k) - 0.5) * it.w * 1.4, 40.4, (hash01(k * 3) - 0.5) * it.d * 1.2, 140, 120, k);
    },
    /** The station's name on the platform's back wall (enamel). */
    stationname(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, it.a || 0, 55, 0);
      const h = (it.h || 40) + 120;
      B.box('std', 0, h, -0.6, 220, 40, 1.2, '#16306a', null, PAINT);
      P.pic(B, 'mt_station', 0, h, 0.2, 210, 33, 0);
      // a 48-sheet advert either side
      for (const e of [-1, 1]) {
        B.box('std', e * 260, h - 10, -0.6, 200, 100, 1.4, '#2a2c2e', null, STEEL);
        P.pic(B, ['mt_ad1', 'mt_ad2', 'mt_ad3', 'mt_ad4'][Math.abs(Math.round(it.x / 100 + e)) % 4], e * 260, h - 10, 0.3, 190, 92, 0);
      }
    },
    /** A signal on its bracket (the aspect: the lamps set). */
    signal(P) {
      const { B } = P;
      B.box('std', 0, 100, -6, 4, 4, 12, '#2a2c2e', null, STEEL);
      B.rblock('std', 0, 76, 4, 16, 48, 12, 2, '#1a1a1a', null, PAINT);
      for (const y of [86, 100, 114].map((v) => v - 12)) {
        B.cyl('std', 0, y, 10.4, 4.4, 1, '#0a0a0a', 12, 1, [HALF, 0, 0], STEEL);
        B.box('std', 0, y + 5, 12, 10, 1, 4, '#1a1a1a', null, STEEL);
      }
    },
    /** Cable runs on brackets along a tunnel wall. */
    cables(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, it.a || 0, 57, 0);
      const len = it.axis === 'y' ? it.y1 - it.y0 : it.x1 - it.x0;
      for (let t = -len / 2 + 30; t < len / 2; t += 120) B.box('std', t, 108, 0, 3, 34, 8, '#5a6066', null, STEEL);
      [92, 100, 108, 116, 124].forEach((y, i) => B.cylX('std', 0, y, (i % 2) * 2, i === 2 ? 2.4 : 1.6, len, ['#1a1a1a', '#2a2a2a', '#3a2a1a', '#1a1a1a', '#5a3a1a'][i], 6, RUBBER));
    },
    /** The sump's standing water (the surface is the level's water mesh) and what floats on it. */
    floodwater(P) {
      const { B, it } = P;
      state.waters.push({ x: (it.x0 + it.x1) / 2, y: (it.y0 + it.y1) / 2, w: it.x1 - it.x0, d: it.y1 - it.y0, h: it.h, kind: 'rect' });
      if (P.lod() < 1) return;
      P.at(B, 0, 0, 0, 59, 0);
      for (let k = 0; k < 14; k++) {
        const x = it.x0 + 40 + hash01(k * 3) * (it.x1 - it.x0 - 80), z = it.y0 + 40 + hash01(k * 7) * (it.y1 - it.y0 - 80);
        if (k % 3 === 0) B.box('std', x, it.h + 0.6, z, 14, 1.4, 8, '#e8e4d8', [0, k, 0], PLAST);
        else P.flat(B, 'mud', x, it.h + 0.3, z, 60, 50, k);
      }
      P.flat(B, 'mt_noentry', it.x1 - 120, it.h + 0.5, it.y0 + 60, 50, 14, 0, { bucket: 'lvpic' });
    },
    /** Big pipes along the sump's north wall, their flanges and valves. */
    pipes(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 61, 0);
      const L = it.x1 - it.x0, cx = (it.x0 + it.x1) / 2;
      for (const [y, r, c] of [[110, 14, '#4a5a4a'], [146, 9, '#7a5a3a']]) {
        B.cylX('std', cx, y, it.y, r, L, c, 14, PAINT);
        for (let x = it.x0 + 100; x < it.x1; x += 240) B.cylX('std', x, y, it.y, r + 2.4, 4, shadeHex(c, -0.15), 14, PAINT);
      }
      for (let x = it.x0 + 160; x < it.x1; x += 400) B.box('std', x, 128, it.y - 8, 4, 50, 6, '#3a3d40', null, STEEL);
    },
    /** The works' gantry crane: runway beams, the bridge, the hoist and its hook. */
    gantry(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 63, 0);
      const H = it.h || 200;
      for (const z of [it.y0 + 30, it.y1 - 30]) B.box('std', (it.x0 + it.x1) / 2, H - 6, z, it.x1 - it.x0 - 20, 12, 10, '#d8a81a', null, PAINT);
      const bx = it.x0 + (it.x1 - it.x0) * 0.42;
      B.box('std', bx, H - 16, (it.y0 + it.y1) / 2, 18, 16, it.y1 - it.y0 - 60, '#d8a81a', null, PAINT);
      B.rblock('std', bx, H - 34, (it.y0 + it.y1) / 2 + 80, 30, 18, 26, 1, '#3a3d40', null, STEEL);
      B.cyl('std', bx, H - 120, (it.y0 + it.y1) / 2 + 80, 0.7, 86, '#2a2a2a', 6, 1, null, STEEL);
      B.add('std', T.torus(10, 0.3, 5), [bx, H - 126, (it.y0 + it.y1) / 2 + 80], [5, 5, 5], [0, 0, 0], '#c8a01a', PAINT);
      P.pic(B, 'mt_caution', bx, H - 16, (it.y0 + it.y1) / 2, 18, 8, HALF);
    },
    /** The exit at the square: a canopy over the stair's head, the roundel on its post, the way-out signs. */
    entrance(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 65, it.h);
      const w = it.w, d = it.d;
      for (const z of [-d / 2 + 6, d / 2 - 6]) B.cyl('std', -w / 2 + 6, 0, z, 3, 110, '#2a3a2a', 10, 1, null, STEEL);
      B.box('std', 0, 112, 0, w + 20, 4, d + 10, '#2a3a2a', null, STEEL);
      B.add('vglass', T.plane(), [0, 114.2, 0], [w + 14, d + 4, 1], [-HALF, 0, 0], '#a8bcc4', { noAO: true, noJitter: true });
      B.box('std', -w / 2 - 4, 122, 0, 4, 16, d + 10, '#1d3f7a', null, PAINT);
      P.pic(B, 'mt_name', -w / 2 - 6.2, 122, 0, d - 20, 14, -HALF, { lit: !P.day, k: 1 });
      B.cyl('std', -w / 2 - 30, 0, -d / 2 - 20, 3, 130, '#3a3d40', 8, 1, null, STEEL);
      for (const f of [1, -1]) P.pic(B, 'mt_roundel', -w / 2 - 30 + f * 1.6, 142, -d / 2 - 20, 40, 40, f > 0 ? HALF : -HALF, { lit: !P.day, k: 1.2 });
      // the way-out sign at the top of the flight, for those coming up
      P.pic(B, 'mt_square', w / 2 + 20, 96, 0, 90, 22, HALF);
      exitBox(P, w / 2 + 20, 76, 0, HALF);
    },
  };

  return { OBSTACLES, ITEMS };
}

/** The concourse's pavement-light panels (glass blocks in the ceiling; the day shines through them). */
export const PAVEMENT = Object.freeze([3950, 4450, 4950].flatMap((x) => [1850, 2350].map((y) => ({ x0: x - 120, y0: y - 90, x1: x + 120, y1: y + 90 }))));

void METRO; void slopedWall;
