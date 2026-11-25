// The buy menu (a modal over the game). Guns are sorted into sections — Pistols, SMGs, Heavy
// (shotguns and machine guns), Rifles, Snipers, Specials — plus Equipment (ammo, armour,
// medkits, grenades, barricades, turrets...). The sections are a list down the left; the
// chosen one's items fill a grid of cards, each with a picture of the gun (ui/gun-thumbs.js),
// its price and its key numbers.
//
// Keys work like a classic buy menu: a digit picks a section, a second digit buys the item
// with that number in it (B, 4, 2: the second rifle) and the menu drops back to the sections
// for the next purchase. The number row continues past 9 with 0, - and = for long sections.
// Backspace goes back a level, Q / E step through the sections, the arrows move between
// sections and cards. Mouse and touch: tap a section, tap a card. Gamepad: the d-pad moves,
// A picks a section or buys, B goes back (and closes from the sections), LB / RB step
// through the sections.
//
// The simulation validates every purchase; the menu mirrors its rules (phase, the supply
// station, unlock wave, limits, cash) so a card shows why it can't be bought before the
// player tries.

import { WEAPONS, WEAPON_IDS, effectiveRate, buySection } from '../shared/weapons.js';
import { ITEMS, ITEM_IDS, ammoPrice } from '../shared/items.js';
import { perksFor } from '../shared/classes.js';
import {
  SUPPLY_RADIUS, FRAG_MAX, MOLOTOV_MAX, TURRET, BARRICADE, ARMOR_MAX,
} from '../shared/constants.js';
import { nearSupply } from '../shared/zone.js';
import { shopWaveOf } from '../shared/horde.js';
import { h, setText, setClass, setAttr, formatCash } from './dom.js';

const GUN_IDS = WEAPON_IDS.filter((id) => WEAPONS[id].price > 0);
const REFRESH = 0.1;

/** Shop card label per weapons.js `category`. */
export const CATEGORY = {
  pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper',
  heavy: 'Heavy', explosive: 'Explosive', special: 'Special', melee: 'Melee',
};

/** The buy menu's sections, in key order (1 … 7). */
export const SECTIONS = [
  { id: 'pistols', name: 'Pistols' },
  { id: 'smgs', name: 'SMGs' },
  { id: 'heavy', name: 'Heavy', hint: 'Shotguns and machine guns' },
  { id: 'rifles', name: 'Rifles' },
  { id: 'snipers', name: 'Snipers' },
  { id: 'specials', name: 'Specials', hint: 'Launchers, energy weapons, the saw and the super weapon' },
  { id: 'gear', name: 'Equipment', hint: 'Ammo, armour, medkits, grenades, barricades, turrets' },
];

/** The number-row key that buys the n-th item of a section. */
export const ITEM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];

/** Buy-menu section of a gun or item id (the flare pistol sits with the pistols). */
export function sectionOf(id) {
  if (!WEAPONS[id]) return ITEMS[id] ? 'gear' : null;
  if (id === 'flare') return 'pistols';
  return buySection(id);
}

const BY_SECTION = (() => {
  const m = {};
  for (const s of SECTIONS) m[s.id] = [];
  for (const id of GUN_IDS) m[sectionOf(id)].push(id);
  for (const k in m) m[k].sort((a, b) => WEAPONS[a].price - WEAPONS[b].price || WEAPONS[a].unlockWave - WEAPONS[b].unlockWave);
  m.gear = ITEM_IDS.slice();
  return m;
})();

/** The ids on sale in a section, in key order (guns cheapest first). */
export function sectionItems(section) {
  return BY_SECTION[section] ? BY_SECTION[section].slice() : [];
}

function shotDamage(w) {
  if (w.projectile && w.projectile.explodeDamage) return w.projectile.explodeDamage;
  if (w.kind === 'flame') return w.damage + (w.burn ? w.burn.dps * 0.5 : 0);
  if (w.burn) return w.damage + w.burn.dps * w.burn.duration * 0.5;
  return w.damage * (w.pellets || 1);
}

