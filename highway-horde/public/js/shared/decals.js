// Decal placement (client-side cosmetics, never read by the sim): the hand-placed set dressing of a
// map as plain data, `map.decals = [{ id, x, y, z, a, nx, ny, w, h, o?, k? }]`, written by the level
// and map builders through the helpers below, and drawn by render3d/decals.js from the baked decal
// library (scripts/bake-decals.js, render3d/decals-manifest.js).
//
//   id      a decal of the library ('gfx.haven-r', 'poster.missing-hart.torn', 'blood.drag' ...)
//   x, y    the centre on the surface, sim coordinates
//   z       height of the centre above the ground (wall decals; 0 on the floor)
//   nx, ny  the wall's outward normal (unit, horizontal); 0, 0 = on the floor, facing up
//   a       floor: the sim angle of the image's +x axis; wall: roll in radians (0 = upright)
//   w, h    size in world units (0 or absent: the library's own size)
//   o       wall decals: the id of the obstacle they are on (the renderer keeps them under its top)
//   k       opacity 0..1 (absent: 1)
//
// Wall decals snap to the nearest wall-like face (wallFaceOf): a wall or building that is not a gate,
// not invisible and not a prop modelled as something else. Everything is deterministic: same map in,
// same decals out.

import { DECALS as LIB } from '../render3d/decals-manifest.js';

/** A library decal's world size [w, h] (units); unknown ids count as 20 × 20. */
export function decalSize(id) {
  const e = LIB[Array.isArray(id) ? id[0] : id];
  return e ? [e[5], e[6]] : [20, 20];
}

/** Obstacle styles drawn as something other than a flat wall face (no decal snaps to them). */
const NOT_A_FACE = /nodraw|train|stack|boxwall|drums|hoist|crane|generator|transformer|fence|chain|bars|rail|rubble|sleeper|speeder|lathe|wheels|lever|switch|reach|fueltank|bench|truss|cage|pallet|helowreck|kloader|fuelpump|sign|turnstile|valve|breaker|cabinet|escalator|balustrade|deckedge|corral|parapet|hedge|junk|scrap|cliff|canyon|bund|liftpost|doorleaf|bigdoor|stalls|shutter|mast|lift$|leg|portcullis|frame|gate|barricade|window|glass|curtain|slot:|logdeck|kiosk|outhouse|rv$|trailer|tent|mr-|bp-|hc-/;

/** Can a decal go on this obstacle's faces? */
export function isWallLike(o) {
  if (!o || o.gate) return false;
  if (o.kind !== 'wall' && o.kind !== 'building' && o.kind !== 'iwall') return false;
  const st = String(o.style || '') + '|' + String(o.prop || '');
  if (o.kind === 'building') return !/nodraw|tent|slot:|outhouse/.test(st);
  return !NOT_A_FACE.test(st) || /^w:(block|store|garage|trailerint|shack|office|twall|shed|carwash|school|police|nave|pharm|hardware|diner|stonewall|tower|brickwall|hwfront|dinerfront|gymwall|ranger|mill|stockade|woodfence)/.test(st);
}

const r1 = (v) => Math.round(v * 10) / 10 + 0;   // (+ 0: never a -0 in the data)
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

/** The decal list of a map (created on first use). */
export function decalsOf(map) {
  if (!map.decals) map.decals = [];
  return map.decals;
}

/** Append a decal (rounded for small, stable data). Returns it. */
export function pushDecal(map, d) {
  const e = { id: d.id, x: r1(d.x), y: r1(d.y), z: r1(d.z || 0), a: r3(d.a || 0), nx: r3(d.nx || 0), ny: r3(d.ny || 0), w: r1(d.w || 0), h: r1(d.h || 0) };
  // (w < 0: mirrored; -0.001 means "the library's width, mirrored")
  if (d.w < 0) e.w = Math.abs(d.w) < 0.05 ? -0.001 : -Math.abs(r1(d.w));
  if (Number.isFinite(d.o)) e.o = d.o;
  if (Number.isFinite(d.k) && d.k < 1) e.k = r3(d.k);
  decalsOf(map).push(e);
  return e;
}

