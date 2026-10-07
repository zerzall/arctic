// Offline DSP toolkit for the procedural sound bank. Everything renders into plain
// Float32Arrays so the bank is baked once (and can be unit-tested in Node) and later
// played back as AudioBuffers for the price of a single buffer-source node per shot.
//
// Conventions: `sr` is the sample rate, times are seconds, frequencies Hz. Generators
// return a new buffer; transforms work in place and return the same buffer so calls
// can be nested: env(filter(noise(sr, 0.2, rng), sr, 'lowpass', 900), sr, 0.001, 0.2).

import { TAU, clamp } from '../shared/math.js';

/** ln(1000): converts a "time to -60 dB" into an exponential rate. */
export const LN1000 = Math.log(1000);

/** Zeroed mono buffer of `dur` seconds (at least one sample). */
export function makeBuf(sr, dur) {
  return new Float32Array(Math.max(1, Math.ceil(sr * dur)));
}

// ---- frequency curves --------------------------------------------------------------

/** Exponential glide from f0 to f1 over `dur` seconds, then holds f1. */
export function expSweep(f0, f1, dur) {
  const r = Math.log(f1 / f0);
  return (t) => f0 * Math.exp(r * Math.min(1, t / dur));
}

/** Fast pitch drop: starts at f0 and settles on f1 with time constant `tc` (kick drums, thumps). */
export function drop(f0, f1, tc) {
  return (t) => f1 + (f0 - f1) * Math.exp(-t / tc);
}

/** Piecewise-linear curve through [[t, v], ...] (times ascending). */
export function curve(points) {
  const n = points.length;
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < n; i++) {
      const p = points[i];
      if (t <= p[0]) {
        const q = points[i - 1];
        return q[1] + (p[1] - q[1]) * ((t - q[0]) / (p[0] - q[0] || 1));
      }
    }
    return points[n - 1][1];
  };
}

// ---- sources -----------------------------------------------------------------------

/** White noise in [-1, 1). */
export function noise(sr, dur, rng) {
  const b = makeBuf(sr, dur);
  for (let i = 0; i < b.length; i++) b[i] = rng.next() * 2 - 1;
  return b;
}

/** Pink-ish noise (Paul Kellet's economy filter), roughly unit peak. */
export function pink(sr, dur, rng) {
  const b = makeBuf(sr, dur);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < b.length; i++) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    b[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
  return b;
}

/** Brown (red) noise: leaky-integrated white, for rumbles and roars. */
export function brown(sr, dur, rng) {
  const b = makeBuf(sr, dur);
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    y = (y + 0.02 * (rng.next() * 2 - 1)) * 0.998;
    b[i] = y * 3.2;
  }
  return b;
}

function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/**
 * Oscillator. `freq` is a number or a function of time. type: 'sine'|'saw'|'square'|
 * 'tri'|'pulse' (pulse uses `pw`). Band-limited (polyBLEP) saw/square so pitch sweeps
 * don't alias into hiss.
 */
export function osc(sr, dur, type, freq, { phase = 0, pw = 0.5 } = {}) {
  const b = makeBuf(sr, dur);
  const fn = typeof freq === 'function' ? freq : null;
  let ph = phase % 1;
  for (let i = 0; i < b.length; i++) {
    const f = fn ? fn(i / sr) : freq;
    const dt = clamp(f / sr, 0, 0.5);
    let v;
    switch (type) {
      case 'sine': v = Math.sin(TAU * ph); break;
      case 'saw': v = 2 * ph - 1 - polyBlep(ph, dt); break;
      case 'tri': v = 1 - 4 * Math.abs(ph - 0.5); break;
      case 'square':
      case 'pulse': {
        const w = type === 'square' ? 0.5 : pw;
        v = (ph < w ? 1 : -1) + polyBlep(ph, dt) - polyBlep((ph + 1 - w) % 1, dt);
        break;
      }
      default: v = 0;
    }
    b[i] = v;
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return b;
}

/** Sum of sine partials [[ratio, gain, decay60]] over `f0`: bells, metal rings, coins. */
export function partials(sr, dur, f0, list) {
  const b = makeBuf(sr, dur);
  for (const [ratio, gain, dec] of list) {
    const f = f0 * ratio;
    if (f >= sr * 0.49) continue;
    const k = LN1000 / dec;
    const w = TAU * f / sr;
    const n = Math.min(b.length, Math.ceil(dec * sr));
    for (let i = 0; i < n; i++) b[i] += Math.sin(w * i) * gain * Math.exp(-k * i / sr);
  }
  return b;
}

/** Two-operator FM bell: carrier `f`, modulator f*ratio, index decaying with the note. */
export function fmBell(sr, dur, f, { ratio = 3.5, index = 3, decay = 1.2, idxDecay = 0.4 } = {}) {
  const b = makeBuf(sr, dur);
  const k = LN1000 / decay, ki = LN1000 / idxDecay;
  const wc = TAU * f / sr, wm = wc * ratio;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const I = index * Math.exp(-ki * t);
    b[i] = Math.sin(wc * i + I * Math.sin(wm * i)) * Math.exp(-k * t);
  }
  return b;
}

