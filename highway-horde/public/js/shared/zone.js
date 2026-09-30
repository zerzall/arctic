// Game modes and the "Evac Run" safe zone (SPEC §3.7): the tuning numbers and the pure
// helpers the simulation, the netcode, the HUD and both renderers share. The rules that
// move the zone live in sim/zone.js; nothing here touches the DOM or keeps state.

import { MAP_LIST } from './maps.js';
import { levelSupplies } from './level.js';

/** Game modes in lobby order. 'defend' is the original mode and the default. */
export const MODE_LIST = [
  {
    id: 'defend',
    name: 'Defend',
    short: 'Defend the objective',
    description: 'Hold one spot against every wave. Guard the objective (or just survive with it off).',
  },
  {
    id: 'zone',
    name: 'Evac Run',
    short: 'Move to each new safe zone',
    description: 'Every wave the safe zone moves to a new spot on the map. Get there before the blight rolls in, grab the supply drop, and hold the circle while it shrinks.',
  },
  {
    id: 'campaign',
    name: 'Campaign',
    short: 'Hilltop stand, breakout, tower, zip line',
    description: 'A four-stage campaign on a daylit map: hold the hilltop against the horde, break out across the wrecked street to the tall tower, fight up floor by floor to the roof, kill the quota and escape down the zip line.',
  },
];
export const MODE_IDS = MODE_LIST.map((m) => m.id);
/** The modes every map plays unless its `modes` list says otherwise (the campaign is opt-in per map). */
export const STANDARD_MODES = Object.freeze(['defend', 'zone']);

/**
 * Tuning of the moving safe zone. Distances in world px, times in seconds.
 *   move      travel time to the next zone: clamp(base + distance / speed, min, max),
 *             + prepExtra before wave 1 (time to shop first)
 *   pick      the next zone is picked among POIs this far from the current one when any
 *             are (else among all the others); never the same POI twice in a row
 *   hold      after the wave starts, the circle holds its size this long, then shrinks over
 *             `shrink` s to `shrinkTo` × its radius around a new centre inside it
 *   fog       damage per second outside the circle during a wave: dps0 + ramp × seconds
 *             outside (capped at max), × (1 + perWave × (wave − 1)); armour does not help.
 *             Downed survivors outside bleed out `downedBleed` × faster (never instantly).
 *   spawn     wave zombies appear in a ring `ring` px beyond the circle's edge; from the
 *             shrink on, `fogShare` of the groups walk out of the blight just past the edge
 *   harass    during the move: groups of `group` zombies every `every` s, `dist` px from a
 *             survivor (ahead of them when possible), `base + perWave × wave` of them per move
 *             (× the crowd factor), at most `cap`
 *   navRange  on big maps the zombie flow field stops expanding this far (path px) from
 *             every survivor; zombies beyond it walk to the nearest reached cell
 */
export const ZONE = Object.freeze({
  move: Object.freeze({ base: 12, speed: 170, min: 22, max: 60, prepExtra: 12 }),
  pick: Object.freeze({ near: 3000, far: 6200 }),
  hold: 38,
  shrink: 22,
  shrinkTo: 0.58,
  /** Boss waves shrink less (and never below bossMinR px): the Abomination needs room to be kited. */
  shrinkToBoss: 0.75,
  bossMinR: 480,
  fog: Object.freeze({ dps0: 4, ramp: 1.6, max: 22, perWave: 0.05, downedBleed: 0.5, decay: 2 }),
  spawn: Object.freeze({ ring: [380, 880], fogRing: [140, 320], fogShare: 0.35, far: 700, fogFar: 420 }),
  harass: Object.freeze({ every: 5, group: [2, 5], dist: [620, 950], base: 4, perWave: 1.4, cap: 20, firstAfter: 4 }),
  navRange: 2800,
  /** Maps bigger than this (px²) get the navRange cutoff. */
  navRangeArea: 30e6,
});

/** Zone stages (snapshot `zone.stage`). */
export const ZONE_STAGES = ['move', 'hold', 'shrink', 'final'];

