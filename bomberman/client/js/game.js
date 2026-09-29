// game.js - ClientGame: everything the browser needs to turn the server's 20 Hz snapshots into a smooth, instantly responsive
// picture (docs/SPEC.md sections 5.1-5.3, 8.1, Appendix A.2). No DOM, no window, no global clock: `now` and `send` are injected, so
// the whole file runs (and is tested) in Node.
//
//   const game = new ClientGame({ me, send: (obj) => conn.send(obj), now: () => performance.now() });
//   'joined'  -> game.setSeq(msg.seq)        'round' -> game.reset(msg)        'snap' -> game.onSnapshot(msg, performance.now())
//   'pong'    -> game.onPong(msg.ts)         'sync' is sent by the game itself when the grid version diverges
//   every rAF frame:  game.setIntent(input.getIntent());  game.update(t);  const view = game.getView(t);  game.takeEvents();
//   hidden tab or dead link: game.pauseSending()      visible again: game.resume(t)      'joined' (setSeq) also releases the hold
//
// WHAT IT DOES
//   * Prediction: a fixed 60 Hz loop builds one cmd per tick ({s,d,b,x}), moves the local player with the SAME movePlayer/effectiveDir
//     the server runs, and flushes the cmds once per frame. Every snapshot re-bases the prediction on the server's copy of the player
//     and replays the cmds the server has not acknowledged yet (the replay contract of 5.2, including bomb `pass` lists and the
//     `left` map). A small misprediction becomes a visual error offset that decays with tau 80 ms instead of a snap.
//   * Ghost bombs: a bomb placed by the predictor is drawn at once and stays until a snapshot acknowledges its cmd; the server's own
//     bomb is in that very snapshot, so the swap is atomic and needs no matching by tile.
//   * Everybody else is drawn ~100 ms in the past, interpolated between the two snapshots that bracket a monotonic render clock;
//     bombs, flames, items and timers are the newest snapshot's discrete state.
//   * Events are handed out the moment their snapshot arrives (takeEvents), never delayed to render time.
//
// CLARIFICATIONS where the spec is silent (all the simplest reading):
//   * View carries two extra fields, `mode` (the round's mode, which the renderer honours for team rings) and `local` (the
//     View.players entry of the local fighter, or null for a spectator/dead-and-gone one) so main.js need not search per frame.
//   * A cmd built in the last `lead` ticks of the countdown is sent (the server holds it) and kept in `pending`, but the predictor only
//     starts at the estimated GO; at that moment it replays those held cmds on top of the spawn state, exactly as the server will.
//   * Latched bomb/special taps are discarded on ticks that build no cmd (countdown, dead, spectating): a tap from a moment when
//     the player could not act must not fire later.
//   * A snapshot with the same `k` as the newest one is ignored, except that its `g` is applied: the reply to `sync` can carry the
//     tick we already have, and its grid is exactly the grid we were missing.
//   * `takeEvents()` returns a shared frozen empty array when nothing happened, so an idle frame allocates nothing.
//   * Rebasing on the wire's rounded copy of my position would be lossy in one place: movePlayer's corner slide tests
//     `Math.floor(pp) === lane`, which flips at an integer, and the server can stand at 10.999999 (an EPS-lattice position after a
//     wall-flush run) that the wire shows as 11.000. So every cmd remembers the position the predictor reached after it; when the
//     remembered position for the acked cmd rounds to exactly what the server sent, the replay starts from the remembered (exact)
//     float instead. If the server disagrees beyond rounding, the wire value wins, as the contract says. Without this a 25 s
//     random walk measured mispredictions of half a tile in front of a pillar (the flip is in world.js and is reported to its owner).
//   * A reconnecting client must not send cmds between the new socket opening and `joined` arriving: they would carry the old,
//     higher numbers, the server would accept them, and then ignore every correctly numbered cmd until the count caught up. Three
//     layers stop that: net.js drops everything but create/join/ping until `joined` has arrived on the socket; main.js calls
//     pauseSending() when the link drops (the character then stands still under the "Reconnecting" overlay instead of walking on)
//     and setSeq() (the `joined`) lifts the hold; and a snapshot whose ack is ahead of our count moves the count up, which bounds
//     the damage of both being forgotten to the server's queue length.

import {
  TICK_RATE, GRID_W, GRID_H, INTERP_TICKS, COUNTDOWN_TICKS, COUNTDOWN_HOLD_TICKS, ENDING_TICKS, IN_MAX_CMDS, STATE, START_BOMBS, START_RANGE,
} from '../../shared/constants.js';
import { movePlayer, effectiveDir, overlapsTile, makeEnv } from '../../shared/world.js';
import { P, PF, B } from '../../shared/protocol.js';

