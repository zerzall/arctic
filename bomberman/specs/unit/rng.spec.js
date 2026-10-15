import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../shared/rng.js';

// Independent transcription of the published mulberry32 algorithm, used as the oracle.
function referenceMulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('next() matches reference mulberry32 for many seeds', () => {
  for (const seed of [0, 1, 2, 42, 0xdeadbeef, 0xffffffff, 123456789]) {
    const rng = makeRng(seed);
    const ref = referenceMulberry32(seed);
    for (let i = 0; i < 2000; i++) assert.equal(rng.next(), ref(), `seed ${seed} draw ${i}`);
  }
});

test('golden values pin the stream across engines', () => {
  const rng = makeRng(1);
  assert.deepEqual([rng.next(), rng.next(), rng.next()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
});

test('same seed gives the same stream, different seeds differ', () => {
  const a = makeRng(7);
  const b = makeRng(7);
  const c = makeRng(8);
  const sa = Array.from({ length: 50 }, () => a.next());
  const sb = Array.from({ length: 50 }, () => b.next());
  const sc = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
});

test('seed is coerced to uint32 (negative, fractional, wrapped)', () => {
  const ref = makeRng(0xffffffff);
  assert.equal(makeRng(-1).next(), ref.next());
  assert.equal(makeRng(2 ** 32 + 5).next(), makeRng(5).next());
  assert.equal(makeRng(5.9).next(), makeRng(5).next());
  assert.doesNotThrow(() => makeRng(undefined).next());
});

test('generators keep no shared state', () => {
  const a = makeRng(3);
  const b = makeRng(3);
  const first = a.next();
  for (let i = 0; i < 100; i++) b.next();     // advancing b must not disturb a or any later generator
  assert.equal(makeRng(3).next(), first);
  const ref = referenceMulberry32(3);
  ref();
  assert.equal(a.next(), ref());
});

test('next() stays in [0,1)', () => {
  const rng = makeRng(99);
  for (let i = 0; i < 100000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
  }
});

test('int(n) covers 0..n-1 exactly and is roughly uniform', () => {
  const rng = makeRng(2024);
  for (const n of [1, 2, 3, 7, 13, 195]) {
    const counts = new Array(n).fill(0);
    const draws = n * 2000;
    for (let i = 0; i < draws; i++) {
      const v = rng.int(n);
      assert.ok(Number.isInteger(v) && v >= 0 && v < n);
      counts[v]++;
    }
    for (const c of counts) assert.ok(c > 2000 * 0.8 && c < 2000 * 1.2, `n=${n} bucket ${c}`);
  }
});

test('pick() returns members and int() consumes one draw', () => {
  const arr = ['a', 'b', 'c', 'd'];
  const rng = makeRng(5);
  const shadow = makeRng(5);
  for (let i = 0; i < 100; i++) assert.equal(rng.pick(arr), arr[shadow.int(4)]);
});

test('shuffle() is an in-place Fisher-Yates from the end using int()', () => {
  const rng = makeRng(11);
  const shadow = makeRng(11);
  const arr = [0, 1, 2, 3, 4, 5, 6, 7];
  const out = rng.shuffle(arr);
  assert.equal(out, arr, 'returns the same array');
  const expected = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = expected.length - 1; i > 0; i--) {
    const j = shadow.int(i + 1);
    [expected[i], expected[j]] = [expected[j], expected[i]];
  }
  assert.deepEqual(arr, expected);
  assert.deepEqual([...arr].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('shuffle() handles empty and single-element arrays without drawing', () => {
  const rng = makeRng(1);
  const before = makeRng(1).next();
  assert.deepEqual(rng.shuffle([]), []);
  assert.deepEqual(rng.shuffle([9]), [9]);
  assert.equal(rng.next(), before);
});

test('shuffle() reaches every permutation of 3 elements', () => {
  const rng = makeRng(77);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(rng.shuffle([1, 2, 3]).join(''));
  assert.equal(seen.size, 6);
});
