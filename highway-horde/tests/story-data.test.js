// ROAD TO HAVEN narrative data (shared/story/*): the twelve story missions of JOURNEY.md §2 (the bus,
// nine story levels walked section by section, the finale), the twelve side jobs of the hideout board,
// the unlock graph, XP/scrap/level sanity, the gradual introduction of the zombie specials, text limits,
// lore notes and the hideout dialogue. Pure data: fast. The executor's validator (shared/story/validate.js)
// checks every field against the real maps in story-missions.test.js; this file checks the story.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as story from '../public/js/shared/story/index.js';
import { WEAPONS } from '../public/js/shared/weapons.js';
import { ZOMBIES, ZOMBIE_IDS } from '../public/js/shared/zombies.js';
import { CLASS_IDS } from '../public/js/shared/classes.js';
import { LEVEL_SPECS, LEVEL_IDS } from '../public/js/shared/levels/index.js';
import { LEVEL_ACTIONS, STORY_ITEMS, SIDE_CHAPTER } from '../public/js/shared/story-defs.js';
import { MUSIC_STATES } from '../public/js/audio/music.js';
import { validateMission } from '../public/js/shared/story/validate.js';

const { CAST, MISSIONS, STORY_MISSIONS, SIDE_JOBS, CHAPTERS, DIALOGUE, TIPS, NOTES, HIDEOUTS, mission, nextNodes } = story;

// ---- the contract (JOURNEY.md §2 and §2.1), restated here so the test does not just check the data against itself ----
const ORDER = ['m1_1', 'm1_2', 'm2_1', 'm2_2', 'm3_1', 'm3_2', 'm4_1', 'm4_2', 'm5_1', 'm5_2', 'm6_1', 'm6_2'];
const STORY = {
  m1_1: ['Pileup', 'highway', 'night'], m1_2: ['Mill Road', 'millroad', 'day'],
  m2_1: ['Hollow Creek', 'hollowcreek', 'day'], m2_2: ['Saint Mercy', 'hospital', 'night'],
  m3_1: ['Westgate', 'mall', 'day'], m3_2: ['Blackwater Dam', 'dam', 'day'],
  m4_1: ['The Rail Yard', 'railyard', 'day'], m4_2: ['Fort Harlan', 'airbase', 'night'],
  m5_1: ['Underground', 'metro', 'day'], m5_2: ['Blackpine', 'forest', 'day'],
  m6_1: ['Last Stand', 'harlan', 'day'], m6_2: ['The Tower', 'harlan', 'day'],
};
const LEVEL_MISSIONS = ORDER.filter((id) => LEVEL_IDS.includes(STORY[id][1]));
const SIDE_TITLES = ['Fuel Run', 'Beacon', 'Diner Siege', 'Radio Parts', 'Night Hauler', 'The Crossing', 'Sunken Cargo',
  'Hold the Tower', 'Broken Line', 'Ghosts', 'Down the Interstate', 'Field Hospital'];
const CHAPTER_TITLES = ['Dead Highway', 'Hollow Creek', 'Blackwater', 'Delta', 'Harlan County', 'Haven'];
// STORY.md §5.2: the classic maps' anchors (the story levels' come from their SPEC)
const ANCHORS = {
  highway: ['bus', 'crossroadsW', 'crossroadsE', 'gasStation', 'overpass', 'westEnd', 'eastEnd', 'motel', 'diner'],
  truckstop: ['diner', 'pumps', 'truckLot', 'motelRow', 'roadNorth', 'roadSouth', 'trailerA', 'trailerB', 'trailerC'],
  bridge: ['apc', 'bankW', 'bankE', 'deckMid', 'cargoA', 'cargoB', 'cargoC'],
  checkpoint: ['tower', 'gate', 'compound', 'genA', 'genB', 'genC', 'hill'],
  harlan: ['mainStreet', 'gasNGo', 'haskellFarm', 'stJudes', 'fieldHospital', 'i70Interchange', 'millerQuarry', 'radioHill',
    'shadyPines', 'lakeMarina', 'ridgeHill', 'breakout', 'towerDoor', 'roof', 'zipStart', 'landing'],
};
const anchorsOf = (map) => (LEVEL_SPECS[map] ? Object.values(LEVEL_SPECS[map].anchors).flat() : ANCHORS[map]);
const OBJECTIVE_ANCHOR = { highway: 'bus', truckstop: 'diner', bridge: 'apc', checkpoint: 'tower' }; // defend targets on the classic maps
const STEP_TYPES = ['defend', 'waves', 'survive', 'collect', 'reach', 'activate', 'escort', 'kill', 'boss', 'evac', 'campaignStage', 'wait', 'dialogue'];
const OBJECTIVE_TYPES = ['collect', 'activate', 'defend', 'kill', 'escort', 'survive', 'reach', 'boss', 'waves'];
const SET_PIECES = ['horde', 'explode', 'lights', 'music', 'shake'];
const MODES = ['defend', 'zone', 'campaign', 'free'];
const STAGES = ['hill', 'breakout', 'tower', 'roof', 'zip'];
const TOKENS = ['day', 'crew', 'scrap'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ALL_IDS = MISSIONS.map((m) => m.id);

// keys a step may carry: the common ones, then the per-type parameters
const COMMON = ['id', 'type', 'text', 'parallel', 'pressure', 'onStart', 'onDone', 'since', 'flags', 'todo', 'follow', 'npcs', 'remove'];
const PARAMS = {
  defend: ['target', 'waves', 'seconds'], waves: ['count', 'pace'], survive: ['seconds'], collect: ['item', 'count', 'at', 'note'],
  reach: ['at', 'section', 'hold', 'who'], activate: ['at', 'hold', 'kind', 'effect', 'lure', 'blast'], escort: ['npc', 'route'],
  kill: ['zombie', 'count', 'at'], boss: ['zombie', 'at'], evac: ['stops'], campaignStage: ['stage', 'waves'], wait: ['seconds'],
  dialogue: ['lines', 'npc', 'talk'],
};

const SPEAKERS = Object.keys(CAST);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isInt = (n) => Number.isInteger(n);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0 && s === s.trim();
const sentences = (s) => (s.match(/[.!?]+(\s|$)/g) || []).length;
const isAction = (l) => l && typeof l === 'object' && Object.hasOwn(LEVEL_ACTIONS, l.type);
const actionsOf = (s) => [...(s.onStart || []), ...(s.onDone || [])].filter(isAction);

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
    // (a step with `who: 'all'` and a HUD `text` is not a line: lines have no id)
    if (typeof o.who === 'string' && typeof o.text === 'string' && o.id === undefined) yield [p, o];
    else for (const k of Object.keys(o)) yield* dialogueLines(o[k], `${p}.${k}`);
  }
}

function checkLines(lines, where, { min = 1, max = 99, flags = null } = {}) {
  assert.ok(Array.isArray(lines), `${where}: lines is an array`);
  assert.ok(lines.length >= min && lines.length <= max, `${where}: ${lines.length} lines, want ${min}-${max}`);
  lines.forEach((l, i) => {
    assert.ok(SPEAKERS.includes(l.who), `${where}[${i}]: speaker '${l.who}' is not in the cast`);
    assert.ok(nonEmpty(l.text), `${where}[${i}]: text is empty`);
    assert.ok(l.text.length <= 200, `${where}[${i}]: ${l.text.length} chars > 200`);
    assert.deepEqual(Object.keys(l).filter((k) => !['who', 'text', 'when', 'type', 'ms'].includes(k)), [], `${where}[${i}]: unknown keys`);
    if (l.when && flags) checkWhen(l.when, `${where}[${i}]`, flags);
  });
}

