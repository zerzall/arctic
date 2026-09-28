// Buildings of the static world (WORLD, SPEC §7.5): facades in brick, stained concrete,
// stucco, lap siding or corrugated metal (chosen from the obstacle's colour and id),
// framed windows with sills — dark glass, boarded, or lit rooms (some flickering, some
// with a TV's blue glow), doors with a lamp and a canopy, shop fronts, roll-up garage
// doors, posters, drainpipes; flat roofs with parapet caps, AC units, vents, a water tank
// or a pitched shingle roof on small houses. Plus the diner (the truck stop objective)
// with its glowing neon, and the radio mast.

import * as THREE from 'three';
import { T, shadeHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { trashBags } from './world-props.js';

const GLASS = '#0f151b';
const CHROME = '#c9ced3';

/** Canonical height of a building obstacle (150–260). */
export function buildingHeight(o) {
  const small = Math.max(o.w, o.h) < 170;
  if (small) return 150 + Math.round(hash01(o.id * 7 + 1) * 20);
  const area = Math.min(1, (o.w * o.h) / 60000);
  return Math.round(150 + area * 70 + hash01(o.id * 13 + 5) * 40);
}

function facadeOf(o) {
  const c = new THREE.Color(o.color);
  const warm = c.r > c.b * 1.35;
  const h = hash01(o.id * 29 + 3);
  const big = Math.max(o.w, o.h) >= 300;
  if (big && h < 0.5) return 'corrugated';
  if (warm && c.r > 0.12 && c.g < c.r * 0.7) return 'brick';
  if (Math.max(o.w, o.h) < 170) return h < 0.55 ? 'siding' : 'stucco';
  return h < 0.4 ? 'concrete' : h < 0.7 ? 'stucco' : 'brick';
}

/**
 * A building obstacle.
 * @param {object} B builder (object frame placed)
 * @param {object} o obstacle
 * @param {object} [sign] { cell, color } a neon sign for its roof
 */
export function building(B, o, L, W, sign) {
  const r = B.rng;
  const H = buildingHeight(o);
  const small = Math.max(L, W) < 170;
  const wallH = small ? H - 50 : H;
  const color = o.color;
  const facade = facadeOf(o);
  const layer = DET[facade];
  const S = [layer, facade === 'corrugated' ? 0.55 : 0.88, facade === 'corrugated' ? 0.5 : 0];
  B.block('std', 0, 0, 0, L, wallH, W, color, null, { surf: S });
  B.rblock('std', 0, 0, 0, L + 3, 12, W + 3, 0.8, shadeHex(color, -0.35), null, { surf: [DET.concrete, 0.9, 0] });   // plinth
  // storey bands on masonry
  const floorH = 46;
  const floors = Math.max(1, Math.floor((wallH - 20) / floorH));
  if (facade !== 'corrugated' && facade !== 'siding') {
    for (let f = 1; f < floors; f++) B.box('std', 0, 22 + f * floorH - 5, 0, L + 1.6, 2.4, W + 1.6, shadeHex(color, 0.1), null, { surf: [DET.concrete, 0.85, 0] });
  }
  const faces = [
    { len: L, z: W / 2, rot: 0, ax: 'x' }, { len: L, z: -W / 2, rot: Math.PI, ax: 'x' },
    { len: W, z: L / 2, rot: Math.PI / 2, ax: 'z' }, { len: W, z: -L / 2, rot: -Math.PI / 2, ax: 'z' },
  ];
  const litRate = small ? 0.26 : 0.16;
  const industrial = facade === 'corrugated';
  const frameC = industrial ? '#3a3e42' : facade === 'siding' ? '#e8e2d4' : '#2a2622';
  // face-local → object-local
  const at = (f, t, out) => {
    const sz = Math.sign(f.z);
    return f.ax === 'x' ? [t, sz * (Math.abs(f.z) + out)] : [sz * (Math.abs(f.z) + out), -t * sz];
  };
  const put = (bucket, f, t, y, out, sx, sy, sz, color2, o2) => {
    const [lx, lz] = at(f, t, out);
    B.add(bucket, sz === null ? T.plane() : T.box(), [lx, y, lz], sz === null ? [sx, sy, 1] : [sx, sy, sz], [0, f.rot, 0], color2, o2);
  };
  faces.forEach((f, fi) => {
    const n = Math.max(1, Math.floor((f.len - 20) / (industrial ? 60 : 34)));
    const step = (f.len - 20) / n;
    const doorAt = fi === 0 ? Math.floor(n / 2) : -1;
    const shopFront = fi === 0 && !industrial && !small && hash01(o.id * 3 + 7) < 0.6;
    const garage = industrial && fi <= 1 ? [Math.floor(n * 0.25), Math.floor(n * 0.7)] : [];
    for (let fl = 0; fl < floors; fl++) {
      const y = 22 + fl * floorH + 16;
      for (let i = 0; i < n; i++) {
        const t = -f.len / 2 + 10 + (i + 0.5) * step;
        if (fl === 0 && garage.includes(i)) {
          put('decal', f, t, 25, 0.4, Math.min(44, step - 6), 46, null, '#ffffff', { uv: atlasUV('garage'), noAO: true });
          put('std', f, t, 49, 1.2, Math.min(46, step - 4), 3, 2.4, '#2a2d30', { surf: [DET.rust, 0.6, 0.7] });
          continue;
        }
        if (fl === 0 && i === doorAt) {
          put('std', f, t, 19, 0.3, 17, 38, 0.6, '#2a1e16', { surf: [DET.wood, 0.8, 0] });
          put('std', f, t, 19.5, 0.9, 19.5, 40.5, 0.8, frameC, { surf: [DET.panel, 0.6, 0.3] });
          put('std', f, t, 43, 5, 28, 1.6, 10, '#3a3e42', { surf: [DET.panel, 0.5, 0.5] });    // door canopy
          put('glow', f, t, 41.5, 1.4, 8, 3, 3, '#ffd79a', { emissive: 4, uv: atlasUV('white') });
          continue;
        }
        if (fl === 0 && shopFront) {
          put('glow', f, t, 22, 0.35, step - 4, 26, null, '#ffffff', { emissive: 1.0, uv: atlasUV('shop') });
          put('std', f, t, 36, 0.8, step, 2, 1.2, frameC, { surf: [DET.panel, 0.5, 0.5] });
          continue;
        }
        const wW = industrial ? 26 : 15, wH = industrial ? 12 : 22;
        const wy = industrial ? y + 6 : y;
        const lit = hash01(o.id * 131 + fi * 37 + fl * 11 + i) < litRate;
        // frame bars around the pane (the pane sits back in them, clear of the wall and the bars)
        const FS = { surf: [DET.panel, 0.6, 0.2] };
        put('std', f, t, wy + wH / 2 + 0.7, 0.7, wW + 2.8, 1.4, 1.4, frameC, FS);
        put('std', f, t, wy - wH / 2 - 0.7, 0.7, wW + 2.8, 1.4, 1.4, frameC, FS);
        for (const sx of [-1, 1]) {
          const [fx, fz] = at(f, t + sx * (wW / 2 + 0.7), 0.7);
          B.add('std', T.box(), [fx, wy, fz], [1.4, wH, 1.4], [0, f.rot, 0], frameC, FS);
        }
        if (!industrial) put('std', f, t, wy, 0.35, 1, wH, 0.7, frameC, FS);   // mullion
        if (!industrial) put('std', f, t, wy - wH / 2 - 1.6, 1.6, wW + 5, 1.6, 3.2, shadeHex(color, 0.15), { surf: [DET.concrete, 0.85, 0] });
        if (lit) {
          const k = hash01(o.id + i * 3 + fl);
          const cell = industrial ? 'winOffice' : k < 0.2 ? 'winCool' : k < 0.36 ? 'winTV' : k < 0.52 ? 'winBlind' : k < 0.68 ? 'winDim' : 'win';
          const flick = hash01(o.id * 17 + i * 5 + fl * 3) < 0.22 || cell === 'winTV';
          put(flick ? 'flicker' : 'glow', f, t, wy, 0.3, wW, wH, null, '#ffffff', { emissive: cell === 'winDim' ? 0.85 : 0.95, uv: atlasUV(cell) });
        } else {
          const boarded = hash01(o.id * 53 + i + fl * 5) < 0.14;
          if (boarded) {
            for (let p = 0; p < 3; p++) put('std', f, t, wy - wH / 3 + p * (wH / 3), 1.3, wW + 3, wH / 3 - 1, 0.8, r.pick(['#5a4632', '#6b5a44', '#4a3a2a']), { surf: [DET.wood, 0.85, 0] });
          } else {
            put('glass', f, t, wy, 0.3, wW, wH, null, GLASS, { surf: [hash01(o.id * 71 + i + fl) < 0.18 ? DET.glass : 0, -1, -1] });
          }
        }
      }
    }
    // a poster or two at street level, drainpipes at the corners
    if (!industrial && r.chance(0.6)) put('decal', f, r.range(-f.len * 0.4, f.len * 0.4), 30, 0.4, 16, 24, null, '#ffffff', { uv: atlasUV('poster' + Math.floor(r.next() * 3)), noAO: true });
    const [px, pz] = at(f, f.len / 2 - 3, 2.2);
    B.cyl('std', px, 0, pz, 1.4, wallH, '#5a5e62', 8, 1, null, { surf: [DET.rust, 0.5, 0.7] });
  });
  if (small) {
    // pitched shingle roof along the long side, a chimney
    const long = L >= W;
    const span = long ? W : L, len = long ? L : W;
    const pts = [[-span / 2 - 6, 0], [span / 2 + 6, 0], [0, 50]];
    B.add('std', T.profile('roof' + span, pts, 0.6, len + 10), [0, wallH, 0], [1, 1, 1], [0, long ? Math.PI / 2 : 0, 0], o.roof || '#4e4a45', { surf: [DET.shingle, 0.85, 0] });
    B.rblock('std', L * 0.25, wallH + 14, W * 0.1, 12, 48, 12, 0.6, shadeHex(color, -0.25), null, { surf: [DET.brick, 0.9, 0] });
    // gutters
    for (const s of [-1, 1]) B.box('std', long ? 0 : s * (L / 2 + 5), wallH - 0.5, long ? s * (W / 2 + 5) : 0, long ? L + 10 : 2, 2, long ? 2 : W + 10, '#5a5e62', null, { surf: [DET.rust, 0.5, 0.7] });
  } else {
    // flat roof: membrane, parapet with coping, plant
    B.block('std', 0, wallH, 0, L - 6, 1, W - 6, o.roof || '#4e4a45', null, { surf: [DET.slab, 0.9, 0] });
    for (const s of [-1, 1]) {
      B.block('std', 0, wallH, s * (W / 2 - 2), L, 7, 4, shadeHex(color, -0.1), null, { surf: S });
      B.block('std', s * (L / 2 - 2), wallH, 0, 4, 7, W, shadeHex(color, -0.1), null, { surf: S });
      B.box('std', 0, wallH + 7.6, s * (W / 2 - 2), L + 1, 1.2, 5.6, '#8a8a84', null, { surf: [DET.concrete, 0.7, 0.2] });
      B.box('std', s * (L / 2 - 2), wallH + 7.6, 0, 5.6, 1.2, W + 1, '#8a8a84', null, { surf: [DET.concrete, 0.7, 0.2] });
    }
    const nAC = 1 + Math.floor(r.next() * 3);
    for (let i = 0; i < nAC; i++) {
      const ax = r.range(-L * 0.3, L * 0.3), az = r.range(-W * 0.25, W * 0.25);
      B.rblock('std', ax, wallH + 1, az, 22, 13, 16, 1, '#8e9294', null, { surf: [DET.panel, 0.45, 0.6] });
      B.box('std', ax, wallH + 8, az + 8.2, 18, 9, 0.4, '#2a2c2e', null, { surf: [DET.corrugated, 0.5, 0.7] });
      B.cyl('std', ax, wallH + 14, az, 5, 1, '#3a3c3e', 12, 1, null, { surf: [DET.hesco, 0.5, 0.8] });
    }
    for (let i = 0; i < 3; i++) B.cyl('std', r.range(-L * 0.4, L * 0.4), wallH + 1, r.range(-W * 0.4, W * 0.4), 2.2, r.range(6, 14), '#5a5e62', 8, 1, null, { surf: [DET.rust, 0.5, 0.7] });
    if (r.chance(0.5)) B.rblock('std', r.range(-L * 0.3, L * 0.3), wallH + 1, r.range(-W * 0.2, W * 0.2), 26, 20, 26, 0.8, shadeHex(color, -0.15), null, { surf: S });
    if (wallH > 190 && r.chance(0.7)) {
      // water tank on legs
      const tx = r.range(-L * 0.25, L * 0.25), tz = r.range(-W * 0.2, W * 0.2);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.block('std', tx + a * 9, wallH + 1, tz + b * 9, 1.6, 22, 1.6, '#3a3632', null, { surf: [DET.rust, 0.7, 0.6] });
      B.cyl('std', tx, wallH + 22, tz, 14, 26, '#5a4a3a', 14, 1, null, { surf: [DET.wood, 0.85, 0] });
      B.cyl('std', tx, wallH + 48, tz, 14.5, 7, '#3a3632', 14, 0.1, null, { surf: [DET.rust, 0.7, 0.4] });
    }
    if (r.chance(0.5)) {
      // antenna and a satellite dish
      B.cyl('std', L * 0.3, wallH + 1, -W * 0.3, 0.8, 40, '#8a8e92', 5, 1, null, { surf: [0, 0.4, 0.9] });
      B.add('std', T.sphere(10, 5), [-L * 0.3, wallH + 12, W * 0.3], [7, 7, 2], [0.4, 0.7, 0], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
    }
    if (sign) {
      // a neon sign on posts over the roof edge
      for (const x of [-70, 70]) B.block('std', x, wallH + 1, W / 2 - 14, 4, 34, 4, '#333', null, { surf: [DET.rust, 0.6, 0.7] });
      B.box('std', 0, wallH + 60, W / 2 - 14, 200, 52, 5, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
      B.add('neon', T.plane(), [0, wallH + 60, W / 2 - 11.2], [194, 48, 1], null, '#ffffff', { emissive: 2.4, uv: atlasUV(sign.cell) });
      B.add('neon', T.plane(), [0, wallH + 60, W / 2 - 16.8], [194, 48, 1], [0, Math.PI, 0], '#ffffff', { emissive: 2.2, uv: atlasUV(sign.cell) });
    }
  }
  // trash at the back
  if (r.chance(0.7)) trashBags(B, r, 2 + Math.floor(r.next() * 4), L * 0.6, -(W / 2 + 5));
}

/** The diner objective: stainless siding, red stripes, lit windows, neon signs. */
export function diner(B, L, W, halos, ob) {
  const H = 96;
  const steel = [DET.corrugated, 0.42, 0.8];
  B.rblock('std', 0, 0, 0, L + 4, 10, W + 4, 1, '#6a5f55', null, { surf: [DET.concrete, 0.9, 0] });
  B.rblock('std', 0, 10, 0, L, H - 10, W, 3, '#c8cdd0', null, { surf: steel });
  for (const sd of [-1, 1]) {
    B.box('std', 0, 24, sd * (W / 2 + 0.6), L, 8, 1, '#a51f25', null, { surf: [DET.panel, 0.35, 0.3] });
    B.box('std', 0, 84, sd * (W / 2 + 0.7), L, 5, 1, CHROME, null, { surf: [0, 0.15, 1] });
  }
  // front windows (+z = sim +y side, where the neon sign light is)
  const n = 5;
  const span = L * 0.8;
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + ((i + 0.5) * span) / n;
    if (i === 2) {
      // the glass door: the lit room behind, dimmer than the windows. In front of its chrome
      // frame (a solid slab behind it): buried behind the slab, the door was a flat mirror
      // that threw the flashlight straight back into the camera as a huge glare.
      B.add('glow', T.plane(), [x, 30, W / 2 + 1.05], [24, 44, 1], null, '#ffe2b0', { emissive: 0.62, uv: atlasUV('dinerWin') });
      B.box('std', x, 30, W / 2 + 0.6, 27, 47, 0.8, CHROME, null, { surf: [0, 0.2, 1] });
      continue;
    }
    B.box('std', x, 52, W / 2 + 0.6, span / n - 3, 43, 0.8, CHROME, null, { surf: [0, 0.2, 1] });
    B.add('glow', T.plane(), [x, 52, W / 2 + 1.05], [span / n - 6, 40, 1], null, '#ffffff', { emissive: 0.95, uv: atlasUV('dinerWin') });
  }
  for (let i = 0; i < 3; i++) B.add('glow', T.plane(), [-L / 4 + (i * L) / 4, 55, -W / 2 - 0.8], [30, 30, 1], [0, Math.PI, 0], '#ffffff', { emissive: 0.9, uv: atlasUV('win') });
  // awning
  B.add('std', T.profile('awning', [[0, 0], [22, -10], [22, -8], [0, 2]], 0.4, span + 20), [0, 80, W / 2], [1, 1, 1], [0, -Math.PI / 2, 0], '#b3261e', { surf: [DET.fabric, 0.8, 0] });
  // roof, parapet, the big neon sign on posts
  B.block('std', 0, H, 0, L - 4, 2, W - 4, '#4a4744', null, { surf: [DET.slab, 0.9, 0] });
  B.rblock('std', 0, H, W / 2 - 2, L + 2, 8, 4, 0.8, '#c8c0b0', null, { surf: [DET.concrete, 0.8, 0] });
  for (const x of [-60, 60]) B.block('std', x, H + 2, W / 2 - 16, 4, 30, 4, '#333', null, { surf: [DET.rust, 0.6, 0.7] });
  B.box('std', 0, H + 46, W / 2 - 16, 170, 44, 6, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 12.8], [164, 40, 1], null, '#ffffff', { emissive: 2.6, uv: atlasUV('neonDiner') });
  B.add('neon', T.plane(), [0, H + 46, W / 2 - 19.2], [164, 40, 1], [0, Math.PI, 0], '#ffffff', { emissive: 2.4, uv: atlasUV('neonDiner') });
  // "EAT" blade sign on the corner
  B.box('std', L / 2 + 20, 70, W / 2 - 10, 4, 34, 60, '#1a0c12', null, { surf: [DET.panel, 0.5, 0.4] });
  B.add('neon', T.plane(), [L / 2 + 22.2, 70, W / 2 - 10], [56, 30, 1], [0, Math.PI / 2, 0], '#ffffff', { emissive: 2.6, uv: atlasUV('neonEat') });
  B.add('neon', T.plane(), [L / 2 + 17.8, 70, W / 2 - 10], [56, 30, 1], [0, -Math.PI / 2, 0], '#ffffff', { emissive: 2.6, uv: atlasUV('neonEat') });
  B.rblock('std', L * 0.2, H + 2, -W * 0.2, 26, 14, 20, 1, '#8e9294', null, { surf: [DET.panel, 0.45, 0.6] });
  B.cyl('std', -L * 0.3, H + 2, -W * 0.25, 5, 18, '#7a7e82', 10, 1, null, { surf: [DET.rust, 0.5, 0.7] });
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  const wx = (lx, lz) => ob.x + lx * c - lz * s, wy = (lx, lz) => ob.y + lx * s + lz * c;
  halos.push({ x: wx(0, W / 2 - 10), y: wy(0, W / 2 - 10), h: H + 46, color: '#ff3d8b', size: 260, strength: 0.35 });
  halos.push({ x: wx(L / 2 + 20, W / 2 - 10), y: wy(L / 2 + 20, W / 2 - 10), h: 70, color: '#ff7a1a', size: 120, strength: 0.3 });
}

function beam(B, bucket, x0, y0, z0, x1, y1, z1, rad, color, surf) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  B.add(bucket, T.cyl(5), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [rad, len, rad], [e.x, e.y, e.z], color, { surf, map: 'cyl' });
}
export { beam };

