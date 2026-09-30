// Session API used by the UI (SPEC §6.2): host or join a room over the best available
// transport and get back a Session (HostSession or ClientSession, same surface).
//
// Transports: 'relay' (our WebSocket server, works behind any NAT), 'p2p' (PeerJS /
// WebRTC, works on static hosting), 'local' (in-memory, solo play). 'auto' picks the
// relay when the page is served by the relay server, else p2p.
//
// Control messages on the reliable 'ctl' channel (JSON, { t, ... }):
//   client → host  hello { version, protocol, name, color, cls, token, story? } · profile { name?, color?, cls?, ready? }
//                  chat { text } · buy { item } · ready · pong { n, ts } · bye · sact { a, ... } (story)
//   host → client  welcome { id, code, roster, settings, story? } · reject { reason } · roster { roster }
//                  settings { settings } · chat { pid, name, text, system } · notice { text }
//                  start { match, mapId, seed, settings, roster, story? } · lobby · ping { n, ts }
//                  bye { reason } · kick
//                  story rooms only (protocol 9, net/story-host.js): world { world } · sprofile { profile }
//                  sstate { stage, mission, party, ready, ... } · sdebrief { debrief } · sres { a, ok, ... } · swant { id }
// Binary on 'state': snapshots (host → client) and inputs (client → host), shared/protocol.js.
// The host trusts nothing a client sends: see lobby-rules.js and HostSession._onMessage
// (per-peer message budget, shop ids only, kick bans by tab token and name, room lock).

import { createLocalHub } from './transport-local.js';
import { createPeerHost, connectPeer } from './transport-peer.js';
import { createRelayHost, connectRelay, relayUrl } from './transport-relay.js';
import { normalizeRoomCode } from './room-code.js';
import { HostSession } from './host-session.js';
import { ClientSession } from './client-session.js';

const INFO_TIMEOUT_MS = 2500;
let infoPromise = null;

/**
 * Whether the page is served by our relay server (or one is configured).
 * @returns {Promise<{ relay: boolean, version?: string }>}
 */
export function getServerInfo() {
  if (!infoPromise) infoPromise = fetchServerInfo();
  return infoPromise;
}

async function fetchServerInfo() {
  const cfg = globalThis.HH_CONFIG;
  if (cfg && typeof cfg.relayUrl === 'string' && cfg.relayUrl) return { relay: true };
  if (typeof fetch !== 'function' || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) {
    return { relay: false };
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl && ctrl.abort(), INFO_TIMEOUT_MS);
  try {
    const res = await fetch(new URL('api/info', location.href), { cache: 'no-store', signal: ctrl && ctrl.signal });
    if (!res.ok) return { relay: false };
    // Static hosts serve public/api/info ({ relay: false }), maybe with an odd content
    // type, and SPA-style hosts may answer with an HTML page: anything but JSON is "no".
    let info = null;
    try {
      info = JSON.parse(await res.text());
    } catch {
      info = null;
    }
    return info && info.relay === true ? { relay: true, version: info.version } : { relay: false };
  } catch {
    return { relay: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Host a new room.
 * @param {object} opts
 * @param {string} opts.name
 * @param {number} opts.color 0..5
 * @param {string} opts.cls CLASS_IDS
 * @param {string|object} [opts.transport] 'auto' | 'relay' | 'p2p' | 'local', or a ready
 *   HostTransport instance (tests)
 * @param {object} [opts.hooks] test hooks, see HostSession
 * @param {object} [opts.story] host a story campaign room (STORY.md): { profile, world?, newWorld? }
 *   — `session.story` is then the StoryHost (net/story-host.js), else null
 * @returns {Promise<HostSession>} resolves once friends can join (code set, except local)
 */
export async function hostGame({ name, color, cls, transport = 'auto', hooks, story = null } = {}) {
  let net;
  if (transport && typeof transport === 'object') {
    net = transport;
  } else if (transport === 'local') {
    net = createLocalHub().host;
  } else if (transport === 'relay') {
    net = await createRelayHost({ url: relayUrl() });
  } else if (transport === 'p2p') {
    net = await createPeerHost();
  } else {
    const info = await getServerInfo();
    net = null;
    if (info.relay) {
      try {
        net = await createRelayHost({ url: relayUrl() });
      } catch (err) {
        console.warn('[net] relay unavailable, falling back to p2p:', err.message);
      }
    }
    if (!net) net = await createPeerHost();
  }
  return new HostSession(net, { name, color, cls }, hooks, story);
}

/**
 * Join a room by code.
 * @param {object} opts
 * @param {string} opts.code room code as typed (case/spaces ignored)
 * @param {string|object} [opts.via] 'relay' | 'p2p' | undefined (auto), or a connected
 *   ClientTransport (or a promise of one) for tests
 * @param {string} opts.name
 * @param {number} opts.color
 * @param {string} opts.cls
 * @param {object} [opts.hooks] test hooks, see ClientSession
 * @param {object} [opts.story] the joiner's story data for a campaign room: { profile, worldId?, worldRev? }
 *   (a room that is not a story room ignores it)
 * @returns {Promise<ClientSession>} rejects Error('Room not found' | 'Room is full' |
 *   'Game version mismatch' | 'Could not connect')
 */
export async function joinGame({ code, via, name, color, cls, hooks, story = null } = {}) {
  let net;
  if (via && typeof via === 'object') {
    net = await via;
  } else {
    const room = normalizeRoomCode(code);
    if (!room) throw new Error('Room not found');
    if (via === 'relay') {
      net = await connectRelay(room, { url: relayUrl() });
    } else if (via === 'p2p') {
      net = await connectPeer(room);
    } else {
      const info = await getServerInfo();
      if (info.relay) {
        try {
          net = await connectRelay(room, { url: relayUrl() });
        } catch (err) {
          // The host may have picked p2p even though a relay exists.
          if (err.message !== 'Room not found') throw err;
        }
      }
      if (!net) net = await connectPeer(room);
    }
  }
  const session = new ClientSession(net, hooks);
  return session._handshake({ name, color, cls }, story);
}
