// particles.js under Node: the fixed pool, its cap and recycling, expiry, ambient wrapping, the two blend passes and floating text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem, FloatingText, KIND, RING, POOL_SIZE } from '../../client/js/particles.js';

/** Deterministic stand-in for Math.random. */
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** A context that records what was drawn. */
function recordingContext() {
  const calls = [];
  const ctx = {
    calls, globalAlpha: 1, globalCompositeOperation: 'source-over',
    drawImage(...a) { calls.push({ op: 'drawImage', alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation, args: a }); },
    stroke() { calls.push({ op: 'stroke', alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation }); },
    beginPath() {}, arc() {},
    save() { calls.push({ op: 'save' }); }, restore() {}, translate() {}, transform() {}, rotate() {},
  };
  return ctx;
}

const sprite = (id) => ({ img: { id }, x: 0, y: 0, w: 10, h: 10, ax: 5, ay: 5 });
function fakeSet() {
  const many = (n, tag) => Array.from({ length: n }, (_, i) => sprite(`${tag}${i}`));
  return {
    fx: {
      spark: sprite('spark'), smoke: many(3, 'smoke'), darkSmoke: many(3, 'dark'), ember: sprite('ember'), star: sprite('star'), dot: sprite('dot'),
      glowWarm: sprite('glowWarm'), glowCool: sprite('glowCool'), confetti: many(6, 'confetti'), skull: sprite('skull'), twinkle: sprite('twinkle'),
    },
    dust: many(2, 'dust'), debris: many(4, 'debris'), itemGlow: (kind) => sprite(`glow-${kind}`),
  };
}

const makeSystem = (opts) => { const ps = new ParticleSystem({ random: lcg(7), ...opts }); ps.bind(fakeSet()); return ps; };

test('the pool never grows past its size and recycles the oldest slot when full', () => {
  const ps = makeSystem();
  assert.equal(ps.size, POOL_SIZE);
  for (let i = 0; i < POOL_SIZE * 3; i++) ps.sparks(5, 5, 0, 1, 3, 5);
  ps.update(0.001);
  assert.equal(ps.live, POOL_SIZE);
  for (let i = 0; i < 50; i++) ps.debris(3, 3, 6);
  ps.update(0.001);
  assert.ok(ps.live <= POOL_SIZE);
});

test('setCap limits live particles at once and quality levels map to the spec caps', () => {
  const ps = makeSystem();
  ps.confetti(7, 6, 0, 300);
  ps.update(0.001);
  assert.ok(ps.live > 200);
  ps.setCap(60);
  ps.update(0.001);
  assert.ok(ps.live <= 60);
  ps.confetti(7, 6, 0, 300);
  ps.update(0.001);
  assert.ok(ps.live <= 60, 'emitting into a capped pool recycles inside the cap');
  ps.setCap(0);
  assert.equal(ps.spawn(KIND.SPARK), -1);
  ps.clear();
  assert.equal(ps.live, 0);
});

test('particles expire, move under gravity and stop on the ground', () => {
  const ps = makeSystem();
  const i = ps.spawn(KIND.DEBRIS, 0);
  ps.place(i, 4, 4, 0.2, 1, 0, 3, 1.0, 1);
  ps.gravity[i] = 13;
  let landed = false;
  for (let t = 0; t < 45; t++) { ps.update(1 / 60); if (ps.z[i] === 0 && ps.age[i] > 0.1) landed = true; assert.ok(ps.z[i] >= 0); }
  assert.ok(landed && ps.x[i] > 4, 'thrown up, came down and drifted');
  for (let t = 0; t < 30; t++) ps.update(1 / 60);
  assert.equal(ps.live, 0, 'life is over after a second');
});

test('every recipe produces finite numbers and stays inside the pool', () => {
  const ps = makeSystem({ size: 120 });
  ps.sparks(1, 1, 0, 8, 4); ps.streak(2, 2, 1, 0, 4, 5); ps.smoke(3, 3, 0, 4, true); ps.smoke(3, 3, 0, 4, false); ps.dust(4, 4, 4);
  ps.debris(5, 5, 6); ps.confetti(6, 6, 0, 10); ps.embers(7, 7, 4); ps.stars(8, 8, 0, 4); ps.glow(9, 9, 0, 2, 0.3); ps.glow(9, 9, 0, 2, 0.3, true);
  ps.ring(1, 1, 0, 0.2, 1, 0.4, RING.FIRE); ps.sparkle(2, 2, 0, 4, 3); ps.glint(3, 3, 0); ps.skulls(4, 4, 3); ps.skulls(4, 4, 3, 8, 8); ps.fuseSpark(5, 5, 0);
  for (let t = 0; t < 20; t++) ps.update(1 / 60);
  for (let i = 0; i < ps.size; i++) {
    if (ps.life[i] <= 0) continue;
    for (const field of [ps.x, ps.y, ps.z, ps.vx, ps.vy, ps.vz, ps.s0, ps.s1]) assert.ok(Number.isFinite(field[i]), `slot ${i}`);
  }
  assert.ok(ps.live > 0 && ps.live <= 120);
});

