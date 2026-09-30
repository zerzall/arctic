// ROAD TO HAVEN narrative data (shared/story/*): schema of the fifteen missions against STORY.md
// §5.4, anchors against §5.2, cast references, the unlock graph, XP/scrap/level sanity, gradual
// introduction of the zombie specials, text limits and lore notes. Pure data: fast.
//
// When the mission executor's own validator (shared/story/validate.js, agent S2) is merged, the last
// test also runs every mission through it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as story from '../public/js/shared/story/index.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { ZOMBIES, ZOMBIE_IDS } from '../public/js/shared/zombies.js';
import { CLASS_IDS } from '../public/js/shared/classes.js';

const { CAST, MISSIONS, CHAPTERS, DIALOGUE, TIPS, NOTES, HIDEOUTS, mission, nextNodes } = story;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- the contract, restated here so the test does not just check the data against itself -----------
const ORDER = ['m1_1', 'm1_2', 'm1_3', 'm2_1', 'm2_2', 'm2_3', 'm3_1', 'm3_2', 'm4_1', 'm4_2', 'm4_3', 'm5_1', 'm5_2', 'm6_1', 'm6_2'];
const TITLES = {
  m1_1: 'Pileup', m1_2: 'Fuel Run', m1_3: 'Beacon', m2_1: 'Diner Siege', m2_2: 'Radio Parts', m2_3: 'Night Hauler',
  m3_1: 'The Crossing', m3_2: 'Sunken Cargo', m4_1: 'Hold the Tower', m4_2: 'Broken Line', m4_3: 'Ghosts',
  m5_1: 'Down the Interstate', m5_2: 'Field Hospital', m6_1: 'Last Stand', m6_2: 'The Tower',
};
const CHAPTER_TITLES = ['Dead Highway', 'Last Chance', 'Blackwater', 'Delta', 'Harlan County', 'Haven'];
const CHAPTER_MAPS = ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan', 'harlan'];
// STORY.md §5.2
const ANCHORS = {
  highway: ['bus', 'crossroadsW', 'crossroadsE', 'gasStation', 'overpass', 'westEnd', 'eastEnd', 'motel', 'diner'],
  truckstop: ['diner', 'pumps', 'truckLot', 'motelRow', 'roadNorth', 'roadSouth', 'trailerA', 'trailerB', 'trailerC'],
  bridge: ['apc', 'bankW', 'bankE', 'deckMid', 'cargoA', 'cargoB', 'cargoC'],
  checkpoint: ['tower', 'gate', 'compound', 'genA', 'genB', 'genC', 'hill'],
  harlan: ['mainStreet', 'gasNGo', 'haskellFarm', 'stJudes', 'fieldHospital', 'i70Interchange', 'millerQuarry', 'radioHill',
    'shadyPines', 'lakeMarina', 'ridgeHill', 'breakout', 'towerDoor', 'roof', 'zipStart', 'landing'],
};
const OBJECTIVE_ANCHOR = { highway: 'bus', truckstop: 'diner', bridge: 'apc', checkpoint: 'tower' }; // defend targets
const STEP_TYPES = ['defend', 'waves', 'survive', 'collect', 'reach', 'activate', 'escort', 'kill', 'boss', 'evac', 'campaignStage', 'wait', 'dialogue'];
const MODES = ['defend', 'zone', 'campaign', 'free'];
const ITEMS = ['note', 'fuel', 'battery', 'part', 'crate', 'pump', 'medkit', 'tag', 'player'];
const STAGES = ['hill', 'breakout', 'tower', 'roof', 'zip'];
const TOKENS = ['day', 'crew', 'scrap'];
const HEX = /^#[0-9a-fA-F]{6}$/;

// keys a step may carry: the common ones, then the per-type parameters
const COMMON = ['id', 'type', 'text', 'parallel', 'pressure', 'onStart', 'onDone', 'since', 'flags', 'todo'];
const PARAMS = {
  defend: ['target', 'waves'], waves: ['count', 'pace'], survive: ['seconds'], collect: ['item', 'count', 'at', 'note'],
  reach: ['at', 'hold'], activate: ['at', 'hold', 'effect', 'lure', 'blast'], escort: ['npc', 'route'], kill: ['zombie', 'count', 'at'],
  boss: ['zombie'], evac: ['stops'], campaignStage: ['stage', 'waves'], wait: ['seconds'], dialogue: ['lines'],
};

const SPEAKERS = Object.keys(CAST);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isInt = (n) => Number.isInteger(n);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0 && s === s.trim();
const sentences = (s) => (s.match(/[.!?]+(\s|$)/g) || []).length;

/** Every string in a data tree, with its path. */
function* strings(o, p = '') {
  if (typeof o === 'string') yield [p, o];
  else if (Array.isArray(o)) for (let i = 0; i < o.length; i++) yield* strings(o[i], `${p}[${i}]`);
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) yield* strings(o[k], `${p}.${k}`);
}

/** Every dialogue line ({ who, text }) hiding in a data tree, with its path. */
function* dialogueLines(o, p = '') {
  if (Array.isArray(o)) for (let i = 0; i < o.length; i++) yield* dialogueLines(o[i], `${p}[${i}]`);
  else if (o && typeof o === 'object') {
    if (typeof o.who === 'string' && typeof o.text === 'string') yield [p, o];
    else for (const k of Object.keys(o)) yield* dialogueLines(o[k], `${p}.${k}`);
  }
}

function checkLines(lines, where, { min = 1, max = 99 } = {}) {
  assert.ok(Array.isArray(lines), `${where}: lines is an array`);
  assert.ok(lines.length >= min && lines.length <= max, `${where}: ${lines.length} lines, want ${min}-${max}`);
  lines.forEach((l, i) => {
    assert.ok(SPEAKERS.includes(l.who), `${where}[${i}]: speaker '${l.who}' is not in the cast`);
    assert.ok(nonEmpty(l.text), `${where}[${i}]: text is empty`);
    assert.ok(l.text.length <= 200, `${where}[${i}]: ${l.text.length} chars > 200`);
  });
}

