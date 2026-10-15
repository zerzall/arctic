import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketConnection, LoopbackConnection, wsUrl } from '../../client/js/net.js';
import { FakeClock } from '../helpers/fake-clock.js';

// ==================================================================================================
// Test doubles: a WebSocket the test drives by hand, a document/window that can fire events, and a clock with timers.
// ==================================================================================================

class FakeSocket {
  constructor(url, log) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closedWith = null;
    log.push(this);
  }

  send(text) {
    if (this.readyState !== 1) throw new Error('InvalidStateError');
    this.sent.push(JSON.parse(text));
  }

  close(code, reason) {
    this.closedWith = { code, reason };
    this.readyState = 3;                                     // a real one fires `close` a little later; a test can do that with serverClose()
  }

  // --- what the network does
  serverOpen() { this.readyState = 1; this.onopen?.(); }
  serverSend(obj) { this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

class FakeTarget {
  constructor() { this.handlers = new Map(); }
  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== fn)); }
  fire(type, ev = {}) { for (const fn of this.handlers.get(type) ?? []) fn(ev); }
  count() { return [...this.handlers.values()].reduce((n, l) => n + l.length, 0); }
}

/** A WebSocketConnection wired to fakes. `sockets` lists every socket it created, oldest first. */
function rig({ hidden = false, throwOnConnect = false } = {}) {
  const clock = new FakeClock(1000);
  const sockets = [];
  const doc = Object.assign(new FakeTarget(), { hidden });
  const win = new FakeTarget();
  const fetched = [];
  const log = { opens: 0, messages: [], closes: [], statuses: [] };
  const conn = new WebSocketConnection('ws://host/ws', {
    WebSocket: function FakeWebSocket(url) { if (throwOnConnect) throw new SyntaxError('bad url'); return new FakeSocket(url, sockets); },
    now: () => clock.now(), setTimer: (fn, ms) => clock.setTimer(fn, ms), clearTimer: (h) => clock.clearTimer(h),
    document: doc, window: win, fetch: (url, init) => { fetched.push([url, init]); return Promise.resolve(); },
  });
  conn.onopen = () => { log.opens++; };
  conn.onmessage = (m) => log.messages.push(m);
  conn.onclose = (i) => log.closes.push(i);
  conn.onstatus = (s) => log.statuses.push({ ...s, at: clock.now() });
  return { clock, sockets, doc, win, conn, fetched, log, last: () => sockets[sockets.length - 1] };
}

const seconds = (n) => n * 1000;

// ==================================================================================================
// wsUrl
// ==================================================================================================

test('wsUrl: ws on http, wss on https, host and port kept', () => {
  assert.equal(wsUrl({ protocol: 'http:', host: 'localhost:3000' }), 'ws://localhost:3000/ws');
  assert.equal(wsUrl({ protocol: 'https:', host: 'blast-party.onrender.com' }), 'wss://blast-party.onrender.com/ws');
  assert.equal(wsUrl({ protocol: 'http:', host: '192.168.1.20:3000' }), 'ws://192.168.1.20:3000/ws');
});

// ==================================================================================================
// WebSocketConnection
// ==================================================================================================

test('open, send and receive: JSON both ways, junk ignored, send() says whether it went out', () => {
  const r = rig();
  assert.equal(r.conn.readyState, 0);
  assert.equal(r.conn.send({ t: 'x' }), false, 'nothing goes out before the socket is open');
  assert.equal(r.sockets.length, 1);
  assert.equal(r.last().url, 'ws://host/ws');
  r.last().serverOpen();
  assert.deepEqual([r.conn.readyState, r.log.opens], [1, 1]);
  assert.equal(r.conn.send({ t: 'create', v: 1, name: 'Ann' }), true);
  assert.deepEqual(r.last().sent, [{ t: 'create', v: 1, name: 'Ann' }]);
  r.last().serverSend({ t: 'joined', id: 3 });
  assert.equal(r.conn.send({ t: 'in', c: [[1, 0, 0, 0]] }), true);
  r.last().serverSend('not json');
  r.last().serverSend('42');
  r.last().serverSend('null');
  r.last().onmessage({ data: new ArrayBuffer(4) });
  assert.deepEqual(r.log.messages, [{ t: 'joined', id: 3 }]);
  r.last().readyState = 3;
  assert.equal(r.conn.send({ t: 'in' }), false, 'a socket that refuses is a false, not an exception');
});

