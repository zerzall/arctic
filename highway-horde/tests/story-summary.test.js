// The campaign's progress counts the twelve story missions (side jobs are optional and counted on their
// own), and the hideout shows every cast member who is with the crew, recruited ones included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldSummary, campaignDone, nextMission } from '../public/js/shared/story/world.js';
import { getMissions, npcsAbsent } from '../public/js/shared/story/content.js';
import { installStoryContent } from '../public/js/ui/story-content.js';
import { Game } from '../public/js/shared/sim.js';

installStoryContent();

const world = (ids) => ({
  id: 'w', name: 'Crew', difficulty: 'normal', rev: 1, updatedAt: 0, members: {},
  progress: { node: 'hideout:roadhouse', completed: Object.fromEntries(ids.map((id) => [id, { stars: 2, time: 1 }])), flags: {} },
  hideout: { current: 'roadhouse', upgrades: {}, recruited: {}, stash: {} },
});

test('the campaign is the twelve story missions; side jobs are counted apart and never hold it back', () => {
  const missions = getMissions();
  const story = missions.filter((m) => !m.side);
  const side = missions.filter((m) => m.side);
  assert.equal(story.length, 12);
  assert.ok(side.length > 0);
  const fresh = worldSummary(world([]), missions);
  assert.equal(fresh.missionsTotal, 12);
  assert.equal(fresh.starsTotal, 36);
  assert.equal(fresh.sideTotal, side.length);
  assert.equal(fresh.complete, false);
  // the whole road, no side job: complete
  const all = world(story.map((m) => m.id));
  assert.equal(campaignDone(all, missions), true);
  assert.equal(nextMission(all, missions), null);
  const s = worldSummary(all, missions);
  assert.deepEqual([s.missionsDone, s.sideDone, s.complete], [12, 0, true]);
  // side jobs alone never count toward the road
  const jobs = world(side.map((m) => m.id));
  assert.equal(worldSummary(jobs, missions).missionsDone, 0);
  assert.equal(nextMission(jobs, missions).id, story[0].id);
});

test('the hideout shows the crew the world has: recruited cast stand on their spots', () => {
  const done = ['m1_1', 'm1_2', 'm2_1', 'm2_2'];
  const w = world(done);
  const absent = npcsAbsent(w);
  const g = new Game({
    mapId: 'roadhouse', seed: 1, players: [{ id: 1, name: 'a', color: 0, cls: 'soldier' }],
    settings: { difficulty: 'normal', waves: 0, objective: false, mode: 'hideout', time: 'day', story: { nodeId: 'hideout:roadhouse', party: [{ pid: 1 }], npcs: [], absent } },
  });
  g.step();
  const keys = g.snapshot().npcs.map((n) => n.key);
  for (const id of ['mara', 'deke', 'ozzy']) assert.ok(keys.includes(id), `${id} is with the crew after chapter 2: ${keys}`);
  for (const id of absent) assert.ok(!keys.includes(id), `${id} has not joined yet`);
});
