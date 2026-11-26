// The UX pass: default keybinds and their migration, the G / T utility keys (tap uses, hold switches),
// the contextual hints' gating, the loading bar's stages, the Heavy-GPU / MSAA-cap rules, the crosshair's
// bloom, the gun handling the review asked to check, and the true pause in solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDS, LEGACY_DEFAULT_BINDS, KEYS_VERSION, RESERVED_KEYS, migrateBinds, validBinds, keyLabel,
} from '../public/js/ui/input.js';
import { loadPrefs, validateSettings } from '../public/js/ui/storage.js';
import { createGadgets, GADGET_HOLD_S } from '../public/js/ui/gadgets.js';
import { createHints, HINTS_KEY, MAX_SHOWS, MIN_VISIBLE_S, MAX_VISIBLE_S } from '../public/js/ui/hints.js';
import { LOAD_STAGES, loadProgress } from '../public/js/ui/loading.js';
import { effectiveMsaa, msaaCapped, heavySettings, rendererSettings, supersampled } from '../public/js/ui/gfx.js';
import { easeBloom, dynamicGap, BLOOM_GAIN, crosshairSettings, baseGap } from '../public/js/ui/crosshair.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { handlingOf, inaccuracyOf } from '../public/js/shared/handling.js';
import { MODE_LIST } from '../public/js/shared/zone.js';
import { CLASSES, CLASS_IDS } from '../public/js/shared/classes.js';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { FakeGame } from './fixtures/net-fake-game.js';

// ---- default keybinds ------------------------------------------------------------------------------

test('keybinds: crouch defaults to C, G and T are the utility keys, F and Z are free', () => {
  assert.equal(DEFAULT_BINDS.crouch, 'KeyC');
  assert.deepEqual(validBinds(null), { ...DEFAULT_BINDS });
  assert.ok(RESERVED_KEYS.has('KeyG') && RESERVED_KEYS.has('KeyT'), 'G / T belong to the utility keys');
  assert.ok(!RESERVED_KEYS.has('KeyC') && !RESERVED_KEYS.has('KeyF'), 'C and F are no longer taken by gear');
  // F is now free to rebind, and Ctrl is still an alternative for crouch
  assert.equal(validBinds({ walk: 'KeyF' }).walk, 'KeyF');
  assert.equal(validBinds({ crouch: 'ControlLeft' }).crouch, 'ControlLeft');
  assert.equal(validBinds({ crouch: 'KeyG' }).crouch, DEFAULT_BINDS.crouch, 'G is taken');
  assert.equal(keyLabel(DEFAULT_BINDS.crouch), 'C');
});

test('keybinds: profiles saved with the old defaults move to the new ones, real customisations stay', () => {
  // the whole table was saved with every old profile: Z was the default, not a choice
  const old = { crouch: 'KeyZ', walk: 'KeyX', inspect: 'KeyY' };
  assert.deepEqual(validBinds(migrateBinds(old, undefined)), { ...DEFAULT_BINDS });
  assert.equal(validBinds(migrateBinds(old, 1)).crouch, 'KeyC');
  // a chosen key survives
  const mine = { crouch: 'ControlLeft', walk: 'KeyX', inspect: 'KeyH' };
  assert.deepEqual(validBinds(migrateBinds(mine, 1)), { crouch: 'ControlLeft', walk: 'KeyX', inspect: 'KeyH' });
  // a player who really picked Z on a current build keeps it (the version says it was a choice)
  assert.equal(validBinds(migrateBinds({ crouch: 'KeyZ' }, KEYS_VERSION)).crouch, 'KeyZ');
  // unbound stays unbound; garbage is ignored
  assert.equal(validBinds(migrateBinds({ crouch: '' }, 1)).crouch, '');
  assert.deepEqual(validBinds(migrateBinds('nope', 1)), { ...DEFAULT_BINDS });
  assert.deepEqual(LEGACY_DEFAULT_BINDS, { crouch: 'KeyZ', walk: 'KeyX', inspect: 'KeyY' });
});

