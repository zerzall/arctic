// Blending two snapshots into the view the renderer draws. Positions lerp, angles take
// the short way round, entities are matched by id. u > 1 extrapolates along the last
// motion (the caller caps how far). Only moving things are blended; everything else is
// taken from the newer snapshot.

import { lerp, lerpAngle } from '../shared/math.js';

/** Farther than this between two snapshots is a teleport (respawn), not motion. */
const TELEPORT2 = 300 * 300;

const indexCache = new WeakMap();

function indexOf(snap, key) {
  let idx = indexCache.get(snap);
  if (!idx) {
    idx = {};
    indexCache.set(snap, idx);
  }
  let m = idx[key];
  if (!m) {
    m = new Map();
    for (const e of snap[key]) m.set(e.id, e);
    idx[key] = m;
  }
  return m;
}

function blendPos(out, pa, pb, u) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  if (dx * dx + dy * dy > TELEPORT2) return;
  out.x = lerp(pa.x, pb.x, u);
  out.y = lerp(pa.y, pb.y, u);
}

function blendList(a, b, key, u, withAngle) {
  const list = b[key];
  const out = new Array(list.length);
  const prev = a ? indexOf(a, key) : null;
  for (let i = 0; i < list.length; i++) {
    const eb = list[i];
    const e = { ...eb };
    const ea = prev ? prev.get(eb.id) : undefined;
    if (ea) {
      blendPos(e, ea, eb, u);
      if (withAngle) e.angle = lerpAngle(ea.angle, eb.angle, u);
    }
    out[i] = e;
  }
  return out;
}

function blendTurrets(a, b, u) {
  const list = b.turrets;
  const out = new Array(list.length);
  const prev = a ? indexOf(a, 'turrets') : null;
  for (let i = 0; i < list.length; i++) {
    const tb = list[i];
    const t = { ...tb };
    const ta = prev ? prev.get(tb.id) : undefined;
    if (ta) t.angle = lerpAngle(ta.angle, tb.angle, u);
    out[i] = t;
  }
  return out;
}

/**
 * The view between snapshot `a` (older, may be null) and `b` at fraction `u`.
 * Returns a new object; the inputs are not modified. `events` is always empty
 * (events are delivered separately through drainEvents()).
 * @param {object|null} a
 * @param {object} b
 * @param {number} u 0 = a, 1 = b, > 1 extrapolates
 * @returns {object} Snapshot-shaped view
 */
export function interpolateSnapshots(a, b, u) {
  const useA = a && a !== b ? a : null;
  return {
    tick: b.tick,
    phase: b.phase,
    wave: b.wave,
    totalWaves: b.totalWaves,
    timer: b.timer,
    remaining: b.remaining,
    bossHp: b.bossHp,
    objective: b.objective ? { ...b.objective } : null,
    readyCount: b.readyCount,
    players: blendList(useA, b, 'players', u, true),
    zombies: blendList(useA, b, 'zombies', u, true),
    projectiles: blendList(useA, b, 'projectiles', u, false),
    pickups: b.pickups,
    turrets: blendTurrets(useA, b, u),
    barricades: b.barricades,
    hazards: b.hazards,
    events: [],
  };
}
