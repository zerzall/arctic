// ROAD TO HAVEN — dialogue outside the missions: hideout conversations, campfire banter, station
// flavour, pep talks, retry quips, loading tips, title and credits. Pure data + tiny pure helpers.
//
// A hideout VISIT is one of five STAGES (below). For each NPC present, TALK[npc][stage] has a
// `greet` (lines the NPC says when you walk up) and `topics` (a menu of short exchanges).
// Conditions (`when`) look at the world: { flags:[...], notFlags:[...], done:[...], notDone:[...] }
// where done = completed mission ids. Topics may have `once` (hide after heard) and `setFlags`.
// Tokens in any text: {day}, {crew}, {scrap}.

import { TALK_CREW } from './dialogue/talk-crew.js';
import { TALK_MORE } from './dialogue/talk-more.js';
import { BANTER, STATIONS, PEP, RETRY, TIPS, TITLE, CREDITS } from './dialogue/misc.js';

export { TIPS, BANTER, STATIONS, PEP, RETRY, TITLE, CREDITS };

/**
 * Hideout visit stages. The stage of a visit is the LAST one whose hideout matches and `when` holds.
 * rh1 the Roadhouse after Mill Road (and Hollow Creek), rh2 after Saint Mercy (the Warden is fifteen),
 * dp1 Blackwater Depot after the dam, dp2 after the rail yard and Fort Harlan (Okafor's unit), fs the farm.
 */
export const STAGES = {
  rh1: { id: 'rh1', hideout: 'roadhouse', label: 'The Roadhouse, arrival', when: { notDone: ['m2_2'] } },
  rh2: { id: 'rh2', hideout: 'roadhouse', label: 'The Roadhouse, after Saint Mercy', when: { done: ['m2_2'] } },
  dp1: { id: 'dp1', hideout: 'depot', label: 'Blackwater Depot, arrival', when: { notDone: ['m4_2'] } },
  dp2: { id: 'dp2', hideout: 'depot', label: 'Blackwater Depot, after Fort Harlan', when: { done: ['m4_2'] } },
  fs: { id: 'fs', hideout: 'farmstead', label: 'Harlan Farmstead', when: null },
};
export const STAGE_IDS = Object.keys(STAGES);

/** talk[npcId][stageId] = { greet:[string...], topics:[{ id, prompt, lines:[{who,text}], when?, once?, setFlags?:{[flag]:true} }] } */
export const TALK = { ...TALK_CREW, ...TALK_MORE };

/** Generic lines for an NPC with nothing new to say (or no tree for this stage). */
export const IDLE_GREETS = {
  mara: ["Keep breathing. That's the whole prescription."],
  deke: ["Huh."],
  ozzy: ["Shh, I'm listening to the sky."],
  june: ["Hi! I'm counting. Don't say a number."],
  roz: ["Eat something."],
  quill: ["Rumors are free. The accurate ones cost extra."],
  dutch: ["If it's about money, it's on the invoice."],
  priya: ["Noted."],
  okafor: ["At ease."],
  wendell: ["Good crew."],
  danny: ["Ma'am! ...Everyone!"],
};

export const DIALOGUE = {
  talk: TALK,
  stages: STAGES,
  idle: IDLE_GREETS,
  banter: BANTER,
  stations: STATIONS,
  pep: PEP,
  retry: RETRY,
  title: TITLE,
  credits: CREDITS,
  tokens: ['{day}', '{crew}', '{scrap}'],
};

// ---- helpers (pure) ------------------------------------------------------------------------------
const doneOf = (world) => (world && world.progress && world.progress.completed) || {};
const flagsOf = (world) => (world && world.progress && world.progress.flags) || {};

/** Does a `when` condition hold in this world? (no condition = yes) */
export function conditionMet(when, world) {
  if (!when) return true;
  const done = doneOf(world), flags = flagsOf(world);
  if (when.flags && !when.flags.every((f) => flags[f])) return false;
  if (when.notFlags && when.notFlags.some((f) => flags[f])) return false;
  if (when.done && !when.done.every((id) => done[id])) return false;
  if (when.notDone && when.notDone.some((id) => done[id])) return false;
  return true;
}

/** The visit stage id for a hideout in this world (null for an unknown hideout). */
export function stageFor(hideoutId, world) {
  let found = null;
  for (const id of STAGE_IDS) {
    const s = STAGES[id];
    if (s.hideout === hideoutId && conditionMet(s.when, world)) found = id;
  }
  return found;
}

/**
 * What an NPC can say now: { greet: string, topics: [...] } with topics filtered by their `when` and
 * (if `heard` is given: an object/Set of topic ids already heard) by `once`. `pick` in [0,1) chooses
 * the greeting (pass a seeded rng value to stay deterministic).
 */
export function conversation(npcId, stageId, world, heard = null, pick = 0) {
  const tree = TALK[npcId] && TALK[npcId][stageId];
  const wasHeard = (id) => (heard ? (typeof heard.has === 'function' ? heard.has(id) : !!heard[id]) : false);
  if (!tree) {
    const idle = IDLE_GREETS[npcId] || ['...'];
    return { greet: idle[Math.floor(pick * idle.length) % idle.length], topics: [] };
  }
  const greet = tree.greet[Math.floor(pick * tree.greet.length) % tree.greet.length];
  const topics = tree.topics.filter((tp) => conditionMet(tp.when, world) && !(tp.once && wasHeard(tp.id)));
  return { greet, topics };
}

/** Banter pairs that can play now (both speakers must be `present`, an array of NPC ids). */
export function banterFor(world, present) {
  return BANTER.filter((p) => conditionMet(p.when, world) && p.lines.every((l) => present.includes(l.who)));
}

/** Replace {day}, {crew}, {scrap} in a line. */
export function expandTokens(text, ctx = {}) {
  return String(text).replace(/\{(day|crew|scrap)\}/g, (_, k) => (ctx[k] !== undefined ? String(ctx[k]) : ''));
}
