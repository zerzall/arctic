// The adaptive score (audio/music.js + the baked orchestra of audio/instruments.js):
// key and chord discipline, material length, seeded phrase order, seamless sample loops,
// bake determinism and a dry offline mixdown that must stay finite and below clipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, renderSound, soundRate } from '../public/js/audio/sounds.js';
import { MUSIC_ROOTS } from '../public/js/audio/instruments.js';
import { MUSIC_STATES, MUSIC_CHORDS, INSTRUMENTS, buildPhrase, layerGain } from '../public/js/audio/music.js';
import { createAudio } from '../public/js/audio/audio.js';
import { peak, rms } from '../public/js/audio/synth.js';
import { createRng } from '../public/js/shared/rng.js';
import { MockAudioContext } from './fixtures/audio-mock-context.js';

const SR = 8000;
const MUSIC_IDS = Object.keys(SOUNDS).filter((id) => SOUNDS[id].cat === 'music');
const pc = (m) => ((m % 12) + 12) % 12;
// Instruments that voice the written chords (melodies may pass through other scale notes).
const CHORDAL = new Set(['str', 'ooh', 'spicc', 'harp', 'timp']);

function everyPhrase(fn) {
  for (const [state, st] of Object.entries(MUSIC_STATES)) {
    for (const name of new Set([...st.phrases, ...(st.intro ? [st.intro] : [])])) fn(state, st, name, buildPhrase(state, name, createRng(3)));
  }
}

test('the score stays in key: every note in its state’s mode, accompaniment on chord tones', () => {
  everyPhrase((state, st, name, p) => {
    assert.equal(p.len % st.bar, 0, `${name}: whole bars`);
    assert.ok(p.events.length > 0, `${name} is empty`);
    for (const e of p.events) {
      assert.ok(e.t >= 0 && e.t < p.len, `${name}: event outside the phrase`);
      assert.ok(e.v > 0 && e.v <= 1.2 && Number.isFinite(e.v), `${name}: velocity ${e.v}`);
      assert.ok(INSTRUMENTS[e.i], `${name}: unknown instrument ${e.i}`);
      if (e.m == null) continue;
      assert.ok(st.scale.includes(pc(e.m)), `${state}/${name}: ${e.i} ${e.m} is outside the mode`);
      if (CHORDAL.has(e.i)) {
        const seg = p.segs.find((s) => e.t >= s.t && e.t < s.t + s.d);
        assert.ok(MUSIC_CHORDS[seg.ch].includes(pc(e.m)), `${state}/${name}: ${e.i} ${e.m} is not in ${seg.ch}`);
      }
      // Each note is played from a nearby sample root (natural timbre, no chipmunk voices).
      const roots = MUSIC_ROOTS[INSTRUMENTS[e.i].id];
      const far = Math.min(...roots.map((r) => Math.abs(r - e.m)));
      assert.ok(far <= (e.i === 'timp' ? 6 : 2), `${name}: ${e.i} ${e.m} is ${far} semitones from a root`);
    }
  });
});

test('the score has no horror left in it: no tritone-heavy or chromatic clusters in the chords', () => {
  for (const [name, pcs] of Object.entries(MUSIC_CHORDS)) {
    for (let i = 0; i < pcs.length; i++) {
      for (let j = i + 1; j < pcs.length; j++) {
        const iv = pc(pcs[j] - pcs[i]);
        assert.ok(![1, 11, 6].includes(iv), `${name} has a semitone/tritone (${iv})`);
      }
    }
  }
});

test('each looping state has a minute or more of material; tempos and meters as designed', () => {
  const secs = (state) => MUSIC_STATES[state].phrases.reduce((s, n) => s + buildPhrase(state, n).len * MUSIC_STATES[state].tick, 0);
  for (const state of ['menu', 'calm', 'battle', 'boss', 'glory', 'lament']) {
    assert.ok(secs(state) >= 60 && secs(state) <= 130, `${state}: ${secs(state).toFixed(1)} s`);
  }
  for (const cue of ['waveclear', 'victory', 'gameover']) {
    const s = secs(cue);
    assert.ok(MUSIC_STATES[cue].cue && s >= 6 && s <= 20, `${cue} cue ${s.toFixed(1)} s`);
  }
  assert.equal(MUSIC_STATES.calm.bpm, 70);
  assert.equal(MUSIC_STATES.calm.bar, 12, 'calm is in 3/4');
  assert.equal(MUSIC_STATES.battle.bpm, 112);
  assert.equal(MUSIC_STATES.battle.bar, 16, 'battle is in 4/4');
  assert.ok(MUSIC_STATES.boss.compound && MUSIC_STATES.boss.bar === 12, 'boss is in 6/8');
});

