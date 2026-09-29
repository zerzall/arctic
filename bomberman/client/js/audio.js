// audio.js - Blast Party's synthesizer: every sound effect and every music track is generated here, no audio files (docs/SPEC.md 8.5).
//
//   import { audio } from './audio.js';
//   audio.unlock();                        // once, at boot: arms the first-gesture unlock. Nothing is created before a tap.
//   audio.play('explode', { pan: -0.4 });  // pan -1..1 (arena x), vol 0..2, rate 0.25..4 (pitch multiplier). Returns whether it sounded.
//   audio.music('battle');                 // 'menu' | 'battle' | 'battle_fast' | 'victory' | null. Remembered until the context runs.
//   audio.setVolume(0.8); audio.setMuted(true); audio.volume; audio.muted       // both persisted in localStorage ('bp.audio')
//   audio.duck(400);                       // dips the music for 400 ms (big explosions, deaths and fanfares do it themselves)
//   audio.supported; audio.state           // Web Audio present? 'unsupported' | 'locked' | 'running' | 'suspended' | 'interrupted'
//
// Nothing here ever throws to the caller and everything is a no-op without Web Audio, so UI clicks never depend on sound.
//
// STRUCTURE (so the same code can render into an OfflineAudioContext, see scripts/dev/audio/):
//   Engine       owns one BaseAudioContext: master chain, SFX and music buses, voice limiting, cooldowns, the music Conductor.
//                No timers, no DOM, no storage: `new Engine(ctx)` then `engine.play(name, opts, when)` and
//                `engine.music.start(name)` + `engine.music.pump(untilTime)` work on any context, live or offline.
//   createAudio  the browser facade: lazy context, iOS-safe unlock, visibility handling, persistence, the 25 ms look-ahead timer.
//
// GRAPH   voice -> [pan] -> sfx bus ----------------------\
//         voice -> reverb send -> convolver -> sfx bus     >-> master gain (user volume) -> compressor -> soft clip -> speakers
//         run -> duck gain -> music bus (fixed level) -----/
// The compressor is a safety net for stacked chaos (it is set high, so a single explosion never touches it); the soft clip after it
// makes "the output never exceeds 0.93" a property of the graph instead of a hope.
//
// DEVIATIONS / READINGS OF THE SPEC (also in the engineer's report)
//  * "<= 18 % master gain by default" is read as a cap on the MUSIC's default loudness: with the default volume the music peaks at
//    about 0.18 of full scale, well under the effects. `volume` is the user's 0..1 slider (default 0.8) and maps to gain by volume^2.
//  * unlock() only arms the gesture listeners; the AudioContext is created inside the first real gesture (creating one at boot logs a
//    console warning and stays suspended anyway).
//  * Extras beyond the interface: duck(ms), supported, state, and the exported Engine / compileTrack / name lists used by the tests.

// ---------------------------------------------------------------------------------------------------------------------------------
// Constants

const STORAGE_KEY = 'bp.audio';
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];   // NOT touchstart / pointerdown: iOS does not treat them as unlock gestures
export const DEFAULT_VOLUME = 0.8;
const MASTER_TAPER = 2;            // gain = volume ^ 2: the low half of the slider stays usable
const MUSIC_LEVEL = 0.245;          // music bus gain; with the default volume the music peaks at ~0.18 (see DEVIATIONS)
export const MAX_VOICES = 24;             // concurrent sound effects; the lowest-priority, oldest one is stolen for a more important newcomer
export const LOOKAHEAD_S = 1.2;           // the sequencer schedules this far ahead so a throttled or busy main thread never starves the music
export const PUMP_MS = 25;
const START_LEAD_S = 0.005;        // a live sound starts a hair in the future, never in the past
const STEPS_PER_BAR = 16;
const FADE_FIRST_S = 0.12;         // music that starts from silence keeps its downbeat; a track change crossfades
const FADE_CROSS_S = 0.6;
const FLOOR = 1e-4;                // -80 dB: exponential ramps cannot reach 0
const TAIL_S = 0.05;               // sources outlive their envelope by this much, so a click never rides the stop
const NOISE_SECONDS = 1.5;

export const SOUND_NAMES = Object.freeze([
  'place', 'explode', 'block', 'pickup', 'pickup_bad', 'kick', 'throw', 'land', 'death', 'shield', 'curse', 'countdown', 'go',
  'win_round', 'win_match', 'lose_match', 'sudden_death', 'warning', 'click', 'join', 'leave', 'emote', 'chat', 'error',
]);
export const MUSIC_NAMES = Object.freeze(['menu', 'battle', 'battle_fast', 'victory']);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const gainForVolume = (volume) => volume ** MASTER_TAPER;

// ---------------------------------------------------------------------------------------------------------------------------------
// Notes and chords

const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' -> 60, 'Bb3' -> 58, 'F#5' -> 78. NaN for anything else. */
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return NaN;
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const mtof = (midi) => 440 * 2 ** ((midi - 69) / 12);
const hz = (name) => mtof(noteToMidi(name));

const CHORD_QUALITY = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus: [0, 5, 7] };
const mod12 = (n) => ((n % 12) + 12) % 12;

function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const intervals = m && CHORD_QUALITY[m[2]];
  if (!intervals) throw new Error(`audio: unknown chord "${name}"`);
  return { name, pc: mod12(noteToMidi(`${m[1]}0`)), intervals };
}
/** Chord tone `i` counted upwards from `base` (a triad's tones 3..5 are the same notes an octave higher). */
const chordTone = (chord, base, i) => base + chord.intervals[i % chord.intervals.length] + 12 * Math.floor(i / chord.intervals.length);
// Bass roots sit in E2..D#3 (a C is C3, an F is F2) so the line moves by steps, and arpeggios sit in G3..F#4 upwards.
const bassRoot = (chord) => 40 + mod12(chord.pc - 40);
const arpBase = (chord) => 55 + mod12(chord.pc - 55);

// ---------------------------------------------------------------------------------------------------------------------------------
// Shared, lazily built audio resources

const PULSE_DUTY = { pulse25: 0.25, pulse12: 0.125 };   // NES-style pulse waves; the native 'square' is the 50 % one

/** Soft ceiling: transparent up to 0.8, then eases toward 0.93 and stays there for any input. */
const SOFT_CLIP = (() => {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.15 * Math.tanh((a - 0.8) / 0.15));
  }
  return curve;
})();
/** Drive for the explosion: tanh saturation, normalised so a full-scale input stays a full-scale output. */
const SATURATE = (() => {
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(3 * ((i / (curve.length - 1)) * 2 - 1)) / Math.tanh(3);
  return curve;
})();

/** Deterministic noise (xorshift32), so a render is reproducible; the per-play start offset is what varies. */
function noiseBuffer(ctx, kind) {
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = kind === 'brown' ? 0x2545f491 : 0x9e3779b9;
  const white = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 2147483648 - 1; };
  if (kind === 'brown') {
    let last = 0, peak = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.03 * white()) / 1.03; d[i] = last; peak = Math.max(peak, Math.abs(last)); }
    const fade = 2048;   // brown noise wanders, so the loop seam is cross-faded instead of clicking
    for (let i = 0; i < fade; i++) { const k = i / fade; d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k; }
    for (let i = 0; i < n; i++) d[i] /= peak;
  } else {
    for (let i = 0; i < n; i++) d[i] = white();
  }
  return buf;
}

/** A pulse wave of the given duty cycle as a band-limited PeriodicWave (zero mean; the Fourier series of a +-1 pulse). */
function pulseWave(ctx, duty) {
  const N = 48, real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) {
    real[k] = (2 * Math.sin(2 * Math.PI * k * duty)) / (Math.PI * k);
    imag[k] = (2 * (1 - Math.cos(2 * Math.PI * k * duty))) / (Math.PI * k);
  }
  return ctx.createPeriodicWave(real, imag);
}

