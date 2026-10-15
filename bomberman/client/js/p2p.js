// p2p.js - "no server" online play for the single-file download (docs: README "Just want one file?").
//
// The downloadable blast-party.html cannot run a WebSocket server, so one player's browser HOSTS: it runs the ordinary authoritative
// Room (shared/room.js, the same class the Node server and Practice mode use) and every friend talks to it over a WebRTC data channel.
// There is no signalling server either: the two browsers swap two short text codes through any chat app.
//
//     host  "Add a friend"  -> INVITE code (BP1-...)  -> friend pastes it -> REPLY code -> host pastes it -> connected
//
// This module is loaded lazily (dynamic import) and only when window.__BP_SINGLE__ is set, so the served build never runs any of it.
//
// WHAT IS HERE
//   Codes         encodeSignal / decodeSignal / extractCode / cleanSdp: a versioned, compressed, checksummed one-line text form of a
//                 non-trickle SDP, and the strict validation every pasted code goes through BEFORE it reaches RTCPeerConnection.
//   Ticker        createTicker: timers that keep running in a hidden tab (a Blob Web Worker), with a plain-timer fallback.
//   HostSession   owns the Room; adapts each friend's RTCDataChannel to a Room `conn` exactly the way server/ws.js adapts a socket
//                 (hello deadline, first-frame handling, payload cap, backpressure, dead-peer sweep); HostConnection is the host's own
//                 player, behind the same interface net.js's WebSocketConnection has.
//   GuestSession  the friend's side of the handshake; GuestConnection is that interface over the data channel (ping, liveness, joined gate).
//
// Everything environmental (RTCPeerConnection, Worker, clock, Room) is injectable, which is how specs/unit/p2p.spec.js runs the peer
// logic in Node. Importing this file touches no global.

import { Room, errorFrame } from '../../shared/room.js';
import { parseClientMessage, MAX_RAW_LEN, ERR } from '../../shared/protocol.js';
import { TIMEOUTS, WIRE_VERSION } from '../../shared/constants.js';

// ---- Constants ---------------------------------------------------------------------------------------------------

export const CODE_PREFIX = 'BP1-';
export const ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
  Object.freeze({ urls: 'stun:stun.cloudflare.com:3478' }),
]);
export const ROOM_CODE = 'P2P';                         // the Room's `code` (not a valid 4-letter room code on purpose: no link, no QR, no stored session)
export const MAX_PASTE_CHARS = 20000;                   // what a text box may hand to extractCode at most
export const MAX_BLOB_BYTES = 6144;                     // decoded JSON of a code
export const MAX_SDP_CHARS = 4800;
export const MAX_SDP_LINES = 80;
export const MAX_CANDIDATES = 30;

const GATHER_MS = 4000;                                 // ICE gathering budget: without internet the STUN servers never answer
const SRFLX_GRACE_MS = 350;                             // once a public candidate is in, the rest is a formality
const INVITE_TTL_MS = 10 * 60 * 1000;                   // a host keeps an unanswered invite this long
const MAX_PENDING_INVITES = 6;
const CONNECT_MS = 25000;                               // from "reply applied" to an open channel
const GUEST_WAIT_MS = 10 * 60 * 1000;                   // a guest waits this long for the host to paste the reply
const HELLO_MS = 10000;
const MAX_PREHELLO_FRAMES = 8;
const MAX_BAD_FRAMES = 40;
const RATE_BURST = 300;                                 // per friend: inbound frames a channel may burst ...
const RATE_PER_S = 150;                                 // ... and sustain (a real client sends ~60 input frames a second at most)
const WAIT_HINT_MS = 60 * 1000;                         // a guest that has waited this long for the host is told what to check
const SWEEP_MS = 2000;
const DEAD_MS = 25000;                                  // the host drops a friend it has not heard from for this long (a phone put in a pocket for a while survives)
const GUEST_DEAD_MS = 10000;
const GUEST_PING_MS = 2000;
const SKIP_SNAPSHOT_ABOVE = 128 * 1024;
const TERMINATE_ABOVE = 1024 * 1024;
const SNAPSHOT_PREFIX = '{"t":"snap"';
const MAX_MESSAGE_CHARS = MAX_RAW_LEN;

/** Longer graces than the server's: a friend whose link dropped needs a whole new handshake through a chat app. */
export const P2P_TIMEOUTS = Object.freeze({ GRACE_LOBBY_MS: 5 * 60 * 1000, GRACE_MATCH_MS: 2 * 60 * 1000, IDLE_LOBBY_MS: 60 * 60 * 1000 });

export const WAIT_HINT = 'Still waiting. Each invite code works for one person only: if nothing happens soon, ask the host for a fresh code and start again.';
export const WAIT_FAILED = 'This network is not connecting yet. If the host already added you, your networks may not allow it (see the tips in the README); otherwise wait for them to paste your reply code.';
export const NAT_HELP = 'Connecting straight to a friend does not work on every network. Strict routers, school or work networks and some mobile data plans block it, and this file has no relay server. '
  + 'Things to try: sit on the same Wi-Fi, switch off any VPN, or ask the host to run the Blast Party server instead (npm start) and share its link.';

// ---- Errors the player can read ---------------------------------------------------------------------------------------

export class SignalError extends Error {
  /** @param {string} code short machine name, @param {string} message plain language for the player */
  constructor(code, message) {
    super(message);
    this.name = 'SignalError';
    this.code = code;
  }
}

const E = {
  empty: () => new SignalError('empty', 'Paste the code first. It starts with BP1-'),
  notCode: () => new SignalError('not_code', "That doesn't look like a Blast Party code. Copy the whole code, from BP1- to the end, and paste it again."),
  damaged: () => new SignalError('damaged', 'That code looks cut short or changed on the way. Ask for it again and copy all of it.'),
  version: () => new SignalError('version', 'That code comes from another version of Blast Party. You both need to use the same file.'),
  tooBig: () => new SignalError('too_big', 'That code is too long to be a Blast Party code.'),
  notOffer: () => new SignalError('wrong_kind', 'This code is a reply. Paste it on the host side (Add a friend), not here.'),
  notAnswer: () => new SignalError('wrong_kind', "This code is for joining. Send it to your friend, then paste THEIR reply code here."),
  bad: (why) => new SignalError('invalid', `That code is not valid (${why}). Ask for a fresh one.`),
  unknownInvite: () => new SignalError('unknown_invite', 'That reply belongs to a different invite, or the invite ran out. Press "New code", send the new code and use the new reply.'),
  browser: () => new SignalError('browser', 'Your browser could not use that code. Ask for a new one and try again.'),
  noUnpack: () => new SignalError('no_unpack', 'This code is compressed and your browser is too old to open it. Use a recent Chrome, Edge, Firefox or Safari.'),
  noAddress: () => new SignalError('no_address', 'Your browser found no network address to put in the code. Check that you are online (Wi-Fi or cable), switch off any VPN, then press "New code".'),
  noRtc: () => new SignalError('no_rtc', 'This browser cannot connect to friends directly. Try a recent Chrome, Edge, Firefox or Safari.'),
};

