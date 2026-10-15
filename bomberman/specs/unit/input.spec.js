import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../../client/js/input.js';

// ==================================================================================================
// Minimal fake DOM: just enough surface for input.js (events, classes, attributes, rects, pointer capture).
// ==================================================================================================

class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.id = '';
    this.style = { transform: '', props: {}, setProperty(k, v) { this.props[k] = v; } };
    this._classes = new Set();
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => { if (on === undefined ? !this._classes.has(c) : on) this._classes.add(c); else this._classes.delete(c); },
    };
    this.listeners = [];
    this.captured = new Set();
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    this.blurred = 0;
  }

  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  blur() { this.blurred++; }
  addEventListener(type, fn, options) { this.listeners.push({ type, fn, options }); }
  removeEventListener(type, fn, options) {
    const cap = (o) => (typeof o === 'object' ? !!o.capture : !!o);
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && cap(l.options) === cap(options)));
  }

  dispatch(type, init = {}) {
    const ev = { type, target: this, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
    for (const l of [...this.listeners]) if (l.type === type) l.fn(ev);
    return ev;
  }

  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }

  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { if (this.captured.delete(id)) this.dispatch('lostpointercapture', { pointerId: id }); }

  find(cls) {
    for (const c of this.children) {
      if (c.classList.contains(cls)) return c;
      const deep = c.find(cls);
      if (deep) return deep;
    }
    return null;
  }
}

function rig({ touch = true, active = true, width = 390, height = 844, glove = false, withCanvas = true, navigator: nav } = {}) {
  const doc = new FakeEl('document');
  doc.hidden = false;
  doc.activeElement = new FakeEl('button');
  doc.documentElement = { dataset: {} };
  doc.head = new FakeEl('head');
  doc.createElement = (tag) => new FakeEl(tag);
  doc.getElementById = (id) => doc.head.children.find((c) => c.id === id) ?? null;
  const win = new FakeEl('window');
  win.innerWidth = width;
  win.innerHeight = height;
  const pads = [];
  const vibes = [];
  const navigator = nav ?? { vibrate: (ms) => { vibes.push(ms); return true; }, getGamepads: () => pads };
  const root = new FakeEl('div');
  const canvas = new FakeEl('canvas');
  if (width > height) {                                    // landscape: the controls cover the whole screen, the arena sits in the middle
    root.rect = { left: 0, top: 0, width, height };
    canvas.rect = { left: 0, top: 0, width, height };
  } else {                                                 // portrait: arena on top, controls in the strip below
    const arena = Math.round(width * 13 / 15);
    canvas.rect = { left: 0, top: 0, width, height: arena };
    root.rect = { left: 0, top: arena, width, height: height - arena };
  }
  const input = new Input({ canvas: withCanvas ? canvas : null, touchRoot: root, document: doc, window: win, navigator, ResizeObserver: undefined });
  const calls = { emote: [], wheel: 0, menu: 0, mute: 0 };
  input.onEmote((n) => calls.emote.push(n));
  input.onWheel(() => calls.wheel++);
  input.onMenu(() => calls.menu++);
  input.onMute(() => calls.mute++);
  if (touch) input.enableTouch(true);
  if (active) input.setActive(true);
  if (glove) input.setHasGlove(true);
  const wrap = root.find('bp-touch');
  return {
    input, doc, win, root, canvas, calls, pads, vibes, nav: navigator, wrap,
    zone: root.find('bp-zone'), bomb: root.find('bp-bomb'), special: root.find('bp-special'), emote: root.find('bp-emote'),
    knob: root.find('bp-knob'), stick: root.find('bp-stick'),
    intent: () => { const i = input.getIntent(); return { d: i.d, bomb: i.bomb, special: i.special }; },
  };
}

const key = (doc, type, code, extra = {}) => doc.dispatch(type, { code, key: '?', repeat: false, target: doc.activeElement, ...extra });
const down = (r, code, extra) => key(r.doc, 'keydown', code, extra);
const up = (r, code, extra) => key(r.doc, 'keyup', code, extra);
const ptr = (el, type, id, x, y, extra = {}) => el.dispatch(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, ...extra });

// ==================================================================================================
// Keyboard
// ==================================================================================================

