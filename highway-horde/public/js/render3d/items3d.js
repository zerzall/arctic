// Things in the world that are not people (ACTORS, SPEC §7.5): projectiles by kind
// (crossbow bolt, launcher grenade, rocket with smoke trail + light, flame tongues,
// thrown frag, molotov with a burning rag, acid glob), pickups (floating, spinning,
// glowing boxes with an icon per kind; weapon crates with the gun itself hovering over
// them and its short name), sentry turrets (tripod + rotating gun + status light),
// barricades (planks fall off as they take damage) and hazards (fire patches, bubbling
// acid). Instanced per kind, so the whole lot costs a handful of draw calls.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PICKUP_KINDS } from '../shared/items.js';
import { BARRICADE, PLAYER_COLORS } from '../shared/constants.js';
import { PartBuilder, col, makeCanvas, canvasTexture, hash01 } from './actor-kit.js';
import { gunModel, gunMaterials } from './actor-guns.js';
import { acquireFx, releaseFx, F_ADD, F_FIRE, F_FLICKER, F_BOUNCE, FR } from './fx-core.js';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const P_CAP = 160, PK_CAP = 64, T_CAP = 16, B_CAP = 32, H_CAP = 32;
const PICKUP_GLOW = { ammo: '#ffd54f', health: '#ff5252', cash: '#7dff9a', armor: '#64b5f6', frag: '#ffb74d', crate: '#ffe082' };

// ---------------------------------------------------------------------------------------
// models

function projectileModels() {
  const m = {};
  let pb = new PartBuilder();
  pb.add('cyl6', { at: [0, 0, 0], rot: [0, 0, -HALF_PI], size: [0.9, 22, 0.9], color: '#8a6a44' });
  pb.add('cone6', { at: [12.5, 0, 0], rot: [0, 0, -HALF_PI], size: [1.8, 4, 1.8], color: '#d0d4d8' });
  for (let k = 0; k < 3; k++) pb.add('box', { at: [-9, 0, 0], rot: [(k / 3) * Math.PI, 0, 0], size: [4, 0.2, 2.6], color: '#e8e0d0' });
  m.bolt = pb.build();
  pb = new PartBuilder();
  pb.add('cyl8', { rot: [0, 0, -HALF_PI], size: [4.2, 5, 4.2], color: '#3d4a26' });
  pb.add('ico0', { at: [2.6, 0, 0], size: [4, 4, 4], color: '#4a5a2e' });
  pb.add('cyl8', { at: [-1.2, 0, 0], rot: [0, 0, -HALF_PI], size: [4.4, 1.2, 4.4], color: '#b8903a' });
  m.grenade = pb.build();
  pb = new PartBuilder();
  pb.add('cyl8', { rot: [0, 0, -HALF_PI], size: [4, 16, 4], color: '#5a6a3a' });
  pb.add('cone8', { at: [10, 0, 0], rot: [0, 0, -HALF_PI], size: [4, 5, 4], color: '#8d6e63' });
  for (let k = 0; k < 4; k++) pb.add('box', { at: [-7, 0, 0], rot: [(k / 4) * Math.PI, 0, 0], size: [4, 0.4, 7], color: '#3a3a3a' });
  m.rocket = pb.build();
  pb = new PartBuilder();
  pb.add('ico1', { size: [5.2, 6.2, 5.2], color: '#3d4a2a' });
  pb.add('box', { at: [0, 3.4, 1.4], rot: [0.4, 0, 0], size: [1, 3.2, 0.6], color: '#9a9a9a' });   // spoon
  pb.add('torus', { at: [0, 4, -0.6], rot: [0, HALF_PI, 0], size: [1.6, 1.6, 1.6], color: '#b0b0b0' }); // pin ring
  m.frag = pb.build();
  pb = new PartBuilder();
  pb.add('cyl8', { size: [4.2, 9, 4.2], color: '#6a4a1c' });
  pb.add('cyl8', { at: [0, 6, 0], size: [1.8, 4, 1.8], color: '#5a3e18' });
  pb.add('box', { at: [0, 8.6, 0], rot: [0.3, 0, 0.2], size: [2.4, 2.4, 2.4], color: '#e0d0b0' });  // rag
  m.molotov = pb.build();
  pb = new PartBuilder();
  pb.add('ico1', { size: [7, 6, 7], color: '#a6ff3a' });
  pb.add('ico0', { at: [-3, 0.5, 0], size: [4, 3.5, 4], color: '#7ad020' });
  m.acid = pb.build();
  return m;
}

