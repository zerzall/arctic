// The procedural sound bank: a recipe per sound id, rendered offline into Float32Arrays
// by synth.js. Every recipe is deterministic for (id, variant, sampleRate), so the bank
// can be baked in the browser at unlock and checked numerically in Node tests.
//
// Def fields:
//   v      number of variants (picked at random per play, on top of pitch/volume jitter)
//   g      playback gain (loudness balance between sounds; buffers are peak-normalised)
//   cat    sandbox grouping only
//   prio   voice-stealing priority (higher survives)
//   wet    reverb send 0..1
//   range  audible-distance multiplier (1 = AUDIBLE_RANGE px)
//   lim    [minGapSeconds, maxConcurrent] rate limit, shared by every sound in `group`
//   group  rate-limit group (defaults to the id)
//   loop   seamless loop buffer (used by the loop voices, never as a one-shot)
//   peak   normalisation target (default 0.9)
//   pv     random pitch variation per play (default 0.04 = ±4%)
//   srate  render at this fraction of the context rate (dark/long sounds: halves memory
//          and bake time; WebAudio resamples on playback)

import { createRng, hashString } from '../shared/rng.js';
import * as S from './synth.js';

// ---- building blocks -------------------------------------------------------------------

/** ±amt relative jitter. */
function J(rng, x, amt) {
  return x * (1 + (rng.next() * 2 - 1) * amt);
}

/** Short band-passed noise tick (mechanical clicks, clacks). */
function click(sr, rng, f, d = 0.008, q = 2) {
  const b = S.env(S.noise(sr, d * 1.3 + 0.004, rng), sr, 0.0002, d);
  return S.filter(b, sr, 'bandpass', f, q);
}

/** Pitch-dropping sine thump. */
function thud(sr, f0, f1, d, tc = 0.03, drv = 1.4) {
  const b = S.osc(sr, d + 0.02, 'sine', S.drop(f0, f1, tc));
  return S.drive(S.env(b, sr, 0.0015, d), drv);
}

/** Filtered noise burst with an exponential decay. */
function burst(sr, rng, type, f, q, d, a = 0.0005) {
  const b = S.noise(sr, d + a + 0.01, rng);
  S.filter(b, sr, type, f, q);
  return S.env(b, sr, a, d);
}

/** Band-pass noise swept along `pts` ([[t, hz]]) with a matching swell: whooshes. */
function whoosh(sr, rng, dur, pts, q, amp) {
  const b = S.noise(sr, dur, rng);
  S.filter(b, sr, 'bandpass', S.curve(pts), q);
  return S.shape(b, sr, S.curve(amp));
}

/** Random on/off gating in place (electric buzz, velcro, bubbling). */
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

/** Layered gunshot: crack + swept noise body + mid punch + thump + ring + mechanism + tail. */
function gun(sr, rng, p) {
  const out = S.makeBuf(sr, p.dur);
  if (p.crack) {
    const c = burst(sr, rng, 'highpass', J(rng, p.crack.hp, 0.1), 0.7, p.crack.len, 0.0001);
    S.mix(out, c, sr, p.crack.g);
  }
  if (p.spray) {
    // Individual pellets leaving the barrel: a smear of micro-transients.
    for (let i = 0; i < p.spray; i++) S.mix(out, click(sr, rng, J(rng, 2500, 0.4), 0.003, 0.8), sr, 0.35, rng.next() * 0.012);
  }
  if (p.body) {
    const b = S.noise(sr, p.body.d + 0.05, rng);
    S.filter(b, sr, 'lowpass', S.expSweep(J(rng, p.body.f0, 0.1), J(rng, p.body.f1, 0.1), p.body.d * 0.6), 0.9);
    S.mix(out, S.env(b, sr, 0.0006, J(rng, p.body.d, 0.08)), sr, p.body.g);
  }
  if (p.punch) {
    S.mix(out, burst(sr, rng, 'bandpass', J(rng, p.punch.f, 0.08), p.punch.q || 1, p.punch.d, 0.0008), sr, p.punch.g);
  }
  if (p.thump) {
    const t = thud(sr, J(rng, p.thump.f0, 0.06), J(rng, p.thump.f1, 0.05), p.thump.d, p.thump.tc || 0.025, 1.6);
    S.mix(out, t, sr, p.thump.g);
  }
  if (p.ring) S.mix(out, S.partials(sr, p.ring.d, J(rng, p.ring.f, 0.03), p.ring.list), sr, p.ring.g);
  if (p.mech) for (const [at, f, g] of p.mech) S.mix(out, click(sr, rng, J(rng, f, 0.08), 0.01, 2.5), sr, g, J(rng, at, 0.1));
  if (p.tail) {
    const tl = S.filter(S.pink(sr, p.tail.d + 0.05, rng), sr, 'lowpass', p.tail.lp, 0.6);
    S.mix(out, S.env(tl, sr, 0.008, p.tail.d), sr, p.tail.g);
  }
  S.drive(out, p.drive || 1.4);
  if (p.echo) S.echoes(out, sr, p.echo);
  return out;
}

/** Explosion: crack + pitch-dropping boom + swept body + rumble + debris crackle + falling chunks. */
function explosion(sr, rng, p) {
  const out = S.makeBuf(sr, p.dur);
  S.mix(out, S.filter(burst(sr, rng, 'lowpass', 9000, 0.7, p.crackD || 0.03, 0.0002), sr, 'highpass', 300), sr, p.crackG ?? 0.9);
  S.mix(out, thud(sr, J(rng, p.f0, 0.08), J(rng, p.f1, 0.06), p.boomD, p.tc || 0.12, 2.2), sr, p.boomG ?? 1);
  const body = S.noise(sr, p.bodyD + 0.1, rng);
  S.filter(body, sr, 'lowpass', S.expSweep(p.bodyF || 5000, 160, p.bodyD * 0.5), 0.8);
  S.mix(out, S.env(body, sr, 0.003, p.bodyD), sr, p.bodyG ?? 0.9);
  const rum = S.filter(S.brown(sr, p.rumbleD + 0.1, rng), sr, 'lowpass', 140, 0.7);
  S.mix(out, S.env(rum, sr, 0.03, p.rumbleD), sr, p.rumbleG ?? 0.5);
  if (p.debris) {
    const k = p.debrisDecay || 0.5;
    const d = S.crackle(sr, p.dur * 0.8, rng, { rate: (t) => (t < 0.04 ? 0 : p.debris * Math.exp(-t / k)), tickMax: 0.006 });
    S.filter(d, sr, 'bandpass', 2600, 0.5);
    S.mix(out, d, sr, p.debrisG ?? 0.4);
  }
  for (let i = 0; i < (p.chunks || 0); i++) {
    const at = 0.15 + rng.next() * 0.9;
    const c = thud(sr, J(rng, 170, 0.3), 60, 0.07, 0.015);
    S.mix(c, burst(sr, rng, 'lowpass', 1500, 0.7, 0.05), sr, 0.6);
    S.mix(out, c, sr, 0.15 + rng.next() * 0.25, at);
  }
  S.drive(out, p.drive || 2);
  return out;
}

/** Wet splatter drops (bloater burst, gibs). */
function splats(sr, rng, out, n, from, to, g) {
  for (let i = 0; i < n; i++) {
    const at = from + rng.next() * (to - from);
    const s = burst(sr, rng, 'lowpass', 700 + rng.next() * 1600, 1.2, 0.03 + rng.next() * 0.05);
    S.mix(s, thud(sr, J(rng, 230, 0.3), 90, 0.04, 0.01, 1), sr, 0.3);
    S.mix(out, s, sr, g * (0.4 + rng.next() * 0.6), at);
  }
  return out;
}

/** Monster/human vocal: formant voice with an envelope, drive and optional sub-octave. */
function vocal(sr, rng, p) {
  const f0 = typeof p.f0 === 'function' ? p.f0 : S.curve(p.f0);
  const vib = p.vib || 0;
  const pitch = vib ? (t) => f0(t) * (1 + vib * Math.sin(6.5 * 6.2832 * t)) : f0;
  const b = S.voice(sr, p.dur, rng, {
    f0: pitch, vowel: S.vowelPath(p.vowels, p.dur), shift: p.shift || 1,
    breath: p.breath ?? 0.2, fry: p.fry ?? 0.4, jitter: p.jitter ?? 0.6, bw: p.bw || 1,
  });
  if (p.sub) {
    const sub = S.osc(sr, p.dur, 'sine', (t) => pitch(t) * 0.5);
    S.mix(b, S.drive(sub, 1.5), sr, p.sub);
  }
  if (p.growl) {
    const gr = S.filter(S.noise(sr, p.dur, rng), sr, 'bandpass', p.growlF || 400, 1.2);
    S.mix(b, S.flutter(gr, sr, rng, 30, 0.9), sr, p.growl);
  }
  if (p.bubble) S.flutter(b, sr, rng, p.bubble, 0.8);
  S.env(b, sr, p.a ?? 0.05, p.d ?? p.dur * 0.8, p.h || 0);
  S.drive(S.normalize(b, 1), p.drive || 1.8);
  if (p.lp) S.filter(b, sr, 'lowpass', p.lp, 0.7);
  return S.fadeOut(b, sr, 0.03);
}

/** Detuned-saw chord (stingers); `cutoff` 0 leaves it unfiltered for the caller to shape. */
function chord(sr, dur, freqs, cutoff, detune = 0.006) {
  const b = S.makeBuf(sr, dur);
  for (const f of freqs) {
    S.mix(b, S.osc(sr, dur, 'saw', f * (1 + detune)), sr, 0.3);
    S.mix(b, S.osc(sr, dur, 'saw', f * (1 - detune), { phase: 0.37 }), sr, 0.3);
  }
  return cutoff ? S.filter(b, sr, 'lowpass', cutoff, 0.9) : b;
}

/** Coin / small metal ping. */
function coin(sr, rng, f) {
  return S.partials(sr, 0.3, f, [[1, 1, 0.25], [2.76, 0.5, 0.18], [5.4, 0.25, 0.12], [8.9, 0.1, 0.06]]);
}

/** Tonal blip for UI (triangle with a soft attack). */
function blip(sr, f, d, type = 'tri') {
  return S.env(S.osc(sr, d + 0.01, type, f), sr, 0.004, d);
}

/** Minigun single shot, reused to build the rapid-fire loop. */
function miniShot(sr, rng) {
  return gun(sr, rng, {
    dur: 0.12, crack: { len: 0.003, hp: 2500, g: 0.8 }, body: { f0: 5000, f1: 700, d: 0.045, g: 0.75 },
    punch: { f: 1300, q: 1.2, d: 0.03, g: 0.5 }, thump: { f0: 190, f1: 85, d: 0.05, g: 0.75 }, drive: 1.8,
  });
}

/** Moan for the horde beds. */
function moan(sr, rng, near) {
  const dur = 0.7 + rng.next() * 0.9;
  const base = near ? 70 + rng.next() * 60 : 60 + rng.next() * 45;
  const vowelSets = [['u', 'a', 'uh'], ['o', 'a', 'u'], ['er', 'uh'], ['a', 'o'], ['uh', 'ae', 'u']];
  return vocal(sr, rng, {
    dur, f0: [[0, base], [dur * 0.4, base * J(rng, 1.15, 0.1)], [dur, base * 0.8]],
    vowels: vowelSets[Math.floor(rng.next() * vowelSets.length)], shift: J(rng, near ? 0.95 : 0.9, 0.1),
    breath: 0.3, fry: 0.7, jitter: 1, a: 0.15, d: dur * 0.9, drive: near ? 2.6 : 1.8,
  });
}

// ---- recipes ---------------------------------------------------------------------------

const GUN = { cat: 'gun', prio: 60, wet: 0.35, lim: [0.012, 8] };