test('before `joined` arrives on a socket only create / join / ping go out, so a stale cmd can never overtake the new numbering', () => {
  const r = rig();
  r.last().serverOpen();
  assert.equal(r.conn.send({ t: 'in', c: [[400, 2, 0, 0]] }), false);
  assert.equal(r.conn.send({ t: 'chat', text: 'hi' }), false);
  assert.equal(r.conn.send({ t: 'join', v: 1, code: 'KQXZ', token: 'abc', name: 'Ann' }), true);
  assert.equal(r.conn.send({ t: 'ping', ts: 1 }), true);
  assert.deepEqual(r.last().sent.map((m) => m.t), ['join', 'ping']);
  r.last().serverSend({ t: 'joined', id: 1, seq: 12 });
  assert.equal(r.conn.send({ t: 'in', c: [[13, 2, 0, 0]] }), true);
  r.last().serverClose(1006);                                // the link drops, the game keeps producing cmds 14.. meanwhile
  r.clock.advance(500);
  r.last().serverOpen();
  assert.equal(r.conn.send({ t: 'in', c: [[300, 2, 0, 0]] }), false, 'the new socket has not been told where the numbering stands yet');
  r.conn.send({ t: 'join', v: 1, code: 'KQXZ', token: 'abc', name: 'Ann' });
  r.last().serverSend({ t: 'joined', id: 1, seq: 13 });
  assert.equal(r.conn.send({ t: 'in', c: [[14, 2, 0, 0]] }), true);
  assert.deepEqual(r.last().sent.filter((m) => m.t === 'in').map((m) => m.c[0][0]), [14]);
});

test('first ping comes with the heartbeat (after the hello), then every 2 s, carrying the client clock', () => {
  const r = rig();
  r.last().serverOpen();
  r.conn.send({ t: 'create' });
  assert.equal(r.last().sent.filter((m) => m.t === 'ping').length, 0);
  r.clock.advance(seconds(1));
  r.last().serverSend({ t: 'pong', ts: 0 });
  const pings = () => r.last().sent.filter((m) => m.t === 'ping');
  assert.equal(pings().length, 1);
  assert.equal(pings()[0].ts, r.clock.now());
  r.clock.advance(seconds(1));
  r.last().serverSend({ t: 'pong' });
  assert.equal(pings().length, 1, 'not more often than every 2 s');
  r.clock.advance(seconds(1));
  assert.equal(pings().length, 2);
  r.doc.hidden = true;
  r.clock.advance(seconds(6));
  assert.equal(pings().length, 2, 'no pings from a hidden tab');
});

test('connect timeout: an attempt that never opens is closed after 8 s and retried', () => {
  const r = rig();
  r.clock.advance(seconds(7.9));
  assert.equal(r.sockets.length, 1);
  r.clock.advance(200);
  assert.equal(r.sockets.length, 1, 'the wait for the retry has started');
  assert.equal(r.sockets[0].closedWith !== null, true, 'ws.close() was called on the stuck socket');
  assert.equal(r.conn.readyState, 0);
  r.clock.advance(500);
  assert.equal(r.sockets.length, 2);
  r.sockets[0].serverOpen();                                 // the abandoned socket waking up late changes nothing
  assert.equal(r.conn.readyState, 0);
  assert.equal(r.log.opens, 0);
});

