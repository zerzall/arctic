// In-game HUD (SPEC §7.3): a DOM overlay over the canvas. Built once per match; update()
// runs every frame but only writes to the DOM when a displayed value actually changed
// (see dom.js setters), so a quiet frame costs a few comparisons.
//
// First-person view (SPEC §7.5): the renderer's overlay draws the crosshair, hit markers
// and name tags, so the HUD adds none of those. It adds a compass strip at the top centre,
// turns the minimap into a rotating radar (up = facing; toggle in the settings) and moves
// the interaction prompt just below the crosshair (CSS: #hud[data-view='fps']).

import {
  PLAYER_COLORS, ARMOR_MAX, STAMINA_MAX, BLEEDOUT_TIME, REVIVE_RADIUS, INTERACT_RADIUS, SUPPLY_RADIUS,
  FRAG_MAX, MOLOTOV_MAX,
} from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { ZOMBIES } from '../shared/zombies.js';
import { perksFor } from '../shared/classes.js';
import { PICKUPS } from '../shared/items.js';
import { h, setText, setStyle, setClass, setShown, formatCash, fitCanvas } from './dom.js';
import { statsLine } from './gfx.js';
import { createMinimap } from './minimap.js';
import { createCompass } from './compass.js';
import { createScoreboard } from './scoreboard.js';
import { priceOf, itemName, shopState } from './shop.js';
import { activeWeapon } from '../shared/sim/players.js';
import { createCollisionWorld, ledgeAhead } from '../shared/movement.js';
import { nearSupply } from '../shared/zone.js';
import { createZoneHud } from './zonehud.js';
import { createCampaignHud } from './campaignhud.js';
import { createStoryHud } from './storyhud.js';

/** Key names shown in prompts, per input mode. */
export const KEY_LABELS = {
  kbm: { interact: 'E', shop: 'B', ready: 'N', jump: 'SPACE', frag: 'G', molotov: 'F', turret: 'T', barricade: 'C', reload: 'R', scoreboard: 'TAB' },
  pad: { interact: 'RB', shop: 'R3', ready: '◀', jump: 'A', frag: 'LB', molotov: 'B', turret: '▲', barricade: '▼', reload: 'X', scoreboard: 'BACK' },
  touch: { interact: 'USE', shop: 'SHOP', ready: 'READY', jump: 'JUMP', frag: 'FRAG', molotov: 'MOLO', turret: 'TURRET', barricade: 'WALL', reload: 'RELOAD', scoreboard: 'SCORES' },
};

const COMMON_ZOMBIES = new Set(['walker', 'runner', 'crawler']);
const FEED_MAX = 5;
const FEED_LIFE = 4.5;
const FEED_MERGE = 2;
const TOAST_MAX = 4;
const LOW_HP = 0.3;
/** Touch layout: re-measure the HUD columns this often (s), keep this gap (px) below them. */
const TOUCH_LAYOUT_EVERY = 0.2;
const TOUCH_GAP = 6;
const TOUCH_VARS = ['--hud-col-top', '--touch-util-top', '--touch-gear-top'];

function bar(cls) {
  const fill = h('i.bar-fill');
  const ghost = h('i.bar-ghost');
  const el = h(`div.bar.${cls}`, null, [ghost, fill]);
  return { el, fill, ghost };
}

