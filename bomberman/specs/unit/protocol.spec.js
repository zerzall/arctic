import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClientMessage, sanitizeText, P, PF, B, WIRE_VERSION, MAX_RAW_LEN, CLIENT_MSG, SERVER_MSG, ERR, EVENT_ARGS,
  decodePlayer, decodeBomb,
} from '../../shared/protocol.js';
import { makeRng } from '../../shared/rng.js';
import { MAX_NAME, MAX_CHAT, SETTINGS_DEFS, IN_MAX_CMDS } from '../../shared/constants.js';

const j = JSON.stringify;
const label = (raw) => (typeof raw === 'string' ? raw.slice(0, 120) : `<${typeof raw}>`);   // JSON.stringify would throw on cycles and BigInt
const ok = (raw) => {
  const r = parseClientMessage(raw);
  assert.equal(r.ok, true, label(raw) + ' -> ' + j(r));
  return r.msg;
};
const bad = (raw, code = 'bad_msg') => {
  const r = parseClientMessage(raw);
  assert.deepEqual(r, { ok: false, code }, label(raw));
};

// ---- sanitizeText ------------------------------------------------------------------------------

test('sanitizeText: plain text, trimming and whitespace collapsing', () => {
  assert.equal(sanitizeText('Mom', 14, 'x'), 'Mom');
  assert.equal(sanitizeText('  a   b \t c  ', 14), 'a b c');
  assert.equal(sanitizeText('', 14, 'fallback'), 'fallback');
  assert.equal(sanitizeText('   ', 14, 'fallback'), 'fallback');
  assert.equal(sanitizeText('', 120), '');
});

test('sanitizeText: non-strings return the fallback', () => {
  for (const v of [undefined, null, 5, {}, [], true, () => 1, Symbol('x')]) assert.equal(sanitizeText(v, 14, 'F'), 'F');
});

test('sanitizeText: control characters become spaces', () => {
  assert.equal(sanitizeText('a\u0000b\u0007c\u001bd\u007fe\nf', 14), 'a b c d e f');
});

test('sanitizeText: RLO/bidi attack is stripped', () => {
  const s = sanitizeText('\u202Egnp.exe\u202C \u2066x\u2069', 14, 'F');
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(s));
  assert.equal(s, 'gnp.exe x');
});

test('sanitizeText: all zero-width space falls back', () => {
  assert.equal(sanitizeText('\u200B'.repeat(20), 14, 'Player 3'), 'Player 3');
  assert.equal(sanitizeText('\u200B\u200C\uFEFF\u2060', 14, 'F'), 'F');
});

test('sanitizeText: invisible filler letters (U+3164 & friends) fall back', () => {
  assert.equal(sanitizeText('\u3164'.repeat(14), 14, 'F'), 'F');
  for (const ch of ['\u115F', '\u1160', '\u17B4', '\u17B5', '\u180E', '\u2800', '\uFFA0']) {
    const out = sanitizeText('a' + ch + 'b', 14);
    assert.ok(out === 'a b' || out === 'ab', `U+${ch.charCodeAt(0).toString(16)} is gone (${JSON.stringify(out)})`);   // U+180E is Cf: removed, the others become spaces
    assert.equal(sanitizeText(ch, 14, 'F'), 'F');
  }
});

test('sanitizeText: lone surrogates and private use become spaces', () => {
  assert.equal(sanitizeText('a\uD800b', 14), 'a b');
  assert.equal(sanitizeText('a\uDC00b', 14), 'a b');
  assert.equal(sanitizeText('\uD83D', 14, 'F'), 'F');
  assert.equal(sanitizeText('a\uE000b\u{F0000}c', 14), 'a b c');
});

test('sanitizeText: the family emoji (ZWJ sequence) survives whole, three in a row', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
  assert.equal(sanitizeText(family, 14), family);
  assert.equal(sanitizeText(family.repeat(3), 14), family.repeat(3));
  const truncated = sanitizeText(family.repeat(3), 2);
  assert.equal(truncated, family.repeat(2), 'never cut in the middle of an emoji sequence');
});

