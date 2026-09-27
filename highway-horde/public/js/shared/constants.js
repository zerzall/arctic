// Game-wide constants shared by the simulation, the netcode and the client.
// Everything in shared/ must run unchanged in the browser and in Node (no DOM).

export const GAME_VERSION = '1.0.0';
// Bumped whenever the wire format changes; host and clients must match.
export const PROTOCOL_VERSION = 1;

// ---- Simulation clock -------------------------------------------------------
export const TICK_RATE = 60;               // simulation ticks per second
export const DT = 1 / TICK_RATE;           // seconds per tick
export const SNAPSHOT_EVERY = 3;           // host sends a snapshot every N ticks (20 Hz)
export const INTERP_DELAY = 0.1;           // client renders remote entities this far in the past (s)
export const MAX_CATCHUP_TICKS = 8;        // host never simulates more than this per wake-up

// ---- Session ----------------------------------------------------------------
export const MAX_PLAYERS = 6;
export const ROOM_CODE_LENGTH = 5;
// No 0/O/1/I/L so codes can be read out loud.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PEER_ID_PREFIX = 'highway-horde-';
export const NAME_MAX_LENGTH = 16;
export const CHAT_MAX_LENGTH = 160;

// Player colours (index 0..5) — used for name tags, helmets, minimap dots.
export const PLAYER_COLORS = ['#4fc3f7', '#ff8a65', '#aed581', '#ffd54f', '#ba68c8', '#f06292'];
export const PLAYER_COLOR_NAMES = ['Blue', 'Orange', 'Green', 'Yellow', 'Purple', 'Pink'];

// ---- Player -----------------------------------------------------------------
export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 190;           // px/s
export const SPRINT_MULT = 1.45;
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 32;           // per second while sprinting and moving
export const STAMINA_REGEN = 22;           // per second otherwise
export const STAMINA_MIN_TO_SPRINT = 15;   // once exhausted, must regain this much first
export const PLAYER_MAX_HP = 100;
export const ARMOR_MAX = 100;
export const ARMOR_ABSORB = 0.6;           // share of incoming damage that armour soaks up
export const WEAPON_SLOTS = 3;
export const START_CASH = 500;

export const DOWNED_SPEED = 45;
export const BLEEDOUT_TIME = 30;           // seconds before a downed player dies
export const REVIVE_TIME = 3.0;            // seconds of holding interact
export const REVIVE_RADIUS = 70;
export const REVIVE_HP = 40;
export const SELF_REVIVE_DELAY = 4;        // seconds after going down before a self-revive kit fires
export const RESPAWN_HP = 100;
// Hits on a downed player cost DOWNED_HIT_BLEED s of bleedout per damage point, drained at
// most DOWNED_HIT_BLEED_RATE extra s per s (a mauled survivor bleeds out at most twice as
// fast, so a teammate can still get there); at most DOWNED_HIT_BLEED_BANK s are pending.
export const DOWNED_HIT_BLEED = 0.05;
export const DOWNED_HIT_BLEED_RATE = 1;
export const DOWNED_HIT_BLEED_BANK = 3;

export const INTERACT_RADIUS = 60;         // pick up crates, use supply station
export const PICKUP_RADIUS = 36;           // auto-collect ammo/health/cash
export const PICKUP_LIFETIME = 30;         // seconds before a dropped pickup vanishes
export const SUPPLY_RADIUS = 130;          // shop usable mid-wave only this close to the map's supply station

export const MELEE_RANGE = 70;
export const MELEE_ARC = 1.3;              // radians, full cone width
export const MELEE_DAMAGE = 30;
export const MELEE_KNOCKBACK = 420;
export const MELEE_COOLDOWN = 0.7;

export const FRAG_MAX = 5;
export const MOLOTOV_MAX = 3;
export const THROW_SPEED = 620;            // initial speed of thrown grenades/molotovs
export const THROW_COOLDOWN = 0.6;

