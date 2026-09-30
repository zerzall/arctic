// Road to Haven HUD (STORY.md §5, SPEC §7.3): the objective tracker under the compass (the
// current step's text with its count, bar or timer; optional side steps; a check that lingers
// when one is done), escort / helper NPC health chips, the radio subtitle strip (speaker,
// line, queue), the interact prompt with its hold ring (spots and "E — Talk"), and the
// banners / toasts for items, NPCs, waves and the end of the mission.
//
// It gives hud.js the prompt of what you stand next to and swallows the classic wave texts
// while a mission runs. The markers on the compass and radar are drawn by compass.js /
// minimap.js (storymarks.js). DOM writes only on change.

import { interactLabel, TALK_RANGE, CAST, itemInfo } from '../shared/story-defs.js';
import { PLAYER_RADIUS, REVIVE_RADIUS } from '../shared/constants.js';
import { INTERACT_REACH } from '../shared/story-defs.js';
import { h, setText, setShown, setClass, setStyle } from './dom.js';
import { markColor } from './storymarks.js';

const RADIO_MIN = 1400;
const DONE_LINGER = 2.2;
const MAX_ROWS = 4;
const MAX_CHIPS = 3;
/** Speaker colours: the cast's portrait accent (story-defs CAST), anyone else gets one from their name. */
const FALLBACK_COLORS = ['#8ecbff', '#ffd27f', '#b6f59c', '#f0a0ff', '#ffab91', '#80e0d8'];