test('keyboard: directions come from e.code - arrows and WASD (physical positions), never from e.key', () => {
  const r = rig({ touch: false });
  for (const [code, d] of [['ArrowUp', 1], ['KeyW', 1], ['ArrowRight', 2], ['KeyD', 2], ['ArrowDown', 3], ['KeyS', 3], ['ArrowLeft', 4], ['KeyA', 4]]) {
    down(r, code, { key: 'z' });                              // an AZERTY keyboard, a Shift-uppercase, Android's "Unidentified": key is useless
    assert.equal(r.intent().d, d, code);
    up(r, code);
    assert.equal(r.intent().d, 0, `${code} released`);
  }
  down(r, 'KeyZ', { key: 'w' });                              // a key that only LOOKS like W
  down(r, 'KeyQ', { key: 'a' });
  assert.equal(r.intent().d, 0);
});

test('keyboard: the last pressed axis wins, opposite keys cancel, two keys for one direction count once', () => {
  const r = rig({ touch: false });
  down(r, 'ArrowRight');
  down(r, 'ArrowUp');
  assert.equal(r.intent().d, 1, 'up was pressed last');
  up(r, 'ArrowUp');
  assert.equal(r.intent().d, 2, 'and right takes over again when up is let go');
  down(r, 'ArrowDown');
  assert.equal(r.intent().d, 3, 'down is the newest press of the vertical axis, which is newer than the horizontal one');
  down(r, 'ArrowLeft');
  assert.equal(r.intent().d, 3, 'right + left cancel each other, so only the vertical axis has a say');
  up(r, 'ArrowDown');
  assert.equal(r.intent().d, 0, 'nothing but a cancelled axis is left');
  down(r, 'ArrowUp');
  assert.equal(r.intent().d, 1);
  up(r, 'ArrowRight');
  assert.equal(r.intent().d, 1, 'left is held too, but up is the newer axis');
  up(r, 'ArrowUp');
  assert.equal(r.intent().d, 4, 'and left resumes');
  up(r, 'ArrowLeft');
  assert.equal(r.intent().d, 0);

  down(r, 'ArrowUp');
  down(r, 'KeyW');
  up(r, 'ArrowUp');
  assert.equal(r.intent().d, 1, 'W still holds it');
  up(r, 'KeyW');
  assert.equal(r.intent().d, 0);
  down(r, 'ArrowUp');
  down(r, 'ArrowDown');
  assert.equal(r.intent().d, 0, 'opposite keys cancel');
  up(r, 'ArrowUp');
  assert.equal(r.intent().d, 3, 'and the one still held resumes');
});

test('keyboard: bomb and special are latched taps - one per press, however long it is held or how many frames pass', () => {
  const r = rig({ touch: false });
  for (const code of ['Space', 'Enter', 'NumpadEnter', 'KeyJ', 'Numpad0']) {
    down(r, code);
    assert.deepEqual(r.intent(), { d: 0, bomb: true, special: false }, code);
    assert.equal(r.intent().bomb, false, `${code}: consumed by the read`);
    down(r, code, { repeat: true });
    down(r, code, { repeat: true });
    assert.equal(r.intent().bomb, false, `${code}: auto-repeat is not a new press`);
    up(r, code);
  }
  for (const code of ['KeyE', 'KeyK', 'ShiftLeft', 'ShiftRight']) {
    down(r, code);
    assert.deepEqual(r.intent(), { d: 0, bomb: false, special: true }, code);
    up(r, code);
  }
  down(r, 'Space');
  up(r, 'Space');
  down(r, 'Space');
  assert.equal(r.intent().bomb, true, 'two presses between two frames are one tap (one frame, one cmd)');
  assert.equal(r.intent().bomb, false);
});

test('keyboard: the hooks - emotes 1-6, wheel T, mute M, menu Esc; everything else does nothing', () => {
  const r = rig({ touch: false });
  for (const [code, idx] of [['Digit1', 0], ['Digit6', 5], ['Numpad1', 0], ['Numpad4', 3]]) down(r, code);
  assert.deepEqual(r.calls.emote, [0, 5, 0, 3]);
  down(r, 'Digit7');
  down(r, 'Digit0');
  down(r, 'Numpad7');
  assert.deepEqual(r.calls.emote, [0, 5, 0, 3], 'the wheel offers 7 and 8, the keys stop at 6');
  down(r, 'KeyT');
  down(r, 'KeyM');
  down(r, 'Escape');
  down(r, 'Escape', { repeat: true });
  assert.deepEqual([r.calls.wheel, r.calls.mute, r.calls.menu], [1, 1, 1]);
  down(r, 'KeyX');
  down(r, 'F5');
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
});

