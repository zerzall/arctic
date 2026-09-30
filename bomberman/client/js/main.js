// main.js - boot and glue (docs/SPEC.md 8.6, 5.4, 8.1a): the one file that knows every other client module.
//
//   net (WebSocket | Loopback) -> onMessage -> ClientGame -> View -> Renderer;   events -> Renderer + audio + kill feed
//   lobby / round / results data -> UI;   Input -> ClientGame.setIntent;   UI callbacks -> net
//
// WHAT LIVES HERE
//   * boot: the UI, the Renderer (+ a ResizeObserver on #stage), Input, audio unlock; the title screen with /r/CODE deep links and the
//     remembered name; a silent token rejoin when the tab still holds a fresh session (a reload mid-match lands back in the match).
//   * connections: create / join / Practice (a Room in this page behind LoopbackConnection, pumped from the frame loop and paused with
//     the tab); the connect / reconnect / cold-start states; what every way a connection can end means to the player (glue.js decides,
//     this file shows it).
//   * the frame loop: pump -> input -> game.update -> getView -> events (sound, kill feed, particles) -> render -> HUD at 10 Hz.
//   * the little things around a match: wake lock, the back-gesture guard, the hidden-tab rules, mute / volume / effects / hand
//     settings, `?debug=1` (the boot.js overlay plus window.__bp for the e2e specs).
//
// The pure decisions (which code an address carries, what a closed connection means, kill-feed wording, sound thresholds) are in
// glue.js so Node can test them; this file is wiring and cannot run outside a browser.
//
// READINGS OF THE SPEC where it is silent (also in the integrator's report):
//   * `roundEnd -> win_round` plays for every decided round (a jingle for a draw would be odd), the countdown sound plays on each of 3, 2, 1.
//   * The "Showdown" banner is the renderer's canvas banner; the HUD only announces it to screen readers (two banners would overlap).
//   * The connecting overlay has a Cancel button (a free host can take a minute; the only other way out was a reload).
//   * `version` errors reload the page once; a second one within a minute asks the player to refresh by hand.

import { audio } from './audio.js';
import { UI, isRoomCode } from './ui.js';
import { ClientGame } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { WebSocketConnection, LoopbackConnection } from './net.js';
import {
  roomCodeFromLocation, parseSession, sessionRecord, mayRejoin, helloFor, closeOutcome, errorToast, deathText, deathAnnouncement,
  worthToasting, countdownBand, secondsLeft, panOf, wonMatch, lobbyChanges,
} from './glue.js';
import { WIRE_VERSION, STATE } from '../../shared/constants.js';

const DEBUG = /[?&]debug=1(?:&|$)/.test(location.search);
const SESSION_KEY = 'bp.session';
const RELOAD_KEY = 'bp.reloaded';
const HUD_EVERY_MS = 100;                      // the HUD is DOM: at most 10 updates a second (SPEC 8.2)
const EMOTE_GAP_MS = 700;                      // the Room's own limit; asking sooner would only earn a `rate_limited`
const KEEP_ALIVE_MS = 60000;                   // the stored session's timestamp is refreshed this often while in a room
const WAKING_TEXT = 'Waking up the server… free hosting sleeps when nobody is playing. This can take up to a minute.';
const PRACTICE_BOTS = ['easy', 'normal', 'normal'];
const MAX_EXPLOSION_SOUNDS = 3;                // per frame: a chain reaction is one loud bang, not a wall of them

const now = () => performance.now();

// ---- Storage (each access guarded: private windows and blocked storage throw) -----------------------

const tabStore = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* the session simply cannot be resumed */ } },
  del(key) { try { sessionStorage.removeItem(key); } catch { /* nothing to remove */ } },
};

// ---- State ------------------------------------------------------------------------------------------

/** The current connection and everything learned through it. `gen` invalidates the events of a connection that was replaced. */
const S = {
  gen: 0,
  conn: null,
  practice: false,
  create: true,                                // the first hello is `create` (else a join by code)
  code: '',
  token: '',
  name: '',
  me: -1,
  joined: false,                               // `joined` seen on the current socket
  serverClosed: false,                         // the server said `closed`: a restart, not a network problem
  botsAdded: false,
  game: null,                                  // ClientGame, created at `joined`
  lobby: null,                                 // the latest `lobby` message
  round: null,                                 // the latest `round` message
  names: new Map(),                            // fighter id -> the round's static info
  view: null,                                  // the View drawn last (for window.__bp)
  inRoom: false,                               // the back-gesture guard is armed
  rejoining: false,
};

