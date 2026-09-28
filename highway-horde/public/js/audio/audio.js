// Audio engine (SPEC §7.4). Everything is synthesised: sounds.js holds the recipes,
// bank.js bakes them into AudioBuffers once at unlock, and this file turns game events
// and snapshots into positional one-shots, continuous loops and music.
//
// Signal flow:
//   24 voice slots ─┬─ dry ─► sfxDry ─► muffle ─┐
//   loop voices ────┘                           │
//        └─ wet sends ─► sfxWet ─► reverb ──────┤
//   music ─► musicDry ──────────────────────────┤
//        └─ musicWet ─► reverb                  ▼
//                     master ─► compressor ─► limiter ─► soft clip (ceiling 0.98) ─► out
//
// Voices are fixed slots with persistent gain/filter/pan nodes; a new sound only costs a
// buffer-source node. When all slots are busy the least important voice (priority +
// loudness) is faded out in 10 ms and reused, or the new sound is dropped.
//
// Listener orientation (SPEC §7.5): with `yaw` in the addEvents/update options (first-person
// view) a sound pans by the sine of its angle off the facing direction and one behind the
// listener is a little quieter and duller (the voice's own lowpass). Without `yaw`
// (top-down) panning stays screen-relative (world dx).

import { WEAPONS } from '../shared/weapons.js';
import { BLEEDOUT_TIME } from '../shared/constants.js';
import { clamp, lerp } from '../shared/math.js';
import { SOUNDS, SOUND_IDS } from './sounds.js';
import { createBank } from './bank.js';
import { createMusic } from './music.js';

export const MAX_VOICES = 24;
export const MAX_LOOPS = 12;
/** Beyond this distance (px, scaled by a sound's `range`) a sound is inaudible. */
export const AUDIBLE_RANGE = 1600;
/** Horizontal offset (px) that pans a sound fully to one side (then capped at 0.85). */
const PAN_WIDTH = 750;
/** Hardest pan any positional sound gets. */
const PAN_MAX = 0.85;
/** First person: inside this distance (px) a sound's pan narrows toward the centre. */
const PAN_NEAR = 120;
/** First person: a sound straight behind is this much quieter … */
const REAR_ATTENUATION = 0.25;
/** … and low-passed down to this cutoff (Hz; at most 16 % of the open cutoff). */
const REAR_LOWPASS = 3200;
const NEAR_FIELD = 80;
const HORDE_RADIUS = 900;
const HORDE_NEAR = 350;
const GROAN_RADIUS = 750;
const FIRE_RADIUS = 700;
/** Permanent map fires (burning wrecks) crackle within this range, a bit less than hazards. */
const MAP_FIRE_RADIUS = 520;
const MAP_FIRE_GAIN = 0.7;
const LOW_HP = 0.3;
/** A loop no longer wanted keeps playing this long, so a flickering `firing` flag doesn't restart it. */
const LOOP_GRACE = 0.15;

const DEFAULT_VOLUME = { master: 0.8, sfx: 1, music: 0.5 };

const EXPLOSIONS = { frag: 'expl_frag', grenade: 'expl_grenade', rocket: 'expl_rocket', bloater: 'expl_bloater' };
const PICKUPS = { ammo: 'pick_ammo', health: 'pick_health', cash: 'pick_cash', armor: 'pick_armor', frag: 'pick_frag', crate: 'pick_crate' };
const UI = {
  click: 'ui_click', hover: 'ui_hover', buy: 'buy', deny: 'deny', chat: 'ui_chat', join: 'ui_join', leave: 'ui_leave',
  wave: 'siren', waveclear: 'waveclear', gameover: 'gameover', victory: 'victory', countdown: 'ui_countdown', ready: 'ui_ready',
};

// Reload choreography per weapon: [sound, fraction of the reload time, playback rate].
const MAG = (r) => [['mag_out', 0, r], ['mag_in', 0.6, r], ['rack', 0.86, r]];
const BOX = [['box', 0, 1], ['box', 0.55, 1.1], ['rack', 0.88, 0.85]];
const RELOADS = {
  pistol: [['mag_out', 0, 1.1], ['mag_in', 0.55, 1.1], ['slide', 0.85, 1]],
  magnum: [['breach', 0, 1.1], ['shell', 0.35, 1], ['shell', 0.5, 1.05], ['shell', 0.65, 0.95], ['breach', 0.88, 1.2]],
  sawedoff: [['breach', 0, 1], ['shell', 0.45, 1], ['shell', 0.6, 1.05], ['breach', 0.88, 1.15]],
  uzi: MAG(1.15),
  dual_smg: [['mag_out', 0, 1.15], ['mag_out', 0.1, 1.2], ['mag_in', 0.55, 1.15], ['mag_in', 0.7, 1.2], ['rack', 0.88, 1.15]],
  shotgun: [['shell', 0.12, 1], ['shell', 0.3, 1.04], ['shell', 0.48, 0.97], ['shell', 0.66, 1.02], ['pump', 0.88, 1]],
  rifle: MAG(1),
  dmr: MAG(0.9),
  crossbow: [['crank', 0.1, 1], ['mag_in', 0.8, 0.9]],
  sniper: [['bolt', 0, 1], ['mag_out', 0.25, 1], ['mag_in', 0.6, 1], ['bolt', 0.82, 1.1]],
  auto_shotgun: MAG(0.85),
  flamethrower: [['canister', 0, 1], ['canister', 0.7, 1.1]],
  lmg: BOX,
  grenade_launcher: [['breach', 0, 0.8], ['shell', 0.35, 0.7], ['shell', 0.55, 0.72], ['breach', 0.88, 0.9]],
  rocket: [['tube', 0.2, 1], ['breach', 0.8, 0.8]],
  tesla: [['mag_out', 0, 0.8], ['charge', 0.45, 1]],
  minigun: BOX,
  railgun: [['mag_out', 0, 0.7], ['charge', 0.35, 0.8], ['mag_in', 0.85, 0.7]],
};

// Events that still matter when a tab returns from the background with a backlog.
const STATE_EVENTS = new Set(['wave', 'waveclear', 'bossspawn', 'gameover', 'victory', 'down', 'died', 'revived', 'respawn', 'buy', 'buyfail']);

