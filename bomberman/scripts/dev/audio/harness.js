// Page side of the audio rig (developer tooling): renders sounds, tracks and stress scenes with the REAL client/js/audio.js
// Engine into an OfflineAudioContext, i.e. through the same master chain (gain, compressor, soft clip) the game uses, and hands the
// samples back to Node (render.mjs) as base64 Float32. Also draws waveform + spectrogram contact sheets.
import { Engine, SOUND_NAMES, MUSIC_NAMES, DEFAULT_VOLUME, compileTrack } from '/js/audio.js';
import { spectrogram } from './analyse.js';

const SR = 44100;
const store = new Map();   // job key -> mono mix, kept for the sheets

/** Deterministic random so two runs render identical samples. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

function toBase64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// Scenes are what a real match throws at the mixer.
const SCENES = {
  sound: (engine, job) => { engine.play(job.name, job.opts ?? {}, 0.05); },

  // `solo` mutes every other part (the compiled track is shared, so the gains are put back right after the run has read them).
  music: (engine, job) => {
    const parts = compileTrack(job.name).parts, gains = parts.map((p) => p.gain);
    if (job.solo) for (const p of parts) if (p.part !== job.solo) p.gain = 0;
    engine.music.start(job.name, { when: 0.05, fade: 0.02 });
    parts.forEach((p, i) => { p.gain = gains[i]; });
    engine.music.pump(job.seconds);
  },

  // Eight bombs going off on the same tick across the arena, crates crumbling, two fighters dying, all over the battle theme.
  boom8: (engine) => {
    engine.music.start('battle', { when: 0, fade: 0.02 });
    engine.music.pump(6);
    const pans = [-0.9, -0.6, -0.3, -0.1, 0.1, 0.3, 0.6, 0.9];
    pans.forEach((pan) => engine.play('explode', { pan }, 1));
    for (let i = 0; i < 6; i++) engine.play('block', { pan: pans[i] }, 1);
    engine.play('death', { pan: -0.3 }, 1);
    engine.play('death', { pan: 0.5 }, 1);
  },

  // Eight bombs 30 ms apart: a rolling chain reaction.
  chain: (engine) => {
    for (let i = 0; i < 8; i++) engine.play('explode', { pan: -0.8 + i * 0.23 }, 0.5 + i * 0.03);
  },

  // Every sound at once under the fast theme, twice over: the voice limit and the output ceiling take the strain.
  everything: (engine) => {
    engine.music.start('battle_fast', { when: 0, fade: 0.02 });
    engine.music.pump(7);
    for (const at of [0.5, 0.6]) SOUND_NAMES.forEach((name, i) => engine.play(name, { pan: -1 + (2 * i) / (SOUND_NAMES.length - 1), vol: 2 }, at));
  },

  // A button-masher: 300 requests in one second must neither pile up nor clip.
  hammer: (engine) => {
    for (let i = 0; i < 300; i++) engine.play(SOUND_NAMES[i % SOUND_NAMES.length], { pan: Math.sin(i) }, 0.2 + i / 300);
  },
};

async function render(job) {
  const { seconds, volume = DEFAULT_VOLUME, seed = 1 } = job;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const engine = new Engine(ctx, { random: mulberry(seed) });
  engine.setMaster(volume, false, true);
  SCENES[job.kind](engine, job);
  const buf = await ctx.startRendering();
  const left = buf.getChannelData(0), right = buf.getChannelData(1), mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (left[i] + right[i]);
  if (job.key) store.set(job.key, mono);
  return { sampleRate: SR, channels: [toBase64(left), toBase64(right)] };
}

/** Magma-like ramp for dB -70..0. */
function heat(dbv) {
  const t = Math.min(1, Math.max(0, (dbv + 70) / 70));
  return `rgb(${Math.round(255 * Math.min(1, t * 1.6))},${Math.round(255 * Math.max(0, t * 1.5 - 0.5))},${Math.round(255 * (t < 0.5 ? t * 1.6 : Math.max(0, 1.4 - t * 1.4)))})`;
}

/** Waveform + log-frequency spectrogram (40 Hz..12 kHz) per stored render, stacked vertically. Returns a PNG data URL. */
function sheet({ keys, pxPerSec = 200, maxWidth = 900, rowHeight = 96 }) {
  const label = 120, canvas = document.createElement('canvas');
  canvas.width = label + maxWidth;
  canvas.height = keys.length * rowHeight;
  const g = canvas.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = '12px sans-serif';
  keys.forEach((key, row) => {
    const x = store.get(key), y0 = row * rowHeight, wave = 36, specH = rowHeight - wave - 4;
    const width = Math.min(maxWidth, Math.floor((x.length / SR) * pxPerSec));
    g.fillStyle = '#ddd'; g.fillText(key, 6, y0 + 16);
    g.fillStyle = '#333'; g.fillRect(label, y0 + wave / 2, width, 1);
    const per = x.length / width;
    for (let px = 0; px < width; px++) {
      let lo = 0, hi = 0;
      for (let i = Math.floor(px * per); i < Math.floor((px + 1) * per); i++) { if (x[i] < lo) lo = x[i]; if (x[i] > hi) hi = x[i]; }
      g.fillStyle = Math.max(hi, -lo) > 0.9 ? '#f55' : '#6cf';
      g.fillRect(label + px, y0 + wave / 2 - hi * (wave / 2), 1, Math.max(1, (hi - lo) * (wave / 2)));
    }
    const size = 1024, hop = Math.max(64, Math.floor(SR / pxPerSec)), spec = spectrogram(x, SR, { size, hop, maxHz: 12000 });
    const binHz = SR / size, fLo = 40, fHi = 12000;
    for (let px = 0; px < Math.min(width, spec.length); px++) {
      for (let py = 0; py < specH; py++) {
        const f = fLo * (fHi / fLo) ** (1 - py / specH), bin = Math.min(spec[px].length - 1, Math.round(f / binHz));
        g.fillStyle = heat(spec[px][bin]);
        g.fillRect(label + px, y0 + wave + py, 1, 1);
      }
    }
  });
  return canvas.toDataURL('image/png');
}

window.audioHarness = { render, sheet, SOUND_NAMES, MUSIC_NAMES, DEFAULT_VOLUME, SR, compileTrack: (n) => { const t = compileTrack(n); return { steps: t.steps, stepDur: t.stepDur, bars: t.bars, bpm: t.bpm, parts: t.parts.map((p) => p.part) }; } };