function clock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function speakerName(who) {
  const c = CAST[who];
  if (c) return c.name;
  const w = String(who || '');
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

function speakerColor(who) {
  const k = String(who || '').toLowerCase();
  if (CAST[k] && CAST[k].color) return CAST[k].color;
  let hsh = 0;
  for (let i = 0; i < k.length; i++) hsh = (hsh * 31 + k.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hsh % FALLBACK_COLORS.length];
}

/**
 * @param {HTMLElement} parent the HUD's top-centre column (after the compass)
 * @param {HTMLElement} root the HUD root (the radio strip sits in it)
 * @param {object} opts { map, audio, showBanner(title, sub, tone, dur), toast(text, tone, dur), nameOf(pid),
 *   promptEl (the prompt box: the hold ring goes in it), title (the mission's title, optional) }
 */
export function createStoryHud(parent, root, { map, showBanner, toast, nameOf, promptEl, title = '' }) {
  const kicker = h('div.story-kicker', null, [h('span.story-kick-l', { text: title ? `MISSION · ${title.toUpperCase()}` : 'OBJECTIVE' }), h('span.story-clock')]);
  const list = h('div.story-list');
  const panel = h('div.hud-story.hud-box', { hidden: true, role: 'status' }, [kicker, list]);
  const chips = h('div.story-npcs');
  const radioName = h('span.radio-name');
  const radioText = h('span.radio-text');
  const radioIcon = h('i.radio-icon', { 'aria-hidden': 'true' });
  const radio = h('div.hud-radio', { hidden: true, role: 'status', 'aria-live': 'polite' }, [radioIcon, h('div.radio-body', null, [radioName, radioText])]);
  const ringKey = h('b.ring-key');
  const ring = h('span.story-ring', { hidden: true, 'aria-hidden': 'true' }, [h('i.ring-arc'), ringKey]);
  const compass = parent.querySelector('.hud-compass');
  parent.insertBefore(panel, compass ? compass.nextSibling : parent.firstChild);
  parent.insertBefore(chips, panel.nextSibling);
  root.append(radio);
  if (promptEl) promptEl.prepend(ring);

  /** DOM rows by step index. */
  const rows = new Map();
  /** Steps that just finished: { text, t } shown as a check for a moment. */
  const finished = [];
  const radioQ = [];
  let radioT = 0;
  let radioLine = null;
  let time = 0;
  const chipEls = new Map();

  function makeRow() {
    const mark = h('i.story-mark');
    const text = h('span.story-text');
    const count = h('span.story-count');
    const tag = h('span.story-tag', { text: 'OPTIONAL' });
    const fill = h('i');
    const bar = h('div.story-bar', null, fill);
    const tt = h('span.story-t');
    const tfill = h('i');
    const tbar = h('div.story-tbar', null, tfill);
    const clockRow = h('div.story-time', null, [tt, tbar]);
    const el = h('div.story-row', null, [h('div.story-line', null, [mark, text, tag, count]), bar, clockRow]);
    return { el, mark, text, count, tag, bar, fill, tt, tfill, clockRow, cur: -1 };
  }

  function syncRow(r, s) {
    setText(r.text, s.text);
    setClass(r.el, 'opt', s.opt);
    setShown(r.tag, s.opt);
    const timed = s.total > 0;
    const counted = s.max > 1 && s.max <= 100 && !timed;
    setText(r.count, counted ? `${s.cur} / ${s.max}` : s.max === 100 && s.kind === 'escort' ? `${s.cur}%` : '');
    setShown(r.bar, counted || (s.max > 1 && s.kind === 'escort'));
    if (counted || s.kind === 'escort') setStyle(r.fill, 'width', `${Math.max(0, Math.min(100, (s.cur / Math.max(1, s.max)) * 100)).toFixed(1)}%`);
    setShown(r.clockRow, timed);
    if (timed) {
      setText(r.tt, clock(s.t));
      setStyle(r.tfill, 'width', `${Math.max(0, Math.min(100, (s.t / s.total) * 100)).toFixed(1)}%`);
      setClass(r.el, 'urgent', s.t <= 10 && s.t > 0);
    } else {
      setClass(r.el, 'urgent', false);
    }
    if (s.cur !== r.cur) {
      if (r.cur >= 0) {
        r.el.classList.remove('bump');
        void r.el.offsetWidth;
        r.el.classList.add('bump');
      }
      r.cur = s.cur;
    }
  }

  function npcName(view, key) {
    for (const n of (view && view.npcs) || []) if (n.key === key) return n.name;
    return (CAST[key] && CAST[key].name) || key;
  }

  // ---- per frame ------------------------------------------------------------------------

  function update(view, me, pos, dt) {
    time += dt;
    const st = view && view.story;
    const over = !view || view.phase === 'gameover' || view.phase === 'victory';
    const mission = !!st && st.mode === 'mission' && !over;
    // finished-step checks age out
    for (let i = finished.length - 1; i >= 0; i--) {
      finished[i].t -= dt;
      if (finished[i].t <= 0) finished.splice(i, 1);
    }
    if (mission) {
      const steps = st.steps.slice(0, MAX_ROWS);
      const seen = new Set();
      let order = 0;
      // finished steps first (a check), then the live ones
      for (let i = 0; i < finished.length; i++) {
        const f = finished[i];
        let r = rows.get('done' + f.key);
        if (!r) {
          r = makeRow();
          r.el.classList.add('done');
          setText(r.text, f.text);
          setShown(r.bar, false);
          setShown(r.clockRow, false);
          setShown(r.tag, false);
          setText(r.count, '');
          rows.set('done' + f.key, r);
        }
        seen.add('done' + f.key);
        r.el.style.order = String(order++);
        if (!r.el.isConnected) list.appendChild(r.el);
      }
      for (const s of steps) {
        let r = rows.get(s.i);
        if (!r) {
          r = makeRow();
          rows.set(s.i, r);
        }
        syncRow(r, s);
        seen.add(s.i);
        r.el.style.order = String(order++);
        if (!r.el.isConnected) list.appendChild(r.el);
      }
      for (const [k, r] of rows) {
        if (!seen.has(k)) {
          r.el.remove();
          rows.delete(k);
        }
      }
      setShown(panel, steps.length > 0 || finished.length > 0);
      setText(kicker.lastChild, clock(st.time));
    } else {
      setShown(panel, false);
    }
    updateChips(view, mission);
    pumpRadio(dt, over);
  }

  function updateChips(view, mission) {
    const want = [];
    if (mission) {
      for (const n of view.npcs || []) {
        if (n.hp < 0) continue;
        if (n.state === 'escort' || n.state === 'follow' || n.state === 'down' || (n.state === 'idle' && n.hp < 0.999) || (n.state === 'talk' && n.hp < 0.999)) want.push(n);
      }
    }
    const seen = new Set();
    for (const n of want.slice(0, MAX_CHIPS)) {
      let c = chipEls.get(n.id);
      if (!c) {
        const name = h('span.npc-name');
        const state = h('span.npc-state');
        const fill = h('i');
        const el = h('div.story-npc', null, [h('div.npc-head', null, [name, state]), h('div.npc-bar', null, fill)]);
        c = { el, name, state, fill };
        chipEls.set(n.id, c);
        chips.appendChild(el);
      }
      seen.add(n.id);
      setText(c.name, n.name);
      setText(c.state, n.state === 'down' ? 'DOWN: HOLD E TO REVIVE' : n.state === 'follow' ? 'HELPING' : '');
      setStyle(c.fill, 'width', `${Math.max(0, Math.min(100, n.hp * 100)).toFixed(1)}%`);
      setClass(c.el, 'down', n.state === 'down');
      setClass(c.el, 'low', n.state !== 'down' && n.hp < 0.3);
    }
    for (const [id, c] of chipEls) {
      if (!seen.has(id)) {
        c.el.remove();
        chipEls.delete(id);
      }
    }
  }

  function pumpRadio(dt, over) {
    if (radioLine) {
      radioT -= dt;
      if (radioT <= 0) radioLine = null;
    }
    if (!radioLine && radioQ.length) {
      radioLine = radioQ.shift();
      // a long queue is read faster so it never falls behind the action
      radioT = Math.max(RADIO_MIN, radioLine.ms * (radioQ.length > 2 ? 0.6 : 1)) / 1000;
      setText(radioName, speakerName(radioLine.who));
      setStyle(radioName, 'color', speakerColor(radioLine.who));
      setText(radioText, radioLine.text);
      setClass(radio, 'radio', radioLine.kind === 'radio');
      radio.classList.remove('in');
      void radio.offsetWidth;
      radio.classList.add('in');
    }
    setShown(radio, !!radioLine && !over);
  }

  // ---- the prompt -------------------------------------------------------------------------

  /**
   * What you stand next to: { text, prog } (prog 0..1 for a hold, null for a tap), or null.
   * A downed teammate to revive takes precedence (hud.js checks that first).
   */
  function prompt(view, me, pos, keys, localId) {
    setShown(ring, false);
    if (!view || !me || me.state !== 'alive' || !pos) return null;
    // a downed NPC to revive
    let best = null, bd = Infinity, kind = '';
    for (const n of view.npcs || []) {
      const d = Math.hypot(n.x - pos.x, n.y - pos.y);
      if (n.state === 'down') {
        if (d <= REVIVE_RADIUS && d < bd) {
          bd = d;
          best = n;
          kind = 'revive';
        }
      } else if (d <= TALK_RANGE && d < bd) {
        bd = d;
        best = n;
        kind = 'talk';
      }
    }
    let it = null, id = Infinity;
    for (const q of view.interactables || []) {
      if (!q.on) continue;
      const d = Math.hypot(q.x - pos.x, q.y - pos.y);
      if (d <= q.r + PLAYER_RADIUS + INTERACT_REACH * 0.4 && d < id) {
        id = d;
        it = q;
      }
    }
    if (best && (!it || bd <= id)) {
      if (kind === 'revive') return { text: `Hold ${keys.interact} to revive ${best.name}`, prog: null };
      return { text: `Press ${keys.interact} to talk to ${best.name}`, prog: null };
    }
    if (it) {
      const stat = map.interactables && map.interactables[it.id - 1];
      // a mission's device reads like the objective that asks for it ("Cut the horn wire under the bus dash")
      let named = stat && stat.label;
      if (!named && view.story) {
        const row = view.story.steps.find((r) => r.kind === 'activate' && !r.opt) || view.story.steps.find((r) => r.kind === 'activate');
        if (row && row.text) named = row.text.replace(/\s*\(hold [^)]*\)\s*$/i, '').replace(/[.:]+$/, '').trim();
      }
      const label = interactLabel({ label: named, kind: it.kind });
      if (it.hold) {
        const mine = it.prog > 0 && it.user === localId;
        const other = it.prog > 0 && it.user && it.user !== localId;
        const text = other ? `${nameOf(it.user)} is on it: hold ${keys.interact} to help` : `Hold ${keys.interact}: ${label}`;
        setShown(ring, true);
        setText(ringKey, keys.interact);
        setStyle(ring, '--p', `${Math.round(it.prog * 100)}%`);
        setClass(ring, 'full', it.prog >= 0.98);
        return { text, prog: it.prog > 0 || mine ? it.prog : 0, ring: true };
      }
      return { text: `Press ${keys.interact}: ${label}`, prog: null };
    }
    return null;
  }

  // ---- events -----------------------------------------------------------------------------

  /** Story events → banners, toasts, the radio strip. Returns true when the event is fully handled. */
  function addEvent(e, view, localId) {
    const st = view && view.story;
    switch (e.type) {
      case 'objective':
        if (e.what === 'done' && e.text) {
          finished.push({ text: e.text, t: DONE_LINGER, key: `${e.step}:${e.id}:${time.toFixed(2)}` });
          toast(`Objective complete: ${e.text}`, 'good', 3);
        } else if (e.what === 'fail' && e.text) {
          toast(`Objective failed: ${e.text}`, 'danger', 4);
        } else if (e.what === 'start' && e.text && time > 3) {
          toast(e.text, 'minor', 3);
        }
        return true;
      case 'radio':
        radioQ.push({ who: e.who, text: e.text, ms: e.ms || 3000, kind: e.kind });
        if (radioQ.length > 6) radioQ.shift();
        return true;
      case 'item': {
        const info = itemInfo(e.item);
        const count = e.of > 0 ? ` (${e.n}/${e.of})` : '';
        if (e.pid === localId) toast(`+ ${info.name}${count}`, 'good', 2.2);
        else toast(`${nameOf(e.pid)} found ${info.name.toLowerCase()}${count}`, 'minor', 2);
        return true;
      }
      case 'npc': {
        const nm = npcName(view, e.npc);
        if (e.what === 'down') toast(`${nm} is down! Hold ${'E'} next to them to revive`, 'danger', 4);
        else if (e.what === 'up') toast(`${nm} is back on their feet`, 'good', 3);
        else if (e.what === 'dead') toast(`${nm} is gone`, 'danger', 4);
        else if (e.what === 'arrive') toast(`${nm} made it`, 'good', 3);
        return true;
      }
      case 'talk':
      case 'interact':
        return true;
      case 'wave': {
        // a mission's wave banner counts the step's waves, not the difficulty tier
        const s = st && st.steps.find((q) => q.kind === 'waves' || q.kind === 'defend');
        if (s && s.max > 0) showBanner(`WAVE ${Math.min(s.max, s.cur + 1)} OF ${s.max}`, e.boss ? 'Something big is coming' : 'Here they come', e.boss ? 'danger' : '', 2.6);
        return !!st;
      }
      case 'waveclear':
        if (!st) return false;
        showBanner('WAVE CLEARED', `+$${e.bonus || 0} · supplies dropped`, 'good', 2.6);
        return true;
      case 'drop':
        if (!st) return false;
        toast('Supplies dropped nearby', 'minor', 3);
        return true;
      case 'victory':
      case 'gameover':
        return !!st && st.mode === 'mission';
      case 'storyend': {
        const stars = '★'.repeat(e.stars || 0) + '☆'.repeat(Math.max(0, 3 - (e.stars || 0)));
        if (e.result === 'victory') showBanner('MISSION COMPLETE', stars, 'good', 5);
        else {
          const why = { wiped: 'The whole team fell', objective: 'The objective was lost', npc: 'They did not make it', timeout: 'Out of time', failed: 'The objective failed' };
          showBanner('MISSION FAILED', why[e.reason] || 'The team fell', 'danger', 5);
        }
        return true;
      }
      default: return false;
    }
  }

  /** Hide the hold ring (the prompt shows something else this frame). */
  function resetRing() {
    setShown(ring, false);
  }

  function destroy() {
    panel.remove();
    chips.remove();
    radio.remove();
    ring.remove();
  }

  return { update, addEvent, prompt, resetRing, destroy, colorOf: markColor };
}
