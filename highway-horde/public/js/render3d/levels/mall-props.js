// Westgate's props (render3d/levels/mall.js): the obstacles by their style tag (the fountain, palms,
// kiosks, the food court's counters and tables, Harrow's counters, racks and shelving, the garage's
// columns and booth, the dock's dumpsters...) and the free items of `map.levelArt` (the flood water, the
// pylon sign, the entrance canopy, the escalators, the shop fronts, the mezzanine, the ramps, the decks,
// the dock bays, the roofs). Every model is written in its frame: local +x along the obstacle's `w`,
// +z along its `h`, +y up; the world placed the frame on the terrain (the gallery's props stand at 150).
//
// `mallProps(state)` binds the models to one build: the water surfaces they find (the fountain, the flood)
// go to `state.waters` for the level's water mesh.

import * as THREE from 'three';
import { T, DET, S, STEEL, CHROME, PAINT, PLAST, FABRIC, WOODS, CONC, shadeHex, hash01 } from './hospital-kit.js';
import { OBSTACLES as HOSP } from './hospital-props.js';
import { rod } from '../dress-kit.js';
import { ridgeTent } from '../world-hideout-kit.js';
import { cardList, listGeo, stripCard } from '../world-flora.js';
import { LEAF_CELLS } from '../world-tex.js';
import { roomId } from '../world-arch.js';
import { SHOPS, STALLS } from './mall-atlas.js';

const HALF = Math.PI / 2;
const RUBBER = S(DET.rubber, 0.9, 0);
const GRANITE = S(DET.terrazzo, 0.3, 0);
const GLASSY = S(DET.glass, 0.08, 0.3);

/** The atrium's glass vault (the art's shared numbers: the roof leaves its hole, the ceiling fills it). */
export const VAULT = Object.freeze({ x0: 2616, y0: 1500, x1: 4984, y1: 3100, base: 430, rise: 150, bays: 8 });
/** The food court's skylights (wells through the ceiling at 300 and the roof at 330). */
export const SKYLIGHTS = Object.freeze([5350, 6100, 6850].flatMap((x) => [1850, 2800].map((y) => ({ x0: x - 150, y0: y - 120, x1: x + 150, y1: y + 120 }))));

// ---------------------------------------------------------------------------------------------
// small helpers

/** Re-place the frame so local x runs along the obstacle's long side; returns [long, short]. */
function long(P, base = null) {
  const { B, o } = P;
  const a = (o.a || 0) + (o.w >= o.h ? 0 : HALF);
  if (base === null) B.obj(o.x, o.y, a, o.id * 31);
  else P.at(B, o.x, o.y, a, o.id * 31, base);
  P.fa = a;
  return [Math.max(o.w, o.h), Math.min(o.w, o.h)];
}

/** +1 when the frame's local +z (after `long`) points toward world (tx, ty), else -1. */
function faceTo(P, tx, ty) {
  const a = P.fa ?? (P.o.a || 0);
  const zx = -Math.sin(a), zy = Math.cos(a);
  return (tx - P.o.x) * zx + (ty - P.o.y) * zy >= 0 ? 1 : -1;
}

/** A sloped band along local x from t0 to t1: bottom (h0 - down → h1 - down), top (h0 + up → h1 + up), `th` thick. */
function slopedWall(B, t0, t1, h0, h1, up, down, th, color, surf) {
  const len = t1 - t0, dh = h1 - h0, mid = (t0 + t1) / 2, hm = (h0 + h1) / 2;
  const H = up + down, yc = hm + (up - down) / 2;
  B.quad('std', [mid, yc, th / 2], [len, dh, 0], [0, H, 0], color, surf);
  B.quad('std', [mid, yc, -th / 2], [-len, -dh, 0], [0, H, 0], color, surf);
  B.quad('std', [mid, hm + up, 0], [len, dh, 0], [0, 0, -th], shadeHex(color, -0.1), surf);
}

/** A shopping cart (facing local +x) in its own frame at world (x, y). */
function cart(P, x, y, a, base, seed, tipped = false) {
  const { B } = P;
  P.at(B, x, y, a, seed, base);
  const c = '#a8aeb4';
  const L = 34, W = 22, y0 = tipped ? 2 : 16, H = 18;
  const r = tipped ? [HALF * 0.95, 0, 0] : null;
  if (tipped) {
    // on its side: the basket as a box of wire, the wheels in the air
    B.box('std', 0, 11, 0, L, 22, 2, c, null, CHROME);
    P.pic(B, 'wg_grille', 0, 11, 1.2, L, 20, 0);
    P.pic(B, 'wg_grille', 0, 11, -1.2, L, 20, Math.PI);
    for (const x0 of [-L / 2, L / 2]) B.cylX('std', x0, 20, 12, 2.4, 2, '#1c1c1c', 8, RUBBER);
    return;
  }
  for (const [px, pz, ry, w] of [[0, W / 2, 0, L], [0, -W / 2, Math.PI, L], [L / 2, 0, HALF, W], [-L / 2, 0, -HALF, W]]) {
    P.pic(B, 'wg_grille', px, y0 + H / 2, pz, w, H, ry);
    P.pic(B, 'wg_grille', px * 0.97, y0 + H / 2, pz * 0.95, w, H, ry + Math.PI);
  }
  B.box('std', 0, y0, 0, L, 1, W, c, r, CHROME);
  for (const [px, pz, sx, sz] of [[0, W / 2, L, 1.2], [0, -W / 2, L, 1.2], [L / 2, 0, 1.2, W], [-L / 2, 0, 1.2, W]]) B.box('std', px, y0 + H, pz, sx, 1.2, sz, c, null, CHROME);
  B.cylZ('std', -L / 2 - 4, y0 + H + 3, 0, 1.4, W + 2, '#c62828', 8, PLAST);
  for (const [px, pz] of [[-L / 2 + 2, -W / 2 + 2], [-L / 2 + 2, W / 2 - 2], [L / 2 - 4, -W / 2 + 4], [L / 2 - 4, W / 2 - 4]]) {
    B.box('std', px, y0 / 2 + 1, pz, 1.2, y0 - 2, 1.2, c, null, CHROME);
    B.cylZ('std', px, 2.4, pz, 2.4, 1.6, '#1c1c1c', 8, RUBBER);
  }
}

/** A shelf unit along local x (two-faced: goods pictures both sides), `levels` shelves up to H. */
function gondola(P, L, D, H, levels, cell, o = {}) {
  const { B } = P;
  const col = o.color || '#dcdcd6';
  B.block('std', 0, 0, 0, L, 8, D, shadeHex(col, -0.2), null, PAINT);
  B.block('std', 0, 8, 0, L, H - 8, 3, col, null, PAINT);
  for (const e of [-1, 1]) B.block('std', e * (L / 2 - 1), 0, 0, 2, H, D, shadeHex(col, -0.1), null, PAINT);
  const dh = (H - 12) / levels;
  for (let i = 0; i < levels; i++) {
    const y = 10 + i * dh;
    for (const s of o.oneSided ? [1] : [-1, 1]) {
      B.box('std', 0, y, s * (D / 4 + 1), L - 4, 1.2, D / 2 - 2, shadeHex(col, -0.05), null, STEEL);
      // the goods (a picture) with gaps where they were taken
      if (hash01(Math.round(P.o.x + P.o.y) + i * 7 + s) < (o.empty ?? 0.12)) continue;
      P.pic(B, cell, 0, y + dh / 2 + 0.6, s * (D / 2 - 1.5), L - 6, dh - 2, s > 0 ? 0 : Math.PI);
    }
  }
  // a few boxes knocked to the floor
  if (P.lod() >= 1) {
    for (let k = 0; k < 3; k++) {
      const r = hash01(Math.round(P.o.x * 3 + P.o.y) + k * 11);
      if (r > 0.6) continue;
      B.rblock('std', (r - 0.3) * L, 0, (k % 2 ? 1 : -1) * (D / 2 + 10 + r * 20), 10, 8, 7, 0.5, ['#d8231b', '#2a6ab0', '#f2c21a'][k], [0, r * 6, 0], PLAST);
    }
  }
}

/** A potted indoor palm (planter, ringed trunk, fronds) standing on y0, trunk height th. */
function palmTree(P, y0, th, seed) {
  const { B } = P;
  const r = (k) => hash01(seed + k * 7);
  let x = 0, z = 0;
  const lean = 0.05 + r(1) * 0.05, la = r(2) * 6.28;
  const n = Math.max(6, Math.round(th / 18));
  for (let s = 0; s < n; s++) {
    const h = th / n;
    B.cyl('std', x, y0 + s * h, z, 5.4 - s * 0.18, h + 0.6, s % 2 ? '#7a6448' : '#8a7452', 8, 0.93, null, { surf: [DET.bark, 0.9, 0], noJitter: true });
    x += Math.cos(la) * lean * h; z += Math.sin(la) * lean * h;
  }
  const top = [x, y0 + th, z];
  const cards = cardList();
  const nf = 12;
  for (let k = 0; k < nf; k++) {
    const a = (k / nf) * Math.PI * 2 + r(k + 3) * 0.3;
    const up = 0.4 - (k % 3) * 0.28;
    const u = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    const v = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    stripCard(cards, top, u, v, 62 + r(k + 9) * 18, 26, LEAF_CELLS.frond, 22 + r(k) * 14, 5);
  }
  // (an indoor palm left without water: some fronds brown)
  B.add('leaves', listGeo(cards), [0, 0, 0], [1, 1, 1], null, r(5) < 0.5 ? '#6a7a3a' : '#7a6a3a', { noAO: true });
}

/** A mannequin: plastic body on a stand (or knocked over), dressed now and then. */
function mannequin(P, x, z, a, seed, down) {
  const { B } = P;
  const skin = hash01(seed) < 0.5 ? '#e8e4dc' : '#2a2a2c';
  const cloth = ['#8a2a2a', '#2a3a5a', '#d8d0c0', null, '#3a5a3a', null][Math.floor(hash01(seed + 3) * 6)];
  const rot = down ? [0, a, HALF] : [0, a, 0];
  const put = (dx, dy, dz) => {
    // local body point → the model frame (rotated about y by a, and toppled about z)
    if (!down) return [x + dx * Math.cos(a) + dz * Math.sin(a), dy, z - dx * Math.sin(a) + dz * Math.cos(a)];
    const X = -dy, Y = dx;   // toppled: up becomes -x
    return [x + (X + 30) * Math.cos(a) + dz * Math.sin(a), 4 + Y * 0.2, z - (X + 30) * Math.sin(a) + dz * Math.cos(a)];
  };
  if (!down) {
    B.cyl('std', x, 0, z, 10, 1.4, '#3a3d40', 14, 1, null, CHROME);
    B.cyl('std', x, 1.4, z, 0.8, 20, '#8a9096', 6, 1, null, CHROME);
  }
  const part = (g, dx, dy, dz, s, c, extra = null) => B.add('std', g, put(dx, dy, dz), s, extra || rot, c, PLAST);
  part(T.sphere(8, 6), 0, 34, 0, [6.5, 9, 4], cloth || skin);          // hips
  part(T.sphere(8, 6), 0, 46, 0, [7.5, 11, 4.6], cloth || skin);       // torso
  part(T.cyl(8), 0, 57, 0, [1.8, 4, 1.8], skin);                        // neck
  part(T.sphere(8, 6), 0, 62, 0, [3.6, 4.6, 4], skin);                 // head
  for (const e of [-1, 1]) {
    part(T.cyl(6, 0.8), e * 8.6, 44, 0, [1.6, 20, 1.6], cloth || skin, down ? rot : [0, a, e * 0.12]);
    part(T.cyl(6, 0.7), e * 3.4, 16, 0, [2.2, 30, 2.2], hash01(seed + 9) < 0.5 ? '#1a1a1a' : skin);
  }
}

