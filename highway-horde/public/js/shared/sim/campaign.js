// The Campaign director (settings.mode 'campaign', SPEC §3.8): runs the four stages of a
// campaign game on top of the ordinary wave loop of core.js. One wave counter runs through
// all of it —
//
//   stage 1  HILLTOP   waves 1..N        ordinary waves and intermissions on a real hill: zombies
//                                        climbing the flank are slowed and take extra damage,
//                                        shooters on the high ground deal a bonus; the horde comes
//                                        up the slope in a spiral of attack directions.
//   stage 2  BREAKOUT  wave N+1          a scripted collapse of the hill; a HORDE FRONT walks the
//                                        route behind the team (anyone behind it takes escalating
//                                        damage) while wave zombies pour in from behind and ahead;
//                                        the wave ends when the whole team stands at the tower door.
//   stage 3  ASCENT    N+2 .. N+1+F      one wave per floor in the annex; the stairs open when the
//                                        floor is clear (or the timer runs out), the team is moved
//                                        up with a title card, supplies drop on arrival.
//   stage 4  ROOFTOP   the last wave     kill a quota (scaled with the team size); the zip line
//                                        wakes up; each survivor rides it (a scripted 4.8 s ride)
//                                        and lands on the far pad: escaped. Victory when every
//                                        survivor is out, defeat when nobody is left standing.
//
// Everything random comes from the director's own seeded stream or game.rng, so a campaign
// game stays deterministic. The director never touches the DOM.

import {
  DT, PLAYER_RADIUS, INTERMISSION_TIME, PREP_TIME, PICKUP_LIFETIME, waveZombieCount,
} from '../constants.js';
import { createRng, hashString } from '../rng.js';
import { TAU } from '../math.js';
import { MASK_MOVE } from '../geom.js';
import { Z_UNIT, toZq, resetVertical } from '../jump.js';
import { ZONE } from '../zone.js';
import {
  CAMPAIGN, SUB, RIDE_TICKS, wavePlan, stageOfWave, killQuota, frontDps, frontSpeed, routeProgress, routePoint,
} from '../campaign.js';
import { walkComponents, componentAt } from './zone.js';
import { downPlayer, spawnPickup } from './players.js';
import { crateWeaponPool } from '../weapons.js';

/** Share of a ride spent swinging from where the survivor stood up to the cable. */
const RIDE_LEAD = 0.1;
const SPAWN_BOX = 72;
const RING_ANGLES = 30;
const CAMPAIGN_RECT_TTL = 0.75;

/** Runs the stages of one campaign game (game.campaign). */
export class CampaignDirector {
  /** @param {import('./core.js').GameCore} game */
  constructor(game) {
    const map = game.map, cfg = map.campaign;
    this.game = game;
    this.cfg = cfg;
    this.plan = wavePlan(game.settings.waves, cfg.floors.length);
    /** Waves in the whole campaign (the snapshot's totalWaves). */
    this.total = this.plan.total;
    this.rng = createRng((hashString(`campaign:${map.id}`) ^ (game.seed >>> 0) ^ 0x51ed270b) >>> 0);
    this.comp = walkComponents(game.flow);
    this.hillComp = componentAt(game.flow, this.comp, cfg.hill.x, cfg.hill.y);
    this.floorComp = [];
    this.stage = 1;
    this.floor = 0;
    this.sub = SUB.FIGHT;
    /** What the end of an intermission does: 'wave' starts the next wave, 'move' takes the stairs. */
    this.after = 'wave';
    this.justArrived = false;
    /** The objective circle of the stage (hill top, tower door, the floor's stairs, the zip gantry). */
    this.circle = { x: cfg.hill.x, y: cfg.hill.y, r: cfg.hill.plateau };
    this.supply = { x: map.supply.x, y: map.supply.y };
    this.route = cfg.route;
    this.routeLen = cfg.routeLen;
    /** The horde front: arclength along the route, -1e9 when not running. */
    this.front = -1e9;
    this.frontSpeed = frontSpeed(cfg.routeLen);
    this.enterT = 0;
    this.kills = 0;
    this.quota = 0;
    this.zip = false;
    /** Seconds left / length of a timed part of the stage (the door hold), for the HUD. */
    this.t = 0;
    this.tTotal = 0;
    /** Hill attacks: the spiral of directions. */
    this.attackBase = 0;
    this.ndirs = 2;
    this.waveT0 = 0;
    this._rects = null;
    this._rectsAt = -1;
    this._rectsKey = '';
    this._fx = { x: 0, y: 0 };
    this.stats = { blight: 0, rides: 0, escaped: 0, arrivals: 0 };
    game.flow.maxDist = ZONE.navRange;
    game.flowBig.maxDist = ZONE.navRange;
  }

