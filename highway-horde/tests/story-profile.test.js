// Story layer: profiles (create, sanitise, join caps, bots) and worlds (create, sanitise,
// revisions, progress) — shared/story/{profile,world}.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfile, sanitizeProfile, validateProfile, acceptJoinProfile, touchProfile, cleanText, newId, isId, scrapBudget,
  botStoryProfile, defaultLoadout, classWeapon, MAX_SCRAP,
} from '../public/js/shared/story/profile.js';
import { xpForLevel, MAX_XP } from '../public/js/shared/story/progression.js';
import { tierSpent } from '../public/js/shared/story/upgrades.js';
import {
  createWorld, sanitizeWorld, validateWorld, changeWorld, pickHighest, touchMember, isMember, missionBoard, availableMissions,
  nextMission, currentChapter, chapterDone, campaignDone, hideoutFor, worldSummary, missionStatus, MAX_FLAGS, MAX_MEMBERS,
} from '../public/js/shared/story/world.js';
import { setStoryContent, clearStoryContent, getMissions } from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';
import { CLASS_IDS } from '../public/js/shared/classes.js';

// ---- profile ---------------------------------------------------------------------------------

test('a new profile is valid, level 1, with the pistol and the class gun', () => {
  for (const cls of CLASS_IDS) {
    const p = createProfile({ name: 'Ali', cls, color: 3 });
    assert.equal(p.v, 1);
    assert.ok(isId(p.id));
    assert.equal(p.level, 1);
    assert.equal(p.xp, 0);
    assert.equal(p.perkPoints, 0);
    assert.equal(p.scrap, 0);
    assert.equal(p.cls, cls);
    assert.equal(p.color, 3);
    assert.deepEqual(p.loadout, defaultLoadout(cls));
    assert.ok(p.weapons.pistol && p.weapons[classWeapon(cls)]);
    assert.deepEqual(validateProfile(p), { ok: true, notes: [] });
  }
  assert.notEqual(newId(), newId());
  assert.equal(newId().length, 32);
});

test('sanitizeProfile repairs garbage instead of throwing', () => {
  for (const junk of [null, undefined, 5, 'x', [], () => {}]) {
    assert.equal(sanitizeProfile(junk).profile, null);
  }
  const { profile, notes } = sanitizeProfile({});
  assert.ok(profile);
  assert.equal(profile.level, 1);
  assert.equal(profile.name, 'Survivor');
  assert.ok(isId(profile.id));
  assert.ok(notes.includes('id replaced'));
  assert.equal(validateProfile(profile).ok, true);
  // hostile shapes
  const h = sanitizeProfile({
    id: '../../etc', name: '‮​Evil\u0000', xp: 'lots', level: 99, perkPoints: -5, perks: 'all', scrap: {}, weapons: 7,
    loadout: 'x', cls: 'wizard', color: 99, stats: 5, cosmetics: [1], kit: 'x',
  }).profile;
  assert.equal(h.name, 'Evil');
  assert.equal(h.xp, 0);
  assert.equal(h.level, 1);
  assert.equal(h.perkPoints, 0);
  assert.equal(h.cls, CLASS_IDS[0]);
  assert.equal(h.color, 0);
  assert.deepEqual(h.loadout, ['pistol', 'rifle', null]);
});

test('level always follows XP; perks and points never exceed what the level allows', () => {
  const lv = sanitizeProfile({ ...createProfile({ name: 'A' }), xp: xpForLevel(6), level: 20 });
  assert.equal(lv.profile.level, 6);
  assert.ok(lv.notes.includes('level recomputed from xp'));
  // level 6 = 5 points; try to cheat with 12 ranks and 9 unspent points
  const cheat = sanitizeProfile({
    ...createProfile({ name: 'A' }), xp: xpForLevel(6), perks: { steady: 3, quick: 3, thick: 3, medic: 3 }, perkPoints: 9,
  }).profile;
  const spent = Object.values(cheat.perks).reduce((a, b) => a + b, 0);
  assert.ok(spent + cheat.perkPoints <= 5, `spent ${spent} + ${cheat.perkPoints} <= 5`);
  // rank gates: rank 3 needs level 8
  const gate = sanitizeProfile({ ...createProfile({ name: 'A' }), xp: xpForLevel(6), perks: { steady: 3 } }).profile;
  assert.ok(gate.perks.steady <= 2);
  // honest profile: nothing changes
  const honest = { ...createProfile({ name: 'A' }), xp: xpForLevel(10), level: 10, perks: { steady: 2, thick: 1 }, perkPoints: 6 };
  assert.deepEqual(validateProfile(honest), { ok: true, notes: [] });
  assert.deepEqual(sanitizeProfile(honest).profile.perks, { steady: 2, thick: 1 });
  assert.equal(sanitizeProfile(honest).profile.perkPoints, 6);
});