function iconTexture(kind) {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
  const bg = { ammo: '#6b5a1e', health: '#e8e8e8', cash: '#1f5a2e', armor: '#1f3f66', frag: '#6a3a10', crate: '#4e5b31' }[kind] || '#555';
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, S - 8, S - 8);
  g.translate(S / 2, S / 2);
  switch (kind) {
    case 'ammo':
      for (let k = -1; k <= 1; k++) {
        g.fillStyle = '#d8a93a';
        g.fillRect(k * 26 - 9, -14, 18, 44);
        g.fillStyle = '#b87333';
        g.beginPath(); g.moveTo(k * 26 - 9, -14); g.lineTo(k * 26, -40); g.lineTo(k * 26 + 9, -14); g.fill();
      }
      break;
    case 'health':
      g.fillStyle = '#d32f2f';
      g.fillRect(-14, -42, 28, 84);
      g.fillRect(-42, -14, 84, 28);
      break;
    case 'cash':
      g.fillStyle = '#7dff9a';
      g.font = 'bold 92px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$', 0, 6);
      break;
    case 'armor':
      g.fillStyle = '#90caf9';
      g.beginPath();
      g.moveTo(0, -44); g.lineTo(38, -30); g.quadraticCurveTo(36, 22, 0, 46); g.quadraticCurveTo(-36, 22, -38, -30);
      g.closePath();
      g.fill();
      break;
    case 'frag':
      g.fillStyle = '#3d4a2a';
      g.beginPath(); g.ellipse(0, 8, 30, 36, 0, 0, TAU); g.fill();
      g.fillStyle = '#9a9a9a';
      g.fillRect(-8, -40, 16, 16);
      g.fillRect(6, -34, 26, 8);
      break;
    default:
      g.fillStyle = '#e8e0c8';
      g.fillRect(-46, -8, 92, 16);
  }
  return canvasTexture(c);
}

function labelTexture(text) {
  const c = makeCanvas(256, 64), g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 256, 64);
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

function turretModels() {
  let pb = new PartBuilder();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    pb.add('box', { at: [Math.cos(a) * 7, 10, Math.sin(a) * 7], rot: [Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55], size: [1.6, 22, 1.6], color: '#3a3d40' });
    pb.add('box', { at: [Math.cos(a) * 12.5, 0.8, Math.sin(a) * 12.5], size: [4, 1.6, 4], color: '#2a2c2e' });
  }
  pb.add('cyl8', { at: [0, 21, 0], size: [7, 4, 7], color: '#4a4d50' });
  pb.add('cyl8', { at: [0, 16, 0], size: [3, 8, 3], color: '#3a3d40' });
  const tripod = pb.build();
  pb = new PartBuilder();
  pb.add('box', { at: [0, 29, 0], size: [16, 8, 10], color: '#5b6150' });                // receiver
  pb.add('box', { at: [-2, 29, -7.5], size: [9, 7, 5], color: '#4e5b31' });              // ammo can
  pb.add('cyl8', { at: [15, 30, 0], rot: [0, 0, -HALF_PI], size: [2.4, 16, 2.4], color: '#2a2c2e' });
  pb.add('cyl8', { at: [23, 30, 0], rot: [0, 0, -HALF_PI], size: [3.6, 3, 3.6], color: '#1a1a1a' });
  pb.add('box', { at: [2, 34.5, 0], size: [8, 3, 6], color: '#3a3d40' });               // sensor head
  pb.add('box', { at: [6.2, 34.5, 0], size: [0.4, 2, 4.4], color: '#101418' });          // sensor glass
  pb.add('box', { at: [-4, 25, 0], size: [2, 4, 12], color: '#2a2c2e' });                // yoke
  const head = pb.build();
  return { tripod, head };
}