function checkRadio(list, where) {
  assert.ok(Array.isArray(list), `${where}: array of radio/say lines`);
  list.forEach((l, i) => {
    assert.ok(l.type === 'radio' || l.type === 'say', `${where}[${i}]: type radio|say`);
    assert.ok(SPEAKERS.includes(l.who), `${where}[${i}]: speaker '${l.who}' is not in the cast`);
    assert.ok(nonEmpty(l.text), `${where}[${i}]: empty text`);
    assert.ok(l.text.length <= 140, `${where}[${i}]: ${l.text.length} chars > 140: ${l.text}`);
    if (l.ms !== undefined) assert.ok(isNum(l.ms) && l.ms >= 800 && l.ms <= 15000, `${where}[${i}]: ms 800..15000`);
    assert.deepEqual(Object.keys(l).filter((k) => !['type', 'who', 'text', 'ms'].includes(k)), [], `${where}[${i}]: unknown keys`);
  });
}

/** Local mirror of STORY.md §5.4 for one step. `known` = ids of all zombies. */
function checkStep(m, s, where) {
  assert.ok(nonEmpty(s.id), `${where}: id`);
  assert.ok(STEP_TYPES.includes(s.type), `${where}: unknown step type '${s.type}'`);
  const allowed = new Set([...COMMON, ...PARAMS[s.type]]);
  for (const k of Object.keys(s)) assert.ok(allowed.has(k), `${where}: unknown param '${k}' on a '${s.type}' step`);
  const A = ANCHORS[m.map];
  const anchor = (a, w) => assert.ok(A.includes(a), `${where}: anchor '${a}' is not in the ${m.map} vocabulary (${w})`);
  const anchors = (arr, w) => { assert.ok(Array.isArray(arr) && arr.length > 0, `${where}: ${w} needs anchors`); arr.forEach((a) => anchor(a, w)); };
  switch (s.type) {
    case 'defend':
      anchor(s.target, 'target');
      assert.equal(s.target, OBJECTIVE_ANCHOR[m.map], `${where}: defend target is the map's objective`);
      assert.ok(isInt(s.waves) && s.waves >= 1 && s.waves <= 6, `${where}: waves`);
      break;
    case 'waves':
      assert.ok(isInt(s.count) && s.count >= 1, `${where}: count`);
      assert.ok(isNum(s.pace) && s.pace > 0, `${where}: pace`);
      break;
    case 'survive':
      assert.ok(isNum(s.seconds) && s.seconds >= 15 && s.seconds <= 240, `${where}: seconds 15..240`);
      break;
    case 'collect':
      assert.ok(ITEMS.includes(s.item), `${where}: item '${s.item}'`);
      assert.ok(isInt(s.count) && s.count >= 1 && s.count <= 8, `${where}: count`);
      anchors(s.at, 'at');
      if (s.item === 'note') assert.ok(NOTES[s.note], `${where}: note '${s.note}' exists`);
      else assert.equal(s.note, undefined, `${where}: only notes carry note:`);
      break;
    case 'reach':
      anchor(s.at, 'at');
      if (s.hold !== undefined) assert.ok(isNum(s.hold) && s.hold > 0 && s.hold <= 90, `${where}: hold`);
      break;
    case 'activate':
      anchors(s.at, 'at');
      assert.ok(isNum(s.hold) && s.hold > 0 && s.hold <= 30, `${where}: hold 0..30`);
      if (s.effect) assert.ok(['lure', 'explode'].includes(s.effect), `${where}: effect`);
      if (s.effect === 'lure') { anchor(s.lure.to, 'lure.to'); assert.ok(s.lure.seconds > 0 && /lure/.test(s.todo), `${where}: lure needs a todo`); }
      if (s.effect === 'explode') { anchor(s.blast.at, 'blast.at'); assert.ok(s.blast.r > 0 && s.blast.damage > 0 && /explode/.test(s.todo), `${where}: explode needs a todo`); }
      break;
    case 'escort':
      assert.ok(SPEAKERS.includes(s.npc) && !CAST[s.npc].system && !CAST[s.npc].radioOnly, `${where}: escort npc '${s.npc}' has a body`);
      assert.ok(Array.isArray(s.route) && s.route.length >= 2, `${where}: route`);
      s.route.forEach((a) => anchor(a, 'route'));
      break;
    case 'kill':
      assert.ok(ZOMBIE_IDS.includes(s.zombie), `${where}: zombie '${s.zombie}'`);
      assert.ok(isInt(s.count) && s.count >= 1 && s.count <= 12, `${where}: count`);
      if (s.at !== undefined) anchor(s.at, 'at');
      assert.ok(/zombieKey/.test(s.todo || ''), `${where}: kill uses zombie: (todo zombieKey)`);
      break;
    case 'boss':
      assert.equal(s.zombie, 'boss', `${where}: boss type`);
      break;
    case 'evac':
      assert.equal(m.mode, 'zone', `${where}: evac only in a zone mission`);
      assert.ok(Array.isArray(s.stops) && s.stops.length >= 2, `${where}: stops`);
      s.stops.forEach((a) => anchor(a, 'stops'));
      break;
    case 'campaignStage':
      assert.equal(m.mode, 'campaign', `${where}: campaignStage only in a campaign mission`);
      assert.ok(STAGES.includes(s.stage), `${where}: stage '${s.stage}'`);
      if (s.waves !== undefined) assert.ok(s.stage === 'hill' && isInt(s.waves) && s.waves >= 3 && /campaignWaves/.test(s.todo), `${where}: waves is a hill-only todo`);
      break;
    case 'wait':
      assert.ok(isNum(s.seconds) && s.seconds > 0 && s.seconds <= 900, `${where}: seconds`);
      break;
    case 'dialogue':
      checkLines(s.lines, `${where}.lines`, { min: 2, max: 10 });
      break;
    default: break;
  }
  if (s.text !== undefined) assert.ok(nonEmpty(s.text) && s.text.length <= 80, `${where}: HUD text 1..80 chars`);
  if (!['wait', 'dialogue'].includes(s.type)) assert.ok(nonEmpty(s.text), `${where}: a HUD line`);
  if (s.pressure) {
    const p = s.pressure;
    assert.ok(isNum(p.waves) && p.waves >= 1 && p.waves <= 12, `${where}: pressure.waves`);
    assert.ok(isNum(p.pace) && p.pace >= 0.2 && p.pace <= 1.8, `${where}: pressure.pace ${p.pace} 0.2..1.8`);
    if (p.specials) p.specials.forEach((z) => assert.ok(ZOMBIE_IDS.includes(z), `${where}: special '${z}'`));
    assert.deepEqual(Object.keys(p).filter((k) => !['waves', 'pace', 'specials'].includes(k)), [], `${where}: pressure keys`);
    // a surge is short: zombies need 15+ s to arrive from the map edge, so keep the loud parts brief
    if (p.pace > 1.3 && s.type === 'survive') assert.ok(s.seconds <= 60, `${where}: a pace ${p.pace} surge lasts at most 60 s`);
    if (p.pace > 1.3 && s.type === 'activate') assert.ok(s.hold <= 30, `${where}: surge activation`);
  }
  if (s.parallel !== undefined) assert.equal(s.parallel, true, `${where}: parallel is true when present`);
  if (s.onStart) checkRadio(s.onStart, `${where}.onStart`);
  if (s.onDone) checkRadio(s.onDone, `${where}.onDone`);
  if (s.flags) for (const [k, v] of Object.entries(s.flags)) assert.ok(/^[a-z][a-z0-9_]*$/.test(k) && v === true, `${where}: flag ${k}`);
  if (s.todo) for (const k of s.todo.split(',')) assert.ok(story.TODO_REQUESTS[k.trim()], `${where}: todo '${k}' is documented in TODO_REQUESTS`);
}

