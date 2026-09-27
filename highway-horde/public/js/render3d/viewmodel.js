// The first-person gun + hands (ACTORS, SPEC §7.5). It lives in its own scene with its
// own camera and lights, and renderer3d draws it after the world with a cleared depth
// buffer, so it never clips into walls and keeps a fixed FOV whatever the world FOV is.
// Returned object: { scene, camera, update, addEvents, setQuality, dispose, muzzle }.
//
// Guns come from actor-guns.js (one model per weapons.js sprite.style), gloves and
// sleeves are in the local survivor's class outfit colour with a player-colour armband.
// Animation: idle sway + look lag, walk/sprint bob (sprint lowers and tilts), recoil per
// own shot (predicted shots count, echo shots never), reload dip driven by the local
// record's `reloading`, switch lower/raise, melee shove, throw, minigun spin, shotgun
// pump, brass casings, downed pistol held low. The muzzle's world position is published
// to effects3d (fx.localMuzzle) so the local tracers start where the gun visibly is.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { CLASSES } from '../shared/classes.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { gunModel, gunMaterials } from './actor-guns.js';
import { PartBuilder, makeCanvas, damp, angleDiff, shadeHex } from './actor-kit.js';
import { acquireFx, releaseFx } from './fx-core.js';

const HALF_PI = Math.PI / 2;
const VM_FOV = 64;
// Overall size of the held gun on screen. The PLACE scales were tuned in a sandbox at
// 1280x720; in play at 1600x900 a rifle filled the lower-right third of the view and a
// pistol looked like a rifle. Scaling about the firing hand keeps the grip where it was
// and pulls the muzzle back toward it.
const VM_SIZE = 0.74;
// nudge right/down so the barrel stays clear of the crosshair's lower arm
const VM_SHIFT_X = 0.7, VM_SHIFT_Y = -0.2;

// gun origin (the firing hand) in camera space per style, + gun scale
const PLACE = {
  pistol: [5.4, -6.4, -13.5, 1.15], revolver: [5.4, -6.4, -13.5, 1.15], double: [6.2, -7.4, -13.5, 1.15],
  smg: [6.0, -7.2, -13.5, 1.15], dual: [7.2, -6.8, -13.5, 1.15], shotgun: [6.2, -7.6, -13, 1.15], autoshotgun: [6.2, -7.7, -13, 1.15],
  rifle: [6.1, -7.7, -13, 1.15], dmr: [6.1, -7.7, -13, 1.15], sniper: [6.1, -7.9, -13, 1.15], crossbow: [5.8, -8.0, -13, 1.15],
  flamethrower: [6.8, -8.2, -12.5, 1.15], lmg: [6.8, -8.6, -12, 1.15], launcher: [6.8, -8.4, -12.5, 1.15], rocket: [8.6, -6.2, -12, 1.1],
  tesla: [6.4, -8.0, -12.5, 1.15], minigun: [7.2, -10.0, -11.5, 1.15], railgun: [6.4, -8.0, -12.5, 1.15],
};

