// Highway Horde renderer (SPEC §7.1). Canvas 2D, all art procedural.
//
// Frame order: ground chunks → water shimmer → decals → corpses → hazards → supply,
// pickups, obstacles, objective → barricades, bodies, zombies, turrets, survivors →
// projectiles & particles → canopies/lamps → darkness (lighting) → emissive pass
// (additive: flames, flashes, tracers, eyes, glows) → screen overlays.

import { PLAYER_COLORS, PLAYER_SPEED, BARRICADE, JUMP_HEIGHT } from '../shared/constants.js';
import { ZOMBIES, ZOMBIE_IDS, ZFLAG } from '../shared/zombies.js';
import { WEAPONS } from '../shared/weapons.js';
import { clamp } from '../shared/math.js';
import { makeCanvas, releaseCanvas, mix, rgba, hash01, fillCircle, fillEllipse } from './util.js';
import { tintedGlow, fireSprite } from './textures.js';
import { prepareMap, paintGround, createGroundLayer, createOverheadLayer, createWaterLayer } from './maplayer.js';
import {
  drawObstacle, obstaclePad, drawObjectiveBase, drawObjectiveLive, objectivePad, drawSupplyBase, drawSupplyFlag,
} from './obstacles.js';
import {
  createZombieSprites, zombieAnimRate, ZFRAMES, drawSurvivor, drawDownedSurvivor, drawDeadSurvivor, drawTurret,
  drawBarricade, drawPickup, PICKUP_GLOW, drawAcidPuddle, drawFireBase, drawFlareBase, drawProjectileBody, muzzleOffset,
} from './actors.js';
import { createEffects } from './effects.js';
import { createDecals } from './decals.js';
import { createCamera, zoomFor } from './camera.js';
import { createLighting, nightFor } from './lighting.js';
import { createOverlay } from './overlay.js';
import { renderClassPortrait as portrait } from './portrait.js';

const TAU = Math.PI * 2;

const QUALITY = {
  high: {
    dprCap: 1.5, particles: 2600, groundBudget: 12e6, groundMax: 1.25, decalScale: 1, decalChunks: 36,
    corpses: 160, corpseLife: 30, spriteMax: 2.5,
  },
  low: {
    dprCap: 1, particles: 700, groundBudget: 5e6, groundMax: 0.75, decalScale: 0.5, decalChunks: 24,
    corpses: 50, corpseLife: 12, spriteMax: 1.5,
  },
};

const DEFAULT_SETTINGS = { screenShake: true, showNames: true, lighting: true };
const EMPTY = [];
const NO_VIEW = { players: EMPTY, turrets: EMPTY, hazards: EMPTY, zombies: EMPTY, projectiles: EMPTY, pickups: EMPTY, barricades: EMPTY };