function barricadeModels() {
  const W = BARRICADE.width, D = BARRICADE.height;
  const base = new PartBuilder();
  for (const s of [-1, 1]) {
    base.add('box', { at: [s * (W / 2 - 4), 22, 0], size: [5, 44, 5], color: '#4a3a28' });        // posts
    base.add('box', { at: [s * (W / 2 - 4), 6, 0], rot: [0, 0, s * 0.5], size: [4, 22, 4], color: '#3a2c1e' }); // braces
  }
  for (let k = 0; k < 7; k++) {
    base.add('box', { at: [-W / 2 + 7 + k * ((W - 14) / 6), 4.5, D * 0.2], rot: [0, (hash01(k) - 0.5) * 0.3, 0], size: [15, 9, 11], color: k % 2 ? '#8a7a55' : '#7a6a48', ao: 0.35 }); // sandbags
  }
  base.add('box', { at: [0, 22, -D * 0.3], size: [W * 0.55, 30, 1.2], color: '#5a5f63' });            // metal sheet behind
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const pb = new PartBuilder();
    const y = 14 + r * 8.5;
    const tilt = (hash01(r * 7 + 3) - 0.5) * 0.12;
    pb.add('box', { at: [0, y, 2.5], rot: [0, 0, tilt], size: [W + 6, 6.5, 2.4], color: r % 2 ? '#8a6a44' : '#7a5c3a', ao: 0.2 });
    for (let n = 0; n < 3; n++) pb.add('box', { at: [-W / 2 + 6 + n * 3, y + 1, 3.9], size: [0.8, 0.8, 0.8], color: '#9a9a9a' }); // nails
    rows.push(pb.build());
  }
  return { base: base.build(), rows };
}

