// Mission script validator (STORY.md §5.4). The data test of shared/story/missions.js calls
// validateMission() on every mission; the mission director trusts what passes.
//
//   import { validateMission } from './validate.js';
//   const { ok, errors, warnings } = validateMission(mission, { maps });
//
// `maps` says where anchors are looked up: a function (mapId, opts) → MapDef (opts as for
// buildMap: { mode: 'campaign' } for the campaign variant), or an object { [mapId]: MapDef }
// (a campaign variant under the key `${mapId}:campaign`). Without it the anchor names are
// checked against the vocabulary of story-defs.js only.

import { WEAPONS } from '../weapons.js';
import { ZOMBIES } from '../zombies.js';
import { MAP_LIST } from '../maps.js';
import { DIFFICULTIES } from '../constants.js';
import {
  STEP_TYPES, MISSION_MODES, CAMPAIGN_STAGES, ANCHOR_VOCAB, CAMPAIGN_ANCHORS, DEFEND_ANCHOR, INTERACT_KINDS, isItemId,
  normLine, CAST,
} from '../story-defs.js';

const TIMES = ['night', 'day'];
/** Keys every step may carry. */
const COMMON = new Set([
  'id', 'type', 'text', 'parallel', 'optional', 'required', 'onStart', 'onDone', 'pressure', 'tier', 'timeout', 'flags', 'setFlag',
  'follow', 'unfollow', 'remove', 'npcs', 'supply', 'todo', 'note',
]);
/** Keys per step type (besides the common ones). */
const PARAMS = {
  defend: ['target', 'waves', 'seconds', 'scale', 'boss', 'gap', 'heal', 'pace', 'at', 'delay'],
  waves: ['count', 'pace', 'scale', 'boss', 'gap', 'at', 'delay'],
  survive: ['seconds', 'at'],
  collect: ['item', 'count', 'at', 'scatter'],
  reach: ['at', 'hold', 'radius', 'who'],
  activate: ['at', 'hold', 'kind', 'label', 'radius', 'burst', 'specials'],
  escort: ['npc', 'route', 'hp', 'fail', 'invulnerable'],
  kill: ['enemy', 'zombie', 'count', 'spawn', 'at'],
  boss: ['enemy', 'zombie', 'count', 'at'],
  evac: ['stops'],
  campaignStage: ['stage', 'waves'],
  wait: ['seconds'],
  dialogue: ['lines', 'npc', 'talk'],
};
const PRESSURE_KEYS = new Set(['tier', 'waves', 'size', 'scale', 'every', 'pace', 'specials', 'at', 'cap', 'delay']);
const MISSION_KEYS = new Set([
  'id', 'chapter', 'index', 'title', 'blurb', 'map', 'time', 'mode', 'level', 'party', 'briefing', 'steps', 'rewards', 'debrief',
  'stars', 'startAt', 'npcs', 'tier', 'respawn', 'timeLimit', 'waveScale', 'todo', 'note', 'pressure', 'difficulty',
]);

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** The anchor names a map has, as a Set (from the map objects if given, else from the vocabulary). */
function anchorSet(mapId, campaign, maps) {
  let map = null;
  try {
    if (typeof maps === 'function') map = maps(mapId, campaign ? { mode: 'campaign' } : null);
    else if (maps && typeof maps === 'object') map = maps[campaign ? `${mapId}:campaign` : mapId] || (campaign ? null : maps[mapId]) || null;
  } catch {
    map = null;
  }
  if (map && map.anchors) return { names: new Set(Object.keys(map.anchors)), map };
  const names = new Set(ANCHOR_VOCAB[mapId] || []);
  if (campaign) for (const n of CAMPAIGN_ANCHORS) names.add(n);
  return { names, map: null };
}