// ---- Base64url, checksum ----------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CHECK_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // no 0/O/1/I: the checksum is the part people retype

export function b64urlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

const B64_INDEX = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** @returns {Uint8Array | null} null for anything that is not clean base64url (no padding, no other characters). */
export function b64urlDecode(text) {
  const n = text.length;
  if (n % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    let acc = 0;
    let bits = 0;
    for (let j = 0; j < 4 && i + j < n; j++) {
      const c = text.charCodeAt(i + j);
      const v = c < 128 ? B64_INDEX[c] : -1;
      if (v < 0) return null;
      acc = (acc << 6) | v;
      bits += 6;
    }
    acc <<= 24 - bits;
    if (o < out.length) out[o++] = (acc >> 16) & 255;
    if (bits >= 12 && o < out.length) out[o++] = (acc >> 8) & 255;
    if (bits >= 18 && o < out.length) out[o++] = acc & 255;
  }
  return out;
}

/** 4 unambiguous characters (20 bits) of FNV-1a over the payload text: catches truncation and typos before any decompression. */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CHECK_ALPHABET[h & 31];
    h >>>= 5;
  }
  return out;
}

// ---- Compression -------------------------------------------------------------------------------------------------------

async function pipeBytes(bytes, stream, limit) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = writer.write(bytes).then(() => writer.close());
  writing.catch(() => {});
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        reader.cancel().catch(() => {});
        throw E.tooBig();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function deflate(bytes) {
  try {
    return await pipeBytes(bytes, new CompressionStream('deflate-raw'), 1 << 20);
  } catch {
    return null;
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') throw E.noUnpack();
  try {
    return await pipeBytes(bytes, new DecompressionStream('deflate-raw'), MAX_BLOB_BYTES);
  } catch (err) {
    if (err instanceof SignalError) throw err;
    throw E.damaged();
  }
}

// ---- SDP validation ----------------------------------------------------------------------------------------------------

const ADDR = '(?:[0-9a-fA-F:.]{2,45}|[A-Za-z0-9-]{1,63}(?:\\.[A-Za-z0-9-]{1,63}){0,4}\\.local)';
const CANDIDATE_RE = new RegExp(
  `^a=candidate:[A-Za-z0-9+/]{1,32} [12] (?:udp|tcp|UDP|TCP) \\d{1,10} ${ADDR} \\d{1,5} typ (?:host|srflx|prflx|relay)`
  + `(?: raddr ${ADDR} rport \\d{1,5})?(?: tcptype (?:active|passive|so))?(?: generation \\d{1,3})?(?: ufrag [A-Za-z0-9+/]{1,256})?`
  + `(?: network-id \\d{1,4})?(?: network-cost \\d{1,4})?$`,
);
const SDP_LINES = [
  /^v=0$/,
  /^o=(?:-|[\x21-\x7e]{1,64}) \d{1,20} \d{1,20} IN IP[46] [0-9a-fA-F:.]{2,45}$/,   // (Firefox puts its whole version in the name)
  /^s=[\x20-\x7e]{0,40}$/,
  /^t=0 0$/,
  /^c=IN IP[46] [0-9a-fA-F:.]{2,45}$/,
  /^m=application \d{1,5} (?:UDP\/)?DTLS\/SCTP (?:webrtc-datachannel|\d{1,5})$/,
  /^a=group:BUNDLE [0-9a-z ]{1,24}$/,
  /^a=msid-semantic:[\x20-\x7e]{0,24}$/,
  /^a=ice-ufrag:[A-Za-z0-9+/]{4,256}$/,
  /^a=ice-pwd:[A-Za-z0-9+/]{22,256}$/,
  /^a=ice-options:[a-z0-9 ]{1,40}$/,
  /^a=fingerprint:sha-(?:256|384|512) (?:[0-9A-Fa-f]{2}:){31,63}[0-9A-Fa-f]{2}$/,
  /^a=setup:(?:actpass|active|passive)$/,
  /^a=mid:[0-9a-z]{1,8}$/,
  /^a=sctp-port:\d{1,5}$/,
  /^a=sctpmap:\d{1,5} webrtc-datachannel \d{1,5}$/,
  /^a=max-message-size:\d{1,10}$/,
  /^a=end-of-candidates$/,
  /^a=extmap-allow-mixed$/,
  /^a=sendrecv$/,
];
// Attributes that matter for the connection: when one of these is malformed the code is refused. Any OTHER well-formed attribute
// (a browser's own extras: direction, rtcp-mux, ...) or a bandwidth line is simply left out of what reaches RTCPeerConnection.
const STRICT_ATTRS = new Set(['candidate', 'group', 'msid-semantic', 'ice-ufrag', 'ice-pwd', 'ice-options', 'fingerprint', 'setup', 'mid', 'sctp-port', 'sctpmap', 'max-message-size', 'end-of-candidates', 'extmap-allow-mixed', 'sendrecv']);
const EXTRA_ATTR = /^a=([a-z][a-z0-9-]{0,39})(?::[\x21-\x7e ]{0,200})?$/;
const EXTRA_BANDWIDTH = /^b=[A-Z]{2,4}:\d{1,10}$/;

/**
 * Checks a data-channel-only SDP (lines separated by \n) against an allow-list and returns it cleaned. Anything dangerous - a media section,
 * a control character, an oversize line, a malformed line of a kind that matters - is refused; harmless extra attributes are dropped.
 * Throws SignalError. @returns {{ sdp: string, candidates: number, dropped: number }} `sdp` uses \n line ends
 * @param {string} sdp @param {'offer'|'answer'} type
 */
export function cleanSdp(sdp, type) {
  if (typeof sdp !== 'string' || sdp.length < 60) throw E.bad('empty connection details');
  if (sdp.length > MAX_SDP_CHARS) throw E.tooBig();
  const lines = sdp.replace(/\n$/, '').split('\n');
  if (lines.length > MAX_SDP_LINES) throw E.bad('too many lines');
  let media = 0;
  let candidates = 0;
  let dropped = 0;
  const seen = new Set();
  const kept = [];
  let setup = '';
  for (const line of lines) {
    if (line.length > 400 || !/^[\x20-\x7e]+$/.test(line)) throw E.bad('unexpected characters');
    if (line.startsWith('a=candidate:')) {
      if (!CANDIDATE_RE.test(line)) throw E.bad('a connection address is malformed');
      if (++candidates > MAX_CANDIDATES) throw E.bad('too many addresses');
      kept.push(line);
      continue;
    }
    if (!SDP_LINES.some((re) => re.test(line))) {
      const extra = EXTRA_ATTR.exec(line);
      if ((extra && !STRICT_ATTRS.has(extra[1])) || EXTRA_BANDWIDTH.test(line)) {
        dropped++;
        continue;
      }
      throw E.bad(`unexpected line "${line.slice(0, 24)}"`);
    }
    if (line.startsWith('m=')) media++;
    if (line.startsWith('a=setup:')) setup = line.slice(8);
    seen.add(line.slice(0, line.indexOf(':') > 0 && line.startsWith('a=') ? line.indexOf(':') : 2));
    kept.push(line);
  }
  if (lines[0] !== 'v=0' || media !== 1) throw E.bad('wrong shape');
  for (const need of ['a=ice-ufrag', 'a=ice-pwd', 'a=fingerprint']) if (!seen.has(need)) throw E.bad('missing details');
  if (type === 'offer' ? setup !== 'actpass' : setup !== 'active' && setup !== 'passive') throw E.bad('wrong role');
  return { sdp: `${kept.join('\n')}\n`, candidates, dropped };
}

/** The number of connection addresses in a valid SDP (throws like cleanSdp). */
export const checkSdp = (sdp, type) => cleanSdp(sdp, type).candidates;

// ---- Codes -------------------------------------------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9]{6,16}$/;

function randomId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return b64urlEncode(bytes).replace(/[-_]/g, 'x');
}

