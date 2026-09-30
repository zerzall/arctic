// The simulation of ONE round (docs/SPEC.md §3, Appendix A.1). Server-authoritative and fully
// deterministic: the only randomness is the World's own seeded rng, time is counted in ticks, all
// iteration is in ascending fighter/bomb/item id, and only + - * / % and a few Math functions are used.
// Runs unchanged in Node and in the browser; the client predictor imports the pure exports below.
//
// Public surface: World, movePlayer, effectiveSpeed, effectiveDir, overlapsTile, makeEnv, computeBlast.
//
// Clarifications where the spec leaves room (all kept to the simplest reading):
//  * tick() is a complete no-op in state OVER (tickNo is not advanced). The GO tick (countdown reaching 0)
//    performs step 0 only; the first tick of `playing` is the next one.
//  * A team-mode win sets `outcome.winnerTeam` and leaves `winnerId` null; an FFA win sets `winnerId` only.
//  * A curse handed on by touch emits ONE event (`curse [receiver, kind, giver]`); the giver's cure is visible
//    in the next snapshot. Death and outcome lock emit `curse [id, 0, -1]` for a cursed fighter.
//  * A skull picked up during `ending` is consumed but gives no curse (curse timers do not run after the lock).
//  * Showdown needs at least one human in the round, >= 2 fighters alive (in team mode from both teams), and is
//    announced only when it actually shortens the clock.
//  * removeFighter always sets killer = -2 and always emits `left`, even for an already-dead fighter.
//  * `computeBlast().hitBombs` are the OTHER non-flying bombs on the flame tiles (a bomb never lists itself).
//  * Player objects carry one private field, `_ran`, which the World uses to clear `moving` for idle fighters.
//  * movePlayer is SPEC 3.5 verbatim (minus its per-call closures). Its EPS tolerance band means an UNROUNDED position can sit up to
//    EPS (1e-6 tile) inside a wall for one tick when a step happens to end there; the next step clamps it back. Positions rounded
//    to 3 decimals, which is all the wire carries, never overlap (asserted by the fuzz specs; the spec's "< 1e-9" holds only there).

import {
  DT, EPS, GRID_W, GRID_H, PLAYER_HALF, BASE_SPEED, SPEED_STEP, MAX_BOMBS, MAX_RANGE, MAX_SPEED_LV, MAX_PLAYERS,
  START_BOMBS, START_RANGE, FUSE_TICKS, FLAME_TICKS, KICK_STEP_TICKS, THROW_DIST, THROW_TICKS,
  SHIELD_TICKS, SPAWN_SHIELD_TICKS, SHIELD_FOREVER, SHIELDHIT_GAP_TICKS, CURSE_TICKS, CURSE_TOUCH_RADIUS,
  CURSE_XFER_COOLDOWN, CURSE_SLOW_SPEED, CURSE_RUSH_SPEED, SPAM_INTERVAL, COUNTDOWN_TICKS, ENDING_TICKS,
  SD_INTERVAL, SD_WARN_TICKS, MAX_ROUND_TICKS, SHOWDOWN_TICKS, CURSE_KINDS, STATE, DIR_DX, DIR_DY, SPAWN_SLOTS,
} from './constants.js';
import { makeRng } from './rng.js';
import { generateMap } from './mapgen.js';
import { P, B, PF } from './protocol.js';

const W = GRID_W;
const H = GRID_H;
const CELLS = W * H;
const EVENT_KEEP = 512;                 // events retained when nobody trims them (the wire carries at most 128)
const EVENT_WIRE_MAX = 128;
const CURSE_TOUCH_R2 = CURSE_TOUCH_RADIUS * CURSE_TOUCH_RADIUS;

// Flame-mask bits by dir code (1 up, 2 right, 3 down, 4 left) and the bit that faces back to the centre.
const DIR_BIT = [0, 1, 2, 4, 8];
const DIR_BACK_BIT = [0, 4, 8, 1, 2];

const round3 = (v) => Math.round(v * 1000) / 1000;
const byTyTx = (a, b) => a.ty - b.ty || a.tx - b.tx;
const inBoard = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H;

// ==================================================================================================
// Pure helpers shared with the client predictor and the bots
// ==================================================================================================

/** Tiles per second. `movePlayer` multiplies by DT, never divides by 60. */
export function effectiveSpeed(p) {
  if (p.curse === 'slow') return CURSE_SLOW_SPEED;
  if (p.curse === 'rush') return CURSE_RUSH_SPEED;
  return BASE_SPEED + SPEED_STEP * p.speedLv;
}

const REVERSED = [0, 3, 4, 1, 2];            // 1<->3, 2<->4: an involution

/** Curses act on the input direction: `reverse` mirrors it, `rush` autoruns in the facing direction. */
export function effectiveDir(p, d) {
  if (p.curse === 'reverse') d = REVERSED[d];
  if (p.curse === 'rush' && d === 0) d = p.facing + 1;
  return d;
}

/** Strict hitbox-vs-tile overlap, used everywhere (pass lists, kick, slide, glove, sudden death). */
export function overlapsTile(p, tx, ty) {
  return p.x + PLAYER_HALF > tx && p.x - PLAYER_HALF < tx + 1 && p.y + PLAYER_HALF > ty && p.y - PLAYER_HALF < ty + 1;
}

/**
 * Collision environment for movePlayer. `grid` is a string or an array, `bombs` are World bombs, decoded
 * snapshot bombs or ghosts ({id,tx,ty,fly,pass}); `left` is the replay's "no longer overlapping" map (§5.2).
 * The arrays are read live, so a long-lived env follows the World as it mutates them in place.
 */
