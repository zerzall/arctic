// Story levels at run time (JOURNEY.md §4). What the host sim, the client's prediction, both
// renderers and the UI share about a level map (`map.kind === 'level'`): its gates and their
// colliders, its sections, supply crates, checkpoints and the way forward. Pure and
// deterministic; no DOM. Every helper is a no-op (or an empty answer) on any other map.
//
// Gates: a gate is one or more `wall` obstacles tagged `o.gate` (maps.js B.gate). Their
// colliders sit in every collision world at the obstacle's index (geom.js mapColliders pushes
// the obstacles first, in order). Opening a gate clears the colliders' `mask`, so nothing
// collides with them any more (players, zombies, bullets, grenades, lines of sight and
// movement); shutting it puts the obstacle's own mask back. Flow fields over the same
// colliders are patched with FlowField.patchRegion (sim/level.js does that on the host).

import { LEVEL_SPECS } from './levels/index.js';

/** Seconds a gate takes to open or shut on screen (the sim switches it at once). */
export const GATE_ANIM_TIME = 1.2;
/** Most gates the snapshot carries (a level has far fewer). */
export const MAX_GATES = 32;
/** Most sections a level may have (the lights-off bits are one u32). */
export const MAX_SECTIONS = 32;

/** True for a story level map. */
export function isLevel(map) {
  return !!map && map.kind === 'level';
}

const GATE_CACHE = new WeakMap();
const SUPPLY_CACHE = new WeakMap();

/**
 * The gates of a level in `map.gates` order (the snapshot's order):
 * `[{ i, id, kind, label, ids: [obstacle ids], obs: [obstacles], x, y (centre of the pieces),
 * x0, y0, x1, y1 (bounds of the pieces), from, to (section indices, -1 = unknown) }]`.
 * `from` / `to` come from the level's SPEC, else from where the gate stands. Cached per map.
 * @param {object} map
 * @returns {object[]}
 */
