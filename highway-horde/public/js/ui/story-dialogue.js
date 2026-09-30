// The dialogue scene player: cinematic bars, portrait cards for whoever is talking (class
// portraits for the crew, a radio set for the Warden), a name plate, typewriter text.
// Click / Space / Enter / gamepad A moves on (first press completes the line), Esc or the Skip
// button ends the scene, L opens the log. Optional speech comes from ui/story-voice.js.

import { h } from './dom.js';
import { castOf } from '../shared/story/content.js';
import { drawCastPortrait } from './story-kit.js';

/** Typewriter speed (characters per second). */
const CPS = 62;

function reducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * @param {{ root: HTMLElement, audio: object, voice: object, deps: object }} opts
 */
export function createDialogue({ root, audio, voice, deps }) {
  const cardA = makeCard();
  const cardB = makeCard();
  const cards = h('div.st-cards', null, [cardA.el, cardB.el]);
  const plateName = h('span.st-name');
  const plateRole = h('span.st-role');
  const text = h('p.st-text');
  const live = h('span.st-sr', { 'aria-live': 'polite' });
  const hint = h('div.st-hint');
  const next = h('span.st-next', { text: '▶', 'aria-hidden': 'true' });
  const box = h('div.st-box', null, [
    h('div.st-plate', null, [plateName, plateRole]),
    text,
    live,
    h('div.st-box-foot', null, [hint, next]),
  ]);
  const title = h('div.st-scene-title');
  const skipBtn = h('button.btn.btn-small.btn-ghost.st-skip', { type: 'button', text: 'Skip' });
  const logBtn = h('button.btn.btn-small.btn-ghost.st-logbtn', { type: 'button', text: 'Log' });
  const logList = h('div.st-log-list');
  const logPanel = h('div.st-log', { hidden: true, role: 'log' }, [h('div.st-log-head', { text: 'Conversation log' }), logList]);
  const el = h('div.st-dialogue', { hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Story scene' }, [
    h('div.st-bar.top', null, [title, h('div.st-bar-btns', null, [logBtn, skipBtn])]),
    h('div.st-stage', null, [cards, box]),
    h('div.st-bar.bottom'),
    logPanel,
  ]);
  root.appendChild(el);

  function makeCard() {
    const canvas = h('canvas.st-portrait', { width: 240, height: 240, 'aria-hidden': 'true' });
    const label = h('span.st-card-name');
    const wrap = h('div.st-card', { hidden: true }, [canvas, label]);
    return { el: wrap, canvas, label, who: null };
  }

  let lines = [];
  let idx = -1;
  let opts = null;
  let open = false;
  let typed = 0;
  let full = '';
  let raf = 0;
  let last = 0;
  let done = false;
  const seen = [];

  function showCard(who) {
    let card = cardA.who === who ? cardA : cardB.who === who ? cardB : null;
    if (!card) {
      // a new speaker takes the free card, else the one that spoke longest ago
      card = !cardA.who ? cardA : !cardB.who ? cardB : (seen.lastIndexOf(cardA.who) < seen.lastIndexOf(cardB.who) ? cardA : cardB);
      card.who = who;
      const c = drawCastPortrait(card.canvas, who, deps);
      card.label.textContent = c.name;
      card.label.style.color = c.color;
      card.el.style.setProperty('--cc', c.color);
      card.el.hidden = false;
    }
    const other = card === cardA ? cardB : cardA;
    card.el.classList.add('active');
    other.el.classList.remove('active');
    card.el.dataset.side = card === cardA ? 'left' : 'right';
    other.el.dataset.side = other === cardA ? 'left' : 'right';
    seen.push(who);
  }

  function setHint() {
    hint.textContent = done ? 'Space · click · A — continue     Esc · B — skip' : 'Space · click · A — continue     Esc · B — skip     L — log';
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!open) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (typed < full.length) {
      typed = Math.min(full.length, typed + dt * CPS);
      text.textContent = full.slice(0, Math.floor(typed));
      if (typed >= full.length) el.classList.add('line-done');
    }
  }

  function showLine() {
    const line = lines[idx];
    const c = castOf(line.who);
    full = String(line.text || '');
    typed = reducedMotion() ? full.length : 0;
    text.textContent = full.slice(0, Math.floor(typed));
    live.textContent = full;
    plateName.textContent = c.name;
    plateName.style.color = c.color;
    plateRole.textContent = c.role;
    box.style.setProperty('--cc', c.color);
    el.classList.toggle('is-radio', c.portrait === 'radio');
    el.classList.toggle('line-done', typed >= full.length);
    showCard(c.id);
    logList.appendChild(h('div.st-log-line', null, [h('b', { text: c.name, style: { color: c.color } }), h('span', { text: ` ${full}` })]));
    logList.scrollTop = logList.scrollHeight;
    voice.speak(full, c.id);
    audio.ui('hover');
    setHint();
  }

  function advance() {
    if (!open) return;
    if (typed < full.length) {
      typed = full.length;
      text.textContent = full;
      el.classList.add('line-done');
      return;
    }
    if (idx + 1 >= lines.length) {
      finish(false);
      return;
    }
    idx++;
    if (idx === lines.length - 1) done = true;
    showLine();
  }

  function finish(skipped) {
    if (!open) return;
    open = false;
    cancelAnimationFrame(raf);
    voice.cancel();
    el.hidden = true;
    logPanel.hidden = true;
    const cb = opts && opts.onDone;
    opts = null;
    if (cb) cb(skipped);
  }

  function toggleLog() {
    logPanel.hidden = !logPanel.hidden;
  }

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    const k = e.key;
    if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!logPanel.hidden) logPanel.hidden = true;
      else advance();
    } else if (k === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!logPanel.hidden) logPanel.hidden = true;
      else finish(true);
    } else if (k === 'l' || k === 'L') {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleLog();
    }
  }, true);
  el.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.st-log')) return;
    if (!logPanel.hidden) logPanel.hidden = true;
    else advance();
  });
  skipBtn.addEventListener('click', () => finish(true));
  logBtn.addEventListener('click', toggleLog);

  return {
    /**
     * Play a scene.
     * @param {{ who: string, text: string }[]} sceneLines
     * @param {{ title?: string, onDone?: (skipped: boolean) => void }} [o]
     */
    play(sceneLines, o = {}) {
      const list = (Array.isArray(sceneLines) ? sceneLines : []).filter((l) => l && typeof l.text === 'string' && l.text);
      if (!list.length) {
        if (o.onDone) o.onDone(false);
        return false;
      }
      if (open) finish(true);
      lines = list;
      idx = 0;
      opts = o;
      done = list.length === 1;
      seen.length = 0;
      cardA.who = cardB.who = null;
      cardA.el.hidden = cardB.el.hidden = true;
      logList.replaceChildren();
      logPanel.hidden = true;
      title.textContent = o.title || '';
      open = true;
      el.hidden = false;
      last = 0;
      raf = requestAnimationFrame(tick);
      showLine();
      requestAnimationFrame(() => skipBtn.focus({ preventScroll: true }));
      return true;
    },
    get isOpen() {
      return open;
    },
    /** Esc from the host UI: the scene ends. */
    escape() {
      if (!open) return false;
      if (!logPanel.hidden) logPanel.hidden = true;
      else finish(true);
      return true;
    },
    /** Gamepad edges: A continues, B skips, LB opens the log. */
    nav(n) {
      if (!open || !n) return;
      if (n.accept) advance();
      else if (n.back) this.escape();
      else if (n.tabPrev) toggleLog();
    },
    destroy() {
      finish(true);
      el.remove();
    },
  };
}