/** A decal on the floor at (x, y), its image's +x along sim angle a. */
export function floorDecal(map, id, x, y, a = 0, opts = {}) {
  return pushDecal(map, { id, x, y, z: 0, a, nx: 0, ny: 0, w: opts.w, h: opts.h, k: opts.k });
}

/**
 * The faces of an obstacle: [{ o, side, cx, cy, nx, ny, tx, ty, len }] (centre, outward normal,
 * tangent along the face, length).
 */
export function facesOf(o) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const out = [];
  for (const [lx, ly, len] of [[0, o.h / 2, o.w], [0, -o.h / 2, o.w], [o.w / 2, 0, o.h], [-o.w / 2, 0, o.h]]) {
    const nlx = Math.sign(lx), nly = Math.sign(ly);
    const nx = nlx * c - nly * s, ny = nlx * s + nly * c;
    out.push({ o, cx: o.x + lx * c - ly * s, cy: o.y + lx * s + ly * c, nx, ny, tx: -ny, ty: nx, len });
  }
  return out;
}

/** Point inside an obstacle's footprint (grown by pad)? */
export function insideOb(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= o.w / 2 + pad && Math.abs(ly) <= o.h / 2 + pad;
}

/**
 * The wall face nearest to (x, y) within `maxD` whose outside the point is on: { face, t (offset
 * along the face from its centre), d } or null. opts.filter(o) narrows the obstacles; opts.margin
 * keeps the decal's half width inside the face.
 */
export function nearestFace(map, x, y, maxD = 120, opts = {}) {
  return nearestFaces(map, x, y, maxD, opts)[0] || null;
}

/** Every wall face within maxD of (x, y) that the point is outside of, nearest first. */
export function nearestFaces(map, x, y, maxD = 120, opts = {}) {
  const out = [];
  const half = opts.halfW || 0;
  for (const o of map.obstacles) {
    if (!(opts.filter ? opts.filter(o) : isWallLike(o))) continue;
    if (Math.abs(o.x - x) > maxD + Math.max(o.w, o.h) || Math.abs(o.y - y) > maxD + Math.max(o.w, o.h)) continue;
    for (const f of facesOf(o)) {
      if (f.len < half * 2 + 4) continue;
      const dx = x - f.cx, dy = y - f.cy;
      const d = dx * f.nx + dy * f.ny;
      if (d < -2 || d > maxD) continue;
      const t = dx * f.tx + dy * f.ty;
      const lim = f.len / 2 - half - 2;
      if (lim < 0) continue;
      const tc = Math.max(-lim, Math.min(lim, t));
      out.push({ face: f, t: tc, d: Math.hypot(Math.max(0, d), t - tc) });
    }
  }
  return out.sort((p, q) => p.d - q.d);
}

/**
 * Is the spot in front of a face free: no other obstacle hugging that face there, and no decal of
 * this map already on it?
 */
function faceClear(map, f, t, half, self, z = 40, hh = 10) {
  for (const k of [-0.8, 0, 0.8]) {
    const px = f.cx + f.tx * (t + k * half) + f.nx * 5, py = f.cy + f.ty * (t + k * half) + f.ny * 5;
    for (const o of map.obstacles) {
      if (o === self || Math.abs(o.x - px) > Math.max(o.w, o.h) || Math.abs(o.y - py) > Math.max(o.w, o.h)) continue;
      if (insideOb(o, px, py, 0)) return false;
    }
  }
  const x = f.cx + f.tx * t, y = f.cy + f.ty * t;
  for (const d of map.decals || []) {
    // (any decal on the same plane: walls built of several pieces share their faces)
    if (!(d.nx || d.ny) || d.nx * f.nx + d.ny * f.ny < 0.98 || Math.abs((d.x - x) * f.nx + (d.y - y) * f.ny) > 4) continue;
    const [dw, dh] = d.w ? [Math.abs(d.w) < 0.01 ? decalSize(d.id)[0] : Math.abs(d.w), d.h || decalSize(d.id)[1]] : decalSize(d.id);
    if (Math.abs(d.z - z) > hh + dh / 2 - 2) continue;   // (one above the other is fine)
    if (Math.hypot(d.x - x, d.y - y) < half + dw / 2 - 2) return false;
  }
  return true;
}

