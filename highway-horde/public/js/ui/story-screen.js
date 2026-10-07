// The Story screen (main menu → Story): your survivor, your campaigns (Continue solo with an
// AI squad, Host online, Export, Delete), New campaign, Import a save file, Export everything
// and Join a friend's campaign. All saves live in this browser (shared/story/save.js).

import { $, h, fitCanvas } from './dom.js';
import { DIFFICULTIES, DIFFICULTY_IDS } from '../shared/constants.js';
import { CLASSES } from '../shared/classes.js';
import { WEAPONS } from '../shared/weapons.js';
import { getMissions, HIDEOUT_NAMES } from '../shared/story/content.js';
import { worldSummary } from '../shared/story/world.js';
import {
  loadProfile, listWorlds, deleteWorld, saveWorld, exportSave, exportFileName, parseSave, importParsed, loadWorlds,
} from '../shared/story/save.js';
import { perkPointsSpent } from '../shared/story/perks.js';
import { flashToast } from './menus.js';
import { xpStrip, chip, num } from './story-kit.js';

const DIFF_HINT = {
  easy: 'Fewer, weaker zombies',
  normal: 'The intended fight',
  hard: 'More of them, hitting harder',
  nightmare: 'Good luck',
};

/** Hand `text` to the browser as a file download. */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 500);
}

