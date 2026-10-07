// Saint Mercy's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The army
// sealed the hospital: quarantine stencils and CDC notices on the walls of the car park, a decon arrow,
// the search code of the unit that gave up. Inside, blood leads from the ambulance bay to the ER, a drag
// trail runs round Ward C toward the ambush, Mara's colleagues left her a message at the records room,
// and on Stair B someone wrote that they went up.

import { placeDecals } from '../decals.js';

const OUTSIDE = ['stn.quarantine', 'stn.quarantine.worn', 'notice.quarantine', 'notice.quarantine.worn', 'poster.reportbites', 'sign.biohazard.worn', 'gfx.theyhear'];
const INSIDE = ['notice.quarantine.torn', 'poster.reportbites.worn', 'sign.evacplan', 'blood.hand', 'blood.hands', 'holes.plaster', 'gfx.x-red', 'blood.drips'];
const FLOOR = ['blood.splat1', 'blood.splat2', 'blood.splat3', 'blood.pool', 'litter.paper1', 'litter.paper3', 'glass.shards', 'blood.prints'];

export const DECALS = [
  // ---- the car park: the army's quarantine line
  { walls: OUTSIDE, at: 'er_doors', r: 600, n: 10, z: [40, 58] },
  { w: 'sign.emergency', at: 'er_doors', z: 80 },
  { w: 'stn.decon', at: 'ambulance', dx: 180, z: 46, maxD: 360 },
  { w: 'gfx.xcode-4', at: 'er_doors', dx: 160, z: 50 },
  { w: 'sign.military', at: 'ambulance', dx: -200, z: 48, maxD: 360 },
  { w: 'stn.quarantine', at: 'start', z: 60, maxD: 500 },
  { w: 'stn.keepout', at: 'start', dx: -300, z: 54, maxD: 500 },
  { scatter: ['oil.1', 'oil.2', 'tyre.skid', 'glass.shards', 'litter.paper2', 'crack.floor2'], at: 'start', r: 900, n: 14 },
  { scatter: ['oil.3', 'tyre.skid', 'puddle.rim1', 'blood.pool.dry', 'crack.floor1'], at: 'ambulance', r: 700, n: 12 },
  { trail: 'blood.drag', path: ['ambulance', [1450, 1420], 'er_doors'], step: 72 },
  { trail: 'blood.prints', path: [[2200, 1200], [1900, 1350], 'er_doors'], step: 60 },
  // ---- Emergency: triage gone wrong
  { walls: INSIDE, at: [1500, 2420], r: 420, n: 8, z: [34, 52] },
  { w: 'sign.icu', at: [1400, 2380], z: 78 },
  { w: 'sign.radiology', at: 'er_triage', z: 78 },
  { w: 'blood.spray', at: 'er_triage', dx: 80, z: 40 },
  { w: 'sign.pharmacy', at: 'er_pharmacy', z: 78 },
  { w: 'gfx.x-red', at: 'er_pharmacy', dx: 70, z: 46 },
  { w: 'poster.reportbites', at: 'er_pharmacy', dx: -80, z: 42 },
  { scatter: FLOOR, at: 'er_triage', r: 320, n: 10 },
  { scatter: FLOOR, at: 'er_desk', r: 240, n: 6 },
  { gate: 'ward_doors', toward: 'er_desk', list: [['gfx.dontgoin', 50, 70], ['sign.ward-c', 80, -80]] },
  // ---- Ward C: the records room, the generator, a trail round the ring
  { w: 'gfx.mara', at: 'ward_records', z: 46 },
  { w: 'note.wentup.worn', at: 'ward_records', dx: 70, z: 44 },
  { w: 'notice.quarantine', at: 'ward_nurses', z: 44 },
  { w: 'sign.ward-c.worn', at: 'ward_nurses', dx: 120, z: 80 },
  { w: 'blood.hands', at: 'ward_nurses', dx: -110, z: 36 },
  { w: 'sign.highvoltage', at: 'ward_generator', z: 52 },
  { w: 'sign.hazard.worn', at: 'ward_generator', dx: 90, z: 56 },
  { w: 'rust.streak2', at: 'ward_generator', dx: -70, z: 70 },
  { trail: 'blood.drag-hands', path: ['ward_nurses', [3300, 2500], [3150, 2700]], step: 72 },
  { scatter: ['blood.pool', 'blood.splat4', 'litter.paper1', 'litter.paper2'], at: 'ward_records', r: 200, n: 5 },
  { scatter: ['oil.2', 'puddle.rim2', 'stain.rings'], at: 'ward_generator', r: 160, n: 3 },
  { gate: 'surgery_doors', toward: 'ward_nurses', list: [['sign.surgery', 80, 80], ['gfx.theyhear', 50, -80]] },
  // ---- Surgery: the theatres, the lift
  { w: 'sign.surgery.worn', at: 'surgery_theatre', z: 80 },
  { w: 'blood.spray', at: 'surgery_theatre', dx: 90, z: 42 },
  { w: 'blood.drips', at: 'surgery_theatre', dx: -90, z: 48 },
  { w: 'sign.biohazard', at: 'surgery_scrub', z: 50 },
  { w: 'gfx.dontgoin', at: 'surgery_lift', z: 46 },
  { w: 'gfx.x-red.worn', at: 'surgery_lift', dx: 60, z: 46 },
  { scatter: ['blood.pool', 'blood.splat1', 'blood.splat2', 'blood.prints-bare'], at: 'surgery_theatre', r: 260, n: 6 },
  // ---- Stair B: they went up
  { w: 'sign.stairb', at: 'stair_bottom', z: 80 },
  { w: 'note.wentup', at: 'stair_bottom', dx: 60, z: 44 },
  { w: 'gfx.arrow-red', at: 'stair_bottom', dx: -60, z: 50, a: -1.2 },
  { w: 'blood.hands', at: 'stair_top', z: 40 },
  { w: 'gfx.help4alive.worn', at: 'roof_door', z: 60 },
  // ---- the helipad: the radio, the plant
  { w: 'flyer.haven-small', at: 'roof_radio', z: 44 },
  { w: 'gfx.radio.worn', at: 'roof_radio', dx: -90, z: 52, maxD: 360 },
  { w: 'gfx.tally-days', at: 'roof_radio', dx: 90, z: 46 },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'oil.1', 'litter.paper3', 'stain.rings'], at: 'helipad', r: 400, n: 8 },
];

/** Lay Saint Mercy's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
