// The unlock graph (shared/story/graph.js): where the crew goes after a mission, road
// missions that chain without a hideout, arrival scenes, the epilogue — with the stub content
// and with content shaped like the real campaign (requires / hub / arrival / epilogue) — plus
// the content registry's scene, conversation and cast helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextNodes, resolveNext, pendingArrival, epiloguePending } from '../public/js/shared/story/graph.js';
import {
  setStoryContent, clearStoryContent, playableLines, conversationFor, castOf, contentFlags, expandTokens,
  stationKeeper, pepFor, retryQuip, stationLine,
} from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';
import { createWorld, changeWorld } from '../public/js/shared/story/world.js';

const L = (who, text, extra = {}) => ({ who, text, ...extra });

/** A small campaign shaped like the real one: a road chapter without a hideout, an arrival, a hub chapter, an ending. */
const ROAD = {
  missions: [
    { id: 'a1', chapter: 1, index: 1, title: 'A1', requires: [], hub: null, after: 'a2', rewards: { xp: 10 } },
    { id: 'a2', chapter: 1, index: 2, title: 'A2', requires: ['a1'], hub: null, after: 'hideout:camp', rewards: { xp: 10 } },
    { id: 'b1', chapter: 2, index: 1, title: 'B1', requires: ['a2'], hub: 'roadhouse', after: 'b2', rewards: { xp: 10 } },
    { id: 'b2', chapter: 2, index: 2, title: 'B2', requires: ['a2'], hub: 'roadhouse', after: 'b3', rewards: { xp: 10 } },
    { id: 'b3', chapter: 2, index: 3, title: 'B3', requires: ['b1', 'b2'], hub: 'roadhouse', after: 'epilogue', rewards: { xp: 10 } },
  ],
  chapters: [
    { n: 1, title: 'Road', missions: ['a1', 'a2'], hub: null, arrival: { hideout: 'roadhouse', flag: 'seen_arrival_roadhouse', scene: [L('roz', 'Wipe your boots.')] } },
    { n: 2, title: 'Camp', missions: ['b1', 'b2', 'b3'], hub: 'roadhouse', arrival: null },
  ],
  epilogue: [L('mara', 'Day {day}.'), L('june', 'Green cap!', { when: { flags: ['june_lucky_cap'] } }), L('deke', 'Regrettably.', { when: { notFlags: ['june_lucky_cap'] } })],
};

const done = (w, ...ids) => changeWorld(w, (d) => { for (const id of ids) d.progress.completed[id] = { stars: 1, time: 1 }; });
const flag = (w, ...ids) => changeWorld(w, (d) => { for (const id of ids) d.progress.flags[id] = true; });

test('with the stub content every mission has a hub: a campaign starts in the hideout', () => {
  setStoryContent(STUB_CONTENT);
  try {
    const w = createWorld({ name: 'W' });
    assert.deepEqual(nextNodes(w).map((n) => [n.kind, n.id, n.hub, n.direct]), [['mission', 'm1_1', 'roadhouse', false]]);
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse' });
    const w2 = done(w, 'm1_1', 'm1_2', 'm1_3', 'm2_1', 'm3_1');
    // the last chapter ends with an arrival at the depot, seen once
    assert.deepEqual(nextNodes(w2), [{ kind: 'hideout', id: 'depot', arrival: true, chapter: 3 }]);
    assert.deepEqual(resolveNext(w2), { kind: 'hideout', hideout: 'depot', arrival: true });
    assert.equal(pendingArrival(w2, 'depot').flag, 'seen_arrival_depot');
    assert.equal(pendingArrival(w2, 'roadhouse'), null);
    const w3 = flag(w2, 'seen_arrival_depot');
    assert.deepEqual(nextNodes(w3), []);
    assert.equal(pendingArrival(w3, 'depot'), null);
  } finally {
    clearStoryContent();
  }
});

