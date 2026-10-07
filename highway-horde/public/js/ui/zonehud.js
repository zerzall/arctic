// Evac Run HUD (SPEC §3.7 / §7.3): the zone panel under the compass — where to go, how
// long until the circle locks or shrinks, how far it is — and the "outside the safe zone"
// warning with a pulsing screen edge. Also turns the zone events into banners and toasts
// and plays the announcement sting / the warning tone. DOM writes only on change.

import { ZONE_STAGES, zoneEdgeDist, zoneName, formatCountdown } from '../shared/zone.js';
import { h, setText, setShown, setClass, setStyle } from './dom.js';

/** World px per metre (SPEC §7.5: 1 unit ≈ 1/32 m). */
const PX_PER_M = 32;

function metres(px) {
  const m = Math.max(0, Math.round(px / PX_PER_M));
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

/**
 * @param {HTMLElement} parent where the panel goes (the HUD's top-centre column)
 * @param {HTMLElement} root the HUD root (the warning vignette covers it)
 * @param {object} opts { map, audio, showBanner(title, sub, tone, dur), toast(text, tone, dur) }
 */
export function createZoneHud(parent, root, { map, audio, showBanner, toast }) {
  const title = h('div.zone-title');
  const sub = h('div.zone-sub');
  const barFill = h('i');
  const bar = h('div.zone-bar', null, barFill);
  const panel = h('div.hud-zone', { hidden: true, role: 'status' }, [title, sub, bar]);
  const warn = h('div.zone-warn', { hidden: true, role: 'alert' }, [
    h('div.zone-warn-title', { text: 'YOU ARE OUTSIDE THE SAFE ZONE' }),
    h('div.zone-warn-sub'),
  ]);
  const warnSub = warn.lastChild;
  const edge = h('div.zone-edge', { hidden: true, 'aria-hidden': 'true' });
  // right under the compass (first person) / at the top (top-down), the warning below it
  parent.insertBefore(warn, parent.querySelector('.hud-compass') ? parent.children[1] || null : parent.firstChild);
  parent.insertBefore(panel, warn);
  root.prepend(edge);

  let outsideT = 0;
  let toneT = 0;
  let lastStage = -1;

  /**
   * @param {object|null} view snapshot
   * @param {object|null} me local player record
   * @param {{x: number, y: number}|null} pos predicted local position
   * @param {number} dt
   */
  function update(view, me, pos, dt) {
    const z = view && view.zone;
    setShown(panel, !!z && view.phase !== 'gameover' && view.phase !== 'victory');
    if (!z || view.phase === 'gameover' || view.phase === 'victory') {
      setShown(warn, false);
      setShown(edge, false);
      return;
    }
    const name = zoneName(map, z) || 'the safe zone';
    const stage = ZONE_STAGES[z.stage] || 'move';
    const p = pos && Number.isFinite(pos.x) ? pos : me;
    const alive = !!me && me.state === 'alive';
    const out = p ? zoneEdgeDist(z, p.x, p.y) : -1;
    root.dataset.zone = stage;
    if (stage === 'move') {
      const inside = out <= 0;
      setText(title, inside ? `IN THE ZONE · ${name.toUpperCase()}` : `MOVE TO ${name.toUpperCase()}`);
      const left = formatCountdown(z.t);
      setText(sub, inside
        ? `Zone locks in ${left} s — hold here, the horde follows the team`
        : `Zone locks in ${left} s · ${metres(Math.max(0, out))} away`);
      setClass(panel, 'urgent', !inside && z.t <= 10);
      setClass(panel, 'inside', inside);
    } else if (stage === 'hold') {
      setText(title, `HOLD ${name.toUpperCase()}`);
      setText(sub, `The zone shrinks in ${formatCountdown(z.t)} s`);
      setClass(panel, 'urgent', z.t <= 5);
      setClass(panel, 'inside', out <= 0);
    } else if (stage === 'shrink') {
      setText(title, 'THE ZONE IS SHRINKING');
      setText(sub, `Get inside the new circle — ${formatCountdown(z.t)} s`);
      setClass(panel, 'urgent', true);
      setClass(panel, 'inside', out <= 0);
    } else {
      setText(title, `FINAL CIRCLE · ${name.toUpperCase()}`);
      setText(sub, 'Stand your ground');
      setClass(panel, 'urgent', false);
      setClass(panel, 'inside', out <= 0);
    }
    setStyle(barFill, 'width', `${z.total > 0 ? Math.max(0, Math.min(100, (z.t / z.total) * 100)).toFixed(1) : 0}%`);
    setClass(panel, 'stage-move', stage === 'move');

    // outside while the blight is live: warning, edge glow, a warning tone every 1.6 s
    const danger = alive && z.stage > 0 && view.phase === 'wave' && out > 0;
    outsideT = danger ? outsideT + dt : 0;
    setShown(warn, danger);
    setShown(edge, danger);
    if (danger) {
      setText(warnSub, `Get back in — ${metres(out)} to the edge`);
      setStyle(edge, 'opacity', String(Math.min(1, 0.45 + outsideT * 0.08).toFixed(2)));
      toneT -= dt;
      if (toneT <= 0) {
        toneT = 1.6;
        if (audio && audio.ui) audio.ui('zonewarn');
      }
    } else {
      toneT = 0;
    }
    if (z.stage !== lastStage) lastStage = z.stage;
  }

  /** Zone events → banners (the announcement plays the sting). */
  function addEvent(e) {
    if (e.type !== 'zone') return;
    const p = map && map.pois ? map.pois[e.poi] : null;
    const name = p ? p.name : 'a new spot';
    if (e.stage === 'next') {
      showBanner('NEW SAFE ZONE', `${name} — get there in ${e.time} s, a supply drop is waiting`, 'zone', 3.6);
      if (audio && audio.ui) audio.ui('zone');
    } else if (e.stage === 'lock') {
      toast(`The zone is locked at ${name} — stay inside!`, 'zone', 3);
    } else if (e.stage === 'shrink') {
      showBanner('ZONE SHRINKING', `Into the white ring in ${e.time} s`, 'zone', 2.8);
      if (audio && audio.ui) audio.ui('zone');
    }
  }

  function destroy() {
    panel.remove();
    warn.remove();
    edge.remove();
    delete root.dataset.zone;
  }

  return { update, addEvent, destroy };
}
