// particles.js - pooled particles and floating text for Blast Party's effects (docs/SPEC.md section 8.2).
//
// One fixed pool of struct-of-arrays slots (POOL_SIZE = 400 by spec; 200 at quality 1, 60 at quality 0 or with reduced
// effects, see setCap). Emitting never allocates: a free slot is taken from a round-robin cursor and, when the pool is full,
// the oldest slot in cursor order is recycled, so a chain reaction degrades to "fewer sparks" instead of to garbage.
//
// Units: positions are tile units on the ground plane (x, y) plus a height z in tiles (the screen y is (y - z) * tile);
// velocities are tiles per second, life is seconds and sizes are multipliers of the sprite's natural size, so the whole system
// is independent of the pixel layout. The Renderer converts with the tile size of the sprite set it draws with.
//
// Drawing is deliberately plain: axis-aligned drawImage only. Measured in Chromium, a rotated draw (save, transform, restore) costs
// 20 to 100 times a plain one and scaled draws several times, so particles never rotate (variants and the flip of confetti stand
// in for it) and the most numerous ones (sparks, embers, glows) are drawn at their natural size or close to it.
// The only DOM-free dependency is a sprite set (bind()); drawing uses plain 2D context calls, so the module loads in Node.

import { ITEM_KINDS } from '../../shared/constants.js';

export const POOL_SIZE = 400;
const TAU = Math.PI * 2;

/** Particle kinds. The sprite behind a kind (and its `variant`) is bound by ParticleSystem.bind(set). */
export const KIND = Object.freeze({
  SPARK: 0, SMOKE: 1, DARK_SMOKE: 2, DUST: 3, DEBRIS: 4, CONFETTI: 5, EMBER: 6, STAR: 7,
  GLOW_WARM: 8, GLOW_COOL: 9, ITEM_GLOW: 10, DOT: 11, SKULL: 12, RING: 13, TWINKLE: 14,
});
const KIND_COUNT = 15;

// How many variants each kind has (a variant picks a smoke puff, a confetti colour, an item kind, a ring colour, ...).
const VARIANTS = [1, 3, 3, 2, 4, 6, 1, 1, 1, 1, ITEM_KINDS.length, 1, 1, 4, 1];
// Kinds drawn with the additive ('lighter') composite. Glows disappear without it (quality 0); the others fall back to plain alpha.
const ADDITIVE = new Uint8Array([1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0]);
const GLOW_ONLY = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]);

/** Ring colours by variant (a ring is stroked, not a sprite): white, fire, ice, curse. */
const RING_COLORS = ['#ffffff', '#ffc65a', '#8fe3ff', '#c98bff'];
export const RING = Object.freeze({ WHITE: 0, FIRE: 1, ICE: 2, CURSE: 3 });

// Flag bits
const AMBIENT = 1;     // wraps around the ambient bounds instead of dying
const EASE_OUT = 2;    // size follows an ease-out curve (smoke puffs swell quickly, then slowly)
const FLUTTER = 4;     // confetti: the sprite narrows and widens as if it tumbled while it falls
const TWINKLE = 8;     // alpha shimmers
const BOUNCE = 16;     // bounces on the ground plane (debris), otherwise it stops on it

const NEVER = 1e9;

export class ParticleSystem {
  /**
   * @param {{ size?: number, random?: () => number }} [opts] `random` is injectable for tests; effects are cosmetic, so the default is Math.random.
   */
  constructor({ size = POOL_SIZE, random = Math.random } = {}) {
    this.size = size;
    this.cap = size;
    this.rand = random;
    this.cursor = 0;
    this.live = 0;
    this.x = new Float32Array(size); this.y = new Float32Array(size); this.z = new Float32Array(size);
    this.vx = new Float32Array(size); this.vy = new Float32Array(size); this.vz = new Float32Array(size);
    this.gravity = new Float32Array(size); this.drag = new Float32Array(size);
    this.phase = new Float32Array(size);   // random offset of the shimmer and flutter
    this.s0 = new Float32Array(size); this.s1 = new Float32Array(size);
    this.a0 = new Float32Array(size); this.fin = new Float32Array(size); this.fout = new Float32Array(size);
    this.age = new Float32Array(size); this.life = new Float32Array(size);
    this.kind = new Uint8Array(size); this.variant = new Uint8Array(size); this.flags = new Uint8Array(size);
    this.table = new Array(KIND_COUNT).fill(null);   // kind -> sprites, filled by bind()
    this.ambient = { x0: 0, y0: 0, x1: 0, y1: 0, count: 0 };
  }

