// Event-driven effects in the first-person view (ACTORS, SPEC §7.5): glowing tracers from
// every shot ray (HDR, they bloom), muzzle flashes, impacts (sparks, dust, chips and a
// bullet hole on the obstacle, oriented by its surface), blood spurts and mist on flesh
// hits, explosions (a white-hot core flash, a rolling fireball, a shockwave ring, debris,
// a dust ring and a smoke column that glows while it is hot), molotov bursts, branching
// tesla arcs, rail beams with a smoke trail, acid spit, screams, boss slams, brute charge
// dust, pickup sparkle, place/destroy puffs, the supply crate drop and damage feedback.
// Everything is drawn through the shared pools in fx-core.js (four draw calls for all of
// it) plus the renderer's light pool (lights.flash) and ground decals (ctx.ground).
//
// Shot rules (SPEC §4.1): `echo` shots are never drawn again; the local player's shots
// (predicted on clients) start at the viewmodel muzzle, which viewmodel.js publishes in
// fx.localMuzzle every frame; teammates' shots start at the muzzle players3d publishes.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { acquireFx, releaseFx, F_ADD, F_FLAT, F_STREAK, F_BOUNCE, F_FIRE, F_FLICKER, F_SPIN, F_VSTRETCH, F_HOT, FR } from './fx-core.js';
import { col } from './actor-kit.js';
import { crateGeometry } from './items3d.js';
import { gunMaterials } from './actor-guns.js';

const TAU = Math.PI * 2;
const TRACER_SPEED = 7200;
const EYE = 52;

const PICKUP_GLOW = { ammo: '#ffd54f', health: '#ff5252', cash: '#7dff9a', armor: '#64b5f6', frag: '#ffb74d', crate: '#ffe082' };

