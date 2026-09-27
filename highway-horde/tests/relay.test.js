// Relay server (SPEC §8 self-hosting): static files with sane headers and no path
// traversal, /api/info, and the WebSocket room relay (create/join, routing, teardown,
// limits). Clients use Node's global WebSocket, like browsers do. Skipped when the `ws`
// package is not installed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GAME_VERSION, PROTOCOL_VERSION, MAX_PLAYERS } from '../public/js/shared/constants.js';

let wsAvailable = true;
try {
  await import('ws');
} catch {
  wsAvailable = false;
}

const PORT = 5122;
const BASE = `http://127.0.0.1:${PORT}`;
const URL_WS = `ws://127.0.0.1:${PORT}/relay`;
let relay = null;

before(async () => {
  if (!wsAvailable) return;
  const { createRelayServer } = await import('../server/relay-server.js');
  relay = createRelayServer({ log: false, maxRooms: 50 });
  await relay.listen(PORT, '127.0.0.1');
});

after(async () => {
  if (relay) await relay.close();
});

function rtest(name, fn) {
  test(name, { skip: !wsAvailable && 'ws is not installed' }, fn);
}

/** Raw HTTP request (no URL normalisation, unlike fetch). */
function request(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** A WebSocket with a message queue we can await. */
function open(url = URL_WS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const queue = [];
    const waiters = [];
    ws.closeInfo = null;
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : new Uint8Array(e.data);
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    };
    ws.next = (ms = 2000) => new Promise((res, rej) => {
      if (queue.length) {
        res(queue.shift());
        return;
      }
      const timer = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
      waiters.push((m) => {
        clearTimeout(timer);
        res(m);
      });
    });
    ws.pending = () => queue.length;
    ws.closed = new Promise((res) => {
      ws.onclose = (e) => {
        ws.closeInfo = { code: e.code, reason: e.reason };
        res(ws.closeInfo);
      };
    });
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('websocket error'));
  });
}

function json(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function createRoom() {
  const host = await open();
  json(host, { t: 'create' });
  const created = await host.next();
  assert.equal(created.t, 'created');
  assert.match(created.code, /^[A-HJKMNP-Z2-9]{5}$/);
  return { host, code: created.code };
}

async function joinRoom(code) {
  const c = await open();
  json(c, { t: 'join', code });
  return { ws: c, reply: await c.next() };
}

const text = (s) => new TextEncoder().encode(s);

rtest('GET /api/info', async () => {
  const res = await request('/api/info');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { relay: true, version: GAME_VERSION, protocol: PROTOCOL_VERSION });
});

rtest('static files: MIME types, cache headers, ETag revalidation, HEAD', async () => {
  const js = await request('/js/shared/constants.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.headers['cache-control'], 'no-cache');
  assert.equal(js.headers['x-content-type-options'], 'nosniff');
  assert.match(js.body.toString(), /PROTOCOL_VERSION/);
  const etag = js.headers.etag;
  assert.ok(etag);
  const again = await request('/js/shared/constants.js', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  const vendor = await request('/vendor/peerjs.min.js');
  assert.equal(vendor.status, 200);
  assert.match(vendor.headers['cache-control'], /max-age=86400/);
  const head = await request('/config.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.ok(Number(head.headers['content-length']) > 0);
  const query = await request('/js/shared/constants.js?v=123');
  assert.equal(query.status, 200);
  const post = await request('/config.js', { method: 'POST' });
  assert.equal(post.status, 405);
  const missing = await request('/nope.js');
  assert.equal(missing.status, 404);
  const dir = await request('/js/shared/');
  assert.equal(dir.status, 404, 'directories without index.html are not listed');
});

rtest('path traversal and hidden files are blocked', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/js/..%2f..%2fpackage.json', '/..%5cpackage.json',
    '/js/%2e%2e/%2e%2e/server/relay-server.js', '/%00/etc/passwd', '/.gitignore', '/js/.hidden',
    '//etc/passwd', '/%E0%A4%A']) {
    const res = await request(p);
    assert.ok(res.status === 404 || res.status === 400, `${p} → ${res.status}`);
    assert.doesNotMatch(res.body.toString(), /"name": "highway-horde"|createRelayServer/);
  }
});

rtest('websocket upgrade only on /relay', async () => {
  await assert.rejects(open(`ws://127.0.0.1:${PORT}/other`));
});

