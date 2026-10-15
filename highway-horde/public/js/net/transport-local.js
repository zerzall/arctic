// In-memory transport: a host and any number of clients inside one JS context. Used for
// solo play (no network at all) and by the tests, which can dial in latency, jitter and
// loss on the 'state' channel to exercise prediction and interpolation.
//
// Delivery is always asynchronous, like a real network: 'ctl' messages keep their order
// and are JSON round-tripped (so non-serialisable payloads fail here, not in the field);
// 'state' buffers are copied so sender and receiver never share memory.

import { HostTransport, ClientTransport, messageBytes, toArrayBuffer } from './transport-base.js';

let hubCount = 0;

/**
 * Create a local "network" with one host.
 * @param {object} [opts]
 * @param {string|null} [opts.code] room code reported by the host transport (default null)
 * @param {number} [opts.latency] one-way delay in ms (default 0 = next microtask)
 * @param {number} [opts.jitter] extra random 0..jitter ms on 'state' messages (may reorder)
 * @param {number} [opts.loss] 0..1 chance a 'state' message is dropped
 * @param {Function} [opts.random] rng for jitter/loss (default Math.random)
 * @returns {{ host: LocalHostTransport, connect: () => Promise<LocalClientTransport> }}
 */
export function createLocalHub(opts = {}) {
  const host = new LocalHostTransport(opts);
  return {
    host,
    connect() {
      return host._accept();
    },
  };
}

class Link {
  constructor(opts) {
    this.latency = Math.max(0, opts.latency || 0);
    this.jitter = Math.max(0, opts.jitter || 0);
    this.loss = Math.min(1, Math.max(0, opts.loss || 0));
    this.random = opts.random || Math.random;
    // 'ctl' is ordered: a message never overtakes the previous one.
    this.lastCtlAt = 0;
  }

  /** Schedule `fn` as the network would deliver a message on `channel`. */
  deliver(channel, fn) {
    if (channel === 'state') {
      if (this.loss > 0 && this.random() < this.loss) return;
      const delay = this.latency + (this.jitter > 0 ? this.random() * this.jitter : 0);
      if (delay <= 0) queueMicrotask(fn);
      else setTimeout(fn, delay);
      return;
    }
    if (this.latency <= 0) {
      queueMicrotask(fn);
      return;
    }
    const at = Math.max(Date.now() + this.latency, this.lastCtlAt);
    this.lastCtlAt = at;
    setTimeout(fn, at - Date.now());
  }
}

function copyPayload(channel, data) {
  if (channel === 'ctl') return JSON.parse(JSON.stringify(data));
  const ab = toArrayBuffer(data);
  return ab ? ab.slice(0) : null;
}

export class LocalHostTransport extends HostTransport {
  constructor(opts) {
    super('local', opts.code ?? null);
    this.opts = opts;
    this.id = ++hubCount;
    this.clients = new Map();
    this.nextPeer = 1;
  }

  _accept() {
    if (this.closed) return Promise.reject(new Error('Room not found'));
    const peerId = `local-${this.id}-${this.nextPeer++}`;
    const client = new LocalClientTransport(this, peerId, this.opts);
    this.clients.set(peerId, client);
    return new Promise((resolve) => {
      queueMicrotask(() => {
        if (this.closed) {
          client._closed('Connection lost');
        } else {
          this.emit('peerjoin', peerId);
        }
        resolve(client);
      });
    });
  }

  send(peerId, channel, data) {
    const client = this.clients.get(peerId);
    if (!client || this.closed) return 0;
    const payload = copyPayload(channel, data);
    if (payload === null) return 0;
    client.down.deliver(channel, () => {
      if (!client.closed) client._deliver(channel, payload);
    });
    return messageBytes(channel, data);
  }

  broadcast(channel, data) {
    let bytes = 0;
    for (const peerId of this.clients.keys()) bytes += this.send(peerId, channel, data);
    return bytes;
  }

  disconnect(peerId) {
    const client = this.clients.get(peerId);
    if (!client) return;
    this.clients.delete(peerId);
    // The client notices after the pending messages have arrived, like a TCP close.
    client.down.deliver('ctl', () => client._closed('Connection lost'));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const peerId of [...this.clients.keys()]) this.disconnect(peerId);
  }

  /** Called by a client that goes away. */
  _clientGone(peerId) {
    if (!this.clients.delete(peerId)) return;
    queueMicrotask(() => this.emit('peerleave', peerId, 'left'));
  }
}

export class LocalClientTransport extends ClientTransport {
  constructor(host, peerId, opts) {
    super('local', host.code);
    this.host = host;
    this.peerId = peerId;
    this.up = new Link(opts);
    this.down = new Link(opts);
  }

  send(channel, data) {
    if (this.closed || this.host.closed) return 0;
    const payload = copyPayload(channel, data);
    if (payload === null) return 0;
    const host = this.host, peerId = this.peerId;
    this.up.deliver(channel, () => {
      if (host.clients.has(peerId)) host._deliver(peerId, channel, payload);
    });
    return messageBytes(channel, data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const host = this.host, peerId = this.peerId;
    // Let messages sent just before close() (e.g. 'bye') arrive first.
    this.up.deliver('ctl', () => host._clientGone(peerId));
  }
}