function readFile(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function when(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * @param {object} ctx app context (prefs, audio, deps, modals, dialogs, onLeave ...)
 * @param {{ ensureProfile: () => object, onPlay: (world: object, transport: 'local'|'auto') => void,
 *   onCreate: (opts: { name: string, difficulty: string, transport: string }) => void,
 *   onJoin: () => void, onBack: () => void }} hooks
 */
export function createStoryScreen(ctx, hooks) {
  const { audio, deps } = ctx;
  const screen = $('#screen-story');
  const wrap = $('#story-wrap');
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  screen.appendChild(fileInput);
  let visible = false;

  // ---- new campaign dialog -----------------------------------------------------------------------
  let diff = 'normal';
  const nameInput = h('input.text-input#nc-name', { type: 'text', maxlength: '24', autocomplete: 'off', spellcheck: 'false', placeholder: 'The Dusty Crew' });
  const diffSeg = h('div.seg#nc-diff', { role: 'radiogroup', 'aria-label': 'Difficulty' }, DIFFICULTY_IDS.map((id) => h('button.seg-btn', {
    type: 'button', role: 'radio', 'aria-checked': id === diff ? 'true' : 'false', dataset: { value: id }, title: DIFF_HINT[id],
    onclick: () => {
      diff = id;
      audio.ui('click');
      syncDiff();
    },
  }, DIFFICULTIES[id].name)));
  const diffHint = h('div.opt-hint');
  function syncDiff() {
    for (const b of diffSeg.children) b.setAttribute('aria-checked', b.dataset.value === diff ? 'true' : 'false');
    diffHint.textContent = DIFF_HINT[diff];
  }
  syncDiff();
  const dlg = h('div.modal#dlg-campaign', { hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nc-title' }, [
    h('form.panel.modal-card.st-newcamp', { novalidate: true, onsubmit: (e) => e.preventDefault() }, [
      h('h2.modal-title#nc-title', { text: 'New campaign' }),
      h('p.modal-text', { text: 'Twelve missions from the pileup on Highway 9 to the ferry at Lake Harlan, and side jobs along the way. Your crew, your hideouts, your saves.' }),
      h('label.field', { for: 'nc-name' }, [h('span.field-label', { text: 'Crew name' }), nameInput]),
      h('div.field-label', { text: 'Difficulty' }),
      diffSeg,
      diffHint,
      h('div.btn-row.st-newcamp-btns', null, [
        h('button.btn', { type: 'button', 'data-close': '', text: 'Cancel' }),
        h('button.btn', { type: 'button', dataset: { act: 'host' }, onclick: () => create('auto') }, 'Host online'),
        h('button.btn.btn-primary', { type: 'button', dataset: { act: 'solo' }, onclick: () => create('local') }, 'Play solo'),
      ]),
    ]),
  ]);
  $('#app').appendChild(dlg);

  function create(transport) {
    const name = nameInput.value.trim() || nameInput.placeholder;
    ctx.modals.close(dlg, 'create');
    hooks.onCreate({ name, difficulty: diff, transport });
  }

  function openNew() {
    const p = hooks.ensureProfile();
    nameInput.value = '';
    nameInput.placeholder = `The ${p.name} Crew`.slice(0, 24);
    ctx.modals.open(dlg);
  }

  // ---- import / export ---------------------------------------------------------------------------------

  function exportAll() {
    const profile = loadProfile();
    const worlds = listWorlds();
    if (!profile && !worlds.length) {
      flashToast('Nothing to export yet', 'bad');
      audio.ui('deny');
      return;
    }
    downloadText(exportFileName(worlds[0] ? worlds[0].name : profile.name), exportSave({ profile, worlds }));
    flashToast('Save exported', 'good');
  }

  function exportOne(world) {
    downloadText(exportFileName(world.name), exportSave({ profile: loadProfile(), worlds: [world] }));
    flashToast(`"${world.name}" exported`, 'good');
  }

  async function doImport(file) {
    let parsed;
    try {
      parsed = parseSave(await readFile(file));
    } catch {
      parsed = { ok: false, error: 'That file could not be read.' };
    }
    if (!parsed.ok) {
      audio.ui('deny');
      ctx.dialogs.error('Couldn\'t import', parsed.error, () => {});
      return;
    }
    const current = loadProfile();
    const inc = parsed.profile;
    const finish = (replaceProfile) => {
      const r = importParsed(parsed, { replaceProfile }, undefined);
      audio.ui('buy');
      const bits = [];
      if (r.profileReplaced) bits.push(`survivor ${r.profile.name} (level ${r.profile.level})`);
      if (r.worlds.length) bits.push(`${r.worlds.length} campaign${r.worlds.length === 1 ? '' : 's'}${r.kept ? `, ${r.kept} already newer here` : ''}`);
      flashToast(bits.length ? `Imported ${bits.join(' and ')}` : 'Nothing new in that file', bits.length ? 'good' : '');
      refresh();
    };
    if (inc && current && inc.id !== current.id) askProfile(inc, current, finish);
    else finish(false);
  }

  // The file holds a different survivor than this browser's: replace, keep, or cancel.
  const impText = h('p.modal-text');
  let impDone = null;
  const impDlg = h('div.modal#dlg-import', { hidden: true, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'imp-title' }, [
    h('div.panel.modal-card', null, [
      h('h2.modal-title#imp-title', { text: 'Whose survivor?' }),
      impText,
      h('div.btn-row.st-newcamp-btns', null, [
        h('button.btn', { type: 'button', 'data-close': '', text: 'Cancel' }),
        h('button.btn', { type: 'button', dataset: { act: 'keep' }, onclick: () => pick(false) }, 'Keep mine'),
        h('button.btn.btn-danger', { type: 'button', dataset: { act: 'replace' }, onclick: () => pick(true) }, 'Replace mine'),
      ]),
    ]),
  ]);
  $('#app').appendChild(impDlg);
  function pick(replace) {
    const fn = impDone;
    impDone = null;
    ctx.modals.close(impDlg, 'pick');
    if (fn) fn(replace);
  }
  function askProfile(inc, current, done) {
    impText.textContent = `The file holds ${inc.name}, level ${inc.level}. This browser has ${current.name}, level ${current.level}. Replace your survivor with the one in the file, or keep yours? The campaigns are merged either way (the newer copy of each wins).`;
    impDone = done;
    ctx.modals.open(impDlg, { onClose: (reason) => {
      if (reason !== 'pick') impDone = null;
    } });
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (f) doImport(f);
  });

  // ---- rendering ---------------------------------------------------------------------------------------------

  function survivorCard() {
    const p = hooks.ensureProfile();
    const canvas = h('canvas.st-hero-portrait', { width: 200, height: 200, 'aria-hidden': 'true' });
    const c = CLASSES[p.cls];
    const bar = xpStrip(p);
    const spent = perkPointsSpent(p.perks);
    const guns = p.loadout.filter(Boolean).map((id) => WEAPONS[id].name);
    const el = h('section.panel.st-survivor', null, [
      h('div.panel-head', null, h('h2', { text: 'Your survivor' })),
      h('div.st-survivor-body', null, [
        canvas,
        h('div.st-survivor-info', null, [
          h('div.st-survivor-name', { text: p.name }),
          h('div.st-sub', { text: c ? `${c.name} · ${c.role}` : p.cls }),
          bar.el,
          h('div.st-chips', null, [
            chip('SCRAP', num(p.scrap), 'scrap'),
            chip('PERKS', `${spent} / ${p.level - 1}`, p.perkPoints ? 'ok' : ''),
            p.perkPoints ? chip('POINTS', p.perkPoints, 'ok') : null,
          ]),
          h('div.st-sub', { text: `Carries ${guns.join(', ')}` }),
          h('div.st-sub', { text: `${num(p.stats.kills)} kills · ${p.stats.missions} missions won` }),
        ]),
      ]),
      h('p.st-note', { text: 'Your survivor lives in this browser. Level, perks, guns and scrap follow you into any friend\'s campaign.' }),
    ]);
    requestAnimationFrame(() => {
      fitCanvas(canvas);
      try {
        deps.renderClassPortrait(canvas, p.cls, p.color);
      } catch {
        // decorative
      }
    });
    return el;
  }

  function worldCard(world, isFirst) {
    const s = worldSummary(world, getMissions());
    const pct = s.missionsTotal ? Math.round((s.missionsDone / s.missionsTotal) * 100) : 0;
    return h('article.panel.st-world' + (isFirst ? '.recent' : ''), { dataset: { world: world.id } }, [
      h('header.st-world-head', null, [
        h('div', null, [
          h('h3.st-world-name', { text: world.name }),
          h('div.st-sub', { text: s.complete ? 'Campaign complete' : `Chapter ${s.chapter} · ${s.chapterTitle}` }),
        ]),
        h('span.st-diff-tag.' + world.difficulty, { text: DIFFICULTIES[world.difficulty].name }),
      ]),
      h('div.st-progress', { role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Campaign progress' }, h('i', { style: { width: `${pct}%` } })),
      h('div.st-chips', null, [
        chip('MISSIONS', `${s.missionsDone}/${s.missionsTotal}`),
        chip('STARS', `${s.stars}/${s.starsTotal}`),
        s.sideTotal ? chip('SIDE JOBS', `${s.sideDone}/${s.sideTotal}`) : null,
        chip('HIDEOUT', HIDEOUT_NAMES[s.hideout] || s.hideout),
      ]),
      h('div.st-sub', { text: `${s.members.length ? `Crew: ${s.members.join(', ')}` : 'No crew yet'} · played ${when(world.updatedAt)}` }),
      h('div.st-world-btns', null, [
        h('button.btn.btn-primary', { type: 'button', dataset: { act: 'continue' }, onclick: () => hooks.onPlay(world, 'local') }, [h('span.btn-title', { text: 'Continue' }), h('span.btn-sub', { text: 'solo, with an AI squad' })]),
        h('button.btn', { type: 'button', dataset: { act: 'host' }, onclick: () => hooks.onPlay(world, 'auto') }, [h('span.btn-title', { text: 'Host online' }), h('span.btn-sub', { text: 'friends join with a code' })]),
        h('button.btn.btn-small.btn-ghost', { type: 'button', dataset: { act: 'export' }, onclick: () => exportOne(world) }, 'Export'),
        h('button.btn.btn-small.btn-ghost.btn-danger', {
          type: 'button', dataset: { act: 'delete' },
          onclick: () => ctx.dialogs.confirm('Delete this campaign?', `"${world.name}" is removed from this browser. Friends who played it keep their copies, and an exported file still works.`, 'Delete', () => {
            deleteWorld(world.id);
            audio.ui('leave');
            refresh();
          }),
        }, 'Delete'),
      ]),
    ]);
  }

  function refresh() {
    const worlds = listWorlds();
    const list = h('section.st-worlds', { 'aria-label': 'Campaigns' }, worlds.length
      ? worlds.map((w, i) => worldCard(w, i === 0))
      : h('div.panel.st-empty-world', null, [
        h('h3', { text: 'No campaign yet' }),
        h('p', { text: 'Start a new one, or import a save file a friend sent you. Anyone who has played a campaign can host it later.' }),
      ]));
    wrap.replaceChildren(
      h('header.lobby-head', null, [
        h('button.btn.btn-ghost', { type: 'button', dataset: { act: 'back' }, onclick: () => hooks.onBack() }, '‹ Back'),
        h('h1.lobby-title#story-title', { text: 'Road to Haven' }),
        h('div.lobby-transport', { text: 'Story campaign' }),
      ]),
      h('div.st-story-grid', null, [
        h('div.st-story-side', null, [
          survivorCard(),
          h('div.panel.st-story-actions', null, [
            h('button.btn.btn-primary.btn-big', { type: 'button', dataset: { act: 'new' }, onclick: openNew }, [h('span.btn-title', { text: 'New campaign' }), h('span.btn-sub', { text: 'Twelve missions, six chapters' })]),
            h('button.btn.btn-big', { type: 'button', dataset: { act: 'join' }, onclick: () => hooks.onJoin() }, [h('span.btn-title', { text: 'Join a friend' }), h('span.btn-sub', { text: 'Enter their room code' })]),
            h('div.st-io', null, [
              h('button.btn', { type: 'button', dataset: { act: 'import' }, onclick: () => fileInput.click() }, 'Import save…'),
              h('button.btn', { type: 'button', dataset: { act: 'export-all' }, onclick: exportAll }, 'Export everything'),
            ]),
          ]),
        ]),
        h('div.st-story-main', null, [
          h('div.panel-head', null, [h('h2', { text: 'Your campaigns' }), h('span.panel-meta', { text: worlds.length ? `${worlds.length} saved in this browser` : '' })]),
          list,
        ]),
      ]),
    );
  }

  return {
    show() {
      visible = true;
      screen.hidden = false;
      refresh();
      requestAnimationFrame(() => {
        const b = wrap.querySelector('.st-world [data-act="continue"]') || wrap.querySelector('[data-act="new"]');
        if (b && visible) b.focus({ preventScroll: true });
      });
    },
    hide() {
      visible = false;
      screen.hidden = true;
    },
    get visible() {
      return visible;
    },
    refresh,
    openNew,
    /** Pad/keyboard root for menu navigation. */
    get el() {
      return screen;
    },
    saveWorldCopy(world) {
      return saveWorld(world);
    },
    worlds: () => loadWorlds(),
  };
}
