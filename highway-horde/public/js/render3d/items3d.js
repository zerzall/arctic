// Things in the world that are not people (ACTORS, SPEC §7.5): projectiles by kind
// (crossbow bolt, launcher grenade, rocket with exhaust + smoke trail + light, flame
// tongues, thrown frag, molotov with a burning rag, acid glob, a burning flare that lights
// the road, frost mist, a harpoon trailing its line), pickups (floating,
// spinning props — ammo can, medkit, cash bundles, armour plate, grenades — with a
// glowing icon above and a halo on the ground; weapon crates with the gun itself hovering
// over them and its short name), sentry turrets (tripod, armoured head with a shield,
// barrel shroud, ammo box and a sensor lens that glows green / amber / blinking red),
// barricades (posts, sandbags, a steel sheet and planks that fall off as it takes damage)
// and hazards (spreading fire patches, bubbling acid, road flares burning on the ground
// with a strong red pool light each). Props share the hard-surface PBR
// material of the guns (actor-guns.js gunKit); everything is instanced per kind, so the
// whole lot costs a handful of draw calls.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PICKUP_KINDS } from '../shared/items.js';
import { BARRICADE, PLAYER_COLORS } from '../shared/constants.js';
import { col, makeCanvas, canvasTexture, hash01 } from './actor-kit.js';
import { gunObject, gunMaterials, gunKit } from './actor-guns.js';
import { acquireFx, releaseFx, F_ADD, F_FIRE, F_FLICKER, F_BOUNCE, F_HOT, FR } from './fx-core.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const P_CAP = 160, PK_CAP = 64, T_CAP = 16, B_CAP = 32, H_CAP = 32;
const PICKUP_GLOW = { ammo: '#ffd54f', health: '#ff5252', cash: '#7dff9a', armor: '#64b5f6', frag: '#ffb74d', crate: '#ffe082' };
const { GunBuilder, ext, rbox, cylX, latheX, sphere, torusX, tubePath, GM } = gunKit;
const DARK = '#1b1c1e', STEEL = '#3d4146', WOOD = '#7a5634', OLIVE = '#4b5a2e';

// ---------------------------------------------------------------------------------------
// models (built per renderer; geometries disposed with it)

/** One geometry (solid) + optional glow geometry from a builder callback. */
function built(fn) {
  const gb = new GunBuilder();
  fn(gb);
  const g = gb.build();
  return { body: g.body || null, glow: g['body:glow'] || null };
}

function grenadeBody(gb, x, y, z, s = 1, rot = 0) {
  // pineapple frag: segmented body, fuze, spoon, pin ring
  const at = (px, py, pz) => [x + (px * Math.cos(rot) - pz * Math.sin(rot)) * s, y + py * s, z + (px * Math.sin(rot) + pz * Math.cos(rot)) * s];
  const lg = new THREE.LatheGeometry([[0, -1.9], [1.1, -1.8], [1.5, -1.2], [1.6, 0], [1.45, 1.1], [0.8, 1.7], [0.6, 1.8], [0, 1.8]].map(([r, h]) => new THREE.Vector2(r, h)), 12);
  gb.add(lg, { at: at(0, 0, 0), scale: [s, s, s], color: '#3e4a28', mat: GM.PAINT, round: true });
  for (let k = 0; k < 3; k++) {
    const tg = new THREE.TorusGeometry(1.55 - Math.abs(k - 1) * 0.2, 0.08, 4, 16);
    tg.rotateX(HALF_PI);
    gb.add(tg, { at: at(0, -0.9 + k * 0.9, 0), scale: [s, s, s], color: '#2c3620', mat: GM.PAINT, round: true });
  }
  const fz = new THREE.CylinderGeometry(0.45, 0.5, 0.9, 10);
  gb.add(fz, { at: at(0, 2.2, 0), scale: [s, s, s], color: '#7a7a70', mat: GM.STEEL, round: true });
  const sp = new THREE.BoxGeometry(0.5, 2.6, 0.15);
  gb.add(sp, { at: at(0.55, 1.2, 0), rot: [0, -rot, -0.25], scale: [s, s, s], color: '#8a8a80', mat: GM.STEEL });
  const ring = new THREE.TorusGeometry(0.45, 0.07, 5, 14);
  gb.add(ring, { at: at(-0.2, 2.4, 0.6), rot: [0.3, rot, 0], scale: [s, s, s], color: '#a0a098', mat: GM.STEEL, round: true });
}

function pickupModels() {
  const m = {};
  // ammo can: olive steel, lid, handle, latch, a stencilled band and loose rounds
  m.ammo = built((gb) => {
    rbox(gb, -4.2, 4.2, -3.3, 2.6, -2.2, 2.2, 0.35, { color: OLIVE, mat: GM.PAINT });
    rbox(gb, -4.45, 4.45, 2.4, 3.3, -2.4, 2.4, 0.3, { color: '#435226', mat: GM.PAINT });
    rbox(gb, -4.25, 4.25, -1.2, -0.5, -2.25, 2.25, 0.05, { color: '#d8c040', mat: GM.PAINT });
    tubePath(gb, [[-2.2, 3.3, 0], [-1.6, 4.6, 0], [1.6, 4.6, 0], [2.2, 3.3, 0]], 0.28, { color: DARK, mat: GM.STEEL, seg: 12 });
    rbox(gb, 3.9, 4.8, 1.2, 3.2, -1.0, 1.0, 0.15, { color: '#353e22', mat: GM.STEEL });
    for (let k = 0; k < 3; k++) {
      const lg = new THREE.LatheGeometry([[0, 0], [0.42, 0], [0.42, 2.6], [0.3, 3.1], [0.18, 3.9], [0, 4.2]].map(([r, h]) => new THREE.Vector2(Math.max(0.001, r), h)), 10);
      gb.add(lg, { at: [-2.2 + k * 1.1, -3.3 + 0.45, -3.2], rot: [0, 0, -HALF_PI], color: '#c9a24a', mat: GM.BRASS, round: true });
    }
  });
  // medkit: white case, red crosses (glowing), latches and a handle
  m.health = built((gb) => {
    rbox(gb, -4.8, 4.8, -3.2, 3.2, -2.2, 2.2, 0.9, { color: '#e8e8e4', mat: GM.POLY });
    rbox(gb, -4.9, 4.9, -0.25, 0.25, -2.3, 2.3, 0.1, { color: '#b0b0aa', mat: GM.POLY });
    for (const z of [-2.28, 2.28]) {
      rbox(gb, -0.55, 0.55, -2.0, 2.0, z - 0.06, z + 0.06, 0.05, { glow: true, color: '#ff2a2a' });
      rbox(gb, -2.0, 2.0, -0.55, 0.55, z - 0.06, z + 0.06, 0.05, { glow: true, color: '#ff2a2a' });
    }
    tubePath(gb, [[-2.0, 3.2, 0], [-1.4, 4.3, 0], [1.4, 4.3, 0], [2.0, 3.2, 0]], 0.35, { color: '#2a2a2a', mat: GM.RUBBER, seg: 12 });
    for (const x of [-3.2, 3.2]) rbox(gb, x - 0.4, x + 0.4, -0.6, 0.6, -2.4, 2.4, 0.1, { color: '#8a8a88', mat: GM.STEEL });
  });
  // cash: three banded bundles of bills and a few coins
  m.cash = built((gb) => {
    const bundle = (x, y, z, r) => {
      rbox(gb, -3.2, 3.2, -0.75, 0.75, -1.5, 1.5, 0.12, { color: '#3f7d4a', mat: GM.POLY, at: [x, y, z], rot: [0, r, 0] });
      rbox(gb, -0.5, 0.5, -0.8, 0.8, -1.55, 1.55, 0.06, { color: '#e8e2cc', mat: GM.POLY, at: [x, y, z], rot: [0, r, 0] });
    };
    bundle(0, -1.6, 0, 0.1); bundle(0.4, 0, 0.3, -0.2); bundle(-0.3, 1.6, -0.2, 0.35);
    for (let k = 0; k < 3; k++) {
      const cg = new THREE.CylinderGeometry(0.9, 0.9, 0.22, 16);
      gb.add(cg, { at: [3.6 - k * 0.5, -2.3 + k * 0.24, 1.8], color: '#d8b040', mat: GM.BRASS, round: true });
    }
  });
  // armour: a plate carrier front with straps and a pouch
  m.armor = built((gb) => {
    ext(gb, [[-3.4, -4], [3.4, -4], [3.6, 2.2], [2.2, 4.2], [1.0, 3.2], [-1.0, 3.2], [-2.2, 4.2], [-3.6, 2.2]], -0.9, 0.9, { color: '#34506e', mat: GM.POLY, bevel: 0.4, bevelSeg: 3 });
    ext(gb, [[-2.6, -3.2], [2.6, -3.2], [2.8, 1.8], [-2.8, 1.8]], 0.9, 1.4, { color: '#4a6a90', mat: GM.PAINT, bevel: 0.2 });
    for (const x of [-2.6, 2.6]) rbox(gb, x - 0.5, x + 0.5, 1.5, 4.8, -0.95, 0.95, 0.2, { color: '#22364c', mat: GM.RUBBER });
    rbox(gb, -1.8, 1.8, -2.8, -0.8, 1.3, 2.2, 0.3, { color: '#2c4460', mat: GM.POLY });
  });
  // frags: two grenades on a strap
  m.frag = built((gb) => {
    grenadeBody(gb, -1.8, 0, 0, 1.15, 0.3);
    grenadeBody(gb, 1.9, -0.4, 0.4, 1.15, -0.6);
    rbox(gb, -3.6, 3.6, -2.8, -2.2, -0.9, 0.9, 0.15, { color: '#2e3320', mat: GM.RUBBER });
  });
  return m;
}

