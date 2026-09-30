// GameCore: the authoritative simulation for one match, independent of how the map
// was built (sim.js wraps it with buildMap). The host steps it at 60 Hz and sends
// snapshots; nothing here touches the DOM or Math.random.
//
// The rules are split by area: players.js (input, movement, weapons, deployables,
// revive, shop, pickups), combat.js (damage, hitscan/projectiles/explosions, turrets,
// hazards) and zombies.js (spawning, AI, specials). Each exports plain functions that
// take the game as their first argument, which keeps hot loops free of closures.

import {
  DT, PREP_TIME, INTERMISSION_TIME, BOSS_EVERY, WAVE_CLEAR_BONUS, DIFFICULTIES, DEFAULT_SETTINGS,
  NAV_REBUILD_INTERVAL, TICK_RATE, waveZombieCount, OBJECTIVE_HP_PER_PLAYER, MAX_PLAYERS,
} from '../constants.js';
import { createRng, hashString } from '../rng.js';
import { round1 } from '../math.js';
import { MASK_OBJECTIVE } from '../geom.js';
import { SpatialHash } from '../spatial.js';
import { FlowField } from '../flowfield.js';
import { createCollisionWorld, MASK_HEAVY } from '../movement.js';
import { resetVertical } from '../jump.js';
import {
  createPlayer, updatePlayers, updateDowned, updatePickups, applyBuy, respawnPlayer,
  revivePlayer, playerSnapshot, dropCrate, spawnPointFor, queueCmd, departRecord, restoreDeparted,
} from './players.js';
import {
  updateProjectiles, updateHazards, updateTurrets, rebuildBarricades,
} from './combat.js';
import {
  updateZombies, updateSpawning, startWaveSpawns, removeDeadZombies, spawnZombie, HEAVY_BODY_RADIUS,
} from './zombies.js';
import { createBrain, updateBots } from './bots.js';
import { ZoneDirector } from './zone.js';
import { CampaignDirector } from './campaign.js';
import { createRange } from './range.js';
import { mapModes } from '../zone.js';
import { resolveTime } from '../timeofday.js';

/** Events that are pure presentation and may be dropped when a snapshot overflows. */
const COSMETIC = new Set(['shot', 'zattack', 'pdamage', 'melee', 'chain', 'objhit', 'empty', 'spit', 'reload', 'switch', 'freeze']);
/** Soft cap: cosmetic events beyond this are dropped. */
const EVENT_SOFT_CAP = 180;
/** Hard cap on buffered events if snapshot() is never called (headless use). */
const EVENT_HARD_CAP = 2000;
/** Zombies treat the objective as this much farther away than it is (px). */
export const OBJECTIVE_BIAS = 360;
/** ...and big zombies (bloater, brute, boss) much more so: they hunt survivors. */
export const OBJECTIVE_BIAS_BIG = 700;
const NAV_TICKS = Math.max(1, Math.round(NAV_REBUILD_INTERVAL * TICK_RATE));

/** Allocates uint16 ids (1..65535), reusing only ids no live entity holds. */
export class IdPool {
  constructor() {
    this.used = new Uint8Array(65536);
    this.next = 1;
  }

  alloc() {
    for (let i = 0; i < 65535; i++) {
      const id = this.next;
      this.next = id >= 65535 ? 1 : id + 1;
      if (!this.used[id]) {
        this.used[id] = 1;
        return id;
      }
    }
    return 0;
  }

  free(id) {
    this.used[id] = 0;
  }
}

