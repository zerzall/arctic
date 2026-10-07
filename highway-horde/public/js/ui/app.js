// The app shell: screens, session lifecycle and wiring between the menus, the lobby and
// a running match. Every external module comes in through `deps`, so the real entry point
// (main.js) and the dev sandbox (dev/ui-sandbox.js, with a mock session) share this code.

import { $, createScope } from './dom.js';
import { showLoading, hideLoading, hideWhenDrawn, randomTip } from './loading.js';
import { loadPrefs, savePrefs, randomName, cleanName, isCoarsePointer } from './storage.js';
import {
  createModals, createTitle, createJoinDialog, createStatusDialogs, createSettingsDialog, createHowTo,
  parseJoinInput, flashToast, bindFullscreenButtons,
} from './menus.js';
import { applyUiScale } from './uiscale.js';
import { applyDetectedTier } from './gfx.js';
import { probeGpu, recommendedTier } from './gpu.js';
import { measureRefresh } from './display.js';
import { createLobby } from './lobby.js';
import { createChatHistory } from './chat.js';
import { startMatch } from './match.js';
import { createStoryApp } from './story.js';
import { loadProfile as loadStoryProfile } from '../shared/story/save.js';
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
  // A browser that cannot make the audio engine must not stop the game from starting: play on in silence.
  let audio;
  try {
    audio = deps.createAudio();
  } catch (err) {
    console.warn('[ui] audio unavailable, playing without sound:', err && err.message ? err.message : err);
    audio = new Proxy({}, { get: () => () => undefined });
  }
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
    /** The graphics card (ui/gpu.js probeGpu()), null until the title is up. */
    gpu: null,
    /** The display: refresh rate in Hz (measured with requestAnimationFrame on the menus; 60 until then). */
    display: { refreshHz: 60, measured: false },
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

  // ---- display: resolution-aware UI scale ----------------------------------------------------

  const coarse = isCoarsePointer() || !!deps.forceTouch;
  let layoutRaf = 0;
  /**
   * Re-derive the UI scale from the viewport and the UI size setting. When it changed,
   * the canvases sized by CSS (portraits, map previews, minimap, compass) redraw at the new
   * size on the next frame, after the new rem sizes are laid out.
   */
  function applyDisplay() {
    const { changed } = applyUiScale(prefs.settings, coarse);
    // Blurred glass panels over a live 3D scene cost GPU time: the Low preset skips them.
    document.documentElement.dataset.quality = prefs.settings.quality;
    if (changed && !layoutRaf) {
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        if (!titleEl.hidden) title.resize();
        if (lobby.visible) lobby.resize();
        if (match) match.resize();
        ctx.settingsDialog.refresh();
      });
    }
  }

  /**
   * Measure the display's refresh rate (about 1-2 s of requestAnimationFrame on the menus).
   * A steady measurement is the display's rate (a window moved to another monitor changes it); an
   * unsteady one, from a busy machine, can only be too low and only counts when it is higher.
   */
  let meter = null;
  function remeasureRefresh() {
    if (meter || document.hidden) return;
    meter = measureRefresh({
      onDone(hz, steady) {
        meter = null;
        if (hz && (steady || hz > ctx.display.refreshHz || !ctx.display.measured)) {
          ctx.display.refreshHz = hz;
          ctx.display.measured = true;
          if (match) match.setRefreshHz(hz);
          ctx.settingsDialog.refresh();
        }
      },
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !match) remeasureRefresh(); });

  function applySettings() {
    const s = prefs.settings;
    audio.setVolume({ master: s.master, sfx: s.sfx, music: s.music });
    audio.setMuted(s.muted);
    applyDisplay();
    if (match) match.applySettings();
  }

  // ---- screens ------------------------------------------------------------------------------

  const titleEl = $('#screen-title');
  // Before the screens build: portraits and previews measure their rem-sized boxes.
  try {
    applyUiScale(prefs.settings, coarse);
  } catch (err) {
    console.warn('[ui] UI scaling failed, using the default size:', err && err.message ? err.message : err);
  }
  document.documentElement.dataset.quality = prefs.settings.quality;

  function showTitle() {
    titleEl.hidden = false;
    lobby.hide();
    if (ctx.story) ctx.story.screen.hide();
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
    return { name, color: prefs.color, cls: prefs.cls, skin: prefs.skin };
  }

  /** Story menu: the Story screen replaces the title until the player goes back or hosts. */
  function openStory() {
    if (!ctx.story) return;
    titleEl.hidden = true;
    lobby.hide();
    ctx.story.screen.show();
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
    sessionScope.sub(s, 'start', (info) => {
      // A story room chains its games (hideout, mission, hideout ...): the next stage
      // replaces the running match instead of waiting for the lobby.
      if (info && info.story && match) {
        match.stop();
        match = null;
      }
      beginMatch();
    });
    if (s.story) ctx.story.attach(s, sessionScope);
    sessionScope.sub(s, 'lobby', () => backToLobby());
    sessionScope.sub(s, 'disconnected', (info) => onDisconnected(info && info.reason));
    sessionScope.sub(s, 'notice', (n) => {
      if (match) match.notice(n.text);
      else flashToast(n.text);
    });
    if (s.isHost && !s.story) {
      const l = prefs.lobby;
      s.setSettings({
        mapId: l.mapId,
        mode: l.mode,
        time: l.time,
        difficulty: DIFFICULTY_IDS.includes(l.difficulty) ? l.difficulty : 'normal',
        waves: WAVE_OPTIONS.includes(l.waves) ? l.waves : 15,
        objective: !!l.objective,
        friendlyFire: !!l.friendlyFire,
      });
    }
    titleEl.hidden = true;
    ctx.story.screen.hide();
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
  let starting = false;
  function beginMatch() {
    if (!session || match || starting) return;
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
    // Building the world blocks the page for a moment (seconds on a big map the first time): put the
    // loading screen up and let it paint before the work starts, so the game never looks frozen.
    const s = session;
    starting = true;
    const map = s.getMap && s.getMap();
    const story = s.story && map && map.kind === 'hideout' ? 'Heading to the hideout…' : s.story ? 'Preparing the mission…' : 'Building the world…';
    showLoading(story, map && map.name ? map.name : '', randomTip());
    afterPaint(() => {
      starting = false;
      if (session !== s || match || !s.inGame) { hideLoading(); return; }
      try {
        match = startMatch(ctx, s);
        hideWhenDrawn(() => (window.__HH && window.__HH.getLook ? window.__HH.getLook().frames : 0));
      } catch (err) {
        console.error('[ui] could not start the match', err);
        match = null;
        hideLoading();
        teardown();
        try {
          s.leave();
        } catch {
          // ignore
        }
        ctx.dialogs.error('Couldn\'t start the game', err && err.message ? err.message : String(err), () => showTitle());
      }
    });
  }

  /** Run `cb` after the browser has painted (two animation frames), or after 250 ms if it does not paint (a hidden tab). */
  function afterPaint(cb) {
    let done = false;
    const run = () => { if (!done) { done = true; cb(); } };
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 250);
  }

  function backToLobby() {
    hideLoading();
    if (match) match.stop();
    match = null;
    if (session) lobby.show(session);
  }

  function teardown() {
    hideLoading();
    if (match) match.stop();
    match = null;
    if (ctx.story) ctx.story.detach();
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
    const wasStory = !!(session && session.story);
    teardown();
    audio.ui('leave');
    const text = DISCONNECT_REASONS[reason] || reason || 'The connection was lost.';
    if (wasStory) {
      // The campaign and the survivor were saved as the host sent them: nothing is lost.
      ctx.dialogs.error('Disconnected', `${text} Your copy of the campaign and your survivor are saved on this device \u2014 anyone from the crew can host it again from the Story menu.`, () => openStory());
    } else {
      ctx.dialogs.error('Disconnected', text, () => showTitle());
    }
  }

  function leave() {
    const s = session;
    const wasStory = !!(s && s.story);
    teardown();
    if (s) {
      try {
        s.leave();
      } catch (err) {
        console.warn('[ui] leave failed', err);
      }
    }
    audio.ui('leave');
    if (wasStory) openStory();
    else showTitle();
  }

  function host(transport, story = null) {
    const p = profile();
    const solo = transport === 'local';
    connect(
      'host',
      () => deps.hostGame(story ? { ...p, transport, story } : { ...p, transport }),
      solo ? 'Preparing…' : 'Creating room…',
      solo ? 'Setting up your solo run.' : 'Getting a room code for your friends.',
    );
  }

  function doJoin(code, via) {
    const p = profile();
    // A survivor saved in this browser comes along: a story room checks it and keeps it up to
    // date; any other room ignores it.
    const story = ctx.story && loadStoryProfile() ? { profile: ctx.story.ensureProfile() } : null;
    connect('join', () => deps.joinGame(story ? { code, via, ...p, story } : { code, via, ...p }), 'Joining…', `Connecting to room ${code}.`);
  }

  // ---- screens & dialogs ------------------------------------------------------------------------

  const title = createTitle({
    ...ctx,
    savePrefs: ctx.savePrefs,
    onStory: () => openStory(),
    onSolo: () => host('local'),
    onHost: () => host('auto'),
    onJoin: () => join.open(),
    onSettings: () => ctx.settingsDialog.open(),
    onHowTo: () => ctx.howTo.open(),
  });
  const join = createJoinDialog({ ...ctx, onSubmit: doJoin });
  ctx.profileInfo = () => profile();
  // The Story screens are an optional extra: if they cannot start in this browser, hide the Story button and
  // keep the rest of the game working.
  try {
    ctx.story = createStoryApp(ctx, {
      hostStory: (transport, story) => host(transport, story),
      joinDialog: () => join.open(),
      showTitle: () => showTitle(),
    });
  } catch (err) {
    console.warn('[ui] Story mode unavailable in this browser:', err && err.message ? err.message : err);
    ctx.story = null;
    const storyBtn = document.getElementById('btn-story');
    if (storyBtn) storyBtn.hidden = true;
  }
  const lobby = createLobby(ctx);
  applySettings();
  bindFullscreenButtons();

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

  // Window resizes (and entering/leaving fullscreen) change the automatic UI scale.
  window.addEventListener('resize', () => applyDisplay());

  window.addEventListener('pagehide', () => {
    if (session) {
      try {
        session.leave();
      } catch {
        // page is going away anyway
      }
    }
  });

  // The browser may keep this page in its back/forward cache after 'pagehide' closed the session; coming
  // back with the Back button would show a lobby or match that belongs to a dead session. Start fresh.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
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
  hideLoading();
  // Without a GPU the animated menu backdrop repaints the whole screen on the CPU every
  // frame: detect it once the title is up and keep the menus still (game.css). The same probe
  // names the graphics card: a profile that never picked a quality starts on the tier the card is
  // good for (Cinematic on an RTX-class GPU, SPEC §7.5.3); a chosen quality is never touched.
  setTimeout(() => {
    const info = probeGpu();
    ctx.gpu = info;
    document.documentElement.dataset.gpu = info.software ? 'software' : 'hardware';
    if (applyDetectedTier(prefs.settings, recommendedTier(info, { coarse }))) {
      ctx.savePrefs();
      applySettings();
    }
    ctx.settingsDialog.refresh();
    // then the refresh rate, while nothing heavy runs
    remeasureRefresh();
  }, 0);
  // Web fonts can shift the layout after boot: refit the portraits once they are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!titleEl.hidden) title.resize();
    }).catch(() => {});
  }

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
