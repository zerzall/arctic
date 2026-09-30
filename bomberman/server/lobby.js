// RoomManager (docs/SPEC.md §7): room codes, create/find/cleanup, and the per-IP abuse limits that need to know about rooms.
//
//  * Codes are 4 letters from a vowel-free alphabet (no accidental words), drawn with node:crypto randomInt.
//  * The manager has no timer: every Room runs its own loop and calls `onEmpty` when it closes.
//  * Per-IP limits live here because they are about rooms: at most 3 live rooms created by one IP plus a token bucket
//    (burst 3, one refill per 20 s), and a failed-join limiter (more than 15 failures in 60 s block `join` for 30 s).
//    Keys are the normalised client IP (see ws.js); IPs are only ever held in memory, never logged.
//  * `TickStats` keeps the rolling 10 s tick-time window behind /api/stats without per-sample memory.

import { randomInt } from 'node:crypto';
import { Room } from '../shared/room.js';
import { TIMEOUTS } from '../shared/constants.js';

export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

const ROOMS_PER_IP = 3;
const CREATE_BURST = 3;
const CREATE_REFILL_MS = 20000;
const JOIN_FAIL_LIMIT = 15;
const JOIN_FAIL_WINDOW_MS = 60000;
const JOIN_BLOCK_MS = 30000;
const SLOW_TICK_MS = 8;
const SLOW_TICK_LOG_GAP_MS = 10000;
const PRUNE_ABOVE = 512;                       // per-IP tables are swept when they grow past this many keys
const MAX_CODE_TRIES = 64;

const BIN_MS = 0.05;
const BINS = 500;                              // 0..25 ms in 50 microsecond steps, one overflow bin after that

/** Rolling window of tick durations: per-second slots holding a small histogram (avg, p99, max over the last N seconds). */
export class TickStats {
  constructor(now = () => performance.now(), windowS = 10) {
    this._now = now;
    this._slots = Array.from({ length: windowS }, () => ({ sec: -1, n: 0, sum: 0, max: 0, bins: new Uint32Array(BINS + 1) }));
  }

  record(ms) {
    const sec = Math.floor(this._now() / 1000);
    const slot = this._slots[sec % this._slots.length];
    if (slot.sec !== sec) {
      slot.sec = sec;
      slot.n = 0;
      slot.sum = 0;
      slot.max = 0;
      slot.bins.fill(0);
    }
    slot.n++;
    slot.sum += ms;
    if (ms > slot.max) slot.max = ms;
    slot.bins[Math.min(BINS, Math.floor(ms / BIN_MS))]++;
  }

  /** @returns {{avg: number, p99: number, max: number}} milliseconds, rounded to 0.01 */
  summary() {
    const sec = Math.floor(this._now() / 1000);
    const live = this._slots.filter((s) => s.sec > sec - this._slots.length && s.sec <= sec);
    let n = 0;
    let sum = 0;
    let max = 0;
    for (const s of live) {
      n += s.n;
      sum += s.sum;
      max = Math.max(max, s.max);
    }
    if (n === 0) return { avg: 0, p99: 0, max: 0 };
    const target = Math.ceil(n * 0.99);
    let seen = 0;
    let p99 = max;
    for (let b = 0; b <= BINS; b++) {
      for (const s of live) seen += s.bins[b];
      if (seen >= target) {
        p99 = Math.min(max, (b + 1) * BIN_MS);
        break;
      }
    }
    const r = (v) => Math.round(v * 100) / 100;
    return { avg: r(sum / n), p99: r(p99), max: r(max) };
  }
}

export class RoomManager {
  /**
   * @param {object} [o]
   * @param {number} [o.maxRooms]
   * @param {object} [o.timeouts] handed to every Room
   * @param {() => number} [o.seedFn] uint32 per room; default: crypto.getRandomValues
   * @param {(level: string, ev: string, extra?: object) => void} [o.log]
   * @param {Function} [o.botFactory] handed to every Room (tests inject stubs)
   * @param {string} [o.build] package version, reported in `joined.build`
   * @param {() => number} [o.now] monotonic milliseconds: the per-IP limiters, the slow-tick log gap and every Room's clock
   * @param {Function} [o.setTimer] handed to every Room (tests inject a fake clock's timers)
   * @param {Function} [o.clearTimer]
   * @param {(n: number) => number} [o.randomInt] letter picker; injectable to force code collisions
   */
  constructor({
    maxRooms = 200, timeouts = TIMEOUTS, seedFn = undefined, log = () => {}, botFactory = undefined, build = '',
    now = () => performance.now(), randomInt: pick = randomInt, setTimer = undefined, clearTimer = undefined,
  } = {}) {
    this.maxRooms = maxRooms;
    this.rooms = new Map();
    this.tickStats = new TickStats(now);
    this._timeouts = timeouts;
    this._seedFn = seedFn;
    this._log = log;
    this._botFactory = botFactory;
    this._build = build;
    this._now = now;
    this._pick = pick;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._liveByIp = new Map();                // ip -> Set of codes it created
    this._ownerOf = new Map();                 // code -> ip
    this._buckets = new Map();                 // ip -> { tokens, at }
    this._failures = new Map();                // ip -> { times: number[], blockedUntil }
    this._dropped = 0;                         // droppedTicks of rooms that already closed
  }

