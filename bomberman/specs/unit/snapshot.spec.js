import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, makeEnv } from '../../shared/world.js';
import { makeRng } from '../../shared/rng.js';
import { P, B, PF, decodePlayer, decodeBomb, EVENT_ARGS } from '../../shared/protocol.js';
import * as C from '../../shared/constants.js';

const { STATE, GRID_W: W, GRID_H: H } = C;
const fighter = (id, over = {}) => ({ id, name: `P${id}`, color: id, team: id % 2, isBot: false, lastSeq: 0, ...over });
const fixture = JSON.parse(readFileSync(new URL('../fixtures/snap.example.json', import.meta.url), 'utf8'));
const round3 = (v) => Math.round(v * 1000) / 1000;

function mk(n = 3, { open = true, ...opts } = {}) {
  const w = new World({
    seed: 21, fighters: Array.from({ length: n }, (_, i) => fighter(i)), blocks: 'few', items: 'none', roundTime: 120, ...opts,
  });
  if (open) for (let i = 0; i < w.grid.length; i++) if (w.grid[i] === '+') w.grid[i] = '.';
  return w;
}
const live = (w) => { while (w.state === STATE.COUNTDOWN) w.tick(); for (const p of w.players) p.spawnShield = 0; return w; };
const put = (w, id, tx, ty, dx = 0, dy = 0) => { const p = w.player(id); p.x = tx + 0.5 + dx; p.y = ty + 0.5 + dy; return p; };
const cmd = (w, id, d = 0, b = 0, x = 0) => w.applyCmd(id, { s: w.player(id).lastSeq + 1, d, b, x });

/** The Room's broadcast rule of SPEC 4.5, reproduced so the tests exercise the same World calls. */
class FakeBroadcaster {
  constructor(world) { this.w = world; this.lastSentGv = -1; this.evCursor = 0; }
  broadcast() {
    const includeGrid = this.w.gridVer !== this.lastSentGv || this.w.tickNo % 60 === 0;
    const snap = this.w.snapshot({ grid: includeGrid, evFrom: this.evCursor });
    this.lastSentGv = this.w.gridVer;
    this.evCursor = this.w.evCount;
    this.w.trimEvents(this.evCursor);
    return snap;
  }
}

test('shape: exactly the keys of the golden fixture, in order, with `g` only when asked', () => {
  const w = live(mk());
  const snap = w.snapshot();
  assert.deepEqual(Object.keys(snap), Object.keys(fixture));
  assert.equal(snap.t, 'snap');
  assert.equal('g' in snap, false);
  const withGrid = w.snapshot({ grid: true });
  assert.deepEqual(Object.keys(withGrid), ['t', 'k', 'st', 'cd', 'r', 'sd', 'gv', 'ack', 'p', 'b', 'f', 'i', 'fall', 'g', 'e']);
  assert.equal(withGrid.g, w.grid.join(''));
  assert.equal(withGrid.g.length, 195);
  assert.equal(w.snapshot({ grid: false }).g, undefined);
  assert.equal(w.snapshot({ grid: 1 }).g, undefined, 'only `true` includes the grid');
});

test('the golden fixture decodes through the shared index maps', () => {
  assert.deepEqual(fixture.p.map((row) => row.length), [13, 13]);
  assert.equal(fixture.b[0].length, 11);
  const [a, b] = fixture.p.map(decodePlayer);
  assert.deepEqual([a.id, a.x, a.y, a.facing, a.moving, a.alive, a.kick, a.glove, a.curse, a.curseTicks], [0, 1.5, 3.213, 2, true, true, false, false, 'slow', 312]);
  assert.deepEqual([b.id, b.alive, b.kick, b.deadT, b.bombsMax, b.range, b.speedLv], [2, false, true, 40, 2, 3, 1]);
  assert.deepEqual(decodeBomb(fixture.b[0]).pass, [0]);
  for (const ev of fixture.e) assert.ok(ev[0] in EVENT_ARGS);
});

