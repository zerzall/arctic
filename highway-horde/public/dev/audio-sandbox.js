// Audio sandbox: plays every sound, drives the loops with a fake snapshot, runs a
// "minigun into the horde" stress test and a random battle, and measures output levels
// by rendering the same scenarios through an OfflineAudioContext.
//
// window.__audioLab is the hook the Playwright check uses.

import { createAudio } from '../js/audio/audio.js';
import { WEAPONS, WEAPON_IDS } from '../js/shared/weapons.js';
import { ZOMBIE_IDS } from '../js/shared/zombies.js';
import { createRng } from '../js/shared/rng.js';
import { clamp } from '../js/shared/math.js';

const LOCAL = 1;
const UI_NAMES = ['click', 'hover', 'buy', 'deny', 'chat', 'join', 'leave', 'wave', 'waveclear', 'gameover', 'victory', 'countdown', 'ready'];
const $ = (id) => document.getElementById(id);

// ---- fake world ------------------------------------------------------------------------

function makePlayer(id, x, y, extra = {}) {
  return {
    id, x, y, angle: 0, state: 'alive', hp: 100, maxHp: 100, armor: 0, stamina: 100, sprinting: false,
    slot: 0, slots: ['pistol', null, null], ammo: [[12, -1], [0, 0], [0, 0]], reloading: 0, spin: 0,
    firing: false, meleeing: 0, cash: 500, kills: 0, damage: 0, revives: 0, downs: 0, frags: 0, molotovs: 0,
    turrets: 0, barricades: 0, selfRevive: false, bleedout: 0, revive: 0, reviver: 0, respawn: false,
    ready: false, lastSeq: 0, ...extra,
  };
}

function createWorld(seed = 7) {
  return {
    rng: createRng(seed),
    t: 0,
    tick: 0,
    phase: 'wave',
    wave: 4,
    emitter: { x: 500, y: -200 },
    me: makePlayer(LOCAL, 0, 0),
    mates: [],
    zombies: [],
    nextZid: 1,
    hordeTarget: 0,
    toggles: {},
    acc: {},
    mode: null,          // 'stress' | 'battle' | null
    modeUntil: 0,
    flashes: [],
  };
}

function every(w, key, rate, dt) {
  const a = (w.acc[key] || 0) + rate * dt;
  const n = Math.floor(a);
  w.acc[key] = a - n;
  return n;
}

function pickType(rng, wave) {
  const pool = ['walker', 'walker', 'walker', 'walker', 'runner', 'runner', 'crawler', 'bloater', 'spitter', 'screamer'];
  if (wave > 4 && rng.chance(0.05)) return 'brute';
  return rng.pick(pool);
}

function spawnZombie(w, rMin = 150, rMax = 1000) {
  const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(rMin, rMax);
  w.zombies.push({ id: w.nextZid++ & 0xffff, type: pickType(w.rng, w.wave), x: Math.cos(a) * r, y: Math.sin(a) * r, angle: a + Math.PI, hp: 1, flags: 0 });
}

function nearestZombie(w, x, y, maxD = 1000) {
  let best = null, bd = maxD * maxD;
  for (const z of w.zombies) {
    const d = (z.x - x) ** 2 + (z.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = z;
    }
  }
  return best;
}

function shotEvent(w, pid, weapon, x, y) {
  const wd = WEAPONS[weapon];
  const rays = [];
  if (wd.kind === 'hitscan') {
    const z = nearestZombie(w, x, y, wd.range);
    for (let i = 0; i < wd.pellets; i++) {
      if (z && w.rng.chance(0.75)) rays.push({ x: z.x + w.rng.range(-10, 10), y: z.y + w.rng.range(-10, 10), hit: 1 });
      else rays.push({ x: x + w.rng.range(-600, 600), y: y + w.rng.range(-600, 600), hit: w.rng.chance(0.5) ? 2 : 0 });
    }
  }
  return { type: 'shot', pid, turret: 0, weapon, x, y, angle: 0, rays };
}

function killRandom(w, out, gib = false) {
  if (!w.zombies.length) return;
  const i = w.rng.int(0, w.zombies.length - 1);
  const z = w.zombies[i];
  w.zombies.splice(i, 1);
  out.push({ type: 'zdie', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: 0, by: LOCAL, gib });
  if (z.type === 'bloater') out.push({ type: 'explosion', x: z.x, y: z.y, r: 115, kind: 'bloater' });
}

