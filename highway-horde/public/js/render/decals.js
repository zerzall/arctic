// Persistent ground marks: blood, scorch, acid stains and corpses. Fresh corpses stay
// live sprites (crisp, drawn every frame) for a while, then get baked into a chunked
// decal canvas. Chunks are allocated only where something was stamped, are capped in
// number (least recently used chunk is dropped), and slowly fade so old carnage clears.

import { makeCanvas, releaseCanvas } from './util.js';

const CHUNK = 512;

/**
 * @param {number} mapW
 * @param {number} mapH
 * @param {{scale:number, maxChunks:number, maxCorpses:number, corpseLife:number}} opts
 */
export function createDecals(mapW, mapH, opts) {
  const cols = Math.ceil(mapW / CHUNK), rows = Math.ceil(mapH / CHUNK);
  const scale = opts.scale;
  const chunks = new Array(cols * rows).fill(null);
  let live = 0;
  let stampClock = 0;
  let fadeCursor = 0;
  let fadeTimer = 0;

  // Live corpses: fixed ring of records, no per-death allocation after warm-up.
  const corpses = [];
  const maxCorpses = opts.maxCorpses;

  function chunkAt(c, r, create) {
    const i = r * cols + c;
    let ch = chunks[i];
    if (!ch && create) {
      if (live >= opts.maxChunks) evictOldest();
      const px = Math.ceil(CHUNK * scale);
      const canvas = makeCanvas(px, px);
      ch = { canvas, g: canvas.getContext('2d'), c, r, used: 0, dirty: 0 };
      chunks[i] = ch;
      live++;
    }
    return ch;
  }

  function evictOldest() {
    let bi = -1, bu = Infinity;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      if (ch && ch.used < bu) { bu = ch.used; bi = i; }
    }
    if (bi >= 0) {
      releaseCanvas(chunks[bi].canvas);
      chunks[bi] = null;
      live--;
    }
  }

  /**
   * Stamp an image centred at (x, y) world, rotated, `size` world px across.
   * The image is drawn into every chunk it overlaps.
   */
  function stamp(img, x, y, angle, size, alpha = 1, sizeY = size) {
    const ext = Math.max(size, sizeY) * 0.75;
    if (x + ext < 0 || y + ext < 0 || x - ext > mapW || y - ext > mapH) return;
    const c0 = Math.max(0, Math.floor((x - ext) / CHUNK)), c1 = Math.min(cols - 1, Math.floor((x + ext) / CHUNK));
    const r0 = Math.max(0, Math.floor((y - ext) / CHUNK)), r1 = Math.min(rows - 1, Math.floor((y + ext) / CHUNK));
    stampClock++;
    const cs = Math.cos(angle) * scale, sn = Math.sin(angle) * scale;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = chunkAt(c, r, true);
        const g = ch.g;
        g.globalAlpha = alpha;
        g.setTransform(cs, sn, -sn, cs, (x - c * CHUNK) * scale, (y - r * CHUNK) * scale);
        g.drawImage(img, -size / 2, -sizeY / 2, size, sizeY);
        ch.used = stampClock;
        ch.dirty = 1;
      }
    }
  }

  return {
    stamp,
    /** Add a crisp corpse sprite; the oldest are baked into the decal layer. */
    addCorpse(img, x, y, angle, size, time) {
      let rec;
      if (corpses.length >= maxCorpses) {
        rec = corpses.shift();
        stamp(rec.img, rec.x, rec.y, rec.angle, rec.size, 0.92);
      } else {
        rec = {};
      }
      rec.img = img; rec.x = x; rec.y = y; rec.angle = angle; rec.size = size; rec.t = time;
      corpses.push(rec);
    },
    update(dt, time) {
      // bake corpses older than corpseLife
      while (corpses.length && time - corpses[0].t > opts.corpseLife) {
        const rec = corpses.shift();
        stamp(rec.img, rec.x, rec.y, rec.angle, rec.size, 0.92);
      }
      // fade one dirty chunk every little while (round robin)
      fadeTimer += dt;
      const step = 3 / Math.max(1, live);
      while (fadeTimer > step && live) {
        fadeTimer -= step;
        for (let k = 0; k < chunks.length; k++) {
          fadeCursor = (fadeCursor + 1) % chunks.length;
          const ch = chunks[fadeCursor];
          if (!ch || !ch.dirty) continue;
          const g = ch.g;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'destination-out';
          g.fillStyle = 'rgba(0,0,0,0.045)';
          g.fillRect(0, 0, ch.canvas.width, ch.canvas.height);
          g.globalCompositeOperation = 'source-over';
          // after ~5 minutes without new stamps the chunk is effectively clean
          if (stampClock - ch.used > 4000) ch.dirty = 0;
          break;
        }
      }
    },
    drawLayer(ctx, x0, y0, x1, y1) {
      const c0 = Math.max(0, Math.floor(x0 / CHUNK)), c1 = Math.min(cols - 1, Math.floor(x1 / CHUNK));
      const r0 = Math.max(0, Math.floor(y0 / CHUNK)), r1 = Math.min(rows - 1, Math.floor(y1 / CHUNK));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = chunks[r * cols + c];
          if (ch) ctx.drawImage(ch.canvas, c * CHUNK, r * CHUNK, CHUNK, CHUNK);
        }
      }
    },
    /** Live corpses, with world transform already set on ctx. */
    drawCorpses(ctx, x0, y0, x1, y1, time) {
      for (let i = 0; i < corpses.length; i++) {
        const c = corpses[i];
        if (c.x + c.size < x0 || c.x - c.size > x1 || c.y + c.size < y0 || c.y - c.size > y1) continue;
        const age = time - c.t;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        // settle: the body slumps into place over the first 150 ms
        const k = age < 0.15 ? 0.85 + age : 1;
        ctx.globalAlpha = Math.min(1, 0.4 + age * 6);
        ctx.drawImage(c.img, -c.size / 2 * k, -c.size / 2 * k, c.size * k, c.size * k);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    get corpseCount() { return corpses.length; },
    get chunkCount() { return live; },
    clear() {
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i]) releaseCanvas(chunks[i].canvas);
        chunks[i] = null;
      }
      live = 0;
      corpses.length = 0;
    },
    destroy() {
      this.clear();
    },
  };
}