  /** Point every kind at the sprites of `set` (call again after the set changes; live particles keep their variant). */
  bind(set) {
    const fx = set.fx, t = this.table;
    t[KIND.SPARK] = [fx.spark];
    t[KIND.SMOKE] = fx.smoke;
    t[KIND.DARK_SMOKE] = fx.darkSmoke;
    t[KIND.DUST] = set.dust;
    t[KIND.DEBRIS] = set.debris;
    t[KIND.CONFETTI] = fx.confetti;
    t[KIND.EMBER] = [fx.ember];
    t[KIND.STAR] = [fx.star];
    t[KIND.GLOW_WARM] = [fx.glowWarm];
    t[KIND.GLOW_COOL] = [fx.glowCool];
    t[KIND.ITEM_GLOW] = ITEM_KINDS.map((kind) => set.itemGlow(kind));
    t[KIND.DOT] = [fx.dot];
    t[KIND.SKULL] = [fx.skull];
    t[KIND.RING] = RING_COLORS;
    t[KIND.TWINKLE] = [fx.twinkle];
  }

  /** Limit the number of live particles (quality and reduced effects). Particles beyond the new cap vanish at once. */
  setCap(n) {
    this.cap = Math.max(0, Math.min(this.size, n | 0));
    for (let i = this.cap; i < this.size; i++) this.life[i] = 0;
    if (this.cursor >= this.cap) this.cursor = 0;
  }

  clear() {
    this.life.fill(0);
    this.live = 0;
    this.cursor = 0;
    this.ambient.count = 0;
  }

  /**
   * Take a slot for a new particle (recycling the oldest one when the pool is full) and reset it to neutral values.
   * Returns the slot index, or -1 when the cap is 0. The caller then sets position, velocity, size and life.
   */
  spawn(kind, variant = 0) {
    if (this.cap === 0) return -1;
    const n = this.cap;
    let i = this.cursor;
    for (let tries = 0; tries < n && this.life[i] > 0; tries++) i = i + 1 >= n ? 0 : i + 1;   // a free slot near the cursor, else recycle the cursor's
    this.cursor = i + 1 >= n ? 0 : i + 1;
    this.kind[i] = kind;
    this.variant[i] = variant % VARIANTS[kind];
    this.flags[i] = 0;
    this.x[i] = this.y[i] = this.z[i] = 0;
    this.vx[i] = this.vy[i] = this.vz[i] = 0;
    this.gravity[i] = this.drag[i] = 0;
    this.phase[i] = 0;
    this.s0[i] = this.s1[i] = 1;
    this.a0[i] = 1; this.fin[i] = 0; this.fout[i] = 0.35;
    this.age[i] = 0; this.life[i] = 1;
    return i;
  }

  /** Common per-particle setup: where, how fast, how long and how big. */
  place(i, x, y, z, vx, vy, vz, life, s0, s1 = s0) {
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    return i;
  }

