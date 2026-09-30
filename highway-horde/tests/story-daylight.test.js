// "Daylight only" (JOURNEY.md §2.1): a campaign option stored in the world (`world.settings.daylight`),
// set by the host from the story lobby, that makes every mission and side job play by day. The world
// field survives saves, exports and old worlds; the action is the host's; the host session launches
// every mission at the time `missionTime()` picks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, sanitizeWorld, changeWorld, isDaylightOnly, cleanWorldSettings, WORLD_SETTINGS } from '../public/js/shared/story/world.js';
import { exportSave, parseSave } from '../public/js/shared/story/save.js';
import { applyAction } from '../public/js/shared/story/actions.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { missionTime } from '../public/js/shared/story/daylight.js';
import { setStoryContent, clearStoryContent } from '../public/js/shared/story/content.js';
import { MISSIONS } from '../public/js/shared/story/index.js';
import { hostGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { StoryFakeGame } from './fixtures/story-fake-game.js';

const on = (w) => changeWorld(w, (d) => { d.settings.daylight = true; }, 5);

test('the world carries the option: off for a new campaign, kept through sanitising, saves and exports', () => {
  assert.deepEqual(WORLD_SETTINGS, { daylight: false });
  const w = createWorld({ name: 'W', now: 1 });
  assert.deepEqual(w.settings, { daylight: false });
  assert.equal(isDaylightOnly(w), false);
  assert.equal(isDaylightOnly(createWorld({ name: 'W', daylight: true })), true);
  const lit = on(w);
  assert.equal(isDaylightOnly(lit), true);
  assert.equal(isDaylightOnly(w), false, 'changeWorld does not touch the original');
  // sanitising keeps it, drops junk, and a world saved before the option existed reads as off
  assert.deepEqual(sanitizeWorld(lit).world.settings, { daylight: true });
  const old = JSON.parse(JSON.stringify(w));
  delete old.settings;
  assert.deepEqual(sanitizeWorld(old).world.settings, { daylight: false });
  assert.deepEqual(sanitizeWorld({ ...lit, settings: { daylight: 'yes', evil: true } }).world.settings, { daylight: false });
  assert.deepEqual(sanitizeWorld({ ...lit, settings: [true] }).world.settings, { daylight: false });
  assert.deepEqual(cleanWorldSettings(null), { daylight: false });
  // export → import
  const parsed = parseSave(exportSave({ worlds: [lit], now: 9 }));
  assert.equal(parsed.ok, true);
  assert.equal(isDaylightOnly(parsed.worlds[0]), true);
  assert.equal(isDaylightOnly(null), false);
});

test('only the host switches it, with a boolean; the same value changes nothing', () => {
  const profile = createProfile({ name: 'A', cls: 'soldier' });
  const world = createWorld({ name: 'W', now: 1 });
  const st = (host) => ({ profile, world, actor: { isHost: host }, chapter: 1, now: 50 });
  assert.equal(applyAction(st(false), { a: 'daylight', on: true }).reason, 'host');
  for (const bad of [undefined, 1, 'true', null]) assert.equal(applyAction(st(true), { a: 'daylight', on: bad }).reason, 'invalid');
  const r = applyAction(st(true), { a: 'daylight', on: true });
  assert.equal(r.ok, true);
  assert.equal(isDaylightOnly(r.world), true);
  assert.equal(r.world.rev, world.rev + 1);
  const same = applyAction(st(true), { a: 'daylight', on: false });
  assert.equal(same.ok, true);
  assert.equal(same.world, world, 'no change, no new revision');
  // an older world without settings can be switched on too
  const bare = JSON.parse(JSON.stringify(world));
  delete bare.settings;
  const r2 = applyAction({ ...st(true), world: bare }, { a: 'daylight', on: true });
  assert.equal(isDaylightOnly(r2.world), true);
});

test('missionTime: the script decides, the campaign finale plays by day, the option makes it all day', () => {
  const off = createWorld({ name: 'W' }), lit = on(off);
  const night = { id: 'x', map: 'highway', time: 'night', mode: 'defend' };
  const day = { id: 'y', map: 'truckstop', time: 'day', mode: 'free' };
  const camp = { id: 'z', map: 'harlan', time: 'night', mode: 'campaign' };
  const level = { id: 'l', map: 'hospital', time: 'night', mode: 'free' };
  assert.equal(missionTime(night, off), 'night');
  assert.equal(missionTime(day, off), 'day');
  assert.equal(missionTime(camp, off), 'day', 'the campaign director plays by day');
  assert.equal(missionTime(night, off, 'campaign'), 'day', 'the sim mode the session picked counts');
  assert.equal(missionTime(level, off), 'night');
  assert.equal(missionTime(level, lit), 'day');
  assert.equal(missionTime(night, lit), 'day');
  assert.equal(missionTime(night, null), 'night');
  assert.equal(missionTime(null, lit), 'day');
  // every written mission and side job
  for (const m of MISSIONS) {
    assert.equal(missionTime(m, lit), 'day', `${m.id} plays by day with the option on`);
    assert.equal(missionTime(m, off), m.mode === 'campaign' ? 'day' : m.time, `${m.id} plays its own time with the option off`);
  }
});

// ---- the host session launches with that time ----------------------------------------------------------

const L = (who, text) => ({ who, text });
const M = (id, index, over) => ({
  id, chapter: 1, index, title: id.toUpperCase(), blurb: '', map: 'highway', time: 'night', mode: 'defend', level: [1, 3], party: { min: 1, max: 6 },
  briefing: [L('mara', 'Go.')], debrief: [L('mara', 'Done.')], rewards: { xp: 100, scrap: 20 }, stars: {}, ...over,
});

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

async function hostWith(world) {
  const hub = createLocalHub({ code: 'DAYLT' });
  const games = [];
  const profile = createProfile({ name: 'Bob', cls: 'soldier', color: 0 });
  let t = 1000;
  const clock = () => t;
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    story: { profile, world },
    hooks: { now: clock, manual: true, createGame: (opts) => { const g = new StoryFakeGame(opts); games.push(g); return g; } },
  });
  await flush();
  const frames = async (n) => {
    for (let i = 0; i < n; i++) {
      t += 1 / 60;
      host.update(1 / 60, null, 0);
      await flush(2);
    }
  };
  return { host, games, frames };
}