test('keyboard: with an empty e.code the keyCode of old TV browsers is used, including their back keys', () => {
  const r = rig({ touch: false });
  const legacy = (type, keyCode) => r.doc.dispatch(type, { code: '', keyCode, key: 'Unidentified', repeat: false, target: r.doc.activeElement });
  for (const [kc, d] of [[38, 1], [39, 2], [40, 3], [37, 4], [87, 1], [68, 2], [83, 3], [65, 4]]) {
    legacy('keydown', kc);
    assert.equal(r.intent().d, d, `keyCode ${kc}`);
    legacy('keyup', kc);
  }
  legacy('keydown', 13);
  assert.equal(r.intent().bomb, true);
  legacy('keydown', 32);
  assert.equal(r.intent().bomb, true);
  legacy('keydown', 69);
  assert.equal(r.intent().special, true);
  legacy('keydown', 16);
  assert.equal(r.intent().special, true);
  for (const kc of [27, 10009, 461]) legacy('keydown', kc);
  assert.equal(r.calls.menu, 3);
  legacy('keydown', 99);
  legacy('keydown', 0);
});

test('keyboard: ignored while typing, composing, or with a modifier; keys are swallowed only when they mean something', () => {
  const r = rig({ touch: false });
  for (const tag of ['input', 'textarea', 'select']) {
    const ev = down(r, 'Space', { target: new FakeEl(tag) });
    assert.equal(ev.defaultPrevented, false, `${tag}: the page keeps its keys`);
  }
  const editable = new FakeEl('div');
  editable.isContentEditable = true;
  assert.equal(down(r, 'KeyW', { target: editable }).defaultPrevented, false);
  assert.equal(down(r, 'Space', { isComposing: true }).defaultPrevented, false);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(down(r, 'KeyW', { [mod]: true }).defaultPrevented, false, `${mod}+W is a browser shortcut`);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  assert.equal(down(r, 'Space').defaultPrevented, true);
  assert.equal(down(r, 'ArrowUp').defaultPrevented, true);
  assert.equal(down(r, 'Space', { repeat: true }).defaultPrevented, true, 'a repeating Space must not click a focused button either');
  assert.equal(up(r, 'Space').defaultPrevented, true);
  assert.equal(down(r, 'KeyX').defaultPrevented, false);
  assert.equal(down(r, 'Tab').defaultPrevented, false, 'Tab still moves focus');
});

test('keyboard: a keyup is honoured whatever the modifiers or the focus, so no key can stick', () => {
  const r = rig({ touch: false });
  down(r, 'ArrowRight');
  up(r, 'ArrowRight', { ctrlKey: true, target: new FakeEl('input') });
  assert.equal(r.intent().d, 0);
});

test('inactive: nothing is captured, nothing is reported, the page keeps every key', () => {
  const r = rig({ touch: false, active: false });
  assert.equal(down(r, 'Space').defaultPrevented, false);
  down(r, 'ArrowUp');
  down(r, 'Digit1');
  down(r, 'Escape');
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  assert.deepEqual([r.calls.emote.length, r.calls.menu], [0, 0]);
  r.input.setActive(true);
  assert.equal(r.doc.activeElement.blurred, 1, 'entering the game blurs the focused button');
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false }, 'keys pressed while inactive do not show up later');
  down(r, 'ArrowUp');
  assert.equal(r.intent().d, 1);
  r.input.setActive(false);
  assert.equal(r.intent().d, 0, 'leaving the game screen lets go of everything');
  r.input.setActive(true);
  assert.equal(r.intent().d, 0);
});

test('releaseAll: blur, visibilitychange, pagehide and contextmenu let go of held keys and latched taps', () => {
  for (const [target, type] of [['win', 'blur'], ['doc', 'visibilitychange'], ['win', 'pagehide'], ['doc', 'contextmenu']]) {
    const r = rig({ touch: false });
    down(r, 'ArrowRight');
    down(r, 'Space');
    down(r, 'KeyE');
    const ev = r[target].dispatch(type);
    assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false }, type);
    assert.equal(ev.defaultPrevented, type === 'contextmenu', `${type}: only the context menu is cancelled`);
    up(r, 'ArrowRight');
    assert.equal(r.intent().d, 0);
  }
  const off = rig({ touch: false, active: false });
  assert.equal(off.doc.dispatch('contextmenu').defaultPrevented, false, 'the browser menu works outside the game');
});

