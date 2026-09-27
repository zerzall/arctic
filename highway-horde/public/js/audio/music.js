// Procedural score: a dark detuned drone that never stops, plus sparse percussion and a
// filtered bass pulse whose density follows an "intensity" level (calm intermission →
// busy wave → boss fight). Notes are scheduled a little ahead on the audio clock, so
// timing stays tight regardless of frame rate.

import { clamp } from '../shared/math.js';

const LOOKAHEAD = 0.3;          // seconds scheduled ahead of the audio clock
const D2 = 73.42;
// Phrygian-flavoured root movement (semitones from D) changing every two bars: uneasy.
const PROGRESSION = [0, 1, 0, -2, 0, 1, 3, -2];
// Bell pitches as playback rates of the D5 bell (minor pentatonic-ish, with a flat 2 for dread).
const BELL_RATES = [1, 1.189, 0.749, 0.667, 1.059, 0.891, 1.335];

/**
 * @param {BaseAudioContext} ctx
 * @param {{ out: AudioNode, wet: AudioNode, bank: object, rand: () => number }} o
 */
export function createMusic(ctx, { out, wet, bank, rand = Math.random }) {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  const send = ctx.createGain();
  send.gain.value = 0.45;
  bus.connect(send);
  send.connect(wet);

  // ---- drone ----
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  const droneLp = ctx.createBiquadFilter();
  droneLp.type = 'lowpass';
  droneLp.frequency.value = 260;
  droneLp.Q.value = 1.5;
  droneLp.connect(droneGain);
  droneGain.connect(bus);
  const voices = [
    { type: 'sawtooth', mul: 1, detune: -7, g: 0.22 },
    { type: 'sawtooth', mul: 1, detune: 8, g: 0.22 },
    { type: 'sine', mul: 0.5, detune: 0, g: 0.45 },
    { type: 'sawtooth', mul: 1.5, detune: 3, g: 0.08 },
    { type: 'triangle', mul: 2, detune: -4, g: 0.06 },
  ].map((v) => {
    const o = ctx.createOscillator();
    o.type = v.type;
    o.frequency.value = D2 * v.mul;
    o.detune.value = v.detune;
    const g = ctx.createGain();
    g.gain.value = v.g;
    o.connect(g);
    g.connect(droneLp);
    return { osc: o, mul: v.mul };
  });
  // Victory colours the drone with a major third that is otherwise silent.
  const third = ctx.createOscillator();
  third.type = 'sine';
  third.frequency.value = D2 * 2 * 1.26;
  const thirdGain = ctx.createGain();
  thirdGain.gain.value = 0;
  third.connect(thirdGain);
  thirdGain.connect(droneLp);
  // Slow filter breathing so the drone never sits still.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 70;
  lfo.connect(lfoGain);
  lfoGain.connect(droneLp.frequency);

  let started = false;
  let intensity = 0.1, target = 0.1, boss = false, mode = 'menu';
  let nextTime = 0, step = 0, lastTick = 0, rootIdx = 0;
  let lastDrone = -1, lastCut = -1;

  function start(now) {
    if (started) return;
    started = true;
    for (const v of voices) v.osc.start(now);
    third.start(now);
    lfo.start(now);
    bus.gain.setValueAtTime(0, now);
    bus.gain.setTargetAtTime(1, now, 1.5);
    nextTime = now + 0.1;
    lastTick = now;
  }

  function hit(id, t, g, rate = 1) {
    const buf = bank.get(id, rand());
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gn = ctx.createGain();
    gn.gain.value = g;
    src.connect(gn);
    gn.connect(bus);
    src.onended = () => {
      src.disconnect();
      gn.disconnect();
    };
    src.start(t);
  }

  function bass(t, f, len, I) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(180 + 1300 * I, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 + 0.1 * I, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    o.onended = () => {
      o.disconnect();
      lp.disconnect();
      g.disconnect();
    };
    o.start(t);
    o.stop(t + len + 0.02);
  }

  function stepDur() {
    const bpm = 88 + 22 * intensity + (boss ? 10 : 0);
    return 60 / bpm / 4;
  }

  function scheduleStep(t) {
    const i = step % 16;
    const bar = Math.floor(step / 16);
    const I = intensity;
    const playing = mode === 'game' || mode === 'menu';
    if (i === 0 && bar % 2 === 0) {
      rootIdx = (rootIdx + 1) % PROGRESSION.length;
      const root = mode === 'victory' ? 0 : mode === 'gameover' ? -1 : PROGRESSION[rootIdx];
      const f = D2 * Math.pow(2, root / 12);
      for (const v of voices) v.osc.frequency.setTargetAtTime(f * v.mul, t, 0.6);
      third.frequency.setTargetAtTime(f * 2 * 1.26, t, 0.6);
    }
    if (!playing) return;
    const r = rand();
    if (mode === 'game') {
      // Percussion: sparse heartbeat-like taiko when calm, full groove in a big wave.
      if (boss) {
        if (i === 0 || i === 3 || i === 6 || i === 8 || i === 11 || i === 14) hit('m_taiko', t, i % 8 === 0 ? 0.55 : 0.35, i === 0 ? 0.9 : 1);
        if (i === 0 && bar % 2 === 0) hit('m_boom', t, 0.5);
      } else {
        if (i === 0 && I > 0.18) hit('m_taiko', t, 0.25 + 0.3 * I);
        if (i === 8 && I > 0.45) hit('m_taiko', t, 0.3, 1.12);
        if (i === 10 && I > 0.6 && r < 0.5) hit('m_taiko', t, 0.2, 1.25);
      }
      if (I > 0.6 && (i === 0 || i === 8 || (i === 14 && r < 0.3))) hit('m_kick', t, 0.35);
      if (I > 0.35 && i % 4 === 2) hit('m_hat', t, 0.07 + 0.06 * I);
      if ((I > 0.72 || boss) && i % 2 === 0 && r < 0.75) hit('m_hat', t, 0.04 + (i % 4 === 0 ? 0.02 : 0));
      if (I > 0.5 && (i === 4 || i === 12)) hit('m_tick', t, 0.08);
      // Bass pulse: an ostinato on the current root, octave jumps now and then.
      if (I > 0.4 && i % 2 === 0 && (r < 0.55 + 0.45 * I || i === 0)) {
        const root = PROGRESSION[rootIdx];
        const oct = (i === 6 || i === 14) && rand() < 0.35 ? 2 : 1;
        bass(t, D2 * Math.pow(2, root / 12) * oct * 0.5, stepDur() * 1.7, I);
      }
      if (i === 0 && bar % 4 === 3 && I > 0.5 && rand() < 0.5) {
        const s = t + 16 * stepDur() - 1.9;
        if (s > t) hit('m_swell', s, 0.12 + 0.1 * I);
      }
    }
    // Distant bells: the "calm but wrong" colour of intermissions and menus.
    if (i === 0 && bar % 2 === 1 && r < 0.3 + 0.2 * (1 - I)) {
      hit('m_bell', t, 0.06 + 0.04 * (1 - I), BELL_RATES[Math.floor(rand() * BELL_RATES.length)]);
    }
  }

  return {
    /** Target intensity 0..1, boss flag and mode ('menu'|'game'|'gameover'|'victory'). */
    set(nextTarget, nextBoss, nextMode) {
      target = clamp(nextTarget, 0, 1);
      boss = !!nextBoss;
      mode = nextMode;
    },
    get intensity() {
      return intensity;
    },
    /** Advance: smooth intensity, update the drone and schedule notes up to now + LOOKAHEAD. */
    tick(now) {
      start(now);
      const dt = clamp(now - lastTick, 0, 1);
      lastTick = now;
      // Rise quickly when things kick off, relax slowly afterwards.
      const rate = target > intensity ? 0.5 : 0.08;
      intensity += clamp(target - intensity, -rate * dt, rate * dt);
      const I = intensity;
      const dg = mode === 'gameover' ? 0.18 : mode === 'victory' ? 0.3 : 0.2 + 0.2 * I;
      if (Math.abs(dg - lastDrone) > 0.01) {
        droneGain.gain.setTargetAtTime(dg, now, 1.2);
        thirdGain.gain.setTargetAtTime(mode === 'victory' ? 0.12 : 0, now, 1);
        lastDrone = dg;
      }
      const cut = mode === 'gameover' ? 160 : 200 + 800 * I + (boss ? 300 : 0);
      if (Math.abs(cut - lastCut) > 10) {
        droneLp.frequency.setTargetAtTime(cut, now, 0.8);
        lastCut = cut;
      }
      // Resync after the context was suspended (hidden tab) instead of catching up.
      if (nextTime < now - 0.1) nextTime = now + 0.05;
      let guard = 64;
      while (nextTime < now + LOOKAHEAD && guard-- > 0) {
        scheduleStep(nextTime);
        nextTime += stepDur();
        step++;
      }
    },
  };
}
