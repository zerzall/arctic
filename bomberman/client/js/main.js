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
//
// THE SINGLE-FILE DOWNLOAD (window.__BP_SINGLE__, set by an inline script before the bundle; see scripts/build-single.mjs)
//   There is no server. Practice is unchanged. "Host a game" runs a Room in this page (p2p.js HostSession, lazily imported) and the host's own
//   player talks to it through HostConnection; "Join a friend's game" connects a GuestConnection to a host's page over a WebRTC data channel
//   after the two players swapped a code each (dialogs in ui.js). S.p2p says which role this tab has. What differs from the served build:
//   no /r/CODE addresses or stored session (a file:// page has neither), no automatic reconnect (a guest whose link dropped needs a new code
//   and gets the same character back through its token), and when the host leaves the game ends for everybody.

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
const SINGLE = window.__BP_SINGLE__ === true;
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
  p2p: null,                                   // single-file play with friends: 'host' | 'guest' | null
  host: null,                                  // HostSession (host only)
  guestSession: null,                          // GuestSession (guest only, during the handshake)
  invite: null,                                // the host's unanswered invite: { id, code }
  hostName: '',                                // the host's name as the invite showed it (guest only)
  tokenGame: '',                               // which hosted game S.token belongs to (guest only): a seat token is never sent to another game
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

let p2pModule = null;
/** p2p.js is only ever loaded by the single-file build (a lazy import: the served build never reaches this). */
const loadP2P = () => (p2pModule ??= import('./p2p.js').catch((err) => { p2pModule = null; throw err; }));

