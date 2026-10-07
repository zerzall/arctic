// Small pure helpers + vocabularies shared by the mission files. Data only, no DOM.

// ---- line builders ------------------------------------------------------------------
/** A radio line (subtitle + static + optional speech): { type:'radio', who, text, ms? }. */
export const radio = (who, text, ms) => (ms ? { type: 'radio', who, text, ms } : { type: 'radio', who, text });
/** A spoken line, said in person nearby: { type:'say', who, text, ms? }. */
export const say = (who, text, ms) => (ms ? { type: 'say', who, text, ms } : { type: 'say', who, text });
/** A line of a dialogue scene (briefing / debrief / dialogue step): { who, text }. */
export const L = (who, text) => ({ who, text });

/**
 * Zombie pressure for a step (STORY.md §5.4 `pressure:{ waves, pace, specials }`).
 *   waves    the VIRTUAL WAVE NUMBER the pressure is scaled at (count/hp growth, and the type mix
 *            via ZOMBIES[type].weight(w): w1 walkers only, w2+ runners, w3+ crawlers, w4+ bloaters
 *            and spitters, w5+ brutes, w6+ screamers). On defend/waves steps it is the number of
 *            the FIRST wave of the step (each further wave is +1).
 *   pace     spawn rate multiplier on SPAWN_PACING at that wave (1 = a normal wave's tempo).
 *            trickle 0.25-0.4, steady 0.5-0.8, heavy 0.9-1.3, surge 1.4-1.8. Zombies walk 34-48 px/s,
 *            so even a surge takes 15-20 s to arrive from the map edge.
 *   specials type ids forced into the mix even where weight(w) would be 0 (e.g. a 'runner' teaser).
 */
export const P = (waves, pace, specials) => (specials && specials.length ? { waves, pace, specials } : { waves, pace });

/**
 * Pressure on a story level (JOURNEY.md §4.2): the same numbers, with the zombies coming from the spawn
 * rects of `section` (the section the objective is in, usually the one the crew stands in).
 */
export const PS = (section, waves, pace, specials) => ({ ...P(waves, pace, specials), section });

/** kill step: `zombie` is the zombie type id (STORY.md writes it `type`, which collides). */
export const kill = (id, zombie, count, text, extra = {}) => ({
  id, type: 'kill', zombie, count, text, ...extra, todo: extra.at ? 'zombieKey,killAt' : 'zombieKey',
});
/** boss step: `zombie` is the boss type id. */
export const boss = (id, text, extra = {}) => ({ id, type: 'boss', zombie: 'boss', text, ...extra, todo: 'zombieKey' });
/** A bonus collect step for one lore note (see NOTES). `since` = id of the step it becomes live at. */
export const noteStep = (noteId, at, text, since) => ({
  id: noteId, type: 'collect', item: 'note', count: 1, at: [at], note: noteId, text, ...(since ? { since } : {}), todo: 'noteRef',
});

// ---- scripted actions of a story level (JOURNEY.md §4.3, story-defs.js LEVEL_ACTIONS) ----------
// They go in a step's onStart / onDone beside its radio and say lines and run in list order;
// `delay` is seconds after the step starts / ends.
const d = (o, delay) => (delay ? { ...o, delay } : o);
export const A = {
  /** Open a gate of the level (the zombies behind it pour through). */
  gate: (id, delay) => d({ type: 'gate', id }, delay),
  /** Shut a gate again (a door slams behind the crew). */
  shut: (id, delay) => d({ type: 'gate', id, open: false }, delay),
  /** A burst of zombies out of an anchor (a doorway, a truck, the pews): `zombie` a type or 'any'. */
  horde: (at, count, zombie = 'any', delay) => d({ type: 'horde', at, count, zombie }, delay),
  /** A burst out of a whole section's spawn rects. */
  hordeIn: (section, count, zombie = 'any', delay) => d({ type: 'horde', section, count, zombie }, delay),
  /** A scripted blast: hurts zombies, shakes and knocks players (no player damage). */
  boom: (at, r = 240, damage = 400, delay) => d({ type: 'explode', at, r, damage }, delay),
  /** A section's lights go out (the power fails) ... */
  dark: (section, delay) => d({ type: 'lights', section, on: false }, delay),
  /** ... or come back. */
  light: (section, delay) => d({ type: 'lights', section, on: true }, delay),
  /** A title card for everyone (48 characters at most). */
  title: (text, sub, delay) => d(sub ? { type: 'title', text, sub } : { type: 'title', text }, delay),
  /** Push the score to a state (audio/music.js MUSIC_STATES: calm, tension, battle, boss ...). */
  music: (state, delay) => d({ type: 'music', state }, delay),
  /** Camera shake for everyone near (0..1). */
  shake: (k, delay) => d({ type: 'shake', k }, delay),
  /** Move the party's respawn point into a section. */
  cp: (section, delay) => d({ type: 'checkpoint', section }, delay),
};