function checkRadio(list, where, m) {
  assert.ok(Array.isArray(list), `${where}: array of radio/say lines and level actions`);
  list.forEach((l, i) => {
    if (isAction(l)) {
      checkAction(l, `${where}[${i}]`, m);
      return;
    }
    assert.ok(l.type === 'radio' || l.type === 'say', `${where}[${i}]: type radio|say`);
    assert.ok(SPEAKERS.includes(l.who), `${where}[${i}]: speaker '${l.who}' is not in the cast`);
    assert.ok(nonEmpty(l.text), `${where}[${i}]: empty text`);
    assert.ok(l.text.length <= 140, `${where}[${i}]: ${l.text.length} chars > 140: ${l.text}`);
    if (l.ms !== undefined) assert.ok(isNum(l.ms) && l.ms >= 800 && l.ms <= 15000, `${where}[${i}]: ms 800..15000`);
    assert.deepEqual(Object.keys(l).filter((k) => !['type', 'who', 'text', 'ms'].includes(k)), [], `${where}[${i}]: unknown keys`);
    const c = CAST[l.who];
    if (c && c.joins && c.joins.mission && isSide(c.joins.mission)) {
      // people who only join through a side job never speak on a story mission's radio (they may not be there)
      assert.ok(m.side === true && (m.id === c.joins.mission || m.requires.includes(c.joins.mission) || requiresDeep(m, c.joins.mission)),
        `${where}[${i}]: ${l.who} joins on a side job and cannot speak in ${m.id}`);
    }
  });
}

const isSide = (id) => !!(mission(id) && mission(id).side);
function requiresDeep(m, id) {
  return (m.requires || []).some((r) => r === id || (mission(r) && requiresDeep(mission(r), id)));
}

function checkAction(a, where, m) {
  const spec = LEVEL_SPECS[m.map];
  assert.ok(spec, `${where}: level actions only on a story level (${m.map})`);
  const fields = new Set(['type', ...LEVEL_ACTIONS[a.type]]);
  for (const k of Object.keys(a)) assert.ok(fields.has(k), `${where}: ${a.type} has an unknown field '${k}'`);
  const sections = spec.sections.map((s) => s.id);
  const anchors = anchorsOf(m.map);
  switch (a.type) {
    case 'gate': assert.ok(spec.gates.some((g) => g.id === a.id), `${where}: gate '${a.id}' of ${m.map}`); break;
    case 'horde':
      assert.ok(a.at ? anchors.includes(a.at) : sections.includes(a.section), `${where}: horde from '${a.at || a.section}'`);
      assert.ok(isInt(a.count) && a.count >= 3 && a.count <= 16, `${where}: horde of ${a.count} (3..16, written for four)`);
      assert.ok(a.zombie === 'any' || ZOMBIE_IDS.includes(a.zombie), `${where}: horde zombie '${a.zombie}'`);
      assert.ok(a.zombie !== 'brute' && a.zombie !== 'boss', `${where}: a horde is never a Brute or the boss (they are set pieces of their own)`);
      break;
    case 'explode': assert.ok(anchors.includes(a.at) && a.r >= 100 && a.r <= 400 && a.damage > 0, `${where}: explode at '${a.at}'`); break;
    case 'lights': assert.ok(sections.includes(a.section) && typeof a.on === 'boolean', `${where}: lights of '${a.section}'`); break;
    case 'title': assert.ok(nonEmpty(a.text) && a.text.length <= 48 && a.text === a.text.toUpperCase() && (!a.sub || (nonEmpty(a.sub) && a.sub.length <= 48)), `${where}: title card '${a.text}'`); break;
    case 'music': assert.ok(Object.hasOwn(MUSIC_STATES, a.state), `${where}: music state '${a.state}' is in audio/music.js`); break;
    case 'shake': assert.ok(a.k > 0 && a.k <= 1, `${where}: shake ${a.k}`); break;
    case 'checkpoint': assert.ok(sections.includes(a.section), `${where}: checkpoint in '${a.section}'`); break;
    default: break;
  }
  if (a.delay !== undefined) assert.ok(a.delay > 0 && a.delay <= 10, `${where}: delay ${a.delay} (the beat follows the objective)`);
}

/** Local mirror of STORY.md §5.4 for one step. */
function checkStep(m, s, where) {
  assert.ok(nonEmpty(s.id), `${where}: id`);
  assert.ok(STEP_TYPES.includes(s.type), `${where}: unknown step type '${s.type}'`);
  const allowed = new Set([...COMMON, ...PARAMS[s.type]]);
  for (const k of Object.keys(s)) assert.ok(allowed.has(k), `${where}: unknown param '${k}' on a '${s.type}' step`);
  const A = anchorsOf(m.map);
  const anchor = (a, w) => assert.ok(A.includes(a), `${where}: anchor '${a}' is not in the ${m.map} vocabulary (${w})`);
  const anchors = (arr, w) => { assert.ok(Array.isArray(arr) && arr.length > 0, `${where}: ${w} needs anchors`); arr.forEach((a) => anchor(a, w)); };
  const level = LEVEL_SPECS[m.map];
  switch (s.type) {
    case 'defend':
      anchor(s.target, 'target');
      if (!level) {
        assert.equal(s.target, OBJECTIVE_ANCHOR[m.map], `${where}: defend target is the map's objective`);
        assert.ok(isInt(s.waves) && s.waves >= 1 && s.waves <= 6, `${where}: waves`);
      } else {
        assert.ok(isNum(s.seconds) && s.seconds >= 30 && s.seconds <= 150, `${where}: a defend point is held 30..150 s`);
      }
      break;
    case 'waves':
      assert.ok(isInt(s.count) && s.count >= 1, `${where}: count`);
      break;
    case 'survive':
      assert.ok(isNum(s.seconds) && s.seconds >= 15 && s.seconds <= 240, `${where}: seconds 15..240`);
      break;
    case 'collect':
      assert.ok(story.ITEM_KINDS.includes(s.item), `${where}: item '${s.item}'`);
      assert.ok(s.item === 'note' || STORY_ITEMS[s.item], `${where}: item '${s.item}' has a look in story-defs.js`);
      assert.ok(isInt(s.count) && s.count >= 1 && s.count <= 8, `${where}: count`);
      anchors(s.at, 'at');
      if (s.item === 'note') assert.ok(NOTES[s.note], `${where}: note '${s.note}' exists`);
      else assert.equal(s.note, undefined, `${where}: only notes carry note:`);
      break;
    case 'reach':
      if (s.section !== undefined) {
        assert.ok(level && level.sections.some((q) => q.id === s.section), `${where}: section '${s.section}' of ${m.map}`);
        assert.equal(s.at, undefined, `${where}: reach takes at or section`);
      } else anchor(s.at, 'at');
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
      assert.ok(s.zombie === 'any' || ZOMBIE_IDS.includes(s.zombie), `${where}: zombie '${s.zombie}'`);
      assert.ok(isInt(s.count) && s.count >= 1 && s.count <= 16, `${where}: count`);
      if (s.at !== undefined) anchor(s.at, 'at');
      assert.ok(/zombieKey/.test(s.todo || ''), `${where}: kill uses zombie: (todo zombieKey)`);
      break;
    case 'boss':
      assert.equal(s.zombie, 'boss', `${where}: boss type`);
      if (s.at !== undefined) anchor(s.at, 'at');
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
      if (s.talk) assert.ok(SPEAKERS.includes(s.npc) && CAST[s.npc].look, `${where}: a talk step names an NPC with a body`);
      break;
    default: break;
  }
  if (s.text !== undefined) assert.ok(nonEmpty(s.text) && s.text.length <= 88, `${where}: HUD text 1..88 chars`);
  if (!['wait', 'dialogue'].includes(s.type)) assert.ok(nonEmpty(s.text), `${where}: a HUD line`);
  if (s.pressure) {
    const p = s.pressure;
    assert.ok(isNum(p.waves) && p.waves >= 1 && p.waves <= 12, `${where}: pressure.waves`);
    assert.ok(isNum(p.pace) && p.pace >= 0.2 && p.pace <= 1.8, `${where}: pressure.pace ${p.pace} 0.2..1.8`);
    if (p.specials) p.specials.forEach((z) => assert.ok(ZOMBIE_IDS.includes(z), `${where}: special '${z}'`));
    assert.deepEqual(Object.keys(p).filter((k) => !['waves', 'pace', 'specials', 'section'].includes(k)), [], `${where}: pressure keys`);
    if (p.section !== undefined) assert.ok(level && level.sections.some((q) => q.id === p.section), `${where}: pressure.section '${p.section}'`);
    // a surge is short: zombies need 15+ s to arrive from the map edge, so keep the loud parts brief
    if (p.pace > 1.3 && s.type === 'survive') assert.ok(s.seconds <= 60, `${where}: a pace ${p.pace} surge lasts at most 60 s`);
  }
  if (s.parallel !== undefined) assert.equal(s.parallel, true, `${where}: parallel is true when present`);
  if (s.onStart) checkRadio(s.onStart, `${where}.onStart`, m);
  if (s.onDone) checkRadio(s.onDone, `${where}.onDone`, m);
  if (s.flags) for (const [k, v] of Object.entries(s.flags)) assert.ok(/^[a-z][a-z0-9_]*$/.test(k) && v === true, `${where}: flag ${k}`);
  if (s.todo) for (const k of s.todo.split(',')) assert.ok(story.TODO_REQUESTS[k.trim()], `${where}: todo '${k}' is documented in TODO_REQUESTS`);
  for (const k of ['follow', 'remove']) if (s[k]) s[k].forEach((id) => assert.ok(CAST[id] && CAST[id].look, `${where}: ${k} '${id}'`));
  if (s.npcs) s.npcs.forEach((n) => { assert.ok(CAST[n.id] && CAST[n.id].look, `${where}: npc '${n.id}'`); anchor(n.at, 'npcs.at'); });
}

