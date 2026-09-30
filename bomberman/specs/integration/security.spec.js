import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { startServer } from '../../server/index.js';
import { makeConn, SKIP_SNAPSHOT_ABOVE, TERMINATE_ABOVE } from '../../server/ws.js';
import { WsClient, delay, eventually } from '../helpers/ws-client.js';

// Hostile and broken clients against a real server: nothing here may crash it, stall a room or leak state.

const TIMEOUTS = { HELLO_MS: 300, PING_MS: 200, DEAD_MS: 600 };
const idleBots = () => ({ think: () => ({ d: 0, b: 0, x: 0 }) });

async function harness(t, extra = {}) {
  const logs = [];
  const app = await startServer({ port: 0, timeouts: TIMEOUTS, log: (...a) => logs.push(a), botFactory: idleBots, ...extra });
  const clients = [];
  const sockets = [];
  t.after(async () => {
    for (const c of clients) c.ws.terminate();
    for (const s of sockets) s.destroy();
    await app.close();
  });
  return {
    app,
    logs,
    raw: async (opts) => { const c = await WsClient.connect(app.port, opts); clients.push(c); return c; },
    create: async (name, opts) => { const c = await WsClient.create(app.port, name, opts); clients.push(c); return c; },
    join: async (code, name, opts) => { const c = await WsClient.join(app.port, code, name, opts); clients.push(c); return c; },
    tcp: (socket) => { sockets.push(socket); return socket; },
  };
}

const health = async (app) => (await fetch(`http://127.0.0.1:${app.port}/healthz`)).status;
const refused = (promise) => promise.then(() => { throw new Error('expected the upgrade to be refused'); }, (err) => err.status);

