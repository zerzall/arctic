// AI survivors (SPEC §3.6). A player created with `bot: true` gets a brain that, every
// tick, looks at the game the way a player would and produces one InputCmd, fed through
// game.setInput exactly like a human's input. Purchases and the ready vote go through
// game.command. Bots get no special stats, no wall hacks for aiming (they only shoot
// what they can see) and aim with a reaction delay and an error that shrinks while
// they track a target. Every random choice comes from game.rng, so a game with bots
// stays deterministic.
//
// Cost control: the expensive parts run staggered over ticks (sensing every 6 ticks,
// strategy every 30, steering every 3, at most one A* search per tick for all bots) and
// every buffer is allocated once per brain.

import {
  DT, PLAYER_RADIUS, REVIVE_RADIUS, INTERACT_RADIUS, PICKUP_RADIUS, SUPPLY_RADIUS, MELEE_RANGE,
  FRAG_MAX, ARMOR_MAX, TURRET, BARRICADE, BLEEDOUT_TIME, WEAPON_SLOTS,
} from '../constants.js';
import { WEAPONS, effectiveRate } from '../weapons.js';
import { ITEMS } from '../items.js';
import { FlowField, BARRICADE_COST } from '../flowfield.js';
import { angleDiff, turnTowards, TAU } from '../math.js';
import { activeWeapon, priceFor, shopWave, findPlacement } from './players.js';
import { MODE_CHARGE } from './zombies.js';
import { walkComponents, componentAt } from './zone.js';
import { nearestSupply } from '../level.js';

// Zombie target kinds (z.tgtKind, see zombies.js).
const TK_PLAYER = 1, TK_OBJECTIVE = 3;

const SENSE_EVERY = 6;
const STRATEGY_EVERY = 30;
const STEER_EVERY = 3;
const SWITCH_EVERY = 15;
const SENSE_RADIUS = 1000;
const TOP_N = 6;
const CLOSE_N = 10;
const MAX_LOS_CHECKS = 4;
/** Grid pad for the bots' own navigation field: gaps narrower than 2*pad are not planned through. */
const NAV_PAD = 13;
const MAX_EXPAND = 5000;
const PATH_MAX = 768;
/** Pad for straight-line walk checks (a player is 16 px in radius). */
const WALK_PAD = PLAYER_RADIUS - 1;
/** Aim: how fast the error shrinks while tracking (1/s) and how fast the crosshair turns. */
const ERR_DECAY = 3.2;
const AIM_TURN_BASE = 4;
const AIM_TURN_GAIN = 11;
const HUNT_AFTER = 3;
/** Zombies seen chewing on the objective before a bot treats them as the top priority. */
const OBJ_ALARM = 4;
const STUCK_MOVE = 12;
/** Road to Haven: a bot heads for its mission goal only when no zombie is this close. */
const STORY_CLEAR = 130;
const PROBE_DIST = 30;

/**
 * How much a bot likes a gun (buying, crates, keeping). Explosive launchers hurt
 * teammates at close quarters, so bots rate them low and only fire them at safe range.
 */
export const GUN_VALUE = {
  pistol: 1, magnum: 3, sawedoff: 3, uzi: 3.5, shotgun: 4, rifle: 6, dual_smg: 6.5, crossbow: 5.5,
  dmr: 7, sniper: 6, auto_shotgun: 8, flamethrower: 7, lmg: 9, grenade_launcher: 2, rocket: 2,
  tesla: 9.5, minigun: 10, railgun: 10.5,
  flare: 3.2, tommy: 4.5, burst_rifle: 5, lever: 5.8, harpoon: 7, cryo: 6.8, amr: 11, hmg: 9.8,
  // Bots fight at range and back off from what closes in: they can't use a chainsaw
  // (gunScore rates it 0), so they never buy or pick one up.
  chainsaw: 0,
};
const BUY_ORDER = Object.keys(GUN_VALUE).filter((id) => GUN_VALUE[id] >= 3).sort((a, b) => GUN_VALUE[b] - GUN_VALUE[a]);

/** Skill levels for `botSkill` (players list / addPlayer): the lobby's bots are SKILLED. */
export const BOT_SKILL = { SKILLED: 1, AVERAGE: 0.4 };

/**
 * How a bot of skill `s` (0..1, 1 = the full brain) plays, as multipliers on the
 * skilled numbers. Lower skill = what an average human does: slower reactions, a
 * larger aim error that settles more slowly, a slower crosshair, less attention to
 * priority threats, letting zombies closer before backing off, fewer and later
 * throws, moments of tunnel vision mid-wave (keeps shooting instead of backing off
 * from what closes in), reloading whenever the magazine is low, and plain shopping (the best gun
 * it can afford right now, no saving up, fewer extras). s = 1 gives exactly 1 / the
 * skilled behaviour everywhere.
 */
export function skillProfile(s = 1) {
  const k = 1 - Math.max(0, Math.min(1, Number.isFinite(s) ? s : 1));
  const f = (atZero) => 1 + (atZero - 1) * k;
  return {
    level: 1 - k,
    react: f(2.6),          // reaction time
    aimErr: f(2.4),         // first aim error on a new target
    decay: f(0.4),          // how fast that error shrinks
    jitter: f(3),           // hand wobble while tracking
    turn: f(0.55),          // crosshair turn speed
    trigger: f(4),          // how far off target it still pulls the trigger (sprays)
    aware: f(0.35),         // weight of the threat bonuses in target choice
    kite: f(0.6),           // kite radius
    pack: f(1.6),           // pack weight needed before throwing a frag / molotov
    throwGap: f(2),         // time between throws
    lapse: k * 0.5,         // chance per strategy step of tunnel vision (no backing off for a moment)
    planner: k < 0.25,      // saves up for better guns, keeps a margin, reloads only when safe
    maxBuys: k < 0.25 ? 8 : 4,
  };
}

// Directions tried by local avoidance, relative to the wanted direction (radians).
const AVOID_OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.1, -2.1, 2.7, -2.7, Math.PI];
const AVOID_COS = AVOID_OFFS.map(Math.cos);
const AVOID_SIN = AVOID_OFFS.map(Math.sin);
// Defend-spot candidates around the anchor (angle offsets from the bot's own bearing).
const SPOT_OFFS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35];

// Neighbour order of flowfield.js: E, SE, S, SW, W, NW, N, NE.
const NDX = [1, 1, 0, -1, -1, -1, 0, 1];
const NDY = [0, 1, 1, 1, 0, -1, -1, -1];

// -------------------------------------------------------------------------------------
// Navigation: the bots' own static grid (player-sized pad) and A* over it.

/** Grid navigation for bots: a FlowField used only for its static walk graph, plus A*. */
export class BotNav {
  constructor(game) {
    this.field = new FlowField(game.map, { pad: NAV_PAD, inflate: 10, colliders: game.world.colliders });
    const f = this.field;
    const n = f.n;
    this.cols = f.cols;
    this.cell = f.cell;
    this.offs = NDX.map((dx, k) => dx + NDY[k] * f.cols);
    this.step = NDX.map((dx, k) => (k & 1 ? Math.SQRT2 : 1) * f.cell);
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.done = new Uint32Array(n);
    this.gen = 0;
    const cap = Math.max(n, MAX_EXPAND * 8 + 16);
    this.heapC = new Int32Array(cap);
    this.heapK = new Float64Array(cap);
    this.heapN = 0;
    this.tmp = new Int32Array(n);
    /** A* searches left this tick (shared by every bot). */
    this.budget = 0;
    this.barSig = 0;
    this.searches = 0;
  }

  /** Mirror the live barricades into the walk costs (players cannot walk through them). */
  sync(game) {
    const list = game.barricades;
    let sig = list.length;
    for (let i = 0; i < list.length; i++) sig = (Math.imul(sig, 31) + list[i].id + (list[i].dead ? 7 : 0)) >>> 0;
    if (sig !== this.barSig) {
      this.barSig = sig;
      this.field.setBarricades(list.filter((b) => !b.dead));
    }
  }

  cellX(c) {
    return ((c % this.cols) + 0.5) * this.cell;
  }

  cellY(c) {
    return (Math.floor(c / this.cols) + 0.5) * this.cell;
  }

  _open(c) {
    const f = this.field;
    if (c < 0) return -1;
    return f.blocked[c] || !f.edges[c] ? f.escape[c] : c;
  }

  _h(c, t) {
    const cols = this.cols;
    const dx = Math.abs((c % cols) - (t % cols)), dy = Math.abs(Math.floor(c / cols) - Math.floor(t / cols));
    return (dx > dy ? dx + 0.41421356 * dy : dy + 0.41421356 * dx) * this.cell;
  }