test('weapons: unknown guns dropped, tiers capped at 5, pistol and class gun always owned, loadout from owned guns', () => {
  const p = sanitizeProfile({
    ...createProfile({ name: 'A', cls: 'heavy' }),
    weapons: { shotgun: { tier: 9 }, bazooka: { tier: 1 }, rifle: { tier: -3 }, __proto__: { tier: 4 }, constructor: { tier: 2 } },
    loadout: ['bazooka', 'rifle', 'rifle'],
  });
  assert.equal(p.profile.weapons.shotgun.tier, 5);
  assert.equal(p.profile.weapons.rifle.tier, 0);
  assert.equal(p.profile.weapons.bazooka, undefined);
  assert.equal(Object.hasOwn(p.profile.weapons, 'constructor'), false);
  assert.ok(p.profile.weapons.pistol);
  assert.ok(p.profile.weapons.shotgun, 'heavy class gun');
  assert.equal(p.profile.loadout[0], 'pistol', 'slot 0 falls back to the pistol');
  assert.equal(p.profile.loadout[1], 'rifle');
  assert.equal(p.profile.loadout[2], null, 'duplicate dropped');
  assert.ok(p.notes.some((n) => /unknown weapon bazooka/.test(n)));
  // a loadout with only unowned guns
  const e = sanitizeProfile({ ...createProfile({ name: 'A' }), loadout: ['minigun', 'amr', 'railgun'] }).profile;
  assert.deepEqual(e.loadout, ['pistol', null, null]);
  // slot 0 empty but the pistol is used in slot 1
  const s = sanitizeProfile({ ...createProfile({ name: 'A' }), loadout: [null, 'pistol', 'rifle'] }).profile;
  assert.deepEqual(s.loadout, ['pistol', 'rifle', null], 'the others shift up');
});

test('joining caps: xp and scrap cannot exceed what the level plausibly earned', () => {
  const cheat = { ...createProfile({ name: 'Cheater' }), xp: 5 * MAX_XP, scrap: 1e12, weapons: { pistol: { tier: 5 }, rifle: { tier: 5 }, uzi: { tier: 5 } } };
  const r = acceptJoinProfile(cheat, { name: 'Bob' });
  assert.equal(r.profile.name, 'Bob');
  assert.equal(r.profile.level, 20);
  assert.equal(r.profile.xp, MAX_XP);
  assert.ok(r.profile.scrap <= MAX_SCRAP);
  let sunk = 0;
  for (const [id, w] of Object.entries(r.profile.weapons)) sunk += tierSpent(id, w.tier);
  assert.ok(sunk + r.profile.scrap <= scrapBudget(20), 'scrap + tiers within the budget');
  // a level-1 with a mountain of scrap is trimmed hard
  const low = acceptJoinProfile({ ...createProfile({ name: 'A' }), scrap: 50000 }).profile;
  assert.equal(low.scrap, scrapBudget(1));
  assert.ok(acceptJoinProfile({ ...createProfile({ name: 'A' }), scrap: 50000 }).notes.includes('scrap trimmed to the level'));
  // an honest level-10 is untouched
  const honest = { ...createProfile({ name: 'A' }), xp: xpForLevel(10), level: 10, scrap: 800 };
  assert.equal(acceptJoinProfile(honest).profile.scrap, 800);
  assert.deepEqual(acceptJoinProfile(honest).notes, []);
  assert.equal(acceptJoinProfile('x').profile, null);
});

test('tiers beyond the budget are stepped down, highest first', () => {
  const p = { ...createProfile({ name: 'A' }), weapons: { pistol: { tier: 5 }, rifle: { tier: 5 } }, xp: 0 };
  const r = acceptJoinProfile(p).profile;
  let sunk = 0;
  for (const [id, w] of Object.entries(r.weapons)) sunk += tierSpent(id, w.tier);
  assert.ok(sunk <= scrapBudget(1));
  assert.ok(r.weapons.rifle.tier < 5);
});

