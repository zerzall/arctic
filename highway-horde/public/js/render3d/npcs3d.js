// Story NPCs in the first-person view (STORY.md §5.3, SPEC §7.5): the hideout's residents, the
// escort, the helpers. Each is a survivor of the class its `look` names (the sculpted kit,
// actor-smodels.js, on the GPU rig, actor-rig.js) dressed in the look's colours, with the hair
// style and accessory of the cast (glasses, headset, apron, top hat ...) built from a few
// primitives that ride on the head / neck / chest bones. Animations: idle (breathing, a weight
// shift, the head following the nearest survivor), talk (nods, a gesturing arm, turned to the
// listener), walk (a stride from the real speed; follow / escort / walk), down (on the ground,
// an arm raised for help).
//
// The overlay side: a name tag with a colour dot, a hp bar for the wounded and the escorted, an
// "E — Talk" prompt (or "Hold E — Revive" for a downed one) within talking range, and a "!" over
// the one an objective waits for.
//
// Everything is built lazily on the first NPC, so a game without NPCs pays nothing.

import * as THREE from 'three';
import { CLASS_IDS } from '../shared/classes.js';
import { CAST, TALK_RANGE } from '../shared/story-defs.js';
import { angleDiff, damp, hash01, capLuma } from './actor-kit.js';
import { RigPool, Pose, B, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2, T_VAR1, T_VAR2 } from './actor-rig.js';
import { buildSoldier, soldierSkeleton, SP } from './actor-smodels.js';
import { geometryFromArrays } from './actor-shape.js';
import { actorTextures } from './actor-tex.js';

const TAU = Math.PI * 2;
const CAP = 14;
const FAR = 1900;         // not drawn beyond this (world units)
const NEAR_LOD = 700;     // the far model and no accessories beyond this
const TAG_H = 70;
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const tierOf = (q) => (q === 'low' ? 2 : 0);

const arrayCache = new Map();
function soldierArrays(cls, L, tier) {
  const k = cls + L + ':' + (tier >= 2 ? 2 : 0);
  let a = arrayCache.get(k);
  if (!a) {
    a = buildSoldier(cls, L, tier).arrays();
    arrayCache.set(k, a);
  }
  return a;
}
function instancedGeometry(a) {
  const g = geometryFromArrays(a);
  const ig = new THREE.InstancedBufferGeometry();
  for (const name in g.attributes) ig.setAttribute(name, g.attributes[name]);
  ig.setIndex(g.index);
  ig.boundingSphere = g.boundingSphere;
  return ig;
}

// ---------------------------------------------------------------------------------------
// Accessories and hair: primitives in model space (+X forward, +Y up, +Z right; the head is
// centred at (0.9, 52.6, 0), 4 x 4.5 x 3.5 units).  Colours: 'a' = outfit[0], 'b' = outfit[1],
// 'c' = outfit[2], 'h' = the hair colour, else a hex.

const HEAD = 'head', NECK = 'neck', CHEST = 'chest', HIPS = 'hips';
const box = (bone, p, s, col, r = [0, 0, 0]) => ({ bone, g: 'box', p, s, col, r });
const ball = (bone, p, s, col) => ({ bone, g: 'ball', p, s, col, r: [0, 0, 0] });
const cyl = (bone, p, s, col, r = [0, 0, 0]) => ({ bone, g: 'cyl', p, s, col, r });
const ring = (bone, p, s, col, r = [0, 0, 0]) => ({ bone, g: 'ring', p, s, col, r });
const arc = (bone, p, s, col, r = [0, 0, 0]) => ({ bone, g: 'arc', p, s, col, r });

