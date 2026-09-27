// UI logic that runs without a browser: input edge semantics (with fake DOM targets),
// join-code parsing, preference storage, shop rules and scoreboard rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInput } from '../public/js/ui/input.js';
import { parseJoinInput, perkLines } from '../public/js/ui/menus.js';
import { loadPrefs, savePrefs, cleanName, DEFAULT_CLIENT_SETTINGS } from '../public/js/ui/storage.js';
import { priceOf, shopWave, blockReason, shopState, gunStats } from '../public/js/ui/shop.js';
import { statRows } from '../public/js/ui/scoreboard.js';
import { CLASS_IDS } from '../public/js/shared/classes.js';
import { WEAPON_IDS } from '../public/js/shared/weapons.js';
import { ITEMS, ammoPrice } from '../public/js/shared/items.js';
import { SUPPLY_RADIUS } from '../public/js/shared/constants.js';

// ---- fake DOM for input.js ------------------------------------------------------------

function fakeDom() {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.defaultView = win;
  doc.visibilityState = 'visible';
  doc.body = { tagName: 'BODY' };
  const canvas = new EventTarget();
  canvas.ownerDocument = doc;
  canvas.parentElement = null;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  let count = 0;
  for (const t of [win, doc, canvas]) {
    const add = t.addEventListener.bind(t);
    const rem = t.removeEventListener.bind(t);
    t.addEventListener = (...a) => {
      count++;
      add(...a);
    };
    t.removeEventListener = (...a) => {
      count--;
      rem(...a);
    };
  }
  return { win, doc, canvas, listeners: () => count };
}

function key(target, type, code, extra = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, key: extra.key || code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  target.dispatchEvent(e);
  return e;
}

function mouse(target, type, props) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { clientX: 0, clientY: 0, button: 0, ...props });
  target.dispatchEvent(e);
  return e;
}

test('input: edge fields are true for exactly one sample', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  key(win, 'keydown', 'KeyR');
  key(win, 'keydown', 'KeyG');
  key(win, 'keydown', 'KeyB');
  key(win, 'keydown', 'Space');
  key(win, 'keydown', 'Escape');
  key(win, 'keydown', 'Enter');
  const a = input.sample();
  assert.equal(a.reload, true);
  assert.equal(a.frag, true);
  assert.equal(a.shop, true);
  assert.equal(a.ready, true);
  assert.equal(a.pause, true);
  assert.equal(a.chat, true);
  const b = input.sample();
  for (const f of ['reload', 'frag', 'shop', 'ready', 'pause', 'chat']) assert.equal(b[f], false, f);
  // holding the key (auto-repeat) must not re-trigger
  key(win, 'keydown', 'KeyR', { repeat: true });
  assert.equal(input.sample().reload, false);
  input.destroy();
});

test('input: WASD and arrows both move, diagonals are normalised', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  key(win, 'keydown', 'KeyW');
  key(win, 'keydown', 'ArrowRight');
  const s = input.sample();
  assert.ok(Math.abs(Math.hypot(s.moveX, s.moveY) - 1) < 1e-9);
  assert.ok(s.moveX > 0 && s.moveY < 0);
  key(win, 'keyup', 'KeyW');
  key(win, 'keyup', 'ArrowRight');
  key(win, 'keydown', 'ArrowDown');
  key(win, 'keydown', 'KeyS');
  const t = input.sample();
  assert.equal(t.moveX, 0);
  assert.equal(t.moveY, 1);
  input.destroy();
});