const MAX_DMG = Math.max(...GUN_IDS.map((id) => shotDamage(WEAPONS[id])));
const MAX_RATE = Math.max(...GUN_IDS.map((id) => effectiveRate(WEAPONS[id])));
const MAX_MAG = Math.max(...GUN_IDS.map((id) => WEAPONS[id].mag));

/** 0..1 bar values; log scales so a railgun doesn't flatten every other gun. */
export function gunStats(id) {
  const w = WEAPONS[id];
  return {
    damage: Math.max(0.06, Math.log(1 + shotDamage(w)) / Math.log(1 + MAX_DMG)),
    rate: Math.max(0.06, Math.sqrt(effectiveRate(w) / MAX_RATE)),
    mag: Math.max(0.06, Math.log(1 + w.mag) / Math.log(1 + MAX_MAG)),
  };
}

function gunTrait(w) {
  if (w.super) return 'Super weapon: a black hole';
  if (w.kind === 'rail') return 'Pierces everything';
  if (w.kind === 'chain') return `Arcs to ${w.chains} more`;
  if (w.kind === 'flame') return 'Sets zombies on fire';
  if (w.kind === 'cryo') return 'Slows, then freezes solid';
  if (w.kind === 'melee') return 'Cuts everything in reach';
  if (w.penetrate) return 'Shoots through cover';
  if (w.projectile && w.projectile.kind === 'blade') return 'Blades slice and ricochet';
  if (w.projectile && w.projectile.flare) return 'Burning flare lights up';
  if (w.projectile && w.projectile.drag) return 'Skewers and pins';
  if (w.burst) return `${w.burst}-round bursts`;
  if (w.secondary && w.secondary.type === 'silencer') return 'Screw-on silencer';
  if (w.secondary && w.secondary.type === 'burst') return 'Auto or burst fire';
  if (w.secondary && w.secondary.type === 'scope') return w.pierce > 1 ? `Scoped, pierces ${w.pierce}` : 'Scoped';
  if (w.tighten) return 'Tightens as it fires';
  if (w.reloadOne) return `Pierces ${w.pierce}, loads by hand`;
  if (w.projectile && w.projectile.explodeRadius) return 'Explosive';
  if (w.spinup) return 'Needs to spin up';
  if (w.pellets > 1) return `${w.pellets} pellets`;
  if (w.pierce > 1) return `Pierces ${w.pierce}`;
  if (w.reserve < 0) return 'Infinite ammo';
  return `${w.mag}-round mag`;
}

/** Wave whose stock is on sale (mirrors the sim: next wave between waves; a horde round: the surge's tier). */
export function shopWave(view) {
  if (!view) return 1;
  return shopWaveOf(view.phase, view.wave, view.horde || null);
}

/**
 * Price the local player would pay right now.
 * @param {string} item gun or item id
 * @param {object|null} me Snapshot player
 * @param {string} cls class id (turret discount)
 */
export function priceOf(item, me, cls) {
  if (item in WEAPONS) {
    return me && me.slots && me.slots.includes(item) ? ammoPrice(item) : WEAPONS[item].price;
  }
  if (item === 'turret') return Math.round(ITEMS.turret.price * (1 - (perksFor(cls).turretDiscount || 0)));
  return ITEMS[item] ? ITEMS[item].price : 0;
}

/** Display name of a gun or item. */
export function itemName(item) {
  if (WEAPONS[item]) return WEAPONS[item].name;
  if (ITEMS[item]) return ITEMS[item].name;
  return String(item);
}

/**
 * Whether the local player can shop right now, and a line explaining the state.
 * @returns {{ open: boolean, text: string, mid: boolean }}
 */