test('names and cosmetics are cleaned; touchProfile bumps updatedAt', () => {
  assert.equal(cleanText('  a   b  '), 'a b');
  assert.equal(cleanText('​​'), 'Survivor');
  assert.equal(cleanText('x'.repeat(40), 16).length, 16);
  assert.equal(cleanText(42), 'Survivor');
  const c = sanitizeProfile({ ...createProfile({ name: 'A' }), cosmetics: { hat: 'cap', bad_key_: 1, 'Bad Key': 'x', n: 5, obj: {} } }).profile;
  assert.deepEqual(c.cosmetics, { hat: 'cap', bad_key_: 1, n: 5 });
  const t = touchProfile(createProfile({ name: 'A', now: 1 }), { scrap: 5 }, 99);
  assert.equal(t.updatedAt, 99);
  assert.equal(t.scrap, 5);
});

test('bot profiles scale with the level, are valid, and never persist anything', () => {
  for (const level of [1, 3, 7, 12, 20]) {
    const b = botStoryProfile({ name: 'Ripley', cls: 'medic', color: 2, level });
    assert.equal(b.level, level);
    const s = sanitizeProfile(b, { strict: true });
    assert.deepEqual(s.notes, [], `level ${level} valid`);
    assert.ok(b.loadout[0]);
  }
  const hi = botStoryProfile({ name: 'B', cls: 'soldier', color: 1, level: 15 });
  const lo = botStoryProfile({ name: 'B', cls: 'soldier', color: 1, level: 2 });
  assert.ok(Object.keys(hi.perks).length > Object.keys(lo.perks).length);
  assert.ok(Math.max(...Object.values(hi.weapons).map((w) => w.tier)) > 0);
});

// ---- world -----------------------------------------------------------------------------------

test('a new world: rev 0, roadhouse, a small stash, the founder as member', () => {
  const p = createProfile({ name: 'Ali' });
  const w = createWorld({ name: 'The Dusty Crew', difficulty: 'hard', profile: p, now: 1000 });
  assert.equal(w.v, 1);
  assert.ok(isId(w.id));
  assert.equal(w.rev, 0);
  assert.equal(w.difficulty, 'hard');
  assert.equal(w.progress.node, 'hideout:roadhouse');
  assert.equal(w.hideout.current, 'roadhouse');
  assert.ok(w.hideout.stash.scrap > 0);
  assert.equal(w.members[p.id].name, 'Ali');
  assert.deepEqual(validateWorld(w), { ok: true, notes: [] });
  assert.equal(createWorld({ difficulty: 'godlike' }).difficulty, 'normal');
  assert.equal(createWorld({ name: '' }).name, 'The Crew');
});

test('sanitizeWorld caps flags, members and stash and drops unknown ids', () => {
  const w = createWorld({ name: 'W' });
  const flags = {};
  for (let i = 0; i < 300; i++) flags[`flag_${i}`] = true;
  const members = {};
  for (let i = 0; i < 80; i++) members[`member-${String(i).padStart(4, '0')}`] = { name: `P${i}`, lastSeen: 1 };
  const r = sanitizeWorld({
    ...w,
    rev: 5,
    difficulty: 'nope',
    progress: { completed: { m1_1: { stars: 9, time: -3 }, '../x': { stars: 1 } }, flags: { ...flags, 'Bad Flag': true, 'x': false } },
    hideout: {
      current: 'moon', upgrades: { garden: 9, moat: 3, radio: 2 }, recruited: { priya: true, 'BAD': true },
      stash: { scrap: 1e9, parts: -4, sword: 3 },
    },
    members,
  });
  assert.ok(r.world);
  const s = r.world;
  assert.equal(s.rev, 5);
  assert.equal(s.difficulty, 'normal');
  assert.deepEqual(s.progress.completed, { m1_1: { stars: 3, time: 0 } });
  assert.equal(Object.keys(s.progress.flags).length, MAX_FLAGS);
  assert.equal(s.hideout.current, 'roadhouse');
  assert.deepEqual(s.hideout.upgrades, { garden: 3, radio: 2 });
  assert.deepEqual(s.hideout.recruited, { priya: true });
  assert.equal(s.hideout.stash.scrap, 9999);
  assert.equal(s.hideout.stash.parts, 0);
  assert.equal(s.hideout.stash.sword, undefined);
  assert.equal(Object.keys(s.members).length, MAX_MEMBERS);
  assert.equal(sanitizeWorld(null).world, null);
  assert.equal(sanitizeWorld({ name: 'no id' }).world, null);
  assert.equal(sanitizeWorld({ id: 'short' }).world, null);
  // a world stays small enough for one control message
  const big = sanitizeWorld({ ...w, progress: { flags }, members }).world;
  assert.ok(JSON.stringify(big).length < 8000, `world is ${JSON.stringify(big).length} bytes`);
});

