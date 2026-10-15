// Story levels in the top-down renderer (render/level2d.js): gates fade out as they open and are
// gone while open, shut gates carry hazard rims, roofs cover their rooms and fade over the local
// player's own, a section whose lights are out loses its lamps. Runs the real renderer against a
// recording mock 2D context (as render.test.js does); pixels are reviewed in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceholderLevel } from '../public/js/shared/maps.js';
import { LEVEL_SPECS } from '../public/js/shared/levels/index.js';

function mockContext(canvas, log) {
  const store = {
    canvas, fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start',
    textBaseline: 'alphabetic', imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: 'transparent',
  };
  const gradient = () => ({ addColorStop() {} });
  const methods = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({ setTransform() {} }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    drawImage: (img, ...a) => { assert.ok(a.every(Number.isFinite), 'drawImage args finite'); },
    setTransform: (...a) => { assert.ok(a.every(Number.isFinite), 'setTransform args finite'); },
    fillRect: (...a) => { assert.ok(a.every(Number.isFinite), 'fillRect args finite'); log.fills.push({ a, alpha: store.globalAlpha, style: store.fillStyle }); },
    strokeRect: (...a) => { assert.ok(a.every(Number.isFinite), 'strokeRect args finite'); log.strokes++; },
  };
  return new Proxy(store, {
    get(t, p) { return p in methods ? methods[p] : p in t ? t[p] : () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
}
function mockCanvas(w = 300, h = 150, log = { fills: [], strokes: 0 }) {
  const c = {
    width: w, height: h, clientWidth: w, clientHeight: h, style: {}, dataset: {},
    getBoundingClientRect: () => ({ width: c.clientWidth, height: c.clientHeight, left: 0, top: 0 }),
  };
  let ctx = null;
  c.getContext = () => (ctx || (ctx = mockContext(c, log)));
  return c;
}
globalThis.document = { createElement: () => mockCanvas() };
globalThis.window = { devicePixelRatio: 1 };
globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arc() {} };

const { createRenderer } = await import('../public/js/render/renderer.js');
const { createLevel2D } = await import('../public/js/render/level2d.js');
const { buildMap } = await import('../public/js/shared/maps.js');
const { Game } = await import('../public/js/shared/sim.js');
const { levelGates, GATE_ANIM_TIME } = await import('../public/js/shared/level.js');

const MISSION = { id: 'lv2d', map: 'millroad', mode: 'free', steps: [{ id: 'w', type: 'wait', seconds: 99999, pressure: false }] };

/** Mill Road with a roofed room in its second section (the placeholder has none of its own). */
function roofedMap() {
  const map = buildPlaceholderLevel(LEVEL_SPECS.millroad, 3);
  const s = map.sections[1];
  map.roofs = (map.roofs || []).concat([{ x: s.x, y: s.y - 300, w: 300, h: 220, a: 0, height: 150, kind: 'office', section: s.id, dark: 0.78 }]);
  return map;
}

function game(map) {
  return new Game({ mapId: 'millroad', seed: 3, map, settings: { mode: 'mission', difficulty: 'normal', story: { mission: MISSION } }, players: [{ id: 1, name: 'H', color: 0, cls: 'soldier' }] });
}

test('level2d: gates fade while they open and vanish once open; lights of a dark section are out', () => {
  const map = roofedMap();
  const g = game(map);
  const gate = levelGates(map)[0];
  const L = createLevel2D(map);
  assert.ok(L);
  assert.equal(createLevel2D(buildMap('highway', 1)), null, 'no-op off a level');
  const piece = gate.obs[0].id;
  for (let i = 0; i < 10; i++) g.step();   // (a gate changed at tick 0 counts as built that way)
  let v = g.snapshot();
  assert.equal(L.gateAlpha(piece, v), 1, 'shut gate drawn');
  assert.equal(L.gateAlpha(0 === piece ? 1 : 0, v), 1, 'plain obstacle drawn');
  g.level.setGate(gate.id, true);
  for (let i = 0; i < 30; i++) g.step();
  v = g.snapshot();
  const mid = L.gateAlpha(piece, v);
  assert.ok(mid > 0 && mid < 1, `half open ${mid}`);
  for (let i = 0; i < GATE_ANIM_TIME * 60; i++) g.step();
  v = g.snapshot();
  assert.equal(L.gateAlpha(piece, v), 0, 'open gate not drawn');
  g.level.setGate(gate.id, false);
  g.step();
  v = g.snapshot();
  assert.ok(L.gateAlpha(piece, v) < 0.2, 'shutting fades back in');
  // lights
  const s1 = map.sections[1];
  assert.equal(L.lightOff(s1.x, s1.y, v), false);
  g.level.setLights(s1.id, false);
  g.step();
  v = g.snapshot();
  assert.equal(L.lightOff(s1.x, s1.y, v), true, 'section 1 lights out');
  assert.equal(L.lightOff(map.sections[0].x, map.sections[0].y, v), false, 'other sections keep theirs');
});

test('top-down renderer draws a level: roofs, gates, dark sections, day and night', () => {
  for (const time of ['night', 'day']) {
    const map = roofedMap();
    const g = game(map);
    const log = { fills: [], strokes: 0 };
    const r = createRenderer(mockCanvas(1280, 720, log), { map, quality: 'high', time });
    const roof = map.roofs[map.roofs.length - 1];
    const p = g.players[0];
    const gate = levelGates(map)[0];
    const errs = [];
    const orig = console.error, ow = console.warn;
    console.error = (...a) => errs.push(a.join(' '));
    console.warn = (...a) => errs.push(a.join(' '));
    try {
      const frame = (n) => {
        for (let i = 0; i < n; i++) {
          g.step();
          r.render(g.snapshot(), { localId: 1, roster: [{ id: 1, name: 'H', color: 0, cls: 'soldier' }], now: i / 60, dt: 1 / 60, settings: { lighting: true } });
        }
      };
      // outside, by the gate: the gate's rim, the roof in view is opaque-ish
      p.x = gate.x - 200; p.y = gate.y;
      frame(5);
      assert.ok(log.strokes > 0, 'gate rims drawn');
      g.level.setGate(gate.id, true);
      g.level.setLights(map.sections[1].id, false);
      r.addEvents([{ type: 'shake', k: 0.6, x: p.x, y: p.y, r: 1800 }, { type: 'gate', id: gate.id, open: true }], { localId: 1 });
      frame(90);
      // walk into the room: its roof fades out
      p.x = roof.x; p.y = roof.y;
      log.fills.length = 0;
      frame(90);
      const roofFills = log.fills.filter((f) => f.style === '#4a4744');
      assert.ok(roofFills.length > 0 && roofFills[0].alpha > 0.6, 'the roof was solid before');
      assert.ok(roofFills[roofFills.length - 1].alpha < 0.2, 'roof over the player fades out');
      p.x = roof.x; p.y = roof.y + 600;
      log.fills.length = 0;
      frame(90);
      const back = log.fills.filter((f) => f.style === '#4a4744');
      assert.ok(back.length && back[back.length - 1].alpha > 0.6, 'roof seen from outside');
    } finally {
      console.error = orig;
      console.warn = ow;
    }
    assert.deepEqual(errs, [], `${time}: renderer logged errors`);
    r.destroy();
  }
});
