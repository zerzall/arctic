// Adaptive score: an original Nordic-fantasy orchestral soundtrack (low male choir,
// strings, horns, harp, flute, war drums and timpani) in D minor / D Dorian, played by a
// small sequencer from the baked instrument samples of instruments.js.
//
// The music moves between states that follow the game (audio.js calls set() and cue()):
//   menu      title / lobby: calm material opened by a sparse intro, plus the main theme
//   calm      prep & intermission (70 bpm, 3/4): harp, strings, "ooh" choir, flute or horn
//   tension   the last seconds before a wave (112 bpm): pulsing strings, timpani, swells
//   battle    a wave (112 bpm, 4/4): string ostinatos and war drums; horns, choir and a
//             chant join as the horde grows (the smoothed intensity gates the layers)
//   boss      a boss wave (6/8, dotted quarter 76): galloping drums, full choir and horns
//   waveclear a short triumphant cue (VI–VII–I in D major), then calm
//   victory   a longer fanfare cue, then `glory` (a calm loop in D major / Mixolydian)
//   gameover  a sombre cue, then `lament` (slow, consonant, not creepy)
//   hideout   the story hideouts (SPEC §3.9; 60 bpm, 3/4): a warm porch waltz of flute, harp
//             and soft strings that never builds
// Each looping state has several phrases (60–120 s of material) played in a seeded random
// order; changes wait for the next beat (urgent ones) or bar and crossfade the outgoing
// phrase's notes. Notes are scheduled a little ahead on the audio clock, so timing
// stays tight regardless of frame rate.

import { clamp } from '../shared/math.js';
import { createRng } from '../shared/rng.js';
import { MUSIC_ROOTS, MUSIC_RR, SWELL_PEAK } from './instruments.js';

const LOOKAHEAD = 0.3;        // seconds scheduled ahead of the audio clock
const MAX_ACTIVE = 96;        // ceiling on simultaneously sounding music notes
const HALL_SECONDS = 3.4;     // the score's own long hall reverb

// ---- instruments -------------------------------------------------------------------------
// id: baked sound; sec: mixer section; g: gain at velocity 1; a/r: attack/release (s) of
// sustained (looping) instruments; one: one-shot; fb: stand-in while `id` is still baking.
export const INSTRUMENTS = {
  choir: { id: 'mu_choir_a', sec: 'choir', a: 0.3, r: 0.7, g: 0.3, fb: 'ooh' },
  ooh: { id: 'mu_choir_o', sec: 'choir', a: 0.6, r: 1.1, g: 0.32 },
  str: { id: 'mu_str', sec: 'strings', a: 0.55, r: 0.9, g: 0.22 },
  vln: { id: 'mu_str', sec: 'violins', a: 0.4, r: 0.7, g: 0.17 },
  horn: { id: 'mu_horn', sec: 'horns', a: 0.12, r: 0.45, g: 0.3, swell: true, fb: 'str' },
  flute: { id: 'mu_flute', sec: 'lead', a: 0.07, r: 0.3, g: 0.2, fb: 'vln' },
  spicc: { id: 'mu_spicc', sec: 'celli', one: true, g: 0.3 },
  vspicc: { id: 'mu_spicc', sec: 'violins', one: true, g: 0.15 },
  harp: { id: 'mu_harp', sec: 'harp', one: true, g: 0.26 },
  timp: { id: 'mu_timp', sec: 'drums', one: true, g: 0.42 },
  troll: { id: 'mu_troll', sec: 'drums', one: true, g: 0.36, peak: SWELL_PEAK.mu_troll },
  taiko: { id: 'mu_taiko', sec: 'drums', one: true, g: 0.42 },
  drum: { id: 'mu_drum', sec: 'drums', one: true, g: 0.22 },
  boom: { id: 'mu_boom', sec: 'drums', one: true, g: 0.36 },
  cym: { id: 'mu_cym', sec: 'cymbal', one: true, g: 0.1, peak: SWELL_PEAK.mu_cym },
  crash: { id: 'mu_crash', sec: 'cymbal', one: true, g: 0.075 },
};

// Mixer sections: [pan, hall send].
const SECTIONS = {
  choir: [0, 0.62], strings: [0.15, 0.42], violins: [-0.3, 0.45], celli: [0.2, 0.24], horns: [0.3, 0.5],
  lead: [-0.1, 0.45], harp: [-0.4, 0.45], drums: [0, 0.5], cymbal: [0.1, 0.5],
};

// ---- harmony -------------------------------------------------------------------------------

// Chords as pitch classes, root first (D minor / Dorian world, plus the major colours of
// the victory music).
const CHORDS = {
  Dm: [2, 5, 9], D: [2, 6, 9], D5: [2, 9], Dsus4: [2, 7, 9],
  Bb: [10, 2, 5], Bb5: [10, 5], C: [0, 4, 7], C5: [0, 7], Csus4: [0, 5, 7],
  F: [5, 9, 0], Gm: [7, 10, 2], G: [7, 11, 2], A: [9, 1, 4], Asus4: [9, 2, 4], Bm: [11, 2, 6],
};
export { CHORDS as MUSIC_CHORDS };

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'F#4' → 66, 'Bb3' → 58. */
export function noteMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** Lowest MIDI note ≥ lo with pitch class pc. */
const above = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12);

// Voicings: [chord-tone index, extra octaves], each tone the next one above the previous.
const OPEN = [[0, 0], [2, 0], [1, 0]];
const POWER = [[0, 0], [2, 0], [0, 0]];
const FIFTH = [[0, 0], [2, 0]];

function voicing(ch, lo, shape) {
  const pcs = CHORDS[ch];
  const out = [];
  let prev = lo - 1;
  for (let k = 0; k < shape.length; k++) {
    const [idx, oct] = shape[k];
    const pc = pcs[idx % pcs.length];
    const m = k === 0 ? above(pc, lo) : above(pc, prev + 1);
    out.push(m + 12 * oct);
    prev = m + 12 * oct;
  }
  return out;
}

