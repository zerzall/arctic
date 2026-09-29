import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { RoomManager, TickStats, CODE_ALPHABET, CODE_RE } from '../../server/lobby.js';
import { normalizeIp, clientIp, hashIp } from '../../server/ws.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeConn } from '../helpers/fake-conn.js';

const IP = '203.0.113.7';

function makeManager(opts = {}) {
  const clock = new FakeClock(1000);
  const logs = [];
  const manager = new RoomManager({ now: clock.now, log: (...a) => logs.push(a), ...opts });
  return { manager, clock, logs };
}
const closeAll = (manager) => manager.closeAll();

// ---- Codes and lookup --------------------------------------------------------------------------------

test('codes: 4 letters from the vowel-free alphabet, unique, found case-insensitively', () => {
  const { manager, clock } = makeManager();
  assert.equal(CODE_ALPHABET.length, 20);
  assert.ok(!/[AEIOUY]/.test(CODE_ALPHABET));
  const codes = new Set();
  for (let i = 0; i < 60; i++) {
    const res = manager.create(`10.0.${i}.1`);
    assert.equal(res.ok, true);
    assert.match(res.room.code, CODE_RE);
    codes.add(res.room.code);
    clock.advance(1);
  }
  assert.equal(codes.size, 60);
  const [code] = codes;
  assert.equal(manager.find(code).code, code);
  assert.equal(manager.find(code.toLowerCase()).code, code);
  for (const bad of ['', 'ABC', 'ABCDE', 'AAAA', 'B0CD', null, undefined, 42, {}, '../..', 'KQX\n']) assert.equal(manager.find(bad), null, String(bad));
  closeAll(manager);
});

test('codes: a collision is retried; when every try collides the server is "busy"', () => {
  const sequence = (list) => { let i = 0; return () => list[i++]; };
  const { manager } = makeManager({ randomInt: sequence([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]) });
  assert.equal(manager.create('10.0.0.1').room.code, 'BBBB');
  assert.equal(manager.create('10.0.0.2').room.code, 'CCCC', 'the draw BBBB collided and was retried');
  closeAll(manager);

  const stuck = makeManager({ randomInt: () => 0 });
  assert.equal(stuck.manager.create('10.0.0.1').room.code, 'BBBB');
  assert.deepEqual(stuck.manager.create('10.0.0.2'), { ok: false, error: 'busy' }, 'after 64 collisions we give up instead of spinning');
  closeAll(stuck.manager);
});

// ---- Lifecycle -------------------------------------------------------------------------------------------

test('create: registers the room, starts its loop, passes seed/timeouts/build/log through; onEmpty removes it', () => {
  const seeds = [11, 22];
  const { manager, logs } = makeManager({ seedFn: () => seeds.shift(), build: '3.1.4', timeouts: { EMPTY_CLOSE_MS: 5 } });
  const { room } = manager.create(IP);
  assert.equal(manager.size, 1);
  assert.equal(room.seed, 11);
  assert.equal(room.timeouts.EMPTY_CLOSE_MS, 5);
  assert.equal(room._loopOn, true);
  const c = new FakeConn();
  room.join(c, { name: 'x' });
  assert.equal(c.last('joined').build, '3.1.4');
  assert.ok(logs.some(([lvl, ev, extra]) => lvl === 'info' && ev === 'room_open' && extra.room === room.code));
  room.close();
  assert.equal(manager.size, 0);
  assert.equal(manager.find(room.code), null);
  assert.ok(logs.some(([, ev, extra]) => ev === 'room_close' && extra.room === room.code));
  assert.ok(!JSON.stringify(logs).includes('"x"'), 'names never reach the log');
});

test('create: maxRooms answers busy', () => {
  const { manager } = makeManager({ maxRooms: 2 });
  assert.equal(manager.create('10.0.0.1').ok, true);
  assert.equal(manager.create('10.0.0.2').ok, true);
  assert.deepEqual(manager.create('10.0.0.3'), { ok: false, error: 'busy' });
  closeAll(manager);
});

