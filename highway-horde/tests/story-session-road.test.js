// The story session on a campaign shaped like the real one: road missions that chain straight
// into the next briefing without a hideout in between, an arrival scene when the crew reaches
// its first hideout, the bed that moves the day on, and the ending. Fake transports, fake games.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { createWorld } from '../public/js/shared/story/world.js';
import { setStoryContent } from '../public/js/shared/story/content.js';
import { START_DAY } from '../public/js/shared/story/content.js';
import { StoryFakeGame } from './fixtures/story-fake-game.js';

const L = (who, text, extra = {}) => ({ who, text, ...extra });
const M = (id, chapter, index, over) => ({
  id, chapter, index, title: id.toUpperCase(), blurb: '', map: 'highway', time: 'night', mode: 'defend', level: [1, 3], party: { min: 1, max: 6 },
  briefing: [L('mara', 'Go.')], debrief: [L('mara', 'Done.')], rewards: { xp: 100, scrap: 20 }, stars: {},
  ...over,
});

setStoryContent({
  missions: [
    M('a1', 1, 1, { requires: [], hub: null, after: 'a2' }),
    M('a2', 1, 2, { requires: ['a1'], hub: null, after: 'hideout:roadhouse' }),
    M('b1', 2, 1, { requires: ['a2'], hub: 'roadhouse', after: 'epilogue' }),
  ],
  chapters: [
    { n: 1, title: 'Road', missions: ['a1', 'a2'], hub: null, arrival: { hideout: 'roadhouse', flag: 'seen_arrival_roadhouse', scene: [L('roz', 'Wipe your boots.')] } },
    { n: 2, title: 'Camp', missions: ['b1'], hub: 'roadhouse', arrival: null },
  ],
  epilogue: [L('mara', 'Day {day}.')],
});

function makeClock(start = 1000) {
  let t = start;
  const clock = () => t;
  clock.advance = (dt) => {
    t += dt;
  };
  return clock;
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};

async function setup() {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'ROADX' });
  const games = [];
  const profile = createProfile({ name: 'Bob', cls: 'soldier', color: 0 });
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    story: { profile, world: createWorld({ name: 'The Road Crew', profile, now: 100 }) },
    hooks: {
      now: clock, manual: true,
      createGame: (opts) => {
        const g = new StoryFakeGame(opts);
        games.push(g);
        return g;
      },
    },
  });
  const alice = createProfile({ name: 'Alice', cls: 'medic', color: 1 });
  const client = await joinGame({
    name: 'Alice', color: 1, cls: 'medic', via: hub.connect(), story: { profile: alice, world: null }, hooks: { now: clock, manual: true },
  });
  await flush();
  const env = { clock, host, client, games, game: () => games[games.length - 1] };
  env.frames = async (n) => {
    for (let i = 0; i < n; i++) {
      clock.advance(1 / 60);
      host.update(1 / 60, IDLE, 0);
      client.update(1 / 60, IDLE, 0);
      await flush(2);
    }
    await new Promise((r) => setTimeout(r, 2));
  };
  return env;
}

