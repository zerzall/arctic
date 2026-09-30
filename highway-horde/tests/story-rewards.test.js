// Story layer: mission results → rewards, and saving (shared/story/{rewards,save}.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleMission, clampStars, DIFFICULTY_SCRAP } from '../public/js/shared/story/rewards.js';
import { createProfile, sanitizeProfile } from '../public/js/shared/story/profile.js';
import { createWorld, changeWorld, isCompleted, validateWorld } from '../public/js/shared/story/world.js';
import { xpForLevel, KILL_XP, DIFFICULTY_XP } from '../public/js/shared/story/progression.js';
import { setStoryContent, clearStoryContent, getMission, getMissions } from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';
import {
  PROFILE_KEY, WORLDS_KEY, loadProfile, saveProfile, loadWorlds, saveWorld, deleteWorld, listWorlds, exportSave,
  exportFileName, parseSave, importParsed, migrateProfile, migrateWorld, MAX_WORLDS, MAX_IMPORT_BYTES, FILE_FORMAT,
} from '../public/js/shared/story/save.js';

function withContent(fn) {
  return () => {
    setStoryContent(STUB_CONTENT);
    try {
      return fn();
    } finally {
      clearStoryContent();
    }
  };
}

const win = (stars, stats = {}, time = 200) => ({ result: 'victory', stars, stats, time });

test('stars are 1-3 on a win and 0 on a defeat', () => {
  assert.equal(clampStars(2, true), 2);
  assert.equal(clampStars(9, true), 3);
  assert.equal(clampStars(0, true), 1);
  assert.equal(clampStars(undefined, true), 1);
  assert.equal(clampStars('x', true), 1);
  assert.equal(clampStars(3, false), 0);
});

test('a first clear pays XP, scrap and the gun, raises the world and records the stars', withContent(() => {
  const p = createProfile({ name: 'A', cls: 'soldier' });
  const world = createWorld({ name: 'W', profile: p, now: 5 });
  const m = getMission('m1_1');
  const r = settleMission({
    world, mission: m, result: win(2, { 1: { kills: 30, kinds: { walker: 20, runner: 10 }, objectives: 1, revives: 1 } }),
    party: [{ pid: 1, profile: p }], now: 100,
  });
  assert.equal(r.victory, true);
  assert.equal(r.stars, 2);
  assert.equal(r.firstClear, true);
  assert.equal(r.replay, false);
  const pr = r.players[1];
  // fight XP + mission XP + one extra star, no catch-up at the recommended level
  const fight = 20 * KILL_XP.walker + 10 * KILL_XP.runner + 20 + 15;
  const base = 180;
  assert.equal(pr.delta.xp, fight + base + Math.round(base * 0.1));
  assert.equal(pr.profile.xp, pr.delta.xp);
  assert.equal(pr.delta.levelBefore, 1);
  assert.ok(pr.delta.levelAfter > 1);
  assert.deepEqual(pr.delta.levelUps, Array.from({ length: pr.delta.levelAfter - 1 }, (_, i) => i + 2));
  assert.equal(pr.profile.perkPoints, pr.delta.levelAfter - 1);
  assert.equal(pr.delta.scrap, Math.round(70 * 1.05));
  assert.equal(pr.profile.scrap, pr.delta.scrap);
  assert.equal(pr.delta.weapon, 'shotgun');
  assert.deepEqual(pr.profile.weapons.shotgun, { tier: 0 });
  assert.equal(pr.profile.stats.kills, 30);
  assert.equal(pr.profile.stats.missions, 1);
  assert.equal(pr.profile.stats.revives, 1);
  assert.equal(pr.profile.stats.playtime, 200);
  assert.deepEqual(pr.profile.kit, {});
  assert.equal(pr.profile.updatedAt, 100);
  assert.deepEqual(pr.breakdown.map((b) => b.label), ['Kills & objectives', 'Mission', '2 stars']);
  assert.equal(pr.breakdown.reduce((a, b) => a + b.xp, 0), pr.delta.xp);
  assert.deepEqual(sanitizeProfile(pr.profile).notes, [], 'the new profile is valid');
  // the world
  const w = r.world;
  assert.equal(w.rev, world.rev + 1, 'one change, one revision');
  assert.deepEqual(w.progress.completed.m1_1, { stars: 2, time: 200 });
  assert.equal(w.progress.flags.bus_running, true);
  assert.equal(w.hideout.stash.parts, 1);
  assert.equal(w.hideout.stash.scrap, 40 + Math.round(70 * 0.5));
  assert.equal(r.stash.parts, 1);
  assert.equal(r.unlocks.weapon, 'shotgun');
  assert.deepEqual(r.unlocks.flags, ['bus_running']);
  assert.equal(r.unlocks.hideout, null);
  assert.equal(validateWorld(w).ok, true);
  assert.equal(w.members[p.id].name, 'A');
  assert.equal(world.rev, 0, 'input untouched');
  assert.equal(isCompleted(world, 'm1_1'), false);
}));