test('sanitizeText: stray and doubled ZWJ are cleaned up', () => {
  assert.equal(sanitizeText('\u200Dab\u200D', 14), 'ab');
  assert.equal(sanitizeText('a\u200D\u200D\u200Db', 14), 'a\u200Db');
  assert.equal(sanitizeText('\u200D\u200D', 14, 'F'), 'F');
});

test('sanitizeText: zalgo is limited to two combining marks per base', () => {
  const marks = '\u0300\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308\u0309'.repeat(3);   // 30 marks
  assert.equal(marks.length, 30);
  assert.equal(sanitizeText('x' + marks, 14), 'x\u0300\u0301');
  assert.equal(sanitizeText('Z' + marks + 'x' + marks, 14), 'Z\u0300\u0301x\u0300\u0301');
  const composed = sanitizeText('e' + marks, 14).normalize('NFD');       // NFC folds the first mark into the base, then two more are kept
  assert.equal(Array.from(composed).length, 4);
});

test('sanitizeText: flag sequences and keycaps count as one grapheme each', () => {
  const flags = '\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}\u{1F1EF}\u{1F1F5}';   // DE FR JP
  assert.equal(sanitizeText(flags, 14), flags);
  assert.equal(sanitizeText(flags, 2), '\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}');
  const keycaps = '1\uFE0F\u20E3' + '2\uFE0F\u20E3';
  assert.equal(sanitizeText(keycaps, 1), '1\uFE0F\u20E3');
});

test('sanitizeText: truncates by graphemes to max, then trims', () => {
  assert.equal(sanitizeText('abcdefghijklmnopqrstuvwxyz', 14), 'abcdefghijklmn');
  assert.equal(sanitizeText('abc def', 4), 'abc');
  assert.equal(Array.from(sanitizeText('x'.repeat(500), MAX_CHAT)).length, MAX_CHAT);
  assert.equal(sanitizeText('e\u0301'.repeat(30), 14), '\u00E9'.repeat(14));
});

test('sanitizeText: NFC normalisation', () => {
  assert.equal(sanitizeText('e\u0301', 14), '\u00E9');
});

test('sanitizeText: huge inputs are cheap (only max*12 units are examined)', () => {
  const t0 = performance.now();
  const s = sanitizeText('a'.repeat(5_000_000), MAX_NAME);
  assert.equal(s, 'a'.repeat(MAX_NAME));
  assert.ok(performance.now() - t0 < 50);
});

test('sanitizeText: output is always clean, trimmed and within the grapheme budget', () => {
  const rng = makeRng(4);
  const alphabet = ['a', ' ', '\u200D', '\u0301', '\u{1F600}', '\u202E', '\u3164', '\uD800', '\u00E9', '\n', '\u{1F468}', '\u200B', '\uE000', '\u0000'];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (let i = 0; i < 3000; i++) {
    let raw = '';
    for (let n = rng.int(40); n > 0; n--) raw += rng.pick(alphabet);
    const out = sanitizeText(raw, 14, '');
    assert.equal(out, out.trim(), JSON.stringify(raw));
    assert.ok(Array.from(segmenter.segment(out)).length <= 14, JSON.stringify(raw));
    assert.equal(/[\p{Cc}\p{Cs}\p{Co}\u3164\u2800]/u.test(out), false, JSON.stringify(raw));
    assert.equal(/\p{Cf}/u.test(out.replace(/\u200D/g, '')), false, JSON.stringify(raw));
    assert.equal(/\p{M}{3}/u.test(out), false);
    assert.equal(/\s{2}/u.test(out), false);
  }
});

// ---- Message parsing ---------------------------------------------------------------------------

test('constants: wire version and type names', () => {
  assert.equal(WIRE_VERSION, 1);
  assert.equal(MAX_RAW_LEN, 4096);
  assert.deepEqual(Object.values(CLIENT_MSG).sort(), ['addBot', 'chat', 'create', 'emote', 'in', 'join', 'kick', 'leave', 'lobby', 'ping', 'profile', 'removeBot', 'settings', 'start', 'sync']);
  assert.deepEqual(Object.values(SERVER_MSG).sort(), ['chat', 'emote', 'error', 'joined', 'kicked', 'lobby', 'matchEnd', 'pong', 'round', 'roundEnd', 'snap', 'sys']);
  assert.deepEqual(Object.values(ERR).sort(), [
    'bad_msg', 'bad_phase', 'busy', 'closed', 'full', 'kicked', 'locked', 'need_players', 'need_teams', 'no_room', 'not_host', 'rate_limited', 'version',
  ]);
});