const GLOVE = '#2b2420', GLOVE_PAD = '#3d342c', CUFF_DARK = -0.25;

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createViewmodel(ctx) {
  const fx = acquireFx(ctx);
  if (!fx.localMuzzle) fx.localMuzzle = { x: 0, h: 0, y: 0, now: -1, valid: false };
  const mats = gunMaterials();

  const scene = new THREE.Scene();
  scene.name = 'viewmodel';
  const camera = new THREE.PerspectiveCamera(VM_FOV, ctx.camera.aspect || 16 / 9, 0.4, 400);
  scene.add(camera);

  // lighting: cool moon fill, warm key from the flashlight side, rim from the front so the
  // silhouette of the gun reads against the dark world
  const hemi = new THREE.HemisphereLight('#9aaad0', '#3a3028', 2.2);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffe8cc', 2.6);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9cc0ff', 1.8);
  rim.position.set(4, 3, -8);
  scene.add(rim);
  const flashLight = new THREE.PointLight('#ffb060', 0, 60, 1.2);
  scene.add(flashLight);

  // hierarchy: holder (sway/bob/recoil/switch) → gunRoot (+X → -Z) → gun meshes + arms
  const holder = new THREE.Group();
  scene.add(holder);
  const gunRoot = new THREE.Group();
  gunRoot.rotation.y = HALF_PI;
  holder.add(gunRoot);
  const leftHolder = new THREE.Group();      // second gun for 'dual'
  scene.add(leftHolder);
  const leftRoot = new THREE.Group();
  leftRoot.rotation.y = HALF_PI;
  leftHolder.add(leftRoot);

  const armMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  let meshes = [];         // current gun meshes (disposable wrappers only; geometry is cached)
  let armMesh = null, armMeshL = null, armGeo = null, armGeoL = null;
  let spinMesh = null, spinMeshL = null, pumpMesh = null, tipMesh = null, glowMesh = null, glowMeshL = null;
  let model = null;
  let curWeapon = null, curLook = '';

  // muzzle flash: two crossed side planes + a camera-facing star, additive
  const flashTexStar = flashTexture(true), flashTexSide = flashTexture(false);
  const flashMatStar = new THREE.MeshBasicMaterial({ map: flashTexStar, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffd8a0' });
  const flashMatSide = new THREE.MeshBasicMaterial({ map: flashTexSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffc080', side: THREE.DoubleSide });
  const flashGroup = new THREE.Group();
  const star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMatStar);
  const sideA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMatSide);
  const sideB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMatSide);
  sideA.rotation.x = HALF_PI;
  sideA.position.x = 0.5;
  sideB.position.x = 0.5;
  const sideGroup = new THREE.Group();
  sideGroup.add(sideA, sideB);
  flashGroup.add(star, sideGroup);
  flashGroup.visible = false;
  scene.add(flashGroup);
  const flashGroupL = flashGroup.clone();
  flashGroupL.visible = false;
  scene.add(flashGroupL);

  // brass casings (camera space)
  const CASINGS = 10;
  const casingGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 6);
  casingGeo.rotateZ(HALF_PI);
  const casingMat = new THREE.MeshPhongMaterial({ color: '#c9a23a', shininess: 80, specular: '#ffe6a0' });
  const shellMat = new THREE.MeshPhongMaterial({ color: '#b3261e', shininess: 40 });
  const casings = [];
  for (let i = 0; i < CASINGS; i++) {
    const m = new THREE.Mesh(casingGeo, casingMat);
    m.visible = false;
    scene.add(m);
    casings.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), age: 9 });
  }
  let casingNext = 0;

  // thrown grenade / molotov in the left hand
  const throwGeo = new THREE.IcosahedronGeometry(1.4, 1);
  const throwMat = new THREE.MeshLambertMaterial({ color: '#3d4a2a' });
  const throwMesh = new THREE.Mesh(throwGeo, throwMat);
  throwMesh.visible = false;
  scene.add(throwMesh);

  // ---- animation state ----
  const st = {
    bobPh: 0, bobAmt: 0, sprint: 0, lastX: NaN, lastY: NaN, speed: 0,
    swayX: 0, swayY: 0, lastYaw: NaN, lastPitch: NaN,
    recoil: 0, recoilRot: 0, recoilRoll: 0, recoilV: 0,
    switchT: 1, switchFrom: null, pending: null,
    throwT: 9, throwKind: 'frag', pumpT: 9, lastShot: -9, spin: 0, spinAngle: 0,
    flashT: 9, flashDual: false, dualSide: 0, down: 0, fireGlow: 0, railCharge: 1,
    visible: false,
  };
  let localId = 0;
  let now = 0;
  let high = ctx.quality !== 'low';
  const muzzleWorld = { x: 0, h: 0, y: 0, valid: false };

  function colorsFor(frame) {
    const r = (frame.roster || []).find((q) => q.id === frame.localId);
    const cls = r && CLASSES[r.cls] ? r.cls : 'soldier';
    const look = CLASSES[cls].look;
    const pc = PLAYER_COLORS[(r && r.color) || 0] || PLAYER_COLORS[0];
    return { outfit: look.outfit, vest: look.vest, band: pc, key: cls + pc };
  }

  function clearGun() {
    for (const m of meshes) m.removeFromParent();
    meshes = [];
    spinMesh = spinMeshL = pumpMesh = tipMesh = glowMesh = glowMeshL = null;
    if (armMesh) { armMesh.removeFromParent(); armGeo.dispose(); armMesh = null; }
    if (armMeshL) { armMeshL.removeFromParent(); armGeoL.dispose(); armMeshL = null; }
  }

  function addGunMeshes(root, m, left) {
    const add = (geo, mat) => {
      if (!geo) return null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      root.add(mesh);
      meshes.push(mesh);
      return mesh;
    };
    add(m.body, mats.body);
    const g = add(m.glow, mats.glow);
    let sp = null;
    if (m.spin) {
      const pivot = new THREE.Group();
      pivot.position.set(m.spinPivot[0], m.spinPivot[1], m.spinPivot[2]);
      root.add(pivot);
      meshes.push(pivot);
      sp = new THREE.Mesh(m.spin, mats.body);
      sp.position.set(-m.spinPivot[0], -m.spinPivot[1], -m.spinPivot[2]);
      const inner = new THREE.Group();
      inner.add(sp);
      pivot.add(inner);
      sp = inner;
    }
    if (!left) {
      pumpMesh = add(m.pump, mats.body);
      tipMesh = add(m.tip, mats.body);
    }
    return { glow: g, spin: sp };
  }

  function buildGun(weaponId, look) {
    clearGun();
    model = gunModel(weaponId);
    const r = addGunMeshes(gunRoot, model, false);
    glowMesh = r.glow; spinMesh = r.spin;
    armGeo = buildArms(model, look, model.dual ? 'right' : 'both');
    armMesh = new THREE.Mesh(armGeo, armMat);
    armMesh.frustumCulled = false;
    gunRoot.add(armMesh);
    leftHolder.visible = model.dual;
    if (model.dual) {
      const l = addGunMeshes(leftRoot, model, true);
      glowMeshL = l.glow; spinMeshL = l.spin;
      armGeoL = buildArms(model, look, 'left');
      armMeshL = new THREE.Mesh(armGeoL, armMat);
      armMeshL.frustumCulled = false;
      leftRoot.add(armMeshL);
    }
    flashGroup.scale.setScalar(model.heavy ? 1.3 : 1);
  }

  function weaponOf(local) {
    if (!local) return null;
    if (local.state === 'downed') {
      const s0 = local.slots && local.slots[0];
      return s0 && WEAPONS[s0] && WEAPONS[s0].category === 'pistol' ? s0 : 'pistol';
    }
    const id = local.slots && local.slots[local.slot];
    return id && WEAPONS[id] ? id : null;
  }

  // ---- events --------------------------------------------------------------------------
  function addEvents(events, opts) {
    if (opts && opts.localId != null) localId = opts.localId;
    if (!events) return;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (!localId || e.pid !== localId) continue;
      if (e.type === 'shot') {
        if (e.echo || e.turret) continue;
        onShot(e.weapon);
      } else if (e.type === 'throw') {
        st.throwT = 0;
        st.throwKind = e.kind;
      }
    }
  }

  function onShot(weaponId) {
    const w = WEAPONS[weaponId];
    if (!w) return;
    const k = Math.min(1, w.recoil * 1.6 + 0.12);
    // a tiny bit of randomness so full-auto fire doesn't look like a metronome
    st.recoilV += k * (0.9 + Math.random() * 0.2);
    st.recoilRoll += (Math.random() - 0.5) * k * 0.12;
    st.lastShot = now;
    st.flashT = 0;
    st.dualSide = model && model.dual ? 1 - st.dualSide : 0;
    st.railCharge = 0;
    if (w.kind === 'hitscan' && w.category === 'shotgun' && model && model.pump) st.pumpT = 0;
    if (w.kind === 'hitscan' && high) ejectCasing(w);
  }

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
  function ejectCasing(w) {
    if (!model || model.style === 'revolver' || model.style === 'double') return;
    const c = casings[casingNext];
    casingNext = (casingNext + 1) % CASINGS;
    const root = model.dual && st.dualSide ? leftRoot : gunRoot;
    root.localToWorld(_v.set(model.length * 0.2, 1.8, model.dual && st.dualSide ? -1 : 1));
    c.m.position.copy(_v);
    c.m.material = w.category === 'shotgun' ? shellMat : casingMat;
    // (camera space: a casing flying at the lens looks fist-sized, so keep them small and
    // throw them sideways and slightly away rather than toward the camera)
    c.m.scale.setScalar(VM_SIZE * 0.7 * (w.category === 'shotgun' ? 1.8 : w.category === 'heavy' || w.category === 'rifle' || w.category === 'sniper' ? 1.25 : 1));
    const side = model.dual && st.dualSide ? -1 : 1;
    c.v.set(side * (11 + Math.random() * 6), 11 + Math.random() * 6, -1 - Math.random() * 3);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.age = 0;
    c.m.visible = true;
  }

  // ---- update --------------------------------------------------------------------------
  function update(view, frame) {
    fx.begin(frame);
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || 0;
    localId = frame.localId || localId;
    const local = frame.local;
    camera.aspect = ctx.camera.aspect || camera.aspect;
    camera.updateProjectionMatrix();
    const alive = local && (local.state === 'alive' || local.state === 'downed');
    const wid = alive ? weaponOf(local) : null;
    st.visible = !!wid;
    holder.visible = st.visible;
    if (!wid) {
      leftHolder.visible = false;
      flashGroup.visible = flashGroupL.visible = false;
      fx.localMuzzle.valid = false;
      muzzleWorld.valid = false;
      return;
    }
    const look = colorsFor(frame);
    // weapon switch: lower the old gun, swap at the bottom, raise the new one
    if (curWeapon === null) {
      curWeapon = wid; curLook = look.key;
      buildGun(wid, look);
      st.switchT = 0.5;
    } else if (wid !== curWeapon && st.pending !== wid) {
      st.pending = wid;
      if (st.switchT >= 0.5) st.switchT = 0;
    }
    st.switchT += dt;
    if (st.pending && st.switchT >= 0.14) {
      curWeapon = st.pending; st.pending = null; curLook = look.key;
      buildGun(curWeapon, look);
      st.switchT = Math.max(st.switchT, 0.14);
    } else if (look.key !== curLook) {
      curLook = look.key;
      buildGun(curWeapon, look);
    }
    const w = WEAPONS[curWeapon];
    const style = model.style;

    // movement bob from the rendered local position
    if (Number.isFinite(st.lastX) && dt > 0) {
      const d = Math.hypot(local.x - st.lastX, local.y - st.lastY);
      const v = d > 80 ? 0 : d / dt;
      st.speed += (v - st.speed) * damp(8, dt);
    }
    st.lastX = local.x; st.lastY = local.y;
    const moving = Math.min(1, st.speed / 160);
    st.bobAmt += (moving - st.bobAmt) * damp(6, dt);
    st.bobPh += dt * (st.speed / 190) * Math.PI * 2 * 1.05;
    const sprinting = local.sprinting && st.speed > 60 ? 1 : 0;
    st.sprint += (sprinting - st.sprint) * damp(8, dt);
    const downed = local.state === 'downed' ? 1 : 0;
    st.down += (downed - st.down) * damp(5, dt);

    // look lag: the gun trails camera rotation a little
    const yaw = frame.yaw || 0, pitch = frame.pitch || 0;
    if (Number.isFinite(st.lastYaw) && dt > 0) {
      const dy = angleDiff(st.lastYaw, yaw), dp = pitch - st.lastPitch;
      st.swayX += (-dy * 12 - st.swayX) * damp(10, dt);
      st.swayY += (dp * 12 - st.swayY) * damp(10, dt);
    }
    st.lastYaw = yaw; st.lastPitch = pitch;
    st.swayX *= 1 - damp(6, dt);
    st.swayY *= 1 - damp(6, dt);

    // recoil spring (kick velocity → offset, critically damped back)
    st.recoil += st.recoilV;
    st.recoilV = 0;
    st.recoil *= 1 - damp(w && w.rate > 8 ? 16 : 11, dt);
    st.recoilRoll *= 1 - damp(10, dt);
    const rc = Math.min(1.6, st.recoil);

    // reload dip (local.reloading 0..1)
    const rl = local.reloading > 0 ? local.reloading : 0;
    const rlShape = rl > 0 ? Math.sin(Math.min(1, rl) * Math.PI) : 0;

    // melee shove
    const ml = local.meleeing > 0 ? Math.sin(Math.min(1, local.meleeing) * Math.PI) : 0;
    // switch lower/raise: 0..0.14 lowering, 0.14..0.4 raising
    let sw = 0;
    if (st.switchT < 0.14) sw = st.switchT / 0.14;
    else if (st.switchT < 0.4) sw = 1 - (st.switchT - 0.14) / 0.26;
    sw = sw * sw * (3 - 2 * sw);
    // throw: gun dips right while the left hand lobs
    st.throwT += dt;
    const th = st.throwT < 0.55 ? Math.sin((st.throwT / 0.55) * Math.PI) : 0;

    const P = PLACE[style] || PLACE.rifle;
    const t = now;
    const idleX = Math.sin(t * 1.1) * 0.12, idleY = Math.sin(t * 1.7) * 0.1;
    const bobA = st.bobAmt * (1 + st.sprint * 0.8);
    const bobX = Math.sin(st.bobPh) * 0.45 * bobA, bobY = -Math.abs(Math.cos(st.bobPh)) * 0.4 * bobA;
    const heavyK = model.heavy ? 0.75 : 1;
    let x = P[0] + VM_SHIFT_X + idleX + bobX + st.swayX * 0.6 - st.sprint * 1.5 - ml * 2.5 + th * 1.5;
    let y = P[1] + VM_SHIFT_Y + idleY + bobY + st.swayY * 0.5 - st.sprint * 1.6 - sw * 9 - rlShape * 2.2 - th * 3 - st.down * 2.5;
    let z = P[2] + rc * 2.4 * heavyK - ml * 3 + st.sprint * 1.2;
    holder.position.set(x, y, z);
    holder.rotation.set(
      rc * 0.16 * heavyK - st.sprint * 0.35 + rlShape * 0.25 - sw * 0.6 + st.swayY * 0.02,
      -0.04 + st.swayX * 0.03 + st.sprint * 0.7 + ml * 0.6 - th * 0.3,
      st.recoilRoll + rlShape * 0.55 + st.sprint * 0.2 + st.down * 0.35 + Math.sin(st.bobPh) * 0.02 * bobA,
      'YXZ');
    holder.scale.setScalar(P[3] * VM_SIZE);
    leftHolder.scale.setScalar(P[3] * VM_SIZE);
    if (model.dual) {
      leftHolder.visible = true;
      const kL = st.dualSide === 0 ? rc * 0.3 : rc;
      leftHolder.position.set(-P[0] - VM_SHIFT_X - idleX + bobX + st.swayX * 0.6 + st.sprint * 1.2, y + (st.dualSide ? 0 : 0.2), P[2] + kL * 2.2);
      leftHolder.rotation.set(kL * 0.16 - st.sprint * 0.35 + rlShape * 0.25 - sw * 0.6, 0.04 + st.swayX * 0.03 - st.sprint * 0.7, -st.recoilRoll - rlShape * 0.55, 'YXZ');
    }

    // shotgun pump: back and forward shortly after each shot
    st.pumpT += dt;
    if (pumpMesh) {
      const k = st.pumpT > 0.12 && st.pumpT < 0.42 ? Math.sin(((st.pumpT - 0.12) / 0.3) * Math.PI) : 0;
      pumpMesh.position.x = -k * 4;
    }
    // rocket tip only while loaded
    if (tipMesh) {
      const mag = local.ammo && local.ammo[local.slot] ? local.ammo[local.slot][0] : 1;
      tipMesh.visible = mag > 0 && rl < 0.6;
    }
    // minigun spin
    st.spin += ((local.spin || 0) - st.spin) * damp(4, dt);
    st.spinAngle += st.spin * dt * 38;
    if (spinMesh) spinMesh.rotation.x = st.spinAngle;
    if (spinMeshL) spinMeshL.rotation.x = st.spinAngle;
    // glowing parts: tesla pulse, railgun recharge, pilot light flicker
    st.railCharge = Math.min(1, st.railCharge + dt * (w ? w.rate : 1));
    if (glowMesh) {
      let s = 1;
      if (style === 'tesla') s = 0.9 + Math.sin(t * 14) * 0.08 + (now - st.lastShot < 0.15 ? 0.25 : 0);
      else if (style === 'flamethrower') s = 0.8 + Math.random() * 0.4;
      else if (style === 'railgun') s = 0.5 + st.railCharge * 0.5;
      glowMesh.scale.setScalar(1);
      mats.glow.color.setScalar(s);
    } else {
      mats.glow.color.setScalar(1);
    }

    // muzzle flash
    st.flashT += dt;
    const showFlash = st.flashT < 0.055 && w && w.kind !== 'flame' && w.kind !== 'chain' && w.projectile?.kind !== 'bolt';
    placeFlash(flashGroup, gunRoot, showFlash && (!model.dual || st.dualSide === 0), w);
    placeFlash(flashGroupL, leftRoot, showFlash && model.dual && st.dualSide === 1, w);
    const flameOn = w && w.kind === 'flame' && local.firing;
    flashLight.intensity = showFlash ? 260 * (model.heavy ? 1.3 : 1) : flameOn ? 90 + Math.random() * 50 : 0;
    flashLight.color.set(w && w.kind === 'chain' ? '#80d8ff' : style === 'railgun' ? '#b388ff' : '#ffb060');
    if (w && w.kind === 'chain' && now - st.lastShot < 0.08) flashLight.intensity = 180;
    if (style === 'railgun' && now - st.lastShot < 0.12) flashLight.intensity = 260;

    // throw animation: grenade arcs from the lower left out of view
    if (st.throwT < 0.55) {
      const k = st.throwT / 0.55;
      throwMesh.visible = k < 0.8;
      throwMat.color.set(st.throwKind === 'molotov' ? '#7a5a2a' : '#3d4a2a');
      throwMesh.position.set(-6 + k * 7, -7 + Math.sin(k * Math.PI) * 9, -10 - k * 14);
      throwMesh.rotation.set(k * 8, k * 5, 0);
    } else {
      throwMesh.visible = false;
    }

    // casings
    for (const c of casings) {
      if (c.age > 1) continue;
      c.age += dt;
      if (c.age > 0.7) { c.m.visible = false; c.age = 9; continue; }
      c.v.y -= 90 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
    }

    publishMuzzle(frame);
  }

  function placeFlash(group, root, on, w) {
    group.visible = !!on;
    if (!on || !model) return;
    root.updateWorldMatrix(true, false);
    root.localToWorld(_v.set(model.muzzle[0], model.muzzle[1], model.muzzle[2]));
    root.localToWorld(_v2.set(model.muzzle[0] + 10, model.muzzle[1], model.muzzle[2]));
    group.position.copy(_v);
    // side planes along the barrel, star facing the camera
    _v2.sub(_v).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), _v2);
    const k = w && w.category === 'shotgun' ? 1.5 : w && (w.category === 'pistol' || w.category === 'smg') ? 0.85 : 1.15;
    const s = (11 + Math.random() * 4) * k * VM_SIZE;
    sideGroup.quaternion.copy(_q);
    sideGroup.rotateX(Math.random() * Math.PI);
    sideGroup.scale.set(s * 1.6, s * 0.7, s * 0.7);
    group.children[0].scale.setScalar(s * (0.9 + Math.random() * 0.3));
    group.children[0].rotation.z = Math.random() * Math.PI;
    if (group === flashGroupL) {
      group.children[1].quaternion.copy(sideGroup.quaternion);
      group.children[1].scale.copy(sideGroup.scale);
    }
    flashLight.position.copy(_v);
  }

  // Where the muzzle appears on screen, placed at the same distance in the world: the
  // viewmodel camera sits at the world camera, looking the same way, with its own FOV.
  const _ndc = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3();
  function publishMuzzle(frame) {
    if (!model) return;
    const root = model.dual && st.dualSide ? leftRoot : gunRoot;
    root.updateWorldMatrix(true, false);
    root.localToWorld(_v.set(model.muzzle[0], model.muzzle[1], model.muzzle[2]));
    const dist = _v.length();
    _ndc.copy(_v).project(camera);
    const wc = ctx.camera;
    wc.updateMatrixWorld();
    _dir.set(_ndc.x, _ndc.y, 0.5).unproject(wc);
    wc.getWorldPosition(_cam);
    _dir.sub(_cam).normalize();
    const p = _cam.addScaledVector(_dir, Math.max(8, dist));
    fx.localMuzzle.x = p.x; fx.localMuzzle.h = p.y; fx.localMuzzle.y = p.z;
    fx.localMuzzle.now = frame.now || 0;
    fx.localMuzzle.valid = true;
    muzzleWorld.x = p.x; muzzleWorld.h = p.y; muzzleWorld.y = p.z; muzzleWorld.valid = true;
  }

  return {
    scene,
    camera,
    update,
    addEvents,
    /** World position of the muzzle as seen on screen (x, y = sim plane, h = height). */
    muzzle: muzzleWorld,
    setQuality(q) { high = q !== 'low'; },
    dispose() {
      clearGun();
      armMat.dispose();
      flashTexStar.dispose(); flashTexSide.dispose();
      flashMatStar.dispose(); flashMatSide.dispose();
      star.geometry.dispose(); sideA.geometry.dispose(); sideB.geometry.dispose();
      casingGeo.dispose(); casingMat.dispose(); shellMat.dispose();
      throwGeo.dispose(); throwMat.dispose();
      releaseFx(ctx);
    },
  };
}