// Zombie hits on the objective do this share of their damage (a few stragglers chew
// slowly; a horde left alone still wrecks it).
export const OBJECTIVE_DAMAGE_MULT = 0.5;
// The objective's hp is the map's value × (1 + OBJECTIVE_HP_PER_PLAYER × (players - 1)) at
// game start: bigger teams face bigger hordes.
export const OBJECTIVE_HP_PER_PLAYER = 0.25;

// ---- Deployables --------------------------------------------------------------
export const TURRET = {
  hp: 350, range: 520, damage: 22, rate: 7, ammo: 450,
  turnRate: 7,                             // radians/s
  radius: 18,
  maxPerPlayer: 2,
};
export const BARRICADE = {
  hp: 900, width: 96, height: 22,
  maxPerPlayer: 4,
  placeDistance: 55,                       // centre placed this far in front of the player
};

// ---- Waves --------------------------------------------------------------------
export const PREP_TIME = 20;               // seconds before wave 1
export const INTERMISSION_TIME = 25;       // seconds between waves (all players ready = skip)
export const BOSS_EVERY = 5;               // boss on waves 5, 10, 15, ...
export const WAVE_CLEAR_BONUS = 300;       // cash to every living/downed player when a wave is cleared
export const REVIVE_BONUS = 100;
// Zombies in wave w: round((base + perWave * w) * (1 + perPlayer * (players - 1)) * difficulty.count).
// Boss waves (every BOSS_EVERY-th) bring bossWave × that many regulars besides the bosses.
export const WAVE_ZOMBIES = { base: 22, perWave: 5, perPlayer: 0.6, bossWave: 0.65 };
// Spawning: a group of int(groupMin, groupMax + floor(w / groupPerWaves)) every
// clamp(start - perWave * (w - 1), min, start) / crowd^crowdExp s (× 0.75..1.25), where
// crowd = (1 + perPlayer * (players - 1)) * difficulty.count.
export const SPAWN_PACING = { start: 4.4, perWave: 0.09, min: 2.2, groupMin: 4, groupMax: 6, groupPerWaves: 4, crowdExp: 0.5 };
export const HP_GROWTH_PER_WAVE = 0.08;    // zombie hp multiplier = 1 + growth * (wave - 1)
export const SPEED_GROWTH_PER_WAVE = 0.012;// zombie speed multiplier, capped below
export const SPEED_GROWTH_CAP = 1.3;

export const DIFFICULTIES = {
  easy:      { name: 'Easy',      hp: 0.75, damage: 0.6,  count: 0.8,  maxAlive: 120, cash: 1.25 },
  normal:    { name: 'Normal',    hp: 1.0,  damage: 1.0,  count: 1.0,  maxAlive: 170, cash: 1.0  },
  hard:      { name: 'Hard',      hp: 1.25, damage: 1.3,  count: 1.25, maxAlive: 220, cash: 0.9  },
  nightmare: { name: 'Nightmare', hp: 1.7,  damage: 1.8,  count: 1.5,  maxAlive: 260, cash: 0.8  },
};
export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);

/** Zombies in wave `w` (bosses not included) for `players` players at difficulty `diff`. */
export function waveZombieCount(w, players, diff = DIFFICULTIES.normal) {
  const z = WAVE_ZOMBIES;
  const boss = w % BOSS_EVERY === 0 ? z.bossWave : 1;
  return Math.round((z.base + z.perWave * w) * (1 + z.perPlayer * (Math.max(1, players) - 1)) * diff.count * boss);
}
export const WAVE_OPTIONS = [10, 15, 20, 0];  // 0 = endless

// Default lobby settings chosen by the host.
export const DEFAULT_SETTINGS = {
  mapId: 'highway',
  difficulty: 'normal',
  waves: 15,
  objective: true,
  friendlyFire: false,
};

// ---- Navigation ----------------------------------------------------------------
export const NAV_CELL = 32;                // flow-field cell size in px
export const NAV_REBUILD_INTERVAL = 0.25;  // seconds between flow-field rebuilds