/** One fixed step of the fake game: toggles, horde, scenario event generators. */
function stepWorld(w, dt, out) {
  w.t += dt;
  w.tick++;
  const T = w.toggles, me = w.me, rng = w.rng;
  if (w.mode && w.t > w.modeUntil) stopMode(w);

  // Horde: keep the target count, shuffle everyone slowly toward the listener.
  while (w.zombies.length < w.hordeTarget) spawnZombie(w);
  while (w.zombies.length > w.hordeTarget) w.zombies.pop();
  for (const z of w.zombies) {
    const d = Math.hypot(z.x, z.y) || 1;
    const sp = z.type === 'runner' ? 150 : 50;
    if (d > 60) {
      z.x -= (z.x / d) * sp * dt;
      z.y -= (z.y / d) * sp * dt;
    }
    z.flags = T.fire && Math.hypot(z.x - w.emitter.x, z.y - w.emitter.y) < 150 ? 1 : 0;
  }
  if (T.boss && !w.zombies.some((z) => z.type === 'boss')) {
    w.zombies.push({ id: 60000, type: 'boss', x: w.emitter.x, y: w.emitter.y + 80, angle: 0, hp: 0.7, flags: 0 });
  } else if (!T.boss) {
    w.zombies = w.zombies.filter((z) => z.type !== 'boss');
  }

  // Local player.
  me.state = T.downed ? 'downed' : 'alive';
  me.hp = T.downed ? 0 : T.lowhp ? 18 : 100;
  me.bleedout = T.downed ? Math.max(1, 30 - (w.t % 29)) : 0;
  if (T.minigun) {
    me.slots = ['pistol', null, 'minigun'];
    me.slot = 2;
    me.spin = Math.min(1, me.spin + dt / WEAPONS.minigun.spinup);
    me.firing = me.spin >= 1;
    if (me.firing) for (let n = every(w, 'mini', 30, dt); n > 0; n--) out.push(shotEvent(w, LOCAL, 'minigun', me.x, me.y));
  } else if (T.flame) {
    me.slots = ['pistol', 'flamethrower', null];
    me.slot = 1;
    me.spin = 0;
    me.firing = true;
    for (let n = every(w, 'flame', 30, dt); n > 0; n--) out.push(shotEvent(w, LOCAL, 'flamethrower', me.x, me.y));
  } else {
    me.slots = ['pistol', null, null];
    me.slot = 0;
    me.spin = Math.max(0, me.spin - dt / 1.2);
    me.firing = false;
  }

  // Teammates.
  const mates = [];
  if (T.flameRemote) mates.push(makePlayer(2, w.emitter.x, w.emitter.y, { slots: ['flamethrower', null, null], firing: true }));
  for (const m of w.mates) mates.push(m);
  w.players = [me, ...mates];
  for (const m of w.mates) {
    m.burstLeft -= dt;
    if (m.burstLeft <= 0) {
      m.firing = !m.firing;
      m.burstLeft = m.firing ? rng.range(0.4, 2.2) : rng.range(0.3, 1.6);
      if (!m.firing && rng.chance(0.25)) out.push({ type: 'reload', pid: m.id, weapon: m.slots[0] });
    }
    if (m.firing) for (let n = every(w, 'm' + m.id, WEAPONS[m.slots[0]].rate, dt); n > 0; n--) out.push(shotEvent(w, m.id, m.slots[0], m.x, m.y));
  }

  const hazards = [];
  if (T.fire) hazards.push({ id: 1, kind: 'fire', x: w.emitter.x, y: w.emitter.y, r: 110, life: 0.8 });
  if (T.acid) hazards.push({ id: 2, kind: 'acid', x: w.emitter.x, y: w.emitter.y, r: 60, life: 0.8 });
  w.hazards = hazards;

  if (w.mode === 'stress') stressEvents(w, dt, out);
  else if (w.mode === 'battle') battleEvents(w, dt, out);
}

