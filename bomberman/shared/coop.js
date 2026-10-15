// The co-op half of the World (docs/SPEC.md Appendix C): what changes when everybody plays on one side.
//
//   mode 'coop'       every human (plus lobby bots as helpers) is team 0 against a wave of enemy bots (team 1) that the Room adds.
//                     Team-mates' flames never hurt each other; your own bomb still does. The wave is cleared when no enemy is left,
//                     lost when no team-0 fighter is left (or the clock runs out with sudden death off).
//   mode 'adventure'  the team clears LEVELS: monsters roam a generated map, an exit door hides under one soft block and opens once
//                     every monster is gone; the first team member to step on the open door clears the level. Shared lives: a downed
//                     human comes back at their spawn after RESPAWN_TICKS while lives remain. No sudden death; when the level clock runs
//                     out two angry monsters join in ("Hurry up!").
//
// CoopState is created by the World constructor only for these two modes and is called from fixed points of World.tick() (see
// world.js), so 'ffa' and 'teams' never run a line of this file. It reads and writes the World's own state (grid, bombs, flames, the
// fighter list, the seeded rng, the event log): it is part of the simulation, not a client of it, and is as deterministic as the rest
// (the World's rng only, ascending ids everywhere, no clocks).
//
// Monsters are not fighters: they never appear in `players`, they move tile to tile (a classic Bomberman monster commits to the next
// tile and turns only on tile centres), and they are drawn from the snapshot key `m`.

import {
  DT, GRID_W, GRID_H, DIR_DX, DIR_DY, SPAWN_SLOTS, SPAWN_SHIELD_TICKS, SHIELDHIT_GAP_TICKS, START_BOMBS, START_RANGE,
  MAX_BOMBS, MAX_RANGE, MAX_SPEED_LV, MAX_ROUND_TICKS, ADVENTURE_LIVES, RESPAWN_TICKS, CLEAR_POINTS, ENEMY_POINTS,
  MONSTER_TOUCH, MONSTER_DEFS, MONSTER_KINDS, MAX_PLAYERS, BOT_LEVELS,
} from './constants.js';
import { M, MF } from './protocol.js';

const W = GRID_W;
const H = GRID_H;
const CELLS = W * H;
const REV = [0, 3, 4, 1, 2];
const SIDES = Object.freeze([Object.freeze([0, 3, 6]), Object.freeze([4, 5]), Object.freeze([1, 2, 7])]);   // SPAWN_SLOTS on the left, middle, right
const round3 = (v) => Math.round(v * 1000) / 1000;
const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

/** Killer id of a death caused by a monster (the `death` event's killerId; -1 stays "sudden death / orphaned bomb"). */
export const MONSTER_KILLER = -3;

const HURT_TICKS = 50;            // a monster that took a hit (or was just born from a split) is invulnerable and flashes; > FLAME_TICKS
const STUN_TICKS = 30;            // ... and a tank stands dazed for this long before it charges
const ANGRY_BOOST = 1.7;          // speed factor of a tank after its first hit
const IDLE_RETRY = 20;            // ticks a boxed-in monster waits before it looks for a way out again
const MAX_MONSTERS = 24;          // splits and hurry-ups can never flood the board
const LEVEL_SPEEDUP = 0.035;      // monsters get this much faster per level
const DIFF_SPEED = Object.freeze({ easy: 0.85, normal: 1, hard: 1.12 });
const DIFF_CHASE = Object.freeze({ easy: 0.55, normal: 0.8, hard: 0.95 });   // chance a chaser takes the step towards you
const DIFF_KEEP = 0.7;            // chance a wanderer keeps going straight at a crossing
const MAX_LIVES = 9;              // the shared lives never pile up beyond this
const RESPAWN_CLEAR = 4;          // tiles: a monster this close to your spawn sends your comeback to the safest spawn instead

/**
 * The adventure, level by level: arena layout and crate density, a factor on the item drop chance (later levels give less), and the
 * monsters. Kinds come in gradually: balloons, then zippies, ghosts, tanks, jellies.
 */