/** What the frame loop watches to turn state into sound, banners and setting changes. */
const T = {
  screen: '',
  music: null,
  resultMusic: 'menu',
  cdBand: 0,
  warnSec: 0,
  hudAt: 0,
  debugAt: 0,
  glove: false,
  emoteAt: -Infinity,
  errorAt: Object.create(null),
  build: '',
  buildToast: false,
  paused: false,
  wake: null,
  size: '',
  counts: DEBUG ? Object.create(null) : null,  // debug only: how many of each event / sound / message happened
  sounds: DEBUG ? Object.create(null) : null,
  msgs: DEBUG ? Object.create(null) : null,
};

// ---- Sound helpers ------------------------------------------------------------------------------------

function sfx(name, opts) {
  if (T.sounds) T.sounds[name] = (T.sounds[name] ?? 0) + 1;
  audio.play(name, opts);
}

function setMusic(name) {
  if (T.music === name) return;
  T.music = name;
  audio.music(name);
}

// ---- Boot ---------------------------------------------------------------------------------------------

audio.unlock();

const send = (obj) => (S.conn ? S.conn.send(obj) : false);

const ui = new UI(document.getElementById('app'), {
  onCreate: (name) => { sfx('click'); startOnline({ name, create: true }); },
  onJoin: (code, name) => { sfx('click'); startOnline({ name, code, create: false }); },
  onPractice: (name) => { sfx('click'); startPractice(name); },
  onProfile: (patch) => { send({ t: 'profile', ...patch }); },
  onSettings: (patch) => { sfx('click'); send({ t: 'settings', patch }); },
  onAddBot: (level) => { sfx('click'); send({ t: 'addBot', level }); },
  onRemoveBot: (id) => { sfx('click'); send({ t: 'removeBot', id }); },
  onKick: (id) => { sfx('click'); send({ t: 'kick', id }); },
  onStart: () => { sfx('click'); send({ t: 'start' }); },
  onChat: (text) => { send({ t: 'chat', text }); },
  onEmote: (e) => sendEmote(e),
  onLeave: () => { sfx('click'); leaveRoom(); },
  onBackToLobby: () => { sfx('click'); send({ t: 'lobby' }); },
  onMute: (muted) => { audio.setMuted(muted); if (!muted) sfx('click'); },
  onVolume: (volume) => { audio.setVolume(volume); },
  onToggleEffects: (reduce) => { renderer.setReducedEffects(reduce); },
  onControlsSide: (hand) => { input.setHand(hand); },
});

const { wrap, canvas, touchRoot } = ui.getGameElements();
const renderer = new Renderer(canvas);
const input = new Input({ canvas, touchRoot });

ui.setSettings({ volume: audio.volume, muted: audio.muted });
renderer.setReducedEffects(ui.settings.reduce);
input.setHand(ui.settings.hand);
input.onEmote((n) => sendEmote(n));
input.onWheel(() => ui.toggleEmoteBar());
input.onMenu(() => { if (!ui.menuOpen) ui.showMenu(true); });
input.onMute(() => ui.setMuted(!ui.settings.muted));

// Touch controls follow the device's primary pointer: a phone or tablet gets the joystick, a laptop the keyboard.
const coarsePointer = window.matchMedia('(pointer: coarse)');
const applyTouch = (on) => { input.enableTouch(on); ui.setTouchLayout(on); };
applyTouch(coarsePointer.matches);
coarsePointer.addEventListener?.('change', (e) => applyTouch(e.matches));

// ---- Sizing --------------------------------------------------------------------------------------------

/** Tells the renderer how big #stage is. clientWidth/Height (layout size) rather than getBoundingClientRect: a CSS animation must not skew it. */
function measure() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w < 1 || h < 1) return;                  // the game screen is hidden: measure again when it is shown
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const key = `${w}x${h}@${dpr}`;
  if (key === T.size) return;
  T.size = key;
  renderer.resize(w, h, dpr);
}

