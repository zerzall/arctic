import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { World, overlapsTile } from '../../shared/world.js';
import { makeRng } from '../../shared/rng.js';
import { EVENT_ARGS, P } from '../../shared/protocol.js';
import * as C from '../../shared/constants.js';

const { STATE, GRID_W: W, GRID_H: H, PLAYER_HALF: HALF, EPS } = C;
const SHA_FIXTURE = new URL('../fixtures/determinism.sha1', import.meta.url);

const fighter = (id, over = {}) => ({ id, name: `P${id}`, color: id, team: id % 2, isBot: id % 3 === 2, lastSeq: 0, ...over });

// ---- A deterministic "random player" driver, independent of the World's own rng ------------------

/** Personalities: 0 idle, 1 wanderer, 2 bomber, 3 chaser, 4 button masher (including malformed cmds). */
function makeDriver(world, seed) {
  const rng = makeRng((seed * 2654435761) ^ 0x51ed);
  const state = new Map(world.players.map((p) => [p.id, { kind: (p.id + seed) % 5, dir: 0, until: 0, seq: p.lastSeq }]));
  return function step() {
    for (const p of world.players) {
      const st = state.get(p.id);
      st.seq++;
      let d = st.dir;
      let b = 0;
      let x = 0;
      switch (st.kind) {
        case 0: d = 0; break;
        case 1:
          if (st.until-- <= 0) { st.dir = rng.int(5); st.until = 5 + rng.int(20); }
          d = st.dir;
          b = rng.int(60) === 0 ? 1 : 0;
          break;
        case 2:
          if (st.until-- <= 0) { st.dir = rng.int(5); st.until = 3 + rng.int(10); }
          d = st.dir;
          b = rng.int(15) === 0 ? 1 : 0;
          x = rng.int(25) === 0 ? 1 : 0;
          break;
        case 3: {
          let target = null;
          let best = Infinity;
          for (const q of world.players) {
            if (q === p || !q.alive) continue;
            const dist = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
            if (dist < best) { best = dist; target = q; }
          }
          if (st.until-- <= 0) st.until = 2 + rng.int(6);
          if (target && st.until > 0) {
            const dx = target.x - p.x;
            const dy = target.y - p.y;
            d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1);
            if (rng.int(4) === 0) d = rng.int(5);
          }
          b = best < 9 && rng.int(8) === 0 ? 1 : 0;
          x = rng.int(30) === 0 ? 1 : 0;
          break;
        }
        default:
          d = rng.int(5);
          b = rng.int(10) === 0 ? 1 : 0;
          x = rng.int(10) === 0 ? 1 : 0;
      }
      const cmd = { s: st.seq, d, b, x };
      if (st.kind === 4 && rng.int(40) === 0) { cmd.d = 9; cmd.b = 2; cmd.s = st.seq - 3; }      // out-of-contract input must never break the sim
      world.applyCmd(p.id, cmd);
    }
  };
}

function scenario(seed) {
  const n = 2 + (seed % 7);
  const teams = n % 2 === 0 && seed % 2 === 0;
  const fighters = Array.from({ length: n }, (_, i) => fighter(i, { team: i % 2, lastSeq: seed % 5 === 0 ? 100 * i : 0 }));
  return {
    seed,
    fighters,
    mode: teams ? 'teams' : 'ffa',
    layout: seed % 3 === 0 ? 'open' : 'classic',
    blocks: ['few', 'normal', 'many'][seed % 3],
    items: ['few', 'normal', 'many'][(seed >> 1) % 3],
    theme: C.THEMES[seed % 5],
    roundTime: [60, 90, 120, 180][seed % 4],
    suddenDeath: seed % 7 !== 3,
  };
}

function boost(world, seed) {
  const rng = makeRng(seed + 777);
  for (const p of world.players) {
    if (rng.int(3) === 0) Object.assign(p, { kick: true, glove: true, bombsMax: 2 + rng.int(4), range: 2 + rng.int(4), speedLv: rng.int(4) });
  }
}

// ---- Invariants ------------------------------------------------------------------------------------