const SLIDES = [0, 24, -24, 48, -48, 80, -80, 120, -120, 170, -170];

/**
 * A decal on the wall nearest to (x, y): its centre at height z. When the nearest spot is taken (a
 * shelf against the wall, another decal) it slides along the face, then tries the next faces. opts:
 * w, h (size), size (the library's [w, h] for the margin), a (roll), maxD, filter, k, along (shift
 * along the face), toward (an arrow: mirrored or swapped so it points there).
 * Returns the decal or null when no face is near.
 */
export function wallDecal(map, id, x, y, z, opts = {}) {
  const [lw, lh] = decalSize(id);
  const halfW = Math.abs(opts.w || (opts.size && opts.size[0]) || lw) / 2;
  const halfH = (opts.h || lh) / 2;
  const hits = nearestFaces(map, x, y, opts.maxD ?? 140, { filter: opts.filter, halfW }).slice(0, 6);
  for (const hit of hits) {
    const f = hit.face;
    const lim = f.len / 2 - halfW - 2;
    for (const sl of opts.clear === false ? [0] : SLIDES) {
      const t = hit.t + (opts.along || 0) + sl;
      if (Math.abs(t) > lim + 0.01) continue;
      if (opts.clear !== false && !faceClear(map, f, t, halfW, f.o, z, halfH)) continue;
      const x0 = f.cx + f.tx * t, y0 = f.cy + f.ty * t;
      let w = opts.w;
      // an arrow that must point at a place: mirror it (negative width) when the place is on the
      // left of someone facing the wall (their right is (ny, -nx))
      let pick = id;
      if (opts.toward) {
        const right = (opts.toward.x - x0) * f.ny + (opts.toward.y - y0) * -f.nx >= 0;
        if (Array.isArray(id)) pick = right ? id[0] : id[1];
        else if (!right) w = -(Math.abs(w || 0) || 0.001);
      }
      return pushDecal(map, {
        id: pick, x: x0, y: y0, z, a: opts.a || 0, nx: f.nx, ny: f.ny, w, h: opts.h, o: f.o.id, k: opts.k,
      });
    }
  }
  return null;
}

/** Floor decals along a polyline of points (a blood trail, footprints), every `step` units. */
export function trailDecals(map, id, pts, step, opts = {}) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    const a = Math.atan2(by - ay, bx - ax);
    for (let s = step / 2; s < L; s += step) {
      const t = s / L;
      // (the image's long axis is its height: the trail runs along the image's +y)
      // (footprints walk toward the image's top: turned around so they head along the path)
      out.push(floorDecal(map, id, ax + (bx - ax) * t, ay + (by - ay) * t, a - Math.PI / 2 + (/prints/.test(id) ? Math.PI : 0), opts));
    }
  }
  return out;
}

/** The anchor named `name` ({ x, y, r }) or null. */
export function anchorOf(map, name) {
  const a = map.anchors && map.anchors[name];
  return a && Number.isFinite(a.x) ? a : null;
}

/** The centre of a gate (all its pieces) and its long axis: { x, y, ux, uy, len } or null. */
export function gateSpot(map, id) {
  const obs = map.obstacles.filter((o) => o.gate === id);
  if (!obs.length) return null;
  let x = 0, y = 0;
  for (const o of obs) { x += o.x; y += o.y; }
  x /= obs.length; y /= obs.length;
  const o = obs[0];
  const along = o.w >= o.h ? o.a || 0 : (o.a || 0) + Math.PI / 2;
  const len = obs.reduce((s, q) => s + Math.max(q.w, q.h), 0);
  return { x, y, ux: Math.cos(along), uy: Math.sin(along), len };
}

