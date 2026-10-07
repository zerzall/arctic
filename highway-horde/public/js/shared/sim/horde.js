// "Horde Elimination" (settings.mode 'horde', SPEC §3.12): the director of one round.
//
// The buy time is the game's ordinary 'prep' phase (shop open everywhere, the ready vote
// skips it). Then the phase is 'wave' for the whole round and the director feeds the core's
// spawner (zombies.js updateSpawning) one surge at a time: it announces a surge and its
// entrances, gives the crew a breather to rotate, lets the surge's zombies out of those
// entrances in groups under its alive cap, and announces the next one once this one is all
// out and mostly down (or after a while, so the round keeps building). The last surge
// brings the bosses. `game.wave` is the surge number (the shop's stock and the HUD read it)
// and `game.tierBonus` makes the spawner play the surge's tier (type mix, hp, speed).
//
// Nothing respawns: the core never clears a wave in this mode, the dead stay dead and late
// joiners spectate. The round is won when the whole horde has spawned and nothing is left
// alive, lost when nobody is standing (core.js _checkEnd).
//
// Every random choice comes from the director's own seeded stream (the entrances) or from
// game.rng (the spawner), so a horde game is deterministic.

import { DT } from '../constants.js';
import { createRng, hashString } from '../rng.js';
import {
  HORDE, hordeTotal, hordeCrowd, surgePlan, surgeGap, surgeLull, hordeLanes, hordeHold, hordeHoldFor,
  HS_PREP, HS_BREATHER, HS_SURGE, HS_HOLD, HS_OVER,
} from '../horde.js';

/** Smallest team that moves to the holding spot a surge's entrances call for (shared/horde.js hordeHoldFor). */
const HORDE_SPLIT_HOLD = 3;

/** Spawn rects prefer to be this far from every living survivor (zombies.js pickSpawnRect). */
const SPAWN_FAR = 600;

/** Runs the horde of one game (game.horde). */
export class HordeDirector {
  /** @param {import('./core.js').GameCore} game */
  constructor(game) {
    this.game = game;
    this.rng = createRng((hashString(`horde:${game.map.id}`) ^ (game.seed >>> 0) ^ 0x68b2d1f3) >>> 0);
    /** The map's entrances (shared/horde.js hordeLanes). */
    this.lanes = hordeLanes(game.map);
    /** Where the defenders hold by default (bots without a human to follow) ... */
    this.home = hordeHold(game.map);
    /** ... and against the announced surge (shared/horde.js hordeHoldFor: the spot its entrances call for). */
    this.hold = this.home;
    this.surges = HORDE.surges;
    /** Team size the horde was sized for (fixed when the buy time ends). */
    this.players = 1;
    this.total = 0;
    this.plan = [];
    /** Current surge (1-based; 0 before the first) and the director's stage. */
    this.surge = 0;
    this.stage = HS_PREP;
    /** Seconds until the announced surge hits (breather), else 0. */
    this.next = 0;
    /** Entrances of the current or announced surge (bit i = lane i). */
    this.mask = 0;
    /** Tier (wave equivalent) of the current or announced surge: the shop sells its guns. */
    this.tier = 1;
    /** Zombies spawned so far (bosses included); seconds since the first surge; in the stage. */
    this.spawned = 0;
    this.time = 0;
    this.stageT = 0;
    this.alive = 0;
    this._rects = null;
    this._rectsMask = -1;
    /** Running numbers for tools (scripts/balance.js): surge start times, the alive peak. */
    this.stats = { surgeAt: [], peakAlive: 0, bosses: 0, bonus: 0 };
  }

  /** Game start: everyone gets the horde's buy-time cash; the buy time is the prep phase. */
  begin() {
    this._size();
    this.stage = HS_PREP;
    return HORDE.prep;
  }

