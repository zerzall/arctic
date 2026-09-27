// The hosting side of a session (SPEC §6.2): owns the lobby (roster, settings, chat),
// runs the authoritative Game on a real-time fixed-step clock, feeds it every player's
// inputs and broadcasts snapshots. See session.js for the message catalogue.

import {
  GAME_VERSION, PROTOCOL_VERSION, MAX_PLAYERS, DT, SNAPSHOT_EVERY, MAX_CATCHUP_TICKS, TICK_RATE,
  DEFAULT_SETTINGS, PLAYER_COLORS,
} from '../shared/constants.js';
import { encodeSnapshot, decodeInputs, messageType, MSG } from '../shared/protocol.js';
import { Game } from '../shared/sim.js';
import { Emitter } from './emitter.js';
import { createTicker } from './ticker.js';
import { CmdBuilder } from './cmd-builder.js';
import { interpolateSnapshots } from './interpolation.js';
import { NetStats } from './stats.js';
import {
  sanitizeName, uniqueName, pickColor, isColor, sanitizeClass, sanitizeChat, mergeSettings, ChatLimiter,
  botProfile, isShopItem, clientToken,
} from './lobby-rules.js';
import { IMPORTANT_EVENTS, PERISHABLE_EVENTS } from './event-rules.js';

/** Input older than this means the host is not looking (hidden tab): stand still. */
const STALE_INPUT = 0.25;
const PING_EVERY = 2;
const HELLO_TIMEOUT = 10;
/** A peer silent this long is gone even if the transport has not noticed. */
const PEER_SILENCE = 15;
/** Presentation events kept for drainEvents() when the UI is not draining (background). */
const MAX_LOCAL_EVENTS = 1000;
/** Snapshots whose IMPORTANT_EVENTS are repeated in the next ones (the `echo`). */
const ECHO_SNAPSHOTS = 2;
const FLUSH_DELAY_MS = 250;
/**
 * Control messages one peer may send (pong/bye aside): CTL_BURST at once, then CTL_RATE
 * a second. Past that they are dropped; a peer that keeps going (CTL_KICK_DROPS dropped
 * within CTL_KICK_WINDOW seconds) is disconnected.
 */
const CTL_RATE = 20;
const CTL_BURST = 40;
const CTL_KICK_DROPS = 4 * CTL_RATE;
const CTL_KICK_WINDOW = 2;
/** Roster broadcasts caused by peers' profile changes: ROSTER_BURST at once, then ROSTER_RATE/s. */
const ROSTER_RATE = 10;
const ROSTER_BURST = 5;