/** Chord tones ascending from `lo` across `span` semitones (arpeggios). */
function ladder(ch, lo, span = 26) {
  const pcs = CHORDS[ch];
  const out = [];
  for (let m = lo; m < lo + span; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

// ---- phrase builder ------------------------------------------------------------------------

/**
 * Builder handed to each phrase recipe. Ticks are 16th notes (6/8: 12 per bar, beats of
 * 6). Events: { t: tick, i: instrument, m: midi|null, d: duration ticks, v: velocity,
 * L: layer, to?: tick a swell peaks on }.
 */
class Phrase {
  constructor(state, chords, rng) {
    this.st = state;
    this.bt = state.bar;
    this.chords = chords;
    this.bars = chords.length;
    this.len = this.bars * this.bt;
    this.rng = rng;
    this.ev = [];
    // Chord segments: 'Bb C' splits a bar evenly; repeats merge into one segment.
    this.segs = [];
    chords.forEach((c, bar) => {
      const parts = c.split(' ');
      const w = this.bt / parts.length;
      parts.forEach((name, k) => {
        if (!CHORDS[name]) throw new Error(`unknown chord ${name}`);
        const t = bar * this.bt + k * w;
        const last = this.segs[this.segs.length - 1];
        if (last && last.ch === name && last.t + last.d === t) last.d += w;
        else this.segs.push({ t, d: w, ch: name, bar });
      });
    });
  }

  chordAt(t) {
    for (const s of this.segs) if (t >= s.t && t < s.t + s.d) return s.ch;
    return this.segs[this.segs.length - 1].ch;
  }

  note(t, i, m, d, v, L = 'base', to) {
    const e = { t, i, m, d, v, L };
    if (to !== undefined) e.to = to;
    this.ev.push(e);
    return this;
  }

  /** Sustained chords: `voice(chord)` → notes, over the segments of bars [from, to). */
  pad(i, voice, v, L = 'base', from = 0, to = this.bars) {
    for (const s of this.segs) {
      if (s.bar < from || s.bar >= to) continue;
      for (const m of voice(s.ch)) this.note(s.t, i, m, s.d, v, L);
    }
    return this;
  }

  /** Melody: 'A4:8 D5:4 | …' (duration in ticks, 'r' rests, '|' checks the bar length). */
  mel(i, text, v, L = 'base', { bar = 0, shift = 0 } = {}) {
    let t = bar * this.bt;
    for (const chunk of text.split('|')) {
      const start = t;
      for (const tok of chunk.trim().split(/\s+/)) {
        if (!tok) continue;
        const [n, d] = tok.split(':');
        const dur = Number(d);
        if (!(dur > 0)) throw new Error(`bad duration in ${tok}`);
        if (n !== 'r') this.note(t, i, noteMidi(n) + shift, dur, v, L);
        t += dur;
      }
      if (t - start !== this.bt) throw new Error(`bar of ${t - start} ticks in "${chunk.trim()}" (${this.bt} expected)`);
    }
    return this;
  }

  /** Low-string ostinato: '>0 . 0 0 …' per bar (intervals over the chord root, '>' accent). */
  ost(pat, v, L = 'base', { lo = 38, i = 'spicc', from = 0, to = this.bars, ramp = 0 } = {}) {
    const toks = pat.trim().split(/\s+/);
    const step = this.bt / toks.length;
    for (let bar = from; bar < to; bar++) {
      toks.forEach((tok, k) => {
        if (tok === '.') return;
        const acc = tok[0] === '>';
        const iv = Number(acc ? tok.slice(1) : tok);
        const t = bar * this.bt + k * step;
        const root = above(CHORDS[this.chordAt(t)][0], lo);
        const r = ramp ? 1 - ramp + ramp * ((t - from * this.bt) / ((to - from) * this.bt)) : 1;
        this.note(t, i, root + iv, step, v * r * (acc ? 1 : 0.72), L);
      });
    }
    return this;
  }

  /** Arpeggio over chord tones from `lo`: idx pattern per bar ('.' rests). */
  arp(i, idx, lo, v, L = 'base', { from = 0, to = this.bars, span = 26 } = {}) {
    const step = this.bt / idx.length;
    for (let bar = from; bar < to; bar++) {
      idx.forEach((k, j) => {
        if (k === null) return;
        const t = bar * this.bt + j * step;
        const tones = ladder(this.chordAt(t), lo, span);
        this.note(t, i, tones[Math.min(k, tones.length - 1)], step * 2, v * (j === 0 ? 1 : 0.8), L);
      });
    }
    return this;
  }

  /** Drum pattern per bar: 'X' accent, 'x' normal, 'o' soft, '.' rest. */
  drums(i, pat, v, L = 'base', { from = 0, to = this.bars, every = 1, offset = 0 } = {}) {
    const cells = pat.replace(/\s+/g, '');
    const step = this.bt / cells.length;
    for (let bar = from; bar < to; bar++) {
      if ((bar - offset) % every !== 0) continue;
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k];
        if (c === '.') continue;
        this.note(bar * this.bt + k * step, i, null, 1, v * (c === 'X' ? 1 : c === 'x' ? 0.7 : 0.45), L);
      }
    }
    return this;
  }

  /** Rhythmic chords: `voice(chord)` struck on the pattern's cells, held until the next one. */
  hits(i, pat, voice, v, L = 'base', { from = 0, to = this.bars } = {}) {
    const cells = pat.replace(/\s+/g, '');
    const step = this.bt / cells.length;
    const on = [];
    for (let k = 0; k < cells.length; k++) if (cells[k] !== '.') on.push(k);
    for (let bar = from; bar < to; bar++) {
      on.forEach((k, j) => {
        const t = bar * this.bt + k * step;
        const d = Math.max(1, ((j + 1 < on.length ? on[j + 1] : cells.length) - k) * step - 1);
        const c = cells[k];
        for (const m of voice(this.chordAt(t))) this.note(t, i, m, d, v * (c === 'X' ? 1 : c === 'x' ? 0.7 : 0.45), L);
      });
    }
    return this;
  }

  /** Timpani on the root of every chord change (bars [from, to)). */
  timp(v, L = 'base', from = 0, to = this.bars) {
    for (const s of this.segs) if (s.bar >= from && s.bar < to) this.note(s.t, 'timp', above(CHORDS[s.ch][0], 33), 1, v, L);
    return this;
  }

  /** Cymbal swell or timpani roll that peaks exactly on tick `to`. */
  swell(i, to, v, L = 'base') {
    const secs = INSTRUMENTS[i].peak;
    const t = Math.max(0, to - Math.round(secs / this.st.tick));
    return this.note(t, i, null, 1, v, L, to);
  }
}

// Melodic lines are written out; accompaniment comes from the chords.
const lowPad = (ch) => [above(CHORDS[ch][0], 38), ...ladder(ch, 50).slice(0, 3)];
const midPad = (ch) => ladder(ch, 55).slice(0, 3);
const highPad = (ch) => ladder(ch, 67).slice(0, 3);
const choirOpen = (ch) => voicing(ch, 43, OPEN);
const choirFifth = (ch) => voicing(ch, 45, FIFTH);
const hornPower = (ch) => voicing(ch, 41, POWER);
const hornClose = (ch) => ladder(ch, 55).slice(0, 3);

