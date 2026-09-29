// Room: the whole multiplayer brain (docs/SPEC.md §4, §5.0, §5.1, Appendix A.4). Lobby, settings, teams, bots,
// host migration, phases, rounds, scoring, match end, chat, rate limits, the credit-based input queue, snapshot
// broadcast with grid/event cursors, reconnect/grace, waiting spectators and replays.
//
// Transport-free and isomorphic: the Node server runs one Room per code and the browser runs one for Practice
// (LoopbackConnection). Time, timers, randomness and bots enter only through the constructor.
//
// Design notes and readings of the spec where it is silent (kept simple, all covered by specs/unit/room.spec.js):
//  * Wall-clock logic (grace, host migration, idle, empty room, results auto-return, rate limits) is deadline based and
//    evaluated in housekeeping from `now()`. No per-entry timers exist, so a paused Practice room (virtual clock) freezes
//    every deadline, and `_timers` only ever holds the loop timer.
//  * `join()` never sends `error` frames: it returns `{ok:false,error}` and the transport sends `errorFrame(code)` and
//    closes. Success paths send `joined`, `lobby` and the replays before returning (A.4).
//  * A non-host sending a host-only message (settings, addBot, removeBot, kick, start, lobby) gets `error not_host`;
//    malformed or unknown frames from a joined client are dropped silently (they cannot be answered usefully).
//  * `start` counts only would-be fighters (bots and connected humans) for `need_players` / `need_teams`, so the host
//    is told at once instead of getting an instant `not_enough_players` when a friend is in grace.
//  * Step order is `snap -> roundEnd -> lobby -> round|matchEnd` (5.0). At the end of a match `lobby` (phase results)
//    therefore precedes `matchEnd`.
//  * Per-fighter stats accumulate into `entry.matchStats` when a round reaches OVER.
//  * Team-mode standings rank teams first (team wins, team kills, fewer team deaths), then individuals; teammates share a place.
//  * Extra constructor option `tickMeter = {now(), record(ms)}` lets the server time each match tick (/api/stats). It is
//    optional and unused by Practice.

import {
  TICK_RATE, SNAP_EVERY, MAX_PLAYERS, MIN_TO_START, MAX_NAME, GRID_W, GRID_H,
  COUNTDOWN_HOLD_TICKS, OVER_HOLD_TICKS, INPUT_QUEUE_MAX, INPUT_CATCHUP_AT, CATCHUP_CREDIT_MAX,
  IN_FLOOD_RATE, IN_FLOOD_BURST, STATE, SPAWN_SLOTS, BOT_NAMES, THEMES, SETTINGS_DEFS, TIMEOUTS,
} from './constants.js';
import { makeRng } from './rng.js';
import { World } from './world.js';
import { BotBrain } from './bots.js';
import { parseClientMessage, sanitizeText, ERR } from './protocol.js';

const TICK_MS = 1000 / TICK_RATE;
const IDLE_LOOP_MS = 250;                      // housekeeping cadence outside a match: an idle server burns ~0 CPU
const MAX_PUMP_MS = 5 * TICK_MS;               // at most 5 catch-up ticks per wake; a longer stall drops time
const PUMP_EPS = 1e-6;                         // 5 * TICK_MS - 5 * TICK_MS in floating point must still yield the 5th tick
const CHAT_HISTORY = 50;
const MAX_BANNED = 16;
const GRID_REFRESH_TICKS = 60;                 // a full grid rides along with a snapshot at least once per second
const CHAT_DUP_MS = 10000;

/** Server-visible text of each error code (the client shows its own copy). */
export const ERROR_TEXT = Object.freeze({
  [ERR.BAD_MSG]: 'Bad message.', [ERR.VERSION]: 'Please refresh the page to get the latest version.',
  [ERR.NO_ROOM]: 'That room does not exist.', [ERR.FULL]: 'That room is full.', [ERR.LOCKED]: 'That room is locked.',
  [ERR.BUSY]: 'Server is busy, try again in a minute.', [ERR.NOT_HOST]: 'Only the host can do that.',
  [ERR.BAD_PHASE]: 'You cannot do that right now.', [ERR.NEED_PLAYERS]: 'You need at least two fighters to start.',
  [ERR.NEED_TEAMS]: 'Each team needs at least one fighter.', [ERR.RATE_LIMITED]: 'Slow down a little.',
  [ERR.KICKED]: 'You were removed from that room.', [ERR.CLOSED]: 'Room closed.',
});

/** The JSON text of an `error` frame; the transport uses it for failed joins (Room.join only returns the code). */
export function errorFrame(code, msg = ERROR_TEXT[code] ?? '') {
  return JSON.stringify({ t: 'error', code, msg });
}

/** Seed of round `n` (4.6): distinct per round, a pure function of the room seed. */
export function roundSeed(roomSeed, n) {
  return (roomSeed + Math.imul(n, 0x9E3779B1)) >>> 0;
}

// Sliding-window limits (4.4): [max accepted messages, window ms]. `in` has its own token bucket; chat and emote answer
// with `rate_limited`, everything else is dropped silently.
const LIMITS = { chat: [5, 5000], emote: [1, 700], profile: [4, 2000], ping: [4, 1000], sync: [1, 1000] };
const DEFAULT_LIMIT = [30, 1000];
const LOUD_LIMITS = new Set(['chat', 'emote']);

const nameKey = (s) => s.normalize('NFKC').toLocaleLowerCase('en');

function randomSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

/** 16 random bytes as 32 hex characters; getRandomValues also works in plain-http browser contexts. */
function randomToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

function emptyStats() {
  return { kills: 0, deaths: 0, selfKills: 0, blocks: 0, items: 0 };
}

