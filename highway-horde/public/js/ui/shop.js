// Supply shop modal: guns and gear. The simulation validates every purchase; the shop
// mirrors its rules (phase, supply-station distance, unlock wave, limits, cash) so the
// cards show why something can't be bought before the player tries.

import { WEAPONS, WEAPON_IDS, effectiveRate } from '../shared/weapons.js';
import { ITEMS, ITEM_IDS, ammoPrice } from '../shared/items.js';
import { perksFor } from '../shared/classes.js';
import {
  SUPPLY_RADIUS, FRAG_MAX, MOLOTOV_MAX, TURRET, BARRICADE, ARMOR_MAX,
} from '../shared/constants.js';
import { nearSupply } from '../shared/zone.js';
import { h, setText, setClass, setAttr, formatCash } from './dom.js';

const GUN_IDS = WEAPON_IDS.filter((id) => WEAPONS[id].price > 0);
const REFRESH = 0.1;

/** Shop card label per weapons.js `category`. */
export const CATEGORY = {
  pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper',
  heavy: 'Heavy', explosive: 'Explosive', special: 'Special', melee: 'Melee',
};

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
  if (w.kind === 'rail') return 'Pierces everything';
  if (w.kind === 'chain') return `Arcs to ${w.chains} more`;
  if (w.kind === 'flame') return 'Sets zombies on fire';
  if (w.kind === 'cryo') return 'Slows, then freezes solid';
  if (w.kind === 'melee') return 'Cuts everything in reach';
  if (w.penetrate) return 'Shoots through cover';
  if (w.projectile && w.projectile.flare) return 'Burning flare lights up';
  if (w.projectile && w.projectile.drag) return 'Skewers and pins';
  if (w.burst) return `${w.burst}-round bursts`;
  if (w.reloadOne) return `Pierces ${w.pierce}, loads by hand`;
  if (w.projectile && w.projectile.explodeRadius) return 'Explosive';
  if (w.spinup) return 'Needs to spin up';
  if (w.pellets > 1) return `${w.pellets} pellets`;
  if (w.pierce > 1) return `Pierces ${w.pierce}`;
  if (w.reserve < 0) return 'Infinite ammo';
  return `${w.mag}-round mag`;
}