test('a road campaign opens on the first briefing, and the missions chain until the crew arrives', async () => {
  const env = await setup();
  const { host, client } = env;
  const lobbies = [];
  host.on('lobby', () => lobbies.push('h'));
  client.on('lobby', () => lobbies.push('c'));
  host.start();
  await env.frames(3);

  // straight into the briefing of the first road mission, no hideout, no way back
  assert.equal(host.story.stage, 'briefing');
  assert.equal(host.story.missionId, 'a1');
  assert.equal(host.story.direct, true);
  assert.equal(client.story.stage, 'briefing');
  assert.equal(client.story.direct, true);
  assert.equal(host.held, true, 'the staging game is frozen behind the briefing');
  host.story.cancelBriefing();
  await env.frames(2);
  assert.equal(host.story.stage, 'briefing', 'there is no hideout to go back to');

  host.story.deploy();
  await env.frames(3);
  assert.equal(host.story.stage, 'mission');
  assert.equal(host.held, false);
  assert.equal(env.games.length, 2, 'the mission game replaced the staging game');
  assert.equal(client.story.stage, 'mission');

  // a1 won → debrief points at the next briefing, not at a hideout
  env.game().endMission('victory', 2, { 1: { kills: 10 }, 2: { kills: 4 } });
  await env.frames(4);
  assert.equal(host.story.stage, 'debrief');
  assert.deepEqual(host.story.debrief.next, { kind: 'briefing', mission: 'a2' });
  assert.deepEqual(client.story.debrief.next, { kind: 'briefing', mission: 'a2' });
  host.story.backToHideout();
  await env.frames(3);
  assert.equal(host.story.stage, 'briefing');
  assert.equal(host.story.missionId, 'a2');
  assert.equal(client.story.missionId, 'a2');

  // a2 won → the roadhouse, with its arrival scene pending
  host.story.deploy();
  await env.frames(3);
  env.game().endMission('victory', 3, { 1: { kills: 10 }, 2: { kills: 4 } });
  await env.frames(4);
  assert.deepEqual(host.story.debrief.next, { kind: 'hideout', hideout: 'roadhouse', arrival: true });
  host.story.backToHideout();
  await env.frames(3);
  assert.equal(host.story.stage, 'hideout');
  assert.equal(host.story.world.hideout.current, 'roadhouse');
  assert.equal(client.story.world.hideout.current, 'roadhouse');
  assert.deepEqual(host.story.stageInfo.arrival, { hideout: 'roadhouse', flag: 'seen_arrival_roadhouse' }, 'the host knows the scene before its match starts');
  assert.deepEqual(client.story.stageInfo.arrival, { hideout: 'roadhouse', flag: 'seen_arrival_roadhouse' });
  assert.equal(host.story.stageInfo.epilogue, false);

  // whoever watched the scene records it: the flag reaches everyone
  client.story.setFlag('seen_arrival_roadhouse');
  await env.frames(3);
  assert.equal(host.story.world.progress.flags.seen_arrival_roadhouse, true);
  assert.equal(client.story.world.progress.flags.seen_arrival_roadhouse, true);
  // (and a made-up flag is refused)
  const results = [];
  client.on('story', (e) => e.kind === 'result' && results.push(e));
  client.story.setFlag('campaign_complete');
  await env.frames(3);
  assert.equal(results.at(-1).ok, false);
  assert.equal(client.story.world.progress.flags.campaign_complete, undefined);
  assert.equal(lobbies.length, 0, 'nobody visited the lobby');

  // the board now offers b1
  host.story.pickMission('b1');
  await env.frames(2);
  assert.equal(host.story.stage, 'briefing');
  assert.equal(host.story.direct, false);
  host.story.cancelBriefing();
  await env.frames(2);
  assert.equal(host.story.stage, 'hideout', 'a hub mission can be backed out of');
});

test('the bed: everyone is patched up, the host moves the day on', async () => {
  const env = await setup();
  const { host, client } = env;
  host.start();
  await env.frames(3);
  for (const id of ['a1', 'a2']) {
    assert.equal(host.story.missionId, id);
    host.story.deploy();
    await env.frames(3);
    env.game().endMission('victory', 1, {});
    await env.frames(4);
    host.story.backToHideout();
    await env.frames(3);
  }
  assert.equal(host.story.stage, 'hideout');
  const day0 = host.story.world.day;
  assert.equal(day0, START_DAY + 2, 'each won mission is a day');
  const results = [];
  host.on('story', (e) => e.kind === 'result' && results.push(e));
  client.story.sleep();
  await env.frames(3);
  assert.equal(host.story.world.day, day0, 'only the host moves the day');
  host.story.sleep();
  await env.frames(3);
  assert.equal(host.story.world.day, day0 + 1);
  assert.equal(client.story.world.day, day0 + 1);
  assert.equal(results.at(-1).a, 'bed');
  assert.equal(results.at(-1).note.day, day0 + 1);
});

test('the ending: the last mission leads back to the hideout with the epilogue pending', async () => {
  const env = await setup();
  const { host, client } = env;
  host.start();
  await env.frames(3);
  for (const id of ['a1', 'a2']) {
    assert.equal(host.story.missionId, id);
    host.story.deploy();
    await env.frames(3);
    env.game().endMission('victory', 2, {});
    await env.frames(4);
    host.story.backToHideout();
    await env.frames(3);
  }
  client.story.setFlag('seen_arrival_roadhouse');
  await env.frames(2);
  host.story.pickMission('b1');
  await env.frames(2);
  host.story.deploy();
  await env.frames(3);
  env.game().endMission('victory', 3, {});
  await env.frames(4);
  assert.deepEqual(host.story.debrief.next, { kind: 'hideout', hideout: 'roadhouse', epilogue: true });
  host.story.backToHideout();
  await env.frames(3);
  assert.equal(host.story.stageInfo.epilogue, true);
  assert.equal(client.story.stageInfo.epilogue, true);
  host.story.setFlag('seen_epilogue');
  await env.frames(3);
  assert.equal(client.story.world.progress.flags.seen_epilogue, true);
  // the campaign is over but the hideout stays open: walking in again plays no scene
  host.returnToLobby();
  await env.frames(2);
  host.start();
  await env.frames(3);
  assert.equal(host.story.stage, 'hideout');
  assert.equal(host.story.stageInfo.epilogue, false);
  assert.equal(host.story.stageInfo.arrival, null);
});
