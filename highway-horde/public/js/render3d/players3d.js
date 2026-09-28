// Teammates in the first-person view (ACTORS, SPEC §7.5): every player except the local
// one while alive (the local one too when dead/spectating), as sculpted soldiers per class
// (actor-smodels.js) on the GPU rig (actor-rig.js) — one instanced draw per class and LOD.
//
// The held gun (actor-guns.js) is placed first — shouldered rifle stance, two-handed
// pistol, hip-fired heavies, a rocket tube on the shoulder, dual pistols — then both arms
// reach for it with two-bone IK (firing hand on the grip, support hand on the foregrip),
// so the hands stay on the gun through walk/strafe/run cycles, recoil, the reload (support
// hand to the mag well, down to a pouch and back), the sprint low-ready and the melee
// butt-stroke. Jumping: lifted by the snapshot's `z` with the legs tucked. Downed:
// propped on an elbow, pistol up. Dead: a corpse on its back. Each
// has a weapon-light beam (cheap additive cone); the two nearest also get a real light.
// Publishes each teammate's muzzle position in fx.muzzles for tracers (effects3d).

import * as THREE from 'three';
import { CLASSES, CLASS_IDS } from '../shared/classes.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { angleDiff, damp, hash01, capLuma } from './actor-kit.js';
import { RigPool, Pose, B, T_SKIN, T_CLOTH, T_CLOTH2, T_ACCENT, T_HAIR, T_FX, T_FX2 } from './actor-rig.js';
import { buildSoldier, soldierSkeleton, SP } from './actor-smodels.js';
import { geometryFromArrays } from './actor-shape.js';
import { actorTextures } from './actor-tex.js';
import { gunObject } from './actor-guns.js';
import { acquireFx, releaseFx } from './fx-core.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const CAP = 8;
const SKIN = { soldier: '#c68e6a', medic: '#e3b899', engineer: '#8d5a3b', scout: '#b9835a', demo: '#d9a57c', heavy: '#6f4a33' };
const GUN_SCALE = 0.84;

// how each weapon style is held
const HOLD = {
  pistol: 'pistol', revolver: 'pistol', dual: 'dual', rocket: 'shoulder', minigun: 'hip', lmg: 'hip', flamethrower: 'hip',
  flare: 'pistol', chainsaw: 'hip', cryo: 'hip',
};