test('difficulty scales XP and scrap; a replay pays half and gives no one-time rewards', withContent(() => {
  const p = createProfile({ name: 'A' });
  const m = getMission('m1_1');
  const stats = { 1: { kills: 10 } };
  const at = (difficulty) => settleMission({ world: createWorld({ name: 'W', difficulty }), mission: m, result: win(1, stats), party: [{ pid: 1, profile: p }] });
  const easy = at('easy').players[1].delta, normal = at('normal').players[1].delta, nightmare = at('nightmare').players[1].delta;
  assert.ok(easy.xp < normal.xp && normal.xp < nightmare.xp);
  assert.equal(normal.xp, 10 * KILL_XP.walker + 180);
  assert.equal(easy.xp, Math.round((10 * KILL_XP.walker) * DIFFICULTY_XP.easy) + Math.round(180 * DIFFICULTY_XP.easy));
  assert.equal(normal.scrap, 70);
  assert.equal(nightmare.scrap, Math.round(70 * DIFFICULTY_SCRAP.nightmare));
  // the same mission again
  const world = createWorld({ name: 'W' });
  const first = settleMission({ world, mission: m, result: win(2, stats, 300), party: [{ pid: 1, profile: p }] });
  const again = settleMission({ world: first.world, mission: m, result: win(3, stats, 250), party: [{ pid: 1, profile: first.players[1].profile }] });
  assert.equal(again.firstClear, false);
  assert.equal(again.replay, true);
  const half = again.players[1].delta;
  assert.ok(half.xp < normal.xp * 0.75, `replay xp ${half.xp} is about half`);
  assert.equal(half.weapon, null);
  assert.equal(again.stash.parts, undefined, 'no parts the second time');
  assert.deepEqual(again.unlocks.flags, []);
  // the better result is kept
  assert.deepEqual(again.world.progress.completed.m1_1, { stars: 3, time: 250 });
  const worse = settleMission({ world: again.world, mission: m, result: win(1, stats, 900), party: [{ pid: 1, profile: p }] });
  assert.deepEqual(worse.world.progress.completed.m1_1, { stars: 3, time: 250 });
}));

test('catch-up: a survivor below the mission level earns more, perks and the garden pay scrap', withContent(() => {
  const m = getMission('m3_1'); // recommended level 6
  const low = createProfile({ name: 'Low' });
  const high = { ...createProfile({ name: 'High' }), xp: xpForLevel(8), level: 8 };
  const world = createWorld({ name: 'W' });
  const res = settleMission({ world, mission: m, result: win(1), party: [{ pid: 1, profile: low }, { pid: 2, profile: high }] });
  assert.equal(res.players[2].delta.xp, 520);
  assert.equal(res.players[1].delta.xp, Math.round(520 * 1.5));
  // scavenger rank 3 and a tier-3 garden
  const scav = { ...createProfile({ name: 'S' }), xp: xpForLevel(8), level: 8, perks: { scavenger: 3 } };
  const rich = changeWorld(world, (w) => { w.hideout.upgrades.garden = 3; });
  const paid = settleMission({ world: rich, mission: m, result: win(1), party: [{ pid: 1, profile: scav }] });
  assert.equal(paid.players[1].delta.scrap, Math.round(160 * 1.35 * 1.25));
  assert.equal(paid.world.hideout.stash.medkit, 2 + 3, 'the garden adds supplies to the stash');
  assert.equal(paid.world.hideout.stash.frag, 4 + 1);
  assert.equal(paid.world.hideout.stash.armor, 2 + 1);
  // radio XP bonus
  const radio = changeWorld(world, (w) => { w.hideout.upgrades.radio = 3; });
  const xpBoost = settleMission({ world: radio, mission: m, result: win(1), party: [{ pid: 2, profile: high }] });
  assert.equal(xpBoost.players[2].delta.xp, Math.round(520 * 1.06));
}));