const TICK_MS = 1000 / TICK_RATE;
const TICKS_PER_MS = TICK_RATE / 1000;
const MAX_FRAME_MS = 250;              // a longer frame is a stall or a background pause: drop the backlog instead of catching up
const MAX_TICKS_PER_FRAME = 6;
const TICK_SLACK_MS = 1e-6;            // floating-point dust: frames exactly one tick apart must not alternate between 0 and 2 ticks
const PENDING_MAX = 180;               // unacknowledged cmds kept for replay (3 s)
const RING_MAX = 16;                   // snapshots kept for interpolation (>= 12 per spec)
const ERR_DECAY = Math.exp(-TICK_MS / 80);   // per tick: the visual error offset decays with tau ~ 80 ms
const ERR_SNAP_DIST2 = 2 * 2;          // a misprediction of 2 tiles or more is a teleport: snap
const TELEPORT_DIST2 = 3 * 3;          // remote entities that jump farther than this between snapshots are not interpolated
const STALE_GAP_MS = 500;              // a snapshot this late after its predecessor only delivers the important events
const STALE_KEEP = new Set(['go', 'death', 'left', 'curse', 'sdstart', 'sdland', 'showdown']);
const ENDING_MS = ENDING_TICKS * TICK_MS;   // the server sends no snapshot once a round is OVER, so the client counts the ENDING out itself
const EVENTS_MAX = 200;
const GHOST_SOUND_MS = 30 * TICK_MS;   // a server `bomb` event this soon after its ghost went away is the same bomb
const SYNC_MIN_GAP_MS = 1000;
const RTT_ALPHA = 0.2;
const RTT_MAX_MS = 10000;
const EXTRAPOLATE_TICKS = 2;           // the render clock may run this far past the newest snapshot before holding still
const HUD_STATES = ['countdown', 'playing', 'ending', 'ending'];
const round3 = (v) => Math.round(v * 1000) / 1000;      // the wire's quantisation of x,y (World.snapshot)

const SEND = 1;                        // phase bits: build and send cmds / run the predictor
const PREDICT = 2;

const NO_EVENTS = Object.freeze([]);

const isDir = (d) => d === 1 || d === 2 || d === 3 || d === 4;

/** A fresh View with the shape of Appendix A.2 plus the `mode` and `local` extras. Arrays are refilled in place every frame. */
export function createView() {
  return {
    w: GRID_W, h: GRID_H, grid: '', state: STATE.COUNTDOWN, countdown: 0, timeLeft: -1, suddenDeath: false, me: -1, theme: 'meadow', mode: 'ffa',
    players: [], bombs: [], flames: [], items: [], falling: [], ghostBombs: [], local: null,
  };
}

const newPlayerView = () => ({
  id: 0, x: 0, y: 0, facing: 2, moving: false, alive: true, shield: 0, spawnShield: 0, curse: null, curseTicks: 0, deadT: 0, isMe: false,
  color: 0, team: 0, name: '', isBot: false, bombsMax: START_BOMBS, range: START_RANGE, speedLv: 0, kick: false, glove: false,
});
const newBombView = () => ({ id: 0, owner: -1, x: 0, y: 0, tx: 0, ty: 0, fuse: 0, range: 0, dir: 0, fly: null, pass: null });
const newFlyView = () => ({ fx: 0, fy: 0, tx: 0, ty: 0, left: 0, total: 0 });
const newFlameView = () => ({ x: 0, y: 0, mask: 0, ticksLeft: 0 });
const newItemView = () => ({ id: 0, x: 0, y: 0, kind: '', born: 0 });
const newFallingView = () => ({ tx: 0, ty: 0, ticksLeft: 0 });
const newGhostView = () => ({ x: 0, y: 0 });
const newHudPlayer = () => ({
  id: 0, name: '', color: 0, team: 0, alive: true, wins: 0, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0,
  curse: null, isBot: false, isMe: false, connected: true, waiting: false,
});
const NO_INFO = Object.freeze({ name: '', color: 0, team: 0, isBot: false, x: 0, y: 0 });

/** Entry `i` of a pool, created on first use. The View arrays hold pool members, so a frame allocates nothing in steady state. */
function take(pool, list, i, make) {
  let o = pool[i];
  if (o === undefined) o = pool[i] = make();
  list[i] = o;
  return o;
}

/** The player row with this id in a snapshot: the row at the same index (the order is fixed for a round), else a search. */
function playerRow(snap, hint, id) {
  const rows = snap.p;
  const r = rows[hint];
  if (r !== undefined && r[P.ID] === id) return r;
  for (let i = 0; i < rows.length; i++) if (rows[i][P.ID] === id) return rows[i];
  return null;
}

function bombRow(snap, id) {
  const rows = snap.b;
  for (let i = 0; i < rows.length; i++) if (rows[i][B.I] === id) return rows[i];
  return null;
}

