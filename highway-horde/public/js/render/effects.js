// Particles and short-lived effects driven by GameEvents (SPEC §4.1) and by entity state
// (rocket trails, burning zombies, fires). Particles live in a fixed-size
// structure-of-arrays pool with a hard cap, so a minigun into a horde can never allocate
// or grow without bound; when the pool is full new particles are simply dropped.

import { WEAPONS } from '../shared/weapons.js';
import { ZOMBIES } from '../shared/zombies.js';
import { makeCanvas, rgba, hash01 } from './util.js';
import {
  coreSprite, fireSprite, smokePuff, bloodSplats, scorchSprite, slamCracks,
} from './textures.js';
import { muzzleOffset, PICKUP_GLOW } from './actors.js';

const TAU = Math.PI * 2;
const GRAV = 900;

// particle types
const P_SPARK = 0, P_FIRE = 1, P_SMOKE = 2, P_BLOOD = 3, P_CASING = 4, P_GIB = 5, P_DUST = 6,
  P_DEBRIS = 7, P_EMBER = 8, P_GLASS = 9, P_ACID = 10, P_SPARKLE = 11, P_MAG = 12, P_SPLINTER = 13,
  P_ZAP = 14, P_FLASH = 15;
const ADDITIVE = new Uint8Array(16);
ADDITIVE[P_SPARK] = ADDITIVE[P_FIRE] = ADDITIVE[P_EMBER] = ADDITIVE[P_SPARKLE] = ADDITIVE[P_ZAP] = ADDITIVE[P_FLASH] = 1;
const HAS_Z = new Uint8Array(16);
HAS_Z[P_BLOOD] = HAS_Z[P_CASING] = HAS_Z[P_GIB] = HAS_Z[P_DEBRIS] = HAS_Z[P_GLASS] = HAS_Z[P_ACID] = HAS_Z[P_MAG] = HAS_Z[P_SPLINTER] = 1;

// colour palette for solid particles (index stored per particle)
const PAL = ['#c9a23a', '#b3261e', '#6e0b0b', '#8a1010', '#5d5f61', '#7a766e', '#3a3a3a', '#8a6238', '#bcd8e6',
  '#8ee03a', '#2a2a2a', '#d0c8b0', '#4a2020', '#e8e0d0'];
const C_BRASS = 0, C_SHELL = 1, C_BLOOD = 2, C_BLOOD2 = 3, C_METAL = 4, C_CONCRETE = 5, C_DARK = 6,
  C_WOOD = 7, C_GLASS = 8, C_ACID = 9, C_MAG = 10, C_DUSTC = 11, C_FLESH = 12, C_BONE = 13;

let dropSpr = null, gibSprs = null;
/** Soft round blood drop (16 px, dark red). */
function dropSprite() {
  if (!dropSpr) {
    dropSpr = makeCanvas(16, 16);
    const g = dropSpr.getContext('2d');
    const grad = g.createRadialGradient(7, 7, 0, 8, 8, 8);
    grad.addColorStop(0, '#a01414');
    grad.addColorStop(0.6, '#6e0b0b');
    grad.addColorStop(1, 'rgba(90,5,5,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 16);
  }
  return dropSpr;
}
/** Three irregular flesh chunks (24 px). */
function gibSprites() {
  if (gibSprs) return gibSprs;
  gibSprs = [];
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(24, 24);
    const g = c.getContext('2d');
    let seed = 91 + v * 17;
    const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU, d = 6 + rr() * 5;
      if (k === 0) g.moveTo(12 + Math.cos(a) * d, 12 + Math.sin(a) * d); else g.lineTo(12 + Math.cos(a) * d, 12 + Math.sin(a) * d);
    }
    g.closePath();
    const grad = g.createRadialGradient(10, 9, 1, 12, 12, 11);
    grad.addColorStop(0, v === 2 ? '#8a9a60' : '#b04040');
    grad.addColorStop(1, v === 2 ? '#3a4a20' : '#4a0808');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(20,0,0,0.6)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = 'rgba(230,220,200,0.7)';
    g.fillRect(9 + rr() * 5, 9 + rr() * 5, 2.5, 1.5);
    gibSprs.push(c);
  }
  return gibSprs;
}

