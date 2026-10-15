import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { startServer, fromEnv, createLogger } from '../../server/index.js';
import { WsClient, delay, eventually } from '../helpers/ws-client.js';

// Process-level behaviour: graceful shutdown on SIGTERM/SIGINT (a child process, as in production), the second-signal
// escape hatch, refusing to run as more than one worker, PORT handling, and the crash-loop guard.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INDEX = fileURLToPath(new URL('../../server/index.js', import.meta.url));

/** Spawns `node <args>`; resolves once a JSON log line satisfying `ready` shows up on stdout. */
function spawnServer(t, { env = {}, args = [INDEX], ready = (l) => l.ev === 'boot' } = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = { lines: [], text: '', stderr: '' };
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal, at: performance.now() })));
  t.after(() => child.kill('SIGKILL'));
  let waiting = null;
  const started = new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    let buffer = '';
    child.stdout.on('data', (d) => {
      out.text += d;
      buffer += d;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        try {
          const parsed = JSON.parse(line);
          out.lines.push(parsed);
          if (ready(parsed)) waiting?.resolve(parsed);
        } catch { /* banner text */ }
      }
    });
    child.stderr.on('data', (d) => { out.stderr += d; });
    child.once('exit', (code) => waiting?.reject(new Error(`exited with ${code} before it was ready: ${out.stderr}`)));
  });
  return { child, out, exited, started };
}

const stopped = (signalTime, exit) => exit.at - signalTime;

describe('shutdown: graceful', () => {
  it('SIGTERM: joined sockets hear `closed` and get close code 1012, unjoined ones too, and the process exits 0 in under 3 s', async (t) => {
    const s = spawnServer(t);
    const boot = await s.started;
    assert.deepEqual(Object.keys(boot).sort(), ['ev', 'lvl', 'maxRooms', 'node', 'port', 't', 'trustProxy', 'version']);
    const host = await WsClient.create(boot.port, 'Mom');
    const guest = await WsClient.join(boot.port, host.code, 'Dad');
    const stranger = await WsClient.connect(boot.port);
    assert.equal((await fetch(`http://127.0.0.1:${boot.port}/healthz`)).status, 200);

    const t0 = performance.now();
    s.child.kill('SIGTERM');
    for (const c of [host, guest, stranger]) {
      const err = await c.next('error');
      assert.deepEqual([err.code, err.msg], ['closed', 'Server restarting']);
      assert.deepEqual(await c.closed, { code: 1012, reason: 'restart' });
    }
    const exit = await s.exited;
    assert.deepEqual([exit.code, exit.signal], [0, null]);
    assert.ok(stopped(t0, exit) < 3000, `took ${stopped(t0, exit)} ms`);
    assert.ok(s.out.lines.some((l) => l.ev === 'shutdown' && l.reason === 'SIGTERM'));
    await assert.rejects(fetch(`http://127.0.0.1:${boot.port}/healthz`), 'the port is closed');
  });

  it('SIGINT behaves the same, and an idle server exits at once', async (t) => {
    const s = spawnServer(t);
    await s.started;
    const t0 = performance.now();
    s.child.kill('SIGINT');
    const exit = await s.exited;
    assert.equal(exit.code, 0);
    assert.ok(stopped(t0, exit) < 3000, `took ${stopped(t0, exit)} ms`);
  });

  it('a peer that ignores the close frame is terminated after ~1.5 s and the process still exits 0 before the 8 s deadline', async (t) => {
    const s = spawnServer(t);
    const boot = await s.started;
    const socket = net.connect(boot.port, '127.0.0.1');
    socket.on('error', () => {});
    t.after(() => socket.destroy());
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise((resolve) => socket.once('data', resolve));
    socket.pause();
    const t0 = performance.now();
    s.child.kill('SIGTERM');
    const exit = await s.exited;
    assert.equal(exit.code, 0);
    assert.ok(stopped(t0, exit) >= 1000 && stopped(t0, exit) < 4000, `took ${stopped(t0, exit)} ms`);
  });

  it('a second signal exits at once with status 1', async (t) => {
    const s = spawnServer(t);
    const boot = await s.started;
    const socket = net.connect(boot.port, '127.0.0.1');
    socket.on('error', () => {});
    t.after(() => socket.destroy());
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise((resolve) => socket.once('data', resolve));
    socket.pause();
    s.child.kill('SIGTERM');
    await delay(250);
    const t0 = performance.now();
    s.child.kill('SIGTERM');
    const exit = await s.exited;
    assert.equal(exit.code, 1);
    assert.ok(stopped(t0, exit) < 3000, `took ${stopped(t0, exit)} ms`);
  });

  it('startServer().close() is awaitable and idempotent: sockets get 1012, rooms are closed, the port is released', async () => {
    const app = await startServer({ port: 0, log: () => {}, timeouts: { HELLO_MS: 300, PING_MS: 200, DEAD_MS: 600 } });
    const host = await WsClient.create(app.port, 'Mom');
    const stranger = await WsClient.connect(app.port);
    const first = app.close('test');
    assert.equal(app.close(), first, 'the same promise');
    await first;
    assert.deepEqual(await host.closed, { code: 1012, reason: 'restart' });
    assert.deepEqual(await stranger.closed, { code: 1012, reason: 'restart' });
    assert.equal(app.rooms.size, 0);
    await assert.rejects(WsClient.connect(app.port));
    assert.equal(app.server.listening, false);
  });

  it('close() terminates a peer that never answers the close handshake (well within the hard deadline)', async () => {
    const app = await startServer({ port: 0, log: () => {}, timeouts: { HELLO_MS: 5000, PING_MS: 60000, DEAD_MS: 600000 } });
    const socket = net.connect(app.port, '127.0.0.1');
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise((resolve) => socket.once('data', resolve));
    socket.pause();
    const t0 = performance.now();
    await app.close();
    const took = performance.now() - t0;
    socket.destroy();
    assert.ok(took >= 1000 && took < 4000, `took ${took} ms`);
  });
});

