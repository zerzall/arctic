/* Rainbow Rails — audio
 * Web Audio only, everything synthesised. A procedural arrangement per world (drums, bass, chord pad,
 * arpeggio and a lead motif with variations over a 32-bar form), a calmer title/game-over arrangement,
 * tempo that nudges up with speed, a low-pass sweep inside tunnels, ducking on pause, and sound effects
 * for every gameplay event (subscribed with RR.on). Master bus: compressor -> limiter, so nothing clips.
 *
 * The AudioContext is created in init(), which game.js calls from a user gesture. The scheduler looks
 * ahead ~0.25 s from update(frame) and from a 50 ms timer; after a hitch it skips the missed steps
 * (keeping the beat grid) instead of playing them all at once.
 */
(function (RR) {
  'use strict';
  if (!RR) return;
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const OAC = typeof window !== 'undefined' ? window.OfflineAudioContext || window.webkitOfflineAudioContext : null;

  // ------------------------------------------------------------------ music data
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const MTOF = new Float32Array(128);
  for (let i = 0; i < 128; i++) MTOF[i] = 440 * Math.pow(2, (i - 69) / 12);
  // Motif notes: [step (0..31 over two bars), scale degree (0 = key root, 7 = octave), length in 16ths]
  const SONGS = {
    sunset: { // golden-hour nu-disco
      bpm: 108, swing: 0.56, root: 48, scale: 'major', prog: [0, 5, 3, 4], sevenths: true,
      kick: 'x...x...x...x...', snare: '....x.......x..g', hat: 'g.x.g.o.g.x.g.ox', shaker: '', clap: '....x.......x...',
      bass: 'R.O.R.O.R.O.R.Ox', bassWave: 'sawtooth', bassCut: 900, arp: [0, 2, 3, 2, 1, 2, 3, 4, 0, 2, 3, 2, 1, 2, 4, 3], arpWave: 'square', arpEvery: 1, arpCut: 2600,
      padWave: 'sawtooth', padCut: 1300, leadWave: 'triangle', lead2: 'square', lead2Gain: 0.3, lead2Detune: 7, leadOct: 0,
      A: [[0, 4, 2], [3, 4, 1], [4, 5, 2], [6, 4, 2], [8, 2, 3], [12, 4, 2], [14, 5, 2], [16, 7, 3], [19, 6, 1], [20, 5, 2], [22, 4, 2], [24, 2, 6]],
      B: [[0, 3, 2], [2, 4, 2], [4, 5, 4], [8, 7, 2], [10, 5, 2], [12, 4, 4], [16, 2, 2], [18, 3, 2], [20, 4, 2], [22, 1, 2], [24, 0, 8]]
    },
    coast: { // tropical house
      bpm: 112, swing: 0.54, root: 50, scale: 'major', prog: [0, 4, 5, 3], sevenths: false,
      kick: 'x...x...x...x...', snare: '', hat: '..o...o...o...o.', shaker: 'xgxgxgxgxgxgxgxg', clap: '....x.......x...',
      bass: 'R..R..R.R..R..5.', bassWave: 'triangle', bassCut: 1200, arp: [0, -1, 2, 0, -1, 3, -1, 2, 0, -1, 2, 0, -1, 4, 3, -1], arpWave: 'sine', arpEvery: 1, arpCut: 5000, arpPluck: true,
      padWave: 'triangle', padCut: 1800, leadWave: 'triangle', lead2: 'sine', lead2Gain: 0.45, lead2Oct: 12, leadOct: 0, leadPluck: true,
      A: [[0, 7, 2], [3, 6, 1], [4, 7, 2], [6, 4, 2], [10, 4, 2], [12, 5, 2], [14, 7, 2], [16, 8, 3], [19, 7, 1], [20, 6, 2], [22, 4, 4], [28, 6, 2], [30, 7, 2]],
      B: [[0, 5, 3], [3, 7, 3], [6, 9, 2], [8, 7, 4], [12, 5, 2], [14, 4, 2], [16, 3, 3], [19, 5, 3], [22, 7, 2], [24, 5, 2], [26, 4, 6]]
    },
    candy: { // bubblegum pop
      bpm: 124, swing: 0.5, root: 53, scale: 'major', prog: [0, 3, 1, 4], sevenths: false,
      kick: 'x...x...x...x...', snare: '....x.......x.x.', hat: 'x.x.x.x.x.x.x.x.', shaker: '', clap: '',
      bass: 'R.ROR.ROR.ROR.5O', bassWave: 'square', bassCut: 1100, arp: [0, 1, 2, 3, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3], arpWave: 'triangle', arpEvery: 1, arpCut: 4200,
      padWave: 'triangle', padCut: 2200, leadWave: 'sine', lead2: 'square', lead2Gain: 0.18, lead2Oct: 12, leadOct: 0, leadPluck: true,
      A: [[0, 4, 1], [2, 4, 1], [4, 5, 1], [6, 4, 1], [8, 7, 2], [10, 6, 2], [12, 4, 4], [16, 3, 1], [18, 3, 1], [20, 5, 1], [22, 3, 1], [24, 7, 2], [26, 5, 2], [28, 3, 4]],
      B: [[0, 1, 1], [2, 3, 1], [4, 5, 1], [6, 8, 2], [8, 7, 2], [10, 5, 2], [12, 3, 4], [16, 4, 1], [18, 6, 1], [20, 8, 1], [22, 9, 1], [24, 8, 2], [26, 6, 2], [28, 4, 4]]
    },
    neon: { // synthwave
      bpm: 118, swing: 0.5, root: 45, scale: 'minor', prog: [0, 5, 2, 6], sevenths: true,
      kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'ggxgggxgggxgggxg', shaker: '', clap: '',
      bass: 'RRRRRRRRRRRRRROR', bassWave: 'sawtooth', bassCut: 700, bassPluck: true, arp: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1], arpWave: 'square', arpEvery: 1, arpCut: 3000,
      padWave: 'sawtooth', padCut: 1100, leadWave: 'sawtooth', lead2: 'square', lead2Gain: 0.35, lead2Detune: -9, leadOct: 0, vibrato: true,
      A: [[0, 7, 4], [4, 6, 2], [6, 4, 2], [8, 4, 3], [11, 6, 1], [12, 7, 4], [16, 9, 4], [20, 7, 2], [22, 5, 2], [24, 7, 8]],
      B: [[0, 9, 3], [3, 8, 1], [4, 7, 2], [6, 6, 2], [8, 4, 4], [12, 6, 4], [16, 6, 4], [20, 8, 2], [22, 10, 2], [24, 8, 4], [28, 6, 4]]
    },
    frost: { // glittering chill
      bpm: 100, swing: 0.53, root: 47, scale: 'major', prog: [5, 3, 0, 4], sevenths: false,
      kick: 'x.........x.....', snare: '........x.......', hat: 'x.g.x.g.x.g.x.gx', shaker: 'gggggggggggggggg', clap: '',
      bass: 'R.......5.......', bassWave: 'triangle', bassCut: 800, bassSustain: true, arp: [0, -1, 2, -1, 3, -1, 4, -1, 3, -1, 2, -1, 1, -1, 2, -1], arpWave: 'sine', arpEvery: 1, arpCut: 7000, arpBell: true,
      padWave: 'triangle', padCut: 1600, leadWave: 'triangle', lead2: 'sine', lead2Gain: 0.4, lead2Oct: 12, leadOct: 0, leadBell: true,
      A: [[0, 5, 2], [2, 7, 2], [4, 9, 4], [8, 7, 2], [10, 5, 2], [12, 4, 4], [16, 3, 2], [18, 5, 2], [20, 7, 4], [24, 5, 2], [26, 4, 2], [28, 3, 4]],
      B: [[0, 4, 2], [2, 7, 2], [4, 9, 2], [6, 11, 4], [10, 9, 2], [12, 7, 4], [16, 6, 4], [20, 8, 2], [22, 6, 2], [24, 4, 8]]
    }
  };
  const SONG_BY_KIND = { city: 'sunset', beach: 'coast', candy: 'candy', neon: 'neon', snow: 'frost' };
  // Pre-index motifs: noteAt[step] = [deg, len] for the 4 two-bar phrases A, A', B, B' (built once per song).
  function buildSong(id, w) {
    const S = SONGS[id] || SONGS.sunset;
    if (S.built) return S;
    const mk = (notes, vary) => {
      const arr = new Array(32).fill(null);
      notes.forEach((n, i) => {
        let d = n[1];
        if (vary === 'up' && i >= notes.length - 2) d += 2; // A': ends higher (question)
        if (vary === 'home' && i === notes.length - 1) d = 7 * Math.round(d / 7); // B': resolves to the tonic
        arr[n[0]] = [d, n[2]];
      });
      return arr;
    };
    S.phr = [mk(S.A), mk(S.A, 'up'), mk(S.B), mk(S.B, 'home')];
    S.scaleArr = SCALES[S.scale] || SCALES.major;
    S.rootMidi = w && typeof w.musicKey === 'number' ? 48 + w.musicKey : S.root; // RR.WORLDS[].musicKey sets the key (C3 + key)
    S.built = true;
    return S;
  }
  const degMidi = (S, rootMidi, d) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return rootMidi + 12 * o + S.scaleArr[i]; };

  // ------------------------------------------------------------------ engine (works on a live or offline context)
  function createEngine(ctx) {
    const sr = ctx.sampleRate;
    const E = { ctx, soundOn: true, musicOn: true, live: true };
    const now = () => ctx.currentTime;
    // --- shared buffers
    const noise = ctx.createBuffer(1, Math.floor(sr * 3), sr);
    { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    function makeIR(sec, decay) {
      const n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c); let lp = 0;
        for (let i = 0; i < n; i++) { const t = i / n; lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.35 * t); d[i] = lp * Math.pow(1 - t, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1); }
      }
      return b;
    }
    // --- master chain: master -> compressor -> limiter -> out
    const master = ctx.createGain(); master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.005; comp.release.value = 0.22;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    const out = ctx.createGain(); out.gain.value = 0.8;
    master.connect(comp); comp.connect(lim); lim.connect(out); out.connect(ctx.destination);
    // --- reverb (shared by music and sfx sends)
    const reverb = ctx.createConvolver(); reverb.buffer = makeIR(2.2, 3.2);
    const revOut = ctx.createGain(); revOut.gain.value = 0.9;
    reverb.connect(revOut); revOut.connect(master);
    // --- music bus
    const musicPre = ctx.createGain(); musicPre.gain.value = 1;
    const musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000; musicFilter.Q.value = 0.7;
    const musicOut = ctx.createGain(); musicOut.gain.value = 0.42;
    musicPre.connect(musicFilter); musicFilter.connect(musicOut); musicOut.connect(master);
    const musicWet = ctx.createGain(); musicWet.gain.value = 1; // sum of instrument sends
    const musicWetOut = ctx.createGain(); musicWetOut.gain.value = 0.42 * 0.28;
    musicWet.connect(musicWetOut); musicWetOut.connect(reverb);
    // echo for arp/lead (dotted eighth, follows tempo)
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.4;
    const delayFb = ctx.createGain(); delayFb.gain.value = 0.3;
    const delayLp = ctx.createBiquadFilter(); delayLp.type = 'lowpass'; delayLp.frequency.value = 2800;
    const delayIn = ctx.createGain(); delayIn.gain.value = 1;
    delayIn.connect(delay); delay.connect(delayLp); delayLp.connect(delayFb); delayFb.connect(delay); delayLp.connect(musicPre);
    // instrument buses
    const bus = (g, send, echo) => { const n = ctx.createGain(); n.gain.value = g; n.connect(musicPre); if (send) { const s = ctx.createGain(); s.gain.value = send; n.connect(s); s.connect(musicWet); } if (echo) { const e = ctx.createGain(); e.gain.value = echo; n.connect(e); e.connect(delayIn); } return n; };
    const drums = bus(0.9, 0.08, 0);
    const bassB = bus(0.62, 0, 0);
    const padDuck = ctx.createGain(); padDuck.gain.value = 1;
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1400; padF.Q.value = 0.5;
    const padB = bus(0.3, 0.55, 0); padF.connect(padDuck); padDuck.connect(padB);
    const arpF = ctx.createBiquadFilter(); arpF.type = 'lowpass'; arpF.frequency.value = 3000;
    const arpB = bus(0.2, 0.3, 0.35); arpF.connect(arpB);
    const leadF = ctx.createBiquadFilter(); leadF.type = 'lowpass'; leadF.frequency.value = 4200;
    const leadB = bus(0.3, 0.35, 0.22); leadF.connect(leadB);
    // --- sfx bus
    const sfxOut = ctx.createGain(); sfxOut.gain.value = 0.9; sfxOut.connect(master);
    const sfxWet = ctx.createGain(); sfxWet.gain.value = 0.9 * 0.3; sfxWet.connect(reverb);
    const canPan = typeof ctx.createStereoPanner === 'function';

    // ---------------------------------------------------------------- primitives
    function envGain(t, a, peak, d, dest) { // attack-decay (exponential tail)
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      g.connect(dest);
      return g;
    }
    function ahdr(t, a, peak, hold, r, dest) { // attack-hold-release
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
      g.connect(dest);
      return g;
    }
    function osc(type, f, t, end, dest, detune) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (detune) o.detune.setValueAtTime(detune, t);
      o.connect(dest); o.start(t); o.stop(end + 0.02);
      return o;
    }
    function noiseSrc(t, dur, dest) {
      const s = ctx.createBufferSource(); s.buffer = noise;
      const d = Math.min(dur + 0.02, 2.9), off = Math.random() * (2.95 - d); // random window, never past the buffer end
      s.connect(dest); s.start(t, off, d);
      return s;
    }
    function filt(type, f, q, dest, t, f2, dur) {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q || 0.7;
      if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + dur);
      b.connect(dest);
      return b;
    }
    function panner(p, dest) { if (!canPan || !p) return dest; const n = ctx.createStereoPanner(); n.pan.value = p; n.connect(dest); return n; }

    // ---------------------------------------------------------------- drums
    function kick(t, v) {
      const g = envGain(t, 0.002, 0.95 * v, 0.34, drums);
      const o = osc('sine', 150, t, t + 0.4, g); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      const c = envGain(t, 0.001, 0.25 * v, 0.02, drums); osc('square', 900, t, t + 0.03, filt('lowpass', 2000, 0.7, c, t));
      // sidechain-style pump on the pad
      padDuck.gain.cancelScheduledValues(t); padDuck.gain.setValueAtTime(0.45, t); padDuck.gain.linearRampToValueAtTime(1, t + 0.2);
    }
    function snare(t, v) {
      const g = envGain(t, 0.002, 0.42 * v, 0.17, drums);
      noiseSrc(t, 0.22, filt('bandpass', 1900, 0.9, g, t));
      const g2 = envGain(t, 0.002, 0.3 * v, 0.07, drums); const o = osc('triangle', 200, t, t + 0.1, g2); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    }
    function clap(t, v) {
      const g = ctx.createGain(); g.connect(drums);
      g.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 3; i++) { const tt = t + i * 0.011; g.gain.setValueAtTime(0.38 * v, tt); g.gain.exponentialRampToValueAtTime(0.05 * v, tt + 0.009); }
      g.gain.setValueAtTime(0.32 * v, t + 0.034); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      noiseSrc(t, 0.22, filt('bandpass', 1250, 1.3, g, t));
    }
    function hat(t, v, open) {
      const g = envGain(t, 0.001, (open ? 0.13 : 0.11) * v, open ? 0.2 : 0.04, drums);
      noiseSrc(t, open ? 0.25 : 0.06, filt('highpass', 7200, 0.7, g, t));
    }
    function shaker(t, v) { const g = envGain(t, 0.004, 0.05 * v, 0.05, drums); noiseSrc(t, 0.07, filt('bandpass', 6500, 1.8, g, t)); }
    function cymbal(t, v) { const g = envGain(t, 0.002, 0.14 * v, 1.4, drums); noiseSrc(t, 1.5, filt('highpass', 5200, 0.6, g, t)); }

    // ---------------------------------------------------------------- tonal voices
    function bassNote(t, m, dur, v, S) {
      const f = MTOF[m];
      const g = ahdr(t, 0.006, 0.5 * v, Math.max(0.02, dur - 0.06), 0.08, bassB);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = S.bassPluck ? 6 : 1.5; lp.connect(g);
      const c0 = S.bassCut * (S.bassPluck ? 3.2 : 1.8);
      lp.frequency.setValueAtTime(c0, t); lp.frequency.exponentialRampToValueAtTime(S.bassCut * 0.55, t + Math.min(0.25, dur));
      osc(S.bassWave, f, t, t + dur + 0.1, lp);
      const sub = ahdr(t, 0.006, 0.35 * v, Math.max(0.02, dur - 0.06), 0.08, bassB); osc('sine', f, t, t + dur + 0.1, sub);
    }
    function padChord(t, ms, dur, v, S) {
      for (let i = 0; i < ms.length; i++) {
        const f = MTOF[ms[i]];
        const g = ahdr(t, 0.12, 0.13 * v, Math.max(0.05, dur - 0.2), 0.35, padF);
        osc(S.padWave, f, t, t + dur + 0.4, g, -8);
        osc(S.padWave, f, t, t + dur + 0.4, g, 8);
      }
    }
    function arpNote(t, m, dur, v, S) {
      const f = MTOF[m];
      const d = S.arpPluck ? 0.16 : S.arpBell ? 0.5 : Math.max(0.06, dur * 0.8);
      const g = envGain(t, 0.003, 0.3 * v, d, arpF);
      osc(S.arpWave, f, t, t + d + 0.05, g);
      if (S.arpBell) { const g2 = envGain(t, 0.002, 0.08 * v, d * 0.5, arpF); osc('sine', f * 3.01, t, t + d, g2); }
    }
    function leadNote(t, m, dur, v, S) {
      const f = MTOF[m];
      let g;
      if (S.leadPluck || S.leadBell) g = envGain(t, 0.004, 0.42 * v, Math.max(0.18, dur * (S.leadBell ? 1.6 : 1.1)), leadF);
      else g = ahdr(t, 0.012, 0.36 * v, Math.max(0.03, dur - 0.08), 0.14, leadF);
      const end = t + dur + (S.leadBell ? 0.9 : 0.3);
      const o1 = osc(S.leadWave, f, t, end, g);
      const g2 = ctx.createGain(); g2.gain.value = S.lead2Gain || 0; g2.connect(g);
      const o2 = osc(S.lead2 || 'sine', f * (S.lead2Oct ? 2 : 1), t, end, g2, S.lead2Detune || 0);
      if (S.vibrato && dur > 0.3) { // delayed vibrato on long notes
        const l = ctx.createOscillator(); l.frequency.value = 5.5; const lg = ctx.createGain();
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + Math.min(0.35, dur * 0.6));
        l.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune); l.start(t); l.stop(end);
      }
    }

    // ---------------------------------------------------------------- music scheduler
    const M = E.music = { world: 0, pendingWorld: -1, mode: 'title', pendingMode: null, step: 0, next: 0, bpm: 100, delayBpm: 0, started: false, S: null, speed: 0, played: 0, skipped: 0 };
    function songFor(i) {
      const w = RR.WORLDS && RR.WORLDS[i] ? RR.WORLDS[i] : null;
      const id = w ? (SONGS[w.id] ? w.id : SONG_BY_KIND[w.kind] || 'sunset') : 'sunset';
      return buildSong(id, w);
    }
    M.S = songFor(0);
    M.bpm = M.S.bpm * 0.82;
    const stepDur = (step) => {
      const base = 60 / M.bpm / 4, sw = M.mode === 'run' ? M.S.swing : 0.5 + (M.S.swing - 0.5) * 0.5;
      return (step & 1) === 0 ? base * 2 * sw : base * 2 * (1 - sw);
    };
    function targetBpm() {
      const S = M.S;
      if (M.mode !== 'run') return S.bpm * 0.82;
      const k = Math.min(1, Math.max(0, (M.speed - 22) / 28));
      return S.bpm * (1 + 0.1 * k);
    }
    function playStep(step, t) {
      const S = M.S, mode = M.mode;
      const s = step & 15, bar = step >> 4;
      const key = S.rootMidi;
      const chordDeg = S.prog[bar % S.prog.length];
      const run = mode === 'run', calm = !run;
      const cyc = bar % 32;
      const brk = run && cyc >= 16 && cyc < 24;
      const fill = run && (cyc % 8 === 7) && s >= 12;
      const soft = mode === 'over' ? 0.55 : 0.8;
      // --- drums
      if (run) {
        if (!brk || cyc >= 22) { if (S.kick[s] === 'x') kick(t, 1); }
        if (!brk) {
          if (S.snare && S.snare[s] === 'x') snare(t, 1); else if (S.snare && S.snare[s] === 'g') snare(t, 0.35);
          if (S.clap && S.clap[s] === 'x') clap(t, 0.9);
        }
        if (fill) snare(t, 0.45 + 0.15 * (s - 12));
        const h = S.hat[s];
        if (h === 'x') hat(t, brk ? 0.6 : 1, false); else if (h === 'o') hat(t, brk ? 0.5 : 0.9, true); else if (h === 'g') hat(t, brk ? 0.3 : 0.45, false);
        if (S.shaker && S.shaker[s] !== '.') shaker(t, S.shaker[s] === 'x' ? 1 : 0.55);
        if (s === 0 && (cyc === 0 || cyc === 8 || cyc === 24)) cymbal(t, 1);
      } else if (mode === 'title' && (s === 4 || s === 12)) shaker(t, 0.7);
      // --- bass
      const bc = S.bass[s];
      if (bc !== '.' && !(calm && s % 8 !== 0)) {
        let deg = chordDeg, oct = 0;
        if (bc === 'O') oct = 12; else if (bc === '5') deg += 4; else if (bc === '3') deg += 2;
        let len = 1; while (len < 8 && s + len < 16 && S.bass[s + len] === '.') len++;
        const steps = calm ? 7 : bc === 'x' ? 0.8 : S.bassSustain ? len : Math.min(len, 2);
        const dur = stepDur(step) * steps * 0.9;
        bassNote(t, degMidi(S, key - 12, deg) + oct, dur, (brk ? 0.7 : 1) * (calm ? 0.5 : 1), S);
      }
      // --- pad (one chord per bar)
      if (s === 0) {
        const r = key + 12;
        const ms = [degMidi(S, r, chordDeg), degMidi(S, r, chordDeg + 2), degMidi(S, r, chordDeg + 4)];
        if (S.sevenths) ms.push(degMidi(S, r, chordDeg + 6));
        padChord(t, ms, stepDur(step) * 16, calm ? 0.75 * soft : brk ? 1.1 : 0.85, S);
      }
      // --- arpeggio
      const ai = S.arp[s];
      if (ai >= 0 && (run || (s & 1) === 0)) {
        const r = key + 24;
        const tones = ai < 3 ? chordDeg + ai * 2 : chordDeg + (ai - 3) * 2 + 7;
        arpNote(t, degMidi(S, r, tones), stepDur(step), (calm ? 0.55 * soft : brk ? 1.05 : 0.8) * (s % 4 === 0 ? 1 : 0.75), S);
      }
      // --- lead motif: A A' B B' (two bars each); break plays B softly; calm modes play every other phrase
      const phraseIdx = ((bar >> 1) & 3);
      const inPh = ((bar & 1) << 4) | s;
      let leadOn = run ? !(brk && phraseIdx < 2) : mode === 'title' && ((bar >> 3) & 1) === 1;
      if (leadOn) {
        const n = S.phr[phraseIdx][inPh];
        if (n) {
          const oct = run && cyc >= 8 && cyc < 16 && phraseIdx < 2 ? 12 : 0;
          const dur = stepDur(step) * n[1] * 0.95;
          leadNote(t, degMidi(S, key + 24 + (S.leadOct || 0), n[0]) + oct, dur, (calm ? 0.55 : brk ? 0.7 : 1), S);
        }
      }
    }
    function applyPending() { // at a bar line; a new world starts its song from the top
      let changed = false;
      if (M.pendingWorld >= 0 && M.pendingWorld !== M.world) { M.world = M.pendingWorld; M.S = songFor(M.world); changed = true; }
      M.pendingWorld = -1;
      return changed;
    }
    E.schedule = function (until) {
      const t = now();
      if (!M.started) { M.next = t + 0.08; M.step = 0; M.started = true; }
      if (M.next < t - 0.03) { // fell behind (frame hitch, background tab): skip the missed steps, keep the grid
        let guard = 0;
        while (M.next < t + 0.02 && guard++ < 4096) { M.next += stepDur(M.step); M.step++; M.skipped++; }
      }
      let guard = 0;
      while (M.next < until && guard++ < 64) {
        const s = M.step & 15;
        if (M.pendingMode && (s & 3) === 0) { // mode changes land on the next beat and restart the bar
          M.mode = M.pendingMode; M.pendingMode = null; M.step = 0; applyPending();
        } else if (s === 0 && applyPending()) M.step = 0;
        M.bpm += (targetBpm() - M.bpm) * 0.08;
        if (E.musicOn) { playStep(M.step, M.next); M.played++; }
        M.next += stepDur(M.step);
        M.step++;
      }
      if (Math.abs(M.bpm - M.delayBpm) > 0.5) { M.delayBpm = M.bpm; delay.delayTime.setTargetAtTime((60 / M.bpm) * 0.75, t, 0.5); }
    };
    E.setMode = (m, immediate) => { if (m === M.mode && !M.pendingMode) return; if (immediate) { M.mode = m; M.pendingMode = null; } else M.pendingMode = m; };
    E.setWorld = (i, immediate) => { if (immediate) { M.world = i; M.S = songFor(i); M.pendingWorld = -1; } else M.pendingWorld = i; };

    // ---------------------------------------------------------------- music bus control
    const cur = { cut: -1, q: -1, gain: -1, wet: -1 };
    E.setMusicShape = (cut, q, gain, wet, tc) => {
      const t = now();
      if (Math.abs(cut - cur.cut) > 1) { musicFilter.frequency.cancelScheduledValues(t); musicFilter.frequency.setTargetAtTime(cut, t, tc); cur.cut = cut; }
      if (q !== cur.q) { musicFilter.Q.setTargetAtTime(q, t, tc); cur.q = q; }
      const g = E.musicOn ? gain : 0;
      if (g !== cur.gain) { musicOut.gain.cancelScheduledValues(t); musicOut.gain.setTargetAtTime(g, t, 0.12); musicWetOut.gain.setTargetAtTime(g * wet, t, 0.12); cur.gain = g; cur.wet = wet; }
      else if (wet !== cur.wet) { musicWetOut.gain.setTargetAtTime(g * wet, t, 0.3); cur.wet = wet; }
    };
    E.setSoundGain = (on) => { const t = now(); sfxOut.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.05); sfxWet.gain.setTargetAtTime(on ? 0.27 : 0, t, 0.05); };

    // ---------------------------------------------------------------- sound effects
    const lastT = {};
    const voiceEnds = new Float64Array(40); let vHead = 0;
    function activeVoices(t) { let n = 0; for (let i = 0; i < voiceEnds.length; i++) if (voiceEnds[i] > t) n++; return n; }
    function claim(name, minGap, dur, lowPriority) {
      const t = now();
      if (lastT[name] !== undefined && t - lastT[name] < minGap) return -1;
      if (lowPriority && activeVoices(t) > 22) return -1;
      lastT[name] = t;
      voiceEnds[vHead] = t + dur; vHead = (vHead + 1) % voiceEnds.length;
      return t + 0.005;
    }
    const sfxDest = (vol, pan, wet) => { const g = ctx.createGain(); g.gain.value = vol; g.connect(panner(pan, sfxOut)); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(sfxWet); } return g; };
    function blip(t, type, f0, f1, dur, vol, dest, a) {
      const g = envGain(t, a || 0.004, vol, dur, dest);
      const o = osc(type, f0, t, t + dur + 0.05, g);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      return o;
    }
    function whoosh(t, dur, vol, f0, f1, q, dest, type) {
      const g = ctx.createGain(); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      noiseSrc(t, dur, filt(type || 'bandpass', f0, q || 1.2, g, t, f1, dur));
    }
    function arpeggio(t, midis, gap, dur, vol, type, dest, bell) {
      for (let i = 0; i < midis.length; i++) {
        const tt = t + i * gap, f = MTOF[midis[i]];
        blip(tt, type, f, 0, dur, vol, dest, 0.003);
        if (bell) blip(tt, 'sine', f * 2, 0, dur * 0.6, vol * 0.35, dest, 0.002);
      }
    }
    const coin = { streak: 0, last: -9 };
    const COIN_STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19];
    const SFX = {
      coin(d) {
        const t0 = now();
        if (t0 - coin.last < 0.6) coin.streak = Math.min(COIN_STEPS.length - 1, coin.streak + 1); else coin.streak = 0;
        coin.last = t0;
        const t = claim('coin', 0.045, 0.3, true); if (t < 0) return;
        const m = 83 + COIN_STEPS[coin.streak], dest = sfxDest(0.17, 0, 0.1);
        const lp = filt('lowpass', 5200, 0.7, dest, t);
        blip(t, 'square', MTOF[m], 0, 0.06, 0.5, lp, 0.002);
        blip(t + 0.055, 'square', MTOF[m + 5], 0, 0.22, 0.5, lp, 0.002);
        blip(t + 0.055, 'sine', MTOF[m + 17], 0, 0.16, 0.25, dest, 0.002);
        void d;
      },
      jump(d) {
        const t = claim('jump', 0.08, 0.3); if (t < 0) return;
        const sup = d && d.super, dest = sfxDest(sup ? 0.3 : 0.24, 0, 0.05);
        blip(t, 'triangle', sup ? 240 : 300, sup ? 980 : 720, sup ? 0.2 : 0.13, 0.7, dest);
        whoosh(t, 0.18, 0.25, 900, 2600, 1.1, dest);
        if (sup) arpeggio(t + 0.06, [84, 88, 91, 96], 0.035, 0.12, 0.25, 'sine', dest);
      },
      roll() {
        const t = claim('roll', 0.1, 0.35); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0);
        whoosh(t, 0.3, 0.8, 2200, 380, 1.4, dest);
        blip(t, 'sine', 160, 80, 0.08, 0.35, dest);
      },
      land(d) {
        const hard = d && d.hard;
        const t = claim('land', 0.09, 0.3, !hard); if (t < 0) return;
        const dest = sfxDest(hard ? 0.26 : 0.09, 0, 0);
        blip(t, 'sine', hard ? 120 : 150, hard ? 38 : 70, hard ? 0.2 : 0.08, 0.9, dest, 0.002);
        const g = envGain(t, 0.002, hard ? 0.55 : 0.25, hard ? 0.16 : 0.06, dest); noiseSrc(t, 0.2, filt('lowpass', hard ? 1400 : 2200, 0.8, g, t));
      },
      lane(d) {
        const t = claim('lane', 0.05, 0.2, true); if (t < 0) return;
        const dir = d && d.dir ? d.dir : 0, dest = sfxDest(0.3, dir * 0.45, 0);
        whoosh(t, 0.14, 0.9, 700, 2400, 1.3, dest);
      },
      stumble() {
        const t = claim('stumble', 0.2, 0.5); if (t < 0) return;
        const dest = sfxDest(0.36, 0, 0.1);
        const o = blip(t, 'square', 210, 100, 0.2, 0.5, filt('lowpass', 1600, 1, dest, t));
        o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(-300, t + 0.2);
        whoosh(t, 0.26, 0.6, 3200, 1500, 2.2, dest);
      },
      crash() {
        const t = claim('crash', 0.3, 1.2); if (t < 0) return;
        const dest = sfxDest(0.5, 0, 0.25);
        const g = envGain(t, 0.002, 0.9, 0.55, dest); noiseSrc(t, 0.7, filt('lowpass', 2400, 0.8, g, t, 180, 0.6));
        blip(t, 'sine', 95, 28, 0.55, 1.0, dest, 0.002);
        [523, 787, 1123, 1571].forEach((f, i) => { const gg = envGain(t, 0.001, 0.12 / (1 + i * 0.4), 0.7 + i * 0.1, dest); osc('square', f * (0.98 + Math.random() * 0.04), t, t + 1, filt('bandpass', f * 1.5, 3, gg, t)); });
      },
      pickup(d) {
        const kind = d && d.kind;
        if (kind === 'jetpack') return; // jetpack-start plays its own ignition
        const t = claim('pickup', 0.12, 0.8); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.3);
        if (kind === 'magnet') {
          const lp = filt('lowpass', 900, 5, dest, t, 4200, 0.35);
          arpeggio(t, [72, 76, 79, 84], 0.06, 0.16, 0.5, 'square', lp);
          blip(t + 0.24, 'sawtooth', MTOF[84], MTOF[91], 0.3, 0.25, lp);
        } else if (kind === 'sneakers') {
          blip(t, 'sine', 260, 900, 0.16, 0.7, dest); blip(t + 0.14, 'sine', 330, 1200, 0.16, 0.6, dest);
          arpeggio(t + 0.26, [88, 91, 96], 0.04, 0.14, 0.35, 'triangle', dest, true);
        } else if (kind === 'double') {
          arpeggio(t, [79, 84, 88, 91, 96], 0.045, 0.2, 0.4, 'square', filt('lowpass', 4000, 0.7, dest, t));
          arpeggio(t + 0.02, [67, 72, 76, 79, 84], 0.045, 0.2, 0.25, 'triangle', dest);
        } else if (kind === 'board') {
          arpeggio(t, [79, 83, 86, 91], 0.07, 0.3, 0.4, 'triangle', dest, true);
        } else arpeggio(t, [72, 76, 79, 84, 88], 0.05, 0.22, 0.4, 'triangle', dest, true);
        whoosh(t, 0.35, 0.3, 1200, 5200, 0.9, dest);
      },
      'power-end'(d) {
        if (d && d.kind === 'jetpack') return;
        const t = claim('power-end', 0.2, 0.5); if (t < 0) return;
        const dest = sfxDest(0.22, 0, 0.2);
        blip(t, 'triangle', MTOF[79], MTOF[74], 0.14, 0.6, dest); blip(t + 0.13, 'triangle', MTOF[74], MTOF[67], 0.22, 0.6, dest);
      },
      'jetpack-start'() {
        const t = claim('jet-start', 0.3, 0.8); if (t < 0) return;
        const dest = sfxDest(0.4, 0, 0.15);
        const g = envGain(t, 0.05, 0.8, 0.6, dest); noiseSrc(t, 0.7, filt('lowpass', 300, 1.2, g, t, 3200, 0.45));
        blip(t, 'sawtooth', 60, 140, 0.5, 0.35, filt('lowpass', 900, 1, dest, t));
        arpeggio(t + 0.1, [67, 74, 79, 86], 0.05, 0.18, 0.28, 'square', filt('lowpass', 3000, 0.7, dest, t));
        E.loop('jet', true);
      },
      'jetpack-end'() {
        E.loop('jet', false);
        const t = claim('jet-end', 0.3, 0.6); if (t < 0) return;
        const dest = sfxDest(0.28, 0, 0.1);
        blip(t, 'triangle', 620, 180, 0.4, 0.6, dest); whoosh(t, 0.45, 0.4, 2600, 500, 1, dest);
      },
      'board-on'() {
        const t = claim('board-on', 0.3, 0.6); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.2);
        whoosh(t, 0.3, 0.6, 600, 3800, 1.2, dest);
        arpeggio(t + 0.05, [76, 83, 88], 0.05, 0.2, 0.35, 'triangle', dest, true);
        E.loop('board', true);
      },
      'board-break'() {
        E.loop('board', false);
        const t = claim('board-break', 0.3, 0.8); if (t < 0) return;
        const dest = sfxDest(0.38, 0, 0.25);
        const g = envGain(t, 0.001, 0.7, 0.3, dest); noiseSrc(t, 0.35, filt('highpass', 3000, 0.7, g, t));
        for (let i = 0; i < 7; i++) { const tt = t + Math.random() * 0.14; blip(tt, 'sine', 2200 + Math.random() * 4200, 0, 0.12 + Math.random() * 0.15, 0.25, dest, 0.001); }
        blip(t, 'sine', 140, 45, 0.25, 0.8, dest, 0.002);
      },
      'near-miss'() {
        const t = claim('near-miss', 0.15, 0.5); if (t < 0) return;
        const p = Math.random() < 0.5 ? -0.6 : 0.6, dest = sfxDest(0.45, p, 0.1);
        whoosh(t, 0.38, 0.9, 3400, 420, 1.6, dest);
        blip(t + 0.05, 'sine', MTOF[93], 0, 0.12, 0.18, dest);
      },
      stunt() {
        const t = claim('stunt', 0.08, 0.4, true); if (t < 0) return;
        const dest = sfxDest(0.2, 0, 0.25);
        arpeggio(t, [84, 91], 0.05, 0.16, 0.35, 'triangle', dest, true);
      },
      combo(d) {
        const t = claim('combo', 0.06, 0.3, true); if (t < 0) return;
        const n = Math.max(2, (d && d.n) || 2), PENTA = [0, 2, 4, 7, 9];
        const m = 76 + 12 * Math.floor((n - 2) / 5) + PENTA[(n - 2) % 5];
        const dest = sfxDest(0.18, 0, 0.2);
        blip(t, 'square', MTOF[Math.min(m, 108)], 0, 0.09, 0.4, filt('lowpass', 5000, 0.7, dest, t));
        blip(t, 'sine', MTOF[Math.min(m + 12, 115)], 0, 0.12, 0.25, dest);
      },
      'combo-end'(d) {
        if (!d || d.n < 5) return;
        const t = claim('combo-end', 0.3, 0.4); if (t < 0) return;
        const dest = sfxDest(0.14, 0, 0.1);
        blip(t, 'triangle', MTOF[79], MTOF[67], 0.25, 0.5, dest);
      },
      'mission-done'() {
        const t = claim('fanfare', 0.4, 1.4); if (t < 0) return;
        fanfare(t, [67, 72, 76, 79], [72, 76, 79, 84], 0.09, 0.28);
      },
      'level-up'() {
        const t = claim('fanfare', 0.2, 2); if (t < 0) return;
        fanfare(t, [60, 64, 67, 72, 76, 79], [72, 76, 79, 84, 88], 0.08, 0.4);
        const dest = sfxDest(0.18, 0, 0.4); arpeggio(t + 0.6, [96, 100, 103, 108], 0.05, 0.25, 0.3, 'sine', dest);
      },
      revive() {
        const t = claim('revive', 0.5, 1.4); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.45);
        whoosh(t, 0.9, 0.5, 400, 7000, 0.8, dest);
        arpeggio(t, [60, 67, 72, 76, 79, 84, 88, 91], 0.06, 0.4, 0.3, 'sine', dest, true);
      },
      countdown(d) {
        const t = claim('countdown', 0.2, 0.3); if (t < 0) return;
        const dest = sfxDest(0.24, 0, 0.05);
        blip(t, 'square', d && d.n === 1 ? 784 : 659, 0, 0.14, 0.5, filt('lowpass', 3000, 0.7, dest, t));
      },
      go() {
        const t = claim('go', 0.3, 0.5); if (t < 0) return;
        const dest = sfxDest(0.26, 0, 0.1);
        blip(t, 'square', 1319, 0, 0.3, 0.45, filt('lowpass', 4000, 0.7, dest, t)); blip(t, 'triangle', 659, 0, 0.3, 0.5, dest);
      },
      'new-best'() {
        const t = claim('new-best', 1, 1.5); if (t < 0) return;
        const dest = sfxDest(0.28, 0, 0.4);
        arpeggio(t, [72, 74, 76, 79, 81, 84, 88, 91, 93, 96], 0.045, 0.3, 0.3, 'triangle', dest, true);
        fanfare(t + 0.45, [], [72, 76, 79, 84], 0, 0.3);
      },
      world() { // riser into the tunnel exit reveal
        const t = claim('world', 1, 2); if (t < 0) return;
        const dest = sfxDest(0.26, 0, 0.4);
        const g = ctx.createGain(); g.connect(dest); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        noiseSrc(t, 1.7, filt('bandpass', 500, 2.5, g, t, 6000, 1.4));
        const o = blip(t, 'sawtooth', 110, 440, 1.4, 0.18, filt('lowpass', 1800, 1, dest, t), 0.8); void o;
      },
      'tunnel-enter'() {
        const t = claim('tunnel', 0.5, 1); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.5);
        whoosh(t, 0.8, 0.7, 1800, 220, 1.2, dest, 'lowpass');
      },
      'tunnel-exit'() {
        const t = claim('tunnel', 0.5, 1.5); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.5);
        whoosh(t, 0.7, 0.6, 300, 6000, 0.9, dest);
        const S = M.S, r = S.root + 24; // bright reveal chord in the new world's key
        const deg = [0, 2, 4, 7];
        for (let i = 0; i < deg.length; i++) { const g = ahdr(t + 0.05, 0.02, 0.16, 0.25, 0.9, dest); osc('triangle', MTOF[degMidi(S, r, deg[i])], t + 0.05, t + 1.4, g); osc('sine', MTOF[degMidi(S, r, deg[i])] * 2, t + 0.05, t + 1.4, g); }
        const gc = envGain(t + 0.05, 0.002, 0.25, 1.2, dest); noiseSrc(t + 0.05, 1.3, filt('highpass', 6000, 0.6, gc, t));
      },
      'run-start'() {
        const t = claim('run-start', 0.5, 1); if (t < 0) return;
        const dest = sfxDest(0.3, 0, 0.3);
        whoosh(t, 0.5, 0.6, 400, 5000, 0.9, dest);
        arpeggio(t, [67, 72, 79], 0.05, 0.2, 0.3, 'triangle', dest, true);
      },
      'ui:click'() {
        const t = claim('ui', 0.04, 0.1); if (t < 0) return;
        const dest = sfxDest(0.14, 0, 0);
        blip(t, 'sine', 1250, 900, 0.04, 0.8, dest, 0.001);
        const g = envGain(t, 0.001, 0.2, 0.015, dest); noiseSrc(t, 0.03, filt('highpass', 4000, 0.7, g, t));
      }
    };
    function fanfare(t, run, chord, gap, vol) {
      const dest = sfxDest(vol, 0, 0.35);
      for (let i = 0; i < run.length; i++) {
        const tt = t + i * gap, f = MTOF[run[i]];
        const g = envGain(tt, 0.01, 0.4, gap * 1.6, dest);
        const lp = filt('lowpass', 900, 2, g, tt, 3800, gap); osc('sawtooth', f, tt, tt + gap * 1.8, lp); osc('square', f * 1.003, tt, tt + gap * 1.8, lp);
      }
      const tc = t + run.length * gap;
      for (let i = 0; i < chord.length; i++) {
        const f = MTOF[chord[i]], g = ahdr(tc, 0.015, 0.22, 0.35, 0.6, dest);
        const lp = filt('lowpass', 1200, 1.2, g, tc, 4200, 0.2); osc('sawtooth', f, tc, tc + 1.1, lp, -6); osc('sawtooth', f, tc, tc + 1.1, lp, 6);
      }
    }
    E.sfx = (name, data) => { const f = SFX[name]; if (f && E.soundOn) f(data); };
    E.SFX_NAMES = Object.keys(SFX);

    // ---------------------------------------------------------------- loops (jetpack roar, board hum)
    const loops = {};
    E.loop = (name, on) => {
      const t = now();
      const L = loops[name];
      if (on) {
        if (L || !E.soundOn) return;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(name === 'jet' ? 0.14 : 0.06, t + 0.3); g.connect(sfxOut);
        const nodes = [];
        if (name === 'jet') {
          const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.value = 0.7;
          s.connect(bp); bp.connect(ng); ng.connect(g);
          const lfo = ctx.createOscillator(); lfo.frequency.value = 11; const lg = ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(ng.gain);
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 58; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; const og = ctx.createGain(); og.gain.value = 0.5;
          o.connect(lp); lp.connect(og); og.connect(g);
          s.start(t); lfo.start(t); o.start(t); nodes.push(s, lfo, o);
        } else {
          const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 110; const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 165;
          const lfo = ctx.createOscillator(); lfo.frequency.value = 4.5; const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune);
          const og = ctx.createGain(); og.gain.value = 0.5; o1.connect(g); o2.connect(og); og.connect(g);
          o1.start(t); o2.start(t); lfo.start(t); nodes.push(o1, o2, lfo);
        }
        loops[name] = { g, nodes, level: name === 'jet' ? 0.14 : 0.06 };
      } else if (L) {
        L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0.0001, t, 0.08);
        L.nodes.forEach((n) => { try { n.stop(t + 0.5); } catch (e) { /* already stopped */ } });
        delete loops[name];
      }
    };
    E.stopLoops = () => { Object.keys(loops).forEach((k) => E.loop(k, false)); };
    E.duckLoops = (duck) => { const t = now(); Object.keys(loops).forEach((k) => { const L = loops[k]; L.g.gain.setTargetAtTime(duck ? 0.0001 : L.level, t, 0.08); }); };
    return E;
  }

  // ------------------------------------------------------------------ module state (live context)
  let ctx = null, eng = null, timer = 0;
  let soundOn = true, musicOn = true, paused = false;
  let lastState = 'title', goPending = false, lastFrame = null;
  const LOOKAHEAD = 0.25;
  const LV = { run: 0.42, title: 0.34, over: 0.3, hurt: 0.28, wet: 0.28 }; // music bus levels (SFX sit ~6-10 dB above the music)
  function pump() { // scheduler tick (also runs from a timer so music survives slow frames)
    if (!eng || !ctx || ctx.state === 'closed') return;
    try { eng.schedule(ctx.currentTime + LOOKAHEAD); } catch (e) { /* never break the game loop */ }
  }
  function init() {
    if (ctx || !AC) return !!ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return false; } }
    eng = createEngine(ctx);
    eng.soundOn = soundOn; eng.musicOn = musicOn;
    eng.setSoundGain(soundOn);
    eng.setMusicShape(18000, 0.7, LV.run, LV.wet, 0.05);
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    timer = setInterval(pump, 50);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) { if (ctx.suspend) ctx.suspend().catch(() => {}); } else if (ctx.resume) ctx.resume().catch(() => {});
    });
    return true;
  }
  function setSound(on) {
    soundOn = !!on;
    if (!eng) return;
    eng.soundOn = soundOn; eng.setSoundGain(soundOn);
    if (!soundOn) eng.stopLoops();
  }
  function setMusic(on) {
    const was = musicOn;
    musicOn = !!on;
    if (!eng) return;
    eng.musicOn = musicOn;
    if (musicOn && !was) { eng.music.started = false; } // restart cleanly on the grid
    shapeMusic(lastFrame, true);
  }
  function setWorld(index) {
    const i = Math.max(0, index | 0) % ((RR.WORLDS && RR.WORLDS.length) || 5);
    if (!eng) { pendingWorldBeforeInit = i; return; }
    eng.setWorld(i, !eng.music.started); // before the first note: switch now; otherwise at the next bar line
  }
  let pendingWorldBeforeInit = -1;
  function pauseAll() { paused = true; if (eng) { eng.duckLoops(true); shapeMusic(lastFrame, true); } }
  function resumeAll() {
    paused = false;
    if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    if (eng) { eng.duckLoops(false); shapeMusic(lastFrame, true); }
  }
  function shapeMusic(frame, force) {
    if (!eng) return;
    const st = frame ? frame.state : lastState;
    let cut = 18000, q = 0.7, gain = LV.run, wet = LV.wet, tc = 0.35;
    if (frame && frame.inTunnel && st === 'run') { cut = 1000; q = 3.2; wet = 0.55; tc = 0.25; }
    if (st === 'dying' || st === 'revive') { cut = 520; q = 1.5; gain = LV.hurt; tc = 0.12; }
    if (st === 'title') { cut = 12000; gain = LV.title; }
    if (st === 'over') { cut = 6000; gain = LV.over; }
    if (paused) { cut = Math.min(cut, 900); q = 0.8; gain *= 0.4; tc = 0.15; }
    eng.setMusicShape(cut, q, gain, wet, tc);
    void force;
  }
  function update(frame) {
    if (!eng) return;
    lastFrame = frame;
    if (pendingWorldBeforeInit >= 0) { eng.setWorld(pendingWorldBeforeInit, true); pendingWorldBeforeInit = -1; }
    const st = frame ? frame.state : 'title';
    eng.music.speed = frame && frame.speed ? frame.speed : 0;
    const mode = st === 'title' ? 'title' : st === 'over' ? 'over' : 'run';
    if (mode !== eng.music.mode && eng.music.pendingMode !== mode) eng.setMode(mode, false);
    if (st !== lastState) {
      if (goPending && st === 'run' && lastState === 'paused') { eng.sfx('go'); goPending = false; }
      if (st === 'dying' || st === 'over' || st === 'title') { eng.stopLoops(); goPending = false; }
      lastState = st;
    }
    shapeMusic(frame, false);
    pump();
  }

  // ------------------------------------------------------------------ events
  const EVENTS = ['coin', 'jump', 'roll', 'land', 'lane', 'stumble', 'crash', 'pickup', 'power-end', 'jetpack-start', 'jetpack-end',
    'board-on', 'board-break', 'near-miss', 'stunt', 'combo', 'combo-end', 'mission-done', 'level-up', 'revive', 'countdown', 'new-best',
    'world', 'tunnel-enter', 'tunnel-exit', 'run-start', 'ui:click'];
  EVENTS.forEach((name) => RR.on(name, (d) => {
    if (!eng || !soundOn) return;
    if (name === 'countdown' && d && d.n === 1) goPending = true;
    try { eng.sfx(name, d); } catch (e) { /* a sound must never break gameplay */ }
  }));
  RR.on('power-end', (d) => { if (eng && d && d.kind === 'board') eng.loop('board', false); });
  RR.on('run-end', () => { if (eng) eng.stopLoops(); });
  // any UI gesture is a chance to unlock a suspended context (autoplay policies)
  RR.on('ui:click', () => { if (ctx && ctx.state === 'suspended' && !document.hidden && ctx.resume) ctx.resume().catch(() => {}); });

  // ------------------------------------------------------------------ offline rendering (tests)
  // spec: { music: worldIndex, mode: 'run'|'title'|'over', speed, seconds }  or  { sfx: name, data, seconds }
  function debugRender(spec) {
    if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
    const sec = spec.seconds || 4, rate = 44100;
    const octx = new OAC(2, Math.floor(rate * sec), rate);
    const e = createEngine(octx);
    e.soundOn = true; e.musicOn = spec.music !== undefined;
    e.setSoundGain(true);
    if (spec.music !== undefined) {
      e.setWorld(spec.music, true); e.setMode(spec.mode || 'run', true); e.music.speed = spec.speed || 22;
      e.setMusicShape(spec.tunnel ? 1000 : spec.mode === 'title' ? 12000 : 18000, spec.tunnel ? 3.2 : 0.7, spec.mode === 'title' ? LV.title : spec.mode === 'over' ? LV.over : LV.run, spec.tunnel ? 0.55 : LV.wet, 0.05);
      e.music.started = true; e.music.next = 0.05; e.music.step = spec.startBar ? spec.startBar * 16 : 0;
      for (let i = 0; i < 400 && e.music.next < sec - 0.05; i++) e.schedule(sec - 0.05); // each call schedules <= 64 steps
    } else {
      e.setMusicShape(18000, 0.7, 0, 0.28, 0.05);
      const at = spec.at || 0;
      if (at > 0 && octx.suspend) octx.suspend(at).then(() => { e.sfx(spec.sfx, spec.data); octx.resume(); });
      else e.sfx(spec.sfx, spec.data);
    }
    const from = Math.floor((spec.at || 0) * rate);
    return octx.startRendering().then((buf) => {
      let peak = 0, sum = 0, n = 0, clipped = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = from; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++; sum += d[i] * d[i]; n++; }
      }
      const rms = Math.sqrt(sum / Math.max(1, n));
      const db = (x) => (x > 0 ? Math.round(200 * Math.log10(x)) / 10 : -120);
      const res = { peak: +peak.toFixed(4), rms: +rms.toFixed(4), peakDb: db(peak), rmsDb: db(rms), clipped, seconds: sec };
      if (spec.raw) res.data = buf.getChannelData(0);
      return res;
    });
  }

  const api = {
    init, setSound, setMusic, update, setWorld, pauseAll, resumeAll,
    get ctx() { return ctx; },
    get ready() { return !!eng; },
    get music() { return eng ? eng.music : null; },
    sfx: (name, data) => { if (eng && soundOn) eng.sfx(name, data); },
    debugRender,
    get SFX_NAMES() { return eng ? eng.SFX_NAMES : EVENTS.concat(['go']); },
    SONGS
  };
  RR.register('audio', api);
})(window.RR);
