// Stand-in story content for development, tests and the e2e run, until the real missions,
// cast and dialogue (shared/story/index.js and friends) are wired in through
// ui/story-content.js. It has the data model of the real content (`requires`, `hub`,
// chapters with arrival scenes, dialogue trees with topics) and a `stub` field the fallback
// mission runner understands:
//
//   stub.waves    play that many plain waves on the map (the classic Defend rules)
//   stub.seconds  the mission is won this many seconds after it starts (tests, dev)
//
// The real mission director ignores `stub`. Every mission here starts from the Roadhouse, so
// a stub campaign begins in the hideout.

const L = (who, text) => ({ who, text });

/** @type {object[]} */
export const STUB_MISSIONS = [
  {
    id: 'm1_1', chapter: 1, index: 1, title: 'Pileup', blurb: 'Hold the bus until the crew is ready to move.',
    map: 'highway', time: 'night', mode: 'defend', level: [1, 3], party: { min: 1, max: 6 },
    requires: [], hub: 'roadhouse', after: 'm1_2',
    stub: { seconds: 6 },
    briefing: [
      L('mara', 'There is a road south, and the road goes to the water. Everyone here can walk it.'),
      L('deke', 'First we get this bus running. That means holding it while I work.'),
      L('crew', 'Then we hold it.'),
    ],
    steps: [{ id: 'hold', type: 'defend', text: 'Defend the bus' }],
    rewards: { xp: 180, scrap: 70, weapon: 'shotgun', upgradePoints: 1, flags: { bus_running: true } },
    debrief: [
      L('deke', 'She turns over. Not pretty, but she turns over.'),
      L('mara', 'Rest. {crew} leaves at first light.'),
    ],
    stars: { time: 300, noDowns: true },
  },
  {
    id: 'm1_2', chapter: 1, index: 2, title: 'Fuel Run', blurb: 'Find fuel before the engine coughs its last.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [2, 4], party: { min: 1, max: 6 },
    requires: ['m1_1'], hub: 'roadhouse', after: 'm1_3',
    stub: { waves: 2 },
    briefing: [L('ozzy', 'The old station on the ridge sells fuel. Sold. Past tense. It has fuel.')],
    steps: [{ id: 'fuel', type: 'collect', text: 'Collect fuel cans' }],
    rewards: { xp: 240, scrap: 90, upgradePoints: 1 },
    debrief: [L('ozzy', 'That is a lot of fuel. I am counting it twice.')],
    stars: { time: 360, noDowns: true },
  },
  {
    id: 'm1_3', chapter: 1, index: 3, title: 'Beacon', blurb: 'Light the overpass beacon for the ones behind us.',
    map: 'highway', time: 'night', mode: 'defend', level: [3, 5], party: { min: 1, max: 6 },
    requires: ['m1_2'], hub: 'roadhouse', after: 'm2_1',
    stub: { waves: 3 },
    briefing: [L('okafor', 'A light on the overpass tells the stragglers where we are. It also tells everything else.')],
    steps: [{ id: 'beacon', type: 'defend', text: 'Hold the overpass' }],
    rewards: { xp: 320, scrap: 110, upgradePoints: 2, unlockNpc: 'priya', flags: { beacon_lit: true } },
    debrief: [L('priya', 'I saw your light from two miles out. Room for one more?')],
    stars: { time: 420, noDowns: true },
  },
  {
    id: 'm2_1', chapter: 2, index: 1, title: 'Diner Siege', blurb: 'The diner has a cellar and a lot of cans.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [4, 6], party: { min: 1, max: 6 },
    requires: ['m1_3'], hub: 'roadhouse', after: 'm3_1',
    stub: { waves: 3 },
    briefing: [L('mara', 'Cans, bandages, maybe a stove. Everything else is a bonus.')],
    steps: [{ id: 'siege', type: 'defend', text: 'Defend the diner' }],
    rewards: { xp: 380, scrap: 130, weapon: 'burst_rifle' },
    debrief: [L('mara', 'Good haul. Nobody eat the paint.')],
    stars: { time: 480, noDowns: true },
  },
  {
    id: 'm3_1', chapter: 3, index: 1, title: 'The Crossing', blurb: 'The bridge is the only way over the river.',
    map: 'bridge', time: 'night', mode: 'defend', level: [6, 8], party: { min: 1, max: 6 },
    requires: ['m2_1'], hub: 'roadhouse', after: 'hideout:depot',
    stub: { waves: 3 },
    briefing: [L('okafor', 'The APC still runs. The bridge does not, unless we make it.')],
    steps: [{ id: 'cross', type: 'defend', text: 'Repair the APC' }],
    rewards: { xp: 520, scrap: 160, upgradePoints: 2 },
    debrief: [L('okafor', 'Across. Stand down. Eat something.')],
    stars: { time: 540, noDowns: true },
  },
];

/** Chapters with the hideout arrival scenes, in the shape of the real data. */
export const STUB_CHAPTERS = [
  { n: 1, title: 'Dead Highway', missions: ['m1_1', 'm1_2', 'm1_3'], hub: 'roadhouse', arrival: null },
  { n: 2, title: 'Last Chance', missions: ['m2_1'], hub: 'roadhouse', arrival: null },
  {
    n: 3, title: 'Blackwater', missions: ['m3_1'], hub: 'roadhouse',
    arrival: {
      hideout: 'depot', flag: 'seen_arrival_depot',
      scene: [
        L('narrator', 'DAY {day}. BLACKWATER DEPOT.'),
        L('priya', 'Signal tower, machine shop, two boxcars. It is not a hotel. But it has doors.'),
        L('deke', 'A lathe. Give me a lathe and a week, {crew}.'),
      ],
    },
  },
];

/** Characters of the stub content (the registry has defaults for the rest). */
export const STUB_CAST = {};

/** Scenes and hideout conversations of the stub content. */
export const STUB_DIALOGUE = {
  scenes: {
    intro: [
      L('warden', 'Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you can carry.'),
      L('mara', 'Day {day}. That is the seventh time I have heard this today.'),
      L('deke', 'Then it is real, or somebody very patient is lying to us.'),
      L('crew', 'Two hundred miles. We walk it together.'),
    ],
  },
  stages: {
    rh: { id: 'rh', hideout: 'roadhouse', when: null },
    dp: { id: 'dp', hideout: 'depot', when: null },
    fs: { id: 'fs', hideout: 'farmstead', when: null },
  },
  talk: {
    mara: {
      rh: {
        greet: ['Anything that bleeds, come see me first. Anything that walks, keep it off me.'],
        topics: [
          { id: 'mara_ask', prompt: 'How is everyone holding up?', lines: [L('mara', 'Tired. Alive. It is a good week when those two go together.')], once: true, setFlags: { asked_mara: true } },
          { id: 'mara_gun', prompt: 'Any advice for a fight?', lines: [L('mara', 'Back up while you shoot. It is not clever, it works.')] },
        ],
      },
    },
    deke: { rh: { greet: ['Bring me scrap and I will make that gun sing.'], topics: [] } },
  },
  idle: { ozzy: ['The board is live. Pick a job.'], okafor: ['Armory is open. Count it back in.'], priya: ['Noted.'], june: ['Did you see the moon?'] },
};

/** Convenience for tests and tools: the whole stub content in setStoryContent() shape. */
export const STUB_CONTENT = { missions: STUB_MISSIONS, cast: STUB_CAST, dialogue: STUB_DIALOGUE, chapters: STUB_CHAPTERS };