/**
 * Modes a map supports (MAP_LIST entry or MapDef; a map without a list plays defend and the Evac Run).
 * @param {object|string} map MAP_LIST entry, MapDef or map id
 * @returns {string[]}
 */
export function mapModes(map) {
  const meta = typeof map === 'string' ? MAP_LIST.find((m) => m.id === map) : map;
  return meta && Array.isArray(meta.modes) && meta.modes.length ? meta.modes : STANDARD_MODES;
}

/** True if `mapId` can be played in `mode`. */
export function mapSupportsMode(mapId, mode) {
  return MODE_IDS.includes(mode) && mapModes(mapId).includes(mode);
}

/**
 * Keep a (mapId, mode) combination valid. `changed` says which one the player just picked:
 * picking a map that doesn't play the current mode switches the mode to the map's first;
 * picking a mode the current map doesn't play switches to the first map that plays it.
 * @returns {{ mapId: string, mode: string }}
 */
export function fixModeCombo(mapId, mode, changed = 'map') {
  if (!MODE_IDS.includes(mode)) mode = MODE_IDS[0];
  if (!MAP_LIST.some((m) => m.id === mapId)) mapId = MAP_LIST[0].id;
  if (mapSupportsMode(mapId, mode)) return { mapId, mode };
  if (changed === 'mode') {
    const m = MAP_LIST.find((e) => mapModes(e).includes(mode));
    if (m) return { mapId: m.id, mode };
  }
  return { mapId, mode: mapModes(mapId)[0] };
}

/** Seconds to travel `d` px to the next zone (before wave 1: + prepExtra). */
export function moveTime(d, first = false) {
  const m = ZONE.move;
  const t = Math.min(m.max, Math.max(m.min, m.base + d / m.speed));
  return Math.round(t + (first ? m.prepExtra : 0));
}

/** Fog damage per second after `outside` s outside the circle in wave `wave`. */
export function fogDps(outside, wave) {
  const f = ZONE.fog;
  return Math.min(f.max, f.dps0 + f.ramp * Math.max(0, outside)) * (1 + f.perWave * Math.max(0, wave - 1));
}

/**
 * The zone circle at `t` seconds into the shrink (0..ZONE.shrink), from circle a to b.
 * Writes { x, y, r } into out.
 */
export function shrinkCircle(a, b, t, out = {}) {
  const u = Math.max(0, Math.min(1, t / ZONE.shrink));
  // ease in-out so the wall starts and stops gently
  const e = u * u * (3 - 2 * u);
  out.x = a.x + (b.x - a.x) * e;
  out.y = a.y + (b.y - a.y) * e;
  out.r = a.r + (b.r - a.r) * e;
  return out;
}

/** Distance from (x, y) to the circle's edge: < 0 inside, > 0 outside. */
export function zoneEdgeDist(z, x, y) {
  if (!z) return -Infinity;
  return Math.hypot(x - z.x, y - z.y) - z.r;
}

/** True if (x, y) is inside the live safe circle of a snapshot zone (or there is none). */
export function insideZone(z, x, y) {
  return !z || zoneEdgeDist(z, x, y) <= 0;
}

/** True while the fog hurts: a wave is on (the circle is locked). */
export function zoneLocked(z) {
  return !!z && z.stage > 0;
}

/** Display name of a snapshot zone's POI on `map` ('' when unknown). */
export function zoneName(map, z) {
  const p = z && map && map.pois ? map.pois[z.poi] : null;
  return p ? p.name : '';
}

/**
 * True if a survivor at (x, y) may use the shop mid-wave: within `radius` of the map's
 * supply station or of the zone's supply drop.
 */
export function nearSupply(map, zone, x, y, radius) {
  const s = map && map.supply;
  if (s && Math.hypot(x - s.x, y - s.y) <= radius) return true;
  // (a story level's supply crates, shared/level.js)
  for (const c of levelSupplies(map)) if (Math.hypot(x - c.x, y - c.y) <= radius) return true;
  return !!zone && zone.sx !== undefined && Math.hypot(x - zone.sx, y - zone.sy) <= radius;
}

/** "1:05" style countdown. */
export function formatCountdown(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}`;
}
