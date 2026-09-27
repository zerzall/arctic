// Mock of the SPEC §6.2 Session API for the UI sandbox: a fake lobby (four survivors
// with different classes, joins, ready toggles, chat, pings) and a fake match that streams
// SPEC §4 Snapshots — players, zombies, pickups, turrets, barricades, hazards, projectiles
// and every GameEvent type — with phases cycling prep → wave → intermission → … →
// gameover/victory. The local player really moves, shoots, reloads, switches weapons,
// throws and buys, so the HUD, shop and input can be exercised without the real netcode.
//
// Also exports stub renderer/audio/portrait fallbacks, used only if the real modules fail
// to load.

import {
  DEFAULT_SETTINGS, PLAYER_COLORS, PLAYER_SPEED, SPRINT_MULT, STAMINA_MAX, START_CASH,
  PREP_TIME, INTERMISSION_TIME, WAVE_CLEAR_BONUS, SUPPLY_RADIUS, FRAG_MAX, MOLOTOV_MAX, TURRET, BARRICADE,
  ARMOR_MAX, REVIVE_TIME, REVIVE_RADIUS, INTERACT_RADIUS,
} from '../js/shared/constants.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { ZOMBIE_IDS, ZFLAG } from '../js/shared/zombies.js';
import { CLASSES, perksFor } from '../js/shared/classes.js';
import { ITEMS, ammoPrice, isBuyable } from '../js/shared/items.js';
import { createRng } from '../js/shared/rng.js';
import { clamp } from '../js/shared/math.js';

const BOTS = [
  { name: 'Doc', cls: 'medic', color: 2 },
  { name: 'Sparks', cls: 'engineer', color: 1 },
  { name: 'Boom', cls: 'demo', color: 4 },
  { name: 'Tank', cls: 'heavy', color: 3 },
];
const CHATTER = ['hey all 👋', 'ready when you are', 'I\'ll hold the east side', 'who has a turret?', 'gg last time lol'];

function microtask(fn) {
  Promise.resolve().then(fn);
}

