// Mill Road's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The
// morning after the pileup: the jam is a wreck of blood and glass with spray-painted arrows west, Deke
// left a note at Mill Road Gas, Ozzy's radio shack at Shady Acres is covered in the Haven message, a
// blood trail runs into the corn toward the tractor, and the Roadhouse gate is marked safe.

import { placeDecals } from '../decals.js';

const W = ['gfx.haven-r', 'gfx.haven-l'];
const BLOOD = ['blood.splat1', 'blood.splat2', 'blood.splat3', 'blood.pool', 'blood.splat4.dry'];
const ROAD = ['oil.1', 'oil.2', 'oil.3', 'glass.shards', 'tyre.skid', 'crack.floor1', 'litter.paper2'];

export const DECALS = [
  // ---- the jam: dead traffic, glass, blood, arrows sprayed on the road heading west
  { scatter: ROAD, at: 'jam_semi', r: 420, n: 14 },
  { scatter: ROAD, at: 'jam_wreck', r: 380, n: 12 },
  { scatter: BLOOD, at: 'jam_wreck', r: 220, n: 6 },
  { scatter: ['glass.shards', 'blood.pool', 'blood.splat2.dry'], at: 'jam_ambulance', r: 160, n: 5 },
  { trail: 'blood.drag', path: ['jam_ambulance', [8900, 2380], [8600, 2500]] },
  { trail: 'blood.prints', path: ['jam_wreck', [8700, 1700], [8200, 1900]], step: 64 },
  { farrow: 'gfx.arrow-white', at: [10900, 1300], toward: 'gas_forecourt' },
  { farrow: 'gfx.arrow-white.worn', at: [9800, 1900], toward: 'gas_forecourt' },
  { farrow: 'gfx.arrow-red', at: [8400, 2600], toward: 'gas_forecourt' },
  { f: 'stn.zone4', at: 'start', dx: -260, dy: 120, a: 0 },
  // ---- Mill Road Gas: Deke's note on the office, the evacuation notice, oil on the forecourt
  { w: 'note.deke', at: 'gas_office', z: 44 },
  { w: 'notice.evac.worn', at: 'gas_office', dx: 60, z: 42 },
  { w: 'poster.missing-reyes', at: 'gas_office', dx: -70, z: 41 },
  { w: 'poster.cola.worn', at: 'gas_office', dx: -110, z: 46 },
  { w: 'sign.street-mill', at: 'gas_forecourt', z: 70, maxD: 480 },
  { arrow: W, at: 'gas_garage', toward: 'trailer_exit', z: 48 },
  { w: 'gfx.tally-days', at: 'gas_garage', dx: 120, z: 46 },
  { scatter: ['oil.2', 'oil.3', 'puddle.rim1'], at: 'gas_tanks', r: 140, n: 3 },
  { w: 'grime.base1', at: 'gas_office', dy: 40, z: 12.5 },
  { w: 'grime.base2', at: 'gas_garage', dy: 40, z: 12.5 },
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'tyre.skid', 'puddle.rim1'], at: 'gas_forecourt', r: 300, n: 10 },
  { f: 'oil.3', at: 'gas_tow', dx: 40, dy: 30 },
  { f: 'stn.keepout.worn', at: 'gate:gas_shutter', dx: 70, a: Math.PI / 2 },
  { farrow: 'gfx.arrow-red.worn', at: 'gate:gas_shutter', dx: 90, dy: 170, toward: 'gas_forecourt' },
  // ---- Shady Acres: Ozzy's shack plastered with the Haven message, warnings on the trailers
  { w: 'gfx.radio', at: 'trailer_radio', z: 48 },
  { w: 'flyer.haven', at: 'trailer_radio', dx: 70, z: 42 },
  { w: 'flyer.haven-small', at: 'trailer_radio', dx: -70, z: 44 },
  { w: 'gfx.haven-mark', at: 'trailer_radio', dy: 60, z: 40 },
  { w: 'gfx.tally', at: 'trailer_radio', dy: -60, z: 52 },
  { w: 'flyer.haven.worn', at: 'trailer_office', z: 42 },
  { w: 'poster.missing-hart.worn', at: 'trailer_office', dx: 60, z: 40 },
  { w: 'note.4alive', at: 'trailer_office', dx: -60, z: 40 },
  { w: 'gfx.notsafe', at: 'trailer_pool', z: 40, maxD: 420 },
  { scatter: ['blood.pool', 'blood.splat3', 'leaves.1', 'litter.paper1'], at: 'trailer_pool', r: 200, n: 6 },
  { walls: ['gfx.tag-kraz', 'gfx.tag-rust', 'gfx.x-red', 'gfx.xcode-1', 'gfx.xcode-3', 'gfx.skull.worn', 'gfx.headshots'], at: 'sec:trailers', r: 900, n: 14, z: [34, 48] },
  { arrow: W, at: 'trailer_exit', toward: 'corn_scarecrow', z: 44 },
  { w: 'gfx.haven-mark', at: 'gate:trailer_gate', z: 40, maxD: 260 },
  // ---- the cornfield: a blood trail from the scarecrow toward the tractor (the ambush), the silo
  { trail: 'blood.drag-hands', path: ['corn_scarecrow', [2650, 1500], 'corn_tractor'], step: 72 },
  { scatter: ['blood.splat1', 'blood.splat2', 'leaves.2'], at: 'corn_tractor', r: 160, n: 4 },
  { w: 'rust.streak1', at: 'corn_silo', z: 60, maxD: 340 },
  { w: 'gfx.x-red.worn', at: 'corn_silo', z: 46, maxD: 340, along: 60 },
  { scatter: ['oil.2', 'leaves.3', 'tyre.tread'], at: 'corn_tractor', r: 260, n: 5 },
  // ---- the Roadhouse gate: marked safe, the gig poster, help messages on the motel
  { f: 'gfx.safe-mark', at: 'motel_gate', dy: -150, a: 0 },
  { w: 'gfx.haven-mark', at: 'motel_door', dx: 120, z: 44 },
  { w: 'poster.gig', at: 'motel_door', z: 42 },
  { w: 'poster.gig.worn', at: 'motel_door', dx: 22, z: 41 },
  { w: 'gfx.help4alive', at: 'motel_lot', dy: 200, z: 56 },
  { w: 'gfx.xcode-1', at: 'motel_door', dx: -60, z: 46 },
  { walls: ['poster.missing-okoye', 'poster.stayinside.worn', 'notice.curfew.torn', 'gfx.stayout'], at: 'motel_lot', r: 600, n: 6, z: [36, 46] },
  { scatter: ['oil.1', 'tyre.skid', 'litter.paper3', 'puddle.rim2'], at: 'motel_lot', r: 400, n: 8 },
];

/** Lay Mill Road's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