// ==================================================================================================
// Touch
// ==================================================================================================

test('touch: the controls are real buttons with labels, hidden until the game screen is active and touch is on', () => {
  const off = rig({ touch: false, active: true });
  assert.equal(off.wrap.hidden, true);
  const idle = rig({ touch: true, active: false });
  assert.equal(idle.wrap.hidden, true);
  const on = rig({ glove: true });
  assert.equal(on.wrap.hidden, false);
  for (const [b, label] of [[on.bomb, 'Place bomb'], [on.special, 'Throw bomb'], [on.emote, 'Emotes']]) {
    assert.equal(b.tagName, 'BUTTON');
    assert.equal(b.getAttribute('type'), 'button');
    assert.equal(b.getAttribute('aria-label'), label);
  }
  on.input.setActive(false);
  assert.equal(on.wrap.hidden, true);
  on.input.enableTouch(false);
  on.input.setActive(true);
  assert.equal(on.wrap.hidden, true);
  assert.equal(on.doc.head.children.filter((c) => c.id === 'bp-input-style').length, 1);
  assert.match(on.doc.getElementById('bp-input-style').textContent, /\.bp-touch/);
  assert.equal(rig().doc.head.children.length, 1);
});

test('touch: the special button exists only while the fighter owns a glove', () => {
  const r = rig();
  assert.equal(r.special.hidden, true);
  r.input.setHasGlove(true);
  assert.equal(r.special.hidden, false);
  ptr(r.special, 'pointerdown', 1, 0, 0);
  assert.equal(r.intent().special, true);
  assert.equal(r.intent().special, false);
  r.input.setHasGlove(false);
  assert.equal(r.special.hidden, true);
});

test('touch joystick: appears where the thumb lands, dead zone and hysteresis, four directions, released on lift', () => {
  const r = rig();
  const zone = r.zone;
  ptr(zone, 'pointerdown', 7, 100, 500);
  assert.equal(zone.captured.has(7), true, 'pointer capture, so the drag survives leaving the zone');
  assert.equal(r.stick.classList.contains('bp-on'), true);
  assert.match(r.stick.style.transform, /translate\(100px,\s*0?/);                       // relative to the wrapper (its top is 338 in this rig)
  assert.equal(r.stick.style.transform, 'translate(100px,162px)');
  assert.equal(r.intent().d, 0);
  ptr(zone, 'pointermove', 7, 109, 500);
  assert.equal(r.intent().d, 0, 'inside the dead zone');
  ptr(zone, 'pointermove', 7, 117, 500);
  assert.equal(r.intent().d, 0, '17 px: still short of engaging');
  ptr(zone, 'pointermove', 7, 120, 500);
  assert.equal(r.intent().d, 2, '20 px right engages');
  ptr(zone, 'pointermove', 7, 112, 500);
  assert.equal(r.intent().d, 2, '12 px: hysteresis keeps it engaged');
  ptr(zone, 'pointermove', 7, 109, 500);
  assert.equal(r.intent().d, 0, 'under 10 px it lets go');
  ptr(zone, 'pointermove', 7, 80, 500);
  assert.equal(r.intent().d, 4);
  ptr(zone, 'pointermove', 7, 80, 475);                        // 20 left, 25 up: not yet enough to leave the horizontal axis (needs 35 % more: 27)
  assert.equal(r.intent().d, 4);
  ptr(zone, 'pointermove', 7, 80, 460);                        // 20 left, 40 up
  assert.equal(r.intent().d, 1);
  ptr(zone, 'pointermove', 7, 74, 460);                        // 26 left, 40 up: vertical holds on
  assert.equal(r.intent().d, 1);
  ptr(zone, 'pointermove', 7, 100, 530);
  assert.equal(r.intent().d, 3);
  ptr(zone, 'pointerup', 7, 100, 530);
  assert.equal(r.intent().d, 0);
  assert.equal(r.stick.classList.contains('bp-on'), false);
  assert.equal(zone.captured.size, 0);
});

test('touch joystick: it floats - dragged past its ring it takes the origin along, so turning around is a short swipe', () => {
  const r = rig();
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.zone, 'pointermove', 1, 300, 500);
  assert.equal(r.intent().d, 2);
  assert.equal(r.knob.style.props['--bp-kx'], '56px', 'the knob stops at the ring');
  ptr(r.zone, 'pointermove', 1, 260, 500);                     // still right of the origin that followed the thumb (at 244)
  assert.equal(r.intent().d, 2);
  ptr(r.zone, 'pointermove', 1, 214, 500);                     // 30 px left of it: an 86 px swipe back, not 200
  assert.equal(r.intent().d, 4);
  ptr(r.zone, 'pointermove', 1, 300, 300);
  assert.equal(r.intent().d, 1);
});

