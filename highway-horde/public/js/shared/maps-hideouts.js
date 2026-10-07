// The three hideouts of the story campaign (STORY.md §4, §5.2): safe, walkable hub maps
// where the crew rests between missions. Built with the same builder vocabulary as the
// battlefields (maps.js `createBuilder`), so `buildMap('roadhouse' | 'depot' | 'farmstead',
// seed)` returns an ordinary MapDef that the simulation, the flow field and both renderers
// already understand, plus the hub data the story layer plugs into:
//
//   map.kind          'hideout'
//   map.hub           { id, name, chapters, defaultTime, spawn, bounds, stations[], npcs[],
//                       upgradeSlots{}, range, props[], dress[], look, upgrades }
//   map.look         the same object as hub.look: { night?, day?, trees?, deciduous? } mood overrides the
//                     renderers read (lights.js night, daylight.js day, world-flora / world-veg trees)
//   map.interactables [{ id, kind, x, y, r, label, hold: 0 }]  one per station (id = station id)
//
// The hideouts are NOT in MAP_LIST (the lobby never offers them). Their layout is hand made
// and identical for every seed; the seed only moves the small scatter (tufts, pebbles).
//
// SEAMS (documented in SPEC §3.10):
//   * Stations  hub.stations[] = { id, kind, x, y, r, label, h } — `kind` is one of
//     STATION_KINDS. The matching interactable has the same id/kind/x/y/r, `hold: 0`.
//   * NPCs      hub.npcs[] = { id, name, role, x, y, angle, pose, station?, recruit?, mode?, route?, loop? } —
//     idle spots: `id` is a cast key (shared/story/cast.js), sim/story.js stands the NPC on the spot.
//     `recruit` (the mission that unlocks the NPC) keeps the spot empty when the host lists the
//     recruited cast in settings.story.npcs and this NPC is not in it.
//   * Upgrades  settings.story.hideoutUpgrades = { generator, watchtower, infirmary, armory,
//     radiomast, garden, palisade } (tiers 0..3). `normalizeUpgrades(raw)` cleans it,
//     `buildHideoutUpgrade(kind, tier, hub)` returns what tier `tier` ADDS (tier 0 = the
//     unbuilt "site") and `hideoutUpgradeSet(map, upgrades)` merges every built tier. The
//     3D renderer reads the tiers from `map.hub.upgrades` (set with `applyHideoutUpgrades`,
//     which the story session calls before it creates the renderer) or live through
//     `renderer.setHideoutUpgrades(upgrades)`. Upgrade content is VISUAL: the footprints that
//     collide (slot obstacles, the perimeter) are in the base map at every tier.
//   * Range     hub.range = { line, targets:[{ id, x, y, a }] } — sim/range.js turns the
//     targets into immobile dummies.

import { TAU } from './math.js';
import { createRng, hashString } from './rng.js';
import { UPGRADE_KINDS, UPGRADE_MAX_TIER, HUB_PROP_KINDS, STATION_COLORS, UPGRADE_COLORS } from './maps-hideouts-kit.js';
import { buildRoadhouse } from './maps-hideouts-roadhouse.js';
import { buildDepot } from './maps-hideouts-depot.js';
import { buildFarmstead } from './maps-hideouts-farmstead.js';

export const HIDEOUT_IDS = Object.freeze(['roadhouse', 'depot', 'farmstead']);