const ACCESSORY_PARTS = {
  glasses: () => [box(HEAD, [4.85, 53.1, 0], [0.5, 1.5, 7.4], '#1a1c20'), box(HEAD, [4.95, 53.1, 0], [0.3, 1.1, 6.4], '#6f8fa8')],
  cap: () => [ball(HEAD, [0.6, 55.4, 0], [4.9, 3.2, 4.3], 'a'), box(HEAD, [5.6, 54.6, 0], [4.4, 0.5, 6.2], 'b')],
  'trucker-cap': () => [ball(HEAD, [0.6, 55.4, 0], [4.9, 3.4, 4.3], 'c'), box(HEAD, [4.6, 55.1, 0], [1.2, 3.0, 4.4], '#e8e6e0'), box(HEAD, [5.8, 54.6, 0], [4.6, 0.5, 6.2], 'c')],
  'captain-cap': () => [cyl(HEAD, [0.5, 55.6, 0], [4.8, 2.2, 4.8], '#f2f2f0'), box(HEAD, [5.4, 54.5, 0], [3.6, 0.5, 6.4], '#15161c'), ball(HEAD, [5.2, 56.0, 0], [0.9, 0.9, 0.9], '#d8b040')],
  beanie: () => [ball(HEAD, [0.3, 55.2, 0], [4.9, 3.6, 4.3], 'a'), ball(HEAD, [0.3, 58.3, 0], [1.0, 1.0, 1.0], 'b')],
  hat: () => [cyl(HEAD, [0.6, 56.6, 0], [3.4, 3.0, 3.4], '#5a4a34'), cyl(HEAD, [0.6, 54.9, 0], [7.2, 0.5, 7.2], '#5a4a34')],
  'top-hat': () => [cyl(HEAD, [0.6, 59.0, 0], [3.4, 6.4, 3.4], '#141418'), cyl(HEAD, [0.6, 55.6, 0], [6.4, 0.5, 6.4], '#141418'), cyl(HEAD, [0.6, 56.4, 0], [3.5, 0.9, 3.5], 'a')],
  beret: () => [ball(HEAD, [-0.3, 55.6, 0.5], [5.4, 1.8, 5.0], '#3b4424')],
  headset: () => [arc(HEAD, [0.5, 51.8, 0], [4.9, 0.4, 4.9], '#2a2c30', [0, Math.PI / 2, 0]), cyl(HEAD, [0.6, 52.6, 4.2], [1.8, 1.1, 1.8], '#2a2c30', [Math.PI / 2, 0, 0]),
    cyl(HEAD, [0.6, 52.6, -4.2], [1.8, 1.1, 1.8], '#2a2c30', [Math.PI / 2, 0, 0]), box(HEAD, [3.6, 50.6, 3.3], [4.6, 0.35, 0.35], '#2a2c30')],
  scarf: () => [ring(NECK, [0.3, 46.7, 0], [3.6, 1.15, 3.6], 'b', [Math.PI / 2, 0, 0]), box(CHEST, [3.9, 41.5, 1.6], [0.9, 8.0, 2.4], 'b')],
  bandana: () => [ring(NECK, [0.3, 46.9, 0], [3.5, 0.9, 3.5], '#a8322a', [Math.PI / 2, 0, 0]), box(NECK, [3.4, 46.0, 0], [0.7, 2.6, 3.6], '#a8322a')],
  backpack: () => [box(CHEST, [-6.6, 39.5, 0], [4.4, 10.0, 8.4], 'b'), box(CHEST, [-8.8, 36.0, 0], [0.9, 4.4, 6.6], 'c'), box(CHEST, [3.5, 41.5, 3.1], [0.4, 9.0, 1.2], '#26211c'), box(CHEST, [3.5, 41.5, -3.1], [0.4, 9.0, 1.2], '#26211c')],
  'radio-pack': () => [box(CHEST, [-6.6, 39.0, 0], [4.4, 11.0, 8.0], '#3b4424'), cyl(CHEST, [-7.6, 48.0, 2.6], [0.35, 15.0, 0.35], '#202020'), box(CHEST, [-8.9, 41.0, 0], [0.5, 3.4, 5.2], '#202428')],
  'map-satchel': () => [box(HIPS, [-1.2, 30.5, 6.6], [3.2, 6.6, 6.2], '#7a5a34'), box(CHEST, [0.2, 38.5, 0], [0.5, 22.0, 1.3], '#5a4024', [0, 0, 0.62]), box(HIPS, [-1.2, 33.9, 6.6], [3.5, 0.8, 6.5], '#5a4024')],
  apron: () => [box(CHEST, [5.0, 34.5, 0], [0.7, 15.5, 9.2], 'b'), box(CHEST, [4.6, 44.2, 0], [0.5, 4.2, 5.2], 'b')],
  stethoscope: () => [ring(NECK, [0.6, 45.8, 0], [3.7, 0.5, 3.7], '#c8ccd0', [Math.PI / 2, 0, 0]), cyl(CHEST, [4.8, 37.0, 0], [1.5, 0.8, 1.5], '#c8ccd0', [0, 0, Math.PI / 2])],
  'wrench-belt': () => [ring(HIPS, [0, 32.6, 0], [5.2, 0.9, 6.4], '#3a2a1c', [Math.PI / 2, 0, 0]), box(HIPS, [1.5, 27.5, 6.5], [1.0, 9.0, 1.0], '#a8acb0'), ball(HIPS, [1.5, 22.5, 6.5], [1.6, 1.6, 1.6], '#a8acb0')],
  leash: () => [ring(HIPS, [1.0, 29.0, 6.4], [2.6, 0.6, 2.6], '#8a5a2a', [0, Math.PI / 2, 0]), box(HIPS, [1.0, 24.0, 6.4], [0.5, 9.0, 0.5], '#8a5a2a')],
  bandage: () => [ring(HEAD, [0.7, 54.3, 0], [4.3, 0.9, 3.8], '#efeee8', [Math.PI / 2, 0, 0])],
};