// Ostinatos (16 ticks) and their 6/8 cousins (12 ticks).
const GALLOP = '>0 . 0 0 >0 . 0 0 >0 . 0 0 >12 . 12 7';
const DRIVE = '>0 0 12 0 >0 0 12 0 >0 0 12 0 >0 12 7 12';
const EIGHTS = '>0 . 12 . 0 . 12 . >0 . 12 . 0 . 7 .';
const BOSS_RUN = '>0 0 12 0 0 12 >0 0 12 0 7 12';
const BOSS_GALLOP = '>0 . 0 12 . 0 >0 . 0 12 . 7';

/** War drums for a battle phrase (layers d1–d3 follow the intensity). */
function battleDrums(p, alt) {
  const end = p.len;
  p.drums('taiko', 'X . . . . . . . x . . . . . . .', 0.9, 'd1');
  p.drums('taiko', alt ? '. . . . . . . . . . x o . . . .' : '. . . . . . x . . . . . . . x .', 0.75, 'd2');
  p.drums('drum', '. . . . . . . . . . . . o o x X', 0.6, 'd2', { every: 2, offset: 1 });
  p.drums('drum', '. . o . . . o . . . o . . . o .', 0.5, 'd3');
  p.drums('taiko', '. . . o . . . . . . . o . . . .', 0.6, 'd3');
  p.note(0, 'boom', null, 1, 0.8, 'd1').note(4 * p.bt, 'boom', null, 1, 0.6, 'd1');
  p.note(0, 'crash', null, 1, 0.8, 'd2');
  p.timp(0.55, 'd2');
  p.swell('troll', end, 0.6, 'd3').swell('cym', end, 0.6, 'd2');
}

/** Galloping 6/8 drums for the boss. */
function bossDrums(p) {
  const end = p.len;
  p.drums('taiko', 'X . . x . x X . . x . x', 0.95, 'base');
  p.drums('boom', 'X . . . . . . . . . . .', 0.75, 'base', { every: 2 });
  p.drums('drum', '. . . . . . . . o x x X', 0.6, 'base', { every: 2, offset: 1 });
  p.drums('drum', '. . o . . o . . o . . o', 0.45, 'd3');
  p.note(0, 'crash', null, 1, 0.9);
  p.timp(0.7);
  p.swell('troll', end, 0.65).swell('cym', end, 0.6);
}

/** Violin spiccato eighths on chord tones (bars [from, to)). */
function violinRun(p, v, L, from, to) {
  p.arp('vspicc', [2, 1, 0, 1, 2, 3, 2, 1], 67, v, L, { from, to });
}

// ---- the score -------------------------------------------------------------------------------

