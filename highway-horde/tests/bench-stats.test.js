// The benchmark page's numbers (public/dev/bench-stats.js): percentiles, the 1 % and 0.1 % lows and
// the fly-through path. The page itself runs in a browser (Playwright checks it by hand).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarizeFrames, pathAt } from '../public/dev/bench-stats.js';

test('percentiles interpolate between ranks', () => {
  const a = [1, 2, 3, 4, 5];
  assert.equal(percentile(a, 0), 1);
  assert.equal(percentile(a, 50), 3);
  assert.equal(percentile(a, 100), 5);
  assert.equal(percentile(a, 25), 2);
  assert.equal(percentile(a, 90), 4.6);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test('frame statistics: average, lows, percentiles, stutters', () => {
  // 990 frames at 8 ms and ten hitches at 40 ms
  const frames = [...Array(990).fill(8), ...Array(10).fill(40)];
  const s = summarizeFrames(frames);
  assert.equal(s.frames, 1000);
  assert.ok(Math.abs(s.seconds - (990 * 8 + 400) / 1000) < 1e-9);
  assert.ok(Math.abs(s.avgFps - 1000 / ((990 * 8 + 400) / 1000) ) < 0.01 * 1000 / 8);
  assert.ok(Math.abs(s.avgFps - 1000 / 8.32) < 0.01);
  assert.ok(Math.abs(s.low1Fps - 25) < 1e-9, '1 % low = the slowest 10 frames = 40 ms');
  assert.ok(Math.abs(s.low01Fps - 25) < 1e-9, '0.1 % low = the single slowest frame');
  assert.equal(s.minFps, 25);
  assert.equal(s.maxFps, 125);
  assert.equal(s.p50Ms, 8);
  assert.equal(s.maxMs, 40);
  assert.equal(s.stutters, 10);
  assert.ok(s.p99Ms >= 8 && s.p99Ms <= 40);
  assert.equal(s.gpuAvgMs, undefined);
  const g = summarizeFrames([10, 10, 10], [4, 6, 8]);
  assert.equal(g.gpuAvgMs, 6);
  assert.equal(g.gpuMaxMs, 8);
  assert.equal(summarizeFrames([]), null);
  assert.equal(summarizeFrames([NaN, -1, 0]), null);
  // a perfectly even 144 Hz run has equal average and lows
  const even = summarizeFrames(Array(2880).fill(1000 / 144));
  assert.ok(Math.abs(even.avgFps - 144) < 1e-9 && Math.abs(even.low1Fps - 144) < 1e-9 && even.stutters === 0);
});

test('the fly-through is continuous, repeats every 20 s and stays around the road', () => {
  let prev = pathAt(0);
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  for (let s = 0.02; s <= 40; s += 0.02) {
    const p = pathAt(s);
    // at most ~1000 units/s and ~1.6 rad/s: no teleports, no whip pans
    assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < 1000 * 0.02 + 1e-6, `step at ${s.toFixed(2)}: ${Math.hypot(p.x - prev.x, p.y - prev.y).toFixed(1)}`);
    assert.ok(Math.abs(wrap(p.yaw - prev.yaw)) < 1.6 * 0.02 + 1e-6, `turn at ${s.toFixed(2)}`);
    assert.ok(p.x > 2400 && p.x < 4300 && p.y > 1000 && p.y < 1245, `off the road at ${s.toFixed(2)}: ${p.x | 0},${p.y | 0}`);
    assert.ok(Math.abs(p.pitch) < 0.3);
    prev = p;
  }
  const a = pathAt(3.3), b = pathAt(23.3);
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
});