/** Highest virtual wave a mission's steps reach (defend/waves steps count up from pressure.waves). */
function maxVirtualWave(m) {
  let w = 0;
  for (const s of [...m.steps, ...(m.bonus || [])]) {
    if (!s.pressure) continue;
    const extra = s.type === 'defend' ? s.waves - 1 : s.type === 'waves' ? s.count - 1 : 0;
    w = Math.max(w, s.pressure.waves + extra);
  }
  return w;
}

/** Zombie types that can appear in a mission (natural mix at its virtual waves + forced specials + kill/boss steps). */
function typesIn(m) {
  const set = new Set();
  for (const s of [...m.steps, ...(m.bonus || [])]) {
    if (s.zombie) set.add(s.zombie);
    if (!s.pressure) continue;
    const extra = s.type === 'defend' ? s.waves - 1 : s.type === 'waves' ? s.count - 1 : 0;
    for (let w = s.pressure.waves; w <= s.pressure.waves + extra; w++) {
      for (const id of ZOMBIE_IDS) if (ZOMBIES[id].weight(w) > 0) set.add(id);
    }
    (s.pressure.specials || []).forEach((z) => set.add(z));
  }
  return set;
}

// =======================================================================================================
describe('the cast', () => {
  test('required characters, invented extras, and every entry well formed', () => {
    for (const id of ['mara', 'deke', 'ozzy', 'okafor', 'priya', 'june', 'warden']) assert.ok(CAST[id], `cast has ${id}`);
    const extras = Object.keys(CAST).filter((id) => !['mara', 'deke', 'ozzy', 'okafor', 'priya', 'june', 'warden', 'narrator'].includes(id));
    assert.ok(extras.length >= 3, 'at least three invented characters');
    for (const [key, c] of Object.entries(CAST)) {
      assert.equal(c.id, key, `${key}: id matches key`);
      assert.ok(nonEmpty(c.role), `${key}: role`);
      assert.ok(nonEmpty(c.bio) && c.bio.length <= 400, `${key}: bio`);
      assert.ok(c.voice && c.voice.pitch >= 0.1 && c.voice.pitch <= 2 && c.voice.rate >= 0.5 && c.voice.rate <= 2, `${key}: voice`);
      assert.ok(c.portrait && nonEmpty(c.portrait.mood) && HEX.test(c.portrait.bg) && HEX.test(c.portrait.accent), `${key}: portrait hints`);
      if (c.system) { assert.equal(c.look, null); continue; }
      assert.ok(nonEmpty(c.name), `${key}: name`);
      if (c.radioOnly) { assert.equal(c.look, null, `${key}: radio-only characters have no model`); continue; }
      assert.ok(c.look && CLASS_IDS.includes(c.look.cls), `${key}: look.cls is a survivor kit class`);
      assert.ok(HEX.test(c.look.skin) && HEX.test(c.look.hair), `${key}: skin and hair colors`);
      assert.ok(Array.isArray(c.look.outfit) && c.look.outfit.length >= 2 && c.look.outfit.every((h) => HEX.test(h)), `${key}: outfit colors`);
      assert.ok(nonEmpty(c.look.accessory), `${key}: accessory`);
    }
    assert.equal(CAST.wren.look.cls, 'scout', 'Wren has a model for the finale');
  });

  test('outfits are distinct enough to tell the NPCs apart', () => {
    const key = (c) => c.look.outfit.join('|');
    const seen = new Map();
    for (const c of Object.values(CAST)) {
      if (!c.look) continue;
      assert.ok(!seen.has(key(c)), `${c.id} and ${seen.get(key(c))} share an outfit`);
      seen.set(key(c), c.id);
    }
  });

  test('every NPC that joins through a mission is unlocked by exactly that mission', () => {
    for (const c of Object.values(CAST)) {
      if (!c.joins || !c.joins.mission) continue;
      const m = MISSIONS.filter((x) => x.rewards.unlockNpc === c.id);
      assert.equal(m.length, 1, `${c.id} is unlocked once`);
      assert.equal(m[0].id, c.joins.mission, `${c.id} joins at ${c.joins.mission}`);
    }
  });
});

