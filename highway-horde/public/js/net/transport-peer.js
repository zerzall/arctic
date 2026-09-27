// Peer-to-peer transport over WebRTC data channels, using PeerJS (window.Peer from
// vendor/peerjs.min.js) for signalling. The host registers the peer id
// PEER_ID_PREFIX + code; each client opens two DataConnections to it:
//   'ctl'   reliable, ordered, JSON   (lobby/chat/buy/ping)
//   'state' unordered, raw binary     (snapshots/inputs; PeerJS 1.5 maps reliable:false
//                                      to an unordered channel)
//
// PeerJS does not reliably notice a vanished remote (a closed laptop lid never sends a
// close), so both sides exchange a small heartbeat on 'ctl' and give up after
// PEER_TIMEOUT_MS of silence. Losing the signalling server does not affect running
// connections; the host reconnects to it in the background so new friends can join.

import { PEER_ID_PREFIX } from '../shared/constants.js';
import { HostTransport, ClientTransport, messageBytes, toArrayBuffer } from './transport-base.js';
import { randomRoomCode } from './room-code.js';

/** Public STUN servers used unless HH_CONFIG.peer.config.iceServers overrides them. */
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 8000;
const OPEN_TIMEOUT_MS = 15000;
/** Host: both channels of a new client must be open within this long. */
const HANDSHAKE_MS = 20000;
/** Skip snapshots to a peer whose send buffer is this full (slow link) instead of queueing lag. */
const STATE_BUFFER_LIMIT = 256 * 1024;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT = { __hb: 1 };

function now() {
  return Date.now();
}

/**
 * PeerJS constructor options: defaults plus window.HH_CONFIG.peer overrides
 * (host, port, path, secure, key, debug, config.iceServers ...).
 * @param {object} [override] used instead of HH_CONFIG.peer when given
 * @returns {object}
 */
export function peerOptions(override) {
  const cfg = override || (globalThis.HH_CONFIG && globalThis.HH_CONFIG.peer) || {};
  const opts = { debug: 0, config: { iceServers: DEFAULT_ICE_SERVERS } };
  for (const k of ['host', 'port', 'path', 'secure', 'key', 'debug', 'pingInterval']) {
    if (cfg[k] !== undefined && cfg[k] !== null) opts[k] = cfg[k];
  }
  if (cfg.config && typeof cfg.config === 'object') opts.config = { ...opts.config, ...cfg.config };
  return opts;
}

/** Map a PeerJS error (or our own timeout) to the message the UI shows. */
export function friendlyPeerError(err) {
  const type = err && err.type;
  switch (type) {
    case 'peer-unavailable': return 'Room not found';
    case 'browser-incompatible': return 'Your browser does not support WebRTC';
    default: return 'Could not connect';
  }
}

function requirePeer() {
  const Peer = globalThis.Peer;
  if (typeof Peer !== 'function') throw new Error('Could not connect');
  return Peer;
}

function waitOpen(peer, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject({ type: 'timeout' });
    }, timeout);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onError);
    }
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

function safeClose(conn) {
  if (!conn) return;
  try {
    conn.close();
  } catch {
    // Already closed.
  }
}

function congested(conn) {
  const dc = conn.dataChannel;
  return !!dc && dc.bufferedAmount > STATE_BUFFER_LIMIT;
}

/**
 * Keeps a Peer registered with the signalling server, reconnecting with backoff.
 * PeerJS emits 'disconnected' when the websocket to the server drops.
 */
class SignallingKeeper {
  constructor(peer) {
    this.peer = peer;
    this.delay = 1000;
    this.timer = null;
    this.stopped = false;
    peer.on('disconnected', () => this.schedule());
    peer.on('open', () => {
      this.delay = 1000;
    });
  }

  schedule() {
    if (this.stopped || this.timer !== null || this.peer.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped || this.peer.destroyed || !this.peer.disconnected) return;
      try {
        this.peer.reconnect();
      } catch (err) {
        console.warn('[net] signalling reconnect failed', err);
      }
      this.delay = Math.min(RECONNECT_MAX_MS, this.delay * 2);
      // If it drops again PeerJS emits 'disconnected' and we come back here.
    }, this.delay);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Register as host under a fresh room code (retrying with a new code if the id is taken).
 * @param {object} [opts] { attempts, timeout, peer: PeerJS option overrides }
 * @returns {Promise<PeerHostTransport>}
 */