if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(wrap);
window.addEventListener('resize', measure);
window.visualViewport?.addEventListener('resize', measure);
window.addEventListener('orientationchange', () => {
  // The browser reports the new size a moment late: after two frames, and again once the rotation animation has settled.
  requestAnimationFrame(() => requestAnimationFrame(measure));
  setTimeout(measure, 300);
});

// ---- Rooms in the address bar and the back-gesture guard ------------------------------------------------

/**
 * Called on `joined`: an online room's address becomes its invite link (SPEC 5.4), and in any room (Practice included) a back gesture
 * is caught instead of leaving the page in the middle of a match.
 */
function enterRoom(code) {
  if (isRoomCode(code)) {
    try { history.replaceState(null, '', `/r/${code}${DEBUG ? '?debug=1' : ''}`); } catch { /* an unusual embedding; the room works without a pretty address */ }
  }
  if (S.inRoom) return;
  S.inRoom = true;
  try { history.pushState({ bp: 1 }, '', location.href); } catch { /* as above */ }
}

function leaveRoomUrl() {
  if (!S.inRoom && location.pathname === '/') return;
  S.inRoom = false;
  try { history.replaceState(null, '', DEBUG ? '/?debug=1' : '/'); } catch { /* as above */ }
}

window.addEventListener('popstate', () => {
  if (S.inRoom) {                               // the back gesture must not throw a player out of a match: ask instead
    try { history.pushState({ bp: 1 }, '', location.href); } catch { /* ignore */ }
    if (ui.current === 'game') ui.showMenu(true);
  } else if (ui.current === 'title' && location.pathname !== '/') {
    try { history.replaceState(null, '', DEBUG ? '/?debug=1' : '/'); } catch { /* ignore */ }     // a stale /r/CODE entry left behind after leaving
  }
});

// ---- Wake lock ---------------------------------------------------------------------------------------

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || document.hidden || T.wake) return;
    const sentinel = await navigator.wakeLock.request('screen');
    T.wake = sentinel;
    sentinel.addEventListener('release', () => { if (T.wake === sentinel) T.wake = null; });
  } catch { /* battery saver, or not allowed: the screen may dim, that is all */ }
}

function releaseWakeLock() {
  const sentinel = T.wake;
  T.wake = null;
  try { sentinel?.release(); } catch { /* already released */ }
}

// ---- Connections -------------------------------------------------------------------------------------

function startOnline({ name, code = '', create }) {
  endSession();
  S.name = name;
  S.create = create;
  S.code = create ? '' : code;
  connect(false, create ? 'Connecting…' : 'Joining…');
}

function startPractice(name) {
  endSession();
  S.name = name;
  S.create = true;
  connect(true, 'Starting practice…');
}

function resumeSession(session) {
  endSession();
  S.name = session.name;
  S.create = false;
  S.code = session.code;
  S.token = session.token;
  S.me = session.id;                             // the fighter this tab was; a `joined` with another id means the token had expired
  S.rejoining = true;
  saveSession();                                 // endSession() cleared it; a reload before `joined` must still find it
  connect(false, 'Rejoining…');
}

function connect(practice, text) {
  S.practice = practice;
  const gen = ++S.gen;
  ui.showConnecting(text, () => { cancelConnecting(); });
  const conn = practice ? new LoopbackConnection() : new WebSocketConnection();
  S.conn = conn;
  conn.onopen = () => {
    if (gen !== S.gen) return;
    S.joined = false;
    conn.send(helloFor({ token: S.token, code: S.code, name: S.name, wire: WIRE_VERSION, create: S.create }));
  };
  conn.onmessage = (msg) => {
    if (gen !== S.gen) return;
    onMessage(msg);
    syncScreen();
  };
  conn.onclose = (info) => {
    if (gen === S.gen) onClosed(info);
  };
  if (!practice) {
    conn.onstatus = (status) => {
      if (gen === S.gen) onStatus(status);
    };
    onStatus(conn.status);
  }
}