  get size() {
    return this.rooms.size;
  }

  /** @returns {{ok: true, room: Room} | {ok: false, error: 'busy' | 'rate_limited'}} */
  create(ip) {
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'busy' };
    const mine = this._liveByIp.get(ip);
    if (mine && mine.size >= ROOMS_PER_IP) return { ok: false, error: 'rate_limited' };
    if (!this._takeCreateToken(ip)) return { ok: false, error: 'rate_limited' };
    const code = this._freshCode();
    if (code === null) return { ok: false, error: 'busy' };

    const room = new Room({
      code, seed: this._seedFn?.(), timeouts: this._timeouts, log: this._log, botFactory: this._botFactory, build: this._build,
      tickMeter: this._meterFor(code), onEmpty: () => this._forget(code), setTimer: this._setTimer, clearTimer: this._clearTimer,
      now: this._now,
    });
    this.rooms.set(code, room);
    this._ownerOf.set(code, ip);
    if (!mine) this._liveByIp.set(ip, new Set([code]));
    else mine.add(code);
    room.startLoop();
    return { ok: true, room };
  }

  /** Case-insensitive lookup; a malformed code is simply not found. */
  find(code) {
    if (typeof code !== 'string') return null;
    const upper = code.toUpperCase();
    return CODE_RE.test(upper) ? this.rooms.get(upper) ?? null : null;
  }

  /** True while `join` from this IP is blocked by the failed-join limiter. */
  joinBlocked(ip) {
    const f = this._failures.get(ip);
    return f !== undefined && f.blockedUntil > this._now();
  }

  /** Counts a failed join (no_room, bad code, full). Successful joins never reset the counter. */
  recordJoinFailure(ip) {
    const t = this._now();
    let f = this._failures.get(ip);
    if (!f) {
      this._prune(this._failures, (v) => v.blockedUntil <= t && v.times.every((x) => t - x >= JOIN_FAIL_WINDOW_MS));
      this._failures.set(ip, f = { times: [], blockedUntil: 0 });
    }
    while (f.times.length && t - f.times[0] >= JOIN_FAIL_WINDOW_MS) f.times.shift();
    f.times.push(t);
    if (f.times.length > JOIN_FAIL_LIMIT) f.blockedUntil = t + JOIN_BLOCK_MS;
  }

  /** Closes every room (the sockets follow through Room.close). */
  closeAll(reason = 'closed') {
    for (const room of [...this.rooms.values()]) room.close(reason);
  }

  /** Aggregates for /api/stats. `players` counts every entry (bots too), `humans` the connected humans. */
  stats() {
    let players = 0;
    let humans = 0;
    let dropped = this._dropped;
    for (const room of this.rooms.values()) {
      const info = room.info();
      players += info.entries;
      humans += info.connected;
      dropped += info.droppedTicks;
    }
    return { rooms: this.rooms.size, players, humans, droppedTicks: dropped, tickMs: this.tickStats.summary() };
  }

  _freshCode() {
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      let code = '';
      for (let k = 0; k < 4; k++) code += CODE_ALPHABET[this._pick(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  _takeCreateToken(ip) {
    const t = this._now();
    let b = this._buckets.get(ip);
    if (!b) {
      this._prune(this._buckets, (v) => v.tokens + (t - v.at) / CREATE_REFILL_MS >= CREATE_BURST);
      this._buckets.set(ip, b = { tokens: CREATE_BURST, at: t });
    }
    b.tokens = Math.min(CREATE_BURST, b.tokens + (t - b.at) / CREATE_REFILL_MS);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Per-room tick timer: feeds the shared window and logs a tick over 8 ms at most once per 10 s per room. */
  _meterFor(code) {
    let lastSlowLog = -Infinity;
    return {
      now: () => performance.now(),
      record: (ms) => {
        this.tickStats.record(ms);
        const t = this._now();
        if (ms > SLOW_TICK_MS && t - lastSlowLog >= SLOW_TICK_LOG_GAP_MS) {
          lastSlowLog = t;
          this._log('warn', 'tick_slow', { room: code, ms: Math.round(ms * 10) / 10 });
        }
      },
    };
  }

  /** Room.onEmpty: the room is closed; drop it and the bookkeeping that refers to it. */
  _forget(code) {
    const room = this.rooms.get(code);
    if (room) this._dropped += room.droppedTicks;
    this.rooms.delete(code);
    const ip = this._ownerOf.get(code);
    this._ownerOf.delete(code);
    const mine = ip === undefined ? undefined : this._liveByIp.get(ip);
    if (mine) {
      mine.delete(code);
      if (mine.size === 0) this._liveByIp.delete(ip);
    }
  }

  /** Keeps the per-IP tables bounded: sweeps entries `stale` says are back to their idle state. */
  _prune(map, stale) {
    if (map.size < PRUNE_ABOVE) return;
    for (const [key, value] of map) if (stale(value)) map.delete(key);
  }
}