test('closeAll: closes every room and its connections', () => {
  const { manager } = makeManager();
  const conns = [];
  for (let i = 0; i < 3; i++) {
    const { room } = manager.create(`10.1.0.${i}`);
    const c = new FakeConn();
    room.join(c, { name: 'x' });
    conns.push(c);
  }
  manager.closeAll('restart');
  assert.equal(manager.size, 0);
  assert.ok(conns.every((c) => c.closed && c.closeReason === 'restart' && c.last('error').code === 'closed'));
});

// ---- Per-IP limits -------------------------------------------------------------------------------------------

test('room creation: burst of 3 per IP, one more every 20 s; other IPs are unaffected', () => {
  const { manager, clock } = makeManager();
  for (let i = 0; i < 3; i++) assert.equal(manager.create(IP).ok, true);
  assert.deepEqual(manager.create(IP), { ok: false, error: 'rate_limited' }, 'the 4th create in a row fails');
  assert.equal(manager.create('198.51.100.9').ok, true);
  clock.advance(19999);
  assert.equal(manager.create(IP).ok, false);
  clock.advance(2);
  manager.rooms.get([...manager.rooms.keys()][0]).close();
  assert.equal(manager.create(IP).ok, true, 'a token was refilled after 20 s');
  assert.equal(manager.create(IP).ok, false);
  closeAll(manager);
});

test('room creation: at most 3 LIVE rooms per IP however slowly they are made; closing one frees a slot', () => {
  const { manager, clock } = makeManager();
  for (let i = 0; i < 3; i++) { assert.equal(manager.create(IP).ok, true); clock.advance(60000); }
  assert.deepEqual(manager.create(IP), { ok: false, error: 'rate_limited' }, 'the bucket is full again but 3 rooms are alive');
  const mine = [...manager.rooms.values()][0];
  mine.close();
  assert.equal(manager.create(IP).ok, true);
  closeAll(manager);
});

test('failed joins: more than 15 in 60 s block join for 30 s; successes do not reset the counter; old failures age out', () => {
  const { manager, clock } = makeManager();
  for (let i = 0; i < 15; i++) manager.recordJoinFailure(IP);
  assert.equal(manager.joinBlocked(IP), false, '15 failures are tolerated');
  manager.recordJoinFailure(IP);
  assert.equal(manager.joinBlocked(IP), true, 'the 16th blocks');
  assert.equal(manager.joinBlocked('198.51.100.1'), false, 'per IP');
  clock.advance(29999);
  assert.equal(manager.joinBlocked(IP), true);
  clock.advance(2);
  assert.equal(manager.joinBlocked(IP), false);

  const b = makeManager();
  for (let i = 0; i < 10; i++) b.manager.recordJoinFailure(IP);
  b.clock.advance(61000);
  for (let i = 0; i < 10; i++) b.manager.recordJoinFailure(IP);
  assert.equal(b.manager.joinBlocked(IP), false, 'failures older than 60 s no longer count');
  for (let i = 0; i < 6; i++) b.manager.recordJoinFailure(IP);
  assert.equal(b.manager.joinBlocked(IP), true);
});

test('per-IP tables stay bounded when many IPs each fail once', () => {
  const { manager, clock } = makeManager();
  for (let i = 0; i < 3000; i++) {
    manager.recordJoinFailure(`10.${i >> 8}.${i & 255}.1`);
    clock.advance(100);
  }
  assert.ok(manager._failures.size < 1200, `${manager._failures.size} entries`);
});

// ---- Stats ----------------------------------------------------------------------------------------------------------