test('create: valid, optional colour, sanitised name', () => {
  assert.deepEqual(ok(j({ t: 'create', v: 1, name: 'Mom' })), { t: 'create', v: 1, name: 'Mom' });
  assert.deepEqual(ok(j({ t: 'create', v: 1, name: '  Mom  ', color: 3 })), { t: 'create', v: 1, name: 'Mom', color: 3 });
  assert.equal(ok(j({ t: 'create', v: 1 })).name, '');
  assert.equal(ok(j({ t: 'create', v: 1, name: 'x'.repeat(100) })).name.length, MAX_NAME);
  assert.equal(ok(j({ t: 'create', v: 1, name: '\u200B' })).name, '');
});

test('create/join: version mismatch is reported as `version`, other faults as bad_msg', () => {
  bad(j({ t: 'create', v: 2, name: 'a' }), 'version');
  bad(j({ t: 'create', name: 'a' }), 'version');
  bad(j({ t: 'join', v: '1', code: 'KQXZ', name: 'a' }), 'version');
  bad(j({ t: 'join', v: null, code: 'KQXZ', name: 'a' }), 'version');
  bad(j({ t: 'create', v: 1, name: 5 }));
  bad(j({ t: 'create', v: 1, name: 'a', color: 8 }));
  bad(j({ t: 'create', v: 1, name: 'a', color: -1 }));
  bad(j({ t: 'create', v: 1, name: 'a', color: 1.5 }));
  bad(j({ t: 'create', v: 1, name: 'a', color: '1' }));
});

test('join: code is upper-cased, token validated', () => {
  assert.deepEqual(ok(j({ t: 'join', v: 1, code: 'kqxz', name: 'Dad' })), { t: 'join', v: 1, name: 'Dad', code: 'KQXZ' });
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(ok(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token })).token, token);
  assert.equal(ok(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token: 'tok-1' })).token, 'tok-1');
  bad(j({ t: 'join', v: 1, name: 'Dad' }));
  bad(j({ t: 'join', v: 1, code: 12, name: 'Dad' }));
  bad(j({ t: 'join', v: 1, code: 'K'.repeat(17), name: 'Dad' }));
  bad(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token: 5 }));
  bad(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token: '' }));
  bad(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token: 'x'.repeat(65) }));
  bad(j({ t: 'join', v: 1, code: 'KQXZ', name: 'Dad', token: 'has space' }));
});

test('join: a malformed code passes through upper-cased for the room lookup to reject', () => {
  assert.equal(ok(j({ t: 'join', v: 1, code: 'ab1', name: 'x' })).code, 'AB1');
  assert.equal(ok(j({ t: 'join', v: 1, code: '\u00DF\u00DF', name: 'x' })).code, '\u00DF\u00DF', 'only ASCII is upper-cased');
});

test('profile: every field optional, validated when present', () => {
  assert.deepEqual(ok(j({ t: 'profile' })), { t: 'profile' });
  assert.deepEqual(ok(j({ t: 'profile', id: 3, name: 'Boomer', color: 4, team: 1 })), { t: 'profile', id: 3, name: 'Boomer', color: 4, team: 1 });
  bad(j({ t: 'profile', id: -1 }));
  bad(j({ t: 'profile', id: 1.5 }));
  bad(j({ t: 'profile', id: '3' }));
  bad(j({ t: 'profile', id: 2 ** 31 }));
  bad(j({ t: 'profile', team: 2 }));
  bad(j({ t: 'profile', team: '0' }));
  bad(j({ t: 'profile', name: 7 }));
  bad(j({ t: 'profile', color: 9 }));
});