/**
 * The one-line text form of a session description.
 * @param {{ type: 'offer'|'answer', sdp: string, id: string, host?: string, game?: string }} sig (game: which hosted game an offer belongs to)
 * @returns {Promise<string>} `BP1-<base64url>.<CHECK>`
 */
export async function encodeSignal({ type, sdp, id, host = '', game = '' }) {
  const blob = { v: 1, t: type === 'offer' ? 'o' : 'a', i: id, s: String(sdp).replace(/\r\n/g, '\n').replace(/\r/g, '\n') };
  if (type === 'offer' && host) blob.h = String(host).slice(0, 24);
  if (type === 'offer' && game) blob.g = game;
  const raw = new TextEncoder().encode(JSON.stringify(blob));
  let flag = 0;
  let body = raw;
  if (canCompress()) {
    const packed = await deflate(raw);
    if (packed && packed.length < raw.length) {
      flag = 1;
      body = packed;
    }
  }
  const bytes = new Uint8Array(body.length + 1);
  bytes[0] = flag;
  bytes.set(body, 1);
  const payload = b64urlEncode(bytes);
  return `${CODE_PREFIX}${payload}.${checksum(payload)}`;
}

const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;
const DASHES = /[‐-―−﹘﹣－]/g;

/**
 * Finds a Blast Party code in whatever the player pasted: inside a sentence, wrapped over several lines, with smart quotes, invisible
 * characters or fancy dashes. The code ends at its own checksum, so words after it are ignored. Returns the canonical text or ''.
 */
export function extractCode(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw.slice(0, MAX_PASTE_CHARS).replace(INVISIBLE, '').replace(DASHES, '-');
  const start = text.search(/BP1-/i);
  if (start < 0) return '';
  let payload = '';
  let i = start + CODE_PREFIX.length;
  for (; i < text.length; i++) {
    const c = text[i];
    if (/[A-Za-z0-9_-]/.test(c)) payload += c;
    else if (/\s/.test(c)) continue;
    else break;
  }
  if (text[i] !== '.') return '';
  let check = '';
  for (i++; i < text.length && check.length < 4; i++) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    if (!/[A-Za-z0-9]/.test(c)) break;
    check += c.toUpperCase();
  }
  return check.length === 4 && payload.length > 0 ? `${CODE_PREFIX}${payload}.${check}` : '';
}

/**
 * Reads a pasted code. Never throws anything but SignalError.
 * @param {string} text the paste @param {'offer'|'answer'} [expected] which kind the caller wants (a friendly error otherwise)
 * @returns {Promise<{ type: 'offer'|'answer', sdp: string, id: string, host: string, game: string }>} `sdp` uses \r\n line ends
 */
export async function decodeSignal(text, expected) {
  if (typeof text !== 'string' || text.trim() === '') throw E.empty();
  if (text.length > MAX_PASTE_CHARS) throw E.tooBig();
  const code = extractCode(text);
  if (!code) {
    // "BP2-..." and friends: a code from a later version
    if (/BP\d+-/i.test(text) && !/BP1-/i.test(text)) throw E.version();
    throw /BP1-/i.test(text) ? E.damaged() : E.notCode();
  }
  const dot = code.lastIndexOf('.');
  const payload = code.slice(CODE_PREFIX.length, dot);
  if (checksum(payload) !== code.slice(dot + 1)) throw E.damaged();
  if (payload.length > MAX_BLOB_BYTES * 2) throw E.tooBig();
  const bytes = b64urlDecode(payload);
  if (!bytes || bytes.length < 2) throw E.damaged();
  const body = bytes.subarray(1);
  let json;
  if (bytes[0] === 1) json = await inflate(body);
  else if (bytes[0] === 0) json = body;
  else throw E.version();
  if (json.length > MAX_BLOB_BYTES) throw E.tooBig();
  let blob;
  try {
    blob = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    throw E.damaged();
  }
  return validateBlob(blob, expected);
}