export const ADVENTURE_TABLE = Object.freeze([
  { layout: 'classic', blocks: 'few', drops: 1, monsters: { puff: 3 } },
  { layout: 'classic', blocks: 'normal', drops: 1, monsters: { puff: 3, zippy: 1 } },
  { layout: 'open', blocks: 'normal', drops: 0.9, monsters: { puff: 2, zippy: 1, ghost: 2 } },
  { layout: 'classic', blocks: 'normal', drops: 0.85, monsters: { puff: 1, zippy: 2, ghost: 1, tank: 1 } },
  { layout: 'classic', blocks: 'many', drops: 0.8, monsters: { puff: 1, zippy: 1, ghost: 1, tank: 1, jelly: 2 } },
  { layout: 'open', blocks: 'normal', drops: 0.75, monsters: { zippy: 2, ghost: 2, tank: 1, jelly: 1 } },
  { layout: 'classic', blocks: 'many', drops: 0.7, monsters: { zippy: 2, ghost: 2, tank: 2, jelly: 2 } },
  { layout: 'classic', blocks: 'normal', drops: 0.65, monsters: { zippy: 3, ghost: 2, tank: 2, jelly: 2 } },
].map((l) => Object.freeze({ ...l, monsters: Object.freeze(l.monsters) })));

/** The level's plan for a team of `team` fighters at `difficulty` (levels past the table repeat the last one). */
export function adventureLevel(level, difficulty = 'normal', team = 1) {
  const base = ADVENTURE_TABLE[Math.min(Math.max(level, 1), ADVENTURE_TABLE.length) - 1];
  const counts = { ...base.monsters };
  const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  // Bigger teams meet more monsters: one more of the level's toughest kind per two extra fighters.
  const toughest = MONSTER_KINDS.filter((k) => counts[k]).at(-1);
  counts[toughest] += Math.floor((team - 1) / 2);
  if (difficulty === 'easy' && total() > 2) {
    const most = MONSTER_KINDS.filter((k) => counts[k]).reduce((a, k) => (counts[k] >= counts[a] ? k : a));
    counts[most]--;
  } else if (difficulty === 'hard') {
    counts.zippy = (counts.zippy ?? 0) + 1;
  }
  const monsters = [];
  for (const kind of MONSTER_KINDS) for (let i = 0; i < (counts[kind] ?? 0); i++) monsters.push(kind);
  return { layout: base.layout, blocks: base.blocks, drops: base.drops, monsters };
}

/**
 * The enemy bots of coop wave `n` for a team of `side` fighters: as many as the team at first, one more every second wave from wave 3
 * (hard: one more from the start), never more than the free seats and never none; smarter bots as the waves go on (the difficulty moves
 * the whole curve, easy never goes past normal bots), and power-ups they start with from wave 2. (Measured with scripts/dev/coop/sim.mjs:
 * a team one bigger than the enemy from wave 1 lost too often to be fun for a child playing alone.)
 * @returns {{ level: 'easy'|'normal'|'hard', start: object }[]}
 */
export function coopWavePlan(n, difficulty = 'normal', side = 1) {
  const extra = Math.floor((n - 1) / 2) + (difficulty === 'hard' ? 1 : 0);
  const count = Math.max(1, Math.min(MAX_PLAYERS - side, side + extra));
  const base = Math.max(0, BOT_LEVELS.indexOf(difficulty));
  const plan = [];
  for (let i = 0; i < count; i++) {
    const at = Math.min(Math.min(2, base + 1), Math.max(0, Math.floor((base * 3 - 2 + (n - 1) + (i % 3)) / 3)));
    plan.push({
      level: BOT_LEVELS[at],
      start: {
        bombsMax: Math.min(MAX_BOMBS, 1 + Math.floor((n - 1) / 3)),
        range: Math.min(MAX_RANGE, 2 + Math.floor((n - 1) / 2)),
        speedLv: Math.min(3, Math.floor((n - 1) / 2)),
        kick: n >= 4,
      },
    });
  }
  return plan;
}