const HAIR_PARTS = {
  bun: () => [ball(HEAD, [-3.2, 55.8, 0], [2.4, 2.4, 2.4], 'h')],
  ponytail: () => [ball(HEAD, [-3.7, 53.4, 0], [1.6, 1.6, 1.6], 'h'), cyl(HEAD, [-5.2, 50.0, 0], [1.2, 7.0, 1.2], 'h', [0, 0, 0.22])],
  pigtails: () => [ball(HEAD, [-1.0, 54.0, 4.8], [1.5, 1.5, 1.5], 'h'), ball(HEAD, [-1.0, 54.0, -4.8], [1.5, 1.5, 1.5], 'h'),
    cyl(HEAD, [-1.0, 50.4, 5.0], [1.1, 6.2, 1.1], 'h'), cyl(HEAD, [-1.0, 50.4, -5.0], [1.1, 6.2, 1.1], 'h')],
  braid: () => [cyl(NECK, [-3.2, 42.0, 0], [1.3, 17.0, 1.3], 'h', [0, 0, 0.08])],
  curly: () => [ball(HEAD, [0.4, 56.2, 0], [4.4, 2.4, 4.0], 'h'), ball(HEAD, [-2.0, 55.2, 2.6], [2.0, 2.0, 2.0], 'h'), ball(HEAD, [-2.0, 55.2, -2.6], [2.0, 2.0, 2.0], 'h')],
  curls: () => [ball(HEAD, [0.2, 56.0, 0], [4.6, 2.8, 4.2], 'h'), ball(HEAD, [-2.6, 53.6, 3.4], [2.0, 2.4, 2.0], 'h'), ball(HEAD, [-2.6, 53.6, -3.4], [2.0, 2.4, 2.0], 'h')],
  slicked: () => [ball(HEAD, [-0.4, 55.6, 0], [4.7, 2.0, 3.9], 'h')],
  'bald-beard': () => [ball(HEAD, [3.2, 50.2, 0], [2.6, 2.6, 3.2], 'h')],
};

