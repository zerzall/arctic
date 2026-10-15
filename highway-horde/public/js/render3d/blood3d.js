// Blood on surfaces (EFFECTS, SPEC §7.5): decal placement on top of fx-decals.js. A bullet
// that goes through a zombie leaves an exit-wound spray on whatever is behind it (a wall, a
// car, a barrier, or the ground), splats on the surface it hits, runs down walls in drips,
// pools under corpses (the pool spreads and then dries), and wounded zombies and bloody
// players leave footprints and drips as they move. Everything is a decal in the fixed ring
// buffers (nothing allocates; old blood is recycled), coloured by the gore setting.

import { DC, DK } from './fx-decals.js';
import { MAT } from './surfaces.js';

const TAU = Math.PI * 2;
const MAX_TRACK = 400;

/**
 * @param {object} ctx renderer ctx
 * @param {object} fx shared fx pools
 * @param {{ G: Function, surf: Function, gm: Function }} env ground height, obstacle lookup, ground material lookup
 */
export function createBlood(ctx, fx, env) {
  const { G, surf, gm } = env;
  const D = fx.decals;
  const R = fx.rng;
  const _sf = { nx: 0, ny: 0, top: 0, kind: '', d: 0, s0: 0, s1: 0, mat: 0, o: null };
  const _hit = { type: 0, x: 0, y: 0, h: 0, d: 0, nx: 0, ny: 0, top: 0, s0: 0, s1: 0, off: 0 };
  let budget = 0;
  let high = ctx.quality !== 'low';

  /** Share of decals kept: full / low thins them out; ash (gore off) keeps most of them. */
  function keep() {
    const m = fx.gore.mode;
    return m === 'on' || R() < (m === 'low' ? 0.5 : 0.7);
  }

  // ---- ground ---------------------------------------------------------------------------
  function groundMark(cell, x, y, size, alpha, life, rot, aspect, grow, wet) {
    if (gm(x, y) === MAT.WATER) return;
    const c = fx.gore.splat;
    const o = D.opt;
    o.rot = rot; o.aspect = aspect; o.grow = grow; o.wet = wet;
    D.add(0, x, G(x, y), y, 0, 1, 0, size, cell, DK.BLOOD, c.r, c.g, c.b, alpha, life);
  }
  /** A round splat lying on the ground. */
  function groundSplat(x, y, size, alpha = 0.85) {
    if (!keep()) return;
    groundMark(DC.SPLAT + ((R() * DC.SPLAT_N) | 0), x, y, size, alpha, 220, R() * TAU, 1, 0.5, 1);
  }
  /** A spray of streaks lying on the ground, flying along sim angle `ang` from (x, y). */
  function groundSpray(x, y, ang, len, alpha = 0.85) {
    if (!keep()) return;
    const size = len / 1.6;
    const off = 0.72 * size;
    groundMark(DC.SPRAY + ((R() * DC.SPRAY_N) | 0), x + Math.cos(ang) * off, y + Math.sin(ang) * off, size, alpha, 200, Math.PI / 2 - ang, 1, 0.4, 1);
  }
  /** A pool that spreads over the first seconds and then dries dark. */
  function pool(x, y, r, alpha = 0.9) {
    groundMark(DC.POOL + ((R() * DC.POOL_N) | 0), x, y, r * 2.3, alpha, 300, R() * TAU, 1, 5.5, 1);
  }
  /** Fine speckle round a point. */
  function mistMark(x, y, size, alpha = 0.7) {
    if (!keep()) return;
    groundMark(DC.MIST + ((R() * DC.MIST_N) | 0), x, y, size, alpha, 160, R() * TAU, 1, 0.3, 0.8);
  }
  /**
   * The old ground-paint calls (zombies3d, effects): 'blood' | 'gore' with a radius, an angle and
   * a strength, now drawn as decals that spread and dry like the rest instead of being painted
   * into the ground texture for good.
   */
  function legacy(kind, x, y, r, angle, alpha) {
    if (!keep()) return;
    const a = Math.min(1, alpha === undefined ? 1 : alpha);
    if (kind === 'gore') {
      pool(x, y, r * 1.4, 0.95 * a);
      groundMark(DC.SPLAT + ((R() * DC.SPLAT_N) | 0), x, y, r * 3.6, 0.9 * a, 240, angle, 1, 0.6, 1);
    } else {
      groundMark(DC.SPLAT + ((R() * DC.SPLAT_N) | 0), x, y, r * 3.2, 0.85 * a, 220, angle, 1, 0.5, 1);
    }
  }

  /** A drag smear from (x0, y0) to (x1, y1) `width` wide. */
  function smear(x0, y0, x1, y1, width, alpha = 0.7) {
    if (!keep()) return;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 3) return;
    const size = width * 2.9;
    const a = Math.atan2(y1 - y0, x1 - x0);
    groundMark(DC.SMEAR + ((R() * DC.SMEAR_N) | 0), (x0 + x1) / 2, (y0 + y1) / 2, size, alpha, 190, Math.PI / 2 - a, len / (0.95 * size), 0.5, 0.9);
  }
  /** A blood footprint (toe toward sim angle `ang`). */
  function footprint(x, y, ang, side, alpha, bare) {
    if (gm(x, y) === MAT.WATER) return;
    const c = fx.gore.splat;
    const o = D.opt;
    o.rot = Math.PI / 2 - ang; o.aspect = 1; o.grow = 0; o.wet = 0.5;
    const px = x - Math.sin(ang) * side * 3, py = y + Math.cos(ang) * side * 3;
    D.add(0, px + Math.cos(ang) * 4, G(px, py), py + Math.sin(ang) * 4, 0, 1, 0, 6, bare ? DC.FOOT_BARE : DC.FOOT_SHOE, DK.BLOOD, c.r, c.g, c.b, alpha, 150);
  }

  // ---- walls, cars, props ----------------------------------------------------------------
  function clipTo(sf, floorY) {
    const o = D.opt;
    o.top = sf.top; o.s0 = sf.s0; o.s1 = sf.s1; o.floor = floorY;
  }
  /** A splat on the face `sf` at height h (x, y = the hit point beside the face). */
  function wallSplat(x, h, y, sf, size, alpha = 0.9) {
    if (!keep()) return;
    const c = fx.gore.splat;
    const px = x - sf.nx * sf.d, py = y - sf.ny * sf.d;
    clipTo(sf, G(px, py) + 0.4);
    const o = D.opt;
    o.grow = 1.4; o.wet = 1; o.rot = R() * TAU;
    D.add(0, px, h, py, sf.nx, 0, sf.ny, size, DC.SPLAT + ((R() * DC.SPLAT_N) | 0), DK.BLOOD, c.r, c.g, c.b, alpha, 240);
    if (size > 20 && fx.gore.mode === 'on' && high && R() < 0.75) {
      // a drip or two running down from the splat
      for (let k = 0; k < (size > 34 ? 2 : 1); k++) {
        const ox = (R() - 0.5) * size * 0.5;
        clipTo(sf, G(px, py) + 0.4);
        D.opt.drip = 18 + R() * (size * 1.3);
        D.opt.wet = 1;
        D.add(0, px + sf.ny * ox, h - size * 0.12, py - sf.nx * ox, sf.nx, 0, sf.ny, 5 + R() * 3, DC.DRIP + ((R() * DC.DRIP_N) | 0), DK.DRIP, c.r, c.g, c.b, 0.9, 240);
      }
    }
  }
  /** A directional spray on a wall, flying along sim angle `ang` (slope = dh/dist of the flight). */
  function wallSpray(x, h, y, sf, ang, len, slope, alpha = 0.9) {
    if (!keep()) return;
    const c = fx.gore.splat;
    const tx = sf.ny, ty = -sf.nx;                   // decal tangent in sim axes
    const dT = Math.cos(ang) * tx + Math.sin(ang) * ty;
    const rot = Math.atan2(slope * 0.6 - 0.05, dT);
    const size = len / 1.6, off = 0.72 * size;
    const px = x - sf.nx * sf.d, py = y - sf.ny * sf.d;
    const cx = px + tx * Math.cos(rot) * off, cy = py + ty * Math.cos(rot) * off, ch = h + Math.sin(rot) * off;
    clipTo(sf, G(px, py) + 0.4);
    const o = D.opt;
    o.rot = rot; o.grow = 0.8; o.wet = 1;
    D.add(0, cx, ch, cy, sf.nx, 0, sf.ny, size, DC.SPRAY + ((R() * DC.SPRAY_N) | 0), DK.BLOOD, c.r, c.g, c.b, alpha, 240);
  }

  // ---- ray march: what does a spray of blood hit? ---------------------------------------------
  /** First wall/ground along the shot behind (x, y) at height h; result in the shared _hit. */
  function march(x, y, h, ang, reach, slope) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    _hit.type = 0;
    for (let d = 6; d <= reach; d += 7) {
      const px = x + ca * d, py = y + sa * d, hh = h + slope * d;
      const gy = G(px, py);
      if (hh <= gy + 1) { _hit.type = 2; _hit.x = px; _hit.y = py; _hit.h = gy; _hit.d = d; return _hit; }
      const s = surf(px, py, _sf);
      if (s && s.d < 2.5 && hh < s.top) {
        _hit.type = 1; _hit.x = px; _hit.y = py; _hit.h = hh; _hit.d = d;
        _hit.nx = s.nx; _hit.ny = s.ny; _hit.top = s.top; _hit.s0 = s.s0; _hit.s1 = s.s1; _hit.off = s.d;
        return _hit;
      }
    }
    return _hit;
  }
  const _wsf = { nx: 0, ny: 0, top: 0, s0: 0, s1: 0, d: 0 };
  function hitSurf() {
    _wsf.nx = _hit.nx; _wsf.ny = _hit.ny; _wsf.top = _hit.top; _wsf.s0 = _hit.s0; _wsf.s1 = _hit.s1; _wsf.d = _hit.off;
    return _wsf;
  }

  /**
   * A bullet went through flesh at (x, h, y) travelling along `ang`: the exit-wound spray on
   * whatever is behind, plus a splat where the zombie stood.
   * @param {number} k 0..1 how hard (weapon class)
   * @param {number} slope dh/dist of the bullet
   */
  function exitSpray(x, h, y, ang, k, slope) {
    if (budget <= 0 || R() > 0.5 + 0.5 * k) return;
    budget--;
    const reach = 60 + 280 * k;
    const m = march(x, y, h, ang, reach, slope);
    if (m.type === 1) {
      const f = 1 - m.d / (reach * 1.15);
      const s = hitSurf();
      const oblique = Math.abs(Math.cos(ang) * s.ny - Math.sin(ang) * s.nx);
      if (oblique > 0.42 && R() < 0.6) wallSpray(m.x, m.h, m.y, s, ang, (52 + 120 * k) * (0.5 + f), slope, 0.5 + 0.45 * f);
      else wallSplat(m.x, m.h, m.y, s, (18 + 52 * k) * (0.5 + f), 0.55 + 0.4 * f);
      if (k > 0.35 && R() < 0.5) wallSplat(m.x, m.h + (R() - 0.5) * 22, m.y, s, (8 + 20 * k) * (0.5 + f), 0.7);
    } else {
      const len = 45 + 120 * k;
      groundSpray(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14, ang, len, 0.5 + 0.4 * k);
    }
    if (h < 90 && R() < 0.45 + k * 0.4) groundSplat(x + Math.cos(ang) * (8 + R() * 30), y + Math.sin(ang) * (8 + R() * 30), 9 + 16 * k, 0.7);
  }

  /** A burst of blood all round (a zombie blown apart): splats on the ground and the nearest walls. */
  function burstAround(x, y, r, power) {
    const n = high ? 7 : 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + R() * 0.6;
      const m = march(x, y, 10 + R() * 40, a, 90 + 140 * power, 0);
      if (m.type === 1) {
        const f = 1 - m.d / (110 + 160 * power);
        wallSplat(m.x, m.h, m.y, hitSurf(), (26 + 46 * power) * (0.5 + f), 0.85);
      } else {
        const d = 14 + R() * r * 3.2;
        groundSplat(x + Math.cos(a) * d, y + Math.sin(a) * d, 16 + R() * 22 * (0.5 + power), 0.85);
      }
    }
    pool(x, y, r * (1.2 + power * 0.8), 0.95);
    mistMark(x, y, r * 6, 0.7);
  }

  // ---- tracked bleeding (wounded zombies, players walking through blood) -------------------------
  const trail = new Map();        // zombie id → { x, y, s, stamp }
  const feet = new Map();         // player id → { x, y, blood (0..1), side, stamp }
  const pools = new Float32Array(48 * 4);   // recent pools: x, y, r, time
  let poolN = 0, poolHead = 0, frameNo = 0, clock = 0;

  function notePool(x, y, r) {
    const o = poolHead * 4;
    pools[o] = x; pools[o + 1] = y; pools[o + 2] = r; pools[o + 3] = clock;
    poolHead = (poolHead + 1) % 48;
    if (poolN < 48) poolN++;
  }
  function inFreshPool(x, y) {
    for (let i = 0; i < poolN; i++) {
      const o = i * 4;
      if (clock - pools[o + 3] > 30) continue;
      const dx = x - pools[o], dy = y - pools[o + 1], r = pools[o + 2];
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  /** Per frame: reset the spray budget, lay footprints / drips for wounded zombies and bloody players. */
  function update(view, frame) {
    frameNo++;
    clock += Math.min(0.1, frame.dt || 0);
    budget = high ? 9 : 4;
    if (!view) return;
    const zs = view.zombies;
    if (zs && fx.gore.mode !== 'low' || (zs && fx.gore.mode === 'low' && (frameNo & 1) === 0)) {
      let placed = 0;
      for (let i = 0; i < zs.length && placed < 2; i++) {
        const z = zs[i];
        if (!(z.hp < 0.65)) continue;
        if ((z.x - frame.camX) ** 2 + (z.y - frame.camY) ** 2 > 650 * 650) continue;
        let t = trail.get(z.id);
        if (!t) {
          if (trail.size > MAX_TRACK) trail.clear();
          t = { x: z.x, y: z.y, s: 1, stamp: frameNo };
          trail.set(z.id, t);
        }
        t.stamp = frameNo;
        const d = Math.hypot(z.x - t.x, z.y - t.y);
        if (d < 34) continue;
        const ang = Math.atan2(z.y - t.y, z.x - t.x);
        t.x = z.x; t.y = z.y; t.s = -t.s;
        if (d > 90) continue;                       // teleport / spawn: no print
        const a = 0.75 * (1 - z.hp);
        if (R() < 0.7) footprint(z.x, z.y, ang, t.s, Math.min(0.8, a + 0.2), z.type === 'crawler');
        else groundSplat(z.x - Math.cos(ang) * 6, z.y - Math.sin(ang) * 6, 5 + R() * 5, 0.75);
        placed++;
      }
      if ((frameNo & 31) === 0) for (const [id, t] of trail) if (frameNo - t.stamp > 40) trail.delete(id);
    }
    const ps = view.players;
    if (ps && fx.gore.mode === 'on') {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p.state === 'dead') continue;
        let f = feet.get(p.id);
        if (!f) { f = { x: p.x, y: p.y, blood: 0, side: 1, stamp: frameNo }; feet.set(p.id, f); }
        f.stamp = frameNo;
        if (inFreshPool(p.x, p.y)) f.blood = 1;
        if (f.blood <= 0.05) { f.x = p.x; f.y = p.y; continue; }
        const d = Math.hypot(p.x - f.x, p.y - f.y);
        if (d < 30 || d > 120) { if (d > 120) { f.x = p.x; f.y = p.y; } continue; }
        const ang = Math.atan2(p.y - f.y, p.x - f.x);
        f.side = -f.side; f.x = p.x; f.y = p.y;
        footprint(p.x, p.y, ang, f.side, 0.75 * f.blood, false);
        f.blood -= 0.11;
      }
      if ((frameNo & 63) === 0) for (const [id, f] of feet) if (frameNo - f.stamp > 90) feet.delete(id);
    }
  }

  /** Last known track of a wounded zombie (for corpse drag marks): velocity direction or NaN. */
  function lastMove(id, x, y) {
    const t = trail.get(id);
    if (!t) return NaN;
    const d = Math.hypot(x - t.x, y - t.y);
    return d > 10 ? Math.atan2(y - t.y, x - t.x) : NaN;
  }

  return {
    groundSplat, groundSpray, legacy, pool, mistMark, smear, footprint, wallSplat, wallSpray, exitSpray, burstAround, update, march, notePool, lastMove,
    hitSurf, marchHit: _hit,
    setQuality(q) { high = q !== 'low'; },
    reset() { trail.clear(); feet.clear(); poolN = 0; poolHead = 0; },
  };
}