test('input: held buttons, slots, last weapon, wheel cycling', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  key(win, 'keydown', 'ShiftLeft');
  key(win, 'keydown', 'KeyE');
  key(win, 'keydown', 'Tab');
  key(win, 'keydown', 'Digit3');
  key(win, 'keydown', 'KeyQ');
  mouse(canvas, 'mousedown', { button: 0 });
  mouse(canvas, 'mousedown', { button: 2 });
  let s = input.sample();
  assert.equal(s.sprint, true);
  assert.equal(s.interact, true);
  assert.equal(s.scoreboard, true);
  assert.equal(s.fire, true);
  assert.equal(s.melee, true);
  assert.equal(s.slot, 2);
  assert.equal(s.lastWeapon, true);
  s = input.sample();
  assert.equal(s.slot, -1);
  assert.equal(s.lastWeapon, false);
  assert.equal(s.fire, true, 'fire stays held until mouseup');
  mouse(win, 'mouseup', { button: 0 });
  assert.equal(input.sample().fire, false);
  mouse(canvas, 'wheel', { deltaY: 120, deltaMode: 0 });
  assert.equal(input.sample().cycle, 1);
  assert.equal(input.sample().cycle, 0);
  mouse(canvas, 'wheel', { deltaY: -3, deltaMode: 1 });
  assert.equal(input.sample().cycle, -1);
  input.destroy();
});

test('input: blur releases everything so nobody keeps running', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  key(win, 'keydown', 'KeyD');
  key(win, 'keydown', 'ShiftLeft');
  mouse(canvas, 'mousedown', { button: 0 });
  assert.equal(input.sample().moveX, 1);
  win.dispatchEvent(new Event('blur'));
  const s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.sprint, false);
  assert.equal(s.fire, false);
  input.destroy();
});

test('input: disabled input is neutral but UI edges still work; stale presses are dropped', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  key(win, 'keydown', 'KeyW');
  input.setEnabled(false);
  key(win, 'keydown', 'KeyR');
  key(win, 'keydown', 'Escape');
  let s = input.sample();
  assert.equal(s.moveY, 0);
  assert.equal(s.reload, false);
  assert.equal(s.pause, true, 'Esc must still reach the UI to close menus');
  key(win, 'keydown', 'KeyG');
  input.setEnabled(true);
  s = input.sample();
  assert.equal(s.frag, false, 'a press made while a menu was open must not fire afterwards');
  assert.equal(s.moveY, -1, 'a key still held after the menu closes keeps working');
  input.destroy();
});

test('input: keys typed into text fields never reach the game, but keyup always releases', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  const field = new EventTarget();
  field.tagName = 'INPUT';
  field.type = 'text';
  key(win, 'keydown', 'KeyA');
  // chat opens while A is held; the release happens inside the text field
  const up = new Event('keyup');
  Object.assign(up, { code: 'KeyA' });
  field.addEventListener('keyup', (e) => win.dispatchEvent(Object.assign(new Event('keyup'), { code: e.code })));
  field.dispatchEvent(up);
  const typed = new Event('keydown', { cancelable: true });
  Object.assign(typed, { code: 'KeyR', repeat: false });
  // dispatch on window but with a text-field target
  Object.defineProperty(typed, 'target', { value: field });
  win.dispatchEvent(typed);
  const s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.reload, false);
  input.destroy();
});

test('input: destroy removes every listener it added', () => {
  const dom = fakeDom();
  const before = dom.listeners();
  const input = createInput(dom.canvas);
  assert.ok(dom.listeners() > before);
  input.destroy();
  assert.equal(dom.listeners(), before);
});

test('input: aim point comes from the cursor for mouse players', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  mouse(win, 'mousemove', { clientX: 321, clientY: 123 });
  const s = input.sample();
  assert.equal(s.aimScreenX, 321);
  assert.equal(s.aimScreenY, 123);
  assert.deepEqual({ ...input.cursor }, { x: 321, y: 123 });
  input.destroy();
});

// ---- join codes -----------------------------------------------------------------------------

test('parseJoinInput accepts codes, messy input and invite links', () => {
  assert.deepEqual(parseJoinInput('abcde'), { code: 'ABCDE', via: undefined });
  assert.deepEqual(parseJoinInput('  ab cd e '), { code: 'ABCDE', via: undefined });
  assert.deepEqual(parseJoinInput('https://horde.example.com/?join=HWY42&via=relay'), { code: 'HWY42', via: 'relay' });
  assert.deepEqual(parseJoinInput('http://x/y/index.html?foo=1&join=qrstu'), { code: 'QRSTU', via: undefined });
  // letters outside the room-code alphabet (0 O 1 I L) are dropped
  assert.equal(parseJoinInput('O0I1LABCDEF').code, 'ABCDE');
  assert.equal(parseJoinInput('').code, '');
});