/** Ends the current session without a word to the server (a `leave` frame, when wanted, is sent before this). */
function endSession() {
  S.gen++;                                     // events still in flight from the old connection are ignored from here on
  const conn = S.conn;
  S.conn = null;
  if (conn) {
    try { conn.close(); } catch (err) { console.error(err); }
  }
  S.practice = false;
  S.token = '';
  S.code = '';
  S.me = -1;
  S.joined = false;
  S.serverClosed = false;
  S.botsAdded = false;
  S.rejoining = false;
  S.game = null;
  S.lobby = null;
  S.round = null;
  S.view = null;
  S.names.clear();
  T.paused = false;
  T.buildToast = false;
  tabStore.del(SESSION_KEY);
  leaveRoomUrl();
  releaseWakeLock();
  input.releaseAll();
  input.setHasGlove(false);
  T.glove = false;
  ui.showConnecting(null);
  ui.showReconnecting(null);
}

/** Back to the title screen. After a failed join the typed code stays in its box for a second try; otherwise the box is cleared. */
function goHome({ error } = {}) {
  const name = S.name;
  endSession();
  ui.showTitle(error ? { name, error } : { name, code: '' });
}

function cancelConnecting() {
  goHome();
}

function leaveRoom() {
  const conn = S.conn;
  if (conn && !S.practice && S.joined && conn.readyState === 1) conn.send({ t: 'leave' });     // the seat is freed now, not after the grace period
  goHome();
}

function saveSession() {
  if (S.practice || !S.token || !isRoomCode(S.code)) return;
  tabStore.set(SESSION_KEY, sessionRecord({ code: S.code, token: S.token, name: S.name, id: S.me }, Date.now()));
}

/** The connection state as the player should see it: cold start, first connect, or a reconnect with a countdown to giving up. */
function onStatus(status) {
  if (status.kind === 'open' || status.kind === 'closed' || status.kind === 'failed') return;
  if (status.kind === 'reconnecting') {
    S.game?.pauseSending();                    // the character stands still under the banner instead of walking on unheard
    input.releaseAll();
    ui.showReconnecting(status.secondsLeft);
    return;
  }
  const text = status.waking ? WAKING_TEXT : S.rejoining ? 'Rejoining…' : S.create ? 'Connecting…' : 'Joining…';
  ui.showConnecting(text, () => { cancelConnecting(); });
}

function onClosed(info) {
  const outcome = closeOutcome(info, { practice: S.practice, tokenJoin: !!S.token, serverClosed: S.serverClosed, sinceReload: sinceReload() });
  const conn = S.conn;
  switch (outcome.kind) {
    case 'none':
      break;
    case 'title':
      goHome({ error: outcome.text });
      break;
    case 'ended':
      goHome();
      ui.showDialog({
        title: 'That party has ended',
        text: 'The room is gone - the server may have restarted. You can start a fresh one.',
        actions: [
          { label: 'Create new room', kind: 'primary', onClick: () => startOnline({ name: S.name, create: true }) },
          { label: 'Home', kind: 'glass' },
        ],
      });
      break;
    case 'unreachable':
      ui.showConnecting(null);
      ui.showReconnecting(null);
      ui.showDialog({
        title: "Can't reach the server",
        text: 'Check your internet connection, then try again.',
        tone: 'error',
        actions: [
          { label: 'Try again', kind: 'primary', onClick: () => { if (!conn?.retry?.()) goHome(); } },
          { label: 'Home', kind: 'glass', onClick: () => goHome() },
        ],
      });
      break;
    case 'kicked':
      goHome();
      ui.showDialog({ title: 'You were removed', text: 'The host removed you from the room.', tone: 'error', actions: [{ label: 'OK', kind: 'primary' }] });
      break;
    case 'replaced':
      goHome();
      ui.showDialog({
        title: 'Opened somewhere else',
        text: 'This room was opened in another tab or window, so this one stopped playing.',
        actions: [{ label: 'OK', kind: 'primary' }],
      });
      break;
    case 'reload':
      tabStore.set(RELOAD_KEY, String(Date.now()));
      location.reload();
      break;
    case 'refresh':
      ui.showConnecting(null);
      ui.showDialog({ title: 'Please refresh the page', text: 'Blast Party was updated. Reload to get the new version.', actions: [{ label: 'Reload', kind: 'primary', onClick: () => location.reload(), keepOpen: true }] });
      break;
    case 'practice-ended':
      goHome();
      ui.showDialog({ title: 'Practice ended', text: 'Practice mode stopped. You can start it again from the home screen.', actions: [{ label: 'OK', kind: 'primary' }] });
      break;
    default:
      goHome();
  }
}