/** HDR copy of a colour (values above 1 bloom). */
function hdr(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createEffects3D(ctx) {
  const fx0 = acquireFx(ctx);
  // cross-module publishing points (see file header)
  if (!fx0.localMuzzle) fx0.localMuzzle = { x: 0, h: 0, y: 0, now: -1, valid: false };
  if (!fx0.muzzles) fx0.muzzles = new Map();
  // Terrain (campaign maps): effects are written for a flat ground at y = 0. `gOff` is the
  // ground height under the effect being emitted; the wrappers below add it to every height.
  // Shots use absolute heights (muzzles, aim), so their handler runs with gOff = 0.
  const G = ctx.groundY || (() => 0);
  const rough = !!ctx.terrain && !ctx.terrain.flat;
  let gOff = 0;
  const fx = rough ? Object.create(fx0) : fx0;
  const L = ctx.lights;
  const lights = rough ? {
    flash: (x, y, h, ...a) => L.flash(x, y, h + gOff, ...a),
    steady: (key, x, y, h, ...a) => L.steady(key, x, y, h + gOff, ...a),
  } : L;
  if (rough) {
    fx.spawn = (x, h, y, ...a) => fx0.spawn(x, h + gOff, y, ...a);
    fx.glow = (x, h, y, ...a) => fx0.glow(x, h + gOff, y, ...a);
    fx.decal = (x, h, y, ...a) => fx0.decal(x, h + gOff, y, ...a);
    fx.beam = (ax, ah, ay, bx, bh, by, ...a) => fx0.beam(ax, ah + gOff, ay, bx, bh + gOff, by, ...a);
  }
  let high = ctx.quality !== 'low';
  let ultra = ctx.quality === 'ultra';
  let localId = 0;
  let now = 0;
  let camX = 0, camY = 0, camH = EYE, pitch = 0;
  const R = fx.rng;
  const surf = surfaceIndex(ctx);

  const tracers = [];      // { ax, ah, ay, bx, bh, by, len, age, color, w, trail }
  const arcs = [];         // { pts, age, life, seed }
  const rails = [];        // { ax, ah, ay, bx, bh, by, age, life, color }
  const emitters = [];     // { kind, x, y, age, life, acc }
  const crates = [];       // falling supply crates { x, y, age }
  const players = new Map();

  // supply-drop crate on a parachute (falls for a moment before the pickup appears)
  const crateGeo = crateGeometry(true);
  const crateMat = gunMaterials().std;         // shared (released by releaseSharedGuns)
  const crateMeshes = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(crateGeo, crateMat);
    m.visible = false;
    ctx.scene.add(m);
    crateMeshes.push(m);
  }

  const C = (hex) => col(hex);
  const WHITE = new THREE.Color(1, 1, 1);
  // flame tongues: the fire ramp times a warm base, so the dense overlap of a jet adds up to
  // orange instead of saturating to a white blob
  const FLAME_BASE = new THREE.Color(1, 0.78, 0.55);
  const HOT_SPARK = hdr('#ffc070', 3.2), HOT_CORE = hdr('#fff2d8', 3.2), FIRE_TINT = new THREE.Color(1, 1, 1);
  const BLOOD = C('#5a0606'), BLOOD2 = C('#7a0a0a'), MIST = C('#4a0505');
  const FROST_MIST = C('#dff4ff'), ICE_GLINT = hdr('#c8f0ff', 2.4), ICE_SHARD = hdr('#bfe8ff', 1.3);

  function distCam(x, y) { return Math.hypot(x - camX, y - camY); }
  function shakeAt(x, y, amount, range) {
    const d = distCam(x, y);
    const k = Math.max(0, 1 - d / range);
    if (k > 0) ctx.shake(Math.min(1, amount * k));
  }

  // ---- primitive emitters -------------------------------------------------------------
  function sparks(x, h, y, dirA, spread, count, speed, color = HOT_SPARK) {
    for (let k = 0; k < count; k++) {
      if (fx.load() > 0.95) return;
      const a = dirA + (R() - 0.5) * spread, s = speed * (0.4 + R() * 0.8);
      const up = (R() * 0.9 - 0.1) * speed * 0.7;
      const i = fx.spawn(x, h, y, Math.cos(a) * s, up, Math.sin(a) * s, 0.12 + R() * 0.25, 0.8 + R() * 0.6, 0.4, color, 1, FR.DOT, F_ADD | F_STREAK | F_BOUNCE, 700, 1.5);
      fx.stretchLast(i, 1);
    }
  }
  function dust(x, h, y, count, size, color, speed = 30, life = 0.9, alpha = 0.4, dirA = null, spread = TAU) {
    for (let k = 0; k < count; k++) {
      const a = dirA == null ? R() * TAU : dirA + (R() - 0.5) * spread, s = speed * (0.3 + R());
      fx.spawn(x + (R() - 0.5) * size * 0.4, h + R() * size * 0.3, y + (R() - 0.5) * size * 0.4, Math.cos(a) * s, 8 + R() * 16, Math.sin(a) * s,
        life * (0.7 + R() * 0.6), size * 0.5, size * (1.4 + R()), color, alpha, R() < 0.5 ? FR.DUST : FR.SMOKE3, 0, -4, 1.8);
    }
  }
  function chips(x, h, y, dirA, count, color, speed = 160, size = 0.9) {
    for (let k = 0; k < count; k++) {
      const a = dirA + (R() - 0.5) * 1.8, s = speed * (0.4 + R());
      const i = fx.spawn(x, h, y, Math.cos(a) * s, 40 + R() * speed * 0.8, Math.sin(a) * s, 0.5 + R() * 0.6, size * (0.6 + R() * 0.8), size * 0.6, color, 1, FR.CHUNK, F_BOUNCE | F_SPIN, 650, 0.5);
      void i;
    }
  }
  function blood(x, h, y, dirA, spread, count, speed, big = false) {
    // droplets stretched along their flight, a fine mist, a splat on the ground
    for (let k = 0; k < count; k++) {
      const a = dirA + (R() - 0.5) * spread, s = speed * (0.3 + R() * 0.9);
      const i = fx.spawn(x, h + (R() - 0.5) * 4, y, Math.cos(a) * s, 20 + R() * 120, Math.sin(a) * s, 0.4 + R() * 0.4, (big ? 1.6 : 1.1) + R() * 0.8, 0.9, k % 2 ? BLOOD : BLOOD2, 0.95, FR.DROP, F_BOUNCE | F_VSTRETCH, 650, 0.6);
      fx.velStretch(i, 0.02);
    }
    fx.spawn(x, h, y, Math.cos(dirA) * 25, 8, Math.sin(dirA) * 25, 0.4 + R() * 0.2, big ? 7 : 4, big ? 22 : 13, MIST, 0.6, FR.MIST, 0, 0, 3);
    if (high) fx.spawn(x, h, y, Math.cos(dirA) * 40, 4, Math.sin(dirA) * 40, 0.3, big ? 5 : 3, big ? 16 : 10, BLOOD, 0.35, FR.SMOKE5, 0, 0, 3);
  }
  function fireball(x, h, y, count, size, speed, life = 0.6, color = FIRE_TINT, alpha = 0.55) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, up = R() * 0.9, s = speed * (0.3 + R() * 0.7);
      const i = fx.spawn(x + Math.cos(a) * size * 0.2, h + R() * size * 0.3, y + Math.sin(a) * size * 0.2,
        Math.cos(a) * s * (1 - up * 0.5), s * up + 40, Math.sin(a) * s * (1 - up * 0.5),
        life * (0.6 + R() * 0.7), size * (0.5 + R() * 0.5), size * (1.3 + R() * 0.6), color, alpha, R() < 0.4 ? FR.FIREBALL : R() < 0.5 ? FR.FLAME : FR.FLAME2, F_ADD | F_FIRE | F_FLICKER, -60, 2.2);
      fx.stretchLast(i, 1.15);
    }
  }
  const SMOKES = [FR.SMOKE, FR.SMOKE2, FR.SMOKE3, FR.SMOKE4, FR.SMOKE5];
  function smoke(x, h, y, count, size, life, color, alpha, rise = 30, spreadR = 20, hot = false) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, r = R() * spreadR;
      fx.spawn(x + Math.cos(a) * r, h + R() * size * 0.5, y + Math.sin(a) * r, Math.cos(a) * 12, rise * (0.5 + R()), Math.sin(a) * 12,
        life * (0.6 + R() * 0.8), size * (0.6 + R() * 0.4), size * (2 + R()), color, alpha, SMOKES[(R() * 5) | 0], hot ? F_HOT : 0, -rise * 0.2, 0.8);
    }
  }
  function debris(x, h, y, count, color, speed, size = 2.5) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = speed * (0.3 + R() * 0.8);
      fx.spawn(x, h, y, Math.cos(a) * s, 120 + R() * speed * 1.4, Math.sin(a) * s, 1.2 + R() * 1.2, size * (0.6 + R()), size * 0.5, color, 1, R() < 0.5 ? FR.CHUNK : FR.SHARD, F_BOUNCE | F_SPIN, 800, 0.3);
    }
  }
  function ring(x, h, y, size, life, color, alpha, flat = true, frame = FR.RING) {
    return fx.spawn(x, h, y, 0, 0, 0, life, size * 0.1, size, color, alpha, frame, F_ADD | (flat ? F_FLAT : 0), 0, 0);
  }
  function glowPuff(x, h, y, size, life, color, alpha = 1) {
    fx.spawn(x, h, y, 0, 0, 0, life, size, size * 1.3, color, alpha, FR.GLOW, F_ADD, 0, 0);
  }
  function sparkles(x, y, count, color, h = 14) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = 20 + R() * 50;
      fx.spawn(x + Math.cos(a) * 8, h + R() * 10, y + Math.sin(a) * 8, Math.cos(a) * s, 30 + R() * 60, Math.sin(a) * s, 0.6 + R() * 0.5, 3 + R() * 2, 1, color, 1, R() < 0.5 ? FR.GLINT : FR.DOT, F_ADD | F_FLICKER, -10, 2);
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
    _org.h = (e.turret ? 34 : 38) + G(e.x, e.y);
    return _org;
  }

  function endHeight(isLocal, r, org) {
    if (isLocal) {
      // tracers go where the camera aims: bullets are horizontal in the sim, but the
      // player looks up/down at what they shoot
      const d = Math.hypot(r.x - camX, r.y - camY);
      const g = G(r.x, r.y);
      const h = camH + Math.tan(pitch) * d - g;
      if (r.hit === 1) return g + Math.max(10, Math.min(70, h));
      return g + Math.max(1, Math.min(260, h));
    }
    return r.hit === 1 ? 34 + G(r.x, r.y) : org.h;
  }

  // ---- impacts ----------------------------------------------------------------------------
  const _s = { nx: 0, ny: 0, top: 0, kind: '' };
  const HOLE = C('#141210'), SCORCH = C('#0e0c0b'), DUSTC = C('#6a655c');
  function impact(x, h, y, a, big) {
    // the bullet's back-direction, or the obstacle's face when we can find it
    let nx = -Math.cos(a), ny = -Math.sin(a), nh = 0;
    const s = surf(x, y, _s);
    let onSurface = false;
    if (s && h < s.top - 1) { nx = s.nx; ny = s.ny; onSurface = true; } else if (h < G(x, y) + 1.5) { nx = 0; ny = 0; nh = 1; onSurface = true; }
    const out = Math.atan2(ny, nx);
    sparks(x, h, y, out, 2.0, high ? (big ? 10 : 6) : 3, big ? 420 : 320);
    glowPuff(x, h, y, big ? 9 : 6, 0.06, hdr('#ffcf80', 2.2), 0.9);
    if (high || R() < 0.5) dust(x + nx * 2, h, y + ny * 2, big ? 3 : 1, big ? 9 : 7, DUSTC, 25, 0.7, 0.35, out, 1.2);
    if (high) chips(x, h, y, out, big ? 5 : 2, C(s && s.kind === 'tree' ? '#5a3a22' : '#4a4640'), 140, 0.9);
    if (onSurface) fx.decal(x, h, y, nx, nh, ny, big ? 3.6 : 2.4, FR.HOLE, HOLE, 0.9, 45);
  }

  // ---- event handlers -------------------------------------------------------------------------
  let tracerBudget = 0;

  function shot(e) {
    if (e.echo) return;                           // already drawn as the predicted shot
    const w = WEAPONS[e.weapon];
    if (!w) return;
    const isLocal = !!e.pid && e.pid === localId;
    const lk = e.turret ? -e.turret : e.pid || 0;   // light-gate key: this shooter
    const org = shotOrigin(e, isLocal);
    const ox = org.x, oh = org.h, oy = org.y;
    const rays = e.rays || [];
    const tr = hdr(w.tracer || '#ffe9a8', 3.2);
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    if (w.kind === 'rail') {
      const end = rays.length ? rays[0] : { x: ox + ca * w.range, y: oy + sa * w.range, hit: 0 };
      const bh = endHeight(isLocal, end, org);
      rails.push({ ax: ox, ah: oh, ay: oy, bx: end.x, bh, by: end.y, age: 0, life: 0.6, color: hdr(w.tracer, 4) });
      lights.flash(ox, oy, oh, '#b388ff', 3, 320, 0.3);
      lights.flash(end.x, end.y, bh, '#b388ff', 2, 240, 0.3);
      sparks(end.x, bh, end.y, e.angle + Math.PI, 2.4, high ? 16 : 8, 420, hdr('#d8c0ff', 3));
      if (end.hit === 2) impact(end.x, bh, end.y, e.angle, true);
      // a helix of motes and a thin smoke trail left in the air
      const L = Math.hypot(end.x - ox, end.y - oy);
      const n = Math.min(high ? 70 : 24, Math.floor(L / 20));
      const nx = -sa, ny = ca;
      for (let k = 0; k < n; k++) {
        const t = k / n, ang = t * 46;
        const px = ox + (end.x - ox) * t, py = oy + (end.y - oy) * t, ph = oh + (bh - oh) * t;
        const off = Math.cos(ang) * 4;
        fx.spawn(px + nx * off, ph + Math.sin(ang) * 4, py + ny * off, nx * off * 3, Math.sin(ang) * 12, ny * off * 3, 0.5 + R() * 0.3, 2.2, 0.4, hdr('#c8a8ff', 2.5), 0.9, FR.DOT, F_ADD, 0, 1);
        if (high && k % 3 === 0) fx.spawn(px, ph, py, (R() - 0.5) * 6, 6 + R() * 6, (R() - 0.5) * 6, 1.6 + R(), 3, 12, C('#8a86a0'), 0.18, SMOKES[k % 5], 0, -3, 0.6);
      }
      for (const r of rays) if (r.hit === 1) blood(r.x, 34, r.y, e.angle, 1.2, high ? 10 : 5, 220, true);
      if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.2, '#b388ff');
      return;
    }
    if (w.kind === 'melee') {
      // chainsaw: a spray of blood and bone chips where the chain bites, sparks off the bar
      for (const r of rays) {
        if (!r || r.hit !== 1) continue;
        const a = Math.atan2(r.y - oy, r.x - ox);
        const hx = r.x - Math.cos(a) * 10, hy = r.y - Math.sin(a) * 10;
        blood(hx, 32, hy, a + (R() - 0.5) * 1.2, 2.2, high ? 5 : 2, 260, true);
        if (high && R() < 0.4) chips(hx, 32, hy, a + Math.PI * 0.5 * (R() < 0.5 ? 1 : -1), 1, C('#d8d0c0'), 180, 0.7);
        if (R() < 0.25) ctx.ground.decal('blood', r.x + (R() - 0.5) * 20, r.y + (R() - 0.5) * 20, 4 + R() * 6, R() * TAU, 0.8);
      }
      if (rays.length) {
        sparks(ox, oh - 4, oy, e.angle + Math.PI, 1.6, high ? 3 : 1, 200);
        if (isLocal) ctx.shake(0.06);
      }
      if (high && R() < 0.3) smoke(ox - ca * 30, oh - 10, oy - sa * 30, 1, 3, 0.8, C('#6a6a6a'), 0.14, 12, 2);
      return;
    }
    if (w.kind === 'cryo') {
      // a cold white jet off the nozzle; the frost puffs (items3d) carry it on
      for (let k = 0; k < (high ? 3 : 1); k++) {
        const a = e.angle + (R() - 0.5) * 0.2, s = 300 + R() * 160;
        const start = isLocal ? 6 : 2;
        fx.spawn(ox + ca * start, oh - 1, oy + sa * start, Math.cos(a) * s, 6 + R() * 12, Math.sin(a) * s, 0.3 + R() * 0.15, 5, 22 + R() * 12, FROST_MIST, 0.32, SMOKES[(R() * 5) | 0], 0, -6, 3.2);
      }
      if (R() < 0.5) fx.spawn(ox + ca * 8, oh, oy + sa * 8, ca * 200 + (R() - 0.5) * 60, 10, sa * 200 + (R() - 0.5) * 60, 0.35, 1.4, 0.6, ICE_GLINT, 1, FR.GLINT, F_ADD | F_FLICKER, 20, 1.5);
      gatedFlash(lk, 0.12, ox + ca * 60, oy + sa * 60, oh, '#9ae8ff', 0.6, 200, 0.16);
      return;
    }
    if (w.kind === 'hitscan') {
      const big = w.category === 'sniper' || e.weapon === 'magnum';
      if (w.penetrate) {
        // the .50: a pressure wave kicks up dust round the shooter and slams the air
        dust(ox - ca * 20, 4, oy - sa * 20, high ? 10 : 4, 22, DUSTC, 160, 0.9, 0.4);
        ring(ox, oh, oy, 70, 0.18, hdr('#fff0d0', 1.2), 0.35, false, FR.SOFTRING);
        if (isLocal) ctx.shake(0.45);
        else shakeAt(ox, oy, 0.25, 700);
      }
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
          blood(r.x, bh, r.y, e.angle, 1.3, high ? (isLocal ? 7 : 4) : 2, 170, big);
          if (R() < (big ? 0.8 : 0.25)) ctx.ground.decal('blood', r.x + ca * 12, r.y + sa * 12, 4 + R() * 5, R() * TAU, 0.7);
        } else if (r.hit === 2) {
          if (!shotgun || k % 2 === 0 || high) impact(r.x, bh, r.y, e.angle, big);
        }
      }
      if (!isLocal) {
        const size = shotgun ? 1.5 : big ? 1.6 : w.category === 'heavy' ? 1.25 : w.category === 'pistol' ? 0.8 : 1.0;
        muzzleFlash(ox, oh, oy, e.angle, size, '#ffc070', lk);
      } else {
        // the viewmodel draws its own flash; the world still gets the light
        gatedFlash(lk, 0.06, ox, oy, oh, '#ffc070', 1.2, 180, 0.07);
        if (high && R() < 0.5) smoke(ox + ca * 6, oh, oy + sa * 6, 1, 4, 0.6, C('#8a8a8a'), 0.16, 15, 2);
      }
      return;
    }
    if (w.kind === 'flame') {
      // the jet near the nozzle; flame projectiles (items3d) carry it further
      for (let k = 0; k < (high ? 3 : 2); k++) {
        const a = e.angle + (R() - 0.5) * 0.18, s = 380 + R() * 140;
        const start = isLocal ? 6 : 2;
        const i = fx.spawn(ox + ca * start, oh - 1, oy + sa * start, Math.cos(a) * s, 14 + R() * 20, Math.sin(a) * s, 0.28 + R() * 0.12, 7, 26 + R() * 14, FLAME_BASE, 0.75, k ? FR.FLAME : FR.FLAME2, F_ADD | F_FIRE | F_FLICKER, -30, 2.5);
        fx.stretchLast(i, 1);
      }
      gatedFlash(lk, 0.12, ox + ca * 90, oy + sa * 90, oh, '#ff9a40', 0.9, 240, 0.16);
      return;
    }
    if (w.kind === 'projectile') {
      const kind = w.projectile && w.projectile.kind;
      if (kind === 'flare') {
        if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.0, '#ff5a3a');
        lights.flash(ox, oy, oh, '#ff4a2a', 2.4, 320, 0.25);
        smoke(ox, oh, oy, high ? 4 : 2, 5, 1.2, C('#b0483a'), 0.3, 14, 3);
        sparks(ox, oh, oy, e.angle, 0.6, high ? 8 : 3, 300, HOT_SPARK);
      } else if (kind === 'harpoon') {
        // compressed air: a white puff and a hiss of mist, no flame
        smoke(ox, oh, oy, high ? 5 : 2, 5, 0.7, C('#d0d4d8'), 0.26, 10, 3);
        for (let k = 0; k < (high ? 6 : 2); k++) {
          const a = e.angle + (R() - 0.5) * 1.2, s = 90 + R() * 80;
          fx.spawn(ox, oh, oy, Math.cos(a) * s, R() * 20, Math.sin(a) * s, 0.4, 3, 12, C('#e0e4e8'), 0.25, SMOKES[k % 5], 0, 0, 4);
        }
        if (isLocal) ctx.shake(0.12);
      } else if (kind === 'rocket') {
        if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.6, '#ffb050');
        lights.flash(ox, oy, oh, '#ffb050', 3, 300, 0.15);
        // back-blast out of the rear of the tube
        const bx = ox - ca * 40, by = oy - sa * 40;
        smoke(bx, oh, by, high ? 12 : 5, 10, 1.6, C('#9a968e'), 0.4, 12, 8, true);
        for (let k = 0; k < 8; k++) {
          const a = e.angle + Math.PI + (R() - 0.5) * 0.7, s = 200 + R() * 150;
          fx.spawn(bx, oh, by, Math.cos(a) * s, R() * 30, Math.sin(a) * s, 0.25, 6, 18, WHITE, 1, FR.FLAME, F_ADD | F_FIRE, 0, 4);
        }
      } else if (kind === 'grenade') {
        if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 1.1, '#ffc070');
        lights.flash(ox, oy, oh, '#ffc070', 1.8, 200, 0.08);
        smoke(ox, oh, oy, 3, 6, 0.9, C('#a09a90'), 0.3, 10, 4);
      }
      return;
    }
    if (w.kind === 'chain') {
      if (!isLocal) muzzleFlash(ox, oh, oy, e.angle, 0.9, '#80d8ff', lk);
    }
  }

  // One muzzle light per shooter at a time: a minigun or a flamethrower fires 20-30 times a
  // second, and a pool light per shot stacked into an overexposed white wash on everything
  // near the shooter (teammates went pale pink under ACES).
  const lightGate = new Map();
  function gatedFlash(key, gap, x, y, h, color, intensity, radius, life) {
    const last = lightGate.get(key);
    if (last !== undefined && now >= last && now - last < gap) return;
    lightGate.set(key, now);
    lights.flash(x, y, h, color, intensity, radius, life);
  }

  function muzzleFlash(x, h, y, a, size, color, key = null) {
    const c = hdr(color, 1.8);
    // a star facing the camera plus a side-on tongue along the barrel, white-hot core
    glowPuff(x, h, y, 7 * size, 0.05, c, 0.8);
    fx.spawn(x, h, y, 0, 0, 0, 0.045, 10 * size, 9 * size, hdr('#fff2c0', 2.2), 1, FR.STAR, F_ADD, 0, 0);
    const i = fx.spawn(x + Math.cos(a) * 6 * size, h, y + Math.sin(a) * 6 * size, 0, 0, 0, 0.045, 7 * size, 7 * size, c, 0.9, FR.FLASH, F_ADD, 0, 0);
    fx.stretchLast(i, 0.6);
    // Pool lights have no distance decay (WORLD: decay 0, only a range window), so a flash
    // lights everything inside its radius equally: at 1.5 over 220 units a teammate beside a
    // firing gun went white under the night exposure. Smaller and dimmer reads as a flash.
    const li = 0.9 * Math.min(1.4, size), lr = 110 + 40 * size;
    if (key === null) lights.flash(x, y, h, color, li, lr, 0.06);
    else gatedFlash(key, 0.06, x, y, h, color, li, lr, 0.07);
  }

  function explosion(x, y, r, kind) {
    const bloat = kind === 'bloater';
    const d = distCam(x, y);
    if (bloat) {
      // gore burst: green-grey mist, acid glow, chunks (zombies3d throws the gibs)
      lights.flash(x, y, 30, '#b8ff6a', 2.4, r * 2.6, 0.35);
      fx.spawn(x, 26, y, 0, 0, 0, 0.25, r * 0.6, r * 1.5, hdr('#c8ff8a', 2), 0.8, FR.GLOW, F_ADD, 0, 0);
      for (let k = 0; k < (high ? 18 : 8); k++) {
        const a = R() * TAU, s = 80 + R() * 160;
        fx.spawn(x, 20 + R() * 16, y, Math.cos(a) * s, 30 + R() * 80, Math.sin(a) * s, 1.1 + R() * 0.8, 14, 40 + R() * 20, C('#5f7a2e'), 0.55, SMOKES[k % 5], 0, -10, 2);
      }
      for (let k = 0; k < (high ? 14 : 6); k++) {
        const a = R() * TAU, s = 90 + R() * 200;
        const i = fx.spawn(x, 26, y, Math.cos(a) * s, 60 + R() * 140, Math.sin(a) * s, 0.7, 2, 1, hdr('#a6ff3a', 2), 1, FR.DROP, F_ADD | F_BOUNCE | F_VSTRETCH, 600, 0.4);
        fx.velStretch(i, 0.025);
      }
      blood(x, 26, y, 0, TAU, high ? 22 : 10, 260, true);
      ring(x, 2, y, r * 2, 0.35, hdr('#a8e060', 1.6), 0.6);
      ctx.ground.decal('acid', x, y, r * 0.45, R() * TAU, 0.8);
      shakeAt(x, y, 0.45, 1000);
      return;
    }
    const rocket = kind === 'rocket';
    lights.flash(x, y, 50, '#ffb060', rocket ? 4.5 : 3.6, r * 3.2, 0.45);
    // white-hot core flash (blooms hard for a few frames), then the fireball
    fx.spawn(x, 26, y, 0, 0, 0, 0.1, r * 0.35, r * 0.9, HOT_CORE, 1, FR.GLOW, F_ADD, 0, 0);
    fx.spawn(x, 26, y, 0, 0, 0, 0.08, r * 0.5, r * 0.9, hdr('#fff0d0', 2), 0.7, FR.STAR, F_ADD, 0, 0);
    fireball(x, 18, y, high ? (ultra ? 26 : 20) : 10, r * 0.3, r * 1.5, 0.8, FIRE_TINT, 0.5);
    // shockwave: a hot ring racing over the ground and a soft vertical one
    ring(x, 3, y, r * 2.8, 0.42, hdr('#ffd8a0', 1.8), 0.9, true, FR.SHOCK);
    ring(x, 30, y, r * 2.2, 0.3, hdr('#ffe8c0', 1.2), 0.4, false, FR.SOFTRING);
    sparks(x, 20, y, 0, TAU, high ? 30 : 12, 650, HOT_SPARK);
    debris(x, 10, y, high ? 16 : 6, C('#2a2622'), 260, 3);
    // dust ring rolling outward, then a smoke column that glows while it is hot
    for (let k = 0; k < (high ? 16 : 7); k++) {
      const a = (k / (high ? 16 : 7)) * TAU + R() * 0.3;
      fx.spawn(x + Math.cos(a) * r * 0.2, 5, y + Math.sin(a) * r * 0.2, Math.cos(a) * r * 1.8, 10 + R() * 12, Math.sin(a) * r * 1.8, 1.2 + R() * 0.6, 12, 34, C('#5a5044'), 0.45, FR.DUST, 0, -2, 2.6);
    }
    smoke(x, 20, y, high ? 16 : 6, r * 0.22, 3.4, C('#2a2826'), 0.55, 45, r * 0.3, true);
    smoke(x, 10, y, high ? 6 : 3, r * 0.3, 1.8, C('#6a5040'), 0.35, 20, r * 0.4, true);
    ctx.ground.decal('scorch', x, y, r * 0.42, R() * TAU, 0.95);
    // scorch marks on nearby walls
    for (let k = 0; k < (high ? 4 : 2); k++) {
      const a = R() * TAU, dd = r * (0.4 + R() * 0.5);
      const sx = x + Math.cos(a) * dd, sy = y + Math.sin(a) * dd;
      const s = surf(sx, sy, _s);
      if (s) fx.decal(sx, 6 + R() * 20, sy, s.nx, 0, s.ny, r * 0.35, FR.SCORCH, SCORCH, 0.8, 60);
    }
    shakeAt(x, y, Math.min(1, (r / 160) * 0.95), 1400);
    if (d < r) ctx.shake(1);
  }

  function handle(e) {
    gOff = rough && e.type !== 'shot' && e.type !== 'chain' ? G(e.x || 0, e.y || 0) : 0;
    handle0(e);
    gOff = 0;
  }

  function handle0(e) {
    switch (e.type) {
      case 'shot': shot(e); break;
      case 'chain': {
        const pts = e.points || [];
        if (pts.length < 2) break;
        const isLocal = e.pid && e.pid === localId;
        const arr = [];
        for (let k = 0; k < pts.length; k++) {
          let x = pts[k].x, y = pts[k].y;
          let h = 36 + G(x, y);
          if (k === 0) {
            const o = shotOrigin({ pid: e.pid, x, y, angle: Math.atan2(pts[1].y - y, pts[1].x - x) }, isLocal);
            x = o.x; y = o.y; h = o.h;
          }
          arr.push(x, h, y);
        }
        arcs.push({ pts: arr, age: 0, life: 0.22, seed: R() * 100 });
        for (let k = 1; k < pts.length; k++) {
          const g = G(pts[k].x, pts[k].y);
          sparks(pts[k].x, 36 + g, pts[k].y, 0, TAU, high ? 8 : 3, 280, hdr('#a0e8ff', 3));
          glowPuff(pts[k].x, 36 + g, pts[k].y, 18, 0.15, hdr('#80d8ff', 2), 0.8);
        }
        lights.flash(pts[0].x, pts[0].y, 40 + G(pts[0].x, pts[0].y), '#80d8ff', 2.6, 260, 0.12);
        const m = pts[Math.min(pts.length - 1, 2)];
        lights.flash(m.x, m.y, 36 + G(m.x, m.y), '#80d8ff', 2, 220, 0.14);
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
        for (let k = 0; k < (high ? 12 : 5); k++) {
          const aa = a + (R() - 0.5) * 0.9, s = 60 + R() * 120;
          const i = fx.spawn(x, 50, y, Math.cos(aa) * s, 20 + R() * 60, Math.sin(aa) * s, 0.6, 1.8, 1, hdr('#a6ff3a', 2.2), 1, FR.DROP, F_ADD | F_BOUNCE | F_VSTRETCH, 500, 1);
          fx.velStretch(i, 0.03);
        }
        fx.spawn(x, 50, y, Math.cos(a) * 30, 5, Math.sin(a) * 30, 0.5, 5, 14, C('#5a8a20'), 0.3, FR.SMOKE2, 0, 0, 2);
        lights.flash(x, y, 48, '#a6ff4a', 1.2, 140, 0.25);
        break;
      }
      case 'scream':
        fx.spawn(e.x, 52, e.y, 0, 0, 0, 0.7, 10, 240, hdr('#d8c8ff', 1.4), 0.55, FR.SOFTRING, F_ADD, 0, 0);
        fx.spawn(e.x, 52, e.y, 0, 0, 0, 0.5, 10, 170, hdr('#b890ff', 1.4), 0.45, FR.SHOCK, F_ADD, 0, 0);
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
        ring(e.x, 2, e.y, r * 2.1, 0.5, hdr('#ffe6c0', 1.3), 0.9, true, FR.SHOCK);
        ring(e.x, 2, e.y, r * 1.4, 0.35, C('#c8a070'), 0.7);
        fx.spawn(e.x, 30, e.y, 0, 0, 0, 0.5, 20, r * 2, C('#e0c8a0'), 0.35, FR.SOFTRING, F_ADD, 0, 0);
        dust(e.x, 4, e.y, high ? 28 : 12, 34, C('#5a5044'), r * 1.2, 1.4, 0.5);
        debris(e.x, 4, e.y, high ? 20 : 8, C('#5d5a55'), 300, 3.2);
        ctx.ground.decal('scorch', e.x, e.y, r * 0.35, R() * TAU, 0.5);
        lights.flash(e.x, e.y, 20, '#ffdcb0', 1.5, r * 2, 0.2);
        shakeAt(e.x, e.y, 0.9, 1400);
        break;
      }
      case 'explosion': explosion(e.x, e.y, e.r || 150, e.kind); break;
      case 'freeze': {
        // frost races over a zombie and locks it solid: ice shards, a cold flash
        for (let k = 0; k < (high ? 14 : 6); k++) {
          const a = R() * TAU, s = 40 + R() * 90;
          fx.spawn(e.x, 20 + R() * 30, e.y, Math.cos(a) * s, 30 + R() * 80, Math.sin(a) * s, 0.8 + R() * 0.4, 1.8, 1.2, ICE_SHARD, 0.9, FR.SHARD, F_BOUNCE | F_SPIN, 600, 0.5);
        }
        sparkles(e.x, e.y, high ? 10 : 4, ICE_GLINT, 26);
        glowPuff(e.x, 30, e.y, 30, 0.25, hdr('#9ae8ff', 1.6), 0.7);
        ring(e.x, 2, e.y, 60, 0.4, hdr('#cfeeff', 1.2), 0.6);
        dust(e.x, 10, e.y, high ? 4 : 2, 14, FROST_MIST, 30, 1.2, 0.3);
        lights.flash(e.x, e.y, 30, '#9ae8ff', 1.2, 140, 0.3);
        break;
      }
      case 'ignite': {
        const r = e.r || 110;
        fireball(e.x, 6, e.y, high ? 26 : 12, 22, r * 1.8, 0.85, FIRE_TINT, 0.55);
        for (let k = 0; k < 12; k++) {
          const a = R() * TAU, s = 80 + R() * 140;
          fx.spawn(e.x, 20, e.y, Math.cos(a) * s, 60 + R() * 90, Math.sin(a) * s, 1, 2.2, 1.4, hdr('#c8e8d8', 1.4), 0.9, FR.SHARD, F_ADD | F_BOUNCE | F_SPIN, 700, 0.5);
        }
        glowPuff(e.x, 20, e.y, r * 1.2, 0.3, hdr('#ff9a40', 2), 0.9);
        smoke(e.x, 20, e.y, high ? 8 : 3, 16, 2.4, C('#241f1b'), 0.45, 40, r * 0.4, true);
        lights.flash(e.x, e.y, 30, '#ff9a40', 3, r * 3, 0.6);
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
          const c = hdr(e.type === 'revived' ? '#7dff9a' : '#dfefff', 1.8);
          ring(p.x, 2, p.y, 140, 0.6, c, 0.9);
          sparkles(p.x, p.y, high ? 22 : 10, c, 10);
          lights.flash(p.x, p.y, 30, e.type === 'revived' ? '#7dff9a' : '#dfefff', 1.8, 200, 0.6);
        }
        break;
      }
      case 'died': {
        const p = players.get(e.pid);
        if (p) dust(p.x, 4, p.y, 6, 16, C('#4a463e'), 40);
        break;
      }
      case 'pickup': {
        const c = hdr(PICKUP_GLOW[e.kind] || '#ffffff', 2);
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
          smoke(e.x, 30, e.y, 8, 10, 2, C('#2e2c2a'), 0.5, 30, 10, true);
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
        ring(e.x, 2, e.y, 520, 0.7, hdr('#c080ff', 1.5), 0.8, true, FR.SHOCK);
        ctx.ground.decal('scorch', e.x, e.y, 70, R() * TAU, 0.8);
        lights.flash(e.x, e.y, 40, '#c080ff', 3, 420, 0.8);
        shakeAt(e.x, e.y, 0.7, 1600);
        break;
      default:
        break;
    }
  }

  // ---- per-frame --------------------------------------------------------------------------
  const _j = [], _b = [];
  const ARC_CORE = hdr('#e8faff', 3.5), ARC_GLOW = hdr('#7fd8ff', 1.6), TRACER_HEAD = new THREE.Color();
  function update(view, frame) {
    fx.begin(frame);
    const dt = Math.min(0.1, frame.dt || 0);
    now = frame.now || 0;
    localId = frame.localId || localId;
    camX = frame.camX; camY = frame.camY;
    camH = frame.camH || EYE;
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
      const hx = t.ax + (t.bx - t.ax) * k1, hh = t.ah + (t.bh - t.ah) * k1, hy = t.ay + (t.by - t.ay) * k1;
      fx.beam(t.ax + (t.bx - t.ax) * k0, t.ah + (t.bh - t.ah) * k0, t.ay + (t.by - t.ay) * k0, hx, hh, hy,
        t.w * 0.2, t.w, t.color, 1, 0.9, 0.9, 0);
      if (head < t.len) fx.glow(hx, hh, hy, t.w * 3.2, TRACER_HEAD.copy(t.color).multiplyScalar(0.6), 0.8);
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
      fx.beam(b.ax, b.ah, b.ay, b.bx, b.bh, b.by, 4 * f + 1.2, 4 * f + 1.2, b.color, 1.3 * f, 1, 0, 0.05);
      fx.beam(b.ax, b.ah, b.ay, b.bx, b.bh, b.by, 16 * f, 22 * f, b.color, 0.25 * f, 0, 0, 0.1);
    }
    rails.length = w;

    // tesla arcs: jagged, re-jittered ~30 times a second, with side branches
    w = 0;
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
        const seg = Math.max(3, Math.min(10, Math.round(L / 20)));
        jagged(_j, x0, h0, y0, x1, h1, y1, L, seg, seed + s * 7, 0.18, 16);
        for (let q = 0; q + 5 < _j.length; q += 3) {
          fx.beam(_j[q], _j[q + 1], _j[q + 2], _j[q + 3], _j[q + 4], _j[q + 5], 1.2, 1.2, ARC_CORE, 1.1 * f, 1, 0, 0);
          fx.beam(_j[q], _j[q + 1], _j[q + 2], _j[q + 3], _j[q + 4], _j[q + 5], 7, 7, ARC_GLOW, 0.3 * f, 0, 0, 0);
          // forks: short jagged spurs off the main bolt
          if (high && hashf(seed * 0.37 + q * 1.3 + s) < 0.33 && q > 0) {
            const bl = L * (0.12 + hashf(seed + q) * 0.18);
            const ang = Math.atan2(y1 - y0, x1 - x0) + (hashf(seed * 1.7 + q) - 0.5) * 2.2;
            jagged(_b, _j[q], _j[q + 1], _j[q + 2], _j[q] + Math.cos(ang) * bl, _j[q + 1] + (hashf(q + seed) - 0.6) * 18, _j[q + 2] + Math.sin(ang) * bl, bl, 3, seed + q * 3, 0.3, 8);
            for (let r = 0; r + 5 < _b.length; r += 3) {
              fx.beam(_b[r], _b[r + 1], _b[r + 2], _b[r + 3], _b[r + 4], _b[r + 5], 0.7, 0.3, ARC_CORE, 0.8 * f, 1, 0, 0.6);
            }
          }
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
        gOff = rough ? G(em.x, em.y) : 0;
        em.acc += dt * (high ? 14 : 7);
        while (em.acc >= 1) {
          em.acc -= 1;
          fx.spawn(em.x + (R() - 0.5) * 4, 4, em.y + (R() - 0.5) * 4, (R() - 0.5) * 10, 40 + R() * 20, (R() - 0.5) * 10, 3 + R(), 5, 34, C('#c83a2a'), 0.35, SMOKES[(R() * 5) | 0], 0, -4, 0.3);
        }
        fx.glow(em.x, 5, em.y, 14 + Math.sin(now * 30) * 2, hdr('#ff5a3a', 3), 1);
        lights.steady('flare' + k, em.x, em.y, 12, '#ff4a2a', 1.4 * Math.min(1, (em.life - em.age) / 1.5), 220);
        gOff = 0;
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
        ring(c.x, 2, c.y, 190, 0.45, hdr('#ffe0a0', 1.3), 0.7);
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
      ultra = q === 'ultra';
      fx.setQuality(q);
    },
    dispose() {
      for (const m of crateMeshes) m.removeFromParent();
      crateGeo.dispose();
      releaseFx(ctx);
    },
    /** Test hook: live effect counts. */
    get stats() { return { tracers: tracers.length, arcs: arcs.length, rails: rails.length, ...fx.stats }; },
  };
}