export function levelGates(map) {
  if (!isLevel(map) || !Array.isArray(map.gates)) return [];
  let list = GATE_CACHE.get(map);
  if (list) return list;
  const spec = LEVEL_SPECS[map.id] || null;
  list = map.gates.slice(0, MAX_GATES).map((g, i) => {
    const obs = [];
    for (const id of g.obstacles || []) {
      const o = map.obstacles[id];
      if (o && o.gate === g.id) obs.push(o);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
    for (const o of obs) {
      const c = Math.abs(Math.cos(o.a || 0)), s = Math.abs(Math.sin(o.a || 0));
      const ex = (o.w * c + o.h * s) / 2, ey = (o.w * s + o.h * c) / 2;
      x0 = Math.min(x0, o.x - ex);
      x1 = Math.max(x1, o.x + ex);
      y0 = Math.min(y0, o.y - ey);
      y1 = Math.max(y1, o.y + ey);
      sx += o.x;
      sy += o.y;
    }
    const n = Math.max(1, obs.length);
    const rec = {
      i, id: g.id, kind: g.kind, label: g.label || '', ids: obs.map((o) => o.id), obs,
      x: obs.length ? sx / n : 0, y: obs.length ? sy / n : 0, x0, y0, x1, y1, from: -1, to: -1,
    };
    const sg = spec && spec.gates.find((e) => e.id === g.id);
    if (sg) {
      rec.from = sectionIndex(map, sg.from);
      rec.to = sectionIndex(map, sg.to);
    }
    if (rec.from < 0 || rec.to < 0) {
      // no contract for it: the sections the gate stands between (the lowest index is where it is shut from)
      let lo = -1, hi = -1;
      (map.sections || []).forEach((s, k) => {
        if (Math.abs(rec.x - s.x) <= s.w / 2 + 80 && Math.abs(rec.y - s.y) <= s.h / 2 + 80) {
          if (lo < 0) lo = k;
          hi = k;
        }
      });
      if (rec.from < 0) rec.from = lo;
      if (rec.to < 0) rec.to = hi > lo ? hi : lo >= 0 && lo + 1 < (map.sections || []).length ? lo + 1 : -1;
    }
    return rec;
  });
  GATE_CACHE.set(map, list);
  return list;
}

/** Index of gate `id` in `map.gates` (-1 when it has none by that name). */
export function gateIndex(map, id) {
  const list = levelGates(map);
  for (const g of list) if (g.id === id) return g.i;
  return -1;
}

/**
 * Switch the colliders of gate `i` in a collision world (movement.js) or any list of map
 * colliders: open = they collide with nothing, shut = the obstacle's own mask again.
 * @param {object} world a CollisionWorld (or anything with `colliders`)
 * @returns {boolean} true when a collider changed
 */
export function setGateColliders(world, map, i, open) {
  const g = levelGates(map)[i];
  if (!g || !world || !world.colliders) return false;
  let changed = false;
  for (const id of g.ids) {
    const c = world.colliders[id];
    if (!c || c.ref !== map.obstacles[id]) continue;
    if (c.mask0 === undefined) c.mask0 = c.mask;
    const m = open ? 0 : c.mask0;
    if (c.mask !== m) {
      c.mask = m;
      changed = true;
    }
  }
  return changed;
}

/**
 * Bring a world's gate colliders in line with a list of open flags (a snapshot's
 * `level.gates[].open`). @returns {boolean} true when anything changed
 */
export function syncGateColliders(world, map, gates) {
  if (!isLevel(map) || !Array.isArray(gates)) return false;
  let changed = false;
  const n = Math.min(gates.length, levelGates(map).length);
  for (let i = 0; i < n; i++) {
    const g = gates[i];
    if (setGateColliders(world, map, i, !!(g && typeof g === 'object' ? g.open : g))) changed = true;
  }
  return changed;
}

/** Index of section `id` (-1 when unknown). */
export function sectionIndex(map, id) {
  const list = map && map.sections;
  if (!list) return -1;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
  return -1;
}

/** True if (x, y) lies inside section record `s` (grown by `pad`). */
export function inSection(s, x, y, pad = 0) {
  return Math.abs(x - s.x) <= s.w / 2 + pad && Math.abs(y - s.y) <= s.h / 2 + pad;
}

/**
 * The section a point is in: the highest index whose rectangle holds it (sections may
 * overlap a little at the gates, and the one further along wins), -1 outside every one.
 */
export function sectionAt(map, x, y) {
  const list = map && map.sections;
  if (!list) return -1;
  for (let i = list.length - 1; i >= 0; i--) if (inSection(list[i], x, y)) return i;
  return -1;
}

/** The section nearest to a point (the one holding it, else the closest rectangle; 0 without any). */
export function nearestSection(map, x, y) {
  const list = map && map.sections;
  if (!list || !list.length) return 0;
  const at = sectionAt(map, x, y);
  if (at >= 0) return at;
  let best = 0, bd = Infinity;
  list.forEach((s, i) => {
    const dx = Math.max(0, Math.abs(x - s.x) - s.w / 2), dy = Math.max(0, Math.abs(y - s.y) - s.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** The checkpoints of section index `i` ([{ section, x, y }], maybe empty). */
export function checkpointsOf(map, i) {
  const s = map && map.sections && map.sections[i];
  if (!s || !Array.isArray(map.checkpoints)) return [];
  return map.checkpoints.filter((c) => c.section === s.id);
}

/**
 * The level's supply crates: every obstacle tagged `prop: 'supply'` (any kind), as
 * `[{ x, y, id }]`. They work like the map's supply station (the shop mid-wave, bots
 * resupply there). Cached per map.
 */
export function levelSupplies(map) {
  if (!isLevel(map)) return [];
  let list = SUPPLY_CACHE.get(map);
  if (!list) {
    list = [];
    for (const o of map.obstacles || []) if (o.prop === 'supply') list.push({ x: o.x, y: o.y, id: o.id });
    SUPPLY_CACHE.set(map, list);
  }
  return list;
}

/**
 * The supply point nearest to (x, y) on a level (its crates and the map's station), or
 * null; on other maps the map's station.
 */
export function nearestSupply(map, x, y) {
  let best = map && map.supply ? map.supply : null;
  let bd = best ? Math.hypot(best.x - x, best.y - y) : Infinity;
  for (const s of levelSupplies(map)) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/**
 * The gate the party must get through to leave section `i` (the one whose `from` is `i`
 * and leads further on), or null.
 */
export function gateOutOf(map, i) {
  let best = null;
  for (const g of levelGates(map)) {
    if (g.from !== i || g.to <= i) continue;
    if (!best || g.to < best.to) best = g;
  }
  return best;
}

/**
 * Where the way forward lies from section `i`, for the compass, the minimap and the bots:
 * the gate out of it while that gate is shut, else the next section (its first
 * checkpoint, or its centre). `open` is the gates' open flags (booleans or `{open}`).
 * @returns {{ kind: 'gate'|'section', x: number, y: number, gate: object|null, section: number }|null}
 */
export function wayForward(map, i, open) {
  if (!isLevel(map) || !map.sections || i + 1 >= map.sections.length) return null;
  const g = gateOutOf(map, i);
  const isOpen = (k) => {
    const v = open && open[k];
    return !!(v && typeof v === 'object' ? v.open : v);
  };
  if (g && !isOpen(g.i)) return { kind: 'gate', x: g.x, y: g.y, gate: g, section: g.to };
  const next = i + 1;
  const cps = checkpointsOf(map, next);
  const s = map.sections[next];
  const p = cps.length ? cps[0] : s;
  return { kind: 'section', x: p.x, y: p.y, gate: g, section: next };
}
