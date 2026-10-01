// The two screens around a mission: the BRIEFING (mission card, the crew's ready check, your
// kit; the host deploys) and the DEBRIEF (stars, per-player XP bars that fill and roll over
// into level-ups, scrap, guns found, what the crew's world gained, then the way back to the
// hideout or a retry). Both are overlays over the running hideout / frozen mission game.

import { h, setText } from './dom.js';
import { mapMeta } from '../shared/maps.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS } from '../shared/constants.js';
import { xpBar } from '../shared/story/progression.js';
import { castOf, getMission, HIDEOUT_NAMES, playableLines, pepFor, retryQuip } from '../shared/story/content.js';
import { pips, chip, weaponIcon, num } from './story-kit.js';
import { MAX_TIER, KIT_ITEMS, KIT_IDS } from '../shared/story/upgrades.js';

const ANIM_MS = 2600;

/** What a lost mission says about why (`debrief.reason`, from the director's storyend). */
const LOSS_TEXT = {
  wiped: 'Everyone went down. Nothing from the mission is kept.',
  npc: 'Someone you were protecting was lost. Nothing from the mission is kept.',
  timeout: 'Time ran out. Nothing from the mission is kept.',
  objective: 'The objective was lost. Nothing from the mission is kept.',
  failed: 'The objective failed. Nothing from the mission is kept.',
};

function clock(secs) {
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
}

/** The three star goals of a mission as short labels, lit by what the crew met. */
function starGoals(mission, d) {
  const st = (mission && mission.stars) || {};
  const met = d.met || { time: d.stars >= 2, perfect: d.stars >= 3 };
  const clean = [st.noDowns ? 'no one goes down' : '', st.optional ? 'every bonus' : ''].filter(Boolean).join(' + ');
  return [
    { text: 'Win', on: d.stars >= 1 },
    st.time > 0 ? { text: `Under ${clock(st.time)}`, on: !!met.time } : null,
    clean ? { text: clean.charAt(0).toUpperCase() + clean.slice(1), on: !!met.perfect } : null,
  ].filter(Boolean);
}

/** What the debrief's way-on button says, from where the story goes next (`debrief.next`). */
function wayOnLabel(next, victory) {
  if (!next || next.done) return 'Back to the hideout';
  if (next.kind === 'briefing') return victory ? 'Next mission' : 'Back to the briefing';
  if (next.epilogue) return 'Continue';
  if (next.arrival) return `On to ${HIDEOUT_NAMES[next.hideout] || 'the next hideout'}`;
  return 'Back to the hideout';
}

function ease(t) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/**
 * @param {{ root: HTMLElement, ctx: object, audio: object, deps: object, getSession: () => object,
 *   dialogue: object, panels: object, onChange?: Function }} o
 */