const PHRASES = {
  // Calm (3/4): strings, harp, "ooh" choir; a flute or horn sings.
  CA: { chords: ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'], build(p) {
    p.pad('str', lowPad, 0.7).pad('ooh', choirOpen, 0.5, 'base', 4);
    p.arp('harp', [0, 1, 2, 3, 4, 3], 50, 0.45);
    const tune = 'D5:4 E5:4 F5:4 | A5:8 G5:4 | F5:6 E5:2 D5:4 | F5:12 | C5:4 F5:4 G5:4 | A5:8 C6:4 | G5:6 F5:2 E5:4 | E5:12';
    if (p.rng.next() < 0.6) p.mel('flute', tune, 0.75);
    else p.mel('horn', tune, 0.6, 'base', { shift: -12 });
    p.note(0, 'timp', 38, 1, 0.3);
  } },
  CB: { chords: ['Dm', 'C', 'Bb', 'F', 'Gm', 'Bb', 'Csus4', 'C'], build(p) {
    p.pad('str', lowPad, 0.6).pad('ooh', choirOpen, 0.6);
    p.arp('harp', [0, 2, 4, 5, 4, 2], 50, 0.4);
    p.mel('horn', 'A3:12 | G3:12 | F3:12 | A3:8 C4:4 | D4:12 | F4:8 D4:4 | F4:12 | E4:12', 0.55);
  } },
  CC: { chords: ['Dm', 'G', 'Dm', 'G', 'Bb', 'F', 'C', 'Dm'], build(p) {
    p.pad('str', lowPad, 0.65).pad('ooh', choirOpen, 0.45, 'base', 4);
    p.arp('harp', [0, 1, 2, 3, 2, 1], 50, 0.42);
    p.mel('flute', 'F5:4 E5:4 D5:4 | B4:4 D5:8 | A4:4 D5:4 F5:4 | G5:8 D5:4 | F5:6 G5:2 F5:4 | A5:4 G5:4 F5:4 | E5:8 G5:4 | D5:12', 0.72);
  } },
  CD: { chords: ['F', 'C', 'Dm', 'Bb', 'Gm', 'Dm', 'Bb', 'C'], build(p) {
    p.pad('str', lowPad, 0.6).pad('vln', highPad, 0.35).pad('ooh', choirOpen, 0.5);
    p.pad('horn', (ch) => voicing(ch, 45, FIFTH), 0.35);
    p.mel('choir', 'A3:12 | G3:12 | A3:12 | Bb3:12 | Bb3:8 A3:4 | A3:12 | F3:6 G3:6 | G3:12', 0.45);
    p.arp('harp', [0, 2, 4, null, null, null], 50, 0.4);
    p.drums('taiko', 'o . . . . .', 0.45, 'base', { every: 4 });
    p.note(0, 'timp', 41, 1, 0.35);
  } },
  CE: { chords: ['Dm', 'Bb', 'F', 'Csus4'], build(p) {
    p.pad('str', lowPad, 0.55).pad('ooh', choirOpen, 0.42);
    p.arp('harp', [0, 1, 2, 3, 4, 5], 50, 0.4);
  } },
  // The main theme: horns with the choir an octave below.
  CT: { chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Csus4', 'C'], build(p) {
    const theme = 'D4:4 A4:6 G4:2 | G4:4 F4:4 D4:4 | F4:8 A4:4 | G4:12 | A4:4 D5:6 C5:2 | Bb4:4 A4:4 G4:4 | G4:12 | E4:12';
    p.mel('horn', theme, 0.8).mel('choir', theme, 0.5, 'base', { shift: -12 });
    p.pad('str', lowPad, 0.6).pad('vln', highPad, 0.3);
    p.arp('harp', [0, 1, 2, 3, 2, 1], 50, 0.32);
    p.note(0, 'timp', 38, 1, 0.5).note(4 * p.bt, 'timp', 38, 1, 0.45);
    p.drums('taiko', 'x . . . . .', 0.5, 'base', { every: 4 });
    p.swell('cym', p.len, 0.4);
  } },

  // Tension (4/4, 112): the wave is coming.
  TA: { chords: ['D5', 'D5', 'Bb5', 'C5'], build(p) {
    p.ost(EIGHTS, 0.7, 'base', { ramp: 0.4 });
    p.hits('timp', 'x . . . o . . . x . . . o . . .', (ch) => [above(CHORDS[ch][0], 33)], 0.55);
    p.pad('choir', choirFifth, 0.5).pad('str', (ch) => [above(CHORDS[ch][0], 38), above(CHORDS[ch][0], 50)], 0.45);
    p.drums('taiko', 'X . . . . . . . . . . . . . . .', 0.6);
    p.swell('cym', p.len, 0.5);
  } },
  TB: { chords: ['Dm', 'C', 'Bb', 'A'], build(p) {
    p.ost(EIGHTS, 0.65, 'base', { to: 2 }).ost(DRIVE, 0.7, 'base', { from: 2 });
    p.pad('vln', highPad, 0.35).pad('ooh', choirOpen, 0.45);
    p.pad('horn', hornPower, 0.45, 'base', 2);
    p.drums('taiko', 'X . . . . . . . x . . . . . . .', 0.6);
    p.timp(0.5);
    p.swell('troll', p.len, 0.6);
  } },
  // One bar that lifts calm into battle.
  RISE: { chords: ['D5'], build(p) {
    p.ost('0 0 0 0 0 0 0 0 0 0 0 0 12 12 12 12', 0.8, 'base', { ramp: 0.7 });
    p.pad('choir', choirFifth, 0.5);
    p.swell('troll', p.len, 0.7).swell('cym', p.len, 0.55);
  } },

  // Battle (4/4, 112).
  B1: { chords: ['Dm', 'Dm', 'Bb', 'Bb', 'F', 'F', 'C', 'C'], build(p) {
    p.ost(GALLOP, 0.75);
    p.pad('str', midPad, 0.4).pad('vln', highPad, 0.35, 'hi');
    p.pad('horn', hornPower, 0.6, 'horn').pad('ooh', choirOpen, 0.5, 'choir');
    p.mel('choir', 'A3:12 G3:4 | F3:8 D3:8 | F3:12 G3:4 | D3:16 | A3:8 C4:8 | A3:8 F3:8 | G3:12 E3:4 | G3:16', 0.7, 'chant');
    battleDrums(p, false);
  } },
  B2: { chords: ['Dm', 'C', 'Bb', 'C', 'Dm', 'C', 'Bb', 'A'], build(p) {
    p.ost(DRIVE, 0.7);
    p.pad('str', midPad, 0.4).pad('ooh', choirOpen, 0.5, 'choir');
    p.hits('horn', 'X . . . . . x . . . . . X . . .', hornPower, 0.7, 'horn');
    violinRun(p, 0.55, 'hi', 0, p.bars);
    battleDrums(p, true);
  } },
  B3: { chords: ['Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'F', 'A'], build(p) {
    p.ost(GALLOP, 0.75);
    p.pad('str', midPad, 0.4).pad('vln', highPad, 0.35, 'hi');
    p.pad('horn', hornPower, 0.55, 'horn').pad('ooh', choirOpen, 0.5, 'choir');
    p.mel('choir', 'D4:8 C4:4 Bb3:4 | C4:8 G3:8 | A3:16 | F3:4 G3:4 A3:8 | Bb3:8 A3:4 G3:4 | G3:8 E3:8 | F3:8 A3:8 | A3:16', 0.7, 'chant');
    battleDrums(p, false);
  } },
  B4: { chords: ['Dm', 'G', 'Dm', 'G', 'Bb', 'C', 'Dm', 'Dm'], build(p) {
    const tune = 'A3:6 D4:2 D4:8 | B3:6 D4:2 G4:8 | F4:4 E4:4 D4:4 A3:4 | D4:16 | F4:6 G4:2 F4:4 D4:4 | E4:6 F4:2 G4:8 | A4:12 G4:4 | F4:4 E4:4 D4:8';
    p.ost(EIGHTS, 0.75);
    p.mel('horn', tune, 0.8, 'horn').mel('choir', tune, 0.5, 'choir', { shift: -12 });
    p.pad('str', midPad, 0.45).pad('vln', highPad, 0.35, 'hi');
    battleDrums(p, true);
  } },
  B5: { chords: ['Gm', 'Dm', 'Bb', 'F', 'Gm', 'Dm', 'Bb', 'C'], build(p) {
    p.ost(DRIVE, 0.7);
    p.pad('str', midPad, 0.4).pad('choir', choirOpen, 0.55, 'choir').pad('ooh', (ch) => [above(CHORDS[ch][0], 38)], 0.4, 'choir');
    p.hits('horn', 'X . . . . . x . . . . . X . . .', hornPower, 0.65, 'horn');
    violinRun(p, 0.5, 'hi', 4, p.bars);
    battleDrums(p, false);
  } },

  // Boss (6/8).
  KRISE: { chords: ['D5', 'D5'], build(p) {
    p.ost('0 0 0 0 0 0 0 0 0 12 12 12', 0.85, 'base', { ramp: 0.6 });
    p.pad('choir', choirFifth, 0.7).note(0, 'boom', null, 1, 0.8);
    p.swell('troll', p.len, 0.75).swell('cym', p.len, 0.6);
  } },
  K1: { chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'], build(p) {
    p.ost(BOSS_RUN, 0.8);
    p.pad('ooh', choirOpen, 0.45).pad('vln', highPad, 0.4);
    p.hits('horn', 'X . . . . . x . . . . .', hornPower, 0.6);
    p.mel('choir', 'D3:12 | F3:6 E3:6 | D3:12 | E3:6 G3:6 | A3:12 | G3:6 F3:6 | G3:6 Bb3:6 | A3:12', 0.85);
    bossDrums(p);
  } },
  K2: { chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'C', 'A'], build(p) {
    p.ost(BOSS_GALLOP, 0.8);
    p.pad('choir', choirOpen, 0.65).pad('str', midPad, 0.4);
    p.mel('horn', 'D4:4 D4:2 A4:6 | F4:6 D4:6 | G4:4 F4:2 D4:6 | E4:12 | D4:4 D4:2 A4:6 | Bb4:6 A4:6 | G4:6 E4:6 | A4:12', 0.85);
    bossDrums(p);
  } },
  K3: { chords: ['Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'], build(p) {
    p.ost(BOSS_RUN, 0.8);
    p.pad('ooh', choirOpen, 0.45).pad('vln', highPad, 0.4);
    p.mel('choir', 'F3:12 | G3:12 | A3:6 F3:6 | D3:12 | F3:6 G3:6 | E3:6 G3:6 | A3:12 | E3:12', 0.85);
    p.hits('horn', 'X . . . . . x . . . . .', hornPower, 0.6);
    bossDrums(p);
  } },
  K4: { chords: ['Gm', 'Gm', 'Dm', 'Dm', 'Bb', 'C', 'Dm', 'A'], build(p) {
    p.ost(BOSS_GALLOP, 0.8);
    p.pad('choir', choirOpen, 0.7).pad('ooh', (ch) => [above(CHORDS[ch][0], 38)], 0.45);
    p.arp('vspicc', [2, 1, 0, 1, 2, 3], 67, 0.55);
    p.hits('horn', 'X . . . . . x . . . . .', hornPower, 0.65);
    bossDrums(p);
  } },
  K5: { chords: ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Bb', 'A'], build(p) {
    p.ost(BOSS_RUN, 0.8);
    p.pad('ooh', choirOpen, 0.5).pad('str', midPad, 0.4);
    p.mel('choir', 'A3:12 | G3:12 | F3:12 | E3:12 | A3:6 D4:6 | C4:6 G3:6 | F3:6 D3:6 | E3:12', 0.85);
    p.hits('horn', 'X . . x . . . . . . . .', hornPower, 0.7);
    bossDrums(p);
  } },

  // Wave cleared: VI–VII–I into D major.
  WC: { chords: ['D', 'Bb C', 'D'], build(p) {
    p.pad('horn', hornClose, 0.7).mel('horn', 'A4:16 | Bb4:8 C5:8 | D5:16', 0.75);
    p.pad('choir', choirOpen, 0.65).pad('str', lowPad, 0.55).pad('vln', highPad, 0.45);
    p.note(0, 'timp', 38, 1, 0.8).note(0, 'taiko', null, 1, 0.7);
    p.swell('troll', 32, 0.6);
    p.note(32, 'boom', null, 1, 0.8).note(32, 'taiko', null, 1, 0.8).note(32, 'crash', null, 1, 0.7);
    p.arp('harp', [0, 1, 2, 3, 4, 5, 6, 7], 50, 0.4, 'base', { from: 2 });
  } },
  // Victory fanfare.
  VIC: { chords: ['D', 'Bb C', 'D', 'G', 'D'], build(p) {
    p.mel('horn', 'D4:4 A4:8 F#4:4 | F4:4 D4:4 E4:4 G4:4 | F#4:8 A4:4 D5:4 | D5:8 B4:4 G4:4 | A4:4 D5:12', 0.85);
    p.pad('choir', choirOpen, 0.65).pad('ooh', (ch) => [above(CHORDS[ch][0], 38)], 0.4);
    p.pad('str', lowPad, 0.55).pad('vln', highPad, 0.4);
    p.timp(0.6);
    p.drums('taiko', 'x . . . . . . . x . . . . . . .', 0.6, 'base', { to: 2 });
    p.swell('troll', 32, 0.55).swell('cym', 64, 0.45);
    p.note(32, 'boom', null, 1, 0.7).note(32, 'crash', null, 1, 0.6).note(64, 'boom', null, 1, 0.7);
    p.arp('harp', [0, 1, 2, 3, 4, 5, 4, 3], 50, 0.4, 'base', { from: 2, to: 4 });
  } },
  // After the victory: calm, in D major / Mixolydian.
  VA: { chords: ['D', 'C', 'G', 'D', 'Bm', 'G', 'Asus4', 'A'], build(p) {
    p.pad('str', lowPad, 0.6).pad('ooh', choirOpen, 0.45, 'base', 4);
    p.arp('harp', [0, 1, 2, 3, 4, 3], 50, 0.42);
    p.mel('flute', 'A5:4 F#5:4 D5:4 | E5:8 G5:4 | D5:8 B4:4 | A4:12 | F#5:4 D5:4 B4:4 | G5:8 D5:4 | D5:8 E5:4 | C#5:12', 0.72);
  } },
  VB: { chords: ['G', 'D', 'C', 'D', 'G', 'D', 'Asus4', 'D'], build(p) {
    p.pad('str', lowPad, 0.6).pad('ooh', choirOpen, 0.5).pad('choir', midPad, 0.25);
    p.arp('harp', [0, 2, 4, 5, 4, 2], 50, 0.4);
    p.mel('horn', 'B3:12 | A3:12 | G3:12 | F#3:12 | G3:8 B3:4 | A3:12 | A3:12 | F#3:12', 0.55);
  } },
  VC: { chords: ['D', 'G', 'D', 'A', 'D', 'G', 'Asus4', 'A'], build(p) {
    const theme = 'D4:4 A4:6 F#4:2 | G4:4 B4:4 D5:4 | A4:12 | E4:8 C#4:4 | F#4:4 A4:4 D5:4 | D5:6 B4:2 G4:4 | A4:8 D5:4 | C#5:12';
    p.mel('horn', theme, 0.7).mel('choir', theme, 0.4, 'base', { shift: -12 });
    p.pad('str', lowPad, 0.55).pad('vln', highPad, 0.3);
    p.arp('harp', [0, 1, 2, 3, 2, 1], 50, 0.32);
    p.note(0, 'timp', 38, 1, 0.45);
  } },
  // Game over: a sombre cue, then a slow lament.
  GO: { chords: ['Dm', 'Bb', 'Gm', 'Asus4 A'], build(p) {
    p.mel('horn', 'A3:6 G3:2 F3:8 | D3:4 F3:4 Bb3:8 | Bb3:6 A3:2 G3:8 | D3:8 C#3:8', 0.7);
    p.pad('str', lowPad, 0.6).pad('ooh', choirOpen, 0.55);
    p.note(0, 'timp', 38, 1, 0.45);
  } },
  LA: { chords: ['Dm', 'Bb', 'F', 'C', 'Gm', 'Dm', 'Bb', 'A'], build(p) {
    p.pad('str', lowPad, 0.5).pad('ooh', choirOpen, 0.45);
    p.arp('harp', [0, 2, 4, 2, 3, 2, 1, null], 50, 0.3);
    p.mel('flute', 'A4:12 G4:4 | F4:16 | A4:8 C5:8 | G4:16 | Bb4:8 A4:4 G4:4 | F4:8 A4:8 | G4:8 F4:8 | E4:16', 0.5);
  } },
  LB: { chords: ['Dm', 'Gm', 'Dm', 'Bb', 'Gm', 'Dm', 'Asus4', 'A'], build(p) {
    p.pad('str', lowPad, 0.5).pad('ooh', choirOpen, 0.5);
    p.mel('choir', 'F3:16 | G3:16 | A3:16 | F3:16 | G3:8 Bb3:8 | A3:16 | A3:16 | A3:16', 0.4);
    p.arp('harp', [0, null, 2, null, 4, null, 2, null], 50, 0.28);
  } },

  // The hideouts (60 bpm, 3/4, F major over D minor): a warm, slow porch waltz. A flute over a
  // fingerpicked harp, soft strings and "ooh" choir; no war drums, nothing that builds.
  HA: { chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'F'], build(p) {
    p.pad('str', lowPad, 0.5).pad('ooh', choirOpen, 0.36, 'base', 2);
    p.arp('harp', [0, 1, 2, 3, 4, 3], 50, 0.36);
    p.mel('flute', 'A4:4 C5:4 F5:4 | E5:6 D5:2 C5:4 | D5:6 C5:2 A4:4 | Bb4:4 D5:4 F5:4 | F5:6 G5:2 A5:4 | G5:6 E5:2 C5:4 | D5:4 C5:4 Bb4:4 | A4:12', 0.6);
  } },
  HB: { chords: ['Dm', 'Gm', 'Dm', 'C', 'Bb', 'F', 'Gm', 'Asus4'], build(p) {
    p.pad('str', lowPad, 0.5).pad('ooh', choirOpen, 0.4).pad('vln', highPad, 0.18, 'base', 4);
    p.arp('harp', [0, 2, 1, 2, 3, 2], 50, 0.34);
    p.mel('horn', 'A3:12 | Bb3:12 | A3:8 F3:4 | G3:12 | F3:8 A3:4 | C4:12 | Bb3:8 A3:4 | A3:12', 0.42);
    p.mel('flute', 'D5:6 F5:6 | A5:6 F5:2 C5:4 | Bb4:4 D5:4 G5:4 | E5:8 A4:4', 0.5, 'base', { bar: 4 });
  } },
  // A waltz with a walking bass ("oom-pah-pah") under the tune.
  HC: { chords: ['F', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'F'], build(p) {
    p.pad('str', lowPad, 0.4).pad('ooh', choirOpen, 0.3, 'base', 4);
    p.ost('>0 . 7 . 7 .', 0.5, 'base', { lo: 38 });
    p.arp('harp', [null, 2, 3, null, 3, 4], 50, 0.3);
    p.mel('flute', 'C5:4 F5:4 A5:4 | Bb5:6 A5:2 F5:4 | A5:4 G5:4 F5:4 | E5:6 D5:2 C5:4 | D5:4 F5:4 A5:4 | G5:6 F5:2 D5:4 | E5:4 G5:4 C5:4 | F5:12', 0.58);
    p.drums('drum', 'o . . . . .', 0.8, 'base', { every: 2 });
  } },
  HD: { chords: ['Bb', 'F', 'Gm', 'Dm', 'Bb', 'F', 'C', 'F'], build(p) {
    p.pad('str', lowPad, 0.48).pad('ooh', choirOpen, 0.38).pad('vln', highPad, 0.2);
    p.arp('harp', [0, 1, 2, 3, 2, 1], 50, 0.36);
    p.mel('flute', 'D5:6 F5:6 | C5:6 A4:6 | Bb4:4 D5:4 G5:4 | F5:8 D5:4 | D5:6 F5:2 Bb5:4 | A5:6 F5:6 | G5:4 E5:4 C5:4 | F5:12', 0.56);
  } },
  // Only the room: strings, a slow harp and the choir humming.
  HE: { chords: ['F', 'Bb', 'Dm', 'C'], build(p) {
    p.pad('str', lowPad, 0.42).pad('ooh', choirOpen, 0.36);
    p.arp('harp', [0, null, 2, null, 4, null], 50, 0.3);
  } },
};

