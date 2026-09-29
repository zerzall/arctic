// Blast Party server entry (docs/SPEC.md §7). `startServer(cfg)` is a factory so specs can run a real server on port 0;
// the last lines boot it from the environment when this file is the entry point.
//
//   PORT (3000)  HOST (0.0.0.0)  MAX_ROOMS (200)  MAX_CONNS (400)  MAX_CONN_PER_IP (24)  TRUST_PROXY (hops, default 0)
//   LOG_LEVEL (info)  ALLOWED_ORIGINS (comma list)  ORIGIN_CHECK (0 disables the WebSocket Origin check)
//
// Rooms live in this process's memory, so the server refuses to start with WEB_CONCURRENCY > 1 or under `cluster`.
// Signal handling, the crash-loop guard and the startup banner belong to the entry point (`main`), not to the factory,
// so importing this module from a spec never touches process-wide state.

import http from 'node:http';
import cluster from 'node:cluster';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { TIMEOUTS } from '../shared/constants.js';
import { RoomManager } from './lobby.js';
import { createHttpHandler } from './http.js';
import { attachWebSocket } from './ws.js';

const CLIENT_ROOT = fileURLToPath(new URL('../client', import.meta.url));
const SHARED_ROOT = fileURLToPath(new URL('../shared', import.meta.url));
const PACKAGE_JSON = new URL('../package.json', import.meta.url);

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SOFT_CLOSE_MS = 1500;                    // after this, sockets that ignored our close frame are terminated
const HARD_EXIT_MS = 8000;
const LAG_WINDOW_MS = 10000;
const CRASH_LIMIT = 5;
const CRASH_WINDOW_MS = 60000;

/** One JSON line per event on stdout: {"t":ISO,"lvl":"info","ev":"...",...}. Callers never pass raw IPs, names or chat. */
export function createLogger({ level = 'info', write = (line) => process.stdout.write(line) } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  return (lvl, ev, extra) => {
    if ((LEVELS[lvl] ?? LEVELS.info) > threshold) return;
    write(`${JSON.stringify({ t: new Date().toISOString(), lvl, ev, ...extra })}\n`);
  };
}

const int = (v, fallback) => (v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : fallback);

/** TRUST_PROXY: an integer number of trusted hops; `true` means 1, `false` or unset means 0. */
function parseTrust(v) {
  if (v === undefined || v === '' || v === 'false') return 0;
  if (v === 'true') return 1;
  return Math.max(0, int(v, 0));
}

/** Server options from environment variables. */
export function fromEnv(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    maxRooms: int(env.MAX_ROOMS, 200),
    maxConns: int(env.MAX_CONNS, 400),
    maxConnPerIp: int(env.MAX_CONN_PER_IP, 24),
    trustProxy: parseTrust(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL || 'info',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    originCheck: env.ORIGIN_CHECK !== '0',
  };
}

/**
 * Starts the server. Resolves once it is listening.
 * @returns {Promise<{port: number, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *   rooms: RoomManager, close: (reason?: string) => Promise<void>}>}
 */