test('backoff between attempts: 0.5, 1, 2, 3, 3, 3 s', () => {
  const r = rig();
  const startedAt = [r.clock.now()];
  for (let i = 0; i < 6; i++) {
    r.last().serverClose(1006);
    const before = r.sockets.length;
    const t0 = r.clock.now();
    while (r.sockets.length === before) r.clock.advance(50);
    startedAt.push(r.clock.now());
    assert.ok(r.clock.now() - t0 >= 0);
  }
  const gaps = startedAt.slice(1).map((t, i) => Math.round((t - startedAt[i]) / 50) * 50);
  assert.deepEqual(gaps, [500, 1000, 2000, 3000, 3000, 3000]);
});

test('give-up budgets: 120 s when never joined, 60 s after a join, 120 s again after the server said closed / 1012', () => {
  const runOut = (r) => {
    const t0 = r.clock.now();
    while (r.log.closes.length === 0 && r.clock.now() - t0 < seconds(400)) {
      const s = r.last();
      if (s.readyState === 0) s.serverClose(1006);
      r.clock.advance(100);
    }
    return r.clock.now() - t0;
  };

  const fresh = rig();
  const freshMs = runOut(fresh);
  assert.ok(freshMs >= seconds(115) && freshMs <= seconds(125), `never joined: ${freshMs} ms`);
  assert.equal(fresh.log.closes[0].gaveUp, true);
  assert.equal(fresh.conn.readyState, 3);
  assert.equal(fresh.log.statuses.at(-1).kind, 'failed');

  const joined = rig();
  joined.last().serverOpen();
  joined.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  joined.last().serverClose(1006);
  const joinedMs = runOut(joined);
  assert.ok(joinedMs >= seconds(55) && joinedMs <= seconds(65), `after a join: ${joinedMs} ms`);

  const restart = rig();
  restart.last().serverOpen();
  restart.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  restart.last().serverClose(1012);
  const restartMs = runOut(restart);
  assert.ok(restartMs >= seconds(115) && restartMs <= seconds(125), `after 1012: ${restartMs} ms`);

  const said = rig();
  said.last().serverOpen();
  said.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  said.last().serverSend({ t: 'error', code: 'closed', msg: 'Server restarting' });
  said.last().serverClose(1000);
  assert.ok(runOut(said) >= seconds(115));
});

test('after a give-up retry() starts over with a full budget; otherwise it does nothing', () => {
  const r = rig();
  assert.equal(r.conn.retry(), false);
  while (r.log.closes.length === 0) { if (r.last().readyState === 0) r.last().serverClose(1006); r.clock.advance(100); }
  const before = r.sockets.length;
  assert.equal(r.conn.retry(), true);
  assert.equal(r.sockets.length, before + 1);
  assert.equal(r.conn.readyState, 0);
  r.last().serverOpen();
  assert.equal(r.conn.readyState, 1);
  assert.equal(r.log.opens, 1);
});

test('onopen fires for every successful (re)connect, so main.js can send the token join each time', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 4 });
  r.last().serverClose(1006);
  assert.equal(r.conn.readyState, 0);
  r.clock.advance(500);
  assert.equal(r.sockets.length, 2);
  r.last().serverOpen();
  assert.deepEqual([r.log.opens, r.conn.readyState], [2, 1]);
  assert.deepEqual(r.log.closes, [], 'onclose is for the end only');
});

