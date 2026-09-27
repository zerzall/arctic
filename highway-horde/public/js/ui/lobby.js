// Lobby screen: room code + invite link, roster, the host's mission settings (map,
// difficulty, waves, objective, friendly fire), survivor changes, chat, ready / start.
// Everyone sees the settings; only the host can change them.

import { CLASSES, CLASS_IDS } from '../shared/classes.js';
import {
  PLAYER_COLORS, PLAYER_COLOR_NAMES, DIFFICULTIES, DIFFICULTY_IDS, WAVE_OPTIONS, MAX_PLAYERS,
} from '../shared/constants.js';
import { $, h, copyText, setText } from './dom.js';
import { chatLine, sendFromInput } from './chat.js';
import { flashToast } from './menus.js';

const previewCache = new Map();

const DIFF_HINT = {
  easy: 'Fewer, weaker zombies',
  normal: 'The intended fight',
  hard: 'More of them, hitting harder',
  nightmare: 'Good luck',
};

function transportLabel(session) {
  if (session.transport === 'local') return 'Solo · offline';
  if (session.transport === 'relay') return 'Online · relay server';
  return 'Online · peer-to-peer';
}

/**
 * @param {object} ctx { prefs, savePrefs, deps, audio, history, modals, dialogs, onLeave, onStartFailed }
 */