/** The strict shape check of a decoded code (JSON.parse output, i.e. untrusted). Exported for the specs. */
export function validateBlob(blob, expected) {
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) throw E.bad('wrong shape');
  const keys = Object.keys(blob);
  if (keys.some((k) => !['v', 't', 'i', 's', 'h', 'g'].includes(k))) throw E.bad('unknown fields');
  if (blob.v !== 1) throw E.version();
  if (blob.t !== 'o' && blob.t !== 'a') throw E.bad('unknown kind');
  const type = blob.t === 'o' ? 'offer' : 'answer';
  if (expected && type !== expected) throw type === 'answer' ? E.notOffer() : E.notAnswer();
  if (typeof blob.i !== 'string' || !ID_RE.test(blob.i)) throw E.bad('bad id');
  let host = '';
  if (blob.h !== undefined) {
    if (type !== 'offer' || typeof blob.h !== 'string' || blob.h.length > 24) throw E.bad('bad name');
    host = blob.h.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  }
  let game = '';
  if (blob.g !== undefined) {
    if (type !== 'offer' || typeof blob.g !== 'string' || !ID_RE.test(blob.g)) throw E.bad('bad game id');
    game = blob.g;
  }
  const clean = cleanSdp(blob.s, type);
  return { type, id: blob.i, host, game, sdp: `${clean.sdp.replace(/\n$/, '').split('\n').join('\r\n')}\r\n` };
}

// ---- ICE gathering -----------------------------------------------------------------------------------------------------

/** Resolves when the peer connection has all its candidates, or after `ms`, or shortly after the first public one. Returns milliseconds spent. */
export function gatherCandidates(pc, ms = GATHER_MS, { setTimer = (fn, t) => setTimeout(fn, t), clearTimer = (h) => clearTimeout(h), now = () => Date.now() } = {}) {
  const t0 = now();
  return new Promise((resolve) => {
    let done = false;
    let soon = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimer(hard);
      clearTimer(soon);
      pc.removeEventListener?.('icegatheringstatechange', onState);
      pc.removeEventListener?.('icecandidate', onCandidate);
      resolve(now() - t0);
    };
    const onState = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const onCandidate = (e) => {
      if (!e.candidate) finish();
      else if (soon === null && /\btyp srflx\b/.test(e.candidate.candidate ?? '')) soon = setTimer(finish, SRFLX_GRACE_MS);
    };
    const hard = setTimer(finish, ms);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
    if (pc.iceGatheringState === 'complete') finish();
  });
}

// ---- A ticker that survives a hidden tab -------------------------------------------------------------------------------

const WORKER_SOURCE = "const t=new Map();onmessage=(e)=>{const m=e.data;if(m[0]==='s'){t.set(m[1],setTimeout(()=>{t.delete(m[1]);postMessage(m[1]);},m[2]));}"
  + "else if(m[0]==='c'){clearTimeout(t.get(m[1]));t.delete(m[1]);}else if(m[0]==='x'){t.forEach((h)=>clearTimeout(h));t.clear();}};";

/**
 * setTimer/clearTimer with the signature Room wants. A hidden tab throttles page timers to once a second (which would make a hosted match
 * crawl), but timers inside a dedicated Web Worker keep their pace, so they run in a Blob worker. Where Workers or Blob URLs are blocked,
 * or the worker does not answer, everything quietly falls back to plain timers (`kind` says which is in use).
 * @param {{ Worker?: Function, Blob?: Function, URL?: object, setTimeout?: Function, clearTimeout?: Function, now?: () => number, probeMs?: number }} [env]
 */
export function createTicker(env = globalThis) {
  const setT = (fn, ms) => (env.setTimeout ?? setTimeout)(fn, ms);
  const clearT = (h) => (env.clearTimeout ?? clearTimeout)(h);
  const clock = env.now ?? (() => performance.now());
  const pending = new Map();               // id -> { fn, at, plain }
  let seq = 0;
  let worker = null;
  let url = '';
  let probe = null;
  const ticker = { kind: 'timers', setTimer, clearTimer, dispose };

  function plain(id, entry) {
    entry.plain = setT(() => {
      pending.delete(id);
      entry.fn();
    }, Math.max(0, entry.at - clock()));
  }

  function fallback() {
    if (worker === null && ticker.kind === 'timers') return;
    ticker.kind = 'timers';
    stopWorker();
    for (const [id, entry] of pending) plain(id, entry);
  }

  function stopWorker() {
    try { worker?.terminate(); } catch { /* gone already */ }
    worker = null;
    try { if (url) env.URL.revokeObjectURL(url); } catch { /* nothing to revoke */ }
    url = '';
  }

  function setTimer(fn, ms) {
    const id = ++seq;
    const entry = { fn, at: clock() + ms, plain: null };
    pending.set(id, entry);
    if (worker) worker.postMessage(['s', id, ms]);
    else plain(id, entry);
    return id;
  }

  function clearTimer(id) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.plain !== null) clearT(entry.plain);
    else worker?.postMessage(['c', id]);
  }

  function dispose() {
    for (const entry of pending.values()) if (entry.plain !== null) clearT(entry.plain);
    pending.clear();
    try { worker?.postMessage(['x']); } catch { /* ignore */ }
    stopWorker();
  }

  try {
    if (typeof env.Worker === 'function' && typeof env.Blob === 'function' && env.URL && typeof env.URL.createObjectURL === 'function') {
      url = env.URL.createObjectURL(new env.Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new env.Worker(url);
      ticker.kind = 'worker';
      worker.onmessage = (e) => {
        const id = e.data;
        if (id === 0) { clearT(probe); return; }                 // the start-up probe answered: the worker really runs
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        try { entry.fn(); } catch (err) { console.error(err); }
      };
      worker.onerror = () => fallback();
      worker.onmessageerror = () => fallback();
      probe = setT(fallback, env.probeMs ?? 1500);
      worker.postMessage(['s', 0, 0]);
    }
  } catch {
    fallback();
  }
  return ticker;
}

// ---- Shared bits ------------------------------------------------------------------------------------------------------

const rtcOf = (env) => {
  const RTC = env.RTCPeerConnection ?? globalThis.RTCPeerConnection;
  if (typeof RTC !== 'function') throw E.noRtc();
  return RTC;
};

const iceServers = (env) => env.iceServers ?? globalThis.__BP_ICE__ ?? ICE_SERVERS;

function safeCall(fn, arg) {
  if (typeof fn !== 'function') return;
  try {
    fn(arg);
  } catch (err) {
    console.error(err);
  }
}

function closeQuietly(pc) {
  try { pc?.close(); } catch { /* already closed */ }
}

// ---- Host: the Room and its friends ------------------------------------------------------------------------------------

/**
 * @typedef {{ type: 'invite', id: string } | { type: 'friend', id: string, state: 'connecting'|'open'|'joined'|'failed'|'lost'|'refused', message?: string, code?: string, pid?: number }
 *   | { type: 'closed' }} HostEvent
 */

