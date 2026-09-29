// Event-driven effects in the first-person view (ACTORS, SPEC §7.5): glowing tracers from
// every shot ray (HDR, they bloom), muzzle flashes per weapon class, impacts by surface
// (concrete chips and dust, metal sparks and ricochet streaks, wood splinters, glass shards,
// dirt and sand puffs, water splashes, each with a lingering hole / chip decal), blood
// spurts, exit-wound sprays and mist on flesh hits (blood3.js puts the splatter on the wall,
// car or ground behind), pools, drag marks and gibs when a zombie dies (gore3d.js: severed
// limbs that tumble and smear), ejected shell casings (casings3d.js), multi-stage
// explosions (a white-hot flash, fireball, shockwave ring and screen distortion, debris, a
// smoke column, crater / scorch decals, embers that linger), molotov bursts, branching tesla
// arcs, rail beams with a smoke trail, acid spit, screams, boss slams, brute charge dust,
// pickup sparkle, place/destroy puffs, the supply crate drop and damage feedback.
// Everything is drawn through the shared pools in fx-core.js / fx-decals.js (five draw calls
// for all of it) plus the renderer's light pool (lights.flash) and ground decals (ctx.ground).
//
// Shot rules (SPEC §4.1): `echo` shots are never drawn again; the local player's shots
// (predicted on clients) start at the viewmodel muzzle, which viewmodel.js publishes in
// fx.localMuzzle every frame; teammates' shots start at the muzzle players3d publishes.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { ZOMBIES } from '../shared/zombies.js';
import { acquireFx, releaseFx, F_ADD, F_FLAT, F_STREAK, F_BOUNCE, F_FIRE, F_FLICKER, F_SPIN, F_VSTRETCH, F_HOT, FR, DC, DK } from './fx-core.js';
import { surfaceIndex, groundIndex, MAT } from './surfaces.js';
import { createBlood } from './blood3d.js';
import { createGore3D } from './gore3d.js';
import { createCasings3D } from './casings3d.js';
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
  const gm = groundIndex(ctx);
  // blood decals, severed limbs and casings work in absolute heights (they look up the ground themselves)
  const env = { G, surf, gm, high, ultra, blood: null };
  const blood3 = createBlood(ctx, fx0, env);
  env.blood = blood3;
  const gore3 = createGore3D(ctx, fx0, env);
  const casings = createCasings3D(ctx, fx0, env);
  // ground blood painted by the other sub-systems (zombies3d) goes through the same decals (renderer3d routes it here)
  fx0.groundBlood = (kind, x, y, r, angle, alpha) => blood3.legacy(kind, x, y, r, angle, alpha);
  const stages = [];       // delayed explosion stages { at, kind, x, y, r }
  // recent heavy hits on flesh { x, y, t, ang, power } (a kill soon after tears a limb off): a fixed ring, no allocation
  const HEAVY_N = 10;
  const heavyHits = Array.from({ length: HEAVY_N }, () => ({ x: 0, y: 0, t: -99, ang: 0, power: 0 }));
  let heavyHead = 0;

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
    // droplets stretched along their flight, a fine mist, a puff; palette and amount follow
    // the gore setting (ash grey when off, thinner when low)
    const P = fx.gore;
    if (P.mode === 'low') count = Math.ceil(count * 0.6);
    for (let k = 0; k < count; k++) {
      const a = dirA + (R() - 0.5) * spread, s = speed * (0.3 + R() * 0.9);
      const i = fx.spawn(x, h + (R() - 0.5) * 4, y, Math.cos(a) * s, 20 + R() * 120, Math.sin(a) * s, 0.4 + R() * 0.4, (big ? 1.6 : 1.1) + R() * 0.8, 0.9, k % 2 ? P.blood : P.blood2, 0.95, FR.DROP, F_BOUNCE | F_VSTRETCH, 650, 0.6);
      fx.velStretch(i, 0.02);
    }
    fx.spawn(x, h, y, Math.cos(dirA) * 25, 8, Math.sin(dirA) * 25, 0.4 + R() * 0.2, big ? 7 : 4, big ? 22 : 13, P.mist, 0.6, FR.MIST, 0, 0, 3);
    if (high) fx.spawn(x, h, y, Math.cos(dirA) * 40, 4, Math.sin(dirA) * 40, 0.3, big ? 5 : 3, big ? 16 : 10, P.blood, 0.35, FR.SMOKE5, 0, 0, 3);
  }
  // how hard each weapon class hits flesh (0..1): sets the reach of the exit-wound spray
  const CLASS_K = { pistol: 0.28, smg: 0.26, rifle: 0.42, shotgun: 0.34, heavy: 0.58, sniper: 1, special: 0.5, explosive: 0.8, melee: 0.45 };
  function slopeOf(r, ox, oy, oh, bh) { return (bh - oh) / Math.max(1, Math.hypot(r.x - ox, r.y - oy)); }
  /** A ray went through flesh at r: exit spray behind it, and (heavy hits) a record for dismemberment. */
  function fleshHit(r, ang, bh, slope, k, heavy) {
    blood3.exitSpray(r.x + Math.cos(ang) * 8, bh, r.y + Math.sin(ang) * 8, ang, Math.min(1, k || 0.3), slope);
    if (heavy) {
      const q = heavyHits[heavyHead];
      heavyHead = (heavyHead + 1) % HEAVY_N;
      q.x = r.x; q.y = r.y; q.t = now; q.ang = ang; q.power = Math.min(1, k || 0.5);
    }
  }

  // shell casings: brass for pistols / SMGs / rifles, red hulls for shotguns, long brass for the heavy guns
  const ejGate = new Map();
  function ejectCasing(key, isLocal, org, aim, w) {
    const cat = w.category;
    if (cat === 'melee' || cat === 'special' || cat === 'explosive') return;
    const last = ejGate.get(key);
    if (last !== undefined && now >= last && now - last < 0.045) return;
    ejGate.set(key, now);
    const kind = cat === 'shotgun' ? 1 : cat === 'sniper' || cat === 'heavy' ? 2 : 0;
    casings.eject(org.x - Math.cos(aim) * 12, org.h - 2, org.y - Math.sin(aim) * 12, aim, kind);
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
  const _s = { nx: 0, ny: 0, top: 0, kind: '', d: 0, s0: 0, s1: 0, mat: 0, o: null };
  const HOLE = C('#100e0d'), SCORCH = C('#0e0c0b'), DUSTC = C('#6a655c');
  const DUST_CONC = C('#7a766c'), DUST_DIRT = C('#5e4c38'), DUST_SAND = C('#a89468'), DUST_WOOD = C('#8a7350');
  const WOOD_C = C('#9a7548'), WOOD_D = C('#5f4126'), CHIP_PALE = C('#8d897e'), CHIP_DARK = C('#54514a'), GRAIN = C('#b09a6a');
  const GLASS_HDR = hdr('#d6efff', 1.5), GLASS_PALE = C('#b8c8d0'), WATER_C = C('#dbe8ee'), METAL_SPARK = hdr('#ffd9a0', 3.6);
  const VEHICLE = new Set(['car', 'suv', 'pickup', 'van', 'bus', 'truck', 'semi', 'tanker']);

  /** Put a mark (hole, chip patch, scorch...) on the surface an impact landed on. */
  function mark(x, h, y, nx, ny, wall, s, size, cell, kind, color, alpha, life) {
    const D = fx0.decals;
    if (wall) {
      const o = D.opt;
      o.top = s.top; o.s0 = s.s0; o.s1 = s.s1; o.floor = G(x, y) + 0.4;
      D.add(1, x - nx * s.d, h, y - ny * s.d, nx, 0, ny, size, cell, kind, color.r, color.g, color.b, alpha, life);
    } else {
      D.add(1, x, G(x, y), y, 0, 1, 0, size, cell, kind, color.r, color.g, color.b, alpha, life);
    }
  }

  /**
   * A bullet hit terrain or an obstacle at (x, h, y) travelling along sim angle `a`.
   * The look depends on what it hit: concrete / stone (chips, dust), metal (sparks, ricochet
   * streaks; a car window shatters), wood (splinters), dirt / sand (puffs), water (splash).
   */
  function impact(x, h, y, a, big) {
    let nx = -Math.cos(a), ny = -Math.sin(a);
    const s = surf(x, y, _s);
    let wall = false, ground = false, mat = MAT.CONCRETE, kind = '';
    if (s && h < s.top - 1) { nx = s.nx; ny = s.ny; wall = true; mat = s.mat; kind = s.kind; }
    else if (h < G(x, y) + 2.5) { nx = 0; ny = 0; ground = true; mat = gm(x, y); }
    else if (s) { mat = s.mat; kind = s.kind; }        // over the top of it: no mark, the effect only
    const out = ground ? a + Math.PI : Math.atan2(ny, nx);
    const onSurface = wall || ground;
    const dcos = Math.cos(a), dsin = Math.sin(a);
    const bx = x + nx * 2, by = y + ny * 2;
    const hi = high ? 1 : 0.5;
    if (mat === MAT.WATER) {
      // a splash column, a ring and droplets
      fx.spawn(x, 4, y, 0, 50, 0, 0.45, 8, 20, WATER_C, 0.6, FR.SPLASH, 0, -40, 2.5);
      for (let k = 0; k < (high ? 9 : 4); k++) {
        const aa = R() * TAU, sp = 25 + R() * 60;
        fx.spawn(x, 3, y, Math.cos(aa) * sp * 0.4, 120 + R() * 130, Math.sin(aa) * sp * 0.4, 0.55 + R() * 0.3, 1.6, 0.8, WATER_C, 0.85, FR.DROP, 0, 600, 0.8);
      }
      ring(x, 1.2, y, big ? 40 : 26, 0.5, hdr('#cfe6f0', 0.7), 0.45);
      return;
    }
    if (mat === MAT.METAL) {
      const glass = wall && VEHICLE.has(kind) && h > (kind === 'van' || kind === 'bus' || kind === 'truck' || kind === 'semi' ? 46 : 30) && h < s.top - 3 && R() < 0.55;
      if (glass) {
        // the window goes: bright shards, glints, a crack star
        for (let k = 0; k < (high ? 11 : 5); k++) {
          const aa = out + (R() - 0.5) * 2.2, sp = 60 + R() * 170;
          fx.spawn(bx, h, by, Math.cos(aa) * sp, 50 + R() * 120, Math.sin(aa) * sp, 0.7 + R() * 0.6, 1.3 + R() * 1.4, 1, GLASS_HDR, 0.95, FR.SHARD, F_ADD | F_BOUNCE | F_SPIN, 800, 0.4);
        }
        for (let k = 0; k < (high ? 4 : 2); k++) fx.spawn(bx + (R() - 0.5) * 8, h + (R() - 0.5) * 6, by + (R() - 0.5) * 8, (R() - 0.5) * 30, 10 + R() * 20, (R() - 0.5) * 30, 0.3 + R() * 0.25, 4, 1, GLASS_HDR, 1, FR.GLINT, F_ADD | F_FLICKER, 0, 2);
        dust(bx, h, by, 1, 8, C('#9aa4a8'), 20, 0.5, 0.25, out, 1.2);
        if (wall) mark(x, h, y, nx, ny, true, s, 14 + (big ? 6 : 0), DC.HOLE_GLASS, DK.PALE, GLASS_PALE, 0.7, 120);
        return;
      }
      sparks(x, h, y, out, 2.3, high ? (big ? 14 : 9) : 4, big ? 480 : 360);
      glowPuff(x, h, y, big ? 11 : 7, 0.07, hdr('#ffcf80', 2.4), 0.95);
      // ricochet: thin bright streaks off the surface (the whine you can see)
      if (onSurface && (high || R() < 0.5)) {
        const dot = dcos * nx + dsin * ny;
        const ra = Math.atan2(dsin - 2 * dot * ny, dcos - 2 * dot * nx);
        for (let k = 0; k < (big ? 3 : 2); k++) {
          const aa = ra + (R() - 0.5) * 0.5;
          const i = fx.spawn(x, h, y, Math.cos(aa) * 950, (R() - 0.3) * 300, Math.sin(aa) * 950, 0.09 + R() * 0.08, 0.9, 0.3, METAL_SPARK, 1, FR.DOT, F_ADD | F_STREAK, 500, 0.3);
          fx.stretchLast(i, 2.6 + R() * 2.4);
        }
      }
      if (high) chips(x, h, y, out, big ? 3 : 1, C('#3c3f43'), 130, 0.8);
      if (onSurface) {
        mark(x, h, y, nx, ny, wall, s, 9, DC.DENT, DK.DARK, HOLE, 0.4, 130);
        mark(x, h, y, nx, ny, wall, s, big ? 6.4 : 4.4, DC.HOLE_METAL, DK.HOLE, HOLE, 0.95, 140);
      }
      return;
    }
    if (mat === MAT.WOOD) {
      for (let k = 0; k < (high ? 7 : 3); k++) {
        const aa = out + (R() - 0.5) * 1.9, sp = 60 + R() * 170;
        fx.spawn(bx, h, by, Math.cos(aa) * sp, 40 + R() * 110, Math.sin(aa) * sp, 0.6 + R() * 0.5, 0.8 + R() * 0.9, 1.6 + R() * 1.6, k % 3 ? WOOD_C : WOOD_D, 1, FR.SHARD, F_BOUNCE | F_SPIN, 800, 0.4);
      }
      dust(bx, h, by, big ? 3 : 2, 8, DUST_WOOD, 28, 0.8, 0.3, out, 1.3);
      sparks(x, h, y, out, 2.2, high ? 2 : 1, 200);
      if (onSurface) mark(x, h, y, nx, ny, wall, s, big ? 8 : 5.6, DC.HOLE_WOOD, DK.HOLE, HOLE, 0.9, 130);
      return;
    }
    if (mat === MAT.DIRT || mat === MAT.SAND) {
      const sand = mat === MAT.SAND;
      dust(bx, h + 1, by, big ? 4 : 2, big ? 14 : 10, sand ? DUST_SAND : DUST_DIRT, 34, 1, 0.45, out, 1.5);
      for (let k = 0; k < (high ? 6 : 2); k++) {
        const aa = out + (R() - 0.5) * 2.2, sp = 60 + R() * 130;
        fx.spawn(bx, h + 1, by, Math.cos(aa) * sp, 70 + R() * 130, Math.sin(aa) * sp, 0.5 + R() * 0.4, sand ? 0.9 : 1.4, sand ? 0.7 : 1, sand ? GRAIN : DUST_DIRT, 1, sand ? FR.DOT : FR.CHUNK, F_BOUNCE | F_SPIN, 800, 0.5);
      }
      if (onSurface && ground) mark(x, h, y, 0, 0, false, s, 6.5, DC.DENT, DK.DARK, sand ? C('#5a4c34') : C('#2c2218'), 0.5, 70);
      else if (onSurface) mark(x, h, y, nx, ny, wall, s, 4.4, DC.HOLE + ((R() * DC.HOLE_N) | 0), DK.HOLE, HOLE, 0.8, 120);
      return;
    }
    if (mat === MAT.CLOTH) {
      dust(bx, h, by, 2, 8, C('#8a8478'), 20, 0.8, 0.25, out, 1.4);
      if (onSurface) mark(x, h, y, nx, ny, wall, s, 3.6, DC.HOLE + ((R() * DC.HOLE_N) | 0), DK.HOLE, HOLE, 0.75, 120);
      return;
    }
    // concrete, stone, asphalt: sparks off the aggregate, a dust puff, a spray of chips, a pale spalled patch and a hole
    sparks(x, h, y, out, 2.0, high ? (big ? 6 : 3) : 2, big ? 360 : 260);
    glowPuff(x, h, y, big ? 8 : 5, 0.06, hdr('#ffcf80', 1.8), 0.8);
    dust(bx, h, by, Math.ceil((big ? 4 : 2) * hi), big ? 12 : 9, mat === MAT.STONE ? DUST_CONC : DUSTC, 26, 0.9, 0.38, out, 1.3);
    if (high) chips(x, h, y, out, big ? 6 : 3, kind === 'tree' ? WOOD_D : R() < 0.5 ? CHIP_PALE : CHIP_DARK, 150, 1.0);
    if (onSurface) {
      mark(x, h, y, nx, ny, wall, s, big ? 16 : 10.5, DC.CHIP + ((R() * DC.CHIP_N) | 0), DK.PALE, CHIP_PALE, 0.8, 150);
      mark(x, h, y, nx, ny, wall, s, big ? 5.6 : 3.8, DC.HOLE + ((R() * DC.HOLE_N) | 0), DK.HOLE, HOLE, 0.95, 160);
    }
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
      for (const r of rays) if (r.hit === 1) { blood(r.x, 34, r.y, e.angle, 1.2, high ? 10 : 5, 220, true); fleshHit(r, e.angle, 34, 0, 1, true); }
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
        if (R() < 0.5) fleshHit({ x: hx, y: hy }, a, 32, 0, 0.45, true);
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
          fleshHit(r, e.angle, bh, slopeOf(r, ox, oy, oh, bh), CLASS_K[w.category] * (e.weapon === 'magnum' ? 2.2 : 1), big || w.category === 'heavy' || (shotgun && Math.hypot(r.x - ox, r.y - oy) < 220), e.weapon);
        } else if (r.hit === 2) {
          if (!shotgun || k % 2 === 0 || high) impact(r.x, bh, r.y, e.angle, big);
        }
      }
      ejectCasing(lk, isLocal, org, e.angle, w);
      if (!isLocal) {
        const size = shotgun ? 1.5 : big ? 1.6 : w.category === 'heavy' ? 1.25 : w.category === 'pistol' ? 0.8 : 1.0;
        muzzleFlash(ox, oh, oy, e.angle, size, '#ffc070', lk, e.weapon === 'magnum' ? 'magnum' : w.category);
      } else {
        // the viewmodel draws its own flash; the world still gets the light
        gatedFlash(lk, 0.06, ox, oy, oh, '#ffc070', 1.2, 180, 0.07);
        if (high && R() < (shotgun ? 0.9 : w.category === 'heavy' ? 0.3 : 0.5)) smoke(ox + ca * 6, oh, oy + sa * 6, shotgun ? 2 : 1, shotgun ? 7 : 4, shotgun ? 1.1 : 0.6, C('#8a8a8a'), shotgun ? 0.22 : 0.16, 15, 2);
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

  // angle of a world direction on the screen (billboards: 0 = quad x axis to the right)
  function screenAngle(dx, dz) {
    const e = ctx.camera.matrixWorld.elements;
    return Math.atan2(dx * e[4] + dz * e[6], dx * e[0] + dz * e[2]);
  }
  // per weapon class: star size, tongue length / width, fan (side tongues), gas sparks, glow, life
  const FLASH_STYLE = {
    pistol: { star: 6, len: 9, wid: 3.4, fan: 0, sparks: 1, glow: 0.8, life: 0.04 },
    magnum: { star: 11, len: 16, wid: 6, fan: 0, sparks: 4, glow: 1.2, life: 0.06, ring: true },
    smg: { star: 6.5, len: 11, wid: 3.6, fan: 0, sparks: 1, glow: 0.8, life: 0.035 },
    rifle: { star: 8, len: 16, wid: 4.4, fan: 1, sparks: 2, glow: 1, life: 0.045 },
    shotgun: { star: 13, len: 25, wid: 10, fan: 1, sparks: 5, glow: 1.5, life: 0.06 },
    heavy: { star: 10, len: 23, wid: 6, fan: 1, sparks: 2, glow: 1.3, life: 0.04 },
    sniper: { star: 14, len: 36, wid: 6, fan: 0, sparks: 6, glow: 1.6, life: 0.07, ring: true },
    generic: { star: 8, len: 14, wid: 5, fan: 0, sparks: 2, glow: 1, life: 0.045 },
  };
  function muzzleFlash(x, h, y, a, size, color, key = null, cat = 'generic') {
    const c = hdr(color, 1.8);
    const P = FLASH_STYLE[cat] || FLASH_STYLE.generic;
    const ca = Math.cos(a), sa = Math.sin(a);
    // a star facing the camera, a hot core and side-on tongues along the barrel (a fan for the big guns)
    glowPuff(x, h, y, 7 * size * P.glow, P.life + 0.01, c, 0.8);
    fx.spawn(x, h, y, 0, 0, 0, P.life, P.star * size, P.star * size * 0.9, hdr('#fff2c0', 2.2), 1, FR.STAR, F_ADD, 0, 0);
    const n = 1 + P.fan * 2;
    for (let k = 0; k < n; k++) {
      const off = (k - P.fan) * 0.4 * (R() < 0.5 ? 1 : -1) * (k === P.fan ? 0 : 1);
      const L = P.len * size * (off === 0 ? 1 : 0.55) * (0.85 + R() * 0.3);
      const aa = a + off;
      const cx = x + Math.cos(aa) * L * 0.45, cy = y + Math.sin(aa) * L * 0.45;
      const i = fx.spawn(cx, h, cy, 0, 0, 0, P.life, L, L, off === 0 ? c : hdr(color, 1.3), off === 0 ? 0.95 : 0.7, FR.FLASH, F_ADD, 0, 0);
      fx.stretchLast(i, (P.wid * size) / L * (off === 0 ? 1 : 0.8));
      fx.rotLast(i, screenAngle(Math.cos(aa), Math.sin(aa)));
    }
    if (P.sparks && high) sparks(x + ca * 4, h, y + sa * 4, a, 0.7, P.sparks, 420, HOT_SPARK);
    if (P.ring) ring(x + ca * 8, h, y + sa * 8, 26 * size, 0.09, hdr('#fff0d0', 1.4), 0.4, false, FR.SOFTRING);
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
      // acid on the ground and on whatever stands near
      fx0.decals.opt.wet = 1;
      fx0.decals.add(0, x, G(x, y), y, 0, 1, 0, r * 1.5, DC.ACID, DK.ACID, 0.3, 0.75, 0.1, 0.85, 200);
      shakeAt(x, y, 0.45, 1000);
      return;
    }
    const rocket = kind === 'rocket';
    lights.flash(x, y, 50, '#ffb060', rocket ? 4.5 : 3.6, r * 3.2, 0.45);
    // white-hot core flash (blooms hard for a few frames), then the fireball
    fx.spawn(x, 26, y, 0, 0, 0, 0.1, r * 0.35, r * 0.9, HOT_CORE, 1, FR.GLOW, F_ADD, 0, 0);
    fx.spawn(x, 26, y, 0, 0, 0, 0.08, r * 0.5, r * 0.9, hdr('#fff0d0', 2), 0.7, FR.STAR, F_ADD, 0, 0);
    fireball(x, 18, y, high ? (ultra ? 26 : 20) : 10, r * 0.3, r * 1.5, 0.8, FIRE_TINT, 0.5);
    // shockwave: a hot ring racing over the ground, a soft vertical one, and a ripple in the air
    ring(x, 3, y, r * 2.8, 0.42, hdr('#ffd8a0', 1.8), 0.9, true, FR.SHOCK);
    ring(x, 30, y, r * 2.2, 0.3, hdr('#ffe8c0', 1.2), 0.4, false, FR.SOFTRING);
    fx0.distort(x, 26, y, r * 1.9, 1, 0.6, 1);
    sparks(x, 20, y, 0, TAU, high ? 30 : 12, 650, HOT_SPARK);
    // shrapnel: long fast streaks that fly out and skip along the ground
    for (let k = 0; k < (high ? 14 : 5); k++) {
      const a = R() * TAU, sp = 700 + R() * 700;
      const i = fx.spawn(x, 14 + R() * 20, y, Math.cos(a) * sp, 40 + R() * 260, Math.sin(a) * sp, 0.3 + R() * 0.35, 1.1, 0.4, METAL_SPARK, 1, FR.DOT, F_ADD | F_STREAK | F_BOUNCE, 700, 0.6);
      fx.stretchLast(i, 2.5);
    }
    debris(x, 10, y, high ? 16 : 6, C('#2a2622'), 260, 3);
    // dust ring rolling outward, then a smoke column that glows while it is hot
    for (let k = 0; k < (high ? 16 : 7); k++) {
      const a = (k / (high ? 16 : 7)) * TAU + R() * 0.3;
      fx.spawn(x + Math.cos(a) * r * 0.2, 5, y + Math.sin(a) * r * 0.2, Math.cos(a) * r * 1.8, 10 + R() * 12, Math.sin(a) * r * 1.8, 1.2 + R() * 0.6, 12, 34, C('#5a5044'), 0.45, FR.DUST, 0, -2, 2.6);
    }
    smoke(x, 20, y, high ? 16 : 6, r * 0.22, 3.4, C('#2a2826'), 0.55, 45, r * 0.3, true);
    smoke(x, 10, y, high ? 6 : 3, r * 0.3, 1.8, C('#6a5040'), 0.35, 20, r * 0.4, true);
    ctx.ground.decal('scorch', x, y, r * 0.42, R() * TAU, 0.95);
    // a crater and blast streaks on the ground, soot on nearby walls
    const D = fx0.decals;
    D.add(1, x, G(x, y), y, 0, 1, 0, r * 0.95, DC.CRATER, DK.DARK, 0.03, 0.028, 0.026, 0.85, 400);
    D.add(1, x, G(x, y), y, 0, 1, 0, r * 1.9, DC.SCORCH + ((R() * DC.SCORCH_N) | 0), DK.DARK, 0.02, 0.019, 0.018, 0.7, 400);
    for (let k = 0; k < (high ? 5 : 2); k++) {
      const a = R() * TAU, dd = r * (0.4 + R() * 0.6);
      const sx = x + Math.cos(a) * dd, sy = y + Math.sin(a) * dd;
      const s = surf(sx, sy, _s);
      if (s) {
        const hh = 6 + R() * 30;
        mark(sx, hh, sy, s.nx, s.ny, true, s, r * 0.5, DC.SCORCH + ((R() * DC.SCORCH_N) | 0), DK.DARK, SCORCH, 0.85, 400);
        mark(sx, hh + r * 0.2, sy, s.nx, s.ny, true, s, r * 0.4, DC.SOOT, DK.DARK, SCORCH, 0.5, 400);
      }
    }
    // stages: a second fireball, the smoke column, the cap; then embers and a smoulder that linger
    stages.push({ at: now + 0.09, kind: 1, x, y, r }, { at: now + 0.22, kind: 2, x, y, r }, { at: now + 0.5, kind: 3, x, y, r });
    emitters.push({ kind: 'embers', x, y, age: 0, life: 5 + r / 60, acc: 0, r });
    if (r >= 90) emitters.push({ kind: 'smolder', x, y, age: 0, life: 7 + r / 40, acc: 0, r });
    shakeAt(x, y, Math.min(1, (r / 160) * 0.95), 1400);
    if (d < r) ctx.shake(1);
  }

  function explosionStage(st) {
    const { x, y, r } = st;
    if (st.kind === 1) {
      // the fire rolls up and out
      fireball(x, 40, y, high ? 14 : 6, r * 0.28, r * 0.9, 0.7, FIRE_TINT, 0.42);
      glowPuff(x, 46, y, r * 0.8, 0.22, hdr('#ff9a40', 1.6), 0.8);
      fx0.distort(x, 40, y, r * 1.2, 0.6, 2.6, 0);
    } else if (st.kind === 2) {
      // a black plume climbs
      smoke(x, 40, y, high ? 12 : 5, r * 0.26, 4.2, C('#1c1a19'), 0.6, 70, r * 0.2, true);
      smoke(x, 70, y, high ? 6 : 3, r * 0.34, 4.6, C('#26231f'), 0.5, 55, r * 0.25, false);
    } else {
      // the cap: smoke spreads out at the top of the column
      for (let k = 0; k < (high ? 10 : 4); k++) {
        const a = (k / (high ? 10 : 4)) * TAU + R() * 0.5;
        fx.spawn(x, 110 + r * 0.25, y, Math.cos(a) * r * 0.45, 8, Math.sin(a) * r * 0.45, 3.4 + R(), r * 0.3, r * 0.75, C('#33302c'), 0.42, SMOKES[k % 5], 0, -1, 0.9);
      }
    }
  }

  function zdie(e) {
    if (e.ztype === 'bloater') return;               // its explosion event carries the show
    const def = ZOMBIES[e.ztype] || ZOMBIES.walker;
    const r = def.radius || 14;
    const P = fx.gore;
    // was it finished by a heavy hit? (a recent one close to the body)
    let hh = null;
    for (let k = 0; k < HEAVY_N; k++) {
      const q = heavyHits[k];
      if (now - q.t < 0.45 && (q.x - e.x) * (q.x - e.x) + (q.y - e.y) * (q.y - e.y) < 60 * 60) { hh = q; break; }
    }
    if (e.gib) {
      // blown apart: limbs, a torso chunk and the head fly; blood on everything near
      const power = hh ? 0.55 + hh.power * 0.45 : 0.7;
      gore3.burst(e.x, e.y, hh ? hh.ang : NaN, power, r, e.id);
      blood(e.x, 30, e.y, 0, TAU, high ? 18 : 8, 250, true);
      fx.spawn(e.x, 34, e.y, 0, 12, 0, 0.7, r * 0.8, r * 3, P.mist, 0.55, FR.MIST, 0, 0, 2);
      blood3.burstAround(e.x, e.y, r, power);
      blood3.notePool(e.x, e.y, r * 1.8);
      return;
    }
    const a = e.angle || 0;
    blood(e.x, 26, e.y, a + Math.PI, 1.8, high ? 7 : 3, 130);
    blood3.pool(e.x - Math.cos(a) * r * 0.25, e.y - Math.sin(a) * r * 0.25, r * (1.1 + R() * 0.3));
    blood3.notePool(e.x, e.y, r * 1.2);
    if (R() < 0.6) blood3.groundSplat(e.x + (R() - 0.5) * r * 3, e.y + (R() - 0.5) * r * 3, 7 + R() * 9, 0.75);
    // a drag smear where it was moving when it fell
    const mv = blood3.lastMove(e.id, e.x, e.y);
    if (Number.isFinite(mv)) blood3.smear(e.x - Math.cos(mv) * (36 + R() * 34), e.y - Math.sin(mv) * (36 + R() * 34), e.x, e.y, r * 0.7, 0.8);
    // a heavy finishing hit tears a limb off
    if (hh && hh.power >= 0.5 && P.k > 0 && R() < 0.6) {
      gore3.limb(e.x, e.y, hh.ang, hh.power, e.id);
      blood(e.x, 32, e.y, hh.ang, 1.2, high ? 10 : 4, 280, true);
      blood3.exitSpray(e.x, 30, e.y, hh.ang, hh.power, 0);
    }
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
          // crackling sparks skip along the ground and leave a small burn
          if (high) {
            sparks(pts[k].x, 6, pts[k].y, R() * TAU, TAU, 5, 240, hdr('#b8f0ff', 2.6));
            if (R() < 0.5) fx0.decals.add(1, pts[k].x, g, pts[k].y, 0, 1, 0, 8 + R() * 6, DC.SCORCH + ((R() * DC.SCORCH_N) | 0), DK.DARK, 0.02, 0.02, 0.02, 0.4, 80);
          }
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
      case 'zdie': zdie(e); break;
      case 'freeze': {
        // frost races over a zombie and locks it solid: ice shards, a cold flash
        for (let k = 0; k < (high ? 14 : 6); k++) {
          const a = R() * TAU, s = 40 + R() * 90;
          fx.spawn(e.x, 20 + R() * 30, e.y, Math.cos(a) * s, 30 + R() * 80, Math.sin(a) * s, 0.8 + R() * 0.4, 1.8, 1.2, ICE_SHARD, 0.9, FR.SHARD, F_BOUNCE | F_SPIN, 600, 0.5);
        }
        sparkles(e.x, e.y, high ? 10 : 4, ICE_GLINT, 26);
        for (let k = 0; k < (high ? 6 : 2); k++) {
          const a = R() * TAU, sp = 15 + R() * 40;
          fx.spawn(e.x + Math.cos(a) * 6, 16 + R() * 34, e.y + Math.sin(a) * 6, Math.cos(a) * sp, 8 + R() * 30, Math.sin(a) * sp, 1.1 + R() * 0.8, 6 + R() * 5, 3, ICE_GLINT, 0.9, FR.CRYSTAL, F_ADD | F_FLICKER | F_SPIN, 60, 1);
        }
        fx0.decals.add(1, e.x, G(e.x, e.y), e.y, 0, 1, 0, 60, DC.ASH, DK.PALE, 0.55, 0.75, 0.85, 0.5, 30);
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
        fx0.decals.add(1, e.x, G(e.x, e.y), e.y, 0, 1, 0, r * 1.7, DC.SCORCH + ((R() * DC.SCORCH_N) | 0), DK.DARK, 0.02, 0.018, 0.016, 0.7, 300);
        emitters.push({ kind: 'smolder', x: e.x, y: e.y, age: 0, life: 8, acc: 0, r: r * 0.7 });
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
          blood3.pool(p.x, p.y, 20, 0.95);
          blood3.notePool(p.x, p.y, 22);
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

    // gore setting, blood on the ground, body parts, casings, delayed explosion stages
    if (fx.setGore(frame.settings && frame.settings.gore) && fx.gore.k <= 0) gore3.clear();
    blood3.update(view, frame);
    gore3.step(dt);
    casings.step(dt);
    for (let k = stages.length - 1; k >= 0; k--) {
      const st = stages[k];
      if (now < st.at) continue;
      stages.splice(k, 1);
      gOff = rough ? G(st.x, st.y) : 0;
      explosionStage(st);
      gOff = 0;
    }

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
        // a hot flare glow that pulses, with a soft star
        fx.glow(em.x, 12, em.y, 34 + Math.sin(now * 21) * 4, hdr('#ff3a20', 1.3), 0.5);
        gOff = 0;
      } else if (em.kind === 'embers') {
        // glowing sparks that drift up from the blast site, and flakes of ash
        gOff = rough ? G(em.x, em.y) : 0;
        const fade = 1 - em.age / em.life;
        em.acc += dt * (ultra ? 15 : high ? 8 : 3) * fade;
        while (em.acc >= 1 && fx.load() < 0.9) {
          em.acc -= 1;
          const a = R() * TAU, rr = Math.sqrt(R()) * em.r * 0.5;
          const px = em.x + Math.cos(a) * rr, py = em.y + Math.sin(a) * rr;
          if (R() < 0.7) fx.spawn(px, 3 + R() * 10, py, (R() - 0.3) * 26, 40 + R() * 70, (R() - 0.5) * 26, 1.1 + R() * 1.3, 1.5 + R() * 1.2, 0.5, hdr('#ffab50', 3), 1, FR.EMBER, F_ADD | F_FLICKER, -14, 0.6);
          else fx.spawn(px, 6 + R() * 12, py, (R() - 0.3) * 30, 30 + R() * 40, (R() - 0.5) * 30, 2 + R() * 1.5, 1.6, 1.2, C('#3a3733'), 0.7, FR.DOT, 0, -6, 0.8);
        }
        gOff = 0;
      } else if (em.kind === 'smolder') {
        // the wreckage keeps burning low for a while: small flames, black smoke, an orange glow
        gOff = rough ? G(em.x, em.y) : 0;
        const fade = Math.min(1, (em.life - em.age) / 2);
        em.acc += dt * (ultra ? 7 : high ? 4 : 1.5) * fade;
        while (em.acc >= 1 && fx.load() < 0.85) {
          em.acc -= 1;
          const a = R() * TAU, rr = Math.sqrt(R()) * em.r * 0.45;
          const i = fx.spawn(em.x + Math.cos(a) * rr, 2, em.y + Math.sin(a) * rr, (R() - 0.5) * 8, 30 + R() * 30, (R() - 0.5) * 8, 0.5 + R() * 0.4, 6 + R() * 5, 3, WHITE, 0.8, R() < 0.5 ? FR.FLAME : FR.FLAME2, F_ADD | F_FIRE | F_FLICKER, -30, 1);
          fx.stretchLast(i, 1.5);
          if (R() < 0.5) fx.spawn(em.x + Math.cos(a) * rr, 16, em.y + Math.sin(a) * rr, (R() - 0.5) * 8, 30, (R() - 0.5) * 8, 2.6, 10, 34, C('#1c1a19'), 0.4, SMOKES[(R() * 5) | 0], F_HOT, -6, 0.4);
        }
        fx.glow(em.x, 2, em.y, em.r * 1.6, hdr('#ff7a2a', 1.4), 0.22 * fade, FR.GLOW, true);
        lights.steady('smolder' + k, em.x, em.y, 24, '#ff8a33', 0.9 * fade, em.r * 2.4);
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
      env.high = high;
      env.ultra = ultra;
      fx.setQuality(q);
      gore3.setQuality(q);
      casings.setQuality(q);
      blood3.setQuality(q);
    },
    dispose() {
      for (const m of crateMeshes) m.removeFromParent();
      crateGeo.dispose();
      gore3.dispose();
      casings.dispose();
      releaseFx(ctx);
    },
    /** Test hook: live effect counts. */
    get stats() { return { tracers: tracers.length, arcs: arcs.length, rails: rails.length, pieces: gore3.count, casings: casings.count, ...fx.stats }; },
    /** Test hook: the shared fx pools (decal ring buffers, palette). */
    get fx() { return fx0; },
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

export { createEffects3D as createEffects };