function stressEvents(w, dt, out) {
  const rng = w.rng;
  for (let n = every(w, 'kill', 14, dt); n > 0; n--) killRandom(w, out, rng.chance(0.2));
  for (let n = every(w, 'swipe', 8, dt); n > 0; n--) {
    const z = nearestZombie(w, 0, 0, 300);
    if (z) out.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: 0 });
  }
  for (let n = every(w, 'boom', 1.4, dt); n > 0; n--) {
    out.push({ type: 'explosion', x: rng.range(-500, 500), y: rng.range(-400, 400), r: rng.pick([130, 150, 180]), kind: rng.pick(['frag', 'grenade', 'rocket']) });
  }
  for (let n = every(w, 'hurt', 2, dt); n > 0; n--) out.push({ type: 'pdamage', pid: LOCAL, amount: 8, x: 20, y: 0 });
  for (let n = every(w, 'pick', 1, dt); n > 0; n--) out.push({ type: 'pickup', pid: LOCAL, kind: rng.pick(['ammo', 'cash', 'health']), x: 0, y: 0, weapon: null });
  if (every(w, 'scr', 0.3, dt)) out.push({ type: 'scream', id: 9, x: 300, y: -200 });
}

function battleEvents(w, dt, out) {
  const rng = w.rng;
  const phaseLen = 22;
  const cyc = w.t % phaseLen;
  const prevPhase = w.phase;
  w.phase = cyc < 17 ? 'wave' : 'intermission';
  if (w.phase !== prevPhase) {
    if (w.phase === 'wave') {
      w.wave++;
      out.push({ type: 'wave', wave: w.wave, boss: w.wave % 5 === 0 });
      if (w.wave % 5 === 0) out.push({ type: 'bossspawn', id: 60000, x: 700, y: 300 });
    } else {
      out.push({ type: 'waveclear', wave: w.wave, bonus: 250 });
      out.push({ type: 'drop', x: 300, y: 200 });
    }
  }
  w.hordeTarget = w.phase === 'wave' ? 70 : 0;
  if (w.phase !== 'wave') return;
  for (let n = every(w, 'kill', 5, dt); n > 0; n--) killRandom(w, out, rng.chance(0.1));
  for (let n = every(w, 'pshot', 3, dt); n > 0; n--) {
    const wid = rng.pick(['pistol', 'magnum', 'rifle', 'shotgun', 'dmr', 'sniper', 'crossbow', 'grenade_launcher', 'tesla', 'rocket', 'railgun', 'lmg', 'uzi']);
    out.push(shotEvent(w, LOCAL, wid, 0, 0));
    if (wid === 'tesla') out.push({ type: 'chain', pid: LOCAL, points: [{ x: 0, y: 0 }, { x: 120, y: 30 }, { x: 200, y: 90 }, { x: 260, y: 40 }] });
  }
  for (let n = every(w, 'swipe', 2, dt); n > 0; n--) {
    const z = nearestZombie(w, 0, 0, 400);
    if (z) out.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: 0 });
  }
  const r = rng.next();
  if (r < 0.25 * dt) out.push({ type: 'explosion', x: rng.range(-600, 600), y: rng.range(-500, 500), r: 150, kind: rng.pick(['frag', 'grenade', 'rocket', 'bloater']) });
  else if (r < 0.4 * dt) out.push({ type: 'spit', id: 3, x: rng.range(-400, 400), y: -300, angle: 0 });
  else if (r < 0.5 * dt) out.push({ type: 'charge', id: 4, x: 400, y: 100, angle: 0 });
  else if (r < 0.6 * dt) out.push({ type: 'ignite', x: rng.range(-300, 300), y: 150, r: 110 });
  else if (r < 0.75 * dt) out.push({ type: 'pickup', pid: LOCAL, kind: rng.pick(['ammo', 'health', 'cash', 'armor', 'frag']), x: 0, y: 0, weapon: null });
  else if (r < 0.9 * dt) out.push({ type: 'pdamage', pid: LOCAL, amount: 10, x: 20, y: 0 });
  else if (r < 1.0 * dt) out.push({ type: 'objhit', x: -200, y: 300 });
  else if (r < 1.1 * dt) out.push({ type: 'melee', pid: LOCAL, x: 0, y: 0, angle: 0, hits: 2 });
  else if (r < 1.2 * dt) out.push({ type: 'reload', pid: LOCAL, weapon: rng.pick(WEAPON_IDS) });
  else if (r < 1.25 * dt) out.push({ type: 'down', pid: 3 }, { type: 'revived', pid: 3, by: 2 });
  else if (r < 1.3 * dt) out.push({ type: 'place', pid: LOCAL, kind: rng.pick(['turret', 'barricade']), x: 50, y: 0 });
  else if (r < 1.35 * dt) out.push({ type: 'destroyed', kind: rng.pick(['turret', 'barricade']), id: 1, x: -150, y: 100 });
  else if (r < 1.5 * dt) out.push({ type: 'shot', pid: 0, turret: 1, weapon: 'rifle', x: -150, y: 100, angle: 0, rays: [] });
}