class Emitter {
  constructor() {
    this._l = new Map();
  }
  on(ev, fn) {
    if (!this._l.has(ev)) this._l.set(ev, []);
    this._l.get(ev).push(fn);
    return fn;
  }
  off(ev, fn) {
    const l = this._l.get(ev);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(ev, ...args) {
    for (const fn of (this._l.get(ev) || []).slice()) fn(...args);
  }
  listenerCount(ev) {
    return (this._l.get(ev) || []).length;
  }
}

/**
 * Create the mock session factory.
 * @param {{ buildMap: Function }} deps
 */
export function createMockApi({ buildMap }) {
  const api = {
    current: null,
    /** Fake latency for host/join, ms. */
    delay: 250,
    async getServerInfo() {
      return { relay: false };
    },
    async hostGame({ name, color, cls, transport = 'auto' }) {
      await wait(api.delay);
      const s = new MockSession({ buildMap, isHost: true, localId: 1, profile: { name, color, cls }, transport: transport === 'local' ? 'local' : 'p2p', code: 'HWY42' });
      api.current = s;
      if (transport !== 'local') s._lobbyActivity();
      return s;
    },
    async joinGame({ code, name, color, cls }) {
      await wait(api.delay);
      const c = String(code || '').toUpperCase();
      if (c === 'XXXXX') throw new Error('Room not found');
      if (c === 'FUZZY') throw new Error('Room is full');
      if (c === 'VVVVV') throw new Error('Game version mismatch');
      if (c === 'NNNET') throw new Error('Could not connect');
      const s = new MockSession({ buildMap, isHost: false, localId: 3, profile: { name, color, cls }, transport: 'p2p', code: c });
      api.current = s;
      s._fillRoster();
      return s;
    },
  };
  return api;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class MockSession extends Emitter {
  constructor({ buildMap, isHost, localId, profile, transport, code }) {
    super();
    this.buildMap = buildMap;
    this.isHost = isHost;
    this.localId = localId;
    this.transport = transport;
    this.code = transport === 'local' ? null : code;
    this.inviteUrl = this.code ? `${location.origin}${location.pathname.replace(/dev\/ui-sandbox\.html$/, '')}?join=${this.code}` : null;
    this.roster = [{ id: localId, name: profile.name || 'You', color: profile.color | 0, cls: profile.cls || 'soldier', ready: false, ping: isHost ? 0 : 38, host: isHost }];
    this.settings = { ...DEFAULT_SETTINGS };
    this.inGame = false;
    this.stats = { ping: isHost ? 0 : 38, fps: 60, kbpsIn: 42, kbpsOut: 6, snapshotsPerSec: isHost ? 0 : 20 };
    this.left = false;
    this.timers = [];
    this.rng = createRng(1234);
    this.auto = true;
    this.g = null;
    this.events = [];
  }

  _t(fn, ms) {
    const id = setTimeout(() => {
      if (!this.left) fn();
    }, ms);
    this.timers.push(id);
  }

  _emitRoster() {
    this.emit('roster', this.roster);
  }

  /** Host mode: friends trickle in, chat, ready up. */
  _lobbyActivity() {
    BOTS.slice(0, 3).forEach((b, i) => {
      this._t(() => this._addBot(i), 700 + i * 900);
      this._t(() => this._setBotReady(b.name, true), 2600 + i * 1100);
      this._t(() => this._chat(b.name, CHATTER[i]), 1400 + i * 1300);
    });
    const pingLoop = () => {
      for (const r of this.roster) if (!r.host) r.ping = 30 + Math.round(Math.random() * 60);
      if (!this.inGame) this._emitRoster();
      this._t(pingLoop, 2000);
    };
    this._t(pingLoop, 2000);
  }

  _addBot(i) {
    const b = BOTS[i];
    if (this.roster.some((r) => r.name === b.name)) return;
    const id = this.isHost ? i + 2 : [1, 2, 4, 5][i];
    const used = new Set(this.roster.map((r) => r.color));
    let color = b.color;
    while (used.has(color)) color = (color + 1) % 6;
    this.roster.push({ id, name: b.name, color, cls: b.cls, ready: false, ping: 40 + i * 17, host: !this.isHost && i === 0 });
    this.roster.sort((a, c) => a.id - c.id);
    this.emit('chat', { pid: 0, name: '', text: `${b.name} joined the room`, system: true });
    this._emitRoster();
  }

  _setBotReady(name, ready) {
    const r = this.roster.find((q) => q.name === name);
    if (!r || r.host) return;
    r.ready = ready;
    this._emitRoster();
  }

  _chat(name, text) {
    const r = this.roster.find((q) => q.name === name);
    if (!r) return;
    this.emit('chat', { pid: r.id, name: r.name, text, system: false });
  }

  /** Immediately fill the room with four survivors (deterministic screenshots). */
  _fillRoster() {
    for (let i = 0; i < 3; i++) this._addBot(i);
    for (const r of this.roster) if (!r.host && r.id !== this.localId) r.ready = true;
    this._emitRoster();
  }

  // ---- Session API --------------------------------------------------------------------------

  setProfile(p = {}) {
    const me = this.roster.find((r) => r.id === this.localId);
    if (!me) return;
    if (typeof p.name === 'string' && p.name.trim()) me.name = p.name.trim().slice(0, 16);
    if (Number.isInteger(p.color)) me.color = p.color;
    if (typeof p.cls === 'string' && CLASSES[p.cls] && !this.inGame) me.cls = p.cls;
    if (typeof p.ready === 'boolean' && !me.host) me.ready = p.ready;
    microtask(() => this._emitRoster());
  }

  setSettings(partial) {
    if (!this.isHost || this.inGame) return false;
    Object.assign(this.settings, partial);
    microtask(() => this.emit('settings', this.settings));
    return true;
  }

  start() {
    if (!this.isHost || this.inGame) return false;
    this._startGame();
    return true;
  }

  /** Mock only: the (fake) host starts the match for a client session. */
  _hostStarts() {
    if (!this.inGame) this._startGame();
  }

  _startGame() {
    const seed = 777;
    this.map = this.buildMap(this.settings.mapId, seed);
    this.inGame = true;
    for (const r of this.roster) r.ready = false;
    this._initGame();
    this._emitRoster();
    this.emit('start', { mapId: this.settings.mapId, seed, settings: { ...this.settings } });
  }

  returnToLobby() {
    if (!this.isHost || !this.inGame) return false;
    this._backToLobby();
    return true;
  }

  _backToLobby() {
    this.inGame = false;
    this.g = null;
    this.events = [];
    this._emitRoster();
    this.emit('lobby');
  }

  sendChat(text) {
    const me = this.roster.find((r) => r.id === this.localId);
    microtask(() => this.emit('chat', { pid: this.localId, name: me.name, text: String(text).slice(0, 160), system: false }));
  }

  buy(item) {
    const g = this.g;
    if (!g) return;
    const p = g.me;
    const fail = (reason) => this.events.push({ type: 'buyfail', pid: p.id, item, reason });
    if (!isBuyable(item)) return fail('invalid');
    const near = Math.hypot(p.x - this.map.supply.x, p.y - this.map.supply.y) <= SUPPLY_RADIUS;
    if (p.state !== 'alive' || !(g.phase === 'prep' || g.phase === 'intermission' || (g.phase === 'wave' && near))) return fail('closed');
    let price;
    if (WEAPONS[item]) {
      const w = WEAPONS[item];
      const shopWave = g.phase === 'wave' ? Math.max(1, g.wave) : g.wave + 1;
      if (w.unlockWave > shopWave) return fail('invalid');
      const s = p.slots.indexOf(item);
      price = s >= 0 ? ammoPrice(item) : w.price;
      if (s >= 0 && p.ammo[s][0] >= w.mag && (w.reserve < 0 || p.ammo[s][1] >= w.reserve)) return fail('owned');
      if (p.cash < price) return fail('cash');
      p.cash -= price;
      if (s >= 0) {
        p.ammo[s] = [w.mag, w.reserve];
      } else {
        let slot = p.slots.indexOf(null);
        if (slot < 0) slot = p.slot;
        p.slots[slot] = item;
        p.ammo[slot] = [w.mag, w.reserve];
        p.slot = slot;
      }
    } else {
      price = item === 'turret' ? Math.round(ITEMS.turret.price * (1 - perksFor(this._cls()).turretDiscount)) : ITEMS[item].price;
      const maxed = {
        armor: p.armor >= ARMOR_MAX, medkit: p.hp >= p.maxHp, frag: p.frags >= FRAG_MAX + perksFor(this._cls()).extraFrags,
        molotov: p.molotovs >= MOLOTOV_MAX, turret: p.turrets >= TURRET.maxPerPlayer, barricade: p.barricades >= BARRICADE.maxPerPlayer,
        repair: g.objective.hp >= g.objective.maxHp,
      }[item];
      if (item === 'selfrevive' && p.selfRevive) return fail('owned');
      if (maxed) return fail('max');
      if (p.cash < price) return fail('cash');
      p.cash -= price;
      switch (item) {
        case 'ammo': p.ammo = p.ammo.map((a, i) => (p.slots[i] ? [a[0], WEAPONS[p.slots[i]].reserve] : a)); break;
        case 'armor': p.armor = Math.min(ARMOR_MAX, p.armor + 50); break;
        case 'medkit': p.hp = p.maxHp; break;
        case 'frag': p.frags++; break;
        case 'molotov': p.molotovs++; break;
        case 'turret': p.turrets++; break;
        case 'barricade': p.barricades++; break;
        case 'selfrevive': p.selfRevive = true; break;
        case 'repair': g.objective.hp = Math.min(g.objective.maxHp, g.objective.hp + g.objective.maxHp * 0.2); break;
        default:
      }
    }
    this.events.push({ type: 'buy', pid: p.id, item });
  }

  ready() {
    const g = this.g;
    if (!g || (g.phase !== 'prep' && g.phase !== 'intermission') || g.me.ready) return;
    g.me.ready = true;
    g.readyCount++;
  }

  getMap() {
    return this.map || null;
  }

  getPredictedLocal() {
    if (!this.g) return null;
    const p = this.g.me;
    return { x: p.x, y: p.y, angle: p.angle };
  }

  getView() {
    if (!this.inGame || !this.g) return null;
    return this._snapshot();
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  leave() {
    if (this.left) return;
    this.left = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  kick(pid) {
    const i = this.roster.findIndex((r) => r.id === pid && !r.host);
    if (i < 0) return false;
    const [r] = this.roster.splice(i, 1);
    this.emit('chat', { pid: 0, name: '', text: `${r.name} was removed from the room`, system: true });
    this._emitRoster();
    return true;
  }

  _cls() {
    const me = this.roster.find((r) => r.id === this.localId);
    return me ? me.cls : 'soldier';
  }

  // ---- fake match ------------------------------------------------------------------------------

  _initGame() {
    const map = this.map;
    const players = this.roster.map((r, i) => {
      const sp = map.playerSpawns[i % map.playerSpawns.length];
      const c = CLASSES[r.cls] || CLASSES.soldier;
      const perks = perksFor(r.cls);
      const cw = WEAPONS[c.startWeapon];
      return {
        id: r.id, x: sp.x, y: sp.y, angle: 0, state: 'alive', hp: perks.maxHp, maxHp: perks.maxHp,
        armor: perks.startArmor, stamina: STAMINA_MAX, sprinting: false, slot: 1,
        slots: ['pistol', c.startWeapon, null], ammo: [[12, -1], [cw.mag, cw.reserve], [0, 0]],
        reloading: 0, spin: 0, firing: false, meleeing: 0, cash: START_CASH, kills: 0, damage: 0, revives: 0, downs: 0, earned: 0,
        frags: perks.startFrags, molotovs: perks.startMolotovs, turrets: perks.startTurrets, barricades: 0, selfRevive: false,
        bleedout: 0, revive: 0, reviver: 0, respawn: false, ready: false, lastSeq: 0,
        // mock-only state
        home: { x: sp.x, y: sp.y }, phaseOff: i * 1.7, cooldown: 0, reloadT: 0, lastSlot: 0,
      };
    });
    this.g = {
      tick: 0, phase: 'prep', wave: 0, totalWaves: this.settings.waves, timer: PREP_TIME, remaining: 0, bossHp: -1,
      objective: this.settings.objective ? { hp: map.objective.hp, maxHp: map.objective.hp } : null,
      readyCount: 0, players, me: players.find((p) => p.id === this.localId),
      zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [],
      nextZ: 1, evT: 0, time: 0, spawnT: 0, gameoverReason: '',
    };
    this._spawnZombies(10);
  }

  _spawnZombies(n, types) {
    const g = this.g, map = this.map, rng = this.rng;
    for (let i = 0; i < n; i++) {
      const zs = map.zombieSpawns[rng.int(0, map.zombieSpawns.length - 1)];
      const type = types ? types[i % types.length] : rng.weighted(ZOMBIE_IDS.filter((t) => t !== 'boss').map((t) => ({ t, weight: t === 'walker' ? 60 : t === 'runner' ? 20 : 4 })), (e) => e.weight).t;
      g.zombies.push({
        id: g.nextZ++, type, x: zs.x + rng.range(-zs.w / 2, zs.w / 2), y: zs.y + rng.range(-zs.h / 2, zs.h / 2),
        angle: 0, hp: 1, flags: rng.chance(0.06) ? ZFLAG.BURNING : 0, speed: type === 'runner' ? 120 : type === 'boss' ? 40 : 55,
      });
    }
  }

  /** Place zombies in a ring around the objective (for stills). */
  _ringZombies(n, rMin, rMax, types) {
    const g = this.g, ob = this.map.objective, rng = this.rng;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(rMin, rMax);
      const type = types ? types[i % types.length] : rng.chance(0.75) ? 'walker' : rng.pick(['runner', 'crawler', 'bloater', 'spitter', 'screamer']);
      g.zombies.push({
        id: g.nextZ++, type, x: clamp(ob.x + Math.cos(a) * r, 40, this.map.width - 40), y: clamp(ob.y + Math.sin(a) * r, 40, this.map.height - 40),
        angle: a + Math.PI, hp: rng.range(0.3, 1), flags: rng.chance(0.08) ? ZFLAG.BURNING : rng.chance(0.03) ? ZFLAG.ELITE : 0,
        speed: type === 'runner' ? 120 : 55,
      });
    }
  }

  update(dt, input, aimAngle) {
    if (this.left || !this.inGame || !this.g) return;
    dt = Math.min(0.1, dt || 0);
    const g = this.g;
    g.time += dt;
    g.tick += Math.round(dt * 60);
    this._stepLocal(dt, input, aimAngle);
    this._stepBots(dt);
    this._stepZombies(dt);
    if (this.auto) this._stepPhase(dt);
    this._ambientEvents(dt);
    this.stats.fps = 60;
  }

  _stepLocal(dt, input, aimAngle) {
    const g = this.g, p = g.me, map = this.map;
    if (Number.isFinite(aimAngle)) p.angle = aimAngle;
    p.lastSeq++;
    if (!input) return;
    if (p.state === 'dead') return;
    const downed = p.state === 'downed';
    let speed = downed ? 45 : PLAYER_SPEED * perksFor(this._cls()).speedMult;
    const moving = Math.hypot(input.moveX, input.moveY) > 0.05;
    p.sprinting = !downed && input.sprint && moving && p.stamina > 5;
    if (p.sprinting) {
      speed *= SPRINT_MULT;
      p.stamina = Math.max(0, p.stamina - 32 * dt);
    } else {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + 22 * dt);
    }
    p.x = clamp(p.x + input.moveX * speed * dt, 20, map.width - 20);
    p.y = clamp(p.y + input.moveY * speed * dt, 20, map.height - 20);

    if (downed) {
      p.bleedout = Math.max(0, p.bleedout - dt);
      return;
    }
    // weapons
    if (input.slot >= 0 && p.slots[input.slot] && input.slot !== p.slot) this._switch(p, input.slot);
    if (input.cycle) {
      for (let k = 1; k < 3; k++) {
        const s = (p.slot + input.cycle * k + 6) % 3;
        if (p.slots[s]) {
          this._switch(p, s);
          break;
        }
      }
    }
    if (input.lastWeapon && p.slots[p.lastSlot]) this._switch(p, p.lastSlot);
    const wid = p.slots[p.slot];
    const w = WEAPONS[wid];
    const am = p.ammo[p.slot];
    p.cooldown -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      p.reloading = clamp(1 - p.reloadT / w.reload, 0.01, 1);
      if (p.reloadT <= 0) {
        const need = w.mag - am[0];
        const take = am[1] < 0 ? need : Math.min(need, am[1]);
        am[0] += take;
        if (am[1] >= 0) am[1] -= take;
        p.reloading = 0;
      }
    } else if (input.reload && am[0] < w.mag && am[1] !== 0) {
      this._startReload(p, w);
    }
    if (input.fire && p.reloadT <= 0 && p.cooldown <= 0) {
      if (am[0] > 0) {
        am[0]--;
        p.cooldown = 1 / w.rate;
        p.firing = true;
        const rays = [];
        const pellets = w.kind === 'hitscan' ? w.pellets : 0;
        for (let i = 0; i < pellets; i++) {
          const a = p.angle + (Math.random() - 0.5) * w.spread * 2;
          rays.push({ x: p.x + Math.cos(a) * w.range * 0.6, y: p.y + Math.sin(a) * w.range * 0.6, hit: 0 });
        }
        this.events.push({ type: 'shot', pid: p.id, turret: 0, weapon: wid, x: p.x, y: p.y, angle: p.angle, rays });
        this._maybeKillInCone(p, w);
      } else {
        this.events.push({ type: 'empty', pid: p.id });
        if (am[1] !== 0) this._startReload(p, w);
        p.cooldown = 0.3;
      }
    } else if (!input.fire) {
      p.firing = false;
    }
    if (input.melee && p.meleeing === 0) {
      p.meleeing = 0.01;
      this.events.push({ type: 'melee', pid: p.id, x: p.x, y: p.y, angle: p.angle, hits: 0 });
    }
    if (p.meleeing > 0) {
      p.meleeing += dt / 0.35;
      if (p.meleeing >= 1) p.meleeing = 0;
    }
    if (input.frag && p.frags > 0) {
      p.frags--;
      this.events.push({ type: 'throw', pid: p.id, kind: 'frag' });
      const ex = p.x + Math.cos(p.angle) * 260, ey = p.y + Math.sin(p.angle) * 260;
      this._t(() => this.events.push({ type: 'explosion', x: ex, y: ey, r: 150, kind: 'frag' }), 1200);
    }
    if (input.molotov && p.molotovs > 0) {
      p.molotovs--;
      this.events.push({ type: 'throw', pid: p.id, kind: 'molotov' });
      const ex = p.x + Math.cos(p.angle) * 240, ey = p.y + Math.sin(p.angle) * 240;
      this._t(() => {
        this.events.push({ type: 'ignite', x: ex, y: ey, r: 110 });
        this.g && this.g.hazards.push({ id: 100 + Math.floor(Math.random() * 900), kind: 'fire', x: ex, y: ey, r: 110, life: 1 });
      }, 700);
    }
    if (input.turret) {
      if (p.turrets > 0) {
        p.turrets--;
        const x = p.x + Math.cos(p.angle) * 55, y = p.y + Math.sin(p.angle) * 55;
        g.turrets.push({ id: g.turrets.length + 1, owner: p.id, x, y, angle: p.angle, hp: 1, ammo: 1, firing: false });
        this.events.push({ type: 'place', pid: p.id, kind: 'turret', x, y });
      }
    }
    if (input.barricade) {
      if (p.barricades > 0) {
        p.barricades--;
        const x = p.x + Math.cos(p.angle) * 55, y = p.y + Math.sin(p.angle) * 55;
        g.barricades.push({ id: g.barricades.length + 1, owner: p.id, x, y, angle: p.angle + Math.PI / 2, hp: 1 });
        this.events.push({ type: 'place', pid: p.id, kind: 'barricade', x, y });
      } else {
        this.events.push({ type: 'placefail', pid: p.id, kind: 'barricade' });
      }
    }
    // interact: revive or take crate
    if (input.interact) {
      const t = g.players.find((q) => q.state === 'downed' && q.id !== p.id && Math.hypot(q.x - p.x, q.y - p.y) < REVIVE_RADIUS);
      if (t) {
        t.reviver = p.id;
        t.revive = Math.min(1, t.revive + dt / REVIVE_TIME * perksFor(this._cls()).reviveSpeed);
        if (t.revive >= 1) this._revive(t, p.id);
      } else {
        const c = g.pickups.find((q) => q.kind === 'crate' && Math.hypot(q.x - p.x, q.y - p.y) < INTERACT_RADIUS);
        if (c) {
          g.pickups.splice(g.pickups.indexOf(c), 1);
          const slot = p.slots.indexOf(null) >= 0 ? p.slots.indexOf(null) : p.slot;
          p.slots[slot] = c.weapon;
          p.ammo[slot] = [WEAPONS[c.weapon].mag, WEAPONS[c.weapon].reserve];
          p.slot = slot;
          this.events.push({ type: 'pickup', pid: p.id, kind: 'crate', x: c.x, y: c.y, weapon: c.weapon });
        }
      }
    } else {
      for (const q of g.players) if (q.reviver === p.id) {
        q.reviver = 0;
        q.revive = 0;
      }
    }
  }

  _switch(p, s) {
    p.lastSlot = p.slot;
    p.slot = s;
    p.reloadT = 0;
    p.reloading = 0;
    this.events.push({ type: 'switch', pid: p.id, weapon: p.slots[s] });
  }

  _startReload(p, w) {
    p.reloadT = w.reload * perksFor(this._cls()).reloadMult;
    p.reloading = 0.01;
    this.events.push({ type: 'reload', pid: p.id, weapon: p.slots[p.slot] });
  }

  _revive(t, by) {
    t.state = 'alive';
    t.hp = 40;
    t.revive = 0;
    t.reviver = 0;
    t.bleedout = 0;
    this.events.push({ type: 'revived', pid: t.id, by });
    const r = this.g.players.find((q) => q.id === by);
    if (r) {
      r.revives++;
      r.cash += 100;
      r.earned += 100;
    }
  }

  _maybeKillInCone(p, w) {
    const g = this.g;
    let best = null, bd = w.range;
    for (const z of g.zombies) {
      const dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d > bd) continue;
      const da = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - p.angle), Math.cos(Math.atan2(dy, dx) - p.angle)));
      if (da < 0.12 + 20 / Math.max(20, d)) {
        best = z;
        bd = d;
      }
    }
    if (!best) return;
    const dmg = w.damage * (w.pellets || 1);
    best.hp -= dmg / 200;
    p.damage += dmg;
    if (best.hp <= 0) this._killZombie(best, p.id, w.kind === 'rail');
  }

  _killZombie(z, by, gib) {
    const g = this.g;
    const i = g.zombies.indexOf(z);
    if (i >= 0) g.zombies.splice(i, 1);
    this.events.push({ type: 'zdie', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle, by, gib: !!gib });
    if (z.type === 'bloater') this.events.push({ type: 'explosion', x: z.x, y: z.y, r: 115, kind: 'bloater' });
    const killer = g.players.find((q) => q.id === by);
    if (killer) {
      killer.kills++;
      const cash = z.type === 'boss' ? 1000 : z.type === 'brute' ? 120 : 10;
      killer.cash += cash;
      killer.earned += cash;
    }
    if (g.phase === 'wave') g.remaining = Math.max(0, g.remaining - 1);
    if (z.type === 'boss') g.bossHp = -1;
    if (this.rng.chance(0.08)) g.pickups.push({ id: 500 + g.tick % 400, kind: this.rng.pick(['ammo', 'health', 'cash']), x: z.x, y: z.y, weapon: null });
  }

  _stepBots(dt) {
    const g = this.g;
    for (const p of g.players) {
      if (p === g.me) continue;
      p.firing = false;
      if (p.state === 'downed') {
        p.bleedout = Math.max(0, p.bleedout - dt * 0.2);
        continue;
      }
      if (p.state === 'dead') continue;
      const t = g.time * 0.5 + p.phaseOff;
      p.x = p.home.x + Math.cos(t) * 60;
      p.y = p.home.y + Math.sin(t * 1.3) * 40;
      let target = null, bd = 600;
      for (const z of g.zombies) {
        const d = Math.hypot(z.x - p.x, z.y - p.y);
        if (d < bd) {
          bd = d;
          target = z;
        }
      }
      if (target) p.angle = Math.atan2(target.y - p.y, target.x - p.x);
    }
  }

  _stepZombies(dt) {
    const g = this.g, ob = this.map.objective;
    for (const z of g.zombies) {
      let tx = ob.x, ty = ob.y, bd = Math.hypot(ob.x - z.x, ob.y - z.y);
      for (const p of g.players) {
        if (p.state === 'dead') continue;
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < bd) {
          bd = d;
          tx = p.x;
          ty = p.y;
        }
      }
      z.angle = Math.atan2(ty - z.y, tx - z.x);
      const stop = z.type === 'boss' ? 110 : 70;
      if (bd > stop && g.phase !== 'gameover' && g.phase !== 'victory') {
        z.x += Math.cos(z.angle) * z.speed * dt * 0.6;
        z.y += Math.sin(z.angle) * z.speed * dt * 0.6;
        z.flags &= ~ZFLAG.ATTACKING;
      } else {
        z.flags |= ZFLAG.ATTACKING;
      }
    }
  }

  _stepPhase(dt) {
    const g = this.g;
    if (g.phase === 'prep' || g.phase === 'intermission') {
      g.timer -= dt;
      const allReady = g.readyCount >= g.players.length;
      if (g.timer <= 0 || allReady) this._startWave(g.wave + 1);
    } else if (g.phase === 'wave') {
      g.spawnT -= dt;
      if (g.spawnT <= 0 && g.zombies.length < 90) {
        g.spawnT = 0.4;
        this._spawnZombies(3);
      }
      // bots thin the horde so waves end on their own
      g.evT += dt;
      if (g.zombies.length && this.rng.chance(dt * 6)) {
        const shooter = this.rng.pick(g.players.filter((p) => p !== g.me && p.state === 'alive'));
        if (shooter) this._killZombie(this.rng.pick(g.zombies), shooter.id, false);
      }
      g.remaining = Math.max(0, g.remaining - dt * 1.2);
      g.remaining = Math.round(g.remaining);
      if (g.remaining <= 0) this._clearWave();
    }
  }

  _startWave(n) {
    const g = this.g;
    g.phase = 'wave';
    g.wave = n;
    g.timer = 0;
    g.remaining = Math.round((12 + 6 * n) * (1 + 0.6 * (g.players.length - 1)));
    g.readyCount = 0;
    for (const p of g.players) p.ready = false;
    const boss = n % 5 === 0;
    this.events.push({ type: 'wave', wave: n, boss });
    if (boss) {
      this._t(() => {
        if (!this.g || this.g.phase !== 'wave') return;
        this._spawnZombies(1, ['boss']);
        const b = this.g.zombies[this.g.zombies.length - 1];
        this.g.bossHp = 1;
        this.events.push({ type: 'bossspawn', id: b.id, x: b.x, y: b.y });
      }, 2500);
    }
  }

  _clearWave() {
    const g = this.g;
    this.events.push({ type: 'waveclear', wave: g.wave, bonus: WAVE_CLEAR_BONUS });
    for (const p of g.players) {
      p.cash += WAVE_CLEAR_BONUS;
      p.earned += WAVE_CLEAR_BONUS;
      if (p.state === 'dead') {
        p.state = 'alive';
        p.hp = p.maxHp;
        p.respawn = false;
        this.events.push({ type: 'respawn', pid: p.id });
      }
      if (p.state === 'downed') this._revive(p, 0);
    }
    g.bossHp = -1;
    if (g.totalWaves && g.wave >= g.totalWaves) {
      g.phase = 'victory';
      this.events.push({ type: 'victory' });
      return;
    }
    g.phase = 'intermission';
    g.timer = INTERMISSION_TIME;
    const s = this.map.supply;
    g.pickups.push({ id: 900, kind: 'crate', x: s.x + 40, y: s.y + 30, weapon: 'dmr' });
    this.events.push({ type: 'drop', x: s.x + 40, y: s.y + 30 });
  }

  /** Background noise so the renderer/audio/HUD get a steady trickle of events. */
  _ambientEvents(dt) {
    const g = this.g;
    if (g.phase !== 'wave') return;
    g.evT += dt;
    if (g.evT < 0.12) return;
    g.evT = 0;
    const rng = this.rng;
    const bots = g.players.filter((p) => p !== g.me && p.state === 'alive');
    const shooter = bots.length ? rng.pick(bots) : null;
    if (shooter && g.zombies.length) {
      const z = rng.pick(g.zombies);
      const wid = shooter.slots[shooter.slot];
      shooter.firing = true;
      shooter.cooldown = 0;
      this.events.push({ type: 'shot', pid: shooter.id, turret: 0, weapon: wid, x: shooter.x, y: shooter.y, angle: Math.atan2(z.y - shooter.y, z.x - shooter.x), rays: [{ x: z.x, y: z.y, hit: 1 }] });
    }
    if (g.zombies.length && rng.chance(0.3)) {
      const z = rng.pick(g.zombies);
      if (z.flags & ZFLAG.ATTACKING) this.events.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle });
    }
    if (g.objective && rng.chance(0.08)) {
      g.objective.hp = Math.max(g.objective.maxHp * 0.12, g.objective.hp - g.objective.maxHp * 0.004);
      this.events.push({ type: 'objhit', x: this.map.objective.x, y: this.map.objective.y });
    }
  }

  _snapshot() {
    const g = this.g;
    const players = g.players.map((p) => ({
      id: p.id, x: p.x, y: p.y, angle: p.angle, state: p.state, hp: p.hp, maxHp: p.maxHp, armor: p.armor,
      stamina: p.stamina, sprinting: p.sprinting, slot: p.slot, slots: p.slots.slice(), ammo: p.ammo.map((a) => a.slice()),
      reloading: p.reloading, spin: 0, firing: p.firing, meleeing: p.meleeing, cash: Math.floor(p.cash), kills: p.kills,
      damage: Math.round(p.damage), revives: p.revives, downs: p.downs, earned: p.earned, frags: p.frags, molotovs: p.molotovs,
      turrets: p.turrets, barricades: p.barricades, selfRevive: p.selfRevive, bleedout: p.bleedout, revive: p.revive,
      reviver: p.reviver, respawn: p.respawn, ready: p.ready, lastSeq: p.lastSeq,
    }));
    return {
      tick: g.tick, phase: g.phase, wave: g.wave, totalWaves: g.totalWaves, timer: Math.max(0, g.timer),
      remaining: g.remaining, bossHp: g.bossHp, objective: g.objective ? { ...g.objective } : null, readyCount: g.readyCount,
      players,
      zombies: g.zombies.map((z) => ({ id: z.id, type: z.type, x: z.x, y: z.y, angle: z.angle, hp: z.hp, flags: z.flags })),
      projectiles: g.projectiles.slice(), pickups: g.pickups.slice(), turrets: g.turrets.slice(), barricades: g.barricades.slice(),
      hazards: g.hazards.slice(), events: [],
    };
  }

  // ---- scene control (sandbox / tests) --------------------------------------------------------

  /**
   * Freeze the match in a named state for screenshots:
   * 'prep' | 'wave' | 'boss' | 'intermission' | 'downed' | 'dead' | 'victory' | 'gameover' | 'auto'
   */
  setScene(name) {
    if (!this.g) return;
    const g = this.g, map = this.map, ob = map.objective;
    this.auto = name === 'auto';
    if (this.auto) return;
    const me = g.me;
    g.zombies = [];
    g.pickups = [];
    g.hazards = [];
    g.turrets = [];
    g.barricades = [];
    g.projectiles = [];
    g.bossHp = -1;
    g.readyCount = 0;
    for (const [i, p] of g.players.entries()) {
      p.state = 'alive';
      p.hp = p.maxHp;
      p.bleedout = 0;
      p.revive = 0;
      p.reviver = 0;
      p.respawn = false;
      p.ready = false;
      p.kills = 40 + i * 13;
      p.damage = 5200 + i * 1700;
      p.revives = i % 3;
      p.downs = (i + 1) % 2;
      p.earned = 3200 + i * 450;
    }
    me.x = ob.x + ob.w * 0.5 + 90;
    me.y = ob.y + 60;
    me.cash = 2350;
    me.armor = 30;
    me.frags = 2;
    me.molotovs = 1;
    me.turrets = 1;
    me.barricades = 2;
    me.slots = ['pistol', 'rifle', 'shotgun'];
    me.ammo = [[9, -1], [21, 180], [4, 30]];
    me.slot = 1;
    const others = g.players.filter((p) => p !== me);
    switch (name) {
      case 'prep':
        g.phase = 'prep';
        g.wave = 0;
        g.timer = 17.4;
        g.remaining = 0;
        g.readyCount = Math.min(1, others.length);
        if (others[0]) others[0].ready = true;
        me.cash = START_CASH;
        this._spawnZombies(8);
        break;
      case 'intermission':
        g.phase = 'intermission';
        g.wave = 4;
        g.timer = 18.3;
        g.remaining = 0;
        g.readyCount = Math.min(2, others.length);
        if (others[0]) others[0].ready = true;
        if (others[1]) others[1].ready = true;
        g.pickups.push({ id: 900, kind: 'crate', x: map.supply.x + 40, y: map.supply.y + 30, weapon: 'dmr' });
        break;
      case 'wave':
      case 'boss':
      case 'downed':
      case 'dead': {
        g.phase = 'wave';
        g.wave = name === 'boss' ? 5 : 4;
        g.remaining = 57;
        this._ringZombies(70, 260, 900);
        me.hp = Math.round(me.maxHp * 0.64);
        me.stamina = 55;
        me.reloading = 0;
        g.pickups.push({ id: 1, kind: 'crate', x: me.x + 30, y: me.y + 10, weapon: 'lmg' });
        g.pickups.push({ id: 2, kind: 'ammo', x: me.x - 120, y: me.y + 60, weapon: null });
        g.pickups.push({ id: 3, kind: 'health', x: me.x - 60, y: me.y - 110, weapon: null });
        g.turrets.push({ id: 1, owner: others[1] ? others[1].id : me.id, x: ob.x - ob.w * 0.5 - 60, y: ob.y, angle: Math.PI, hp: 0.8, ammo: 0.6, firing: true });
        g.barricades.push({ id: 1, owner: me.id, x: me.x + 150, y: me.y - 40, angle: Math.PI / 2, hp: 0.7 });
        g.hazards.push({ id: 1, kind: 'fire', x: me.x + 260, y: me.y + 120, r: 110, life: 0.8 });
        g.hazards.push({ id: 2, kind: 'acid', x: me.x - 240, y: me.y - 140, r: 60, life: 0.6 });
        g.projectiles.push({ id: 1, kind: 'grenade', x: me.x + 200, y: me.y - 60, angle: -0.4 });
        if (g.objective) g.objective.hp = g.objective.maxHp * 0.58;
        if (others[0]) {
          others[0].state = 'downed';
          others[0].hp = 0;
          others[0].bleedout = 18.2;
          others[0].x = me.x - 40;
          others[0].y = me.y + 20;
          others[0].home = { x: others[0].x, y: others[0].y };
        }
        if (others[1]) others[1].hp = Math.round(others[1].maxHp * 0.22);
        if (name === 'boss') {
          this._ringZombies(1, 330, 360, ['boss']);
          this._ringZombies(2, 380, 460, ['brute']);
          g.bossHp = 0.63;
        }
        if (name === 'downed') {
          me.state = 'downed';
          me.hp = 0;
          me.bleedout = 21.4;
          if (others[2]) {
            others[2].x = me.x + 36;
            others[2].y = me.y - 20;
            others[2].home = { x: others[2].x, y: others[2].y };
          }
        }
        if (name === 'dead') {
          me.state = 'dead';
          me.hp = 0;
          me.respawn = true;
        }
        break;
      }
      case 'victory':
        g.phase = 'victory';
        g.wave = g.totalWaves || 15;
        g.remaining = 0;
        this.events.push({ type: 'victory' });
        break;
      case 'gameover':
        g.phase = 'gameover';
        g.wave = 7;
        g.remaining = 31;
        this._ringZombies(60, 60, 500);
        if (g.objective) g.objective.hp = 0;
        for (const p of g.players) {
          p.state = 'downed';
          p.bleedout = 12;
        }
        this.events.push({ type: 'gameover', reason: g.objective ? 'objective' : 'wiped' });
        break;
      default:
    }
  }

  /** Emit one event of every SPEC §4.1 type around the local player (robustness check). */
  fireAllEvents() {
    const g = this.g;
    if (!g) return;
    const me = g.me, x = me.x + 120, y = me.y;
    const bot = g.players.find((p) => p !== me) || me;
    const zid = g.zombies[0] ? g.zombies[0].id : 1;
    this.events.push(
      { type: 'shot', pid: bot.id, turret: 0, weapon: 'shotgun', x: bot.x, y: bot.y, angle: 0, rays: [{ x: bot.x + 200, y: bot.y, hit: 1 }, { x: bot.x + 190, y: bot.y + 30, hit: 2 }] },
      { type: 'shot', pid: 0, turret: 1, weapon: 'rifle', x, y, angle: 1, rays: [{ x: x + 100, y: y + 150, hit: 0 }] },
      { type: 'chain', pid: bot.id, points: [{ x: bot.x, y: bot.y }, { x: x, y: y }, { x: x + 80, y: y + 60 }] },
      { type: 'melee', pid: bot.id, x: bot.x, y: bot.y, angle: 0.5, hits: 2 },
      { type: 'zdie', id: zid, ztype: 'brute', x, y, angle: 0, by: bot.id, gib: true },
      { type: 'zdie', id: zid + 1, ztype: 'walker', x: x + 20, y, angle: 0, by: me.id, gib: false },
      { type: 'zdie', id: zid + 2, ztype: 'walker', x: x + 40, y, angle: 0, by: me.id, gib: false },
      { type: 'zattack', id: zid, ztype: 'walker', x, y, angle: 2 },
      { type: 'spit', id: zid, x, y, angle: 3 },
      { type: 'scream', id: zid, x, y },
      { type: 'charge', id: zid, x, y, angle: 1 },
      { type: 'slam', id: zid, x, y, r: 190 },
      { type: 'explosion', x, y: y + 80, r: 150, kind: 'frag' },
      { type: 'explosion', x: x - 80, y: y - 80, r: 180, kind: 'rocket' },
      { type: 'ignite', x: x + 60, y: y - 90, r: 110 },
      { type: 'pdamage', pid: me.id, amount: 12, x: x + 20, y },
      { type: 'down', pid: bot.id },
      { type: 'revived', pid: bot.id, by: me.id },
      { type: 'died', pid: bot.id },
      { type: 'respawn', pid: bot.id },
      { type: 'pickup', pid: me.id, kind: 'ammo', x: me.x, y: me.y, weapon: null },
      { type: 'pickup', pid: me.id, kind: 'crate', x: me.x, y: me.y, weapon: 'lmg' },
      { type: 'buy', pid: me.id, item: 'frag' },
      { type: 'buyfail', pid: me.id, item: 'railgun', reason: 'cash' },
      { type: 'buyfail', pid: me.id, item: 'armor', reason: 'closed' },
      { type: 'reload', pid: bot.id, weapon: 'rifle' },
      { type: 'switch', pid: bot.id, weapon: 'pistol' },
      { type: 'empty', pid: bot.id },
      { type: 'throw', pid: bot.id, kind: 'frag' },
      { type: 'place', pid: bot.id, kind: 'turret', x: bot.x + 50, y: bot.y },
      { type: 'placefail', pid: me.id, kind: 'turret' },
      { type: 'destroyed', kind: 'barricade', id: 9, x: x - 50, y: y + 40 },
      { type: 'objhit', x: this.map.objective.x, y: this.map.objective.y },
      { type: 'wave', wave: 5, boss: true },
      { type: 'bossspawn', id: 99, x: x + 300, y },
      { type: 'waveclear', wave: 5, bonus: 250 },
      { type: 'drop', x: this.map.supply.x, y: this.map.supply.y },
      { type: 'someFutureEvent', foo: 1 },
    );
  }

  /** Mock only: simulate losing the host. */
  _disconnect(reason = 'Host left the game') {
    this.leave();
    this.inGame = false;
    this.emit('disconnected', { reason });
  }
}