export function makeEnv(grid, bombs, width = GRID_W, height = GRID_H, left = null) {
  return {
    W: width,
    H: height,
    isSolid(tx, ty, p) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
      if (grid[ty * width + tx] !== '.') return true;
      for (let i = 0; i < bombs.length; i++) {
        const b = bombs[i];
        if (b.fly || b.tx !== tx || b.ty !== ty) continue;
        if (b.pass && b.pass.includes(p.id) && !(left && left[b.id])) continue;
        return true;
      }
      return false;
    },
  };
}

const IDLE = Object.freeze({ moved: false, blocked: false });
const MOVED = Object.freeze({ moved: true, blocked: false });
const BLOCKED = Object.freeze({ moved: false, blocked: true });

/**
 * THE movement function, shared by the server and by client prediction (§3.5). Mutates only
 * p.x, p.y, p.facing and p.moving. Direction-aware EPS handling: a leading edge exactly on a tile
 * boundary counts as still inside the tile BEHIND it, so a clamped player is stable and never penetrates.
 * @returns {{ moved: boolean, blocked: boolean }} shared frozen objects; do not mutate
 */
export function movePlayer(p, d, env) {
  if (d === 0) {
    p.moving = false;
    return IDLE;
  }
  const horiz = d === 2 || d === 4;
  const sgn = (d === 2 || d === 3) ? 1 : -1;
  p.facing = d - 1;
  const step = effectiveSpeed(p) * DT;
  const a = horiz ? 'x' : 'y';
  const q = horiz ? 'y' : 'x';
  const ap = p[a];
  const pp = p[q];
  const lo = Math.floor(pp - PLAYER_HALF + EPS);           // the one or two lanes the hitbox covers
  const hi = Math.floor(pp + PLAYER_HALF - EPS);
  const np = ap + sgn * step;
  const eOld = ap + sgn * PLAYER_HALF;
  const eNew = np + sgn * PLAYER_HALF;
  const tOld = sgn > 0 ? Math.floor(eOld - EPS) : Math.floor(eOld + EPS);   // tile holding the LEADING edge
  const tNew = sgn > 0 ? Math.floor(eNew - EPS) : Math.floor(eNew + EPS);
  let sLo = false;
  let sHi = false;
  if (tNew !== tOld) {
    sLo = horiz ? env.isSolid(tNew, lo, p) : env.isSolid(lo, tNew, p);
    sHi = lo === hi ? sLo : (horiz ? env.isSolid(tNew, hi, p) : env.isSolid(hi, tNew, p));
  }
  let r;
  if (!sLo && !sHi) {
    p[a] = np;
    r = MOVED;
  } else if (lo !== hi && sLo !== sHi && Math.floor(pp) === (sLo ? hi : lo)) {
    // Corner slide: the centre is over the free lane, so nudge sideways and leave the travel axis alone.
    const delta = (sLo ? hi : lo) + 0.5 - pp;
    p[q] = pp + Math.sign(delta) * Math.min(step, Math.abs(delta));
    r = MOVED;
  } else {
    p[a] = sgn > 0 ? tNew - PLAYER_HALF - EPS : tNew + 1 + PLAYER_HALF + EPS;   // flush against the solid tile
    r = BLOCKED;
  }
  p.moving = r.moved;
  return r;
}

/**
 * Walks the four arms of one bomb (§3.6a). `bombAt(tx,ty)` returns the non-flying bomb whose logical tile is
 * that tile, if any. Arms stop BEFORE '#'/'X', stop INCLUSIVE at '+' (a block absorbs the arm) and at a bomb
 * (the arm ends AT it; that bomb's own arms take over). Shared by computeBlast and the World's resolver.
 */
function scanBlast(grid, bombAt, bomb) {
  const tiles = [[bomb.tx, bomb.ty]];
  const arms = [0, 0, 0, 0];               // tiles reached per arm: up, right, down, left
  const blocks = [];
  const hits = [];
  for (let d = 1; d <= 4; d++) {
    for (let k = 1; k <= bomb.range; k++) {
      const tx = bomb.tx + DIR_DX[d] * k;
      const ty = bomb.ty + DIR_DY[d] * k;
      if (!inBoard(tx, ty)) break;
      const c = grid[ty * W + tx];
      if (c === '#' || c === 'X') break;
      tiles.push([tx, ty]);
      arms[d - 1]++;
      if (c === '+') {
        blocks.push([tx, ty]);
        break;
      }
      const other = bombAt(tx, ty);
      if (other) {
        hits.push(other);
        break;
      }
    }
  }
  return { tiles, arms, blocks, hits };
}

/**
 * The flame set of ONE bomb with every arm-stop rule of §3.6a. Pure; bots build danger maps with it.
 * @returns {{ tiles: number[][], blocks: number[][], hitBombs: number[] }}
 *   tiles incl. the centre, soft blocks it destroys, ids of other non-flying bombs it reaches (chain)
 */
export function computeBlast(grid, bombs, bomb) {
  const { tiles, blocks, hits } = scanBlast(grid, (tx, ty) => bombs.find((o) => !o.fly && o.tx === tx && o.ty === ty), bomb);
  return { tiles, blocks, hitBombs: hits.map((o) => o.id) };
}

// ==================================================================================================
// World
// ==================================================================================================

/** Team-mode 2v2: each team owns one diagonal (team 0 slots {0,1}, team 1 slots {2,3}); otherwise one shuffle. */
function assignSlots(fighters, mode, rng) {
  const slots = new Array(fighters.length);
  const team0 = [];
  const team1 = [];
  fighters.forEach((f, i) => (f.team === 1 ? team1 : team0).push(i));
  if (mode === 'teams' && fighters.length === 4 && team0.length === 2 && team1.length === 2) {
    const first = rng.shuffle([0, 1]);
    const second = rng.shuffle([2, 3]);
    team0.forEach((fi, j) => { slots[fi] = first[j]; });
    team1.forEach((fi, j) => { slots[fi] = second[j]; });
  } else {
    const order = rng.shuffle(fighters.map((_, i) => i));
    for (let i = 0; i < slots.length; i++) slots[i] = order[i];
  }
  return slots;
}