function addMates(w) {
  const setups = [[2, 'rifle', -260, 120], [3, 'shotgun', 240, 160], [4, 'uzi', 60, -300], [5, 'lmg', -380, -200], [6, 'dual_smg', 420, -60]];
  w.mates = setups.map(([id, weapon, x, y]) => makePlayer(id, x, y, { slots: [weapon, null, null], burstLeft: 0.1 * id, firing: false }));
}

function startMode(w, mode, secs) {
  w.mode = mode;
  w.modeUntil = w.t + secs;
  if (mode === 'stress') {
    w.saved = { ...w.toggles, horde: w.hordeTarget };
    w.toggles.minigun = true;
    w.hordeTarget = 180;
    addMates(w);
  } else {
    addMates(w);
  }
}

function stopMode(w) {
  if (w.mode === 'stress' && w.saved) {
    w.toggles.minigun = w.saved.minigun;
    w.hordeTarget = w.saved.horde;
  }
  if (w.mode === 'battle') w.hordeTarget = 0;
  w.mode = null;
  w.mates = [];
  w.phase = 'wave';
}

function buildView(w) {
  return {
    tick: w.tick, phase: w.phase, wave: w.wave, totalWaves: 15, timer: w.phase === 'wave' ? 0 : 10,
    remaining: w.zombies.length, bossHp: w.toggles.boss ? 0.7 : -1, objective: { hp: 900, maxHp: 1000 }, readyCount: 0,
    players: w.players || [w.me], zombies: w.zombies, projectiles: [], pickups: [], turrets: [], barricades: [],
    hazards: w.hazards || [], events: [],
  };
}

// ---- fixtures for every event type (positioned at the emitter) ----------------------------

