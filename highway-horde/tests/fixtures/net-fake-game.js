// A stand-in for shared/sim.js's Game (SPEC §3.1) for the netcode tests: same API, the
// same input-queue rules (§3.3), player movement through shared/movement.js (so client
// prediction can be checked exactly), and busy, realistic snapshots: 250 zombies,
// projectiles, pickups, turrets, barricades, hazards and events of every type.

import { buildMap } from '../../public/js/shared/maps.js';
import { createCollisionWorld, stepPlayerMovement } from '../../public/js/shared/movement.js';
import { createRng } from '../../public/js/shared/rng.js';
import { WEAPONS, WEAPON_IDS, PROJECTILE_KINDS } from '../../public/js/shared/weapons.js';
import { ZOMBIE_IDS } from '../../public/js/shared/zombies.js';
import { PICKUP_KINDS } from '../../public/js/shared/items.js';
import { CLASSES, perksFor } from '../../public/js/shared/classes.js';
import { STAMINA_MAX, DEFAULT_SETTINGS } from '../../public/js/shared/constants.js';
import { jumpHeight } from '../../public/js/shared/jump.js';

const DT = 1 / 60;
const MAX_QUEUE = 6;
const EDGES = ['reload', 'frag', 'molotov', 'turret', 'barricade', 'lastWeapon', 'jump'];

/** One sample of every GameEvent type in SPEC §4.1 (plus the sim's 'placefail'). */
export function sampleEvents(rng = createRng(7)) {
  const x = () => Math.round(rng.range(0, 4000) * 10) / 10;
  const a = () => rng.range(-Math.PI, Math.PI);
  return [
    {
      type: 'shot', pid: 2, turret: 0, weapon: 'shotgun', x: x(), y: x(), angle: a(),
      rays: Array.from({ length: 8 }, (_, i) => ({ x: x(), y: x(), hit: i % 3 })),
    },
    { type: 'shot', pid: 0, turret: 7, weapon: 'rifle', x: x(), y: x(), angle: a(), rays: [{ x: x(), y: x(), hit: 1 }] },
    { type: 'shot', pid: 3, turret: 0, weapon: 'rocket', x: x(), y: x(), angle: a(), rays: [] },
    { type: 'chain', pid: 4, points: [{ x: x(), y: x() }, { x: x(), y: x() }, { x: x(), y: x() }] },
    { type: 'melee', pid: 1, x: x(), y: x(), angle: a(), hits: 3 },
    { type: 'zdie', id: 812, ztype: 'bloater', x: x(), y: x(), angle: a(), by: 2, gib: true },
    { type: 'zdie', id: 813, ztype: 'walker', x: x(), y: x(), angle: a(), by: 0, gib: false },
    { type: 'zattack', id: 44, ztype: 'runner', x: x(), y: x(), angle: a() },
    { type: 'spit', id: 45, x: x(), y: x(), angle: a() },
    { type: 'scream', id: 46, x: x(), y: x() },
    { type: 'charge', id: 47, x: x(), y: x(), angle: a() },
    { type: 'slam', id: 48, x: x(), y: x(), r: 190 },
    { type: 'explosion', x: x(), y: x(), r: 150, kind: 'frag' },
    { type: 'explosion', x: x(), y: x(), r: 115, kind: 'bloater' },
    { type: 'ignite', x: x(), y: x(), r: 110 },
    { type: 'pdamage', pid: 5, amount: 12.5, x: x(), y: x() },
    { type: 'down', pid: 3 },
    { type: 'revived', pid: 3, by: 1 },
    { type: 'died', pid: 6 },
    { type: 'respawn', pid: 6 },
    { type: 'pickup', pid: 2, kind: 'ammo', x: x(), y: x(), weapon: null },
    { type: 'pickup', pid: 2, kind: 'crate', x: x(), y: x(), weapon: 'minigun' },
    { type: 'buy', pid: 1, item: 'rifle' },
    { type: 'buyfail', pid: 1, item: 'turret', reason: 'cash' },
    { type: 'reload', pid: 2, weapon: 'lmg', time: 3.4 },
    { type: 'switch', pid: 2, weapon: 'pistol' },
    { type: 'switch', pid: 2, weapon: null },
    { type: 'empty', pid: 4 },
    { type: 'throw', pid: 4, kind: 'molotov' },
    { type: 'place', pid: 5, kind: 'turret', x: x(), y: x() },
    { type: 'placefail', pid: 5, kind: 'barricade' },
    { type: 'destroyed', kind: 'barricade', id: 3, x: x(), y: x() },
    { type: 'objhit', x: x(), y: x() },
    { type: 'wave', wave: 5, boss: true },
    { type: 'bossspawn', id: 900, x: x(), y: x() },
    { type: 'waveclear', wave: 5, bonus: 250 },
    { type: 'drop', x: x(), y: x() },
    { type: 'gameover', reason: 'wiped' },
    { type: 'victory' },
  ];
}