export class Room {
  /**
   * @param {object} o
   * @param {string} o.code
   * @param {number} [o.seed] uint32, the only source of randomness
   * @param {() => number} [o.now] milliseconds, monotonic
   * @param {(fn: Function, ms: number) => any} [o.setTimer]
   * @param {(handle: any) => void} [o.clearTimer]
   * @param {() => void} [o.onEmpty] called once, when the room closes
   * @param {(level: string, msg: string, extra?: object) => void} [o.log]
   * @param {(o: {level: string, seed: number}) => {think: Function}} [o.botFactory]
   * @param {() => string} [o.genToken]
   * @param {object} [o.timeouts]
   * @param {boolean} [o.local] Practice: the lobby message carries local:true
   * @param {string} [o.build] server package version, reported in `joined.build`
   * @param {{now: () => number, record: (ms: number) => void}} [o.tickMeter]
   */
  constructor({
    code, seed = randomSeed(), now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
    onEmpty = () => {}, log = () => {}, botFactory = (o) => new BotBrain(o), genToken = randomToken,
    timeouts = TIMEOUTS, local = false, build = '', tickMeter = null,
  } = {}) {
    this.code = code;
    this.seed = seed >>> 0;
    // Wrapped so browser builtins are never invoked with the Room as `this` ("Illegal invocation").
    this.now = () => now();
    this._setTimer = (fn, ms) => setTimer(fn, ms);
    this._clearTimer = (h) => clearTimer(h);
    this._onEmpty = onEmpty;
    this._log = log;
    this._botFactory = botFactory;
    this._genToken = genToken;
    this.timeouts = { ...TIMEOUTS, ...timeouts };
    this.local = local === true;
    this._build = String(build);
    this._meter = tickMeter;

    this.settings = {};
    for (const [key, def] of Object.entries(SETTINGS_DEFS)) this.settings[key] = def.def;

    this.phase = 'lobby';
    this.closed = false;
    this.entries = [];                          // join order == ascending id
    this._byId = new Map();
    this._nextId = 0;
    this.hostId = null;
    this.banned = [];                           // tokens of kicked humans, newest last
    this.chat = [];                             // last CHAT_HISTORY lines, for the replay to late joiners
    this.teamWins = [0, 0];
    this.roundNo = 0;                           // last built round of the current match
    this.roundsPlayed = 0;
    this.world = null;

    this._lastRoundEnd = null;                  // JSON strings kept for replays (A.4 F4)
    this._lastMatchEnd = null;
    this._matchOver = false;
    this._matchReason = 'wins';
    this._outcomeHandled = false;
    this._overSteps = 0;
    this._evCursor = 0;
    this._lastSentGv = 0;
    this._dirty = false;                        // a send failed: broadcast a fresh lobby when the current call ends
    this._totalRounds = 0;

    const t = this.now();
    this._createdAt = t;
    this._lastActive = t;
    this._lastInput = t;
    this._phaseSince = t;
    this._emptySince = t;                       // a room nobody ever joins closes after EMPTY_CLOSE_MS
    this.droppedTicks = 0;

    this._timers = new Set();
    this._loopOn = false;
    this._loopHandle = null;
    this._due = 0;
    this._acc = 0;
    this._lastPump = t;

    this._log('info', 'room_open', { room: this.code });
  }

  // ---- Public API ---------------------------------------------------------------------------------

  /**
   * Adds a human, or re-attaches one whose token matches an entry. Sends `joined`, `lobby` and the replays of A.4
   * to `conn` before returning. Failures return the code; the transport sends `errorFrame(code)` and closes.
   * @returns {{ok: true, id: number, token: string, resumed: boolean} | {ok: false, error: string}}
   */
  join(conn, opts) {
    try {
      const { name, color, token } = opts ?? {};
      if (this.closed) return { ok: false, error: ERR.CLOSED };
      if (typeof token === 'string' && this.banned.includes(token)) return { ok: false, error: ERR.KICKED };
      const known = typeof token === 'string' ? this.entries.find((e) => !e.isBot && e.token === token) : undefined;
      const result = known ? this._reattach(known, conn) : this._freshJoin(conn, name, color);
      if (result.ok) this._lastActive = this.now();
      return result;
    } catch (err) {
      this._fault('join', err);
      return { ok: false, error: ERR.CLOSED };
    } finally {
      this._settle();
    }
  }

  /** One client frame (string or plain object). Never throws. Frames from a stale connection are ignored. */
  receive(pid, raw, conn) {
    if (this.closed) return;
    try {
      const e = this._byId.get(pid);
      if (!e || e.isBot || !conn || e.conn !== conn) return;
      const parsed = parseClientMessage(raw);
      if (!parsed.ok) return;
      const msg = parsed.msg;
      if (msg.t === 'create' || msg.t === 'join') return;      // the adapter's business
      const t = this.now();
      if (msg.t !== 'ping' && msg.t !== 'leave') this._lastActive = t;
      if (msg.t === 'in') this._onInput(e, msg, t);
      else if (this._admit(e, msg, t)) this._dispatch(e, msg);
    } catch (err) {
      this._fault('receive', err);
    } finally {
      this._settle();
    }
  }

  /** The socket dropped. A no-op unless `conn` is still the entry's connection (the replaced-socket race). */
  disconnect(pid, conn) {
    if (this.closed) return;
    try {
      const e = this._byId.get(pid);
      if (!e || e.isBot || !conn || e.conn !== conn) return;
      this._markDisconnected(e);
      this._sendLobbyAll();
    } catch (err) {
      this._fault('disconnect', err);
    } finally {
      this._settle();
    }
  }