const SOLID = new Set(['#', 'X', '+']);

function checkInvariants(w, ctx) {
  const fail = (msg) => assert.fail(`${ctx} tick ${w.tickNo}: ${msg}`);
  for (const p of w.players) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(`player ${p.id} has NaN position`);
    for (const k of ['kills', 'deaths', 'selfKills', 'blocks', 'items']) if (!(p.stats[k] >= 0)) fail(`negative stat ${k}`);
    if (p.bombsMax > C.MAX_BOMBS || p.range > C.MAX_RANGE || p.speedLv > C.MAX_SPEED_LV) fail('stat above its cap');
    if (!p.alive) continue;
    const slack = EPS + 1e-9;                                   // the EPS tolerance band of movePlayer (SPEC 3.5)
    if (p.x - HALF < 1 - slack || p.x + HALF > 14 + slack || p.y - HALF < 1 - slack || p.y + HALF > 12 + slack) fail(`player ${p.id} outside the arena: ${p.x},${p.y}`);
    if (w.grid[Math.floor(p.y) * W + Math.floor(p.x)] !== '.') fail(`player ${p.id} stands in ${w.grid[Math.floor(p.y) * W + Math.floor(p.x)]}`);
    for (let ty = Math.floor(p.y - HALF); ty <= Math.floor(p.y + HALF); ty++) {
      for (let tx = Math.floor(p.x - HALF); tx <= Math.floor(p.x + HALF); tx++) {
        if (!SOLID.has(w.grid[ty * W + tx])) continue;
        const ox = Math.min(p.x + HALF, tx + 1) - Math.max(p.x - HALF, tx);
        const oy = Math.min(p.y + HALF, ty + 1) - Math.max(p.y - HALF, ty);
        if (ox > EPS + 1e-9 && oy > EPS + 1e-9) fail(`player ${p.id} sunk into ${w.grid[ty * W + tx]} at ${tx},${ty}`);
      }
    }
  }
  const tiles = new Set();
  const owned = new Map();
  let lastId = 0;
  for (const b of w.bombs) {
    if (b.id <= lastId) fail('bomb ids not ascending');
    lastId = b.id;
    if (!b.fly) {
      const key = b.ty * W + b.tx;
      if (tiles.has(key)) fail(`two standing bombs on ${b.tx},${b.ty}`);
      tiles.add(key);
      if (w.grid[key] !== '.') fail(`bomb inside ${w.grid[key]} at ${b.tx},${b.ty}`);
      if (b.fuse <= 0) fail('a bomb with a burnt fuse survived the tick');
    }
    if (!b.fly) {
      for (const p of w.players) {
        if (!p.alive || b.pass.includes(p.id)) continue;
        const ox = Math.min(p.x + HALF, b.tx + 1) - Math.max(p.x - HALF, b.tx);
        const oy = Math.min(p.y + HALF, b.ty + 1) - Math.max(p.y - HALF, b.ty);
        if (ox > EPS + 1e-9 && oy > EPS + 1e-9) fail(`player ${p.id} is inside the bomb ${b.id} at ${b.tx},${b.ty} without a pass`);
      }
    }
    if (b.owner !== -1 && !w.player(b.owner)) fail('bomb of an unknown owner');
    owned.set(b.owner, (owned.get(b.owner) ?? 0) + 1);
    if (b.fly && (b.pass.length || b.dir)) fail('flying bomb with pass or dir');
    for (const id of b.pass) if (!w.player(id)) fail('pass lists an unknown fighter');            // a fighter that died this tick is pruned next tick
    if (![b.x, b.y].every(Number.isFinite)) fail('bomb NaN');
  }
  for (const [owner, count] of owned) if (owner >= 0 && count > w.player(owner).bombsMax) fail(`owner ${owner} has ${count} bombs`);
  let prev = null;
  for (const f of w.flames) {
    if (f.ticks < 1 || f.ticks > C.FLAME_TICKS) fail(`flame ticks ${f.ticks}`);
    if (w.grid[f.ty * W + f.tx] === '#' || w.grid[f.ty * W + f.tx] === 'X') fail('flame inside a wall');
    if (prev && (prev.ty > f.ty || (prev.ty === f.ty && prev.tx >= f.tx))) fail('flames not sorted');
    if (!f.owners.length) fail('flame without owner');
    prev = f;
  }
  let lastItem = 0;
  for (const it of w.items) {
    if (it.id <= lastItem) fail('item ids not ascending');
    lastItem = it.id;
    if (w.grid[it.ty * W + it.tx] !== '.') fail('item inside a wall');
  }
  for (const f of w.falling) if (f.ticksLeft < 1 || f.ticksLeft > C.SD_WARN_TICKS) fail(`falling ticksLeft ${f.ticksLeft}`);
}