/** Highest virtual wave a mission's steps reach (defend/waves steps count up from pressure.waves). */
function maxVirtualWave(m) {
  let w = 0;
  for (const s of [...m.steps, ...(m.bonus || [])]) {
    if (!s.pressure) continue;
    const extra = s.type === 'defend' && s.waves ? s.waves - 1 : s.type === 'waves' ? s.count - 1 : 0;
    w = Math.max(w, s.pressure.waves + extra);
  }
  return w;
}

/** Zombie types that can appear in a mission (natural mix at its virtual waves + forced specials + kill/boss steps + hordes). */
function typesIn(m) {
  const set = new Set();
  for (const s of [...m.steps, ...(m.bonus || [])]) {
    if (s.zombie && s.zombie !== 'any') set.add(s.zombie);
    for (const a of actionsOf(s)) if (a.type === 'horde' && a.zombie !== 'any') set.add(a.zombie);
    if (!s.pressure) continue;
    const extra = s.type === 'defend' && s.waves ? s.waves - 1 : s.type === 'waves' ? s.count - 1 : 0;
    for (let w = s.pressure.waves; w <= s.pressure.waves + extra; w++) {
      for (const id of ZOMBIE_IDS) if (ZOMBIES[id].weight(w) > 0) set.add(id);
    }
    (s.pressure.specials || []).forEach((z) => set.add(z));
  }
  return set;
}

/** A rough play time in seconds: walking, fighting, holding, talking (a party of four, no hurry). */
function estimateSeconds(m) {
  let t = 0;
  for (const s of m.steps) {
    if (s.parallel) continue;
    switch (s.type) {
      case 'kill': t += 20 + s.count * 3; break;
      case 'collect': t += 20 + s.count * 15; break;
      case 'activate': t += 20 + s.hold * s.at.length; break;
      case 'reach': t += s.section ? 45 : 25 + (s.hold || 0); break;
      case 'survive': t += s.seconds; break;
      case 'defend': t += s.seconds || s.waves * 60; break;
      case 'dialogue': t += s.lines.length * 4 + (s.talk ? 10 : 0); break;
      case 'wait': t += s.seconds; break;
      case 'escort': t += 90; break;
      case 'boss': t += 120; break;
      default: t += 60;
    }
  }
  return t;
}

// ---- flags and conditions ------------------------------------------------------------------------------
function producedFlags() {
  const f = new Set(['seen_epilogue']);
  for (const m of MISSIONS) {
    Object.keys(m.rewards.flags || {}).forEach((k) => f.add(k));
    [...m.steps, ...(m.bonus || [])].forEach((s) => Object.keys(s.flags || {}).forEach((k) => f.add(k)));
  }
  for (const c of CHAPTERS) if (c.arrival) f.add(c.arrival.flag);
  for (const npc of Object.values(DIALOGUE.talk)) for (const stage of Object.values(npc)) for (const tp of stage.topics) Object.keys(tp.setFlags || {}).forEach((k) => f.add(k));
  return f;
}
function checkWhen(when, where, flags) {
  if (!when) return;
  assert.deepEqual(Object.keys(when).filter((k) => !['flags', 'notFlags', 'done', 'notDone'].includes(k)), [], `${where}: when keys`);
  [...(when.flags || []), ...(when.notFlags || [])].forEach((k) => assert.ok(flags.has(k), `${where}: unknown flag '${k}'`));
  [...(when.done || []), ...(when.notDone || [])].forEach((k) => assert.ok(ALL_IDS.includes(k), `${where}: unknown mission '${k}'`));
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

  test('people join where the new road puts them: Deke and Ozzy on Mill Road, Priya at the mall, Okafor at Fort Harlan', () => {
    const joins = (id) => CAST[id].joins && CAST[id].joins.mission;
    assert.equal(joins('mara'), 'm1_1');
    assert.equal(joins('deke'), 'm1_2');
    assert.equal(joins('ozzy'), 'm1_2');
    assert.equal(joins('priya'), 'm3_1');
    assert.equal(joins('okafor'), 'm4_2');
    assert.equal(joins('danny'), 'm4_2');
    assert.deepEqual([joins('quill'), joins('dutch'), joins('wendell')], ['sj_diner', 'sj_hauler', 'sj_cargo'], 'three friends only come home through side jobs');
    for (const c of Object.values(CAST)) {
      if (!c.joins || !c.joins.mission) continue;
      assert.ok(mission(c.joins.mission), `${c.id}: joins at a mission that exists`);
    }
    // a mission's unlockNpc (the debrief's "joined the crew") is one of the people who join there
    const unlocked = MISSIONS.filter((m) => m.rewards.unlockNpc).map((m) => [m.id, m.rewards.unlockNpc]);
    for (const [id, npc] of unlocked) assert.equal(joins(npc), id, `${npc} is unlocked where they join`);
    assert.equal(new Set(unlocked.map((u) => u[1])).size, unlocked.length, 'nobody is unlocked twice');
  });
});

