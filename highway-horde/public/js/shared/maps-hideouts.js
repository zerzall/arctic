// The three hideouts of the story campaign (STORY.md §4, §5.2): safe, walkable hub maps
// where the crew rests between missions. Built with the same builder vocabulary as the
// battlefields (maps.js `createBuilder`), so `buildMap('roadhouse' | 'depot' | 'farmstead',
// seed)` returns an ordinary MapDef that the simulation, the flow field and both renderers
// already understand, plus the hub data the story layer plugs into:
//
//   map.kind          'hideout'
//   map.hub           { id, name, chapters, defaultTime, spawn, bounds, stations[], npcs[],
//                       upgradeSlots{}, range, props[], dress[], look }
//   map.interactables [{ id, kind, x, y, r, label, hold: 0 }]  one per station (id = station id)
//
// The hideouts are NOT in MAP_LIST (the lobby never offers them). Their layout is hand made
// and identical for every seed; the seed only moves the small scatter (tufts, pebbles).
//
// SEAMS (documented in SPEC §3.9):
//   * Stations  hub.stations[] = { id, kind, x, y, r, label, h } — `kind` is one of
//     STATION_KINDS. The matching interactable has the same id/kind/x/y/r, `hold: 0`.
//   * NPCs      hub.npcs[] = { id, name, role, x, y, angle, pose, z?, recruit? } — idle spots for
//     the NPC layer (S2). `recruit` = story flag id the NPC needs before it appears.
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

export const HIDEOUT_IDS = Object.freeze(['roadhouse', 'depot', 'farmstead']);

