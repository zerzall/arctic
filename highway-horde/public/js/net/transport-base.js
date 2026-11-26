// Common shape of every transport (local, p2p, relay). The session only talks to these
// two classes, so it never needs to know how the bytes travel.
//
// Channels: 'ctl'   reliable, ordered JSON objects (lobby, chat, buy, ping)
//           'state' binary ArrayBuffers (snapshots, inputs); may be unordered/lossy
//
// Host events:   'peerjoin' (peerId) · 'peerleave' (peerId, reason)
//                'message' (peerId, channel, data) · 'close' (reason)
// Client events: 'message' (channel, data) · 'close' (reason)
//
// Messages that arrive before anyone listens are held back and delivered to the first
// 'message' listener, so the session can attach its handlers after connecting.

import { Emitter } from './emitter.js';

class BufferedEmitter extends Emitter {
  constructor() {
    super();
    this._held = [];
  }

  on(event, fn) {
    super.on(event, fn);
    if (event === 'message' && this._held.length) {
      const held = this._held;
      this._held = [];
      for (const args of held) this.emit('message', ...args);
    }
    return fn;
  }

  _deliver(...args) {
    if (this.listenerCount('message') === 0) {
      if (this._held.length < 1024) this._held.push(args);
      return;
    }
    this.emit('message', ...args);
  }
}

/** Base class for the hosting side of a transport. */
export class HostTransport extends BufferedEmitter {
  /**
   * @param {string} kind 'local' | 'p2p' | 'relay'
   * @param {string|null} code room code friends type in, null when not joinable
   */
  constructor(kind, code) {
    super();
    this.kind = kind;
    this.code = code;
    this.closed = false;
  }

  /** @param {Function} fn (peerId) */
  onPeerJoin(fn) {
    return this.on('peerjoin', fn);
  }

  /** @param {Function} fn (peerId, reason) */
  onPeerLeave(fn) {
    return this.on('peerleave', fn);
  }

  /** @param {Function} fn (peerId, channel, data) */
  onMessage(fn) {
    return this.on('message', fn);
  }

  /** @param {Function} fn (reason) — the transport as a whole died */
  onClose(fn) {
    return this.on('close', fn);
  }

  /** Send to one peer. @returns {number} bytes handed to the network (0 if dropped) */
  send(peerId, channel, data) { // eslint-disable-line no-unused-vars
    return 0;
  }

  /** Send to every joined peer. @returns {number} bytes handed to the network */
  broadcast(channel, data) { // eslint-disable-line no-unused-vars
    return 0;
  }

  /** Drop one peer (kick / failed handshake). */
  disconnect(peerId) { // eslint-disable-line no-unused-vars
  }

  /** Tear everything down. */
  close() {
    this.closed = true;
  }
}

/** Base class for the joining side of a transport. */
export class ClientTransport extends BufferedEmitter {
  constructor(kind, code) {
    super();
    this.kind = kind;
    this.code = code;
    this.closed = false;
  }

  /** @param {Function} fn (channel, data) */
  onMessage(fn) {
    return this.on('message', fn);
  }

  /** @param {Function} fn (reason) */
  onClose(fn) {
    return this.on('close', fn);
  }

  /** @returns {number} bytes handed to the network (0 if dropped) */
  send(channel, data) { // eslint-disable-line no-unused-vars
    return 0;
  }

  close() {
    this.closed = true;
  }

  /** Mark closed and tell listeners once. */
  _closed(reason) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', reason);
  }
}

/** Size of a message in bytes, for bandwidth stats and limits. */
export function messageBytes(channel, data) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (channel === 'ctl') {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Copy a binary message into a standalone ArrayBuffer (typed-array views included). */
export function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return null;
}