/** A bicycle (wheels on local x) at (x, z), leaning by `lean`. */
function bike(P, x, z, ry, color) {
  const { B } = P;
  const R = 11;
  for (const e of [-1, 1]) {
    B.add('std', T.torus(16, 0.1, 4), [x + e * 17 * Math.cos(ry), R, z - e * 17 * Math.sin(ry)], [R, R, R], [0, ry, 0], '#1a1a1a', RUBBER);
  }
  const p = (dx, dy) => [x + dx * Math.cos(ry), dy, z - dx * Math.sin(ry)];
  rod(B, 'std', p(-17, R), p(-2, R + 1), 0.9, color, PAINT);
  rod(B, 'std', p(-2, R + 1), p(-6, R + 16), 0.9, color, PAINT);
  rod(B, 'std', p(-6, R + 16), p(12, R + 15), 0.9, color, PAINT);
  rod(B, 'std', p(12, R + 15), p(-2, R + 1), 0.9, color, PAINT);
  rod(B, 'std', p(12, R + 15), p(17, R), 0.8, '#8a9096', CHROME);
  rod(B, 'std', p(-6, R + 16), p(-17, R), 0.7, color, PAINT);
  B.box('std', ...p(-7, R + 19), 7, 1.6, 3, '#1a1a1a', [0, ry, 0], RUBBER);
  B.box('std', ...p(13, R + 20), 1, 1, 16, '#2a2a2a', [0, ry, 0], STEEL);
}

// ---------------------------------------------------------------------------------------------
// the obstacle models

/**
 * The models of one build.
 * @param {object} state { waters: [] } collects the water surfaces (fountain, flood)
 */