/** Wave whose stock is on sale (mirrors the sim: next wave between waves). */
export function shopWave(view) {
  if (!view) return 1;
  return view.phase === 'wave' ? Math.max(1, view.wave) : view.wave + 1;
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
  if (me.state === 'dead') return { open: false, text: 'You can shop again after you respawn', mid: false };
  if (view.phase === 'prep') return { open: true, text: 'Stock up before the first wave', mid: false };
  if (view.phase === 'intermission') return { open: true, text: 'Between waves — everything is on sale', mid: false };
  const near = nearSupply(map, view.zone, me.x, me.y, SUPPLY_RADIUS);
  const where = view.zone ? 'the supply drop in the zone' : 'the supply station';
  return near
    ? { open: true, text: `${view.zone ? 'Supply drop' : 'Supply station'} — shopping mid-wave. Watch your back!`, mid: true }
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
  let tab = 'guns';
  let acc = REFRESH;
  let last = { view: null, me: null, cls: 'soldier' };
  const cards = { guns: [], gear: [] };
  const listeners = [];

  const cashEl = h('span.shop-cash');
  const statusEl = h('p.shop-status');
  const closeBtn = h('button.btn-icon.shop-close', { type: 'button', 'aria-label': 'Close shop', text: '✕' });
  const tabGuns = h('button.tab', { type: 'button', role: 'tab', dataset: { tab: 'guns' } }, [h('span', { text: 'Guns' }), h('kbd', { text: 'Q' })]);
  const tabGear = h('button.tab', { type: 'button', role: 'tab', dataset: { tab: 'gear' } }, [h('span', { text: 'Gear' }), h('kbd', { text: 'E' })]);
  const gridGuns = h('div.shop-grid', { role: 'tabpanel', 'aria-label': 'Guns' });
  const gridGear = h('div.shop-grid', { role: 'tabpanel', 'aria-label': 'Gear', hidden: true });
  const foot = h('p.shop-foot', null, [
    h('span', null, [h('kbd', { text: '1' }), '–', h('kbd', { text: '9' }), ' buy']),
    h('span', null, [h('kbd', { text: 'Q' }), ' / ', h('kbd', { text: 'E' }), ' switch tab']),
    h('span', null, [h('kbd', { text: 'B' }), ' / ', h('kbd', { text: 'Esc' }), ' close']),
  ]);
  const card = h('div.shop.panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Supply shop' }, [
    h('header.shop-head', null, [
      h('div.shop-title', null, [h('h2', { text: 'Supply Shop' }), statusEl]),
      h('div.shop-wallet', null, [h('span.shop-wallet-label', { text: 'Cash' }), cashEl]),
      closeBtn,
    ]),
    h('div.tabs', { role: 'tablist' }, [tabGuns, tabGear]),
    h('div.shop-body', null, [gridGuns, gridGear]),
    foot,
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

  // ---- cards ----------------------------------------------------------------------------

  GUN_IDS.forEach((id, i) => {
    const w = WEAPONS[id];
    const st = gunStats(id);
    const dmg = statBar('DMG'), rate = statBar('RATE'), mag = statBar('MAG');
    dmg.fill.style.width = `${Math.round(st.damage * 100)}%`;
    rate.fill.style.width = `${Math.round(st.rate * 100)}%`;
    mag.fill.style.width = `${Math.round(st.mag * 100)}%`;
    const price = h('span.card-price');
    const tag = h('span.card-tag');
    const b = h('button.shop-card.gun', { type: 'button', dataset: { id } }, [
      h('span.card-key', { text: i < 9 ? String(i + 1) : '' }),
      h('div.card-head', null, [h('span.card-name', { text: w.name }), h('span.card-cat', { text: CATEGORY[w.category] || w.category })]),
      h('div.card-trait', { text: gunTrait(w) }),
      h('div.card-stats', null, [dmg.el, rate.el, mag.el]),
      h('div.card-foot', null, [tag, price]),
    ]);
    on(b, 'click', () => buy(id));
    gridGuns.appendChild(b);
    cards.guns.push({ id, el: b, price, tag });
  });

  ITEM_IDS.forEach((id, i) => {
    const it = ITEMS[id];
    const price = h('span.card-price');
    const tag = h('span.card-tag');
    const have = h('span.card-have');
    const b = h('button.shop-card.gear', { type: 'button', dataset: { id } }, [
      h('span.card-key', { text: i < 9 ? String(i + 1) : '' }),
      h('div.card-head', null, [h('span.card-name', { text: it.name }), have]),
      h('div.card-desc', { text: it.desc }),
      h('div.card-foot', null, [tag, price]),
    ]);
    on(b, 'click', () => buy(id));
    gridGear.appendChild(b);
    cards.gear.push({ id, el: b, price, tag, have });
  });

  function setTab(t) {
    tab = t === 'gear' ? 'gear' : 'guns';
    setAttr(tabGuns, 'aria-selected', tab === 'guns' ? 'true' : 'false');
    setAttr(tabGear, 'aria-selected', tab === 'gear' ? 'true' : 'false');
    setClass(tabGuns, 'active', tab === 'guns');
    setClass(tabGear, 'active', tab === 'gear');
    gridGuns.hidden = tab !== 'guns';
    gridGear.hidden = tab !== 'gear';
  }
  setTab('guns');
  on(tabGuns, 'click', () => {
    audio.ui('click');
    setTab('guns');
  });
  on(tabGear, 'click', () => {
    audio.ui('click');
    setTab('gear');
  });
  on(closeBtn, 'click', () => close());
  on(el, 'mousedown', (e) => {
    if (e.target === el) close();
  });
  on(el, 'contextmenu', (e) => e.preventDefault());

  function visibleCards() {
    return cards[tab];
  }

  function onKey(e) {
    if (!open) return;
    const code = e.code;
    let n = -1;
    if (/^Digit[1-9]$/.test(code)) n = Number(code.slice(5)) - 1;
    else if (/^Numpad[1-9]$/.test(code)) n = Number(code.slice(6)) - 1;
    if (n >= 0) {
      e.preventDefault();
      const c = visibleCards()[n];
      if (c) {
        c.el.focus({ preventScroll: false });
        if (!c.el.disabled) buy(c.id);
      }
      return;
    }
    if (code === 'KeyQ' || code === 'BracketLeft') {
      setTab('guns');
      e.preventDefault();
    } else if (code === 'KeyE' || code === 'BracketRight') {
      setTab('gear');
      e.preventDefault();
    } else if (code.startsWith('Arrow')) {
      e.preventDefault();
      move(code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : code === 'ArrowUp' ? -cols() : cols());
    }
  }
  on(window, 'keydown', onKey);

  function cols() {
    const list = visibleCards();
    if (list.length < 2) return 1;
    const top = list[0].el.offsetTop;
    let n = 0;
    for (const c of list) {
      if (c.el.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }

  function move(delta) {
    const list = visibleCards();
    let i = list.findIndex((c) => c.el === document.activeElement);
    if (i < 0) i = 0;
    else i = Math.max(0, Math.min(list.length - 1, i + delta));
    list[i].el.focus();
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
    for (const c of cards.guns) {
      const w = WEAPONS[c.id];
      const reason = state.open ? blockReason(c.id, view, me, cls) : 'closed';
      const owned = ownedSlot(me, c.id) >= 0;
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
        setText(c.price, reason === 'full' ? 'Full' : `Ammo ${formatCash(ammoPrice(c.id))}`);
      } else {
        setText(c.tag, '');
        setText(c.price, formatCash(w.price));
      }
    }
    for (const c of cards.gear) {
      const reason = state.open ? blockReason(c.id, view, me, cls) : 'closed';
      setClass(c.el, 'poor', reason === 'cash');
      setClass(c.el, 'maxed', reason === 'max' || reason === 'full');
      c.el.disabled = reason === 'closed' || reason === 'na' || reason === 'max' || reason === 'full';
      c.el.hidden = c.id === 'repair' && view && !view.objective;
      setText(c.have, view ? haveText(c.id, view, me, cls) : '');
      setText(c.tag, reason === 'max' ? 'Maxed' : reason === 'full' ? 'Owned' : '');
      setText(c.price, formatCash(priceOf(c.id, me, cls)));
    }
  }

  function flash(item, cls) {
    const c = cards.guns.find((q) => q.id === item) || cards.gear.find((q) => q.id === item);
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

  return {
    el,
    get isOpen() {
      return open;
    },
    open(which) {
      if (which) setTab(which);
      if (open) return;
      open = true;
      el.hidden = false;
      acc = REFRESH;
      refresh();
      const first = visibleCards().find((c) => !c.el.disabled && !c.el.hidden);
      if (first && !matchMedia('(pointer: coarse)').matches) first.el.focus({ preventScroll: true });
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
      if (n.tabPrev) setTab('guns');
      if (n.tabNext) setTab('gear');
      if (n.left) move(-1);
      if (n.right) move(1);
      if (n.up) move(-cols());
      if (n.down) move(cols());
      if (n.accept) {
        const c = visibleCards().find((q) => q.el === document.activeElement);
        if (c && !c.el.disabled) buy(c.id);
      }
      if (n.back) close();
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