test('road missions chain directly; the arrival scene follows the chapter; hub missions open the board', () => {
  setStoryContent(ROAD);
  try {
    let w = createWorld({ name: 'W' });
    assert.deepEqual(nextNodes(w).map((n) => [n.id, n.hub, n.direct]), [['a1', null, true]]);
    assert.deepEqual(resolveNext(w), { kind: 'briefing', mission: 'a1' }, 'straight to the first briefing');
    w = done(w, 'a1');
    assert.deepEqual(resolveNext(w), { kind: 'briefing', mission: 'a2' });
    w = done(w, 'a2');
    assert.deepEqual(nextNodes(w), [{ kind: 'hideout', id: 'roadhouse', arrival: true, chapter: 1 }]);
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse', arrival: true });
    // once the scene was seen: two missions to choose from, both from the roadhouse
    w = flag(w, 'seen_arrival_roadhouse');
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['b1', 'b2']);
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse' });
    w = done(w, 'b1');
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['b2']);
    w = done(w, 'b2');
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['b3']);
    w = done(w, 'b3');
    // the ending
    assert.deepEqual(nextNodes(w), [{ kind: 'epilogue', id: 'epilogue' }]);
    assert.equal(epiloguePending(w), true);
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse', epilogue: true });
    w = flag(w, 'seen_epilogue');
    assert.deepEqual(nextNodes(w), []);
    assert.equal(epiloguePending(w), false);
    assert.equal(resolveNext(w).done, true);
  } finally {
    clearStoryContent();
  }
});

test('side jobs are never nodes: the road, the arrivals and the ending ignore them, the crew stays where it is', () => {
  const SIDE = { side: true, chapter: 7, after: 'hideout', rewards: { xp: 5 } };
  setStoryContent({
    ...ROAD,
    missions: [
      ...ROAD.missions,
      { ...SIDE, id: 's1', index: 1, title: 'S1', requires: ['a2'], hub: 'roadhouse' },
      { ...SIDE, id: 's2', index: 2, title: 'S2', requires: ['s1'], hub: 'roadhouse' },
    ],
    chapters: [...ROAD.chapters, { n: 7, title: 'Side Jobs', side: true, missions: ['s1', 's2'], hub: null, arrival: null }],
  });
  try {
    let w = done(createWorld({ name: 'W' }), 'a1', 'a2');
    w = flag(w, 'seen_arrival_roadhouse');
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['b1', 'b2'], 's1 is open on the board but never a node');
    assert.deepEqual(resolveNext(w), { kind: 'hideout', hideout: 'roadhouse' });
    // a side job played: nothing moves on the road
    const after = done(w, 's1');
    assert.deepEqual(nextNodes(after), nextNodes(w));
    assert.deepEqual(resolveNext(after), resolveNext(w));
    // the story finished with no side job played: the ending plays, then the campaign rests
    let end = done(w, 'b1', 'b2', 'b3');
    assert.deepEqual(nextNodes(end), [{ kind: 'epilogue', id: 'epilogue' }]);
    assert.equal(epiloguePending(end), true, 'side jobs never hold the ending back');
    end = flag(end, 'seen_epilogue');
    assert.deepEqual(nextNodes(end), []);
    assert.deepEqual(resolveNext(changeWorld(end, (d) => { d.hideout.current = 'depot'; })), { kind: 'hideout', hideout: 'depot', done: true }, 'the crew stays at its hideout');
  } finally {
    clearStoryContent();
  }
});

test('content may bring its own nextNodes, and a broken one falls back to the default', () => {
  setStoryContent({ ...ROAD, nextNodes: () => [{ kind: 'mission', id: 'b2', chapter: 2, hub: 'depot', direct: false }] });
  try {
    assert.deepEqual(resolveNext(createWorld({ name: 'W' })), { kind: 'hideout', hideout: 'depot' });
  } finally {
    clearStoryContent();
  }
  setStoryContent({ ...ROAD, nextNodes: () => { throw new Error('bug in the content'); } });
  try {
    assert.equal(resolveNext(createWorld({ name: 'W' })).kind, 'briefing');
  } finally {
    clearStoryContent();
  }
});

