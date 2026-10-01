// Chat: a shared message log (the lobby and the match render the same history) and the
// in-game chat box — Enter to type, Enter to send, Esc to cancel. While the box is open
// the game input is disabled so typing "wasd" doesn't walk the player around.

import { PLAYER_COLORS, CHAT_MAX_LENGTH } from '../shared/constants.js';
import { h } from './dom.js';

const HISTORY = 60;
const FADE_AFTER = 9000;

/**
 * Build one chat line element.
 * @param {{pid: number, name: string, text: string, system: boolean}} msg
 * @param {Map<number, object>|null} rosterById for name colours
 */
export function chatLine(msg, rosterById) {
  if (msg.system) return h('div.chat-line.system', { text: msg.text });
  const r = rosterById && rosterById.get(msg.pid);
  const color = r ? PLAYER_COLORS[r.color] : '#cfd8dc';
  return h('div.chat-line', null, [
    h('span.chat-name', { style: { color }, text: msg.name || (r ? r.name : '?') }),
    h('span.chat-sep', { text: ': ' }),
    h('span.chat-text', { text: msg.text }),
  ]);
}

/** Session-wide chat history shared by the lobby and the match. */
export function createChatHistory() {
  const items = [];
  const subs = new Set();
  return {
    items,
    push(msg) {
      const m = { pid: msg.pid | 0, name: String(msg.name || ''), text: String(msg.text || ''), system: !!msg.system, at: Date.now() };
      items.push(m);
      if (items.length > HISTORY) items.shift();
      for (const fn of subs) fn(m);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    clear() {
      items.length = 0;
    },
  };
}

/**
 * Wire an <input> to send chat through the session on Enter.
 * @returns {Function} send the current value
 */
export function sendFromInput(input, session) {
  const text = input.value.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
  input.value = '';
  if (text) session.sendChat(text);
  return text;
}

/**
 * In-game chat box.
 * @param {HTMLElement} root HUD container
 * @param {object} opts
 * @param {object} opts.session
 * @param {object} opts.history createChatHistory()
 * @param {Function} opts.getRosterById () => Map
 * @param {Function} opts.onOpenChange (open: boolean) => void
 * @param {object} opts.audio
 */
export function createGameChat(root, { session, history, getRosterById, onOpenChange, audio }) {
  const log = h('div.chat-log', { role: 'log', 'aria-live': 'polite' });
  const input = h('input.chat-input', {
    type: 'text', maxlength: CHAT_MAX_LENGTH, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'Say something… (Enter to send, Esc to cancel)', 'aria-label': 'Chat message', enterkeyhint: 'send',
  });
  const form = h('form.chat-form', { hidden: true }, input);
  const el = h('div.hud-chat', null, [log, form]);
  root.appendChild(el);
  let open = false;
  const timers = new Set();
  const listeners = [];
  function on(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    listeners.push(() => target.removeEventListener(type, fn, o));
  }

  function add(msg, animate) {
    const line = chatLine(msg, getRosterById());
    log.appendChild(line);
    while (log.children.length > 40) log.firstChild.remove();
    const age = Date.now() - (msg.at || Date.now());
    const left = FADE_AFTER - age;
    if (left <= 0 && !animate) {
      line.classList.add('faded');
    } else {
      const t = setTimeout(() => {
        timers.delete(t);
        line.classList.add('faded');
      }, Math.max(0, left));
      timers.add(t);
    }
    log.scrollTop = log.scrollHeight;
  }

  // Recent lobby messages carry over into the match.
  for (const m of history.items.slice(-8)) add(m, false);
  const unsub = history.subscribe((m) => {
    add(m, true);
    if (!m.system && m.pid !== session.localId) audio.ui('chat');
  });

  function setOpen(b) {
    if (open === b) return;
    open = b;
    form.hidden = !b;
    el.classList.toggle('open', b);
    if (b) {
      input.value = '';
      // Focus on the next frame so the Enter that opened the box doesn't also submit it.
      requestAnimationFrame(() => {
        if (open) input.focus({ preventScroll: true });
      });
      log.scrollTop = log.scrollHeight;
    } else if (document.activeElement === input) {
      input.blur();
    }
    onOpenChange(b);
  }

  on(form, 'submit', (e) => {
    e.preventDefault();
    sendFromInput(input, session);
    setOpen(false);
  });
  on(input, 'keydown', (e) => {
    // Keep keys typed into the box from reaching the game (and the shop's shortcuts).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  });
  on(input, 'blur', () => {
    // Clicking back into the game closes the box (keeps what you typed? no: it's a quick chat).
    setTimeout(() => {
      if (open && document.activeElement !== input) setOpen(false);
    }, 0);
  });

  return {
    el,
    get isOpen() {
      return open;
    },
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    destroy() {
      unsub();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const off of listeners) off();
      listeners.length = 0;
      el.remove();
    },
  };
}
