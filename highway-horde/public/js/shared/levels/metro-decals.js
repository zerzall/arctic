// Underground's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The street
// over the station is posters and tags; the concourse has the system maps and the ticket office the
// searchers marked; the platform signs still point to Harlan Square; the tunnels are warnings and blood;
// the sump is water stains and rust; the works carry their high-voltage plates; and at the top of the
// exit stairs, in Harlan Square, the city's last flyers say Haven is open.

import { placeDecals } from '../decals.js';

const W = ['gfx.haven-r', 'gfx.haven-l'];
const STREET = ['poster.cola.worn', 'poster.movie', 'poster.missing-reyes', 'notice.evac', 'notice.curfew.worn', 'poster.stayinside', 'poster.torn-layers2', 'gfx.tag-soke', 'gfx.throw-skul'];
const TILE = ['sign.metro-line', 'sign.metro-platform.worn', 'poster.movie.worn', 'poster.cola', 'gfx.tag-kraz', 'gfx.tag-moe', 'blood.hands', 'holes.plaster', 'stain.water'];
const TUNNEL = ['stain.water', 'rust.streak1', 'rust.streak2', 'soot.streak1', 'sign.highvoltage.worn', 'stn.track', 'gfx.theyhear', 'blood.spray.dry', 'crack.wall2'];
const FLOOR = ['litter.paper1', 'litter.paper2', 'litter.paper3', 'blood.splat2', 'blood.prints', 'puddle.rim1', 'dust.drift'];

export const DECALS = [
  // ---- Station Street
  { walls: STREET, at: 'metro_entrance', r: 600, n: 10, z: [36, 48] },
  { walls: STREET, at: 'newsstand', r: 500, n: 6, z: [36, 48] },
  { scatter: ['litter.paper1', 'litter.paper2', 'oil.1', 'crack.floor1', 'puddle.rim2', 'blood.pool.dry'], at: 'sec:street', r: 1300, n: 22 },
  { w: 'sign.street-harlan', at: 'metro_entrance', dy: -200, z: 76, maxD: 400 },
  // ---- the concourse
  { w: 'sign.metro-map', at: 'concourse_gates', z: 60, maxD: 520 },
  { w: 'sign.metro-map2.worn', at: 'concourse_gates', dx: 200, z: 60, maxD: 520 },
  { w: 'gfx.x-red', at: 'ticket_office', z: 48 },
  { w: 'gfx.xcode-3.worn', at: 'ticket_office', dx: 80, z: 48 },
  { walls: TILE, at: 'concourse_shops', r: 500, n: 8, z: [36, 52] },
  { scatter: FLOOR, at: 'sec:concourse', r: 800, n: 14 },
  { gate: 'platform_door', toward: 'ticket_office', list: [['sign.donotenter', 60, 100]] },
  // ---- the Line 2 platform and the dead train
  { walls: ['sign.metro-platform', 'sign.metro-line', 'sign.metro-map', 'poster.cola.torn', 'poster.gig.worn'], at: 'platform_train', r: 1200, n: 10, z: [44, 64] },
  { walls: TILE, at: 'platform_cab', r: 900, n: 8, z: [36, 52] },
  { w: 'gfx.dontgoin', at: 'platform_end', z: 52 },
  { w: 'blood.hands.dry', at: 'platform_end', dx: 80, z: 38 },
  { scatter: FLOOR, at: 'sec:platform', r: 1800, n: 22 },
  { trail: 'blood.drag', path: ['platform_cab', [7800, 900], 'platform_end'], step: 76 },
  // ---- tunnel 2
  { walls: TUNNEL, at: 'tunnel_junction', r: 900, n: 10, z: [30, 70] },
  { walls: TUNNEL, at: 'tunnel_signal', r: 900, n: 8, z: [30, 70] },
  { arrow: 'gfx.arrow-red', at: 'tunnel_signal', toward: 'pump_room', z: 46 },
  { scatter: ['puddle.rim1', 'oil.2', 'blood.pool', 'litter.paper3', 'crack.floor2'], at: 'sec:tunnel', r: 1200, n: 16 },
  { gate: 'tunnel_gate', toward: 'platform_end', list: [['stn.track.worn', 50, 280]] },
  // ---- the sump
  { walls: ['stain.water', 'stain.damp', 'rust.streak1', 'rust.streak3', 'moss.1', 'moss.2', 'stain.rings'], at: 'pump_room', r: 700, n: 10, z: [20, 70] },
  { w: 'sign.hazard.worn', at: 'sump_valve', z: 52 },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'moss.2', 'stain.rings', 'oil.3'], at: 'sec:flooded', r: 1100, n: 16 },
  { gate: 'sump_door', toward: 'pump_room', list: [['sign.donotenter.damaged', 56, 90]] },
  // ---- maintenance works
  { w: 'sign.highvoltage', at: 'breaker', z: 56 },
  { w: 'sign.hazard', at: 'breaker', dx: 90, z: 56 },
  { w: 'gfx.tally', at: 'breaker', dx: -200, z: 48, maxD: 400 },
  { w: 'poster.trustguard.worn', at: 'breaker', dx: -280, z: 44, maxD: 400 },
  { w: 'sign.donotenter', at: 'maint_lift', z: 56 },
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'grime.patch', 'tyre.tread'], at: 'workshop', r: 500, n: 10 },
  { gate: 'maint_shutter', toward: 'workshop', list: [['stn.keepout', 50, 160]] },
  // ---- up into Harlan Square
  { arrow: W, at: 'exit_stairs', toward: 'square_statue', z: 50 },
  { walls: ['flyer.haven', 'flyer.haven.worn', 'flyer.haven-small', 'poster.missing-hart', 'poster.missing-okoye.worn', 'notice.evac.torn', 'gfx.help4alive', 'gfx.haven-mark'], at: 'square_statue', r: 900, n: 12, z: [36, 56] },
  { scatter: ['litter.paper1', 'litter.paper2', 'leaves.1', 'leaves.2', 'blood.pool.dry', 'crack.floor1'], at: 'sec:exit', r: 1500, n: 22 },
  { w: 'gfx.haven-mark', at: 'gate:exit_gate', z: 46, maxD: 300 },
];

/** Lay Underground's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
