// Time of day (settings.time 'night' | 'day', SPEC §7.5.1): the shared helpers, the lobby
// rules (validation, per-map fixed time), the saved preferences, the host -> client sync, the
// simulation's own resolution and the first-person atmosphere numbers behind each map's day.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { DEFAULT_SETTINGS } from '../public/js/shared/constants.js';
import { Game } from '../public/js/shared/sim.js';
import { TIME_LIST, TIME_IDS, mapTimes, mapSupportsTime, fixTimeCombo, resolveTime } from '../public/js/shared/timeofday.js';
import { mergeSettings } from '../public/js/net/lobby-rules.js';
import { loadPrefs, savePrefs } from '../public/js/ui/storage.js';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { FakeGame } from './fixtures/net-fake-game.js';
import { PRESETS, dayLookFor, sunDirection } from '../public/js/render3d/daylight-look.js';

/** A day-only map (like the daytime campaign map) for the duration of `fn`. */
function withDayOnlyMap(fn) {
  const entry = { id: 'dayonly-test', name: 'Day Only', description: 'test', time: 'day' };
  MAP_LIST.push(entry);
  try {
    return fn(entry);
  } finally {
    MAP_LIST.splice(MAP_LIST.indexOf(entry), 1);
  }
}

describe('time of day helpers', () => {
  test('two times, night first (the default); every existing map plays both', () => {
    assert.deepEqual(TIME_IDS, ['night', 'day']);
    for (const t of TIME_LIST) assert.ok(t.name && t.short);
    assert.equal(DEFAULT_SETTINGS.time, 'night');
    for (const m of MAP_LIST.filter((e) => !e.time && !e.times)) assert.deepEqual(mapTimes(m), TIME_IDS, `${m.id} plays both`);
  });

  test('a map declares a fixed `time` or a `times` list; unknown values are ignored', () => {
    assert.deepEqual(mapTimes({ id: 'x', time: 'day' }), ['day']);
    assert.deepEqual(mapTimes({ id: 'x', times: ['night'] }), ['night']);
    assert.deepEqual(mapTimes({ id: 'x', times: ['day', 'night'] }), ['day', 'night']);
    assert.deepEqual(mapTimes({ id: 'x', time: 'midnight' }), TIME_IDS);
    assert.deepEqual(mapTimes({ id: 'x', times: [] }), TIME_IDS);
    assert.deepEqual(mapTimes('nowhere'), TIME_IDS);
  });

  test('the builder copies the declaration onto the map data', () => {
    const m = buildMap('highway', 1);
    assert.equal(m.time, undefined, 'no fixed time');
    assert.equal(mapSupportsTime('highway', 'day'), true);
    assert.equal(mapSupportsTime('highway', 'dusk'), false);
  });

  test('resolveTime: the request when the map plays it, else the map\'s first', () => {
    assert.equal(resolveTime('highway', 'day'), 'day');
    assert.equal(resolveTime('highway', undefined), 'night');
    assert.equal(resolveTime('highway', 'dusk'), 'night');
    assert.equal(resolveTime({ time: 'day' }, 'night'), 'day');
    assert.equal(resolveTime({ time: 'day' }, undefined), 'day');
    assert.equal(resolveTime({ times: ['night'] }, 'day'), 'night');
  });
});

describe('lobby rules', () => {
  test('time is validated and merged; unknown values are ignored', () => {
    let s = mergeSettings(DEFAULT_SETTINGS, {});
    assert.equal(s.time, 'night');
    s = mergeSettings(s, { time: 'day' });
    assert.deepEqual([s.mapId, s.time], ['highway', 'day']);
    s = mergeSettings(s, { time: 'twilight' });
    assert.equal(s.time, 'day', 'unknown times are ignored');
    s = mergeSettings(s, { time: 7 });
    assert.equal(s.time, 'day');
    s = mergeSettings(s, { mapId: 'bridge' });
    assert.deepEqual([s.mapId, s.time], ['bridge', 'day'], 'the time survives a map change');
    s = mergeSettings(s, { time: 'night' });
    assert.equal(s.time, 'night');
    assert.equal(mergeSettings({}, {}).time, 'night', 'old settings without a time get the default');
  });

  test('a day-only map: picking it switches to day, picking night leaves it', () => {
    withDayOnlyMap((e) => {
      let s = mergeSettings({ ...DEFAULT_SETTINGS }, { mapId: e.id });
      assert.deepEqual([s.mapId, s.time], [e.id, 'day'], 'the map wins');
      s = mergeSettings(s, { time: 'night' });
      assert.equal(s.time, 'night');
      assert.notEqual(s.mapId, e.id, 'picking Night leaves the day-only map for a night map');
      assert.ok(mapTimes(s.mapId).includes('night'));
      s = mergeSettings(s, { mapId: e.id, time: 'night' });
      assert.deepEqual([s.mapId, s.time], [e.id, 'day'], 'both at once: the map wins');
      s = mergeSettings(s, { time: 'day' });
      assert.deepEqual([s.mapId, s.time], [e.id, 'day']);
      assert.deepEqual(fixTimeCombo('nowhere', 'nothing'), { mapId: MAP_LIST[0].id, time: 'night' });
      assert.deepEqual(fixTimeCombo(e.id, 'night', 'map'), { mapId: e.id, time: 'day' });
    });
  });
});

