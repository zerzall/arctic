// Station panels (STORY.md §4): the overlays a survivor opens at the hideout's stations —
// workbench (weapon tiers, buying guns), armory (loadout and supplies), upgrade board
// (hideout upgrades and the stash), infirmary (heal, perk reset), perk tree, mission board.
// They only read `session.story` and call its actions; every change is validated by the
// host and comes back as a 'story' event that re-renders the open panel.

import { h } from './dom.js';
import { mapMeta } from '../shared/maps.js';
import { WEAPONS, WEAPON_IDS } from '../shared/weapons.js';
import { GUN_SKINS, sanitizeSkin } from '../shared/gun-finish.js';
import { PERKS, PERK_IDS, MAX_RANK, RANK_LEVELS, canBuyPerk, perkPointsSpent, PERK_RESET_COST } from '../shared/story/perks.js';
import {
  MAX_TIER, tierEffect, tierMag, tierCost, canUpgradeWeapon, canBuyWeapon, weaponChapter, weaponScrapCost, HIDEOUT_UPGRADES,
  HIDEOUT_IDS, HIDEOUT_TIERS, HIDEOUT_TIER_CHAPTER, upgradeTier, canUpgradeHideout, hideoutEffects, KIT_ITEMS, KIT_IDS,
} from '../shared/story/upgrades.js';
import { deriveWeapon } from '../shared/story/mods.js';
import { perkEffects } from '../shared/story/perks.js';
import {
  getMissions, getChapters, chapterTitle, castOf, HIDEOUT_NAMES, stationKeeper, stationLine, expandTokens, sceneContext,
} from '../shared/story/content.js';
import { missionBoard, currentChapter, worldSummary } from '../shared/story/world.js';
import { xpBar } from '../shared/story/progression.js';
import { padNavigate } from './padnav.js';
import { pips, chip, xpStrip, weaponIcon, drawCastPortrait, num, reasonText } from './story-kit.js';

const TITLES = {
  workbench: { title: 'Workbench', npc: 'deke', glyph: '⚒' },
  armory: { title: 'Armory', npc: 'okafor', glyph: '⚙' },
  upgrades: { title: 'Upgrade board', npc: 'deke', glyph: '▦' },
  infirmary: { title: 'Infirmary', npc: 'mara', glyph: '✚' },
  perks: { title: 'Perks', npc: null, glyph: '★' },
  board: { title: 'Mission board', npc: 'ozzy', glyph: '⌖' },
};

const CATEGORY_NAMES = {
  pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper', special: 'Special', heavy: 'Heavy', explosive: 'Explosive', melee: 'Melee',
};

const NEUTRAL = { ...perkEffects({}) };

function statRows(id, tier) {
  const base = WEAPONS[id];
  const w = deriveWeapon(base, tier, NEUTRAL);
  const dmg = w.damage * (w.pellets || 1);
  return [
    ['Damage', `${Math.round(dmg)}${w.pellets > 1 ? ` (${w.pellets}×${Math.round(w.damage)})` : ''}`, dmg],
    ['Fire rate', `${(w.rate).toFixed(1)}/s`, w.rate],
    ['Magazine', String(w.mag), w.mag],
    ['Reload', `${w.reload.toFixed(2)}s`, -w.reload],
    ['Spread', w.spread > 0 ? `${(w.spread * 57.3).toFixed(1)}°` : 'none', -w.spread],
  ];
}

/**
 * @param {{ root: HTMLElement, ctx: object, audio: object, deps: object, getSession: () => object, onClose?: Function }} o
 */