/**
 * What a coop team member starts a wave with: what they carried out of the last wave, and on 'easy' at least an extra bomb, a longer
 * blast and a little speed (a head start that turned a coin flip against the first wave into a fair chance for a small child).
 */
export function coopTeamStart(difficulty, carry) {
  if (difficulty !== 'easy') return carry ?? undefined;
  const c = carry ?? {};
  return {
    ...c,
    bombsMax: Math.max(c.bombsMax ?? START_BOMBS, START_BOMBS + 1),
    range: Math.max(c.range ?? START_RANGE, START_RANGE + 1),
    speedLv: Math.max(c.speedLv ?? 0, 1),
  };
}

/** Coop waves drop fewer power-ups as they go on: one step down every third wave, but never down to none unless chosen. */
export function coopWaveItems(n, items) {
  const steps = ['none', 'few', 'normal', 'many'];
  const at = steps.indexOf(items);
  if (at <= 1) return items;
  return steps[Math.max(1, at - Math.floor((n - 1) / 3))];
}

/** Shared lives at the start of an adventure. */
export const startingLives = (difficulty, humans) => (ADVENTURE_LIVES[difficulty] ?? ADVENTURE_LIVES.normal) + Math.max(0, humans - 1);

/**
 * Spawn slots of a co-op round: team 0 fills the left side first (then the middle, then the right), team 1 the right side first. Slot
 * order inside each side is shuffled with the World's rng, so a party does not always spawn in the same corners.
 */
export function assignSidedSlots(fighters, rng) {
  const order = [...rng.shuffle(SIDES[0].slice()), ...rng.shuffle(SIDES[1].slice()), ...rng.shuffle(SIDES[2].slice())];
  const slots = new Array(fighters.length);
  let lo = 0;
  let hi = order.length - 1;
  fighters.forEach((f, i) => { if (f.team !== 1) slots[i] = order[lo++]; });
  fighters.forEach((f, i) => { if (f.team === 1) slots[i] = order[hi--]; });
  return slots;
}

/** Clamped starting power-ups carried over from the last level or wave (or given to enemy bots). */
export function startStats(start) {
  const s = start && typeof start === 'object' ? start : {};
  const int = (v, lo, hi, def) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : def);
  return {
    bombsMax: int(s.bombsMax, START_BOMBS, MAX_BOMBS, START_BOMBS),
    range: int(s.range, START_RANGE, MAX_RANGE, START_RANGE),
    speedLv: int(s.speedLv, 0, MAX_SPEED_LV, 0),
    kick: s.kick === true,
    glove: s.glove === true,
  };
}

export class CoopState {
  /**
   * @param {import('./world.js').World} world  constructed up to its map and slots
   * @param {{ level?: number, difficulty?: string, lives?: number, score?: number }} opts
   * @param {(string|null)[]} drops the map's hidden prizes (server-only); the door's block loses its prize
   */
  constructor(world, opts, drops) {
    this.w = world;
    this.kind = world.mode;                                    // 'coop' | 'adventure'
    this.level = Number.isInteger(opts.level) && opts.level > 0 ? opts.level : 1;
    this.difficulty = DIFF_SPEED[opts.difficulty] ? opts.difficulty : 'normal';
    this.score = Number.isInteger(opts.score) && opts.score > 0 ? opts.score : 0;
    this.adventure = this.kind === 'adventure';
    const humans = world.players.filter((p) => !p.isBot).length;
    this.lives = this.adventure ? (Number.isInteger(opts.lives) && opts.lives >= 0 ? opts.lives : startingLives(this.difficulty, humans)) : -1;
    this.monsters = [];
    this.door = null;                                          // { tx, ty, idx, revealed, open }
    this.respawnAt = new Map();                                // fighter id -> tick of its comeback
    this.hurried = false;
    this._nextMonsterId = 1;
    this._seen = new Int32Array(CELLS);                        // BFS scratch (generation-stamped, so it is never cleared)
    this._from = new Int8Array(CELLS);
    this._queue = new Int16Array(CELLS);
    this._gen = 0;
    this._speed = DIFF_SPEED[this.difficulty] * (1 + LEVEL_SPEEDUP * (this.level - 1));
    this._chase = DIFF_CHASE[this.difficulty];
    if (this.adventure) this._setUpLevel(drops);
  }

