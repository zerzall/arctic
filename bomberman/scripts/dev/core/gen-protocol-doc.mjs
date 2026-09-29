// Developer tooling (not a spec): writes docs/PROTOCOL.md from the real code.
//
//   node scripts/dev/core/gen-protocol-doc.mjs           # rewrite docs/PROTOCOL.md
//   node scripts/dev/core/gen-protocol-doc.mjs --check   # exit 1 if the file on disk is stale
//
// Every table of indexes, enums, limits and events is read from shared/*.js, every client message example is run
// through parseClientMessage (and the generator throws if one is rejected), and the snapshot / event examples are
// produced by a real World. Only the prose (flows, message field lists of the Room, which does not live in the
// shared modules the generator can call) is written here, and it is a transcription of docs/SPEC.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../../../shared/constants.js';
import * as PR from '../../../shared/protocol.js';
import { World } from '../../../shared/world.js';
import { makeRng } from '../../../shared/rng.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = `${ROOT}docs/PROTOCOL.md`;
const fixture = (name) => JSON.parse(readFileSync(`${ROOT}specs/fixtures/${name}.example.json`, 'utf8'));

// ---- Markdown helpers ------------------------------------------------------------------------------

const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
].join('\n');
const json = (value, indent) => '```json\n' + JSON.stringify(value, null, indent) + '\n```';
const line = (value) => '```json\n' + JSON.stringify(value) + '\n```';
const code = (v) => '`' + v + '`';

// ---- Verified client message examples ----------------------------------------------------------------

/** Each example must be accepted by the real parser; the parsed form is what the Room receives. */
const CLIENT_EXAMPLES = [
  ['create', { t: 'create', v: 1, name: 'Mom', color: 0 }],
  ['join', { t: 'join', v: 1, code: 'KQXZ', name: 'Dad', color: 2, token: '0123456789abcdef0123456789abcdef' }],
  ['profile', { t: 'profile', id: 1, name: 'Boomer', color: 4, team: 1 }],
  ['settings', { t: 'settings', patch: { rounds: 5, mode: 'teams', locked: true } }],
  ['addBot', { t: 'addBot', level: 'hard' }],
  ['removeBot', { t: 'removeBot', id: 1 }],
  ['kick', { t: 'kick', id: 3 }],
  ['start', { t: 'start' }],
  ['lobby', { t: 'lobby' }],
  ['in', { t: 'in', c: [[181, 2, 0, 0], [182, 2, 1, 0], [183, 0, 0, 1]] }],
  ['chat', { t: 'chat', text: 'Ready?' }],
  ['emote', { t: 'emote', e: 4 }],
  ['ping', { t: 'ping', ts: 1234567.5 }],
  ['sync', { t: 'sync' }],
  ['leave', { t: 'leave' }],
];

/** Malformed frames and the code the parser answers with. */
const REJECTED_EXAMPLES = [
  ['not JSON', 'nope', 'bad_msg'],
  ['unknown type', '{"t":"teleport"}', 'bad_msg'],
  ['wrong protocol version', '{"t":"create","v":2,"name":"Mom"}', 'version'],
  ['`in` with a non-binary button', '{"t":"in","c":[[1,0,2,0]]}', 'bad_msg'],
  ['`in` with more than 16 cmds', JSON.stringify({ t: 'in', c: Array.from({ length: 17 }, (_, i) => [i, 0, 0, 0]) }), 'bad_msg'],
  ['prototype pollution key at any depth', '{"t":"settings","patch":{"__proto__":{"rounds":9}}}', 'bad_msg'],
  ['emote out of range', '{"t":"emote","e":8}', 'bad_msg'],
];

for (const [, msg] of CLIENT_EXAMPLES) {
  const r = PR.parseClientMessage(JSON.stringify(msg));
  if (!r.ok) throw new Error(`the parser rejects its own documented example ${JSON.stringify(msg)}: ${r.code}`);
}
for (const [label, raw, want] of REJECTED_EXAMPLES) {
  const r = PR.parseClientMessage(raw);
  if (r.ok || r.code !== want) throw new Error(`documented rejection "${label}" behaves differently: ${JSON.stringify(r)}`);
}

// ---- Real examples from a running World -----------------------------------------------------------------

