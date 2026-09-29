// Bot brain for Blast Party (docs/SPEC.md §6, §6.1): BotBrain.think(world, playerId) -> { d, b, x }.
//
// Every bot thinks in the same four steps, whatever its level; the levels only differ in how often, how far and how well:
//   1. DangerMap   - for every tile, the ticks at which a flame is lethal on it: lingering flames, every bomb on the board
//                    (chain reactions resolved in time order with computeBlast, so an arm that a bomb already removed no longer
//                    stops a later blast), thrown and sliding bombs, and sudden-death landings.
//   2. Reach       - an earliest-arrival search over tiles that knows how long walking takes (effectiveSpeed) and refuses to
//                    stand on a tile while it is lethal. A bot may wait for a flame to die out, never walk through one.
//   3. The plan    - flee if the current tile is going to burn, else bomb / kick / throw if that pays and an escape route is
//                    proven, else walk to the best item, bomb spot, enemy or (sudden death) the tile that lands last.
//   4. Steering    - follow the planned tile path one cmd per tick, undo the bot's own curse (reverse, rush), and veto a step
//                    that would end on a lethal tile whatever the plan says.
//
// Time base: `T = world.tickNo` when think() runs; the cmd returned is applied before tick T+1, and the kill check of tick T+j
// sees the position after j cmds. A bomb read with `fuse = f` explodes on tick T+f; its flame is lethal on ticks T+f .. T+f+35.
//
// Clarifications where the spec leaves room:
//  * think() also reads `world.mode` ('ffa' | 'teams'), which the §6.1 read list omits: without it a bot cannot tell allies from
//    enemies. Teammates are never hunted and a bomb that would catch one is worth less.
//  * Besides BotBrain the module exports DangerMap (the danger model) and hypothetical (a bomb that is not on the board yet), for specs
//    and the developer tooling under scripts/dev/bots.
//  * BotBrain takes { level, seed }; the levels differ in a frozen profile of twenty parameters (PROFILES below), not in separate code.
//  * The brain keeps its own state (plan, path, stall clock) and never writes to anything it reads; it owns a makeRng(seed) and
//    uses no clock, so a round replays identically.
//  * `b` and `x` are 1 only on the tick a plan starts the action; every other tick returns b:0, x:0.

import {
  GRID_W, GRID_H, DT, DIR_DX, DIR_DY, FUSE_TICKS, FLAME_TICKS, KICK_STEP_TICKS, THROW_DIST, THROW_TICKS, SD_INTERVAL, SD_WARN_TICKS, STATE,
  MAX_BOMBS, MAX_RANGE, MAX_SPEED_LV,
} from './constants.js';
import { makeRng } from './rng.js';
import { computeBlast, effectiveDir, effectiveSpeed, makeEnv, movePlayer, overlapsTile } from './world.js';

const W = GRID_W;
const H = GRID_H;
const N = W * H;
const INF = 1000000000;

const HORIZON = 260;             // ticks: a fuse (150) + a flame (36) + slack. Only hazards inside it make a tile unfit to rest on.
const PRE_SD_TICKS = 420;        // ticks before sudden death in which bots already take position for it
const SD_NEAR = 90;              // ticks: a sudden-death tile that lands this soon after we arrive is no place to stand
const SLOTS = 6;                 // lethal intervals remembered per tile (overflow merges into the last one, which only adds caution)
const MAX_WAIT = 60;             // ticks a bot will stand still to let a flame die out on its route
const WAIT_TOL = 3;              // ticks of early arrival that are not worth standing still for
const REBUILD_EVERY = 24;        // ticks after which the danger map is rebuilt even if the board looks unchanged
const HYP_ID = 1000000;          // id of the hypothetical bomb of an escape check

// Behaviour of the three levels (SPEC §6). `interval` is the re-plan cadence in ticks, `instant` whether a new danger forces a re-plan
// at once, `margin` the safety slack in ticks around every step of a route (easy cuts it fine and pays for it).
const PROFILES = Object.freeze({
  easy: Object.freeze({
    interval: 14, instant: false, margin: 1, near: 90, sdNear: 45, mistake: 0.08, react: 12, itemSteps: 2, sight: 1, curses: false, itemBias: {}, shun: false,
    kick: false, glove: false, trap: false, camp: false, careful: 0, skull: 0.6, hunt: 0, stall: 360,
  }),
  normal: Object.freeze({
    interval: 7, instant: true, margin: 3, near: 120, sdNear: 70, mistake: 0, react: 0, itemSteps: 12, sight: 9, curses: true, itemBias: {}, shun: false,
    kick: true, glove: false, trap: false, camp: false, careful: 2, skull: 0.3, hunt: 1.2, stall: 300,
  }),
  hard: Object.freeze({
    interval: 3, instant: true, margin: 4, near: 150, sdNear: 90, mistake: 0, react: 0, itemSteps: 40, sight: 99, curses: true, itemBias: { shield: 1.4, speed: 1.4 }, shun: true,
    kick: true, glove: true, trap: true, camp: true, careful: 2, skull: -1, hunt: 2.0, stall: 240,
  }),
});

const ITEM_VALUE = Object.freeze({ bomb: 3.0, flame: 2.6, speed: 2.4, kick: 2.2, glove: 1.8, shield: 2.8, skull: 1.0 });
const BLOCK_VALUE = 1.0;         // per soft block a bomb opens (capped, see BLOCK_CAP)
const BLOCK_CAP = 3;
const ENEMY_HIT_VALUE = 1.6;     // a bomb whose flames cover an enemy: it has to run, and a slow one dies
const ALLY_HIT_PENALTY = 2.5;
const HOLD_TICKS = 20;           // ticks a rival must stand still on a tile before it counts as holding it
const SEAL_WINDOW = 138;         // ticks before the last tile lands in which a bomb on it cannot explode first (the fuse is 150)
const RESCUE_VALUE = 12;         // a kick or throw that frees a bot with no way out beats any attack
const RELOCATE_MIN = 1.5;        // the least a kicked or thrown bomb must promise (one rival under its flames)
const KICK_PATIENCE = 24;        // ticks a bot keeps pushing at a bomb before it gives up (it has to walk up to it first)
const SPAM_LOOK = 34;            // ticks before the next automatic bomb from which a cursed bot starts to look for a safe place to be
const KILL_VALUE = 10;           // a bomb that leaves an enemy with no way out
const TRAP_RANGE = 8;            // tiles: rivals farther away than this are not worth a trap check
const TRAP_ROOM = 14;            // a rival with more safe tiles than this in reach cannot be trapped by one bomb
const SEAL_REACH = 5;            // tiles: a rival farther than this from a tile of our escape route cannot close it in time
const SHUN_RANGE = 3;            // tiles: how close a cursed player may come before a careful bot backs off
const HUNT_SLACK = 4;            // cost units by which the old hunting spot may be worse than the best one before we switch
const POCKET = 4;                // a dead end of at most this many tiles counts as a pocket
const POCKET_RIVAL = 6;          // tiles: how close a rival must be to the mouth of a pocket for it to be a risk
const STICK = 1.35;              // score bonus of the goal already being pursued: no dithering between equal goals

// ------------------------------------------------------------------------------------------------
// Board geometry
// ------------------------------------------------------------------------------------------------

const NB = new Int16Array(N * 4).fill(-1);      // neighbour of tile i in direction d (1 up, 2 right, 3 down, 4 left): NB[i*4 + d-1]
for (let ty = 0; ty < H; ty++) {
  for (let tx = 0; tx < W; tx++) {
    for (let d = 1; d <= 4; d++) {
      const nx = tx + DIR_DX[d];
      const ny = ty + DIR_DY[d];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) NB[(ty * W + tx) * 4 + d - 1] = ny * W + nx;
    }
  }
}

/** Direction code that leads from tile `a` to the adjacent tile `b` (0 when they are not neighbours). */
function dirOf(a, b) {
  const diff = b - a;
  if (diff === -W) return 1;
  if (diff === 1) return 2;
  if (diff === W) return 3;
  if (diff === -1) return 4;
  return 0;
}

const tileOf = (p) => Math.floor(p.y) * W + Math.floor(p.x);
const manhattan = (a, b) => Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));

// ------------------------------------------------------------------------------------------------
// DangerMap: when is each tile lethal?
// ------------------------------------------------------------------------------------------------

/**
 * The order in which sudden death drops tiles, for a grid that has not started it yet: clockwise rings from the top-left of each ring,
 * every non-wall cell once (docs/SPEC.md §3.2.1). Returns the tile index per landing rank.
 */