// =======================================================================================================
describe('the twelve story missions (JOURNEY.md §2)', () => {
  test('ids, order, titles, chapters, maps and times of day', () => {
    assert.deepEqual(STORY_MISSIONS.map((m) => m.id), ORDER);
    assert.deepEqual(MISSIONS.slice(0, 12).map((m) => m.id), ORDER, 'the story comes first in MISSIONS');
    STORY_MISSIONS.forEach((m) => {
      const [title, map, time] = STORY[m.id];
      assert.equal(m.title, title, `${m.id}: title`);
      assert.equal(m.chapter, Number(m.id[1]), `${m.id}: chapter`);
      assert.equal(m.index, Number(m.id[3]), `${m.id}: index`);
      assert.equal(m.map, map, `${m.id}: map`);
      assert.equal(m.time, time, `${m.id}: plays by ${time} (JOURNEY.md §2.1)`);
      assert.ok(MODES.includes(m.mode), `${m.id}: mode`);
      assert.notEqual(m.side, true, `${m.id}: not a side job`);
    });
    assert.equal(STORY_MISSIONS.filter((m) => m.time === 'day').length, 9, 'nine of the twelve play by day');
    assert.deepEqual(STORY_MISSIONS.filter((m) => m.time === 'night').map((m) => m.id), ['m1_1', 'm2_2', 'm4_2'], 'the bus, the hospital and the airbase in the rain');
    assert.equal(mission('m1_1').mode, 'defend', 'the bus is kept as it was');
    assert.equal(mission('m6_1').mode, 'campaign');
    assert.equal(mission('m6_2').mode, 'campaign');
    assert.deepEqual(LEVEL_MISSIONS.map((id) => mission(id).map).sort(), [...LEVEL_IDS].sort(), 'each story level is walked by exactly one mission');
    for (const id of LEVEL_MISSIONS) assert.equal(mission(id).mode, 'free', `${id}: a level plays mode "free"`);
    assert.deepEqual(story.ANCHORS, ANCHORS, 'the classic maps\' vocabulary matches STORY.md section 5.2');
  });

  test('chapters: six on the road plus the side jobs, each with a card; hideouts after chapters 1, 3 and 5', () => {
    const road = CHAPTERS.filter((c) => !c.side);
    assert.deepEqual(road.map((c) => c.title), CHAPTER_TITLES);
    road.forEach((c, i) => {
      assert.equal(c.n, i + 1);
      assert.deepEqual(c.missions, ORDER.filter((id) => id[1] === String(i + 1)), `chapter ${c.n}: missions`);
      assert.deepEqual(c.maps, [...new Set(c.missions.map((id) => mission(id).map))], `chapter ${c.n}: maps`);
      assert.ok(nonEmpty(c.subtitle) && nonEmpty(c.card), `chapter ${c.n}: card`);
      checkLines([c.epigraph], `chapter ${c.n} epigraph`);
    });
    const side = CHAPTERS.find((c) => c.side);
    assert.ok(side && side.n === SIDE_CHAPTER && side.title === 'Side Jobs' && !side.arrival, 'the side jobs have their own chapter card');
    assert.deepEqual(side.missions, SIDE_JOBS.map((m) => m.id));
    assert.deepEqual(CHAPTERS.filter((c) => c.arrival).map((c) => [c.n, c.arrival.hideout]), [[1, 'roadhouse'], [3, 'depot'], [5, 'farmstead']]);
    const flags = producedFlags();
    for (const c of CHAPTERS.filter((x) => x.arrival)) {
      checkLines(c.arrival.scene, `arrival ${c.arrival.hideout}`, { min: 12, max: 24, flags });
      assert.ok(HIDEOUTS[c.arrival.hideout], 'hideout exists');
      assert.equal(c.endsAt, c.arrival.hideout);
      assert.equal(mission(c.missions[c.missions.length - 1]).after, `hideout:${c.arrival.hideout}`, 'the last mission leads to the hideout');
    }
    assert.deepEqual(Object.keys(HIDEOUTS), ['roadhouse', 'depot', 'farmstead']);
    checkLines(CHAPTERS[5].epilogue, 'epilogue', { min: 20, max: 80, flags });
  });

  for (const id of ORDER) {
    test(`${id}: fields, briefing/debrief, steps and rewards`, () => {
      const m = mission(id);
      const flags = producedFlags();
      assert.ok(nonEmpty(m.blurb) && m.blurb.length <= 260, 'blurb');
      assert.ok(isInt(m.level[0]) && isInt(m.level[1]) && m.level[0] >= 1 && m.level[1] >= m.level[0] && m.level[1] <= 20, 'level band');
      assert.ok(m.party && m.party.min === 1 && m.party.max === 6, 'party 1..6');
      checkLines(m.briefing, `${id}.briefing`, { min: 6, max: 16, flags });
      checkLines(m.debrief, `${id}.debrief`, { min: 4, max: 10, flags });
      assert.ok(m.briefing[0].who === 'narrator' && /^DAY \{day\}\. /.test(m.briefing[0].text), `${id}: the briefing opens on the day card`);

      const ids = new Set();
      [...m.steps, ...(m.bonus || [])].forEach((s, i) => {
        checkStep(m, s, `${id}.${s.id || i}`);
        assert.ok(!ids.has(s.id), `${id}: duplicate step id ${s.id}`);
        ids.add(s.id);
      });
      assert.ok(m.steps.length >= 5 && m.steps.length <= 40, `${id}: ${m.steps.length} steps`);
      const types = new Set(m.steps.map((s) => s.type));
      assert.ok(types.size >= 3, `${id}: varied step types (${[...types].join(', ')})`);
      const spoken = m.steps.filter((s) => [...(s.onStart || []), ...(s.onDone || [])].some((l) => !isAction(l)));
      assert.ok(spoken.length >= 3, `${id}: at least three steps with radio chatter`);
      assert.ok(!m.steps[m.steps.length - 1].parallel, `${id}: the last step cannot be parallel`);
      assert.ok(m.mode === 'campaign' || m.steps.some((s) => s.pressure), `${id}: some zombie pressure (the campaign director places its own)`);

      for (const b of m.bonus || []) {
        assert.ok(['collect', 'reach', 'activate'].includes(b.type), `${id}.${b.id}: bonus type`);
        if (b.since) assert.ok(m.steps.some((s) => s.id === b.since), `${id}.${b.id}: since '${b.since}' is a main step`);
        assert.ok(/noteRef|stepFlags/.test(b.todo || ''), `${id}.${b.id}: bonus steps flag their extensions`);
      }
      assert.ok(m.todo && /bonus/.test(m.todo) && /graph/.test(m.todo), `${id}: mission-level todo`);

      assert.ok(isNum(m.stars.time) && m.stars.time >= 400 && m.stars.time <= 1500, 'par time');
      assert.equal(m.stars.noDowns, true);
      assert.equal(m.stars.optional, 'collectAll');
      assert.ok((m.bonus || []).length >= 1, 'optional objectives exist for the third star');

      const r = m.rewards;
      assert.ok(isInt(r.xp) && r.xp >= 150 && r.xp <= 1000, 'xp');
      assert.ok(isInt(r.scrap) && r.scrap >= 40 && r.scrap <= 220, 'scrap 40..220');
      assert.ok(isInt(r.upgradePoints) && r.upgradePoints >= 0 && r.upgradePoints <= 3, 'upgrade points');
      if (r.weapon) assert.ok(WEAPONS[r.weapon], `weapon '${r.weapon}' exists`);
      if (r.unlockNpc) assert.ok(story.NPC_IDS.includes(r.unlockNpc), `unlockNpc '${r.unlockNpc}' is in the cast`);
      for (const [k, v] of Object.entries(r.flags || {})) assert.ok(/^[a-z][a-z0-9_]*$/.test(k) && v === true, `flag ${k}`);
      assert.deepEqual(Object.keys(r).filter((k) => !['xp', 'scrap', 'weapon', 'upgradePoints', 'flags', 'unlockNpc'].includes(k)), [], 'reward keys');

      assert.ok(Array.isArray(m.requires) && m.requires.every((q) => ORDER.indexOf(q) >= 0 && ORDER.indexOf(q) < ORDER.indexOf(id)), 'requires point backwards along the road');
      assert.ok(m.hub === null || HIDEOUTS[m.hub], 'hub');
      assert.ok(/^(m\d_\d|hideout:(roadhouse|depot|farmstead)|epilogue)$/.test(m.after), 'after');
    });
  }

  test('the finale keeps its campaign stages in order, and the specials have their set pieces', () => {
    const stagesOf = (id) => mission(id).steps.filter((s) => s.type === 'campaignStage').map((s) => s.stage);
    assert.deepEqual(stagesOf('m6_1'), ['hill']);
    assert.deepEqual(stagesOf('m6_2'), ['breakout', 'tower', 'roof', 'zip']);
    assert.ok(mission('m1_1').steps.some((s) => s.type === 'defend' && s.target === 'bus'), 'the bus is defended');
    assert.ok(mission('m5_1').steps.some((s) => s.type === 'boss'), 'the Abomination lives in the metro works');
    assert.ok(mission('m2_2').steps.some((s) => s.type === 'kill' && s.zombie === 'bloater' && s.count === 1), 'the swollen patient in surgery');
    assert.ok(mission('m4_1').steps.some((s) => s.type === 'kill' && s.zombie === 'brute' && s.count === 1), 'the first Brute on the rail bridge');
  });
});