/** A realistic player snapshot record. */
export function samplePlayer(id, rng = createRng(id)) {
  const w = rng.pick(WEAPON_IDS.slice(1));
  return {
    id, x: rng.range(100, 3900), y: rng.range(100, 2900), angle: rng.range(-Math.PI, Math.PI),
    state: rng.pick(['alive', 'alive', 'downed', 'dead']),
    hp: rng.int(1, 150), maxHp: 150, armor: rng.int(0, 100), stamina: rng.range(0, 100), sprinting: rng.chance(0.5),
    slot: rng.int(0, 2),
    slots: ['pistol', w, null],
    ammo: [[rng.int(0, 12), -1], [rng.int(0, 30), rng.int(0, 400)], [0, 0]],
    reloading: rng.chance(0.3) ? rng.range(0.01, 1) : 0,
    spin: rng.range(0, 1), firing: rng.chance(0.5), meleeing: rng.chance(0.2) ? rng.range(0.01, 1) : 0,
    cash: rng.int(0, 50000), kills: rng.int(0, 5000), damage: rng.int(0, 900000), revives: rng.int(0, 40),
    downs: rng.int(0, 40), earned: rng.int(0, 90000),
    frags: rng.int(0, 8), molotovs: rng.int(0, 3), turrets: rng.int(0, 2), barricades: rng.int(0, 4),
    selfRevive: rng.chance(0.5), bleedout: rng.range(0, 30), revive: rng.range(0, 1), reviver: rng.int(0, 6),
    respawn: rng.chance(0.3), ready: rng.chance(0.5), lastSeq: rng.int(0, 1e6), sprintLock: rng.chance(0.3),
    // jump state: whole ticks, airborne (> 0) or landing cooldown (< 0); z follows from it
    ...jumpState(rng.int(-6, 35) / 60),
  };
}

function jumpState(jumpT) {
  return { jumpT, z: jumpHeight(jumpT) };
}

/**
 * The heaviest snapshot the SPEC budgets for: 6 players, 250 zombies and `nEvents`
 * events (mostly shotgun/SMG fire, zombie attacks and deaths, like a real wave).
 */