test('a live world reproduces the fixture layout field by field', () => {
  const w = live(mk(3));
  const me = put(w, 0, 1, 3);
  me.y = 3.213;
  me.moving = true;
  me.curse = 'slow';
  me.curseTicks = 312;
  w.player(2).alive = false;
  w.player(2).kick = true;
  w.player(2).bombsMax = 2;
  w.player(2).range = 3;
  w.player(2).speedLv = 1;
  w.player(2).deathTick = w.tickNo - 40;
  cmd(w, 0, 0, 1);
  const snap = JSON.parse(JSON.stringify(w.snapshot({ evFrom: 0 })));
  const p0 = decodePlayer(snap.p.find((r) => r[P.ID] === 0));
  assert.equal(p0.y, 3.213);
  assert.equal(p0.curse, 'slow');
  assert.equal(p0.curseTicks, 312);
  const p2 = snap.p.find((r) => r[P.ID] === 2);
  assert.equal(p2[P.DT], 40);
  assert.equal(p2[P.FL], PF.KICK);
  assert.equal(snap.b.length, 1);
  assert.deepEqual(decodeBomb(snap.b[0]), { id: 1, owner: 0, x: 1.5, y: 3.5, tx: 1, ty: 3, fuse: 150, range: 2, dir: 0, fly: null, pass: [0] });
});

test('completeness: every player, bomb, flame, item and falling tile is present and decodes to the world state', () => {
  const w = live(mk(4, { roundTime: 60 }));
  put(w, 0, 3, 3);
  put(w, 1, 5, 5, 0.123456, -0.2);
  put(w, 2, 9, 9);
  put(w, 3, 11, 5);
  Object.assign(w.player(1), { kick: true, glove: true, shield: 77, spawnShield: 12, speedLv: 3, bombsMax: 4, range: 5, facing: 3, moving: true });
  w.player(2).curse = 'reverse';
  w.player(2).curseTicks = 250;
  w.player(3).alive = false;
  w.player(3).deathTick = w.tickNo - 1000;
  // a standing bomb, a sliding bomb, a flying bomb, flames and an item
  cmd(w, 0, 0, 1);
  put(w, 0, 3, 3);
  put(w, 1, 7, 7);
  w.player(1).glove = true;
  w.player(1).facing = 1;
  cmd(w, 1, 0, 1);
  cmd(w, 1, 0, 0, 1);
  const slider = (() => { put(w, 2, 9, 3); cmd(w, 2, 0, 1); return w.bombs[w.bombs.length - 1]; })();
  put(w, 2, 9, 9);
  w.tick();
  Object.assign(slider, { dir: 2, step: 3 });
  w.items.push({ id: 40, tx: 2, ty: 1, kind: 'glove', born: w.tickNo - 7 });
  w.falling.push({ tx: 4, ty: 1, ticksLeft: 33 });
  run(w, 3);
  const snap = JSON.parse(JSON.stringify(w.snapshot({ evFrom: 0 })));

  assert.equal(snap.k, w.tickNo);
  assert.equal(snap.st, STATE.PLAYING);
  assert.equal(snap.cd, 0);
  assert.equal(snap.r, w.timeLeft);
  assert.equal(snap.sd, 0);
  assert.equal(snap.gv, w.gridVer);
  assert.equal(snap.p.length, 4, 'one row per fighter, dead included, in fighter order');
  assert.deepEqual(snap.p.map((r) => r[P.ID]), [0, 1, 2, 3]);
  w.players.forEach((pl, i) => {
    const row = snap.p[i];
    const d = decodePlayer(row);
    assert.equal(d.x, round3(pl.x));
    assert.equal(d.y, round3(pl.y));
    assert.equal(d.facing, pl.facing);
    assert.equal(d.moving, pl.moving);
    assert.equal(d.alive, pl.alive);
    assert.equal(d.kick, pl.kick);
    assert.equal(d.glove, pl.glove);
    assert.equal(d.shield, pl.shield);
    assert.equal(d.spawnShield, pl.spawnShield);
    assert.equal(d.curse, pl.curse);
    assert.equal(d.curseTicks, pl.curse === null ? 0 : pl.curseTicks);
    assert.equal(d.bombsMax, pl.bombsMax);
    assert.equal(d.range, pl.range);
    assert.equal(d.speedLv, pl.speedLv);
    assert.equal(d.deadT, pl.alive ? 0 : Math.min(255, w.tickNo - pl.deathTick));
    assert.equal(row.length, 13);
  });
  assert.equal(snap.p[3][P.DT], 255, 'dt saturates');
  assert.equal(snap.p[3][P.CU], 0);

  assert.equal(snap.b.length, w.bombs.length);
  w.bombs.forEach((bomb, i) => {
    const row = snap.b[i];
    assert.equal(row.length, 11);
    const d = decodeBomb(row);
    assert.deepEqual([d.id, d.owner, d.tx, d.ty, d.fuse, d.range, d.dir], [bomb.id, bomb.owner, bomb.tx, bomb.ty, bomb.fuse, bomb.range, bomb.dir]);
    assert.equal(d.x, round3(bomb.x));
    assert.equal(d.y, round3(bomb.y));
    assert.deepEqual(d.pass, bomb.pass);
    assert.notEqual(row[B.PS], bomb.pass, 'a copy, not an alias');
    if (bomb.fly) {
      assert.deepEqual(row[B.FL], [bomb.fly.fx, bomb.fly.fy, bomb.fly.tx + 0.5, bomb.fly.ty + 0.5, bomb.fly.left, bomb.fly.total]);
    } else {
      assert.equal(row[B.FL], 0);
    }
  });
  assert.ok(snap.b.some((r) => r[B.FL] !== 0), 'a flying bomb is in the sample');
  assert.ok(snap.b.some((r) => r[B.D] !== 0), 'a sliding bomb is in the sample');
  assert.deepEqual(snap.i, [[40, 2, 1, 'glove', 10]], 'age = k - born');
  assert.deepEqual(snap.fall, [[4, 1, 33]], 'listed as [tx, ty, ticksLeft]; the countdown only runs during sudden death');
  assert.deepEqual(snap.f, []);
});