export async function startServer({
  port = 0, host = '127.0.0.1', maxRooms = 200, maxConns = 400, maxConnPerIp = 24, trustProxy = 0, timeouts = TIMEOUTS,
  seedFn = undefined, log = undefined, logLevel = 'info', botFactory = undefined, allowedOrigins = [], originCheck = true,
} = {}) {
  const version = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
  const logger = log ?? createLogger({ level: logLevel });
  const allTimeouts = { ...TIMEOUTS, ...timeouts };
  const salt = randomBytes(8).toString('hex');
  const startedAt = performance.now();
  let draining = false;

  const manager = new RoomManager({ maxRooms, timeouts: allTimeouts, seedFn, log: logger, botFactory, build: version });
  const lag = monitorEventLoopDelay({ resolution: 50 });
  lag.enable();
  let lagWindowStart = performance.now();

  let sockets = null;                                                    // set below; stats() only runs after listen()
  const stats = () => {
    const m = manager.stats();
    const mem = process.memoryUsage();
    const lagP99 = Math.round(lag.percentile(99) / 1e6);
    if (performance.now() - lagWindowStart > LAG_WINDOW_MS) {                // a rolling ~10 s window: forget older stalls
      lag.reset();
      lagWindowStart = performance.now();
    }
    return {
      v: version, upS: Math.round((performance.now() - startedAt) / 1000), rooms: m.rooms, players: m.players, humans: m.humans,
      conns: sockets.count(), maxRooms, tickMs: m.tickMs, droppedTicks: m.droppedTicks,
      loopLagMs: { p99: lagP99 }, rssMB: Math.round(mem.rss / 1048576), heapMB: Math.round(mem.heapUsed / 1048576),
    };
  };

  const server = http.createServer(
    { maxHeaderSize: 8192, keepAliveTimeout: 5000, headersTimeout: 10000, requestTimeout: 15000, connectionsCheckingInterval: 5000 },
    createHttpHandler({ clientRoot: CLIENT_ROOT, sharedRoot: SHARED_ROOT, stats, isDraining: () => draining, trustProxy }),
  );
  server.maxRequestsPerSocket = 200;
  server.maxConnections = maxConns + 50;                                 // headroom so the WebSocket cap answers with a proper 503
  sockets = attachWebSocket({
    server, manager, timeouts: allTimeouts, maxConns, maxConnPerIp, trustProxy, originCheck, allowedOrigins,
    log: logger, isDraining: () => draining, salt,
  });

  if (trustProxy > 0) {                                                  // so the hop count can be verified at LOG_LEVEL=debug
    server.once('request', (req) => logger('debug', 'proxy_headers', {
      hops: trustProxy, xff: req.headers['x-forwarded-for'] ?? null, cf: req.headers['cf-connecting-ip'] ?? null, fly: req.headers['fly-client-ip'] ?? null,
    }));
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  server.removeAllListeners('error');
  server.on('error', (err) => logger('error', 'server_error', { stack: String(err?.stack ?? err) }));

  const boundPort = server.address().port;
  logger('info', 'boot', { version, node: process.version, port: boundPort, trustProxy, maxRooms });

  let closing = null;
  const close = (reason = 'shutdown') => {
    closing ??= (async () => {
      draining = true;
      logger('info', 'shutdown', { reason });
      const closed = new Promise((resolve) => server.close(() => resolve()));
      manager.closeAll('restart');                                       // every joined socket hears `closed` and gets 1012
      sockets.closeUnjoined();
      const force = setTimeout(() => {
        sockets.terminateAll();
        server.closeAllConnections();
      }, SOFT_CLOSE_MS);
      await closed;
      clearTimeout(force);
      sockets.dispose();
      lag.disable();
    })();
    return closing;
  };

  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return { port: boundPort, url: `http://${shownHost}:${boundPort}`, server, wss: sockets.wss, rooms: manager, close };
}

// ---- Process entry ----------------------------------------------------------------------------

function lanUrls(port) {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}`);
  }
  return urls;
}

function printBanner(app) {
  const lines = ['', '  Blast Party is running', '', `  On this computer:  http://localhost:${app.port}`];
  const lan = lanUrls(app.port);
  if (lan.length) lines.push(`  Same Wi-Fi:        ${lan.join('   ')}`);
  lines.push('', '  Playing with people who are not on your Wi-Fi? Run `npm run share` for a public link.', '');
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** Rooms live in one process's memory, so a second worker would split the players of a room. */
function assertSingleInstance(env) {
  if (cluster.isWorker || Number(env.WEB_CONCURRENCY) > 1) {
    process.stderr.write('Blast Party keeps rooms in memory and must run as ONE process: unset WEB_CONCURRENCY and do not use cluster.\n');
    process.exit(1);
  }
}

/**
 * Process-wide safety nets: log-and-continue on stray errors (exit on a crash loop), graceful shutdown on the first signal,
 * immediate exit on the second.
 * @param {{close: (reason: string) => Promise<void>}} app anything with an awaitable close()
 */
export function installProcessGuards(app, logger) {
  const crashes = [];
  const onCrash = (kind) => (err) => {
    const t = performance.now();
    logger('error', kind, { stack: String(err?.stack ?? err) });
    crashes.push(t);
    while (crashes.length && t - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
    if (crashes.length > CRASH_LIMIT) {
      logger('error', 'crash loop', { count: crashes.length });
      process.exit(1);
    }
  };
  process.on('uncaughtException', onCrash('uncaughtException'));
  process.on('unhandledRejection', onCrash('unhandledRejection'));

  let signalled = false;
  const onSignal = (signal) => {
    if (signalled) process.exit(1);                                      // a second signal means "now"
    signalled = true;
    setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();
    app.close(signal).then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

async function main(env = process.env) {
  assertSingleInstance(env);
  const cfg = fromEnv(env);
  const logger = createLogger({ level: cfg.logLevel });
  // The signal handlers go in first: a SIGTERM that lands while the server is still starting waits for it and then shuts it down.
  const starting = startServer({ ...cfg, log: logger });
  installProcessGuards({ close: async (reason) => (await starting).close(reason) }, logger);
  printBanner(await starting);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`Could not start Blast Party: ${err.message}\n`);
    process.exit(1);
  });
}
