// Campaign HUD (SPEC §3.8 / §7.3): the stage panel under the compass (where to go, how far,
// the roof's kill quota, the zip line), the "the horde has you" warning with a red screen
// edge, the title card and fade between floors, the stage banners and the escape toasts.
// It also gives hud.js the wave panel's texts for the stage and the interact prompt of the
// zip gantry. DOM writes only on change.

import { SUB, CAMPAIGN, frontGap, frontDps, stageBanner, routeProgress } from '../shared/campaign.js';
import { h, setText, setShown, setClass, setStyle } from './dom.js';

/** World px per metre (SPEC §7.5: 1 unit ≈ 1/32 m). */
const PX_PER_M = 32;
const CARD_TIME = 3;

function metres(px) {
  const m = Math.max(0, Math.round(px / PX_PER_M));
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

/**
 * @param {HTMLElement} parent the HUD's top-centre column
 * @param {HTMLElement} root the HUD root (the warning vignette, the card and the fade cover it)
 * @param {object} opts { map, audio, showBanner(title, sub, tone, dur), toast(text, tone, dur), nameOf(pid) }
 */
export function createCampaignHud(parent, root, { map, audio, showBanner, toast, nameOf }) {
  const cfg = map.campaign;
  const title = h('div.camp-title');
  const sub = h('div.camp-sub');
  const barFill = h('i');
  const bar = h('div.camp-bar', null, barFill);
  const panel = h('div.hud-camp', { hidden: true, role: 'status' }, [title, sub, bar]);
  const warn = h('div.camp-warn', { hidden: true, role: 'alert' }, [
    h('div.camp-warn-title', { text: 'THE HORDE HAS YOU' }),
    h('div.camp-warn-sub'),
  ]);
  const warnSub = warn.lastChild;
  const edge = h('div.camp-edge', { hidden: true, 'aria-hidden': 'true' });
  const cardTitle = h('div.camp-card-title');
  const cardSub = h('div.camp-card-sub');
  const card = h('div.camp-card', { hidden: true, 'aria-hidden': 'true' }, [cardTitle, cardSub]);
  const fade = h('div.camp-fade', { hidden: true, 'aria-hidden': 'true' });
  parent.insertBefore(warn, parent.querySelector('.hud-compass') ? parent.children[1] || null : parent.firstChild);
  parent.insertBefore(panel, warn);
  root.prepend(edge);
  root.append(fade, card);

  let toneT = 0;
  let behindT = 0;
  let cardT = 0;
  let lastKey = '';
  let lastSub = -1;

  const hillWaveCount = (v) => Math.max(1, (v.totalWaves | 0) - cfg.floors.length - 2);

  /** The full-screen title card and a short fade (floor changes, the roof, the ride). */
  function showCard(t, s, dur = CARD_TIME) {
    setText(cardTitle, t);
    setText(cardSub, s || '');
    card.hidden = false;
    fade.hidden = false;
    card.classList.remove('show');
    fade.classList.remove('go');
    void card.offsetWidth;
    card.classList.add('show');
    fade.classList.add('go');
    cardT = dur;
  }

  /**
   * @param {object|null} view snapshot
   * @param {object|null} me local player record
   * @param {{x: number, y: number}|null} pos predicted local position
   * @param {number} dt
   */
  function update(view, me, pos, dt) {
    if (cardT > 0) {
      cardT -= dt;
      if (cardT <= 0) {
        card.hidden = true;
        fade.hidden = true;
        card.classList.remove('show');
        fade.classList.remove('go');
      }
    }
    const c = view && view.campaign;
    const over = !c || view.phase === 'gameover' || view.phase === 'victory';
    setShown(panel, !over);
    if (over) {
      setShown(warn, false);
      setShown(edge, false);
      return;
    }
    root.dataset.campaign = String(c.stage);
    const p = pos && Number.isFinite(pos.x) ? pos : me;
    const alive = !!me && me.state === 'alive';
    const away = p ? Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - c.r) : 0;
    const inside = !!p && away <= 0;
    const between = view.phase === 'prep' || view.phase === 'intermission';
    let t = '', s = '', frac = -1, urgent = false, good = false;
    const local = me;
    if (local && local.esc) {
      let out = 0, tot = 0;
      for (const q of view.players || []) {
        if (q.state === 'dead') continue;
        tot++;
        if (q.esc) out++;
      }
      t = 'ESCAPED';
      s = `Waiting for the others: ${out} of ${tot} are out`;
      good = true;
    } else if (local && local.ride > 0) {
      t = 'ON THE ZIP LINE';
      s = 'Hold on';
      frac = local.ride;
      good = true;
    } else {
      switch (c.stage) {
        case 1: {
          const hw = hillWaveCount(view);
          if (c.sub === SUB.BRIEF) {
            t = 'THE HILL WILL FALL';
            s = `Stock up. The breakout starts in ${Math.max(0, Math.ceil(view.timer))} s: run for the tower (${metres(away)})`;
            urgent = view.timer <= 6;
          } else if (between) {
            t = `HILLTOP · WAVE ${Math.min(hw, view.wave + 1)} NEXT`;
            s = 'Rebuild, restock, get ready';
          } else {
            const high = !!local && local.z >= CAMPAIGN.slope.highDz;
            t = `HILLTOP STAND · WAVE ${view.wave}/${hw}`;
            s = high ? `High ground: +${Math.round(CAMPAIGN.slope.high * 100)}% damage. They climb slowly` : 'Get up the hill: the high ground boosts your damage';
            good = high;
          }
          break;
        }
        case 2: {
          const gap = p ? frontGap(cfg.route, c.front, p.x, p.y) : Infinity;
          t = inside && c.total > 0 ? 'HOLD THE DOOR' : 'BREAKOUT · REACH THE TOWER';
          if (inside && c.total > 0) {
            s = `Everyone inside: the door opens in ${Math.max(0, c.t).toFixed(1)} s`;
            frac = 1 - c.t / c.total;
            good = true;
          } else {
            s = `${metres(away)} to the tower door`;
            if (Number.isFinite(gap) && gap >= 0) s += ` · ${metres(gap)} ahead of the horde`;
            if (p && cfg.routeLen) frac = Math.min(1, routeProgress(cfg.route, p.x, p.y).s / cfg.routeLen);
            urgent = Number.isFinite(gap) && gap < 260;
          }
          break;
        }
        case 3: {
          const f = cfg.floors[c.floor - 1];
          const name = f ? f.name.toUpperCase() : '';
          t = `FLOOR ${c.floor} · ${name}`;
          if (c.sub === SUB.OPEN) {
            s = inside ? 'On the stairs: going up' : `Floor clear: stairs open, ${metres(away)} away · up in ${Math.max(0, Math.ceil(view.timer))} s`;
            frac = Math.max(0, Math.min(1, view.timer / CAMPAIGN.stairs));
            good = true;
            urgent = !inside && view.timer <= 8;
          } else if (c.sub === SUB.ARRIVE) {
            s = 'Supplies dropped. Get ready';
          } else {
            s = `Clear the floor: ${view.remaining} left`;
          }
          break;
        }
        default: {
          if (c.zip) {
            t = 'ZIP LINE LIVE';
            s = inside ? 'Press interact to ride out' : `Get to the gantry: ${metres(away)}`;
            good = true;
          } else {
            t = `ROOFTOP · ${Math.min(c.kills, c.quota)}/${c.quota}`;
            s = `Kill ${Math.max(0, c.quota - c.kills)} more to wake the zip line`;
            frac = c.quota ? c.kills / c.quota : 0;
          }
        }
      }
    }
    setText(title, t);
    setText(sub, s);
    setShown(bar, frac >= 0);
    if (frac >= 0) setStyle(barFill, 'width', `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`);
    setClass(panel, 'good', good);
    setClass(panel, 'urgent', urgent);

    // the horde front has passed you: warning, red edge, a tone every 1.6 s
    let danger = false;
    if (c.stage === 2 && alive && p && view.phase === 'wave' && c.front > -1e8) {
      const gap = frontGap(cfg.route, c.front, p.x, p.y);
      if (gap < 0) danger = true;
    }
    behindT = danger ? behindT + dt : 0;
    setShown(warn, danger);
    setShown(edge, danger);
    if (danger) {
      setText(warnSub, `Run for the tower: ${metres(Math.max(0, away))} to go · ${Math.round(frontDps(behindT))} damage a second`);
      setStyle(edge, 'opacity', String(Math.min(1, 0.45 + behindT * 0.08).toFixed(2)));
      toneT -= dt;
      if (toneT <= 0) {
        toneT = 1.6;
        if (audio && audio.ui) audio.ui('zonewarn');
      }
    } else {
      toneT = 0;
    }

    // transitions worth a word
    if (c.sub !== lastSub) {
      if (c.stage === 3 && c.sub === SUB.OPEN && lastSub === SUB.FIGHT) toast('Floor clear: the stairs are open', 'good', 3.2);
      lastSub = c.sub;
    }
  }

  /** Texts for hud.js' wave panel, or null to keep the default. */
  function wavePanel(view) {
    const c = view && view.campaign;
    if (!c) return null;
    switch (c.stage) {
      case 1: return { label: 'HILL WAVE', num: String(view.phase === 'prep' ? 1 : Math.min(view.wave, hillWaveCount(view))), total: `/ ${hillWaveCount(view)}` };
      case 2: return { label: 'STAGE', num: '2', total: '/ 4', left: view.phase === 'wave' ? 'Breakout: reach the tower' : null };
      case 3: return { label: 'FLOOR', num: String(c.floor), total: `/ ${cfg.floors.length}` };
      default: return { label: 'ROOFTOP', num: String(Math.min(c.kills, c.quota)), total: `/ ${c.quota}`, left: c.zip ? 'Zip line is live' : `${Math.max(0, c.quota - c.kills)} kills to go` };
    }
  }

  /** What the countdown line says between waves. */
  function phaseWhat(view) {
    const c = view && view.campaign;
    if (c && c.sub === SUB.BRIEF) return 'Breakout';
    if (c && c.sub === SUB.OPEN) return 'Stairs close';
    return view && view.phase === 'prep' ? 'First wave' : 'Next wave';
  }

  /** The interact prompt at the zip gantry, else ''. */
  function prompt(view, me, pos, keys) {
    const c = view && view.campaign;
    if (!c || c.stage !== 4 || !c.zip || !me || me.esc || me.ride > 0 || me.state !== 'alive') return '';
    const z = cfg.roof.zip;
    return Math.hypot(pos.x - z.ix, pos.y - z.iy) <= z.r ? `Press ${keys.interact} to ride the zip line` : '';
  }

  /**
   * Campaign events → banners, the title card and toasts. Returns true when the event is
   * fully handled here (hud.js skips its own text for it).
   */
  function addEvent(e, view, localId) {
    switch (e.type) {
      case 'campaign': {
        const c = { stage: e.stage, floor: e.floor };
        const key = `${e.stage}:${e.floor}`;
        switch (e.what) {
          case 'stage': {
            if (e.stage === 1) {
              if (lastKey === '') {
                const b = stageBanner(map, c);
                showBanner(b.title, b.sub, 'camp', 4);
                if (audio && audio.ui) audio.ui('stage');
              }
            } else if (e.stage === 2) {
              const b = stageBanner(map, c);
              showBanner(b.title, b.sub, 'danger', 4.2);
              if (audio && audio.ui) audio.ui('stage');
            }
            lastKey = key;
            return true;
          }
          case 'brief':
            showBanner('THE HILL WILL FALL', 'Stock up now: when the breakout starts, run for the tower', 'danger', 4);
            if (audio && audio.ui) audio.ui('zonewarn');
            return true;
          case 'breakout':
            toast('The hill is overrun! Go go go!', 'danger', 3.4);
            return true;
          case 'floor': {
            const b = stageBanner(map, c);
            showCard(b.title, b.sub);
            if (audio && audio.ui) audio.ui('floor');
            lastKey = key;
            return true;
          }
          case 'zip':
            showBanner('ZIP LINE ONLINE', 'Quota reached. Get to the gantry and ride out', 'good', 4);
            if (audio && audio.ui) audio.ui('zipline');
            return true;
          case 'ride':
            // (your own ride shows in the panel and the camera: no card over the view)
            if (e.pid !== localId) toast(`${nameOf(e.pid)} grabs the zip line`, 'good', 2.4);
            return true;
          case 'escape': {
            if (e.pid === localId) {
              showBanner('YOU MADE IT', 'Wait for the rest of the team on the landing pad', 'good', 4);
              if (audio && audio.ui) audio.ui('escape');
            } else {
              toast(`${nameOf(e.pid)} escaped`, 'good', 3);
            }
            return true;
          }
          default: return true;
        }
      }
      case 'wave': {
        const c = view && view.campaign;
        if (!c) return false;
        if (c.stage === 1) {
          const hw = hillWaveCount(view);
          const last = e.wave === hw;
          if (e.boss) showBanner(`WAVE ${e.wave}: BOSS INCOMING`, last ? 'The last stand on the hill!' : 'Something big is coming', 'danger', 3.4);
          else showBanner(`WAVE ${e.wave} OF ${hw}`, last ? 'The last stand on the hill!' : 'Here they come', '', 2.6);
        }
        return true;
      }
      case 'waveclear': {
        // (by the wave number: the snapshot may still show the last stage)
        if (!view || !view.campaign) return false;
        const hw = hillWaveCount(view);
        if (e.wave <= hw) return false;                      // a hill wave: the ordinary banner
        const bonus = `+$${e.bonus || 0}`;
        if (e.wave === hw + 1) showBanner('TOWER REACHED', `${bonus} · the ascent begins`, 'good', 3);
        else showBanner(`FLOOR ${e.wave - hw - 1} CLEARED`, `${bonus} · stairs open`, 'good', 3);
        return true;
      }
      case 'victory':
        showBanner('ESCAPED', 'The whole team made it out', 'good', 5);
        return true;
      default: return false;
    }
  }

  function destroy() {
    panel.remove();
    warn.remove();
    edge.remove();
    card.remove();
    fade.remove();
    delete root.dataset.campaign;
  }

  return { update, addEvent, wavePanel, phaseWhat, prompt, destroy };
}