  /** Size the horde for the team as it is now (the buy time may still change it). */
  _size() {
    const g = this.game;
    this.players = Math.max(1, g.players.length);
    this.total = hordeTotal(this.players, g.diff);
    this.plan = surgePlan(this.total, this.players, g.diff, g.settings.difficulty);
  }

  /** The buy time is over (core.js _startWave): the horde is fixed and the first surge announced. */
  startRound() {
    this._size();
    this.time = 0;
    this._announce(1);
  }

  /** Announce surge n: its entrances and a breather to get there. */
  _announce(n) {
    const s = this.plan[n - 1];
    this.stage = HS_BREATHER;
    this.stageT = 0;
    this.next = surgeGap(n, this.surges);
    this.mask = this._pickLanes(n, s.lanes);
    // (a team of three or more splits the map's holding spots by the surge's entrances; one or two
    // stay home: a lone bot crossing the map to a far site between surges dies in the open)
    this.hold = this.players >= HORDE_SPLIT_HOLD ? hordeHoldFor(this.game.map, this.mask) : this.home;
    this.tier = s.tier;
    this._pending = n;
    this.game.emit({ type: 'surge', what: 'next', n, lanes: this.mask, boss: s.bosses > 0, time: Math.round(this.next) });
  }

  /** Surge n hits: the spawner gets its zombies. */
  _go() {
    const g = this.game, n = this._pending, s = this.plan[n - 1];
    this.surge = n;
    this.stage = HS_SURGE;
    this.stageT = 0;
    this.next = 0;
    g.wave = n;
    g.tierBonus = s.tier - n;
    g.wavePlayers = this.players;
    g.waveBosses = s.bosses;
    g.waveTotal = s.size;
    g.spawnQueue = s.size - s.bosses;
    g.bossQueue = s.bosses;
    g.bossTimer = HORDE.bossDelay;
    g.spawnTimer = 0.4;
    this.stats.bosses += s.bosses;
    this.stats.surgeAt.push(Math.round(this.time * 10) / 10);
    // resupply money for every survivor still standing
    if (n > 1 && HORDE.surgeBonus > 0) {
      for (const p of g.players) {
        if (p.state === 'dead') continue;
        p.cash += HORDE.surgeBonus;
        p.earned += HORDE.surgeBonus;
        this.stats.bonus += HORDE.surgeBonus;
      }
    }
    g.emit({ type: 'surge', what: 'go', n, lanes: this.mask, boss: s.bosses > 0, time: 0 });
  }

