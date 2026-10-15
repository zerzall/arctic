// Room fixtures (docs/SPEC.md §10.1): a Room on a fake clock with deterministic tokens, humans that join in one call,
// and helpers that drive the match by hand.
//
//   const room = makeRoom({ seed: 1 });            // a Room; the fake clock is `room.clock`
//   const [host, ana] = joinN(room, 2);            // FakeConns with .id and .token; the first is the host
//   say(room, host, { t: 'addBot', level: 'easy' });
//   runUntil(room, (r) => r.world?.state === STATE.PLAYING);
//
// Bots default to `idleBots` so room specs do not depend on shared/bots.js; `wanderBots` walks and bombs at random
// (seeded), which gives snapshots and CPU measurements realistic content.

import { Room } from '../../shared/room.js';
import { makeRng } from '../../shared/rng.js';
import { TICK_RATE } from '../../shared/constants.js';
import { FakeClock } from './fake-clock.js';
import { FakeConn } from './fake-conn.js';

export const TICK_MS = 1000 / TICK_RATE;

export const idleBots = () => ({ think: () => ({ d: 0, b: 0, x: 0 }) });

/** Seeded random walkers that drop bombs now and then. */
export const wanderBots = ({ seed }) => {
  const rng = makeRng(seed);
  let dir = 0;
  return {
    think(world) {
      if (world.tickNo % 15 === 0) dir = rng.int(5);
      return { d: dir, b: rng.next() < 0.004 ? 1 : 0, x: 0 };
    },
  };
};

/**
 * @param {object} [opts] any Room option; `seed` defaults to 1, `code` to 'TEST'
 * @returns {Room} with `.clock` (a FakeClock) attached
 */
export function makeRoom({ seed = 1, code = 'TEST', botFactory = idleBots, ...rest } = {}) {
  const clock = rest.clock ?? new FakeClock();
  delete rest.clock;
  let tokens = 0;
  const room = new Room({
    code, seed, botFactory, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    genToken: () => (++tokens).toString(16).padStart(32, '0'), ...rest,
  });
  room.clock = clock;
  return room;
}

/** Joins `n` humans named P1..Pn. Returns their FakeConns (`.id`, `.token` set). */
export function joinN(room, n, { names = null } = {}) {
  const conns = [];
  for (let i = 0; i < n; i++) {
    const conn = new FakeConn();
    const res = room.join(conn, { name: names?.[i] ?? `P${i + 1}` });
    if (!res.ok) throw new Error(`join ${i} failed: ${res.error}`);
    conn.id = res.id;
    conn.token = res.token;
    conns.push(conn);
  }
  return conns;
}

/** Sends one client message as `conn`. */
export function say(room, conn, msg) {
  room.receive(conn.id, typeof msg === 'string' ? msg : JSON.stringify(msg), conn);
}

/** One Room step with the clock advanced by a tick first. */
export function tick(room) {
  room.clock.advance(TICK_MS);
  room.step();
}

export function ticks(room, n) {
  for (let i = 0; i < n; i++) tick(room);
}

/** Steps until `pred(room)` holds; returns the number of steps taken. Throws when it never does. */
export function runUntil(room, pred, maxTicks = 100000) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred(room)) return i;
    tick(room);
  }
  throw new Error(`condition not reached within ${maxTicks} ticks`);
}

/** Host starts a match with `bots` bots on top of the humans already joined. Returns the host's conn. */
export function startMatch(room, conns, { bots = 0, level = 'easy', settings = {} } = {}) {
  const host = conns[0];
  for (let i = 0; i < bots; i++) say(room, host, { t: 'addBot', level });
  if (Object.keys(settings).length) say(room, host, { t: 'settings', patch: settings });
  say(room, host, { t: 'start' });
  return host;
}