test('scene lines: conditions, tokens, and only well-formed lines play', () => {
  setStoryContent(ROAD);
  try {
    const w = { ...createWorld({ name: 'W' }), day: 58 };
    const ctx = { day: 58, crew: 'The Dusty Crew', scrap: 12 };
    const plain = playableLines(ROAD.epilogue, w, ctx);
    assert.deepEqual(plain.map((l) => l.who), ['mara', 'deke']);
    assert.equal(plain[0].text, 'Day 58.');
    const lucky = playableLines(ROAD.epilogue, flag(w, 'june_lucky_cap'), ctx);
    assert.deepEqual(lucky.map((l) => l.who), ['mara', 'june']);
    assert.deepEqual(playableLines([null, { who: 'x' }, { text: 5 }, L('a', 'ok')], w), [{ who: 'a', text: 'ok' }]);
    assert.deepEqual(playableLines('nope', w), []);
    assert.equal(expandTokens('{crew} has {scrap} scrap on day {day}', ctx), 'The Dusty Crew has 12 scrap on day 58');
    assert.equal(expandTokens('{crew}', {}), '');
  } finally {
    clearStoryContent();
  }
});

test('conversations: greeting, topics filtered by conditions and once, idle fallback, flags a topic sets', () => {
  setStoryContent(STUB_CONTENT);
  try {
    const w = createWorld({ name: 'W' });
    const c = conversationFor('mara', 'roadhouse', w, null, 0);
    assert.match(c.greet, /Anything that bleeds/);
    assert.deepEqual(c.topics.map((t) => t.id), ['mara_ask', 'mara_gun']);
    const heard = conversationFor('mara', 'roadhouse', w, new Set(['mara_ask']), 0);
    assert.deepEqual(heard.topics.map((t) => t.id), ['mara_gun'], 'a once topic disappears after it was heard');
    assert.equal(conversationFor('ozzy', 'roadhouse', w).greet, 'The board is live. Pick a job.');
    assert.match(conversationFor('nobody', 'roadhouse', w).greet, /Keep your head down/);
    assert.deepEqual([...contentFlags()], ['asked_mara']);
  } finally {
    clearStoryContent();
  }
});

test('cast: content entries win, radio and system voices get their own cards, unknown ids get a generic one', () => {
  setStoryContent({
    ...STUB_CONTENT,
    cast: {
      mara: { id: 'mara', name: 'Mara Voss', role: 'Field Medic', look: { cls: 'medic' }, portrait: { accent: '#e57373', pose: 'arms-crossed' }, voice: { pitch: 1.05, rate: 0.95 } },
      warden: { id: 'warden', name: 'The Warden', radioOnly: true, look: null, portrait: { accent: '#80cbc4', pose: 'radio' } },
      narrator: { id: 'narrator', name: 'Narrator', system: true, look: null, portrait: { accent: '#c9c9c9', pose: 'none' } },
      roz: { id: 'roz', name: 'Roz Pruitt', role: 'Cook', look: { cls: 'heavy' }, portrait: { accent: '#ff8a65', pose: 'hands-on-hips' } },
    },
  });
  try {
    assert.deepEqual(castOf('mara'), { id: 'mara', name: 'Mara Voss', role: 'Field Medic', portrait: 'medic', color: '#e57373', voice: { pitch: 1.05, rate: 0.95 } });
    assert.equal(castOf('warden').portrait, 'radio');
    assert.equal(castOf('narrator').portrait, 'narrator');
    assert.equal(castOf('roz').portrait, 'heavy');
    assert.equal(castOf('roz').color, '#ff8a65');
    const g = castOf('someone');
    assert.equal(g.name, 'Someone');
    assert.equal(g.portrait, 'soldier');
    assert.equal(castOf(undefined).id, 'crew');
  } finally {
    clearStoryContent();
  }
});