// ---- stub fallbacks (only used when the real modules can't be imported) ----------------------

/** Minimal renderer with the SPEC §7.1 surface. */
export function createStubRenderer(canvas, { map }) {
  const g = canvas.getContext('2d', { alpha: false });
  let W = 1, H = 1, dpr = 1, cam = { x: map.width / 2, y: map.height / 2 };
  const scale = 0.6;
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  resize();
  const toScreen = (x, y) => ({ x: (x - cam.x) * scale + W / 2, y: (y - cam.y) * scale + H / 2 });
  return {
    render(view, opts = {}) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = map.ground || '#222';
      g.fillRect(0, 0, W, H);
      const me = view && view.players.find((p) => p.id === opts.localId);
      if (me) cam = { x: me.x, y: me.y };
      g.save();
      g.translate(W / 2, H / 2);
      g.scale(scale, scale);
      g.translate(-cam.x, -cam.y);
      for (const o of map.obstacles) {
        g.save();
        g.translate(o.x, o.y);
        g.rotate(o.a || 0);
        g.fillStyle = o.color || '#555';
        g.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
        g.restore();
      }
      if (view) {
        for (const z of view.zombies) {
          g.fillStyle = '#6a8a50';
          g.beginPath();
          g.arc(z.x, z.y, 14, 0, Math.PI * 2);
          g.fill();
        }
        for (const p of view.players) {
          const r = (opts.roster || []).find((q) => q.id === p.id);
          g.fillStyle = PLAYER_COLORS[r ? r.color : 0];
          g.beginPath();
          g.arc(p.x, p.y, 16, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      if (opts.cursor) {
        g.strokeStyle = '#fff';
        g.strokeRect(opts.cursor.x - 6, opts.cursor.y - 6, 12, 12);
      }
    },
    addEvents() {},
    screenToWorld(sx, sy) {
      return { x: (sx - W / 2) / scale + cam.x, y: (sy - H / 2) / scale + cam.y };
    },
    worldToScreen(x, y) {
      return toScreen(x, y);
    },
    resize,
    setQuality() {},
    destroy() {},
  };
}

export function stubMapPreview(canvas, map) {
  const g = canvas.getContext('2d');
  g.fillStyle = map.ground || '#222';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const s = Math.min(canvas.width / map.width, canvas.height / map.height);
  g.fillStyle = '#666';
  for (const o of map.obstacles) g.fillRect(o.x * s - (o.w * s) / 2, o.y * s - (o.h * s) / 2, o.w * s, o.h * s);
}

export function stubPortrait(canvas, cls, color) {
  const g = canvas.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = PLAYER_COLORS[color | 0] || '#fff';
  g.beginPath();
  g.arc(canvas.width / 2, canvas.height / 2, canvas.width * 0.35, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.font = `bold ${Math.round(canvas.width * 0.3)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((CLASSES[cls] || CLASSES.soldier).name[0], canvas.width / 2, canvas.height / 2);
}

export function createStubAudio() {
  const noop = () => {};
  return { unlock: () => Promise.resolve(false), addEvents: noop, update: noop, ui: noop, setVolume: noop, setMuted: noop };
}

