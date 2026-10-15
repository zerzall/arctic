// The score's orchestra (music.js): sampled instruments baked like every other sound
// (bank.js), one buffer per sample root, so music.js plays a note by picking the
// nearest root and transposing with playbackRate (at most ±2 semitones).
//
// Sustained instruments (choir, strings, horns, flute) are seamless loop buffers: every
// oscillator, vibrato and drift completes a whole number of cycles in the loop and the
// breath/bow noise repeats with the loop's period, so the buffer is exactly periodic
// (no crossfade, no dip) and a note of any length is just the loop played with a gain
// envelope. The filters run over a short warm-up before the kept period.
//
// A sound's variant index selects its root (and round-robin take for the percussive
// ones): variant = rootIndex * rr + take.

import { TAU, clamp } from '../shared/math.js';
import * as S from './synth.js';

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Sample roots (MIDI note numbers) per pitched instrument. */
export const MUSIC_ROOTS = {
  mu_choir_a: [38, 42, 46, 50, 54, 58, 62, 66, 70],
  mu_choir_o: [38, 42, 46, 50, 54, 58, 62, 66, 70],
  mu_str: [38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82],
  mu_horn: [38, 42, 46, 50, 54, 58, 62, 66, 70, 74],
  mu_flute: [62, 66, 70, 74, 78, 82],
  mu_spicc: [38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82],
  mu_harp: [50, 54, 58, 62, 66, 70, 74, 78, 82],
  mu_timp: [38],
};
/** Round-robin takes per root (percussive instruments sound less mechanical). */
export const MUSIC_RR = { mu_spicc: 2, mu_timp: 2, mu_taiko: 2, mu_drum: 2 };
/** Seconds into the swell/roll buffers where their crescendo peaks (music.js lands it on a downbeat). */
export const SWELL_PEAK = { mu_cym: 2.6, mu_troll: 2.6 };

/** Variant count of a pitched instrument: roots × takes. */
const nv = (id) => MUSIC_ROOTS[id].length * (MUSIC_RR[id] || 1);
const rootOf = (id, v) => MUSIC_ROOTS[id][Math.floor(v / (MUSIC_RR[id] || 1)) % MUSIC_ROOTS[id].length];

// ---- periodic loop synthesis ------------------------------------------------------------

/** Add depth·sin(w·i + φ) into `out`, by rotation. */
function rotate(out, w, phi, depth) {
  if (!depth) return;
  const cw = Math.cos(w), sw = Math.sin(w);
  let s = Math.sin(phi), c = Math.cos(phi);
  for (let i = 0; i < out.length; i++) {
    out[i] += depth * s;
    const n = s * cw + c * sw;
    c = c * cw - s * sw;
    s = n;
  }
}

/** sin(w·i + φ) by rotation, advanced one sample per step(). */
function phasor(w, phi) {
  const cw = Math.cos(w), sw = Math.sin(w);
  const p = { s: Math.sin(phi), c: Math.cos(phi), step() {
    const s = p.s * cw + p.c * sw;
    p.c = p.c * cw - p.s * sw;
    p.s = s;
  } };
  return p;
}

/**
 * Render an exactly periodic ensemble of `L` seconds. Each voice: { f, g, wave:
 * 'saw'|'sine'|'flute', vib: [hz, depth], drift: depth, am: [hz, depth] }; frequencies and
 * modulation rates are rounded to whole cycles per loop (≤ 1/(2L) Hz off). `post(buf)`
 * filters the whole buffer (warm-up included) in place; the last period is returned.
 */
