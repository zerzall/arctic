// Signal analysis and WAV encoding for the audio rig (developer tooling, not part of the game).
//
// Plain ES module with no Node or DOM APIs, so render.mjs (Node) and harness.js (the page, for spectrogram sheets) share one FFT.

/** In-place radix-2 FFT; `re` and `im` are Float64Arrays whose length is a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const HANN = new Map();
function hann(n) {
  if (!HANN.has(n)) HANN.set(n, Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  return HANN.get(n);
}

/** Magnitude spectrum (power) of one Hann-windowed frame starting at `at`. Returns size/2 bins. */
export function frameSpectrum(x, at, size) {
  const re = new Float64Array(size), im = new Float64Array(size), w = hann(size);
  for (let i = 0; i < size; i++) re[i] = (x[at + i] ?? 0) * w[i];
  fft(re, im);
  const p = new Float64Array(size / 2);
  for (let k = 0; k < p.length; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/**
 * Levels, length and colour of a mono signal.
 *  active     the span between the first and last 10 ms windows above -60 dB of the peak (what the ear takes as "the sound")
 *  rmsDb      RMS over the active span            maxRmsDb  loudest 50 ms window (closer to how loud it feels than the peak)
 *  centroid   spectral centroid over the active span, Hz      hiShare  share of the energy above 6 kHz (shrillness)
 *  startAbs / endAbs  the first and last millisecond of the render (a click at a cut shows up as a non-zero end)
 */
export function analyse(x, sr) {
  let peak = 0, nan = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (!Number.isFinite(a)) { nan++; continue; }
    if (a > peak) peak = a;
    sum += x[i];
  }
  const win = Math.max(1, Math.round(sr * 0.01)), gate = peak * 1e-3;
  let first = -1, last = -1;
  for (let i = 0; i + win <= x.length; i += win) {
    let e = 0;
    for (let j = 0; j < win; j++) e += x[i + j] * x[i + j];
    if (Math.sqrt(e / win) > gate) { if (first < 0) first = i; last = i + win; }
  }
  const a0 = Math.max(first, 0), a1 = Math.max(last, a0);
  let sq = 0;
  for (let i = a0; i < a1; i++) sq += x[i] * x[i];
  const rms = a1 > a0 ? Math.sqrt(sq / (a1 - a0)) : 0;

  const w50 = Math.round(sr * 0.05);
  let maxRms = 0;
  for (let i = 0; i + w50 <= x.length; i += w50 >> 1) {
    let e = 0;
    for (let j = 0; j < w50; j++) e += x[i + j] * x[i + j];
    maxRms = Math.max(maxRms, Math.sqrt(e / w50));
  }

  const size = 2048, energy = new Float64Array(size / 2);
  for (let at = a0; at + size <= Math.max(a1, a0 + size); at += size / 2) {
    const p = frameSpectrum(x, at, size);
    for (let k = 0; k < energy.length; k++) energy[k] += p[k];
  }
  let total = 0, weighted = 0, high = 0;
  for (let k = 1; k < energy.length; k++) {
    const f = (k * sr) / size;
    total += energy[k];
    weighted += energy[k] * f;
    if (f >= 6000) high += energy[k];
  }
  const ms = Math.max(1, Math.round(sr * 0.001));
  let startAbs = 0, endAbs = 0;
  for (let i = 0; i < ms; i++) { startAbs = Math.max(startAbs, Math.abs(x[i])); endAbs = Math.max(endAbs, Math.abs(x[x.length - 1 - i])); }

  return {
    peak, peakDb: db(peak), rmsDb: db(rms), maxRmsDb: db(maxRms), active: (a1 - a0) / sr, start: a0 / sr,
    centroid: total > 0 ? weighted / total : 0, hiShare: total > 0 ? high / total : 0,
    nan, dc: x.length ? sum / x.length : 0, startAbs, endAbs,
  };
}

/**
 * Loop-seam check for a rendered music track that started at `start` and ran past its first loop. Measures the RMS of the 100 ms around
 * every bar line and returns how far the loop seam (bar line number `bars`) is from the median of the other bar lines, in dB: a gap or
 * a double-hit at the seam shows up as a large number, a seamless loop as roughly 0.
 */
export function seamDb(x, sr, { start, barDur, bars }) {
  const rmsAt = (t) => {
    const a = Math.max(0, Math.round((t - 0.05) * sr)), b = Math.min(x.length, Math.round((t + 0.05) * sr));
    let e = 0;
    for (let i = a; i < b; i++) e += x[i] * x[i];
    return Math.sqrt(e / Math.max(1, b - a));
  };
  const others = [];
  for (let k = 1; start + (k + 0.5) * barDur < x.length / sr; k++) if (k !== bars) others.push(rmsAt(start + k * barDur));
  others.sort((p, q) => p - q);
  return db(rmsAt(start + bars * barDur)) - db(others[others.length >> 1]);
}

/** Short-time log spectrogram: rows are frames, columns are bins up to `maxHz`, values are dB relative to the loudest cell. */
export function spectrogram(x, sr, { size = 1024, hop = 512, maxHz = 12000 } = {}) {
  const bins = Math.min(size / 2, Math.floor((maxHz * size) / sr)), rows = [];
  let top = 1e-12;
  for (let at = 0; at + size <= x.length; at += hop) {
    const p = frameSpectrum(x, at, size).subarray(0, bins);
    for (const v of p) if (v > top) top = v;
    rows.push(p);
  }
  return rows.map((p) => Float32Array.from(p, (v) => 10 * Math.log10(Math.max(v, 1e-12) / top)));
}

/** 16-bit PCM WAV of interleaved `channels` (Float32Arrays of equal length). */
export function encodeWav(channels, sr) {
  const n = channels[0].length, c = channels.length, bytes = new Uint8Array(44 + n * c * 2), dv = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); dv.setUint32(4, 36 + n * c * 2, true); text(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, c, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * c * 2, true); dv.setUint16(32, c * 2, true); dv.setUint16(34, 16, true);
  text(36, 'data'); dv.setUint32(40, n * c * 2, true);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < c; ch++) dv.setInt16(44 + (i * c + ch) * 2, Math.round(Math.max(-1, Math.min(1, channels[ch][i])) * 32767), true);
  }
  return bytes;
}