test('settings: only keys and values of SETTINGS_DEFS survive, per key', () => {
  assert.deepEqual(ok(j({ t: 'settings', patch: { rounds: 5, mode: 'teams', locked: true } })).patch, { rounds: 5, mode: 'teams', locked: true });
  assert.deepEqual(ok(j({ t: 'settings', patch: { rounds: 4, mode: 'teams', evil: 1, theme: 'lava' } })).patch, { mode: 'teams', theme: 'lava' });
  assert.deepEqual(ok(j({ t: 'settings', patch: { rounds: '3', roundTime: 121, suddenDeath: 'yes', layout: 'huge', blocks: null, items: 'many' } })).patch, { items: 'many' });
  assert.deepEqual(ok(j({ t: 'settings', patch: {} })).patch, {});
  assert.deepEqual(ok('{"t":"settings","patch":{"roundTime":-0}}').patch, { roundTime: 0 });
  assert.equal(Object.is(ok('{"t":"settings","patch":{"roundTime":-0}}').patch.roundTime, 0), true, 'canonical value, not -0');
  bad(j({ t: 'settings' }));
  bad(j({ t: 'settings', patch: [] }));
  bad(j({ t: 'settings', patch: 'rounds' }));
  bad(j({ t: 'settings', patch: null }));
  for (const [key, def] of Object.entries(SETTINGS_DEFS)) {
    for (const v of def.values) assert.deepEqual(ok(j({ t: 'settings', patch: { [key]: v } })).patch, { [key]: v }, `${key}=${v}`);
  }
});

test('addBot, removeBot, kick', () => {
  assert.deepEqual(ok(j({ t: 'addBot', level: 'hard' })), { t: 'addBot', level: 'hard' });
  bad(j({ t: 'addBot', level: 'godlike' }));
  bad(j({ t: 'addBot' }));
  bad(j({ t: 'addBot', level: ['easy'] }));
  assert.deepEqual(ok(j({ t: 'removeBot', id: 4 })), { t: 'removeBot', id: 4 });
  assert.deepEqual(ok(j({ t: 'kick', id: 0 })), { t: 'kick', id: 0 });
  bad(j({ t: 'kick', id: '4' }));
  bad(j({ t: 'kick', id: 4.5 }));
  bad(j({ t: 'kick' }));
  bad(j({ t: 'removeBot', id: null }));
});

test('argument-less messages ignore extra keys but keep only `t`', () => {
  for (const t of ['start', 'lobby', 'sync', 'leave']) assert.deepEqual(ok(j({ t, junk: 1 })), { t });
});

test('in: exact [s,d,b,x] integers', () => {
  assert.deepEqual(ok(j({ t: 'in', c: [[1, 0, 0, 0]] })), { t: 'in', c: [[1, 0, 0, 0]] });
  assert.deepEqual(ok(j({ t: 'in', c: [[10, 2, 1, 0], [11, 4, 0, 1]] })).c, [[10, 2, 1, 0], [11, 4, 0, 1]]);
  assert.deepEqual(ok(j({ t: 'in', c: [[2147483647, 4, 1, 1]] })).c, [[2147483647, 4, 1, 1]]);
  bad(j({ t: 'in', c: [] }));
  bad(j({ t: 'in' }));
  bad(j({ t: 'in', c: 'x' }));
  bad(j({ t: 'in', c: [[1, 0, 0]] }));
  bad(j({ t: 'in', c: [[1, 0, 0, 0, 0]] }));
  bad(j({ t: 'in', c: [{ s: 1, d: 0, b: 0, x: 0 }] }));
  bad(j({ t: 'in', c: [[-1, 0, 0, 0]] }));
  bad(j({ t: 'in', c: [[2147483648, 0, 0, 0]] }));
  bad(j({ t: 'in', c: [[1.5, 0, 0, 0]] }));
  bad(j({ t: 'in', c: [[1, 5, 0, 0]] }));
  bad(j({ t: 'in', c: [[1, -1, 0, 0]] }));
  bad(j({ t: 'in', c: [[1, 0, 2, 0]] }));
  bad(j({ t: 'in', c: [[1, 0, 0, 2]] }));
  bad(j({ t: 'in', c: [[1, 0, true, 0]] }));
  bad(j({ t: 'in', c: [['1', 0, 0, 0]] }));
  bad(j({ t: 'in', c: [[1, 0, 0, 0], [2, 9, 0, 0]] }), 'bad_msg');
  bad('{"t":"in","c":[[1,0,0,null]]}');
});

