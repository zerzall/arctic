// Road to Haven (STORY.md): the vocabulary the mission director, the validator, the
// renderers and the HUD share. Pure data and pure helpers; nothing here keeps state or
// touches the DOM.
//
//   step types      what a mission script may contain (sim/story.js executes them)
//   anchors         the named places of each map (maps.js adds them to MapDef.anchors)
//   items           story pickups (fuel cans, parts, ...): a name, a colour, a shape
//   interactables   hold-to-use spots: kinds and their default prompts
//   NPCs            states, the default cast and their looks
//   markers         the icons the HUD and the 3D view draw for the current objective

import { CAST as STORY_CAST } from './story/cast.js';

// ---------------------------------------------------------------------------------------
// Step types

/** Every step type a mission script may use (STORY.md §5.4). */
export const STEP_TYPES = Object.freeze([
  'defend', 'waves', 'survive', 'collect', 'reach', 'activate', 'escort', 'kill', 'boss', 'evac',
  'campaignStage', 'wait', 'dialogue',
]);

/** Step types the snapshot names by index (wire): STEP_TYPES order, then 'custom'. */
export const STEP_KINDS = Object.freeze([...STEP_TYPES, 'custom']);

/** Steps that run on the game's wave machine (zone / campaign directors) and so need that sim mode. */
export const SIM_MODE_OF_STEP = Object.freeze({ evac: 'zone', campaignStage: 'campaign' });

/** The sim modes a mission may ask for (`mission.mode`). */
export const MISSION_MODES = Object.freeze(['defend', 'zone', 'campaign', 'free']);

/** Campaign stage names (`campaignStage.stage`) in play order, with the campaign director's stage number. */
export const CAMPAIGN_STAGES = Object.freeze({ hill: 1, breakout: 2, tower: 3, roof: 4, zip: 4 });

// ---------------------------------------------------------------------------------------
// Map anchors (STORY.md §5.2). The names authors may use, per map; maps.js adds each of them.

export const ANCHOR_VOCAB = Object.freeze({
  highway: Object.freeze(['bus', 'crossroadsW', 'crossroadsE', 'gasStation', 'overpass', 'westEnd', 'eastEnd', 'motel', 'diner']),
  truckstop: Object.freeze(['diner', 'pumps', 'truckLot', 'motelRow', 'roadNorth', 'roadSouth', 'trailerA', 'trailerB', 'trailerC']),
  bridge: Object.freeze(['apc', 'bankW', 'bankE', 'deckMid', 'cargoA', 'cargoB', 'cargoC']),
  checkpoint: Object.freeze(['tower', 'gate', 'compound', 'genA', 'genB', 'genC', 'hill']),
  harlan: Object.freeze(['mainStreet', 'gasNGo', 'haskellFarm', 'stJudes', 'fieldHospital', 'i70Interchange', 'millerQuarry',
    'radioHill', 'shadyPines', 'lakeMarina']),
});

/** Extra anchors of a map's campaign variant (`buildMap(id, seed, { mode: 'campaign' })`). */
export const CAMPAIGN_ANCHORS = Object.freeze(['ridgeHill', 'breakout', 'towerDoor', 'roof', 'zipStart', 'landing']);

/** The map's objective (what a `defend` step guards) is at this anchor of each map. */
export const DEFEND_ANCHOR = Object.freeze({
  highway: 'bus', truckstop: 'diner', bridge: 'apc', checkpoint: 'tower', harlan: 'radioHill',
});

// ---------------------------------------------------------------------------------------
// Story items (collect steps): a fuel can, a medicine crate, a radio part, a note ...

/**
 * Known story items. Any other id (letters, digits, `_`, at most 16) is a generic crate; a
 * new id only needs an entry here to get its own look.
 * shape: 'can' | 'box' | 'part' | 'note' | 'sack' | 'case' | 'tape' | 'tag' | 'pump'
 */
export const STORY_ITEMS = Object.freeze({
  fuel: { name: 'Fuel can', short: 'Fuel', color: '#d8402e', shape: 'can' },
  medicine: { name: 'Medicine crate', short: 'Medicine', color: '#e8e8e2', shape: 'box', mark: '#d02a2a' },
  medkit: { name: 'Medical supplies', short: 'Supplies', color: '#e8e8e2', shape: 'box', mark: '#d02a2a' },
  part: { name: 'Radio part', short: 'Part', color: '#38b0a0', shape: 'part' },
  battery: { name: 'Battery', short: 'Battery', color: '#e8b830', shape: 'part' },
  cargo: { name: 'Cargo crate', short: 'Cargo', color: '#a07838', shape: 'box', mark: '#5a4420' },
  note: { name: 'Note', short: 'Note', color: '#f0e6c0', shape: 'note' },
  supplies: { name: 'Supply bag', short: 'Supplies', color: '#6a7a4a', shape: 'sack' },
  ammo: { name: 'Ammo case', short: 'Ammo', color: '#5a6a3a', shape: 'case' },
  key: { name: 'Key', short: 'Key', color: '#f0c040', shape: 'part' },
  crate: { name: 'Crate', short: 'Crate', color: '#b08a50', shape: 'box', mark: '#6a5230' },
  pump: { name: 'Marine pump', short: 'Pump', color: '#4a90b8', shape: 'pump' },
  tag: { name: 'Dog tag', short: 'Tag', color: '#c8ccd0', shape: 'tag' },
  player: { name: 'Tape player', short: 'Tape player', color: '#7a7a82', shape: 'tape' },
});

