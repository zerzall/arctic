// The first-person gun + hands (ACTORS, SPEC §7.5). It lives in its own scene with its
// own camera and lights, and renderer3d draws it after the world with a cleared depth
// buffer, so it never clips into walls and keeps a fixed FOV whatever the world FOV is.
// Returned object: { scene, camera, update, addEvents, setQuality, dispose, muzzle }.
//
// Guns come from actor-guns.js (detailed PBR models with moving parts) and reflect a
// small procedural night studio (actor-tex.js). Gloved hands with fingers are sculpted
// per grip (actor-shape.js): the firing hand round the pistol grip with the index finger
// on the trigger, the support hand under the handguard, round a vertical foregrip or
// cupping a pistol hand; sleeves in the class outfit colour with the player's colour on
// the armband.
//
// Animation: idle sway + look lag, walk/sprint bob (sprint tilts the gun), a jump dip on
// take-off and a heavier one on landing (a spring; no bob in the air), recoil kick
// with the slide/bolt cycling on each own shot (predicted shots count, echo shots never),
// brass/shell casings, a real reload driven by the local record's `reloading` (magazine
// drops out, the support hand brings a fresh one and racks the bolt; shotgun shells one
// by one; the double breaks open; revolver and launcher cylinders swing out; the RPG gets
// a new warhead; the crossbow is drawn and loaded), weapon switch lower/raise, melee
// shove, grenade throw with the support arm, minigun spin-up, flamethrower pilot light,
// glowing tesla coils / rail channel. Muzzle flash: layered star + side tongues + core in
// HDR (blooms) with a short light. The muzzle's world position is published to effects3d
// (fx.localMuzzle) so the local tracers start where the gun visibly is.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { CLASSES } from '../shared/classes.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { gunObject, gunModel, gunMaterials, createGunMaterial } from './actor-guns.js';
import { makeCanvas, damp, angleDiff, shadeHex, capLuma } from './actor-kit.js';
import { ShapeBuilder, SLOT, MAT, lineRings } from './actor-shape.js';
import { actorTextures, viewmodelEnvTexture } from './actor-tex.js';
import { acquireFx, releaseFx } from './fx-core.js';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const VM_FOV = 64;
// Jump reaction of the held gun: downward kicks (units/s) on take-off and landing and the
// spring (1/s², 1/s) that brings it back: ~0.5 and ~1 units of dip.
const JUMP_TAKEOFF_KICK = 11;
const JUMP_LAND_KICK = 22;
const JUMP_SPRING_K = 130;
const JUMP_SPRING_C = 14;
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

