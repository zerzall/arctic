// First-person UI logic (SPEC §7.5) that runs without a browser: look math (sensitivity,
// invert, pitch clamp), WASD rotation into world space, the stick response curve, aim
// assist bounds, the compass heading, first-person input (pointer lock, look deltas,
// touch look pad) with a fake DOM, and the new prefs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOK_RAD_PER_PX, PITCH_LIMIT, PAD_LOOK_PX_PER_S, AIM_ASSIST, SENS_MIN, SENS_MAX,
  applyLook, moveToWorld, stickCurve, padLookDelta, assistTarget, aimAssist, wrapAngle, angleDelta,
  clampPitch, sensitivityOf, headingDeg,
} from '../public/js/ui/look.js';
import { createInput } from '../public/js/ui/input.js';
import { loadPrefs, savePrefs, DEFAULT_CLIENT_SETTINGS, FOV_MIN, FOV_MAX } from '../public/js/ui/storage.js';
import { rangeLabel } from '../public/js/ui/menus.js';

const EPS = 1e-9;
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ≉ ${b}`);

// ---- look math ---------------------------------------------------------------------------

test('look: mouse right turns right (yaw up), mouse down looks down; sensitivity scales', () => {
  const l = applyLook({ yaw: 0, pitch: 0 }, 100, 0);
  close(l.yaw, 100 * LOOK_RAD_PER_PX);
  close(l.pitch, 0);
  const d = applyLook({ yaw: 0, pitch: 0 }, 0, 50);
  assert.ok(d.pitch < 0, 'mouse down looks down');
  close(d.pitch, -50 * LOOK_RAD_PER_PX);
  const fast = applyLook({ yaw: 0, pitch: 0 }, 100, 0, { sensitivity: 2 });
  close(fast.yaw, 2 * 100 * LOOK_RAD_PER_PX);
  // SPEC: default 1.0 ≈ 0.0022 rad/px
  close(LOOK_RAD_PER_PX, 0.0022);
});

test('look: invert Y flips only the vertical axis', () => {
  const n = applyLook({ yaw: 0.3, pitch: 0 }, 40, 30);
  const i = applyLook({ yaw: 0.3, pitch: 0 }, 40, 30, { invertY: true });
  close(n.yaw, i.yaw);
  close(n.pitch, -i.pitch);
  assert.ok(i.pitch > 0, 'inverted: mouse down looks up');
});

test('look: pitch is clamped to ±1.35, yaw wraps into (-π, π]', () => {
  assert.equal(PITCH_LIMIT, 1.35);
  const up = applyLook({ yaw: 0, pitch: 0 }, 0, -1e6);
  close(up.pitch, PITCH_LIMIT);
  const down = applyLook({ yaw: 0, pitch: 1 }, 0, 1e6);
  close(down.pitch, -PITCH_LIMIT);
  const spun = applyLook({ yaw: 3, pitch: 0 }, 1000, 0);
  assert.ok(spun.yaw > -Math.PI && spun.yaw <= Math.PI);
  close(Math.cos(spun.yaw), Math.cos(3 + 1000 * LOOK_RAD_PER_PX));
  close(Math.sin(spun.yaw), Math.sin(3 + 1000 * LOOK_RAD_PER_PX));
  assert.equal(clampPitch(NaN), 0);
  close(wrapAngle(Math.PI * 3), Math.PI);
  close(wrapAngle(-Math.PI), Math.PI);
  close(angleDelta(3, -3), 2 * Math.PI - 6);
});

test('look: junk deltas and sensitivities are harmless', () => {
  const l = applyLook({ yaw: 1, pitch: 0.2 }, NaN, Infinity, { sensitivity: 'fast' });
  close(l.yaw, 1);
  close(l.pitch, 0.2);
  assert.equal(sensitivityOf(99), SENS_MAX);
  assert.equal(sensitivityOf(0), SENS_MIN);
  assert.equal(sensitivityOf(undefined), 1);
  assert.equal(sensitivityOf('x', 0.5), 0.5);
});

test('move: WASD rotates into world space (forward = facing, D = right of facing)', () => {
  // W (moveY = -1) walks along the yaw, whatever it is
  for (const yaw of [0, 0.7, Math.PI / 2, -2.4, Math.PI]) {
    const w = moveToWorld(0, -1, yaw);
    close(w.x, Math.cos(yaw));
    close(w.y, Math.sin(yaw));
    const s = moveToWorld(0, 1, yaw);
    close(s.x, -Math.cos(yaw));
    close(s.y, -Math.sin(yaw));
    const d = moveToWorld(1, 0, yaw);
    close(d.x, Math.cos(yaw + Math.PI / 2));
    close(d.y, Math.sin(yaw + Math.PI / 2));
    const a = moveToWorld(-1, 0, yaw);
    close(a.x, -Math.cos(yaw + Math.PI / 2));
    close(a.y, -Math.sin(yaw + Math.PI / 2));
  }
  // facing east (yaw 0): W = +x, D = +y (south on the map)
  const e = moveToWorld(1, -1, 0);
  close(e.x, Math.SQRT1_2);
  close(e.y, Math.SQRT1_2);
  const n = moveToWorld(Math.SQRT1_2, -Math.SQRT1_2, 1.1);
  assert.ok(Math.hypot(n.x, n.y) <= 1 + EPS, 'rotation keeps the length (≤ 1)');
  const z = moveToWorld(0, 0, 2);
  assert.equal(z.x === 0 || Object.is(z.x, -0), true);
  close(z.y, 0);
});

test('stick: response curve is monotonic, 0 → 0, 1 → 1, gentle near the centre', () => {
  assert.equal(stickCurve(0), 0);
  close(stickCurve(1), 1);
  let prev = -1;
  for (let m = 0; m <= 1.0001; m += 0.05) {
    const c = stickCurve(m);
    assert.ok(c >= prev, 'monotonic');
    prev = c;
  }
  assert.ok(stickCurve(0.3) < 0.3, 'a small tilt turns slower than linear');
  assert.equal(stickCurve(5), 1);
  const full = padLookDelta(1, 0, 0.1);
  close(full.dx, PAD_LOOK_PX_PER_S * 0.1);
  assert.equal(full.dy, 0);
  const none = padLookDelta(0, 0, 0.1);
  assert.equal(none.dx, 0);
  assert.equal(none.dy, 0);
  const up = padLookDelta(0, -1, 0.05);
  assert.ok(up.dy < 0 && Math.abs(up.dy) < PAD_LOOK_PX_PER_S * 0.05, 'vertical stick look is slower');
  // a long hitch never turns the camera around in one frame
  assert.ok(padLookDelta(1, 0, 3).dx <= PAD_LOOK_PX_PER_S * 0.1 + EPS);
});

test('aim assist: only inside the cone and range, never overshoots, fades at the edges', () => {
  const px = 100, py = 100;
  const at = (ang, d) => ({ x: px + Math.cos(ang) * d, y: py + Math.sin(ang) * d });
  // nothing to help with
  assert.equal(aimAssist(0, px, py, [], 1 / 60), 0);
  assert.equal(aimAssist(0, px, py, null, 1 / 60), 0);
  // outside the cone / out of range / inside the player: untouched
  assert.equal(aimAssist(0, px, py, [at(AIM_ASSIST.cone + 0.05, 300)], 1 / 60), 0);
  assert.equal(aimAssist(0, px, py, [at(0.05, AIM_ASSIST.range + 50)], 1 / 60), 0);
  assert.equal(aimAssist(0, px, py, [at(0.05, 5)], 1 / 60), 0);
  // inside: pulled toward the target, a little, without passing it
  const target = 0.06;
  const y1 = aimAssist(0, px, py, [at(target, 400)], 1 / 60);
  assert.ok(y1 > 0 && y1 < target, `pulled toward (${y1})`);
  assert.ok(y1 < 0.01, 'light: a small nudge per frame');
  const yl = aimAssist(0, px, py, [at(-target, 400)], 1 / 60);
  close(yl, -y1, 1e-9, 'symmetric');
  // many frames converge on the target and stay there
  let y = 0;
  for (let i = 0; i < 600; i++) y = aimAssist(y, px, py, [at(target, 400)], 1 / 60);
  close(y, target, 2e-3);
  // a hitch (huge dt) still can't overshoot
  const yh = aimAssist(0, px, py, [at(target, 400)], 5);
  assert.ok(yh > 0 && yh <= target + EPS);
  // the pull fades to zero at the cone edge, so a steady turn escapes it
  const edge = aimAssist(0, px, py, [at(AIM_ASSIST.cone - 1e-4, 400)], 1 / 60);
  assert.ok(edge < 1e-4, `no pull at the cone edge (${edge})`);
  const maxPull = (AIM_ASSIST.cone / 4) * AIM_ASSIST.rate; // rad/s at |delta| = cone/2
  assert.ok(maxPull < 0.3, `a ~0.3 rad/s turn escapes (max pull ${maxPull.toFixed(3)} rad/s)`);
  // the nearest-to-crosshair zombie wins, not the nearest in distance
  const t = assistTarget(0, px, py, [at(0.12, 150), at(0.02, 700)]);
  close(t.delta, 0.02, 1e-6);
  // works across the ±π seam
  const ys = aimAssist(Math.PI - 0.01, px, py, [at(-Math.PI + 0.03, 300)], 1 / 60);
  assert.ok(Math.abs(angleDelta(Math.PI - 0.01, ys)) < 0.04 && angleDelta(Math.PI - 0.01, ys) > 0);
});

test('compass heading: north = -y, east = +x', () => {
  assert.equal(headingDeg(-Math.PI / 2), 0);
  assert.equal(headingDeg(0), 90);
  assert.equal(headingDeg(Math.PI / 2), 180);
  assert.equal(headingDeg(Math.PI), 270);
  assert.equal(headingDeg(-Math.PI), 270);
});

// ---- first-person input (fake DOM) -----------------------------------------------------------

function fakeDom() {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.defaultView = win;
  doc.visibilityState = 'visible';
  doc.body = { tagName: 'BODY' };
  doc.pointerLockElement = null;
  const canvas = new EventTarget();
  canvas.ownerDocument = doc;
  canvas.parentElement = null;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const lock = { requests: 0, exits: 0, options: [] };
  canvas.requestPointerLock = (o) => {
    lock.requests++;
    lock.options.push(o);
    return Promise.resolve();
  };
  doc.exitPointerLock = () => {
    lock.exits++;
    setLocked(null);
  };
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
  function setLocked(el) {
    doc.pointerLockElement = el;
    doc.dispatchEvent(new Event('pointerlockchange'));
  }
  return { win, doc, canvas, lock, setLocked, listeners: () => count };
}

function mouse(target, type, props) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { clientX: 0, clientY: 0, button: 0, movementX: 0, movementY: 0, ...props });
  target.dispatchEvent(e);
  return e;
}

test('fps input: a click without the lock asks for it and does not fire', () => {
  const { canvas, lock } = fakeDom();
  const input = createInput(canvas, { view: 'fps' });
  assert.equal(input.view, 'fps');
  mouse(canvas, 'mousedown', { button: 0 });
  assert.equal(lock.requests, 1);
  assert.deepEqual(lock.options[0], { unadjustedMovement: true }, 'raw mouse input first');
  assert.equal(input.sample().fire, false, 'the capturing click is not a shot');
  input.destroy();
});

test('fps input: locked mouse movement becomes lookDX/lookDY once per sample', () => {
  const { win, canvas, setLocked } = fakeDom();
  const changes = [];
  const input = createInput(canvas, { view: 'fps', onLockChange: (l) => changes.push(l) });
  mouse(win, 'mousemove', { clientX: 10, clientY: 10, movementX: 30, movementY: 5 });
  assert.equal(input.sample().lookDX, 0, 'no look without the lock');
  setLocked(canvas);
  assert.equal(input.locked, true);
  assert.deepEqual(changes, [true]);
  // the first event after locking may carry the warp to the lock point: skipped
  mouse(win, 'mousemove', { movementX: 500, movementY: 300 });
  mouse(win, 'mousemove', { movementX: 12, movementY: -4 });
  mouse(win, 'mousemove', { movementX: 8, movementY: 2 });
  mouse(win, 'mousemove', { movementX: 900, movementY: 0 }); // browser glitch: dropped
  const s = input.sample();
  assert.equal(s.lookDX, 20);
  assert.equal(s.lookDY, -2);
  const t = input.sample();
  assert.equal(t.lookDX, 0, 'consumed');
  // locked clicks fire as usual
  mouse(canvas, 'mousedown', { button: 0 });
  assert.equal(input.sample().fire, true);
  // losing the lock releases the trigger and tells the owner
  setLocked(null);
  assert.deepEqual(changes, [true, false]);
  assert.equal(input.sample().fire, false);
  input.destroy();
});

test('fps input: disabled input reports no look; addLook feeds the test hook', () => {
  const { win, canvas, setLocked } = fakeDom();
  const input = createInput(canvas, { view: 'fps' });
  setLocked(canvas);
  mouse(win, 'mousemove', { movementX: 1 });
  mouse(win, 'mousemove', { movementX: 40 });
  input.setEnabled(false);
  mouse(win, 'mousemove', { movementX: 40 });
  assert.equal(input.sample().lookDX, 0, 'menus open: no looking around');
  input.setEnabled(true);
  input.addLook(25, -5);
  const s = input.sample();
  assert.equal(s.lookDX, 25);
  assert.equal(s.lookDY, -5);
  input.destroy();
});

test('fps input: WASD stays view-relative (match.js rotates it), topdown ignores look', () => {
  const { win, canvas, setLocked } = fakeDom();
  const input = createInput(canvas, { view: 'fps' });
  const k = new Event('keydown', { cancelable: true });
  Object.assign(k, { code: 'KeyW', key: 'w', repeat: false });
  win.dispatchEvent(k);
  const s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, -1);
  input.destroy();

  const td = fakeDom();
  const top = createInput(td.canvas);
  assert.equal(top.view, 'topdown');
  td.setLocked(td.canvas);
  mouse(td.win, 'mousemove', { clientX: 200, clientY: 100, movementX: 30 });
  const t = top.sample();
  assert.equal(t.lookDX, 0);
  assert.equal(t.aimScreenX, 200, 'top-down still aims at the cursor');
  mouse(td.canvas, 'mousedown', { button: 0 });
  assert.equal(td.lock.requests, 0, 'top-down never grabs the mouse');
  assert.equal(top.sample().fire, true);
  top.destroy();
  setLocked(null);
});

test('fps input: a refused raw-input lock retries plain; destroy releases the lock and listeners', async () => {
  const dom = fakeDom();
  const before = dom.listeners();
  const opts = [];
  dom.canvas.requestPointerLock = (o) => {
    opts.push(o);
    if (o) return Promise.reject(Object.assign(new Error('nope'), { name: 'NotSupportedError' }));
    return Promise.resolve();
  };
  const input = createInput(dom.canvas, { view: 'fps' });
  mouse(dom.canvas, 'mousedown', { button: 0 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(opts, [{ unadjustedMovement: true }, undefined]);
  // later requests go straight to the plain lock
  input.requestLock();
  assert.deepEqual(opts.slice(2), [undefined]);
  dom.setLocked(dom.canvas);
  input.destroy();
  assert.equal(dom.lock.exits, 1, 'destroy gives the mouse back');
  assert.equal(dom.listeners(), before);
});

test('fps input: the raw mouse setting picks unadjustedMovement or a plain lock', () => {
  const dom = fakeDom();
  const opts = [];
  dom.canvas.requestPointerLock = (o) => {
    opts.push(o);
    return Promise.resolve();
  };
  const off = createInput(dom.canvas, { view: 'fps', rawMouse: false });
  off.requestLock();
  assert.deepEqual(opts, [undefined], 'raw input off: plain lock');
  off.setRawMouse(true);
  off.requestLock();
  assert.deepEqual(opts[1], { unadjustedMovement: true }, 'switched on from the settings');
  assert.equal(off.rawMouseSupported, true);
  off.destroy();
  const on = createInput(dom.canvas, { view: 'fps' });
  on.requestLock();
  assert.deepEqual(opts[2], { unadjustedMovement: true }, 'raw input is the default');
  on.destroy();
});

test('fps input: the gamepad right stick turns the camera (per-frame delta), not the aim point', async () => {
  const nav = globalThis.navigator;
  if (!nav) return;
  const had = Object.prototype.hasOwnProperty.call(nav, 'getGamepads');
  const old = nav.getGamepads;
  const pad = {
    index: 0, connected: true, axes: [0, 0, 1, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  nav.getGamepads = () => [pad];
  try {
    const { canvas } = fakeDom();
    const input = createInput(canvas, { view: 'fps' });
    input.sample(); // first sample: no elapsed time yet
    const t = Date.now();
    while (Date.now() - t < 20) { /* let ~20 ms pass */ }
    const s = input.sample();
    assert.equal(s.mode, 'pad');
    assert.ok(s.lookDX > 0 && s.lookDX <= PAD_LOOK_PX_PER_S * 0.1 + EPS, `right stick → look right (${s.lookDX})`);
    assert.equal(s.lookDY, 0);
    pad.axes = [0, 0, 0, 0];
    assert.equal(input.sample().lookDX, 0, 'stick released: the camera stops');
    input.destroy();
  } finally {
    if (had) nav.getGamepads = old;
    else delete nav.getGamepads;
  }
});

// ---- prefs -----------------------------------------------------------------------------------

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

test('prefs: first-person settings default to fps and are validated', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  withStorage(store, () => {
    const p = loadPrefs();
    assert.equal(p.settings.view, 'fps');
    assert.equal(p.settings.fov, 80);
    assert.equal(p.settings.sensitivity, 1);
    assert.equal(p.settings.invertY, false);
    assert.equal(p.settings.aimAssist, true);
    assert.deepEqual(p.settings, DEFAULT_CLIENT_SETTINGS);
    p.settings.view = 'topdown';
    p.settings.fov = 95;
    p.settings.sensitivity = 1.35;
    p.settings.invertY = true;
    savePrefs(p);
    const q = loadPrefs();
    assert.equal(q.settings.view, 'topdown');
    assert.equal(q.settings.fov, 95);
    assert.equal(q.settings.sensitivity, 1.35);
    assert.equal(q.settings.invertY, true);
    mem.set([...mem.keys()][0], JSON.stringify({ settings: { view: 'vr', fov: 500, sensitivity: -3, padLook: 'x', aimAssist: 1 } }));
    const r = loadPrefs();
    assert.equal(r.settings.view, 'fps');
    assert.equal(r.settings.fov, FOV_MAX);
    assert.equal(r.settings.sensitivity, SENS_MIN);
    assert.equal(r.settings.padLook, 1);
    assert.equal(r.settings.aimAssist, true);
    mem.set([...mem.keys()][0], JSON.stringify({ settings: { fov: 3 } }));
    assert.equal(loadPrefs().settings.fov, FOV_MIN);
  });
});

test('settings sliders: degrees, multipliers and percentages', () => {
  assert.equal(rangeLabel('deg', 80), '80°');
  assert.equal(rangeLabel('x', 135), '1.35×');
  assert.equal(rangeLabel(undefined, 40), '40%');
});
