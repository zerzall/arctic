// The joining side of a session (SPEC §6.2): samples input into 60 Hz cmds, predicts
// the local player with the same movement code the host runs, reconciles against each
// snapshot, and renders everything else interpolated INTERP_DELAY in the past.
//
// Shots are predicted too (SPEC §4.1, cosmetic only): the weapon state (slot, mags,
// reload) is rebuilt from each acknowledged snapshot plus the pending cmds, like the
// position; the fire cooldown and minigun spin run locally. Predicted 'shot' events
// leave drainEvents() at once; the host's own 'shot' for us later arrives as `echo`.

import {
  GAME_VERSION, PROTOCOL_VERSION, DT, INTERP_DELAY, DEFAULT_SETTINGS, PLAYER_RADIUS,
} from '../shared/constants.js';
import {
  decodeSnapshot, encodeInputs, quantizeInput, messageType, MSG, MAX_INPUTS_PER_MESSAGE,
} from '../shared/protocol.js';
import { buildMap } from '../shared/maps.js';
import { mapBuildOptions } from '../shared/story/registry.js';
import { createCollisionWorld, stepPlayerMovement } from '../shared/movement.js';
import { copyVertical } from '../shared/jump.js';
import { WEAPONS } from '../shared/weapons.js';
import { ZOMBIES } from '../shared/zombies.js';
import { perksFor } from '../shared/classes.js';
import { rayCircle } from '../shared/geom.js';
import { round1, angleDiff } from '../shared/math.js';
import { activeWeapon, SWITCH_DELAY, COOLDOWN_EPS } from '../shared/sim/players.js';
import { MUZZLE, MAX_RAYS_PER_EVENT, traceRound, roofReach } from '../shared/sim/combat.js';
import { Emitter } from './emitter.js';
import { createTicker } from './ticker.js';
import { CmdBuilder } from './cmd-builder.js';
import { interpolateSnapshots } from './interpolation.js';
import { NetStats } from './stats.js';
import { sanitizeName, isColor, sanitizeClass, clientToken } from './lobby-rules.js';
import { IMPORTANT_EVENTS, PERISHABLE_EVENTS, STALE_EVENT_AGE } from './event-rules.js';

const HELLO_TIMEOUT_MS = 10000;
/** Nothing at all from the host for this long (it pings every 2 s): give up. */
const HOST_SILENCE = 10;
/**
 * After 'start' the host (and we) build the 3D world, which can freeze a slow page for
 * many seconds; don't call the host gone until this much silence right after a start.
 */
const START_GRACE = 30;
/** A gap this long between housekeeping ticks means our own page was frozen. */
const STALL_GAP = 1.5;
const STALE_INPUT = 0.25;
/** Cmds sent per message: the new ones, and at least this many for redundancy. */
const REDUNDANT_CMDS = 4;
/**
 * Unacknowledged cmds kept for replay (10 s). If the acks fall further behind than this
 * (a badly congested link), the replay would start from a gap: the prediction is kept
 * as it is until the acks catch up instead.
 */
const MAX_PENDING = 600;
/** Visual correction: error decays with this rate (1/s, ≈ 100 ms), bigger errors snap. */
const CORRECTION_RATE = 30;
const SNAP_DISTANCE = 120;
/** How far past the newest snapshot remote entities may be extrapolated before holding. */
const MAX_EXTRAPOLATE = 0.1;
/**
 * Clock offset estimate (host tick time minus our clock): smoothing per snapshot when
 * data arrives earlier than expected (slowly: that is usually jitter), when it arrives
 * later (fast: the host fell behind real time or the latency rose, and render time must
 * not run past the newest snapshot), and the jump that forces a resync.
 */
const OFFSET_SMOOTHING = 0.05;
const OFFSET_FALL = 0.5;
const OFFSET_RESYNC = 0.5;
/**
 * Render time follows the offset through its playback speed (at most ±RATE_RANGE off
 * real time, closing RATE_GAIN of the gap per second) so remote entities move smoothly
 * in slight slow/fast motion instead of freezing and jumping; beyond RENDER_SNAP it jumps.
 */
const RATE_GAIN = 8;
const RATE_RANGE = 0.5;
const RENDER_SNAP = 0.25;
/** Snapshots kept behind the render time (for late arrivals and extrapolation). */
const BUFFER_KEEP = 1.0;
const SEEN_TICKS_KEEP = 600;
/** Snapshots' worth of undrained events kept (10 s at 20 Hz). */
const MAX_QUEUED_SNAPSHOTS = 200;
/** A predicted shot counts as "firing" (muzzle, loops) for this long, like the sim's 6 ticks. */
const FIRING_HOLD = 0.1;
/** Undrained predicted shots kept (a hidden tab does not drain). */
const MAX_PREDICTED_EVENTS = 60;
const TOKEN_KEY = 'hh-client-token';

/**
 * This tab's id for the hello: kept in sessionStorage so the host recognises a reload of
 * the same tab (a kick keeps it out under any name); fresh in every other tab.
 */
function tabToken() {
  const a = new Uint8Array(12);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  const fresh = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const store = globalThis.sessionStorage;
    if (!store) return fresh;
    const kept = clientToken(store.getItem(TOKEN_KEY));
    if (kept) return kept;
    store.setItem(TOKEN_KEY, fresh);
  } catch {
    // Storage blocked: a new id each time is fine.
  }
  return fresh;
}