const GLOVE = '#2a241f', GLOVE_PAD = '#3b332b', GLOVE_STRAP = '#1a1714';

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createViewmodel(ctx) {
  const fx = acquireFx(ctx);
  if (!fx.localMuzzle) fx.localMuzzle = { x: 0, h: 0, y: 0, now: -1, valid: false };
  let high = ctx.quality !== 'low';

  const scene = new THREE.Scene();
  scene.name = 'viewmodel';
  const camera = new THREE.PerspectiveCamera(VM_FOV, ctx.camera.aspect || 16 / 9, 0.4, 400);
  scene.add(camera);

  // lighting: cool moon fill, warm key from the flashlight side, rim from the front so the
  // silhouette of the gun reads against the dark world; reflections from a night studio
  const hemi = new THREE.HemisphereLight('#9aaad0', '#3a3028', 1.2);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffe8cc', 2.3);
  key.position.set(-3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9cc0ff', 1.6);
  rim.position.set(4, 3, -8);
  scene.add(rim);
  const flashLight = new THREE.PointLight('#ffb060', 0, 70, 1.2);
  scene.add(flashLight);
  const envTex = viewmodelEnvTexture();
  const atlas = gunMaterials().atlas;
  const gunMat = createGunMaterial(atlas, { envMap: envTex, envIntensity: 1.1 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) });
  const actorTex = actorTextures(high ? 8 : 4);
  const handMat = makeHandMaterial(actorTex, envTex);

  // hierarchy: holder (sway/bob/recoil/switch) → gunRoot (+X → -Z) → gun + arms
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

  let gun = null, gunL = null;        // gunObject groups
  let model = null;
  let rightArm = null, leftArm = null, leftArmL = null, leftPivot = null, leftRest = new THREE.Vector3();
  let armGeos = [];
  let curWeapon = null, curLook = '';

  // ---- muzzle flash: camera-facing star + crossed side tongues + hot core (HDR, additive) ----
  const flashTex = { star: flashTexture('star'), side: flashTexture('side'), core: flashTexture('core') };
  const mkFlashMat = (map, color) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color, side: THREE.DoubleSide });
  const flashMats = { star: mkFlashMat(flashTex.star, new THREE.Color(3.2, 2.3, 1.3)), side: mkFlashMat(flashTex.side, new THREE.Color(3.0, 1.9, 0.9)), core: mkFlashMat(flashTex.core, new THREE.Color(4.0, 3.6, 3.0)) };
  const quad = new THREE.PlaneGeometry(1, 1);
  function makeFlash() {
    const g = new THREE.Group();
    const star = new THREE.Mesh(quad, flashMats.star);
    const core = new THREE.Mesh(quad, flashMats.core);
    const sides = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(quad, flashMats.side);
      m.position.x = 0.5;
      m.rotation.x = (k / 3) * Math.PI;
      sides.add(m);
    }
    g.add(sides, star, core);
    g.visible = false;
    g.renderOrder = 20;
    scene.add(g);
    return { g, star, core, sides };
  }
  const flashR = makeFlash(), flashL = makeFlash();

  // muzzle smoke wisps after shots (alpha-blended, camera space)
  const smokeTex = flashTexture('smoke');
  const smokeMat = new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: '#9a968e', opacity: 0 });
  const smokes = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(quad, smokeMat.clone());
    m.visible = false;
    scene.add(m);
    smokes.push({ m, age: 9, v: new THREE.Vector3() });
  }
  let smokeNext = 0;

  // ---- casings (camera space) ----
  const casingGeo = casingGeometry('rifle'), pistolCaseGeo = casingGeometry('pistol'), shellGeo = casingGeometry('shell');
  const brassMat = new THREE.MeshStandardMaterial({ color: '#d4a84a', metalness: 1, roughness: 0.28, envMap: envTex });
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.4, envMap: envTex });
  const CASINGS = 12;
  const casings = [];
  for (let i = 0; i < CASINGS; i++) {
    const m = new THREE.Mesh(casingGeo, brassMat);
    m.visible = false;
    scene.add(m);
    casings.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), age: 9 });
  }
  let casingNext = 0;

  // things the support hand carries: a fresh round/shell, a grenade or molotov
  const carry = new THREE.Group();
  scene.add(carry);
  const shellInHand = new THREE.Mesh(shellGeo, shellMat);
  const roundInHand = new THREE.Mesh(casingGeo, brassMat);
  const fragGeo = new THREE.SphereGeometry(1.35, 14, 10);
  const fragMat = new THREE.MeshStandardMaterial({ color: '#3d4a2a', roughness: 0.6, metalness: 0.3 });
  const grenade = new THREE.Mesh(fragGeo, fragMat);
  carry.add(shellInHand, roundInHand, grenade);
  carry.visible = false;

  // ---- animation state ----
  const st = {
    bobPh: 0, bobAmt: 0, sprint: 0, lastX: NaN, lastY: NaN, speed: 0,
    swayX: 0, swayY: 0, lastYaw: NaN, lastPitch: NaN,
    recoil: 0, recoilRoll: 0, recoilV: 0, slideT: 9, locked: false,
    switchT: 1, pending: null,
    throwT: 9, throwKind: 'frag', pumpT: 9, lastShot: -9, spin: 0, spinAngle: 0, cylA: 0, cylTarget: 0,
    flashT: 9, dualSide: 0, down: 0, railCharge: 1, rlPrev: 0, ejected: false, boltT: 9,
    visible: false, lastZ: 0, air: 0, jumpY: 0, jumpV: 0,
  };
  let localId = 0;
  let now = 0;
  const muzzleWorld = { x: 0, h: 0, y: 0, valid: false };

  function colorsFor(frame) {
    const r = (frame.roster || []).find((q) => q.id === frame.localId);
    const cls = r && CLASSES[r.cls] ? r.cls : 'soldier';
    const look = CLASSES[cls].look;
    const pc = PLAYER_COLORS[(r && r.color) || 0] || PLAYER_COLORS[0];
    // near-white outfits (the medic) are toned down so the sleeves don't glow under lights
    const outfit = '#' + capLuma(new THREE.Color(look.outfit), 0.34).getHexString();
    return { outfit, vest: look.vest, band: pc, key: cls + pc };
  }

  function clearGun() {
    if (gun) { gun.removeFromParent(); gun = null; }
    if (gunL) { gunL.removeFromParent(); gunL = null; }
    for (const m of [rightArm, leftArm, leftArmL]) if (m) m.removeFromParent();
    if (leftPivot) leftPivot.removeFromParent();
    rightArm = leftArm = leftArmL = leftPivot = null;
    for (const g of armGeos) g.dispose();
    armGeos = [];
  }

  function buildGun(weaponId, look) {
    clearGun();
    model = gunModel(weaponId);
    gun = gunObject(weaponId, { material: gunMat, glowMaterial: glowMat });
    gunRoot.add(gun);
    const arms = buildArms(model, look);
    armGeos.push(arms.right, arms.left);
    rightArm = new THREE.Mesh(arms.right, handMat);
    rightArm.frustumCulled = false;
    gunRoot.add(rightArm);
    // the support arm pivots about its hand so it can leave the gun (reload, throw)
    leftRest.fromArray(arms.leftHand);
    leftPivot = new THREE.Group();
    leftPivot.position.copy(leftRest);
    leftArm = new THREE.Mesh(arms.left, handMat);
    leftArm.position.copy(leftRest).negate();
    leftArm.frustumCulled = false;
    leftPivot.add(leftArm);
    gunRoot.add(leftPivot);
    leftHolder.visible = model.dual;
    if (model.dual) {
      gunL = gunObject(weaponId, { material: gunMat, glowMaterial: glowMat, mirror: true });
      leftRoot.add(gunL);
      const la = buildArms(model, look, true);
      armGeos.push(la.right);
      leftArmL = new THREE.Mesh(la.right, handMat);
      leftArmL.scale.z = -1;
      leftArmL.frustumCulled = false;
      leftRoot.add(leftArmL);
    }
    st.cylA = st.cylTarget = 0;
    st.slideT = 9;
    st.locked = false;
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
    // a little randomness so full-auto fire doesn't look like a metronome
    st.recoilV += k * (0.9 + Math.random() * 0.2);
    st.recoilRoll += (Math.random() - 0.5) * k * 0.12;
    st.lastShot = now;
    st.flashT = 0;
    st.dualSide = model && model.dual ? 1 - st.dualSide : 0;
    st.railCharge = 0;
    st.slideT = 0;
    st.boltT = 0;
    if (model && model.reload === 'shells') st.pumpT = 0;
    if (model && (model.style === 'revolver' || model.style === 'launcher')) st.cylTarget += TAU / 6;
    if (w.kind === 'hitscan' && model && model.casing && model.style !== 'revolver' && model.style !== 'double') {
      // bolt-actions eject when the bolt is worked; the pump ejects on the pump stroke
      if (!model.boltAction && model.reload !== 'shells') ejectCasing(model.casing, model.dual && st.dualSide);
    }
    if (high && smokes.length) puffSmoke();
  }

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _X = new THREE.Vector3(1, 0, 0);
  function ejectCasing(kind, left) {
    if (!model) return;
    const c = casings[casingNext];
    casingNext = (casingNext + 1) % CASINGS;
    const root = left ? leftRoot : gunRoot;
    const e = model.eject;
    root.localToWorld(_v.set(e[0], e[1], left ? -e[2] : e[2]));
    c.m.position.copy(_v);
    c.m.geometry = kind === 'shell' ? shellGeo : kind === 'pistol' ? pistolCaseGeo : casingGeo;
    c.m.material = kind === 'shell' ? shellMat : brassMat;
    // camera space: a casing flying at the lens looks fist-sized, so keep them small and
    // throw them sideways and slightly away rather than toward the camera
    c.m.scale.setScalar(VM_SIZE * (kind === 'shell' ? 0.72 : 0.85));
    const side = left ? -1 : 1;
    c.v.set(side * (12 + Math.random() * 6), 10 + Math.random() * 7, -2 - Math.random() * 3);
    c.spin.set(Math.random() * 18, Math.random() * 18, 8 + Math.random() * 18);
    c.m.quaternion.copy(root.getWorldQuaternion(_q));
    c.age = 0;
    c.m.visible = true;
  }

  function puffSmoke() {
    const s = smokes[smokeNext];
    smokeNext = (smokeNext + 1) % smokes.length;
    s.age = 0;
    s.pending = true;
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
    carry.visible = false;
    if (!wid) {
      leftHolder.visible = false;
      flashR.g.visible = flashL.g.visible = false;
      flashLight.intensity = 0;
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
    // jump: the gun lags the body — it dips on take-off and drops harder on landing, then
    // springs back; in the air it floats a little higher with no walk bob
    const jz = local.z > 0 ? local.z : 0;
    if (st.lastZ <= 0 && jz > 0) st.jumpV -= JUMP_TAKEOFF_KICK;
    else if (st.lastZ > 0 && jz <= 0) st.jumpV -= JUMP_LAND_KICK;
    st.lastZ = jz;
    st.air += ((jz > 0 ? 1 : 0) - st.air) * damp(10, dt);
    for (let left = dt; left > 1e-6;) {
      const h = Math.min(left, 1 / 120);
      st.jumpV += (-JUMP_SPRING_K * st.jumpY - JUMP_SPRING_C * st.jumpV) * h;
      st.jumpY += st.jumpV * h;
      left -= h;
    }

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

    // recoil spring (kick velocity → offset, damped back)
    st.recoil += st.recoilV;
    st.recoilV = 0;
    st.recoil *= 1 - damp(w && w.rate > 8 ? 16 : 11, dt);
    st.recoilRoll *= 1 - damp(10, dt);
    const rc = Math.min(1.6, st.recoil);

    // reload (local.reloading 0..1): the whole gun tilts in, parts do the work
    const rl = local.reloading > 0 ? Math.min(1, local.reloading) : 0;
    const rlShape = rl > 0 ? Math.sin(rl * Math.PI) : 0;
    const rlTilt = rl > 0 ? smoothPulse(rl, 0.04, 0.16, 0.86, 0.97) : 0;

    // melee shove
    const ml = local.meleeing > 0 ? Math.sin(Math.min(1, local.meleeing) * Math.PI) : 0;
    // switch lower/raise: 0..0.14 lowering, 0.14..0.4 raising
    let sw = 0;
    if (st.switchT < 0.14) sw = st.switchT / 0.14;
    else if (st.switchT < 0.4) sw = 1 - (st.switchT - 0.14) / 0.26;
    sw = sw * sw * (3 - 2 * sw);
    // throw: the gun dips right while the support arm lobs
    st.throwT += dt;
    const thK = st.throwT < 0.7 ? Math.sin((st.throwT / 0.7) * Math.PI) : 0;

    const P = PLACE[style] || PLACE.rifle;
    const t = now;
    const idleX = Math.sin(t * 1.1) * 0.12, idleY = Math.sin(t * 1.7) * 0.1;
    const bobA = st.bobAmt * (1 + st.sprint * 0.8) * (1 - st.air);
    const bobX = Math.sin(st.bobPh) * 0.45 * bobA, bobY = -Math.abs(Math.cos(st.bobPh)) * 0.4 * bobA;
    const heavyK = model.heavy ? 0.75 : 1;
    // reload: the gun comes up a little toward the middle, canted clockwise so the mag
    // well / loading port / chambers face the camera and the support hand's work shows.
    // Kept small: a yawed rifle shows its whole length and reads twice its size, and
    // pushed a touch away so the canted gun keeps its on-screen size.
    const rlUp = model.reload === 'rocket' ? 0.4 : 1;
    const x = P[0] + VM_SHIFT_X + idleX + bobX + st.swayX * 0.6 - st.sprint * 1.5 - ml * 2.5 + thK * 1.5 - rlTilt * 1.3 * rlUp;
    const y = P[1] + VM_SHIFT_Y + idleY + bobY + st.swayY * 0.5 - st.sprint * 1.6 - sw * 9 + rlTilt * 1.0 * rlUp - thK * 2.5 - st.down * 2.5
      + st.jumpY + st.air * 0.35;
    const z = P[2] + rc * 2.4 * heavyK - ml * 3 + st.sprint * 1.2 - rlTilt * 0.8;
    holder.position.set(x, y, z);
    holder.rotation.set(
      rc * 0.16 * heavyK - st.sprint * 0.35 + rlTilt * 0.12 - sw * 0.6 + st.swayY * 0.02 + st.jumpY * 0.05 - st.air * 0.04,
      -0.04 + st.swayX * 0.03 + st.sprint * 0.7 + ml * 0.6 - thK * 0.3 + rlTilt * 0.17 * rlUp,
      st.recoilRoll - rlTilt * (model.reload === 'shells' ? 0.95 : model.reload === 'mag' ? 0.7 : 0.45) + st.sprint * 0.2 + st.down * 0.35 + Math.sin(st.bobPh) * 0.02 * bobA,
      'YXZ');
    holder.scale.setScalar(P[3] * VM_SIZE);
    leftHolder.scale.setScalar(P[3] * VM_SIZE);
    if (model.dual) {
      leftHolder.visible = true;
      const kL = st.dualSide === 0 ? rc * 0.3 : rc;
      leftHolder.position.set(-P[0] - VM_SHIFT_X - idleX + bobX + st.swayX * 0.6 + st.sprint * 1.2, y + (st.dualSide ? 0 : 0.2), P[2] + kL * 2.2 + rlTilt * 0.8);
      leftHolder.rotation.set(kL * 0.16 - st.sprint * 0.35 + rlTilt * 0.18 - sw * 0.6, 0.04 + st.swayX * 0.03 - st.sprint * 0.7 - rlTilt * 0.35, -st.recoilRoll + rlTilt * 0.7, 'YXZ');
    }

    animateParts(dt, local, w, rl);
    animateSupport(dt, rl, thK);

    // glowing parts: tesla pulse, railgun recharge, pilot light flicker
    st.railCharge = Math.min(1, st.railCharge + dt * (w ? w.rate : 1));
    let gk = 2.6;
    if (style === 'tesla') gk = 2.2 + Math.sin(t * 14) * 0.35 + (now - st.lastShot < 0.15 ? 2.5 : 0);
    else if (style === 'flamethrower') gk = 2.0 + Math.random() * 1.4;
    else if (style === 'railgun') gk = 0.8 + st.railCharge * 2.4;
    glowMat.color.setScalar(gk);

    // muzzle flash
    st.flashT += dt;
    const showFlash = st.flashT < 0.05 && w && w.kind !== 'flame' && w.kind !== 'chain' && w.projectile?.kind !== 'bolt';
    placeFlash(flashR, gunRoot, showFlash && (!model.dual || st.dualSide === 0), w, false);
    placeFlash(flashL, leftRoot, showFlash && model.dual && st.dualSide === 1, w, true);
    const flameOn = w && w.kind === 'flame' && local.firing;
    flashLight.intensity = showFlash ? 320 * (model.heavy ? 1.3 : 1) : flameOn ? 110 + Math.random() * 60 : 0;
    flashLight.color.set(w && w.kind === 'chain' ? '#80d8ff' : style === 'railgun' ? '#b388ff' : '#ffb060');
    if (w && w.kind === 'chain' && now - st.lastShot < 0.08) flashLight.intensity = 200;
    if (style === 'railgun' && now - st.lastShot < 0.12) flashLight.intensity = 300;
    if (!showFlash && flameOn) placeLightAtMuzzle();

    // casings
    for (const c of casings) {
      if (c.age > 1) continue;
      c.age += dt;
      if (c.age > 0.75) { c.m.visible = false; c.age = 9; continue; }
      c.v.y -= 95 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
    }
    // muzzle smoke
    for (const s of smokes) {
      if (s.pending) {
        s.pending = false;
        gunRoot.updateWorldMatrix(true, false);
        gunRoot.localToWorld(s.m.position.set(model.muzzle[0] + 1, model.muzzle[1], model.muzzle[2]));
        s.v.set((Math.random() - 0.5) * 2, 3 + Math.random() * 2, -2);
        s.m.visible = true;
      }
      if (s.age > 1) { s.m.visible = false; continue; }
      s.age += dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.quaternion.copy(camera.quaternion);
      const k = s.age / 0.9;
      s.m.scale.setScalar((3 + k * 9) * VM_SIZE);
      s.m.material.opacity = Math.max(0, 0.22 * (1 - k)) * (k < 0.1 ? k * 10 : 1);
      s.m.rotation.z = s.age * 0.8;
    }

    publishMuzzle(frame);
  }

  // ---- moving gun parts ------------------------------------------------------------------
  function animateParts(dt, local, w, rl) {
    const parts = gun.userData.parts, m = model;
    const mag = local.ammo && local.ammo[local.slot] ? local.ammo[local.slot][0] : 1;
    st.slideT += dt; st.pumpT += dt; st.boltT += dt;
    // slide / carrier: snaps back on the shot, forward again; locks back on an empty mag
    const slideK = st.slideT < 0.05 ? st.slideT / 0.05 : st.slideT < 0.12 ? 1 - (st.slideT - 0.05) / 0.07 : 0;
    if (mag <= 0 && st.slideT > 0.05 && rl < 0.8) st.locked = true;
    if (rl > 0.85 || mag > 0) st.locked = rl > 0.85 ? false : st.locked && mag <= 0;
    if (parts.slide) parts.slide.position.x = -(st.locked ? 1 : slideK) * m.travel.slide;
    if (parts.hammer) parts.hammer.rotation.z = m.style === 'revolver' || m.style === 'double' ? -slideK * 0.6 : slideK * 0.5;
    // bolt / charging handle: rack at the end of a reload; bolt-actions cycle after a shot
    let bolt = 0, lift = 0;
    if (rl > 0.74 && rl < 0.92) bolt = Math.sin(((rl - 0.74) / 0.18) * Math.PI);
    if (m.boltAction && st.boltT > 0.18 && st.boltT < 0.75) {
      const k = (st.boltT - 0.18) / 0.57;
      lift = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      bolt = Math.sin(Math.min(1, Math.max(0, (k - 0.15) / 0.7)) * Math.PI);
      if (!st.ejected && k > 0.45) { st.ejected = true; ejectCasing(m.casing, false); }
    } else st.ejected = false;
    if (parts.bolt) {
      parts.bolt.position.x = -bolt * (m.travel.bolt || 1.5);
      parts.bolt.rotation.x = -lift * 1.1;
    }
    // pump: back and forward after each shot (ejecting the hull) and at the end of a reload
    if (parts.pump) {
      let k = st.pumpT > 0.12 && st.pumpT < 0.42 ? Math.sin(((st.pumpT - 0.12) / 0.3) * Math.PI) : 0;
      if (st.pumpT > 0.2 && st.pumpT < 0.25 && !st.pumped) { st.pumped = true; ejectCasing('shell', false); }
      if (st.pumpT > 0.5) st.pumped = false;
      if (rl > 0.84) k = Math.max(k, Math.sin(((rl - 0.84) / 0.16) * Math.PI));
      parts.pump.position.x = -k * 3.6;
    }
    // minigun spin
    st.spin += ((local.spin || 0) - st.spin) * damp(4, dt);
    st.spinAngle += st.spin * dt * 38;
    if (parts.spin) parts.spin.rotation.x = st.spinAngle;
    if (gunL && gunL.userData.parts.spin) gunL.userData.parts.spin.rotation.x = st.spinAngle;
    // revolver / launcher cylinder: indexes a chamber per shot, swings out to reload
    st.cylA += (st.cylTarget - st.cylA) * damp(24, dt);
    if (parts.cyl) {
      parts.cyl.rotation.x = st.cylA;
      const out = rl > 0 ? smoothPulse(rl, 0.08, 0.22, 0.72, 0.86) : 0;
      if (m.style === 'revolver') { parts.cyl.position.z = -out * 1.8; parts.cyl.position.y = m.pivots.cyl[1] - out * 0.9; parts.cyl.rotation.z = 0; }
      else parts.cyl.position.z = -out * 2.6;
      if (rl > 0.24 && rl < 0.3 && !st.ejected) {
        st.ejected = true;
        if (m.style === 'revolver') for (let i = 0; i < 3; i++) ejectCasing('pistol', false);
      }
      if (rl === 0) st.ejected = false;
    }
    // break action: barrels drop open, spent shells fly, closes again
    if (parts.barrels) {
      const out = rl > 0 ? smoothPulse(rl, 0.06, 0.2, 0.74, 0.86) : 0;
      parts.barrels.rotation.z = -out * 0.62;
      if (rl > 0.2 && rl < 0.26 && !st.ejected) { st.ejected = true; ejectCasing('shell', false); ejectCasing('shell', false); }
      if (rl === 0) st.ejected = false;
    }
    // magazine: out and falling away, then a fresh one in the support hand, seated
    if (parts.mag && m.reload === 'mag') {
      const mp = parts.mag;
      if (rl <= 0) { mp.position.set(0, 0, 0); mp.rotation.set(0, 0, 0); mp.visible = true; } else if (rl < 0.3) {
        const k = Math.max(0, (rl - 0.08) / 0.22);
        mp.position.set(-k * 0.5, -k * k * 16 - k * 1.5, k * 1.5);
        mp.rotation.set(k * 0.6, 0, -k * 0.4);
        mp.visible = k < 0.95;
      } else if (rl < 0.72) {
        // held in the support hand, which brings it up to the mag well
        mp.visible = true;
        const hp = supportTarget(rl, _v2);
        mp.position.set(hp.x - m.magwell[0], hp.y - m.magwell[1] - 1.2, hp.z - m.magwell[2]);
        mp.rotation.set(0, 0, 0.25 * (1 - (rl - 0.3) / 0.42));
      } else {
        const k = Math.min(1, (rl - 0.72) / 0.06);
        mp.position.set(0, -(1 - k) * 1.2, 0);
        mp.rotation.set(0, 0, 0);
        mp.visible = true;
      }
      if (gunL && gunL.userData.parts.mag) {
        const ml2 = gunL.userData.parts.mag;
        const k = rl > 0 ? smoothPulse(rl, 0.1, 0.3, 0.6, 0.75) : 0;
        ml2.position.set(0, -k * 12, 0);
        ml2.visible = k < 0.9;
        mp.position.set(0, -k * 12, 0);
        mp.visible = k < 0.9;
      }
    }
    // rocket: the warhead shows while loaded; a new one is pushed in from the front
    if (parts.tip && m.reload === 'rocket') {
      const loaded = mag > 0;
      if (rl > 0.25 && rl < 0.8) {
        const k = (rl - 0.25) / 0.55;
        const e = 1 - (1 - k) * (1 - k);
        parts.tip.visible = true;
        parts.tip.position.set((1 - e) * 10, -(1 - e) * 9, -(1 - e) * 3);
      } else {
        parts.tip.visible = loaded || rl >= 0.8;
        parts.tip.position.set(0, 0, 0);
      }
    }
    // crossbow: string snaps forward on the shot, drawn back and a bolt laid on in reload
    if (parts.string) {
      const loaded = mag > 0 && rl === 0;
      const draw = rl > 0 ? Math.min(1, Math.max(0, (rl - 0.15) / 0.3)) : loaded ? 1 : 0;
      parts.string.position.x = (1 - draw) * (m.length * 0.62);
      parts.string.scale.x = 1;
      if (parts.tip) {
        const k = rl > 0.5 ? Math.min(1, (rl - 0.5) / 0.3) : 0;
        parts.tip.visible = loaded || k > 0;
        parts.tip.position.set(0, (1 - k) * 5 * (rl > 0 ? 1 : 0), (1 - k) * -3 * (rl > 0 ? 1 : 0));
      }
    }
  }

  // support hand target in gun space for the reload phases (mag reloads)
  const _t = new THREE.Vector3(), _t2 = new THREE.Vector3();
  function supportTarget(rl, out) {
    const m = model;
    const rest = leftRest;
    const well = _t.set(m.magwell[0], m.magwell[1] - 0.5, m.magwell[2] - 0.6);
    const pouch = _t2.set(m.magwell[0] - 4, m.magwell[1] - 14, m.magwell[2] - 6);
    if (m.reload === 'mag') {
      if (rl < 0.12) return out.copy(rest).lerp(well, ease(rl / 0.12));
      if (rl < 0.3) return out.copy(well).lerp(pouch, ease((rl - 0.12) / 0.18));
      if (rl < 0.66) return out.copy(pouch).lerp(well, ease((rl - 0.3) / 0.36));
      if (rl < 0.74) return out.copy(well);
      // rack: charging handle / slide / cocking knob
      const rack = m.style === 'pistol' || m.style === 'dual' ? [-1, 1.4, -1.2] : m.style === 'smg' ? [m.length * 0.4, 1.9, -1.8] : m.style === 'sniper' ? [-1.2, 1.6, 1.6] : [-2.6, 2.4, -1.4];
      if (rl < 0.8) return out.copy(well).lerp(_t2.set(...rack), ease((rl - 0.74) / 0.06));
      if (rl < 0.9) return out.set(...rack).add(_t2.set(-Math.sin(((rl - 0.8) / 0.1) * Math.PI) * 2, 0, 0));
      return out.set(...rack).lerp(rest, ease((rl - 0.9) / 0.1));
    }
    if (m.reload === 'shells' || m.reload === 'break' || m.reload === 'cylinder' || m.reload === 'bolt') {
      // shells into the loading port / chambers, one trip each
      const port = m.reload === 'shells' ? _t.set(m.magwell[0], m.magwell[1] - 0.8, 0) : m.reload === 'break' ? _t.set(3.6, 1.2, -0.4) : m.reload === 'bolt' ? _t.set(1.5, 2.6, -0.8) : _t.set(m.pivots.cyl ? m.pivots.cyl[0] + 1.4 : 2, 1.2, -2.2);
      if (rl < 0.12 || rl > 0.88) return out.copy(rest).lerp(port, rl < 0.12 ? ease(rl / 0.12) : ease((1 - rl) / 0.12));
      const trips = m.reload === 'shells' ? 3 : m.reload === 'bolt' ? 1 : 2;
      const k = ((rl - 0.12) / 0.76) * trips;
      const f = k - Math.floor(k);
      const dip = Math.sin(f * Math.PI);
      return out.copy(port).add(_t2.set(-2 * dip, -9 * dip, -2.5 * dip));
    }
    if (m.reload === 'rocket') {
      const front = _t.set(m.length - 4, 0.5, -2.2);
      if (rl < 0.2) return out.copy(rest).lerp(pouch, ease(rl / 0.2));
      if (rl < 0.8) {
        const k = (rl - 0.2) / 0.6;
        const e = 1 - (1 - k) * (1 - k);
        return out.copy(pouch).lerp(front, e);
      }
      return out.copy(front).lerp(rest, ease((rl - 0.8) / 0.2));
    }
    return out.copy(rest);
  }

  function animateSupport(dt, rl, thK) {
    if (!leftPivot) return;
    const m = model;
    carry.visible = false;
    shellInHand.visible = roundInHand.visible = grenade.visible = false;
    if (st.throwT < 0.7) {
      // the support arm lobs the grenade/molotov: down, up into view, forward
      const k = st.throwT / 0.7;
      const up = Math.sin(Math.min(1, k * 1.6) * Math.PI);
      leftPivot.position.set(leftRest.x - 2 + k * 10, leftRest.y - 8 + up * 12, leftRest.z - 4 - up * 2);
      leftPivot.rotation.set(-0.4 * up, 0, 0.8 * up);
      if (k < 0.62) {
        carry.visible = true;
        grenade.visible = true;
        grenade.material.color.set(st.throwKind === 'molotov' ? '#7a5a2a' : '#3d4a2a');
        leftPivot.updateWorldMatrix(true, false);
        leftPivot.localToWorld(carry.position.set(0.5, 1.2, 0));
        carry.scale.setScalar(VM_SIZE);
      } else {
        // released: flies away from the camera
        const f = (k - 0.62) / 0.38;
        carry.visible = true;
        grenade.visible = true;
        carry.position.set(-2 + f * 6, -1 + f * 5, -16 - f * 40);
      }
      return;
    }
    if (rl > 0 && !m.dual) {
      const tgt = supportTarget(rl, _v);
      leftPivot.position.copy(tgt);
      const reach = rl > 0.12 && rl < 0.88 ? 1 : 0;
      leftPivot.rotation.set(-0.5 * reach, 0.2 * reach, 0.3 * reach);
      // something in the hand: a shell / round, or a warhead (the tip part carries itself)
      if (m.reload === 'shells' || m.reload === 'break' || m.reload === 'cylinder') {
        carry.visible = true;
        shellInHand.visible = m.style !== 'revolver';
        roundInHand.visible = m.style === 'revolver';
        leftPivot.updateWorldMatrix(true, false);
        leftPivot.localToWorld(carry.position.set(0.8, 1.0, 0.8));
        gunRoot.getWorldQuaternion(carry.quaternion);
        carry.scale.setScalar(VM_SIZE * 1.15);
      }
      return;
    }
    leftPivot.position.copy(leftRest);
    leftPivot.rotation.set(0, 0, 0);
  }

  function placeLightAtMuzzle() {
    if (!model) return;
    gunRoot.updateWorldMatrix(true, false);
    gunRoot.localToWorld(flashLight.position.set(model.muzzle[0], model.muzzle[1], model.muzzle[2]));
  }

  function placeFlash(F, root, on, w, left) {
    F.g.visible = !!on;
    if (!on || !model) return;
    root.updateWorldMatrix(true, false);
    const mz = model.muzzle;
    root.localToWorld(_v.set(mz[0], mz[1], left ? -mz[2] : mz[2]));
    root.localToWorld(_v2.set(mz[0] + 10, mz[1], left ? -mz[2] : mz[2]));
    F.g.position.copy(_v);
    _v2.sub(_v).normalize();
    _q.setFromUnitVectors(_X, _v2);
    const k = w && w.category === 'shotgun' ? 1.45 : w && (w.category === 'pistol' || w.category === 'smg') ? 0.8 : model.heavy ? 1.3 : 1.1;
    const s = (10 + Math.random() * 4) * k * VM_SIZE;
    F.sides.quaternion.copy(_q);
    F.sides.rotateX(Math.random() * Math.PI);
    F.sides.scale.set(s * (1.5 + Math.random() * 0.5), s * 0.6, s * 0.6);
    F.star.quaternion.copy(camera.quaternion);
    F.star.rotateZ(Math.random() * TAU);
    F.star.scale.setScalar(s * (0.95 + Math.random() * 0.35));
    F.core.quaternion.copy(camera.quaternion);
    F.core.scale.setScalar(s * 0.45);
    flashLight.position.copy(_v);
  }

  // Where the muzzle appears on screen, placed at the same distance in the world: the
  // viewmodel camera sits at the world camera, looking the same way, with its own FOV.
  const _ndc = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3();
  function publishMuzzle(frame) {
    if (!model) return;
    const left = model.dual && st.dualSide;
    const root = left ? leftRoot : gunRoot;
    root.updateWorldMatrix(true, false);
    root.localToWorld(_v.set(model.muzzle[0], model.muzzle[1], left ? -model.muzzle[2] : model.muzzle[2]));
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

  // a placeholder gun so the renderer's warm-up compiles every viewmodel program
  buildGun('rifle', { outfit: '#4e5b31', vest: '#3b4424', band: PLAYER_COLORS[0], key: '' });
  curWeapon = null;
  holder.visible = true;

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
      gunMat.dispose();
      glowMat.dispose();
      handMat.dispose();
      envTex.dispose();
      actorTex.detail.dispose();
      actorTex.normal.dispose();
      for (const k in flashTex) flashTex[k].dispose();
      for (const k in flashMats) flashMats[k].dispose();
      quad.dispose();
      smokeTex.dispose();
      smokeMat.dispose();
      for (const s of smokes) s.m.material.dispose();
      casingGeo.dispose(); pistolCaseGeo.dispose(); shellGeo.dispose();
      brassMat.dispose(); shellMat.dispose();
      fragGeo.dispose(); fragMat.dispose();
      releaseFx(ctx);
    },
  };
}