// =======================================================================================================
describe('the fifteen missions', () => {
  test('ids, order, titles, chapters and maps follow STORY.md section 2', () => {
    assert.deepEqual(MISSIONS.map((m) => m.id), ORDER);
    assert.equal(new Set(MISSIONS.map((m) => m.id)).size, 15, 'ids are unique');
    MISSIONS.forEach((m) => {
      assert.equal(m.title, TITLES[m.id], `${m.id}: title`);
      const ch = Number(m.id[1]);
      assert.equal(m.chapter, ch, `${m.id}: chapter`);
      assert.equal(m.index, Number(m.id[3]), `${m.id}: index`);
      assert.equal(m.map, CHAPTER_MAPS[ch - 1], `${m.id}: map`);
      assert.ok(MODES.includes(m.mode), `${m.id}: mode`);
      assert.ok(['night', 'day'].includes(m.time), `${m.id}: time`);
    });
    assert.deepEqual(CHAPTERS.map((c) => c.title), CHAPTER_TITLES);
    CHAPTERS.forEach((c, i) => {
      assert.equal(c.n, i + 1);
      assert.deepEqual(c.missions, ORDER.filter((id) => id[1] === String(i + 1)), `chapter ${c.n}: missions`);
      assert.equal(c.map, CHAPTER_MAPS[i]);
    });
    assert.equal(MISSIONS.find((m) => m.id === 'm5_1').mode, 'zone', '5.1 is the zone run');
    assert.equal(MISSIONS.find((m) => m.id === 'm6_1').mode, 'campaign');
    assert.equal(MISSIONS.find((m) => m.id === 'm6_2').mode, 'campaign');
    for (const m of MISSIONS.filter((x) => x.chapter === 1)) assert.equal(m.time, 'night', `${m.id}: the highway is a night map`);
    assert.deepEqual(story.ANCHORS, ANCHORS, 'the authoring vocabulary matches STORY.md section 5.2');
  });

  test('hideouts: visits after chapters 1, 3 and 5, each with an arrival scene', () => {
    assert.deepEqual(CHAPTERS.filter((c) => c.arrival).map((c) => [c.n, c.arrival.hideout]), [[1, 'roadhouse'], [3, 'depot'], [5, 'farmstead']]);
    for (const c of CHAPTERS.filter((x) => x.arrival)) {
      checkLines(c.arrival.scene, `arrival ${c.arrival.hideout}`, { min: 12, max: 24 });
      assert.ok(HIDEOUTS[c.arrival.hideout], 'hideout exists');
      assert.equal(c.endsAt, c.arrival.hideout);
      assert.equal(mission(c.missions[c.missions.length - 1]).after, `hideout:${c.arrival.hideout}`, 'the last mission leads to the hideout');
    }
    assert.deepEqual(Object.keys(HIDEOUTS), ['roadhouse', 'depot', 'farmstead']);
    checkLines(CHAPTERS[5].epilogue, 'epilogue', { min: 20, max: 80 });
    CHAPTERS.forEach((c) => {
      assert.ok(nonEmpty(c.subtitle) && nonEmpty(c.card), `chapter ${c.n}: card`);
      checkLines([c.epigraph], `chapter ${c.n} epigraph`);
    });
  });

  for (const id of ORDER) {
    test(`${id}: fields, briefing/debrief, steps and rewards`, () => {
      const m = mission(id);
      assert.ok(nonEmpty(m.blurb) && m.blurb.length <= 260, 'blurb');
      assert.ok(isInt(m.level[0]) && isInt(m.level[1]) && m.level[0] >= 1 && m.level[1] >= m.level[0] && m.level[1] <= 20, 'level band');
      assert.ok(m.party && m.party.min === 1 && m.party.max === 6, 'party 1..6');
      checkLines(m.briefing, `${id}.briefing`, { min: 6, max: 14 });
      checkLines(m.debrief, `${id}.debrief`, { min: 4, max: 10 });

      // steps
      assert.ok(m.steps.length >= 5, 'at least five steps');
      const ids = new Set();
      [...m.steps, ...(m.bonus || [])].forEach((s, i) => {
        checkStep(m, s, `${id}.${s.id || i}`);
        assert.ok(!ids.has(s.id), `${id}: duplicate step id ${s.id}`);
        ids.add(s.id);
      });
      const types = new Set(m.steps.map((s) => s.type));
      assert.ok(types.size >= 3, `${id}: varied step types (${[...types].join(', ')})`);
      const spoken = m.steps.filter((s) => (s.onStart && s.onStart.length) || (s.onDone && s.onDone.length));
      assert.ok(spoken.length >= 3, `${id}: at least three steps with radio chatter`);
      const last = m.steps[m.steps.length - 1];
      assert.ok(!last.parallel, `${id}: the last step cannot be parallel`);
      assert.ok(m.steps.some((s) => s.onStart && s.onStart.length) && m.steps.some((s) => s.onDone && s.onDone.length), `${id}: onStart and onDone lines`);
      assert.ok(m.mode === 'campaign' || m.steps.some((s) => s.pressure), `${id}: some zombie pressure (the campaign director places its own)`);

      // bonus steps
      for (const b of m.bonus || []) {
        assert.ok(['collect', 'reach', 'activate'].includes(b.type), `${id}.${b.id}: bonus type`);
        if (b.since) assert.ok(m.steps.some((s) => s.id === b.since), `${id}.${b.id}: since '${b.since}' is a main step`);
        assert.ok(/noteRef|stepFlags/.test(b.todo || ''), `${id}.${b.id}: bonus steps flag their extensions`);
      }
      assert.ok(m.todo && /bonus/.test(m.todo) && /graph/.test(m.todo), `${id}: mission-level todo`);

      // stars
      assert.ok(isNum(m.stars.time) && m.stars.time >= 400 && m.stars.time <= 1500, 'par time');
      assert.equal(m.stars.noDowns, true);
      assert.equal(m.stars.optional, 'collectAll');
      assert.ok((m.bonus || []).length >= 1, 'optional objectives exist for the third star');

      // rewards
      const r = m.rewards;
      assert.ok(isInt(r.xp) && r.xp >= 150 && r.xp <= 1000, 'xp');
      assert.ok(isInt(r.scrap) && r.scrap >= 40 && r.scrap <= 220, 'scrap 40..220');
      assert.ok(isInt(r.upgradePoints) && r.upgradePoints >= 0 && r.upgradePoints <= 3, 'upgrade points');
      if (r.weapon) assert.ok(WEAPONS[r.weapon], `weapon '${r.weapon}' exists`);
      if (r.unlockNpc) assert.ok(story.NPC_IDS.includes(r.unlockNpc), `unlockNpc '${r.unlockNpc}' is in the cast`);
      for (const [k, v] of Object.entries(r.flags || {})) assert.ok(/^[a-z][a-z0-9_]*$/.test(k) && v === true, `flag ${k}`);
      assert.deepEqual(Object.keys(r).filter((k) => !['xp', 'scrap', 'weapon', 'upgradePoints', 'flags', 'unlockNpc'].includes(k)), [], 'reward keys');

      // graph fields
      assert.ok(Array.isArray(m.requires) && m.requires.every((q) => ORDER.indexOf(q) >= 0 && ORDER.indexOf(q) < ORDER.indexOf(id)), 'requires point backwards');
      assert.ok(m.hub === null || HIDEOUTS[m.hub], 'hub');
      assert.ok(/^(m\d_\d|hideout:(roadhouse|depot|farmstead)|epilogue)$/.test(m.after), 'after');
    });
  }

  test('the mission map modes and campaign stages are wired in order', () => {
    const stagesOf = (id) => mission(id).steps.filter((s) => s.type === 'campaignStage').map((s) => s.stage);
    assert.deepEqual(stagesOf('m6_1'), ['hill']);
    assert.deepEqual(stagesOf('m6_2'), ['breakout', 'tower', 'roof', 'zip']);
    assert.ok(mission('m5_1').steps.some((s) => s.type === 'evac'));
    assert.ok(mission('m5_2').steps.some((s) => s.type === 'boss'), 'the first boss is at the field hospital');
    assert.ok(mission('m4_3').steps.filter((s) => s.type === 'kill' && s.zombie === 'brute').reduce((n, s) => n + s.count, 0) === 5, 'the Brute pack is five');
    // zone missions in ch2 and ch4 use the defend targets of their maps
    for (const [id, target] of [['m1_1', 'bus'], ['m2_1', 'diner'], ['m3_1', 'apc'], ['m4_1', 'tower']]) {
      assert.ok(mission(id).steps.some((s) => s.type === 'defend' && s.target === target), `${id} defends the ${target}`);
    }
  });
});