test('battle layers build with intensity', () => {
  assert.equal(layerGain('base', 0), 1);
  for (const L of ['d1', 'd2', 'd3', 'horn', 'choir', 'chant', 'hi']) {
    assert.equal(layerGain(L, 0.1), 0, `${L} silent when calm`);
    assert.equal(layerGain(L, 1), 1, `${L} full at the peak`);
  }
  assert.ok(layerGain('d1', 0.45) > layerGain('chant', 0.45), 'drums come before the chant');
});

test('music bake is deterministic and every instrument sample is finite and normalised', () => {
  for (const id of MUSIC_IDS) {
    const n = SOUNDS[id].v || 1;
    for (let v = 0; v < n; v++) {
      const a = renderSound(id, SR, v);
      assert.ok(a.length > 10);
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) assert.fail(`${id}#${v} non-finite`);
      assert.ok(peak(a) <= 0.9 + 1e-6 && peak(a) > 0.3, `${id}#${v} peak ${peak(a)}`);
    }
    assert.deepEqual(renderSound(id, SR, n - 1), renderSound(id, SR, n - 1), `${id} is deterministic`);
  }
});

test('sustained instruments loop seamlessly at every root (no step, no kink, no swells)', () => {
  const sr = 22050;
  for (const id of MUSIC_IDS.filter((k) => SOUNDS[k].loop)) {
    for (let v = 0; v < SOUNDS[id].v; v++) {
      const b = renderSound(id, sr, v);
      const rate = soundRate(id, sr);
      let maxStep = 0;
      for (let i = 1; i < b.length; i++) maxStep = Math.max(maxStep, Math.abs(b[i] - b[i - 1]));
      const wrap = Math.abs(b[0] - b[b.length - 1]);
      assert.ok(wrap <= maxStep * 1.05 + 1e-3, `${id}#${v} seam ${wrap} vs max step ${maxStep}`);
      // Curvature across the wrap is like anywhere else (the loops are built exactly periodic).
      let maxCurve = 0;
      for (let i = 2; i < b.length; i++) maxCurve = Math.max(maxCurve, Math.abs(b[i] - 2 * b[i - 1] + b[i - 2]));
      const n = b.length;
      const curve = Math.max(Math.abs(b[0] - 2 * b[n - 1] + b[n - 2]), Math.abs(b[1] - 2 * b[0] + b[n - 1]));
      assert.ok(curve <= maxCurve * 1.05 + 1e-3, `${id}#${v} kink at the wrap ${curve} vs ${maxCurve}`);
      // No slow swells: the loop's 100 ms level (measured around the wrap) stays within 6 dB.
      const w = Math.floor(rate * 0.1);
      let lo = Infinity, hi = 0;
      for (let i = 0; i < n; i += w >> 2) {
        let q = 0;
        for (let k = 0; k < w; k++) q += b[(i + k) % n] ** 2;
        lo = Math.min(lo, q);
        hi = Math.max(hi, q);
      }
      assert.ok(10 * Math.log10(hi / lo) < 6, `${id}#${v} swells by ${(10 * Math.log10(hi / lo)).toFixed(1)} dB`);
    }
  }
});

// ---- offline mixdown of what the mock context recorded --------------------------------------

/** Value of a mock AudioParam at time t from its automation log (WebAudio semantics). */
function paramAt(p, t) {
  let v = p.log.length ? null : p.value;
  let prevT = 0;
  for (const [kind, val, at, tc] of p.log) {
    if (kind === 'target') {
      if (at > t) break;
      const from = v ?? 0;
      v = val + (from - val) * Math.exp(-(t - at) / tc);
      // Later events start from where the curve is at their time; approximate by chaining.
      prevT = at;
      continue;
    }
    if (at > t) {
      if (kind === 'lin' && v !== null) v += (val - v) * ((t - prevT) / (at - prevT || 1));
      break;
    }
    v = val;
    prevT = at;
  }
  return v ?? 0;
}

/** First gain node downstream of a source (its note envelope). */
function noteGain(src) {
  let n = [...src.outputs][0];
  while (n && !n.gain) n = [...n.outputs][0];
  return n;
}