// ---------------------------------------------------------------------------------------

/**
 * Gloved hands + sleeves in gun space. The right hand wraps the grip at the origin; the
 * left hand holds the front grip (or cups the pistol grip). Forearms run back and down
 * out of the bottom corners of the screen.
 * @param {'both'|'right'|'left'} which
 */
function buildArms(model, look, which) {
  const pb = new PartBuilder();
  const outfit = look.outfit, cuff = shadeHex(look.outfit, CUFF_DARK), band = look.band;
  const limb = (a, b, r0, r1, color) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const geo = new THREE.CylinderGeometry(r1, r0, 1, 8);
    pb.add(geo, { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: [e.x, e.y, e.z], size: [1, L, 1], color, ao: 0.1 });
    geo.dispose();
  };
  const fist = (x, y, z, side, rotZ = 0) => {
    pb.add('box', { at: [x - 0.2, y - 1.0, z], rot: [0, 0, rotZ], size: [2.6, 3.2, 2.3], color: GLOVE, ao: 0.3 });           // palm + fingers
    pb.add('box', { at: [x + 0.9, y - 1.0, z], rot: [0, 0, rotZ], size: [0.9, 3.0, 2.4], color: GLOVE_PAD, ao: 0.2 });       // knuckles
    pb.add('box', { at: [x - 0.6, y + 0.4, z - side * 1.2], rot: [0.3 * side, 0, rotZ + 0.4], size: [2.4, 0.9, 0.9], color: GLOVE, ao: 0 }); // thumb
  };
  const rightHand = which !== 'left';
  const leftHand = which !== 'right';
  const two = model.twoHanded;
  if (rightHand || which === 'left') {
    // the firing hand (for 'left' it is the mirrored left gun's hand)
    const s = which === 'left' ? -1 : 1;
    fist(0, 0, 0, s);
    const wrist = [-1.4, -2.0, 0.2 * s];
    const elbow = [-7.5, -10, 4.5 * s];
    limb(wrist, [-2.4, -2.8, 0.6 * s], 1.25, 1.35, GLOVE);
    limb([-2.2, -2.7, 0.5 * s], [-3.4, -3.6, 1.1 * s], 1.55, 1.6, cuff);
    limb([-3.2, -3.5, 1.0 * s], elbow, 1.6, 2.1, outfit);
    limb([-4.6, -4.8, 1.6 * s], [-5.3, -5.6, 2.0 * s], 1.8, 1.85, band);
  }
  if (leftHand && which === 'both') {
    let hand, elbow;
    if (two) {
      hand = model.front;
      elbow = [hand[0] - 9, -13, -7];
      fist(hand[0], hand[1], hand[2] - 0.3, -1, -0.25);
    } else {
      // support hand cupping the pistol grip from below
      hand = [0.2, -2.6, -1.4];
      elbow = [-6.5, -11, -6];
      pb.add('box', { at: [0.2, -3.0, -1.3], rot: [0.3, 0, 0], size: [2.6, 2.4, 2.2], color: GLOVE });
      pb.add('box', { at: [1.0, -2.2, -0.2], rot: [0, 0, -0.2], size: [0.9, 2.6, 1.4], color: GLOVE_PAD });
    }
    const wrist = [hand[0] - 1.2, hand[1] - 2.1, hand[2] - 0.3];
    limb(wrist, [wrist[0] - 1.1, wrist[1] - 0.9, wrist[2] - 0.5], 1.2, 1.3, GLOVE);
    limb([wrist[0] - 0.9, wrist[1] - 0.8, wrist[2] - 0.4], [wrist[0] - 2.2, wrist[1] - 1.8, wrist[2] - 1.0], 1.5, 1.55, cuff);
    limb([wrist[0] - 2.0, wrist[1] - 1.7, wrist[2] - 0.9], elbow, 1.55, 2.1, outfit);
  }
  return pb.build();
}