/** Weapon crate (and the supply drop's crate, with a parachute when `chute`). */
export function crateGeometry(chute = false) {
  const gb = new GunBuilder();
  const w = chute ? 30 : 26, h = chute ? 26 : 18, d = chute ? 30 : 18;
  rbox(gb, -w / 2, w / 2, 0, h, -d / 2, d / 2, 0.8, { color: chute ? '#4e5b31' : WOOD, mat: chute ? GM.PAINT : GM.WOOD });
  // plank seams + corner brackets + stencil band
  for (let k = 1; k < 4; k++) rbox(gb, -w / 2 - 0.05, w / 2 + 0.05, k * h / 4 - 0.12, k * h / 4 + 0.12, -d / 2 - 0.05, d / 2 + 0.05, 0.05, { color: chute ? '#3a4424' : '#4a3420', mat: chute ? GM.PAINT : GM.WOOD });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x0 = sx < 0 ? -w / 2 - 0.25 : w / 2 - 1.6, z0 = sz < 0 ? -d / 2 - 0.25 : d / 2 - 1.6;
      rbox(gb, x0, x0 + 1.85, -0.1, h + 0.1, z0, z0 + 1.85, 0.2, { color: '#3a3d40', mat: GM.STEEL });
    }
  }
  rbox(gb, -w * 0.3, w * 0.3, h * 0.45, h * 0.62, d / 2, d / 2 + 0.1, 0.05, { color: '#d8c890', mat: GM.PAINT });
  rbox(gb, -w * 0.3, w * 0.3, h * 0.45, h * 0.62, -d / 2 - 0.1, -d / 2, 0.05, { color: '#d8c890', mat: GM.PAINT });
  for (const sx of [-1, 1]) tubePath(gb, [[sx * (w / 2 + 0.2), h * 0.55, -3], [sx * (w / 2 + 1.4), h * 0.5, 0], [sx * (w / 2 + 0.2), h * 0.55, 3]], 0.35, { color: DARK, mat: GM.STEEL, seg: 8 });
  if (chute) {
    const canopy = new THREE.SphereGeometry(30, 18, 8, 0, TAU, 0, Math.PI * 0.42);
    canopy.scale(1, 0.55, 1);
    gb.add(canopy, { at: [0, 58, 0], color: '#c8c0a8', mat: GM.POLY, round: true });
    for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) tubePath(gb, [[x * 0.9, h, z * 0.9], [x * 1.6, 62, z * 1.6]], 0.2, { color: '#a8a090', mat: GM.RUBBER, seg: 2, radial: 4 });
  }
  const g = gb.build();
  return g.body;
}

