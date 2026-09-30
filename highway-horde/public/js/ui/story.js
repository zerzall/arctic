// The story UI controller: one per app. It owns the overlays (dialogue player, station
// panels, briefing / debrief), the Story screen and the story lobby panel, saves what the
// session tells it to save (the profile and world copies), and gives the running match the
// few hooks it needs (see ui/match.js: `ctx.story.matchBegin / matchEvents / matchFrame /
// matchEnd`, `isOpen`, `escape`, `nav`).
//
// Nothing here runs unless the player opens the Story screen or joins a story room.

import { $, h, setText, setShown } from './dom.js';
import { createProfile, sanitizeProfile } from '../shared/story/profile.js';
import { createWorld } from '../shared/story/world.js';
import { loadProfile, saveProfile, saveWorld, loadWorlds } from '../shared/story/save.js';
import { getScene, talkLines, castOf, getMission, getMissions } from '../shared/story/content.js';
import { currentChapter } from '../shared/story/world.js';
import { xpBar } from '../shared/story/progression.js';
import { flashToast } from './menus.js';
import { padNavigate } from './padnav.js';
import { createVoice } from './story-voice.js';
import { createDialogue } from './story-dialogue.js';
import { createPanels } from './story-panels.js';
import { createFlow } from './story-flow.js';
import { createStoryScreen } from './story-screen.js';
import { createStoryLobby } from './story-lobby.js';
import { reasonText, num } from './story-kit.js';

/** Station kinds (map.interactables / hub stations) → panel. */
const STATION_PANELS = {
  board: 'board', radio: 'board', workbench: 'workbench', armory: 'armory', stash: 'armory', infirmary: 'infirmary', upgrades: 'upgrades',
};

const STATION_LABELS = { board: 'Mission board', workbench: 'Workbench', armory: 'Armory', infirmary: 'Infirmary', upgrades: 'Upgrade board', perks: 'Perks' };

const BUY_ACTS = new Set(['tier', 'perk', 'hideout', 'kit', 'buykit', 'buygun', 'donate']);

/**
 * @param {object} ctx app context
 * @param {{ hostStory: Function, joinDialog: Function, showTitle: Function }} hooks
 */
