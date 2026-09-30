// Ceilings and roofs of a story level's indoor spaces (JOURNEY.md §3.3, §4.4). Every
// `map.roofs` entry gets a ceiling at its `height` with fixtures by kind and a roof over it,
// unless the level's own art draws it (`ctx.level.roof(B, r)` returns true). The geometry goes
// into the world's static builder, so the roofs cast the sun's and the moon's shadow and are
// culled with the rest; the fixtures' glowing panels are one small mesh per section, dimmed
// when that section's lights are cut (`lights` action). A wall standing under a roof is
// topped up to the ceiling (the generic wall model is 90 units tall), so a room is closed.
//
// Kinds: plain (plaster, bare bulbs), office (ceiling tiles, T-bar grid, fluorescent panels),
// hospital (clean tiles, long cold tubes), mall (high ceiling, skylight lanterns, rows of
// spots), metro (a concrete vault, strip lights), industrial (steel trusses, corrugated roof,
// sodium high-bays), house (plaster, a pendant lamp).
//
// Lights: the map's lights the level placed light the rooms; a roof with none of its own gets
// a few fixture lights by kind (steady sources of the light pool, near the camera only).

import * as THREE from 'three';
import { T, shadeHex } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';
import { skylightsOf } from './indoor.js';
import { nearestSection } from '../shared/level.js';

/** Ceiling height of a roof without one. */
export const ROOF_HEIGHT = 150;
/** Height the generic wall model reaches (world-props.js wall()). */
const WALL_MODEL_H = 88;
/** Fixture lights of a roof without map lights, at most. */
const MAX_FIX_LIGHTS = 4;
/** Fixture lights are registered with the pool only this close to the camera. */
const FIX_NEAR = 1500;

/** Per kind: ceiling and roof colours and surfaces, fixture light colour and strength. */
const KIND = {
  plain: { ceil: '#c9c1b1', cs: DET.plaster, roof: '#3d3a36', rs: DET.gravel, light: '#ffdcaa', k: 0.9 },
  office: { ceil: '#d8d5cb', cs: DET.ceiltile, roof: '#4a4744', rs: DET.gravel, light: '#eef4ff', k: 1.0 },
  hospital: { ceil: '#e2e5e3', cs: DET.ceiltile, roof: '#55534f', rs: DET.gravel, light: '#e4f2ff', k: 1.1 },
  mall: { ceil: '#d6cfc2', cs: DET.plaster, roof: '#5b5853', rs: DET.metalroof, light: '#ffe8c8', k: 1.0 },
  metro: { ceil: '#8d8a84', cs: DET.concrete, roof: '#4a4843', rs: DET.concrete, light: '#d6ecff', k: 1.0 },
  industrial: { ceil: '#6f716f', cs: DET.corrugated, roof: '#646763', rs: DET.corrugated, light: '#ffb45a', k: 1.25 },
  house: { ceil: '#e6dfd0', cs: DET.plaster, roof: '#5a3e32', rs: DET.shingle, light: '#ffd49a', k: 0.8 },
};

/** Point in an oriented rect grown by `pad`. */
function inRect(r, x, y, pad = 0) {
  const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
  const dx = x - r.x, dy = y - r.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= r.w / 2 + pad && Math.abs(ly) <= r.h / 2 + pad;
}

/**
 * The roofs of a level.
 * @param {object} ctx renderer ctx (map, lights, camera)
 * @param {object} deps { level (the level's art or null), newBuilder(), matOf(bucket, tier), root, tier, day, halos }
 * @returns {object|null} see the members below; null when the map has no roofs
 */