// =======================================================================================================
describe('the unlock chain', () => {
  const freshWorld = () => ({ progress: { node: 'm1_1', completed: {}, flags: {} }, hideout: { recruited: {} } });

  test('walking the campaign with nextNodes() visits all fifteen missions and the epilogue', () => {
    const w = freshWorld();
    const seen = [];
    const guard = 60;
    for (let i = 0; i < guard; i++) {
      const nodes = nextNodes(w);
      if (!nodes.length) break;
      const n = nodes[0];
      if (n.kind === 'hideout') {
        assert.equal(n.arrival, true);
        const ch = CHAPTERS.find((c) => c.arrival && c.arrival.hideout === n.id);
        w.progress.flags[ch.arrival.flag] = true;
        seen.push(`H:${n.id}`);
      } else if (n.kind === 'mission') {
        assert.ok(mission(n.id), 'node is a mission');
        w.progress.completed[n.id] = { stars: 1, time: 500 };
        seen.push(n.id);
      } else if (n.kind === 'epilogue') {
        w.progress.flags[story.EPILOGUE_FLAG] = true;
        seen.push('epilogue');
      }
    }
    assert.deepEqual(seen, ['m1_1', 'm1_2', 'm1_3', 'H:roadhouse', 'm2_1', 'm2_2', 'm2_3', 'm3_1', 'm3_2', 'H:depot',
      'm4_1', 'm4_2', 'm4_3', 'm5_1', 'm5_2', 'H:farmstead', 'm6_1', 'm6_2', 'epilogue']);
    assert.deepEqual(nextNodes(w), [], 'nothing left afterwards');
  });

  test('chapter 2 offers Radio Parts and Night Hauler together; a fresh world starts at 1.1', () => {
    assert.deepEqual(nextNodes(null).map((n) => n.id), ['m1_1']);
    assert.deepEqual(nextNodes({}).map((n) => n.id), ['m1_1']);
    const w = freshWorld();
    for (const id of ['m1_1', 'm1_2', 'm1_3', 'm2_1']) w.progress.completed[id] = { stars: 1 };
    w.progress.flags.seen_arrival_roadhouse = true;
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['m2_2', 'm2_3']);
    w.progress.completed.m2_3 = { stars: 2 };
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['m2_2'], 'the other one is still open');
    assert.equal(nextNodes(w)[0].hub, 'roadhouse');
  });

  test('road missions chain directly, hub missions start at their hideout', () => {
    assert.equal(nextNodes(freshWorld())[0].direct, true, '1.1 starts at once');
    for (const m of MISSIONS) {
      assert.equal(m.hub === null, ['m1_1', 'm1_2', 'm1_3', 'm3_2', 'm5_2', 'm6_2'].includes(m.id), `${m.id}: hub null only on the road`);
    }
    assert.deepEqual(story.afterMission('m1_1'), { kind: 'mission', id: 'm1_2' });
    assert.deepEqual(story.afterMission('m2_2'), { kind: 'hideout', id: 'roadhouse' });
    assert.deepEqual(story.afterMission('m6_2'), { kind: 'epilogue', id: 'epilogue' });
    assert.equal(story.afterMission('nope'), null);
  });

  test('nextNodes and the helpers do not mutate their input', () => {
    const w = freshWorld();
    w.progress.completed.m1_1 = { stars: 3 };
    const before = JSON.stringify(w);
    nextNodes(w); story.missionStates(w); story.npcsAt(w); story.currentChapter(w); story.stageFor('roadhouse', w);
    assert.equal(JSON.stringify(w), before);
    const states = story.missionStates(w);
    assert.equal(states[0].state, 'done');
    assert.equal(states[0].stars, 3);
    assert.equal(states[1].state, 'available');
    assert.equal(states[3].state, 'locked');
  });
});