// =======================================================================================================
describe('the nine story levels, walked section by section (JOURNEY.md §2, §4.3)', () => {
  for (const id of LEVEL_MISSIONS) {
    test(`${id}: every section of ${STORY[id][1]} has its arrival, its objective, its set piece, and its gate in order`, () => {
      const m = mission(id);
      const spec = LEVEL_SPECS[m.map];
      const secs = spec.sections.map((s) => s.id);
      // where the crew enters each section: the start for the first, a reach { section } for the others, in SPEC order
      const entry = secs.map((sec, i) => (i === 0 ? 0 : m.steps.findIndex((s) => s.type === 'reach' && s.section === sec)));
      entry.forEach((e, i) => assert.ok(e >= 0, `${id}: the crew walks into '${secs[i]}'`));
      for (let i = 1; i < entry.length; i++) assert.ok(entry[i] > entry[i - 1], `${id}: '${secs[i]}' comes after '${secs[i - 1]}'`);
      assert.equal(m.steps.filter((s) => s.type === 'reach' && s.section).length, secs.length - 1, `${id}: one arrival per section`);
      // the mission opens with the level's title card
      assert.ok(actionsOf(m.steps[0]).some((a) => a.type === 'title'), `${id}: the first step puts up the title card`);
      // every gate opens exactly once, in its section's span, before the next section is entered
      const opened = [];
      m.steps.forEach((s, k) => actionsOf(s).forEach((a) => { if (a.type === 'gate' && a.open !== false) opened.push([a.id, k]); }));
      assert.deepEqual(opened.map((o) => o[0]), spec.gates.map((g) => g.id), `${id}: the gates open once each, in route order`);
      for (const [gid, k] of opened) {
        const g = spec.gates.find((q) => q.id === gid);
        const from = secs.indexOf(g.from), to = secs.indexOf(g.to);
        assert.ok(k >= entry[from] && k < entry[to], `${id}: gate '${gid}' opens while the crew is in '${g.from}'`);
      }
      // each section's span: its own beats
      secs.forEach((sec, i) => {
        const span = m.steps.slice(entry[i], i + 1 < secs.length ? entry[i + 1] : m.steps.length);
        const acts = span.flatMap(actionsOf);
        const near = new Set([sec, secs[i - 1], secs[i + 1]].filter(Boolean));
        if (i > 0) {
          const arr = m.steps[entry[i]];
          assert.ok(actionsOf(arr).some((a) => a.type === 'title'), `${id}/${sec}: a title card on arrival`);
          assert.ok(actionsOf(arr).some((a) => a.type === 'checkpoint' && a.section === sec), `${id}/${sec}: the checkpoint moves in`);
          assert.ok([...(arr.onDone || []), ...(arr.onStart || [])].some((l) => !isAction(l)) || span.some((s) => s.type === 'dialogue'), `${id}/${sec}: somebody says something on arrival`);
        }
        const objectives = span.filter((s) => OBJECTIVE_TYPES.includes(s.type) && !(s.type === 'reach' && s.section) && s.pressure && near.has(s.pressure.section));
        assert.ok(objectives.length >= 1, `${id}/${sec}: an objective under pressure from this part of the level`);
        assert.ok(span.some((s) => s.pressure && s.pressure.section === sec), `${id}/${sec}: the section's own zombies come out`);
        assert.ok(acts.some((a) => SET_PIECES.includes(a.type)), `${id}/${sec}: a set piece (horde, blast, lights, music or shake)`);
      });
      // a section is only named after the crew has come near it (no zombies from far ahead or far behind)
      m.steps.forEach((s, k) => {
        const here = entry.filter((e) => e <= k).length - 1;
        if (s.pressure && s.pressure.section) assert.ok(Math.abs(secs.indexOf(s.pressure.section) - here) <= 1, `${id}.${s.id}: pressure from '${s.pressure.section}' near '${secs[here]}'`);
        for (const a of actionsOf(s)) {
          const sec = a.section || (a.type === 'horde' && a.at ? Object.keys(spec.anchors).find((q) => spec.anchors[q].includes(a.at)) : null);
          if (sec && a.type !== 'lights') assert.ok(Math.abs(secs.indexOf(sec) - here) <= 1, `${id}.${s.id}: ${a.type} in '${sec}' near '${secs[here]}'`);
        }
      });
      // 12 to 25 minutes, a par time to match, and a mix of objective types
      const est = estimateSeconds(m);
      assert.ok(est >= 12 * 60 && est <= 25 * 60, `${id}: about ${Math.round(est / 60)} minutes of play`);
      assert.ok(m.stars.time >= est * 0.9 && m.stars.time <= est * 2, `${id}: par ${m.stars.time} s for about ${est} s of play`);
      const kinds = new Set(m.steps.filter((s) => OBJECTIVE_TYPES.includes(s.type) && !(s.type === 'reach' && s.section)).map((s) => s.type));
      assert.ok(kinds.size >= 4, `${id}: at least four kinds of objective (${[...kinds].join(', ')})`);
      // bonus: a lore note and an optional objective of another kind
      assert.ok(m.bonus.some((b) => b.item === 'note') && m.bonus.some((b) => b.item !== 'note'), `${id}: a note and a side objective`);
      assert.ok(m.npcs === undefined || m.npcs.every((n) => anchorsOf(m.map).includes(n.at)), `${id}: NPCs stand at the level's anchors`);
    });
  }
});

// =======================================================================================================
describe('the side jobs of the hideout board', () => {
  test('the old missions, each a side job: optional, filed under the side chapter, back to the hideout', () => {
    assert.deepEqual(SIDE_JOBS.map((m) => m.title), SIDE_TITLES);
    assert.deepEqual(MISSIONS.slice(12).map((m) => m.id), SIDE_JOBS.map((m) => m.id), 'after the story in MISSIONS');
    SIDE_JOBS.forEach((m, i) => {
      assert.equal(m.side, true, `${m.id}: side`);
      assert.equal(m.chapter, SIDE_CHAPTER, `${m.id}: filed under the side-jobs chapter`);
      assert.equal(m.index, i + 1, `${m.id}: board order`);
      assert.ok(isInt(m.opens) && m.opens >= 1 && m.opens <= 6, `${m.id}: opens in a story chapter`);
      assert.equal(m.after, 'hideout', `${m.id}: back to the hideout the crew is in`);
      assert.ok(HIDEOUTS[m.hub], `${m.id}: first offered at a hideout`);
      assert.ok(m.requires.length >= 1 && m.requires.every((r) => mission(r)), `${m.id}: requires`);
      assert.ok(!LEVEL_IDS.includes(m.map), `${m.id}: plays on a classic map`);
      assert.ok(/^sj_[a-z]+$/.test(m.id), `${m.id}: id`);
    });
    // each opens with the chapter it belongs to: the story mission it needs is in (or just before) that chapter
    for (const m of SIDE_JOBS) {
      const last = story.opensAfter(m);
      const at = mission(last).chapter;
      assert.ok(at === m.opens || at === m.opens - 1, `${m.id}: opens after ${last} (chapter ${at}), filed under chapter ${m.opens}`);
      const hub = mission(last).after.startsWith('hideout:') ? mission(last).after.slice(8) : mission(last).hub || m.hub;
      assert.ok([hub, m.hub].includes(m.hub), `${m.id}: first seen at ${m.hub}`);
    }
  });

  for (const m of SIDE_JOBS) {
    test(`${m.id}: fields, briefing/debrief, steps and rewards`, () => {
      const flags = producedFlags();
      checkLines(m.briefing, `${m.id}.briefing`, { min: 5, max: 14, flags });
      checkLines(m.debrief, `${m.id}.debrief`, { min: 4, max: 10, flags });
      const ids = new Set();
      [...m.steps, ...(m.bonus || [])].forEach((s, i) => {
        checkStep(m, s, `${m.id}.${s.id || i}`);
        assert.ok(!ids.has(s.id), `${m.id}: duplicate step id ${s.id}`);
        ids.add(s.id);
      });
      assert.ok(m.steps.length >= 5, 'at least five steps');
      assert.ok(m.todo && /side/.test(m.todo) && /graph/.test(m.todo), 'side todo');
      assert.ok((m.bonus || []).length >= 1 && m.stars.optional === 'collectAll', 'a bonus for the third star');
      const r = m.rewards;
      assert.ok(isInt(r.xp) && r.xp >= 150 && r.xp <= 500, 'xp');
      assert.ok(isInt(r.scrap) && r.scrap >= 40 && r.scrap <= 160, 'scrap');
      assert.ok(r.upgradePoints >= 1, 'side jobs pay a hideout part');
      // a side job pays less than the story mission that follows its opening
      const next = STORY_MISSIONS[STORY_MISSIONS.findIndex((q) => q.id === story.opensAfter(m)) + 1];
      if (next) assert.ok(r.xp < next.rewards.xp, `${m.id}: pays less than ${next.id}`);
      // people who are not with the crew yet never speak in its briefing without a condition
      for (const l of [...m.briefing, ...m.debrief]) {
        const c = CAST[l.who];
        const j = c && c.joins && c.joins.mission;
        if (!j || l.when || j === m.id) continue;
        assert.ok(m.requires.includes(j) || requiresDeep(m, j) || story.missionIndex(j) <= story.missionIndex(story.opensAfter(m)), `${m.id}: ${l.who} is with the crew by then`);
      }
    });
  }

  test('side jobs never enter the story: nextNodes skips them, the board lists them, and the story ends without them', () => {
    const w = { progress: { completed: {}, flags: {} }, hideout: { current: 'roadhouse', recruited: {} } };
    for (const id of ['m1_1', 'm1_2']) w.progress.completed[id] = { stars: 1 };
    w.progress.flags.seen_arrival_roadhouse = true;
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['m2_1'], 'only the story is a node');
    const board = story.sideJobStates(w);
    assert.deepEqual(board.filter((b) => b.state === 'available').map((b) => b.id), ['sj_fuel', 'sj_diner'], 'the Roadhouse board after Mill Road');
    assert.ok(board.filter((b) => b.state === 'locked').length === 10);
    w.progress.completed.sj_diner = { stars: 3 };
    const again = story.sideJobStates(w);
    assert.equal(again.find((b) => b.id === 'sj_diner').state, 'done');
    assert.equal(again.find((b) => b.id === 'sj_diner').stars, 3);
    assert.equal(again.find((b) => b.id === 'sj_hauler').state, 'available', 'Night Hauler follows Quill\'s rumor');
    assert.deepEqual(nextNodes(w).map((n) => n.id), ['m2_1'], 'a side job changes nothing on the road');
    // all the story done, no side job: the epilogue
    const all = { progress: { completed: Object.fromEntries(ORDER.map((id) => [id, { stars: 1 }])), flags: { seen_arrival_roadhouse: true, seen_arrival_depot: true, seen_arrival_farmstead: true } } };
    assert.deepEqual(nextNodes(all), [{ kind: 'epilogue', id: 'epilogue' }]);
    assert.equal(story.currentChapter(w).n, 2, 'the chapter follows the story, not the board');
    assert.deepEqual(story.afterMission('sj_fuel', { hideout: { current: 'depot' } }), { kind: 'hideout', id: 'depot' }, 'back to the hideout the crew is in');
    assert.deepEqual(story.afterMission('sj_fuel'), { kind: 'hideout', id: 'roadhouse' });
  });
});