function projectileModels() {
  const m = {};
  m.bolt = built((gb) => {
    cylX(gb, -10, 10, 0, 0, 0.35, 0.35, { color: '#3a3a3a', mat: GM.ALLOY, seg: 8 });
    latheX(gb, [[10, 0], [10, 0.8], [12.8, 0]], 0, 0, { color: '#c8ccd0', mat: GM.STEEL, seg: 4 });
    for (let k = 0; k < 3; k++) rbox(gb, -10, -6.5, -0.03, 0.03, 0, 1.3, 0.01, { color: k ? '#e8e0d0' : '#d84a2a', mat: GM.POLY, rot: [(k / 3) * TAU, 0, 0], seg: 1 });
  });
  m.grenade = built((gb) => {
    latheX(gb, [[-2.2, 0], [-2.2, 1.95], [-0.6, 2.0], [-0.5, 1.9], [1.2, 1.9], [2.6, 1.3], [3.2, 0.6], [3.3, 0]], 0, 0, { color: '#4a5a2e', mat: GM.PAINT, seg: 14 });
    latheX(gb, [[-2.3, 0], [-2.3, 2.02], [-0.6, 2.02], [-0.6, 0]], 0, 0, { color: '#c9a24a', mat: GM.BRASS, seg: 14 });
    torusX(gb, 0.4, 0, 0, 1.95, 0.08, { color: '#d8c040', mat: GM.PAINT, seg: 14 });
  });
  m.rocket = built((gb) => {
    latheX(gb, [[-8, 0], [-8, 1.2], [3, 1.2], [4, 1.8], [7, 2.2], [9, 1.8], [11.5, 0.6], [12, 0.25], [13, 0]], 0, 0, { color: '#5a6a3a', mat: GM.PAINT, seg: 16 });
    for (let k = 0; k < 4; k++) rbox(gb, -8, -4.5, -0.1, 0.1, 1.0, 3.2, 0.05, { color: '#3a3a3a', mat: GM.STEEL, rot: [(k / 4) * TAU, 0, 0], seg: 1 });
    cylX(gb, -8.6, -8, 0, 0, 0.9, 1.1, { color: DARK, seg: 12 });
  });
  m.frag = built((gb) => grenadeBody(gb, 0, 0, 0, 1.3, 0));
  m.molotov = built((gb) => {
    const bottle = new THREE.LatheGeometry([[0, -4.5], [2.1, -4.4], [2.2, -3.8], [2.2, 1.2], [1.8, 2.2], [0.9, 3.0], [0.8, 4.8], [0, 4.8]].map(([r, h]) => new THREE.Vector2(Math.max(0.001, r), h)), 12);
    gb.add(bottle, { color: '#6a4a1c', mat: GM.LENS, round: true });
    const rag = new THREE.IcosahedronGeometry(1.4, 1);
    rag.scale(0.9, 1.4, 0.9);
    gb.add(rag, { at: [0.2, 5.4, 0], rot: [0.3, 0, 0.2], color: '#d8c8a8', mat: GM.POLY, round: true });
  });
  m.acid = built((gb) => {
    sphere(gb, 0, 0, 0, 3.4, { glow: true, color: '#a6ff3a', seg: 12 });
    sphere(gb, -2.4, 0.4, 0, 2.2, { glow: true, color: '#7ad020', seg: 10 });
  });
  // flare shell in flight: a red paper tube, the burning end glowing white-red
  m.flare = built((gb) => {
    cylX(gb, -3.2, 1.2, 0, 0, 0.9, 0.9, { color: '#b3261e', mat: GM.PAINT, seg: 10 });
    sphere(gb, 1.6, 0, 0, 1.3, { glow: true, color: '#ffd0b8', seg: 10 });
  });
  // harpoon: steel shaft, a broad head with flip barbs, the line shackle at the tail
  m.harpoon = built((gb) => {
    cylX(gb, -16, 6, 0, 0, 0.32, 0.32, { color: '#b8bec2', mat: GM.STEEL, seg: 8 });
    latheX(gb, [[5.6, 0], [5.6, 0.7], [6.6, 1.0], [10.4, 0.15], [10.8, 0]], 0, 0, { color: '#d8dde0', mat: GM.STEEL, seg: 4 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.5;
      rbox(gb, 4.2, 7.0, -0.4, 0.4, -0.07, 0.07, 0.02, { color: '#aab0b4', mat: GM.STEEL, at: [0, Math.sin(a) * 0.65, Math.cos(a) * 0.65], rot: [HALF_PI - a, 0, 0], seg: 1 });
    }
    rbox(gb, -16.5, -15.2, -0.6, 0.6, -0.6, 0.6, 0.2, { color: '#f2a900', mat: GM.PAINT });
  });
  // a road flare burning on the ground
  m.flareStick = built((gb) => {
    cylX(gb, -6, 4, 0, 0, 0.9, 0.9, { color: '#b3261e', mat: GM.PAINT, seg: 10 });
    cylX(gb, -6.6, -6, 0, 0, 0.95, 0.95, { color: '#2a2a2a', mat: GM.POLY, seg: 10 });
    sphere(gb, 4.4, 0, 0, 0.9, { glow: true, color: '#fff0e0', seg: 8 });
  });
  return m;
}

function turretModels() {
  const tripod = built((gb) => {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      tubePath(gb, [[Math.cos(a) * 2.2, 18, Math.sin(a) * 2.2], [Math.cos(a) * 8, 8, Math.sin(a) * 8], [Math.cos(a) * 13, 0.8, Math.sin(a) * 13]], 0.75, { color: STEEL, mat: GM.STEEL, seg: 10 });
      rbox(gb, Math.cos(a) * 13 - 2, Math.cos(a) * 13 + 2, 0, 1.2, Math.sin(a) * 13 - 2, Math.sin(a) * 13 + 2, 0.4, { color: DARK, mat: GM.RUBBER });
    }
    const post = new THREE.CylinderGeometry(1.6, 2.2, 10, 14);
    gb.add(post, { at: [0, 16, 0], color: '#44484c', mat: GM.STEEL, round: true });
    const ring = new THREE.CylinderGeometry(3.8, 3.8, 2.2, 18);
    gb.add(ring, { at: [0, 21.5, 0], color: '#3a3e42', mat: GM.STEEL, round: true });
  });
  const head = built((gb) => {
    // receiver + armour shield + barrel with shroud and brake + ammo box + sensor
    rbox(gb, -6, 10, 24.5, 32.5, -4.2, 4.2, 1.2, { color: '#5b6150', mat: GM.PAINT });
    ext(gb, [[9.5, 23], [9.5, 34], [12.5, 36], [12.5, 22]], -8.5, 8.5, { color: '#4e5444', mat: GM.PAINT, bevel: 0.5 });
    cylX(gb, 12.5, 26, 29, 0, 1.2, 1.1, { color: '#2a2c2e', mat: GM.STEEL, seg: 14 });
    cylX(gb, 12.5, 20, 29, 0, 1.9, 1.9, { color: '#34373a', mat: GM.STEEL, seg: 14 });
    for (let k = 0; k < 4; k++) rbox(gb, 13 + k * 1.8, 13.8 + k * 1.8, 30.6, 31.2, -1.2, 1.2, 0.1, { color: '#0a0a0a', seg: 1 });
    latheX(gb, [[26, 0], [26, 1.8], [29, 1.8], [29, 0]], 29, 0, { color: DARK, mat: GM.STEEL, seg: 12 });
    for (const s of [-1, 1]) rbox(gb, 26.8, 28.4, 28.4, 29.6, s < 0 ? -1.9 : 1.5, s < 0 ? -1.5 : 1.9, 0.1, { color: '#050505', seg: 1 });
    rbox(gb, -4, 4, 22, 29, -9.5, -4.2, 0.6, { color: OLIVE, mat: GM.PAINT });
    tubePath(gb, [[2, 28, -4.4], [4, 30, -2.5], [5, 29.5, -1]], 0.6, { color: '#c9a24a', mat: GM.BRASS, seg: 8 });
    rbox(gb, -2, 6, 32.5, 36.5, -3, 3, 0.8, { color: '#3a3d40', mat: GM.PAINT });
    const lens = new THREE.CircleGeometry(1.3, 16);
    gb.add(lens, { at: [6.05, 34.5, 0], rot: [0, HALF_PI, 0], color: '#0c1218', mat: GM.LENS });
    rbox(gb, -5, -1, 21, 24.5, -3, 3, 0.4, { color: '#3a3e42', mat: GM.STEEL });
    tubePath(gb, [[-6, 32.5, -3], [-8, 36, 0], [-6, 32.5, 3]], 0.35, { color: DARK, mat: GM.STEEL, seg: 8 });
  });
  return { tripod, head };
}