  /** Exactly one 1/60 s match tick (in phase `match`) plus housekeeping. */
  step() {
    if (this.closed) return;
    try {
      this._housekeeping(this.now());
    } catch (err) {
      this._fault('housekeeping', err);
    }
    if (this.closed) return;
    if (this.phase === 'match' && this.world) {
      try {
        this._matchTick();
      } catch (err) {
        this._fault('tick', err);
        this._abortMatch('Round crashed');
      }
    }
    this._settle();
  }

  /** Accumulator driver: runs the ticks owed since the last call, at most 5 (older time is dropped). */
  pump(nowMs) {
    const elapsed = nowMs - this._lastPump;
    const owed = Math.min(Math.max(elapsed, 0), MAX_PUMP_MS);
    if (elapsed > MAX_PUMP_MS) this.droppedTicks += Math.floor((elapsed - MAX_PUMP_MS) / TICK_MS);
    this._acc += owed;
    this._lastPump = nowMs;
    while (this._acc >= TICK_MS - PUMP_EPS && !this.closed) {
      const m = this._meter;
      if (m && this.phase === 'match') {
        const t0 = m.now();
        this.step();
        m.record(m.now() - t0);
      } else {
        this.step();
      }
      this._acc -= TICK_MS;
    }
  }

  /** Self-correcting timer loop: 60 Hz in a match, 4 Hz housekeeping otherwise. */
  startLoop() {
    if (this._loopOn || this.closed) return;
    this._loopOn = true;
    this._restartLoop();
  }

  stopLoop() {
    this._loopOn = false;
    this._cancelLoopTimer();
  }