export function bigSnapshot(nEvents = 60, seed = 3) {
  const rng = createRng(seed);
  const players = [];
  for (let i = 1; i <= 6; i++) players.push(samplePlayer(i, rng));
  const zombies = [];
  for (let i = 0; i < 250; i++) {
    zombies.push({
      id: 1 + i * 7, type: rng.pick(ZOMBIE_IDS), x: rng.range(0, 4000), y: rng.range(0, 3000),
      angle: rng.range(-Math.PI, Math.PI), hp: rng.range(0, 1), flags: rng.int(0, 31),
    });
  }
  const events = [];
  const samples = sampleEvents(rng);
  for (let i = 0; i < nEvents; i++) {
    const r = rng.next();
    if (r < 0.35) {
      events.push({
        type: 'shot', pid: rng.int(1, 6), turret: 0, weapon: 'shotgun', x: rng.range(0, 4000), y: rng.range(0, 3000),
        angle: rng.range(-3, 3),
        rays: Array.from({ length: 8 }, () => ({ x: rng.range(0, 4000), y: rng.range(0, 3000), hit: rng.int(0, 2) })),
      });
    } else if (r < 0.55) {
      events.push({ type: 'zattack', id: rng.int(1, 2000), ztype: rng.pick(ZOMBIE_IDS), x: rng.range(0, 4000), y: rng.range(0, 3000), angle: rng.range(-3, 3) });
    } else if (r < 0.8) {
      events.push({ type: 'zdie', id: rng.int(1, 2000), ztype: rng.pick(ZOMBIE_IDS), x: rng.range(0, 4000), y: rng.range(0, 3000), angle: rng.range(-3, 3), by: rng.int(0, 6), gib: rng.chance(0.2) });
    } else {
      events.push(samples[i % samples.length]);
    }
  }
  return {
    tick: 123456, phase: 'wave', wave: 12, totalWaves: 15, timer: 0, remaining: 311, bossHp: 0.42,
    objective: { hp: 3120, maxHp: 5000 }, readyCount: 0,
    players,
    zombies,
    projectiles: Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i, kind: PROJECTILE_KINDS[i % PROJECTILE_KINDS.length], x: rng.range(0, 4000), y: rng.range(0, 3000), angle: rng.range(-3, 3),
    })),
    pickups: Array.from({ length: 12 }, (_, i) => ({
      id: 200 + i, kind: PICKUP_KINDS[i % PICKUP_KINDS.length], x: rng.range(0, 4000), y: rng.range(0, 3000),
      weapon: PICKUP_KINDS[i % PICKUP_KINDS.length] === 'crate' ? 'tesla' : null,
    })),
    turrets: Array.from({ length: 6 }, (_, i) => ({
      id: 300 + i, owner: 1 + i, x: rng.range(0, 4000), y: rng.range(0, 3000), angle: rng.range(-3, 3),
      hp: rng.range(0, 1), ammo: rng.range(0, 1), firing: rng.chance(0.5),
    })),
    barricades: Array.from({ length: 12 }, (_, i) => ({
      id: 400 + i, owner: 1 + (i % 6), x: rng.range(0, 4000), y: rng.range(0, 3000), angle: rng.range(-3, 3), hp: rng.range(0, 1),
    })),
    hazards: Array.from({ length: 8 }, (_, i) => ({
      id: 500 + i, kind: i % 2 ? 'acid' : 'fire', x: rng.range(0, 4000), y: rng.range(0, 3000), r: 60 + i * 7.3, life: rng.range(0, 1),
    })),
    events,
  };
}

function clearEdges(cmd) {
  const c = { ...cmd, slot: -1, cycle: 0 };
  for (const e of EDGES) c[e] = false;
  return c;
}

/** Minimal Game: exact SPEC input/queue rules and movement, synthetic everything else. */
export class FakeGame {
  constructor({ mapId = 'highway', seed = 1, settings = {}, players = [], zombies = 250 } = {}) {
    this.map = buildMap(mapId, seed);
    this.world = createCollisionWorld(this.map);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = createRng(seed);
    this.tick = 0;
    this.phase = 'prep';
    this.wave = 0;
    this.players = [];
    this.events = [];
    /** Log of everything the host fed in, for assertions. */
    this.log = { commands: [], applied: new Map(), added: [], removed: [] };
    this.zombieCount = zombies;
    this.barricades = [];
    for (const p of players) this._add(p, 'alive');
  }

  _add(info, state) {
    const perks = perksFor(info.cls);
    const sp = this.map.playerSpawns[this.players.length % this.map.playerSpawns.length];
    const p = {
      id: info.id, name: info.name, color: info.color, cls: info.cls,
      x: sp.x, y: sp.y, angle: 0, state,
      stamina: STAMINA_MAX, sprintLock: false, sprinting: false,
      speedMult: perks.speedMult, staminaMult: perks.staminaMult, moveMult: 1,
      slots: ['pistol', (CLASSES[info.cls] || CLASSES.soldier).startWeapon, null], slot: 0,
      lastSeq: 0, queue: [], cmd: null, ready: false, cash: 500,
    };
    this.players.push(p);
    this.log.applied.set(p.id, []);
    return p;
  }

