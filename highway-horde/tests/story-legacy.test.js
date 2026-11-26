// Old saves on the new road (JOURNEY.md §2): a World saved by the first campaign (fifteen missions on
// the classic maps) keeps working. The story missions kept the old ids by chapter and position, so
// an old World's `completed` names the matching point of the new road; these tests load old saves
// the way the game does (migrateWorld + sanitizeWorld), then ask the graph and the host's rules where
// the crew stands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as story from '../public/js/shared/story/index.js';
import { setStoryContent, clearStoryContent, getMissions } from '../public/js/shared/story/content.js';
import { resolveNext, nextNodes, pendingArrival } from '../public/js/shared/story/graph.js';
import { sanitizeWorld, availableMissions, currentChapter } from '../public/js/shared/story/world.js';
import { migrateWorld, parseSave } from '../public/js/shared/story/save.js';

const OLD_ORDER = ['m1_1', 'm1_2', 'm1_3', 'm2_1', 'm2_2', 'm2_3', 'm3_1', 'm3_2', 'm4_1', 'm4_2', 'm4_3', 'm5_1', 'm5_2', 'm6_1', 'm6_2'];
const OLD_TITLES = ['Pileup', 'Fuel Run', 'Beacon', 'Diner Siege', 'Radio Parts', 'Night Hauler', 'The Crossing', 'Sunken Cargo',
  'Hold the Tower', 'Broken Line', 'Ghosts', 'Down the Interstate', 'Field Hospital', 'Last Stand', 'The Tower'];
// what the first campaign gave: the flags and the people each old mission brought
const OLD_FLAGS = {
  m1_1: ['met_mara', 'bus_saved'], m1_2: ['met_deke', 'tow_truck_running'], m1_3: ['met_ozzy', 'warden_contact', 'road_open'],
  m2_1: ['met_quill', 'diner_saved'], m2_2: ['radio_repaired'], m2_3: ['met_dutch', 'fuel_secured'], m3_1: ['met_priya', 'apc_running'],
  m3_2: ['marine_pump'], m4_1: ['tower_held', 'met_okafor'], m4_2: ['generators_online', 'met_danny'], m4_3: ['ghosts_laid_to_rest'],
  m5_1: ['interstate_cleared'], m5_2: ['hospital_saved', 'med_supplies'], m6_1: ['convoy_through'], m6_2: ['haven_reached', 'campaign_complete'],
};
const OLD_NPC = { m1_1: 'mara', m1_2: 'deke', m1_3: 'ozzy', m2_1: 'quill', m2_3: 'dutch', m3_1: 'priya', m3_2: 'wendell', m4_1: 'okafor', m4_2: 'danny' };
const OLD_ARRIVAL = { m1_3: 'roadhouse', m3_2: 'depot', m5_2: 'farmstead' };

/** A World as the first campaign saved it, with these old missions done (the arrivals of finished chapters seen). */
function oldSave(done, { current, node } = {}) {
  const flags = {};
  const recruited = {};
  let hideout = 'roadhouse';
  for (const id of done) {
    for (const f of OLD_FLAGS[id]) flags[f] = true;
    if (OLD_NPC[id]) recruited[OLD_NPC[id]] = true;
    if (OLD_ARRIVAL[id]) {
      flags[`seen_arrival_${OLD_ARRIVAL[id]}`] = true;
      hideout = OLD_ARRIVAL[id];
    }
  }
  const raw = {
    v: 1, id: 'a1b2c3d4-0000-4000-8000-00000000abcd', name: 'Old Crew', rev: 40, createdAt: 1, updatedAt: 2, difficulty: 'normal', day: 50,
    progress: { node: node || `hideout:${current || hideout}`, completed: Object.fromEntries(done.map((id) => [id, { stars: 2, time: 400 }])), flags },
    hideout: { current: current || hideout, upgrades: { garden: 1 }, recruited, stash: { scrap: 120, parts: 3 } },
    members: {},
  };
  return sanitizeWorld(migrateWorld(raw)).world;
}
const upTo = (id) => OLD_ORDER.slice(0, OLD_ORDER.indexOf(id) + 1);

function withStory(fn) {
  setStoryContent({ story });
  try {
    fn();
  } finally {
    clearStoryContent();
  }
}