export function createLobby(ctx) {
  const { deps, prefs, audio } = ctx;
  const screen = $('#screen-lobby');
  const codeBtn = $('#room-code');
  const rosterEl = $('#roster');
  const mapCards = $('#map-cards');
  const segDiff = $('#opt-difficulty');
  const segWaves = $('#opt-waves');
  const segObj = $('#opt-objective');
  const segFF = $('#opt-ff');
  const chatLog = $('#lobby-chat-log');
  const chatForm = $('#lobby-chat-form');
  const chatInput = $('#lobby-chat-input');
  const readyBtn = $('#btn-ready');
  const startBtn = $('#btn-start');
  const status = $('#lobby-status');
  const miniClasses = $('#lobby-classes');
  const miniColors = $('#lobby-colors');
  const botsRow = $('#roster-bots');
  const addBotBtn = $('#btn-add-bot');

  let session = null;
  let unsubChat = null;
  const rosterRows = new Map();
  const mapBtns = new Map();

  // ---- static controls ------------------------------------------------------------------

  function seg(container, options, onPick) {
    container.replaceChildren();
    for (const o of options) {
      const b = h('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { value: String(o.value) }, title: o.title || null }, o.label);
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        audio.ui('click');
        onPick(o.value);
      });
      container.appendChild(b);
    }
  }

  function setSeg(container, value, editable) {
    for (const b of container.children) {
      b.setAttribute('aria-checked', b.dataset.value === String(value) ? 'true' : 'false');
      b.setAttribute('aria-disabled', editable ? 'false' : 'true');
      b.tabIndex = editable ? 0 : -1;
    }
  }

  function change(partial) {
    if (!session || !session.isHost) return;
    session.setSettings(partial);
    Object.assign(prefs.lobby, partial);
    ctx.savePrefs();
  }

  seg(segDiff, DIFFICULTY_IDS.map((id) => ({ value: id, label: DIFFICULTIES[id].name, title: DIFF_HINT[id] })), (v) => change({ difficulty: v }));
  seg(segWaves, WAVE_OPTIONS.map((n) => ({ value: n, label: n === 0 ? 'Endless' : String(n) })), (v) => change({ waves: v }));
  seg(segObj, [{ value: true, label: 'On' }, { value: false, label: 'Off', title: 'No objective: just survive' }], (v) => change({ objective: v }));
  seg(segFF, [{ value: false, label: 'Off' }, { value: true, label: 'On', title: 'Bullets hurt teammates (25%)' }], (v) => change({ friendlyFire: v }));

  for (const m of deps.MAP_LIST) {
    const canvas = h('canvas.map-preview', { width: 320, height: 180, 'aria-hidden': 'true' });
    const btn = h('button.map-card', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { map: m.id } }, [
      h('div.map-preview-wrap', null, [canvas, h('span.map-check', { text: '✓', 'aria-hidden': 'true' })]),
      h('div.map-info', null, [h('span.map-name', { text: m.name }), h('span.map-desc', { text: m.description })]),
    ]);
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      audio.ui('click');
      change({ mapId: m.id });
    });
    mapCards.appendChild(btn);
    mapBtns.set(m.id, { btn, canvas, drawn: false });
  }

  function drawPreviews() {
    // One map per frame: building a map and painting it takes a few ms each.
    const pending = [...mapBtns.entries()].filter(([, v]) => !v.drawn);
    let i = 0;
    const step = () => {
      if (i >= pending.length) return;
      const [id, v] = pending[i++];
      try {
        let src = previewCache.get(id);
        if (!src) {
          src = document.createElement('canvas');
          src.width = v.canvas.width;
          src.height = v.canvas.height;
          deps.renderMapPreview(src, deps.buildMap(id, 1));
          previewCache.set(id, src);
        }
        v.canvas.getContext('2d').drawImage(src, 0, 0);
        v.drawn = true;
      } catch (err) {
        console.warn('[lobby] map preview failed', id, err);
        v.drawn = true;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  CLASS_IDS.forEach((id) => {
    const c = CLASSES[id];
    const canvas = h('canvas', { width: 64, height: 64, 'aria-hidden': 'true' });
    const b = h('button.mini-class', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': `${c.name}, ${c.role}`, title: `${c.name} — ${c.role}: ${c.desc}`, dataset: { cls: id } }, [
      canvas, h('span', { text: c.name }),
    ]);
    b.addEventListener('click', () => {
      audio.ui('click');
      prefs.cls = id;
      ctx.savePrefs();
      if (session) session.setProfile({ cls: id });
      renderMine();
    });
    miniClasses.appendChild(b);
  });
  PLAYER_COLORS.forEach((col, i) => {
    const b = h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': PLAYER_COLOR_NAMES[i], title: PLAYER_COLOR_NAMES[i],
      style: { '--sw': col }, dataset: { color: String(i) },
    });
    b.addEventListener('click', () => {
      audio.ui('click');
      prefs.color = i;
      ctx.savePrefs();
      if (session) session.setProfile({ color: i });
      renderMine();
    });
    miniColors.appendChild(b);
  });

  // ---- buttons ------------------------------------------------------------------------------

  async function copy(text, what) {
    if (!text) return;
    const ok = await copyText(text);
    audio.ui(ok ? 'click' : 'deny');
    flashToast(ok ? `${what} copied` : `Couldn't copy — select it and copy manually`, ok ? 'good' : 'bad');
  }
  codeBtn.addEventListener('click', () => session && copy(session.code, 'Room code'));
  $('#copy-code').addEventListener('click', () => session && copy(session.code, 'Room code'));
  $('#copy-link').addEventListener('click', () => session && copy(session.inviteUrl || session.code, 'Invite link'));
  $('#lobby-leave').addEventListener('click', () => ctx.onLeave());

  readyBtn.addEventListener('click', () => {
    if (!session) return;
    const me = myEntry();
    const next = !(me && me.ready);
    audio.ui(next ? 'ready' : 'click');
    session.setProfile({ ready: next });
  });

  startBtn.addEventListener('click', () => {
    if (!session || !session.isHost) return;
    const others = session.roster.filter((r) => !r.host);
    const notReady = others.filter((r) => !r.ready);
    const go = () => {
      if (!session.start()) ctx.onStartFailed();
    };
    if (notReady.length && session.transport !== 'local') {
      ctx.dialogs.confirm(
        'Start without everyone?',
        `${notReady.map((r) => r.name).join(', ')} ${notReady.length === 1 ? 'isn\'t' : 'aren\'t'} ready yet. Start anyway?`,
        'Start anyway',
        go,
      );
    } else {
      go();
    }
  });

  addBotBtn.addEventListener('click', () => {
    if (!session || !session.isHost || typeof session.addBot !== 'function') return;
    audio.ui(session.addBot() ? 'join' : 'deny');
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (session) sendFromInput(chatInput, session);
  });

  // ---- rendering -------------------------------------------------------------------------------

  function myEntry() {
    return session ? session.roster.find((r) => r.id === session.localId) : null;
  }

  function rosterMap() {
    return new Map((session ? session.roster : []).map((r) => [r.id, r]));
  }

  function addChat(msg) {
    chatLog.appendChild(chatLine(msg, rosterMap()));
    while (chatLog.children.length > 60) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderRoster() {
    const list = session.roster;
    const seen = new Set();
    for (const r of list) {
      seen.add(r.id);
      let row = rosterRows.get(r.id);
      if (!row) {
        const canvas = h('canvas.roster-portrait', { width: 96, height: 96, 'aria-hidden': 'true' });
        const name = h('span.roster-name');
        const cls = h('span.roster-class');
        const ready = h('span.roster-ready');
        const ping = h('span.roster-ping');
        const bot = h('span.roster-bot', { text: 'BOT', title: 'AI survivor' });
        const crown = h('span.roster-crown', { text: '♛', title: 'Host', 'aria-label': 'Host' });
        const you = h('span.roster-you', { text: 'YOU' });
        const kick = h('button.btn-icon.roster-kick', { type: 'button', title: 'Remove from room', 'aria-label': `Remove ${r.name}`, text: '✕' });
        kick.addEventListener('click', () => {
          if (!session) return;
          const target = session.roster.find((q) => q.id === r.id);
          if (target && target.bot) {
            if (typeof session.removeBot === 'function' && session.removeBot(r.id)) audio.ui('leave');
            return;
          }
          if (typeof session.kick !== 'function') return;
          ctx.dialogs.confirm('Remove player?', `Remove ${target ? target.name : 'this player'} from the room?`, 'Remove', () => session.kick(r.id));
        });
        const el = h('li.roster-row', null, [
          canvas,
          h('div.roster-main', null, [h('div.roster-top', null, [crown, name, you]), cls]),
          h('div.roster-side', null, [ready, ping, bot]),
          kick,
        ]);
        row = { el, canvas, name, cls, ready, ping, bot, crown, you, kick, key: '' };
        rosterRows.set(r.id, row);
      }
      const key = `${r.cls}:${r.color}`;
      if (row.key !== key) {
        row.key = key;
        try {
          deps.renderClassPortrait(row.canvas, r.cls, r.color);
        } catch (err) {
          console.warn('[lobby] portrait failed', err);
        }
      }
      const c = CLASSES[r.cls];
      setText(row.name, r.name);
      row.name.style.color = PLAYER_COLORS[r.color] || '#fff';
      row.el.style.setProperty('--pc', PLAYER_COLORS[r.color] || '#fff');
      setText(row.cls, c ? `${c.name} · ${c.role}` : r.cls);
      row.crown.hidden = !r.host;
      row.you.hidden = r.id !== session.localId;
      const solo = session.transport === 'local';
      row.ready.hidden = solo;
      setText(row.ready, r.host ? 'HOST' : r.ready ? 'READY' : 'NOT READY');
      row.ready.className = `roster-ready ${r.host ? 'host' : r.ready ? 'yes' : 'no'}`;
      row.ping.hidden = solo || r.host || !!r.bot;
      setText(row.ping, r.host ? '' : `${r.ping | 0} ms`);
      row.bot.hidden = !r.bot;
      row.el.classList.toggle('is-bot', !!r.bot);
      const removable = r.bot ? typeof session.removeBot === 'function' : typeof session.kick === 'function';
      row.kick.hidden = !(session.isHost && !r.host && removable);
      row.kick.title = r.bot ? 'Remove bot' : 'Remove from room';
      row.kick.setAttribute('aria-label', `Remove ${r.name}`);
      rosterEl.appendChild(row.el);
    }
    for (const [id, row] of rosterRows) {
      if (!seen.has(id)) {
        row.el.remove();
        rosterRows.delete(id);
      }
    }
    // empty slots, so the room size is obvious
    for (const e of [...rosterEl.querySelectorAll('.roster-empty')]) e.remove();
    const solo = session.transport === 'local';
    if (!solo) {
      for (let i = list.length; i < MAX_PLAYERS; i++) rosterEl.appendChild(h('li.roster-empty', { text: 'Open slot' }));
    }
    setText($('#roster-count'), solo && list.length < 2 ? '' : `${list.length} / ${MAX_PLAYERS}`);
    // Host: fill empty slots with AI survivors (solo too: that's the "AI squad" mode).
    const canBot = session.isHost && typeof session.addBot === 'function';
    botsRow.hidden = !canBot;
    addBotBtn.disabled = !canBot || list.length >= MAX_PLAYERS || !!session.inGame;
  }

  function renderMine() {
    const me = myEntry();
    const nameInput = $('#lobby-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = me ? me.name : prefs.name;
    const cls = me ? me.cls : prefs.cls;
    const color = me ? me.color : prefs.color;
    for (const b of miniClasses.children) {
      const on = b.dataset.cls === cls;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const canvas = b.querySelector('canvas');
      const key = `${b.dataset.cls}:${color}`;
      if (canvas._key !== key) {
        canvas._key = key;
        try {
          deps.renderClassPortrait(canvas, b.dataset.cls, color);
        } catch {
          // portraits are decorative
        }
      }
    }
    for (const b of miniColors.children) {
      b.setAttribute('aria-checked', Number(b.dataset.color) === color ? 'true' : 'false');
      // Colours other players already use are dimmed (the host keeps them distinct).
      const taken = session && session.roster.some((r) => r.id !== session.localId && r.color === Number(b.dataset.color));
      b.classList.toggle('taken', !!taken);
    }
  }

  function renderSettings() {
    const s = session.settings;
    const editable = session.isHost;
    for (const [id, v] of mapBtns) {
      v.btn.setAttribute('aria-checked', id === s.mapId ? 'true' : 'false');
      v.btn.setAttribute('aria-disabled', editable ? 'false' : 'true');
      v.btn.tabIndex = editable ? 0 : id === s.mapId ? 0 : -1;
    }
    setSeg(segDiff, s.difficulty, editable);
    setSeg(segWaves, s.waves, editable);
    setSeg(segObj, s.objective, editable);
    setSeg(segFF, s.friendlyFire, editable);
    setText($('#settings-owner'), editable ? 'You pick the mission' : 'The host picks the mission');
    screen.classList.toggle('readonly', !editable);
  }

  function renderFooter() {
    const solo = session.transport === 'local';
    const me = myEntry();
    readyBtn.hidden = solo || session.isHost;
    readyBtn.setAttribute('aria-pressed', me && me.ready ? 'true' : 'false');
    readyBtn.textContent = me && me.ready ? 'Ready ✓' : 'Ready up';
    startBtn.hidden = !session.isHost;
    const others = session.roster.filter((r) => !r.host);
    const readyN = others.filter((r) => r.ready).length;
    const allReady = readyN === others.length;
    const humans = others.filter((r) => !r.bot).length;
    startBtn.classList.toggle('btn-primary', allReady);
    startBtn.textContent = solo ? 'Start Game' : allReady ? 'Start Game' : 'Start Anyway';
    let text;
    if (solo) text = others.length ? 'Your AI squad is ready. Start when you are.' : 'Pick a battlefield and start when you are ready — or add bots for an AI squad.';
    else if (session.isHost && humans === 0) text = `Waiting for friends to join — share the invite link. You can also start ${others.length ? 'with your bots' : 'alone'}.`;
    else if (session.isHost) text = allReady ? 'Everyone is ready. Start the game!' : `${readyN} of ${others.length} ready`;
    else if (me && me.ready) text = 'You\'re ready. Waiting for the host to start…';
    else text = 'Press Ready when you\'re set. The host starts the game.';
    setText(status, text);
  }

  function renderRoom() {
    const solo = session.transport === 'local';
    $('#room-panel').hidden = solo;
    codeBtn.textContent = session.code || '-----';
    $('#copy-link').disabled = !session.inviteUrl && !session.code;
    setText($('#lobby-transport'), transportLabel(session));
    setText($('#lobby-title'), solo ? 'Solo Mission' : session.isHost ? 'Your Room' : 'Lobby');
    screen.classList.toggle('solo', solo);
  }

  function render() {
    if (!session) return;
    renderRoom();
    renderRoster();
    renderMine();
    renderSettings();
    renderFooter();
  }

  return {
    show(s) {
      session = s;
      screen.hidden = false;
      chatLog.replaceChildren();
      for (const m of ctx.history.items) addChat(m);
      if (unsubChat) unsubChat();
      unsubChat = ctx.history.subscribe((m) => {
        addChat(m);
        if (!m.system && session && m.pid !== session.localId) audio.ui('chat');
      });
      render();
      drawPreviews();
    },
    hide() {
      screen.hidden = true;
      if (unsubChat) unsubChat();
      unsubChat = null;
    },
    /** Forget the session (left the room). */
    reset() {
      this.hide();
      session = null;
      for (const row of rosterRows.values()) row.el.remove();
      rosterRows.clear();
      rosterEl.replaceChildren();
      chatLog.replaceChildren();
      chatInput.value = '';
    },
    render,
    get visible() {
      return !screen.hidden;
    },
  };
}