test('stats: rooms, entries, connected humans, dropped ticks (also of closed rooms) and the tick window', () => {
  const { manager } = makeManager();
  const a = manager.create('10.2.0.1').room;
  const b = manager.create('10.2.0.2').room;
  a.join(new FakeConn(), { name: 'a' });
  const guest = new FakeConn();
  const g = a.join(guest, { name: 'g' });
  a.receive(0, JSON.stringify({ t: 'addBot', level: 'easy' }), a.entries[0].conn);
  b.join(new FakeConn(), { name: 'b' });
  a.disconnect(g.id, guest);
  const s = manager.stats();
  assert.equal(s.rooms, 2);
  assert.equal(s.players, 4, 'entries incl. bots and the human in grace');
  assert.equal(s.humans, 2, 'connected humans');
  assert.deepEqual(s.tickMs, { avg: 0, p99: 0, max: 0 });
  b.droppedTicks = 7;
  b.close();
  assert.equal(manager.stats().droppedTicks, 7);
  closeAll(manager);
});

test('tick meter: every match tick lands in the window; a tick over 8 ms is logged at most once per 10 s per room', () => {
  const { manager, clock, logs } = makeManager();
  const { room } = manager.create(IP);
  room._meter.record(0.2);
  room._meter.record(9.5);
  room._meter.record(12);
  assert.equal(logs.filter(([, ev]) => ev === 'tick_slow').length, 1);
  assert.deepEqual(logs.find(([, ev]) => ev === 'tick_slow')[2], { room: room.code, ms: 9.5 });
  clock.advance(10001);
  room._meter.record(11);
  assert.equal(logs.filter(([, ev]) => ev === 'tick_slow').length, 2);
  assert.equal(manager.stats().tickMs.max, 11, 'the 12 ms sample is older than the 10 s window');
  closeAll(manager);
});

test('TickStats: avg, p99 and max over a rolling window; old seconds fall out', () => {
  const clock = new FakeClock(0);
  const stats = new TickStats(clock.now, 10);
  assert.deepEqual(stats.summary(), { avg: 0, p99: 0, max: 0 });
  for (let i = 0; i < 99; i++) stats.record(0.4);
  stats.record(6.2);
  const s = stats.summary();
  assert.equal(s.avg, 0.46);
  assert.equal(s.max, 6.2);
  assert.ok(s.p99 >= 0.4 && s.p99 <= 0.5, `p99 ${s.p99} is the 99th of 100 samples`);
  stats.record(6.2);
  assert.ok(stats.summary().p99 > 6, 'two slow samples out of 101 pull p99 up');
  clock.advance(5000);
  stats.record(1);
  assert.equal(stats.summary().max, 6.2, 'still inside the window');
  clock.advance(5001);
  assert.deepEqual(stats.summary(), { avg: 1, p99: 1, max: 1 });
  clock.advance(10000);
  assert.deepEqual(stats.summary(), { avg: 0, p99: 0, max: 0 });
  stats.record(40);
  assert.equal(stats.summary().max, 40, 'the overflow bin still reports the true max');
});

// ---- Client IP -----------------------------------------------------------------------------------------------------------

const fakeReq = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('normalizeIp: IPv4-mapped addresses lose the prefix, IPv6 is keyed by its /64', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(normalizeIp('2001:DB8:1:2::1'), normalizeIp('2001:db8:1:2:ffff::9'));
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(normalizeIp('::1'), '0:0:0:0::/64');
  assert.equal(normalizeIp('fe80::1%eth0'), normalizeIp('fe80::2'));
  assert.equal(normalizeIp(undefined), 'unknown');
  assert.equal(normalizeIp(''), 'unknown');
});