function spiralOrder(grid) {
  const order = [];
  for (let r = 1; ; r++) {
    const x0 = r;
    const y0 = r;
    const x1 = W - 1 - r;
    const y1 = H - 1 - r;
    if (x0 > x1 || y0 > y1) break;
    for (let x = x0; x <= x1; x++) order.push(y0 * W + x);
    for (let y = y0 + 1; y <= y1; y++) order.push(y * W + x1);
    if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) order.push(y1 * W + x);
    if (x1 > x0) for (let y = y1 - 1; y >= y0 + 1; y--) order.push(y * W + x0);
  }
  return order.filter((t) => grid[t] !== '#' && grid[t] !== 'X');
}

/** A bomb as the danger model sees it: `at` = the tick it explodes, `land` = the tick it starts to exist on its tile (thrown bombs). */
function virtualBomb(b, T) {
  const flying = b.fly !== null && b.fly !== undefined && b.fly !== 0;
  const left = flying ? b.fly.left : 0;
  return { id: b.id, tx: b.tx, ty: b.ty, range: b.range, at: T + left + b.fuse, land: flying ? T + left : -INF, fly: null, done: false, dir: flying ? 0 : b.dir, step: b.step };
}

export class DangerMap {
  constructor() {
    this.T = 0;
    this.sdNear = SD_NEAR;                        // a sudden-death tile that lands sooner than this after we get there is no place to stand
    this.cnt = new Uint8Array(N);                 // lethal intervals per tile
    this.lo = new Int32Array(N * SLOTS);          // [lo, hi] in absolute ticks, inclusive
    this.hi = new Int32Array(N * SLOTS);
    this.land = new Int32Array(N);                // tick at which a sudden-death tile lands (INF: never); lethal from then on, forever
    this.rest = new Int32Array(N);                // first tick after the last lethal tick inside the horizon (0: nothing to fear)
    this.solid = new Uint8Array(N);               // walls, blocks and bombs that move: cannot be walked through, ever
    this.hold = new Int32Array(N);                // a bomb that stays put blocks its tile until the tick it explodes (0: not blocked)
    this._grid = new Array(N);
    this._bombs = [];
    this._batch = [];
    this._present = [];
    this._opened = [];
  }

  /**
   * Rebuilds the map from `world`; `extra` are hypothetical bombs (virtual bombs, see `hypothetical`) that are added to the board and
   * the real bomb `without` (an id) is left out, so that a kicked or thrown bomb can be shown where it would end up.
   * @returns {DangerMap} this
   */
  build(world, extra = null, without = -1) {
    const T = world.tickNo;
    const grid = world.grid;
    this.T = T;
    this.cnt.fill(0);
    this.land.fill(INF);
    for (let i = 0; i < N; i++) this.solid[i] = grid[i] === '.' ? 0 : 1;
    this.hold.fill(0);
    this._schedule(world, T);

    const bombs = this._bombs;
    bombs.length = 0;
    for (const b of world.bombs) if (b.id !== without) bombs.push(virtualBomb(b, T));
    if (extra) for (const e of extra) bombs.push(e);
    for (const f of world.flames) this._add(f.ty * W + f.tx, T + 1, T + f.ticks);
    if (bombs.length > 0) this._explode(grid, bombs);
    for (const b of bombs) {
      const i = b.ty * W + b.tx;
      if (b.dir !== 0 || b.land > T) this.solid[i] = 1;                      // sliding and flying bombs are not where they will be
      else this.hold[i] = Math.min(b.at, this.land[i]);
    }
    for (let i = 0; i < N; i++) {
      let r = 0;
      const base = i * SLOTS;
      for (let k = 0; k < this.cnt[i]; k++) if (this.lo[base + k] <= T + HORIZON && this.hi[base + k] + 1 > r) r = this.hi[base + k] + 1;
      this.rest[i] = r;
    }
    return this;
  }

  /**
   * Fills `land`: the real schedule once sudden death runs; in the last PRE_SD_TICKS before it starts the schedule that will come (the
   * spiral is a public rule), so that bots can take position for the last stand.
   */
  _schedule(world, T) {
    const grid = world.grid;
    if (world.suddenDeath) {
      for (let i = 0; i < N; i++) {
        if (grid[i] === '#' || grid[i] === 'X') continue;
        const t = world.landTick(i % W, Math.floor(i / W));
        if (t !== Infinity) this.land[i] = t;
      }
    } else if (world.timeLeft > 0 && world.timeLeft <= PRE_SD_TICKS) {
      const start = T + world.timeLeft;
      const order = spiralOrder(grid);
      for (let k = 0; k < order.length; k++) this.land[order[k]] = start + k * SD_INTERVAL + SD_WARN_TICKS;
    }
  }

  _add(i, a, b) {
    const base = i * SLOTS;
    const n = this.cnt[i];
    for (let k = 0; k < n; k++) {
      if (a <= this.hi[base + k] + 1 && b >= this.lo[base + k] - 1) {      // touching or overlapping: one interval
        if (a < this.lo[base + k]) this.lo[base + k] = a;
        if (b > this.hi[base + k]) this.hi[base + k] = b;
        return;
      }
    }
    if (n < SLOTS) {
      this.lo[base + n] = a;
      this.hi[base + n] = b;
      this.cnt[i] = n + 1;
    } else {                                                                  // out of slots: widen the last one (only ever more careful)
      if (a < this.lo[base + n - 1]) this.lo[base + n - 1] = a;
      if (b > this.hi[base + n - 1]) this.hi[base + n - 1] = b;
    }
  }

  /**
   * Explosions in time order. Everything due on one tick resolves together (a chain ignites its neighbours on that very tick),
   * bombs stay on the board until the whole batch is done, and the blocks a batch opens are gone for the next one.
   */
  _explode(grid, bombs) {
    const g = this._grid;
    for (let i = 0; i < N; i++) g[i] = grid[i];
    const batch = this._batch;
    const present = this._present;
    const opened = this._opened;
    let left = bombs.length;
    while (left > 0) {
      let e = INF;
      for (const b of bombs) if (!b.done && b.at < e) e = b.at;
      batch.length = 0;
      present.length = 0;
      for (const b of bombs) {
        if (b.done) continue;
        if (b.at === e) batch.push(b);
        if (b.land <= e && this.land[b.ty * W + b.tx] > e) present.push(b);      // a landed tile takes its bomb along (bombgone)
      }
      for (let qi = 0; qi < batch.length; qi++) {
        const b = batch[qi];
        if (this.land[b.ty * W + b.tx] <= e) continue;                             // ... which then never goes off
        const blast = computeBlast(g, present, b);
        for (const t of blast.tiles) this._add(t[1] * W + t[0], e, e + FLAME_TICKS - 1);
        for (const t of blast.blocks) opened.push(t[1] * W + t[0]);
        for (const id of blast.hitBombs) {
          const h = bombs.find((o) => o.id === id);
          if (h && !h.done && h.at > e) {
            h.at = e;
            batch.push(h);
          }
        }
      }
      for (const b of batch) b.done = true;
      left -= batch.length;
      for (const idx of opened) g[idx] = '.';
      opened.length = 0;
    }
    for (const b of bombs) b.done = false;
    this._slidingBombs(g, bombs);
  }

  /** A kicked bomb may be anywhere along its line when it goes off: every tile it could still reach gets its blast, unchained. */
  _slidingBombs(g, bombs) {
    for (const b of bombs) {
      if (b.dir === 0) continue;
      const reachable = b.at >= this.T + b.step ? Math.floor((b.at - this.T - b.step) / KICK_STEP_TICKS) + 1 : 0;
      let tx = b.tx;
      let ty = b.ty;
      for (let k = 1; k <= reachable; k++) {
        tx += DIR_DX[b.dir];
        ty += DIR_DY[b.dir];
        const i = ty * W + tx;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H || g[i] !== '.' || bombs.some((o) => o !== b && o.tx === tx && o.ty === ty)) break;
        const blast = computeBlast(g, bombs, { id: b.id, tx, ty, range: b.range });
        for (const t of blast.tiles) this._add(t[1] * W + t[0], b.at, b.at + FLAME_TICKS - 1);
      }
    }
  }

  /** Is any tick of [a, b] lethal on tile i? Sudden-death tiles are lethal from their landing on. */
  hits(i, a, b) {
    if (b >= this.land[i]) return true;
    const base = i * SLOTS;
    for (let k = 0, n = this.cnt[i]; k < n; k++) if (this.lo[base + k] <= b && this.hi[base + k] >= a) return true;
    return false;
  }

  /** The last lethal tick inside [a, b] on tile i, INF for a landing, -1 when the window is clear. */
  blockEnd(i, a, b) {
    if (b >= this.land[i]) return INF;
    let e = -1;
    const base = i * SLOTS;
    for (let k = 0, n = this.cnt[i]; k < n; k++) if (this.lo[base + k] <= b && this.hi[base + k] >= a && this.hi[base + k] > e) e = this.hi[base + k];
    return e;
  }

  /** First tick at or after `a` at which a flame is lethal on tile i (INF: never). */
  nextFlame(i, a) {
    let e = INF;
    const base = i * SLOTS;
    for (let k = 0, n = this.cnt[i]; k < n; k++) {
      if (this.hi[base + k] < a) continue;
      const s = this.lo[base + k] > a ? this.lo[base + k] : a;
      if (s < e) e = s;
    }
    return e;
  }

  /** First tick at or after `a` at which tile i is lethal, flame or landing (INF: never). */
  nextLethal(i, a) {
    const f = this.nextFlame(i, a);
    return this.land[i] < f ? this.land[i] : f;
  }

  /** Convenience for specs and tools: is tile (tx, ty) lethal on any tick of [from, to]? */
  lethal(tx, ty, from, to = from) {
    return this.hits(ty * W + tx, from, to);
  }

  /** Is tile i closed to walkers at tick t (wall, block, moving bomb, or a bomb that has not gone off yet)? */
  closed(i, t) {
    return this.solid[i] !== 0 || this.hold[i] > t;
  }

  /** Walkable neighbours of tile i. */
  openCount(i) {
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const j = NB[i * 4 + d];
      if (j >= 0 && this.solid[j] === 0 && this.hold[j] === 0) n++;
    }
    return n;
  }

  /** Neighbours of tile i that are about to burn. */
  hazardCount(i) {
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const j = NB[i * 4 + d];
      if (j >= 0 && this.solid[j] === 0 && this.rest[j] > 0) n++;
    }
    return n;
  }
}