/** Procedural muzzle-flash textures (front star / side tongue). */
function flashTexture(starShape) {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.globalCompositeOperation = 'lighter';
  if (starShape) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.3);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,220,160,0.7)');
    gr.addColorStop(1, 'rgba(255,160,60,0)');
    g.fillStyle = gr;
    g.fillRect(-S / 2, -S / 2, S, S);
    for (let k = 0; k < 7; k++) {
      g.save();
      g.rotate((k / 7) * Math.PI * 2 + (k % 2) * 0.3);
      const L = S * (k % 2 ? 0.34 : 0.48);
      const lg = g.createLinearGradient(0, 0, L, 0);
      lg.addColorStop(0, 'rgba(255,240,200,1)');
      lg.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, -S * 0.05); g.lineTo(L, 0); g.lineTo(0, S * 0.05);
      g.fill();
      g.restore();
    }
  } else {
    // side view: hot base at the left edge flaring out to the right
    for (let k = 0; k < 3; k++) {
      const lg = g.createLinearGradient(-S / 2, 0, S / 2, 0);
      lg.addColorStop(0, 'rgba(255,250,220,1)');
      lg.addColorStop(0.5, 'rgba(255,190,90,0.6)');
      lg.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = lg;
      const w = S * (0.2 - k * 0.05);
      g.beginPath();
      g.moveTo(-S / 2, -w * 0.4);
      g.quadraticCurveTo(0, -w * 1.3, S / 2, (k - 1) * S * 0.05);
      g.quadraticCurveTo(0, w * 1.3, -S / 2, w * 0.4);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
