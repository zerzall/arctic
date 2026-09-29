// Wire protocol helpers (docs/SPEC.md §4.2, §4.4, §4.5, Appendix A.2/A.3).
//
//  * parseClientMessage: the one gate every client frame passes. Never throws.
//  * sanitizeText: names and chat (the exact function of §4.2).
//  * P / PF / B: frozen index maps of the array-encoded snapshot entries. World.snapshot() builds
//    and the client decodes ONLY through them, so a field can never be silently shifted.
//  * decodePlayer / decodeBomb: allocate-and-name helpers for consumers that do not care about allocation.
//
// Clarifications where the spec is silent (kept deliberately simple):
//  * Names are sanitised here with fallback '' (the Room applies its "Player N" fallback and de-duplication
//    because only it knows the id). An empty chat text is returned as '' for the Room to drop.
//  * A `join` code is only upper-cased (ASCII) and length-limited here; the alphabet check belongs to the
//    room lookup so that a malformed code counts as a failed join (§7).
//  * `in.c` keeps the wire shape [[s,d,b,x], ...]; the Room turns rows into cmds.
//  * `settings.patch` is filtered per key: unknown keys and invalid values are dropped, the rest kept.

import { WIRE_VERSION, MAX_NAME, MAX_CHAT, IN_MAX_CMDS, SETTINGS_DEFS, BOT_LEVELS } from './constants.js';

export { WIRE_VERSION };

/** Longest raw client frame, in UTF-16 units (ws.js additionally caps the payload at 4096 bytes). */
export const MAX_RAW_LEN = 4096;

// ---- Message types and error codes ------------------------------------------------------------
export const CLIENT_MSG = Object.freeze({
  CREATE: 'create', JOIN: 'join', PROFILE: 'profile', SETTINGS: 'settings', ADD_BOT: 'addBot', REMOVE_BOT: 'removeBot',
  KICK: 'kick', START: 'start', LOBBY: 'lobby', IN: 'in', CHAT: 'chat', EMOTE: 'emote', PING: 'ping', SYNC: 'sync', LEAVE: 'leave',
});

export const SERVER_MSG = Object.freeze({
  JOINED: 'joined', LOBBY: 'lobby', ROUND: 'round', SNAP: 'snap', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd',
  CHAT: 'chat', EMOTE: 'emote', SYS: 'sys', PONG: 'pong', KICKED: 'kicked', ERROR: 'error',
});

export const ERR = Object.freeze({
  BAD_MSG: 'bad_msg', VERSION: 'version', NO_ROOM: 'no_room', FULL: 'full', LOCKED: 'locked', BUSY: 'busy',
  NOT_HOST: 'not_host', BAD_PHASE: 'bad_phase', NEED_PLAYERS: 'need_players', NEED_TEAMS: 'need_teams',
  RATE_LIMITED: 'rate_limited', KICKED: 'kicked', CLOSED: 'closed',
});

/** Errors that end a join attempt: the server closes the socket right after sending one of these. */
export const FATAL_JOIN_ERRORS = Object.freeze([ERR.VERSION, ERR.NO_ROOM, ERR.FULL, ERR.LOCKED, ERR.BUSY, ERR.KICKED, ERR.CLOSED]);

// ---- Snapshot index maps (Appendix A.2) -------------------------------------------------------
/** Player row `p[n]`. */
export const P = Object.freeze({ ID: 0, X: 1, Y: 2, F: 3, FL: 4, SH: 5, SS: 6, CU: 7, CT: 8, BM: 9, RG: 10, SP: 11, DT: 12 });
/** Bits of the player flags `p[n][P.FL]`. */
export const PF = Object.freeze({ MOVING: 1, ALIVE: 2, KICK: 4, GLOVE: 8 });
/** Bomb row `b[n]`. `ID` is an alias of `I` because the table calls index 0 both "i" and "bomb id". */
export const B = Object.freeze({ I: 0, ID: 0, O: 1, X: 2, Y: 3, TX: 4, TY: 5, FU: 6, RG: 7, D: 8, FL: 9, PS: 10 });

/**
 * Closed list of event codes with the names of their arguments (Appendix A.3).
 * An event on the wire is `[code, ...args]`.
 */