  // -----------------------------------------------------------------------------------
  // Wave hooks (core.js)

  /** The first prep phase: its length. */
  begin() {
    this.sub = SUB.REST;
    return PREP_TIME;
  }

  /**
   * A wave was cleared (after the clear bonus, the respawns and the revives): what comes
   * next, and the length of the intermission.
   * @returns {number} seconds
   */
  next() {
    const g = this.game, w = g.wave;
    if (this.justArrived) {
      this.justArrived = false;
      this.sub = SUB.ARRIVE;
      this.after = 'wave';
      this.dropSupplies();
      return CAMPAIGN.arrive + 2;
    }
    this.after = 'wave';
    if (this.stage === 1) {
      if (w >= this.plan.hill) {
        this.sub = SUB.BRIEF;
        g.emit({ type: 'campaign', what: 'brief', stage: 2, floor: 0, pid: 0 });
        return CAMPAIGN.brief;
      }
      this.sub = SUB.REST;
      return INTERMISSION_TIME;
    }
    if (this.stage === 3) {
      this.sub = SUB.OPEN;
      this.after = 'move';
      this.enterT = 0;
      g.emit({ type: 'campaign', what: 'stage', stage: 3, floor: this.floor, pid: 0 });
      return CAMPAIGN.stairs;
    }
    this.sub = SUB.REST;
    return INTERMISSION_TIME;
  }

  /**
   * An intermission ran out (or everyone voted ready). Returns true when the director used
   * it to move the team (the stairs), so no wave starts yet.
   */
  onIntermissionEnd() {
    if (this.after !== 'move') return false;
    this.moveUp();
    return true;
  }

  /** The wave `w` has just been set up (waveTotal, bosses, spawn queue): shape it for its stage. */
  onWaveStart(w) {
    const g = this.game;
    const st = stageOfWave(this.plan, w);
    this.stage = st.stage;
    this.floor = st.floor;
    this.sub = SUB.FIGHT;
    this.after = 'wave';
    this.t = 0;
    this.tTotal = 0;
    this.waveT0 = g.time;
    const players = g.wavePlayers, diff = g.diff;
    this.setGeometry();
    switch (st.stage) {
      case 1: {
        const dirs = CAMPAIGN.hillRing.dirs;
        this.ndirs = dirs[Math.min(dirs.length - 1, Math.floor((w - 1) / 3))];
        this.attackBase = this.rng.range(0, TAU);
        if (w === this.plan.hill && g.waveBosses === 0) {
          // the last stand on the hill ends with the Abomination
          g.waveBosses = Math.ceil(players / 3);
          g.bossQueue = g.waveBosses;
          g.bossTimer = 12;
          g.waveTotal = Math.round(g.waveTotal * 0.85);
          g.spawnQueue = g.waveTotal;
        }
        break;
      }
      case 2: {
        g.waveBosses = 0;
        g.bossQueue = 0;
        g.waveTotal = 600;
        g.spawnQueue = 600;
        g.spawnTimer = 3;
        this.front = -CAMPAIGN.front.lead;
        this.frontSpeed = frontSpeed(this.routeLen);
        this.enterT = 0;
        for (const p of g.players) p.fogT = 0;
        this._breakout();
        break;
      }
      case 3: {
        g.waveTotal = Math.max(8, Math.round(waveZombieCount(w, players, diff) * CAMPAIGN.floorShare));
        g.spawnQueue = g.waveTotal;
        g.spawnTimer = 3;
        const last = st.floor === this.cfg.floors.length;
        g.waveBosses = last ? Math.ceil(players / CAMPAIGN.bossPlayers.floor) : 0;
        g.bossQueue = g.waveBosses;
        g.bossTimer = CAMPAIGN.bossDelay.floor + this._smallTeamDelay();
        break;
      }
      default: {
        this.quota = killQuota(players, diff.count);
        this.kills = 0;
        this.zip = false;
        g.waveTotal = this.quota;
        g.spawnQueue = 99999;
        g.spawnTimer = 3;
        g.waveBosses = Math.ceil(players / CAMPAIGN.bossPlayers.roof);
        g.bossQueue = g.waveBosses;
        g.bossTimer = CAMPAIGN.bossDelay.roof + this._smallTeamDelay();
        break;
      }
    }
    g.emit({ type: 'campaign', what: 'stage', stage: st.stage, floor: st.floor, pid: 0 });
    this._rects = null;
  }