function mixdown(ctx, from, to, sr) {
  const out = new Float32Array(Math.ceil((to - from) * sr));
  for (const s of ctx.sources) {
    if (!s.buffer || s.started === null || s.buffer.numberOfChannels !== 1) continue;
    const g = noteGain(s);
    if (!g) continue;
    const data = s.buffer.getChannelData(0);
    const step = s.playbackRate.value * s.buffer.sampleRate / sr;
    const end = Math.min(to, s.stopped ?? Infinity, s.loop ? Infinity : s.started + (data.length - s.offset * s.buffer.sampleRate) / (step * sr));
    let pos = s.offset * s.buffer.sampleRate;
    for (let t = s.started; t < end; t += 1 / sr) {
      if (!s.loop && pos >= data.length - 1) break;
      if (s.loop) pos %= data.length;
      const i = Math.floor(pos), f = pos - i;
      const x = data[i] + (data[(i + 1) % data.length] - data[i]) * f;
      const k = Math.round((t - from) * sr);
      if (k >= 0 && k < out.length) {
        const gv = g.gain.log.length ? paramAt(g.gain, t) : g.gain.value;
        out[k] += x * gv * Math.SQRT1_2; // one channel of the (equal-power) panned mix
      }
      pos += step;
    }
  }
  return out;
}

function musicRun(seed, script) {
  const ctx = new MockAudioContext(SR);
  const audio = createAudio({ context: ctx, manual: true, syncBake: true, clock: () => ctx.currentTime, musicSeed: seed });
  const eng = audio.debug.engine;
  return { ctx, audio, eng, ready: audio.unlock().then(() => script(ctx, audio, eng)) };
}

const player = { id: 1, x: 0, y: 0, angle: 0, state: 'alive', hp: 100, maxHp: 100, armor: 0, stamina: 100, slot: 0,
  slots: ['pistol', null, null], ammo: [[12, -1], [0, 0], [0, 0]], reloading: 0, spin: 0, firing: false, meleeing: 0, bleedout: 0 };
const gameView = (extra) => ({ tick: 1, phase: 'wave', wave: 3, totalWaves: 15, timer: 0, remaining: 40, bossHp: -1,
  players: [player], zombies: [], projectiles: [], pickups: [], turrets: [], barricades: [], hazards: [], events: [], ...extra });
const horde = (n) => Array.from({ length: n }, (_, i) => ({ id: i, type: 'walker', x: 400, y: i, angle: 0, hp: 1, flags: 0 }));

/** Drive a whole game: prep → wave → clear → boss wave → victory. Returns state change times. */
function playGame(ctx, audio) {
  const marks = [];
  let last = '';
  for (let f = 0; f < 3000; f++) {
    const t = f / 20;
    ctx.currentTime = t;
    let v, ev = null;
    if (f < 400) v = gameView({ phase: 'prep', timer: 20 - t });
    else if (f < 1400) {
      v = gameView({ zombies: horde(Math.min(45, Math.floor((t - 20) * 1.5))) });
      if (f === 400) ev = [{ type: 'wave', wave: 1, boss: false }];
    } else if (f < 1800) {
      v = gameView({ phase: 'intermission', timer: 100 - t }); // everyone ready early: calm into the boss
      if (f === 1400) ev = [{ type: 'waveclear', wave: 1 }];
    } else if (f < 2600) {
      v = gameView({ zombies: horde(40), bossHp: 0.7 });
      if (f === 1800) ev = [{ type: 'wave', wave: 5, boss: true }];
    } else {
      v = gameView({ phase: 'victory' });
      if (f === 2600) ev = [{ type: 'waveclear', wave: 5 }, { type: 'victory' }];
    }
    if (ev) audio.addEvents(ev, { x: 0, y: 0, localId: 1 });
    audio.update(v, { localId: 1, dt: 0.05 });
    const st = audio.stats().musicState;
    if (st !== last) marks.push([Math.round(t * 100) / 100, st]);
    last = st;
  }
  return marks;
}

test('a whole game walks the music through every state, with a triumphant cue on wave clear', async () => {
  const { eng, ready } = musicRun(11, (ctx, audio) => playGame(ctx, audio));
  const marks = await ready;
  const order = marks.map(([, s]) => s);
  for (const s of ['calm', 'tension', 'battle', 'waveclear', 'boss', 'victory', 'glory']) assert.ok(order.includes(s), `${s} missing from ${order.join(' → ')}`);
  assert.ok(order.indexOf('waveclear') < order.lastIndexOf('calm'), 'calm resumes after the wave-clear cue');
  // Changes wait for a beat or bar, never more than a bar or two late.
  const at = (s) => marks.find(([, x]) => x === s)[0];
  assert.ok(at('battle') >= 20 && at('battle') < 21, `battle starts at ${at('battle')}`);
  assert.ok(at('boss') >= 90 && at('boss') < 91.5, `boss starts at ${at('boss')}`);
  assert.ok(at('victory') >= 130 && at('victory') < 131, `victory starts at ${at('victory')}`);
  const hist = eng.music.history;
  assert.ok(order.indexOf('tension') < order.indexOf('battle'), 'the countdown builds tension before the first wave');
  assert.ok(hist.some((h) => h.phrase === 'KRISE'), 'calm → boss goes through the rising bars');
  const battle = hist.filter((h) => h.state === 'battle' && h.phrase !== 'RISE').map((h) => h.phrase);
  for (let i = 1; i < battle.length; i++) assert.notEqual(battle[i], battle[i - 1], 'no phrase twice in a row');
});