// ---------------------------------------------------------------------------------------

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createItems3D(ctx) {
  const fx = acquireFx(ctx);
  const R = fx.rng;
  const root = new THREE.Group();
  root.name = 'items3d';
  ctx.scene.add(root);
  let high = ctx.quality !== 'low';
  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const disposables = [lambert, glowMat];

  const mkInst = (geo, mat, cap, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadow && high;
    root.add(m);
    disposables.push(geo);
    return m;
  };

  // projectiles
  const pm = projectileModels();
  const proj = {
    bolt: mkInst(pm.bolt, lambert, P_CAP),
    grenade: mkInst(pm.grenade, lambert, P_CAP),
    rocket: mkInst(pm.rocket, lambert, P_CAP),
    frag: mkInst(pm.frag, lambert, P_CAP),
    molotov: mkInst(pm.molotov, lambert, P_CAP),
    acid: mkInst(pm.acid, glowMat, P_CAP),
  };
  const projState = new Map();   // id → { t, seen, kind, x, y }

  // pickups: one box mesh per kind with its icon
  const boxGeo = new THREE.BoxGeometry(12, 12, 12);
  disposables.push(boxGeo);
  const pick = {};
  for (const kind of PICKUP_KINDS) {
    if (kind === 'crate') continue;
    const tex = iconTexture(kind);
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(PICKUP_GLOW[kind]), emissiveIntensity: 0.25, emissiveMap: tex });
    disposables.push(tex, mat);
    pick[kind] = mkInst(boxGeo, mat, PK_CAP);
  }
  // crates: a wooden crate + the gun hovering over it + its short name
  const crateTex = iconTexture('crate');
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTex, emissive: new THREE.Color('#ffe082'), emissiveIntensity: 0.12 });
  const crateGeo = new THREE.BoxGeometry(26, 18, 18);
  disposables.push(crateTex, crateMat, crateGeo);
  const crateInst = mkInst(crateGeo, crateMat, 16, true);
  const crateExtras = new Map();  // id → { group, gun, label, weapon }
  const labelCache = new Map();
  const labelGeo = new THREE.PlaneGeometry(40, 10);
  disposables.push(labelGeo);

  // turrets
  const tm = turretModels();
  const tripods = mkInst(tm.tripod, lambert, T_CAP, true);
  const heads = mkInst(tm.head, lambert, T_CAP, true);

  // barricades
  const bm = barricadeModels();
  const barBase = mkInst(bm.base, lambert, B_CAP, true);
  const barRows = bm.rows.map((g) => mkInst(g, lambert, B_CAP, true));

  // acid puddles (flat, glowing, alpha-blended)
  const puddleGeo = new THREE.CircleGeometry(1, 20);
  puddleGeo.rotateX(-HALF_PI);
  const puddleMat = new THREE.MeshBasicMaterial({ color: '#5a9a1a', transparent: true, opacity: 0.5, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disposables.push(puddleGeo, puddleMat);
  const puddles = mkInst(puddleGeo, puddleMat, H_CAP);
  puddles.renderOrder = 5;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function put(mesh, i, x, h, y, ry, rx = 0, rz = 0, s = 1, sy = s, sz = s) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, h, y);
    _s.set(s, sy, sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  function finish(mesh, n) {
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const C = (h) => col(h);
  const WHITE = new THREE.Color(1, 1, 1);
  let frameNo = 0;
  const hazardLights = [];

  function update(view, frame) {
    fx.begin(frame);
    frameNo++;
    const dt = Math.min(0.1, frame.dt || 0);
    const t = frame.now || 0;
    const camX = frame.camX, camY = frame.camY;
    const near = (x, y, d) => (x - camX) * (x - camX) + (y - camY) * (y - camY) < d * d;

    // ---- projectiles ----
    const counts = { bolt: 0, grenade: 0, rocket: 0, frag: 0, molotov: 0, acid: 0 };
    const list = (view && view.projectiles) || [];
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      let s = projState.get(p.id);
      if (!s || s.kind !== p.kind) { s = { t: 0, kind: p.kind, x: p.x, y: p.y, seen: 0 }; projState.set(p.id, s); }
      s.t += dt;
      s.seen = frameNo;
      const a = p.angle || 0;
      const dir = -a;
      switch (p.kind) {
        case 'bolt': {
          const i = counts.bolt++;
          if (i < P_CAP) put(proj.bolt, i, p.x, 40, p.y, dir);
          fx.beam(p.x - Math.cos(a) * 40, 40, p.y - Math.sin(a) * 40, p.x, 40, p.y, 0.2, 1.2, C('#c8e6ff'), 0.6, 0.3, 0.8, 0);
          break;
        }
        case 'grenade': {
          const i = counts.grenade++;
          const h = 38 + Math.sin(Math.min(1, s.t / 1.3) * Math.PI) * 26 - s.t * 18;
          if (i < P_CAP) put(proj.grenade, i, p.x, Math.max(3, h), p.y, dir, 0, -s.t * 12);
          if (high && R() < dt * 30) fx.spawn(p.x, h, p.y, 0, 6, 0, 0.6, 2, 7, C('#9a968e'), 0.25, FR.SMOKE, 0, -4, 1);
          break;
        }
        case 'rocket': {
          const i = counts.rocket++;
          const roll = t * 8 + p.id;
          if (i < P_CAP) put(proj.rocket, i, p.x, 40, p.y, dir, roll);
          const bx = p.x - Math.cos(a) * 10, by = p.y - Math.sin(a) * 10;
          fx.glow(bx, 40, by, 16 + R() * 5, C('#ffb050'), 1);
          fx.glow(bx, 40, by, 7, WHITE, 1);
          // exhaust fire + a thick lingering smoke trail
          const n = high ? 3 : 1;
          for (let q = 0; q < n; q++) {
            const back = a + Math.PI + (R() - 0.5) * 0.4;
            fx.spawn(bx, 40, by, Math.cos(back) * 160, (R() - 0.5) * 20, Math.sin(back) * 160, 0.12, 5, 2, WHITE, 1, FR.FLAME, F_ADD | F_FIRE, 0, 2);
          }
          if (R() < dt * (high ? 60 : 25)) {
            fx.spawn(bx - Math.cos(a) * 8, 40, by - Math.sin(a) * 8, (R() - 0.5) * 10, 4 + R() * 6, (R() - 0.5) * 10, 1.6 + R(), 5, 20, C('#8a8680'), 0.4, R() < 0.5 ? FR.SMOKE : FR.SMOKE2, 0, -3, 0.6);
          }
          ctx.lights.steady('rocket' + p.id, bx, by, 40, '#ffa040', 2.2, 260);
          break;
        }
        case 'flame': {
          // a rolling tongue of fire along the flame's path
          if (fx.load() < 0.9 && R() < (high ? 1 : 0.5)) {
            const grow = Math.min(1, s.t / 0.5);
            const i = fx.spawn(p.x + (R() - 0.5) * 6, 34 - grow * 16 + R() * 6, p.y + (R() - 0.5) * 6,
              Math.cos(a) * 120, 18 + R() * 20, Math.sin(a) * 120, 0.22 + R() * 0.12, 10 + grow * 16, 22 + grow * 22, WHITE, 0.8, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -30, 3);
            fx.stretchLast(i, 1.2);
          }
          if ((p.id & 7) === 0) ctx.lights.steady('flame' + (p.id & 31), p.x, p.y, 30, '#ff8a33', 1.2, 180);
          break;
        }
        case 'frag': {
          const i = counts.frag++;
          // fake bounces: the sim is flat, but a grenade should hop along the ground
          const h = 4 + Math.abs(Math.sin(s.t * 7)) * 24 * Math.exp(-s.t * 1.8) + Math.max(0, 30 - s.t * 90);
          if (i < P_CAP) put(proj.frag, i, p.x, h, p.y, dir + s.t * 6, s.t * 9, s.t * 5);
          fx.glow(p.x, h + 4, p.y, 3 + Math.abs(Math.sin(t * 20)) * 3, C('#ffcc66'), 0.8);
          break;
        }
        case 'molotov': {
          const i = counts.molotov++;
          const h = 40 + Math.sin(Math.min(1, s.t / 0.9) * Math.PI) * 30 - s.t * 30;
          if (i < P_CAP) put(proj.molotov, i, p.x, Math.max(4, h), p.y, dir, s.t * 11, s.t * 7);
          fx.spawn(p.x, h + 6, p.y, (R() - 0.5) * 10, 20, (R() - 0.5) * 10, 0.25, 4, 1, WHITE, 1, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -40, 1);
          ctx.lights.steady('molotov' + p.id, p.x, p.y, h + 6, '#ff9a40', 1.2, 170);
          break;
        }
        case 'acid': {
          const i = counts.acid++;
          const k = Math.min(1, s.t / 0.9);
          const h = 50 + Math.sin(k * Math.PI) * 45 - k * 44;
          if (i < P_CAP) put(proj.acid, i, p.x, Math.max(3, h), p.y, dir, 0, 0, 1 + Math.sin(t * 20) * 0.1);
          fx.glow(p.x, h, p.y, 16, C('#a6ff3a'), 0.7);
          if (R() < dt * 25) fx.spawn(p.x, h - 2, p.y, 0, -10, 0, 0.5, 2, 1, C('#a6ff3a'), 1, FR.DOT, F_ADD | F_BOUNCE, 400, 0);
          break;
        }
        default:
          break;
      }
    }
    for (const k in proj) finish(proj[k], Math.min(P_CAP, counts[k]));
    if (frameNo % 30 === 0) for (const [id, s] of projState) if (frameNo - s.seen > 30) projState.delete(id);

    // ---- pickups ----
    const pc = { ammo: 0, health: 0, cash: 0, armor: 0, frag: 0 };
    let nCrate = 0;
    const pickups = (view && view.pickups) || [];
    const seenCrates = new Set();
    for (let k = 0; k < pickups.length; k++) {
      const p = pickups[k];
      const glowC = C(PICKUP_GLOW[p.kind] || '#ffffff');
      const pulse = 0.75 + Math.sin(t * 3 + p.id) * 0.25;
      if (p.kind === 'crate') {
        if (nCrate < 16) put(crateInst, nCrate++, p.x, 9, p.y, hash01(p.id) * TAU);
        seenCrates.add(p.id);
        crateExtra(p, t);
        fx.glow(p.x, 1, p.y, 70, glowC, 0.35 * pulse, FR.GLOW, true);
        fx.glow(p.x, 22, p.y, 34, glowC, 0.25 * pulse);
        continue;
      }
      const mesh = pick[p.kind];
      if (!mesh) continue;
      const i = pc[p.kind]++;
      const h = 11 + Math.sin(t * 2.2 + p.id * 1.7) * 2.5;
      if (i < PK_CAP) put(mesh, i, p.x, h, p.y, t * 1.6 + p.id, 0.25, 0.15, 1);
      fx.glow(p.x, h, p.y, 30, glowC, 0.45 * pulse);
      fx.glow(p.x, 1, p.y, 42, glowC, 0.35 * pulse, FR.GLOW, true);
    }
    for (const k in pc) if (pick[k]) finish(pick[k], Math.min(PK_CAP, pc[k]));
    finish(crateInst, nCrate);
    for (const [id, ex] of crateExtras) {
      if (!seenCrates.has(id)) { ex.group.removeFromParent(); crateExtras.delete(id); }
    }

    // ---- turrets ----
    let nt = 0;
    const turrets = (view && view.turrets) || [];
    for (let k = 0; k < turrets.length && nt < T_CAP; k++) {
      const tr = turrets[k];
      const i = nt++;
      put(tripods, i, tr.x, 0, tr.y, hash01(tr.id) * TAU);
      const recoil = tr.firing ? Math.sin(t * 60) * 1.2 : 0;
      put(heads, i, tr.x - Math.cos(tr.angle) * recoil, 0, tr.y - Math.sin(tr.angle) * recoil, -tr.angle);
      // status light: green = ok, amber = low ammo, red blinking = badly damaged
      let lc = '#4dff6a', blink = 1;
      if (tr.hp < 0.35) { lc = '#ff3a2a'; blink = Math.sin(t * 12) > 0 ? 1 : 0.15; } else if (tr.ammo < 0.25) lc = '#ffc040';
      const lx = tr.x - Math.cos(tr.angle) * 3, ly = tr.y - Math.sin(tr.angle) * 3;
      fx.glow(lx, 38.5, ly, 4, C(lc), blink);
      fx.glow(lx, 38.5, ly, 12, C(lc), 0.35 * blink);
      // owner colour ring on the ground
      const oc = PLAYER_COLORS[(tr.owner - 1 + 60) % PLAYER_COLORS.length] || '#ffffff';
      fx.glow(tr.x, 0.8, tr.y, 44, C(oc), 0.18, FR.RING, true);
      if (tr.hp < 0.4 && R() < dt * (high ? 8 : 3)) {
        fx.spawn(tr.x, 32, tr.y, (R() - 0.5) * 8, 20, (R() - 0.5) * 8, 1.8, 4, 16, C('#2e2c2a'), 0.45, FR.SMOKE, 0, -3, 0.5);
        if (R() < 0.3) fx.spawn(tr.x, 30, tr.y, (R() - 0.5) * 60, 60, (R() - 0.5) * 60, 0.3, 1, 0.5, C('#ffcf80'), 1, FR.DOT, F_ADD | F_BOUNCE, 500, 0);
      }
    }
    finish(tripods, nt);
    finish(heads, nt);

    // ---- barricades ----
    let nb = 0;
    const rowN = [0, 0, 0, 0];
    const bars = (view && view.barricades) || [];
    for (let k = 0; k < bars.length && nb < B_CAP; k++) {
      const b = bars[k];
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
    finish(barBase, nb);
    for (let r = 0; r < 4; r++) finish(barRows[r], rowN[r]);

    // ---- hazards ----
    let np = 0;
    hazardLights.length = 0;
    const hz = (view && view.hazards) || [];
    for (let k = 0; k < hz.length; k++) {
      const h = hz[k];
      const life = Math.max(0, Math.min(1, h.life));
      const r = h.r || 60;
      const d2 = (h.x - camX) ** 2 + (h.y - camY) ** 2;
      if (h.kind === 'fire') {
        // flames scattered over the patch, denser near the camera
        if (d2 < 2400 * 2400 && fx.load() < 0.85) {
          const rate = (r * r) / 180 * (high ? 1 : 0.45) * (d2 < 800 * 800 ? 1 : 0.4) * (0.35 + life * 0.65);
          let n = rate * dt;
          while (n > 0) {
            if (n < 1 && R() > n) break;
            n -= 1;
            const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.9;
            const i = fx.spawn(h.x + Math.cos(a) * rr, 2, h.y + Math.sin(a) * rr, (R() - 0.5) * 10, 40 + R() * 50, (R() - 0.5) * 10,
              0.45 + R() * 0.45, 9 + R() * 8, 3, WHITE, 0.9, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -30, 1);
            fx.stretchLast(i, 1.6);
          }
          if (R() < dt * 3 * (r / 80)) fx.spawn(h.x + (R() - 0.5) * r, 30, h.y + (R() - 0.5) * r, 0, 30, 0, 2.5, 20, 60, C('#1e1c1a'), 0.35, FR.SMOKE, 0, -5, 0.3);
          if (R() < dt * 6) fx.spawn(h.x + (R() - 0.5) * r, 10, h.y + (R() - 0.5) * r, (R() - 0.5) * 30, 80 + R() * 60, (R() - 0.5) * 30, 1.2, 1.2, 0.4, C('#ffb050'), 1, FR.DOT, F_ADD | F_FLICKER, -20, 0.5);
        }
        fx.glow(h.x, 1, h.y, r * 2.4, C('#ff7a2a'), (0.3 + Math.sin(t * 11 + h.id) * 0.05) * (0.4 + life * 0.6), FR.GLOW, true);
        hazardLights.push(d2, h, '#ff8a33', 1.6 * (0.4 + life * 0.6), r * 2.6);
      } else {
        if (np < H_CAP) put(puddles, np++, h.x, 0.9 + np * 0.01, h.y, h.id, 0, 0, r * (0.7 + life * 0.3), 1, r * (0.7 + life * 0.3));
        fx.glow(h.x, 1.4, h.y, r * 2.3, C('#8cff3a'), 0.28 * (0.3 + life * 0.7), FR.GLOW, true);
        if (d2 < 1600 * 1600 && R() < dt * (r / 10) * (high ? 1 : 0.5)) {
          const a = R() * TAU, rr = Math.sqrt(R()) * r * 0.8;
          fx.spawn(h.x + Math.cos(a) * rr, 1.5, h.y + Math.sin(a) * rr, 0, 8 + R() * 8, 0, 0.5 + R() * 0.5, 1.5, 4 + R() * 3, C('#c8ff6a'), 0.9, FR.BUBBLE, F_ADD, 0, 0);
          if (R() < 0.3) fx.spawn(h.x + Math.cos(a) * rr, 2, h.y + Math.sin(a) * rr, 0, 10, 0, 1.4, 8, 26, C('#5a8a20'), 0.2, FR.SMOKE, 0, -2, 0.3);
        }
        hazardLights.push(d2, h, '#8cff3a', 0.9 * (0.3 + life * 0.7), r * 2.4);
      }
    }
    finish(puddles, np);
    // hazard lights: the three nearest
    const order = [];
    for (let k = 0; k < hazardLights.length; k += 5) order.push(k);
    order.sort((a, b) => hazardLights[a] - hazardLights[b]);
    for (let n = 0; n < Math.min(3, order.length); n++) {
      const k = order[n];
      const h = hazardLights[k + 1];
      ctx.lights.steady('hz' + h.kind + h.id, h.x, h.y, h.kind === 'fire' ? 30 : 10, hazardLights[k + 2], hazardLights[k + 3], hazardLights[k + 4]);
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
        const m = gunModel(wid);
        gun = new THREE.Group();
        const body = new THREE.Mesh(m.body, gunMaterials().lambert);
        body.position.set(-m.length * 0.4, 0, 0);
        gun.add(body);
        if (m.glow) {
          const g = new THREE.Mesh(m.glow, gunMaterials().glow);
          g.position.copy(body.position);
          gun.add(g);
        }
        group.add(gun);
      }
      const text = wid ? WEAPONS[wid].short : '?';
      let tex = labelCache.get(text);
      if (!tex) { tex = labelTexture(text); labelCache.set(text, tex); disposables.push(tex); }
      const labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
      disposables.push(labelMat);
      const label = new THREE.Mesh(labelGeo, labelMat);
      label.position.y = 20;
      group.add(label);
      root.add(group);
      ex = { group, gun, label, weapon: wid };
      crateExtras.set(p.id, ex);
    }
    ex.group.position.set(p.x, 24 + Math.sin(t * 2 + p.id) * 2, p.y);
    if (ex.gun) ex.gun.rotation.y = t * 1.2;
    // the label always faces the camera
    ex.label.quaternion.copy(ctx.camera.quaternion);
  }

  return {
    update,
    setQuality(q) {
      high = q !== 'low';
      for (const m of [crateInst, tripods, heads, barBase, ...barRows]) m.castShadow = high;
    },
    dispose() {
      for (const ex of crateExtras.values()) ex.group.removeFromParent();
      for (const d of disposables) d.dispose();
      root.removeFromParent();
      releaseFx(ctx);
    },
  };
}
