// WebSocket transport through our own relay server (server/relay-server.js). Everyone
// connects out to the server, so it works behind any NAT or firewall that allows the
// page itself. See the header of relay-server.js for the frame format.

import { HostTransport, ClientTransport, toArrayBuffer } from './transport-base.js';

const CH_CTL = 0;
const CH_STATE = 1;
const CONNECT_TIMEOUT_MS = 10000;
/** Skip 'state' messages while this much is still waiting in the socket (slow uplink). */
const STATE_BACKLOG_LIMIT = 256 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * WebSocket URL of the relay: HH_CONFIG.relayUrl, else /relay next to the page.
 * @returns {string|null}
 */
export function relayUrl() {
  const cfg = globalThis.HH_CONFIG;
  if (cfg && typeof cfg.relayUrl === 'string' && cfg.relayUrl) return cfg.relayUrl;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  const url = new URL('relay', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = '';
  url.hash = '';
  return url.href;
}

function channelOf(name) {
  return name === 'ctl' ? CH_CTL : CH_STATE;
}

/** Frame an app message: [channel][prefix bytes...][payload]. */
function frame(channel, data, prefixBytes, peer) {
  let payload;
  if (channel === 'ctl') {
    payload = encoder.encode(JSON.stringify(data));
  } else {
    const ab = toArrayBuffer(data);
    if (!ab) return null;
    payload = new Uint8Array(ab);
  }
  const out = new Uint8Array(1 + prefixBytes + payload.length);
  out[0] = channelOf(channel);
  if (prefixBytes === 2) {
    out[1] = peer & 0xff;
    out[2] = (peer >> 8) & 0xff;
  }
  out.set(payload, 1 + prefixBytes);
  return out;
}

/** Parse the payload part of an incoming frame. @returns {[string, any]|null} */
function unframe(bytes, offset) {
  const channel = bytes[0] === CH_CTL ? 'ctl' : bytes[0] === CH_STATE ? 'state' : null;
  if (!channel) return null;
  if (channel === 'ctl') {
    try {
      return ['ctl', JSON.parse(decoder.decode(bytes.subarray(offset)))];
    } catch {
      return null;
    }
  }
  return ['state', bytes.slice(offset).buffer];
}

/**
 * Open a socket and run the create/join handshake.
 * @returns {Promise<{ ws: WebSocket, reply: object }>}
 */
function handshake(url, request, expect, timeout) {
  return new Promise((resolve, reject) => {
    if (!url || typeof WebSocket === 'undefined') {
      reject(new Error('Could not connect'));
      return;
    }
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      reject(new Error('Could not connect'));
      return;
    }
    ws.binaryType = 'arraybuffer';
    let done = false;
    const finish = (err, reply) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      if (err) {
        try {
          ws.close();
        } catch {
          // Never opened.
        }
        reject(new Error(err));
      } else {
        resolve({ ws, reply });
      }
    };
    const timer = setTimeout(() => finish('Could not connect'), timeout);
    ws.onopen = () => ws.send(JSON.stringify(request));
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === expect) finish(null, msg);
      else if (msg.t === 'error') finish(typeof msg.msg === 'string' ? msg.msg : 'Could not connect');
    };
    ws.onerror = () => finish('Could not connect');
    ws.onclose = () => finish('Could not connect');
  });
}

/**
 * Create a room on the relay.
 * @param {object} [opts] { url, timeout }
 * @returns {Promise<RelayHostTransport>}
 */
export async function createRelayHost(opts = {}) {
  const { ws, reply } = await handshake(opts.url || relayUrl(), { t: 'create' }, 'created',
    opts.timeout || CONNECT_TIMEOUT_MS);
  return new RelayHostTransport(ws, reply.code);
}

/**
 * Join room `code` on the relay.
 * @param {string} code
 * @param {object} [opts] { url, timeout }
 * @returns {Promise<RelayClientTransport>} rejects Error('Room not found' | 'Room is full' | 'Could not connect')
 */
export async function connectRelay(code, opts = {}) {
  const { ws, reply } = await handshake(opts.url || relayUrl(), { t: 'join', code }, 'joined',
    opts.timeout || CONNECT_TIMEOUT_MS);
  return new RelayClientTransport(ws, reply.code);
}

export class RelayHostTransport extends HostTransport {
  constructor(ws, code) {
    super('relay', code);
    this.ws = ws;
    this.peers = new Set();
    ws.onmessage = (e) => this._onMessage(e.data);
    ws.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      for (const peer of this.peers) this.emit('peerleave', peer, 'closed');
      this.peers.clear();
      this.emit('close', 'Connection lost');
    };
    ws.onerror = () => {
      // onclose follows.
    };
  }

  _onMessage(data) {
    if (typeof data === 'string') {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.t === 'peer-join' && Number.isInteger(msg.peer)) {
        this.peers.add(msg.peer);
        this.emit('peerjoin', msg.peer);
      } else if (msg.t === 'peer-leave' && this.peers.delete(msg.peer)) {
        this.emit('peerleave', msg.peer, msg.reason || 'left');
      }
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes.length < 3) return;
    const peer = bytes[1] | (bytes[2] << 8);
    if (!this.peers.has(peer)) return;
    const msg = unframe(bytes, 3);
    if (msg) this._deliver(peer, msg[0], msg[1]);
  }

  _sendFrame(channel, data, peer) {
    const ws = this.ws;
    if (this.closed || ws.readyState !== 1) return 0;
    if (channel === 'state' && ws.bufferedAmount > STATE_BACKLOG_LIMIT) return 0;
    const out = frame(channel, data, 2, peer);
    if (!out) return 0;
    ws.send(out);
    return out.length;
  }

  send(peerId, channel, data) {
    if (!this.peers.has(peerId)) return 0;
    return this._sendFrame(channel, data, peerId);
  }

  broadcast(channel, data) {
    // One frame; the server fans it out, which saves the host's upload bandwidth.
    if (this.peers.size === 0) return 0;
    return this._sendFrame(channel, data, 0);
  }

  disconnect(peerId) {
    if (!this.peers.delete(peerId)) return;
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'kick', peer: peerId }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.peers.clear();
    try {
      this.ws.close(1000, 'Bye');
    } catch {
      // Already closed.
    }
  }
}

export class RelayClientTransport extends ClientTransport {
  constructor(ws, code) {
    super('relay', code);
    this.ws = ws;
    this.closeReason = null;
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === 'closed' && typeof msg.reason === 'string') this.closeReason = msg.reason;
        } catch {
          // Ignore malformed control frames.
        }
        return;
      }
      const bytes = new Uint8Array(e.data);
      if (bytes.length < 1) return;
      const msg = unframe(bytes, 1);
      if (msg) this._deliver(msg[0], msg[1]);
    };
    ws.onclose = () => this._closed(this.closeReason || 'Connection lost');
    ws.onerror = () => {
      // onclose follows.
    };
  }

  send(channel, data) {
    const ws = this.ws;
    if (this.closed || ws.readyState !== 1) return 0;
    if (channel === 'state' && ws.bufferedAmount > STATE_BACKLOG_LIMIT) return 0;
    const out = frame(channel, data, 0, 0);
    if (!out) return 0;
    ws.send(out);
    return out.length;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(1000, 'Bye');
    } catch {
      // Already closed.
    }
  }
}