test('phrase order is seeded: the same seed replays exactly, another seed differs', async () => {
  const runs = [];
  for (const seed of [5, 5, 6]) {
    const r = musicRun(seed, (ctx, audio) => playGame(ctx, audio));
    await r.ready;
    // Only the score's notes: sound effects keep their own (unseeded) pitch jitter.
    const mine = new Set();
    for (const id of MUSIC_IDS) for (let v = 0; v < SOUNDS[id].v; v++) mine.add(r.eng.bank.variant(id, v));
    const notes = r.ctx.sources.filter((s) => mine.has(s.buffer));
    assert.ok(notes.length > 500, `${notes.length} notes`);
    runs.push({ hist: r.eng.music.history.map((h) => `${h.state}:${h.phrase}@${h.t.toFixed(3)}`), starts: notes.map((s) => s.started.toFixed(4) + ':' + s.playbackRate.value.toFixed(4)) });
  }
  assert.deepEqual(runs[0].hist, runs[1].hist);
  assert.deepEqual(runs[0].starts, runs[1].starts);
  assert.notDeepEqual(runs[0].hist, runs[2].hist);
});

test('dry mixdown of every state is finite, audible and below clipping; battle is louder than calm', async () => {
  const r = musicRun(9, (ctx, audio) => playGame(ctx, audio));
  const marks = await r.ready;
  // Game over and the lament, in a second game.
  const g = musicRun(9, (ctx, audio) => {
    for (let f = 0; f < 900; f++) {
      const t = f / 20;
      ctx.currentTime = t;
      if (f === 100) audio.addEvents([{ type: 'gameover' }], { x: 0, y: 0, localId: 1 });
      audio.update(gameView(t < 5 ? { zombies: horde(20) } : { phase: 'gameover' }), { localId: 1, dt: 0.05 });
    }
  });
  await g.ready;
  const level = {};
  const measure = (ctx, name, a, b) => {
    const buf = mixdown(ctx, a, b, SR);
    for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) assert.fail(`${name}: non-finite sample`);
    const p = peak(buf);
    level[name] = { rms: rms(buf), peak: p };
    assert.ok(p < 0.95, `${name} peaks at ${p.toFixed(3)}`);
    assert.ok(rms(buf) > 0.02, `${name} is (nearly) silent: rms ${rms(buf).toFixed(4)}`);
  };
  const span = (s) => {
    const i = marks.findIndex(([, x]) => x === s);
    return [marks[i][0], i + 1 < marks.length ? marks[i + 1][0] : 150];
  };
  for (const s of ['calm', 'battle', 'waveclear', 'boss', 'victory', 'glory']) {
    const [a, b] = span(s);
    measure(r.ctx, s, a + 0.5, Math.min(b, a + 25));
  }
  measure(g.ctx, 'gameover', 6, 20);
  measure(g.ctx, 'lament', 24, 45);
  assert.ok(level.battle.rms > level.calm.rms * 1.3, `battle ${level.battle.rms} vs calm ${level.calm.rms}`);
  assert.ok(level.boss.rms > level.calm.rms * 1.3, 'boss is bigger than calm');
});

test('music ducks under heavy fire and keeps following the volume setting', async () => {
  const ctx = new MockAudioContext(SR);
  const audio = createAudio({ context: ctx, manual: true, syncBake: true, clock: () => ctx.currentTime });
  await audio.unlock();
  const eng = audio.debug.engine;
  const duckValues = [];
  const orig = eng.music.duck;
  eng.music.duck = (v, now) => {
    duckValues.push(v);
    return orig(v, now);
  };
  for (let i = 0; i < 20; i++) eng.play('expl_frag', { local: true, lim: null });
  audio.update(gameView({}), { localId: 1, dt: 0.05 });
  assert.ok(Math.min(...duckValues) < 0.8 && Math.min(...duckValues) >= 0.69, `ducked to ${Math.min(...duckValues)}`);
  audio.setVolume({ music: 0 });
  assert.equal(eng.musicDry.gain.value, 0);
});