test('status: connecting, then waking after 3 s, reconnecting once a room was joined, seconds left counting down', () => {
  const r = rig();
  assert.deepEqual(r.conn.status, { kind: 'connecting', waking: false, elapsedMs: 0, secondsLeft: 120, attempt: 0 }, 'readable from the start: the constructor fires onstatus before anyone could listen');
  r.clock.advance(seconds(2));
  assert.equal(r.log.statuses.at(-1).waking, false);
  r.clock.advance(seconds(1.5));
  const s = r.log.statuses.at(-1);
  assert.deepEqual([s.kind, s.waking], ['connecting', true]);
  assert.ok(s.elapsedMs >= 3000 && s.secondsLeft <= 117);
  r.last().serverOpen();
  assert.deepEqual([r.log.statuses.at(-1).kind, r.log.statuses.at(-1).waking], ['open', false]);
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.last().serverClose(1006);
  r.clock.advance(seconds(2));
  const re = r.conn.status;
  assert.deepEqual([re.kind, re.waking, re.secondsLeft], ['reconnecting', false, 58]);
  r.clock.advance(seconds(3));
  assert.equal(r.conn.status.waking, true);
  assert.equal(r.log.statuses.at(-1).waking, true, 'and the heartbeat keeps onstatus fresh for the elapsed-seconds counter');
});

test('liveness: 8 s without any frame kills the link and reconnects; any frame at all keeps it alive', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  for (let i = 0; i < 20; i++) { r.clock.advance(seconds(1)); r.last().serverSend({ t: 'lobby' }); }
  assert.equal(r.sockets.length, 1, 'chatty link stays');
  const first = r.last();
  r.clock.advance(seconds(7.5));
  assert.equal(r.sockets.length, 1);
  r.clock.advance(seconds(1.6));                             // (the 1 s heartbeat notices between 8 and 9 s of silence)
  assert.equal(first.closedWith !== null, true, 'the silent socket was closed');
  assert.equal(r.conn.readyState, 0);
  r.clock.advance(500);
  assert.equal(r.sockets.length, 2);
});

test('liveness: not checked while hidden; the clock restarts when the tab comes back', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.doc.hidden = true;
  r.clock.advance(seconds(60));
  assert.equal(r.sockets.length, 1);
  assert.equal(r.conn.readyState, 1);
  r.conn.checkLiveness();
  assert.equal(r.conn.readyState, 1, 'the rAF hook does nothing while hidden either');
  r.doc.hidden = false;
  r.doc.fire('visibilitychange');
  r.clock.advance(seconds(2.4));
  assert.equal(r.conn.readyState, 1, 'a ping went out and 2.5 s to answer it are not up yet');
  r.last().serverSend({ t: 'pong', ts: 0 });
  r.clock.advance(seconds(7));
  assert.equal(r.conn.readyState, 1, 'the pong (any frame) restarted the silence clock');
});

test('resume: an open link is pinged and dropped if no pong comes within 2.5 s', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.clock.advance(seconds(3));
  r.last().serverSend({ t: 'pong' });
  const sock = r.last();
  const pings = () => sock.sent.filter((m) => m.t === 'ping').length;
  const before = pings();
  r.conn.resume();
  assert.equal(pings(), before + 1);
  r.clock.advance(2400);
  assert.equal(r.conn.readyState, 1);
  sock.serverSend({ t: 'pong', ts: 1 });
  r.clock.advance(seconds(1));
  assert.equal(r.conn.readyState, 1, 'answered in time');

  const dead = rig();
  dead.last().serverOpen();
  dead.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  dead.conn.resume();
  dead.clock.advance(2400);
  assert.equal(dead.conn.readyState, 1);
  dead.clock.advance(200);
  assert.equal(dead.conn.readyState, 0, 'no pong: the socket is a zombie (a phone that slept)');
  dead.clock.advance(500);
  assert.equal(dead.sockets.length, 2);
});

test('resume: a link that is down reconnects immediately with a fresh backoff and budget', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.last().serverClose(1006);
  for (let i = 0; i < 4; i++) { r.clock.advance(seconds(4)); if (r.last().readyState === 0) r.last().serverClose(1006); }
  const n = r.sockets.length;
  r.win.fire('online');
  assert.equal(r.sockets.length, n + 1, 'no waiting for the backoff timer');
  assert.equal(r.log.statuses.at(-1).secondsLeft, 60);
  r.last().serverClose(1006);
  r.clock.advance(500);
  assert.equal(r.sockets.length, n + 2, 'and the next backoff starts from 0.5 s again');
});