export function shopState(view, me, map) {
  if (!view || !me) return { open: false, text: 'Shop unavailable', mid: false };
  if (view.phase === 'gameover' || view.phase === 'victory') return { open: false, text: 'The match is over', mid: false };
  if (me.state === 'downed') return { open: false, text: 'You can\'t shop while you\'re down', mid: false };
  if (me.state === 'dead') return { open: false, text: view.horde ? 'You fell — no respawns in a horde round' : 'You can shop again after you respawn', mid: false };
  if (view.phase === 'prep') return { open: true, text: view.horde ? 'Buy time — gear up before the horde comes' : 'Stock up before the first wave', mid: false };
  if (view.phase === 'intermission') return { open: true, text: 'Between waves — everything is on sale', mid: false };
  const drop = view.zone || view.campaign;        // Evac Run's drop / the campaign's supply point
  const near = nearSupply(map, drop, me.x, me.y, SUPPLY_RADIUS);
  const where = view.zone ? 'the supply drop in the zone' : view.campaign ? 'the supply point (green + on the minimap)' : 'the supply station';
  if (view.horde && !near) return { open: false, text: 'The horde is coming — the supply station at your spawn sells mid-round (green + on the minimap)', mid: true };
  return near
    ? { open: true, text: `${drop ? 'Supply drop' : 'Supply station'} — shopping mid-wave. Watch your back!`, mid: true }
    : { open: false, text: `Wave in progress — go to ${where} (green + on the minimap) to shop`, mid: true };
}

function ownedSlot(me, id) {
  return me && me.slots ? me.slots.indexOf(id) : -1;
}

/**
 * Why `item` can't be bought (null = it can). Mirrors buyCheck() in the sim.
 * @returns {null|'locked'|'full'|'max'|'cash'|'na'}
 */
export function blockReason(item, view, me, cls) {
  if (!me) return 'na';
  if (item in WEAPONS) {
    const w = WEAPONS[item];
    if (w.unlockWave > shopWave(view)) return 'locked';
    const s = ownedSlot(me, item);
    if (s >= 0) {
      const a = me.ammo[s] || [0, 0];
      if (a[0] >= w.mag && (w.reserve < 0 || a[1] >= w.reserve)) return 'full';
    }
  } else {
    const perks = perksFor(cls);
    switch (item) {
      case 'ammo': {
        let need = false;
        for (let i = 0; i < me.slots.length; i++) {
          const id = me.slots[i];
          if (id && WEAPONS[id] && WEAPONS[id].reserve >= 0 && me.ammo[i] && me.ammo[i][1] < WEAPONS[id].reserve) need = true;
        }
        // Turret ammo also counts, but the snapshot doesn't say who owns which turret fully; allow it.
        if (!need && !(view.turrets || []).length) return 'max';
        break;
      }
      case 'armor': if (me.armor >= ARMOR_MAX) return 'max'; break;
      case 'medkit': if (me.hp >= me.maxHp) return 'max'; break;
      case 'frag': if (me.frags >= FRAG_MAX + (perks.extraFrags || 0)) return 'max'; break;
      case 'molotov': if (me.molotovs >= MOLOTOV_MAX) return 'max'; break;
      case 'barricade': {
        const placed = (view.barricades || []).filter((b) => b.owner === me.id).length;
        if (placed + me.barricades >= BARRICADE.maxPerPlayer) return 'max';
        break;
      }
      case 'turret': {
        const placed = (view.turrets || []).filter((t) => t.owner === me.id).length;
        if (placed + me.turrets >= TURRET.maxPerPlayer) return 'max';
        break;
      }
      case 'selfrevive': if (me.selfRevive) return 'full'; break;
      case 'repair':
        if (!view.objective) return 'na';
        if (view.objective.hp >= view.objective.maxHp) return 'max';
        break;
      default: return 'na';
    }
  }
  if (me.cash < priceOf(item, me, cls)) return 'cash';
  return null;
}

function haveText(item, view, me, cls) {
  if (!me) return '';
  const perks = perksFor(cls);
  switch (item) {
    case 'frag': return `${me.frags}/${FRAG_MAX + (perks.extraFrags || 0)}`;
    case 'molotov': return `${me.molotovs}/${MOLOTOV_MAX}`;
    case 'barricade': {
      const placed = (view.barricades || []).filter((b) => b.owner === me.id).length;
      return `${me.barricades + placed}/${BARRICADE.maxPerPlayer}`;
    }
    case 'turret': {
      const placed = (view.turrets || []).filter((t) => t.owner === me.id).length;
      return `${me.turrets + placed}/${TURRET.maxPerPlayer}`;
    }
    case 'armor': return `${Math.round(me.armor)}/${ARMOR_MAX}`;
    case 'medkit': return `${Math.round(me.hp)}/${me.maxHp} HP`;
    case 'selfrevive': return me.selfRevive ? 'Carrying' : '';
    case 'repair': return view.objective ? `${Math.round((100 * view.objective.hp) / view.objective.maxHp)}%` : 'Off';
    default: return '';
  }
}