/**
 * Check a mission script.
 * @param {object} m the mission
 * @param {{ maps?: Function|object, strict?: boolean }} [opts]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateMission(m, { maps = null } = {}) {
  const errors = [], warnings = [];
  const where = (m && m.id) || '?';
  const err = (msg) => errors.push(`${where}: ${msg}`);
  const warn = (msg) => warnings.push(`${where}: ${msg}`);
  if (!m || typeof m !== 'object') {
    return { ok: false, errors: ['mission is not an object'], warnings };
  }
  for (const k of Object.keys(m)) if (!MISSION_KEYS.has(k)) warn(`unknown mission field "${k}"`);
  if (!isStr(m.id) || !/^[a-z][a-z0-9_]*$/.test(m.id)) err('id must be lower-case letters, digits and _');
  if (!isInt(m.chapter, 1, 6)) err('chapter must be an integer 1..6');
  if (!isInt(m.index, 1, 9)) err('index must be an integer 1..9');
  if (!isStr(m.title)) err('title is required');
  if (!isStr(m.blurb)) err('blurb is required');
  const mapMeta = MAP_LIST.find((e) => e.id === m.map);
  if (!mapMeta) err(`map "${m.map}" is not a map`);
  if (m.time !== undefined && !TIMES.includes(m.time)) err('time must be "night" or "day"');
  if (!MISSION_MODES.includes(m.mode)) err(`mode must be one of ${MISSION_MODES.join(', ')}`);
  if (!Array.isArray(m.level) || m.level.length !== 2 || !isInt(m.level[0], 1, 20) || !isInt(m.level[1], 1, 20) || m.level[0] > m.level[1]) {
    err('level must be [min, max] with 1 <= min <= max <= 20');
  }
  if (!m.party || !isInt(m.party.min, 1, 6) || !isInt(m.party.max, 1, 6) || m.party.min > m.party.max) err('party must be { min, max } within 1..6');
  if (m.tier !== undefined && !isInt(m.tier, 1, 30)) err('tier must be an integer 1..30');
  if (m.respawn !== undefined && !isNum(m.respawn, 0, 600)) err('respawn must be seconds 0..600');
  if (m.timeLimit !== undefined && !isNum(m.timeLimit, 30, 7200)) err('timeLimit must be seconds 30..7200');
  if (m.waveScale !== undefined && !isNum(m.waveScale, 0.05, 3)) err('waveScale must be 0.05..3');
  if (m.difficulty !== undefined && !DIFFICULTIES[m.difficulty]) err('difficulty must be an existing difficulty');

  const lines = (list, label, required = false) => {
    if (list === undefined) {
      if (required) err(`${label} is required`);
      return;
    }
    if (!Array.isArray(list)) {
      err(`${label} must be an array of lines`);
      return;
    }
    list.forEach((l, i) => {
      const n = normLine(l);
      if (!n) err(`${label}[${i}] needs a text`);
      else if (!n.who) warn(`${label}[${i}] has no "who"`);
      else if (n.text.length > 200) warn(`${label}[${i}] is long (${n.text.length} characters)`);
    });
  };
  lines(m.briefing, 'briefing', true);
  lines(m.debrief, 'debrief', true);

  // ---- rewards & stars
  const r = m.rewards;
  if (!r || typeof r !== 'object') err('rewards is required');
  else {
    if (!isInt(r.xp, 0, 5000)) err('rewards.xp must be an integer 0..5000');
    if (!isInt(r.scrap, 0, 5000)) err('rewards.scrap must be an integer 0..5000');
    if (r.weapon !== undefined && !(typeof r.weapon === 'string' && WEAPONS[r.weapon])) err(`rewards.weapon "${r.weapon}" is not a weapon`);
    if (r.upgradePoints !== undefined && !isInt(r.upgradePoints, 0, 50)) err('rewards.upgradePoints must be an integer 0..50');
    if (r.flags !== undefined && (typeof r.flags !== 'object' || Array.isArray(r.flags))) err('rewards.flags must be an object');
    if (r.unlockNpc !== undefined && !isStr(r.unlockNpc)) err('rewards.unlockNpc must be an id');
    for (const k of Object.keys(r)) if (!['xp', 'scrap', 'weapon', 'upgradePoints', 'flags', 'unlockNpc'].includes(k)) warn(`unknown rewards field "${k}"`);
  }
  const st = m.stars;
  if (!st || typeof st !== 'object') err('stars is required');
  else {
    if (st.time !== undefined && !isNum(st.time, 30, 7200)) err('stars.time must be seconds 30..7200');
    if (st.noDowns !== undefined && typeof st.noDowns !== 'boolean') err('stars.noDowns must be a boolean');
    if (st.optional !== undefined && !isStr(st.optional)) err('stars.optional must be a string');
    if (st.optional && !(m.steps || []).some((s) => s && s.optional)) warn('stars.optional is set but no step is optional');
  }

  // ---- anchors
  const campaignVariant = m.mode === 'campaign';
  const { names: anchors, map } = anchorSet(m.map, campaignVariant, maps);
  const isAnchor = (a) => typeof a === 'string' && anchors.has(a);
  const anchorErr = (a, label) => {
    if (typeof a !== 'string') err(`${label} must be an anchor name`);
    else if (!anchors.has(a)) err(`${label}: "${a}" is not an anchor of ${m.map}${campaignVariant ? ' (campaign)' : ''}`);
  };
  if (m.startAt !== undefined) anchorErr(m.startAt, 'startAt');

  // ---- NPCs
  const npcIds = new Set(Object.keys(CAST));
  if (m.npcs !== undefined) {
    if (!Array.isArray(m.npcs)) err('npcs must be an array');
    else {
      m.npcs.forEach((n, i) => {
        if (!n || !isStr(n.id)) err(`npcs[${i}].id is required`);
        else npcIds.add(n.id);
        if (n && n.at !== undefined) anchorErr(n.at, `npcs[${i}].at`);
      });
    }
  }

  // ---- steps
  if (!Array.isArray(m.steps) || m.steps.length === 0) {
    err('steps must be a non-empty array');
    return { ok: errors.length === 0, errors, warnings };
  }
  if (m.steps.length > 40) err('too many steps (40 at most)');
  const ids = new Set();
  let evacs = 0, campaigns = 0, lastStage = 0;
  const zombieOk = (t) => t === 'any' || (typeof t === 'string' && Object.hasOwn(ZOMBIES, t));
  m.steps.forEach((s, i) => {
    const at = `steps[${i}]`;
    if (!s || typeof s !== 'object') {
      err(`${at} is not an object`);
      return;
    }
    const label = `${at} (${s.type})`;
    if (!isStr(s.id)) err(`${label}: id is required`);
    else if (ids.has(s.id)) err(`${label}: duplicate step id "${s.id}"`);
    else ids.add(s.id);
    if (!STEP_TYPES.includes(s.type)) {
      err(`${at}: unknown step type "${s.type}"`);
      return;
    }
    const allowed = new Set([...COMMON, ...PARAMS[s.type]]);
    for (const k of Object.keys(s)) if (!allowed.has(k)) warn(`${label}: unknown field "${k}"`);
    if (s.text !== undefined && typeof s.text !== 'string') err(`${label}: text must be a string`);
    else if (typeof s.text === 'string' && s.text.length > 88) warn(`${label}: text is long (${s.text.length} characters, 88 fit)`);
    if (!['dialogue', 'wait'].includes(s.type) && s.text === undefined) warn(`${label}: no text (the HUD line is generated)`);
    for (const k of ['parallel', 'optional', 'required']) if (s[k] !== undefined && typeof s[k] !== 'boolean') err(`${label}: ${k} must be a boolean`);
    if (s.tier !== undefined && !isInt(s.tier, 1, 30)) err(`${label}: tier must be an integer 1..30`);
    if (s.timeout !== undefined && !isNum(s.timeout, 10, 7200)) err(`${label}: timeout must be seconds 10..7200`);
    lines(s.onStart, `${at}.onStart`);
    lines(s.onDone, `${at}.onDone`);
    for (const k of ['follow', 'unfollow', 'remove']) {
      if (s[k] === undefined) continue;
      if (!Array.isArray(s[k]) || !s[k].every(isStr)) err(`${label}: ${k} must be an array of NPC ids`);
      else for (const id of s[k]) if (!npcIds.has(id)) warn(`${label}: ${k} "${id}" is not a known NPC (add it to mission.npcs or the cast)`);
    }
    if (s.npcs !== undefined) {
      if (!Array.isArray(s.npcs)) err(`${label}: npcs must be an array`);
      else s.npcs.forEach((n, j) => {
        if (!n || !isStr(n.id)) err(`${label}: npcs[${j}].id is required`);
        else npcIds.add(n.id);
        if (n && n.at !== undefined) anchorErr(n.at, `${label} npcs[${j}].at`);
      });
    }
    const p = s.pressure;
    if (p !== undefined && p !== false) {
      if (!p || typeof p !== 'object') err(`${label}: pressure must be false or an object`);
      else {
        for (const k of Object.keys(p)) if (!PRESSURE_KEYS.has(k)) warn(`${label}: unknown pressure field "${k}"`);
        if (p.waves !== undefined && !isInt(p.waves, 0, 99)) err(`${label}: pressure.waves must be an integer 0..99`);
        if (p.size !== undefined && !isInt(p.size, 1, 80)) err(`${label}: pressure.size must be an integer 1..80`);
        if (p.every !== undefined && !isNum(p.every, 3, 300)) err(`${label}: pressure.every must be seconds 3..300`);
        if (p.pace !== undefined && !isNum(p.pace, 0.2, 5)) err(`${label}: pressure.pace must be 0.2..5`);
        if (p.tier !== undefined && !isInt(p.tier, 1, 30)) err(`${label}: pressure.tier must be an integer 1..30`);
        if (p.specials !== undefined && !(Array.isArray(p.specials) && p.specials.every(zombieOk))) err(`${label}: pressure.specials must be zombie types`);
        if (p.at !== undefined) anchorErr(p.at, `${label} pressure.at`);
      }
    }

    switch (s.type) {
      case 'defend': {
        const want = DEFEND_ANCHOR[m.map];
        if (s.target !== want) err(`${label}: target must be "${want}" (the objective of ${m.map})`);
        if (s.seconds === undefined && s.waves === undefined) warn(`${label}: neither waves nor seconds (3 waves)`);
        if (s.waves !== undefined && !isInt(s.waves, 1, 12)) err(`${label}: waves must be an integer 1..12`);
        if (s.seconds !== undefined && !isNum(s.seconds, 10, 1800)) err(`${label}: seconds must be 10..1800`);
        if (s.scale !== undefined && !isNum(s.scale, 0.05, 3)) err(`${label}: scale must be 0.05..3`);
        if (s.at !== undefined) anchorErr(s.at, `${label} at`);
        break;
      }
      case 'waves':
        if (!isInt(s.count, 1, 12)) err(`${label}: count must be an integer 1..12`);
        if (s.pace !== undefined && !isNum(s.pace, 0.2, 5)) err(`${label}: pace must be 0.2..5`);
        if (s.scale !== undefined && !isNum(s.scale, 0.05, 3)) err(`${label}: scale must be 0.05..3`);
        if (s.at !== undefined) anchorErr(s.at, `${label} at`);
        break;
      case 'survive':
        if (!isNum(s.seconds, 5, 1800)) err(`${label}: seconds must be 5..1800`);
        if (s.at !== undefined) anchorErr(s.at, `${label} at`);
        break;
      case 'collect':
        if (!isItemId(s.item)) err(`${label}: item must be an id (letters/digits/_, at most 16)`);
        if (!isInt(s.count, 1, 24)) err(`${label}: count must be an integer 1..24`);
        if (!Array.isArray(s.at) || !s.at.length) err(`${label}: at must be a non-empty array of anchors`);
        else s.at.forEach((a, j) => anchorErr(a, `${label} at[${j}]`));
        break;
      case 'reach':
        anchorErr(s.at, `${label} at`);
        if (s.hold !== undefined && !isNum(s.hold, 0, 300)) err(`${label}: hold must be seconds 0..300`);
        if (s.who !== undefined && !['all', 'any'].includes(s.who)) err(`${label}: who must be "all" or "any"`);
        break;
      case 'activate':
        if (!Array.isArray(s.at) || !s.at.length) err(`${label}: at must be a non-empty array of anchors`);
        else s.at.forEach((a, j) => {
          const byId = map && Array.isArray(map.interactables) && map.interactables.some((q) => q.id === a);
          if (!byId) anchorErr(a, `${label} at[${j}]`);
        });
        if (s.hold !== undefined && !isNum(s.hold, 0, 120)) err(`${label}: hold must be seconds 0..120`);
        if (s.kind !== undefined && !INTERACT_KINDS[s.kind]) err(`${label}: kind "${s.kind}" is not an interactable kind`);
        break;
      case 'escort':
        if (!isStr(s.npc)) err(`${label}: npc is required`);
        else if (!npcIds.has(s.npc)) warn(`${label}: npc "${s.npc}" is not in mission.npcs or the cast (a survivor will be made)`);
        if (!Array.isArray(s.route) || s.route.length < 2) err(`${label}: route must list at least two anchors (start and destination)`);
        else s.route.forEach((a, j) => anchorErr(a, `${label} route[${j}]`));
        if (s.hp !== undefined && !isNum(s.hp, 20, 5000)) err(`${label}: hp must be 20..5000`);
        break;
      case 'kill': {
        const t = s.enemy !== undefined ? s.enemy : s.zombie;
        if (t === undefined) err(`${label}: enemy is required ("any" or a zombie type)`);
        else if (!zombieOk(t)) err(`${label}: enemy "${t}" is not a zombie type`);
        if (!isInt(s.count, 1, 300)) err(`${label}: count must be an integer 1..300`);
        if (s.at !== undefined) anchorErr(s.at, `${label} at`);
        break;
      }
      case 'boss': {
        const t = s.enemy !== undefined ? s.enemy : s.zombie;
        if (t !== undefined && !(typeof t === 'string' && Object.hasOwn(ZOMBIES, t))) err(`${label}: enemy "${t}" is not a zombie type`);
        if (s.count !== undefined && !isInt(s.count, 1, 6)) err(`${label}: count must be an integer 1..6`);
        if (s.at !== undefined) anchorErr(s.at, `${label} at`);
        break;
      }
      case 'evac': {
        evacs++;
        if (m.mode !== 'zone') err(`${label}: an evac step needs mission mode "zone"`);
        if (!Array.isArray(s.stops) || !s.stops.length) err(`${label}: stops must be a non-empty array of anchors`);
        else s.stops.forEach((a, j) => {
          anchorErr(a, `${label} stops[${j}]`);
          const a2 = map && map.anchors && map.anchors[a];
          if (a2 && map.pois && !map.pois.some((q) => Math.hypot(q.x - a2.x, q.y - a2.y) < 420)) warn(`${label}: stops[${j}] "${a}" is not near a point of interest`);
        });
        break;
      }
      case 'campaignStage': {
        campaigns++;
        if (m.mode !== 'campaign') err(`${label}: a campaignStage step needs mission mode "campaign"`);
        if (!Object.hasOwn(CAMPAIGN_STAGES, s.stage)) err(`${label}: stage must be one of ${Object.keys(CAMPAIGN_STAGES).join(', ')}`);
        else {
          const order = ['hill', 'breakout', 'tower', 'roof', 'zip'].indexOf(s.stage);
          if (order < lastStage) err(`${label}: campaign stages must be in play order`);
          lastStage = order;
        }
        if (s.waves !== undefined && !isInt(s.waves, 3, 12)) err(`${label}: waves (hill waves) must be an integer 3..12`);
        break;
      }
      case 'wait':
        if (!isNum(s.seconds, 0, 120)) err(`${label}: seconds must be 0..120`);
        break;
      case 'dialogue':
        lines(s.lines, `${at}.lines`, true);
        if (Array.isArray(s.lines) && !s.lines.length) err(`${label}: lines is empty`);
        if (s.talk && !isStr(s.npc)) err(`${label}: talk needs an npc`);
        break;
      default:
        break;
    }
  });
  if (m.mode === 'zone' && !evacs) err('mode "zone" needs an evac step');
  if (m.mode === 'campaign' && !campaigns) err('mode "campaign" needs a campaignStage step');
  if (map && m.mode === 'zone' && !(map.pois && map.pois.length >= 2)) err(`map ${m.map} has no points of interest for an evac run`);
  if (map && m.mode === 'campaign' && !map.campaign) err(`map ${m.map} has no campaign extension`);
  if (mapMeta && m.mode === 'campaign' && !(mapMeta.modes || []).includes('campaign')) err(`map ${m.map} does not play the campaign`);
  if (mapMeta && m.mode === 'zone' && mapMeta.modes && !mapMeta.modes.includes('zone')) err(`map ${m.map} does not play the Evac Run`);
  // the last step cannot be a background one: nothing would end the mission cleanly
  const lastLead = [...m.steps].reverse().find((s) => s && !s.optional);
  if (lastLead && lastLead.parallel) warn('the last non-optional step is "parallel" (the mission ends when all of them are done)');
  return { ok: errors.length === 0, errors, warnings };
}

/** validateMission, throwing an Error listing every problem (for tools). */
export function assertMission(m, opts) {
  const r = validateMission(m, opts);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r;
}