test('browser events: visible and online resume; pageshow only when restored from the back-forward cache', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.last().serverClose(1006);
  const n = r.sockets.length;
  r.win.fire('pageshow', { persisted: false });
  assert.equal(r.sockets.length, n, 'the initial pageshow is not a resume');
  r.doc.hidden = true;
  r.doc.fire('visibilitychange');
  assert.equal(r.sockets.length, n, 'hiding is not a resume');
  r.doc.hidden = false;
  r.doc.fire('visibilitychange');
  assert.equal(r.sockets.length, n + 1);
  r.last().serverClose(1006);
  r.win.fire('pageshow', { persisted: true });
  assert.equal(r.sockets.length, n + 2);
});

test('final server verdicts: an error before `joined`, `kicked` and close 4001 end the connection without a reconnect', () => {
  for (const code of ['no_room', 'full', 'locked', 'version', 'busy', 'kicked', 'rate_limited', 'bad_msg']) {
    const r = rig();
    r.last().serverOpen();
    r.last().serverSend({ t: 'error', code, msg: 'x' });
    assert.deepEqual(r.log.messages, [{ t: 'error', code, msg: 'x' }], `${code}: the message is delivered first`);
    assert.equal(r.log.closes.length, 1, code);
    assert.deepEqual([r.log.closes[0].fatal, r.log.closes[0].reason, r.log.closes[0].gaveUp], [true, code, false]);
    assert.equal(r.conn.readyState, 3);
    r.last().serverClose(1000);
    r.clock.advance(seconds(30));
    assert.equal(r.sockets.length, 1, `${code}: no reconnect`);
    assert.equal(r.log.closes.length, 1);
  }
  const kicked = rig();
  kicked.last().serverOpen();
  kicked.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  kicked.last().serverSend({ t: 'kicked' });
  assert.deepEqual([kicked.log.closes[0].fatal, kicked.log.closes[0].reason], [true, 'kicked']);
  kicked.clock.advance(seconds(30));
  assert.equal(kicked.sockets.length, 1);

  const replaced = rig();
  replaced.last().serverOpen();
  replaced.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  replaced.last().serverClose(4001);
  assert.deepEqual([replaced.log.closes[0].fatal, replaced.log.closes[0].replaced], [true, true]);
  replaced.clock.advance(seconds(30));
  assert.equal(replaced.sockets.length, 1, 'reconnecting would start a tug of war with the other tab');
});

test('after `joined` an error is just a message; `closed` keeps the connection retrying', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  r.last().serverSend({ t: 'error', code: 'rate_limited', msg: 'slow down' });
  r.last().serverSend({ t: 'error', code: 'not_host', msg: 'nope' });
  assert.equal(r.log.closes.length, 0);
  assert.equal(r.conn.readyState, 1);
  r.last().serverSend({ t: 'error', code: 'closed', msg: 'Server restarting' });
  assert.equal(r.log.closes.length, 0);
  r.last().serverClose(1012);
  r.clock.advance(500);
  assert.equal(r.sockets.length, 2);
  r.last().serverOpen();
  r.last().serverSend({ t: 'error', code: 'no_room', msg: 'gone' });
  assert.equal(r.log.closes[0].reason, 'no_room', 'the rejoin found nothing: that is final');
});

test('a socket abandoned by the connection can no longer speak', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  const old = r.last();
  r.clock.advance(seconds(9));                               // silent: dropped
  r.clock.advance(500);
  const fresh = r.last();
  assert.notEqual(old, fresh);
  fresh.serverOpen();
  const seen = r.log.messages.length;
  old.onmessage?.({ data: JSON.stringify({ t: 'chat' }) });
  old.onclose?.({ code: 4001 });
  assert.equal(r.log.messages.length, seen);
  assert.equal(r.log.closes.length, 0);
  assert.equal(r.conn.readyState, 1);
});

