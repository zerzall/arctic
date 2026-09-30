// Browser side of the LIVE renderer harness (developer tooling, not part of the game).
//
// Where harness.js feeds the renderer from a World directly, this drives the real game pipeline the way main.js will: a Practice
// Room (LoopbackConnection) with autopilot bots -> the wire snapshots -> ClientGame (prediction, interpolation, ghost bombs, events)
// -> View -> Renderer. It shows the renderer what it will really be given: fractional fuse and flame timers, interpolated fighters
// seen ~100 ms in the past, snapshot-paced events and a predicted local fighter.
//
// Time is virtual by default (one call to frame() = one frame of `dtMs`), so a run is reproducible and 60 s of play take a moment;
// perf() uses requestAnimationFrame and the real clock, like the game loop.
//
//   const live = await window.live.start({ css: [1280, 720], dpr: 1, seed: 7, n: 6, theme: 'meadow' });
//   live.run(600);        // 600 frames (10 s)      live.shot() -> PNG data URL      live.info() -> what the renderer saw
import { LoopbackConnection } from '/js/net.js';
import { ClientGame } from '/js/game.js';
import { Renderer } from '/js/render.js';
import { AutoPilot } from '/__render/autopilot.js';
import { makeRng } from '/shared/rng.js';
import { STATE } from '/shared/constants.js';

const FRAME_MS = 1000 / 60;

/** A bot brain for the Room: the harness autopilot, bound to the round's World on first use. */
function autopilotFactory(opts) {
  let pilot = null;
  return {
    think(world, id) {
      if (!pilot || pilot.world !== world) pilot = new AutoPilot(world, { seed: opts.seed, reckless: opts.reckless, bombRate: opts.bombRate });
      return pilot.think(id);
    },
  };
}

/** Everything one live session needs; created by start(). */
class Live {
  constructor(o) {
    this.o = o;
    this.clock = 1000;                                    // virtual ms
    this.rng = makeRng(o.seed * 7 + 3);
    this.inbox = [];                                      // messages held back by the fake network: { due, msg }
    this.game = null;
    this.me = -1;
    this.started = false;
    this.frames = 0;
    this.rounds = 0;
    this.events = [];                                     // event codes seen (for scenes that wait for something)
    this.lastEvents = [];
    this.view = null;
    this.pilot = null;
    this.errors = [];
  }

  async open() {
    const o = this.o;
    const wrap = document.getElementById('wrap');
    wrap.style.width = `${o.css[0]}px`; wrap.style.height = `${o.css[1]}px`;
    wrap.replaceChildren();
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, { reducedEffects: o.reduced, align: o.align });
    this.renderer.setQuality(o.quality);
    this.renderer.resize(o.css[0], o.css[1], o.dpr);