  // ---- Level set-up (adventure) ----------------------------------------------------------------------

  /**
   * Spawn tiles the monsters keep away from: every slot of a side (left, middle, right) where a fighter starts. Only the used slots
   * would let a balloon start in the gap between two players in the left corners, five steps from each and right on their way.
   */
  _guardedSlots() {
    const used = new Set(this.w.players.map((p) => p.slot));
    const out = [];
    for (const side of SIDES) if (side.some((slot) => used.has(slot))) for (const slot of side) out.push(SPAWN_SLOTS[slot]);
    return out;
  }

  _farFromSlots(tx, ty, d, slots = this.w.players.map((p) => SPAWN_SLOTS[p.slot])) {
    for (const [sx, sy] of slots) if (manhattan(tx, ty, sx, sy) < d) return false;
    return true;
  }

  /** Door first (under a crate away from the start), then the monsters on cleared floor far from every fighter. RNG order is fixed. */
  _setUpLevel(drops) {
    const w = this.w;
    const grid = w.grid;
    const plan = adventureLevel(this.level, this.difficulty, w.players.length);

    let doorIdx = -1;
    for (const minDist of [6, 4, 0]) {
      const cands = [];
      for (let i = 0; i < CELLS; i++) if (grid[i] === '+' && this._farFromSlots(i % W, (i - (i % W)) / W, minDist)) cands.push(i);
      if (cands.length) { doorIdx = cands[w._rng.int(cands.length)]; break; }
    }
    let revealed = false;
    if (doorIdx < 0) {                                         // no crate left at all (cannot happen with the level table): a visible door
      for (let i = 0; i < CELLS && doorIdx < 0; i++) if (grid[i] === '.' && this._farFromSlots(i % W, (i - (i % W)) / W, 4)) doorIdx = i;
      revealed = true;
    }
    if (doorIdx >= 0) {
      drops[doorIdx] = null;
      this.door = { tx: doorIdx % W, ty: (doorIdx - (doorIdx % W)) / W, idx: doorIdx, revealed, open: false };
    }

    let cands = [];
    const guarded = this._guardedSlots();
    for (const minDist of [5, 4, 3]) {
      cands = [];
      for (let i = 0; i < CELLS; i++) {
        if (grid[i] === '#' || i === doorIdx) continue;
        if (this._farFromSlots(i % W, (i - (i % W)) / W, minDist, guarded)) cands.push(i);
      }
      if (cands.length >= plan.monsters.length * 2) break;
    }
    w._rng.shuffle(cands);
    const chosen = [];
    for (const spread of [3, 2, 1]) {
      for (const i of cands) {
        if (chosen.length >= plan.monsters.length) break;
        if (chosen.includes(i)) continue;
        if (chosen.every((j) => manhattan(i % W, (i - (i % W)) / W, j % W, (j - (j % W)) / W) >= spread)) chosen.push(i);
      }
    }
    chosen.forEach((idx, k) => {
      const tx = idx % W;
      const ty = (idx - tx) / W;
      if (grid[idx] === '+') { grid[idx] = '.'; drops[idx] = null; }
      if (!this._hasFloorNeighbour(tx, ty)) {                  // never start boxed in: open the first crate around (not the door's)
        for (let d = 1; d <= 4; d++) {
          const n = (ty + DIR_DY[d]) * W + tx + DIR_DX[d];
          if (grid[n] === '+' && n !== doorIdx) { grid[n] = '.'; drops[n] = null; break; }
        }
      }
      this._addMonster(plan.monsters[k], tx, ty, 0, false);
    });
  }

  _hasFloorNeighbour(tx, ty) {
    for (let d = 1; d <= 4; d++) if (this.w.grid[(ty + DIR_DY[d]) * W + tx + DIR_DX[d]] === '.') return true;
    return false;
  }