test('the legacy table covers every old mission: the story point it maps to, and the side job it became', () => {
  assert.deepEqual(Object.keys(story.LEGACY_MISSIONS), OLD_ORDER);
  OLD_ORDER.forEach((id, i) => {
    const l = story.LEGACY_MISSIONS[id];
    assert.equal(l.was, OLD_TITLES[i], `${id}: was ${OLD_TITLES[i]}`);
    assert.ok(story.mission(l.now) && !story.mission(l.now).side, `${id}: maps onto a story mission`);
    assert.equal(l.now[1], id[1], `${id}: stays in its chapter`);
    if (l.side) assert.equal(story.mission(l.side).title, OLD_TITLES[i], `${id}: lives on as the side job ${l.side}`);
    else assert.equal(story.mission(id).title, OLD_TITLES[i], `${id}: kept as it was`);
  });
  // the story kept every old id whose position still exists, so an old `completed` needs no rewrite
  for (const m of story.STORY_MISSIONS) assert.ok(OLD_ORDER.includes(m.id), `${m.id} is an old id`);
});

test('an old save lands at the matching point of the new road, chapter by chapter', () => {
  withStory(() => {
    const cases = [
      // [old missions done, where the crew goes next, the story chapter]
      [[], { kind: 'briefing', mission: 'm1_1' }, 1],
      [upTo('m1_1'), { kind: 'briefing', mission: 'm1_2' }, 1],
      [upTo('m1_2'), { kind: 'hideout', hideout: 'roadhouse', arrival: true }, 2],
      [upTo('m1_3'), { kind: 'hideout', hideout: 'roadhouse' }, 2],
      [upTo('m2_1'), { kind: 'hideout', hideout: 'roadhouse' }, 2],
      [upTo('m2_2'), { kind: 'hideout', hideout: 'roadhouse' }, 3],
      [upTo('m2_3'), { kind: 'hideout', hideout: 'roadhouse' }, 3],
      [upTo('m3_1'), { kind: 'briefing', mission: 'm3_2' }, 3],
      [upTo('m3_2'), { kind: 'hideout', hideout: 'depot' }, 4],
      [upTo('m4_1'), { kind: 'briefing', mission: 'm4_2' }, 4],
      [upTo('m4_2'), { kind: 'hideout', hideout: 'depot' }, 5],
      [upTo('m4_3'), { kind: 'hideout', hideout: 'depot' }, 5],
      [upTo('m5_1'), { kind: 'briefing', mission: 'm5_2' }, 5],
      [upTo('m5_2'), { kind: 'hideout', hideout: 'farmstead' }, 6],
      [upTo('m6_1'), { kind: 'briefing', mission: 'm6_2' }, 6],
      [upTo('m6_2'), { kind: 'hideout', hideout: 'farmstead', epilogue: true }, 6],
    ];
    for (const [done, want, chapter] of cases) {
      const w = oldSave(done);
      const label = done.length ? done.at(-1) : 'a new save';
      assert.deepEqual(resolveNext(w), want, `after old ${label}`);
      assert.equal(story.currentChapter(w).n, chapter, `after old ${label}: chapter`);
      // the host's chapter (weapons, upgrades, perk reset) follows the story; once the road is done the board is all there is
      const host = done.length === OLD_ORDER.length ? story.SIDE_CHAPTER : chapter;
      assert.equal(currentChapter(w, getMissions()), host, `after old ${label}: the host's chapter`);
    }
  });
});

test('mid chapter 2 in the old campaign (Diner Siege and Night Hauler done, Radio Parts not): Saint Mercy is next', () => {
  withStory(() => {
    const w = oldSave([...upTo('m2_1'), 'm2_3']);
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['m2_2']);
    assert.equal(story.mission('m2_2').title, 'Saint Mercy');
    assert.ok(availableMissions(w, getMissions()).some((m) => m.id === 'm2_2'), 'the host lets the crew pick it');
    assert.equal(story.stageFor('roadhouse', w), 'rh1');
    // the people the old road brought are all at the Roadhouse
    for (const npc of ['mara', 'deke', 'ozzy', 'roz', 'june', 'quill', 'dutch']) assert.ok(story.npcAvailable(npc, w), `${npc} is there`);
    // their side jobs wait on the board, to be played again for the first time on the new road
    const board = story.sideJobStates(w);
    assert.equal(board.find((b) => b.id === 'sj_diner').state, 'available');
  });
});