function barricadeModels() {
  const W = BARRICADE.width, D = BARRICADE.height;
  const base = built((gb) => {
    for (const s of [-1, 1]) {
      rbox(gb, s * (W / 2 - 4) - 2.5, s * (W / 2 - 4) + 2.5, 0, 44, -2.5, 2.5, 0.6, { color: '#5a4430', mat: GM.WOOD });
      const br = new THREE.BoxGeometry(3.6, 24, 3.6);
      gb.add(br, { at: [s * (W / 2 - 8), 10, -4], rot: [0.5, 0, s * 0.45], color: '#4a3826', mat: GM.WOOD });
    }
    // sandbags: lumpy, cinched at the ends
    for (let row = 0; row < 2; row++) {
      const n = row ? 6 : 7;
      for (let k = 0; k < n; k++) {
        const x = -W / 2 + 8 + (row ? 6 : 0) + k * ((W - 16) / 6);
        const sg = new THREE.SphereGeometry(1, 12, 8);
        const p = sg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
          const k2 = 1 - 0.25 * Math.pow(Math.abs(ux), 6);
          p.setXYZ(i, ux, uy * k2 * (uy < 0 ? 0.7 : 1), uz * k2);
        }
        sg.computeVertexNormals();
        gb.add(sg, { at: [x, 4.5 + row * 7.5, D * 0.2 + (hash01(k + row * 7) - 0.5) * 1.5], rot: [0, (hash01(k * 3 + row) - 0.5) * 0.3, 0], scale: [7.8, 4.2, 5.6], color: k % 2 ? '#8a7a55' : '#7a6a48', mat: GM.POLY, round: true });
      }
    }
    rbox(gb, -W * 0.3, W * 0.3, 3, 36, -D * 0.3 - 0.6, -D * 0.3 + 0.6, 0.3, { color: '#5a5f63', mat: GM.STEEL, wear: 2 });
    for (let k = 0; k < 5; k++) rbox(gb, -W * 0.28 + k * W * 0.14, -W * 0.28 + k * W * 0.14 + 0.8, 4, 35, -D * 0.3 - 0.8, -D * 0.3 + 0.8, 0.2, { color: '#4a4f53', mat: GM.STEEL });
  });
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const y = 14 + r * 8.5;
    const tilt = (hash01(r * 7 + 3) - 0.5) * 0.12;
    rows.push(built((gb) => {
      rbox(gb, -W / 2 - 3, W / 2 + 3, y - 3.2, y + 3.2, 1.3, 3.7, 0.5, { color: r % 2 ? '#8a6a44' : '#7a5c3a', mat: GM.WOOD, rot: [0, 0, tilt] });
      for (let n = 0; n < 3; n++) {
        for (const s of [-1, 1]) {
          const ng = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 8);
          gb.add(ng, { at: [s * (W / 2 - 4) + (n - 1) * 1.2, y + (n - 1) * 1.6, 3.9], rot: [HALF_PI, 0, 0], color: '#9a9a9a', mat: GM.STEEL, round: true });
        }
      }
    }));
  }
  return { base, rows };
}