  /** Extra seconds before a boss walks in on the last floor / the roof, for teams under three. */
  _smallTeamDelay() {
    return CAMPAIGN.bossDelay.small * Math.max(0, 3 - Math.max(1, this.game.wavePlayers));
  }

  /** Waves that do not end by killing everything: the breakout and the roof. */
  holdsWave() {
    return this.stage === 2 || this.stage === 4;
  }

  /** Cap on zombies alive at once for the current stage. */
  aliveCap(max) {
    const n = Math.max(1, this.game.players.length);
    const c = CAMPAIGN.cap;
    switch (this.stage) {
      case 2: return Math.min(max, c.breakout + 10 * n);
      case 3: return Math.min(max, c.floor + c.floorPerPlayer * n);
      case 4: return Math.min(max, c.roof + c.roofPerPlayer * n);
      default: return max;
    }
  }

  /** Multiplier on the spawn interval of the stage (< 1 = faster). */
  pace() {
    switch (this.stage) {
      case 2: return CAMPAIGN.pace.breakout;
      case 3: return CAMPAIGN.pace.floor;
      case 4: return CAMPAIGN.pace.roof;
      default: return 1;
    }
  }

  /** A joiner enters the fight alive (no wave clear to wait for) during the breakout and the roof. */
  lateAlive() {
    return this.holdsWave();
  }

  // -----------------------------------------------------------------------------------
  // Stage geometry, teleports

  /** The circle, supply and floor of the current stage (also written into the snapshot). */
  setGeometry() {
    const cfg = this.cfg, map = this.game.map;
    switch (this.stage) {
      case 2:
        this.circle = { x: cfg.entrance.x, y: cfg.entrance.y, r: cfg.entrance.r };
        this.supply = { x: map.supply.x, y: map.supply.y };
        break;
      case 3: {
        const f = cfg.floors[this.floor - 1];
        this.circle = { x: f.stairs.x, y: f.stairs.y, r: f.stairs.r };
        this.supply = { x: f.supply.x, y: f.supply.y };
        break;
      }
      case 4: {
        const z = cfg.roof.zip;
        this.circle = { x: z.ix, y: z.iy, r: z.r };
        this.supply = { x: cfg.roof.supply.x, y: cfg.roof.supply.y };
        break;
      }
      default:
        this.circle = { x: cfg.hill.x, y: cfg.hill.y, r: cfg.hill.plateau };
        this.supply = { x: map.supply.x, y: map.supply.y };
    }
  }

  /** The spawn/arrival table of the current stage (floors and roof), else null. */
  arrivals() {
    if (this.stage === 3) return this.cfg.floors[this.floor - 1].arrive;
    if (this.stage === 4) return this.cfg.roof.arrive;
    return null;
  }

  _place(p, x, y) {
    p.x = x;
    p.y = y;
    resetVertical(p, this.game.world.terrainQ(x, y));
    p.kbx = 0;
    p.kby = 0;
    p.vx = 0;
    p.vy = 0;
  }