function periodic(sr, L, voices, rng, { noise = 0, warm = 0.25, post } = {}) {
  const N = Math.max(16, Math.round(L * sr));
  const Le = N / sr;
  const W = Math.round(warm * sr);
  const total = N + W;
  const buf = new Float32Array(total);
  const cyc = (hz) => Math.max(1, Math.round(hz * Le)) / Le;
  for (const v of voices) {
    const f = cyc(v.f);
    const [vr, vd] = v.vib ? [cyc(v.vib[0]), v.vib[1]] : [0, 0];
    const dr = 1 / Le, dd = v.drift || 0;
    const [ar, ad] = v.am ? [cyc(v.am[0]), v.am[1]] : [0, 0];
    // Modulators as rotating sin/cos pairs (no Math.sin per sample): vibrato + drift
    // are summed into one pitch-modulation signal first, then the oscillator runs.
    const mod = new Float32Array(total);
    const amp = new Float32Array(total);
    rotate(mod, TAU * vr / sr, rng.next() * TAU, vd);
    rotate(mod, TAU * dr / sr, rng.next() * TAU, dd);
    rotate(amp, TAU * ar / sr, rng.next() * TAU, ad);
    const g = v.g ?? 1;
    const fs = f / sr;
    let ph = rng.next();
    if (v.wave === 'sine' || v.wave === 'flute') {
      const fl = v.wave === 'flute';
      for (let i = 0; i < total; i++) {
        const x = Math.sin(TAU * ph);
        let s = x;
        if (fl) {
          // sin 2θ, 3θ, 4θ from sin θ / cos θ.
          const c = Math.cos(TAU * ph);
          const s2 = 2 * x * c, c2 = 1 - 2 * x * x;
          s = x + 0.3 * s2 + 0.1 * (x * c2 + c * s2) + 0.07 * s2 * c2;
        }
        buf[i] += s * g * (1 + amp[i]);
        ph += fs * (1 + mod[i]);
        if (ph >= 1) ph -= 1;
      }
    } else {
      for (let i = 0; i < total; i++) {
        const dt = fs * (1 + mod[i]);
        let s = 2 * ph - 1;
        if (ph < dt) {
          const t = ph / dt;
          s -= t + t - t * t - 1;
        } else if (ph > 1 - dt) {
          const t = (ph - 1) / dt;
          s -= t * t + t + t + 1;
        }
        buf[i] += s * g * (1 + amp[i]);
        ph += dt;
        if (ph >= 1) ph -= 1;
      }
    }
  }
  if (noise > 0) {
    const nz = new Float32Array(N);
    for (let i = 0; i < N; i++) nz[i] = rng.next() * 2 - 1;
    for (let i = 0; i < total; i++) buf[i] += nz[i % N] * noise;
  }
  if (post) post(buf);
  return steady(buf.slice(total - N), sr);
}

/**
 * Even out the slow level swells of a loop (a handful of detuned voices beat together far
 * more than a real section of twenty would): divide by a circular 120 ms RMS envelope,
 * mostly. Computed around the wrap, so the loop stays exactly periodic.
 */
function steady(b, sr, strength = 0.85) {
  const n = b.length;
  const w = Math.max(8, Math.round(sr * 0.12));
  if (n < 2 * w) return b;
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + b[i] * b[i];
  const mean = Math.sqrt(sq[n] / n);
  if (!(mean > 0)) return b;
  const h = w >> 1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i - h, e = i + h;
    let s;
    if (a < 0) s = sq[e] + (sq[n] - sq[n + a]);
    else if (e > n) s = sq[n] - sq[a] + sq[e - n];
    else s = sq[e] - sq[a];
    env[i] = Math.sqrt(s / (2 * h));
  }
  for (let i = 0; i < n; i++) b[i] *= clamp(Math.pow(mean / Math.max(env[i], mean * 0.05), strength), 0.4, 3);
  return b;
}

/** `cents` spread → frequencies around f0. */
const spread = (f0, cents) => cents.map((c) => f0 * Math.pow(2, c / 1200));

function sumFilters(src, sr, bank) {
  const out = new Float32Array(src.length);
  for (const [type, f, q, g] of bank) {
    const l = S.filter(src.slice(), sr, type, f, q);
    for (let i = 0; i < out.length; i++) out[i] += l[i] * g;
  }
  return out;
}

// Male-choir vowel formants: [centre Hz, gain, bandwidth Hz].
const FORMANTS = {
  a: [[690, 1, 110], [1120, 0.62, 130], [2550, 0.2, 180], [2950, 0.16, 240]],
  o: [[360, 1, 90], [760, 0.5, 110], [2450, 0.05, 200]],
};