function wallClock() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function randomSeed() {
  const a = new Uint32Array(1);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else a[0] = Math.floor(Math.random() * 0x100000000);
  return a[0] >>> 0;
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

export class HostSession extends Emitter {
  /**
   * @param {HostTransport} net
   * @param {object} profile { name, color, cls }
   * @param {object} [hooks] test hooks: { createGame(opts), now() seconds, manual: true }
   */
  constructor(net, profile = {}, hooks = {}) {
    super();
    this.net = net;
    this.hooks = hooks;
    this.clock = hooks.now || wallClock;
    this.isHost = true;
    this.localId = 1;
    this.code = net.code || null;
    this.transport = net.kind;
    this.inviteUrl = inviteUrlFor(this.code, net.kind);
    this.roster = [{
      id: 1,
      name: sanitizeName(profile.name),
      color: isColor(profile.color) ? profile.color : 0,
      cls: sanitizeClass(profile.cls),
      ready: false,
      ping: 0,
      host: true,
    }];
    this.settings = { ...DEFAULT_SETTINGS };
    this.inGame = false;
    this.left = false;
    this.match = 0;
    this.seed = 0;

    /** transport peer id → { peerId, pid, since, lastSeen, lastSeq, chat, pingN } */
    this.peers = new Map();
    this.pidToPeer = new Map();
    this.nextPid = 2;
    this.chatLimiters = new Map([[1, new ChatLimiter()]]);

    this.game = null;
    this.builder = new CmdBuilder();
    this.t0 = null;
    this.lastUpdateAt = -Infinity;
    this.prevSnap = null;
    this.curSnap = null;
    this.netEvents = [];
    this.localEvents = [];
    this.echo = [];
    this.lastView = null;
    this.pingAt = 0;
    /** Only ping changes are waiting to be published (sent with the next ping round). */
    this.rosterDirty = false;
    /** Profile changes are waiting to be published (as soon as rosterLimiter allows). */
    this.rosterPending = false;
    this.rosterLimiter = new ChatLimiter(ROSTER_BURST, 1 / ROSTER_RATE);
    /** Keys (see _peerKeys) of kicked players: refused for the rest of the session. */
    this.banned = new Set();
    /** Host-only switch: refuse every new player. */
    this.locked = false;

    this.netStats = new NetStats();
    this.stats = this.netStats.view;

    this.ticker = null;
    this.housekeeper = null;
    if (!hooks.manual) {
      // Worker-driven so pings, timeouts and the game keep running in a background tab.
      this.housekeeper = createTicker(4, () => this._housekeep());
    }

    net.onPeerJoin((peerId) => this._onPeerJoin(peerId));
    net.onPeerLeave((peerId, reason) => {
      this._removePeer(peerId, reason === 'kicked' || reason === 'timeout' ? reason : 'left');
    });
    net.onMessage((peerId, channel, data) => this._onMessage(peerId, channel, data));
    net.onClose(() => this._onTransportLost());
  }

  // ---- public API ------------------------------------------------------------------

  setProfile(patch = {}) {
    const me = this._entry(1);
    if (me && this._applyProfile(me, patch)) this._rosterChanged();
    if (patch.ready === true && this.inGame) this.ready();
  }

  setSettings(partial) {
    if (this.inGame || this.left) return false;
    this.settings = mergeSettings(this.settings, partial);
    this._sendAll('ctl', { t: 'settings', settings: this.settings });
    this.emit('settings', this.settings);
    return true;
  }

  start() {
    if (this.inGame || this.left) return false;
    const createGame = this.hooks.createGame || ((opts) => new Game(opts));
    const s = this.settings;
    this.seed = randomSeed();
    this.match = (this.match + 1) & 0xff;
    this.game = createGame({
      mapId: s.mapId,
      seed: this.seed,
      settings: { difficulty: s.difficulty, waves: s.waves, objective: s.objective, friendlyFire: s.friendlyFire },
      players: this.roster.map((r) => ({ id: r.id, name: r.name, color: r.color, cls: r.cls, bot: !!r.bot })),
    });
    // Bots are ready by definition (the in-game ready vote is theirs to cast).
    for (const r of this.roster) r.ready = !!r.bot;
    this.builder.reset();
    this.inGame = true;
    this.t0 = this.clock();
    this.prevSnap = this.curSnap = this.lastView = null;
    this.netEvents = [];
    this.localEvents = [];
    this.echo = [];
    this.curSnap = this.game.snapshot();
    for (const ev of this.curSnap.events) this.netEvents.push(ev);
    this._pushLocalEvents(this.curSnap.events);
    this._sendAll('ctl', this._startMessage());
    this.emit('roster', this.roster);
    this.emit('start', { mapId: s.mapId, seed: this.seed, settings: { ...s } });
    if (!this.hooks.manual) this.ticker = createTicker(TICK_RATE, () => this._pump());
    return true;
  }

  returnToLobby() {
    if (!this.inGame || this.left) return false;
    this._stopGame();
    for (const r of this.roster) r.ready = !!r.bot;
    this._sendAll('ctl', { t: 'lobby' });
    this._rosterChanged();
    this.emit('lobby');
    return true;
  }

  sendChat(text) {
    this._chat(1, text);
  }

  /**
   * Host only, lobby only: fill an empty slot with an AI survivor (SPEC §6.2). Bots keep
   * their slot through repeated games until removed.
   * @returns {object|null} the new roster entry, or null (in game, room full, left)
   */
  addBot() {
    if (this.inGame || this.left || this.roster.length >= MAX_PLAYERS) return null;
    const pid = this._allocPid();
    if (!pid) return null;
    const prof = botProfile(this.roster);
    const entry = { id: pid, name: prof.name, color: prof.color, cls: prof.cls, ready: true, ping: 0, host: false, bot: true };
    this.roster.push(entry);
    this._rosterChanged();
    this._system(`${entry.name} (bot) joined the squad`);
    return entry;
  }

  /**
   * Host only, lobby only: take an AI survivor out of the room.
   * @returns {boolean} true if a bot was removed
   */
  removeBot(pid) {
    if (this.inGame || this.left) return false;
    const i = this.roster.findIndex((r) => r.id === pid && r.bot);
    if (i < 0) return false;
    const [entry] = this.roster.splice(i, 1);
    this._rosterChanged();
    this._system(`${entry.name} (bot) left the squad`);
    return true;
  }

  buy(itemId) {
    if (this.game && isShopItem(itemId)) this.game.command(1, { type: 'buy', item: itemId });
  }

  ready() {
    if (this.game) this.game.command(1, { type: 'ready' });
  }

  /**
   * Remove a player from the room (host only). Not in SPEC §6.2's list but its
   * 'disconnected' reason 'Kicked' needs a way to happen.
   */
  kick(pid) {
    const peerId = this.pidToPeer.get(pid);
    if (peerId === undefined) return false;
    // Kept out for the rest of the session (same tab, or the same name from anywhere).
    const entry = this._entry(pid);
    for (const key of this._peerKeys(this.peers.get(peerId), entry && entry.name)) this.banned.add(key);
    this.net.send(peerId, 'ctl', { t: 'kick' });
    this._removePeer(peerId, 'kicked');
    setTimeout(() => this.net.disconnect(peerId), FLUSH_DELAY_MS);
    return true;
  }

  /**
   * Host only: a locked room refuses every new player ('Room is locked'); the players in
   * it stay. Not in the original SPEC list; see §6.2.
   * @param {boolean} locked
   */
  setLocked(locked) {
    this.locked = !!locked;
    return true;
  }

  update(frameDt, input, aimAngle) {
    if (this.left) return;
    const now = this.clock();
    this.netStats.addFrame();
    this.lastUpdateAt = now;
    // Keys pressed in the lobby must not fire on the first tick of the game.
    if (this.inGame) this.builder.feed(input, aimAngle);
    // Pumping here as well as from the worker ticker keeps the sim exactly up to date at
    // render time while the tab is visible.
    this._pump();
    if (this.hooks.manual) this._housekeep();
  }

  getView() {
    if (!this.inGame || !this.curSnap) return null;
    const cur = this.curSnap, prev = this.prevSnap;
    let view;
    if (!prev || this.t0 === null || cur.tick <= prev.tick) {
      view = interpolateSnapshots(null, cur, 1);
    } else {
      // Render one tick in the past so there is always a newer tick to blend towards.
      const renderTick = (this.clock() - this.t0) / DT - 1;
      const u = Math.min(1, Math.max(0, (renderTick - prev.tick) / (cur.tick - prev.tick)));
      view = interpolateSnapshots(prev, cur, u);
    }
    this.lastView = view;
    return view;
  }

  drainEvents() {
    const out = this.localEvents;
    this.localEvents = [];
    return out;
  }

  getMap() {
    return this.game ? this.game.map : null;
  }

  getPredictedLocal() {
    const view = this.lastView || (this.curSnap ? this.getView() : null);
    const p = view && view.players.find((q) => q.id === 1);
    if (!p) return null;
    return { x: p.x, y: p.y, angle: this.builder.angle };
  }

  leave() {
    if (this.left) return;
    this.left = true;
    this._sendAll('ctl', { t: 'bye', reason: 'Host left the game' });
    this._stopGame();
    if (this.housekeeper) this.housekeeper.stop();
    this.housekeeper = null;
    // Give the goodbye a moment to leave the socket before tearing it down.
    setTimeout(() => this.net.close(), FLUSH_DELAY_MS);
  }

  // ---- simulation --------------------------------------------------------------------

  _pump() {
    const game = this.game;
    if (!game || this.left) return;
    const now = this.clock();
    if (this.t0 === null) this.t0 = now - game.tick * DT;
    let due = Math.floor((now - this.t0) / DT + 1e-9) - game.tick;
    if (due <= 0) return;
    if (due > MAX_CATCHUP_TICKS) {
      // Came back from a stall: drop the backlog instead of fast-forwarding the horde.
      this.t0 += (due - MAX_CATCHUP_TICKS) * DT;
      due = MAX_CATCHUP_TICKS;
    }
    const active = now - this.lastUpdateAt <= STALE_INPUT;
    for (let i = 0; i < due && this.game === game; i++) {
      game.setInput(1, active ? this.builder.next() : this.builder.idle());
      game.step();
      const send = game.tick % SNAPSHOT_EVERY === 0;
      // Nobody renders a hidden host tab: only snapshot when the network needs one.
      if (active || send) this._takeSnapshot(send, active);
    }
  }

  _takeSnapshot(send, active = true) {
    const snap = this.game.snapshot();
    this.prevSnap = this.curSnap;
    this.curSnap = snap;
    if (snap.events.length) {
      for (const ev of snap.events) this.netEvents.push(ev);
      this._pushLocalEvents(snap.events, active);
    }
    if (send) this._broadcastSnapshot(snap);
  }

  /**
   * Queue events for drainEvents(). While nobody is looking (hidden tab) only the ones
   * that still matter later are kept; tracers and sounds would all play in one frame.
   */
  _pushLocalEvents(events, active = true) {
    for (const ev of events) if (active || !PERISHABLE_EVENTS.has(ev.type)) this.localEvents.push(ev);
    if (this.localEvents.length > MAX_LOCAL_EVENTS) {
      this.localEvents.splice(0, this.localEvents.length - MAX_LOCAL_EVENTS);
    }
  }

  _broadcastSnapshot(snap) {
    const events = this.netEvents;
    this.netEvents = [];
    if (!this._hasPlayers()) return;
    // p2p and relay may skip a state message for a congested peer, and the p2p state
    // channel is unordered (a retransmitted snapshot arrives after its successors).
    const lossy = this.transport !== 'local';
    const msg = { ...snap, events, match: this.match, echo: lossy ? this.echo : undefined };
    const buf = encodeSnapshot(msg);
    this.netStats.addOut(this._sendAll('state', buf));
    this.netStats.addSnapshot();
    if (lossy) {
      const important = events.filter((e) => IMPORTANT_EVENTS.has(e.type));
      if (important.length) this.echo.push({ tick: snap.tick, events: important });
      // Only snapshots from the last ECHO_SNAPSHOTS sends are worth repeating.
      const oldest = snap.tick - ECHO_SNAPSHOTS * SNAPSHOT_EVERY;
      this.echo = this.echo.filter((e) => e.tick > oldest);
    }
  }

  _stopGame() {
    if (this.ticker) this.ticker.stop();
    this.ticker = null;
    this.game = null;
    this.inGame = false;
    this.prevSnap = this.curSnap = this.lastView = null;
    this.netEvents = [];
    this.localEvents = [];
    this.echo = [];
  }

  _startMessage() {
    return {
      t: 'start',
      match: this.match,
      mapId: this.settings.mapId,
      seed: this.seed,
      settings: { ...this.settings },
      roster: this.roster,
    };
  }

  // ---- peers -------------------------------------------------------------------------

  _onPeerJoin(peerId) {
    if (this.left) {
      this.net.disconnect(peerId);
      return;
    }
    const now = this.clock();
    this.peers.set(peerId, {
      peerId, pid: 0, since: now, lastSeen: now, lastSeq: 0, pingN: 0, name: '', token: null,
      limiter: new ChatLimiter(CTL_BURST, 1 / CTL_RATE), drops: 0, dropsSince: now,
    });
  }

  _onMessage(peerId, channel, data) {
    const peer = this.peers.get(peerId);
    if (!peer || this.left) return;
    peer.lastSeen = this.clock();
    if (channel === 'state') {
      this.netStats.addIn(data.byteLength || 0);
      if (peer.pid && this.game && messageType(data) === MSG.INPUTS) this._onInputs(peer, data);
      return;
    }
    if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
    this.netStats.addIn(JSON.stringify(data).length);
    if (!peer.pid) {
      if (data.t === 'hello') this._hello(peer, data);
      return;
    }
    if (data.t !== 'pong' && data.t !== 'bye' && !this._takeCtl(peer)) return;
    switch (data.t) {
      case 'profile': {
        const entry = this._entry(peer.pid);
        if (entry && this._applyProfile(entry, data, peer)) this._rosterSoon();
        if (data.ready === true && this.game) this.game.command(peer.pid, { type: 'ready' });
        break;
      }
      case 'chat':
        this._chat(peer.pid, data.text, peer);
        break;
      case 'buy':
        // Only real shop ids reach the sim (its buyfail event echoes the item back).
        if (this.game && isShopItem(data.item)) this.game.command(peer.pid, { type: 'buy', item: data.item });
        break;
      case 'ready':
        if (this.game) this.game.command(peer.pid, { type: 'ready' });
        break;
      case 'pong':
        this._pong(peer, data);
        break;
      case 'bye':
        this._removePeer(peerId, 'left');
        this.net.disconnect(peerId);
        break;
      default:
    }
  }

  /**
   * Per-peer control message budget. @returns {boolean} false = drop the message (the
   * peer may have been disconnected for flooding)
   */
  _takeCtl(peer) {
    const now = this.clock();
    if (peer.limiter.take(now)) return true;
    if (now - peer.dropsSince > CTL_KICK_WINDOW) {
      peer.drops = 0;
      peer.dropsSince = now;
    }
    if (++peer.drops > CTL_KICK_DROPS) {
      this._send(peer, { t: 'bye', reason: 'Disconnected: too many messages' });
      this._removePeer(peer.peerId, 'kicked');
      setTimeout(() => this.net.disconnect(peer.peerId), FLUSH_DELAY_MS);
    }
    return false;
  }

  _onInputs(peer, data) {
    let cmds;
    try {
      cmds = decodeInputs(data);
    } catch {
      return;
    }
    for (const cmd of cmds) {
      // Every message repeats the last few cmds; apply each one exactly once.
      if (cmd.seq <= peer.lastSeq) continue;
      peer.lastSeq = cmd.seq;
      this.game.setInput(peer.pid, cmd);
    }
  }

  _hello(peer, msg) {
    if (msg.version !== GAME_VERSION || msg.protocol !== PROTOCOL_VERSION) {
      this._reject(peer, 'Game version mismatch');
      return;
    }
    peer.name = sanitizeName(msg.name);
    peer.token = clientToken(msg.token);
    if (this._peerKeys(peer).some((k) => this.banned.has(k))) {
      this._reject(peer, 'You were kicked from this room');
      return;
    }
    if (this.locked) {
      this._reject(peer, 'Room is locked');
      return;
    }
    // A full room with bots in it makes room for a human (in the lobby or mid-game).
    if (this.roster.length >= MAX_PLAYERS) this._dropBotFor(sanitizeName(msg.name));
    const pid = this.roster.length < MAX_PLAYERS ? this._allocPid() : 0;
    if (!pid) {
      this._reject(peer, 'Room is full');
      return;
    }
    const others = this.roster;
    if (isColor(msg.color)) this._freeBotColor(msg.color, -1);
    const entry = {
      id: pid,
      name: uniqueName(sanitizeName(msg.name), others.map((r) => r.name)),
      color: pickColor(msg.color, others.map((r) => r.color)),
      cls: sanitizeClass(msg.cls),
      ready: false,
      ping: 0,
      host: false,
    };
    this.roster.push(entry);
    peer.pid = pid;
    peer.lastSeq = 0;
    this.pidToPeer.set(pid, peer.peerId);
    this.chatLimiters.set(pid, new ChatLimiter());
    this._send(peer, { t: 'welcome', id: pid, code: this.code, roster: this.roster, settings: this.settings });
    if (this.game) {
      // Late join: the newcomer starts spectating and respawns with the next wave. The
      // Game gives someone coming back under the same name what they left with (§3.1).
      this.game.addPlayer({ id: pid, name: entry.name, color: entry.color, cls: entry.cls });
      this._send(peer, this._startMessage());
    }
    this._rosterChanged();
    this._system(`${entry.name} joined the game`);
  }

  /** Remove the most recently added bot (also from a running game) so `who` can join. */
  _dropBotFor(who) {
    let i = -1;
    for (let k = this.roster.length - 1; k >= 0; k--) {
      if (this.roster[k].bot) {
        i = k;
        break;
      }
    }
    if (i < 0) return false;
    const [entry] = this.roster.splice(i, 1);
    if (this.game) this.game.removePlayer(entry.id);
    this._system(`${entry.name} (bot) left to make room for ${who}`);
    return true;
  }

  /**
   * A human wants `color` but a bot has it: the bot moves to `fallback` (the human's old
   * colour, or -1 for any free one). @returns {boolean} true if the colour is now free
   */
  _freeBotColor(color, fallback) {
    const holder = this.roster.find((r) => r.color === color);
    if (!holder || !holder.bot) return !holder;
    const taken = this.roster.map((r) => r.color);
    let next = isColor(fallback) ? fallback : -1;
    if (next < 0) next = PLAYER_COLORS.findIndex((_, c) => !taken.includes(c));
    if (next < 0) return false;
    holder.color = next;
    return true;
  }

  /**
   * Keys that recognise a returning (kicked) player: the tab's token and the names they
   * used (not the default name everyone without one gets).
   */
  _peerKeys(peer, ...moreNames) {
    if (!peer) return [];
    const keys = [];
    for (const name of [peer.name, ...moreNames]) {
      if (typeof name === 'string' && name && name !== sanitizeName(null)) keys.push(`n:${name.toLowerCase()}`);
    }
    if (peer.token) keys.push(`t:${peer.token}`);
    return keys;
  }

  _reject(peer, reason) {
    this._send(peer, { t: 'reject', reason });
    this.peers.delete(peer.peerId);
    setTimeout(() => this.net.disconnect(peer.peerId), FLUSH_DELAY_MS);
  }

  _allocPid() {
    for (let i = 0; i < 254; i++) {
      const pid = this.nextPid;
      this.nextPid = pid >= 255 ? 2 : pid + 1;
      if (!this._entry(pid)) return pid;
    }
    return 0;
  }

  _removePeer(peerId, reason) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (!peer.pid) return;
    this.pidToPeer.delete(peer.pid);
    this.chatLimiters.delete(peer.pid);
    const i = this.roster.findIndex((r) => r.id === peer.pid);
    if (i < 0) return;
    const [entry] = this.roster.splice(i, 1);
    if (this.game) this.game.removePlayer(peer.pid);
    if (this.left) return;
    this._rosterChanged();
    const what = reason === 'kicked' ? 'was kicked' : reason === 'timeout' ? 'lost connection' : 'left the game';
    this._system(`${entry.name} ${what}`);
  }

  _onTransportLost() {
    if (this.left) return;
    for (const peerId of [...this.peers.keys()]) this._removePeer(peerId, 'timeout');
    this.emit('notice', { text: 'Lost connection to the network. Friends can no longer join.' });
  }

  // ---- lobby -------------------------------------------------------------------------

  _entry(pid) {
    return this.roster.find((r) => r.id === pid) || null;
  }

  /** Apply a profile patch to a roster entry. @returns {boolean} changed */
  _applyProfile(entry, patch, peer) {
    let changed = false;
    if (typeof patch.name === 'string') {
      const others = this.roster.filter((r) => r !== entry).map((r) => r.name);
      const name = uniqueName(sanitizeName(patch.name), others);
      if (name !== entry.name) {
        entry.name = name;
        changed = true;
      }
    }
    if (isColor(patch.color) && patch.color !== entry.color) {
      // Bots give their colour up to a human (they take the human's old one).
      this._freeBotColor(patch.color, entry.color);
      if (this.roster.some((r) => r !== entry && r.color === patch.color)) {
        this._noticeTo(peer, 'That colour is already taken');
      } else {
        entry.color = patch.color;
        changed = true;
      }
    }
    if (!this.inGame && typeof patch.cls === 'string') {
      const cls = sanitizeClass(patch.cls);
      if (cls !== entry.cls) {
        entry.cls = cls;
        changed = true;
      }
    }
    if (!this.inGame && typeof patch.ready === 'boolean' && patch.ready !== entry.ready) {
      entry.ready = patch.ready;
      changed = true;
    }
    return changed;
  }

  _rosterChanged() {
    this.rosterDirty = false;
    this.rosterPending = false;
    this._sendAll('ctl', { t: 'roster', roster: this.roster });
    this.emit('roster', this.roster);
  }

  /** Publish a peer's profile change now, or soon if peers are changing it very often. */
  _rosterSoon() {
    if (this.rosterLimiter.take(this.clock())) this._rosterChanged();
    else this.rosterPending = true;
  }

  _chat(pid, text, peer) {
    const clean = sanitizeChat(text);
    if (!clean) return;
    const limiter = this.chatLimiters.get(pid);
    if (limiter && !limiter.take(this.clock())) {
      this._noticeTo(peer, 'You are sending messages too fast');
      return;
    }
    const entry = this._entry(pid);
    if (!entry) return;
    const msg = { pid, name: entry.name, text: clean, system: false };
    this._sendAll('ctl', { t: 'chat', ...msg });
    this.emit('chat', msg);
  }

  _system(text) {
    const msg = { pid: 0, name: '', text, system: true };
    this._sendAll('ctl', { t: 'chat', ...msg });
    this.emit('chat', msg);
  }

  _noticeTo(peer, text) {
    if (peer) this._send(peer, { t: 'notice', text });
    else this.emit('notice', { text });
  }

  _pong(peer, msg) {
    const now = this.clock();
    if (typeof msg.ts !== 'number' || msg.ts > now || msg.n !== peer.pingN) return;
    const entry = this._entry(peer.pid);
    if (!entry) return;
    const ping = Math.min(9999, Math.round((now - msg.ts) * 1000));
    if (ping !== entry.ping) {
      entry.ping = ping;
      this.rosterDirty = true;
    }
  }

  _housekeep() {
    if (this.left) return;
    const now = this.clock();
    // The worker keeps the game going while the tab is hidden and RAF has stopped.
    if (this.game) this._pump();
    for (const peer of [...this.peers.values()]) {
      if (!peer.pid && now - peer.since > HELLO_TIMEOUT) {
        this.peers.delete(peer.peerId);
        this.net.disconnect(peer.peerId);
      } else if (peer.pid && now - peer.lastSeen > PEER_SILENCE) {
        this._removePeer(peer.peerId, 'timeout');
        this.net.disconnect(peer.peerId);
      }
    }
    if (this.rosterPending && this.rosterLimiter.take(now)) this._rosterChanged();
    if (now - this.pingAt >= PING_EVERY) {
      this.pingAt = now;
      if (this.rosterDirty) this._rosterChanged();
      for (const peer of this.peers.values()) {
        if (!peer.pid) continue;
        peer.pingN = (peer.pingN + 1) & 0xffff;
        this._send(peer, { t: 'ping', n: peer.pingN, ts: now });
      }
    }
    this.netStats.roll(now);
  }

  // ---- sending -----------------------------------------------------------------------

  _hasPlayers() {
    return this.pidToPeer.size > 0;
  }

  _send(peer, msg) {
    this.netStats.addOut(this.net.send(peer.peerId, 'ctl', msg));
  }

  /** Send to every peer that completed the hello (not to half-open connections). */
  _sendAll(channel, data) {
    if (!this._hasPlayers()) return 0;
    let bytes = 0;
    if (this.pidToPeer.size === this.peers.size) {
      bytes = this.net.broadcast(channel, data);
    } else {
      for (const peerId of this.pidToPeer.values()) bytes += this.net.send(peerId, channel, data);
    }
    if (channel === 'ctl') this.netStats.addOut(bytes);
    return bytes;
  }
}