function eventFixtures(e) {
  const { x, y } = e;
  return {
    'shot (turret)': [{ type: 'shot', pid: 0, turret: 1, weapon: 'rifle', x, y, angle: 0, rays: [] }],
    'chain (tesla arcs)': [{ type: 'chain', pid: 2, points: [{ x, y }, { x: x + 80, y }, { x: x + 150, y: y + 40 }, { x: x + 200, y: y - 20 }] }],
    'melee (hit)': [{ type: 'melee', pid: LOCAL, x: 0, y: 0, angle: 0, hits: 2 }],
    'melee (miss)': [{ type: 'melee', pid: LOCAL, x: 0, y: 0, angle: 0, hits: 0 }],
    'zdie': [{ type: 'zdie', id: 1, ztype: 'walker', x, y, angle: 0, by: 1, gib: false }],
    'zdie (gib)': [{ type: 'zdie', id: 1, ztype: 'runner', x, y, angle: 0, by: 1, gib: true }],
    'zdie (brute)': [{ type: 'zdie', id: 1, ztype: 'brute', x, y, angle: 0, by: 1, gib: false }],
    'zdie (boss)': [{ type: 'zdie', id: 1, ztype: 'boss', x, y, angle: 0, by: 1, gib: true }],
    'zattack': [{ type: 'zattack', id: 1, ztype: 'walker', x, y, angle: 0 }],
    'zattack (boss)': [{ type: 'zattack', id: 1, ztype: 'boss', x, y, angle: 0 }],
    'spit': [{ type: 'spit', id: 1, x, y, angle: 0 }],
    'scream': [{ type: 'scream', id: 1, x, y }],
    'charge': [{ type: 'charge', id: 1, x, y, angle: 0 }],
    'slam': [{ type: 'slam', id: 1, x, y, r: 190 }],
    'explosion frag': [{ type: 'explosion', x, y, r: 150, kind: 'frag' }],
    'explosion grenade': [{ type: 'explosion', x, y, r: 130, kind: 'grenade' }],
    'explosion rocket': [{ type: 'explosion', x, y, r: 180, kind: 'rocket' }],
    'explosion bloater': [{ type: 'explosion', x, y, r: 115, kind: 'bloater' }],
    'ignite': [{ type: 'ignite', x, y, r: 110 }],
    'pdamage (you)': [{ type: 'pdamage', pid: LOCAL, amount: 12, x: 10, y: 0 }],
    'down (you)': [{ type: 'down', pid: LOCAL }],
    'revived (you)': [{ type: 'revived', pid: LOCAL, by: 2 }],
    'died (you)': [{ type: 'died', pid: LOCAL }],
    'respawn (you)': [{ type: 'respawn', pid: LOCAL }],
    'pickup ammo': [{ type: 'pickup', pid: LOCAL, kind: 'ammo', x: 0, y: 0, weapon: null }],
    'pickup health': [{ type: 'pickup', pid: LOCAL, kind: 'health', x: 0, y: 0, weapon: null }],
    'pickup cash': [{ type: 'pickup', pid: LOCAL, kind: 'cash', x: 0, y: 0, weapon: null }],
    'pickup armor': [{ type: 'pickup', pid: LOCAL, kind: 'armor', x: 0, y: 0, weapon: null }],
    'pickup frag': [{ type: 'pickup', pid: LOCAL, kind: 'frag', x: 0, y: 0, weapon: null }],
    'pickup crate': [{ type: 'pickup', pid: LOCAL, kind: 'crate', x: 0, y: 0, weapon: 'lmg' }],
    'buy': [{ type: 'buy', pid: LOCAL, item: 'ammo' }],
    'buyfail': [{ type: 'buyfail', pid: LOCAL, item: 'turret', reason: 'cash' }],
    'empty': [{ type: 'empty', pid: LOCAL }],
    'switch': [{ type: 'switch', pid: LOCAL, weapon: 'rifle' }],
    'throw frag': [{ type: 'throw', pid: LOCAL, kind: 'frag' }],
    'throw molotov': [{ type: 'throw', pid: LOCAL, kind: 'molotov' }],
    'place turret': [{ type: 'place', pid: LOCAL, kind: 'turret', x, y }],
    'place barricade': [{ type: 'place', pid: LOCAL, kind: 'barricade', x, y }],
    'destroyed turret': [{ type: 'destroyed', kind: 'turret', id: 1, x, y }],
    'destroyed barricade': [{ type: 'destroyed', kind: 'barricade', id: 1, x, y }],
    'objhit': [{ type: 'objhit', x, y }],
    'wave': [{ type: 'wave', wave: 3, boss: false }],
    'wave (boss)': [{ type: 'wave', wave: 5, boss: true }],
    'bossspawn': [{ type: 'bossspawn', id: 1, x, y }],
    'waveclear': [{ type: 'waveclear', wave: 3, bonus: 250 }],
    'drop': [{ type: 'drop', x, y }],
    'gameover': [{ type: 'gameover', reason: 'wiped' }],
    'victory': [{ type: 'victory' }],
    ...Object.fromEntries(WEAPON_IDS.map((id) => [`reload ${id}`, [{ type: 'reload', pid: LOCAL, weapon: id }]])),
  };
}

// ---- level analysis ------------------------------------------------------------------------

const db = (v) => (v > 0 ? Math.round(20 * Math.log10(v) * 10) / 10 : -Infinity);

function analyze(buf, win) {
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const n = buf.length, sr = buf.sampleRate;
  let pk = 0, sum = 0, hot = 0;
  for (const d of chans) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > pk) pk = a;
      if (a > 0.9) hot++;
      sum += d[i] * d[i];
    }
  }
  const rmsAll = Math.sqrt(sum / (n * chans.length));
  const blk = Math.floor(sr * 0.05);
  let maxBlk = 0;
  for (let s = 0; s + blk <= n; s += blk) {
    let q = 0;
    for (const d of chans) for (let i = s; i < s + blk; i++) q += d[i] * d[i];
    maxBlk = Math.max(maxBlk, Math.sqrt(q / (blk * chans.length)));
  }
  const res = { peak: Math.round(pk * 10000) / 10000, peakDb: db(pk), rmsDb: db(rmsAll), maxRms50msDb: db(maxBlk), hotPct: Math.round(hot / (n * chans.length) * 1e5) / 1e3 };
  if (win) {
    const a = Math.floor(win[0] * sr), b = Math.min(n, Math.floor(win[1] * sr));
    let q = 0;
    for (const d of chans) for (let i = a; i < b; i++) q += d[i] * d[i];
    res.shotRmsDb = db(Math.sqrt(q / ((b - a) * chans.length)));
  }
  return res;
}