/** A jagged polyline from a to b into `out` (flat xyz list). */
function jagged(out, x0, h0, y0, x1, h1, y1, L, seg, seed, sideK, upK) {
  out.length = 0;
  out.push(x0, h0, y0);
  const inv = 1 / (L || 1);
  for (let q = 1; q < seg; q++) {
    const t = q / seg;
    const n = (hashf(seed + q * 13) - 0.5) * L * sideK;
    const m = (hashf(seed * 3 + q * 31) - 0.5) * upK;
    out.push(x0 + (x1 - x0) * t - (y1 - y0) * inv * n, h0 + (h1 - h0) * t + m, y0 + (y1 - y0) * t + (x1 - x0) * inv * n);
  }
  out.push(x1, h1, y1);
  return out;
}

function hashf(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Surface lookup over the map's obstacles (oriented rectangles): for a point on or next
 * to one, its outward face normal (sim axes) and height. A uniform grid keeps it cheap.
 */
function surfaceIndex(ctx) {
  const ground = ctx.groundY || (() => 0);
  const obs = (ctx.map && ctx.map.obstacles) || [];
  const CELL = 128;
  const grid = new Map();
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const r = Math.hypot(o.w, o.h) / 2 + 4;
    for (let gx = Math.floor((o.x - r) / CELL); gx <= Math.floor((o.x + r) / CELL); gx++) {
      for (let gy = Math.floor((o.y - r) / CELL); gy <= Math.floor((o.y + r) / CELL); gy++) {
        const k = gx * 4096 + gy;
        let l = grid.get(k);
        if (!l) { l = []; grid.set(k, l); }
        l.push(o);
      }
    }
  }
  const heights = new Map();
  const heightOf = (o) => {
    let h = heights.get(o);
    if (h === undefined) {
      try { h = ctx.heightOf ? ctx.heightOf(o.kind, o) : 40; } catch { h = 40; }
      if (!Number.isFinite(h)) h = 40;
      heights.set(o, h);
    }
    return h;
  };
  return (x, y, out) => {
    const l = grid.get(Math.floor(x / CELL) * 4096 + Math.floor(y / CELL));
    if (!l) return null;
    let best = null, bd = 4;
    for (const o of l) {
      const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
      const dx = x - o.x, dy = y - o.y;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const ex = Math.abs(lx) - o.w / 2, ey = Math.abs(ly) - o.h / 2;
      const d = Math.max(ex, ey);
      if (d > bd || d < -6) continue;
      bd = d;
      best = o;
      // face normal in local space → world
      let nlx = 0, nly = 0;
      if (ex > ey) nlx = Math.sign(lx) || 1; else nly = Math.sign(ly) || 1;
      out.nx = nlx * c - nly * s;
      out.ny = nlx * s + nly * c;
    }
    if (!best) return null;
    out.top = heightOf(best) + ground(best.x, best.y);
    out.kind = best.kind;
    return out;
  };
}

export { createEffects3D as createEffects };