export function mallProps(state) {
  const waters = state.waters;

  const OBSTACLES = {
    /** A cart corral: pipe rails, a sign, nested carts. */
    corral(P) {
      const { B, o } = P;
      const [L] = long(P);
      const c = '#c9ced3';
      for (const e of [-1, 1]) {
        for (const y of [14, 28]) B.cylX('std', 0, y, e * 13, 1.4, L, c, 8, CHROME);
        for (const x of [-L / 2, 0, L / 2 - 2]) B.cyl('std', x, 0, e * 13, 1.6, 30, c, 8, 1, null, CHROME);
      }
      B.cylZ('std', -L / 2, 28, 0, 1.4, 26, c, 8, CHROME);
      B.cyl('std', -L / 2 - 4, 0, 0, 2, 64, '#5a6066', 8, 1, null, STEEL);
      for (const f of [1, -1]) P.pic(B, 'wg_cart', -L / 2 - 4, 58, f * 1.2, 34, 11, f > 0 ? 0 : Math.PI);
      B.box('std', -L / 2 - 4, 58, 0, 36, 13, 2, '#e8e4d8', null, PLAST);
      const n = 1 + Math.floor(hash01(o.id) * 3);
      for (let i = 0; i < n; i++) {
        const [wx, wy] = P.toWorld({ x: o.x, y: o.y, a: P.fa }, L / 2 - 26 - i * 14, 0);
        cart(P, wx, wy, P.fa + Math.PI, P.gy(wx, wy), o.id + i);
      }
    },
    /** A steel palisade fence closing a service yard. */
    mallfence(P) {
      const { B } = P;
      const [L] = long(P);
      for (const y of [16, 88]) B.box('std', 0, y, 0, L, 3, 3, '#2f3a34', null, STEEL);
      for (let x = -L / 2 + 4; x <= L / 2 - 4; x += 8) {
        B.box('std', x, 50, 1.6, 4, 100, 1, '#2f3a34', null, STEEL);
        B.add('std', T.cyl(3, 0), [x, 103, 1.6], [2.4, 6, 1], null, '#2f3a34', STEEL);
      }
      for (let x = -L / 2; x <= L / 2; x += 200) B.box('std', x, 53, 0, 7, 106, 7, '#252c28', null, STEEL);
    },
    // (the escalators' sides: the escalator item draws them whole)
    'escalator-side': () => true,
    /** The gallery's edge: the slab's fascia, glass balustrade on posts, the handrail (150 up). */
    balustrade(P) {
      const { B, o } = P;
      const [L] = long(P, 0);
      const H0 = 150;
      B.box('std', 0, H0 - 6, 1, L, 14, 12, '#e8e4dc', null, S(DET.plaster, 0.5, 0));
      B.box('std', 0, H0 - 13.6, 7.2, L, 1.2, 1, '#b8b4aa', null, STEEL);
      for (let x = -L / 2 + 60; x < L / 2; x += 120) B.box('std', x, H0 + 20, 0, 2.4, 40, 2.4, '#b8bcc0', null, CHROME);
      B.cylX('std', 0, H0 + 41, 0, 1.6, L, '#c9ced3', 10, CHROME);
      B.box('std', 0, H0 + 1.5, 0, L, 3, 3.4, '#6d7275', null, STEEL);
      // the glass (see-through; dirty, a pane smashed now and then)
      for (let x = -L / 2 + 60; x < L / 2 - 30; x += 120) {
        if (hash01(o.id * 7 + Math.round(x)) < 0.15) continue;
        B.add('vglass', T.plane(), [x + 60, H0 + 21, 0], [116, 36, 1], null, '#b8c8cc', { noAO: true, noJitter: true });
        B.add('vglass', T.plane(), [x + 60, H0 + 21, 0], [116, 36, 1], [0, Math.PI, 0], '#b8c8cc', { noAO: true, noJitter: true });
      }
    },
    /** The security desk: monitors, the radio, papers, a chair. */
    secdesk(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 26, W, 0.8, '#5a5e62', null, PAINT);
      B.rblock('std', 0, 26, 0, L + 4, 2, W + 4, 0.6, '#2a2c30', null, S(DET.plastic, 0.4, 0));
      for (const [x, ry] of [[-34, 0.15], [0, 0], [34, -0.15]]) {
        B.rblock('std', x, 28, -W * 0.25, 26, 17, 2, 0.4, '#16181a', [0, ry, 0], PLAST);
        P.pic(B, 'wg_cctv', x + Math.sin(ry) * 1.2, 36.5, -W * 0.25 + 1.2 * Math.cos(ry), 24, 15, ry, { lit: !P.day, k: 1.1 });
      }
      B.rblock('std', L * 0.38, 28, W * 0.1, 8, 12, 5, 0.6, '#2a2c2e', null, PLAST);
      B.cyl('std', L * 0.38 + 2, 40, W * 0.1, 0.4, 10, '#1a1a1a', 4);
      for (let i = 0; i < 5; i++) B.box('std', -L * 0.3 + i * 9, 28.3 + i * 0.2, W * 0.15, 10, 0.3, 13, '#f0ece0', [0, i * 0.5, 0], PLAST);
      B.rblock('std', 10, 0, W * 0.9, 18, 18, 18, 2, '#1a1c20', [0, 0.4, 0], FABRIC);
      B.cyl('std', -L * 0.2, 28, W * 0.2, 2.2, 5, '#f4f0e8', 10, 0.9, null, PLAST);
    },
    /** The CCTV monitor rack along a wall (facing into the room). */
    monitors(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x - 200, o.y);
      B.block('std', 0, 0, 0, L, 30, D, '#3a3d40', null, PAINT);
      for (const e of [-1, 1]) B.block('std', e * (L / 2 - 2), 30, -f * D * 0.2, 3, 80, 3, '#2a2c2e', null, STEEL);
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 3; i++) {
          const x = -L / 2 + 30 + i * ((L - 60) / 2), y = 48 + j * 30;
          B.rbox('std', x, y, -f * D * 0.1, 44, 26, 6, 0.6, '#16181a', null, PLAST);
          const lit = hash01(o.id + i + j * 3) < 0.7;
          P.pic(B, lit ? 'wg_cctv' : 'wg_cctv_off', x, y, -f * D * 0.1 + f * 3.2, 40, 22, f > 0 ? 0 : Math.PI, { lit: lit && !P.day, k: 1.2 });
        }
      }
    },
    /** A row of staff lockers against a wall, one hanging open. */
    'lockers-mall'(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x + 200, o.y);
      const n = Math.max(2, Math.round(L / 20));
      for (let i = 0; i < n; i++) {
        const t = -L / 2 + ((i + 0.5) * L) / n, w = L / n - 0.6;
        const c = ['#6d7a84', '#78848e', '#667380'][i % 3];
        B.rblock('std', t, 0, 0, w, 82, D * 0.6, 0.4, c, null, S(DET.panel, 0.5, 0.5));
        if (hash01(i + o.id) < 0.2) B.box('std', t - w / 2 + 7, 42, f * (D * 0.3 + 7), 1, 76, 14, c, [0, 0.9, 0], S(DET.panel, 0.5, 0.5));
        else P.pic(B, 'wg_vent', t, 72, f * (D * 0.3 + 0.2), w * 0.6, 6, f > 0 ? 0 : Math.PI);
      }
      B.block('std', 0, 0, f * (D * 0.3 + 24), L * 0.7, 18, 12, '#8a6a4a', null, WOODS);
    },
    /** Priya's barricade: a desk on its side, a filing cabinet, chairs, planks nailed across. */
    'barricade-desk'(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 40, 6, 0.6, '#6d5a44', [0, 0, 0], WOODS);
      B.rblock('std', 0, 2, 5, L - 8, 2, 30, 0.4, '#8a7358', [HALF, 0, 0], WOODS);
      B.rblock('std', L / 2 + 14, 0, -4, 22, 52, 26, 0.6, '#7d8489', [0, 0.3, 0], S(DET.panel, 0.5, 0.6));
      for (let i = 0; i < 3; i++) B.rblock('std', -L / 2 + 20 + i * 30, 40 + (i % 2) * 4, 0, 16, 16, 16, 2, '#2a2d33', [0.3 * i, i, 0.4], FABRIC);
      for (let i = 0; i < 3; i++) B.box('std', 0, 12 + i * 12, -4, L + 20, 5, 1.4, ['#8a7358', '#7a6448', '#9a8468'][i], [0, 0, (i - 1) * 0.1], WOODS);
      P.decal(B, 'g_alive', 0, 28, -4.9, 70, 26, Math.PI);
    },
    /** Pallet racking (the stock rooms): blue uprights, orange beams, cartons. */
    'shelf-stock'(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const H = 110;
      for (let x = -L / 2 + 2; x <= L / 2 - 2; x += Math.min(120, L - 4)) for (const e of [-1, 1]) B.box('std', x, H / 2, e * (D / 2 - 1.5), 3, H, 3, '#2a5a9a', null, PAINT);
      for (const y of [30, 70, H - 4]) for (const e of [-1, 1]) B.box('std', 0, y, e * (D / 2 - 1.5), L, 4, 2.4, '#e87a1a', null, PAINT);
      for (const y of [0, 32, 72]) {
        let x = -L / 2 + 6;
        let k = 0;
        while (x < L / 2 - 20) {
          const w = 18 + hash01(o.id + k * 5 + y) * 20, h = 16 + hash01(o.id + k * 3 + y) * 18;
          if (hash01(o.id * 3 + k + y) > 0.25) B.rblock('std', x + w / 2, y + (y ? 2 : 0), 0, w - 2, h, D - 6, 0.5, ['#b89a6a', '#c8a878', '#a88858'][k % 3], [0, (hash01(k + y) - 0.5) * 0.1, 0], S(DET.fabric, 0.9, 0));
          x += w;
          k++;
        }
      }
    },
    /** A phone shop's display table: devices on security cables, a tablet stand. */
    phonetable(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 30, W, 1, '#f4f4f2', null, PLAST);
      B.box('std', 0, 30.4, 0, L - 4, 0.8, W - 4, '#d8d8d4', null, S(0, 0.2, 0));
      for (let i = 0; i < 5; i++) {
        const x = -L / 2 + 14 + i * (L - 28) / 4;
        if (hash01(P.o.id * 3 + i) < 0.35) { B.cyl('std', x, 30.5, 0, 0.5, 6, '#2a2a2a', 4); continue; }   // a cut cable
        B.rbox('std', x, 32, 0, 6, 1.2, 11, 0.4, '#1a1c20', [0.25, 0, 0], PLAST);
        P.pic(B, 'wg_screen', x, 32.8, 0.2, 5, 9, 0, { rx: -HALF + 0.25, lit: !P.day, k: 0.6 });
      }
    },
    /** The phone shop's wall of phones (facing into the shop). */
    phonewall(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x + 200, o.y);
      B.block('std', 0, 0, 0, L, 26, D, '#e8e8e4', null, PLAST);
      B.block('std', 0, 26, -f * D * 0.3, L, 84, 3, '#f4f4f2', null, PLAST);
      for (let i = 0; i < 4; i++) P.pic(B, 'g_phones', -L / 2 + L / 8 + (i * L) / 4, 64, -f * D * 0.3 + f * 1.8, L / 4 - 8, 50, f > 0 ? 0 : Math.PI);
      P.pic(B, 'f_phone', 0, 100, -f * D * 0.3 + f * 1.8, 150, 20, f > 0 ? 0 : Math.PI);
    },
    /** A clothes rail with hanging garments (some on the floor). */
    clothesrack(P) {
      const { B, L, W, o } = P;
      for (const e of [-1, 1]) {
        B.cyl('std', e * (L / 2 - 4), 0, 0, 1.4, 46, '#b8bcc0', 8, 1, null, CHROME);
        B.box('std', e * (L / 2 - 4), 1, 0, 3, 2, W - 6, '#8a9096', null, CHROME);
      }
      B.cylX('std', 0, 46, 0, 1, L - 6, '#c9ced3', 8, CHROME);
      const n = Math.floor((L - 14) / 4.2);
      for (let i = 0; i < n; i++) {
        const r = hash01(o.id * 13 + i);
        if (r < 0.3) continue;
        const c = ['#2a3a5a', '#8a2a2a', '#d8d0c0', '#3a5a3a', '#1a1a1a', '#b89a78', '#6a7a9a', '#c86a8a'][Math.floor(r * 8)];
        B.box('std', -L / 2 + 8 + i * 4.2, 44 - 16 - r * 6, 0, 0.9, 30 + r * 10, 16, c, [0, 0, (r - 0.5) * 0.1], FABRIC);
      }
      if (P.lod() >= 1) for (let k = 0; k < 3; k++) B.box('std', (hash01(o.id + k) - 0.5) * L, 0.6, (k % 2 ? 1 : -1) * (W / 2 + 10), 20, 1.2, 16, ['#2a3a5a', '#8a2a2a', '#d8d0c0'][k], [0, k * 1.3, 0], FABRIC);
    },
    /** The atrium fountain: a round granite basin, murky water, a tiered centrepiece, coins. */
    fountain(P) {
      const { B, o, L } = P;
      const R = L / 2 - 6, n = 20;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, seg = (2 * Math.PI * R) / n + 1;
        B.rblock('std', Math.cos(a) * R, 0, Math.sin(a) * R, seg, 26, 12, 1, '#8a8478', [0, -a + HALF, 0], GRANITE);
        B.rblock('std', Math.cos(a) * R, 26, Math.sin(a) * R, seg + 2, 3, 18, 1, '#b8b0a2', [0, -a + HALF, 0], GRANITE);
      }
      B.cyl('std', 0, 0.3, 0, R - 6, 2, '#2f6a78', n, 1, null, S(DET.tile, 0.3, 0));
      // the centrepiece: a column carrying three bowls
      B.cyl('std', 0, 0, 0, 16, 30, '#9a9488', 16, 0.9, null, GRANITE);
      for (const [y, rr] of [[30, 54], [70, 36], [104, 20]]) {
        B.add('std', T.lathe('bowl', [[0.2, 0], [1, 0.12], [1.05, 0.22], [0.9, 0.2], [0.2, 0.08]], 20), [0, y, 0], [rr, rr, rr], null, '#a8a296', GRANITE);
        B.cyl('std', 0, y, 0, rr * 0.18, y === 104 ? 18 : 40, '#9a9488', 12, 0.8, null, GRANITE);
      }
      B.add('std', T.sphere(10, 8), [0, 124, 0], [5, 6, 5], null, '#b8a860', S(0, 0.35, 0.8));
      // stains of the water that no longer runs
      if (P.lod() >= 1) for (let i = 0; i < 12; i++) { const a = hash01(i * 3 + o.id) * 6.28, d = hash01(i * 7) * (R - 20); P.flat(B, 'mud', Math.cos(a) * d, 2.5, Math.sin(a) * d, 50, 50, a); }
      waters.push({ x: o.x, y: o.y, r: R - 6, h: P.gy(o.x, o.y) + 18, kind: 'fountain' });
    },
    /** A potted palm in a terrazzo planter. */
    palm(P) {
      const { B, L, o } = P;
      B.rblock('std', 0, 0, 0, L, 30, L, 2, '#b8b0a2', null, GRANITE);
      B.rblock('std', 0, 30, 0, L + 4, 3, L + 4, 1, '#8a8478', null, GRANITE);
      B.box('std', 0, 31, 0, L - 8, 1, L - 8, '#3a2c20', null, S(DET.dirt, 0.95, 0));
      const room = P.roomAt(o.x, o.y);
      const th = Math.min(200, (room ? room.height : 220) - 90);
      palmTree(P, 32, th, o.id * 13);
      if (P.lod() >= 1) for (let k = 0; k < 4; k++) P.flat(B, 'grime', (hash01(k + o.id) - 0.5) * L, 33.5, (hash01(k * 3 + o.id) - 0.5) * L, 20, 20, k, { color: '#6a5a3a' });
    },
    /** A mall kiosk: a cart with a canopy, its goods, a stool. */
    kiosk(P) {
      const { B, L, W, o } = P;
      const c = ['#2a5a4a', '#6a2a3a', '#2a3a6a'][o.id % 3];
      B.rblock('std', 0, 4, 0, L - 10, 30, W - 14, 1, c, null, WOODS);
      B.rblock('std', 0, 34, 0, L - 4, 2.4, W - 8, 0.8, '#d8d0c0', null, S(DET.terrazzo, 0.35, 0));
      for (const [x, z] of [[-L / 2 + 8, -W / 2 + 8], [L / 2 - 8, -W / 2 + 8], [L / 2 - 8, W / 2 - 8], [-L / 2 + 8, W / 2 - 8]]) {
        B.cyl('std', x, 36, z, 1.2, 50, '#c9ced3', 8, 1, null, CHROME);
        B.cylZ('std', x, 4, z, 3, 2, '#1c1c1c', 10, RUBBER);
      }
      B.add('std', T.profile('kioskroof', [[-1, 0], [1, 0], [0.8, 0.22], [-0.8, 0.22]]), [0, 86, 0], [L / 2 + 6, 20, W], null, c, PAINT);
      for (const f of [1, -1]) P.pic(B, o.id % 2 ? 'wg_sale' : 'wg_poster3', 0, 20, f * (W / 2 - 6.8), 26, 24, f > 0 ? 0 : Math.PI);
      for (let i = 0; i < 8; i++) {
        if (hash01(o.id * 5 + i) < 0.4) continue;
        B.rblock('std', -L / 2 + 14 + i * (L - 28) / 7, 36.5, (i % 2 ? 6 : -6), 7, 4, 6, 0.4, ['#1a1a1a', '#d8231b', '#f2c21a', '#2a6ab0'][i % 4], [0, i, 0], PLAST);
      }
      B.cyl('std', L / 2 + 14, 0, W * 0.3, 7, 26, '#2a2c2e', 10, 1, null, S(DET.fabric, 0.8, 0));
    },
    /** The atrium's columns: clad in steel panels to the vault, ad boxes at head height. */
    'mall-col'(P) {
      const { B, o, L } = P;
      const top = o.top || 300;
      const R = L / 2 - 1;
      B.cyl('std', 0, 0, 0, R + 3, 8, '#8a9096', 20, 1, null, CHROME);
      B.cyl('std', 0, 8, 0, R, top - 20, '#d8d4cc', 20, 1, null, S(DET.plaster, 0.45, 0.1));
      for (let y = 120; y < top - 20; y += 90) B.cyl('std', 0, y, 0, R + 0.6, 1.4, '#a8acb0', 20, 1, null, CHROME);
      B.cyl('std', 0, top - 20, 0, R + 10, 20, '#e8e4dc', 20, 0.6, null, S(DET.plaster, 0.5, 0));
      // an ad box round it: posters on four faces
      B.rblock('std', 0, 40, 0, R * 2 + 8, 70, R * 2 + 8, 1, '#2a2c30', null, STEEL);
      const cells = ['wg_poster1', 'wg_poster2', 'wg_movie', 'wg_sale', 'wg_missing'];
      for (let k = 0; k < 4; k++) {
        const ry = k * HALF, d = R + 4.2;
        P.pic(B, cells[(k + o.id) % cells.length], Math.sin(ry) * d, 75, Math.cos(ry) * d, R * 2 - 2, 62, ry, { lit: !P.day && k % 2 === 0, k: 0.7 });
      }
    },
    /** A backless mall bench: steel legs, hardwood slats. */
    mallbench(P) {
      const { B, L, W } = P;
      for (const e of [-1, 1]) B.rblock('std', e * (L / 2 - 10), 0, 0, 4, 17, W - 4, 0.6, '#3a3d40', null, STEEL);
      for (let k = 0; k < 4; k++) B.rblock('std', 0, 17, -W / 2 + 3 + k * ((W - 6) / 3), L, 2, (W - 6) / 4, 0.5, '#8a6a44', null, WOODS);
    },
    /** A food stall's counter: the coloured front, the steel top, a sneeze guard, trays, the till. */
    foodcounter(P) {
      const { B, L, W, o } = P;
      const st = STALLS[o.label] || STALLS.pizza;
      B.rblock('std', 0, 0, 0, L, 32, W, 1, st[1], null, PAINT);
      B.box('std', 0, 6, W / 2 + 0.3, L - 6, 3, 0.6, st[3], null, PAINT);
      B.box('std', 0, 33, 0, L + 4, 2, W + 4, '#b8bcc0', null, STEEL);
      for (const x of [-L / 2 + 6, L / 2 - 6]) B.cyl('std', x, 34, W * 0.2, 0.8, 26, '#c9ced3', 6, 1, null, CHROME);
      B.box('std', 0, 60, W * 0.2, L - 8, 1.2, 12, '#c9ced3', null, CHROME);
      B.add('vglass', T.plane(), [0, 48, W * 0.2 + 6], [L - 12, 24, 1], [-0.25, 0, 0], '#c8d8dc', { noAO: true, noJitter: true });
      const n = Math.floor((L - 60) / 26);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 30 + i * 26;
        B.box('std', x, 34.4, -W * 0.1, 22, 2, 16, '#9aa0a4', null, STEEL);
        if (hash01(o.id + i * 3) < 0.6) B.box('std', x, 35.6, -W * 0.1, 20, 1.2, 14, ['#6a3a1a', '#c8a03a', '#8a3a2a', '#5a6a2a'][i % 4], null, S(DET.fabric, 0.9, 0));
      }
      B.rblock('std', L / 2 - 18, 34, -W * 0.25, 14, 8, 10, 0.6, '#2a2c2e', [0, 0.2, 0], PLAST);
      for (let i = 0; i < 4; i++) B.cyl('std', -L / 2 + 10 + i * 5, 35, W * 0.35, 1.6, 5, i % 2 ? '#e8e4d8' : '#d8231b', 8, 0.8, null, PLAST);
    },
    /** A stall kitchen's line: steel cabinets, a fryer, a griddle, the hood. */
    kitchenline(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 0, 0, L, 32, W, 0.6, '#b8bcc0', null, STEEL);
      B.box('std', -L * 0.3, 32.6, 0, L * 0.3, 1.2, W - 6, '#2a2c2e', null, STEEL);
      for (const e of [-1, 1]) B.box('std', L * 0.1 + e * 10, 30, 0, 16, 4, W - 10, '#1a1a1a', null, STEEL);
      B.rblock('std', L * 0.35, 32, 0, 30, 14, W - 6, 0.5, '#a8acb0', null, STEEL);
      B.rblock('std', 0, 88, -W * 0.1, L + 10, 16, W + 10, 0.6, '#c9ced3', null, STEEL);
      for (let i = 0; i < 4; i++) B.cyl('std', -L / 2 + 20 + i * 18, 34, W * 0.2, 5, 7, '#8a9096', 10, 0.95, null, STEEL);
    },
    /** A food court table with four moulded chairs (some knocked over) and a lunch left behind. */
    fctable(P) {
      const { B, L, o } = P;
      const R = L / 2 - 6;
      B.cyl('std', 0, 0, 0, 10, 1.4, '#3a3d40', 12, 1, null, STEEL);
      B.cyl('std', 0, 1.4, 0, 1.6, 24, '#5a6066', 8, 1, null, STEEL);
      B.cyl('std', 0, 25.4, 0, R, 1.8, '#e8e4dc', 18, 1, null, S(DET.terrazzo, 0.35, 0));
      const c = ['#d86a3a', '#3a8aa8', '#e8b83a', '#6aa84a'][o.id % 4];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * (R + 10), z = Math.sin(a) * (R + 10);
        const fall = hash01(o.id * 3 + i) < 0.3;
        if (fall) {
          B.rblock('std', x * 1.3, 1, z * 1.3, 16, 2, 15, 0.6, c, [HALF, a + 1, 0], PLAST);
          continue;
        }
        B.rblock('std', x, 16, z, 16, 2, 15, 0.8, c, [0, -a, 0], PLAST);
        B.rblock('std', x + Math.cos(a) * 7, 18, z + Math.sin(a) * 7, 2, 16, 15, 0.8, c, [0, -a, -0.12], PLAST);
        for (const [dx, dz] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) B.box('std', x + dx, 8, z + dz, 1, 16, 1, '#3a3d40', null, STEEL);
      }
      if (hash01(o.id) < 0.6) {
        B.box('std', R * 0.3, 27.6, 0, 22, 1, 16, '#c8231b', [0, 0.3, 0], PLAST);
        B.cyl('std', R * 0.3 + 6, 28, 4, 2.4, 7, '#f4f0e8', 10, 0.8, null, PLAST);
        B.box('std', R * 0.3 - 4, 28.4, -2, 10, 3, 8, '#d8b25a', [0, 0.5, 0], S(DET.fabric, 0.9, 0));
      }
    },
    /** The food court stage: a black-skirted deck, speaker stacks, a drum kit, a mic stand. */
    stage(P) {
      const { B, L, W, o } = P;
      B.block('std', 0, 0, 0, L, 28, W, '#16181a', null, FABRIC);
      B.box('std', 0, 29, 0, L + 2, 2.4, W + 2, '#4a3a2c', null, WOODS);
      for (let k = 0; k < 3; k++) B.block('std', -L / 2 - 30 + k * 0.1, 0, -W / 2 + 40 + k * 60, 40, 24, 50, '#2a2c2e', null, WOODS);
      for (const e of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          B.rblock('std', e * (L / 2 - 30), 30 + k * 36, W * 0.2, 44, 34, 30, 1, '#1a1a1c', null, S(DET.fabric, 0.8, 0));
          for (const y of [10, 24]) B.cylZ('std', e * (L / 2 - 30), 30 + k * 36 + y, W * 0.2 - 15.4, 7, 1, '#2a2a2a', 14, RUBBER);
        }
      }
      // the drum kit
      const dx = -L * 0.1, dz = W * 0.15;
      B.cylZ('std', dx, 42, dz, 11, 10, '#8a1a1a', 16, PAINT);
      for (const [x, z, r, h] of [[-18, -10, 7, 8], [16, -10, 7, 8], [22, 10, 9, 14]]) B.cyl('std', dx + x, 31 + (h > 10 ? 0 : 20), dz + z, r, h > 10 ? 16 : 7, '#8a1a1a', 14, 1, null, PAINT);
      for (const [x, z] of [[-26, 8], [28, -16]]) { B.cyl('std', dx + x, 31, dz + z, 0.6, 34, '#b8bcc0', 6, 1, null, CHROME); B.cyl('std', dx + x, 65, dz + z, 9, 0.4, '#c8a03a', 16, 0.9, null, S(0, 0.3, 0.9)); }
      B.cyl('std', L * 0.15, 31, -W * 0.2, 0.5, 44, '#1a1a1a', 6, 1, null, STEEL);
      B.cyl('std', L * 0.15, 31, -W * 0.2, 7, 0.8, '#1a1a1a', 10, 1, null, STEEL);
      if (P.lod() >= 1) P.flat(B, 'blood_pool', L * 0.2, 31.4, 0, 60, 60, 1.2);
      void o;
    },
    /** Walk-in freezer shelving: wire racks of frozen stock. */
    freezershelf(P) {
      const [L, D] = long(P);
      gondola(P, L, D, 90, 4, 'g_frozen', { color: '#c8ccd0', empty: 0.25 });
    },
    /** A stainless prep table with an undershelf, pots and boards. */
    steelcounter(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      B.box('std', 0, 31, 0, L, 2, D, '#c9ced3', null, STEEL);
      B.box('std', 0, 8, 0, L - 4, 1, D - 4, '#a8acb0', null, STEEL);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', x * (L / 2 - 2), 16, z * (D / 2 - 2), 1.6, 30, 1.6, '#a8acb0', null, STEEL);
      const n = Math.floor(L / 60);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 30 + i * 60, r = hash01(o.id * 7 + i);
        if (r < 0.3) B.cyl('std', x, 32, 0, 9, 12, '#8a9096', 14, 1, null, STEEL);
        else if (r < 0.6) B.box('std', x, 32.8, 0, 26, 1.4, 16, '#e8e2d0', [0, r, 0], PLAST);
        else if (r < 0.75) B.rblock('std', x, 1, D / 2 + 12, 18, 14, 18, 1, '#e8e4d8', null, PLAST);
      }
      if (P.lod() >= 1) P.flat(B, 'blood_splat', 0, 32.5, 0, Math.min(L, 60), Math.min(D, 60), o.id);
    },
    /** The kitchen's range against the wall: burners, oven doors, big pots, the hood. */
    stoves(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x, o.y - 200);
      B.rblock('std', 0, 0, 0, L, 32, D + 10, 0.6, '#8a9096', null, STEEL);
      const n = Math.floor(L / 60);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 30 + i * 60;
        B.box('std', x, 16, f * (D / 2 + 5.2), 50, 18, 0.6, '#5a6066', null, STEEL);
        B.box('std', x, 26, f * (D / 2 + 6), 40, 1.6, 1.6, '#c9ced3', null, CHROME);
        for (const [dx, dz] of [[-12, -6], [12, -6], [-12, 8], [12, 8]]) B.cyl('std', x + dx, 32, dz, 7, 1, '#1a1a1a', 12, 1, null, STEEL);
        if (hash01(o.id + i) < 0.5) B.cyl('std', x + 12, 33, 8, 10, 18, '#a8acb0', 14, 1, null, STEEL);
      }
      B.rblock('std', 0, 100, -f * 4, L + 10, 22, D + 30, 0.6, '#b8bcc0', null, STEEL);
      P.decal(B, 'grime2', 0, 60, -f * (D / 2 + 4), L * 0.8, 50, f > 0 ? 0 : Math.PI);
    },
    /** Cosmetics counters: white bases, glass display tops (smashed now and then), bottles. */
    glasscounter(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      B.rblock('std', 0, 0, 0, L, 22, D, 0.8, '#f0ece6', null, PLAST);
      B.box('std', 0, 22.5, 0, L, 1, D, '#d8b25a', null, S(0, 0.3, 0.8));
      const broken = hash01(o.id) < 0.4;
      if (!broken) {
        B.add('vglass', T.plane(), [0, 36, 0], [L - 2, D - 2, 1], [-HALF, 0, 0], '#d8e4e8', { noAO: true, noJitter: true });
        for (const e of [-1, 1]) B.add('vglass', T.plane(), [0, 29, e * (D / 2 - 1)], [L - 2, 13, 1], [0, e > 0 ? 0 : Math.PI, 0], '#d8e4e8', { noAO: true, noJitter: true });
      }
      for (const [x, z] of [[-L / 2 + 1, -D / 2 + 1], [L / 2 - 1, -D / 2 + 1], [L / 2 - 1, D / 2 - 1], [-L / 2 + 1, D / 2 - 1]]) B.box('std', x, 29.5, z, 1.4, 14, 1.4, '#d8b25a', null, S(0, 0.3, 0.8));
      P.pic(B, 'g_cosmetics', 0, 27, 0, L - 8, D * 0.6, 0, { rx: -HALF });
      if (!P.day) P.glow(B, 0, 35.6, 0, L - 6, 0.3, 2, '#fff4e0', 0.9);
      if (broken && P.lod() >= 1) for (let k = 0; k < 6; k++) B.add('glass', T.plane(), [(hash01(k + o.id) - 0.5) * L, 0.4, D / 2 + 8 + hash01(k * 3) * 20], [8, 6, 1], [-HALF, k, 0], '#c8d8dc', { surf: [DET.glass, -1, -1] });
    },
    /** The electronics TV wall: slatwall and rows of screens (static, the emergency alert, dead). */
    tvwall(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x, o.y + 200);
      B.block('std', 0, 0, 0, L, 132, D * 0.4, '#3a3d40', null, S(DET.panel, 0.6, 0.2));
      P.pic(B, 'wg_electronics', 0, 146, f * (D * 0.2 + 0.4), 100, 25, f > 0 ? 0 : Math.PI);
      B.block('std', 0, 132, 0, 104, 28, D * 0.3, '#1a1c20', null, PAINT);
      const cols = Math.floor(L / 80);
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < cols; i++) {
          const x = -L / 2 + 40 + i * ((L - 80) / Math.max(1, cols - 1)), y = 30 + j * 36;
          const r = hash01(o.id * 31 + i * 7 + j);
          if (r < 0.08) continue;
          B.rbox('std', x, y, f * (D * 0.2 + 2), 66, 34, 3, 0.4, '#101214', null, PLAST);
          const cell = r < 0.18 ? 'g_tv_on' : r < 0.45 ? 'g_tv_static' : 'g_tv_off';
          P.pic(B, cell, x, y, f * (D * 0.2 + 3.6), 62, 30, f > 0 ? 0 : Math.PI, { lit: cell !== 'g_tv_off', k: P.day ? 0.5 : 1.1 });
          if (r > 0.9) { B.rbox('std', x + 10, 3, f * (D * 0.2 + 30), 66, 34, 3, 0.4, '#101214', [-HALF + 0.1, 0, 0.3], PLAST); }
        }
      }
    },
    /** An electronics display table: laptops open, a tablet stand. */
    displaytable(P) {
      const { B, L, W, o } = P;
      B.rblock('std', 0, 0, 0, L, 30, W, 1, '#f4f4f2', null, PLAST);
      for (let i = 0; i < 3; i++) {
        const x = -L / 2 + 28 + i * (L - 56) / 2;
        if (hash01(o.id * 5 + i) < 0.3) continue;
        B.box('std', x, 30.6, 4, 22, 1, 15, '#8a9096', null, STEEL);
        B.box('std', x, 38, -4, 22, 15, 0.8, '#2a2c2e', [-0.25, 0, 0], STEEL);
        P.pic(B, 'wg_screen', x, 38.2, -3.4, 20, 13, 0, { rx: -0.25, lit: !P.day, k: 0.6 });
      }
    },
    /** A checkout counter: the till, a card reader, bags. */
    shopcounter(P) {
      const { B } = P;
      const [L, D] = long(P);
      B.rblock('std', 0, 0, 0, L, 32, D, 1, '#e8e4dc', null, PLAST);
      B.box('std', 0, 33, 0, L + 4, 2, D + 4, '#3a3d40', null, S(DET.terrazzo, 0.4, 0));
      for (const x of [-L * 0.3, L * 0.25]) {
        B.rblock('std', x, 34, 0, 14, 7, 12, 0.6, '#2a2c2e', null, PLAST);
        B.rblock('std', x, 41, -2, 12, 9, 1.4, 0.4, '#1a1c1e', [-0.3, 0, 0], PLAST);
        B.rblock('std', x + 10, 34, 4, 4, 5, 6, 0.4, '#3a3d40', [0, 0.3, 0], PLAST);
      }
      B.rblock('std', 0, 34, 2, 12, 16, 8, 0.6, '#f4f0e8', [0, 0.4, 0.1], S(DET.fabric, 0.9, 0));
    },
    /** Sporting goods' wall: slatwall with balls and rackets, the department sign. */
    sportwall(P) {
      const { B, o } = P;
      const [L, D] = long(P);
      const f = faceTo(P, o.x - 200, o.y);
      B.block('std', 0, 0, 0, L, 120, D * 0.4, '#d8d4cc', null, S(DET.panel, 0.6, 0));
      const n = Math.floor(L / 140);
      for (let i = 0; i < n; i++) P.pic(B, 'g_sport', -L / 2 + 70 + i * 140, 60, f * (D * 0.2 + 0.6), 130, 64, f > 0 ? 0 : Math.PI);
      P.pic(B, 'wg_sporting', 0, 108, f * (D * 0.2 + 0.8), 110, 27, f > 0 ? 0 : Math.PI);
      B.block('std', 0, 0, f * (D * 0.2 + 10), L, 20, 20, '#3a3d40', null, PAINT);
    },
    /** Bikes in a floor rack. */
    bikerack(P) {
      const { B, L, W, o } = P;
      B.box('std', 0, 1, 0, L, 2, W * 0.5, '#5a6066', null, STEEL);
      const n = Math.floor(L / 46);
      for (let i = 0; i < n; i++) {
        if (hash01(o.id * 7 + i) < 0.25) continue;
        bike(P, -L / 2 + 23 + i * 46, 0, HALF, ['#c62828', '#2a6ab0', '#1a1a1a', '#e8b83a'][i % 4]);
      }
    },
    /** A tent pitched on the shop floor, camp chairs, a lantern. */
    tentdisplay(P) {
      const { B, L, W } = P;
      ridgeTent(B, L * 0.7, W * 0.7, 10, 44, '#3a6a4a');
      for (const e of [-1, 1]) {
        B.box('std', e * (L / 2 - 8), 14, W / 2 + 6, 16, 1.4, 14, '#2a4a6a', [0, e * 0.3, 0], FABRIC);
        B.box('std', e * (L / 2 - 8), 22, W / 2 + 12, 16, 14, 1.4, '#2a4a6a', [-0.2, e * 0.3, 0], FABRIC);
      }
      B.cyl('std', 0, 0, W / 2 + 14, 3.4, 10, '#c8a03a', 10, 0.8, null, PAINT);
    },
    /** The gun counter (smashed glass, looted) and the rack on the wall behind. */
    guncounter(P) {
      const { B, L, W, o } = P;
      B.rblock('std', 0, 0, 0, L, 22, W, 0.8, '#4a3a2c', null, WOODS);
      B.box('std', 0, 22.5, 0, L, 1, W, '#2a2c2e', null, STEEL);
      for (const x of [-L / 2 + 1, 0, L / 2 - 1]) B.box('std', x, 29.5, 0, 1.4, 14, W - 2, '#2a2c2e', null, STEEL);
      P.pic(B, 'g_guns', 0, 25, 0, L - 20, W * 0.6, 0, { rx: -HALF });
      if (P.lod() >= 1) for (let k = 0; k < 8; k++) B.add('glass', T.plane(), [(hash01(k + o.id) - 0.5) * L, 0.4, -W / 2 - 8 - hash01(k * 3) * 26], [8, 6, 1], [-HALF, k, 0], '#c8d8dc', { surf: [DET.glass, -1, -1] });
      // the rack on the south wall behind
      const zw = 3984 - 12 - o.y - 1;
      B.block('std', 0, 30, zw - 4, L * 0.9, 70, 4, '#5a4a3a', null, WOODS);
      P.pic(B, 'g_guns', 0, 64, zw - 6.2, L * 0.85, 60, Math.PI);
      P.decal(B, 'g_looters', L * 0.3, 112, zw - 6.4, 90, 34, Math.PI);
    },
    /** Pharmacy shelving: white gondolas of boxed medicines. */
    'shelf-pharm'(P) {
      const [L, D] = long(P);
      gondola(P, L, D, 84, 4, 'g_pharm', { color: '#f0f0ec', empty: 0.3 });
    },
    /** The pharmacy's counter, its sign on the wall behind. */
    pharmcounter(P) {
      const { B, L, W, o } = P;
      B.rblock('std', 0, 0, 0, L, 32, W, 1, '#e8eee8', null, PLAST);
      B.box('std', 0, 6, -W / 2 - 0.3, L - 6, 3, 0.6, '#1f7a3a', null, PAINT);
      B.box('std', 0, 33, 0, L + 4, 2, W + 4, '#d8d8d0', null, S(DET.terrazzo, 0.35, 0));
      B.rblock('std', -L * 0.3, 34, 0, 14, 7, 12, 0.6, '#2a2c2e', null, PLAST);
      const zw = 3984 - 12 - o.y - 1;
      P.pic(B, 'wg_pharmacy', 0, 104, zw - 1.2, 130, 32, Math.PI);
      B.block('std', 0, 36, zw - 8, L * 0.9, 84, 12, '#f0f0ec', null, PAINT);
      P.pic(B, 'g_pharm', 0, 76, zw - 14.2, L * 0.85, 76, Math.PI);
    },
    /** Grocery-style gondola shelving with end caps. */
    'shelf-general'(P) {
      const { B } = P;
      const [L, D] = long(P);
      gondola(P, L, D, 92, 4, 'g_general', { empty: 0.28 });
      for (const e of [-1, 1]) P.pic(B, 'wg_clearance', e * (L / 2 + 0.4), 104, 0, D + 4, 18, e > 0 ? HALF : -HALF);
      B.box('std', 0, 104, 0, L, 16, 1, '#f2c21a', null, PAINT);
    },
    /** The deck parapets: concrete from the lower ground up past the deck, sloped along the ramps. */
    deckedge(P) {
      const { B, o } = P;
      const [L] = long(P, 0);
      const fo = { x: o.x, y: o.y, a: P.fa };
      const n = Math.max(1, Math.round(L / 40));
      const sample = (t) => {
        const [ax, ay] = P.toWorld(fo, t, 14), [bx, by] = P.toWorld(fo, t, -14);
        const ga = P.gy(ax, ay), gb = P.gy(bx, by);
        return [Math.min(ga, gb), Math.max(ga, gb)];
      };
      for (let i = 0; i < n; i++) {
        const t0 = -L / 2 + (i * L) / n, t1 = -L / 2 + ((i + 1) * L) / n;
        const [lo0, hi0] = sample(t0 + 0.5), [lo1, hi1] = sample(t1 - 0.5);
        const lo = Math.min(lo0, lo1), hmin = Math.min(hi0, hi1);
        if (hmin - lo > 1) B.block('std', (t0 + t1) / 2, lo, 0, t1 - t0 + 0.2, hmin - lo, 12, '#9a968c', null, CONC);
        slopedWall(B, t0, t1, hi0, hi1, 32, Math.min(12, Math.max(0.1, hmin - lo)), 12, '#a8a498', CONC);
        // a yellow stripe along the top
        if (P.lod() >= 1) B.quad('std', [(t0 + t1) / 2, (hi0 + hi1) / 2 + 32.1, 0], [t1 - t0, hi1 - hi0, 0], [0, 0, -4], '#d8b01a', PAINT);
      }
    },
    /** The garage's columns (hazard-striped feet, level signs); on deck B, light poles. */
    'garage-col'(P) {
      const { B, o, L } = P;
      if ((o.top || 110) > 150) {
        B.block('std', 0, 0, 0, L, 26, L, '#9a968c', null, CONC);
        B.cyl('std', 0, 26, 0, 3, 150, '#6d7275', 8, 0.8, null, STEEL);
        for (const e of [-1, 1]) {
          rod(B, 'std', [0, 170, 0], [e * 24, 176, 0], 1.2, '#6d7275', STEEL);
          B.rbox('std', e * 28, 174, 0, 14, 4, 8, 0.8, '#3a3d40', null, STEEL);
        }
        return;
      }
      B.block('std', 0, 0, 0, L, 110, L, '#b8b4aa', null, CONC);
      for (let k = 0; k < 4; k++) {
        const ry = k * HALF, d = L / 2 + 0.3;
        P.pic(B, 'wg_caution', Math.sin(ry) * d, 12, Math.cos(ry) * d, L, 20, ry);
        if (k % 2 === 0) P.pic(B, 'wg_level1', Math.sin(ry) * d, 70, Math.cos(ry) * d, 20, 20, ry);
      }
    },
    /** The pay booth: a glazed hut with a roof overhang and the PAY sign. */
    paybooth(P) {
      const { B, L, W } = P;
      B.block('std', 0, 0, 0, L + 10, 4, W + 10, '#8a867c', null, CONC);
      B.block('std', 0, 4, 0, L, 36, W, '#d8d4c8', null, PAINT);
      for (const e of [-1, 1]) {
        B.box('glass', 0, 58, e * W / 2, L - 8, 36, 1, '#1a2830', null, GLASSY);
        B.box('glass', e * L / 2, 58, 0, 1, 36, W - 8, '#1a2830', null, GLASSY);
      }
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('std', x * L / 2, 58, z * W / 2, 3, 36, 3, '#3a3d40', null, STEEL);
      B.block('std', 0, 76, 0, L + 20, 6, W + 20, '#3a3d40', null, STEEL);
      for (const f of [1, -1]) P.pic(B, 'wg_pay', 0, 90, f * (W / 2 + 2), 54, 18, f > 0 ? 0 : Math.PI);
      B.box('std', 0, 90, 0, 58, 20, W + 3, '#f2c21a', null, PAINT);
    },
    /** A dumpster: a tapered steel bin with lids, on castors. */
    dumpster(P) {
      const { B, L, W, o } = P;
      const c = o.color || '#2f5a3a';
      B.add('std', T.profile('dumpster', [[-0.5, 0], [0.5, 0], [0.56, 1], [-0.5, 1]]), [0, 6, 0], [L, 40, W], null, c, PAINT);
      B.box('std', L * 0.03, 46.6, -W * 0.25, L + 6, 1.4, W / 2, '#1a1c1a', [0.08, 0, 0], PLAST);
      B.box('std', L * 0.03, 50, W * 0.25, L + 6, 1.4, W / 2, '#1a1c1a', [-0.6, 0, 0], PLAST);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cylZ('std', x * (L / 2 - 6), 3, z * (W / 2 - 6), 3, 2, '#1c1c1c', 8, RUBBER);
    },
    /** The dock office desk. */
    officedesk(P) {
      const { B, L, W } = P;
      B.rblock('std', 0, 24, 0, L, 2.4, W, 0.8, '#b8a888', null, WOODS);
      B.rblock('std', -L / 2 + 10, 0, 0, 18, 24, W - 4, 0.8, '#7d8489', null, STEEL);
      B.box('std', L / 2 - 2, 12, 0, 2, 24, W - 4, '#7d8489', null, STEEL);
      B.rblock('std', 0, 26.4, -W * 0.2, 18, 12, 2, 0.5, '#1a1c1f', null, S(0, 0.4, 0.4));
      P.pic(B, 'wg_cctv_off', 0, 32.6, -W * 0.2 + 1.2, 16, 9, 0);
      for (let i = 0; i < 4; i++) B.box('std', -L * 0.3 + i * 8, 26.6 + i * 0.3, W * 0.1, 9, 0.3, 12, '#f0ece0', [0, i * 0.4, 0], PLAST);
      B.rblock('std', 0, 0, W * 0.85, 16, 16, 16, 2, '#2a2d33', [0, 0.5, 0], FABRIC);
    },
    filing: HOSP.filing,
  };

  // ---------------------------------------------------------------------------------------------
  // the free items

  const ITEMS = {
    /** Standing water over the car park (the surface is the level's water mesh), mud at its edges. */
    flood(P) {
      const { B, it } = P;
      waters.push({ x: it.x, y: it.y, w: it.w, d: it.d, h: 0.9, kind: 'flood', seed: Math.round(it.x + it.y) });
      if (P.lod() < 1) return;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * 6.28, rx = it.w * 0.46, rz = it.d * 0.46;
        P.flat(B, 'mud', Math.cos(a) * rx, 0.3, Math.sin(a) * rz, 160, 120, a, { bucket: 'lvgrime' });
      }
    },
    /** The pylon sign by the road: two legs, the tenant board both sides (lit at night). */
    pylon(P) {
      const { B, it } = P;
      const H = it.h || 420;
      P.at(B, it.x, it.y, it.a || 0, 3, P.gy(it.x, it.y));
      B.block('std', 0, 0, 0, 150, 20, 40, '#8a867c', null, CONC);
      for (const e of [-1, 1]) B.block('std', e * 42, 20, 0, 16, H - 260, 16, '#3a3d40', null, STEEL);
      B.rblock('std', 0, H - 250, 0, 124, 250, 22, 1, '#23262b', null, PAINT);
      for (const f of [1, -1]) P.pic(B, 'wg_pylon', 0, H - 125, f * 11.3, 116, 236, f > 0 ? 0 : Math.PI, { lit: !P.day, k: 0.9 });
      B.box('std', 0, H + 4, 0, 130, 8, 26, '#b33a2a', null, PAINT);
    },
    /** The entrance canopy: steel columns and beams, a glass roof, WESTGATE over the doors. */
    entrycanopy(P) {
      const { B, it } = P;
      const w = it.w, d = it.d;
      const x0 = -w / 2, xf = 2600 - 12 - it.x;          // the façade's outer face
      const H = 120;
      for (const z of [-d / 2 + 10, d / 2 - 10]) {
        B.cyl('std', x0 + 10, 0, z, 5, H, '#3a3d40', 12, 1, null, STEEL);
        B.box('std', (x0 + xf) / 2, H + 4, z, xf - x0, 8, 6, '#3a3d40', null, STEEL);
      }
      for (let x = x0 + 10; x < xf; x += 42) B.box('std', x, H + 9, 0, 3, 2, d, '#4a4e52', null, STEEL);
      B.box('std', x0 + 10, H + 4, 0, 8, 10, d, '#3a3d40', null, STEEL);
      B.add('vglass', T.plane(), [(x0 + xf) / 2 + 5, H + 10.5, 0], [xf - x0 - 10, d - 8, 1], [-HALF, 0, 0], '#a8bcc4', { noAO: true, noJitter: true });
      B.add('vglass', T.plane(), [(x0 + xf) / 2 + 5, H + 10.4, 0], [xf - x0 - 10, d - 8, 1], [HALF, 0, 0], '#a8bcc4', { noAO: true, noJitter: true });
      // the fascia band with the tagline, the big letters above on the façade
      B.box('std', x0 + 6, H + 20, 0, 4, 22, d + 4, '#23262b', null, PAINT);
      P.pic(B, 'wg_letters', x0 + 3.8, H + 20, 0, d - 20, 18, -HALF, { lit: !P.day, k: 0.8 });
      P.pic(B, 'wg_logo', xf - 1, 212, 0, 560, 96, -HALF, { lit: !P.day, k: 1.2 });
      B.box('std', xf - 0.3, 212, 0, 0.6, 110, 590, '#1a1c20', null, PAINT);
      if (P.lod() >= 1) for (let k = 0; k < 6; k++) P.flat(B, 'mud', x0 + 30 + k * 26, 0.3, (k % 2 ? 1 : -1) * 60, 70, 60, k);
    },
    /** Two escalators rising north onto the gallery: steps, skirts, glass balustrades, handrails, trusses. */
    escalators(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 5, 0);
      const H = it.h, y0 = it.y0 - it.y, y1 = it.y1 - it.y;    // local z: y0 = the top (north), y1 = the bottom
      const run = y1 - y0, lanes = it.lanes || 2;
      const lw = (it.x1 - it.x0) / lanes;
      const ang = Math.atan2(H, run);
      const hyp = Math.hypot(H, run);
      const hAt = (z) => (y1 - z) / run * H;                    // the step line's height at local z
      const steps = Math.round(run / 13);
      for (let l = 0; l < lanes; l++) {
        const cx = it.x0 - it.x + lw * (l + 0.5);
        const sw = lw - 22;
        for (let s = 0; s < steps; s++) {
          const za = y1 - (s * run) / steps, zb = y1 - ((s + 1) * run) / steps;
          const ha = hAt(za), hb = hAt(zb);
          // the tread (grooved aluminium) and the riser (black)
          B.box('std', cx, hb - 0.4, (za + zb) / 2, sw, 0.8, za - zb, '#8a9096', null, S(DET.corrugated, 0.4, 0.8));
          B.box('std', cx, (ha + hb) / 2 - 0.4, za - 0.2, sw, hb - ha, 0.4, '#1a1c1e', null, STEEL);
          if (s % 2 === 0) B.box('std', cx - sw / 2 + 1.5, hb, (za + zb) / 2, 1.4, 0.2, za - zb, '#e8c21a', null, PAINT);
        }
        // the comb plates at the landings
        for (const [z, h] of [[y1 + 10, 0], [y0 - 10, H]]) B.box('std', cx, h + 0.5, z, lw - 4, 1, 20, '#a8acb0', null, S(DET.corrugated, 0.4, 0.8));
        // skirts, balustrades (glass), handrails, both sides of the lane
        for (const e of [-1, 1]) {
          const x = cx + e * (lw / 2 - 5);
          slopedWallZ(B, x, y1, y0, 0, H, 12, 16, 4, '#b8bcc0', STEEL);
          // the glass balustrade: a parallelogram along the slope (both faces)
          for (const f of [1, -1]) B.quad('vglass', [x, H / 2 + 30, (y0 + y1) / 2], [0, f * H, f * (y0 - y1)], [0, 36, 0], '#c8d4d8', { noAO: true, noJitter: true });
          handrail(B, x, y1, y0, H, 50, ang);
        }
      }
      // the truss's outer faces (stainless): a triangle from the floor up to the step line, its edge band
      for (const [x, e] of [[it.x0 - it.x - 1, -1], [it.x1 - it.x + 1, 1]]) {
        B.add('std', RTRI(), [x, 0, y1], [run, H, 1], [0, HALF, 0], '#c9ced3', CHROME);
        slopedWallZ(B, x - e * 1.5, y1, y0, 0, H, 3, 2, 3, '#b8bcc0', CHROME);
      }
      void hyp;
    },
    /** A shop front: fascia with the name, then a glass front (a shop behind) or a roller shutter. */
    shopfront(P) {
      const { B, it } = P;
      const base = it.base || 0;
      P.at(B, it.x, it.y, it.a || 0, Math.round(it.x), base);
      const w = it.w, H = it.h - 30;
      const name = it.name;
      const cell = SHOPS[name] ? 'f_' + name : 'f_g5';
      // the fascia box and its lettering
      B.block('std', 0, H, -1, w + 10, 28, 4, '#1a1c20', null, PAINT);
      P.pic(B, cell, 0, H + 14, 1.2, Math.min(w - 10, 300), 22, 0, { lit: !P.day && hash01(it.x) < 0.3, k: 0.8 });
      for (const e of [-1, 1]) B.block('std', e * (w / 2 + 3), 0, 0, 8, H, 5, '#2a2c30', null, STEEL);
      if (it.kind === 'glass') {
        // a glazed front, the shop inside (interior mapped), the door open, a pane smashed
        const n = Math.max(2, Math.round(w / 120));
        const pw = w / n;
        for (let i = 0; i < n; i++) {
          const x = -w / 2 + (i + 0.5) * pw;
          const r = hash01(Math.round(it.x) + i * 13);
          B.box('std', x - pw / 2, H / 2, 0.5, 2.4, H, 3, '#2a2c30', null, STEEL);
          if (r < 0.25) {
            // smashed: teeth of glass, the shards on the floor
            B.quad('glass', [x, H / 2, -6], [pw - 4, 0, 0], [0, H - 4, 0], '#0a0e12', { pane: { id: roomId(1, r * 999), w: pw, h: H } });
            if (P.lod() >= 1) for (let k = 0; k < 5; k++) B.add('glass', T.plane(), [x + (hash01(k + r) - 0.5) * pw, 0.3, 8 + hash01(k * 3 + r) * 26], [7, 5, 1], [-HALF, k, 0], '#c8d8dc', { surf: [DET.glass, -1, -1] });
          } else {
            B.quad('glass', [x, H / 2, 0], [pw - 3, 0, 0], [0, H - 3, 0], '#101820', { pane: { id: roomId(1, r * 999), w: pw, h: H } });
          }
        }
        B.box('std', 0, 1, 0.5, w, 2, 4, '#2a2c30', null, STEEL);
        // a sale sticker, an OPEN sign in the window (dead, or still lit)
        P.pic(B, 'wg_sale', -w * 0.3, H * 0.6, 1.3, 20, 30, 0);
        if (w > 300) P.pic(B, hash01(it.x * 3) < 0.5 ? 'n_open' : 'n_sale', w * 0.25, H * 0.7, -2, 50, 19, 0, { lit: !P.day && hash01(it.y + it.x) < 0.5, k: 1.6, color: '#ff5ab0' });
      } else {
        // a roller shutter, down (sometimes jammed half open, the dark shop behind)
        const r = hash01(Math.round(it.x * 7 + it.y));
        const hdown = r < 0.25 ? H * 0.45 : H;
        B.box('std', 0, H - 6, 2, w, 12, 10, '#5a6066', null, STEEL);
        B.block('std', 0, H - hdown, 1, w, hdown, 1.6, '#9aa0a4', null, S(DET.corrugated, 0.5, 0.6));
        B.box('std', 0, H - hdown + 1, 1.6, w, 2.4, 3, '#3a3e42', null, STEEL);
        if (r < 0.25) B.quad('std', [0, (H - hdown) / 2, -40], [w, 0, 0], [0, H - hdown, 0], '#07080a', { noAO: true, surf: [0, 1, 0] });
        if (P.lod() >= 1 && r > 0.6) P.decal(B, ['g_dead', 'g_help', 'g_noentry', 'g_tally'][Math.floor(r * 40) % 4], (r - 0.8) * w, H * 0.5, 2.1, 80, 30, 0);
      }
    },
    /** The mezzanine over the south arcade: its slab edge, glass balustrade, the upper shops and ceiling. */
    mezzanine(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 9, 0);
      const x0 = it.x0 - it.x, x1 = it.x1 - it.x, z0 = it.y0 - it.y, z1 = it.y1 - it.y, H = it.h;
      const L = x1 - x0, cx = (x0 + x1) / 2;
      // the upper floor (seen from the gallery across the void) and the slab's edge
      B.quad('lvfloor', [cx, H + 0.2, (z0 + z1) / 2], [L, 0, 0], [0, 0, -(z1 - z0)], '#c8c0b2', { noAO: true, surf: [DET.terrazzo, 0.3, 0] });
      B.box('std', cx, H - 6, z0 + 1, L, 14, 4, '#e8e4dc', null, S(DET.plaster, 0.5, 0));
      // the balustrade
      for (let x = x0 + 60; x < x1; x += 120) B.box('std', x, H + 20, z0 + 4, 2.4, 40, 2.4, '#b8bcc0', null, CHROME);
      B.cylX('std', cx, H + 41, z0 + 4, 1.6, L, '#c9ced3', 10, CHROME);
      for (let x = x0 + 60; x < x1 - 30; x += 120) {
        B.add('vglass', T.plane(), [x + 60, H + 21, z0 + 4], [116, 36, 1], null, '#b8c8cc', { noAO: true, noJitter: true });
        B.add('vglass', T.plane(), [x + 60, H + 21, z0 + 4], [116, 36, 1], [0, Math.PI, 0], '#b8c8cc', { noAO: true, noJitter: true });
      }
      // the upper shops (shuttered) along the back and the ceiling at 290
      const top = 290;
      const shops = ['up2', 'g6', 'up1', 'g4', 'up3'];
      const n = shops.length, sw = L / n;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * sw;
        B.block('std', x, H, z1 - 4, sw, top - H, 8, '#d8d2c4', null, S(DET.drywall, 0.85, 0));
        const fz = z1 - 8.2;
        B.block('std', x, H + 84, fz, sw - 30, 26, 1, '#1a1c20', null, PAINT);
        P.pic(B, 'f_' + shops[i], x, H + 97, fz - 0.8, Math.min(sw - 50, 280), 20, Math.PI);
        B.block('std', x, H, fz, sw - 30, 84, 1.4, '#9aa0a4', null, S(DET.corrugated, 0.5, 0.6));
      }
      B.quad('std', [cx, top, (z0 + z1) / 2], [L, 0, 0], [0, 0, z1 - z0], '#e8e4dc', { noAO: true, surf: [DET.plaster, 0.8, 0] });
      for (let x = x0 + 150; x < x1; x += 300) P.glow(B, x, top - 1, (z0 + z1) / 2, 10, 0.6, 10, '#fff0d8', P.day ? 0.4 : 1.6);
    },
    /** The mall directory totem. */
    directory(P) {
      const { B } = P;
      B.rblock('std', 0, 0, 0, 44, 120, 12, 2, '#2a2c30', null, PAINT);
      for (const f of [1, -1]) P.pic(B, 'wg_directory', 0, 64, f * 6.2, 38, 56, f > 0 ? 0 : Math.PI, { lit: !P.day, k: 0.8 });
      B.box('std', 0, 112, 0, 46, 10, 13, '#b33a2a', null, PAINT);
    },
    /** Sale banners hanging from the vault over the fountain. */
    banner(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 11, 0);
      const H = it.h || 360;
      for (const e of [-1, 1]) {
        const x = e * (it.w || 300) / 3;
        for (const f of [1, -1]) P.pic(B, 'wg_banner', x, H - 110, f * 0.6, 70, 186, f > 0 ? 0 : Math.PI);
        B.box('std', x, H - 16, 0, 74, 3, 3, '#3a3d40', null, STEEL);
        B.box('std', x, H - 204, 0, 74, 3, 3, '#3a3d40', null, STEEL);
        for (const d of [-30, 30]) rod(B, 'std', [x + d, H - 16, 0], [x + d, 432, 0], 0.3, '#2a2c2e', STEEL, 4);
      }
    },
    /** A mannequin standing (or knocked over). */
    mannequin(P) {
      const { it } = P;
      const down = hash01(Math.round(it.x * 3 + it.y)) < 0.3;
      mannequin(P, 0, 0, 0, Math.round(it.x + it.y), down);
    },
    /** A food stall's fascia over its counter, the menu boards, a neon now and then. */
    stallsign(P) {
      const { B, it } = P;
      const w = it.w;
      B.block('std', 0, 98, 1, w, 28, 6, '#1a1c20', null, PAINT);
      P.pic(B, 'st_' + it.name, 0, 112, 4.2, w - 16, 24, 0, { lit: !P.day && it.i % 2 === 0, k: 0.9 });
      for (let k = 0; k < 3; k++) {
        const x = -w / 2 + w * (k + 0.5) / 3;
        B.box('std', x, 76, 2.5, w / 3 - 12, 34, 2, '#101214', null, PAINT);
        P.pic(B, 'mn_' + ((k + it.i) % 3), x, 76, 3.8, w / 3 - 16, 30, 0, { lit: !P.day && k === 1 && it.i % 2 === 1, k: 0.8 });
      }
      if (it.i === 2) P.pic(B, 'n_eat', w / 2 - 60, 140, 2, 70, 26, 0, { lit: !P.day, k: 1.8, color: '#ff4a3a' });
      if (it.i === 4) P.pic(B, 'n_cola', -w / 2 + 70, 140, 2, 90, 34, 0, { color: '#8a8a8a' });
    },
    /** The stage's truss: four towers, the top frame, lamps, the backdrop. */
    stagetruss(P) {
      const { B, it } = P;
      const w = it.w, d = it.d, H = 190;
      const tower = (x, z) => {
        for (const [dx, dz] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) B.cyl('std', x + dx, 30, z + dz, 0.8, H - 30, '#c9ced3', 6, 1, null, CHROME);
        for (let y = 40; y < H; y += 16) B.box('std', x, y, z, 9, 0.8, 9, '#b8bcc0', [0, 0.785, 0], CHROME);
      };
      for (const [x, z] of [[-w / 2 + 10, -d / 2 + 10], [w / 2 - 10, -d / 2 + 10], [w / 2 - 10, d / 2 - 10], [-w / 2 + 10, d / 2 - 10]]) tower(x, z);
      for (const z of [-d / 2 + 10, d / 2 - 10]) for (const dy of [-4, 4]) B.cylX('std', 0, H + dy, z, 0.9, w - 12, '#c9ced3', 6, CHROME);
      for (const x of [-w / 2 + 10, w / 2 - 10]) for (const dy of [-4, 4]) B.cylZ('std', x, H + dy, 0, 0.9, d - 12, '#c9ced3', 6, CHROME);
      for (let k = 0; k < 6; k++) {
        const x = -w / 2 + 60 + k * (w - 120) / 5;
        B.cyl('std', x, H - 22, -d / 2 + 10, 5, 16, '#1a1a1a', 10, 1, [0.5, 0, 0], STEEL);
      }
      // the backdrop cloth, the band's name in neon
      B.box('std', 0, 110, d / 2 - 4, w - 30, 160, 1, '#101014', null, FABRIC);
      P.pic(B, 'n_star', -w * 0.3, 140, d / 2 - 5, 50, 50, Math.PI, { lit: !P.day, k: 1.6, color: '#5ab8ff' });
      P.pic(B, 'n_star', w * 0.3, 140, d / 2 - 5, 50, 50, Math.PI, { color: '#5a5a5a' });
    },
    /** A ramp's deck: a sloped concrete surface over the terrain's steps, arrows. */
    ramp(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 13, 0);
      const x0 = it.x0 - it.x, x1 = it.x1 - it.x, z0 = it.y0 - it.y, z1 = it.y1 - it.y, H = it.h;
      if (it.axis === 'x') {
        // rising toward +x from x0 (0) to x1 (H)
        B.quad('lvfloor', [(x0 + x1) / 2, H / 2 + 0.6, (z0 + z1) / 2], [x1 - x0, H, 0], [0, 0, -(z1 - z0)], '#8a867c', { noAO: true, surf: [DET.concrete, 0.8, 0] });
        for (const z of [z0 + 12, z1 - 12]) B.quad('lvfloor', [(x0 + x1) / 2, H / 2 + 0.8, z], [x1 - x0, H, 0], [0, 0, -4], '#d8b01a', { noAO: true, surf: [0, 0.6, 0] });
        P.pic(B, 'wg_deckb', x0 - 20, 90, z0 - 2, 90, 22, 0);
      } else {
        // falling toward +z (south) from z0 (H) to z1 (0)
        B.quad('lvfloor', [(x0 + x1) / 2, H / 2 + 0.6, (z0 + z1) / 2], [x1 - x0, 0, 0], [0, H, -(z1 - z0)], '#8a867c', { noAO: true, surf: [DET.concrete, 0.8, 0] });
        P.pic(B, 'wg_exitlane', 0, H + 90, z0 - 30, 70, 23, Math.PI);
      }
    },
    /** Deck B: the concrete deck over the terrain, bay stripes, arrows, puddles. */
    deckB(P) {
      const { B, it } = P;
      P.at(B, it.x, it.y, 0, 17, 0);
      const x0 = it.x0 - it.x, x1 = it.x1 - it.x, z0 = it.y0 - it.y, z1 = it.y1 - it.y, H = it.h;
      B.quad('lvfloor', [(x0 + x1) / 2, H, (z0 + z1) / 2], [x1 - x0, 0, 0], [0, 0, -(z1 - z0)], '#7d7a72', { noAO: true, surf: [DET.concrete, 0.75, 0] });
      for (let x = x0 + 130; x < x1 - 40; x += 110) {
        for (const zc of [z0 + 170, z1 - 170]) B.quad('lvfloor', [x, H + 0.05, zc], [3, 0, 0], [0, 0, -120], '#e8e4d8', { noAO: true, surf: [0, 0.6, 0] });
      }
      for (let x = x0 + 300; x < x1; x += 500) P.flat(B, 'mud', x, H + 0.2, 0, 200, 150, x);
    },
    /** A loading bay on the store's east wall: the dock door, shelter, bumpers, the bay number, a lamp. */
    dockbay(P) {
      const { B, it } = P;
      const w = it.w;
      // (a = 0: local +x points east, away from the wall; the bay faces +x)
      B.block('std', 0.8, 0, 0, 1.6, 100, w, '#8a9096', [0, 0, 0], S(DET.corrugated, 0.5, 0.6));
      for (let y = 6; y < 100; y += 8) B.box('std', 1.8, y, 0, 0.6, 0.8, w, '#6d7378', null, STEEL);
      for (const e of [-1, 1]) {
        B.block('std', 6, 0, e * (w / 2 + 10), 12, 118, 16, '#1a1a1a', null, FABRIC);
        B.block('std', 6, 30, e * (w / 2 - 12), 14, 24, 10, '#101010', null, RUBBER);
      }
      B.block('std', 6, 104, 0, 12, 14, w + 36, '#1a1a1a', null, FABRIC);
      const n = Math.round((it.y - 2000) / 400);
      P.pic(B, 'wg_bay' + Math.max(1, Math.min(3, n)), 1.4, 130, 0, 36, 18, HALF);
      B.box('std', 1, 140, w / 2 + 30, 2, 8, 8, '#3a3d40', null, STEEL);
      rod(B, 'std', [2, 140, w / 2 + 30], [30, 146, w / 2 + 10], 1, '#3a3d40', STEEL);
      B.cyl('std', 32, 140, w / 2 + 8, 5, 8, '#f2c21a', 10, 0.7, null, PAINT);
      P.decal(B, 'wstain', 1.8, 60, -w / 2 - 30, 40, 80, HALF);
    },
    /** The yard gate: a palisade with the gate chained shut. */
    yardgate(P) {
      const { B, it } = P;
      const L = it.w;
      for (const y of [16, 88]) B.box('std', 0, y, 0, L, 3, 3, '#2f3a34', null, STEEL);
      for (let x = -L / 2 + 4; x <= L / 2 - 4; x += 8) {
        B.box('std', x, 50, 1.6, 4, 100, 1, '#2f3a34', null, STEEL);
        B.add('std', T.cyl(3, 0), [x, 103, 1.6], [2.4, 6, 1], null, '#2f3a34', STEEL);
      }
      for (const x of [-L / 2, 0, L / 2]) B.box('std', x, 55, 0, 8, 110, 8, '#252c28', null, STEEL);
      B.cyl('std', 4, 50, 3, 3, 10, '#8a8f94', 8, 1, [HALF, 0, 0], CHROME);
      P.pic(B, 'wg_nopark', 60, 70, -4, 50, 17, Math.PI);
    },
    /** A roof: gravel round the holes (the vault, the skylights), the parapet's inner faces, plant. */
    mallroof(P) {
      const { B, it } = P;
      P.at(B, 0, 0, 0, 19, 0);
      const h = it.h, deck = it.kind === 'deck';
      const holes = it.holes || (it.h > 300 ? [VAULT, ...SKYLIGHTS] : []);
      for (const r of rectMinus(it, holes)) {
        B.quad('std', [(r.x0 + r.x1) / 2, h, (r.y0 + r.y1) / 2], [r.x1 - r.x0, 0, 0], [0, 0, -(r.y1 - r.y0)], deck ? '#8a867c' : '#6a6862', { noAO: true, surf: [deck ? DET.concrete : DET.gravel, 0.95, 0] });
      }
      // the edges of the openings (a slab's thickness)
      for (const r of holes) {
        if (!deck) continue;
        // (each faces into the opening)
        B.quad('std', [(r.x0 + r.x1) / 2, h - 6, r.y0], [r.x1 - r.x0, 0, 0], [0, 12, 0], '#8a867c', CONC);
        B.quad('std', [(r.x0 + r.x1) / 2, h - 6, r.y1], [-(r.x1 - r.x0), 0, 0], [0, 12, 0], '#8a867c', CONC);
        B.quad('std', [r.x0, h - 6, (r.y0 + r.y1) / 2], [0, 0, -(r.y1 - r.y0)], [0, 12, 0], '#8a867c', CONC);
        B.quad('std', [r.x1, h - 6, (r.y0 + r.y1) / 2], [0, 0, r.y1 - r.y0], [0, 12, 0], '#8a867c', CONC);
      }
      // (the underside: the ceilings of the rooms are lower; this keeps the sky out of the gaps)
      for (const r of rectMinus(it, holes)) B.quad('std', [(r.x0 + r.x1) / 2, h - 2, (r.y0 + r.y1) / 2], [r.x1 - r.x0, 0, 0], [0, 0, r.y1 - r.y0], '#3a3a38', { noAO: true, surf: [DET.concrete, 1, 0] });
      // the parapet's inner faces and a skirt where this roof steps down to a lower one
      const pc = '#a9a49a';
      const x0 = it.x0 + 12, x1 = it.x1 - 12, y0 = it.y0 + 12, y1 = it.y1 - 12;
      B.quad('std', [(x0 + x1) / 2, h + 8, y0], [x1 - x0, 0, 0], [0, 16, 0], pc, CONC);
      B.quad('std', [(x0 + x1) / 2, h + 8, y1], [-(x1 - x0), 0, 0], [0, 16, 0], pc, CONC);
      B.quad('std', [x0, h + 8, (y0 + y1) / 2], [0, 0, -(y1 - y0)], [0, 16, 0], pc, CONC);
      B.quad('std', [x1, h + 8, (y0 + y1) / 2], [0, 0, y1 - y0], [0, 16, 0], pc, CONC);
      // where this roof stands over a lower one, its wall's upper face (the wall's own faces stop at the rooms)
      if (it.skirt === 'e') B.quad('std', [it.x1 + 12.6, (115 + h + 16) / 2, (it.y0 + it.y1) / 2], [0, 0, -(it.y1 - it.y0)], [0, h + 16 - 115, 0], '#c8c2b4', CONC);
      if (it.skirt === 'n') B.quad('std', [(it.x0 + it.x1) / 2, (115 + h + 16) / 2, it.y0 - 12.6], [-(it.x1 - it.x0), 0, 0], [0, h + 16 - 115, 0], '#c8c2b4', CONC);
      if (deck) return;
      // plant: HVAC units, vents, ducts
      const units = h > 300 ? [[3300, 1000], [4400, 1000], [5500, 1000], [6600, 1000], [3300, 3600], [6800, 3700], [5700, 3700]] : [[7800, 2400], [8800, 2400], [7800, 3500], [9200, 3300]];
      for (const [x, z] of units) {
        B.rblock('std', x, h, z, 140, 44, 90, 1.5, '#9aa0a4', null, S(DET.panel, 0.45, 0.6));
        B.cyl('std', x + 30, h + 44, z, 26, 3, '#2a2d30', 16, 1, null, S(DET.hesco, 0.5, 0.7));
        for (let k = 0; k < 6; k++) B.box('std', x - 60 + k * 20, h + 22, z + 45.4, 1.4, 34, 0.6, '#2a2d30', null, STEEL);
      }
      if (P.lod() >= 1) {
        for (let k = 0; k < 16; k++) {
          const x = it.x0 + 100 + hash01(k * 7 + h) * (it.x1 - it.x0 - 200), z = it.y0 + 100 + hash01(k * 13 + h) * (it.y1 - it.y0 - 200);
          if (holes.some((r) => x > r.x0 - 40 && x < r.x1 + 40 && z > r.y0 - 40 && z < r.y1 + 40)) continue;
          B.cyl('std', x, h, z, 4, 18, '#6d7275', 8, 1, null, STEEL);
          B.cyl('std', x, h + 18, z, 6, 3, '#5a5e62', 8, 0.6, null, STEEL);
        }
        for (let k = 0; k < 8; k++) P.flat(B, 'grime2', it.x0 + hash01(k * 3 + h) * (it.x1 - it.x0), h + 0.3, it.y0 + hash01(k * 5 + h) * (it.y1 - it.y0), 260, 200, k, { color: '#8a9aa8' });
      }
    },
    barrierarm(P) {
      const { B, it } = P;
      B.rblock('std', -it.w / 2, 0, 0, 18, 40, 18, 1, '#e8e4d8', null, PAINT);
      B.box('std', -it.w / 2, 42, 0, 20, 4, 20, '#c62828', null, PAINT);
      B.box('std', 0, 2, 12, it.w * 0.8, 3, 3, '#e8e4d8', [0, 0.25, 0], PAINT);
      for (let x = -it.w * 0.35; x < it.w * 0.4; x += 24) B.box('std', x, 2, 12 + x * 0.25, 10, 3.2, 3.2, '#c62828', [0, 0.25, 0], PAINT);
    },
  };

  return { OBSTACLES, ITEMS };
}