export const EVENT_ARGS = Object.freeze({
  go: Object.freeze([]),
  bomb: Object.freeze(['bombId', 'ownerId', 'tx', 'ty']),
  boom: Object.freeze(['bombId', 'ownerId', 'tx', 'ty', 'range', 'tiles']),
  block: Object.freeze(['tx', 'ty', 'ownerId']),
  itemspawn: Object.freeze(['itemId', 'tx', 'ty', 'kind']),
  pickup: Object.freeze(['itemId', 'playerId', 'kind', 'tx', 'ty']),
  itemgone: Object.freeze(['itemId', 'tx', 'ty', 'kind']),
  bombgone: Object.freeze(['bombId', 'tx', 'ty']),
  death: Object.freeze(['playerId', 'killerId', 'x', 'y']),
  left: Object.freeze(['playerId']),
  shieldhit: Object.freeze(['playerId', 'x', 'y']),
  kick: Object.freeze(['playerId', 'bombId', 'dir']),
  throw: Object.freeze(['playerId', 'bombId', 'fromTx', 'fromTy', 'toTx', 'toTy']),
  land: Object.freeze(['bombId', 'tx', 'ty']),
  curse: Object.freeze(['playerId', 'kind', 'fromId']),
  sdstart: Object.freeze([]),
  sdland: Object.freeze(['tx', 'ty']),
  showdown: Object.freeze([]),
});

/** `[id,x,y,f,fl,sh,ss,cu,ct,bm,rg,sp,dt]` -> named object (allocates). */
export function decodePlayer(row) {
  const flags = row[P.FL];
  return {
    id: row[P.ID], x: row[P.X], y: row[P.Y], facing: row[P.F],
    moving: (flags & PF.MOVING) !== 0, alive: (flags & PF.ALIVE) !== 0, kick: (flags & PF.KICK) !== 0, glove: (flags & PF.GLOVE) !== 0,
    shield: row[P.SH], spawnShield: row[P.SS], curse: row[P.CU] || null, curseTicks: row[P.CT],
    bombsMax: row[P.BM], range: row[P.RG], speedLv: row[P.SP], deadT: row[P.DT],
  };
}

/** `[i,o,x,y,tx,ty,fu,rg,d,fl,ps]` -> named object (allocates). `fly` is null or `{fx,fy,tx,ty,left,total}`. */
export function decodeBomb(row) {
  const fl = row[B.FL];
  return {
    id: row[B.I], owner: row[B.O], x: row[B.X], y: row[B.Y], tx: row[B.TX], ty: row[B.TY],
    fuse: row[B.FU], range: row[B.RG], dir: row[B.D],
    fly: fl ? { fx: fl[0], fy: fl[1], tx: fl[2], ty: fl[3], left: fl[4], total: fl[5] } : null,
    pass: row[B.PS],
  };
}

// ---- Text sanitising (SPEC §4.2, verbatim) ----------------------------------------------------
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const ZWJ = '\u200D';

/**
 * Names and chat. NFC; controls, private-use and lone surrogates become spaces; zero-width, bidi and tag
 * characters are removed (ZWJ is kept so family/profession emoji survive); invisible filler letters become
 * spaces; at most 2 combining marks in a row; whitespace collapsed; truncated to `max` GRAPHEMES.
 * Returns `fallback` when nothing is left or `raw` is not a string.
 */
export function sanitizeText(raw, max, fallback = '') {
  if (typeof raw !== 'string') return fallback;
  let s = raw.slice(0, max * 12).normalize('NFC')
    .replace(/[\p{Cc}\p{Cs}\p{Co}]/gu, ' ')                                              // controls, lone surrogates, private use
    .replace(/\p{Cf}/gu, (m) => m === ZWJ ? m : '')                                       // zero-width / bidi / tag chars; keep ZWJ
    .replace(/[\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/g, ' ')                  // invisible filler letters
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')                                                  // at most 2 combining marks in a row
    .replace(/\u200D{2,}/g, ZWJ).replace(/\s+/gu, ' ').trim().replace(/^\u200D+|\u200D+$/g, '');
  const g = seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);
  s = g.slice(0, max).join('').replace(/\u200D+$/, '').trim();
  return s || fallback;
}