/** Karplus-Strong plucked string (crossbow twang, creaks). */
export function pluck(sr, dur, freq, rng, { decay = 0.996, bright = 0.5 } = {}) {
  const b = makeBuf(sr, dur);
  const period = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = rng.next() * 2 - 1;
  let idx = 0, prev = 0;
  const a = clamp(bright, 0, 1);
  for (let i = 0; i < b.length; i++) {
    const cur = line[idx];
    b[i] = cur;
    // Averaging filter with adjustable brightness: a=1 keeps highs, a=0 plain average.
    const next = decay * (a * cur + (1 - a) * 0.5 * (cur + prev));
    prev = cur;
    line[idx] = next;
    idx = idx + 1 === period ? 0 : idx + 1;
  }
  return b;
}

/**
 * Sparse crackle: random short noise ticks. `rate` (events/s) may be a function of time;
 * each tick's loudness follows a power law so a few pops stand out of the fizz.
 */
export function crackle(sr, dur, rng, { rate = 40, tickMin = 0.0008, tickMax = 0.004, power = 2.5 } = {}) {
  const b = makeBuf(sr, dur);
  const fn = typeof rate === 'function' ? rate : null;
  for (let i = 0; i < b.length; i++) {
    const r = fn ? fn(i / sr) : rate;
    if (rng.next() >= r / sr) continue;
    const amp = Math.pow(rng.next(), power) * (rng.next() < 0.5 ? -1 : 1);
    const len = Math.ceil((tickMin + rng.next() * (tickMax - tickMin)) * sr);
    const k = 5 / len;
    for (let j = 0; j < len && i + j < b.length; j++) {
      b[i + j] += amp * (rng.next() * 2 - 1) * Math.exp(-k * j);
    }
  }
  return b;
}

/**
 * Formant-filtered buzz: a jittery glottal sawtooth (plus breath noise and vocal-fry
 * subharmonics) through three parallel band-pass formants. Drives every zombie groan,
 * shriek and roar and the survivors' grunts.
 *
 * opts.f0(t)       pitch curve
 * opts.vowel(t)    → [[f1, f2, f3]] formant centres (use vowelPath)
 * opts.shift       formant scale (<1 = bigger throat)
 * opts.breath      0..1 aspiration noise
 * opts.fry         0..1 subharmonic roughness
 * opts.jitter      0..1 pitch instability
 * opts.bw          formant bandwidth scale
 */
export function voice(sr, dur, rng, opts) {
  const { f0, vowel, shift = 1, breath = 0.1, fry = 0, jitter = 0.3, bw = 1 } = opts;
  const src = makeBuf(sr, dur);
  let ph = 0, drift = 0, fryPh = 0;
  for (let i = 0; i < src.length; i++) {
    const t = i / sr;
    // Slow random walk of pitch: organic wobble instead of a synth-like steady tone.
    drift += (rng.next() - 0.5) * 0.02 * jitter;
    drift *= 0.9995;
    const f = f0(t) * (1 + drift + (rng.next() - 0.5) * 0.02 * jitter);
    const dt = clamp(f / sr, 0, 0.5);
    let v = 2 * ph - 1 - polyBlep(ph, dt);
    ph += dt;
    if (ph >= 1) {
      ph -= 1;
      fryPh ^= 1;
    }
    // Vocal fry: every other glottal period is weaker, which the ear hears as a rasp.
    if (fry > 0 && fryPh) v *= 1 - fry * 0.85;
    src[i] = v + (rng.next() * 2 - 1) * breath * 1.6;
  }
  const out = makeBuf(sr, dur);
  const gains = [1, 0.55, 0.28];
  const bws = [90, 120, 170];
  for (let k = 0; k < 3; k++) {
    const layer = src.slice();
    filter(layer, sr, 'bandpass', (t) => vowel(t)[k] * shift, (t) => (vowel(t)[k] * shift) / (bws[k] * bw));
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * gains[k];
  }
  return out;
}

