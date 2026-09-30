// Test missions in the script format of STORY.md §5.4: small, quick versions of the real
// ones, together covering every step type (dialogue, wait, reach, collect, activate, escort,
// kill, survive, waves, boss, defend, evac, campaignStage), parallel and optional steps,
// pressure, radio lines, stars and rewards. The fifteen real missions live in
// shared/story/missions.js; the data test checks those against the same validator.

const say = (who, text, ms) => ({ who, text, ms });

/** Highway: reach, collect, activate, escort, on foot around the bus. */
export const FX_FOOT = {
  id: 'fx_foot', chapter: 1, index: 1, title: 'Fixture: on foot', blurb: 'Reach, collect, activate, escort.',
  map: 'highway', time: 'night', mode: 'free', level: [1, 2], party: { min: 1, max: 6 },
  startAt: 'overpass',
  npcs: [{ id: 'hauler', at: 'overpass', mode: 'idle' }],
  briefing: [{ who: 'mara', text: 'Stay together and stay quiet.' }],
  steps: [
    { id: 'hello', type: 'dialogue', lines: [say('mara', 'Radio check. Nice and easy.', 800), say('ozzy', 'Copy that.', 600)] },
    { id: 'pause', type: 'wait', seconds: 1 },
    { id: 'walk', type: 'reach', at: 'bus', hold: 2, text: 'Get to the bus', pressure: false, onDone: [say('mara', 'That is the bus.', 700)] },
    { id: 'fuel', type: 'collect', item: 'fuel', count: 3, at: ['bus'], text: 'Find the fuel cans', pressure: { bursts: 1, every: 5, delay: 3, size: 5, tier: 1 } },
    { id: 'power', type: 'activate', at: ['bus', 'overpass'], hold: 2, kind: 'terminal', text: 'Hack both terminals', pressure: false },
    { id: 'note', type: 'collect', item: 'note', count: 1, at: ['overpass'], optional: true, text: 'Find the note', pressure: false },
    { id: 'haul', type: 'escort', npc: 'hauler', route: ['overpass', 'bus'], text: 'Walk the hauler to the bus', pressure: false, onStart: [say('deke', 'Move out.', 600)] },
  ],
  rewards: { xp: 100, scrap: 40, flags: { fx_foot_done: true } },
  debrief: [{ who: 'mara', text: 'Good work.' }],
  stars: { time: 600, noDowns: true, optional: 'collectAll' },
};

/** Highway: the fighting steps (kill, survive, waves, boss, parallel defend). */
export const FX_FIGHT = {
  id: 'fx_fight', chapter: 1, index: 2, title: 'Fixture: fighting', blurb: 'Kill, survive, waves, boss, defend.',
  map: 'highway', time: 'night', mode: 'defend', level: [1, 2], party: { min: 1, max: 6 },
  startAt: 'bus', tier: 1, respawn: 20,
  steps: [
    { id: 'kills', type: 'kill', enemy: 'walker', count: 4, text: 'Kill four zombies', pressure: { every: 6, size: 4, delay: 2, tier: 1 } },
    { id: 'hold', type: 'survive', seconds: 10, pressure: { every: 6, size: 4, delay: 2, bursts: 2 }, text: 'Hold out' },
    { id: 'waves', type: 'waves', count: 2, scale: 0.22, gap: 3, text: 'Fight off the waves' },
    { id: 'guard', type: 'defend', target: 'bus', waves: 1, scale: 0.2, text: 'Defend the bus' },
    { id: 'big', type: 'boss', enemy: 'brute', text: 'Kill the brute' },
  ],
  rewards: { xp: 200, scrap: 60 },
  stars: { time: 900 },
};

/** Bridge: defend the APC while repairing it (a parallel step), with a radio warning. */
export const FX_BRIDGE = {
  id: 'fx_bridge', chapter: 3, index: 1, title: 'Fixture: the crossing', blurb: 'Repair while defending.',
  map: 'bridge', time: 'day', mode: 'defend', level: [2, 4], party: { min: 1, max: 6 },
  startAt: 'apc',
  steps: [
    { id: 'guard', type: 'defend', target: 'apc', waves: 1, scale: 0.25, parallel: true, required: true, text: 'Defend the APC', onStart: [say('okafor', 'They are coming over the bridge!', 900)] },
    { id: 'fix', type: 'activate', at: ['apc'], hold: 3, kind: 'repair', text: 'Repair the APC', pressure: false, onDone: [say('okafor', 'She runs!', 600)] },
  ],
  rewards: { xp: 150, scrap: 50 },
  stars: { time: 900, noDowns: true },
};

/** Harlan: two safe zones of an Evac Run. */
export const FX_EVAC = {
  id: 'fx_evac', chapter: 5, index: 1, title: 'Fixture: down the interstate', blurb: 'Two stops.',
  map: 'harlan', time: 'day', mode: 'zone', level: [6, 8], party: { min: 1, max: 6 }, waveScale: 0.15,
  steps: [
    { id: 'run', type: 'evac', stops: ['mainStreet', 'gasNGo'], text: 'Reach the safe zones' },
  ],
  rewards: { xp: 300, scrap: 90 },
  stars: { time: 1800 },
};

/** Checkpoint: the hill of a campaign, cut short. */
export const FX_HILL = {
  id: 'fx_hill', chapter: 6, index: 1, title: 'Fixture: the hill', blurb: 'Hold three waves.',
  map: 'checkpoint', time: 'day', mode: 'campaign', level: [8, 10], party: { min: 1, max: 6 }, waveScale: 0.12,
  steps: [
    { id: 'hill', type: 'campaignStage', stage: 'hill', waves: 3, text: 'Hold the hill' },
  ],
  rewards: { xp: 400, scrap: 120 },
  stars: { time: 1800 },
};

export const FIXTURE_MISSIONS = [FX_FOOT, FX_FIGHT, FX_BRIDGE, FX_EVAC, FX_HILL];