/** Station kinds (STORY.md §4). */
export const STATION_KINDS = Object.freeze(['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'bed', 'range', 'campfire']);

/** Hideout upgrades (STORY.md §4): each has tiers 1..3, all visible in the hub. */
export const UPGRADE_KINDS = Object.freeze(['generator', 'watchtower', 'infirmary', 'armory', 'radiomast', 'garden', 'palisade']);
export const UPGRADE_MAX_TIER = 3;
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
const PI = Math.PI;

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

/**
 * Prop kinds the 3D renderer models (render3d/world-hideout*.js). `hub.props[].t`, the
 * upgrade tiers' props and the obstacles' `prop` field draw from this list; tests check
 * that the renderer registry has a model for each.
 */
export const HUB_PROP_KINDS = Object.freeze([
  // obstacle overrides (an obstacle's `prop`)
  'perimeter', 'logseat', 'campring', 'maptable', 'workbench', 'signboard', 'rangebench', 'rhdiner', 'rhoffice',
  'gate', 'lowfence', 'crate', 'tarpcrates', 'car_wreck', 'bunkhouse',
  // free props
  'stringlights', 'lantern', 'signpole', 'paintedsign', 'picnic', 'couch', 'guitar', 'cat', 'photowall', 'pinboard',
  'bedlamp', 'lookoutnest', 'roofantenna', 'bunting', 'oildrum', 'pergola', 'leanto', 'sandbagnest', 'floodlight',
  'clothesline', 'mailbox', 'barrels', 'woodpile', 'campchairs', 'radiotable', 'tools',
  // upgrade models (parametrised by tier)
  'up_generator', 'up_watchtower', 'up_infirmary', 'up_armory', 'up_radiomast', 'up_garden', 'up_palisade',
]);

/** Extra kind lists of the other hideouts are appended by their own builders (see below). */
const PROPS = new Set(HUB_PROP_KINDS);

function kit(B, id, name, opts) {
  const map = B.map;
  map.kind = 'hideout';
  map.interactables = [];
  const hub = {
    id, name, chapters: opts.chapters.slice(), defaultTime: opts.defaultTime || 'night',
    spawn: null, bounds: opts.bounds, stations: [], npcs: [], upgradeSlots: {}, range: null,
    props: [], dress: [], look: opts.look || {}, upgrades: normalizeUpgrades(null),
  };
  map.hub = hub;
  const K = {
    hub,
    /** A free prop (no collision). */
    prop(t, x, y, a = 0, o = {}) {
      hub.props.push({ t, x: r1(x), y: r1(y), a: r3(a), ...o });
    },
    /** An obstacle whose model the hub renderer supplies (`prop`). Returns the obstacle. */
    ob(kind, prop, x, y, w, h, a = 0, o = {}) {
      const { arch, lit, top, sign, ...rest } = o;
      const ob = B.ob(kind, x, y, w, h, a, { ...rest, top });
      if (prop) ob.prop = prop;
      if (arch) ob.arch = arch;
      if (lit !== undefined) ob.lit = lit;
      if (sign) ob.sign = sign;
      return ob;
    },
    /** A permanent fire with its own (bigger) light. */
    fire(x, y, r, lightR, color) {
      B.fire(x, y, r);
      const l = B.map.lights[B.map.lights.length - 1];
      if (lightR) l.r = lightR;
      if (color) l.color = color;
    },
    /** A steady lamp at height h. */
    lamp(x, y, h, r, color, flicker = 0) {
      B.light(x, y, r, color, flicker, h);
    },
    station(id, kind, x, y, r, label, o = {}) {
      const st = { id, kind, x: r1(x), y: r1(y), r, label, h: o.h ?? 90 };
      hub.stations.push(st);
      map.interactables.push({ id, kind, x: st.x, y: st.y, r, label, hold: 0 });
      return st;
    },
    npc(id, name, role, x, y, angle, pose, o = {}) {
      hub.npcs.push({ id, name, role, x: r1(x), y: r1(y), angle: r3(angle), pose, ...o });
    },
    /**
     * An upgrade slot. `tiers` = [site, tier1, tier2, tier3], each { props, lights, fires,
     * obstacles }; the slot's own obstacle (footprint) is created by the caller.
     */
    slot(kind, x, y, a, r, label, tiers) {
      hub.upgradeSlots[kind] = { kind, x: r1(x), y: r1(y), a: r3(a), r, label, maxTier: UPGRADE_MAX_TIER, tiers };
    },
    /** Hand placed set dressing (shared/dress.js kinds): [kind, x, y, angle, scale]. */
    dress(list) {
      for (const d of list) hub.dress.push(d);
    },
    spawns(cx, cy, rad, n, start = 0) {
      hub.spawn = { x: cx, y: cy, r: rad };
      for (let i = 0; i < n; i++) {
        const a = start + (i / n) * TAU;
        B.pspawn(r1(cx + Math.cos(a) * rad), r1(cy + Math.sin(a) * rad));
      }
    },
  };
  return K;
}

/** A tier record, tidy to write. */
const tier = (o = {}) => ({ props: o.props || [], lights: o.lights || [], fires: o.fires || [], obstacles: o.obstacles || [] });

// ---------------------------------------------------------------------------------------------
// 1. The Roadhouse (chapters 1–2): a desert motel and diner on the highway shoulder
//
//   north row (facing the yard): the motel (300..1500), the office with the radio room and the
//   diner; a west wing of motel rooms; a fire ring with log seats in the middle of the yard;
//   the mission table by the office, the workbench lean-to and generator on the east side, the
//   armory and infirmary tents beside the west wing, a garden plot in the south-west corner, the
//   shooting range in the south-east corner and the gate to the highway in the south wall.

function buildRoadhouse(B) {
  const K = kit(B, 'roadhouse', 'The Roadhouse', {
    chapters: [1, 2], defaultTime: 'night', bounds: { x0: 200, y0: 210, x1: 2020, y1: 1352 },
    look: { night: { grade: { saturation: 1.0, contrast: 1.07, lift: [0.012, 0.010, 0.020], gain: [1.06, 1.0, 0.94] } } },
  });
  const CF = { x: 1080, y: 880 };   // the campfire

  // ---- objective (the diner), supply (the armory stash) and the party's start
  B.objective('diner', 'The Roadhouse Diner', 1760, 290, 300, 170, 0, 1, 40);
  B.map.objective.prop = 'rhdiner';
  B.supply(560, 610);
  K.spawns(CF.x, CF.y, 205, 8, 0.3);

  // ---- ground: desert, the packed yard, the walkway, the old parking lot, the highway
  B.box('sand', 0, 0, 2200, 1600);
  B.box('dirt', 150, 140, 2050, 1372);
  B.box('gravel', 560, 980, 1450, 1372);
  B.box('asphalt', 640, 1040, 1430, 1350);
  B.box('concrete', 300, 305, 1510, 372);
  B.box('concrete', 1610, 375, 1912, 484);
  B.box('concrete', 296, 300, 366, 860);
  B.box('gravel', 0, 1372, 2200, 1432);
  B.box('asphalt', 0, 1432, 2200, 1592);
  B.line('yellow_double', 0, 1512, 2200, 1512, 4);
  B.line('white', 0, 1446, 2200, 1446, 3);
  B.line('white', 0, 1578, 2200, 1578, 3);
  for (let x = 700; x <= 1360; x += 82) B.line('parking', x, 1050, x, 1112, 3);
  B.line('white', 640, 1112, 1430, 1112, 3);
  // packed earth paths worn by boots
  B.area('gravel', 1080, 1110, 130, 460, 0);
  B.area('gravel', 1300, 610, 620, 110, 0.05);
  B.area('gravel', 1740, 640, 300, 120, 1.1);
  B.area('sand', 500, 1110, 520, 260, 0.1);
  B.area('dirt', 560, 1150, 420, 240, 0.12);        // the garden plot

  // ---- the perimeter (scrap fence; the palisade upgrade dresses it): thick so nobody hops it
  const per = (x, y, w, h) => K.ob('wall', 'perimeter', x, y, w, h, 0, { color: '#6b5a44' });
  per(1100, 172, 1900, 66);            // north, behind the buildings
  per(1100, 1362, 1900, 20);           // south (the gate is drawn on it)
  per(170, 790, 40, 1170);             // west
  per(2040, 790, 40, 1170);            // east

  // ---- the motel: north block and west wing (their fronts face the yard)
  K.ob('building', null, 900, 255, 1200, 100, 0, { color: '#cdb48c', roof: '#5c4a3a', top: 132, arch: 'motel', lit: 0.55 });
  K.ob('building', null, 245, 565, 520, 100, -PI / 2, { color: '#c9ae86', roof: '#5c4a3a', top: 132, arch: 'motel', lit: 0.5 });
  // the office and its radio room
  K.ob('building', 'rhoffice', 1555, 262, 112, 112, 0, { color: '#7d9089', roof: '#4a4038', top: 128, arch: 'house', lit: 1 });

  // ---- the fire ring, its log seats, a couch
  K.ob('pillar', 'campring', CF.x, CF.y, 58, 58, 0, { color: '#6d6a63' });
  K.fire(CF.x, CF.y, 21, 470, '#ff9a4a');
  const seats = [];
  for (let k = 0; k < 8; k++) {
    if (k === 5 || k === 6) continue;
    const ang = 0.35 + (k / 8) * TAU;
    const sx = CF.x + Math.cos(ang) * 128, sy = CF.y + Math.sin(ang) * 118;
    seats.push([r1(sx), r1(sy), r3(ang + PI / 2)]);
    K.ob('rock', 'logseat', sx, sy, 66, 24, ang + PI / 2, { solid: false, color: '#5b4128' });
  }
  K.ob('rock', 'couch', 930, 792, 92, 34, -0.45, { solid: false, color: '#6a3f34' });

  // ---- gate, the repaired pickup, oil drum fires and the sandbag-and-pallet funnel
  K.prop('gate', 1080, 1362, 0, { w: 240 });
  B.vehicle('pickup', 900, 1296, 0.38, { color: '#b5482f', jitter: 0 });
  B.vehicle('car', 1290, 1300, -0.25, { color: '#59606a', wrecked: true, jitter: 0 }).prop = 'car_wreck';
  B.fire(1185, 1300, 14);
  B.fire(985, 1225, 14);
  for (const [x, y, w, a] of [[1010, 1332, 150, 0], [1190, 1334, 130, 0.05]]) B.ob('sandbags', x, y, w, 26, a, { color: '#8a7a55' });
  B.ob('barrier', 1082, 1328, 70, 26, 0.1, { color: '#a89a60' });
  K.lamp(1080, 1330, 150, 300, '#ffc27a', 0);

  // ---- the stations
  // mission table with the map and the radio (lean-to canopy over it)
  K.ob('counter', 'maptable', 1560, 480, 128, 66, 0, { color: '#6b4a2c' });
  K.station('board', 'board', 1560, 480, 112, 'Mission board', { h: 84 });
  K.prop('leanto', 1560, 462, 0, { w: 190, d: 120, hi: 104, lo: 82, tilt: 'south', cloth: '#7a6a4a' });
  // the upgrade board on the diner's apron
  K.ob('booth', 'signboard', 1790, 478, 122, 26, 0, { color: '#5a4630' });
  K.station('upgrades', 'upgrades', 1790, 478, 100, 'Upgrade board', { h: 96 });
  // workbench under a corrugated lean-to, a drum fire beside it
  K.ob('counter', 'workbench', 1900, 700, 112, 60, PI / 2, { color: '#4a4e52' });
  K.station('workbench', 'workbench', 1900, 700, 112, 'Workbench', { h: 80 });
  K.prop('leanto', 1935, 700, PI / 2, { w: 200, d: 150, hi: 110, lo: 86, tilt: 'east', metal: true });
  B.fire(1962, 772, 14);
  B.fire(1830, 620, 14);
  // your room: a motel door with a lamp and a mat
  K.station('bed', 'bed', 1210, 350, 84, 'Your room', { h: 80 });
  K.prop('bedlamp', 1210, 322, PI / 2);
  // the campfire itself
  K.station('campfire', 'campfire', CF.x, CF.y, 150, 'Campfire', { h: 110 });
  // the shooting range
  K.ob('counter', 'rangebench', 1526, 1150, 40, 160, 0, { color: '#5a4630' });
  K.station('range', 'range', 1470, 1150, 105, 'Shooting range', { h: 70 });
  K.hub.range = {
    line: { x: 1500, y: 1150, a: 0 },
    targets: [
      { id: 'r1', x: 1700, y: 1092, a: PI },
      { id: 'r2', x: 1800, y: 1150, a: PI },
      { id: 'r3', x: 1910, y: 1208, a: PI },
      { id: 'r4', x: 1990, y: 1108, a: PI },
    ],
    backstop: { x: 2010, y0: 1040, y1: 1330 },
  };
  for (const [x, y, w, h, a] of [[2004, 1092, 26, 120, 0], [2004, 1244, 26, 150, 0]]) B.ob('sandbags', x, y, h, w, a + PI / 2, { color: '#8a7a55' });

  // ---- upgrade slots (footprints are real; tiers add the visible parts)
  const GEN = { x: 1975, y: 905 };
  K.ob('container', 'slot:generator', GEN.x, GEN.y, 76, 52, 0, { color: '#48544a' });
  K.slot('generator', GEN.x, GEN.y, 0, 90, 'Generator', [
    tier({ props: [{ t: 'up_generator', tier: 0, x: GEN.x, y: GEN.y, a: 0 }] }),
    tier({
      props: [{ t: 'up_generator', tier: 1, x: GEN.x, y: GEN.y, a: 0 }, { t: 'stringlights', id: 'g1', pts: [[1890, 640, 96], [1935, 610, 112], [1980, 640, 96]], sag: 6 }],
      lights: [{ x: 1900, y: 700, r: 300, color: '#ffd9a0', h: 96 }, { x: 1975, y: 905, r: 200, color: '#ffe2b8', h: 80 }],
    }),
    tier({
      props: [
        { t: 'up_generator', tier: 2, x: GEN.x, y: GEN.y, a: 0 },
        { t: 'stringlights', id: 'g2a', pts: [[330, 350, 104], [560, 420, 128], [800, 500, 136], [1080, 700, 150]], sag: 12 },
        { t: 'stringlights', id: 'g2b', pts: [[1080, 700, 150], [1330, 620, 132], [1560, 430, 118]], sag: 12 },
      ],
      lights: [{ x: 1080, y: 700, r: 420, color: '#ffcf8a', h: 150 }, { x: 800, y: 500, r: 300, color: '#ffcf8a', h: 130 }],
    }),
    tier({
      props: [
        { t: 'up_generator', tier: 3, x: GEN.x, y: GEN.y, a: 0 },
        { t: 'stringlights', id: 'g3a', pts: [[1080, 700, 150], [900, 1000, 150], [720, 1120, 118]], sag: 12 },
        { t: 'stringlights', id: 'g3b', pts: [[1080, 700, 150], [1300, 1000, 140], [1500, 1120, 118]], sag: 12 },
        { t: 'floodlight', x: 900, y: 320, z: 140, aim: PI / 2 }, { t: 'floodlight', x: 1300, y: 320, z: 140, aim: PI / 2 },
      ],
      lights: [{ x: 900, y: 420, r: 420, color: '#fff0d6', h: 150 }, { x: 1300, y: 420, r: 420, color: '#fff0d6', h: 150 }, { x: 1080, y: 1050, r: 420, color: '#ffd9a0', h: 150 }],
    }),
  ]);

  const WT = { x: 1420, y: 1298 };
  K.ob('watchtower', 'slot:watchtower', WT.x, WT.y, 58, 58, 0, { color: '#5b4a36' });
  K.slot('watchtower', WT.x, WT.y, 0, 100, 'Watchtower', [
    tier({ props: [{ t: 'up_watchtower', tier: 0, x: WT.x, y: WT.y, a: 0 }] }),
    tier({ props: [{ t: 'up_watchtower', tier: 1, x: WT.x, y: WT.y, a: 0 }], lights: [{ x: WT.x, y: WT.y, r: 300, color: '#ffc27a', h: 190 }] }),
    tier({ props: [{ t: 'up_watchtower', tier: 2, x: WT.x, y: WT.y, a: 0 }], lights: [] }),
    tier({ props: [{ t: 'up_watchtower', tier: 3, x: WT.x, y: WT.y, a: 0 }], lights: [] }),
  ]);

  const INF = { x: 505, y: 800 };
  K.ob('tent', 'slot:infirmary', INF.x, INF.y, 150, 104, 0, { color: '#c9c4b0', roof: '#d8d4c0' });
  K.station('infirmary', 'infirmary', INF.x, INF.y, 118, 'Infirmary', { h: 100 });
  K.slot('infirmary', INF.x, INF.y, 0, 118, 'Infirmary', [
    tier({ props: [{ t: 'up_infirmary', tier: 0, x: INF.x, y: INF.y, a: 0 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 1, x: INF.x, y: INF.y, a: 0 }], lights: [{ x: INF.x + 80, y: INF.y, r: 260, color: '#ff8a80', h: 70 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 2, x: INF.x, y: INF.y, a: 0 }], lights: [{ x: INF.x, y: INF.y, r: 260, color: '#f4f7ff', h: 70 }] }),
    tier({ props: [{ t: 'up_infirmary', tier: 3, x: INF.x, y: INF.y, a: 0 }] }),
  ]);

  const ARM = { x: 505, y: 470 };
  K.ob('tent', 'slot:armory', ARM.x, ARM.y, 150, 104, 0, { color: '#4b5320', roof: '#5a6340' });
  K.station('armory', 'armory', ARM.x, ARM.y, 118, 'Armory', { h: 100 });
  K.slot('armory', ARM.x, ARM.y, 0, 118, 'Armory', [
    tier({ props: [{ t: 'up_armory', tier: 0, x: ARM.x, y: ARM.y, a: 0 }] }),
    tier({ props: [{ t: 'up_armory', tier: 1, x: ARM.x, y: ARM.y, a: 0 }], lights: [{ x: ARM.x + 70, y: ARM.y, r: 240, color: '#ffd090', h: 74 }] }),
    tier({ props: [{ t: 'up_armory', tier: 2, x: ARM.x, y: ARM.y, a: 0 }] }),
    tier({ props: [{ t: 'up_armory', tier: 3, x: ARM.x, y: ARM.y, a: 0 }] }),
  ]);

  const MAST = { x: 1978, y: 330 };
  K.ob('pillar', 'slot:radiomast', MAST.x, MAST.y, 26, 26, 0, { color: '#8a8e92' });
  K.slot('radiomast', MAST.x, MAST.y, 0, 90, 'Radio mast', [
    tier({ props: [{ t: 'up_radiomast', tier: 0, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 1, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 2, x: MAST.x, y: MAST.y, a: 0 }] }),
    tier({ props: [{ t: 'up_radiomast', tier: 3, x: MAST.x, y: MAST.y, a: 0 }] }),
  ]);

  const GAR = { x: 500, y: 1150, w: 430, h: 250 };
  for (const [x, y, w, h] of [[GAR.x, GAR.y - GAR.h / 2, GAR.w, 10], [GAR.x, GAR.y + GAR.h / 2, GAR.w, 10], [GAR.x - GAR.w / 2, GAR.y, 10, GAR.h], [GAR.x + GAR.w / 2, GAR.y - 84, 10, 84]]) {
    K.ob('wall', 'slot:garden', x, y, w, h, 0, { color: '#6b5433', solid: true });
  }
  K.slot('garden', GAR.x, GAR.y, 0, 150, 'Garden', [
    tier({ props: [{ t: 'up_garden', tier: 0, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 1, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 2, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
    tier({ props: [{ t: 'up_garden', tier: 3, x: GAR.x, y: GAR.y, a: 0, w: GAR.w, h: GAR.h }] }),
  ]);

  K.slot('palisade', 1100, 1362, 0, 400, 'Palisade', [
    tier({ props: [{ t: 'up_palisade', tier: 0, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 1, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 2, x: 1100, y: 1362, a: 0 }] }),
    tier({ props: [{ t: 'up_palisade', tier: 3, x: 1100, y: 1362, a: 0 }] }),
  ]);

  // ---- lived-in details (no collision)
  K.prop('picnic', 1350, 740, 0.2, { game: 'checkers' });
  K.prop('guitar', 1000, 950, 0.6);
  K.prop('cat', 1760, 1130, 0);
  K.prop('photowall', 1690, 400, PI / 2);
  K.prop('pinboard', 1520, 336, PI / 2, { kids: true });
  K.prop('paintedsign', 1080, 1338, PI / 2, { text: 'HAVEN OR BUST', w: 190, h: 40, z: 92 });
  K.prop('signpole', 1560, 1332, 0, { text: 'ROADHOUSE', sub: 'VACANCY', h: 250 });
  K.prop('lookoutnest', 1835, 292, 0, { z: 96 });
  K.prop('roofantenna', 1555, 262, 0, { z: 128 });
  K.prop('bunting', 0, 0, 0, { pts: [[300, 340, 108], [900, 346, 108], [1500, 340, 108]] });
  K.prop('stringlights', 0, 0, 0, { id: 'base1', pts: [[300, 372, 100], [520, 480, 122], [820, 600, 138], [1080, 712, 150]], sag: 14 });
  K.prop('stringlights', 0, 0, 0, { id: 'base2', pts: [[1500, 372, 100], [1360, 560, 120], [1200, 700, 140], [1080, 712, 150]], sag: 14 });
  for (const [x, y] of [[1000, 900], [1160, 850], [1120, 950], [340, 700], [1650, 650], [1830, 900]]) K.prop('lantern', x, y, 0, { z: 8 });
  K.lamp(1080, 712, 150, 360, '#ffc98a');
  K.lamp(800, 520, 130, 300, '#ffc98a');
  K.lamp(1330, 560, 120, 280, '#ffc98a');
  K.lamp(330, 480, 110, 240, '#ffc98a');
  K.lamp(1560, 372, 100, 260, '#ffd6a0');
  K.lamp(1795, 396, 100, 260, '#ffd6a0');
  K.lamp(1215, 372, 100, 240, '#ffd6a0');
  K.lamp(1560, 1310, 190, 380, '#ff5a9c');
  K.lamp(1420, 1240, 70, 240, '#ffb060', 0.4);

  // ---- NPCs: idle spots (sitting by the fire, one on the lookout, one at the workbench...)
  K.npc('mara', 'Mara Voss', 'medic', 612, 800, 0, 'stand', { station: 'infirmary' });
  K.npc('deke', 'Deke Harlan', 'mechanic', 1852, 712, 0.1, 'work', { station: 'workbench' });
  K.npc('ozzy', 'Ozzy', 'radio', 1560, 432, PI / 2, 'stand', { station: 'board' });
  K.npc('june', 'June', 'kid', 1002, 930, -0.55, 'sit');
  K.npc('lookout', 'Lookout', 'guard', 1838, 296, PI / 2, 'watch', { z: 98 });

  K.dress(ROADHOUSE_DRESS);
}

// [kind, x, y, angle, scale] — DRESS_KINDS of dress.js. Order = importance (first = always shown).
const ROADHOUSE_DRESS = [
  ['clothes', 1041, 972, 0.3, 1], ['cooler', 1180, 930, 0.4, 1], ['vend', 352, 338, PI / 2, 1], ['bench', 700, 344, PI / 2, 1],
  ['bench', 1030, 346, PI / 2, 1], ['laundry', 402, 610, PI / 2, 1], ['grill', 1325, 690, -0.6, 1], ['generator', 1940, 820, 0, 1],
  ['woodpile', 1780, 690, 0.4, 1], ['crates', 1850, 800, 0.5, 1], ['drums', 1985, 780, 0, 1], ['tent_camp', 690, 1180, 0.3, 1],
  ['tent_camp', 770, 1250, -0.4, 1], ['bicycle', 760, 900, 1.2, 1], ['planter', 322, 400, 0, 1], ['planter', 322, 760, 0, 1],
  ['gnome', 330, 690, 1, 1], ['beachball', 940, 960, 0, 1], ['teddy', 1062, 990, 0.5, 1], ['mailbox', 1010, 1340, PI / 2, 1],
  ['hydrant', 644, 344, 0, 1], ['bin', 1470, 350, 0, 1], ['bin', 1480, 360, 0.5, 1], ['shrine', 1690, 440, PI / 2, 1],
  ['sawhorse', 900, 1330, 0.1, 1], ['cone_up', 1240, 1330, 0, 1], ['cone_up', 950, 1335, 0, 1], ['fuel_can', 936, 1270, 0.3, 1],
  ['fuel_can', 948, 1262, 1.3, 1], ['tarp', 780, 1300, 0.6, 1], ['pallets', 1600, 1300, 0.3, 1], ['pallet', 1560, 1240, 0.9, 1],
  ['wheelbarrow', 640, 1290, 0.7, 1], ['trough', 700, 1040, 0, 1], ['chair', 1100, 1000, -1.2, 1], ['chair', 1220, 800, 2.4, 1],
  ['chair', 1360, 800, 0.4, 1], ['sleeping_bag', 700, 1140, 0.3, 1], ['flowers', 1490, 336, 0, 1], ['flowers', 380, 340, 0, 1],
  ['cactus', 90, 300, 0, 1.1], ['cactus', 260, 60, 0, 0.9], ['cactus', 2120, 1000, 0, 1.2], ['cactus', 2080, 300, 0, 1], ['cactus', 120, 1240, 0, 0.9],
  ['boulders', 90, 800, 0.4, 1.3], ['boulders', 2130, 640, 0, 1.4], ['boulders', 1500, 90, 0, 1.2], ['tumbleweed', 200, 1500, 0, 1],
  ['tumbleweed', 1700, 1400, 0, 1], ['pole', 200, 1400, 0, 1], ['pole', 1000, 1400, 0, 1], ['pole', 1800, 1400, 0, 1],
  ['rsign', 480, 1400, PI, 1], ['rsign', 1720, 1400, 0, 1], ['shrub', 240, 1080, 0, 1], ['shrub', 1990, 560, 0, 1],
];

// ---------------------------------------------------------------------------------------------
// Registration (maps.js merges these into its builder table)

export const HIDEOUT_BUILDERS = { roadhouse: buildRoadhouse };

/** Validate the prop kinds a hideout uses (throws on a typo: the renderer would silently skip it). */
export function checkHub(map) {
  const bad = [];
  const seen = (t) => { if (!PROPS.has(t)) bad.push(t); };
  for (const p of map.hub.props) seen(p.t);
  for (const o of map.obstacles) if (o.prop && !o.prop.startsWith('slot:')) seen(o.prop);
  if (map.objective && map.objective.prop) seen(map.objective.prop);
  for (const s of Object.values(map.hub.upgradeSlots)) for (const t of s.tiers) for (const p of t.props) seen(p.t);
  if (bad.length) throw new Error(`Unknown hub prop kinds in ${map.id}: ${[...new Set(bad)].join(', ')}`);
  return map;
}