/** Everything of Game except building the map; see sim.js for the public entry point. */
export class GameCore {
  /**
   * @param {object} opts
   *   map       MapDef (required here; sim.js builds it from mapId/seed)
   *   mapId     informational
   *   seed      uint32
   *   settings  { difficulty, waves, objective, friendlyFire } (DEFAULT_SETTINGS fills gaps)
   *   players   [{ id, name, color, cls, bot?, botSkill? }] (bot: true = AI survivor, see bots.js)
   */
  constructor({ map, mapId, seed = 1, settings = {}, players = [] } = {}) {
    if (!map) throw new Error('GameCore needs a map');
    this.map = map;
    this.mapId = mapId || map.id;
    this.seed = seed >>> 0;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.settings.waves = Math.max(0, Math.floor(Number(this.settings.waves) || 0));
    this.diff = DIFFICULTIES[this.settings.difficulty] || DIFFICULTIES.normal;
    // Game mode (SPEC §3.7): 'zone' needs the map's points of interest; a map that only
    // plays 'zone' plays it whatever was asked. The zone mode has no objective to defend.
    const modes = mapModes(map);
    let mode = modes.includes(this.settings.mode) ? this.settings.mode : modes[0];
    if (mode === 'zone' && !(map.pois && map.pois.length >= 2)) mode = 'defend';
    // The campaign (SPEC §3.8) needs the map's campaign extension (maps-campaign.js).
    if (mode === 'campaign' && !(map.campaign && map.campaign.hill)) mode = modes.includes('defend') ? 'defend' : 'zone';
    this.mode = mode;
    this.settings.mode = mode;
    // Time of day (SPEC §7.5.1): cosmetic only (lighting); a day-only map plays day whatever was asked.
    this.settings.time = resolveTime(map, this.settings.time);
    if (mode === 'zone' || mode === 'campaign') this.settings.objective = false;
    this.rng = createRng((this.seed ^ hashString('highway-horde-sim')) >>> 0);

    this.world = createCollisionWorld(map);
    const colliders = this.world.colliders;
    this.objObb = colliders.find((c) => c.mask & MASK_OBJECTIVE) || null;
    this.flow = new FlowField(map, { colliders, pad: 3 });
    // Heavies (bloater, brute, boss) crash over low cover but need wide gaps between
    // cars; they path on their own field. A pad equal to the body radius means
    // "fits along the centre line".
    this.flowBig = new FlowField(map, { colliders, pad: HEAVY_BODY_RADIUS, mask: MASK_HEAVY });
    this.zgrid = new SpatialHash(map.width, map.height, 64);
    /** The moving safe zone of an Evac Run (sim/zone.js), else null. */
    this.zone = mode === 'zone' ? new ZoneDirector(this) : null;
    /** The four-stage campaign director (sim/campaign.js), else null. */
    this.campaign = mode === 'campaign' ? new CampaignDirector(this) : null;

    this.tick = 0;
    this.time = 0;
    this.phase = 'prep';
    this.timer = PREP_TIME;
    this.wave = 0;
    this.over = null;

    this.players = [];
    /** Players who left, by departKey(): what a rejoin under the same name gets back. */
    this.departed = new Map();
    /** Late joiners under new names paid catch-up cash so far (capped, see addPlayer). */
    this.catchUps = 0;
    /** Brains of the AI players (bots.js), in join order. */
    this.bots = [];
    /** The bots' navigation grid, built on their first tick (bots.js). */
    this.botNav = null;
    this.zombies = [];
    this.turrets = [];
    this.barricades = [];
    this.projectiles = [];
    this.pickups = [];
    this.hazards = [];
    this.ids = {
      zombie: new IdPool(), projectile: new IdPool(), pickup: new IdPool(),
      turret: new IdPool(), barricade: new IdPool(), hazard: new IdPool(),
    };

    const objHp = map.objective
      ? Math.round(map.objective.hp * (1 + OBJECTIVE_HP_PER_PLAYER * (Math.max(1, players.length) - 1)))
      : 0;
    this.objective = this.settings.objective && map.objective ? { hp: objHp, maxHp: objHp } : null;
    this.objHitCd = 0;
    // The objective as a flow-field goal, biased so that players win close calls.
    this.objTarget = map.objective
      ? { x: map.objective.x, y: map.objective.y, w: map.objective.w, h: map.objective.h, a: map.objective.a || 0, bias: OBJECTIVE_BIAS }
      : null;

    // Wave bookkeeping.
    this.spawnQueue = 0;
    this.bossQueue = 0;
    this.bossTimer = 0;
    this.spawnTimer = 0;
    this.wavePlayers = 1;
    /** Bosses this wave, fixed at wave start with wavePlayers (they share the hp multiplier). */
    this.waveBosses = 0;
    this.waveTotal = 0;
    this.aliveCount = 0;

    this.events = [];
    this._tickShots = new Map();
    this._flowTargets = [];
    this.barricadesDirty = false;
    // Scratch arrays reused by the rule modules.
    this.tmpA = [];
    this.tmpB = [];
    this.tmpC = [];

    for (const p of players) this._addPlayer(p, 'alive');
    // Solo would otherwise end at the first knock-down (SPEC §3.4): start with a kit.
    if (this.players.length === 1) this.players[0].selfRevive = true;
    // Evac Run: the first zone is announced at once; getting there is the prep phase.
    if (this.zone) this.timer = this.zone.begin();
    if (this.campaign) this.timer = this.campaign.begin();
    /** Set once the constructor is done: later players join at the zone (zone mode). */
    this.started = true;
    this._rebuildFlow('all');
    /** A hideout's shooting range (sim/range.js: immobile dummies), else null. */
    this.range = mode === 'hideout' && map.hub && map.hub.range ? createRange(this) : null;
  }

