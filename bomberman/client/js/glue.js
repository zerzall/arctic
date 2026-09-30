// glue.js - the pure decisions behind main.js (docs/SPEC.md 5.4, 8.3, 8.6), split out so Node can test them.
//
// main.js is the only file that touches the DOM, the network and the game objects at once, and it cannot be imported outside a
// browser. Everything it DECIDES lives here as plain functions of plain data: which room code a URL carries, what a stored session
// is worth, what a connection that ended for good means for the player, what the kill feed says, which sound a count crossed.
// No DOM, no globals, no clock: every input is an argument.

import { isRoomCode } from './ui.js';

// ---- Room code and stored session ------------------------------------------------------------------

/**
 * The room code an address carries: `/r/KQXZ` (one optional trailing slash) or `#KQXZ`, upper-cased and only if it is a
 * well-formed code (SPEC 1.2), else ''. `loc` needs `pathname` and `hash` only.
 */
export function roomCodeFromLocation(loc) {
  const path = /^\/r\/([A-Za-z]{4})\/?$/.exec(String(loc?.pathname ?? ''));
  const hash = /^#\/?([A-Za-z]{4})$/.exec(String(loc?.hash ?? ''));
  const code = String((path ?? hash)?.[1] ?? '').toUpperCase();
  return isRoomCode(code) ? code : '';
}

/** A stored session is worth a silent rejoin for this long (SPEC 5.4). */
export const SESSION_MAX_AGE_MS = 10 * 60 * 1000;

/** `bp.session` as stored: JSON of { code, token, name, id, ts } with `ts` in Date.now() milliseconds. */
export function sessionRecord({ code, token, name, id }, now) {
  return JSON.stringify({ code, token, name, id, ts: now });
}

/**
 * Reads a stored session back. Anything malformed, expired or from the future is `null`: a corrupt entry must never stop the game
 * from starting. `id` is the fighter id the server gave (-1 when the record has none), so a rejoin that comes back as somebody else
 * (the token expired) can be told apart. @returns {{code:string, token:string, name:string, id:number, ts:number} | null}
 */
export function parseSession(raw, now) {
  if (typeof raw !== 'string') return null;
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    return null;
  }
  if (s === null || typeof s !== 'object') return null;
  if (!isRoomCode(s.code) || typeof s.token !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(s.token)) return null;
  if (typeof s.name !== 'string' || !Number.isFinite(s.ts)) return null;
  const age = now - s.ts;
  const id = Number.isInteger(s.id) && s.id >= 0 ? s.id : -1;
  return age >= 0 && age < SESSION_MAX_AGE_MS ? { code: s.code, token: s.token, name: s.name, id, ts: s.ts } : null;
}

/** Whether a stored session may be resumed at boot: the address either names no room or names the stored one (SPEC 5.4). */
export const mayRejoin = (session, linkCode) => session !== null && (linkCode === '' || linkCode === session.code);

// ---- The first frame of a connection ---------------------------------------------------------------

/**
 * What to send when a socket opens. With a token (a reconnect, or a boot rejoin) it is always the token join: the server re-attaches
 * the entry it remembers. Otherwise `create`, or a `join` by code.
 */
export function helloFor({ token, code, name, wire, create }) {
  const base = { v: wire, name };
  if (token) return { t: 'join', ...base, code, token };
  return create ? { t: 'create', ...base } : { t: 'join', ...base, code };
}

// ---- Errors the player sees ------------------------------------------------------------------------

/** Plain-language text of every error code the server sends (the server's own text is only a fallback). */
export const ERROR_COPY = Object.freeze({
  no_room: 'That room does not exist. Check the code, or ask your host for a new invite link.',
  full: 'That room is full.',
  locked: 'The host has locked that room, so nobody new can join.',
  busy: 'The server is busy right now. Try again in a minute.',
  rate_limited: 'Slow down a little and try again in a moment.',
  bad_msg: 'Something went wrong talking to the server. Please try again.',
  version: 'Please refresh the page to get the latest version.',
  not_host: 'Only the host can do that.',
  bad_phase: 'You cannot do that right now.',
  need_players: 'Add a bot or wait for a friend: you need at least 2 players.',
  need_teams: 'Each team needs at least one player.',
  kicked: 'You were removed from that room.',
});

/** Text for an error frame that arrives after `joined` (a toast). Unknown codes fall back to the server's own words. */
export const errorToast = (code, serverText = '') => ERROR_COPY[code] ?? (serverText || 'Something went wrong.');

/** A refresh loop guard: after a `version` error the page reloads once; a second one inside this window asks the player instead. */
export const RELOAD_GUARD_MS = 60000;

