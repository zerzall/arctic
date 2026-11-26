// Hand-placed decals of the story hideouts and of Sandstone (shared/decals.js placeDecals; drawn by
// render3d/decals.js). The hideouts are where the crew rests, so their walls are kind: the Hounds' old
// gig poster at the Roadhouse, polaroids of the people they lost, June's drawings, the Haven flyer, a
// SAFE mark at the gate, the tally of days. They get no automatic grime and graffiti. Sandstone is a
// fought-over two-site desert town: bullet holes on the sites and at the doors, cracks, scorch and sand
// drifts, graffiti and torn posters on the T side, the painted arrows to the sites, with the automatic
// pass (desert theme) adding the rest.

import { placeDecals, decalsOf } from './decals.js';

const PHOTOS = ['note.polaroid', 'note.polaroid2', 'note.polaroid.worn', 'note.polaroid2.worn'];

const HIDEOUTS = {
  roadhouse: [
    // the Roadhouse's front: the gig poster that's been there since before, the crew's wall of photos
    { w: 'poster.gig.worn', at: [760, 330], z: 44 },
    { w: 'poster.gig', at: [790, 330], z: 43 },
    { w: 'flyer.haven', at: [1000, 330], z: 44 },
    { w: 'note.drawing', at: [1080, 330], z: 42 },
    { walls: PHOTOS, at: [1180, 330], r: 90, n: 6, z: [38, 52] },
    { w: 'gfx.tally-days', at: [600, 330], z: 48 },
    { w: 'gfx.june', at: [1300, 330], z: 30 },
    { w: 'sign.street-mill', at: [1555, 340], z: 70 },
    { w: 'gfx.safe-mark', at: [1100, 1330], z: 44 },
    { w: 'gfx.haven-mark', at: [1500, 1330], z: 42 },
    { w: 'grime.base1', at: [700, 330], z: 12.5 },
    { w: 'grime.base2', at: [1300, 330], z: 12.5 },
    { scatter: ['oil.1', 'oil.2', 'tyre.tread', 'puddle.rim1'], at: [1100, 1250], r: 260, n: 5 },
    { scatter: ['leaves.1', 'leaves.2', 'litter.paper1'], at: [1100, 800], r: 700, n: 8 },
  ],
  depot: [
    // the old station and the boxcars the crew lives beside
    { w: 'flyer.haven', at: [830, 430], z: 44 },
    { w: 'note.drawing', at: [880, 430], z: 42 },
    { walls: PHOTOS, at: [780, 430], r: 60, n: 4, z: [38, 52] },
    { w: 'sign.rail-danger.worn', at: [430, 440], z: 50 },
    { w: 'gfx.haven-r', at: [1125, 990], z: 46, on: /^bus:/ },
    { w: 'gfx.tag-vandl.worn', at: [1415, 990], z: 40, on: /^bus:/ },
    { w: 'gfx.safe-mark', at: [1705, 990], z: 44, on: /^bus:/ },
    { w: 'gfx.tally-days', at: [1705, 890], z: 46, on: /^bus:/ },
    { w: 'gfx.safe-mark.worn', at: [1100, 1330], z: 44 },
    { scatter: ['oil.1', 'oil.3', 'crack.floor1', 'puddle.rim2', 'leaves.3'], at: [1100, 760], r: 700, n: 10 },
  ],
  farmstead: [
    // the Haskell farm: home at last
    { w: 'note.drawing', at: [640, 450], z: 44 },
    { w: 'note.drawing.worn', at: [700, 450], z: 42 },
    { walls: PHOTOS, at: [560, 450], r: 70, n: 4, z: [38, 52] },
    { w: 'flyer.haven.worn', at: [1390, 600], z: 44 },
    { w: 'gfx.haven-mark', at: [1390, 480], z: 46 },
    { w: 'gfx.tally-days', at: [300, 800], z: 46 },
    { w: 'moss.1', at: [520, 450], z: 14 },
    { w: 'lichen.2', at: [1610, 300], z: 40 },
    { w: 'gfx.safe-mark', at: [1100, 1330], z: 44 },
    { scatter: ['leaves.1', 'leaves.2', 'leaves.3', 'moss.2'], at: [1100, 800], r: 800, n: 16 },
  ],
};