  _addMonster(kind, tx, ty, hurt, announce) {
    const def = MONSTER_DEFS[kind];
    const m = {
      id: this._nextMonsterId++, kind, x: tx + 0.5, y: ty + 0.5, tx, ty, dir: 0, facing: 2, hp: def.hp,
      hurt, stun: 0, angry: false, wait: 0, speed: def.speed * this._speed,
    };
    this.monsters.push(m);
    if (announce) this.w._emit('mspawn', m.id, kind, m.x, m.y);
    return m;
  }

  // ---- Rules the World asks about ---------------------------------------------------------------------

  /** Whether a flame tile with these owners hurts `victim`: your own bombs and the other team's do, team-mates' and orphans' do not. */
  hurts(victim, owners) {
    for (const o of owners) {
      if (o === victim.id) return true;
      const owner = this.w.player(o);
      if (owner !== undefined && owner.team !== victim.team) return true;
    }
    return false;
  }

  /** A kicked bomb stops in front of a monster, as it does in front of a fighter. */
  monsterOn(tx, ty) {
    for (const m of this.monsters) if (Math.floor(m.x) === tx && Math.floor(m.y) === ty) return true;
    return false;
  }

  /** Step 4, block (3): a crate opened. The door under it shows up. */
  onBlockOpened(idx) {
    const door = this.door;
    if (!door || door.revealed || door.idx !== idx) return;
    door.revealed = true;
    this.w._emit('door', door.tx, door.ty, door.open ? 1 : 0);
  }

  /** A fighter went down. A human of the adventure team spends a life (if any is left) and is booked for a comeback. */
  onDeath(p, killer) {
    const w = this.w;
    if (this.kind === 'coop' && p.team === 1 && killer >= 0) {
      const k = w.player(killer);
      if (k && k.team === 0) this.score += ENEMY_POINTS;
    }
    if (!this.adventure || p.isBot || p.removed) return;
    if (this.lives > 0) {
      this.lives--;
      this.respawnAt.set(p.id, w.tickNo + RESPAWN_TICKS);
      w._emit('life', p.id, this.lives);
    }
  }

  onRemoved(p) {
    this.respawnAt.delete(p.id);
  }

  // ---- Tick hooks ---------------------------------------------------------------------------------------

  /** Step 2: the level clock ran out. Two angry zippies join in; the clock then stops (the HUD shows "Hurry up!"). */
  hurry() {
    const w = this.w;
    this.hurried = true;
    w.timeLeft = -1;
    w._emit('hurry');
    const cands = [];
    for (let i = 0; i < CELLS; i++) if (w.grid[i] === '.' && this._farFromFighters(i % W, (i - (i % W)) / W, 6)) cands.push(i);
    for (let k = 0; k < 2 && cands.length && this.monsters.length < MAX_MONSTERS; k++) {
      const at = cands.splice(w._rng.int(cands.length), 1)[0];
      const m = this._addMonster('zippy', at % W, (at - (at % W)) / W, HURT_TICKS, true);
      m.angry = true;
    }
  }

  _farFromFighters(tx, ty, d) {
    for (const p of this.w._order) if (p.alive && manhattan(tx, ty, Math.floor(p.x), Math.floor(p.y)) < d) return false;
    return true;
  }

  /** Step 3m (PLAYING): every monster takes its step, ascending id. */
  moveMonsters() {
    const list = this.monsters;
    for (let i = 0; i < list.length; i++) this._move(list[i]);
  }

  /** May monster `m` enter tile (tx, ty)? Floor (ghosts: crates too) without a standing bomb. */
  _passable(m, tx, ty) {
    if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return false;
    const c = this.w.grid[ty * W + tx];
    if (c !== '.' && !(c === '+' && MONSTER_DEFS[m.kind].ghost)) return false;
    return !this.w._bombAtTile(tx, ty);
  }