const SCENARIOS = {
  minigunHorde: { dur: 8, setup: (w) => startMode(w, 'stress', 100) },
  battle: { dur: 8, setup: (w) => startMode(w, 'battle', 100) },
  explosion200: { dur: 3, music: 0, setup: () => {}, at: (w, f, out) => f === 6 && out.push({ type: 'explosion', x: 200, y: 0, r: 180, kind: 'rocket' }) },
  musicCalm: { dur: 8, sfx: 0, setup: (w) => {
    w.phase = 'intermission';
  } },
  musicBoss: { dur: 8, sfx: 0, setup: (w) => {
    w.toggles.boss = true;
    w.hordeTarget = 60;
  } },
  remotePistol800: { dur: 1, music: 0, win: [0.1, 0.25], setup: () => {}, at: (w, f, out) => f === 6 && out.push(shotEvent(w, 2, 'pistol', 800, 0)) },
};
for (const id of ['pistol', 'magnum', 'uzi', 'shotgun', 'rifle', 'dmr', 'sniper', 'lmg', 'crossbow', 'tesla', 'grenade_launcher', 'rocket', 'railgun']) {
  SCENARIOS['own_' + id] = { dur: 1.6, music: 0, win: [0.1, 0.25], setup: () => {}, at: (w, f, out) => f === 6 && out.push(shotEvent(w, LOCAL, id, 0, 0)) };
}

/** Render a scenario offline and return its levels. */
async function measure(name, { dynamics = true, sr = 48000 } = {}) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error('unknown scenario ' + name);
  const off = new OfflineAudioContext(2, Math.ceil(sr * sc.dur), sr);
  let vt = 0;
  const a = createAudio({ context: off, clock: () => vt, manual: true, dynamics });
  await a.unlock();
  a.setVolume({ master: 0.8, sfx: sc.sfx ?? 1, music: sc.music ?? 0.5 });
  const w = createWorld(1234);
  sc.setup(w);
  const fdt = 1 / 60;
  let maxVoices = 0, events = 0;
  for (let f = 0; f * fdt < sc.dur - 0.05; f++) {
    vt = f * fdt;
    const out = [];
    stepWorld(w, fdt, out);
    if (sc.at) sc.at(w, f, out);
    events += out.length;
    a.update(buildView(w), { localId: LOCAL, dt: fdt });
    a.addEvents(out, { x: 0, y: 0, localId: LOCAL });
    maxVoices = Math.max(maxVoices, a.stats().voices);
  }
  const buf = await off.startRendering();
  const st = a.stats();
  return { name, dynamics, ...analyze(buf, sc.win), maxVoices, events, played: st.played, stolen: st.stolen, dropped: st.dropped, limited: st.limited, errors: st.errors };
}

// ---- live page ---------------------------------------------------------------------------

const audio = createAudio();
const world = createWorld();
let maxSeen = 0;
let unlocked = false;
const spark = [];

async function unlock() {
  await audio.unlock();
  unlocked = true;
  $('unlock').textContent = 'Audio unlocked';
  $('unlock').classList.add('on');
}

function emit(events) {
  for (const e of events) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) world.flashes.push({ x: e.x, y: e.y, t: world.t, type: e.type });
  }
  audio.addEvents(events, { x: 0, y: 0, localId: LOCAL });
}

function button(parent, label, fn, title) {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', (ev) => {
    unlock();
    fn(ev);
  });
  parent.appendChild(b);
  return b;
}

