// The Rail Yard's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). Rail
// warnings everywhere (keep off the tracks, high voltage, the crossbuck), oil in the engine sheds, the
// old crews' tags on the walls, the signalman's tally, and at the main line Okafor's note: Checkpoint
// Delta fell back to Fort Harlan.

import { placeDecals } from '../decals.js';

const RAIL = ['sign.rail-danger', 'sign.rail-danger.worn', 'sign.highvoltage', 'stn.track', 'stn.track.worn', 'sign.crossbuck.worn'];
const TAGS = ['gfx.tag-kraz', 'gfx.tag-vandl', 'gfx.tag-rust', 'gfx.throw-doom', 'gfx.throw-skul', 'gfx.tag-zek', 'gfx.headshots'];
const GROUND = ['oil.1', 'oil.2', 'oil.3', 'crack.floor1', 'puddle.rim1', 'litter.paper2', 'grime.patch'];

export const DECALS = [
  // ---- the sidings
  // (rail warnings bolted to the yard fence)
  { walls: ['sign.rail-danger', 'sign.rail-danger.worn', 'sign.highvoltage.worn'], at: 'siding_tower', r: 700, n: 4, z: [24, 30], on: /^wall:yardfence/ },
  { walls: RAIL, at: 'siding_tower', r: 700, n: 4, z: [40, 60], on: /^(wall:(shedwall|officewall|stackwall|bankwall)|bus:(boxcar|caboose))/ },
  { walls: TAGS, at: 'siding_wagon', r: 700, n: 6, z: [34, 50] },
  { scatter: GROUND, at: 'sec:sidings', r: 1500, n: 26 },
  { scatter: ['blood.pool', 'blood.drag', 'blood.splat2'], at: 'siding_wagon', r: 260, n: 4 },
  // ---- the engine sheds
  { w: 'sign.highvoltage.worn', at: 'shed_crane', z: 60, maxD: 440 },
  { w: 'gfx.tally', at: 'shed_office', z: 48 },
  { w: 'notice.curfew.worn', at: 'shed_office', dx: 70, z: 44 },
  { w: 'poster.trustguard.torn', at: 'shed_office', dx: -70, z: 44 },
  { walls: ['rust.streak1', 'rust.streak2', 'rust.streak3', 'soot.streak1', 'stain.water', 'grime.base2'], at: 'shed_pit', r: 600, n: 8, z: [30, 80] },
  { scatter: ['oil.1', 'oil.2', 'oil.3', 'puddle.rim2', 'grime.patch'], at: 'shed_pit', r: 300, n: 9 },
  { gate: 'shed_door', toward: 'siding_wagon', list: [['stn.keepout', 50, 110], ['sign.rail-danger', 56, -110]] },
  // ---- the signal box
  { w: 'sign.restricted', at: 'signal_stairs', z: 56, maxD: 500 },
  { w: 'gfx.tally-days', at: 'signal_lever', z: 50 },
  { w: 'flyer.haven-small.worn', at: 'signal_lever', dx: 70, z: 44 },
  { gate: 'yard_gate', toward: 'shed_office', list: [['sign.rail-danger.damaged', 56, 110]] },
  // ---- the bridge
  { scatter: ['oil.2', 'litter.paper3', 'blood.splat1.dry', 'crack.floor2'], at: 'bridge_mid', r: 300, n: 5 },
  { gate: 'bridge_gate', toward: 'signal_lever', list: [['sign.highvoltage', 60, 180], ['gfx.dontgoin', 50, -180]] },
  // ---- the freight yard
  { walls: TAGS.concat(['rust.streak1', 'rust.streak3', 'gfx.xcode-3']), at: 'freight_container', r: 800, n: 10, z: [34, 60], on: /^(wall:(stack|stackwall|boxwall)|bus:(boxcar|hopper|gondola)|container:)/ },
  { w: 'sign.hazard', at: 'freight_crane', z: 50, maxD: 500, on: /^(wall:(stack|stackwall|boxwall)|container:)/ },
  { scatter: GROUND.concat(['tyre.tread', 'tyre.skid']), at: 'sec:freight', r: 1100, n: 22 },
  { trail: 'blood.prints', path: ['freight_crane', [9500, 2200], 'freight_switch'], step: 62 },
  // ---- the main line: Delta's note, the way on
  // (chalked on the boxcar across the line, where the train crews would see it)
  { w: 'note.delta', at: 'line_gate', z: 50, maxD: 400, on: /^bus:(boxcar|caboose|diesel)|^wall:boxcargate/ },
  { w: 'stn.cleared.worn', at: 'locomotive', z: 46, maxD: 500, on: /^bus:(boxcar|caboose|hopper)/ },
  { arrow: ['gfx.haven-r', 'gfx.haven-l'], at: 'locomotive', dx: 200, toward: [12000, 2700], z: 50, maxD: 500, on: /^bus:(boxcar|caboose|hopper)/ },
  { farrow: 'gfx.arrow-white', at: 'locomotive', dx: 260, dy: 140, toward: [12000, 2700] },
  { scatter: ['oil.1', 'oil.2', 'crack.floor1'], at: 'locomotive', r: 260, n: 5 },
];

/** Lay the Rail Yard's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