  _push(c, k) {
    const hc = this.heapC, hk = this.heapK;
    if (this.heapN >= hc.length) return;
    let i = this.heapN++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hk[parent] <= k) break;
      hc[i] = hc[parent];
      hk[i] = hk[parent];
      i = parent;
    }
    hc[i] = c;
    hk[i] = k;
  }

  _pop() {
    const hc = this.heapC, hk = this.heapK;
    const top = hc[0];
    const n = --this.heapN;
    if (n > 0) {
      const c = hc[n], k = hk[n];
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && hk[m + 1] < hk[m]) m++;
        if (hk[m] >= k) break;
        hc[i] = hc[m];
        hk[i] = hk[m];
        i = m;
      }
      hc[i] = c;
      hk[i] = k;
    }
    return top;
  }

  /**
   * A* from (sx, sy) to (gx, gy) over the walk graph. Writes the cells to walk through
   * (start excluded) into `out`. When the goal is unreachable or the search runs out of
   * budget, the path leads to the explored cell closest to the goal.
   * @returns {number} number of cells written (0 = no path)
   */
  find(sx, sy, gx, gy, out) {
    const f = this.field;
    const s = this._open(f.cellAt(sx, sy)), t = this._open(f.cellAt(gx, gy));
    this.searches++;
    if (s < 0 || t < 0) return 0;
    if (s === t) {
      out[0] = t;
      return 1;
    }
    if (this.gen >= 0xfffffff0) {
      this.seen.fill(0);
      this.done.fill(0);
      this.gen = 0;
    }
    const gen = ++this.gen;
    const { g, from, seen, done, offs, step } = this;
    const edges = f.edges, cost = f.cost;
    this.heapN = 0;
    g[s] = 0;
    from[s] = -1;
    seen[s] = gen;
    let best = s, bestH = this._h(s, t);
    this._push(s, bestH);
    let expanded = 0;
    while (this.heapN > 0) {
      const c = this._pop();
      if (done[c] === gen) continue;
      done[c] = gen;
      if (c === t) break;
      if (++expanded > MAX_EXPAND) break;
      const hc = this._h(c, t);
      if (hc < bestH) {
        bestH = hc;
        best = c;
      }
      const e = edges[c];
      const gc = g[c];
      for (let k = 0; k < 8; k++) {
        if (!(e & (1 << k))) continue;
        const nc = c + offs[k];
        if (done[nc] === gen) continue;
        const cc = cost[nc];
        if (cc >= BARRICADE_COST) continue;
        const ng = gc + step[k] * cc;
        if (seen[nc] !== gen || ng < g[nc]) {
          seen[nc] = gen;
          g[nc] = ng;
          from[nc] = c;
          this._push(nc, ng + this._h(nc, t));
        }
      }
    }
    const end = done[t] === gen ? t : best;
    const tmp = this.tmp;
    let len = 0;
    for (let c = end; c >= 0 && len < tmp.length; c = from[c]) tmp[len++] = c;
    // tmp runs goal → start; drop the start cell and keep the part nearest the start.
    const n = Math.min(out.length, len - 1);
    for (let i = 0; i < n; i++) out[i] = tmp[len - 2 - i];
    return n;
  }
}

// -------------------------------------------------------------------------------------
// Brain

/**
 * A fresh brain for bot player `p` (called by the game when a bot joins).
 * @returns {object} brain state; `holding` is true while it stands still on purpose
 */
export function createBrain(game, p, level = 1) {
  const rng = game.rng;
  return {
    pid: p.id,
    p,
    stagger: (p.id * 7) % STRATEGY_EVERY,
    // Per-bot jitter around its profile (some aim a little better than others).
    skill: rng.range(0.85, 1.15),
    prof: skillProfile(level),
    seq: 0,
    cmd: {
      seq: 0, moveX: 0, moveY: 0, angle: 0, fire: false, melee: false, sprint: false, interact: false,
      reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
      slot: -1, cycle: 0,
    },
    // senses
    buf: [], buf2: [],
    topZ: new Array(TOP_N).fill(null), topS: new Float64Array(TOP_N), topN: 0,
    closeZ: new Array(CLOSE_N).fill(null), closeD: new Float64Array(CLOSE_N), closeN: 0,
    nearestAdj: Infinity, nearestZ: null, tvx: 0, tvy: 0, crowd: 0, seenAny: false, objAlarm: 0,
    // aim
    aim: p.angle, target: null, reactT: 0, aimErr: 0, lastSeenT: -100, burstT: 0, pauseT: 0,
    // intent
    mode: 'defend', goalX: p.x, goalY: p.y, goalR: 30, reviveRef: null, pickRef: null, storyUse: null,
    ax: p.x, ay: p.y, anchorHuman: false,
    spotX: p.x, spotY: p.y, spotT: 0, spotAX: NaN, spotAY: NaN,
    // movement
    mx: 0, my: 0, sprint: false, hold: false, holding: false, _dx: 0, _dy: 0,
    path: new Int32Array(PATH_MAX), pathLen: 0, pathI: 0, pathGX: 0, pathGY: 0, pathT: -100,
    sx: p.x, sy: p.y, stuckN: 0, unstickT: 0, ux: 0, uy: 0,
    // weapons and gear
    switchT: 0, throwT: 0, throwKind: null, throwA: 0, deploy: null, deployA: 0, placeTry: 0, placeT: 0,
    // shop
    lastPhase: '', shopDone: false, buyT: 0, buys: 0, pendingBuy: null, pendingSlot: -1, readyT: 0,
    replan: true,
    lapseT: 0,
  };
}

/**
 * Generate this tick's InputCmd for every bot and queue it (called by the game each
 * tick, after the zombie grid is rebuilt and before inputs are applied).
 */
export function updateBots(game) {
  if (!game.bots.length) return;
  if (!game.botNav) game.botNav = new BotNav(game);
  const nav = game.botNav;
  nav.budget = 1;
  nav.sync(game);
  for (let i = 0; i < game.bots.length; i++) {
    const b = game.bots[i];
    game.setInput(b.pid, think(game, b, i));
  }
}

function resetCmd(c) {
  c.moveX = 0;
  c.moveY = 0;
  c.fire = false;
  c.melee = false;
  c.sprint = false;
  c.interact = false;
  c.reload = false;
  c.frag = false;
  c.molotov = false;
  c.turret = false;
  c.barricade = false;
  c.lastWeapon = false;
  c.slot = -1;
  c.cycle = 0;
}

function think(game, b, index) {
  const p = b.p;
  const cmd = b.cmd;
  resetCmd(cmd);
  cmd.seq = ++b.seq;
  cmd.angle = b.aim;
  b.holding = false;
  if (p.state === 'dead' || game.over || p.escaped || p.riding > 0) {
    b.target = null;
    b.mx = b.my = 0;
    b.hold = false;
    return cmd;
  }
  const t = game.tick + b.stagger;
  if (game.phase !== b.lastPhase) {
    const brk = game.phase === 'prep' || game.phase === 'intermission';
    if (brk) {
      b.shopDone = false;
      b.buys = 0;
      b.buyT = game.time + game.rng.range(0.4, 1.2);
    }
    b.lastPhase = game.phase;
    b.replan = true;
  }
  b.throwKind = null;
  b.deploy = null;
  if (t % SENSE_EVERY === 0 || (b.target && b.target.dead)) sense(game, b);
  if (t % STRATEGY_EVERY === 0 || b.replan) strategy(game, b, index);
  if (t % STRATEGY_EVERY === 15) checkStuck(game, b);
  if (t % STEER_EVERY === 0 || b.replan) steer(game, b);
  b.replan = false;
  b.holding = b.hold;
  cmd.moveX = b.mx;
  cmd.moveY = b.my;
  cmd.sprint = b.sprint;
  aimAndFire(game, b, cmd);
  if (p.state === 'alive') {
    shopAndReady(game, b, cmd);
    if (t % SWITCH_EVERY === 0) chooseWeapon(game, b, cmd);
    reload(game, b, cmd);
    melee(game, b, cmd);
    interact(game, b, cmd);
    if (b.throwKind) {
      cmd.angle = b.throwA;
      b.aim = b.throwA;
      if (b.throwKind === 'frag') cmd.frag = true;
      else cmd.molotov = true;
      cmd.fire = false;
    } else if (b.deploy) {
      cmd.angle = b.deployA;
      b.aim = b.deployA;
      if (b.deploy === 'turret') cmd.turret = true;
      else cmd.barricade = true;
      cmd.fire = false;
    }
  }
  return cmd;
}

// -------------------------------------------------------------------------------------
// Senses: nearby zombies, threat, target choice (+ throwables, which need the same scan)

function isTeammate(q, p) {
  return q !== p && q.state !== 'dead';
}

/** How much a bot wants to shoot `z` right now (higher = more). */
export function targetScore(game, b, z, d, range) {
  const p = b.p;
  let s = 1 - d / 1100;
  if (z.tgtKind === TK_PLAYER && z.tgt && z.tgtGap < 70) {
    const q = z.tgt;
    s += q === p ? 0.9 : (q.bot ? 0.6 : 0.85) + (q.state === 'downed' ? 0.3 : 0);
  } else if (z.tgtKind === TK_OBJECTIVE && z.tgtGap < 50) {
    // A horde chewing on the objective is an emergency even from across the map.
    s += b.objAlarm >= OBJ_ALARM ? 0.5 + d / 1100 + 0.5 * (b.prof ? b.prof.aware : 1) : 0.5;
  }
  if (d < 160) s += 0.6;
  const aw = b.prof ? b.prof.aware : 1;
  switch (z.type) {
    case 'spitter': s += 0.45 * aw; break;
    case 'screamer': s += 0.35 * aw; break;
    case 'brute': s += (z.mode === MODE_CHARGE ? 0.8 : 0.3) * aw; break;
    case 'boss': s += 0.25; break;
    case 'bloater': {
      // Pop it at range, never next to a teammate (or ourselves).
      let close = false;
      for (const q of game.players) {
        if (q.state === 'dead') continue;
        if (Math.hypot(q.x - z.x, q.y - z.y) < 130) {
          close = true;
          break;
        }
      }
      s += (close ? -0.9 : 0.35) * aw;
      break;
    }
    default: break;
  }
  if (z.elite) s += 0.15;
  if (d > range * 0.95) s -= 1.5;
  if (z === b.target) s += 0.2;
  const r = b.reviveRef;
  if (r && Math.hypot(z.x - r.x, z.y - r.y) < 220) s += 0.7;
  return s;
}

