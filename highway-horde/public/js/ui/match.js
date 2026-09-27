// One match on screen: owns the renderer, input, HUD, shop, chat box, pause menu and end
// screen, and runs the requestAnimationFrame loop that ties them to the session:
//
//   input.sample() → UI edges → aim angle → session.update() → session.getView()
//   → session.drainEvents() → renderer/hud/audio.addEvents → render / hud / audio.update
//
// stop() releases everything it created (listeners, rAF, renderer) so the next match
// starts from a clean slate.

import { DIFFICULTIES } from '../shared/constants.js';
import { $, createScope, formatShort, h, setShown } from './dom.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createShop, shopState } from './shop.js';
import { createGameChat } from './chat.js';
import { fillStatsTable, statRows } from './scoreboard.js';
import { padNavigate } from './padnav.js';

const END_DELAY = 2.6;
const MAX_LOGGED_ERRORS = 5;

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
  const canvas = $('#game-canvas');
  const hudEl = $('#hud');
  const pauseEl = $('#pause');
  const endEl = $('#endscreen');
  const map = session.getMap();
  if (!map) throw new Error('No map for the running game');

  screen.hidden = false;
  document.body.classList.add('in-game');

  const renderer = deps.createRenderer(canvas, { map, quality: prefs.settings.quality });
  const input = createInput(canvas, { touchRoot: $('#touch-root'), forceTouch: ctx.forceTouch });
  const hud = createHud(hudEl, { map, renderClassPortrait: deps.renderClassPortrait, audio });
  hud.setRoster(session.roster, session.localId);

  let pauseOpen = false;
  let endShown = false;
  let endAt = 0;
  let gameoverReason = '';
  let stopped = false;
  let raf = 0;
  let last = 0;
  let lastView = null;
  let prevPhase = '';
  let errors = 0;
  let fps = 60;
  let fpsAcc = 0;
  let fpsN = 0;
  let lastLocal = null;
  const renderSettings = { screenShake: true, showNames: true, lighting: true };

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
    renderSettings.screenShake = s.screenShake;
    renderSettings.showNames = s.showNames;
    renderSettings.lighting = s.lighting;
    try {
      renderer.setQuality(s.quality);
    } catch (err) {
      console.warn('[game] setQuality failed', err);
    }
  }
  applySettings();

  function overlayOpen() {
    return pauseOpen || endShown || chat.isOpen || shop.isOpen || ctx.modals.count > 0;
  }

  function refreshEnabled() {
    const on = !overlayOpen();
    input.setEnabled(on);
    screen.classList.toggle('ui-open', !on);
  }

  // ---- pause ---------------------------------------------------------------------------------

  const solo = session.transport === 'local';
  $('#pause-note').textContent = solo
    ? 'The game keeps running — the horde doesn\'t wait. Your survivor stands still while this menu is open.'
    : 'The game keeps running in multiplayer — your survivor stands still while this menu is open.';

  function openPause() {
    if (pauseOpen || endShown) return;
    if (shop.isOpen) shop.close();
    if (chat.isOpen) chat.close();
    pauseOpen = true;
    pauseEl.hidden = false;
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
    if (document.activeElement && pauseEl.contains(document.activeElement)) document.activeElement.blur();
    refreshEnabled();
  }

  scope.on($('#pause-resume'), 'click', () => closePause());
  scope.on($('#pause-settings'), 'click', () => ctx.settingsDialog.open(() => refreshEnabled()));
  scope.on($('#pause-howto'), 'click', () => ctx.howTo.open(() => refreshEnabled()));
  scope.on($('#pause-leave'), 'click', () => {
    const text = solo
      ? 'Your progress in this run will be lost.'
      : session.isHost
        ? 'You are the host — leaving ends the game for everyone.'
        : 'You can rejoin with the room code while the game is still running.';
    ctx.dialogs.confirm('Leave the game?', text, 'Leave', () => ctx.onLeave());
  });
  scope.on(pauseEl, 'mousedown', (e) => {
    if (e.target === pauseEl) closePause();
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
    $('#end-title').textContent = victory ? 'Victory' : 'Overrun';
    const objName = (map.objective && map.objective.name) || 'objective';
    let sub;
    if (victory) sub = `All ${view.totalWaves} waves survived. The road is yours.`;
    else if (gameoverReason === 'objective' || (!gameoverReason && view.objective && view.objective.hp <= 0)) sub = `The ${objName} was destroyed on wave ${view.wave}.`;
    else sub = `Nobody was left standing on wave ${view.wave}.`;
    $('#end-sub').textContent = sub;
    const rows = statRows(view, session.roster);
    const kills = rows.reduce((a, r) => a + r.kills, 0);
    const mapName = (deps.MAP_LIST.find((m) => m.id === map.id) || { name: map.name || '' }).name;
    const diff = DIFFICULTIES[session.settings.difficulty];
    const survived = victory ? view.wave : Math.max(0, view.wave - 1);
    $('#end-summary').replaceChildren(
      chip('Waves survived', view.totalWaves ? `${survived} / ${view.totalWaves}` : String(survived)),
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

  function handleUi(inp, view, me) {
    if (inp.pause) {
      if (shop.isOpen) shop.close();
      else if (chat.isOpen) chat.close();
      else if (pauseOpen) closePause();
      else if (!endShown && ctx.modals.count === 0) openPause();
    }
    if (inp.shop && !pauseOpen && !endShown && !chat.isOpen && ctx.modals.count === 0) {
      if (shop.isOpen) {
        shop.close();
      } else {
        const st = shopState(view, me, map);
        if (st.open || !view || !me || view.phase === 'prep' || view.phase === 'intermission') {
          shop.open();
          audio.ui('click');
        } else {
          // Opening mid-wave would freeze the player away from cover: explain instead.
          hud.toast(me.state === 'alive' ? 'Mid-wave the shop is only open at the supply station' : st.text, 'danger', 2.6);
          audio.ui('deny');
        }
      }
    }
    if (inp.chat && !pauseOpen && !endShown && !shop.isOpen && !chat.isOpen && ctx.modals.count === 0) chat.open();
    if (inp.ready && !overlayOpen() && view && me && (view.phase === 'prep' || view.phase === 'intermission') && !me.ready) {
      session.ready();
      audio.ui('ready');
    }
    if (inp.nav) {
      if (shop.isOpen) {
        shop.nav(inp.nav);
      } else if (ctx.modals.count > 0) {
        const top = ctx.modals.top();
        if (inp.nav.back) ctx.modals.close(top, 'pad');
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

  function listenerPos(view, local) {
    if (local) return local;
    const me = findLocal(view);
    if (me && me.state !== 'dead') return me;
    if (view) for (const p of view.players) if (p.state === 'alive') return p;
    return map.objective || { x: map.width / 2, y: map.height / 2 };
  }

  function step(now, dt) {
    const viewBefore = lastView;
    const meBefore = findLocal(viewBefore);
    const inp = input.sample();
    handleUi(inp, viewBefore, meBefore);

    // aim: from the predicted local player to the cursor in world space
    const local = session.getPredictedLocal();
    lastLocal = local;
    let aim = NaN;
    if (local) {
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
      const lp = listenerPos(lastView, local);
      renderer.addEvents(events, { localId: session.localId });
      hud.addEvents(events);
      shop.onEvents(events, session.localId);
      audio.addEvents(events, { x: lp.x, y: lp.y, localId: session.localId });
    }

    const showCross = !overlayOpen() && (!me || me.state !== 'dead');
    renderer.render(view, {
      localId: session.localId, roster: session.roster, now, dt,
      cursor: showCross ? input.cursor : null, settings: renderSettings,
    });

    fpsAcc += dt;
    fpsN++;
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    hud.update(view, {
      dt, mode: input.mode, stats: session.stats, fps, showStats: prefs.settings.showStats, isHost: session.isHost,
      localPos: local, shopOpen: shop.isOpen,
    });
    audio.update(view, { localId: session.localId, dt });
    const cls = (session.roster.find((r) => r.id === session.localId) || { cls: prefs.cls }).cls;
    shop.update(lastView, me, cls, dt);

    const t = input.touch;
    if (t && lastView) {
      const between = lastView.phase === 'prep' || lastView.phase === 'intermission';
      t.showButton('ready', between && !(me && me.ready));
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
        if ((phase === 'gameover' || phase === 'victory') && !endAt) endAt = now;
        prevPhase = phase;
      }
      if (shop.isOpen && me && me.state !== 'alive') shop.close();
      if (endAt && !endShown && now - endAt >= END_DELAY) showEnd(lastView);
    }
  }

  function frame(t) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, Math.max(0, (t - last) / 1000)) : 1 / 60;
    last = t;
    try {
      step(t / 1000, dt);
    } catch (err) {
      errors++;
      if (errors <= MAX_LOGGED_ERRORS) console.error('[game] frame failed', err);
    }
  }

  scope.on(window, 'resize', () => {
    renderer.resize();
    hud.resize();
  });
  scope.on(window, 'orientationchange', () => setTimeout(() => {
    if (!stopped) {
      renderer.resize();
      hud.resize();
    }
  }, 250));
  // Keep keyboard focus on the game after clicking it, so keys never land in a stale field.
  scope.on(canvas, 'mousedown', () => {
    if (document.activeElement && document.activeElement !== document.body && !chat.isOpen) document.activeElement.blur();
  });

  refreshEnabled();
  raf = requestAnimationFrame(frame);

  ctx.setDebug({ renderer, hud, input, getView: () => lastView, getLocal: () => lastLocal });

  return {
    setRoster(roster) {
      hud.setRoster(roster, session.localId);
    },
    notice(text) {
      hud.notice(text);
    },
    applySettings,
    get ended() {
      return endShown;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
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
      const g = canvas.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setDebug({ renderer: null, hud: null, input: null, getView: () => null, getLocal: () => null });
    },
  };
}