// =======================================================================================================
describe('the unlock chain', () => {
  const freshWorld = () => ({ progress: { node: 'hideout:roadhouse', completed: {}, flags: {} }, hideout: { recruited: {} } });

  test('walking the campaign with nextNodes() visits the twelve story missions, three arrivals and the epilogue', () => {
    const w = freshWorld();
    const seen = [];
    for (let i = 0; i < 60; i++) {
      const nodes = nextNodes(w);
      if (!nodes.length) break;
      const n = nodes[0];
      if (n.kind === 'hideout') {
        assert.equal(n.arrival, true);
        const ch = CHAPTERS.find((c) => c.arrival && c.arrival.hideout === n.id);
        w.progress.flags[ch.arrival.flag] = true;
        seen.push(`H:${n.id}`);
      } else if (n.kind === 'mission') {
        assert.ok(mission(n.id) && !mission(n.id).side, 'node is a story mission');
        w.progress.completed[n.id] = { stars: 1, time: 500 };
        seen.push(n.id);
      } else if (n.kind === 'epilogue') {
        w.progress.flags[story.EPILOGUE_FLAG] = true;
        seen.push('epilogue');
      }
    }
    assert.deepEqual(seen, ['m1_1', 'm1_2', 'H:roadhouse', 'm2_1', 'm2_2', 'm3_1', 'm3_2', 'H:depot',
      'm4_1', 'm4_2', 'm5_1', 'm5_2', 'H:farmstead', 'm6_1', 'm6_2', 'epilogue']);
    assert.deepEqual(nextNodes(w), [], 'nothing left afterwards');
  });

  test('road missions chain directly, hub missions start at their hideout; a fresh world starts at 1.1', () => {
    assert.deepEqual(nextNodes(null).map((n) => n.id), ['m1_1']);
    assert.deepEqual(nextNodes({}).map((n) => n.id), ['m1_1']);
    assert.equal(nextNodes(freshWorld())[0].direct, true, '1.1 starts at once');
    for (const m of STORY_MISSIONS) {
      assert.equal(m.hub === null, ['m1_1', 'm1_2', 'm3_2', 'm4_2', 'm5_2', 'm6_2'].includes(m.id), `${m.id}: hub null only on the road`);
    }
    assert.deepEqual(story.afterMission('m1_1'), { kind: 'mission', id: 'm1_2' });
    assert.deepEqual(story.afterMission('m2_1'), { kind: 'hideout', id: 'roadhouse' });
    assert.deepEqual(story.afterMission('m4_1'), { kind: 'mission', id: 'm4_2' });
    assert.deepEqual(story.afterMission('m4_2'), { kind: 'hideout', id: 'depot' });
    assert.deepEqual(story.afterMission('m6_2'), { kind: 'epilogue', id: 'epilogue' });
    assert.equal(story.afterMission('nope'), null);
  });

  test('nextNodes and the helpers do not mutate their input', () => {
    const w = freshWorld();
    w.progress.completed.m1_1 = { stars: 3 };
    const before = JSON.stringify(w);
    nextNodes(w); story.missionStates(w); story.sideJobStates(w); story.npcsAt(w); story.currentChapter(w); story.stageFor('roadhouse', w);
    assert.equal(JSON.stringify(w), before);
    const states = story.missionStates(w);
    assert.equal(states.length, 12);
    assert.equal(states[0].state, 'done');
    assert.equal(states[0].stars, 3);
    assert.equal(states[1].state, 'available');
    assert.equal(states[3].state, 'locked');
  });

  test('who is at the hideout follows the road', () => {
    const w = freshWorld();
    const at = () => story.npcsAt(w);
    assert.deepEqual(at(), []);
    w.progress.completed.m1_1 = { stars: 1 };
    assert.deepEqual(at(), ['mara']);
    w.progress.completed.m1_2 = { stars: 1 };
    assert.deepEqual(at().sort(), ['deke', 'june', 'mara', 'ozzy', 'roz'], 'Deke and Ozzy from Mill Road; Roz and June live at the Roadhouse');
    w.progress.completed.sj_diner = { stars: 1 };
    assert.ok(at().includes('quill'), 'Quill comes home with the Diner Siege');
    for (const id of ['m2_1', 'm2_2', 'm3_1']) w.progress.completed[id] = { stars: 1 };
    assert.ok(at().includes('priya'));
    for (const id of ['m3_2', 'm4_1', 'm4_2']) w.progress.completed[id] = { stars: 1 };
    assert.ok(at().includes('okafor') && at().includes('danny'));
    assert.ok(!at().includes('dutch') && !at().includes('wendell'), 'side-job friends only through their jobs');
  });
});

// =======================================================================================================
describe('rewards and the level curve', () => {
  test('the story alone carries a party to level 13-14, and every number ramps', () => {
    const total = story.totalRewardXp();
    assert.ok(total >= 6500 && total <= 8000, `total story xp ${total} in 6500..8000`);
    assert.ok(story.levelForXp(total) >= 13 && story.levelForXp(total) <= 15, 'the finale carries a party to level 13-14');
    for (let i = 1; i < STORY_MISSIONS.length; i++) {
      assert.ok(STORY_MISSIONS[i].rewards.xp >= STORY_MISSIONS[i - 1].rewards.xp, `${STORY_MISSIONS[i].id}: xp does not drop`);
      assert.ok(STORY_MISSIONS[i].rewards.scrap >= STORY_MISSIONS[i - 1].rewards.scrap, `${STORY_MISSIONS[i].id}: scrap does not drop`);
    }
    assert.equal(STORY_MISSIONS[11].rewards.xp, Math.max(...MISSIONS.map((m) => m.rewards.xp)), 'the finale pays best');
    assert.equal(STORY_MISSIONS[0].rewards.scrap, Math.min(...MISSIONS.map((m) => m.rewards.scrap)));
    const side = SIDE_JOBS.reduce((s, m) => s + m.rewards.xp, 0);
    assert.ok(story.levelForXp(total + side) <= 18, 'every side job on top still leaves room below the cap of 20');
  });

  test('level bands follow the cumulative XP curve round(90*(L-1)^1.7)', () => {
    assert.equal(story.xpForLevel(2), 90);
    assert.equal(story.xpForLevel(14), Math.round(90 * Math.pow(13, 1.7)));
    for (const m of MISSIONS) {
      const at = story.levelForXp(story.xpBefore(m.id));
      assert.ok(Math.abs(m.level[0] - at) <= 1, `${m.id}: recommended ${m.level[0]}, the curve says ${at}`);
      assert.ok(m.level[1] >= at, `${m.id}: band top`);
    }
    assert.equal(STORY_MISSIONS[0].level[0], 1);
    assert.ok(STORY_MISSIONS[11].level[1] >= 13 && STORY_MISSIONS[11].level[1] <= 14);
    for (let i = 1; i < STORY_MISSIONS.length; i++) assert.ok(STORY_MISSIONS[i].level[0] >= STORY_MISSIONS[i - 1].level[0], 'bands do not go backwards');
  });

  test('weapons along the road and in the side jobs, none twice', () => {
    const got = MISSIONS.filter((m) => m.rewards.weapon).map((m) => [story.storyChapterOf(m.id), m.rewards.weapon, m.side]);
    const inChapter = (ch, side = false) => got.filter((g) => g[0] === ch && !!g[2] === side).map((g) => g[1]);
    assert.ok(inChapter(1).includes('shotgun'), 'the pump shotgun from behind Deke\'s register');
    assert.ok(inChapter(2).some((w) => WEAPONS[w].category === 'smg'), 'an SMG in chapter 2');
    assert.ok(inChapter(5).includes('tesla'), 'the third-rail gun under the city');
    assert.ok(inChapter(6).includes('rocket') && inChapter(6).includes('railgun'), 'rocket and railgun in the finale');
    const all = got.map((g) => g[1]);
    assert.equal(new Set(all).size, all.length, 'no weapon is rewarded twice');
    assert.ok(all.length >= 22, `${all.length} guns handed out`);
  });
});

