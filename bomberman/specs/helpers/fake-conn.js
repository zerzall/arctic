// A transport-free connection for Room specs (docs/SPEC.md §4, §10.1): records every frame the Room sends.
//
//   const c = new FakeConn();
//   const { id } = room.join(c, { name: 'Ana' });
//   c.msgs('lobby').at(-1).players     // parsed frames of one type, in order
//
// `failSend: true` makes send() throw like a socket that died mid-write.

export class FakeConn {
  constructor({ failSend = false } = {}) {
    this.sent = [];                 // raw JSON strings, in order
    this.closed = false;
    this.closeReason = null;
    this.failSend = failSend;
    this.id = null;                 // filled in by joinN()
    this.token = null;
  }

  send(str) {
    if (this.failSend) throw new Error('socket is dead');
    this.sent.push(str);
  }

  close(reason) {
    this.closed = true;
    this.closeReason = reason ?? null;
  }

  /** Parsed frames, optionally of one `t` only. */
  msgs(type) {
    const all = this.sent.map((s) => JSON.parse(s));
    return type === undefined ? all : all.filter((m) => m.t === type);
  }

  last(type) {
    return this.msgs(type).at(-1);
  }

  /** The `t` of every frame, in order: handy for asserting message sequences. */
  types() {
    return this.sent.map((s) => JSON.parse(s).t);
  }

  clear() {
    this.sent.length = 0;
  }
}