  update(dt) {
    const { x, y, z, vx, vy, vz, gravity, drag, age, life, flags } = this;
    const amb = this.ambient;
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      if (age[i] >= life[i]) { life[i] = 0; continue; }
      live++;
      const f = flags[i];
      if (drag[i] > 0) { const k = Math.max(0, 1 - drag[i] * dt); vx[i] *= k; vy[i] *= k; vz[i] *= k; }
      vz[i] -= gravity[i] * dt;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
      if (z[i] < 0 && gravity[i] > 0) {   // landed
        z[i] = 0;
        if (f & BOUNCE && vz[i] < -0.8) { vz[i] = -vz[i] * 0.38; vx[i] *= 0.6; vy[i] *= 0.6; }
        else { vz[i] = 0; vx[i] *= 0.5; vy[i] *= 0.5; }
      }
      if (f & AMBIENT) {
        if (x[i] < amb.x0) x[i] += amb.x1 - amb.x0; else if (x[i] > amb.x1) x[i] -= amb.x1 - amb.x0;
        if (y[i] < amb.y0) y[i] += amb.y1 - amb.y0; else if (y[i] > amb.y1) y[i] -= amb.y1 - amb.y0;
      }
    }
    this.live = live;
  }

  /**
   * Draw one blend pass. `additive` false draws normally blended particles, true the glowing ones ('lighter' composite,
   * or plain alpha when `glow` is false: quality 0 keeps sparks and embers but drops the pure glow sprites).
   * `T` is the tile size in the pixels of the context's current transform.
   */
  draw(ctx, T, additive, glow = true) {
    if (this.live === 0) return;
    const { kind, life } = this;
    const lighter = additive && glow;
    if (lighter) ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      const k = kind[i];
      // Which pass a kind belongs to: glowing kinds are additive when glow is on; without glow the pure light sprites vanish
      // and the sparks/embers fall back to the normal pass.
      if (ADDITIVE[k] === 1) {
        if (glow ? !additive : additive || GLOW_ONLY[k] === 1) continue;
      } else if (additive) continue;
      this.drawOne(ctx, T, i);
    }
    if (lighter) ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Draw slot `i` (alpha and size come from the particle's age). */
  drawOne(ctx, T, i) {
    const u = this.age[i] / this.life[i], f = this.flags[i], k = this.kind[i];
    let a = this.a0[i];
    if (this.fin[i] > 0 && u < this.fin[i]) a *= u / this.fin[i];
    if (this.fout[i] > 0 && u > 1 - this.fout[i]) a *= (1 - u) / this.fout[i];
    if (f & TWINKLE) a *= 0.55 + 0.45 * Math.sin(this.age[i] * 2.4 + this.phase[i]);
    if (a <= 0.01) return;
    const e = f & EASE_OUT ? 1 - (1 - u) * (1 - u) : u;
    const s = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
    const px = this.x[i] * T, py = (this.y[i] - this.z[i]) * T;
    ctx.globalAlpha = a > 1 ? 1 : a;
    if (k === KIND.RING) {
      ctx.beginPath();
      ctx.arc(px, py, s * T, 0, TAU);
      ctx.lineWidth = Math.max(1, T * 0.09 * (1 - u));
      ctx.strokeStyle = RING_COLORS[this.variant[i]];
      ctx.stroke();
      return;
    }
    const sp = this.table[k]?.[this.variant[i]];
    if (!sp) return;
    const sx = f & FLUTTER ? s * (0.25 + 0.75 * Math.abs(Math.cos(this.age[i] * 9 + this.phase[i]))) : s;
    ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, px - sp.ax * sx, py - sp.ay * s, sp.w * sx, sp.h * s);
  }

  // ---- Recipes ---------------------------------------------------------------------------------------------
  // Each recipe emits a handful of particles; the Renderer composes them per event. `n` counts are upper bounds:
  // a full pool recycles, and the Renderer trims n by quality before calling.

  /** Bright sparks flying out of (x, y) in every direction, falling back down. */
  sparks(x, y, z, n, speed, life = 0.5, size = 0.7) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.SPARK); if (i < 0) return;
      const a = this.rand() * TAU, v = speed * (0.35 + 0.65 * this.rand());
      this.place(i, x, y, z, Math.cos(a) * v, Math.sin(a) * v * 0.8, 0.6 + this.rand() * 1.8, life * (0.6 + 0.6 * this.rand()), size, size * 0.3);
      this.gravity[i] = 5; this.drag[i] = 1.2; this.fout[i] = 0.6;
    }
  }

  /** A stream of fast sparks along one axis (a flame arm), `dx, dy` unit direction. */
  streak(x, y, dx, dy, n, speed, life = 0.4) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.SPARK); if (i < 0) return;
      const v = speed * (0.5 + 0.5 * this.rand()), side = (this.rand() - 0.5) * 0.5;
      this.place(i, x + dx * this.rand() * 0.4, y + dy * this.rand() * 0.4, 0.15, dx * v - dy * side, dy * v + dx * side, 0.4 + this.rand() * 0.9, life * (0.6 + 0.6 * this.rand()), 0.55, 0.15);
      this.gravity[i] = 3; this.drag[i] = 2; this.fout[i] = 0.7;
    }
  }

  /** Rising smoke puffs. `dark` = explosion smoke, else a light poof. */
  smoke(x, y, z, n, dark = false, size = 0.5, life = 1.1, spread = 0.35) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(dark ? KIND.DARK_SMOKE : KIND.SMOKE, (this.rand() * 3) | 0); if (i < 0) return;
      const a = this.rand() * TAU, r = spread * this.rand();
      this.place(i, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, z, Math.cos(a) * 0.12, Math.sin(a) * 0.08, 0.35 + this.rand() * 0.45, life * (0.7 + 0.6 * this.rand()), size * 0.55, size * (1 + 0.5 * this.rand()));
      this.flags[i] = EASE_OUT;
      this.a0[i] = dark ? 0.62 : 0.85; this.fin[i] = 0.12; this.fout[i] = 0.55; this.drag[i] = 0.6;
    }
  }

  /** Small theme-coloured dust puffs low over the floor (footsteps, landings, falling walls). */
  dust(x, y, n, size = 0.28, spread = 0.3, rise = 0.25) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.DUST, (this.rand() * 2) | 0); if (i < 0) return;
      const a = this.rand() * TAU, v = 0.25 + 0.5 * this.rand();
      this.place(i, x + Math.cos(a) * spread * 0.4, y + Math.sin(a) * spread * 0.3, 0.05, Math.cos(a) * v * spread * 2, Math.sin(a) * v * spread * 1.4, rise * (0.5 + this.rand()), 0.45 + this.rand() * 0.25, size * 0.6, size * 1.3);
      this.flags[i] = EASE_OUT;
      this.a0[i] = 0.7; this.fin[i] = 0.1; this.fout[i] = 0.7; this.drag[i] = 2.2;
    }
  }

  /** Chunks of a broken block, thrown up and bouncing on the floor. */
  debris(x, y, n, speed = 2.6) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.DEBRIS, (this.rand() * 4) | 0); if (i < 0) return;
      const a = this.rand() * TAU, v = speed * (0.4 + 0.6 * this.rand());
      this.place(i, x, y, 0.25, Math.cos(a) * v, Math.sin(a) * v * 0.7, 2.4 + this.rand() * 2.6, 0.9 + this.rand() * 0.5, 0.6 + this.rand() * 0.35, 0.45);
      this.flags[i] = BOUNCE;
      this.gravity[i] = 13; this.drag[i] = 0.3; this.fout[i] = 0.4;
    }
  }

  /** Confetti raining down (round win, fountains). `up` pushes it into the air first. */
  confetti(x, y, z, n, spread = 3, up = 5) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.CONFETTI, (this.rand() * 6) | 0); if (i < 0) return;
      const a = this.rand() * TAU, v = spread * (0.2 + 0.8 * this.rand());
      this.place(i, x, y, z, Math.cos(a) * v, Math.sin(a) * v * 0.6, up * (0.5 + 0.7 * this.rand()), 1.7 + this.rand() * 1.1, 0.95, 0.95);
      this.flags[i] = FLUTTER; this.phase[i] = this.rand() * TAU;
      this.gravity[i] = 7; this.drag[i] = 1.9; this.fout[i] = 0.3;
    }
  }

  /** Embers drifting up out of a fire. */
  embers(x, y, n, spread = 0.4, rise = 1.4) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.EMBER); if (i < 0) return;
      const a = this.rand() * TAU, r = spread * this.rand();
      this.place(i, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, 0.2, (this.rand() - 0.5) * 0.7, (this.rand() - 0.5) * 0.3, rise * (0.5 + this.rand()), 0.8 + this.rand() * 0.9, 0.55, 0.12);
      this.drag[i] = 0.5; this.fin[i] = 0.1; this.fout[i] = 0.5; this.flags[i] = TWINKLE; this.phase[i] = this.rand() * TAU;
    }
  }

  /** A burst of gold stars (a defeated blastie, a level-up feel). */
  stars(x, y, z, n, speed = 2.2) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.STAR); if (i < 0) return;
      const a = this.rand() * TAU, v = speed * (0.5 + 0.5 * this.rand());
      this.place(i, x, y, z, Math.cos(a) * v, Math.sin(a) * v * 0.6, 1.5 + this.rand() * 1.8, 0.7 + this.rand() * 0.3, 0.45, 0.15);
            this.gravity[i] = 6; this.drag[i] = 1.6; this.fout[i] = 0.5;
    }
  }

  /** A soft glowing disc that swells and fades: the flash at the heart of an explosion, a pop of light. */
  glow(x, y, z, size, life, cool = false, alpha = 1) {
    const i = this.spawn(cool ? KIND.GLOW_COOL : KIND.GLOW_WARM); if (i < 0) return;
    this.place(i, x, y, z, 0, 0, 0, life, size * 0.5, size);
    this.flags[i] = EASE_OUT; this.a0[i] = alpha; this.fin[i] = 0.08; this.fout[i] = 0.8;
  }

  /** A stroked shock ring growing from radius r0 to r1 (tiles). */
  ring(x, y, z, r0, r1, life, color = RING.WHITE, alpha = 0.9) {
    const i = this.spawn(KIND.RING, color); if (i < 0) return;
    this.place(i, x, y, z, 0, 0, 0, life, r0, r1);
    this.flags[i] = EASE_OUT; this.a0[i] = alpha; this.fout[i] = 0.7;
  }

  /** Little coloured lights flying out of an item pickup. `kindIndex` = index into ITEM_KINDS. */
  sparkle(x, y, z, n, kindIndex, speed = 1.8) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.ITEM_GLOW, kindIndex); if (i < 0) return;
      const a = this.rand() * TAU, v = speed * (0.4 + 0.6 * this.rand());
      this.place(i, x, y, z, Math.cos(a) * v, Math.sin(a) * v * 0.7, 0.8 + this.rand() * 1.6, 0.5 + this.rand() * 0.4, 0.22, 0.05);
      this.gravity[i] = 2.5; this.drag[i] = 1.4; this.fout[i] = 0.6;
    }
  }

  /** One twinkling glint that rises off an item (idle sparkle). */
  glint(x, y, z) {
    const i = this.spawn(KIND.TWINKLE); if (i < 0) return;
    this.place(i, x, y, z, 0, 0, 0.35, 0.7, 0.3, 0.55);
    this.a0[i] = 1; this.fin[i] = 0.25; this.fout[i] = 0.5;
  }

  /** Purple skulls floating up from a cursed fighter (or flying from giver to receiver when `toX` is given). */
  skulls(x, y, n, toX = NaN, toY = NaN) {
    for (let j = 0; j < n; j++) {
      const i = this.spawn(KIND.SKULL); if (i < 0) return;
      const a = this.rand() * TAU;
      if (Number.isNaN(toX)) {
        this.place(i, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.15, 0.4, 0, 0, 0.8 + this.rand() * 0.6, 1 + this.rand() * 0.5, 0.36, 0.5);
      } else {   // a curse hopping to a neighbour
        const t = 0.35, dxv = (toX - x) / t, dyv = (toY - y) / t;
        this.place(i, x, y, 0.5, dxv + (this.rand() - 0.5) * 1.2, dyv + (this.rand() - 0.5) * 1.2, 0.5 + this.rand(), t + 0.15, 0.42, 0.3);
        this.drag[i] = 1.2;
      }
      this.a0[i] = 0.95; this.fin[i] = 0.15; this.fout[i] = 0.45;
    }
  }

  /** A single tiny spark at a lit fuse (bomb pulse phase decides how often the Renderer calls this). */
  fuseSpark(x, y, z) {
    const i = this.spawn(KIND.SPARK); if (i < 0) return;
    const a = this.rand() * TAU, v = 0.5 + this.rand() * 0.9;
    this.place(i, x, y, z, Math.cos(a) * v * 0.6, Math.sin(a) * v * 0.3, 0.8 + this.rand() * 1.2, 0.28 + this.rand() * 0.2, 0.4, 0.1);
    this.gravity[i] = 4; this.drag[i] = 1; this.fout[i] = 0.7;
  }

  // ---- Ambient decoration ----------------------------------------------------------------------------------

  /**
   * Fill the pool with `count` slow decorative particles that wrap around the box [x0, x1] x [y0, y1] (tile units, the whole canvas).
   * `kind` is a THEME_PALETTES ambient kind: pollen, snow, embers, sprinkles or stars. Replaces any earlier ambient particles.
   */
  setAmbient(kind, count, x0, y0, x1, y1) {
    const amb = this.ambient;
    for (let i = 0; i < this.size; i++) if (this.flags[i] & AMBIENT) this.life[i] = 0;
    amb.x0 = x0; amb.y0 = y0; amb.x1 = x1; amb.y1 = y1; amb.count = 0;
    if (count <= 0) return;
    for (let j = 0; j < count; j++) {
      const w = x1 - x0, h = y1 - y0;
      const px = x0 + this.rand() * w, py = y0 + this.rand() * h;
      const r = this.rand();
      let i;
      if (kind === 'snow') {
        i = this.spawn(KIND.DOT); if (i < 0) return;
        this.place(i, px, py, 0, (this.rand() - 0.5) * 0.35, 0.28 + r * 0.4, 0, NEVER, 0.1 + r * 0.14); this.a0[i] = 0.75;
      } else if (kind === 'embers') {
        i = this.spawn(KIND.EMBER); if (i < 0) return;
        this.place(i, px, py, 0, (this.rand() - 0.5) * 0.35, -(0.3 + r * 0.55), 0, NEVER, 0.16 + r * 0.22); this.a0[i] = 0.85; this.flags[i] = TWINKLE;
      } else if (kind === 'sprinkles') {
        i = this.spawn(KIND.CONFETTI, (this.rand() * 6) | 0); if (i < 0) return;
        this.place(i, px, py, 0, (this.rand() - 0.5) * 0.3, 0.2 + r * 0.3, 0, NEVER, 0.8); this.a0[i] = 0.85;
      } else if (kind === 'stars') {
        i = this.spawn(KIND.TWINKLE); if (i < 0) return;
        this.place(i, px, py, 0, (this.rand() - 0.5) * 0.06, (this.rand() - 0.5) * 0.06, 0, NEVER, 0.25 + r * 0.45); this.flags[i] = TWINKLE;
      } else {   // pollen
        i = this.spawn(KIND.DOT); if (i < 0) return;
        this.place(i, px, py, 0, (this.rand() - 0.5) * 0.3, -(0.06 + r * 0.16), 0, NEVER, 0.07 + r * 0.1); this.a0[i] = 0.6;
      }
      this.phase[i] = this.rand() * TAU;
      this.fin[i] = 0; this.fout[i] = 0;
      this.age[i] = 0;
      this.flags[i] |= AMBIENT;
      amb.count++;
    }
  }
}