test(`in: at most ${IN_MAX_CMDS} cmds per frame`, () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => [i + 1, 0, 0, 0]);
  assert.equal(ok(j({ t: 'in', c: rows(IN_MAX_CMDS) })).c.length, IN_MAX_CMDS);
  bad(j({ t: 'in', c: rows(IN_MAX_CMDS + 1) }));
});

test('in: the parsed rows are copies, not references into the input', () => {
  const input = { t: 'in', c: [[1, 2, 0, 1]] };
  const out = ok(input);
  assert.notEqual(out.c[0], input.c[0]);
  input.c[0][0] = 99;
  assert.equal(out.c[0][0], 1);
});

test('chat: sanitised to MAX_CHAT graphemes; empty stays empty for the room to drop', () => {
  assert.equal(ok(j({ t: 'chat', text: '  hi   there ' })).text, 'hi there');
  assert.equal(ok(j({ t: 'chat', text: 'x'.repeat(400) })).text.length, MAX_CHAT);
  assert.equal(ok(j({ t: 'chat', text: '\u200B\u200B' })).text, '');
  bad(j({ t: 'chat' }));
  bad(j({ t: 'chat', text: 5 }));
  bad(j({ t: 'chat', text: ['hi'] }));
});

test('emote: integer 0..7', () => {
  for (let e = 0; e <= 7; e++) assert.deepEqual(ok(j({ t: 'emote', e })), { t: 'emote', e });
  for (const e of [-1, 8, 1.5, '1', null, undefined, NaN]) bad(j({ t: 'emote', e }));
});

test('ping: finite number ts', () => {
  assert.deepEqual(ok(j({ t: 'ping', ts: 12345.5 })), { t: 'ping', ts: 12345.5 });
  bad(j({ t: 'ping', ts: '5' }));
  bad(j({ t: 'ping' }));
  bad('{"t":"ping","ts":1e999}');
});

test('unknown or malformed types are rejected', () => {
  bad(j({ t: 'nope' }));
  bad(j({ t: 5 }));
  bad(j({ t: null }));
  bad(j({}));
  bad(j({ type: 'start' }));
  bad(j({ t: 'toString' }));
  bad(j({ t: 'hasOwnProperty' }));
  for (const raw of ['', 'null', '5', '"start"', '[]', '[{"t":"start"}]', 'true', '{', '{"t":"start"', 'not json', '\u0000']) bad(raw);
});

test('non-string, non-object inputs are rejected without throwing', () => {
  for (const raw of [undefined, null, 5, true, Symbol('s'), () => 1, 10n]) bad(raw);
});

test('plain objects are accepted like their JSON', () => {
  assert.deepEqual(ok({ t: 'emote', e: 3 }), { t: 'emote', e: 3 });
  bad({ t: 'emote', e: NaN });                        // NaN stringifies to null
  bad([{ t: 'start' }]);
});

test('objects with throwing getters, toJSON or cycles are rejected without throwing', () => {
  bad({ t: 'start', get boom() { throw new Error('x'); } });
  bad({ t: 'start', toJSON() { throw new Error('x'); } });
  const cyc = { t: 'start' };
  cyc.self = cyc;
  bad(cyc);
  bad(new Proxy({}, { ownKeys() { throw new Error('x'); }, get() { throw new Error('x'); } }));
});

test('size limit: 4096 UTF-16 units', () => {
  const pad = (n) => 'x'.repeat(n);
  const base = '{"t":"start","p":"' + '"}';
  const okRaw = '{"t":"start","p":"' + pad(4096 - base.length) + '"}';
  assert.equal(okRaw.length, 4096);
  ok(okRaw);
  bad(okRaw + ' ');
  bad('{"t":"chat","text":"' + pad(5000) + '"}');
});

test('prototype-pollution keys are rejected at any depth', () => {
  bad('{"t":"start","__proto__":{"admin":true}}');
  bad('{"t":"start","constructor":{"prototype":{"x":1}}}');
  bad('{"t":"start","prototype":1}');
  bad('{"t":"settings","patch":{"__proto__":{"rounds":5}}}');
  bad('{"t":"settings","patch":{"rounds":5,"constructor":1}}');
  bad('{"t":"in","c":[[1,0,0,0]],"x":{"y":[{"z":{"__proto__":1}}]}}');
  bad('{"t":"chat","text":"hi","meta":[[{"a":{"b":{"c":{"prototype":null}}}}]]}');
  bad('{"t":"profile","na\\u006de":"x","__pr\\u006fto__":1}');            // escaped spelling of the same key
  assert.equal(({}).admin, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'x'), false);
});