  /** Put everyone standing (alive or downed) on the arrival slots of the current stage. */
  teleportTeam() {
    const arr = this.arrivals();
    if (!arr) return;
    let i = 0;
    for (const p of this.game.players) {
      if (p.escaped || p.state === 'dead') continue;
      const s = arr[i++ % arr.length];
      this._place(p, s.x, s.y);
    }
    this._resetBots();
  }

  /** The bots' plans (paths, spots, shopping) belong to the place they left. */
  _resetBots() {
    for (const b of this.game.bots) {
      b.pathLen = 0;
      b.spotT = 0;
      b.spotAX = NaN;
      b.replan = true;
      b.shopDone = false;
      b.buys = 0;
      b.target = null;
    }
  }

  /** Remove what belongs to the place the team is leaving: zombies, loot, shots, deployables. */
  clearField() {
    const g = this.game;
    for (const z of g.zombies) z.dead = true;
    g.spawnQueue = 0;
    g.bossQueue = 0;
    for (const k of g.pickups) k.life = 0;
    for (const pr of g.projectiles) pr.dead = true;
    for (const h of g.hazards) h.life = 0;
    for (const t of g.turrets) {
      if (!t.dead) {
        t.dead = true;
        g.ids.turret.free(t.id);
      }
    }
    g.turrets.length = 0;
    for (const b of g.barricades) b.dead = true;
    g.barricadesDirty = true;
  }

  /** The stairs: everyone goes up one floor (to the roof from the last), the arrival breather starts. */
  moveUp() {
    const g = this.game;
    this.clearField();
    if (this.floor < this.cfg.floors.length) {
      this.floor++;
    } else {
      this.stage = 4;
      this.floor = this.cfg.floors.length + 1;
      this.quota = 0;
      this.kills = 0;
      this.zip = false;
    }
    this.sub = SUB.ARRIVE;
    this.after = 'wave';
    this.setGeometry();
    this.teleportTeam();
    g.timer = CAMPAIGN.arrive;
    this.dropSupplies();
    this._rects = null;
    g.emit({ type: 'campaign', what: 'floor', stage: this.stage, floor: this.floor, pid: 0 });
  }

  /** The team stands at the door: the breakout is over and the ascent begins on floor 1. */
  arrive() {
    const g = this.game;
    this.clearField();
    this.front = -1e9;
    this.stage = 3;
    this.floor = 1;
    this.stats.arrivals++;
    this.justArrived = true;
    this.setGeometry();
    this.teleportTeam();
    this._rects = null;
    g.emit({ type: 'campaign', what: 'floor', stage: 3, floor: 1, pid: 0 });
    // the stage counts as a cleared wave: bonus, respawns, revives
    g._waveClear();
  }

  /** Ammo, first aid and armour on the floor beside the supply point. */
  dropSupplies() {
    const g = this.game, world = g.world, rng = this.rng;
    const s = this.supply;
    const n = g.players.length;
    const loot = ['armor', 'frag'];
    for (let i = 0; i < 1 + (n >> 1); i++) loot.push('ammo');
    for (let i = 0; i < 1 + Math.floor(n / 3); i++) loot.push('health');
    const pool = crateWeaponPool(Math.max(1, g.wave + 1));
    if (this.stage >= 3) loot.push('crate');
    loot.forEach((kind, i) => {
      const a = (i / loot.length) * TAU + rng.range(-0.2, 0.2);
      let x = s.x + Math.cos(a) * 62, y = s.y + Math.sin(a) * 62;
      if (!world.isCircleFree(x, y, 14, false)) {
        x = s.x + Math.cos(a) * 34;
        y = s.y + Math.sin(a) * 34;
      }
      if (!world.isCircleFree(x, y, 14, false)) return;
      spawnPickup(g, kind, x, y, kind === 'crate' ? pool[Math.floor(rng.next() * pool.length)] : null, Math.max(PICKUP_LIFETIME, CAMPAIGN.drop.life));
    });
    g.emit({ type: 'drop', x: Math.round(s.x), y: Math.round(s.y) });
  }