  /** Idempotent: tells everyone, closes every connection, clears every timer, calls onEmpty once. */
  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    try {
      const frame = errorFrame(ERR.CLOSED, reason === 'restart' ? 'Server restarting' : ERROR_TEXT[ERR.CLOSED]);
      for (const e of this.entries) {
        if (e.isBot) continue;
        this._send(e, frame);
        this._closeConn(e, reason);
      }
      this.stopLoop();
      for (const h of this._timers) this._clearTimer(h);
      this._timers.clear();
      this.world = null;
      this._log('info', 'room_close', {
        room: this.code, humans: this._humans().length, bots: this.entries.filter((e) => e.isBot).length,
        rounds: this._totalRounds, ageS: Math.round((this.now() - this._createdAt) / 1000), reason,
      });
    } catch (err) {
      this._log('error', 'room_error', { room: this.code, where: 'close', stack: String(err?.stack ?? err) });
    } finally {
      try { this._onEmpty(); } catch (err) { this._log('error', 'room_error', { room: this.code, where: 'onEmpty', stack: String(err?.stack ?? err) }); }
    }
  }

  /** Read-only summary for /api/stats and tests. */
  info() {
    const humans = this._humans();
    return {
      code: this.code, phase: this.phase, humans: humans.length, connected: humans.filter((e) => e.connected).length,
      entries: this.entries.length, bots: this.entries.length - humans.length, droppedTicks: this.droppedTicks,
    };
  }

  // ---- Joining and leaving ------------------------------------------------------------------------

  _reattach(e, conn) {
    if (e.conn && e.conn !== conn) this._closeConn(e, 'replaced');       // its late `close` is ignored by disconnect()
    e.conn = conn;
    e.connected = true;
    e.disconnectedAt = null;
    e.q.length = 0;
    this._send(e, JSON.stringify({ t: 'joined', v: 1, id: e.id, token: e.token, code: this.code, seq: e.lastSeq, build: this._build }));
    this._send(e, this._lobbyFor(e));
    if (this.phase === 'match' && this.world) {
      this._sendLive(e);
      if (this.world.outcome && this._lastRoundEnd) this._send(e, this._lastRoundEnd);
    } else if (this.phase === 'results' && this._lastMatchEnd) {
      this._send(e, this._lastMatchEnd);
    }
    this._sendLobbyAll(e);
    return { ok: true, id: e.id, token: e.token, resumed: true };
  }

  _freshJoin(conn, rawName, color) {
    if (this.settings.locked) return { ok: false, error: ERR.LOCKED };
    const open = this._lobbyOpen();
    const evictee = this.entries.length >= MAX_PLAYERS && open ? this._lastBot() : null;
    if (this.entries.length >= MAX_PLAYERS && !evictee) return { ok: false, error: ERR.FULL };

    const id = this._nextId++;
    const name = this._uniqueName(sanitizeText(rawName, MAX_NAME, `Player ${id + 1}`), -1);
    const announce = evictee ? `${evictee.name} made room for ${name}` : `${name} joined`;
    if (evictee) this._dropEntry(evictee, 'evicted');

    const e = this._makeEntry({ id, name, color, isBot: false });
    e.token = this._newToken();
    e.conn = conn;
    e.connected = true;
    e.waiting = this.phase === 'match';
    this.entries.push(e);
    this._byId.set(id, e);
    if (this.hostId === null) this.hostId = id;
    this._emptySince = null;

    this._send(e, JSON.stringify({ t: 'joined', v: 1, id, token: e.token, code: this.code, seq: 0, build: this._build }));
    this._send(e, this._lobbyFor(e));
    for (const line of this.chat) this._send(e, JSON.stringify({ t: 'chat', ...line, old: true }));
    if (this.phase === 'match' && this.world) this._sendLive(e);
    else if (this.phase === 'results' && this._lastMatchEnd) this._send(e, this._lastMatchEnd);
    this._sendLobbyAll(e);
    this._sysAll(announce, e);
    return { ok: true, id, token: e.token, resumed: false };
  }

  _makeEntry({ id, name, color, isBot, level = null }) {
    return {
      id, name, color: this._freeColor(color, -1), team: this._pickTeam(), isBot, level: isBot ? level : null, token: null,
      conn: null, connected: isBot, disconnectedAt: null, waiting: false, wins: 0, matchStats: emptyStats(),
      lastSeq: 0, appliedSeq: 0, botSeq: 0, credit: 0, q: [], brain: null, brainFailed: false,
      hits: new Map(), floodTokens: IN_FLOOD_BURST, floodAt: this.now(), lastChat: null,
    };
  }

  _newToken() {
    for (;;) {
      const token = this._genToken();
      if (typeof token === 'string' && token && !this.entries.some((e) => e.token === token)) return token;
    }
  }

  /** Removes the entry from the room and tells everyone. Used by leave, kick, grace expiry. */
  _removeEntry(e, closeReason, sysText) {
    if (!this._byId.has(e.id)) return;
    const hostBefore = this.hostId;
    this._dropEntry(e, closeReason);
    this._sendLobbyAll();
    if (sysText) this._sysAll(sysText);
    if (this.hostId !== hostBefore && this.hostId !== null) this._announceHost();
    if (this.phase === 'match' && this._humanCount() === 0) {
      this._enterLobby();                                                // bots never play alone
      this._sendLobbyAll();
    }
  }

  /** Structural removal only: no messages. */
  _dropEntry(e, closeReason) {
    const at = this.entries.indexOf(e);
    if (at < 0) return;
    this.entries.splice(at, 1);
    this._byId.delete(e.id);
    e.q.length = 0;
    e.brain = null;
    if (this.phase === 'match' && this.world) this.world.removeFighter(e.id);
    this._closeConn(e, closeReason);
    if (this.hostId === e.id) this.hostId = (this._oldestHuman(true) ?? this._oldestHuman(false))?.id ?? null;
    if (this._humanCount() === 0) this._emptySince ??= this.now();
  }

  _markDisconnected(e) {
    e.conn = null;
    e.connected = false;
    e.disconnectedAt = this.now();
    e.q.length = 0;
  }

  // ---- Host ---------------------------------------------------------------------------------------

  /** Oldest-joined human (optionally: connected, and not `except`). Entries are kept in join order. */
  _oldestHuman(connectedOnly, except = null) {
    return this.entries.find((e) => !e.isBot && e !== except && (!connectedOnly || e.connected)) ?? null;
  }

  _announceHost() {
    const host = this._byId.get(this.hostId);
    if (host) this._sysAll(`${host.name} is now the host`);
  }

  // ---- Message dispatch ---------------------------------------------------------------------------

  _dispatch(e, msg) {
    switch (msg.t) {
      case 'profile': this._onProfile(e, msg); break;
      case 'settings': this._onSettings(e, msg); break;
      case 'addBot': this._onAddBot(e, msg); break;
      case 'removeBot': this._onRemoveBot(e, msg); break;
      case 'kick': this._onKick(e, msg); break;
      case 'start': this._onStart(e); break;
      case 'lobby': this._onBackToLobby(e); break;
      case 'chat': this._onChat(e, msg); break;
      case 'emote': this._sendHumans(JSON.stringify({ t: 'emote', from: e.id, e: msg.e })); break;
      case 'ping': this._send(e, JSON.stringify({ t: 'pong', ts: msg.ts })); break;
      case 'sync': this._onSync(e); break;
      case 'leave': this._removeEntry(e, 'left', `${e.name} left`); break;
      default: break;
    }
  }

  /** Whether a non-`in` message may proceed: chat noise is dropped for free, everything else is checked against its window. */
  _admit(e, msg, t) {
    if (msg.t === 'chat' && (msg.text === '' || this._isRepeat(e, msg.text, t))) return false;
    return this._allow(e, msg.t, t);
  }

  /** Per-type sliding window (4.4). `in` is exempt (token bucket in _onInput). */
  _allow(e, type, t) {
    const [max, windowMs] = LIMITS[type] ?? DEFAULT_LIMIT;
    let hits = e.hits.get(type);
    if (!hits) e.hits.set(type, hits = []);
    let stale = 0;
    while (stale < hits.length && t - hits[stale] >= windowMs) stale++;
    if (stale) hits.splice(0, stale);
    if (hits.length >= max) {
      if (LOUD_LIMITS.has(type)) this._error(e, ERR.RATE_LIMITED);
      return false;
    }
    hits.push(t);
    return true;
  }

  _requireHost(e) {
    if (e.id === this.hostId) return true;
    this._error(e, ERR.NOT_HOST);
    return false;
  }

  _lobbyOpen() {
    return this.phase === 'lobby' || this.phase === 'results';
  }

  _onProfile(e, msg) {
    let target = e;
    if (msg.id !== undefined && msg.id !== e.id) {
      const other = this._byId.get(msg.id);
      if (e.id !== this.hostId || !other?.isBot || !this._lobbyOpen()) return;     // only the host edits bots, only between matches
      target = other;
    }
    let changed = false;
    if (msg.name) {
      const name = this._uniqueName(msg.name, target.id);
      if (name !== target.name) { target.name = name; changed = true; }
    }
    if (this._lobbyOpen()) {
      if (msg.color !== undefined && msg.color !== target.color && !this._colorTaken(msg.color, target.id)) {
        target.color = msg.color;
        changed = true;
      }
      if (msg.team !== undefined && msg.team !== target.team) { target.team = msg.team; changed = true; }
    }
    if (changed) this._sendLobbyAll();
  }

  _onSettings(e, msg) {
    if (!this._requireHost(e) || !this._lobbyOpen()) return;
    let changed = false;
    for (const [key, value] of Object.entries(msg.patch)) {
      if (this.settings[key] === value) continue;
      this.settings[key] = value;
      changed = true;
      if (key === 'mode' && value === 'teams') this.entries.forEach((en, i) => { en.team = i % 2; });
    }
    if (changed) this._sendLobbyAll();
  }

  _onAddBot(e, msg) {
    if (!this._requireHost(e) || !this._lobbyOpen() || this.entries.length >= MAX_PLAYERS) return;
    const id = this._nextId++;
    const bot = this._makeEntry({ id, name: this._uniqueName(this._botName(), -1), isBot: true, level: msg.level });
    this.entries.push(bot);
    this._byId.set(id, bot);
    this._sendLobbyAll();
  }

  _onRemoveBot(e, msg) {
    if (!this._requireHost(e) || !this._lobbyOpen()) return;
    const bot = this._byId.get(msg.id);
    if (bot?.isBot) this._removeEntry(bot, 'removed');
  }

  _onKick(e, msg) {
    if (!this._requireHost(e) || msg.id === e.id) return;
    const target = this._byId.get(msg.id);
    if (!target) return;
    if (target.isBot) {
      this._onRemoveBot(e, msg);
      return;
    }
    this._send(target, JSON.stringify({ t: 'kicked' }));
    this.banned.push(target.token);
    if (this.banned.length > MAX_BANNED) this.banned.shift();
    this._removeEntry(target, 'kicked', `${target.name} was kicked`);
  }

  _onStart(e) {
    if (!this._requireHost(e)) return;
    if (!this._lobbyOpen()) {
      this._error(e, ERR.BAD_PHASE);
      return;
    }
    const verdict = this._readiness();
    if (verdict !== 'ok') {
      this._error(e, verdict === 'players' ? ERR.NEED_PLAYERS : ERR.NEED_TEAMS);
      return;
    }
    this.teamWins = [0, 0];
    this.roundsPlayed = 0;
    this._lastMatchEnd = null;
    for (const en of this.entries) {
      en.wins = 0;
      en.matchStats = emptyStats();
      en.waiting = false;
    }
    this._setPhase('match');
    this._beginRound(1);
  }

  _onBackToLobby(e) {
    if (!this._requireHost(e)) return;
    if (this.phase === 'lobby') return;
    const aborted = this.phase === 'match';
    this._enterLobby();
    if (aborted) this._sysAll('Host ended the match');
    this._sendLobbyAll();
  }

  _onChat(e, msg) {
    const line = { from: e.id, name: e.name, text: msg.text };
    e.lastChat = { text: msg.text, at: this.now() };
    this.chat.push(line);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this._sendHumans(JSON.stringify({ t: 'chat', ...line }));
  }

  _isRepeat(e, text, t) {
    return e.lastChat !== null && e.lastChat.text === text && t - e.lastChat.at < CHAT_DUP_MS;
  }

  _onSync(e) {
    if (this.phase !== 'match' || !this.world) return;
    this._send(e, JSON.stringify(this.world.snapshot({ grid: true, evFrom: null })));
  }

  // ---- Input (5.1) --------------------------------------------------------------------------------

  _onInput(e, msg, t) {
    // Flood guard: a frame costs its cmd count; too few tokens drops the whole frame silently.
    e.floodTokens = Math.min(IN_FLOOD_BURST, e.floodTokens + Math.max(0, t - e.floodAt) * (IN_FLOOD_RATE / 1000));
    e.floodAt = t;
    const cost = msg.c.length;
    if (e.floodTokens < cost) return;
    e.floodTokens -= cost;
    if (this.phase !== 'match' || !this.world || e.waiting) return;
    const p = this.world.player(e.id);
    if (!p || p.removed) return;

    const q = e.q;
    for (const [s, d, b, x] of msg.c) {
      if (!Number.isSafeInteger(s) || s <= e.lastSeq) continue;
      e.lastSeq = s;
      if (d !== 0 || b !== 0 || x !== 0) this._lastInput = t;
      if (q.length >= INPUT_QUEUE_MAX) {                                 // drop the oldest but keep its taps
        const oldest = q.shift();
        q[0].b |= oldest.b;
        q[0].x |= oldest.x;
      }
      q.push({ s, d, b, x });
    }
  }

  /** Catch-up policy: never more cmds than ticks elapsed on average, so a modified client cannot speed-hack. */
  _consumeInput(e, w) {
    const q = e.q;
    if (w.state === STATE.COUNTDOWN && w.countdown <= COUNTDOWN_HOLD_TICKS) {
      e.credit = Math.min(CATCHUP_CREDIT_MAX, e.credit + 1);            // held cmds wait in the queue
      return;
    }
    if (q.length) this._apply(e, w, q.shift());
    else e.credit = Math.min(CATCHUP_CREDIT_MAX, e.credit + 1);
    if (q.length > INPUT_CATCHUP_AT && e.credit > 0) {
      e.credit--;
      this._apply(e, w, q.shift());
    }
  }

  _apply(e, w, cmd) {
    w.applyCmd(e.id, cmd);
    e.appliedSeq = cmd.s;
  }

  _thinkFor(e, w) {
    const p = w.player(e.id);
    if (!e.brain || !p.alive) return;
    let cmd = null;
    try {
      cmd = e.brain.think(w, e.id);
    } catch (err) {
      if (!e.brainFailed) {
        e.brainFailed = true;
        this._log('error', 'room_error', { room: this.code, where: 'bot', stack: String(err?.stack ?? err) });
      }
    }
    w.applyCmd(e.id, { s: ++e.botSeq, d: cmd?.d | 0, b: cmd?.b ? 1 : 0, x: cmd?.x ? 1 : 0 });
  }

  // ---- The match ----------------------------------------------------------------------------------

  /** Who can fight if a round were built now: connected humans and bots. */
  _readiness() {
    const fighters = this.entries.filter((e) => e.isBot || e.connected);
    if (fighters.length < MIN_TO_START) return 'players';
    if (this.settings.mode === 'teams' && (!fighters.some((e) => e.team === 0) || !fighters.some((e) => e.team === 1))) return 'teams';
    return 'ok';
  }

  /** Builds round `n`, or ends the match when its preconditions no longer hold (4.3a). */
  _beginRound(n) {
    for (const e of this.entries) if (!e.isBot) e.waiting = !e.connected;   // absent humans sit this round out
    const fighters = this.entries.filter((e) => e.isBot || e.connected);
    if (!fighters.some((e) => !e.isBot)) {
      this._enterLobby();
      this._sysAll('Waiting for players');
      this._sendLobbyAll();
      return;
    }
    if (this._readiness() !== 'ok') {
      this._sysAll('Not enough players - match ended');
      this._finishMatch('not_enough_players');
      return;
    }

    const rSeed = roundSeed(this.seed, n);
    const theme = this.settings.theme !== 'random' ? this.settings.theme : makeRng((rSeed ^ 0xA5A5A5A5) >>> 0).pick(THEMES);
    for (const e of fighters) {
      e.q.length = 0;
      e.appliedSeq = e.lastSeq;
      e.credit = 0;
      e.brainFailed = false;
      e.brain = e.isBot ? this._makeBrain(e, rSeed) : null;
    }
    try {
      this.world = new World({
        seed: rSeed,
        fighters: fighters.map((e) => ({ id: e.id, name: e.name, color: e.color, team: e.team, isBot: e.isBot, lastSeq: e.appliedSeq })),
        mode: this.settings.mode, layout: this.settings.layout, blocks: this.settings.blocks, items: this.settings.items,
        theme, roundTime: this.settings.roundTime, suddenDeath: this.settings.suddenDeath,
      });
    } catch (err) {
      this._fault('newRound', err);
      this._abortMatch('Round crashed');
      return;
    }
    this.roundNo = n;
    this._totalRounds++;
    this._evCursor = 0;
    this._lastSentGv = this.world.gridVer;
    this._outcomeHandled = false;
    this._overSteps = 0;
    this._matchOver = false;
    this._lastRoundEnd = null;

    this._sendLobbyAll();
    this._sendLiveAll();
  }

  _makeBrain(e, rSeed) {
    try {
      return this._botFactory({ level: e.level, seed: (rSeed ^ Math.imul(e.id + 1, 0x85EBCA6B)) >>> 0 });
    } catch (err) {
      this._fault('botFactory', err);
      return null;
    }
  }

  _matchTick() {
    const w = this.world;
    if (w.state !== STATE.OVER) {
      for (const e of this.entries) {
        if (!w.player(e.id)) continue;
        if (!e.isBot) this._consumeInput(e, w);
        else if (w.state === STATE.PLAYING) this._thinkFor(e, w);
      }
      w.tick();
    }
    let sent = false;
    if (w.state !== STATE.OVER && w.tickNo % SNAP_EVERY === 0) {
      this._broadcastSnap();
      sent = true;
    }
    if (w.outcome && !this._outcomeHandled) {
      this._outcomeHandled = true;
      if (!sent) this._broadcastSnap();                                 // the final death events must precede roundEnd
      this._scoreRound(w.outcome);
    }
    if (w.state === STATE.OVER) {
      if (this._overSteps === 0) this._collectStats(w);
      if (++this._overSteps >= OVER_HOLD_TICKS) this._endRound();
    }
  }

  _broadcastSnap() {
    const w = this.world;
    if (!this.entries.some((e) => !e.isBot && e.connected)) {
      this._evCursor = w.evCount;                                       // nobody listens: events are dropped every tick
      w.trimEvents(this._evCursor);
      return;
    }
    const withGrid = w.gridVer !== this._lastSentGv || w.tickNo % GRID_REFRESH_TICKS === 0;
    const str = JSON.stringify(w.snapshot({ grid: withGrid, evFrom: this._evCursor }));
    this._lastSentGv = w.gridVer;
    this._evCursor = w.evCount;
    w.trimEvents(this._evCursor);
    this._sendHumans(str);
  }

  /** Outcome lock: score the round, decide whether the match is over, send roundEnd then lobby. */
  _scoreRound(o) {
    if (o.winnerId !== null) {
      const winner = this._byId.get(o.winnerId);
      if (winner) winner.wins++;
    }
    if (o.winnerTeam !== null) this.teamWins[o.winnerTeam]++;
    this.roundsPlayed++;
    const need = this.settings.rounds;
    const reached = this.settings.mode === 'teams' ? this.teamWins.some((v) => v >= need) : this.entries.some((e) => e.wins >= need);
    this._matchOver = reached || this.roundsPlayed >= 4 * need;
    this._matchReason = reached ? 'wins' : 'cap';
    this._lastRoundEnd = JSON.stringify({
      t: 'roundEnd', n: this.roundNo, winnerId: o.winnerId, winnerTeam: o.winnerTeam, draw: o.draw, reason: o.reason,
      scores: this.entries.map((e) => ({ id: e.id, wins: this._winsOf(e), team: e.team })), matchOver: this._matchOver,
    });
    this._sendHumans(this._lastRoundEnd);
    this._sendLobbyAll();
  }

  _collectStats(w) {
    for (const e of this.entries) {
      const p = w.player(e.id);
      if (!p) continue;
      for (const key of Object.keys(e.matchStats)) e.matchStats[key] += p.stats[key];
      e.brain = null;                                                   // no bot state survives a round
    }
  }

  _endRound() {
    if (this._matchOver) this._finishMatch(this._matchReason);
    else this._beginRound(this.roundNo + 1);
  }

  _finishMatch(reason) {
    const standings = this._standings();
    const top = standings.filter((s) => s.place === 1);
    const teams = this.settings.mode === 'teams';
    const decided = reason !== 'not_enough_players';
    this._lastMatchEnd = JSON.stringify({
      t: 'matchEnd',
      winnerId: decided && !teams && top.length === 1 ? top[0].id : null,
      winnerTeam: decided && teams && top.length > 0 && top.every((s) => s.team === top[0].team) ? top[0].team : null,
      reason, standings,
    });
    this.world = null;
    this._setPhase('results');
    this._sendLobbyAll();
    this._sendHumans(this._lastMatchEnd);
  }

  /** wins desc, kills desc, deaths asc; teams rank as units first. Joint places share the lowest number. */
  _standings() {
    const teams = this.settings.mode === 'teams';
    const teamScore = [0, 1].map((t) => {
      const mates = this.entries.filter((e) => e.team === t);
      return { wins: this.teamWins[t], kills: sum(mates, (e) => e.matchStats.kills), deaths: sum(mates, (e) => e.matchStats.deaths) };
    });
    const rows = this.entries.map((e) => ({
      id: e.id, name: e.name, color: e.color, team: e.team, wins: this._winsOf(e), ...e.matchStats, place: 0,
    }));
    const key = (r) => (teams ? teamScore[r.team] : r);
    const same = (a, b) => a.wins === b.wins && a.kills === b.kills && a.deaths === b.deaths;
    const better = (a, b) => {
      if (a.wins !== b.wins) return a.wins > b.wins;
      if (a.kills !== b.kills) return a.kills > b.kills;
      return a.deaths < b.deaths;
    };
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (!same(ka, kb)) return better(ka, kb) ? -1 : 1;
      if (teams && a.team !== b.team) return a.team - b.team;
      return same(a, b) ? 0 : better(a, b) ? -1 : 1;
    });
    for (const r of rows) r.place = 1 + rows.filter((o) => better(key(o), key(r))).length;
    return rows;
  }

  _winsOf(e) {
    return this.settings.mode === 'teams' ? this.teamWins[e.team] : e.wins;
  }

  /** Drops the World and returns to the lobby with a clean scoreboard (F11, no humans left, crash). */
  _enterLobby() {
    this.world = null;
    this.teamWins = [0, 0];
    this.roundNo = 0;
    this.roundsPlayed = 0;
    this._lastRoundEnd = null;
    this._lastMatchEnd = null;
    for (const e of this.entries) {
      e.wins = 0;
      e.waiting = false;
      e.matchStats = emptyStats();
      e.q.length = 0;
      e.brain = null;
    }
    this._setPhase('lobby');
  }

  _abortMatch(text) {
    this._enterLobby();
    this._sysAll(text);
    this._sendLobbyAll();
  }

  _setPhase(phase) {
    this.phase = phase;
    const t = this.now();
    this._phaseSince = t;
    this._lastActive = t;
    this._lastInput = t;
    if (phase === 'match' && this._loopOn) this._restartLoop();
  }

  // ---- Housekeeping (5.0 step 1) ------------------------------------------------------------------

  _housekeeping(t) {
    const to = this.timeouts;
    if (t - this._createdAt >= to.ROOM_MAX_MS) {
      this._closeFor('Room time limit reached');
      return;
    }

    const grace = this.phase === 'match' ? to.GRACE_MATCH_MS : to.GRACE_LOBBY_MS;
    let expired = null;
    for (const e of this.entries) {
      if (!e.isBot && !e.connected && t - e.disconnectedAt >= grace) (expired ??= []).push(e);
    }
    if (expired) for (const e of expired) this._removeEntry(e, 'timeout', `${e.name} left`);

    const host = this._byId.get(this.hostId);
    if (host && !host.connected && t - host.disconnectedAt >= to.HOST_MIGRATE_MS) {
      const next = this._oldestHuman(true, host);
      if (next) {
        this.hostId = next.id;
        this._sendLobbyAll();
        this._announceHost();
      }
    }

    if (this._humanCount() === 0) {
      this._emptySince ??= t;
      if (t - this._emptySince >= to.EMPTY_CLOSE_MS) {
        this.close('closed');
        return;
      }
    } else {
      this._emptySince = null;
    }

    const idle = this._lobbyOpen() ? t - this._lastActive >= to.IDLE_LOBBY_MS : this.phase === 'match' && t - this._lastInput >= to.IDLE_MATCH_MS;
    if (idle) {
      this._closeFor('Room closed after inactivity');
    } else if (this.phase === 'results' && t - this._phaseSince >= to.RESULTS_AUTO_MS) {
      this._enterLobby();
      this._sendLobbyAll();
    }
  }

  _closeFor(text) {
    this._sysAll(text);
    this.close('closed');
  }

  // ---- Loop ---------------------------------------------------------------------------------------

  _restartLoop() {
    this._cancelLoopTimer();
    this._due = this.now();
    this._acc = 0;
    this._lastPump = this._due;
    this._arm();
  }

  _cancelLoopTimer() {
    if (this._loopHandle === null) return;
    this._clearTimer(this._loopHandle);
    this._timers.delete(this._loopHandle);
    this._loopHandle = null;
  }

  _arm() {
    const h = this._setTimer(() => {
      this._timers.delete(h);
      if (this._loopHandle === h) this._loopHandle = null;
      try {
        if (this._loopOn && !this.closed) this._wake();
      } catch (err) {
        this._fault('loop', err);
      }
      if (this._loopOn && !this.closed && this._loopHandle === null) this._arm();
    }, Math.max(0, this._due - this.now()));
    h?.unref?.();
    this._loopHandle = h;
    this._timers.add(h);
  }

  _wake() {
    const t = this.now();
    let interval;
    if (this.phase === 'match') {
      this.pump(t);
      interval = TICK_MS;
    } else {
      this._lastPump = t;
      this._acc = 0;
      this.step();
      interval = IDLE_LOOP_MS;
    }
    this._due += interval;
    if (this._due < t - interval * 5) this._due = t;                    // fell far behind: drop time, do not spiral
  }

  // ---- Lobby data and outbound helpers ------------------------------------------------------------

  _humans() {
    return this.entries.filter((e) => !e.isBot);
  }

  _humanCount() {
    let n = 0;
    for (const e of this.entries) if (!e.isBot) n++;
    return n;
  }

  _lastBot() {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].isBot) return this.entries[i];
    return null;
  }

  _colorTaken(color, exceptId) {
    return this.entries.some((e) => e.id !== exceptId && e.color === color);
  }

  _freeColor(preferred, exceptId) {
    if (Number.isInteger(preferred) && preferred >= 0 && preferred < 8 && !this._colorTaken(preferred, exceptId)) return preferred;
    for (let c = 0; c < 8; c++) if (!this._colorTaken(c, exceptId)) return c;
    return 0;
  }

  /** The team with fewer entries; ties go to the team with fewer wins, then team 0 (3.8). */
  _pickTeam() {
    const count = [0, 0];
    for (const e of this.entries) count[e.team]++;
    if (count[0] !== count[1]) return count[0] < count[1] ? 0 : 1;
    return this.teamWins[1] < this.teamWins[0] ? 1 : 0;
  }

  _uniqueName(base, exceptId) {
    const taken = new Set();
    for (const e of this.entries) if (e.id !== exceptId) taken.add(nameKey(e.name));
    if (!taken.has(nameKey(base))) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base} ${n}`;
      if (!taken.has(nameKey(candidate))) return candidate;
    }
  }

  _botName() {
    const used = new Set(this.entries.map((e) => nameKey(e.name)));
    return BOT_NAMES.find((n) => !used.has(nameKey(n))) ?? BOT_NAMES[0];
  }

  /** `lobby` for one recipient: the body is built once per broadcast, only `you` differs. */
  _lobbyBody() {
    return JSON.stringify({
      code: this.code, phase: this.phase, hostId: this.hostId, ...(this.local ? { local: true } : {}),
      settings: this.settings,
      players: this.entries.map((e) => ({
        id: e.id, name: e.name, color: e.color, team: e.team, isBot: e.isBot, level: e.level, connected: e.connected,
        isHost: e.id === this.hostId, wins: this._winsOf(e), waiting: e.waiting,
      })),
      round: { n: this.phase === 'lobby' ? 0 : this.roundNo, winsNeeded: this.settings.rounds },
    });
  }

  _lobbyFor(e, body = this._lobbyBody()) {
    return `{"t":"lobby","you":${e.id},${body.slice(1)}`;
  }

  /** Lobby to every connected human (except `skip`, who already got its own). */
  _sendLobbyAll(skip = null) {
    const body = this._lobbyBody();
    for (const e of this.entries) if (!e.isBot && e.connected && e !== skip) this._send(e, this._lobbyFor(e, body));
  }

  _sysAll(text, skip = null) {
    this._sendHumans(JSON.stringify({ t: 'sys', text }), skip);
  }

  _sendHumans(str, skip = null) {
    for (const e of this.entries) if (!e.isBot && e.connected && e !== skip) this._send(e, str);
  }

  /** `round` (LIVE grid) plus a full snapshot: what a late joiner or a reconnecter needs to start drawing. */
  _sendLive(e) {
    const w = this.world;
    this._send(e, this._roundMsg(w));
    this._send(e, JSON.stringify(w.snapshot({ grid: true, evFrom: null })));
  }

  _sendLiveAll() {
    const w = this.world;
    const round = this._roundMsg(w);
    const snap = JSON.stringify(w.snapshot({ grid: true, evFrom: null }));
    for (const e of this.entries) {
      if (e.isBot || !e.connected) continue;
      this._send(e, round);
      this._send(e, snap);
    }
  }

  _roundMsg(w) {
    return JSON.stringify({
      t: 'round', n: this.roundNo, seed: w.seed, theme: w.theme, mode: w.mode, w: GRID_W, h: GRID_H, grid: w.grid.join(''),
      players: w.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, team: p.team, slot: p.slot, isBot: p.isBot,
        x: SPAWN_SLOTS[p.slot][0] + 0.5, y: SPAWN_SLOTS[p.slot][1] + 0.5,
      })),
      winsNeeded: this.settings.rounds, roundTime: this.settings.roundTime, suddenDeath: w.sdEnabled, serverTick: w.tickNo,
    });
  }

  _error(e, code) {
    this._send(e, errorFrame(code));
  }

  /** One dead socket never stops the fan-out: a failed send parks the entry in grace. */
  _send(e, str) {
    try {
      e.conn?.send(str);
    } catch {
      if (e.connected && !e.isBot) {
        this._markDisconnected(e);
        this._dirty = true;
      }
    }
  }

  _closeConn(e, reason) {
    const c = e.conn;
    e.conn = null;
    try { c?.close(reason); } catch { /* the transport is already gone */ }
  }

  /** After any public call: tell everyone about connections that failed during it. */
  _settle() {
    if (!this._dirty) return;
    this._dirty = false;
    if (!this.closed) this._sendLobbyAll();
  }

  _fault(where, err) {
    this._log('error', 'room_error', { room: this.code, where, stack: String(err?.stack ?? err) });
  }
}

function sum(list, pick) {
  let total = 0;
  for (const item of list) total += pick(item);
  return total;
}
