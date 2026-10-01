// How the netcode treats GameEvents (SPEC §4.1), shared by the host and client sessions
// so both sides agree on what is echoed and what may be thrown away.

/**
 * Events the host repeats in the `echo` of the next snapshots: a state message can be
 * skipped (congested p2p channel or relay socket) or arrive after its successors (the
 * p2p state channel is reliable but unordered), and these carry state the HUD needs.
 */
export const IMPORTANT_EVENTS = new Set([
  'wave', 'waveclear', 'gameover', 'victory', 'buy', 'buyfail', 'down', 'revived', 'died', 'respawn',
  'pickup', 'place', 'placefail', 'destroyed', 'bossspawn', 'drop', 'throw', 'zdie', 'explosion', 'ignite',
  'zone', 'campaign',
  // Road to Haven: the tracker, subtitles, story items, talks and the end of a mission must arrive
  'objective', 'radio', 'storyend', 'interact', 'talk', 'item', 'npc',
  // Story levels: gates, title cards, the score, lights, checkpoints and scripted hordes
  'gate', 'area', 'title', 'music', 'shake', 'lights', 'checkpoint', 'horde',
]);

/**
 * Pure presentation (tracers, sounds, flashes): worthless once old. When a hidden tab
 * comes back, these are dropped instead of all playing in one frame; everything else
 * (kills for corpses, wave banners, downs, purchases ...) is still delivered.
 */
export const PERISHABLE_EVENTS = new Set([
  'shot', 'zattack', 'pdamage', 'melee', 'chain', 'objhit', 'empty', 'spit', 'reload', 'switch',
  'explosion', 'ignite', 'throw', 'scream', 'charge', 'slam', 'freeze',
]);

/** Seconds after which a perishable event is no longer presented. */
export const STALE_EVENT_AGE = 1;