/**
 * Decals beside a gate: on the wall next to its opening, on the side of section `fromSide`
 * (the approach). `list` [[id, z, offset along the wall (+ = past the gate's end), opts]].
 */
export function gateDecals(map, gateId, list, opts = {}) {
  const g = gateSpot(map, gateId);
  if (!g) return [];
  const out = [];
  // the approach side: toward the given point (an anchor or a section centre)
  const toward = opts.toward || null;
  const nx = -g.uy, ny = g.ux;
  const s = toward ? Math.sign((toward.x - g.x) * nx + (toward.y - g.y) * ny) || 1 : 1;
  for (const [id, z, off, o2 = {}] of list) {
    const side = Math.sign(off) || 1;
    const px = g.x + g.ux * (g.len / 2 + Math.abs(off)) * side + nx * s * 14;
    const py = g.y + g.uy * (g.len / 2 + Math.abs(off)) * side + ny * s * 14;
    const d = wallDecal(map, id, px, py, z, { maxD: 60, ...o2 });
    if (d) out.push(d);
  }
  return out;
}

/**
 * Check a map's decals against a library (the manifest's DECALS) and the map: every id exists,
 * every decal is inside the map, no wall decal sits on a gate, no floor decal covers a gate's
 * footprint. Returns a list of problems (empty = fine).
 */
export function checkDecals(map, library) {
  const bad = [];
  const gates = map.obstacles.filter((o) => o.gate);
  const byId = new Map(map.obstacles.map((o) => [o.id, o]));
  for (const d of map.decals || []) {
    if (!library[d.id]) bad.push(`${d.id}: not in the library`);
    if (!(d.x >= 0 && d.y >= 0 && d.x <= map.width && d.y <= map.height)) bad.push(`${d.id} at ${d.x},${d.y}: outside the map`);
    if (d.o !== undefined) {
      const o = byId.get(d.o);
      if (!o) bad.push(`${d.id}: on a missing obstacle ${d.o}`);
      else if (o.gate) bad.push(`${d.id}: on gate ${o.gate}`);
    }
    if (!d.nx && !d.ny) for (const g of gates) if (insideOb(g, d.x, d.y, 2)) bad.push(`${d.id} at ${d.x},${d.y}: on gate ${g.gate}`);
  }
  return bad;
}

// ---- the placement script of a level ----------------------------------------------------------