/**
 * The crew walks into the next section of a level: a `reach { section }` step whose end puts up the
 * area's title card, moves the checkpoint there and plays the arrival lines.
 *   card             [title, sub]: the title card (a place name, upper case; 48 characters at most)
 *   o.lines          radio / say lines on arrival (after the card)
 *   o.onStart        lines / actions while the crew walks there
 *   o.pressure       zombies on the way (default: a trickle out of that section)
 *   o.music          a music state on arrival
 *   o.extra          any other step fields (npcs, follow, ...)
 */
export function arrive(id, section, text, card, o = {}) {
  return {
    id, type: 'reach', section, text,
    pressure: o.pressure || PS(section, o.waves || 1, 0.3),
    ...(o.onStart ? { onStart: o.onStart } : {}),
    onDone: [A.title(card[0], card[1]), A.cp(section), ...(o.music ? [A.music(o.music)] : []), ...(o.lines || [])],
    ...(o.extra || {}),
  };
}

// ---- vocabularies (the test checks the data against these) -----------------------------
/** `collect` item kinds used by the missions (S2 draws them; story-defs.js STORY_ITEMS gives each a look). */
export const ITEM_KINDS = [
  'note', 'fuel', 'battery', 'part', 'crate', 'pump', 'medkit', 'tag', 'player',
  'medicine', 'key', 'files', 'insulin', 'keycard', 'fuse', 'charge', 'injector', 'supplies', 'ammo',
];

/** Step types the executor implements (STORY.md §5.4). */
export const STEP_TYPES = ['defend', 'waves', 'survive', 'collect', 'reach', 'activate', 'escort', 'kill', 'boss', 'evac', 'campaignStage', 'wait', 'dialogue'];

/** Anchor names authors may use, per classic map (STORY.md §5.2). The story levels' come from their SPEC. */
export const ANCHORS = {
  highway: ['bus', 'crossroadsW', 'crossroadsE', 'gasStation', 'overpass', 'westEnd', 'eastEnd', 'motel', 'diner'],
  truckstop: ['diner', 'pumps', 'truckLot', 'motelRow', 'roadNorth', 'roadSouth', 'trailerA', 'trailerB', 'trailerC'],
  bridge: ['apc', 'bankW', 'bankE', 'deckMid', 'cargoA', 'cargoB', 'cargoC'],
  checkpoint: ['tower', 'gate', 'compound', 'genA', 'genB', 'genC', 'hill'],
  harlan: ['mainStreet', 'gasNGo', 'haskellFarm', 'stJudes', 'fieldHospital', 'i70Interchange', 'millerQuarry', 'radioHill',
    'shadyPines', 'lakeMarina', 'ridgeHill', 'breakout', 'towerDoor', 'roof', 'zipStart', 'landing'],
};

/**
 * Everything the missions ask of S2 beyond STORY.md §5.4. A step (or the mission) carries
 * `todo: '<key>'`; every feature degrades gracefully: without it the step still plays as its plain
 * base type. The final report lists these too.
 */
export const TODO_REQUESTS = {
  bonus: 'mission.bonus[]: optional steps (collectibles, notes, side objectives). They run in parallel from mission start, or from the start of the step named by `since`, never block the mission end, and stars.optional:"collectAll" means every bonus step is done.',
  stepFlags: 'step.flags:{k:true}: world flags set when that step completes (used by bonus steps such as finding the dog).',
  zombieKey: 'kill/boss steps name the zombie type with `zombie:` (STORY.md writes {type,count}, which collides with the step `type` key).',
  killAt: 'kill.at:<anchor>: where the specials of a kill step come from (a Brute breaking the gate); default = normal spawn rects, spawned by the director if fewer than `count` are alive.',
  lure: 'activate.effect:"lure" with `lure:{ to:<anchor>, seconds }`: the horn/noise makes the zombies on the map walk toward that anchor for a while (they are slow, so it buys the crew a window).',
  explode: 'activate.effect:"explode" with `blast:{ at:<anchor>, r, damage }`: a scripted explosion hazard (the fuel pumps) hurting zombies only, at the moment the hold completes.',
  campaignWaves: 'campaignStage(hill).waves: number of hill waves (default max(3, round(0.6*waves))).',
  noteRef: 'collect(item:"note").note:<noteId>: the id of the note in NOTES (missions.js); the pickup shows that note text and adds it to the journal.',
  graph: 'mission.requires/hub/after: the unlock graph used by index.js nextNodes(); S1 stores progress.node from `after`.',
  level: 'a mission on a story level (JOURNEY.md): mode "free", reach{section}, defend{target:<anchor>} with a defend point, pressure.section, and the level actions (gate, horde, explode, lights, title, music, shake, checkpoint) in onStart/onDone (agent E).',
  side: 'mission.side / opens: a side job on the hideout board (chapter 7 "Side Jobs"): optional, replayable, never in nextNodes; `opens` is the story chapter it belongs to and `after: "hideout"` returns the crew to the hideout it is in.',
};

export const TODO_KEYS = Object.keys(TODO_REQUESTS);