/**
 * A hypothetical bomb on tile (tx, ty) for DangerMap.build: explodes `fuse` ticks after `T`; `lands` ticks from now it arrives there
 * when it is a thrown one.
 */
export function hypothetical(tx, ty, range, T, fuse = FUSE_TICKS, lands = 0) {
  return { id: HYP_ID, tx, ty, range, at: T + lands + fuse, land: lands > 0 ? T + lands : -INF, fly: null, done: false, dir: 0, step: 0 };
}

// ------------------------------------------------------------------------------------------------
// Reach: earliest-arrival search with time windows
// ------------------------------------------------------------------------------------------------

/**
 * Ticks (cmds) until the centre of a walker at (x, y) has crossed into the neighbour `n` of tile `c` in direction d. Includes the sideways
 * slide the movement code performs when the hitbox pokes into a lane whose tile beside the target is blocked.
 */
function firstHop(dz, c, n, d, x, y, sp) {
  const cx = c % W;
  const cy = (c - cx) / W;
  let dist;
  let off;
  if (d === 2) { dist = cx + 1 - x; off = y - (cy + 0.5); }
  else if (d === 4) { dist = x - cx; off = y - (cy + 0.5); }
  else if (d === 3) { dist = cy + 1 - y; off = x - (cx + 0.5); }
  else { dist = y - cy; off = x - (cx + 0.5); }
  let j = Math.floor(dist / sp) + 1;
  const lateral = Math.abs(off);
  if (lateral > 0.16) {
    const side = d === 2 || d === 4 ? (off > 0 ? 3 : 1) : (off > 0 ? 2 : 4);
    const beside = NB[n * 4 + side - 1];
    if (beside < 0 || dz.solid[beside] || dz.hold[beside] > 0) j += Math.ceil((lateral - 0.16) / sp);
  }
  return j;
}

class Reach {
  constructor() {
    this.arr = new Float64Array(N);               // tick at which the walker's centre enters the tile (INF: unreachable)
    this.par = new Int16Array(N);
    this.hold = new Float64Array(N);              // when the route deliberately waits before entering the tile: the earliest entry tick
    this.list = new Int16Array(N);                // reached tiles in discovery order, the start first
    this.n = 0;
    this.start = 0;
    this._queue = [];
  }

  /**
   * Earliest arrival at every tile for a walker standing at (x, y). A step is allowed when the tile it enters is not lethal while the
   * walker crosses it (plus `margin` ticks each side and `slack` more ticks after it); the walker may wait on a tile that stays safe
   * to let a flame die out. Fleeing uses no slack, a calm walk keeps a comfortable distance from every flame to come.
   */
  run(dz, T, x, y, speed, margin, slack = 0) {
    const sp = speed * DT;
    const inv = 1 / sp;
    const { arr, par, list } = this;
    const q = this._queue;
    arr.fill(INF);
    par.fill(-1);
    const c = Math.floor(y) * W + Math.floor(x);
    this.start = c;
    arr[c] = T;
    list[0] = c;
    this.n = 1;
    q.length = 0;

    for (let d = 1; d <= 4; d++) {
      const n = NB[c * 4 + d - 1];
      if (n < 0 || dz.solid[n]) continue;
      const t = T + firstHop(dz, c, n, d, x, y, sp);
      if (dz.hits(c, T + 1, t - 1 + margin)) continue;
      this._relax(c, n, this._settle(dz, T, c, n, t, T + 1, margin, inv, slack));
    }
    for (let qi = 0; qi < q.length; qi++) {
      const m = q[qi];
      const tm = arr[m];
      for (let d = 1; d <= 4; d++) {
        const n = NB[m * 4 + d - 1];
        if (n < 0 || dz.solid[n] || n === par[m]) continue;
        this._relax(m, n, this._settle(dz, T, m, n, tm + inv, tm - margin, margin, inv, slack));
      }
    }
  }

  /** The arrival tick at `n` (>= t) that clears every lethal interval, waiting on `m` if that is safe; -1 when there is none. */
  _settle(dz, T, m, n, t, mFrom, margin, inv, slack) {
    this._held = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (t - T > HORIZON) return -1;
      let e = dz.blockEnd(n, t - margin, t + inv - 1 + margin + slack);
      if (dz.hold[n] >= t - margin && dz.hold[n] > e) e = dz.hold[n];              // a bomb sits there until it goes off
      if (e < 0) return t;
      if (e >= INF) return -1;
      const nt = e + 1 + margin;
      if (nt - t > MAX_WAIT || dz.hits(m, mFrom, nt - 1 + margin)) return -1;
      t = nt;
      this._held = nt;
    }
    return -1;
  }

  _relax(m, n, at) {
    if (at < 0 || n === this.start || at >= this.arr[n] - 1e-9) return;
    if (this.arr[n] === INF) this.list[this.n++] = n;
    this.arr[n] = at;
    this.hold[n] = this._held;
    this.par[n] = m;
    this._queue.push(n);
  }

  /** Can a walker that arrives on tile i stay there? */
  restOK(dz, i, margin) {
    const a = this.arr[i];
    return a < INF && dz.rest[i] <= a - margin && dz.land[i] - a >= dz.sdNear;
  }
}

// ------------------------------------------------------------------------------------------------
// BotBrain
// ------------------------------------------------------------------------------------------------

const idle = () => ({ d: 0, b: 0, x: 0 });

/** Soft blocks a bomb of `range` on tile `i` would open (the first block of each arm). */
function blocksHit(grid, i, range) {
  let n = 0;
  for (let d = 1; d <= 4; d++) {
    let j = i;
    for (let k = 1; k <= range; k++) {
      j = NB[j * 4 + d - 1];
      if (j < 0) break;
      const c = grid[j];
      if (c === '#' || c === 'X') break;
      if (c === '+') { n++; break; }
    }
  }
  return n;
}

/**
 * Where the World lands a bomb thrown from tile (cx, cy) towards `dir` (docs/SPEC.md §3.6b): three tiles away, then farther out to the edge of
 * the board, then two, one, none. A tile qualifies when it is floor without another bomb (or another bomb's landing).
 */
function throwDestination(grid, bombs, cx, cy, dir, bomb) {
  const dx = DIR_DX[dir];
  const dy = DIR_DY[dir];
  const free = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H || grid[ty * W + tx] !== '.') return false;
    for (const o of bombs) {
      if (o === bomb) continue;
      if (o.fly ? o.fly.tx === tx && o.fly.ty === ty : o.tx === tx && o.ty === ty) return false;
    }
    return true;
  };
  for (let dist = THROW_DIST; cx + dx * dist >= 0 && cy + dy * dist >= 0 && cx + dx * dist < W && cy + dy * dist < H; dist++) {
    if (free(cx + dx * dist, cy + dy * dist)) return (cy + dy * dist) * W + cx + dx * dist;
  }
  for (let dist = THROW_DIST - 1; dist >= 0; dist--) {
    if (free(cx + dx * dist, cy + dy * dist)) return (cy + dy * dist) * W + cx + dx * dist;
  }
  return bomb.ty * W + bomb.tx;
}