export class HostSession {
  /**
   * @param {object} o
   * @param {string} [o.name] the host's name, shown in the invite the friend sees
   * @param {object} [o.env] test seams: RTCPeerConnection, iceServers, now, Room, ticker, gatherMs, connectMs, helloMs
   */
  constructor({ name = 'Host', env = {} } = {}) {
    this.name = name;
    this.gameId = randomId();                  // tells a friend's browser whether a new invite belongs to the game it was in (a seat token is never sent to another)
    this.env = { ...globalThis.__BP_P2P_TEST__, ...env };       // (__BP_P2P_TEST__: a spec can shorten the timeouts of a real page)
    env = this.env;
    this.now = env.now ?? (() => performance.now());
    this.ticker = env.ticker ?? createTicker(env.tickerEnv ?? globalThis);
    this.pending = new Map();                 // invite id -> { pc, dc, created, state, expire }
    this.peers = new Set();
    this.listeners = new Set();
    this.closed = false;
    this.local = null;
    this._sweepHandle = null;
    const RoomClass = env.Room ?? Room;
    this.room = new RoomClass({
      code: ROOM_CODE, now: this.now, setTimer: this.ticker.setTimer, clearTimer: this.ticker.clearTimer,
      timeouts: { ...TIMEOUTS, ...P2P_TIMEOUTS }, onEmpty: () => this._roomGone(),
    });
    this.room.startLoop();
    this._armSweep();
  }

  /** How the Room's clock runs: 'worker' keeps ticking in a background tab, 'timers' does not. */
  get tickerKind() {
    return this.ticker.kind;
  }

  /** Subscribes to HostEvents; returns the unsubscribe function. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(ev) {
    for (const fn of [...this.listeners]) safeCall(fn, ev);
  }

  /** The host's own player, behind the interface main.js uses for every connection. */
  localConnection() {
    this.local ??= new HostConnection(this);
    return this.local;
  }

  /** Friends currently holding a channel (joined or not). */
  get friendCount() {
    let n = 0;
    for (const p of this.peers) if (p.pid !== null && !p.dead) n++;
    return n;
  }

  // ---- Step 1: an invite --------------------------------------------------------------------------------------------

  /** Makes a new RTCPeerConnection and returns its invite code. Slow by up to the gathering budget when there is no internet. */
  async createInvite() {
    if (this.closed) throw new SignalError('closed', 'The game has ended.');
    const RTC = rtcOf(this.env);
    this._expireInvites();
    while (this.pending.size >= MAX_PENDING_INVITES) this._dropInvite(this.pending.keys().next().value);
    const id = randomId();
    const pc = new RTC({ iceServers: iceServers(this.env) });
    const dc = pc.createDataChannel('bp', { ordered: true });
    const entry = { id, pc, dc, created: this.now(), state: 'invite', expire: null, connectTimer: null };
    this.pending.set(id, entry);
    try {
      const gathering = gatherCandidates(pc, this.env.gatherMs ?? GATHER_MS, { now: this.now });   // (listening before the first candidate can appear)
      await pc.setLocalDescription(await pc.createOffer());
      const gatherMs = await gathering;
      if (this.closed || !this.pending.has(id)) throw new SignalError('closed', 'That invite was replaced by a newer one.');
      if (!/^a=candidate:/m.test(pc.localDescription.sdp)) throw E.noAddress();          // (offline, or a privacy setting hides every address: a code would only waste a handshake)
      const code = await encodeSignal({ type: 'offer', sdp: pc.localDescription.sdp, id, host: this.name, game: this.gameId });
      entry.expire = this.ticker.setTimer(() => this._dropInvite(id), INVITE_TTL_MS);
      this._emit({ type: 'invite', id });
      return { id, code, gatherMs };
    } catch (err) {
      this._dropInvite(id);
      throw err instanceof SignalError ? err : E.browser();
    }
  }

  _dropInvite(id) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    this.ticker.clearTimer(entry.expire);
    this.ticker.clearTimer(entry.connectTimer);
    closeQuietly(entry.pc);                   // (an entry whose channel opened has left `pending` already)
  }

  _expireInvites() {
    const t = this.now();
    for (const [id, e] of this.pending) if (e.state === 'invite' && t - e.created > INVITE_TTL_MS) this._dropInvite(id);
  }

  // ---- Step 2: the friend's reply -----------------------------------------------------------------------------------

  /**
   * Reads a pasted reply and starts connecting. Resolves as soon as the browser has accepted it (the connection itself is reported
   * through 'friend' events). Rejects with a SignalError that is fit to show.
   * @returns {Promise<{ id: string }>}
   */
  async acceptReply(text) {
    if (this.closed) throw new SignalError('closed', 'The game has ended.');
    const sig = await decodeSignal(text, 'answer');
    const entry = this.pending.get(sig.id);
    if (!entry || entry.state !== 'invite') throw E.unknownInvite();
    try {
      await entry.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
    } catch {
      throw E.browser();
    }
    entry.state = 'connecting';
    this.ticker.clearTimer(entry.expire);
    const { pc, dc, id } = entry;
    this._emit({ type: 'friend', id, state: 'connecting' });
    const fail = (message) => {
      if (entry.state === 'open' || entry.state === 'failed') return;
      entry.state = 'failed';
      this.ticker.clearTimer(entry.connectTimer);
      this.pending.delete(id);
      closeQuietly(pc);
      this._emit({ type: 'friend', id, state: 'failed', message });
    };
    entry.connectTimer = this.ticker.setTimer(() => fail(NAT_HELP), this.env.connectMs ?? CONNECT_MS);
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') fail(NAT_HELP); });
    pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed') fail(NAT_HELP); });
    const opened = () => {
      if (entry.state !== 'connecting') return;
      entry.state = 'open';
      this.ticker.clearTimer(entry.connectTimer);
      this.pending.delete(id);
      this._emit({ type: 'friend', id, state: 'open' });
      this.adoptChannel(dc, pc, id);
    };
    if (dc.readyState === 'open') queueMicrotask(opened);
    else dc.addEventListener('open', opened, { once: true });
    dc.addEventListener('close', () => fail('The connection closed before it finished. Please try again.'), { once: true });
    return { id };
  }

  /** Whether an invite is still unanswered and young enough to hand out again (the dialog reopened). */
  inviteAlive(id) {
    const e = this.pending.get(id);
    return !!e && e.state === 'invite' && this.now() - e.created < INVITE_TTL_MS - 30000 && e.pc.connectionState !== 'closed';
  }

  /** Forgets an invite the host replaced with a newer one. */
  cancelInvite(id) {
    this._dropInvite(id);
  }

  // ---- One friend's channel -----------------------------------------------------------------------------------------

  /** Turns an open data channel into a Room participant, the way server/ws.js does for a socket. Exposed for the specs. */
  adoptChannel(dc, pc = null, inviteId = '') {
    const peer = new GuestPeer(this, dc, pc, inviteId);
    this.peers.add(peer);
    return peer;
  }

  _roomGone() {
    if (this.closed) return;
    this._emit({ type: 'closed' });
    this.shutdown();
  }

  /** Dead-peer sweep: whoever has been silent for DEAD_MS is dropped (a data channel has no protocol-level ping of its own). */
  _armSweep() {
    let last = this.now();
    const tick = () => {
      this._sweepHandle = null;
      if (this.closed) return;
      const t = this.now();
      const stalled = t - last > SWEEP_MS * 3;            // the host itself was frozen: nobody is judged for the host's own silence
      last = t;
      for (const peer of [...this.peers]) {
        if (stalled) peer.lastRx = t;
        else if (t - peer.lastRx > DEAD_MS) peer.drop('silent');
      }
      this._sweepHandle = this.ticker.setTimer(tick, SWEEP_MS);
    };
    this._sweepHandle = this.ticker.setTimer(tick, SWEEP_MS);
  }

  /** Ends the party: every friend is told and disconnected, every timer stopped. Safe to call twice. */
  shutdown() {
    if (this.closed) return;
    this.closed = true;
    try { this.room.close('closed'); } catch (err) { console.error(err); }
    for (const id of [...this.pending.keys()]) this._dropInvite(id);
    for (const peer of [...this.peers]) peer.drop('shutdown');
    this.ticker.clearTimer(this._sweepHandle);
    this.ticker.dispose();
    this.listeners.clear();
  }
}