// ---- storage -----------------------------------------------------------------------------------

function withStorage(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const old = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { value: old, configurable: true, writable: true });
    else delete globalThis.localStorage;
  }
}

test('prefs round-trip through localStorage and garbage is ignored', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  withStorage(store, () => {
    const p = loadPrefs();
    assert.equal(p.name, '');
    assert.deepEqual(p.settings, DEFAULT_CLIENT_SETTINGS);
    p.name = 'Doc';
    p.cls = 'medic';
    p.color = 3;
    p.settings.master = 0.3;
    p.lobby.waves = 20;
    assert.equal(savePrefs(p), true);
    const q = loadPrefs();
    assert.equal(q.name, 'Doc');
    assert.equal(q.cls, 'medic');
    assert.equal(q.color, 3);
    assert.equal(q.settings.master, 0.3);
    assert.equal(q.lobby.waves, 20);
    mem.set([...mem.keys()][0], JSON.stringify({ name: 42, cls: 'wizard', color: 99, settings: { master: 7, quality: 'insane' }, lobby: { waves: 13 } }));
    const r = loadPrefs();
    assert.equal(r.name, '');
    assert.equal(r.cls, CLASS_IDS[0]);
    assert.equal(r.color, 0);
    assert.equal(r.settings.master, 1);
    assert.equal(r.settings.quality, 'high');
    assert.equal(r.lobby.waves, 15);
    mem.set([...mem.keys()][0], '{not json');
    assert.equal(loadPrefs().name, '');
  });
});

test('prefs survive a storage that throws (private mode, blocked cookies)', () => {
  const store = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  withStorage(store, () => {
    const p = loadPrefs();
    assert.equal(typeof p.name, 'string');
    assert.equal(savePrefs(p), false);
  });
});

test('cleanName trims, collapses spaces and caps the length', () => {
  assert.equal(cleanName('  Big   Mike  '), 'Big Mike');
  assert.equal(cleanName('x'.repeat(40)).length, 16);
  assert.equal(cleanName(null), '');
});

// ---- shop rules ----------------------------------------------------------------------------------

function player(over = {}) {
  return {
    id: 1, x: 0, y: 0, state: 'alive', hp: 100, maxHp: 100, armor: 0, cash: 10000,
    slots: ['pistol', 'rifle', null], slot: 1, ammo: [[12, -1], [30, 270], [0, 0]],
    frags: 0, molotovs: 0, turrets: 0, barricades: 0, selfRevive: false, ...over,
  };
}
function view(over = {}) {
  return { phase: 'intermission', wave: 2, objective: { hp: 500, maxHp: 1000 }, turrets: [], barricades: [], players: [], ...over };
}

test('shop prices: owned guns cost an ammo refill, engineers get cheap turrets', () => {
  const me = player();
  assert.equal(priceOf('rifle', me, 'soldier'), ammoPrice('rifle'));
  assert.equal(priceOf('shotgun', me, 'soldier'), 1100);
  assert.equal(priceOf('turret', me, 'engineer'), ITEMS.turret.price / 2);
  assert.equal(priceOf('turret', me, 'soldier'), ITEMS.turret.price);
  assert.equal(priceOf('medkit', me, 'soldier'), ITEMS.medkit.price);
});