// Pitch classes each state may use (the tests hold the score to them).
const AEOLIAN = [2, 4, 5, 7, 9, 10, 0];
const pcs = (...extra) => [...new Set([...AEOLIAN, ...extra])].sort((a, b) => a - b);

/**
 * States: bpm (quarter note; 6/8: dotted quarter), bar (ticks per bar), beat (ticks per
 * beat), phrases, first (opening phrase), intro (played when entering from calm music),
 * next (cue states: where they go when done), scale (allowed pitch classes).
 */
export const MUSIC_STATES = {
  menu: { bpm: 70, bar: 12, beat: 4, phrases: ['CE', 'CT', 'CA', 'CB', 'CC', 'CD'], first: 'CE', scale: pcs(11) },
  calm: { bpm: 70, bar: 12, beat: 4, phrases: ['CA', 'CB', 'CC', 'CD', 'CE', 'CT'], scale: pcs(11) },
  tension: { bpm: 112, bar: 16, beat: 4, phrases: ['TA', 'TB'], scale: pcs(1) },
  battle: { bpm: 112, bar: 16, beat: 4, phrases: ['B1', 'B2', 'B3', 'B4', 'B5'], first: 'B1', intro: 'RISE', scale: pcs(1, 11) },
  boss: { bpm: 76, compound: true, bar: 12, beat: 6, phrases: ['K1', 'K2', 'K3', 'K4', 'K5'], first: 'K1', intro: 'KRISE', scale: pcs(1) },
  waveclear: { bpm: 90, bar: 16, beat: 4, phrases: ['WC'], next: 'calm', cue: true, scale: pcs(6) },
  victory: { bpm: 84, bar: 16, beat: 4, phrases: ['VIC'], next: 'glory', cue: true, scale: pcs(6, 11) },
  glory: { bpm: 72, bar: 12, beat: 4, phrases: ['VA', 'VB', 'VC'], scale: pcs(1, 6, 11) },
  gameover: { bpm: 60, bar: 16, beat: 4, phrases: ['GO'], next: 'lament', cue: true, scale: pcs(1) },
  lament: { bpm: 60, bar: 16, beat: 4, phrases: ['LA', 'LB'], scale: pcs(1) },
  hideout: { bpm: 60, bar: 12, beat: 4, phrases: ['HE', 'HA', 'HB', 'HC', 'HD'], first: 'HE', scale: pcs() },
};
for (const s of Object.values(MUSIC_STATES)) s.tick = s.compound ? 60 / s.bpm / 6 : 60 / s.bpm / 4;
// Cue states and what follows them count as one "family" for the state machine.
const FAMILY = { waveclear: 'calm', victory: 'glory', gameover: 'lament' };
const URGENT = new Set(['battle', 'boss', 'waveclear', 'victory', 'gameover']);