const tintCache = new Map();
function tinted(sprite, color) {
  const key = color + '|' + sprite.width;
  let c = tintCache.get(key);
  if (!c) {
    c = makeCanvas(sprite.width, sprite.height);
    const g = c.getContext('2d');
    g.drawImage(sprite, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    tintCache.set(key, c);
  }
  return c;
}

/**
 * @param {{cap:number, quality:string, decals:object, zsprites:object}} opts
 */
export function createEffects(opts) {
  let cap = opts.cap;
  const MAXP = 4000;
  const X = new Float32Array(MAXP), Y = new Float32Array(MAXP), Z = new Float32Array(MAXP);
  const VX = new Float32Array(MAXP), VY = new Float32Array(MAXP), VZ = new Float32Array(MAXP);
  const LIFE = new Float32Array(MAXP), MAX = new Float32Array(MAXP), SIZE = new Float32Array(MAXP);
  const GROW = new Float32Array(MAXP), ROT = new Float32Array(MAXP), VR = new Float32Array(MAXP);
  const DRAG = new Float32Array(MAXP), ALPHA = new Float32Array(MAXP);
  const TYPE = new Uint8Array(MAXP), COL = new Uint8Array(MAXP), REST = new Uint8Array(MAXP);
  let n = 0;
  let quality = opts.quality;
  let decals = opts.decals;
  let zsprites = opts.zsprites;
  let rnd = 0x9e3779b9;
  // Fast local rng for cosmetic jitter (Math.random is fine here but this avoids its
  // overhead in the hottest loops and keeps effects reproducible in screenshots).
  function R() {
    rnd = (rnd + 0x6d2b79f5) >>> 0;
    let t = rnd;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function spawn(type, x, y, vx, vy, life, size) {
    if (n >= cap) return -1;
    const i = n++;
    TYPE[i] = type; X[i] = x; Y[i] = y; Z[i] = 0; VX[i] = vx; VY[i] = vy; VZ[i] = 0;
    LIFE[i] = life; MAX[i] = life; SIZE[i] = size; GROW[i] = 0; ROT[i] = R() * TAU; VR[i] = 0;
    DRAG[i] = 0; ALPHA[i] = 1; COL[i] = 0; REST[i] = 0;
    return i;
  }
  function kill(i) {
    const j = --n;
    if (i === j) return;
    X[i] = X[j]; Y[i] = Y[j]; Z[i] = Z[j]; VX[i] = VX[j]; VY[i] = VY[j]; VZ[i] = VZ[j];
    LIFE[i] = LIFE[j]; MAX[i] = MAX[j]; SIZE[i] = SIZE[j]; GROW[i] = GROW[j]; ROT[i] = ROT[j];
    VR[i] = VR[j]; DRAG[i] = DRAG[j]; ALPHA[i] = ALPHA[j]; TYPE[i] = TYPE[j]; COL[i] = COL[j]; REST[i] = REST[j];
  }

  // ---- transient effect records (small pools of plain objects) ---------------------------
  const tracers = [], beams = [], arcs = [], rings = [], flashes = [], lights = [], swipes = [], emitters = [];
  const pools = new Map();
  function take(list, max) {
    if (list.length >= max) return null;
    let pool = pools.get(list);
    if (!pool) { pool = []; pools.set(list, pool); }
    const o = pool.pop() || {};
    list.push(o);
    return o;
  }
  function recycle(list, i) {
    const o = list[i];
    list[i] = list[list.length - 1];
    list.pop();
    pools.get(list).push(o);
  }

  function addLight(x, y, r, intensity, color, life) {
    const L = take(lights, 96);
    if (!L) return;
    L.x = x; L.y = y; L.r = r; L.i = intensity; L.color = color; L.life = life; L.max = life;
  }

  const TIMED = [beams, arcs, rings, flashes, lights, swipes];

  // ---- composite spawners ------------------------------------------------------------------
  const heavy = () => quality === 'high';

  function sparks(x, y, dir, spread, count, speed, color = 0) {
    for (let k = 0; k < count; k++) {
      const a = dir + (R() - 0.5) * spread;
      const s = speed * (0.4 + R() * 0.8);
      const i = spawn(color ? P_ZAP : P_SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.15 + R() * 0.25, 1 + R());
      if (i >= 0) DRAG[i] = 4;
    }
  }
  function smoke(x, y, count, size, life, dark = 0.6, spread = 10, rise = 20) {
    if (!heavy() && count > 1) count = Math.ceil(count / 3);
    for (let k = 0; k < count; k++) {
      const i = spawn(P_SMOKE, x + (R() - 0.5) * spread, y + (R() - 0.5) * spread,
        (R() - 0.5) * rise, (R() - 0.5) * rise - rise * 0.3, life * (0.7 + R() * 0.6), size * (0.7 + R() * 0.6));
      if (i >= 0) { GROW[i] = size * 0.9; DRAG[i] = 1.2; ALPHA[i] = dark; VR[i] = (R() - 0.5) * 0.6; }
    }
  }
  function dust(x, y, count, size, speed, life = 0.9, dir = 0, spread = TAU) {
    if (!heavy()) count = Math.ceil(count / 2);
    for (let k = 0; k < count; k++) {
      const a = dir + (R() - 0.5) * spread, s = speed * (0.3 + R() * 0.8);
      const i = spawn(P_DUST, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + R() * 0.6), size * (0.6 + R() * 0.7));
      if (i >= 0) { GROW[i] = size; DRAG[i] = 3.5; ALPHA[i] = 0.55; }
    }
  }
  function fire(x, y, count, size, speed, life = 0.5, spread = 8, alpha = 1) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = speed * R();
      const i = spawn(P_FIRE, x + (R() - 0.5) * spread, y + (R() - 0.5) * spread, Math.cos(a) * s, Math.sin(a) * s - speed * 0.2, life * (0.6 + R() * 0.7), size * (0.6 + R() * 0.7));
      if (i >= 0) { DRAG[i] = 2.5; GROW[i] = -size * 0.5; ALPHA[i] = alpha; }
    }
  }
  function embers(x, y, count, speed = 80, spread = 10) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = speed * (0.3 + R());
      const i = spawn(P_EMBER, x + (R() - 0.5) * spread, y + (R() - 0.5) * spread, Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5 - speed * 0.5, 0.6 + R() * 1.0, 1 + R() * 1.2);
      if (i >= 0) DRAG[i] = 1.2;
    }
  }
  function zParticles(type, col, x, y, dir, spread, count, speed, up, size, life) {
    for (let k = 0; k < count; k++) {
      const a = dir + (R() - 0.5) * spread, s = speed * (0.3 + R() * 0.9);
      const i = spawn(type, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.7 + R() * 0.6), size * (0.6 + R() * 0.8));
      if (i < 0) return;
      VZ[i] = up * (0.4 + R());
      Z[i] = 4 + R() * 6;
      COL[i] = col;
      VR[i] = (R() - 0.5) * 20;
      DRAG[i] = 0.6;
    }
  }
  function blood(x, y, dir, spread, count, speed, big = false) {
    zParticles(P_BLOOD, R() < 0.5 ? C_BLOOD : C_BLOOD2, x, y, dir, spread, count, speed, 120, big ? 2.4 : 1.6, 1.5);
    // a mist puff reads as a hit even when the droplets are tiny on screen
    if (heavy()) {
      const i = spawn(P_SMOKE, x, y, Math.cos(dir) * 40, Math.sin(dir) * 40, 0.3, big ? 14 : 8);
      if (i >= 0) { GROW[i] = 18; ALPHA[i] = -0.7; DRAG[i] = 5; }
    }
  }
  function ring(x, y, r0, r1, life, color, width, alpha = 1) {
    const o = take(rings, 48);
    if (!o) return;
    o.x = x; o.y = y; o.r0 = r0; o.r1 = r1; o.life = life; o.max = life; o.color = color; o.w = width; o.a = alpha;
  }
  function flash(x, y, angle, size, life, kind) {
    const o = take(flashes, 64);
    if (!o) return;
    o.x = x; o.y = y; o.angle = angle; o.size = size; o.life = life; o.max = life; o.kind = kind;
    o.seed = R();
  }

  function explosion(x, y, r, kind, env) {
    const green = kind === 'bloater';
    const s = r / 150;
    if (green) {
      zParticles(P_ACID, C_ACID, x, y, 0, TAU, heavy() ? 40 : 16, 380 * s, 200, 2.2, 1.3);
      zParticles(P_GIB, C_FLESH, x, y, 0, TAU, heavy() ? 10 : 5, 300 * s, 260, 3.2, 3);
      const spr = bloodSplats('green');
      for (let k = 0; k < 4; k++) {
        decals.stamp(spr[(R() * spr.length) | 0], x + (R() - 0.5) * r * 0.6, y + (R() - 0.5) * r * 0.6, R() * TAU, r * (0.5 + R() * 0.5), 0.8);
      }
      smoke(x, y, 10, 40 * s, 1.2, -0.5, r * 0.4, 60);
      ring(x, y, r * 0.2, r * 1.05, 0.35, '#b8ff5a', 6);
      addLight(x, y, r * 2, 0.8, '#a6ff4a', 0.35);
    } else {
      // flash, fireball, sparks, debris, smoke, shockwave, scorch
      flash(x, y, 0, r * 0.9, 0.1, 2);
      addLight(x, y, r * 3.2, 1, '#ffb050', 0.55);
      fire(x, y, heavy() ? 24 : 12, 30 * s + 10, 260 * s, 0.6, r * 0.3, 0.45);
      fire(x, y, 6, 44 * s + 10, 60, 0.35, r * 0.15, 0.5);
      sparks(x, y, 0, TAU, heavy() ? 30 : 12, 700 * s + 200);
      zParticles(P_DEBRIS, R() < 0.5 ? C_CONCRETE : C_METAL, x, y, 0, TAU, heavy() ? 14 : 6, 420 * s, 320, 2.6, 2.5);
      smoke(x, y, 16, 46 * s + 8, 2.4, 0.75, r * 0.5, 50);
      embers(x, y, heavy() ? 20 : 8, 160, r * 0.3);
      ring(x, y, r * 0.2, r * 1.15, 0.3, '#ffd8a0', 3 + 3 * s, 0.45);
      decals.stamp(scorchSprite(), x, y, R() * TAU, r * 1.35, 0.9);
    }
    const d = env.dist(x, y);
    env.shake(Math.min(0.9, (r / 160) * 0.9 * Math.max(0, 1 - d / 1300)));
  }

  // ---- event handling -------------------------------------------------------------------------

  let hitMarker = 0, killMarker = 0, damagePulse = 0, bloom = 0;
  // Separate dedupe for heavy streams: at most this many tracers per frame.
  let tracerBudget = 0;

  function shot(e, env) {
    const w = WEAPONS[e.weapon];
    if (!w) return;
    const rays = e.rays || [];
    if (e.echo) {
      // The host's copy of a shot we already drew as predicted (SPEC §4.1): nothing to
      // draw again, but its hits are the real ones, so they drive the hit marker.
      if (e.pid && e.pid === env.localId) for (const r of rays) if (r && r.hit === 1) hitMarker = 1;
      return;
    }
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    const extra = e.pid ? muzzleOffset(e.weapon) - 22 : 6;
    const mx = e.x + ca * extra, my = e.y + sa * extra;
    const local = e.pid && e.pid === env.localId;
    let anyFlesh = false;
    if (w.kind === 'rail') {
      const end = rays.length ? rays[0] : { x: mx + ca * w.range, y: my + sa * w.range, hit: 0 };
      const b = take(beams, 12);
      if (b) { b.x1 = mx; b.y1 = my; b.x2 = end.x; b.y2 = end.y; b.life = 0.45; b.max = 0.45; b.color = w.tracer; b.seed = R() * 100; }
      addLight(mx, my, 260, 1, '#b388ff', 0.3);
      addLight(end.x, end.y, 200, 0.8, '#b388ff', 0.3);
      sparks(end.x, end.y, e.angle + Math.PI, 2, 14, 500, 1);
      flash(mx, my, e.angle, 30, 0.1, 3);
      for (const r of rays) if (r.hit === 1) anyFlesh = true;
    } else if (w.kind === 'hitscan') {
      const big = w.category === 'sniper' || e.weapon === 'magnum';
      const size = w.category === 'shotgun' ? 26 : w.category === 'sniper' ? 30 : w.category === 'heavy' ? 22 : w.category === 'pistol' ? 15 : 19;
      flash(mx, my, e.angle, size, 0.06, 0);
      addLight(mx, my, 150 + size * 4, 0.9, '#ffc070', 0.07);
      if (heavy() || R() < 0.5) {
        const i = spawn(P_SMOKE, mx, my, ca * 40, sa * 40, 0.5, 6);
        if (i >= 0) { GROW[i] = 14; ALPHA[i] = 0.25; DRAG[i] = 3; }
      }
      for (let k = 0; k < rays.length; k++) {
        const r = rays[k];
        if (tracerBudget > 0 || k === 0) {
          tracerBudget--;
          const t = take(tracers, 320);
          if (t) {
            t.x1 = mx; t.y1 = my; t.x2 = r.x; t.y2 = r.y;
            const len = Math.hypot(r.x - mx, r.y - my);
            t.len = len; t.color = w.tracer; t.w = big ? 2.6 : w.category === 'shotgun' ? 1.3 : 1.7;
            t.age = 0; t.travel = Math.max(0.03, len / 5200); t.max = t.travel + 0.12;
          }
        }
        if (r.hit === 1) {
          anyFlesh = true;
          blood(r.x, r.y, e.angle, 1.1, heavy() ? 5 : 2, 180);
        } else if (r.hit === 2) {
          sparks(r.x, r.y, e.angle + Math.PI, 2.2, heavy() ? 5 : 2, 300);
          if (heavy() && R() < 0.5) dust(r.x, r.y, 1, 6, 30, 0.5, e.angle + Math.PI, 1.5);
        }
      }
      // brass: one casing per shot event, shells for shotguns
      if (w.category !== 'shotgun' || R() < 0.6) {
        const ea = e.angle + Math.PI / 2 + (R() - 0.5) * 0.6;
        const ex = e.x - ca * (extra > 10 ? 4 : 10), ey = e.y - sa * (extra > 10 ? 4 : 10);
        const i = spawn(P_CASING, ex, ey, Math.cos(ea) * (90 + R() * 70), Math.sin(ea) * (90 + R() * 70), heavy() ? 5 : 2, w.category === 'shotgun' ? 2.2 : 1.6);
        if (i >= 0) { VZ[i] = 140 + R() * 60; Z[i] = 10; COL[i] = w.category === 'shotgun' ? C_SHELL : C_BRASS; VR[i] = (R() - 0.5) * 40; DRAG[i] = 0.8; }
      }
    } else if (w.kind === 'flame') {
      fire(mx, my, 2, 10, 60, 0.18, 4);
      addLight(mx, my, 160, 0.5, '#ff9a40', 0.08);
    } else if (w.kind === 'projectile') {
      const kind = w.projectile && w.projectile.kind;
      if (kind === 'rocket') {
        flash(mx, my, e.angle, 26, 0.08, 0);
        addLight(mx, my, 260, 1, '#ffb050', 0.12);
        // back-blast out of the rear of the tube
        smoke(e.x - ca * 30, e.y - sa * 30, 8, 18, 1.4, 0.55, 12, 90);
        fire(e.x - ca * 26, e.y - sa * 26, 6, 14, 160, 0.25, 6);
      } else if (kind === 'grenade') {
        flash(mx, my, e.angle, 18, 0.06, 0);
        smoke(mx, my, 3, 12, 0.9, 0.5, 6, 40);
      }
    } else if (w.kind === 'chain') {
      flash(mx, my, e.angle, 14, 0.06, 3);
    }
    if (local) {
      env.shake(w.recoil * 0.22);
      bloom = Math.min(1, bloom + w.recoil * 0.9 + 0.08);
      // Predicted hits are guesses; the echo confirms them.
      if (anyFlesh && !e.predicted) hitMarker = 1;
    }
  }

  function handle(e, env) {
    switch (e.type) {
      case 'shot': shot(e, env); break;
      case 'chain': {
        const pts = e.points || [];
        if (pts.length < 2) break;
        const o = take(arcs, 32);
        if (o) {
          if (!o.pts) o.pts = [];
          o.pts.length = 0;
          for (const p of pts) o.pts.push(p.x, p.y);
          o.life = 0.16; o.max = 0.16; o.seed = R() * 100;
        }
        for (let k = 1; k < pts.length; k++) {
          sparks(pts[k].x, pts[k].y, 0, TAU, heavy() ? 5 : 2, 260, 1);
          addLight(pts[k].x, pts[k].y, 150, 0.8, '#80d8ff', 0.15);
        }
        addLight(pts[0].x, pts[0].y, 200, 0.9, '#80d8ff', 0.12);
        if (e.pid === env.localId) hitMarker = 1;
        break;
      }
      case 'melee': {
        const o = take(swipes, 24);
        if (o) { o.x = e.x; o.y = e.y; o.angle = e.angle; o.life = 0.22; o.max = 0.22; o.kind = 0; }
        if (e.hits > 0) {
          blood(e.x + Math.cos(e.angle) * 40, e.y + Math.sin(e.angle) * 40, e.angle, 1.2, 4 + e.hits * 2, 160);
          if (e.pid === env.localId) { hitMarker = 1; env.shake(0.12); }
        }
        break;
      }
      case 'zdie': zdie(e, env); break;
      case 'zattack': {
        const def = ZOMBIES[e.ztype];
        const r = def ? def.radius : 14;
        const o = take(swipes, 24);
        if (o) { o.x = e.x + Math.cos(e.angle) * r * 0.8; o.y = e.y + Math.sin(e.angle) * r * 0.8; o.angle = e.angle; o.life = 0.2; o.max = 0.2; o.kind = 1; o.r = r; }
        break;
      }
      case 'spit':
        zParticles(P_ACID, C_ACID, e.x + Math.cos(e.angle) * 14, e.y + Math.sin(e.angle) * 14, e.angle, 0.8, 6, 90, 60, 1.6, 0.8);
        addLight(e.x, e.y, 90, 0.5, '#a6ff4a', 0.2);
        break;
      case 'scream':
        ring(e.x, e.y, 10, 240, 0.7, '#e8ecff', 3, 0.7);
        ring(e.x, e.y, 10, 170, 0.5, '#c8a0ff', 2, 0.6);
        if (env.dist(e.x, e.y) < 500) env.shake(0.12);
        break;
      case 'charge':
        dust(e.x - Math.cos(e.angle) * 20, e.y - Math.sin(e.angle) * 20, 10, 16, 120, 0.9, e.angle + Math.PI, 1.8);
        break;
      case 'slam': {
        const r = e.r || 190;
        ring(e.x, e.y, 20, r, 0.45, '#ffe6c0', 10, 0.9);
        ring(e.x, e.y, 10, r * 0.7, 0.35, '#c8a070', 6, 0.6);
        dust(e.x, e.y, 26, 26, r * 2.2, 1.1);
        zParticles(P_DEBRIS, C_CONCRETE, e.x, e.y, 0, TAU, heavy() ? 18 : 8, 300, 380, 3, 2.5);
        decals.stamp(slamCracks(), e.x, e.y, R() * TAU, r * 0.9, 0.9);
        env.shake(Math.min(1, 0.85 * Math.max(0.2, 1 - env.dist(e.x, e.y) / 1400)));
        break;
      }
      case 'explosion': explosion(e.x, e.y, e.r || 150, e.kind, env); break;
      case 'ignite': {
        const r = e.r || 110;
        fire(e.x, e.y, heavy() ? 40 : 16, 26, r * 2, 0.6, r * 0.5);
        zParticles(P_GLASS, C_GLASS, e.x, e.y, 0, TAU, 10, 200, 150, 1.4, 1.5);
        addLight(e.x, e.y, r * 3, 1, '#ff9a40', 0.5);
        flash(e.x, e.y, 0, r * 0.8, 0.12, 2);
        decals.stamp(scorchSprite(), e.x, e.y, R() * TAU, r * 1.6, 0.6);
        env.shake(0.15 * Math.max(0, 1 - env.dist(e.x, e.y) / 1000));
        break;
      }
      case 'pdamage': {
        const p = env.player(e.pid);
        if (p) {
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          blood(p.x, p.y, a, 1.4, Math.min(8, 2 + Math.round(e.amount / 6)), 150);
        }
        if (e.pid === env.localId) {
          damagePulse = Math.min(1, damagePulse + 0.25 + e.amount / 60);
          env.shake(Math.min(0.35, 0.08 + e.amount / 120));
        }
        break;
      }
      case 'down': {
        const p = env.player(e.pid);
        if (p) {
          blood(p.x, p.y, 0, TAU, 14, 120, true);
          decals.stamp(bloodSplats('red')[(R() * 6) | 0], p.x, p.y, R() * TAU, 70, 0.9);
        }
        break;
      }
      case 'revived': case 'respawn': {
        const p = env.player(e.pid);
        if (p) {
          ring(p.x, p.y, 10, 70, 0.5, e.type === 'revived' ? '#7dff9a' : '#ffffff', 3, 0.9);
          sparkles(p.x, p.y, 16, e.type === 'revived' ? '#7dff9a' : '#dfefff', 50);
          addLight(p.x, p.y, 180, 0.8, e.type === 'revived' ? '#7dff9a' : '#dfefff', 0.5);
        }
        break;
      }
      case 'died': {
        const p = env.player(e.pid);
        if (p) dust(p.x, p.y, 6, 14, 50);
        break;
      }
      case 'pickup':
        sparkles(e.x, e.y, 14, PICKUP_GLOW[e.kind] || '#fff', 60);
        ring(e.x, e.y, 6, 34, 0.3, PICKUP_GLOW[e.kind] || '#fff', 2, 0.8);
        break;
      case 'place':
        dust(e.x, e.y, 10, 14, 90, 0.7);
        break;
      case 'destroyed':
        if (e.kind === 'turret') {
          flash(e.x, e.y, 0, 50, 0.1, 2);
          fire(e.x, e.y, 14, 16, 140, 0.4, 10);
          sparks(e.x, e.y, 0, TAU, 20, 400);
          zParticles(P_DEBRIS, C_METAL, e.x, e.y, 0, TAU, 10, 220, 260, 2.6, 3);
          smoke(e.x, e.y, 8, 20, 2, 0.8, 10, 40);
          addLight(e.x, e.y, 260, 1, '#ffb050', 0.4);
          decals.stamp(scorchSprite(), e.x, e.y, R() * TAU, 70, 0.8);
          env.shake(0.25 * Math.max(0, 1 - env.dist(e.x, e.y) / 1000));
        } else {
          zParticles(P_SPLINTER, C_WOOD, e.x, e.y, 0, TAU, heavy() ? 22 : 10, 240, 220, 2.4, 3);
          dust(e.x, e.y, 12, 18, 120, 0.9);
        }
        break;
      case 'objhit':
        sparks(e.x, e.y, R() * TAU, 2.5, heavy() ? 6 : 3, 260);
        zParticles(P_DEBRIS, C_METAL, e.x, e.y, R() * TAU, 2, 2, 120, 150, 1.8, 1.5);
        break;
      case 'drop': {
        dust(e.x, e.y, 24, 22, 260, 1.2);
        ring(e.x, e.y, 10, 90, 0.4, '#ffe0a0', 4, 0.8);
        const em = take(emitters, 16);
        if (em) { em.x = e.x + 18; em.y = e.y - 10; em.life = 9; em.kind = 'flare'; em.acc = 0; }
        addLight(e.x, e.y, 220, 0.8, '#ff5a3a', 1);
        env.shake(0.2 * Math.max(0, 1 - env.dist(e.x, e.y) / 1000));
        break;
      }
      case 'bossspawn':
        dust(e.x, e.y, 30, 30, 260, 1.4);
        zParticles(P_DEBRIS, C_CONCRETE, e.x, e.y, 0, TAU, 16, 260, 360, 3.2, 3);
        decals.stamp(slamCracks(), e.x, e.y, R() * TAU, 160, 1);
        ring(e.x, e.y, 30, 260, 0.6, '#c080ff', 8, 0.8);
        env.shake(0.7 * Math.max(0.3, 1 - env.dist(e.x, e.y) / 1600));
        break;
      case 'reload': {
        const p = env.player(e.pid);
        const w = WEAPONS[e.weapon];
        if (p && w && w.category !== 'shotgun' && e.weapon !== 'magnum' && heavy()) {
          const i = spawn(P_MAG, p.x + Math.cos(p.angle) * 8, p.y + Math.sin(p.angle) * 8, (R() - 0.5) * 40, (R() - 0.5) * 40, 4, 2.2);
          if (i >= 0) { VZ[i] = 40; Z[i] = 12; COL[i] = C_MAG; VR[i] = (R() - 0.5) * 10; DRAG[i] = 1; }
        }
        break;
      }
      default:
        break;
    }
  }

  function sparkles(x, y, count, color, speed) {
    for (let k = 0; k < count; k++) {
      const a = R() * TAU, s = speed * (0.3 + R());
      const i = spawn(P_SPARKLE, x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * s, Math.sin(a) * s - 20, 0.5 + R() * 0.4, 2 + R() * 2);
      if (i >= 0) { DRAG[i] = 3; COL[i] = sparkleColorIndex(color); }
    }
  }
  const sparkleColors = [];
  function sparkleColorIndex(c) {
    let i = sparkleColors.indexOf(c);
    if (i < 0) { sparkleColors.push(c); i = sparkleColors.length - 1; }
    return i;
  }

  function zdie(e, env) {
    const ztype = ZOMBIES[e.ztype] ? e.ztype : 'walker';
    const def = ZOMBIES[ztype];
    const zid = e.id | 0;
    const r = def.radius;
    const a = e.angle || 0;
    if (e.ztype === 'bloater') {
      // bursts: the explosion event draws the gore; leave only a green-stained pool
      decals.stamp(bloodSplats('green')[(R() * 6) | 0], e.x, e.y, R() * TAU, r * 4, 0.9);
      return;
    }
    if (e.gib) {
      zParticles(P_GIB, C_FLESH, e.x, e.y, 0, TAU, heavy() ? 7 + (r / 6 | 0) : 4, 260, 260, 2.8 * (r / 14), 4);
      zParticles(P_GIB, C_BONE, e.x, e.y, 0, TAU, heavy() ? 3 : 1, 220, 240, 2, 4);
      blood(e.x, e.y, 0, TAU, heavy() ? 16 : 6, 240, true);
      const spr = bloodSplats('red');
      decals.stamp(spr[(R() * spr.length) | 0], e.x, e.y, R() * TAU, r * 5, 0.95);
      return;
    }
    // corpse stays crisp for a while, lying roughly along the killing blow
    const variant = zid % def.look.clothes.length;
    const img = zsprites.corpse(ztype, variant);
    const size = img.width / zsprites.spriteScale;
    const fall = a + (hash01(zid) - 0.5) * 0.8;
    decals.stamp(bloodSplats('red')[(zid * 7) % 6], e.x - Math.cos(fall) * r * 0.2, e.y - Math.sin(fall) * r * 0.2, R() * TAU, r * 3.4, 0.85);
    decals.addCorpse(img, e.x, e.y, fall, size, env.time);
    blood(e.x, e.y, a + Math.PI, 1.6, heavy() ? 6 : 2, 120);
    if (e.by && e.by === env.localId) killMarker = 1;
  }

  // ---- continuous emitters (called by the renderer while it walks entities) -------------------
  let acc = 0;
  function rate(perSec, dt) {
    // Ambient emitters back off when the pool is mostly full so event effects (blood,
    // explosions) always find room.
    if (n > cap * 0.75) return 0;
    // Poisson-ish: whole particles plus a random chance for the fraction
    acc = perSec * dt;
    let k = Math.floor(acc);
    if (R() < acc - k) k++;
    return k;
  }

  const api = {
    get count() { return n; },
    get hitMarker() { return hitMarker; },
    get killMarker() { return killMarker; },
    get damagePulse() { return damagePulse; },
    get bloom() { return bloom; },
    lights,
    setQuality(q, newCap) { quality = q; cap = Math.min(MAXP, newCap); if (n > cap) n = cap; },
    setDecals(d) { decals = d; },
    setZombieSprites(z) { zsprites = z; },

    addEvents(events, env) {
      tracerBudget = heavy() ? 90 : 30;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!e || typeof e.type !== 'string') continue;
        try {
          handle(e, env);
        } catch (err) {
          // a malformed event must never take the frame down
          if (typeof console !== 'undefined') console.warn('render: bad event', e.type, err);
        }
      }
    },

    /** Acid glob burst where a spitter pool appears. */
    splash(x, y, r) {
      zParticles(P_ACID, C_ACID, x, y, 0, TAU, heavy() ? 14 : 6, r * 3, 120, 1.8, 0.8);
      ring(x, y, 4, r * 0.9, 0.3, '#b8ff5a', 2.5, 0.7);
      addLight(x, y, r * 2.2, 0.6, '#9dff4a', 0.3);
    },

    emitRocketTrail(p, dt) {
      const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      const bx = p.x - ca * 12, by = p.y - sa * 12;
      for (let k = rate(heavy() ? 70 : 25, dt); k > 0; k--) {
        const i = spawn(P_SMOKE, bx + (R() - 0.5) * 4, by + (R() - 0.5) * 4, -ca * 30 + (R() - 0.5) * 20, -sa * 30 + (R() - 0.5) * 20, 1.2 + R() * 0.8, 6);
        if (i >= 0) { GROW[i] = 22; ALPHA[i] = 0.5; DRAG[i] = 1.5; }
      }
      for (let k = rate(40, dt); k > 0; k--) {
        const i = spawn(P_FIRE, bx, by, -ca * 120 + (R() - 0.5) * 40, -sa * 120 + (R() - 0.5) * 40, 0.12, 7);
        if (i >= 0) GROW[i] = -20;
      }
    },
    emitSmokeTrail(p, dt, perSec, size, alpha) {
      for (let k = rate(heavy() ? perSec : perSec / 3, dt); k > 0; k--) {
        const i = spawn(P_SMOKE, p.x, p.y, (R() - 0.5) * 16, (R() - 0.5) * 16, 0.7, size);
        if (i >= 0) { GROW[i] = size * 1.5; ALPHA[i] = alpha; DRAG[i] = 2; }
      }
    },
    emitAcidTrail(p, dt) {
      for (let k = rate(heavy() ? 30 : 10, dt); k > 0; k--) {
        const i = spawn(P_ACID, p.x, p.y, (R() - 0.5) * 30, (R() - 0.5) * 30, 0.8, 1.4);
        if (i >= 0) { Z[i] = 6; VZ[i] = 10; COL[i] = C_ACID; }
      }
    },
    /** Flames licking up from a burning thing of radius r. */
    emitBurning(x, y, r, dt, intensity = 1) {
      for (let k = rate((heavy() ? 26 : 10) * intensity * (r / 14), dt); k > 0; k--) {
        const i = spawn(P_FIRE, x + (R() - 0.5) * r * 1.3, y + (R() - 0.5) * r * 1.3, (R() - 0.5) * 20, -30 - R() * 40, 0.3 + R() * 0.3, r * 0.5 + 4);
        if (i >= 0) { GROW[i] = -r * 0.6; DRAG[i] = 1; }
      }
      if (heavy()) {
        for (let k = rate(3 * intensity, dt); k > 0; k--) embers(x, y, 1, 60, r);
        for (let k = rate(2.5 * intensity * (r / 14), dt); k > 0; k--) smoke(x, y - r * 0.5, 1, r * 0.8 + 6, 1.6, 0.45, r, 30);
      }
    },
    emitDust(x, y, dt, perSec, size) {
      for (let k = rate(perSec, dt); k > 0; k--) dust(x, y, 1, size, 40, 0.8);
    },
    emitSmokeColumn(x, y, dt, perSec, size, dark) {
      for (let k = rate(heavy() ? perSec : perSec / 3, dt); k > 0; k--) {
        const i = spawn(P_SMOKE, x + (R() - 0.5) * 20, y + (R() - 0.5) * 20, 10 + (R() - 0.5) * 16, -20 - R() * 20, 2.5 + R(), size);
        if (i >= 0) { GROW[i] = size * 1.4; ALPHA[i] = dark; DRAG[i] = 0.3; }
      }
    },
    emitEmbers(x, y, dt, perSec, spread) {
      for (let k = rate(heavy() ? perSec : perSec / 3, dt); k > 0; k--) embers(x, y, 1, 70, spread);
    },

    update(dt, time) {
      hitMarker = Math.max(0, hitMarker - dt * 6);
      killMarker = Math.max(0, killMarker - dt * 3);
      damagePulse = Math.max(0, damagePulse - dt * 1.4);
      bloom = Math.max(0, bloom - dt * 3);
      // particles
      for (let i = n - 1; i >= 0; i--) {
        LIFE[i] -= dt;
        if (LIFE[i] <= 0) { kill(i); continue; }
        const t = TYPE[i];
        const d = DRAG[i];
        if (d) {
          const f = Math.max(0, 1 - d * dt);
          VX[i] *= f; VY[i] *= f;
        }
        X[i] += VX[i] * dt;
        Y[i] += VY[i] * dt;
        ROT[i] += VR[i] * dt;
        SIZE[i] = Math.max(0.2, SIZE[i] + GROW[i] * dt);
        if (HAS_Z[t] && !REST[i]) {
          VZ[i] -= GRAV * dt;
          Z[i] += VZ[i] * dt;
          if (Z[i] <= 0) {
            Z[i] = 0;
            if (t === P_BLOOD || t === P_ACID) {
              const spr = bloodSplats(t === P_ACID ? 'green' : 'red');
              decals.stamp(spr[(i + (time * 10 | 0)) % spr.length], X[i], Y[i], ROT[i], SIZE[i] * 5, 0.7);
              kill(i);
              continue;
            }
            if (t === P_GIB) {
              decals.stamp(bloodSplats('red')[i % 6], X[i], Y[i], ROT[i], SIZE[i] * 7, 0.6);
            }
            if (VZ[i] < -60 && t !== P_GIB) {
              VZ[i] = -VZ[i] * 0.35;
              VX[i] *= 0.5; VY[i] *= 0.5; VR[i] *= 0.5;
            } else {
              REST[i] = 1;
              VX[i] = VY[i] = VR[i] = 0;
            }
          }
        }
      }
      // records
      for (let i = tracers.length - 1; i >= 0; i--) { const o = tracers[i]; o.age += dt; if (o.age >= o.max) recycle(tracers, i); }
      for (const list of TIMED) {
        for (let i = list.length - 1; i >= 0; i--) { const o = list[i]; o.life -= dt; if (o.life <= 0) recycle(list, i); }
      }
      for (let i = emitters.length - 1; i >= 0; i--) {
        const em = emitters[i];
        em.life -= dt;
        if (em.life <= 0) { recycle(emitters, i); continue; }
        if (em.kind === 'flare') {
          for (let k = rate(heavy() ? 22 : 8, dt); k > 0; k--) {
            const j = spawn(P_SMOKE, em.x, em.y, 20 + (R() - 0.5) * 20, -30 - R() * 20, 2.5, 8);
            if (j >= 0) { GROW[j] = 22; ALPHA[j] = -0.9; DRAG[j] = 0.4; COL[j] = 1; }
          }
          addLight(em.x, em.y, 200, 0.5 + R() * 0.3, '#ff4a2a', 0.05);
        }
      }
    },

    /**
     * Non-emissive particles (drawn before the darkness). `k` = {k, tx, ty} world→device.
     */
    drawNormal(ctx, k, view) {
      const puff = smokePuff();
      const dustSpr = tinted(puff, '#8a7a5a');
      const darkSmoke = tinted(puff, '#1c1c1c');
      const lightSmoke = tinted(puff, '#8a8a88');
      const bloodMist = tinted(puff, '#7a0a0a');
      const redSmoke = tinted(puff, '#d8402a');
      const kk = k.k;
      for (let i = 0; i < n; i++) {
        const t = TYPE[i];
        if (ADDITIVE[t]) continue;
        const x = X[i], y = Y[i] - Z[i] * 0.5;
        const s = SIZE[i];
        if (x + s * 3 < view.x0 || x - s * 3 > view.x1 || y + s * 3 < view.y0 || y - s * 3 > view.y1) continue;
        const lf = LIFE[i] / MAX[i];
        if (t === P_SMOKE || t === P_DUST) {
          let spr, a = ALPHA[i];
          if (t === P_DUST) spr = dustSpr;
          else if (a < 0) { spr = COL[i] === 1 ? redSmoke : bloodMist; a = -a; }
          else spr = a > 0.6 ? darkSmoke : lightSmoke;
          // fade in quickly, out slowly
          const al = a * Math.min(1, (1 - lf) * 8) * lf;
          if (al < 0.01) continue;
          ctx.globalAlpha = al;
          const c = Math.cos(ROT[i]) * kk, sn = Math.sin(ROT[i]) * kk;
          ctx.setTransform(c, sn, -sn, c, k.tx + x * kk, k.ty + y * kk);
          ctx.drawImage(spr, -s, -s, s * 2, s * 2);
          continue;
        }
        // solid bits
        const fade = t === P_BLOOD || t === P_ACID ? 1 : Math.min(1, LIFE[i] * 2);
        ctx.globalAlpha = fade;
        const sc = 1 + Z[i] * 0.004;
        const c = Math.cos(ROT[i]) * kk * sc, sn = Math.sin(ROT[i]) * kk * sc;
        ctx.setTransform(c, sn, -sn, c, k.tx + x * kk, k.ty + y * kk);
        ctx.fillStyle = PAL[COL[i]];
        switch (t) {
          case P_BLOOD:
            ctx.drawImage(dropSprite(), -s * 1.3, -s * 1.3, s * 2.6, s * 2.6);
            break;
          case P_ACID:
            ctx.beginPath();
            ctx.arc(0, 0, s, 0, TAU);
            ctx.fill();
            break;
          case P_CASING:
            ctx.fillRect(-s * 1.4, -s * 0.5, s * 2.8, s);
            break;
          case P_MAG:
            ctx.fillRect(-s * 2, -s, s * 4, s * 2);
            break;
          case P_GIB:
            if (COL[i] === C_BONE) ctx.fillRect(-s * 1.4, -s * 0.35, s * 2.8, s * 0.7);
            else ctx.drawImage(gibSprites()[i % 3], -s * 1.5, -s * 1.5, s * 3, s * 3);
            break;
          case P_GLASS:
            ctx.fillStyle = 'rgba(190,220,235,0.8)';
            ctx.fillRect(-s * 0.7, -s * 0.4, s * 1.4, s * 0.8);
            break;
          default:
            ctx.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
        }
      }
      ctx.globalAlpha = 1;
    },

    /** Emissive stuff drawn after the darkness overlay with additive blending. */
    drawEmissive(ctx, k, view, time) {
      const kk = k.k;
      const core = coreSprite();
      const f0 = fireSprite(0), f1 = fireSprite(1), f2 = fireSprite(2);
      const zap = fireSprite(4);
      ctx.globalCompositeOperation = 'lighter';
      // particles
      for (let i = 0; i < n; i++) {
        const t = TYPE[i];
        if (!ADDITIVE[t]) continue;
        const x = X[i], y = Y[i];
        const s = SIZE[i];
        if (x + 60 < view.x0 || x - 60 > view.x1 || y + 60 < view.y0 || y - 60 > view.y1) continue;
        const lf = LIFE[i] / MAX[i];
        if (t === P_FIRE) {
          // white-hot only for a moment, then orange, then dull red as it cools
          const spr = lf > 0.85 ? f0 : lf > 0.4 ? f1 : f2;
          ctx.globalAlpha = Math.min(1, lf * 1.6) * ALPHA[i];
          ctx.setTransform(kk, 0, 0, kk, k.tx + x * kk, k.ty + y * kk);
          ctx.drawImage(spr, -s, -s, s * 2, s * 2);
        } else if (t === P_SPARK || t === P_ZAP) {
          const vx = VX[i], vy = VY[i];
          const sp = Math.hypot(vx, vy);
          const len = Math.max(3, sp * 0.03);
          const c = (vx / (sp || 1)) * kk, sn = (vy / (sp || 1)) * kk;
          ctx.globalAlpha = lf;
          ctx.setTransform(c, sn, -sn, c, k.tx + x * kk, k.ty + y * kk);
          ctx.drawImage(t === P_ZAP ? zap : f0, -len, -s * 1.5, len * 2, s * 3);
        } else if (t === P_EMBER) {
          ctx.globalAlpha = lf * (0.6 + 0.4 * Math.sin(time * 20 + i));
          ctx.setTransform(kk, 0, 0, kk, k.tx + x * kk, k.ty + y * kk);
          ctx.drawImage(f1, -s * 2, -s * 2, s * 4, s * 4);
        } else if (t === P_SPARKLE) {
          ctx.globalAlpha = lf;
          ctx.setTransform(kk, 0, 0, kk, k.tx + x * kk, k.ty + y * kk);
          const col = sparkleColors[COL[i]] || '#ffffff';
          ctx.drawImage(tinted(core, col), -s * 2, -s * 2, s * 4, s * 4);
          ctx.drawImage(core, -s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(kk, 0, 0, kk, k.tx, k.ty);

      // muzzle flashes
      for (const o of flashes) {
        const lf = o.life / o.max;
        if (o.x + 80 < view.x0 || o.x - 80 > view.x1 || o.y + 80 < view.y0 || o.y - 80 > view.y1) continue;
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.angle);
        ctx.globalAlpha = lf;
        const s = o.size;
        if (o.kind === 2) {
          ctx.drawImage(f1, -s, -s, s * 2, s * 2);
          ctx.drawImage(core, -s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
        } else if (o.kind === 3) {
          ctx.drawImage(zap, -s, -s, s * 2, s * 2);
        } else {
          // star-shaped flash: a long forward flare and two side prongs
          ctx.drawImage(f0, -s * 0.2, -s * 0.28, s * 1.6, s * 0.56);
          ctx.drawImage(f1, -s * 0.4, -s * 0.5, s * 0.9, s);
          ctx.rotate(0.9 + o.seed * 0.3);
          ctx.drawImage(f0, 0, -s * 0.1, s * 0.7, s * 0.2);
          ctx.rotate(-1.8 - o.seed * 0.6);
          ctx.drawImage(f0, 0, -s * 0.1, s * 0.7, s * 0.2);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      // tracers: a bright head streak travelling to the impact plus a fading full line
      ctx.lineCap = 'round';
      for (const o of tracers) {
        const head = Math.min(1, o.age / o.travel);
        const tailLen = Math.min(1, 260 / (o.len || 1));
        const tail = Math.max(0, head - tailLen);
        const fade = o.age > o.travel ? 1 - (o.age - o.travel) / (o.max - o.travel) : 1;
        const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
        ctx.strokeStyle = o.color;
        ctx.globalAlpha = 0.14 * fade;
        ctx.lineWidth = o.w * 0.6;
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x1 + dx * head, o.y1 + dy * head);
        ctx.stroke();
        ctx.globalAlpha = 0.85 * fade;
        ctx.lineWidth = o.w;
        ctx.beginPath();
        ctx.moveTo(o.x1 + dx * tail, o.y1 + dy * tail);
        ctx.lineTo(o.x1 + dx * head, o.y1 + dy * head);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // rail beams: core line + spiral wobble
      for (const b of beams) {
        const lf = b.life / b.max;
        const dx = b.x2 - b.x1, dy = b.y2 - b.y1, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.globalAlpha = lf;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 9 * lf + 2;
        ctx.globalAlpha = 0.35 * lf;
        ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
        ctx.globalAlpha = lf;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#f4ecff';
        ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const steps = Math.min(200, Math.ceil(len / 8));
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const w = Math.sin(u * len / 18 + b.seed + (1 - lf) * 8) * 7 * lf;
          const px = b.x1 + dx * u + nx * w, py = b.y1 + dy * u + ny * w;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // tesla arcs: re-jittered every frame so they crackle
      for (const o of arcs) {
        const lf = o.life / o.max;
        const pts = o.pts;
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#e8f8ff' : '#6fd0ff';
          ctx.lineWidth = pass ? 1.4 : 4;
          ctx.globalAlpha = (pass ? 1 : 0.45) * lf;
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let j = 2; j < pts.length; j += 2) {
            const x0 = pts[j - 2], y0 = pts[j - 1], x1 = pts[j], y1 = pts[j + 1];
            const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len;
            const segs = Math.max(3, Math.min(14, Math.round(len / 18)));
            for (let s = 1; s < segs; s++) {
              const u = s / segs;
              const off = (R() - 0.5) * Math.min(26, len * 0.25);
              ctx.lineTo(x0 + dx * u + nx * off, y0 + dy * u + ny * off);
            }
            ctx.lineTo(x1, y1);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // shockwave rings
      for (const o of rings) {
        const u = 1 - o.life / o.max;
        const e = 1 - (1 - u) * (1 - u);
        const r = o.r0 + (o.r1 - o.r0) * e;
        ctx.globalAlpha = (1 - u) * o.a;
        ctx.strokeStyle = o.color;
        ctx.lineWidth = o.w * (1 - u * 0.6);
        ctx.beginPath();
        ctx.arc(o.x, o.y, r, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // melee swooshes & zombie claws
      for (const o of swipes) {
        const u = 1 - o.life / o.max;
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.angle);
        if (o.kind === 0) {
          ctx.globalAlpha = (1 - u) * 0.8;
          ctx.strokeStyle = '#fff4dc';
          ctx.lineWidth = 5 * (1 - u) + 1;
          ctx.beginPath();
          ctx.arc(0, 0, 48, -0.75 + u * 0.3, -0.75 + 0.3 + u * 1.5);
          ctx.stroke();
        } else {
          ctx.globalAlpha = (1 - u) * 0.7;
          ctx.strokeStyle = '#ff5040';
          ctx.lineWidth = 1.6;
          const r = o.r;
          for (let j = -1; j <= 1; j++) {
            ctx.beginPath();
            ctx.moveTo(r * 0.4, j * r * 0.35 - r * 0.5 + u * r);
            ctx.lineTo(r * 1.1, j * r * 0.35 + r * 0.3 + u * r * 0.6);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    clear() {
      n = 0;
      for (const list of [tracers, beams, arcs, rings, flashes, lights, swipes, emitters]) {
        while (list.length) recycle(list, list.length - 1);
      }
    },
  };
  return api;
}