// ---- Floating text ("+1", "KICK!", curse names) ---------------------------------------------------------------

const TEXT_MAX = 12;

/** A few short-lived text labels that rise and fade. Text is the one thing that is cheaper to draw live than to bake. */
export class FloatingText {
  constructor(max = TEXT_MAX) {
    this.max = max;
    this.text = new Array(max).fill('');
    this.color = new Array(max).fill('#fff');
    this.x = new Float32Array(max); this.y = new Float32Array(max);
    this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.cursor = 0;
    this.fonts = new Map();
  }

  /** Show `text` at ground position (x, y) tiles; `size` is the text height in tiles. The oldest label is recycled when all are busy. */
  add(text, x, y, color, size = 0.42, life = 1.1) {
    let i = this.cursor;
    for (let tries = 0; tries < this.max && this.life[i] > 0; tries++) i = i + 1 >= this.max ? 0 : i + 1;
    this.cursor = i + 1 >= this.max ? 0 : i + 1;
    this.text[i] = text; this.color[i] = color;
    this.x[i] = x; this.y[i] = y; this.age[i] = 0; this.life[i] = life; this.size[i] = size;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.life[i] = 0;
    }
  }

  clear() { this.life.fill(0); }

  /** Font strings by pixel size (the cache keeps text drawing free of per-frame string building). */
  fontFor(px, family) {
    let f = this.fonts.get(px);
    if (f === undefined) { f = `900 ${px}px ${family}`; this.fonts.set(px, f); }
    return f;
  }

  get count() {
    let n = 0;
    for (let i = 0; i < this.max; i++) if (this.life[i] > 0) n++;
    return n;
  }

  /** `family` is a CSS font-family list; sizes are scaled by the tile size `T` of the context's transform. */
  draw(ctx, T, family) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      if (!any) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; any = true; }
      const u = this.age[i] / this.life[i];
      const pop = u < 0.15 ? 0.6 + (u / 0.15) * 0.55 : u < 0.28 ? 1.15 - ((u - 0.15) / 0.13) * 0.15 : 1;
      const px = this.x[i] * T, py = Math.max(0.35, this.y[i] - 1.35 - u * 0.5) * T;   // above the name tag, and never off the top of the arena
      ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      ctx.font = this.fontFor(Math.max(9, Math.round(this.size[i] * T * pop)), family);
      ctx.lineWidth = Math.max(2, this.size[i] * T * 0.22);
      ctx.strokeStyle = 'rgba(27,16,51,0.9)';
      ctx.strokeText(this.text[i], px, py);
      ctx.fillStyle = this.color[i];
      ctx.fillText(this.text[i], px, py);
    }
    ctx.globalAlpha = 1;
  }
}
