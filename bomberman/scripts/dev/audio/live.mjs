// Live end-to-end check of the REAL browser facade (createAudio: gesture unlock, visibility handling, mute, volume, the 25 ms music
// timer) in headless Chromium, with a real-time AudioContext. render.mjs measures what the synth sounds like offline; this proves the
// wiring around it works in a browser rather than in the Node fake used by specs/unit/audio.spec.js.
//
//   node scripts/dev/audio/live.mjs
//
// A probe taps the signal just before the speakers (an AnalyserNode hung on the final soft-clip node) and samples it every 20 ms, so
// the checks can say "the music never dropped out" or "muting really is silent" about the actual output.
import { openRig } from './rig.mjs';

const rig = await openRig('live.html');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

try {
  const { page } = rig;
  await page.evaluate(() => {
    const probe = { contexts: [], polls: [], analyser: null };
    window.probe = probe;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options) { super(options); probe.contexts.push(this); }
    };
    const connect = AudioNode.prototype.connect;
    WaveShaperNode.prototype.connect = function tapped(dest, ...rest) {
      if (dest instanceof AudioDestinationNode) {
        probe.analyser = this.context.createAnalyser();
        probe.analyser.fftSize = 2048;
        connect.call(this, probe.analyser);
      }
      return connect.call(this, dest, ...rest);
    };
    const buf = new Float32Array(2048);
    setInterval(() => {
      if (!probe.analyser) return;
      probe.analyser.getFloatTimeDomainData(buf);
      let peak = 0, sq = 0;
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
      probe.polls.push({ at: performance.now(), peak, rms: Math.sqrt(sq / buf.length) });
      if (probe.polls.length > 2000) probe.polls.shift();
    }, 20);
  });
  await page.evaluate(async () => {
    const { createAudio } = await import('/js/audio.js');
    window.a = createAudio();
    window.mark = () => performance.now();
    window.since = (t0) => {
      const p = window.probe.polls.filter((x) => x.at >= t0);
      return { n: p.length, peak: Math.max(0, ...p.map((x) => x.peak)), rms: Math.sqrt(p.reduce((s, x) => s + x.rms * x.rms, 0) / Math.max(1, p.length)),
        live: p.filter((x) => x.rms > 5e-4).length / Math.max(1, p.length) };
    };
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(fn)) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

  check(await ev(() => window.a.supported), 'Web Audio is supported');
  check((await ev(() => window.a.state)) === 'locked', 'before the first gesture nothing exists yet (state "locked")');
  check((await ev(() => window.a.play('click'))) === false, 'play() before the unlock is dropped');
  await ev(() => window.a.unlock());
  await page.mouse.click(20, 20);
  check(await until(() => window.a.state === 'running'), 'the first click unlocks a running AudioContext');

  let t0 = await ev(() => window.mark());
  check(await ev(() => window.a.play('explode', { pan: -0.5 })), 'play("explode") sounds');
  await ev(() => window.wait(900));
  let s = await ev((t) => window.since(t), t0);
  check(s.peak > 0.05 && s.peak <= 0.95, `the explosion reaches the speakers at a sane level (peak ${s.peak.toFixed(3)}, ${s.n} polls)`);

  await ev(() => window.a.music('battle'));
  await ev(() => window.wait(600));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(3000));
  s = await ev((t) => window.since(t), t0);
  check(s.live >= 0.95, `the battle music never drops out over 3 s (${(s.live * 100).toFixed(0)} % of polls sounding)`);
  check(s.peak <= 0.18, `music alone stays under the spec's 18 % (peak ${s.peak.toFixed(3)})`);
  const musicRms = s.rms;

  await ev(() => window.a.setVolume(0.4));
  await ev(() => window.wait(300));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(2000));
  s = await ev((t) => window.since(t), t0);
  check(s.rms < musicRms * 0.55 && s.rms > musicRms * 0.08, `volume 0.8 -> 0.4 makes the music much quieter (rms ${musicRms.toFixed(4)} -> ${s.rms.toFixed(4)})`);
  await ev(() => window.a.setVolume(0.8));

  await ev(() => window.a.music('battle_fast'));
  await ev(() => window.wait(1200));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(2000));
  s = await ev((t) => window.since(t), t0);
  check(s.live >= 0.95, `switching to battle_fast crossfades without a dropout (${(s.live * 100).toFixed(0)} % sounding)`);

  await ev(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await ev(() => window.wait(500));
  check((await ev(() => window.a.state)) === 'suspended', 'a hidden tab suspends the context');
  const frozen = await ev(() => window.probe.contexts[0].currentTime);
  await ev(() => window.wait(500));
  check(Math.abs((await ev(() => window.probe.contexts[0].currentTime)) - frozen) < 0.01, 'and the audio clock stands still');
  check((await ev(() => window.a.play('click'))) === false, 'effects are not played while hidden');

  await ev(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await until(() => window.a.state === 'running'), 'coming back resumes the context');
  await ev(() => window.wait(800));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(2000));
  s = await ev((t) => window.since(t), t0);
  check(s.live >= 0.95, `and the music carries on (${(s.live * 100).toFixed(0)} % sounding)`);

  await ev(() => window.a.setMuted(true));
  await ev(() => window.wait(400));
  t0 = await ev(() => window.mark());
  await ev(() => { window.a.play('explode'); return window.wait(800); });
  s = await ev((t) => window.since(t), t0);
  check(s.peak < 1e-4, `mute is silent, even for a new explosion (peak ${s.peak.toExponential(1)})`);
  await ev(() => window.a.setMuted(false));
  await ev(() => window.wait(1500));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(1500));
  s = await ev((t) => window.since(t), t0);
  check(s.live >= 0.9, `unmuting brings the music back (${(s.live * 100).toFixed(0)} % sounding)`);

  await ev(() => window.a.music(null));
  await ev(() => window.wait(1500));
  t0 = await ev(() => window.mark());
  await ev(() => window.wait(800));
  s = await ev((t) => window.since(t), t0);
  check(s.peak < 1e-3, `music(null) stops it (peak ${s.peak.toExponential(1)})`);

  await ev(() => { let n = 0; const end = performance.now() + 1000; while (performance.now() < end) { window.a.play(['explode', 'block', 'death', 'pickup'][n++ % 4], { pan: Math.sin(n) }); } });
  await ev(() => window.wait(1500));
  check(true, 'a burst of thousands of play() calls in one second did not throw or hang the page');

  for (const p of rig.problems) failures.push(p);
  console.log(failures.length ? `\n${failures.length} FAILED CHECK(S)` : '\nall live checks passed');
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await rig.close();
}