test('a defeat pays half the fighting XP, no scrap and no progress; bots earn nothing', withContent(() => {
  const p = createProfile({ name: 'A' });
  const world = createWorld({ name: 'W' });
  const r = settleMission({
    world, mission: getMission('m1_1'),
    result: { result: 'defeat', stars: 3, stats: { 1: { kills: 40, downs: 3 }, 2: { kills: 99 } } },
    party: [{ pid: 1, profile: p }, { pid: 2, profile: createProfile({ name: 'Bot' }), human: false }],
  });
  assert.equal(r.victory, false);
  assert.equal(r.stars, 0);
  assert.equal(r.world, world, 'the world is untouched');
  assert.equal(r.players[1].delta.xp, 40 * KILL_XP.walker * 0.5);
  assert.equal(r.players[1].delta.scrap, 0);
  assert.equal(r.players[1].profile.stats.missions, 0);
  assert.equal(r.players[1].profile.stats.deaths, 3);
  assert.equal(r.players[1].delta.weapon, null);
  assert.equal(r.players[2], undefined);
  assert.equal(r.players[1].profile.weapons.shotgun, undefined);
  // supplies are kept for the retry
  const kitted = settleMission({
    world, mission: getMission('m1_1'), result: { result: 'defeat', stats: {} },
    party: [{ pid: 1, profile: { ...p, kit: { frag: 2 } } }],
  });
  assert.deepEqual(kitted.players[1].profile.kit, { frag: 2 });
}));

test('finishing a chapter moves the crew to the next hideout and flags the arrival', withContent(() => {
  const missions = getMissions();
  const p = createProfile({ name: 'A' });
  let world = createWorld({ name: 'W' });
  const complete = (ids) => {
    world = changeWorld(world, (w) => { for (const id of ids) w.progress.completed[id] = { stars: 1, time: 1 }; });
  };
  complete(['m1_1', 'm1_2', 'm2_1']);
  // m1_3 finishes chapter 1: still the roadhouse, and m2_1 is next
  let r = settleMission({ world, mission: getMission('m1_3'), result: win(1), party: [{ pid: 1, profile: p }], missions });
  assert.equal(r.unlocks.chapterDone, true);
  assert.equal(r.unlocks.hideout, null);
  assert.deepEqual(r.unlocks.next, { kind: 'hideout', hideout: 'roadhouse' });
  assert.equal(r.unlocks.npc, 'priya');
  assert.equal(r.world.hideout.recruited.priya, true);
  assert.equal(r.world.progress.flags.beacon_lit, true);
  // chapter 3 done: the depot
  complete(['m1_3']);
  r = settleMission({ world, mission: getMission('m3_1'), result: win(1), party: [{ pid: 1, profile: p }], missions });
  assert.equal(r.unlocks.hideout, 'depot');
  assert.deepEqual(r.unlocks.next, { kind: 'hideout', hideout: 'depot', arrival: true });
  assert.equal(r.world.hideout.current, 'depot');
  assert.equal(r.world.progress.node, 'hideout:depot');
  assert.equal(r.world.day, 42, 'a first win is a day on the road');
  assert.equal(validateWorld(r.world).ok, true);
}));

test('the party is arbitrary: two humans each get their own delta', withContent(() => {
  const a = createProfile({ name: 'A' });
  const b = { ...createProfile({ name: 'B' }), xp: xpForLevel(9), level: 9, perkPoints: 3 };
  const r = settleMission({
    world: createWorld({ name: 'W' }), mission: getMission('m1_2'), result: win(3, { 4: { kills: 5 }, 7: { kills: 50 } }),
    party: [{ pid: 4, profile: a }, { pid: 7, profile: b }],
  });
  assert.ok(r.players[7].delta.xp > r.players[4].delta.xp);
  assert.equal(r.players[7].profile.perkPoints, 3 + r.players[7].delta.perkPoints);
  assert.equal(r.players[4].profile.id, a.id);
  assert.equal(r.players[7].profile.id, b.id);
}));

// ---- saving ------------------------------------------------------------------------------------

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

const throwing = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
  removeItem() { throw new Error('denied'); },
};

test('save: the profile round-trips, garbage in storage loads as nothing, blocked storage never throws', () => {
  const s = fakeStorage();
  assert.equal(loadProfile(s), null);
  const p = { ...createProfile({ name: 'Ali', cls: 'medic' }), scrap: 12 };
  assert.equal(saveProfile(p, s), true);
  assert.ok(s.data[PROFILE_KEY]);
  assert.deepEqual(loadProfile(s), p);
  assert.equal(saveProfile({ ...p, v: 2 }, s), false, 'unknown versions are not written');
  s.data[PROFILE_KEY] = '{not json';
  assert.equal(loadProfile(s), null);
  s.data[PROFILE_KEY] = JSON.stringify({ ...p, xp: 1e12, scrap: 'lots', weapons: { pistol: { tier: 99 } } });
  const fixed = loadProfile(s);
  assert.equal(fixed.level, 20);
  assert.equal(fixed.weapons.pistol.tier, 5);
  assert.equal(fixed.scrap, 0);
  // blocked storage
  assert.equal(loadProfile(throwing), null);
  assert.equal(saveProfile(p, throwing), false);
  assert.deepEqual(loadWorlds(throwing), {});
  assert.equal(saveWorld(createWorld({ name: 'W' }), throwing).saved, false);
  assert.equal(deleteWorld('x', throwing), false);
});

