// fake-link.js - a controllable network for client specs (docs/SPEC.md 10.1): latency, jitter, loss, reordering and outages between a
// ClientGame and a Room (or any stand-in for one), all driven by an injected fake clock so a spec advances "time" instantly and
// reproducibly. Nothing here touches a real timer, socket or RNG.
//
//   const clock = new FakeClock();                                                // specs/helpers/fake-clock.js; any object with now() will do
//   const link = new FakeDuplex({ clock, latency: 80, jitter: 40, raw: true,
//                                 toServer: (text) => room.receive(pid, text, conn), toClient: (msg, dueMs) => onServerMessage(msg, dueMs) });
//   const conn = { send: (text) => link.down.send(text), close() {} };            // what the Room is given; it sends JSON strings
//   const game = new ClientGame({ me, send: (obj) => link.up.send(obj), now: () => clock.now() });
//   after every clock.advance():  link.pump();
//
// Messages cross the link as JSON text, like on a WebSocket: the receiver always gets fresh objects, never the sender's references.
// `send` takes an object (serialized here) or a string that already is JSON (a Room's conn.send). The client side gets parsed objects;
// with `raw: true` the SERVER side (`up`) gets the text, which is what Room.receive takes.
// By default a link behaves like a TCP connection (in order, nothing lost); `loss` and `reorder` model the nastier cases on purpose.

import { makeRng } from '../../shared/rng.js';

/**
 * One direction of a connection.
 *  latency  one-way delay in ms          jitter   each packet gets a uniform +-jitter ms on top (never below 0 in total)
 *  loss     probability that a packet is dropped (0..1)
 *  reorder  false (default): in-order delivery, a slow packet holds the ones behind it back, as TCP does; true: packets may overtake
 *  raw      deliver the JSON text instead of the parsed object (for Room.receive, which takes strings)
 *  deliver  (message, dueMs) => void, called by pump() for every packet that is due; `dueMs` is when it would really have arrived
 */
export class FakeLink {
  constructor({ clock, deliver, latency = 40, jitter = 0, loss = 0, reorder = false, raw = false, seed = 1 }) {
    this.clock = clock;
    this.deliver = deliver;
    this.latency = latency;
    this.jitter = jitter;
    this.loss = loss;
    this.reorder = reorder;
    this.raw = raw;
    this.stats = { sent: 0, dropped: 0, delivered: 0 };
    this._rng = makeRng(seed);
    this._queue = [];
    this._order = 0;
    this._lastDue = -Infinity;
    this._blackoutUntil = -Infinity;
  }

  /** Packets sent during an outage vanish; packets already in flight still arrive (they had left the building). */
  blackout(ms) {
    this._blackoutUntil = this.clock.now() + ms;
  }

  /** Puts one message on the wire (an object, or text that already is JSON). It is delivered by a later pump(). */
  send(message) {
    const now = this.clock.now();
    this.stats.sent++;
    if (now < this._blackoutUntil || (this.loss > 0 && this._rng.next() < this.loss)) {
      this.stats.dropped++;
      return;
    }
    let due = now + Math.max(0, this.latency + (this.jitter > 0 ? (this._rng.next() * 2 - 1) * this.jitter : 0));
    if (!this.reorder) due = Math.max(due, this._lastDue);
    this._lastDue = due;
    this._queue.push({ due, order: this._order++, text: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  get inFlight() {
    return this._queue.length;
  }

  /** Delivers every packet due at `now` (default: the clock's time), earliest first. Handlers may send more packets meanwhile. */
  pump(now = this.clock.now()) {
    for (;;) {
      let next = -1;
      for (let i = 0; i < this._queue.length; i++) {
        const p = this._queue[i];
        if (p.due <= now && (next < 0 || p.due < this._queue[next].due || (p.due === this._queue[next].due && p.order < this._queue[next].order))) next = i;
      }
      if (next < 0) return;
      const [p] = this._queue.splice(next, 1);
      this.stats.delivered++;
      this.deliver(this.raw ? p.text : JSON.parse(p.text), p.due);
    }
  }
}

/** Both directions at once: `up` runs client -> server, `down` server -> client. */
export class FakeDuplex {
  constructor({ clock, toServer, toClient, latency = 40, jitter = 0, loss = 0, reorder = false, seed = 1, raw = false }) {
    const shape = { clock, latency, jitter, loss, reorder };
    this.up = new FakeLink({ ...shape, deliver: toServer, raw, seed });
    this.down = new FakeLink({ ...shape, deliver: toClient, seed: seed + 7919 });
  }

  blackout(ms) {
    this.up.blackout(ms);
    this.down.blackout(ms);
  }

  pump(now) {
    this.up.pump(now);
    this.down.pump(now);
  }
}