// ---------------------------------------------------------------------------------------

function ease(t) {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
/** 0 → 1 between a..b, holds, 1 → 0 between c..d. */
function smoothPulse(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return ease((x - a) / (b - a));
  if (x > c) return ease((d - x) / (d - c));
  return 1;
}

/** Standard material for the hands/sleeves: actor detail textures by surface class. */
function makeHandMaterial(tex, envMap) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMap, envMapIntensity: 0.5 });
  const uniforms = { uDetail: { value: tex.detail }, uNrm: { value: tex.normal } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying float vHM;\nvarying vec2 vHUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvHM = aInfo.z; vHUv = uv * 1.6;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
uniform sampler2D uNrm;
varying float vHM;
varying vec2 vHUv;
vec4 hD;
int hM;
vec3 hPerturb(vec3 N, vec3 eyePos, vec2 uv, vec2 nxy) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, N), q0p = cross(N, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(Bt, Bt));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (nxy.x * s) + Bt * (nxy.y * s) + N * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  hD = texture2D(uDetail, vHUv);
  hM = int(vHM + 0.5);
  if (hM == 1) diffuseColor.rgb *= 0.78 + hD.g * 0.4;
  else diffuseColor.rgb *= 0.85 + hD.r * 0.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.55, 0.48), hD.b * 0.35);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = hM == 1 ? 0.92 : hM == 3 ? 0.42 + hD.b * 0.35 : hM == 9 ? 0.3 : 0.6;`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = hM == 9 ? 0.8 : 0.0;')
      .replace('#include <normal_fragment_maps>', `{
    vec4 nn = texture2D(uNrm, vHUv);
    vec2 nxy = hM == 1 ? (nn.ba * 2.0 - 1.0) : (nn.rg * 2.0 - 1.0) * 0.55;
    normal = hPerturb(normal, -vViewPosition, vHUv, nxy);
  }`);
  };
  mat.customProgramCacheKey = () => 'hh-vm-hand';
  return mat;
}

/**
 * Gloved hands + sleeves in gun space. Returns { right, left, leftHand } geometries; the
 * left arm is modelled at its rest grip, leftHand = its grip point (the pivot the support
 * arm moves about when it leaves the gun).
 * @param {boolean} mirrorOnly build only the firing arm (the left gun of a dual pair)
 */
function buildArms(model, look, mirrorOnly = false) {
  const outfit = look.outfit, cuff = shadeHex(look.outfit, -0.25), band = look.band;
  const R = new ShapeBuilder();
  R.tile = 5;
  const glove = { slot: SLOT.FIXED, mat: MAT.LEATHER, color: GLOVE };
  const finger = (sb, pts, r, o = glove) => sb.tube(pts.map((p, i) => ({ c: p, r: r * (1 - i / pts.length * 0.22) })), { ...o, seg: 7, cap0: 'round', cap1: 'round', capRings: 2 });
  // ---- firing hand round the pistol grip (grip axis raked back) ----
  // back of the hand on the right of the grip, knuckles ahead, fingers wrapping the front
  R.ellipsoid([-0.35, -1.45, 0.92], [1.85, 1.55, 0.62], { ...glove, segW: 16, segH: 10, rot: [0, 0, -0.28] });
  for (let k = 0; k < 3; k++) R.ellipsoid([0.95 + k * 0.08, -1.0 - k * 0.72, 1.18], [0.42, 0.28, 0.3], { slot: SLOT.FIXED, mat: MAT.LEATHER, color: GLOVE_PAD, segW: 8, segH: 5 });
  for (let k = 0; k < 3; k++) {
    const y = -1.3 - k * 0.78, x0 = 1.05 - k * 0.22;
    finger(R, [[x0, y, 1.05], [x0 + 0.95, y - 0.05, 0.75], [x0 + 1.25, y - 0.1, 0.0], [x0 + 0.85, y - 0.12, -0.72], [x0 + 0.2, y - 0.14, -0.95]], 0.38);
  }
  // index finger along the frame, curled onto the trigger
  finger(R, [[1.0, -0.45, 1.02], [1.8, -0.5, 0.82], [2.3, -0.7, 0.45], [1.75, -0.95, 0.12]], 0.36);
  // thumb high on the left of the frame
  finger(R, [[-1.1, -0.55, 0.55], [-0.2, 0.15, 0.1], [0.7, 0.4, -0.55], [1.5, 0.35, -0.8]], 0.4);
  // wrist strap + sleeve running back and down out of the frame
  const wrist = [-2.1, -1.9, 0.9];
  R.tube(lineRings(wrist, [-3.1, -2.7, 1.25], 1.18, 1.3, 3), { ...glove, color: GLOVE_STRAP, seg: 14 });
  R.tube(lineRings([-3.0, -2.6, 1.2], [-4.1, -3.5, 1.6], 1.55, 1.62, 3), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: cuff, seg: 16 });
  R.tube(lineRings([-4.0, -3.4, 1.55], [-9.5, -9.2, 4.6], 1.62, 2.25, 6), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: outfit, seg: 16, noise: { amp: 0.12, freq: 0.9 } });
  R.tube(lineRings([-5.2, -4.6, 2.05], [-6.0, -5.4, 2.45], 1.82, 1.9, 2), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: band, seg: 16 });
  const right = R.build();
  if (mirrorOnly) return { right, left: null, leftHand: [0, 0, 0] };

  // ---- support hand ----
  const Lb = new ShapeBuilder();
  Lb.tile = 5;
  const f = model.front;
  let hand;
  let elbow;
  if (!model.twoHanded) {
    // cupping the firing hand from the left: fingers over the right fingers at the front
    hand = [0.2, -2.3, -1.15];
    Lb.ellipsoid([-0.1, -2.4, -1.25], [1.8, 1.5, 0.6], { ...glove, segW: 14, segH: 9, rot: [0, 0, -0.3] });
    for (let k = 0; k < 4; k++) {
      const y = -1.6 - k * 0.66;
      finger(Lb, [[1.0, y, -1.3], [1.95 - k * 0.15, y - 0.1, -0.9], [2.35 - k * 0.2, y - 0.14, -0.1], [2.1 - k * 0.2, y - 0.16, 0.55]], 0.34);
    }
    finger(Lb, [[-0.9, -1.4, -1.35], [0.3, -0.6, -1.25], [1.4, -0.35, -1.0]], 0.38);
    elbow = [-8, -11, -6.5];
  } else if (f[1] < -1.5 || f[1] > 3) {
    // vertical foregrip (or a top handle): a fist round it, mirrored firing-hand hold
    hand = [f[0] - 0.2, f[1] + 1.4, f[2]];
    const top = f[1] > 3;
    const dy = top ? -1 : 1;
    const y0 = f[1] + (top ? -0.2 : 1.9);
    Lb.ellipsoid([f[0] - 0.5, y0 - dy * 1.3, f[2] - 0.95], [1.7, 1.45, 0.6], { ...glove, segW: 14, segH: 9, rot: [0, 0, 0.2] });
    for (let k = 0; k < 4; k++) {
      const y = y0 - dy * (0.55 + k * 0.72);
      finger(Lb, [[f[0] + 0.6, y, -1.1], [f[0] + 1.4, y, -0.6], [f[0] + 1.35, y, 0.35], [f[0] + 0.6, y, 0.9]], 0.36);
    }
    finger(Lb, [[f[0] - 1.2, y0 - dy * 0.4, -0.8], [f[0] - 0.3, y0 + dy * 0.3, 0.1], [f[0] + 0.6, y0 + dy * 0.35, 0.7]], 0.4);
    elbow = [f[0] - 10, f[1] - 9, -6.5];
  } else {
    // palm under the handguard, fingers curling up its right side, thumb along the left
    hand = [f[0], f[1] - 0.6, f[2] - 0.2];
    const y = f[1] - 1.0;
    Lb.ellipsoid([f[0] - 0.4, y - 0.45, -0.7], [2.0, 0.65, 1.45], { ...glove, segW: 14, segH: 9, rot: [0.5, 0, 0] });
    for (let k = 0; k < 4; k++) {
      const x = f[0] - 1.05 + k * 0.72;
      finger(Lb, [[x, y - 0.5, 0.5], [x + 0.1, y - 0.2, 1.3], [x + 0.2, y + 0.75, 1.55], [x + 0.25, y + 1.6, 1.25]], 0.35);
    }
    finger(Lb, [[f[0] - 1.6, y - 0.1, -1.4], [f[0] - 0.4, y + 0.6, -1.55], [f[0] + 0.9, y + 1.0, -1.35]], 0.4);
    elbow = [f[0] - 11, f[1] - 10, -7];
  }
  // forearm: wrist strap, cuff, sleeve to the elbow (off-screen)
  const wr = [hand[0] - 1.9, hand[1] - 1.1, hand[2] - 0.9];
  const d = [elbow[0] - wr[0], elbow[1] - wr[1], elbow[2] - wr[2]];
  const L = Math.hypot(...d);
  const at = (t) => [wr[0] + d[0] * t / L, wr[1] + d[1] * t / L, wr[2] + d[2] * t / L];
  Lb.tube(lineRings(at(-0.2), at(1.2), 1.15, 1.28, 3), { ...glove, color: GLOVE_STRAP, seg: 14 });
  Lb.tube(lineRings(at(1.1), at(2.4), 1.52, 1.6, 3), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: cuff, seg: 16 });
  Lb.tube(lineRings(at(2.3), at(L), 1.6, 2.3, 6), { slot: SLOT.FIXED, mat: MAT.CLOTH, color: outfit, seg: 16, noise: { amp: 0.12, freq: 0.9 } });
  return { right, left: Lb.build(), leftHand: hand };
}

/** Brass: a bottlenecked rifle case, a short pistol case, or a red shotgun hull. */
function casingGeometry(kind) {
  let prof;
  if (kind === 'shell') prof = [[0, 0], [0.42, 0], [0.44, 0.05], [0.4, 0.1], [0.38, 0.35], [0.38, 1.35], [0.3, 1.4], [0, 1.4]];
  else if (kind === 'pistol') prof = [[0, 0], [0.24, 0], [0.24, 0.05], [0.2, 0.08], [0.22, 0.12], [0.22, 0.52], [0.19, 0.55], [0, 0.55]];
  else prof = [[0, 0], [0.22, 0], [0.22, 0.05], [0.18, 0.08], [0.2, 0.12], [0.2, 0.62], [0.12, 0.74], [0.11, 0.92], [0, 0.92]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), 10);
  g.translate(0, -prof[prof.length - 1][1] / 2, 0);
  g.rotateZ(HALF_PI);
  if (kind === 'shell') {
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const brass = g.attributes.position.getX(i) > 0.35;       // brass head (after the rotation the base is at +x)
      c[i * 3] = brass ? 0.85 : 0.6; c[i * 3 + 1] = brass ? 0.62 : 0.05; c[i * 3 + 2] = brass ? 0.3 : 0.04;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

/** Procedural flash textures: 'star' (front), 'side' (tongue), 'core', 'smoke'. */
function flashTexture(kind) {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.globalCompositeOperation = 'lighter';
  let seed = kind.length * 7 + 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (kind === 'star') {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.26);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,230,180,0.55)');
    gr.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = gr;
    g.fillRect(-S / 2, -S / 2, S, S);
    const n = 5 + Math.floor(rnd() * 2);
    for (let k = 0; k < n * 2; k++) {
      g.save();
      g.rotate((k / (n * 2)) * TAU + rnd() * 0.25);
      const Ls = S * (k % 2 ? 0.22 + rnd() * 0.1 : 0.4 + rnd() * 0.08);
      const lg = g.createLinearGradient(0, 0, Ls, 0);
      lg.addColorStop(0, 'rgba(255,245,220,1)');
      lg.addColorStop(0.6, 'rgba(255,190,110,0.5)');
      lg.addColorStop(1, 'rgba(255,140,50,0)');
      g.fillStyle = lg;
      const wd = S * (k % 2 ? 0.035 : 0.05);
      g.beginPath();
      g.moveTo(0, -wd); g.quadraticCurveTo(Ls * 0.5, -wd * 0.4, Ls, 0); g.quadraticCurveTo(Ls * 0.5, wd * 0.4, 0, wd);
      g.fill();
      g.restore();
    }
  } else if (kind === 'side') {
    // tongue of flame from the left edge (muzzle) flaring right, turbulent edges
    for (let k = 0; k < 5; k++) {
      const lg = g.createLinearGradient(-S / 2, 0, S / 2, 0);
      lg.addColorStop(0, 'rgba(255,250,225,0.9)');
      lg.addColorStop(0.35, 'rgba(255,200,110,0.55)');
      lg.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = lg;
      const wd = S * (0.2 - k * 0.03);
      const j = (rnd() - 0.5) * S * 0.08;
      g.beginPath();
      g.moveTo(-S / 2, -wd * 0.3);
      g.bezierCurveTo(-S * 0.15, -wd * 1.4 + j, S * 0.2, -wd * 0.9 - j, S / 2, (rnd() - 0.5) * S * 0.1);
      g.bezierCurveTo(S * 0.2, wd * 0.9 + j, -S * 0.15, wd * 1.4 - j, -S / 2, wd * 0.3);
      g.fill();
    }
  } else if (kind === 'core') {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,245,220,0.7)');
    gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr;
    g.fillRect(-S / 2, -S / 2, S, S);
  } else {
    g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 16; k++) {
      const a = rnd() * TAU, d = rnd() * S * 0.2, rr = S * (0.12 + rnd() * 0.18);
      const gr = g.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-S / 2, -S / 2, S, S);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