function sinceReload() {
  const at = Number(tabStore.get(RELOAD_KEY));
  return Number.isFinite(at) && at > 0 ? Math.max(0, Date.now() - at) : null;
}

// ---- Incoming messages --------------------------------------------------------------------------------

function onMessage(msg) {
  if (msg === null || typeof msg !== 'object') return;
  if (T.msgs) T.msgs[msg.t] = (T.msgs[msg.t] ?? 0) + 1;
  switch (msg.t) {
    case 'joined': onJoined(msg); break;
    case 'lobby': onLobby(msg); break;
    case 'round': onRound(msg); break;
    case 'snap': S.game?.onSnapshot(msg, now()); break;
    case 'roundEnd': onRoundEnd(msg); break;
    case 'matchEnd': onMatchEnd(msg); break;
    case 'chat':
      ui.addChat(msg);
      if (!msg.old && msg.from !== S.me) sfx('chat');
      break;
    case 'emote':
      if (ui.current === 'game') renderer.showEmote(msg.from, msg.e);
      sfx('emote', { vol: msg.from === S.me ? 0.6 : 1 });
      break;
    case 'sys':
      if (typeof msg.text !== 'string') break;
      ui.addChat({ text: msg.text, sys: true });
      if (ui.current === 'game' && worthToasting(msg.text)) ui.toast(msg.text, 'info');
      break;
    case 'pong':
      if (S.game) {
        S.game.onPong(msg.ts);
        ui.setPing(S.game.rtt > 0 ? S.game.rtt : null);
      }
      break;
    case 'error': onError(msg); break;
    default: break;                              // `kicked` is followed by onclose({ fatal }) which explains it
  }
}

function onJoined(msg) {
  const previous = S.me;
  S.joined = true;
  S.rejoining = false;
  S.serverClosed = false;
  S.me = msg.id;
  if (!S.practice) {
    S.token = msg.token;
    S.code = msg.code;
    saveSession();
  }
  enterRoom(S.practice ? '' : msg.code);
  ui.showReconnecting(null);
  if (!S.game || S.game.me !== msg.id) S.game = new ClientGame({ me: msg.id, send, now });
  S.game.setSeq(msg.seq);
  if (previous !== -1 && previous !== msg.id) {
    ui.toast('You were removed from the match. You can watch this round and join the next one.', 'warn', { ms: 7000 });
  }
  if (msg.build) {
    if (!T.build) T.build = msg.build;
    else if (msg.build !== T.build && !T.buildToast) {
      T.buildToast = true;
      ui.toast('A new version is available', 'info', { ms: 60000, action: { label: 'Reload', onClick: () => location.reload() } });
    }
  }
  if (S.practice && !S.botsAdded) {              // Practice is the ordinary lobby with three bots already in it (SPEC 8.1a)
    S.botsAdded = true;
    for (const level of PRACTICE_BOTS) send({ t: 'addBot', level });
  }
}

function onLobby(msg) {
  if (!Array.isArray(msg.players)) return;       // (the server never sends this; a broken proxy might)
  const prev = S.lobby;
  S.lobby = msg;
  ui.showLobby(msg);
  if (prev && !msg.local && prev.code === msg.code && prev.phase !== 'match' && msg.phase !== 'match') {   // (Practice: the bots you add are not visitors)
    const { joined, left } = lobbyChanges(prev, msg);
    if (joined.some((id) => id !== S.me)) sfx('join');
    else if (left.length) sfx('leave');
  }
  saveSession();                                 // refreshes the timestamp of the stored session
}

function onRound(msg) {
  const game = S.game;
  if (!game) return;
  S.round = msg;
  S.names.clear();
  for (const p of msg.players ?? []) S.names.set(p.id, p);
  game.reset(msg);
  renderer.setPlayers(msg);
  T.cdBand = 0;
  T.warnSec = 0;
  T.hudAt = 0;                                   // the new round's chips get their first update at once
  T.glove = false;
  input.setHasGlove(false);
  setMusic('battle');                            // the previous round may have ended in sudden death's faster tune
  ui.showGame(msg);
  requestWakeLock();
}