/** A sloped band along local z at x (from z = za at height ha to z = zb at height hb): up/down around the line, `th` thick. */
function slopedWallZ(B, x, za, zb, ha, hb, up, down, th, color, surf) {
  const len = zb - za, dh = hb - ha, zm = (za + zb) / 2, hm = (ha + hb) / 2;
  const H = up + down, yc = hm + (up - down) / 2;
  // (a quad faces e1 × e2: these face ±x, and the top faces up whichever way the band runs)
  const sx = len < 0 ? 1 : -1;
  B.quad('std', [x + th / 2, yc, zm], [0, sx * dh, sx * len], [0, H, 0], color, surf);
  B.quad('std', [x - th / 2, yc, zm], [0, -sx * dh, -sx * len], [0, H, 0], color, surf);
  B.quad('std', [x, hm + up, zm], [0, dh, len], [Math.sign(len) * th, 0, 0], shadeHex(color, -0.1), surf);
}

/** A right triangle (0,0) (1,0) (1,1) in the xy plane, both faces (scale and turn it into place). */
export const RTRI = () => T.custom('mall-rtri2', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0], 2));
  return g;
});

/** An escalator handrail: black rubber along the slope (zBot at 0 → zTop at H), flat over both landings. */
function handrail(B, x, zBot, zTop, H, y, ang) {
  const len = Math.hypot(zTop - zBot, H);
  B.add('std', T.box(), [x, H / 2 + y, (zBot + zTop) / 2], [3, 2.4, len], [ang, 0, 0], '#141414', RUBBER);
  B.box('std', x, y, zBot + 12, 3, 2.4, 24, '#141414', null, RUBBER);
  B.box('std', x, H + y, zTop - 12, 3, 2.4, 24, '#141414', null, RUBBER);
}

/** A rectangle minus axis-aligned holes, as rectangles (a grid cut at the holes' edges). */
export function rectMinus(r, holes) {
  const xs = [r.x0, r.x1], ys = [r.y0, r.y1];
  for (const h of holes) {
    if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.y1 <= r.y0 || h.y0 >= r.y1) continue;
    xs.push(Math.max(r.x0, h.x0), Math.min(r.x1, h.x1));
    ys.push(Math.max(r.y0, h.y0), Math.min(r.y1, h.y1));
  }
  const X = [...new Set(xs)].sort((a, b) => a - b), Y = [...new Set(ys)].sort((a, b) => a - b);
  const out = [];
  for (let j = 0; j < Y.length - 1; j++) {
    // merge along x within a row
    let run = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
      const inHole = holes.some((h) => cx > h.x0 && cx < h.x1 && cy > h.y0 && cy < h.y1);
      if (inHole) { if (run) { out.push(run); run = null; } continue; }
      if (run) run.x1 = X[i + 1]; else run = { x0: X[i], x1: X[i + 1], y0: Y[j], y1: Y[j + 1] };
    }
    if (run) out.push(run);
  }
  return out;
}