/** Vowel formant table (approximate adult male F1-F3). */
export const VOWELS = {
  u: [300, 870, 2240],
  o: [570, 840, 2410],
  a: [730, 1090, 2440],
  uh: [520, 1190, 2390],
  ae: [660, 1720, 2410],
  i: [270, 2290, 3010],
  er: [490, 1350, 1690],
  e: [530, 1840, 2480],
};

/** Formant path morphing evenly through a list of vowel names over `dur`. */
export function vowelPath(names, dur) {
  const pts = names.map((n) => VOWELS[n] || VOWELS.uh);
  const out = [0, 0, 0];
  return (t) => {
    if (pts.length === 1) return pts[0];
    const x = clamp(t / dur, 0, 1) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(x));
    const f = x - i;
    for (let k = 0; k < 3; k++) out[k] = pts[i][k] + (pts[i + 1][k] - pts[i][k]) * f;
    return out;
  };
}

// ---- filters -----------------------------------------------------------------------

const CO = new Float64Array(5);

function coefs(type, f, q, sr, gainDb) {
  f = clamp(f, 10, sr * 0.45);
  q = Math.max(0.05, q);
  const w = TAU * f / sr;
  const cw = Math.cos(w), sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case 'peaking': {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    }
    case 'notch':
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    default: // lowpass
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  CO[0] = b0 / a0; CO[1] = b1 / a0; CO[2] = b2 / a0; CO[3] = a1 / a0; CO[4] = a2 / a0;
}

/**
 * RBJ biquad in place. `freq` and `q` may be functions of time (coefficients are
 * refreshed every 16 samples, plenty for sweeps). 'bandpass' has 0 dB peak gain.
 */
export function filter(buf, sr, type, freq, q = 0.707, gainDb = 0) {
  const ff = typeof freq === 'function' ? freq : null;
  const qf = typeof q === 'function' ? q : null;
  coefs(type, ff ? ff(0) : freq, qf ? qf(0) : q, sr, gainDb);
  let b0 = CO[0], b1 = CO[1], b2 = CO[2], a1 = CO[3], a2 = CO[4];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const dyn = ff || qf;
  for (let i = 0; i < buf.length; i++) {
    if (dyn && (i & 15) === 0 && i) {
      const t = i / sr;
      coefs(type, ff ? ff(t) : freq, qf ? qf(t) : q, sr, gainDb);
      b0 = CO[0]; b1 = CO[1]; b2 = CO[2]; a1 = CO[3]; a2 = CO[4];
    }
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1;
    // Flush denormals: long decays otherwise crawl on some CPUs.
    y1 = Math.abs(y) < 1e-20 ? 0 : y;
    buf[i] = y1;
  }
  return buf;
}

/** Feedback comb (tube/body resonance) in place. */
export function comb(buf, sr, freq, feedback) {
  const d = Math.max(1, Math.round(sr / freq));
  for (let i = d; i < buf.length; i++) buf[i] += feedback * buf[i - d];
  return buf;
}

// ---- envelopes & shaping -------------------------------------------------------------

/**
 * Attack/hold/decay envelope in place: linear rise over `a`, flat for `h`, then an
 * exponential fall reaching -60 dB after `d` seconds.
 */
export function env(buf, sr, a, d, h = 0) {
  const k = LN1000 / Math.max(1e-4, d);
  const an = a * sr, hn = h * sr;
  for (let i = 0; i < buf.length; i++) {
    let g;
    if (i < an) g = i / an;
    else if (i < an + hn) g = 1;
    else g = Math.exp(-k * (i - an - hn) / sr);
    buf[i] *= g;
  }
  return buf;
}

/** Multiply by a gain curve g(t) in place. */
export function shape(buf, sr, g) {
  for (let i = 0; i < buf.length; i++) buf[i] *= g(i / sr);
  return buf;
}