function onRoundEnd(msg) {
  ui.showRoundEnd(msg, S.lobby?.players);
  if (!msg.draw) sfx('win_round');
}

function onMatchEnd(msg) {
  const first = ui.current !== 'results';        // a reconnect replays the last matchEnd: no second fanfare
  const won = wonMatch(msg, S.me);
  T.resultMusic = won ? 'victory' : 'menu';
  ui.showResults(msg);
  if (first && msg.reason !== 'not_enough_players') sfx(won ? 'win_match' : 'lose_match');
}

function onError(msg) {
  if (msg.code === 'closed') {                   // the server is going away: net.js keeps reconnecting, and the outcome differs if it gives up
    S.serverClosed = true;
    return;
  }
  if (!S.joined) return;                         // a refused join: net.js follows with onclose({ fatal }), explained there
  const t = now();
  if (t - (T.errorAt[msg.code] ?? -Infinity) < 1500) return;
  T.errorAt[msg.code] = t;
  ui.toast(errorToast(msg.code, msg.msg), 'warn');
  sfx('error');
}

function sendEmote(e) {
  if (!S.game || !Number.isInteger(e) || e < 0 || e > 7) return;
  const t = now();
  if (t - T.emoteAt < EMOTE_GAP_MS) return;
  T.emoteAt = t;
  send({ t: 'emote', e });
}

// ---- Screen changes -------------------------------------------------------------------------------------

/** Follows the UI's screen: music, and the connecting overlay that stays up until there is something to look at. */
function syncScreen() {
  const cur = ui.current;
  if (S.joined && cur !== 'title') ui.showConnecting(null);
  if (cur === T.screen) return;
  if (T.screen === 'game' && ui.menuOpen) ui.showMenu(false);   // "Back to the game" means nothing once the match is over
  T.screen = cur;
  if (cur === 'game') setMusic('battle');
  else if (cur === 'results') setMusic(T.resultMusic);
  else setMusic('menu');
}

// ---- Events -> sound, kill feed, banners ---------------------------------------------------------------------

const nameOf = (id) => S.names.get(id)?.name ?? 'Someone';
const teamOf = (id) => S.names.get(id)?.team ?? -1;

function handleEvents(events, view) {
  renderer.handleEvents(events, view);
  let booms = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (T.counts) T.counts[ev[0]] = (T.counts[ev[0]] ?? 0) + 1;
    switch (ev[0]) {
      case 'go':
        ui.showCountdown('GO!');
        sfx('go');
        break;
      case 'bomb':                               // ['bomb', bombId, ownerId, tx, ty]; the local one is synthetic and instant
        sfx('place', { pan: panOf(ev[3] + 0.5), vol: ev[2] === S.me ? 1 : 0.6 });
        break;
      case 'boom':
        if (booms++ < MAX_EXPLOSION_SOUNDS) sfx('explode', { pan: panOf(ev[3] + 0.5) });
        break;
      case 'block':
        sfx('block', { pan: panOf(ev[1] + 0.5), vol: 0.8 });
        break;
      case 'pickup':                             // ['pickup', itemId, playerId, kind, tx, ty]
        sfx(ev[3] === 'skull' ? 'pickup_bad' : 'pickup', { pan: panOf(ev[4] + 0.5), vol: ev[2] === S.me ? 1 : 0.55 });
        break;
      case 'kick':
        sfx('kick', { pan: panOf(playerX(view, ev[1])) });
        break;
      case 'throw':
        sfx('throw', { pan: panOf(ev[3] + 0.5) });
        break;
      case 'land':
        sfx('land', { pan: panOf(ev[2] + 0.5) });
        break;
      case 'death':
        sfx('death', { pan: panOf(ev[3]), vol: ev[1] === S.me ? 1 : 0.8 });
        ui.killfeed(deathText(ev, { name: nameOf, team: teamOf, teams: view.mode === 'teams', suddenDeath: view.suddenDeath }));
        if (ev[1] === S.me) ui.announce(deathAnnouncement(ev, nameOf));
        break;
      case 'left':
        ui.killfeed(`${nameOf(ev[1])} left`);
        break;
      case 'shieldhit':
        sfx('shield', { pan: panOf(ev[2]), vol: ev[1] === S.me ? 1 : 0.6 });
        break;
      case 'curse':                              // ['curse', playerId, kind|0, fromId]
        if (ev[2] !== 0) sfx('curse', { pan: panOf(playerX(view, ev[1])), vol: ev[1] === S.me ? 1 : 0.6 });
        break;
      case 'sdstart':
        sfx('sudden_death');
        setMusic('battle_fast');
        break;
      case 'showdown':
        ui.announce('Showdown: fifteen seconds left.');
        break;
      default:
        break;
    }
  }
}

