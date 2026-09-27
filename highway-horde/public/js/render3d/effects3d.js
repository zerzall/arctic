// Event-driven effects in the first-person view (ACTORS, SPEC §7.5): tracers from every
// shot ray, muzzle flashes, impact sparks/dust/blood, explosions (flash light, fireball,
// shockwave, smoke column, debris, scorch, shake), molotov ignition, tesla arcs, rail
// beams, flamethrower jets, acid spit, screams, boss slams, brute charge dust, pickup
// sparkle, place/destroy puffs, the supply crate drop and damage feedback. Everything is
// drawn through the shared pools in fx-core.js (three draw calls for all of it) plus the
// renderer's light pool (ctx.lights.flash) and ground decals (ctx.ground.decal).
//
// Shot rules (SPEC §4.1): `echo` shots are never drawn again; the local player's shots
// (predicted on clients) start at the viewmodel muzzle, which viewmodel.js publishes in
// fx.localMuzzle every frame; teammates' shots start at the muzzle players3d publishes.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { acquireFx, releaseFx, F_ADD, F_FLAT, F_STREAK, F_BOUNCE, F_FIRE, F_FLICKER, F_SPIN, FR } from './fx-core.js';
import { col, PartBuilder } from './actor-kit.js';

const TAU = Math.PI * 2;
const TRACER_SPEED = 7200;
const EYE = 52;