// =======================================================================================================
describe('rewards and the level curve', () => {
  test('totals land a party at level 13-14 and every number ramps', () => {
    const total = story.totalRewardXp();
    assert.ok(total >= 6500 && total <= 8000, `total mission xp ${total} in 6500..8000`);
    assert.ok(story.levelForXp(total) >= 13 && story.levelForXp(total) <= 15, 'the finale carries a party to level 13-14');
    for (let i = 1; i < MISSIONS.length; i++) {
      assert.ok(MISSIONS[i].rewards.xp >= MISSIONS[i - 1].rewards.xp, `${MISSIONS[i].id}: xp does not drop`);
      assert.ok(MISSIONS[i].rewards.scrap >= MISSIONS[i - 1].rewards.scrap, `${MISSIONS[i].id}: scrap does not drop`);
    }
    assert.equal(MISSIONS[14].rewards.xp, Math.max(...MISSIONS.map((m) => m.rewards.xp)), 'the finale pays best');
    assert.equal(MISSIONS[0].rewards.scrap, Math.min(...MISSIONS.map((m) => m.rewards.scrap)));
  });

  test('level bands follow the cumulative XP curve round(90*(L-1)^1.7)', () => {
    assert.equal(story.xpForLevel(2), 90);
    assert.equal(story.xpForLevel(14), Math.round(90 * Math.pow(13, 1.7)));
    for (const m of MISSIONS) {
      const at = story.levelForXp(story.xpBefore(m.id));
      assert.ok(Math.abs(m.level[0] - at) <= 1, `${m.id}: recommended ${m.level[0]}, the curve says ${at}`);
      assert.ok(m.level[1] >= at, `${m.id}: band top`);
    }
    assert.equal(MISSIONS[0].level[0], 1);
    assert.ok(MISSIONS[14].level[1] >= 13 && MISSIONS[14].level[1] <= 14);
    for (let i = 1; i < MISSIONS.length; i++) assert.ok(MISSIONS[i].level[0] >= MISSIONS[i - 1].level[0], 'bands do not go backwards');
  });

  test('weapons are unlocked along the chapters', () => {
    const got = MISSIONS.filter((m) => m.rewards.weapon).map((m) => [m.chapter, m.rewards.weapon]);
    const inChapter = (ch) => got.filter((g) => g[0] === ch).map((g) => g[1]);
    assert.ok(inChapter(1).includes('shotgun'), 'shotgun in chapter 1');
    assert.ok(inChapter(2).some((w) => WEAPONS[w].category === 'smg'), 'an SMG in chapter 2');
    assert.ok(inChapter(3).includes('dmr'), 'the DMR in chapter 3');
    assert.ok(inChapter(4).includes('lmg') && inChapter(4).includes('flare'), 'LMG and flare in chapter 4');
    assert.ok(inChapter(5).includes('hmg'), 'HMG in chapter 5');
    assert.ok(inChapter(6).includes('rocket') && inChapter(6).includes('railgun'), 'rocket and railgun in the finale');
    const all = got.map((g) => g[1]);
    assert.equal(new Set(all).size, all.length, 'no weapon is rewarded twice');
    const unlockNpcs = MISSIONS.filter((m) => m.rewards.unlockNpc).map((m) => m.rewards.unlockNpc);
    assert.equal(new Set(unlockNpcs).size, unlockNpcs.length, 'no NPC is unlocked twice');
    for (const id of ['mara', 'deke', 'ozzy', 'okafor', 'priya', 'quill', 'dutch', 'wendell', 'danny']) assert.ok(unlockNpcs.includes(id), `${id} is unlocked by a mission`);
  });
});

// =======================================================================================================
describe('the zombies arrive gradually and at a walking pace', () => {
  test('specials appear by chapter: walkers, then runners and crawlers, bloaters and spitters, screamers and brutes, the boss', () => {
    const firstChapter = {};
    for (const m of MISSIONS) for (const z of typesIn(m)) if (!(z in firstChapter)) firstChapter[z] = m.chapter;
    assert.equal(firstChapter.walker, 1);
    assert.ok(firstChapter.runner <= 1 && firstChapter.crawler <= 1, 'runners and crawlers by the end of chapter 1');
    assert.ok(firstChapter.bloater >= 3 && firstChapter.spitter >= 3, 'bloaters and spitters at Blackwater');
    assert.ok(firstChapter.screamer >= 4 && firstChapter.brute >= 4, 'screamers and Brutes at Delta');
    assert.equal(firstChapter.boss, 5, 'the Abomination first shows at the Field Hospital');
    // chapter 1 mission 1 is pure walkers
    assert.deepEqual([...typesIn(mission('m1_1'))], ['walker']);
  });

  test('virtual wave numbers ramp with the chapters and stay inside what the wave tables support', () => {
    let prev = 0;
    for (const m of MISSIONS.filter((x) => x.mode !== 'campaign')) {
      const w = maxVirtualWave(m);
      assert.ok(w >= 1 && w <= 9, `${m.id}: virtual wave ${w}`);
      assert.ok(w >= prev - 1, `${m.id}: virtual wave ${w} does not fall far below ${prev}`);
      prev = Math.max(prev, w);
    }
    assert.ok(maxVirtualWave(mission('m1_1')) === 1);
    assert.ok(maxVirtualWave(mission('m3_1')) <= 4, 'no natural Brutes before Delta');
    assert.ok(maxVirtualWave(mission('m4_1')) >= 6, 'screamer waves at Delta');
  });

  test('a Brute is a set piece: at most 2 at once except the pack', () => {
    for (const m of MISSIONS) for (const s of m.steps) if (s.type === 'kill') {
      const cap = m.id === 'm4_3' ? 3 : 2;
      if (s.zombie === 'brute') assert.ok(s.count <= cap, `${m.id}.${s.id}: ${s.count} brutes`);
    }
  });
});

// =======================================================================================================
describe('lore notes', () => {
  test('twenty notes, one bonus step each, in the mission and anchor they claim', () => {
    const ids = Object.keys(NOTES);
    assert.equal(ids.length, 20);
    assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => `n${String(i + 1).padStart(2, '0')}`));
    for (const n of Object.values(NOTES)) {
      const m = mission(n.mission);
      assert.ok(m, `${n.id}: mission`);
      const steps = (m.bonus || []).filter((s) => s.item === 'note' && s.note === n.id);
      assert.equal(steps.length, 1, `${n.id}: exactly one bonus collect step in ${n.mission}`);
      assert.deepEqual(steps[0].at, [n.at], `${n.id}: anchor`);
      assert.ok(ANCHORS[m.map].includes(n.at), `${n.id}: anchor exists on ${m.map}`);
      assert.ok(nonEmpty(n.title) && nonEmpty(n.text), `${n.id}: title and text`);
      assert.ok(n.text.length >= 40 && n.text.length <= 320, `${n.id}: ${n.text.length} chars`);
      assert.ok(sentences(n.text) >= 1 && sentences(n.text) <= 4, `${n.id}: ${sentences(n.text)} sentences`);
      assert.ok(isInt(n.day) && n.day >= 1 && n.day <= 45, `${n.id}: day`);
    }
    const noteSteps = MISSIONS.flatMap((m) => (m.bonus || []).filter((s) => s.item === 'note'));
    assert.equal(noteSteps.length, 20, 'no stray note steps');
    for (const m of MISSIONS) assert.ok((m.bonus || []).filter((s) => s.item === 'note').length <= 2, `${m.id}: at most two notes`);
  });

  test('the Warden clues are in the notes: Alcott, the ferry Halcyon, the girl with the batteries', () => {
    const all = Object.values(NOTES).map((n) => n.text).join(' ');
    for (const word of ['Alcott', 'Halcyon', 'Operation Haven', 'D batteries', 'the Quiet', 'Delaney']) assert.ok(all.includes(word), `mentions ${word}`);
  });
});