/** A short, dark stereo room: decaying noise whose highs die first. Only shimmer, fanfares and the eerie sounds send to it. */
function roomImpulse(ctx) {
  const rate = ctx.sampleRate, len = Math.floor(rate * 1.1);
  const buf = ctx.createBuffer(2, len, rate);
  let s = 0x1234abcd;
  const white = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 2147483648 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += (white() - lp) * (0.65 - 0.5 * k);
      d[i] = lp * (1 - k) ** 3;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Synth primitives. `v` is a "sink": a Voice (sound effect) or a music part. It provides ctx, engine, dest (the node layers connect
// to), rate (pitch multiplier), random() and keep(source, endTime). `t` is always an absolute context time.

const filt = (type) => (f, to, q, glide) => ({ type, f, to, q, glide });
const lp = filt('lowpass'), hp = filt('highpass'), bp = filt('bandpass');

function filterNode(v, t, input, spec, dur) {
  if (!spec) return input;
  const ctx = v.ctx, f = ctx.createBiquadFilter(), top = ctx.sampleRate * 0.45;
  f.type = spec.type;
  f.Q.value = spec.q ?? 0.7;
  f.frequency.setValueAtTime(Math.min(spec.f * v.rate, top), t);
  if (spec.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.min(spec.to * v.rate, top), t + (spec.glide ?? dur));
  input.connect(f);
  return f;
}

/** Attack, then either an exponential decay ('exp': plucks and hits) or a sustain with a linear release ('flat': held notes). */
function envelope(param, t, dur, { vol = 1, atk = 0.004, shape = 'exp', rel = 0.04, sus, dec = 0.15 }) {
  const end = t + dur, a = Math.min(atk, dur);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(vol, t + a);
  if (shape === 'exp') { param.exponentialRampToValueAtTime(FLOOR, end); return; }
  const hold = Math.max(t + a, end - rel);
  let level = vol;
  if (sus !== undefined) {
    level = vol * sus;
    param.linearRampToValueAtTime(level, Math.min(t + a + dec, hold));
  }
  param.setValueAtTime(level, hold);
  param.linearRampToValueAtTime(0, end);
}

/** A sine LFO added to an AudioParam; `delay` lets a held note sing straight before the vibrato sets in. */
function lfo(v, t, end, target, rate, depth, delay = 0) {
  const ctx = v.ctx, osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.frequency.value = rate;
  if (delay > 0) {
    amp.gain.setValueAtTime(0, t);
    amp.gain.setValueAtTime(0, t + delay);
    amp.gain.linearRampToValueAtTime(depth, t + delay + 0.15);
  } else {
    amp.gain.value = depth;
  }
  osc.connect(amp);
  amp.connect(target);
  osc.start(t);
  osc.stop(end);
  v.keep(osc, end);
}

/**
 * One oscillator through an optional filter and envelope.
 * o: wave, f (Hz), to + glide (exponential pitch glide over `glide` s, default the whole note), freqs [[dt, Hz]...] (soft steps),
 *    detune (cents), vib {rate, depth (cents), delay}, trem {rate, depth 0..1}, filter (lp/hp/bp), dur, vol, atk, shape, rel, sus, dec.
 */
function tone(v, t, o) {
  const ctx = v.ctx, end = t + o.dur + TAIL_S, osc = ctx.createOscillator();
  if (PULSE_DUTY[o.wave]) osc.setPeriodicWave(v.engine.wave(o.wave));
  else osc.type = o.wave;
  osc.frequency.setValueAtTime(o.f * v.rate, t);
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(o.to * v.rate, t + (o.glide ?? o.dur));
  if (o.freqs) for (const [dt, f] of o.freqs) osc.frequency.setTargetAtTime(f * v.rate, t + dt, 0.01);
  if (o.detune) osc.detune.value = o.detune;
  if (o.vib) lfo(v, t, end, osc.detune, o.vib.rate, o.vib.depth, o.vib.delay);
  let node = osc;
  if (o.trem) {
    const tg = ctx.createGain();
    tg.gain.value = 1 - o.trem.depth / 2;
    lfo(v, t, end, tg.gain, o.trem.rate, o.trem.depth / 2);
    node.connect(tg);
    node = tg;
  }
  node = filterNode(v, t, node, o.filter, o.dur);
  const g = ctx.createGain();
  envelope(g.gain, t, o.dur, o);
  node.connect(g);
  g.connect(v.dest);
  osc.start(t);
  osc.stop(end);
  v.keep(osc, end);
}

/** Looped noise from the shared buffer, started at a random offset so no two hits are the same. o: color 'white'|'brown', filter, dur, vol, atk, shape, rel. */
function noise(v, t, o) {
  const src = noiseSource(v, t, t + o.dur + TAIL_S, o.color);
  const g = v.ctx.createGain();
  envelope(g.gain, t, o.dur, o);
  filterNode(v, t, src, o.filter, o.dur).connect(g);
  g.connect(v.dest);
}

function noiseSource(v, t, end, color = 'white') {
  const src = v.ctx.createBufferSource(), buf = v.engine.noise(color);
  src.buffer = buf;
  src.loop = true;
  src.start(t, v.random() * (buf.duration - 0.05));
  src.stop(end);
  v.keep(src, end);
  return src;
}

/**
 * A train of tiny pops (burning debris, splintering crate) from ONE noise source: only the gain and the band-pass centre are
 * automated per pop, which is far cheaper than a node per pop. Pops thin out over `span` seconds and never overlap.
 */
function crackle(v, t, { count, span, vol, lo = 1400, hi = 5200 }) {
  const ctx = v.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  g.gain.value = 0;
  let at = t;
  for (let i = 0; i < count; i++) {
    const k = i / count;
    at += Math.max(0.03, (span / count) * (0.5 + 1.1 * k) * (0.6 + 0.8 * v.random()));
    f.frequency.setValueAtTime((lo + (hi - lo) * v.random()) * v.rate, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol * (1 - 0.75 * k) * (0.5 + 0.5 * v.random()), at + 0.002);
    g.gain.exponentialRampToValueAtTime(FLOOR, at + 0.012 + 0.012 * v.random());
  }
  noiseSource(v, t, at + 0.03 + TAIL_S).connect(f);
  f.connect(g);
  g.connect(v.dest);
}

/** [[note, startOffset, duration, extraOptions?]...] as one instrument. */
function phrase(v, t, notes, o) {
  for (const [name, at, dur, extra] of notes) tone(v, t + at, { f: hz(name), dur, ...o, ...extra });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sound effects. Fields: pri (voice-steal priority), vol (final level), gap (min seconds between two starts of this sound), spread
// (how far a too-early repeat may be pushed back to keep the gap before it is dropped instead), window + falloff (each repeat inside the
// window is quieter and gets a higher `chain` index), jitter (random pitch +-), wet (reverb send), duck [level, hold s] for the music.

const SFX = {
  place: {
    pri: 2, vol: 1.0, gap: 0.05, jitter: 0.04,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 230, to: 470, glide: 0.07, dur: 0.17, vol: 0.9, atk: 0.004 });                                  // soft bloop
      tone(v, t + 0.055, { wave: 'pulse25', f: 700, to: 1400, glide: 0.06, dur: 0.12, vol: 0.3, atk: 0.003, filter: lp(3600) });    // rising blip
    },
  },

  explode: {
    pri: 4, vol: 0.64, gap: 0.045, spread: 0.15, window: 0.25, falloff: 0.72, jitter: 0.06, duck: [0.45, 0.32],
    // The first blast of a chain is the full layered boom; the ones that follow within the window are smaller, so 8 bombs make a rolling
    // rumble instead of a wall of noise.
    build(v, t, chain) {
      const big = chain === 0;
      v.saturate();   // grit, and it keeps the layered sum inside +-1
      tone(v, t, { wave: 'sine', f: big ? 150 : 125, to: 38, glide: 0.28, dur: big ? 0.6 : 0.36, vol: big ? 1 : 0.7, atk: 0.002 });   // thump
      tone(v, t, { wave: 'triangle', f: 330, to: 70, glide: 0.18, dur: 0.3, vol: 0.5, atk: 0.002 });   // phone speakers cannot play the sub, they hear this
      noise(v, t, { dur: 0.05, vol: 0.5, atk: 0.001, filter: hp(1400) });                              // crack
      noise(v, t, { dur: big ? 0.65 : 0.4, vol: 0.85, atk: 0.003, filter: lp(5200, 240, 0.8, big ? 0.55 : 0.35) });   // body
      noise(v, t, { color: 'brown', dur: big ? 1 : 0.55, vol: 0.9, atk: 0.008, filter: lp(240, 80) });  // rumble
      crackle(v, t + 0.1, { count: big ? 14 : 6, span: big ? 0.75 : 0.35, vol: 0.3 });                  // debris tail
    },
  },

  block: {
    pri: 2, vol: 1.45, gap: 0.03, spread: 0.1, window: 0.3, falloff: 0.8, jitter: 0.08,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 190, to: 95, glide: 0.09, dur: 0.16, vol: 0.5, atk: 0.002 });
      noise(v, t, { dur: 0.1, vol: 0.5, atk: 0.002, filter: bp(1300, 650, 0.9) });
      crackle(v, t + 0.02, { count: 8, span: 0.22, vol: 0.4, lo: 600, hi: 2800 });                       // chunks falling
    },
  },

  pickup: {
    pri: 3, vol: 1.3, gap: 0.06, wet: 0.3,
    build(v, t) {
      phrase(v, t, [['C5', 0, 0.11], ['E5', 0.05, 0.11], ['G5', 0.1, 0.11], ['C6', 0.15, 0.34]], { wave: 'pulse25', vol: 0.4, atk: 0.002, filter: lp(5000) });
      tone(v, t + 0.15, { wave: 'triangle', f: hz('C7'), dur: 0.3, vol: 0.1, atk: 0.004 });
    },
  },

  pickup_bad: {
    pri: 3, vol: 0.6, gap: 0.1, jitter: 0.03,
    build(v, t) {
      const slide = { f: 420, to: 140, glide: 0.44, dur: 0.52, shape: 'flat', atk: 0.01, rel: 0.12, vib: { rate: 8.5, depth: 55 } };
      tone(v, t, { ...slide, wave: 'sawtooth', vol: 0.42, filter: lp(1600, 380, 2.5, 0.44) });
      tone(v, t, { ...slide, wave: 'square', detune: -38, vol: 0.2, filter: lp(1000, 300, 1, 0.44) });   // the beating makes it sour
    },
  },

  kick: {
    pri: 2, vol: 1.25, gap: 0.08, jitter: 0.05,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 300, to: 100, glide: 0.07, dur: 0.14, vol: 0.7, atk: 0.001 });
      noise(v, t, { dur: 0.05, vol: 0.7, atk: 0.001, filter: bp(1500, undefined, 1.2) });                 // thwack
      tone(v, t + 0.004, { wave: 'triangle', f: 520, to: 330, glide: 0.05, dur: 0.08, vol: 0.3, atk: 0.002 });
    },
  },

  throw: {
    pri: 2, vol: 1.5, gap: 0.1, jitter: 0.06,
    build(v, t) {
      noise(v, t, { dur: 0.36, vol: 0.55, shape: 'flat', atk: 0.13, rel: 0.2, filter: bp(380, 2600, 2.2, 0.3) });   // whoosh
      tone(v, t, { wave: 'sine', f: 280, to: 640, glide: 0.25, dur: 0.3, vol: 0.14, shape: 'flat', atk: 0.1, rel: 0.15 });
    },
  },

  land: {
    pri: 2, vol: 0.9, gap: 0.06, jitter: 0.06,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 170, to: 60, glide: 0.12, dur: 0.24, vol: 0.8, atk: 0.002 });
      tone(v, t, { wave: 'triangle', f: 320, to: 130, glide: 0.08, dur: 0.14, vol: 0.45, atk: 0.002 });    // the part a phone speaker plays
      noise(v, t, { dur: 0.09, vol: 0.45, atk: 0.002, filter: lp(1400, 400) });                            // dust
      noise(v, t, { dur: 0.02, vol: 0.3, atk: 0.001, filter: bp(2600, undefined, 2) });                    // clack
    },
  },

  death: {
    pri: 4, vol: 1.25, gap: 0.12, spread: 0.3, window: 0.6, falloff: 0.75, jitter: 0.04, duck: [0.4, 0.6],
    // A pop, then a sad-trombone "wah wah wah waaah" whose wah filter opens on every note.
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 900, to: 260, glide: 0.05, dur: 0.09, vol: 0.5, atk: 0.002 });
      noise(v, t, { dur: 0.04, vol: 0.4, atk: 0.001, filter: hp(2000) });
      for (const detune of [0, 9]) {
        phrase(v, t + 0.09, [['Eb4', 0, 0.15], ['D4', 0.17, 0.15], ['Db4', 0.34, 0.15]],
          { wave: 'sawtooth', detune, vol: 0.17, shape: 'flat', atk: 0.015, rel: 0.05, filter: lp(380, 1700, 5, 0.09) });
        tone(v, t + 0.6, { wave: 'sawtooth', detune, f: hz('C4'), to: hz('C4') * 0.78, glide: 0.5, dur: 0.55, vol: 0.17, shape: 'flat', atk: 0.02, rel: 0.2,
          filter: lp(420, 1500, 5, 0.3), vib: { rate: 6, depth: 35, delay: 0.15 } });
      }
    },
  },

  shield: {
    pri: 2, vol: 1.2, gap: 0.09, wet: 0.5, jitter: 0.02,
    build(v, t) {
      [hz('E5'), hz('A5'), hz('E6')].forEach((f, i) => tone(v, t + i * 0.03, { wave: 'sine', f, dur: 0.5, vol: 0.18, atk: 0.004, trem: { rate: 13, depth: 0.6 } }));
      tone(v, t, { wave: 'sine', f: 500, to: 1900, glide: 0.12, dur: 0.16, vol: 0.22, atk: 0.004 });
      noise(v, t, { dur: 0.3, vol: 0.08, shape: 'flat', atk: 0.05, rel: 0.2, filter: bp(3200, undefined, 1.5) });
    },
  },

  curse: {
    pri: 3, vol: 0.6, gap: 0.2, wet: 0.5, duck: [0.6, 0.6],
    // Two saws a semitone apart beat against each other under a wobbling ghost note, then a low boom.
    build(v, t) {
      const drone = { wave: 'sawtooth', dur: 0.95, vol: 0.2, shape: 'flat', atk: 0.12, rel: 0.35, filter: lp(900, 300, 3), vib: { rate: 5, depth: 30 } };
      tone(v, t, { ...drone, f: hz('Bb3'), to: hz('A3'), glide: 0.9 });
      tone(v, t, { ...drone, f: hz('B3'), to: hz('Ab3'), glide: 0.9 });
      tone(v, t, { wave: 'sine', f: 880, to: 620, glide: 0.8, dur: 0.9, vol: 0.12, shape: 'flat', atk: 0.2, rel: 0.3, vib: { rate: 6, depth: 70 } });
      noise(v, t, { dur: 0.7, vol: 0.18, shape: 'flat', atk: 0.5, rel: 0.15, filter: bp(1200, 500, 4, 0.7) });   // reversed-cymbal swell
      tone(v, t + 0.55, { wave: 'sine', f: 90, to: 40, glide: 0.4, dur: 0.5, vol: 0.5, atk: 0.01 });
    },
  },

  countdown: {
    pri: 3, vol: 0.6, gap: 0.2,
    build(v, t) {
      tone(v, t, { wave: 'square', f: hz('E5'), dur: 0.14, vol: 0.42, shape: 'flat', atk: 0.003, rel: 0.05, filter: lp(3200) });
      tone(v, t, { wave: 'sine', f: hz('E4'), dur: 0.14, vol: 0.3, shape: 'flat', atk: 0.003, rel: 0.05 });
    },
  },

  go: {
    pri: 4, vol: 0.75, gap: 0.3, wet: 0.35, duck: [0.5, 0.8],
    build(v, t) {
      phrase(v, t, [['C5', 0, 0.6], ['E5', 0, 0.6], ['G5', 0, 0.6], ['C6', 0, 0.6]], { wave: 'pulse25', vol: 0.26, shape: 'flat', atk: 0.004, rel: 0.3 });
      tone(v, t, { wave: 'sine', f: hz('G6'), dur: 0.5, vol: 0.12, atk: 0.004 });
      tone(v, t, { wave: 'sine', f: 700, to: 2100, glide: 0.07, dur: 0.1, vol: 0.2, atk: 0.002 });
      noise(v, t, { dur: 0.09, vol: 0.4, atk: 0.001, filter: bp(1800, undefined, 0.9) });                   // clap
    },
  },

  win_round: {
    pri: 4, vol: 0.56, gap: 0.5, wet: 0.35, duck: [0.3, 1.2],
    build(v, t) {
      phrase(v, t, [['E5', 0, 0.09], ['E5', 0.11, 0.09], ['E5', 0.22, 0.09], ['G5', 0.33, 0.28], ['E5', 0.68, 0.1], ['G5', 0.8, 0.1]],
        { wave: 'pulse25', vol: 0.36, shape: 'flat', atk: 0.003, rel: 0.03, filter: lp(4800) });
      tone(v, t + 0.92, { wave: 'pulse25', f: hz('C6'), dur: 0.6, vol: 0.36, shape: 'flat', atk: 0.004, rel: 0.25, filter: lp(4800), vib: { rate: 5.5, depth: 14, delay: 0.15 } });
      phrase(v, t, [['C3', 0.33, 0.3], ['G2', 0.68, 0.22], ['C3', 0.92, 0.6]], { wave: 'triangle', vol: 0.5, shape: 'flat', atk: 0.004, rel: 0.08 });
      phrase(v, t + 0.92, [['C4', 0, 0.55], ['E4', 0, 0.55], ['G4', 0, 0.55]], { wave: 'square', vol: 0.1, shape: 'flat', atk: 0.006, rel: 0.25, filter: lp(2400) });
      noise(v, t + 0.92, { dur: 0.6, vol: 0.12, atk: 0.002, filter: hp(5000) });
    },
  },

  win_match: {
    pri: 4, vol: 0.6, gap: 0.5, wet: 0.4, duck: [0.25, 2.8],
    build(v, t) {
      for (let i = 0; i < 10; i++) noise(v, t + i * 0.05, { dur: 0.06, vol: 0.12 + i * 0.03, atk: 0.002, filter: bp(300, undefined, 1) });   // drum roll
      phrase(v, t, [['C5', 0.5, 0.1], ['E5', 0.56, 0.1], ['G5', 0.62, 0.1], ['C6', 0.68, 0.1], ['E6', 0.74, 0.14]], { wave: 'pulse25', vol: 0.3, atk: 0.002, filter: lp(5200) });
      phrase(v, t, [['C6', 0.9, 0.3], ['B5', 1.22, 0.1], ['A5', 1.34, 0.1], ['G5', 1.46, 0.3], ['E5', 1.8, 0.15], ['G5', 1.98, 0.15]],
        { wave: 'pulse25', vol: 0.36, shape: 'flat', atk: 0.003, rel: 0.04, filter: lp(4800) });
      phrase(v, t, [['A5', 0.9, 0.3], ['G5', 1.22, 0.1], ['F5', 1.34, 0.1], ['E5', 1.46, 0.3], ['C5', 1.8, 0.15], ['E5', 1.98, 0.15]],
        { wave: 'square', vol: 0.14, shape: 'flat', atk: 0.003, rel: 0.04, filter: lp(2600) });
      tone(v, t + 2.16, { wave: 'pulse25', f: hz('C6'), dur: 0.95, vol: 0.36, shape: 'flat', atk: 0.004, rel: 0.4, filter: lp(4800), vib: { rate: 5.5, depth: 16, delay: 0.2 } });
      tone(v, t + 2.16, { wave: 'square', f: hz('G5'), dur: 0.95, vol: 0.14, shape: 'flat', atk: 0.004, rel: 0.4, filter: lp(2600) });
      phrase(v, t, [['C3', 0.9, 0.55], ['F3', 1.46, 0.3], ['G3', 1.8, 0.3], ['C3', 2.16, 0.95]], { wave: 'triangle', vol: 0.5, shape: 'flat', atk: 0.004, rel: 0.1 });
      noise(v, t + 2.16, { dur: 1, vol: 0.14, atk: 0.002, filter: hp(4500) });
      tone(v, t + 2.2, { wave: 'sine', f: hz('C7'), dur: 0.9, vol: 0.1, atk: 0.01, trem: { rate: 9, depth: 0.5 } });
    },
  },

  lose_match: {
    pri: 4, vol: 0.62, gap: 0.5, wet: 0.35, duck: [0.3, 1.6],
    // Gently sad, not harsh: a falling line that sighs on the last note.
    build(v, t) {
      const line = [['A4', 0, 0.3], ['G4', 0.32, 0.3], ['E4', 0.64, 0.3], ['D4', 0.96, 0.2]];
      phrase(v, t, line, { wave: 'triangle', vol: 0.42, shape: 'flat', atk: 0.01, rel: 0.08 });
      phrase(v, t, line, { wave: 'square', vol: 0.1, shape: 'flat', atk: 0.01, rel: 0.08, filter: lp(1800) });
      tone(v, t + 1.18, { wave: 'triangle', f: hz('C4'), to: hz('C4') * 0.9, glide: 0.7, dur: 0.75, vol: 0.42, shape: 'flat', atk: 0.02, rel: 0.3, vib: { rate: 5, depth: 25, delay: 0.1 } });
      tone(v, t + 1.18, { wave: 'square', f: hz('C4'), to: hz('C4') * 0.9, glide: 0.7, dur: 0.75, vol: 0.1, shape: 'flat', atk: 0.02, rel: 0.3, filter: lp(1800) });
      tone(v, t, { wave: 'triangle', f: hz('A2'), dur: 1.9, vol: 0.3, shape: 'flat', atk: 0.02, rel: 0.5 });
    },
  },

  sudden_death: {
    pri: 4, vol: 0.53, gap: 0.5, wet: 0.3, duck: [0.35, 1.6],
    // A two-tone siren that swells for 1.4 s over a rising rumble and lands on an impact.
    build(v, t) {
      const freqs = [];
      for (let i = 1; i < 7; i++) freqs.push([i * 0.24, i % 2 ? 780 : 520]);
      tone(v, t, { wave: 'sawtooth', f: 520, freqs, dur: 1.75, vol: 0.36, shape: 'flat', atk: 1.3, rel: 0.4, filter: lp(2400, undefined, 2) });
      tone(v, t, { wave: 'square', f: 260, freqs: freqs.map(([dt, f]) => [dt, f / 2]), dur: 1.75, vol: 0.18, shape: 'flat', atk: 1.3, rel: 0.4, filter: lp(1200) });
      noise(v, t, { color: 'brown', dur: 1.5, vol: 0.8, shape: 'flat', atk: 1.4, rel: 0.1, filter: lp(120, 900, 1, 1.4) });
      tone(v, t + 1.5, { wave: 'sine', f: 100, to: 36, glide: 0.4, dur: 0.6, vol: 0.9, atk: 0.002 });
      noise(v, t + 1.5, { dur: 0.5, vol: 0.6, atk: 0.002, filter: lp(3500, 200, 0.8, 0.45) });
    },
  },

  warning: {
    pri: 3, vol: 1.25, gap: 0.3,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 1800, to: 1500, glide: 0.02, dur: 0.06, vol: 0.5, atk: 0.001 });
      noise(v, t, { dur: 0.015, vol: 0.25, atk: 0.0005, filter: bp(4000, undefined, 2) });
    },
  },

  click: {
    pri: 1, vol: 0.8, gap: 0.03, jitter: 0.03,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 950, to: 620, glide: 0.03, dur: 0.05, vol: 0.5, atk: 0.001 });
      noise(v, t, { dur: 0.012, vol: 0.2, atk: 0.0005, filter: hp(3000) });
    },
  },

  join: {
    pri: 2, vol: 1.1, gap: 0.12, wet: 0.2,
    build(v, t) {
      phrase(v, t, [['G5', 0, 0.1], ['C6', 0.08, 0.22]], { wave: 'pulse25', vol: 0.38, atk: 0.003, filter: lp(4400) });
      phrase(v, t, [['G6', 0, 0.1], ['C7', 0.08, 0.22]], { wave: 'triangle', vol: 0.08, atk: 0.003 });
    },
  },

  leave: {
    pri: 2, vol: 1.4, gap: 0.12,
    build(v, t) {
      phrase(v, t, [['C6', 0, 0.1], ['G5', 0.08, 0.22]], { wave: 'pulse25', vol: 0.3, atk: 0.003, filter: lp(3000) });
    },
  },

  emote: {
    pri: 2, vol: 1.0, gap: 0.1, jitter: 0.06,
    build(v, t) {
      tone(v, t, { wave: 'sine', f: 620, to: 980, glide: 0.05, dur: 0.09, vol: 0.5, atk: 0.003 });
      tone(v, t + 0.075, { wave: 'sine', f: 1000, to: 800, glide: 0.1, dur: 0.12, vol: 0.45, atk: 0.003, vib: { rate: 14, depth: 40 } });
    },
  },

  chat: {
    pri: 1, vol: 1.25, gap: 0.08, jitter: 0.03,
    build(v, t) {
      phrase(v, t, [['C6', 0, 0.07], ['E6', 0.06, 0.1]], { wave: 'triangle', vol: 0.4, atk: 0.003, filter: lp(4000) });
    },
  },

  error: {
    pri: 2, vol: 0.85, gap: 0.15,
    build(v, t) {
      phrase(v, t, [['G3', 0, 0.1], ['E3', 0.12, 0.14]], { wave: 'square', vol: 0.35, shape: 'flat', atk: 0.003, rel: 0.04, filter: lp(900) });
      noise(v, t, { dur: 0.02, vol: 0.15, atk: 0.001, filter: bp(700, undefined, 1) });
    },
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Music data. Each part is rows of 16 sixteenth-note tokens per bar (`|` is only a visual beat separator), cycled over the bars:
//   notes  'E5' starts a note, '-' holds it, '.' rests          bass   r root, o root+octave, 5 fifth, 3 third (chord-relative)
//   arp    chord-tone indices '0'..'7' (a triad wraps to the next octave)                   chord  'x' hits the whole chord, '-' holds it
//   drum   X accent, x hit, o ghost, '.' none (no spaces needed)
// Everything is in C: the menu is C major with sevenths, the battle theme cycles C - Bb - F - G (bright, mixolydian) and then Am - F - C - G.

const BATTLE_CHORDS = 'C Bb F G C Bb F G Am F C G Am F G G7';
const BATTLE_LEAD = [
  'E5 - . E5 | G5 - . E5 | C6 - - G5 | E5 - . .',
  'D5 - . D5 | F5 - . D5 | Bb5 - - F5 | D5 - . .',
  'C5 - . C5 | F5 - . A5 | C6 - - A5 | F5 - . .',
  'D5 - . D5 | G5 - . B5 | D6 - B5 G5 | . . G5 B5',
  'C6 - . C6 | B5 - G5 - | E5 - G5 - | C6 - . .',
  'Bb5 - . Bb5 | G5 - F5 - | D5 - F5 - | Bb5 - . .',
  'A5 - . A5 | G5 - F5 - | C5 - F5 - | A5 - . .',
  'B5 - G5 - | D6 - B5 - | G5 - . . | . . E5 A5',
  'A5 - - C6 | - - B5 A5 | E5 - - - | . . . E5',
  'F5 - - A5 | - - C6 - | A5 - G5 F5 | . . . .',
  'G5 - - E5 | G5 - C6 - | E6 - D6 C6 | . . . .',
  'B5 - - G5 | D5 - G5 - | B5 - A5 G5 | . . D5 G5',
  'A5 - - C6 | - - E6 - | D6 - C6 B5 | A5 - . .',
  'A5 - - F5 | C6 - A5 - | F5 - G5 A5 | . . . .',
  'B5 - D6 - | G6 - - D6 | B5 - G5 - | D6 - . .',
  'G5 - B5 - | D6 - B5 - | F5 - D5 - | . . D5 E5',
];
const SPARSE_ARP = '0 . 1 . | 2 . 1 . | 0 . 1 . | 2 . 4 .';
const BUSY_ARP = '0 1 2 4 | 2 1 2 1 | 0 1 2 4 | 2 1 2 4';

const TRACKS = {
  menu: {
    bpm: 96, swing: 0.14,
    chords: 'Cmaj7 Am7 Dm7 G7 Cmaj7 Am7 Fmaj7 Gsus',
    parts: [
      { part: 'pad', inst: 'pad', kind: 'chord', gain: 0.7, rows: ['x - - - | - - - - | - - - - | - - - -'] },
      { part: 'bass', inst: 'bass', kind: 'bass', gain: 0.5, gate: 0.7, rows: ['r - . . | . . r - | . . 5 - | . . o .', 'r - . . | . r - . | 5 - . . | . o . 5'] },
      { part: 'melody', inst: 'pluck', kind: 'notes', gain: 2.1, pan: 0.15, rows: [
        'E5 - . . | G5 - . E5 | . . D5 - | C5 - . .',
        '. . E5 - | A5 - . G5 | . . E5 - | C5 - . .',
        '. . F5 - | A5 - . F5 | . . D5 - | A4 - . .',
        '. . D5 - | G5 - . F5 | . . D5 - | B4 - . .',
        '. E5 - G5 | - C6 - . | B5 - G5 - | E5 - . .',
        '. C6 - A5 | - E5 - . | G5 - E5 - | A5 - . .',
        '. A5 - C6 | - A5 - . | G5 - F5 - | E5 - . .',
        '. D6 - C6 | - G5 - . | D5 - G5 - | . . . .',
      ] },
      { part: 'comp', inst: 'stab', kind: 'chord', gain: 0.8, pan: -0.25, rows: ['. . x . | . . x . | . . x . | . . x .'] },
      { part: 'kick', inst: 'kick', kind: 'drum', gain: 0.42, rows: ['X...|..x.|..X.|....', 'X...|....|.xX.|....'] },
      { part: 'snare', inst: 'brush', kind: 'drum', gain: 0.9, rows: ['....|X...|....|X...'] },
      { part: 'hat', inst: 'hat', kind: 'drum', gain: 0.75, pan: 0.3, rows: ['x.o.|x.o.|x.o.|x.o.'] },
    ],
  },

  battle: {
    bpm: 140, swing: 0,
    chords: BATTLE_CHORDS,
    parts: [
      { part: 'lead', inst: 'lead', kind: 'notes', gain: 1.27, gate: 0.92, rows: BATTLE_LEAD },
      { part: 'arp', inst: 'arp', kind: 'arp', gain: 1.55, pan: -0.3, rows: [SPARSE_ARP, SPARSE_ARP, SPARSE_ARP, SPARSE_ARP, BUSY_ARP, BUSY_ARP, BUSY_ARP, BUSY_ARP,
        SPARSE_ARP, SPARSE_ARP, SPARSE_ARP, SPARSE_ARP, BUSY_ARP, BUSY_ARP, BUSY_ARP, BUSY_ARP] },
      { part: 'bass', inst: 'bass', kind: 'bass', gain: 0.44, gate: 0.75, rows: ['r - r - | o - r - | r - r - | o - 5 -', 'r - r - | o - r - | r - r - | o - 5 -',
        'r - r - | o - r - | r - r - | o - 5 -', 'r - r - | o - r - | 5 - 5 - | o - 3 -'] },
      { part: 'kick', inst: 'kick', kind: 'drum', gain: 0.48, rows: ['X...X...X...X...', 'X...X...X.x.X...'] },
      { part: 'snare', inst: 'snare', kind: 'drum', gain: 0.8, rows: ['....X.......X...', '....X.......X...', '....X.......X...', '....X.......xxXX'] },
      { part: 'hat', inst: 'hat', kind: 'drum', gain: 1.0, pan: 0.3, rows: ['x.X.x.X.x.X.x.X.', 'x.X.x.X.x.X.x.o.'] },
      { part: 'ohat', inst: 'ohat', kind: 'drum', gain: 0.9, pan: 0.3, rows: ['................', '..............x.'] },
    ],
  },

  // The same tune and chords, faster and denser: sixteenth bass, non-stop arpeggio and hats, a heartbeat of chord stabs and a brighter lead.
  battle_fast: {
    bpm: 172, swing: 0,
    chords: BATTLE_CHORDS,
    parts: [
      { part: 'lead', inst: 'lead2', kind: 'notes', gain: 2.0, gate: 0.85, rows: BATTLE_LEAD },
      { part: 'arp', inst: 'arp', kind: 'arp', gain: 2.1, pan: -0.3, rows: [BUSY_ARP] },
      { part: 'stab', inst: 'stab', kind: 'chord', gain: 1.2, pan: 0.25, rows: ['. . x . | . . x . | . . x . | . . x .'] },
      { part: 'bass', inst: 'bass', kind: 'bass', gain: 0.44, gate: 0.6, rows: ['r r o r | r r o r | r r o r | r o 5 o', 'r r o r | r r o r | r r o r | 5 5 o o'] },
      { part: 'kick', inst: 'kick', kind: 'drum', gain: 0.5, rows: ['X...X...X...X...', 'X...X...X..xX.x.'] },
      { part: 'snare', inst: 'snare', kind: 'drum', gain: 0.85, rows: ['....X.......X...', '....X..o....X...', '....X.......X...', '....X...x.x.xXXX'] },
      { part: 'hat', inst: 'hat', kind: 'drum', gain: 1.4, pan: 0.3, rows: ['XoxoXoxoXoxoXoxo'] },
      { part: 'ohat', inst: 'ohat', kind: 'drum', gain: 0.63, pan: 0.3, rows: ['..x...x...x...x.'] },
    ],
  },

  victory: {
    bpm: 132, swing: 0,
    chords: 'C F C G C F G C',
    parts: [
      { part: 'lead', inst: 'lead', kind: 'notes', gain: 1.35, gate: 0.92, rows: [
        'C5 - E5 - | G5 - C6 - | E6 - D6 - | C6 - . .',
        'A5 - F5 - | A5 - C6 - | A5 - G5 - | F5 - . .',
        'G5 - E5 - | G5 - C6 - | E6 - D6 - | C6 - . .',
        'B5 - G5 - | B5 - D6 - | B5 - A5 - | G5 - . .',
        'C6 . C6 C6 | E6 - C6 - | G5 - C6 - | E6 - . .',
        'A5 . A5 A5 | C6 - A5 - | F5 - A5 - | C6 - . .',
        'B5 . B5 B5 | D6 - B5 - | G5 - B5 - | D6 - . .',
        'C6 - E6 - | G5 - C6 - | E6 - D6 - | C6 - . .',
      ] },
      { part: 'arp', inst: 'arp', kind: 'arp', gain: 1.25, pan: -0.3, rows: [SPARSE_ARP] },
      { part: 'bass', inst: 'bass', kind: 'bass', gain: 0.44, gate: 0.75, rows: ['r - o - | r - o - | r - o - | r - 5 -'] },
      { part: 'kick', inst: 'kick', kind: 'drum', gain: 0.45, rows: ['X...X...X...X...'] },
      { part: 'clap', inst: 'clap', kind: 'drum', gain: 1.5, rows: ['....X.......X...'] },
      { part: 'hat', inst: 'hat', kind: 'drum', gain: 0.9, pan: 0.3, rows: ['..x...x...x...x.'] },
      { part: 'crash', inst: 'crash', kind: 'drum', gain: 0.63, rows: ['X...............', '................'] },
    ],
  },
};

const DRUM_VEL = { X: 1, x: 0.7, o: 0.4 };
const compiled = new Map();

/**
 * Turns a track's rows into `events[step]` lists (pure: no audio context). `steps` is the loop length in sixteenths and
 * `stepDur` a sixteenth in seconds. An event is { part, inst, midi, midis?, len (steps), vel, gate }. Returns null for an unknown name.
 */
export function compileTrack(name) {
  if (typeof name !== 'string' || !Object.hasOwn(TRACKS, name)) return null;
  if (compiled.has(name)) return compiled.get(name);
  const def = TRACKS[name], chords = def.chords.split(/\s+/).map(parseChord), bars = chords.length, steps = bars * STEPS_PER_BAR;
  const events = Array.from({ length: steps }, () => []);
  for (const part of def.parts) {
    let held = null;   // the event a '-' extends; it survives bar lines so a note can be tied across them
    for (let bar = 0; bar < bars; bar++) {
      const row = part.rows[bar % part.rows.length], chord = chords[bar];
      const tokens = part.kind === 'drum' ? [...row.replace(/[\s|]/g, '')] : row.replace(/\|/g, ' ').trim().split(/\s+/);
      tokens.forEach((tok, i) => {
        const at = bar * STEPS_PER_BAR + i;
        if (tok === '-') { if (held) held.len++; return; }
        if (tok === '.') { held = null; return; }
        const ev = { part: part.part, inst: part.inst, midi: 0, len: 1, vel: 1, gate: part.gate ?? 0.9 };
        if (part.kind === 'drum') ev.vel = DRUM_VEL[tok] ?? 0;
        else if (part.kind === 'notes') ev.midi = noteToMidi(tok);
        else if (part.kind === 'arp') ev.midi = chordTone(chord, arpBase(chord), Number(tok));
        else if (part.kind === 'chord') { ev.midis = chord.intervals.map((_, k) => chordTone(chord, arpBase(chord), k)); ev.midi = ev.midis[0]; }
        else ev.midi = { r: bassRoot(chord), o: bassRoot(chord) + 12, 5: chordTone(chord, bassRoot(chord), 2), 3: chordTone(chord, bassRoot(chord), 1) }[tok] ?? NaN;
        if (part.kind === 'drum' ? ev.vel === 0 : Number.isNaN(ev.midi)) { held = null; return; }
        events[at].push(ev);
        held = ev;
      });
    }
  }
  const result = { name, bpm: def.bpm, swing: def.swing, bars, steps, stepDur: 60 / def.bpm / 4, chords: chords.map((c) => c.name), events, parts: def.parts };
  compiled.set(name, result);
  return result;
}

// Instruments: (sink, time, event, seconds). Levels are relative; each part's `gain` and MUSIC_LEVEL do the balancing.
const INSTRUMENTS = {
  lead(m, t, ev, dur) {
    tone(m, t, { wave: 'pulse25', f: mtof(ev.midi), dur, vol: 0.5 * ev.vel, atk: 0.006, shape: 'flat', sus: 0.75, rel: Math.min(0.06, dur / 2), filter: lp(4800),
      vib: dur > 0.28 ? { rate: 5.5, depth: 12, delay: 0.16 } : undefined });
  },
  lead2(m, t, ev, dur) {
    tone(m, t, { wave: 'pulse12', f: mtof(ev.midi), dur, vol: 0.5 * ev.vel, atk: 0.004, shape: 'flat', sus: 0.7, rel: Math.min(0.05, dur / 2), filter: lp(5200) });
  },
  pluck(m, t, ev, dur) {
    const f = mtof(ev.midi), d = Math.min(dur + 0.12, 0.5);
    tone(m, t, { wave: 'triangle', f, dur: d, vol: 0.6 * ev.vel, atk: 0.003 });
    tone(m, t, { wave: 'sine', f: f * 2, dur: d * 0.5, vol: 0.18 * ev.vel, atk: 0.002 });
  },
  arp(m, t, ev, dur) {
    tone(m, t, { wave: 'pulse12', f: mtof(ev.midi), dur: Math.min(dur, 0.12), vol: 0.4 * ev.vel, atk: 0.002, filter: lp(4500) });
  },
  bass(m, t, ev, dur) {
    const f = mtof(ev.midi);
    tone(m, t, { wave: 'triangle', f, dur, vol: 0.7 * ev.vel, atk: 0.004, shape: 'flat', rel: 0.04 });
    tone(m, t, { wave: 'pulse25', f, dur: dur * 0.8, vol: 0.28 * ev.vel, atk: 0.003, filter: lp(700) });   // the harmonics a phone speaker can actually play
  },
  stab(m, t, ev) {
    for (const midi of ev.midis) tone(m, t, { wave: 'square', f: mtof(midi), dur: 0.1, vol: 0.2 * ev.vel, atk: 0.003, filter: lp(2600) });
  },
  pad(m, t, ev, dur) {
    for (const midi of ev.midis) tone(m, t, { wave: 'triangle', f: mtof(midi), dur, vol: 0.16, atk: 0.25, shape: 'flat', rel: 0.4 });
  },
  kick(m, t, ev) {
    tone(m, t, { wave: 'sine', f: 150, to: 44, glide: 0.09, dur: 0.24, vol: 0.95 * ev.vel, atk: 0.001 });
    noise(m, t, { dur: 0.015, vol: 0.25 * ev.vel, atk: 0.0005, filter: hp(3000) });
  },
  snare(m, t, ev) {
    noise(m, t, { dur: 0.14, vol: 0.6 * ev.vel, atk: 0.001, filter: bp(1800, undefined, 0.9) });
    tone(m, t, { wave: 'triangle', f: 200, to: 140, glide: 0.08, dur: 0.1, vol: 0.35 * ev.vel, atk: 0.001 });
    noise(m, t, { dur: 0.05, vol: 0.2 * ev.vel, atk: 0.001, filter: hp(4000) });
  },
  brush(m, t, ev) {
    noise(m, t, { dur: 0.16, vol: 0.5 * ev.vel, atk: 0.006, filter: bp(3200, 2200, 0.7) });
  },
  clap(m, t, ev) {
    for (let i = 0; i < 3; i++) noise(m, t + i * 0.011, { dur: i === 2 ? 0.14 : 0.02, vol: 0.5 * ev.vel, atk: 0.001, filter: bp(1300, undefined, 1) });
  },
  hat(m, t, ev) {
    noise(m, t, { dur: 0.04, vol: 0.5 * ev.vel, atk: 0.001, filter: hp(7500) });
  },
  ohat(m, t, ev) {
    noise(m, t, { dur: 0.18, vol: 0.4 * ev.vel, atk: 0.002, filter: hp(6500) });
  },
  crash(m, t, ev) {
    noise(m, t, { dur: 1.1, vol: 0.35 * ev.vel, atk: 0.002, filter: hp(4500) });
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Sequencer

/** One playing (or fading) instance of a track: its own fader, one gain (+ pan) per part, and the look-ahead cursor. */
class Run {
  constructor(engine, track, startTime, fade, step) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.track = track;
    this.step = step;
    this.nextTime = startTime;
    this.node = ctx.createGain();
    this.node.gain.value = 0;
    this.node.gain.setTargetAtTime(1, startTime, fade / 4);
    this.node.connect(engine.duckGain);
    this.sinks = new Map();
    for (const p of track.parts) {
      const g = ctx.createGain();
      g.gain.value = p.gain;
      if (p.pan && ctx.createStereoPanner) {
        const sp = ctx.createStereoPanner();
        sp.pan.value = p.pan;
        g.connect(sp);
        sp.connect(this.node);
      } else {
        g.connect(this.node);
      }
      this.sinks.set(p.part, { engine, ctx, dest: g, rate: 1, random: engine.random, keep() {} });
    }
  }

  /** Schedules every sixteenth that starts before `until`. Steps are laid out by accumulation, so a loop seam is exactly one step long. */
  scheduleUntil(until) {
    const { track } = this, late = this.engine.ctx.currentTime - this.nextTime;
    if (late > 0.05) {   // the clock ran away from us (a stalled tab): skip the notes we missed instead of dumping them all at once
      const skip = Math.ceil(late / track.stepDur);
      this.step += skip;
      this.nextTime += skip * track.stepDur;
    }
    while (this.nextTime < until) {
      const pos = this.step % track.steps, swing = pos % 2 ? track.swing * track.stepDur : 0;
      for (const ev of track.events[pos]) INSTRUMENTS[ev.inst](this.sinks.get(ev.part), this.nextTime + swing, ev, ev.len * track.stepDur * ev.gate);
      this.step++;
      this.nextTime += track.stepDur;
    }
  }

  fadeOut(t, fade) {
    this.node.gain.cancelScheduledValues(t);
    this.node.gain.setTargetAtTime(0, t, fade / 4);
  }

  dispose() {
    try { this.node.disconnect(); } catch { /* already gone */ }
  }
}

/** Starts, crossfades, suspends and stops tracks. `pump(until)` is the only thing a timer (or an offline render) has to call. */
class Conductor {
  constructor(engine) {
    this.engine = engine;
    this.run = null;
    this.name = null;      // the track we are supposed to be playing, even while suspended
    this.step = 0;         // where a suspended track resumes
    this.retired = [];
  }

  get active() { return this.run !== null; }

  start(name, { when, fade, step } = {}) {
    const track = compileTrack(name);
    if (!track) return false;
    const now = this.engine.ctx.currentTime, t = when ?? now + 0.06;
    const crossfade = this.run !== null;
    if (this.run) this.retire(this.run, t, FADE_CROSS_S);
    const resume = step ?? (name === this.name ? this.step : 0);
    this.run = new Run(this.engine, track, t, fade ?? (crossfade ? FADE_CROSS_S : FADE_FIRST_S), resume);
    this.name = name;
    return true;
  }

  /** Silences the track now but remembers it (and the bar it was in) so a resume carries on. */
  suspend() {
    if (!this.run) return;
    this.step = this.run.step;
    this.retire(this.run, this.engine.ctx.currentTime, 0.03);
    this.run = null;
  }

  stop(fade = 0.5) {
    if (this.run) this.retire(this.run, this.engine.ctx.currentTime, fade);
    this.run = null;
    this.name = null;
    this.step = 0;
  }

  retire(run, t, fade) {
    run.fadeOut(t, fade);
    // Notes scheduled ahead of the fade are silent but still exist; drop the whole run once the last of them is over.
    this.retired.push({ run, at: t + fade + LOOKAHEAD_S + 0.3 });
  }

  pump(until) {
    this.run?.scheduleUntil(until);
    if (this.retired.length) {
      const now = this.engine.ctx.currentTime;
      this.retired = this.retired.filter((r) => (r.at > now ? true : (r.run.dispose(), false)));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Voices and the engine

/** One playing sound effect: a fader (`out`) all its layers run through, plus what is needed to stop or release it early. */
class Voice {
  constructor(engine, def, t0, rate) {
    const ctx = engine.ctx;
    this.engine = engine;
    this.ctx = ctx;
    this.pri = def.pri;
    this.t0 = t0;
    this.rate = rate;
    this.random = engine.random;
    this.end = t0;
    this.sources = [];
    this.pending = 0;
    this.extra = [];
    this.out = ctx.createGain();
    this.dest = this.out;
  }

  /** Routes every layer created afterwards through a tanh saturator. */
  saturate() {
    const sh = this.ctx.createWaveShaper();
    sh.curve = SATURATE;
    sh.connect(this.out);
    this.dest = sh;
    this.extra.push(sh);
  }

  keep(src, end) {
    this.sources.push(src);
    this.pending++;
    this.end = Math.max(this.end, end);
    src.onended = () => { if (--this.pending === 0) this.release(); };
  }

  connect(bus, pan, wet) {
    let tail = this.out;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      this.out.connect(p);
      this.extra.push(p);
      tail = p;
    }
    tail.connect(bus);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      this.out.connect(send);
      send.connect(this.engine.reverb());
      this.extra.push(send);
    }
  }

  /** Steal: a 10 ms fade-out, then the sources stop. */
  kill(t) {
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.01);
      for (const s of this.sources) s.stop(t + 0.06);
    } catch { /* a source that already ended */ }
    this.end = Math.min(this.end, t + 0.06);
  }

  release() {
    for (const node of [this.out, ...this.extra]) {
      try { node.disconnect(); } catch { /* already gone */ }
    }
  }
}

export class Engine {
  /**
   * @param {BaseAudioContext} ctx  live or offline
   * @param {{ random?: () => number, maxVoices?: number }} [opts]  `random` is injectable so a render is reproducible
   */
  constructor(ctx, { random = Math.random, maxVoices = MAX_VOICES } = {}) {
    this.ctx = ctx;
    this.random = random;
    this.maxVoices = maxVoices;
    this.voices = [];
    this.last = new Map();     // sound -> start time of its latest voice
    this.streak = new Map();   // sound -> { until, count } for the repeat falloff
    this.buffers = new Map();
    this.waves = new Map();
    this.reverbNode = null;

    this.master = ctx.createGain();
    this.master.gain.value = gainForVolume(DEFAULT_VOLUME);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const clip = ctx.createWaveShaper();
    clip.curve = SOFT_CLIP;
    this.master.connect(comp);
    comp.connect(clip);
    clip.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.duckGain = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_LEVEL;
    // Kick, bass, lead and hat all land on the downbeat; squashing those stacked transients is what lets the music carry more body
    // under its peak cap.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14;
    glue.knee.value = 6;
    glue.ratio.value = 12;
    glue.attack.value = 0.002;
    glue.release.value = 0.09;
    this.duckGain.connect(glue);
    glue.connect(this.musicBus);
    this.musicBus.connect(this.master);

    this.music = new Conductor(this);
  }

  /** User volume (0..1, tapered) and mute. `immediate` skips the 20 ms de-click ramp (first setup). */
  setMaster(volume, muted, immediate = false) {
    const target = muted ? 0 : gainForVolume(volume), p = this.master.gain, now = this.ctx.currentTime;
    if (immediate) { p.value = target; return; }
    p.cancelScheduledValues(now);
    p.setTargetAtTime(target, now, 0.02);
  }

  noise(color) {
    if (!this.buffers.has(color)) this.buffers.set(color, noiseBuffer(this.ctx, color));
    return this.buffers.get(color);
  }

  wave(name) {
    if (!this.waves.has(name)) this.waves.set(name, pulseWave(this.ctx, PULSE_DUTY[name]));
    return this.waves.get(name);
  }

  /** The reverb's input, built on first use. */
  reverb() {
    if (!this.reverbNode) {
      const conv = this.ctx.createConvolver(), ret = this.ctx.createGain();
      conv.buffer = roomImpulse(this.ctx);
      ret.gain.value = 0.7;
      conv.connect(ret);
      ret.connect(this.sfxBus);
      this.reverbNode = conv;
    }
    return this.reverbNode;
  }

  /** Dips the music to `level` for `hold` seconds starting at `when`, then eases back. */
  duck(when, hold, level = 0.4) {
    const g = this.duckGain.gain;
    g.cancelScheduledValues(when);
    g.setTargetAtTime(level, when, 0.012);
    g.setTargetAtTime(1, when + hold, 0.25);
  }

  /** How many sound effects are still sounding at time `t`. */
  voiceCount(t = this.ctx.currentTime) {
    return this.voices.filter((v) => v.end > t).length;
  }

  /**
   * Plays a sound effect. Returns false when it was not started: unknown name, dropped by its cooldown, or outranked when all voices are busy.
   * @param {string} name  one of SOUND_NAMES
   * @param {{ pan?: number, vol?: number, rate?: number }} [o]
   * @param {number} [when]  absolute context time (default: right now)
   */
  play(name, o = {}, when = this.ctx.currentTime + START_LEAD_S) {
    if (typeof name !== 'string' || !Object.hasOwn(SFX, name)) return false;
    const def = SFX[name];

    // Cooldown: a repeat too close to the previous one is pushed back to keep the gap if that is within `spread`, else dropped.
    let start = when, chain = 0;
    if (def.gap) {
      const last = this.last.get(name);
      if (last !== undefined && start < last + def.gap) {
        start = last + def.gap;
        if (start - when > (def.spread ?? 0) + 1e-9) return false;
      }
      const streak = this.streak.get(name);
      chain = streak && start < streak.until ? streak.count + 1 : 0;
      this.streak.set(name, { until: start + (def.window ?? 0), count: chain });
      this.last.set(name, start);
    }

    // Voice limit: finished voices leave the list; when it is still full the lowest-priority, oldest voice makes room for an equal or more important one.
    this.voices = this.voices.filter((v) => v.end > start);
    if (this.voices.length >= this.maxVoices) {
      let victim = this.voices[0];
      for (const v of this.voices) if (v.pri < victim.pri || (v.pri === victim.pri && v.t0 < victim.t0)) victim = v;
      if (victim.pri > def.pri) return false;
      victim.kill(start);
      this.voices.splice(this.voices.indexOf(victim), 1);
    }

    const pan = clamp(Number(o.pan) || 0, -1, 1);
    const vol = clamp(Number.isFinite(o.vol) ? o.vol : 1, 0, 2);
    const rate = clamp(Number.isFinite(o.rate) && o.rate > 0 ? o.rate : 1, 0.25, 4) * (1 + (this.random() * 2 - 1) * (def.jitter ?? 0));
    const voice = new Voice(this, def, start, rate);
    voice.out.gain.value = def.vol * vol * (def.falloff ?? 1) ** chain;
    try {
      def.build(voice, start, chain);
      voice.connect(this.sfxBus, pan, def.wet ?? 0);
    } catch {
      voice.release();
      return false;
    }
    this.voices.push(voice);
    if (def.duck && chain === 0) this.duck(start, def.duck[1], def.duck[0]);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Browser facade

/**
 * @param {object} [env]  test seams; every key defaults to the real global, and `null` means "not available":
 *   AudioContext, document, navigator, storage (a localStorage-like), setInterval, clearInterval, random
 */
export function createAudio(env = {}) {
  const has = (key) => key in env;
  const g = globalThis;
  const Ctor = has('AudioContext') ? env.AudioContext : g.AudioContext || g.webkitAudioContext;
  const doc = has('document') ? env.document : g.document;
  const nav = has('navigator') ? env.navigator : g.navigator;
  const startTimer = env.setInterval ?? ((fn, ms) => g.setInterval(fn, ms));
  const stopTimer = env.clearInterval ?? ((id) => g.clearInterval(id));
  const random = env.random ?? Math.random;
  let storage = null;
  try { storage = has('storage') ? env.storage : g.localStorage; } catch { /* blocked by privacy settings */ }

  let volume = DEFAULT_VOLUME, muted = false;
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (Number.isFinite(saved?.volume)) volume = clamp(saved.volume, 0, 1);
    if (typeof saved?.muted === 'boolean') muted = saved.muted;
  } catch { /* first run, or storage unreadable */ }
  const save = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify({ volume, muted })); } catch { /* private mode */ } };

  let ctx = null, engine = null, armed = false, wanted = null, timer = null, broken = false;

  const hidden = () => !!doc?.hidden;
  const running = () => ctx?.state === 'running';

  function arm() {
    if (armed || !doc || !Ctor) return;
    armed = true;
    for (const e of GESTURES) doc.addEventListener(e, tryUnlock, { capture: true, passive: true });
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    for (const e of GESTURES) doc.removeEventListener(e, tryUnlock, true);
  }

  function ensureContext() {
    if (ctx) return ctx.state !== 'closed';
    if (!Ctor || broken) return false;
    let made = null;
    try {
      try { made = new Ctor({ latencyHint: 'interactive' }); } catch { made = new Ctor(); }
      const built = new Engine(made, { random });
      built.setMaster(volume, muted, true);
      made.onstatechange = onStateChange;
      ctx = made;
      engine = built;
      return true;
    } catch {
      broken = true;   // one failed attempt is enough; do not create a context per tap
      try { made?.close?.(); } catch { /* ignore */ }
      return false;
    }
  }

  function resume() {
    try { ctx.resume?.()?.then(onStateChange, () => {}); } catch { /* not allowed yet: the next gesture retries */ }
  }

  // Runs inside a user gesture. iOS only unlocks when a source is started in the same call stack, so a silent one is.
  function tryUnlock() {
    if (!ensureContext()) return;
    resume();
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch { /* the context is unusable; sound stays off */ }
    if (running()) disarm();
  }

  // 'suspended' and iOS's 'interrupted' (a call, Siri, another tab) both need a fresh gesture to come back.
  function onStateChange() {
    if (!ctx) return;
    if (running()) disarm(); else if (ctx.state !== 'closed') arm();
    sync();
  }

  function pump() {
    try { engine.music.pump(ctx.currentTime + LOOKAHEAD_S); } catch { /* a scheduling failure must not kill the timer */ }
  }

  // Music plays iff it was asked for, the context runs, we are not muted and the tab is visible; anything else pauses it in place.
  function sync() {
    try {
      const play = wanted !== null && running() && !muted && !hidden();
      if (play) {
        if (engine.music.name !== wanted || !engine.music.active) engine.music.start(wanted);
        if (timer === null) timer = startTimer(pump, PUMP_MS);
        pump();
      } else {
        engine?.music.suspend();
        if (timer !== null) { stopTimer(timer); timer = null; }
      }
    } catch { /* audio is optional */ }
  }

  doc?.addEventListener?.('visibilitychange', () => {
    if (!ctx) return;
    if (hidden()) {
      engine.music.suspend();
      try { ctx.suspend?.(); } catch { /* ignore */ }
    } else {
      arm();
      resume();
    }
    sync();
  });
  try { if (nav?.audioSession) nav.audioSession.type = 'playback'; } catch { /* read-only on some builds */ }   // plays even with the iPhone silent switch on

  return {
    /** Arms the first-gesture unlock (idempotent). */
    unlock() {
      arm();
      if (ctx && !running()) resume();
    },

    /** Plays a sound effect; false when it did not sound (locked, muted, hidden, unknown, cooled down, outranked). Never queued, never throws. */
    play(name, opts) {
      if (muted || !running() || hidden()) return false;
      try { return engine.play(name, opts ?? {}); } catch { return false; }
    },

    /** Switches the music (crossfading) or stops it with `null`. Unknown names are ignored. */
    music(name) {
      if (name !== null && !MUSIC_NAMES.includes(name)) return;
      wanted = name;
      if (name === null) engine?.music.stop();
      sync();
    },

    setVolume(v) {
      if (!Number.isFinite(v)) return;
      volume = clamp(v, 0, 1);
      try { engine?.setMaster(volume, muted); } catch { /* ignore */ }
      save();
    },

    setMuted(b) {
      muted = !!b;
      try { engine?.setMaster(volume, muted); } catch { /* ignore */ }
      save();
      sync();
    },

    /** Dips the music for `ms`; a no-op while nothing plays. */
    duck(ms) {
      if (!running() || !Number.isFinite(ms)) return;
      try { engine.duck(ctx.currentTime, clamp(ms, 0, 10000) / 1000); } catch { /* ignore */ }
    },

    get muted() { return muted; },
    get volume() { return volume; },
    get supported() { return !!Ctor; },
    get state() { return !Ctor ? 'unsupported' : ctx ? ctx.state : 'locked'; },
  };
}

export const audio = createAudio();