test('keybinds: the stored settings are migrated on load and stamped with the version', () => {
  const s = validateSettings({ keys: { crouch: 'KeyZ', walk: 'KeyX', inspect: 'KeyY' } });
  assert.equal(s.keys.crouch, 'KeyC');
  assert.equal(s.keysVer, KEYS_VERSION);
  const again = validateSettings({ keys: { crouch: 'KeyZ' }, keysVer: s.keysVer });
  assert.equal(again.keys.crouch, 'KeyZ', 'a Z saved by the current build is the player\'s own');
  // through the real storage path
  const store = new Map([['highway-horde:prefs:v1', JSON.stringify({ settings: { keys: { crouch: 'KeyZ', walk: 'KeyX', inspect: 'KeyY' } } })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  try {
    assert.equal(loadPrefs().settings.keys.crouch, 'KeyC');
  } finally {
    delete globalThis.localStorage;
  }
});

// ---- G / T: tap uses, hold switches -----------------------------------------------------------------

test('gadgets: a tap uses the selected item, a hold switches it and uses nothing', () => {
  const g = createGadgets();
  assert.deepEqual(g.selected, { throw: 'frag', build: 'turret' });
  g.press('throw', 10);
  assert.equal(g.release('throw', 10.1), 'frag', 'a tap throws the frag');
  // a hold: switches once at the threshold, and the release uses nothing
  g.press('throw', 20);
  assert.equal(g.tick(20.1), null);
  assert.deepEqual(g.tick(20 + GADGET_HOLD_S + 0.01), ['throw']);
  assert.equal(g.selected.throw, 'molotov');
  assert.equal(g.tick(21), null, 'only once per hold');
  assert.equal(g.release('throw', 21), null);
  assert.ok(g.pickerOpen('throw', 21) && !g.pickerOpen('build', 21), 'the picker shows the switched group');
  assert.ok(!g.pickerOpen('throw', 30), 'and closes again');
  g.press('throw', 40);
  assert.equal(g.release('throw', 40.1), 'molotov', 'the next tap throws the molotov');
  // a hold released between two ticks is still the switch it was
  g.press('build', 50);
  assert.equal(g.release('build', 50.5), null);
  assert.equal(g.selected.build, 'barricade');
});

test('gadgets: a tap falls back to the other item when the selected one is out; cancel uses nothing', () => {
  const g = createGadgets();
  g.setCounts({ frag: 0, molotov: 2, turret: 0, barricade: 0 });
  g.press('throw', 1);
  assert.equal(g.release('throw', 1.05), 'molotov');
  g.press('build', 2);
  assert.equal(g.release('build', 2.05), 'turret', 'nothing in stock: the selection tries (the sim says no)');
  g.press('throw', 3);
  g.cancel();
  assert.equal(g.release('throw', 3.05), null, 'a cancelled press (window blur) never fires');
  assert.equal(g.select('barricade', 5), 'build');
  assert.equal(g.selected.build, 'barricade');
});

// ---- contextual hints ---------------------------------------------------------------------------------

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, m };
}

/** Run a hint's situation for `secs` seconds; returns the ids shown over the run. */
function run(h, wanted, secs, dt = 0.25) {
  const seen = new Set();
  for (let t = 0; t < secs; t += dt) {
    const id = h.update(wanted, dt);
    if (id) seen.add(id);
  }
  return seen;
}

test('hints: only while relevant, a few times per player, remembered', () => {
  const store = memStore();
  const h = createHints(store);
  assert.equal(h.update([], 0.1), '', 'nothing relevant: nothing shown');
  assert.deepEqual([...run(h, ['revive'], 3)], ['revive']);
  assert.equal(h.update([], 0.1), '', 'gone with its situation');
  assert.equal(h.count('revive'), 1, 'a showing that lasted counts once');
  // a flicker shorter than MIN_VISIBLE_S is not a showing
  run(h, ['buy'], MIN_VISIBLE_S - 0.5);
  h.update([], 0.1);
  assert.equal(h.count('buy'), 0);
  // MAX_SHOWS showings and then never again
  for (let i = 1; i < MAX_SHOWS; i++) {
    run(h, ['revive'], 3);
    h.update([], 0.1);
  }
  assert.equal(h.count('revive'), MAX_SHOWS);
  assert.equal(run(h, ['revive'], 3).size, 0, 'retired after its showings');
  assert.ok(!h.available('revive') && h.available('buy'));
  // remembered across sessions (localStorage), per hint
  const saved = JSON.parse(store.m.get(HINTS_KEY));
  assert.equal(saved.revive, MAX_SHOWS);
  const h2 = createHints(store);
  assert.equal(run(h2, ['revive'], 3).size, 0);
  assert.deepEqual([...run(h2, ['buy'], 3)], ['buy']);
});

test('hints: doing the thing retires the hint; a long situation fades; storage failures are harmless', () => {
  const h = createHints(memStore());
  run(h, ['buy'], 1.5);
  h.learn('buy');
  assert.equal(h.update(['buy'], 0.1), '');
  assert.ok(!h.available('buy'));
  // the zip hint fades after MAX_VISIBLE_S while the gantry is still in reach, and stays off until it was left
  const z = createHints(memStore());
  const shown = [];
  for (let t = 0; t < MAX_VISIBLE_S + 4; t += 0.5) shown.push(z.update(['zip'], 0.5));
  assert.equal(shown[0], 'zip');
  assert.equal(shown[shown.length - 1], '');
  assert.equal(z.count('zip'), 1);
  z.update([], 0.1);
  assert.equal(z.update(['zip'], 0.1), 'zip', 'back at the gantry later: shown again (a showing is left)');
  // one at a time, in priority order
  const p = createHints(memStore());
  assert.equal(p.update(['revive', 'buy'], 0.1), 'revive');
  // a store that throws never breaks the hints
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  const b = createHints(bad);
  assert.deepEqual([...run(b, ['revive'], 3)], ['revive']);
  // garbage in storage is ignored
  const junk = memStore();
  junk.setItem(HINTS_KEY, '{"revive":"lots","buy":-4,"zip":2.9}');
  const j = createHints(junk);
  assert.equal(j.count('revive'), 0);
  assert.equal(j.count('buy'), 0);
  assert.equal(j.count('zip'), 2);
});

// ---- loading screen --------------------------------------------------------------------------------------

test('loading: the stages are named in order and the bar is monotonic and ends at 100%', () => {
  assert.deepEqual(LOAD_STAGES.map((s) => s.label), ['Loading map', 'Building world', 'Compiling shaders', 'Textures', 'Audio']);
  assert.equal(loadProgress('map', 0), 0);
  assert.ok(Math.abs(loadProgress('audio', 1) - 1) < 1e-9);
  let prev = -1;
  for (const st of LOAD_STAGES) {
    for (const f of [0, 0.25, 0.5, 1]) {
      const p = loadProgress(st.id, f);
      assert.ok(p >= prev - 1e-9, `${st.id} ${f} does not go backwards`);
      prev = p;
    }
  }
  assert.equal(loadProgress('nope', 1), 0);
  assert.equal(loadProgress('world', NaN), loadProgress('map', 1));
  assert.equal(loadProgress('world', 7), loadProgress('shaders', 0), 'a fraction is clamped');
});

// ---- graphics guardrails --------------------------------------------------------------------------------------

test('graphics: MSAA is capped at 2x above 100% resolution and the heavy settings are flagged', () => {
  const base = { renderScale: 1, msaa: 8, quality: 'cinematic', shadowsHigh: true, volumetrics: true };
  assert.equal(effectiveMsaa(base), 8);
  assert.ok(!msaaCapped(base));
  assert.deepEqual(heavySettings(base), ['msaa', 'shadows', 'volumetrics']);
  const ss = { ...base, renderScale: 1.5 };
  assert.ok(supersampled(ss));
  assert.equal(effectiveMsaa(ss), 2);
  assert.ok(msaaCapped(ss));
  assert.equal(rendererSettings(ss).msaa, 2, 'the renderer is given the capped value');
  assert.equal(rendererSettings(base).msaa, 8);
  assert.deepEqual(heavySettings(ss), ['resolution', 'shadows', 'volumetrics']);
  assert.equal(effectiveMsaa({ ...base, msaa: 2, renderScale: 2 }), 2);
  assert.ok(!msaaCapped({ ...base, msaa: 2, renderScale: 2 }), 'nothing was lowered');
  assert.equal(effectiveMsaa({ ...base, renderScale: 'auto' }), 8, 'auto picks its own scale and is not capped here');
  assert.deepEqual(heavySettings({ renderScale: 1, msaa: 4, quality: 'high', volumetrics: false }), []);
});

// ---- the crosshair and the gun handling ------------------------------------------------------------------

test('crosshair: the gap blooms fast and settles slower, and moving opens it clearly', () => {
  const o = crosshairSettings(null);
  const ui = 1;
  const stand = dynamicGap(o, ui, 3, 0, 200);
  const move = dynamicGap(o, ui, 16, 0, 200);
  assert.ok(move - stand >= 10, `moving opens the gap by ${(move - stand).toFixed(1)} px`);
  assert.ok(stand >= baseGap(o));
  assert.ok(BLOOM_GAIN > 1);
  const open = easeBloom(10, 40, 1 / 60);
  const close = easeBloom(40, 10, 1 / 60);
  assert.ok(open - 10 > 40 - close, 'it opens faster than it closes');
  assert.equal(easeBloom(NaN, 12, 0.016), 12, 'the first frame takes the target');
  assert.ok(easeBloom(10, 40, 1) > 39.9, 'and converges');
});

test('gun handling: pistols, SMGs and shotguns keep small moving penalties, rifles, snipers and machine guns stay strict', () => {
  const st = { speed: 1, maxSpeed: 1, air: false, landT: 99, duck: 0, scope: 0, sprint: false, added: 0, accK: 1 };
  const moving = (id) => {
    const h = handlingOf(id);
    return inaccuracyOf(h, { ...st, speed: 1 }) - inaccuracyOf(h, { ...st, speed: 0 });
  };
  const worst = (cat) => Math.max(...Object.entries(WEAPONS).filter(([, w]) => w.category === cat).map(([id]) => moving(id)));
  const best = (cat) => Math.min(...Object.entries(WEAPONS).filter(([, w]) => w.category === cat).map(([id]) => moving(id)));
  for (const cat of ['pistol', 'smg', 'shotgun']) assert.ok(worst(cat) <= 0.05, `${cat}: kiting stays snappy (${worst(cat).toFixed(3)} rad)`);
  for (const cat of ['rifle', 'sniper']) assert.ok(best(cat) >= 0.07, `${cat}: stop to shoot (${best(cat).toFixed(3)} rad)`);
  for (const id of ['lmg', 'm60', 'hmg']) assert.ok(moving(id) >= 0.09, `${id}: stop to shoot`);
  // and every light-gun penalty is far below every rifle's
  assert.ok(Math.max(worst('pistol'), worst('smg'), worst('shotgun')) < Math.min(best('rifle'), best('sniper')) * 0.6);
});

// ---- lobby descriptions -------------------------------------------------------------------------------------

test('lobby: every mode and class has a crisp one-line description', () => {
  for (const m of MODE_LIST) assert.ok(m.line && m.line.length > 10 && m.line.length <= 100 && !m.line.includes('\n'), `${m.id} line`);
  assert.match(MODE_LIST.find((m) => m.id === 'zone').line, /Harlan County/, 'Evac Run names its map');
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    assert.ok(c.line && c.line.length <= 80, `${id} line: ${c.line}`);
  }
  assert.deepEqual(CLASS_IDS.map((id) => CLASSES[id].name).sort(), ['Boom', 'Doc', 'Sarge', 'Sparks', 'Swift', 'Tank']);
});