/** Ticks until the centre of a walker at (x, y) has crossed the boundary of tile `c` in direction d. */
function ticksToCross(c, d, x, y, sp) {
  const dist = d === 2 ? (c % W) + 1 - x : d === 4 ? x - (c % W) : d === 3 ? Math.floor(c / W) + 1 - y : y - Math.floor(c / W);
  return Math.floor(dist / sp) + 1;
}

export class BotBrain {
  /** @param {{ level?: 'easy'|'normal'|'hard', seed?: number }} [opts] */
  constructor({ level = 'normal', seed = 0 } = {}) {
    this.level = PROFILES[level] ? level : 'normal';
    this.prof = PROFILES[this.level];
    this.rng = makeRng(seed);

    this.dz = new DangerMap();                    // the board as it is
    this.dzH = new DangerMap();                   // the board plus one hypothetical bomb
    this.dz.sdNear = this.dzH.sdNear = this.prof.sdNear;
    this.sr = new Reach();                        // our own reach on `dz`
    this.srH = new Reach();                       // our escape on `dzH`
    this.srE = new Reach();                       // an enemy's reach, for trap checks

    this.path = new Int16Array(N);
    this.pathHold = new Float64Array(N);          // per path tile: the earliest tick to enter it when the route waits for a flame, else 0
    this.pathLen = 0;
    this.pathPos = 0;
    this.planned = false;                         // a plan exists (it may be "stand still") and is valid until `planAt`
    this.planAt = 0;
    this.goal = { kind: '', tile: -1 };
    this.status = 'idle';                         // what the bot is up to, for tools
    this.dzTick = -1;
    this.sig = 0;
    this.changed = false;
    this.threatAt = -1;
    this.bombNext = 0;                            // tick before which no new bomb check runs
    this.trapNext = 0;                            // ... and no new search for a trap spot
    this.banned = new Int32Array(N);              // bomb spots that failed the escape check, banned until this tick
    this.anchor = -1;                             // stall breaker: where we were, and since when
    this.anchorAt = 0;
    this.urge = 0;                                // stall breaker: a risk-free action is wanted
    this.act = 0;                                 // bit 1: place a bomb this tick, bit 2: use the glove
    this.actDir = 0;                              // direction to press together with the action
    this.kickDir = 0;                             // keep pressing this way until the bomb in front has been kicked
    this.kickBomb = -1;
    this.kickUntil = 0;
    this.foes = [];
    this.allies = [];
    this.sim = { id: 0, x: 0, y: 0, facing: 0, moving: false, speedLv: 0, curse: null };
    this.env = null;
    this.envWorld = null;
    this._pool = [];
    this._seen = new Uint8Array(N);
    this._held = new Uint8Array(N);               // sudden death: tiles a rival holds
    this._mine = new Int32Array(N);               // sudden death: steps from us / from the nearest rival to each tile, and who that rival is
    this._rivalDist = new Int32Array(N);
    this._owner = new Int32Array(N);
    this._queue = [];
    this._track = new Map();                      // rival id -> { tile, since }: how long it has stood where it is
    this.tile = -1;                               // the tile we are on, and since when
    this.tileSince = 0;
    this._bombList = [];
    this._verdict = { safe: false, kill: false };
    this._victims = [];                           // enemies the bomb under evaluation would trap
  }

  /**
   * @param {import('./world.js').World} world
   * @param {number} playerId
   * @returns {{ d: number, b: number, x: number }} a fresh cmd body; the Room stamps `s`
   */
  think(world, playerId) {
    const me = world.player(playerId);
    if (!me || !me.alive || me.removed || world.state !== STATE.PLAYING) return idle();
    const T = world.tickNo;
    if (this.envWorld !== world) {
      this.envWorld = world;
      this.env = makeEnv(world.grid, world.bombs, W, H);
    }
    this._observe(world, T);
    if (this._needsPlan(T)) this._plan(world, me, T);
    return this._act(world, me, T);
  }

  // ---- Observing ------------------------------------------------------------------------------

  /** Rebuilds the danger map when the board changed (a signature of everything that moves a flame). */
  _observe(world, T) {
    let h = world.gridVer | 0;
    h = (Math.imul(h, 31) + world.flames.length) | 0;
    h = (Math.imul(h, 31) + world.falling.length) | 0;
    for (const b of world.bombs) {
      h = (Math.imul(h, 31) + b.id) | 0;
      h = (Math.imul(h, 31) + b.tx + b.ty * 32 + b.dir * 1024 + (b.fly ? 8192 : 0)) | 0;
    }
    this.changed = h !== this.sig;
    if (this.changed || T - this.dzTick >= (world.suddenDeath ? 3 : REBUILD_EVERY)) {
      this.sig = h;
      this.dzTick = T;
      this.dz.build(world);
      if (this.prof.skull < 0) this._avoidSkulls(world, this.dz);
    }
  }

  /** Cautious bots treat a skull as a wall (a step on it is a pickup); desperate plans ignore that. */
  _avoidSkulls(world, dz) {
    for (const it of world.items) if (it.kind === 'skull') dz.solid[it.ty * W + it.tx] = 1;
  }

  _needsPlan(T) {
    return !this.planned || T >= this.planAt || (this.changed && this.prof.instant);
  }

  /** Enemies and allies of `me`: in FFA everybody else is an enemy, in team mode the other team is. */
  _sortPlayers(world, me) {
    const foes = this.foes;
    const allies = this.allies;
    foes.length = 0;
    allies.length = 0;
    const teams = world.mode === 'teams';
    const T = world.tickNo;
    for (const o of world.players) {
      if (o === me || !o.alive || o.removed) continue;
      if (teams && o.team === me.team) allies.push(o);
      else foes.push(o);
      const tile = tileOf(o);
      const rec = this._track.get(o.id);
      if (!rec) this._track.set(o.id, { tile, since: T });
      else if (rec.tile !== tile) { rec.tile = tile; rec.since = T; }
    }
  }

  // ---- Planning -------------------------------------------------------------------------------

  _plan(world, me, T) {
    const prof = this.prof;
    const c = tileOf(me);
    const threatened = !this._safeHere(c, T);
    this.sr.run(this.dz, T, me.x, me.y, effectiveSpeed(me), prof.margin, threatened ? 0 : prof.near + 10);
    this.planned = true;
    this.planAt = T + prof.interval;
    this.pathLen = 0;
    this.pathPos = 0;
    this.act = 0;
    this.actDir = 0;
    if (c !== this.tile) {
      this.tile = c;
      this.tileSince = T;
    }
    this._sortPlayers(world, me);
    this._markHeld(world, me, T);
    this._trackProgress(world, T, c);

    if (world.suddenDeath && prof.camp && this._trySeal(world, me, T, c)) return;
    if (this._held[c] && this._giveWay(me, T)) return;
    if (threatened) {
      this.kickDir = 0;
      if (this.threatAt < 0) this.threatAt = T + (prof.react > 0 ? this.rng.int(prof.react) : 0);
      if (T < this.threatAt) {                    // easy bots take a moment to notice; look again as soon as they have
        this.status = 'startled';
        this.planAt = this.threatAt;
        return;
      }
      this._planFlee(world, me, T);
      return;
    }
    this.threatAt = -1;
    if (prof.mistake > 0 && this.rng.next() < prof.mistake) {
      this._planWander(me, T, 1, 4, 'mistake');
      return;
    }
    if (prof.shun && this._shunCursed(me, T, c)) return;
    if (this._planOffence(world, me, T, c)) return;
    this._planGoal(world, me, T, c);
  }

  /**
   * Sudden death, last stand: a bomb on the tile that lands last is solid to everybody who is not already standing on it, and it is
   * removed unexploded when the tile lands. Alone on that tile, the bot shuts the door on rivals who would share it.
   */
  _trySeal(world, me, T, c) {
    const { dz } = this;
    const left = dz.land[c] - T;
    if (left > SEAL_WINDOW || left < 12 || !this._canBomb(world, me, c) || this.foes.length === 0) return false;
    for (let i = 0; i < N; i++) if (world.grid[i] !== '#' && world.grid[i] !== 'X' && dz.land[i] > dz.land[c]) return false;    // not the last tile
    const tx = c % W;
    const ty = (c - tx) / W;
    for (const e of this.foes) if (overlapsTile(e, tx, ty)) return false;
    this.act |= 1;
    this.status = 'seal';
    this.planAt = T + 4;
    return true;
  }

  /**
   * Is nothing going to be lethal on tile c soon? "Soon" is the level's `near`: a careful bot leaves a zone that will burn at once, a
   * carefree one carries on until the flames are close. (Routes keep `near` + 10 ticks clear of every flame, so the two never disagree.)
   */
  _safeHere(c, T) {
    return this.dz.nextFlame(c, T + 1) - T > this.prof.near && this.dz.land[c] - T > this.prof.sdNear;
  }