test('save: worlds keep the higher revision and never lose to a stale copy', () => {
  const s = fakeStorage();
  const w0 = createWorld({ name: 'Crew', now: 1 });
  const w1 = changeWorld(w0, (d) => { d.hideout.stash.scrap = 99; }, 2);
  const w2 = changeWorld(w1, (d) => { d.hideout.stash.scrap = 150; }, 3);
  assert.equal(saveWorld(w1, s).saved, true);
  assert.equal(saveWorld(w0, s).saved, false, 'a stale copy is ignored');
  assert.equal(loadWorlds(s)[w0.id].rev, 1);
  const r = saveWorld(w2, s);
  assert.equal(r.saved, true);
  assert.equal(r.world.rev, 2);
  assert.equal(loadWorlds(s)[w0.id].hideout.stash.scrap, 150);
  // two worlds, most recent first
  const other = createWorld({ name: 'Other', now: 50 });
  saveWorld(other, s);
  assert.deepEqual(listWorlds(s).map((w) => w.name), ['Other', 'Crew']);
  assert.equal(deleteWorld(other.id, s), true);
  assert.equal(deleteWorld(other.id, s), false);
  assert.deepEqual(Object.keys(loadWorlds(s)), [w0.id]);
  // garbage entries are skipped; an entry stored under the wrong id too
  s.data[WORLDS_KEY] = JSON.stringify({ [w0.id]: w2, bad: { id: 'x' }, other: { ...other } });
  assert.deepEqual(Object.keys(loadWorlds(s)), [w0.id]);
});

test('save: at most MAX_WORLDS worlds are kept, the oldest fall off', () => {
  const s = fakeStorage();
  const worlds = [];
  for (let i = 0; i < MAX_WORLDS + 3; i++) {
    const w = createWorld({ name: `W${i}`, now: 1000 + i });
    worlds.push(w);
    saveWorld(w, s);
  }
  const kept = loadWorlds(s);
  assert.equal(Object.keys(kept).length, MAX_WORLDS);
  assert.equal(kept[worlds[0].id], undefined);
  assert.ok(kept[worlds[worlds.length - 1].id]);
});

test('export and import: a file round-trips, validates and merges by revision', () => {
  const p = { ...createProfile({ name: 'Ali' }), xp: xpForLevel(4), level: 4, perkPoints: 3, scrap: 55 };
  const w = changeWorld(createWorld({ name: 'The Crew', profile: p }), (d) => { d.progress.flags.met_mara = true; });
  const text = exportSave({ profile: p, worlds: [w], now: Date.UTC(2026, 8, 30) });
  const file = JSON.parse(text);
  assert.equal(file.format, FILE_FORMAT);
  assert.equal(file.fileVersion, 1);
  assert.equal(exportFileName('The Crew!', Date.UTC(2026, 8, 30)), 'road-to-haven-the-crew-20260930.json');
  assert.equal(exportFileName('', 0), 'road-to-haven-save-19700101.json');

  const parsed = parseSave(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.profile, p);
  assert.equal(parsed.worlds.length, 1);
  assert.deepEqual(parsed.worlds[0], w);
  assert.deepEqual(parsed.notes, []);

  // into an empty browser
  const s = fakeStorage();
  const imp = importParsed(parsed, {}, s);
  assert.equal(imp.profileReplaced, true);
  assert.deepEqual(loadProfile(s), p);
  assert.equal(imp.newer, 1);
  assert.deepEqual(loadWorlds(s)[w.id], w);
  // importing the same file again changes nothing
  const again = importParsed(parsed, {}, s);
  assert.equal(again.profileReplaced, false);
  assert.equal(again.newer, 0);
  assert.equal(again.kept, 1);
  // a different survivor's profile does not replace the browser's unless asked
  const other = { ...createProfile({ name: 'Other' }), xp: 500 };
  const p2 = parseSave(exportSave({ profile: other }));
  assert.equal(importParsed(p2, {}, s).profileReplaced, false);
  assert.equal(loadProfile(s).id, p.id);
  assert.equal(importParsed(p2, { replaceProfile: true }, s).profileReplaced, true);
  assert.equal(loadProfile(s).id, other.id);
  // an older copy of a world loses, a newer one wins
  const older = parseSave(exportSave({ worlds: [createWorld({ id: w.id, name: 'Stale', now: 1 })] }));
  const before = loadWorlds(s)[w.id];
  assert.equal(importParsed(older, {}, s).newer, 0);
  assert.equal(loadWorlds(s)[w.id].name, before.name);
  const newer = changeWorld(w, (d) => { d.hideout.stash.scrap = 777; });
  importParsed(parseSave(exportSave({ worlds: [newer] })), {}, s);
  assert.equal(loadWorlds(s)[w.id].hideout.stash.scrap, 777);
});