/** Station kinds (STORY.md §4). */
export const STATION_KINDS = Object.freeze(['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'bed', 'range', 'campfire']);

/** Hideout upgrades (STORY.md §4): each has tiers 1..3, all visible in the hub. */
export { UPGRADE_KINDS, UPGRADE_MAX_TIER, HUB_PROP_KINDS, STATION_COLORS, UPGRADE_COLORS };
const UPGRADE_ALIASES = Object.freeze({
  radio: 'radiomast', radio_mast: 'radiomast', 'radio-mast': 'radiomast', mast: 'radiomast', radiomast: 'radiomast',
  power: 'generator', lookout: 'watchtower', tower: 'watchtower', medbay: 'infirmary', clinic: 'infirmary',
  garden: 'garden', walls: 'palisade', wall: 'palisade', palisade: 'palisade',
});

/** Lobby-style listing of the hideouts (never merged into MAP_LIST). */
export const HIDEOUT_LIST = Object.freeze([
  {
    id: 'roadhouse', name: 'The Roadhouse', kind: 'hideout', modes: ['hideout'], chapters: [1, 2],
    description: 'A desert motel and diner on the highway shoulder: neon, string lights, a fire ring and a pickup that finally runs. The crew\'s first real shelter.',
  },
  {
    id: 'depot', name: 'Blackwater Depot', kind: 'hideout', modes: ['hideout'], chapters: [3, 4],
    description: 'A rail depot beside a water tower: boxcar bunks, a forge shed glowing in the dark, a dead locomotive and a greenhouse made of doors and windows.',
  },
  {
    id: 'farmstead', name: 'Harlan Farmstead', kind: 'hideout', modes: ['hideout'], chapters: [5, 6],
    description: 'A barn, a farmhouse porch, an orchard and a pond at golden hour. The crew takes a breath before the last road to Haven.',
  },
]);

/** Size and mood of every hideout (maps.js merges this into its MAP_DEFS). */
export const HIDEOUT_DEFS = Object.freeze({
  roadhouse: { width: 2200, height: 1600, darkness: 0.5, tint: '#2c4a78', ground: '#8b7853' },
  depot: { width: 2200, height: 1600, darkness: 0.52, tint: '#2f4a5a', ground: '#4a4a3c' },
  farmstead: { width: 2200, height: 1600, darkness: 0.46, tint: '#3a4a78', ground: '#45542c' },
});

/** Is `id` one of the hideouts? */
export function isHideoutId(id) {
  return typeof id === 'string' && HIDEOUT_IDS.includes(id);
}

/** Is `map` (MapDef or id) a hideout? */
export function isHideout(map) {
  return typeof map === 'string' ? isHideoutId(map) : !!map && map.kind === 'hideout';
}

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Upgrades

/**
 * Clean a `hideoutUpgrades` object from the story settings: known kinds only (aliases
 * accepted), whole tiers clamped to 0..3, missing = 0.
 * @param {object|null|undefined} raw
 * @returns {{ generator: number, watchtower: number, infirmary: number, armory: number, radiomast: number, garden: number, palisade: number }}
 */
export function normalizeUpgrades(raw) {
  const out = {};
  for (const k of UPGRADE_KINDS) out[k] = 0;
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) {
      const kind = UPGRADE_KINDS.includes(key) ? key : UPGRADE_ALIASES[key];
      if (!kind) continue;
      const v = Math.floor(Number(raw[key]));
      if (Number.isFinite(v)) out[kind] = Math.max(0, Math.min(UPGRADE_MAX_TIER, v));
    }
  }
  return out;
}

/**
 * Store the upgrade tiers on a hideout map for the renderers (`map.hub.upgrades`). Returns
 * the normalised object. Safe to call again when the crew buys an upgrade.
 * @param {object} map hideout MapDef
 * @param {object} raw settings.story.hideoutUpgrades
 */
export function applyHideoutUpgrades(map, raw) {
  const u = normalizeUpgrades(raw);
  if (map && map.hub) map.hub.upgrades = u;
  return u;
}

/**
 * What upgrade `kind` adds at `tier` (1..3), or, for tier 0, the unbuilt "site" that stands
 * on its slot before anything is built. Returns fresh copies:
 *   { kind, tier, slot, props: [{ t, x, y, a, ... }], lights: [{ x, y, r, color, flicker, h? }],
 *     fires: [{ x, y, r }], obstacles: [Obstacle-like records, drawn but never colliding] }
 * Props use the same `t` vocabulary as `hub.props` (HUB_PROP_KINDS).
 * @param {string} kind one of UPGRADE_KINDS
 * @param {number} tier 0..3
 * @param {object} hub map.hub of a hideout
 */
export function buildHideoutUpgrade(kind, tier, hub) {
  if (!UPGRADE_KINDS.includes(kind)) throw new Error(`Unknown hideout upgrade: ${kind}`);
  const t = Math.max(0, Math.min(UPGRADE_MAX_TIER, Math.floor(tier) || 0));
  const slot = hub && hub.upgradeSlots && hub.upgradeSlots[kind];
  if (!slot) throw new Error(`Hideout ${hub && hub.id} has no ${kind} slot`);
  const src = slot.tiers[t] || {};
  const copy = (list) => (list || []).map((e) => ({ ...e }));
  return {
    kind, tier: t,
    slot: { x: slot.x, y: slot.y, a: slot.a, r: slot.r },
    props: copy(src.props), lights: copy(src.lights), fires: copy(src.fires), obstacles: copy(src.obstacles),
  };
}