// =======================================================================================================
describe('dialogue', () => {
  const producedFlags = () => {
    const f = new Set(['seen_epilogue']);
    for (const m of MISSIONS) {
      Object.keys(m.rewards.flags || {}).forEach((k) => f.add(k));
      (m.bonus || []).forEach((b) => Object.keys(b.flags || {}).forEach((k) => f.add(k)));
    }
    for (const c of CHAPTERS) if (c.arrival) f.add(c.arrival.flag);
    for (const npc of Object.values(DIALOGUE.talk)) for (const stage of Object.values(npc)) for (const tp of stage.topics) (tp.setFlags || []).forEach((k) => f.add(k));
    return f;
  };
  const checkWhen = (when, where, flags) => {
    if (!when) return;
    assert.deepEqual(Object.keys(when).filter((k) => !['flags', 'notFlags', 'done', 'notDone'].includes(k)), [], `${where}: when keys`);
    [...(when.flags || []), ...(when.notFlags || [])].forEach((k) => assert.ok(flags.has(k), `${where}: unknown flag '${k}'`));
    [...(when.done || []), ...(when.notDone || [])].forEach((k) => assert.ok(ORDER.includes(k), `${where}: unknown mission '${k}'`));
  };

  test('hideout conversation trees: 3-8 topics per NPC per visit, real speakers, real conditions', () => {
    const flags = producedFlags();
    const topicIds = new Set();
    let count = 0;
    for (const [npc, stages] of Object.entries(DIALOGUE.talk)) {
      assert.ok(story.NPC_IDS.includes(npc), `talk npc ${npc} is in the cast`);
      for (const [stage, tree] of Object.entries(stages)) {
        const where = `talk.${npc}.${stage}`;
        assert.ok(DIALOGUE.stages[stage], `${where}: stage exists`);
        assert.ok(tree.greet.length >= 1 && tree.greet.every((g) => nonEmpty(g) && g.length <= 200), `${where}: greet`);
        assert.ok(tree.topics.length >= 3 && tree.topics.length <= 8, `${where}: ${tree.topics.length} topics`);
        for (const tp of tree.topics) {
          assert.ok(!topicIds.has(tp.id), `${where}: duplicate topic id ${tp.id}`);
          topicIds.add(tp.id);
          count++;
          assert.ok(nonEmpty(tp.prompt) && tp.prompt.length <= 80, `${tp.id}: prompt`);
          checkLines(tp.lines, tp.id, { min: 1, max: 5 });
          assert.equal(tp.lines[0].who, npc, `${tp.id}: the NPC answers first`);
          checkWhen(tp.when, tp.id, flags);
        }
      }
    }
    assert.ok(count >= 120, `${count} topics`);
    // the cast members who are in a hideout have something to say in every stage they can be met in
    const worldThrough = (missionId) => {
      const w = { progress: { completed: {}, flags: {} }, hideout: { recruited: {} } };
      for (const m of MISSIONS) {
        w.progress.completed[m.id] = { stars: 1 };
        Object.assign(w.progress.flags, m.rewards.flags || {});
        if (m.rewards.unlockNpc) w.hideout.recruited[m.rewards.unlockNpc] = true;
        if (m.id === missionId) break;
      }
      for (const c of CHAPTERS) if (c.arrival && w.progress.completed[c.missions[c.missions.length - 1]]) w.progress.flags[c.arrival.flag] = true;
      return w;
    };
    const latest = { rh1: 'm1_3', rh2: 'm2_3', dp1: 'm3_2', dp2: 'm4_3', fs: 'm5_2' };
    const earliest = { rh1: 'm1_3', rh2: 'm2_1', dp1: 'm3_2', dp2: 'm4_1', fs: 'm5_2' };
    for (const [npc, stages] of Object.entries(DIALOGUE.talk)) {
      for (const stage of Object.keys(stages)) {
        const late = story.conversation(npc, stage, worldThrough(latest[stage]));
        assert.ok(late.topics.length >= 3, `${npc}/${stage}: ${late.topics.length} topics visible by the end of the stage`);
        const wEarly = worldThrough(earliest[stage]);
        if (story.npcAvailable(npc, wEarly)) {
          assert.ok(story.conversation(npc, stage, wEarly).topics.length >= 1, `${npc}/${stage}: something to say when the stage opens`);
        }
      }
    }
    const present = { rh1: ['mara', 'deke', 'ozzy', 'june', 'roz'], rh2: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch'],
      dp1: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch', 'priya', 'wendell'], fs: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch', 'priya', 'wendell', 'okafor', 'danny'] };
    for (const [stage, npcs] of Object.entries(present)) for (const n of npcs) assert.ok(DIALOGUE.talk[n] && DIALOGUE.talk[n][stage], `${n} has a ${stage} conversation`);
  });

  test('stage selection and the conversation helper', () => {
    const w = { progress: { completed: {}, flags: {} } };
    assert.equal(story.stageFor('roadhouse', w), 'rh1');
    w.progress.completed.m2_1 = { stars: 1 };
    assert.equal(story.stageFor('roadhouse', w), 'rh2');
    assert.equal(story.stageFor('depot', w), 'dp1');
    w.progress.completed.m4_1 = { stars: 1 };
    assert.equal(story.stageFor('depot', w), 'dp2');
    assert.equal(story.stageFor('farmstead', w), 'fs');
    assert.equal(story.stageFor('mars', w), null);
    const c1 = story.conversation('mara', 'rh2', w, null, 0);
    assert.ok(c1.greet && c1.topics.length >= 3);
    assert.ok(c1.topics.some((t) => t.id === 'mara_rh2_diner'), 'a done-gated topic opens when its mission is done');
    const c0 = story.conversation('mara', 'rh2', { progress: { completed: {}, flags: {} } }, null, 0);
    assert.ok(!c0.topics.some((t) => t.id === 'mara_rh2_diner'), 'and is hidden before');
    assert.equal(story.conversation('priya', 'rh1', w).topics.length, 0, 'no tree: an idle greeting only');
  });

  test('campfire banter: at least twenty two-liners between cast members', () => {
    const flags = producedFlags();
    assert.ok(DIALOGUE.banter.length >= 20);
    const ids = new Set();
    for (const b of DIALOGUE.banter) {
      assert.ok(!ids.has(b.id), `banter id ${b.id}`);
      ids.add(b.id);
      assert.equal(b.lines.length, 2, `${b.id}: a pair`);
      assert.notEqual(b.lines[0].who, b.lines[1].who, `${b.id}: two speakers`);
      checkLines(b.lines, b.id, { min: 2, max: 2 });
      checkWhen(b.when, b.id, flags);
    }
    const w = { progress: { completed: { m4_2: {} }, flags: {} } };
    assert.ok(story.banterFor(w, ['danny', 'okafor']).length >= 1);
    assert.equal(story.banterFor({ progress: { completed: {}, flags: {} } }, ['danny', 'okafor']).length, 0);
  });

  test('stations, pep talks, retry quips, tips, title and credits', () => {
    for (const s of ['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'bed', 'range', 'campfire']) {
      const st = DIALOGUE.stations[s];
      assert.ok(st && nonEmpty(st.name), `station ${s}`);
      const lines = st.lines || [...(st.prompt || []), ...(st.morning || [])];
      assert.ok(lines.length >= 3 && lines.every((l) => nonEmpty(l) && l.length <= 200), `station ${s} lines`);
    }
    const bed = DIALOGUE.stations.bed;
    assert.ok(bed.prompt.some((p) => p.includes('Rest until morning? Day {day}')), 'the bed asks "Rest until morning? Day {day}"');
    assert.ok(bed.morning.every((l) => l.includes('{day}')));
    for (const id of ORDER) checkLines(DIALOGUE.pep[id], `pep ${id}`, { min: 1, max: 3 });
    assert.deepEqual(Object.keys(DIALOGUE.pep), ORDER);
    checkLines(DIALOGUE.retry.general, 'retry.general', { min: 12, max: 40 });
    for (const [id, q] of Object.entries(DIALOGUE.retry.byMission)) { assert.ok(ORDER.includes(id)); checkLines(q, `retry ${id}`, { min: 1 }); }
    assert.ok(TIPS.length >= 25, `${TIPS.length} tips`);
    TIPS.forEach((t, i) => assert.ok(nonEmpty(t) && t.length <= 200, `tip ${i}`));
    assert.ok(TIPS.some((t) => /slow/i.test(t)), 'a slow-zombie tip');
    assert.equal(new Set(TIPS).size, TIPS.length, 'tips are unique');
    assert.ok(nonEmpty(DIALOGUE.title.name) && nonEmpty(DIALOGUE.title.tagline) && DIALOGUE.title.alt.length >= 3);
    assert.ok(DIALOGUE.credits.length >= 12 && DIALOGUE.credits.every((c) => ['title', 'heading', 'line'].includes(c.type) && nonEmpty(c.text)));
    assert.equal(story.expandTokens('Rest until morning? Day {day}', { day: 43 }), 'Rest until morning? Day 43');
  });
});