const fighter = (id, name, over = {}) => ({ id, name, color: id, team: id % 2, isBot: false, lastSeq: 0, ...over });

/** Plays random rounds until every event code has occurred; returns the first occurrence of each. */
function collectEventExamples() {
  const found = new Map();
  const rng = makeRng(2024);
  for (let seed = 1; seed <= 60 && found.size < Object.keys(PR.EVENT_ARGS).length; seed++) {
    const n = 2 + (seed % 7);
    const w = new World({
      seed, fighters: Array.from({ length: n }, (_, i) => fighter(i, `P${i}`, { isBot: i % 2 === 1 })), roundTime: 60, blocks: 'many', items: 'many',
    });
    for (const p of w.players) { p.kick = true; p.glove = true; p.bombsMax = 3; p.range = 4; }
    const dirs = new Array(n).fill(0);
    let cursor = 0;
    for (let t = 0; t < 5200 && w.state !== C.STATE.OVER; t++) {
      for (const p of w.players) {
        if (seed % 2 === 0 && t % 300 === 0) p.shield = C.SHIELD_FOREVER;
        if (t % (6 + p.id) === 0) dirs[p.id] = rng.int(5);
        w.applyCmd(p.id, { s: t + 1, d: dirs[p.id], b: rng.int(40) === 0 ? 1 : 0, x: rng.int(20) === 0 ? 1 : 0 });
      }
      if (t === 2500 && n > 2) w.removeFighter(1);
      w.tick();
      for (const ev of w.eventsSince(cursor)) if (!found.has(ev[0])) found.set(ev[0], ev);
      cursor = w.evCount;
      w.trimEvents(cursor);
    }
  }
  for (const code of Object.keys(PR.EVENT_ARGS)) if (!found.has(code)) throw new Error(`no example of the ${code} event turned up`);
  return found;
}

/** A small deterministic scene: one bomb placed, then exploding next to a soft block. */
function snapshotExamples() {
  const w = new World({
    seed: 7, fighters: [fighter(0, 'Mom'), fighter(1, 'Boomer', { isBot: true }), fighter(2, 'Dad')], roundTime: 120, blocks: 'normal', items: 'normal',
  });
  while (w.state === C.STATE.COUNTDOWN) w.tick();
  w.applyCmd(0, { s: 1, d: 2, b: 1, x: 0 });
  let cursor = 0;
  w.tick();
  const placed = w.snapshot({ grid: false, evFrom: cursor });
  cursor = w.evCount;
  for (let i = 0; i < 149; i++) w.tick();
  const exploded = w.snapshot({ grid: true, evFrom: cursor });
  return { placed, exploded };
}

// ---- Prose ----------------------------------------------------------------------------------------------

const EVENT_DOC = {
  go: 'Countdown finished; state becomes `playing` and spawn shields start.',
  bomb: 'A bomb was placed (manually or by the `spam` curse).',
  boom: 'A bomb exploded. `tiles` = every flame tile of THIS bomb including its centre; one event per bomb of a chain, in explosion order.',
  block: 'A soft block was destroyed (one per block; `boom` does not list blocks).',
  itemspawn: 'The drop under a destroyed block was revealed (same tick as its `block`).',
  pickup: '`kind` is an item kind; a `skull` additionally emits `curse`.',
  itemgone: 'An item was destroyed by an explosion or a sudden-death tile.',
  bombgone: 'A bomb was removed WITHOUT exploding (a sudden-death tile landed on it).',
  death: '`killerId` >= 0 is the flame owner (equal to `playerId` for an own goal); -1 = sudden death or an orphaned bomb.',
  left: 'A fighter was removed (leave, kick, grace expiry). No `death` event is emitted for it.',
  shieldhit: 'A flame was absorbed by a shield or spawn shield (at most one per fighter per 12 ticks).',
  kick: 'A bomb started sliding; `dir` is 1..4.',
  throw: 'A glove throw; `toTx`/`toTy` is the already-resolved landing tile.',
  land: 'A thrown bomb landed (possibly not where `throw` promised, if that tile became invalid).',
  curse: '`kind` is a curse kind, or 0 when cured (expiry, death, lock). `fromId` is the giver of a touch transfer, -1 for pickup, expiry or clearing.',
  sdstart: 'Sudden death began.',
  sdland: 'A falling tile landed; the cell is now `X`.',
  showdown: 'The last human died with a fight left: the round clock was cut to 15 s.',
};
for (const code of Object.keys(PR.EVENT_ARGS)) if (!EVENT_DOC[code]) throw new Error(`document the ${code} event`);
for (const code of Object.keys(EVENT_DOC)) if (!PR.EVENT_ARGS[code]) throw new Error(`${code} is documented but not an event`);