  getPlayer(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  addPlayer(info) {
    this.log.added.push({ ...info, tick: this.tick });
    return this.getPlayer(info.id) || this._add(info, this.phase === 'wave' ? 'dead' : 'alive');
  }

  removePlayer(id) {
    this.log.removed.push(id);
    this.players = this.players.filter((p) => p.id !== id);
  }

  setInput(id, cmd) {
    const p = this.getPlayer(id);
    if (p && cmd) p.queue.push({ ...cmd });
  }

  command(id, cmd) {
    this.log.commands.push({ id, cmd: { ...cmd }, tick: this.tick });
    const p = this.getPlayer(id);
    if (!p) return;
    if (cmd.type === 'buy') this.events.push({ type: 'buy', pid: id, item: cmd.item });
    if (cmd.type === 'ready') p.ready = true;
  }

  _nextCmd(p) {
    const q = p.queue;
    while (q.length > MAX_QUEUE) {
      const dropped = q.shift();
      for (const e of EDGES) if (dropped[e]) q[0][e] = true;
    }
    if (q.length) {
      p.cmd = q.shift();
      p.lastSeq = p.cmd.seq;
      return p.cmd;
    }
    return p.cmd ? clearEdges(p.cmd) : null;
  }

  step() {
    this.tick++;
    if (this.phase === 'prep' && this.tick >= 120) {
      this.phase = 'wave';
      this.wave = 1;
      this.events.push({ type: 'wave', wave: 1, boss: false });
    }
    for (const p of this.players) {
      const cmd = this._nextCmd(p);
      if (!cmd) continue;
      this.log.applied.get(p.id).push(cmd);
      if (p.state === 'dead') continue;
      p.angle = cmd.angle;
      if (cmd.slot >= 0 && p.slots[cmd.slot]) p.slot = cmd.slot;
      const w = p.slots[p.slot];
      p.moveMult = p.state === 'alive' && w ? WEAPONS[w].moveMult : 1;
      stepPlayerMovement(p, cmd, DT, this.world);
      if (cmd.fire && this.tick % 6 === 0) {
        this.events.push({
          type: 'shot', pid: p.id, turret: 0, weapon: w || 'pistol', x: p.x, y: p.y, angle: p.angle,
          rays: [{ x: p.x + Math.cos(p.angle) * 400, y: p.y + Math.sin(p.angle) * 400, hit: 0 }],
        });
      }
      if (cmd.reload) this.events.push({ type: 'reload', pid: p.id, weapon: w || 'pistol', time: WEAPONS[w || 'pistol'].reload });
    }
    // Every half second, one event of every kind so presentation paths get exercised.
    if (this.tick % 30 === 0) for (const ev of sampleEvents(this.rng)) this.events.push(ev);
  }

  snapshot() {
    const t = this.tick * DT;
    const cx = this.map.width / 2, cy = this.map.height / 2;
    const zombies = [];
    for (let i = 0; i < this.zombieCount; i++) {
      const r = 300 + (i % 25) * 30, w = 0.05 + (i % 7) * 0.01, ph = i * 0.37;
      zombies.push({
        id: i + 1, type: ZOMBIE_IDS[i % ZOMBIE_IDS.length],
        x: cx + Math.cos(t * w + ph) * r, y: cy + Math.sin(t * w + ph) * r * 0.6,
        angle: t * w + ph + Math.PI / 2, hp: (i % 10) / 10, flags: i % 32,
      });
    }
    const events = this.events;
    this.events = [];
    return {
      tick: this.tick, phase: this.phase, wave: this.wave, totalWaves: this.settings.waves,
      timer: this.phase === 'prep' ? Math.max(0, 2 - t) : 0, remaining: this.zombieCount, bossHp: -1,
      objective: this.settings.objective ? { hp: 4000, maxHp: 5000 } : null,
      readyCount: this.players.filter((p) => p.ready).length,
      players: this.players.map((p) => ({
        id: p.id, x: p.x, y: p.y, angle: p.angle, state: p.state, hp: 100, maxHp: 100, armor: 0,
        stamina: p.stamina, sprinting: p.sprinting, slot: p.slot, slots: p.slots.slice(),
        ammo: [[12, -1], [30, 270], [0, 0]], reloading: 0, spin: 0, firing: false, meleeing: 0,
        cash: p.cash, kills: 0, damage: 0, revives: 0, downs: 0, frags: 0, molotovs: 0, turrets: 0,
        barricades: 0, selfRevive: false, bleedout: 0, revive: 0, reviver: 0, respawn: p.state === 'dead',
        ready: p.ready, lastSeq: p.lastSeq, sprintLock: p.sprintLock, z: p.z || 0, jumpT: p.jumpT || 0,
      })),
      zombies,
      projectiles: [{ id: 1, kind: 'rocket', x: cx + (t * 300) % 800, y: cy, angle: 0 }],
      pickups: [{ id: 1, kind: 'crate', x: cx - 200, y: cy + 150, weapon: 'rifle' }],
      turrets: [{ id: 1, owner: 1, x: cx + 120, y: cy - 220, angle: t, hp: 1, ammo: 0.5, firing: true }],
      barricades: this.barricades.map((b) => ({ ...b })),
      hazards: [{ id: 1, kind: 'fire', x: cx, y: cy - 300, r: 110, life: 0.5 }],
      events,
    };
  }
}