describe('simulation', () => {
  test('the game settings carry the time; a day-only map plays day whatever was asked', () => {
    const players = [{ id: 1, name: 'A', color: 0, cls: 'soldier' }];
    assert.equal(new Game({ mapId: 'bridge', seed: 1, settings: { time: 'day' }, players }).settings.time, 'day');
    assert.equal(new Game({ mapId: 'bridge', seed: 1, settings: {}, players }).settings.time, 'night');
    assert.equal(new Game({ mapId: 'bridge', seed: 1, settings: { time: 'dusk' }, players }).settings.time, 'night');
    withDayOnlyMap(() => {
      const map = { ...buildMap('bridge', 1), time: 'day' };
      const g = new Game({ map, mapId: 'dayonly-test', seed: 1, settings: { time: 'night' }, players });
      assert.equal(g.settings.time, 'day');
    });
  });

  test('time does not change the simulation (same seed, same snapshot)', () => {
    const players = [{ id: 1, name: 'A', color: 0, cls: 'soldier' }];
    const a = new Game({ mapId: 'checkpoint', seed: 9, settings: { time: 'night' }, players });
    const b = new Game({ mapId: 'checkpoint', seed: 9, settings: { time: 'day' }, players });
    for (let i = 0; i < 120; i++) { a.step(); b.step(); }
    assert.deepEqual(a.snapshot().players, b.snapshot().players);
    assert.equal(a.snapshot().zombies.length, b.snapshot().zombies.length);
  });
});

describe('preferences', () => {
  function withStore(fn) {
    const mem = new Map();
    const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const old = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
    try {
      fn(mem);
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true });
      else delete globalThis.localStorage;
    }
  }

  test('the lobby remembers the time and drops nonsense', () => {
    withStore((mem) => {
      const p = loadPrefs();
      assert.equal(p.lobby.time, 'night', 'default');
      p.lobby.time = 'day';
      savePrefs(p);
      assert.equal(loadPrefs().lobby.time, 'day');
      const key = [...mem.keys()][0];
      mem.set(key, JSON.stringify({ lobby: { time: 'noon', mapId: 'bridge' } }));
      assert.equal(loadPrefs().lobby.time, 'night');
      mem.set(key, JSON.stringify({ lobby: { mapId: 'bridge' } }));
      assert.equal(loadPrefs().lobby.time, 'night', 'prefs from an older build');
    });
  });
});

describe('sync', () => {
  test('the host\'s time reaches the clients and the started game', async () => {
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
    const now = () => 1000;
    const hub = createLocalHub({ code: 'ABCDE' });
    const created = [];
    const host = await hostGame({
      name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
      hooks: { now, manual: true, createGame: (o) => { const g = new FakeGame(o); created.push(o); return g; } },
    });
    const client = await joinGame({ name: 'Al', color: 1, cls: 'medic', via: hub.connect(), hooks: { now, manual: true } });
    const seen = [];
    client.on('settings', (st) => seen.push(st.time));
    assert.equal(host.settings.time, 'night');
    assert.equal(client.settings.time, 'night');
    host.setSettings({ time: 'day', mapId: 'truckstop' });
    await flush();
    assert.equal(host.settings.time, 'day');
    assert.equal(client.settings.time, 'day');
    assert.deepEqual(seen.slice(-1), ['day']);
    host.setSettings({ time: 'noon' });
    assert.equal(host.settings.time, 'day', 'invalid values never reach the wire');
    host.start();
    await flush();
    assert.equal(created[0].settings.time, 'day', 'the game is created with the chosen time');
    assert.equal(client.settings.time, 'day');
  });
});

describe('first-person day atmosphere numbers', () => {
  test('every map has a day look: warm bright sun, hazy fog, lamps off', () => {
    for (const { id } of MAP_LIST) {
      const p = dayLookFor(id);
      const [x, y, z] = sunDirection(p.az, p.el);
      assert.ok(y > 0.25 && y < 0.85, `${id}: sun elevation`);
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9);
      assert.ok(p.sunI > 2 && p.hemi > 0.4, `${id}: bright`);
      assert.ok(p.fog > 0.0001 && p.fog < 0.0006, `${id}: fog density`);
      assert.ok(p.wet >= 0 && p.wet < 0.6, `${id}: dry-ish ground`);
      for (const k of ['haze', 'horizon', 'zenith', 'sunColor', 'ridge']) assert.match(p[k], /^#[0-9a-f]{6}$/i, `${id}.${k}`);
    }
    for (const id of ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan']) assert.ok(PRESETS[id], `${id} has its own look`);
    assert.ok(dayLookFor('unknown-new-map').sunI > 2, 'a new map falls back to the default look');
  });
});
