// Audio verification rig (developer tooling, not part of the game).
//
//   node scripts/dev/audio/render.mjs [--out DIR] [--only name,name] [--no-sheet] [--mix]
//
// Serves the repo, opens scripts/dev/audio/harness.html in headless Chromium and renders every sound effect, every music track and a
// few stress scenes with the real client/js/audio.js Engine into an OfflineAudioContext, through the same master chain the game uses.
// Writes one WAV per render plus waveform/spectrogram contact sheets to --out (default <tmpdir>/blast-party-audio), prints a level
// table and exits non-zero when a check fails:
//   every render   no NaN, peak <= 0.95 at full volume, no DC offset
//   sound effects  audible at the default volume, 20 ms..4 s long, silent at the very end (nothing is cut off with a click)
//   music          peak <= 0.18 at the default volume (the spec's "<= 18 %"), the whole loop is sounding, no gap or double-hit at the loop seam
//   scenes         8 simultaneous explosions, 300 sounds in a second, every sound at once: still <= 0.95
// The default-volume renders are what a player hears out of the box; the full-volume ones prove the limiter.
// --mix instead prints, for each music track, every part soloed (level against the full mix) so the balance can be tuned; it writes nothing.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyse, encodeWav, seamDb } from './analyse.js';
import { openRig } from './rig.mjs';

const args = { out: process.env.AUDIO_OUT || path.join(os.tmpdir(), 'blast-party-audio'), only: null, sheet: true, mix: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--no-sheet') args.sheet = false;
  else if (a === '--mix') args.mix = true;
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--only') args.only = new Set(process.argv[++i].split(','));
  else throw new Error(`unknown argument ${a}`);
}

const decode = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const fmt = (x, n = 1) => x.toFixed(n).padStart(6);
const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); return ok ? '' : ' !'; };