describe('security: malformed and hostile frames', () => {
  it('before hello: garbage, a wrong version and a non-hello flood all end the socket, with an error where one applies', async (t) => {
    const h = await harness(t, { timeouts: { ...TIMEOUTS, HELLO_MS: 5000 } });
    for (const [frame, code] of [['not json', 'bad_msg'], ['[]', 'bad_msg'], ['{"t":"create"}', 'version'], ['{"t":"join","v":2,"code":"BBBB","name":"x"}', 'version'],
      ['{"t":"create","v":1,"name":5}', 'bad_msg'], ['{"t":"join","v":1}', 'bad_msg'], [`{"t":"create","v":1,"name":"x","color":9}`, 'bad_msg']]) {
      const c = await h.raw();
      c.send(frame);
      assert.equal((await c.next('error')).code, code, frame);
      assert.equal((await c.closed).code, 1000);
    }
    const chatty = await h.raw();
    for (let i = 0; i < 12; i++) chatty.send({ t: 'ping', ts: i });
    assert.equal((await chatty.closed).code, 1008, 'valid but useless frames before hello cost the socket');
    assert.equal(await health(h.app), 200);
  });

  it('after hello: junk, prototype-pollution attempts, binary frames and impossible ids are ignored and the room lives on', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    await host.next('lobby', (m) => m.players.length === 2);
    const junk = ['', 'x', '{', '[]', 'null', '"str"', '{"t":"nope"}', '{"t":"in"}', '{"t":"in","c":[[1,2]]}', '{"t":"in","c":[[1,9,0,0]]}', '{"t":"kick","id":"0"}',
      '{"t":"kick","id":-1}', '{"t":"settings","patch":"x"}', '{"t":"settings","patch":{"rounds":"3","locked":1}}', '{"t":"create","v":1,"name":"again"}',
      '{"t":"join","v":1,"code":"ABCD","name":"again"}', '{"__proto__":{"polluted":true},"t":"ping","ts":1}', '{"t":"profile","constructor":{"prototype":{"polluted":1}}}',
      '{"t":"settings","patch":{"__proto__":{"polluted":1}}}', JSON.stringify({ t: 'chat', text: 'x'.repeat(3000) }), '{"t":"emote","e":8}', '{"t":"profile","id":1e999}'];
    for (const frame of junk) guest.send(frame);
    guest.ws.send(Buffer.from([0, 1, 2, 3]), { binary: true });
    guest.ws.send(Buffer.alloc(100, 0xff), { binary: true });
    guest.send({ t: 'ping', ts: 7 });
    assert.deepEqual(await guest.next('pong'), { t: 'pong', ts: 7 });
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(guest.ws.readyState, WebSocket.OPEN, 'the sender is not even disconnected');
    const chats = host.take('chat');
    assert.ok(chats.every((m) => m.text.length <= 120), 'oversize chat was cut, never relayed whole');
    host.send({ t: 'chat', text: 'still alive' });
    assert.equal((await guest.next('chat', (m) => m.text === 'still alive')).text, 'still alive');
    assert.equal(h.app.rooms.size, 1);
  });

  it('an oversize payload closes only that socket (1009); the server, the room and its other players carry on', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const guest = await h.join(host.code, 'Dad');
    await host.next('lobby', (m) => m.players.length === 2);
    const attacker = await h.join(host.code, 'Eve');
    attacker.ws.send(JSON.stringify({ t: 'chat', text: 'A'.repeat(5000) }));
    assert.equal((await attacker.closed).code, 1009);
    const big = await h.join(host.code, 'Big');
    big.ws.send('{"t":"chat","text":"' + 'B'.repeat(4097) + '"}');
    assert.equal((await big.closed).code, 1009);
    const ok = await h.join(host.code, 'Just under');
    ok.ws.send(JSON.stringify({ t: 'chat', text: 'C'.repeat(3900) }));
    assert.equal((await host.next('chat', (m) => m.name === 'Just under')).text.length, 120);
    guest.send({ t: 'ping', ts: 1 });
    assert.equal((await guest.next('pong')).ts, 1);
    assert.equal(await health(h.app), 200);
    const fresh = await h.create('New room');
    assert.ok(fresh.code);
  });

  it('a socket that never says hello is closed after HELLO_MS; a joined one is not', async (t) => {
    const h = await harness(t);
    const mute = await h.raw();
    const started = performance.now();
    const closed = await mute.closed;
    const took = performance.now() - started;
    assert.equal(closed.code, 1008);
    assert.ok(took >= 250 && took < 2000, `closed after ${took} ms`);
    const host = await h.create('Mom');
    await delay(600);
    host.send({ t: 'ping', ts: 1 });
    assert.equal((await host.next('pong')).ts, 1);
  });

  it('abrupt resets, half-open handshakes and bad upgrade requests never raise an uncaught exception', async (t) => {
    const h = await harness(t);
    const errors = [];
    const onError = (e) => errors.push(e);
    process.on('uncaughtException', onError);
    t.after(() => process.off('uncaughtException', onError));
    const host = await h.create('Mom');

    const send = (bytes, { destroyAfter = 30 } = {}) => new Promise((resolve) => {
      const s = h.tcp(net.connect(h.app.port, '127.0.0.1', () => { s.write(bytes); setTimeout(() => { s.destroy(); resolve(); }, destroyAfter); }));
      s.on('error', () => {});
      s.on('data', () => {});
    });
    const key = randomBytes(16).toString('base64');
    await send('');                                                     // connect and vanish
    await send('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n');                                     // half a request
    await send('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');           // no key
    await send(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 7\r\n\r\n`);
    await send(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n\x81\xff\xff\xff\xff\xff\xff\xff\xff`);
    await send(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n\x02\x80\x00\x00\x00\x00`);   // reserved bits / bad opcode
    await send('\x00\x01\x02garbage\r\n\r\n');
    await send(`GET /${'a'.repeat(9000)} HTTP/1.1\r\nHost: x\r\n\r\n`);   // over maxHeaderSize
    await delay(100);
    assert.deepEqual(errors, []);
    host.send({ t: 'ping', ts: 3 });
    assert.equal((await host.next('pong')).ts, 3);
    assert.equal(await health(h.app), 200);
    await eventually(() => h.app.wss.clients.size === 1, { label: 'the junk sockets to be gone' });
  });
});

describe('security: upgrade hardening', () => {
  it('only /ws upgrades: other paths get 404; unrelated HTTP paths are not WebSocket endpoints', async (t) => {
    const h = await harness(t);
    for (const path of ['/', '/ws2', '/ws/', '/api/stats', '/wsx?x=1']) assert.equal(await refused(WsClient.connect(h.app.port, { path })), 404, path);
    const ok = await h.raw({ path: '/ws?client=test' });
    assert.equal(ok.ws.readyState, WebSocket.OPEN, 'the query string is ignored');
  });

  it('Origin check: same-host origins and no Origin pass; foreign, unparsable and "null" origins get 403; ALLOWED_ORIGINS and ORIGIN_CHECK=0 are honoured', async (t) => {
    const h = await harness(t);
    const port = h.app.port;
    const accepted = async (opts) => {                                    // connect, look, hang up, wait for the server to notice
      const c = await WsClient.connect(port, opts);
      const open = c.ws.readyState === WebSocket.OPEN;
      await c.close();
      await eventually(() => h.app.wss.clients.size === 0, { label: 'the probe socket to be gone' });
      return open;
    };
    for (const origin of [`http://127.0.0.1:${port}`, 'http://127.0.0.1', 'https://127.0.0.1:9999']) assert.equal(await accepted({ origin }), true, origin);
    assert.equal(await accepted({}), true, 'no Origin header (Node clients, curl)');
    for (const origin of ['http://evil.example', 'https://127.0.0.1.evil.example', 'null', 'not a url', 'http://localhost:1']) {
      assert.equal(await refused(WsClient.connect(port, { origin })), 403, origin);
    }
    assert.ok(h.logs.some(([lvl, ev]) => lvl === 'warn' && ev === 'origin_mismatch'));

    const allowed = await harness(t, { allowedOrigins: ['https://party.example'] });
    assert.equal((await allowed.raw({ origin: 'https://party.example' })).ws.readyState, WebSocket.OPEN);
    assert.equal(await refused(WsClient.connect(allowed.app.port, { origin: 'https://party.example.evil' })), 403);

    const open = await harness(t, { originCheck: false });
    assert.equal((await open.raw({ origin: 'http://anything.example' })).ws.readyState, WebSocket.OPEN);
  });

  it('Origin check behind a proxy uses X-Forwarded-Host, and only when a proxy is trusted', async (t) => {
    const trusted = await harness(t, { trustProxy: 1 });
    const origin = 'https://party.example';
    const c = await trusted.raw({ origin, headers: { 'X-Forwarded-Host': 'party.example', Host: '127.0.0.1:1' } });
    assert.equal(c.ws.readyState, WebSocket.OPEN);
    const untrusted = await harness(t, { trustProxy: 0 });
    assert.equal(await refused(WsClient.connect(untrusted.app.port, { origin, headers: { 'X-Forwarded-Host': 'party.example' } })), 403);
  });

  it('per-IP cap: the 25th socket from one address gets 429 (counted at upgrade, joined or not)', async (t) => {
    const h = await harness(t, { maxConnPerIp: 3 });
    const a = await h.create('A');
    await h.join(a.code, 'B');
    await h.join(a.code, 'C');
    assert.equal(await refused(WsClient.connect(h.app.port)), 429);
    await a.close();
    const again = await eventually(() => WsClient.connect(h.app.port).catch(() => false), { label: 'a slot to free up' });
    assert.equal(again.ws.readyState, WebSocket.OPEN);
  });

  it('pre-join cap: at most 4 sockets per IP that have not said hello yet', async (t) => {
    const h = await harness(t, { timeouts: { ...TIMEOUTS, HELLO_MS: 5000 } });
    const idle = [];
    for (let i = 0; i < 4; i++) idle.push(await h.raw());
    assert.equal(await refused(WsClient.connect(h.app.port)), 429);
    const room = await (async () => { idle[0].send({ t: 'create', v: 1, name: 'x' }); return idle[0].expectJoined(); })();
    const next = await h.raw();
    assert.equal(next.ws.readyState, WebSocket.OPEN, 'a joined socket frees its pre-join slot');
    assert.ok(room.code);
  });

  it('global cap: maxConns answers 503', async (t) => {
    const h = await harness(t, { maxConns: 2 });
    await h.create('A');
    await h.raw();
    assert.equal(await refused(WsClient.connect(h.app.port)), 503);
  });

  it('client IP: without a trusted proxy X-Forwarded-For cannot dodge the cap; with one, each forwarded address counts on its own', async (t) => {
    const plain = await harness(t, { maxConnPerIp: 2, trustProxy: 0 });
    await plain.raw({ headers: { 'X-Forwarded-For': '1.1.1.1' } });
    await plain.raw({ headers: { 'X-Forwarded-For': '2.2.2.2' } });
    assert.equal(await refused(WsClient.connect(plain.app.port, { headers: { 'X-Forwarded-For': '3.3.3.3' } })), 429);

    const proxied = await harness(t, { maxConnPerIp: 2, trustProxy: 1 });
    await proxied.raw({ headers: { 'X-Forwarded-For': '1.1.1.1' } });
    await proxied.raw({ headers: { 'X-Forwarded-For': '1.1.1.1' } });
    assert.equal(await refused(WsClient.connect(proxied.app.port, { headers: { 'X-Forwarded-For': '1.1.1.1' } })), 429);
    assert.equal(await refused(WsClient.connect(proxied.app.port, { headers: { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' } })), 429, 'a spoofed leftmost entry does not help');
    assert.equal((await proxied.raw({ headers: { 'X-Forwarded-For': '2.2.2.2' } })).ws.readyState, WebSocket.OPEN);
  });
});

describe('security: abuse limiters', () => {
  it('room creation: the 4th create in a row from one IP fails with rate_limited', async (t) => {
    const h = await harness(t);
    for (let i = 0; i < 3; i++) await h.create(`Room ${i}`);
    const fourth = await h.raw();
    fourth.send({ t: 'create', v: 1, name: 'Too many' });
    const err = await fourth.next('error');
    assert.deepEqual([err.code, err.msg], ['rate_limited', 'Too many rooms. Wait a moment.']);
    assert.equal((await fourth.closed).code, 1000);
    assert.equal(h.app.rooms.size, 3);
    assert.ok(h.logs.some(([, ev, extra]) => ev === 'rate_limit' && extra.kind === 'create'));
  });

  it('room limit: maxRooms answers busy', async (t) => {
    const h = await harness(t, { maxRooms: 1 });
    await h.create('A');
    const b = await h.raw();
    b.send({ t: 'create', v: 1, name: 'B' });
    const err = await b.next('error');
    assert.deepEqual([err.code, err.msg], ['busy', 'Server is busy, try again in a minute.']);
    await b.closed;
  });

  it('failed joins: 25 joins to a nonexistent code hit the limiter, and even a correct code is refused for a while', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    const codes = [];
    for (let i = 0; i < 25; i++) {
      const c = await h.raw();
      c.send({ t: 'join', v: 1, code: i % 2 ? 'BBBB' : 'zzz', name: 'x' });
      codes.push((await c.next('error')).code);
      await c.closed;
    }
    assert.equal(codes.filter((c) => c === 'no_room').length, 16, 'the first 15 failures and the one that trips the limiter');
    assert.equal(codes.filter((c) => c === 'rate_limited').length, 9);
    assert.deepEqual(codes.slice(16), Array(9).fill('rate_limited'));
    const legit = await h.raw();
    legit.send({ t: 'join', v: 1, code: host.code, name: 'Legit' });
    assert.equal((await legit.next('error')).code, 'rate_limited', 'blocked for a while even with the right code');
    assert.ok(h.logs.some(([, ev, extra]) => ev === 'rate_limit' && extra.kind === 'join'));
  });

  it('successful joins do not reset the failure counter', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    for (let i = 0; i < 12; i++) {
      const c = await h.raw();
      c.send({ t: 'join', v: 1, code: 'CCCC', name: 'x' });
      await c.next('error');
      await c.closed;
    }
    for (let i = 0; i < 3; i++) await h.join(host.code, `ok${i}`);
    for (let i = 0; i < 4; i++) {
      const c = await h.raw();
      c.send({ t: 'join', v: 1, code: 'CCCC', name: 'x' });
      await c.next('error');
      await c.closed;
    }
    const blocked = await h.raw();
    blocked.send({ t: 'join', v: 1, code: host.code, name: 'x' });
    assert.equal((await blocked.next('error')).code, 'rate_limited');
  });
});

describe('security: slow and dead readers', () => {
  /** Completes a WebSocket handshake by hand, joins a room, then never reads a byte again. */
  async function sleeper(h, code) {
    const socket = h.tcp(net.connect(h.app.port, '127.0.0.1'));
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise((resolve) => socket.once('data', resolve));
    const payload = Buffer.from(JSON.stringify({ t: 'join', v: 1, code, name: 'Sleeper' }));
    const mask = randomBytes(4);
    socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]));
    socket.pause();
    return socket;
  }

  it('a raw TCP client that completes the handshake and never reads is terminated, memory stays flat and the room is unaffected', async (t) => {
    const h = await harness(t);
    const host = await h.create('Mom');
    for (let i = 0; i < 3; i++) host.send({ t: 'addBot', level: 'normal' });
    await host.next('lobby', (m) => m.players.length === 4);
    const rssBefore = process.memoryUsage().rss;
    await sleeper(h, host.code);
    await host.next('lobby', (m) => m.players.some((p) => p.name === 'Sleeper'));
    host.send({ t: 'start' });
    await host.next('round');
    assert.equal(h.app.wss.clients.size, 2);
    await eventually(() => h.app.wss.clients.size === 1, { timeout: 30000, label: 'the sleeper to be terminated' });
    const gone = await host.next('lobby', (m) => m.players.find((p) => p.name === 'Sleeper')?.connected === false);
    assert.ok(gone);
    host.send({ t: 'ping', ts: 5 });
    assert.equal((await host.next('pong')).ts, 5);
    assert.ok(process.memoryUsage().rss - rssBefore < 40 * 1048576, 'RSS stays flat');
    const stats = await (await fetch(`http://127.0.0.1:${h.app.port}/api/stats`)).json();
    assert.equal(stats.conns, 1);
  });

  it('backpressure: past 128 KB of unsent data snapshots are skipped but critical frames still go out; past 1 MB the socket is terminated', () => {
    const stalled = new Duplex({ read() {}, write() { /* the peer never reads: the callback never fires */ } });
    Object.assign(stalled, { setTimeout() {}, setNoDelay() {}, setKeepAlive() {} });
    const ws = new WebSocket(null, undefined, { autoPong: true });
    ws.setSocket(stalled, Buffer.alloc(0), { maxPayload: 4096 });
    ws.on('error', () => {});
    const conn = makeConn(ws, () => {});

    const pad = 'x'.repeat(10000);
    const snap = `{"t":"snap","pad":"${pad}"}`;
    const lobby = `{"t":"lobby","pad":"${pad}"}`;
    conn.send(snap);
    const one = ws.bufferedAmount;
    assert.ok(one > 10000, 'snapshots are sent while the buffer is small');
    while (ws.bufferedAmount <= SKIP_SNAPSHOT_ABOVE) conn.send(lobby);
    const filled = ws.bufferedAmount;
    for (let i = 0; i < 5; i++) conn.send(snap);
    assert.equal(ws.bufferedAmount, filled, 'snapshots are dropped for a client that lags');
    conn.send(lobby);
    assert.ok(ws.bufferedAmount > filled, 'critical frames are always sent');
    assert.equal(ws.readyState, WebSocket.OPEN);
    while (ws.bufferedAmount <= TERMINATE_ABOVE) conn.send(lobby);
    conn.send(lobby);
    assert.notEqual(ws.readyState, WebSocket.OPEN, 'terminated');
    assert.doesNotThrow(() => conn.send(lobby), 'sending to a dead socket is a no-op');
  });
});