/** Low male choir on one vowel: five singers, each with its own vibrato and drift. */
function choir(sr, rng, midi, vowel) {
  const f0 = midiHz(midi);
  const rates = rng.shuffle([4.6, 5.0, 5.3, 5.6, 4.8]);
  const voices = spread(f0, [-12, -5, 0, 5, 11]).map((f, i) => ({
    f, g: 1, wave: 'saw', vib: [rates[i], 0.0028 + rng.next() * 0.0016], drift: 0.0012, am: [0.7 + i * 0.25, 0.06],
  }));
  return periodic(sr, 3, voices, rng, { noise: 0.06, post: (b) => {
    S.filter(b, sr, 'lowpass', 1800, 0.5); // glottal tilt
    const body = S.filter(b.slice(), sr, 'lowpass', Math.max(260, f0 * 2.2), 0.7);
    const fm = FORMANTS[vowel];
    const form = sumFilters(b, sr, fm.map(([f, g, bw]) => ['bandpass', f, f / bw, g]));
    const bodyG = vowel === 'o' ? 0.75 : 0.45;
    for (let i = 0; i < b.length; i++) b[i] = form[i] * 1.6 + body[i] * bodyG;
    S.filter(b, sr, 'lowpass', 3600, 0.6);
    S.filter(b, sr, 'highpass', Math.max(40, f0 * 0.6), 0.7);
  } });
}

/** Bowed string section: six desks, bow noise, body and brilliance. */
function strings(sr, rng, midi) {
  const f0 = midiHz(midi);
  const rates = rng.shuffle([5.2, 5.5, 5.8, 6.1, 5.4, 6.3]);
  const voices = spread(f0, [-13, -8, -3, 3, 8, 12]).map((f, i) => ({
    f, g: 1, wave: 'saw', vib: [rates[i], 0.0022 + rng.next() * 0.0016], drift: 0.001, am: [0.5 + i * 0.3, 0.05],
  }));
  const lp = Math.min(1500 + f0 * 7, 6000);
  return periodic(sr, 3, voices, rng, { noise: 0.035, post: (b) => {
    S.filter(b, sr, 'highpass', f0 * 0.7, 0.7);
    S.filter(b, sr, 'lowpass', lp, 0.6);
    S.filter(b, sr, 'lowpass', lp * 1.3, 0.6);
    S.filter(b, sr, 'peaking', 280, 1.1, midi < 55 ? 3 : 1);
    S.filter(b, sr, 'peaking', 2600, 1.4, midi >= 60 ? 2.5 : 0.5);
  } });
}

/** Horn section: warm, round saws with a strong fundamental (music.js adds the swell filter). */
function horn(sr, rng, midi) {
  const f0 = midiHz(midi);
  const voices = spread(f0, [-6, 0, 5]).map((f, i) => ({ f, g: 1, wave: 'saw', vib: [4.4 + i * 0.5, 0.0009], drift: 0.0008, am: [0.4 + i * 0.35, 0.05] }));
  voices.push({ f: f0, g: 0.9, wave: 'sine', vib: [4.4, 0.0009] });
  const lp = Math.min(f0 * 7 + 500, 3200);
  return periodic(sr, 3, voices, rng, { noise: 0.01, post: (b) => {
    S.filter(b, sr, 'lowpass', lp, 0.7);
    S.filter(b, sr, 'lowpass', lp * 1.2, 0.7);
    S.filter(b, sr, 'peaking', 480, 1, 4);
    S.filter(b, sr, 'highpass', f0 * 0.6, 0.7);
  } });
}

/** Wooden flute: a breathy near-sine with a gentle vibrato. */
function flute(sr, rng, midi) {
  const f0 = midiHz(midi);
  const voices = [{ f: f0, g: 1, wave: 'flute', vib: [5, 0.0055], drift: 0.0008, am: [5, 0.07] }];
  return periodic(sr, 2, voices, rng, { noise: 0.09, post: (b) => {
    S.filter(b, sr, 'lowpass', Math.min(f0 * 5, 6000), 0.6);
    S.filter(b, sr, 'highpass', f0 * 0.5, 0.7);
  } });
}

// ---- one-shots -----------------------------------------------------------------------------

function thud(sr, f0, f1, d, tc, drv) {
  const b = S.osc(sr, d + 0.02, 'sine', S.drop(f0, f1, tc));
  return S.drive(S.env(b, sr, 0.002, d), drv);
}

function noiseHit(sr, rng, type, f, q, d, a = 0.001) {
  const b = S.filter(S.noise(sr, d + a + 0.01, rng), sr, type, f, q);
  return S.env(b, sr, a, d);
}