function sense(game, b) {
  const p = b.p;
  const aw = activeWeapon(p);
  const range = aw.id ? WEAPONS[aw.id].range : 600;
  const buf = b.buf;
  const n = game.zgrid.queryRadius(p.x, p.y, SENSE_RADIUS, buf);
  const topZ = b.topZ, topS = b.topS, closeZ = b.closeZ, closeD = b.closeD;
  let topN = 0, closeN = 0, nearestAdj = Infinity, nearestZ = null, tvx = 0, tvy = 0, crowd = 0, chewing = 0;
  for (let i = 0; i < n; i++) {
    const z = buf[i];
    if (z.dead) continue;
    if (z.tgtKind === TK_OBJECTIVE && z.tgtGap < 50) chewing++;
    const dx = z.x - p.x, dy = z.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    // Heavies are judged by their reach: keep well clear of slams and charges.
    const adj = d - reachOf(z) - z.radius - PLAYER_RADIUS;
    if (adj < nearestAdj) {
      nearestAdj = adj;
      nearestZ = z;
    }
    if (adj < 340) {
      const wgt = (z.boss ? 3 : z.heavy ? 1.8 : 1) / Math.max(30, adj + 30);
      tvx -= (dx / d) * wgt;
      tvy -= (dy / d) * wgt;
      if (adj < 180) crowd++;
    }
    // Nearest few by gap (movement, melee, danger).
    if (closeN < CLOSE_N || adj < closeD[closeN - 1]) {
      let j = closeN < CLOSE_N ? closeN++ : CLOSE_N - 1;
      while (j > 0 && closeD[j - 1] > adj) {
        closeD[j] = closeD[j - 1];
        closeZ[j] = closeZ[j - 1];
        j--;
      }
      closeD[j] = adj;
      closeZ[j] = z;
    }
    const s = targetScore(game, b, z, d, range);
    if (topN < TOP_N || s > topS[topN - 1]) {
      let j = topN < TOP_N ? topN++ : TOP_N - 1;
      while (j > 0 && topS[j - 1] < s) {
        topS[j] = topS[j - 1];
        topZ[j] = topZ[j - 1];
        j--;
      }
      topS[j] = s;
      topZ[j] = z;
    }
  }
  for (let i = closeN; i < CLOSE_N; i++) closeZ[i] = null;
  for (let i = topN; i < TOP_N; i++) topZ[i] = null;
  b.topN = topN;
  b.closeN = closeN;
  b.nearestAdj = nearestAdj;
  b.nearestZ = nearestZ;
  b.tvx = tvx;
  b.tvy = tvy;
  b.crowd = crowd;
  b.objAlarm = chewing;
  // Target: the best-scoring zombie we can actually see.
  const world = game.world;
  let target = null;
  for (let k = 0, checks = 0; k < topN && checks < MAX_LOS_CHECKS; k++) {
    const z = topZ[k];
    if (topS[k] < -0.4) break;
    checks++;
    // (a zombie up on something is seen over whatever it stands on)
    if (world.lineOfSight(p.x, p.y, z.x, z.y, Math.max(p.z || 0, z.z || 0))) {
      target = z;
      break;
    }
  }
  b.seenAny = !!target;
  if (target) b.lastSeenT = game.time;
  if (target !== b.target) acquire(game, b, target);
  if (p.state === 'alive' && game.phase === 'wave') planThrow(game, b, buf, n);
}

/** Extra berth a zombie needs: slams, charges and bursts reach well past the body. */
function reachOf(z) {
  if (z.boss) return 190;
  if (z.type === 'brute') return z.mode === MODE_CHARGE ? 170 : 90;
  if (z.type === 'bloater') return 60;
  return 0;
}

function acquire(game, b, z) {
  b.target = z;
  b.burstT = 0;
  b.pauseT = 0;
  if (!z) return;
  const rng = game.rng;
  const p = b.p;
  const jump = Math.abs(angleDiff(b.aim, Math.atan2(z.y - p.y, z.x - p.x)));
  const pr = b.prof;
  b.reactT = (jump < 0.35 ? rng.range(0.08, 0.16) : rng.range(0.18, 0.32)) * b.skill * pr.react;
  const mag = (0.05 + 0.1 * Math.min(1, jump / 1.5)) * b.skill * pr.aimErr;
  b.aimErr = (rng.next() < 0.5 ? -1 : 1) * mag * rng.range(0.6, 1.2);
}

/** Look for a dense pack worth a frag or a molotov (never near a teammate). */
function planThrow(game, b, buf, n) {
  const p = b.p;
  if (p.throwCd > 0 || game.time < b.throwT) return;
  const wantFrag = p.frags > 0, wantMolo = p.molotovs > 0;
  if (!wantFrag && !wantMolo) return;
  const world = game.world;
  let tries = 0;
  for (let i = 0; i < n && tries < 3; i++) {
    const z = buf[i];
    if (z.dead) continue;
    const d = Math.hypot(z.x - p.x, z.y - p.y);
    // A frag flies ~350 px and goes off 1.6 s later, a molotov bursts on the first zombie.
    const fragOk = wantFrag && d > 260 && d < 440;
    const moloOk = wantMolo && d > 160 && d < 380;
    if (!fragOk && !moloOk) continue;
    tries++;
    const list = b.buf2;
    const m = game.zgrid.queryRadius(z.x, z.y, 120, list);
    let weight = 0;
    for (let k = 0; k < m; k++) if (!list[k].dead) weight += list[k].boss ? 4 : list[k].heavy ? 2 : 1;
    const pack = b.prof.pack;
    const kind = fragOk && weight >= 6 * pack ? 'frag' : moloOk && weight >= 5 * pack ? 'molotov' : null;
    if (!kind) continue;
    const keep = kind === 'frag' ? 210 : 160;
    let safe = true;
    for (const q of game.players) {
      if (q.state === 'dead') continue;
      if (q === p && p.perks.selfExplosionImmune) continue;
      if (Math.hypot(q.x - z.x, q.y - z.y) < keep) {
        safe = false;
        break;
      }
    }
    if (!safe || !world.lineOfSight(p.x, p.y, z.x, z.y)) continue;
    b.throwKind = kind;
    b.throwA = Math.atan2(z.y - p.y, z.x - p.x) + game.rng.range(-0.04, 0.04);
    b.throwT = game.time + game.rng.range(2.5, 4.5) * b.prof.throwGap;
    return;
  }
}

// -------------------------------------------------------------------------------------
// Strategy: where to be and what to do (every STRATEGY_EVERY ticks, staggered)

function humansOf(game) {
  let alive = 0, total = 0, ready = 0;
  for (const q of game.players) {
    if (q.bot) continue;
    total++;
    if (q.state === 'alive') alive++;
    if (q.ready) ready++;
  }
  return { alive, total, allReady: total > 0 && ready === total };
}

function strategy(game, b, index) {
  strategyGoal(game, b, index);
  // A story level: never press against a shut gate for a goal on its far side (sim/level.js)
  if (game.level && b.p.state === 'alive') levelGoalFix(game, b);
}

/**
 * A story level: when the goal lies beyond a shut gate (another walk component of the bots'
 * graph), wait on this side of the nearest shut gate instead of wedging into it.
 */
function levelGoalFix(game, b) {
  const p = b.p, lv = game.level, f = game.botNav.field;
  if (!lv.gates.length) return;
  const comp = walkComponents(f);
  const mine = componentAt(f, comp, p.x, p.y);
  const theirs = componentAt(f, comp, b.goalX, b.goalY);
  if (mine < 0 || theirs < 0 || mine === theirs) return;
  let best = null, bd = Infinity;
  for (const gt of lv.gates) {
    if (lv.open[gt.i]) continue;
    const d = Math.hypot(gt.x - p.x, gt.y - p.y);
    if (d < bd) {
      bd = d;
      best = gt;
    }
  }
  if (!best) return;
  const dx = p.x - best.x, dy = p.y - best.y, d = Math.hypot(dx, dy) || 1;
  const rr = Math.min(d, 100 + (b.pid % 3) * 30);
  setGoal(b, b.mode, best.x + (dx / d) * rr, best.y + (dy / d) * rr, 70);
}