test('mid chapter 3 (the old Crossing won): the crew goes straight to the Blackwater Dam, Priya with them', () => {
  withStory(() => {
    const w = oldSave(upTo('m3_1'));
    assert.deepEqual(resolveNext(w), { kind: 'briefing', mission: 'm3_2' });
    assert.equal(story.mission('m3_2').map, 'dam');
    assert.ok(story.npcAvailable('priya', w));
    assert.equal(pendingArrival(w, 'depot'), null, 'the depot arrival waits for the dam');
  });
});

test('an old save arriving at the depot or the farm still sees its arrival scene once', () => {
  withStory(() => {
    const w = oldSave(upTo('m3_2'));
    const unseen = { ...w, progress: { ...w.progress, flags: { ...w.progress.flags, seen_arrival_depot: false } } };
    delete unseen.progress.flags.seen_arrival_depot;
    assert.deepEqual(resolveNext(unseen), { kind: 'hideout', hideout: 'depot', arrival: true });
    assert.equal(pendingArrival(unseen, 'depot').flag, 'seen_arrival_depot');
    assert.equal(pendingArrival(w, 'depot'), null, 'seen already');
  });
});

test('old progress.node values and version-0 saves are read the same way', () => {
  withStory(() => {
    // the first campaign stored a mission id on the road; the sanitiser rebuilds it from the hideout
    const w = oldSave(upTo('m4_1'), { node: 'm4_2', current: 'depot' });
    assert.equal(w.progress.node, 'hideout:depot');
    assert.deepEqual(resolveNext(w), { kind: 'briefing', mission: 'm4_2' });
    // a prototype save: a plain list of finished missions
    const v0 = sanitizeWorld(migrateWorld({ id: 'a1b2c3d4-0000-4000-8000-00000000abce', name: 'Proto', missions: upTo('m2_2'), flags: { met_mara: true } })).world;
    assert.deepEqual(resolveNext(v0), { kind: 'hideout', hideout: 'roadhouse', arrival: true }, 'a prototype never saw the Roadhouse scene');
    const seen = { ...v0, progress: { ...v0.progress, flags: { ...v0.progress.flags, seen_arrival_roadhouse: true } } };
    assert.deepEqual(nextNodes(seen).map((n) => n.id), ['m3_1'], 'then Westgate');
    // an exported file from the first campaign imports and resumes
    const file = JSON.stringify({ format: 'highway-horde-save', fileVersion: 1, worlds: { [w.id]: w } });
    const parsed = parseSave(file);
    assert.equal(parsed.ok, true);
    assert.deepEqual(resolveNext(parsed.worlds[0]), { kind: 'briefing', mission: 'm4_2' });
  });
});

test('the old road\'s flags still mean what they meant: dialogue and scenes read them', () => {
  withStory(() => {
    const w = oldSave(upTo('m5_2'));
    assert.equal(story.stageFor('farmstead', w), 'fs');
    // Wendell came home on the old Sunken Cargo (marine_pump): he answers the muster
    const epi = story.EPILOGUE.filter((l) => story.conditionMet(l.when, w)).map((l) => l.who);
    for (const who of ['wendell', 'dutch', 'quill']) assert.ok(epi.includes(who), `${who} is on the boat`);
    // and the people the old road brought are at the farm
    for (const npc of ['priya', 'okafor', 'danny', 'wendell', 'quill', 'dutch']) assert.ok(story.npcAvailable(npc, w), `${npc} is at the farm`);
  });
});

test('the crafted save of e2e scenario l (the old chapter 1 done) arrives at the Roadhouse with its board', () => {
  withStory(() => {
    const raw = { id: 'a1b2c3d4-0000-4000-8000-00000000abcf', name: 'Roadhouse Crew', progress: { completed: { m1_1: { stars: 2 }, m1_2: { stars: 2 }, m1_3: { stars: 2 } }, flags: { road_open: true } }, day: 44 };
    const w = sanitizeWorld(migrateWorld({ v: 1, rev: 1, createdAt: 1, updatedAt: 1, ...raw })).world;
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse', arrival: true });
    assert.equal(pendingArrival(w, 'roadhouse').flag, 'seen_arrival_roadhouse');
    const board = availableMissions(w, getMissions()).map((m) => m.id);
    assert.ok(board.includes('m2_1') && board.includes('sj_fuel') && board.includes('sj_diner'), `the board: ${board.join(', ')}`);
    assert.ok(getMissions().length >= 8, 'the board lists the campaign');
  });
});