function wallClock() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function inviteUrlFor(code, kind) {
  if (!code || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', code);
  if (kind === 'relay') url.searchParams.set('via', 'relay');
  return url.href;
}

function snapTime(snap) {
  return snap.tick * DT;
}

export class ClientSession extends Emitter {
  /**
   * @param {ClientTransport} net
   * @param {object} [hooks] test hooks: { buildMap(id, seed), now() seconds, manual: true }
   */
  constructor(net, hooks = {}) {
    super();
    this.net = net;
    this.hooks = hooks;
    this.clock = hooks.now || wallClock;
    this.isHost = false;
    this.localId = 0;
    this.code = net.code || null;
    this.transport = net.kind;
    this.inviteUrl = inviteUrlFor(this.code, net.kind);
    this.roster = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.inGame = false;
    this.left = false;
    this.locked = false;
    this.match = -1;
    this.lastHostMsg = this.clock();
    this.graceUntil = -Infinity;
    this.lastTick = this.clock();

    this.map = null;
    this.world = null;
    this.builder = new CmdBuilder();
    this._resetGameState();

    this.netStats = new NetStats();
    this.stats = this.netStats.view;
    this.lastUpdateAt = -Infinity;
    this.idleSent = false;

    this._welcome = null;
    net.onMessage((channel, data) => this._onMessage(channel, data));
    net.onClose((reason) => this._disconnect(reason || 'Connection lost'));
    this.housekeeper = hooks.manual ? null : createTicker(4, () => this._timerTick());
  }

  _resetGameState() {
    this.buffer = [];
    this.newest = null;
    this.eventQueue = [];
    /** Ticks whose full snapshot events were queued / whose echo (important ones) was. */
    this.seenTicks = new Set();
    this.echoedTicks = new Set();
    this.offset = null;
    this.lastRender = -Infinity;
    this.lastRenderAt = null;
    this.pred = null;
    this.newestLocal = null;
    this.predSlot = 0;
    this.pending = [];
    this.recent = [];
    this.offX = 0;
    this.offY = 0;
    this.acc = 0;
    this.lastView = null;
    this.barricadeScratch = [];
    // Shot prediction: weapon state as of the newest predicted cmd (rebuilt on every
    // snapshot), local fire cooldown/spin, shots predicted per pending cmd seq.
    this.wpn = {
      mag: [0, 0, 0], res: [0, 0, 0], freeMag: WEAPONS.pistol.mag, reloadLeft: 0, reloadTotal: 0, reloadSlot: -1,
      lastSlot: 0, cooldown: 0, spin: 0, lastFireAt: -Infinity, burstLeft: 0, prevFire: false,
    };
    /** Trigger state of the newest acknowledged cmd (a replay starts from it). */
    this.ackFire = false;
    this.penScratch = { n: 0, wall: false, stop: 0, at: new Float64Array(8) };
    this.shotLog = new Map();
    /** seq → the free pistol's mag before that pending cmd (snapshots do not carry it). */
    this.freeMagLog = new Map();
    this.predEvents = [];
    this.ackSlot = -1;
    this.ackLastSlot = 0;
    this.ackState = '';
  }

  /** Send hello and wait for welcome/reject. Resolves this session. */
  _handshake(profile) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Could not connect')), HELLO_TIMEOUT_MS);
      const done = (err) => {
        if (!this._welcome) return;
        this._welcome = null;
        clearTimeout(timer);
        if (err) {
          this._shutdown();
          reject(err);
        } else {
          resolve(this);
        }
      };
      this._welcome = done;
      this._sendCtl({
        t: 'hello',
        version: GAME_VERSION,
        protocol: PROTOCOL_VERSION,
        name: sanitizeName(profile.name),
        color: isColor(profile.color) ? profile.color : 0,
        cls: sanitizeClass(profile.cls),
        token: this.hooks.token || tabToken(),
      });
    });
  }

  // ---- public API ------------------------------------------------------------------

  setProfile(patch = {}) {
    const msg = { t: 'profile' };
    for (const k of ['name', 'color', 'cls', 'ready']) if (patch[k] !== undefined) msg[k] = patch[k];
    this._sendCtl(msg);
  }

  setSettings() {
    return false;
  }

  start() {
    return false;
  }

  returnToLobby() {
    return false;
  }

  kick() {
    return false;
  }

  setLocked() {
    return false;
  }

  sendChat(text) {
    if (typeof text === 'string' && text.trim()) this._sendCtl({ t: 'chat', text });
  }

  buy(itemId) {
    this._sendCtl({ t: 'buy', item: String(itemId) });
  }

  ready() {
    this._sendCtl({ t: 'ready' });
  }

  update(frameDt, input, aimAngle) {
    if (this.left) return;
    const now = this.clock();
    this.netStats.addFrame();
    this.lastUpdateAt = now;
    this.idleSent = false;
    const dt = Math.min(0.25, Math.max(0, Number.isFinite(frameDt) ? frameDt : 0));
    if (this.inGame) {
      this.builder.feed(input, aimAngle);
      this.acc += dt;
      let produced = 0;
      while (this.acc >= DT && produced < MAX_INPUTS_PER_MESSAGE) {
        this.acc -= DT;
        this._applyCmd(quantizeInput(this.builder.next()));
        produced++;
      }
      // Below ~8 fps the local player slows down rather than losing cmds on the wire.
      if (this.acc >= DT) this.acc = 0;
      if (produced) this._sendInputs(produced);
      const k = Math.exp(-dt * CORRECTION_RATE);
      this.offX *= k;
      this.offY *= k;
      if (Math.abs(this.offX) < 0.01) this.offX = 0;
      if (Math.abs(this.offY) < 0.01) this.offY = 0;
    }
    if (this.hooks.manual) this._housekeep();
  }

  getView() {
    if (!this.inGame || this.buffer.length === 0) return null;
    const rt = this._renderTime();
    const buf = this.buffer;
    let i = 0;
    while (i < buf.length && snapTime(buf[i]) < rt) i++;
    let view;
    if (i === 0) {
      view = interpolateSnapshots(null, buf[0], 1);
    } else if (i === buf.length) {
      // Ran past the newest snapshot: extrapolate briefly, then hold.
      const b = buf[buf.length - 1], a = buf.length > 1 ? buf[buf.length - 2] : null;
      if (a) {
        const span = snapTime(b) - snapTime(a);
        const ext = Math.min(rt - snapTime(b), MAX_EXTRAPOLATE);
        view = interpolateSnapshots(a, b, 1 + ext / span);
      } else {
        view = interpolateSnapshots(null, b, 1);
      }
    } else {
      const a = buf[i - 1], b = buf[i];
      view = interpolateSnapshots(a, b, (rt - snapTime(a)) / (snapTime(b) - snapTime(a)));
    }
    this._overrideLocal(view);
    this.lastView = view;
    return view;
  }

  drainEvents() {
    if (!this.inGame) return [];
    const pred = this.predEvents;
    if (this.eventQueue.length === 0) {
      if (!pred.length) return [];
      this.predEvents = [];
      return pred;
    }
    const rt = this._renderTime();
    const out = [];
    const q = this.eventQueue;
    // Back from a hidden tab: long-gone tracers and sounds are not worth one big burst.
    const staleBefore = rt - STALE_EVENT_AGE;
    let n = 0;
    while (n < q.length && snapTime(q[n]) <= rt + 1e-6) {
      const stale = snapTime(q[n]) < staleBefore;
      for (const ev of q[n].events) if (!stale || !PERISHABLE_EVENTS.has(ev.type)) out.push(ev);
      n++;
    }
    if (n) q.splice(0, n);
    // Our own predicted shots are due right away, not when render time catches up.
    if (pred.length) {
      for (const ev of pred) out.push(ev);
      pred.length = 0;
    }
    return out;
  }

  getMap() {
    return this.map;
  }

  getPredictedLocal() {
    if (this.pred) {
      return { x: this.pred.x + this.offX, y: this.pred.y + this.offY, angle: this.builder.angle };
    }
    const view = this.lastView;
    const p = view && view.players.find((q) => q.id === this.localId);
    return p ? { x: p.x, y: p.y, angle: this.builder.angle } : null;
  }

  leave() {
    if (this.left) return;
    this._sendCtl({ t: 'bye' });
    this._shutdown();
  }

  // ---- messages ----------------------------------------------------------------------

  _onMessage(channel, data) {
    if (this.left) return;
    this.lastHostMsg = this.clock();
    if (channel === 'state') {
      this.netStats.addIn(data.byteLength || 0);
      if (messageType(data) !== MSG.SNAPSHOT) return;
      let snap;
      try {
        snap = decodeSnapshot(data);
      } catch (err) {
        console.warn('[net] bad snapshot', err.message);
        return;
      }
      this._onSnapshot(snap);
      return;
    }
    if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
    this.netStats.addIn(JSON.stringify(data).length);
    switch (data.t) {
      case 'welcome':
        this.localId = data.id;
        if (data.code) this.code = data.code;
        this.inviteUrl = inviteUrlFor(this.code, this.transport);
        this.roster = Array.isArray(data.roster) ? data.roster : [];
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        if (this._welcome) this._welcome(null);
        break;
      case 'reject':
        if (this._welcome) this._welcome(new Error(typeof data.reason === 'string' ? data.reason : 'Could not connect'));
        break;
      case 'roster':
        if (Array.isArray(data.roster)) {
          this.roster = data.roster;
          const me = this.roster.find((r) => r.id === this.localId);
          if (me) this.stats.ping = me.ping;
          this.emit('roster', this.roster);
        }
        break;
      case 'settings':
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        this.emit('settings', this.settings);
        break;
      case 'chat':
        this.emit('chat', { pid: data.pid | 0, name: String(data.name || ''), text: String(data.text || ''), system: !!data.system });
        break;
      case 'notice':
        if (typeof data.text === 'string') this.emit('notice', { text: data.text });
        break;
      case 'start':
        this._startGame(data);
        break;
      case 'lobby':
        if (this.inGame) {
          this.inGame = false;
          this._resetGameState();
          this.emit('lobby');
        }
        break;
      case 'ping':
        this._sendCtl({ t: 'pong', n: data.n, ts: data.ts });
        break;
      case 'bye':
        this._disconnect(typeof data.reason === 'string' ? data.reason : 'Host left the game');
        break;
      case 'kick':
        this._disconnect('Kicked');
        break;
      default:
    }
  }

  _startGame(msg) {
    const build = this.hooks.buildMap || buildMap;
    let map;
    try {
      map = build(msg.mapId, msg.seed, mapBuildOptions(msg.settings));
    } catch (err) {
      console.error('[net] could not build map', err);
      this._disconnect('Game version mismatch');
      return;
    }
    this.map = map;
    this.world = createCollisionWorld(map);
    this._resetGameState();
    this.match = msg.match;
    this.settings = { ...DEFAULT_SETTINGS, ...msg.settings };
    if (Array.isArray(msg.roster)) this.roster = msg.roster;
    this.builder.reset();
    this.inGame = true;
    this.lastHostMsg = this.clock();
    this.graceUntil = this.clock() + START_GRACE;
    const match = this.match;
    const info = { mapId: msg.mapId, seed: msg.seed, settings: { ...this.settings } };
    // A late joiner gets 'start' right behind 'welcome', before joinGame()'s caller had a
    // chance to subscribe; emitting on the next task lets it see the event either way.
    setTimeout(() => {
      if (this.left || !this.inGame || this.match !== match) return;
      this.emit('roster', this.roster);
      this.emit('start', info);
    }, 0);
  }

  // ---- snapshots ---------------------------------------------------------------------

  _onSnapshot(snap) {
    if (!this.inGame || snap.match !== this.match) return;
    this.netStats.addSnapshot();
    const now = this.clock();
    this._queueEvents(snap.tick, snap.events, false);
    if (snap.echo) {
      // Important events of snapshots we did not get (yet): a state message may be skipped
      // for a congested link, or overtaken by later ones on the unordered p2p channel.
      for (const e of snap.echo) this._queueEvents(e.tick, e.events, true);
    }
    const buf = this.buffer;
    if (this.newest && snap.tick <= this.newest.tick) {
      // Arrived out of order: slot it in if it is still useful for interpolation.
      if (snapTime(snap) < this.lastRender) return;
      let i = buf.length;
      while (i > 0 && buf[i - 1].tick > snap.tick) i--;
      if (i > 0 && buf[i - 1].tick === snap.tick) return;
      buf.splice(i, 0, snap);
      return;
    }
    buf.push(snap);
    this.newest = snap;
    this._syncClock(snapTime(snap) - now);
    this._reconcile(snap);
    // Keep what the render time still needs, plus a little history. Estimated from the
    // clock rather than lastRender so a hidden tab (no getView calls) does not pile up.
    const keepFrom = now + this.offset - INTERP_DELAY - BUFFER_KEEP;
    let drop = 0;
    while (drop < buf.length - 2 && snapTime(buf[drop + 1]) < keepFrom) drop++;
    if (drop) buf.splice(0, drop);
  }

  /**
   * Queue a snapshot's events for drainEvents(). `echo` = only its important events,
   * repeated by a later snapshot; the full list may still come and then adds the rest.
   */
  _queueEvents(tick, events, echo) {
    if (this.seenTicks.has(tick)) return;
    if (echo) {
      if (this.echoedTicks.has(tick)) return;
      this.echoedTicks.add(tick);
    } else {
      this.seenTicks.add(tick);
      if (this.echoedTicks.delete(tick) && events) events = events.filter((e) => !(e && IMPORTANT_EVENTS.has(e.type)));
    }
    if (this.seenTicks.size + this.echoedTicks.size > SEEN_TICKS_KEEP) {
      const floor = tick - SEEN_TICKS_KEEP * 3;
      for (const t of this.seenTicks) if (t < floor) this.seenTicks.delete(t);
      for (const t of this.echoedTicks) if (t < floor) this.echoedTicks.delete(t);
    }
    if (!events || events.length === 0) return;
    // The host's version of a shot we already showed (predicted): see SPEC §4.1.
    const me = this.localId;
    for (const ev of events) if (ev && ev.type === 'shot' && me && ev.pid === me) ev.echo = true;
    const q = this.eventQueue;
    let i = q.length;
    while (i > 0 && q[i - 1].tick > tick) i--;
    q.splice(i, 0, { tick, events });
    // Nobody is draining (hidden tab): stale effects are worthless, keep memory flat.
    if (q.length > MAX_QUEUED_SNAPSHOTS) q.splice(0, q.length - MAX_QUEUED_SNAPSHOTS);
  }

  _syncClock(sample) {
    if (this.offset === null || Math.abs(sample - this.offset) > OFFSET_RESYNC) {
      this.offset = sample;
      // Host clock jumped (it stalled, or we just started): allow render time to move back.
      this.lastRender = -Infinity;
    } else {
      this.offset += (sample - this.offset) * (sample < this.offset ? OFFSET_FALL : OFFSET_SMOOTHING);
    }
  }

  /**
   * The time remote entities are drawn at: INTERP_DELAY behind the host's clock as
   * estimated by `offset`. It never runs backwards; small errors are closed by playing a
   * little slower or faster, big ones by a jump.
   */
  _renderTime() {
    if (this.offset === null) return -Infinity;
    const now = this.clock();
    const target = now + this.offset - INTERP_DELAY;
    let rt;
    if (this.lastRender === -Infinity || this.lastRenderAt === null || Math.abs(target - this.lastRender) > RENDER_SNAP) {
      rt = Math.max(this.lastRender, target);
    } else {
      const dt = Math.max(0, now - this.lastRenderAt);
      const rate = 1 + Math.min(RATE_RANGE, Math.max(-RATE_RANGE, (target - this.lastRender) * RATE_GAIN));
      rt = this.lastRender + dt * rate;
    }
    // Nothing to show past the extrapolation limit: wait there for the next snapshot
    // instead of running on (and freezing longer once it arrives late).
    if (this.newest) rt = Math.min(rt, Math.max(this.lastRender, snapTime(this.newest) + MAX_EXTRAPOLATE));
    this.lastRender = rt;
    this.lastRenderAt = now;
    return rt;
  }

  // ---- prediction ----------------------------------------------------------------------

  _localEntry() {
    return this.roster.find((r) => r.id === this.localId) || null;
  }

  _moveMultFor(slots, slot, state) {
    const id = slots[slot];
    return state === 'alive' && id && WEAPONS[id] ? WEAPONS[id].moveMult : 1;
  }

  /** Mirror the host's weapon switch (slot keys, wheel, "last weapon"). */
  _predictSlot(cmd, slots) {
    if (cmd.slot >= 0 && cmd.slot < slots.length && slots[cmd.slot]) {
      this.predSlot = cmd.slot;
    } else if (cmd.cycle) {
      for (let k = 1; k < slots.length; k++) {
        const s = (this.predSlot + cmd.cycle * k + slots.length * k) % slots.length;
        if (slots[s]) {
          this.predSlot = s;
          break;
        }
      }
    } else if (cmd.lastWeapon) {
      const s = this.wpn.lastSlot;
      if (s !== this.predSlot && slots[s]) this.predSlot = s;
    }
  }

  /**
   * One predicted tick. `live` = a new cmd (fire cooldown/spin advance and shots are
   * emitted); otherwise a replay of a pending cmd after a snapshot (weapon state only,
   * using the shots predicted for it back then).
   */
  _step(cmd, live) {
    const p = this.pred;
    const sp = this.newestLocal;
    if (sp && p.state === 'alive') {
      const before = this.predSlot;
      this._predictSlot(cmd, sp.slots);
      if (this.predSlot !== before) {
        // Mirrors the host's switchSlot(): cancels a reload, spin and a short delay.
        const W = this.wpn;
        W.lastSlot = before;
        W.reloadLeft = 0;
        W.reloadSlot = -1;
        if (live) {
          W.spin = 0;
          W.burstLeft = 0;
          if (W.cooldown < SWITCH_DELAY) W.cooldown = SWITCH_DELAY;
        }
      }
      p.moveMult = this._moveMultFor(sp.slots, this.predSlot, p.state);
    }
    stepPlayerMovement(p, cmd, DT, this.world);
    if (sp) this._stepWeapon(cmd, sp, live);
  }

  _applyCmd(cmd) {
    this.pending.push(cmd);
    if (this.pending.length > MAX_PENDING) {
      this.pending.splice(0, this.pending.length - MAX_PENDING);
      this._forgetBefore(this.pending[0].seq - 1);
    }
    this.recent.push(cmd);
    if (this.recent.length > MAX_INPUTS_PER_MESSAGE) this.recent.shift();
    if (this.pred && this.pred.state !== 'dead') this._step(cmd, true);
  }

  // ---- shot prediction (cosmetic, SPEC §4.1) -------------------------------------------

  _reloadTime(id) {
    return WEAPONS[id].reload * (perksFor((this._localEntry() || {}).cls).reloadMult || 1);
  }

  /** The host's startReload(): only with room in the mag and ammo in reserve. */
  _startReload(aw) {
    const W = this.wpn;
    if (W.reloadLeft > 0 || !aw.id) return;
    const w = WEAPONS[aw.id];
    const mag = aw.slot < 0 ? W.freeMag : W.mag[aw.slot];
    const res = aw.slot < 0 ? -1 : W.res[aw.slot];
    if (mag >= w.mag || res === 0) return;
    W.reloadLeft = W.reloadTotal = this._reloadTime(aw.id);
    W.reloadSlot = aw.slot;
    W.burstLeft = 0;
  }

  _finishReload(aw) {
    const W = this.wpn;
    const w = WEAPONS[aw.id];
    if (aw.slot < 0) {
      W.freeMag = w.mag;
    } else {
      const need = w.mag - W.mag[aw.slot];
      const res = W.res[aw.slot];
      let take = res < 0 ? need : Math.min(need, res);
      if (w.reloadOne) take = Math.min(take, 1);
      W.mag[aw.slot] += take;
      if (res >= 0) W.res[aw.slot] = res - take;
    }
    W.reloadLeft = 0;
    W.reloadSlot = -1;
    // round by round, like the host: the next round goes in right away
    if (w.reloadOne && aw.slot >= 0) this._startReload(aw);
  }

  /** The host's weapon handling for one cmd (players.js handleFire), minus the damage. */
  _stepWeapon(cmd, sp, live) {
    const W = this.wpn;
    const p = this.pred;
    this.freeMagLog.set(cmd.seq, W.freeMag);
    if (live) {
      W.cooldown -= DT;
      if (W.cooldown < -DT) W.cooldown = -DT;
    }
    // Predicted mags/reserves decide the downed fallback exactly like the sim's
    // (a dry pistol in slot 0 falls back to the free pistol); downed players reload too.
    const aw = activeWeapon({ state: p.state, slots: sp.slots, slot: this.predSlot, mag: W.mag, res: W.res });
    if (cmd.reload && p.state !== 'dead') this._startReload(aw);
    if (!aw.id || !WEAPONS[aw.id]) {
      if (live) W.spin = 0;
      W.burstLeft = 0;
      W.prevFire = !!cmd.fire;
      return;
    }
    const w = WEAPONS[aw.id];
    if (W.reloadLeft > 0) {
      if (W.reloadSlot !== aw.slot) {
        W.reloadLeft = 0;
        W.reloadSlot = -1;
      } else {
        W.reloadLeft -= DT;
        if (W.reloadLeft <= 0) this._finishReload(aw);
      }
    }
    const phase = this.newest ? this.newest.phase : '';
    const trigger = cmd.fire && phase !== 'gameover' && phase !== 'victory';
    const pulled = trigger && !W.prevFire;
    W.prevFire = trigger;
    if (!w.burst) W.burstLeft = 0;
    // A replayed cmd fired whatever was predicted for it back then (a burst runs on
    // after the trigger is released); a live one follows the host's burst rule.
    const logged = live ? 0 : this.shotLog.get(cmd.seq) || 0;
    const fire = trigger || (live ? W.burstLeft > 0 : logged > 0);
    if (live) {
      if (!w.spinup) W.spin = 0;
      else if (fire) W.spin = Math.min(1, W.spin + DT / w.spinup);
      else W.spin = Math.max(0, W.spin - DT / (w.spinup * 0.6));
    }
    if (!fire) {
      if (live && W.cooldown < 0) W.cooldown = 0;
      return;
    }
    if (W.reloadLeft > 0) {
      // the host's rule: a fresh pull stops a round-by-round reload with a round in
      const loaded = aw.slot < 0 ? W.freeMag : W.mag[aw.slot];
      if (w.reloadOne && pulled && loaded > 0) {
        W.reloadLeft = 0;
        W.reloadSlot = -1;
      } else {
        if (live && W.cooldown < 0) W.cooldown = 0;
        return;
      }
    }
    let mag = aw.slot < 0 ? W.freeMag : W.mag[aw.slot];
    if (mag <= 0) {
      W.burstLeft = 0;
      this._startReload(aw);
      if (live && W.cooldown < 0) W.cooldown = 0;
      return;
    }
    if (!live) {
      // Replay: the shots predicted for this cmd back then.
      const left = Math.max(0, mag - logged);
      if (aw.slot >= 0) W.mag[aw.slot] = left;
      else W.freeMag = left;
      return;
    }
    if (w.spinup && W.spin < 1) {
      if (W.cooldown < 0) W.cooldown = 0;
      return;
    }
    let shots = 0;
    while (W.cooldown <= COOLDOWN_EPS && mag > 0 && shots < 4) {
      if (w.burst) {
        if (W.burstLeft <= 0) {
          if (!trigger) break;
          W.burstLeft = w.burst;
        }
        W.burstLeft--;
      }
      this._emitShot(aw.id, w, cmd.angle);
      mag--;
      W.cooldown += w.burst && W.burstLeft === 0 ? w.burstDelay : 1 / w.rate;
      shots++;
    }
    if (mag <= 0) W.burstLeft = 0;
    if (aw.slot < 0) W.freeMag = mag;
    else W.mag[aw.slot] = mag;
    if (shots) {
      this.shotLog.set(cmd.seq, shots);
      W.lastFireAt = this.clock();
    }
  }

  /** A predicted 'shot' from where the local player is drawn, rays traced locally. */
  _emitShot(weapon, w, angle) {
    const x = this.pred.x + this.offX, y = this.pred.y + this.offY;
    const rays = [];
    if (w.kind === 'hitscan' || w.kind === 'rail') {
      const pellets = w.pellets || 1;
      for (let k = 0; k < pellets && rays.length < MAX_RAYS_PER_EVENT; k++) {
        const a = w.spread > 0 ? angle + (Math.random() * 2 - 1) * w.spread : angle;
        rays.push(this._traceRay(x, y, a, w));
      }
    } else if (w.kind === 'melee') {
      this._sawRays(x, y, angle, w, rays);
    }
    const q = this.predEvents;
    if (q.length >= MAX_PREDICTED_EVENTS) q.shift();
    q.push({
      type: 'shot', pid: this.localId, turret: 0, weapon,
      x: round1(x + Math.cos(angle) * MUZZLE), y: round1(y + Math.sin(angle) * MUZZLE), angle,
      rays, predicted: true,
    });
  }

  /** The host's chainsaw sweep (combat.js fireSaw) against the rendered zombies: a ray per cut. */
  _sawRays(x, y, a, w, rays) {
    const view = this.lastView;
    const zs = view ? view.zombies : null;
    if (!zs) return;
    const half = (w.arc || 1.4) / 2;
    for (let i = 0; i < zs.length && rays.length < 6; i++) {
      const z = zs[i];
      const r = ZOMBIES[z.type] ? ZOMBIES[z.type].radius : 14;
      const dx = z.x - x, dy = z.y - y;
      const d = Math.hypot(dx, dy);
      if (d > w.range + r) continue;
      const close = d < r + PLAYER_RADIUS + 6;
      if (!close && Math.abs(angleDiff(a, Math.atan2(dy, dx))) > half + Math.atan2(r, d)) continue;
      rays.push({ x: round1(z.x), y: round1(z.y), hit: 1 });
    }
  }

  /**
   * End point of one ray: first solid obstacle (the .50 goes through thin ones, like the
   * host's traceRound), the `pierce`-th rendered zombie, or range.
   */
  _traceRay(x, y, a, w) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const above = this.pred ? this.pred.z || 0 : 0;
    let maxT = w.range;
    let tw;
    if (w.penetrate) {
      const tr = traceRound(this.world, x, y, dx, dy, w.range, w.penetrate, this.penScratch, above);
      tw = tr.wall ? tr.stop : -1;
    } else {
      tw = this.world.raycastSolid(x, y, dx, dy, maxT, above);
    }
    if (tw >= 0) maxT = tw;
    const roof = roofReach(this.world, x, y, dx, dy, tw, this.roofScratch || (this.roofScratch = { far: 0, top: 0 }));
    const farT = Math.max(maxT, Math.min(w.range, roof.far));
    const pierce = w.pierce || 1;
    const view = this.lastView;
    const zs = view ? view.zombies : null;
    // The `pierce` nearest hits, kept sorted in a small scratch list.
    const hits = this.hitScratch || (this.hitScratch = []);
    hits.length = 0;
    if (zs) {
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        const def = ZOMBIES[z.type];
        const t = rayCircle(x, y, dx, dy, z.x, z.y, def ? def.radius : 14, farT);
        if (t < 0 || (t > maxT && !(z.z >= roof.top)) || (hits.length >= pierce && t >= hits[hits.length - 1])) continue;
        let j = hits.length < pierce ? hits.length : hits.length - 1;
        while (j > 0 && hits[j - 1] > t) {
          hits[j] = hits[j - 1];
          j--;
        }
        hits[j] = t;
      }
    }
    // Same rule as the sim's fireHitscan: 'flesh' whenever a zombie was hit; the ray ends
    // at its last victim only once the pierce budget is spent, else at the wall or range.
    let endT = w.range, hit = hits.length > 0 ? 1 : 0;
    if (hits.length >= pierce) {
      endT = hits[hits.length - 1];
    } else if (tw >= 0) {
      endT = hits.length ? Math.max(tw, hits[hits.length - 1]) : tw;
      if (!hit) hit = 2;
    }
    return { x: round1(x + dx * endT), y: round1(y + dy * endT), hit };
  }

  /** Weapon state as of the acknowledged snapshot (mags, reserves, reload in progress). */
  _resetWeapon(sp) {
    const W = this.wpn;
    for (let i = 0; i < W.mag.length; i++) {
      const a = sp.ammo && sp.ammo[i];
      W.mag[i] = a ? a[0] : 0;
      W.res[i] = a ? a[1] : 0;
    }
    if (sp.slot !== this.ackSlot) {
      if (this.ackSlot >= 0) this.ackLastSlot = this.ackSlot;
      this.ackSlot = sp.slot;
    }
    W.lastSlot = this.ackLastSlot;
    // The host keeps the free pistol's mag to itself; a respawn refills it.
    if (sp.state !== this.ackState) {
      if (this.ackState === 'dead') W.freeMag = WEAPONS.pistol.mag;
      this.ackState = sp.state;
    }
    const aw = activeWeapon(sp);
    if (sp.reloading > 0 && aw.id && WEAPONS[aw.id]) {
      W.reloadTotal = this._reloadTime(aw.id);
      W.reloadLeft = Math.max(DT / 2, (1 - sp.reloading) * W.reloadTotal);
      W.reloadSlot = aw.slot;
    } else {
      W.reloadLeft = 0;
      W.reloadSlot = -1;
    }
  }

  _sendInputs(produced = 1) {
    const n = Math.max(REDUNDANT_CMDS, produced);
    const cmds = this.recent.length > n ? this.recent.slice(-n) : this.recent;
    const bytes = this.net.send('state', encodeInputs(cmds));
    this.netStats.addOut(bytes);
  }

  /** Drop the per-cmd logs of every seq ≤ `seq`. */
  _forgetBefore(seq) {
    for (const log of [this.shotLog, this.freeMagLog]) {
      for (const s of log.keys()) if (s <= seq) log.delete(s);
    }
  }

  /** The collision world's barricades as of `snap` (they block the predicted player). */
  _syncBarricades(snap) {
    const bars = this.barricadeScratch;
    bars.length = snap.barricades.length;
    for (let i = 0; i < bars.length; i++) {
      const b = snap.barricades[i];
      bars[i] = { x: b.x, y: b.y, a: b.angle };
    }
    this.world.setBarricades(bars);
  }

  _reconcile(snap) {
    const sp = snap.players.find((p) => p.id === this.localId) || null;
    this.newestLocal = sp;
    const acked = sp ? sp.lastSeq : 0;
    let n = 0;
    while (n < this.pending.length && this.pending[n].seq <= acked) n++;
    if (n) {
      this.ackFire = !!this.pending[n - 1].fire;
      this.pending.splice(0, n);
    }
    this._forgetBefore(acked);
    if (sp && sp.state === 'dead') this.ackState = 'dead';
    // (dead, or riding the campaign's zip line: the host moves the body, nothing to predict)
    if (!sp || sp.state === 'dead' || sp.ride > 0) {
      this.pred = null;
      this.offX = this.offY = 0;
      return;
    }
    const old = this.pred;
    if (old && old.state === sp.state && this.pending.length && this.pending[0].seq > acked + 1 && acked > 0) {
      // The ack is older than our oldest pending cmd: the cmds in between are no longer
      // known, so a replay would start from the wrong place. Keep predicting until the
      // acks catch up (the host is only far behind, not in disagreement).
      this._syncBarricades(snap);
      return;
    }
    const shownX = old ? old.x + this.offX : sp.x;
    const shownY = old ? old.y + this.offY : sp.y;
    const cls = (this._localEntry() || {}).cls;
    const perks = perksFor(cls);
    const p = old || {};
    p.x = sp.x;
    p.y = sp.y;
    p.state = sp.state;
    p.stamina = sp.stamina;
    p.sprinting = sp.sprinting;
    p.sprintLock = !!sp.sprintLock;
    copyVertical(p, sp);
    p.speedMult = perks.speedMult;
    p.staminaMult = perks.staminaMult;
    this.predSlot = sp.slot;
    p.moveMult = this._moveMultFor(sp.slots, sp.slot, sp.state);
    this.pred = p;
    this._resetWeapon(sp);
    // The free pistol's mag: the host's (when its snapshots carry it), else what it was
    // before the first unacknowledged cmd (else a replayed reload would refill it and
    // the shots after it would never be taken off again).
    if (typeof sp.freeMag === 'number') {
      this.wpn.freeMag = sp.freeMag;
    } else if (this.pending.length && this.freeMagLog.has(this.pending[0].seq)) {
      this.wpn.freeMag = this.freeMagLog.get(this.pending[0].seq);
    }

    this._syncBarricades(snap);
    this.wpn.prevFire = this.ackFire;
    for (const cmd of this.pending) this._step(cmd, false);
    // Keep showing the player where they were and let the error melt away.
    this.offX = shownX - p.x;
    this.offY = shownY - p.y;
    if (Math.hypot(this.offX, this.offY) > SNAP_DISTANCE) this.offX = this.offY = 0;
  }

  _overrideLocal(view) {
    const sp = this.newestLocal;
    if (!sp) return;
    const i = view.players.findIndex((p) => p.id === this.localId);
    let local;
    if (this.pred) {
      local = {
        ...sp,
        x: this.pred.x + this.offX,
        y: this.pred.y + this.offY,
        angle: this.builder.angle,
        stamina: this.pred.stamina,
        sprinting: this.pred.sprinting,
        z: this.pred.z || 0,
        zq: this.pred.zq | 0,
        vzq: this.pred.vzq | 0,
        climbT: this.pred.climbT | 0,
        climbTo: this.pred.climbTo,
        spin: this.wpn.spin,
        firing: this.clock() - this.wpn.lastFireAt <= FIRING_HOLD,
      };
      this._predictedWeapon(local, sp);
    } else {
      // Dead / spectating: position as interpolated, everything else as fresh as possible.
      const vp = i >= 0 ? view.players[i] : sp;
      local = { ...sp, x: vp.x, y: vp.y, angle: vp.angle };
    }
    if (i >= 0) view.players[i] = local;
    else view.players.push(local);
  }

  /**
   * The HUD and crosshair read the local record: give them the predicted weapon state
   * (slot, mags/reserves, reload progress) so the counter drops the instant we fire
   * instead of one round trip later. The free pistol (downed without one) adds `freeMag`.
   */
  _predictedWeapon(local, sp) {
    const W = this.wpn;
    const ammo = [];
    for (let i = 0; i < sp.slots.length; i++) ammo.push(sp.slots[i] ? [W.mag[i], W.res[i]] : [0, 0]);
    local.slot = this.predSlot;
    local.ammo = ammo;
    local.reloading = W.reloadLeft > 0 && W.reloadTotal > 0
      ? Math.min(1, Math.max(0.01, 1 - W.reloadLeft / W.reloadTotal))
      : 0;
    if (activeWeapon(local).slot < 0) local.freeMag = W.freeMag;
  }

  // ---- lifecycle -----------------------------------------------------------------------

  /**
   * The real housekeeping timer. If our own page was frozen (building the 3D world, a
   * slow frame), the host's messages from that time are still queued behind this very
   * callback, so the frozen time must not count as silence from the host.
   */
  _timerTick() {
    const now = this.clock();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > STALL_GAP) this.lastHostMsg = Math.min(now, this.lastHostMsg + gap);
    this._housekeep();
  }

  _housekeep() {
    if (this.left) return;
    const now = this.clock();
    if (now - this.lastHostMsg > (now < this.graceUntil ? START_GRACE : HOST_SILENCE)) {
      this._disconnect('Connection lost');
      return;
    }
    if (this.inGame && !this.idleSent && now - this.lastUpdateAt > STALE_INPUT) {
      // The tab stopped rendering: tell the host to stop walking/shooting for us.
      this.idleSent = true;
      this._applyCmd(quantizeInput(this.builder.idle()));
      this._sendInputs();
    }
    this.netStats.roll(now);
  }

  _sendCtl(msg) {
    if (this.left) return;
    this.netStats.addOut(this.net.send('ctl', msg));
  }

  _disconnect(reason) {
    if (this.left) return;
    const handshaking = this._welcome;
    this._shutdown();
    if (handshaking) handshaking(new Error(reason === 'Connection lost' ? 'Could not connect' : reason));
    else this.emit('disconnected', { reason });
  }

  _shutdown() {
    if (this.left) return;
    this.left = true;
    this.inGame = false;
    if (this.housekeeper) this.housekeeper.stop();
    this.housekeeper = null;
    const net = this.net;
    // Let a final 'bye' leave before the socket closes.
    setTimeout(() => net.close(), 100);
  }
}