test('close(): the socket is closed politely, onclose says byUser, nothing reconnects, listeners and timers are gone', () => {
  const r = rig();
  r.last().serverOpen();
  r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  assert.ok(r.doc.count() > 0 && r.win.count() > 0);
  r.conn.close();
  assert.deepEqual(r.last().closedWith, { code: 1000, reason: 'left' });
  assert.deepEqual([r.log.closes.length, r.log.closes[0].byUser, r.conn.readyState], [1, true, 3]);
  assert.equal(r.conn.send({ t: 'x' }), false);
  r.conn.close();
  assert.equal(r.log.closes.length, 1);
  r.clock.advance(seconds(600));
  assert.equal(r.sockets.length, 1);
  assert.equal(r.clock.pending, 0, 'no timer survives');
  assert.deepEqual([r.doc.count(), r.win.count()], [0, 0]);
  assert.equal(r.fetched.length, 0);
});

test('keep-warm: once joined, /healthz is fetched every 4 minutes; never before', () => {
  const r = rig();
  r.last().serverOpen();
  r.clock.advance(seconds(500));
  assert.equal(r.fetched.length, 0, 'not in a room yet');
  r.conn.close();
  const j = rig();
  j.last().serverOpen();
  j.last().serverSend({ t: 'joined', id: 1, seq: 0 });
  for (let i = 0; i < 500; i++) { j.clock.advance(seconds(1)); j.last().serverSend({ t: 'lobby' }); }
  assert.equal(j.fetched.length, 2);
  assert.deepEqual(j.fetched[0], ['/healthz', { cache: 'no-store' }]);
  j.conn.close();
  j.clock.advance(seconds(600));
  assert.equal(j.fetched.length, 2);
});

test('robust: throwing handlers, a WebSocket constructor that throws, a fetch that fails', () => {
  const r = rig();
  const orig = console.error;
  console.error = () => {};
  try {
    r.conn.onopen = () => { throw new Error('boom'); };
    r.conn.onmessage = () => { throw new Error('boom'); };
    r.conn.onstatus = () => { throw new Error('boom'); };
    r.last().serverOpen();
    r.last().serverSend({ t: 'joined', id: 1, seq: 0 });
    assert.equal(r.conn.readyState, 1);
  } finally {
    console.error = orig;
  }
  const bad = rig({ throwOnConnect: true });
  assert.equal(bad.sockets.length, 0);
  assert.equal(bad.conn.readyState, 0);
  bad.clock.advance(seconds(200));
  assert.equal(bad.log.closes.length, 1, 'it keeps trying and finally gives up');
  assert.equal(bad.log.closes[0].gaveUp, true);
});

// ==================================================================================================
// LoopbackConnection
// ==================================================================================================

/** The part of Room's interface (SPEC 4) the loopback uses, recording what it is asked. */
class StubRoom {
  constructor(opts) {
    this.opts = opts;
    this.steps = 0;
    this.received = [];
    this.closed = 0;
    this.inStep = false;
    StubRoom.last = this;
  }

  join(conn, who) {
    this.conn = conn;
    this.who = who;
    conn.send(JSON.stringify({ t: 'joined', id: 7, seq: 0 }));
    conn.send(JSON.stringify({ t: 'lobby', code: 'LOCAL' }));
    return { ok: true, id: 7, token: 't', resumed: false };
  }