export class ClientGame {
  /**
   * @param {{ me?: number, send: (msg: object) => void, now?: () => number }} opts
   *   me    local fighter id (-1 until known; setMe() changes it)
   *   send  transport hook; may drop the message when the link is down
   *   now   millisecond clock; the same clock that timestamps the `ping` messages and that update()/getView() are called with
   */
  constructor({ me = -1, send, now }) {
    this.me = me;
    this._send = send;
    this._now = now ?? (() => 0);
    this.seq = 0;                       // last cmd number handed out; moved by a new cmd, by joined.seq (setSeq) and by an ack ahead of it
    this.rtt = 0;                       // smoothed round trip in ms (0 until the first pong, and forever in Practice)
    this.stats = { snapshots: 0, corrections: 0, lastError: 0, maxError: 0, syncs: 0 };

    this.round = null;
    this.grid = '';
    this.gv = -1;
    this._info = new Map();             // fighter id -> static info from `round`
    this._lastSyncAt = -Infinity;

    // Interpolation state
    this._ring = [];                    // [{ snap, at }] ascending by snap.k
    this._latest = null;
    this.lastK = -1;
    this.off = null;                    // render clock offset (server tick at wall-clock 0), 5.3
    this._endingAt = 0;                 // arrival of the first ENDING snapshot of this round
    this.rt = null;                     // last render tick, kept monotonic

    // Events
    this._events = [];
    this._recentGhosts = [];            // [{ tx, ty, at }] ghosts that just went away (sound dedupe)

    // Input and the fixed-step loop
    this._d = 0;
    this._tapBomb = false;
    this._tapSpecial = false;
    this._acc = 0;
    this._lastUpdate = null;
    this._paused = false;
    this._pending = [];                 // cmds built but not yet acknowledged: { s, d, b, x }
    this._outbox = [];                  // rows [s,d,b,x] waiting for this frame's flush

    // Prediction state
    this._meRow = null;                 // my row of the newest snapshot, only while I am an alive fighter with an ack
    this.pred = null;                   // plain { id, x, y, facing, moving, speedLv, curse, curseTicks, alive }
    this._predicting = false;
    this._errX = 0;
    this._errY = 0;
    this._ghosts = [];                  // [{ s, tx, ty, bomb }]
    this._srvBombs = [];                // decoded bombs of the newest snapshot
    this._envBombs = [];                // srvBombs + ghost bombs: what the predictor collides with
    this._left = {};
    this._env = null;

    // View and pools
    this.view = createView();
    this._pool = { players: [], bombs: [], fly: [], flames: [], items: [], falling: [], ghosts: [] };
    this._hud = { roundNo: 0, winsNeeded: 0, timeLeftSec: null, suddenDeath: false, state: 'countdown', mode: 'ffa', players: [] };
    this._hudPool = [];
  }

  // ---- Session hooks ----------------------------------------------------------------------------

  /**
   * `joined`: cmd numbering continues from the server's last accepted cmd, so a reconnect can never look like a replay (5.1). A fresh
   * session also ends a pauseSending() hold: cmds sent before `joined` would carry the old, higher numbers, the server would accept
   * them, and then ignore every correctly numbered cmd until the count caught up.
   */
  setSeq(n) {
    this.seq = Number.isSafeInteger(n) && n >= 0 ? n : 0;
    this._paused = false;
    this._acc = 0;
    this._lastUpdate = null;
    this._dropPrediction();
  }

  /** The id can change when a token expires and the server hands out a fresh one. */
  setMe(id) {
    this.me = id;
    this._meRow = null;
    this._dropPrediction();
  }

  /** `round`: a new arena (or a live one for a joiner/reconnecter). Clears everything per-round; never touches `seq` (5.1). */
  reset(roundMsg) {
    this.round = roundMsg;
    this.grid = typeof roundMsg.grid === 'string' ? roundMsg.grid : '';
    this.gv = roundMsg.serverTick === 0 ? 0 : -1;   // a fresh arena is grid version 0; a live grid's version arrives with its snapshot
    this._info.clear();
    for (const p of roundMsg.players ?? []) this._info.set(p.id, p);
    this._ring.length = 0;
    this._latest = null;
    this.lastK = -1;
    this.off = null;
    this.rt = null;
    this._lastSyncAt = -Infinity;
    this._recentGhosts.length = 0;
    this._meRow = null;
    this._tapBomb = this._tapSpecial = false;
    this._dropPrediction();
  }

  /** `pong`: `ts` is the value the ping carried, read from the same clock as `now`. */
  onPong(ts) {
    const sample = this._now() - ts;
    if (!(sample >= 0 && sample < RTT_MAX_MS)) return;
    this.rtt = this.rtt === 0 ? sample : this.rtt + RTT_ALPHA * (sample - this.rtt);
  }

  // ---- Snapshots --------------------------------------------------------------------------------

  onSnapshot(snap, arrivalMs = this._now()) {
    if (this.round === null || snap === null || typeof snap !== 'object') return;
    if (!Array.isArray(snap.p) || !Array.isArray(snap.b) || !Array.isArray(snap.f) || !Array.isArray(snap.i) || !Array.isArray(snap.fall)) return;   // (a shape getView would choke on every frame)
    const k = snap.k;
    if (!(k > this.lastK)) {
      if (k === this.lastK && typeof snap.g === 'string') this._takeGrid(snap, arrivalMs);
      return;
    }
    const prev = this._latest;
    const stale = prev !== null && arrivalMs - prev.at > STALE_GAP_MS;
    this.lastK = k;
    if (snap.st === STATE.ENDING && (prev === null || prev.snap.st !== STATE.ENDING)) this._endingAt = arrivalMs;
    this._takeGrid(snap, arrivalMs);

    const ring = this._ring;
    const entry = ring.length >= RING_MAX ? ring.shift() : { snap: null, at: 0 };
    entry.snap = snap;
    entry.at = arrivalMs;
    ring.push(entry);
    this._latest = entry;

    // Render clock: a late arrival is adopted at once (buffer more), an early one only nudges it (5.3).
    const sample = k - arrivalMs * TICKS_PER_MS;
    this.off = this.off === null ? sample : sample < this.off ? sample : this.off + 0.05 * (sample - this.off);

    const ack = snap.ack ? snap.ack[this.me] : undefined;
    if (ack > this.seq) this.seq = ack;    // the server applied numbers we have not reached (see setSeq): never number below its high-water mark
    this._syncPrediction(entry);           // before the events: the ghost sound dedupe needs the ghosts this snapshot retires
    this._collectEvents(snap, arrivalMs, stale);
    this.stats.snapshots++;
  }