function rngFor(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A place of the script: an anchor name, 'gate:<id>' (its centre), 'sec:<id>' (a section's centre)
 * or [x, y]. Returns { x, y } or null.
 */
export function spotOf(map, at) {
  if (Array.isArray(at)) return { x: at[0], y: at[1] };
  if (typeof at !== 'string') return null;
  if (at.startsWith('gate:')) { const g = gateSpot(map, at.slice(5)); return g ? { x: g.x, y: g.y } : null; }
  if (at.startsWith('sec:')) { const s = (map.sections || []).find((q) => q.id === at.slice(4)); return s ? { x: s.x, y: s.y } : null; }
  return anchorOf(map, at);
}

/** Floor spot clear of every solid obstacle and gate (pad units)? */
function floorClear(map, x, y, pad) {
  return !map.obstacles.some((o) => (o.solid !== false || o.gate) && insideOb(o, x, y, pad));
}

/**
 * Run a decal script on a map (the hand placement of a level, a hideout, Sandstone). Entries:
 *   { w: id, at, z, dx, dy, along, maxD, a, k }        a wall decal on the face nearest to at + (dx, dy)
 *   { f: id, at, dx, dy, a, k }                        a floor decal
 *   { trail: id, path: [at, ...], step, k }            floor decals along a path (blood trails, prints)
 *   { gate: id, list: [[decal, z, offset], ...], toward } decals on the walls beside a gate
 *   { scatter: [ids], at, r, n, k }                    floor decals strewn around a spot
 *   { walls: [ids], at, r, n, z: [lo, hi] }            wall decals on the faces around a spot
 * Unknown places, spots with no wall nearby and floor spots inside an obstacle or a gate are skipped.
 * Deterministic per map id.
 * @returns {number} decals placed
 */
export function placeDecals(map, entries) {
  const rnd = rngFor(`${map.id}:decals`);
  const before = decalsOf(map).length;
  const off = (p, e) => (p ? { x: p.x + (e.dx || 0), y: p.y + (e.dy || 0) } : null);
  const inMap = (x, y) => x > 4 && y > 4 && x < map.width - 4 && y < map.height - 4;
  for (const e0 of entries) {
    // (on: a pattern over "kind:style" for the obstacles a wall decal may go on: the side of a boxcar)
    const e = e0.on ? { ...e0, filter: (o) => !o.gate && e0.on.test(`${o.kind}:${o.style || ''}`) } : e0;
    if (e.w) {
      const p = off(spotOf(map, e.at), e);
      if (p) wallDecal(map, e.w, p.x, p.y, e.z ?? 40, { maxD: e.maxD ?? 240, along: e.along, a: e.a, k: e.k, filter: e.filter });
    } else if (e.arrow) {
      // a wall arrow pointing at `toward` (a [right, left] pair of ids, or one id mirrored)
      const p = off(spotOf(map, e.at), e), t = spotOf(map, e.toward);
      if (p && t) wallDecal(map, e.arrow, p.x, p.y, e.z ?? 45, { maxD: e.maxD ?? 240, along: e.along, toward: t, k: e.k, filter: e.filter });
    } else if (e.farrow) {
      // an arrow on the floor pointing at `toward` (the image's +x is the arrow)
      const p = off(spotOf(map, e.at), e), t = spotOf(map, e.toward);
      if (p && t && inMap(p.x, p.y) && floorClear(map, p.x, p.y, 4)) floorDecal(map, e.farrow, p.x, p.y, Math.atan2(t.y - p.y, t.x - p.x), { k: e.k });
    } else if (e.f) {
      const p = off(spotOf(map, e.at), e);
      if (p && inMap(p.x, p.y) && floorClear(map, p.x, p.y, 4)) floorDecal(map, e.f, p.x, p.y, e.a ?? rnd() * Math.PI * 2, { k: e.k });
    } else if (e.trail) {
      const pts = e.path.map((q) => spotOf(map, q)).filter(Boolean).map((q) => [q.x, q.y]);
      if (pts.length < 2) continue;
      const start = decalsOf(map).length;
      trailDecals(map, e.trail, pts, e.step || 70, { k: e.k });
      // (a trail never runs through a wall or across a gate)
      map.decals = map.decals.filter((d, i) => i < start || (inMap(d.x, d.y) && floorClear(map, d.x, d.y, 2)));
    } else if (e.gate) {
      const t = e.toward ? spotOf(map, e.toward) : null;
      gateDecals(map, e.gate, e.list, { toward: t });
    } else if (e.scatter) {
      const p = spotOf(map, e.at);
      if (!p) continue;
      for (let i = 0; i < (e.n || 3); i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (e.r || 120);
        const x = p.x + Math.cos(a) * d + (e.dx || 0), y = p.y + Math.sin(a) * d + (e.dy || 0);
        const id = e.scatter[Math.floor(rnd() * e.scatter.length)];
        if (!inMap(x, y) || !floorClear(map, x, y, 6)) continue;
        floorDecal(map, id, x, y, rnd() * Math.PI * 2, { k: e.k });
      }
    } else if (e.walls) {
      const p = spotOf(map, e.at);
      if (!p) continue;
      const [lo, hi] = e.z || [30, 50];
      for (let i = 0; i < (e.n || 3); i++) {
        const a = rnd() * Math.PI * 2, d = rnd() * (e.r || 150);
        const id = e.walls[Math.floor(rnd() * e.walls.length)];
        wallDecal(map, id, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, lo + (hi - lo) * rnd(), { maxD: (e.r || 150) * 0.8, a: (rnd() - 0.5) * 0.06, filter: e.filter });
      }
    }
  }
  return decalsOf(map).length - before;
}