function strategyGoal(game, b, index) {
  const p = b.p;
  anchor(game, b, index);
  if (b.prof.lapse > 0 && game.phase === 'wave' && game.time >= b.lapseT && game.rng.next() < b.prof.lapse) {
    b.lapseT = game.time + game.rng.range(0.5, 1.2);
  }
  if (p.state === 'downed') {
    // Crawl toward the nearest standing teammate.
    let best = null, bd = Infinity;
    for (const q of game.players) {
      if (q === p || q.state !== 'alive') continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    setGoal(b, 'crawl', best ? best.x : p.x, best ? best.y : p.y, 45);
    return;
  }
  const phase = game.phase;
  const rv = pickRevive(game, b);
  if (rv) {
    b.reviveRef = rv.q;
    if (rv.clear) setGoal(b, 'clear', rv.q.x, rv.q.y, 230);
    else setGoal(b, 'revive', rv.q.x, rv.q.y, REVIVE_RADIUS * 0.6);
    return;
  }
  b.reviveRef = null;
  // Road to Haven: the mission's current objective (items, terminals, the escort ...) while
  // nothing is chewing on us; otherwise the ordinary fight-and-hold below.
  b.storyUse = null;
  if (game.story && b.nearestAdj > STORY_CLEAR) {
    const sg = game.story.botGoal(b, index);
    if (sg) {
      b.storyUse = sg.use || null;
      setGoal(b, sg.mode, sg.x, sg.y, sg.r);
      return;
    }
  }
  const brk = phase === 'prep' || phase === 'intermission';
  // Evac Run: the shop is open everywhere between waves, so nobody walks to the station;
  // the break is for getting to the next zone.
  const shopAt = game.campaign ? game.campaign.supply : game.map.supply;
  if (brk && !b.shopDone && shopAt && !game.zone) {
    setGoal(b, 'shop', shopAt.x, shopAt.y, SUPPLY_RADIUS * 0.55);
    return;
  }
  if (game.campaign && campaignGoal(game, b, index)) return;
  if (game.zone && brk && evacUrgent(game, b)) {
    chooseSpot(game, b, index);
    setGoal(b, 'evac', b.spotX, b.spotY, 40);
    return;
  }
  if (b.nearestAdj > 240) {
    const k = pickPickup(game, b);
    if (k) {
      b.pickRef = k;
      if (k.kind === 'crate') setGoal(b, 'crate', k.x, k.y, INTERACT_RADIUS * 0.5);
      else setGoal(b, 'pickup', k.x, k.y, PICKUP_RADIUS * 0.4);
      return;
    }
  }
  b.pickRef = null;
  const sup = supplyFor(game, p);
  if (phase === 'wave' && sup && needsResupply(p) && p.cash >= ITEMS.ammo.price && b.nearestAdj > 200
    && Math.hypot(sup.x - p.x, sup.y - p.y) < 900) {
    setGoal(b, 'resupply', sup.x, sup.y, SUPPLY_RADIUS * 0.6);
    return;
  }
  chooseSpot(game, b, index);
  if (game.zone && brk) {
    setGoal(b, 'evac', b.spotX, b.spotY, 40);
    return;
  }
  if (phase === 'wave' && game.time - b.lastSeenT > HUNT_AFTER) {
    const z = huntTarget(game, b);
    if (z) {
      setGoal(b, 'hunt', z.x, z.y, 120);
      return;
    }
  }
  setGoal(b, 'defend', b.spotX, b.spotY, 26);
  if (p.state === 'alive') planDeploy(game, b);
}

/**
 * The supply point a bot resupplies at mid-wave: the map's station, or in an Evac Run the
 * zone's supply drop when it is closer (and inside the circle).
 */
function supplyFor(game, p) {
  const s = game.campaign ? game.campaign.supply : game.level ? nearestSupply(game.map, p.x, p.y) : game.map.supply;
  const z = game.zone;
  if (!z) return s || null;
  const d = z.supply;
  const inCircle = Math.hypot(d.x - z.circle.x, d.y - z.circle.y) <= z.circle.r;
  if (!s || (inCircle && Math.hypot(d.x - p.x, d.y - p.y) < Math.hypot(s.x - p.x, s.y - p.y))) return inCircle ? d : null;
  return Math.hypot(s.x - z.circle.x, s.y - z.circle.y) <= z.circle.r ? s : null;
}

/** Evac Run move phase: true when the walk to the next zone can't wait for errands. */
function evacUrgent(game, b) {
  const z = game.zone, p = b.p;
  const d = Math.hypot(z.circle.x - p.x, z.circle.y - p.y) - z.circle.r * 0.5;
  return d > 0 && z.t < d / 160 + 8;
}

function setGoal(b, mode, x, y, r) {
  if (b.mode !== mode) b.pathLen = 0;
  b.mode = mode;
  b.goalX = x;
  b.goalY = y;
  b.goalR = r;
}

/**
 * Who this bot sticks with: a living human (spread over the bots), else the objective.
 * A human who is holding the objective anyway is covered by ringing the objective,
 * which also keeps its far side from being chewed on unseen.
 */
function anchor(game, b, index) {
  if (game.zone) {
    zoneAnchor(game, b, index);
    return;
  }
  const o = holdPoint(game);
  let n = 0;
  for (const q of game.players) if (!q.bot && q.state === 'alive') n++;
  if (n > 0) {
    let k = index % n;
    for (const q of game.players) {
      if (q.bot || q.state !== 'alive') continue;
      if (k-- === 0) {
        b.ax = q.x;
        b.ay = q.y;
        break;
      }
    }
    b.anchorHuman = true;
    if (!((game.campaign || game.objective) && o && Math.hypot(b.ax - o.x, b.ay - o.y) < Math.max(o.w, o.h) / 2 + 260)) return;
  }
  b.ax = o ? o.x : game.map.width / 2;
  b.ay = o ? o.y : game.map.height / 2;
  b.anchorHuman = false;
}

/**
 * Evac Run anchor: the circle the team must be in (the announced zone while moving, the
 * shrink target once it shrinks), or a living human standing well inside it.
 */
function zoneAnchor(game, b, index) {
  const z = game.zone;
  const c = z.stage >= 2 ? z.target : z.circle;
  b.zoneR = c.r;
  let n = 0;
  for (const q of game.players) if (!q.bot && q.state === 'alive' && Math.hypot(q.x - c.x, q.y - c.y) < c.r - 120) n++;
  if (n > 0) {
    let k = index % n;
    for (const q of game.players) {
      if (q.bot || q.state !== 'alive' || !(Math.hypot(q.x - c.x, q.y - c.y) < c.r - 120)) continue;
      if (k-- === 0) {
        b.ax = q.x;
        b.ay = q.y;
        break;
      }
    }
    b.anchorHuman = true;
    return;
  }
  b.ax = c.x;
  b.ay = c.y;
  b.anchorHuman = false;
}

/**
 * The objective-like box bots hold around when no human is standing: the campaign's point, a
 * story level's defend point (else the survivors' centre: a level has no middle to hold), the
 * map's objective.
 */
function holdPoint(game) {
  if (game.campaign) return campaignPoint(game);
  if (game.level) {
    const box = game.level.anchorBox();
    if (box) return box;
    let x = 0, y = 0, n = 0;
    for (const q of game.players) {
      if (q.state !== 'alive') continue;
      x += q.x;
      y += q.y;
      n++;
    }
    return n ? { x: x / n, y: y / n, w: 100, h: 100 } : null;
  }
  return game.map.objective;
}

/**
 * Campaign: the point the team fights around in the current stage, as an objective-like box
 * (the hill top, the tower door, a point between the floor's arrival and its stairs, the
 * roof's helipad).
 */
function campaignPoint(game) {
  const c = game.campaign, cfg = c.cfg;
  switch (c.stage) {
    case 1: return { x: cfg.hill.x, y: cfg.hill.y, w: 120, h: 120 };
    case 2: return { x: c.circle.x, y: c.circle.y, w: 100, h: 100 };
    case 3: {
      const f = cfg.floors[c.floor - 1];
      const a = f.arrive[0];
      return { x: a.x + (f.stairs.x - a.x) * 0.3, y: a.y + (f.stairs.y - a.y) * 0.3, w: 100, h: 100 };
    }
    default: {
      const r = cfg.roof;
      return { x: r.pad.x - 170, y: r.pad.y, w: 100, h: 100 };
    }
  }
}

/**
 * Campaign goals that override the ordinary ones: push on to the tower door during the
 * breakout, go to the stairs once the floor is clear, ride the zip line once it is live.
 * @returns {boolean} true when a goal was set
 */
function campaignGoal(game, b, index) {
  const c = game.campaign, p = b.p;
  const phase = game.phase;
  if (c.stage === 4 && c.zip && !p.escaped) {
    const z = c.cfg.roof.zip;
    setGoal(b, 'zip', z.ix, z.iy, 30);
    return true;
  }
  if (c.stage === 2 && phase === 'wave') {
    // the tower door: everyone must stand inside its circle, each on their own bearing
    const ci = c.circle, nb = Math.max(1, game.bots.length);
    const a = ((index + 0.5) / nb) * TAU;
    let gx = ci.x + Math.cos(a) * ci.r * 0.45, gy = ci.y + Math.sin(a) * ci.r * 0.45;
    if (!game.world.isCircleFree(gx, gy, PLAYER_RADIUS + 6)) { gx = ci.x; gy = ci.y; }
    setGoal(b, 'evac', gx, gy, 30);
    return true;
  }
  if (c.stage === 3 && c.sub === 3 && phase === 'intermission' && b.shopDone) {
    const humans = humansOf(game);
    if (humans.alive === 0 || humans.allReady || game.timer < 14) {
      setGoal(b, 'stairs', c.circle.x, c.circle.y, 34);
      return true;
    }
  }
  return false;
}

/** A free spot near the anchor on this bot's own bearing, spaced from teammates. */
function chooseSpot(game, b, index) {
  const moved = !(Math.hypot(b.ax - b.spotAX, b.ay - b.spotAY) < 90);
  if (!moved && game.time < b.spotT) return;
  b.spotAX = b.ax;
  b.spotAY = b.ay;
  b.spotT = game.time + 2 + game.rng.range(0, 1);
  const world = game.world, field = game.botNav.field;
  const o = holdPoint(game);
  const nb = game.bots.length;
  const bearing = ((index + 0.5) / Math.max(1, nb)) * TAU + (b.anchorHuman ? 0.8 : 0.3);
  const r0 = b.anchorHuman ? 115 : game.zone ? Math.min(170, (b.zoneR || 400) * 0.3) : o ? Math.max(o.w, o.h) / 2 + 70 : 150;
  let best = -Infinity, bx = b.ax, by = b.ay;
  for (let ri = 0; ri < 2; ri++) {
    const r = r0 + ri * 55;
    for (let k = 0; k < SPOT_OFFS.length; k++) {
      const a = bearing + SPOT_OFFS[k];
      const x = b.ax + Math.cos(a) * r, y = b.ay + Math.sin(a) * r;
      if (!world.isCircleFree(x, y, PLAYER_RADIUS + 8) || !field.isOpen(x, y)) continue;
      let s = -Math.abs(SPOT_OFFS[k]) * 0.6 - ri * 0.25;
      for (const q of game.players) {
        if (q === b.p || q.state === 'dead') continue;
        const d = Math.hypot(q.x - x, q.y - y);
        if (d < 90) s -= ((90 - d) / 90) * 1.2;
      }
      for (const o2 of game.bots) {
        if (o2 === b) continue;
        const d = Math.hypot(o2.spotX - x, o2.spotY - y);
        if (d < 90) s -= ((90 - d) / 90) * 1.5;
      }
      if (b.anchorHuman && !world.lineOfSight(b.ax, b.ay, x, y)) s -= 1;
      if (s > best) {
        best = s;
        bx = x;
        by = y;
      }
    }
  }
  b.spotX = bx;
  b.spotY = by;
}

/** A downed teammate this bot should go for: { q, clear } or null. */
function pickRevive(game, b) {
  const p = b.p;
  let best = null, bd = Infinity;
  for (const q of game.players) {
    if (q === p || q.state !== 'downed' || q.selfRevive) continue;
    if (q.reviver && q.reviver !== p.id) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > 1600 || d >= bd) continue;
    const z = game.zone;
    if (z && game.phase === 'wave' && Math.hypot(q.x - z.circle.x, q.y - z.circle.y) > z.circle.r + 400) continue;
    // Only the closest standing bot goes; the others cover.
    let mine = true;
    for (const o of game.bots) {
      const op = o.p;
      if (o === b || op.state !== 'alive') continue;
      const od = Math.hypot(q.x - op.x, q.y - op.y);
      if (od < d - 1 || (Math.abs(od - d) <= 1 && op.id < p.id)) {
        mine = false;
        break;
      }
    }
    if (!mine) continue;
    bd = d;
    best = q;
  }
  if (!best) return null;
  const list = b.buf2;
  const m = game.zgrid.queryRadius(best.x, best.y, 170, list);
  let danger = 0;
  for (let k = 0; k < m; k++) if (!list[k].dead) danger += list[k].heavy ? 2 : 1;
  const urgent = best.bleedout < BLEEDOUT_TIME * 0.3;
  return { q: best, clear: danger >= 3 && !urgent };
}

