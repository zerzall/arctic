// WebSocket adapter (docs/SPEC.md §7): turns each socket into a Room `conn` and enforces the transport-level limits.
//
// The Room owns every game-level rule (message limits, joined/lobby/replays); this file owns only what a socket needs:
//   * upgrade hardening: /ws only, draining, global and per-IP caps, pre-join cap, Origin check
//   * maxPayload 4096, a hello deadline, server pings and a dead-peer sweep
//   * client IP derivation (rightmost-N X-Forwarded-For) and the hashed `ipk` used in logs
//   * backpressure per client and the graceful-shutdown helpers
// The first valid `create`/`join` frame turns the socket into a Room participant; every later frame goes to Room.receive.

import { WebSocketServer, WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { isIPv6 } from 'node:net';
import { parseClientMessage, ERR, CLIENT_MSG } from '../shared/protocol.js';
import { errorFrame } from '../shared/room.js';
import { CODE_RE } from './lobby.js';

const MAX_PAYLOAD = 4096;
const MAX_PREJOIN_PER_IP = 4;
const MAX_PREHELLO_FRAMES = 8;                 // frames that are valid but are not create/join, before the socket is dropped
export const SKIP_SNAPSHOT_ABOVE = 128 * 1024;
export const TERMINATE_ABOVE = 1024 * 1024;
const SNAPSHOT_PREFIX = '{"t":"snap"';
const FORCE_CLOSE_MS = 2000;                   // a peer that ignores our close frame is terminated after this long
const REPLACED_CODE = 4001;
const RESTART_CODE = 1012;
const STATUS_TEXT = { 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

// ---- Client IP (7) ----------------------------------------------------------------------------

/** Strips the IPv4-mapped prefix and keys IPv6 addresses by their /64, so one household cannot dodge a cap by rotating addresses. */
export function normalizeIp(addr) {
  if (typeof addr !== 'string' || addr === '') return 'unknown';
  let ip = addr.trim().toLowerCase().replace(/%.*$/, '');
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);                  // "[::1]:5678", as some proxies write X-Forwarded-For
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  if (ip.startsWith('::ffff:') && ip.includes('.')) return ip.slice(7);
  if (!isIPv6(ip)) return ip;
  const [head, tail = null] = ip.split('::');
  const groups = head === '' ? [] : head.split(':');
  const rest = tail === null || tail === '' ? [] : tail.split(':');
  const full = tail === null ? groups : [...groups, ...Array(Math.max(0, 8 - groups.length - rest.length)).fill('0'), ...rest];
  return `${full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * The address limits are keyed on. `trustProxy` is the number of trusted proxy hops: the first X-Forwarded-For entry is
 * attacker-controlled, so with N trusted hops the N-th entry from the RIGHT (added by our own proxy) is used.
 */
export function clientIp(req, trustProxy = 0, env = process.env) {
  const socketIp = normalizeIp(req.socket.remoteAddress);
  if (!trustProxy) return socketIp;
  const h = req.headers;
  if (env.FLY_APP_NAME && h['fly-client-ip']) return normalizeIp(String(h['fly-client-ip']));     // Fly overwrites it
  if (h['cf-connecting-ip']) return normalizeIp(String(h['cf-connecting-ip']));                    // Cloudflare / cloudflared overwrite it
  const xff = String(h['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length >= trustProxy ? normalizeIp(xff[xff.length - trustProxy]) : socketIp;
}

/** First 8 hex chars of sha256(ip + salt): enough to correlate log lines, useless for recovering the address. */
export function hashIp(ip, salt) {
  return createHash('sha256').update(ip + salt).digest('hex').slice(0, 8);
}

// ---- The Room's view of a socket --------------------------------------------------------------

/**
 * The `conn` a Room talks to. Snapshots are droppable (a client that misses one heals through gv/sync), everything
 * else is always sent; past 1 MB of unsent data the peer is not reading at all and the socket is terminated.
 * @param {import('ws').WebSocket} ws
 * @param {(code: number, reason: string) => void} closeSocket
 * @param {{tx: number}} tally bytes sent, for the conn_close log line
 */
export function makeConn(ws, closeSocket, tally = { tx: 0 }) {
  return {
    send(str) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const queued = ws.bufferedAmount;
      if (queued > TERMINATE_ABOVE) {
        ws.terminate();
      } else if (queued <= SKIP_SNAPSHOT_ABOVE || !str.startsWith(SNAPSHOT_PREFIX)) {
        tally.tx += str.length;
        ws.send(str);
      }
    },
    close(reason) {
      if (reason === 'replaced') closeSocket(REPLACED_CODE, 'replaced');
      else if (reason === 'restart') closeSocket(RESTART_CODE, 'restart');
      else closeSocket(1000, String(reason ?? ''));
    },
  };
}

// ---- The adapter ------------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {import('node:http').Server} o.server
 * @param {import('./lobby.js').RoomManager} o.manager
 * @param {{HELLO_MS: number, PING_MS: number, DEAD_MS: number}} o.timeouts
 * @param {number} o.maxConns
 * @param {number} o.maxConnPerIp
 * @param {number} [o.trustProxy]
 * @param {boolean} [o.originCheck]
 * @param {string[]} [o.allowedOrigins]
 * @param {(level: string, ev: string, extra?: object) => void} o.log
 * @param {() => boolean} o.isDraining
 * @param {string} o.salt secret per boot, mixed into the hashed IPs
 * @param {object} [o.env] defaults to process.env (only FLY_APP_NAME is read)
 */
export function attachWebSocket({
  server, manager, timeouts, maxConns, maxConnPerIp, trustProxy = 0, originCheck = true, allowedOrigins = [],
  log, isDraining, salt, env = process.env,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const sockets = new Set();
  const perIp = new Map();                     // ip -> { conns, prejoin }

  const ipState = (ip) => {
    let s = perIp.get(ip);
    if (!s) perIp.set(ip, s = { conns: 0, prejoin: 0 });
    return s;
  };

  function originOk(req) {
    const origin = req.headers.origin;
    if (!originCheck || origin === undefined) return true;             // Node clients and curl send none
    if (allowedOrigins.includes(String(origin).replace(/\/+$/, ''))) return true;
    try {
      const forwarded = trustProxy > 0 ? String(req.headers['x-forwarded-host'] ?? '').split(',').pop().trim() : '';
      const host = forwarded || req.headers.host || '';
      return new URL(origin).hostname === new URL(`http://${host}`).hostname;
    } catch {
      return false;                                                     // "null" and other unparsable origins
    }
  }

  function reject(socket, status) {
    const body = `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
    socket.end(body, () => socket.destroy());
    setTimeout(() => socket.destroy(), FORCE_CLOSE_MS).unref();
  }

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});                                        // pre-handshake resets must not crash the process
    const refuse = (status) => reject(socket, status);
    if ((req.url ?? '').split('?')[0] !== '/ws') {
      refuse(404);
    } else if (isDraining() || sockets.size >= maxConns) {
      refuse(503);
    } else {
      const ip = clientIp(req, trustProxy, env);
      const state = perIp.get(ip);
      if (state && (state.conns >= maxConnPerIp || state.prejoin >= MAX_PREJOIN_PER_IP)) {
        log('warn', 'rate_limit', { ipk: hashIp(ip, salt), kind: state.conns >= maxConnPerIp ? 'conns' : 'prejoin' });
        refuse(429);
      } else if (!originOk(req)) {
        log('warn', 'origin_mismatch', { ipk: hashIp(ip, salt) });
        refuse(403);
      } else {
        wss.handleUpgrade(req, socket, head, (ws) => {
          req.clientIp = ip;
          wss.emit('connection', ws, req);
        });
      }
    }
  });

  wss.on('connection', (ws, req) => {
    ws.on('error', () => {});                                            // MANDATORY: an oversize frame is otherwise an uncaughtException
    const ip = req.clientIp;
    const ipk = hashIp(ip, salt);
    const state = ipState(ip);
    const c = {
      ws, ip, ipk, room: null, pid: null, rx: 0, tx: 0, openedAt: performance.now(), lastRx: performance.now(), stray: 0,
      helloDone: false, forceTimer: null, helloTimer: null,
    };
    sockets.add(c);
    state.conns++;
    state.prejoin++;
    log('info', 'conn_open', { ipk });

    const closeSocket = (code, reason) => {
      try { ws.close(code, reason); } catch { /* already closing */ }
      c.forceTimer ??= setTimeout(() => ws.terminate(), FORCE_CLOSE_MS);
      c.forceTimer.unref();
    };

    const conn = makeConn(ws, closeSocket, c);
    c.conn = conn;

    const failHello = (code) => {
      conn.send(errorFrame(code));
      closeSocket(1000, code);
    };

    /** Puts this socket into `room`; the Room itself sends joined/lobby (and any replays) before join() returns. */
    const enter = (room, msg) => {
      const res = room.join(conn, { name: msg.name, color: msg.color, token: msg.token });
      if (!res.ok) {
        if (res.error === ERR.FULL) manager.recordJoinFailure(ip);
        failHello(res.error);
        return;
      }
      c.room = room;
      c.pid = res.id;
      state.prejoin--;
      clearTimeout(c.helloTimer);
    };

    const startSession = (msg) => {
      if (msg.t === CLIENT_MSG.CREATE) {
        const made = manager.create(ip);
        if (!made.ok) {
          if (made.error === ERR.RATE_LIMITED) log('warn', 'rate_limit', { ipk, kind: 'create' });
          conn.send(errorFrame(made.error, made.error === ERR.RATE_LIMITED ? 'Too many rooms. Wait a moment.' : undefined));
          closeSocket(1000, made.error);
          return;
        }
        enter(made.room, msg);
        if (c.room === null) made.room.close();                          // nobody ever got in: do not leave an empty room around
        return;
      }
      if (manager.joinBlocked(ip)) {
        log('warn', 'rate_limit', { ipk, kind: 'join' });
        failHello(ERR.RATE_LIMITED);
        return;
      }
      const room = CODE_RE.test(msg.code) ? manager.find(msg.code) : null;
      if (room) {
        enter(room, msg);
      } else {
        manager.recordJoinFailure(ip);
        failHello(ERR.NO_ROOM);
      }
    };

    c.helloTimer = setTimeout(() => closeSocket(1008, 'hello timeout'), timeouts.HELLO_MS);

    // Before hello: the first valid create/join starts the session, anything else valid-but-useless counts against a small allowance.
    const handleStranger = (text) => {
      const parsed = parseClientMessage(text);
      if (!parsed.ok) {
        failHello(parsed.code);
      } else if (parsed.msg.t === CLIENT_MSG.CREATE || parsed.msg.t === CLIENT_MSG.JOIN) {
        c.helloDone = true;
        startSession(parsed.msg);
      } else if (++c.stray > MAX_PREHELLO_FRAMES) {
        closeSocket(1008, 'hello required');
      }
    };

    ws.on('message', (data, isBinary) => {
      c.lastRx = performance.now();
      c.rx += data.length;
      if (isBinary) return;
      try {
        const text = data.toString();
        if (c.room) c.room.receive(c.pid, text, conn);
        else if (!c.helloDone) handleStranger(text);
      } catch (err) {
        log('error', 'ws_error', { ipk, stack: String(err?.stack ?? err) });
        closeSocket(1011, 'server error');
      }
    });

    ws.on('pong', () => { c.lastRx = performance.now(); });

    ws.on('close', (code) => {
      clearTimeout(c.helloTimer);
      clearTimeout(c.forceTimer);
      sockets.delete(c);
      if (!c.room) state.prejoin--;
      if (--state.conns === 0) perIp.delete(ip);
      if (c.room) c.room.disconnect(c.pid, conn);
      log('info', 'conn_close', { ipk, code, ms: Math.round(performance.now() - c.openedAt), rx: c.rx, tx: c.tx });
    });
  });

  // One sweep for all sockets: ping everyone, terminate whoever has been silent for DEAD_MS.
  const sweeper = setInterval(() => {
    const t = performance.now();
    for (const c of sockets) {
      if (t - c.lastRx > timeouts.DEAD_MS) c.ws.terminate();
      else if (c.ws.readyState === WebSocket.OPEN) c.ws.ping();
    }
  }, timeouts.PING_MS);
  sweeper.unref();

  return {
    wss,
    /** Open sockets, joined or not. */
    count: () => sockets.size,
    /** Sockets that never joined a room (rooms tell their own members when they close). */
    closeUnjoined() {
      for (const c of sockets) {
        if (c.room) continue;
        c.conn.send(errorFrame(ERR.CLOSED, 'Server restarting'));
        c.conn.close('restart');
      }
    },
    terminateAll() {
      for (const c of sockets) c.ws.terminate();
    },
    dispose() {
      clearInterval(sweeper);
      wss.close();
    },
  };
}