function playerX(view, id) {
  const list = view.players;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i].x;
  return 7.5;
}

/** Sounds that are not events: the countdown's 3-2-1, the last ten seconds of the clock, the music that follows sudden death. */
function watchClock(view) {
  if (view.state === STATE.COUNTDOWN) {
    const band = countdownBand(view.countdown);
    if (band > 0 && band !== T.cdBand) {
      T.cdBand = band;
      ui.showCountdown(String(band));
      sfx('countdown');
    }
  } else {
    T.cdBand = 0;
  }
  if (view.state === STATE.PLAYING && !view.suddenDeath) {
    const sec = secondsLeft(view.timeLeft);
    if (sec !== T.warnSec) {
      T.warnSec = sec;
      if (sec > 0 && sec <= 10) sfx('warning');
    }
  } else {
    T.warnSec = 0;
  }
  if (view.state !== STATE.COUNTDOWN && view.suddenDeath) setMusic('battle_fast');
}

// ---- The frame loop ------------------------------------------------------------------------------------------

let lastFrame = now();
let frameFaults = 0;

function frame() {
  requestAnimationFrame(frame);
  const t = now();
  const dt = Math.min(t - lastFrame, 100);
  lastFrame = t;
  try {
    step(t, dt);
  } catch (err) {
    if (frameFaults++ < 5) console.error(err);   // one bad frame must not stop the game; the first few are worth a look
    noteError(err);
  }
}

function step(t, dt) {
  const conn = S.conn;
  if (conn) {
    if (S.practice) conn.pump(t);                // Practice: the Room runs on this page's frames, before the game reads its output
    else conn.checkLiveness();
  }
  syncScreen();
  if (DEBUG && t - T.debugAt >= 500) {
    T.debugAt = t;
    updateDebug();
  }

  const game = S.game;
  const playing = ui.current === 'game' && game !== null && game.round !== null;
  input.setActive(playing && ui.blockers === 0);
  if (!playing) return;

  game.setIntent(input.getIntent());
  game.update(t);
  const view = game.getView(t);
  S.view = view;
  const events = game.takeEvents();
  if (events.length > 0) handleEvents(events, view);
  if (game.renderTick !== null) watchClock(view);   // (before the first snapshot the View is a placeholder)
  const glove = view.local !== null && view.local.glove;
  if (glove !== T.glove) {
    T.glove = glove;
    input.setHasGlove(glove);
  }
  renderer.render(view, dt, t);
  if (t - T.hudAt >= HUD_EVERY_MS) {
    T.hudAt = t;
    ui.updateHud(game.hudModel(view, S.lobby ? S.lobby.players : []));
  }
}

// ---- Hidden tab -------------------------------------------------------------------------------------------------

function onHidden() {
  input.releaseAll();
  S.game?.pauseSending();
  if (S.practice && S.conn && !T.paused) {
    T.paused = true;
    S.conn.pause();                              // the Room's clock is virtual: every timer in it stands still with it
    ui.showDialog({
      title: 'Paused',
      text: 'Practice waits while this tab is in the background.',
      actions: [{ label: 'Resume', kind: 'primary', onClick: () => onVisible() }],
    });
  }
}

function onVisible() {
  const t = now();
  lastFrame = t;
  T.hudAt = 0;
  if (T.paused) {
    T.paused = false;
    ui.hideDialog();
    S.conn?.resume(t);
  }
  const conn = S.conn;
  if (S.game && conn && (S.practice || conn.readyState === 1)) S.game.resume(t);
  if (S.round) requestWakeLock();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) onHidden(); else onVisible(); });