function fragMax(p) {
  return FRAG_MAX + (p.perks.extraFrags || 0);
}

function needsAmmo(p, share) {
  for (let i = 0; i < WEAPON_SLOTS; i++) {
    const id = p.slots[i];
    if (id && WEAPONS[id].reserve > 0 && p.res[i] < WEAPONS[id].reserve * share) return true;
  }
  return false;
}

/** Every gun but the infinite pistol is dry. */
function needsResupply(p) {
  let any = false;
  for (let i = 0; i < WEAPON_SLOTS; i++) {
    const id = p.slots[i];
    if (!id || WEAPONS[id].reserve < 0) continue;
    any = true;
    if (p.mag[i] + p.res[i] > WEAPONS[id].mag) return false;
  }
  return any;
}

/** Slot a new gun would replace: a free one (-1 = there is room) or the weakest non-pistol. */
function worstSlot(p) {
  if (p.slots.indexOf(null) >= 0) return { slot: -1, value: 0 };
  let slot = 1, value = Infinity;
  for (let i = 1; i < WEAPON_SLOTS; i++) {
    const v = GUN_VALUE[p.slots[i]] || 0;
    if (v < value) {
      value = v;
      slot = i;
    }
  }
  return { slot, value };
}

function crateGain(p, weapon) {
  if (!weapon || p.slots.includes(weapon)) return 0;
  const w = worstSlot(p);
  const v = GUN_VALUE[weapon] || 0;
  return v > w.value * 1.15 + 0.3 ? v - w.value : 0;
}

function pickPickup(game, b) {
  const p = b.p;
  let best = null, bs = Infinity;
  for (const k of game.pickups) {
    if (k.taken || k.life < 0.6) continue;
    const d = Math.hypot(k.x - p.x, k.y - p.y);
    let pri;
    switch (k.kind) {
      case 'ammo': pri = needsAmmo(p, 0.6) ? 1 : 0; break;
      case 'health': pri = p.hp < p.maxHp * 0.7 ? 0.7 : 0; break;
      case 'armor': pri = p.armor < ARMOR_MAX - 20 ? 1 : 0; break;
      case 'frag': pri = p.frags < fragMax(p) ? 1.2 : 0; break;
      case 'cash': pri = d < 260 ? 1.3 : 0; break;
      case 'crate': pri = crateGain(p, k.weapon) > 0 ? 0.6 : 0; break;
      default: pri = 0;
    }
    if (!pri) continue;
    if (d > (k.kind === 'crate' ? 700 : 400)) continue;
    // Evac Run: loot outside the circle waits (mid-wave the blight, between waves the clock).
    if (game.zone && Math.hypot(k.x - game.zone.circle.x, k.y - game.zone.circle.y) > game.zone.circle.r) continue;
    // Leave first aid to a hurt human who is closer to it.
    if (k.kind === 'health') {
      let yours = false;
      for (const q of game.players) {
        if (q.bot || q.state !== 'alive' || q.hp >= q.maxHp * 0.75) continue;
        if (Math.hypot(q.x - k.x, q.y - k.y) < d) yours = true;
      }
      if (yours) continue;
    }
    const s = d * pri;
    if (s < bs) {
      bs = s;
      best = k;
    }
  }
  return best;
}

/** Nearest live zombie worth walking to when nothing has been in sight for a while. */
function huntTarget(game, b) {
  let alive = 0;
  let best = null, bd = Infinity;
  for (const z of game.zombies) {
    if (z.dead || z.dummy) continue;
    alive++;
    const d = Math.hypot(z.x - b.ax, z.y - b.ay);
    if (d < bd) {
      bd = d;
      best = z;
    }
  }
  if (!best) return null;
  // Stay with the team while plenty are still coming; chase down stragglers.
  if (bd > 950 && alive + game.spawnQueue > 8) return null;
  // Evac Run: never chase one out into the blight.
  const z = game.zone;
  if (z && Math.hypot(best.x - z.circle.x, best.y - z.circle.y) > z.circle.r + 150) return null;
  return best;
}

/** Put down an owned turret (or barricade) facing out from the anchor. */
function planDeploy(game, b) {
  const p = b.p;
  if (game.time < b.placeT || (p.turrets <= 0 && p.barricades <= 0)) return;
  if (Math.hypot(p.x - b.spotX, p.y - b.spotY) > 45 || b.nearestAdj < 180) return;
  const brk = game.phase === 'prep' || game.phase === 'intermission';
  if (!brk && game.phase !== 'wave') return;
  if (brk && !b.shopDone) return;
  const out = Math.atan2(b.spotY - b.ay, b.spotX - b.ax);
  const tries = [0, 0.8, -0.8, 1.6, -1.6];
  const a = out + tries[b.placeTry % tries.length];
  b.placeTry++;
  b.placeT = game.time + 1.5;
  if (p.turrets > 0) {
    b.deploy = 'turret';
    b.deployA = a;
    return;
  }
  // Barricades only in open ground away from the humans: never wall off a choke point.
  // Judge the spot the placement would really use (it may shift off a blocked one).
  const spot = findPlacement(game, p, 'barricade', a);
  if (!spot) return;
  const { x, y } = spot;
  for (const q of game.players) if (!q.bot && q.state !== 'dead' && Math.hypot(q.x - x, q.y - y) < 180) return;
  const world = game.world;
  const nx = Math.cos(spot.a), ny = Math.sin(spot.a);
  const span = BARRICADE.width / 2 + 70;
  if (!world.isCircleFree(x + nx * span, y + ny * span, PLAYER_RADIUS + 6)) return;
  if (!world.isCircleFree(x - nx * span, y - ny * span, PLAYER_RADIUS + 6)) return;
  b.deploy = 'barricade';
  b.deployA = a;
}

// -------------------------------------------------------------------------------------
// Movement