  _move(m) {
    if (m.stun > 0) return;
    if (m.dir === 0) {
      if (m.wait > 0) { m.wait--; return; }
      this._decide(m);
      return;
    }
    if (!this._passable(m, m.tx, m.ty)) {                     // a bomb appeared ahead: turn back to the tile it came from
      const bx = m.tx - DIR_DX[m.dir];
      const by = m.ty - DIR_DY[m.dir];
      if (!this._passable(m, bx, by)) return;                  // boxed in between two bombs: hold still until one goes off
      m.dir = REV[m.dir];
      m.facing = m.dir - 1;
      m.tx = bx;
      m.ty = by;
    }
    const step = m.speed * (m.angry ? ANGRY_BOOST : 1) * DT;
    const cx = m.tx + 0.5;
    const cy = m.ty + 0.5;
    const dist = Math.abs(cx - m.x) + Math.abs(cy - m.y);
    if (dist > step) {
      m.x += DIR_DX[m.dir] * step;
      m.y += DIR_DY[m.dir] * step;
      return;
    }
    m.x = cx;
    m.y = cy;
    this._decide(m);
  }

  /** On a tile centre: where next? Chasers head for the nearest fighter in range (most of the time), everyone else wanders. */
  _decide(m) {
    const rng = this.w._rng;
    const tx = m.tx;
    const ty = m.ty;
    let open = 0;
    for (let d = 1; d <= 4; d++) if (this._passable(m, tx + DIR_DX[d], ty + DIR_DY[d])) open |= 1 << d;
    if (open === 0) {
      m.dir = 0;
      m.wait = IDLE_RETRY;
      return;
    }
    let d = 0;
    const def = MONSTER_DEFS[m.kind];
    const radius = m.angry ? 10 : def.chase;
    if (radius > 0) {
      const target = this._nearestFighter(tx, ty, radius);
      if (target && rng.next() < this._chase) d = this._firstStep(m, tx, ty, Math.floor(target.x), Math.floor(target.y), radius * 2);
    }
    if (d === 0) {
      const straight = m.dir;
      if (straight !== 0 && (open & (1 << straight)) && rng.next() < DIFF_KEEP) {
        d = straight;
      } else {
        const back = REV[straight];
        let choices = 0;
        for (let k = 1; k <= 4; k++) if ((open & (1 << k)) && k !== back) choices++;
        if (choices === 0) d = back;                            // a dead end: turn round
        else {
          let pick = rng.int(choices);
          for (let k = 1; k <= 4; k++) {
            if (!(open & (1 << k)) || k === back) continue;
            if (pick-- === 0) { d = k; break; }
          }
        }
      }
    }
    m.dir = d;
    m.facing = d - 1;
    m.tx = tx + DIR_DX[d];
    m.ty = ty + DIR_DY[d];
  }