const rig = await openRig('harness.html');
try {
  const { page } = rig;
  await page.waitForFunction(() => window.audioHarness);
  const info = await page.evaluate(() => ({ sounds: [...window.audioHarness.SOUND_NAMES], music: [...window.audioHarness.MUSIC_NAMES], volume: window.audioHarness.DEFAULT_VOLUME }));
  const wanted = (n) => !args.only || args.only.has(n);
  await fs.mkdir(path.join(args.out, 'sfx'), { recursive: true });
  await fs.mkdir(path.join(args.out, 'music'), { recursive: true });
  await fs.mkdir(path.join(args.out, 'scenes'), { recursive: true });

  const run = async (job) => {
    const r = await page.evaluate((j) => window.audioHarness.render(j), job);
    const ch = r.channels.map(decode), mono = ch[0].map((v, i) => 0.5 * (v + ch[1][i]));
    return { ch, mono, sr: r.sampleRate, a: analyse(mono, r.sampleRate), peakLR: Math.max(...ch.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0))) };
  };
  const header = 'name           dur(s)  peak dB  rms dB  50ms dB  centroid  >6kHz%  | full-vol peak';
  const row = (name, d, full) =>
    `${name.padEnd(14)} ${fmt(d.a.active, 2)} ${fmt(d.a.peakDb)} ${fmt(d.a.rmsDb)} ${fmt(d.a.maxRmsDb)}  ${fmt(d.a.centroid, 0)}  ${fmt(d.a.hiShare * 100, 1)}   | ${fmt(full.peakLR, 3)}`;
  const save = (dir, name, d) => fs.writeFile(path.join(args.out, dir, `${name}.wav`), encodeWav(d.ch, d.sr));
  const common = (name, d, full) => {
    const flags = [
      check(d.a.nan === 0 && full.a.nan === 0, `${name}: NaN samples`),
      check(full.peakLR <= 0.95, `${name}: peak ${full.peakLR.toFixed(3)} > 0.95 at full volume`),
      check(Math.abs(d.a.dc) < 0.01, `${name}: DC offset ${d.a.dc.toFixed(4)}`),
    ];
    return flags.join('');
  };

  if (args.mix) {
    for (const name of info.music.filter(wanted)) {
      const t = await page.evaluate((n) => window.audioHarness.compileTrack(n), name);
      const seconds = Math.min(t.steps * t.stepDur, 16), whole = await run({ kind: 'music', name, seconds, volume: info.volume });
      console.log(`\n${name} (${seconds.toFixed(1)} s, default volume)  full mix: peak ${whole.peakLR.toFixed(3)}, rms ${whole.a.rmsDb.toFixed(1)} dB\npart        peak dB  rms dB  vs mix rms  centroid`);
      for (const part of t.parts) {
        const d = await run({ kind: 'music', name, seconds, volume: info.volume, solo: part });
        console.log(`${part.padEnd(10)} ${fmt(d.a.peakDb)} ${fmt(d.a.rmsDb)}  ${fmt(d.a.rmsDb - whole.a.rmsDb)}  ${fmt(d.a.centroid, 0)}`);
      }
    }
    process.exit(0);
  }

  console.log(`\nSOUND EFFECTS (default volume ${info.volume})\n${header}`);
  const sfxKeys = [];
  for (const name of info.sounds.filter(wanted)) {
    const job = { kind: 'sound', name, seconds: 4.5, volume: info.volume, key: `sfx/${name}` };
    const d = await run(job), full = await run({ ...job, volume: 1, key: undefined });
    await save('sfx', name, d);
    sfxKeys.push(job.key);
    const flags = common(name, d, full) + check(d.peakLR >= 0.03 && d.a.maxRmsDb > -45, `${name}: too quiet (peak ${d.peakLR.toFixed(3)})`)
      + check(d.a.active >= 0.02 && d.a.active <= 4, `${name}: audible length ${d.a.active.toFixed(2)} s`)
      + check(d.a.endAbs < 0.002 && d.a.startAbs < 0.02, `${name}: click at the cut (start ${d.a.startAbs.toFixed(4)}, end ${d.a.endAbs.toFixed(4)})`);
    console.log(row(name, d, full) + flags);
  }

  console.log(`\nMUSIC (one loop + 3 s, default volume)\n${header}`);
  const musicKeys = [];
  for (const name of info.music.filter(wanted)) {
    const t = await page.evaluate((n) => window.audioHarness.compileTrack(n), name);
    const loop = t.steps * t.stepDur, job = { kind: 'music', name, seconds: loop + 3, volume: info.volume, key: `music/${name}` };
    const d = await run(job), full = await run({ ...job, volume: 1, key: undefined });
    await save('music', name, d);
    musicKeys.push(job.key);
    const seam = seamDb(d.mono, d.sr, { start: 0.05, barDur: 16 * t.stepDur, bars: t.bars });
    const flags = common(name, d, full) + check(d.peakLR <= 0.18, `${name}: music peak ${d.peakLR.toFixed(3)} > 0.18 at the default volume`)
      + check(Math.abs(seam) <= 4, `${name}: the loop seam is ${seam.toFixed(1)} dB off the other bar lines`)
      + check(d.peakLR >= 0.1, `${name}: music too quiet (peak ${d.peakLR.toFixed(3)})`)
      + check(d.a.active >= loop * 0.9, `${name}: only ${d.a.active.toFixed(1)} s of ${loop.toFixed(1)} s sound`);
    console.log(row(name, d, full) + `   loop ${loop.toFixed(1)} s, ${t.bpm} bpm, ${t.bars} bars, seam ${seam >= 0 ? '+' : ''}${seam.toFixed(1)} dB` + flags);
  }

  console.log(`\nSCENES (full volume)\n${header}`);
  for (const [name, seconds] of [['boom8', 7], ['chain', 3], ['everything', 8], ['hammer', 2.5]].filter(([n]) => wanted(n))) {
    const d = await run({ kind: name, seconds, volume: 1, key: `scenes/${name}` });
    await save('scenes', name, d);
    console.log(row(name, d, d) + common(name, d, d));
  }

  if (args.sheet && sfxKeys.length) {
    const png = await page.evaluate((keys) => window.audioHarness.sheet({ keys, pxPerSec: 200, maxWidth: 760 }), sfxKeys);
    await fs.writeFile(path.join(args.out, 'sfx-sheet.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  if (args.sheet && musicKeys.length) {
    const png = await page.evaluate((keys) => window.audioHarness.sheet({ keys, pxPerSec: 28, maxWidth: 900, rowHeight: 120 }), musicKeys);
    await fs.writeFile(path.join(args.out, 'music-sheet.png'), Buffer.from(png.split(',')[1], 'base64'));
  }

  console.log(`\nfiles in ${args.out}`);
  failures.push(...rig.problems);
  if (failures.length) {
    console.log(`\n${failures.length} FAILED CHECK(S):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('all checks passed');
  }
} finally {
  await rig.close();
}
