// The story lobby: the normal lobby (room code, crew, chat, AI survivors, ready / start) with
// the mission settings swapped for the campaign: crew name, chapter progress, difficulty,
// the next mission, the hideout and your survivor. lobby.js calls `decorate(session)` at the
// end of every render; outside a story room it hides the panel and touches nothing.

import { $, h, setText } from './dom.js';
import { DIFFICULTIES, DIFFICULTY_IDS } from '../shared/constants.js';
import { getMissions, HIDEOUT_NAMES, chapterTitle } from '../shared/story/content.js';
import { worldSummary, isDaylightOnly } from '../shared/story/world.js';
import { resolveNext } from '../shared/story/graph.js';
import { hideoutEffects, HIDEOUT_IDS, upgradeTier } from '../shared/story/upgrades.js';
import { exportSave, exportFileName } from '../shared/story/save.js';
import { downloadText } from './story-screen.js';
import { flashToast } from './menus.js';
import { xpStrip, chip, num } from './story-kit.js';

/** The campaign's time-of-day option (JOURNEY.md §2.1): the missions' own times, or daylight for all. */
const DAYLIGHT = [
  { on: false, name: 'As written', hint: 'Most of the road is travelled by day; a few missions play at night.' },
  { on: true, name: 'Daylight only', hint: 'Every mission and side job plays by day.' },
];

const DIFF_HINT = {
  easy: 'Fewer, weaker zombies. Rewards ×0.8',
  normal: 'The intended fight',
  hard: 'More of them, hitting harder. Rewards ×1.2',
  nightmare: 'Good luck. Rewards ×1.5',
};

/**
 * @param {object} ctx app context (audio, ...)
 */