/** Item ids at most 16 characters, letters/digits/underscore, starting with a letter. */
export function isItemId(id) {
  return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(id);
}

/** The look of a story item id (unknown ids are generic crates). */
export function itemInfo(id) {
  return STORY_ITEMS[id] || { name: 'Crate', short: 'Item', color: '#b08a50', shape: 'box', mark: '#6a5230' };
}

/** How near a survivor must be to pick a story item up (px). */
export const ITEM_PICKUP_RADIUS = 42;

// ---------------------------------------------------------------------------------------
// Interactables (map.interactables and the terminals a mission creates)

/**
 * Interactable kinds (wire order). `label` is the default prompt, `hold` the default hold
 * time in seconds. The hideout station kinds come first (STORY.md §5.2).
 */
export const INTERACT_KINDS = Object.freeze({
  use: { label: 'Use', hold: 0 },
  board: { label: 'Mission board', hold: 0 },
  workbench: { label: 'Workbench', hold: 0 },
  armory: { label: 'Armory', hold: 0 },
  infirmary: { label: 'Infirmary', hold: 0 },
  upgrades: { label: 'Upgrade board', hold: 0 },
  bed: { label: 'Sleep', hold: 1.2 },
  range: { label: 'Shooting range', hold: 0 },
  campfire: { label: 'Campfire', hold: 0 },
  terminal: { label: 'Hack the terminal', hold: 4 },
  generator: { label: 'Start the generator', hold: 5 },
  beacon: { label: 'Light the beacon', hold: 4 },
  repair: { label: 'Repair', hold: 6 },
  radio: { label: 'Use the radio', hold: 3 },
  switch: { label: 'Throw the switch', hold: 2 },
  valve: { label: 'Open the valve', hold: 3 },
  winch: { label: 'Work the winch', hold: 4 },
  cache: { label: 'Open the cache', hold: 2 },
  door: { label: 'Open the door', hold: 1.5 },
  pump: { label: 'Start the pump', hold: 4 },
});
export const INTERACT_KIND_IDS = Object.freeze(Object.keys(INTERACT_KINDS));

/** Kind for an unknown string. */
export function interactKind(k) {
  return INTERACT_KINDS[k] ? k : 'use';
}

/** The prompt of an interactable (its own label, else the kind's). */
export function interactLabel(it) {
  if (it && it.label) return it.label;
  const k = it && INTERACT_KINDS[it.kind];
  return k ? k.label : 'Use';
}

/** Seconds a hold takes, extra holders speed it up: 1 holder ×1, 2 ×1.5, 3+ ×2. */
export function holdSpeed(holders) {
  return holders <= 1 ? 1 : holders === 2 ? 1.5 : 2;
}

/** A survivor talks to a survivor NPC / holds an interactable from this far (px, from the spot's edge). */
export const INTERACT_REACH = 26;
/** Talking range to an NPC (px, centre to centre). */
export const TALK_RANGE = 78;

// ---------------------------------------------------------------------------------------
// NPCs

/** NPC states (STORY.md §5.3), wire order. */
export const NPC_STATES = Object.freeze(['idle', 'talk', 'walk', 'follow', 'escort', 'down']);

/**
 * Accessory options of an NPC look (wire order; the renderers draw what they can, an unknown one is
 * drawn as nothing). The first ten are the basic set, the rest the props of the story cast (shared/story/cast.js).
 */
export const NPC_ACCESSORIES = Object.freeze([
  'none', 'glasses', 'cap', 'beanie', 'bandana', 'scarf', 'hat', 'headset', 'backpack', 'bandage',
  'stethoscope', 'wrench-belt', 'beret', 'map-satchel', 'apron', 'top-hat', 'trucker-cap', 'leash', 'radio-pack', 'captain-cap',
]);

/** Hair styles of an NPC look (wire order); 'default' = whatever the class model has. */
export const NPC_HAIR_STYLES = Object.freeze([
  'default', 'bun', 'buzz', 'curly', 'cropped', 'braid', 'pigtails', 'curls', 'slicked', 'bald-beard', 'thin', 'ponytail',
]);

/**
 * The recurring cast (STORY.md §2): who they are and how they look. The people come from the
 * story data (shared/story/cast.js: `look = { cls, skin, hair, hairStyle, outfit: [1..3 hex],
 * accessory, scale }`); `color` is the speaker colour of the radio strip (the portrait accent).
 * Two extras exist for scripts and tests that need a body without a name: `hauler`, `survivor`.
 */