const ui = new UI(document.getElementById('app'), {
  onCreate: (name) => { sfx('click'); startOnline({ name, create: true }); },
  onJoin: (code, name) => { sfx('click'); startOnline({ name, code, create: false }); },
  onPractice: (name) => { sfx('click'); startPractice(name); },
  onHost: (name) => { sfx('click'); startHost(name); },
  onJoinFriend: (name) => { sfx('click'); startJoinFriend(name); },
  onAddFriend: () => { sfx('click'); openAddFriend(); },
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
  if (!SINGLE && isRoomCode(code)) {
    try { history.replaceState(null, '', `/r/${code}${DEBUG ? '?debug=1' : ''}`); } catch { /* an unusual embedding; the room works without a pretty address */ }
  }
  if (S.inRoom) return;
  S.inRoom = true;
  try { history.pushState({ bp: 1 }, '', location.href); } catch { /* as above */ }
}

function leaveRoomUrl() {
  if (SINGLE) {                                 // a file:// page has no address to tidy (and history.replaceState to '/' would throw)
    S.inRoom = false;
    return;
  }
  if (!S.inRoom && location.pathname === '/') return;
  S.inRoom = false;
  try { history.replaceState(null, '', DEBUG ? '/?debug=1' : '/'); } catch { /* as above */ }
}

window.addEventListener('popstate', () => {
  if (S.inRoom) {                               // the back gesture must not throw a player out of a match: ask instead
    try { history.pushState({ bp: 1 }, '', location.href); } catch { /* ignore */ }
    if (ui.current === 'game') ui.showMenu(true);
  } else if (!SINGLE && ui.current === 'title' && location.pathname !== '/') {
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

/** `prebuilt`: a connection that already exists (the host's own player, or a guest's data channel); it is used instead of a new one. */
function connect(practice, text, prebuilt = null) {
  S.practice = practice;
  const gen = ++S.gen;
  ui.showConnecting(text, () => { cancelConnecting(); });
  const conn = prebuilt ?? (practice ? new LoopbackConnection() : new WebSocketConnection());
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
  if (!practice && prebuilt === null) {
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
  if (S.host) { try { S.host.shutdown(); } catch (err) { console.error(err); } }     // (closing the host's connection already did; this covers "still loading")
  try { S.guestSession?.close(); } catch (err) { console.error(err); }
  ui.p2pDialog?.close();
  S.host = null;
  S.guestSession = null;
  S.invite = null;
  S.p2p = null;
  S.hostName = '';
  S.tokenGame = '';
  ui.setP2P(null);
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
  if (S.p2p === 'host' && S.host && S.host.friendCount > 0) {          // leaving ends the game for everyone: ask first
    ui.showDialog({
      title: 'End the game?',
      text: 'You are the host, so leaving ends the game for everyone who joined you.',
      tone: 'error',
      actions: [
        { label: 'End the game', kind: 'danger', onClick: () => goHome() },
        { label: 'Keep playing', kind: 'primary' },
      ],
    });
    return;
  }
  const conn = S.conn;
  if (conn && !S.practice && S.p2p !== 'host' && S.joined && conn.readyState === 1) conn.send({ t: 'leave' });     // the seat is freed now, not after the grace period
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
  if (S.p2p) {
    onP2PClosed(info);
    return;
  }
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

// ---- Single-file play with friends (window.__BP_SINGLE__) ---------------------------------------------------------

/** Host a game: a Room in this page, the host's own player, and a way to add friends. */
async function startHost(name) {
  endSession();
  S.name = name;
  S.create = true;
  S.p2p = 'host';
  ui.setP2P('host');
  const gen = ++S.gen;
  ui.showConnecting('Starting your game...', () => cancelConnecting());
  let session;
  try {
    const mod = await loadP2P();
    if (gen !== S.gen) return;
    session = new mod.HostSession({ name });
  } catch (err) {
    console.error(err);
    if (gen === S.gen) goHome({ error: "Hosting could not start in this browser. You can still play Practice, or join a friend's game." });
    return;
  }
  S.host = session;
  session.on((ev) => { if (S.host === session) onHostEvent(ev); });
  connect(false, 'Starting your game...', session.localConnection());
}

/** Join a friend's game: the paste-a-code dialog first, the data channel next, then the ordinary lobby. */
async function startJoinFriend(name) {
  endSession();
  S.name = name;
  S.create = false;
  S.p2p = 'guest';
  ui.setP2P('guest');
  await openJoinDialog();
}

async function openJoinDialog() {
  const gen = ++S.gen;
  let mod;
  try {
    mod = await loadP2P();
  } catch (err) {
    console.error(err);
    if (gen === S.gen) goHome({ error: "Joining could not start in this browser. Practice still works." });
    return;
  }
  if (gen !== S.gen) return;
  S.guestSession?.close();
  const session = new mod.GuestSession();
  S.guestSession = session;
  let dialog = null;
  const hostName = () => session.hostName || 'the host';
  session.on((ev) => {
    if (S.guestSession !== session || ev.type !== 'state') return;
    if (ev.state === 'connecting') dialog?.setStatus('busy', `Connecting to ${hostName()}... this can take up to 20 seconds.`);
    else if (ev.state === 'waiting') {
      if (ev.message) dialog?.setStatus('busy', `${ev.message}`);
    } else if (ev.state === 'failed') {
      dialog?.setStatus('error', `${ev.message} Press "Start again" and ask the host for a new code.`);
      dialog?.expireCode?.();
    } else if (ev.state === 'open') {
      S.hostName = session.hostName;
      if (S.token && S.tokenGame !== session.gameId) S.token = '';     // a different game (or a restarted one): the old seat token stays with its own host
      S.tokenGame = session.gameId;
      const conn = session.connection();
      S.guestSession = null;
      dialog?.close();
      connect(false, S.token ? 'Getting back in...' : `Joining ${hostName()}...`, conn);
    }
  });
  dialog = ui.showJoinFriend({
    onInvite: (text) => session.acceptInvite(text),
    hostName,
    onClose: () => {                             // the player gave up on the dialog
      if (S.guestSession === session) goHome();
    },
  });
}

/** The host's "Add a friend": a fresh invite (or the unanswered one, when reopened), and the reply that completes it. */
function openAddFriend() {
  const host = S.host;
  if (!host) return;
  ui.showAddFriend({
    onNewCode: async (force) => {
      if (!force && S.invite && host.inviteAlive(S.invite.id)) return S.invite.code;
      if (S.invite) host.cancelInvite(S.invite.id);
      S.invite = null;
      const made = await host.createInvite();
      if (S.host !== host) return made.code;
      S.invite = { id: made.id, code: made.code };
      return made.code;
    },
    onReply: async (text) => {
      await host.acceptReply(text);
      S.invite = null;                           // one invite, one friend
    },
    onClose: () => {},
  });
}

/** Why the Room turned a friend away, in words for the host (their dialog is still open). */
const REFUSED_COPY = {
  locked: 'Your friend connected, but the game is locked. Switch off "Lock room" in the lobby, then press "New code" and try again.',
  full: 'Your friend connected, but the game is full. Remove a bot or kick a player in the lobby, then press "New code" and try again.',
  kicked: 'That player was removed from this game earlier, so they cannot come back.',
  hello: 'Your friend connected but never said hello. Ask them to keep the page open and try a new code.',
  default: 'Your friend connected, but the game would not let them in. Press "New code" and try again.',
};

/** Guest side: what a turned-away friend reads (the game is not a "room" here). */
const P2P_JOIN_COPY = {
  full: 'That game is full. If you were in it a moment ago, your old seat may still be held: ask the host to kick the away player, then join again.',
  locked: 'The host has locked the game, so nobody new can join. Ask them to switch off "Lock room".',
  kicked: 'The host removed you from that game.',
  no_room: 'That game is not running any more. Ask the host for a new code.',
};

/** What the host's session tells the page while friends connect, join and drop. */
function onHostEvent(ev) {
  const dialog = ui.p2pDialog;
  if (ev.type === 'closed') return;
  if (ev.type !== 'friend') return;
  switch (ev.state) {
    case 'connecting':
      dialog?.setStatus('busy', 'Connecting to your friend... this can take up to 20 seconds.');
      break;
    case 'open':
      dialog?.setStatus('busy', 'Connected! Getting your friend into the lobby...');
      break;
    case 'joined':
      if (dialog) dialog.close();
      ui.toast('A friend joined your game!', 'good');
      break;
    case 'failed':
      dialog?.setStatus('error', `${ev.message} Press "New code" and try again.`);
      dialog?.setBusy(false);
      break;
    case 'refused':
      dialog?.setStatus('error', REFUSED_COPY[ev.code] ?? REFUSED_COPY.default);
      dialog?.setBusy(false);
      break;
    case 'lost':
      if (!S.host?.closed) ui.toast('A friend lost their connection. Open the menu and tap "Add a friend" to let them back in with a new code.', 'warn', { ms: 8000 });
      break;
    default:
      break;
  }
}

/** A single-file connection ended. Nothing reconnects by itself here: the text says what the player can do instead. */
function onP2PClosed(info) {
  if (info.byUser) return;
  if (S.p2p === 'host') {
    goHome();
    ui.showDialog({
      title: 'Your game ended',
      text: info.reason === 'closed' ? 'The game was closed after a long time without any activity. You can host a new one.' : 'The game stopped unexpectedly. You can host a new one from the home screen.',
      actions: [{ label: 'OK', kind: 'primary' }],
    });
    return;
  }
  if (info.hostEnded) {
    goHome();
    ui.showDialog({ title: 'The host ended the game', text: 'The host left, so this game is over. You can host your own game or join another one.', actions: [{ label: 'OK', kind: 'primary' }] });
    return;
  }
  if (info.fatal) {
    const outcome = closeOutcome(info, { practice: false, tokenJoin: false, serverClosed: false, sinceReload: null });
    if (outcome.kind === 'kicked') {
      goHome();
      ui.showDialog({ title: 'You were removed', text: 'The host removed you from the game.', tone: 'error', actions: [{ label: 'OK', kind: 'primary' }] });
    } else {
      goHome({ error: P2P_JOIN_COPY[info.reason] ?? outcome.text ?? 'Could not join that game. Ask the host for a new code.' });
    }
    return;
  }
  // The link itself broke: the host closed the page, or the network between you went away.
  S.game?.pauseSending();
  input.releaseAll();
  S.conn = null;
  S.joined = false;
  ui.showConnecting(null);
  ui.showDialog({
    title: 'Connection lost',
    text: 'You lost your link to the host. If the host closed or reloaded their page, the game is over. If they are still hosting, ask them to open the menu, tap "Add a friend" and send you a new code: you get your character back.',
    tone: 'error',
    actions: [
      { label: 'Rejoin with a new code', kind: 'primary', onClick: () => { openJoinDialog(); } },
      { label: 'Leave', kind: 'glass', onClick: () => goHome() },
    ],
  });
}

// Closing or reloading the host's page: tell the friends the game is over instead of leaving them to find out from a silent link (best effort).
window.addEventListener('pagehide', (e) => {
  if (!e.persisted && S.p2p === 'host' && S.host && !S.host.closed) S.host.shutdown();     // (a page the browser keeps for the back button may come back alive: leave that one)
});

window.addEventListener('beforeunload', (e) => {
  if (S.p2p === 'host' && S.host && S.host.friendCount > 0) {          // closing the page ends the game for everyone
    e.preventDefault();
    e.returnValue = '';
  }
});

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
    saveSession();                               // (a no-op in the single-file build: 'P2P' is no room code, and there is no address to rejoin from)
  }
  enterRoom(S.practice || S.p2p ? '' : msg.code);
  if (S.p2p === 'host') requestWakeLock();       // a phone that goes to sleep takes the whole game down with it
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
  if (S.round || S.p2p === 'host') requestWakeLock();
  if (S.p2p === 'host' && S.host && S.host.friendCount > 0 && S.host.tickerKind !== 'worker') {
    ui.toast('Friends may lag while this tab is in the background. Keep it visible while you host.', 'warn', { ms: 6000 });
  }
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
    p2p: S.p2p,
    friends: S.host ? S.host.friendCount : 0,
    ticker: S.host ? S.host.tickerKind : '',
    hostTick: S.host && S.host.room.world ? S.host.room.world.tickNo : -1,
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

if (DEBUG) {
  window.__bp = {
    probe,
    /** e2e only: cuts this guest's link without telling the host, like a network that went away. */
    dropLink: () => S.conn?.dropLink?.(),
    host: () => S.host,
  };
}

// ---- Start ----------------------------------------------------------------------------------------------------------

/** Keeps the stored session fresh while the tab sits in a room, so a reload after a long lobby still finds it. */
setInterval(() => { if (S.token) saveSession(); }, KEEP_ALIVE_MS);

requestAnimationFrame(frame);
setMusic('menu');

const linkCode = SINGLE ? '' : roomCodeFromLocation(location);     // (a file:// address never carries a room)
const session = SINGLE ? null : parseSession(tabStore.get(SESSION_KEY), Date.now());
if (mayRejoin(session, linkCode)) {
  ui.showTitle({ name: session.name });
  resumeSession(session);
} else {
  ui.showTitle(linkCode ? { code: linkCode } : {});
}
T.screen = ui.current;

window.__bpReady = true;
document.getElementById('boot')?.remove();