// pickup icons: an atlas of 6 glowing symbols, billboarded above each pickup
function iconAtlas() {
  const S = 128, c = makeCanvas(S * 4, S * 2), g = c.getContext('2d');
  const draw = (i, fn) => {
    g.save();
    g.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    fn();
    g.restore();
  };
  draw(0, () => { for (let k = -1; k <= 1; k++) { g.fillRect(k * 26 - 8, -10, 16, 40); g.beginPath(); g.moveTo(k * 26 - 8, -10); g.lineTo(k * 26, -36); g.lineTo(k * 26 + 8, -10); g.fill(); } });
  draw(1, () => { g.fillRect(-13, -40, 26, 80); g.fillRect(-40, -13, 80, 26); });
  draw(2, () => { g.font = 'bold 96px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 0, 6); });
  draw(3, () => { g.beginPath(); g.moveTo(0, -42); g.lineTo(36, -28); g.quadraticCurveTo(34, 22, 0, 44); g.quadraticCurveTo(-34, 22, -36, -28); g.closePath(); g.fill(); });
  draw(4, () => { g.beginPath(); g.ellipse(0, 8, 26, 32, 0, 0, TAU); g.fill(); g.fillRect(-7, -38, 14, 14); g.fillRect(5, -32, 24, 7); });
  draw(5, () => { g.lineWidth = 10; g.strokeRect(-36, -26, 72, 52); g.fillRect(-36, -4, 72, 8); });
  // soft glow halo behind each icon
  g.globalCompositeOperation = 'destination-over';
  for (let i = 0; i < 6; i++) {
    const x = (i % 4) * S + S / 2, y = Math.floor(i / 4) * S + S / 2;
    const gr = g.createRadialGradient(x, y, 0, x, y, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - S / 2, y - S / 2, S, S);
  }
  return canvasTexture(c);
}
const ICON = { ammo: 0, health: 1, cash: 2, armor: 3, frag: 4, crate: 5 };

const ICON_VERT = /* glsl */`
attribute vec4 iPos;   // xyz, size
attribute vec4 iCol;   // rgb (HDR), frame
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
  mvPosition.xy += position.xy * iPos.w;
  gl_Position = projectionMatrix * mvPosition;
  float fr = iCol.w;
  vUv = (vec2(mod(fr, 4.0), 1.0 - floor(fr / 4.0)) + position.xy + 0.5) * vec2(0.25, 0.5);
  vCol = iCol.rgb;
  #include <fog_vertex>
}`;
const ICON_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vCol;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uMap, vUv).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function labelTexture(text) {
  const c = makeCanvas(256, 64), g = c.getContext('2d');
  g.font = 'bold 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 34);
  g.fillStyle = '#ffe082';
  g.fillText(text, 128, 34);
  return canvasTexture(c, { mips: false });
}

// ---------------------------------------------------------------------------------------

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createItems3D(ctx) {
  const fx0 = acquireFx(ctx);
  // Terrain (campaign maps): everything here is written for a flat ground at y = 0. `gOff` is
  // the ground height under the entity being drawn; put(), the fx wrapper and the light shim add it.
  const G = ctx.groundY || (() => 0);
  const rough = !!ctx.terrain && !ctx.terrain.flat;
  let gOff = 0;
  const fx = rough ? Object.create(fx0) : fx0;
  const lights = rough ? { steady: (key, x, y, h, ...a) => ctx.lights.steady(key, x, y, h + gOff, ...a) } : ctx.lights;
  if (rough) {
    fx.spawn = (x, h, y, ...a) => fx0.spawn(x, h + gOff, y, ...a);
    fx.glow = (x, h, y, ...a) => fx0.glow(x, h + gOff, y, ...a);
    fx.beam = (ax, ah, ay, bx, bh, by, ...a) => fx0.beam(ax, ah + gOff, ay, bx, bh + gOff, by, ...a);
  }
  const R = fx.rng;
  const root = new THREE.Group();
  root.name = 'items3d';
  ctx.scene.add(root);
  let high = ctx.quality !== 'low';
  const mats = gunMaterials();
  const disposables = [];

  const mkInst = (geo, mat, cap, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadow && high;
    root.add(m);
    disposables.push(geo);
    return m;
  };
  /** Solid + glow instanced pair for a built model. */
  const mkPair = (model, cap, shadow = false) => ({
    body: model.body ? mkInst(model.body, mats.std, cap, shadow) : null,
    glow: model.glow ? mkInst(model.glow, mats.glow, cap) : null,
  });

  // projectiles
  const pm = projectileModels();
  const proj = {};
  for (const k of ['bolt', 'grenade', 'rocket', 'frag', 'molotov', 'acid', 'flare', 'harpoon']) proj[k] = mkPair(pm[k], P_CAP);
  const flareSticks = mkPair(pm.flareStick, H_CAP);
  const projState = new Map();   // id → { t, seen, kind, x, y }

  // pickups: a prop per kind + glowing icon billboards
  const pkm = pickupModels();
  const pick = {};
  for (const kind of PICKUP_KINDS) if (kind !== 'crate' && pkm[kind]) pick[kind] = mkPair(pkm[kind], PK_CAP, true);
  const crateGeo = crateGeometry(false);
  const crateInst = mkInst(crateGeo, mats.std, 16, true);
  const crateExtras = new Map();  // id → { group, gun, label, weapon }
  const labelCache = new Map();
  const labelGeo = new THREE.PlaneGeometry(40, 10);
  disposables.push(labelGeo);
  const iconTex = iconAtlas();
  const iconGeo = new THREE.InstancedBufferGeometry();
  iconGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  iconGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const iconPos = new THREE.InstancedBufferAttribute(new Float32Array(PK_CAP * 4), 4), iconCol = new THREE.InstancedBufferAttribute(new Float32Array(PK_CAP * 4), 4);
  iconPos.setUsage(THREE.DynamicDrawUsage); iconCol.setUsage(THREE.DynamicDrawUsage);
  iconGeo.setAttribute('iPos', iconPos);
  iconGeo.setAttribute('iCol', iconCol);
  iconGeo.instanceCount = 0;
  const iconMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: iconTex } }]),
    vertexShader: ICON_VERT, fragmentShader: ICON_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  iconMat.uniforms.uMap.value = iconTex;
  const icons = new THREE.Mesh(iconGeo, iconMat);
  icons.frustumCulled = false;
  icons.renderOrder = 12;
  root.add(icons);
  disposables.push(iconTex, iconGeo, iconMat);

  // turrets
  const tm = turretModels();
  const tripods = mkPair(tm.tripod, T_CAP, true);
  const heads = mkPair(tm.head, T_CAP, true);

  // barricades
  const bm = barricadeModels();
  const barBase = mkPair(bm.base, B_CAP, true);
  const barRows = bm.rows.map((g) => mkPair(g, B_CAP, true));

  // acid puddles (flat, glowing, alpha-blended)
  const puddleGeo = new THREE.CircleGeometry(1, 24);
  puddleGeo.rotateX(-HALF_PI);
  const puddleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a9a1a').multiplyScalar(1.2), transparent: true, opacity: 0.55, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(puddleMat);
  const puddles = mkInst(puddleGeo, puddleMat, H_CAP);
  puddles.renderOrder = 5;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function put(pair, i, x, h, y, ry, rx = 0, rz = 0, s = 1, sy = s, sz = s) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, h + gOff, y);
    _s.set(s, sy, sz);
    _m.compose(_p, _q, _s);
    if (pair.isInstancedMesh) { pair.setMatrixAt(i, _m); return; }
    if (pair.body) pair.body.setMatrixAt(i, _m);
    if (pair.glow) pair.glow.setMatrixAt(i, _m);
  }
  function finishMesh(mesh, n) {
    if (!mesh) return;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  function finish(pair, n) {
    if (pair.isInstancedMesh) { finishMesh(pair, n); return; }
    finishMesh(pair.body, n);
    finishMesh(pair.glow, n);
  }

  const C = (h) => col(h);
  const hdrCache = new Map();
  const H = (hex, k) => {
    const key = hex + k;
    let c = hdrCache.get(key);
    if (!c) { c = new THREE.Color(hex).multiplyScalar(k); hdrCache.set(key, c); }
    return c;
  };
  const WHITE = new THREE.Color(1, 1, 1);
  const FLAME_BASE = new THREE.Color(1, 0.78, 0.55);   // warm base under the fire ramp
  let frameNo = 0;
  const hazardLights = [];
  const flareLights = [];

  function update(view, frame) {
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const t = frame.now || 0;
    const camX = frame.camX, camY = frame.camY;

    // ---- projectiles ----
    const counts = { bolt: 0, grenade: 0, rocket: 0, frag: 0, molotov: 0, acid: 0, flare: 0, harpoon: 0 };
    const list = (view && view.projectiles) || [];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      let s = projState.get(p.id);
      if (!s || s.kind !== p.kind) { s = { t: 0, kind: p.kind, x: p.x, y: p.y, seen: 0 }; projState.set(p.id, s); }
      s.t += dt;
      s.seen = frameNo;
      const a = p.angle || 0;
      const dir = -a;
      if (rough) gOff = G(p.x, p.y);
      switch (p.kind) {
        case 'bolt': {
          const i = counts.bolt++;
          if (i < P_CAP) put(proj.bolt, i, p.x, 40, p.y, dir);
          fx.beam(p.x - Math.cos(a) * 40, 40, p.y - Math.sin(a) * 40, p.x, 40, p.y, 0.2, 1.2, H('#c8e6ff', 1.6), 0.6, 0.3, 0.8, 0);
          break;
        }
        case 'grenade': {
          const i = counts.grenade++;
          const h = 38 + Math.sin(Math.min(1, s.t / 1.3) * Math.PI) * 26 - s.t * 18;
          if (i < P_CAP) put(proj.grenade, i, p.x, Math.max(3, h), p.y, dir, 0, -s.t * 12);
          if (high && R() < dt * 30) fx.spawn(p.x, h, p.y, 0, 6, 0, 0.6, 2, 7, C('#9a968e'), 0.25, FR.SMOKE3, 0, -4, 1);
          break;
        }
        case 'rocket': {
          const i = counts.rocket++;
          const roll = t * 8 + p.id;
          if (i < P_CAP) put(proj.rocket, i, p.x, 40, p.y, dir, roll);
          const bx = p.x - Math.cos(a) * 10, by = p.y - Math.sin(a) * 10;
          // motor glow: small and hot (it blooms); several rockets in the air at once
          // at the old size/level washed the whole view out
          fx.glow(bx, 40, by, 11 + R() * 4, H('#ffb050', 2.2), 0.9);
          fx.glow(bx, 40, by, 4.5, H('#ffffff', 3), 1);
          // exhaust fire + a thick lingering smoke trail
          const n = high ? 3 : 1;
          for (let q = 0; q < n; q++) {
            const back = a + Math.PI + (R() - 0.5) * 0.4;
            fx.spawn(bx, 40, by, Math.cos(back) * 160, (R() - 0.5) * 20, Math.sin(back) * 160, 0.12, 5, 2, WHITE, 1, FR.FLAME, F_ADD | F_FIRE, 0, 2);
          }
          if (R() < dt * (high ? 60 : 25)) {
            // plain grey: a glowing (F_HOT) trail summed into an orange cloud behind every rocket
            fx.spawn(bx - Math.cos(a) * 8, 40, by - Math.sin(a) * 8, (R() - 0.5) * 10, 4 + R() * 6, (R() - 0.5) * 10, 1.8 + R(), 5, 22, C('#77746e'), 0.32, R() < 0.5 ? FR.SMOKE : FR.SMOKE4, 0, -3, 0.6);
          }
          lights.steady('rocket' + p.id, bx, by, 40, '#ffa040', 1.3, 200);
          break;
        }
        case 'flame': {
          // a rolling tongue of fire along the flame's path
          // A flamethrower keeps ~15 of these alive: a tongue per projectile per frame at full
          // alpha summed into a white blob, so emit at a fixed rate, dimmer and warmer.
          if (fx.load() < 0.9 && R() < dt * (high ? 36 : 18)) {
            const grow = Math.min(1, s.t / 0.5);
            const i = fx.spawn(p.x + (R() - 0.5) * 6, 34 - grow * 16 + R() * 6, p.y + (R() - 0.5) * 6,
              Math.cos(a) * 120, 18 + R() * 20, Math.sin(a) * 120, 0.22 + R() * 0.12, 10 + grow * 16, 22 + grow * 22, FLAME_BASE, 0.34, R() < 0.5 ? FR.FLAME : FR.FIREBALL, F_ADD | F_FIRE | F_FLICKER, -30, 3);
            fx.stretchLast(i, 1.2);
          }
          if ((p.id & 7) === 0) lights.steady('flame' + (p.id & 31), p.x, p.y, 30, '#ff8a33', 0.8, 180);
          break;
        }
        case 'frag': {
          const i = counts.frag++;
          // fake bounces: the sim is flat, but a grenade should hop along the ground
          const h = 4 + Math.abs(Math.sin(s.t * 7)) * 24 * Math.exp(-s.t * 1.8) + Math.max(0, 30 - s.t * 90);
          if (i < P_CAP) put(proj.frag, i, p.x, h, p.y, dir + s.t * 6, s.t * 9, s.t * 5);
          fx.glow(p.x, h + 4, p.y, 3 + Math.abs(Math.sin(t * 20)) * 3, H('#ffcc66', 2.5), 0.8);
          break;
        }
        case 'molotov': {
          const i = counts.molotov++;
          const h = 40 + Math.sin(Math.min(1, s.t / 0.9) * Math.PI) * 30 - s.t * 30;
          if (i < P_CAP) put(proj.molotov, i, p.x, Math.max(4, h), p.y, dir, s.t * 11, s.t * 7);
          fx.spawn(p.x, h + 6, p.y, (R() - 0.5) * 10, 20, (R() - 0.5) * 10, 0.25, 4, 1, WHITE, 1, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -40, 1);
          lights.steady('molotov' + p.id, p.x, p.y, h + 6, '#ff9a40', 1.2, 170);
          break;
        }
        case 'acid': {
          const i = counts.acid++;
          const k2 = Math.min(1, s.t / 0.9);
          const h = 50 + Math.sin(k2 * Math.PI) * 45 - k2 * 44;
          if (i < P_CAP) put(proj.acid, i, p.x, Math.max(3, h), p.y, dir, 0, 0, 1 + Math.sin(t * 20) * 0.1);
          fx.glow(p.x, h, p.y, 16, H('#a6ff3a', 1.6), 0.7);
          if (R() < dt * 25) fx.spawn(p.x, h - 2, p.y, 0, -10, 0, 0.5, 1.6, 1, H('#a6ff3a', 2), 1, FR.DROP, F_ADD | F_BOUNCE, 400, 0);
          break;
        }
        case 'flare': {
          // a burning flare arcing down the road, shedding sparks and red smoke, lighting everything it passes
          const i = counts.flare++;
          const h = Math.max(6, 44 + Math.sin(Math.min(1, s.t / 1.05) * Math.PI) * 14 - s.t * 30);
          if (i < P_CAP) put(proj.flare, i, p.x, h, p.y, dir, t * 20);
          fx.glow(p.x, h, p.y, 16 + R() * 4, H('#ff5a3a', 2.6), 1);
          fx.glow(p.x, h, p.y, 5, H('#fff0e0', 3), 1);
          for (let q = 0; q < (high ? 2 : 1); q++) {
            const back = a + Math.PI + (R() - 0.5) * 0.9, sp = 80 + R() * 120;
            fx.spawn(p.x, h, p.y, Math.cos(back) * sp, 20 + R() * 60, Math.sin(back) * sp, 0.3 + R() * 0.3, 1.2, 0.5, H('#ffb080', 3), 1, FR.DOT, F_ADD | F_BOUNCE, 500, 1);
          }
          if (R() < dt * (high ? 40 : 15)) fx.spawn(p.x, h, p.y, (R() - 0.5) * 8, 6 + R() * 8, (R() - 0.5) * 8, 1.6 + R(), 4, 18, C('#b0402e'), 0.3, FR.SMOKE3, 0, -3, 0.6);
          lights.steady('flarep' + p.id, p.x, p.y, h, '#ff4a2a', 2.0, 380);
          break;
        }
        case 'harpoon': {
          // the harpoon with its line trailing back toward the gun
          const i = counts.harpoon++;
          if (i < P_CAP) put(proj.harpoon, i, p.x, 40, p.y, dir, 0);
          const L = Math.min(260, 60 + s.t * 1100);
          const sag = Math.min(8, s.t * 12);
          const bx = p.x - Math.cos(a) * L, by = p.y - Math.sin(a) * L;
          fx.beam(bx, 40 - sag, by, p.x - Math.cos(a) * 16, 40, p.y - Math.sin(a) * 16, 0.35, 0.35, C('#8a8478'), 0.5, 0, 0.7, 0);
          break;
        }
        case 'frost': {
          // cold mist rolling out along the stream, with ice glints
          if (fx.load() < 0.9 && R() < dt * (high ? 34 : 14)) {
            const grow = Math.min(1, s.t / 0.55);
            fx.spawn(p.x + (R() - 0.5) * 8, 30 - grow * 18 + R() * 6, p.y + (R() - 0.5) * 8, Math.cos(a) * 90, 4 + R() * 10, Math.sin(a) * 90,
              0.35 + R() * 0.2, 10 + grow * 12, 26 + grow * 22, C('#e2f6ff'), 0.26, R() < 0.5 ? FR.SMOKE2 : FR.SMOKE4, 0, -4, 2.5);
          }
          if (high && R() < dt * 10) fx.spawn(p.x, 22 + R() * 14, p.y, (R() - 0.5) * 30, 10 + R() * 20, (R() - 0.5) * 30, 0.5, 1.4, 0.5, H('#c8f0ff', 2.2), 1, FR.GLINT, F_ADD | F_FLICKER, 30, 1);
          if ((p.id & 7) === 0) lights.steady('frost' + (p.id & 31), p.x, p.y, 28, '#9ae8ff', 0.45, 150);
          break;
        }
        default:
          break;
      }
    }
    gOff = 0;
    for (const k in proj) finish(proj[k], Math.min(P_CAP, counts[k]));
    if (frameNo % 30 === 0) for (const [id, s] of projState) if (frameNo - s.seen > 30) projState.delete(id);

    // ---- pickups ----
    const pc = { ammo: 0, health: 0, cash: 0, armor: 0, frag: 0 };
    let nCrate = 0, nIcon = 0;
    const IP = iconPos.array, IC = iconCol.array;
    const pickups = (view && view.pickups) || [];
    const seenCrates = new Set();
    for (let k = 0; k < pickups.length; k++) {
      const p = pickups[k];
      if (rough) gOff = G(p.x, p.y);
      const glowC = C(PICKUP_GLOW[p.kind] || '#ffffff');
      const pulse = 0.75 + Math.sin(t * 3 + p.id) * 0.25;
      if (p.kind === 'crate') {
        if (nCrate < 16) put(crateInst, nCrate++, p.x, 0, p.y, hash01(p.id) * TAU);
        seenCrates.add(p.id);
        crateExtra(p, t);
        fx.glow(p.x, 1, p.y, 70, glowC, 0.35 * pulse, FR.GLOW, true);
        fx.glow(p.x, 22, p.y, 34, glowC, 0.2 * pulse);
        continue;
      }
      const pair = pick[p.kind];
      if (!pair) continue;
      const i = pc[p.kind]++;
      const h = 11 + Math.sin(t * 2.2 + p.id * 1.7) * 2.5;
      if (i < PK_CAP) put(pair, i, p.x, h, p.y, t * 1.4 + p.id, 0.12, 0.08, 1.05);
      fx.glow(p.x, h, p.y, 26, glowC, 0.3 * pulse);
      fx.glow(p.x, 1, p.y, 44, glowC, 0.35 * pulse, FR.GLOW, true);
      if (nIcon < PK_CAP) {
        // a glowing symbol hovering above: readable at a glance, blooms a little
        const o = nIcon++ * 4;
        const k2 = 1.7 + pulse * 0.6;
        IP[o] = p.x; IP[o + 1] = gOff + h + 12 + Math.sin(t * 2.2 + p.id * 1.7) * 0.8; IP[o + 2] = p.y; IP[o + 3] = 9;
        IC[o] = glowC.r * k2; IC[o + 1] = glowC.g * k2; IC[o + 2] = glowC.b * k2; IC[o + 3] = ICON[p.kind] ?? 5;
      }
    }
    gOff = 0;
    for (const k in pc) if (pick[k]) finish(pick[k], Math.min(PK_CAP, pc[k]));
    finish(crateInst, nCrate);
    iconGeo.instanceCount = nIcon;
    icons.visible = nIcon > 0;
    if (nIcon) { iconPos.needsUpdate = true; iconCol.needsUpdate = true; }
    for (const [id, ex] of crateExtras) {
      if (!seenCrates.has(id)) { ex.group.removeFromParent(); crateExtras.delete(id); }
    }

    // ---- turrets ----
    let nt = 0;
    const turrets = (view && view.turrets) || [];
    for (let k = 0; k < turrets.length && nt < T_CAP; k++) {
      const tr = turrets[k];
      if (rough) gOff = G(tr.x, tr.y);
      const i = nt++;
      put(tripods, i, tr.x, 0, tr.y, hash01(tr.id) * TAU);
      const recoil = tr.firing ? Math.sin(t * 60) * 1.2 : 0;
      put(heads, i, tr.x - Math.cos(tr.angle) * recoil, 0, tr.y - Math.sin(tr.angle) * recoil, -tr.angle);
      // sensor lens: green = ok, amber = low ammo, red blinking = badly damaged
      let lc = '#4dff6a', blink = 1;
      if (tr.hp < 0.35) { lc = '#ff3a2a'; blink = Math.sin(t * 12) > 0 ? 1 : 0.15; } else if (tr.ammo < 0.25) lc = '#ffc040';
      const lx = tr.x + Math.cos(tr.angle) * 6.3, ly = tr.y + Math.sin(tr.angle) * 6.3;
      fx.glow(lx, 34.5, ly, 3.5, H(lc, 3), blink);
      fx.glow(lx, 34.5, ly, 11, H(lc, 1.2), 0.35 * blink);
      // owner colour ring on the ground
      const oc = PLAYER_COLORS[(tr.owner - 1 + 60) % PLAYER_COLORS.length] || '#ffffff';
      fx.glow(tr.x, 0.8, tr.y, 44, C(oc), 0.18, FR.RING, true);
      if (tr.hp < 0.4 && R() < dt * (high ? 8 : 3)) {
        fx.spawn(tr.x, 32, tr.y, (R() - 0.5) * 8, 20, (R() - 0.5) * 8, 1.8, 4, 16, C('#2e2c2a'), 0.45, FR.SMOKE2, 0, -3, 0.5);
        if (R() < 0.3) fx.spawn(tr.x, 30, tr.y, (R() - 0.5) * 60, 60, (R() - 0.5) * 60, 0.3, 1, 0.5, H('#ffcf80', 2.5), 1, FR.DOT, F_ADD | F_BOUNCE, 500, 0);
      }
    }
    gOff = 0;
    finish(tripods, nt);
    finish(heads, nt);

    // ---- barricades ----
    let nb = 0;
    const rowN = [0, 0, 0, 0];
    const bars = (view && view.barricades) || [];
    for (let k = 0; k < bars.length && nb < B_CAP; k++) {
      const b = bars[k];
      if (rough) gOff = G(b.x, b.y);
      // snapshot angle = direction of the long side (movement.js setBarricades)
      const ang = b.angle || 0;
      put(barBase, nb++, b.x, 0, b.y, -ang);
      const hp = Math.max(0, Math.min(1, b.hp));
      for (let r = 0; r < 4; r++) {
        if (hp <= r * 0.25 + 0.02) continue;
        const loose = hp < (r + 1) * 0.25 ? (1 - (hp - r * 0.25) / 0.25) : 0;    // the next plank to go hangs off
        const wob = loose * (0.35 + hash01(b.id * 5 + r) * 0.3);
        put(barRows[r], rowN[r]++, b.x, loose * -3, b.y, -ang, 0, (hash01(b.id + r) < 0.5 ? 1 : -1) * wob);
      }
    }
    gOff = 0;
    finish(barBase, nb);
    for (let r = 0; r < 4; r++) finish(barRows[r], rowN[r]);

    // ---- hazards ----
    let np = 0, nf = 0;
    hazardLights.length = 0;
    flareLights.length = 0;
    const hz = (view && view.hazards) || [];
    for (let k = 0; k < hz.length; k++) {
      const h = hz[k];
      if (rough) gOff = G(h.x, h.y);
      const life = Math.max(0, Math.min(1, h.life));
      const r = h.r || 60;
      const d2 = (h.x - camX) ** 2 + (h.y - camY) ** 2;
      if (h.kind === 'flare') {
        // a road flare burning on the asphalt: a hot white-red tip, sparks spitting, red
        // smoke drifting up — and a strong red light over a wide circle (the point of it)
        const fade = Math.min(1, life * 6);
        const flick = 0.82 + 0.18 * Math.sin(t * 29 + h.id * 3) * Math.sin(t * 13 + h.id);
        const ang = hash01(h.id) * TAU;
        if (nf < H_CAP) put(flareSticks, nf++, h.x, 1.2, h.y, ang);
        const tx = h.x + Math.cos(-ang) * 4.4, ty = h.y + Math.sin(-ang) * 4.4;
        fx.glow(tx, 2, ty, 10 + R() * 3, H('#fff0e0', 3), fade);
        fx.glow(tx, 3, ty, 24, H('#ff4a2a', 2.2), 0.8 * fade * flick);
        fx.glow(h.x, 1, h.y, r * 5, C('#ff3a1a'), 0.3 * fade * flick, FR.GLOW, true);
        if (d2 < 2000 * 2000 && fx.load() < 0.85) {
          if (R() < dt * (high ? 24 : 8) * fade) {
            const aa = R() * TAU, sp = 40 + R() * 90;
            fx.spawn(tx, 3, ty, Math.cos(aa) * sp, 60 + R() * 90, Math.sin(aa) * sp, 0.35 + R() * 0.3, 1.1, 0.4, H('#ffc090', 3), 1, FR.DOT, F_ADD | F_BOUNCE, 600, 1);
          }
          if (R() < dt * (high ? 9 : 3) * fade) fx.spawn(tx, 6, ty, (R() - 0.5) * 10, 16 + R() * 10, (R() - 0.5) * 10, 3 + R() * 1.5, 5, 30, C('#b83a2a'), 0.3, R() < 0.5 ? FR.SMOKE : FR.SMOKE3, 0, -2, 0.3);
        }
        flareLights.push(d2, h, fade * flick);
        continue;
      }
      if (h.kind === 'fire') {
        // flames scattered over the patch, spreading out from the burst over the first second
        const spread = Math.min(1, 0.35 + (1 - life) * 7 / 1.1);
        const rr0 = r * spread;
        if (d2 < 2400 * 2400 && fx.load() < 0.85) {
          const rate = (rr0 * rr0) / 180 * (high ? 1 : 0.45) * (d2 < 800 * 800 ? 1 : 0.4) * (0.35 + life * 0.65);
          let n = rate * dt;
          while (n > 0) {
            if (n < 1 && R() > n) break;
            n -= 1;
            const a = R() * TAU, rr = Math.sqrt(R()) * rr0 * 0.9;
            const i = fx.spawn(h.x + Math.cos(a) * rr, 2, h.y + Math.sin(a) * rr, (R() - 0.5) * 10, 40 + R() * 50, (R() - 0.5) * 10,
              0.45 + R() * 0.45, 9 + R() * 8, 3, WHITE, 0.9, R() < 0.5 ? FR.FLAME : FR.FLAME2, F_ADD | F_FIRE | F_FLICKER, -30, 1);
            fx.stretchLast(i, 1.6);
          }
          if (R() < dt * 3 * (r / 80)) fx.spawn(h.x + (R() - 0.5) * rr0, 30, h.y + (R() - 0.5) * rr0, 0, 30, 0, 2.5, 20, 60, C('#1e1c1a'), 0.35, FR.SMOKE4, F_HOT, -5, 0.3);
          if (R() < dt * 6) fx.spawn(h.x + (R() - 0.5) * rr0, 10, h.y + (R() - 0.5) * rr0, (R() - 0.5) * 30, 80 + R() * 60, (R() - 0.5) * 30, 1.2, 1.2, 0.4, H('#ffb050', 3), 1, FR.EMBER, F_ADD | F_FLICKER, -20, 0.5);
        }
        fx.glow(h.x, 1, h.y, rr0 * 2.4, C('#ff7a2a'), (0.3 + Math.sin(t * 11 + h.id) * 0.05) * (0.4 + life * 0.6), FR.GLOW, true);
        hazardLights.push(d2, h, '#ff8a33', 1.6 * (0.4 + life * 0.6), r * 2.6);
      } else {
        if (np < H_CAP) put(puddles, np++, h.x, 0.9 + np * 0.01, h.y, h.id, 0, 0, r * (0.7 + life * 0.3), 1, r * (0.7 + life * 0.3));
        fx.glow(h.x, 1.4, h.y, r * 2.3, C('#8cff3a'), 0.28 * (0.3 + life * 0.7), FR.GLOW, true);
        if (d2 < 1600 * 1600 && R() < dt * (r / 10) * (high ? 1 : 0.5)) {
          const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.8;
          fx.spawn(h.x + Math.cos(a) * rr, 1.5, h.y + Math.sin(a) * rr, 0, 8 + R() * 8, 0, 0.5 + R() * 0.5, 1.5, 4 + R() * 3, H('#c8ff6a', 1.5), 0.9, FR.BUBBLE, F_ADD, 0, 0);
          if (R() < 0.3) fx.spawn(h.x + Math.cos(a) * rr, 2, h.y + Math.sin(a) * rr, 0, 10, 0, 1.4, 8, 26, C('#5a8a20'), 0.2, FR.SMOKE5, 0, -2, 0.3);
        }
        hazardLights.push(d2, h, '#8cff3a', 0.9 * (0.3 + life * 0.7), r * 2.4);
      }
    }
    finish(puddles, np);
    gOff = 0;
    finish(flareSticks, nf);
    // flares light the road: the four nearest get a strong red pool light each (they
    // outscore street lamps in the pool, see lights.js)
    const forder = [];
    for (let k = 0; k < flareLights.length; k += 3) forder.push(k);
    forder.sort((a, b) => flareLights[a] - flareLights[b]);
    for (let n = 0; n < Math.min(4, forder.length); n++) {
      const k = forder[n];
      const h = flareLights[k + 1];
      gOff = rough ? G(h.x, h.y) : 0;
      lights.steady('flare' + h.id, h.x, h.y, 26, '#ff3a1a', 2.1 * flareLights[k + 2], 430);
    }
    // hazard lights: the three nearest
    const order = [];
    for (let k = 0; k < hazardLights.length; k += 5) order.push(k);
    order.sort((a, b) => hazardLights[a] - hazardLights[b]);
    for (let n = 0; n < Math.min(3, order.length); n++) {
      const k = order[n];
      const h = hazardLights[k + 1];
      gOff = rough ? G(h.x, h.y) : 0;
      lights.steady('hz' + h.kind + h.id, h.x, h.y, h.kind === 'fire' ? 30 : 10, hazardLights[k + 2], hazardLights[k + 3], hazardLights[k + 4]);
    }
  }

  function crateExtra(p, t) {
    let ex = crateExtras.get(p.id);
    const wid = p.weapon && WEAPONS[p.weapon] ? p.weapon : null;
    if (!ex || ex.weapon !== wid) {
      if (ex) ex.group.removeFromParent();
      const group = new THREE.Group();
      let gun = null;
      if (wid) {
        gun = new THREE.Group();
        const obj = gunObject(wid, { lite: true });
        obj.position.set(-obj.userData.model.length * 0.4, 0, 0);
        gun.add(obj);
        group.add(gun);
      }
      const text = wid ? WEAPONS[wid].short : '?';
      let tex = labelCache.get(text);
      if (!tex) { tex = labelTexture(text); labelCache.set(text, tex); disposables.push(tex); }
      const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(labelMat);
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.y = 20;
      group.add(label);
      root.add(group);
      ex = { group, gun, label, weapon: wid };
      crateExtras.set(p.id, ex);
    }
    ex.group.position.set(p.x, 26 + Math.sin(t * 2 + p.id) * 2 + G(p.x, p.y), p.y);
    if (ex.gun) ex.gun.rotation.y = t * 1.2;
    // the label always faces the camera
    ex.label.quaternion.copy(ctx.camera.quaternion);
  }

  return {
    update,
    setQuality(q) {
      high = q !== 'low';
      const pairs = [tripods, heads, barBase, ...barRows, ...Object.values(pick)];
      for (const p of pairs) if (p.body) p.body.castShadow = high;
      crateInst.castShadow = high;
    },
    dispose() {
      for (const ex of crateExtras.values()) ex.group.removeFromParent();
      for (const d of disposables) d.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}
