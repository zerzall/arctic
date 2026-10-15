// The dialogue scene player: cinematic bars, portrait cards for whoever is talking (class
// portraits for the crew, a radio set for the Warden), a name plate, typewriter text.
// Click / Space / Enter / gamepad A moves on (first press completes the line), Esc or the Skip
// button ends the scene, L opens the log. Optional speech comes from ui/story-voice.js.

import { h } from './dom.js';
import { castOf } from '../shared/story/content.js';
import { drawCastPortrait } from './story-kit.js';
import { padNavigate } from './padnav.js';

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
  const menu = h('div.st-menu-topics', { hidden: true, role: 'menu', 'aria-label': 'Ask about' });
  const box = h('div.st-box', null, [
    h('div.st-plate', null, [plateName, plateRole]),
    text,
    live,
    menu,
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
  let menuOn = false;
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
    if (menuOn) hint.textContent = '1–9 · click · A — ask     Esc · B — leave     L — log';
    else if (opts && opts.menu) hint.textContent = 'Space · click · A — continue     Esc · B — leave     L — log';
    else hint.textContent = done ? 'Space · click · A — continue     Esc · B — skip' : 'Space · click · A — continue     Esc · B — skip     L — log';
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
    // a caption (the narrator) has no face: the cards step back and the text stands alone
    const caption = c.portrait === 'narrator';
    el.classList.toggle('is-caption', caption);
    if (caption) {
      cardA.el.classList.remove('active');
      cardB.el.classList.remove('active');
    } else {
      showCard(c.id);
    }
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
    if (menuOn) return;
    if (idx + 1 >= lines.length) {
      if (opts && opts.menu && showMenu()) return;
      finish(false);
      return;
    }
    idx++;
    if (idx === lines.length - 1) done = true;
    showLine();
  }

  /** The topic list after a greeting (or after a topic was heard). @returns {boolean} whether there is anything to ask */
  function showMenu() {
    const topics = opts && opts.menu ? opts.menu.topics() : [];
    if (!topics.length) return false;
    menuOn = true;
    el.classList.add('has-menu');
    menu.hidden = false;
    menu.replaceChildren(
      ...topics.map((tp, i) => h('button.btn.st-topic', {
        type: 'button', role: 'menuitem', dataset: { topic: tp.id },
        onclick: () => pickTopic(tp),
      }, [h('span.st-topic-n', { text: String(i + 1) }), h('span', { text: tp.prompt })])),
      h('button.btn.btn-ghost.st-topic.st-leave', { type: 'button', role: 'menuitem', dataset: { act: 'leave' }, onclick: () => finish(false) }, [h('span.st-topic-n', { text: 'Esc' }), h('span', { text: opts.menu.leave || 'Leave' })]),
    );
    done = true;
    setHint();
    return true;
  }

  function hideMenu() {
    menuOn = false;
    el.classList.remove('has-menu');
    menu.hidden = true;
    menu.replaceChildren();
  }

  function pickTopic(tp) {
    if (!open || !menuOn) return;
    hideMenu();
    audio.ui('click');
    logList.appendChild(h('div.st-log-line.st-you', null, [h('b', { text: 'You' }), h('span', { text: ` ${tp.prompt}` })]));
    const more = opts.menu.pick(tp) || [];
    if (!more.length) {
      if (!showMenu()) finish(false);
      return;
    }
    lines = more;
    idx = 0;
    done = false;
    showLine();
  }

  function finish(skipped) {
    if (!open) return;
    hideMenu();
    open = false;
    root.classList.remove('scene');
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
    if (menuOn && /^[1-9]$/.test(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const b = menu.querySelectorAll('.st-topic:not(.st-leave)')[Number(k) - 1];
      if (b) b.click();
    } else if (menuOn && (k === ' ' || k === 'Enter')) {
      // a topic is asked only by choosing it (a number, a click, or arrows + Enter): advancing keys never pick one
      e.stopImmediatePropagation();
      if (!menu.contains(document.activeElement)) e.preventDefault();
    } else if (menuOn && (k === 'ArrowDown' || k === 'ArrowUp')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      padNavigate(menu, k === 'ArrowDown' ? { down: true } : { up: true });
    } else if (k === ' ' || k === 'Enter' || k === 'ArrowRight') {
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
     * @param {{ title?: string, onDone?: (skipped: boolean) => void,
     *   menu?: { topics: () => { id: string, prompt: string }[], pick: (topic: object) => object[], leave?: string } }} [o]
     *   `menu`: after the lines a list of topics to ask about; picking one plays the lines `pick` returns.
     */
    play(sceneLines, o = {}) {
      const list = (Array.isArray(sceneLines) ? sceneLines : []).filter((l) => l && typeof l.text === 'string' && l.text);
      if (!list.length) {
        if (o.onDone) o.onDone(false);
        return false;
      }
      if (open) finish(true);
      hideMenu();
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
      root.classList.add('scene');
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
      if (menuOn) {
        if (n.back) this.escape();
        else if (n.tabPrev) toggleLog();
        else if (n.accept && !menu.contains(document.activeElement)) padNavigate(menu, { down: true });
        else padNavigate(menu, n);
      } else if (n.accept) advance();
      else if (n.back) this.escape();
      else if (n.tabPrev) toggleLog();
    },
    destroy() {
      finish(true);
      el.remove();
    },
  };
}