// =======================================================================================================
describe('the zombies arrive gradually and at a walking pace', () => {
  const chapterOf = (m) => (m.side ? m.opens : m.chapter);

  test('specials appear by chapter: walkers, runners and crawlers, bloaters and spitters, screamers and brutes, the boss', () => {
    const firstChapter = {};
    for (const m of STORY_MISSIONS) for (const z of typesIn(m)) if (!(z in firstChapter)) firstChapter[z] = m.chapter;
    assert.equal(firstChapter.walker, 1);
    assert.ok(firstChapter.runner <= 1 && firstChapter.crawler <= 1, 'runners and crawlers by the end of chapter 1');
    assert.ok(firstChapter.bloater >= 2 && firstChapter.spitter >= 3, 'the first bloater in surgery, spitters at Blackwater');
    assert.ok(firstChapter.screamer >= 4 && firstChapter.brute >= 4, 'screamers and Brutes on the rail line');
    assert.equal(firstChapter.boss, 5, 'the Abomination first shows under the city');
    assert.deepEqual([...typesIn(mission('m1_1'))], ['walker'], 'the night at the bus is walkers only');
    // a side job never shows a special before the story has introduced it
    for (const m of SIDE_JOBS) for (const z of typesIn(m)) assert.ok(firstChapter[z] <= chapterOf(m) + 1, `${m.id}: ${z} before its time`);
  });

  test('virtual wave numbers ramp with the chapters and stay inside what the wave tables support', () => {
    let prev = 0;
    for (const m of STORY_MISSIONS.filter((x) => x.mode !== 'campaign')) {
      const w = maxVirtualWave(m);
      assert.ok(w >= 1 && w <= 9, `${m.id}: virtual wave ${w}`);
      assert.ok(w >= prev - 1, `${m.id}: virtual wave ${w} does not fall far below ${prev}`);
      prev = Math.max(prev, w);
    }
    assert.equal(maxVirtualWave(mission('m1_1')), 1);
    assert.ok(maxVirtualWave(mission('m1_2')) <= 3, 'Mill Road stays gentle');
    assert.ok(maxVirtualWave(mission('m3_2')) <= 5, 'no natural Brutes before the rail yard');
    assert.ok(maxVirtualWave(mission('m4_2')) >= 6, 'screamer waves at Fort Harlan');
    for (const m of SIDE_JOBS) assert.ok(maxVirtualWave(m) <= chapterOf(m) + 3, `${m.id}: waves fit chapter ${chapterOf(m)}`);
  });

  test('a Brute is a set piece: at most 2 at once except Ghost squad\'s pack', () => {
    for (const m of MISSIONS) for (const s of m.steps) if (s.type === 'kill' && s.zombie === 'brute') {
      assert.ok(s.count <= (m.id === 'sj_ghosts' ? 3 : 2), `${m.id}.${s.id}: ${s.count} brutes`);
    }
  });
});

// =======================================================================================================
describe('lore notes', () => {
  test('thirty-seven notes, one bonus step each, in the mission and anchor they claim', () => {
    const ids = Object.keys(NOTES);
    assert.equal(ids.length, 37);
    assert.deepEqual(ids, Array.from({ length: 37 }, (_, i) => `n${String(i + 1).padStart(2, '0')}`));
    for (const n of Object.values(NOTES)) {
      const m = mission(n.mission);
      assert.ok(m, `${n.id}: mission`);
      const steps = (m.bonus || []).filter((s) => s.item === 'note' && s.note === n.id);
      assert.equal(steps.length, 1, `${n.id}: exactly one bonus collect step in ${n.mission}`);
      assert.deepEqual(steps[0].at, [n.at], `${n.id}: anchor`);
      assert.ok(anchorsOf(m.map).includes(n.at), `${n.id}: anchor exists on ${m.map}`);
      assert.ok(nonEmpty(n.title) && nonEmpty(n.text), `${n.id}: title and text`);
      assert.ok(n.text.length >= 40 && n.text.length <= 320, `${n.id}: ${n.text.length} chars`);
      assert.ok(sentences(n.text) >= 1 && sentences(n.text) <= 4, `${n.id}: ${sentences(n.text)} sentences`);
      assert.ok(isInt(n.day) && n.day >= 1 && n.day <= 50, `${n.id}: day`);
    }
    const noteSteps = MISSIONS.flatMap((m) => (m.bonus || []).filter((s) => s.item === 'note'));
    assert.equal(noteSteps.length, 37, 'no stray note steps');
    for (const m of MISSIONS) assert.deepEqual(m.notes, (m.bonus || []).filter((s) => s.item === 'note').map((s) => s.note), `${m.id}: notes[] lists its note ids`);
    for (const m of MISSIONS) assert.ok((m.bonus || []).filter((s) => s.item === 'note').length <= 2, `${m.id}: at most two notes`);
    for (const id of LEVEL_MISSIONS) assert.ok(mission(id).notes.length >= 1, `${id}: a note on every story level`);
  });

  test('the Warden clues are in the notes, and the road alone tells who she is', () => {
    const all = Object.values(NOTES).map((n) => n.text).join(' ');
    for (const word of ['Alcott', 'Halcyon', 'Operation Haven', 'D batteries', 'the Quiet', 'Delaney']) assert.ok(all.includes(word), `mentions ${word}`);
    const road = Object.values(NOTES).filter((n) => !mission(n.mission).side).map((n) => n.text).join(' ');
    for (const word of ['Alcott', 'granddaughter', 'Halcyon', 'harbor light']) assert.ok(road.includes(word), `the story missions' notes mention ${word}`);
  });
});

