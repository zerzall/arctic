// The real input module with the utility keys: G (throwables) and T (buildables) tap to use, hold to
// switch; C crouches; the old gear keys F and C are free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../public/js/ui/input.js';
import { GADGET_HOLD_S } from '../public/js/ui/gadgets.js';

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
  return { win, canvas };
}

function press(win, type, code) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code, key: code, repeat: false, ctrlKey: false, metaKey: false, altKey: false });
  win.dispatchEvent(e);
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

test('input: G throws the selected throwable on a tap, a held G switches it; T works the same for buildables', async () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  press(win, 'keydown', 'KeyG');
  assert.equal(input.sample().frag, false, 'nothing yet while the key is down');
  press(win, 'keyup', 'KeyG');
  let s = input.sample();
  assert.equal(s.frag, true, 'a tap throws the frag');
  assert.equal(s.molotov, false);
  assert.equal(input.sample().frag, false, 'once');
  // a hold (past the threshold) switches to the molotov and throws nothing
  press(win, 'keydown', 'KeyG');
  await wait(GADGET_HOLD_S + 0.08);
  s = input.sample();
  assert.equal(s.frag, false);
  assert.equal(input.gadgetState().selected.throw, 'molotov');
  assert.ok(input.gadgetState().picker.throw, 'the picker is open');
  press(win, 'keyup', 'KeyG');
  assert.equal(input.sample().molotov, false, 'the release of a hold uses nothing');
  press(win, 'keydown', 'KeyG');
  press(win, 'keyup', 'KeyG');
  assert.equal(input.sample().molotov, true, 'the next tap throws the molotov');
  // T places the turret
  press(win, 'keydown', 'KeyT');
  press(win, 'keyup', 'KeyT');
  s = input.sample();
  assert.equal(s.turret, true);
  assert.equal(s.barricade, false);
  // a press that straddles a menu never fires
  press(win, 'keydown', 'KeyT');
  input.setEnabled(false);
  press(win, 'keyup', 'KeyT');
  input.setEnabled(true);
  assert.equal(input.sample().turret, false);
  input.destroy();
});

test('input: F no longer throws and C crouches (held)', () => {
  const { win, canvas } = fakeDom();
  const input = createInput(canvas);
  press(win, 'keydown', 'KeyF');
  press(win, 'keyup', 'KeyF');
  press(win, 'keydown', 'KeyC');
  let s = input.sample();
  assert.equal(s.molotov || s.barricade || s.frag, false, 'F and C are not gear keys any more');
  assert.equal(s.crouch, true, 'C is crouch');
  press(win, 'keyup', 'KeyC');
  assert.equal(input.sample().crouch, false);
  // Ctrl can still be chosen as the crouch key
  input.setBinds({ crouch: 'ControlLeft' });
  press(win, 'keydown', 'ControlLeft');
  assert.equal(input.sample().crouch, true);
  input.destroy();
});