test('shop stock follows the sim: next wave between waves, current wave mid-wave', () => {
  assert.equal(shopWave(view({ phase: 'prep', wave: 0 })), 1);
  assert.equal(shopWave(view({ phase: 'intermission', wave: 4 })), 5);
  assert.equal(shopWave(view({ phase: 'wave', wave: 4 })), 4);
  const me = player();
  assert.equal(blockReason('flamethrower', view({ phase: 'intermission', wave: 4 }), me, 'soldier'), null);
  assert.equal(blockReason('flamethrower', view({ phase: 'wave', wave: 4 }), me, 'soldier'), 'locked');
  assert.equal(blockReason('rifle', view(), me, 'soldier'), 'full');
  assert.equal(blockReason('rifle', view(), player({ ammo: [[12, -1], [30, 100], [0, 0]] }), 'soldier'), null);
  assert.equal(blockReason('shotgun', view(), player({ cash: 10 }), 'soldier'), 'cash');
  assert.equal(blockReason('armor', view(), player({ armor: 100 }), 'soldier'), 'max');
  assert.equal(blockReason('frag', view(), player({ frags: 5 }), 'soldier'), 'max');
  assert.equal(blockReason('frag', view(), player({ frags: 5 }), 'demo'), null, 'demo carries extra frags');
  assert.equal(blockReason('repair', view({ objective: null }), player(), 'soldier'), 'na');
  assert.equal(blockReason('selfrevive', view(), player({ selfRevive: true }), 'soldier'), 'full');
});

test('shop is open between waves and only near the supply station mid-wave', () => {
  const map = { supply: { x: 1000, y: 1000 } };
  assert.equal(shopState(view({ phase: 'prep' }), player(), map).open, true);
  assert.equal(shopState(view({ phase: 'wave' }), player({ x: 1000 + SUPPLY_RADIUS - 1, y: 1000 }), map).open, true);
  assert.equal(shopState(view({ phase: 'wave' }), player({ x: 1000 + SUPPLY_RADIUS + 5, y: 1000 }), map).open, false);
  assert.equal(shopState(view({ phase: 'intermission' }), player({ state: 'downed' }), map).open, false);
  assert.equal(shopState(view({ phase: 'gameover' }), player(), map).open, false);
});

test('every buyable gun has stat bars in 0..1', () => {
  for (const id of WEAPON_IDS) {
    if (id === 'pistol') continue;
    const s = gunStats(id);
    for (const k of ['damage', 'rate', 'mag']) assert.ok(s[k] > 0 && s[k] <= 1, `${id}.${k}=${s[k]}`);
  }
});

// ---- scoreboard / classes --------------------------------------------------------------------------

test('statRows merges roster and snapshot, best first, earned falls back to cash', () => {
  const roster = [
    { id: 1, name: 'A', color: 0, cls: 'soldier', host: true, ping: 0 },
    { id: 2, name: 'B', color: 1, cls: 'medic', host: false, ping: 50 },
    { id: 3, name: 'C', color: 2, cls: 'demo', host: false, ping: 70 },
  ];
  const v = { players: [
    { id: 1, state: 'alive', kills: 5, damage: 100, revives: 0, downs: 1, cash: 300, earned: 900 },
    { id: 2, state: 'downed', kills: 9, damage: 50, revives: 2, downs: 0, cash: 200 },
  ] };
  const rows = statRows(v, roster);
  assert.deepEqual(rows.map((r) => r.id), [2, 1, 3]);
  assert.equal(rows[1].earned, 900);
  assert.equal(rows[0].earned, 200);
  assert.equal(rows[2].state, 'dead', 'a roster entry without a snapshot player (late joiner) shows as dead');
});

test('every class has readable perk lines', () => {
  for (const id of CLASS_IDS) assert.ok(perkLines(id).length >= 2, id);
});

test('phones start on ultra quality until the player picks one; desktops on high', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  const hadMM = 'matchMedia' in globalThis;
  const oldMM = globalThis.matchMedia;
  try {
    globalThis.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' });
    withStorage(store, () => {
      const p = loadPrefs();
      assert.equal(p.settings.quality, 'ultra');
      p.settings.quality = 'low';
      savePrefs(p);
      assert.equal(loadPrefs().settings.quality, 'low', 'an explicit choice sticks');
    });
    globalThis.matchMedia = () => ({ matches: false });
    mem.clear();
    withStorage(store, () => assert.equal(loadPrefs().settings.quality, 'high'));
  } finally {
    if (hadMM) globalThis.matchMedia = oldMM;
    else delete globalThis.matchMedia;
  }
});
