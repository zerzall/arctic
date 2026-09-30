// The ambience of the story hideouts (SPEC §3.9): a night bed of crickets, wind and an owl,
// a day bed of birds, bees and breeze, the murmur of a radio, a generator's hum, the forge's
// bellows and hammer, chickens in the run, water lapping with frogs, a windmill's creak.
// Recipes in the same shape as sounds.js (rendered offline by synth.js, deterministic per
// (id, variant, sample rate)); all of them are seamless loops. Fires already crackle through
// the map's own fire loop.

import * as S from './synth.js';

const TAU = Math.PI * 2;

/** Random on/off gating in place (speech-like syllables, bubbling). */
function gate(buf, sr, rng, minSeg, maxSeg, pOn) {
  let i = 0;
  while (i < buf.length) {
    const len = Math.ceil((minSeg + rng.next() * (maxSeg - minSeg)) * sr);
    const on = rng.next() < pOn;
    const fade = Math.min(24, len >> 2);
    for (let j = 0; j < len && i + j < buf.length; j++) {
      if (!on) buf[i + j] = 0;
      else if (j < fade) buf[i + j] *= j / fade;
      else if (j > len - fade) buf[i + j] *= (len - j) / fade;
    }
    i += len;
  }
  return buf;
}

/** One cricket: chirps of three fast pulses on a pure tone, repeated every `period` s. */
function cricket(sr, rng, out, len, f0, period, phase, g) {
  for (let t = phase; t < len; t += period * (0.97 + rng.next() * 0.06)) {
    for (let k = 0; k < 3; k++) {
      const p = S.env(S.osc(sr, 0.024, 'sine', f0 * (1 + k * 0.004)), sr, 0.002, 0.012);
      S.mixWrap(out, p, sr, g * (0.75 + 0.25 * rng.next()), t + k * 0.03);
    }
  }
}

/** A bird's phrase: a few short chirps sweeping upward. */
function tweet(sr, rng, f0) {
  const n = 2 + Math.floor(rng.next() * 3);
  const out = S.makeBuf(sr, n * 0.11 + 0.06);
  for (let i = 0; i < n; i++) {
    const f = f0 * (0.9 + rng.next() * 0.3);
    const chirp = S.env(S.osc(sr, 0.1, 'sine', S.expSweep(f, f * (1.12 + rng.next() * 0.45), 0.07)), sr, 0.004, 0.06);
    S.mix(out, chirp, sr, 0.8, i * 0.11);
  }
  return out;
}

function hoot(sr) {
  return S.filter(S.env(S.osc(sr, 0.5, 'sine', S.drop(440, 350, 0.16)), sr, 0.03, 0.26), sr, 'lowpass', 900);
}

function lowShape(pts) {
  return S.curve(pts);
}