export const CAST = Object.freeze((() => {
  const out = {};
  for (const id of Object.keys(STORY_CAST)) {
    const c = STORY_CAST[id];
    out[id] = { name: c.name, color: (c.portrait && c.portrait.accent) || '#e5e7eb', look: c.look ? { ...c.look, outfit: c.look.outfit.slice() } : null };
  }
  out.hauler = { name: 'Big Ray', color: '#f0b070', look: { cls: 'heavy', skin: '#c89a78', hair: '#3a2a1a', hairStyle: 'buzz', outfit: ['#a04030', '#38424a'], accessory: 'cap', scale: 1 } };
  out.survivor = { name: 'Survivor', color: '#e5e7eb', look: { cls: 'demo', skin: '#d0a078', hair: '#4a3020', hairStyle: 'default', outfit: ['#6a6a50', '#3a3a30'], accessory: 'none', scale: 1 } };
  return out;
})());

/** The default NPC record for a cast key or a plain look, with `name` and `look` filled in. */
export function npcDefaults(key) {
  const c = CAST[key];
  if (c && c.look) return { name: c.name, look: { ...c.look, outfit: c.look.outfit.slice() } };
  return { name: c ? c.name : String(key || 'Survivor'), look: { ...CAST.survivor.look, outfit: CAST.survivor.look.outfit.slice() } };
}

/** NPC tuning. Distances px, speeds px/s, times s. */
export const NPC = Object.freeze({
  radius: 14,
  hp: 220,
  speed: 72,               // escort / walk pace (players 190, walkers 34..48)
  followSpeed: 150,
  waitDist: 360,           // an escorted NPC waits until a survivor is this close
  followMin: 110,          // helpers keep between these distances from their survivor
  followMax: 210,
  bleed: 24,               // seconds a downed NPC can be revived
  reviveTime: 3.2,
  reviveHp: 0.5,           // of max hp
  regen: 4,                // hp/s out of combat (after 5 s)
  shootRange: 420,
  shootRate: 2.2,          // shots per second of a helper
  shootDamage: 16,
  targetBias: 40,          // zombies prefer survivors over an NPC this much closer
});

// ---------------------------------------------------------------------------------------
// Objective markers (the HUD's compass / minimap and the 3D view's icons)

/** Marker kinds (wire order) with the colour the HUD draws them in. */
export const MARKER_KINDS = Object.freeze(['objective', 'item', 'use', 'reach', 'escort', 'defend', 'enemy', 'exit', 'npc']);
export const MARKER_COLORS = Object.freeze({
  objective: '#ffc400', item: '#ffd166', use: '#6ee7b7', reach: '#7dd3fc', escort: '#a5b4fc',
  defend: '#fca5a5', enemy: '#ff6b5b', exit: '#86efac', npc: '#fde68a',
});

// ---------------------------------------------------------------------------------------
// Missions

/**
 * Wave-equivalent difficulty ("tier") of a mission: the wave number its zombies are scaled
 * for (hp, types, counts). `mission.tier` wins; else it follows the recommended level.
 */
export function missionTier(mission) {
  if (mission && Number.isFinite(mission.tier)) return Math.max(1, Math.min(30, Math.round(mission.tier)));
  const lv = mission && Array.isArray(mission.level) ? mission.level : [1, 1];
  const avg = (Number(lv[0]) + Number(lv[1])) / 2;
  return Math.max(1, Math.min(15, Math.round(1 + (avg - 1) * 0.7)));
}

/** Estimated reading time of a subtitle (ms) when a line gives none. */
export function lineMs(text) {
  const n = String(text || '').length;
  return Math.max(2200, Math.min(7000, 1200 + n * 55));
}

/**
 * Normalise one radio / say line: `{ who, text, ms?, kind?: 'radio'|'say' }`. Accepts
 * `{ radio: {...} }` / `{ say: {...} }` wrappers, `{ type: 'say' }`, or a bare line (= radio).
 * @returns {{who: string, text: string, ms: number, kind: 'radio'|'say'}|null}
 */
export function normLine(line, defaultKind = 'radio') {
  if (!line || typeof line !== 'object') return null;
  let kind = defaultKind, l = line;
  if (l.radio && typeof l.radio === 'object') { kind = 'radio'; l = l.radio; }
  else if (l.say && typeof l.say === 'object') { kind = 'say'; l = l.say; }
  else if (l.kind === 'say' || l.type === 'say') kind = 'say';
  else if (l.kind === 'radio' || l.type === 'radio') kind = 'radio';
  const text = typeof l.text === 'string' ? l.text.trim() : '';
  if (!text) return null;
  const ms = Number.isFinite(l.ms) && l.ms > 0 ? Math.min(20000, Math.round(l.ms)) : lineMs(text);
  return { who: String(l.who || ''), text: text.slice(0, 240), ms, kind };
}
