// Stand-in story content for development, tests and the e2e run, until the real missions,
// cast and dialogue (shared/story/{missions,cast,dialogue}.js, written separately) are wired
// in through ui/story-content.js. It follows the mission format of STORY.md §5.4, plus a
// `stub` field the fallback mission runner understands:
//
//   stub.waves    play that many plain waves on the map (the classic Defend rules)
//   stub.seconds  the mission is won this many seconds after it starts (tests, dev)
//
// The real mission director ignores `stub`.

/** @type {object[]} */
export const STUB_MISSIONS = [
  {
    id: 'm1_1', chapter: 1, index: 1, title: 'Pileup', blurb: 'Hold the bus until the crew is ready to move.',
    map: 'highway', time: 'night', mode: 'defend', level: [1, 3], party: { min: 1, max: 6 },
    stub: { seconds: 6 },
    briefing: [
      { who: 'mara', text: 'There is a road south, and the road goes to the water. Everyone here can walk it.' },
      { who: 'deke', text: 'First we get this bus running. That means holding it while I work.' },
      { who: 'crew', text: 'Then we hold it.' },
    ],
    steps: [{ id: 'hold', type: 'defend', text: 'Defend the bus' }],
    rewards: { xp: 180, scrap: 70, weapon: 'shotgun', upgradePoints: 1, flags: { bus_running: true } },
    debrief: [
      { who: 'deke', text: 'She turns over. Not pretty, but she turns over.' },
      { who: 'mara', text: 'Rest. We leave at first light.' },
    ],
    stars: { time: 300, noDowns: true },
  },
  {
    id: 'm1_2', chapter: 1, index: 2, title: 'Fuel Run', blurb: 'Find fuel before the engine coughs its last.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [2, 4], party: { min: 1, max: 6 },
    stub: { waves: 2 },
    briefing: [{ who: 'ozzy', text: 'The old station on the ridge sells fuel. Sold. Past tense. It has fuel.' }],
    steps: [{ id: 'fuel', type: 'collect', text: 'Collect fuel cans' }],
    rewards: { xp: 240, scrap: 90, upgradePoints: 1 },
    debrief: [{ who: 'ozzy', text: 'That is a lot of fuel. I am counting it twice.' }],
    stars: { time: 360, noDowns: true },
  },
  {
    id: 'm1_3', chapter: 1, index: 3, title: 'Beacon', blurb: 'Light the overpass beacon for the ones behind us.',
    map: 'highway', time: 'night', mode: 'defend', level: [3, 5], party: { min: 1, max: 6 },
    stub: { waves: 3 },
    briefing: [{ who: 'okafor', text: 'A light on the overpass tells the stragglers where we are. It also tells everything else.' }],
    steps: [{ id: 'beacon', type: 'defend', text: 'Hold the overpass' }],
    rewards: { xp: 320, scrap: 110, upgradePoints: 2, unlockNpc: 'priya', flags: { beacon_lit: true } },
    debrief: [{ who: 'priya', text: 'I saw your light from two miles out. Room for one more?' }],
    stars: { time: 420, noDowns: true },
  },
  {
    id: 'm2_1', chapter: 2, index: 1, title: 'Diner Siege', blurb: 'The diner has a cellar and a lot of cans.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [4, 6], party: { min: 1, max: 6 },
    stub: { waves: 3 },
    briefing: [{ who: 'mara', text: 'Cans, bandages, maybe a stove. Everything else is a bonus.' }],
    steps: [{ id: 'siege', type: 'defend', text: 'Defend the diner' }],
    rewards: { xp: 380, scrap: 130, weapon: 'burst_rifle' },
    debrief: [{ who: 'mara', text: 'Good haul. Nobody eat the paint.' }],
    stars: { time: 480, noDowns: true },
  },
  {
    id: 'm3_1', chapter: 3, index: 1, title: 'The Crossing', blurb: 'The bridge is the only way over the river.',
    map: 'bridge', time: 'night', mode: 'defend', level: [6, 8], party: { min: 1, max: 6 },
    stub: { waves: 3 },
    briefing: [{ who: 'okafor', text: 'The APC still runs. The bridge does not, unless we make it.' }],
    steps: [{ id: 'cross', type: 'defend', text: 'Repair the APC' }],
    rewards: { xp: 520, scrap: 160, upgradePoints: 2 },
    debrief: [{ who: 'okafor', text: 'Across. Stand down. Eat something.' }],
    stars: { time: 540, noDowns: true },
  },
];

/** Characters of the stub content (the registry has defaults for the rest). */
export const STUB_CAST = {};

/** Scenes and hideout conversations of the stub content. */
export const STUB_DIALOGUE = {
  scenes: {
    intro: [
      { who: 'warden', text: 'Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you can carry.' },
      { who: 'mara', text: 'Day forty-one. That is the seventh time I have heard this today.' },
      { who: 'deke', text: 'Then it is real, or somebody very patient is lying to us.' },
      { who: 'crew', text: 'Two hundred miles. We walk it together.' },
    ],
  },
  talks: {
    mara: [[{ who: 'mara', text: 'Anything that bleeds, come see me first. Anything that walks, keep it off me.' }]],
    deke: [[{ who: 'deke', text: 'Bring me scrap and I will make that gun sing.' }]],
    ozzy: [[{ who: 'ozzy', text: 'The board is live. Pick a job and I will find you a frequency.' }]],
    okafor: [[{ who: 'okafor', text: 'Armory is open. Take what you can carry and count it back in.' }]],
    priya: [[{ who: 'priya', text: 'I can read a map. Tell me where and I will tell you how far.' }]],
    june: [[{ who: 'june', text: 'Did you see the moon? It is very big tonight.' }]],
  },
};

/** Convenience for tests and tools: the whole stub content in setStoryContent() shape. */
export const STUB_CONTENT = { missions: STUB_MISSIONS, cast: STUB_CAST, dialogue: STUB_DIALOGUE };