export function createFlow({ root, ctx, audio, deps, getSession, dialogue, panels, onChange, onMenu }) {
  const briefEl = h('div.st-brief', { hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mission briefing' });
  const debriefEl = h('div.st-debrief', { hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mission result' });
  root.append(briefEl, debriefEl);
  let briefShownFor = null;
  let animRaf = 0;
  let debriefKey = null;

  const story = () => {
    const s = getSession();
    return s && s.story ? s.story : null;
  };

  // ------------------------------------------------------------------ briefing

  function renderBriefing() {
    const st = story();
    if (!st || st.stage !== 'briefing' || !st.mission) {
      closeBriefing();
      return;
    }
    const m = st.mission;
    const session = getSession();
    const roster = session.roster;
    const ready = new Set(st.ready);
    const isHost = st.isHost;
    const map = mapMeta(m.map);
    const preview = h('canvas.st-map-preview', { width: 520, height: 292, 'aria-hidden': 'true' });
    drawPreview(preview, m);
    const rw = m.rewards || {};
    const lv = Array.isArray(m.level) ? m.level : [1, 1];
    const card = h('section.st-brief-card', null, [
      h('div.st-brief-kicker', { text: `Chapter ${m.chapter} · Mission ${m.chapter}.${m.index}` }),
      h('h2', { text: m.title }),
      preview,
      h('div.st-mission-map', null, [h('span.st-tag', { text: map ? map.name : m.map }), h('span.st-tag', { text: m.time === 'day' ? 'Day' : 'Night' })]),
      h('p.st-blurb', { text: m.blurb || '' }),
      h('div.st-mission-facts', null, [chip('RECOMMENDED', `Lv ${lv[0]}–${lv[1]}`), rw.xp ? chip('XP', rw.xp) : null, rw.scrap ? chip('SCRAP', rw.scrap) : null]),
    ]);
    const rows = roster.map((r) => {
      const on = ready.has(r.id) || !!r.bot;
      const canvas = h('canvas.st-row-portrait', { width: 72, height: 72, 'aria-hidden': 'true' });
      try {
        deps.renderClassPortrait(canvas, r.cls, r.color);
      } catch {
        // decorative
      }
      return h('li.st-crew-row' + (on ? '.ready' : ''), { dataset: { pid: String(r.id) } }, [
        canvas,
        h('span.st-crew-name', { text: r.name, style: { color: PLAYER_COLORS[r.color] || '#fff' } }),
        h('span.st-lvl', { text: `LV ${r.lvl || 1}` }),
        h('span.st-ready', { text: r.bot ? 'AI' : on ? 'READY' : 'NOT READY' }),
      ]);
    });
    const crew = h('section.st-brief-crew', null, [h('h3.st-h', { text: 'The crew' }), h('ul.st-crew-list', null, rows)]);
    const me = st.profile;
    const carried = KIT_IDS.filter((k) => me.kit[k]).map((k) => `${me.kit[k]}× ${KIT_ITEMS[k].name}`);
    const kit = h('section.st-brief-kit', null, [
      h('h3.st-h', { text: 'Your kit' }),
      h('div.st-kit-guns', null, me.loadout.map((id) => (id ? h('div.st-kit-gun', null, [weaponIcon(id, 70), h('span', { text: WEAPONS[id].name }), pips(me.weapons[id].tier, MAX_TIER, 'tier')]) : h('div.st-kit-gun.empty', { text: '—' })))),
      h('p.st-note', { text: carried.length ? `Carrying: ${carried.join(', ')}` : 'No supplies taken. Visit the armory.' }),
      h('button.btn.btn-small', { type: 'button', dataset: { act: 'armory' }, onclick: () => panels.open('armory') }, 'Open the armory'),
    ]);
    const notReady = roster.filter((r) => !r.bot && !ready.has(r.id));
    const menuBtn = h('button.btn.btn-ghost.st-menu', { type: 'button', dataset: { act: 'menu' }, onclick: () => onMenu && onMenu() }, 'Menu');
    const foot = h('footer.st-brief-foot', null, isHost
      ? [
        menuBtn,
        st.direct ? null : h('button.btn', { type: 'button', dataset: { act: 'cancel' }, onclick: () => st.cancelBriefing() }, 'Back to the hideout'),
        h('button.btn.btn-primary.btn-big', {
          type: 'button', dataset: { act: 'deploy', autofocus: '' },
          onclick: () => {
            const go = () => {
              audio.ui('stage');
              st.deploy();
            };
            if (notReady.length) ctx.dialogs.confirm('Deploy without everyone?', `${notReady.map((r) => r.name).join(', ')} ${notReady.length === 1 ? 'is' : 'are'} not ready yet.`, 'Deploy anyway', go);
            else go();
          },
        }, [h('span.btn-title', { text: 'Deploy' }), h('span.btn-sub', { text: notReady.length ? `${notReady.length} not ready` : 'Everyone is ready' })]),
      ]
      : [
        menuBtn,
        h('span.st-wait', { text: 'The host sends the crew out.' }),
        h('button.btn.btn-big' + (ready.has(session.localId) ? '' : '.btn-primary'), {
          type: 'button', dataset: { act: 'ready', autofocus: '' },
          onclick: () => {
            st.setReady(!ready.has(session.localId));
            audio.ui('ready');
          },
        }, ready.has(session.localId) ? 'Ready ✓ (tap to undo)' : 'Ready'),
      ]);
    briefEl.replaceChildren(h('div.st-brief-inner', null, [card, h('div.st-brief-side', null, [crew, kit])]), foot);
  }

  function drawPreview(canvas, m) {
    try {
      const pm = deps.buildMap(m.map, 1, m.mode === 'campaign' ? { mode: 'campaign' } : undefined);
      if (m.time === 'day') pm.time = 'day';
      deps.renderMapPreview(canvas, pm);
    } catch {
      // the preview is decorative
    }
  }

  function showBriefing() {
    const st = story();
    if (!st || !st.mission) return;
    const first = briefShownFor !== st.missionId;
    briefShownFor = st.missionId;
    briefEl.hidden = false;
    renderBriefing();
    if (first) {
      audio.ui('stage');
      // the briefing itself, then the send-off the mission's pep talk gives
      const lines = [...(Array.isArray(st.mission.briefing) ? st.mission.briefing : []), ...(pepFor(st.mission.id) || [])];
      const playable = playableLines(lines, st.world);
      if (playable.length) dialogue.play(playable, { title: `${st.mission.chapter}.${st.mission.index} · ${st.mission.title}` });
    }
    requestAnimationFrame(() => {
      const b = briefEl.querySelector('[data-autofocus]') || briefEl.querySelector('button');
      if (b && !dialogue.isOpen) b.focus({ preventScroll: true });
    });
    if (onChange) onChange();
  }

  function closeBriefing() {
    if (briefEl.hidden) return;
    briefEl.hidden = true;
    briefEl.replaceChildren();
    briefShownFor = null;
    if (onChange) onChange();
  }

  // ------------------------------------------------------------------ debrief

  function closeDebrief() {
    if (debriefEl.hidden) return;
    cancelAnimationFrame(animRaf);
    debriefEl.hidden = true;
    debriefEl.replaceChildren();
    debriefKey = null;
    if (onChange) onChange();
  }

  function showDebrief(d) {
    const st = story();
    const session = getSession();
    if (!st || !d) return;
    debriefKey = `${d.mission}:${d.time}:${d.stars}`;
    const victory = d.result === 'victory';
    const mission = getMission(d.mission);
    const me = d.players.find((p) => p.pid === session.localId) || null;
    const roster = new Map(session.roster.map((r) => [r.id, r]));
    const quip = victory ? null : retryQuip(d.mission, Math.random());
    const starEls = [0, 1, 2].map((i) => h('span.st-star' + (i < d.stars ? '.on' : ''), { text: '★', style: { '--i': String(i) } }));
    const head = h('header.st-debrief-head', null, [
      h('div.st-debrief-kicker', { text: mission ? `Chapter ${mission.chapter} · ${mission.title}` : d.title }),
      h('h2.st-debrief-title', { text: victory ? (d.replay ? 'Mission complete' : 'Mission complete') : 'Mission failed' }),
      victory ? h('div.st-stars-row', { 'aria-label': `${d.stars} stars` }, starEls) : h('p.st-sub', { text: LOSS_TEXT[d.reason] || 'The crew fell back. Nothing from the mission is kept.' }),
      victory ? h('ul.st-goals', null, starGoals(mission, d).map((g) => h('li' + (g.on ? '.on' : ''), { text: `${g.on ? '★' : '☆'} ${g.text}` }))) : null,
      quip ? h('p.st-quip', null, [h('b', { text: castOf(quip.who).name, style: { color: castOf(quip.who).color } }), ` “${quip.text}”`]) : null,
      d.time ? h('div.st-sub', { text: `Time ${Math.floor(d.time / 60)}:${String(d.time % 60).padStart(2, '0')}${d.replay ? ' · replay' : ''}` }) : null,
    ]);

    const anims = [];
    const rows = d.players.map((p) => {
      const r = roster.get(p.pid);
      const canvas = h('canvas.st-row-portrait', { width: 96, height: 96, 'aria-hidden': 'true' });
      try {
        if (r) deps.renderClassPortrait(canvas, r.cls, r.color);
      } catch {
        // decorative
      }
      const lvl = h('span.st-lvl-badge', { text: `LV ${p.delta.levelBefore}` });
      const fill = h('i.st-xp-fill', { style: { width: `${Math.round(xpBar({ xp: p.delta.xpBefore }).frac * 100)}%` } });
      const gain = h('span.st-xp-gain', { text: '+0 XP' });
      const lines = h('ul.st-breakdown', null, (p.breakdown || []).map((b) => h('li', null, [h('span', { text: b.label }), h('b', { text: `+${num(b.xp)}` })])));
      const flash = h('span.st-levelup', { hidden: true, text: 'LEVEL UP' });
      const loot = h('div.st-loot', null, [
        p.delta.scrap ? chip('SCRAP', `+${num(p.delta.scrap)}`, 'scrap') : null,
        p.delta.weapon && WEAPONS[p.delta.weapon] ? h('span.st-newgun', null, [h('b', { text: 'NEW GUN' }), WEAPONS[p.delta.weapon].name]) : null,
        p.delta.perkPoints ? chip('PERK POINTS', `+${p.delta.perkPoints}`, 'ok') : null,
      ]);
      anims.push({ p, lvl, fill, gain, flash, shown: p.delta.levelBefore });
      return h('li.st-result-row' + (p.pid === session.localId ? '.me' : ''), { dataset: { pid: String(p.pid) } }, [
        canvas,
        h('div.st-result-main', null, [
          h('div.st-result-top', null, [h('span.st-crew-name', { text: p.name, style: { color: r ? PLAYER_COLORS[r.color] : '#fff' } }), lvl, flash, gain]),
          h('div.st-xp', null, [h('span.st-xp-track', null, fill)]),
          lines,
          loot,
        ]),
      ]);
    });
    const world = [];
    if (victory) {
      if (d.stash && d.stash.scrap) world.push(chip('STASH SCRAP', `+${num(d.stash.scrap)}`, 'stash'));
      if (d.stash && d.stash.parts) world.push(chip('PARTS', `+${d.stash.parts}`, 'parts'));
      if (d.unlocks && d.unlocks.npc) world.push(h('span.st-newgun', null, [h('b', { text: 'JOINED THE HIDEOUT' }), castOf(d.unlocks.npc).name]));
      if (d.unlocks && d.unlocks.hideout) world.push(h('span.st-newgun', null, [h('b', { text: 'NEW HIDEOUT' }), HIDEOUT_NAMES[d.unlocks.hideout] || d.unlocks.hideout]));
      if (d.unlocks && d.unlocks.chapterDone) world.push(h('span.st-newgun', null, [h('b', { text: 'CHAPTER COMPLETE' }), '']));
      if (d.firstClear) world.push(chip('FIRST CLEAR', '✓', 'ok'));
    }
    const crew = world.length ? h('section.st-debrief-crew', null, [h('h3.st-h', { text: 'The crew' }), h('div.st-loot', null, world)]) : null;

    const points = st.profile ? st.profile.perkPoints : 0;
    const perkBtn = points > 0
      ? h('button.btn.btn-primary', { type: 'button', dataset: { act: 'perks' }, onclick: () => panels.open('perks') }, `Spend ${points} perk point${points === 1 ? '' : 's'}`)
      : h('button.btn.btn-ghost', { type: 'button', dataset: { act: 'perks' }, onclick: () => panels.open('perks') }, 'Perks');
    const menuBtn = h('button.btn.btn-ghost.st-menu', { type: 'button', dataset: { act: 'menu' }, onclick: () => onMenu && onMenu() }, 'Menu');
    const foot = h('footer.st-debrief-foot', null, st.isHost
      ? [
        menuBtn,
        perkBtn,
        !victory ? h('button.btn.btn-primary.btn-big', { type: 'button', dataset: { act: 'retry', autofocus: '' }, onclick: () => st.retry() }, 'Retry the mission') : null,
        h('button.btn' + (victory ? '.btn-primary.btn-big' : ''), { type: 'button', dataset: victory ? { act: 'back', autofocus: '' } : { act: 'back' }, onclick: () => st.backToHideout() }, wayOnLabel(d.next, victory)),
      ]
      : [menuBtn, perkBtn, h('span.st-wait', { text: 'Waiting for the host to head back…' })]);
    debriefEl.replaceChildren(h('div.st-debrief-inner', null, [head, h('ul.st-results', null, rows), crew, foot]));
    debriefEl.hidden = false;
    debriefEl.classList.toggle('defeat', !victory);
    audio.ui(victory ? 'victory' : 'gameover');
    if (onChange) onChange();
    animate(anims, () => {
      if (victory && me && mission && Array.isArray(mission.debrief) && mission.debrief.length && !d.replay) {
        dialogue.play(playableLines(mission.debrief, st.world), { title: `${mission.title} — afterwards` });
      }
    });
    requestAnimationFrame(() => {
      const b = debriefEl.querySelector('[data-autofocus]') || debriefEl.querySelector('button');
      if (b) b.focus({ preventScroll: true });
    });
  }

  function animate(list, done) {
    cancelAnimationFrame(animRaf);
    const t0 = performance.now();
    let finished = false;
    const step = (now) => {
      const k = ease((now - t0 - 500) / ANIM_MS);
      for (const a of list) {
        const { xpBefore, xpAfter } = a.p.delta;
        const xp = xpBefore + (xpAfter - xpBefore) * k;
        const b = xpBar({ xp });
        a.fill.style.width = `${Math.round(b.frac * 100)}%`;
        setText(a.gain, `+${num(Math.round((xpAfter - xpBefore) * k))} XP`);
        if (b.level !== a.shown) {
          a.shown = b.level;
          a.lvl.textContent = `LV ${b.level}`;
          if (b.level > a.p.delta.levelBefore) {
            a.flash.hidden = false;
            a.lvl.classList.remove('pop');
            void a.lvl.offsetWidth;
            a.lvl.classList.add('pop');
            audio.ui('escape');
          }
        }
      }
      if (k >= 1 && !finished) {
        finished = true;
        for (const a of list) {
          a.fill.style.width = `${Math.round(xpBar({ xp: a.p.delta.xpAfter }).frac * 100)}%`;
          setText(a.gain, `+${num(a.p.delta.xpAfter - a.p.delta.xpBefore)} XP`);
        }
        setTimeout(done, 700);
        return;
      }
      animRaf = requestAnimationFrame(step);
    };
    animRaf = requestAnimationFrame(step);
  }

  return {
    /** Re-derive what is on screen from the story state (call on every 'story' event). */
    sync() {
      const st = story();
      if (!st) {
        closeBriefing();
        closeDebrief();
        return;
      }
      if (st.stage === 'briefing') {
        if (briefEl.hidden || briefShownFor !== st.missionId) showBriefing();
        else renderBriefing();
      } else {
        closeBriefing();
      }
      if (st.stage === 'debrief' && st.debrief) {
        const key = `${st.debrief.mission}:${st.debrief.time}:${st.debrief.stars}`;
        if (debriefEl.hidden || debriefKey !== key) showDebrief(st.debrief);
        else if (!debriefEl.hidden) refreshDebriefFooter();
      } else {
        closeDebrief();
      }
    },
    get briefingOpen() {
      return !briefEl.hidden;
    },
    get debriefOpen() {
      return !debriefEl.hidden;
    },
    /** The perk button's label follows the points left after spending some. */
    refreshDebrief: () => refreshDebriefFooter(),
    /** Gamepad: focus moves inside whichever screen is up. */
    activeElement() {
      return !debriefEl.hidden ? debriefEl : !briefEl.hidden ? briefEl : null;
    },
    destroy() {
      cancelAnimationFrame(animRaf);
      briefEl.remove();
      debriefEl.remove();
    },
  };

  function refreshDebriefFooter() {
    const st = story();
    const btn = debriefEl.querySelector('[data-act="perks"]');
    if (!btn || !st || !st.profile) return;
    const points = st.profile.perkPoints;
    btn.textContent = points > 0 ? `Spend ${points} perk point${points === 1 ? '' : 's'}` : 'Perks';
    btn.classList.toggle('btn-primary', points > 0);
    btn.classList.toggle('btn-ghost', points <= 0);
  }
}