test('touch joystick: cancel, lost capture, touchcancel, blur and a hidden tab all let go', () => {
  for (const how of ['pointercancel', 'lostpointercapture', 'touchcancel', 'blur', 'visibilitychange']) {
    const r = rig();
    ptr(r.zone, 'pointerdown', 3, 100, 500);
    ptr(r.zone, 'pointermove', 3, 150, 500);
    ptr(r.bomb, 'pointerdown', 4, 0, 0);
    assert.equal(r.intent().d, 2, how);
    ptr(r.bomb, 'pointerup', 4, 0, 0);
    ptr(r.bomb, 'pointerdown', 4, 0, 0);                        // (a tap latched but not yet read)
    if (how === 'pointercancel' || how === 'lostpointercapture') r.zone.dispatch(how, { pointerId: 3 });
    else if (how === 'touchcancel') r.wrap.dispatch(how);
    else if (how === 'blur') r.win.dispatch(how);
    else r.doc.dispatch(how);
    const got = r.intent();
    assert.equal(got.d, 0, how);
    if (how === 'touchcancel' || how === 'blur' || how === 'visibilitychange') assert.equal(got.bomb, false, `${how} also drops the latched tap`);
    assert.equal(r.stick.classList.contains('bp-on'), false);
    ptr(r.zone, 'pointermove', 3, 200, 500);
    assert.equal(r.intent().d, 0, 'a pointer that is gone does not steer');
  }
});

test('touch multi-touch: the stick and BOMB work at once; strangers neither steer nor release', () => {
  const r = rig({ glove: true });
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.zone, 'pointermove', 1, 140, 500);
  ptr(r.bomb, 'pointerdown', 2, 300, 700);
  assert.deepEqual(r.intent(), { d: 2, bomb: true, special: false });
  assert.equal(r.bomb.classList.contains('bp-down'), true);
  ptr(r.zone, 'pointerdown', 3, 60, 600);                       // a third finger in the zone
  ptr(r.zone, 'pointermove', 3, 60, 700);
  ptr(r.zone, 'pointerup', 3, 60, 700);
  assert.equal(r.intent().d, 2, 'the stick belongs to pointer 1 only');
  ptr(r.bomb, 'pointerup', 2, 300, 700);
  assert.equal(r.bomb.classList.contains('bp-down'), false);
  assert.equal(r.intent().d, 2, 'lifting the BOMB finger leaves the stick alone');
  ptr(r.bomb, 'pointerup', 9, 300, 700);                        // an unrelated pointer id on a button changes nothing
  ptr(r.zone, 'pointerup', 1, 140, 500);
  assert.equal(r.intent().d, 0);
});

test('touch buttons: BOMB is one tap per press with a 10 ms buzz; keyboard/remote activation is a click without a pointer', () => {
  const r = rig();
  ptr(r.bomb, 'pointerdown', 1, 0, 0);
  assert.deepEqual(r.vibes, [10]);
  assert.deepEqual(r.intent(), { d: 0, bomb: true, special: false });
  assert.equal(r.intent().bomb, false, 'holding the button is not repeat-fire');
  ptr(r.bomb, 'pointerup', 1, 0, 0);
  r.bomb.dispatch('click', { detail: 1 });
  assert.equal(r.intent().bomb, false, 'the click that follows a tap must not count twice');
  r.bomb.dispatch('click', { detail: 0 });
  assert.equal(r.intent().bomb, true, 'Enter on a focused button (TV remote) does');
  ptr(r.bomb, 'pointerdown', 2, 0, 0, { pointerType: 'mouse', button: 2 });
  assert.equal(r.intent().bomb, false, 'right-click is not a bomb');
  r.emote.dispatch('click', { detail: 0 });
  ptr(r.emote, 'pointerdown', 5, 0, 0);
  assert.equal(r.calls.wheel, 2);
  assert.equal(r.calls.emote.length, 0);

  const noVibrate = rig({ navigator: { getGamepads: () => [] } });
  ptr(noVibrate.bomb, 'pointerdown', 1, 0, 0);
  assert.equal(noVibrate.intent().bomb, true);
  const throwing = rig({ navigator: { vibrate: () => { throw new Error('blocked'); } } });
  ptr(throwing.bomb, 'pointerdown', 1, 0, 0);
  assert.equal(throwing.intent().bomb, true);
});