/** One friend, seen from the host: the `conn` a Room talks to plus the first-frame rules of server/ws.js. */
class GuestPeer {
  constructor(session, dc, pc, inviteId) {
    this.session = session;
    this.dc = dc;
    this.pc = pc;
    this.inviteId = inviteId;
    this.pid = null;
    this.dead = false;
    this.stray = 0;
    this.bad = 0;
    this.lastRx = session.now();
    this.conn = {
      send: (str) => this._send(str),
      close: (reason) => this._closeChannel(reason),
    };
    dc.addEventListener('message', (ev) => this._onMessage(ev.data));
    dc.addEventListener('close', () => this._gone('closed'));
    dc.addEventListener('error', () => {});
    pc?.addEventListener?.('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._gone('failed'); });
    this.tokens = RATE_BURST;
    this.tokenAt = this.lastRx;
    this.helloTimer = session.ticker.setTimer(() => {
      if (this.pid === null) this._refuse('hello');
    }, session.env.helloMs ?? HELLO_MS);
  }

  /** Snapshots are droppable (a client heals through gv/sync), everything else is always sent; a channel that never drains is closed. */
  _send(str) {
    const dc = this.dc;
    if (this.dead || dc.readyState !== 'open') return;
    const queued = dc.bufferedAmount ?? 0;
    if (queued > TERMINATE_ABOVE) {
      this.drop('backlog');
      return;
    }
    if (queued > SKIP_SNAPSHOT_ABOVE && str.startsWith(SNAPSHOT_PREFIX)) return;
    dc.send(str);
  }

  _closeChannel() {
    if (this.dead) return;
    this.dead = true;
    this.session.ticker.clearTimer(this.helloTimer);
    this.session.peers.delete(this);
    try { this.dc.close(); } catch { /* already closed */ }
    const pc = this.pc;
    if (pc) setTimeout(() => closeQuietly(pc), this.session.env.pcCloseMs ?? 1500);   // let the queued farewell leave first (a plain timer: the ticker may be gone by then)
  }

  /** Ends this friend from the host's side (silent too long, backlog, party over). */
  drop(reason) {
    const room = this.session.room;
    const pid = this.pid;
    this._closeChannel(reason);
    if (pid !== null && !room.closed) room.disconnect(pid, this.conn);
    if (pid !== null && !this.session.closed) this.session._emit({ type: 'friend', id: this.inviteId, state: 'lost', message: reason });
  }

  /** The channel died under us (the other side left, the network dropped). */
  _gone() {
    if (this.dead) return;
    const room = this.session.room;
    const pid = this.pid;
    this.dead = true;
    this.session.ticker.clearTimer(this.helloTimer);
    this.session.peers.delete(this);
    closeQuietly(this.pc);
    if (pid !== null && !room.closed) room.disconnect(pid, this.conn);
    if (pid !== null) this.session._emit({ type: 'friend', id: this.inviteId, state: 'lost' });
  }

  _failHello(code) {
    try { this._send(errorFrame(code)); } catch { /* the channel is going anyway */ }
    this._refuse(code);
  }

  /** The friend's channel opened but the Room would not seat them (locked, full, banned, no hello): the host's dialog must say so. */
  _refuse(code) {
    const wasDead = this.dead;
    this._closeChannel(code);
    if (!wasDead && this.pid === null && !this.session.closed) this.session._emit({ type: 'friend', id: this.inviteId, state: 'refused', code });
  }

  _onMessage(data) {
    if (this.dead) return;
    const t = this.session.now();
    this.lastRx = t;
    if (typeof data === 'string' && data.length > MAX_MESSAGE_CHARS) {
      this.drop('oversize');                                    // (the server's maxPayload closes on the first oversize frame too)
      return;
    }
    if (typeof data !== 'string') {
      if (++this.bad > MAX_BAD_FRAMES) this.drop('flood');
      return;
    }
    this.tokens = Math.min(RATE_BURST, this.tokens + ((t - this.tokenAt) * RATE_PER_S) / 1000);
    this.tokenAt = t;
    if (this.tokens < 1) {                                      // more frames than any real client sends: dropped unread, and a habit ends the friendship
      if (++this.bad > MAX_BAD_FRAMES) this.drop('flood');
      return;
    }
    this.tokens -= 1;
    if (this.pid !== null) {
      this.session.room.receive(this.pid, data, this.conn);
      return;
    }
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      this._failHello(parsed.code);
    } else if (parsed.msg.t === 'create' || parsed.msg.t === 'join') {
      this._enter(parsed.msg);
    } else if (++this.stray > MAX_PREHELLO_FRAMES) {
      this._closeChannel('hello required');
    }
  }