describe('security: logs', () => {
  it('one JSON line per event with a hashed ipk; raw IPs, names, chat text and tokens never appear', async (t) => {
    const lines = [];
    const h = await harness(t, { log: (lvl, ev, extra) => lines.push({ lvl, ev, ...extra }) });
    const host = await h.create('SecretName');
    const guest = await h.join(host.code, 'Other');
    host.send({ t: 'chat', text: 'top secret chat line' });
    await guest.next('chat');
    await guest.close();
    await eventually(() => lines.some((l) => l.ev === 'conn_close'), { label: 'conn_close' });
    const text = JSON.stringify(lines);
    for (const forbidden of ['127.0.0.1', '::1', 'SecretName', 'Other', 'top secret', host.token, guest.token, host.code.toLowerCase() + '"']) {
      assert.ok(!text.includes(forbidden), `log leaks ${forbidden}`);
    }
    const events = new Set(lines.map((l) => l.ev));
    for (const ev of ['boot', 'conn_open', 'conn_close', 'room_open']) assert.ok(events.has(ev), ev);
    const open = lines.find((l) => l.ev === 'conn_open');
    assert.match(open.ipk, /^[0-9a-f]{8}$/);
    const close = lines.find((l) => l.ev === 'conn_close');
    assert.deepEqual(Object.keys(close).sort(), ['code', 'ev', 'ipk', 'lvl', 'ms', 'rx', 'tx']);
    assert.ok(close.rx > 0 && close.tx > 0);
    assert.deepEqual(Object.keys(lines.find((l) => l.ev === 'boot')).sort(), ['ev', 'lvl', 'maxRooms', 'node', 'port', 'trustProxy', 'version']);
    assert.equal(new Set(lines.filter((l) => l.ipk).map((l) => l.ipk)).size, 1, 'the same address hashes the same within one boot');
  });
});
