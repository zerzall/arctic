// Hollow Creek's hand-placed decals (shared/decals.js placeDecals; drawn by render3d/decals.js). The
// town before it fell is still on its walls (St. Anne's pancake breakfast, the Hounds' gig, the boil
// water advisory), and the fall over it: curfew and evacuation notices, missing children, the looted
// pharmacy marked with search codes, "REPENT" on the church, Ruth Delaney's note at the school and
// June's drawing, tally marks in the police cells, and arrows west for whoever comes next.

import { placeDecals } from '../decals.js';

const W = ['gfx.haven-r', 'gfx.haven-l'];
const TOWN = ['poster.missing-hart', 'poster.missing-reyes.worn', 'notice.curfew', 'notice.evac.torn', 'flyer.church.worn', 'poster.gig.torn', 'notice.boilwater', 'poster.stayinside.worn', 'poster.torn-layers'];
const STREET = ['oil.1', 'oil.2', 'crack.floor1', 'litter.paper1', 'litter.paper2', 'leaves.1', 'puddle.rim1', 'blood.splat2.dry'];

export const DECALS = [
  // ---- the town line: the barricade the army never finished
  { w: 'sign.roadclosed.worn', at: 'outskirts_barricade', z: 40 },
  { w: 'notice.curfew.worn', at: 'outskirts_barricade', dx: -80, z: 42 },
  { f: 'gfx.notsafe', at: 'water_tower', dy: 220, a: Math.PI / 2 },
  { scatter: ['oil.2', 'tyre.skid', 'glass.shards', 'blood.pool.dry', 'leaves.2'], at: 'outskirts_barricade', r: 380, n: 9 },
  { farrow: 'gfx.arrow-white.worn', at: 'welcome_sign', dx: -320, toward: 'main_barricade' },
  { f: 'stn.noentry', at: 'gate:main_barricade', dx: 180, a: Math.PI / 2 },
  { f: 'gfx.stayout.worn', at: 'gate:main_barricade', dx: 330, dy: 60, a: Math.PI / 2 },
  // ---- Main Street: the old town on the walls, then the notices over it
  { walls: TOWN, at: 'main_hardware', r: 360, n: 9, z: [36, 46] },
  { walls: TOWN, at: 'main_diner', r: 360, n: 9, z: [36, 46] },
  { walls: ['gfx.godleft', 'gfx.theyhear.worn', 'gfx.tag-moe', 'gfx.throw-skul.worn', 'gfx.xcode-2', 'gfx.x-red'], at: 'main_fountain', r: 700, n: 8, z: [36, 50] },
  { w: 'sign.street-main', at: 'main_fountain', z: 76, maxD: 400 },
  { w: 'sign.street-church', at: 'main_hardware', dx: -200, z: 76, maxD: 400 },
  { w: 'gfx.help4alive.worn', at: 'main_diner', dy: -120, z: 60 },
  { scatter: STREET, at: 'main_fountain', r: 600, n: 16 },
  { trail: 'blood.drag', path: ['main_diner', [6800, 2900], [6500, 3050]], step: 74 },
  { scatter: ['blood.splat1', 'blood.splat3', 'blood.pool'], at: 'main_diner', dy: 150, r: 160, n: 3 },
  // ---- the Rexall: looted, searched, the back room still shut
  { w: 'gfx.xcode-2', at: 'pharmacy_door', z: 46 },
  { w: 'gfx.redcross.worn', at: 'pharmacy_door', dx: -60, z: 52 },
  { w: 'gfx.dontgoin', at: 'pharmacy_back', z: 46 },
  { w: 'note.water', at: 'pharmacy_counter', z: 42 },
  { w: 'blood.hands', at: 'pharmacy_counter', dx: 80, z: 34 },
  { w: 'holes.glass', at: 'pharmacy_door', dx: 60, z: 40 },
  { scatter: ['glass.shards', 'litter.paper3', 'blood.splat2', 'litter.paper1'], at: 'pharmacy_counter', r: 180, n: 6 },
  { gate: 'pharmacy_gate', toward: 'main_hardware', list: [['gfx.x-red.worn', 46, 70], ['poster.reportbites.worn', 40, -70]] },
  // ---- St. Anne's: the bell, the repent painter, the families who came here
  { w: 'gfx.repent', at: 'church_doors', z: 52 },
  { w: 'flyer.church', at: 'church_doors', dx: 80, z: 42 },
  { w: 'poster.missing-hand', at: 'church_doors', dx: -80, z: 42 },
  { w: 'note.4alive.worn', at: 'church_doors', dx: -130, z: 40 },
  { w: 'gfx.tally', at: 'church_bell', z: 46 },
  { w: 'gfx.safe-mark.worn', at: 'church_yard', z: 40, maxD: 400 },
  { scatter: ['leaves.1', 'leaves.2', 'leaves.3', 'moss.2', 'lichen.1'], at: 'church_yard', r: 500, n: 14 },
  { gate: 'church_gate', toward: 'pharmacy_door', list: [['stn.dead.worn', 40, 80]] },
  // ---- the elementary school: Ruth Delaney's note, the kids' drawings, June
  { w: 'note.ruth', at: 'school_office', z: 44 },
  { w: 'note.drawing', at: 'school_office', dx: 70, z: 44 },
  { w: 'note.drawing.worn', at: 'school_bus', z: 40, maxD: 420 },
  { w: 'gfx.june', at: 'school_bus', dx: 90, z: 34, maxD: 420 },
  { w: 'poster.missing-hart', at: 'school_office', dx: -70, z: 42 },
  { w: 'gfx.tally-days', at: 'school_gym', z: 50 },
  { w: 'gfx.help4alive', at: 'school_gym', dx: 160, z: 70 },
  { w: 'blood.hands.dry', at: 'school_gym', dx: -120, z: 36 },
  { scatter: ['litter.paper1', 'litter.paper2', 'blood.splat3.dry', 'dust.drift'], at: 'school_gym', r: 220, n: 6 },
  { farrow: 'gfx.arrow-white', at: 'gate:school_fence', dx: 160, toward: 'school_office' },
  // ---- the police station: the cells, the armory, a shootout in the lot
  { w: 'gfx.tally', at: 'police_cells', z: 44 },
  { w: 'gfx.tally-days.worn', at: 'police_cells', dx: 90, z: 48 },
  { w: 'stn.dead', at: 'police_cells', dx: -90, z: 50 },
  { w: 'sign.restricted', at: 'police_armory', z: 52 },
  { w: 'holes.concrete-line', at: 'police_armory', dx: 80, z: 40 },
  { w: 'holes.concrete', at: 'police_lot', z: 38, maxD: 400 },
  { w: 'blood.spray', at: 'police_lot', dx: 120, z: 40, maxD: 400 },
  { scatter: ['blood.pool', 'oil.1', 'glass.shards', 'tyre.skid', 'blood.splat4'], at: 'police_lot', r: 300, n: 8 },
  { farrow: 'gfx.arrow-white', at: 'police_exit', dx: 140, toward: [0, 3900] },
  { w: 'sign.donotenter.worn', at: 'gate:police_gate', z: 52, maxD: 400 },
];

/** Lay Hollow Creek's decals on the map (called at the end of build). */
export function decals(B) {
  return placeDecals(B.map, DECALS);
}