/** Radio objective: equipment hut and a lattice mast with blinking red beacons. */
export function radio(B, L, W, halos, ob) {
  B.rblock('std', 0, 0, 0, L * 0.9, 58, W * 0.9, 1, '#8d8a80', null, { surf: [DET.concrete, 0.88, 0] });
  B.rblock('std', 0, 58, 0, L * 0.96, 4, W * 0.96, 0.8, '#5d5a52', null, { surf: [DET.panel, 0.6, 0.4] });
  B.add('std', T.plane(), [0, 20, W * 0.45 + 0.4], [14, 38, 1], null, '#39352c', { surf: [DET.rust, 0.7, 0.6] });
  B.box('glow', 0, 44, W * 0.45 + 1, 5, 3, 2, '#ffd9a0', null, { emissive: 4, uv: atlasUV('white') });
  B.box('std', L * 0.3, 30, W * 0.45 + 0.4, 12, 16, 1, '#2a2c2e', null, { surf: [DET.corrugated, 0.5, 0.7] });
  const top = 540;
  const w0 = L * 0.34, w1 = 8;
  const corner = (y) => w0 + (w1 - w0) * ((y - 62) / (top - 62));
  const col = '#9a9ea2';
  const S = [DET.rust, 0.45, 0.85];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(B, 'std', sx * w0, 62, sz * w0, sx * w1, top, sz * w1, 2, col, S);
  for (let y = 62; y < top - 30; y += 48) {
    const y2 = Math.min(top, y + 48);
    const a = corner(y), b = corner(y2);
    for (const [px, pz, qx, qz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      beam(B, 'std', px * a, y, pz * a, qx * b, y2, qz * b, 0.9, col, S);
      beam(B, 'std', px * a, y, pz * a, qx * a, y, qz * a, 0.9, col, S);
    }
  }
  B.cyl('std', 0, top, 0, 1.5, 60, col, 6, 1, null, { surf: S });
  B.add('std', T.cyl(14, 1), [corner(300) + 6, 300, 0], [14, 4, 14], [0, 0, Math.PI / 2], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
  B.add('std', T.cyl(14, 1), [0, 380, -corner(380) - 5], [10, 3, 10], [Math.PI / 2, 0, 0], '#d8d8d0', { surf: [DET.panel, 0.5, 0.3] });
  const c = Math.cos(ob.a || 0), s = Math.sin(ob.a || 0);
  for (const y of [200, 380, top + 60]) {
    const k = corner(Math.min(y, top));
    for (const [sx, sz] of y > top ? [[0, 0]] : [[-1, -1], [1, 1]]) {
      B.add('blink', T.sphere(6, 4), [sx * k, y, sz * k], [3.5, 3.5, 3.5], null, '#ff2a1a', { emissive: 3.4 });
      halos.push({ x: ob.x + sx * k * c - sz * k * s, y: ob.y + sx * k * s + sz * k * c, h: y, color: '#ff2a1a', size: 90, blink: 1, strength: 0.8 });
    }
  }
}

