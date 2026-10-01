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

/** Blend a position; false when it jumped (a respawn, or a campaign teleport up the stairs). */
function blendPos(out, pa, pb, u) {
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  if (dx * dx + dy * dy > TELEPORT2) return false;
  out.x = lerp(pa.x, pb.x, u);
  out.y = lerp(pa.y, pb.y, u);
  return true;
}

function blendList(a, b, key, u, withAngle, withZ = false) {
  const list = b[key];
  const out = new Array(list.length);
  const prev = a ? indexOf(a, key) : null;
  for (let i = 0; i < list.length; i++) {
    const eb = list[i];
    const e = { ...eb };
    const ea = prev ? prev.get(eb.id) : undefined;
    if (ea) {
      const moved = blendPos(e, ea, eb, u);
      if (withAngle) e.angle = lerpAngle(ea.angle, eb.angle, u);
      // height (jumping, climbing, on a roof): never extrapolated, so nobody sinks into the
      // ground or through a roof they just landed on
      if (withZ && moved && (ea.z > 0 || eb.z > 0)) e.z = Math.max(0, lerp(ea.z || 0, eb.z || 0, Math.min(1, u)));
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
    zone: blendZone(useA, b, u),
    campaign: blendCampaign(useA, b, u),
    // Road to Haven: the objective tracker and the spots are taken from the newer snapshot, NPCs glide
    story: b.story || null,
    // a story level's gates, sections and lights (the renderers animate the gates themselves)
    level: b.level || null,
    npcs: b.npcs && b.npcs.length ? blendList(useA, b, 'npcs', u, true, true) : [],
    interactables: b.interactables || [],
    players: blendList(useA, b, 'players', u, true, true),
    zombies: blendList(useA, b, 'zombies', u, true, true),
    projectiles: blendList(useA, b, 'projectiles', u, false),
    pickups: b.pickups,
    turrets: blendTurrets(useA, b, u),
    barricades: b.barricades,
    hazards: b.hazards,
    events: [],
  };
}

/** Evac Run zone (SPEC §4): the shrinking circle and the timers glide between snapshots. */
function blendZone(a, b, u) {
  const zb = b.zone;
  if (!zb) return null;
  const za = a && a.zone;
  if (!za || za.stage !== zb.stage || za.poi !== zb.poi) return { ...zb };
  const k = Math.max(0, Math.min(1, u));
  return {
    ...zb,
    x: za.x + (zb.x - za.x) * k,
    y: za.y + (zb.y - za.y) * k,
    r: za.r + (zb.r - za.r) * k,
    t: za.t + (zb.t - za.t) * k,
  };
}

/** Campaign (SPEC §4): the horde front and the timers glide between snapshots of the same stage. */
function blendCampaign(a, b, u) {
  const cb = b.campaign;
  if (!cb) return null;
  const ca = a && a.campaign;
  if (!ca || ca.stage !== cb.stage || ca.floor !== cb.floor || ca.sub !== cb.sub) return { ...cb };
  const k = Math.max(0, Math.min(1, u));
  const out = { ...cb, t: ca.t + (cb.t - ca.t) * k };
  if (ca.front > -1e8 && cb.front > -1e8) out.front = ca.front + (cb.front - ca.front) * (u > 1 ? u : k);
  return out;
}