export function createRoofs(ctx, deps) {
  const map = ctx.map;
  const roofs = (map.roofs || []).filter((r) => r.w > 0 && r.h > 0);
  if (!roofs.length) return null;
  const { level, newBuilder, matOf, root, day } = deps;
  let tier = deps.tier;
  const sections = map.sections || [];
  const recs = roofs.map((r, i) => ({
    r, i, H: r.height > 0 ? r.height : ROOF_HEIGHT, kind: KIND[r.kind] ? r.kind : 'plain',
    sec: r.section !== undefined ? Math.max(-1, sections.findIndex((s) => s.id === r.section)) : nearestSection(map, r.x, r.y),
    custom: false, fix: [], lit: false,
  }));
  // which roofs have lights of their own (the level placed them)
  for (const rc of recs) rc.lit = map.lights.some((l) => inRect(rc.r, l.x, l.y, -4));
  // fixture glow geometry, per section (so a power cut dims only its own)
  const glowB = new Map();
  const glowOf = (si) => {
    let b = glowB.get(si);
    if (!b) { b = newBuilder(); glowB.set(si, b); }
    return b;
  };

  /** The ceiling height over (x, y), or 0 outdoors. */
  function ceilingAt(x, y) {
    let h = 0;
    for (const rc of recs) if (rc.H > h && inRect(rc.r, x, y)) h = rc.H;
    return h;
  }

  /**
   * Draw every roof into the world's static builder `B` (the level's art first).
   */
  function build(B) {
    for (const rc of recs) {
      const r = rc.r;
      try {
        if (level && typeof level.roof === 'function' && level.roof(B, r)) {
          rc.custom = true;
          continue;
        }
      } catch (err) {
        console.warn('roofs3d: level roof failed', err);
      }
      B.obj(r.x, r.y, r.a || 0, 7000 + rc.i);
      B.setJitter(0.02);
      try {
        buildRoof(B, glowOf(rc.sec), rc);
      } catch (err) {
        console.warn('roofs3d: roof model failed', r.kind, err);
      }
    }
  }

  /**
   * A wall obstacle under a roof: top it up from the generic model's height to the ceiling
   * (called with the builder's object frame already on the obstacle).
   */
  function wallTop(B, o) {
    if (o.kind !== 'wall' || o.h <= 8 || o.gate) return;
    const H = ceilingAt(o.x, o.y);
    if (H <= WALL_MODEL_H + 2) return;
    B.block('std', 0, WALL_MODEL_H, 0, o.w, H - WALL_MODEL_H + 1, o.h, shadeHex(o.color || '#8a877e', 0.05), null, { surf: [DET.plaster, 0.9, 0] });
  }

  // ---- the models ----------------------------------------------------------------------------

  function buildRoof(B, G, rc) {
    const r = rc.r, H = rc.H, K = KIND[rc.kind];
    const w = r.w, d = r.h;
    const cs = { surf: [K.cs, 0.9, 0] };
    // the roof over the ceiling: a slab a little wider than the room, a parapet round it
    const roofS = { surf: [K.rs, 0.95, rc.kind === 'industrial' || rc.kind === 'mall' ? 0.5 : 0] };
    B.block('std', 0, H + 6, 0, w + 10, 10, d + 10, K.roof, null, roofS);
    for (const [x, z, sx, sz] of [[0, -d / 2 - 3, w + 10, 4], [0, d / 2 + 3, w + 10, 4], [-w / 2 - 3, 0, 4, d + 10], [w / 2 + 3, 0, 4, d + 10]]) {
      B.block('std', x, H + 16, z, sx, 8, sz, shadeHex(K.roof, 0.12), null, { surf: [DET.concrete, 0.9, 0] });
    }
    // a fascia band on the outside, over the wall tops
    for (const [x, z, sx, sz] of [[0, -d / 2 - 4, w + 12, 1.5], [0, d / 2 + 4, w + 12, 1.5], [-w / 2 - 4, 0, 1.5, d + 12], [w / 2 + 4, 0, 1.5, d + 12]]) {
      B.block('std', x, H - 8, z, sx, 14, sz, '#7c7870', null, { surf: [DET.stucco, 0.9, 0] });
    }
    switch (rc.kind) {
      case 'office': case 'hospital': tiledCeiling(B, G, rc, cs); break;
      case 'mall': mallCeiling(B, G, rc, cs); break;
      case 'metro': metroVault(B, G, rc, cs); break;
      case 'industrial': industrialRoof(B, G, rc, cs); break;
      case 'house': houseCeiling(B, G, rc, cs); break;
      default: plainCeiling(B, G, rc, cs);
    }
    // a roof hatch and a vent on bigger roofs (they read from the street and in the shadows)
    if (w * d > 90000) {
      B.block('std', -w * 0.25, H + 16, d * 0.2, 36, 14, 30, '#6c6a64', null, { surf: [DET.rust, 0.6, 0.6] });
      B.cyl('std', w * 0.3, H + 16, -d * 0.25, 9, 18, '#8a8c8a', 10, 1, null, { surf: [DET.rust, 0.5, 0.8] });
    }
  }

  /** Put a fixture's glow into the section builder at the roof's local (x, y, z). */
  function glowBox(G, rc, x, y, z, sx, sy, sz, color, k) {
    const r = rc.r;
    G.obj(r.x, r.y, r.a || 0, 9000 + rc.i);
    G.box('glow', x, y, z, sx, sy, sz, color, null, { emissive: k, uv: atlasUV('white'), noJitter: true });
  }

  function addFixLight(rc, lx, lz, h) {
    const r = rc.r, c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
    rc.fix.push({ x: r.x + lx * c - lz * s, y: r.y + lx * s + lz * c, h });
  }

  /** Spread fixture lights over the room: about one per 350 x 350, at most MAX_FIX_LIGHTS. */
  function fixLights(rc, h) {
    if (rc.lit) return;
    const w = rc.r.w, d = rc.r.h;
    const nx = Math.max(1, Math.min(MAX_FIX_LIGHTS, Math.round(w / 360))), nz = Math.max(1, Math.min(2, Math.round(d / 360)));
    for (let i = 0; i < nx && rc.fix.length < MAX_FIX_LIGHTS; i++) {
      for (let j = 0; j < nz && rc.fix.length < MAX_FIX_LIGHTS; j++) addFixLight(rc, -w / 2 + (i + 0.5) * (w / nx), -d / 2 + (j + 0.5) * (d / nz), h);
    }
  }

  function plainCeiling(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    B.block('std', 0, H, 0, r.w, 6, r.h, K.ceil, null, cs);
    const nx = Math.max(1, Math.round(r.w / 230)), nz = Math.max(1, Math.round(r.h / 230));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = -r.w / 2 + (i + 0.5) * (r.w / nx), z = -r.h / 2 + (j + 0.5) * (r.h / nz);
        B.cyl('std', x, H - 16, z, 0.4, 16, '#2a2826', 5, 1);
        B.cyl('std', x, H - 19, z, 1.6, 3, '#5a5650', 8, 1, null, { surf: [DET.rust, 0.5, 0.7] });
        glowBox(G, rc, x, H - 21, z, 3.2, 3.2, 3.2, K.light, 3.2);
      }
    }
    fixLights(rc, H - 24);
  }

  function tiledCeiling(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    const hosp = rc.kind === 'hospital';
    B.block('std', 0, H, 0, r.w, 6, r.h, K.ceil, null, cs);
    // the T-bar grid (every 40 units, a thin grey strip just under the tiles)
    const bar = hosp ? '#b8bcbc' : '#a9a598';
    for (let x = -r.w / 2 + 40; x < r.w / 2 - 1; x += 40) B.box('std', x, H - 0.4, 0, 1.2, 0.8, r.h, bar, null, { surf: [DET.panel, 0.5, 0.4] });
    for (let z = -r.h / 2 + 40; z < r.h / 2 - 1; z += 40) B.box('std', 0, H - 0.4, z, r.w, 0.8, 1.2, bar, null, { surf: [DET.panel, 0.5, 0.4] });
    // light panels (office: square troffers; hospital: long tubes along the room)
    const sx = hosp ? 76 : 36, sz = hosp ? 8 : 36;
    const px = hosp ? 160 : 120, pz = hosp ? 120 : 120;
    const nx = Math.max(1, Math.floor(r.w / px)), nz = Math.max(1, Math.floor(r.h / pz));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = -r.w / 2 + (i + 0.5) * (r.w / nx), z = -r.h / 2 + (j + 0.5) * (r.h / nz);
        // (one fixture in seven is dead: a missing tube, a flickering one is left to the art)
        const dead = ((rc.i * 31 + i * 7 + j * 13) % 7) === 3;
        B.box('std', x, H - 1.2, z, sx + 4, 1.4, sz + 4, '#8e918f', null, { surf: [DET.panel, 0.45, 0.6] });
        if (!dead) glowBox(G, rc, x, H - 2.1, z, sx, 0.6, sz, K.light, hosp ? 2.6 : 2.2);
        else B.box('std', x, H - 2.1, z, sx, 0.6, sz, '#5c605e', null, { surf: [DET.glass, 0.3, 0] });
      }
    }
    fixLights(rc, H - 10);
  }

  function mallCeiling(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    const along = r.w >= r.h;
    const L = along ? r.w : r.h, Wd = along ? r.h : r.w;
    const lights = skylightsOf(r);
    const c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
    // skylight positions along the long axis (roof-local)
    const at = lights.map((q) => {
      const dx = q.x - r.x, dy = q.y - r.y;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      return { t: along ? lx : ly, len: along ? q.w : q.h, wid: along ? q.h : q.w };
    }).sort((a, b) => a.t - b.t);
    // the ceiling in pieces between the skylights (and beside them)
    const piece = (t0, t1) => {
      if (t1 - t0 < 1) return;
      const m = (t0 + t1) / 2, len = t1 - t0;
      if (along) B.block('std', m, H, 0, len, 6, Wd, K.ceil, null, cs);
      else B.block('std', 0, H, m, Wd, 6, len, K.ceil, null, cs);
    };
    let t = -L / 2;
    for (const q of at) {
      piece(t, q.t - q.len / 2);
      // beside the glass: two strips
      const side = (Wd - q.wid) / 2;
      for (const sgn of [-1, 1]) {
        const off = sgn * (q.wid / 2 + side / 2);
        if (along) B.block('std', q.t, H, off, q.len, 6, side, K.ceil, null, cs);
        else B.block('std', off, H, q.t, side, 6, q.len, K.ceil, null, cs);
      }
      // the lantern over the opening: glass panes on a steel frame
      const lx = along ? q.t : 0, lz = along ? 0 : q.t;
      const gx = along ? q.len : q.wid, gz = along ? q.wid : q.len;
      B.box('glass', lx, H + 22, lz, gx - 4, 1.5, gz - 4, '#9fb6c4', null, { surf: [DET.glass, 0.1, 0.1] });
      for (const [fx, fz, fsx, fsz] of [[0, -gz / 2, gx, 3], [0, gz / 2, gx, 3], [-gx / 2, 0, 3, gz], [gx / 2, 0, 3, gz]]) {
        B.block('std', lx + fx, H, lz + fz, fsx, 24, fsz, '#50555a', null, { surf: [DET.rust, 0.5, 0.7] });
      }
      for (let k = -gx / 2 + 30; k < gx / 2; k += 30) B.box('std', lx + k, H + 21, lz, 1.5, 2, gz, '#50555a', null, { surf: [DET.rust, 0.5, 0.7] });
      t = q.t + q.len / 2;
    }
    piece(t, L / 2);
    // two rows of recessed spots along the mall
    for (const row of [-0.3, 0.3]) {
      for (let u = -L / 2 + 50; u < L / 2 - 20; u += 90) {
        const x = along ? u : row * Wd, z = along ? row * Wd : u;
        if (lights.length && at.some((q) => Math.abs(q.t - u) < q.len / 2 + 6) && Math.abs(row) * Wd < at[0].wid / 2 + 4) continue;
        glowBox(G, rc, x, H - 0.8, z, 6, 0.6, 6, K.light, 3);
      }
    }
    fixLights(rc, H - 20);
  }

  function metroVault(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    const along = r.w >= r.h;
    const L = along ? r.w : r.h, Wd = along ? r.h : r.w;
    // a segmental vault across the short axis: springs 46 below the crown at the walls
    const SEG = 9, rise = Math.min(46, Wd * 0.18);
    for (let k = 0; k < SEG; k++) {
      const u0 = -Wd / 2 + (k / SEG) * Wd, u1 = -Wd / 2 + ((k + 1) / SEG) * Wd;
      const y0 = H - rise * (2 * u0 / Wd) ** 2, y1 = H - rise * (2 * u1 / Wd) ** 2;
      const um = (u0 + u1) / 2, ym = (y0 + y1) / 2;
      const len = Math.hypot(u1 - u0, y1 - y0), ang = Math.atan2(y1 - y0, u1 - u0);
      if (along) B.box('std', 0, ym + 3, um, L, 6, len + 0.6, K.ceil, [-ang, 0, 0], cs);
      else B.box('std', um, ym + 3, 0, len + 0.6, 6, L, K.ceil, [0, 0, ang], cs);
    }
    // ribs every 120 along the tunnel
    for (let t = -L / 2 + 60; t < L / 2; t += 120) {
      if (along) B.box('std', t, H - rise * 0.5 - 2, 0, 10, rise + 8, Wd, shadeHex(K.ceil, -0.12), null, cs);
      else B.box('std', 0, H - rise * 0.5 - 2, t, Wd, rise + 8, 10, shadeHex(K.ceil, -0.12), null, cs);
    }
    // strip lights along both sides of the crown, cable trays
    for (const off of [-Wd * 0.22, Wd * 0.22]) {
      const y = H - rise * (2 * off / Wd) ** 2 - 5;
      for (let t = -L / 2 + 40; t < L / 2 - 20; t += 110) {
        const x = along ? t : off, z = along ? off : t;
        B.box('std', x, y + 2, z, along ? 64 : 5, 2.4, along ? 5 : 64, '#6a6e70', null, { surf: [DET.panel, 0.5, 0.6] });
        glowBox(G, rc, x, y, z, along ? 58 : 3, 1.2, along ? 3 : 58, K.light, 2.8);
      }
      if (along) B.box('std', 0, H - rise * 0.9, off * 1.6, L, 2, 8, '#4c4f50', null, { surf: [DET.rust, 0.5, 0.8] });
    }
    fixLights(rc, H - rise - 6);
  }

  function industrialRoof(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    B.block('std', 0, H, 0, r.w, 6, r.h, K.ceil, null, { surf: [DET.corrugated, 0.8, 0.6] });
    const along = r.w >= r.h;
    const L = along ? r.w : r.h, Wd = along ? r.h : r.w;
    const steel = '#4e5356', S = { surf: [DET.rust, 0.6, 0.75] };
    // trusses across the span every 150: chords and a zig-zag of diagonals
    for (let t = -L / 2 + 75; t < L / 2; t += 150) {
      const bx = (u, y, sx, sy, rot) => {
        if (along) B.box('std', t, y, u, 3, sy, sx, steel, rot ? [rot, 0, 0] : null, S);
        else B.box('std', u, y, t, sx, sy, 3, steel, rot ? [0, 0, rot] : null, S);
      };
      bx(0, H - 32, Wd, 3, 0);
      bx(0, H - 3, Wd, 3, 0);
      const n = Math.max(2, Math.round(Wd / 60));
      for (let k = 0; k < n; k++) {
        const u0 = -Wd / 2 + (k / n) * Wd, u1 = -Wd / 2 + ((k + 1) / n) * Wd;
        const up = k % 2 === 0;
        const ang = Math.atan2(29 * (up ? 1 : -1), u1 - u0);
        bx((u0 + u1) / 2, H - 17.5, Math.hypot(u1 - u0, 29), 2.2, along ? -ang : ang);
      }
    }
    // purlins along the roof
    for (let u = -Wd / 2 + 40; u < Wd / 2; u += 80) {
      if (along) B.box('std', 0, H - 1, u, L, 3, 2.5, steel, null, S);
      else B.box('std', u, H - 1, 0, 2.5, 3, L, steel, null, S);
    }
    // sodium high-bays: a cone shade on a rod, the lamp's glow under it
    const nx = Math.max(1, Math.round(r.w / 240)), nz = Math.max(1, Math.round(r.h / 240));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = -r.w / 2 + (i + 0.5) * (r.w / nx), z = -r.h / 2 + (j + 0.5) * (r.h / nz);
        B.cyl('std', x, H - 44, z, 0.6, 44, '#2b2b2b', 5, 1);
        B.cyl('std', x, H - 56, z, 13, 12, '#5f6466', 12, 0.35, null, { surf: [DET.rust, 0.4, 0.8] });
        glowBox(G, rc, x, H - 57, z, 10, 1.2, 10, K.light, 3.4);
      }
    }
    fixLights(rc, H - 60);
  }

  function houseCeiling(B, G, rc, cs) {
    const { r, H } = rc, K = KIND[rc.kind];
    B.block('std', 0, H, 0, r.w, 6, r.h, K.ceil, null, cs);
    // cornice
    for (const [x, z, sx, sz] of [[0, -r.h / 2 + 2, r.w, 4], [0, r.h / 2 - 2, r.w, 4], [-r.w / 2 + 2, 0, 4, r.h], [r.w / 2 - 2, 0, 4, r.h]]) B.box('std', x, H - 2, z, sx, 4, sz, shadeHex(K.ceil, 0.08), null, cs);
    // a pendant lamp over the middle of the room
    B.cyl('std', 0, H - 28, 0, 0.4, 28, '#2a2826', 5, 1);
    B.add('std', T.cyl(14, 0.3, true), [0, H - 36, 0], [16, 12, 16], null, '#d9c7a0', { surf: [DET.fabric, 0.9, 0] });
    glowBox(G, rc, 0, H - 38, 0, 5, 5, 5, K.light, 3.4);
    // the roof proper: a pitched roof over the slab, along the longer side
    const along = r.w >= r.h, L = along ? r.w : r.h, Wd = along ? r.h : r.w;
    const rise = Math.min(70, Wd * 0.3), half = Wd / 2 + 8;
    const len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
    for (const sgn of [-1, 1]) {
      if (along) B.box('std', 0, H + 16 + rise / 2, sgn * half / 2, L + 16, 4, len, K.roof, [sgn * ang, 0, 0], { surf: [DET.shingle, 0.9, 0] });
      else B.box('std', sgn * half / 2, H + 16 + rise / 2, 0, len, 4, L + 16, K.roof, [0, 0, -sgn * ang], { surf: [DET.shingle, 0.9, 0] });
    }
    fixLights(rc, H - 40);
  }

  // ---- after the static meshes: the fixture meshes, the lights -------------------------------

  const glowMeshes = [];   // { si (section), mesh, mat } (a section's fixtures may span several cells)
  const disposables = [];
  const dayK = day ? 0.75 : 1;
  function finish() {
    for (const [si, b] of glowB) {
      for (const { bucket, geometry } of b.finish()) {
        const mat = matOf(bucket, tier).clone();
        mat.color = new THREE.Color(dayK, dayK, dayK);
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.name = 'roof-fixtures';
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
        disposables.push(geometry, mat);
        glowMeshes.push({ si, mesh, mat });
      }
    }
    glowB.clear();
  }

  let dark = 0;
  /** Sections whose lights are out (bit i = section i). */
  function setDark(bits) {
    dark = bits >>> 0;
    for (const g of glowMeshes) g.mat.color.setScalar(g.si >= 0 && (dark & (1 << g.si)) ? 0.04 : dayK);
  }

  const fixColor = recs.map((rc) => KIND[rc.kind].light);
  /** Per frame: the fixture lights of the lit roofs near the camera. */
  function update(view, frame) {
    const L = ctx.lights;
    if (!L) return;
    const cx = frame.camX, cy = frame.camY;
    for (const rc of recs) {
      if (!rc.fix.length) continue;
      if (rc.sec >= 0 && (dark & (1 << rc.sec))) continue;
      const K = KIND[rc.kind];
      const reach = Math.min(460, Math.max(220, Math.max(rc.r.w, rc.r.h) / Math.max(1, rc.fix.length) * 1.1));
      for (let k = 0; k < rc.fix.length; k++) {
        const f = rc.fix[k];
        if (Math.abs(f.x - cx) > FIX_NEAR || Math.abs(f.y - cy) > FIX_NEAR) continue;
        L.steady(`roof:${rc.i}:${k}`, f.x, f.y, f.h, fixColor[rc.i], K.k * (day ? 1.2 : 1), reach);
      }
    }
  }

  /**
   * Up to `n` roofs nearest to (x, y) as rain-shelter rects for world-fx.js makeRain.setRoofs:
   * [{ x, y, a, hl, hw, z }] (the camera's own roof first).
   */
  function nearest(x, y, n = 4) {
    const scored = recs.map((rc) => {
      const r = rc.r, c = Math.cos(r.a || 0), s = Math.sin(r.a || 0);
      const dx = x - r.x, dy = y - r.y;
      const lx = Math.max(0, Math.abs(dx * c + dy * s) - r.w / 2), ly = Math.max(0, Math.abs(-dx * s + dy * c) - r.h / 2);
      return { d: Math.hypot(lx, ly), rc };
    }).sort((a, b) => a.d - b.d);
    return scored.slice(0, n).map(({ rc }) => ({ x: rc.r.x, y: rc.r.y, a: rc.r.a || 0, hl: rc.r.w / 2 + 6, hw: rc.r.h / 2 + 6, z: rc.H + 20 }));
  }

  return {
    recs,
    ceilingAt,
    build,
    wallTop,
    finish,
    update,
    setDark,
    nearest,
    setQuality(t) { tier = t; },
    get stats() { return { roofs: recs.length, custom: recs.filter((q) => q.custom).length, fixtureLights: recs.reduce((s, q) => s + q.fix.length, 0) }; },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const g of glowMeshes) root.remove(g.mesh);
    },
  };
}
