import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ClientGame, createView } from '../../client/js/game.js';
import { World } from '../../shared/world.js';
import { parseClientMessage, P, PF, B } from '../../shared/protocol.js';
import { makeRng } from '../../shared/rng.js';
import * as C from '../../shared/constants.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeLink, FakeDuplex } from '../helpers/fake-link.js';

const { STATE, TICK_RATE, SNAP_EVERY, COUNTDOWN_HOLD_TICKS, INPUT_QUEUE_MAX, INPUT_CATCHUP_AT, CATCHUP_CREDIT_MAX } = C;
const TICK_MS = 1000 / TICK_RATE;
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.example.json`, import.meta.url), 'utf8'));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ==================================================================================================
// A minimal server: the Room's rules for inputs and snapshots (SPEC 5.0, 5.1, 4.5) on top of a real World.
// The real Room is integration-tested elsewhere; this stand-in exists so the client can be tested end to end
// against the true simulation without waiting for it. It validates every client frame with the real parser.
// ==================================================================================================

/** The `round` message the Room sends for a World (SPEC 4.4). */
function roundMessageFor(w, n = 1, serverTick = 0) {
  return {
    t: 'round', n, seed: w.seed, theme: w.theme, mode: w.mode, w: C.GRID_W, h: C.GRID_H, grid: w.grid.join(''),
    players: w.players.map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team, slot: p.slot, isBot: p.isBot, x: p.x, y: p.y })),
    winsNeeded: 3, roundTime: w.roundTime, suddenDeath: w.sdEnabled, serverTick,
  };
}

class MiniServer {
  /**
   * @param {{ ids?: number[], seed?: number, worldOpts?: object, setup?: (world: World) => void, send: (id: number, msg: object) => void }} o
   *   setup runs on each new World before the `round` message is built (spawn positions there are what the client is told)
   */
  constructor({ ids = [0, 1], seed = 5, worldOpts = {}, setup = null, send }) {
    this.seed = seed;
    this.worldOpts = worldOpts;
    this.setup = setup;
    this.send = send;
    this.entries = new Map(ids.map((id) => [id, { id, lastSeq: 0, appliedSeq: 0, q: [], credit: 0, connected: true }]));
    this.roundNo = 0;
    this.world = null;
    this.trace = new Map(ids.map((id) => [id, new Map()]));      // id -> seq -> position right after that cmd was applied
    this.received = [];                                           // every frame accepted from a client, for assertions
    this.emitted = [];                                            // { ev, at } every event put on a broadcast, `at` = the send() clock
    this.overTicks = 0;
  }

  get ids() {
    return [...this.entries.keys()].sort((a, b) => a - b);
  }

  /** A (re)connecting client: `joined` with the entry's last accepted seq, then the live round and a full snapshot (Appendix A.4 F4). */
  join(id) {
    const e = this.entries.get(id);
    e.connected = true;
    e.q.length = 0;
    this.send(id, { t: 'joined', v: 1, id, token: `tok${id}`, code: 'TEST', seq: e.lastSeq, build: '1.0.0' });
    if (this.world) {
      this.send(id, this.roundMessage(this.world.tickNo));
      this.send(id, this.world.snapshot({ grid: true, evFrom: null }));
    }
  }

  disconnect(id) {
    const e = this.entries.get(id);
    e.connected = false;
    e.q.length = 0;
  }

  roundMessage(serverTick) {
    return roundMessageFor(this.world, this.roundNo, serverTick);
  }

  startRound() {
    this.roundNo++;
    const fighters = this.ids.map((id) => {
      const e = this.entries.get(id);
      e.q.length = 0;
      e.appliedSeq = e.lastSeq;
      e.credit = 0;
      return { id, name: `P${id}`, color: id, team: id % 2, isBot: false, lastSeq: e.appliedSeq };
    });
    this.world = new World({ seed: this.seed + this.roundNo, fighters, layout: 'open', blocks: 'few', items: 'none', roundTime: 120, ...this.worldOpts });
    this.setup?.(this.world, this.roundNo);
    this.lastSentGv = this.world.gridVer;
    this.evCursor = 0;
    this.overTicks = 0;
    for (const id of this.ids) {
      this.send(id, this.roundMessage(0));
      this.send(id, this.world.snapshot({ grid: true, evFrom: null }));
    }
  }

  receive(id, msg) {
    const parsed = parseClientMessage(msg);
    assert.ok(parsed.ok, `the client sent a frame the server would reject: ${JSON.stringify(msg)}`);
    const e = this.entries.get(id);
    if (!e.connected) return;
    this.received.push({ id, msg: parsed.msg });
    if (parsed.msg.t === 'sync') {
      if (this.world) this.send(id, this.world.snapshot({ grid: true, evFrom: null }));
    } else if (parsed.msg.t === 'ping') {
      this.send(id, { t: 'pong', ts: parsed.msg.ts });
    } else if (parsed.msg.t === 'in') {
      for (const [s, d, b, x] of parsed.msg.c) {
        if (s <= e.lastSeq) continue;
        e.lastSeq = s;
        if (e.q.length >= INPUT_QUEUE_MAX) {
          const old = e.q.shift();
          e.q[0].b |= old.b;
          e.q[0].x |= old.x;
        }
        e.q.push({ s, d, b, x });
      }
    }
  }

  /** One 1/60 s step in the order of SPEC 5.0. */
  step() {
    const w = this.world;
    if (!w) return;
    if (w.state !== STATE.OVER) {
      for (const id of this.ids) {
        const e = this.entries.get(id);
        if (!e.connected) continue;
        const hold = w.state === STATE.COUNTDOWN && w.countdown <= COUNTDOWN_HOLD_TICKS;
        if (hold) {
          e.credit = Math.min(CATCHUP_CREDIT_MAX, e.credit + 1);
        } else {
          if (e.q.length) this.apply(e, e.q.shift());
          else e.credit = Math.min(CATCHUP_CREDIT_MAX, e.credit + 1);
          if (e.q.length > INPUT_CATCHUP_AT && e.credit > 0) {
            e.credit--;
            this.apply(e, e.q.shift());
          }
        }
      }
    }
    w.tick();
    if (w.state !== STATE.OVER && w.tickNo % SNAP_EVERY === 0) this.broadcast();
    if (w.state === STATE.OVER && ++this.overTicks === C.OVER_HOLD_TICKS) this.startRound();
  }

  apply(e, cmd) {
    this.world.applyCmd(e.id, cmd);
    e.appliedSeq = cmd.s;
    const p = this.world.player(e.id);
    this.trace.get(e.id).set(cmd.s, { x: p.x, y: p.y });
  }

  broadcast() {
    const w = this.world;
    const snap = w.snapshot({ grid: w.gridVer !== this.lastSentGv || w.tickNo % 60 === 0, evFrom: this.evCursor });
    this.lastSentGv = w.gridVer;
    this.evCursor = w.evCount;
    w.trimEvents(this.evCursor);
    for (const ev of snap.e) this.emitted.push({ ev, at: this.clockNow?.() });
    for (const id of this.ids) if (this.entries.get(id).connected) this.send(id, snap);
  }
}

// ==================================================================================================
// A simulation: N clients and the server on one fake clock, joined by jittery links.
// ==================================================================================================

/** Wires a ClientGame the way main.js does. `script(tMs, client)` supplies the intent for every frame. */
class SimClient {
  constructor(sim, id, script) {
    this.sim = sim;
    this.id = id;
    this.script = script;
    this.frames = [];                                    // { t, seq, local, maxError } per frame
    this.msgs = [];                                      // every server message, as delivered
    this.events = [];                                    // everything takeEvents() returned
    this.sent = [];                                      // { t, msg } for everything the game handed to the transport
    this.game = new ClientGame({ me: id, send: (obj) => { this.sent.push({ t: sim.clock.now(), msg: obj }); this.duplex.up.send(obj); }, now: () => sim.clock.now() });
    this.duplex = this.makeDuplex();
    this.nextFrame = 0;
    this.nextPing = 0;
  }

  makeDuplex() {
    const { sim, id } = this;
    return new FakeDuplex({
      clock: sim.clock, latency: sim.latency, jitter: sim.jitter, loss: sim.loss, seed: sim.seed + id * 101 + (this.generation = (this.generation ?? 0) + 1),
      toServer: (msg) => sim.server.receive(id, msg),
      toClient: (msg, due) => this.onServerMessage(msg, due),
    });
  }

  /** The socket dies: packets in flight vanish and the server keeps the entry (and its lastSeq) in grace. `hold`: main.js pauses the game. */
  drop({ hold = true } = {}) {
    if (hold) this.game.pauseSending();
    this.duplex.up.blackout(Infinity);
    this.duplex.down.blackout(Infinity);
    this.duplex.up._queue.length = this.duplex.down._queue.length = 0;
    this.sim.server.disconnect(this.id);
  }

  /** A new socket with the same token: `joined{seq}`, the live `round`, a full snapshot (Appendix A.4 F4). */
  reconnect() {
    this.duplex = this.makeDuplex();
    this.sim.server.join(this.id);
  }

  onServerMessage(msg, due) {
    this.msgs.push(msg);
    if (msg.t === 'joined') this.game.setSeq(msg.seq);
    else if (msg.t === 'round') this.game.reset(msg);
    else if (msg.t === 'snap') this.game.onSnapshot(msg, due);
    else if (msg.t === 'pong') this.game.onPong(msg.ts);
  }

  frame(t) {
    const g = this.game;
    g.setIntent(this.script ? this.script(t, this) : {});
    g.update(t);
    const view = g.getView(t);
    for (const ev of g.takeEvents()) this.events.push({ t, ev });
    const local = view.local && view.state !== STATE.COUNTDOWN ? { x: view.local.x, y: view.local.y, alive: view.local.alive } : null;
    this.frames.push({ t, seq: g.seq, local, maxError: g.stats.maxError, corrections: g.stats.corrections });
  }
}

class Sim {
  constructor({ latency = 80, jitter = 40, loss = 0, seed = 3, ids = [0, 1], scripts = {}, frameMs = TICK_MS, frameJitter = 0, serverOpts = {} } = {}) {
    this.clock = new FakeClock(1000);
    this.latency = latency;
    this.jitter = jitter;
    this.loss = loss;
    this.seed = seed;
    this.frameMs = frameMs;
    this.frameJitter = frameJitter;
    this.rng = makeRng(seed * 31 + 7);
    this.server = new MiniServer({ ids, seed, send: (id, msg) => this.clients.get(id)?.duplex.down.send(msg), ...serverOpts });
    this.server.clockNow = () => this.clock.now();
    this.clients = new Map(ids.map((id) => [id, new SimClient(this, id, scripts[id])]));
    this.nextTick = this.clock.now() + TICK_MS;
    this.scheduled = [];                                 // [{ at, fn }] callbacks fired when the clock passes `at`
    for (const c of this.clients.values()) c.nextFrame = this.clock.now() + 5;
    for (const id of ids) this.server.join(id);
    this.server.startRound();
  }

  get t() {
    return this.clock.now();
  }

  client(id = 0) {
    return this.clients.get(id);
  }

  /** Runs `fn` at simulated time `at`, just before the server tick of that instant. */
  at(at, fn) {
    this.scheduled.push({ at, fn });
  }

  /** Advances fake time by `ms`, in quarter-tick slices; within a slice: deliveries, the server tick, then client frames. */
  run(ms) {
    const end = this.t + ms;
    while (this.t < end) {
      this.clock.advance(Math.min(TICK_MS / 4, end - this.t));
      const now = this.t;
      for (const c of this.clients.values()) c.duplex.pump(now);
      for (const job of this.scheduled.filter((j) => j.at <= now)) {
        this.scheduled.splice(this.scheduled.indexOf(job), 1);
        job.fn();
      }
      while (this.nextTick <= now + 1e-9) {
        this.server.step();
        this.nextTick += TICK_MS;
      }
      for (const c of this.clients.values()) {
        while (c.nextFrame <= now + 1e-9) {
          if (now >= c.nextPing) {
            c.duplex.up.send({ t: 'ping', ts: now });
            c.nextPing = now + 2000;
          }
          c.frame(c.nextFrame);
          c.nextFrame += this.frameMs + (this.frameJitter ? (this.rng.next() * 2 - 1) * this.frameJitter : 0);
        }
      }
      for (const c of this.clients.values()) c.duplex.pump(now);
    }
  }

  /** Runs until `pred()` holds (checked every slice) or `maxMs` pass; returns whether it held. */
  runUntil(pred, maxMs = 20000) {
    const end = this.t + maxMs;
    while (this.t < end) {
      if (pred()) return true;
      this.run(TICK_MS / 4);
    }
    return pred();
  }

  /** Distance between what the client shows and where the server ends up after the same cmd, per frame with a server record. */
  errors(id = 0, fromMs = 0) {
    const trace = this.server.trace.get(id);
    const out = [];
    for (const f of this.client(id).frames) {
      if (f.t < fromMs || !f.local || !f.local.alive) continue;
      const truth = trace.get(f.seq);
      if (truth) out.push({ t: f.t, err: dist(f.local, truth) });
    }
    return out;
  }
}


/** Opens the board (no soft blocks) so a scenario does not depend on the seeded map, and puts fighters where the scenario wants them. */
function arena(spots, tweak = () => {}) {
  return (world) => {
    for (let i = 0; i < world.grid.length; i++) if (world.grid[i] === '+') world.grid[i] = '.';
    for (const [id, [x, y]] of Object.entries(spots)) {
      const p = world.player(Number(id));
      p.x = x;
      p.y = y;
    }
    tweak(world);
  };
}

/** Scripted intent from `[startMs, d, bomb?]` steps, measured from `t0`: each step holds until the next starts; `bomb` taps once. */
function timeline(t0, steps) {
  const fired = new Set();
  return (t) => {
    let at = -1;
    for (let i = 0; i < steps.length && steps[i][0] <= t - t0; i++) at = i;
    if (at < 0) return { d: 0 };
    const tap = steps[at][2] === true && !fired.has(at);
    if (tap) fired.add(at);
    return { d: steps[at][1], bomb: tap };
  };
}

/** Simulated time at which the first round's countdown ends (the sim's clock starts at 1000 ms). */
const GO_AT = 1000 + C.COUNTDOWN_TICKS * TICK_MS;

/** Skips the countdown. */
const untilPlaying = (sim) => assert.ok(sim.runUntil(() => sim.server.world.state === STATE.PLAYING, 6000), 'the round starts');

/** A wandering intent: a new random direction every 0.3-1.2 s, a bomb every 2-4 s. Deterministic per seed. */
function wanderer(seed, { bombs = true } = {}) {
  const rng = makeRng(seed);
  let d = 0;
  let nextTurn = 0;
  let nextBomb = 3000;
  return (t) => {
    if (t >= nextTurn) {
      d = rng.int(5);
      nextTurn = t + 300 + rng.int(900);
    }
    let bomb = false;
    if (bombs && t >= nextBomb) {
      bomb = true;
      nextBomb = t + 2000 + rng.int(2000);
    }
    return { d, bomb };
  };
}

test('prediction: an 80 ms +/- 40 ms link keeps the shown position within 0.05 tile of the server outcome', () => {
  const sim = new Sim({ latency: 80, jitter: 40, scripts: { 0: wanderer(11, { bombs: false }) } });
  untilPlaying(sim);
  sim.run(20000);
  const errs = sim.errors(0, sim.t - 19000);
  assert.ok(errs.length > 1000, `enough frames were compared (${errs.length})`);
  const worst = Math.max(...errs.map((e) => e.err));
  assert.ok(worst < 0.05, `worst error ${worst}`);
});

test('prediction: bombs, frame-rate jitter and 80 ms +/- 40 ms keep the error under 0.05 tile too', () => {
  const sim = new Sim({ scripts: { 0: wanderer(23) }, frameMs: 1000 / 75, frameJitter: 4, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }, (w) => { w.player(0).shield = C.SHIELD_FOREVER; }) } });
  untilPlaying(sim);
  sim.run(25000);
  const errs = sim.errors(0, GO_AT + 1000);
  assert.ok(errs.length > 1000);
  const worst = Math.max(...errs.map((e) => e.err));
  assert.ok(worst < 0.05, `worst error ${worst}`);
  assert.ok(sim.server.world.tickNo > 0);
});

test('forced teleport: a 1.5-tile correction glides away and is gone 300 ms after it arrives', () => {
  const sim = new Sim({ serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(1500);
  const client = sim.client(0);
  const before = client.game.stats.corrections;
  const world = sim.server.world;
  const teleportedAt = sim.t;
  world.player(0).y += 1.5;                                 // the server moves the fighter; the client does not know yet
  sim.run(1500);

  const big = client.frames.find((f) => f.t > teleportedAt && f.maxError > 0.5);
  assert.ok(big, 'the client noticed the teleport');
  assert.ok(client.game.stats.corrections > before);
  const errs = sim.errors(0, big.t);
  assert.ok(errs[0].err > 1, `the correction is smoothed, not a snap (first frame ${errs[0].err})`);
  for (let i = 1; i < errs.length; i++) assert.ok(errs[i].err <= errs[i - 1].err + 0.01, `the offset only shrinks (${errs[i - 1].err} -> ${errs[i].err})`);
  for (const e of errs.filter((x) => x.t >= big.t + 300)) assert.ok(e.err < 0.05, `at +${e.t - big.t} ms the error is ${e.err}`);
});

test('forced teleport of 2 tiles or more snaps at once (no long slide across the arena)', () => {
  const sim = new Sim({ serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(1500);
  sim.server.world.player(0).x += 3;
  sim.run(1500);
  const client = sim.client(0);
  const big = client.frames.find((f) => f.maxError > 2);
  assert.ok(big);
  const errs = sim.errors(0, big.t + TICK_MS);
  assert.ok(errs.every((e) => e.err < 0.05), 'shown position equals the server outcome from the frame after the correction');
});

test('corners: walking up and down a column beside pillars never rubber-bands', () => {
  // Column 2 runs beside the pillars at (3,2), (3,6) and (3,10). A nudge to the right puts the fighter's centre over column 2 but its
  // hitbox 0.02 over the pillar column, so every pillar row makes movePlayer slide it back to the lane centre.
  const route = [];
  let at = 0;
  const leg = (d, ms) => { route.push([at, d]); at += ms; };
  for (let lap = 0; lap < 3; lap++) { leg(2, 56); leg(3, 3000); leg(2, 56); leg(1, 3000); }
  const sim = new Sim({ scripts: { 0: timeline(GO_AT + 300, route) }, serverOpts: { setup: arena({ 0: [2.5, 1.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(20000);
  const client = sim.client(0);
  assert.ok(client.game.stats.maxError < 0.01, `largest correction ${client.game.stats.maxError}`);
  assert.ok(Math.max(...sim.errors(0, GO_AT).map((e) => e.err)) < 0.01);

  // Count the server ticks on which the fighter moved sideways while pushing along the other axis: those are corner slides.
  const dirs = new Map();
  for (const { id, msg } of sim.server.received) if (id === 0 && msg.t === 'in') for (const [s, d] of msg.c) dirs.set(s, d);
  const trace = sim.server.trace.get(0);
  let slides = 0;
  for (const [s, pos] of trace) {
    const before = trace.get(s - 1);
    const d = dirs.get(s);
    if (!before || (d !== 1 && d !== 3)) continue;
    if (Math.abs(pos.x - before.x) > 1e-9) slides++;
  }
  assert.ok(slides >= 15, `the route exercised corner slides (${slides} ticks)`);
});

test('bombs: a placed bomb is solid the moment I stepped off it, the ghost and the server bomb never show together', () => {
  // Right for 15 ticks takes the hitbox just off the bomb's tile; turning straight back is the case only the `left` map can predict,
  // because the snapshots (a round trip old) still list me as allowed to walk through.
  const steps = [[300, 0, true], [400, 2], [650, 4], [1600, 0]];
  const sim = new Sim({ scripts: { 0: timeline(GO_AT, steps) }, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }, (w) => { w.player(0).shield = C.SHIELD_FOREVER; }) } });
  const shown = [];
  const seen = { ghost: 0, server: 0, both: 0 };
  const client = sim.client(0);
  const frame = client.frame.bind(client);
  client.frame = (t) => {
    frame(t);
    const v = client.game.view;
    const mine = v.bombs.filter((b) => b.owner === 0).length;
    if (v.ghostBombs.length) seen.ghost++;
    if (mine) seen.server++;
    if (v.ghostBombs.length && mine) seen.both++;
    if (v.local) shown.push({ t, x: v.local.x });
  };
  untilPlaying(sim);
  sim.run(3500);
  assert.ok(seen.ghost >= 4 && seen.ghost < 25, `the ghost lives about one round trip (${seen.ghost} frames)`);
  assert.ok(seen.server > 30);
  assert.equal(seen.both, 0, 'the swap from ghost to server bomb is atomic');
  const walkBack = shown.filter((f) => f.t > GO_AT + 650 && f.t < GO_AT + 1600);
  assert.ok(Math.min(...walkBack.map((f) => f.x)) > 2 + C.PLAYER_HALF - 0.011, `the bomb blocks the way back (x reached ${Math.min(...walkBack.map((f) => f.x))})`);
  assert.ok(client.game.stats.maxError < 0.01, `largest correction ${client.game.stats.maxError}`);
  assert.ok(Math.max(...sim.errors(0, GO_AT).map((e) => e.err)) < 0.01);
});

test('bombs: my own ghost is solid again the moment I stepped off it, before the server has even answered', () => {
  // Standing near a tile edge, one short step off the bomb and straight back. On a 240 ms round trip the ghost is still the only bomb
  // the client knows, so only the ghost's `left` entry can stop the walk back in.
  const steps = [[300, 0, true], [340, 2], [490, 4], [1400, 0]];
  const sim = new Sim({ latency: 120, jitter: 0, scripts: { 0: timeline(GO_AT, steps) }, serverOpts: { setup: arena({ 0: [1.9, 1.5], 1: [13.5, 11.5] }, (w) => { w.player(0).shield = C.SHIELD_FOREVER; }) } });
  const client = sim.client(0);
  let ghostWhileBlocked = false;
  const frame = client.frame.bind(client);
  client.frame = (t) => {
    frame(t);
    const v = client.game.view;
    if (t > GO_AT + 520 && t < GO_AT + 700 && v.ghostBombs.length && v.local && v.local.x < 2.4) ghostWhileBlocked = true;
  };
  untilPlaying(sim);
  sim.run(2500);
  assert.ok(ghostWhileBlocked, 'the ghost was still on screen while the fighter pressed against it');
  assert.ok(client.game.stats.maxError < 0.01, `largest correction ${client.game.stats.maxError}`);
  assert.ok(Math.max(...sim.errors(0, GO_AT).map((e) => e.err)) < 0.01);
});

test('bombs: a placement the server refuses removes its ghost after one round trip, without a second sound', () => {
  const sim = new Sim({ scripts: { 0: timeline(GO_AT, [[1000, 0, true], [2500, 0, true]]) }, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }) } });
  sim.at(GO_AT + 990, () => { const p = sim.server.world.player(0); p.curse = 'nobomb'; p.curseTicks = 600; });   // the client learns about it a round trip later
  untilPlaying(sim);
  sim.run(4000);
  const client = sim.client(0);
  const ghostFrames = client.frames.filter((f) => f.t > GO_AT + 1000 && f.t < GO_AT + 1600);
  assert.equal(sim.server.world.bombs.length, 0, 'the server never placed a bomb');
  const bombEvents = client.events.filter((e) => e.ev[0] === 'bomb');
  assert.equal(bombEvents.length, 1, 'only the local sound of the first tap; the second tap knows about the curse and does nothing');
  assert.deepEqual(bombEvents[0].ev, ['bomb', -1, 0, 1, 1]);
  assert.ok(ghostFrames.length > 0);
  assert.equal(client.game.view.ghostBombs.length, 0);
});

test('death: no more cmds, no ghost, one death event; the next round continues the seq and predicts exactly again', () => {
  const sim = new Sim({ scripts: { 0: wanderer(5) }, serverOpts: { setup: (w, n) => arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }, (x) => { x.player(1).shield = 0; })(w, n) } });
  const client = sim.client(0);
  client.script = timeline(GO_AT, [[200, 0, true]]);           // place a bomb and stand on it: a self-kill 2.5 s later
  untilPlaying(sim);
  assert.ok(sim.runUntil(() => client.game.view.local && !client.game.view.local.alive, 8000), 'I died');
  const deaths = () => client.events.filter((e) => e.ev[0] === 'death' && e.ev[1] === 0);
  assert.equal(deaths().length, 1);
  assert.equal(deaths()[0].ev[2], 0, 'a self-kill credits the victim');
  const seqAtDeath = client.game.seq;
  assert.equal(client.game.view.ghostBombs.length, 0);
  sim.run(500);
  assert.equal(client.game.seq, seqAtDeath, 'a dead fighter sends nothing');
  const w1 = client.game.view.local.deadT;
  sim.run(200);
  assert.ok(client.game.view.local.deadT > w1, 'deadT keeps counting');

  // Round 2: the entry keeps its seq; both sides agree again once the fighter can move.
  client.script = wanderer(9, { bombs: false });
  assert.ok(sim.runUntil(() => sim.server.roundNo === 2 && sim.server.world.state === STATE.PLAYING, 12000), 'round 2 is live');
  sim.run(3000);
  assert.ok(client.game.seq > seqAtDeath, 'seq kept counting across the round change');
  assert.equal(deaths().length, 1);
  const entry = sim.server.entries.get(0);
  assert.ok(client.game.seq - entry.appliedSeq < 40, `acks are flowing (client ${client.game.seq}, applied ${entry.appliedSeq})`);
  const errs = sim.errors(0, sim.t - 2500);
  assert.ok(errs.length > 100 && Math.max(...errs.map((e) => e.err)) < 0.01);
});

test('reconnect: joined.seq continues the numbering, so the server accepts the very next cmd', () => {
  const sim = new Sim({ scripts: { 0: wanderer(31, { bombs: false }) }, serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(4000);
  const client = sim.client(0);
  const entry = sim.server.entries.get(0);
  client.drop();
  sim.run(1500);                                            // the link is down; the paused game builds nothing
  const seqAtDrop = client.game.seq;
  sim.run(500);
  assert.equal(client.game.seq, seqAtDrop, 'a game that was told the link is down does not run ahead of the server');

  const lastSeqAtJoin = entry.lastSeq;
  const sentBefore = client.sent.length;
  client.reconnect();
  sim.run(3000);
  const joined = client.msgs.filter((m) => m.t === 'joined').pop();
  assert.equal(joined.seq, lastSeqAtJoin, 'joined carries the server-side high-water mark');
  const first = client.sent.slice(sentBefore).find((r) => r.msg.t === 'in');
  assert.equal(first.msg.c[0][0], joined.seq + 1, 'numbering restarts right after the server\'s last seq');
  assert.ok(first.t >= client.msgs.filter((m) => m.t === 'joined').length && sim.t > 0);
  assert.ok(entry.appliedSeq > joined.seq + 100, 'and the server keeps applying them (never frozen)');
  const errs = sim.errors(0, sim.t - 2000);
  assert.ok(errs.length > 60 && Math.max(...errs.map((e) => e.err)) < 0.01);
});

test('reconnect: even a client that kept ticking through the outage is never frozen for more than a queue length', () => {
  const sim = new Sim({ scripts: { 0: wanderer(33, { bombs: false }) }, serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(3000);
  const client = sim.client(0);
  const entry = sim.server.entries.get(0);
  client.drop({ hold: false });                             // main.js forgot to pause: the game keeps numbering cmds nobody receives
  sim.run(3000);
  assert.ok(client.game.seq > entry.lastSeq + 150);
  client.reconnect();                                       // ...and its stale cmds reach the server before `joined` reaches the client
  const applied = entry.appliedSeq;
  sim.run(2500);
  assert.ok(entry.appliedSeq > applied + 100, `the server applied ${entry.appliedSeq - applied} cmds after the reconnect`);
  assert.ok(client.game.seq - entry.appliedSeq < 40, 'the client is in step with the server again');
});

test('events: none twice and none lost across a reconnect, except what happened while the link was down', () => {
  const sim = new Sim({ scripts: { 0: wanderer(51), 1: wanderer(52) }, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }, (w) => { for (const p of w.players) p.shield = C.SHIELD_FOREVER; }) } });
  untilPlaying(sim);
  sim.run(8000);
  const client = sim.client(0);
  const droppedAt = sim.t;
  client.drop();
  sim.run(2500);
  client.reconnect();
  const reconnectedAt = sim.t;
  sim.run(9000);

  const outside = (t) => t < droppedAt - 200 || t > reconnectedAt + 400;
  // Foes' bombs arrive as server events, exactly once each.
  const foeDelivered = client.events.filter((e) => e.ev[0] === 'bomb' && e.ev[2] === 1).map((e) => e.ev[1]);
  assert.equal(new Set(foeDelivered).size, foeDelivered.length, 'no bomb event was delivered twice');
  const foeMissing = sim.server.emitted.filter((e) => e.ev[0] === 'bomb' && e.ev[2] === 1 && !foeDelivered.includes(e.ev[1]));
  assert.ok(foeDelivered.length >= 5, `plenty of foe bombs (${foeDelivered.length})`);
  for (const m of foeMissing) assert.ok(!outside(m.at), `bomb ${m.ev[1]} emitted at ${m.at} was lost outside the outage [${droppedAt}, ${reconnectedAt}]`);
  // My own bombs sound exactly once each: the local synthetic event, with the server's twin dropped.
  const ownEmitted = sim.server.emitted.filter((e) => e.ev[0] === 'bomb' && e.ev[2] === 0 && outside(e.at)).length;
  const ownHeard = client.events.filter((e) => e.ev[0] === 'bomb' && (e.ev[1] === -1 || e.ev[2] === 0) && outside(e.t)).length;
  assert.ok(ownEmitted >= 5);
  assert.equal(ownHeard, ownEmitted, 'one sound per own bomb');
  const booms = client.events.filter((e) => e.ev[0] === 'boom').map((e) => e.ev[1]);
  assert.equal(new Set(booms).size, booms.length, 'nor any explosion');
});

test('countdown: the client starts sending a few ticks before its estimate of GO, and the first bomb lands right after GO', () => {
  const latency = 60;
  const sim = new Sim({ jitter: 0, latency, scripts: { 0: (t) => ({ d: 0, bomb: t > 1500 && Math.floor(t / 100) % 3 === 0 }) }, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }) } });
  const client = sim.client(0);
  assert.ok(sim.runUntil(() => client.sent.some((r) => r.msg.t === 'in'), 6000));
  const firstIn = client.sent.find((r) => r.msg.t === 'in');
  const estimatedGo = GO_AT + latency;                       // the snapshots that carry `cd` are one way late
  const lead = Math.min(COUNTDOWN_HOLD_TICKS, client.game.rtt * 0.03 + 2) * TICK_MS;
  assert.ok(Math.abs(firstIn.t - (estimatedGo - lead)) < 2 * TICK_MS, `first cmd at ${firstIn.t - GO_AT} ms vs GO (expected ~${estimatedGo - lead - GO_AT})`);
  assert.ok(sim.runUntil(() => sim.server.world.bombs.length > 0, 3000), 'the first bomb happens');
  assert.ok(sim.server.world.tickNo <= C.COUNTDOWN_TICKS + 6, `first bomb at tick ${sim.server.world.tickNo}: within a few ticks of GO`);
  sim.run(600);
  const sounds = client.events.filter((e) => e.ev[0] === 'bomb');
  assert.equal(sounds.length, 1, 'one bomb, one sound');
  assert.ok(sounds[0].t >= GO_AT, 'never before GO');
});

test('a lossy link never leaves the fighter far from the server for long', () => {
  const sim = new Sim({ loss: 0.05, scripts: { 0: timeline(GO_AT, [[500, 2], [2000, 0]]) }, serverOpts: { setup: arena({ 0: [1.5, 1.5], 1: [13.5, 11.5] }) } });
  untilPlaying(sim);
  sim.run(6000);
  const client = sim.client(0);
  const end = sim.errors(0, sim.t - 1000);
  assert.ok(Math.max(...end.map((e) => e.err)) < 0.05, 'standing still, everything settles');
  assert.ok(client.game.view.local.alive);
});

for (const [curse, ms] of [['reverse', 6000], ['rush', 6000], ['slow', 6000]]) {
  test(`curses: ${curse} is predicted exactly over more than 300 ticks (effectiveDir / effectiveSpeed are the shared ones)`, () => {
    const sim = new Sim({
      scripts: { 0: wanderer(41, { bombs: false }) },
      serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }, (w) => { const p = w.player(0); p.curse = curse; p.curseTicks = 900; }) },
    });
    untilPlaying(sim);
    sim.run(ms);
    const errs = sim.errors(0, GO_AT);
    assert.ok(errs.length > 300);
    assert.ok(Math.max(...errs.map((e) => e.err)) < 0.01, `worst error ${Math.max(...errs.map((e) => e.err))}`);
    assert.equal(sim.server.world.player(0).curse, curse, 'the curse was still active');
  });
}

test('curses: the curse running out (server clock) is predicted at the same tick', () => {
  const sim = new Sim({
    scripts: { 0: wanderer(43, { bombs: false }) },
    serverOpts: { setup: arena({ 0: [5.5, 5.5], 1: [13.5, 11.5] }, (w) => { const p = w.player(0); p.curse = 'slow'; p.curseTicks = 200; }) },
  });
  untilPlaying(sim);
  sim.run(6000);
  assert.equal(sim.server.world.player(0).curse, null, 'it ran out');
  const errs = sim.errors(0, GO_AT);
  assert.ok(Math.max(...errs.map((e) => e.err)) < 0.01);
});

// ==================================================================================================
// Unit level: hand-built snapshots for exact control over what the client sees.
// ==================================================================================================

const prow = (id, x, y, o = {}) => [id, x, y, o.f ?? 2, o.fl ?? 2, o.sh ?? 0, o.ss ?? 0, o.cu ?? 0, o.ct ?? 0, o.bm ?? 1, o.rg ?? 2, o.sp ?? 0, o.dt ?? 0];
const brow = (id, owner, tx, ty, o = {}) => [id, owner, o.x ?? tx + 0.5, o.y ?? ty + 0.5, tx, ty, o.fu ?? 100, o.rg ?? 2, o.d ?? 0, o.fl ?? 0, o.ps ?? []];
const mkSnap = (k, o = {}) => ({
  t: 'snap', k, st: o.st ?? 1, cd: o.cd ?? 0, r: o.r ?? 7000, sd: o.sd ?? 0, gv: o.gv ?? 0, ack: o.ack ?? { 0: 0 },
  p: o.p ?? [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)], b: o.b ?? [], f: o.f ?? [], i: o.i ?? [], fall: o.fall ?? [], ...(o.g ? { g: o.g } : {}), e: o.e ?? [],
});
const OPEN_GRID = (() => {
  const w = new World({ seed: 1, fighters: [{ id: 0, name: 'a', color: 0, team: 0, isBot: false }, { id: 1, name: 'b', color: 1, team: 1, isBot: false }], layout: 'open', blocks: 'few', items: 'none' });
  return w.grid.map((c) => (c === '+' ? '.' : c)).join('');
})();
const roundMsg = (o = {}) => ({
  t: 'round', n: 1, seed: 1, theme: 'frost', mode: 'ffa', w: 15, h: 13, grid: OPEN_GRID,
  players: [{ id: 0, name: 'Ann', color: 0, team: 0, slot: 0, isBot: false, x: 1.5, y: 1.5 }, { id: 1, name: 'Bob', color: 1, team: 1, slot: 1, isBot: true, x: 13.5, y: 11.5 }],
  winsNeeded: 3, roundTime: 120, suddenDeath: true, serverTick: 0, ...o,
});

/** A ClientGame on a manual clock with a recording transport, already in a round. `step(ms)` runs frames of `frame` ms. */
function unit({ me = 0, round = {}, frame = TICK_MS } = {}) {
  const u = { t: 0, sent: [] };
  u.game = new ClientGame({ me, send: (m) => u.sent.push(m), now: () => u.t });
  u.game.reset(roundMsg(round));
  u.snap = (k, o = {}, at = u.t) => u.game.onSnapshot(mkSnap(k, o), at);
  u.step = (ms, intent) => {
    for (let end = u.t + ms; u.t < end - 1e-9;) {
      u.t += frame;
      if (intent) u.game.setIntent(typeof intent === 'function' ? intent(u.t) : intent);
      u.game.update(u.t);
    }
  };
  u.cmds = () => u.sent.filter((m) => m.t === 'in').flatMap((m) => m.c);
  u.game.update(0);
  return u;
}

test('View: the golden snapshot maps to the fields of Appendix A.2', () => {
  const game = new ClientGame({ me: 0, send() {}, now: () => 1000 });
  game.reset(fixture('round'));
  game.onSnapshot(fixture('snap'), 1000);
  const v = game.getView(1000);
  assert.deepEqual([v.w, v.h, v.grid, v.state, v.countdown, v.timeLeft, v.suddenDeath, v.me, v.theme, v.mode], [15, 13, fixture('round').grid, 1, 0, 6417, false, 0, 'meadow', 'ffa']);
  assert.deepEqual(v.players.map((p) => ({ ...p })), [
    { id: 0, x: 1.5, y: 3.213, facing: 2, moving: true, alive: true, shield: 0, spawnShield: 0, curse: 'slow', curseTicks: 312, deadT: 0, isMe: true, color: 0, team: 0, name: 'Mom', isBot: false, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false },
    { id: 2, x: 13.5, y: 1.5, facing: 0, moving: false, alive: false, shield: 0, spawnShield: 0, curse: null, curseTicks: 0, deadT: 40, isMe: false, color: 2, team: 0, name: 'Dad', isBot: false, bombsMax: 2, range: 3, speedLv: 1, kick: true, glove: false },
  ]);
  assert.strictEqual(v.local, v.players[0]);
  assert.deepEqual(v.bombs.map((b) => ({ ...b })), [{ id: 7, owner: 0, x: 1.5, y: 1.5, tx: 1, ty: 1, fuse: 121, range: 2, dir: 0, fly: null, pass: [0] }]);
  assert.deepEqual(v.flames.map((f) => ({ ...f })), [{ x: 3.5, y: 1.5, mask: 4, ticksLeft: 30 }]);
  assert.deepEqual(v.items.map((i) => ({ ...i })), [{ id: 4, x: 5.5, y: 3.5, kind: 'flame', born: 171 }]);
  assert.deepEqual([v.falling, v.ghostBombs], [[], []]);
  assert.deepEqual(game.takeEvents(), [['bomb', 7, 0, 1, 1]]);
});

test('View: the same object every frame, refilled in place, arrays exactly as long as their content', () => {
  const u = unit();
  u.snap(0, { b: [brow(1, 0, 5, 5), brow(2, 1, 6, 5)], f: [[7, 7, 15, 30]], i: [[1, 8, 8, 'bomb', 3]] }, 100);
  const v1 = u.game.getView(100);
  const [bomb0, bomb1, flame0] = [v1.bombs[0], v1.bombs[1], v1.flames[0]];
  assert.equal(v1.bombs.length, 2);
  u.snap(3, { b: [brow(1, 0, 5, 5)] }, 150);
  const v2 = u.game.getView(150);
  assert.strictEqual(v1, v2);
  assert.equal(v2.bombs.length, 1);
  assert.equal(v2.flames.length, 0);
  assert.equal(v2.items.length, 0);
  assert.strictEqual(v2.bombs[0], bomb0, 'entries are reused, not reallocated');
  u.snap(6, { b: [brow(1, 0, 5, 5), brow(2, 1, 6, 5)], f: [[7, 7, 15, 30]] }, 200);
  const v3 = u.game.getView(200);
  assert.strictEqual(v3.bombs[1], bomb1);
  assert.strictEqual(v3.flames[0], flame0);
});

test('View: before the first snapshot the arena is shown with the fighters on their spawn tiles', () => {
  const u = unit({ round: { roundTime: 0 } });
  const v = u.game.getView(0);
  assert.equal(v.grid, OPEN_GRID);
  assert.deepEqual(v.players.map((p) => [p.id, p.x, p.y, p.name, p.isMe, p.alive]), [[0, 1.5, 1.5, 'Ann', true, true], [1, 13.5, 11.5, 'Bob', false, true]]);
  assert.deepEqual([v.state, v.countdown, v.timeLeft, v.theme, v.bombs.length], [STATE.COUNTDOWN, C.COUNTDOWN_TICKS, -1, 'frost', 0]);
  assert.equal(new ClientGame({ me: 0, send() {}, now: () => 0 }).getView(0).players.length, 0, 'and before `round` there is simply an empty View');
  assert.deepEqual(Object.keys(createView()).sort(), Object.keys(v).sort());
});

/** A remote fighter walking right at 3.6 tiles/s (0.06 a tick), snapshots every 3 ticks arriving `latency` ms after they were made. */
function feedWalker(u, { from = 0, to = 30, latency = 100, arrival = null } = {}) {
  for (let k = from; k <= to; k += 3) {
    u.snap(k, { p: [prow(0, 1.5, 1.5), prow(1, 3 + 0.06 * k, 5.5, { fl: 3, f: 1 })] }, arrival ? arrival(k) : latency + k / 0.06);
  }
}

test('interpolation: other fighters are drawn on the render clock, 6 ticks behind the arrival-corrected server tick', () => {
  const u = unit();
  feedWalker(u);                                             // snapshot k arrives at 100 + k/0.06 ms, so off = -6 and rt = now*0.06 - 12
  for (const now of [600, 616.6667, 633.3333, 650]) {
    const v = u.game.getView(now);
    const rt = u.game.renderTick;
    assert.ok(Math.abs(rt - (now * 0.06 - 12)) < 1e-9, `rt ${rt}`);
    const walker = v.players[1];
    assert.ok(Math.abs(walker.x - (3 + 0.06 * rt)) < 1e-9, `x ${walker.x} at rt ${rt}`);
    assert.equal(walker.y, 5.5);
    assert.deepEqual([walker.moving, walker.facing], [true, 1]);
  }
});

test('interpolation: bombs, flames, items and timers are the newest snapshot; only bombs in motion are interpolated', () => {
  const u = unit();
  u.snap(0, { p: [prow(0, 1.5, 1.5), prow(1, 3, 5.5)], b: [brow(1, 0, 5, 5, { x: 4.8, y: 5.5, d: 2 }), brow(2, 1, 9, 9)] }, 100);
  u.snap(6, { p: [prow(0, 1.5, 1.5), prow(1, 3.36, 5.5)], b: [brow(1, 0, 6, 5, { x: 5.2, y: 5.5, d: 2, fu: 90 }), brow(2, 1, 9, 9, { fu: 94 }), brow(3, 1, 4, 4, { fu: 150 })], f: [[2, 2, 5, 20]] }, 200);
  const v = u.game.getView(250);                             // off = -6, so rt = 250*0.06 - 12 = 3: halfway between the two snapshots
  const t = (u.game.renderTick - 0) / 6;
  assert.ok(t > 0 && t < 1, `rt ${u.game.renderTick}`);
  assert.equal(v.bombs.length, 3, 'a bomb that only exists in the newest snapshot is there already');
  assert.ok(Math.abs(v.bombs[0].x - (4.8 + 0.4 * t)) < 1e-9, 'the sliding bomb glides');
  assert.equal(v.bombs[1].x, 9.5, 'a resting bomb is where the newest snapshot has it');
  assert.equal(v.flames.length, 1);
  assert.equal(v.bombs[0].tx, 6, 'collision data is never interpolated');
});

test('interpolation: fuse, flame age and falling tiles count down with the time since the newest snapshot; a flying bomb keeps its fuse', () => {
  const u = unit();
  u.snap(30, { b: [brow(1, 0, 5, 5, { fu: 30 }), brow(2, 0, 6, 5, { fu: 40, fl: [5.5, 5.5, 8.5, 5.5, 20, 26], x: 6.5 })], f: [[1, 1, 15, 20]], fall: [[3, 3, 30]] }, 1000);
  const at = (ms) => u.game.getView(1000 + ms);
  let v = at(0);
  assert.deepEqual([v.bombs[0].fuse, v.bombs[1].fuse, v.flames[0].ticksLeft, v.falling[0].ticksLeft], [30, 40, 20, 30]);
  v = at(100);                                               // 6 ticks later
  assert.ok(Math.abs(v.bombs[0].fuse - 24) < 1e-9 && Math.abs(v.flames[0].ticksLeft - 14) < 1e-9 && Math.abs(v.falling[0].ticksLeft - 24) < 1e-9);
  assert.equal(v.bombs[1].fuse, 40, 'paused while it flies');
  assert.deepEqual({ ...v.bombs[1].fly }, { fx: 5.5, fy: 5.5, tx: 8.5, ty: 5.5, left: 20, total: 26 });
  v = at(5000);
  assert.deepEqual([v.bombs[0].fuse, v.flames[0].ticksLeft, v.falling[0].ticksLeft], [0, 0, 0], 'never below zero');
  assert.equal(at(-50).bombs[0].fuse, 30, 'nor above the snapshot value');
});

test('interpolation: a fighter that is dead in the newest snapshot is drawn where it died, not slid there', () => {
  const u = unit();
  u.snap(0, { p: [prow(0, 1.5, 1.5), prow(1, 5, 5)] }, 100);
  u.snap(6, { p: [prow(0, 1.5, 1.5), prow(1, 5.4, 5.2, { fl: 0, dt: 0 })] }, 200);
  const walker = u.game.getView(150).players[1];
  assert.deepEqual([walker.x, walker.y, walker.alive], [5.4, 5.2, false]);
});

test('interpolation: a jump of more than 3 tiles between snapshots is a teleport, not a dash', () => {
  const u = unit();
  u.snap(0, { p: [prow(0, 1.5, 1.5), prow(1, 3, 5)] }, 100);
  u.snap(6, { p: [prow(0, 1.5, 1.5), prow(1, 9, 5)] }, 200);
  const first = u.game.getView(160).players[1].x;
  assert.equal(first, 9);
});

test('render clock: adopts a late arrival at once and recovers from early ones by 5 % of the gap', () => {
  const u = unit();
  u.snap(0, {}, 1000);
  const off0 = u.game.off;
  assert.ok(Math.abs(off0 - (0 - 1000 * 0.06)) < 1e-12);
  u.snap(3, {}, 1050 + 40);                                  // 40 ms late
  assert.ok(Math.abs(u.game.off - (3 - 1090 * 0.06)) < 1e-12, 'a late one is taken over whole');
  const late = u.game.off;
  u.snap(6, {}, 1100);                                       // punctual: sample is 2.4 ticks above the late offset
  assert.ok(Math.abs(u.game.off - (late + 0.05 * ((6 - 1100 * 0.06) - late))) < 1e-12);
  u.snap(6, {}, 1200);
  u.snap(5, {}, 1200);
  assert.equal(u.game.lastK, 6, 'older or repeated snapshots change nothing');
});

for (const jitter of [0, 20, 40, 80]) {
  test(`render clock: 0 backward steps at +-${jitter} ms arrival jitter, and a walker never moves backwards on screen`, () => {
    const u = unit();
    const rng = makeRng(100 + jitter);
    let lastArrival = 0;
    const snaps = [];
    for (let k = 0; k <= 1800; k += 3) {
      const arrival = Math.max(lastArrival + 0.01, 100 + k / 0.06 + (rng.next() * 2 - 1) * jitter);      // in-order delivery, like a WebSocket
      lastArrival = arrival;
      snaps.push({ k, arrival });
    }
    let next = 0;
    let prevRt = -Infinity;
    let prevX = -Infinity;
    let backwards = 0;
    let worstLag = 0;
    for (let now = 0; now < 29500; now += TICK_MS) {
      while (next < snaps.length && snaps[next].arrival <= now) {
        const { k, arrival } = snaps[next++];
        u.snap(k, { p: [prow(0, 1.5, 1.5), prow(1, 2 + 0.006 * k, 5.5, { fl: 3 })] }, arrival);
      }
      if (next === 0) continue;
      const walker = u.game.getView(now).players[1];
      const rt = u.game.renderTick;
      if (rt < prevRt || walker.x < prevX - 1e-9) backwards++;
      prevRt = rt;
      prevX = walker.x;
      if (now > 2000) worstLag = Math.max(worstLag, now * 0.06 - rt);
    }
    assert.equal(backwards, 0);
    // 6 ticks of delay + the network's one-way time + the worst lateness (in ticks) - never a growing queue.
    assert.ok(worstLag < 6 + 6 + (2 * jitter) * 0.06 + 4, `worst lag ${worstLag} ticks`);
  });
}

test('render clock: holds still once it runs 2 ticks past the newest snapshot, and never reads before the oldest', () => {
  const u = unit();
  feedWalker(u, { to: 30 });
  u.game.getView(600);
  assert.ok(u.game.getView(5000).players[1].x <= 3 + 0.06 * 32 + 1e-9);
  assert.equal(u.game.renderTick, 32);
  const fresh = unit();
  fresh.snap(50, { p: [prow(0, 1.5, 1.5), prow(1, 4, 5.5)] }, 10);
  fresh.game.getView(10);
  assert.equal(fresh.game.renderTick, 50, 'a single snapshot is drawn as it is');
});

test('reset: a new round starts the render clock and the snapshot numbering over, and keeps cmd numbering', () => {
  const u = unit();
  u.step(500, { d: 2 });                                    // (no snapshot yet: nothing is sent)
  u.snap(0, {}, u.t);
  u.step(500, { d: 2 });
  const seq = u.game.seq;
  assert.ok(seq > 0);
  u.snap(30, {}, u.t);
  u.game.reset(roundMsg({ n: 2 }));
  assert.deepEqual([u.game.lastK, u.game.renderTick, u.game.off, u.game.seq], [-1, null, null, seq]);
  u.snap(0, { st: 0, cd: 180 }, u.t);
  assert.equal(u.game.lastK, 0, 'k = 0 of the new round is not an old snapshot');
  assert.equal(u.game.getView(u.t).state, STATE.COUNTDOWN);
});

// ---- Events ------------------------------------------------------------------------------------------

test('events: delivered the moment their snapshot arrives, in order, as copies of the wire arrays', () => {
  const u = unit();
  const e = [['boom', 3, 0, 5, 5, 2, [[5, 5], [6, 5]]], ['block', 6, 5, 0], ['itemspawn', 9, 6, 5, 'flame'], ['death', 1, 0, 5.1, 5.2]];
  const snap = mkSnap(300, { e });
  u.game.onSnapshot(snap, 5000);                             // the render clock is nowhere near tick 300 yet: events do not wait for it
  const events = u.game.takeEvents();
  assert.deepEqual(events, e);
  events.forEach((ev, i) => assert.notStrictEqual(ev, snap.e[i], 'a copy, so a consumer cannot corrupt the buffered snapshot'));
  events[0].length = 0;
  assert.equal(snap.e[0].length, 7);
  assert.equal(u.game.takeEvents().length, 0);
  assert.ok(Object.isFrozen(u.game.takeEvents()), 'an idle frame gets a shared empty array');
});

test('events: a snapshot that is not new (same k, replayed after a sync) delivers nothing twice', () => {
  const u = unit();
  u.snap(30, { e: [['go']] }, 100);
  u.snap(30, { e: [['go']] }, 110);
  u.snap(27, { e: [['block', 1, 1, 0]] }, 120);
  assert.deepEqual(u.game.takeEvents(), [['go']]);
});

test('events: after a long gap only the events that still matter are kept', () => {
  const u = unit();
  u.snap(0, {}, 1000);
  u.snap(3, { e: [['boom', 1, 0, 1, 1, 2, []], ['death', 1, 0, 1, 1], ['land', 1, 1, 1]] }, 1500);
  assert.deepEqual(u.game.takeEvents().map((e) => e[0]), ['boom', 'death', 'land'], 'exactly 500 ms late is still on time');
  u.snap(6, { e: [['boom', 1, 0, 1, 1, 2, []], ['block', 1, 1, 0], ['bomb', 5, 1, 1, 1], ['pickup', 1, 1, 'flame', 1, 1], ['go'], ['death', 1, 0, 1, 1], ['left', 1], ['curse', 1, 'slow', -1], ['sdstart'], ['sdland', 1, 1], ['showdown'], ['shieldhit', 1, 1, 1]] }, 2001);
  assert.deepEqual(u.game.takeEvents().map((e) => e[0]), ['go', 'death', 'left', 'curse', 'sdstart', 'sdland', 'showdown']);
});

test('events: a hidden tab keeps the state but not a minute of explosions', () => {
  const u = unit();
  u.snap(0, {}, 100);
  u.snap(3, { e: [['block', 1, 1, 0]] }, 150);
  u.game.pauseSending();
  u.snap(6, { e: [['boom', 1, 0, 1, 1, 2, []]], b: [brow(1, 0, 5, 5)] }, 200);
  assert.equal(u.game.takeEvents().length, 0, 'the undelivered one is dropped too');
  assert.equal(u.game.getView(200).bombs.length, 1, 'state still follows');
  u.game.resume(300);
  u.snap(9, { e: [['boom', 2, 0, 1, 1, 2, []]] }, 400);
  assert.deepEqual(u.game.takeEvents().map((e) => e[0]), ['boom']);
});

test('events: at most 200 are handed out, the newest ones', () => {
  const u = unit();
  const e = Array.from({ length: 250 }, (_, i) => ['land', i, 1, 1]);
  u.snap(3, { e }, 100);
  const got = u.game.takeEvents();
  assert.equal(got.length, 200);
  assert.deepEqual([got[0][1], got[199][1]], [50, 249]);
});

test('events: undelivered ones survive a `round`, and a malformed list does no harm', () => {
  const u = unit();
  u.snap(3, { e: [['death', 1, 0, 2, 2]] }, 100);
  u.game.reset(roundMsg({ n: 2 }));
  u.game.onSnapshot({ ...mkSnap(0), e: 'nope' }, 200);
  u.game.onSnapshot({ ...mkSnap(3), e: [null, 7, ['go']] }, 250);
  assert.deepEqual(u.game.takeEvents(), [['death', 1, 0, 2, 2], ['go']]);
});

// ---- The grid: g / gv / sync ---------------------------------------------------------------------

test('grid: `g` replaces the grid; a version we hold no grid for asks the server once a second', () => {
  const u = unit();
  const changed = OPEN_GRID.slice(0, 20) + '#' + OPEN_GRID.slice(21);
  u.snap(0, { gv: 0 }, 1000);
  assert.equal(u.sent.length, 0, 'a fresh arena is version 0: nothing to fetch');
  u.snap(3, { gv: 1 }, 1050);
  u.snap(6, { gv: 1 }, 1100);
  u.snap(9, { gv: 1 }, 1900);
  assert.deepEqual(u.sent.filter((m) => m.t === 'sync').length, 1, 'rate limited to one per second');
  u.snap(12, { gv: 1 }, 2050);
  assert.equal(u.sent.filter((m) => m.t === 'sync').length, 2);
  assert.equal(u.game.getView(2050).grid, OPEN_GRID, 'until the grid arrives the old one stays');
  u.snap(15, { gv: 1, g: changed }, 2100);
  assert.equal(u.game.getView(2100).grid, changed);
  u.snap(18, { gv: 1 }, 2200);
  assert.equal(u.sent.filter((m) => m.t === 'sync').length, 2, 'in step again');
});

test('grid: the reply to a sync may carry a tick we already have; its grid is still taken', () => {
  const u = unit();
  const changed = OPEN_GRID.slice(0, 20) + '+' + OPEN_GRID.slice(21);
  u.snap(30, { gv: 2 }, 1000);
  u.snap(30, { gv: 2, g: changed, e: [] }, 1010);
  assert.equal(u.game.getView(1010).grid, changed);
  u.snap(27, { gv: 1, g: OPEN_GRID }, 1020);
  assert.equal(u.game.getView(1020).grid, changed, 'but a grid older than what we hold is not');
});

test('grid: a live round (joiner, reconnect) does not assume version 0', () => {
  const u = unit({ round: { serverTick: 500 } });
  u.snap(501, { gv: 0 }, 100);
  assert.equal(u.sent.filter((m) => m.t === 'sync').length, 1);
});

// ---- The fixed-step loop -------------------------------------------------------------------------

test('loop: one cmd per 1/60 s at any frame rate, one message per frame that ran a tick', () => {
  for (const [fps, expectMsgs] of [[60, 60], [30, 30], [144, 60], [240, 60]]) {
    const u = unit({ frame: 1000 / fps });
    u.snap(0, {}, 0);
    u.step(1000, { d: 0 });
    const rows = u.cmds();
    const msgs = u.sent.filter((m) => m.t === 'in');
    assert.ok(Math.abs(rows.length - 60) <= 1, `${fps} fps: ${rows.length} cmds`);
    assert.ok(msgs.length <= 61 && Math.abs(msgs.length - expectMsgs) <= 2, `${fps} fps: ${msgs.length} messages`);
    assert.deepEqual(rows.map((r) => r[0]), rows.map((_, i) => i + 1), 'consecutive numbers');
    for (const m of msgs) assert.ok(m.c.length >= 1 && m.c.length <= 6);
    for (const m of u.sent) assert.ok(parseClientMessage(m).ok, 'every frame passes the server\'s parser');
  }
});

test('loop: a slow frame runs at most 6 ticks and drops the rest; a stall drops everything', () => {
  const u = unit({ frame: 100 });
  u.snap(0, {}, 0);
  u.step(100, { d: 2 });
  assert.equal(u.cmds().length, 6, '100 ms is 6 ticks');
  u.step(100, { d: 2 });
  assert.equal(u.cmds().length, 12);
  const u2 = unit({ frame: 200 });
  u2.snap(0, {}, 0);
  u2.step(200, { d: 2 });
  assert.equal(u2.cmds().length, 6, 'capped at 6, the 6 ticks of excess are dropped instead of carried');
  u2.step(200, { d: 2 });
  assert.equal(u2.cmds().length, 12);

  const u3 = unit();
  u3.snap(0, {}, 0);
  u3.step(500, { d: 2 });
  const before = u3.cmds().length;
  u3.t += 3000;                                              // the page froze for 3 s
  u3.game.update(u3.t);
  assert.equal(u3.cmds().length, before, 'no catch-up burst');
  u3.step(100, { d: 2 });
  assert.ok(u3.cmds().length >= before + 5);
});

test('loop: after a stall the unacknowledged cmds are forgotten, not replayed on top of a server that moved on', () => {
  const u = unit();
  u.snap(0, {}, 0);
  u.step(500, { d: 2 });                                     // ~30 cmds sent, none acknowledged
  u.t += 1000;
  u.game.update(u.t);                                        // stall
  u.snap(9, { p: [prow(0, 4, 1.5), prow(1, 13.5, 11.5)], ack: { 0: 5 } }, u.t);
  u.step(800, { d: 0 });                                     // (the visual offset of the correction glides away meanwhile)
  assert.ok(Math.abs(u.game.getView(u.t).local.x - 4) < 0.02, `the fighter is where the server says, not 30 cmds further (${u.game.getView(u.t).local.x})`);
});

test('loop: taps latch until a tick consumes them: one tap, exactly one b:1 cmd', () => {
  const u = unit();
  u.snap(0, {}, 0);
  u.game.setIntent({ d: 2, bomb: true });
  u.game.setIntent({ d: 3 });                                // d is overwritten, the tap stays latched
  u.game.setIntent({ d: 4, bomb: true, special: true });     // a second tap before any tick still counts once
  u.step(TICK_MS * 4, { d: 4 });
  const rows = u.cmds();
  assert.deepEqual(rows.map((r) => [r[1], r[2], r[3]]), [[4, 1, 1], [4, 0, 0], [4, 0, 0], [4, 0, 0]]);
  u.game.setIntent({ d: 9 });
  u.game.setIntent({ d: -1 });
  u.step(TICK_MS, {});
  assert.equal(u.cmds().pop()[1], 0, 'nonsense directions mean standing still');
});

test('loop: taps made when no cmd can be built are not saved up for later', () => {
  const u = unit();
  u.snap(0, { st: 0, cd: 170 }, 0);                          // countdown, far from GO: not sending yet
  u.game.setIntent({ bomb: true });
  u.step(TICK_MS * 3, {});
  assert.equal(u.cmds().length, 0);
  u.snap(3, { st: 1, cd: 0 }, u.t);
  u.step(TICK_MS * 3, {});
  assert.deepEqual(u.cmds().map((r) => r[2]), [0, 0, 0], 'the old tap did not fire');
});

test('loop: only the newest 180 unacknowledged cmds are replayed', () => {
  const u = unit();
  u.snap(0, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)] }, 0);
  u.step(TICK_MS * 200, { d: 2 });                           // 200 ticks = 12 tiles, but the row ends at 13.66
  u.snap(3, { p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)] }, u.t);
  u.step(800, { d: 0 });                                     // let the correction's visual offset glide away
  const x = u.game.getView(u.t).local.x;
  assert.ok(Math.abs(x - (1.5 + 0.06 * 180)) < 0.02, `replayed 180 steps: ${x}`);
});

test('loop: nothing is built for spectators, the dead, or once the round is over', () => {
  const spectator = unit({ me: 7 });
  spectator.snap(0, {}, 0);
  spectator.step(500, { d: 2, bomb: true });
  assert.equal(spectator.sent.length, 0);
  assert.equal(spectator.game.getView(500).local, null);
  assert.equal(spectator.game.getView(500).players.length, 2, 'but they see the game');

  const dead = unit();
  dead.snap(0, { p: [prow(0, 1.5, 1.5, { fl: 0, dt: 5 }), prow(1, 13.5, 11.5)] }, 0);
  dead.step(500, { d: 2, bomb: true });
  assert.equal(dead.sent.length, 0);

  const over = unit();
  over.snap(0, { st: 3 }, 0);
  over.step(500, { d: 2 });
  assert.equal(over.sent.length, 0);
  const bot = unit({ me: 1 });                               // bots have no ack, so an id that is no human fighter never sends
  bot.snap(0, { ack: { 0: 0 } }, 0);
  bot.step(300, { d: 2 });
  assert.equal(bot.sent.length, 0);
});

test('loop: the countdown window - cmds a few ticks before GO, prediction from the estimated GO', () => {
  const u = unit();                                          // rtt 0: lead = 2 ticks
  u.snap(0, { st: 0, cd: 60, ack: { 0: 0 } }, 0);            // GO is estimated at t = 1000 ms
  u.step(950, { d: 2 });
  assert.equal(u.cmds().length, 0, 'nothing before estCd <= lead');
  u.step(30, { d: 2 });                                      // t = 980: 1.2 ticks to GO
  const early = u.cmds().length;
  assert.ok(early >= 1 && early <= 3, `${early} cmds in the last 2 ticks`);
  assert.equal(u.game.getView(u.t).local.x, 1.5, 'but the fighter has not moved: the predictor waits for GO');
  u.step(40, { d: 2 });
  u.step(200, { d: 2 });
  assert.ok(u.game.getView(u.t).local.x > 1.6, 'after GO the predicted fighter walks');
  const rows = u.cmds();
  assert.deepEqual(rows.map((r) => r[0]), rows.map((_, i) => i + 1));
});

test('loop: the lead grows with the round trip, up to the 12 ticks the server holds', () => {
  const u = unit();
  u.game.rtt = 400;
  u.snap(0, { st: 0, cd: 60, ack: { 0: 0 } }, 0);
  u.step(760, {});
  assert.equal(u.cmds().length, 0);
  u.step(240, {});
  assert.ok(u.cmds().length >= 10 && u.cmds().length <= 13, `${u.cmds().length} cmds (12 ticks of lead)`);
});

// ---- Session hooks ---------------------------------------------------------------------------------

test('session: setSeq continues numbering, drops pending cmds and lifts a hold; reset never touches the number', () => {
  const u = unit();
  u.snap(0, {}, 0);
  u.step(TICK_MS * 5, {});
  assert.equal(u.game.seq, 5);
  u.game.pauseSending();
  u.step(TICK_MS * 10, {});
  assert.equal(u.game.seq, 5, 'held: nothing is built, and update() does not lift the hold');
  u.game.reset(roundMsg({ n: 2 }));
  assert.equal(u.game.seq, 5);
  u.game.setSeq(40);
  u.snap(0, { ack: { 0: 40 } }, u.t);
  u.step(TICK_MS * 5, {});
  assert.deepEqual(u.cmds().map((r) => r[0]).filter((n) => n > 5).slice(0, 3), [41, 42, 43], 'the very next cmd is 41');
  u.game.setSeq(-3);
  assert.equal(u.game.seq, 0, 'garbage means a fresh entry');
});

test('session: a server ack ahead of our count moves the count (never number below the server\'s high-water mark)', () => {
  const u = unit();
  u.snap(0, { ack: { 0: 0 } }, 0);
  u.step(TICK_MS * 3, {});
  u.snap(3, { ack: { 0: 500 } }, u.t);
  u.step(TICK_MS * 4, {});
  assert.deepEqual(u.cmds().map((r) => r[0]).filter((n) => n > 5).slice(0, 3), [501, 502, 503]);
});

test('session: resume drops the time backlog and the stale clock offset, keeping the newest two snapshots', () => {
  const u = unit();
  feedWalker(u, { to: 30 });
  u.game.getView(600);
  const rt = u.game.renderTick;
  u.game.pauseSending();
  u.game.resume(60000);
  assert.equal(u.game.off, null);
  const v = u.game.getView(60000);
  assert.ok(u.game.renderTick >= rt, 'the render clock never goes back');
  assert.equal(v.players.length, 2);
  feedWalker(u, { from: 300, to: 306, arrival: (k) => 60000 + (k - 300) / 0.06 });
  assert.ok(u.game.off !== null);
});

test('session: setMe re-targets the predictor (a fresh id after a token expired)', () => {
  const u = unit({ me: 7 });
  u.snap(0, { ack: { 0: 0, 1: 0 } }, 0);
  u.step(200, { d: 2 });
  assert.equal(u.sent.length, 0);
  u.game.setMe(0);
  u.snap(3, {}, u.t);
  u.step(200, { d: 2 });
  assert.ok(u.cmds().length > 5);
  assert.equal(u.game.getView(u.t).local.id, 0);
});

test('rtt: smoothed from pongs on the same clock, garbage ignored', () => {
  const u = unit();
  u.t = 1000;
  u.game.onPong(900);
  assert.equal(u.game.rtt, 100);
  u.t = 2000;
  u.game.onPong(1800);
  assert.ok(Math.abs(u.game.rtt - 120) < 1e-9);
  u.game.onPong(3000);
  u.game.onPong(-1e9);
  u.game.onPong(NaN);
  assert.ok(Math.abs(u.game.rtt - 120) < 1e-9);
});

// ---- Ghost bombs and the replay ----------------------------------------------------------------------

/** A game that has processed a snapshot and a few ticks, so the predictor is running. */
function running(over = {}, snapOver = {}) {
  const u = unit(over);
  u.snap(0, snapOver, 0);
  u.step(TICK_MS * 3, {});
  return u;
}

test('ghosts: a tap draws a ghost and one local sound at once; the acknowledging snapshot swaps it for the server bomb silently', () => {
  const u = running();
  u.game.takeEvents();
  u.game.setIntent({ bomb: true });
  u.step(TICK_MS, {});
  const s = u.game.seq;
  const v = u.game.getView(u.t);
  assert.deepEqual(v.ghostBombs.map((g) => ({ ...g })), [{ x: 1.5, y: 1.5 }]);
  assert.deepEqual(u.game.takeEvents(), [['bomb', -1, 0, 1, 1]]);
  assert.equal(u.cmds().filter((r) => r[2] === 1).length, 1);

  u.step(TICK_MS * 2, {});
  u.snap(3, { ack: { 0: s - 1 } }, u.t);                     // the server has not reached our cmd yet
  assert.equal(u.game.getView(u.t).ghostBombs.length, 1, 'the ghost stays until the cmd is acknowledged');

  u.step(TICK_MS * 2, {});
  u.snap(6, { ack: { 0: s }, b: [brow(1, 0, 1, 1, { ps: [0] })], e: [['bomb', 1, 0, 1, 1], ['bomb', 2, 1, 5, 5], ['bomb', 3, 0, 9, 9]] }, u.t);
  const after = u.game.getView(u.t);
  assert.equal(after.ghostBombs.length, 0);
  assert.equal(after.bombs.length, 1);
  assert.deepEqual(u.game.takeEvents(), [['bomb', 2, 1, 5, 5], ['bomb', 3, 0, 9, 9]], 'only the event that our ghost already sounded is dropped');
});

test('ghosts: the sound dedupe forgets a ghost after 30 ticks, and one ghost silences one event', () => {
  const u = running();
  u.game.setIntent({ bomb: true });
  u.step(TICK_MS, {});
  const s = u.game.seq;
  u.game.takeEvents();
  u.snap(3, { ack: { 0: s } }, 400);                         // rejected: no bomb came back
  u.snap(4, { ack: { 0: s } }, 650);
  u.snap(5, { ack: { 0: s }, e: [['bomb', 5, 0, 1, 1]] }, 880);
  assert.equal(u.game.takeEvents().length, 0, 'within 30 ticks of the ghost going away it is the same bomb');
  u.snap(6, { ack: { 0: s } }, 1100);
  u.snap(7, { ack: { 0: s }, e: [['bomb', 6, 0, 1, 1]] }, 1200);
  assert.equal(u.game.takeEvents().length, 1, 'a bomb more than 30 ticks later on that tile is a different bomb');
  const v = running();
  v.game.setIntent({ bomb: true });
  v.step(TICK_MS, {});
  v.game.takeEvents();
  v.snap(3, { ack: { 0: v.game.seq }, b: [brow(1, 0, 1, 1)], e: [['bomb', 1, 0, 1, 1], ['bomb', 2, 0, 1, 1]] }, v.t);
  assert.equal(v.game.takeEvents().length, 1);
});

test('ghosts: not created when the server would refuse - curse, capacity, occupied tile, dead, wrong phase', () => {
  const noBomb = running({}, { p: [prow(0, 1.5, 1.5, { cu: 'nobomb', ct: 300 }), prow(1, 13.5, 11.5)] });
  noBomb.game.setIntent({ bomb: true });
  noBomb.step(TICK_MS * 2, {});
  assert.equal(noBomb.game.getView(noBomb.t).ghostBombs.length, 0);
  assert.equal(noBomb.game.takeEvents().length, 0, 'and no sound either');

  const full = running();                                    // bombsMax 1: one ghost, then no more even on another tile
  full.game.setIntent({ bomb: true });
  full.step(TICK_MS, { d: 2 });
  full.step(TICK_MS * 30, { d: 2 });
  full.game.setIntent({ bomb: true });
  full.step(TICK_MS, {});
  assert.equal(full.game.getView(full.t).ghostBombs.length, 1);

  const two = running({}, { p: [prow(0, 1.5, 1.5, { bm: 2 }), prow(1, 13.5, 11.5)] });
  two.game.setIntent({ bomb: true });
  two.step(TICK_MS, { d: 2 });
  two.step(TICK_MS * 30, { d: 2 });
  two.game.setIntent({ bomb: true });
  two.step(TICK_MS, {});
  assert.equal(two.game.getView(two.t).ghostBombs.length, 2);
  two.game.setIntent({ bomb: true });
  two.step(TICK_MS, {});
  assert.equal(two.game.getView(two.t).ghostBombs.length, 2, 'the same tile twice is one bomb');

  const owned = running({}, { b: [brow(4, 0, 9, 9)], p: [prow(0, 1.5, 1.5), prow(1, 13.5, 11.5)] });   // a server bomb of mine already counts
  owned.game.setIntent({ bomb: true });
  owned.step(TICK_MS, {});
  assert.equal(owned.game.getView(owned.t).ghostBombs.length, 0);

  const occupied = running({}, { b: [brow(4, 1, 1, 1)] });
  occupied.game.setIntent({ bomb: true });
  occupied.step(TICK_MS, {});
  assert.equal(occupied.game.getView(occupied.t).ghostBombs.length, 0, 'somebody else\'s bomb is already on my tile');

  const countdown = unit();
  countdown.snap(0, { st: 0, cd: 100 }, 0);
  countdown.game.setIntent({ bomb: true });
  countdown.step(TICK_MS * 4, {});
  assert.equal(countdown.game.getView(countdown.t).ghostBombs.length, 0);
});

test('ghosts: gone on death, when the round is over, and on a new round', () => {
  for (const [name, then] of [
    ['death', (u) => u.snap(9, { p: [prow(0, 1.5, 1.5, { fl: 0, dt: 1 }), prow(1, 13.5, 11.5)] }, u.t)],
    ['over', (u) => u.snap(9, { st: 3 }, u.t)],
    ['reset', (u) => u.game.reset(roundMsg({ n: 2 }))],
  ]) {
    const u = running();
    u.game.setIntent({ bomb: true });
    u.step(TICK_MS, {});
    assert.equal(u.game.getView(u.t).ghostBombs.length, 1, name);
    then(u);
    assert.equal(u.game.getView(u.t).ghostBombs.length, 0, name);
  }
});

test('replay: a server bomb in the way stops the replayed walk (prediction in front of an obstacle it learned about late)', () => {
  const u = running();
  u.step(TICK_MS * 47, { d: 2 });                            // ~3 tiles right, along row 1
  u.snap(3, { b: [brow(2, 1, 4, 1)] }, u.t);                 // a bomb on tile (4,1) the client did not know about
  u.step(800, { d: 0 });                                     // let the correction glide away
  const x = u.game.getView(u.t).local.x;
  assert.ok(Math.abs(x - (4 - C.PLAYER_HALF)) < 0.011, `stopped flush against the bomb: ${x}`);
});

test('replay: after stepping off my own bomb the replay treats it as solid again (the `left` map), and only then', () => {
  const build = (pass) => {
    const u = running();
    u.step(TICK_MS * 16, { d: 2 });                          // 0.96 tile right: the hitbox has left tile 1
    u.step(TICK_MS * 5, { d: 4 });                           // and back towards the bomb
    u.snap(3, { b: [brow(1, 0, 1, 1, { ps: pass })] }, u.t);   // the (round-trip-old) snapshot still lists me as allowed through
    u.step(800, { d: 0 });
    return u.game.getView(u.t).local.x;
  };
  assert.ok(Math.abs(build([0]) - (2 + C.PLAYER_HALF)) < 0.011, 'blocked at the bomb\'s edge');
  const pastIt = running();
  pastIt.step(TICK_MS * 2, { d: 2 });                        // still standing on the bomb: free to move about
  pastIt.snap(3, { b: [brow(1, 0, 1, 1, { ps: [0] })] }, pastIt.t);
  pastIt.step(TICK_MS * 3, { d: 4 });
  assert.ok(pastIt.game.getView(pastIt.t).local.x < 1.5 + 0.2, 'while I overlap it, the bomb does not block');
});

test('replay: a snapshot that agrees with the prediction changes nothing on screen (no jitter at 20 Hz)', () => {
  const u = running();
  const positions = [];
  for (let i = 0; i < 90; i++) {
    u.step(TICK_MS, { d: 2 });
    if (i >= 12 && i % 3 === 0) {
      const ackSeq = u.game.seq - 6;                         // the server is 6 cmds behind; the first 3 cmds (standing still) were seq 1-3
      const x = Math.round((1.5 + 0.06 * (ackSeq - 3)) * 1000) / 1000;
      u.snap(3 + i, { p: [prow(0, x, 1.5, { fl: 3 }), prow(1, 13.5, 11.5)], ack: { 0: ackSeq } }, u.t);
    }
    if (i >= 13) positions.push(u.game.getView(u.t).local.x);
  }
  assert.ok(positions.length > 70);
  for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - 0.06) < 0.002, `frame ${i}: step ${positions[i] - positions[i - 1]}`);
});

// ---- HUD model -----------------------------------------------------------------------------------------

test('hudModel: fills the object of SPEC 8.6 from the View, the round and the lobby, reusing it', () => {
  const u = running({}, { r: 3601, p: [prow(0, 1.5, 1.5, { bm: 3, rg: 4, sp: 2, sh: 100, ss: 30, cu: 'slow', ct: 100, fl: 2 | 4 | 8 }), prow(1, 13.5, 11.5, { fl: 0, dt: 4 })] });
  const lobby = [{ id: 0, wins: 2, connected: true, waiting: false }, { id: 1, wins: 1, connected: false, waiting: true }];
  const hud = u.game.hudModel(u.game.getView(u.t), lobby);
  assert.deepEqual(hud, {
    roundNo: 1, winsNeeded: 3, timeLeftSec: 61, suddenDeath: false, state: 'playing', mode: 'ffa',
    players: [
      { id: 0, name: 'Ann', color: 0, team: 0, alive: true, wins: 2, bombsMax: 3, range: 4, speedLv: 2, kick: true, glove: true, shield: 100, curse: 'slow', isBot: false, isMe: true, connected: true, waiting: false },
      { id: 1, name: 'Bob', color: 1, team: 1, alive: false, wins: 1, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0, curse: null, isBot: true, isMe: false, connected: false, waiting: true },
    ],
  });
  u.snap(30, { st: 2, r: -1, sd: 1 }, u.t);
  const again = u.game.hudModel(u.game.getView(u.t), []);
  assert.strictEqual(again, hud);
  assert.deepEqual([again.state, again.timeLeftSec, again.suddenDeath, again.players[0].wins, again.players[0].connected], ['ending', null, true, 0, true]);
});

// ---- The fake link itself -----------------------------------------------------------------------------

test('fake-link: latency and jitter bound the delivery time, in order by default; reorder and loss are opt-in and reproducible', () => {
  const run = (opts, n = 200) => {
    const clock = new FakeClock();
    const got = [];
    const link = new FakeLink({ clock, deliver: (m, due) => got.push({ m, due }), ...opts });
    for (let i = 0; i < n; i++) { link.send({ i }); clock.advance(5); link.pump(); }
    clock.advance(1000);
    link.pump();
    return { got, link };
  };
  const plain = run({ latency: 80, jitter: 40, seed: 3 });
  assert.equal(plain.got.length, 200);
  assert.deepEqual(plain.got.map((g) => g.m.i), Array.from({ length: 200 }, (_, i) => i), 'a TCP-like link never reorders');
  for (const g of plain.got) assert.ok(g.due >= g.m.i * 5 + 40 - 1e-9 && g.due <= g.m.i * 5 + 120 + 40 + 1e-9);
  const loose = run({ latency: 80, jitter: 60, reorder: true, seed: 3 });
  assert.ok(loose.got.some((g, i) => i > 0 && g.m.i < loose.got[i - 1].m.i), 'with reorder a later packet can overtake');
  const lossy = run({ latency: 10, loss: 0.25, seed: 9 });
  assert.ok(lossy.link.stats.dropped > 25 && lossy.link.stats.dropped < 75);
  assert.equal(lossy.got.length, 200 - lossy.link.stats.dropped);
  assert.deepEqual(run({ latency: 10, loss: 0.25, seed: 9 }).got.map((g) => g.m.i), lossy.got.map((g) => g.m.i), 'same seed, same losses');
});

test('fake-link: messages are copied through JSON, outages eat what is sent during them, both directions pump together', () => {
  const clock = new FakeClock(100);
  const got = [];
  const link = new FakeLink({ clock, deliver: (m) => got.push(m), latency: 10 });
  const msg = { a: [1, 2] };
  link.send(msg);
  clock.advance(10);
  link.pump();
  assert.notStrictEqual(got[0], msg);
  assert.notStrictEqual(got[0].a, msg.a);
  link.blackout(50);
  link.send({ lost: true });
  clock.advance(60);
  link.send({ ok: true });
  clock.advance(10);
  link.pump();
  assert.deepEqual(got.slice(1), [{ ok: true }]);
  const dup = new FakeDuplex({ clock, latency: 5, toServer: (m) => got.push(['s', m]), toClient: (m) => got.push(['c', m]) });
  dup.up.send(1);
  dup.down.send(2);
  clock.advance(5);
  dup.pump();
  assert.deepEqual(got.slice(-2), [['s', 1], ['c', 2]]);
  const raw = new FakeDuplex({ clock, latency: 5, raw: true, toServer: (m) => got.push(['s', m]), toClient: (m) => got.push(['c', m]) });
  raw.up.send({ t: 'in' });
  raw.down.send('{"t":"snap","k":3}');                        // a Room hands its conn JSON text: it must not be encoded twice
  clock.advance(5);
  raw.pump();
  assert.deepEqual(got.slice(-2), [['s', '{"t":"in"}'], ['c', { t: 'snap', k: 3 }]]);
});

// ==================================================================================================
// The same client against the REAL Room (shared/room.js), through the same jittery link.
// ==================================================================================================

test('real Room: create, start, walk over an 80 ms +/- 40 ms link - predicted equals served; a token reconnect keeps the numbering', async () => {
  const { Room } = await import('../../shared/room.js');
  const clock = new FakeClock(1000);
  const room = new Room({ code: 'REAL', seed: 20240607, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const trace = new Map();

  class Seat {
    constructor(name, script) {
      this.name = name;
      this.script = script;
      this.frames = [];
      this.sent = [];
      this.game = new ClientGame({ me: -1, send: (obj) => { this.sent.push(obj); this.link.up.send(obj); }, now: clock.now });
      this.attach();
    }

    attach() {
      this.link = new FakeDuplex({
        clock, latency: 80, jitter: 40, raw: true, seed: this.name.length * 17 + (this.generation = (this.generation ?? 0) + 1),
        toServer: (text) => room.receive(this.pid, text, this.conn),
        toClient: (msg, due) => this.onMessage(msg, due),
      });
      this.conn = { send: (text) => this.link.down.send(text), close() {} };
    }

    join(token) {
      const res = room.join(this.conn, { name: this.name, token });
      assert.ok(res.ok, JSON.stringify(res));
      this.pid = res.id;
      this.token = res.token;
      return res;
    }

    onMessage(msg, due) {
      if (msg.t === 'joined') { this.game.setMe(msg.id); this.game.setSeq(msg.seq); this.joinedSeq = msg.seq; }
      else if (msg.t === 'round') this.game.reset(msg);
      else if (msg.t === 'snap') this.game.onSnapshot(msg, due);
      else if (msg.t === 'pong') this.game.onPong(msg.ts);
    }

    frame(t) {
      this.game.setIntent(this.script(t));
      this.game.update(t);
      const view = this.game.getView(t);
      const local = view.local;
      this.frames.push({ t, seq: this.game.seq, x: local?.x, y: local?.y, ok: !!local && local.alive && view.state !== STATE.COUNTDOWN });
    }
  }

  const ann = new Seat('Ann', wanderer(77, { bombs: false }));
  const bob = new Seat('Bob', () => ({}));
  ann.join();
  bob.join();
  room.receive(ann.pid, JSON.stringify({ t: 'start' }), ann.conn);
  let wrapped = false;
  let nextTick = clock.now() + TICK_MS;
  let nextFrame = clock.now() + 3;
  const run = (ms) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(TICK_MS / 4);
      const now = clock.now();
      for (const seat of [ann, bob]) seat.link.pump(now);
      while (nextTick <= now + 1e-9) {
        room.step();
        nextTick += TICK_MS;
        if (!wrapped && room.world) {                        // record where the server puts Ann after each of her cmds
          wrapped = true;
          const apply = room.world.applyCmd.bind(room.world);
          room.world.applyCmd = (id, cmd) => { apply(id, cmd); if (id === ann.pid) { const p = room.world.player(id); trace.set(cmd.s, { x: p.x, y: p.y }); } };
        }
      }
      while (nextFrame <= now + 1e-9) {
        for (const seat of [ann, bob]) seat.frame(nextFrame);
        nextFrame += TICK_MS;
      }
      for (const seat of [ann, bob]) seat.link.pump(now);
    }
  };
  const worst = (from) => Math.max(0, ...ann.frames.filter((f) => f.ok && f.t >= from && trace.has(f.seq)).map((f) => dist(f, trace.get(f.seq))));

  run(4200);                                                 // 3 s countdown and the start of play
  assert.equal(room.world.state, STATE.PLAYING);
  run(15000);
  assert.ok(ann.frames.filter((f) => f.ok && trace.has(f.seq)).length > 800, 'plenty of frames could be compared with what the Room did');
  assert.ok(worst(clock.now() - 15000) < 0.01, `served vs predicted: ${worst(clock.now() - 15000)}`);
  assert.ok(room.world.tickNo > 1000);

  // Ann's socket dies and comes back with her token (F4): joined.seq is her entry's last accepted seq.
  const entrySeq = ann.game.seq;
  room.disconnect(ann.pid, ann.conn);
  ann.game.pauseSending();
  ann.link.up.blackout(Infinity);
  ann.link.down.blackout(Infinity);
  run(2000);
  ann.attach();
  const res = ann.join(ann.token);
  assert.equal(res.resumed, true);
  const sentBefore = ann.sent.length;
  run(4000);
  assert.ok(ann.joinedSeq > 0 && ann.joinedSeq <= entrySeq, `joined.seq ${ann.joinedSeq} vs client ${entrySeq}`);
  const first = ann.sent.slice(sentBefore).find((m) => m.t === 'in');
  assert.equal(first.c[0][0], ann.joinedSeq + 1, 'her numbering continues right after the server\'s last accepted cmd');
  assert.ok(worst(clock.now() - 3000) < 0.01, 'and she is predicted exactly again');
  assert.ok(ann.game.stats.snapshots > 200);
  room.close();
});

// ==================================================================================================
// Audit additions: the round that ends without a final snapshot, and shapes the client must not choke on.
// ==================================================================================================

test('ending: the server sends no snapshot once a round is OVER, so the client stops cmds, prediction and ghosts after ENDING_TICKS', () => {
  const u = running();
  u.game.setIntent({ bomb: true });
  u.step(TICK_MS, {});
  assert.equal(u.game.getView(u.t).ghostBombs.length, 1);
  u.snap(9, { st: STATE.ENDING, ack: { 0: 0 } }, u.t);       // outcome locked: this is the last snapshot of the round for a long time
  u.step(C.ENDING_TICKS * TICK_MS - 100, { d: 2 });
  assert.ok(u.cmds().length > 100, 'cmds still flow while the round ends');
  const before = u.game.seq;
  u.step(300, { d: 2 });
  const seqAfterOver = u.game.seq;
  u.step(1500, { d: 2, bomb: true });
  assert.ok(seqAfterOver - before <= 8, 'a few more ticks at the boundary at most');
  assert.equal(u.game.seq, seqAfterOver, 'no cmds are built once the round is OVER');
  assert.equal(u.game.getView(u.t).ghostBombs.length, 0, 'and the ghost bombs are gone');
  assert.equal(u.game.pred === null || !u.game._predicting, true);
});

test('robustness: snapshots missing an array are ignored instead of poisoning getView; setIntent tolerates null', () => {
  const u = running();
  const bad = mkSnap(6);
  delete bad.fall;
  u.game.onSnapshot(bad, u.t);
  assert.equal(u.game.lastK, 0, 'the malformed snapshot did not become the newest');
  assert.doesNotThrow(() => u.game.getView(u.t));
  assert.doesNotThrow(() => u.game.setIntent(null));
  assert.doesNotThrow(() => u.game.setIntent());
});