export class World {
  /**
   * @param {{ seed: number, fighters: {id:number,name:string,color:number,team:number,isBot:boolean,lastSeq?:number}[],
   *           mode?: 'ffa'|'teams', layout?: string, blocks?: string, items?: string, theme?: string,
   *           roundTime?: number, suddenDeath?: boolean }} opts
   */
  constructor({ seed, fighters, mode = 'ffa', layout = 'classic', blocks = 'normal', items = 'normal', theme = 'meadow', roundTime = 120, suddenDeath = true }) {
    if (!Array.isArray(fighters) || fighters.length < 1 || fighters.length > MAX_PLAYERS) {
      throw new RangeError(`World needs 1..${MAX_PLAYERS} fighters`);
    }
    this.W = W;
    this.H = H;
    this.seed = seed >>> 0;
    this.mode = mode;
    this.layout = layout;
    this.theme = theme;
    this.roundTime = roundTime;
    this.sdEnabled = suddenDeath === true && roundTime > 0;      // sudden death is disabled when the clock is unlimited

    // RNG draw order is normative: map first, then slots; later only skull curses draw.
    this._rng = makeRng(seed);
    const map = generateMap({ layout, blocks, items, numFighters: fighters.length, rng: this._rng });
    const slots = assignSlots(fighters, mode, this._rng);
    this.grid = map.grid.split('');
    this._drops = map.drops;
    this.gridVer = 0;

    this.tickNo = 0;
    this.state = STATE.COUNTDOWN;
    this.countdown = COUNTDOWN_TICKS;
    this.timeLeft = roundTime > 0 ? roundTime * 60 : -1;
    this.suddenDeath = false;
    this.sdOrder = [];
    this.sdNext = 0;
    this.sdStart = -1;
    this.outcome = null;

    this.players = fighters.map((f, i) => this._makePlayer(f, slots[i]));
    this.bombs = [];
    this.flames = [];
    this.items = [];
    this.falling = [];

    this.evCount = 0;
    this._events = [];
    this._evBase = 0;                                  // absolute index of _events[0]
    this._byId = new Map(this.players.map((p) => [p.id, p]));
    this._order = this.players.slice().sort((a, b) => a.id - b.id);   // every loop iterates in ascending id
    this._hasHumans = this.players.some((p) => !p.isBot);
    this._env = makeEnv(this.grid, this.bombs, W, H);
    this._flameGrid = new Array(CELLS).fill(null);     // tile -> flame record
    this._sdIndex = new Array(CELLS).fill(-1);         // tile -> position in sdOrder
    this._nextBombId = 1;
    this._nextItemId = 1;
    this._playTicks = 0;
    this._endingLeft = 0;
    this._timeUp = false;
    this._sdFrozen = false;
    this._showdownDone = false;
    this._aliveDirty = false;
    this._aliveTeam = [0, 0];                          // scratch for the outcome check, reused every tick
  }

  _makePlayer(f, slot) {
    const [tx, ty] = SPAWN_SLOTS[slot];
    return {
      id: f.id, name: f.name, color: f.color, team: f.team, isBot: !!f.isBot, slot,
      x: tx + 0.5, y: ty + 0.5, facing: 2, moving: false, alive: true, removed: false,
      bombsMax: START_BOMBS, range: START_RANGE, speedLv: 0, kick: false, glove: false,
      shield: 0, spawnShield: 0, curse: null, curseTicks: 0, curseCooldown: 0, spamCd: 0,
      lastShieldHit: -SHIELDHIT_GAP_TICKS, lastSeq: Number.isSafeInteger(f.lastSeq) ? f.lastSeq : 0,
      deathTick: -1, killer: -1,
      stats: { kills: 0, deaths: 0, selfKills: 0, blocks: 0, items: 0 },
      _ran: false,
    };
  }

  player(id) {
    return this._byId.get(id);
  }

  // ---- Events -------------------------------------------------------------------------------------

  _emit(...event) {
    this._events.push(event);
    this.evCount++;
    if (this._events.length > EVENT_KEEP * 2) {
      this._events.splice(0, this._events.length - EVENT_KEEP);
      this._evBase = this.evCount - this._events.length;
    }
  }

  /** Events with absolute index >= n, at most the newest 128. */
  eventsSince(n) {
    const from = Number.isFinite(n) ? Math.max(0, n - this._evBase) : this._events.length;
    const out = this._events.slice(from);
    return out.length > EVENT_WIRE_MAX ? out.slice(out.length - EVENT_WIRE_MAX) : out;
  }

  /** Forget events before absolute index n. */
  trimEvents(n) {
    const drop = Math.min(this._events.length, Math.max(0, n - this._evBase));
    if (drop > 0) {
      this._events.splice(0, drop);
      this._evBase += drop;
    }
  }

  // ---- Input --------------------------------------------------------------------------------------

  /** One cmd {s,d,b,x} for this tick (§3.4). Call before tick(). Never throws. */
  applyCmd(id, cmd) {
    const p = this._byId.get(id);
    if (!p || cmd === null || typeof cmd !== 'object') return;
    if (Number.isSafeInteger(cmd.s) && cmd.s > p.lastSeq) p.lastSeq = cmd.s;    // always, so clients can ack
    if ((this.state !== STATE.PLAYING && this.state !== STATE.ENDING) || !p.alive) return;

    const raw = cmd.d;
    const d = effectiveDir(p, raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 0);
    const r = movePlayer(p, d, this._env);
    p._ran = true;
    if (r.blocked && p.kick) this._tryKick(p, d);
    if (cmd.b && this._canPlaceBomb(p)) this._placeBomb(p);
    if (cmd.x && p.glove) this._tryThrow(p);
  }