export const SOUNDS = {
  // Guns (weapon.sound ids from weapons.js). ----------------------------------------------
  pistol: { ...GUN, v: 4, g: 0.72, render: (sr, rng) => gun(sr, rng, {
    dur: 0.5, crack: { len: 0.006, hp: 2200, g: 0.9 }, body: { f0: 5000, f1: 600, d: 0.09, g: 0.8 },
    punch: { f: 1100, q: 1.2, d: 0.05, g: 0.5 }, thump: { f0: 200, f1: 80, d: 0.09, g: 0.8 },
    mech: [[0.045, 3800, 0.1], [0.062, 2600, 0.08]], tail: { lp: 1800, d: 0.35, g: 0.12 },
    echo: [[0.09, 0.16, 1500]], drive: 1.6 }) },
  magnum: { ...GUN, v: 3, g: 0.85, render: (sr, rng) => gun(sr, rng, {
    dur: 1.0, crack: { len: 0.008, hp: 2000, g: 1 }, body: { f0: 6000, f1: 450, d: 0.16, g: 0.9 },
    punch: { f: 800, q: 1, d: 0.08, g: 0.5 }, thump: { f0: 150, f1: 48, d: 0.2, g: 1, tc: 0.03 },
    ring: { f: 2750, d: 0.2, g: 0.35, list: [[1, 0.08, 0.18], [1.52, 0.05, 0.12]] },
    tail: { lp: 1500, d: 0.7, g: 0.2 }, echo: [[0.12, 0.25, 1200], [0.3, 0.1, 800]], drive: 2.2 }) },
  shotgun: { ...GUN, v: 4, g: 0.85, render: (sr, rng) => gun(sr, rng, {
    dur: 1.2, crack: { len: 0.012, hp: 1200, g: 1 }, spray: 9, body: { f0: 7000, f1: 250, d: 0.28, g: 1.1 },
    punch: { f: 600, q: 0.8, d: 0.12, g: 0.6 }, thump: { f0: 100, f1: 36, d: 0.25, g: 1.1, tc: 0.035 },
    tail: { lp: 1300, d: 0.85, g: 0.28 }, echo: [[0.12, 0.25, 1100], [0.3, 0.12, 800]], drive: 2.6 }) },
  smg: { ...GUN, v: 4, g: 0.6, render: (sr, rng) => gun(sr, rng, {
    dur: 0.32, crack: { len: 0.004, hp: 2800, g: 0.8 }, body: { f0: 4500, f1: 900, d: 0.05, g: 0.7 },
    punch: { f: 1700, q: 1.5, d: 0.035, g: 0.5 }, thump: { f0: 240, f1: 110, d: 0.05, g: 0.6 },
    mech: [[0.025, 4200, 0.1]], tail: { lp: 2000, d: 0.22, g: 0.1 }, drive: 1.6 }) },
  rifle: { ...GUN, v: 4, g: 0.62, render: (sr, rng) => gun(sr, rng, {
    dur: 0.75, crack: { len: 0.006, hp: 2000, g: 1 }, body: { f0: 6500, f1: 500, d: 0.13, g: 0.9 },
    punch: { f: 950, q: 1, d: 0.06, g: 0.5 }, thump: { f0: 160, f1: 55, d: 0.13, g: 0.9 },
    mech: [[0.05, 3300, 0.08]], tail: { lp: 1600, d: 0.5, g: 0.18 }, echo: [[0.1, 0.22, 1400]], drive: 2 }) },
  rifle_heavy: { ...GUN, v: 3, g: 0.78, render: (sr, rng) => gun(sr, rng, {
    dur: 1.0, crack: { len: 0.008, hp: 1800, g: 1 }, body: { f0: 6000, f1: 380, d: 0.18, g: 1 },
    punch: { f: 750, q: 1, d: 0.08, g: 0.5 }, thump: { f0: 130, f1: 42, d: 0.2, g: 1, tc: 0.03 },
    tail: { lp: 1400, d: 0.75, g: 0.22 }, echo: [[0.13, 0.25, 1200], [0.32, 0.1, 900]], drive: 2.4 }) },
  sniper: { ...GUN, v: 3, g: 0.95, range: 1.5, wet: 0.45, render: (sr, rng) => {
    const b = gun(sr, rng, {
      dur: 1.8, crack: { len: 0.01, hp: 1500, g: 1.2 }, body: { f0: 8000, f1: 300, d: 0.25, g: 1 },
      thump: { f0: 110, f1: 32, d: 0.32, g: 1.1, tc: 0.04 }, tail: { lp: 1200, d: 1.2, g: 0.3 },
      echo: [[0.16, 0.3, 1000], [0.38, 0.18, 700], [0.7, 0.1, 500]], drive: 2.6 });
    // Supersonic snap: a sharp N-wave on top of the muzzle blast.
    const n = Math.round(sr * 0.0006);
    for (let i = 0; i < n * 2 && i < b.length; i++) b[i] += i < n ? 0.8 : -0.8;
    return b;
  } },
  lmg: { ...GUN, v: 4, g: 0.62, render: (sr, rng) => gun(sr, rng, {
    dur: 0.6, crack: { len: 0.006, hp: 1900, g: 0.95 }, body: { f0: 5500, f1: 420, d: 0.11, g: 0.9 },
    punch: { f: 820, q: 1, d: 0.06, g: 0.55 }, thump: { f0: 140, f1: 50, d: 0.11, g: 0.95 },
    mech: [[0.035, 2900, 0.1], [0.05, 5200, 0.06]], tail: { lp: 1500, d: 0.42, g: 0.17 },
    echo: [[0.1, 0.2, 1300]], drive: 2.2 }) },
  minigun: { ...GUN, v: 4, g: 0.5, render: (sr, rng) => miniShot(sr, rng) },
  turret_shot: { ...GUN, v: 4, g: 0.45, prio: 55, lim: [0.03, 4], render: (sr, rng) => gun(sr, rng, {
    dur: 0.3, crack: { len: 0.004, hp: 3000, g: 0.8 }, body: { f0: 5000, f1: 1000, d: 0.05, g: 0.6 },
    punch: { f: 2000, q: 2, d: 0.03, g: 0.5 }, thump: { f0: 260, f1: 130, d: 0.04, g: 0.5 },
    mech: [[0.03, 5000, 0.12]], tail: { lp: 2500, d: 0.2, g: 0.08 }, drive: 1.5 }) },
  launcher: { ...GUN, v: 3, g: 0.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.6);
    S.mix(out, thud(sr, J(rng, 230, 0.05), 85, 0.18, 0.04, 1.8), sr, 1);
    // Hollow tube: a tiny impulse through a comb resonator = the "thoonk" of the barrel.
    const tube = S.env(S.noise(sr, 0.2, rng), sr, 0.0005, 0.012);
    S.comb(tube, sr, J(rng, 170, 0.05), 0.86);
    S.mix(out, S.env(S.filter(tube, sr, 'lowpass', 1500), sr, 0, 0.18), sr, 0.5);
    S.mix(out, burst(sr, rng, 'bandpass', 500, 0.8, 0.12, 0.002), sr, 0.4);
    S.mix(out, whoosh(sr, rng, 0.35, [[0, 2500], [0.3, 900]], 1.2, [[0, 0], [0.03, 1], [0.35, 0]]), sr, 0.15, 0.03);
    S.mix(out, click(sr, rng, 3000, 0.01), sr, 0.3);
    return S.drive(out, 1.4);
  } },
  rocket: { ...GUN, v: 2, g: 0.85, wet: 0.45, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.6);
    S.mix(out, thud(sr, 130, 50, 0.15, 0.03, 2), sr, 0.9);
    S.mix(out, burst(sr, rng, 'highpass', 1500, 0.7, 0.006, 0.0001), sr, 0.6);
    const amp = [[0, 0], [0.04, 1], [0.3, 0.7], [1.5, 0]];
    const w = whoosh(sr, rng, 1.6, [[0, 500], [0.12, 2200], [1.3, 900]], 1.2, amp);
    S.mix(out, S.flutter(w, sr, rng, 40, 0.4), sr, 0.8);
    S.mix(out, S.shape(S.filter(S.brown(sr, 1.6, rng), sr, 'lowpass', 300), sr, S.curve(amp)), sr, 0.6);
    const cr = S.filter(S.crackle(sr, 1.6, rng, { rate: 220 }), sr, 'highpass', 1500);
    S.mix(out, S.shape(cr, sr, S.curve(amp)), sr, 0.25);
    return S.drive(out, 1.6);
  } },
  crossbow: { ...GUN, v: 3, g: 0.7, wet: 0.2, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.6);
    S.mix(out, S.env(S.pluck(sr, 0.6, J(rng, 110, 0.06), rng, { decay: 0.993, bright: 0.3 }), sr, 0, 0.45), sr, 0.8);
    S.mix(out, S.env(S.pluck(sr, 0.4, J(rng, 165, 0.06), rng, { decay: 0.99, bright: 0.2 }), sr, 0, 0.3), sr, 0.35);
    S.mix(out, S.env(S.osc(sr, 0.08, 'sine', S.expSweep(1400, 300, 0.06)), sr, 0.001, 0.07), sr, 0.5);
    S.mix(out, burst(sr, rng, 'bandpass', 900, 1.5, 0.03), sr, 0.6);
    S.mix(out, click(sr, rng, 3000, 0.008), sr, 0.3);
    return S.drive(out, 1.3);
  } },
  tesla: { ...GUN, v: 3, g: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.45);
    const buzz = S.osc(sr, 0.45, 'saw', J(rng, 100, 0.1));
    S.mix(buzz, S.osc(sr, 0.45, 'saw', J(rng, 151, 0.1)), sr, 0.7);
    gate(buzz, sr, rng, 0.002, 0.009, 0.65);
    S.mix(out, S.env(S.filter(buzz, sr, 'highpass', 250), sr, 0.002, 0.35), sr, 0.5);
    S.mix(out, S.env(S.filter(S.crackle(sr, 0.45, rng, { rate: 900 }), sr, 'highpass', 2500), sr, 0.001, 0.35), sr, 0.9);
    const wf = J(rng, 2600, 0.1);
    const whine = S.osc(sr, 0.45, 'sine', (t) => wf - 1400 * t + 200 * Math.sin(440 * t));
    S.mix(out, S.env(whine, sr, 0.003, 0.3), sr, 0.22);
    S.mix(out, burst(sr, rng, 'bandpass', 4000, 0.7, 0.05), sr, 0.5);
    return S.drive(out, 2);
  } },
  rail: { ...GUN, v: 2, g: 0.95, range: 1.6, wet: 0.5, prio: 70, render: (sr, rng) => {
    const out = S.makeBuf(sr, 2.2);
    const t0 = 0.13;
    const ch = S.osc(sr, t0 + 0.01, 'sine', (t) => 250 * Math.pow(12.8, t / t0) * (1 + 0.03 * Math.sin(300 * t)));
    S.mix(out, S.shape(ch, sr, S.curve([[0, 0], [t0 - 0.01, 1], [t0 + 0.005, 0]])), sr, 0.35);
    S.mix(out, burst(sr, rng, 'highpass', 1200, 0.7, 0.012, 0.0001), sr, 1.2, t0);
    S.mix(out, thud(sr, 95, 26, 0.6, 0.06, 2.4), sr, 1.3, t0);
    const body = S.filter(S.noise(sr, 0.6, rng), sr, 'lowpass', S.expSweep(9000, 250, 0.3), 0.8);
    S.mix(out, S.env(body, sr, 0.0005, 0.45), sr, 1, t0);
    S.mix(out, S.partials(sr, 0.8, J(rng, 1320, 0.03), [[1, 0.12, 0.7], [1.63, 0.08, 0.5], [2.41, 0.05, 0.4]]), sr, 0.6, t0);
    S.mix(out, S.env(S.osc(sr, 1, 'sine', S.expSweep(2200, 300, 0.9)), sr, 0.01, 0.9), sr, 0.15, t0);
    S.mix(out, S.env(S.filter(S.pink(sr, 1.6, rng), sr, 'lowpass', 1000), sr, 0.01, 1.4), sr, 0.3, t0);
    S.drive(out, 2.4);
    return S.echoes(out, sr, [[0.2, 0.3, 900], [0.5, 0.15, 600]]);
  } },
  burst: { ...GUN, v: 4, g: 0.6, render: (sr, rng) => gun(sr, rng, {
    dur: 0.6, crack: { len: 0.005, hp: 2400, g: 1 }, body: { f0: 7000, f1: 650, d: 0.1, g: 0.85 },
    punch: { f: 1150, q: 1.2, d: 0.05, g: 0.5 }, thump: { f0: 175, f1: 62, d: 0.1, g: 0.85 },
    mech: [[0.028, 4400, 0.1]], tail: { lp: 1800, d: 0.4, g: 0.15 }, echo: [[0.09, 0.2, 1500]], drive: 2 }) },
  tommy: { ...GUN, v: 4, g: 0.62, render: (sr, rng) => gun(sr, rng, {
    // .45 ACP: a fat low thump more than a crack, a clattering bolt
    dur: 0.45, crack: { len: 0.005, hp: 1700, g: 0.7 }, body: { f0: 3600, f1: 480, d: 0.08, g: 0.85 },
    punch: { f: 680, q: 1, d: 0.06, g: 0.6 }, thump: { f0: 175, f1: 68, d: 0.1, g: 1.05 },
    mech: [[0.03, 2500, 0.15], [0.052, 3500, 0.09]], tail: { lp: 1400, d: 0.3, g: 0.14 }, drive: 1.9 }) },
  lever: { ...GUN, v: 3, g: 0.85, render: (sr, rng) => gun(sr, rng, {
    // a heavy crack, then the lever thrown down and back up (clack ... clack)
    dur: 1.1, crack: { len: 0.008, hp: 1900, g: 1.1 }, body: { f0: 6500, f1: 400, d: 0.18, g: 1 },
    punch: { f: 800, q: 1, d: 0.07, g: 0.5 }, thump: { f0: 140, f1: 45, d: 0.18, g: 1, tc: 0.03 },
    ring: { f: 2300, d: 0.15, g: 0.2, list: [[1, 0.08, 0.15], [1.61, 0.05, 0.1]] },
    mech: [[0.3, 2700, 0.28], [0.33, 4200, 0.12], [0.43, 3500, 0.3]],
    tail: { lp: 1400, d: 0.8, g: 0.22 }, echo: [[0.13, 0.25, 1200], [0.32, 0.1, 900]], drive: 2.3 }) },
  flare: { ...GUN, v: 3, g: 0.7, wet: 0.3, render: (sr, rng) => {
    // a hollow pop, then the flare fizzing away
    const out = S.makeBuf(sr, 1.2);
    S.mix(out, thud(sr, J(rng, 320, 0.08), 110, 0.09, 0.02, 1.6), sr, 0.9);
    S.mix(out, burst(sr, rng, 'bandpass', J(rng, 1500, 0.1), 0.8, 0.05), sr, 0.8);
    const tube = S.env(S.noise(sr, 0.15, rng), sr, 0.0005, 0.01);
    S.comb(tube, sr, J(rng, 240, 0.05), 0.8);
    S.mix(out, S.env(S.filter(tube, sr, 'lowpass', 2000), sr, 0, 0.12), sr, 0.5);
    const fizz = S.filter(S.filter(S.noise(sr, 1.1, rng), sr, 'highpass', 2600), sr, 'lowpass', 9000);
    S.mix(fizz, S.filter(S.crackle(sr, 1.1, rng, { rate: 180 }), sr, 'highpass', 1800), sr, 0.8);
    S.mix(out, S.shape(S.flutter(fizz, sr, rng, 25, 0.5), sr, S.curve([[0, 0], [0.04, 1], [0.5, 0.45], [1.1, 0]])), sr, 0.45, 0.02);
    return S.drive(out, 1.4);
  } },
  harpoon: { ...GUN, v: 3, g: 0.75, wet: 0.25, render: (sr, rng) => {
    // compressed-air thunk, the cable paying out, a steel twang
    const out = S.makeBuf(sr, 0.9);
    S.mix(out, thud(sr, J(rng, 210, 0.06), 70, 0.13, 0.03, 1.8), sr, 1);
    S.mix(out, burst(sr, rng, 'lowpass', 900, 0.7, 0.22, 0.002), sr, 0.7);
    S.mix(out, burst(sr, rng, 'highpass', 2500, 0.7, 0.05, 0.0005), sr, 0.4);
    S.mix(out, whoosh(sr, rng, 0.6, [[0, 3200], [0.5, 1100]], 2, [[0, 0], [0.03, 1], [0.55, 0]]), sr, 0.3, 0.02);
    const reel = S.filter(S.crackle(sr, 0.5, rng, { rate: (t) => 400 * Math.exp(-t * 3) }), sr, 'bandpass', 3000, 1.2);
    S.mix(out, reel, sr, 0.35, 0.04);
    S.mix(out, S.env(S.pluck(sr, 0.6, J(rng, 170, 0.05), rng, { decay: 0.994, bright: 0.45 }), sr, 0, 0.5), sr, 0.45, 0.01);
    S.mix(out, click(sr, rng, 3200, 0.01), sr, 0.4);
    return S.drive(out, 1.5);
  } },
  amr: { ...GUN, v: 2, g: 1, range: 1.8, wet: 0.5, prio: 70, render: (sr, rng) => {
    // .50 BMG through a muzzle brake: a slap of air, a huge low boom, the valley echoing
    const b = gun(sr, rng, {
      dur: 2.4, crack: { len: 0.012, hp: 1300, g: 1.3 }, body: { f0: 9000, f1: 220, d: 0.34, g: 1.1 },
      punch: { f: 480, q: 0.8, d: 0.13, g: 0.65 }, thump: { f0: 90, f1: 26, d: 0.5, g: 1.35, tc: 0.05 },
      tail: { lp: 1000, d: 1.7, g: 0.36 }, echo: [[0.18, 0.35, 900], [0.44, 0.2, 650], [0.85, 0.12, 450]], drive: 3 });
    // brake blast: a second sideways slap a hair later
    S.mix(b, burst(sr, rng, 'bandpass', 900, 0.6, 0.05, 0.0003), sr, 0.5, 0.004);
    const n = Math.round(sr * 0.0008);
    for (let i = 0; i < n * 2 && i < b.length; i++) b[i] += i < n ? 0.9 : -0.9;
    return b;
  } },
  saw_cut: { cat: 'impact', v: 3, g: 0.5, prio: 45, wet: 0.08, range: 0.8, lim: [0.08, 2], render: (sr, rng) => {
    // teeth ripping through meat and bone
    const out = S.makeBuf(sr, 0.22);
    const grind = gate(S.filter(S.noise(sr, 0.22, rng), sr, 'bandpass', J(rng, 1300, 0.15), 1.1), sr, rng, 0.004, 0.012, 0.7);
    S.mix(out, S.env(grind, sr, 0.004, 0.18), sr, 0.9);
    S.mix(out, thud(sr, J(rng, 140, 0.1), 70, 0.1, 0.02), sr, 0.6);
    S.mix(out, S.env(S.filter(S.crackle(sr, 0.2, rng, { rate: 300 }), sr, 'bandpass', 2400, 0.8), sr, 0.002, 0.16), sr, 0.5);
    return S.drive(out, 2);
  } },
  saw_rev: { cat: 'weapon', v: 2, g: 0.55, prio: 70, wet: 0.1, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.5);
    const eng = S.filter(S.osc(sr, 0.5, 'saw', S.expSweep(55, J(rng, 125, 0.04), 0.35)), sr, 'bandpass', 900, 1.2);
    S.mix(out, S.shape(eng, sr, S.curve([[0, 0], [0.04, 1], [0.35, 1], [0.5, 0]])), sr, 0.9);
    S.mix(out, whoosh(sr, rng, 0.5, [[0, 800], [0.35, 3500], [0.5, 2500]], 1.5, [[0, 0], [0.1, 1], [0.5, 0]]), sr, 0.3);
    return S.drive(out, 2.2);
  } },
  pullcord: { cat: 'weapon', v: 2, g: 0.5, prio: 50, wet: 0.08, range: 0.7, render: (sr, rng) => {
    // a rip of the starter cord, the engine coughing, then catching
    const out = S.makeBuf(sr, 0.8);
    S.mix(out, whoosh(sr, rng, 0.25, [[0, 700], [0.2, 3200]], 2.5, [[0, 0], [0.03, 1], [0.24, 0]]), sr, 0.7);
    for (let i = 0; i < 3; i++) {
      S.mix(out, thud(sr, J(rng, 90, 0.1), 45, 0.05, 0.01, 2), sr, 0.8 - i * 0.15, 0.26 + i * 0.06);
      S.mix(out, burst(sr, rng, 'bandpass', 700, 1, 0.03), sr, 0.4, 0.26 + i * 0.06);
    }
    const eng = S.filter(S.osc(sr, 0.3, 'saw', S.expSweep(40, 60, 0.3)), sr, 'bandpass', 700, 1.5);
    return S.mix(out, S.shape(eng, sr, S.curve([[0, 0], [0.05, 1], [0.3, 0]])), sr, 0.6, 0.46);
  } },
  freeze: { cat: 'impact', v: 3, g: 0.55, prio: 45, wet: 0.3, range: 0.9, lim: [0.05, 3], render: (sr, rng) => {
    // ice creaking over a body and locking up with a glassy ring
    const out = S.makeBuf(sr, 0.8);
    const cr = S.filter(S.crackle(sr, 0.5, rng, { rate: (t) => 2200 * Math.exp(-t * 6) }), sr, 'highpass', 2200);
    S.mix(out, cr, sr, 1);
    const creak = S.filter(S.osc(sr, 0.35, 'saw', S.expSweep(J(rng, 900, 0.1), 300, 0.3)), sr, 'bandpass', 1400, 5);
    S.mix(out, S.env(S.flutter(creak, sr, rng, 40, 0.7), sr, 0.01, 0.3), sr, 0.35);
    S.mix(out, S.partials(sr, 0.7, J(rng, 2600, 0.06), [[1, 0.5, 0.5], [1.51, 0.3, 0.35], [2.33, 0.2, 0.25]]), sr, 0.4, 0.05);
    return S.drive(out, 1.4);
  } },
  pump: { cat: 'weapon', v: 2, g: 0.45, prio: 40, wet: 0.15, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.3);
    S.mix(out, burst(sr, rng, 'bandpass', 2400, 1.5, 0.04), sr, 0.8);
    S.mix(out, burst(sr, rng, 'bandpass', 500, 1, 0.06), sr, 0.4);
    S.mix(out, burst(sr, rng, 'bandpass', 3200, 2, 0.03), sr, 1, 0.13);
    S.mix(out, thud(sr, 250, 150, 0.04), sr, 0.5, 0.13);
    return out;
  } },
  arc: { cat: 'impact', v: 3, g: 0.4, prio: 35, wet: 0.2, lim: [0.03, 4], render: (sr, rng) => {
    const out = S.env(S.filter(S.crackle(sr, 0.15, rng, { rate: 1500 }), sr, 'highpass', 2500), sr, 0.001, 0.12);
    const bz = gate(S.osc(sr, 0.15, 'saw', J(rng, 120, 0.2)), sr, rng, 0.002, 0.006, 0.6);
    return S.mix(out, S.env(S.filter(bz, sr, 'highpass', 300), sr, 0.001, 0.1), sr, 0.4);
  } },

  // Impacts. ------------------------------------------------------------------------------
  flesh: { cat: 'impact', v: 5, g: 0.42, prio: 30, wet: 0.05, range: 0.6, lim: [0.02, 6], render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.12), burst(sr, rng, 'lowpass', J(rng, 2600, 0.2), 0.8, 0.035), sr);
    S.mix(out, thud(sr, J(rng, 210, 0.15), 90, 0.05, 0.015), sr, 0.6);
    S.mix(out, click(sr, rng, 3200, 0.006, 3), sr, 0.25, 0.002);
    return S.drive(out, 1.4);
  } },
  ricochet: { cat: 'impact', v: 5, g: 0.3, prio: 25, wet: 0.3, range: 0.7, lim: [0.06, 3], render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.5), burst(sr, rng, 'highpass', 2500, 0.7, 0.012), sr);
    const f0 = 3200 + rng.next() * 1600, f1 = 1100 + rng.next() * 700, d = 0.25 + rng.next() * 0.15;
    const sweep = S.expSweep(f0, f1, d);
    S.mix(out, S.env(S.osc(sr, d + 0.05, 'sine', (t) => sweep(t) * (1 + 0.01 * Math.sin(250 * t))), sr, 0.004, d), sr, 0.45);
    S.mix(out, S.env(S.filter(S.noise(sr, d, rng), sr, 'bandpass', sweep, 8), sr, 0.004, d * 0.8), sr, 0.25);
    return out;
  } },
  impact: { cat: 'impact', v: 4, g: 0.3, prio: 25, wet: 0.15, range: 0.6, lim: [0.03, 4], group: 'ricochet', render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.15), burst(sr, rng, 'bandpass', J(rng, 3000, 0.2), 0.8, 0.02), sr);
    S.mix(out, S.filter(S.env(S.crackle(sr, 0.12, rng, { rate: 300 }), sr, 0, 0.1), sr, 'highpass', 2000), sr, 0.3);
    S.mix(out, thud(sr, 400, 200, 0.03, 0.01), sr, 0.3);
    return out;
  } },

  // Explosions & fire. --------------------------------------------------------------------
  expl_frag: { cat: 'explosion', v: 3, g: 1, prio: 80, wet: 0.5, range: 2.2, lim: [0.02, 6], group: 'explosion', render: (sr, rng) => explosion(sr, rng, {
    dur: 2.4, f0: 75, f1: 28, boomD: 0.9, bodyD: 1.0, rumbleD: 2.0, debris: 150, chunks: 4, drive: 2 }) },
  expl_grenade: { cat: 'explosion', v: 3, g: 0.95, prio: 80, wet: 0.5, range: 2.2, lim: [0.02, 6], group: 'explosion', render: (sr, rng) => explosion(sr, rng, {
    dur: 2.0, f0: 85, f1: 30, boomD: 0.7, bodyD: 0.8, rumbleD: 1.6, debris: 120, chunks: 3, drive: 2, crackG: 1 }) },
  expl_rocket: { cat: 'explosion', v: 2, g: 1.05, prio: 82, wet: 0.55, range: 2.5, lim: [0.02, 6], group: 'explosion', render: (sr, rng) => explosion(sr, rng, {
    dur: 3.0, f0: 60, f1: 22, boomD: 1.3, boomG: 1.2, bodyF: 6000, bodyD: 1.4, rumbleD: 2.8, rumbleG: 0.7,
    debris: 200, debrisDecay: 0.7, chunks: 7, drive: 2.4 }) },
  expl_bloater: { srate: 0.5, cat: 'explosion', v: 3, g: 0.9, prio: 78, wet: 0.35, range: 1.8, lim: [0.02, 6], group: 'explosion', render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.6);
    S.mix(out, burst(sr, rng, 'lowpass', 1200, 0.8, 0.1), sr, 0.8);
    S.mix(out, thud(sr, 90, 40, 0.3, 0.05, 2), sr, 0.9);
    const sq = S.filter(S.noise(sr, 0.7, rng), sr, 'bandpass', S.expSweep(1600, 250, 0.5), 2);
    S.mix(out, S.env(S.flutter(sq, sr, rng, 30, 0.8), sr, 0.005, 0.5), sr, 0.9);
    splats(sr, rng, out, 14, 0.03, 1.0, 0.6);
    S.mix(out, vocal(sr, rng, { dur: 1.2, f0: [[0, 50], [1.2, 35]], vowels: ['o', 'u'], shift: 0.7, fry: 0.9, bubble: 25, d: 1 }), sr, 0.25, 0.1);
    return S.drive(out, 1.8);
  } },
  slam: { srate: 0.5, cat: 'explosion', v: 2, g: 1, prio: 75, wet: 0.45, range: 2.2, lim: [0.1, 3], render: (sr, rng) => explosion(sr, rng, {
    dur: 2.2, f0: 55, f1: 22, tc: 0.1, boomD: 1.0, boomG: 1.2, bodyF: 2000, bodyD: 0.9, rumbleD: 2, rumbleG: 0.6,
    debris: 90, debrisDecay: 0.6, debrisG: 0.3, chunks: 5, crackG: 0.3, drive: 2.2 }) },
  molotov: { cat: 'explosion', v: 3, g: 0.8, prio: 65, wet: 0.35, range: 1.6, lim: [0.05, 4], render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.6);
    for (let i = 0; i < 16; i++) {
      const f = 3000 + rng.next() * 6000;
      S.mix(out, S.partials(sr, 0.3, f, [[1, 1, 0.05 + rng.next() * 0.2], [1.37, 0.5, 0.08]]), sr, 0.12 + rng.next() * 0.15, rng.next() * 0.12);
    }
    S.mix(out, burst(sr, rng, 'highpass', 4000, 0.7, 0.06), sr, 0.7);
    S.mix(out, whoosh(sr, rng, 1.4, [[0, 300], [0.4, 1800], [1.4, 700]], 0.9, [[0, 0], [0.15, 1], [1.3, 0]]), sr, 0.9, 0.04);
    S.mix(out, S.env(S.filter(S.brown(sr, 1.4, rng), sr, 'lowpass', 400), sr, 0.12, 1.2), sr, 0.8, 0.04);
    return S.drive(out, 1.5);
  } },
  flame_start: { cat: 'weapon', v: 2, g: 0.6, prio: 70, wet: 0.2, render: (sr, rng) => {
    const out = whoosh(sr, rng, 0.6, [[0, 200], [0.3, 1500], [0.6, 800]], 0.8, [[0, 0], [0.05, 1], [0.6, 0]]);
    return S.mix(out, S.env(S.filter(S.brown(sr, 0.6, rng), sr, 'lowpass', 400), sr, 0.03, 0.5), sr, 1);
  } },

  // Zombies. ------------------------------------------------------------------------------
  groan_walker: { srate: 0.5, cat: 'zombie', v: 5, g: 0.5, prio: 20, wet: 0.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const dur = 0.9 + rng.next() * 0.5, f = 80 + rng.next() * 25;
    const sets = [['u', 'a', 'uh'], ['o', 'a', 'u'], ['uh', 'o'], ['a', 'uh', 'er']];
    return vocal(sr, rng, { dur, f0: [[0, f], [dur * 0.35, f * 1.12], [dur, f * 0.82]], vowels: sets[Math.floor(rng.next() * 4)],
      shift: J(rng, 0.95, 0.05), breath: 0.25, fry: 0.6, jitter: 0.8, a: 0.12, h: 0.2, d: dur * 0.7, drive: 1.8, lp: 3000 });
  } },
  groan_runner: { cat: 'zombie', v: 4, g: 0.5, prio: 22, wet: 0.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const dur = 0.45 + rng.next() * 0.25, f = 300 + rng.next() * 80;
    return vocal(sr, rng, { dur, f0: [[0, f], [0.08, f * 1.7], [dur, f * 1.05]], vowels: ['ae', 'a'], shift: 1.15,
      breath: 0.45, fry: 0.3, a: 0.02, d: dur, drive: 3 });
  } },
  groan_crawler: { srate: 0.5, cat: 'zombie', v: 3, g: 0.45, prio: 20, wet: 0.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const dur = 0.8, f = 60 + rng.next() * 12;
    return vocal(sr, rng, { dur, f0: [[0, f], [dur, f * 0.8]], vowels: ['er', 'uh'], shift: 0.95, breath: 0.5, fry: 0.9, bubble: 18, drive: 2.5 });
  } },
  groan_bloater: { srate: 0.5, cat: 'zombie', v: 3, g: 0.5, prio: 20, wet: 0.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const out = vocal(sr, rng, { dur: 1.1, f0: [[0, 52], [0.5, 58], [1.1, 44]], vowels: ['o', 'u', 'o'], shift: 0.78,
      breath: 0.3, fry: 0.8, bubble: 25, drive: 2 });
    for (let i = 0; i < 7; i++) {
      const f = 200 + rng.next() * 150;
      S.mix(out, S.env(S.osc(sr, 0.06, 'sine', S.expSweep(f, f * 2.2, 0.05)), sr, 0.005, 0.04), sr, 0.3, rng.next() * 0.9);
    }
    return out;
  } },
  groan_spitter: { cat: 'zombie', v: 3, g: 0.45, prio: 20, wet: 0.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const out = vocal(sr, rng, { dur: 0.8, f0: [[0, 90], [0.3, 105], [0.8, 80]], vowels: ['er', 'o'], shift: 0.9,
      breath: 0.4, fry: 0.5, bubble: 35, drive: 2 });
    return S.mix(out, S.env(S.filter(S.noise(sr, 0.8, rng), sr, 'highpass', 3000), sr, 0.2, 0.6), sr, 0.15);
  } },
  groan_screamer: { cat: 'zombie', v: 3, g: 0.45, prio: 24, wet: 0.35, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const dur = 1.0, f = 420 + rng.next() * 60;
    return vocal(sr, rng, { dur, f0: [[0, f], [0.2, f * 1.4], [dur, f * 1.1]], vib: 0.03, vowels: ['a', 'ae', 'a'],
      shift: 1.2, breath: 0.3, fry: 0.2, a: 0.08, d: 0.9, drive: 2.5 });
  } },
  groan_brute: { srate: 0.5, cat: 'zombie', v: 3, g: 0.6, prio: 30, wet: 0.35, range: 1.3, group: 'groan', lim: [0.12, 5], render: (sr, rng) => {
    const dur = 1.1;
    return vocal(sr, rng, { dur, f0: [[0, 55], [0.3, 70], [dur, 48]], vowels: ['a', 'o'], shift: 0.72, breath: 0.35,
      fry: 0.9, sub: 0.5, growl: 0.3, drive: 3.5, lp: 3500 });
  } },
  groan_boss: { srate: 0.5, cat: 'zombie', v: 2, g: 0.85, prio: 70, wet: 0.45, range: 2, group: 'groan_boss', lim: [1.5, 1], render: (sr, rng) => {
    const dur = 2.0;
    return vocal(sr, rng, { dur, f0: [[0, 38], [0.5, 48], [dur, 30]], vowels: ['a', 'o', 'u'], shift: 0.58, breath: 0.35,
      fry: 1, sub: 0.7, growl: 0.4, growlF: 250, a: 0.15, d: 1.6, drive: 4, lp: 3000 });
  } },
  scream: { cat: 'zombie', v: 2, g: 0.75, prio: 60, wet: 0.45, range: 1.6, lim: [0.4, 2], render: (sr, rng) => {
    const dur = 1.5;
    const p = { dur, f0: [[0, 700], [0.15, 1050], [1.2, 980], [dur, 700]], vib: 0.05, vowels: ['a', 'ae', 'i', 'a'],
      shift: 1.25, breath: 0.35, fry: 0.2, a: 0.03, h: 0.8, d: 0.6, drive: 4 };
    const out = vocal(sr, rng, p);
    S.mix(out, vocal(sr, rng, { ...p, f0: [[0, 1050], [0.15, 1500], [1.2, 1400], [dur, 1000]], shift: 1.3 }), sr, 0.5);
    return out;
  } },
  roar_brute: { srate: 0.5, cat: 'zombie', v: 2, g: 0.8, prio: 60, wet: 0.4, range: 1.6, lim: [0.3, 2], render: (sr, rng) => {
    const out = vocal(sr, rng, { dur: 1.4, f0: [[0, 65], [0.25, 95], [1.4, 55]], vowels: ['a', 'a', 'o'], shift: 0.7,
      breath: 0.5, fry: 1, sub: 0.6, growl: 0.5, a: 0.04, h: 0.4, d: 0.9, drive: 5, lp: 4000 });
    for (let i = 0; i < 3; i++) S.mix(out, thud(sr, 90, 40, 0.18, 0.03, 1.5), sr, 0.5, 0.1 + i * 0.3);
    return out;
  } },
  spit: { cat: 'zombie', v: 2, g: 0.55, prio: 45, wet: 0.2, lim: [0.08, 3], render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.45), burst(sr, rng, 'bandpass', 1200, 1, 0.08), sr);
    S.mix(out, vocal(sr, rng, { dur: 0.3, f0: [[0, 110], [0.3, 80]], vowels: ['er', 'u'], fry: 0.6, bubble: 40, a: 0.02, d: 0.25 }), sr, 0.4);
    const sq = S.filter(S.noise(sr, 0.2, rng), sr, 'lowpass', S.expSweep(3000, 500, 0.15));
    S.mix(out, S.env(sq, sr, 0.001, 0.15), sr, 0.6, 0.03);
    S.mix(out, S.env(S.osc(sr, 0.1, 'sine', S.expSweep(300, 150, 0.08)), sr, 0.002, 0.08), sr, 0.4, 0.02);
    return out;
  } },
  zswipe: { cat: 'zombie', v: 4, g: 0.35, prio: 35, wet: 0.1, range: 0.7, lim: [0.04, 4], render: (sr, rng) => {
    const d = J(rng, 0.2, 0.15);
    return whoosh(sr, rng, d + 0.03, [[0, 600], [d * 0.35, J(rng, 2400, 0.15)], [d, 700]], 1.5, [[0, 0], [d * 0.3, 1], [d, 0]]);
  } },
  zswipe_heavy: { cat: 'zombie', v: 2, g: 0.6, prio: 50, wet: 0.2, range: 1.2, lim: [0.1, 3], render: (sr, rng) => {
    const out = whoosh(sr, rng, 0.45, [[0, 250], [0.15, 1200], [0.4, 300]], 1.2, [[0, 0], [0.12, 1], [0.42, 0]]);
    return S.mix(out, thud(sr, 80, 40, 0.2), sr, 0.4, 0.2);
  } },
  zdie: { cat: 'zombie', v: 5, g: 0.5, prio: 40, wet: 0.2, range: 0.9, lim: [0.02, 6], render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.6);
    const sq = S.filter(S.noise(sr, 0.3, rng), sr, 'bandpass', S.expSweep(J(rng, 900, 0.2), 220, 0.25), 3);
    S.mix(out, S.env(S.flutter(sq, sr, rng, 40, 0.7), sr, 0.002, 0.25), sr, 0.8);
    S.mix(out, thud(sr, J(rng, 110, 0.15), 45, 0.2, 0.03), sr, 0.9, 0.06);
    S.mix(out, burst(sr, rng, 'lowpass', 700, 0.7, 0.12), sr, 0.6, 0.06);
    S.mix(out, vocal(sr, rng, { dur: 0.5, f0: [[0, 70], [0.5, 45]], vowels: ['uh', 'u'], shift: 0.9, fry: 0.8, a: 0.01, d: 0.4 }), sr, 0.3);
    return S.drive(out, 1.5);
  } },
  zdie_gib: { cat: 'zombie', v: 3, g: 0.55, prio: 42, wet: 0.25, range: 1, group: 'zdie', lim: [0.02, 6], render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.9);
    const sq = S.filter(S.noise(sr, 0.4, rng), sr, 'bandpass', S.expSweep(1400, 200, 0.3), 2);
    S.mix(out, S.env(S.flutter(sq, sr, rng, 35, 0.7), sr, 0.002, 0.35), sr, 1);
    for (let i = 0; i < 3; i++) S.mix(out, click(sr, rng, J(rng, 2000, 0.3), 0.02, 1.5), sr, 0.4, rng.next() * 0.05);
    splats(sr, rng, out, 10, 0.02, 0.7, 0.6);
    S.mix(out, thud(sr, 100, 40, 0.2), sr, 0.8, 0.05);
    return S.drive(out, 1.6);
  } },
  die_brute: { srate: 0.5, cat: 'zombie', v: 1, g: 0.8, prio: 60, wet: 0.4, range: 1.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.4);
    S.mix(out, vocal(sr, rng, { dur: 0.9, f0: [[0, 70], [0.9, 35]], vowels: ['a', 'o', 'u'], shift: 0.72, fry: 1, sub: 0.5, drive: 3.5, a: 0.02, d: 0.8 }), sr, 0.8);
    S.mix(out, thud(sr, 80, 30, 0.4, 0.04, 2), sr, 1, 0.5);
    S.mix(out, burst(sr, rng, 'lowpass', 900, 0.7, 0.25), sr, 0.6, 0.5);
    return out;
  } },
  die_boss: { srate: 0.5, cat: 'zombie', v: 1, g: 1, prio: 90, wet: 0.55, range: 3, render: (sr, rng) => {
    const out = S.makeBuf(sr, 3.2);
    S.mix(out, vocal(sr, rng, { dur: 2.0, f0: [[0, 50], [0.4, 56], [2.0, 20]], vowels: ['a', 'o', 'u'], shift: 0.55, fry: 1, sub: 0.8, growl: 0.4, drive: 4.5, a: 0.05, d: 1.8 }), sr, 0.9);
    S.mix(out, thud(sr, 60, 22, 1.2, 0.08, 2.5), sr, 1.1, 1.3);
    S.mix(out, S.env(S.filter(S.brown(sr, 2, rng), sr, 'lowpass', 150), sr, 0.02, 1.8), sr, 0.7, 1.3);
    return out;
  } },

  // Survivors. ----------------------------------------------------------------------------
  hurt: { cat: 'player', v: 5, g: 0.55, prio: 70, wet: 0.1, lim: [0.18, 3], render: (sr, rng) => {
    const f = 125 + rng.next() * 35, dur = 0.22 + rng.next() * 0.08;
    const out = vocal(sr, rng, { dur, f0: [[0, f], [0.05, f * 1.15], [dur, f * 0.85]], vowels: rng.next() < 0.5 ? ['uh', 'a'] : ['a', 'uh'],
      shift: 1.05, breath: 0.5, fry: 0.2, a: 0.01, d: dur * 0.9, drive: 2 });
    return S.mix(out, thud(sr, 180, 90, 0.06), sr, 0.4);
  } },
  downed: { cat: 'player', v: 2, g: 0.7, prio: 88, wet: 0.3, range: 1.4, render: (sr, rng) => vocal(sr, rng, {
    dur: 1.1, f0: [[0, 170], [0.15, 240], [0.6, 210], [1.1, 120]], vib: 0.02, vowels: ['a', 'a', 'o'], shift: 1.05,
    breath: 0.45, fry: 0.3, jitter: 1.2, a: 0.03, h: 0.3, d: 0.7, drive: 2.2 }) },
  death: { srate: 0.5, cat: 'player', v: 1, g: 0.8, prio: 92, wet: 0.5, range: 2, render: (sr, rng) => {
    const out = S.makeBuf(sr, 2.6);
    S.mix(out, vocal(sr, rng, { dur: 0.5, f0: [[0, 160], [0.5, 90]], vowels: ['a', 'uh'], shift: 1.05, breath: 0.5, a: 0.01, d: 0.45, drive: 2 }), sr, 0.7);
    S.mix(out, thud(sr, 60, 30, 1.2, 0.08, 1.8), sr, 0.8, 0.05);
    const pad = chord(sr, 2.5, [73.42, 87.31, 110], 500);
    S.mix(out, S.env(pad, sr, 0.1, 2), sr, 0.5, 0.1);
    return out;
  } },
  revive: { cat: 'player', v: 1, g: 0.5, prio: 85, wet: 0.4, range: 1.4, render: (sr) => {
    const out = S.makeBuf(sr, 1.4);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => S.mix(out, S.fmBell(sr, 1.2, f, { ratio: 2, index: 1.5, decay: 1 }), sr, 0.35, i * 0.08));
    return out;
  } },
  respawn: { cat: 'player', v: 1, g: 0.45, prio: 85, wet: 0.4, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.2);
    [587.33, 880, 1174.66].forEach((f, i) => S.mix(out, blip(sr, f, 0.5, 'sine'), sr, 0.4, i * 0.1));
    const sw = S.filter(S.noise(sr, 0.6, rng), sr, 'highpass', 3000);
    return S.mix(out, S.shape(sw, sr, S.curve([[0, 0], [0.5, 1], [0.6, 0]])), sr, 0.2);
  } },
  heartbeat: { cat: 'player', v: 2, g: 0.8, prio: 95, wet: 0, render: (sr) => {
    const out = S.makeBuf(sr, 0.6);
    S.mix(out, thud(sr, 70, 40, 0.14, 0.03, 1.5), sr, 1);
    S.mix(out, thud(sr, 60, 38, 0.12, 0.03, 1.5), sr, 0.7, 0.17);
    return S.filter(out, sr, 'lowpass', 250);
  } },

  // Weapon handling (reload pieces play in sequence, see RELOADS in audio.js). -----------
  mag_out: { cat: 'weapon', v: 2, g: 0.4, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.12), click(sr, rng, 3800, 0.008, 3), sr);
    S.mix(out, burst(sr, rng, 'bandpass', 1400, 1, 0.06), sr, 0.5, 0.005);
    return S.mix(out, thud(sr, 300, 200, 0.03), sr, 0.2);
  } },
  mag_in: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.1), thud(sr, 320, 160, 0.04, 0.01), sr);
    S.mix(out, burst(sr, rng, 'bandpass', 2400, 2, 0.025), sr, 0.8);
    return S.mix(out, click(sr, rng, 4500, 0.006, 3), sr, 0.5, 0.018);
  } },
  rack: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.25);
    S.mix(out, burst(sr, rng, 'bandpass', 2000, 2, 0.03), sr, 0.6);
    S.mix(out, burst(sr, rng, 'bandpass', 1200, 1, 0.07), sr, 0.3);
    S.mix(out, burst(sr, rng, 'bandpass', 3000, 2, 0.02), sr, 1, 0.1);
    return S.mix(out, thud(sr, 260, 140, 0.04, 0.01), sr, 0.6, 0.1);
  } },
  slide: { cat: 'weapon', v: 2, g: 0.4, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.15);
    S.mix(out, burst(sr, rng, 'bandpass', 2600, 2, 0.02), sr, 0.7);
    S.mix(out, burst(sr, rng, 'bandpass', 3600, 2.5, 0.018), sr, 1, 0.06);
    return S.mix(out, thud(sr, 300, 180, 0.03, 0.01), sr, 0.4, 0.06);
  } },
  shell: { cat: 'weapon', v: 3, g: 0.4, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.1), click(sr, rng, J(rng, 1500, 0.1), 0.015, 2), sr);
    S.mix(out, burst(sr, rng, 'bandpass', 900, 1.5, 0.03), sr, 0.5);
    return S.mix(out, click(sr, rng, 4000, 0.005, 3), sr, 0.4, 0.02);
  } },
  breach: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.22), thud(sr, 180, 110, 0.08, 0.02), sr);
    S.mix(out, click(sr, rng, 2200, 0.02, 2), sr, 0.7);
    return S.mix(out, S.partials(sr, 0.2, 900, [[1, 0.2, 0.15], [2.3, 0.1, 0.1]]), sr, 1);
  } },
  bolt: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.45);
    [[0, 2600], [0.1, 1800], [0.22, 2200], [0.32, 3000]].forEach(([at, f], i) => {
      S.mix(out, click(sr, rng, f, 0.02, 2), sr, 0.8, at);
      if (i === 1 || i === 2) S.mix(out, burst(sr, rng, 'bandpass', 1300, 1, 0.05), sr, 0.3, at);
    });
    return out;
  } },
  box: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.partials(sr, 0.6, J(rng, 520, 0.05), [[1, 0.3, 0.2], [2.4, 0.2, 0.15], [3.7, 0.1, 0.1]]);
    S.mix(out, thud(sr, 220, 120, 0.08), sr, 0.7);
    const rattle = S.filter(S.crackle(sr, 0.25, rng, { rate: 200 }), sr, 'bandpass', 3500, 1);
    return S.mix(out, rattle, sr, 0.6, 0.15);
  } },
  canister: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.7);
    S.mix(out, thud(sr, 200, 120, 0.1), sr, 0.8);
    S.mix(out, S.partials(sr, 0.3, 650, [[1, 0.2, 0.2], [2.2, 0.1, 0.12]]), sr, 1);
    return S.mix(out, S.env(S.filter(S.noise(sr, 0.6, rng), sr, 'highpass', 3000), sr, 0.02, 0.5), sr, 0.35, 0.1);
  } },
  tube: { cat: 'weapon', v: 2, g: 0.45, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.45), whoosh(sr, rng, 0.4, [[0, 400], [0.25, 1000]], 4, [[0, 0], [0.05, 1], [0.28, 0]]), sr);
    return S.mix(out, S.mix(thud(sr, 160, 90, 0.1), click(sr, rng, 1800, 0.02), sr, 0.6), sr, 0.8, 0.28);
  } },
  crank: { cat: 'weapon', v: 2, g: 0.4, prio: 50, wet: 0.05, range: 0.6, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.7);
    for (let i = 0; i < 7; i++) S.mix(out, click(sr, rng, J(rng, 2800, 0.05), 0.01, 4), sr, 0.8, i * 0.08);
    const creak = S.filter(S.osc(sr, 0.6, 'saw', 130), sr, 'bandpass', 700, 6);
    return S.mix(out, S.env(S.flutter(creak, sr, rng, 30, 0.7), sr, 0.05, 0.5), sr, 0.4);
  } },
  charge: { cat: 'weapon', v: 1, g: 0.35, prio: 50, wet: 0.1, range: 0.6, render: (sr) => {
    const out = S.makeBuf(sr, 0.9);
    const up = S.osc(sr, 0.72, 'sine', S.expSweep(200, 1800, 0.7));
    S.mix(up, S.osc(sr, 0.72, 'tri', S.expSweep(203, 1830, 0.7)), sr, 0.4);
    S.mix(out, S.shape(up, sr, S.curve([[0, 0], [0.6, 1], [0.72, 0]])), sr, 0.6);
    return S.mix(out, S.env(S.osc(sr, 0.12, 'sine', 2000), sr, 0.003, 0.1, 0.03), sr, 0.5, 0.72);
  } },
  switch: { cat: 'weapon', v: 2, g: 0.4, prio: 50, wet: 0.05, range: 0.6, lim: [0.05, 2], render: (sr, rng) => {
    const out = S.shape(S.filter(S.noise(sr, 0.12, rng), sr, 'bandpass', 1000, 0.7), sr, S.curve([[0, 0], [0.02, 1], [0.12, 0]]));
    gain(out, 0.4);
    S.mix(out, burst(sr, rng, 'bandpass', 2800, 2, 0.02), sr, 0.8, 0.07);
    return S.mix(out, thud(sr, 280, 160, 0.03, 0.01), sr, 0.4, 0.07);
  } },
  empty: { cat: 'weapon', v: 2, g: 0.4, prio: 60, wet: 0.02, range: 0.5, lim: [0.08, 2], render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.04), click(sr, rng, 3500, 0.006, 3), sr);
    return S.mix(out, click(sr, rng, 1600, 0.01, 2), sr, 0.4, 0.004);
  } },
  melee_swing: { cat: 'weapon', v: 3, g: 0.45, prio: 55, wet: 0.05, range: 0.7, lim: [0.1, 3], render: (sr, rng) =>
    whoosh(sr, rng, 0.25, [[0, 400], [0.08, J(rng, 1800, 0.15)], [0.22, 600]], 1.2, [[0, 0], [0.06, 1], [0.24, 0]]) },
  melee_hit: { cat: 'weapon', v: 3, g: 0.6, prio: 55, wet: 0.1, range: 0.8, lim: [0.08, 3], render: (sr, rng) => {
    const out = S.mix(S.makeBuf(sr, 0.2), thud(sr, J(rng, 150, 0.1), 60, 0.14, 0.025), sr);
    S.mix(out, burst(sr, rng, 'lowpass', 900, 0.7, 0.06), sr, 0.7);
    S.mix(out, burst(sr, rng, 'bandpass', 1800, 1.5, 0.02), sr, 0.4);
    return S.drive(out, 2);
  } },
  throw_frag: { cat: 'weapon', v: 1, g: 0.45, prio: 60, wet: 0.1, range: 0.8, render: (sr, rng) => {
    const out = S.partials(sr, 0.5, 3200, [[1, 0.7, 0.2], [1.48, 0.4, 0.15], [2.3, 0.2, 0.1]]);
    S.mix(out, click(sr, rng, 2500, 0.01), sr, 0.5);
    return S.mix(out, whoosh(sr, rng, 0.28, [[0, 500], [0.1, 1600], [0.25, 500]], 1, [[0, 0], [0.08, 1], [0.27, 0]]), sr, 0.6, 0.12);
  } },
  throw_molotov: { cat: 'weapon', v: 1, g: 0.45, prio: 60, wet: 0.1, range: 0.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.6);
    S.mix(out, click(sr, rng, 3500, 0.006, 2), sr, 0.8);
    S.mix(out, S.filter(S.crackle(sr, 0.04, rng, { rate: 3000 }), sr, 'highpass', 3000), sr, 0.4, 0.005);
    S.mix(out, S.env(S.filter(S.pink(sr, 0.3, rng), sr, 'highpass', 1500), sr, 0.02, 0.2), sr, 0.4, 0.02);
    S.mix(out, S.partials(sr, 0.2, 4200, [[1, 0.3, 0.12], [1.7, 0.2, 0.08]]), sr, 0.5, 0.03);
    return S.mix(out, whoosh(sr, rng, 0.3, [[0, 400], [0.1, 1400], [0.28, 500]], 1, [[0, 0], [0.08, 1], [0.3, 0]]), sr, 0.6, 0.15);
  } },

  // Pickups, shop & deployables. ------------------------------------------------------------
  pick_ammo: { cat: 'pickup', v: 2, g: 0.45, prio: 60, wet: 0.05, range: 0.6, lim: [0.05, 3], group: 'pickup', render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.25);
    for (const at of [0, 0.06]) {
      S.mix(out, burst(sr, rng, 'bandpass', J(rng, 2200, 0.1), 2, 0.03), sr, 0.8, at);
      S.mix(out, thud(sr, 350, 200, 0.04, 0.01), sr, 0.4, at);
    }
    return S.mix(out, S.filter(S.crackle(sr, 0.1, rng, { rate: 250 }), sr, 'highpass', 3000), sr, 0.25, 0.08);
  } },
  pick_health: { cat: 'pickup', v: 1, g: 0.4, prio: 60, wet: 0.15, range: 0.6, lim: [0.05, 3], group: 'pickup', render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.55);
    const zip = S.filter(S.noise(sr, 0.12, rng), sr, 'bandpass', S.expSweep(2000, 4000, 0.12), 2);
    S.mix(out, S.env(S.flutter(zip, sr, rng, 60, 0.8), sr, 0.01, 0.12), sr, 0.5);
    S.mix(out, blip(sr, 880, 0.35), sr, 0.5, 0.05);
    return S.mix(out, blip(sr, 1318.5, 0.35), sr, 0.5, 0.13);
  } },
  pick_cash: { cat: 'pickup', v: 2, g: 0.35, prio: 60, wet: 0.15, range: 0.6, lim: [0.05, 3], group: 'pickup', render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.5);
    for (let i = 0; i < 6; i++) S.mix(out, coin(sr, rng, 2500 + rng.next() * 1300), sr, 0.5 + rng.next() * 0.3, rng.next() * 0.18);
    return out;
  } },
  pick_armor: { cat: 'pickup', v: 1, g: 0.45, prio: 60, wet: 0.05, range: 0.6, lim: [0.05, 3], group: 'pickup', render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.35);
    const vel = gate(S.filter(S.noise(sr, 0.18, rng), sr, 'highpass', 1500), sr, rng, 0.001, 0.003, 0.5);
    S.mix(out, S.env(vel, sr, 0.005, 0.18), sr, 0.6);
    S.mix(out, thud(sr, 240, 150, 0.1, 0.02), sr, 0.7, 0.12);
    return S.mix(out, burst(sr, rng, 'bandpass', 900, 1.5, 0.05), sr, 0.4, 0.12);
  } },
  pick_frag: { cat: 'pickup', v: 1, g: 0.45, prio: 60, wet: 0.05, range: 0.6, lim: [0.05, 3], group: 'pickup', render: (sr, rng) => {
    const out = S.partials(sr, 0.3, 3100, [[1, 1, 0.2], [1.51, 0.5, 0.15]]);
    gain(out, 0.4);
    return S.mix(out, burst(sr, rng, 'bandpass', 2000, 2, 0.03), sr, 0.8, 0.05);
  } },
  pick_crate: { cat: 'pickup', v: 1, g: 0.5, prio: 70, wet: 0.2, range: 0.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.9);
    const creak = S.filter(S.osc(sr, 0.35, 'saw', S.expSweep(140, 110, 0.35)), sr, 'bandpass', 900, 5);
    S.mix(out, S.env(S.flutter(creak, sr, rng, 30, 0.6), sr, 0.03, 0.35), sr, 0.4);
    S.mix(out, S.mix(thud(sr, 150, 80, 0.12), click(sr, rng, 1500, 0.02), sr, 0.6), sr, 0.8, 0.3);
    S.mix(out, blip(sr, 659.25, 0.4), sr, 0.35, 0.4);
    return S.mix(out, blip(sr, 987.77, 0.45), sr, 0.35, 0.5);
  } },
  buy: { cat: 'ui', v: 1, g: 0.5, prio: 100, wet: 0.1, group: 'st_buy', lim: [0.08, 2], render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.1);
    S.mix(out, thud(sr, 160, 90, 0.1, 0.02), sr, 0.6);
    S.mix(out, click(sr, rng, 2500, 0.015), sr, 0.6);
    S.mix(out, click(sr, rng, 1800, 0.02), sr, 0.5, 0.05);
    S.mix(out, S.partials(sr, 1, 2400, [[1, 1, 0.9], [2.4, 0.4, 0.6], [3.9, 0.2, 0.4]]), sr, 0.4, 0.06);
    for (let i = 0; i < 3; i++) S.mix(out, coin(sr, rng, 2800 + rng.next() * 900), sr, 0.4, 0.14 + i * 0.05);
    return out;
  } },
  deny: { cat: 'ui', v: 1, g: 0.35, prio: 100, wet: 0, group: 'st_deny', lim: [0.15, 1], render: (sr) => {
    const out = S.osc(sr, 0.32, 'square', 140);
    S.mix(out, S.osc(sr, 0.32, 'square', 147), sr, 1);
    S.filter(out, sr, 'lowpass', 1500);
    return S.shape(out, sr, S.curve([[0, 0], [0.01, 1], [0.12, 1], [0.13, 0], [0.18, 0], [0.19, 1], [0.3, 1], [0.31, 0]]));
  } },
  place_turret: { cat: 'deploy', v: 1, g: 0.5, prio: 65, wet: 0.15, range: 0.9, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.9);
    const servo = S.filter(S.osc(sr, 0.4, 'saw', S.expSweep(180, 420, 0.35)), sr, 'bandpass', 800, 3);
    S.mix(out, S.shape(servo, sr, S.curve([[0, 0], [0.05, 1], [0.35, 1], [0.38, 0]])), sr, 0.4);
    S.mix(out, S.mix(thud(sr, 120, 60, 0.15), click(sr, rng, 2800, 0.02), sr, 0.6), sr, 0.9, 0.36);
    S.mix(out, S.env(S.osc(sr, 0.1, 'sine', 1760), sr, 0.003, 0.06, 0.04), sr, 0.3, 0.55);
    return S.mix(out, S.env(S.osc(sr, 0.1, 'sine', 1760), sr, 0.003, 0.06, 0.04), sr, 0.3, 0.68);
  } },
  place_barricade: { cat: 'deploy', v: 2, g: 0.6, prio: 65, wet: 0.15, range: 0.9, render: (sr, rng) => {
    const out = S.makeBuf(sr, 0.8);
    const scrape = S.flutter(S.filter(S.noise(sr, 0.2, rng), sr, 'bandpass', 700, 2), sr, rng, 40, 0.7);
    S.mix(out, S.shape(scrape, sr, S.curve([[0, 0], [0.05, 1], [0.18, 0]])), sr, 0.4);
    S.mix(out, thud(sr, 90, 45, 0.3, 0.03, 1.8), sr, 1, 0.15);
    S.mix(out, burst(sr, rng, 'lowpass', 1200, 0.7, 0.1), sr, 0.5, 0.15);
    return S.mix(out, S.partials(sr, 0.4, 380, [[1, 0.3, 0.3], [2.7, 0.2, 0.2]]), sr, 0.8, 0.16);
  } },
  break_turret: { cat: 'deploy', v: 1, g: 0.8, prio: 70, wet: 0.35, range: 1.4, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.2);
    S.mix(out, burst(sr, rng, 'highpass', 800, 0.7, 0.02), sr, 0.8);
    S.mix(out, thud(sr, 120, 50, 0.35, 0.04, 2), sr, 1);
    S.mix(out, S.env(S.filter(S.crackle(sr, 0.5, rng, { rate: 600 }), sr, 'highpass', 3000), sr, 0.001, 0.3), sr, 0.5);
    const fz = gate(S.osc(sr, 0.7, 'saw', 90), sr, rng, 0.003, 0.02, 0.6);
    S.mix(out, S.env(S.filter(fz, sr, 'highpass', 500), sr, 0.01, 0.6), sr, 0.3, 0.05);
    return S.mix(out, S.env(S.osc(sr, 0.9, 'sine', S.expSweep(1800, 200, 0.8)), sr, 0.01, 0.8), sr, 0.15, 0.05);
  } },
  break_barricade: { cat: 'deploy', v: 2, g: 0.75, prio: 70, wet: 0.3, range: 1.3, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.0);
    for (let i = 0; i < 12; i++) S.mix(out, burst(sr, rng, 'bandpass', 1200 + rng.next() * 2300, 1.5, 0.02 + rng.next() * 0.03), sr, 0.3 + rng.next() * 0.5, rng.next() * 0.35);
    S.mix(out, thud(sr, 90, 45, 0.25, 0.03, 1.8), sr, 0.9);
    S.mix(out, burst(sr, rng, 'lowpass', 1500, 0.7, 0.2), sr, 0.6);
    return S.mix(out, S.partials(sr, 0.5, 400, [[1, 0.3, 0.3], [2.7, 0.2, 0.2]]), sr, 0.8, 0.05);
  } },

  // Stingers & world events. ----------------------------------------------------------------
  alarm: { cat: 'stinger', v: 1, g: 0.35, prio: 75, wet: 0.35, range: 3, group: 'alarm', lim: [2.5, 1], render: (sr) => {
    const seg = 0.2;
    const out = S.osc(sr, seg * 4, 'square', (t) => (Math.floor(t / seg) % 2 ? 587 : 740));
    S.filter(out, sr, 'lowpass', 3000);
    const amp = [];
    for (let i = 0; i < 4; i++) amp.push([i * seg, 0], [i * seg + 0.01, 1], [(i + 1) * seg - 0.02, 1], [(i + 1) * seg - 0.005, 0]);
    return S.drive(S.shape(out, sr, S.curve(amp)), 1.5);
  } },
  siren: { srate: 0.5, cat: 'stinger', v: 1, g: 0.5, prio: 100, wet: 0.6, group: 'st_wave', lim: [2, 1], render: (sr) => {
    const dur = 2.8;
    const f = S.curve([[0, 220], [1.0, 640], [1.8, 660], [2.8, 300]]);
    const vib = (t) => f(t) * (1 + 0.012 * Math.sin(6.2832 * 6 * t));
    const out = S.filter(S.osc(sr, dur, 'saw', vib), sr, 'lowpass', 2200);
    S.mix(out, S.filter(S.osc(sr, dur, 'square', (t) => vib(t) * 1.012), sr, 'bandpass', 900, 0.7), sr, 0.5);
    S.shape(out, sr, S.curve([[0, 0], [0.3, 1], [2.2, 1], [2.8, 0]]));
    return S.echoes(out, sr, [[0.25, 0.3, 1500], [0.55, 0.18, 1000]]);
  } },
  horn: { srate: 0.25, cat: 'stinger', v: 1, g: 0.6, prio: 100, wet: 0.5, render: (sr, rng) => {
    const dur = 2.6;
    const out = chord(sr, dur, [73.42, 110, 146.83], 0, 0.004);
    // Re-filter with a swell so the horn blooms then darkens.
    const b = S.filter(S.flutter(out, sr, rng, 25, 0.15), sr, 'lowpass', S.curve([[0, 300], [0.5, 1800], [2.6, 600]]), 0.9);
    return S.env(S.drive(b, 1.5), sr, 0.2, 1, 1.4);
  } },
  boss_spawn: { srate: 0.5, cat: 'stinger', v: 1, g: 0.95, prio: 100, wet: 0.55, range: 4, render: (sr, rng) => {
    const out = S.makeBuf(sr, 3.5);
    S.mix(out, vocal(sr, rng, { dur: 2.8, f0: [[0, 34], [0.6, 46], [2.8, 26]], vowels: ['o', 'a', 'o', 'u'], shift: 0.52,
      breath: 0.4, fry: 1, sub: 0.8, growl: 0.5, growlF: 220, a: 0.2, h: 1, d: 1.4, drive: 4.5, lp: 2500 }), sr, 0.8, 0.1);
    for (const [at, g] of [[0, 1], [0.45, 0.8]]) {
      S.mix(out, thud(sr, 75, 42, 1.2, 0.06, 1.6), sr, g, at);
      S.mix(out, burst(sr, rng, 'bandpass', 250, 1, 0.2), sr, g * 0.5, at);
    }
    return S.mix(out, S.env(S.filter(S.brown(sr, 3.2, rng), sr, 'lowpass', 90), sr, 0.1, 3), sr, 0.6);
  } },
  waveclear: { srate: 0.5, cat: 'stinger', v: 1, g: 0.55, prio: 100, wet: 0.5, group: 'st_waveclear', lim: [2, 1], render: (sr) => {
    const out = S.makeBuf(sr, 2.2);
    const pad = S.filter(chord(sr, 2.1, [146.83, 185, 220, 293.66], 0), sr, 'lowpass', S.curve([[0, 400], [0.4, 2500], [2, 800]]));
    S.mix(out, S.env(pad, sr, 0.06, 1.4, 0.45), sr, 1);
    S.mix(out, S.fmBell(sr, 2, 587.33, { ratio: 2, index: 2, decay: 1.8 }), sr, 0.4, 0.05);
    return S.mix(out, thud(sr, 90, 45, 0.5, 0.05), sr, 0.45);
  } },
  plane: { srate: 0.25, cat: 'stinger', v: 1, g: 0.45, prio: 70, wet: 0.4, render: (sr, rng) => {
    const dur = 4;
    const dop = S.curve([[0, 1.06], [1.8, 1.03], [2.4, 0.94], [4, 0.92]]);
    const amp = S.curve([[0, 0], [1.6, 1], [2.4, 0.8], [4, 0]]);
    const prop = S.osc(sr, dur, 'saw', (t) => 88 * dop(t));
    S.mix(prop, S.osc(sr, dur, 'saw', (t) => 178 * dop(t)), sr, 0.3);
    S.shape(prop, sr, (t) => 0.6 + 0.4 * Math.sin(6.2832 * 34 * t));
    const out = S.shape(S.filter(prop, sr, 'lowpass', 900), sr, amp);
    const wind = S.filter(S.pink(sr, dur, rng), sr, 'bandpass', S.curve([[0, 600], [1.8, 1400], [4, 500]]), 0.8);
    return S.mix(out, S.shape(wind, sr, amp), sr, 0.5);
  } },
  drop_thud: { cat: 'stinger', v: 1, g: 0.75, prio: 75, wet: 0.35, range: 1.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1.0);
    S.mix(out, thud(sr, 75, 38, 0.4, 0.04, 1.8), sr, 1.1);
    S.mix(out, burst(sr, rng, 'lowpass', 1800, 0.7, 0.15), sr, 0.6);
    for (let i = 0; i < 3; i++) S.mix(out, burst(sr, rng, 'bandpass', 1500 + rng.next() * 1500, 1.5, 0.03), sr, 0.4, rng.next() * 0.1);
    S.mix(out, S.partials(sr, 0.5, 320, [[1, 0.25, 0.35], [2.3, 0.15, 0.25], [3.9, 0.08, 0.2]]), sr, 1, 0.02);
    return S.mix(out, S.env(S.filter(S.pink(sr, 0.8, rng), sr, 'highpass', 2000), sr, 0.05, 0.6), sr, 0.15);
  } },
  gameover: { srate: 0.5, cat: 'stinger', v: 1, g: 0.6, prio: 100, wet: 0.55, group: 'st_gameover', lim: [3, 1], render: (sr) => {
    const dur = 4;
    const out = S.makeBuf(sr, dur);
    const fall = (f) => (t) => f * (1 - 0.03 * Math.min(1, t / 3));
    const pad = S.makeBuf(sr, dur);
    for (const f of [73.42, 87.31, 110, 146.83]) {
      S.mix(pad, S.osc(sr, dur, 'saw', fall(f * 1.004)), sr, 0.25);
      S.mix(pad, S.osc(sr, dur, 'saw', fall(f * 0.996)), sr, 0.25);
    }
    S.filter(pad, sr, 'lowpass', S.expSweep(900, 250, 3), 0.8);
    S.mix(out, S.env(pad, sr, 0.05, 3.5), sr, 0.7);
    S.mix(out, S.fmBell(sr, 3, 110, { ratio: 1.4, index: 4, decay: 3 }), sr, 0.5);
    S.mix(out, S.fmBell(sr, 2.5, 110, { ratio: 1.4, index: 4, decay: 2.5 }), sr, 0.4, 1.5);
    return S.mix(out, thud(sr, 50, 25, 2, 0.1, 1.6), sr, 0.7);
  } },
  victory: { srate: 0.5, cat: 'stinger', v: 1, g: 0.55, prio: 100, wet: 0.5, group: 'st_victory', lim: [3, 1], render: (sr) => {
    const out = S.makeBuf(sr, 3.6);
    const steps = [
      [0, [146.83, 185, 220], 0.35], [0.35, [196, 246.94, 293.66], 0.35], [0.7, [220, 277.18, 329.63], 0.4],
      [1.1, [146.83, 220, 293.66, 369.99], 2.4],
    ];
    for (const [at, fs, len] of steps) {
      const c = chord(sr, len + 0.1, fs, 0);
      S.filter(c, sr, 'lowpass', S.curve([[0, 400], [0.08, 3000], [len, 1200]]), 0.8);
      S.mix(out, S.env(c, sr, 0.02, len, len * 0.3), sr, 0.6, at);
      S.mix(out, thud(sr, 110, 80, 0.5, 0.05), sr, 0.5, at);
    }
    return out;
  } },

  // UI. --------------------------------------------------------------------------------------
  ui_click: { cat: 'ui', v: 1, g: 0.3, prio: 100, wet: 0, lim: [0.03, 2], render: (sr, rng) =>
    S.mix(S.mix(S.makeBuf(sr, 0.05), click(sr, rng, 2000, 0.01, 2), sr), S.env(S.osc(sr, 0.04, 'sine', 1400), sr, 0.001, 0.03), sr, 0.3) },
  ui_hover: { cat: 'ui', v: 1, g: 0.12, prio: 100, wet: 0, lim: [0.05, 1], render: (sr) =>
    S.env(S.osc(sr, 0.035, 'sine', 2200), sr, 0.002, 0.025) },
  ui_chat: { cat: 'ui', v: 1, g: 0.25, prio: 100, wet: 0, lim: [0.1, 1], render: (sr) => {
    const out = S.makeBuf(sr, 0.25);
    S.mix(out, blip(sr, 880, 0.12, 'sine'), sr, 0.6);
    return S.mix(out, blip(sr, 1320, 0.14, 'sine'), sr, 0.6, 0.07);
  } },
  ui_join: { cat: 'ui', v: 1, g: 0.3, prio: 100, wet: 0.1, lim: [0.2, 1], render: (sr) => {
    const out = S.makeBuf(sr, 0.45);
    [659.25, 880, 1108.73].forEach((f, i) => S.mix(out, blip(sr, f, 0.22), sr, 0.5, i * 0.07));
    return out;
  } },
  ui_leave: { cat: 'ui', v: 1, g: 0.3, prio: 100, wet: 0.1, lim: [0.2, 1], render: (sr) => {
    const out = S.makeBuf(sr, 0.45);
    [880, 659.25, 440].forEach((f, i) => S.mix(out, blip(sr, f, 0.22), sr, 0.5, i * 0.07));
    return out;
  } },
  ui_countdown: { cat: 'ui', v: 1, g: 0.3, prio: 100, wet: 0.05, lim: [0.25, 1], render: (sr) => {
    const out = S.env(S.osc(sr, 0.3, 'sine', 880), sr, 0.005, 0.15, 0.08);
    return S.mix(out, S.env(S.osc(sr, 0.3, 'tri', 1760), sr, 0.005, 0.1, 0.05), sr, 0.2);
  } },
  ui_ready: { cat: 'ui', v: 1, g: 0.3, prio: 100, wet: 0.05, lim: [0.2, 1], render: (sr) => {
    const out = S.makeBuf(sr, 0.35);
    S.mix(out, S.filter(blip(sr, 660, 0.12, 'square'), sr, 'lowpass', 2500), sr, 0.4);
    return S.mix(out, S.filter(blip(sr, 990, 0.2, 'square'), sr, 'lowpass', 3000), sr, 0.4, 0.09);
  } },

  // Loops (played by the loop voices in audio.update). --------------------------------------
  minigun_spin: { cat: 'loop', loop: true, v: 1, g: 0.35, wet: 0.1, peak: 0.8, render: (sr, rng) => {
    const len = 1;
    // Periodic parts use whole-Hz frequencies so they wrap seamlessly at exactly 1 s.
    const motor = S.filter(S.osc(sr, len, 'saw', 120), sr, 'bandpass', 600, 2);
    S.mix(motor, S.osc(sr, len, 'sine', 1440), sr, 0.12);
    S.mix(motor, S.osc(sr, len, 'sine', 2160), sr, 0.05);
    const whirr = S.loopify(S.filter(S.noise(sr, len + 0.15, rng), sr, 'bandpass', 1800, 0.8), sr, 0.15);
    const out = S.makeBuf(sr, len);
    for (let i = 0; i < out.length; i++) {
      const rot = 0.5 + 0.5 * Math.sin(6.2832 * 36 * i / sr);
      out[i] = motor[i] * 0.5 + whirr[i % whirr.length] * rot * rot * 0.9;
    }
    return out;
  } },
  minigun_fire: { cat: 'loop', loop: true, v: 1, g: 0.6, wet: 0.35, peak: 0.85, render: (sr, rng) => {
    const out = S.makeBuf(sr, 1);
    const shots = [0, 1, 2, 3].map(() => miniShot(sr, rng));
    for (let i = 0; i < 30; i++) S.mixWrap(out, shots[i & 3], sr, 0.85 + rng.next() * 0.15, i / 30 + (rng.next() - 0.5) * 0.002);
    const bed = S.loopify(S.filter(S.noise(sr, 1.1, rng), sr, 'lowpass', 3000), sr, 0.1);
    for (let i = 0; i < out.length; i++) out[i] += bed[i] * 0.08;
    return S.drive(out, 1.3);
  } },
  flame_loop: { srate: 0.5, cat: 'loop', loop: true, v: 1, g: 0.55, wet: 0.2, peak: 0.85, render: (sr, rng) => {
    const len = 2.3;
    const out = S.flutter(S.filter(S.brown(sr, len, rng), sr, 'lowpass', 700, 0.7), sr, rng, 12, 0.5);
    const hiss = S.filter(S.filter(S.pink(sr, len, rng), sr, 'highpass', 1800), sr, 'lowpass', 6000);
    S.mix(out, S.flutter(hiss, sr, rng, 20, 0.6), sr, 0.35);
    S.mix(out, S.filter(S.brown(sr, len, rng), sr, 'lowpass', 120), sr, 0.6);
    S.mix(out, S.filter(S.crackle(sr, len, rng, { rate: 60 }), sr, 'bandpass', 3000, 0.7), sr, 0.3);
    return S.loopify(out, sr, 0.3);
  } },
  cryo_loop: { cat: 'loop', loop: true, v: 1, g: 0.5, wet: 0.2, peak: 0.85, render: (sr, rng) => {
    // a hard hiss of expanding gas with ice crystals tinkling in it
    const len = 2.1;
    const hiss = S.filter(S.filter(S.pink(sr, len, rng), sr, 'highpass', 2200), sr, 'lowpass', 9500);
    const out = S.flutter(hiss, sr, rng, 18, 0.45);
    S.mix(out, S.filter(S.brown(sr, len, rng), sr, 'lowpass', 260), sr, 0.7);
    for (let i = 0; i < 40; i++) {
      const f = 3800 + rng.next() * 4200;
      S.mix(out, S.partials(sr, 0.12, f, [[1, 1, 0.06 + rng.next() * 0.05]]), sr, 0.12 + rng.next() * 0.12, rng.next() * (len - 0.15));
    }
    return S.loopify(out, sr, 0.3);
  } },
  chainsaw_loop: { cat: 'loop', loop: true, v: 1, g: 0.55, wet: 0.12, peak: 0.85, render: (sr, rng) => {
    // two-stroke at full revs (120 firings a second — whole Hz so it wraps at 1 s), a
    // buzzing muffler and the chain rattling over the bar
    const len = 1;
    const out = S.makeBuf(sr, len);
    for (let i = 0; i < 120; i++) {
      const pop = S.env(S.filter(S.noise(sr, 0.012, rng), sr, 'lowpass', 1800), sr, 0.0003, 0.007);
      S.mixWrap(out, pop, sr, 0.7 + rng.next() * 0.3, i / 120 + (rng.next() - 0.5) * 0.0008);
    }
    const muffler = S.filter(S.osc(sr, len, 'saw', 120), sr, 'bandpass', 950, 1.4);
    S.mix(out, muffler, sr, 0.55);
    S.mix(out, S.filter(S.osc(sr, len, 'square', 240), sr, 'bandpass', 2400, 2), sr, 0.12);
    const chain = S.loopify(S.filter(S.noise(sr, len + 0.12, rng), sr, 'bandpass', 4200, 0.9), sr, 0.12);
    for (let i = 0; i < out.length; i++) out[i] += chain[i % chain.length] * 0.35 * (0.8 + 0.2 * Math.sin(6.2832 * 60 * i / sr));
    return S.drive(out, 2.4);
  } },
  chainsaw_idle: { cat: 'loop', loop: true, v: 1, g: 0.32, wet: 0.1, peak: 0.8, render: (sr, rng) => {
    // lumpy idle: ~38 firings a second, some missing
    const len = 1;
    const out = S.makeBuf(sr, len);
    for (let i = 0; i < 38; i++) {
      if (rng.next() < 0.12) continue;
      const pop = S.env(S.filter(S.noise(sr, 0.03, rng), sr, 'lowpass', 900), sr, 0.0005, 0.018);
      S.mixWrap(out, pop, sr, 0.6 + rng.next() * 0.4, i / 38 + (rng.next() - 0.5) * 0.003);
      S.mixWrap(out, thud(sr, 95, 60, 0.02, 0.005, 1.2), sr, 0.5, i / 38);
    }
    S.mix(out, S.filter(S.osc(sr, len, 'saw', 38), sr, 'bandpass', 500, 1.5), sr, 0.4);
    return S.drive(out, 1.8);
  } },
  fire_loop: { srate: 0.5, cat: 'loop', loop: true, v: 1, g: 0.5, wet: 0.2, peak: 0.85, render: (sr, rng) => {
    const len = 4.4;
    const out = S.flutter(S.filter(S.brown(sr, len, rng), sr, 'lowpass', 500, 0.7), sr, rng, 6, 0.5);
    gain(out, 0.6);
    S.mix(out, S.filter(S.crackle(sr, len, rng, { rate: 35, tickMax: 0.006 }), sr, 'bandpass', 2500, 0.6), sr, 1);
    for (let i = 0; i < 20; i++) {
      const p = thud(sr, 180 + rng.next() * 220, 120, 0.02, 0.005, 1);
      S.mix(p, burst(sr, rng, 'bandpass', 1000, 1, 0.01), sr, 0.8);
      S.mix(out, p, sr, 0.2 + rng.next() * 0.4, rng.next() * (len - 0.1));
    }
    return S.loopify(out, sr, 0.4);
  } },
  acid_loop: { cat: 'loop', loop: true, v: 1, g: 0.35, wet: 0.15, peak: 0.8, render: (sr, rng) => {
    const len = 3.3;
    const out = S.flutter(S.filter(S.pink(sr, len, rng), sr, 'highpass', 3500), sr, rng, 15, 0.6);
    gain(out, 0.5);
    for (let i = 0; i < 25; i++) {
      const f = 250 + rng.next() * 150;
      S.mix(out, S.env(S.osc(sr, 0.07, 'sine', S.expSweep(f, f * 1.8, 0.05)), sr, 0.005, 0.06), sr, 0.4 + rng.next() * 0.4, rng.next() * (len - 0.1));
    }
    return S.loopify(out, sr, 0.3);
  } },
  horde_far: { srate: 0.25, cat: 'loop', loop: true, v: 1, g: 0.5, wet: 0.4, peak: 0.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 8);
    for (let i = 0; i < 16; i++) S.mixWrap(out, moan(sr, rng, false), sr, 0.3 + rng.next() * 0.5, rng.next() * 8);
    const bed = S.loopify(S.filter(S.brown(sr, 8.5, rng), sr, 'lowpass', 250), sr, 0.5);
    for (let i = 0; i < out.length; i++) out[i] += bed[i] * 0.3;
    return S.filter(out, sr, 'lowpass', 900, 0.6);
  } },
  horde_near: { srate: 0.5, cat: 'loop', loop: true, v: 1, g: 0.45, wet: 0.25, peak: 0.8, render: (sr, rng) => {
    const out = S.makeBuf(sr, 6);
    for (let i = 0; i < 12; i++) S.mixWrap(out, moan(sr, rng, true), sr, 0.3 + rng.next() * 0.5, rng.next() * 6);
    for (let i = 0; i < 30; i++) S.mixWrap(out, burst(sr, rng, 'bandpass', 350, 1, 0.05), sr, 0.2 + rng.next() * 0.3, rng.next() * 6);
    return S.filter(out, sr, 'lowpass', 3500, 0.6);
  } },

  // Music percussion & colour (music.js). ----------------------------------------------------
  m_taiko: { srate: 0.5, cat: 'music', v: 2, g: 1, wet: 0.4, render: (sr, rng) => {
    const out = thud(sr, 110, 58, 0.7, 0.05, 1.3);
    S.mix(out, burst(sr, rng, 'bandpass', 220, 1, 0.12), sr, 0.5);
    return S.mix(out, click(sr, rng, 1200, 0.01, 1.5), sr, 0.2);
  } },
  m_kick: { cat: 'music', v: 1, g: 1, wet: 0.1, render: (sr, rng) =>
    S.mix(thud(sr, 140, 48, 0.3, 0.03, 1.5), click(sr, rng, 3000, 0.004, 1), sr, 0.3) },
  m_hat: { cat: 'music', v: 2, g: 1, wet: 0.1, render: (sr, rng) => burst(sr, rng, 'highpass', 7000, 0.7, 0.03) },
  m_tick: { cat: 'music', v: 1, g: 1, wet: 0.2, render: (sr, rng) =>
    S.mix(S.mix(S.makeBuf(sr, 0.05), burst(sr, rng, 'bandpass', 1800, 4, 0.02), sr), S.env(S.osc(sr, 0.03, 'sine', 900), sr, 0.001, 0.02), sr, 0.4) },
  m_boom: { srate: 0.25, cat: 'music', v: 1, g: 1, wet: 0.5, render: (sr, rng) => {
    const out = thud(sr, 60, 30, 1.8, 0.1, 1.6);
    S.mix(out, S.env(S.filter(S.brown(sr, 1.6, rng), sr, 'lowpass', 200), sr, 0.01, 1.5), sr, 0.5);
    return S.mix(out, burst(sr, rng, 'lowpass', 3000, 0.7, 0.05), sr, 0.3);
  } },
  m_bell: { srate: 0.5, cat: 'music', v: 1, g: 1, wet: 0.7, render: (sr) =>
    S.echoes(S.fmBell(sr, 3.5, 587.33, { ratio: 1.41, index: 2.5, decay: 3, idxDecay: 1.5 }), sr, [[0.37, 0.3, 2000], [0.74, 0.15, 1500]]) },
  m_swell: { srate: 0.5, cat: 'music', v: 1, g: 1, wet: 0.5, render: (sr, rng) => {
    const b = S.filter(S.noise(sr, 2, rng), sr, 'bandpass', S.expSweep(300, 2400, 1.9), 2);
    return S.shape(b, sr, (t) => (t < 1.9 ? Math.pow(t / 1.9, 2.5) : Math.max(0, 1 - (t - 1.9) * 10)));
  } },
};

function gain(buf, g) {
  return S.gain(buf, g);
}

/** Every sound id in the bank. */
export const SOUND_IDS = Object.keys(SOUNDS);

/** Sample rate sound `id` is rendered at when the output runs at `sr`. */
export function soundRate(id, sr) {
  const def = SOUNDS[id];
  return Math.round(sr * ((def && def.srate) || 1));
}

/**
 * Render variant `v` of sound `id` for an output rate of `sr` (at soundRate(id, sr)):
 * deterministic, peak-normalised, trailing silence trimmed (except loops, whose length
 * is their period).
 */
export function renderSound(id, sr, v = 0) {
  const def = SOUNDS[id];
  if (!def) throw new Error(`unknown sound ${id}`);
  sr = soundRate(id, sr);
  const rng = createRng(hashString(`${id}#${v}`));
  let buf = def.render(sr, rng, v);
  // A DC blocker's warm-up would put a seam in loops; their sources are zero-mean anyway.
  if (!def.loop) S.dcBlock(buf, sr);
  S.normalize(buf, def.peak || 0.9);
  if (!def.loop) buf = S.fadeOut(S.trim(buf, sr), sr, 0.004);
  return buf;
}