test('station keepers, pep talks, retry quips and station lines come from the dialogue data', () => {
  const cast = {
    deke: { id: 'deke', name: 'Deke', station: 'workbench' },
    okafor: { id: 'okafor', name: 'Okafor', station: 'armory' },
    danny: { id: 'danny', name: 'Danny', station: 'armory' },
    warden: { id: 'warden', name: 'Warden', station: 'board', radioOnly: true },
  };
  const here = new Set(['deke', 'danny']);
  setStoryContent({
    ...ROAD,
    cast,
    npcAvailable: (id) => here.has(id),
    dialogue: {
      pep: { a1: [L('mara', 'Go get them.')] },
      retry: { general: [L('deke', 'Again.'), L('mara', 'Breathe.')], byMission: { a1: [L('june', 'Hurry!')] } },
      stations: { workbench: { name: 'Workbench', lines: ['Scrap in.', 'Trust it first.'] } },
    },
  });
  try {
    const w = createWorld({ name: 'W' });
    assert.equal(stationKeeper('workbench', w), 'deke');
    assert.equal(stationKeeper('armory', w), 'danny', 'the first keeper who is with the crew');
    assert.equal(stationKeeper('board', w), null, 'a radio voice never stands at a station');
    assert.equal(stationKeeper('perks', w), null);
    here.add('okafor');
    assert.equal(stationKeeper('armory', w), 'okafor', 'cast order decides among those present');
    assert.deepEqual(pepFor('a1'), [L('mara', 'Go get them.')]);
    assert.equal(pepFor('a2'), null);
    assert.equal(pepFor('__proto__'), null);
    assert.equal(retryQuip('a1', 0).who, 'june', 'a mission\'s own quips come first');
    assert.equal(retryQuip('zz', 0.99).who, 'mara');
    assert.equal(retryQuip('zz', 7).who, 'mara', 'out-of-range picks are clamped');
    assert.equal(stationLine('workbench', 0), 'Scrap in.');
    assert.equal(stationLine('workbench', 0.9), 'Trust it first.');
    assert.equal(stationLine('armory', 0), null);
  } finally {
    clearStoryContent();
  }
  // content that says nothing about stations leaves the choice to the caller
  setStoryContent(STUB_CONTENT);
  try {
    assert.equal(stationKeeper('workbench', createWorld({ name: 'W' })), undefined);
    assert.equal(pepFor('m1_1'), null);
    assert.equal(retryQuip('m1_1'), null);
  } finally {
    clearStoryContent();
  }
});

test('the whole index module can be installed in one go', () => {
  const story = {
    MISSIONS: ROAD.missions, CHAPTERS: ROAD.chapters, EPILOGUE: ROAD.epilogue, EPILOGUE_FLAG: 'seen_epilogue',
    CAST: { mara: { id: 'mara', name: 'Mara' } }, DIALOGUE: { talk: {}, stages: {}, idle: {} },
    nextNodes: (w) => (w.progress.completed.a1 ? [] : [{ kind: 'mission', id: 'a1', chapter: 1, hub: null, direct: true }]),
    conversation: () => ({ greet: 'from the content', topics: [] }),
    stageFor: () => 'x', conditionMet: () => true, expandTokens: (t) => `<${t}>`,
  };
  setStoryContent({ story });
  try {
    assert.equal(nextNodes(createWorld({ name: 'W' }))[0].id, 'a1');
    assert.equal(conversationFor('mara', 'roadhouse', createWorld({ name: 'W' })).greet, 'from the content');
    assert.equal(expandTokens('hi', {}), '<hi>');
    assert.equal(castOf('mara').name, 'Mara');
  } finally {
    clearStoryContent();
  }
});