test('touch: pointers are ignored while inactive or with touch off', () => {
  const r = rig();
  r.input.setActive(false);
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.zone, 'pointermove', 1, 200, 500);
  ptr(r.bomb, 'pointerdown', 2, 0, 0);
  r.input.setActive(true);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  r.input.enableTouch(false);
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.bomb, 'pointerdown', 2, 0, 0);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  r.input.enableTouch(true);
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.zone, 'pointermove', 1, 100, 400);
  assert.equal(r.intent().d, 1);
  r.input.enableTouch(false);
  assert.equal(r.intent().d, 0, 'switching touch off drops the stick');
});

test('touch: iOS gestures are suppressed - but only while the game is active', () => {
  const r = rig();
  for (const type of ['gesturestart', 'selectstart', 'contextmenu']) assert.equal(r.doc.dispatch(type).defaultPrevented, true, type);
  assert.equal(r.wrap.dispatch('touchmove').defaultPrevented, true, 'no scroll or overscroll from a drag');
  assert.equal(r.canvas.dispatch('touchmove').defaultPrevented, true);
  assert.equal(r.wrap.dispatch('touchmove', { cancelable: false }).defaultPrevented, false);
  assert.equal(r.zone.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 500, pointerType: 'touch', button: 0 }).defaultPrevented, true);
  assert.deepEqual(r.wrap.listeners.filter((l) => l.type === 'touchmove').map((l) => l.options), [{ passive: false }], 'non-passive, or preventDefault would be ignored');
  r.input.setActive(false);
  for (const type of ['gesturestart', 'selectstart', 'contextmenu']) assert.equal(r.doc.dispatch(type).defaultPrevented, false, `${type} outside the game`);
  assert.equal(r.wrap.dispatch('touchmove').defaultPrevented, false);
});

test('layout: portrait strip under the arena - the stick zone is 45 % of the width less the 28 px edge; row layout, compact when short', () => {
  const r = rig({ width: 390, height: 844 });
  assert.equal(r.wrap.getAttribute('data-layout'), 'row');
  assert.equal(r.wrap.style.props['--bp-zone-w'], '148px');
  r.root.rect.height = 200;
  r.input.layout();
  assert.equal(r.wrap.getAttribute('data-layout'), 'compact');
  const small = rig({ width: 320, height: 568 });
  assert.equal(small.wrap.style.props['--bp-zone-w'], '116px');
  const wide = rig({ width: 390, height: 844 });
  wide.root.rect = { left: 0, top: 338, width: 800, height: 400 };          // a strip wider than tall in portrait is still portrait
  wide.input.layout();
  assert.equal(wide.wrap.getAttribute('data-layout'), 'row');
});

test('layout: landscape overlay - the stick zone stops at the centre 60 % of the arena, on either hand', () => {
  const r = rig({ width: 844, height: 390 });
  assert.equal(r.wrap.getAttribute('data-layout'), 'stack');
  // arena: 450 wide, 197..647; its middle 60 % starts at 287; zone starts 28 px in
  assert.equal(r.wrap.style.props['--bp-zone-w'], '259px');
  r.input.setHand('left');
  assert.equal(r.wrap.getAttribute('data-hand'), 'left');
  assert.equal(r.wrap.style.props['--bp-zone-w'], '259px');
  const tablet = rig({ width: 1024, height: 768 });
  assert.equal(tablet.wrap.style.props['--bp-zone-w'], '218px');
  const noCanvas = rig({ width: 844, height: 390, withCanvas: false });
  assert.equal(noCanvas.wrap.style.props['--bp-zone-w'], '352px', 'without a canvas to measure it is the plain 45 %');
  const narrow = rig({ width: 400, height: 380 });                                // a nearly square window: the arena fills it, the zone keeps a usable minimum
  assert.equal(narrow.wrap.getAttribute('data-layout'), 'stack');
  assert.ok(parseFloat(narrow.wrap.style.props['--bp-zone-w']) >= 96);
});

