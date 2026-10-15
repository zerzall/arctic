// Westgate's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The car park
// is skid marks and oil; the mall's walls still sell (sale stars, Red Rocket, Night Shift) under the
// army's notices; Priya's security office says STAY OUT; the food court freezer says DON'T OPEN, DEAD
// INSIDE; the garage is tagged by the old crews and the dock points west.

import { placeDecals } from '../decals.js';

const W = ['gfx.haven-r', 'gfx.haven-l'];
const SHOP = ['sign.mallsale', 'sign.mallsale.worn', 'poster.cola', 'poster.movie', 'poster.movie.torn', 'poster.gig.worn', 'poster.stayinside', 'notice.evac.worn', 'poster.missing-okoye'];
const MESS = ['litter.paper1', 'litter.paper2', 'litter.paper3', 'glass.shards', 'blood.splat2', 'blood.splat3.dry', 'blood.prints', 'dust.drift'];
const TAGS = ['gfx.tag-kraz', 'gfx.tag-soke', 'gfx.tag-zek', 'gfx.throw-okr', 'gfx.throw-doom', 'gfx.tag-moe', 'gfx.skull', 'gfx.nowayout'];

export const DECALS = [
  // ---- the car park
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'tyre.skid', 'crack.floor1', 'puddle.rim1', 'litter.paper2', 'blood.pool.dry'], at: 'sec:lot', r: 1500, n: 30 },
  { scatter: ['blood.pool', 'blood.splat1', 'glass.shards'], at: 'lot_cart', r: 200, n: 4 },
  { trail: 'blood.drag', path: ['lot_cart', [1500, 2400], [2200, 2300]], step: 76 },
  { walls: SHOP, at: 'mall_entrance', r: 400, n: 8, z: [36, 48] },
  { w: 'gfx.notsafe', at: 'mall_entrance', dy: -220, z: 50 },
  { w: 'stn.quarantine.worn', at: 'mall_entrance', dy: 240, z: 60 },
  // ---- the atrium: the security office, the escalators, the fountain
  { w: 'gfx.stayout', at: 'security_office', z: 48 },
  { w: 'note.4alive', at: 'security_office', dx: 70, z: 42 },
  { w: 'sign.restricted', at: 'security_office', dx: -80, z: 60 },
  { w: 'gfx.tally-days', at: 'security_office', dy: 60, z: 48 },
  { walls: SHOP, at: 'atrium_escalator', r: 500, n: 8, z: [38, 50] },
  { walls: TAGS, at: 'atrium_fountain', r: 700, n: 5, z: [36, 50] },
  { scatter: MESS, at: 'atrium_fountain', r: 500, n: 14 },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'stain.rings'], at: 'atrium_fountain', r: 140, n: 3 },
  { gate: 'food_shutter', toward: 'atrium_fountain', list: [['gfx.x-red', 46, 180], ['gfx.theyhear.worn', 52, -180]] },
  // ---- the food court: the stage, the freezer, the kitchen
  { w: 'gfx.deadinside', at: 'food_freezer', z: 52 },
  { w: 'blood.hands', at: 'food_freezer', dx: 80, z: 38 },
  { w: 'poster.gig', at: 'food_stage', z: 44, maxD: 540 },
  { w: 'poster.gig.worn', at: 'food_stage', dx: 20, z: 43, maxD: 540 },
  { w: 'sign.exit.damaged', at: 'food_kitchen', z: 84 },
  { scatter: ['oil.2', 'blood.pool', 'litter.paper3', 'grime.patch', 'puddle.rim2'], at: 'food_kitchen', r: 220, n: 6 },
  { scatter: MESS, at: 'sec:foodcourt', r: 900, n: 18 },
  { gate: 'store_shutter', toward: 'food_stage', list: [['sign.mallsale.worn', 50, 180], ['gfx.dontgoin.worn', 50, -180]] },
  // ---- Harrow's: the dark store
  { w: 'holes.glass', at: 'store_electronics', z: 44, maxD: 540 },
  { w: 'gfx.redcross', at: 'store_pharmacy', z: 52 },
  { w: 'gfx.xcode-3', at: 'store_pharmacy', dx: 80, z: 48 },
  { w: 'gfx.x-red.worn', at: 'store_sporting', z: 48 },
  { w: 'holes.concrete-line', at: 'store_sporting', dx: 90, z: 40 },
  { scatter: MESS, at: 'sec:store', r: 1000, n: 16 },
  // ---- the parking garage: the old crews' tags, skids, the booth
  { walls: TAGS, at: 'garage_ramp', r: 900, n: 10, z: [32, 48] },
  { walls: TAGS, at: 'garage_car', r: 900, n: 8, z: [32, 48] },
  { scatter: ['oil.1', 'oil.3', 'tyre.skid', 'crack.floor2', 'stain.rings', 'puddle.rim1'], at: 'sec:garage', r: 1800, n: 28 },
  { w: 'sign.donotenter', at: 'garage_booth', z: 50, maxD: 400 },
  { w: 'stain.water', at: 'garage_booth', dx: 140, z: 90, maxD: 400 },
  { gate: 'garage_door', toward: 'store_electronics', list: [['sign.exit', 84, 90]] },
  // ---- the loading dock: the truck, the office, out
  { w: 'gfx.tally', at: 'dock_office', z: 48 },
  { w: 'notice.curfew.torn', at: 'dock_office', dx: 70, z: 42 },
  { scatter: ['oil.1', 'oil.2', 'tyre.skid', 'tyre.tread'], at: 'dock_truck', r: 300, n: 7 },
  { arrow: W, at: 'dock_exit', toward: [10800, 4400], z: 48 },
  { gate: 'dock_gate', toward: 'garage_car', list: [['stn.cleared', 50, 170]] },
];

/** Lay Westgate's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
