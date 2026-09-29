// "Evac Run" (settings.mode 'zone', SPEC §3.7): every wave the safe zone moves to another
// point of interest of the map (MapDef.pois). During prep/intermission the next zone is
// announced and the team has a distance-scaled countdown to get there (a supply drop waits
// inside, a few zombies harass them on the way); when the wave starts the circle locks,
// later it shrinks to a smaller circle inside it, and anyone outside takes escalating
// blight damage. Wave zombies come from a ring around the circle (and, late in the wave,
// out of the blight just past its edge).
//
// Everything random comes from the director's own seeded stream (the POI order, the
// shrink target) or from game.rng (spawns), so a zone game stays deterministic.

import { DT, PLAYER_RADIUS, PICKUP_LIFETIME } from '../constants.js';
import { createRng, hashString } from '../rng.js';
import { TAU } from '../math.js';
import { crateWeaponPool } from '../weapons.js';
import { ZONE, moveTime, fogDps, shrinkCircle } from '../zone.js';
import { MASK_MOVE } from '../geom.js';
import { downPlayer, spawnPickup } from './players.js';

const STAGE_MOVE = 0, STAGE_HOLD = 1, STAGE_SHRINK = 2, STAGE_FINAL = 3;
const HARASS_TYPES = ['walker', 'walker', 'runner', 'runner', 'runner', 'crawler'];
const RING_ANGLES = 28;
const SPAWN_BOX = 72;

/** Connected components of a flow field's static walk graph (cached per graph). */
const COMPONENTS = new WeakMap();

/**
 * Component label of every cell of `field`'s static walk graph (-1 = blocked/isolated).
 * Shared by every field built on the same static graph.
 * @param {import('../flowfield.js').FlowField} field
 * @returns {Int32Array}
 */
export function walkComponents(field) {
  const hit = COMPONENTS.get(field.edges);
  if (hit) return hit;
  const { n, edges, offs } = field;
  const comp = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let label = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || !edges[s] || field.blocked[s]) continue;
    let top = 0;
    stack[top++] = s;
    comp[s] = label;
    while (top > 0) {
      const c = stack[--top];
      const e = edges[c];
      for (let k = 0; k < 8; k++) {
        if (!(e & (1 << k))) continue;
        const nc = c + offs[k];
        if (comp[nc] >= 0) continue;
        comp[nc] = label;
        stack[top++] = nc;
      }
    }
    label++;
  }
  COMPONENTS.set(field.edges, comp);
  return comp;
}

/**
 * The walk-graph component a point belongs to (blocked cells use their escape cell).
 * @returns {number} label or -1
 */
export function componentAt(field, comp, x, y) {
  let c = field.cellAt(x, y);
  if (field.blocked[c] || !field.edges[c]) c = field.escape[c];
  return c >= 0 ? comp[c] : -1;
}

/**
 * The order in which a zone game visits the map's POIs: `count` indices, starting from the
 * one after `start`, never the same POI twice in a row, preferring POIs between
 * ZONE.pick.near and ZONE.pick.far away (all others when none are). Deterministic for
 * (map, seed). Exported for tests and tools; the director draws the same sequence lazily.
 * @returns {number[]}
 */
export function zoneSequence(map, seed, start, count) {
  const rng = zoneRng(map, seed);
  const out = [];
  let cur = start, back = -1;
  for (let i = 0; i < count; i++) {
    const next = pickNextPoi(map.pois, cur, rng, back);
    back = cur;
    cur = next;
    out.push(cur);
  }
  return out;
}

function zoneRng(map, seed) {
  return createRng((hashString(`zone:${map.id}`) ^ (seed >>> 0) ^ 0x5bd1e995) >>> 0);
}

/**
 * The next zone: a POI in the distance band, else (a small map) the farther half of the
 * others, so the team always has to move; never straight back to `back` (the zone before
 * the current one) unless nothing else is left.
 */