test('the host launches a night mission by day when the crew chose daylight, and by night when not', async () => {
  setStoryContent({
    missions: [M('a1', 1, { requires: [], hub: null, after: 'a2' }), M('a2', 2, { requires: ['a1'], hub: null, after: 'epilogue' })],
    chapters: [{ n: 1, title: 'Road', missions: ['a1', 'a2'], hub: null, arrival: null }],
  });
  try {
    for (const daylight of [false, true]) {
      const env = await hostWith(createWorld({ name: 'Crew', daylight, now: 100 }));
      env.host.start();
      await env.frames(3);
      assert.equal(env.host.story.stage, 'briefing');
      const g = env.games[env.games.length - 1];
      assert.equal(g.opts.settings.time, daylight ? 'day' : 'night', `staging game (daylight ${daylight})`);
      assert.equal(env.host.settings.time, daylight ? 'day' : 'night', 'the session settings the clients build from');
      // the host switches the option from the lobby side; the next launch follows it
      env.host.story._act({ a: 'daylight', on: !daylight });
      await env.frames(2);
      assert.equal(isDaylightOnly(env.host.story.world), !daylight);
      env.host.story.deploy();
      await env.frames(3);
      assert.equal(env.host.story.stage, 'mission');
      assert.equal(env.games[env.games.length - 1].opts.settings.time, daylight ? 'night' : 'day', 'the mission game follows the new option');
    }
  } finally {
    clearStoryContent();
  }
});