function run(w, n) { for (let i = 0; i < n; i++) w.tick(); }

test('flames are listed as [tx, ty, mask, ticksLeft] in (ty, tx) order', () => {
  const w = live(mk(3));
  put(w, 0, 5, 5);
  cmd(w, 0, 0, 1);
  put(w, 0, 1, 1);
  put(w, 1, 13, 11);
  put(w, 2, 13, 1);
  run(w, 150);
  const snap = w.snapshot();
  assert.equal(snap.f.length, 9);
  assert.deepEqual(snap.f[0], [5, 3, 4, 35]);
  assert.deepEqual(snap.f.map(([tx, ty]) => [ty, tx]), [...snap.f.map(([tx, ty]) => [ty, tx])].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  assert.ok(snap.f.every((row) => row.length === 4));
});

test('JSON round trip is lossless and free of NaN, Infinity and undefined', () => {
  const w = live(mk(4, { roundTime: 60 }));
  for (const p of w.players) put(w, p.id, 7, 6);
  w.player(0).shield = C.SHIELD_FOREVER;
  const rng = makeRng(4);
  for (let t = 0; t < 4000 && w.state !== STATE.OVER; t++) {
    w.applyCmd(0, { s: t + 1, d: rng.int(5), b: rng.int(30) === 0 ? 1 : 0, x: 0 });
    w.tick();
    if (t % 25 === 0) {
      const snap = w.snapshot({ grid: t % 50 === 0, evFrom: 0 });
      const text = JSON.stringify(snap);
      assert.deepEqual(JSON.parse(text), snap, `tick ${t}`);
      assert.doesNotMatch(text, /NaN|Infinity|undefined/);
      w.trimEvents(w.evCount);
    }
  }
});

test('snapshot() is a pure read: no state, no events and no grid flag are consumed', () => {
  const w = live(mk(3));
  bombAtTile(w, 0, 5, 5);
  put(w, 0, 1, 1);
  const before = JSON.stringify({ p: w.players, b: w.bombs, f: w.flames, i: w.items, gv: w.gridVer, ev: w.evCount, tick: w.tickNo });
  const a = JSON.stringify(w.snapshot({ grid: true, evFrom: 0 }));
  const b = JSON.stringify(w.snapshot({ grid: true, evFrom: 0 }));
  assert.equal(a, b);
  assert.equal(JSON.stringify({ p: w.players, b: w.bombs, f: w.flames, i: w.items, gv: w.gridVer, ev: w.evCount, tick: w.tickNo }), before);
  assert.deepEqual(w.eventsSince(0), JSON.parse(a).e, 'events still there');
  const snap = w.snapshot({ evFrom: 0 });
  snap.p[0][P.X] = 999;
  snap.b[0][B.PS].push(99);
  snap.e.push(['evil']);
  assert.notEqual(w.player(0).x, 999);
  assert.deepEqual(w.bombs[0].pass, [0], 'mutating a snapshot cannot touch the world');
  assert.equal(w.eventsSince(0).length, snap.e.length - 1);
});

function bombAtTile(w, id, tx, ty) {
  put(w, id, tx, ty);
  cmd(w, id, 0, 1);
  return w.bombs[w.bombs.length - 1];
}

test('broadcast protocol: a unicast snapshot between two broadcasts steals neither events nor the pending grid flag', () => {
  const w = live(mk(3));
  const room = new FakeBroadcaster(w);
  for (let i = 0; i < 3; i++) w.tick();
  room.broadcast();                                            // establishes lastSentGv
  put(w, 0, 5, 5);
  w.grid[6 * W + 5] = '+';                                       // soft block that the bomb will destroy
  w._drops[6 * W + 5] = 'kick';
  cmd(w, 0, 0, 1);
  put(w, 0, 1, 1);
  let sawBlock = false;
  let gridAfterBlock = null;
  for (let t = 0; t < 160; t++) {
    w.tick();
    if (w.eventsSince(0).some((e) => e[0] === 'block') && !sawBlock) {
      sawBlock = true;
      const unicast = w.snapshot({ grid: true, evFrom: null });        // a joiner or a `sync` in the middle
      assert.deepEqual(unicast.e, [], 'unicast snapshots carry no events');
      assert.equal(typeof unicast.g, 'string');
    }
    if (w.tickNo % 3 === 0) {
      const snap = room.broadcast();
      if (sawBlock && gridAfterBlock === null && snap.e.some((e) => e[0] === 'block')) gridAfterBlock = snap.g;
    }
  }
  assert.ok(sawBlock);
  assert.equal(typeof gridAfterBlock, 'string', 'the broadcast that carries the block event also carries the new grid');
  assert.equal(gridAfterBlock[6 * W + 5], '.');
});

test('broadcast protocol: `g` follows gridVer changes and a once-per-second refresh; events arrive exactly once, in order', () => {
  const w = live(mk(3, { blocks: 'many', items: 'many', open: false }));
  const room = new FakeBroadcaster(w);
  const seen = [];
  let grids = 0;
  let changes = 0;
  const rng = makeRng(8);
  const dirs = [0, 0, 0];
  w.player(0).bombsMax = 3;
  for (let t = 0; t < 1800; t++) {
    for (const p of w.players) {
      if (t % 9 === 0) dirs[p.id] = rng.int(5);
      w.applyCmd(p.id, { s: t + 1, d: dirs[p.id], b: rng.int(30) === 0 ? 1 : 0, x: 0 });
      p.shield = C.SHIELD_FOREVER;
    }
    w.tick();
    if (w.tickNo % 3 !== 0) continue;
    const wantGrid = w.gridVer !== room.lastSentGv || w.tickNo % 60 === 0;
    const gvBefore = room.lastSentGv;
    const snap = room.broadcast();
    assert.equal(snap.g !== undefined, wantGrid, `tick ${w.tickNo}`);
    if (snap.g !== undefined) {
      grids++;
      assert.equal(snap.g, w.grid.join(''));
    }
    if (snap.gv !== gvBefore && gvBefore !== -1) {
      changes++;
      assert.ok(snap.g !== undefined, 'a changed grid is always shipped');
    }
    seen.push(...snap.e);
  }
  assert.equal(seen.filter((e) => e[0] === 'go').length, 1);
  assert.equal(seen.length, w.evCount, 'every event reached exactly one broadcast');
  assert.deepEqual(seen.filter((e) => e[0] === 'block').length, w.player(0).stats.blocks + w.player(1).stats.blocks + w.player(2).stats.blocks);
  assert.ok(changes > 3, `${changes} grid changes were exercised`);
  assert.ok(grids >= 1800 / 60, 'at least one grid per second');
});

test('ack lists exactly the human, non-removed fighters, keyed by id string, with the highest seq passed to applyCmd', () => {
  const fighters = [fighter(0), fighter(1, { isBot: true }), fighter(2, { lastSeq: 41 }), fighter(5)];
  const w = new World({ seed: 3, fighters, blocks: 'few', items: 'none' });
  assert.deepEqual(w.snapshot().ack, { 0: 0, 2: 41, 5: 0 });
  assert.deepEqual(Object.keys(w.snapshot().ack), ['0', '2', '5']);
  cmd(w, 0, 2, 1, 1);                                        // ignored during the countdown, still acked
  w.applyCmd(2, { s: 40, d: 0, b: 0, x: 0 });                // a stale seq
  assert.deepEqual(w.snapshot().ack, { 0: 1, 2: 41, 5: 0 });
  live(w);
  w.player(5).alive = false;
  w.applyCmd(5, { s: 9, d: 1, b: 0, x: 0 });                // dead fighters are acked too
  w.removeFighter(2);
  assert.deepEqual(w.snapshot().ack, { 0: 1, 5: 9 });
  w.applyCmd(1, { s: 77, d: 0, b: 0, x: 0 });
  assert.equal(w.snapshot().ack[1], undefined, 'bots are absent');
});

test('cd, r, st and sd follow the round through countdown, play, sudden death and ending', () => {
  const w = mk(2, { roundTime: 60 });
  assert.deepEqual([w.snapshot().st, w.snapshot().cd, w.snapshot().r, w.snapshot().sd], [0, 180, 3600, 0]);
  run(w, 100);
  assert.deepEqual([w.snapshot().cd, w.snapshot().k], [80, 100]);
  live(w);
  assert.deepEqual([w.snapshot().st, w.snapshot().cd, w.snapshot().r], [1, 0, 3600]);
  for (const p of w.players) put(w, p.id, 7, 6);
  run(w, 3600);
  assert.deepEqual([w.snapshot().sd, w.snapshot().r], [1, 0]);
  w.player(1).alive = false;
  w.tick();
  assert.equal(w.snapshot().st, STATE.ENDING);
  run(w, 150);
  assert.equal(w.snapshot().st, STATE.OVER);
  assert.equal(mk(2, { roundTime: 0 }).snapshot().r, -1);
});

test('quantisation: x and y of players and bombs are multiples of 1/1000', () => {
  const w = live(mk(3));
  const p = put(w, 0, 5, 5);
  p.x = 5.123456789;
  p.y = 6.987654321;
  const snap = w.snapshot();
  assert.equal(snap.p[0][P.X], 5.123);
  assert.equal(snap.p[0][P.Y], 6.988);
  const bomb = bombAtTile(w, 1, 7, 7);
  bomb.x = 8.123456;
  assert.equal(w.snapshot().b[0][B.X], 8.123);
});

test('events in a snapshot: `e` is eventsSince(evFrom), unicast snapshots carry none', () => {
  const w = live(mk(3));
  bombAtTile(w, 0, 5, 5);
  const evCount = w.evCount;
  assert.deepEqual(w.snapshot({ evFrom: null }).e, []);
  assert.deepEqual(w.snapshot({}).e, []);
  assert.deepEqual(w.snapshot({ evFrom: evCount - 1 }).e, [['bomb', 1, 0, 5, 5]]);
  assert.deepEqual(w.snapshot({ evFrom: evCount }).e, []);
});

test('every event the World emits is on the closed list with the right argument count and JSON-safe values', () => {
  const rng = makeRng(2);
  const seen = new Set();
  for (let seed = 1; seed <= 25; seed++) {
    const n = 2 + (seed % 7);
    const w = new World({
      seed, fighters: Array.from({ length: n }, (_, i) => fighter(i, { isBot: i % 2 === 1 })), roundTime: 60, blocks: 'many', items: 'many',
    });
    for (const p of w.players) { p.kick = true; p.glove = true; p.bombsMax = 3; p.range = 4; }
    let cursor = 0;
    const dirs = new Array(n).fill(0);
    for (let t = 0; t < 5200 && w.state !== STATE.OVER; t++) {
      for (const p of w.players) {
        if (seed % 2 === 0 && t % 300 === 0) p.shield = C.SHIELD_FOREVER;   // half of the rounds keep everyone alive and busy
        if (t % (6 + p.id) === 0) dirs[p.id] = rng.int(5);
        w.applyCmd(p.id, { s: t + 1, d: dirs[p.id], b: rng.int(40) === 0 ? 1 : 0, x: rng.int(20) === 0 ? 1 : 0 });
      }
      if (t === 2500 && n > 2) w.removeFighter(1);
      w.tick();
      for (const ev of w.eventsSince(cursor)) {
        seen.add(ev[0]);
        assert.ok(ev[0] in EVENT_ARGS, `unknown event ${ev[0]}`);
        assert.equal(ev.length - 1, EVENT_ARGS[ev[0]].length, `${ev[0]} arity`);
        assert.doesNotMatch(JSON.stringify(ev), /null|NaN|Infinity|undefined/, ev[0]);
        for (const arg of ev.slice(1)) assert.ok(typeof arg !== 'object' || Array.isArray(arg));
      }
      cursor = w.evCount;
      w.trimEvents(cursor);
    }
  }
  for (const code of ['go', 'bomb', 'boom', 'block', 'itemspawn', 'pickup', 'death', 'left', 'kick', 'throw', 'land', 'curse', 'sdstart', 'sdland', 'itemgone', 'shieldhit']) {
    assert.ok(seen.has(code), `random play produced a ${code} event`);
  }
});

test('size budget: 4 humans + 4 bots, mean snapshot <= 1.2 KB and p99 <= 4 KB over whole busy rounds', () => {
  const sizes = [];
  for (let seed = 1; seed <= 8; seed++) {
    const w = new World({
      seed, fighters: Array.from({ length: 8 }, (_, i) => fighter(i, { isBot: i >= 4 })), roundTime: 120, blocks: 'normal', items: 'normal',
    });
    const room = new FakeBroadcaster(w);
    const rng = makeRng(seed * 31);
    const dirs = new Array(8).fill(0);
    for (let t = 0; t < 8000 && w.state !== STATE.OVER; t++) {
      for (const p of w.players) {
        if (t % 300 === 0) p.shield = C.SHIELD_FOREVER;                // immortal, so the arena stays crowded and busy
        if (t % (7 + p.id) === 0) dirs[p.id] = rng.int(5);
        w.applyCmd(p.id, { s: t + 1, d: dirs[p.id], b: rng.int(30) === 0 ? 1 : 0, x: rng.int(80) === 0 ? 1 : 0 });
      }
      w.tick();
      if (w.state !== STATE.OVER && w.tickNo % C.SNAP_EVERY === 0) sizes.push(JSON.stringify(room.broadcast()).length);
    }
  }
  sizes.sort((a, b) => a - b);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  const p99 = sizes[Math.floor(sizes.length * 0.99)];
  assert.ok(sizes.length > 4000, `${sizes.length} snapshots`);
  assert.ok(mean <= 1200, `mean ${mean.toFixed(0)} B`);
  assert.ok(p99 <= 4096, `p99 ${p99} B`);
});

test('the grid string never leaks what is under a soft block: drops appear on the wire only once revealed', () => {
  const w = new World({ seed: 5, fighters: [fighter(0), fighter(1)], blocks: 'many', items: 'many' });
  const snap = w.snapshot({ grid: true, evFrom: 0 });
  const text = JSON.stringify(snap);
  assert.equal(snap.i.length, 0);
  assert.doesNotMatch(text, /drops?/);
  assert.equal(snap.g.replace(/[#.+]/g, ''), '', 'only # . + on the wire');
  assert.ok(!('_drops' in snap));
});

test('makeEnv on a decoded snapshot agrees with the World for every tile and fighter', () => {
  const w = live(mk(3, { blocks: 'normal' }));
  put(w, 0, 3, 1);
  cmd(w, 0, 0, 1);
  put(w, 0, 3, 3);
  w.tick();
  const snap = JSON.parse(JSON.stringify(w.snapshot({ grid: true })));
  const decoded = makeEnv(snap.g, snap.b.map(decodeBomb), W, H);
  const real = makeEnv(w.grid, w.bombs, W, H);
  for (const p of w.players) {
    for (let ty = -1; ty <= H; ty++) for (let tx = -1; tx <= W; tx++) assert.equal(decoded.isSolid(tx, ty, p), real.isSolid(tx, ty, p), `${tx},${ty}`);
  }
});