test('changeWorld bumps the revision without touching the original', () => {
  const w = createWorld({ name: 'W', now: 10 });
  const c = changeWorld(w, (d) => {
    d.hideout.stash.scrap += 5;
    d.progress.flags.met_mara = true;
  }, 50);
  assert.equal(c.rev, 1);
  assert.equal(c.updatedAt, 50);
  assert.equal(c.hideout.stash.scrap, w.hideout.stash.scrap + 5);
  assert.equal(w.rev, 0);
  assert.equal(w.hideout.stash.scrap, 40);
  assert.equal(changeWorld(c, () => {}, 1).updatedAt, 50, 'the clock never goes back');
});

test('pickHighest: the higher rev wins, then the later save, and worlds never mix', () => {
  const a = createWorld({ name: 'A', now: 1 });
  const b = changeWorld(a, () => {}, 2);
  assert.equal(pickHighest(a, b), b);
  assert.equal(pickHighest(b, a), b);
  const c = { ...a, updatedAt: 500 };
  assert.equal(pickHighest(a, c), c, 'same rev: later updatedAt');
  assert.equal(pickHighest(c, a), c);
  assert.equal(pickHighest(a, { ...a }), a, 'a tie keeps the first');
  assert.equal(pickHighest(null, b), b);
  assert.equal(pickHighest(a, null), a);
  assert.equal(pickHighest(null, null), null);
  const other = createWorld({ name: 'Other' });
  assert.equal(pickHighest(a, other), a);
});

test('members: touching adds or refreshes, capped', () => {
  const w = createWorld({ name: 'W' });
  const p = createProfile({ name: 'Nova' });
  const t = touchMember(w, p, 77);
  assert.equal(isMember(t, p.id), true);
  assert.equal(isMember(w, p.id), false);
  assert.deepEqual(t.members[p.id], { name: 'Nova', lastSeen: 77 });
  assert.equal(t.rev, 1);
  const renamed = touchMember(t, { ...p, name: 'Nova2' }, 90);
  assert.equal(renamed.members[p.id].name, 'Nova2');
  assert.equal(Object.keys(renamed.members).length, 1);
  assert.equal(isMember(w, '__proto__'), false);
});

test('mission progress follows the chain and the chapters', () => {
  setStoryContent(STUB_CONTENT);
  try {
    const missions = getMissions();
    assert.deepEqual(missions.map((m) => m.id), ['m1_1', 'm1_2', 'm1_3', 'm2_1', 'm3_1']);
    let w = createWorld({ name: 'W' });
    assert.deepEqual(missionBoard(w, missions).map((e) => e.status), ['available', 'locked', 'locked', 'locked', 'locked']);
    assert.deepEqual(availableMissions(w, missions).map((m) => m.id), ['m1_1']);
    assert.equal(nextMission(w, missions).id, 'm1_1');
    assert.equal(currentChapter(w, missions), 1);
    const done = (id, stars = 2) => changeWorld(w, (d) => { d.progress.completed[id] = { stars, time: 100 }; });
    w = done('m1_1');
    assert.deepEqual(availableMissions(w, missions).map((m) => m.id), ['m1_1', 'm1_2']);
    assert.equal(missionBoard(w, missions)[0].stars, 2);
    w = done('m1_2');
    w = done('m1_3');
    assert.equal(chapterDone(w, missions, 1), true);
    assert.equal(chapterDone(w, missions, 2), false);
    assert.equal(hideoutFor(w, missions), 'roadhouse');
    assert.equal(currentChapter(w, missions), 2);
    w = done('m2_1');
    assert.equal(hideoutFor(w, missions), 'roadhouse', 'chapter 2 rests at the roadhouse again');
    w = done('m3_1');
    assert.equal(hideoutFor(w, missions), 'depot');
    assert.equal(campaignDone(w, missions), true);
    assert.equal(nextMission(w, missions), null);
    // explicit prerequisites override the chain
    const gated = { id: 'x', chapter: 9, index: 1, requires: ['m1_2'] };
    assert.equal(missionStatus(createWorld({ name: 'W' }), [...missions, gated], gated), 'locked');
    assert.equal(missionStatus(w, [...missions, gated], gated), 'available');
    const sum = worldSummary(w, missions);
    assert.equal(sum.missionsDone, 5);
    assert.equal(sum.missionsTotal, 5);
    assert.equal(sum.stars, 10);
    assert.equal(sum.complete, true);
    assert.equal(sum.chapter, 3);
    assert.equal(worldSummary(createWorld({ name: 'W' }), missions).next.id, 'm1_1');
  } finally {
    clearStoryContent();
  }
});
