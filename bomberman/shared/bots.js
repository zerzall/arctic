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
//  * Besides BotBrain the module exports DangerMap (the danger model, for specs and the developer tooling under scripts/dev/bots).
//  * The brain keeps its own state (plan, path, stall clock) and never writes to anything it reads; it owns a makeRng(seed) and
//    uses no clock, so a round replays identically.
//  * `b` and `x` are 1 only on the tick a plan starts the action; every other tick returns b:0, x:0.

import {
  GRID_W, GRID_H, DT, DIR_DX, DIR_DY, FUSE_TICKS, FLAME_TICKS, KICK_STEP_TICKS, THROW_DIST, STATE,
  MAX_BOMBS, MAX_RANGE, MAX_SPEED_LV,
} from './constants.js';
import { makeRng } from './rng.js';
import { computeBlast, effectiveDir, effectiveSpeed, makeEnv, movePlayer, overlapsTile } from './world.js';

const W = GRID_W;
const H = GRID_H;
const N = W * H;
const INF = 1000000000;

const HORIZON = 260;             // ticks: a fuse (150) + a flame (36) + slack. Only hazards inside it make a tile unfit to rest on.
const SD_REST_HORIZON = 90;      // ticks: a tile that lands sooner than this after we arrive is no place to stand
const SLOTS = 6;                 // lethal intervals remembered per tile (overflow merges into the last one, which only adds caution)
const MAX_WAIT = 60;             // ticks a bot will stand still to let a flame die out on its route
const GOAL_SLACK = 24;           // ticks a calm bot wants between leaving a tile and the next flame there (only fleeing may cut it fine)
const WAIT_TOL = 3;              // ticks of early arrival that are not worth standing still for
const REBUILD_EVERY = 24;        // ticks after which the danger map is rebuilt even if the board looks unchanged
const HYP_ID = 1000000;          // id of the hypothetical bomb of an escape check

// Behaviour of the three levels (SPEC §6). `interval` is the re-plan cadence in ticks, `instant` whether a new danger forces a re-plan
// at once, `margin` the safety slack in ticks around every step of a route (easy cuts it fine and pays for it).
const PROFILES = Object.freeze({
  easy: Object.freeze({
    interval: 14, instant: false, margin: 1, mistake: 0.08, react: 12, itemSteps: 3, sight: 1, curses: false,
    kick: false, glove: false, trap: false, camp: false, careful: 0, skull: 0.6, hunt: 0, stall: 360,
  }),
  normal: Object.freeze({
    interval: 7, instant: true, margin: 3, mistake: 0, react: 0, itemSteps: 12, sight: 9, curses: true,
    kick: true, glove: false, trap: false, camp: false, careful: 1, skull: 0.3, hunt: 1.2, stall: 300,
  }),
  hard: Object.freeze({
    interval: 3, instant: true, margin: 4, mistake: 0, react: 0, itemSteps: 40, sight: 99, curses: true,
    kick: true, glove: true, trap: true, camp: true, careful: 2, skull: -1, hunt: 2.0, stall: 240,
  }),
});

const ITEM_VALUE = Object.freeze({ bomb: 3.0, flame: 2.6, speed: 2.4, kick: 2.2, glove: 1.8, shield: 2.8, skull: 1.0 });
const BLOCK_VALUE = 1.0;         // per soft block a bomb opens (capped, see BLOCK_CAP)
const BLOCK_CAP = 3;
const ENEMY_HIT_VALUE = 1.6;     // a bomb whose flames cover an enemy: it has to run, and a slow one dies
const ALLY_HIT_PENALTY = 2.5;
const CLAIM_LEAD = 10;           // ticks we must be ahead of every rival to claim a tile
const SEAL_WINDOW = 120;         // ticks before the last tile lands in which a bomb on it cannot explode first (the fuse is 150)
const KILL_VALUE = 10;           // a bomb that leaves an enemy with no way out
const TRAP_RANGE = 8;            // tiles: rivals farther away than this are not worth a trap check
const TRAP_ROOM = 14;            // a rival with more safe tiles than this in reach cannot be trapped by one bomb
const SEAL_REACH = 5;            // tiles: a rival farther than this from a tile of our escape route cannot close it in time
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

/** A bomb as the danger model sees it: `at` = the tick it explodes, `land` = the tick it starts to exist on its tile (thrown bombs). */
function virtualBomb(b, T) {
  const flying = b.fly !== null && b.fly !== undefined && b.fly !== 0;
  const left = flying ? b.fly.left : 0;
  return { id: b.id, tx: b.tx, ty: b.ty, range: b.range, at: T + left + b.fuse, land: flying ? T + left : -INF, fly: null, done: false, dir: flying ? 0 : b.dir, step: b.step };
}