  /** `g` replaces the grid; a version we did not get the grid for asks the server once per second (4.5). */
  _takeGrid(snap, arrivalMs) {
    if (typeof snap.g === 'string') {
      this.grid = snap.g;
      this.gv = snap.gv;
      if (this._env !== null) this._env = makeEnv(this.grid, this._envBombs, GRID_W, GRID_H, this._left);   // the predictor collides with the new grid at once
    } else if (snap.gv !== this.gv && arrivalMs - this._lastSyncAt >= SYNC_MIN_GAP_MS) {
      this._lastSyncAt = arrivalMs;
      this.stats.syncs++;
      this._send({ t: 'sync' });
    }
  }

  _collectEvents(snap, arrivalMs, stale) {
    if (this._paused) {                    // a hidden tab keeps the state but must not replay a minute of explosions later
      this._events.length = 0;
      return;
    }
    const list = snap.e;
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      if (!Array.isArray(ev)) continue;
      const code = ev[0];
      if (stale && !STALE_KEEP.has(code)) continue;
      if (code === 'bomb' && ev[2] === this.me && this._matchesGhost(ev[3], ev[4], arrivalMs)) continue;
      this._events.push(ev.slice());
    }
    if (this._events.length > EVENTS_MAX) this._events.splice(0, this._events.length - EVENTS_MAX);
  }

  /** Was this server `bomb` event's sound already played by our ghost? A retired ghost is consumed by its event (one ghost, one event). */
  _matchesGhost(tx, ty, at) {
    for (const g of this._ghosts) if (g.tx === tx && g.ty === ty) return true;
    const recent = this._recentGhosts;
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].tx === tx && recent[i].ty === ty && at - recent[i].at <= GHOST_SOUND_MS) { recent.splice(i, 1); return true; }
    }
    return false;
  }

  /** Hands out the events since the last call: the wire arrays (copied) plus synthetic local ones, oldest first. */
  takeEvents() {
    if (this._events.length === 0) return NO_EVENTS;
    const out = this._events;
    this._events = [];
    return out;
  }

  // ---- Input and the fixed-step loop ------------------------------------------------------------

  /** `d` is overwritten each call; `bomb`/`special` latch until the tick that consumes them, so one tap is exactly one cmd with b:1. */
  setIntent(intent) {
    const { d = 0, bomb = false, special = false } = intent ?? {};
    this._d = isDir(d) ? d : 0;
    if (bomb) this._tapBomb = true;
    if (special) this._tapSpecial = true;
  }

  /**
   * Hidden tab, or the link is down: stop building and sending cmds, forget what was queued, stop collecting events (5.4). Snapshots
   * are still tracked. Held until resume() or setSeq(); update() does not lift it, so a reconnecting client stays silent until
   * the server has told it where the numbering stands.
   */
  pauseSending() {
    this._paused = true;
    this._outbox.length = 0;
    this._tapBomb = this._tapSpecial = false;
    this._d = 0;
  }

  /** Visible again: drop the time backlog and every assumption that was made while nothing was running (5.4). */
  resume(nowMs = this._now()) {
    this._paused = false;
    this._acc = 0;
    this._lastUpdate = nowMs;
    this._pending.length = 0;
    this._outbox.length = 0;
    this.off = null;
    while (this._ring.length > 2) this._ring.shift();
  }

  /** Runs the fixed ticks that are due, then flushes their cmds in ONE message (at most 60 messages a second). */
  update(nowMs = this._now()) {
    if (this._paused) {
      this._lastUpdate = nowMs;
      return;
    }
    if (this._lastUpdate === null) {
      this._lastUpdate = nowMs;
      return;
    }
    const dt = Math.max(0, nowMs - this._lastUpdate);
    this._lastUpdate = nowMs;
    if (dt > MAX_FRAME_MS) {               // the page was frozen: what was pending belongs to a past the server has moved on from
      this._acc = 0;
      this._pending.length = 0;
      this._outbox.length = 0;
      return;
    }
    this._acc += dt;
    let ran = 0;
    while (this._acc >= TICK_MS - TICK_SLACK_MS && ran < MAX_TICKS_PER_FRAME) {
      this._acc -= TICK_MS;
      this._tick(nowMs);
      ran++;
    }
    if (this._acc > TICK_MS) this._acc = TICK_MS;    // never carry more than one tick
    else if (this._acc < 0) this._acc = 0;
    if (ran > 0) this._flush();
  }

  /** Which of SEND / PREDICT apply now (5.2): alive fighter, and the countdown close enough to GO. */
  _phase(nowMs) {
    const latest = this._latest;
    if (latest === null || this._meRow === null) return 0;
    const st = latest.snap.st;
    if (st === STATE.PLAYING) return SEND | PREDICT;
    if (st === STATE.ENDING) return nowMs - this._endingAt < ENDING_MS ? SEND | PREDICT : 0;    // afterwards the round is OVER (5.2): no cmds, no ghosts
    if (st !== STATE.COUNTDOWN) return 0;
    const estCd = latest.snap.cd - (nowMs - latest.at) * TICKS_PER_MS;
    const lead = Math.min(COUNTDOWN_HOLD_TICKS, this.rtt * 0.03 + 2);     // the server holds cmds in the last 12 countdown ticks
    if (estCd <= 0) return SEND | PREDICT;
    return estCd <= lead ? SEND : 0;
  }

  _tick(nowMs) {
    this._errX *= ERR_DECAY;
    this._errY *= ERR_DECAY;
    const phase = this._phase(nowMs);
    if ((phase & SEND) === 0) {
      this._tapBomb = this._tapSpecial = false;
      this._predicting = false;
      this._ghosts.length = 0;
      return;
    }
    const predict = (phase & PREDICT) !== 0;
    if (predict && !this._predicting) {                // GO: start from the spawn state plus the cmds the server is holding for us
      this._rebuildPrediction(true);
      this._predicting = true;
    } else if (!predict) {
      this._predicting = false;
    }

    const cmd = { s: ++this.seq, d: this._d, b: this._tapBomb ? 1 : 0, x: this._tapSpecial ? 1 : 0, px: NaN, py: NaN };
    this._tapBomb = this._tapSpecial = false;
    this._pending.push(cmd);
    if (this._pending.length > PENDING_MAX) this._pending.shift();
    this._outbox.push([cmd.s, cmd.d, cmd.b, cmd.x]);
    if (predict) {
      this._step(this.pred, cmd.d);
      cmd.px = this.pred.x;
      cmd.py = this.pred.y;
      if (cmd.b) this._tryGhost(cmd);
    }
  }

  _flush() {
    const rows = this._outbox;
    if (rows.length === 0) return;
    this._outbox = [];
    for (let at = 0; at < rows.length; at += IN_MAX_CMDS) this._send({ t: 'in', c: rows.slice(at, at + IN_MAX_CMDS) });
  }

  // ---- Prediction -------------------------------------------------------------------------------

  /** One predicted tick: move first, then the `pass` update, then the curse clock - the order World.tick uses. */
  _step(me, d) {
    movePlayer(me, effectiveDir(me, d), this._env);
    this._pruneLeft(me);
    if (me.curseTicks > 0 && --me.curseTicks === 0) me.curse = null;
  }

  /** A bomb whose tile my hitbox no longer overlaps stops being walk-through for me, for good (strict test, like the server). */
  _pruneLeft(me) {
    const bombs = this._envBombs;
    const left = this._left;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      if (b.fly || left[b.id] === true || !b.pass.includes(me.id)) continue;
      if (!overlapsTile(me, b.tx, b.ty)) left[b.id] = true;
    }
  }

  /** The predictor's own bomb, drawn until the server acknowledges the cmd that placed it (5.2). */
  _tryGhost(cmd) {
    const me = this.pred;
    if (me.curse === 'nobomb') return;
    const tx = Math.floor(me.x);
    const ty = Math.floor(me.y);
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H || this.grid[ty * GRID_W + tx] !== '.') return;
    let owned = this._ghosts.length;
    for (const b of this._srvBombs) if (b.owner === me.id) owned++;
    if (owned >= this._meRow[P.BM]) return;
    for (const b of this._envBombs) if (!b.fly && b.tx === tx && b.ty === ty) return;
    const bomb = { id: -cmd.s, tx, ty, fly: null, pass: [me.id] };   // negative ids cannot collide with the server's
    this._ghosts.push({ s: cmd.s, tx, ty, bomb });
    this._envBombs.push(bomb);
    this._events.push(['bomb', -1, me.id, tx, ty]);
    if (this._events.length > EVENTS_MAX) this._events.shift();
  }

  /** New snapshot: retire what it acknowledges and re-base the prediction on the server's copy of me. */
  _syncPrediction(entry) {
    const snap = entry.snap;
    const row = playerRow(snap, 0, this.me);
    const ack = snap.ack ? snap.ack[this.me] : undefined;
    const alive = row !== null && (row[P.FL] & PF.ALIVE) !== 0;
    this._meRow = alive && typeof ack === 'number' && snap.st !== STATE.OVER ? row : null;
    if (this._meRow === null) {
      this._dropPrediction(entry.at);
      return;
    }
    let exact = null;                      // the cmd the server has just applied last, with the position I predicted after it
    for (const c of this._pending) if (c.s === ack) { exact = c; break; }
    this._trimAcked(ack, entry.at);
    this._rebuildPrediction(this._predicting || (this._phase(entry.at) & PREDICT) !== 0, exact);
  }

  /** Cmds and ghosts up to `ack` are settled: the snapshot either holds the server's bomb for a ghost or the server refused it. */
  _trimAcked(ack, at) {
    const pending = this._pending;
    let kept = 0;
    for (let i = 0; i < pending.length; i++) if (pending[i].s > ack) pending[kept++] = pending[i];
    pending.length = kept;
    const ghosts = this._ghosts;
    kept = 0;
    for (let i = 0; i < ghosts.length; i++) {
      if (ghosts[i].s > ack) ghosts[kept++] = ghosts[i];
      else this._retireGhost(ghosts[i], at);
    }
    ghosts.length = kept;
  }

  _retireGhost(ghost, at) {
    const recent = this._recentGhosts;
    recent.push({ tx: ghost.tx, ty: ghost.ty, at });
    if (recent.length > 8) recent.shift();
  }

  /**
   * The replay contract: my copy of the snapshot's player, then every unacknowledged cmd in order, with the server's bombs and my
   * ghosts (from their own cmd on) as obstacles. `replay` is false before GO, when the server has not started applying anything.
   * The result replaces the prediction; the difference to what was on screen becomes the decaying error offset. `exact` is the acked
   * cmd with the position I predicted after it (see the header): when that rounds to the wire value it is the better starting point.
   */
  _rebuildPrediction(replay, exact = null) {
    const row = this._meRow;
    const snap = this._latest.snap;
    const shown = this._predicting && this.pred !== null;
    const shownX = shown ? this.pred.x + this._errX : 0;
    const shownY = shown ? this.pred.y + this._errY : 0;

    const me = this.pred ?? (this.pred = { id: this.me, x: 0, y: 0, facing: 0, moving: false, speedLv: 0, curse: null, curseTicks: 0, alive: true });
    me.id = this.me;
    const agrees = replay && exact !== null && round3(exact.px) === row[P.X] && round3(exact.py) === row[P.Y];
    me.x = agrees ? exact.px : row[P.X];
    me.y = agrees ? exact.py : row[P.Y];
    me.facing = row[P.F];
    me.moving = (row[P.FL] & PF.MOVING) !== 0;
    me.speedLv = row[P.SP];
    me.curse = row[P.CU] || null;
    me.curseTicks = row[P.CT];
    me.alive = true;

    const srv = this._srvBombs;
    srv.length = 0;
    for (let i = 0; i < snap.b.length; i++) {
      const r = snap.b[i];
      srv.push({ id: r[B.I], owner: r[B.O], tx: r[B.TX], ty: r[B.TY], fly: r[B.FL] || null, pass: r[B.PS] });
    }
    const bombs = this._envBombs;
    bombs.length = 0;
    for (let i = 0; i < srv.length; i++) bombs.push(srv[i]);
    this._left = {};
    this._env = makeEnv(this.grid, bombs, GRID_W, GRID_H, this._left);

    const ghosts = this._ghosts;
    let g = 0;
    if (replay) {
      const pending = this._pending;
      for (let i = 0; i < pending.length; i++) {
        while (g < ghosts.length && ghosts[g].s <= pending[i].s) bombs.push(ghosts[g++].bomb);
        this._step(me, pending[i].d);
        pending[i].px = me.x;
        pending[i].py = me.y;
      }
    }
    while (g < ghosts.length) bombs.push(ghosts[g++].bomb);

    if (shown) {
      const dx = shownX - me.x;
      const dy = shownY - me.y;
      const d2 = dx * dx + dy * dy;
      const err = Math.sqrt(d2);
      this.stats.corrections++;
      this.stats.lastError = err;
      if (err > this.stats.maxError) this.stats.maxError = err;
      this._errX = d2 < ERR_SNAP_DIST2 ? dx : 0;
      this._errY = d2 < ERR_SNAP_DIST2 ? dy : 0;
    } else {
      this._errX = this._errY = 0;
    }
  }

  /**
   * I cannot act (dead, spectating, round over, session reset): nothing predicted, nothing pending, no ghosts. With `retireAt` the
   * ghosts still count for the sound dedupe of a server `bomb` event that arrives in the same snapshot; without it they are forgotten.
   */
  _dropPrediction(retireAt = null) {
    this.pred = null;
    this._predicting = false;
    this._errX = this._errY = 0;
    this._pending.length = 0;
    this._outbox.length = 0;
    if (retireAt !== null) for (const g of this._ghosts) this._retireGhost(g, retireAt);
    this._ghosts.length = 0;
    this._srvBombs.length = 0;
    this._envBombs.length = 0;
  }

  // ---- The View ---------------------------------------------------------------------------------

  /** The render tick: `now` mapped onto the server's tick count, `INTERP_TICKS` in the past, monotonic and clamped to what we hold. */
  _renderTick(nowMs) {
    const first = this._ring[0].snap.k;
    let rt;
    if (this.off === null) rt = this.rt === null ? this._latest.snap.k - INTERP_TICKS : this.rt;
    else rt = nowMs * TICKS_PER_MS + this.off - INTERP_TICKS;
    if (this.rt !== null && rt < this.rt) rt = this.rt;
    const last = this._latest.snap.k + EXTRAPOLATE_TICKS;
    rt = rt < first ? first : rt > last ? last : rt;
    this.rt = rt;
    return rt;
  }

  /** The tick of the render clock the last getView() drew (null before the first snapshot). */
  get renderTick() {
    return this.rt;
  }

  /** Fills and returns THE View object (the same object every call). All x,y are centre coordinates in tile units. */
  getView(nowMs = this._now()) {
    const v = this.view;
    const round = this.round;
    if (round === null) return v;
    v.w = round.w ?? GRID_W;
    v.h = round.h ?? GRID_H;
    v.me = this.me;
    v.theme = round.theme;
    v.mode = round.mode ?? 'ffa';
    v.grid = this.grid;
    const latest = this._latest;
    if (latest === null) return this._fillPreRound(v, round);

    const snap = latest.snap;
    const elapsed = Math.max(0, (nowMs - latest.at) * TICKS_PER_MS);      // ticks since the newest snapshot arrived
    v.state = snap.st;
    v.countdown = snap.cd;
    v.timeLeft = snap.r;
    v.suddenDeath = snap.sd === 1;

    const rt = this._renderTick(nowMs);
    const ring = this._ring;
    let ia = 0;
    for (let i = ring.length - 1; i >= 0; i--) {
      if (ring[i].snap.k <= rt) { ia = i; break; }
    }
    const from = ring[ia];
    const to = ia + 1 < ring.length ? ring[ia + 1] : from;
    const t = to === from ? 0 : (rt - from.snap.k) / (to.snap.k - from.snap.k);

    this._fillPlayers(v, snap, from.snap, to.snap, t);
    this._fillBombs(v, snap, from.snap, to.snap, t, elapsed);
    this._fillFlames(v, snap, elapsed);
    this._fillItems(v, snap);
    this._fillFalling(v, snap, elapsed);
    this._fillGhosts(v);
    return v;
  }

  _fillPlayers(v, snap, a, b, t) {
    const rows = snap.p;
    const list = v.players;
    const pred = this._predicting ? this.pred : null;
    v.local = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row[P.ID];
      const o = take(this._pool.players, list, i, newPlayerView);
      const fl = row[P.FL];
      const alive = (fl & PF.ALIVE) !== 0;
      let x = row[P.X];
      let y = row[P.Y];
      let facing = row[P.F];
      let moving = (fl & PF.MOVING) !== 0;
      if (id === this.me && pred !== null && alive) {
        x = pred.x + this._errX;
        y = pred.y + this._errY;
        facing = pred.facing;
        moving = pred.moving;
      } else if (alive && a !== b) {                 // the dead and the departed are drawn where the newest snapshot says
        const ra = playerRow(a, i, id);
        const rb = playerRow(b, i, id);
        if (ra !== null && rb !== null) {
          const dx = rb[P.X] - ra[P.X];
          const dy = rb[P.Y] - ra[P.Y];
          if (dx * dx + dy * dy > TELEPORT_DIST2) {
            x = rb[P.X];
            y = rb[P.Y];
          } else {
            x = ra[P.X] + dx * t;
            y = ra[P.Y] + dy * t;
          }
          const near = t < 0.5 ? ra : rb;
          facing = near[P.F];
          moving = (near[P.FL] & PF.MOVING) !== 0;
        }
      }
      const info = this._info.get(id) ?? NO_INFO;
      o.id = id;
      o.x = x;
      o.y = y;
      o.facing = facing;
      o.moving = moving;
      o.alive = alive;
      o.shield = row[P.SH];
      o.spawnShield = row[P.SS];
      o.curse = row[P.CU] || null;
      o.curseTicks = row[P.CT];
      o.deadT = row[P.DT];
      o.isMe = id === this.me;
      o.color = info.color;
      o.team = info.team;
      o.name = info.name;
      o.isBot = info.isBot;
      o.bombsMax = row[P.BM];
      o.range = row[P.RG];
      o.speedLv = row[P.SP];
      o.kick = (fl & PF.KICK) !== 0;
      o.glove = (fl & PF.GLOVE) !== 0;
      if (o.isMe) v.local = o;
    }
    list.length = rows.length;
  }

  _fillBombs(v, snap, a, b, t, elapsed) {
    const rows = snap.b;
    const list = v.bombs;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const o = take(this._pool.bombs, list, i, newBombView);
      const fl = row[B.FL];
      o.id = row[B.I];
      o.owner = row[B.O];
      o.x = row[B.X];
      o.y = row[B.Y];
      if (a !== b && (fl || row[B.D] !== 0)) {       // only bombs in motion are interpolated
        const ra = bombRow(a, o.id);
        const rb = bombRow(b, o.id);
        if (ra !== null && rb !== null) {
          const dx = rb[B.X] - ra[B.X];
          const dy = rb[B.Y] - ra[B.Y];
          if (dx * dx + dy * dy > TELEPORT_DIST2) {
            o.x = rb[B.X];
            o.y = rb[B.Y];
          } else {
            o.x = ra[B.X] + dx * t;
            o.y = ra[B.Y] + dy * t;
          }
        }
      }
      o.tx = row[B.TX];
      o.ty = row[B.TY];
      o.fuse = fl ? row[B.FU] : Math.max(0, row[B.FU] - elapsed);   // the fuse is paused while a bomb flies
      o.range = row[B.RG];
      o.dir = row[B.D];
      o.pass = row[B.PS];
      if (fl) {
        const f = this._pool.fly[i] ?? (this._pool.fly[i] = newFlyView());
        f.fx = fl[0];
        f.fy = fl[1];
        f.tx = fl[2];
        f.ty = fl[3];
        f.left = fl[4];
        f.total = fl[5];
        o.fly = f;
      } else {
        o.fly = null;
      }
    }
    list.length = rows.length;
  }

  _fillFlames(v, snap, elapsed) {
    const rows = snap.f;
    const list = v.flames;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const o = take(this._pool.flames, list, i, newFlameView);
      o.x = row[0] + 0.5;
      o.y = row[1] + 0.5;
      o.mask = row[2];
      o.ticksLeft = Math.max(0, row[3] - elapsed);
    }
    list.length = rows.length;
  }

  _fillItems(v, snap) {
    const rows = snap.i;
    const list = v.items;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const o = take(this._pool.items, list, i, newItemView);
      o.id = row[0];
      o.x = row[1] + 0.5;
      o.y = row[2] + 0.5;
      o.kind = row[3];
      o.born = snap.k - row[4];
    }
    list.length = rows.length;
  }

  _fillFalling(v, snap, elapsed) {
    const rows = snap.fall;
    const list = v.falling;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const o = take(this._pool.falling, list, i, newFallingView);
      o.tx = row[0];
      o.ty = row[1];
      o.ticksLeft = Math.max(0, row[2] - elapsed);
    }
    list.length = rows.length;
  }

  _fillGhosts(v) {
    const list = v.ghostBombs;
    const ghosts = this._ghosts;
    for (let i = 0; i < ghosts.length; i++) {
      const o = take(this._pool.ghosts, list, i, newGhostView);
      o.x = ghosts[i].tx + 0.5;
      o.y = ghosts[i].ty + 0.5;
    }
    list.length = ghosts.length;
  }

  /** Between `round` and the first snapshot (a few milliseconds): fighters standing on their spawn tiles, nothing else. */
  _fillPreRound(v, round) {
    v.state = STATE.COUNTDOWN;
    v.countdown = COUNTDOWN_TICKS;
    v.timeLeft = round.roundTime > 0 ? round.roundTime * 60 : -1;
    v.suddenDeath = false;
    const list = v.players;
    const fighters = round.players ?? [];
    v.local = null;
    for (let i = 0; i < fighters.length; i++) {
      const info = fighters[i];
      const o = take(this._pool.players, list, i, newPlayerView);
      o.id = info.id;
      o.x = info.x;
      o.y = info.y;
      o.facing = 2;
      o.moving = false;
      o.alive = true;
      o.shield = o.spawnShield = 0;
      o.curse = null;
      o.curseTicks = 0;
      o.deadT = 0;
      o.isMe = info.id === this.me;
      o.color = info.color;
      o.team = info.team;
      o.name = info.name;
      o.isBot = info.isBot;
      o.bombsMax = START_BOMBS;
      o.range = START_RANGE;
      o.speedLv = 0;
      o.kick = o.glove = false;
      if (o.isMe) v.local = o;
    }
    list.length = fighters.length;
    v.bombs.length = v.flames.length = v.items.length = v.falling.length = v.ghostBombs.length = 0;
    return v;
  }

  // ---- HUD ---------------------------------------------------------------------------------------

  /**
   * The hudModel of 8.6 for ui.updateHud(), refilled in place. `lobbyPlayers` is the latest `lobby` message's players (the
   * authority for wins, connected and waiting). Cheap enough for the 10 Hz HUD tick.
   */
  hudModel(view, lobbyPlayers = []) {
    const hud = this._hud;
    const round = this.round;
    hud.roundNo = round ? round.n : 0;
    hud.winsNeeded = round ? round.winsNeeded : 0;
    hud.timeLeftSec = view.timeLeft < 0 ? null : Math.ceil(view.timeLeft / TICK_RATE);
    hud.suddenDeath = view.suddenDeath;
    hud.state = HUD_STATES[view.state] ?? 'ending';
    hud.mode = view.mode;
    const players = view.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      let entry = null;
      for (let j = 0; j < lobbyPlayers.length; j++) {
        if (lobbyPlayers[j].id === p.id) { entry = lobbyPlayers[j]; break; }
      }
      const h = this._hudPool[i] ?? (this._hudPool[i] = newHudPlayer());
      h.id = p.id;
      h.name = p.name;
      h.color = p.color;
      h.team = p.team;
      h.alive = p.alive;
      h.wins = entry ? entry.wins : 0;
      h.bombsMax = p.bombsMax;
      h.range = p.range;
      h.speedLv = p.speedLv;
      h.kick = p.kick;
      h.glove = p.glove;
      h.shield = Math.max(p.shield, p.spawnShield);
      h.curse = p.curse;
      h.isBot = p.isBot;
      h.isMe = p.isMe;
      h.connected = entry ? entry.connected : true;
      h.waiting = entry ? entry.waiting : false;
      hud.players[i] = h;
    }
    hud.players.length = players.length;
    return hud;
  }
}
