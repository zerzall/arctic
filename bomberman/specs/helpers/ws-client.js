// A small promise-based WebSocket test client (docs/SPEC.md §10.1) for the integration specs. Real `ws` sockets, JSON frames.
//
//   const a = await WsClient.create(app.port, 'Mom');          // create a room, wait for `joined`
//   const b = await WsClient.join(app.port, a.code, 'Dad');    // join it
//   await a.next('lobby', (m) => m.players.length === 2);      // first unread frame of that type (and predicate)
//   a.send({ t: 'chat', text: 'hi' });
//   const { code } = await a.closed;                           // close code and reason
//
// `next()` removes the frame it returns from the inbox and leaves the others, so a spec can wait for `roundEnd` while
// hundreds of `snap` frames pile up, and still read them later through `frames`.

import { WebSocket } from 'ws';

const DEFAULT_TIMEOUT = 5000;

export class WsClient {
  constructor(ws) {
    this.ws = ws;
    this.frames = [];               // every frame ever received: { msg, bytes }
    this.inbox = [];                // frames not yet consumed by next()
    this.closeInfo = null;
    this._waiters = new Set();
    this.closed = new Promise((resolve) => {
      ws.on('close', (code, reason) => {
        this.closeInfo = { code, reason: reason.toString() };
        this._wake();
        resolve(this.closeInfo);
      });
    });
    ws.on('error', () => {});
    ws.on('message', (data) => {
      const text = data.toString();
      const frame = { msg: JSON.parse(text), bytes: Buffer.byteLength(text) };
      this.frames.push(frame);
      this.inbox.push(frame);
      this._wake();
    });
  }

  /** Opens a socket; rejects with `.status` when the upgrade is refused (403, 429, 503 ...). */
  static connect(port, { path = '/ws', headers = {}, origin, autoPong = true } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, origin, autoPong });
      ws.once('open', () => resolve(new WsClient(ws)));
      ws.once('error', reject);
      ws.once('unexpected-response', (req, res) => {
        res.resume();
        reject(Object.assign(new Error(`upgrade refused: HTTP ${res.statusCode}`), { status: res.statusCode }));
      });
    });
  }

  /** Connects, sends `create`, resolves after `joined` with .id .token .code .joined set. */
  static async create(port, name, { color, connect = {} } = {}) {
    const c = await WsClient.connect(port, connect);
    c.send({ t: 'create', v: 1, name, ...(color === undefined ? {} : { color }) });
    return c.expectJoined();
  }

  static async join(port, code, name, { token, color, connect = {} } = {}) {
    const c = await WsClient.connect(port, connect);
    c.send({ t: 'join', v: 1, code, name, ...(token === undefined ? {} : { token }), ...(color === undefined ? {} : { color }) });
    return c.expectJoined();
  }

  async expectJoined() {
    const first = await this.next((m) => m.t === 'joined' || m.t === 'error');
    if (first.t === 'error') throw Object.assign(new Error(`join refused: ${first.code}`), { code: first.code });
    Object.assign(this, { joined: first, id: first.id, token: first.token, code: first.code });
    return this;
  }

  send(obj) {
    this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  /** The first unread frame that is of type `match` (a string) or satisfies it (a function), optionally also `where(msg)`. */
  next(match, where = () => true, timeout = DEFAULT_TIMEOUT) {
    const test = typeof match === 'function' ? match : (m) => m.t === match && where(m);
    const describe = typeof match === 'function' ? 'a matching frame' : `a "${match}" frame`;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const at = this.inbox.findIndex((f) => test(f.msg));
        if (at >= 0) {
          resolve(this.inbox.splice(at, 1)[0].msg);
          return true;
        }
        if (this.closeInfo) {
          reject(new Error(`socket closed (${this.closeInfo.code}) while waiting for ${describe}; unread: ${this._summary()}`));
          return true;
        }
        return false;
      };
      if (attempt()) return;
      const waiter = () => { if (attempt()) { clearTimeout(timer); this._waiters.delete(waiter); } };
      const timer = setTimeout(() => {
        this._waiters.delete(waiter);
        reject(new Error(`timed out waiting for ${describe}; unread: ${this._summary()}`));
      }, timeout);
      this._waiters.add(waiter);
    });
  }

  /** Removes and returns every unread frame of one type (or all of them). */
  take(type) {
    const taken = this.inbox.filter((f) => type === undefined || f.msg.t === type);
    this.inbox = this.inbox.filter((f) => !taken.includes(f));
    return taken.map((f) => f.msg);
  }

  /** All frames received so far of one type. */
  all(type) {
    return this.frames.filter((f) => f.msg.t === type).map((f) => f.msg);
  }

  close() {
    this.ws.close();
    return this.closed;
  }

  /** Abrupt drop, like a phone losing signal: no close handshake. */
  drop() {
    this.ws.terminate();
    return this.closed;
  }

  _wake() {
    for (const waiter of [...this._waiters]) waiter();
  }

  _summary() {
    const counts = {};
    for (const f of this.inbox) counts[f.msg.t] = (counts[f.msg.t] ?? 0) + 1;
    return JSON.stringify(counts);
  }
}

/** Resolves after `ms` (specs use it only where absence must be proven, and keep it short). */
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns a truthy value (returns it) or `timeout` passes. */
export async function eventually(fn, { timeout = DEFAULT_TIMEOUT, every = 10, label = 'condition' } = {}) {
  const start = performance.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (performance.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await delay(every);
  }
}