function pct(v) {
  return `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
}

/**
 * @param {HTMLElement} root the #hud container (emptied and owned by the HUD for the match)
 * @param {object} opts
 * @param {object} opts.map MapDef
 * @param {Function} opts.renderClassPortrait (canvas, classId, colorIndex)
 * @param {object} opts.audio
 * @param {{ code: string, onCopy: Function }|null} [opts.invite] online games: room code and
 *   invite-link copy in the scoreboard header
 * @param {'fps'|'topdown'} [opts.view] first person adds the compass and the radar minimap
 * @param {boolean} [opts.minimapRotate] first person: rotating radar (default true)
 * @param {'defend'|'zone'|'campaign'} [opts.mode] the wave machine behind the game (zone / campaign panels)
 * @param {{ title?: string }|null} [opts.story] Road to Haven (STORY.md): a mission or hideout — adds the
 *   objective tracker, radio strip and story prompts (ui/storyhud.js)
 */
export function createHud(root, { map, renderClassPortrait, audio, invite = null, view = 'topdown', minimapRotate = true, mode = 'defend', story = null }) {
  root.replaceChildren();
  root.hidden = false;
  const fps = view === 'fps';
  root.dataset.view = fps ? 'fps' : 'topdown';

  // ---- build DOM -----------------------------------------------------------------------

  // wave / phase (top-left)
  const waveLabel = h('span.wave-label', { text: 'WAVE' });
  const waveNum = h('span.wave-num');
  const waveTotal = h('span.wave-total');
  const waveLeft = h('div.wave-left');
  const phaseLine = h('div.phase-line');
  const wavePanel = h('div.hud-wave.hud-box', null, [
    h('div.wave-line', null, [waveLabel, waveNum, waveTotal]),
    waveLeft,
    phaseLine,
  ]);
  const objBar = bar('obj');
  const objPct = h('span.obj-pct');
  const objPanel = h('div.hud-objective.hud-box', null, [
    h('div.obj-head', null, [h('span.obj-name', { text: (map.objective && map.objective.name) || 'Objective' }), objPct]),
    objBar.el,
  ]);
  const team = h('div.hud-team');
  const topLeft = h('div.hud-top-left', null, [wavePanel, objPanel, team]);

  // boss + notices (top-centre)
  const bossBar = bar('boss');
  const bossPanel = h('div.hud-boss', { hidden: true }, [
    h('div.boss-name', { text: ZOMBIES.boss.name.toUpperCase() }),
    bossBar.el,
  ]);
  const bannerTitle = h('div.banner-title');
  const bannerSub = h('div.banner-sub');
  const banner = h('div.hud-banner', { hidden: true, role: 'status' }, [bannerTitle, bannerSub]);
  const toasts = h('div.hud-toasts', { role: 'status', 'aria-live': 'polite' });
  // first person: heading tape (the canvas is sized by CSS)
  const compassCanvas = h('canvas.compass-canvas', { 'aria-hidden': 'true' });
  const compassEl = h('div.hud-compass', { hidden: !fps }, compassCanvas);
  const topCentre = h('div.hud-top-centre', null, [compassEl, bossPanel, banner, toasts]);

  // minimap, net stats, kill feed (top-right)
  const miniCanvas = h('canvas.minimap-canvas', { 'aria-label': 'Minimap' });
  const netStats = h('div.hud-net', { hidden: true });
  const feed = h('div.killfeed');
  const topRight = h('div.hud-top-right', null, [h('div.minimap.hud-box', null, miniCanvas), netStats, feed]);

  // prompts (bottom-centre)
  const promptText = h('span.prompt-text');
  const promptBar = h('i');
  const promptProg = h('span.prompt-progress', { hidden: true }, promptBar);
  const prompt = h('div.hud-prompt', { hidden: true }, [promptText, promptProg]);
  const hint = h('div.hud-hint', { hidden: true });
  // First person: the prompt goes under the crosshair, the standing shop hint stays low.
  const bottomCentre = h('div.hud-bottom-centre', null, fps ? [prompt] : [prompt, hint]);
  const bottomHint = fps ? h('div.hud-bottom-hint', null, hint) : null;

  // vitals + cash (bottom-left)
  const portrait = h('canvas.vital-portrait', { width: 96, height: 96, 'aria-hidden': 'true' });
  const hpBar = bar('hp');
  const hpNum = h('span.hp-num');
  const armorBar = bar('armor');
  const stamBar = bar('stamina');
  const statusTag = h('span.vital-status');
  const cashEl = h('div.cash');
  const cashDelta = h('div.cash-delta');
  const kitTag = h('span.kit-tag', { hidden: true, text: 'SELF-REVIVE', title: 'Self-revive kit' });
  const vitals = h('div.hud-vitals.hud-box', null, [
    portrait,
    h('div.vital-bars', null, [
      h('div.vital-row', null, [hpBar.el, hpNum]),
      armorBar.el,
      stamBar.el,
      h('div.vital-foot', null, [statusTag, kitTag]),
    ]),
  ]);
  const bottomLeft = h('div.hud-bottom-left', null, [h('div.cash-wrap', null, [cashEl, cashDelta]), vitals]);

  // weapon (bottom-right)
  const wName = h('div.weapon-name');
  const wMag = h('span.ammo-mag');
  const wRes = h('span.ammo-res');
  const reloadBar = h('i');
  const reloadWrap = h('div.reload-bar', { hidden: true }, reloadBar);
  const wHint = h('div.weapon-hint');
  const slots = [];
  const slotWrap = h('div.slots');
  for (let i = 0; i < 3; i++) {
    const name = h('span.slot-name');
    const ammo = h('span.slot-ammo');
    const el = h('div.slot', null, [h('span.slot-key', { text: String(i + 1) }), name, ammo]);
    slots.push({ el, name, ammo });
    slotWrap.appendChild(el);
  }
  const equip = {};
  const equipWrap = h('div.equip');
  for (const [id, label] of [['frag', 'FRAG'], ['molotov', 'MOLO'], ['turret', 'TURRET'], ['barricade', 'WALL']]) {
    const key = h('kbd');
    const count = h('span.equip-count');
    const el = h('div.equip-item', { dataset: { id } }, [key, h('span.equip-label', { text: label }), count]);
    equip[id] = { el, key, count };
    equipWrap.appendChild(el);
  }
  const weaponBox = h('div.hud-weapon.hud-box', null, [
    h('div.weapon-top', null, [wName, h('div.ammo', null, [wMag, wRes])]),
    reloadWrap,
    wHint,
    slotWrap,
  ]);
  const bottomRight = h('div.hud-bottom-right', null, [equipWrap, weaponBox]);

  const spectate = h('div.hud-spectate', { hidden: true });

  root.append(topLeft, topCentre, topRight, bottomCentre, bottomLeft, bottomRight, spectate);
  if (bottomHint) root.append(bottomHint);

  // Mounted next to the HUD, above the touch layer, so the invite button can be tapped.
  const scoreboard = createScoreboard(root.parentElement || root, { invite });
  const zoneMode = mode === 'zone';
  const campMode = mode === 'campaign' && !!map.campaign;
  const storyMode = !!story;
  const minimap = createMinimap(miniCanvas, map, { radar: fps && minimapRotate, zone: zoneMode, campaign: campMode, story: storyMode });
  const compass = fps ? createCompass(compassCanvas, map, { zone: zoneMode, campaign: campMode, story: storyMode }) : null;
  // Evac Run: the zone panel under the compass, the outside warning (SPEC §3.7)
  const zoneHud = zoneMode ? createZoneHud(topCentre, root, { map, audio, showBanner: (...a) => showBanner(...a), toast: (...a) => toast(...a) }) : null;
  // The Campaign: the stage panel, the horde warning, the title card (SPEC §3.8)
  const campaignHud = campMode
    ? createCampaignHud(topCentre, root, { map, audio, showBanner: (...a) => showBanner(...a), toast: (...a) => toast(...a), nameOf: (id) => nameOf(id) })
    : null;

  // Road to Haven: the objective tracker, the radio strip, the story prompts
  const storyHud = storyMode
    ? createStoryHud(topCentre, root, { map, audio, showBanner: (...a) => showBanner(...a), toast: (...a) => toast(...a), nameOf: (id) => nameOf(id), promptEl: prompt, title: story.title || '' })
    : null;

  // ---- state -----------------------------------------------------------------------------

  let rosterById = new Map();
  let roster = [];
  let localId = 0;
  let lastView = null;
  let cashShown = null;
  let cashTarget = 0;
  let cashDeltaT = 0;
  let cashDeltaSum = 0;
  let portraitKey = '';
  let lastCountdown = -1;
  let bannerT = 0;
  const bannerQueue = [];
  const feedItems = [];
  let objFlashT = 0;
  let time = 0;
  const teamRows = new Map();
  let keys = KEY_LABELS.kbm;
  let keyMode = '';
  let touchLayoutT = 0;
  let statsAcc = 0;
  const touchVars = {};

  function nameOf(pid) {
    const r = rosterById.get(pid);
    return r ? r.name : pid ? `Player ${pid}` : 'Someone';
  }

  function colorOf(pid) {
    const r = rosterById.get(pid);
    return r ? PLAYER_COLORS[r.color] || '#fff' : '#fff';
  }

  function clsOf(pid) {
    const r = rosterById.get(pid);
    return r ? r.cls : 'soldier';
  }

  // ---- notices -----------------------------------------------------------------------------

  /** Big centre banner (wave start, wave cleared, boss). Queued so they don't overlap. */
  function showBanner(title, sub, tone = '', dur = 2.8) {
    bannerQueue.push({ title, sub, tone, dur });
    if (bannerQueue.length > 3) bannerQueue.shift();
  }

  function pumpBanner(dt) {
    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) {
        banner.classList.remove('show');
        banner.hidden = true;
      }
      return;
    }
    const b = bannerQueue.shift();
    if (!b) return;
    bannerTitle.textContent = b.title;
    bannerSub.textContent = b.sub || '';
    banner.className = `hud-banner ${b.tone}`;
    banner.hidden = false;
    void banner.offsetWidth;
    banner.classList.add('show');
    bannerT = b.dur;
  }

  /** Small stacked notice ("Sparks is down!", "You need $900 more"). */
  function toast(text, tone = '', dur = 3.2) {
    const el = h('div.toast', { class: tone || null, text });
    toasts.appendChild(el);
    while (toasts.children.length > TOAST_MAX) toasts.firstChild.remove();
    setTimeout(() => el.classList.add('out'), dur * 1000);
    setTimeout(() => el.remove(), dur * 1000 + 450);
  }

  function feedPush(killer, ztype, weapon, gib) {
    const now = time;
    const last = feedItems[feedItems.length - 1];
    if (last && last.killer === killer && last.ztype === ztype && last.weapon === weapon && now - last.t < FEED_MERGE) {
      last.count++;
      last.t = now;
      last.countEl.textContent = `×${last.count}`;
      last.el.classList.remove('bump');
      void last.el.offsetWidth;
      last.el.classList.add('bump');
      return;
    }
    const countEl = h('span.kf-count');
    const zname = ZOMBIES[ztype] ? ZOMBIES[ztype].name : ztype;
    const kids = [];
    if (killer) kids.push(h('span.kf-killer', { style: { color: colorOf(killer) }, text: nameOf(killer) }));
    else kids.push(h('span.kf-killer.env', { text: 'Turret' }));
    if (weapon) kids.push(h('span.kf-weapon', { text: weapon }));
    kids.push(h('span.kf-x', { text: gib ? '✸' : '✕' }));
    kids.push(h('span.kf-victim', { class: COMMON_ZOMBIES.has(ztype) ? null : 'special', text: zname }));
    kids.push(countEl);
    const el = h('div.kf-item', { class: killer === localId ? 'mine' : null }, kids);
    feed.appendChild(el);
    feedItems.push({ el, killer, ztype, weapon, t: now, born: now, count: 1, countEl });
    while (feedItems.length > FEED_MAX) feedItems.shift().el.remove();
  }

  function pumpFeed() {
    for (let i = feedItems.length - 1; i >= 0; i--) {
      const f = feedItems[i];
      const age = time - f.t;
      if (age > FEED_LIFE) {
        f.el.remove();
        feedItems.splice(i, 1);
      } else if (age > FEED_LIFE - 0.6) {
        f.el.classList.add('out');
      }
    }
  }

  function weaponShortOf(pid) {
    if (!lastView) return '';
    for (const p of lastView.players) {
      if (p.id !== pid) continue;
      const id = p.slots && p.slots[p.slot];
      return id && WEAPONS[id] ? WEAPONS[id].short : '';
    }
    return '';
  }

  function localPlayer(view) {
    if (!view) return null;
    for (const p of view.players) if (p.id === localId) return p;
    return null;
  }

  // ---- events ------------------------------------------------------------------------------

  function addEvents(events) {
    if (!events || !events.length) return;
    const me = localPlayer(lastView);
    for (const e of events) {
      if (zoneHud) zoneHud.addEvent(e);
      if (campaignHud && campaignHud.addEvent(e, lastView, localId)) continue;
      if (storyHud && storyHud.addEvent(e, lastView, localId)) continue;
      switch (e.type) {
        case 'zdie': {
          const common = COMMON_ZOMBIES.has(e.ztype);
          // Commons are merged per killer; specials always get their own line.
          if (!common || e.by || feedItems.length < FEED_MAX) feedPush(e.by | 0, e.ztype, e.by ? weaponShortOf(e.by) : '', !!e.gib);
          break;
        }
        case 'wave': {
          const total = lastView ? lastView.totalWaves : 0;
          const final = total && e.wave === total;
          if (e.boss) showBanner(`WAVE ${e.wave} — BOSS INCOMING`, final ? 'Final wave. Hold the line!' : 'Something big is coming…', 'danger', 3.4);
          else showBanner(`WAVE ${e.wave}`, final ? 'Final wave. Hold the line!' : 'Here they come', '', 2.6);
          break;
        }
        case 'waveclear':
          showBanner(`WAVE ${e.wave} CLEARED`, `+${formatCash(e.bonus || 0)} · shop open`, 'good', 3);
          break;
        case 'bossspawn':
          toast(`The ${ZOMBIES.boss.name} has arrived!`, 'danger', 3.5);
          break;
        case 'down':
          if (e.pid === localId) toast(me && me.selfRevive ? 'You\'re down! Self-revive kit kicking in…' : 'You\'re down! Crawl to a teammate', 'danger', 3.5);
          else toast(`${nameOf(e.pid)} is down!`, 'danger', 3.5);
          break;
        case 'revived':
          if (e.pid === localId) toast(e.by && e.by !== localId ? `${nameOf(e.by)} got you back up` : 'Back on your feet', 'good');
          else if (e.by === localId) toast(`You revived ${nameOf(e.pid)}`, 'good');
          else toast(`${nameOf(e.pid)} is back up`, 'good');
          break;
        case 'died':
          if (e.pid === localId) toast('You died — you\'ll respawn when the wave is cleared', 'danger', 4);
          else toast(`${nameOf(e.pid)} died — respawns next wave`, 'danger', 3.5);
          break;
        case 'respawn':
          if (e.pid === localId) toast('Back in the fight!', 'good');
          break;
        case 'pickup':
          if (e.pid !== localId) break;
          if (e.kind === 'crate' && e.weapon) toast(`Picked up ${itemName(e.weapon)}`, 'good');
          else if (PICKUPS[e.kind]) toast(`+ ${PICKUPS[e.kind].name}`, 'minor', 1.8);
          break;
        case 'buy':
          if (e.pid !== localId) break;
          // lastView is still the pre-purchase state: an owned gun means an ammo refill.
          if (me && me.slots && me.slots.includes(e.item)) toast(`Ammo refilled — ${itemName(e.item)}`, 'good', 2);
          else toast(`Bought ${itemName(e.item)}`, 'good', 2);
          break;
        case 'buyfail':
          if (e.pid !== localId) break;
          if (e.reason === 'cash') {
            const need = priceOf(e.item, me, clsOf(localId)) - (me ? me.cash : 0);
            toast(need > 0 ? `You need ${formatCash(need)} more` : 'Not enough cash', 'danger', 2.4);
          } else if (e.reason === 'closed') {
            toast(zoneMode ? 'Shop closed — get to the supply drop in the zone' : campMode ? 'Shop closed — get to the supply point' : 'Shop closed — get to the supply station', 'danger', 2.6);
          } else if (e.reason === 'max') {
            toast(`You can't carry more (${itemName(e.item)})`, 'danger', 2.4);
          } else if (e.reason === 'owned') {
            toast('Already full', 'danger', 2);
          } else {
            toast('Not available yet', 'danger', 2);
          }
          break;
        case 'placefail':
          if (e.pid === localId) toast(`No room for the ${e.kind === 'turret' ? 'turret' : 'barricade'} there`, 'danger', 2.2);
          break;
        case 'drop':
          toast(zoneMode ? 'Supply drop landed in the next zone' : 'Weapon crate dropped at the supply station', 'minor', 3);
          break;
        case 'objhit':
          objFlashT = 0.35;
          break;
        case 'gameover':
          showBanner('OVERRUN', e.reason === 'objective' ? `The ${(map.objective && map.objective.name) || 'objective'} was destroyed` : 'Nobody is left standing', 'danger', 4);
          break;
        case 'victory':
          showBanner('VICTORY', 'Every wave survived', 'good', 4);
          break;
        default:
      }
    }
  }

  // ---- roster ------------------------------------------------------------------------------

  function setRoster(list, lid) {
    roster = list || [];
    localId = lid;
    rosterById = new Map(roster.map((r) => [r.id, r]));
    // teammate rows
    const want = new Set();
    for (const r of roster) {
      if (r.id === localId) continue;
      want.add(r.id);
      let row = teamRows.get(r.id);
      if (!row) {
        const pc = h('canvas.tm-portrait', { width: 64, height: 64, 'aria-hidden': 'true' });
        const name = h('span.tm-name');
        const state = h('span.tm-state');
        const hb = bar('tm-hp');
        const el = h('div.tm-row', null, [pc, h('div.tm-info', null, [h('div.tm-head', null, [name, state]), hb.el])]);
        row = { el, pc, name, state, hb, key: '' };
        teamRows.set(r.id, row);
        team.appendChild(row.el);
      }
      const key = `${r.cls}:${r.color}`;
      if (row.key !== key) {
        row.key = key;
        // Sized to its box × devicePixelRatio once laid out (resize() redraws it).
        if (row.el.isConnected) fitCanvas(row.pc);
        try {
          renderClassPortrait(row.pc, r.cls, r.color);
        } catch (err) {
          console.warn('[hud] portrait failed', err);
        }
      }
      setText(row.name, r.name);
      setStyle(row.name, 'color', PLAYER_COLORS[r.color] || '#fff');
    }
    for (const [id, row] of teamRows) {
      if (!want.has(id)) {
        row.el.remove();
        teamRows.delete(id);
      }
    }
    // keep roster order
    for (const r of roster) {
      const row = teamRows.get(r.id);
      if (row) team.appendChild(row.el);
    }
  }

  // ---- touch layout ------------------------------------------------------------------------------

  /**
   * On touch screens the HUD columns sit at the top edges and the touch button rows go
   * right below them (the thumbs own the bottom corners). The boxes change height (phase
   * text, the kit tag, compact media queries), so fixed offsets overlap: measure them and
   * publish CSS variables on the game screen, which holds both the HUD and the touch layer.
   */
  function setTouchVar(host, name, value) {
    if (touchVars[name] === value) return;
    touchVars[name] = value;
    if (value === null) host.style.removeProperty(name);
    else host.style.setProperty(name, value);
  }

  function layoutTouch() {
    const host = root.parentElement;
    if (!host) return;
    const top = root.getBoundingClientRect().top;
    const below = (el) => `${Math.round(el.getBoundingClientRect().bottom - top + TOUCH_GAP)}px`;
    setTouchVar(host, '--hud-col-top', below(bottomLeft));
    setTouchVar(host, '--touch-util-top', below(topLeft));
    setTouchVar(host, '--touch-gear-top', below(bottomRight));
  }

  function clearTouchLayout() {
    const host = root.parentElement;
    if (host) for (const name of TOUCH_VARS) setTouchVar(host, name, null);
  }

  // ---- per-frame update ----------------------------------------------------------------------

  /**
   * @param {object|null} view Snapshot from session.getView()
   * @param {object} info { dt, mode, stats: {ping, fps, ...}, showStats, localPos, shopOpen, isHost,
   *   yaw (first person: camera facing), camPos ({x, y} camera position),
   *   renderStats (first person: renderer.stats — renderScale, gpuMs when reported) }
   */
  function update(view, info) {
    const dt = info.dt || 0;
    time += dt;
    if (view) lastView = view;
    const v = lastView;
    pumpBanner(dt);
    pumpFeed();
    if (info.mode !== keyMode) {
      keyMode = info.mode;
      keys = KEY_LABELS[keyMode] || KEY_LABELS.kbm;
      for (const id of Object.keys(equip)) setText(equip[id].key, keys[id]);
      root.dataset.input = keyMode;
      touchLayoutT = 0;
      if (keyMode !== 'touch') clearTouchLayout();
    }
    minimap.update(v, localId, rosterById, dt, info.localPos, info.yaw);
    if (compass) compass.update(info.yaw, info.camPos || info.localPos, v, localId, rosterById, dt);
    if (!v) return;
    const me = localPlayer(v);
    if (zoneHud) zoneHud.update(v, me, info.localPos, dt);
    if (campaignHud) campaignHud.update(v, me, info.localPos, dt);
    if (storyHud) storyHud.update(v, me, info.localPos, dt);
    root.dataset.phase = v.phase;

    // wave / phase
    setText(waveNum, String(v.phase === 'prep' ? 1 : v.wave));
    setText(waveTotal, v.totalWaves ? `/ ${v.totalWaves}` : 'ENDLESS');
    const between = v.phase === 'prep' || v.phase === 'intermission';
    if (v.phase === 'wave') {
      setText(waveLeft, `${v.remaining} ${v.remaining === 1 ? 'zombie' : 'zombies'} left`);
    } else if (between) {
      setText(waveLeft, v.phase === 'prep' ? 'Get ready' : 'Wave cleared');
    } else {
      setText(waveLeft, v.phase === 'victory' ? 'All waves survived' : 'Overrun');
    }
    // the campaign's stages (hill waves, the breakout, floors, the roof quota) name their own counters
    const cw = campaignHud ? campaignHud.wavePanel(v) : null;
    setText(waveLabel, cw ? cw.label : 'WAVE');
    if (cw) {
      setText(waveNum, cw.num);
      setText(waveTotal, cw.total);
      if (cw.left && v.phase === 'wave') setText(waveLeft, cw.left);
    }
    setShown(waveLeft, true);
    // (a mission counts its own waves in the tracker; the zone / campaign panels keep theirs)
    setShown(wavePanel, !storyMode || zoneMode || campMode);
    if (between) {
      const secs = Math.max(0, Math.ceil(v.timer));
      const total = v.players.length;
      const readyN = v.readyCount | 0;
      const what = zoneMode ? 'Zone locks' : campaignHud ? campaignHud.phaseWhat(v) : v.phase === 'prep' ? 'First wave' : 'Next wave';
      let text;
      if (me && me.ready) text = `${what} in ${secs}s — you're ready (${readyN}/${total})`;
      // Touch has a big READY button on screen, and no room for a long line.
      else if (keyMode === 'touch') text = `${what} in ${secs}s · ${readyN}/${total} ready`;
      else text = `${what} in ${secs}s — press ${keys.ready} when ready (${readyN}/${total} ready)`;
      setText(phaseLine, text);
      setShown(phaseLine, true);
      setClass(phaseLine, 'urgent', secs <= 5);
      if (secs !== lastCountdown) {
        if (secs <= 5 && secs >= 1 && lastCountdown !== -1) audio.ui('countdown');
        lastCountdown = secs;
      }
    } else {
      setShown(phaseLine, false);
      lastCountdown = -1;
    }

    // objective
    if (v.objective) {
      setShown(objPanel, true);
      const f = v.objective.maxHp > 0 ? v.objective.hp / v.objective.maxHp : 0;
      setStyle(objBar.fill, 'width', pct(f));
      setStyle(objBar.ghost, 'width', pct(f));
      setText(objPct, `${Math.ceil(f * 100)}%`);
      setClass(objPanel, 'low', f < 0.3);
      objFlashT = Math.max(0, objFlashT - dt);
      setClass(objPanel, 'hit', objFlashT > 0);
    } else {
      setShown(objPanel, false);
    }

    // boss
    if (v.bossHp >= 0) {
      setShown(bossPanel, true);
      setStyle(bossBar.fill, 'width', pct(v.bossHp));
      setStyle(bossBar.ghost, 'width', pct(v.bossHp));
    } else {
      setShown(bossPanel, false);
    }

    // teammates
    for (const p of v.players) {
      const row = teamRows.get(p.id);
      if (!row) continue;
      const f = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      setStyle(row.hb.fill, 'width', pct(p.state === 'alive' ? f : p.state === 'downed' ? p.bleedout / BLEEDOUT_TIME : 0));
      setStyle(row.hb.ghost, 'width', pct(p.state === 'alive' ? f : 0));
      setClass(row.el, 'downed', p.state === 'downed');
      setClass(row.el, 'dead', p.state === 'dead');
      setClass(row.el, 'low', p.state === 'alive' && f < LOW_HP);
      if (p.state === 'downed') setText(row.state, p.reviver ? 'REVIVING' : `DOWN ${Math.ceil(p.bleedout)}s`);
      else if (p.state === 'dead') setText(row.state, 'DEAD · next wave');
      else setText(row.state, v.phase !== 'wave' && p.ready ? 'READY' : '');
    }

    // local player
    if (me) updateLocal(v, me, info);
    updatePrompt(v, me, info);

    // performance / net readout (FPS, the renderer's resolution scale and GPU time, ping)
    setShown(netStats, !!info.showStats);
    if (info.showStats) {
      statsAcc -= dt;
      if (statsAcc <= 0) {
        // 4×/s: a number that changes every frame can't be read anyway.
        statsAcc = 0.25;
        const s = info.stats || {};
        setText(netStats, statsLine({
          fps: info.fps, renderStats: info.renderStats, isHost: info.isHost, ping: s.ping || 0, snapshotsPerSec: s.snapshotsPerSec,
        }));
      }
    }

    // Same wave number as the wave panel (prep counts toward wave 1, not "wave 0").
    const waveShown = v.phase === 'prep' ? 1 : v.wave;
    const boardLabel = storyMode && !zoneMode && !campMode
      ? (story.title ? `Road to Haven · ${story.title}` : 'Road to Haven')
      : v.totalWaves ? `Wave ${waveShown} of ${v.totalWaves}` : `Wave ${waveShown} · Endless`;
    scoreboard.update(v, roster, localId, dt, boardLabel);

    // After this frame's DOM writes, so the measurement sees the new text.
    if (keyMode === 'touch') {
      touchLayoutT -= dt;
      if (touchLayoutT <= 0) {
        touchLayoutT = TOUCH_LAYOUT_EVERY;
        layoutTouch();
      }
    }
  }

  function updateLocal(v, me, info) {
    const dt = info.dt || 0;
    // portrait
    const r = rosterById.get(localId);
    const pk = r ? `${r.cls}:${r.color}` : '';
    if (pk && pk !== portraitKey) {
      portraitKey = pk;
      fitCanvas(portrait);
      try {
        renderClassPortrait(portrait, r.cls, r.color);
      } catch (err) {
        console.warn('[hud] portrait failed', err);
      }
    }
    // health
    const hpF = me.maxHp > 0 ? me.hp / me.maxHp : 0;
    if (me.state === 'downed') {
      const f = me.bleedout / BLEEDOUT_TIME;
      setStyle(hpBar.fill, 'width', pct(f));
      setStyle(hpBar.ghost, 'width', pct(f));
      setText(hpNum, `${Math.ceil(me.bleedout)}s`);
      setText(statusTag, me.reviver ? `${nameOf(me.reviver).toUpperCase()} IS REVIVING YOU` : 'DOWN — BLEEDING OUT');
    } else if (me.state === 'dead') {
      setStyle(hpBar.fill, 'width', '0%');
      setStyle(hpBar.ghost, 'width', '0%');
      setText(hpNum, '0');
      setText(statusTag, 'DEAD — RESPAWN NEXT WAVE');
    } else {
      setStyle(hpBar.fill, 'width', pct(hpF));
      setStyle(hpBar.ghost, 'width', pct(hpF));
      setText(hpNum, String(Math.ceil(me.hp)));
      setText(statusTag, '');
    }
    setClass(vitals, 'downed', me.state === 'downed');
    setClass(vitals, 'dead', me.state === 'dead');
    setClass(vitals, 'low', me.state === 'alive' && hpF < LOW_HP);
    setStyle(armorBar.fill, 'width', pct(me.armor / ARMOR_MAX));
    setStyle(armorBar.ghost, 'width', pct(me.armor / ARMOR_MAX));
    setClass(armorBar.el, 'empty', me.armor <= 0);
    const stamMax = STAMINA_MAX * (perksFor(r ? r.cls : 'soldier').staminaMult || 1);
    const sf = Math.min(1, me.stamina / Math.max(STAMINA_MAX, stamMax));
    setStyle(stamBar.fill, 'width', pct(sf));
    setStyle(stamBar.ghost, 'width', pct(sf));
    setClass(stamBar.el, 'full', sf >= 0.995);
    setShown(kitTag, !!me.selfRevive);

    // cash, animated toward the real value
    if (cashShown === null) {
      cashShown = cashTarget = me.cash;
    }
    if (me.cash !== cashTarget) {
      const d = me.cash - cashTarget;
      cashTarget = me.cash;
      cashDeltaSum = cashDeltaT > 0 ? cashDeltaSum + d : d;
      cashDeltaT = 1.4;
      setText(cashDelta, `${cashDeltaSum >= 0 ? '+' : '−'}${formatCash(Math.abs(cashDeltaSum))}`);
      cashDelta.className = `cash-delta show ${cashDeltaSum >= 0 ? 'gain' : 'spend'}`;
      cashEl.classList.remove('gain', 'spend');
      void cashEl.offsetWidth;
      cashEl.classList.add(d >= 0 ? 'gain' : 'spend');
    }
    if (cashDeltaT > 0) {
      cashDeltaT -= dt;
      if (cashDeltaT <= 0) cashDelta.classList.remove('show');
    }
    if (cashShown !== cashTarget) {
      const diff = cashTarget - cashShown;
      const step = Math.max(1, Math.abs(diff) * Math.min(1, dt * 9));
      cashShown = Math.abs(diff) <= step ? cashTarget : cashShown + Math.sign(diff) * step;
    }
    setText(cashEl, formatCash(Math.round(cashShown)));

    // weapon: the one actually in hand (downed players fall back to a pistol). On a client
    // the local record carries the predicted slot/ammo/reload (SPEC §6.2).
    const aw = activeWeapon(me);
    const w = aw.id ? WEAPONS[aw.id] : null;
    // The free pistol's mag is only known to the predicting client (`freeMag`).
    const am = aw.slot >= 0 ? me.ammo[aw.slot] || [0, 0] : [Number.isFinite(me.freeMag) ? me.freeMag : -1, -1];
    if (w) {
      setText(wName, w.name);
      setText(wMag, am[0] < 0 ? '' : String(am[0]));
      setText(wRes, am[1] < 0 ? '/ ∞' : `/ ${am[1]}`);
      const low = am[0] >= 0 && am[0] <= Math.max(1, Math.floor(w.mag * 0.25));
      setClass(wMag, 'low', low && am[0] > 0);
      setClass(wMag, 'empty', am[0] === 0);
      if (me.reloading > 0) setText(wHint, 'RELOADING');
      else if (am[0] === 0 && am[1] === 0) setText(wHint, 'OUT OF AMMO — BUY AMMO');
      // Downed survivors can't reload by hand (an empty mag still auto-reloads).
      else if (me.state === 'alive' && (am[0] === 0 || (low && am[1] !== 0))) setText(wHint, `${keys.reload} TO RELOAD`);
      else setText(wHint, '');
      setClass(wHint, 'warn', am[0] === 0);
    } else {
      setText(wName, 'Unarmed');
      setText(wMag, '—');
      setText(wRes, '');
      setText(wHint, '');
    }
    setShown(reloadWrap, me.reloading > 0);
    if (me.reloading > 0) setStyle(reloadBar, 'width', pct(me.reloading));
    for (let i = 0; i < 3; i++) {
      const s = slots[i];
      const id = me.slots[i];
      const sw = id ? WEAPONS[id] : null;
      // No slot is lit while a downed survivor fires the free pistol.
      setClass(s.el, 'active', aw.id ? i === aw.slot : i === me.slot);
      setClass(s.el, 'empty', !sw);
      setText(s.name, sw ? sw.short : '—');
      if (sw) {
        const a = me.ammo[i] || [0, 0];
        setText(s.ammo, a[1] < 0 ? `${a[0]}/∞` : `${a[0]}/${a[1]}`);
        setClass(s.el, 'dry', a[0] === 0 && a[1] === 0);
      } else {
        setText(s.ammo, '');
        setClass(s.el, 'dry', false);
      }
    }
    const perks = perksFor(r ? r.cls : 'soldier');
    const counts = { frag: me.frags, molotov: me.molotovs, turret: me.turrets, barricade: me.barricades };
    const maxes = { frag: FRAG_MAX + (perks.extraFrags || 0), molotov: MOLOTOV_MAX };
    for (const id of Object.keys(equip)) {
      const n = counts[id] | 0;
      setText(equip[id].count, String(n));
      setClass(equip[id].el, 'none', n <= 0);
      setClass(equip[id].el, 'full', maxes[id] !== undefined && n >= maxes[id]);
    }
  }

  function setPrompt(text, progress) {
    if (!text) {
      setShown(prompt, false);
      return;
    }
    setShown(prompt, true);
    setText(promptText, text);
    if (progress === undefined || progress === null) {
      setShown(promptProg, false);
    } else {
      setShown(promptProg, true);
      setStyle(promptBar, 'width', pct(progress));
    }
  }

  let climbWorld = null;
  /** True when a jump straight ahead would mantle onto something (movement.js ledgeAhead). */
  function canClimbAhead(me, pos, yaw) {
    if (me.state !== 'alive' || me.climbT > 0 || me.vzq || !Number.isFinite(yaw) || !map || !map.obstacles) return false;
    if (!climbWorld) climbWorld = createCollisionWorld(map);
    return ledgeAhead(climbWorld, pos.x, pos.y, me.zq | 0, Math.cos(yaw), Math.sin(yaw)) >= 0;
  }

  function updatePrompt(v, me, info) {
    let text = '';
    let prog = null;
    let hintText = '';
    const pos = info.localPos || me;
    if (storyHud) storyHud.resetRing();
    let sp = null;
    if (!me) {
      text = 'Joining the fight…';
    } else if (v.phase === 'gameover' || v.phase === 'victory') {
      text = '';
    } else if (me.state === 'dead') {
      text = me.respawn || v.phase === 'wave' ? 'You died — you\'ll respawn when this wave is cleared' : 'Respawning…';
    } else if (me.state === 'downed') {
      if (me.reviver) {
        text = `${nameOf(me.reviver)} is reviving you`;
        prog = me.revive;
      } else if (me.selfRevive) {
        text = 'Self-revive kit kicking in…';
      } else {
        text = `You're down — ${Math.ceil(me.bleedout)}s to bleed out. Get near a teammate!`;
      }
    } else {
      // revive a teammate?
      let target = null, best = REVIVE_RADIUS + 1;
      for (const p of v.players) {
        if (p.id === localId || p.state !== 'downed') continue;
        const d = Math.hypot(p.x - pos.x, p.y - pos.y);
        if (d < best) {
          best = d;
          target = p;
        }
      }
      if (target) {
        if (target.reviver === localId) {
          text = `Reviving ${nameOf(target.id)}…`;
          prog = target.revive;
        } else if (target.reviver) {
          text = `${nameOf(target.reviver)} is reviving ${nameOf(target.id)}`;
          prog = target.revive;
        } else {
          text = `Hold ${keys.interact} to revive ${nameOf(target.id)}`;
        }
      } else {
        // weapon crate?
        let crate = null, cb = INTERACT_RADIUS + 1;
        for (const p of v.pickups || []) {
          if (p.kind !== 'crate') continue;
          const d = Math.hypot(p.x - pos.x, p.y - pos.y);
          if (d < cb) {
            cb = d;
            crate = p;
          }
        }
        if (crate) {
          text = `Press ${keys.interact} to take the ${crate.weapon && WEAPONS[crate.weapon] ? WEAPONS[crate.weapon].name : 'weapon crate'}`;
        } else if (storyHud && (sp = storyHud.prompt(v, me, pos, keys, localId))) {
          // (a station, a terminal, an NPC to talk to or revive)
          text = sp.text;
          prog = sp.ring ? null : sp.prog;
        } else if (campaignHud && (text = campaignHud.prompt(v, me, pos, keys))) {
          // (the zip gantry)
        } else if (v.phase === 'wave' && nearSupply(map, v.zone || v.campaign, pos.x, pos.y, SUPPLY_RADIUS)) {
          const drop = v.zone || v.campaign;
          const atDrop = !!drop && Math.hypot(pos.x - drop.sx, pos.y - drop.sy) <= SUPPLY_RADIUS;
          text = info.shopOpen ? '' : `Press ${keys.shop} to open the shop at the ${atDrop ? (v.campaign ? 'supply point' : 'supply drop') : 'supply station'}`;
        }
      }
      // facing something you can climb onto
      if (!text && canClimbAhead(me, pos, Number.isFinite(info.yaw) ? info.yaw : me.angle)) text = `${keys.jump} — climb`;
      if ((v.phase === 'prep' || v.phase === 'intermission') && !info.shopOpen) {
        const st = shopState(v, me, map);
        if (st.open) hintText = `Shop open — press ${keys.shop}`;
      }
    }
    setPrompt(text, prog);
    setShown(hint, !!hintText);
    if (hintText) setText(hint, hintText);

    // spectating banner for dead players
    const dead = me && me.state === 'dead' && v.phase !== 'gameover' && v.phase !== 'victory';
    setShown(spectate, dead);
    if (dead) {
      const alive = v.players.find((p) => p.id !== localId && p.state === 'alive');
      setText(spectate, alive ? `SPECTATING ${nameOf(alive.id).toUpperCase()}` : 'SPECTATING');
    }
  }

  function resize() {
    minimap.resize();
    if (compass) compass.resize();
    touchLayoutT = 0;
    // Portraits follow their (rem-sized) boxes: redraw on the next roster/update pass.
    if (fitCanvas(portrait)) portraitKey = '';
    for (const row of teamRows.values()) if (fitCanvas(row.pc)) row.key = '';
    setRoster(roster, localId);
  }

  return {
    el: root,
    update,
    addEvents,
    setRoster,
    resize,
    toast,
    banner: showBanner,
    scoreboard,
    /** First person: rotating radar (true) or the whole map north-up (false). */
    setMinimapRotate(on) {
      if (fps) minimap.setRadar(!!on);
    },
    /** Notice from the session ('notice' event). */
    notice(text) {
      toast(text, 'minor', 4);
    },
    destroy() {
      clearTouchLayout();
      if (zoneHud) zoneHud.destroy();
      if (campaignHud) campaignHud.destroy();
      if (storyHud) storyHud.destroy();
      scoreboard.destroy();
      root.replaceChildren();
      root.hidden = true;
      delete root.dataset.phase;
      delete root.dataset.input;
      delete root.dataset.view;
    },
  };
}

