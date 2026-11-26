// Fort Harlan's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The army's
// own paint: military-installation warnings at the gate, stencilled zone and hangar numbers, the
// search code ARMY / GAS / 11, curfew and TRUST THE GUARD in the mess, a firefight in bullet holes
// along the barracks, Okafor's eleven counting days on the tower, fuel and skids on the flight line.

import { placeDecals } from '../decals.js';

const ARMY = ['stn.military', 'stn.military.worn', 'stn.zone4', 'stn.keepout', 'stn.cleared', 'sign.restricted', 'sign.military.worn'];
const FIGHT = ['holes.concrete', 'holes.concrete-line', 'holes.metal', 'holes.metal-line', 'blood.spray', 'scorch.wall'];

export const DECALS = [
  // ---- the perimeter and the main gate
  { w: 'sign.military', at: 'guard_post', z: 52 },
  { w: 'sign.airfield', at: 'perimeter_gate', z: 56, maxD: 400 },
  { w: 'gfx.xcode-4', at: 'guard_post', dx: 90, z: 48 },
  { walls: ARMY, at: 'perimeter_gate', r: 700, n: 6, z: [40, 60] },
  { scatter: ['oil.1', 'tyre.skid', 'tyre.tread', 'puddle.rim1', 'puddle.rim2', 'blood.pool.dry'], at: 'perimeter_gate', r: 700, n: 14 },
  // ---- the barracks
  { w: 'sign.restricted.worn', at: 'barracks_armory', z: 56 },
  { w: 'stn.b12', at: 'barracks_armory', dx: 90, z: 60 },
  { w: 'poster.trustguard', at: 'barracks_mess', z: 44, maxD: 320 },
  { w: 'notice.curfew', at: 'barracks_mess', dx: 50, z: 44 },
  { w: 'poster.reportbites.worn', at: 'barracks_mess', dx: -50, z: 44 },
  { walls: FIGHT, at: 'barracks_armory', r: 700, n: 10, z: [30, 56] },
  { walls: FIGHT, at: 'barracks_mess', r: 700, n: 6, z: [30, 56] },
  { w: 'gfx.tally-days', at: 'barracks_armory', dy: 160, z: 48, maxD: 400 },
  { scatter: ['blood.pool', 'blood.splat1', 'blood.splat3', 'blood.drag', 'scorch.small', 'puddle.rim1'], at: 'barracks_yard', r: 500, n: 12 },
  { f: 'stn.keepout.worn', at: 'gate:hangar_fence', dx: -150, a: Math.PI / 2 },
  // ---- hangar row
  { w: 'stn.hangar2', at: 'hangar_doors', z: 120, maxD: 400 },
  { w: 'sign.flammable', at: 'hangar_doors', dx: 140, z: 52, maxD: 300 },
  { f: 'stn.decon', at: 'fuel_depot', dx: -200, a: 0 },
  { walls: ['rust.streak1', 'rust.streak2', 'stain.water', 'soot.streak1', 'holes.metal'], at: 'hangar_plane', r: 700, n: 8, z: [40, 110] },
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'tyre.skid', 'puddle.rim1', 'crack.floor1'], at: 'hangar_plane', r: 700, n: 16 },
  { scatter: ['oil.1', 'oil.3', 'puddle.rim2'], at: 'fuel_depot', r: 300, n: 6 },
  // ---- the control tower
  { w: 'gfx.tally', at: 'tower_radio', z: 48 },
  { w: 'flyer.haven-small', at: 'tower_radio', dx: 70, z: 44 },
  { w: 'stn.zone4', at: 'tower_stairs', z: 54 },
  { w: 'gfx.help4alive', at: 'tower_stairs', dy: 200, z: 70, maxD: 400 },
  // ---- runway 27: skids, flares, the end
  { scatter: ['tyre.skid', 'tyre.skid', 'oil.2', 'crack.floor2', 'puddle.rim1'], at: 'sec:runway', r: 1600, n: 26 },
  { scatter: ['scorch.small'], at: 'runway_flares', r: 300, n: 4 },
  { farrow: 'gfx.arrow-orange', at: 'runway_end', dx: -500, toward: 'runway_end' },
];

/** Lay Fort Harlan's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