  _enter(msg) {
    const session = this.session;
    if (session.closed) {
      this._failHello(ERR.CLOSED);
      return;
    }
    if (session.local === null || session.local.pid === null) {      // the host's own player always comes first
      this._failHello(ERR.NO_ROOM);
      return;
    }
    const res = session.room.join(this.conn, { name: msg.name, color: msg.color, token: msg.token });
    if (!res.ok) {
      this._failHello(res.error);
      return;
    }
    this.pid = res.id;
    session.ticker.clearTimer(this.helloTimer);
    session._emit({ type: 'friend', id: this.inviteId, state: 'joined', pid: res.id });
  }
}

/** The host's own player: a Room participant behind the WebSocketConnection interface (send / close / onopen / onmessage / onclose / readyState). */
export class HostConnection {
  constructor(session) {
    this.session = session;
    this.pid = null;
    this.readyState = 1;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.outbox = [];
    this._draining = false;
    this._notified = false;
    this._leaving = false;
    this.conn = {
      send: (str) => {
        if (this.readyState === 3) return;
        this.outbox.push(str);
        queueMicrotask(() => this.drain());
      },
      close: (reason) => queueMicrotask(() => this._notify({ code: 1000, reason: String(reason ?? ''), byUser: this._leaving })),
    };
    queueMicrotask(() => { if (this.readyState === 1) safeCall(this.onopen); });
  }

  /** `create` (or `join`) seats the host; every other frame is the host's own input. False when nothing was sent. */
  send(obj) {
    const session = this.session;
    if (this.readyState !== 1 || obj === null || typeof obj !== 'object' || session.closed) return false;
    if (this.pid === null) {
      if (obj.t !== 'create' && obj.t !== 'join') return false;
      const res = session.room.join(this.conn, { name: obj.name, color: obj.color, token: obj.token });
      if (res && res.ok) this.pid = res.id;
      else this.conn.send(errorFrame(res && res.error ? res.error : ERR.CLOSED));
      return true;
    }
    session.room.receive(this.pid, JSON.stringify(obj), this.conn);
    return true;
  }

  checkLiveness() {}

  drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this.outbox.length > 0) {
        const text = this.outbox.shift();
        try {
          safeCall(this.onmessage, JSON.parse(text));
        } catch (err) {
          console.error(err);
        }
      }
    } finally {
      this._draining = false;
    }
  }

  /** Leaving ends the party for everybody: the Room closes and each friend hears that the host ended the game. */
  close() {
    if (this.readyState === 3) return;
    this._leaving = true;
    this.readyState = 3;
    this.outbox.length = 0;
    this.session.shutdown();
    queueMicrotask(() => this._notify({ code: 1000, reason: 'left', byUser: true }));
  }

  _notify(info) {
    if (this._notified) return;
    this._notified = true;
    this.readyState = 3;
    safeCall(this.onclose, info);
  }
}

// ---- Guest: joining someone's party --------------------------------------------------------------------------------------

/**
 * @typedef {{ type: 'state', state: 'answering'|'waiting'|'connecting'|'open'|'failed'|'closed', message?: string }} GuestEvent
 */

export class GuestSession {
  /** @param {{ env?: object }} [o] test seams: RTCPeerConnection, iceServers, now, gatherMs */
  constructor({ env = {} } = {}) {
    this.env = { ...globalThis.__BP_P2P_TEST__, ...env };
    this.pc = null;
    this.dc = null;
    this.state = 'idle';
    this.hostName = '';
    this.gameId = '';                          // which hosted game the invite came from (see HostSession.gameId)
    this.listeners = new Set();
    this._timer = null;
    this._hintTimer = null;
    this._connectTimer = null;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _set(state, message = '') {
    if (this.state === 'closed' && state !== 'closed') return;
    this.state = state;
    for (const fn of [...this.listeners]) safeCall(fn, { type: 'state', state, message });
  }

  /**
   * Reads the pasted invite and makes the reply code. Rejects with a SignalError fit to show.
   * @returns {Promise<{ code: string, host: string, game: string, gatherMs: number }>}
   */
  async acceptInvite(text) {
    const sig = await decodeSignal(text, 'offer');
    const RTC = rtcOf(this.env);
    this.closeLink();
    const pc = new RTC({ iceServers: iceServers(this.env) });
    this.pc = pc;
    this.hostName = sig.host;
    this.gameId = sig.game;
    this.state = 'answering';
    pc.addEventListener('datachannel', (ev) => this._channel(ev.channel));
    // The host pastes our reply minutes after we made it (chat apps), and our ICE agent starts probing the moment the reply exists, long before
    // the host has it. So "checking" and even a failed probe say nothing while we wait; only a finished DTLS handshake (which needs the host to
    // have our reply) starts the connect clock.
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') this._connecting();
      else if (pc.connectionState === 'failed') this._linkFailed();
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') this._linkFailed();
    });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      const gathering = gatherCandidates(pc, this.env.gatherMs ?? GATHER_MS, { now: this.env.now ?? (() => Date.now()) });
      await pc.setLocalDescription(await pc.createAnswer());
      const gatherMs = await gathering;
      if (!/^a=candidate:/m.test(pc.localDescription.sdp)) throw E.noAddress();
      const code = await encodeSignal({ type: 'answer', sdp: pc.localDescription.sdp, id: sig.id });
      this._timer = setTimeout(() => this._fail('The host has not added you yet. Ask them to paste your reply code, or start again with a new invite.'), GUEST_WAIT_MS);
      this._hintTimer = setTimeout(() => {
        if (this.state === 'waiting') this._set('waiting', WAIT_HINT);
      }, this.env.waitHintMs ?? WAIT_HINT_MS);
      this._set('waiting');
      return { code, host: sig.host, game: sig.game, gatherMs };
    } catch (err) {
      this.closeLink();
      throw err instanceof SignalError ? err : E.browser();
    }
  }

  _connecting() {
    if (this._connectTimer !== null || this.state === 'open' || this.state === 'closed') return;
    clearTimeout(this._timer);
    clearTimeout(this._hintTimer);
    this._set('connecting');
    this._connectTimer = setTimeout(() => this._fail(NAT_HELP), this.env.connectMs ?? CONNECT_MS);
  }

  /** ICE or the connection failed. While we still wait for the host to paste our reply that proves nothing (the host may yet reach us). */
  _linkFailed() {
    if (this.state === 'waiting' || this.state === 'answering') {
      if (this.state === 'waiting') this._set('waiting', WAIT_FAILED);
      return;
    }
    this._fail(NAT_HELP);
  }

  _channel(dc) {
    this.dc = dc;
    const opened = () => {
      clearTimeout(this._timer);
      clearTimeout(this._hintTimer);
      clearTimeout(this._connectTimer);
      this._set('open');
    };
    if (dc.readyState === 'open') queueMicrotask(opened);
    else dc.addEventListener('open', opened, { once: true });
    dc.addEventListener('close', () => { if (this.state !== 'open') this._fail('The host closed the connection before it finished.'); }, { once: true });
  }

  _fail(message) {
    if (this.state === 'open' || this.state === 'failed' || this.state === 'closed') return;
    clearTimeout(this._timer);
    clearTimeout(this._hintTimer);
    clearTimeout(this._connectTimer);
    this._set('failed', message);
    this.closeLink();
  }

  /** The open channel as a connection object main.js can use. Call once, after the 'open' state. */
  connection(opts) {
    const link = new GuestConnection(this.dc, this.pc, opts);
    this.pc = null;                                       // now owned by the connection
    return link;
  }

  closeLink() {
    clearTimeout(this._timer);
    clearTimeout(this._hintTimer);
    clearTimeout(this._connectTimer);
    this._timer = this._hintTimer = this._connectTimer = null;
    closeQuietly(this.pc);
    this.pc = null;
  }

  /** Gives up: closes everything that is not already a GuestConnection. */
  close() {
    if (this.state === 'closed') return;
    if (this.state !== 'open') closeQuietly(this.pc);
    clearTimeout(this._timer);
    clearTimeout(this._hintTimer);
    clearTimeout(this._connectTimer);
    this._set('closed');
    this.listeners.clear();
  }
}