  // ---------------------------------------------------------------------------------
  // Public API (SPEC §3.1)

  /**
   * Late join: enters as 'dead' mid-wave (respawns at the next wave clear), alive
   * otherwise. Someone who left earlier under the same name gets their cash, stats and
   * kit back (+ the clear bonuses paid meanwhile); a new name gets wave × WAVE_CLEAR_BONUS
   * catch-up cash, for at most MAX_PLAYERS human newcomers per match (bots always), so
   * leaving and rejoining under new names can't print money.
   */
  addPlayer(info) {
    const existing = this.getPlayer(info.id);
    if (existing) return existing;
    // (the campaign's breakout and roof waves never clear: a joiner there enters alive)
    const midWave = (this.phase === 'wave' && !(this.campaign && this.campaign.lateAlive())) || this.phase === 'gameover' || this.phase === 'victory';
    const p = this._addPlayer(info, midWave ? 'dead' : 'alive');
    const key = departKey(p);
    const rec = this.departed.get(key);
    if (rec) {
      this.departed.delete(key);
      restoreDeparted(this, p, rec);
    } else if (this.wave > 0 && (p.bot || this.catchUps < MAX_PLAYERS)) {
      // Late joiners get a share of the clear bonuses they missed so they can gear up.
      if (!p.bot) this.catchUps++;
      p.cash += this.wave * WAVE_CLEAR_BONUS;
    }
    return p;
  }