rtest('relay: create, join, route frames both ways, broadcast, leave', async () => {
  const { host, code } = await createRoom();
  const a = await joinRoom(code.toLowerCase());
  assert.deepEqual(a.reply, { t: 'joined', code, peer: 1 });
  assert.deepEqual(await host.next(), { t: 'peer-join', peer: 1 });
  const b = await joinRoom(code);
  assert.equal(b.reply.peer, 2);
  assert.deepEqual(await host.next(), { t: 'peer-join', peer: 2 });

  // client → host: [channel][payload] arrives as [channel][peer u16][payload]
  b.ws.send(new Uint8Array([1, 9, 8, 7]));
  assert.deepEqual([...await host.next()], [1, 2, 0, 9, 8, 7]);
  const hello = text('{"t":"hello"}');
  a.ws.send(new Uint8Array([0, ...hello]));
  assert.deepEqual([...await host.next()], [0, 1, 0, ...hello]);

  // host → one client
  host.send(new Uint8Array([1, 2, 0, 42, 43]));
  assert.deepEqual([...await b.ws.next()], [1, 42, 43]);
  // host → everyone (peer 0)
  host.send(new Uint8Array([0, 0, 0, ...text('{"t":"roster"}')]));
  assert.deepEqual([...await a.ws.next()], [0, ...text('{"t":"roster"}')]);
  assert.deepEqual([...await b.ws.next()], [0, ...text('{"t":"roster"}')]);
  assert.equal(a.ws.pending(), 0, 'the unicast to b did not reach a');

  // Malformed frames are ignored, not forwarded or fatal.
  a.ws.send(new Uint8Array([7, 1, 2]));
  host.send(new Uint8Array([1]));
  host.send(new Uint8Array([1, 99, 0, 5]));

  a.ws.close();
  assert.deepEqual(await host.next(), { t: 'peer-leave', peer: 1, reason: 'left' });
  b.ws.send(new Uint8Array([1, 1]));
  assert.deepEqual([...await host.next()], [1, 2, 0, 1]);
  host.close();
  await b.ws.closed;
});

rtest('relay: bad codes and double joins get errors', async () => {
  const c = await open();
  json(c, { t: 'join', code: 'QQQQQ' });
  assert.deepEqual(await c.next(), { t: 'error', msg: 'Room not found' });
  json(c, { t: 'join', code: 42 });
  assert.deepEqual(await c.next(), { t: 'error', msg: 'Room not found' });
  const { host, code } = await createRoom();
  json(c, { t: 'join', code });
  assert.equal((await c.next()).t, 'joined');
  json(c, { t: 'create' });
  assert.deepEqual(await c.next(), { t: 'error', msg: 'Already in a room' });
  // Garbage control frames are ignored.
  c.send('not json');
  c.send(JSON.stringify({ t: 'teleport' }));
  host.close();
  const closed = await c.closed;
  assert.equal(closed.code, 4000);
});

rtest('relay: room is full at MAX_PLAYERS members', async () => {
  const { host, code } = await createRoom();
  const clients = [];
  for (let i = 0; i < MAX_PLAYERS - 1; i++) {
    const j = await joinRoom(code);
    assert.equal(j.reply.t, 'joined');
    clients.push(j.ws);
  }
  const extra = await joinRoom(code);
  assert.deepEqual(extra.reply, { t: 'error', msg: 'Room is full' });
  clients[0].close();
  await clients[0].closed;
  // Wait for the host to learn about it, then the slot is free again.
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const m = await host.next();
    if (m.t === 'peer-leave') break;
  }
  json(extra.ws, { t: 'join', code });
  assert.equal((await extra.ws.next()).t, 'joined');
  host.close();
  await Promise.all([...clients.slice(1), extra.ws].map((c) => c.closed));
});

rtest('relay: host leaving tears the room down and notifies clients', async () => {
  const { host, code } = await createRoom();
  const a = await joinRoom(code);
  host.close();
  assert.deepEqual(await a.ws.next(), { t: 'closed', reason: 'Host left the game' });
  const info = await a.ws.closed;
  assert.equal(info.code, 4000);
  assert.equal(relay.rooms.has(code), false);
  const late = await joinRoom(code);
  assert.deepEqual(late.reply, { t: 'error', msg: 'Room not found' });
  late.ws.close();
});

rtest('relay: host can kick a client', async () => {
  const { host, code } = await createRoom();
  const a = await joinRoom(code);
  await host.next();
  json(host, { t: 'kick', peer: a.reply.peer });
  assert.deepEqual(await a.ws.next(), { t: 'closed', reason: 'Kicked' });
  assert.equal((await a.ws.closed).code, 4001);
  assert.deepEqual(await host.next(), { t: 'peer-leave', peer: 1, reason: 'kicked' });
  host.close();
});

rtest('relay: oversize frames close the connection', async () => {
  const { host, code } = await createRoom();
  const a = await joinRoom(code);
  a.ws.send(new Uint8Array(70 * 1024));
  const info = await a.ws.closed;
  assert.equal(info.code, 1009);
  assert.deepEqual(await host.next(), { t: 'peer-join', peer: 1 });
  assert.deepEqual(await host.next(), { t: 'peer-leave', peer: 1, reason: 'left' });
  host.close();
});