  /** A clear spot near (cx, cy) for a joiner or a respawn. */
  _freeNear(cx, cy, i) {
    const g = this.game, world = g.world;
    const a0 = (i * TAU) / 6 + 0.4;
    for (let ring = 0; ring < 6; ring++) {
      const d = ring === 0 ? 0 : 36 + ring * 36;
      for (let k = 0; k < (ring === 0 ? 1 : 8); k++) {
        const a = a0 + (k * TAU) / 8;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (!world.isCircleFree(x, y, PLAYER_RADIUS + 4, true)) continue;
        let taken = false;
        for (const p of g.players) {
          if (p.state !== 'dead' && !p.escaped && Math.abs(p.x - x) < PLAYER_RADIUS * 2 && Math.abs(p.y - y) < PLAYER_RADIUS * 2) {
            taken = true;
            break;
          }
        }
        if (!taken) return { x, y };
      }
    }
    return { x: cx, y: cy };
  }

  /** Where respawns and late joiners appear right now (players built with the game start on the hill). */
  spawnPoint(i) {
    const g = this.game, cfg = this.cfg;
    if (this.stage === 1) {
      const sp = cfg.hill.spawns;
      const s = sp[i % sp.length];
      return this._freeNear(s.x, s.y, i);
    }
    if (this.stage === 2) {
      // beside the survivor who has got farthest along, but never behind the front
      let best = null, bs = -Infinity;
      for (const p of g.players) {
        if (p.state === 'dead' || p.escaped) continue;
        const s = routeProgress(this.route, p.x, p.y).s;
        if (s > bs) {
          bs = s;
          best = p;
        }
      }
      let cx, cy;
      if (best && bs > this.front + 60) {
        cx = best.x;
        cy = best.y;
      } else {
        const pt = routePoint(this.route, Math.max(0, this.front + 180));
        cx = pt.x;
        cy = pt.y;
      }
      return this._freeNear(cx, cy, i);
    }
    const arr = this.arrivals();
    const s = arr[i % arr.length];
    return this._freeNear(s.x, s.y, i);
  }

  // -----------------------------------------------------------------------------------
  // Spawning

  _compFor(x, y) {
    return componentAt(this.game.flow, this.comp, x, y);
  }

  /** Component of the current floor (cached). */
  _floorComp() {
    const k = this.stage === 4 ? this.cfg.floors.length : this.floor - 1;
    if (this.floorComp[k] === undefined) {
      const f = this.stage === 4 ? this.cfg.roof : this.cfg.floors[k];
      this.floorComp[k] = this._compFor(f.arrive[0].x, f.arrive[0].y);
    }
    return this.floorComp[k];
  }

  /**
   * Spawn rectangles for wave zombies (zombies.js pickSpawnRect): a ring around the hill
   * weighted toward the current spiral of attack directions, the horde front and the
   * ground ahead of the team on the breakout, the floor's doors and vents inside the tower.
   * @returns {{rects: object[], far: number}}
   */
  spawnRects() {
    const g = this.game;
    switch (this.stage) {
      case 1: return this._hillRects();
      case 2: return this._breakoutRects();
      default: {
        const f = this.stage === 4 ? this.cfg.roof : this.cfg.floors[this.floor - 1];
        return { rects: f.spawns, far: this.stage === 4 ? 260 : 300 };
      }
    }
  }