  /** Stall breaker: standing around in one corner of the board for too long asks for a risk-free action. */
  _trackProgress(world, T, c) {
    if (this.anchor < 0 || manhattan(c, this.anchor) > 2) {
      this.anchor = c;
      this.anchorAt = T;
      this.urge = 0;
    } else if (T - this.anchorAt > this.prof.stall && !world.suddenDeath && !(world.timeLeft > 0 && world.timeLeft <= PRE_SD_TICKS)) {
      this.urge = 1;
      this.anchorAt = T;
    }
  }

  // ---- Fleeing --------------------------------------------------------------------------------

  /** Leave a tile that is going to burn: the best safe tile we can reach in time. */
  _planFlee(world, me, T) {
    const { dz, sr, prof } = this;
    const sp = effectiveSpeed(me) * DT;
    let best = -1;
    let bestScore = -INF;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      if (!sr.restOK(dz, i, prof.margin) || this._held[i]) continue;
      const steps = (sr.arr[i] - T) * sp;
      let s = -steps + 0.4 * dz.openCount(i) - 0.5 * dz.hazardCount(i);
      if (prof.careful > 0) {
        s -= 1.5 * Math.max(0, steps + 2 - this._foeDistance(i));                  // a rival who gets there first can seal the way out
        if (this._inPocket(i, sr.par[i])) s -= 3;
      }
      if (this.goal.kind === 'flee' && this.goal.tile === i) s += 1.5;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best < 0) {
      if (prof.skull < 0 && this._skullsInTheWay(world)) this._planFleeThroughSkulls(world, me, T);
      else this._planPanic(world, me, T);
      return;
    }
    this.goal.kind = 'flee';
    this.goal.tile = best;
    this.status = 'flee';
    this._setPath(best);
  }

  _skullsInTheWay(world) {
    for (const it of world.items) if (it.kind === 'skull') return true;
    return false;
  }

  /** A careful bot only steps on a skull when nothing else saves it. */
  _planFleeThroughSkulls(world, me, T) {
    const { dz, sr, prof } = this;
    dz.build(world);
    sr.run(dz, T, me.x, me.y, effectiveSpeed(me), prof.margin);
    let best = -1;
    let bestArr = INF;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      if (sr.restOK(dz, i, prof.margin) && sr.arr[i] < bestArr) { bestArr = sr.arr[i]; best = i; }
    }
    if (best < 0) { this._planPanic(world, me, T); return; }
    this.goal.kind = 'flee';
    this.goal.tile = best;
    this.status = 'flee';
    this._setPath(best);
  }

  /** No safe tile is reachable: buy as much time as possible, the board may change (a bomb gets kicked away, a flame ends). */
  _planPanic(world, me, T) {
    const { dz, sr, prof } = this;
    const sp = effectiveSpeed(me) * DT;
    const c = tileOf(me);
    if (prof.glove && me.glove && this._tryThrow(world, me, T, c)) return;             // the last resorts of a bot with no way out
    if (prof.kick && me.kick && this._tryKick(world, me, T, c)) return;
    let best = -1;
    let bestAt = -1;
    for (let k = 0; k < sr.n; k++) {
      const i = sr.list[k];
      if (!prof.camp && (sr.arr[i] - T) * sp > 2) continue;      // a bot that does not plan for the last stand only looks a tile or two around
      if (this._held[i] && i !== c) continue;
      const at = dz.nextLethal(i, sr.arr[i]);
      if (at > bestAt) { bestAt = at; best = i; }
    }
    this.goal.kind = 'panic';
    this.goal.tile = best;
    this.status = 'panic';
    if (best >= 0) this._setPath(best);
  }

  /**
   * Would standing on `goal` (entered from `entry`) leave us in a dead-end pocket that a rival could seal with one bomb? A pocket is a
   * region of at most POCKET tiles behind `entry`; it only matters while a rival with a free bomb is near its mouth.
   */
  _inPocket(goal, entry) {
    if (this.prof.careful === 0 || entry < 0) return false;
    let rival = false;
    for (const e of this.foes) if (manhattan(tileOf(e), entry) <= POCKET_RIVAL && e.curse !== 'nobomb') { rival = true; break; }
    if (!rival) return false;
    const seen = this._seen;
    seen.fill(0);
    seen[goal] = 1;
    seen[entry] = 1;
    const queue = this._pool;
    queue.length = 0;
    queue.push(goal);
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi];
      for (let d = 0; d < 4; d++) {
        const n = NB[t * 4 + d];
        if (n < 0 || seen[n] || this.dz.solid[n] || this.dz.hold[n] > 0) continue;
        seen[n] = 1;
        queue.push(n);
        if (queue.length > POCKET) return false;
      }
    }
    return true;
  }

  /** Distance from tile i to the nearest enemy (99 when there is none); `spareVictims` leaves out the ones a bomb is about to trap. */
  _foeDistance(i, spareVictims = false) {
    let best = 99;
    for (const e of this.foes) {
      if (spareVictims && this._victims.includes(e)) continue;
      const d = manhattan(i, tileOf(e));
      if (d < best) best = d;
    }
    return best;
  }

  _setPath(goalTile) {
    const { sr, path } = this;
    let len = 0;
    for (let i = goalTile; i >= 0 && len < N; i = sr.par[i]) {
      path[len++] = i;
      if (i === sr.start) break;
    }
    for (let a = 0, b = len - 1; a < b; a++, b--) {
      const t = path[a];
      path[a] = path[b];
      path[b] = t;
    }
    for (let k = 0; k < len; k++) this.pathHold[k] = sr.hold[path[k]];
    this.pathLen = len;
    this.pathPos = 0;
  }

  // ---- Offence: bombs, kicks, throws ------------------------------------------------------------

  _ownedBombs(world, id) {
    let n = 0;
    for (const b of world.bombs) if (b.owner === id) n++;
    return n;
  }

  _hasBombs(world, me) {
    return me.curse !== 'nobomb' && this._ownedBombs(world, me.id) < me.bombsMax;
  }

  _canBomb(world, me, c) {
    if (!this._hasBombs(world, me) || world.grid[c] !== '.') return false;
    const tx = c % W;
    const ty = (c - tx) / W;
    for (const b of world.bombs) if (!b.fly && b.tx === tx && b.ty === ty) return false;
    return true;
  }

  _planOffence(world, me, T, c) {
    if (me.curse === 'spam' && this._planSpam(world, me, T, c)) return true;
    if (this.prof.glove && me.glove && this._tryThrow(world, me, T, c)) return true;
    if (this.prof.kick && me.kick && this._tryKick(world, me, T, c)) return true;
    return this._tryBomb(world, me, T, c);
  }

  /** The flames of a bomb of `range` on (tx, ty), with the real bomb `without` taken off the board. */
  _blastAt(world, tx, ty, range, without) {
    const list = this._bombList;
    list.length = 0;
    for (const b of world.bombs) if (b.id !== without) list.push(b);
    const mine = { id: HYP_ID, tx, ty, range, fly: null };
    list.push(mine);
    return computeBlast(world.grid, list, mine);
  }

  /**
   * Drop a bomb on the tile we stand on when it pays (soft blocks opened, an enemy under the flames, an enemy with no way out) and an
   * escape route is proven even with that bomb on the board.
   */
  _tryBomb(world, me, T, c) {
    const prof = this.prof;
    if (T < this.bombNext || !this._canBomb(world, me, c)) return false;
    if (this.dz.hits(c, T + 1, T + FLAME_TICKS)) return false;

    const blast = this._blastAt(world, c % W, Math.floor(c / W), me.range, -1);

    let value = Math.min(blast.blocks.length, BLOCK_CAP) * BLOCK_VALUE;
    let near = false;
    for (const e of this.foes) {
      const ei = tileOf(e);
      const dist = manhattan(ei, c);
      if (dist <= prof.sight && blast.tiles.some((t) => t[1] * W + t[0] === ei)) value += ENEMY_HIT_VALUE;
      if (dist <= TRAP_RANGE) near = true;
    }
    for (const a of this.allies) {
      const ai = tileOf(a);
      if (blast.tiles.some((t) => t[1] * W + t[0] === ai)) value -= ALLY_HIT_PENALTY;
    }
    const wantKill = prof.trap && near;
    const need = this.urge ? 0 : 1;
    if (value < need && !wantKill) return false;
    const lastStand = prof.camp && (world.suddenDeath || (world.timeLeft > 0 && world.timeLeft <= PRE_SD_TICKS));

    this.bombNext = T + 8;
    const verdict = this._evaluateBomb(world, me, T, c, 0, wantKill);
    if (!verdict.safe) {
      this.bombNext = T + 30;
      this.banned[c] = T + 90;                    // do not wait around here: try another spot
      return false;
    }
    if (lastStand && !verdict.kill) return false;                // a camper leaves its pocket for a sure kill only
    if (verdict.kill) value += KILL_VALUE;
    if (value < need) return false;
    this.act |= 1;
    this.status = verdict.kill ? 'trap' : 'bomb';
    this.urge = 0;
    this.anchor = -1;
    this.planAt = T + 1;                          // next tick: flee from the bomb we just planted
    return true;
  }

  /**
   * Puts a hypothetical bomb of ours on `tile` (dropped `delay` ticks from now) on the board and answers: can we still get to a tile
   * that is safe to rest on (`safe`), and does an enemy end up with no such tile (`kill`)? Leaves the hypothetical map in `dzH`.
   */
  _evaluateBomb(world, me, T, tile, delay, wantKill) {
    const prof = this.prof;
    const verdict = this._verdict;
    verdict.safe = false;
    verdict.kill = false;
    const tx = tile % W;
    const ty = (tile - tx) / W;
    const dz = this.dzH.build(world, [hypothetical(tx, ty, me.range, T + delay)]);
    if (prof.skull < 0) this._avoidSkulls(world, dz);
    const sr = this.srH;
    const speed = effectiveSpeed(me);
    const here = delay === 0 && tile === tileOf(me);
    const x = here ? me.x : tx + 0.5;
    const y = here ? me.y : ty + 0.5;
    sr.run(dz, T + delay, x, y, speed, prof.margin);
    let exits = 0;
    for (let k = 1; k < sr.n; k++) if (sr.restOK(dz, sr.list[k], prof.margin)) exits++;
    if (exits === 0) return verdict;
    const victims = this._victims;
    victims.length = 0;
    if (wantKill) this._trapped(dz, T, victims);
    verdict.kill = victims.length > 0;
    if (exits < (verdict.kill || prof.careful === 0 ? 1 : 2)) { verdict.kill = false; return verdict; }
    if (prof.careful > 1 && !this._escapeIsRobust(dz, T + delay, x, y, speed)) { verdict.kill = false; return verdict; }
    verdict.safe = true;
    return verdict;
  }

  /** Would the escape survive losing any one of the first tiles of the way out (a rival's bomb there)? */
  _escapeIsRobust(dz, t0, x, y, speed) {
    const { srH: sr, prof } = this;
    let target = -1;
    let at = INF;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      if (sr.arr[i] < at && sr.restOK(dz, i, prof.margin)) { at = sr.arr[i]; target = i; }
    }
    if (target < 0) return false;
    const route = this._pool;
    route.length = 0;
    for (let i = target; i >= 0 && i !== sr.start; i = sr.par[i]) route.push(i);
    for (let r = route.length - 1, cut = 0; r >= 0 && cut < 2; r--, cut++) {       // the first two tiles of the route
      const t = route[r];
      if (this._foeDistance(t, true) > SEAL_REACH) continue;                        // nobody is near enough to close that door
      dz.solid[t] = 1;
      sr.run(dz, t0, x, y, speed, prof.margin);
      let alive = false;
      for (let k = 1; k < sr.n && !alive; k++) alive = sr.restOK(dz, sr.list[k], prof.margin);
      dz.solid[t] = 0;
      if (!alive) return false;
    }
    return true;
  }

  /** With `dz` (the hypothetical board): collects the enemies that stand in the flames with no safe tile in reach. */
  _trapped(dz, T, out) {
    for (const e of this.foes) {
      const ei = tileOf(e);
      if (Math.max(e.shield, e.spawnShield) > 100) continue;                                // a shield outlives the bomb
      if (dz.rest[ei] <= T - 1 && dz.land[ei] - T >= SD_NEAR) continue;            // it is not even threatened
      const sr = this.srE;
      sr.run(dz, T, e.x, e.y, effectiveSpeed(e), 1);
      let out1 = false;
      for (let k = 0; k < sr.n && !out1; k++) out1 = sr.restOK(dz, sr.list[k], 1);
      if (!out1) out.push(e);
    }
  }

  // ---- Kick and glove -------------------------------------------------------------------------

  /** The bomb that sits still on tile i (the only kind a fighter can kick or throw). */
  _bombOn(world, i) {
    const tx = i % W;
    const ty = (i - tx) / W;
    for (const b of world.bombs) if (b.tx === tx && b.ty === ty && !b.fly && b.dir === 0) return b;
    return undefined;
  }

  _fighterOn(world, i) {
    const tx = i % W;
    const ty = (i - tx) / W;
    for (const p of world.players) if (p.alive && overlapsTile(p, tx, ty)) return true;
    return false;
  }

  /**
   * What is it worth to have `bomb` explode on `dest` instead of where it is? (A kick puts it there by the time it goes off, a throw
   * `lands` ticks from now.) Rivals under its flames count, a rival with no way out counts a lot, and so does getting ourselves out of
   * a spot with no safe tile. 0 when the change would leave us in danger.
   */
  _relocationValue(world, me, T, bomb, dest, lands) {
    const prof = this.prof;
    const tx = dest % W;
    const ty = (dest - tx) / W;
    const dz = this.dzH.build(world, [hypothetical(tx, ty, bomb.range, T, bomb.fuse, lands)], bomb.id);
    if (prof.skull < 0) this._avoidSkulls(world, dz);
    const c = tileOf(me);
    const wasSafe = this._safeHere(c, T);
    const sr = this.srH;
    sr.run(dz, T, me.x, me.y, effectiveSpeed(me), prof.margin);
    let exits = 0;
    for (let k = 1; k < sr.n; k++) if (sr.restOK(dz, sr.list[k], prof.margin)) exits++;
    const safeNow = dz.rest[c] <= T - prof.margin && dz.land[c] - T >= prof.sdNear;
    if (!safeNow && exits === 0) return 0;

    let value = wasSafe ? 0 : RESCUE_VALUE;
    const blast = this._blastAt(world, tx, ty, bomb.range, bomb.id);
    const victims = this._victims;
    victims.length = 0;
    if (prof.trap) this._trapped(dz, T, victims);
    if (victims.length > 0) value += KILL_VALUE;
    for (const e of this.foes) {
      const ei = tileOf(e);
      if (!victims.includes(e) && blast.tiles.some((t) => t[1] * W + t[0] === ei)) value += ENEMY_HIT_VALUE;
    }
    for (const a of this.allies) {
      const ai = tileOf(a);
      if (blast.tiles.some((t) => t[1] * W + t[0] === ai)) value -= ALLY_HIT_PENALTY;
    }
    return value;
  }

  /** Walk into a bomb next to us so that it slides towards where it does the most good. */
  _tryKick(world, me, T, c) {
    if (this.kickDir !== 0) return true;
    let bestValue = RELOCATE_MIN - 0.01;
    let best = null;
    for (let d = 1; d <= 4; d++) {
      const a = NB[c * 4 + d - 1];
      if (a < 0) continue;
      const bomb = this._bombOn(world, a);
      if (!bomb || bomb.pass.length > 0) continue;
      let run = 0;                                                     // tiles it can slide: floor, no bomb, no fighter in the way
      let dest = a;
      for (let n = NB[dest * 4 + d - 1]; run < 14 && n >= 0 && world.grid[n] === '.' && !this._bombOn(world, n) && !this._fighterOn(world, n); n = NB[dest * 4 + d - 1]) {
        dest = n;
        run++;
      }
      const advances = bomb.fuse > 2 ? Math.floor((bomb.fuse - 2) / KICK_STEP_TICKS) + 1 : 0;
      if (run === 0 || advances === 0) continue;
      let there = a;
      for (let k = Math.min(run, advances); k > 0; k--) there = NB[there * 4 + d - 1];
      const value = this._relocationValue(world, me, T, bomb, there, 0);
      if (value > bestValue) { bestValue = value; best = { d, id: bomb.id }; }
    }
    if (!best) return false;
    this.kickDir = best.d;
    this.kickBomb = best.id;
    this.kickUntil = T + KICK_PATIENCE;
    this.status = 'kick';
    this.planAt = T + 2;
    return true;
  }

  /** Pick a bomb up (the one under us, or next to us if we cannot kick it instead) and throw it where it does the most good. */
  _tryThrow(world, me, T, c) {
    let bestValue = RELOCATE_MIN - 0.01;
    let best = null;
    const consider = (bomb, w) => {
      const dest = throwDestination(world.grid, world.bombs, c % W, Math.floor(c / W), w, bomb);
      if (dest === bomb.ty * W + bomb.tx) return;
      const value = this._relocationValue(world, me, T, bomb, dest, THROW_TICKS);
      if (value > bestValue) { bestValue = value; best = w; }
    };
    const under = this._bombOn(world, c);
    for (let w = 1; w <= 4; w++) {
      if (under) consider(under, w);
      const a = NB[c * 4 + w - 1];
      const front = a >= 0 && !me.kick ? this._bombOn(world, a) : undefined;      // with a kick, walking into a bomb kicks it
      if (front) consider(front, w);
    }
    if (best === null) return false;
    this.act |= 2;
    this.actDir = best;
    this.status = 'throw';
    this.planAt = T + 2;
    return true;
  }

  /** The `spam` curse drops a bomb every SPAM_INTERVAL ticks wherever we stand: make sure that place is one we can leave. */
  _planSpam(world, me, T, c) {
    const due = Math.max(1, me.spamCd);
    if (due > SPAM_LOOK || !this._hasBombs(world, me)) return false;
    const { dz, sr, prof } = this;
    if (this._evaluateBomb(world, me, T, c, due, false).safe) return false;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      if (sr.arr[i] - T > due + 12 || !sr.restOK(dz, i, prof.margin) || !this._canBombTile(world, i)) continue;
      if (this._evaluateBomb(world, me, T, i, Math.max(due, Math.ceil(sr.arr[i] - T)), false).safe) {
        this.goal.kind = 'spam';
        this.goal.tile = i;
        this.status = 'spam';
        this._setPath(i);
        return true;
      }
    }
    return false;
  }

  // ---- Goals ----------------------------------------------------------------------------------

  _itemValue(me, kind) {
    return this._baseItemValue(me, kind) * (this.prof.itemBias[kind] ?? 1);
  }

  _baseItemValue(me, kind) {
    switch (kind) {
      case 'bomb': return me.bombsMax >= MAX_BOMBS ? 0.2 : ITEM_VALUE.bomb * (me.bombsMax >= 5 ? 0.5 : 1);
      case 'flame': return me.range >= MAX_RANGE ? 0.2 : ITEM_VALUE.flame * (me.range >= 7 ? 0.5 : 1);
      case 'speed': return me.speedLv >= MAX_SPEED_LV ? 0.2 : ITEM_VALUE.speed * (me.speedLv >= 4 ? 0.6 : 1);
      case 'kick': return me.kick ? 0.2 : ITEM_VALUE.kick;
      case 'glove': return me.glove ? 0.2 : ITEM_VALUE.glove;
      case 'shield': return me.shield > 120 ? 0.3 : ITEM_VALUE.shield;
      case 'skull': return ITEM_VALUE.skull * this.prof.skull;
      default: return 0;
    }
  }

  _planGoal(world, me, T, c) {
    const { dz, sr, prof } = this;
    const sp = effectiveSpeed(me) * DT;
    const stepsTo = (i) => (sr.arr[i] - T) * sp;
    let bestScore = 0;
    let bestTile = -1;
    let bestKind = '';
    const consider = (tile, kind, score) => {
      if (this.goal.tile === tile && this.goal.kind === kind) score *= STICK;
      if (score > bestScore) { bestScore = score; bestTile = tile; bestKind = kind; }
    };

    for (const it of world.items) {
      const i = it.ty * W + it.tx;
      if (i === c || !sr.restOK(dz, i, prof.margin)) continue;
      const steps = stepsTo(i);
      const v = this._itemValue(me, it.kind);
      if (steps > prof.itemSteps || v <= 0 || this._inPocket(i, sr.par[i])) continue;
      consider(i, 'item', v / (1 + 0.2 * steps));
    }

    let blocksLeft = 0;
    for (let i = 0; i < N; i++) if (world.grid[i] === '+') blocksLeft++;
    if (blocksLeft > 0 && me.curse !== 'nobomb') {
      let seen = 0;
      for (let k = 0; k < sr.n && seen < 40; k++) {
        const i = sr.list[k];
        if (i === c || !sr.restOK(dz, i, prof.margin) || this.banned[i] > T) continue;
        seen++;
        const g = blocksHit(world.grid, i, me.range);
        if (g === 0 || this._inPocket(i, sr.par[i])) continue;
        consider(i, 'block', (Math.min(g, BLOCK_CAP) * BLOCK_VALUE + 0.4) / (1 + 0.2 * stepsTo(i)));
      }
    }

    if (prof.hunt > 0 && me.curse !== 'nobomb') {
      const keen = prof.hunt * Math.min(1, Math.max(0.25, (30 - blocksLeft) / 30));      // the emptier the board, the more the rivals matter
      for (const e of this.foes) {
        const ei = tileOf(e);
        if (manhattan(ei, c) > prof.sight + 8) continue;
        let near = -1;
        let nearCost = INF;
        let keep = -1;
        let keepCost = INF;
        for (let k = 1; k < sr.n; k++) {
          const i = sr.list[k];
          if (!sr.restOK(dz, i, prof.margin)) continue;
          const cost = manhattan(i, ei) * 3 + stepsTo(i);
          if (cost < nearCost) { nearCost = cost; near = i; }
          if (this.goal.kind === 'hunt' && i === this.goal.tile) { keep = i; keepCost = cost; }
        }
        if (keep >= 0 && keepCost <= nearCost + HUNT_SLACK) near = keep;          // the rival moved a little: do not swerve after it
        if (near >= 0 && near !== c) consider(near, 'hunt', keen / (1 + 0.15 * stepsTo(near)));
      }
    }

    if (prof.trap && T >= this.trapNext) {
      this.trapNext = T + 9;
      const spot = this._findTrapSpot(world, me, T, c);
      if (spot >= 0) consider(spot, 'trap', 60);
    }

    if (prof.camp && (world.suddenDeath || (world.timeLeft > 0 && world.timeLeft <= PRE_SD_TICKS))) {
      const spot = this._campSpot(me, T);
      if (spot === c) {                           // already on the tile we can hold: stay
        this.goal.kind = 'camp';
        this.goal.tile = c;
        this.status = 'camp';
        return;
      }
      if (spot >= 0) consider(spot, 'camp', 50);
    }

    if (bestTile < 0) {
      this._planWander(me, T, 3, 9, 'wander');
      return;
    }
    this.goal.kind = bestKind;
    this.goal.tile = bestTile;
    this.status = bestKind;
    this._setPath(bestTile);
  }

  /**
   * Sudden death, the last stand: which tiles are not ours to take? Every level follows the same convention, so that the survivors do
   * not all pile onto the last tile and go down together:
   *  - a tile belongs to the bot that is closest to it, but a rival that is only one step closer does not shut us out (we may still
   *    win the race, and yielding that much cost 1v1 endings against a random walker): it counts as held only when the rival is at
   *    least two steps closer, or one step closer with the lower id. Two bots on one tile: the one that got there first stays;
   *  - a rival that has stood still on a tile for a while holds it.
   */
  _markHeld(world, me, T) {
    const held = this._held;
    held.fill(0);
    if (!world.suddenDeath) return;
    const here = tileOf(me);
    this._distances(this._mine, [here], this.dz);
    const sources = this._pool;
    sources.length = 0;
    for (const e of this.foes) sources.push(tileOf(e));
    const rival = this._rivalDist;
    const owner = this._owner;
    rival.fill(INF);
    owner.fill(INF);
    const queue = this._queue;
    queue.length = 0;
    this.foes.forEach((e, k) => {
      const i = sources[k];
      if (rival[i] === INF) { rival[i] = 0; owner[i] = e.id; queue.push(i); }
    });
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi];
      for (let d = 0; d < 4; d++) {
        const n = NB[t * 4 + d];
        if (n < 0 || this.dz.solid[n] || rival[n] !== INF) continue;
        rival[n] = rival[t] + 1;
        owner[n] = owner[t];
        queue.push(n);
      }
    }
    for (let i = 0; i < N; i++) {
      if (i === here) continue;
      if (rival[i] + 1 < this._mine[i] || (rival[i] + 1 === this._mine[i] && owner[i] < me.id)) held[i] = 1;
    }
    for (const e of this.foes) {
      const i = tileOf(e);
      const since = this._stillSince(e, T);
      if (i === here) {
        if (since < this.tileSince || (since === this.tileSince && e.id < me.id)) held[i] = 1;      // it was here first
      } else if (T - since >= HOLD_TICKS) {
        held[i] = 1;
      }
    }
  }

  /** Steps from the tiles in `from` to every tile over floor without walls, blocks or moving bombs (INF: unreachable). */
  _distances(out, from, dz) {
    out.fill(INF);
    const queue = this._queue;
    queue.length = 0;
    for (const i of from) {
      out[i] = 0;
      queue.push(i);
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi];
      for (let d = 0; d < 4; d++) {
        const n = NB[t * 4 + d];
        if (n < 0 || dz.solid[n] || out[n] !== INF) continue;
        out[n] = out[t] + 1;
        queue.push(n);
      }
    }
  }

  /** Sharing a tile with a rival who has more right to it (sudden death): walk to the free tile that lands latest, however soon that is. */
  _giveWay(me, T) {
    const { dz, sr } = this;
    let best = -1;
    let bestLand = -1;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      if (this._held[i]) continue;
      const land = dz.land[i] >= INF ? T + 4000 : dz.land[i];
      if (land > bestLand) { bestLand = land; best = i; }
    }
    if (best < 0) return false;
    this.goal.kind = 'camp';
    this.goal.tile = best;
    this.status = 'camp';
    this._setPath(best);
    return true;
  }

  /** The tile that lands latest among those we can reach and that no rival holds. */
  _campSpot(me, T) {
    const { dz, sr, prof } = this;
    const held = this._held;
    let best = -1;
    let bestLand = -1;
    for (let k = 0; k < sr.n; k++) {
      const i = sr.list[k];
      if (!sr.restOK(dz, i, prof.margin) || held[i]) continue;
      const land = dz.land[i] >= INF ? T + 4000 : dz.land[i];
      if (land > bestLand) { bestLand = land; best = i; }
    }
    return best;
  }

  /**
   * A cursed player passes its curse on to whoever it touches (CURSE_TOUCH_RADIUS, 0.7 tiles). A healthy bot keeps its distance from
   * anybody who carries one and can hand it over: it walks to the safe tile within reach that is farthest from them.
   */
  _shunCursed(me, T, c) {
    if (me.curse !== null) return false;
    let carrier = null;
    for (const e of this.foes.concat(this.allies)) {
      if (e.curse !== null && e.curseCooldown === 0 && manhattan(tileOf(e), c) <= SHUN_RANGE) { carrier = e; break; }
    }
    if (!carrier) return false;
    const { dz, sr, prof } = this;
    const sp = effectiveSpeed(me) * DT;
    const from = tileOf(carrier);
    let best = -1;
    let bestScore = manhattan(c, from) * 2;                                    // only move if it gets us clearly farther away
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      const steps = (sr.arr[i] - T) * sp;
      if (steps > 4 || !sr.restOK(dz, i, prof.margin)) continue;
      const score = manhattan(i, from) * 2 - steps * 0.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return false;
    this.goal.kind = 'shun';
    this.goal.tile = best;
    this.status = 'shun';
    this._setPath(best);
    return true;
  }

  /** Since when has this rival been standing on its tile? (Updated by _sortPlayers.) */
  _stillSince(e, T) {
    const rec = this._track.get(e.id);
    return rec ? rec.since : T;
  }

  /** A tile within a few steps where a bomb of ours would leave a nearby enemy nowhere to go, or -1. */
  _findTrapSpot(world, me, T, c) {
    const { dz, sr, prof } = this;
    if (!this._hasBombs(world, me)) return -1;
    const sp = effectiveSpeed(me) * DT;
    let tried = 0;
    for (const e of this.foes) {
      const ei = tileOf(e);
      if (manhattan(ei, c) > TRAP_RANGE + 3) continue;
      const er = this.srE;
      er.run(dz, T, e.x, e.y, effectiveSpeed(e), 1);
      let free = 0;
      for (let k = 0; k < er.n; k++) if (er.restOK(dz, er.list[k], 1)) free++;
      if (free > TRAP_ROOM) continue;                                  // too much room for a single bomb to matter
      for (let k = 1; k < sr.n && tried < 6; k++) {
        const i = sr.list[k];
        const steps = (sr.arr[i] - T) * sp;
        if (steps > 6 || manhattan(i, ei) > me.range + 2 || !sr.restOK(dz, i, prof.margin) || !this._canBombTile(world, i)) continue;
        tried++;
        const verdict = this._evaluateBomb(world, me, T, i, Math.ceil(sr.arr[i] - T), true);
        if (verdict.kill) return i;
      }
    }
    return -1;
  }

  _canBombTile(world, i) {
    if (world.grid[i] !== '.') return false;
    const tx = i % W;
    const ty = (i - tx) / W;
    for (const b of world.bombs) if (b.tx === tx && b.ty === ty) return false;
    return true;
  }

  /** Walk to a random safe tile `minSteps`..`maxSteps` tiles away. */
  _planWander(me, T, minSteps, maxSteps, status) {
    const { dz, sr, prof } = this;
    const sp = effectiveSpeed(me) * DT;
    const pool = this._pool;
    pool.length = 0;
    for (let k = 1; k < sr.n; k++) {
      const i = sr.list[k];
      const steps = (sr.arr[i] - T) * sp;
      if (steps >= minSteps && steps <= maxSteps && sr.restOK(dz, i, prof.margin)) pool.push(i);
    }
    this.goal.kind = status;
    this.status = status;
    if (pool.length === 0) {
      this.goal.tile = -1;
      return;
    }
    this.goal.tile = pool[this.rng.int(pool.length)];
    this._setPath(this.goal.tile);
  }

  // ---- Acting ---------------------------------------------------------------------------------

  _act(world, me, T) {
    let want = this._steer(world, me);
    let b = 0;
    let x = 0;
    if (this.act & 1) { b = 1; want = 0; }
    if (this.act & 2) { x = 1; want = this.actDir; }
    this.act = 0;
    const d = this._finalDir(world, me, T, want);
    return { d, b, x };
  }

  /** The direction (1..4) that follows the planned path from where we are, 0 when we are there. */
  _steer(world, me) {
    if (this.kickDir !== 0) {                                   // keep pushing until the bomb has budged
      const bomb = world.bombs.find((o) => o.id === this.kickBomb);
      if (bomb && bomb.dir === 0 && !bomb.fly && world.tickNo < this.kickUntil) return this.kickDir;
      this.kickDir = 0;
      this.planned = false;
    }
    if (this.pathLen === 0) return this._centre(world, me);
    const c = tileOf(me);
    if (this.path[this.pathPos] !== c) {
      let found = -1;
      for (let k = 0; k < this.pathLen; k++) if (this.path[k] === c) { found = k; break; }
      if (found < 0) { this.planned = false; return 0; }        // knocked off the route
      this.pathPos = found;
    }
    if (this.pathPos >= this.pathLen - 1) return this._centre(world, me);
    const next = this.path[this.pathPos + 1];
    if (this.dz.solid[next]) { this.planned = false; return 0; }
    const d = dirOf(c, next);
    const hold = this.pathHold[this.pathPos + 1];
    if (hold > 0 && world.tickNo + ticksToCross(c, d, me.x, me.y, effectiveSpeed(me) * DT) < hold - WAIT_TOL) return 0;   // wait for a flame to die out
    return d;
  }

  /** Arrived: in sudden death stand on the middle of the tile, so that a neighbour landing cannot clip the hitbox. */
  _centre(world, me) {
    if (world.falling.length === 0 && !world.suddenDeath) return 0;
    const cx = Math.floor(me.x) + 0.5;
    const cy = Math.floor(me.y) + 0.5;
    const dx = cx - me.x;
    const dy = cy - me.y;
    if (Math.abs(dx) > 0.07) return dx > 0 ? 2 : 4;
    if (Math.abs(dy) > 0.07) return dy > 0 ? 3 : 1;
    return 0;
  }

  /** Curse compensation and the last safety veto: never end a step on a tile that is lethal on the next ticks. */
  _finalDir(world, me, T, want) {
    let d = want;
    if (this.prof.curses) d = this._compensate(world, me, want);
    const c = tileOf(me);
    const sim = this.sim;
    sim.id = me.id; sim.x = me.x; sim.y = me.y; sim.facing = me.facing; sim.moving = me.moving; sim.speedLv = me.speedLv; sim.curse = me.curse;
    movePlayer(sim, effectiveDir(sim, d), this.env);
    const next = tileOf(sim);
    if (next !== c && this.dz.hits(next, T + 1, T + 2)) return this.prof.curses ? this._compensate(world, me, 0) : 0;
    return d;
  }

  /** The cmd direction that makes the player really move in `want`, given its curse (reverse mirrors, rush never stands still). */
  _compensate(world, me, want) {
    if (me.curse === 'reverse') return effectiveDir(me, want);
    if (me.curse === 'rush' && want === 0) return this._brake(me);
    return want;
  }

  /** Under rush a zero cmd means "keep running"; pressing into a wall is the only way to stand still. */
  _brake(me) {
    const c = tileOf(me);
    const T = this.dz.T;
    let d = me.facing + 1;
    let n = NB[c * 4 + d - 1];
    if (n < 0 || this.dz.closed(n, T)) return 0;
    for (d = 1; d <= 4; d++) {
      n = NB[c * 4 + d - 1];
      if (n < 0 || this.dz.closed(n, T)) return d;
    }
    return 0;
  }
}