function checkStuck(game, b) {
  const p = b.p;
  const wants = Math.abs(b.mx) + Math.abs(b.my) > 0.1;
  const moved = Math.hypot(p.x - b.sx, p.y - b.sy);
  b.sx = p.x;
  b.sy = p.y;
  if (!wants || moved >= STUCK_MOVE || p.state !== 'alive') {
    b.stuckN = 0;
    return;
  }
  b.stuckN++;
  if (b.stuckN < 2) return;
  // Wiggle free in a random open direction, then plan again.
  const rng = game.rng, world = game.world;
  const start = rng.range(0, TAU);
  let ux = Math.cos(start), uy = Math.sin(start);
  for (let k = 0; k < 8; k++) {
    const a = start + (k * TAU) / 8;
    const cx = Math.cos(a), cy = Math.sin(a);
    if (slideProbe(world, p, cx, cy, 40) > 0.8) {
      ux = cx;
      uy = cy;
      break;
    }
  }
  b.ux = ux;
  b.uy = uy;
  b.unstickT = game.time + rng.range(0.5, 0.9);
  b.pathLen = 0;
  if (b.stuckN >= 4) {
    b.spotT = 0;
    b.spotAX = NaN;
    b.stuckN = 0;
  }
}

function kiteRadius(b) {
  const aw = activeWeapon(b.p);
  const w = aw.id ? WEAPONS[aw.id] : null;
  let r = 150;
  if (w && (w.category === 'shotgun' || w.kind === 'flame' || w.kind === 'cryo')) r = 95;
  else if (w && w.category === 'sniper') r = 210;
  if (b.p.maxHp > 120) r *= 0.8;
  return r * b.prof.kite;
}

function steer(game, b) {
  const p = b.p;
  b.sprint = false;
  b.hold = false;
  if (b.unstickT > game.time) {
    b.mx = b.ux;
    b.my = b.uy;
    return;
  }
  const downed = p.state === 'downed';
  let dx = 0, dy = 0, kiting = false;
  const hz = hazardAt(game, p.x, p.y);
  if (!downed) {
    const reviving = b.mode === 'revive' && b.reviveRef && Math.hypot(b.reviveRef.x - p.x, b.reviveRef.y - p.y) <= REVIVE_RADIUS * 0.85;
    if (b.nearestAdj < kiteRadius(b) && !(reviving && b.nearestAdj > 40) && game.time >= b.lapseT) {
      kiting = true;
      dx = b.tvx;
      dy = b.tvy;
      let l = Math.hypot(dx, dy);
      if (l < 1e-6 && b.nearestZ) {
        dx = p.x - b.nearestZ.x;
        dy = p.y - b.nearestZ.y;
        l = Math.hypot(dx, dy) || 1;
      }
      dx /= l;
      dy /= l;
      // Don't run off: lean back toward where we should be, less the closer the danger.
      const kr = kiteRadius(b);
      const gx = b.goalX - p.x, gy = b.goalY - p.y, gd = Math.hypot(gx, gy);
      if (gd > 160) {
        const w = Math.min(1, (gd - 160) / 300) * 0.9 * Math.max(0, Math.min(1, b.nearestAdj / kr));
        dx += (gx / gd) * w;
        dy += (gy / gd) * w;
      }
      b.sprint = b.nearestAdj < kr * 0.5 && p.stamina > 25 && !p.sprintLock;
      // Campaign breakout: the horde front is at our back, so backing off leans forward.
      if (b.mode === 'evac' && game.campaign && game.campaign.stage === 2 && gd > 80) {
        dx += (gx / gd) * 0.7;
        dy += (gy / gd) * 0.7;
      }
      // Evac Run: backing off must not take us out into the blight. Near the edge, slide
      // along it (circle-kite) instead of backing out; outside, head back in.
      const zc = zoneCircle(game);
      if (zc) {
        const cx = zc.x - p.x, cy = zc.y - p.y, cd = Math.hypot(cx, cy) || 1;
        const room = zc.r - cd;
        if (room < 140) {
          const ux = cx / cd, uy = cy / cd;
          const l0 = Math.hypot(dx, dy) || 1;
          dx /= l0;
          dy /= l0;
          const inward = dx * ux + dy * uy;
          if (inward < 0) {
            const k = 1 + Math.min(1, (140 - room) / 140);
            dx -= ux * inward * k;
            dy -= uy * inward * k;
            const ts = dx * -uy + dy * ux >= 0 ? 1 : -1;
            dx += -uy * ts * 0.8;
            dy += ux * ts * 0.8;
          }
          if (room < 40) {
            const w = Math.min(2.5, (40 - room) / 60);
            dx += ux * w;
            dy += uy * w;
          }
        }
      }
    }
  }
  if (!kiting) {
    const gd = Math.hypot(b.goalX - p.x, b.goalY - p.y);
    if (hz) {
      dx = p.x - hz.x;
      dy = p.y - hz.y;
    } else if (b.mode === 'defend' && b.target && gd < 320 && !outsideZone(game, p)) {
      b.hold = true;
    } else if (gd <= b.goalR) {
      b.hold = true;
    } else if (pathDir(game, b)) {
      dx = b._dx;
      dy = b._dy;
      const errand = b.mode === 'revive' || b.mode === 'shop' || b.mode === 'resupply' || b.mode === 'crate' || b.mode === 'evac'
        || b.mode === 'zip' || b.mode === 'stairs' || b.mode === 'quest' || b.mode === 'use';
      b.sprint = !downed && errand && gd > 350 && b.nearestAdj > 300 && p.stamina > 45 && !p.sprintLock;
    }
  }
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) {
    b.mx = 0;
    b.my = 0;
    return;
  }
  avoid(game, b, dx / l, dy / l, kiting);
}

/**
 * Evac Run, mid-wave: the circle a bot must stay inside (the shrink target once the circle
 * shrinks, so it gets there in time), else null.
 */
function zoneCircle(game) {
  const z = game.zone;
  if (!z || game.phase !== 'wave' || z.stage === 0) return null;
  return z.stage >= 2 ? z.target : z.circle;
}

/** Evac Run, mid-wave: true when p stands in the blight. */
function outsideZone(game, p) {
  const z = game.zone;
  return !!z && game.phase === 'wave' && Math.hypot(p.x - z.circle.x, p.y - z.circle.y) > z.circle.r - 20;
}

function hazardAt(game, x, y) {
  for (const h of game.hazards) {
    if (h.life <= 0) continue;
    if ((h.kind === 'fire' || h.kind === 'flare') && !game.settings.friendlyFire) continue;
    if (Math.hypot(h.x - x, h.y - y) < h.r + PLAYER_RADIUS) return h;
  }
  return null;
}

/** Direction toward the goal along a straight line when clear, else along an A* path. */
function pathDir(game, b) {
  const p = b.p, world = game.world, nav = game.botNav;
  const gx = b.goalX, gy = b.goalY;
  if (world.lineOfMovement(p.x, p.y, gx, gy, WALK_PAD)) {
    b.pathLen = 0;
    return dirTo(b, gx - p.x, gy - p.y);
  }
  const stale = b.pathLen === 0 || Math.hypot(gx - b.pathGX, gy - b.pathGY) > 64 || game.time - b.pathT > 4;
  if (stale && nav.budget > 0) {
    nav.budget--;
    b.pathLen = nav.find(p.x, p.y, gx, gy, b.path);
    b.pathI = 0;
    b.pathGX = gx;
    b.pathGY = gy;
    b.pathT = game.time;
  }
  if (b.pathLen === 0) return dirTo(b, gx - p.x, gy - p.y);
  const path = b.path;
  while (b.pathI < b.pathLen - 1 && Math.hypot(nav.cellX(path[b.pathI]) - p.x, nav.cellY(path[b.pathI]) - p.y) < 20) b.pathI++;
  // The end of a partial path (a long walk runs out of search budget): plan the next leg.
  const last = path[b.pathLen - 1];
  if (b.pathI >= b.pathLen - 1 && Math.hypot(nav.cellX(last) - p.x, nav.cellY(last) - p.y) < 24
    && Math.hypot(gx - p.x, gy - p.y) > 64) b.pathT = -100;
  for (let j = Math.min(b.pathLen - 1, b.pathI + 3); j > b.pathI; j -= 2) {
    if (world.lineOfMovement(p.x, p.y, nav.cellX(path[j]), nav.cellY(path[j]), WALK_PAD)) {
      b.pathI = j;
      break;
    }
  }
  return dirTo(b, nav.cellX(path[b.pathI]) - p.x, nav.cellY(path[b.pathI]) - p.y);
}

function dirTo(b, dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return false;
  b._dx = dx / l;
  b._dy = dy / l;
  return true;
}

/**
 * Local avoidance: try directions fanning out from the wanted one and take the best
 * mix of "where I want to go", free space (cars, walls, map edge) and, when kiting,
 * distance from zombies and ground hazards.
 */