  _nearestFighter(tx, ty, radius) {
    let best = null;
    let bestD = radius + 1;
    for (const p of this.w._order) {
      if (!p.alive || p.team !== 0) continue;
      const d = manhattan(tx, ty, Math.floor(p.x), Math.floor(p.y));
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** First direction of a shortest walk from (sx, sy) to (gx, gy) over tiles this monster may enter, within `depth` steps; 0 if none. */
  _firstStep(m, sx, sy, gx, gy, depth) {
    const seen = this._seen;
    const from = this._from;
    const queue = this._queue;
    const gen = ++this._gen;
    const start = sy * W + sx;
    const goal = gy * W + gx;
    if (start === goal) return 0;
    seen[start] = gen;
    let head = 0;
    let tail = 0;
    for (let d = 1; d <= 4; d++) {
      const nx = sx + DIR_DX[d];
      const ny = sy + DIR_DY[d];
      if (!this._passable(m, nx, ny)) continue;
      const n = ny * W + nx;
      seen[n] = gen;
      from[n] = d;
      if (n === goal) return d;
      queue[tail++] = n;
    }
    for (let steps = 1; head < tail && steps < depth; steps++) {
      for (let end = tail; head < end; head++) {
        const t = queue[head];
        const x = t % W;
        const y = (t - x) / W;
        for (let d = 1; d <= 4; d++) {
          const nx = x + DIR_DX[d];
          const ny = y + DIR_DY[d];
          const n = ny * W + nx;
          if (seen[n] === gen || !this._passable(m, nx, ny)) continue;
          seen[n] = gen;
          from[n] = from[t];
          if (n === goal) return from[n];
          queue[tail++] = n;
        }
      }
    }
    return 0;
  }

  /** Step 4m (PLAYING): monsters standing in fire take a hit. A jelly bursts into two minis, the last monster opens the door. */
  burnMonsters() {
    const w = this.w;
    const list = this.monsters;
    let kept = 0;
    const born = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const flame = m.hurt > 0 ? null : w._flameGrid[Math.floor(m.y) * W + Math.floor(m.x)];
      if (!flame) { list[kept++] = m; continue; }
      const credit = flame.owners[0];
      if (--m.hp > 0) {
        m.hurt = HURT_TICKS;
        m.stun = STUN_TICKS;
        m.angry = true;
        w._emit('mhit', m.id, m.kind, round3(m.x), round3(m.y), credit);
        list[kept++] = m;
        continue;
      }
      const def = MONSTER_DEFS[m.kind];
      this.score += def.points;
      const p = w.player(credit);
      if (p) p.stats.monsters++;
      w._emit('mdeath', m.id, m.kind, round3(m.x), round3(m.y), credit, def.points);
      if (def.split) born.push([def.split, Math.floor(m.x), Math.floor(m.y)]);
    }
    list.length = kept;
    for (const [kind, tx, ty] of born) {
      for (let k = 0; k < 2 && list.length < MAX_MONSTERS; k++) this._addMonster(kind, tx, ty, HURT_TICKS, true);
    }
    const door = this.door;
    if (door && !door.open && list.length === 0) {
      door.open = true;
      if (door.revealed) w._emit('door', door.tx, door.ty, 1);
    }
  }

  /** Step 8m (PLAYING): a monster that touches a fighter catches them, unless a shield holds. */
  touchFighters() {
    const w = this.w;
    if (this.monsters.length === 0) return;
    for (const p of w._order) {
      if (!p.alive) continue;
      for (const m of this.monsters) {
        if (Math.abs(m.x - p.x) >= MONSTER_TOUCH || Math.abs(m.y - p.y) >= MONSTER_TOUCH) continue;
        if (p.shield > 0 || p.spawnShield > 0) {
          if (w.tickNo - p.lastShieldHit >= SHIELDHIT_GAP_TICKS) {
            p.lastShieldHit = w.tickNo;
            w._emit('shieldhit', p.id, round3(p.x), round3(p.y));
          }
          break;
        }
        w._killPlayer(p, MONSTER_KILLER);
        break;
      }
    }
  }

  /** Step 8r (PLAYING): downed humans whose time has come stand up again at their own spawn, shielded. */
  respawns() {
    const w = this.w;
    if (this.respawnAt.size === 0) return;
    for (const p of w._order) {
      const at = this.respawnAt.get(p.id);
      if (at === undefined || at > w.tickNo) continue;
      this.respawnAt.delete(p.id);
      if (p.removed || p.alive) continue;
      const [tx, ty] = SPAWN_SLOTS[this._respawnSlot(p)];
      p.alive = true;
      p.x = tx + 0.5;
      p.y = ty + 0.5;
      p.facing = 2;
      p.moving = false;
      p.killer = -1;
      p.deathTick = -1;
      p.shield = 0;
      p.spawnShield = SPAWN_SHIELD_TICKS;
      p.curseCooldown = 0;
      const bomb = w._bombAtTile(tx, ty);
      if (bomb && !bomb.pass.includes(p.id)) bomb.pass.push(p.id);   // never stand up inside a bomb you cannot leave
      w._emit('respawn', p.id, p.x, p.y);
    }
  }

  /**
   * Where a downed fighter stands up: their own spawn unless a monster is within RESPAWN_CLEAR steps of it, then the spawn slot
   * farthest from every monster (ties: the lowest slot). A monster parked on a spawn must not catch the same child three times.
   */
  _respawnSlot(p) {
    const far = (slot) => {
      const [sx, sy] = SPAWN_SLOTS[slot];
      let d = 99;
      for (const m of this.monsters) d = Math.min(d, manhattan(sx, sy, Math.floor(m.x), Math.floor(m.y)));
      return d;
    };
    if (far(p.slot) >= RESPAWN_CLEAR) return p.slot;
    let best = p.slot;
    let bestD = far(p.slot);
    for (let slot = 0; slot < SPAWN_SLOTS.length; slot++) {
      const d = far(slot);
      if (d > bestD) { best = slot; bestD = d; }
    }
    return best;
  }

  /** Step 9 (PLAYING): monster timers. */
  age() {
    for (const m of this.monsters) {
      if (m.hurt > 0) m.hurt--;
      if (m.stun > 0) m.stun--;
    }
  }

  /**
   * Step 10: the co-op outcome, or null to play on. Returns the arguments of World._lock: [winnerId, winnerTeam, reason].
   * coop: 'clear' when no enemy stands, 'wipe' when no team-mate does (both at once: the team lost), 'timeout' when the clock ran out.
   * adventure: 'clear' when a team member stands on the open door, 'wipe' when nobody of the team is up (helper bots count: a child
   *   out of lives watches the helpers try to finish the level) and nobody is waiting to come back.
   */
  outcome(timeUp, playTicks) {
    const w = this.w;
    if (this.adventure) {
      const door = this.door;
      if (door && door.open && door.revealed) {
        for (const p of w._order) {
          if (p.alive && p.team === 0 && Math.floor(p.x) === door.tx && Math.floor(p.y) === door.ty) {
            w._emit('exit', p.id, door.tx, door.ty);
            this.score += CLEAR_POINTS * this.level;
            this.lives = Math.min(MAX_LIVES, this.lives + 1);   // a cleared level is worth a life: a family can keep going
            return [null, 0, 'clear'];
          }
        }
      }
      let up = 0;
      for (const p of w._order) if (p.alive && p.team === 0) up++;
      if (up === 0 && this.respawnAt.size === 0) return [null, null, 'wipe'];
      if (playTicks >= MAX_ROUND_TICKS) return [null, null, 'timeout'];
      return null;
    }
    let team = 0;
    let foes = 0;
    for (const p of w._order) {
      if (!p.alive) continue;
      if (p.team === 1) foes++;
      else team++;
    }
    if (team === 0) return [null, null, 'wipe'];
    if (foes === 0) {
      this.score += CLEAR_POINTS * this.level;
      return [null, 0, 'clear'];
    }
    return timeUp ? [null, null, 'timeout'] : null;
  }

  // ---- Snapshot -------------------------------------------------------------------------------------------

  /** Adds the co-op keys (Appendix C) to a snapshot: `m` monsters, `dr` the door once found, `lv` lives, `sc` score, `rp` comebacks. */
  addToSnapshot(snap) {
    const w = this.w;
    if (this.adventure) {
      snap.m = this.monsters.map((m) => {
        const row = new Array(7);
        row[M.ID] = m.id;
        row[M.K] = m.kind;
        row[M.X] = round3(m.x);
        row[M.Y] = round3(m.y);
        row[M.F] = m.facing;
        row[M.FL] = (m.hurt > 0 ? MF.HURT : 0) | (m.angry ? MF.ANGRY : 0);
        row[M.HP] = m.hp;
        return row;
      });
      const door = this.door;
      if (door && door.revealed) snap.dr = [door.tx, door.ty, door.open ? 1 : 0];
      snap.lv = this.lives;
      const rp = [];
      for (const p of w._order) {
        const at = this.respawnAt.get(p.id);
        if (at !== undefined) rp.push([p.id, Math.max(0, at - w.tickNo)]);
      }
      snap.rp = rp;
    }
    snap.sc = this.score;
  }

  /** Read-only facts for the Room at the end of a level or wave. */
  summary() {
    const door = this.door;
    return { level: this.level, lives: this.lives, score: this.score, monstersLeft: this.monsters.length, doorFound: !!door && door.revealed };
  }
}