export function createPanels({ root, ctx, audio, deps, getSession, onClose }) {
  const layer = h('div.st-panel-layer', { hidden: true });
  root.appendChild(layer);
  let kind = null;
  const sel = { weapon: null, tab: 'upgrade', slot: 0, mission: null, perk: null };

  const story = () => {
    const s = getSession();
    return s && s.story ? s.story : null;
  };

  /** One line of station flavour per opening (the same line while the panel re-renders). */
  const flavour = new Map();
  function pickFlavour(k, world) {
    const raw = stationLine(k, Math.random());
    const text = raw ? expandTokens(raw, sceneContext(world)) : '';
    flavour.set(k, text);
    return text;
  }

  function close() {
    if (!kind) return;
    flavour.delete(kind);
    kind = null;
    layer.hidden = true;
    layer.replaceChildren();
    if (onClose) onClose();
  }

  function open(k) {
    if (!TITLES[k] || !story()) return false;
    kind = k;
    layer.hidden = false;
    render();
    audio.ui('click');
    requestAnimationFrame(() => {
      const first = layer.querySelector('.st-modal [data-autofocus], .st-modal .btn-primary:not([disabled]), .st-modal button:not([disabled])');
      if (first) first.focus({ preventScroll: true });
    });
    return true;
  }

  function shell(k, body, extra = []) {
    const st = story();
    const t = TITLES[k];
    // whoever tends the station in this world (the content's cast says who, and when they arrive)
    const keeper = t.npc ? stationKeeper(k, st.world) : null;
    const cast = keeper === undefined ? (t.npc ? castOf(t.npc) : null) : keeper ? castOf(keeper) : null;
    const line = t.npc && (flavour.get(k) || pickFlavour(k, st.world));
    const canvas = cast ? h('canvas.st-npc', { width: 120, height: 120, 'aria-hidden': 'true' }) : null;
    if (canvas) drawCastPortrait(canvas, cast.id, deps);
    const head = h('header.st-modal-head', null, [
      canvas,
      h('div.st-modal-titles', null, [
        h('h2.st-modal-title', { id: 'st-modal-title' }, [h('span.st-glyph', { text: t.glyph, 'aria-hidden': 'true' }), t.title]),
        cast ? h('div.st-modal-sub', { text: cast.name }) : h('div.st-modal-sub', { text: st.profile.name }),
        line ? h('div.st-modal-flavor', { text: `“${line}”` }) : null,
      ]),
      h('div.st-modal-chips', null, extra),
      h('button.btn.btn-icon.st-close', { type: 'button', 'aria-label': 'Close', text: '✕', onclick: close }),
    ]);
    return h('div.st-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'st-modal-title', dataset: { panel: k } }, [head, h('div.st-modal-body', null, body)]);
  }

  function scrapChips(profile, world) {
    const out = [chip('SCRAP', num(profile.scrap), 'scrap')];
    if (world) {
      out.push(chip('STASH', num(world.hideout.stash.scrap), 'stash'));
      out.push(chip('PARTS', num(world.hideout.stash.parts), 'parts'));
    }
    return out;
  }

  // ------------------------------------------------------------------ workbench

  function ownedGuns(profile) {
    return WEAPON_IDS.filter((id) => profile.weapons[id]).sort((a, b) => WEAPONS[a].price - WEAPONS[b].price);
  }

  function workbench() {
    const st = story();
    const { profile, world } = st;
    const chapter = currentChapter(world, getMissions());
    const bench = hideoutEffects(world.hideout.upgrades).bench;
    const owned = ownedGuns(profile);
    if (!sel.weapon || !profile.weapons[sel.weapon]) sel.weapon = owned.includes(profile.loadout[1]) ? profile.loadout[1] : owned[0];
    const tabs = h('div.st-tabs', { role: 'tablist' }, [
      tab('upgrade', 'Upgrade guns'),
      tab('buy', 'Buy guns'),
    ]);
    function tab(id, label) {
      return h('button.st-tab', {
        type: 'button', role: 'tab', 'aria-selected': sel.tab === id ? 'true' : 'false', dataset: { tab: id },
        onclick: () => {
          sel.tab = id;
          render();
        },
      }, label);
    }
    let body;
    if (sel.tab === 'buy') {
      const cards = WEAPON_IDS.filter((id) => !profile.weapons[id] && WEAPONS[id].price > 0)
        .sort((a, b) => weaponScrapCost(a) - weaponScrapCost(b))
        .map((id) => {
          const can = canBuyWeapon(profile, id, chapter);
          const ch = weaponChapter(id);
          const w = WEAPONS[id];
          const btn = h('button.btn.btn-small' + (can.ok ? '.btn-primary' : ''), {
            type: 'button', disabled: !can.ok, dataset: { act: 'buygun', weapon: id },
            title: can.ok ? '' : can.reason === 'locked' ? `Available in chapter ${ch}` : reasonText(can.reason),
            onclick: () => st.buyWeapon(id),
          }, can.reason === 'locked' ? `Chapter ${ch}` : `Buy · ${weaponScrapCost(id)}`);
          return h('div.st-card-gun' + (can.reason === 'locked' ? '.locked' : ''), { dataset: { weapon: id } }, [
            weaponIcon(id, 92),
            h('div.st-card-gun-name', { text: w.name }),
            h('div.st-card-gun-cat', { text: CATEGORY_NAMES[w.category] || w.category }),
            btn,
          ]);
        });
      body = h('div.st-gun-grid', null, cards.length ? cards : h('p.st-empty', { text: 'You own every gun. Nice.' }));
    } else {
      const list = h('div.st-gun-list', { role: 'listbox', 'aria-label': 'Your guns' }, owned.map((id) => {
        const w = WEAPONS[id];
        const tier = profile.weapons[id].tier;
        return h('button.st-gun-row' + (id === sel.weapon ? '.on' : ''), {
          type: 'button', role: 'option', 'aria-selected': id === sel.weapon ? 'true' : 'false', dataset: { weapon: id },
          onclick: () => {
            sel.weapon = id;
            audio.ui('click');
            render();
          },
        }, [weaponIcon(id, 64), h('span.st-gun-name', { text: w.name }), pips(tier, MAX_TIER, 'tier')]);
      }));
      const id = sel.weapon;
      const cur = profile.weapons[id].tier;
      const can = canUpgradeWeapon(profile, id, bench);
      const rowsNow = statRows(id, cur);
      const rowsNext = cur < MAX_TIER ? statRows(id, cur + 1) : null;
      const stats = h('table.st-stats', null, rowsNow.map((r, i) => {
        const better = rowsNext && rowsNext[i][2] !== r[2];
        return h('tr', null, [
          h('th', { text: r[0] }),
          h('td', { text: r[1] }),
          h('td.next' + (better ? '.up' : ''), { text: rowsNext ? `→ ${rowsNext[i][1]}` : 'max' }),
        ]);
      }));
      const cost = can.cost || Math.round(tierCost(id, Math.min(MAX_TIER, cur + 1)) * bench);
      const upBtn = h('button.btn.btn-big' + (can.ok ? '.btn-primary' : ''), {
        type: 'button', disabled: !can.ok, dataset: { act: 'upgrade', weapon: id, autofocus: '' },
        onclick: () => st.upgradeWeapon(id),
      }, [
        h('span.btn-title', { text: cur >= MAX_TIER ? 'Fully upgraded' : `Upgrade to tier ${cur + 1}` }),
        cur >= MAX_TIER ? null : h('span.btn-sub', { text: can.ok ? `${cost} scrap` : `${cost} scrap — ${reasonText(can.reason)}` }),
      ]);
      const te = tierEffect(Math.min(MAX_TIER, cur + 1));
      const detail = h('div.st-gun-detail', null, [
        h('div.st-gun-hero', null, [weaponIcon(id, 150), h('div', null, [h('h3', { text: WEAPONS[id].name }), h('div.st-sub', { text: CATEGORY_NAMES[WEAPONS[id].category] || '' }), pips(cur, MAX_TIER, 'tier big')])]),
        stats,
        cur < MAX_TIER ? h('p.st-note', { text: `Each tier: +7% damage, +3% fire rate, -4% reload time, -6% spread, and about ${Math.round(te.mag / Math.min(MAX_TIER, cur + 1) * 100)}% more magazine.` }) : null,
        upBtn,
        bench < 1 ? h('p.st-note.good', { text: `Generator: upgrades cost ${Math.round((1 - bench) * 100)}% less.` }) : null,
      ]);
      body = h('div.st-split', null, [list, detail]);
    }
    return shell('workbench', [tabs, body], scrapChips(profile));
  }

  // ------------------------------------------------------------------ armory

  function armory() {
    const st = story();
    const { profile, world } = st;
    const owned = ownedGuns(profile);
    const lo = profile.loadout.slice();
    const slots = h('div.st-slots', { role: 'radiogroup', 'aria-label': 'Loadout slots' }, [0, 1, 2].map((i) => {
      const id = lo[i];
      return h('button.st-slot' + (sel.slot === i ? '.on' : ''), {
        type: 'button', role: 'radio', 'aria-checked': sel.slot === i ? 'true' : 'false', dataset: { slot: String(i) },
        onclick: () => {
          sel.slot = i;
          audio.ui('click');
          render();
        },
      }, [
        h('span.st-slot-n', { text: String(i + 1) }),
        id ? weaponIcon(id, 84) : h('span.st-slot-empty', { text: i === 0 ? 'Required' : 'Empty' }),
        h('span.st-slot-name', { text: id ? WEAPONS[id].name : '' }),
        id ? pips(profile.weapons[id].tier, MAX_TIER, 'tier') : null,
      ]);
    }));
    function assign(id) {
      const next = lo.map((x) => (x === id ? null : x));
      next[sel.slot] = id;
      if (!next[0]) {
        // slot 1 must stay filled: the first free gun moves up
        const j = next.findIndex(Boolean);
        if (j > 0) {
          next[0] = next[j];
          next[j] = null;
        }
      }
      st.setLoadout(next);
    }
    const pick = h('div.st-gun-grid.small', { role: 'listbox', 'aria-label': `Guns for slot ${sel.slot + 1}` }, owned.map((id) => {
      const w = WEAPONS[id];
      return h('button.st-card-gun' + (lo[sel.slot] === id ? '.on' : ''), {
        type: 'button', role: 'option', 'aria-selected': lo[sel.slot] === id ? 'true' : 'false', dataset: { weapon: id },
        onclick: () => assign(id),
      }, [weaponIcon(id, 74), h('div.st-card-gun-name', { text: w.name }), pips(profile.weapons[id].tier, MAX_TIER, 'tier')]);
    }));
    const clear = sel.slot > 0 && lo[sel.slot]
      ? h('button.btn.btn-small', { type: 'button', text: 'Empty this slot', onclick: () => st.setLoadout(lo.map((x, i) => (i === sel.slot ? null : x))) })
      : null;
    // the gun finish: cosmetic, the same choice as the lobby's (prefs.skin, the roster's `skin`)
    const cur = sanitizeSkin(ctx && ctx.prefs ? ctx.prefs.skin : null);
    const skins = h('div.st-skins', { role: 'radiogroup', 'aria-label': 'Gun finish' }, GUN_SKINS.map((sk) => h('button.st-skin', {
      type: 'button', role: 'radio', 'aria-checked': sk.id === cur ? 'true' : 'false', title: sk.desc, dataset: { skin: sk.id },
      onclick: () => {
        audio.ui('click');
        if (ctx && ctx.prefs) { ctx.prefs.skin = sk.id; if (ctx.savePrefs) ctx.savePrefs(); }
        const ses = getSession && getSession();
        if (ses && ses.setProfile) ses.setProfile({ skin: sk.id });
        render();
      },
    }, [h('span.gun-skin-chip', { style: { background: `linear-gradient(135deg, ${sk.swatch[0]} 0 38%, ${sk.swatch[1]} 38% 70%, ${sk.swatch[2]} 70%)` } }), h('span', { text: sk.name })])));
    const left = h('section.st-col', null, [h('h3.st-h', { text: 'Loadout' }), slots, h('p.st-note', { text: `Choose what goes in slot ${sel.slot + 1}.` }), pick, clear,
      h('h3.st-h', { text: 'Gun finish' }), h('p.st-note', { text: 'Cosmetic: how your guns look, to you and your crew.' }), skins]);

    const stash = world.hideout.stash;
    const rows = KIT_IDS.map((k) => {
      const item = KIT_ITEMS[k];
      const have = profile.kit[k] || 0;
      const inStash = stash[k] | 0;
      return h('div.st-kit-row', { dataset: { kit: k } }, [
        h('div.st-kit-name', null, [h('b', { text: item.name }), h('span.st-sub', { text: `carry up to ${item.max}` })]),
        h('div.st-kit-stepper', null, [
          h('button.btn.btn-icon', { type: 'button', text: '−', 'aria-label': `Put back ${item.name}`, disabled: have <= 0, dataset: { act: 'put' }, onclick: () => st.takeKit(k, -1) }),
          h('span.st-kit-n', { text: `${have}`, title: 'Carried into the next mission' }),
          h('button.btn.btn-icon', { type: 'button', text: '+', 'aria-label': `Take ${item.name}`, disabled: have >= item.max || inStash <= 0, dataset: { act: 'take' }, onclick: () => st.takeKit(k, 1) }),
        ]),
        h('div.st-kit-stash', { text: `${inStash} in stash` }),
        h('button.btn.btn-small', {
          type: 'button', disabled: (profile.scrap | 0) < item.scrap, dataset: { act: 'buykit' }, title: 'Buy one into the stash',
          onclick: () => st.buyKit(k),
        }, `Buy · ${item.scrap}`),
      ]);
    });
    const right = h('section.st-col', null, [
      h('h3.st-h', { text: 'Supplies' }),
      h('p.st-note', { text: 'What you carry is used up when a mission is won. A lost mission gives it back.' }),
      h('div.st-kit', null, rows),
    ]);
    return shell('armory', [h('div.st-split.even', null, [left, right])], scrapChips(profile, world));
  }

  // ------------------------------------------------------------------ upgrade board

  function upgrades() {
    const st = story();
    const { profile, world } = st;
    const chapter = currentChapter(world, getMissions());
    const stash = world.hideout.stash;
    const cards = HIDEOUT_IDS.map((id) => {
      const u = HIDEOUT_UPGRADES[id];
      const tier = upgradeTier(world.hideout.upgrades, id);
      const can = canUpgradeHideout(world, id, chapter);
      const next = tier < HIDEOUT_TIERS ? u.tiers[tier] : null;
      const cur = tier > 0 ? u.tiers[tier - 1] : null;
      let btnText = 'Fully built';
      if (next) btnText = can.ok ? `Build tier ${tier + 1}` : can.reason === 'chapter' ? `Chapter ${can.need}` : can.reason === 'parts' ? 'Needs parts' : 'Needs scrap';
      return h('article.st-upgrade' + (tier >= HIDEOUT_TIERS ? '.done' : ''), { dataset: { upgrade: id, tier: String(tier) } }, [
        h('header', null, [h('h3', { text: u.name }), pips(tier, HIDEOUT_TIERS, 'tier')]),
        h('p.st-sub', { text: u.desc }),
        cur ? h('p.st-now', null, [h('b', { text: 'Now: ' }), cur.text]) : h('p.st-now.dim', { text: 'Not built yet.' }),
        next ? h('p.st-next', null, [h('b', { text: 'Next: ' }), next.text]) : null,
        next ? h('div.st-cost', null, [chip('SCRAP', next.cost.scrap, stash.scrap >= next.cost.scrap ? 'ok' : 'no'), chip('PARTS', next.cost.parts, stash.parts >= next.cost.parts ? 'ok' : 'no')]) : null,
        h('button.btn' + (can.ok ? '.btn-primary' : ''), {
          type: 'button', disabled: !can.ok, dataset: { act: 'hideout', upgrade: id }, onclick: () => st.upgradeHideout(id),
          title: next && !can.ok ? (can.reason === 'chapter' ? `Needs chapter ${HIDEOUT_TIER_CHAPTER[tier]}` : reasonText(can.reason)) : '',
        }, btnText),
      ]);
    });
    const donate = h('div.st-donate', null, [
      h('span', { text: 'Your scrap builds the hideout too:' }),
      ...[25, 100].map((n) => h('button.btn.btn-small', { type: 'button', disabled: (profile.scrap | 0) < n, dataset: { act: 'donate', n: String(n) }, onclick: () => st.donate(n) }, `Give ${n}`)),
    ]);
    return shell('upgrades', [h('div.st-upgrades', null, cards), donate], scrapChips(profile, world));
  }

  // ------------------------------------------------------------------ infirmary

  function infirmary() {
    const st = story();
    const { profile, world } = st;
    const chapter = currentChapter(world, getMissions());
    const hf = hideoutEffects(world.hideout.upgrades);
    const inHideout = st.stage === 'hideout' || st.stage === 'briefing';
    const spent = perkPointsSpent(profile.perks);
    const free = profile.perkReset !== chapter;
    const heal = h('div.st-service', null, [
      h('h3.st-h', { text: 'Patch up' }),
      h('p.st-note', { text: 'Mara will see to your wounds. Free.' }),
      h('button.btn.btn-primary', { type: 'button', disabled: !inHideout, dataset: { act: 'heal', autofocus: '' }, onclick: () => st.heal() }, 'Heal me'),
    ]);
    const reset = h('div.st-service', null, [
      h('h3.st-h', { text: 'Re-learn your perks' }),
      h('p.st-note', { text: spent ? `Take back all ${spent} spent perk points. ${free ? 'Free this chapter.' : `Costs ${PERK_RESET_COST} scrap after the first time in a chapter.`}` : 'You have not spent any perk points.' }),
      h('button.btn', { type: 'button', disabled: !spent || (!free && (profile.scrap | 0) < PERK_RESET_COST), dataset: { act: 'reset' }, onclick: () => st.resetPerks() }, free ? 'Reset perks (free)' : `Reset perks (${PERK_RESET_COST} scrap)`),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => open('perks') }, 'Open the perk tree'),
    ]);
    const tier = upgradeTier(world.hideout.upgrades, 'infirmary');
    const bonus = h('p.st-note.good', { text: tier ? `Infirmary tier ${tier}: you start missions with ${hf.armor} armour and revive ${Math.round((hf.reviveSpeed - 1) * 100)}% faster.` : 'Build the infirmary at the upgrade board for armour at the start of every mission.' });
    return shell('infirmary', [h('div.st-split.even', null, [heal, reset]), bonus], scrapChips(profile));
  }

  // ------------------------------------------------------------------ perks

  function perks() {
    const st = story();
    const { profile } = st;
    const bar = xpStrip(profile);
    const head = h('div.st-perk-head', null, [
      bar.el,
      chip('PERK POINTS', profile.perkPoints, profile.perkPoints > 0 ? 'ok' : ''),
      chip('LEVEL', profile.level),
    ]);
    const cards = PERK_IDS.map((id) => {
      const p = PERKS[id];
      const rank = profile.perks[id] || 0;
      const can = canBuyPerk(profile, id);
      const nextText = rank < MAX_RANK ? p.ranks[rank].text : null;
      const label = rank >= MAX_RANK ? 'Mastered' : can.ok ? `Take rank ${rank + 1}` : can.reason === 'level' ? `Level ${RANK_LEVELS[rank]}` : 'No points';
      return h('article.st-perk' + (rank ? '.has' : '') + (rank >= MAX_RANK ? '.max' : ''), { dataset: { perk: id, rank: String(rank) } }, [
        h('header', null, [h('span.st-perk-icon', { text: p.icon, 'aria-hidden': 'true' }), h('h3', { text: p.name }), pips(rank, MAX_RANK, 'tier')]),
        h('p.st-sub', { text: p.desc }),
        rank ? h('p.st-now', null, [h('b', { text: 'Now: ' }), p.ranks[rank - 1].text]) : null,
        nextText ? h('p.st-next', null, [h('b', { text: 'Next: ' }), nextText]) : null,
        h('button.btn.btn-small' + (can.ok ? '.btn-primary' : ''), {
          type: 'button', disabled: !can.ok, dataset: { act: 'perk', perk: id }, onclick: () => st.buyPerk(id),
          title: can.ok ? '' : reasonText(can.reason),
        }, label),
      ]);
    });
    const stats = profile.stats;
    const foot = h('p.st-note', { text: `${num(stats.kills)} kills · ${stats.missions} missions · ${stats.revives} revives · ${stats.deaths} downs` });
    return shell('perks', [head, h('div.st-perks', null, cards), foot], []);
  }

  // ------------------------------------------------------------------ mission board

  function board() {
    const st = story();
    const { profile, world } = st;
    const missions = getMissions();
    const entries = missionBoard(world, missions);
    // the road (the story's missions) and the side jobs (`side: true`, JOURNEY.md §2): two lists
    const road = entries.filter((e) => !e.mission.side);
    const jobs = entries.filter((e) => e.mission.side);
    const nextOpen = road.find((e) => e.status !== 'done' && e.status !== 'locked') || jobs.find((e) => e.status === 'available');
    if (!sel.mission || !entries.some((e) => e.mission.id === sel.mission && e.status !== 'locked')) sel.mission = (nextOpen || entries[0] || {}).mission ? (nextOpen || entries[0]).mission.id : null;
    const row = (e, label) => {
      const m = e.mission;
      return h('button.st-mission-row.' + e.status + (m.side ? '.side' : '') + (m.id === sel.mission ? '.on' : ''), {
        type: 'button', role: 'option', disabled: e.status === 'locked', dataset: { mission: m.id, status: e.status, side: m.side ? '1' : '0' },
        'aria-selected': m.id === sel.mission ? 'true' : 'false',
        onclick: () => {
          sel.mission = m.id;
          audio.ui('click');
          render();
        },
      }, [
        h('span.st-mission-id', { text: label }),
        h('span.st-mission-title', { text: m.title }),
        e.status === 'done' ? h('span.st-stars', { text: '★'.repeat(e.stars) + '☆'.repeat(3 - e.stars), 'aria-label': `${e.stars} stars` }) : e.status === 'locked' ? h('span.st-lock', { text: '🔒', 'aria-label': 'locked' }) : h('span.st-new', { text: m.side ? 'JOB' : 'NEW' }),
      ]);
    };
    const group = (list, key) => {
      const by = new Map();
      for (const e of list) {
        const k = key(e.mission);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(e);
      }
      return by;
    };
    const list = h('div.st-missions', { role: 'listbox', 'aria-label': 'Missions' });
    for (const [ch, grp] of group(road, (m) => m.chapter)) {
      list.appendChild(h('div.st-chapter', { text: `Chapter ${ch} — ${chapterTitle(ch)}` }));
      for (const e of grp) list.appendChild(row(e, `${e.mission.chapter}.${e.mission.index}`));
    }
    // the side jobs: optional, replayable, grouped by the story chapter they belong to; the locked ones stay hidden
    // until the road reaches them (a board full of padlocks is a spoiler)
    const shown = jobs.filter((e) => e.status !== 'locked');
    list.appendChild(h('div.st-chapter.st-side-head', { text: `Side jobs — ${shown.filter((e) => e.status === 'done').length} of ${jobs.length} done` }));
    if (!shown.length) list.appendChild(h('p.st-note', { text: 'Jobs from the radio and the rumor mill show up here once the crew has a hideout. They are optional, and they pay.' }));
    for (const [ch, grp] of group(shown, (m) => m.opens || m.chapter)) {
      list.appendChild(h('div.st-chapter.st-side-chapter', { text: `From chapter ${ch} · ${chapterTitle(ch)}` }));
      for (const e of grp) list.appendChild(row(e, `S${e.mission.index}`));
    }
    const locked = jobs.length - shown.length;
    if (locked > 0 && shown.length) list.appendChild(h('p.st-note', { text: `${locked} more job${locked === 1 ? '' : 's'} further down the road.` }));
    const m = missions.find((q) => q.id === sel.mission);
    const roster = getSession().roster;
    let detail;
    if (!m) {
      detail = h('p.st-empty', { text: 'No missions yet.' });
    } else {
      const entry = entries.find((e) => e.mission.id === m.id);
      const map = mapMeta(m.map);
      const rw = m.rewards || {};
      const lv = Array.isArray(m.level) ? m.level : [1, 1];
      const under = profile.level < lv[0];
      const isHost = st.isHost;
      const go = h('button.btn.btn-big' + (isHost ? '.btn-primary' : ''), {
        type: 'button', disabled: !isHost || entry.status === 'locked', dataset: { act: 'brief', mission: m.id, autofocus: '' },
        onclick: () => {
          st.pickMission(m.id);
          close();
        },
      }, [
        h('span.btn-title', { text: isHost ? (entry.status === 'done' ? (m.side ? 'Take the job again' : 'Replay this mission') : m.side ? 'Take the job' : 'Brief the crew') : 'Waiting for the host' }),
        h('span.btn-sub', { text: isHost ? 'Everyone confirms in the briefing before you deploy' : 'The host picks the mission at the board' }),
      ]);
      detail = h('div.st-mission-detail', null, [
        h('div.st-mission-map', null, [h('span.st-tag', { text: map ? map.name : m.map }), h('span.st-tag', { text: m.time === 'day' ? 'Day' : 'Night' }), m.mode ? h('span.st-tag', { text: m.mode }) : null]),
        h('h3', { text: m.title }),
        m.side ? h('p.st-note.good', { text: `Side job from chapter ${m.opens} · ${chapterTitle(m.opens)}. Optional and replayable: the road waits for you.` }) : null,
        h('p.st-blurb', { text: m.blurb || '' }),
        h('div.st-mission-facts', null, [
          chip('RECOMMENDED', `Lv ${lv[0]}–${lv[1]}`, under ? 'no' : 'ok'),
          chip('CREW', `${(m.party && m.party.min) || 1}–${(m.party && m.party.max) || 6}`),
          chip('YOUR LEVEL', profile.level, under ? 'no' : ''),
        ]),
        h('h4.st-h', { text: entry.status === 'done' ? 'Rewards (replays pay half)' : 'Rewards' }),
        h('div.st-mission-rewards', null, [
          rw.xp ? chip('XP', rw.xp) : null,
          rw.scrap ? chip('SCRAP', rw.scrap) : null,
          rw.upgradePoints ? chip('PARTS', rw.upgradePoints) : null,
          rw.weapon && WEAPONS[rw.weapon] ? chip('GUN', WEAPONS[rw.weapon].name) : null,
        ]),
        h('div.st-crew', null, [h('span.st-sub', { text: 'Crew: ' }), ...roster.map((r) => h('span.st-crew-name', { text: r.name + (r.bot ? ' (AI)' : '') }))]),
        go,
      ]);
    }
    const s = worldSummary(world, missions);
    const doneOf = (l) => l.filter((e) => e.status === 'done').length;
    const starsOf = (l) => l.reduce((a, e) => a + (e.status === 'done' ? e.stars : 0), 0);
    return shell('board', [h('div.st-split', null, [list, detail])], [
      chip('CHAPTER', `${s.chapter} · ${s.chapterTitle}`), chip('ROAD', `${doneOf(road)}/${road.length}`), chip('SIDE JOBS', `${doneOf(jobs)}/${jobs.length}`),
      chip('STARS', `${starsOf(entries)}/${entries.length * 3}`),
    ]);
  }

  const RENDER = { workbench, armory, upgrades, infirmary, perks, board };

  function render() {
    if (!kind || !story()) return;
    // keep scroll positions across re-renders (a purchase must not throw you to the top)
    const scrolls = [...layer.querySelectorAll('.st-modal-body, .st-gun-list, .st-missions, .st-perks, .st-upgrades, .st-gun-grid')].map((e) => e.scrollTop);
    const focusSel = document.activeElement && layer.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    layer.replaceChildren(h('div.st-modal-back', { onclick: (e) => e.target === e.currentTarget && close() }, RENDER[kind]()));
    [...layer.querySelectorAll('.st-modal-body, .st-gun-list, .st-missions, .st-perks, .st-upgrades, .st-gun-grid')].forEach((e, i) => {
      if (scrolls[i]) e.scrollTop = scrolls[i];
    });
    if (focusSel) {
      const again = layer.querySelector(focusSel);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }

  function focusKey(el) {
    const d = el.dataset || {};
    if (d.act) {
      const extra = d.weapon ? `[data-weapon="${d.weapon}"]` : d.perk ? `[data-perk="${d.perk}"]` : d.upgrade ? `[data-upgrade="${d.upgrade}"]` : d.n ? `[data-n="${d.n}"]` : '';
      const kit = el.closest('[data-kit]');
      return kit ? `[data-kit="${kit.dataset.kit}"] [data-act="${d.act}"]` : `[data-act="${d.act}"]${extra}`;
    }
    if (d.weapon) return `.st-gun-row[data-weapon="${d.weapon}"]`;
    if (d.mission) return `[data-mission="${d.mission}"]`;
    if (d.tab) return `[data-tab="${d.tab}"]`;
    if (d.slot) return `[data-slot="${d.slot}"]`;
    return null;
  }

  return {
    open,
    close,
    refresh: render,
    get isOpen() {
      return !!kind;
    },
    get kind() {
      return kind;
    },
    escape() {
      if (!kind) return false;
      close();
      return true;
    },
    /** Gamepad edges: the D-pad moves focus, A presses, B closes, bumpers switch tabs. */
    nav(n) {
      if (!kind || !n) return;
      if (n.back) {
        close();
        return;
      }
      if ((n.tabPrev || n.tabNext) && layer.querySelector('.st-tab')) {
        const tabs = [...layer.querySelectorAll('.st-tab')];
        const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
        const j = (i + (n.tabNext ? 1 : -1) + tabs.length) % tabs.length;
        tabs[j].click();
        return;
      }
      padNavigate(layer, n);
    },
    destroy() {
      close();
      layer.remove();
    },
  };
}

export { xpBar, HIDEOUT_NAMES };