test('deeply nested hostile JSON cannot overflow the stack', () => {
  const depth = 1500;
  const raw = '{"t":"start","d":' + '['.repeat(depth) + ']'.repeat(depth) + '}';
  assert.ok(raw.length <= MAX_RAW_LEN);
  assert.doesNotThrow(() => parseClientMessage(raw));
  ok(raw);
  bad('{"t":"start","d":' + '['.repeat(1500) + '{"__proto__":1}' + ']'.repeat(1500) + '}');
});

test('the result is built from known fields only', () => {
  const out = ok(j({ t: 'emote', e: 1, evil: { a: 1 }, __x: 2 }));
  assert.deepEqual(Object.keys(out), ['t', 'e']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('failure results are frozen shared constants', () => {
  const r = parseClientMessage('nope');
  assert.throws(() => { r.code = 'x'; }, TypeError);
  assert.equal(parseClientMessage('nope').code, 'bad_msg');
});

const hasPollutionKey = (v) => v !== null && typeof v === 'object'
  && Object.keys(v).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype' || hasPollutionKey(v[k]));

test('fuzz: 20000 random and malformed payloads never throw and always return a well-formed result', () => {
  const rng = makeRng(0xf00d);
  const scalars = () => rng.pick([0, 1, -1, 2, 3, 7, 8, 15, 16, 17, 1.5, 2 ** 31, 2 ** 31 - 1, 2 ** 53, -0, NaN, Infinity, '', 'a', 'KQXZ', 'kqxz', 'hard', 'teams', 'ffa',
    true, false, null, '__proto__', 'constructor', '\u202E', '\u200B', '\uD800', 'x'.repeat(200), 'tok-1', 'a1b2c3d4e5f60718293a4b5c6d7e8f90']);
  const TYPES = ['create', 'join', 'profile', 'settings', 'addBot', 'removeBot', 'kick', 'start', 'lobby', 'in', 'chat', 'emote', 'ping', 'sync', 'leave', 'nope', '', 5];
  const KEYS = ['t', 'v', 'name', 'color', 'code', 'token', 'id', 'team', 'patch', 'level', 'c', 'text', 'e', 'ts', 'rounds', 'mode', 'locked', '__proto__', 'constructor', 'prototype'];
  const gen = (depth) => {
    const r = rng.int(depth > 3 ? 2 : 6);
    if (r === 0) return scalars();
    if (r === 1) return [rng.int(4), rng.int(5), rng.int(2), rng.int(2)];
    if (r === 2) return Array.from({ length: rng.int(20) }, () => gen(depth + 1));
    const o = {};
    for (let n = rng.int(6); n > 0; n--) Object.defineProperty(o, rng.pick(KEYS), { value: gen(depth + 1), enumerable: true, configurable: true, writable: true });
    return o;
  };
  let accepted = 0;
  for (let i = 0; i < 20000; i++) {
    let payload;
    switch (i % 5) {
      case 0: payload = gen(0); break;
      case 1: payload = { t: rng.pick(TYPES), v: rng.pick([1, 1, 1, 2, '1']), name: scalars(), code: scalars(), token: scalars(), color: scalars(), id: scalars(), c: gen(2), patch: gen(2), text: scalars(), e: scalars(), ts: scalars(), level: scalars() }; break;
      case 2: {
        const good = j({ t: 'in', c: [[i, rng.int(5), rng.int(2), rng.int(2)]] });
        const at = rng.int(good.length);
        payload = good.slice(0, at) + String.fromCharCode(rng.int(0xffff)) + good.slice(at + rng.int(3));       // corrupt a valid frame
        break;
      }
      case 3: payload = j(gen(0)); break;
      default: payload = String.fromCharCode(...Array.from({ length: rng.int(60) }, () => rng.int(0x300)));
    }
    let r;
    assert.doesNotThrow(() => { r = parseClientMessage(payload); }, `payload ${i}`);
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) {
      accepted++;
      assert.equal(typeof r.msg.t, 'string');
      assert.ok(Object.values(CLIENT_MSG).includes(r.msg.t));
      assert.equal(hasPollutionKey(r.msg), false);
      assert.equal(Object.getPrototypeOf(r.msg), Object.prototype);
    } else {
      assert.ok(r.code === 'bad_msg' || r.code === 'version');
    }
  }
  assert.ok(accepted > 500, `the fuzzer also reaches valid frames (${accepted})`);
});

test('parse is fast enough for the hot path (60 `in` frames/s from 8 players)', () => {
  const frame = j({ t: 'in', c: [[1, 2, 0, 0], [2, 2, 0, 0], [3, 2, 1, 0], [4, 2, 0, 0]] });
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) parseClientMessage(frame);
  assert.ok(performance.now() - t0 < 500);
});

// ---- Snapshot index maps -----------------------------------------------------------------------

test('index maps are frozen and match Appendix A.2', () => {
  assert.ok(Object.isFrozen(P) && Object.isFrozen(PF) && Object.isFrozen(B));
  assert.deepEqual(P, { ID: 0, X: 1, Y: 2, F: 3, FL: 4, SH: 5, SS: 6, CU: 7, CT: 8, BM: 9, RG: 10, SP: 11, DT: 12 });
  assert.deepEqual(PF, { MOVING: 1, ALIVE: 2, KICK: 4, GLOVE: 8 });
  assert.deepEqual(B, { I: 0, ID: 0, O: 1, X: 2, Y: 3, TX: 4, TY: 5, FU: 6, RG: 7, D: 8, FL: 9, PS: 10 });
});

test('decodePlayer / decodeBomb decode the canonical fixture rows', () => {
  const snap = JSON.parse('{"p":[[0,1.5,3.213,2,3,0,0,"slow",312,1,2,0,0],[2,13.5,1.5,0,4,0,0,0,0,2,3,1,40]],"b":[[7,0,1.5,1.5,1,1,121,2,0,0,[0]]]}');
  assert.deepEqual(decodePlayer(snap.p[0]), {
    id: 0, x: 1.5, y: 3.213, facing: 2, moving: true, alive: true, kick: false, glove: false, shield: 0, spawnShield: 0,
    curse: 'slow', curseTicks: 312, bombsMax: 1, range: 2, speedLv: 0, deadT: 0,
  });
  assert.deepEqual(decodePlayer(snap.p[1]), {
    id: 2, x: 13.5, y: 1.5, facing: 0, moving: false, alive: false, kick: true, glove: false, shield: 0, spawnShield: 0,
    curse: null, curseTicks: 0, bombsMax: 2, range: 3, speedLv: 1, deadT: 40,
  });
  assert.deepEqual(decodeBomb(snap.b[0]), { id: 7, owner: 0, x: 1.5, y: 1.5, tx: 1, ty: 1, fuse: 121, range: 2, dir: 0, fly: null, pass: [0] });
  assert.deepEqual(decodeBomb([9, -1, 3, 4, 5, 4, 100, 3, 0, [1.5, 4.5, 5.5, 4.5, 10, 26], []]).fly, { fx: 1.5, fy: 4.5, tx: 5.5, ty: 4.5, left: 10, total: 26 });
});

test('EVENT_ARGS is the closed event list of Appendix A.3', () => {
  assert.deepEqual(Object.keys(EVENT_ARGS).sort(), [
    'block', 'bomb', 'bombgone', 'boom', 'curse', 'death', 'go', 'itemgone', 'itemspawn', 'kick', 'land', 'left', 'pickup',
    'sdland', 'sdstart', 'shieldhit', 'showdown', 'throw',
  ]);
  assert.deepEqual(EVENT_ARGS.boom, ['bombId', 'ownerId', 'tx', 'ty', 'range', 'tiles']);
  assert.deepEqual(EVENT_ARGS.throw, ['playerId', 'bombId', 'fromTx', 'fromTy', 'toTx', 'toTy']);
  assert.ok(Object.isFrozen(EVENT_ARGS) && Object.isFrozen(EVENT_ARGS.boom));
});