function buildUi() {
  const guns = $('guns');
  for (const id of WEAPON_IDS) {
    button(guns, WEAPONS[id].short, (ev) => {
      if (ev.shiftKey) emit([shotEvent(world, 2, id, world.emitter.x, world.emitter.y)]);
      else emit([shotEvent(world, LOCAL, id, 0, 0)]);
    }, `${WEAPONS[id].name} (sound: ${WEAPONS[id].sound})`);
  }
  const evs = $('events');
  for (const name of Object.keys(eventFixtures(world.emitter))) {
    button(evs, name, () => emit(eventFixtures(world.emitter)[name]));
  }
  const ui = $('ui');
  for (const name of UI_NAMES) button(ui, name, () => audio.ui(name));
  const cats = {};
  for (const id of audio.debug.soundIds()) (cats[audio.debug.category(id)] ||= []).push(id);
  const box = $('sounds');
  for (const [cat, ids] of Object.entries(cats)) {
    const row = document.createElement('div');
    row.className = 'cat';
    row.innerHTML = `<span>${cat}</span>`;
    for (const id of ids) {
      button(row, id, (ev) => {
        if (cat === 'loop') return;
        const o = ev.shiftKey ? { local: true, lim: null } : { x: world.emitter.x, y: world.emitter.y, lim: null };
        audio.debug.play(id, o);
        if (!ev.shiftKey) world.flashes.push({ ...world.emitter, t: world.t, type: id });
      });
    }
    box.appendChild(row);
  }
  for (const b of document.querySelectorAll('[data-toggle]')) {
    b.addEventListener('click', () => {
      unlock();
      const k = b.dataset.toggle;
      world.toggles[k] = !world.toggles[k];
      if (k === 'minigun' && world.toggles.minigun) world.toggles.flame = false;
      if (k === 'flame' && world.toggles.flame) world.toggles.minigun = false;
      syncToggles();
    });
  }
  $('unlock').addEventListener('click', unlock);
  $('stress').addEventListener('click', () => {
    unlock();
    startMode(world, 'stress', 8);
    syncToggles();
  });
  $('battle').addEventListener('click', () => {
    unlock();
    if (world.mode === 'battle') stopMode(world);
    else startMode(world, 'battle', 1e9);
    syncToggles();
  });
  $('stopAll').addEventListener('click', () => {
    stopMode(world);
    world.toggles = {};
    world.hordeTarget = 0;
    $('horde').value = 0;
    syncToggles();
  });
  $('playAll').addEventListener('click', () => {
    unlock();
    playEverySound(0.3);
  });
  $('horde').addEventListener('input', (e) => {
    world.hordeTarget = Number(e.target.value);
  });
  $('phase').addEventListener('change', (e) => {
    world.phase = e.target.value;
  });
  for (const [id, key] of [['volMaster', 'master'], ['volSfx', 'sfx'], ['volMusic', 'music']]) {
    $(id).addEventListener('input', (e) => audio.setVolume({ [key]: Number(e.target.value) }));
  }
  $('mute').addEventListener('change', (e) => audio.setMuted(e.target.checked));
  $('measure').addEventListener('click', async () => {
    $('levels').textContent = 'rendering...';
    const rows = [];
    for (const n of ['own_pistol', 'own_shotgun', 'own_sniper', 'remotePistol800', 'explosion200', 'minigunHorde']) {
      const r = await measure(n);
      rows.push(`${n.padEnd(16)} peak ${r.peak.toFixed(3)} (${r.peakDb} dB)  rms ${r.rmsDb} dB  ${r.shotRmsDb !== undefined ? 'shot ' + r.shotRmsDb + ' dB  ' : ''}voices<=${r.maxVoices}`);
      $('levels').textContent = rows.join('\n');
    }
  });
  const pad = $('pad');
  pad.addEventListener('click', (e) => {
    const r = pad.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (pad.width / r.width), sy = (e.clientY - r.top) * (pad.height / r.height);
    world.emitter = { x: Math.round((sx - pad.width / 2) / PAD_SCALE), y: Math.round((sy - pad.height / 2) / PAD_SCALE) };
  });
  syncToggles();
}

function syncToggles() {
  for (const b of document.querySelectorAll('[data-toggle]')) b.classList.toggle('on', !!world.toggles[b.dataset.toggle]);
  $('stress').classList.toggle('on', world.mode === 'stress');
  $('battle').classList.toggle('on', world.mode === 'battle');
}

/** Every one-shot, spaced `gap` seconds apart (gap 0: all at once — a voice-cap workout). */
function playEverySound(gap) {
  const ids = audio.debug.soundIds().filter((id) => audio.debug.category(id) !== 'loop');
  ids.forEach((id, i) => {
    const go = () => audio.debug.play(id, { local: true, lim: null });
    if (gap > 0) setTimeout(go, i * gap * 1000);
    else go();
  });
  return ids.length;
}

const PAD_SCALE = 0.12;

