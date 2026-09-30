// One match on screen: owns the renderer, input, HUD, shop, chat box, pause menu and end
// screen, and runs the requestAnimationFrame loop that ties them to the session:
//
//   input.sample() → UI edges → aim angle → session.update() → session.getView()
//   → session.drainEvents() → renderer/hud/audio.addEvents → render / hud / audio.update
//
// stop() releases everything it created (listeners, rAF, renderer) so the next match
// starts from a clean slate.
//
// Views (SPEC §7.5): 'fps' (default) runs the three.js first-person renderer; the UI owns
// yaw/pitch (mouse under pointer lock, touch look pad, gamepad right stick), rotates the
// move vector into world space and sends the yaw as the aim angle. 'topdown' (the classic
// view, and the fallback without WebGL) aims at the cursor through screenToWorld as before.
// The two renderers need different canvas contexts, so a canvas that already carries the
// other kind is swapped for a fresh clone.

import { DIFFICULTIES } from '../shared/constants.js';
import { resolveTime } from '../shared/timeofday.js';
import { STAGE_SHORT } from '../shared/campaign.js';
import { missionOf, simModeOf } from '../shared/story/registry.js';
import { $, copyText, createScope, formatShort, h, setShown } from './dom.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createShop, shopState } from './shop.js';
import { createGameChat } from './chat.js';
import { fillStatsTable, statRows } from './scoreboard.js';
import { padNavigate } from './padnav.js';
import { flashToast } from './menus.js';
import { applyLook, moveToWorld, aimAssist, sensitivityOf, wrapAngle } from './look.js';
import { rendererSettings } from './gfx.js';
import { createFrameLimiter } from './display.js';
import { currentUiScale } from './uiscale.js';
import { enterFullscreen, fullscreenSupported, isFullscreen } from './fullscreen.js';

const END_DELAY = 2.6;
/**
 * The debug hook between games. Module-level on purpose: closures created inside
 * startMatch() share its context, so `() => null` made there kept the finished match
 * (renderer, scene, HUD) reachable from window.__HH until the next game started.
 */
const NULL_DEBUG = Object.freeze({
  renderer: null, hud: null, input: null, getView: () => null, getLocal: () => null,
  view: null, look: () => {}, getLook: () => null,
});
/** After a touch button opens the shop/pause menu, clicks this soon are the same tap (s). */
const GHOST_CLICK_WINDOW = 0.6;
const MAX_LOGGED_ERRORS = 5;
/** A pause edge this soon after the lock loss opened the menu is the same Esc press (s). */
const LOCK_ESC_WINDOW = 0.5;

/** Whether the first-person renderer can run here (asked once per page: it makes a context). */
function webglOk(ctx) {
  if (ctx.webgl === undefined || ctx.webgl === null) {
    try {
      ctx.webgl = typeof ctx.deps.isWebGLAvailable === 'function' ? !!ctx.deps.isWebGLAvailable() : false;
    } catch {
      ctx.webgl = false;
    }
  }
  return ctx.webgl;
}

/**
 * The game canvas, ready for a context of `kind` ('2d' | 'webgl'). A canvas keeps the first
 * context type it was asked for, so switching views between games (or recovering from a
 * failed WebGL start) swaps in a fresh clone. The WebGL canvas itself is reused from game to
 * game: the browser caps live WebGL contexts, and three.js happily adopts the old one.
 */