/** Build phrase `name` for `state` (deterministic for a given rng): { len, events, segs }. */
export function buildPhrase(stateName, name, rng = createRng(1)) {
  const def = PHRASES[name];
  if (!def) throw new Error(`unknown phrase ${name}`);
  const p = new Phrase(MUSIC_STATES[stateName], def.chords, rng);
  def.build(p);
  p.ev.sort((a, b) => a.t - b.t);
  return { name, len: p.len, events: p.ev, segs: p.segs };
}

const ramp = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
/** Layer loudness by intensity: the battle builds up as the horde grows. */
export function layerGain(L, I) {
  switch (L) {
    case 'd1': return ramp(I, 0.28, 0.4);
    case 'd2': return ramp(I, 0.48, 0.6);
    case 'd3': return ramp(I, 0.66, 0.78);
    case 'horn': return ramp(I, 0.4, 0.52);
    case 'choir': return ramp(I, 0.52, 0.64);
    case 'chant': return ramp(I, 0.64, 0.76);
    case 'hi': return ramp(I, 0.58, 0.7);
    default: return 1;
  }
}

/** A long, dark stereo hall for the score (decorrelated channels, ~3 s RT60). */
function makeHall(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * HALL_SECONDS);
  const ir = ctx.createBuffer(2, len, sr);
  const rng = createRng(0x5ca1ab1e);
  const k = Math.log(1000) / 3.0;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    const pre = Math.floor(sr * 0.022);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const c = 0.08 + 0.55 * Math.exp(-t * 3);
      lp += ((rng.next() * 2 - 1) - lp) * c;
      d[i] = lp * Math.exp(-k * t) * Math.min(1, t / 0.06);
    }
  }
  return ir;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {{ out: AudioNode, bank: object, seed?: number }} o
 */