  _hillRects() {
    const g = this.game, world = g.world, cfg = this.cfg.hill;
    if (!this._hillAll) {
      const all = [];
      const H = CAMPAIGN.hillRing;
      for (let k = 0; k < RING_ANGLES; k++) {
        const a = ((k + 0.5) / RING_ANGLES) * TAU;
        for (let j = 0; j < 5; j++) {
          const d = cfg.r + H.lo + ((H.hi - H.lo) * j) / 4;
          const x = Math.round(cfg.x + Math.cos(a) * d), y = Math.round(cfg.y + Math.sin(a) * d);
          const half = SPAWN_BOX / 2;
          if (x < half + 40 || y < half + 40 || x > g.map.width - half - 40 || y > g.map.height - half - 40) continue;
          if (!world.isCircleFree(x, y, half, false, MASK_MOVE)) continue;
          if (this._compFor(x, y) !== this.hillComp) continue;
          all.push({ x, y, w: SPAWN_BOX, h: SPAWN_BOX, a, weight: 1 });
          break;
        }
      }
      this._hillAll = all;
    }
    const all = this._hillAll;
    if (!all.length) return { rects: g.map.zombieSpawns.length ? g.map.zombieSpawns : [{ x: cfg.x + cfg.r + 200, y: cfg.y, w: 60, h: 60 }], far: 400 };
    // the spiral: the attack directions turn slowly during the wave
    const dt = g.time - this.waveT0;
    const spin = dt * CAMPAIGN.hillRing.spinRate;
    for (const r of all) {
      let wgt = 1;
      for (let d = 0; d < this.ndirs; d++) {
        const c = this.attackBase + spin + (d * TAU) / this.ndirs;
        const k = Math.cos(r.a - c);
        if (k > 0) wgt += 6 * k * k * k * k;
      }
      r.weight = wgt;
    }
    return { rects: all, far: 700 };
  }

  _breakoutRects() {
    const g = this.game, world = g.world;
    if (this._rects && g.time - this._rectsAt < CAMPAIGN_RECT_TTL) return this._rects;
    // the lead of the team
    let lead = 0, any = false;
    for (const p of g.players) {
      if (p.state === 'dead' || p.escaped) continue;
      any = true;
      const s = routeProgress(this.route, p.x, p.y).s;
      if (s > lead) lead = s;
    }
    if (!any) lead = Math.max(0, this.front);
    const out = [];
    const half = SPAWN_BOX / 2;
    const pt = { x: 0, y: 0, a: 0 };
    const tryAt = (s, off, weight) => {
      routePoint(this.route, Math.max(0, Math.min(this.routeLen, s)), pt);
      const x = Math.round(pt.x - Math.sin(pt.a) * off), y = Math.round(pt.y + Math.cos(pt.a) * off);
      if (x < half + 40 || y < half + 40 || x > g.map.width - half - 40 || y > g.map.height - half - 40) return;
      if (!world.isCircleFree(x, y, half, false, MASK_MOVE)) return;
      if (this._compFor(x, y) !== this.hillComp) return;
      out.push({ x, y, w: SPAWN_BOX, h: SPAWN_BOX, weight });
    };
    // at the horde front, across the width of the street: what walks in at the team's back
    for (let j = 0; j < 3; j++) for (let o = -420; o <= 420; o += 105) tryAt(this.front + 80 + j * 90, o, 3);
    // ambushes ahead of the lead
    for (let j = 0; j < 3; j++) for (let o = -360; o <= 360; o += 120) tryAt(lead + 760 + j * 140, o, 1.6);
    // and out of the side streets near the middle of the team
    for (let o = -520; o <= 520; o += 130) tryAt(lead + 420, o, 0.8);
    this._rectsAt = g.time;
    if (!out.length) out.push({ x: Math.round(pt.x), y: Math.round(pt.y), w: SPAWN_BOX, h: SPAWN_BOX, weight: 1 });
    this._rects = { rects: out, far: 420 };
    return this._rects;
  }

  /** The breakout's opening: the hill's gates go up in smoke and a first wave pours through. */
  _breakout() {
    const g = this.game, cfg = this.cfg.hill;
    const rng = this.rng;
    for (let k = 0; k < 4; k++) {
      const a = cfg.gate + (k * TAU) / 4 + 0.4;
      const R = 300;
      g.emit({ type: 'explosion', x: Math.round(cfg.x + Math.cos(a) * R), y: Math.round(cfg.y + Math.sin(a) * R), r: 130, kind: 'grenade' });
    }
    g.emit({ type: 'campaign', what: 'breakout', stage: 2, floor: 0, pid: 0 });
    // the first of the horde, over the palisade on the far side
    const n = Math.min(16, 6 + g.players.length * 2);
    for (let i = 0; i < n; i++) {
      const a = cfg.gate + Math.PI + rng.range(-1.1, 1.1);
      const d = rng.range(cfg.plateau + 60, cfg.r - 120);
      const x = cfg.x + Math.cos(a) * d, y = cfg.y + Math.sin(a) * d;
      if (!g.world.isCircleFree(x, y, 16, false)) continue;
      g.spawnZombieAt(rng.chance(0.35) ? 'runner' : 'walker', x, y);
    }
  }

