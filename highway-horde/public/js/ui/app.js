// The app shell: screens, session lifecycle and wiring between the menus, the lobby and
// a running match. Every external module comes in through `deps`, so the real entry point
// (main.js) and the dev sandbox (dev/ui-sandbox.js, with a mock session) share this code.

import { $, createScope } from './dom.js';
import { loadPrefs, savePrefs, randomName, cleanName } from './storage.js';
import {
  createModals, createTitle, createJoinDialog, createStatusDialogs, createSettingsDialog, createHowTo,
  parseJoinInput, flashToast,
} from './menus.js';
import { createLobby } from './lobby.js';
import { createChatHistory } from './chat.js';
import { startMatch } from './match.js';
import { ROOM_CODE_LENGTH, DIFFICULTY_IDS, WAVE_OPTIONS } from '../shared/constants.js';

const JOIN_ERRORS = {
  'Room not found': 'There is no game with that code. Check the letters — a room closes when its host leaves.',
  'Room is full': 'That room already has six survivors. Ask the host to make space.',
  'Game version mismatch': 'Your game version doesn\'t match the host\'s. Both of you should reload the page.',
  'Could not connect': 'Couldn\'t reach the host. Check your connection and try again — strict school or office networks can block peer-to-peer play.',
  'Room is locked': 'The host has locked this room. Ask them to unlock it, then try again.',
  'You were kicked from this room': 'The host removed you from this room, so you can\'t rejoin it.',
};

const DISCONNECT_REASONS = {
  'Host left the game': 'The host left the game.',
  Kicked: 'The host removed you from the room.',
  'Connection lost': 'Lost the connection to the host.',
};

/**
 * Boot the UI.
 * @param {object} deps
 * @param {Function} deps.hostGame        net/session.js
 * @param {Function} deps.joinGame        net/session.js
 * @param {Function} deps.getServerInfo   net/session.js
 * @param {Function} deps.createRenderer  render/renderer.js
 * @param {Function} [deps.createRenderer3D] render3d/renderer3d.js (first-person view; may be
 *   filled in later by deps.renderer3dReady)
 * @param {Function} [deps.isWebGLAvailable] render3d/renderer3d.js
 * @param {Promise}  [deps.renderer3dReady] settles once the 3D module loaded (or failed to)
 * @param {Function} deps.renderMapPreview
 * @param {Function} deps.renderClassPortrait
 * @param {Function} deps.createAudio     audio/audio.js
 * @param {Array}    deps.MAP_LIST        shared/maps.js
 * @param {Function} deps.buildMap        shared/maps.js
 * @param {boolean}  [deps.forceTouch]    show touch controls (sandbox)
 * @param {string}   [deps.search]        query string to read ?join= from (default location.search)
 * @returns {object} the app context (handy for the sandbox)
 */