export function createStoryApp(ctx, hooks) {
  const { deps, prefs, audio } = ctx;
  const root = $('#story-root');
  let session = null;
  let matchHooks = null;
  let statusEl = null;
  let dockEl = null;
  let promptEl = null;
  let lastPrompt = '';
  let introFor = null;

  const voice = createVoice(() => prefs.settings);
  const dialogue = createDialogue({ root, audio, voice, deps });
  const panels = createPanels({ root, ctx, audio, deps, getSession: () => session, onClose: () => changed() });
  const flow = createFlow({
    root, ctx, audio, deps, getSession: () => session, dialogue, panels, onChange: () => changed(),
    onMenu: () => matchHooks && matchHooks.openPause && matchHooks.openPause(),
  });
  const lobby = createStoryLobby(ctx);

  // ---- profile & saves -----------------------------------------------------------------------------

  /** This browser's survivor: loaded (or created) and kept in step with the title's name, class and colour. */
  function ensureProfile() {
    const base = ctx.profileInfo();
    let p = loadProfile();
    if (!p) {
      p = createProfile({ name: base.name, cls: base.cls, color: base.color });
    } else {
      const { profile } = sanitizeProfile({ ...p, name: base.name, cls: base.cls, color: base.color });
      p = profile;
    }
    saveProfile(p);
    return p;
  }

  function play(world, transport) {
    const profile = ensureProfile();
    // Host the highest revision this browser has of the campaign.
    const best = loadWorlds()[world.id] || world;
    hooks.hostStory(transport, { profile, world: best });
  }

  function create({ name, difficulty, transport }) {
    const profile = ensureProfile();
    const world = createWorld({ name, difficulty, profile });
    saveWorld(world);
    hooks.hostStory(transport, { profile, world });
  }

  const screen = createStoryScreen(ctx, {
    ensureProfile,
    onPlay: play,
    onCreate: create,
    onJoin: () => hooks.joinDialog(),
    onBack: () => hooks.showTitle(),
  });

  // ---- session events -------------------------------------------------------------------------------

  function changed() {
    if (matchHooks) matchHooks.refreshEnabled();
    updateStatus();
  }

  /** The game screen carries the stage (CSS hides the wave HUD in the hideout). */
  function syncStage() {
    const el = $('#screen-game');
    if (!el) return;
    if (session && session.story && matchHooks) el.dataset.story = session.story.stage;
    else delete el.dataset.story;
  }

  function onStory(e) {
    switch (e.kind) {
      case 'profile':
        saveProfile(e.profile);
        panels.refresh();
        flow.refreshDebrief();
        updateStatus();
        if (ctx.lobby) ctx.lobby.render();
        break;
      case 'world':
        saveWorld(e.world);
        panels.refresh();
        if (ctx.lobby) ctx.lobby.render();
        break;
      case 'result':
        if (e.ok) audio.ui(BUY_ACTS.has(e.a) ? 'buy' : e.a === 'heal' ? 'ready' : 'click');
        else {
          audio.ui('deny');
          if (e.reason !== 'busy') flashToast(reasonText(e.reason), 'bad');
        }
        break;
      case 'state':
        flow.sync();
        syncStage();
        if (ctx.lobby) ctx.lobby.render();
        updateStatus();
        break;
      case 'debrief':
        flow.sync();
        break;
      default:
    }
  }

  /** A story session was attached (host or joined): persist what we hold and listen. */
  function attach(s, scope) {
    session = s;
    if (!s.story) return;
    scope.sub(s, 'story', onStory);
    saveWorld(s.story.world);
    if (s.story.profile) saveProfile(s.story.profile);
    // Joined a campaign that this browser knows in a newer revision: offer ours to the host.
    if (!s.isHost) {
      const mine = loadWorlds()[s.story.world.id];
      if (mine && mine.rev > s.story.world.rev) s.story._act({ a: 'sync', world: mine });
    }
    introFor = null;
    window.__HH_STORY = api;
  }

  function detach() {
    session = null;
    panels.close();
    flow.sync();
    dialogue.escape();
    lobby.reset();
    introFor = null;
    window.__HH_STORY = null;
  }

  // ---- the running match ---------------------------------------------------------------------------------

  function canOpenPanels() {
    return !!session && !!session.story && session.story.stage !== 'mission' && session.story.stage !== 'lobby';
  }

  function ensureHud(hooksIn) {
    const hudEl = $('#hud');
    if (!statusEl || !statusEl.isConnected) {
      statusEl = h('div.st-status.hud-box', { hidden: true }, [h('span.st-status-lv'), h('span.st-status-bar', null, h('i')), h('span.st-status-scrap')]);
      const tl = hudEl.querySelector('.hud-top-left');
      if (tl) tl.prepend(statusEl);
      else hudEl.appendChild(statusEl);
    }
    if (!promptEl || !promptEl.isConnected) {
      promptEl = h('div.st-prompt', { hidden: true, role: 'status' });
      hudEl.appendChild(promptEl);
    }
    if (!dockEl || !dockEl.isConnected) {
      dockEl = h('nav.st-dock', { hidden: true, 'aria-label': 'Hideout stations' }, ['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'perks'].map((k) => h('button.btn.btn-small', {
        type: 'button', dataset: { station: k }, title: STATION_LABELS[k], onclick: () => openStation(k),
      }, STATION_LABELS[k])));
      hudEl.appendChild(dockEl);
    }
    void hooksIn;
  }

  function openStation(kind) {
    if (!canOpenPanels()) return false;
    const st = session.story;
    if (st.stage === 'briefing' && kind === 'board') return false;
    return panels.open(kind);
  }

  function updateStatus() {
    if (!statusEl || !statusEl.isConnected || !session || !session.story || !session.story.profile) return;
    const p = session.story.profile;
    const b = xpBar(p);
    setText(statusEl.querySelector('.st-status-lv'), `LV ${b.level}`);
    statusEl.querySelector('.st-status-bar i').style.width = `${Math.round(b.frac * 100)}%`;
    setText(statusEl.querySelector('.st-status-scrap'), `${num(p.scrap)} scrap${p.perkPoints ? ` · ${p.perkPoints} perk pt${p.perkPoints === 1 ? '' : 's'}` : ''}`);
  }

  function matchBegin(s, mh) {
    session = s;
    matchHooks = mh;
    if (!s.story) return;
    ensureHud();
    const st = s.story;
    syncStage();
    statusEl.hidden = false;
    dockEl.hidden = !(mh.map && mh.map.stub);
    updateStatus();
    flow.sync();
    if (st.stage === 'hideout') {
      const name = (mh.map && (mh.map.name || (mh.map.hub && mh.map.hub.name))) || 'Hideout';
      mh.toast(name, 'good', 3);
      // the very first arrival: the opening scene (the host records that it was seen)
      if (introFor !== st.world.id && !st.world.progress.flags.talked_intro && !dialogue.isOpen) {
        introFor = st.world.id;
        const lines = getScene('intro');
        if (lines) {
          setTimeout(() => {
            dialogue.play(lines, { title: 'Day 41', onDone: () => {
              if (st.isHost) st.talked('intro');
              changed();
            } });
            changed();
          }, 700);
        } else if (st.isHost) {
          st.talked('intro');
        }
      }
    } else if (st.stage === 'mission') {
      const m = getMission(st.missionId);
      if (m) mh.toast(`${m.chapter}.${m.index} · ${m.title}`, 'danger', 3.5);
      audio.ui('stage');
    }
  }

  function matchEnd() {
    matchHooks = null;
    if (statusEl) statusEl.hidden = true;
    if (dockEl) dockEl.hidden = true;
    if (promptEl) promptEl.hidden = true;
    syncStage();
    root.classList.remove('suspended');
    panels.close();
    dialogue.escape();
  }

  function matchEvents(events) {
    if (!session || !session.story) return;
    const me = session.localId;
    for (const ev of events) {
      if (!ev || ev.pid !== me) continue;
      if (ev.type === 'interact') {
        const panel = STATION_PANELS[ev.kind];
        if (panel) {
          if (canOpenPanels() && !dialogue.isOpen && !flow.debriefOpen) openStation(panel);
        } else if (ev.kind === 'bed') {
          flashToast('You rest. The campaign is saved.', 'good');
        }
      } else if (ev.type === 'talk' && typeof ev.npc === 'string') {
        const st = session.story;
        if (!dialogue.isOpen && canOpenPanels()) {
          const lines = talkLines(ev.npc, { chapter: currentChapter(st.world, getMissions()), flags: st.world.progress.flags, completed: st.world.progress.completed });
          dialogue.play(lines, { title: castOf(ev.npc).name, onDone: () => { st.talked(ev.npc); changed(); } });
          changed();
        }
      }
    }
  }

  function matchFrame(view, local) {
    if (!promptEl || !session || !session.story || !matchHooks) return;
    let text = '';
    const map = matchHooks.map;
    if (local && map && map.interactables && !isOpen() && canOpenPanels()) {
      let best = null, bestD = Infinity;
      for (const it of map.interactables) {
        const d = Math.hypot(it.x - local.x, it.y - local.y);
        if (d <= it.r + 16 && d < bestD) {
          bestD = d;
          best = it;
        }
      }
      if (best) {
        const key = { kbm: 'E', pad: 'RB', touch: 'USE' }[matchHooks.inputMode()] || 'E';
        text = `${key} — ${best.label || best.kind}`;
      }
    }
    if (text !== lastPrompt) {
      lastPrompt = text;
      promptEl.textContent = text;
      setShown(promptEl, !!text);
    }
  }

  // ---- overlay plumbing ----------------------------------------------------------------------------------------

  function isOpen() {
    return dialogue.isOpen || panels.isOpen || flow.briefingOpen || flow.debriefOpen;
  }

  /** Esc / pause pressed: close the top overlay. @returns {boolean} whether one was closed */
  function escape() {
    if (dialogue.isOpen) return dialogue.escape();
    if (panels.isOpen) return panels.escape();
    return false;
  }

  /** Gamepad edges for the topmost story overlay. */
  function nav(n) {
    if (dialogue.isOpen) dialogue.nav(n);
    else if (panels.isOpen) panels.nav(n);
    else {
      const el = flow.activeElement();
      if (el) padNavigate(el, n);
    }
  }

  // ---- gamepad menus outside a match ------------------------------------------------------------------------------

  let padTimer = 0;
  const held = new Map();
  function padTick() {
    if (ctx.match) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const now = performance.now();
    const cur = {
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6,
      accept: b(0), back: b(1), tabPrev: b(4), tabNext: b(5),
    };
    const edges = {};
    let any = false;
    for (const k of Object.keys(cur)) {
      const was = held.get(k);
      if (cur[k]) {
        // edge, then a slow repeat for directions
        if (!was) {
          held.set(k, now + 380);
          edges[k] = true;
          any = true;
        } else if ((k === 'up' || k === 'down' || k === 'left' || k === 'right') && now >= was) {
          held.set(k, now + 130);
          edges[k] = true;
          any = true;
        }
      } else {
        held.delete(k);
      }
    }
    if (!any) return;
    route(edges);
  }

  function route(edges) {
    if (isOpen()) {
      nav(edges);
      return;
    }
    const top = ctx.modals.top ? ctx.modals.top() : null;
    if (top) {
      if (edges.back) ctx.modals.close(top, 'pad');
      else padNavigate(top, edges);
      return;
    }
    const visible = ['#screen-story', '#screen-lobby', '#screen-title'].map((s) => $(s)).find((el) => el && !el.hidden);
    if (!visible) return;
    if (edges.back && visible.id === 'screen-story') hooks.showTitle();
    else padNavigate(visible, edges);
  }

  window.addEventListener('gamepadconnected', () => {
    if (!padTimer) padTimer = setInterval(padTick, 33);
  });
  window.addEventListener('gamepaddisconnected', () => {
    const any = navigator.getGamepads && [...navigator.getGamepads()].some((p) => p && p.connected);
    if (!any && padTimer) {
      clearInterval(padTimer);
      padTimer = 0;
    }
  });

  // ---- keyboard: P opens the perk tree in the hideout ---------------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'p' || e.key === 'P') && matchHooks && session && session.story && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (isOpen() && !panels.isOpen) return;
      if (ctx.modals.count > 0) return;
      e.preventDefault();
      if (panels.isOpen && panels.kind === 'perks') panels.close();
      else if (canOpenPanels() && !dialogue.isOpen) openStation('perks');
    }
  });

  const api = {
    open: (k) => openStation(k),
    close: () => panels.close(),
    get stage() {
      return session && session.story ? session.story.stage : null;
    },
    get session() {
      return session;
    },
    get panel() {
      return panels.kind;
    },
    get dialogueOpen() {
      return dialogue.isOpen;
    },
    playScene: (lines, o) => dialogue.play(lines, o),
    skipScene: () => dialogue.escape(),
  };

  return {
    screen,
    lobby,
    ensureProfile,
    attach,
    detach,
    matchBegin,
    matchEnd,
    matchEvents,
    matchFrame,
    get isOpen() {
      return isOpen();
    },
    escape,
    nav,
    /** The pause menu sits under the story layer: hide the layer while it is open. */
    suspend(on) {
      root.classList.toggle('suspended', !!on);
    },
    api,
    dialogue,
    panels,
    flow,
  };
}