  receive(pid, raw, conn) { this.received.push({ pid, raw, conn }); if (JSON.parse(raw).t === 'echo') conn.send(JSON.stringify({ t: 'echoed' })); }
  step() { this.inStep = true; this.steps++; this.conn?.send(JSON.stringify({ t: 'snap', k: this.steps })); this.inStep = false; }
  close() { this.closed++; this.conn.send(JSON.stringify({ t: 'error', code: 'closed' })); this.conn.close('closed'); }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function practice(over = {}) {
  const loads = [];
  const conn = new LoopbackConnection({ loadRoom: async () => { loads.push(1); return { Room: StubRoom }; }, seed: 99, ...over });
  const log = { opens: 0, messages: [], closes: [] };
  conn.onopen = () => log.opens++;
  conn.onmessage = (m) => log.messages.push(m);
  conn.onclose = (i) => log.closes.push(i);
  await settle();
  return { conn, log, loads, room: () => StubRoom.last };
}

test('loopback: the Room module is loaded lazily and only when a LoopbackConnection is made', async () => {
  const src = readFileSync(new URL('../../client/js/net.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\b[^(]*from\s*['"][^'"]*room\.js['"]/m.test(src), false, 'no static import of room.js');
  assert.match(src, /import\(\s*'\.\.\/\.\.\/shared\/room\.js'\s*\)/, 'a dynamic import instead');
  const loads = [];
  const c = new LoopbackConnection({ loadRoom: async () => { loads.push(1); return { Room: StubRoom }; } });
  assert.equal(c.readyState, 0);
  c.onopen = () => loads.push('open');
  await settle();
  assert.deepEqual(loads, [1, 'open']);
  assert.equal(c.readyState, 1);
  assert.equal(c.room instanceof StubRoom, true);
  assert.equal(StubRoom.last.opts.code, 'LOCAL');
  assert.equal(StubRoom.last.opts.local, true);
  assert.equal(StubRoom.last.opts.seed >= 0, true);
  assert.equal(StubRoom.last.opts.now(), 0, 'the Room runs on a virtual clock that starts at 0');
});

test('loopback: create joins the Room, later frames go to room.receive as JSON, replies arrive asynchronously and in order', async () => {
  const { conn, log, room } = await practice();
  assert.equal(log.opens, 1);
  assert.equal(conn.send({ t: 'ping', ts: 1 }), false, 'nothing to say before the fighter has joined');
  assert.equal(room().received.length, 0);
  conn.send({ t: 'create', v: 1, name: 'Ann', color: 2 });
  assert.deepEqual(room().who, { name: 'Ann', color: 2, token: undefined });
  assert.deepEqual(log.messages, [], 'nothing is delivered from inside the call that caused it');
  await settle();
  assert.deepEqual(log.messages.map((m) => m.t), ['joined', 'lobby']);
  conn.send({ t: 'addBot', level: 'easy' });
  conn.send({ t: 'echo' });
  assert.deepEqual(room().received.map((r) => [r.pid, r.raw]), [[7, '{"t":"addBot","level":"easy"}'], [7, '{"t":"echo"}']]);
  assert.equal(room().received[0].conn, conn.conn, 'the Room sees the same conn object it joined with');
  await settle();
  assert.equal(log.messages.at(-1).t, 'echoed');
  assert.equal(conn.send(null), false);
});

test('loopback: pump steps the Room once per 1/60 s of real time, at most 5 per call, and drops a long stall', async () => {
  const { conn, room, log } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  log.messages.length = 0;
  conn.pump(1000);                                           // the first pump only sets the baseline
  assert.equal(room().steps, 0);
  conn.pump(1000 + 16.7);
  assert.equal(room().steps, 1);
  conn.pump(1000 + 16.7 + 8);
  assert.equal(room().steps, 1);
  conn.pump(1000 + 16.7 + 8 + 9);
  assert.equal(room().steps, 2);
  const t = 1000 + 34;
  conn.pump(t + 100);                                        // 100 ms = 6 ticks earned, 5 allowed
  assert.equal(room().steps, 7);
  assert.ok(Math.abs(conn.virtualMs - 7 * (1000 / 60)) < 1e-9);
  assert.equal(room().opts.now(), conn.virtualMs);
  conn.pump(t + 100 + 5000);                                 // stall: 5 ticks, the rest of the 5 s is dropped
  assert.equal(room().steps, 12);
  conn.pump(t + 100 + 5000 + 16.7);
  assert.equal(room().steps, 13, 'and normal service resumes at once');
});

test('loopback: frames exactly one tick apart step the Room exactly once each (no 0-then-2 flicker)', async () => {
  const { conn, room } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  let t = 5000;
  conn.pump(t);
  for (let i = 0; i < 600; i++) {
    t += 1000 / 60;
    const before = room().steps;
    conn.pump(t);
    assert.equal(room().steps - before, 1, `frame ${i}`);
  }
});

test('loopback: messages reach onmessage only after the Room has finished stepping', async () => {
  const { conn, room, log } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  log.messages.length = 0;
  let sawStepping = false;
  conn.onmessage = (m) => { if (room().inStep) sawStepping = true; log.messages.push(m); };
  conn.pump(0);
  conn.pump(60);
  assert.equal(room().steps, 3);
  assert.equal(sawStepping, false);
  assert.deepEqual(log.messages.map((m) => m.k), [1, 2, 3], 'all of them, in order, after the loop');
});

test('loopback: a handler that answers a message inside onmessage does not re-enter the delivery loop', async () => {
  const { conn, log } = await practice();
  const seen = [];
  conn.onmessage = (m) => {
    seen.push(m.t);
    if (m.t === 'joined') conn.send({ t: 'echo' });
    log.messages.push(m);
  };
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  await settle();
  assert.deepEqual(seen, ['joined', 'lobby', 'echoed']);
});

test('loopback: pause freezes the Room, resume continues without a catch-up burst', async () => {
  const { conn, room } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  conn.pump(0);
  conn.pump(50);
  const steps = room().steps;
  assert.equal(steps, 3);
  conn.pause();
  conn.pump(5000);
  conn.pump(60000);
  assert.equal(room().steps, steps);
  assert.equal(conn.virtualMs, steps * (1000 / 60));
  conn.resume(60000);
  conn.pump(60000);
  assert.equal(room().steps, steps);
  conn.pump(60017);
  assert.equal(room().steps, steps + 1);
});

test('loopback: close() closes the Room once, silences its farewell, and reports onclose(byUser) once', async () => {
  const { conn, room, log } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  const messages = log.messages.length;
  conn.close();
  conn.close();
  await settle();
  assert.equal(room().closed, 1);
  assert.equal(log.messages.length, messages, 'the Room\'s `error closed` is not shown to a player who left');
  assert.deepEqual(log.closes.map((c) => [c.code, c.byUser]), [[1000, true]]);
  assert.equal(conn.readyState, 3);
  assert.equal(conn.send({ t: 'echo' }), false);
  conn.pump(0);
  conn.pump(1000);
  assert.equal(room().steps, 0);
});

test('loopback: a Room that closes the conn itself (idle, kick) becomes onclose without byUser', async () => {
  const { conn, room, log } = await practice();
  conn.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  room().conn.close('kicked');
  await settle();
  assert.deepEqual(log.closes.map((c) => [c.reason, c.byUser]), [['kicked', false]]);
  assert.equal(conn.readyState, 3);
});

test('loopback: a Room that fails to load or refuses the join is reported, not swallowed', async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const c = new LoopbackConnection({ loadRoom: async () => { throw new Error('404'); } });
    const closes = [];
    c.onclose = (i) => closes.push(i);
    await settle();
    assert.deepEqual(closes.map((i) => i.code), [1011]);
  } finally {
    console.error = orig;
  }
  class Refusing extends StubRoom { join() { return { ok: false, error: 'full' }; } }
  const c2 = new LoopbackConnection({ loadRoom: async () => ({ Room: Refusing }) });
  const got = [];
  const closes = [];
  c2.onmessage = (m) => got.push(m);
  c2.onclose = (i) => closes.push(i);
  await settle();
  c2.send({ t: 'create', v: 1, name: 'Ann' });
  await settle();
  await settle();
  assert.equal(got[0].code, 'full');
  assert.equal(closes.length, 1);
});