/**
 * Everything the built upgrades add, merged: the site of every kind that is at tier 0 plus the
 * tiers 1..n of the others.
 * @param {object} map hideout MapDef
 * @param {object} [upgrades] tiers (default: map.hub.upgrades, else all 0)
 */
export function hideoutUpgradeSet(map, upgrades) {
  const hub = map.hub;
  const u = normalizeUpgrades(upgrades || hub.upgrades);
  const out = { upgrades: u, props: [], lights: [], fires: [], obstacles: [] };
  for (const kind of UPGRADE_KINDS) {
    if (!hub.upgradeSlots[kind]) continue;
    const have = u[kind];
    const parts = have === 0 ? [buildHideoutUpgrade(kind, 0, hub)] : [];
    for (let t = 1; t <= have; t++) parts.push(buildHideoutUpgrade(kind, t, hub));
    for (const p of parts) {
      for (const e of p.props) out.props.push({ ...e, up: kind, tier: p.tier });
      for (const e of p.lights) out.lights.push({ ...e, up: kind, tier: p.tier });
      for (const e of p.fires) out.fires.push({ ...e, up: kind, tier: p.tier });
      for (const e of p.obstacles) out.obstacles.push({ ...e, up: kind, tier: p.tier });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The kit every hideout is written in

// ---------------------------------------------------------------------------------------------
// Registration (maps.js merges these into its builder table)

export const HIDEOUT_BUILDERS = { roadhouse: buildRoadhouse, depot: buildDepot, farmstead: buildFarmstead };

/** Validate the prop kinds a hideout uses (throws on a typo: the renderer would silently skip it). */
export function checkHub(map) {
  const PROPS = new Set(HUB_PROP_KINDS);
  const bad = [];
  const seen = (t) => { if (!PROPS.has(t)) bad.push(t); };
  for (const p of map.hub.props) seen(p.t);
  for (const o of map.obstacles) if (o.prop && !o.prop.startsWith('slot:')) seen(o.prop);
  if (map.objective && map.objective.prop) seen(map.objective.prop);
  for (const s of Object.values(map.hub.upgradeSlots)) for (const t of s.tiers) for (const p of t.props) seen(p.t);
  if (bad.length) throw new Error(`Unknown hub prop kinds in ${map.id}: ${[...new Set(bad)].join(', ')}`);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Set dressing (shared/dress.js hands a hideout to this instead of the road-debris recipes)

function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

/**
 * The dressing of a hideout: the hand placed list of the hub (`hub.dress`, most important
 * first, so a low quality tier keeps the props that make the place) plus a light scatter of
 * pebbles, flowers and tall grass on the open ground. Nothing lands inside an obstacle.
 * @param {object} map hideout MapDef
 * @returns {object[]} dress items { k, x, y, a, s, v, q }
 */
export function hideoutDressItems(map) {
  const hub = map.hub;
  const rng = createRng(hashString(`hubdress:${map.id}:${map.seed}`));
  const items = [];
  const blocked = (x, y, pad) => {
    if (map.obstacles.some((o) => inRect(o, x, y, pad))) return true;
    if (map.objective && inRect(map.objective, x, y, pad)) return true;
    if (map.areas.some((a) => a.kind === 'water' && inRect(a, x, y, pad))) return true;
    return false;
  };
  const list = hub.dress;
  const total = list.length + 90;
  list.forEach(([k, x, y, a, s], i) => {
    if (x < 24 || y < 24 || x > map.width - 24 || y > map.height - 24) return;
    items.push({ k, x: r1(x), y: r1(y), a: r3(a || 0), s: s || 1, v: (rng.next() * 65536) | 0, q: r3(i / total) });
  });
  // a light scatter of small nature, denser away from the paths
  const kinds = hub.scatter || ['pebbles', 'tallgrass', 'flowers', 'fern'];
  for (let i = 0; i < 90; i++) {
    const x = rng.range(40, map.width - 40), y = rng.range(40, map.height - 40);
    if (blocked(x, y, 14)) { rng.next(); continue; }
    const k = kinds[Math.floor(rng.next() * kinds.length)];
    items.push({ k, x: r1(x), y: r1(y), a: r3(rng.range(0, TAU)), s: r3(rng.range(0.8, 1.3)), v: (rng.next() * 65536) | 0, q: r3((list.length + i) / total) });
  }
  return items;
}