/** The parts of a look (accessory and hair style), or []. */
export function partsOf(look) {
  const out = [];
  const a = ACCESSORY_PARTS[look.accessory];
  if (a) out.push(...a());
  const h = HAIR_PARTS[look.hairStyle];
  if (h) out.push(...h());
  return out;
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createNpcs3D(ctx) {
  const root = new THREE.Group();
  root.name = 'npcs3d';
  ctx.scene.add(root);
  let high = ctx.quality !== 'low';
  let curTier = tierOf(ctx.quality);
  let pool = null, tex = null, sk = null;
  const bodies = {};
  const state = new Map();          // npc id → animation state
  const pose = new Pose();
  const boneM = { head: new THREE.Matrix4(), neck: new THREE.Matrix4(), chest: new THREE.Matrix4(), hips: new THREE.Matrix4() };
  const BONE_OF = { head: B.HEAD, neck: B.NECK, chest: B.CHEST, hips: B.HIPS };
  let frameNo = 0;

  // shared primitive geometry and materials of the accessories
  const geos = {
    box: new THREE.BoxGeometry(1, 1, 1),
    ball: new THREE.SphereGeometry(1, 14, 10),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  };
  const torusGeos = new Map();
  /** A unit-radius torus (or half torus) whose tube is `t` of the radius; shared by every part that needs it. */
  function torusGeo(t, half) {
    const key = Math.round(t * 200) + (half ? 'h' : 'f');
    let g = torusGeos.get(key);
    if (!g) {
      g = new THREE.TorusGeometry(1, Math.max(0.02, t), 8, 24, half ? Math.PI : TAU);
      torusGeos.set(key, g);
    }
    return g;
  }
  const mats = new Map();
  function matFor(hex) {
    let m = mats.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: capLuma(new THREE.Color(hex), 0.42), roughness: 0.78, metalness: 0.05 });
      mats.set(hex, m);
    }
    return m;
  }

  function ensurePool() {
    if (pool) return;
    tex = actorTextures(8);
    pool = new RigPool({ capacity: CAP + 2, textures: tex });
    sk = soldierSkeleton();
  }

  function bodyOf(cls, far) {
    ensurePool();
    let b = bodies[cls];
    if (!b) b = bodies[cls] = [null, null];
    const L = far ? 1 : 0;
    if (!b[L]) {
      const m = pool.addModel(instancedGeometry(soldierArrays(cls, L, curTier)), sk, { rim: '#ffe6b8', rimStrength: 0.3, castShadow: high, receiveShadow: high && L === 0, name: 'npc-' + cls + L });
      root.add(m.mesh);
      b[L] = m;
    }
    return b[L];
  }

  function colorsOf(look) {
    const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);
    const o = Array.isArray(look.outfit) ? look.outfit : [];
    const top = hex(o[0], '#6a6a50');
    return { skin: hex(look.skin, '#d0a078'), hair: hex(look.hair, '#3a2a1c'), a: top, b: hex(o[1], top), c: hex(o[2], hex(o[1], top)) };
  }

  /** Build the accessory + hair meshes of an NPC (a group of meshes with their bone and local matrix). */
  function buildDress(s, look) {
    disposeDress(s);
    const col = colorsOf(look);
    const parts = partsOf(look);
    s.dress = [];
    for (const p of parts) {
      const hex = p.col === 'a' ? col.a : p.col === 'b' ? col.b : p.col === 'c' ? col.c : p.col === 'h' ? col.hair : p.col;
      let geo, sx, sy, sz;
      if (p.g === 'ring' || p.g === 'arc') {
        // radii [x, tube, z]: a torus in the XY plane (axis Z), laid flat by the part's rotation
        const avg = (p.s[0] + p.s[2]) / 2;
        geo = torusGeo(p.s[1] / avg, p.g === 'arc');
        sx = p.s[0]; sy = p.s[2]; sz = avg;
      } else if (p.g === 'cyl') {
        geo = geos.cyl;
        sx = p.s[0] * 2; sy = p.s[1]; sz = p.s[2] * 2;
      } else {
        geo = geos[p.g];
        sx = p.s[0]; sy = p.s[1]; sz = p.s[2];
      }
      const mesh = new THREE.Mesh(geo, matFor(hex));
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(p.p[0], p.p[1], p.p[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(p.r[0], p.r[1], p.r[2], 'XYZ')),
        new THREE.Vector3(sx, sy, sz),
      );
      mesh.userData.local = local;
      mesh.userData.bone = p.bone;
      root.add(mesh);
      s.dress.push(mesh);
    }
    s.dressKey = dressKeyOf(look);
  }

  function dressKeyOf(look) {
    return [look.accessory, look.hairStyle, look.hair, (look.outfit || []).join(',')].join('|');
  }

  function disposeDress(s) {
    if (!s.dress) return;
    for (const m of s.dress) m.removeFromParent();
    s.dress = null;
  }

  function getState(n) {
    let s = state.get(n.id);
    if (!s) {
      s = { x: n.x, y: n.y, a: n.angle || 0, spd: 0, mvA: n.angle || 0, ph: hash01(n.id * 7 + 3) * TAU, seen: 0, talk: 0, down: 0, look: 0, head: 0, seed: hash01(n.id * 13 + 1), dress: null, dressKey: '' };
      state.set(n.id, s);
    }
    return s;
  }

  // ---- poses ------------------------------------------------------------------------------
  function poseNpc(n, s, time) {
    pose.reset();
    const amp = Math.min(1.25, s.spd / 88);
    const sw = Math.sin(s.ph), cw = Math.cos(s.ph);
    const t = time + s.seed * 30;
    const breathe = Math.sin(t * 1.9) * 0.014;
    const talk = s.talk, down = s.down;
    // legs and root
    const stride = 0.52;
    let thL = sw * stride * amp, thR = -sw * stride * amp;
    let shL = -Math.max(0, Math.sin(s.ph + 1.3)) * 0.85 * amp - 0.05, shR = -Math.max(0, -Math.sin(s.ph + 1.3)) * 0.85 * amp - 0.05;
    let ftL = Math.max(0, cw) * 0.3 * amp - 0.04, ftR = Math.max(0, -cw) * 0.3 * amp - 0.04;
    let rootY = -Math.abs(cw) * 1.3 * amp + 0.5 * amp - 0.3, rootX = 0;
    let hipsX = sw * 0.04 * amp, hipsY = -sw * 0.09 * amp, hipsZ = 0;
    // idle: the weight shifts from foot to foot now and then
    const shift = Math.sin(t * 0.55) * (1 - Math.min(1, amp * 2));
    hipsX += shift * 0.035;
    thL += 0.04 + shift * 0.05; thR += 0.04 - shift * 0.05;
    let spineZ = -0.04 + breathe - amp * 0.05, spineY = 0, spineX = 0;
    let chestZ = -0.03 + breathe * 0.7, chestY = 0, chestX = 0;
    let neckY = 0, headY = 0, headZ = 0.02, headX = 0;
    // the head follows the survivor (or looks about when nobody is near)
    const look = s.head;
    headY += look * 0.6 + (1 - Math.abs(look)) * Math.sin(t * 0.37) * 0.22;
    neckY += look * 0.3;
    headZ += Math.sin(t * 0.83) * 0.025;
    // arms hang and swing against the legs
    let uLz = 0.1 - sw * 0.5 * amp, uRz = 0.1 + sw * 0.5 * amp;
    let fLz = 0.22 + Math.max(0, -sw) * 0.5 * amp, fRz = 0.22 + Math.max(0, sw) * 0.5 * amp;
    let uLx = 0.08, uRx = -0.08;
    uLz += Math.sin(t * 1.9 + 1) * 0.01;
    // talking: nods, a gesturing right arm, the chest leaning to the listener
    if (talk > 0.01) {
      const k = talk;
      const beat = Math.sin(time * 5.2 + s.seed * 9), slow = Math.sin(time * 2.3 + s.seed * 4);
      headZ += k * (0.05 + Math.max(0, beat) * 0.09);
      headX += k * slow * 0.06;
      chestZ -= k * 0.05; spineZ -= k * 0.03;
      uRz = uRz * (1 - k) + k * (0.95 + slow * 0.32);
      fRz = fRz * (1 - k) + k * (1.05 + beat * 0.32);
      uRx = uRx * (1 - k) + k * (-0.28 + Math.sin(time * 1.7 + s.seed) * 0.16);
      uLz = uLz * (1 - k) + k * (0.34 + Math.max(0, -slow) * 0.35);
      fLz = fLz * (1 - k) + k * (0.55 + Math.max(0, -slow) * 0.3);
    }
    // down: on the ground, propped on an elbow, one arm up
    if (down > 0.01) {
      const k = down;
      hipsZ = hipsZ * (1 - k) + 1.35 * k;
      rootY = rootY * (1 - k) - (SP.hip - 6.5) * k; rootX = 13 * k;
      spineZ = spineZ * (1 - k) - 0.55 * k; chestZ = chestZ * (1 - k) - 0.35 * k; chestY *= 1 - k; neckY *= 1 - k; headY *= 1 - k;
      headZ = headZ * (1 - k) - 0.3 * k;
      thL = thL * (1 - k) + (0.2 + Math.sin(time * 1.5 + s.seed * 6) * 0.1) * k; thR = thR * (1 - k) - 0.15 * k;
      shL = shL * (1 - k) - 0.7 * k; shR = shR * (1 - k) - 0.25 * k;
      uLz = uLz * (1 - k) + (2.25 + Math.sin(time * 2.2 + s.seed * 5) * 0.2) * k;
      fLz = fLz * (1 - k) + (0.35 + Math.sin(time * 3.1 + s.seed * 5) * 0.1) * k;
      uRz = uRz * (1 - k) + 0.5 * k;
    }
    pose.set(B.HIPS, hipsX, hipsY, hipsZ);
    pose.set(B.SPINE, spineX, spineY, spineZ);
    pose.set(B.CHEST, chestX, chestY, chestZ);
    pose.set(B.NECK, 0, neckY, 0.03);
    pose.set(B.HEAD, headX, headY, headZ);
    pose.set(B.THIGH_L, 0, 0, thL);
    pose.set(B.SHIN_L, 0, 0, shL);
    pose.set(B.FOOT_L, 0, 0, ftL);
    pose.set(B.THIGH_R, 0, 0, thR);
    pose.set(B.SHIN_R, 0, 0, shR);
    pose.set(B.FOOT_R, 0, 0, ftR);
    pose.set(B.UARM_L, uLx, down > 0.5 ? -0.35 : 0, uLz);
    pose.set(B.FARM_L, 0, 0, fLz);
    pose.set(B.UARM_R, uRx, 0, uRz);
    pose.set(B.FARM_R, 0, 0, fRz);
    pose.root[0] = rootX;
    pose.root[1] = rootY;
  }

  // ---- per frame --------------------------------------------------------------------------
  const tagList = [];
  function update(view, frame) {
    frameNo++;
    const list = (view && view.npcs) || [];
    if (!list.length && !pool) return;
    const dt = Math.min(0.1, frame.dt || 0);
    const time = frame.now || 0;
    const camX = frame.camX, camY = frame.camY;
    tagList.length = 0;
    if (pool) pool.begin(time);
    const players = (view && view.players) || [];
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      const look = n.look || {};
      const cls = CLASS_IDS.includes(look.cls) ? look.cls : 'scout';
      const s = getState(n);
      s.seen = frameNo;
      const dx = n.x - s.x, dy = n.y - s.y;
      const d = Math.hypot(dx, dy);
      if (dt > 0) {
        s.spd += ((d > 80 ? 0 : d / dt) - s.spd) * damp(8, dt);
        if (d > 0.04) s.mvA = Math.atan2(dy, dx);
      }
      s.x = n.x;
      s.y = n.y;
      const camD = Math.hypot(n.x - camX, n.y - camY);
      // nearest living survivor: the one it turns to and follows with its eyes
      let near = null, nd = 1e9;
      for (const p of players) {
        if (p.state === 'dead') continue;
        const pd = Math.hypot(p.x - n.x, p.y - n.y);
        if (pd < nd) { nd = pd; near = p; }
      }
      const moving = s.spd > 8 && (n.state === 'walk' || n.state === 'follow' || n.state === 'escort');
      const talking = n.state === 'talk';
      const downed = n.state === 'down';
      let want = n.angle || 0;
      if (moving) want = s.mvA;
      else if ((talking || (n.state === 'idle' && nd < 200)) && near) want = Math.atan2(near.y - n.y, near.x - n.x);
      s.a += angleDiff(s.a, want) * damp(moving ? 12 : 6, dt);
      // the eyes: yaw relative to the body toward the survivor (clamped)
      let lk = 0;
      if (near && nd < 320 && !moving && !downed) lk = Math.max(-1, Math.min(1, angleDiff(s.a, Math.atan2(near.y - n.y, near.x - n.x)) / 1.0));
      s.head += (lk - s.head) * damp(5, dt);
      s.talk += ((talking ? 1 : 0) - s.talk) * damp(6, dt);
      s.down += ((downed ? 1 : 0) - s.down) * damp(5, dt);
      s.ph += (s.spd / 52) * TAU * dt * 0.62;
      if (camD > FAR) {
        disposeDressIfFar(s);
        continue;
      }
      // tags are drawn even when the body is skipped (a survivor standing in the camera)
      tagList.push(n, s, camD, nd);
      if (camD < 24) continue;
      const far = camD > NEAR_LOD;
      const model = bodyOf(cls, far);
      const i = pool.push(model);
      if (i < 0) continue;
      poseNpc(n, s, time);
      const sc = Number.isFinite(look.scale) && look.scale > 0 ? look.scale : 1;
      pose.place(n.x, n.z > 0 ? n.z : 0, n.y, s.a, sc);
      pool.solve(i, model, pose);
      const col = colorsOf(look);
      pool.color(i, T_SKIN, capLuma(tmpColor.set(col.skin), 0.42), 0);
      pool.color(i, T_CLOTH, capLuma(tmpColor.set(col.a), 0.38), 0);
      pool.color(i, T_CLOTH2, capLuma(tmpColor.set(col.b), 0.34), 0.04 + s.down * 0.3);
      pool.color(i, T_ACCENT, capLuma(tmpColor.set(col.c), 0.4), 0);
      pool.color(i, T_HAIR, capLuma(tmpColor.set(col.hair), 0.38), n.id * 7.3);
      pool.texel(i, T_FX, 0, 0, 0, 1);
      pool.texel(i, T_FX2, 0, 0, 0, 0);
      const camo = isGreen(col.a) ? 3 : 0;
      pool.texel(i, T_VAR1, 0, 0, 0, camo);
      pool.texel(i, T_VAR2, camo, 0, 0, 0);
      // accessories and hair
      if (!far) {
        const key = dressKeyOf(look);
        if (!s.dress || s.dressKey !== key) buildDress(s, look);
        if (s.dress.length) placeDress(i, s);
      } else if (s.dress) {
        for (const m of s.dress) m.visible = false;
      }
    }
    if (pool) pool.end();
    drawTags(view, frame);
    if (frameNo % 90 === 0) {
      for (const [id, s] of state) {
        if (frameNo - s.seen > 90) {
          disposeDress(s);
          state.delete(id);
        }
      }
    }
  }
  const tmpColor = new THREE.Color();
  function isGreen(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return g > r + 8 && g > b + 16;
  }
  function disposeDressIfFar(s) {
    if (s.dress) for (const m of s.dress) m.visible = false;
  }

  function placeDress(k, s) {
    let have = 0;
    for (const m of s.dress) {
      const bone = m.userData.bone;
      if (!(have & (1 << BONE_OF[bone]))) {
        pool.boneMatrix(k, BONE_OF[bone], boneM[bone]);
        have |= 1 << BONE_OF[bone];
      }
      m.matrix.multiplyMatrices(boneM[bone], m.userData.local);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
    }
  }

  // ---- overlay: name tags, hp, prompts ------------------------------------------------------
  let ui = 1, fontFor = 0, FONT = '', FONT_SMALL = '';
  function setScale(settings) {
    const k = Number(settings && settings.uiScale);
    ui = Number.isFinite(k) && k > 0 ? Math.max(0.5, Math.min(4, k)) : 1;
    if (ui !== fontFor) {
      fontFor = ui;
      FONT = `600 ${Math.round(12 * ui)}px ${FONT_FAMILY}`;
      FONT_SMALL = `700 ${Math.round(10.5 * ui)}px ${FONT_FAMILY}`;
    }
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawTags(view, frame) {
    const g = ctx.overlay;
    if (!g || !tagList.length) return;
    const settings = frame.settings || {};
    if (settings.crosshair === false) return;
    setScale(settings);
    const c = g.canvas;
    const W = c.clientWidth || parseFloat(c.style.width) || c.width;
    const H = c.clientHeight || parseFloat(c.style.height) || c.height;
    const local = frame.local;
    const marks = (view && view.story && view.story.marks) || [];
    g.save();
    g.textBaseline = 'bottom';
    for (let k = 0; k < tagList.length; k += 4) {
      const n = tagList[k], s = tagList[k + 1], camD = tagList[k + 2];
      const sc = Number.isFinite(n.look && n.look.scale) && n.look.scale > 0 ? n.look.scale : 1;
      const down = n.state === 'down';
      const p = ctx.project(n.x, n.y, (down ? 24 : TAG_H) * sc + (n.z > 0 ? n.z : 0));
      if (!p.visible) continue;
      const edge = Math.min(p.x, W - p.x) / W;
      const fade = Math.max(0, Math.min(1, (1500 - camD) / 400, (camD - 40) / 80, (edge - 0.08) / 0.06));
      if (fade <= 0) continue;
      g.globalAlpha = fade;
      const ts = Math.max(0.8, Math.min(1.15, 1.25 - camD / 1600));
      const cast = CAST[n.key];
      const dot = (cast && cast.color) || '#fde68a';
      const name = n.name || (cast && cast.name) || n.key;
      g.font = FONT;
      const nw = g.measureText(name).width;
      const bad = 5 * ui * ts;
      const pw = nw + bad * 2 + 16 * ui * ts, ph = 17 * ui * ts;
      const px = p.x - pw / 2, py = p.y - 8 * ui * ts - ph;
      g.fillStyle = 'rgba(8,10,14,0.66)';
      roundRect(g, px, py, pw, ph, ph / 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = ui;
      g.stroke();
      g.fillStyle = dot;
      g.beginPath();
      g.arc(px + ph / 2, py + ph / 2, bad, 0, TAU);
      g.fill();
      g.textAlign = 'left';
      g.lineWidth = 3 * ui;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      const tx = px + ph / 2 + bad + 4 * ui * ts, ty = py + ph - 4.2 * ui * ts;
      g.strokeText(name, tx, ty);
      g.fillStyle = '#f7f3e6';
      g.fillText(name, tx, ty);
      g.textAlign = 'center';
      // hp bar for the wounded and for the one being escorted
      const f = n.hp < 0 ? 1 : Math.max(0, Math.min(1, n.hp));
      if (n.hp >= 0 && (f < 0.995 || n.state === 'escort' || down)) {
        const bw = 44 * ui * ts, bh = 5 * ui * ts;
        g.fillStyle = 'rgba(0,0,0,0.7)';
        roundRect(g, p.x - bw / 2 - ui, p.y - 5 * ui * ts - ui, bw + 2 * ui, bh + 2 * ui, bh / 2 + ui);
        g.fill();
        g.fillStyle = f > 0.5 ? '#7dff9a' : f > 0.25 ? '#ffd54f' : '#ff5252';
        if (f > 0) {
          roundRect(g, p.x - bw / 2, p.y - 5 * ui * ts, Math.max(bh, bw * f), bh, bh / 2);
          g.fill();
        }
      }
      // "!" when an objective waits for a word with them
      let waits = false;
      for (const m of marks) if (m.kind === 'npc' && Math.hypot(m.x - n.x, m.y - n.y) < 40) waits = true;
      if (waits) {
        const by = py - 6 * ui * ts + Math.sin(frame.now * 5) * 2 * ui;
        g.font = `800 ${Math.round(20 * ui * ts)}px ${FONT_FAMILY}`;
        g.textAlign = 'center';
        g.lineWidth = 4 * ui;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText('!', p.x, by);
        g.fillStyle = '#ffd24a';
        g.fillText('!', p.x, by);
      }
      // the prompt, when the local survivor is in talking range
      if (local && local.state === 'alive' && n.state !== 'follow') {
        const pd = Math.hypot(local.x - n.x, local.y - n.y);
        if (pd <= TALK_RANGE * 1.25) {
          const label = down ? 'Hold E · Revive' : 'E · Talk';
          g.font = FONT_SMALL;
          const lw = g.measureText(label).width + 14 * ui;
          const lh = 16 * ui;
          const lx = p.x - lw / 2, ly = p.y + 8 * ui * ts;
          g.fillStyle = down ? 'rgba(120,20,20,0.85)' : 'rgba(255,214,90,0.92)';
          roundRect(g, lx, ly, lw, lh, lh / 2);
          g.fill();
          g.fillStyle = down ? '#fff1f1' : '#1c1608';
          g.textBaseline = 'middle';
          g.textAlign = 'center';
          g.fillText(label, p.x, ly + lh / 2 + 0.5 * ui);
          g.textBaseline = 'bottom';
        }
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }

  function disposePool() {
    for (const s of state.values()) disposeDress(s);
    state.clear();
    if (pool) {
      pool.dispose();
      pool = null;
    }
    if (tex) {
      tex.detail.dispose();
      tex.normal.dispose();
      tex.detail2.dispose();
      tex = null;
    }
    for (const k of Object.keys(bodies)) delete bodies[k];
  }

  return {
    update,
    setQuality(q) {
      high = q !== 'low';
      if (tierOf(q) !== curTier) {
        curTier = tierOf(q);
        disposePool();     // the models come back lazily at the new tier
      } else {
        for (const cls of Object.keys(bodies)) bodies[cls].forEach((m, L) => { if (m) { m.mesh.castShadow = high; m.mesh.receiveShadow = high && L === 0; } });
      }
    },
    dispose() {
      disposePool();
      for (const m of mats.values()) m.dispose();
      for (const k of Object.keys(geos)) geos[k].dispose();
      for (const g of torusGeos.values()) g.dispose();
      root.removeFromParent();
    },
  };
}
