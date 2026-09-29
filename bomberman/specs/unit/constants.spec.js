import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../shared/constants.js';

test('every scalar constant of SPEC section 3 is exported with its value', () => {
  const expected = {
    TICK_RATE: 60, DT: 1 / 60, SNAP_EVERY: 3, WIRE_VERSION: 1, GRID_W: 15, GRID_H: 13, MAX_PLAYERS: 8, MIN_TO_START: 2,
    PLAYER_HALF: 0.34, EPS: 1e-6, BASE_SPEED: 3.6, SPEED_STEP: 0.5, MAX_SPEED_LV: 6, START_BOMBS: 1, MAX_BOMBS: 8,
    START_RANGE: 2, MAX_RANGE: 10, FUSE_TICKS: 150, FLAME_TICKS: 36, KICK_STEP_TICKS: 7, THROW_DIST: 3, THROW_TICKS: 26,
    SHIELD_TICKS: 480, SPAWN_SHIELD_TICKS: 120, SHIELD_FOREVER: 65535, SHIELDHIT_GAP_TICKS: 12, CURSE_TICKS: 600,
    CURSE_TOUCH_RADIUS: 0.7, CURSE_XFER_COOLDOWN: 60, CURSE_SLOW_SPEED: 1.6, CURSE_RUSH_SPEED: 7.5, SPAM_INTERVAL: 24,
    COUNTDOWN_TICKS: 180, COUNTDOWN_HOLD_TICKS: 12, ENDING_TICKS: 150, OVER_HOLD_TICKS: 120, DEATH_ANIM_TICKS: 60,
    SD_INTERVAL: 8, SD_WARN_TICKS: 48, MAX_ROUND_TICKS: 36000, SHOWDOWN_TICKS: 900, INTERP_TICKS: 6,
    INPUT_QUEUE_MAX: 40, INPUT_CATCHUP_AT: 2, CATCHUP_CREDIT_MAX: 12, IN_MAX_CMDS: 16, IN_FLOOD_RATE: 120,
    IN_FLOOD_BURST: 60, MAX_NAME: 14, MAX_CHAT: 120,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(C[name], value, name);
});

test('every shared table of SPEC section 3 is exported', () => {
  for (const name of [
    'SPAWN_SLOTS', 'PLAYER_COLORS', 'TEAM_COLORS', 'EMOTES', 'THEMES', 'ITEM_KINDS', 'CURSE_KINDS', 'BOT_LEVELS', 'BOT_NAMES',
    'ITEM_WEIGHTS', 'DROP_CHANCE', 'BLOCK_DENSITY', 'STATE', 'PHASES', 'SETTINGS_DEFS', 'TIMEOUTS', 'DIR', 'DIR_DX', 'DIR_DY',
  ]) assert.ok(C[name] !== undefined, name);
});

test('table contents follow the spec', () => {
  assert.deepEqual(C.SPAWN_SLOTS, [[1, 1], [13, 11], [13, 1], [1, 11], [7, 1], [7, 11], [1, 6], [13, 6]]);
  assert.deepEqual(C.PLAYER_COLORS.map((c) => c.name), ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan']);
  assert.deepEqual(C.PLAYER_COLORS.map((c) => c.accessory), ['antenna', 'propeller', 'sprout', 'crown', 'horns', 'flame', 'bow', 'headphones']);
  assert.equal(C.PLAYER_COLORS[0].hex, '#ff4d5e');
  assert.deepEqual(C.TEAM_COLORS, ['#ff6b5e', '#22c3b0']);
  assert.equal(C.EMOTES.length, 8);
  assert.deepEqual(C.THEMES, ['meadow', 'frost', 'lava', 'candy', 'night']);
  assert.deepEqual(C.ITEM_KINDS, ['bomb', 'flame', 'speed', 'kick', 'glove', 'shield', 'skull']);
  assert.deepEqual(C.CURSE_KINDS, ['slow', 'rush', 'reverse', 'nobomb', 'spam']);
  assert.deepEqual(C.BOT_LEVELS, ['easy', 'normal', 'hard']);
  assert.deepEqual(C.BOT_NAMES, ['Bolt', 'Fuse', 'Pixel', 'Zap', 'Boomer', 'Spark', 'Nova', 'Kaboom']);
  assert.deepEqual(C.ITEM_WEIGHTS, { bomb: 22, flame: 22, speed: 14, kick: 8, glove: 7, shield: 6, skull: 8 });
  assert.deepEqual(C.DROP_CHANCE, { none: 0, few: 0.22, normal: 0.42, many: 0.65 });
  assert.deepEqual(C.BLOCK_DENSITY, { few: 0.5, normal: 0.72, many: 0.9 });
  assert.deepEqual(C.STATE, { COUNTDOWN: 0, PLAYING: 1, ENDING: 2, OVER: 3 });
  assert.deepEqual(C.PHASES, ['lobby', 'match', 'results']);
  assert.deepEqual(C.TIMEOUTS, {
    GRACE_LOBBY_MS: 120000, GRACE_MATCH_MS: 30000, HOST_MIGRATE_MS: 60000, EMPTY_CLOSE_MS: 30000, RESULTS_AUTO_MS: 30000,
    HELLO_MS: 10000, PING_MS: 15000, DEAD_MS: 35000, IDLE_LOBBY_MS: 1800000, IDLE_MATCH_MS: 300000, ROOM_MAX_MS: 21600000,
  });
  assert.deepEqual(C.DIR_DX, [0, 0, 1, 0, -1]);
  assert.deepEqual(C.DIR_DY, [0, -1, 0, 1, 0]);
});

test('SETTINGS_DEFS lists exactly the nine host settings with their defaults', () => {
  assert.deepEqual(Object.keys(C.SETTINGS_DEFS), ['rounds', 'roundTime', 'suddenDeath', 'mode', 'theme', 'layout', 'blocks', 'items', 'locked']);
  assert.deepEqual(C.SETTINGS_DEFS.rounds, { values: [1, 2, 3, 5, 7], def: 3 });
  assert.deepEqual(C.SETTINGS_DEFS.roundTime, { values: [0, 60, 90, 120, 180, 240], def: 120 });
  assert.deepEqual(C.SETTINGS_DEFS.theme.values, ['random', ...C.THEMES]);
  for (const [key, def] of Object.entries(C.SETTINGS_DEFS)) {
    assert.ok(def.values.includes(def.def), `${key} default is one of its values`);
  }
});

test('tables are internally consistent', () => {
  assert.equal(new Set(C.SPAWN_SLOTS.map(([x, y]) => `${x},${y}`)).size, 8, 'distinct slots');
  assert.equal(C.SPAWN_SLOTS.length, C.MAX_PLAYERS);
  assert.equal(C.PLAYER_COLORS.length, C.MAX_PLAYERS);
  assert.deepEqual(Object.keys(C.ITEM_WEIGHTS), C.ITEM_KINDS, 'weights cumulate in ITEM_KINDS order');
  for (const [tx, ty] of C.SPAWN_SLOTS) assert.ok(tx > 0 && ty > 0 && tx < C.GRID_W - 1 && ty < C.GRID_H - 1);
  assert.ok(C.SHIELD_FOREVER > C.SHIELD_TICKS && Number.isFinite(C.SHIELD_FOREVER));
  assert.ok(C.BASE_SPEED + C.SPEED_STEP * C.MAX_SPEED_LV < 7, 'top speed below the rush curse');
  assert.ok(C.CURSE_RUSH_SPEED / C.TICK_RATE < 0.34 * 2, 'a tick never moves further than a hitbox');
});

test('everything exported is deeply frozen', () => {
  const unfrozen = [];
  const walk = (path, value) => {
    if (value === null || typeof value !== 'object') return;
    if (!Object.isFrozen(value)) unfrozen.push(path);
    for (const key of Object.keys(value)) walk(`${path}.${key}`, value[key]);
  };
  for (const [name, value] of Object.entries(C)) walk(name, value);
  assert.deepEqual(unfrozen, []);
});

test('mutating a table is rejected', () => {
  assert.throws(() => { C.SPAWN_SLOTS[0][0] = 5; }, TypeError);
  assert.throws(() => { C.SETTINGS_DEFS.rounds.values.push(9); }, TypeError);
  assert.throws(() => { C.TIMEOUTS.PING_MS = 1; }, TypeError);
});