  /** A player leaves: their turrets and barricades leave with them (kept for a rejoin). */
  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = this.players[i];
    let turrets = 0, barricades = 0, w = 0;
    for (const t of this.turrets) {
      if (t.owner === id && !t.dead) {
        t.dead = true;
        this.ids.turret.free(t.id);
        turrets++;
        continue;
      }
      this.turrets[w++] = t;
    }
    this.turrets.length = w;
    for (const b of this.barricades) {
      if (b.owner === id && !b.dead) {
        b.dead = true;
        barricades++;
      }
    }
    if (barricades) rebuildBarricades(this);
    this.departed.set(departKey(p), departRecord(this, p, turrets, barricades));
    this.players.splice(i, 1);
    const bi = this.bots.findIndex((b) => b.pid === id);
    if (bi >= 0) this.bots.splice(bi, 1);
    for (const p of this.players) {
      if (p.reviver === id) {
        p.reviver = 0;
        p.revive = 0;
      }
    }
    for (const z of this.zombies) if (z.tgt && z.tgt.id === id && z.tgtKind === 1) z.retargetT = 0;
  }

  /** Queue one InputCmd for a player (SPEC §3.3); at most MAX_QUEUE are kept. */
  setInput(id, cmd) {
    const p = this.getPlayer(id);
    if (!p || !cmd) return;
    queueCmd(p, copyCmd(cmd));
  }

  /** Reliable one-off requests: { type: 'buy', item } | { type: 'ready' }. */
  command(id, cmd) {
    const p = this.getPlayer(id);
    if (!p || !cmd) return;
    if (cmd.type === 'buy') {
      applyBuy(this, p, String(cmd.item));
    } else if (cmd.type === 'ready') {
      if (this.phase === 'intermission' || this.phase === 'prep') p.ready = true;
    }
  }

  getPlayer(id) {
    for (const p of this.players) if (p.id === id) return p;
    return null;
  }

  /** Advance exactly one tick. */
  step() {
    this.tick++;
    this.time += DT;
    this._tickShots.clear();
    if (this.objHitCd > 0) this.objHitCd -= DT;

    this._updatePhase();
    if (this.zone) this.zone.update();
    if (this.campaign) this.campaign.update();
    // Zombie positions as of the end of last tick: shots this tick hit where they are drawn.
    this.zgrid.rebuild(this.zombies, this.zombies.length);
    // AI survivors decide now and queue their cmds like everyone else's input.
    if (this.bots.length) this._runBots();
    updatePlayers(this);
    updateDowned(this);
    updatePickups(this);
    updateTurrets(this);
    updateProjectiles(this);
    updateHazards(this);
    if (this.barricadesDirty) rebuildBarricades(this);
    // The two fields rebuild half an interval apart to spread the cost.
    if (this.tick % NAV_TICKS === 0) this._rebuildFlow('small');
    else if (this.tick % NAV_TICKS === (NAV_TICKS >> 1)) this._rebuildFlow('big');
    updateZombies(this);
    if (this.range) this.range.update();
    removeDeadZombies(this);
    if (this.phase === 'wave') updateSpawning(this);
    this._checkEnd();
  }

  /** Render state (SPEC §4); drains the event buffer. */
  snapshot() {
    let alive = 0, bossHp = 0, bossMax = 0;
    const zs = [];
    for (const z of this.zombies) {
      if (z.dead) continue;
      alive++;
      if (z.boss) {
        bossHp += Math.max(0, z.hp);
        bossMax += z.maxHp;
      }
      zs.push({
        id: z.id, type: z.type, x: z.x, y: z.y, angle: z.angle,
        hp: clamp01(z.hp / z.maxHp), flags: zombieFlags(z), z: z.z,
      });
    }
    let readyCount = 0;
    for (const p of this.players) if (p.ready) readyCount++;
    const events = this.events;
    this.events = [];
    return {
      tick: this.tick,
      phase: this.phase,
      wave: this.wave,
      totalWaves: this.campaign ? this.campaign.total : this.settings.waves,
      timer: this.phase === 'prep' || this.phase === 'intermission' ? Math.max(0, this.timer) : 0,
      remaining: this.remaining(),
      bossHp: bossMax > 0 ? clamp01(bossHp / bossMax) : -1,
      objective: this.objective ? { hp: Math.max(0, Math.round(this.objective.hp)), maxHp: this.objective.maxHp } : null,
      readyCount,
      zone: this.zone ? this.zone.snapshot() : null,
      campaign: this.campaign ? this.campaign.snapshot() : null,
      players: this.players.map((p) => playerSnapshot(this, p)),
      zombies: zs,
      projectiles: this.projectiles.filter((pr) => !pr.dead).map((pr) => ({
        id: pr.id, kind: pr.kind, x: pr.x, y: pr.y, angle: pr.angle,
      })),
      pickups: this.pickups.map((k) => ({ id: k.id, kind: k.kind, x: k.x, y: k.y, weapon: k.weapon || null })),
      turrets: this.turrets.map((t) => ({
        id: t.id, owner: t.owner, x: t.x, y: t.y, angle: t.angle,
        hp: clamp01(t.hp / t.maxHp), ammo: clamp01(t.ammo / t.maxAmmo), firing: t.firingT > 0,
      })),
      barricades: this.barricades.map((b) => ({
        id: b.id, owner: b.owner, x: b.x, y: b.y, angle: b.a, hp: clamp01(b.hp / b.maxHp),
      })),
      hazards: this.hazards.map((h) => ({
        id: h.id, kind: h.kind, x: h.x, y: h.y, r: h.r, life: clamp01(h.life / h.maxLife),
      })),
      events,
    };
  }

  /** Zombies left this wave: alive + not yet spawned. */
  remaining() {
    let alive = 0;
    for (const z of this.zombies) if (!z.dead && !z.dummy) alive++;   // (a range dummy is not a threat)
    // (the roof's and the breakout's queues are endless streams: only what is alive counts)
    if (this.campaign && this.campaign.holdsWave()) return alive;
    return alive + this.spawnQueue + this.bossQueue;
  }

  /** Spawn a zombie of `type` at (x, y) scaled for the current wave (zone harassers, tools). */
  spawnZombieAt(type, x, y, elite = false) {
    return spawnZombie(this, type, x, y, elite);
  }

  // ---------------------------------------------------------------------------------
  // Events

  /** Queue a GameEvent for the next snapshot, dropping cosmetic ones under load. */
  emit(ev) {
    const n = this.events.length;
    if (n >= EVENT_SOFT_CAP && COSMETIC.has(ev.type)) return;
    if (n >= EVENT_HARD_CAP) this.events.splice(0, n >> 1);
    this.events.push(ev);
  }

  /**
   * Merge every hitscan ray a shooter fires in one tick into one 'shot' event.
   * @param {string|number} key shooter key (pid or 't'+turretId)
   */
  shotEvent(key, pid, turret, weapon, x, y, angle) {
    let ev = this._tickShots.get(key);
    if (!ev) {
      ev = { type: 'shot', pid, turret, weapon, x: round1(x), y: round1(y), angle, rays: [] };
      this._tickShots.set(key, ev);
      this.emit(ev);
    }
    return ev;
  }

  // ---------------------------------------------------------------------------------
  // Internals

  /** One brain step for every bot (a method so tests can time it). */
  _runBots() {
    updateBots(this);
  }

  _addPlayer(info, state) {
    const p = createPlayer(this, info);
    p.bot = !!info.bot;
    this.players.push(p);
    // botSkill 0..1 (default 1): how well the AI plays, see bots.js skillProfile.
    if (p.bot) this.bots.push(createBrain(this, p, info.botSkill ?? 1));
    const sp = spawnPointFor(this, this.players.length - 1);
    p.x = sp.x;
    p.y = sp.y;
    resetVertical(p, this.world.terrainQ(p.x, p.y));
    if (state === 'dead') {
      p.state = 'dead';
      p.respawn = true;
      p.hp = 0;
    }
    return p;
  }

  /**
   * Recompute the flow fields. which: 'small' | 'big' | 'all'. The small field leads
   * to players, turrets and the objective; the wide-gap field for big zombies leads
   * only to survivors and turrets (heavies hunt people, the small fry swarm the
   * objective).
   */
  _rebuildFlow(which) {
    const targets = this._flowTargets;
    let n = 0;
    for (const p of this.players) {
      if (p.state === 'dead' || p.escaped || p.riding > 0) continue;
      targets[n++] = p;
    }
    for (const t of this.turrets) if (!t.dead) targets[n++] = t;
    const hunters = n;
    if (this.objective && this.objective.hp > 0 && this.objTarget) targets[n++] = this.objTarget;
    targets.length = n;
    if (which !== 'big') this.flow.update(targets, n);
    if (which !== 'small') this.flowBig.update(targets, hunters > 0 ? hunters : n);
  }

  _updatePhase() {
    const ph = this.phase;
    if (ph === 'prep' || ph === 'intermission') {
      this.timer -= DT;
      let allReady = this.players.length > 0;
      for (const p of this.players) if (!p.ready) { allReady = false; break; }
      // Evac Run: the vote only skips the rest of the move once everyone is in the zone.
      if (allReady && this.zone && !this.zone.everyoneIn()) allReady = false;
      if (this.timer <= 0 || allReady) {
        // Campaign: the end of a floor's intermission takes the stairs instead of starting a wave.
        if (ph === 'intermission' && this.campaign && this.campaign.onIntermissionEnd()) {
          for (const p of this.players) p.ready = false;
        } else {
          this._startWave(this.wave + 1);
        }
      }
    }
  }

  _startWave(w) {
    this.wave = w;
    this.phase = 'wave';
    this.timer = 0;
    for (const p of this.players) p.ready = false;
    const players = Math.max(1, this.players.length);
    this.wavePlayers = players;
    this.waveTotal = waveZombieCount(w, players, this.diff);
    const boss = w % BOSS_EVERY === 0;
    this.waveBosses = boss ? Math.ceil(players / 3) : 0;
    this.bossQueue = this.waveBosses;
    this.bossTimer = 10;
    startWaveSpawns(this);
    if (this.zone) this.zone.lock();
    if (this.campaign) this.campaign.onWaveStart(w);
    this.emit({ type: 'wave', wave: w, boss: this.waveBosses > 0 });
  }

  _waveClear() {
    const w = this.wave;
    this.emit({ type: 'waveclear', wave: w, bonus: WAVE_CLEAR_BONUS });
    let i = 0;
    for (const p of this.players) {
      p.cash += WAVE_CLEAR_BONUS;
      p.earned += WAVE_CLEAR_BONUS;
      if (p.state === 'dead') respawnPlayer(this, p, i);
      else if (p.state === 'downed') revivePlayer(this, p, 0);
      i++;
    }
    // Acid does not outlive the wave (pools and globs still in the air); fires burn out
    // on their own and the survivors' own grenades/rockets still land.
    for (const h of this.hazards) if (h.kind === 'acid') h.life = 0;
    for (const pr of this.projectiles) if (pr.kind === 'acid' || !pr.owner) pr.dead = true;
    // (Evac Run: the reward is the supply drop waiting in the next zone.)
    if (!this.zone) dropCrate(this);
    if (!this.campaign && this.settings.waves > 0 && w >= this.settings.waves) {
      this.phase = 'victory';
      this.over = 'victory';
      this.emit({ type: 'victory' });
      return;
    }
    this.phase = 'intermission';
    this.timer = this.zone ? this.zone.next() : this.campaign ? this.campaign.next() : INTERMISSION_TIME;
  }

  _gameOver(reason) {
    this.phase = 'gameover';
    this.over = reason;
    this.spawnQueue = 0;
    this.bossQueue = 0;
    this.emit({ type: 'gameover', reason });
  }

  _checkEnd() {
    if (this.phase === 'gameover' || this.phase === 'victory') return;
    if (this.objective && this.objective.hp <= 0) {
      this._gameOver('objective');
      return;
    }
    // A cleared wave wins a tie with a wipe: the clear revives the downed (the last
    // zombie's death, a bloater burst, may have knocked down the last survivor).
    if (this.campaign) {
      // the roof: the last survivor out of the zip line wins the game
      if (this.campaign.checkEnd() === 'victory') {
        this.phase = 'victory';
        this.over = 'victory';
        this.spawnQueue = 0;
        this.bossQueue = 0;
        this.emit({ type: 'victory' });
        return;
      }
    }
    if (this.phase === 'wave' && this.spawnQueue === 0 && this.bossQueue === 0 && !(this.campaign && this.campaign.holdsWave())) {
      let any = false;
      for (const z of this.zombies) if (!z.dead) { any = true; break; }
      if (!any) {
        this._waveClear();
        return;
      }
    }
    if (this.players.length > 0) {
      let standing = false;
      for (const p of this.players) {
        if (!p.escaped && (p.state === 'alive' || (p.state === 'downed' && p.selfRevive))) {
          standing = true;
          break;
        }
      }
      if (!standing) this._gameOver('wiped');
    }
  }
}