const PRIO_OWN = 90;
const PRIO_UI = 100;

function disconnectChain(e) {
  const n = e.target;
  n.disconnect();
  if (n._chain) for (const c of n._chain) c.disconnect();
}

/** tanh-kneed soft clipper: identity below 0.8, approaches the 0.98 ceiling above. */
function softClipCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2; // the shaper input is pre-scaled by 0.5
    const a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** Procedural impulse response: early reflections off cars/walls + a darkening tail. */
function makeImpulse(ctx, seconds = 1.3) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // The tail loses its highs over time like air absorption does.
      const k = 0.15 + 0.8 * Math.exp(-t * 5);
      lp += (rnd() - lp) * k;
      d[i] = lp * Math.exp(-t * 4.2) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let r = 0; r < 7; r++) {
      const at = Math.floor(sr * (0.009 + r * 0.011 + Math.abs(rnd()) * 0.01 + ch * 0.003));
      if (at < len) d[at] += (0.6 - r * 0.07) * (rnd() < 0 ? -1 : 1);
    }
  }
  return ir;
}

/**
 * Pan and "behindness" of a sound at offset (dx, dy) from a listener facing `yaw`
 * (first-person view). pan = sin(relative angle) · PAN_MAX (right of the facing direction
 * is positive), narrowed inside PAN_NEAR so a sound at your feet isn't hard-panned;
 * behind = 0 in front / to the sides, rising to 1 straight behind.
 * @param {number} dx
 * @param {number} dy
 * @param {number} yaw
 * @param {{pan: number, behind: number}} [out]
 * @returns {{pan: number, behind: number}}
 */
export function orientedPan(dx, dy, yaw, out = { pan: 0, behind: 0 }) {
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 1e-6)) {
    out.pan = 0;
    out.behind = 0;
    return out;
  }
  const rel = Math.atan2(dy, dx) - yaw;
  out.pan = Math.sin(rel) * PAN_MAX * Math.min(1, d / PAN_NEAR);
  out.behind = Math.max(0, -Math.cos(rel));
  return out;
}

/**
 * Rear shading for a first-person listener: gain multiplier and lowpass cap for a sound
 * with the given `behind` (0..1, from orientedPan).
 * @param {number} behind
 * @param {number} maxLp the engine's open-filter cutoff
 * @returns {{gain: number, lp: number}}
 */
export function rearShade(behind, maxLp) {
  const b = Math.max(0, Math.min(1, behind || 0));
  const k = b * b; // stays subtle at the sides, full effect only well behind
  // Relative to the open cutoff, so low-rate devices (maxLp < 20 kHz) still hear a change.
  const rear = Math.min(REAR_LOWPASS, maxLp * 0.16);
  return { gain: 1 - REAR_ATTENUATION * k, lp: maxLp + (rear - maxLp) * k };
}

class Engine {
  constructor(options) {
    this.opts = options || {};
    this.ctx = null;
    this.ready = false;
    this.vol = { ...DEFAULT_VOLUME };
    this.muted = false;
    this.lx = 0;
    this.ly = 0;
    /** Listener facing (first-person view) or null (top-down: screen-relative panning). */
    this.lyaw = null;
    this.op = { pan: 0, behind: 0 };
    this.localId = 0;
    this.players = null;
    this.mapFires = [];
    this.slots = [];
    this.loops = new Map();
    this.groupLast = new Map();
    this.stagger = new Map();
    this.lastShotT = new Map();
    this.lastShotW = new Map();
    this.counters = { played: 0, dropped: 0, stolen: 0, limited: 0, errors: 0 };
    this.groanTimer = 1;
    this.bossTimer = 3;
    this.hbTimer = 0;
    this.muffleTarget = 20000;
    this.lastUpdateWall = -1e9;
    this.musicMode = 'menu';
    this.musicTarget = 0.1;
    this.musicBoss = false;
    this.musicTimer = 0;
    this.visHandler = null;
  }

  now() {
    return this.opts.clock ? this.opts.clock() : this.ctx.currentTime;
  }

  fault(err) {
    this.counters.errors++;
    if (this.counters.errors <= 3 && typeof console !== 'undefined') console.warn('[audio]', err);
  }

  // ---- setup ------------------------------------------------------------------------------