/** Short bowed note for the low-string ostinatos. */
function spiccato(sr, rng, midi) {
  const f0 = midiHz(midi);
  const dur = 0.42;
  const out = S.makeBuf(sr, dur);
  for (const c of [-9 + rng.next() * 3, 0, 7 + rng.next() * 3]) S.mix(out, S.osc(sr, dur, 'saw', f0 * Math.pow(2, c / 1200), { phase: rng.next() }), sr, 0.4);
  S.mix(out, noiseHit(sr, rng, 'bandpass', Math.min(2600, f0 * 12), 0.9, 0.03), sr, 0.25);
  S.filter(out, sr, 'lowpass', S.curve([[0, Math.min(f0 * 16, 7000)], [0.12, Math.min(f0 * 6, 3200)]]), 0.7);
  S.filter(out, sr, 'highpass', f0 * 0.6, 0.7);
  S.filter(out, sr, 'peaking', 250, 1, 3);
  return S.env(out, sr, 0.005, 0.3, 0.05);
}

/** Concert harp: decaying harmonic partials plus a finger-pluck transient. */
function harp(sr, rng, midi) {
  const f0 = midiHz(midi);
  const k = Math.sqrt(clamp(260 / f0, 0.45, 1.4));
  const out = S.makeBuf(sr, 2.6 * k + 0.1);
  for (const [r, g, d] of [[1, 1, 2.4], [2, 0.5, 1.7], [3, 0.3, 1.2], [4, 0.16, 0.9], [5, 0.1, 0.7], [6, 0.05, 0.5], [7, 0.03, 0.4]]) {
    // Decaying partial by rotation (slightly stretched, like a real string).
    const f = f0 * r * (1 + 0.0004 * r * r);
    if (f >= sr * 0.45) break;
    const p = phasor(TAU * f / sr, 0);
    const n = Math.min(out.length, Math.ceil(d * k * sr));
    const kd = Math.exp(-S.LN1000 / (d * k * sr));
    let a = g;
    for (let i = 0; i < n; i++) {
      out[i] += p.s * a;
      a *= kd;
      p.step();
    }
  }
  S.mix(out, noiseHit(sr, rng, 'bandpass', Math.min(f0 * 3, 5000), 1.2, 0.012), sr, 0.15);
  return S.fadeIn(out, sr, 0.002);
}

/** Tuned timpani stroke (root D2): principal + drum modes, mallet thump. */
function timpani(sr, rng, f = 73.42, len = 2.4) {
  const out = S.env(S.osc(sr, len, 'sine', S.drop(f * 1.035, f, 0.07)), sr, 0.002, len);
  for (const [r, g, d] of [[1.504, 0.45, len * 0.55], [1.742, 0.22, len * 0.35], [2.0, 0.28, len * 0.45], [2.44, 0.14, len * 0.3], [2.9, 0.07, len * 0.2]]) {
    S.mix(out, S.env(S.osc(sr, d + 0.02, 'sine', f * r, { phase: rng.next() }), sr, 0.002, d), sr, g);
  }
  S.mix(out, noiseHit(sr, rng, 'lowpass', 900, 0.7, 0.07), sr, 0.45);
  return S.mix(out, thud(sr, 70, 40, 0.35, 0.05, 1.2), sr, 0.35);
}