/**
 * What a connection that ended for good means for the player. `info` is net.js's onclose payload
 * ({ code, reason, fatal, gaveUp, replaced, byUser }).
 * @param {object} info
 * @param {{ practice: boolean, tokenJoin: boolean, serverClosed: boolean, sinceReload: number|null }} ctx
 *   tokenJoin: the join that failed carried a token (a reconnect or boot rejoin); serverClosed: the server told us `closed` before;
 *   sinceReload: ms since the page last reloaded itself for a `version` error, or null
 * @returns {{kind: 'none'|'practice-ended'|'replaced'|'ended'|'unreachable'|'kicked'|'reload'|'refresh'|'title', text?: string}}
 */
export function closeOutcome(info, ctx) {
  if (info.byUser) return { kind: 'none' };
  if (ctx.practice) return { kind: 'practice-ended' };
  if (info.replaced) return { kind: 'replaced' };
  if (info.gaveUp) return { kind: ctx.serverClosed ? 'ended' : 'unreachable' };
  switch (info.reason) {
    case 'no_room': return ctx.tokenJoin ? { kind: 'ended' } : { kind: 'title', text: ERROR_COPY.no_room };
    case 'kicked': return { kind: 'kicked' };
    case 'version': return ctx.sinceReload !== null && ctx.sinceReload < RELOAD_GUARD_MS ? { kind: 'refresh' } : { kind: 'reload' };
    default: return { kind: 'title', text: ERROR_COPY[info.reason] ?? 'Could not join that room. Please try again.' };
  }
}

// ---- Kill feed -------------------------------------------------------------------------------------

/**
 * The kill-feed line of a `death` event [code, victim, killer, x, y] (SPEC 8.3, A.3).
 * @param {Array} ev
 * @param {{ name: (id:number)=>string, team: (id:number)=>number, teams: boolean, suddenDeath: boolean }} ctx
 */
export function deathText(ev, ctx) {
  const victim = ev[1];
  const killer = ev[2];
  const v = ctx.name(victim);
  if (killer === victim) return `${v} blew themselves up`;
  if (killer >= 0) {
    const k = ctx.name(killer);
    return ctx.teams && ctx.team(killer) === ctx.team(victim) ? `${k} blasted their teammate ${v}` : `${k} blasted ${v}`;
  }
  return ctx.suddenDeath ? `${v} was crushed by the walls` : `${v} was caught in a blast`;
}

/** What a screen reader hears when the local player dies. */
export function deathAnnouncement(ev, name) {
  if (ev[2] === ev[1]) return 'You blew yourself up.';
  return ev[2] >= 0 ? `You were blasted by ${name(ev[2])}.` : 'You were crushed by the walls.';
}

/** Whether a `sys` line is worth a toast during a match: departures already have a kill-feed line of their own. */
export const worthToasting = (text) => !/ (?:left|was kicked)$/.test(String(text));

// ---- Numbers the sound triggers watch --------------------------------------------------------------

/** 3, 2, 1 for the countdown ticks left (`cd`: 180..1), 0 outside a countdown. A band change is a sound (SPEC 8.6). */
export const countdownBand = (cd) => (cd > 0 ? Math.ceil(cd / 60) : 0);

/** Whole seconds left on the round clock from its ticks (`r`), 0 when there is no clock or it ran out. */
export const secondsLeft = (r) => (r > 0 ? Math.ceil(r / 60) : 0);

/** Stereo position of an arena x (tiles): the edges sit at +-0.85, so a far bomb is off to one side but never fully in one ear. */
export function panOf(x, width = 15) {
  const half = width / 2;
  return Math.max(-1, Math.min(1, ((x - half) / half) * 0.85));
}

/** Whether the local player is among the winners of a match (a joint win counts; a match nobody could finish does not). */
export function wonMatch(msg, me) {
  if (!msg || msg.reason === 'not_enough_players') return false;
  const standings = Array.isArray(msg.standings) ? msg.standings : [];
  const mine = standings.find((s) => s.id === me);
  if (msg.winnerTeam !== null && msg.winnerTeam !== undefined) return !!mine && mine.team === msg.winnerTeam;
  if (msg.winnerId !== null && msg.winnerId !== undefined) return msg.winnerId === me;
  return !!mine && mine.place === 1;
}

/** Lobby membership change between two `lobby` messages of the same room: who arrived and who left (ids). */
export function lobbyChanges(prev, next) {
  const before = new Set((prev?.players ?? []).map((p) => p.id));
  const after = new Set((next?.players ?? []).map((p) => p.id));
  return {
    joined: [...after].filter((id) => !before.has(id)),
    left: [...before].filter((id) => !after.has(id)),
  };
}