rtest('relay: floods are rate limited and abusers disconnected; room cap', async () => {
  const { createRelayServer } = await import('../server/relay-server.js');
  const small = createRelayServer({ log: false, maxRooms: 1, rate: { msgsPerSec: 50, msgBurst: 50 } });
  const port = await small.listen(PORT + 1, '127.0.0.1');
  try {
    const url = `ws://127.0.0.1:${port}/relay`;
    const host = await open(url);
    json(host, { t: 'create' });
    const { code } = await host.next();
    const other = await open(url);
    json(other, { t: 'create' });
    assert.deepEqual(await other.next(), { t: 'error', msg: 'Server is full' });
    const c = await open(url);
    json(c, { t: 'join', code });
    await c.next();
    await host.next();
    for (let i = 0; i < 400; i++) c.send(new Uint8Array([1, i & 255]));
    const info = await c.closed;
    assert.equal(info.code, 1008);
    let forwarded = 0;
    try {
      for (;;) {
        const m = await host.next(300);
        if (m instanceof Uint8Array) forwarded++;
      }
    } catch {
      // Drained.
    }
    assert.ok(forwarded >= 40 && forwarded <= 60, `forwarded ${forwarded} of 400`);
    host.close();
    other.close();
  } finally {
    await small.close();
  }
});

rtest('transport-relay + session: a full lobby handshake and snapshot flow over real WebSockets', async () => {
  const { createRelayHost, connectRelay } = await import('../public/js/net/transport-relay.js');
  const { hostGame, joinGame } = await import('../public/js/net/session.js');
  const { FakeGame } = await import('./fixtures/net-fake-game.js');
  await assert.rejects(connectRelay('ZZZZZ', { url: URL_WS }), { message: 'Room not found' });
  await assert.rejects(connectRelay('ZZZZZ', { url: `ws://127.0.0.1:${PORT + 5}/relay`, timeout: 2000 }), { message: 'Could not connect' });

  const net = await createRelayHost({ url: URL_WS });
  assert.equal(net.kind, 'relay');
  const host = await hostGame({ name: 'Host', transport: net, hooks: { manual: true, createGame: (o) => new FakeGame(o) } });
  assert.equal(host.transport, 'relay');
  assert.match(host.code, /^[A-HJKMNP-Z2-9]{5}$/);
  const a = await joinGame({ via: connectRelay(host.code, { url: URL_WS }), name: 'Alice', hooks: { manual: true } });
  const b = await joinGame({ via: connectRelay(host.code, { url: URL_WS }), name: 'Host', hooks: { manual: true } });
  assert.deepEqual(b.roster.map((r) => r.name), ['Host', 'Alice', 'Host 2']);
  const chats = [];
  b.on('chat', (m) => chats.push(m));
  a.sendChat('over the relay');
  host.start();
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    host.update(1 / 60, null, 0);
    a.update(1 / 60, { moveX: 1, moveY: 0 }, 0);
    b.update(1 / 60, null, 0);
    await new Promise((r) => setTimeout(r, 16));
  }
  assert.ok(chats.some((m) => m.text === 'over the relay'));
  assert.equal(a.inGame, true);
  const view = a.getView();
  assert.ok(view && view.zombies.length === 250, 'snapshots arrived through the relay');
  assert.ok(a.netStats.snapshots >= 0);
  const hostPlayer = host.game.players.find((p) => p.id === a.localId);
  assert.ok(hostPlayer.lastSeq > 30, `inputs arrived (${hostPlayer.lastSeq})`);
  const gone = new Promise((r) => b.on('disconnected', r));
  host.leave();
  assert.deepEqual(await gone, { reason: 'Host left the game' });
});

rtest('relay: dead sockets (no pong) are dropped and idle sockets closed', async () => {
  const { createRelayServer } = await import('../server/relay-server.js');
  const { WebSocket: WsClient } = await import('ws');
  const quick = createRelayServer({ log: false, heartbeatMs: 80, idleMs: 150 });
  const port = await quick.listen(PORT + 2, '127.0.0.1');
  try {
    const url = `ws://127.0.0.1:${port}/relay`;
    // Answers pings (browser behaviour) but never joins a room: closed as idle.
    const idle = await open(url);
    const idleInfo = await idle.closed;
    assert.equal(idleInfo.code, 4002);
    // In a room but deaf to pings (a frozen tab / dead network): terminated, host told.
    const host = await open(url);
    json(host, { t: 'create' });
    const { code } = await host.next();
    const deaf = new WsClient(url, { autoPong: false });
    await new Promise((r) => deaf.once('open', r));
    deaf.send(JSON.stringify({ t: 'join', code }));
    const closed = new Promise((r) => deaf.once('close', (c) => r(c)));
    assert.deepEqual(await host.next(), { t: 'peer-join', peer: 1 });
    // The host keeps talking so it is not dropped itself.
    const keep = setInterval(() => host.send(new Uint8Array([1, 0, 0, 1])), 20);
    assert.equal(await closed, 1006);
    assert.deepEqual(await host.next(), { t: 'peer-leave', peer: 1, reason: 'left' });
    clearInterval(keep);
    host.close();
  } finally {
    await quick.close();
  }
});