/**
 * The friend's connection to the host, with the interface WebSocketConnection has (send / close / onopen / onmessage / onclose /
 * readyState / checkLiveness). No automatic reconnect: a lost link needs a fresh handshake, and onclose says so ({ lost: true } or
 * { hostEnded: true }).
 */
export class GuestConnection {
  /** @param {RTCDataChannel} dc @param {RTCPeerConnection|null} pc @param {{ now?: () => number, doc?: object, setRepeat?: Function, clearRepeat?: Function }} [opts] */
  constructor(dc, pc = null, { now = () => performance.now(), doc = globalThis.document ?? null, setRepeat = (fn, ms) => setInterval(fn, ms), clearRepeat = (h) => clearInterval(h) } = {}) {
    this.dc = dc;
    this.pc = pc;
    this._now = now;
    this._doc = doc;
    this._clearRepeat = clearRepeat;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.readyState = dc.readyState === 'open' ? 1 : 0;
    this._joined = false;
    this._fatal = null;
    this._hostEnded = false;
    this._finished = false;
    this._lastRx = this._lastVisibleAt = now();
    this._onVisibility = () => {
      if (this._doc && !this._doc.hidden) {
        this._lastVisibleAt = this._now();
        this._ping();
      }
    };
    dc.addEventListener('message', (ev) => this._onMessage(ev.data));
    dc.addEventListener('close', () => this._finish({ code: 0, reason: this._hostEnded ? 'host_ended' : 'lost', fatal: false, hostEnded: this._hostEnded, lost: !this._hostEnded, byUser: false }));
    dc.addEventListener('error', () => {});
    pc?.addEventListener?.('connectionstatechange', () => { if (pc.connectionState === 'failed') this._finish({ code: 0, reason: 'lost', fatal: false, hostEnded: this._hostEnded, lost: true, byUser: false }); });
    this._doc?.addEventListener?.('visibilitychange', this._onVisibility);
    this._heartbeat = setRepeat(() => {
      this._ping();
      this.checkLiveness();
    }, GUEST_PING_MS);
    queueMicrotask(() => { if (this.readyState === 1 && !this._finished) safeCall(this.onopen); });
  }

  /** Sends one message as JSON. Like WebSocketConnection, nothing but create / join / ping goes out before `joined` arrived. */
  send(obj) {
    if (this.readyState !== 1 || this.dc.readyState !== 'open') return false;
    if (!this._joined && obj.t !== 'create' && obj.t !== 'join' && obj.t !== 'ping') return false;
    try {
      this.dc.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  _ping() {
    this.send({ t: 'ping', ts: this._now() });
  }

  /** Declares a silent link dead (not while the tab is hidden: its timers are throttled and nobody is looking). */
  checkLiveness() {
    if (this.readyState !== 1 || (this._doc && this._doc.hidden)) return;
    if (this._now() - Math.max(this._lastRx, this._lastVisibleAt) > GUEST_DEAD_MS) {
      this._finish({ code: 0, reason: 'lost', fatal: false, hostEnded: false, lost: true, byUser: false });
    }
  }

  /** Test hook and "the network went away" path: closes the channel without telling the host anything. */
  dropLink() {
    this._finish({ code: 0, reason: 'lost', fatal: false, hostEnded: false, lost: true, byUser: false });
  }

  close() {
    this._finish({ code: 1000, reason: 'left', fatal: false, hostEnded: false, lost: false, byUser: true });
  }

  _onMessage(data) {
    this._lastRx = this._now();
    if (typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg === null || typeof msg !== 'object') return;
    if (msg.t === 'joined') {
      this._joined = true;
      queueMicrotask(() => this._ping());                 // the first round trip right away, so the signal meter is not blank for two seconds
    }
    else if (msg.t === 'kicked') this._fatal = 'kicked';
    else if (msg.t === 'error') {
      if (msg.code === 'closed') this._hostEnded = true;
      else if (!this._joined) this._fatal = String(msg.code);
    }
    safeCall(this.onmessage, msg);
    if (this._fatal !== null && !this._finished) {
      this._finish({ code: 1000, reason: this._fatal, fatal: true, hostEnded: false, lost: false, byUser: false });
    }
  }

  _finish(info) {
    if (this._finished) return;
    this._finished = true;
    this.readyState = 3;
    this._clearRepeat(this._heartbeat);
    this._doc?.removeEventListener?.('visibilitychange', this._onVisibility);
    try { this.dc.close(); } catch { /* already closed */ }
    const pc = this.pc;
    if (pc) setTimeout(() => closeQuietly(pc), info.byUser ? 300 : 0);
    safeCall(this.onclose, info);
  }
}

/** The join message a friend sends first (same shape glue.helloFor makes): code is ignored by the host, the token brings the character back. */
export function guestHello({ name, token }) {
  const msg = { t: 'join', v: WIRE_VERSION, name, code: ROOM_CODE };
  if (token) msg.token = token;
  return msg;
}

