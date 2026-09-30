// A test mission on the Mill Road level (JOURNEY.md §4): it walks the engine's level features in
// order: a device opens the first gate (with a title, the score, a shake and a horde), the crew
// walks into the gas station (a section reach), holds a defend point at an anchor, and the
// second gate opens behind a blast, a checkpoint and a power cut. Tests and e2e scenario `n`
// use it; it is not part of the campaign.

/** The Mill Road test mission (validates against the placeholder and any real Mill Road). */
export const LEVEL_TEST_MISSION = Object.freeze({
  id: 'test_millroad', chapter: 1, index: 2, title: 'Mill Road (test)', blurb: 'The level engine, end to end.',
  map: 'millroad', mode: 'free', time: 'day', level: [1, 3], party: { min: 1, max: 6 }, respawn: 6,
  briefing: [{ who: 'deke', text: 'Through the jam, then the gas station.' }],
  debrief: [{ who: 'deke', text: 'That will do.' }],
  rewards: { xp: 10, scrap: 10 },
  stars: { time: 900, noDowns: true },
  steps: [
    {
      id: 'semi', type: 'activate', at: ['jam_semi'], hold: 1.5, text: 'Hotwire the semi to shove the shutter',
      pressure: { waves: 1, pace: 0.3 },
      onStart: [{ type: 'title', text: 'THE JAM', sub: 'Mill Road, dawn' }, { type: 'music', state: 'tension' }],
      onDone: [
        { type: 'radio', who: 'deke', text: 'Shutter is up. Move.' },
        { type: 'gate', id: 'gas_shutter' },
        { type: 'shake', k: 0.4 },
        { type: 'horde', section: 'gasstation', count: 6, zombie: 'walker', delay: 1 },
      ],
    },
    { id: 'in', type: 'reach', section: 'gasstation', text: 'Get into Mill Road Gas' },
    {
      id: 'hold', type: 'defend', target: 'gas_tow', seconds: 25, text: 'Hold the tow truck',
      onDone: [
        { type: 'checkpoint', section: 'gasstation' },
        { type: 'explode', at: 'gas_tanks', r: 300, damage: 500 },
        { type: 'lights', section: 'gasstation', on: false },
        { type: 'gate', id: 'trailer_gate', delay: 1.5 },
      ],
    },
    { id: 'out', type: 'reach', section: 'trailers', text: 'Into Shady Acres' },
  ],
});