test('import: bad files are refused with a message, cheats are repaired', () => {
  for (const bad of ['', '   ', 'not json', '[]', '"x"', '{}', '{"format":"other"}', '{"profile":null,"worlds":{}}']) {
    const r = parseSave(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.error.length > 5);
  }
  assert.equal(parseSave('x'.repeat(MAX_IMPORT_BYTES + 1)).ok, false);
  assert.equal(parseSave(null).ok, false);
  const p = createProfile({ name: 'Cheat' });
  const r = parseSave(JSON.stringify({ format: FILE_FORMAT, fileVersion: 1, profile: { ...p, xp: 1e15, weapons: { pistol: { tier: 50 }, gun9000: { tier: 1 } } }, worlds: { junk: 5 } }));
  assert.equal(r.ok, true);
  assert.equal(r.profile.level, 20);
  assert.equal(r.profile.weapons.pistol.tier, 5);
  assert.equal(r.profile.weapons.gun9000, undefined);
  assert.ok(r.notes.some((n) => /unknown weapon/.test(n)));
  assert.ok(r.notes.includes('a world could not be read'));
  // a file from the future is read with a note
  const fut = parseSave(JSON.stringify({ format: FILE_FORMAT, fileVersion: 9, profile: p }));
  assert.equal(fut.ok, true);
  assert.ok(fut.notes.some((n) => /newer version/.test(n)));
  // a bare profile or world (hand-made file) is accepted
  assert.equal(parseSave(JSON.stringify(p)).profile.id, p.id);
  const w = createWorld({ name: 'Bare' });
  assert.equal(parseSave(JSON.stringify(w)).worlds[0].id, w.id);
});

test('migrations: version-0 profiles and worlds are upgraded', () => {
  const old = {
    name: 'Oldtimer', callsign: 'X', xp: 1000, cls: 'medic', perks: ['steady', 'steady', 'quick'], weapons: ['pistol', 'uzi'],
    parts: 40,
  };
  const m = migrateProfile(old);
  assert.equal(m.v, 1);
  assert.deepEqual(m.perks, { steady: 2, quick: 1 });
  assert.deepEqual(m.weapons, { pistol: { tier: 0 }, uzi: { tier: 0 } });
  assert.equal(m.scrap, 40);
  const s = fakeStorage({ [PROFILE_KEY]: JSON.stringify(old) });
  const loaded = loadProfile(s);
  assert.equal(loaded.name, 'Oldtimer');
  assert.equal(loaded.level, 5);
  assert.deepEqual(loaded.perks, { steady: 2, quick: 1 });
  assert.equal(loaded.scrap, 40);
  assert.deepEqual(validateWorldish(loaded), []);

  const id = 'abcdef123456abcdef123456abcdef12';
  const oldWorld = { id, name: 'Old Crew', missions: ['m1_1', 'm1_2'], flags: { met_mara: true }, upgrades: { garden: 1 }, stash: { scrap: 30 } };
  const mw = migrateWorld(oldWorld);
  assert.equal(mw.v, 1);
  assert.deepEqual(Object.keys(mw.progress.completed), ['m1_1', 'm1_2']);
  const s2 = fakeStorage({ [WORLDS_KEY]: JSON.stringify({ [id]: oldWorld }) });
  const w = loadWorlds(s2)[id];
  assert.equal(w.name, 'Old Crew');
  assert.equal(w.hideout.upgrades.garden, 1);
  assert.equal(w.hideout.stash.scrap, 30);
  assert.equal(w.progress.flags.met_mara, true);
  assert.equal(w.rev, 0);
  // the current versions pass through untouched
  const cur = createProfile({ name: 'N' });
  assert.equal(migrateProfile(cur), cur);
  assert.equal(migrateProfile(null), null);
});

function validateWorldish(profile) {
  return sanitizeProfile(profile).notes;
}