  /** A fighter who left: dies now (event `left` only), its bombs are orphaned. */
  removeFighter(id) {
    const p = this._byId.get(id);
    if (!p || p.removed) return;
    p.removed = true;
    p.alive = false;
    p.moving = false;
    p.killer = -2;
    p.deathTick = this.tickNo;
    p.curse = null;
    p.curseTicks = 0;
    for (const b of this.bombs) if (b.owner === id) b.owner = -1;
    this._aliveDirty = true;
    this._emit('left', id);
  }

  // ---- The tick (§3.2a) ---------------------------------------------------------------------------

  tick() {
    if (this.state === STATE.OVER) return;
    this.tickNo++;
    if (this.state === STATE.COUNTDOWN) {
      if (--this.countdown === 0) {
        this.state = STATE.PLAYING;
        for (const p of this._order) if (p.alive) p.spawnShield = SPAWN_SHIELD_TICKS;
        this._emit('go');
      }
      return;
    }
    const playing = this.state === STATE.PLAYING;
    if (playing) {
      this._autoActions();
      this._advanceClock();
    }
    this._stepBombs();
    this._resolveExplosions();
    if (playing) this._landFallingTiles();
    this._pickups();
    if (playing) {
      this._curseTransfers();
      this._killCheck();
    }
    this._age(playing);
    this._finishTick(playing);
  }

  /** Step 1: the `spam` curse drops bombs by itself, so lag or an empty input queue cannot dodge it. */
  _autoActions() {
    for (const p of this._order) {
      if (!p.alive || p.curse !== 'spam') continue;
      if (p.spamCd > 0) p.spamCd--;
      if (p.spamCd === 0 && this._canPlaceBomb(p)) {
        this._placeBomb(p);
        p.spamCd = SPAM_INTERVAL;
      }
    }
  }

  /** Step 2: round clock, sudden-death start and schedule. */
  _advanceClock() {
    this._playTicks++;
    if (this.timeLeft > 0 && --this.timeLeft === 0) {
      if (this.sdEnabled) this._startSuddenDeath();
      else this._timeUp = true;
    }
    if (this.roundTime === 0 && this._playTicks >= MAX_ROUND_TICKS) this._timeUp = true;
    if (!this.suddenDeath) return;
    for (const f of this.falling) f.ticksLeft--;
    while (this.sdNext < this.sdOrder.length && this.sdStart + this.sdNext * SD_INTERVAL <= this.tickNo) {
      const t = this.sdOrder[this.sdNext++];
      this.falling.push({ tx: t % W, ty: (t - (t % W)) / W, ticksLeft: SD_WARN_TICKS });
    }
  }

  /** Clockwise rings from the top-left of each ring; every non-wall cell exactly once. */
  _startSuddenDeath() {
    this.suddenDeath = true;
    this.sdStart = this.tickNo;
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
    this.sdOrder = order.filter((t) => this.grid[t] !== '#' && this.grid[t] !== 'X');
    this.sdOrder.forEach((t, i) => { this._sdIndex[t] = i; });
    this._emit('sdstart');
  }

  /** Absolute tick at which the cell becomes 'X' (Infinity if it is not scheduled). */
  landTick(tx, ty) {
    if (!this.suddenDeath || !inBoard(tx, ty)) return Infinity;
    const idx = ty * W + tx;
    const i = this._sdIndex[idx];
    if (!(i >= 0)) return Infinity;                  // also catches non-integer tiles (undefined slot)
    const t = this.sdStart + i * SD_INTERVAL + SD_WARN_TICKS;
    return this.grid[idx] === 'X' || !this._sdFrozen ? t : Infinity;
  }

  // ---- Bombs: place, fuse, slide, fly (step 3) ----------------------------------------------------

  _bombAtTile(tx, ty) {
    for (const b of this.bombs) if (!b.fly && b.tx === tx && b.ty === ty) return b;
    return undefined;
  }

  _ownedBombs(id) {
    let n = 0;
    for (const b of this.bombs) if (b.owner === id) n++;
    return n;
  }

  _canPlaceBomb(p) {
    if (!p.alive || p.curse === 'nobomb' || this._ownedBombs(p.id) >= p.bombsMax) return false;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    return inBoard(tx, ty) && this.grid[ty * W + tx] === '.' && !this._bombAtTile(tx, ty);
  }

  /** Ids of every alive fighter whose hitbox overlaps the tile: they may walk out of a bomb that appears under them. */
  _overlappingIds(tx, ty) {
    const ids = [];
    for (const p of this._order) if (p.alive && overlapsTile(p, tx, ty)) ids.push(p.id);
    return ids;
  }

  _placeBomb(p) {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    const bomb = {
      id: this._nextBombId++, owner: p.id, x: tx + 0.5, y: ty + 0.5, tx, ty, range: p.range,
      fuse: FUSE_TICKS, dir: 0, step: 0, pass: this._overlappingIds(tx, ty), fly: null,
    };
    this.bombs.push(bomb);
    this._emit('bomb', bomb.id, p.id, tx, ty);
  }

  /** enterable(N): in board, floor, no non-flying bomb, no alive fighter overlapping it. */
  _enterable(tx, ty) {
    if (!inBoard(tx, ty) || this.grid[ty * W + tx] !== '.' || this._bombAtTile(tx, ty)) return false;
    for (const p of this._order) if (p.alive && overlapsTile(p, tx, ty)) return false;
    return true;
  }

  /** Step 3: four full passes in ascending bomb id. */
  _stepBombs() {
    const bombs = this.bombs;
    if (bombs.length === 0) return;
    for (const b of bombs) if (!b.fly) b.fuse--;
    for (const b of bombs) if (b.dir !== 0) this._slide(b);
    for (const b of bombs) if (b.fly) this._flyStep(b);
    for (const b of bombs) if (b.pass.length > 0) this._prunePass(b);
  }