test('hand: swapping sides is data-hand on the wrapper; the initial side comes from the page setting', () => {
  const r = rig();
  assert.equal(r.wrap.getAttribute('data-hand'), 'right');
  r.input.setHand('left');
  assert.equal(r.wrap.getAttribute('data-hand'), 'left');
  r.input.setHand('nonsense');
  assert.equal(r.wrap.getAttribute('data-hand'), 'right');
  const doc = new FakeEl('document');
  doc.documentElement = { dataset: { hand: 'left' } };
  doc.head = new FakeEl('head');
  doc.createElement = (t) => new FakeEl(t);
  doc.getElementById = () => null;
  const root = new FakeEl('div');
  new Input({ touchRoot: root, document: doc, window: new FakeEl('window'), navigator: {}, ResizeObserver: undefined });
  assert.equal(root.find('bp-touch').getAttribute('data-hand'), 'left');
});

test('layout: follows a ResizeObserver when the browser has one', () => {
  const observed = [];
  let fire = null;
  class RO { constructor(fn) { fire = fn; } observe(el) { observed.push(el); } disconnect() { observed.push('disconnected'); } }
  const doc = new FakeEl('document');
  doc.documentElement = { dataset: {} };
  doc.head = new FakeEl('head');
  doc.createElement = (t) => new FakeEl(t);
  doc.getElementById = () => null;
  const win = Object.assign(new FakeEl('window'), { innerWidth: 390, innerHeight: 844 });
  const root = new FakeEl('div');
  root.rect = { left: 0, top: 338, width: 390, height: 506 };
  const canvas = new FakeEl('canvas');
  canvas.rect = { left: 0, top: 0, width: 390, height: 338 };
  const input = new Input({ canvas, touchRoot: root, document: doc, window: win, navigator: {}, ResizeObserver: RO });
  assert.deepEqual(observed, [root, canvas]);
  root.rect.width = 320;
  fire();
  assert.equal(root.find('bp-touch').style.props['--bp-zone-w'], '116px');
  win.dispatch('resize');
  win.dispatch('orientationchange');
  input.destroy();
  assert.equal(observed.at(-1), 'disconnected');
});

test('destroy: every listener, the controls and the style are removed, and nothing reacts afterwards', () => {
  const r = rig({ glove: true });
  assert.ok(r.doc.listeners.length > 0 && r.win.listeners.length > 0);
  down(r, 'ArrowUp');
  r.input.destroy();
  assert.deepEqual([r.doc.listeners.length, r.win.listeners.length, r.root.children.length, r.doc.head.children.length], [0, 0, 0, 0]);
  assert.equal(down(r, 'Space').defaultPrevented, false);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  r.input.destroy();
});

test('robust: callbacks that throw, no callbacks at all, no document at all', () => {
  const r = rig({ touch: false });
  const orig = console.error;
  console.error = () => {};
  try {
    r.input.onEmote(() => { throw new Error('x'); });
    r.input.onMenu(() => { throw new Error('x'); });
    down(r, 'Digit1');
    down(r, 'Escape');
    down(r, 'Space');
    assert.equal(r.intent().bomb, true, 'the input carried on');
  } finally {
    console.error = orig;
  }
  r.input.onEmote(null);
  down(r, 'Digit2');
  const bare = new Input({});
  bare.setActive(true);
  bare.enableTouch(true);
  bare.setHasGlove(true);
  bare.setHand('left');
  bare.layout();
  assert.deepEqual({ ...bare.getIntent() }, { d: 0, bomb: false, special: false });
  bare.releaseAll();
  bare.destroy();
});

// ==================================================================================================
// Gamepad
// ==================================================================================================

const button = (on) => ({ pressed: on, value: on ? 1 : 0 });
const pad = (over = {}) => ({
  connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => button(false)), axes: [0, 0, 0, 0],
  ...over,
});
const press = (p, ...idx) => { for (const i of idx) p.buttons[i] = button(true); return p; };
const release = (p, ...idx) => { for (const i of idx) p.buttons[i] = button(false); return p; };