export function createMusic(ctx, { out, bank, seed } = {}) {
  const rng = createRng(seed ?? Math.floor(Math.random() * 2 ** 31));
  const master = ctx.createGain();
  master.gain.value = 0;
  const duckNode = ctx.createGain();
  master.connect(duckNode);
  duckNode.connect(out);
  const hall = ctx.createConvolver();
  hall.buffer = makeHall(ctx);
  const hallOut = ctx.createGain();
  hallOut.gain.value = 0.55;
  hall.connect(hallOut);
  hallOut.connect(master);

  const sections = {};
  for (const [name, [pan, wet]] of Object.entries(SECTIONS)) {
    const input = ctx.createGain();
    let tail = input;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      input.connect(p);
      tail = p;
    }
    tail.connect(master);
    const send = ctx.createGain();
    send.gain.value = wet;
    tail.connect(send);
    send.connect(hall);
    sections[name] = input;
  }

  let started = false;
  let intensity = 0.1, target = 0.1, boss = false, mode = 'menu';
  let cueReq = null;           // { name, at } — e.g. a wave just got cleared
  let lastTick = 0, nextTime = 0;
  let cur = null;              // { name, def, phrase, idx, tick, group }
  const played = new Map();    // phrase → times played (less-heard phrases come first)
  let lastPhrase = '';
  let active = [];             // end times of sounding notes
  let duckLast = 1;
  const history = [];          // recent phrases: { t, state, phrase }

  // A group is one state's notes behind per-section faders, so a state change can fade
  // them all at once. Its faders are disconnected when its last note has ended (onended,
  // which also fires in offline renders: nothing is torn down on a wall-clock timer).
  function newGroup() {
    return { faders: {}, notes: [], live: 0, released: false };
  }

  function retire(group) {
    for (const f of Object.values(group.faders)) f.disconnect();
    group.faders = {};
  }

  function fader(group, sec) {
    let f = group.faders[sec];
    if (!f) {
      f = ctx.createGain();
      f.gain.value = 1;
      f.connect(sections[sec]);
      group.faders[sec] = f;
    }
    return f;
  }

  function releaseGroup(group, t, tc) {
    for (const f of Object.values(group.faders)) {
      f.gain.setValueAtTime(f.gain.value, t);
      f.gain.setTargetAtTime(0, t, tc);
    }
    const end = t + tc * 7;
    for (const n of group.notes) {
      if (n.end > end) {
        try {
          n.src.stop(end);
        } catch {
          // already stopped
        }
      }
    }
    group.notes = [];
    group.released = true;
    if (group.live === 0) retire(group);
  }

  /** Nearest baked sample root for `midi` (±7 semitones), or null. */
  function sample(id, midi) {
    const roots = MUSIC_ROOTS[id];
    const rr = MUSIC_RR[id] || 1;
    const take = rr > 1 ? Math.floor(rng.next() * rr) : 0;
    if (!roots) {
      const buf = bank.variant ? bank.variant(id, take) || bank.variant(id, 0) : bank.get(id, rng.next());
      return buf ? { buf, rate: 1 } : null;
    }
    const order = roots.map((r, k) => [Math.abs(midi - r), k]).sort((a, b) => a[0] - b[0]);
    for (const [dist, k] of order) {
      if (dist > 7) break;
      const buf = bank.variant(id, k * rr + take) || (take ? bank.variant(id, k * rr) : null);
      if (buf) return { buf, rate: Math.pow(2, (midi - roots[k]) / 12) };
    }
    return null;
  }

  function play(e, t, st, group, instName = e.i) {
    const inst = INSTRUMENTS[instName];
    const vel = e.v * layerGain(e.L, intensity);
    if (vel < 0.04) return;
    const s = sample(inst.id, e.m ?? 60);
    if (!s) {
      if (inst.fb) play(e, t, st, group, inst.fb);
      return;
    }
    // Prune by the note's own start time: offline renders schedule everything at currentTime 0.
    active = active.filter((x) => x > t);
    if (active.length >= MAX_ACTIVE && inst.sec !== 'drums') return;
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = s.rate;
    const amp = ctx.createGain();
    const level = vel * inst.g * (0.9 + 0.2 * rng.next());
    let head = amp;
    let filt = null;
    if (inst.swell) {
      // Brass bloom: the tone opens as the note swells.
      filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.6;
      filt.frequency.setValueAtTime(380, t);
      filt.frequency.setTargetAtTime(Math.min(1400 + vel * 3000, ctx.sampleRate * 0.45), t, inst.a * 1.5 + 0.05);
      filt.connect(amp);
      head = filt;
    }
    src.connect(head);
    amp.connect(fader(group, inst.sec));
    let end;
    if (inst.one) {
      amp.gain.value = level;
      let offset = 0;
      if (e.to !== undefined) offset = Math.max(0, inst.peak - (e.to - e.t) * st.tick);
      end = t + (s.buf.duration - offset) / s.rate;
      src.start(t, offset);
    } else {
      const len = Math.max(inst.a, e.d * st.tick);
      src.loop = true;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + inst.a);
      amp.gain.setValueAtTime(level, t + len);
      amp.gain.setTargetAtTime(0, t + len, inst.r / 3);
      end = t + len + inst.r * 2;
      src.start(t, rng.next() * s.buf.duration);
      src.stop(end);
    }
    active.push(end);
    group.notes.push({ src, end });
    if (group.notes.length > 64) group.notes = group.notes.filter((n) => n.end > t);
    group.live++;
    src.onended = () => {
      if (--group.live === 0 && group.released) retire(group);
      src.disconnect();
      amp.disconnect();
      if (filt) filt.disconnect();
    };
  }

  function pickPhrase(state) {
    const def = MUSIC_STATES[state];
    const opts = def.phrases.length > 1 ? def.phrases.filter((n) => n !== lastPhrase) : def.phrases;
    let best = opts[0];
    let bestScore = Infinity;
    for (const n of opts) {
      const score = (played.get(n) || 0) + rng.next() * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  function enter(state, t, from) {
    const def = MUSIC_STATES[state];
    const calmBefore = !from || !['tension', 'battle', 'boss'].includes(from);
    let name;
    if (def.intro && calmBefore) name = def.intro;
    else if (def.first && !played.has(def.first)) name = def.first;
    else name = pickPhrase(state);
    if (cur) releaseGroup(cur.group, t, URGENT.has(state) ? 0.25 : 0.8);
    cur = { name: state, def, group: newGroup(), phrase: null, idx: 0, tick: 0 };
    startPhrase(name, t);
  }

  function startPhrase(name, t) {
    history.push({ t, state: cur.name, phrase: name });
    if (history.length > 64) history.shift();
    played.set(name, (played.get(name) || 0) + 1);
    if (!MUSIC_STATES[cur.name].intro || name !== MUSIC_STATES[cur.name].intro) lastPhrase = name;
    cur.phrase = buildPhrase(cur.name, name, rng);
    cur.idx = 0;
    cur.tick = 0;
  }

  /** Where the music wants to be right now. */
  function desired() {
    if (mode === 'menu') return 'menu';
    if (mode === 'gameover') return 'gameover';
    if (mode === 'victory') return 'victory';
    if (mode === 'hideout') return 'hideout';
    if (boss) return 'boss';
    const fighting = cur && (cur.name === 'battle' || cur.name === 'boss');
    if (target >= 0.33 || (fighting && target >= 0.2)) return 'battle';
    if (cueReq && cueReq.name === 'waveclear') return 'waveclear';
    if (target >= 0.2) return 'tension';
    return 'calm';
  }

  /** Should the music leave `cur` for `want` at this tick? */
  function switchNow(want) {
    if (!cur || want === cur.name) return false;
    if (FAMILY[want] === cur.name || FAMILY[cur.name] === want) return false; // a cue and its follow-up
    const st = cur.def;
    if (st.cue && !URGENT.has(want)) return false; // let a cue finish
    const q = URGENT.has(want) ? st.beat : st.bar;
    return cur.tick % q === 0;
  }

  function ready() {
    return bank.has ? bank.has('mu_str') : true;
  }

  function step(t) {
    const want = desired();
    if (!cur) {
      enter(want, t, null);
    } else if (cur.tick >= cur.phrase.len) {
      // End of a phrase: a cue hands over to its follow-up, loops pick another phrase.
      if (switchNow(want) || (cur.def.cue && want !== cur.name)) enter(want === cur.name ? cur.def.next : want, t, cur.name);
      else if (cur.def.cue) enter(cur.def.next, t, cur.name);
      else startPhrase(pickPhrase(cur.name), t);
    } else if (switchNow(want)) {
      enter(want, t, cur.name);
    }
    if (cur.name === 'waveclear') cueReq = null;
    const st = cur.def;
    const ev = cur.phrase.events;
    while (cur.idx < ev.length && ev[cur.idx].t <= cur.tick) {
      const e = ev[cur.idx++];
      if (e.t < cur.tick) continue;
      const drum = INSTRUMENTS[e.i].sec === 'drums';
      play(e, t + (drum ? 0 : (rng.next() - 0.5) * 0.008), st, cur.group);
    }
    cur.tick++;
    return st.tick;
  }

  return {
    /** Target intensity 0..1, boss flag and mode ('menu'|'game'|'hideout'|'gameover'|'victory'). */
    set(nextTarget, nextBoss, nextMode) {
      target = clamp(Number.isFinite(nextTarget) ? nextTarget : 0, 0, 1);
      boss = !!nextBoss;
      mode = nextMode;
    },
    /** One-off musical moment: 'waveclear'. */
    cue(name) {
      if (name === 'waveclear') cueReq = { name, at: lastTick };
    },
    /** Multiply the score's level (0..1) while the fight is loud. */
    duck(level, now = lastTick) {
      const v = clamp(level, 0, 1);
      if (Math.abs(v - duckLast) < 0.02) return;
      duckLast = v;
      duckNode.gain.setTargetAtTime(v, now, v < duckNode.gain.value ? 0.08 : 0.6);
    },
    get intensity() {
      return intensity;
    },
    /** Current state name (null until the first notes are scheduled). */
    get state() {
      return cur ? cur.name : null;
    },
    get phrase() {
      return cur && cur.phrase ? cur.phrase.name : null;
    },
    /** The last 64 phrases started: { t (audio time), state, phrase }. */
    get history() {
      return history.slice();
    },
    /** Advance: smooth intensity and schedule notes up to now + LOOKAHEAD. */
    tick(now) {
      const dt = clamp(now - lastTick, 0, 1);
      lastTick = now;
      // Rise quickly when things kick off, relax slowly afterwards.
      const rate = target > intensity ? 0.5 : 0.08;
      intensity += clamp(target - intensity, -rate * dt, rate * dt);
      if (cueReq && now - cueReq.at > 6) cueReq = null;
      if (!started) {
        if (!ready()) return;
        started = true;
        master.gain.setValueAtTime(0, now);
        master.gain.setTargetAtTime(1, now, 0.6);
        nextTime = now + 0.1;
      }
      // Resync after the context was suspended (hidden tab) instead of catching up.
      if (nextTime < now - 0.1) nextTime = now + 0.05;
      let guard = 64;
      while (nextTime < now + LOOKAHEAD && guard-- > 0) nextTime += step(nextTime);
    },
  };
}