const cache = new Map();
function soldierArrays(cls, L) {
  const k = cls + L;
  let a = cache.get(k);
  if (!a) { a = buildSoldier(cls, L).arrays(); cache.set(k, a); }
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

const CONE_VERT = /* glsl */`
varying float vAlong;
varying float vEdge;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vAlong = 1.0 - uv.y;   // 1 at the lens (narrow end)
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vDepth = -mvPosition.z;
  vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vec3 v = normalize(-mvPosition.xyz);
  vec3 axis = normalize(normalMatrix * mat3(instanceMatrix) * vec3(1.0, 0.0, 0.0));
  // a beam seen from the side reads as a shaft; seen head-on it would be a wall of
  // additive haze, so it fades out as it lines up with the view
  float along = abs(dot(axis, v));
  vEdge = abs(dot(n, v)) * (1.0 - along * along * along);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const CONE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
varying float vAlong;
varying float vEdge;
varying float vDepth;
#include <fog_pars_fragment>
void main() {
  float f = 0.0;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      f = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  float a = pow(vAlong, 1.6) * smoothstep(0.0, 0.6, vEdge) * uStrength * (1.0 - f);
  // a teammate next to the camera put the fat near end of their beam across half the
  // screen as a grey bar: fade the haze out close to the eye
  a *= smoothstep(40.0, 260.0, vDepth);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// rig-order Euler from a row-major 3×3 (R = Ry·Rx·Rz)
function eulerOf(R, out) {
  const sx = Math.max(-1, Math.min(1, -R[5]));
  out[0] = Math.asin(sx);
  if (Math.abs(sx) < 0.9999) { out[2] = Math.atan2(R[3], R[4]); out[1] = Math.atan2(R[2], R[8]); } else { out[2] = 0; out[1] = Math.atan2(-R[6], R[0]); }
  return out;
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createPlayers3D(ctx) {
  const fx = acquireFx(ctx);
  if (!fx.muzzles) fx.muzzles = new Map();
  const root = new THREE.Group();
  root.name = 'players3d';
  ctx.scene.add(root);
  let high = ctx.quality !== 'low';
  const tex = actorTextures(8);
  const pool = new RigPool({ capacity: CAP + 2, textures: tex });
  const sk = soldierSkeleton();
  const bodies = {};
  for (const cls of CLASS_IDS) {
    bodies[cls] = [0, 1].map((L) => {
      const m = pool.addModel(instancedGeometry(soldierArrays(cls, L)), sk, { rim: '#b8d0ff', rimStrength: 0.34, castShadow: high, receiveShadow: high && L === 0, name: 'p-' + cls + L });
      root.add(m.mesh);
      return m;
    });
  }
  pool.warm();
  // Shader warm-up: the renderer compiles what is visible right after creation. Teammates'
  // guns are plain (non-instanced) meshes with a solid, a glow and a shadow depth variant
  // that nothing else in the scene uses, so without this stand-in they compiled on the
  // first frame a player showed up. Removed on the first update.
  let warmGun = gunObject('pistol', { shadow: high, lite: true });
  warmGun.position.set(0, -500, 0);
  root.add(warmGun);
  const skinCol = {}, outfitCol = {};
  for (const cls of CLASS_IDS) {
    skinCol[cls] = capLuma(new THREE.Color(SKIN[cls] || '#c68e6a'), 0.4);
    outfitCol[cls] = capLuma(new THREE.Color(CLASSES[cls].look.outfit), 0.34);
  }
  const pcol = PLAYER_COLORS.map((c) => new THREE.Color(c));
  const hairCol = new THREE.Color('#2a1d14');

  // weapon-light cones (instanced, additive)
  const coneGeo = new THREE.CylinderGeometry(58, 2.5, 300, 16, 1, true);
  coneGeo.rotateZ(HALF_PI);
  coneGeo.translate(-150, 0, 0);
  coneGeo.rotateY(Math.PI);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color('#fff0d0') }, uStrength: { value: 0.05 } }]),
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide,
  });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, CAP);
  cones.frustumCulled = false;
  cones.count = 0;
  cones.renderOrder = 9;
  root.add(cones);

  const state = new Map();   // pid → anim state
  const guns = new Map();    // pid → { obj, weapon, model, left }
  let frameNo = 0;
  const pose = new Pose();
  const _o = { x: 0, y: 0, z: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const _mc = new THREE.Matrix4();
  const nearLights = [];

  function getState(p) {
    let s = state.get(p.id);
    if (!s) {
      s = { x: p.x, y: p.y, a: p.angle || 0, spd: 0, mvA: 0, ph: hash01(p.id) * TAU, shot: 9, seen: 0, sprint: 0, down: 0, dead: 0, fwd: 1, side: 0, air: 0 };
      state.set(p.id, s);
    }
    return s;
  }

  function heldWeapon(p) {
    if (p.state === 'downed') {
      const s0 = p.slots && p.slots[0];
      return s0 && WEAPONS[s0] && WEAPONS[s0].category === 'pistol' ? s0 : 'pistol';
    }
    const id = p.slots && p.slots[p.slot];
    return id && WEAPONS[id] ? id : null;
  }

  function gunFor(pid, weaponId) {
    let g = guns.get(pid);
    if (!g) { g = { obj: null, left: null, weapon: undefined, model: null }; guns.set(pid, g); }
    if (g.weapon !== weaponId) {
      if (g.obj) { g.obj.removeFromParent(); g.obj.userData.dispose(); }
      if (g.left) { g.left.removeFromParent(); g.left.userData.dispose(); }
      g.obj = g.left = null;
      g.weapon = weaponId;
      if (weaponId) {
        g.obj = gunObject(weaponId, { shadow: high, lite: true });
        g.obj.rotation.order = 'YXZ';
        g.obj.scale.setScalar(GUN_SCALE);
        root.add(g.obj);
        g.model = g.obj.userData.model;
        if (g.model.dual) {
          g.left = gunObject(weaponId, { shadow: high, mirror: true, lite: true });
          g.left.rotation.order = 'YXZ';
          g.left.scale.setScalar(GUN_SCALE);
          root.add(g.left);
        }
      }
    }
    return g;
  }

  // ---- IK ---------------------------------------------------------------------------------
  const Rc = new Float64Array(9), Rua = new Float64Array(9), Rf = new Float64Array(9), Rh = new Float64Array(9), T9 = new Float64Array(9);
  const eul = [0, 0, 0];
  const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), dir = new THREE.Vector3(), perp = new THREE.Vector3();
  const u = new THREE.Vector3(), f = new THREE.Vector3(), uL = new THREE.Vector3(), fL = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const gunRot = new Float64Array(9), handBuf = new Float64Array(9);
  const armLen = [SP.uarm, SP.farm];

  function rotOfMatrix4(m4, out) {
    const e = m4.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
    // row-major out[r*3+c] = column c row r
    out[0] = e[0] / sx; out[3] = e[1] / sx; out[6] = e[2] / sx;
    out[1] = e[4] / sy; out[4] = e[5] / sy; out[7] = e[6] / sy;
    out[2] = e[8] / sz; out[5] = e[9] / sz; out[8] = e[10] / sz;
    return out;
  }
  // out = A^T · B (row-major 3×3)
  function mulTN(out, A, Bm) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r] * Bm[c] + A[3 + r] * Bm[3 + c] + A[6 + r] * Bm[6 + c];
  }
  function mulNN(out, A, Bm) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r * 3] * Bm[c] + A[r * 3 + 1] * Bm[3 + c] + A[r * 3 + 2] * Bm[6 + c];
  }

  /**
   * Two-bone IK for one arm: shoulder (from the solved chest) → wrist target W, elbow
   * toward `pole`; the hand takes world rotation `handR` (row-major 3×3). Writes the
   * arm's Euler angles into the pose.
   */
  function solveArm(k, model, side, pole, handR) {
    const UA = side > 0 ? B.UARM_R : B.UARM_L, FA = side > 0 ? B.FARM_R : B.FARM_L, HD = side > 0 ? B.HAND_R : B.HAND_L;
    const pv = sk.pivots[UA];
    pool.point(k, B.CHEST, pv[0], pv[1], pv[2], _o);
    S.set(_o.x, _o.y, _o.z);
    const a = armLen[0], b = armLen[1];
    dir.subVectors(W, S);
    let d = dir.length();
    dir.divideScalar(d || 1);
    d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, d));
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    E.copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    u.subVectors(E, S).normalize();
    f.copy(S).addScaledVector(dir, d).sub(E).normalize();
    // into chest space
    uL.set(Rc[0] * u.x + Rc[3] * u.y + Rc[6] * u.z, Rc[1] * u.x + Rc[4] * u.y + Rc[7] * u.z, Rc[2] * u.x + Rc[5] * u.y + Rc[8] * u.z);
    fL.set(Rc[0] * f.x + Rc[3] * f.y + Rc[6] * f.z, Rc[1] * f.x + Rc[4] * f.y + Rc[7] * f.z, Rc[2] * f.x + Rc[5] * f.y + Rc[8] * f.z);
    Y.copy(uL).negate();
    X.copy(fL).addScaledVector(uL, -fL.dot(uL));
    if (X.lengthSq() < 1e-5) X.set(1, 0, 0).addScaledVector(uL, -uL.x);
    X.normalize();
    Z.crossVectors(X, Y);
    Rua[0] = X.x; Rua[1] = Y.x; Rua[2] = Z.x;
    Rua[3] = X.y; Rua[4] = Y.y; Rua[5] = Z.y;
    Rua[6] = X.z; Rua[7] = Y.z; Rua[8] = Z.z;
    eulerOf(Rua, eul);
    pose.set(UA, eul[0], eul[1], eul[2]);
    const bend = Math.acos(Math.max(-1, Math.min(1, uL.dot(fL))));
    pose.set(FA, 0, 0, bend);
    if (handR) {
      // forearm world rotation = Rc · Rua · Rz(bend); hand local = Rf^T · handR
      const c = Math.cos(bend), s = Math.sin(bend);
      T9[0] = c; T9[1] = -s; T9[2] = 0; T9[3] = s; T9[4] = c; T9[5] = 0; T9[6] = 0; T9[7] = 0; T9[8] = 1;
      mulNN(Rh, Rua, T9);
      mulNN(Rf, Rc, Rh);
      mulTN(T9, Rf, handR);
      eulerOf(T9, eul);
      pose.set(HD, eul[0], eul[1], eul[2]);
    }
  }

  // wrist offsets in gun space (the hand model's wrist → palm is along its -Y)
  const WR_R = new THREE.Vector3(-0.6, 2.2, 0.35);
  const hand90 = new Float64Array(9);

  function dropWarmGun() {
    if (!warmGun) return;
    warmGun.removeFromParent();
    warmGun.userData.dispose();
    warmGun = null;
  }

  function update(view, frame) {
    dropWarmGun();
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const time = frame.now || 0;
    const localId = frame.localId || 0;
    const local = frame.local;
    const spectating = !local || local.state === 'dead';
    const roster = frame.roster || [];
    pool.begin(time);
    let nc = 0;
    nearLights.length = 0;
    const list = (view && view.players) || [];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (p.id === localId && !(spectating && p.state === 'dead')) { hideGun(p.id); continue; }
      const r = roster.find((q) => q.id === p.id);
      const cls = r && CLASSES[r.cls] ? r.cls : CLASS_IDS[(p.id - 1) % CLASS_IDS.length];
      const color = pcol[(r ? r.color : p.id - 1) % pcol.length] || pcol[0];
      const s = getState(p);
      s.seen = frameNo;
      const dx = p.x - s.x, dy = p.y - s.y;
      const d = Math.hypot(dx, dy);
      if (dt > 0) {
        const v = d > 80 ? 0 : d / dt;
        s.spd += (v - s.spd) * damp(8, dt);
        if (d > 0.05) s.mvA = Math.atan2(dy, dx);
      }
      s.x = p.x; s.y = p.y;
      s.a += angleDiff(s.a, p.angle || 0) * damp(14, dt);
      s.shot += dt;
      s.sprint += ((p.sprinting ? 1 : 0) - s.sprint) * damp(6, dt);
      s.down += ((p.state === 'downed' ? 1 : 0) - s.down) * damp(5, dt);
      s.dead += ((p.state === 'dead' ? 1 : 0) - s.dead) * damp(4, dt);
      // jump: tuck in quickly after take-off, stretch out again for the landing
      const jz = p.state !== 'dead' && p.z > 0 ? p.z : 0;
      s.air += ((jz > 6 ? 1 : 0) - s.air) * damp(jz > 6 ? 14 : 18, dt);
      // movement relative to the aim: forward/back and strafe components (smoothed)
      const rel = angleDiff(s.a, s.mvA);
      const mv = Math.min(1, s.spd / 40);
      s.fwd += (Math.cos(rel) * mv - s.fwd) * damp(8, dt);
      s.side += (Math.sin(rel) * mv - s.side) * damp(8, dt);
      s.ph += (s.spd / (58 + s.sprint * 20)) * TAU * dt;

      // The sim lets survivors overlap: a teammate standing in the camera would fill the
      // view from the inside of their own model. Skip them (the name tag fades there too).
      const camD = Math.hypot(p.x - frame.camX, p.y - frame.camY);
      if (camD < 30) { hideGun(p.id); continue; }
      const model = bodies[cls][camD < 700 ? 0 : 1];
      const i = pool.push(model);
      if (i < 0) continue;
      const wid = p.state === 'dead' ? null : heldWeapon(p);
      const style = wid ? WEAPONS[wid].sprite.style : 'rifle';
      const hold = s.down > 0.5 ? 'pistol' : HOLD[style] || 'rifle';
      poseBody(p, s, time, hold);
      pose.place(p.x, jz, p.y, s.a, 1);
      pool.solve(i, model, pose);
      const g = gunFor(p.id, wid);
      if (wid && g.obj && s.dead < 0.5) {
        placeGun(i, model, p, s, g, hold, time, jz);
        pool.solve(i, model, pose);
      } else if (g.obj) {
        g.obj.visible = false;
        if (g.left) g.left.visible = false;
      }
      pool.color(i, T_SKIN, skinCol[cls], 0);
      pool.color(i, T_CLOTH, outfitCol[cls], 0);
      pool.color(i, T_CLOTH2, outfitCol[cls], 0.04 + s.down * 0.3);
      pool.color(i, T_ACCENT, color, 0);
      pool.color(i, T_HAIR, hairCol, p.id * 7.3);
      pool.texel(i, T_FX, 0, 0, s.shot < 0.05 ? 0.25 : 0, 1);
      pool.texel(i, T_FX2, 0, 0, 0, 0);

      // weapon light: from under the barrel, along the gun (alive/downed teammates)
      if (p.state !== 'dead' && nc < CAP && g.obj && g.obj.visible) {
        const mz = g.model.front;
        _p.set(mz[0] + 3, mz[1] - 0.5, mz[2]).applyMatrix4(g.obj.matrixWorld);
        _e.set(0, g.obj.rotation.y, g.obj.rotation.z * 0.7 - 0.08, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p, _q, _s);
        cones.setMatrixAt(nc++, _m);
        nearLights.push((p.x - frame.camX) ** 2 + (p.y - frame.camY) ** 2, p, s);
      }
    }
    pool.end();
    cones.count = nc;
    cones.visible = nc > 0;
    if (nc) cones.instanceMatrix.needsUpdate = true;
    // real lights for the two nearest teammates' beams (a pool where the beam lands)
    const order = [];
    for (let k = 0; k < nearLights.length; k += 3) order.push(k);
    order.sort((a, b) => nearLights[a] - nearLights[b]);
    for (let n = 0; n < Math.min(2, order.length); n++) {
      const k = order[n];
      if (nearLights[k] > 1500 * 1500) break;
      const p = nearLights[k + 1], s = nearLights[k + 2];
      const reach = 130;
      ctx.lights.steady('mate' + p.id, p.x + Math.cos(s.a) * reach, p.y + Math.sin(s.a) * reach, 60, '#fff0d0', 0.3, 190);
    }
    // forget players who left
    if (frameNo % 60 === 0) {
      for (const [id, s] of state) if (frameNo - s.seen > 60) { state.delete(id); hideGun(id, true); fx.muzzles.delete(id); }
    }
  }

  function hideGun(pid, remove) {
    const g = guns.get(pid);
    if (!g) return;
    if (g.obj) g.obj.visible = false;
    if (g.left) g.left.visible = false;
    if (remove) {
      if (g.obj) { g.obj.removeFromParent(); g.obj.userData.dispose(); }
      if (g.left) { g.left.removeFromParent(); g.left.userData.dispose(); }
      guns.delete(pid);
    }
  }

  // ---- body pose ----------------------------------------------------------------------------
  function poseBody(p, s, time, hold) {
    pose.reset();
    const amp = Math.min(1.25, s.spd / 150);
    const sw = Math.sin(s.ph), cw = Math.cos(s.ph);
    const breathe = Math.sin(time * 2 + p.id) * 0.015;
    const fwd = s.fwd, side = s.side;
    const run = s.sprint;
    // legs: swing along the movement direction (forward/back and sideways for strafing)
    const stride = 0.55 + run * 0.35;
    let thL = sw * stride * amp * fwd, thR = -sw * stride * amp * fwd;
    let thLX = sw * 0.3 * amp * side, thRX = -sw * 0.3 * amp * side;
    const lift = (0.85 + run * 0.6) * amp;
    let shL = -Math.max(0, Math.sin(s.ph + 1.3)) * lift - 0.08, shR = -Math.max(0, -Math.sin(s.ph + 1.3)) * lift - 0.08;
    let ftL = Math.max(0, cw) * 0.3 * amp - 0.05, ftR = Math.max(0, -cw) * 0.3 * amp - 0.05;
    let rootY = -Math.abs(cw) * (1.4 + run * 1.2) * amp + 0.6 * amp - 0.4, rootX = 0;
    let hipsX = sw * 0.04 * amp, hipsY = -sw * 0.08 * amp * fwd, hipsZ = 0;
    // stance: a slight crouch, weight forward, chest turned so the support shoulder leads
    const rifle = hold === 'rifle';
    let spineZ = -0.08 - run * 0.28 + breathe, spineY = 0, spineX = -side * 0.08;
    let chestZ = -0.06 - run * 0.1 + breathe * 0.6, chestY = rifle ? -0.32 * (1 - run * 0.6) : hold === 'hip' ? -0.15 : 0, chestX = 0;
    let neckY = -chestY * 0.55, headY = -chestY * 0.5, headZ = rifle ? -0.12 : 0.02, headX = rifle ? 0.12 : 0;
    thL += 0.08; thR += 0.08; shL -= 0.12; shR -= 0.12; rootY -= 0.4;
    // airborne: knees pulled up (one a little higher), feet pointed, a slight lean in
    if (s.air > 0.01) {
      const k = s.air * (1 - s.down), n = 1 - k;
      thL = thL * n + 0.95 * k; thR = thR * n + 0.6 * k;
      shL = shL * n - 1.45 * k; shR = shR * n - 1.1 * k;
      ftL = ftL * n + 0.3 * k; ftR = ftR * n + 0.25 * k;
      thLX *= n; thRX *= n;
      spineZ -= 0.1 * k;
    }
    // downed: fallen back, propped on the left elbow
    if (s.down > 0.01) {
      const k = s.down;
      hipsZ = hipsZ * (1 - k) + 1.35 * k;
      rootY = rootY * (1 - k) - (SP.hip - 6.5) * k; rootX = 13 * k;
      spineZ = spineZ * (1 - k) - 0.55 * k; chestZ = chestZ * (1 - k) - 0.35 * k; chestY *= 1 - k; neckY *= 1 - k; headY *= 1 - k;
      headZ = headZ * (1 - k) - 0.3 * k;
      thL = thL * (1 - k) + (0.2 + Math.sin(time * 1.5 + p.id) * 0.1) * k; thR = thR * (1 - k) - 0.15 * k;
      shL = shL * (1 - k) - 0.7 * k; shR = shR * (1 - k) - 0.25 * k; thLX *= 1 - k; thRX *= 1 - k;
    }
    // dead: flat on the back, limbs splayed
    if (s.dead > 0.01) {
      const k = s.dead;
      hipsZ = 1.52 * k; rootY = rootY * (1 - k) - (SP.hip - 4.2) * k; rootX = 10 * k;
      spineZ = 0.05 * k; chestZ = 0; chestY = 0; spineY = 0; neckY = 0; headY = 0.6 * k; headZ = 0.1 * k; headX = 0.3 * k;
      thL = 0.1 * k; thR = -0.2 * k; shL = -0.3 * k; shR = -0.1 * k; thLX = 0.1 * k; thRX = -0.15 * k;
      pose.set(B.UARM_L, 1.1 * k, 0, 0.3 * k); pose.set(B.FARM_L, 0, 0, 0.6 * k);
      pose.set(B.UARM_R, -1.3 * k, 0, 0.5 * k); pose.set(B.FARM_R, 0, 0, 0.3 * k);
    } else {
      // arms start hanging; IK sets them to the gun
      pose.set(B.UARM_L, 0.1, 0, 0.2); pose.set(B.UARM_R, -0.1, 0, 0.2);
    }
    pose.set(B.HIPS, hipsX, hipsY, hipsZ);
    pose.set(B.SPINE, spineX, spineY, spineZ);
    pose.set(B.CHEST, chestX, chestY, chestZ);
    pose.set(B.NECK, 0, neckY, 0.05);
    pose.set(B.HEAD, headX, headY, headZ);
    pose.set(B.THIGH_L, thLX, 0, thL);
    pose.set(B.SHIN_L, 0, 0, shL);
    pose.set(B.FOOT_L, 0, 0, ftL);
    pose.set(B.THIGH_R, thRX, 0, thR);
    pose.set(B.SHIN_R, 0, 0, shR);
    pose.set(B.FOOT_R, 0, 0, ftR);
    pose.root[0] = rootX; pose.root[1] = rootY;
  }

  // gun grip position in body (root) space per hold, before animation offsets
  const GRIP = {
    rifle: [13.2, 43.6, 1.9], pistol: [18.5, 45.2, 0.8], dual: [17, 43.4, 4.6], hip: [10.5, 36.5, 4.8], shoulder: [4.5, 45.8, 6.6],
  };
  const _g = new THREE.Vector3(), _w = new THREE.Vector3(), _pole = new THREE.Vector3();

  function placeGun(k, model, p, s, g, hold, time, lift = 0) {
    const obj = g.obj, m = g.model;
    const a = s.a, ca = Math.cos(a), sa = Math.sin(a);
    const kick = s.shot < 0.12 ? (1 - s.shot / 0.12) : 0;
    const rl = p.reloading > 0 ? Math.min(1, p.reloading) : 0;
    const rlS = rl > 0 ? Math.sin(rl * Math.PI) : 0;
    const ml = p.meleeing > 0 ? Math.sin(Math.min(1, p.meleeing) * Math.PI) : 0;
    const run = s.sprint * (1 - s.down);
    let gx, gy, gz, yaw = 0, pitch = 0, roll = 0;
    if (s.down > 0.5) {
      // downed: pistol held out from the chest (chest-relative)
      pool.boneMatrix(k, B.CHEST, _mc);
      _g.set(15, SP.chest + 4, 1.5).applyMatrix4(_mc);
      gx = _g.x; gy = _g.y; gz = _g.z;
      pitch = 0.12;
    } else {
      const G = GRIP[hold] || GRIP.rifle;
      let lx = G[0], ly = G[1], lz = G[2];
      // idle sway + walk bob
      ly += Math.sin(time * 1.9 + p.id) * 0.25 - Math.abs(Math.cos(s.ph)) * 0.6 * Math.min(1, s.spd / 150);
      lx += Math.sin(time * 1.3 + p.id * 2) * 0.2;
      // sprint: low ready, muzzle down and across the body
      lx -= run * 3.5; ly -= run * 5; lz -= run * 1.5; pitch -= run * 0.55; yaw += run * 0.55;
      // recoil
      lx -= kick * 1.8; pitch += kick * 0.14;
      // reload: tilt the gun in toward the chest
      lx -= rlS * 2; ly -= rlS * 2.2; lz -= rlS * 1.4; roll += rlS * 0.7; pitch -= rlS * 0.25; yaw += rlS * 0.25;
      // melee: shove forward with the butt/muzzle
      lx += ml * 6; ly += ml * 1.5; pitch += ml * 0.15; yaw -= ml * 0.3;
      const bob = pose.root[1];
      gx = p.x + ca * lx - sa * lz; gz = p.y + sa * lx + ca * lz; gy = ly + bob + lift;
    }
    obj.visible = true;
    obj.position.set(gx, gy, gz);
    obj.rotation.set(roll, -a + yaw, pitch, 'YXZ');
    obj.updateMatrixWorld();
    // IK both arms to the gun
    pool.boneMatrix(k, B.CHEST, _mc);
    rotOfMatrix4(_mc, Rc);
    rotOfMatrix4(obj.matrixWorld, gunRot);
    // right hand on the grip
    W.copy(WR_R).applyMatrix4(obj.matrixWorld);
    _pole.set(-0.4 * ca - 0.8 * -sa, -1, -0.4 * sa + 0.8 * ca);          // elbow down, out to the right, back
    solveArm(k, model, 1, _pole, gunRot);
    // support hand
    if (m.dual && g.left) {
      g.left.visible = true;
      const lx2 = obj.position.x - (-sa) * 9.2, lz2 = obj.position.z - ca * 9.2;
      g.left.position.set(lx2, obj.position.y, lz2);
      g.left.rotation.set(-roll, -a - yaw, pitch, 'YXZ');
      g.left.updateMatrixWorld();
      rotOfMatrix4(g.left.matrixWorld, handBuf);
      W.set(WR_R.x, WR_R.y, -WR_R.z).applyMatrix4(g.left.matrixWorld);
      _pole.set(-0.4 * ca + 0.8 * -sa, -1, -0.4 * sa - 0.8 * ca);
      solveArm(k, model, -1, _pole, handBuf);
    } else {
      if (g.left) g.left.visible = false;
      let t;
      if (hold === 'pistol') t = _w.set(-0.3, 0.8, -1.9);                 // cupping the firing hand
      else t = _w.set(m.front[0] - 0.8, m.front[1] - 1.6, m.front[2] - 1.0);
      if (rl > 0 && hold !== 'pistol') {
        // support hand: to the mag well, down to a pouch, back up, onto the foregrip
        const mag = [2.5, -2.5, -0.9];
        if (rl < 0.25) t.lerp(_g.set(...mag), rl / 0.25);
        else if (rl < 0.5) t.set(...mag).lerp(_g.set(-2, -14, -4), (rl - 0.25) / 0.25);
        else if (rl < 0.75) t.set(-2, -14, -4).lerp(_g.set(...mag), (rl - 0.5) / 0.25);
        else t.set(...mag).lerp(_g.set(m.front[0] - 0.8, m.front[1] - 1.6, m.front[2] - 1.0), (rl - 0.75) / 0.25);
      }
      W.copy(t).applyMatrix4(obj.matrixWorld);
      // palm up under the handguard: rotate the hand about the barrel axis
      const rr = hold === 'pistol' ? 0.5 : 1.35;
      hand90[0] = 1; hand90[1] = 0; hand90[2] = 0;
      hand90[3] = 0; hand90[4] = Math.cos(rr); hand90[5] = -Math.sin(rr);
      hand90[6] = 0; hand90[7] = Math.sin(rr); hand90[8] = Math.cos(rr);
      mulNN(handBuf, gunRot, hand90);
      _pole.set(-0.5 * ca + 0.6 * -sa, -1, -0.5 * sa - 0.6 * ca);          // elbow down, out to the left
      solveArm(k, model, -1, _pole, handBuf);
    }
    // muzzle for tracers
    const mz = m.muzzle;
    _p.set(mz[0], mz[1], mz[2]).applyMatrix4(obj.matrixWorld);
    let mm = fx.muzzles.get(p.id);
    if (!mm) { mm = { x: 0, h: 0, y: 0, now: 0 }; fx.muzzles.set(p.id, mm); }
    mm.x = _p.x; mm.h = _p.y; mm.y = _p.z; mm.now = time;
    // spinning barrels / pump
    if (obj.userData.animate) obj.userData.animate({ spin: p.spin || 0, dt: 1 / 60, shot: s.shot, time, firing: !!p.firing });
    if (g.left && g.left.visible && g.left.userData.animate) g.left.userData.animate({ spin: 0, dt: 1 / 60, shot: s.shot, time });
  }

  function addEvents(events) {
    if (!events) return;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (e.type === 'shot' && e.pid && !e.echo) {
        const s = state.get(e.pid);
        if (s) s.shot = 0;
      }
    }
  }

  return {
    update,
    addEvents,
    setQuality(q) {
      high = q !== 'low';
      for (const cls of CLASS_IDS) bodies[cls].forEach((m, L) => { m.mesh.castShadow = high; m.mesh.receiveShadow = high && L === 0; });
      for (const g of guns.values()) for (const o of [g.obj, g.left]) if (o) o.traverse((c) => { if (c.isMesh) c.castShadow = high; });
    },
    dispose() {
      dropWarmGun();
      for (const pid of [...guns.keys()]) hideGun(pid, true);
      pool.dispose();
      tex.detail.dispose();
      tex.normal.dispose();
      coneGeo.dispose();
      coneMat.dispose();
      cones.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}