test('ambient particles wrap around their box instead of dying, and are replaced by the next setAmbient', () => {
  const ps = makeSystem();
  ps.setAmbient('snow', 20, -1, -1, 16, 14);
  assert.equal(ps.ambient.count, 20);
  for (let t = 0; t < 60 * 60; t++) ps.update(1 / 60);          // a minute: everything has fallen off the bottom many times
  assert.equal(ps.live, 20);
  for (let i = 0; i < ps.size; i++) if (ps.life[i] > 0) { assert.ok(ps.x[i] >= -1 && ps.x[i] <= 16 && ps.y[i] >= -1 && ps.y[i] <= 14, `slot ${i} at ${ps.x[i]},${ps.y[i]}`); }
  ps.setAmbient('embers', 0, 0, 0, 1, 1);
  ps.update(0.001);
  assert.equal(ps.live, 0);
  for (const kind of ['pollen', 'snow', 'embers', 'sprinkles', 'stars']) { ps.setAmbient(kind, 10, 0, 0, 10, 10); ps.update(0.01); assert.equal(ps.live, 10, kind); }
});

test('the normal pass and the additive pass draw disjoint sets, and glow off drops pure light but keeps sparks', () => {
  const ps = makeSystem();
  ps.smoke(5, 5, 0, 2, true);       // normal
  ps.sparks(5, 5, 0, 3, 2);         // additive kind
  ps.glow(5, 5, 0, 2, 0.5);         // glow-only kind
  ps.update(0.01);
  const total = ps.live;
  const normal = recordingContext(), add = recordingContext();
  ps.draw(normal, 50, false, true);
  ps.draw(add, 50, true, true);
  assert.equal(normal.calls.filter((c) => c.op === 'drawImage').length + add.calls.filter((c) => c.op === 'drawImage').length, total);
  assert.ok(normal.calls.every((c) => c.blend === 'source-over'));
  assert.ok(add.calls.filter((c) => c.op === 'drawImage').every((c) => c.blend === 'lighter'));
  assert.equal(add.globalCompositeOperation, 'source-over', 'the composite operation is restored');
  // quality 0: no 'lighter' at all; sparks are drawn in the normal pass, the glow disc is dropped
  const n0 = recordingContext(), a0 = recordingContext();
  ps.draw(n0, 50, false, false);
  ps.draw(a0, 50, true, false);
  assert.equal(a0.calls.length, 0);
  assert.equal(n0.calls.length, total - 1);
  assert.ok(n0.calls.every((c) => c.blend === 'source-over'));
});

test('drawing never rotates or saves the context (rotated draws are 20-100x slower)', () => {
  const ps = makeSystem();
  ps.confetti(5, 5, 0, 30); ps.debris(5, 5, 8); ps.smoke(5, 5, 0, 6); ps.stars(5, 5, 0, 5);
  for (let t = 0; t < 10; t++) ps.update(1 / 60);
  const ctx = recordingContext();
  ps.draw(ctx, 50, false); ps.draw(ctx, 50, true);
  assert.ok(ctx.calls.length > 0);
  assert.ok(ctx.calls.every((c) => c.op !== 'save'));
});

test('particles fade with age and draw nothing when fully faded', () => {
  const ps = makeSystem();
  ps.smoke(5, 5, 0, 1, false);
  ps.update(0.001);
  const early = recordingContext();
  ps.draw(early, 50, false);
  for (let t = 0; t < 200; t++) ps.update(1 / 60);
  const late = recordingContext();
  ps.draw(late, 50, false);
  assert.equal(late.calls.length, 0);
  assert.ok(early.calls.length <= 1);
});

test('rings are stroked, not sprites', () => {
  const ps = makeSystem();
  ps.ring(5, 5, 0, 0.2, 1.5, 0.4, RING.ICE);
  ps.update(0.05);
  const ctx = recordingContext();
  ps.draw(ctx, 50, false);
  assert.deepEqual(ctx.calls.map((c) => c.op), ['stroke']);
});

test('FloatingText labels rise, expire and recycle the oldest when all slots are busy', () => {
  const ft = new FloatingText(3);
  for (let i = 0; i < 5; i++) ft.add(`L${i}`, i, 1, '#fff');
  assert.equal(ft.count, 3);
  assert.deepEqual([...ft.text].sort(), ['L2', 'L3', 'L4']);
  const ctx = { globalAlpha: 1, texts: [], fills: 0, strokeText() {}, fillText(t) { this.texts.push(t); } };
  ft.draw(ctx, 50, 'sans-serif');
  assert.equal(ctx.texts.length, 3);
  for (let t = 0; t < 120; t++) ft.update(1 / 60);
  assert.equal(ft.count, 0);
  ft.add('x', 1, 1, '#fff');
  ft.clear();
  assert.equal(ft.count, 0);
});