function gameCanvas(kind, fresh = false) {
  let c = $('#game-canvas');
  if (fresh || (c.dataset.ctx && c.dataset.ctx !== kind)) {
    if (c.dataset.ctx === 'webgl') {
      // Hand the GPU context back now rather than whenever the old element is collected.
      try {
        const gl = c.getContext('webgl2');
        const lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch {
        // best-effort
      }
    }
    const n = c.cloneNode(false);
    c.replaceWith(n);
    c = n;
  }
  c.dataset.ctx = kind;
  return c;
}

/**
 * The frame rate dynamic resolution aims at 97 % of: the display's refresh rate (measured by app.js),
 * or the frame-rate limit when that is lower.
 */
function effectiveHz(ctx) {
  const hz = (ctx.display && ctx.display.refreshHz) || 60;
  const cap = Number(ctx.prefs.settings.fpsCap);
  return cap > 0 ? Math.min(hz, cap) : hz;
}

/** First-person renderer when the view setting asks for it and it can run, else top-down. */
function createViewRenderer(ctx, map, mode, time) {
  const { deps, prefs } = ctx;
  const quality = prefs.settings.quality;
  const refreshHz = effectiveHz(ctx);
  if (prefs.settings.view !== 'topdown' && typeof deps.createRenderer3D === 'function' && webglOk(ctx)) {
    const canvas = gameCanvas('webgl');
    try {
      return { fps: true, canvas, renderer: deps.createRenderer3D(canvas, { map, quality, mode, time, refreshHz }) };
    } catch (err) {
      console.warn('[game] the first-person view failed to start, using the classic view', err);
      ctx.webgl = false;
      const c2 = gameCanvas('2d', true);
      return { fps: false, canvas: c2, renderer: deps.createRenderer(c2, { map, quality, mode, time }), fellBack: true };
    }
  }
  const canvas = gameCanvas('2d');
  return { fps: false, canvas, renderer: deps.createRenderer(canvas, { map, quality, mode, time }), fellBack: prefs.settings.view !== 'topdown' };
}

/**
 * @param {object} ctx app context (deps, prefs, audio, history, modals, dialogs, settingsDialog,
 *   howTo, onLeave, setDebug)
 * @param {object} session Session in game (session.inGame, session.getMap() ready)
 * @returns {{ stop: Function, setRoster: Function, notice: Function, applySettings: Function }}
 */
export function startMatch(ctx, session) {
  const { deps, prefs, audio } = ctx;
  const scope = createScope();
  const screen = $('#screen-game');
  const hudEl = $('#hud');
  const pauseEl = $('#pause');
  const endEl = $('#endscreen');
  const map = session.getMap();
  if (!map) throw new Error('No map for the running game');

  screen.hidden = false;
  document.body.classList.add('in-game');

  // Late join works, so online games show the room code and an invite link in game
  // (pause menu + scoreboard header). Not in solo, which has no network.
  const solo = session.transport === 'local';
  const invite = !solo && session.code ? { code: session.code, onCopy: () => copyInvite() } : null;

  async function copyInvite() {
    const ok = await copyText(session.inviteUrl || session.code);
    audio.ui(ok ? 'click' : 'deny');
    flashToast(ok ? 'Invite link copied' : 'Couldn\'t copy — share the room code instead', ok ? 'good' : 'bad');
  }

  // Evac Run (SPEC §3.7): the renderers build the zone wall, the HUD its zone panel
  // The Campaign (SPEC §3.8): a map built with the campaign extension (map.campaign) plays it
  // Road to Haven (STORY.md): a mission or a hideout adds the story HUD on top of the wave machine
  // the mission runs on ('zone' | 'campaign' | none)
  const storyMode = !!session.settings && (session.settings.mode === 'mission' || session.settings.mode === 'hideout');
  const script = storyMode ? missionOf(session.settings) : null;
  const mode = map.campaign ? 'campaign'
    : storyMode ? (simModeOf(session.settings) === 'zone' ? 'zone' : 'defend')
      : (session.settings && session.settings.mode === 'zone') || (map.modes && !map.modes.includes('defend')) ? 'zone' : 'defend';
  const time = resolveTime(map, session.settings && session.settings.time);
  const made = createViewRenderer(ctx, map, mode, time);
  const { renderer, canvas, fps } = made;
  screen.classList.toggle('view-fps', fps);
  const input = createInput(canvas, {
    touchRoot: $('#touch-root'), forceTouch: ctx.forceTouch, view: fps ? 'fps' : 'topdown',
    onLockChange: (locked) => onLockChange(locked), rawMouse: prefs.settings.rawMouse,
  });
  const hud = createHud(hudEl, {
    map, renderClassPortrait: deps.renderClassPortrait, audio, invite,
    view: fps ? 'fps' : 'topdown', minimapRotate: prefs.settings.minimapRotate, mode,
    story: storyMode ? { title: (session.settings.story && session.settings.story.title) || (script && script.title) || '' } : null,
  });
  hud.setRoster(session.roster, session.localId);
  audio.setMap(map);
  // Story rooms (STORY.md): the overlays, stations and dialogue of ui/story.js ride on the match.
  const story = session.story && ctx.story ? ctx.story : null;
  if (made.fellBack && prefs.settings.view === 'fps') {
    // Said once per page: the setting stays 'fps' for a browser that can do it next time.
    if (!ctx.toldNoWebgl) hud.toast('3D view unavailable here — playing in the classic top-down view', 'minor', 5);
    ctx.toldNoWebgl = true;
  }

  // First person: the UI owns the camera angles (SPEC §7.5). Initialised from the local
  // player's snapshot angle the first time we see it.
  const look = { yaw: 0, pitch: 0 };
  let lookReady = false;
  const moveW = { x: 0, y: 0 };
  let pauseByLockAt = -1;
  let wasEnabled = false;
  // "Click to play" card while the mouse isn't captured (desktop first person only).
  const lockHint = h('div.lock-hint', { hidden: true }, [
    h('div.lock-hint-title', { text: 'Click to play' }),
    h('div.lock-hint-sub', { text: 'Mouse to look · Esc releases the mouse' }),
  ]);
  if (fps) screen.appendChild(lockHint);

  let pauseOpen = false;
  let endShown = false;
  let endAt = 0;
  let gameoverReason = '';
  let stopped = false;
  let raf = 0;
  let last = 0;
  // Settings > Display > frame-rate limit: skip the rAF callbacks above the cap (off = follow the display)
  const limiter = createFrameLimiter();
  let lastView = null;
  let prevPhase = '';
  let errors = 0;
  let fpsRate = 60;
  let frameCount = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let lastLocal = null;
  // Handed to every render call (gfx.js rendererSettings: fov, resolution scale and the
  // post effects are read by the first-person renderer, ignored by the top-down one).
  // `crosshair` tells it whether a menu covers the view.
  const renderSettings = rendererSettings(prefs.settings, { crosshair: true });
  const renderLook = { yaw: 0, pitch: 0 };
  // The quality the renderer was created with: setQuality() only runs when it changes
  // (it can rebuild lights, shadow maps and textures).
  let appliedQuality = prefs.settings.quality;

  const shop = createShop($('#shop-root'), { session, audio, map, onClose: () => refreshEnabled() });
  const chat = createGameChat(hudEl, {
    session,
    history: ctx.history,
    getRosterById: () => new Map(session.roster.map((r) => [r.id, r])),
    onOpenChange: () => refreshEnabled(),
    audio,
  });

  function applySettings() {
    const s = prefs.settings;
    rendererSettings(s, renderSettings);
    // Extra hint (not required by the render contract): the menus/HUD scale factor, for an
    // overlay that wants its crosshair and markers to grow with the HUD on big screens.
    renderSettings.uiScale = currentUiScale();
    hud.setMinimapRotate(s.minimapRotate);
    input.setRawMouse(s.rawMouse);
    if (renderer.setRefreshHz) renderer.setRefreshHz(effectiveHz(ctx));
    if (s.quality !== appliedQuality) {
      appliedQuality = s.quality;
      try {
        renderer.setQuality(s.quality);
      } catch (err) {
        console.warn('[game] setQuality failed', err);
      }
    }
  }
  applySettings();

  // "Start games in fullscreen": right away when this start came from a click (Play Solo,
  // Start Game); otherwise (a client whose host started) on the first click into the game.
  let wantFullscreen = !!prefs.settings.fullscreenOnStart && fullscreenSupported() && !isFullscreen();
  function goFullscreen() {
    if (!wantFullscreen || stopped) return;
    wantFullscreen = false;
    enterFullscreen().then((ok) => {
      // First person: in fullscreen the next click captures the mouse (Click to play).
      if (!ok) console.info('[game] fullscreen was refused');
    });
  }
  if (wantFullscreen && hasUserActivation()) goFullscreen();

  function overlayOpen() {
    return pauseOpen || endShown || chat.isOpen || shop.isOpen || ctx.modals.count > 0 || (!!story && story.isOpen);
  }

  /** In the hideout (and around a mission) the cash shop and the wave ready vote are not used. */
  function storyHub() {
    return !!story && session.story.stage !== 'mission';
  }

  function refreshEnabled() {
    const on = !overlayOpen();
    input.setEnabled(on);
    screen.classList.toggle('ui-open', !on);
    if (fps && on !== wasEnabled) {
      // A menu needs the cursor: release the mouse while one is open. Closing it takes the
      // mouse back when the browser still counts the closing key/click as a user gesture;
      // otherwise the "Click to play" card asks for a click.
      if (!on) input.exitLock();
      else if (!input.locked && input.mode === 'kbm' && hasUserActivation()) input.requestLock();
    }
    wasEnabled = on;
  }

  function hasUserActivation() {
    const ua = navigator.userActivation;
    return ua ? ua.isActive : false;
  }

  /** Pointer lock gained or lost. Losing it mid-game (Esc, alt-tab) opens the pause menu. */
  function onLockChange(locked) {
    if (stopped || !fps) return;
    if (!locked && !overlayOpen() && !endShown) {
      openPause();
      pauseByLockAt = performance.now();
    }
  }

  function updateLockHint(me) {
    if (!fps) return;
    const show = !stopped && input.mode === 'kbm' && input.lockSupported && !input.locked && !overlayOpen() && !!me;
    setShown(lockHint, show);
  }

  // ---- pause ---------------------------------------------------------------------------------

  $('#pause-note').textContent = solo
    ? 'The game keeps running — the horde doesn\'t wait. Your survivor stands still while this menu is open.'
    : 'The game keeps running in multiplayer — your survivor stands still while this menu is open.';
  // First person: resuming captures the mouse again (the click is the gesture it needs).
  $('#pause-resume').textContent = fps ? 'Click to Resume' : 'Resume';

  function openPause() {
    if (pauseOpen || endShown) return;
    if (shop.isOpen) shop.close();
    if (chat.isOpen) chat.close();
    pauseOpen = true;
    pauseEl.hidden = false;
    if (story) story.suspend(true);
    audio.ui('click');
    refreshEnabled();
    requestAnimationFrame(() => {
      if (pauseOpen) $('#pause-resume').focus({ preventScroll: true });
    });
  }

  function closePause() {
    if (!pauseOpen) return;
    pauseOpen = false;
    pauseEl.hidden = true;
    if (story) story.suspend(false);
    if (document.activeElement && pauseEl.contains(document.activeElement)) document.activeElement.blur();
    refreshEnabled();
  }

  scope.on($('#pause-resume'), 'click', () => {
    closePause();
    if (fps && !input.locked && !overlayOpen() && input.mode !== 'touch') input.requestLock();
  });
  scope.on($('#pause-settings'), 'click', () => ctx.settingsDialog.open(() => refreshEnabled()));
  scope.on($('#pause-howto'), 'click', () => ctx.howTo.open(() => refreshEnabled()));
  setShown($('#pause-invite'), !!invite);
  if (invite) $('#pause-code').textContent = invite.code;
  scope.on($('#pause-copy'), 'click', () => copyInvite());
  // The host can end the run for everyone (back to the lobby, same room).
  setShown($('#pause-end'), session.isHost);
  scope.on($('#pause-end'), 'click', () => {
    ctx.dialogs.confirm(
      solo ? 'Return to the lobby?' : 'Return everyone to the lobby?',
      solo ? 'This run ends here.' : 'This run ends for every survivor. The room stays open for the next game.',
      'End Game',
      () => session.returnToLobby(),
    );
  });
  scope.on($('#pause-leave'), 'click', () => {
    const text = solo
      ? 'Your progress in this run will be lost.'
      : session.isHost
        ? 'You are the host — leaving ends the game for everyone.'
        : 'You can rejoin with the room code while the game is still running.';
    ctx.dialogs.confirm('Leave the game?', text, 'Leave', () => ctx.onLeave());
  });
  scope.on(pauseEl, 'mousedown', (e) => {
    if (e.target !== pauseEl) return;
    closePause();
    if (fps && !input.locked && !overlayOpen()) input.requestLock();
  });

  // ---- end screen --------------------------------------------------------------------------------

  function showEnd(view) {
    if (endShown) return;
    endShown = true;
    if (shop.isOpen) shop.close();
    if (chat.isOpen) chat.close();
    closePause();
    hud.scoreboard.setVisible(false);
    const victory = view.phase === 'victory';
    endEl.classList.toggle('victory', victory);
    endEl.classList.toggle('defeat', !victory);
    const camp = map.campaign && view.campaign ? view.campaign : null;   // the Campaign's own end texts
    $('#end-title').textContent = storyMode ? (victory ? 'Mission complete' : 'Mission failed') : camp && victory ? 'Escaped' : victory ? 'Victory' : 'Overrun';
    const objName = (map.objective && map.objective.name) || 'objective';
    let sub;
    if (camp && victory) sub = 'Every survivor rode the zip line out. The horde stays behind.';
    else if (camp) sub = `The team fell ${['', 'on the hilltop', 'on the breakout', `on floor ${camp.floor}`, 'on the rooftop'][camp.stage] || ''}.`;
    else if (victory) sub = `All ${view.totalWaves} waves survived. The road is yours.`;
    else if (gameoverReason === 'objective' || (!gameoverReason && view.objective && view.objective.hp <= 0)) sub = `The ${objName} was destroyed on wave ${view.wave}.`;
    else sub = `Nobody was left standing on wave ${view.wave}.`;
    $('#end-sub').textContent = sub;
    const rows = statRows(view, session.roster);
    const kills = rows.reduce((a, r) => a + r.kills, 0);
    const mapName = (deps.MAP_LIST.find((m) => m.id === map.id) || { name: map.name || '' }).name;
    const diff = DIFFICULTIES[session.settings.difficulty];
    const survived = victory ? view.wave : Math.max(0, view.wave - 1);
    $('#end-summary').replaceChildren(
      camp ? chip('Stage reached', victory ? 'Escaped' : STAGE_SHORT[camp.stage] || String(camp.stage))
        : chip('Waves survived', view.totalWaves ? `${survived} / ${view.totalWaves}` : String(survived)),
      chip('Zombies killed', formatShort(kills)),
      chip('Map', mapName),
      chip('Difficulty', diff ? diff.name : session.settings.difficulty),
    );
    fillStatsTable($('#end-table'), rows, session.localId, { final: true });
    const host = session.isHost;
    $('#end-lobby').hidden = !host;
    setShown($('#end-wait'), !host);
    $('#end-leave').textContent = host && !solo ? 'Leave Room' : 'Main Menu';
    endEl.hidden = false;
    refreshEnabled();
    requestAnimationFrame(() => {
      const b = host ? $('#end-lobby') : $('#end-leave');
      if (endShown) b.focus({ preventScroll: true });
    });
  }

  function chip(label, value) {
    return h('div.end-chip', null, [h('span.end-chip-label', { text: label }), h('span.end-chip-value', { text: value })]);
  }

  scope.on($('#end-lobby'), 'click', () => session.returnToLobby());
  scope.on($('#end-leave'), 'click', () => ctx.onLeave());

  // ---- UI edges ----------------------------------------------------------------------------------

  // A touch button acts on pointerdown, but the browser still sends the tap's click when the
  // finger lifts — by then onto whatever just opened under it (a shop card would be bought).
  let ghostUntil = 0;
  function guardGhostClick() {
    if (input.mode === 'touch') ghostUntil = performance.now() + GHOST_CLICK_WINDOW * 1000;
  }
  scope.on(window, 'click', (e) => {
    if (performance.now() >= ghostUntil) return;
    if (e.target && e.target.closest && e.target.closest('.touch-btn')) return;
    ghostUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  function handleUi(inp, view, me) {
    // The Esc that released the pointer lock already opened the menu: don't close it again.
    if (inp.pause && pauseOpen && pauseByLockAt >= 0 && performance.now() - pauseByLockAt < LOCK_ESC_WINDOW * 1000) {
      inp.pause = false;
    }
    if (inp.pause) {
      // (a scene or a station panel is closed first; the briefing and the result screen are not)
      if (story && story.isOpen && story.escape()) { /* closed */ }
      else if (shop.isOpen) shop.close();
      else if (chat.isOpen) chat.close();
      else if (pauseOpen) closePause();
      else if (!endShown && ctx.modals.count === 0) {
        openPause();
        guardGhostClick();
      }
    }
    if (inp.shop && !pauseOpen && !endShown && !chat.isOpen && ctx.modals.count === 0 && !storyHub() && !(story && story.isOpen)) {
      if (shop.isOpen) {
        shop.close();
      } else {
        const st = shopState(view, me, map);
        if (st.open || !view || !me || view.phase === 'prep' || view.phase === 'intermission') {
          shop.open();
          guardGhostClick();
          audio.ui('click');
        } else {
          // Opening mid-wave would freeze the player away from cover: explain instead.
          hud.toast(me.state === 'alive' ? 'Mid-wave the shop is only open at the supply station' : st.text, 'danger', 2.6);
          audio.ui('deny');
        }
      }
    }
    if (inp.chat && !pauseOpen && !endShown && !shop.isOpen && !chat.isOpen && ctx.modals.count === 0) chat.open();
    if (inp.ready && !overlayOpen() && !storyHub() && view && me && (view.phase === 'prep' || view.phase === 'intermission') && !me.ready) {
      session.ready();
      audio.ui('ready');
    }
    if (inp.nav) {
      if (story && story.isOpen && !pauseOpen && ctx.modals.count === 0) {
        story.nav(inp.nav);
      } else if (shop.isOpen) {
        shop.nav(inp.nav);
      } else if (ctx.modals.count > 0) {
        const top = ctx.modals.top();
        if (inp.nav.back) ctx.modals.close(top, 'pad');
        else if ((inp.nav.tabPrev || inp.nav.tabNext) && top && top.id === 'dlg-settings') ctx.settingsDialog.cycleTab(inp.nav.tabNext ? 1 : -1);
        else padNavigate(top, inp.nav);
      } else if (pauseOpen) {
        if (inp.nav.back) closePause();
        else padNavigate(pauseEl, inp.nav);
      } else if (endShown) {
        padNavigate(endEl, inp.nav);
      }
    }
    hud.scoreboard.setVisible(!!inp.scoreboard && !pauseOpen && !endShown);
    refreshEnabled();
  }

  // ---- main loop -----------------------------------------------------------------------------------

  function findLocal(view) {
    if (!view) return null;
    for (const p of view.players) if (p.id === session.localId) return p;
    return null;
  }

  /** Audio listener: the camera centre, so a dead player hears around the spectated teammate. */
  function listenerPos() {
    const c = renderer.getCamera ? renderer.getCamera() : null;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
    return map.objective || { x: map.width / 2, y: map.height / 2 };
  }

  /**
   * First person: turn the camera by this frame's look input, pull it gently toward a
   * target for gamepad/touch aim assist, rotate the move vector into world space
   * (mutating `inp`) and return the yaw as the aim angle.
   */
  function firstPersonAim(inp, local, me, dt) {
    const s = prefs.settings;
    if (!lookReady) {
      // The first time we see ourselves: face where the sim says we face.
      const a = local && Number.isFinite(local.angle) ? local.angle : me && Number.isFinite(me.angle) ? me.angle : NaN;
      if (!Number.isFinite(a)) {
        // No facing yet: a view-relative move can't be turned into a world one.
        inp.moveX = inp.moveY = 0;
        return NaN;
      }
      look.yaw = wrapAngle(a);
      look.pitch = 0;
      lookReady = true;
    }
    const mouse = inp.mode === 'kbm';
    if (inp.lookDX || inp.lookDY) {
      applyLook(look, inp.lookDX, inp.lookDY, {
        sensitivity: mouse ? sensitivityOf(s.sensitivity) : sensitivityOf(s.padLook),
        invertY: !!s.invertY,
      });
    }
    const alive = me && me.state !== 'dead';
    if (s.aimAssist && !mouse && alive && local && lastView && input.enabled) {
      look.yaw = aimAssist(look.yaw, local.x, local.y, lastView.zombies, dt);
    }
    if (inp.moveX || inp.moveY) {
      moveToWorld(inp.moveX, inp.moveY, look.yaw, moveW);
      inp.moveX = moveW.x;
      inp.moveY = moveW.y;
    }
    return look.yaw;
  }

  function step(now, dt) {
    frameCount++;
    const viewBefore = lastView;
    const meBefore = findLocal(viewBefore);
    const inp = input.sample();
    handleUi(inp, viewBefore, meBefore);

    const local = session.getPredictedLocal();
    lastLocal = local;
    let aim = NaN;
    if (fps) {
      aim = firstPersonAim(inp, local, meBefore, dt);
    } else if (local) {
      // aim: from the predicted local player to the cursor in world space
      const sp = renderer.worldToScreen(local.x, local.y);
      input.setAnchor(sp.x, sp.y);
      const w = renderer.screenToWorld(inp.aimScreenX, inp.aimScreenY);
      if (Math.abs(w.x - local.x) + Math.abs(w.y - local.y) > 0.5) aim = Math.atan2(w.y - local.y, w.x - local.x);
    }
    session.update(dt, inp, aim);
    if (stopped) return; // a listener may have ended the match inside update()

    const view = session.getView(now);
    if (view) lastView = view;
    const me = findLocal(lastView);
    const events = session.drainEvents();
    if (events && events.length) {
      for (const e of events) if (e.type === 'gameover') gameoverReason = e.reason;
      const lp = listenerPos();
      renderer.addEvents(events, { localId: session.localId });
      hud.addEvents(events);
      shop.onEvents(events, session.localId);
      if (story) story.matchEvents(events);
      audio.addEvents(events, fps ? { x: lp.x, y: lp.y, yaw: lp.yaw, localId: session.localId } : { x: lp.x, y: lp.y, localId: session.localId });
    }

    const showCross = !overlayOpen() && (!me || me.state !== 'dead');
    renderSettings.crosshair = showCross;
    renderLook.yaw = look.yaw;
    renderLook.pitch = look.pitch;
    renderer.render(view, {
      localId: session.localId, roster: session.roster, now, dt,
      cursor: showCross ? input.cursor : null, settings: renderSettings,
      look: fps ? renderLook : undefined,
    });
    updateLockHint(me);
    if (story) story.matchFrame(lastView, lastLocal);

    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 0.5) {
      fpsRate = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    const cam = listenerPos();
    hud.update(view, {
      dt, mode: input.mode, stats: session.stats, fps: fpsRate, showStats: prefs.settings.showStats, isHost: session.isHost,
      renderStats: fps ? renderer.stats : null,
      localPos: local, shopOpen: shop.isOpen,
      yaw: fps ? (Number.isFinite(cam.yaw) ? cam.yaw : look.yaw) : undefined, camPos: fps ? cam : undefined,
    });
    audio.update(view, fps
      ? { localId: session.localId, dt, x: cam.x, y: cam.y, yaw: cam.yaw }
      : { localId: session.localId, dt, x: cam.x, y: cam.y });
    const cls = (session.roster.find((r) => r.id === session.localId) || { cls: prefs.cls }).cls;
    shop.update(lastView, me, cls, dt);

    const t = input.touch;
    if (t && lastView) {
      const between = lastView.phase === 'prep' || lastView.phase === 'intermission';
      t.showButton('ready', between && !(me && me.ready) && !storyHub());
      t.showButton('shop', !storyHub());
      if (!hud.scoreboard.visible) t.setToggle('scoreboard', false);
    }

    if (lastView) {
      const phase = lastView.phase;
      if (phase !== prevPhase) {
        // The wave started while browsing: don't leave the player frozen in the shop.
        if (phase === 'wave' && shop.isOpen && !shopState(lastView, me, map).open) {
          shop.close();
          hud.toast('Wave started — shop closed', 'danger', 2.4);
        }
        // (a story stage ends through the story flow: its result screen, not this one)
        if ((phase === 'gameover' || phase === 'victory') && !endAt && !story) endAt = now;
        prevPhase = phase;
      }
      if (shop.isOpen && me && me.state !== 'alive') shop.close();
      if (endAt && !endShown && now - endAt >= END_DELAY) showEnd(lastView);
    }
  }

  function frame(t) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (!limiter.allow(t, prefs.settings.fpsCap, ctx.display && ctx.display.refreshHz)) return;
    const dt = last ? Math.min(0.1, Math.max(0, (t - last) / 1000)) : 1 / 60;
    last = t;
    try {
      step(t / 1000, dt);
    } catch (err) {
      errors++;
      if (errors <= MAX_LOGGED_ERRORS) console.error('[game] frame failed', err);
    }
  }

  function resize() {
    if (stopped) return;
    renderer.resize();
    hud.resize();
  }
  scope.on(window, 'resize', resize);
  scope.on(window, 'orientationchange', () => setTimeout(() => {
    if (!stopped) {
      renderer.resize();
      hud.resize();
    }
  }, 250));
  // Keep keyboard focus on the game after clicking it, so keys never land in a stale field.
  scope.on(canvas, 'mousedown', () => {
    if (document.activeElement && document.activeElement !== document.body && !chat.isOpen) document.activeElement.blur();
    goFullscreen();
  });
  scope.on(screen, 'touchend', () => goFullscreen());

  refreshEnabled();
  if (story) {
    story.matchBegin(session, {
      map, toast: (text, tone, secs) => hud.toast(text, tone, secs), inputMode: () => input.mode, refreshEnabled: () => refreshEnabled(),
      openPause: () => openPause(),
    });
  }
  raf = requestAnimationFrame(frame);

  ctx.setDebug({
    renderer, hud, input, getView: () => lastView, getLocal: () => lastLocal,
    view: fps ? 'fps' : 'topdown',
    /**
     * Test hook (documented in scripts/e2e.js): turn the first-person camera as if the
     * mouse moved (dx, dy) CSS px under pointer lock. Headless browsers can lock the
     * pointer but can't produce locked mouse movement.
     */
    look: (dx, dy) => input.addLook(dx, dy),
    /** First person: the UI's camera angles { yaw, pitch } (radians) and lock state. */
    getLook: () => ({
      yaw: look.yaw, pitch: look.pitch, ready: lookReady, locked: input.locked, view: fps ? 'fps' : 'topdown', frames: frameCount,
    }),
  });

  return {
    setRoster(roster) {
      hud.setRoster(roster, session.localId);
    },
    notice(text) {
      hud.notice(text);
    },
    applySettings,
    /** The refresh rate was measured (late): dynamic resolution re-aims. */
    setRefreshHz() {
      if (renderer.setRefreshHz) renderer.setRefreshHz(effectiveHz(ctx));
    },
    /** The UI scale changed: HUD canvases (minimap, compass, portraits) follow their boxes. */
    resize() {
      if (stopped) return;
      renderSettings.uiScale = currentUiScale();
      hud.resize();
    },
    /** 'fps' | 'topdown': the view this match actually runs. */
    get view() {
      return fps ? 'fps' : 'topdown';
    },
    get ended() {
      return endShown;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      if (story) story.matchEnd();
      scope.dispose();
      const parts = [chat, shop, hud, input, renderer];
      for (const p of parts) {
        try {
          p.destroy();
        } catch (err) {
          console.warn('[game] teardown failed', err);
        }
      }
      try {
        audio.update(null, { localId: session.localId, dt: 0 });
        audio.setMap(null);
      } catch {
        // audio is best-effort
      }
      pauseOpen = false;
      endShown = false;
      pauseEl.hidden = true;
      endEl.hidden = true;
      screen.hidden = true;
      screen.classList.remove('ui-open');
      document.body.classList.remove('in-game');
      screen.classList.remove('view-fps');
      lockHint.remove();
      if (!fps) {
        // Blank the 2D canvas so the next game doesn't flash this one. (The WebGL canvas
        // is cleared by the next renderer's first frame and hidden with the screen.)
        const g = canvas.getContext('2d');
        if (g) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.fillStyle = '#000';
          g.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
      ctx.setDebug(NULL_DEBUG);
    },
  };
}