  /**
   * Reservation model: a sliding bomb occupies (is solid on and explodes on) the tile it is heading into from
   * the moment it is reserved, and its visual position glides from the old centre to the new one.
   */
  _slide(b) {
    if (b.step > 0) b.step--;
    if (b.step === 0) {
      const nx = b.tx + DIR_DX[b.dir];
      const ny = b.ty + DIR_DY[b.dir];
      if (this._enterable(nx, ny)) {
        b.tx = nx;
        b.ty = ny;
        b.step = KICK_STEP_TICKS;
      } else {
        b.dir = 0;
        b.pass = [];
      }
    }
    const glide = b.step / KICK_STEP_TICKS;
    b.x = b.tx + 0.5 - DIR_DX[b.dir] * glide;
    b.y = b.ty + 0.5 - DIR_DY[b.dir] * glide;
  }

  _flyStep(b) {
    const f = b.fly;
    if (--f.left > 0) {
      const done = (f.total - f.left) / f.total;
      b.x = f.fx + (f.tx + 0.5 - f.fx) * done;
      b.y = f.fy + (f.ty + 0.5 - f.fy) * done;
      return;
    }
    let spot = this._isLandable(f.tx, f.ty) ? { tx: f.tx, ty: f.ty } : this._nearestLandable(f.tx, f.ty, 6);
    if (!spot) spot = this._nearestLandable(Math.floor(f.fx), Math.floor(f.fy), Infinity);
    if (!spot) spot = { tx: Math.floor(f.fx), ty: Math.floor(f.fy) };     // unreachable: the board is full
    b.tx = spot.tx;
    b.ty = spot.ty;
    b.x = spot.tx + 0.5;
    b.y = spot.ty + 0.5;
    b.fly = null;
    b.dir = 0;
    b.step = 0;
    b.pass = this._overlappingIds(spot.tx, spot.ty);
    this._emit('land', b.id, spot.tx, spot.ty);
  }

  _isLandable(tx, ty) {
    return inBoard(tx, ty) && this.grid[ty * W + tx] === '.' && !this._bombAtTile(tx, ty);
  }