const CLIENT_DOC = {
  create: ['Adapter (never reaches `Room.receive`). Creates a room and joins it.', '`v` must equal the wire version, else `version`. `name` is sanitised (see below). `color` optional, integer 0..7.'],
  join: ['Adapter. Joins a room, or re-attaches to an entry when `token` matches.', '`code` is upper-cased (ASCII) and at most 16 characters here; the room lookup enforces the 4-letter alphabet. `token`: 1..64 printable ASCII characters. `v` as for `create`.'],
  profile: ['Edit own profile; the host may pass `id` to edit a bot.', 'All fields optional. `id` non-negative integer, `color` 0..7, `team` 0|1, `name` sanitised. Honoured only in phases lobby/results (name always).'],
  settings: ['Host: change room settings.', '`patch` must be an object; only keys of the settings table with allowed values survive (per key), the rest is silently dropped.'],
  addBot: ['Host: add a bot.', '`level` is one of the bot levels.'],
  removeBot: ['Host: remove a bot.', '`id` non-negative integer.'],
  kick: ['Host: remove a player and ban their token.', '`id` non-negative integer.'],
  start: ['Host: start a match.', 'No fields.'],
  lobby: ['Host: back to the lobby (aborts a running match).', 'No fields.'],
  in: ['One or more input commands.', '`c`: 1..16 rows, each exactly `[seq, dir, bomb, special]` of integers: `seq` 0..2147483647, `dir` 0..4, `bomb` and `special` 0|1. Anything else invalidates the whole frame.'],
  chat: ['Chat line.', '`text` string; sanitised to at most 120 graphemes. An empty result is dropped by the Room.'],
  emote: ['Emote bubble.', '`e` integer 0..7 (index into the emote table).'],
  ping: ['Latency probe; answered with `pong` carrying the same `ts`.', '`ts` finite number.'],
  sync: ['Ask for a full snapshot (with `g`) after noticing a missed grid change.', 'No fields. At most 1/s.'],
  leave: ['Leave the room at once.', 'No fields.'],
};
for (const [t] of CLIENT_EXAMPLES) if (!CLIENT_DOC[t]) throw new Error(`document ${t}`);
for (const t of Object.values(PR.CLIENT_MSG)) if (!CLIENT_EXAMPLES.some(([x]) => x === t)) throw new Error(`no example for client message ${t}`);

const ERROR_DOC = {
  bad_msg: 'Malformed frame (too long, not JSON, wrong shape).',
  version: 'The client speaks another wire version; the page should reload once.',
  no_room: 'No room with that code (or the server restarted).',
  full: 'The room holds 8 entries and no bot could be evicted (or a match is running).',
  locked: 'The host locked the room and the join had no matching token.',
  busy: 'Server limit reached (rooms, connections, per-IP caps).',
  not_host: 'Host-only message from a non-host.',
  bad_phase: 'Not allowed in the current phase.',
  need_players: '`start` with fewer than 2 entries.',
  need_teams: '`start` in team mode without a fighter in each team.',
  rate_limited: 'Too many messages of that type, too many rooms, or too many failed joins.',
  kicked: 'A banned token tried to rejoin.',
  closed: 'The room or the server is closing.',
};
for (const c of Object.values(PR.ERR)) if (!ERROR_DOC[c]) throw new Error(`document error ${c}`);

// ---- Assemble ---------------------------------------------------------------------------------------------

