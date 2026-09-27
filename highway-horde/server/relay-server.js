// Self-hosted server for Highway Horde (`npm start`):
//   - serves public/ as static files
//   - GET /api/info → { relay: true, version, protocol } so clients know the relay exists
//   - WebSocket relay at /relay: the host creates a room, friends join it by code, and
//     the server forwards frames between them. Works through any NAT because everyone
//     only talks to this server.
//
// Relay wire format (must match public/js/net/transport-relay.js):
//   text frames   JSON control
//     client → server  { t: 'create' } | { t: 'join', code } | { t: 'kick', peer } | { t: 'leave' }
//     server → client  { t: 'created', code } | { t: 'joined', code, peer } | { t: 'error', msg }
//                      { t: 'peer-join', peer } | { t: 'peer-leave', peer, reason } | { t: 'closed', reason }
//   binary frames app data; byte 0 = channel (0 'ctl' JSON as UTF-8, 1 'state' binary)
//     host → server    [channel][peer u16 LE][payload]   peer 0 = every client in the room
//     server → host    [channel][peer u16 LE][payload]   peer = sender
//     client ↔ server  [channel][payload]
//
// Only imports shared/constants.js from the game code (the rest is browser-only).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  GAME_VERSION, PROTOCOL_VERSION, MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
} from '../public/js/shared/constants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

const CH_CTL = 0;
const CH_STATE = 1;
const CLOSE_HOST_LEFT = 4000;
const CLOSE_KICKED = 4001;
const CLOSE_IDLE = 4002;
const CLOSE_POLICY = 1008;
/**
 * Skip a 'state' frame to a socket that already has more than a few waiting (it is
 * lagging): stale snapshots queued behind each other only add seconds of delay.
 */
const STATE_BACKLOG_MIN = 32 * 1024;
const STATE_BACKLOG_FRAMES = 3;
const MAX_CONTROL_BYTES = 1024;
const MAX_JOIN_ATTEMPTS = 20;

const DEFAULTS = {
  publicDir: DEFAULT_PUBLIC_DIR,
  maxRooms: 500,
  maxPeersPerRoom: MAX_PLAYERS,       // including the host
  maxFrameBytes: 64 * 1024,
  maxConnections: 3000,
  heartbeatMs: 15000,                 // ping interval; a socket missing one pong is dropped
  idleMs: 30000,                      // sockets must create/join a room within this
  rate: { msgsPerSec: 300, msgBurst: 600, bytesPerSec: 3 * 1024 * 1024, byteBurst: 6 * 1024 * 1024 },
  log: true,
};

/**
 * A room host sends every roster, chat line and snapshot for up to maxPeersPerRoom - 1
 * clients (one frame each while a client is still in its handshake): it gets that many
 * times a client's budget.
 */
function hostRate(rate, peers) {
  const k = Math.max(1, peers);
  return { ...rate, msgsPerSec: rate.msgsPerSec * k, msgBurst: rate.msgBurst * k, bytesPerSec: rate.bytesPerSec * k, byteBurst: rate.byteBurst * k };
}

/** Token bucket for messages and bytes; refills continuously. */
class RateLimiter {
  constructor(rate) {
    this.rate = rate;
    this.msgs = rate.msgBurst;
    this.bytes = rate.byteBurst;
    this.last = Date.now();
    this.dropped = 0;
    this.droppedSince = this.last;
  }

  /** @returns {boolean} true if the message may pass */
  take(bytes) {
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const r = this.rate;
    this.msgs = Math.min(r.msgBurst, this.msgs + dt * r.msgsPerSec);
    this.bytes = Math.min(r.byteBurst, this.bytes + dt * r.bytesPerSec);
    if (now - this.droppedSince > 1000) {
      this.dropped = 0;
      this.droppedSince = now;
    }
    if (this.msgs < 1 || this.bytes < bytes) {
      this.dropped++;
      return false;
    }
    this.msgs -= 1;
    this.bytes -= bytes;
    return true;
  }

  /** Far over the limit for a whole second: treat as abuse. */
  get abusive() {
    return this.dropped > this.rate.msgsPerSec * 2;
  }
}

function randomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

/**
 * Build (but do not start) the HTTP + WebSocket relay server.
 * @param {object} [options] overrides of DEFAULTS
 * @returns {{ server: http.Server, wss: WebSocketServer, rooms: Map, listen: Function, close: Function }}
 */
