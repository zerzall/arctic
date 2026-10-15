// Horde Elimination HUD (SPEC §3.12 / §7.3): the surge panel under the compass — which surge,
// where it comes from, how long until the next one, how much of the horde is dead — and the
// mode's own words on the wave panel (zombies left of the horde, survivors standing), the
// banners and the toasts (a surge announced / let loose, a death that is final, the end).
// DOM writes only on change.

import { HS_PREP, HS_BREATHER, HS_SURGE, HS_OVER, hordeLanes, laneNames, formatClock } from '../shared/horde.js';
import { h, setText, setShown, setClass, setStyle } from './dom.js';

/**
 * @param {HTMLElement} parent where the panel goes (the HUD's top-centre column)
 * @param {object} opts { map, showBanner(title, sub, tone, dur), toast(text, tone, dur), nameOf(pid) }
 */
export function createHordeHud(parent, { map, showBanner, toast, nameOf }) {
  const title = h('div.horde-title');
  const sub = h('div.horde-sub');
  const fill = h('i');
  const bar = h('div.horde-bar', null, fill);
  const panel = h('div.hud-horde', { hidden: true, role: 'status' }, [title, sub, bar]);
  // right under the compass (first person) / at the top (top-down)
  parent.insertBefore(panel, parent.querySelector('.hud-compass') ? parent.children[1] || null : parent.firstChild);
  const lanes = hordeLanes(map);
  /** Whether the announced / current surge brings a boss (from its events; the block does not carry it). */
  let boss = false;

  /** "South Gate · Well Gate", or "every side" when they all open. */
  function from(mask) {
    const names = laneNames(map, mask);
    if (!names.length) return 'the edge of the map';
    return names.length >= lanes.length && lanes.length > 2 ? 'every side' : names.join(' · ');
  }

  /** Survivors standing (alive or downed) and in the game. */
  function standing(view) {
    let n = 0;
    for (const p of view.players) if (p.state !== 'dead') n++;
    return n;
  }

  /**
   * @param {object|null} view snapshot
   */
  function update(view) {
    const H = view && view.horde;
    const over = !H || H.stage === HS_OVER || view.phase === 'gameover' || view.phase === 'victory';
    setShown(panel, !over);
    if (over) return;
    const killed = Math.max(0, H.total - H.left);
    setStyle(fill, 'width', `${H.total > 0 ? Math.min(100, (killed / H.total) * 100).toFixed(1) : 0}%`);
    const last = H.surge >= H.surges && H.stage !== HS_BREATHER;
    setClass(panel, 'last', last);
    setClass(panel, 'boss', boss && H.stage !== HS_PREP);
    if (H.stage === HS_PREP) {
      setText(title, `THE HORDE · ${H.total}`);
      setText(sub, `${H.surges} surges, no respawns — buy now, then hold together`);
      setClass(panel, 'urgent', false);
    } else if (H.stage === HS_BREATHER) {
      const n = H.surge + 1;
      const secs = Math.max(0, Math.ceil(H.next));
      setText(title, `SURGE ${n} / ${H.surges} IN ${secs}s`);
      setText(sub, `${boss ? 'Boss · ' : ''}From ${from(H.lanes)}`);
      setClass(panel, 'urgent', secs <= 3);
    } else {
      setText(title, last ? 'LAST SURGE' : `SURGE ${H.surge} / ${H.surges}`);
      setText(sub, H.stage === HS_SURGE
        ? `From ${from(H.lanes)} · ${H.alive} on the streets`
        : `${H.alive} on the streets · ${formatClock(H.time)}`);
      setClass(panel, 'urgent', false);
    }
  }

  /**
   * The wave panel in this mode: the horde's count instead of the wave.
   * @returns {{label: string, num: string, total: string, left: string}|null}
   */
  function wavePanel(view) {
    const H = view && view.horde;
    if (!H) return null;
    const up = standing(view), all = view.players.length;
    return {
      label: 'HORDE',
      num: String(H.left),
      total: `/ ${H.total}`,
      left: `${up} of ${all} standing${H.stage !== HS_PREP ? ` · ${formatClock(H.time)}` : ''}`,
    };
  }

  /**
   * Turn the mode's events into banners and toasts.
   * @returns {boolean} true when the event is handled (the HUD skips its own text for it)
   */
  function addEvent(e, view, localId) {
    const H = view && view.horde;
    switch (e.type) {
      case 'surge':
        boss = !!e.boss;
        if (e.what === 'next') {
          if (e.n === 1) showBanner('THE HORDE IS COMING', `${H ? H.total : ''} zombies · the first surge from ${from(e.lanes)}`.trim(), 'danger', 3.4);
          else toast(`Surge ${e.n} in ${e.time}s — from ${from(e.lanes)}${e.boss ? ' · BOSS' : ''}`, e.boss ? 'danger' : '', 4);
        } else {
          const total = H ? H.surges : 0;
          const final = total && e.n >= total;
          showBanner(final ? 'LAST SURGE' : `SURGE ${e.n}`, e.boss ? 'Something big is with them…' : `From ${from(e.lanes)}`, e.boss || final ? 'danger' : '', 2.8);
        }
        return true;
      case 'died':
        if (e.pid === localId) toast('You died — no respawns: watch the others finish it', 'danger', 4.5);
        else toast(`${nameOf(e.pid)} died — out for the round`, 'danger', 3.5);
        return true;
      case 'victory':
        showBanner('HORDE ELIMINATED', `All ${H ? H.total : ''} of them are dead`.replace('  ', ' '), 'good', 4.5);
        return true;
      case 'gameover':
        showBanner('OVERRUN', H ? `Nobody is left standing · ${H.left} zombies remained` : 'Nobody is left standing', 'danger', 4.5);
        return true;
      default:
        return false;
    }
  }

  return { update, wavePanel, addEvent, phaseWhat: () => 'Buy time ends', dispose: () => panel.remove() };
}