function render() {
  const eventExamples = collectEventExamples();
  const { placed, exploded } = snapshotExamples();
  const out = [];
  const add = (...parts) => out.push(parts.join('\n\n'), '');

  add(
    '# Blast Party wire protocol',
    '> Generated by `scripts/dev/core/gen-protocol-doc.mjs` from `shared/constants.js`, `shared/protocol.js` and `shared/world.js`. **Do not edit by hand.**',
    '> This is a convenience extract of `docs/SPEC.md` (sections 4.4, 4.5 and Appendix A). It never overrides the spec; if the two disagree, the spec wins and this file is stale.',
  );

  add(
    '## Transport',
    `JSON text frames over one WebSocket at \`/ws\`. Protocol version ${code(C.WIRE_VERSION)} (${code('WIRE_VERSION')}). Client frames are at most ${code(PR.MAX_RAW_LEN)} UTF-16 units.`,
    `The simulation runs at ${C.TICK_RATE} Hz; snapshots are sent every ${C.SNAP_EVERY} ticks (${C.TICK_RATE / C.SNAP_EVERY} Hz). Positions are in tile units (\`0..${C.GRID_W}\` x \`0..${C.GRID_H}\`), tile \`(tx,ty)\` spans \`[tx,tx+1) x [ty,ty+1)\`, row-major index \`ty*${C.GRID_W}+tx\`.`,
    'Direction codes: `0` none, `1` up, `2` right, `3` down, `4` left. Facing = direction code - 1 (`0` up, `1` right, `2` down, `3` left).',
  );

  // ---- client -> server
  add('## Client to server');
  add(table(['type', 'purpose', 'fields and validation'], CLIENT_EXAMPLES.map(([t]) => [code(t), CLIENT_DOC[t][0], CLIENT_DOC[t][1]])));
  add(
    '`protocol.parseClientMessage(raw)` accepts a JSON string or a plain object and never throws. It returns `{ ok: true, msg }` (a freshly built object holding only the known fields) or `{ ok: false, code }` with `code` `bad_msg` or `version`.',
    'Keys `__proto__`, `constructor` and `prototype` are rejected at any depth. Unknown message types are `bad_msg`. `in.c` keeps the wire shape; the Room turns each row into a cmd `{ s, d, b, x }`.',
  );
  add('### Examples (each one is accepted by the real parser)');
  for (const [t, msg] of CLIENT_EXAMPLES) add(`**${t}**`, line(msg));
  add('### Rejected frames', table(['case', 'raw', 'answer'], REJECTED_EXAMPLES.map(([label, raw, want]) => [label, code(raw.length > 60 ? `${raw.slice(0, 57)}...` : raw), code(want)])));

  add('### Names and chat text', `Names and chat go through \`protocol.sanitizeText(raw, max, fallback)\`: NFC; control, private-use and lone-surrogate characters become spaces; zero-width, bidi and tag characters are removed (ZWJ is kept so family emoji survive); invisible filler letters become spaces; at most two combining marks in a row; whitespace collapsed and trimmed; truncated to \`max\` graphemes (${code(`MAX_NAME = ${C.MAX_NAME}`)}, ${code(`MAX_CHAT = ${C.MAX_CHAT}`)}). Duplicate names get a \` 2\`, \` 3\` suffix after truncation, so a final name can be up to 2 characters longer.`);

  add('### Per-type limits (enforced by `Room.receive`)', table(['type', 'limit'], [
    ['`in`', `flood guard only: token bucket ${C.IN_FLOOD_RATE} cmds/s, burst ${C.IN_FLOOD_BURST}; a frame costs its cmd count and is dropped whole when short`],
    ['`chat`', '5 per 5 s (excess: error `rate_limited`); an identical text within 10 s of the sender\'s previous one is dropped silently'],
    ['`emote`', '1 per 700 ms (error `rate_limited`)'],
    ['`profile`', '4 per 2 s'], ['`ping`', '4 per s'], ['`sync`', '1 per s'], ['every other type', '30 per s'],
  ]));

  // ---- server -> client
  const lobbyExample = fixture('lobby');
  const roundExample = fixture('round');
  add(
    '## Server to client',
    table(['type', 'fields'], [
      ['`joined`', '`{ t, v, id, token, code, seq, build }`. `seq` is the entry\'s last accepted cmd seq (0 for a new entry): the client continues counting from it. `build` is the server package version.'],
      ['`lobby`', '`{ t, code, phase, hostId, you, local?, settings, players: [entry], round: { n, winsNeeded } }`. `you` is the recipient\'s own id; `local: true` only in Practice; `round.n` is 0 in phase lobby, else the last built round number.'],
      ['`round`', '`{ t, n, seed, theme, mode, w, h, grid, players: [{ id, name, color, team, slot, isBot, x, y }], winsNeeded, roundTime, suddenDeath, serverTick }`. `grid` is the grid AT SEND TIME (live for late joiners); `players` are in fighter order, the SAME order as `p` in snapshots; `seed` is cosmetic; `theme` is concrete.'],
      ['`snap`', 'See "Snapshot" below.'],
      ['`roundEnd`', '`{ t, n, winnerId, winnerTeam, draw, reason: "last"|"wipe"|"timeout", scores: [{ id, wins, team }], matchOver }`, sent at the outcome lock; `winnerId` / `winnerTeam` are `null` when not applicable.'],
      ['`matchEnd`', '`{ t, winnerId, winnerTeam, reason: "wins"|"cap"|"not_enough_players", standings: [{ id, name, color, team, wins, kills, deaths, selfKills, blocks, items, place }] }`, sorted by wins desc, kills desc, deaths asc; joint winners share `place`.'],
      ['`chat`', '`{ t, from, name, text, old? }` (`old: true` on the replay for late joiners)'],
      ['`emote`', '`{ t, from, e }`'], ['`sys`', '`{ t, text }`'], ['`pong`', '`{ t, ts }`'], ['`kicked`', '`{ t }` (the only form of a kick notification)'],
      ['`error`', '`{ t, code, msg }`'],
    ]),
  );
  add(
    '`lobby.players[]` entry: `{ id, name, color (0-7), team (0|1), isBot, level ("easy"|"normal"|"hard"|null), connected, isHost, wins, waiting }`.',
    '### Examples (golden fixtures)', '**lobby**', json(lobbyExample, 1), '**round**', json(roundExample, 1),
  );
  add('### Errors', table(['code', 'meaning'], Object.values(PR.ERR).map((c) => [code(c), ERROR_DOC[c]])), `Errors that end a join attempt (${PR.FATAL_JOIN_ERRORS.map(code).join(', ')}) are followed by the server closing the socket.`);

  // ---- snapshot
  add(
    '## Snapshot (`t: "snap"`)',
    'Repeated entities are arrays, not objects. The index maps `P`, `PF` and `B` exported by `shared/protocol.js` are the only way the World builds them and the client reads them.',
    table(['field', 'meaning'], [
      ['`k`', 'world tick number (resets to 0 each round)'], ['`st`', `state: ${Object.entries(C.STATE).map(([n, v]) => `${v} ${n.toLowerCase()}`).join(', ')}`],
      ['`cd`', 'countdown ticks left (0 unless `st` is 0)'], ['`r`', 'round ticks left (-1 unlimited, 0 time up)'], ['`sd`', '1 while sudden death is active'],
      ['`gv`', 'grid version, incremented whenever any cell changes'], ['`ack`', '`{ "<humanFighterId>": lastSeq }`, string keys; bots and spectators absent'],
      ['`p`', 'players, one per fighter in `round.players` order, dead and removed included'], ['`b`', 'bombs'], ['`f`', 'flames `[[tx, ty, mask, ticksLeft], ...]`'],
      ['`i`', 'items `[[id, tx, ty, kind, age], ...]`, `age = k - born`'], ['`fall`', 'falling sudden-death tiles `[[tx, ty, ticksLeft], ...]`'],
      ['`g`', `${C.GRID_W * C.GRID_H}-character grid string (\`.\` floor, \`#\` hard wall, \`+\` soft block, \`X\` sudden-death wall), present when the grid changed, once per second, and in unicast snapshots`],
      ['`e`', 'events since the Room\'s cursor (at most 128); `[]` in unicast snapshots'],
    ]),
  );
  const playerNames = { ID: 'id', X: 'x (centre, tile units, 3 decimals)', Y: 'y', F: 'facing 0..3', FL: 'flags (below)', SH: 'item shield ticks (`SHIELD_FOREVER` = 65535 after the outcome lock)', SS: 'spawn shield ticks', CU: 'curse kind string, or 0', CT: 'curse ticks left', BM: 'bombsMax', RG: 'range', SP: 'speed level', DT: 'ticks since death (0 while alive, saturates at 255)' };
  const bombNames = { I: 'bomb id', O: 'owner id (-1 orphaned)', X: 'visual centre x (a sliding bomb glides; a flying bomb: the point on the line from to)', Y: 'visual centre y', TX: 'tile the bomb OCCUPIES (sliding: the tile it heads into; flying: the landing tile)', TY: 'occupied tile y', FU: 'fuse ticks left', RG: 'range', D: 'direction 0..4', FL: '0, or `[fromX, fromY, toX, toY, ticksLeft, total]` (tile-centre coordinates)', PS: 'ids of fighters that may walk through it (`[]` when empty)' };
  add(
    '### Player row `p[n]`',
    table(['index', 'name', 'meaning'], Object.entries(PR.P).map(([n, i]) => [i, code(`P.${n}`), playerNames[n]])),
    '**Flags** `p[n][P.FL]`: ' + Object.entries(PR.PF).map(([n, v]) => `${code(v)} ${n.toLowerCase()}`).join(', ') + '.',
    '### Bomb row `b[n]`',
    table(['index', 'name', 'meaning'], Object.entries(PR.B).filter(([n]) => n !== 'ID').map(([n, i]) => [i, code(`B.${n}`), bombNames[n]])),
    '`B.ID` is an alias of `B.I`. Collision, flames and the client predictor use `tx, ty` only; `x, y` are for drawing.',
    '### Flame masks',
    'Bits `1` up, `2` right, `4` down, `8` left: which neighbours the flame tile connects to. An arm interior has both bits of its axis (an up arm interior is `1|4 = 5`), an arm tip only the bit towards the centre (an up arm tip is `4`), the centre the OR of its arms.',
    '### Grid transport',
    '`gv` changes whenever any cell changes. The server includes `g` when `gv` differs from the last broadcast one or when `k % 60 == 0`; a joiner, a reconnecter or a client that sent `sync` gets a unicast snapshot with `g`. A client that sees a `gv` it has no grid for sends `sync` (at most once a second).',
    `Budget (asserted in the tests with 4 humans + 4 bots): mean snapshot at most 1.2 KB, p99 at most 4 KB.`,
  );
  add('### Example: the tick after a bomb was placed', line(placed), '### Example: the explosion tick, with the grid', line(exploded));

  // ---- events
  add(
    '## Events',
    'An event is `[code, ...args]`. Ids are integers, `tx`/`ty` integers, `x`/`y` floats rounded to 1/1000 (centre coordinates). The order inside `e` is the order of occurrence (the tick order of SPEC 3.2a). This list is closed.',
    table(['code', 'arguments', 'meaning', 'example (from a real round)'], Object.entries(PR.EVENT_ARGS).map(([c, args]) => {
      const ex = JSON.stringify(eventExamples.get(c));
      return [code(c), args.length ? args.map(code).join(', ') : '(none)', EVENT_DOC[c], code(ex.length > 90 ? `${ex.slice(0, 87)}...` : ex)];
    })),
  );

  // ---- enums
  add(
    '## Enumerations and tables',
    table(['name', 'values'], [
      ['item kinds', C.ITEM_KINDS.map(code).join(' ')], ['curse kinds', C.CURSE_KINDS.map(code).join(' ')], ['themes', C.THEMES.map(code).join(' ')],
      ['bot levels', C.BOT_LEVELS.map(code).join(' ')], ['phases', C.PHASES.map(code).join(' ')], ['round reasons', '`last` `wipe` `timeout`'],
      ['match reasons', '`wins` `cap` `not_enough_players`'], ['player colors', C.PLAYER_COLORS.map((c, i) => `${i} ${c.name} (${c.accessory})`).join(', ')],
      ['emotes', C.EMOTES.map((e, i) => `${i} ${e}`).join(' ')],
    ]),
    '### Settings (`lobby.settings`, `settings.patch`)',
    table(['key', 'allowed values', 'default'], Object.entries(C.SETTINGS_DEFS).map(([k, d]) => [code(k), d.values.map((v) => code(JSON.stringify(v))).join(' '), code(JSON.stringify(d.def))])),
    '### Timing constants',
    table(['constant', 'value', 'meaning'], [
      ['`COUNTDOWN_TICKS`', C.COUNTDOWN_TICKS, 'countdown before play (3 s)'], ['`FUSE_TICKS`', C.FUSE_TICKS, 'bomb fuse (2.5 s)'], ['`FLAME_TICKS`', C.FLAME_TICKS, 'a flame tile is lethal for exactly this many kill checks'],
      ['`THROW_TICKS`', C.THROW_TICKS, 'glove flight time'], ['`KICK_STEP_TICKS`', C.KICK_STEP_TICKS, 'a kicked bomb advances one tile per this many ticks'],
      ['`SHIELD_TICKS` / `SPAWN_SHIELD_TICKS`', `${C.SHIELD_TICKS} / ${C.SPAWN_SHIELD_TICKS}`, 'item shield / shield after GO'], ['`CURSE_TICKS`', C.CURSE_TICKS, 'curse duration'],
      ['`SD_INTERVAL` / `SD_WARN_TICKS`', `${C.SD_INTERVAL} / ${C.SD_WARN_TICKS}`, 'sudden death: ticks between falling tiles / telegraph time'], ['`ENDING_TICKS`', C.ENDING_TICKS, 'from the outcome lock to `over`'],
      ['`OVER_HOLD_TICKS`', C.OVER_HOLD_TICKS, 'Room steps between `over` and the next round / matchEnd'], ['`SHOWDOWN_TICKS`', C.SHOWDOWN_TICKS, 'shortened clock after the last human died'],
      ['`MAX_ROUND_TICKS`', C.MAX_ROUND_TICKS, 'hard cap of `playing` when the round time is unlimited'],
    ]),
  );

  // ---- flows
  add(
    '## Message flows',
    'Within one Room step the message order is always `snap`, `roundEnd`, `lobby`, then `round` or `matchEnd`.',
    table(['flow', 'sequence'], [
      ['create', 'client `create`; the adapter creates the room; the Room answers `joined`, `lobby`. Errors `version`, `bad_msg`, `busy`, `rate_limited` then the socket closes.'],
      ['join (lobby or results)', 'client `join`; `joined { seq: 0 }`, `lobby`, chat replay (up to 50, `old: true`), in phase results the last `matchEnd`; the others get `lobby` and `sys` "NAME joined".'],
      ['join mid-match', 'as above with `waiting: true`, then `round` (live grid, `serverTick` = current tick) and a full `snap`. The entry becomes a fighter when the next round is built.'],
      ['reconnect', 'client `join { code, token, name }`; the old connection is closed with code 4001 `replaced`; `joined { seq: entry.lastSeq }`, `lobby`, and in a match `round` (live), full `snap`, and the stored `roundEnd` if the outcome is locked; in results the stored `matchEnd`.'],
      ['socket drop', 'the entry keeps its slot for the grace period (120 s in lobby/results, 30 s in a match), then it is removed.'],
      ['leave / kick', '`leave` removes the entry at once; a kick sends `kicked`, closes the connection and bans the token. Others get `lobby` and `sys`.'],
      ['start', 'host `start`; errors in this order: `not_host`, `bad_phase`, `need_players`, `need_teams`. Then `lobby`, `round`, full `snap` to everyone.'],
      ['round end', 'outcome lock: `snap` (flush), `roundEnd { matchOver }`, `lobby` (wins). After the World reaches `over` and the hold passed: `matchEnd` and phase results, or the next `round` plus full `snap`.'],
      ['back to lobby', 'host `lobby` in phase results (or automatically after 30 s), or during a match to abort it (`sys` "Host ended the match").'],
      ['sync', 'client `sync` (at most 1/s); the Room answers with a unicast full snapshot during a match, otherwise ignores it.'],
    ]),
    'Sequence numbers: `seq` is per entry, strictly increasing over the whole life of the entry and never reset at a round or on reconnect. `snap.ack[id]` is the highest seq the World has passed to `applyCmd` (also for cmds it ignored), so the client can drop acknowledged cmds from its replay buffer.',
  );

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const text = render();
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== text) {
    console.error('docs/PROTOCOL.md is stale: run node scripts/dev/core/gen-protocol-doc.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT} (${text.length} bytes)`);
}