export class DangerMap {
  constructor() {
    this.T = 0;
    this.cnt = new Uint8Array(N);                 // lethal intervals per tile
    this.lo = new Int32Array(N * SLOTS);          // [lo, hi] in absolute ticks, inclusive
    this.hi = new Int32Array(N * SLOTS);
    this.land = new Int32Array(N);                // tick at which a sudden-death tile lands (INF: never); lethal from then on, forever
    this.rest = new Int32Array(N);                // first tick after the last lethal tick inside the horizon (0: nothing to fear)
    this.solid = new Uint8Array(N);               // walls, blocks and bombs: cannot be walked through
    this._grid = new Array(N);
    this._bombs = [];
    this._batch = [];
    this._present = [];
    this._opened = [];
  }

  /**
   * Rebuilds the map from `world`; `extra` are hypothetical bombs (virtual bombs, see `hypothetical`) that are added to the board.
   * @returns {DangerMap} this
   */
  build(world, extra = null) {
    const T = world.tickNo;
    const grid = world.grid;
    this.T = T;
    this.cnt.fill(0);
    this.land.fill(INF);
    for (let i = 0; i < N; i++) this.solid[i] = grid[i] === '.' ? 0 : 1;

    const bombs = this._bombs;
    bombs.length = 0;
    for (const b of world.bombs) bombs.push(virtualBomb(b, T));
    if (extra) for (const e of extra) bombs.push(e);
    for (const b of bombs) this.solid[b.ty * W + b.tx] = 1;

    for (const f of world.flames) this._add(f.ty * W + f.tx, T + 1, T + f.ticks);
    if (bombs.length > 0) this._explode(grid, bombs);
    if (world.suddenDeath) {
      for (let i = 0; i < N; i++) {
        if (grid[i] === '#' || grid[i] === 'X') continue;
        const t = world.landTick(i % W, Math.floor(i / W));
        if (t !== Infinity) this.land[i] = t;
      }
    }
    for (let i = 0; i < N; i++) {
      let r = 0;
      const base = i * SLOTS;
      for (let k = 0; k < this.cnt[i]; k++) if (this.lo[base + k] <= T + HORIZON && this.hi[base + k] + 1 > r) r = this.hi[base + k] + 1;
      this.rest[i] = r;
    }
    return this;
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
        if (b.land <= e) present.push(b);
      }
      for (let qi = 0; qi < batch.length; qi++) {
        const b = batch[qi];
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

  /** First lethal tick at or after `a` on tile i (INF: never). */
  nextLethal(i, a) {
    let e = this.land[i];
    const base = i * SLOTS;
    for (let k = 0, n = this.cnt[i]; k < n; k++) {
      if (this.hi[base + k] < a) continue;
      const s = this.lo[base + k] > a ? this.lo[base + k] : a;
      if (s < e) e = s;
    }
    return e;
  }

  /** Convenience for specs and tools: is tile (tx, ty) lethal on any tick of [from, to]? */
  lethal(tx, ty, from, to = from) {
    return this.hits(ty * W + tx, from, to);
  }

  /** Walkable neighbours of tile i. */
  openCount(i) {
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const j = NB[i * 4 + d];
      if (j >= 0 && this.solid[j] === 0) n++;
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

/** A hypothetical bomb on tile (tx, ty) for DangerMap.build: explodes `fuse` ticks after `T`. */
export function hypothetical(tx, ty, range, T, fuse = FUSE_TICKS) {
  return { id: HYP_ID, tx, ty, range, at: T + fuse, land: -INF, fly: null, done: false, dir: 0, step: 0 };
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
    if (beside < 0 || dz.solid[beside]) j += Math.ceil((lateral - 0.16) / sp);
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
      const e = dz.blockEnd(n, t - margin, t + inv - 1 + margin + slack);
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
    return a < INF && dz.rest[i] <= a - margin && dz.land[i] - a >= SD_REST_HORIZON;
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
    this.kickUntil = 0;
    this.foes = [];
    this.allies = [];
    this.sim = { id: 0, x: 0, y: 0, facing: 0, moving: false, speedLv: 0, curse: null };
    this.env = null;
    this.envWorld = null;
    this._pool = [];
    this._seen = new Uint8Array(N);
    this._rivalTicks = new Int32Array(N);         // sudden death: tiles a rival needs to reach each tile
    this._bombList = [];
    this._verdict = { safe: false, kill: false };
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
    for (const o of world.players) {
      if (o === me || !o.alive || o.removed) continue;
      if (teams && o.team === me.team) allies.push(o);
      else foes.push(o);
    }
  }

  // ---- Planning -------------------------------------------------------------------------------

  _plan(world, me, T) {
    const prof = this.prof;
    const c = tileOf(me);
    const threatened = !this._safeHere(c, T);
    this.sr.run(this.dz, T, me.x, me.y, effectiveSpeed(me), prof.margin, threatened ? 0 : GOAL_SLACK);
    this.planned = true;
    this.planAt = T + prof.interval;
    this.pathLen = 0;
    this.pathPos = 0;
    this.act = 0;
    this.actDir = 0;
    this._sortPlayers(world, me);
    this._trackProgress(world, T, c);

    if (world.suddenDeath && prof.camp && this._trySeal(world, me, T, c)) return;
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

  /** May we stand on tile c from now on? */
  _safeHere(c, T) {
    return this.dz.rest[c] <= T - this.prof.margin && this.dz.land[c] - T >= SD_REST_HORIZON;
  }

  /** Stall breaker: standing around in one corner of the board for too long asks for a risk-free action. */
  _trackProgress(world, T, c) {
    if (this.anchor < 0 || manhattan(c, this.anchor) > 2) {
      this.anchor = c;
      this.anchorAt = T;
      this.urge = 0;
    } else if (T - this.anchorAt > this.prof.stall && !world.suddenDeath) {
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
      if (!sr.restOK(dz, i, prof.margin)) continue;
      let s = -(sr.arr[i] - T) * sp + 0.4 * dz.openCount(i) - dz.hazardCount(i);
      if (prof.careful > 0) {
        s -= 0.5 * Math.max(0, 5 - this._foeDistance(i));                            // do not run to where a rival can seal us in
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
    let best = -1;
    let bestAt = -1;
    for (let k = 0; k < sr.n; k++) {
      const i = sr.list[k];
      if (!prof.camp && (sr.arr[i] - T) * sp > 2) continue;      // a bot that does not plan for the last stand only looks a tile or two around
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
        if (n < 0 || seen[n] || this.dz.solid[n]) continue;
        seen[n] = 1;
        queue.push(n);
        if (queue.length > POCKET) return false;
      }
    }
    return true;
  }

  /** Distance from tile i to the nearest enemy (99 when there is none). */
  _foeDistance(i) {
    let best = 99;
    for (const e of this.foes) {
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
    return this._tryBomb(world, me, T, c);
  }

  /**
   * Drop a bomb on the tile we stand on when it pays (soft blocks opened, an enemy under the flames, an enemy with no way out) and an
   * escape route is proven even with that bomb on the board.
   */
  _tryBomb(world, me, T, c) {
    const prof = this.prof;
    if (T < this.bombNext || !this._canBomb(world, me, c)) return false;
    if (this.dz.hits(c, T + 1, T + FLAME_TICKS)) return false;

    const tx = c % W;
    const ty = (c - tx) / W;
    const list = this._bombList;
    list.length = 0;
    for (const b of world.bombs) list.push(b);
    const mine = { id: HYP_ID, tx, ty, range: me.range, fly: null };
    list.push(mine);
    const blast = computeBlast(world.grid, list, mine);

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

    this.bombNext = T + 8;
    const verdict = this._evaluateBomb(world, me, T, c, 0, wantKill);
    if (!verdict.safe) {
      this.bombNext = T + 30;
      this.banned[c] = T + 90;                    // do not wait around here: try another spot
      return false;
    }
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
    if (exits < (prof.careful > 0 ? 2 : 1)) return verdict;
    if (prof.careful > 1 && !this._escapeIsRobust(dz, T + delay, x, y, speed)) return verdict;
    verdict.safe = true;
    if (wantKill) verdict.kill = this._trapsSomeone(dz, T);
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
      if (this._foeDistance(t) > SEAL_REACH) continue;                              // nobody is near enough to close that door
      dz.solid[t] = 1;
      sr.run(dz, t0, x, y, speed, prof.margin);
      let alive = false;
      for (let k = 1; k < sr.n && !alive; k++) alive = sr.restOK(dz, sr.list[k], prof.margin);
      dz.solid[t] = 0;
      if (!alive) return false;
    }
    return true;
  }

  /** With `dz` (the hypothetical board): is a nearby enemy standing in the flames with no safe tile in reach? */
  _trapsSomeone(dz, T) {
    for (const e of this.foes) {
      if (manhattan(tileOf(e), tileOf(this.sim)) > 99 || Math.max(e.shield, e.spawnShield) > 100) continue;
      const ei = tileOf(e);
      if (dz.rest[ei] <= T - 1 && dz.land[ei] - T >= SD_REST_HORIZON) continue;          // it is not even threatened
      const sr = this.srE;
      sr.run(dz, T, e.x, e.y, effectiveSpeed(e), 1);
      let out = false;
      for (let k = 0; k < sr.n && !out; k++) out = sr.restOK(dz, sr.list[k], 1);
      if (!out) return true;
    }
    return false;
  }

  // ---- Goals ----------------------------------------------------------------------------------

  _itemValue(me, kind) {
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
        for (let k = 1; k < sr.n; k++) {
          const i = sr.list[k];
          if (!sr.restOK(dz, i, prof.margin)) continue;
          const cost = manhattan(i, ei) * 3 + stepsTo(i);
          if (cost < nearCost) { nearCost = cost; near = i; }
        }
        if (near >= 0 && near !== c) consider(near, 'hunt', keen / (1 + 0.15 * stepsTo(near)));
      }
    }

    if (prof.trap && T >= this.trapNext) {
      this.trapNext = T + 9;
      const spot = this._findTrapSpot(world, me, T, c);
      if (spot >= 0) consider(spot, 'trap', 20);
    }

    if (world.suddenDeath && prof.camp) {
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
   * Sudden death: the tile that lands latest among those we can reach before any rival can. Claiming only what we can get first keeps
   * the survivors from all piling onto the very last tile (nobody could be beaten there), so the round is decided while it still can be.
   * With no such tile we take the latest one we can reach at all.
   */
  _campSpot(me, T) {
    const { dz, sr, prof } = this;
    const rival = this._rivalTicks;
    rival.fill(INF);
    const queue = this._pool;
    queue.length = 0;
    let fastest = 0;
    for (const e of this.foes) {
      const i = tileOf(e);
      if (rival[i] === INF) { rival[i] = 0; queue.push(i); }
      fastest = Math.max(fastest, effectiveSpeed(e));
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi];
      for (let d = 0; d < 4; d++) {
        const n = NB[t * 4 + d];
        if (n < 0 || dz.solid[n] || rival[n] !== INF) continue;
        rival[n] = rival[t] + 1;
        queue.push(n);
      }
    }
    const perTile = fastest > 0 ? 1 / (fastest * DT) : INF;
    let claimed = -1;
    let claimedLand = -1;
    let any = -1;
    let anyLand = -1;
    for (let k = 0; k < sr.n; k++) {
      const i = sr.list[k];
      if (!sr.restOK(dz, i, prof.margin)) continue;
      const land = dz.land[i] >= INF ? T + 4000 : dz.land[i];
      if (land > anyLand) { anyLand = land; any = i; }
      if (rival[i] === INF || (sr.arr[i] - T) + CLAIM_LEAD < rival[i] * perTile) {
        if (land > claimedLand) { claimedLand = land; claimed = i; }
      }
    }
    return claimed >= 0 ? claimed : any;
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
    if (this.act & 2) x = 1;
    this.act = 0;
    const d = this._finalDir(world, me, T, want);
    return { d, b, x };
  }

  /** The direction (1..4) that follows the planned path from where we are, 0 when we are there. */
  _steer(world, me) {
    if (this.pathLen === 0) return this._settle(world, me);
    const c = tileOf(me);
    if (this.path[this.pathPos] !== c) {
      let found = -1;
      for (let k = 0; k < this.pathLen; k++) if (this.path[k] === c) { found = k; break; }
      if (found < 0) { this.planned = false; return 0; }        // knocked off the route
      this.pathPos = found;
    }
    if (this.pathPos >= this.pathLen - 1) return this._settle(world, me);
    const next = this.path[this.pathPos + 1];
    if (this.dz.solid[next]) { this.planned = false; return 0; }
    const d = dirOf(c, next);
    const hold = this.pathHold[this.pathPos + 1];
    if (hold > 0 && world.tickNo + ticksToCross(c, d, me.x, me.y, effectiveSpeed(me) * DT) < hold - WAIT_TOL) return 0;   // wait for a flame to die out
    return d;
  }

  /** Arrived: in sudden death stand on the middle of the tile, so that a neighbour landing cannot clip the hitbox. */
  _settle(world, me) {
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
    let d = me.facing + 1;
    let n = NB[c * 4 + d - 1];
    if (n < 0 || this.dz.solid[n]) return 0;
    for (d = 1; d <= 4; d++) {
      n = NB[c * 4 + d - 1];
      if (n < 0 || this.dz.solid[n]) return d;
    }
    return 0;
  }
}