  unlock() {
    if (this.ctx) {
      this.resume();
      return Promise.resolve(this.ready);
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!this.opts.context && !Ctor) return Promise.resolve(false);
    if (this.opts.context) {
      this.ctx = this.opts.context;
    } else {
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        // Older WebKit rejects the options bag.
        this.ctx = new Ctor();
      }
    }
    this.offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    this.manual = this.offline || !!this.opts.manual;
    this.buildGraph();
    this.bank = createBank(this.ctx, { sync: this.offline || !!this.opts.syncBake });
    this.music = createMusic(this.ctx, { out: this.musicDry, wet: this.musicWet, bank: this.bank });
    this.ready = true;
    this.applyVolume();
    if (!this.offline) {
      // iOS only opens the audio path once something plays inside the gesture.
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      src.connect(this.ctx.destination);
      src.start(0);
      if (typeof document !== 'undefined' && document.addEventListener) {
        this.visHandler = () => {
          try {
            if (document.hidden) {
              if (this.ctx.state === 'running') {
                const p = this.ctx.suspend();
                if (p && typeof p.catch === 'function') p.catch(() => {});
              }
            } else {
              this.resume();
            }
          } catch (err) {
            this.fault(err);
          }
        };
        document.addEventListener('visibilitychange', this.visHandler);
      }
    }
    if (!this.manual) {
      this.musicTimer = setInterval(() => {
        try {
          this.musicTick();
        } catch (err) {
          this.fault(err);
        }
      }, 50);
    }
    return this.resume();
  }

  resume() {
    const ctx = this.ctx;
    if (!ctx || this.offline || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve(this.ready);
    if (typeof document !== 'undefined' && document.hidden) return Promise.resolve(this.ready);
    const p = ctx.resume();
    // Very old WebKit returns nothing from resume().
    return p && typeof p.then === 'function' ? p.then(() => true, () => false) : Promise.resolve(true);
  }

  buildGraph() {
    const ctx = this.ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.master = g(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.12;
    const pre = g(0.5);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none';
    const dest = this.opts.destination || ctx.destination;
    if (this.opts.dynamics === false) {
      // Measurement only: the raw mix, to show what the compressor/limiter are saving us from.
      this.master.connect(dest);
    } else {
      this.master.connect(comp);
      comp.connect(lim);
      lim.connect(pre);
      pre.connect(clip);
      clip.connect(dest);
    }
    this.comp = comp;
    this.limiter = lim;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    const revOut = g(0.55);
    this.reverb.connect(revOut);
    revOut.connect(this.master);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = Math.min(20000, ctx.sampleRate * 0.45);
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.master);
    this.sfxDry = g();
    this.sfxDry.connect(this.muffle);
    this.sfxWet = g();
    this.sfxWet.connect(this.reverb);
    this.musicDry = g();
    this.musicDry.connect(this.master);
    this.musicWet = g();
    this.musicWet.connect(this.reverb);

    this.hasPanner = typeof ctx.createStereoPanner === 'function';
    // Filter cutoffs above Nyquist get clamped with a console warning on low-rate devices.
    this.maxLp = Math.min(20000, ctx.sampleRate * 0.45);
    this.muffleTarget = this.maxLp;
    for (let i = 0; i < MAX_VOICES; i++) {
      const s = { gain: g(0), filter: ctx.createBiquadFilter(), pan: null, wet: g(0), src: null,
        start: 0, end: 0, score: 0, gainVal: 0, group: '', reloadPid: 0 };
      s.filter.type = 'lowpass';
      s.filter.frequency.value = this.maxLp;
      s.gain.connect(s.filter);
      let tail = s.filter;
      if (this.hasPanner) {
        s.pan = ctx.createStereoPanner();
        s.filter.connect(s.pan);
        tail = s.pan;
      }
      tail.connect(this.sfxDry);
      tail.connect(s.wet);
      s.wet.connect(this.sfxWet);
      this.slots.push(s);
    }
  }

  applyVolume() {
    if (!this.ready) return;
    const t = this.now();
    const sq = (v) => v * v;
    const m = this.muted ? 0 : sq(this.vol.master);
    this.master.gain.setTargetAtTime(m, t, 0.03);
    this.sfxDry.gain.setTargetAtTime(sq(this.vol.sfx), t, 0.03);
    this.sfxWet.gain.setTargetAtTime(sq(this.vol.sfx), t, 0.03);
    this.musicDry.gain.setTargetAtTime(sq(this.vol.music), t, 0.1);
    this.musicWet.gain.setTargetAtTime(sq(this.vol.music), t, 0.1);
  }

  setVolume(v) {
    if (!v || typeof v !== 'object') return;
    for (const k of ['master', 'sfx', 'music']) {
      if (Number.isFinite(v[k])) this.vol[k] = clamp(v[k], 0, 1);
    }
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = !!m;
    this.applyVolume();
  }

  // ---- voices -------------------------------------------------------------------------------

  /** Attenuation, pan, air-absorption cutoff and reverb scale for a world position. */
  spatial(x, y, rangeMul, out) {
    const dx = x - this.lx, dy = y - this.ly;
    const d = Math.sqrt(dx * dx + dy * dy);
    const R = AUDIBLE_RANGE * rangeMul;
    if (!(d < R)) return false;
    const k = d <= NEAR_FIELD ? 1 : 1 - (d - NEAR_FIELD) / (R - NEAR_FIELD);
    out.att = Math.pow(k, 1.7);
    out.lp = 700 + (this.maxLp - 700) * Math.pow(k, 2.5);
    out.wetMul = 1 + (1 - k) * 1.5;
    if (this.lyaw === null) {
      out.pan = clamp(dx / PAN_WIDTH, -1, 1) * PAN_MAX;
    } else {
      const o = orientedPan(dx, dy, this.lyaw, this.op);
      out.pan = o.pan;
      if (o.behind > 0) {
        const r = rearShade(o.behind, this.maxLp);
        out.att *= r.gain;
        out.lp = Math.min(out.lp, r.lp);
      }
    }
    return true;
  }

  /** Pan for a world offset: oriented in first person, screen-relative otherwise. */
  panOf(dx, dy) {
    if (this.lyaw === null) return clamp(dx / PAN_WIDTH, -1, 1) * PAN_MAX;
    return orientedPan(dx, dy, this.lyaw, this.op).pan;
  }

  /** Listener facing from addEvents/update options: a finite yaw, else top-down (null). */
  setListenerYaw(opts) {
    this.lyaw = opts && Number.isFinite(opts.yaw) ? opts.yaw : null;
  }

  /**
   * Play sound `id`. o: { x, y (world, omitted/local → centred), local, gain, rate, delay,
   * offset (seconds into the buffer), prio, group, lim, range, minGain, reloadPid, pan }.
   * Returns true if it will be heard.
   */
  play(id, o = {}) {
    const def = SOUNDS[id];
    if (!def || def.loop || !this.ready) return false;
    const now = this.now();
    const at = now + (o.delay > 0 ? o.delay : 0);
    let g = (def.g ?? 1) * (o.gain ?? 1);
    let pan = o.pan || 0, lp = this.maxLp, wet = def.wet ?? 0.2;
    if (!o.local && o.x !== undefined) {
      // A positional sound without a usable position is dropped, never played centred.
      if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return false;
      const sp = this.sp || (this.sp = {});
      if (this.spatial(o.x, o.y, (def.range || 1) * (o.range || 1), sp)) {
        g *= Math.max(sp.att, o.minGain || 0);
        pan = sp.pan;
        lp = sp.lp;
        wet *= sp.wetMul;
      } else if (o.minGain) {
        // Important world events (boss, objective, downed teammates) stay faintly audible.
        g *= o.minGain;
        pan = this.panOf(o.x - this.lx, o.y - this.ly);
        lp = 700;
        wet *= 2.5;
      } else {
        return false;
      }
    }
    if (g < 0.003) return false;
    const group = o.group || def.group || id;
    const lim = o.lim === null ? null : (o.lim || def.lim);
    if (lim && !this.allowed(group, lim, at, now)) {
      this.counters.limited++;
      return false;
    }
    const buf = this.bank.get(id, Math.random());
    if (!buf) return false;
    const prio = o.prio ?? def.prio ?? 50;
    const score = prio + g * 8;
    const slot = this.pickSlot(score, now);
    if (!slot) {
      this.counters.dropped++;
      return false;
    }
    let startAt = at;
    if (slot.end > now) {
      // Steal: a 10 ms fade avoids a click, then the slot is ours.
      const pg = slot.gain.gain;
      pg.cancelScheduledValues(now);
      pg.setValueAtTime(slot.start > now ? 0 : slot.gainVal, now);
      pg.linearRampToValueAtTime(0, now + 0.008);
      try {
        slot.src.stop(now + 0.01);
      } catch {
        // Already stopped.
      }
      startAt = Math.max(at, now + 0.01);
      this.counters.stolen++;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * (def.pv ?? 0.04));
    src.playbackRate.value = rate;
    src.connect(slot.gain);
    src.onended = disconnectChain;
    // Small per-play loudness variation keeps rapid fire from sounding machine-stamped.
    const gv = g * (0.9 + Math.random() * 0.1);
    const pg = slot.gain.gain;
    pg.cancelScheduledValues(startAt);
    pg.setValueAtTime(gv, startAt);
    slot.filter.frequency.setValueAtTime(lp, startAt);
    if (slot.pan) slot.pan.pan.setValueAtTime(pan, startAt);
    slot.wet.gain.setValueAtTime(wet, startAt);
    const offset = o.offset > 0 ? Math.min(o.offset, buf.duration * 0.9) : 0;
    src.start(startAt, offset);
    slot.src = src;
    slot.start = startAt;
    slot.end = startAt + (buf.duration - offset) / rate;
    slot.score = score;
    slot.gainVal = gv;
    slot.group = group;
    slot.reloadPid = o.reloadPid || 0;
    this.groupLast.set(group, at);
    this.counters.played++;
    return true;
  }

  allowed(group, lim, at, now) {
    const last = this.groupLast.get(group);
    if (last !== undefined && Math.abs(at - last) < lim[0]) return false;
    let n = 0;
    for (const s of this.slots) if (s.end > now && s.group === group) n++;
    return n < lim[1];
  }

  pickSlot(score, now) {
    let victim = null, vScore = Infinity, vEnd = Infinity;
    for (const s of this.slots) {
      if (s.end <= now) return s;
      if (s.score < vScore || (s.score === vScore && s.end < vEnd)) {
        victim = s;
        vScore = s.score;
        vEnd = s.end;
      }
    }
    return vScore <= score ? victim : null;
  }

  activeVoices() {
    if (!this.ready) return 0;
    const now = this.now();
    let n = 0;
    for (const s of this.slots) if (s.end > now) n++;
    return n;
  }

  cancelReload(pid) {
    const now = this.now();
    for (const s of this.slots) {
      if (s.reloadPid === pid && s.end > now && s.start > now) {
        s.gain.gain.cancelScheduledValues(now);
        s.gain.gain.setValueAtTime(0, now);
        try {
          s.src.stop(now);
        } catch {
          // Already stopped.
        }
        s.end = now;
        s.reloadPid = 0;
      }
    }
  }

  // ---- events -------------------------------------------------------------------------------

  playerById(id) {
    const ps = this.players;
    if (!ps) return null;
    for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }

  /** Play at a player's last known position (events that carry only a pid). */
  atPlayer(id, pid, o = {}) {
    if (pid && pid === this.localId) return this.play(id, { ...o, local: true, prio: o.prio ?? PRIO_OWN });
    const p = this.playerById(pid);
    if (p) return this.play(id, { ...o, x: p.x, y: p.y });
    return o.minGain ? this.play(id, { ...o, local: true, gain: (o.gain ?? 1) * o.minGain }) : false;
  }

  addEvents(events, opts) {
    if (!this.ready || !Array.isArray(events)) return;
    if (opts) {
      if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
        this.lx = opts.x;
        this.ly = opts.y;
      }
      if (opts.localId !== undefined && opts.localId !== null) this.localId = opts.localId;
    }
    this.setListenerYaw(opts);
    // A huge batch is a backlog (tab back from the background): replaying seconds of
    // stale gunfire at once would be a wall of noise, so keep state changes only. A merely
    // busy batch skips the cheap detail sounds.
    const stale = events.length > 300;
    const flood = events.length > 150;
    this.stagger.clear();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.type !== 'string') continue;
      if (stale && !STATE_EVENTS.has(e.type)) continue;
      this.event(e, flood);
    }
  }

  event(e, flood) {
    const me = this.localId;
    const own = !!e.pid && e.pid === me;
    const pos = { x: e.x, y: e.y };
    switch (e.type) {
      // An echo is the host's copy of a shot already played as predicted (SPEC §4.1).
      case 'shot': return e.echo ? undefined : this.shot(e, own, flood);
      case 'chain': {
        if (flood || !Array.isArray(e.points)) return;
        const pts = e.points;
        for (let i = 1, n = 0; i < pts.length && n < 3; i += 2, n++) {
          if (pts[i]) this.play('arc', { x: pts[i].x, y: pts[i].y, delay: n * 0.02 });
        }
        return;
      }
      case 'melee':
        this.play('melee_swing', own ? { local: true, prio: PRIO_OWN } : pos);
        if (e.hits > 0) {
          const hx = e.x + Math.cos(e.angle || 0) * 40, hy = e.y + Math.sin(e.angle || 0) * 40;
          this.play('melee_hit', own ? { local: true, prio: PRIO_OWN, delay: 0.07 } : { x: hx, y: hy, delay: 0.07 });
        }
        return;
      case 'zdie':
        this.play(e.gib ? 'zdie_gib' : 'zdie', pos);
        if (e.ztype === 'brute') this.play('die_brute', pos);
        else if (e.ztype === 'boss') this.play('die_boss', { ...pos, minGain: 0.5 });
        return;
      case 'zattack':
        if (flood) return;
        if (e.ztype === 'boss' || e.ztype === 'brute') this.play('zswipe_heavy', { ...pos, gain: e.ztype === 'boss' ? 1 : 0.8 });
        else this.play('zswipe', pos);
        if (Math.random() < 0.3) this.play(this.groanId(e.ztype), { ...pos, gain: 0.55 });
        return;
      case 'spit': return void this.play('spit', pos);
      case 'scream': return void this.play('scream', { ...pos, minGain: 0.12 });
      case 'charge': return void this.play('roar_brute', pos);
      case 'slam': return void this.play('slam', { ...pos, minGain: 0.2 });
      case 'explosion': {
        const id = EXPLOSIONS[e.kind] || 'expl_frag';
        return void this.play(id, { ...pos, gain: clamp((e.r || 150) / 150, 0.75, 1.15), minGain: 0.08 });
      }
      case 'ignite': return void this.play('molotov', pos);
      case 'pdamage':
        if (own) {
          this.play('hurt', { local: true, prio: PRIO_OWN, group: 'hurt_me', lim: [0.35, 1] });
          this.play('flesh', { local: true, prio: PRIO_OWN, gain: 0.6, group: 'flesh_me', lim: [0.1, 2] });
        } else {
          this.atPlayer('hurt', e.pid, { gain: 0.6 });
        }
        return;
      case 'down': return void this.atPlayer('downed', e.pid, { minGain: 0.35 });
      case 'revived':
        if (own || (e.by && e.by === me)) this.play('revive', { local: true, prio: PRIO_OWN });
        else this.atPlayer('revive', e.pid, { gain: 0.7 });
        return;
      case 'died': return void this.atPlayer('death', e.pid, { minGain: 0.35, gain: own ? 1 : 0.7 });
      case 'respawn':
        if (own) this.play('respawn', { local: true, prio: PRIO_OWN });
        return;
      case 'pickup': {
        const id = PICKUPS[e.kind] || 'pick_ammo';
        if (own) this.play(id, { local: true, prio: PRIO_OWN });
        else this.play(id, { ...pos, gain: 0.5 });
        return;
      }
      case 'buy':
        if (own) this.play('buy', { local: true, prio: PRIO_UI });
        return;
      case 'buyfail':
      case 'placefail':
        if (own) this.play('deny', { local: true, prio: PRIO_UI });
        return;
      case 'reload': return void this.reload(e, own);
      case 'switch':
        if (own) this.cancelReload(e.pid);
        return void this.atPlayer('switch', e.pid, { gain: own ? 1 : 0.6 });
      case 'empty': return void this.atPlayer('empty', e.pid, { gain: own ? 1 : 0.6 });
      case 'throw': return void this.atPlayer(e.kind === 'molotov' ? 'throw_molotov' : 'throw_frag', e.pid, { gain: own ? 1 : 0.7 });
      case 'place': return void this.play(e.kind === 'turret' ? 'place_turret' : 'place_barricade', pos);
      case 'destroyed': return void this.play(e.kind === 'turret' ? 'break_turret' : 'break_barricade', pos);
      case 'objhit': return void this.play('alarm', { ...pos, minGain: 0.35 });
      case 'wave':
        this.play('siren', { local: true, prio: PRIO_UI });
        if (e.boss) this.play('horn', { local: true, prio: PRIO_UI, delay: 0.4 });
        this.musicTarget = Math.max(this.musicTarget, 0.45);
        return;
      case 'bossspawn': return void this.play('boss_spawn', { ...pos, minGain: 0.55, prio: PRIO_UI });
      case 'waveclear': return void this.play('waveclear', { local: true, prio: PRIO_UI });
      case 'drop':
        // The crate has just landed: join the flyover near its loudest point.
        this.play('plane', { local: true, prio: 70, offset: 1.2, pan: clamp(this.panOf((e.x ?? this.lx) - this.lx, (e.y ?? this.ly) - this.ly) / PAN_MAX, -1, 1) * 0.5 });
        this.play('drop_thud', { ...pos, minGain: 0.15 });
        return;
      case 'gameover':
        this.play('gameover', { local: true, prio: PRIO_UI });
        this.musicMode = 'gameover';
        return;
      case 'victory':
        this.play('victory', { local: true, prio: PRIO_UI });
        this.musicMode = 'victory';
        return;
      default:
    }
  }

  shot(e, own, flood) {
    const now = this.now();
    const w = WEAPONS[e.weapon];
    const key = e.turret ? -e.turret : e.pid;
    const rate = w ? w.rate : 7;
    const k = this.stagger.get(key) || 0;
    this.stagger.set(key, k + 1);
    // Events arrive in snapshot-sized batches; spreading one shooter's shots at its fire
    // rate turns "two shots at once, then a gap" back into an even rhythm.
    const delay = Math.min(0.1, k * Math.min(0.05, 1 / rate));
    if (e.turret) {
      this.play('turret_shot', { x: e.x, y: e.y, delay });
    } else if (w) {
      if (e.pid) {
        this.lastShotT.set(e.pid, now + delay);
        this.lastShotW.set(e.pid, e.weapon);
      }
      const snd = w.sound;
      // The minigun and flamethrower are continuous loops driven from update().
      if (snd !== 'minigun' && snd !== 'flame') {
        if (own) this.play(snd, { local: true, prio: PRIO_OWN, delay, lim: null });
        else this.play(snd, { x: e.x, y: e.y, delay, gain: 0.85 });
        if (e.weapon === 'shotgun') {
          this.play('pump', own ? { local: true, prio: PRIO_OWN, delay: delay + 0.33 } : { x: e.x, y: e.y, delay: delay + 0.33 });
        }
      }
    }
    if (flood || !Array.isArray(e.rays)) return;
    let n = 0;
    for (let i = 0; i < e.rays.length && n < 3; i++) {
      const r = e.rays[i];
      if (!r || !r.hit) continue;
      const o = { x: r.x, y: r.y, delay: delay + 0.004 };
      if (r.hit === 1) this.play('flesh', o);
      else this.play(Math.random() < 0.3 ? 'ricochet' : 'impact', o);
      n++;
    }
  }

  reload(e, own) {
    const w = WEAPONS[e.weapon];
    const seq = RELOADS[e.weapon] || RELOADS.rifle;
    // The event's time has the shooter's reload perks in it; older senders lack it.
    const t = Number.isFinite(e.time) && e.time > 0 ? e.time : w ? w.reload : 1.8;
    const dur = t * 0.95;
    for (const [id, f, rate] of seq) {
      const o = { delay: f * dur, rate, reloadPid: e.pid || 0 };
      if (own) this.play(id, { ...o, local: true, prio: PRIO_OWN });
      else this.atPlayer(id, e.pid, { ...o, gain: 0.6 });
    }
  }

  groanId(ztype) {
    const id = 'groan_' + ztype;
    return SOUNDS[id] ? id : 'groan_walker';
  }

  ui(name) {
    if (!this.ready) return;
    const id = UI[name];
    if (id) this.play(id, { local: true, prio: PRIO_UI });
  }

  // ---- continuous state -------------------------------------------------------------------------

  update(view, opts) {
    if (!this.ready) return;
    const dt = clamp(opts && Number.isFinite(opts.dt) ? opts.dt : 1 / 60, 0, 0.25);
    if (opts && opts.localId !== undefined && opts.localId !== null) this.localId = opts.localId;
    this.lastUpdateWall = Date.now();
    const now = this.now();
    if (!view || !Array.isArray(view.players)) {
      this.syncLoops(null, now);
      return;
    }
    this.players = view.players;
    const me = this.playerById(this.localId);
    this.setListenerYaw(opts);
    if (opts && Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      // The camera centre: the spectated teammate while we are dead.
      this.lx = opts.x;
      this.ly = opts.y;
    } else if (me && me.state !== 'dead' && Number.isFinite(me.x)) {
      this.lx = me.x;
      this.ly = me.y;
    }
    const want = this.want || (this.want = []);
    want.length = 0;
    this.playerLoops(view, me, now, want);
    this.jumpSounds(view, me);
    const horde = this.hordeLoops(view, dt, want);
    this.hazardLoops(view, want, horde);
    this.syncLoops(want, now);
    this.heartbeat(me, dt);
    this.setMuffle(me, now);
    this.setMusic(view, me, horde.count);
    if (this.manual) this.musicTick();
  }

  playerLoops(view, me, now, want) {
    for (const p of view.players) {
      if (!p || p.state === 'dead' || !Array.isArray(p.slots)) continue;
      const wid = p.slots[p.slot];
      if (wid !== 'minigun' && wid !== 'flamethrower') continue;
      const local = p === me;
      const lt = this.lastShotT.get(p.id);
      const firing = !!p.firing || (lt !== undefined && now - lt < 0.15 && this.lastShotW.get(p.id) === wid);
      if (wid === 'minigun') {
        const spin = clamp(p.spin || 0, 0, 1);
        if (spin > 0.02) this.wantLoop(want, 'spin' + p.id, 'minigun_spin', p, local, Math.pow(spin, 0.7), 0.45 + 0.55 * spin);
        if (firing && spin > 0.9) this.wantLoop(want, 'mfire' + p.id, 'minigun_fire', p, local, 1, 1);
      } else if (firing) {
        this.wantLoop(want, 'flame' + p.id, 'flame_loop', p, local, 1, 1);
      }
    }
  }

  /**
   * Jump / landing sounds from the players' `z` (height while jumping): a survivor leaving
   * the ground or touching down. Read from the view, so the local player's own jump plays
   * the instant it is predicted and teammates' when their snapshots show it.
   */
  jumpSounds(view, me) {
    const last = this.jumpZ || (this.jumpZ = new Map());
    if (view.tick < this.jumpTick) last.clear(); // a new match
    this.jumpTick = view.tick;
    for (const p of view.players) {
      if (!p) continue;
      const z = p.state !== 'dead' && p.z > 0 ? p.z : 0;
      const prev = last.get(p.id);
      last.set(p.id, z);
      if (prev === undefined || (prev > 0) === (z > 0)) continue;
      const id = z > 0 ? 'jump' : 'land';
      this.play(id, p === me ? { local: true, prio: PRIO_OWN } : { x: p.x, y: p.y });
    }
  }

  wantLoop(want, key, id, p, local, gain, rate) {
    const def = SOUNDS[id];
    let g = def.g * gain, pan = 0, lp = this.maxLp, wet = def.wet;
    if (!local) {
      const sp = this.sp || (this.sp = {});
      if (!this.spatial(p.x, p.y, 1, sp)) return;
      g *= sp.att * 0.85;
      pan = sp.pan;
      lp = sp.lp;
      wet *= sp.wetMul;
    }
    if (g > 0.003) want.push({ key, id, g, pan, lp, wet, rate, local });
  }

  hordeLoops(view, dt, want) {
    const zs = Array.isArray(view.zombies) ? view.zombies : [];
    const R2 = HORDE_RADIUS * HORDE_RADIUS, N2 = HORDE_NEAR * HORDE_NEAR, G2 = GROAN_RADIUS * GROAN_RADIUS;
    let count = 0, near = 0, sumDx = 0, burnW = 0, burnDx = 0;
    let pick = null, seen = 0, boss = null, bossD = Infinity;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const dx = z.x - this.lx, dy = z.y - this.ly;
      const d2 = dx * dx + dy * dy;
      if (z.type === 'boss' && d2 < bossD) {
        boss = z;
        bossD = d2;
      }
      if (d2 > R2) continue;
      count++;
      sumDx += this.lyaw === null ? dx : this.panOf(dx, dy);
      if (d2 < N2) near++;
      if (d2 < G2 && z.type !== 'boss') {
        // Reservoir sample: a uniformly random nearby zombie gets to groan.
        seen++;
        if (Math.random() * seen < 1) pick = z;
      }
      if (z.flags & 1) {
        const w = 1 - Math.sqrt(d2) / HORDE_RADIUS;
        burnW += w * 0.2;
        burnDx += (this.lyaw === null ? dx : this.panOf(dx, dy) * PAN_WIDTH / PAN_MAX) * w * 0.2;
      }
    }
    if (count > 0) {
      // Top-down: the mean offset pans; first person: the mean of the oriented pans.
      const pan = this.lyaw === null ? clamp(sumDx / count / PAN_WIDTH, -1, 1) * 0.7 : clamp(sumDx / count / PAN_MAX, -1, 1) * 0.7;
      const far = Math.min(1, Math.sqrt(count / 45));
      want.push({ key: 'hordeFar', id: 'horde_far', g: SOUNDS.horde_far.g * far, pan, lp: this.maxLp, wet: 0.4, rate: 1 });
      if (near > 0) {
        const ng = Math.min(1, Math.sqrt(near / 10));
        want.push({ key: 'hordeNear', id: 'horde_near', g: SOUNDS.horde_near.g * ng, pan: pan * 0.6, lp: this.maxLp, wet: 0.25, rate: 1 });
      }
    }
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      const rate = seen ? Math.min(3.5, 0.35 + seen * 0.05) : 0.5;
      this.groanTimer = -Math.log(1 - Math.random() * 0.95) / rate;
      if (pick) this.play(this.groanId(pick.type), { x: pick.x, y: pick.y, rate: 0.94 + Math.random() * 0.12 });
    }
    this.bossTimer -= dt;
    if (boss && this.bossTimer <= 0) {
      this.bossTimer = 4 + Math.random() * 4;
      this.play('groan_boss', { x: boss.x, y: boss.y, minGain: 0.15 });
    }
    return { count, burnW, burnDx };
  }

  hazardLoops(view, want, horde) {
    const hz = Array.isArray(view.hazards) ? view.hazards : [];
    let fw = horde.burnW, fdx = horde.burnDx, aw = 0, adx = 0;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      const dx = h.x - this.lx, dy = h.y - this.ly;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= FIRE_RADIUS) continue;
      const life = Number.isFinite(h.life) ? clamp(h.life * 5, 0, 1) : 1; // fade in the last 20 %
      const w = Math.pow(1 - d / FIRE_RADIUS, 2) * life * clamp((h.r || 80) / 100, 0.4, 1.5);
      // First person: the oriented pan expressed as an equivalent dx, so the
      // weighting and the final pan formula below stay the same in both views.
      const px = this.lyaw === null ? dx : this.panOf(dx, dy) * PAN_WIDTH / PAN_MAX;
      if (h.kind === 'acid') {
        aw += w;
        adx += px * w;
      } else {
        fw += w;
        fdx += px * w;
      }
    }
    const mf = this.mapFires;
    for (let i = 0; i < mf.length; i++) {
      const f = mf[i];
      const dx = f.x - this.lx, dy = f.y - this.ly;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= MAP_FIRE_RADIUS) continue;
      const w = Math.pow(1 - d / MAP_FIRE_RADIUS, 2) * MAP_FIRE_GAIN * clamp((f.r || 30) / 40, 0.5, 1.2);
      fw += w;
      fdx += (this.lyaw === null ? dx : this.panOf(dx, dy) * PAN_WIDTH / PAN_MAX) * w;
    }
    if (fw > 0.01) {
      want.push({ key: 'fire', id: 'fire_loop', g: SOUNDS.fire_loop.g * Math.min(1, fw), pan: clamp(fdx / fw / PAN_WIDTH, -1, 1) * 0.8, lp: this.maxLp, wet: 0.2, rate: 1 });
    }
    if (aw > 0.01) {
      want.push({ key: 'acid', id: 'acid_loop', g: SOUNDS.acid_loop.g * Math.min(1, aw), pan: clamp(adx / aw / PAN_WIDTH, -1, 1) * 0.8, lp: this.maxLp, wet: 0.15, rate: 1 });
    }
  }

  syncLoops(want, now) {
    if (want && want.length > MAX_LOOPS) {
      want.sort((a, b) => b.g - a.g);
      want.length = MAX_LOOPS;
    }
    if (want) {
      for (const w of want) {
        let L = this.loops.get(w.key);
        if (!L || L.id !== w.id) {
          if (L) this.stopLoop(L, now);
          // Over the cap (loops in their grace period count too): the quietest wanted ones wait.
          if (this.loops.size >= MAX_LOOPS) continue;
          L = this.startLoop(w, now);
          if (!L) continue;
        }
        L.seen = now;
        this.setLoop(L, w, now);
      }
    }
    for (const L of this.loops.values()) if (!want || now - L.seen > LOOP_GRACE) this.stopLoop(L, now);
  }

  startLoop(w, now) {
    const buf = this.bank.get(w.id);
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = w.lp;
    const wet = ctx.createGain();
    wet.gain.value = 0;
    src.connect(g);
    g.connect(f);
    let tail = f;
    let pan = null;
    if (this.hasPanner) {
      pan = ctx.createStereoPanner();
      f.connect(pan);
      tail = pan;
    }
    tail.connect(this.sfxDry);
    tail.connect(wet);
    wet.connect(this.sfxWet);
    src._chain = pan ? [g, f, pan, wet] : [g, f, wet];
    src.onended = disconnectChain;
    // Random start offset so two players' identical loops don't phase against each other.
    src.start(now, Math.random() * buf.duration);
    const L = { key: w.key, id: w.id, src, g, f, pan, wet, seen: now, cg: -1, cp: 9, cl: -1, cw: -1, cr: -1 };
    this.loops.set(w.key, L);
    if (w.id === 'flame_loop') this.play('flame_start', w.local ? { local: true, prio: PRIO_OWN } : { pan: w.pan, gain: w.g });
    return L;
  }

  setLoop(L, w, now) {
    // Only touch AudioParams on real changes: fewer automation events per frame.
    const tc = 0.05;
    if (Math.abs(w.g - L.cg) > 0.004) {
      L.g.gain.setTargetAtTime(w.g, now, L.cg < 0 ? 0.03 : tc);
      L.cg = w.g;
    }
    if (L.pan && Math.abs(w.pan - L.cp) > 0.02) {
      L.pan.pan.setTargetAtTime(w.pan, now, tc);
      L.cp = w.pan;
    }
    if (Math.abs(w.lp - L.cl) > 50) {
      L.f.frequency.setTargetAtTime(w.lp, now, tc);
      L.cl = w.lp;
    }
    if (Math.abs(w.wet - L.cw) > 0.02) {
      L.wet.gain.setTargetAtTime(w.wet, now, tc);
      L.cw = w.wet;
    }
    if (Math.abs(w.rate - L.cr) > 0.01) {
      L.src.playbackRate.setTargetAtTime(w.rate, now, 0.08);
      L.cr = w.rate;
    }
  }

  stopLoop(L, now) {
    this.loops.delete(L.key);
    L.g.gain.cancelScheduledValues(now);
    L.g.gain.setTargetAtTime(0, now, 0.04);
    try {
      L.src.stop(now + 0.3);
    } catch {
      // Already stopped.
    }
  }

  heartbeat(me, dt) {
    if (!me || me.state === 'dead' || !(me.maxHp > 0)) {
      this.hbTimer = 0;
      return;
    }
    let interval = 0, gain = 0;
    if (me.state === 'downed') {
      // Slows as the bleedout runs out.
      const b = clamp((me.bleedout || 0) / BLEEDOUT_TIME, 0, 1);
      interval = lerp(1.6, 0.8, b);
      gain = 0.9;
    } else {
      const r = me.hp / me.maxHp;
      if (r >= LOW_HP || r <= 0) {
        this.hbTimer = 0;
        return;
      }
      interval = lerp(0.5, 0.95, r / LOW_HP);
      gain = lerp(1, 0.55, r / LOW_HP);
    }
    this.hbTimer -= dt;
    if (this.hbTimer <= 0) {
      this.hbTimer = interval;
      this.play('heartbeat', { local: true, gain, lim: null });
    }
  }

  setMuffle(me, now) {
    let f = this.maxLp;
    // Downed: the world goes dull and distant; low hp: it starts closing in.
    if (me && me.state === 'downed') f = this.maxLp * 0.055;
    else if (me && me.state === 'alive' && me.maxHp > 0 && me.hp / me.maxHp < LOW_HP) f = this.maxLp * lerp(0.2, 0.6, me.hp / me.maxHp / LOW_HP);
    if (Math.abs(f - this.muffleTarget) > 100) {
      this.muffleTarget = f;
      this.muffle.frequency.setTargetAtTime(f, now, 0.25);
    }
  }

  setMusic(view, me, nearby) {
    const phase = view.phase;
    if (phase === 'gameover' || phase === 'victory') {
      this.musicMode = phase;
      this.musicTarget = 0;
      this.musicBoss = false;
      return;
    }
    this.musicMode = 'game';
    this.musicBoss = Number.isFinite(view.bossHp) && view.bossHp >= 0;
    if (phase === 'wave') {
      let t = 0.35 + 0.45 * Math.min(1, nearby / 40);
      if (me && me.state === 'downed') t -= 0.1;
      if (this.musicBoss) t = Math.max(t, 0.9);
      this.musicTarget = t;
    } else {
      // Prep/intermission: calm, with a little anticipation in the final seconds.
      this.musicTarget = view.timer > 0 && view.timer < 6 ? 0.28 : 0.12;
    }
  }

  musicTick() {
    if (!this.ready || !this.music) return;
    if (!this.offline && this.ctx.state !== 'running') return;
    // No snapshots for a while: we're in the menus/lobby.
    if (!this.manual && Date.now() - this.lastUpdateWall > 1500) {
      this.musicMode = 'menu';
      this.musicTarget = 0.08;
      this.musicBoss = false;
      if (this.loops.size) this.syncLoops(null, this.now());
    }
    this.music.set(this.musicTarget, this.musicBoss, this.musicMode);
    this.music.tick(this.now());
  }

  setMap(map) {
    const fires = map && Array.isArray(map.fires) ? map.fires : [];
    this.mapFires = fires.filter((f) => f && Number.isFinite(f.x) && Number.isFinite(f.y));
  }

  stats() {
    const bank = this.bank ? this.bank.progress() : { done: 0, total: 0 };
    return {
      state: this.ctx ? this.ctx.state : 'locked',
      voices: this.activeVoices(),
      maxVoices: MAX_VOICES,
      loops: this.loops.size,
      ...this.counters,
      baked: bank.done,
      total: bank.total,
      music: this.music ? Math.round(this.music.intensity * 100) / 100 : 0,
      musicMode: this.musicMode,
    };
  }
}

