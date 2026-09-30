// The story layers against the real campaign data (shared/story/index.js: missions, cast,
// dialogue), once that data is part of the tree. Without it these tests skip; with it they check
// that the registry, the unlock graph, the rewards and the conversation helpers agree with the
// data model the writers used, and that the UI wiring point installs it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setStoryContent, clearStoryContent, getMissions, getChapters, getEpilogue, playableLines, conversationFor, castOf, contentFlags, getMission } from '../public/js/shared/story/content.js';
import { nextNodes, resolveNext, pendingArrival } from '../public/js/shared/story/graph.js';
import { createWorld, changeWorld } from '../public/js/shared/story/world.js';
import { createProfile } from '../public/js/shared/story/profile.js';
import { settleMission } from '../public/js/shared/story/rewards.js';
import { applyAction } from '../public/js/shared/story/actions.js';

const INDEX = fileURLToPath(new URL('../public/js/shared/story/index.js', import.meta.url));
const HAVE = fs.existsSync(INDEX);
const skip = HAVE ? false : 'the real story data (shared/story/index.js) is not in this tree yet';
const story = HAVE ? await import('../public/js/shared/story/index.js') : null;

const WIN = { type: 'storyend', result: 'victory', stars: 2, stats: { 1: { kills: 40, downs: 0, revives: 1 } }, time: 300 };

test('the wiring point installs the real data once it exists', { skip }, () => {
  const raw = fs.readFileSync(fileURLToPath(new URL('../public/js/ui/story-content.js', import.meta.url)), 'utf8');
  const src = raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(src, /shared\/story\/index\.js/, 'ui/story-content.js must import the real story data: see the comment there');
  assert.match(src, /setStoryContent\(\s*\{\s*story\b/);
});

test('walking the whole campaign: the graph follows the writers\' own nextNodes and every scene resolves', { skip }, () => {
  setStoryContent({ story });
  try {
    assert.equal(getMissions().length, story.MISSIONS.length);
    let w = createWorld({ name: 'The Reds' });
    const profile = createProfile({ name: 'A', cls: 'soldier' });
    const seen = [];
    for (let guard = 0; guard < 80; guard++) {
      assert.deepEqual(nextNodes(w), story.nextNodes(w), 'the registry uses the content nextNodes');
      const next = resolveNext(w);
      if (next.done) break;
      if (next.arrival) {
        const pa = pendingArrival(w, next.hideout);
        assert.ok(pa && playableLines(pa.scene, w).length > 0, `arrival at ${next.hideout} has a scene`);
        seen.push(`arrival:${next.hideout}`);
        w = changeWorld(w, (d) => { d.progress.flags[pa.flag] = true; d.hideout.current = next.hideout; });
        continue;
      }
      if (next.epilogue) {
        const ep = getEpilogue();
        assert.ok(playableLines(ep.lines, w).length > 20, 'the epilogue plays');
        seen.push('epilogue');
        w = changeWorld(w, (d) => { d.progress.flags[ep.flag] = true; });
        continue;
      }
      const id = next.kind === 'briefing' ? next.mission : nextNodes(w).find((n) => n.kind === 'mission' && n.hub === next.hideout).id;
      const m = getMission(id);
      assert.ok(m, `mission ${id} exists`);
      for (const list of [m.briefing, m.debrief]) {
        for (const l of playableLines(list, w)) assert.ok(castOf(l.who).name, `${id}: ${l.who} can be shown`);
      }
      const res = settleMission({ world: w, mission: m, result: WIN, party: [{ pid: 1, profile, human: true }], now: 1 });
      assert.equal(res.victory, true);
      assert.ok(res.world.progress.completed[id]);
      w = res.world;
      seen.push(id);
    }
    assert.equal(seen.length, story.MISSIONS.length + 4, 'every mission, three arrivals and the ending');
    assert.equal(seen.at(-1), 'epilogue');
    assert.equal(resolveNext(w).done, true);
    assert.ok(w.day > 41, 'the days went by');
  } finally {
    clearStoryContent();
  }
});

test('hideout conversations: each visit stage has a greeting for its people, topics set only known flags', { skip }, () => {
  setStoryContent({ story });
  try {
    const w = createWorld({ name: 'W' });
    const c = conversationFor('mara', 'roadhouse', w, null, 0);
    assert.equal(typeof c.greet, 'string');
    assert.ok(c.greet.length > 0);
    const flags = contentFlags();
    assert.ok(flags.size > 0, 'topics set flags');
    const s = { profile: createProfile({ name: 'A', cls: 'soldier' }), world: w, actor: { isHost: false }, chapter: 1, now: 5 };
    for (const f of flags) assert.equal(applyAction(s, { a: 'flag', flag: f }).ok, true, `${f} may be set from a conversation`);
    // a once-topic disappears after it was heard
    const first = c.topics[0];
    if (first && first.once) {
      const again = conversationFor('mara', 'roadhouse', w, new Set([first.id]), 0);
      assert.ok(!again.topics.some((t) => t.id === first.id));
    }
    // the cast: radio and caption voices get their own cards, the crew their class portraits
    assert.equal(castOf('warden').portrait, 'radio');
    assert.equal(castOf('narrator').portrait, 'narrator');
    assert.equal(castOf('mara').portrait, 'medic');
  } finally {
    clearStoryContent();
  }
});

test('the chapters cover the missions and their arrivals point at hideouts the game has', { skip }, () => {
  setStoryContent({ story });
  try {
    const ids = new Set(getMissions().map((m) => m.id));
    const inChapters = getChapters().flatMap((c) => c.missions || []);
    assert.deepEqual([...new Set(inChapters)].sort(), [...ids].sort());
    for (const c of getChapters()) {
      if (c.arrival) assert.ok(['roadhouse', 'depot', 'farmstead'].includes(c.arrival.hideout), `chapter ${c.n} arrives somewhere real`);
    }
    for (const m of getMissions()) {
      assert.ok(m.hub === null || ['roadhouse', 'depot', 'farmstead'].includes(m.hub), `${m.id} hub`);
      assert.ok(m.rewards && m.rewards.xp > 0, `${m.id} pays XP`);
    }
  } finally {
    clearStoryContent();
  }
});