/** Frost-tinted copy of a zombie sprite frame (cached per frame canvas). */
const iceCache = new WeakMap();
function iceSprite(spr) {
  let c = iceCache.get(spr);
  if (!c) {
    c = makeCanvas(spr.width, spr.height);
    const g = c.getContext('2d');
    g.drawImage(spr, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(196,232,255,0.78)';
    g.fillRect(0, 0, c.width, c.height);
    iceCache.set(spr, c);
  }
  return c;
}

// Per zombie type tables so the hot loop never touches strings.
const ZT = ZOMBIE_IDS.map((id) => {
  const def = ZOMBIES[id];
  const r = def.radius;
  // head centre / radius relative to the body, matching drawZombieShape
  const head = {
    walker: [0.12, 0.36], runner: [0.42, 0.37], crawler: [0.78, 0.38], bloater: [0.72, 0.26],
    spitter: [0.55, 0.35], screamer: [0.32, 0.38], brute: [0.22, 0.26], boss: [0.3, 0.22],
  }[id] || [0.12, 0.36];
  return {
    id, def, r, variants: def.look.clothes.length, anim: zombieAnimRate(id),
    headX: head[0] * r, headR: head[1] * r,
    big: id === 'brute' || id === 'boss', low: id === 'crawler',
  };
});
const BOSS_SLAM_R = (ZOMBIES.boss && ZOMBIES.boss.special && ZOMBIES.boss.special.radius) || 190;
const ZT_INDEX = {};
ZOMBIE_IDS.forEach((id, i) => { ZT_INDEX[id] = i; });

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const VIEW_LISTS = ['players', 'zombies', 'projectiles', 'pickups', 'turrets', 'barricades', 'hazards'];
/** Fill in any missing entity list so the passes can iterate blindly. */
function normalizeView(view) {
  if (!view) return null;
  for (let i = 0; i < VIEW_LISTS.length; i++) {
    if (!Array.isArray(view[VIEW_LISTS[i]])) {
      const v = { ...view };
      for (const k of VIEW_LISTS) if (!Array.isArray(v[k])) v[k] = EMPTY;
      return v;
    }
  }
  return view;
}

/**
 * Create the game renderer bound to a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{map: object, quality?: 'high'|'low'}} options
 */
export function createRenderer(canvas, { map, quality = 'high' } = {}) {
  if (!map) throw new Error('createRenderer: map is required');
  const ctx = canvas.getContext('2d', { alpha: false });
  let q = quality === 'low' ? 'low' : 'high';
  let Q = QUALITY[q];
  const seed = map.seed | 0;
  const prep = prepareMap(map);
  let ground = createGroundLayer(prep, Q.groundBudget, Q.groundMax);
  const overhead = createOverheadLayer(map);
  const water = createWaterLayer(prep);
  let decals = createDecals(map.width, map.height, {
    scale: Q.decalScale, maxChunks: Q.decalChunks, maxCorpses: Q.corpses, corpseLife: Q.corpseLife,
  });
  let spriteScale = 2;
  let zs = createZombieSprites(spriteScale);
  const zframeTable = new Array(ZT.length * 8).fill(null);
  const effects = createEffects({ cap: Q.particles, quality: q, decals, zsprites: zs });
  const camera = createCamera(map);
  const lighting = createLighting();
  const amb0 = map.ambient || { darkness: 0.6, tint: '#223344' };
  const night = nightFor(amb0.tint || '#223344', amb0.darkness ?? 0.6);
  let lowTint = null, lowTintKey = 0;
  const overlay = createOverlay();

  // obstacle sprites (lazy)
  const obSprites = new Array(map.obstacles.length).fill(null);
  let obBuildCursor = 0;
  let objectiveSprite = null, supplySprite = null;

  // viewport state
  let cssW = 1, cssH = 1, dpr = 1, W = 1, H = 1, zoom = 1;
  const K = { k: 1, tx: 0, ty: 0 };       // world → device (with shake)
  const K0 = { k: 1, tx: 0, ty: 0 };      // without shake (for input conversion)
  const viewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let time = 0;
  let frameNo = 0;
  let destroyed = false;
  let spectateId = 0;
  let lastLocalId = 0;
  let lastView = null;
  let roster = EMPTY;
  const tmpPt = { x: 0, y: 0 };
  // section timings (ms, exponentially smoothed) for the sandbox profiler
  const timings = { ground: 0, statics: 0, actors: 0, particles: 0, lighting: 0, emissive: 0, overlay: 0, total: 0 };
  const hasPerf = typeof performance !== 'undefined';
  let tMark = 0;
  function mark(key) {
    if (!hasPerf) return;
    const t = performance.now();
    if (key) timings[key] += (t - tMark - timings[key]) * 0.1;
    tMark = t;
  }

  // per-player animation state
  const anim = new Map();
  // per-zombie hit tracking (ids are uint16)
  const zLastHp = new Float32Array(65536).fill(-1);
  const zHitAt = new Float32Array(65536).fill(-100);
  const zType = new Uint8Array(65536);
  const hazardSeen = new Int32Array(65536).fill(-10);
  // scratch lists for the frame
  const visZ = new Int32Array(4096);
  let visCount = 0;
  const bars = { count: 0, idx: new Int32Array(512), r: new Float32Array(512), alpha: new Float32Array(512), elite: new Uint8Array(512) };

  function rosterInfo(id) {
    for (let i = 0; i < roster.length; i++) {
      const r = roster[i];
      if (r.id === id) {
        const ci = Number.isInteger(r.color) ? r.color : (id - 1) % 6;
        return { name: r.name || 'Player', color: PLAYER_COLORS[((ci % 6) + 6) % 6], cls: r.cls || 'soldier' };
      }
    }
    return { name: 'Player ' + id, color: PLAYER_COLORS[((id - 1) % 6 + 6) % 6], cls: 'soldier' };
  }
  // info objects are cached per id to avoid per-frame allocation in overlays
  const infoCache = new Map();
  let infoRoster = null;
  function info(id) {
    if (infoRoster !== roster) { infoCache.clear(); infoRoster = roster; }
    let v = infoCache.get(id);
    if (!v) { v = rosterInfo(id); infoCache.set(id, v); }
    return v;
  }

  function findPlayer(id) {
    const v = lastView;
    if (!v || !v.players) return null;
    for (let i = 0; i < v.players.length; i++) if (v.players[i].id === id) return v.players[i];
    return null;
  }

  const env = {
    localId: 0,
    time: 0,
    player: findPlayer,
    dist: (x, y) => Math.hypot(x - camera.x, y - camera.y),
    shake: (a) => camera.addTrauma(a),
  };

  // ---- sizing ------------------------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
    cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));
    const raw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    dpr = Math.min(raw, Q.dprCap);
    W = Math.max(1, Math.round(cssW * dpr));
    H = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    zoom = zoomFor(cssW, cssH);
    lighting.resize(cssW, cssH, W);
    // sprite resolution follows the on-screen scale (in half steps) so zombies stay crisp
    const want = clamp(Math.ceil(zoom * dpr * 2) / 2, 1, Q.spriteMax);
    if (want !== spriteScale) {
      spriteScale = want;
      // old frames are left to the GC rather than released: live corpses still use them
      zs = createZombieSprites(spriteScale);
      zframeTable.fill(null);
      effects.setZombieSprites(zs);
      for (let i = 0; i < obSprites.length; i++) { releaseCanvas(obSprites[i] && obSprites[i].c); obSprites[i] = null; }
      releaseCanvas(objectiveSprite && objectiveSprite.c);
      releaseCanvas(supplySprite && supplySprite.c);
      objectiveSprite = supplySprite = null;
      obBuildCursor = 0;
      zs.prewarm(['walker', 'runner']);
    }
  }

  function frames(ti, variant) {
    const key = ti * 8 + variant;
    let f = zframeTable[key];
    if (!f) { f = zs.frames(ZT[ti].id, variant); zframeTable[key] = f; }
    return f;
  }

  function buildObSprite(i) {
    const o = map.obstacles[i];
    const pad = obstaclePad(o);
    const w = (o.w + pad * 2) * spriteScale, h = (o.h + pad * 2) * spriteScale;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.setTransform(spriteScale, 0, 0, spriteScale, c.width / 2, c.height / 2);
    drawObstacle(g, o, seed);
    obSprites[i] = { c, hw: c.width / 2, hh: c.height / 2 };
    return obSprites[i];
  }

  function buildObjectiveSprite() {
    const ob = map.objective;
    const pad = objectivePad(ob);
    const c = makeCanvas((ob.w + pad * 2) * spriteScale, (ob.h + pad * 2) * spriteScale);
    const g = c.getContext('2d');
    g.setTransform(spriteScale, 0, 0, spriteScale, c.width / 2, c.height / 2);
    drawObjectiveBase(g, ob, seed);
    objectiveSprite = { c, hw: c.width / 2, hh: c.height / 2 };
  }

  function buildSupplySprite() {
    const c = makeCanvas(130 * spriteScale, 100 * spriteScale);
    const g = c.getContext('2d');
    g.setTransform(spriteScale, 0, 0, spriteScale, c.width / 2, c.height / 2);
    drawSupplyBase(g);
    supplySprite = { c, hw: c.width / 2, hh: c.height / 2 };
  }

  /** Draw a cached sprite centred at world (x, y), rotated by a. */
  function blit(spr, x, y, a) {
    const s = K.k / spriteScale;
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    ctx.setTransform(c, sn, -sn, c, K.tx + x * K.k, K.ty + y * K.k);
    ctx.drawImage(spr.c, -spr.hw, -spr.hh);
  }

  function setWorld() {
    ctx.setTransform(K.k, 0, 0, K.k, K.tx, K.ty);
  }

  function inView(x, y, m) {
    return x + m > viewRect.x0 && x - m < viewRect.x1 && y + m > viewRect.y0 && y - m < viewRect.y1;
  }

  // ---- per-frame state tracking ------------------------------------------------------------
  function trackPlayers(players, dt) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      let a = anim.get(p.id);
      if (!a) {
        a = { x: p.x, y: p.y, walk: 0, move: 0, recoil: 0, spin: 0, seen: 0 };
        anim.set(p.id, a);
      }
      const dx = p.x - a.x, dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      const speed = dt > 0 && d < 200 ? d / dt : 0;
      a.move += (Math.min(1, speed / PLAYER_SPEED) - a.move) * Math.min(1, dt * 12);
      a.walk += Math.min(d, 30) * 0.14;
      a.x = p.x; a.y = p.y;
      a.recoil = p.firing ? Math.min(1, a.recoil + dt * 30) : Math.max(0, a.recoil - dt * 10);
      // (a chainsaw's chain runs the same way: slow idle, fast while it cuts)
      const saw = p.slots && p.slots[p.slot] === 'chainsaw' ? (p.firing ? 1 : 0.15) : 0;
      a.spin += ((p.spin || 0) + saw) * dt * 40;
      a.seen = frameNo;
    }
    if (frameNo % 120 === 0) {
      for (const [id, a] of anim) if (frameNo - a.seen > 600) anim.delete(id);
    }
  }

  function trackZombies(zombies) {
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      const id = z.id & 0xffff;
      const ti = (ZT_INDEX[z.type] ?? 0) + 1;
      if (zType[id] !== ti || z.hp > zLastHp[id] + 0.001) {
        zType[id] = ti;
        zLastHp[id] = z.hp;
        zHitAt[id] = -100;
        continue;
      }
      if (z.hp < zLastHp[id] - 0.0005) zHitAt[id] = time;
      zLastHp[id] = z.hp;
    }
  }

  // ---- drawing passes -----------------------------------------------------------------------
  function drawZombies(view) {
    const zombies = view.zombies;
    const kS = K.k / spriteScale;
    visCount = 0;
    bars.count = 0;
    const vx0 = viewRect.x0, vy0 = viewRect.y0, vx1 = viewRect.x1, vy1 = viewRect.y1;
    // three passes: crawlers low on the ground, regular, then the big ones on top
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const ti = ZT_INDEX[z.type] ?? 0;
        const T = ZT[ti];
        const cat = T.low ? 0 : T.big ? 2 : 1;
        if (cat !== pass) continue;
        const m = T.r * 2.2;
        if (z.x + m < vx0 || z.x - m > vx1 || z.y + m < vy0 || z.y - m > vy1) continue;
        if (visCount < visZ.length) visZ[visCount++] = i;
        const id = z.id & 0xffff;
        const h = hash01(id);
        const fr = frames(ti, id % T.variants);
        const flags = z.flags | 0;
        // frozen solid: the walk cycle stops mid-stride
        let ph = flags & ZFLAG.FROZEN ? h : time * T.anim + h;
        if (flags & ZFLAG.BUFFED) ph += time * T.anim * 0.4;
        const frame = ((ph - Math.floor(ph)) * ZFRAMES) | 0;
        const spr = fr[frame];
        let off = 0;
        if (flags & ZFLAG.ATTACKING) off = Math.max(0, Math.sin(time * 13 + h * 20)) * T.r * 0.45;
        if (flags & ZFLAG.CHARGING) off += Math.sin(time * 40) * 1.2;
        const c = Math.cos(z.angle), s = Math.sin(z.angle);
        const x = z.x + c * off, y = z.y + s * off;
        ctx.setTransform(c * kS, s * kS, -s * kS, c * kS, K.tx + x * K.k, K.ty + y * K.k);
        const hw = spr.width / 2;
        ctx.drawImage(spr, -hw, -hw);
        if (flags & ZFLAG.SLOWED) {
          // frosted over (cryo): an icy wash over the sprite, near-white when frozen solid
          ctx.globalAlpha = flags & ZFLAG.FROZEN ? 0.9 : 0.45;
          ctx.drawImage(iceSprite(spr), -hw, -hw);
          ctx.globalAlpha = 1;
        }
        const since = time - zHitAt[id];
        if (since < 0.09) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.55 * (1 - since / 0.09);
          ctx.drawImage(spr, -hw, -hw);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        // hp bar bookkeeping for the overlay
        const elite = flags & ZFLAG.ELITE;
        if (z.hp < 0.999 && bars.count < bars.idx.length && (T.big || elite || since < 1.2)) {
          const b = bars.count++;
          bars.idx[b] = i;
          bars.r[b] = T.r;
          bars.elite[b] = elite ? 1 : 0;
          bars.alpha[b] = T.big || elite ? 1 : Math.min(0.85, (1.2 - since) * 3);
        }
      }
    }
  }

  function drawPlayers(view, bodiesOnly) {
    const players = view.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const isBody = p.state !== 'alive';
      if (isBody !== bodiesOnly) continue;
      if (!inView(p.x, p.y, 60)) continue;
      const inf = info(p.id);
      const a = anim.get(p.id);
      setWorld();
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.state === 'dead') {
        ctx.rotate(hash01(p.id) * TAU);
        ctx.globalAlpha = 0.85;
        drawDeadSurvivor(ctx, { cls: inf.cls, color: inf.color });
        ctx.globalAlpha = 1;
      } else {
        // selection ring on the ground
        ctx.strokeStyle = rgba(inf.color, p.state === 'downed' ? 0.5 : 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 21, 21, 0, 0, TAU);
        ctx.stroke();
        // jumping: the shadow slides away from the body and fades, the body grows a little
        const air = p.z > 0 ? Math.min(1, p.z / JUMP_HEIGHT) : 0;
        if (air > 0) {
          const sr = 15 * (1 - 0.3 * air);
          fillEllipse(ctx, 2 + air * 7, 3 + air * 10, sr, sr, `rgba(0,0,0,${(0.35 * (1 - 0.45 * air)).toFixed(3)})`);
        } else {
          fillEllipse(ctx, 2, 3, 15, 15, 'rgba(0,0,0,0.35)');
        }
        ctx.rotate(p.angle);
        if (air > 0) ctx.scale(1 + 0.16 * air, 1 + 0.16 * air);
        const wid = p.slots ? p.slots[p.slot] : null;
        if (p.state === 'downed') {
          const pistol = p.slots && p.slots[0] && WEAPONS[p.slots[0]] && WEAPONS[p.slots[0]].category === 'pistol' ? p.slots[0] : 'pistol';
          drawDownedSurvivor(ctx, { cls: inf.cls, color: inf.color, weapon: pistol });
        } else {
          const bob = 1 + Math.sin((a ? a.walk : 0) * 2) * 0.025 * (a ? a.move : 0);
          if (bob !== 1) ctx.scale(bob, bob);
          drawSurvivor(ctx, {
            cls: inf.cls, color: inf.color, weapon: wid,
            spin: a ? a.spin : 0, walk: a ? a.walk : 0, move: a ? a.move : 0,
            recoil: a ? a.recoil : 0, melee: p.meleeing || 0, reload: p.reloading || 0,
          });
        }
      }
      ctx.restore();
    }
  }

  function drawBloodPools(view) {
    // downed players bleed a slowly growing pool
    for (const p of view.players) {
      if (p.state !== 'downed' || !inView(p.x, p.y, 60)) continue;
      const grow = 1 - Math.max(0, p.bleedout) / 30;
      const r = 14 + grow * 18;
      const grad = ctx.createRadialGradient(p.x - 4, p.y + 2, 2, p.x - 4, p.y + 2, r);
      grad.addColorStop(0, 'rgba(90,6,6,0.85)');
      grad.addColorStop(0.8, 'rgba(70,4,4,0.6)');
      grad.addColorStop(1, 'rgba(60,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - 4 - r, p.y + 2 - r, r * 2, r * 2);
    }
  }

  function drawStatics(view, dt) {
    // supply station
    const sp = map.supply;
    if (sp && inView(sp.x, sp.y, 90)) {
      if (!supplySprite) buildSupplySprite();
      blit(supplySprite, sp.x, sp.y, 0);
      setWorld();
      ctx.save();
      ctx.translate(sp.x, sp.y);
      drawSupplyFlag(ctx, time);
      ctx.restore();
    }
    // obstacles (build a couple of off-screen sprites per frame in the background)
    const obs = map.obstacles;
    for (let n = 0; n < 2 && obBuildCursor < obs.length; obBuildCursor++) {
      if (!obSprites[obBuildCursor]) { buildObSprite(obBuildCursor); n++; }
    }
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const ext = (o.w > o.h ? o.w : o.h) * 0.75 + 12;
      if (!inView(o.x, o.y, ext)) continue;
      const spr = obSprites[i] || buildObSprite(i);
      blit(spr, o.x, o.y, o.a || 0);
    }
    // objective
    const ob = map.objective;
    if (ob && inView(ob.x, ob.y, Math.max(ob.w, ob.h) + 80)) {
      if (!objectiveSprite) buildObjectiveSprite();
      blit(objectiveSprite, ob.x, ob.y, ob.a || 0);
      setWorld();
      ctx.save();
      ctx.translate(ob.x, ob.y);
      ctx.rotate(ob.a || 0);
      drawObjectiveLive(ctx, ob, time);
      ctx.restore();
    }
    // damaged objective smokes, then burns
    if (ob && view && view.objective && view.objective.maxHp) {
      const hpf = view.objective.hp / view.objective.maxHp;
      if (hpf < 0.6) effects.emitSmokeColumn(ob.x - ob.w * 0.15, ob.y, dt, 2 + (0.6 - hpf) * 12, 16, 0.7);
      if (hpf < 0.3) effects.emitBurning(ob.x + ob.w * 0.2, ob.y - 4, 16, dt, 0.7);
    }
  }

  function drawPickupsAndDeployables(view) {
    setWorld();
    // pickups bob and hover (icon), with a shadow that shrinks as they rise
    for (const pk of view.pickups) {
      if (!inView(pk.x, pk.y, 40)) continue;
      const bob = Math.sin(time * 3 + pk.id * 1.3) * 2.5;
      fillEllipse(ctx, pk.x + 2, pk.y + 4, 10 - bob * 0.5, 5 - bob * 0.25, 'rgba(0,0,0,0.4)');
      ctx.save();
      ctx.translate(pk.x, pk.y - 3 + bob);
      if (pk.kind !== 'crate') ctx.rotate(Math.sin(time * 1.5 + pk.id) * 0.2);
      const w = WEAPONS[pk.weapon];
      drawPickup(ctx, pk.kind, w ? w.short : null);
      ctx.restore();
    }
    for (const b of view.barricades) {
      if (!inView(b.x, b.y, 70)) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      fillEllipse(ctx, 3, 5, BARRICADE.width / 2 + 2, BARRICADE.height / 2 + 3, 'rgba(0,0,0,0.35)');
      drawBarricade(ctx, BARRICADE.width, BARRICADE.height, b.hp, b.id);
      ctx.restore();
    }
  }

  function drawTurrets(view) {
    setWorld();
    for (const t of view.turrets) {
      if (!inView(t.x, t.y, 50)) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      fillEllipse(ctx, 3, 4, 20, 18, 'rgba(0,0,0,0.35)');
      drawTurret(ctx, t, info(t.owner).color, time);
      ctx.restore();
      // compact hp / ammo bars under the base
      const w = 30;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(t.x - w / 2 - 1, t.y + 23, w + 2, 6.5);
      ctx.fillStyle = t.hp > 0.5 ? '#6ee06e' : t.hp > 0.25 ? '#ffc040' : '#ff4a3a';
      ctx.fillRect(t.x - w / 2, t.y + 24, w * clamp(t.hp, 0, 1), 2);
      ctx.fillStyle = t.ammo > 0.2 ? '#ffd24a' : '#ff6a3a';
      ctx.fillRect(t.x - w / 2, t.y + 27, w * clamp(t.ammo, 0, 1), 1.5);
    }
  }

  function drawHazardBases(view) {
    setWorld();
    for (const h of view.hazards) {
      const hid = h.id & 0xffff;
      if (hazardSeen[hid] < frameNo - 2 && h.kind === 'acid' && frameNo > 2) effects.splash(h.x, h.y, h.r || 60);
      hazardSeen[hid] = frameNo;
      if (!inView(h.x, h.y, h.r + 20)) continue;
      if (h.kind === 'acid') drawAcidPuddle(ctx, h, time);
      else if (h.kind === 'flare') drawFlareBase(ctx, h);
      else drawFireBase(ctx, h);
    }
    for (const f of map.fires) {
      if (!inView(f.x, f.y, f.r * 2)) continue;
      drawFireBase(ctx, { x: f.x, y: f.y, r: f.r * 1.2, life: 1 });
    }
  }

  function drawProjectiles(view, dt) {
    setWorld();
    for (const p of view.projectiles) {
      if (p.kind === 'rocket') effects.emitRocketTrail(p, dt);
      else if (p.kind === 'grenade') effects.emitSmokeTrail(p, dt, 30, 5, 0.3);
      else if (p.kind === 'acid') effects.emitAcidTrail(p, dt);
      else if (p.kind === 'molotov') effects.emitBurning(p.x, p.y, 4, dt, 0.8);
      else if (p.kind === 'flare') effects.emitFlareTrail(p, dt);
      else if (p.kind === 'frost') effects.emitFrost(p, dt);
      if (p.kind === 'flame' || p.kind === 'frost' || !inView(p.x, p.y, 30)) continue;
      drawProjectileBody(ctx, p, time);
    }
  }

  // ---- emissive pass --------------------------------------------------------------------------
  function flames(x, y, r, id, life, intensity) {
    const f0 = fireSprite(0), f1 = fireSprite(1), f2 = fireSprite(2);
    const n = Math.max(3, Math.min(12, Math.round(r / 7)));
    const al = Math.min(1, life * 3) * intensity;
    ctx.globalAlpha = al * 0.5;
    ctx.drawImage(f2, x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    for (let i = 0; i < n; i++) {
      const hs = hash01(id * 31 + i * 7);
      const a = hs * TAU + i;
      const d = r * 0.6 * hash01(id * 17 + i * 3);
      const fl = 0.65 + 0.35 * Math.sin(time * (8 + hs * 6) + i * 1.9);
      const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d - fl * 3;
      const s = (r * 0.35 + 6) * fl;
      ctx.globalAlpha = al * 0.9;
      ctx.drawImage(f1, fx - s, fy - s * 1.2, s * 2, s * 2.2);
      ctx.globalAlpha = al * 0.8;
      ctx.drawImage(f0, fx - s * 0.45, fy - s * 0.6, s * 0.9, s * 1.1);
    }
    ctx.globalAlpha = 1;
  }

  function drawEmissive(view, lightingOn) {
    setWorld();
    ctx.globalCompositeOperation = 'lighter';
    // bloom around short, bright dynamic lights (flashes, explosions) only
    for (const L of effects.lights) {
      if (L.max > 0.6 || !inView(L.x, L.y, L.r)) continue;
      const lf = L.life / L.max;
      ctx.globalAlpha = Math.min(1, L.i * lf) * 0.3;
      const r = L.r * 0.4;
      ctx.drawImage(tintedGlow(L.color), L.x - r, L.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // map fires & fire hazards
    for (let i = 0; i < map.fires.length; i++) {
      const f = map.fires[i];
      if (!inView(f.x, f.y, f.r * 2)) continue;
      flames(f.x, f.y, f.r, 9000 + i, 1, 1);
    }
    for (const h of view.hazards) {
      if (h.kind !== 'fire' || !inView(h.x, h.y, h.r + 30)) continue;
      flames(h.x, h.y, h.r * 0.85, h.id, h.life, 0.95);
    }
    for (const h of view.hazards) {
      // burning road flare: a small hot flame and a wide red glow
      if (h.kind !== 'flare' || !inView(h.x, h.y, h.r * 3)) continue;
      const fade = Math.min(1, h.life * 6);
      const flick = 0.85 + 0.15 * Math.sin(time * 31 + h.id * 3);
      ctx.globalAlpha = 0.35 * fade * flick;
      ctx.drawImage(tintedGlow('#ff4a2a'), h.x - h.r * 2.4, h.y - h.r * 2.4, h.r * 4.8, h.r * 4.8);
      flames(h.x, h.y, h.r * 0.35, h.id, h.life, 1);
      ctx.globalAlpha = fade;
      ctx.drawImage(tintedGlow('#fff0e0'), h.x - 5, h.y - 5, 10, 10);
    }
    for (const h of view.hazards) {
      if (h.kind !== 'acid' || !inView(h.x, h.y, h.r)) continue;
      ctx.globalAlpha = 0.1 * Math.min(1, h.life * 3);
      ctx.drawImage(tintedGlow('#9dff4a'), h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
    }
    ctx.globalAlpha = 1;

    // zombies: burning flames, elite aura, eyes
    const zombies = view.zombies;
    const eyeGlow = tintedGlow('#ff7a3a');
    const eliteGlow = tintedGlow('#ff2a1a');
    const buffGlow = tintedGlow('#b070ff');
    for (let v = 0; v < visCount; v++) {
      const z = zombies[visZ[v]];
      const T = ZT[ZT_INDEX[z.type] ?? 0];
      const flags = z.flags | 0;
      const c = Math.cos(z.angle), s = Math.sin(z.angle);
      if (flags & ZFLAG.BURNING) flames(z.x, z.y, T.r * 0.9, z.id, 1, 0.9);
      if (flags & ZFLAG.FROZEN) {
        // frozen solid: a cold glint
        ctx.globalAlpha = 0.3 + 0.08 * Math.sin(time * 4 + z.id);
        ctx.drawImage(tintedGlow('#9ae8ff'), z.x - T.r * 1.5, z.y - T.r * 1.5, T.r * 3, T.r * 3);
      }
      if (flags & ZFLAG.BUFFED) {
        ctx.globalAlpha = 0.25 + 0.1 * Math.sin(time * 8 + z.id);
        ctx.drawImage(buffGlow, z.x - T.r * 1.6, z.y - T.r * 1.6, T.r * 3.2, T.r * 3.2);
      }
      const elite = flags & ZFLAG.ELITE;
      if (elite) {
        ctx.globalAlpha = 0.3 + 0.12 * Math.sin(time * 5 + z.id);
        ctx.drawImage(eliteGlow, z.x - T.r * 1.8, z.y - T.r * 1.8, T.r * 3.6, T.r * 3.6);
      }
      if (flags & ZFLAG.CHARGING) {
        if (T.id === 'boss') {
          // slam wind-up: telegraph the blast radius so players can get out
          const pulse = 0.5 + 0.5 * Math.sin(time * 18);
          ctx.globalAlpha = 0.35 + 0.35 * pulse;
          ctx.strokeStyle = '#ff4a2a';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(z.x, z.y, BOSS_SLAM_R, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 0.12 + 0.08 * pulse;
          ctx.drawImage(tintedGlow('#ff3a1a'), z.x - BOSS_SLAM_R, z.y - BOSS_SLAM_R, BOSS_SLAM_R * 2, BOSS_SLAM_R * 2);
        } else {
          // charging brute: speed lines streaming off its back
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = '#e8dcc0';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let k = -2; k <= 2; k++) {
            const px = z.x - c * T.r * 0.9 - s * k * T.r * 0.35, py = z.y - s * T.r * 0.9 + c * k * T.r * 0.35;
            const len = T.r * (1.2 + 0.5 * Math.abs(Math.sin(time * 20 + k)));
            ctx.moveTo(px, py);
            ctx.lineTo(px - c * len, py - s * len);
          }
          ctx.stroke();
        }
      }
      if (T.id === 'spitter' && lightingOn) {
        // acid sacs glow faintly in the dark
        ctx.globalAlpha = 0.45 + 0.15 * Math.sin(time * 3 + z.id);
        const sx = z.x + c * T.r * 0.3, sy = z.y + s * T.r * 0.3;
        const ox = -s * T.r * 0.3, oy = c * T.r * 0.3;
        const acid = tintedGlow('#9dff4a');
        ctx.drawImage(acid, sx + ox - 7, sy + oy - 7, 14, 14);
        ctx.drawImage(acid, sx - ox - 7, sy - oy - 7, 14, 14);
      }
      // eyes: two tiny glows at the front of the head — they sell the horde in the dark
      if (!lightingOn && !elite && T.id !== 'boss') continue;
      const hx = z.x + c * (T.headX + T.headR * 0.66), hy = z.y + s * (T.headX + T.headR * 0.66);
      const ox = -s * T.headR * 0.36, oy = c * T.headR * 0.36;
      const er = elite || T.big ? Math.max(4, T.headR * 0.55) : 3.2;
      ctx.globalAlpha = elite ? 1 : T.id === 'boss' ? 0.95 : 0.5;
      const spr = elite ? eliteGlow : T.id === 'boss' ? tintedGlow('#ffe23a') : eyeGlow;
      ctx.drawImage(spr, hx + ox - er, hy + oy - er, er * 2, er * 2);
      ctx.drawImage(spr, hx - ox - er, hy - oy - er, er * 2, er * 2);
    }
    ctx.globalAlpha = 1;

    // projectiles
    const f0 = fireSprite(0), f1 = fireSprite(1), f3 = fireSprite(3);
    for (const p of view.projectiles) {
      if (!inView(p.x, p.y, 40)) continue;
      switch (p.kind) {
        case 'flame': {
          const hs = hash01(p.id);
          const s = 10 + hs * 8 + Math.sin(time * 20 + p.id) * 2;
          ctx.globalAlpha = 0.75;
          ctx.drawImage(f1, p.x - s, p.y - s, s * 2, s * 2);
          ctx.globalAlpha = 0.6;
          ctx.drawImage(f0, p.x - s * 0.5, p.y - s * 0.5, s, s);
          break;
        }
        case 'rocket': {
          const bx = p.x - Math.cos(p.angle) * 12, by = p.y - Math.sin(p.angle) * 12;
          const s = 9 + Math.sin(time * 50) * 2;
          ctx.globalAlpha = 1;
          ctx.drawImage(f0, bx - s, by - s, s * 2, s * 2);
          ctx.globalAlpha = 0.5;
          ctx.drawImage(f1, bx - s * 2, by - s * 2, s * 4, s * 4);
          break;
        }
        case 'grenade': case 'frag': {
          const blink = Math.sin(time * (p.kind === 'frag' ? 14 : 8) + p.id) > 0.3 ? 1 : 0.2;
          ctx.globalAlpha = blink;
          ctx.drawImage(tintedGlow('#ff3030'), p.x - 6, p.y - 6, 12, 12);
          break;
        }
        case 'molotov': {
          const s = 6 + Math.sin(time * 30 + p.id) * 1.5;
          ctx.globalAlpha = 0.9;
          ctx.drawImage(f1, p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'acid':
          ctx.globalAlpha = 0.7;
          ctx.drawImage(f3, p.x - 10, p.y - 10, 20, 20);
          break;
        case 'flare': {
          const s = 7 + Math.sin(time * 40 + p.id) * 1.5;
          ctx.globalAlpha = 1;
          ctx.drawImage(tintedGlow('#ff5a3a'), p.x - s * 2, p.y - s * 2, s * 4, s * 4);
          ctx.drawImage(tintedGlow('#fff0e0'), p.x - s * 0.5, p.y - s * 0.5, s, s);
          break;
        }
        case 'frost': {
          const s = 14 + hash01(p.id) * 8;
          ctx.globalAlpha = 0.28;
          ctx.drawImage(tintedGlow('#9ae8ff'), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case 'bolt':
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = '#c8e6ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(p.angle) * 40, p.y - Math.sin(p.angle) * 40);
          ctx.stroke();
          break;
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;

    // turret muzzle flashes + owner LEDs
    for (const t of view.turrets) {
      if (!inView(t.x, t.y, 60)) continue;
      const c = Math.cos(t.angle), s = Math.sin(t.angle);
      if (t.firing && Math.sin(time * 70 + t.id) > -0.2) {
        const mx = t.x + c * 31, my = t.y + s * 31;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(f0, mx - 9, my - 9, 18, 18);
      }
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 4 + t.id);
      const lx = t.x + c * 2 + s * 3.5, ly = t.y + s * 2 - c * 3.5;
      ctx.drawImage(tintedGlow(info(t.owner).color), lx - 5, ly - 5, 10, 10);
    }
    ctx.globalAlpha = 1;

    // pickups: soft glow so loot reads in the dark
    for (const pk of view.pickups) {
      if (!inView(pk.x, pk.y, 40)) continue;
      const pulse = 0.55 + 0.25 * Math.sin(time * 4 + pk.id);
      ctx.globalAlpha = (pk.kind === 'crate' ? 0.5 : 0.35) * pulse;
      const r = pk.kind === 'crate' ? 34 : 22;
      ctx.drawImage(tintedGlow(PICKUP_GLOW[pk.kind] || '#ffffff'), pk.x - r, pk.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;

    // survivor weapon glows (tesla coils, rail accelerator, pilot light)
    for (const p of view.players) {
      if (p.state !== 'alive' || !inView(p.x, p.y, 60)) continue;
      const wid = p.slots ? p.slots[p.slot] : null;
      if (wid !== 'tesla' && wid !== 'railgun' && wid !== 'flamethrower') continue;
      const off = muzzleOffset(wid) - 2;
      const x = p.x + Math.cos(p.angle) * off, y = p.y + Math.sin(p.angle) * off;
      const col = wid === 'tesla' ? '#80d8ff' : wid === 'railgun' ? '#b388ff' : '#ff9a40';
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(time * 13 + p.id);
      ctx.drawImage(tintedGlow(col), x - 9, y - 9, 18, 18);
    }
    ctx.globalAlpha = 1;

    // objective marker + beacons
    const ob = map.objective;
    if (ob && inView(ob.x, ob.y, Math.max(ob.w, ob.h) + 60)) drawObjectiveGlow(ob, view);
    // lamp bulbs
    for (const l of overhead.lamps) {
      if (!l.light || !inView(l.x, l.y, 40)) continue;
      const fl = l.light.flicker ? (Math.sin(time * 23 + l.x) > -0.6 ? 1 : 0.35) : 1;
      ctx.globalAlpha = 0.8 * fl;
      ctx.drawImage(tintedGlow(l.light.color), l.x + Math.cos(l.a) * 4 - 16, l.y + Math.sin(l.a) * 4 - 16, 32, 32);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawObjectiveGlow(ob, view) {
    const hpf = view.objective && view.objective.maxHp ? view.objective.hp / view.objective.maxHp : 1;
    ctx.save();
    ctx.translate(ob.x, ob.y);
    ctx.rotate(ob.a || 0);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
    const col = hpf < 0.35 ? '#ff5a3a' : '#ffc84a';
    // corner brackets rather than a full box: marks the objective without caging it
    ctx.strokeStyle = col;
    ctx.lineCap = 'round';
    const bx = ob.w / 2 + 12, by = ob.h / 2 + 12, bl = Math.min(26, Math.min(ob.w, ob.h) * 0.4);
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = pass ? 0.45 + 0.25 * pulse : 0.12 + 0.1 * pulse;
      ctx.lineWidth = pass ? 2 : 7;
      ctx.beginPath();
      for (const [sx, sy] of CORNERS) {
        ctx.moveTo(sx * bx, sy * (by - bl));
        ctx.lineTo(sx * bx, sy * by);
        ctx.lineTo(sx * (bx - bl), sy * by);
      }
      ctx.stroke();
    }
    const blink = Math.sin(time * 5) > 0;
    const red = tintedGlow('#ff3a2a'), amber = tintedGlow('#ffb02a');
    if (ob.kind === 'bus') {
      ctx.globalAlpha = 1;
      const hl = ob.w / 2, hw = ob.h / 2;
      ctx.drawImage(blink ? red : amber, hl - 20, -hw - 6, 12, 12);
      ctx.drawImage(blink ? amber : red, hl - 20, hw - 6, 12, 12);
      ctx.drawImage(blink ? red : amber, -hl + 2, -hw - 6, 12, 12);
      ctx.drawImage(blink ? amber : red, -hl + 2, hw - 6, 12, 12);
    } else if (ob.kind === 'diner') {
      // neon DINER sign, with a dying tube that flickers
      const flick = Math.sin(time * 31) > -0.85 ? 1 : 0.2;
      ctx.globalAlpha = 0.9;
      ctx.font = 'bold 22px "Brush Script MT", "Segoe Script", cursive, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff3a9a';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff6ab8';
      ctx.fillText('Diner', 0, 1);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.35 * flick;
      ctx.drawImage(tintedGlow('#ff4aa8'), -70, -40, 140, 80);
      ctx.globalAlpha = 0.8 * flick;
      ctx.strokeStyle = '#6afff0';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-56, -14, 112, 28);
    } else if (ob.kind === 'apc') {
      ctx.globalAlpha = blink ? 1 : 0.3;
      ctx.drawImage(tintedGlow('#40a0ff'), -ob.w / 2 + 4, -8, 16, 16);
    } else if (ob.kind === 'radio') {
      const on = Math.sin(time * 3) > 0.2;
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.drawImage(red, -14, -14, 28, 28);
      ctx.globalAlpha = on ? 0.35 : 0.05;
      ctx.drawImage(red, -60, -60, 120, 120);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---- lighting -----------------------------------------------------------------------------
  function drawLighting(view, lightingOn) {
    if (!lightingOn) {
      // cheap night mood for low quality / lighting off: one flat translucent fill
      // (tint + vignette in the same gradient so it costs a single full-screen fill)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (lowTintKey !== W * 100000 + H) {
        lowTintKey = W * 100000 + H;
        const r = Math.hypot(W, H) / 2;
        lowTint = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
        const base = mix(amb0.tint || '#223344', '#02030a', 0.72);
        const a = clamp((amb0.darkness ?? 0.6) * 0.42, 0, 0.5);
        lowTint.addColorStop(0, rgba(base, a));
        lowTint.addColorStop(1, rgba(base, Math.min(0.85, a + 0.35)));
      }
      ctx.fillStyle = lowTint;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    lighting.begin(K, night);
    for (const L of map.lights) {
      if (!inView(L.x, L.y, L.r)) continue;
      let i = 0.9;
      if (L.flicker) i *= 1 - L.flicker * 0.45 * (0.5 + 0.5 * Math.sin(time * 11 + L.x) * Math.sin(time * 7.3 + L.y));
      lighting.point(L.x, L.y, L.r, i, L.color);
    }
    for (const p of view.players) {
      if (p.state === 'dead') continue;
      // a small personal light keeps every survivor readable, even facing away
      lighting.point(p.x, p.y, p.state === 'downed' ? 110 : 150, 0.75);
      if (p.state === 'alive') {
        // flashlight from the shoulder, slight wobble while walking
        const a = anim.get(p.id);
        const wob = a ? Math.sin(a.walk * 2) * 0.02 * a.move : 0;
        lighting.cone(p.x + Math.cos(p.angle) * 6, p.y + Math.sin(p.angle) * 6, p.angle + wob, 620, 0.92);
      }
    }
    for (const t of view.turrets) lighting.point(t.x, t.y, 80, 0.45, '#cfe8ff');
    for (const L of effects.lights) {
      const lf = L.life / L.max;
      lighting.point(L.x, L.y, L.r * (0.7 + 0.3 * lf), L.i * lf, L.color);
    }
    for (const h of view.hazards) {
      if (h.kind === 'fire') lighting.point(h.x, h.y, h.r * 3.2, Math.min(1, h.life * 3) * (0.85 + 0.15 * Math.sin(time * 13 + h.id)), '#ff9a40');
      // a flare lights a wide circle of road around it
      else if (h.kind === 'flare') lighting.point(h.x, h.y, 360, Math.min(1, h.life * 6) * (0.9 + 0.1 * Math.sin(time * 23 + h.id)), '#ff5a3a');
      else lighting.point(h.x, h.y, h.r * 1.5, 0.3 * Math.min(1, h.life * 3), '#9dff4a');
    }
    let burning = 0;
    const zombies = view.zombies;
    for (let v = 0; v < visCount && burning < 16; v++) {
      const z = zombies[visZ[v]];
      if (z.flags & ZFLAG.BURNING) {
        burning++;
        lighting.point(z.x, z.y, 140, 0.75 + 0.2 * Math.sin(time * 17 + z.id), '#ff9a40');
      }
    }
    let flameLights = 0;
    for (const p of view.projectiles) {
      if (p.kind === 'rocket' || p.kind === 'molotov') lighting.point(p.x, p.y, 170, 0.9, '#ffb060');
      else if (p.kind === 'flare') lighting.point(p.x, p.y, 260, 1, '#ff5a3a');
      else if (p.kind === 'flame' && (p.id % 3 === 0) && flameLights++ < 12) lighting.point(p.x, p.y, 130, 0.7, '#ff9a40');
      else if (p.kind === 'acid') lighting.point(p.x, p.y, 50, 0.4, '#9dff4a');
    }
    for (const pk of view.pickups) lighting.point(pk.x, pk.y, pk.kind === 'crate' ? 80 : 50, 0.5, PICKUP_GLOW[pk.kind]);
    const ob = map.objective;
    if (ob) lighting.point(ob.x, ob.y, Math.max(ob.w, ob.h) * 0.8 + 60, 0.35, '#ffe0b0');
    if (map.supply) lighting.point(map.supply.x, map.supply.y, 160, 0.55, '#ffd9a0');
    lighting.end(ctx, W, H, true);
  }

  // ---- main entry ---------------------------------------------------------------------------
  let renderErrors = 0;
  function render(view, opts = {}) {
    if (destroyed) return;
    try {
      renderFrame(normalizeView(view), opts || {});
    } catch (err) {
      // log a few, then stay quiet: a malformed snapshot must not stop the game loop
      if (renderErrors++ < 5 && typeof console !== 'undefined') console.error('render failed', err);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function renderFrame(view, opts) {
    frameNo++;
    const dt = clamp(Number.isFinite(opts.dt) ? opts.dt : 1 / 60, 0, 0.1);
    time += dt;
    const settings = opts.settings || DEFAULT_SETTINGS;
    const localId = opts.localId || 0;
    roster = opts.roster || EMPTY;
    lastLocalId = localId;
    if (view) lastView = view;
    env.localId = localId;
    env.time = time;
    if (frameNo === 1 || frameNo % 30 === 0) {
      const rect = canvas.getBoundingClientRect();
      if (Math.round(rect.width) !== cssW || Math.round(rect.height) !== cssH) resize();
    }
    const players = view && view.players ? view.players : EMPTY;
    let local = null;
    for (let i = 0; i < players.length; i++) if (players[i].id === localId) { local = players[i]; break; }

    // camera target: me, or a living teammate while I'm dead
    let target = null;
    let snap = false;
    if (local && local.state !== 'dead') {
      target = local;
      spectateId = 0;
    } else {
      let t = null;
      if (spectateId) for (const p of players) if (p.id === spectateId && p.state !== 'dead') t = p;
      if (!t) {
        for (const p of players) if (p.state === 'alive' && p.id !== localId) { t = p; break; }
        if (!t) for (const p of players) if (p.state === 'downed') { t = p; break; }
        if (t && spectateId && t.id !== spectateId) snap = Math.hypot(t.x - camera.x, t.y - camera.y) > 1600;
        spectateId = t ? t.id : 0;
      }
      target = t || local;
    }
    const tx = target ? target.x : (map.objective ? map.objective.x : map.width / 2);
    const ty = target ? target.y : (map.objective ? map.objective.y : map.height / 2);
    const cursor = opts.cursor || null;
    let lookX = 0, lookY = 0;
    if (cursor && local && local.state !== 'dead') {
      lookX = (cursor.x - cssW / 2) / zoom;
      lookY = (cursor.y - cssH / 2) / zoom;
    }
    const viewW = cssW / zoom, viewH = cssH / zoom;
    camera.update(dt, tx, ty, lookX, lookY, viewW, viewH, settings.screenShake !== false, snap);

    const k = zoom * dpr;
    K0.k = k; K0.tx = W / 2 - camera.x * k; K0.ty = H / 2 - camera.y * k;
    K.k = k; K.tx = K0.tx - camera.shakeX * k; K.ty = K0.ty - camera.shakeY * k;
    viewRect.x0 = camera.x + camera.shakeX - viewW / 2 - 8;
    viewRect.y0 = camera.y + camera.shakeY - viewH / 2 - 8;
    viewRect.x1 = viewRect.x0 + viewW + 16;
    viewRect.y1 = viewRect.y0 + viewH + 16;

    const lightingOn = q === 'high' && settings.lighting !== false;

    if (view) {
      trackPlayers(players, dt);
      trackZombies(view.zombies || EMPTY);
    }
    effects.update(dt, time);
    decals.update(dt, time);

    // ---- world ----
    const tStart = hasPerf ? performance.now() : 0;
    mark(null);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = map.ground || '#333';
    ctx.fillRect(0, 0, W, H);
    setWorld();
    ground.draw(ctx, viewRect.x0, viewRect.y0, viewRect.x1, viewRect.y1);
    ground.bakeIdle(camera.x, camera.y);
    water.draw(ctx, viewRect, time);
    decals.drawLayer(ctx, viewRect.x0, viewRect.y0, viewRect.x1, viewRect.y1);
    decals.drawCorpses(ctx, viewRect.x0, viewRect.y0, viewRect.x1, viewRect.y1, time);
    mark('ground');

    const V = view && view.players ? view : null;
    if (V) {
      drawHazardBases(V);
      drawBloodPools(V);
    }
    drawStatics(V, dt);
    mark('statics');
    if (V) {
      drawPickupsAndDeployables(V);
      drawPlayers(V, true);
      drawZombies(V);
      drawTurrets(V);
      drawPlayers(V, false);
      drawProjectiles(V, dt);
      // charging brutes kick up dust; burning zombies emit flames/smoke
      let burning = 0;
      for (let v = 0; v < visCount; v++) {
        const z = V.zombies[visZ[v]];
        const f = z.flags | 0;
        if (f & ZFLAG.CHARGING) effects.emitDust(z.x - Math.cos(z.angle) * 20, z.y - Math.sin(z.angle) * 20, dt, 30, 14);
        if ((f & ZFLAG.BURNING) && burning++ < 40) effects.emitBurning(z.x, z.y, ZT[ZT_INDEX[z.type] ?? 0].r, dt, 0.8);
      }
      for (const h of V.hazards) {
        if (h.kind === 'fire' && inView(h.x, h.y, h.r)) effects.emitEmbers(h.x, h.y, dt, h.r / 12, h.r);
        else if (h.kind === 'flare' && inView(h.x, h.y, h.r)) effects.emitFlareSmoke(h.x, h.y, dt);
      }
    } else {
      visCount = 0;
      bars.count = 0;
    }
    for (const f of map.fires) {
      if (inView(f.x, f.y, f.r * 3)) effects.emitBurning(f.x, f.y, f.r * 0.8, dt, 0.5);
    }
    mark('actors');
    setWorld();
    effects.drawNormal(ctx, K, viewRect);
    setWorld();
    overhead.drawLampsAndFlags(ctx, viewRect, time);
    overhead.drawCanopies(ctx, viewRect, players, dt, spriteScale, K);
    mark('particles');

    drawLighting(V || NO_VIEW, lightingOn);
    mark('lighting');
    drawEmissive(V || NO_VIEW, lightingOn);
    effects.drawEmissive(ctx, K, viewRect, time);
    mark('emissive');

    // ---- screen overlays ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    let cursorDist = 300;
    if (cursor && local) {
      toScreen(local.x, local.y, tmpPt);
      cursorDist = Math.hypot(cursor.x - tmpPt.x, cursor.y - tmpPt.y);
    }
    overlay.draw(ctx, {
      cssW, cssH, view: V, localId, time, local, cursor, cursorDist,
      toScreen, tmp: tmpPt, zoom, zoomUi: zoom, info,
      showNames: settings.showNames !== false, lightingOn,
      zombieBars: bars, objective: map.objective,
      hitMarker: effects.hitMarker, killMarker: effects.killMarker, damagePulse: effects.damagePulse, bloom: effects.bloom,
    });
    mark('overlay');
    if (hasPerf) timings.total += (performance.now() - tStart - timings.total) * 0.1;
  }

  /** World → CSS px (shake included so overlays stay glued to entities). */
  function toScreen(x, y, out) {
    out.x = (K.tx + x * K.k) / dpr;
    out.y = (K.ty + y * K.k) / dpr;
    return out;
  }

  resize();
  zs.prewarm(['walker', 'runner']);

  return {
    render,
    /** Feed GameEvents (SPEC §4.1) for particles, decals, tracers, shake and hit markers. */
    addEvents(events, opts = {}) {
      if (destroyed || !events || !events.length) return;
      env.localId = opts.localId != null ? opts.localId : lastLocalId;
      env.time = time;
      effects.addEvents(events, env);
    },
    screenToWorld(sx, sy) {
      return { x: (sx * dpr - K0.tx) / K0.k, y: (sy * dpr - K0.ty) / K0.k };
    },
    /** World point at the centre of the screen (shake excluded): the audio listener. */
    getCamera() {
      return { x: camera.x, y: camera.y };
    },
    worldToScreen(x, y) {
      return { x: (K0.tx + x * K0.k) / dpr, y: (K0.ty + y * K0.k) / dpr };
    },
    resize,
    setQuality(qq) {
      const nq = qq === 'low' ? 'low' : 'high';
      if (nq === q) return;
      q = nq;
      Q = QUALITY[q];
      ground.destroy();
      ground = createGroundLayer(prep, Q.groundBudget, Q.groundMax);
      decals.destroy();
      decals = createDecals(map.width, map.height, {
        scale: Q.decalScale, maxChunks: Q.decalChunks, maxCorpses: Q.corpses, corpseLife: Q.corpseLife,
      });
      effects.setDecals(decals);
      effects.setQuality(q, Q.particles);
      resize();
    },
    /** Diagnostics for the dev sandbox / e2e tests. */
    get stats() {
      return {
        quality: q, particles: effects.count, corpses: decals.corpseCount, decalChunks: decals.chunkCount,
        groundScale: ground.scale, groundPending: ground.pending, spriteScale, dpr, zoom, visibleZombies: visCount,
        timings: { ...timings },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ground.destroy();
      decals.destroy();
      zs.destroy();
      lighting.destroy();
      effects.clear();
      for (const s of obSprites) releaseCanvas(s && s.c);
      releaseCanvas(objectiveSprite && objectiveSprite.c);
      releaseCanvas(supplySprite && supplySprite.c);
      anim.clear();
    },
  };
}

// ---- lobby helpers --------------------------------------------------------------------------

/**
 * Static thumbnail of a map for the lobby: ground, roads, obstacles, objective (glowing),
 * supply station and zombie spawn zones, with a night tint.
 * @param {HTMLCanvasElement} canvas drawn at its current width/height
 * @param {object} map MapDef
 */
export function renderMapPreview(canvas, map) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#0c0e11';
  g.fillRect(0, 0, W, H);
  if (!map) return;
  const s = Math.min(W / map.width, H / map.height);
  const ox = (W - map.width * s) / 2, oy = (H - map.height * s) / 2;
  g.save();
  g.beginPath();
  g.rect(ox, oy, map.width * s, map.height * s);
  g.clip();
  g.setTransform(s, 0, 0, s, ox, oy);
  const prep = prepareMap(map);
  paintGround(g, prep, { x0: 0, y0: 0, x1: map.width, y1: map.height }, 0);
  for (const o of map.obstacles) {
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.a || 0);
    drawObstacle(g, o, map.seed | 0);
    g.restore();
  }
  for (const d of map.decor) {
    if (d.kind !== 'tree_canopy') continue;
    const r = 40 * (d.s || 1);
    fillCircle(g, d.x, d.y, r, '#1f3318');
    fillCircle(g, d.x - r * 0.2, d.y - r * 0.2, r * 0.6, '#2f4a24');
  }
  // spawn zones
  g.fillStyle = 'rgba(200,30,30,0.22)';
  for (const z of map.zombieSpawns || []) g.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
  // night tint
  const amb = map.ambient || { darkness: 0.6, tint: '#223344' };
  g.fillStyle = rgba(mix(amb.tint, '#02030a', 0.7), clamp(amb.darkness * 0.45, 0, 0.5));
  g.fillRect(0, 0, map.width, map.height);
  // lights
  g.globalCompositeOperation = 'lighter';
  for (const L of map.lights) {
    g.globalAlpha = 0.28;
    g.drawImage(tintedGlow(L.color), L.x - L.r * 0.6, L.y - L.r * 0.6, L.r * 1.2, L.r * 1.2);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // objective + marker
  const ob = map.objective;
  if (ob) {
    g.save();
    g.translate(ob.x, ob.y);
    g.rotate(ob.a || 0);
    drawObjectiveBase(g, ob, map.seed | 0);
    g.restore();
    g.strokeStyle = '#ffc84a';
    g.lineWidth = Math.max(3, 2 / s);
    g.beginPath();
    g.arc(ob.x, ob.y, Math.max(ob.w, ob.h) * 0.7 + 30, 0, TAU);
    g.stroke();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35;
    const r = Math.max(ob.w, ob.h) + 120;
    g.drawImage(tintedGlow('#ffc84a'), ob.x - r, ob.y - r, r * 2, r * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  if (map.supply) {
    g.save();
    g.translate(map.supply.x, map.supply.y);
    drawSupplyBase(g);
    g.restore();
    fillCircle(g, map.supply.x, map.supply.y, Math.max(10, 4 / s), 'rgba(90,220,120,0.35)');
  }
  g.fillStyle = '#7dff9a';
  for (const p of map.playerSpawns || []) fillCircle(g, p.x, p.y, Math.max(5, 2.5 / s));
  g.restore();
  // frame vignette
  g.setTransform(1, 0, 0, 1, 0, 0);
  const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

/**
 * Survivor portrait (head & shoulders) for the lobby and HUD.
 * @param {HTMLCanvasElement} canvas drawn at its current width/height
 * @param {string} classId one of CLASS_IDS
 * @param {number} colorIndex 0..5 (PLAYER_COLORS)
 */
export function renderClassPortrait(canvas, classId, colorIndex) {
  portrait(canvas, classId, colorIndex);
}