function pickNextPoi(pois, cur, rng, back = -1) {
  const from = pois[cur];
  const pick = (skip) => {
    const cand = [];
    const others = [];
    for (let i = 0; i < pois.length; i++) {
      if (i === cur || i === skip) continue;
      const d = from ? Math.hypot(pois[i].x - from.x, pois[i].y - from.y) : 0;
      others.push([d, i]);
      if (!from || (d >= ZONE.pick.near && d <= ZONE.pick.far)) cand.push(i);
    }
    if (!cand.length) {
      others.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (let k = 0; k < Math.ceil(others.length / 2); k++) cand.push(others[k][1]);
    }
    return cand;
  };
  let cand = pick(back);
  if (!cand.length) cand = pick(-1);
  if (!cand.length) return cur;
  return cand[Math.floor(rng.next() * cand.length)];
}

/** The POI nearest (x, y). */
export function nearestPoi(pois, x, y) {
  let best = 0, bd = Infinity;
  pois.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Runs the moving safe zone of one game (game.zone). */
export class ZoneDirector {
  /** @param {import('./core.js').GameCore} game */
  constructor(game) {
    const map = game.map;
    this.game = game;
    this.pois = map.pois;
    /** The POI order (zoneSequence draws the same stream) and everything else random here. */
    this.seqRng = zoneRng(map, game.seed);
    this.rng = createRng((zoneRng(map, game.seed).next() * 4294967296) ^ 0x2545f491);
    this.comp = walkComponents(game.flow);
    const sp = map.playerSpawns && map.playerSpawns.length ? map.playerSpawns[0] : map.supply;
    /** POI the team is at (where they spawned, then the last zone). */
    this.cur = nearestPoi(this.pois, sp.x, sp.y);
    this.mainComp = componentAt(game.flow, this.comp, this.pois[this.cur].x, this.pois[this.cur].y);
    /** POI of the announced / locked zone. */
    this.poi = this.cur;
    this.stage = STAGE_MOVE;
    /** Live safe circle and the circle it is heading for (the shrink target). */
    this.circle = { x: 0, y: 0, r: 0 };
    this.target = { x: 0, y: 0, r: 0 };
    this.from = { x: 0, y: 0, r: 0 };
    /** Seconds left in the current stage, and its full length. */
    this.t = 0;
    this.total = 0;
    this.supply = { x: sp.x, y: sp.y };
    this.harassLeft = 0;
    this.harassT = 0;
    /** Running totals for tools (scripts/balance.js): blight hp dealt, harassers spawned. */
    this.stats = { fog: 0, harassed: 0 };
    this._rects = null;
    this._rectsKey = '';
    this._fogRects = null;
    if (map.width * map.height > ZONE.navRangeArea) {
      game.flow.maxDist = ZONE.navRange;
      game.flowBig.maxDist = ZONE.navRange;
    }
  }

  /** First zone: announced at game start, the countdown is the prep phase. */
  begin() {
    return this._announce(true);
  }

  /**
   * Called when a wave is cleared (after the clear bonus): the next zone is announced.
   * @returns {number} the move time (the intermission's length)
   */
  next() {
    return this._announce(false);
  }

  _announce(first) {
    const game = this.game;
    const prev = this.pois[this.poi];
    const back = first ? -1 : this.cur;
    this.cur = this.poi;
    this.poi = pickNextPoi(this.pois, this.cur, this.seqRng, back);
    const p = this.pois[this.poi];
    this.stage = STAGE_MOVE;
    setCircle(this.circle, p.x, p.y, p.r);
    setCircle(this.target, p.x, p.y, p.r);
    const d = Math.hypot(p.x - prev.x, p.y - prev.y);
    this.total = this.t = moveTime(d, first);
    this._rects = null;
    this._fogRects = null;
    this._dropSupply(p);
    // Harassers on the way: more on later waves and with a bigger team.
    const h = ZONE.harass;
    const crowd = (1 + 0.3 * (game.players.length - 1)) * game.diff.count;
    this.harassLeft = Math.min(h.cap, Math.round((h.base + h.perWave * game.wave) * crowd));
    this.harassT = h.firstAfter;
    game.emit({ type: 'zone', stage: 'next', poi: this.poi, x: Math.round(p.x), y: Math.round(p.y), r: p.r, time: this.total });
    return this.total;
  }

  /** The wave starts: the circle locks where it is. */
  lock() {
    this.stage = STAGE_HOLD;
    this.total = this.t = ZONE.hold;
    this.harassLeft = 0;
    for (const p of this.game.players) p.fogT = 0;
    const c = this.circle;
    this.game.emit({ type: 'zone', stage: 'lock', poi: this.poi, x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r), time: ZONE.hold });
  }

  _startShrink() {
    const c = this.circle, rng = this.rng;
    this.stage = STAGE_SHRINK;
    this.total = this.t = ZONE.shrink;
    this.from.x = c.x;
    this.from.y = c.y;
    this.from.r = c.r;
    const r2 = this.game.waveBosses > 0
      ? Math.min(c.r, Math.max(Math.round(c.r * ZONE.shrinkToBoss), ZONE.bossMinR))
      : Math.round(c.r * ZONE.shrinkTo);
    // A new centre inside the old circle, on open, connected ground.
    let tx = c.x, ty = c.y;
    for (let i = 0; i < 12; i++) {
      const a = rng.range(0, TAU), d = rng.range(0.15, 0.8) * (c.r - r2);
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      if (this.game.world.isCircleFree(x, y, PLAYER_RADIUS + 20, false) && componentAt(this.game.flow, this.comp, x, y) === this.mainComp) {
        tx = x;
        ty = y;
        break;
      }
    }
    setCircle(this.target, Math.round(tx), Math.round(ty), r2);
    this._fogRects = null;
    this.game.emit({ type: 'zone', stage: 'shrink', poi: this.poi, x: this.target.x, y: this.target.y, r: r2, time: ZONE.shrink });
  }

  /** Put the supply drop at an open spot near the zone centre, with loot around it. */
  _dropSupply(p) {
    const game = this.game, world = game.world, rng = this.rng;
    let sx = p.x, sy = p.y;
    for (let i = 0; i < 16; i++) {
      const a = rng.range(0, TAU), d = i === 0 ? 0 : rng.range(40, Math.min(220, p.r * 0.4));
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (world.isCircleFree(x, y, 46, false) && componentAt(game.flow, this.comp, x, y) === this.mainComp) {
        sx = x;
        sy = y;
        break;
      }
    }
    this.supply.x = Math.round(sx);
    this.supply.y = Math.round(sy);
    const life = this.total + 60;
    const n = game.players.length;
    const loot = ['crate', 'armor'];
    for (let i = 0; i < 1 + (n >> 1); i++) loot.push('ammo');
    for (let i = 0; i < 1 + Math.floor(n / 3); i++) loot.push('health');
    loot.push('frag');
    const pool = crateWeaponPool(Math.max(1, game.wave + 1));
    loot.forEach((kind, i) => {
      const a = (i / loot.length) * TAU + rng.range(-0.2, 0.2);
      let x = sx + Math.cos(a) * 64, y = sy + Math.sin(a) * 64;
      if (!world.isCircleFree(x, y, 14, false)) {
        x = sx + Math.cos(a) * 30;
        y = sy + Math.sin(a) * 30;
      }
      spawnPickup(game, kind, x, y, kind === 'crate' ? pool[Math.floor(rng.next() * pool.length)] : null, Math.max(PICKUP_LIFETIME, life));
    });
    game.emit({ type: 'drop', x: this.supply.x, y: this.supply.y });
  }

  /** One tick (every phase but game over / victory). */
  update() {
    const game = this.game;
    if (game.over) return;
    this.t = Math.max(0, this.t - DT);
    if (this.stage === STAGE_MOVE) {
      if (game.phase === 'prep' || game.phase === 'intermission') this._harass();
      return;
    }
    if (this.stage === STAGE_HOLD && this.t <= 0) this._startShrink();
    else if (this.stage === STAGE_SHRINK) {
      shrinkCircle(this.from, this.target, ZONE.shrink - this.t, this.circle);
      if (this.t <= 0) {
        setCircle(this.circle, this.target.x, this.target.y, this.target.r);
        this.stage = STAGE_FINAL;
        this.total = this.t = 0;
      }
    }
    if (game.phase === 'wave') this._blight();
  }

  /** Damage outside the circle (wave only). */
  _blight() {
    const game = this.game, c = this.circle, f = ZONE.fog;
    for (const p of game.players) {
      if (p.state === 'dead') continue;
      const dx = p.x - c.x, dy = p.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d <= c.r) {
        p.fogT = Math.max(0, (p.fogT || 0) - DT * f.decay);
        continue;
      }
      p.fogT = (p.fogT || 0) + DT;
      if (p.state === 'downed') {
        // Downed in the blight: bleeds out faster, never instantly.
        if (!p.selfRevive) p.bleedout -= DT * f.downedBleed;
        continue;
      }
      const amount = fogDps(p.fogT, game.wave) * DT;
      p.hp -= amount;
      this.stats.fog += amount;
      // Reported like acid: in chunks, "from" the blight outside.
      p.dotAcc += amount;
      p.dotX = p.x + (dx / (d || 1)) * 120;
      p.dotY = p.y + (dy / (d || 1)) * 120;
      if (p.hp <= 0) downPlayer(game, p);
    }
  }

  /** A few zombies on the way to the next zone. */
  _harass() {
    if (this.harassLeft <= 0) return;
    const game = this.game;
    this.harassT -= DT;
    if (this.harassT > 0) return;
    const h = ZONE.harass, rng = game.rng;
    this.harassT = h.every * rng.range(0.7, 1.3);
    let alive = 0;
    for (const p of game.players) if (p.state === 'alive') alive++;
    if (!alive) return;
    let k = Math.floor(rng.next() * alive);
    let who = null;
    for (const p of game.players) if (p.state === 'alive' && k-- === 0) who = p;
    const goal = this.circle;
    const gd = Math.hypot(goal.x - who.x, goal.y - who.y);
    // Already there: the harassers come from outside the circle instead.
    // Mostly ahead on the way (a third of the groups come in from a flank); once there,
    // from anywhere outside the circle.
    let base = gd > goal.r ? Math.atan2(goal.y - who.y, goal.x - who.x) : rng.range(0, TAU);
    if (gd > goal.r && rng.chance(0.35)) base += (rng.chance(0.5) ? 1 : -1) * rng.range(1.2, 2);
    const spot = this._openSpot(who.x, who.y, base, 1.2, h.dist, 600);
    if (!spot) return;
    const n = Math.min(this.harassLeft, rng.int(h.group[0], h.group[1]));
    for (let i = 0; i < n; i++) {
      const type = HARASS_TYPES[Math.floor(rng.next() * HARASS_TYPES.length)];
      const x = spot.x + rng.range(-40, 40), y = spot.y + rng.range(-40, 40);
      const ok = game.world.isCircleFree(x, y, 14, true);
      game.spawnZombieAt(type, ok ? x : spot.x, ok ? y : spot.y);
    }
    this.harassLeft -= n;
    this.stats.harassed += n;
  }

  /** An open, connected spot `dist` px from (x, y) around angle `a` ± spread, far from survivors. */
  _openSpot(x, y, a, spread, dist, far) {
    const game = this.game, rng = game.rng, W = game.map.width, H = game.map.height;
    for (let i = 0; i < 10; i++) {
      const ang = a + rng.range(-spread, spread), d = rng.range(dist[0], dist[1]);
      const sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d;
      if (sx < 60 || sy < 60 || sx > W - 60 || sy > H - 60) continue;
      if (!game.world.isCircleFree(sx, sy, 30, true)) continue;
      if (componentAt(game.flow, this.comp, sx, sy) !== this.mainComp) continue;
      let ok = true;
      for (const p of game.players) {
        if (p.state !== 'dead' && Math.hypot(p.x - sx, p.y - sy) < far) {
          ok = false;
          break;
        }
      }
      if (ok) return { x: sx, y: sy };
    }
    return null;
  }

  /**
   * Spawn rectangles for wave zombies (zombies.js pickSpawnRect): a ring around the
   * circle, and from the shrink on sometimes the blight just past its edge.
   * @returns {{rects: object[], far: number}|null} null = use the map's own spawns
   */
  spawnRects() {
    const s = ZONE.spawn;
    if (this.stage >= STAGE_SHRINK && this.game.rng.next() < s.fogShare) {
      if (!this._fogRects) this._fogRects = this._ring(this.target, s.fogRing);
      if (this._fogRects.length) return { rects: this._fogRects, far: s.fogFar };
    }
    // The ring follows the circle the team is heading for (the live one until the shrink).
    const c = this.target;
    const key = `${c.x},${c.y},${c.r}`;
    if (key !== this._rectsKey || !this._rects) {
      this._rectsKey = key;
      this._rects = this._ring(c, s.ring);
    }
    return this._rects.length ? { rects: this._rects, far: s.far } : null;
  }

  /** Open, connected spawn boxes on a ring [lo, hi] px past a circle's edge. */
  _ring(c, [lo, hi]) {
    const game = this.game, world = game.world, W = game.map.width, H = game.map.height;
    const out = [];
    const half = SPAWN_BOX / 2;
    for (let k = 0; k < RING_ANGLES; k++) {
      const a = ((k + 0.5) / RING_ANGLES) * TAU;
      for (let j = 0; j < 4; j++) {
        const d = c.r + lo + ((hi - lo) * j) / 3;
        const x = Math.round(c.x + Math.cos(a) * d), y = Math.round(c.y + Math.sin(a) * d);
        if (x < half + 40 || y < half + 40 || x > W - half - 40 || y > H - half - 40) continue;
        if (!world.isCircleFree(x, y, half, false, MASK_MOVE)) continue;
        if (componentAt(game.flow, this.comp, x, y) !== this.mainComp) continue;
        out.push({ x, y, w: SPAWN_BOX, h: SPAWN_BOX });
        break;
      }
    }
    return out;
  }

  /** A clear spot inside the live circle for (re)spawning player index i. */
  spawnPoint(i) {
    const game = this.game, c = this.circle, world = game.world;
    const a0 = (i * TAU) / 6 + 0.4;
    for (let ring = 0; ring < 4; ring++) {
      const d = 60 + ring * 55;
      for (let k = 0; k < 6; k++) {
        const a = a0 + (k * TAU) / 6;
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
        if (!world.isCircleFree(x, y, PLAYER_RADIUS + 4, true)) continue;
        if (componentAt(game.flow, this.comp, x, y) !== this.mainComp) continue;
        let taken = false;
        for (const p of game.players) {
          if (p.state !== 'dead' && Math.abs(p.x - x) < PLAYER_RADIUS * 2 && Math.abs(p.y - y) < PLAYER_RADIUS * 2) {
            taken = true;
            break;
          }
        }
        if (!taken) return { x, y };
      }
    }
    const pos = { x: c.x, y: c.y };
    world.resolveCircle(pos, PLAYER_RADIUS);
    return pos;
  }

  /** True if every living survivor stands inside the announced circle. */
  everyoneIn() {
    const c = this.circle;
    let any = false;
    for (const p of this.game.players) {
      if (p.state !== 'alive') continue;
      any = true;
      if (Math.hypot(p.x - c.x, p.y - c.y) > c.r) return false;
    }
    return any;
  }

  /** Snapshot.zone (SPEC §4). */
  snapshot() {
    const c = this.circle, t = this.target;
    return {
      stage: this.stage, poi: this.poi, from: this.cur,
      x: c.x, y: c.y, r: c.r, nx: t.x, ny: t.y, nr: t.r,
      t: this.t, total: this.total, sx: this.supply.x, sy: this.supply.y,
    };
  }
}

function setCircle(c, x, y, r) {
  c.x = x;
  c.y = y;
  c.r = r;
}