function avoid(game, b, dx, dy, kiting) {
  const p = b.p, world = game.world;
  let best = -Infinity, bx = dx, by = dy;
  for (let k = 0; k < AVOID_OFFS.length; k++) {
    const c = AVOID_COS[k], s = AVOID_SIN[k];
    const ux = dx * c - dy * s, uy = dx * s + dy * c;
    const prog = slideProbe(world, p, ux, uy, PROBE_DIST);
    if (!kiting && k === 0 && prog > 0.9 && !hazardAt(game, p.x + ux * 44, p.y + uy * 44)) {
      bx = ux;
      by = uy;
      best = Infinity;
      break;
    }
    let score = c + prog * 1.3;
    if (kiting) {
      if (prog > 0.7 && world.isCircleFree(p.x + ux * 80, p.y + uy * 80, PLAYER_RADIUS - 2)) score += 0.4;
      score -= danger(b, p.x + ux * 50, p.y + uy * 50) * 1.5;
    }
    if (hazardAt(game, p.x + ux * 40, p.y + uy * 40)) score -= 1.5;
    // Evac Run: steps that lead out of the circle cost (the blight hurts more than a scratch)
    const zc = zoneCircle(game);
    if (zc) {
      const out = Math.hypot(p.x + ux * 60 - zc.x, p.y + uy * 60 - zc.y) - zc.r;
      if (out > -30) score -= Math.min(2.5, (out + 30) / 40);
    }
    if (score > best) {
      best = score;
      bx = ux;
      by = uy;
    }
  }
  b.mx = bx;
  b.my = by;
}

const probePos = { x: 0, y: 0 };

/**
 * How far (0..1 of `dist`) a player really gets walking along (ux, uy): the same
 * collide-and-slide as the movement code, so hugging a wall still counts as free.
 */
function slideProbe(world, p, ux, uy, dist) {
  probePos.x = p.x;
  probePos.y = p.y;
  world.moveCircle(probePos, PLAYER_RADIUS, ux * dist, uy * dist);
  return ((probePos.x - p.x) * ux + (probePos.y - p.y) * uy) / dist;
}

function danger(b, x, y) {
  let sum = 0;
  for (let i = 0; i < b.closeN; i++) {
    const z = b.closeZ[i];
    if (!z || z.dead) continue;
    const d = Math.hypot(z.x - x, z.y - y) - z.radius - PLAYER_RADIUS - reachOf(z);
    if (d < 90) sum += ((90 - Math.max(0, d)) / 90) * (z.boss ? 2 : 1);
  }
  return sum;
}

// -------------------------------------------------------------------------------------
// Aim and fire

function aimAndFire(game, b, cmd) {
  const p = b.p;
  const z = b.target;
  const aw = activeWeapon(p);
  const w = aw.id ? WEAPONS[aw.id] : null;
  if (!z || z.dead || !w) {
    // Look toward the danger, or where we are going, or out from the team.
    let la = b.aim;
    if (b.nearestZ && !b.nearestZ.dead && b.nearestAdj < 600) la = Math.atan2(b.nearestZ.y - p.y, b.nearestZ.x - p.x);
    else if (Math.abs(b.mx) + Math.abs(b.my) > 0.1) la = Math.atan2(b.my, b.mx);
    else if (Math.hypot(p.x - b.ax, p.y - b.ay) > 20) la = Math.atan2(p.y - b.ay, p.x - b.ax);
    b.aim = turnTowards(b.aim, la, 5 * DT);
    cmd.angle = b.aim;
    return;
  }
  let tx = z.x, ty = z.y;
  const dx0 = tx - p.x, dy0 = ty - p.y;
  const d = Math.hypot(dx0, dy0);
  if (w.projectile && w.projectile.speed > 0) {
    // Lead moving targets for slow projectiles.
    const tt = d / w.projectile.speed;
    tx += (z.vx || 0) * tt;
    ty += (z.vy || 0) * tt;
  }
  const trueA = Math.atan2(ty - p.y, tx - p.x);
  const pr = b.prof;
  b.aimErr *= Math.exp(-ERR_DECAY * pr.decay * DT);
  if ((game.tick + b.stagger) % 20 === 0) b.aimErr += game.rng.range(-0.012, 0.012) * b.skill * pr.jitter;
  const goal = trueA + b.aimErr;
  const diff = Math.abs(angleDiff(b.aim, goal));
  b.aim = turnTowards(b.aim, goal, (AIM_TURN_BASE + AIM_TURN_GAIN * diff) * pr.turn * DT);
  cmd.angle = b.aim;
  if (b.reactT > 0) {
    b.reactT -= DT;
    return;
  }
  const tol = (Math.atan2(z.radius * 0.8, Math.max(1, d)) + (w.pellets > 1 ? w.spread * 0.4 : 0) + 0.015) * pr.trigger;
  if (Math.abs(angleDiff(b.aim, trueA)) > tol) return;
  if (d > w.range * 0.95) return;
  if (!safeToFire(game, b, w, trueA, d, tx, ty)) return;
  // Let a round-by-round reload run unless something is getting close.
  if (w.reloadOne && p.reloadT > 0 && b.nearestAdj > 220) return;
  // Bursts with automatic guns at range; hold the trigger up close (and on spin-up guns).
  if (w.rate >= 8 && !w.spinup && !w.burst && d > 260) {
    if (b.burstT > 0) {
      b.burstT -= DT;
      if (b.burstT <= 0) b.pauseT = game.rng.range(0.08, 0.22);
    } else if (b.pauseT > 0) {
      b.pauseT -= DT;
      if (b.pauseT <= 0) b.burstT = game.rng.range(0.25, 0.6);
      return;
    } else {
      b.burstT = game.rng.range(0.25, 0.6);
    }
  }
  cmd.fire = true;
}

/** Never shoot through teammates with friendly fire on; never blow up a teammate. */
function safeToFire(game, b, w, ang, d, tx, ty) {
  const p = b.p;
  const blast = w.projectile && w.projectile.explodeRadius > 0 ? w.projectile.explodeRadius : 0;
  if (blast) {
    if (d < blast + 30 && !p.perks.selfExplosionImmune) return false;
    for (const q of game.players) {
      if (!isTeammate(q, p)) continue;
      if (Math.hypot(q.x - tx, q.y - ty) < blast + 40) return false;
    }
  }
  if (!game.settings.friendlyFire) return true;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const reach = w.pierce > 1 || w.kind === 'rail' ? Math.min(w.range, d + 400) : d + 30;
  for (const q of game.players) {
    if (!isTeammate(q, p)) continue;
    const qx = q.x - p.x, qy = q.y - p.y;
    const along = qx * cx + qy * cy;
    if (along <= 0 || along > reach) continue;
    const perp = Math.abs(qx * cy - qy * cx);
    if (perp < PLAYER_RADIUS + 8 + along * (w.spread + 0.02)) return false;
  }
  return true;
}

// -------------------------------------------------------------------------------------
// Weapon handling

function falloffAt(w, d) {
  const start = w.range * 0.4;
  if (d <= start || w.falloff >= 1) return 1;
  const k = Math.min(1, (d - start) / (w.range - start));
  return 1 - (1 - w.falloff) * k;
}

/** Rough damage per second of the gun in slot i against a crowd at distance d. */
export function gunScore(game, b, i, d) {
  const p = b.p;
  const id = p.slots[i];
  if (!id) return -1;
  const w = WEAPONS[id];
  const mag = p.mag[i], res = p.res[i];
  if (mag === 0 && res === 0) return 0;
  if (d > w.range * 0.95) return 0.02 * (GUN_VALUE[id] || 1);
  const ang = Math.atan2(14, Math.max(20, d));
  let dps;
  switch (w.kind) {
    // Flames go through the whole pack.
    case 'flame': dps = (w.damage * w.rate * 0.5 + w.burn.dps) * (1 + Math.min(b.crowd, 6) * 0.4); break;
    // Frost: little damage, but a frozen pack can't reach anyone (and takes more from the team).
    case 'cryo': dps = (w.damage * w.rate * 0.5 + 70) * (1 + Math.min(b.crowd, 6) * 0.4); break;
    // Bots keep their distance: a chainsaw is never the gun for the job.
    case 'melee': return 0;
    case 'chain': dps = w.damage * w.rate * (1 + w.chains * 0.3); break;
    case 'rail': dps = w.damage * w.rate * 2; break;
    default: {
      // In a crowd the pellets that miss the target hit its neighbours.
      const crowd = w.pellets > 1 ? Math.min(0.25, b.crowd * 0.05) : 0;
      const hit = w.pellets > 1 ? Math.min(1, (ang + crowd) / Math.max(0.01, w.spread)) * w.pellets : Math.min(1, ang / Math.max(0.005, w.spread) + 0.3);
      dps = w.damage * hit * effectiveRate(w) * falloffAt(w, d) * (1 + Math.min(w.pierce, 4) * 0.15);
      if (w.burn) dps += w.burn.dps;
    }
  }
  if (w.projectile && w.projectile.explodeRadius > 0) {
    const safe = d > w.projectile.explodeRadius + 60 && !(b.target && teammateNear(game, p, b.target.x, b.target.y, w.projectile.explodeRadius + 40));
    dps = safe ? w.projectile.explodeDamage * w.rate * 0.6 : 0;
  }
  if (mag === 0) dps *= 0.6;
  if (w.spinup && p.spin < 1) dps *= 0.85;
  return dps;
}

function teammateNear(game, p, x, y, r) {
  for (const q of game.players) if (isTeammate(q, p) && Math.hypot(q.x - x, q.y - y) < r) return true;
  return false;
}

