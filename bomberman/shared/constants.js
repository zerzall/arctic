// Every tunable number, enum and table of the game (docs/SPEC.md §3). This is the single source:
// nobody else defines these, and everything exported here is deeply frozen so a stray write
// in one module cannot silently change the rules for the others.
//
// Isomorphic: runs unchanged in Node and in the browser (SPEC §0.4).

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ---- Clock and wire ---------------------------------------------------------------------------
export const TICK_RATE = 60;
export const DT = 1 / 60;                 // multiply by DT, never divide by 60 (SPEC §3.5)
export const SNAP_EVERY = 3;              // 20 Hz snapshots
export const WIRE_VERSION = 1;

// ---- Board and players ------------------------------------------------------------------------
export const GRID_W = 15;
export const GRID_H = 13;
export const MAX_PLAYERS = 8;
export const MIN_TO_START = 2;
export const PLAYER_HALF = 0.34;          // half-size of the square hitbox, in tiles
export const EPS = 1e-6;

// ---- Movement and power-ups -------------------------------------------------------------------
export const BASE_SPEED = 3.6;            // tiles/s at speed level 0
export const SPEED_STEP = 0.5;
export const MAX_SPEED_LV = 6;
export const START_BOMBS = 1;
export const MAX_BOMBS = 8;
export const START_RANGE = 2;
export const MAX_RANGE = 10;

// ---- Bombs and flames -------------------------------------------------------------------------
export const FUSE_TICKS = 150;            // 2.5 s
export const FLAME_TICKS = 36;            // a flame tile is lethal for exactly this many kill checks
export const KICK_STEP_TICKS = 7;         // a kicked bomb advances one whole tile every 7 ticks
export const THROW_DIST = 3;
export const THROW_TICKS = 26;

// ---- Shields and curses -----------------------------------------------------------------------
export const SHIELD_TICKS = 480;
export const SPAWN_SHIELD_TICKS = 120;
export const SHIELD_FOREVER = 65535;      // JSON-safe stand-in for Infinity, never decremented
export const SHIELDHIT_GAP_TICKS = 12;
export const CURSE_TICKS = 600;
export const CURSE_TOUCH_RADIUS = 0.7;
export const CURSE_XFER_COOLDOWN = 60;
export const CURSE_SLOW_SPEED = 1.6;
export const CURSE_RUSH_SPEED = 7.5;
export const SPAM_INTERVAL = 24;

// ---- Round lifecycle --------------------------------------------------------------------------
export const COUNTDOWN_TICKS = 180;
export const COUNTDOWN_HOLD_TICKS = 12;
export const ENDING_TICKS = 150;
export const OVER_HOLD_TICKS = 120;
export const DEATH_ANIM_TICKS = 60;
export const SD_INTERVAL = 8;
export const SD_WARN_TICKS = 48;
export const MAX_ROUND_TICKS = 36000;
export const SHOWDOWN_TICKS = 900;
export const INTERP_TICKS = 6;

// ---- Input queue and limits -------------------------------------------------------------------
export const INPUT_QUEUE_MAX = 40;
export const INPUT_CATCHUP_AT = 2;
export const CATCHUP_CREDIT_MAX = 12;
export const IN_MAX_CMDS = 16;
export const IN_FLOOD_RATE = 120;
export const IN_FLOOD_BURST = 60;
export const MAX_NAME = 14;               // graphemes
export const MAX_CHAT = 120;              // graphemes

// ---- Direction tables (dir code 0 none, 1 up, 2 right, 3 down, 4 left; facing = dir - 1) ------
export const DIR = deepFreeze({ NONE: 0, UP: 1, RIGHT: 2, DOWN: 3, LEFT: 4 });
export const DIR_DX = deepFreeze([0, 0, 1, 0, -1]);
export const DIR_DY = deepFreeze([0, -1, 0, 1, 0]);

// ---- Shared tables ----------------------------------------------------------------------------
export const SPAWN_SLOTS = deepFreeze([[1, 1], [13, 11], [13, 1], [1, 11], [7, 1], [7, 11], [1, 6], [13, 6]]);   // [tx,ty] by slot

export const PLAYER_COLORS = deepFreeze([
  { name: 'Red', hex: '#ff4d5e', accessory: 'antenna' },
  { name: 'Blue', hex: '#3d8bff', accessory: 'propeller' },
  { name: 'Green', hex: '#38c85a', accessory: 'sprout' },
  { name: 'Yellow', hex: '#ffd23f', accessory: 'crown' },
  { name: 'Purple', hex: '#a55eea', accessory: 'horns' },
  { name: 'Orange', hex: '#ff9f43', accessory: 'flame' },
  { name: 'Pink', hex: '#ff7eb6', accessory: 'bow' },
  { name: 'Cyan', hex: '#2ed9e6', accessory: 'headphones' },
]);