export function startApp(deps) {
  const prefs = loadPrefs();
  const audio = deps.createAudio();
  const debug = { session: null, renderer: null, hud: null, audio, input: null, getView: () => null, getLocal: () => null };
  window.__HH = debug;

  const ctx = {
    deps,
    prefs,
    audio,
    history: createChatHistory(),
    modals: createModals(),
    forceTouch: !!deps.forceTouch,
    randomName,
    savePrefs: () => savePrefs(prefs),
    setDebug: (o) => Object.assign(debug, o),
    applySettings,
    onLeave: () => leave(),
    onStartFailed: () => flashToast('Could not start the game', 'bad'),
    /** WebGL check result (match.js asks once), undefined until then. */
    webgl: undefined,
  };
  ctx.dialogs = createStatusDialogs(ctx);
  ctx.settingsDialog = createSettingsDialog(ctx);
  ctx.howTo = createHowTo(ctx);

  let session = null;
  let sessionScope = null;
  let match = null;
  let pending = null;
  let knownIds = new Set();

  // Validate what storage says the host picked last time against the current map list.
  if (!deps.MAP_LIST.some((m) => m.id === prefs.lobby.mapId)) prefs.lobby.mapId = deps.MAP_LIST[0].id;

  function applySettings() {
    const s = prefs.settings;
    audio.setVolume({ master: s.master, sfx: s.sfx, music: s.music });
    audio.setMuted(s.muted);
    if (match) match.applySettings();
  }
  applySettings();

  // ---- screens ------------------------------------------------------------------------------

  const titleEl = $('#screen-title');

  function showTitle() {
    titleEl.hidden = false;
    lobby.hide();
    title.refresh();
    // Drop ?join= so going back to the menu doesn't rejoin on reload.
    try {
      if (/[?&]join=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
    } catch {
      // sandboxed iframes may refuse
    }
  }

  function profile() {
    const name = title.ensureName();
    return { name, color: prefs.color, cls: prefs.cls };
  }

  // ---- session lifecycle ---------------------------------------------------------------------

  async function connect(kind, run, heading, text) {
    if (pending || session) return;
    const token = { cancelled: false };
    pending = token;
    ctx.dialogs.connecting(heading, text, () => {
      token.cancelled = true;
      if (pending === token) pending = null;
    });
    let s;
    try {
      s = await run();
    } catch (err) {
      if (token.cancelled) return;
      pending = null;
      ctx.dialogs.doneConnecting();
      const msg = err && err.message ? err.message : String(err);
      console.warn('[ui] connect failed:', msg);
      audio.ui('deny');
      ctx.dialogs.error(kind === 'join' ? 'Couldn\'t join' : 'Couldn\'t create a room', JOIN_ERRORS[msg] || msg, () => showTitle());
      return;
    }
    if (token.cancelled) {
      try {
        s.leave();
      } catch {
        // already gone
      }
      return;
    }
    pending = null;
    ctx.dialogs.doneConnecting();
    attach(s);
  }

  function attach(s) {
    session = s;
    debug.session = s;
    ctx.history.clear();
    knownIds = new Set(s.roster.map((r) => r.id));
    sessionScope = createScope();
    sessionScope.sub(s, 'roster', onRoster);
    sessionScope.sub(s, 'settings', () => lobby.render());
    sessionScope.sub(s, 'chat', (m) => ctx.history.push(m));
    sessionScope.sub(s, 'start', () => beginMatch());
    sessionScope.sub(s, 'lobby', () => backToLobby());
    sessionScope.sub(s, 'disconnected', (info) => onDisconnected(info && info.reason));
    sessionScope.sub(s, 'notice', (n) => {
      if (match) match.notice(n.text);
      else flashToast(n.text);
    });
    if (s.isHost) {
      const l = prefs.lobby;
      s.setSettings({
        mapId: l.mapId,
        difficulty: DIFFICULTY_IDS.includes(l.difficulty) ? l.difficulty : 'normal',
        waves: WAVE_OPTIONS.includes(l.waves) ? l.waves : 15,
        objective: !!l.objective,
        friendlyFire: !!l.friendlyFire,
      });
    }
    titleEl.hidden = true;
    if (s.inGame) {
      // A late joiner's 'start' arrives on the next task; only step in if it didn't.
      sessionScope.timeout(() => {
        if (session === s && s.inGame && !match) beginMatch();
      }, 60);
    } else {
      lobby.show(s);
    }
    audio.ui('join');
  }

  function onRoster(roster) {
    const ids = new Set(roster.map((r) => r.id));
    let joined = false, left = false;
    for (const id of ids) if (!knownIds.has(id)) joined = true;
    for (const id of knownIds) if (!ids.has(id)) left = true;
    knownIds = ids;
    if (joined) audio.ui('join');
    else if (left) audio.ui('leave');
    lobby.render();
    if (match) match.setRoster(roster);
  }

  let waiting3d = false;
  function beginMatch() {
    if (!session || match) return;
    // The first-person renderer (three.js) loads in the background after boot. A game that
    // starts before it arrives waits for it, rather than silently dropping to top-down.
    if (prefs.settings.view !== 'topdown' && !deps.createRenderer3D && deps.renderer3dReady && !deps.renderer3dFailed) {
      if (waiting3d) return;
      waiting3d = true;
      const s = session;
      deps.renderer3dReady.finally(() => {
        waiting3d = false;
        if (!deps.createRenderer3D) deps.renderer3dFailed = true;
        if (session === s && s.inGame && !match) beginMatch();
      });
      return;
    }
    lobby.hide();
    ctx.modals.close($('#dlg-confirm'));
    try {
      match = startMatch(ctx, session);
    } catch (err) {
      console.error('[ui] could not start the match', err);
      match = null;
      const s = session;
      teardown();
      try {
        s.leave();
      } catch {
        // ignore
      }
      ctx.dialogs.error('Couldn\'t start the game', err && err.message ? err.message : String(err), () => showTitle());
    }
  }

  function backToLobby() {
    if (match) match.stop();
    match = null;
    if (session) lobby.show(session);
  }

  function teardown() {
    if (match) match.stop();
    match = null;
    if (sessionScope) sessionScope.dispose();
    sessionScope = null;
    lobby.reset();
    session = null;
    debug.session = null;
    for (const el of document.querySelectorAll('.modal')) {
      if (el.id !== 'dlg-error' && ctx.modals.isOpen(el)) ctx.modals.close(el, 'teardown');
    }
  }

  function onDisconnected(reason) {
    teardown();
    audio.ui('leave');
    ctx.dialogs.error('Disconnected', DISCONNECT_REASONS[reason] || reason || 'The connection was lost.', () => showTitle());
  }

  function leave() {
    const s = session;
    teardown();
    if (s) {
      try {
        s.leave();
      } catch (err) {
        console.warn('[ui] leave failed', err);
      }
    }
    audio.ui('leave');
    showTitle();
  }

  function host(transport) {
    const p = profile();
    const solo = transport === 'local';
    connect(
      'host',
      () => deps.hostGame({ ...p, transport }),
      solo ? 'Preparing…' : 'Creating room…',
      solo ? 'Setting up your solo run.' : 'Getting a room code for your friends.',
    );
  }

  function doJoin(code, via) {
    const p = profile();
    connect('join', () => deps.joinGame({ code, via, ...p }), 'Joining…', `Connecting to room ${code}.`);
  }

  // ---- screens & dialogs ------------------------------------------------------------------------

  const title = createTitle({
    ...ctx,
    savePrefs: ctx.savePrefs,
    onSolo: () => host('local'),
    onHost: () => host('auto'),
    onJoin: () => join.open(),
    onSettings: () => ctx.settingsDialog.open(),
    onHowTo: () => ctx.howTo.open(),
  });
  const join = createJoinDialog({ ...ctx, onSubmit: doJoin });
  const lobby = createLobby(ctx);

  // Name edits in the lobby go straight to the session.
  const lobbyName = $('#lobby-name');
  if (lobbyName) {
    lobbyName.addEventListener('change', () => {
      const n = cleanName(lobbyName.value);
      if (!n) return;
      prefs.name = n;
      ctx.savePrefs();
      if (session) session.setProfile({ name: n });
    });
  }

  // ---- global behaviour ------------------------------------------------------------------------

  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  // Button click / hover sounds, delegated.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.btn');
    if (b && !b.disabled && !b.hasAttribute('data-silent')) audio.ui('click');
  });
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest && e.target.closest('.btn:not([disabled]), .class-card, .map-card:not([aria-disabled="true"]), .shop-card:not([disabled])');
    if (!b || (e.relatedTarget && b.contains(e.relatedTarget))) return;
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    audio.ui('hover');
  });

  window.addEventListener('pagehide', () => {
    if (session) {
      try {
        session.leave();
      } catch {
        // page is going away anyway
      }
    }
  });

  Promise.resolve()
    .then(() => deps.getServerInfo())
    .then((info) => {
      title.setServerStatus(info && info.relay
        ? 'Relay server online — friends can join from any network.'
        : 'Online play connects you and your friends directly (peer-to-peer).');
    })
    .catch(() => title.setServerStatus('Online play connects you and your friends directly (peer-to-peer).'));

  // Invite links: ?join=CODE[&via=relay]. Read before showTitle(), which drops the query.
  const params = new URLSearchParams(deps.search !== undefined ? deps.search : location.search);
  const joinParam = params.get('join');

  $('#app').classList.remove('booting');
  showTitle();

  if (joinParam) {
    const { code } = parseJoinInput(joinParam);
    const via = params.get('via') === 'relay' ? 'relay' : params.get('via') === 'p2p' ? 'p2p' : undefined;
    if (code.length === ROOM_CODE_LENGTH) doJoin(code, via);
    else join.open(joinParam, via);
  } else if (!prefs.seenHowTo && !prefs.name) {
    // First visit: nudge towards the controls without blocking anything.
    flashToast('New here? Check “How to Play” for the controls.');
  }

  Object.assign(ctx, { host, doJoin, leave, showTitle, title, lobby, join });
  // Live views (Object.assign would copy a getter's value, not the getter).
  Object.defineProperties(ctx, {
    session: { get: () => session, enumerable: true },
    match: { get: () => match, enumerable: true },
  });
  return ctx;
}