export async function createPeerHost(opts = {}) {
  const Peer = requirePeer();
  const attempts = opts.attempts || 6;
  const timeout = opts.timeout || OPEN_TIMEOUT_MS;
  for (let i = 0; i < attempts; i++) {
    const code = randomRoomCode();
    const peer = new Peer(PEER_ID_PREFIX + code, peerOptions(opts.peer));
    try {
      await waitOpen(peer, timeout);
      return new PeerHostTransport(peer, code);
    } catch (err) {
      peer.destroy();
      if (err && err.type === 'unavailable-id') continue;
      throw new Error(friendlyPeerError(err));
    }
  }
  throw new Error('Could not connect');
}

export class PeerHostTransport extends HostTransport {
  constructor(peer, code) {
    super('p2p', code);
    this.peer = peer;
    /** remote peer id → { id, ctl, state, joined, since, lastSeen, held } */
    this.remotes = new Map();
    this.keeper = new SignallingKeeper(peer);
    peer.on('connection', (conn) => this._onConnection(conn));
    peer.on('error', (err) => {
      // Signalling hiccups are retried by the keeper; nothing else is fatal for a host.
      if (!this.closed) console.warn('[net] peer error:', err && err.type, err && err.message);
    });
    peer.on('close', () => this._fail('Connection lost'));
    this.hbTimer = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
  }

  _onConnection(conn) {
    if (this.closed || (conn.label !== 'ctl' && conn.label !== 'state')) {
      safeClose(conn);
      return;
    }
    let r = this.remotes.get(conn.peer);
    if (!r) {
      r = { id: conn.peer, ctl: null, state: null, joined: false, since: now(), lastSeen: now(), held: [] };
      this.remotes.set(conn.peer, r);
    }
    if (r[conn.label] && r[conn.label] !== conn) safeClose(r[conn.label]);
    r[conn.label] = conn;
    conn.on('open', () => {
      r.lastSeen = now();
      this._maybeJoin(r);
    });
    conn.on('data', (data) => {
      if (r[conn.label] !== conn) return;
      r.lastSeen = now();
      if (conn.label === 'ctl') {
        if (data && data.__hb) return;
        if (!r.joined) r.held.push(data);
        else this._deliver(r.id, 'ctl', data);
        return;
      }
      const ab = toArrayBuffer(data);
      if (ab && r.joined) this._deliver(r.id, 'state', ab);
    });
    const drop = () => {
      if (r[conn.label] === conn) this._drop(r, 'closed');
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _maybeJoin(r) {
    if (r.joined || !r.ctl || !r.state || !r.ctl.open || !r.state.open) return;
    if (this.remotes.get(r.id) !== r) return;
    r.joined = true;
    this.emit('peerjoin', r.id);
    const held = r.held;
    r.held = [];
    for (const msg of held) this._deliver(r.id, 'ctl', msg);
  }

  _heartbeat() {
    const t = now();
    for (const r of [...this.remotes.values()]) {
      if (!r.joined) {
        if (t - r.since > HANDSHAKE_MS) this._drop(r, 'timeout');
        continue;
      }
      if (t - r.lastSeen > PEER_TIMEOUT_MS) {
        this._drop(r, 'timeout');
        continue;
      }
      if (r.ctl && r.ctl.open) {
        try {
          r.ctl.send(HEARTBEAT);
        } catch {
          // The close handler will clean up.
        }
      }
    }
  }

  _drop(r, reason) {
    if (this.remotes.get(r.id) !== r) return;
    this.remotes.delete(r.id);
    safeClose(r.ctl);
    safeClose(r.state);
    if (r.joined) this.emit('peerleave', r.id, reason);
  }

  send(peerId, channel, data) {
    const r = this.remotes.get(peerId);
    if (!r || !r.joined || this.closed) return 0;
    const conn = channel === 'ctl' ? r.ctl : r.state;
    if (!conn || !conn.open) return 0;
    if (channel === 'state' && congested(conn)) return 0;
    try {
      conn.send(data);
    } catch (err) {
      console.warn('[net] send failed', err);
      return 0;
    }
    return messageBytes(channel, data);
  }

  broadcast(channel, data) {
    let bytes = 0;
    for (const r of this.remotes.values()) if (r.joined) bytes += this.send(r.id, channel, data);
    return bytes;
  }

  disconnect(peerId) {
    const r = this.remotes.get(peerId);
    if (r) this._drop(r, 'kicked');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.hbTimer);
    this.keeper.stop();
    for (const r of this.remotes.values()) {
      safeClose(r.ctl);
      safeClose(r.state);
    }
    this.remotes.clear();
    try {
      this.peer.destroy();
    } catch {
      // Already gone.
    }
  }

  _fail(reason) {
    if (this.closed) return;
    this.close();
    this.emit('close', reason);
  }
}

/**
 * Join the room `code` as a client.
 * @param {string} code normalised room code
 * @param {object} [opts] { timeout, peer: PeerJS option overrides }
 * @returns {Promise<PeerClientTransport>} rejects Error('Room not found' | 'Could not connect' | ...)
 */
export function connectPeer(code, opts = {}) {
  let Peer;
  try {
    Peer = requirePeer();
  } catch (err) {
    return Promise.reject(err);
  }
  const timeout = opts.timeout || OPEN_TIMEOUT_MS;
  const peer = new Peer(peerOptions(opts.peer));
  const transport = new PeerClientTransport(peer, code);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.off('error', onError);
      if (err) {
        transport.close();
        reject(new Error(err));
      } else {
        transport._start();
        resolve(transport);
      }
    };
    const timer = setTimeout(() => finish('Could not connect'), timeout);
    const onError = (err) => finish(friendlyPeerError(err));
    peer.on('error', onError);
    peer.on('open', () => {
      if (done) return;
      const hostId = PEER_ID_PREFIX + code;
      const ctl = peer.connect(hostId, { label: 'ctl', reliable: true, serialization: 'json' });
      const state = peer.connect(hostId, { label: 'state', reliable: false, serialization: 'raw' });
      if (!ctl || !state) {
        finish('Could not connect');
        return;
      }
      transport._attach(ctl, state);
      const check = () => {
        if (ctl.open && state.open) finish(null);
      };
      ctl.on('open', check);
      state.on('open', check);
      ctl.on('error', () => finish('Could not connect'));
      state.on('error', () => finish('Could not connect'));
    });
  });
}