const PICKUP_GLOW = { ammo: '#ffd54f', health: '#ff5252', cash: '#7dff9a', armor: '#64b5f6', frag: '#ffb74d', crate: '#ffe082' };

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createEffects3D(ctx) {
  const fx = acquireFx(ctx);
  // cross-module publishing points (see file header)
  if (!fx.localMuzzle) fx.localMuzzle = { x: 0, h: 0, y: 0, now: -1, valid: false };
  if (!fx.muzzles) fx.muzzles = new Map();
  let high = ctx.quality !== 'low';
  let localId = 0;
  let now = 0;
  let camX = 0, camY = 0, pitch = 0;
  const R = fx.rng;

  const tracers = [];      // { ax, ah, ay, bx, bh, by, len, age, color, w, core }
  const arcs = [];         // { pts: number[], age, life, seed, w }
  const rails = [];        // { ax, ah, ay, bx, bh, by, age, life, color }
  const emitters = [];     // { kind, x, y, age, life, acc }
  const crates = [];       // falling supply crates { x, y, age }
  const players = new Map();

  // supply-drop crate model (falls from the sky for a moment before the pickup appears)
  const crateGeo = (() => {
    const pb = new PartBuilder();
    pb.add('box', { size: [30, 26, 30], at: [0, 13, 0], color: '#4e5b31' });
    for (const s of [-1, 1]) pb.add('box', { size: [31, 3, 31], at: [0, 13 + s * 8, 0], color: '#2f3820' });
    pb.add('box', { size: [8, 0.5, 18], at: [0, 26.3, 0], color: '#e8e0c8' });
    pb.add('cone8', { size: [44, 18, 44], at: [0, 70, 0], color: '#c8c0a8' });      // parachute canopy
    for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
      pb.add('box', { size: [0.5, 40, 0.5], at: [x * 0.6, 45, z * 0.6], rot: [z * 0.012, 0, -x * 0.012], color: '#aaa' });
    }
    return pb.build();
  })();
  const crateMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const crateMeshes = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(crateGeo, crateMat);
    m.visible = false;
    ctx.scene.add(m);
    crateMeshes.push(m);
  }

  const C = (hex) => col(hex);
  const WHITE = new THREE.Color(1, 1, 1);

  function distCam(x, y) { return Math.hypot(x - camX, y - camY); }
  function shakeAt(x, y, amount, range) {
    const d = distCam(x, y);
    const k = Math.max(0, 1 - d / range);
    if (k > 0) ctx.shake(Math.min(1, amount * k));
  }

  // ---- primitive emitters -------------------------------------------------------------
  function sparks(x, h, y, dirA, spread, count, speed, color = C('#ffd27a')) {
    for (let k = 0; k < count; k++) {
      if (fx.load() > 0.95) return;
      const a = dirA + (R() - 0.5) * spread, s = speed * (0.4 + R() * 0.8);
      const up = (R() * 0.9 - 0.1) * speed * 0.7;
      const i = fx.spawn(x, h, y, Math.cos(a) * s, up, Math.sin(a) * s, 0.12 + R() * 0.22, 0.9 + R() * 0.6, 0.5, color, 1, FR.DOT, F_ADD | F_STREAK | F_BOUNCE, 700, 1.5);
      fx.stretchLast(i, 1);
    }
  }
  function dust(x, h, y, count, size, color, speed = 30, life = 0.9, alpha = 0.4, dirA = null, spread = TAU) {
    for (let k = 0; k < count; k++) {
      const a = dirA == null ? R() * TAU : dirA + (R() - 0.5) * spread, s = speed * (0.3 + R());
      fx.spawn(x + (R() - 0.5) * size * 0.4, h + R() * size * 0.3, y + (R() - 0.5) * size * 0.4, Math.cos(a) * s, 8 + R() * 16, Math.sin(a) * s,
        life * (0.7 + R() * 0.6), size * 0.5, size * (1.4 + R()), color, alpha, R() < 0.5 ? FR.SMOKE : FR.SMOKE2, 0, -4, 1.8);
    }
  }
  function blood(x, h, y, dirA, spread, count, speed, big = false) {
    const c = C('#6e0808'), c2 = C('#9a1010');
    for (let k = 0; k < count; k++) {
      const a = dirA + (R() - 0.5) * spread, s = speed * (0.3 + R() * 0.9);
      fx.spawn(x, h, y, Math.cos(a) * s, 30 + R() * 110, Math.sin(a) * s, 0.45 + R() * 0.4, (big ? 2.6 : 1.8) + R() * 1.2, 1, k % 2 ? c : c2, 0.95, FR.CHUNK, F_BOUNCE, 650, 0.6);
    }
    fx.spawn(x, h, y, Math.cos(dirA) * 30, 10, Math.sin(dirA) * 30, 0.35, big ? 9 : 5, big ? 26 : 16, C('#5a0606'), 0.55, FR.MIST, 0, 0, 3);
  }
  function fireball(x, h, y, count, size, speed, life = 0.6, color = WHITE) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, up = R() * 0.9, s = speed * (0.3 + R() * 0.7);
      const i = fx.spawn(x + Math.cos(a) * size * 0.2, h + R() * size * 0.3, y + Math.sin(a) * size * 0.2,
        Math.cos(a) * s * (1 - up * 0.5), s * up + 40, Math.sin(a) * s * (1 - up * 0.5),
        life * (0.6 + R() * 0.7), size * (0.5 + R() * 0.5), size * (1.3 + R() * 0.6), color, 1, R() < 0.3 ? FR.GLOW : FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -60, 2.2);
      fx.stretchLast(i, 1.2);
    }
  }
  function smoke(x, h, y, count, size, life, color, alpha, rise = 30, spreadR = 20) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, r = R() * spreadR;
      fx.spawn(x + Math.cos(a) * r, h + R() * size * 0.5, y + Math.sin(a) * r, Math.cos(a) * 12, rise * (0.5 + R()), Math.sin(a) * 12,
        life * (0.6 + R() * 0.8), size * (0.6 + R() * 0.4), size * (2 + R()), color, alpha, R() < 0.5 ? FR.SMOKE : FR.SMOKE2, 0, -rise * 0.2, 0.8);
    }
  }
  function debris(x, h, y, count, color, speed, size = 2.5) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = speed * (0.3 + R() * 0.8);
      fx.spawn(x, h, y, Math.cos(a) * s, 120 + R() * speed * 1.4, Math.sin(a) * s, 1.2 + R() * 1.2, size * (0.6 + R()), size * 0.5, color, 1, R() < 0.5 ? FR.CHUNK : FR.SQUARE, F_BOUNCE | F_SPIN, 800, 0.3);
    }
  }
  function ring(x, h, y, size, life, color, alpha, flat = true, frame = FR.RING) {
    const i = fx.spawn(x, h, y, 0, 0, 0, life, size * 0.1, size, color, alpha, frame, F_ADD | (flat ? F_FLAT : 0), 0, 0);
    return i;
  }
  function glowPuff(x, h, y, size, life, color, alpha = 1) {
    fx.spawn(x, h, y, 0, 0, 0, life, size, size * 1.3, color, alpha, FR.GLOW, F_ADD, 0, 0);
  }
  function sparkles(x, y, count, color, h = 14) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = 20 + R() * 50;
      fx.spawn(x + Math.cos(a) * 8, h + R() * 10, y + Math.sin(a) * 8, Math.cos(a) * s, 30 + R() * 60, Math.sin(a) * s, 0.6 + R() * 0.5, 3 + R() * 2, 1, color, 1, R() < 0.5 ? FR.STAR : FR.DOT, F_ADD | F_FLICKER, -10, 2);
    }
  }

  // ---- shot origins ---------------------------------------------------------------------
  const _org = { x: 0, h: 0, y: 0 };
  function shotOrigin(e, isLocal) {
    if (isLocal && fx.localMuzzle.valid && now - fx.localMuzzle.now < 0.25) {
      _org.x = fx.localMuzzle.x; _org.h = fx.localMuzzle.h; _org.y = fx.localMuzzle.y;
      return _org;
    }
    if (e.pid) {
      const m = fx.muzzles.get(e.pid);
      if (m && now - m.now < 0.25 && Math.hypot(m.x - e.x, m.y - e.y) < 60) {
        _org.x = m.x; _org.h = m.h; _org.y = m.y;
        return _org;
      }
    }
    const extra = e.pid ? 10 : 8;
    _org.x = e.x + Math.cos(e.angle) * extra;
    _org.y = e.y + Math.sin(e.angle) * extra;
    _org.h = e.turret ? 34 : 38;
    return _org;
  }

  function endHeight(isLocal, r, org) {
    if (isLocal) {
      // tracers go where the camera aims: bullets are horizontal in the sim, but the
      // player looks up/down at what they shoot
      const d = Math.hypot(r.x - camX, r.y - camY);
      const h = EYE + Math.tan(pitch) * d;
      if (r.hit === 1) return Math.max(10, Math.min(70, h));
      return Math.max(1, Math.min(260, h));
    }
    return r.hit === 1 ? 34 : org.h;
  }

  // ---- event handlers -----------------------------------------------------------------------
  let tracerBudget = 0;

  function shot(e) {
    if (e.echo) return;                           // already drawn as the predicted shot
    const w = WEAPONS[e.weapon];
    if (!w) return;
    const isLocal = !!e.pid && e.pid === localId;
    const org = shotOrigin(e, isLocal);
    const ox = org.x, oh = org.h, oy = org.y;
    const rays = e.rays || [];
    const tr = C(w.tracer || '#ffe9a8');
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    if (w.kind === 'rail') {
      const end = rays.length ? rays[0] : { x: ox + ca * w.range, y: oy + sa * w.range, hit: 0 };
      const bh = endHeight(isLocal, end, org);
      rails.push({ ax: ox, ah: oh, ay: oy, bx: end.x, bh, by: end.y, age: 0, life: 0.55, color: tr });
      ctx.lights.flash(ox, oy, oh, '#b388ff', 3, 320, 0.3);
      ctx.lights.flash(end.x, end.y, bh, '#b388ff', 2, 240, 0.3);
      sparks(end.x, bh, end.y, e.angle + Math.PI, 2.4, high ? 16 : 8, 420, C('#d8c0ff'));
      // spiral of motes along the beam
      const L = Math.hypot(end.x - ox, end.y - oy);
      const n = Math.min(high ? 60 : 24, Math.floor(L / 24));
      for (let k = 0; k < n; k++) {
        const t = k / n, ang = t * 40;
        const px = ox + (end.x - ox) * t, py = oy + (end.y - oy) * t, ph = oh + (bh - oh) * t;
        const nx = -sa, ny = ca;
        const off = Math.cos(ang) * 4;
        fx.spawn(px + nx * off, ph + Math.sin(ang) * 4, py + ny * off, nx * off * 3, Math.sin(ang) * 12, ny * off * 3, 0.5 + R() * 0.3, 2.4, 0.4, C('#c8a8ff'), 0.9, FR.DOT, F_ADD, 0, 1);
      }
      for (const r of rays) if (r.hit === 1) blood(r.x, 34, r.y, e.angle, 1.2, high ? 8 : 4, 200, true);
      if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.2, '#b388ff');
      return;
    }
    if (w.kind === 'hitscan') {
      const big = w.category === 'sniper' || e.weapon === 'magnum';
      const shotgun = w.category === 'shotgun';
      const width = big ? 1.8 : shotgun ? 0.75 : 1.1;
      for (let k = 0; k < rays.length; k++) {
        const r = rays[k];
        if (!r) continue;
        const bh = endHeight(isLocal, r, org);
        if (tracerBudget > 0 || k === 0) {
          tracerBudget--;
          const len = Math.hypot(r.x - ox, r.y - oy, bh - oh);
          if (len > 4 && tracers.length < 400) {
            tracers.push({ ax: ox, ah: oh, ay: oy, bx: r.x, bh, by: r.y, len, age: 0, color: tr, w: width, trail: Math.min(len, big ? 420 : shotgun ? 90 : 190) });
          }
        }
        if (r.hit === 1) {
          blood(r.x, bh, r.y, e.angle, 1.3, high ? (isLocal ? 6 : 4) : 2, 170);
        } else if (r.hit === 2) {
          sparks(r.x, bh, r.y, e.angle + Math.PI, 2.2, high ? 6 : 3, 320);
          glowPuff(r.x, bh, r.y, 6, 0.06, C('#ffcf80'), 0.8);
          if (high || R() < 0.5) dust(r.x, bh, r.y, 1, 7, C('#6a655c'), 25, 0.6, 0.35, e.angle + Math.PI, 1.2);
        }
      }
      if (!isLocal) {
        const size = shotgun ? 1.5 : big ? 1.6 : w.category === 'heavy' ? 1.25 : w.category === 'pistol' ? 0.8 : 1.0;
        muzzleFlash(ox, oh, oy, e.angle, size, '#ffc070');
      } else {
        // the viewmodel draws its own flash; the world still gets the light
        ctx.lights.flash(ox, oy, oh, '#ffc070', 2.4, 260, 0.06);
        if (high && R() < 0.5) smoke(ox + ca * 6, oh, oy + sa * 6, 1, 4, 0.5, C('#8a8a8a'), 0.18, 15, 2);
      }
      return;
    }
    if (w.kind === 'flame') {
      // the jet near the nozzle; flame projectiles (items3d) carry it further
      for (let k = 0; k < (high ? 3 : 2); k++) {
        const a = e.angle + (R() - 0.5) * 0.18, s = 480 + R() * 160;
        const start = isLocal ? 6 : 2;
        const i = fx.spawn(ox + ca * start, oh - 1, oy + sa * start, Math.cos(a) * s, 14 + R() * 20, Math.sin(a) * s, 0.28 + R() * 0.12, 3, 26 + R() * 14, WHITE, 0.9, FR.FLAME, F_ADD | F_FIRE | F_FLICKER, -30, 2.5);
        fx.stretchLast(i, 1);
      }
      if (R() < 0.3) ctx.lights.flash(ox + ca * 60, oy + sa * 60, oh, '#ff9a40', 1.6, 220, 0.12);
      return;
    }
    if (w.kind === 'projectile') {
      const kind = w.projectile && w.projectile.kind;
      if (kind === 'rocket') {
        if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.6, '#ffb050');
        ctx.lights.flash(ox, oy, oh, '#ffb050', 3, 300, 0.15);
        // back-blast out of the rear of the tube
        const bx = ox - ca * 40, by = oy - sa * 40;
        smoke(bx, oh, by, high ? 10 : 5, 10, 1.4, C('#9a968e'), 0.4, 12, 8);
        for (let k = 0; k < 8; k++) {
          const a = e.angle + Math.PI + (R() - 0.5) * 0.7, s = 200 + R() * 150;
          fx.spawn(bx, oh, by, Math.cos(a) * s, R() * 30, Math.sin(a) * s, 0.25, 6, 18, WHITE, 1, FR.FLAME, F_ADD | F_FIRE, 0, 4);
        }
      } else if (kind === 'grenade') {
        if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.1, '#ffc070');
        ctx.lights.flash(ox, oy, oh, '#ffc070', 1.8, 200, 0.08);
        smoke(ox, oh, oy, 3, 6, 0.9, C('#a09a90'), 0.3, 10, 4);
      }
      return;
    }
    if (w.kind === 'chain') {
      if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 0.9, '#80d8ff');
    }
  }

  function muzzleFlash(x, h, y, a, size, color) {
    const c = C(color);
    // a star facing the camera plus a side-on tongue along the barrel
    glowPuff(x, h, y, 9 * size, 0.06, c, 1);
    fx.spawn(x, h, y, 0, 0, 0, 0.05, 14 * size, 12 * size, C('#fff2c0'), 1, FR.STAR, F_ADD, 0, 0);
    const i = fx.spawn(x + Math.cos(a) * 7 * size, h, y + Math.sin(a) * 7 * size, 0, 0, 0, 0.05, 8 * size, 8 * size, c, 0.9, FR.FLASH, F_ADD, 0, 0);
    fx.stretchLast(i, 0.6);
    ctx.lights.flash(x, y, h, color, 2.2 * Math.min(1.4, size), 200 + 60 * size, 0.07);
  }

  function explosion(x, y, r, kind) {
    const bloat = kind === 'bloater';
    const d = distCam(x, y);
    if (bloat) {
      // gore burst: green-grey mist and chunks (zombies3d throws the gibs)
      ctx.lights.flash(x, y, 30, '#b8ff6a', 2.4, r * 2.6, 0.35);
      fx.spawn(x, 26, y, 0, 0, 0, 0.25, r * 0.6, r * 1.5, C('#c8ff8a'), 0.8, FR.GLOW, F_ADD, 0, 0);
      for (let k = 0; k < (high ? 16 : 8); k++) {
        const a = R() * TAU, s = 80 + R() * 160;
        fx.spawn(x, 20 + R() * 16, y, Math.cos(a) * s, 30 + R() * 80, Math.sin(a) * s, 1.1 + R() * 0.8, 14, 40 + R() * 20, C('#5f7a2e'), 0.55, FR.SMOKE, 0, -10, 2);
      }
      blood(x, 26, y, 0, TAU, high ? 20 : 10, 260, true);
      ring(x, 2, y, r * 2, 0.35, C('#a8e060'), 0.6);
      ctx.ground.decal('acid', x, y, r * 0.45, R() * TAU, 0.8);
      shakeAt(x, y, 0.45, 1000);
      return;
    }
    const rocket = kind === 'rocket';
    ctx.lights.flash(x, y, 50, '#ffb060', rocket ? 4.5 : 3.6, r * 3.2, 0.45);
    // hot core flash
    // a short hot flash, then an orange fireball (kept below white so ACES doesn't blow it out)
    fx.spawn(x, 30, y, 0, 0, 0, 0.14, r * 0.8, r * 1.6, C('#ffc890'), 0.8, FR.GLOW, F_ADD, 0, 0);
    fx.spawn(x, 30, y, 0, 0, 0, 0.1, r * 0.7, r * 1.1, C('#fff0d0'), 0.55, FR.STAR, F_ADD, 0, 0);
    fireball(x, 20, y, high ? 30 : 14, r * 0.28, r * 1.6, 0.75, C('#ffa860'));
    ring(x, 3, y, r * 2.6, 0.45, C('#ffd8a0'), 0.9);
    ring(x, 30, y, r * 2.2, 0.3, C('#ffe8c0'), 0.4, false, FR.SOFTRING);
    sparks(x, 20, y, 0, TAU, high ? 26 : 12, 600, C('#ffc060'));
    debris(x, 10, y, high ? 14 : 6, C('#2a2622'), 260, 3);
    // smoke column: dark, slow, lingering
    smoke(x, 20, y, high ? 14 : 6, r * 0.22, 3.2, C('#2a2826'), 0.55, 45, r * 0.3);
    smoke(x, 10, y, high ? 6 : 3, r * 0.3, 1.6, C('#6a5040'), 0.35, 20, r * 0.4);
    ctx.ground.decal('scorch', x, y, r * 0.42, R() * TAU, 0.95);
    shakeAt(x, y, Math.min(1, (r / 160) * 0.95), 1400);
    if (d < r) ctx.shake(1);
  }

  function handle(e) {
    switch (e.type) {
      case 'shot': shot(e); break;
      case 'chain': {
        const pts = e.points || [];
        if (pts.length < 2) break;
        const isLocal = e.pid && e.pid === localId;
        const arr = [];
        for (let k = 0; k < pts.length; k++) {
          let h = 36;
          let x = pts[k].x, y = pts[k].y;
          if (k === 0) {
            const o = shotOrigin({ pid: e.pid, x, y, angle: Math.atan2(pts[1].y - y, pts[1].x - x) }, isLocal);
            x = o.x; y = o.y; h = o.h;
          }
          arr.push(x, h, y);
        }
        arcs.push({ pts: arr, age: 0, life: 0.2, seed: R() * 100, w: 1 });
        for (let k = 1; k < pts.length; k++) {
          sparks(pts[k].x, 36, pts[k].y, 0, TAU, high ? 6 : 3, 280, C('#a0e8ff'));
          glowPuff(pts[k].x, 36, pts[k].y, 18, 0.15, C('#80d8ff'), 0.8);
        }
        ctx.lights.flash(pts[0].x, pts[0].y, 40, '#80d8ff', 2.6, 260, 0.12);
        const m = pts[Math.min(pts.length - 1, 2)];
        ctx.lights.flash(m.x, m.y, 36, '#80d8ff', 2, 220, 0.14);
        break;
      }
      case 'melee': {
        if (e.hits > 0) {
          const x = e.x + Math.cos(e.angle) * 40, y = e.y + Math.sin(e.angle) * 40;
          blood(x, 36, y, e.angle, 1.4, 4 + e.hits * 2, 160);
          if (e.pid === localId) ctx.shake(0.12);
        }
        break;
      }
      case 'spit': {
        const a = e.angle || 0;
        const x = e.x + Math.cos(a) * 14, y = e.y + Math.sin(a) * 14;
        for (let k = 0; k < (high ? 10 : 5); k++) {
          const aa = a + (R() - 0.5) * 0.9, s = 60 + R() * 120;
          fx.spawn(x, 50, y, Math.cos(aa) * s, 20 + R() * 60, Math.sin(aa) * s, 0.6, 2.5, 1, C('#a6ff3a'), 1, FR.DOT, F_ADD | F_BOUNCE, 500, 1);
        }
        ctx.lights.flash(x, y, 48, '#a6ff4a', 1.2, 140, 0.25);
        break;
      }
      case 'scream':
        fx.spawn(e.x, 52, e.y, 0, 0, 0, 0.7, 10, 240, C('#d8c8ff'), 0.55, FR.SOFTRING, F_ADD, 0, 0);
        fx.spawn(e.x, 52, e.y, 0, 0, 0, 0.5, 10, 170, C('#b890ff'), 0.45, FR.SOFTRING, F_ADD, 0, 0);
        ring(e.x, 2, e.y, 480, 0.8, C('#c0a0ff'), 0.4);
        shakeAt(e.x, e.y, 0.14, 500);
        break;
      case 'charge': {
        const a = (e.angle || 0) + Math.PI;
        dust(e.x + Math.cos(a) * 20, 4, e.y + Math.sin(a) * 20, high ? 10 : 5, 22, C('#5d5040'), 120, 1, 0.45, a, 1.8);
        break;
      }
      case 'slam': {
        const r = e.r || 190;
        ring(e.x, 2, e.y, r * 2.1, 0.5, C('#ffe6c0'), 0.9);
        ring(e.x, 2, e.y, r * 1.4, 0.35, C('#c8a070'), 0.7);
        fx.spawn(e.x, 30, e.y, 0, 0, 0, 0.5, 20, r * 2, C('#e0c8a0'), 0.35, FR.SOFTRING, F_ADD, 0, 0);
        dust(e.x, 4, e.y, high ? 26 : 12, 34, C('#5a5044'), r * 1.2, 1.3, 0.5);
        debris(e.x, 4, e.y, high ? 18 : 8, C('#5d5a55'), 300, 3.2);
        ctx.ground.decal('scorch', e.x, e.y, r * 0.35, R() * TAU, 0.5);
        ctx.lights.flash(e.x, e.y, 20, '#ffdcb0', 1.5, r * 2, 0.2);
        shakeAt(e.x, e.y, 0.9, 1400);
        break;
      }
      case 'explosion': explosion(e.x, e.y, e.r || 150, e.kind); break;
      case 'ignite': {
        const r = e.r || 110;
        fireball(e.x, 6, e.y, high ? 36 : 16, 22, r * 1.8, 0.8, C('#ffa860'));
        for (let k = 0; k < 10; k++) {
          const a = R() * TAU, s = 80 + R() * 140;
          fx.spawn(e.x, 20, e.y, Math.cos(a) * s, 60 + R() * 90, Math.sin(a) * s, 1, 2.4, 1.6, C('#c8e8d8'), 0.9, FR.SHARD, F_ADD | F_BOUNCE | F_SPIN, 700, 0.5);
        }
        glowPuff(e.x, 20, e.y, r * 1.2, 0.3, C('#ff9a40'), 0.9);
        ctx.lights.flash(e.x, e.y, 30, '#ff9a40', 3, r * 3, 0.6);
        ctx.ground.decal('scorch', e.x, e.y, r * 0.55, R() * TAU, 0.6);
        shakeAt(e.x, e.y, 0.18, 900);
        break;
      }
      case 'pdamage': {
        const p = players.get(e.pid);
        if (e.pid === localId) {
          ctx.shake(Math.min(0.35, 0.08 + (e.amount || 0) / 120));
        } else if (p) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          blood(p.x, 36, p.y, a, 1.4, Math.min(8, 2 + Math.round((e.amount || 0) / 6)), 150);
        }
        break;
      }
      case 'down': {
        const p = players.get(e.pid);
        if (p) {
          blood(p.x, 20, p.y, 0, TAU, high ? 14 : 6, 120, true);
          ctx.ground.decal('blood', p.x, p.y, 22, R() * TAU, 0.9);
        }
        break;
      }
      case 'revived': case 'respawn': {
        const p = players.get(e.pid);
        if (p) {
          const c = C(e.type === 'revived' ? '#7dff9a' : '#dfefff');
          ring(p.x, 2, p.y, 140, 0.6, c, 0.9);
          sparkles(p.x, p.y, high ? 22 : 10, c, 10);
          ctx.lights.flash(p.x, p.y, 30, e.type === 'revived' ? '#7dff9a' : '#dfefff', 1.8, 200, 0.6);
        }
        break;
      }
      case 'died': {
        const p = players.get(e.pid);
        if (p) dust(p.x, 4, p.y, 6, 16, C('#4a463e'), 40);
        break;
      }
      case 'pickup': {
        const c = C(PICKUP_GLOW[e.kind] || '#ffffff');
        sparkles(e.x, e.y, high ? 16 : 8, c);
        ring(e.x, 2, e.y, 70, 0.35, c, 0.8);
        break;
      }
      case 'place':
        dust(e.x, 3, e.y, high ? 10 : 5, 16, C('#5a554c'), 70, 0.8, 0.4);
        break;
      case 'destroyed':
        if (e.kind === 'turret') {
          muzzleFlash(e.x, 30, e.y, 0, 2.4, '#ffb050');
          fireball(e.x, 26, e.y, high ? 14 : 7, 12, 140, 0.5);
          sparks(e.x, 30, e.y, 0, TAU, high ? 20 : 10, 420);
          debris(e.x, 30, e.y, high ? 12 : 6, C('#4a4d50'), 220, 2.6);
          smoke(e.x, 30, e.y, 8, 10, 2, C('#2e2c2a'), 0.5, 30, 10);
          ctx.ground.decal('scorch', e.x, e.y, 26, R() * TAU, 0.8);
          shakeAt(e.x, e.y, 0.25, 900);
        } else {
          debris(e.x, 24, e.y, high ? 22 : 10, C('#7a5a36'), 240, 3);
          dust(e.x, 10, e.y, high ? 12 : 6, 20, C('#5d5448'), 110, 0.9, 0.45);
        }
        break;
      case 'objhit':
        sparks(e.x, 30 + R() * 30, e.y, R() * TAU, 2.5, high ? 6 : 3, 260);
        debris(e.x, 40, e.y, 2, C('#55585c'), 120, 1.8);
        break;
      case 'drop': {
        crates.push({ x: e.x, y: e.y, age: 0 });
        if (crates.length > crateMeshes.length) crates.shift();
        emitters.push({ kind: 'flare', x: e.x + 22, y: e.y - 12, age: 0, life: 9, acc: 0 });
        break;
      }
      case 'bossspawn':
        dust(e.x, 4, e.y, high ? 30 : 14, 40, C('#4a4238'), 260, 1.6, 0.5);
        debris(e.x, 6, e.y, high ? 16 : 8, C('#55524c'), 320, 3.5);
        ring(e.x, 2, e.y, 520, 0.7, C('#c080ff'), 0.8);
        ctx.ground.decal('scorch', e.x, e.y, 70, R() * TAU, 0.8);
        ctx.lights.flash(e.x, e.y, 40, '#c080ff', 3, 420, 0.8);
        shakeAt(e.x, e.y, 0.7, 1600);
        break;
      default:
        break;
    }
  }

  // ---- per-frame --------------------------------------------------------------------------
  const _j = [];
  function update(view, frame) {
    fx.begin(frame);
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || 0;
    localId = frame.localId || localId;
    camX = frame.camX; camY = frame.camY;
    pitch = frame.pitch || 0;
    tracerBudget = high ? 48 : 20;
    players.clear();
    if (view && view.players) for (const p of view.players) players.set(p.id, p);

    // tracers: a bright head running from the muzzle to the hit point, trailing a tail
    let w = 0;
    for (let k = 0; k < tracers.length; k++) {
      const t = tracers[k];
      t.age += dt;
      const head = t.age * TRACER_SPEED;
      if (head - t.trail > t.len) continue;
      tracers[w++] = t;
      const h1 = Math.min(t.len, head), h0 = Math.max(0, head - t.trail);
      if (h1 <= h0) continue;
      const k1 = h1 / t.len, k0 = h0 / t.len;
      fx.beam(t.ax + (t.bx - t.ax) * k0, t.ah + (t.bh - t.ah) * k0, t.ay + (t.by - t.ay) * k0,
        t.ax + (t.bx - t.ax) * k1, t.ah + (t.bh - t.ah) * k1, t.ay + (t.by - t.ay) * k1,
        t.w * 0.25, t.w, t.color, 1, 0.9, 0.9, 0);
    }
    tracers.length = w;

    // rail beams: thick, glowing, fading and thinning
    w = 0;
    for (let k = 0; k < rails.length; k++) {
      const b = rails[k];
      b.age += dt;
      if (b.age > b.life) continue;
      rails[w++] = b;
      const f = 1 - b.age / b.life;
      fx.beam(b.ax, b.ah, b.ay, b.bx, b.bh, b.by, 5 * f + 1.5, 5 * f + 1.5, b.color, 1.4 * f, 1, 0, 0.05);
      fx.beam(b.ax, b.ah, b.ay, b.bx, b.bh, b.by, 16 * f, 22 * f, b.color, 0.35 * f, 0, 0, 0.1);
    }
    rails.length = w;

    // tesla arcs: jagged, re-jittered ~30 times a second
    w = 0;
    const blue = C('#9fe6ff'), white = C('#e8faff');
    for (let k = 0; k < arcs.length; k++) {
      const a = arcs[k];
      a.age += dt;
      if (a.age > a.life) continue;
      arcs[w++] = a;
      const f = 1 - a.age / a.life;
      const seed = Math.floor(now * 30) + a.seed;
      const P = a.pts;
      for (let s = 0; s + 5 < P.length; s += 3) {
        const x0 = P[s], h0 = P[s + 1], y0 = P[s + 2], x1 = P[s + 3], h1 = P[s + 4], y1 = P[s + 5];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const seg = Math.max(3, Math.min(9, Math.round(L / 22)));
        _j.length = 0;
        _j.push(x0, h0, y0);
        for (let q = 1; q < seg; q++) {
          const t = q / seg;
          const n = (hashf(seed + s * 7 + q * 13) - 0.5) * L * 0.18;
          const m = (hashf(seed * 3 + s + q * 31) - 0.5) * 16;
          _j.push(x0 + (x1 - x0) * t - ((y1 - y0) / (L || 1)) * n, h0 + (h1 - h0) * t + m, y0 + (y1 - y0) * t + ((x1 - x0) / (L || 1)) * n);
        }
        _j.push(x1, h1, y1);
        for (let q = 0; q + 5 < _j.length; q += 3) {
          fx.beam(_j[q], _j[q + 1], _j[q + 2], _j[q + 3], _j[q + 4], _j[q + 5], 1.4, 1.4, white, 1.2 * f, 1, 0, 0);
          fx.beam(_j[q], _j[q + 1], _j[q + 2], _j[q + 3], _j[q + 4], _j[q + 5], 7, 7, blue, 0.35 * f, 0, 0, 0);
        }
      }
    }
    arcs.length = w;

    // lingering emitters (supply flare)
    w = 0;
    for (let k = 0; k < emitters.length; k++) {
      const em = emitters[k];
      em.age += dt;
      if (em.age > em.life) continue;
      emitters[w++] = em;
      if (em.kind === 'flare') {
        em.acc += dt * (high ? 14 : 7);
        while (em.acc >= 1) {
          em.acc -= 1;
          fx.spawn(em.x + (R() - 0.5) * 4, 4, em.y + (R() - 0.5) * 4, (R() - 0.5) * 10, 40 + R() * 20, (R() - 0.5) * 10, 3 + R(), 5, 34, C('#c83a2a'), 0.35, FR.SMOKE, 0, -4, 0.3);
        }
        fx.glow(em.x, 5, em.y, 14 + Math.sin(now * 30) * 2, C('#ff5a3a'), 1);
        ctx.lights.steady('flare' + k, em.x, em.y, 12, '#ff4a2a', 1.4 * Math.min(1, (em.life - em.age) / 1.5), 220);
      }
    }
    emitters.length = w;

    // falling supply crates
    w = 0;
    for (let k = 0; k < crates.length; k++) {
      const c = crates[k];
      c.age += dt;
      if (c.age > 1.6) continue;
      crates[w++] = c;
    }
    crates.length = w;
    for (let k = 0; k < crateMeshes.length; k++) {
      const m = crateMeshes[k], c = crates[k];
      if (!c) { m.visible = false; continue; }
      const fallT = 0.45;
      const t = Math.min(1, c.age / fallT);
      m.visible = c.age < 1.4;
      m.position.set(c.x, (1 - t * t) * 320, c.y);
      m.rotation.set(0, c.age * 0.8, 0);
      if (!c.landed && t >= 1) {
        c.landed = true;
        dust(c.x, 4, c.y, high ? 24 : 12, 26, C('#5a5448'), 220, 1.3, 0.5);
        ring(c.x, 2, c.y, 190, 0.45, C('#ffe0a0'), 0.7);
        shakeAt(c.x, c.y, 0.25, 1000);
      }
      if (c.age > 1.0) m.position.y -= (c.age - 1.0) * 60;      // sink away as the pickup takes over
    }
  }

  return {
    update,
    addEvents(events, opts) {
      if (opts && opts.localId != null) localId = opts.localId;
      if (!events) return;
      for (let k = 0; k < events.length; k++) handle(events[k]);
    },
    setQuality(q) {
      high = q !== 'low';
      fx.setQuality(q);
    },
    dispose() {
      for (const m of crateMeshes) m.removeFromParent();
      crateGeo.dispose();
      crateMat.dispose();
      releaseFx(ctx);
    },
    /** Test hook: live effect counts. */
    get stats() { return { tracers: tracers.length, arcs: arcs.length, rails: rails.length, ...fx.stats }; },
  };
}

function hashf(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export { createEffects3D as createEffects };