export const TEAM_COLORS = deepFreeze(['#ff6b5e', '#22c3b0']);         // team 0 coral, team 1 teal
export const EMOTES = deepFreeze(['\u{1F600}', '\u{1F602}', '\u{1F621}', '\u{1F631}', '\u{1F44D}', '\u{1F389}', '\u{1F4A3}', '\u{1F480}']);
export const THEMES = deepFreeze(['meadow', 'frost', 'lava', 'candy', 'night']);
export const ITEM_KINDS = deepFreeze(['bomb', 'flame', 'speed', 'kick', 'glove', 'shield', 'skull']);
export const CURSE_KINDS = deepFreeze(['slow', 'rush', 'reverse', 'nobomb', 'spam']);
export const BOT_LEVELS = deepFreeze(['easy', 'normal', 'hard']);
export const BOT_NAMES = deepFreeze(['Bolt', 'Fuse', 'Pixel', 'Zap', 'Boomer', 'Spark', 'Nova', 'Kaboom']);
export const ITEM_WEIGHTS = deepFreeze({ bomb: 22, flame: 22, speed: 14, kick: 8, glove: 7, shield: 6, skull: 8 });   // weights, not percent
export const DROP_CHANCE = deepFreeze({ none: 0, few: 0.22, normal: 0.42, many: 0.65 });
export const BLOCK_DENSITY = deepFreeze({ few: 0.50, normal: 0.72, many: 0.90 });
export const STATE = deepFreeze({ COUNTDOWN: 0, PLAYING: 1, ENDING: 2, OVER: 3 });
export const PHASES = deepFreeze(['lobby', 'match', 'results']);

// protocol.js validates against it, Room takes defaults from it, ui.js builds the panel from it.
// `mode` 'coop' (everybody against waves of bots) and 'adventure' (levels of monsters and a hidden exit door) are the co-op
// modes of Appendix C; `difficulty` only matters to them (enemy bots in coop, monsters and lives in adventure).
export const SETTINGS_DEFS = deepFreeze({
  rounds: { values: [1, 2, 3, 5, 7], def: 3 },
  roundTime: { values: [0, 60, 90, 120, 180, 240], def: 120 },
  suddenDeath: { values: [true, false], def: true },
  mode: { values: ['ffa', 'teams', 'coop', 'adventure'], def: 'ffa' },
  difficulty: { values: ['easy', 'normal', 'hard'], def: 'normal' },
  theme: { values: ['random', ...THEMES], def: 'random' },
  layout: { values: ['classic', 'open'], def: 'classic' },
  blocks: { values: ['few', 'normal', 'many'], def: 'normal' },
  items: { values: ['none', 'few', 'normal', 'many'], def: 'normal' },
  locked: { values: [true, false], def: false },
});

// ---- Co-op modes (docs/SPEC.md Appendix C) ------------------------------------------------------
// Everything that differs from the battle modes is gated on these modes, so 'ffa' and 'teams' run exactly as before.
export const COOP_MODES = deepFreeze(['coop', 'adventure']);
export const ADVENTURE_LEVELS = 8;          // levels of an adventure (the `rounds` setting is the number of waves in coop)
export const ADVENTURE_TIME = 180;          // seconds of a level before the hurry-up monsters come out
export const ADVENTURE_LIVES = deepFreeze({ easy: 5, normal: 3, hard: 2 });   // shared lives, plus one per extra human
export const RESPAWN_TICKS = 150;           // a downed human with lives left is back after 2.5 s, with a spawn shield
export const CLEAR_POINTS = 500;            // team score per level (or wave) number for clearing it
export const ENEMY_POINTS = 250;            // team score for every enemy bot a team-mate blasts in coop
export const MONSTER_TOUCH = 0.6;           // tiles: a monster catches a fighter whose centre is closer than this on BOTH axes
export const MONSTER_KINDS = deepFreeze(['puff', 'zippy', 'ghost', 'tank', 'jelly', 'mini']);
/**
 * speed: tiles/s at level 1 (normal difficulty). hp: flame hits it takes. points: team score. chase: tiles within which it heads
 * for the nearest fighter (0 = never). ghost: drifts through soft blocks. split: kind it bursts into (two of them) when it pops.
 */
export const MONSTER_DEFS = deepFreeze({
  puff: { speed: 1.25, hp: 1, points: 100, chase: 0, ghost: false, split: null },     // balloon: slow, wanders at random
  zippy: { speed: 2.2, hp: 1, points: 200, chase: 6, ghost: false, split: null },     // quick little spark: runs at you when near
  ghost: { speed: 1.5, hp: 1, points: 300, chase: 8, ghost: true, split: null },      // floats through crates, drifts your way
  tank: { speed: 1.05, hp: 2, points: 400, chase: 0, ghost: false, split: null },     // armoured: two hits, angry (and chasing) after the first
  jelly: { speed: 1.6, hp: 1, points: 300, chase: 0, ghost: false, split: 'mini' },   // wobbly: pops into two minis
  mini: { speed: 2.1, hp: 1, points: 100, chase: 0, ghost: false, split: null },
});
export const ENEMY_NAMES = deepFreeze(['Grumble', 'Snoot', 'Rascal', 'Mischief', 'Prankster', 'Sneaky', 'Boomzilla', 'Wobbles']);

export const TIMEOUTS = deepFreeze({
  GRACE_LOBBY_MS: 120000, GRACE_MATCH_MS: 30000, HOST_MIGRATE_MS: 60000, EMPTY_CLOSE_MS: 30000, RESULTS_AUTO_MS: 30000,
  HELLO_MS: 10000, PING_MS: 15000, DEAD_MS: 35000, IDLE_LOBBY_MS: 1800000, IDLE_MATCH_MS: 300000, ROOM_MAX_MS: 21600000,
});