  /** BFS over 4-neighbours (up, right, down, left), first landable tile within maxSteps. */
  _nearestLandable(sx, sy, maxSteps) {
    const seen = new Set([sy * W + sx]);
    let frontier = [[sx, sy]];
    for (let steps = 0; steps <= maxSteps && frontier.length > 0; steps++) {
      const next = [];
      for (const [tx, ty] of frontier) {
        if (this._isLandable(tx, ty)) return { tx, ty };
        for (let d = 1; d <= 4; d++) {
          const nx = tx + DIR_DX[d];
          const ny = ty + DIR_DY[d];
          if (inBoard(nx, ny) && !seen.has(ny * W + nx)) {
            seen.add(ny * W + nx);
            next.push([nx, ny]);
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Step 3d: a fighter may walk through a bomb until its hitbox stops overlapping the bomb's tile; never re-added. */
  _prunePass(b) {
    const pass = b.pass;
    let kept = 0;
    for (let i = 0; i < pass.length; i++) {
      const p = this._byId.get(pass[i]);
      if (p && p.alive && overlapsTile(p, b.tx, b.ty)) pass[kept++] = pass[i];
    }
    pass.length = kept;
  }

  // ---- Kick and glove (§3.6b, §3.6c) --------------------------------------------------------------

  /** The tile in front on the lane holding the player's centre; there is no alignment threshold, hence no dead zone. */
  _tryKick(p, d) {
    const dx = DIR_DX[d];
    const dy = DIR_DY[d];
    const kx = Math.floor(p.x) + dx;
    const ky = Math.floor(p.y) + dy;
    const b = this._bombAtTile(kx, ky);
    if (!b || b.dir !== 0 || b.pass.length > 0 || !this._enterable(kx + dx, ky + dy)) return;
    b.dir = d;
    b.step = 0;
    this._emit('kick', p.id, b.id, d);
  }

  _tryThrow(p) {
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    let bomb = this._bombAtTile(cx, cy);
    if (!bomb || bomb.dir !== 0) {
      bomb = this._bombAtTile(cx + DIR_DX[p.facing + 1], cy + DIR_DY[p.facing + 1]);
      if (!bomb || bomb.dir !== 0) return;
    }
    const dest = this._throwDestination(cx, cy, p.facing + 1, bomb);
    const fromTx = bomb.tx;
    const fromTy = bomb.ty;
    bomb.fly = { fx: fromTx + 0.5, fy: fromTy + 0.5, tx: dest.tx, ty: dest.ty, left: THROW_TICKS, total: THROW_TICKS };
    bomb.tx = dest.tx;
    bomb.ty = dest.ty;
    bomb.dir = 0;
    bomb.step = 0;
    bomb.pass = [];
    this._emit('throw', p.id, bomb.id, fromTx, fromTy, dest.tx, dest.ty);
  }

  /** Candidate distances from the thrower's tile: 3, 4, ... to the last in-board tile, then 2, 1, 0. */
  _throwDestination(cx, cy, dir, bomb) {
    const dx = DIR_DX[dir];
    const dy = DIR_DY[dir];
    let dist = THROW_DIST;
    while (inBoard(cx + dx * dist, cy + dy * dist)) {
      if (this._canThrowTo(cx + dx * dist, cy + dy * dist, bomb)) return { tx: cx + dx * dist, ty: cy + dy * dist };
      dist++;
    }
    for (dist = THROW_DIST - 1; dist >= 0; dist--) {
      if (this._canThrowTo(cx + dx * dist, cy + dy * dist, bomb)) return { tx: cx + dx * dist, ty: cy + dy * dist };
    }
    return { tx: bomb.tx, ty: bomb.ty };
  }

  /** Floor, no other non-flying bomb, not the destination of another bomb in flight. Players, items and flames do not matter. */
  _canThrowTo(tx, ty, bomb) {
    if (!inBoard(tx, ty) || this.grid[ty * W + tx] !== '.') return false;
    for (const o of this.bombs) {
      if (o === bomb) continue;
      if (o.fly ? o.fly.tx === tx && o.fly.ty === ty : o.tx === tx && o.ty === ty) return false;
    }
    return true;
  }

  // ---- Explosions (step 4, §3.6a) -----------------------------------------------------------------

  /**
   * Everything due goes off in one resolution so the outcome never depends on processing order: chains grow the
   * queue, all bombs stay on the board until the chain is complete, then items are destroyed, bombs removed,
   * blocks opened and the merged flames laid down.
   */
  _resolveExplosions() {
    const bombs = this.bombs;
    const queue = [];
    for (const b of bombs) {
      if (!b.fly && (b.fuse <= 0 || this._flameGrid[b.ty * W + b.tx])) queue.push(b);
    }
    if (queue.length === 0) return;

    const bombAtTile = new Array(CELLS).fill(null);
    for (const b of bombs) if (!b.fly) bombAtTile[b.ty * W + b.tx] = b;
    const bombAt = (tx, ty) => bombAtTile[ty * W + tx];
    const boom = new Set(queue.map((b) => b.id));
    const blasts = [];
    const blocks = new Set();
    const flame = new Map();                                // tile -> { mask, owners }
    const addFlame = (tx, ty, owner, mask) => {
      const idx = ty * W + tx;
      let f = flame.get(idx);
      if (!f) flame.set(idx, f = { mask: 0, owners: [] });
      f.mask |= mask;
      if (!f.owners.includes(owner)) f.owners.push(owner);
    };

    for (let qi = 0; qi < queue.length; qi++) {
      const b = queue[qi];
      const blast = scanBlast(this.grid, bombAt, b);
      blasts.push(blast);
      let at = 1;
      let centre = 0;
      for (let d = 1; d <= 4; d++) {
        const len = blast.arms[d - 1];
        if (len > 0) centre |= DIR_BIT[d];
        for (let k = 1; k <= len; k++, at++) {
          const [tx, ty] = blast.tiles[at];
          addFlame(tx, ty, b.owner, k < len ? DIR_BIT[d] | DIR_BACK_BIT[d] : DIR_BACK_BIT[d]);   // interior: both bits of the axis, tip: towards the centre
        }
      }
      addFlame(b.tx, b.ty, b.owner, centre);
      for (const [tx, ty] of blast.blocks) blocks.add(ty * W + tx);
      for (const other of blast.hits) {
        if (!boom.has(other.id)) {
          boom.add(other.id);
          queue.push(other);
        }
      }
    }

    // (1) items that exist NOW on a flame tile die; drops of this tick's blocks do not exist yet.
    let kept = 0;
    for (const it of this.items) {
      if (flame.has(it.ty * W + it.tx)) this._emit('itemgone', it.id, it.tx, it.ty, it.kind);
      else this.items[kept++] = it;
    }
    this.items.length = kept;

    // (2) the bombs go, one `boom` each in explosion order.
    kept = 0;
    for (const b of bombs) if (!boom.has(b.id)) bombs[kept++] = b;
    bombs.length = kept;
    queue.forEach((b, i) => this._emit('boom', b.id, b.owner, b.tx, b.ty, b.range, blasts[i].tiles));

    // (3) blocks ascending: open the cell, credit the first owner, reveal the pre-rolled prize.
    for (const idx of Array.from(blocks).sort((a, b) => a - b)) {
      const tx = idx % W;
      const ty = (idx - tx) / W;
      const owner = flame.get(idx).owners[0];
      this.grid[idx] = '.';
      this.gridVer++;
      const credited = this._byId.get(owner);
      if (credited) credited.stats.blocks++;
      this._emit('block', tx, ty, owner);
      const kind = this._drops[idx];
      if (kind) {
        this._drops[idx] = null;
        const item = { id: this._nextItemId++, tx, ty, kind, born: this.tickNo };
        this.items.push(item);
        this._emit('itemspawn', item.id, tx, ty, kind);
      }
    }

    // (4) merge into the lingering flames.
    let added = false;
    for (const [idx, f] of flame) {
      const existing = this._flameGrid[idx];
      if (existing) {
        existing.mask |= f.mask;
        for (const o of f.owners) if (!existing.owners.includes(o)) existing.owners.push(o);
        existing.ticks = FLAME_TICKS;
      } else {
        const tx = idx % W;
        const rec = { tx, ty: (idx - tx) / W, ticks: FLAME_TICKS, mask: f.mask, owners: f.owners };
        this._flameGrid[idx] = rec;
        this.flames.push(rec);
        added = true;
      }
    }
    if (added) this.flames.sort(byTyTx);
  }

  // ---- Sudden-death landings (step 5, §3.2.1) -----------------------------------------------------

  _landFallingTiles() {
    const falling = this.falling;
    let kept = 0;
    for (let i = 0; i < falling.length; i++) {
      const f = falling[i];
      if (f.ticksLeft > 0) falling[kept++] = f;
      else this._sdLand(f.tx, f.ty);
    }
    falling.length = kept;
  }

  /** The tile turns into a hard wall: everything on it is removed, and every hitbox overlapping it dies (shield ignored). */
  _sdLand(tx, ty) {
    const idx = ty * W + tx;
    for (const p of this._order) {
      if (p.alive && overlapsTile(p, tx, ty)) this._killPlayer(p, -1);
    }
    let kept = 0;
    for (const b of this.bombs) {
      if (!b.fly && b.tx === tx && b.ty === ty) this._emit('bombgone', b.id, tx, ty);
      else this.bombs[kept++] = b;
    }
    this.bombs.length = kept;
    kept = 0;
    for (const it of this.items) {
      if (it.tx === tx && it.ty === ty) this._emit('itemgone', it.id, tx, ty, it.kind);
      else this.items[kept++] = it;
    }
    this.items.length = kept;
    const flame = this._flameGrid[idx];
    if (flame) {
      this._flameGrid[idx] = null;
      this.flames.splice(this.flames.indexOf(flame), 1);
    }
    this._drops[idx] = null;
    this.grid[idx] = 'X';
    this.gridVer++;
    this._emit('sdland', tx, ty);
  }

  // ---- Pickups, curses (steps 6, 7) ---------------------------------------------------------------

  _pickups() {
    const items = this.items;
    if (items.length === 0) return;
    let kept = 0;
    for (const it of items) {
      let taker = null;
      let best = 0;
      for (const p of this._order) {
        if (!p.alive || Math.floor(p.x) !== it.tx || Math.floor(p.y) !== it.ty) continue;
        const dx = p.x - (it.tx + 0.5);
        const dy = p.y - (it.ty + 0.5);
        const d2 = dx * dx + dy * dy;
        if (taker === null || d2 < best) {         // strict: ties go to the lowest id
          taker = p;
          best = d2;
        }
      }
      if (taker) this._take(taker, it);
      else items[kept++] = it;
    }
    items.length = kept;
  }

  /** The item is consumed even when its stat is already capped. */
  _take(p, item) {
    p.stats.items++;
    switch (item.kind) {
      case 'bomb': p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1); break;
      case 'flame': p.range = Math.min(MAX_RANGE, p.range + 1); break;
      case 'speed': p.speedLv = Math.min(MAX_SPEED_LV, p.speedLv + 1); break;
      case 'kick': p.kick = true; break;
      case 'glove': p.glove = true; break;
      case 'shield': p.shield = Math.max(p.shield, SHIELD_TICKS); break;
      default: break;                                    // skull: handled after the pickup event
    }
    this._emit('pickup', item.id, p.id, item.kind, item.tx, item.ty);
    if (item.kind === 'skull' && this.state === STATE.PLAYING) {
      const kind = this._rng.pick(CURSE_KINDS.filter((k) => k !== p.curse));
      this._setCurse(p, kind, -1);
    }
  }

  _setCurse(p, kind, fromId) {
    p.curse = kind;
    p.curseTicks = CURSE_TICKS;
    p.spamCd = 0;
    this._emit('curse', p.id, kind, fromId);
  }

  _clearCurse(p) {
    if (p.curse === null) return;
    p.curse = null;
    p.curseTicks = 0;
    this._emit('curse', p.id, 0, -1);
  }

  /** A cursed fighter passes the curse to the nearest healthy fighter within touching distance. */
  _curseTransfers() {
    for (const g of this._order) {
      if (!g.alive || g.curse === null || g.curseCooldown > 0) continue;
      let target = null;
      let best = 0;
      for (const h of this._order) {
        if (h === g || !h.alive || h.curse !== null || h.curseCooldown > 0) continue;
        const dx = h.x - g.x;
        const dy = h.y - g.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= CURSE_TOUCH_R2 && (target === null || d2 < best)) {
          target = h;
          best = d2;
        }
      }
      if (!target) continue;
      const kind = g.curse;
      g.curse = null;
      g.curseTicks = 0;
      g.curseCooldown = CURSE_XFER_COOLDOWN;
      target.curseCooldown = CURSE_XFER_COOLDOWN;
      this._setCurse(target, kind, g.id);
    }
  }

  // ---- Deaths (step 8, §3.6d) ---------------------------------------------------------------------

  _killCheck() {
    for (const p of this._order) {
      if (!p.alive) continue;
      const idx = Math.floor(p.y) * W + Math.floor(p.x);
      if (this.grid[idx] !== '.') {                     // safety net: nobody lives inside a wall or a block
        this._killPlayer(p, -1);
        continue;
      }
      const flame = this._flameGrid[idx];
      if (!flame) continue;
      if (p.shield > 0 || p.spawnShield > 0) {
        if (this.tickNo - p.lastShieldHit >= SHIELDHIT_GAP_TICKS) {
          p.lastShieldHit = this.tickNo;
          this._emit('shieldhit', p.id, round3(p.x), round3(p.y));
        }
        continue;
      }
      this._killPlayer(p, this._flameCredit(p, flame.owners));
    }
    this._checkShowdown();
  }

  _isEnemy(victim, ownerId) {
    const owner = this._byId.get(ownerId);
    return owner !== undefined && ownerId !== victim.id && (this.mode !== 'teams' || owner.team !== victim.team);
  }

  /** Killer = first enemy owner of the flame tile; else the victim (own goal); else owners[0] (a teammate, or -1 for an orphan). */
  _flameCredit(victim, owners) {
    for (const o of owners) {
      if (this._isEnemy(victim, o)) {
        this._byId.get(o).stats.kills++;
        return o;
      }
    }
    if (owners.includes(victim.id)) {
      victim.stats.selfKills++;
      return victim.id;
    }
    return owners[0];
  }

  _killPlayer(p, killer) {
    p.alive = false;
    p.moving = false;
    p.deathTick = this.tickNo;
    p.killer = killer;
    p.stats.deaths++;
    this._aliveDirty = true;
    this._emit('death', p.id, killer, round3(p.x), round3(p.y));
    this._clearCurse(p);
  }

  /** When the last alive human is gone but a fight remains, shorten the clock so bot-only endgames stay short. */
  _checkShowdown() {
    if (!this._aliveDirty) return;
    this._aliveDirty = false;
    if (this._showdownDone || !this.sdEnabled || !this._hasHumans) return;
    let humans = 0;
    let alive = 0;
    let teamsAlive = 0;
    for (const p of this._order) {
      if (!p.alive) continue;
      alive++;
      if (!p.isBot) humans++;
      teamsAlive |= 1 << (p.team === 1 ? 1 : 0);
    }
    if (humans > 0 || alive < 2 || (this.mode === 'teams' && teamsAlive !== 3)) return;
    this._showdownDone = true;
    if (this.timeLeft > SHOWDOWN_TICKS) {
      this.timeLeft = SHOWDOWN_TICKS;
      this._emit('showdown');
    }
  }

  // ---- Ageing and the end of the tick (steps 9, 10) -----------------------------------------------

  _age(playing) {
    const flames = this.flames;
    let kept = 0;
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      if (--f.ticks > 0) flames[kept++] = f;
      else this._flameGrid[f.ty * W + f.tx] = null;
    }
    flames.length = kept;

    for (const p of this._order) {
      if (playing && p.alive) {
        if (p.shield > 0 && p.shield !== SHIELD_FOREVER) p.shield--;
        if (p.spawnShield > 0) p.spawnShield--;
        if (p.curseCooldown > 0) p.curseCooldown--;
        if (p.curse !== null && --p.curseTicks === 0) this._clearCurse(p);
      }
      if (!p._ran) p.moving = false;                    // no movePlayer since the last tick: do not look like walking
      p._ran = false;
    }
  }

  /** Step 10: evaluate the outcome ONCE on the alive set after this tick's deaths; count down the ending. */
  _finishTick(playing) {
    if (!playing) {
      if (this.state === STATE.ENDING && --this._endingLeft === 0) this.state = STATE.OVER;
      return;
    }
    let alive = 0;
    let last = null;
    const aliveTeam = this._aliveTeam;
    aliveTeam[0] = aliveTeam[1] = 0;
    for (const p of this._order) {
      if (!p.alive) continue;
      alive++;
      last = p;
      aliveTeam[p.team === 1 ? 1 : 0]++;
    }
    if (this.mode === 'teams') {
      const teams = (aliveTeam[0] > 0 ? 1 : 0) + (aliveTeam[1] > 0 ? 1 : 0);
      if (teams === 0) this._lock(null, null, 'wipe');
      else if (teams === 1) this._lock(null, aliveTeam[1] > 0 ? 1 : 0, 'last');
      else if (this._timeUp) this._lock(null, null, 'timeout');
    } else if (alive === 0) {
      this._lock(null, null, 'wipe');
    } else if (alive === 1) {
      this._lock(last.id, null, 'last');
    } else if (this._timeUp) {
      this._lock(null, null, 'timeout');
    }
  }

  /** Freezes the outcome: survivors become unkillable, sudden death and curses stop. */
  _lock(winnerId, winnerTeam, reason) {
    this.outcome = { winnerId, winnerTeam, draw: winnerId === null && winnerTeam === null, reason, tick: this.tickNo };
    this.state = STATE.ENDING;
    this._endingLeft = ENDING_TICKS;
    this._sdFrozen = true;
    this.falling.length = 0;
    for (const p of this._order) {
      if (!p.alive) continue;
      this._clearCurse(p);
      p.shield = SHIELD_FOREVER;
      p.spawnShield = 0;
    }
  }

  // ---- Snapshot (Appendix A.2): a PURE READ -------------------------------------------------------

  /**
   * @param {{ grid?: boolean, evFrom?: number|null }} [opts] `g` is present iff grid === true;
   *   `e` = eventsSince(evFrom) when evFrom is a number, else [].
   */
  snapshot({ grid = false, evFrom = null } = {}) {
    const k = this.tickNo;
    const ack = {};
    const p = new Array(this.players.length);
    for (let i = 0; i < p.length; i++) {
      const pl = this.players[i];
      const row = new Array(13);
      row[P.ID] = pl.id;
      row[P.X] = round3(pl.x);
      row[P.Y] = round3(pl.y);
      row[P.F] = pl.facing;
      row[P.FL] = (pl.moving ? PF.MOVING : 0) | (pl.alive ? PF.ALIVE : 0) | (pl.kick ? PF.KICK : 0) | (pl.glove ? PF.GLOVE : 0);
      row[P.SH] = pl.shield;
      row[P.SS] = pl.spawnShield;
      row[P.CU] = pl.curse === null ? 0 : pl.curse;
      row[P.CT] = pl.curse === null ? 0 : pl.curseTicks;
      row[P.BM] = pl.bombsMax;
      row[P.RG] = pl.range;
      row[P.SP] = pl.speedLv;
      row[P.DT] = pl.alive ? 0 : Math.min(255, k - pl.deathTick);
      p[i] = row;
      if (!pl.isBot && !pl.removed) ack[pl.id] = pl.lastSeq;
    }

    const b = new Array(this.bombs.length);
    for (let i = 0; i < b.length; i++) {
      const bomb = this.bombs[i];
      const row = new Array(11);
      row[B.I] = bomb.id;
      row[B.O] = bomb.owner;
      row[B.X] = round3(bomb.x);
      row[B.Y] = round3(bomb.y);
      row[B.TX] = bomb.tx;
      row[B.TY] = bomb.ty;
      row[B.FU] = bomb.fuse;
      row[B.RG] = bomb.range;
      row[B.D] = bomb.dir;
      row[B.FL] = bomb.fly ? [bomb.fly.fx, bomb.fly.fy, bomb.fly.tx + 0.5, bomb.fly.ty + 0.5, bomb.fly.left, bomb.fly.total] : 0;
      row[B.PS] = bomb.pass.slice();
      b[i] = row;
    }

    const snap = {
      t: 'snap',
      k,
      st: this.state,
      cd: this.state === STATE.COUNTDOWN ? this.countdown : 0,
      r: this.timeLeft,
      sd: this.suddenDeath ? 1 : 0,
      gv: this.gridVer,
      ack,
      p,
      b,
      f: this.flames.map((f) => [f.tx, f.ty, f.mask, f.ticks]),
      i: this.items.map((it) => [it.id, it.tx, it.ty, it.kind, k - it.born]),
      fall: this.falling.map((f) => [f.tx, f.ty, f.ticksLeft]),
    };
    if (grid === true) snap.g = this.grid.join('');
    snap.e = typeof evFrom === 'number' ? this.eventsSince(evFrom) : [];
    return snap;
  }
}