function checkEvents(events, ctx) {
  for (const ev of events) {
    assert.ok(ev[0] in EVENT_ARGS, `${ctx}: unknown event ${ev[0]}`);
    assert.equal(ev.length - 1, EVENT_ARGS[ev[0]].length, `${ctx}: ${ev[0]} arity`);
  }
}

/** Plays one whole round; returns the sha1 of all snapshots when `hash` is set. */
function playRound(seed, { hash = false, invariants = false, immortalUntilSd = false } = {}) {
  const opts = scenario(seed);
  const w = new World(opts);
  boost(w, seed);
  const drive = makeDriver(w, seed);
  const sha = hash ? createHash('sha1') : null;
  const limit = C.COUNTDOWN_TICKS + opts.roundTime * 60 + 1120 + C.ENDING_TICKS + 10;
  const leaver = seed % 4 === 0 && opts.fighters.length > 2 ? seed % opts.fighters.length : -1;
  let cursor = 0;
  let outcome = null;
  const deaths = new Map();
  let lastGv = 0;
  const ctx = `seed ${seed}`;
  while (w.state !== STATE.OVER) {
    if (w.tickNo > limit) assert.fail(`${ctx}: the round did not end within ${limit} ticks`);
    drive();
    if (immortalUntilSd && !w.suddenDeath && w.tickNo % 30 === 0) for (const p of w.players) if (p.alive) p.shield = C.SHIELD_FOREVER;
    if (leaver >= 0 && w.tickNo === 1500 + seed) w.removeFighter(leaver);
    w.tick();
    if (outcome) assert.equal(w.outcome, outcome, `${ctx}: outcome object replaced`);
    else if (w.outcome) outcome = w.outcome;
    if (w.gridVer < lastGv) assert.fail(`${ctx}: gridVer went backwards`);
    lastGv = w.gridVer;
    const events = w.eventsSince(cursor);
    if (invariants) {
      checkEvents(events, ctx);
      checkInvariants(w, ctx);
      for (const ev of events) if (ev[0] === 'death') deaths.set(ev[1], (deaths.get(ev[1]) ?? 0) + 1);
      if (w.tickNo % 40 === 0) {
        const snap = w.snapshot({ grid: true, evFrom: cursor });
        assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, `${ctx}: snapshot round trip`);
        assert.equal(snap.p.length, w.players.length);
      }
    }
    if (sha) sha.update(JSON.stringify(w.snapshot({ grid: true, evFrom: cursor })));
    cursor = w.evCount;
    w.trimEvents(cursor);
  }
  if (invariants) {
    assert.ok(w.outcome, `${ctx}: finished without an outcome`);
    assert.equal(w.tickNo - w.outcome.tick, C.ENDING_TICKS, `${ctx}: OVER exactly ENDING_TICKS after the lock`);
    if (w.outcome.winnerId !== null) assert.equal(w.player(w.outcome.winnerId).alive, true, `${ctx}: the winner is alive`);
    for (const p of w.players) {
      assert.equal(p.stats.deaths, deaths.get(p.id) ?? 0, `${ctx}: deaths stat of ${p.id} matches death events`);
      if (p.alive) assert.equal(p.shield, C.SHIELD_FOREVER, `${ctx}: survivors are shielded after the lock`);
    }
  }
  return { w, digest: sha ? sha.digest('hex') : null };
}

// ---- Tests ---------------------------------------------------------------------------------------------