describe('startup', () => {
  it('fromEnv: defaults and every variable of the spec', () => {
    assert.deepEqual(fromEnv({}), {
      port: 3000, host: '0.0.0.0', maxRooms: 200, maxConns: 400, maxConnPerIp: 24, trustProxy: 0, logLevel: 'info', allowedOrigins: [], originCheck: true,
    });
    assert.deepEqual(fromEnv({
      PORT: '10000', HOST: '::', MAX_ROOMS: '30', MAX_CONNS: '99', MAX_CONN_PER_IP: '5', TRUST_PROXY: '2', LOG_LEVEL: 'warn',
      ALLOWED_ORIGINS: ' https://a.example/ , https://b.example,, ', ORIGIN_CHECK: '0',
    }), {
      port: 10000, host: '::', maxRooms: 30, maxConns: 99, maxConnPerIp: 5, trustProxy: 2, logLevel: 'warn',
      allowedOrigins: ['https://a.example', 'https://b.example'], originCheck: false,
    });
    for (const [value, hops] of [['1', 1], ['true', 1], ['0', 0], ['false', 0], ['', 0], ['-3', 0], ['banana', 0]]) assert.equal(fromEnv({ TRUST_PROXY: value }).trustProxy, hops, value);
    assert.equal(fromEnv({ PORT: '0' }).port, 0, 'port 0 is a valid choice');
    assert.equal(fromEnv({ PORT: 'nope' }).port, 3000);
  });

  it('createLogger: one JSON line per event, filtered by level', () => {
    const lines = [];
    const log = createLogger({ level: 'warn', write: (l) => lines.push(l) });
    log('info', 'hidden', { a: 1 });
    log('debug', 'hidden');
    log('warn', 'rate_limit', { ipk: 'abcd1234', kind: 'join' });
    log('error', 'room_error', { room: 'BCDF', stack: 'x' });
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n')));
    const [first, second] = lines.map((l) => JSON.parse(l));
    assert.match(first.t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.deepEqual({ ...first, t: undefined }, { t: undefined, lvl: 'warn', ev: 'rate_limit', ipk: 'abcd1234', kind: 'join' });
    assert.deepEqual([second.lvl, second.ev, second.room], ['error', 'room_error', 'BCDF']);
  });

  it('LOG_LEVEL=debug behind a trusted proxy logs the raw forwarding headers of the first request once (to verify the hop count)', async () => {
    const lines = [];
    const app = await startServer({ port: 0, trustProxy: 1, log: (lvl, ev, extra) => lines.push({ lvl, ev, ...extra }) });
    try {
      await fetch(`http://127.0.0.1:${app.port}/healthz`, { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' } });
      await fetch(`http://127.0.0.1:${app.port}/healthz`, { headers: { 'x-forwarded-for': '1.1.1.1' } });
      const seen = lines.filter((l) => l.ev === 'proxy_headers');
      assert.deepEqual(seen, [{ lvl: 'debug', ev: 'proxy_headers', hops: 1, xff: '203.0.113.9, 10.0.0.2', cf: null, fly: null }]);
    } finally {
      await app.close();
    }
    const quiet = [];
    const direct = await startServer({ port: 0, log: (lvl, ev) => quiet.push(ev) });
    await fetch(`http://127.0.0.1:${direct.port}/healthz`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
    await direct.close();
    assert.ok(!quiet.includes('proxy_headers'), 'without a trusted proxy the headers are not interesting');
  });

  it('refuses to run as more than one worker (WEB_CONCURRENCY > 1) and never listens', async (t) => {
    const s = spawnServer(t, { env: { WEB_CONCURRENCY: '2' }, ready: () => false });
    s.started.catch(() => {});
    const exit = await s.exited;
    assert.equal(exit.code, 1);
    assert.match(s.out.stderr, /ONE process/);
    assert.deepEqual(s.out.lines, [], 'no boot line');
  });

  it('WEB_CONCURRENCY=1 is fine, and PORT is honoured', async (t) => {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const s = spawnServer(t, { env: { WEB_CONCURRENCY: '1', PORT: String(port), MAX_ROOMS: '7', TRUST_PROXY: 'true', LOG_LEVEL: 'debug' } });
    const boot = await s.started;
    assert.deepEqual([boot.port, boot.maxRooms, boot.trustProxy], [port, 7, 1]);
    const stats = await (await fetch(`http://127.0.0.1:${port}/api/stats`)).json();
    assert.equal(stats.maxRooms, 7);
    assert.match(s.out.text, /Blast Party is running/);
    assert.match(s.out.text, new RegExp(`http://localhost:${port}`));
    assert.match(s.out.text, /npm run share/);
  });

  it('a port that is already taken is a clear failure with status 1', async (t) => {
    const busy = net.createServer();
    await new Promise((resolve) => busy.listen(0, '127.0.0.1', resolve));
    t.after(() => busy.close());
    const s = spawnServer(t, { env: { PORT: String(busy.address().port) }, ready: () => false });
    s.started.catch(() => {});
    const exit = await s.exited;
    assert.equal(exit.code, 1);
    assert.match(s.out.stderr, /Could not start Blast Party/);
  });
});

describe('process guards', () => {
  const INDEX_URL = pathToFileURL(INDEX).href;
  const guardScript = `
    import { startServer, installProcessGuards, createLogger } from ${JSON.stringify(INDEX_URL)};
    const logger = createLogger({ level: 'info' });
    const app = await startServer({ port: 0, log: logger, host: '127.0.0.1' });
    installProcessGuards(app, logger);
    console.log(JSON.stringify({ ev: 'ready', port: app.port }));
    process.stdin.on('data', (d) => {
      for (const line of String(d).split('\\n').filter(Boolean)) {
        if (line === 'throw') setImmediate(() => { throw new Error('stray exception'); });
        if (line === 'reject') Promise.reject(new Error('stray rejection'));
      }
    });`;

  it('stray exceptions and rejections are logged and survived; a crash loop (more than 5 within a minute) exits with status 1', async (t) => {
    const s = spawnServer(t, { args: ['--input-type=module', '-e', guardScript], ready: (l) => l.ev === 'ready' });
    const { port } = await s.started;
    for (const what of ['throw', 'reject', 'throw']) {
      s.child.stdin.write(`${what}\n`);
      await delay(30);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200, 'still serving after 3 strays');
    await eventually(() => s.out.lines.filter((l) => l.lvl === 'error').length >= 3, { label: 'three error log lines' });
    const errors = s.out.lines.filter((l) => l.lvl === 'error');
    assert.deepEqual(errors.map((l) => l.ev).sort(), ['uncaughtException', 'uncaughtException', 'unhandledRejection']);
    assert.match(errors.find((l) => l.ev === 'uncaughtException').stack, /stray exception/);
    assert.match(errors.find((l) => l.ev === 'unhandledRejection').stack, /stray rejection/);
    for (const what of ['throw', 'reject', 'throw']) {
      s.child.stdin.write(`${what}\n`);
      await delay(30);
    }
    const exit = await s.exited;
    assert.equal(exit.code, 1);
    assert.ok(s.out.lines.some((l) => l.ev === 'crash loop'));
  });

  it('the guards also install the graceful signal handler: SIGTERM exits 0', async (t) => {
    const s = spawnServer(t, { args: ['--input-type=module', '-e', guardScript], ready: (l) => l.ev === 'ready' });
    await s.started;
    s.child.kill('SIGTERM');
    assert.equal((await s.exited).code, 0);
  });
});
