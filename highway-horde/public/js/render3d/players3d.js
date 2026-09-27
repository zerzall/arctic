// Teammates in the first-person view (ACTORS, SPEC §7.5): every player except the local
// one while alive (the local one too when dead/spectating), as low-poly soldiers on the
// same GPU rig as the zombies (actor-rig.js): one InstancedMesh per class (outfit, vest
// and hat baked in, skin/outfit/player colour per instance), holding their current gun
// (actor-guns.js), walking/strafing from their rendered motion, aiming along their angle,
// sprinting with the gun lowered, recoil on their shots, reload tilt, melee shove,
// downed (propped on an elbow, pistol up), dead (corpse). Each has a cheap additive
// flashlight cone; the two nearest also get a real light from ctx.lights.steady.
// Publishes each teammate's muzzle position in fx.muzzles for tracers (effects3d).

import * as THREE from 'three';
import { CLASSES, CLASS_IDS } from '../shared/classes.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { PartBuilder, shadeHex, angleDiff, damp, hash01 } from './actor-kit.js';
import { RigInstances, rigPoint, B, SLOT, T_ROOT, T_SKIN, T_CLOTH, T_ACCENT, T_FX } from './actor-rig.js';
import { gunModel, gunMaterials } from './actor-guns.js';
import { acquireFx, releaseFx } from './fx-core.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const CAP = 8;
const SKIN = { soldier: '#c68e6a', medic: '#e3b899', engineer: '#8d5a3b', scout: '#b9835a', demo: '#d9a57c', heavy: '#6f4a33' };
const BOOT = '#1e1a16', GLOVE = '#2b2420', BELT = '#2a241c';

// soldier proportions (a touch taller and broader than a walker)
const P = {
  hip: 28, knee: 15, legW: 4.6, legGap: 3.6, torsoH: 16, torsoD: 8.4, torsoW: 15, shoulder: 45.5, sw: 8.4,
  uarm: 11.5, farm: 10.5, armW: 3.6, head: [7, 8, 6.8], neck: 48,
};

function skeleton() {
  const piv = [];
  piv[B.HIPS] = [0, P.hip, 0];
  piv[B.SPINE] = [0, P.hip + 2, 0];
  piv[B.HEAD] = [0.5, P.neck, 0];
  piv[B.UARM_L] = [0, P.shoulder, -P.sw];
  piv[B.FARM_L] = [0, P.shoulder - P.uarm, -P.sw];
  piv[B.UARM_R] = [0, P.shoulder, P.sw];
  piv[B.FARM_R] = [0, P.shoulder - P.uarm, P.sw];
  piv[B.THIGH_L] = [0, P.hip, -P.legGap];
  piv[B.SHIN_L] = [0, P.knee, -P.legGap];
  piv[B.THIGH_R] = [0, P.hip, P.legGap];
  piv[B.SHIN_R] = [0, P.knee, P.legGap];
  piv[B.X1] = [0, P.shoulder, 0];
  piv[B.X2] = [0, P.shoulder, 0];
  return { pivots: piv, parents: [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 1, 1] };
}

