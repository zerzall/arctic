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

// ---- vocabularies (the test checks the data against these) -----------------------------
/** `collect` item kinds used by the missions (S2 draws them). */
export const ITEM_KINDS = ['note', 'fuel', 'battery', 'part', 'crate', 'pump', 'medkit', 'tag', 'player'];

/** Step types the executor implements (STORY.md §5.4). */
export const STEP_TYPES = ['defend', 'waves', 'survive', 'collect', 'reach', 'activate', 'escort', 'kill', 'boss', 'evac', 'campaignStage', 'wait', 'dialogue'];

/** Anchor names authors may use, per map (STORY.md §5.2). */
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
};

export const TODO_KEYS = Object.keys(TODO_REQUESTS);
