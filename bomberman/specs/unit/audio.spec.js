import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audio, createAudio, Engine, compileTrack, noteToMidi,
  SOUND_NAMES, MUSIC_NAMES, MAX_VOICES, LOOKAHEAD_S, PUMP_MS, MUSIC_LEVEL, DEFAULT_VOLUME,
} from '../../client/js/audio.js';

// SPEC 8.5: the WebAudio synthesizer. No browser here: everything runs against a fake AudioContext that is deliberately as strict as
// Chrome and Safari (non-finite values and negative times throw, an exponential ramp to 0 throws, a source starts once and cannot be
// stopped before it started), so a bad parameter anywhere in the synth fails a test instead of silently muting a sound on somebody's
// phone. What the synth actually sounds like (levels, clipping, spectrum) is measured in real Chromium by scripts/dev/audio/render.mjs.

// ---- A strict fake Web Audio ---------------------------------------------------------------------

const finite = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: non-finite value ${v}`);
};

class FakeParam {
  constructor(name, value = 0) { this.name = name; this._value = value; this.events = []; }
  get value() { return this._value; }
  set value(v) { finite(v, `${this.name}.value`); this._value = v; }
  _add(kind, value, time, extra) {
    finite(value, `${this.name}.${kind}`);
    finite(time, `${this.name}.${kind} time`);
    if (time < 0) throw new RangeError(`${this.name}.${kind}: negative time ${time}`);
    this.events.push({ kind, value, time, ...extra });
    return this;
  }
  setValueAtTime(v, t) { return this._add('set', v, t); }
  linearRampToValueAtTime(v, t) { return this._add('linear', v, t); }
  exponentialRampToValueAtTime(v, t) {
    if (v === 0) throw new RangeError(`${this.name}: exponential ramp to 0`);
    return this._add('exp', v, t);
  }
  setTargetAtTime(v, t, tc) {
    finite(tc, `${this.name} time constant`);
    if (tc < 0) throw new RangeError(`${this.name}: negative time constant`);
    return this._add('target', v, t, { tc });
  }
  cancelScheduledValues(t) {
    finite(t, `${this.name}.cancelScheduledValues`);
    this.events = this.events.filter((e) => e.time < t);
    return this;
  }
}

class FakeNode {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = []; this.disconnected = false; ctx.nodes.push(this); }
  connect(dest) {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError('connect: not a node or a param');
    this.outputs.push(dest);
    return dest;
  }
  disconnect() { this.outputs = []; this.disconnected = true; }
}

class FakeSource extends FakeNode {
  start(when = 0) {
    if (this.startAt !== undefined) throw new Error('InvalidStateError: start() called twice');
    finite(when, 'start');
    if (when < 0) throw new RangeError('start: negative time');
    this.startAt = when;
  }
  stop(when = 0) {
    if (this.startAt === undefined) throw new Error('InvalidStateError: stop() before start()');
    finite(when, 'stop');
    this.stopAt = when;
  }
}

const OSC_TYPES = new Set(['sine', 'square', 'sawtooth', 'triangle']);
const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass']);

class FakeContext {
  constructor({ allowResume = true, sampleRate = 48000 } = {}) {
    this.nodes = [];
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'suspended';
    this.allowResume = allowResume;
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.destination = new FakeNode(this, 'destination');
  }
  setState(state) { this.state = state; this.onstatechange?.(); }
  resume() {
    this.resumeCalls++;
    if (this.allowResume && this.state !== 'closed') this.setState('running');
    return Promise.resolve();
  }
  suspend() { this.suspendCalls++; this.setState('suspended'); return Promise.resolve(); }
  close() { this.setState('closed'); return Promise.resolve(); }

  /** Moves the clock and fires `onended` for every source whose stop time has passed. */
  advance(seconds) {
    this.currentTime += seconds;
    for (const s of this.sources()) {
      if (s.stopAt !== undefined && s.stopAt <= this.currentTime && !s.ended) { s.ended = true; s.onended?.(); }
    }
  }
  sources() { return this.nodes.filter((n) => n instanceof FakeSource && n.startAt !== undefined); }
  ofKind(kind) { return this.nodes.filter((n) => n.kind === kind); }

  createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam('gain', 1); return n; }
  createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam('pan', 0); return n; }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    for (const [k, v] of Object.entries({ threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 })) n[k] = new FakeParam(k, v);
    return n;
  }
  createWaveShaper() {
    const n = new FakeNode(this, 'shaper');
    let curve = null;
    Object.defineProperty(n, 'curve', {
      get: () => curve,
      set: (c) => { if (c !== null && !(c instanceof Float32Array)) throw new TypeError('curve must be a Float32Array'); curve = c; },
    });
    return n;
  }
  createConvolver() { const n = new FakeNode(this, 'convolver'); n.buffer = null; return n; }
  createBiquadFilter() {
    const n = new FakeNode(this, 'filter');
    let type = 'lowpass';
    Object.defineProperty(n, 'type', { get: () => type, set: (t) => { if (!FILTER_TYPES.has(t)) throw new TypeError(`filter type ${t}`); type = t; } });
    for (const [k, v] of Object.entries({ frequency: 350, Q: 1, gain: 0, detune: 0 })) n[k] = new FakeParam(`filter.${k}`, v);
    return n;
  }
  createOscillator() {
    const n = new FakeSource(this, 'osc');
    let type = 'sine';
    Object.defineProperty(n, 'type', { get: () => type, set: (t) => { if (!OSC_TYPES.has(t)) throw new TypeError(`oscillator type ${t}`); type = t; } });
    n.frequency = new FakeParam('osc.frequency', 440);
    n.detune = new FakeParam('osc.detune', 0);
    n.setPeriodicWave = (w) => { if (!(w instanceof FakePeriodicWave)) throw new TypeError('not a PeriodicWave'); n.wave = w; };
    return n;
  }
  createBufferSource() {
    const n = new FakeSource(this, 'buffer');
    n.buffer = null;
    n.loop = false;
    const start = n.start.bind(n);
    n.start = (when = 0, offset = 0) => { finite(offset, 'start offset'); if (offset < 0) throw new RangeError('negative offset'); start(when); n.offset = offset; };
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    if (!(length >= 1) || !(channels >= 1 && channels <= 32) || !(sampleRate >= 8000 && sampleRate <= 96000)) throw new RangeError('createBuffer');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  }
  createPeriodicWave(real, imag) {
    if (real.length !== imag.length || real.length < 2) throw new RangeError('createPeriodicWave');
    return new FakePeriodicWave();
  }
}
class FakePeriodicWave {}

class FakeDocument {
  constructor() { this.hidden = false; this.registry = []; }
  addEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    if (!this.registry.some((l) => l.type === type && l.fn === fn && l.capture === capture)) this.registry.push({ type, fn, capture, passive: !!opts?.passive });
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    this.registry = this.registry.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  listening(type) { return this.registry.filter((l) => l.type === type); }
  fire(type) { for (const l of [...this.registry]) if (l.type === type) l.fn({ type }); }
  setHidden(hidden) { this.hidden = hidden; this.fire('visibilitychange'); }
}

class FakeTimers {
  constructor() { this.live = new Map(); this.nextId = 1; }
  set = (fn, ms) => { const id = this.nextId++; this.live.set(id, { fn, ms }); return id; };
  clear = (id) => { this.live.delete(id); };
  get active() { return [...this.live.values()]; }
  run() { for (const t of [...this.live.values()]) t.fn(); }
}

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, String(v)); }, map };
};

/** mulberry32: a reproducible stand-in for Math.random. */
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A browser-like environment for createAudio(): fake context class, document, timers, storage. */
function world({ allowResume = true, storage = fakeStorage(), navigator = { audioSession: { type: 'auto' } } } = {}) {
  const ctxs = [];
  class Ctx extends FakeContext {
    constructor(options) { super({ allowResume }); this.options = options; ctxs.push(this); }
  }
  const document = new FakeDocument(), timers = new FakeTimers();
  const a = createAudio({ AudioContext: Ctx, document, navigator, storage, setInterval: timers.set, clearInterval: timers.clear, random: seeded() });
  return {
    a, document, timers, storage, navigator, ctxs,
    get ctx() { return ctxs[0]; },
    /** Arms the unlock and taps once, the way a player's first touch does. */
    tap() { a.unlock(); document.fire('click'); return ctxs[0]; },
  };
}

const engineOn = (opts) => { const ctx = new FakeContext(); return { ctx, engine: new Engine(ctx, { random: seeded(), ...opts }) }; };

// ---- Public surface ------------------------------------------------------------------------------

test('every sound and music name of SPEC 8.5 exists, and only those', () => {
  const sounds = 'place explode block pickup pickup_bad kick throw land death shield curse countdown go win_round win_match lose_match sudden_death warning click join leave emote chat error';
  assert.deepEqual([...SOUND_NAMES].sort(), sounds.split(' ').sort());
  assert.deepEqual([...MUSIC_NAMES], ['menu', 'battle', 'battle_fast', 'victory']);
});

test('the audio object has the interface of SPEC 8.1 plus duck() and supported', () => {
  for (const fn of ['unlock', 'play', 'music', 'setVolume', 'setMuted', 'duck']) assert.equal(typeof audio[fn], 'function', fn);
  assert.equal(typeof audio.muted, 'boolean');
  assert.equal(typeof audio.volume, 'number');
  assert.equal(typeof audio.supported, 'boolean');
});

test('without Web Audio (Node, old browsers) every call is a harmless no-op', () => {
  const store = fakeStorage();
  const a = createAudio({ AudioContext: null, document: null, navigator: null, storage: store });
  assert.equal(a.supported, false);
  assert.equal(a.state, 'unsupported');
  assert.doesNotThrow(() => {
    a.unlock();
    assert.equal(a.play('explode', { pan: 0.5 }), false);
    a.music('battle');
    a.music(null);
    a.duck(300);
    a.setVolume(0.3);
    a.setMuted(true);
  });
  assert.equal(a.volume, 0.3, 'settings still work and persist, so the UI slider is honest');
  assert.equal(a.muted, true);
  assert.deepEqual(JSON.parse(store.getItem('bp.audio')), { volume: 0.3, muted: true });

  assert.equal(audio.supported, false, 'the real module in Node has no AudioContext');
  assert.equal(audio.play('click'), false);
  assert.doesNotThrow(() => audio.unlock());
});

test('a constructor that throws is tried once, not once per tap', () => {
  let attempts = 0;
  const document = new FakeDocument();
  const a = createAudio({ AudioContext: class { constructor() { attempts++; throw new Error('blocked'); } }, document, navigator: null, storage: null });
  a.unlock();
  document.fire('click');
  const afterFirst = attempts;
  document.fire('click');
  document.fire('keydown');
  assert.equal(attempts, afterFirst);
  assert.equal(a.play('click'), false);
});

// ---- Autoplay policy (SPEC 8.5, iOS) ---------------------------------------------------------------

test('unlock() only arms the four gestures (capture, passive) and creates no context before a tap', () => {
  const w = world();
  w.a.unlock();
  w.a.unlock();
  assert.equal(w.ctxs.length, 0);
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    const l = w.document.listening(type);
    assert.equal(l.length, 1, `${type} registered once`);
    assert.deepEqual([l[0].capture, l[0].passive], [true, true], type);
  }
  for (const type of ['touchstart', 'pointerdown', 'mousedown']) assert.equal(w.document.listening(type).length, 0, `${type} does not unlock on iOS`);
  assert.equal(w.a.state, 'locked');
});

test('the first gesture creates an interactive context, resumes it and starts a silent buffer inside the same call', () => {
  const w = world();
  const ctx = w.tap();
  assert.deepEqual(ctx.options, { latencyHint: 'interactive' });
  assert.ok(ctx.resumeCalls >= 1);
  const silent = ctx.ofKind('buffer').filter((s) => s.startAt === 0);
  assert.equal(silent.length, 1);
  assert.equal(silent[0].buffer.length, 1);
  assert.equal(silent[0].buffer.sampleRate, 22050);
  assert.ok(silent[0].outputs.includes(ctx.destination));
  assert.equal(w.a.state, 'running');
  assert.equal(w.document.registry.filter((l) => l.type !== 'visibilitychange').length, 0, 'unlocked: the gesture listeners are gone');
});

test('the listeners stay while the context is still suspended, and come back after an interruption', () => {
  const w = world({ allowResume: false });
  const ctx = w.tap();
  assert.equal(ctx.state, 'suspended');
  assert.equal(w.document.listening('click').length, 1, 'a refused resume must be retried by the next gesture');
  w.document.fire('touchend');
  assert.ok(ctx.resumeCalls >= 2);

  ctx.allowResume = true;
  w.document.fire('keydown');
  assert.equal(ctx.state, 'running');
  assert.equal(w.document.listening('keydown').length, 0);

  ctx.setState('interrupted');   // a phone call, Siri, another tab grabbing audio
  assert.equal(w.document.listening('pointerup').length, 1);
  assert.equal(w.a.play('click'), false, 'nothing plays while interrupted');
  w.document.fire('pointerup');
  assert.equal(ctx.state, 'running');
  assert.equal(w.a.play('click'), true);
});

test('play() before the context runs is dropped, never queued', () => {
  const w = world({ allowResume: false });
  assert.equal(w.a.play('explode'), false);
  const ctx = w.tap();
  assert.equal(w.a.play('explode'), false, 'suspended');
  ctx.allowResume = true;
  w.document.fire('click');
  assert.equal(ctx.sources().filter((s) => s.kind === 'osc').length, 0, 'the earlier requests did not resurface');
  assert.equal(w.a.play('explode'), true);
});

test('iOS: the audio session is set to playback where the API exists, and its absence or failure is harmless', () => {
  const nav = { audioSession: { type: 'auto' } };
  world({ navigator: nav });
  assert.equal(nav.audioSession.type, 'playback');
  assert.doesNotThrow(() => world({ navigator: {} }));
  const hostile = { get audioSession() { throw new Error('nope'); } };
  assert.doesNotThrow(() => world({ navigator: hostile }));
});

test('hiding the tab suspends the context and pauses everything; showing it resumes', () => {
  const w = world();
  const ctx = w.tap();
  w.a.music('battle');
  assert.equal(w.timers.active.length, 1);
  const before = ctx.sources().length;

  w.document.setHidden(true);
  assert.equal(ctx.suspendCalls, 1);
  assert.equal(w.timers.active.length, 0, 'the look-ahead timer is stopped while hidden');
  assert.equal(w.a.play('click'), false);
  assert.equal(ctx.sources().length, before);

  const resumes = ctx.resumeCalls;
  w.document.setHidden(false);
  assert.ok(ctx.resumeCalls > resumes);
  assert.equal(ctx.state, 'running');
  assert.equal(w.timers.active.length, 1, 'the music carries on');
  assert.equal(w.a.play('click'), true);
});

test('a hidden tab plays no effects even if the browser was slow to suspend the context', () => {
  const w = world();
  const ctx = w.tap();
  ctx.suspend = () => Promise.resolve();   // still 'running' when the game asks for a sound
  w.document.setHidden(true);
  assert.equal(ctx.state, 'running');
  const n = ctx.sources().length;
  assert.equal(w.a.play('explode'), false);
  assert.equal(ctx.sources().length, n);
  w.document.setHidden(false);
  assert.equal(w.a.play('explode'), true);
});

test('visibilitychange before any context exists does nothing', () => {
  const w = world();
  assert.doesNotThrow(() => { w.document.setHidden(true); w.document.setHidden(false); });
  assert.equal(w.ctxs.length, 0);
});

// ---- Volume, mute, persistence -------------------------------------------------------------------

test('volume and mute are clamped, persisted under bp.audio and restored', () => {
  const w = world();
  assert.equal(w.a.volume, DEFAULT_VOLUME);
  assert.equal(w.a.muted, false);
  w.a.setVolume(0.35);
  w.a.setVolume(7);
  assert.equal(w.a.volume, 1);
  w.a.setVolume(-1);
  assert.equal(w.a.volume, 0);
  for (const junk of [NaN, Infinity, 'loud', undefined, null]) { w.a.setVolume(0.5); w.a.setVolume(junk); assert.equal(w.a.volume, 0.5, String(junk)); }
  w.a.setMuted(1);
  assert.equal(w.a.muted, true);
  assert.deepEqual(JSON.parse(w.storage.getItem('bp.audio')), { volume: w.a.volume, muted: true });

  const again = createAudio({ AudioContext: null, document: null, storage: w.storage });
  assert.equal(again.volume, w.a.volume);
  assert.equal(again.muted, true);
});

test('unreadable, corrupt or hostile stored settings fall back to the defaults', () => {
  for (const raw of ['garbage', '{', 'null', '[]', '{"volume":"loud","muted":"yes"}', '{"volume":null}', '{"volume":1e999}']) {
    const a = createAudio({ AudioContext: null, document: null, storage: fakeStorage({ 'bp.audio': raw }) });
    assert.ok(a.volume >= 0 && a.volume <= 1, raw);
    assert.equal(typeof a.muted, 'boolean', raw);
  }
  const clamped = createAudio({ AudioContext: null, document: null, storage: fakeStorage({ 'bp.audio': '{"volume":9,"muted":true}' }) });
  assert.deepEqual([clamped.volume, clamped.muted], [1, true]);

  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  const a = createAudio({ AudioContext: null, document: null, storage: throwing });
  assert.equal(a.volume, DEFAULT_VOLUME);
  assert.doesNotThrow(() => { a.setVolume(0.2); a.setMuted(true); });
  assert.deepEqual([a.volume, a.muted], [0.2, true], 'the session still works when nothing can be saved');
});

test('the master gain follows volume (tapered) and mute, and a saved mute is in force from the first sample', () => {
  const w = world();
  const ctx = w.tap();
  const master = ctx.ofKind('gain').find((g) => g.outputs.some((o) => o.kind === 'compressor'));
  assert.ok(master, 'master gain feeds the compressor');
  assert.ok(Math.abs(master.gain.value - DEFAULT_VOLUME ** 2) < 1e-9);

  w.a.setVolume(0.5);
  let last = master.gain.events.at(-1);
  assert.equal(last.kind, 'target');
  assert.ok(Math.abs(last.value - 0.25) < 1e-9);
  assert.ok(last.tc > 0, 'a ramp, not a click');

  w.a.setMuted(true);
  assert.equal(master.gain.events.at(-1).value, 0);
  assert.equal(w.a.play('explode'), false, 'muted: not even scheduled');
  w.a.setMuted(false);
  last = master.gain.events.at(-1);
  assert.ok(Math.abs(last.value - 0.25) < 1e-9);

  const saved = world({ storage: fakeStorage({ 'bp.audio': '{"volume":0.9,"muted":true}' }) });
  const c2 = saved.tap();
  const m2 = c2.ofKind('gain').find((g) => g.outputs.some((o) => o.kind === 'compressor'));
  assert.equal(m2.gain.value, 0);
});

// ---- The graph -------------------------------------------------------------------------------------

test('master chain: gain -> gentle compressor -> ceiling -> speakers, with separate sfx and music buses', () => {
  const { ctx, engine } = engineOn();
  const comp = engine.master.outputs.find((n) => n.kind === 'compressor');
  assert.ok(comp, 'master feeds a compressor');
  assert.ok(comp.ratio.value <= 4 && comp.threshold.value >= -12, 'gentle');
  const shaper = comp.outputs.find((n) => n.kind === 'shaper');
  assert.ok(shaper, 'the compressor feeds the soft ceiling');
  assert.deepEqual(shaper.outputs, [ctx.destination]);
  assert.ok(engine.sfxBus.outputs.includes(engine.master));
  assert.ok(engine.musicBus.outputs.includes(engine.master));
  assert.notEqual(engine.sfxBus, engine.musicBus);

  // The ceiling: identity in the normal range, never above 0.95, odd-symmetric and monotonic.
  const c = shaper.curve, mid = (c.length - 1) / 2;
  assert.ok(Math.max(...c.map(Math.abs)) <= 0.95);
  assert.ok(Math.abs(c[mid + Math.round(mid * 0.5)] - 0.5) < 1e-3, 'transparent below 0.8');
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], 'monotonic');
  for (let i = 0; i <= mid; i++) assert.ok(Math.abs(c[i] + c[c.length - 1 - i]) < 1e-6, 'symmetric');
});

test('music runs well under the effects: its bus is at most 18 % of the master, the effects bus at 100 %', () => {
  const { engine } = engineOn();
  assert.ok(MUSIC_LEVEL <= 0.18);
  assert.equal(engine.musicBus.gain.value, MUSIC_LEVEL);
  assert.equal(engine.sfxBus.gain.value, 1);
  assert.ok(DEFAULT_VOLUME > 0 && DEFAULT_VOLUME <= 1);
});

// ---- Sound effects ---------------------------------------------------------------------------------

test('every sound effect builds with valid Web Audio parameters, is finite in length and cleans up after itself', () => {
  for (const name of SOUND_NAMES) {
    const { ctx, engine } = engineOn();
    assert.equal(engine.play(name, { pan: -0.4 }, 1), true, name);   // a bad parameter makes the fake throw, and play() reports false
    const voice = engine.voices[0], sources = ctx.sources();
    assert.ok(sources.length >= 1, `${name} makes sound`);
    for (const s of sources) {
      assert.ok(s.startAt >= 1 - 1e-9, `${name}: starts at or after the requested time`);
      if (s.kind === 'osc' || s.loop) assert.ok(s.stopAt > s.startAt, `${name}: every oscillator and looped noise has a stop time (no leaks)`);
    }
    const length = voice.end - 1;
    assert.ok(length > 0.03 && length < 4.5, `${name}: ${length.toFixed(2)} s`);
    assert.ok(voice.out.gain.value > 0 && voice.out.gain.value <= 2, `${name}: level ${voice.out.gain.value}`);

    ctx.advance(6);
    assert.equal(engine.voiceCount(ctx.currentTime), 0, `${name}: finished`);
    assert.ok(voice.out.disconnected, `${name}: released its nodes when the last source ended`);
  }
});

test('unknown sound names and hostile arguments are ignored, never thrown', () => {
  const { engine } = engineOn();
  for (const name of ['nope', '', null, undefined, 42, {}, [], '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'PLACE']) {
    assert.equal(engine.play(name, {}, 1), false, String(name));
  }
  assert.equal(engine.voices.length, 0);

  const w = world();
  w.tap();
  assert.equal(w.a.play(undefined), false);
  for (const opts of [undefined, null, {}, 5, 'x', [], { pan: NaN }, { pan: 'left' }, { pan: 99 }, { pan: -99 }, { vol: -5 }, { vol: Infinity }, { vol: NaN },
    { rate: 0 }, { rate: -2 }, { rate: NaN }, { rate: 1e9 }, { rate: 1e-9 }, { pan: null, vol: null, rate: null }]) {
    w.ctx.advance(1);   // clear cooldowns between attempts
    assert.equal(w.a.play('pickup', opts), true, JSON.stringify(opts));
  }
});

test('pan is clamped to the stereo field, and a browser without StereoPanner just plays centred', () => {
  for (const [pan, want] of [[0.5, 0.5], [-0.25, -0.25], [5, 1], [-5, -1]]) {
    const { ctx, engine } = engineOn();
    engine.play('kick', { pan }, 1);
    const panners = ctx.ofKind('panner');
    assert.equal(panners.length, 1);
    assert.equal(panners[0].pan.value, want);
  }
  const { ctx, engine } = engineOn();
  engine.play('kick', { pan: 0 }, 1);
  assert.equal(ctx.ofKind('panner').length, 0, 'centre needs no panner');

  const old = new FakeContext();
  old.createStereoPanner = undefined;
  assert.equal(new Engine(old, { random: seeded() }).play('kick', { pan: 0.8 }, 1), true);
});

test('vol scales the level, rate shifts the pitch, and a tiny random detune varies repeats', () => {
  const freqOf = (opts, random) => {
    const { ctx, engine } = engineOn({ random });
    engine.play('place', opts, 1);
    return ctx.ofKind('osc')[0].frequency.events[0].value;
  };
  const base = freqOf({}, () => 0.5);
  assert.ok(Math.abs(base - 230) < 1e-9, 'no jitter at the centre of the random range');
  assert.ok(Math.abs(freqOf({ rate: 2 }, () => 0.5) / base - 2) < 1e-9);
  assert.ok(Math.abs(freqOf({ rate: 0.5 }, () => 0.5) / base - 0.5) < 1e-9);
  const low = freqOf({}, () => 0), high = freqOf({}, () => 0.999999);
  assert.ok(low < base && high > base, 'random varies the pitch');
  assert.ok(low / base > 0.9 && high / base < 1.1, 'but only slightly');

  const level = (opts) => { const { engine } = engineOn(); engine.play('pickup', opts, 1); return engine.voices[0].out.gain.value; };
  assert.ok(Math.abs(level({ vol: 0.5 }) / level({}) - 0.5) < 1e-9);
  assert.equal(level({ vol: 0 }), 0);
  assert.ok(level({ vol: 50 }) / level({}) <= 2 + 1e-9, 'vol is capped at 2');
});

test('eight explosions at once become a short rolling boom, not a wall: cooldown, staggering, falling level', () => {
  const { ctx, engine } = engineOn();
  const played = [];
  for (let i = 0; i < 8; i++) played.push(engine.play('explode', { pan: -0.9 + i * 0.25 }, 1));
  const count = played.filter(Boolean).length;
  assert.ok(count >= 2 && count <= 5, `${count} of 8 sounded`);
  assert.deepEqual(played, played.map((_, i) => i < count), 'the survivors are the first ones');

  const starts = engine.voices.map((v) => v.t0);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 0.04, 'at least the cooldown apart');
  const gains = engine.voices.map((v) => v.out.gain.value);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] < gains[i - 1], 'every repeat inside the window is quieter');
  const lengths = engine.voices.map((v) => v.end - v.t0);
  assert.ok(lengths[0] > lengths[1], 'the first blast is the full boom, the rest are the smaller chain variant');

  ctx.advance(3);
  assert.equal(engine.play('explode', {}, ctx.currentTime), true, 'after the cooldown a new blast is a fresh full boom');
  assert.equal(engine.voices.at(-1).out.gain.value, gains[0]);
});

test('a button-masher cannot machine-gun: clicks closer than the cooldown are dropped', () => {
  const { engine } = engineOn();
  let sounded = 0;
  for (let i = 0; i < 100; i++) if (engine.play('click', {}, 1 + i * 0.001)) sounded++;   // 100 clicks in 100 ms
  assert.ok(sounded >= 1 && sounded <= 4, `${sounded} clicks sounded`);
});

test('never more than 24 voices at once, however hard the mixer is hit', () => {
  assert.equal(MAX_VOICES, 24);
  const { engine } = engineOn();
  const rand = seeded(7);
  let peak = 0;
  for (let i = 0; i < 4000; i++) {
    const t = 1 + i * 0.002;
    engine.play(SOUND_NAMES[Math.floor(rand() * SOUND_NAMES.length)], { pan: rand() * 2 - 1 }, t);
    peak = Math.max(peak, engine.voiceCount(t));
    assert.ok(engine.voiceCount(t) <= MAX_VOICES, `t=${t}`);
  }
  assert.ok(peak >= 12, `the stress actually crowded the mixer (peak ${peak})`);
});

test('when voices run out an equal-or-higher priority sound steals the oldest, a lower one is dropped', () => {
  const { engine } = engineOn({ maxVoices: 2 });
  assert.equal(engine.play('win_match', {}, 1), true);
  assert.equal(engine.play('lose_match', {}, 1), true);
  assert.equal(engine.voiceCount(1), 2);
  assert.equal(engine.play('click', {}, 1.1), false, 'a click cannot push out fanfares');
  const oldest = engine.voices[0];
  assert.equal(engine.play('explode', {}, 1.2), true, 'an explosion can');
  assert.equal(engine.voiceCount(1.3), 2);
  assert.ok(!engine.voices.includes(oldest), 'the oldest voice went');
  assert.ok(oldest.end < 1.3, 'and it was faded out promptly, not left ringing');
  assert.ok(oldest.out.gain.events.some((e) => e.kind === 'target' && e.value === 0));
});

test('the reverb is built on first use only and shared', () => {
  const { ctx, engine } = engineOn();
  engine.play('click', {}, 1);
  assert.equal(ctx.ofKind('convolver').length, 0);
  engine.play('pickup', {}, 2);
  engine.play('join', {}, 3);
  assert.equal(ctx.ofKind('convolver').length, 1);
  assert.ok(ctx.ofKind('convolver')[0].buffer.length > 1);
});

test('big sounds duck the music, and only the first of a chain does', () => {
  const { engine } = engineOn();
  const events = () => engine.duckGain.gain.events;
  assert.equal(events().length, 0);
  engine.play('explode', {}, 1);
  const dip = events().find((e) => e.kind === 'target' && e.value < 1);
  const back = events().find((e) => e.kind === 'target' && e.value === 1);
  assert.ok(dip && dip.value <= 0.6 && dip.time === 1);
  assert.ok(back && back.time > dip.time + 0.1 && back.tc >= 0.1, 'held, then eased back slowly');
  const n = events().length;
  engine.play('explode', {}, 1.05);   // chain > 0
  assert.equal(events().length, n);
  engine.play('click', {}, 2);
  assert.equal(events().length, n, 'small sounds leave the music alone');
});

test('audio.duck(ms) dips the music for that long and is ignored while nothing can play', () => {
  const w = world({ allowResume: false });
  assert.doesNotThrow(() => w.a.duck(400));
  const ctx = w.tap();
  ctx.allowResume = true;
  w.document.fire('click');
  ctx.advance(2);
  const gains = ctx.ofKind('gain'), before = gains.reduce((n, g) => n + g.gain.events.length, 0);
  w.a.duck(400);
  const fresh = gains.flatMap((g) => g.gain.events).length - before;
  assert.equal(fresh, 2, 'one dip and one recovery');
  const dip = gains.flatMap((g) => g.gain.events).filter((e) => e.kind === 'target' && e.time === 2);
  const back = gains.flatMap((g) => g.gain.events).filter((e) => e.kind === 'target' && Math.abs(e.time - 2.4) < 1e-9);
  assert.equal(dip.length, 1);
  assert.equal(back.length, 1);
  assert.doesNotThrow(() => { w.a.duck(NaN); w.a.duck(-5); w.a.duck(1e9); });
});

// ---- Music: the tracks -----------------------------------------------------------------------------

test('noteToMidi reads scientific pitch names', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('F#5'), 78);
  assert.equal(noteToMidi('C-1'), 0);
  for (const bad of ['H4', 'C', '4', '', 'c4', undefined, null, 60]) assert.ok(Number.isNaN(noteToMidi(bad)), String(bad));
});

test('the four tracks compile into whole bars of sixteenth notes', () => {
  for (const name of MUSIC_NAMES) {
    const t = compileTrack(name);
    assert.ok(t, name);
    assert.equal(t.steps, t.bars * 16, `${name}: whole bars`);
    assert.equal(t.events.length, t.steps);
    assert.ok(Math.abs(t.stepDur - 60 / t.bpm / 4) < 1e-12);
    assert.equal(t.chords.length, t.bars, `${name}: one chord per bar`);
    assert.equal(compileTrack(name), t, 'compiled once');
    const loop = t.steps * t.stepDur;
    assert.ok(loop >= 10 && loop <= 40, `${name}: ${loop.toFixed(1)} s loop`);
    for (const ev of t.events.flat()) {
      assert.ok(ev.len >= 1 && ev.vel > 0 && ev.vel <= 1, name);
      if (ev.inst !== 'kick' && !['snare', 'brush', 'clap', 'hat', 'ohat', 'crash'].includes(ev.inst)) assert.ok(ev.midi >= 24 && ev.midi <= 100, `${name}/${ev.part}: midi ${ev.midi}`);
    }
    const parts = new Set(t.events.flat().map((e) => e.part));
    for (const p of t.parts) assert.ok(parts.has(p.part), `${name}: part "${p.part}" sounds somewhere`);
  }
  for (const bad of ['nope', '', null, undefined, 3, '__proto__', 'constructor', 'toString']) assert.equal(compileTrack(bad), null, String(bad));
});

test('the tracks have the roles the brief asks for', () => {
  const menu = compileTrack('menu'), battle = compileTrack('battle'), fast = compileTrack('battle_fast'), victory = compileTrack('victory');
  assert.equal(battle.bpm, 140);
  assert.ok(menu.bpm < 110 && menu.swing > 0, 'chill and bouncy');
  assert.ok(fast.bpm >= battle.bpm * 1.15, 'sudden death is clearly faster');
  assert.deepEqual(fast.chords, battle.chords, 'same key and progression');
  assert.equal(fast.bars, battle.bars);
  const partsOf = (t) => new Set(t.parts.map((p) => p.part));
  for (const t of [battle, fast]) for (const p of ['lead', 'arp', 'bass', 'kick', 'snare', 'hat']) assert.ok(partsOf(t).has(p), `${t.name} has ${p}`);
  const downbeats = (t, part) => Array.from({ length: t.bars }, (_, b) => t.events[b * 16].some((e) => e.part === part));
  assert.ok(downbeats(battle, 'kick').every(Boolean), 'a kick on every downbeat');
  assert.ok(victory.bpm > menu.bpm && victory.bars * 16 * victory.stepDur < 20, 'victory is a short jingle-loop');
});

test('each bar has exactly 16 steps in every row (a typo would shift the whole tune)', () => {
  for (const name of MUSIC_NAMES) {
    const t = compileTrack(name);
    for (const part of t.parts) {
      for (const row of part.rows) {
        const tokens = part.kind === 'drum' ? [...row.replace(/[\s|]/g, '')] : row.replace(/\|/g, ' ').trim().split(/\s+/);
        assert.equal(tokens.length, 16, `${name}/${part.part}: "${row}"`);
      }
    }
  }
});

// ---- Music: the scheduler --------------------------------------------------------------------------

const starts = (ctx) => ctx.sources().map((s) => s.startAt);

test('the look-ahead scheduler fills exactly the window, never twice', () => {
  const { ctx, engine } = engineOn();
  assert.equal(engine.music.start('battle', { when: 0.1 }), true);
  assert.equal(ctx.sources().length, 0, 'nothing is scheduled until pumped');
  engine.music.pump(0.1 + LOOKAHEAD_S);
  const first = starts(ctx);
  assert.ok(first.length > 20);
  assert.ok(Math.min(...first) >= 0.1 - 1e-9 && Math.max(...first) < 0.1 + LOOKAHEAD_S, 'inside the window');

  engine.music.pump(0.1 + LOOKAHEAD_S);
  assert.equal(ctx.sources().length, first.length, 'same horizon: nothing new');
  engine.music.pump(0.1 + LOOKAHEAD_S + 0.05);
  assert.ok(ctx.sources().length >= first.length);
  engine.music.pump(3);
  const step = compileTrack('battle').stepDur;
  for (const t of starts(ctx)) {
    const k = (t - 0.1) / step;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `note at ${t} sits on the sixteenth grid`);
  }
});

test('swing delays the off-beat sixteenths of the menu track only', () => {
  const { ctx, engine } = engineOn();
  const t = compileTrack('menu');
  engine.music.start('menu', { when: 0 });
  engine.music.pump(3);
  const offsets = new Set(starts(ctx).map((s) => Math.round((s / t.stepDur) * 1000) / 1000));
  assert.ok([...offsets].some((k) => Math.abs(k - Math.round(k) - t.swing) < 1e-3), 'a swung sixteenth exists');
});

test('loops are seamless: the second pass through the tune is note-for-note the first', () => {
  for (const name of MUSIC_NAMES) {
    const { ctx, engine } = engineOn();
    const t = compileTrack(name), loop = t.steps * t.stepDur, at = 0.25;
    engine.music.start(name, { when: at });
    engine.music.pump(at + 2 * loop + 0.5);
    const fingerprint = (from) => ctx.sources()
      .filter((s) => s.startAt >= from - 1e-9 && s.startAt < from + loop - 1e-9)
      .map((s) => `${(Math.round((s.startAt - from) * 1e4) / 1e4 + 0).toFixed(4)}|${s.kind}|${s.kind === 'osc' ? (s.frequency.events[0]?.value ?? s.frequency.value).toFixed(3) : s.loop}`)
      .sort();
    const one = fingerprint(at), two = fingerprint(at + loop);
    assert.ok(one.length > 100, name);
    assert.deepEqual(two, one, `${name}: loop seam`);
  }
});

test('a note that was not stopped cannot outlive its loop by more than its own release', () => {
  for (const name of MUSIC_NAMES) {
    const { ctx, engine } = engineOn();
    engine.music.start(name, { when: 0 });
    engine.music.pump(compileTrack(name).steps * compileTrack(name).stepDur);
    for (const s of ctx.sources()) if (s.kind === 'osc' || s.loop) assert.ok(s.stopAt - s.startAt <= 3, `${name}: a ${(s.stopAt - s.startAt).toFixed(1)} s source`);
  }
});

test('music nodes are valid Web Audio (the strict fake would throw otherwise) for every track and instrument', () => {
  for (const name of MUSIC_NAMES) {
    const { ctx, engine } = engineOn();
    engine.music.start(name, { when: 0 });
    assert.doesNotThrow(() => engine.music.pump(compileTrack(name).steps * compileTrack(name).stepDur + 1), name);
    assert.ok(ctx.sources().length > 300, name);
  }
});

test('switching tracks crossfades; tracks with the same chords continue from the next bar', () => {
  const { ctx, engine } = engineOn();
  const m = engine.music;
  m.start('battle', { when: 0 });
  m.pump(LOOKAHEAD_S);
  const old = m.run;
  ctx.currentTime = 2;
  m.pump(2 + LOOKAHEAD_S);
  const heard = Math.floor(old.stepAt(2) / 16);

  assert.equal(m.start('battle_fast'), true);
  assert.notEqual(m.run, old);
  const fade = old.node.gain.events.at(-1);
  assert.deepEqual([fade.kind, fade.value], ['target', 0], 'the old track fades out');
  assert.equal(m.run.node.gain.value, 0, 'the new one fades in from silence');
  assert.equal(m.run.node.gain.events.at(-1).value, 1);
  assert.equal(m.run.step, ((heard + 1) * 16) % 256, 'battle -> battle_fast stays in the tune, at the next bar');
  assert.equal(m.name, 'battle_fast');

  const fastRun = m.run;
  m.start('menu');
  assert.equal(m.run.step, 0, 'unrelated tracks start from their beginning');
  assert.equal(fastRun.node.gain.events.at(-1).value, 0);

  // Once the fade is long over, the retired runs are taken out of the graph.
  ctx.currentTime = 30;
  m.pump(31);
  assert.ok(old.node.disconnected && fastRun.node.disconnected);
  assert.equal(m.retired.length, 0);
});

test('suspend remembers the place in the tune and start() carries on from it', () => {
  const { ctx, engine } = engineOn();
  const m = engine.music;
  assert.equal(m.start('battle', { when: 0 }), true);
  m.pump(2);
  const place = m.run.step;
  ctx.currentTime = 1;
  m.suspend();
  assert.equal(m.active, false);
  assert.equal(m.step, place);
  const before = ctx.sources().length;
  m.pump(5);
  assert.equal(ctx.sources().length, before, 'a suspended track schedules nothing');
  m.start('battle');
  assert.equal(m.run.step, place);
  assert.equal(m.start('bogus'), false);
  m.stop();
  assert.deepEqual([m.active, m.name, m.step], [false, null, 0]);
});

test('a stalled tab does not dump its backlog: after a long gap the sequencer skips ahead', () => {
  const { ctx, engine } = engineOn();
  engine.music.start('battle', { when: 0 });
  engine.music.pump(LOOKAHEAD_S);
  const before = ctx.sources().length;
  ctx.currentTime = 60;
  engine.music.pump(60 + LOOKAHEAD_S);
  const fresh = ctx.sources().slice(before);
  assert.ok(fresh.length > 0 && fresh.length < 500, `${fresh.length} nodes scheduled for the 1.2 s window`);
  assert.ok(Math.min(...fresh.map((s) => s.startAt)) >= 60 - 0.06, 'nothing is scheduled in the past');
});

// ---- Music through the browser facade ----------------------------------------------------------------

test('music requested before the unlock waits for it, then plays with a 25 ms timer keeping >= 1.2 s scheduled', () => {
  const w = world();
  w.a.music('battle_fast');   // a hat on every sixteenth, so the last scheduled note marks the scheduling horizon
  assert.equal(w.ctxs.length, 0);
  assert.equal(w.timers.active.length, 0);
  const ctx = w.tap();
  assert.equal(w.timers.active.length, 1);
  assert.equal(w.timers.active[0].ms, PUMP_MS);
  assert.equal(PUMP_MS, 25);
  assert.ok(LOOKAHEAD_S >= 1.2);

  const step = compileTrack('battle_fast').stepDur;
  const ahead = () => Math.max(...starts(ctx).filter((t) => t > 0)) - ctx.currentTime;
  assert.ok(ahead() > LOOKAHEAD_S - 0.1 - step && ahead() < LOOKAHEAD_S, `${ahead().toFixed(2)} s scheduled ahead`);
  for (let i = 0; i < 80; i++) {
    ctx.currentTime += 0.025;
    w.timers.run();
    assert.ok(ahead() > LOOKAHEAD_S - step - 1e-9 && ahead() < LOOKAHEAD_S + 1e-9, `after ${i + 1} ticks: ${ahead().toFixed(3)} s`);
  }
});

test('music(name) with the same name does not restart it, an unknown name is ignored, null stops it', () => {
  const w = world();
  const ctx = w.tap();
  w.a.music('menu');
  const n = ctx.sources().length;
  w.a.music('menu');
  assert.equal(ctx.sources().length, n, 'no second run');
  w.a.music('does-not-exist');
  w.a.music(42);
  assert.equal(w.timers.active.length, 1, 'still playing the menu');
  w.a.music(null);
  assert.equal(w.timers.active.length, 0);
  w.a.music(null);
  w.a.music('battle');
  assert.equal(w.timers.active.length, 1);
});

test('muting pauses the music and unmuting brings it back', () => {
  const w = world();
  w.tap();
  w.a.music('victory');
  assert.equal(w.timers.active.length, 1);
  w.a.setMuted(true);
  assert.equal(w.timers.active.length, 0);
  w.a.setMuted(false);
  assert.equal(w.timers.active.length, 1);
});

test('an interruption pauses the music and the next tap restarts it', () => {
  const w = world();
  const ctx = w.tap();
  w.a.music('battle');
  ctx.setState('interrupted');
  assert.equal(w.timers.active.length, 0);
  w.document.fire('touchend');
  assert.equal(ctx.state, 'running');
  assert.equal(w.timers.active.length, 1);
});

test('a hidden tab schedules nothing, and the tune resumes on return', () => {
  const w = world();
  const ctx = w.tap();
  w.a.music('battle');
  ctx.currentTime += 1;
  w.timers.run();
  w.document.setHidden(true);
  const n = ctx.sources().length;
  ctx.currentTime += 40;   // throttled timers, suspended context: whatever happens meanwhile
  w.timers.run();
  assert.equal(ctx.sources().length, n);
  w.document.setHidden(false);
  const fresh = ctx.sources().slice(n);
  assert.ok(fresh.length > 0, 'the music is back');
  assert.ok(Math.min(...fresh.map((s) => s.startAt)) >= ctx.currentTime - 1e-9, 'and starts now, not in the past');
});