export function createRelayServer(options = {}) {
  const opts = { ...DEFAULTS, ...options, rate: { ...DEFAULTS.rate, ...(options.rate || {}) } };
  const root = path.resolve(opts.publicDir);
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    // Missing public dir: every static request 404s.
  }
  const log = opts.log ? (...a) => console.log('[relay]', ...a) : () => {};
  /** code → { code, host, clients: Map<peer, conn>, nextPeer } */
  const rooms = new Map();
  /** ws → conn state */
  const conns = new Map();

  // ---- static files ------------------------------------------------------------

  function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    if (pathname === '/api/info' || pathname === '/api/info/') {
      const body = JSON.stringify({ relay: true, version: GAME_VERSION, protocol: PROTOCOL_VERSION });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // Null bytes, backslashes and dot-segments never name a legitimate file here.
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((s) => s.startsWith('.'))) {
      notFound(res);
      return;
    }
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      notFound(res);
      return;
    }
    resolveFile(target, (file, stat) => {
      if (!file) {
        notFound(res);
        return;
      }
      sendFile(req, res, file, stat);
    });
  }

  function resolveFile(target, cb) {
    fs.realpath(target, (err, real) => {
      // A symlink must not lead outside public/.
      if (err || (real !== realRoot && !real.startsWith(realRoot + path.sep))) {
        cb(null);
        return;
      }
      fs.stat(real, (err2, stat) => {
        if (err2) {
          cb(null);
          return;
        }
        if (stat.isDirectory()) {
          const index = path.join(real, 'index.html');
          fs.stat(index, (err3, st3) => (err3 || !st3.isFile() ? cb(null) : cb(index, st3)));
          return;
        }
        cb(stat.isFile() ? real : null, stat);
      });
    });
  }

  function sendFile(req, res, file, stat) {
    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const rel = path.relative(realRoot, file).split(path.sep).join('/');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Game modules must match each other across host and clients: always revalidate.
      // The vendored library never changes between deploys of the same version.
      'Cache-Control': rel.startsWith('vendor/') ? 'public, max-age=86400' : 'no-cache',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end('Not found');
  }

  const server = http.createServer(serveStatic);
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });

  // ---- relay ------------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: opts.maxFrameBytes, perMessageDeflate: false });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      // Falls through to the 404 below.
    }
    if (pathname !== '/relay' || conns.size >= opts.maxConnections) {
      socket.end(`HTTP/1.1 ${pathname === '/relay' ? '503 Service Unavailable' : '404 Not Found'}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    const conn = {
      ws, room: null, role: null, peer: 0, alive: true, since: Date.now(),
      limiter: new RateLimiter(opts.rate), joinAttempts: 0,
    };
    conns.set(ws, conn);
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on('close', () => onClose(conn));
    ws.on('error', () => {
      // 'close' follows (oversize frames, protocol errors); nothing else to do.
    });
  });

  function onMessage(conn, data, isBinary) {
    conn.alive = true;
    const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (!conn.limiter.take(buf.length)) {
      // Closing a host would end the game for everyone in its room: its excess is only dropped.
      if (conn.limiter.abusive && conn.role !== 'host') conn.ws.close(CLOSE_POLICY, 'Rate limit exceeded');
      return;
    }
    if (!isBinary) {
      if (buf.length > MAX_CONTROL_BYTES) return;
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') onControl(conn, msg);
      return;
    }
    const room = conn.room;
    if (!room || buf.length < 1) return;
    const channel = buf[0];
    if (channel !== CH_CTL && channel !== CH_STATE) return;
    if (conn.role === 'host') {
      if (buf.length < 3) return;
      const target = buf.readUInt16LE(1);
      const out = Buffer.allocUnsafe(buf.length - 2);
      out[0] = channel;
      buf.copy(out, 1, 3);
      if (target === 0) {
        for (const c of room.clients.values()) forward(c.ws, out, channel);
      } else {
        const c = room.clients.get(target);
        if (c) forward(c.ws, out, channel);
      }
    } else {
      const out = Buffer.allocUnsafe(buf.length + 2);
      out[0] = channel;
      out.writeUInt16LE(conn.peer, 1);
      buf.copy(out, 3, 1);
      forward(room.host.ws, out, channel);
    }
  }

  function forward(ws, frame, channel) {
    if (ws.readyState !== ws.OPEN) return;
    if (channel === CH_STATE && ws.bufferedAmount > Math.max(STATE_BACKLOG_MIN, STATE_BACKLOG_FRAMES * frame.length)) return;
    ws.send(frame, { binary: true });
  }

  function onControl(conn, msg) {
    switch (msg.t) {
      case 'create': {
        if (conn.room) {
          sendJson(conn.ws, { t: 'error', msg: 'Already in a room' });
          return;
        }
        if (rooms.size >= opts.maxRooms) {
          sendJson(conn.ws, { t: 'error', msg: 'Server is full' });
          return;
        }
        let code = randomCode();
        for (let i = 0; rooms.has(code) && i < 100; i++) code = randomCode();
        if (rooms.has(code)) {
          sendJson(conn.ws, { t: 'error', msg: 'Server is full' });
          return;
        }
        const room = { code, host: conn, clients: new Map(), nextPeer: 1 };
        rooms.set(code, room);
        conn.room = room;
        conn.role = 'host';
        conn.limiter = new RateLimiter(hostRate(opts.rate, opts.maxPeersPerRoom - 1));
        sendJson(conn.ws, { t: 'created', code });
        log(`room ${code} created (${rooms.size} rooms)`);
        return;
      }
      case 'join': {
        if (conn.room) {
          sendJson(conn.ws, { t: 'error', msg: 'Already in a room' });
          return;
        }
        if (++conn.joinAttempts > MAX_JOIN_ATTEMPTS) {
          conn.ws.close(CLOSE_POLICY, 'Too many attempts');
          return;
        }
        const code = typeof msg.code === 'string' ? msg.code.toUpperCase().replace(/[\s-]/g, '') : '';
        const room = rooms.get(code);
        if (!room) {
          sendJson(conn.ws, { t: 'error', msg: 'Room not found' });
          return;
        }
        if (1 + room.clients.size >= opts.maxPeersPerRoom) {
          sendJson(conn.ws, { t: 'error', msg: 'Room is full' });
          return;
        }
        let peer = room.nextPeer;
        while (room.clients.has(peer)) peer = peer >= 65535 ? 1 : peer + 1;
        room.nextPeer = peer >= 65535 ? 1 : peer + 1;
        room.clients.set(peer, conn);
        conn.room = room;
        conn.role = 'client';
        conn.peer = peer;
        sendJson(conn.ws, { t: 'joined', code, peer });
        sendJson(room.host.ws, { t: 'peer-join', peer });
        return;
      }
      case 'kick': {
        if (conn.role !== 'host') return;
        const c = conn.room.clients.get(msg.peer);
        if (!c) return;
        sendJson(c.ws, { t: 'closed', reason: 'Kicked' });
        leaveRoom(c, 'kicked');
        c.ws.close(CLOSE_KICKED, 'Kicked');
        return;
      }
      case 'leave':
        conn.ws.close(1000, 'Bye');
        return;
      default:
    }
  }

  function leaveRoom(conn, reason) {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    if (conn.role === 'host') {
      rooms.delete(room.code);
      for (const c of room.clients.values()) {
        c.room = null;
        sendJson(c.ws, { t: 'closed', reason: 'Host left the game' });
        c.ws.close(CLOSE_HOST_LEFT, 'Host left');
      }
      room.clients.clear();
      log(`room ${room.code} closed (${rooms.size} rooms)`);
    } else if (room.clients.get(conn.peer) === conn) {
      room.clients.delete(conn.peer);
      sendJson(room.host.ws, { t: 'peer-leave', peer: conn.peer, reason });
    }
  }

  function onClose(conn) {
    conns.delete(conn.ws);
    leaveRoom(conn, 'left');
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const conn of conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      if (!conn.room && now - conn.since > opts.idleMs) {
        conn.ws.close(CLOSE_IDLE, 'Idle');
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        // Closing already.
      }
    }
  }, opts.heartbeatMs);
  heartbeat.unref?.();

  return {
    server,
    wss,
    rooms,
    /** @returns {Promise<number>} the bound port */
    listen(port = 8080, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    /** Stop accepting, drop every socket, resolve when closed. */
    close() {
      clearInterval(heartbeat);
      for (const conn of conns.values()) conn.ws.terminate();
      conns.clear();
      rooms.clear();
      wss.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  const relay = createRelayServer({
    maxRooms: Number(process.env.RELAY_MAX_ROOMS) || DEFAULTS.maxRooms,
  });
  relay.listen(port, process.env.HOST || undefined).then((p) => {
    console.log(`[relay] Highway Horde ${GAME_VERSION} serving ${DEFAULT_PUBLIC_DIR}`);
    console.log(`[relay] open http://localhost:${p}/ (relay at ws://localhost:${p}/relay)`);
  }, (err) => {
    console.error('[relay] could not start:', err.message);
    process.exit(1);
  });
  const shutdown = () => relay.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