test('two worlds with the same seed and the same cmd stream are byte-identical at every tick over 1800 ticks', () => {
  const opts = scenario(12);
  const a = new World(opts);
  const b = new World(opts);
  boost(a, 12);
  boost(b, 12);
  const driveA = makeDriver(a, 12);
  const driveB = makeDriver(b, 12);
  let cursorA = 0;
  let cursorB = 0;
  for (let t = 0; t < 1800; t++) {
    driveA();
    driveB();
    a.tick();
    b.tick();
    const sa = JSON.stringify(a.snapshot({ grid: true, evFrom: cursorA }));
    const sb = JSON.stringify(b.snapshot({ grid: true, evFrom: cursorB }));
    assert.equal(sa, sb, `diverged at tick ${t + 1}`);
    cursorA = a.evCount;
    cursorB = b.evCount;
  }
  assert.ok(a.evCount > 20, 'the script produced real action');
});

test('the SHA-1 of the concatenated snapshots equals specs/fixtures/determinism.sha1', () => {
  const opts = scenario(12);
  const w = new World(opts);
  boost(w, 12);
  const drive = makeDriver(w, 12);
  const sha = createHash('sha1');
  let cursor = 0;
  for (let t = 0; t < 1800; t++) {
    drive();
    w.tick();
    sha.update(JSON.stringify(w.snapshot({ grid: true, evFrom: cursor })));
    cursor = w.evCount;
    w.trimEvents(cursor);
  }
  const digest = sha.digest('hex');
  if (process.env.UPDATE_DETERMINISM === '1') {
    writeFileSync(SHA_FIXTURE, `${digest}\n`);
    return;
  }
  assert.equal(digest, readFileSync(SHA_FIXTURE, 'utf8').trim(),
    'the simulation changed; if that was deliberate, regenerate with: UPDATE_DETERMINISM=1 node --test specs/unit/determinism.spec.js');
});

test('different seeds give different worlds', () => {
  const digests = new Set([1, 2, 3, 4].map((seed) => {
    const w = new World({ ...scenario(1), seed });
    return JSON.stringify(w.snapshot({ grid: true }));
  }));
  assert.equal(digests.size, 4);
});

test('the order of the fighters array changes nothing but slot assignment order: iteration is by ascending id', () => {
  const opts = scenario(9);
  const shuffled = { ...opts, fighters: [...opts.fighters].reverse() };
  const a = new World(opts);
  const b = new World(shuffled);
  assert.deepEqual(a.player(0).id, b.player(0).id);
  assert.equal(a.grid.join(''), b.grid.join(''), 'the map depends on the seed alone');
  assert.deepEqual(b.players.map((p) => p.id), [...opts.fighters].reverse().map((f) => f.id), 'players keep the given fighter order');
  assert.deepEqual(b.snapshot().p.map((r) => r[P.ID]), b.players.map((p) => p.id));
});

test('soak: 250 seeded random-play rounds (2-8 fighters, all modes and layouts, up to 3 simulated minutes) keep every invariant and always end', () => {
  const ended = { last: 0, wipe: 0, timeout: 0 };
  let ticks = 0;
  let longest = 0;
  for (let seed = 1; seed <= 250; seed++) {
    // The first 150 rounds are played as they come; in the other 100 everyone is invulnerable until sudden death or the timeout,
    // so those rounds run their whole timeline (clock, showdown, spiral, ending) instead of ending in the first minute.
    const { w } = playRound(seed, { invariants: true, immortalUntilSd: seed > 150 });
    ended[w.outcome.reason]++;
    ticks += w.tickNo;
    longest = Math.max(longest, w.tickNo);
  }
  assert.ok(ended.last > 30 && ended.wipe > 0 && ended.timeout > 0, JSON.stringify(ended));
  assert.ok(ticks > 500000, `${ticks} simulated ticks`);
  assert.ok(longest >= 10800, `longest round ${longest} ticks (3 simulated minutes)`);
});