export class PeerClientTransport extends ClientTransport {
  constructor(peer, code) {
    super('p2p', code);
    this.peer = peer;
    this.ctl = null;
    this.state = null;
    this.lastSeen = now();
    this.hbTimer = null;
    this.keeper = null;
  }

  /** Wire the two connections up before they open so no early message is missed. */
  _attach(ctl, state) {
    this.ctl = ctl;
    this.state = state;
    ctl.on('data', (data) => {
      this.lastSeen = now();
      if (data && data.__hb) return;
      this._deliver('ctl', data);
    });
    state.on('data', (data) => {
      this.lastSeen = now();
      const ab = toArrayBuffer(data);
      if (ab) this._deliver('state', ab);
    });
    const lost = () => this._fail('Connection lost');
    ctl.on('close', lost);
    state.on('close', lost);
  }

  /** Called once both channels are open. */
  _start() {
    this.lastSeen = now();
    this.keeper = new SignallingKeeper(this.peer);
    this.peer.on('error', (err) => {
      if (!this.closed) console.warn('[net] peer error:', err && err.type, err && err.message);
    });
    this.hbTimer = setInterval(() => {
      if (now() - this.lastSeen > PEER_TIMEOUT_MS) {
        this._fail('Connection lost');
        return;
      }
      if (this.ctl && this.ctl.open) {
        try {
          this.ctl.send(HEARTBEAT);
        } catch {
          // The close handler reports it.
        }
      }
    }, HEARTBEAT_MS);
  }

  send(channel, data) {
    if (this.closed) return 0;
    const conn = channel === 'ctl' ? this.ctl : this.state;
    if (!conn || !conn.open) return 0;
    if (channel === 'state' && congested(conn)) return 0;
    try {
      conn.send(data);
    } catch (err) {
      console.warn('[net] send failed', err);
      return 0;
    }
    return messageBytes(channel, data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._teardown();
  }

  _teardown() {
    if (this.hbTimer !== null) clearInterval(this.hbTimer);
    this.hbTimer = null;
    if (this.keeper) this.keeper.stop();
    safeClose(this.ctl);
    safeClose(this.state);
    try {
      this.peer.destroy();
    } catch {
      // Already gone.
    }
  }

  _fail(reason) {
    if (this.closed) return;
    this._closed(reason);
    this._teardown();
  }
}