// =======================================================================================================
describe('text hygiene across every file', () => {
  const everything = () => ({ MISSIONS, CHAPTERS, DIALOGUE, TIPS, NOTES, CAST });

  test('no empty or padded strings, only known tokens, no emoji', () => {
    for (const [p, s] of strings(everything())) {
      assert.ok(nonEmpty(s), `${p}: empty or padded string '${s}'`);
      for (const [, tok] of s.matchAll(/\{(\w+)\}/g)) assert.ok(TOKENS.includes(tok), `${p}: unknown token {${tok}}`);
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s.replace(/[◆]/g, '')), `${p}: emoji`);
    }
  });

  test('every speaker in every line exists and every line is short enough to read', () => {
    let lines = 0;
    for (const [p, l] of dialogueLines(everything())) {
      lines++;
      assert.ok(SPEAKERS.includes(l.who), `${p}: unknown speaker '${l.who}'`);
      assert.ok(l.text.length <= 200, `${p}: ${l.text.length} chars`);
    }
    assert.ok(lines > 800, `${lines} dialogue lines in total`);
  });

  test('no en-dashes or ellipsis characters that speech synthesis stumbles on', () => {
    for (const [p, s] of strings({ MISSIONS, CHAPTERS, DIALOGUE, NOTES })) {
      assert.ok(!/[–…]/.test(s), `${p}: use plain punctuation`);
    }
  });
});

// =======================================================================================================
describe('the mission executor validator (agent S2)', () => {
  test('every mission passes shared/story/validate.js when it exists', async (t) => {
    const file = path.join(ROOT, 'public/js/shared/story/validate.js');
    if (!fs.existsSync(file)) return t.skip('shared/story/validate.js is not merged yet');
    const mod = await import(pathToFileURL(file).href);
    const fn = mod.validateMission || mod.validateScript || mod.validate;
    assert.equal(typeof fn, 'function', 'validate.js exports validateMission(m)');
    for (const m of MISSIONS) {
      let res;
      try { res = fn(m); } catch (e) { assert.fail(`${m.id}: validator threw ${e.message}`); }
      const errors = Array.isArray(res) ? res : res && Array.isArray(res.errors) ? res.errors : res === false ? ['validator returned false'] : [];
      assert.deepEqual(errors, [], `${m.id}: ${errors.join('; ')}`);
    }
  });
});