/** Rejoin key: the (host-sanitised) name, bots and humans apart. */
function departKey(p) {
  return (p.bot ? 'bot:' : 'human:') + p.name;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** ZFLAG bits for a zombie (computed at snapshot time). */
function zombieFlags(z) {
  let f = 0;
  if (z.burnT > 0) f |= 1;
  if (z.swingT > 0 || z.flashT > 0) f |= 2;
  if (z.mode === 1 || z.mode === 2) f |= 4;
  if (z.buffT > 0) f |= 8;
  if (z.elite) f |= 16;
  if (z.chill > 0.05 || z.frozenT > 0) f |= 32;
  if (z.frozenT > 0) f |= 64;
  return f;
}

// `jump` is held (hold to keep hopping), but a repeated cmd must not jump again and a
// dropped one must not lose a tap, so the queue treats it like the one-shot presses.
const EDGE_KEYS = ['reload', 'frag', 'molotov', 'turret', 'barricade', 'lastWeapon', 'jump'];

/** Defensive copy of an InputCmd with every field normalised. */
export function copyCmd(c) {
  let mx = Number(c.moveX) || 0, my = Number(c.moveY) || 0;
  const l = Math.hypot(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  const slot = Number.isInteger(c.slot) && c.slot >= 0 && c.slot <= 2 ? c.slot : -1;
  const cycle = c.cycle > 0 ? 1 : c.cycle < 0 ? -1 : 0;
  return {
    seq: (c.seq >>> 0) || 0,
    moveX: mx, moveY: my,
    angle: Number.isFinite(c.angle) ? c.angle : 0,
    fire: !!c.fire, melee: !!c.melee, sprint: !!c.sprint, interact: !!c.interact,
    reload: !!c.reload, frag: !!c.frag, molotov: !!c.molotov, turret: !!c.turret,
    barricade: !!c.barricade, lastWeapon: !!c.lastWeapon,
    slot, cycle, jump: !!c.jump,
  };
}

/** Clear the edge-triggered fields of a command (used when repeating it). */
export function clearEdges(c) {
  for (const k of EDGE_KEYS) c[k] = false;
  c.slot = -1;
  c.cycle = 0;
  return c;
}

/** OR the edge fields of `from` into `into` (queue overflow must not lose presses). */
export function mergeEdges(into, from) {
  for (const k of EDGE_KEYS) if (from[k]) into[k] = true;
  if (into.slot < 0 && from.slot >= 0) into.slot = from.slot;
  if (into.cycle === 0 && from.cycle !== 0) into.cycle = from.cycle;
  return into;
}