// ---- true pause in solo -------------------------------------------------------------------------------------

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};

function makeClock(start = 1000) {
  let t = start;
  const clock = () => t;
  clock.advance = (dt) => { t += dt; };
  return clock;
}

async function soloHost() {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'PAUSE' });
  const games = [];
  const host = await hostGame({
    name: 'Solo', color: 0, cls: 'soldier', transport: hub.host,
    hooks: { now: clock, manual: true, createGame: (o) => { const g = new FakeGame(o); games.push(g); return g; } },
  });
  return { clock, hub, host, games, game: () => games[games.length - 1] };
}

function step(env, secs) {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) {
    env.clock.advance(1 / 60);
    env.host.update(1 / 60, IDLE, 0);
  }
}

test('true pause: a solo game stops stepping while paused and resumes without catching up', async () => {
  const env = await soloHost();
  env.host.addBot();
  assert.ok(env.host.start());
  step(env, 1);
  const g = env.game();
  assert.ok(env.host.canPause(), 'the host alone with a bot can pause');
  const t0 = g.tick;
  assert.ok(t0 >= 50 && t0 <= 62, `about a second of ticks (${t0})`);
  assert.equal(env.host.setPaused(true), true);
  assert.ok(env.host.paused);
  step(env, 5);
  assert.equal(g.tick, t0, 'the sim did not tick for five paused seconds');
  // the view stands still too
  const v1 = env.host.getView();
  step(env, 0.5);
  assert.equal(env.host.getView().tick, v1.tick);
  assert.equal(env.host.setPaused(false), false);
  assert.ok(!env.host.paused);
  step(env, 0.05);
  assert.ok(g.tick - t0 <= 6, `resumed from where it stopped, no fast-forward (${g.tick - t0} ticks)`);
  step(env, 1);
  const t1 = g.tick;
  assert.ok(t1 - t0 >= 55 && t1 - t0 <= 75, `and then runs in real time (${t1 - t0})`);
  // pausing twice and resuming twice is harmless
  env.host.setPaused(true);
  env.host.setPaused(true);
  step(env, 2);
  env.host.setPaused(false);
  env.host.setPaused(false);
  step(env, 0.5);
  assert.ok(g.tick - t1 <= 40);
  // a frame while paused queues no input: the pause is not a way to bank a shot
  env.host.setPaused(true);
  env.host.update(1 / 60, { ...IDLE, frag: true }, 0);
  env.host.setPaused(false);
  assert.equal(env.host.paused, false);
  env.host.leave();
});

test('true pause: an online room keeps running, a game with a human in it too, and ending the game clears the pause', async () => {
  const env = await soloHost();
  env.host.start();
  const cli = await joinGame({ name: 'Pal', color: 1, cls: 'medic', via: env.hub.connect(), hooks: { now: env.clock, manual: true } });
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  assert.ok(!env.host.canPause(), 'with a remote human in the room the game never stops');
  assert.equal(env.host.setPaused(true), false);
  const t = env.game().tick;
  step(env, 1);
  assert.ok(env.game().tick > t + 40, 'it kept ticking');
  assert.equal(cli.canPause(), false);
  assert.equal(cli.setPaused(true), false);
  cli.leave();
  env.host.leave();

  // a lobby (no game yet) cannot be paused; returning to the lobby clears a pause
  const e2 = await soloHost();
  assert.equal(e2.host.setPaused(true), false);
  e2.host.start();
  e2.host.setPaused(true);
  assert.ok(e2.host.paused);
  e2.host.returnToLobby();
  assert.ok(!e2.host.paused);
  e2.host.leave();
});