test('clientIp: the socket address without a trusted proxy; the rightmost-N X-Forwarded-For entry with one', () => {
  const spoofed = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.1' };
  assert.equal(clientIp(fakeReq('127.0.0.1', spoofed), 0), '127.0.0.1', 'headers are ignored when no proxy is trusted');
  assert.equal(clientIp(fakeReq('127.0.0.1', spoofed), 1), '10.0.0.1');
  assert.equal(clientIp(fakeReq('127.0.0.1', spoofed), 2), '203.0.113.7');
  assert.equal(clientIp(fakeReq('127.0.0.1', spoofed), 3), '6.6.6.6');
  assert.equal(clientIp(fakeReq('127.0.0.1', spoofed), 4), '127.0.0.1', 'fewer entries than trusted hops: fall back to the socket');
  assert.equal(clientIp(fakeReq('127.0.0.1', {}), 1), '127.0.0.1');
  assert.equal(clientIp(fakeReq('::ffff:127.0.0.1', { 'x-forwarded-for': '::ffff:9.9.9.9' }), 1), '9.9.9.9');
  assert.equal(clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '1.1.1.1' }), 1), '198.51.100.4');
  assert.equal(clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '198.51.100.4' }), 0), '127.0.0.1');
  const fly = { 'fly-client-ip': '198.51.100.5', 'x-forwarded-for': '1.1.1.1' };
  assert.equal(clientIp(fakeReq('127.0.0.1', fly), 1, {}), '1.1.1.1', 'fly-client-ip only counts on Fly');
  assert.equal(clientIp(fakeReq('127.0.0.1', fly), 1, { FLY_APP_NAME: 'bp' }), '198.51.100.5');
});

test('hashIp: 8 hex chars, stable per salt, different across salts, never the address', () => {
  const h = hashIp(IP, 'salt-a');
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(hashIp(IP, 'salt-a'), h);
  assert.notEqual(hashIp(IP, 'salt-b'), h);
  assert.notEqual(hashIp('203.0.113.8', 'salt-a'), h);
});

// ---- Leaks ---------------------------------------------------------------------------------------------------------------

/** `gc()` without needing --expose-gc on the command line. */
function collector() {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc');
}

test('leak: 500 rooms created and closed and 20 short matches played leave no rooms, no timers, no bookkeeping and < 20 MB of heap', (t) => {
  const gc = collector();
  const clock = new FakeClock(1000);
  const suicide = () => { let fired = false; return { think: () => { const b = fired ? 0 : 1; fired = true; return { d: 0, b, x: 0 }; } }; };
  const manager = new RoomManager({
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, maxRooms: 1000, botFactory: suicide, seedFn: () => 7,
  });
  const ipOf = (i) => `10.${i >> 8}.${i & 255}.1`;

  const cycle = (n, offset) => {
    for (let i = 0; i < n; i++) {
      const { room } = manager.create(ipOf(offset + i));
      const conns = [new FakeConn(), new FakeConn()];
      conns.forEach((c, k) => { c.id = room.join(c, { name: `p${k}` }).id; });
      room.receive(conns[0].id, JSON.stringify({ t: 'addBot', level: 'easy' }), conns[0]);
      room.receive(conns[0].id, JSON.stringify({ t: 'chat', text: 'hello' }), conns[0]);
      room.close();
    }
  };
  const play = (n, offset) => {
    for (let i = 0; i < n; i++) {
      const { room } = manager.create(ipOf(offset + i));
      const host = new FakeConn();
      host.id = room.join(host, { name: 'Host' }).id;
      const say = (msg) => room.receive(host.id, JSON.stringify(msg), host);
      say({ t: 'addBot', level: 'easy' });
      say({ t: 'settings', patch: { rounds: 1 } });
      say({ t: 'start' });
      let guard = 0;
      while (room.phase === 'match' && guard++ < 2000) clock.advance(1000 / 60);
      assert.equal(room.phase, 'results', `match ${i} finished`);
      room.close();
    }
  };

  cycle(50, 0);                                             // warm up JIT and caches before the baseline
  gc();
  const before = process.memoryUsage().heapUsed;
  cycle(500, 100);
  play(20, 700);
  gc();
  const growth = (process.memoryUsage().heapUsed - before) / 1048576;
  assert.equal(manager.rooms.size, 0);
  assert.equal(manager.size, 0);
  assert.equal(manager._liveByIp.size, 0);
  assert.equal(manager._ownerOf.size, 0);
  assert.equal(clock.pending, 0, 'no timers left');
  t.diagnostic(`heap growth after 500 rooms and 20 matches: ${growth.toFixed(2)} MB`);
  assert.ok(growth < 20, `heap grew by ${growth.toFixed(1)} MB`);
});