export const HUB_SOUNDS = {
  hub_night: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.42, wet: 0.3, peak: 0.85, render: (sr, rng) => {
    const len = 8;
    const out = S.filter(S.pink(sr, len, rng), sr, 'lowpass', 520, 0.6);
    S.shape(out, sr, lowShape([[0, 0.5], [1.7, 0.95], [4, 0.45], [6, 1], [8, 0.5]]));
    S.gain(out, 0.5);
    const voices = [[4300, 0.62, 0.05, 0.12], [4650, 0.53, 0.3, 0.1], [5000, 0.71, 0.11, 0.09], [4100, 0.83, 0.4, 0.1], [4850, 0.58, 0.22, 0.08]];
    for (const [f, per, ph, g] of voices) cricket(sr, rng, out, len, f, per, ph, g);
    S.mixWrap(out, hoot(sr), sr, 0.16, 3.3);
    S.mixWrap(out, hoot(sr), sr, 0.12, 4.05);
    // dry leaves stirred by the breeze
    const leaves = S.filter(S.noise(sr, len, rng), sr, 'highpass', 3000);
    gate(leaves, sr, rng, 0.05, 0.4, 0.3);
    S.mix(out, S.filter(leaves, sr, 'lowpass', 7000), sr, 0.05);
    return S.loopify(out, sr, 0.5);
  } },
  hub_day: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.4, wet: 0.25, peak: 0.85, render: (sr, rng) => {
    const len = 8;
    const out = S.filter(S.pink(sr, len, rng), sr, 'lowpass', 720, 0.6);
    S.shape(out, sr, lowShape([[0, 0.4], [2, 0.85], [4.7, 0.4], [6.7, 0.9], [8, 0.4]]));
    S.gain(out, 0.4);
    for (let i = 0; i < 6; i++) S.mixWrap(out, tweet(sr, rng, 2700 + rng.next() * 1300), sr, 0.16 + rng.next() * 0.14, rng.next() * len);
    // a bee or two, a distant tractor-like drone
    const bee = S.filter(S.osc(sr, len, 'saw', 190), sr, 'bandpass', 700, 1.4);
    S.shape(bee, sr, (t) => 0.5 + 0.5 * Math.sin(TAU * 0.25 * t) ** 2 * (0.6 + 0.4 * Math.sin(TAU * 6 * t)));
    S.mix(out, bee, sr, 0.04);
    return S.loopify(out, sr, 0.5);
  } },
  hub_radio: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.32, wet: 0.15, peak: 0.8, range: 0.3, render: (sr, rng) => {
    const len = 8;
    const speech = S.filter(S.noise(sr, len, rng), sr, 'bandpass', 1100, 0.9);
    S.mix(speech, S.filter(S.noise(sr, len, rng), sr, 'bandpass', 2400, 2), sr, 0.6);
    gate(speech, sr, rng, 0.07, 0.28, 0.62);
    const out = speech;
    S.mix(out, S.filter(S.pink(sr, len, rng), sr, 'highpass', 3200), sr, 0.12);
    S.mix(out, S.filter(S.crackle(sr, len, rng, { rate: 12, tickMax: 0.004 }), sr, 'bandpass', 2200, 0.7), sr, 0.4);
    for (const at of [3.2, 3.36, 6.6]) S.mix(out, S.env(S.osc(sr, 0.1, 'sine', 880), sr, 0.004, 0.08), sr, 0.5, at);
    return S.loopify(S.filter(out, sr, 'bandpass', 1500, 0.5), sr, 0.4);
  } },
  hub_gen: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.4, wet: 0.1, peak: 0.85, range: 0.35, render: (sr, rng) => {
    const len = 2;
    const out = S.osc(sr, len, 'saw', 50);
    S.filter(out, sr, 'lowpass', 320, 0.8);
    S.mix(out, S.osc(sr, len, 'sine', 100), sr, 0.7);
    S.mix(out, S.osc(sr, len, 'sine', 200), sr, 0.35);
    S.shape(out, sr, (t) => 0.72 + 0.28 * Math.sin(TAU * 12.5 * t));
    S.mix(out, S.filter(S.brown(sr, len, rng), sr, 'lowpass', 400), sr, 0.5);
    return S.loopify(out, sr, 0.2);
  } },
  hub_forge: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.42, wet: 0.2, peak: 0.85, range: 0.4, render: (sr, rng) => {
    const len = 8;
    const out = S.filter(S.brown(sr, len, rng), sr, 'lowpass', 420, 0.7);
    S.shape(out, sr, (t) => 0.25 + 0.75 * ((1 + Math.sin(TAU * 0.25 * t - 1.2)) / 2) ** 2);
    S.mix(out, S.filter(S.crackle(sr, len, rng, { rate: 25, tickMax: 0.005 }), sr, 'bandpass', 2400, 0.6), sr, 0.7);
    for (const t of [0.7, 1.02, 1.36, 4.3, 4.62, 4.98, 5.3]) {
      const f = 1200 + rng.next() * 900;
      const ping = S.env(S.fmBell(sr, 0.6, f, { ratio: 3.5, index: 2, decay: 0.3 }), sr, 0.0008, 0.32);
      S.mix(out, ping, sr, 0.45 + rng.next() * 0.25, t);
      S.mix(out, S.filter(S.env(S.noise(sr, 0.04, rng), sr, 0.0005, 0.02), sr, 'bandpass', 3200, 1.5), sr, 0.4, t);
    }
    return S.loopify(out, sr, 0.4);
  } },
  hub_coop: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.36, wet: 0.2, peak: 0.8, range: 0.35, render: (sr, rng) => {
    const len = 8;
    const out = S.makeBuf(sr, len);
    for (let g = 0; g < 4; g++) {
      const t0 = 0.3 + g * 2 + rng.next() * 0.8;
      const n = 2 + Math.floor(rng.next() * 4);
      for (let i = 0; i < n; i++) {
        const f = 700 + rng.next() * 350;
        const c = S.filter(S.env(S.osc(sr, 0.14, 'sine', S.drop(f, f * 0.55, 0.035)), sr, 0.004, 0.07), sr, 'bandpass', 900, 1.2);
        S.mixWrap(out, c, sr, 0.5 + rng.next() * 0.4, t0 + i * (0.12 + rng.next() * 0.1));
      }
    }
    S.mix(out, S.filter(S.pink(sr, len, rng), sr, 'lowpass', 600), sr, 0.08);
    return S.loopify(out, sr, 0.3);
  } },
  hub_water: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.36, wet: 0.35, peak: 0.8, range: 0.4, render: (sr, rng) => {
    const len = 8;
    const out = S.filter(S.pink(sr, len, rng), sr, 'bandpass', 520, 0.5);
    S.shape(out, sr, (t) => 0.4 + 0.6 * ((1 + Math.sin(TAU * 0.25 * t)) / 2) ** 1.5);
    S.gain(out, 0.5);
    for (let i = 0; i < 5; i++) {
      const t0 = rng.next() * len, f = 240 + rng.next() * 140;
      for (let k = 0; k < 3; k++) {
        const r = S.env(S.osc(sr, 0.12, 'sine', f * (1 + k * 0.05)), sr, 0.004, 0.08);
        for (let j = 0; j < r.length; j++) r[j] *= 0.6 + 0.4 * Math.sin(TAU * 45 * (j / sr));
        S.mixWrap(out, r, sr, 0.18 + rng.next() * 0.1, t0 + k * 0.13);
      }
    }
    return S.loopify(out, sr, 0.5);
  } },
  hub_windmill: { srate: 0.5, cat: 'ambience', loop: true, v: 1, g: 0.34, wet: 0.3, peak: 0.8, range: 0.5, render: (sr, rng) => {
    const len = 3.6;
    const out = S.filter(S.brown(sr, len, rng), sr, 'lowpass', 320, 0.7);
    S.shape(out, sr, (t) => 0.4 + 0.6 * ((1 + Math.sin(TAU * (1 / 1.8) * t)) / 2));
    for (const t of [0.2, 2.0]) S.mix(out, S.env(S.osc(sr, 0.3, 'sine', S.expSweep(620, 860, 0.25)), sr, 0.03, 0.2), sr, 0.16, t);
    return S.loopify(out, sr, 0.3);
  } },
};