// ---- Client message parsing (SPEC §4.4) -------------------------------------------------------
const BAD_MSG = Object.freeze({ ok: false, code: ERR.BAD_MSG });
const BAD_VERSION = Object.freeze({ ok: false, code: ERR.VERSION });
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ID = 2147483647;
const MAX_SEQ = 2147483647;
const TOKEN_RE = /^[\x21-\x7e]{1,64}$/;
const MAX_CODE_LEN = 16;

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** True if any object key at any depth is a prototype-pollution vector. Iterative: hostile nesting cannot overflow the stack. */
function hasForbiddenKey(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const child of node) if (child !== null && typeof child === 'object') stack.push(child);
    } else {
      for (const key of Object.keys(node)) {
        if (FORBIDDEN_KEYS.has(key)) return true;
        const child = node[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return false;
}

/** Optional sanitised name: undefined -> '', string -> sanitised, anything else -> null (invalid). */
function readName(v) {
  if (v === undefined) return '';
  return typeof v === 'string' ? sanitizeText(v, MAX_NAME, '') : null;
}

/** Adds the optional `color` (0..7) to `msg`; false if present but invalid. */
function readColor(data, msg) {
  if (data.color === undefined) return true;
  if (!isInt(data.color, 0, 7)) return false;
  msg.color = data.color;
  return true;
}

function readCreateOrJoin(data) {
  if (data.v !== WIRE_VERSION) return BAD_VERSION;
  const name = readName(data.name);
  if (name === null) return BAD_MSG;
  const msg = { t: data.t, v: WIRE_VERSION, name };
  if (data.t === CLIENT_MSG.JOIN) {
    if (typeof data.code !== 'string' || data.code.length > MAX_CODE_LEN) return BAD_MSG;
    msg.code = data.code.replace(/[a-z]/g, (c) => c.toUpperCase());
    if (data.token !== undefined) {
      if (typeof data.token !== 'string' || !TOKEN_RE.test(data.token)) return BAD_MSG;
      msg.token = data.token;
    }
  }
  return readColor(data, msg) ? { ok: true, msg } : BAD_MSG;
}

function readProfile(data) {
  const msg = { t: data.t };
  if (data.id !== undefined) {
    if (!isInt(data.id, 0, MAX_ID)) return BAD_MSG;
    msg.id = data.id;
  }
  if (data.name !== undefined) {
    const name = readName(data.name);
    if (name === null) return BAD_MSG;
    msg.name = name;
  }
  if (!readColor(data, msg)) return BAD_MSG;
  if (data.team !== undefined) {
    if (!isInt(data.team, 0, 1)) return BAD_MSG;
    msg.team = data.team;
  }
  return { ok: true, msg };
}

function readSettings(data) {
  if (!isPlainObject(data.patch)) return BAD_MSG;
  const patch = {};
  for (const key of Object.keys(SETTINGS_DEFS)) {
    if (!Object.prototype.hasOwnProperty.call(data.patch, key)) continue;
    const { values } = SETTINGS_DEFS[key];
    const at = values.indexOf(data.patch[key]);        // strict equality: "3" is not 3, and -0 is stored as 0
    if (at >= 0) patch[key] = values[at];
  }
  return { ok: true, msg: { t: data.t, patch } };
}

function readInput(data) {
  const rows = data.c;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > IN_MAX_CMDS) return BAD_MSG;
  const c = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length !== 4) return BAD_MSG;
    const [s, d, b, x] = r;
    if (!isInt(s, 0, MAX_SEQ) || !isInt(d, 0, 4) || !isInt(b, 0, 1) || !isInt(x, 0, 1)) return BAD_MSG;
    c[i] = [s, d, b, x];
  }
  return { ok: true, msg: { t: data.t, c } };
}

function readId(data) {
  return isInt(data.id, 0, MAX_ID) ? { ok: true, msg: { t: data.t, id: data.id } } : BAD_MSG;
}

function parseData(data) {
  switch (data.t) {
    case CLIENT_MSG.CREATE:
    case CLIENT_MSG.JOIN:
      return readCreateOrJoin(data);
    case CLIENT_MSG.PROFILE:
      return readProfile(data);
    case CLIENT_MSG.SETTINGS:
      return readSettings(data);
    case CLIENT_MSG.ADD_BOT:
      return BOT_LEVELS.includes(data.level) ? { ok: true, msg: { t: data.t, level: data.level } } : BAD_MSG;
    case CLIENT_MSG.REMOVE_BOT:
    case CLIENT_MSG.KICK:
      return readId(data);
    case CLIENT_MSG.START:
    case CLIENT_MSG.LOBBY:
    case CLIENT_MSG.SYNC:
    case CLIENT_MSG.LEAVE:
      return { ok: true, msg: { t: data.t } };
    case CLIENT_MSG.IN:
      return readInput(data);
    case CLIENT_MSG.CHAT:
      return typeof data.text === 'string' ? { ok: true, msg: { t: data.t, text: sanitizeText(data.text, MAX_CHAT, '') } } : BAD_MSG;
    case CLIENT_MSG.EMOTE:
      return isInt(data.e, 0, 7) ? { ok: true, msg: { t: data.t, e: data.e } } : BAD_MSG;
    case CLIENT_MSG.PING:
      return typeof data.ts === 'number' && Number.isFinite(data.ts) ? { ok: true, msg: { t: data.t, ts: data.ts } } : BAD_MSG;
    default:
      return BAD_MSG;
  }
}

/**
 * Validates one client frame (a JSON string, or an already-parsed plain object).
 * Never throws. The returned `msg` is freshly built from known fields only.
 * @returns {{ ok: true, msg: object } | { ok: false, code: 'bad_msg' | 'version' }}
 */
export function parseClientMessage(raw) {
  try {
    let text = raw;
    if (raw !== null && typeof raw === 'object') text = JSON.stringify(raw);   // normalises getters, toJSON, NaN, undefined
    if (typeof text !== 'string' || text.length > MAX_RAW_LEN) return BAD_MSG;
    const data = JSON.parse(text);
    if (!isPlainObject(data) || hasForbiddenKey(data)) return BAD_MSG;
    return parseData(data);
  } catch {
    return BAD_MSG;
  }
}
