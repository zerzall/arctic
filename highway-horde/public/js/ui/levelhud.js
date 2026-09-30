// A story level's HUD (JOURNEY.md §4.2–4.3): the location card when the party enters a new
// section (the section's name large, the level's small, the part it is of the route) or when a
// mission's `title` action fires; toasts for the level's scripted moments (a gate opens or shuts,
// a checkpoint, the power going out and coming back, a horde); the defend point's name on the
// objective bar. Created only on a level map; DOM writes only on change.

import { levelGates } from '../shared/level.js';
import { mapMeta } from '../shared/maps.js';
import { h, setText } from './dom.js';

/** Seconds the location card stays up (the CSS animation fades it). */
const CARD_TIME = 4.2;

/**
 * @param {HTMLElement} root the HUD root
 * @param {object} opts { map, toast(text, tone, dur), objName (the objective bar's name element, optional) }
 * @returns {null | { addEvent(e, view): boolean, update(view, dt): void, card(title, sub, kicker): void, destroy(): void }}
 */
export function createLevelHud(root, { map, toast, objName = null }) {
  if (!map || map.kind !== 'level') return null;
  const levelName = (mapMeta(map.id) || map).name || map.name || '';
  const gates = levelGates(map);
  const kicker = h('div.level-card-kicker');
  const title = h('div.level-card-title');
  const sub = h('div.level-card-sub');
  const el = h('div.level-card', { hidden: true, role: 'status', 'aria-live': 'polite' }, [kicker, title, sub]);
  root.append(el);
  let cardT = 0;
  let lastArea = -1;
  let defendShown = null;
  const objDefault = objName ? objName.textContent : '';

  /** Show the location card. */
  function card(t, s = '', k = '') {
    setText(kicker, k);
    setText(title, t);
    setText(sub, s);
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;   // (restart the animation)
    el.classList.add('show');
    cardT = CARD_TIME;
  }

  function gateLabel(id) {
    const g = gates.find((q) => q.id === id);
    return (g && g.label) || '';
  }

  /** Level events → the card and toasts. Returns true when handled. */
  function addEvent(e) {
    switch (e.type) {
      case 'area': {
        if (e.i === lastArea) return true;
        lastArea = e.i;
        const n = (map.sections || []).length;
        card(String(e.name || '').toUpperCase(), levelName, n > 1 ? `PART ${e.i + 1} OF ${n}` : '');
        return true;
      }
      case 'title':
        card(String(e.text || '').toUpperCase(), e.sub || '', levelName.toUpperCase());
        return true;
      case 'gate': {
        const label = gateLabel(e.id);
        if (e.open) toast(label ? `${label}: open` : 'The way ahead is open', 'good', 2.8);
        else toast(label ? `${label}: shut` : 'The way back is shut', 'danger', 2.6);
        return true;
      }
      case 'checkpoint':
        toast('Checkpoint reached', 'minor', 2.4);
        return true;
      case 'lights':
        if (e.on) toast('The power is back', 'good', 2.6);
        else toast('The power is out', 'danger', 3);
        return true;
      case 'horde':
        toast('Horde incoming!', 'danger', 3);
        return true;
      case 'music':
      case 'shake':
        return false;   // (audio and the renderers)
      default:
        return false;
    }
  }

  function update(view, dt) {
    if (cardT > 0) {
      cardT -= dt;
      if (cardT <= 0) {
        el.hidden = true;
        el.classList.remove('show');
      }
    }
    // the defend point's name on the objective bar
    const d = view && view.level ? view.level.defend || null : null;
    if (objName && d !== defendShown) {
      defendShown = d;
      setText(objName, d || objDefault);
    }
  }

  function destroy() {
    el.remove();
  }

  return { addEvent, update, card, destroy };
}