export const MUSIC_SOUNDS = {
  // Sustained (seamless loops; music.js shapes attack and release).
  mu_choir_a: { srate: 0.375, cat: 'music', loop: true, v: nv('mu_choir_a'), g: 1, wet: 0.5, render: (sr, rng, v) => choir(sr, rng, rootOf('mu_choir_a', v), 'a') },
  mu_choir_o: { srate: 0.375, cat: 'music', early: true, loop: true, v: nv('mu_choir_o'), g: 1, wet: 0.5, render: (sr, rng, v) => choir(sr, rng, rootOf('mu_choir_o', v), 'o') },
  mu_str: { srate: 0.375, cat: 'music', early: true, loop: true, v: nv('mu_str'), g: 1, wet: 0.4, render: (sr, rng, v) => strings(sr, rng, rootOf('mu_str', v)) },
  mu_horn: { srate: 0.375, cat: 'music', loop: true, v: nv('mu_horn'), g: 1, wet: 0.45, render: (sr, rng, v) => horn(sr, rng, rootOf('mu_horn', v)) },
  mu_flute: { srate: 0.375, cat: 'music', loop: true, v: nv('mu_flute'), g: 1, wet: 0.4, render: (sr, rng, v) => flute(sr, rng, rootOf('mu_flute', v)) },
  // Plucked / bowed shorts.
  mu_harp: { srate: 0.375, cat: 'music', early: true, v: nv('mu_harp'), g: 1, wet: 0.45, render: (sr, rng, v) => harp(sr, rng, rootOf('mu_harp', v)) },
  mu_spicc: { srate: 0.5, cat: 'music', v: nv('mu_spicc'), g: 1, wet: 0.2, render: (sr, rng, v) => spiccato(sr, rng, rootOf('mu_spicc', v)) },
  // Percussion.
  mu_timp: { srate: 0.375, cat: 'music', early: true, v: nv('mu_timp'), g: 1, wet: 0.5, render: (sr, rng) => timpani(sr, rng) },
  mu_troll: { srate: 0.375, cat: 'music', v: 1, g: 1, wet: 0.5, render: (sr, rng) => {
    // Crescendo roll on D2 peaking at SWELL_PEAK, then letting go.
    const out = S.makeBuf(sr, 3.4);
    const stroke = timpani(sr, rng, 73.42, 1.2);
    const peak = SWELL_PEAK.mu_troll;
    for (let t = 0; t < peak; t += 0.055 + rng.next() * 0.02) {
      const x = t / peak;
      S.mix(out, stroke, sr, (0.06 + 0.94 * x * x) * (0.85 + rng.next() * 0.3) * 0.35, t);
    }
    return out;
  } },
  mu_taiko: { srate: 0.375, cat: 'music', v: 2, g: 1, wet: 0.5, render: (sr, rng) => {
    const out = thud(sr, 96 + rng.next() * 6, 50, 1.3, 0.07, 1.4);
    S.mix(out, noiseHit(sr, rng, 'bandpass', 650, 1, 0.08), sr, 0.45);
    S.mix(out, S.env(S.filter(S.brown(sr, 0.8, rng), sr, 'lowpass', 170), sr, 0.002, 0.6), sr, 0.4);
    return out;
  } },
  mu_drum: { srate: 0.5, cat: 'music', v: 2, g: 1, wet: 0.4, render: (sr, rng) => {
    const out = thud(sr, 200 + rng.next() * 20, 125, 0.38, 0.03, 1.5);
    return S.mix(out, noiseHit(sr, rng, 'bandpass', 1500, 1.3, 0.05), sr, 0.5);
  } },
  mu_boom: { srate: 0.25, cat: 'music', v: 1, g: 1, wet: 0.55, render: (sr, rng) => {
    const out = thud(sr, 60, 31, 2.2, 0.1, 1.5);
    S.mix(out, S.env(S.filter(S.brown(sr, 2, rng), sr, 'lowpass', 130), sr, 0.005, 1.8), sr, 0.55);
    return S.mix(out, noiseHit(sr, rng, 'lowpass', 1800, 0.7, 0.06), sr, 0.3);
  } },
  mu_cym: { srate: 0.5, cat: 'music', v: 1, g: 1, wet: 0.5, render: (sr, rng) => {
    // Suspended-cymbal swell (mallet roll) peaking at SWELL_PEAK, then choked.
    const peak = SWELL_PEAK.mu_cym;
    const out = S.filter(S.noise(sr, 3.2, rng), sr, 'highpass', 2600, 0.7);
    S.mix(out, S.filter(S.noise(sr, 3.2, rng), sr, 'bandpass', 5200, 0.8), sr, 0.6);
    return S.shape(out, sr, (t) => (t < peak ? Math.pow(t / peak, 2.4) : Math.exp(-(t - peak) * 9)));
  } },
  mu_crash: { srate: 0.5, cat: 'music', v: 1, g: 1, wet: 0.5, render: (sr, rng) => {
    const out = S.env(S.filter(S.noise(sr, 2.2, rng), sr, 'highpass', 3200, 0.7), sr, 0.003, 2);
    return S.mix(out, S.env(S.filter(S.noise(sr, 0.4, rng), sr, 'bandpass', 4500, 1), sr, 0.001, 0.3), sr, 0.5);
  } },
};