test('gamepad: buttons 0/1 bomb and 2/3 special are edge-triggered, Start opens the menu, once per press', () => {
  const r = rig({ touch: false });
  const p = pad();
  r.pads.push(p);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  press(p, 0);
  assert.equal(r.intent().bomb, true);
  assert.equal(r.intent().bomb, false, 'held');
  release(p, 0);
  r.intent();
  press(p, 1);
  assert.equal(r.intent().bomb, true);
  release(p, 1);
  r.intent();
  press(p, 2);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: true });
  release(p, 2);
  r.intent();
  press(p, 3);
  assert.equal(r.intent().special, true);
  release(p, 3);
  press(p, 9);
  r.intent();
  r.intent();
  assert.equal(r.calls.menu, 1);
  release(p, 9);
  r.intent();
  press(p, 9);
  r.intent();
  assert.equal(r.calls.menu, 2);
});

test('gamepad: D-pad buttons 12-15 and the left stick with 0.5 / 0.35 hysteresis, dominant axis', () => {
  const r = rig({ touch: false });
  const p = pad();
  r.pads.push(p);
  for (const [b, d] of [[12, 1], [13, 3], [14, 4], [15, 2]]) {
    press(p, b);
    assert.equal(r.intent().d, d, `button ${b}`);
    release(p, b);
  }
  assert.equal(r.intent().d, 0);
  p.axes = [0.4, 0];
  assert.equal(r.intent().d, 0, '0.4 does not engage');
  p.axes = [0.6, 0];
  assert.equal(r.intent().d, 2);
  p.axes = [0.4, 0];
  assert.equal(r.intent().d, 2, '0.4 holds an engaged stick');
  p.axes = [0.3, 0];
  assert.equal(r.intent().d, 0, 'and 0.3 lets go');
  p.axes = [0, -0.8];
  assert.equal(r.intent().d, 1);
  p.axes = [-0.7, 0.55];
  assert.equal(r.intent().d, 4, 'dominant axis');
  p.axes = [-0.5, 0.75];
  assert.equal(r.intent().d, 3);
  p.axes = [0.5, 0.5];
  assert.equal(r.intent().d, 3, 'an engaged stick holds while it is above 0.35 on its axis');
  p.axes = [0, 0];
  r.intent();
  p.axes = [0.5, 0.5];
  assert.equal(r.intent().d, 0, 'but from rest neither axis is past 0.5: no direction');
  p.axes = [0, 0.9];
  press(p, 14);
  assert.equal(r.intent().d, 4, 'the D-pad wins over the stick');
});

test('gamepad: the first connected pad; missing, null or odd pads, and no API at all, are all fine', () => {
  const r = rig({ touch: false });
  r.pads.push(null, pad({ connected: false }), press(pad({ mapping: '' }), 0));
  assert.equal(r.intent().bomb, true, 'a non-standard mapping uses the same indices');
  r.pads.length = 0;
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  r.pads.push({ connected: true });                            // no buttons, no axes
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  const none = rig({ touch: false, navigator: {} });
  assert.deepEqual(none.intent(), { d: 0, bomb: false, special: false });
  const throws = rig({ touch: false, navigator: { getGamepads: () => { throw new Error('SecurityError'); } } });
  assert.deepEqual(throws.intent(), { d: 0, bomb: false, special: false });
});

test('gamepad: a button still held when the game screen opens is not a tap; nothing is read while inactive', () => {
  const r = rig({ touch: false, active: false });
  const p = press(pad(), 0, 9);
  r.pads.push(p);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false });
  r.input.setActive(true);
  assert.deepEqual(r.intent(), { d: 0, bomb: false, special: false }, 'the A press that started the match');
  assert.equal(r.calls.menu, 0);
  release(p, 0);
  r.intent();
  press(p, 0);
  assert.equal(r.intent().bomb, true);
});

test('sources merge: touch beats keyboard beats pad', () => {
  const r = rig();
  const p = press(pad(), 12);
  r.pads.push(p);
  assert.equal(r.intent().d, 1, 'pad up');
  down(r, 'ArrowRight');
  assert.equal(r.intent().d, 2, 'keyboard over pad');
  ptr(r.zone, 'pointerdown', 1, 100, 500);
  ptr(r.zone, 'pointermove', 1, 100, 560);
  assert.equal(r.intent().d, 3, 'touch over both');
  ptr(r.zone, 'pointerup', 1, 100, 560);
  assert.equal(r.intent().d, 2);
});

test('getIntent returns one reused object (read it before the next call)', () => {
  const r = rig({ touch: false });
  assert.strictEqual(r.input.getIntent(), r.input.getIntent());
});
