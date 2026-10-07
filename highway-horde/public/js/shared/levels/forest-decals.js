// Blackpine's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The forest
// takes everything back: leaves and moss over the trailhead, lichen on the walls; the ranger station
// still rates the fire danger EXTREME; campers left warnings at the showers; the lumber mill's saw
// floor is blood and oil; and at the Haskell farm fence the Haven mark and the safe sign say: here.

import { placeDecals } from '../decals.js';

const LEAVES = ['leaves.1', 'leaves.2', 'leaves.3', 'moss.2', 'lichen.1'];
const WALLS = ['moss.1', 'lichen.1', 'lichen.2', 'stain.water', 'grime.base3', 'peel.green'];

export const DECALS = [
  // ---- the trailhead
  { scatter: LEAVES, at: 'trail_car', r: 600, n: 18 },
  { scatter: ['blood.pool.dry', 'glass.shards', 'oil.1'], at: 'trail_car', r: 140, n: 3 },
  { w: 'sign.firedanger.worn', at: 'trail_map', z: 52, maxD: 540 },
  { w: 'poster.missing-okoye.worn', at: 'trail_map', dx: 80, z: 44, maxD: 540 },
  // ---- the campground
  { scatter: LEAVES, at: 'sec:campground', r: 1400, n: 30 },
  { scatter: ['scorch.small'], at: 'camp_fire', r: 30, n: 1 },
  { w: 'gfx.notsafe', at: 'camp_showers', z: 46 },
  { w: 'gfx.bitten.worn', at: 'camp_showers', dx: 90, z: 46 },
  { walls: WALLS, at: 'camp_showers', r: 400, n: 6, z: [20, 50] },
  { w: 'note.4alive.worn', at: 'camp_rv', z: 44, maxD: 300, on: /^bus:bp-rv/ },
  { trail: 'blood.drag-hands', path: ['camp_rv', [3700, 2900], [3500, 2600]], step: 74 },
  { gate: 'camp_gate', toward: 'trail_car', list: [['gfx.arrow-white.worn', 44, 140]] },
  // ---- the ranger station and the lookout
  { w: 'sign.firedanger', at: 'ranger_radio', z: 54 },
  { w: 'flyer.haven-small', at: 'ranger_radio', dx: 80, z: 44 },
  { w: 'gfx.tally-days', at: 'ranger_radio', dx: -80, z: 48 },
  { w: 'gfx.tally', at: 'ranger_lookout', z: 46, maxD: 520 },
  { walls: WALLS, at: 'ranger_truck', r: 600, n: 6, z: [20, 50] },
  { scatter: LEAVES.concat(['oil.1', 'tyre.tread']), at: 'ranger_truck', r: 600, n: 14 },
  // ---- the gorge
  { scatter: LEAVES.concat(['crack.floor1']), at: 'gorge_bridge', r: 700, n: 14 },
  { scatter: ['blood.splat1', 'blood.splat3', 'blood.prints-bare'], at: 'gorge_far', r: 260, n: 4 },
  // ---- Harlan Lumber
  { w: 'sign.hazard', at: 'mill_saw', z: 56 },
  { w: 'blood.spray', at: 'mill_saw', dx: 90, z: 42 },
  { w: 'gfx.tally-days.worn', at: 'mill_office', z: 48 },
  { w: 'poster.missing-reyes.torn', at: 'mill_office', dx: 70, z: 44 },
  { walls: ['rust.streak1', 'rust.streak2', 'stain.water', 'grime.base1', 'gfx.tag-rust', 'gfx.headshots'], at: 'mill_yard', r: 800, n: 8, z: [24, 60] },
  { scatter: ['oil.1', 'oil.2', 'sand.drift1', 'blood.pool', 'tyre.tread', 'leaves.2'], at: 'mill_yard', r: 700, n: 14 },
  { scatter: ['blood.pool', 'blood.splat2', 'oil.3', 'sand.drift2'], at: 'mill_saw', r: 220, n: 5 },
  // ---- the farm fence: home
  { f: 'gfx.haven-mark', at: 'farm_gate', dx: -220, a: Math.PI / 2 },
  { f: 'gfx.safe-mark', at: 'farm_gate', dx: -220, dy: 160, a: 0 },
  { scatter: ['scorch.small'], at: 'farm_signal', r: 20, n: 1 },
  { scatter: LEAVES, at: 'farm_gate', r: 500, n: 10 },
];

/** Lay Blackpine's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