/** Lay a hideout's decals (called at the end of its builder). No automatic set on a hideout. */
export function hideoutDecals(B, id) {
  B.map.decalsAuto = false;
  return HIDEOUTS[id] ? placeDecals(B.map, HIDEOUTS[id]) : 0;
}

const SANDSTONE = [
  // CT spawn: where the crew starts, the last line; the tally of the days they held
  { walls: ['holes.concrete', 'holes.plaster', 'crack.wall1', 'spall.concrete1', 'scorch.wall'], at: 'ctSpawn', r: 380, n: 9, z: [24, 60] },
  { scatter: ['sand.drift1', 'sand.drift2', 'blood.pool.dry', 'scorch.small', 'crack.floor2'], at: 'ctSpawn', r: 320, n: 8 },
  { w: 'gfx.tally', at: 'ctSpawn', dx: -280, dy: -300, z: 46 },
  { w: 'stn.zone4.worn', at: 'ctSpawn', dx: 330, dy: 200, z: 50 },
  { arrow: ['gfx.arrow-white', 'gfx.arrow-white'], at: 'ctSpawn', dx: 300, dy: -60, toward: 'aSite', z: 50 },
  { arrow: ['gfx.arrow-white.worn', 'gfx.arrow-white.worn'], at: 'ctSpawn', dx: -300, dy: 120, toward: 'bSite', z: 50 },
  // A site: the platform, goose, the ramp; a fight was had over the boxes
  { walls: ['holes.concrete-line', 'holes.concrete', 'holes.plaster', 'crack.wall2', 'gfx.x-red.worn', 'spall.concrete2'], at: 'aSite', r: 420, n: 10, z: [24, 60] },
  { walls: ['holes.concrete', 'scorch.wall', 'gfx.skull.worn'], at: 'goose', r: 120, n: 3, z: [26, 50] },
  { scatter: ['sand.drift1', 'sand.drift2', 'scorch.blast', 'blood.splat3.dry', 'litter.paper2'], at: 'aSite', r: 360, n: 9 },
  { arrow: ['gfx.arrow-red.worn', 'gfx.arrow-red.worn'], at: 'longCorner', dx: 150, toward: 'aSite', z: 48 },
  // long: the doors, the corridor, the pit
  { walls: ['holes.concrete-line', 'holes.concrete', 'crack.wall1', 'gfx.tag-rust.worn', 'stain.water', 'poster.torn-layers.worn'], at: 'long', r: 520, n: 10, z: [24, 58] },
  { scatter: ['sand.drift1', 'sand.drift2', 'oil.1', 'blood.drag.dry', 'litter.paper1', 'tyre.tread'], at: 'long', r: 500, n: 12 },
  { walls: ['holes.concrete', 'holes.wood', 'scorch.wall', 'gfx.stayout.worn'], at: 'longDoors', r: 140, n: 5, z: [24, 56] },
  { walls: ['crack.wall3', 'stain.damp', 'holes.concrete', 'gfx.deadinside.worn'], at: 'pit', r: 160, n: 5, z: [16, 40] },
  { scatter: ['sand.drift2', 'blood.pool.dry', 'scorch.small', 'oil.2'], at: 'pit', r: 120, n: 5 },
  { walls: ['poster.missing-hart.worn', 'notice.evac.torn', 'gfx.tag-kraz.worn', 'gfx.throw-okr.worn'], at: 'outsideLong', r: 320, n: 5, z: [30, 56] },
  { arrow: ['gfx.arrow-orange.worn', 'gfx.arrow-orange.worn'], at: 'outsideLong', dx: -200, toward: 'longDoors', z: 48 },
  // mid: the doors, xbox, the catwalk, the long slope from top mid
  { walls: ['holes.concrete-line', 'holes.concrete', 'holes.plaster', 'crack.wall1', 'scorch.wall', 'gfx.xcode-4.worn', 'stn.military.worn'], at: 'lowerMid', r: 380, n: 10, z: [24, 60] },
  { walls: ['holes.wood', 'holes.concrete-line', 'gfx.notsafe.worn'], at: 'midDoors', r: 160, n: 4, z: [26, 60] },
  { scatter: ['sand.drift1', 'sand.drift2', 'blood.drag', 'blood.splat3.dry', 'scorch.blast', 'litter.paper2'], at: 'lowerMid', r: 300, n: 12 },
  { walls: ['gfx.tag-soke.worn', 'poster.stayinside.worn', 'holes.plaster', 'peel.white'], at: 'catwalk', r: 220, n: 5, z: [26, 52] },
  { walls: ['gfx.tag-moe.worn', 'gfx.throw-skul.worn', 'holes.concrete', 'poster.cola.worn', 'notice.curfew.worn'], at: 'topMid', r: 320, n: 7, z: [28, 56] },
  { scatter: ['sand.drift1', 'sand.drift2', 'litter.paper1', 'blood.pool.dry'], at: 'topMid', r: 260, n: 7 },
  { arrow: ['gfx.arrow-white.worn', 'gfx.arrow-white.worn'], at: 'short', dx: 120, toward: 'aSite', z: 48 },
  // B: the site, the doors, the window, the tunnels' damp dark
  { walls: ['holes.concrete', 'holes.plaster', 'crack.wall2', 'gfx.x-red.worn', 'scorch.wall', 'spall.concrete1'], at: 'bSite', r: 420, n: 10, z: [24, 58] },
  { scatter: ['sand.drift1', 'sand.drift2', 'blood.pool.dry', 'scorch.small', 'crack.floor1'], at: 'bSite', r: 360, n: 9 },
  { walls: ['holes.wood', 'holes.concrete-line'], at: 'bDoors', r: 100, n: 3, z: [30, 60] },
  { walls: ['stain.water', 'moss.1', 'crack.wall3', 'gfx.skull.worn', 'stain.damp', 'gfx.theyhear.worn'], at: 'upperTunnels', r: 300, n: 8, z: [20, 56] },
  { walls: ['stain.water', 'moss.2', 'gfx.nowayout.worn', 'stain.damp'], at: 'bTunnel', r: 200, n: 5, z: [20, 56] },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'moss.2', 'sand.drift1', 'leaves.3'], at: 'upperTunnels', r: 260, n: 7 },
  { walls: ['stain.damp', 'gfx.tag-zek.worn'], at: 'lowerTunnels', r: 100, n: 3, z: [20, 50] },
  { arrow: ['gfx.arrow-bent.worn', 'gfx.arrow-bent.worn'], at: 'bTunnel', dy: -80, toward: 'bSite', z: 48 },
  // T spawn and outside tunnels: where the horde comes from
  { walls: ['gfx.tag-vandl.worn', 'gfx.repent.worn', 'poster.missing-reyes.torn', 'notice.quarantine.worn', 'holes.plaster', 'peel.blue'], at: 'tSpawn', r: 420, n: 9, z: [28, 60] },
  { scatter: ['sand.drift1', 'sand.drift2', 'dust.drift', 'blood.drag.dry', 'litter.paper3', 'oil.3'], at: 'tSpawn', r: 400, n: 12 },
  { walls: ['gfx.dontgoin.worn', 'gfx.bitten.worn', 'poster.reportbites.torn'], at: 'outsideTunnels', r: 300, n: 5, z: [28, 56] },
  { scatter: ['sand.drift1', 'sand.drift2', 'dust.drift'], at: 'outsideTunnels', r: 300, n: 6 },
];

/** Lay Sandstone's decals (called at the end of its builder); the automatic pass adds the rest. */
export function sandstoneDecals(B) {
  B.map.decalTheme = 'desert';
  decalsOf(B.map);
  return placeDecals(B.map, SANDSTONE);
}
