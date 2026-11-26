// Blackwater Dam's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The dam
// authority's warnings (spillway, high voltage), years of water and rust down the concrete, moss at the
// foot of the walls, the engineers' tally in the control room and their fuel and oil in the turbine
// hall, and the survivors' marks pointing down the river road to the depot.

import { placeDecals } from '../decals.js';

const WET = ['stain.water', 'rust.streak1', 'rust.streak2', 'rust.streak3', 'moss.1', 'stain.damp', 'soot.streak2'];
const CONCRETE = ['crack.wall1', 'crack.wall2', 'spall.concrete1', 'spall.concrete2', 'stain.water'];

export const DECALS = [
  // ---- Canyon Road
  { w: 'sign.roadclosed', at: 'road_tunnel', z: 50 },
  { w: 'gfx.bitten', at: 'road_tunnel', dy: 140, z: 46 },
  { w: 'stain.water', at: 'road_tunnel', dy: -140, z: 80 },
  { scatter: ['oil.1', 'oil.2', 'tyre.skid', 'crack.floor1', 'puddle.rim1', 'puddle.rim2'], at: 'road_truck', r: 600, n: 14 },
  { farrow: 'gfx.arrow-white.worn', at: 'road_truck', dx: 500, dy: 60, toward: 'gate:spill_gate' },
  // ---- the spillway
  { walls: WET, at: 'spill_bridge', r: 500, n: 8, z: [30, 70] },
  { w: 'sign.spillway', at: 'spill_valve', z: 52, maxD: 580 },
  { w: 'sign.spillway.worn', at: 'gate:spill_gate', z: 50, maxD: 300 },
  { w: 'sign.hazard', at: 'spill_valve', dx: -90, z: 56, maxD: 580 },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'moss.2', 'lichen.1'], at: 'spill_bridge', r: 400, n: 8 },
  // ---- the control room
  { w: 'sign.highvoltage', at: 'control_door', z: 54 },
  { w: 'gfx.tally-days', at: 'control_panel', z: 50 },
  { w: 'sign.evacplan', at: 'control_panel', dx: 90, z: 52 },
  { w: 'flyer.haven-small', at: 'control_radio', z: 46 },
  { w: 'note.water', at: 'control_radio', dx: 60, z: 44 },
  { scatter: ['litter.paper1', 'litter.paper2', 'dust.drift', 'stain.rings'], at: 'control_panel', r: 220, n: 5 },
  // ---- the crest
  { walls: CONCRETE, at: 'crest_mid', r: 900, n: 10, z: [20, 40] },
  { w: 'stn.zone4.worn', at: 'crest_crane', z: 34 },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'crack.floor1', 'crack.floor2', 'moss.2'], at: 'crest_mid', r: 1200, n: 16 },
  // ---- the turbine hall
  { w: 'sign.highvoltage.worn', at: 'turbine_breaker', z: 56 },
  { w: 'sign.flammable', at: 'turbine_breaker', dx: 90, z: 52 },
  { w: 'stn.b12', at: 'turbine_floor', z: 80, maxD: 500 },
  { walls: WET.concat(['sign.hazard.worn', 'gfx.tag-rust']), at: 'turbine_floor', r: 700, n: 10, z: [34, 80] },
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'puddle.rim1', 'crack.floor2'], at: 'turbine_floor', r: 500, n: 12 },
  { arrow: 'gfx.arrow-white', at: 'turbine_exit', toward: 'river_boat', z: 46 },
  // ---- the river road to the depot
  { f: 'gfx.haven-mark', at: 'river_boat', dy: -140, a: 0 },
  { arrow: ['gfx.haven-r', 'gfx.haven-l'], at: 'depot_gate', dx: -300, toward: 'depot_gate', z: 50, maxD: 400 },
  { w: 'gfx.safe-mark', at: 'depot_gate', z: 46, maxD: 400 },
  { scatter: ['leaves.1', 'leaves.2', 'puddle.rim2', 'tyre.tread', 'oil.1'], at: 'sec:riverside', r: 1600, n: 18 },
];

/** Lay Blackwater Dam's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