// =======================================================================================================
describe('dialogue', () => {
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
    assert.ok(count >= 130, `${count} topics`);
    // the cast members who are in a hideout have something to say in every stage they can be met in
    const worldThrough = (missionId, side = []) => {
      const w = { progress: { completed: {}, flags: {} }, hideout: { recruited: {} } };
      const give = (m) => {
        w.progress.completed[m.id] = { stars: 1 };
        Object.assign(w.progress.flags, m.rewards.flags || {});
        for (const s of [...m.steps, ...(m.bonus || [])]) Object.assign(w.progress.flags, s.flags || {});
      };
      for (const m of STORY_MISSIONS) {
        give(m);
        if (m.id === missionId) break;
      }
      for (const id of side) give(mission(id));
      for (const c of CHAPTERS) if (c.arrival && w.progress.completed[c.missions[c.missions.length - 1]]) w.progress.flags[c.arrival.flag] = true;
      return w;
    };
    const opened = (id) => SIDE_JOBS.filter((m) => story.missionIndex(story.opensAfter(m)) <= story.missionIndex(id)).map((m) => m.id);
    const latest = { rh1: 'm2_1', rh2: 'm2_2', dp1: 'm3_2', dp2: 'm5_1', fs: 'm6_1' };
    const earliest = { rh1: 'm1_2', rh2: 'm2_2', dp1: 'm3_2', dp2: 'm4_2', fs: 'm5_2' };
    for (const [npc, stages] of Object.entries(DIALOGUE.talk)) {
      for (const stage of Object.keys(stages)) {
        const late = worldThrough(latest[stage], opened(latest[stage]));
        assert.equal(story.stageFor(DIALOGUE.stages[stage].hideout, late), stage, `${stage}: its own world`);
        assert.ok(story.conversation(npc, stage, late).topics.length >= 3, `${npc}/${stage}: three topics visible by the end of the stage`);
        const wEarly = worldThrough(earliest[stage], opened(earliest[stage]));
        if (story.npcAvailable(npc, wEarly)) assert.ok(story.conversation(npc, stage, wEarly).topics.length >= 1, `${npc}/${stage}: something to say when the stage opens`);
        const bare = worldThrough(earliest[stage]);
        if (story.npcAvailable(npc, bare)) assert.ok(story.conversation(npc, stage, bare).topics.length >= 3, `${npc}/${stage}: three topics without a single side job`);
      }
    }
    const present = {
      rh1: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch'], rh2: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch'],
      dp1: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch', 'priya', 'wendell'],
      dp2: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch', 'priya', 'wendell', 'okafor', 'danny'],
      fs: ['mara', 'deke', 'ozzy', 'june', 'roz', 'quill', 'dutch', 'priya', 'wendell', 'okafor', 'danny'],
    };
    for (const [stage, npcs] of Object.entries(present)) for (const n of npcs) assert.ok(DIALOGUE.talk[n] && DIALOGUE.talk[n][stage], `${n} has a ${stage} conversation`);
  });

  test('conditional scene lines (epilogue, arrivals, briefings) use known flags and stay a minority', () => {
    const flags = producedFlags();
    let conditional = 0, total = 0;
    const scenes = [];
    for (const c of CHAPTERS) for (const [name, scene] of [['arrival', c.arrival && c.arrival.scene], ['epilogue', c.epilogue]]) if (scene) scenes.push([`ch${c.n}.${name}`, scene]);
    for (const m of MISSIONS) scenes.push([`${m.id}.briefing`, m.briefing], [`${m.id}.debrief`, m.debrief]);
    for (const [where, scene] of scenes) {
      scene.forEach((l, i) => {
        total++;
        if (l.when) { conditional++; checkWhen(l.when, `${where}[${i}]`, flags); }
      });
    }
    assert.ok(conditional >= 3 && conditional < total / 10, `${conditional} of ${total} scene lines are conditional`);
    const epi = CHAPTERS[5].epilogue;
    assert.ok(epi.some((l) => l.when && l.when.flags && l.when.flags.includes('found_biscuit')), 'the dog quest has its line');
    for (const who of ['dutch', 'quill', 'wendell']) assert.ok(epi.filter((l) => l.who === who).every((l) => l.when), `${who} only answers the muster if they came`);
  });

  test('stage selection and the conversation helper', () => {
    const w = { progress: { completed: {}, flags: {} } };
    assert.equal(story.stageFor('roadhouse', w), 'rh1');
    w.progress.completed.m2_1 = { stars: 1 };
    assert.equal(story.stageFor('roadhouse', w), 'rh1', 'Hollow Creek is still the arrival visit');
    w.progress.completed.m2_2 = { stars: 1 };
    assert.equal(story.stageFor('roadhouse', w), 'rh2', 'after Saint Mercy');
    assert.equal(story.stageFor('depot', w), 'dp1');
    w.progress.completed.m4_2 = { stars: 1 };
    assert.equal(story.stageFor('depot', w), 'dp2');
    assert.equal(story.stageFor('farmstead', w), 'fs');
    assert.equal(story.stageFor('mars', w), null);
    const before = story.conversation('mara', 'rh1', { progress: { completed: { m1_2: {} }, flags: {} } }, null, 0);
    assert.ok(before.topics.some((t) => t.id === 'mara_rh1_fever') && !before.topics.some((t) => t.id === 'mara_rh1_better'));
    const after = story.conversation('mara', 'rh1', { progress: { completed: { m1_2: {}, m2_1: {} }, flags: {} } }, null, 0);
    assert.ok(after.topics.some((t) => t.id === 'mara_rh1_better') && !after.topics.some((t) => t.id === 'mara_rh1_fever'), 'a done-gated topic opens when its mission is done');
    assert.equal(story.conversation('priya', 'rh1', w).topics.length, 0, 'no tree: an idle greeting only');
  });

  test('campfire banter: at least twenty-five two-liners between cast members', () => {
    const flags = producedFlags();
    assert.ok(DIALOGUE.banter.length >= 25);
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
    for (const id of ALL_IDS) checkLines(DIALOGUE.pep[id], `pep ${id}`, { min: 1, max: 3 });
    assert.deepEqual(Object.keys(DIALOGUE.pep), ALL_IDS);
    checkLines(DIALOGUE.retry.general, 'retry.general', { min: 12, max: 40 });
    for (const [id, q] of Object.entries(DIALOGUE.retry.byMission)) { assert.ok(ALL_IDS.includes(id)); checkLines(q, `retry ${id}`, { min: 1 }); }
    assert.ok(TIPS.length >= 30, `${TIPS.length} tips`);
    TIPS.forEach((t, i) => assert.ok(nonEmpty(t) && t.length <= 200, `tip ${i}`));
    assert.ok(TIPS.some((t) => /slow/i.test(t)), 'a slow-zombie tip');
    assert.ok(TIPS.some((t) => /gate/i.test(t)) && TIPS.some((t) => /side job/i.test(t)), 'tips for the levels and the side jobs');
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

  test('tokens only where the UI fills them: scenes and hideout talk, never a line the sim speaks', () => {
    for (const m of MISSIONS) {
      for (const s of [...m.steps, ...(m.bonus || [])]) {
        for (const [p, str] of strings({ text: s.text, onStart: s.onStart, onDone: s.onDone, lines: s.lines })) {
          assert.ok(!/\{\w+\}/.test(str), `${m.id}.${s.id}${p}: the director never expands tokens`);
        }
      }
    }
  });

  test('every speaker in every line exists and every line is short enough to read', () => {
    let lines = 0;
    for (const [p, l] of dialogueLines(everything())) {
      lines++;
      assert.ok(SPEAKERS.includes(l.who), `${p}: unknown speaker '${l.who}'`);
      assert.ok(l.text.length <= 200, `${p}: ${l.text.length} chars`);
    }
    assert.ok(lines > 1400, `${lines} dialogue lines in total`);
  });

  test('no en-dashes or ellipsis characters that speech synthesis stumbles on', () => {
    for (const [p, s] of strings({ MISSIONS, CHAPTERS, DIALOGUE, NOTES })) {
      assert.ok(!/[–…]/.test(s), `${p}: use plain punctuation`);
    }
  });
});

// =======================================================================================================
describe('the mission executor validator', () => {
  test('every mission and side job passes shared/story/validate.js (vocabulary only; the real maps are story-missions.test.js)', () => {
    for (const m of MISSIONS) {
      const res = validateMission(m);
      assert.deepEqual(res.errors, [], `${m.id}: ${res.errors.join('; ')}`);
      assert.deepEqual(res.warnings, [], `${m.id}: ${res.warnings.join('; ')}`);
    }
  });

  test('the validator knows side jobs and their fields', () => {
    const base = mission('sj_fuel');
    const bad = (patch, re) => {
      const r = validateMission({ ...base, ...patch });
      assert.ok(r.errors.some((e) => re.test(e)), `expected ${re}, got ${r.errors.join(' | ') || 'no errors'}`);
    };
    bad({ chapter: 2 }, /filed under chapter 7/);
    bad({ opens: 9 }, /opens/);
    bad({ after: 'm1_2' }, /returns to a hideout/);
    bad({ side: 'yes' }, /side must be a boolean/);
    bad({ side: undefined }, /chapter must be an integer 1\.\.6/);
    const story1 = mission('m1_2');
    const r = validateMission({ ...story1, opens: 2 });
    assert.ok(r.errors.some((e) => /opens only means something on a side job/.test(e)));
    assert.ok(validateMission({ ...story1, after: 'hideout' }).ok, '"hideout" alone is a valid after');
    assert.ok(!validateMission({ ...story1, after: 'Nowhere Land' }).ok);
  });
});