function chooseWeapon(game, b, cmd) {
  const p = b.p;
  if (cmd.slot >= 0 || b.pendingBuy || game.time < b.switchT) return;
  if (b.mode === 'crate' && b.pickRef && Math.hypot(b.pickRef.x - p.x, b.pickRef.y - p.y) < INTERACT_RADIUS * 1.5) return;
  const cur = p.slot;
  const curEmpty = p.slots[cur] ? p.mag[cur] === 0 && p.res[cur] === 0 : true;
  if (p.reloadT > 0 && !curEmpty) return;
  const d = b.target && !b.target.dead ? Math.hypot(b.target.x - p.x, b.target.y - p.y)
    : b.nearestAdj < 900 ? b.nearestAdj + 30 : 420;
  let best = cur, bs = gunScore(game, b, cur, d);
  const curScore = bs;
  for (let i = 0; i < WEAPON_SLOTS; i++) {
    if (i === cur) continue;
    const s = gunScore(game, b, i, d);
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  if (best !== cur && (curScore <= 0 || bs > curScore * 1.3)) {
    cmd.slot = best;
    b.switchT = game.time + 1.2;
  }
}

function reload(game, b, cmd) {
  const p = b.p;
  if (p.reloadT > 0 || cmd.slot >= 0) return;
  const s = p.slot;
  const id = p.slots[s];
  if (!id) return;
  const w = WEAPONS[id];
  const mag = p.mag[s], res = p.res[s];
  if (mag >= w.mag || res === 0) return;
  let go = false;
  if (mag === 0) go = true;
  else if (mag <= w.mag * 0.3 && (b.nearestAdj > 250 || !b.prof.planner)) go = true;
  else if (!b.seenAny && b.nearestAdj > 420 && game.time - b.lastSeenT > 1.2) go = true;
  if (go) {
    cmd.reload = true;
    cmd.fire = false;
  }
}

function melee(game, b, cmd) {
  const p = b.p;
  if (p.meleeCd > 0) return;
  let count = 0, closest = null, cd = Infinity;
  for (let i = 0; i < b.closeN; i++) {
    const z = b.closeZ[i];
    if (!z || z.dead || z.boss || z.type === 'bloater') continue;
    const d = Math.hypot(z.x - p.x, z.y - p.y) - z.radius - PLAYER_RADIUS;
    if (d < MELEE_RANGE - 25) count++;
    if (d < cd) {
      cd = d;
      closest = z;
    }
  }
  const surrounded = count >= (p.perks.meleeMult > 1 ? 2 : 3);
  if (closest && (cd < 8 || (surrounded && cd < 30))) {
    const a = Math.atan2(closest.y - p.y, closest.x - p.x);
    cmd.angle = a;
    b.aim = a;
    cmd.melee = true;
  }
}

function interact(game, b, cmd) {
  const p = b.p;
  // Road to Haven: hold the terminal / generator / repair spot the mission sent us to
  if (b.mode === 'use' && b.storyUse) {
    const it = b.storyUse;
    if (it.on && !it.done && Math.hypot(it.x - p.x, it.y - p.y) <= it.r * 0.8) {
      cmd.interact = true;
      b.holding = true;
    }
    return;
  }
  if (b.mode === 'zip' && game.campaign && game.campaign.zip) {
    const z = game.campaign.cfg.roof.zip;
    if (!p.prevInteract && Math.hypot(z.ix - p.x, z.iy - p.y) <= z.r * 0.7) cmd.interact = true;
    return;
  }
  if (b.mode === 'revive' && b.reviveRef) {
    const q = b.reviveRef;
    if (q.state === 'downed' && Math.hypot(q.x - p.x, q.y - p.y) <= REVIVE_RADIUS * 0.9) {
      cmd.interact = true;
      b.holding = true;
    } else if (q.state !== 'downed') {
      b.replan = true;
    }
    return;
  }
  if (b.mode === 'crate' && b.pickRef) {
    const k = b.pickRef;
    if (k.taken || k.life <= 0) {
      b.pickRef = null;
      b.replan = true;
      return;
    }
    if (Math.hypot(k.x - p.x, k.y - p.y) > INTERACT_RADIUS * 0.85) return;
    const ws = worstSlot(p);
    if (ws.slot >= 0 && p.slot !== ws.slot) {
      cmd.slot = ws.slot;
      return;
    }
    if (!p.prevInteract) cmd.interact = true;
    return;
  }
  if (b.mode === 'pickup' && b.pickRef && (b.pickRef.taken || b.pickRef.life <= 0)) {
    b.pickRef = null;
    b.replan = true;
  }
}

// -------------------------------------------------------------------------------------
// Shop and ready

/**
 * The next thing a bot wants to buy: { item, slot } (slot = the slot a new gun should
 * replace, -1 when it goes into a free slot or is not a gun), or null. `prof` is the
 * bot's skillProfile (default skilled): a planner saves up for better guns and keeps
 * a margin; an average player buys the best gun it can afford now and fewer extras.
 */
export function nextPurchase(game, p, prof = null) {
  const plan = !prof || prof.planner;
  const cash = p.cash;
  if (needsAmmo(p, plan ? 0.5 : 0.3) && cash >= priceFor(game, p, 'ammo')) return { item: 'ammo', slot: -1 };
  if (p.hp < p.maxHp * (plan ? 0.6 : 0.45) && cash >= priceFor(game, p, 'medkit')) return { item: 'medkit', slot: -1 };
  const o = game.objective;
  if (o && o.hp < o.maxHp * (plan ? 0.45 : 0.3) && cash >= priceFor(game, p, 'repair') + 300) return { item: 'repair', slot: -1 };
  const sw = shopWave(game);
  const ws = worstSlot(p);
  // Best upgrade first; a better gun that is almost affordable is worth saving for
  // instead of settling for a cheap one.
  let saving = false;
  for (const id of BUY_ORDER) {
    const w = WEAPONS[id];
    if (w.unlockWave > sw || p.slots.includes(id)) continue;
    if (GUN_VALUE[id] <= ws.value * 1.2 + 0.5) continue;
    if (w.price <= cash - (plan ? 150 : 0)) return { item: id, slot: ws.slot };
    if (plan && w.price <= cash + 450) {
      saving = true;
      break;
    }
  }
  // A pile of spare cash buys a second life.
  if (!p.selfRevive && cash >= priceFor(game, p, 'selfrevive') + (plan ? 1500 : 2000) && !saving) {
    return { item: 'selfrevive', slot: -1 };
  }
  if (!plan) {
    if (p.armor < 50 && cash >= priceFor(game, p, 'armor') + 300) return { item: 'armor', slot: -1 };
    if (p.frags < 1 && cash >= priceFor(game, p, 'frag') + 800) return { item: 'frag', slot: -1 };
    return null;
  }
  if (p.armor < 50 && cash >= priceFor(game, p, 'armor') && (!saving || p.armor < 25)) return { item: 'armor', slot: -1 };
  if (p.perks.turretDiscount > 0 && cash >= priceFor(game, p, 'turret') + 300) {
    let placed = 0;
    for (const t of game.turrets) if (t.owner === p.id && !t.dead) placed++;
    if (placed + p.turrets < TURRET.maxPerPlayer) return { item: 'turret', slot: -1 };
  }
  if (p.frags < 2 && cash >= priceFor(game, p, 'frag') + 600) return { item: 'frag', slot: -1 };
  return null;
}

function shopAndReady(game, b, cmd) {
  const p = b.p;
  const phase = game.phase;
  const brk = phase === 'prep' || phase === 'intermission';
  if (b.pendingBuy) {
    if (p.slot === b.pendingSlot || !p.slots[b.pendingSlot]) {
      game.command(p.id, { type: 'buy', item: b.pendingBuy });
      b.pendingBuy = null;
      b.buyT = game.time + game.rng.range(0.35, 0.7);
    } else {
      cmd.slot = b.pendingSlot;
    }
    return;
  }
  const supply = game.phase === 'wave' ? supplyFor(game, p) : game.campaign ? game.campaign.supply : game.map.supply;
  // (Evac Run: the break's shop is open wherever the bot is; it shops on the way.)
  const atStation = (!!game.zone && phase !== 'wave') || (!!supply && Math.hypot(supply.x - p.x, supply.y - p.y) <= SUPPLY_RADIUS * 0.9);
  if (b.mode === 'resupply' && phase === 'wave') {
    if (atStation && game.time >= b.buyT) {
      game.command(p.id, { type: 'buy', item: 'ammo' });
      b.buyT = game.time + 1;
      b.replan = true;
    }
    return;
  }
  if (!brk) return;
  const humans = humansOf(game);
  if (!b.shopDone) {
    const rush = humans.allReady || game.timer < 4 || !supply;
    if ((atStation || rush) && game.time >= b.buyT) {
      const plan = b.buys < b.prof.maxBuys ? nextPurchase(game, p, b.prof) : null;
      if (!plan) {
        b.shopDone = true;
        b.replan = true;
        b.readyT = game.time + game.rng.range(0.3, 1.0);
      } else {
        b.buys++;
        if (plan.slot >= 0 && p.slot !== plan.slot) {
          b.pendingBuy = plan.item;
          b.pendingSlot = plan.slot;
          cmd.slot = plan.slot;
        } else {
          game.command(p.id, { type: 'buy', item: plan.item });
          b.buyT = game.time + (rush ? 0.1 : game.rng.range(0.4, 0.8));
        }
      }
    }
    return;
  }
  if (!p.ready && game.time >= b.readyT && (humans.allReady || humans.alive === 0)) {
    game.command(p.id, { type: 'ready' });
  }
}