test('soak: re-running seeds reproduces the round tick for tick', () => {
  for (const seed of [5, 10, 15, 20, 25, 30, 35, 40]) {
    const first = playRound(seed, { hash: true });
    const second = playRound(seed, { hash: true });
    assert.equal(first.digest, second.digest, `seed ${seed}`);
    assert.equal(first.w.tickNo, second.w.tickNo);
    assert.deepEqual(first.w.outcome, second.w.outcome);
  }
});

test('soak: three simulated minutes with everybody alive and busy stay sane (immortal fighters, sudden death included)', () => {
  const w = new World({ seed: 99, fighters: Array.from({ length: 8 }, (_, i) => fighter(i)), roundTime: 180, blocks: 'many', items: 'many' });
  boost(w, 99);
  const drive = makeDriver(w, 99);
  let cursor = 0;
  while (w.tickNo < 10800 && w.state !== STATE.OVER) {
    drive();
    for (const p of w.players) if (p.alive && w.tickNo % 30 === 0) p.shield = C.SHIELD_FOREVER;
    w.tick();
    checkInvariants(w, 'immortal soak');
    checkEvents(w.eventsSince(cursor), 'immortal soak');
    cursor = w.evCount;
    w.trimEvents(cursor);
  }
  assert.ok(w.tickNo >= 10800 - 1 || w.state === STATE.OVER);
  assert.ok(w.items.length + w.bombs.length + w.flames.length >= 0);
});

test('an unlimited round with two idle fighters ends at MAX_ROUND_TICKS (draw) without any allocation blow-up', () => {
  const w = new World({ seed: 4, fighters: [fighter(0), fighter(1)], roundTime: 0 });
  const t0 = performance.now();
  // The bound keeps a broken cap from hanging the run: node's test timeout cannot interrupt a synchronous loop.
  while (w.state !== STATE.OVER && w.tickNo <= 180 + C.MAX_ROUND_TICKS + C.ENDING_TICKS + 5) w.tick();
  assert.equal(w.state, STATE.OVER);
  assert.equal(w.outcome.reason, 'timeout');
  assert.equal(w.tickNo, 180 + C.MAX_ROUND_TICKS + C.ENDING_TICKS);
  assert.ok(performance.now() - t0 < 3000);
  assert.ok(w._events.length <= 1100, 'the unread event log stays bounded');
});

test('nobody is ever left inside a wall: sudden death with fighters hugging the tiles that fall', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const opts = { ...scenario(seed), roundTime: 60, suddenDeath: true, mode: 'ffa' };
    const w = new World(opts);
    const rng = makeRng(seed);
    while (w.state === STATE.COUNTDOWN) w.tick();
    while (!w.suddenDeath) { w.tick(); for (const p of w.players) p.shield = C.SHIELD_FOREVER; }
    for (const p of w.players) p.shield = C.SHIELD_FOREVER;
    while (w.state === STATE.PLAYING) {
      for (const p of w.players) {
        if (!p.alive) continue;
        // walk towards the next tile that will fall, trying to squeeze through as it lands
        const next = w.falling[0] ?? { tx: 7, ty: 6 };
        const dx = next.tx + 0.5 - p.x;
        const dy = next.ty + 0.5 - p.y;
        w.applyCmd(p.id, { s: p.lastSeq + 1, d: rng.int(3) === 0 ? rng.int(5) : (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 2 : 4) : (dy > 0 ? 3 : 1)), b: 0, x: 0 });
      }
      w.tick();
      checkInvariants(w, `sd hug seed ${seed}`);
      for (const p of w.players) if (p.alive) assert.ok(!overlapsTileOfWall(w, p), `seed ${seed}`);
    }
  }
});

function overlapsTileOfWall(w, p) {
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (w.grid[ty * W + tx] !== 'X' || !overlapsTile(p, tx, ty)) continue;
      const ox = Math.min(p.x + HALF, tx + 1) - Math.max(p.x - HALF, tx);
      const oy = Math.min(p.y + HALF, ty + 1) - Math.max(p.y - HALF, ty);
      if (ox > EPS + 1e-9 && oy > EPS + 1e-9) return true;
    }
  }
  return false;
}