window.addEventListener('pagehide', onHidden);
window.addEventListener('pageshow', (e) => { if (e.persisted && !document.hidden) onVisible(); });

// ---- Errors and the debug overlay -----------------------------------------------------------------------------------

let lastDebugText = '';

/** After boot.js hands over, errors still go to its list so the `?debug=1` overlay shows them. */
function noteError(err) {
  const list = window.__bpErrors;
  if (!Array.isArray(list)) return;
  list.push(String((err && err.message) || err));
  while (list.length > 5) list.shift();
  if (window.__bpDebug) window.__bpDebug.info(lastDebugText);
}

window.addEventListener('error', (e) => { if (e.message) noteError(e.message); });
window.addEventListener('unhandledrejection', (e) => noteError(e.reason));

function updateDebug() {
  const conn = S.conn;
  const ws = !conn ? 'none' : S.practice ? 'local' : ['connecting', 'open', 'closing', 'closed'][conn.readyState] ?? '?';
  lastDebugText = `${renderer.debugText()}\nrtt ${Math.round(S.game ? S.game.rtt : 0)}ms  ws ${ws}  screen ${ui.current}  audio ${audio.state}`;
  if (window.__bpDebug) window.__bpDebug.info(lastDebugText);
}

/** Plain-data snapshot of the client for the e2e specs (only with ?debug=1; nothing here can change the game). */
function probe() {
  const v = S.view;
  const round = S.round;
  const local = v && v.local ? v.local : null;
  return {
    screen: ui.current,
    me: S.me,
    code: S.code,
    practice: S.practice,
    joined: S.joined,
    ws: S.conn ? S.conn.readyState : -1,
    menuOpen: ui.menuOpen,
    blockers: ui.blockers,
    inputActive: input.active,
    audio: audio.state,
    lobby: S.lobby && {
      phase: S.lobby.phase, hostId: S.lobby.hostId, local: !!S.lobby.local, settings: S.lobby.settings,
      players: S.lobby.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, isHost: p.isHost, connected: p.connected, wins: p.wins, waiting: p.waiting })),
    },
    round: round && { n: round.n, theme: round.theme, mode: round.mode, fighters: round.players.length },
    view: v && round ? {
      state: v.state, countdown: v.countdown, timeLeft: v.timeLeft, suddenDeath: v.suddenDeath,
      bombs: v.bombs.length, ghosts: v.ghostBombs.length, flames: v.flames.length, items: v.items.length, falling: v.falling.length,
      players: v.players.map((p) => ({ id: p.id, x: p.x, y: p.y, alive: p.alive, isMe: p.isMe, name: p.name })),
      me: local && { x: local.x, y: local.y, alive: local.alive, facing: local.facing, moving: local.moving, bombsMax: local.bombsMax, range: local.range, speedLv: local.speedLv, glove: local.glove, kick: local.kick },
    } : null,
    rtt: S.game ? S.game.rtt : 0,
    stats: S.game ? { ...S.game.stats } : null,
    render: { ...renderer.stats, errors: renderer.errors.slice(), reduced: renderer.reducedEffects },
    settings: { ...ui.settings, muted: audio.muted, volume: audio.volume },
    counts: { ...T.counts },
    sounds: { ...T.sounds },
    msgs: { ...T.msgs },
  };
}

if (DEBUG) window.__bp = { probe };

// ---- Start ----------------------------------------------------------------------------------------------------------

/** Keeps the stored session fresh while the tab sits in a room, so a reload after a long lobby still finds it. */
setInterval(() => { if (S.token) saveSession(); }, KEEP_ALIVE_MS);

requestAnimationFrame(frame);
setMusic('menu');

const linkCode = roomCodeFromLocation(location);
const session = parseSession(tabStore.get(SESSION_KEY), Date.now());
if (mayRejoin(session, linkCode)) {
  ui.showTitle({ name: session.name });
  resumeSession(session);
} else {
  ui.showTitle(linkCode ? { code: linkCode } : {});
}
T.screen = ui.current;

window.__bpReady = true;
document.getElementById('boot')?.remove();