/** Random amplitude flutter in place: smoothed noise AM at roughly `rate` Hz. */
export function flutter(buf, sr, rng, rate, depth) {
  let cur = 1, target = 1;
  const step = Math.max(1, Math.round(sr / rate));
  const k = 1 - Math.exp(-rate * 4 / sr);
  for (let i = 0; i < buf.length; i++) {
    if (i % step === 0) target = 1 - depth * rng.next();
    cur += (target - cur) * k;
    buf[i] *= cur;
  }
  return buf;
}

/** Soft saturation in place (tanh), gain-compensated so a unit peak stays a unit peak. */
export function drive(buf, amount) {
  if (amount <= 0) return buf;
  const n = Math.tanh(amount);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * amount) / n;
  return buf;
}

/** Scale in place. */
export function gain(buf, g) {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** Add `src * g` into `dst` starting at `at` seconds (clipped to dst's length). */
export function mix(dst, src, sr, g = 1, at = 0) {
  const off = Math.round(at * sr);
  const n = Math.min(src.length, dst.length - off);
  for (let i = Math.max(0, -off); i < n; i++) dst[i + off] += src[i] * g;
  return dst;
}

/** Like mix, but wraps around the end of `dst` (for building seamless loops). */
export function mixWrap(dst, src, sr, g = 1, at = 0) {
  const len = dst.length;
  let j = ((Math.round(at * sr) % len) + len) % len;
  for (let i = 0; i < src.length; i++) {
    dst[j] += src[i] * g;
    j = j + 1 === len ? 0 : j + 1;
  }
  return dst;
}

/** Add delayed, darkened copies: [[delaySec, gain, lowpassHz]] (slapback, rolling echoes). */
export function echoes(buf, sr, taps) {
  const dry = buf.slice();
  for (const [delay, g, lp] of taps) {
    const wet = lp ? filter(dry.slice(), sr, 'lowpass', lp, 0.6) : dry;
    mix(buf, wet, sr, g, delay);
  }
  return buf;
}

/** Linear fade-out over the last `sec` seconds, in place (kills clicks at the end). */
export function fadeOut(buf, sr, sec) {
  const n = Math.min(buf.length, Math.ceil(sec * sr));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

/** Linear fade-in over the first `sec` seconds, in place. */
export function fadeIn(buf, sr, sec) {
  const n = Math.min(buf.length, Math.ceil(sec * sr));
  for (let i = 0; i < n; i++) buf[i] *= i / n;
  return buf;
}

/** Remove DC offset (one-pole high-pass at ~20 Hz) in place. */
export function dcBlock(buf, sr) {
  const r = Math.exp(-TAU * 20 / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    y1 = x - x1 + r * y1;
    x1 = x;
    buf[i] = y1;
  }
  return buf;
}

/** Largest absolute sample. */
export function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

/** Root mean square over [from, to) samples. */
export function rms(buf, from = 0, to = buf.length) {
  let s = 0;
  to = Math.min(to, buf.length);
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

/** Scale so the peak equals `target` (silent buffers are left alone). */
export function normalize(buf, target = 0.9) {
  const p = peak(buf);
  if (p > 1e-9) gain(buf, target / p);
  return buf;
}

/**
 * Make a seamless loop: returns a buffer `fade` seconds shorter whose head is an
 * equal-power crossfade with the original tail.
 */
export function loopify(buf, sr, fade) {
  const fn = Math.min(Math.floor(buf.length / 2), Math.ceil(fade * sr));
  const out = buf.slice(0, buf.length - fn);
  const tail = buf.length - fn;
  for (let i = 0; i < fn; i++) {
    const g = i / fn;
    out[i] = buf[i] * Math.sin(g * Math.PI / 2) + buf[tail + i] * Math.cos(g * Math.PI / 2);
  }
  return out;
}

/** Trim trailing near-silence (below `floor`) so buffers don't hold voices longer than audible. */
export function trim(buf, sr, floor = 0.001, pad = 0.01) {
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]) < floor) end--;
  end = Math.min(buf.length, end + Math.ceil(pad * sr));
  return end < buf.length ? fadeOut(buf.slice(0, end), sr, Math.min(0.01, end / sr / 4)) : buf;
}