    const bots = { reckless: o.reckless, bombRate: o.bombRate };
    const loadRoom = async () => {
      const { Room } = await import('/shared/room.js');
      return { Room: class extends Room { constructor(opts) { super({ ...opts, botFactory: (b) => autopilotFactory({ ...b, ...bots }) }); } } };
    };
    this.conn = new LoopbackConnection({ loadRoom, seed: o.seed });
    this.conn.onmessage = (msg) => this.receive(msg);
    await new Promise((resolve, reject) => {
      this.conn.onopen = resolve;
      this.conn.onclose = () => reject(new Error('loopback closed'));
    });
    this.conn.onclose = null;
    this.conn.send({ t: 'create', v: 1, name: 'Ana', color: 0 });
  }

  /** A message from the Room, delayed by the fake network (latency + jitter) before the game sees it. */
  receive(msg) {
    if (msg.t === 'snap' || msg.t === 'round') {
      const { latency, jitter } = this.o;
      const due = this.clock + Math.max(0, latency + (jitter ? (this.rng.next() * 2 - 1) * jitter : 0));
      const last = this.inbox.length ? this.inbox[this.inbox.length - 1].due : 0;   // TCP: in order
      this.inbox.push({ due: Math.max(due, last), msg });
    } else this.handle(msg);
  }

  handle(msg) {
    const o = this.o;
    switch (msg.t) {
      case 'joined':
        this.me = msg.id;
        this.game = new ClientGame({ me: msg.id, send: (m) => this.conn.send(m), now: () => this.clock });
        this.game.setSeq(msg.seq);
        this.conn.send({ t: 'settings', patch: { theme: o.theme, mode: o.mode, roundTime: o.roundTime, layout: o.layout, blocks: o.blocks, items: o.items, suddenDeath: o.suddenDeath, rounds: 7 } });
        break;
      case 'lobby':
        if (msg.phase !== 'lobby' || this.started) break;
        if (msg.players.length < o.n) this.conn.send({ t: 'addBot', level: 'normal' });
        else { this.started = true; this.conn.send({ t: 'start' }); }
        break;
      case 'round':
        this.rounds++;
        this.game.reset(msg);
        this.renderer.setPlayers(msg);
        break;
      case 'snap':
        this.game.onSnapshot(msg, this.clock);
        break;
      default: break;
    }
  }

  /** One frame of `dtMs` virtual milliseconds, in the order main.js will use. */
  frame(dtMs = FRAME_MS, draw = true) {
    this.clock += dtMs;
    const inbox = this.inbox;
    while (inbox.length && inbox[0].due <= this.clock) this.handle(inbox.shift().msg);
    this.conn.pump(this.clock);
    this.conn.drain();
    while (inbox.length && inbox[0].due <= this.clock) this.handle(inbox.shift().msg);
    const game = this.game;
    if (!game || game.round === null) return;
    game.setIntent(this.intent());
    game.update(this.clock);
    const view = game.getView(this.clock);
    this.view = view;
    const events = game.takeEvents();
    this.lastEvents = events;
    for (let i = 0; i < events.length; i++) this.events.push(events[i][0]);
    if (draw) {
      this.renderer.handleEvents(events, view);
      this.renderer.render(view, dtMs, this.clock);
    }
    this.frames++;
  }

  /** What the (autopiloted) human does: the harness autopilot reads the Room's World like a bot would. */
  intent() {
    const room = this.conn.room, world = room && room.world;
    if (!world || world.state === STATE.OVER || !this.o.play) return { d: 0, bomb: false, special: false };
    if (!this.pilot || this.pilot.world !== world) this.pilot = new AutoPilot(world, { seed: this.o.seed * 13 + 1, reckless: this.o.reckless, bombRate: this.o.bombRate });
    const c = this.pilot.think(this.me);
    return { d: c.d, bomb: c.b === 1, special: c.x === 1 };
  }

  run(frames, dtMs = FRAME_MS, draw = true) {
    for (let i = 0; i < frames; i++) this.frame(dtMs, draw);
  }

  /** Run until `pred(live)` holds (at most `max` frames). Returns the frames used, or -1. */
  until(pred, max = 6000, dtMs = FRAME_MS) {
    for (let i = 0; i < max; i++) {
      this.frame(dtMs);
      if (pred(this)) return i + 1;
    }
    return -1;
  }

  shot() { return this.canvas.toDataURL('image/png'); }

  /**
   * Run until an event with code `until` arrives, then film the place it happened: `frames` pictures `every` frames apart, each a `size`
   * (tiles) crop around the event's position (a death's x, y, a blast's tile, else the local fighter).
   */
  strip({ until = 'death', frames = 10, every = 4, size = [4, 4], scale = 1, cols = 5, max = 20000, skip = 0 } = {}) {
    let hit = null;
    for (let i = 0, seen = 0; i < max && !hit; i++) {
      this.frame();
      for (const e of this.lastEvents) if (e[0] === until && seen++ >= skip) { hit = e; break; }
    }
    if (!hit) return null;
    const me = this.view.players.find((p) => p.isMe) ?? this.view.players[0];
    const [cx, cy] = until === 'death' ? [hit[3], hit[4]] : until === 'boom' ? [hit[3] + 0.5, hit[4] + 0.5] : [me.x, me.y];
    const L = this.renderer.layout, T = L.tile, w = Math.round(size[0] * T * scale), h = Math.round(size[1] * T * scale), rows = Math.ceil(frames / cols);
    const out = document.createElement('canvas');
    out.width = w * cols + (cols - 1) * 4; out.height = h * rows + (rows - 1) * 4;
    const g = out.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height);
    for (let f = 0; f < frames; f++) {
      if (f > 0) this.run(every);
      const col = f % cols, row = Math.floor(f / cols);
      g.drawImage(this.canvas, L.ox + (cx - size[0] / 2) * T, L.oy + (cy - size[1] / 2) * T, size[0] * T, size[1] * T, col * (w + 4), row * (h + 4), w, h);
      g.font = '14px monospace'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3;
      g.strokeText(`+${f * every}`, col * (w + 4) + 4, row * (h + 4) + 14); g.fillText(`+${f * every}`, col * (w + 4) + 4, row * (h + 4) + 14);
    }
    return out.toDataURL('image/png');
  }

  info() {
    const r = this.renderer, v = this.view;
    return {
      frames: this.frames, rounds: this.rounds, me: this.me, tick: this.conn.room?.world?.tickNo ?? -1, state: v ? v.state : -1,
      theme: v ? v.theme : '', errors: r.errors.slice(), stats: { ...r.stats }, tile: r.layout ? r.layout.tile : 0,
    };
  }
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const api = {
  live: null,

  /**
   * @param {object} o { css:[w,h], dpr, seed, n, theme, mode, roundTime, layout, blocks, items, suddenDeath, quality, reduced, align,
   *                     latency, jitter, play, reckless, bombRate, warm }
   */
  async start(o = {}) {
    const opts = {
      css: [1280, 720], dpr: 1, seed: 7, n: 6, theme: 'meadow', mode: 'ffa', roundTime: 120, layout: 'classic', blocks: 'normal', items: 'normal',
      suddenDeath: true, quality: 2, reduced: false, align: 'auto', latency: 40, jitter: 15, play: true, reckless: 0.02, bombRate: 0.09, warm: true, ...o,
    };
    if (api.live) api.live.renderer.dispose();
    const live = new Live(opts);
    api.live = live;
    await live.open();
    // Let the lobby handshake, the round and the first sprite build happen (the countdown is 3 s of virtual time).
    live.until((l) => l.renderer.set && l.view && l.view.state === STATE.COUNTDOWN, 2000);
    return live.info();
  },

  run: (frames, dtMs) => { api.live.run(frames, dtMs); return api.live.info(); },
  until: (name, arg, max) => {
    const preds = {
      state: (s) => (l) => l.view && l.view.state === s,
      event: (code) => (l) => l.lastEvents.some((e) => e[0] === code),
      flames: (n) => (l) => l.view && l.view.flames.length >= n,
      round: (n) => (l) => l.rounds >= n,
      tick: (n) => (l) => l.game.renderTick >= n,
    };
    return api.live.until(preds[name](arg), max);
  },
  shot: () => api.live.shot(),
  strip: (o) => api.live.strip(o),
  info: () => api.live.info(),

  /**
   * Frame cost of the whole client loop (pump + game + View + handleEvents + render) under requestAnimationFrame and the real clock.
   * The renderer's own share is `render`. Returns per-frame stats in ms.
   */
  async perf({ frames = 300, warm = 60 } = {}) {
    const live = api.live, r = live.renderer;
    const total = [], render = [], interval = [];
    const t0 = performance.now();
    live.clock = t0;
    let last = await nextFrame(), particlesMax = 0, flamesPeak = 0;
    for (let i = 0; i < frames + warm; i++) {
      const stamp = await nextFrame();
      const a = performance.now();
      live.clock = stamp;
      const before = r.stats.renderMs;
      live.frame(Math.min(stamp - last, 50), true);
      const b = performance.now();
      if (i >= warm) { total.push(b - a); interval.push(stamp - last); render.push(r.stats.renderMs - before === 0 ? r.stats.renderMs : r.stats.renderMs); }
      last = stamp;
      particlesMax = Math.max(particlesMax, r.stats.particles);
      if (live.view) flamesPeak = Math.max(flamesPeak, live.view.flames.length);
    }
    const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { mean: a.reduce((x, y) => x + y, 0) / a.length, p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
    return { total: stat(total), interval: stat(interval), render: stat(render), particlesMax, flamesPeak, info: live.info() };
  },
};

window.live = api;
window.liveReady = true;