  /**
   * Entrances for surge n: `count` of them (0 = all), never a late flank before
   * HORDE.lateFrom, not the same set as the surge before when there is a choice.
   */
  _pickLanes(n, count) {
    const lanes = this.lanes;
    const open = lanes.filter((l) => !l.late || n >= HORDE.lateFrom);
    let pool = open.length ? open : lanes;
    // (the first surge comes through one of the nearer entrances: the round starts with a fight,
    // not a minute's wait for a walk across the map)
    if (n === 1 && count && pool.length > count + 1) {
      const h = this.home;
      pool = pool.slice().sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y) || a.i - b.i)
        .slice(0, count + 1);
    }
    if (!count || count >= pool.length) {
      let m = 0;
      for (const l of pool) m |= 1 << l.i;
      return m;
    }
    let best = 0;
    for (let tries = 0; tries < 4; tries++) {
      const left = pool.slice();
      let m = 0;
      for (let k = 0; k < count; k++) {
        const j = Math.floor(this.rng.next() * left.length);
        m |= 1 << left[j].i;
        left.splice(j, 1);
      }
      best = m;
      if (m !== this.mask) break;
    }
    return best;
  }

  /** One tick (every phase; core.js calls it after the phase update). */
  update() {
    const g = this.game;
    if (g.over) {
      this.stage = HS_OVER;
      return;
    }
    if (g.phase === 'prep') {
      // the buy time: joiners still change the horde's size
      if (g.players.length !== this.players) this._size();
      return;
    }
    if (g.phase !== 'wave') return;
    this.time += DT;
    this.stageT += DT;
    let alive = 0;
    for (const z of g.zombies) if (!z.dead && !z.dummy) alive++;
    this.alive = alive;
    if (alive > this.stats.peakAlive) this.stats.peakAlive = alive;
    if (this.stage === HS_BREATHER) {
      this.next = Math.max(0, this.next - DT);
      if (this.next <= 0) this._go();
      return;
    }
    if (this.stage === HS_SURGE && g.spawnQueue <= 0 && g.bossQueue <= 0) {
      this.stage = HS_HOLD;
      this.stageT = 0;
    }
    if (this.stage === HS_HOLD && this.surge < this.surges) {
      const s = this.plan[this.surge - 1];
      if (alive <= Math.floor(surgeLull(this.surge, this.surges) * s.size) || this.stageT >= HORDE.gap.wait) this._announce(this.surge + 1);
    }
  }

  /** A zombie of the horde came into the world (zombies.js spawnZombie). */
  onSpawn() {
    this.spawned++;
  }

  /** Zombies still to kill: alive plus not yet spawned. */
  left() {
    let alive = 0;
    for (const z of this.game.zombies) if (!z.dead && !z.dummy) alive++;
    return Math.max(0, this.total - this.spawned) + alive;
  }

  /** True once the whole horde is dead (core.js _checkEnd turns it into the victory). */
  cleared() {
    const g = this.game;
    if (g.phase !== 'wave' || this.surge < this.surges || this.stage !== HS_HOLD) return false;
    if (g.spawnQueue > 0 || g.bossQueue > 0 || this.spawned < this.total) return false;
    for (const z of g.zombies) if (!z.dead && !z.dummy) return false;
    return true;
  }

  /** Alive at once while the current surge spawns (zombies.js updateSpawning). */
  aliveCap() {
    const s = this.plan[Math.max(0, this.surge - 1)];
    return s ? s.cap : this.game.diff.maxAlive;
  }

  /**
   * Speed factor of a zombie on its way in (zombies.js moveZombie): far from its survivor it
   * strides out (HORDE.travel), so a surge from a gate across the town reaches the fight in
   * about half a minute instead of a minute and a half; close in it walks at its own pace.
   */
  travelMult(z) {
    const T = HORDE.travel, d = z.tgtDist;
    if (!(d > T.far) || !Number.isFinite(d)) return 1;
    return 1 + (T.mult - 1) * Math.min(1, (d - T.far) / T.ramp);
  }

  /** Zombies in the next spawn group. */
  groupSize(rng) {
    const [a, b] = HORDE.group;
    return rng.int(a, b + Math.floor((this.surge - 1) / HORDE.groupPer));
  }

  /** Seconds until the next spawn group. */
  spawnDelay(rng) {
    const [a, b] = HORDE.every;
    return rng.range(a, b) / Math.sqrt(Math.max(1, hordeCrowd(this.players, this.game.diff)));
  }

  /**
   * Spawn rectangles for the spawner (zombies.js pickSpawnRect): the current surge's
   * entrances.
   * @returns {{rects: object[], far: number}|null}
   */
  spawnRects() {
    if (this._rectsMask !== this.mask) {
      this._rectsMask = this.mask;
      const rects = [];
      for (const l of this.lanes) if (this.mask & (1 << l.i)) rects.push(...l.rects);
      this._rects = rects;
    }
    return this._rects.length ? { rects: this._rects, far: SPAWN_FAR } : null;
  }

  /** Snapshot.horde (SPEC §4). */
  snapshot() {
    let alive = 0;
    for (const z of this.game.zombies) if (!z.dead && !z.dummy) alive++;
    return {
      stage: this.stage, total: this.total, left: Math.max(0, this.total - this.spawned) + alive, alive,
      surge: this.surge, surges: this.surges, tier: this.tier,
      next: this.next, lanes: this.mask, time: this.time,
    };
  }
}