export function createStoryLobby(ctx) {
  const { audio } = ctx;
  const panel = $('#story-lobby-panel');
  const screen = $('#screen-lobby');
  let nameInput = null;
  let key = '';

  function decorate(session) {
    const st = session && session.story;
    screen.classList.toggle('is-story', !!st);
    panel.hidden = !st;
    if (!st) return;
    const world = st.world;
    const s = worldSummary(world, getMissions());
    setText($('#lobby-title'), session.transport === 'local' ? 'Story · solo' : session.isHost ? 'Story · your room' : 'Story lobby');
    setText($('#settings-owner'), session.isHost ? 'You choose the difficulty and the time of day' : 'The host chooses the difficulty and the time of day');
    const start = $('#btn-start');
    // (a road campaign opens on a briefing, not in a hideout)
    const road = resolveNext(world).kind === 'briefing';
    const go = road ? 'hit the road' : 'head into the hideout';
    start.textContent = road ? (s.missionsDone ? 'Back to the road' : 'Hit the road') : s.missionsDone ? 'Back to the hideout' : 'Enter the hideout';
    start.classList.add('btn-primary');
    if (session.transport === 'local') {
      setText($('#lobby-status'), `Add AI survivors if you like, then ${go}.`);
    } else if (session.isHost) {
      const others = session.roster.filter((r) => !r.host && !r.bot);
      setText($('#lobby-status'), others.length ? `${others.length} friend${others.length === 1 ? '' : 's'} in the room. Ready to ${go}?` : 'Waiting for friends — share the invite link. Anyone who has played this campaign can rejoin.');
    }

    const daylight = isDaylightOnly(world);
    const stamp = `${world.rev}:${world.name}:${world.difficulty}:${daylight}:${session.isHost}:${st.profile ? st.profile.xp + ':' + st.profile.scrap + ':' + st.profile.perkPoints : ''}:${session.roster.length}`;
    if (stamp === key && !panel.hidden && panel.childElementCount) return;
    if (nameInput && document.activeElement === nameInput) return; // never rebuild under the cursor while renaming
    key = stamp;

    const pct = s.missionsTotal ? Math.round((s.missionsDone / s.missionsTotal) * 100) : 0;
    const editable = session.isHost;
    nameInput = h('input.text-input.st-crew-input', {
      type: 'text', maxlength: '24', value: world.name, spellcheck: 'false', 'aria-label': 'Crew name', id: 'st-crew-name', disabled: !editable, dataset: { autofocus: '' },
    });
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (v && v !== world.name) st.renameWorld(v);
    });
    const seg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Difficulty' }, DIFFICULTY_IDS.map((id) => h('button.seg-btn', {
      type: 'button', role: 'radio', 'aria-checked': id === world.difficulty ? 'true' : 'false', 'aria-disabled': editable ? 'false' : 'true',
      tabindex: editable ? '0' : '-1', dataset: { value: id }, title: DIFF_HINT[id],
      onclick: () => {
        if (!editable) return;
        audio.ui('click');
        st.setDifficulty(id);
      },
    }, DIFFICULTIES[id].name)));
    // "Daylight only": the host picks; the host session plays every mission by day (shared/story/daylight.js)
    const setDaylight = (on) => (typeof st.setDaylight === 'function' ? st.setDaylight(on) : st._act({ a: 'daylight', on }));
    const light = h('div.seg', { role: 'radiogroup', 'aria-label': 'Time of day' }, DAYLIGHT.map((o) => h('button.seg-btn', {
      type: 'button', role: 'radio', 'aria-checked': o.on === daylight ? 'true' : 'false', 'aria-disabled': editable ? 'false' : 'true',
      tabindex: editable ? '0' : '-1', dataset: { daylight: String(o.on) }, title: o.hint,
      onclick: () => {
        if (!editable || o.on === daylight) return;
        audio.ui('click');
        setDaylight(o.on);
      },
    }, o.name)));
    const fx = hideoutEffects(world.hideout.upgrades);
    const built = HIDEOUT_IDS.reduce((n, id) => n + upgradeTier(world.hideout.upgrades, id), 0);
    const bar = st.profile ? xpStrip(st.profile) : null;
    const nextM = s.next;
    panel.replaceChildren(
      h('div.panel-head', null, [h('h2', { text: 'Campaign' }), h('span.panel-meta', { text: `Road to Haven · rev ${world.rev}` })]),
      h('div.st-lobby-grid', null, [
        h('div.st-lobby-main', null, [
          h('label.field', { for: 'st-crew-name' }, [h('span.field-label', { text: 'Crew' }), nameInput]),
          h('div.field-label', { text: 'Difficulty' }),
          seg,
          h('div.opt-hint', { text: DIFF_HINT[world.difficulty] }),
          h('div.field-label', { text: 'Time of day' }),
          light,
          h('div.opt-hint', { text: DAYLIGHT[daylight ? 1 : 0].hint }),
          h('div.st-progress', { role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Campaign progress' }, h('i', { style: { width: `${pct}%` } })),
          h('div.st-chips', null, [
            chip('CHAPTER', s.complete ? 'Done' : `${s.chapter} · ${s.chapterTitle}`),
            chip('MISSIONS', `${s.missionsDone}/${s.missionsTotal}`),
            chip('STARS', `${s.stars}/${s.starsTotal}`),
            chip('HIDEOUT', HIDEOUT_NAMES[s.hideout] || s.hideout),
          ]),
          nextM
            ? h('div.st-next-mission', null, [h('div.st-kicker', { text: `Next: ${nextM.chapter}.${nextM.index} · ${chapterTitle(nextM.chapter)}` }), h('b', { text: nextM.title }), h('p', { text: nextM.blurb || '' })])
            : h('div.st-next-mission', null, [h('b', { text: 'The road is finished.' }), h('p', { text: 'Replay any mission for stars and scrap.' })]),
          h('div.st-sub', { text: `Hideout upgrades built: ${built}${fx.light ? ' · lights on' : ''}. Crew so far: ${Object.values(world.members).map((m) => m.name).join(', ') || 'just you'}.` }),
        ]),
        h('div.st-lobby-side', null, [
          h('div.field-label', { text: 'Your survivor' }),
          st.profile ? h('div.st-survivor-mini', null, [
            h('div.st-survivor-name', { text: st.profile.name }),
            bar.el,
            h('div.st-chips', null, [chip('SCRAP', num(st.profile.scrap), 'scrap'), st.profile.perkPoints ? chip('PERK POINTS', st.profile.perkPoints, 'ok') : null]),
          ]) : null,
          h('button.btn.btn-small', {
            type: 'button', dataset: { act: 'export' },
            onclick: () => {
              downloadText(exportFileName(world.name), exportSave({ profile: st.profile, worlds: [world] }));
              flashToast('Campaign exported — send the file to a friend so they can host it', 'good');
            },
          }, 'Export campaign'),
        ]),
      ]),
    );
  }

  return { decorate, reset() { key = ''; panel.replaceChildren(); panel.hidden = true; screen.classList.remove('is-story'); } };
}