  // -----------------------------------------------------------------------------------
  // Per-tick rules

  /** One tick (after the phase update, before the players move). */
  update() {
    const g = this.game;
    if (g.over) return;
    if (this.stage === 2 && g.phase === 'wave') this._front();
    else if (this.stage === 3 && this.sub === SUB.OPEN && g.phase === 'intermission') this._stairs();
    if (this.stage === 4) this._rides();
  }

  /** The horde front: advance, hurt whoever is behind it, and open the door when the team is in. */
  _front() {
    const g = this.game;
    const F = CAMPAIGN.front;
    this.front += this.frontSpeed * DT;
    const c = this.circle;
    let alive = 0, inside = 0, anyInside = false;
    const len = this.routeLen;
    for (const p of g.players) {
      if (p.state === 'dead' || p.escaped) continue;
      const prog = routeProgress(this.route, p.x, p.y);
      const behind = this.front - prog.s;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= c.r) {
        anyInside = true;
        if (p.state === 'alive') inside++;
      }
      if (p.state === 'alive') alive++;
      if (behind <= 0) {
        p.fogT = Math.max(0, (p.fogT || 0) - DT * 2);
        continue;
      }
      p.fogT = (p.fogT || 0) + DT;
      if (p.state === 'downed') {
        if (!p.selfRevive) p.bleedout -= DT * F.downedBleed;
        continue;
      }
      const amount = frontDps(p.fogT) * DT;
      p.hp -= amount;
      this.stats.blight += amount;
      p.dotAcc += amount;
      // reported like acid, "from" the horde behind
      const dx = -Math.cos(this._heading(prog.s)), dy = -Math.sin(this._heading(prog.s));
      p.dotX = p.x + dx * 120;
      p.dotY = p.y + dy * 120;
      if (p.hp <= 0) downPlayer(g, p);
    }
    if (alive > 0 && inside === alive) this.enterT += DT;
    else this.enterT = Math.max(0, this.enterT - DT * 2);
    this.t = this.enterT > 0 ? Math.max(0, CAMPAIGN.enter - this.enterT) : 0;
    this.tTotal = this.enterT > 0 ? CAMPAIGN.enter : 0;
    if (this.enterT >= CAMPAIGN.enter || (this.front >= len + 60 && anyInside)) this.arrive();
  }

  _heading(s) {
    return routePoint(this.route, s, this._hp || (this._hp = { x: 0, y: 0, a: 0 })).a;
  }

  /** Everyone standing on the stairs: go up soon. */
  _stairs() {
    const g = this.game, c = this.circle;
    let alive = 0, on = 0;
    for (const p of g.players) {
      if (p.state !== 'alive' || p.escaped) continue;
      alive++;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= c.r) on++;
    }
    if (alive > 0 && on === alive && g.timer > 2.5) g.timer = 2.5;
  }

  /** A zombie was killed: counts toward the roof quota. */
  onKill() {
    const g = this.game;
    if (this.stage !== 4 || g.phase !== 'wave' || g.over) return;
    this.kills++;
    if (!this.zip && this.kills >= this.quota) {
      this.zip = true;
      this.sub = SUB.ZIP;
      g.emit({ type: 'campaign', what: 'zip', stage: 4, floor: this.floor, pid: 0 });
    }
  }

  /** Interact near the gantry once the quota is met: start the ride. */
  tryZip(p) {
    if (!this.zip || this.stage !== 4 || p.escaped || p.riding > 0 || p.state !== 'alive') return false;
    const z = this.cfg.roof.zip;
    if (Math.hypot(p.x - z.ix, p.y - z.iy) > z.r) return false;
    p.riding = RIDE_TICKS;
    p.frozen = true;
    p.rideX = p.x;
    p.rideY = p.y;
    p.rideZ = p.z;
    p.sprinting = false;
    p.kbx = 0;
    p.kby = 0;
    this.stats.rides++;
    this.game.emit({ type: 'campaign', what: 'ride', stage: 4, floor: this.floor, pid: p.id });
    return true;
  }

  /** Cable position at parameter e (0..1) into out. */
  cablePoint(e, out) {
    const z = this.cfg.roof.zip, l = this.cfg.landing.end;
    out.x = z.x + (l.x - z.x) * e;
    out.y = z.y + (l.y - z.y) * e;
    out.z = z.z + (l.z - z.z) * e;
    return out;
  }

  _rides() {
    const g = this.game;
    const fx = this._fx;
    fx.z = 0;
    for (const p of g.players) {
      if (!(p.riding > 0)) continue;
      p.riding--;
      const u = 1 - p.riding / RIDE_TICKS;
      let x, y, z;
      if (u < RIDE_LEAD) {
        const k = u / RIDE_LEAD;
        this.cablePoint(0, fx);
        x = p.rideX + (fx.x - p.rideX) * k;
        y = p.rideY + (fx.y - p.rideY) * k;
        z = p.rideZ + (fx.z - CAMPAIGN.zip.hang - p.rideZ) * k;
      } else {
        const t = (u - RIDE_LEAD) / (1 - RIDE_LEAD);
        const e = t * t * (3 - 2 * t);
        this.cablePoint(e, fx);
        x = fx.x;
        y = fx.y;
        z = fx.z - CAMPAIGN.zip.hang;
      }
      p.x = x;
      p.y = y;
      p.zq = Math.max(0, toZq(z));
      p.vzq = 0;
      p.jumpCd = 0;
      p.climbT = 0;
      p.climbTo = -1;
      p.z = p.zq * Z_UNIT;
      if (p.riding === 0) this._land(p);
    }
  }

  _land(p) {
    const g = this.game, l = this.cfg.landing;
    p.frozen = false;
    p.escaped = true;
    p.riding = 0;
    p.hp = Math.max(p.hp, Math.min(p.maxHp, 60));
    const s = l.slots[this.stats.escaped % l.slots.length];
    this.stats.escaped++;
    this._place(p, s.x, s.y);
    g.emit({ type: 'campaign', what: 'escape', stage: 4, floor: this.floor, pid: p.id });
  }

  /**
   * Victory check (core.js _checkEnd): on the roof, once somebody has escaped and nobody is
   * left standing or riding.
   * @returns {'victory'|null}
   */
  checkEnd() {
    if (this.stage !== 4) return null;
    let escaped = 0, active = 0;
    for (const p of this.game.players) {
      if (p.escaped) escaped++;
      else if (p.riding > 0 || p.state === 'alive' || (p.state === 'downed' && p.selfRevive)) active++;
    }
    return escaped > 0 && active === 0 ? 'victory' : null;
  }

  // -----------------------------------------------------------------------------------
  // Rules the zombies and the shots ask about

  /** Speed factor of a zombie on the hill's flank (1 elsewhere). */
  slowMult(z) {
    const t = this.game.world.terrain;
    if (t.flat) return 1;
    const f = t.flank(z.x, z.y);
    return f > 0 ? 1 - CAMPAIGN.slope.slow * f : 1;
  }

  /** Damage factor for a hit on zombie z by player `by` (a Player or null). */
  damageMult(z, by) {
    const t = this.game.world.terrain;
    if (t.flat) return 1;
    let m = 1;
    const f = t.flank(z.x, z.y);
    if (f > 0) m += CAMPAIGN.slope.exposed * f;
    if (by && by.z - z.z >= CAMPAIGN.slope.highDz) m += CAMPAIGN.slope.high;
    return m;
  }

  /** Snapshot.campaign (SPEC §4). */
  snapshot() {
    const c = this.circle;
    return {
      stage: this.stage, floor: this.floor, sub: this.sub,
      x: c.x, y: c.y, r: c.r,
      t: this.t, total: this.tTotal,
      front: this.front > -1e8 ? this.front : -1e9,
      kills: this.kills, quota: this.quota, zip: this.zip ? 1 : 0,
      sx: this.supply.x, sy: this.supply.y,
    };
  }
}