function statBar(label) {
  const fill = h('i');
  return { el: h('div.stat', null, [h('span.stat-label', { text: label }), h('span.stat-track', null, fill)]), fill };
}

// the gun picture's CSS size on a card
const PIC_W = 200, PIC_H = 72;

/**
 * @param {HTMLElement} root where the modal is mounted
 * @param {object} opts
 * @param {object} opts.session Session (buy)
 * @param {object} opts.audio audio engine (ui sounds)
 * @param {object} opts.map MapDef
 * @param {Function} [opts.onClose] called when the shop closes itself
 */
export function createShop(root, { session, audio, map, onClose }) {
  let open = false;
  let sec = 0;                    // the section shown
  let level = 'sections';         // where the next digit goes: 'sections' (pick one) or 'items' (buy)
  let acc = REFRESH;
  let last = { view: null, me: null, cls: 'soldier' };
  const listeners = [];
  let thumbs = null;              // ui/gun-thumbs.js, loaded with the first picture

  const cashEl = h('span.shop-cash');
  const statusEl = h('p.shop-status');
  const closeBtn = h('button.btn-icon.shop-close', { type: 'button', 'aria-label': 'Close shop', text: '✕' });
  const secList = h('nav.shop-sections', { role: 'tablist', 'aria-label': 'Sections', 'aria-orientation': 'vertical' });
  const secHead = h('div.shop-sec-head', null, [h('h3.shop-sec-title'), h('span.shop-sec-hint')]);
  const grid = h('div.shop-grid', { role: 'tabpanel' });
  const hint = h('p.shop-foot');
  const card = h('div.shop.panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Buy menu' }, [
    h('header.shop-head', null, [
      h('div.shop-title', null, [h('h2', { text: 'Buy Menu' }), statusEl]),
      h('div.shop-wallet', null, [h('span.shop-wallet-label', { text: 'Cash' }), cashEl]),
      closeBtn,
    ]),
    h('div.shop-main', null, [secList, h('div.shop-body', null, [secHead, grid])]),
    hint,
  ]);
  const el = h('div.shop-backdrop', { hidden: true }, card);
  root.appendChild(el);

  function on(target, type, fn, o) {
    target.addEventListener(type, fn, o);
    listeners.push(() => target.removeEventListener(type, fn, o));
  }

  function buy(id) {
    audio.ui('click');
    session.buy(id);
  }

  // ---- sections and cards ---------------------------------------------------------------

  const secBtns = SECTIONS.map((s, i) => {
    const count = h('span.sec-count');
    const b = h('button.shop-sec', { type: 'button', role: 'tab', dataset: { sec: s.id } }, [
      h('kbd.sec-key', { text: String(i + 1) }), h('span.sec-name', { text: s.name }), count,
    ]);
    on(b, 'click', () => {
      audio.ui('click');
      pickSection(i, true);
    });
    secList.appendChild(b);
    return { el: b, count };
  });

  // every card is made once; the grid shows the chosen section's
  const cards = new Map();        // id → card
  for (const s of SECTIONS) {
    sectionItems(s.id).forEach((id, i) => {
      const price = h('span.card-price');
      const tag = h('span.card-tag');
      const key = h('kbd.card-key', { text: ITEM_KEYS[i] || '' });
      let b, extra = {};
      if (WEAPONS[id]) {
        const w = WEAPONS[id];
        const st = gunStats(id);
        const dmg = statBar('DMG'), rate = statBar('RATE'), mag = statBar('MAG');
        dmg.fill.style.width = `${Math.round(st.damage * 100)}%`;
        rate.fill.style.width = `${Math.round(st.rate * 100)}%`;
        mag.fill.style.width = `${Math.round(st.mag * 100)}%`;
        const pic = h('div.card-pic');
        b = h('button.shop-card.gun', { type: 'button', dataset: { id } }, [
          key, pic,
          h('div.card-head', null, [h('span.card-name', { text: w.name }), h('span.card-cat', { text: CATEGORY[w.category] || w.category })]),
          h('div.card-trait', { text: gunTrait(w) }),
          h('div.card-stats', null, [dmg.el, rate.el, mag.el]),
          h('div.card-foot', null, [tag, price]),
        ]);
        if (w.super) b.classList.add('super');
        extra = { pic, drawn: false };
      } else {
        const it = ITEMS[id];
        const have = h('span.card-have');
        b = h('button.shop-card.gear', { type: 'button', dataset: { id } }, [
          key,
          h('div.card-head', null, [h('span.card-name', { text: it.name }), have]),
          h('div.card-desc', { text: it.desc }),
          h('div.card-foot', null, [tag, price]),
        ]);
        extra = { have };
      }
      b.hidden = true;
      on(b, 'click', () => buy(id));
      grid.appendChild(b);
      cards.set(id, { id, el: b, price, tag, section: s.id, ...extra });
    });
  }

  /** The cards of the shown section, in key order (the hidden repair card left out). */
  function shown() {
    return sectionItems(SECTIONS[sec].id).map((id) => cards.get(id)).filter((c) => c && !c.el.hidden);
  }

  function drawPictures() {
    const list = sectionItems(SECTIONS[sec].id);
    if (!list.some((id) => WEAPONS[id])) return;
    if (!thumbs) {
      import('./gun-thumbs.js').then((m) => { thumbs = m; if (open) drawPictures(); }).catch(() => {});
      return;
    }
    for (const id of list) {
      const c = cards.get(id);
      if (!c || !c.pic || c.drawn) continue;
      const cv = thumbs.gunThumb(id, PIC_W, PIC_H, () => { if (open) drawPictures(); });
      if (!cv) return;
      cv.className = 'card-canvas';
      c.pic.appendChild(cv);
      c.drawn = true;
    }
  }

  function showSection(i) {
    sec = (i + SECTIONS.length) % SECTIONS.length;
    const s = SECTIONS[sec];
    secBtns.forEach((b, k) => {
      setClass(b.el, 'active', k === sec);
      setAttr(b.el, 'aria-selected', k === sec ? 'true' : 'false');
    });
    for (const c of cards.values()) c.el.hidden = c.section !== s.id;
    setText(secHead.firstChild, s.name);
    setText(secHead.lastChild, s.hint || '');
    setAttr(grid, 'aria-label', s.name);
    setClass(grid, 'gear', s.id === 'gear');
    if (open) {
      refresh();
      drawPictures();
    }
  }

  /** Show section i; `items`: the next digit buys in it (a click or a key picked it). */
  function pickSection(i, items) {
    showSection(i);
    setLevel(items ? 'items' : 'sections');
    if (items) {
      const first = shown().find((c) => !c.el.disabled) || shown()[0];
      if (first && !matchMedia('(pointer: coarse)').matches) first.el.focus({ preventScroll: true });
    }
  }

  function setLevel(l) {
    level = l;
    setClass(card, 'level-items', level === 'items');
    setClass(card, 'level-sections', level === 'sections');
    hint.replaceChildren(...(level === 'sections'
      ? [h('span', null, [h('kbd', { text: '1' }), '–', h('kbd', { text: String(SECTIONS.length) }), ' section']),
        h('span', null, [h('kbd', { text: 'Q' }), ' / ', h('kbd', { text: 'E' }), ' previous / next']),
        h('span', null, [h('kbd', { text: 'B' }), ' / ', h('kbd', { text: 'Esc' }), ' close'])]
      : [h('span', null, [h('kbd', { text: '1' }), '–', h('kbd', { text: '9' }), ' buy in ', SECTIONS[sec].name]),
        h('span', null, [h('kbd', { text: 'Backspace' }), ' back to the sections']),
        h('span', null, [h('kbd', { text: 'B' }), ' / ', h('kbd', { text: 'Esc' }), ' close'])]));
  }

  function back() {
    if (level === 'items') {
      setLevel('sections');
      secBtns[sec].el.focus({ preventScroll: true });
    } else close();
  }

  on(closeBtn, 'click', () => close());
  on(el, 'mousedown', (e) => {
    if (e.target === el) close();
  });
  on(el, 'contextmenu', (e) => e.preventDefault());

  function keyIndex(code) {
    const k = KEY_CODES.indexOf(code);
    if (k >= 0) return k;
    if (/^Numpad[0-9]$/.test(code)) {
      const d = Number(code.slice(6));
      return d === 0 ? 9 : d - 1;
    }
    return -1;
  }

  function onKey(e) {
    if (!open) return;
    const code = e.code;
    const n = keyIndex(code);
    if (n >= 0) {
      e.preventDefault();
      if (level === 'sections') {
        if (n < SECTIONS.length) {
          audio.ui('click');
          pickSection(n, true);
        }
        return;
      }
      const c = shown()[n];
      if (c) {
        c.el.focus({ preventScroll: false });
        if (!c.el.disabled) buy(c.id);
        else audio.ui('deny');
      }
      // like a classic buy menu: back to the sections for the next purchase
      setLevel('sections');
      return;
    }
    if (code === 'Backspace') {
      e.preventDefault();
      back();
    } else if (code === 'KeyQ' || code === 'BracketLeft') {
      pickSection(sec - 1, level === 'items');
      e.preventDefault();
    } else if (code === 'KeyE' || code === 'BracketRight') {
      pickSection(sec + 1, level === 'items');
      e.preventDefault();
    } else if (code.startsWith('Arrow')) {
      e.preventDefault();
      arrow(code === 'ArrowLeft' ? 'left' : code === 'ArrowRight' ? 'right' : code === 'ArrowUp' ? 'up' : 'down');
    }
  }
  on(window, 'keydown', onKey);

  function cols() {
    const list = shown();
    if (list.length < 2) return 1;
    const top = list[0].el.offsetTop;
    let n = 0;
    for (const c of list) {
      if (c.el.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }

  /** Arrow / d-pad: through the sections, into the grid and about it, and back out. */
  function arrow(dir) {
    const list = shown();
    const i = list.findIndex((c) => c.el === document.activeElement);
    if (i < 0 || level === 'sections') {
      if (dir === 'up' || dir === 'down') {
        pickSection(sec + (dir === 'up' ? -1 : 1), false);
        secBtns[sec].el.focus({ preventScroll: true });
      } else if (dir === 'right' && list.length) {
        setLevel('items');
        list[0].el.focus();
      }
      return;
    }
    const nc = cols();
    if (dir === 'left' && i % nc === 0) {
      setLevel('sections');
      secBtns[sec].el.focus({ preventScroll: true });
      return;
    }
    const d = dir === 'left' ? -1 : dir === 'right' ? 1 : dir === 'up' ? -nc : nc;
    list[Math.max(0, Math.min(list.length - 1, i + d))].el.focus();
  }

  // ---- state ------------------------------------------------------------------------------

  function refresh() {
    const { view, me, cls } = last;
    const state = shopState(view, me, map);
    setText(cashEl, formatCash(me ? me.cash : 0));
    setText(statusEl, state.text);
    setClass(statusEl, 'closed', !state.open);
    setClass(card, 'is-closed', !state.open);
    const wave = shopWave(view);
    const counts = {};
    for (const c of cards.values()) {
      const id = c.id;
      if (WEAPONS[id]) {
        const w = WEAPONS[id];
        const reason = state.open ? blockReason(id, view, me, cls) : 'closed';
        const owned = ownedSlot(me, id) >= 0;
        const locked = w.unlockWave > wave;
        setClass(c.el, 'owned', owned);
        setClass(c.el, 'locked', locked);
        setClass(c.el, 'poor', reason === 'cash');
        c.el.disabled = reason === 'locked' || reason === 'full' || reason === 'closed' || reason === 'na';
        if (locked) {
          setText(c.tag, '');
          setText(c.price, `Wave ${w.unlockWave}`);
        } else if (owned) {
          setText(c.tag, 'Owned');
          setText(c.price, reason === 'full' ? 'Full' : `Ammo ${formatCash(ammoPrice(id))}`);
        } else {
          setText(c.tag, '');
          setText(c.price, formatCash(w.price));
        }
        if (!locked) counts[c.section] = (counts[c.section] || 0) + 1;
      } else {
        const reason = state.open ? blockReason(id, view, me, cls) : 'closed';
        setClass(c.el, 'poor', reason === 'cash');
        setClass(c.el, 'maxed', reason === 'max' || reason === 'full');
        c.el.disabled = reason === 'closed' || reason === 'na' || reason === 'max' || reason === 'full';
        const hide = id === 'repair' && !!view && !view.objective;
        c.el.hidden = c.section !== SECTIONS[sec].id || hide;
        setText(c.have, view ? haveText(id, view, me, cls) : '');
        setText(c.tag, reason === 'max' ? 'Maxed' : reason === 'full' ? 'Owned' : '');
        setText(c.price, formatCash(priceOf(id, me, cls)));
        if (!hide) counts.gear = (counts.gear || 0) + 1;
      }
    }
    // each section: how many of its guns are in stock now
    SECTIONS.forEach((s, i) => setText(secBtns[i].count, String(counts[s.id] || 0)));
  }

  function flash(item, cls) {
    const c = cards.get(item);
    if (!c) return;
    c.el.classList.remove('flash-ok', 'flash-bad');
    // Restart the CSS animation.
    void c.el.offsetWidth;
    c.el.classList.add(cls);
  }

  function close() {
    if (!open) return;
    open = false;
    el.hidden = true;
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    if (onClose) onClose();
  }

  showSection(0);
  setLevel('sections');

  return {
    el,
    get isOpen() {
      return open;
    },
    /** Open on a section ('gear' or a section id; the old 'guns' tab: the first section). */
    open(which) {
      if (which) {
        const k = SECTIONS.findIndex((s) => s.id === which);
        if (k >= 0) showSection(k);
        else if (which === 'guns' && SECTIONS[sec].id === 'gear') showSection(0);
      }
      if (open) return;
      open = true;
      el.hidden = false;
      acc = REFRESH;
      setLevel('sections');
      refresh();
      drawPictures();
      if (!matchMedia('(pointer: coarse)').matches) secBtns[sec].el.focus({ preventScroll: true });
    },
    close,
    /** Feed the latest view; refreshes the cards a few times a second while open. */
    update(view, me, cls, dt) {
      last = { view, me, cls };
      if (!open) return;
      acc += dt;
      if (acc < REFRESH) return;
      acc = 0;
      refresh();
    },
    /** Gamepad navigation edges from input.sample().nav. */
    nav(n) {
      if (!open || !n) return;
      if (n.tabPrev) pickSection(sec - 1, level === 'items');
      if (n.tabNext) pickSection(sec + 1, level === 'items');
      if (n.left) arrow('left');
      if (n.right) arrow('right');
      if (n.up) arrow('up');
      if (n.down) arrow('down');
      if (n.accept) {
        const c = shown().find((q) => q.el === document.activeElement);
        if (c) {
          if (!c.el.disabled) buy(c.id);
        } else pickSection(sec, true);
      }
      if (n.back) back();
    },
    /** Purchase feedback for the local player's buy/buyfail events. */
    onEvents(events, localId) {
      for (const e of events) {
        if (e.pid !== localId) continue;
        if (e.type === 'buy') {
          flash(e.item, 'flash-ok');
          acc = REFRESH;
        } else if (e.type === 'buyfail') {
          flash(e.item, 'flash-bad');
        }
      }
    },
    destroy() {
      for (const off of listeners) off();
      listeners.length = 0;
      el.remove();
    },
  };
}