function draw() {
  const c = $('pad');
  const g = c.getContext('2d');
  const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#2a323c';
  g.beginPath();
  g.arc(cx, cy, 1600 * PAD_SCALE, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#1f262e';
  g.beginPath();
  g.arc(cx, cy, 900 * PAD_SCALE, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#6b7d5c';
  for (const z of world.zombies) g.fillRect(cx + z.x * PAD_SCALE - 1, cy + z.y * PAD_SCALE - 1, z.type === 'boss' ? 6 : 2, z.type === 'boss' ? 6 : 2);
  for (const p of world.players || []) {
    g.fillStyle = p.id === LOCAL ? '#4fc3f7' : '#ff8a65';
    g.beginPath();
    g.arc(cx + p.x * PAD_SCALE, cy + p.y * PAD_SCALE, 4, 0, Math.PI * 2);
    g.fill();
  }
  world.flashes = world.flashes.filter((f) => world.t - f.t < 0.5);
  for (const f of world.flashes) {
    const a = 1 - (world.t - f.t) / 0.5;
    g.strokeStyle = `rgba(255,183,77,${a})`;
    g.beginPath();
    g.arc(cx + f.x * PAD_SCALE, cy + f.y * PAD_SCALE, 3 + (1 - a) * 10, 0, Math.PI * 2);
    g.stroke();
  }
  const ex = cx + world.emitter.x * PAD_SCALE, ey = cy + world.emitter.y * PAD_SCALE;
  g.strokeStyle = '#ffb74d';
  g.beginPath();
  g.moveTo(ex - 6, ey);
  g.lineTo(ex + 6, ey);
  g.moveTo(ex, ey - 6);
  g.lineTo(ex, ey + 6);
  g.stroke();
  $('emitterInfo').textContent = `emitter at (${world.emitter.x}, ${world.emitter.y}) px, distance ${Math.round(Math.hypot(world.emitter.x, world.emitter.y))} px`;

  const sp = $('spark');
  const sg = sp.getContext('2d');
  sg.clearRect(0, 0, sp.width, sp.height);
  sg.fillStyle = '#81c784';
  spark.forEach((v, i) => {
    const h = v / 24 * sp.height;
    sg.fillRect(i * 2, sp.height - h, 2, h);
  });
}

function showStats() {
  const s = audio.stats();
  maxSeen = Math.max(maxSeen, s.voices);
  spark.push(s.voices);
  if (spark.length > 300) spark.shift();
  $('state').textContent = s.state;
  $('voices').textContent = s.voices;
  $('maxVoices').textContent = s.maxVoices;
  $('maxSeen').textContent = maxSeen;
  $('voicebar').firstElementChild.style.width = `${clamp(s.voices / s.maxVoices, 0, 1) * 100}%`;
  for (const k of ['loops', 'played', 'stolen', 'dropped', 'limited', 'errors']) $(k).textContent = s[k] ?? 0;
  $('baked').textContent = `${s.baked}/${s.total}`;
  $('music').textContent = `${s.musicMode}/${s.musicState ?? '-'} ${s.music}`;
  $('hordeN').textContent = world.zombies.length;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const out = [];
  stepWorld(world, dt, out);
  if (unlocked) {
    audio.update(buildView(world), { localId: LOCAL, dt });
    if (out.length) emit(out);
  }
  showStats();
  draw();
  requestAnimationFrame(frame);
}

buildUi();
requestAnimationFrame(frame);

window.__audioLab = {
  audio,
  world,
  unlock,
  measure,
  scenarios: Object.keys(SCENARIOS),
  playEverySound,
  fireAllEvents() {
    const fx = eventFixtures(world.emitter);
    let n = 0;
    for (const evs of Object.values(fx)) {
      emit(evs);
      n += evs.length;
    }
    for (const id of WEAPON_IDS) {
      emit([shotEvent(world, LOCAL, id, 0, 0), shotEvent(world, 2, id, world.emitter.x, world.emitter.y)]);
      n += 2;
    }
    for (const name of UI_NAMES) audio.ui(name);
    return n;
  },
  startStress(secs = 8) {
    startMode(world, 'stress', secs);
    syncToggles();
  },
  startBattle(secs = 8) {
    startMode(world, 'battle', secs);
    syncToggles();
  },
  setToggle(k, v) {
    world.toggles[k] = v;
    syncToggles();
  },
  setHorde(n) {
    world.hordeTarget = n;
  },
  get maxSeen() {
    return maxSeen;
  },
  resetMax() {
    maxSeen = 0;
  },
};