function buildSoldier(cls) {
  const look = CLASSES[cls].look;
  const vest = look.vest;
  const pb = new PartBuilder();
  for (const s of [-1, 1]) {
    const z = s * P.legGap;
    const t = s < 0 ? B.THIGH_L : B.THIGH_R, sh = s < 0 ? B.SHIN_L : B.SHIN_R;
    pb.add('box', { at: [0, P.knee + (P.hip - P.knee) / 2, z], size: [P.legW * 1.15, P.hip - P.knee + 1, P.legW], color: '#e0e0e0', slot: SLOT.CLOTH, bone: t, taper: [0.9] });
    pb.add('box', { at: [0, P.knee / 2 + 2, z], size: [P.legW, P.knee - 2, P.legW * 0.9], color: '#cfcfcf', slot: SLOT.CLOTH, bone: sh });
    pb.add('box', { at: [0.2, P.knee - 1, z], size: [P.legW * 1.2, 2.2, P.legW * 1.05], color: shadeHex(vest, -0.1), bone: sh }); // knee pad
    pb.add('box', { at: [1.6, 1.6, z], size: [P.legW * 1.7, 3.2, P.legW * 1.1], color: BOOT, bone: sh });
  }
  pb.add('box', { at: [0, P.hip + 1, 0], size: [P.torsoD * 0.95, 5, P.torsoW * 0.85], color: '#d8d8d8', slot: SLOT.CLOTH, bone: B.HIPS });
  pb.add('box', { at: [0, P.hip + 3, 0], size: [P.torsoD * 1.02, 1.6, P.torsoW * 0.88], color: BELT, bone: B.SPINE });
  const ty = P.hip + 3 + P.torsoH / 2;
  pb.add('box', { at: [0, ty, 0], size: [P.torsoD, P.torsoH, P.torsoW * 0.86], color: '#ffffff', slot: SLOT.CLOTH, bone: B.SPINE, taper: [1.05, 1.12] });
  // vest (front + back plates) — the class read from behind as well as the front
  const heavy = cls === 'heavy';
  pb.add('box', { at: [0, ty - 0.5, 0], size: [P.torsoD * (heavy ? 1.3 : 1.18), P.torsoH * 0.82, P.torsoW * (heavy ? 0.95 : 0.9)], color: vest, bone: B.SPINE, taper: [1.02, 1.08] });
  if (cls === 'medic') {
    pb.add('box', { at: [-P.torsoD * 0.62, ty + 1, 0], size: [0.4, 6, 1.8], color: '#ffffff', bone: B.SPINE, ao: 0 });
    pb.add('box', { at: [-P.torsoD * 0.62, ty + 1, 0], size: [0.4, 1.8, 6], color: '#ffffff', bone: B.SPINE, ao: 0 });
  } else if (cls === 'engineer') {
    pb.add('box', { at: [-P.torsoD * 0.75, ty, 0], size: [4, 10, 9], color: '#5d4a32', bone: B.SPINE }); // tool pack
  } else if (cls === 'demo') {
    for (let k = -1; k <= 1; k++) pb.add('cyl6', { at: [P.torsoD * 0.66, ty - 3, k * 3.2], size: [2.2, 4, 2.2], color: '#4a5a2a', bone: B.SPINE }); // grenades on the vest
  } else if (cls === 'soldier') {
    for (let k = -1; k <= 1; k++) pb.add('box', { at: [P.torsoD * 0.68, ty - 3.5, k * 3.6], size: [1.6, 4, 3], color: shadeHex(vest, -0.15), bone: B.SPINE }); // mag pouches
    pb.add('box', { at: [-P.torsoD * 0.72, ty + 0.5, 0], size: [3.5, 11, 10], color: shadeHex(look.outfit, -0.15), bone: B.SPINE }); // pack
  } else if (cls === 'scout') {
    pb.add('box', { at: [-P.torsoD * 0.7, ty + 2, 0], size: [2.4, 8, 7], color: '#3b3226', bone: B.SPINE });
  }
  // head + hat
  const hy = P.neck + 1.5 + P.head[1] / 2;
  pb.add('box', { at: [0.5, P.neck, 0], size: [3.2, 3.5, 3.4], color: '#d8d8d8', slot: SLOT.SKIN, bone: B.HEAD });
  pb.add('box', { at: [1, hy, 0], size: P.head, color: '#ffffff', slot: SLOT.SKIN, bone: B.HEAD, taper: [0.94] });
  pb.add('box', { at: [1 + P.head[0] * 0.5, hy + 0.8, 0], size: [0.4, 1.2, P.head[2] * 0.62], color: '#1a1410', bone: B.HEAD, ao: 0 }); // eye line
  const hat = look.hat;
  if (hat === 'helmet') {
    pb.add('ico1', { at: [0.6, hy + 2.6, 0], size: [9.4, 7.2, 9.0], color: look.outfit, bone: B.HEAD, ao: 0.2 });
    pb.add('box', { at: [0.6, hy + 1.2, 0], size: [9.8, 1.0, 9.4], color: shadeHex(look.outfit, -0.2), bone: B.HEAD });
    pb.add('box', { at: [0.6, hy + 5.4, 0], size: [9.0, 1.2, 1.6], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  } else if (hat === 'cap') {
    pb.add('box', { at: [0.6, hy + 3.4, 0], size: [8, 2.6, 7.6], color: '#f0f0f0', bone: B.HEAD });
    pb.add('box', { at: [5.2, hy + 2.4, 0], size: [4, 0.6, 6.6], color: '#c62828', bone: B.HEAD });
    pb.add('box', { at: [0.6, hy + 4.8, 0], size: [5.6, 0.6, 1.4], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  } else if (hat === 'hardhat') {
    pb.add('ico1', { at: [0.6, hy + 3.2, 0], size: [8.6, 6.4, 8.2], color: '#ffb300', bone: B.HEAD, ao: 0.15 });
    pb.add('box', { at: [0.9, hy + 1.6, 0], size: [11.4, 0.8, 10.2], color: '#f59f00', bone: B.HEAD });
    pb.add('box', { at: [0.6, hy + 6.2, 0], size: [7, 1.0, 1.4], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  } else if (hat === 'bandana') {
    pb.add('box', { at: [1, hy + 2.2, 0], size: [7.6, 2.2, 7.4], color: look.vest === '#004d40' ? '#26a69a' : look.vest, bone: B.HEAD });
    pb.add('box', { at: [-3.4, hy + 1.8, 0], size: [2.2, 1.2, 1.6], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
    pb.add('box', { at: [-4.6, hy + 0.8, 0], size: [2.6, 0.8, 1.2], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  } else if (hat === 'beanie') {
    pb.add('box', { at: [0.6, hy + 3.2, 0], size: [8, 4.4, 7.8], color: '#2a2a2a', bone: B.HEAD, taper: [0.8] });
    pb.add('box', { at: [0.6, hy + 1.6, 0], size: [8.4, 1.6, 8.2], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  } else {
    pb.add('box', { at: [0.2, hy + 3.9, 0], size: [7.2, 1.4, 7], color: '#1f1a14', bone: B.HEAD });
    pb.add('box', { at: [1, hy - 2.6, 0], size: [7.2, 2.4, 7], color: '#2e2418', bone: B.HEAD }); // beard
    pb.add('box', { at: [0.6, hy + 4.4, 0], size: [4, 0.6, 7.2], color: '#ffffff', slot: SLOT.ACCENT, bone: B.HEAD, ao: 0 });
  }
  // arms (hang down; the pose code aims them at the gun)
  for (const s of [-1, 1]) {
    const z = s * P.sw;
    const u = s < 0 ? B.UARM_L : B.UARM_R, f = s < 0 ? B.FARM_L : B.FARM_R;
    pb.add('box', { at: [0, P.shoulder - P.uarm / 2 + 1, z], size: [P.armW * 1.15, P.uarm + 2, P.armW * 1.15], color: '#ffffff', slot: SLOT.CLOTH, bone: u });
    pb.add('box', { at: [0, P.shoulder - 5, z], size: [P.armW * 1.25, 2.4, P.armW * 1.25], color: '#ffffff', slot: SLOT.ACCENT, bone: u, ao: 0 }); // armband
    pb.add('box', { at: [0, P.shoulder - P.uarm - P.farm / 2, z], size: [P.armW * 0.95, P.farm, P.armW * 0.95], color: '#e8e8e8', slot: SLOT.CLOTH, bone: f });
    pb.add('box', { at: [0.3, P.shoulder - P.uarm - P.farm - 1.6, z], size: [P.armW * 1.1, 3.4, P.armW * 0.8], color: GLOVE, bone: f });
  }
  if (heavy) {
    for (const s of [-1, 1]) pb.add('box', { at: [0, P.shoulder + 0.5, s * P.sw], size: [6, 3.4, 5.6], color: vest, bone: s < 0 ? B.UARM_L : B.UARM_R }); // pauldrons
  }
  return pb.build({ rig: true });
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
  // brightest at the lens, fading along the beam; soft at the silhouette edges
  float a = pow(vAlong, 1.6) * smoothstep(0.0, 0.6, vEdge) * uStrength * (1.0 - f);
  // a teammate standing next to the camera put the fat near end of their beam across half
  // the screen as a grey bar: fade the haze out close to the eye
  a *= smoothstep(40.0, 260.0, vDepth);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

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
  const rig = skeleton();
  const bodies = {};
  for (const cls of CLASS_IDS) {
    const inst = new RigInstances(buildSoldier(cls), rig, CAP, { rim: '#b8d0ff', rimStrength: 0.45 });
    inst.mesh.castShadow = high;
    root.add(inst.mesh);
    bodies[cls] = inst;
  }
  const skinCol = {}, outfitCol = {};
  for (const cls of CLASS_IDS) {
    skinCol[cls] = new THREE.Color(SKIN[cls] || '#c68e6a');
    outfitCol[cls] = new THREE.Color(CLASSES[cls].look.outfit);
  }
  const pcol = PLAYER_COLORS.map((c) => new THREE.Color(c));
  const mats = gunMaterials();

  // flashlight cones (instanced, additive)
  const coneGeo = new THREE.CylinderGeometry(58, 3, 300, 16, 1, true);
  coneGeo.rotateZ(HALF_PI);          // axis along X (lens = the narrow bottom end)
  coneGeo.translate(-150, 0, 0);     // lens at the origin, beam toward -X ...
  coneGeo.rotateY(Math.PI);          // ... flipped so the beam runs along +X
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
  const guns = new Map();    // pid → { group, body, glow, weapon }
  let frameNo = 0;
  const _o = { x: 0, y: 0, z: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const nearLights = [];

  function getState(p) {
    let s = state.get(p.id);
    if (!s) {
      s = { x: p.x, y: p.y, a: p.angle || 0, spd: 0, mvA: 0, ph: hash01(p.id) * TAU, shot: 9, melee: 0, seen: 0, sprint: 0, down: 0, dead: 0 };
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
    if (!g) {
      g = { group: new THREE.Group(), body: null, glow: null, weapon: null };
      g.group.rotation.order = 'YXZ';
      root.add(g.group);
      guns.set(pid, g);
    }
    if (g.weapon !== weaponId) {
      if (g.body) g.body.removeFromParent();
      if (g.glow) g.glow.removeFromParent();
      g.body = g.glow = null;
      g.weapon = weaponId;
      if (weaponId) {
        const m = gunModel(weaponId);
        g.body = new THREE.Mesh(m.body, mats.lambert);
        g.body.castShadow = high;
        g.group.add(g.body);
        if (m.glow) { g.glow = new THREE.Mesh(m.glow, mats.glow); g.group.add(g.glow); }
        g.model = m;
      }
    }
    return g;
  }

  function update(view, frame) {
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const time = frame.now || 0;
    const localId = frame.localId || 0;
    const local = frame.local;
    const spectating = !local || local.state === 'dead';
    const roster = frame.roster || [];
    for (const cls of CLASS_IDS) bodies[cls].begin();
    let nc = 0;
    nearLights.length = 0;
    const list = (view && view.players) || [];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (p.id === localId && !(spectating && p.state === 'dead')) {
        hideGun(p.id);
        continue;
      }
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
      // legs cycle with speed; backwards when moving against the aim
      const back = Math.abs(angleDiff(s.a, s.mvA)) > HALF_PI ? -1 : 1;
      s.ph += (s.spd / 64) * TAU * dt * back;

      // The sim lets survivors overlap: a teammate standing in the camera would fill the
      // view from the inside of their own model. Skip them (the name tag fades there too).
      if (Math.hypot(p.x - frame.camX, p.y - frame.camY) < 30) { hideGun(p.id); continue; }
      const inst = bodies[cls];
      const i = inst.push();
      if (i < 0) continue;
      const wid = p.state === 'dead' ? null : heldWeapon(p);
      const style = wid ? WEAPONS[wid].sprite.style : 'rifle';
      const pistolGrip = style === 'pistol' || style === 'revolver' || s.down > 0.5;
      inst.place(i, p.x, 0, p.y, s.a, 1);
      poseSoldier(inst, i, p, s, time, pistolGrip, back);
      inst.color(i, T_SKIN, skinCol[cls], 0);
      inst.color(i, T_CLOTH, outfitCol[cls]);
      inst.color(i, T_ACCENT, color);
      inst.texel(i, T_FX, 0, 0, s.shot < 0.06 ? 0.4 : 0, 1);

      // held gun at the right hand, pointing along the aim
      const g = gunFor(p.id, wid);
      if (wid && g.body) {
        g.group.visible = true;
        const hand = P.shoulder - P.uarm - P.farm - 1.2;
        rigPoint(inst, i, B.FARM_R, [0.6, hand, P.sw], _o);
        g.group.position.set(_o.x, _o.y, _o.z);
        const lower = s.sprint * 0.5 + (p.reloading > 0 ? 0.35 : 0);
        const kick = s.shot < 0.12 ? (1 - s.shot / 0.12) * 0.12 : 0;
        const dual = g.model && g.model.dual;
        g.group.rotation.set(0, -s.a - (dual ? 0.12 : 0), -lower + kick + (s.down > 0.5 ? 0.08 : 0));
        if (p.reloading > 0) g.group.rotation.x = Math.sin(p.reloading * Math.PI) * 0.6;
        else g.group.rotation.x = 0;
        // muzzle for tracers
        g.group.updateMatrixWorld();
        const mz = g.model.muzzle;
        _p.set(mz[0], mz[1], mz[2]).applyMatrix4(g.group.matrixWorld);
        let m = fx.muzzles.get(p.id);
        if (!m) { m = { x: 0, h: 0, y: 0, now: 0 }; fx.muzzles.set(p.id, m); }
        m.x = _p.x; m.h = _p.y; m.y = _p.z; m.now = time;
      } else {
        g.group.visible = false;
      }

      // flashlight cone from the head (alive/downed teammates)
      if (p.state !== 'dead' && nc < CAP) {
        rigPoint(inst, i, B.HEAD, [4.5, P.neck + 3, 0], _o);
        const pitchDown = s.down > 0.5 ? 0.08 : 0.16;
        _e.set(0, -s.a, -pitchDown);
        _q.setFromEuler(_e);
        _p.set(_o.x, _o.y, _o.z);
        _m.compose(_p, _q, _s);
        cones.setMatrixAt(nc++, _m);
        const d2 = (p.x - frame.camX) ** 2 + (p.y - frame.camY) ** 2;
        nearLights.push(d2, p, s);
      }
    }
    for (const cls of CLASS_IDS) bodies[cls].end();
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
    g.group.visible = false;
    if (remove) { g.group.removeFromParent(); guns.delete(pid); }
  }

  function poseSoldier(inst, i, p, s, time, pistolGrip, back) {
    const amp = Math.min(1.2, s.spd / 150);
    const sw = Math.sin(s.ph), cw = Math.cos(s.ph);
    const breathe = Math.sin(time * 2 + p.id) * 0.02;
    const ml = p.meleeing > 0 ? Math.sin(Math.min(1, p.meleeing) * Math.PI) : 0;
    const kick = s.shot < 0.1 ? 1 - s.shot / 0.1 : 0;
    const rl = p.reloading > 0 ? Math.sin(Math.min(1, p.reloading) * Math.PI) : 0;
    // strafe: twist the hips toward the movement direction
    const rel = angleDiff(s.a, s.mvA);
    const twist = amp > 0.1 ? Math.max(-0.5, Math.min(0.5, back > 0 ? rel : angleDiff(s.a + Math.PI, s.mvA))) * 0.6 : 0;
    let hipsX = 0, hipsY = -twist, hipsZ = 0, rootY = Math.abs(sw) * 1.6 * amp, rootX = 0;
    let spineX = 0, spineY = twist, spineZ = -0.08 - s.sprint * 0.3 + breathe - kick * 0.05;
    let headZ = 0.05 + s.sprint * 0.2, headX = 0;
    let thL = sw * 0.6 * amp, thR = -sw * 0.6 * amp;
    let shL = -Math.max(0, Math.sin(s.ph + 1.3)) * 0.9 * amp, shR = -Math.max(0, -Math.sin(s.ph + 1.3)) * 0.9 * amp;
    // arms: aim the gun (rifle hold) / two-hand pistol
    let uaR, faR, uaRX, uaL, faL, uaLX;
    if (pistolGrip) {
      uaR = 1.35 - s.sprint * 0.8; faR = 0.15; uaRX = -0.25;
      uaL = 1.3 - s.sprint * 0.8; faL = 0.2; uaLX = 0.45;
    } else {
      uaR = 0.45 - s.sprint * 0.3 + kick * 0.1; faR = 1.25 + s.sprint * 0.2; uaRX = 0.1;
      uaL = 1.05 - s.sprint * 0.4 - rl * 0.6; faL = 0.55 + rl * 0.5; uaLX = 0.62;
    }
    if (ml > 0) { uaR += ml * 0.6; uaL += ml * 0.8; spineZ -= ml * 0.3; rootX += ml * 3; }
    // downed: fallen back, propped up on the left elbow, pistol held out at the aim
    if (s.down > 0.01) {
      const k = s.down;
      hipsZ = 1.42 * k; rootY = rootY * (1 - k) - (P.hip - 6) * k; rootX = 14 * k;
      spineZ = spineZ * (1 - k) - 0.75 * k; spineY = 0; hipsY = 0;
      headZ = headZ * (1 - k) - 0.55 * k;
      uaR = uaR * (1 - k) + 0.95 * k; faR = faR * (1 - k) + 0.1 * k; uaRX = -0.1;
      uaL = uaL * (1 - k) - 0.2 * k; faL = faL * (1 - k) + 0.9 * k; uaLX = -0.6 * k + uaLX * (1 - k);
      thL = thL * (1 - k) + 0.25 * k + Math.sin(time * 1.5 + p.id) * 0.1 * k; thR = thR * (1 - k) - 0.1 * k;
      shL = shL * (1 - k) - 0.6 * k; shR = shR * (1 - k) - 0.2 * k;
    }
    // dead: flat on the back, limbs splayed
    if (s.dead > 0.01) {
      const k = s.dead;
      hipsZ = 1.5 * k; rootY = -(P.hip - 4.5) * k; rootX = 10 * k;
      spineZ = 0.05 * k; spineY = 0; hipsY = 0; headZ = 0.1 * k; headX = 0.9 * k;
      uaR = 0.3 * k; faR = 0.2 * k; uaRX = 1.2 * k;
      uaL = 1.9 * k; faL = 0.5 * k; uaLX = -1.0 * k;
      thL = 0.1 * k; thR = -0.2 * k; shL = -0.3 * k; shR = -0.1 * k;
    }
    inst.bone(i, B.HIPS, hipsX, hipsY, hipsZ);
    inst.bone(i, B.SPINE, spineX, spineY, spineZ);
    inst.bone(i, B.HEAD, headX, 0, headZ);
    inst.bone(i, B.UARM_L, uaLX, 0, uaL);
    inst.bone(i, B.FARM_L, 0, 0, faL);
    inst.bone(i, B.UARM_R, uaRX, 0, uaR);
    inst.bone(i, B.FARM_R, 0, 0, faR);
    inst.bone(i, B.THIGH_L, 0, 0, thL);
    inst.bone(i, B.SHIN_L, 0, 0, shL);
    inst.bone(i, B.THIGH_R, 0, 0, thR);
    inst.bone(i, B.SHIN_R, 0, 0, shR);
    inst.texel(i, T_ROOT, rootX, rootY, 0, 0);
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
      for (const cls of CLASS_IDS) bodies[cls].mesh.castShadow = high;
      for (const g of guns.values()) if (g.body) g.body.castShadow = high;
    },
    dispose() {
      for (const cls of CLASS_IDS) bodies[cls].dispose();
      coneGeo.dispose();
      coneMat.dispose();
      cones.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}