/**
 * Create the game's audio engine. Nothing happens (and nothing throws) until unlock()
 * is called from a user gesture; every method is a silent no-op before that or when
 * WebAudio is unavailable.
 *
 * @param {object} [options]  testing/offline hooks: { context: BaseAudioContext to render
 *   into, clock: () => seconds used for scheduling, manual: drive music from update(),
 *   syncBake: bake the bank synchronously, destination: AudioNode to connect to,
 *   dynamics: false to bypass compressor/limiter (level measurements only) }
 */
export function createAudio(options = {}) {
  const eng = new Engine(options);
  const safe = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      eng.fault(err);
      return undefined;
    }
  };
  return {
    /** Create/resume the AudioContext. Call on user gestures; safe to call repeatedly. */
    unlock() {
      try {
        return eng.unlock().catch(() => false);
      } catch (err) {
        eng.fault(err);
        return Promise.resolve(false);
      }
    },
    /**
     * Play GameEvents (§4.1) heard from { x, y } (listener: the camera centre) as player
     * `localId`; with `yaw` (first person) sounds pan relative to the facing direction.
     */
    addEvents: safe((events, opts) => eng.addEvents(events, opts)),
    /** Per-frame: loops (minigun, flamethrower, horde, fire), heartbeat, muffle, music. opts: { localId, dt, x?, y?, yaw? } */
    update: safe((view, opts) => eng.update(view, opts)),
    /** Interface sounds: 'click'|'hover'|'buy'|'deny'|'chat'|'join'|'leave'|'wave'|'waveclear'|'gameover'|'victory'|'countdown'|'ready'. */
    ui: safe((name) => eng.ui(name)),
    /** Volumes 0..1 (any subset of master, sfx, music). Kept across unlock. */
    setVolume: safe((v) => eng.setVolume(v)),
    setMuted: safe((m) => eng.setMuted(m)),
    /** The running game's MapDef (null between games): its permanent fires crackle nearby. */
    setMap: safe((map) => eng.setMap(map)),
    /** Diagnostics: context state, active voices, loops, drop/steal counters, bake progress. */
    stats: () => {
      try {
        return eng.stats();
      } catch {
        return { state: 'error', voices: 0, maxVoices: MAX_VOICES, loops: 0 };
      }
    },
    /** Dev hooks (audio sandbox). */
    debug: {
      play: safe((id, o) => eng.play(id, o || { local: true })),
      soundIds: () => SOUND_IDS.slice(),
      category: (id) => (SOUNDS[id] ? SOUNDS[id].cat : null),
      get engine() {
        return eng;
      },
    },
  };
}
