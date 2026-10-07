// Hand-placed decals of the story hideouts and of Sandstone (shared/decals.js placeDecals; drawn by
// render3d/decals.js). The hideouts are where the crew rests, so their walls are kind: the Hounds' old
// gig poster at the Roadhouse, polaroids of the people they lost, June's drawings, the Haven flyer, a
// SAFE mark at the gate, the tally of days. They get no automatic grime and graffiti. Sandstone is a
// fought-over desert town: bullet holes, cracks, scorch and sand drifts against its walls, with the
// automatic pass (desert theme) adding the rest.

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
  // Fountain Square: where the defenders stand, so where the fighting was
  { walls: ['holes.concrete', 'holes.concrete-line', 'holes.plaster', 'crack.wall1', 'spall.concrete1', 'scorch.wall'], at: 'square', r: 600, n: 12, z: [24, 60] },
  { scatter: ['sand.drift1', 'sand.drift2', 'blood.pool.dry', 'scorch.small', 'crack.floor2'], at: 'square', r: 500, n: 10 },
  { w: 'gfx.tally', at: 'square', dy: -250, z: 46 },
  { w: 'stn.zone4.worn', at: 'square', dx: 450, z: 50 },
  // the terrace and Cistern Court
  { walls: ['holes.concrete', 'holes.plaster', 'crack.wall2', 'gfx.x-red.worn', 'spall.concrete2'], at: 'terrace', r: 400, n: 6, z: [24, 56] },
  { walls: ['stain.water', 'moss.1', 'crack.wall3', 'holes.concrete-line', 'gfx.skull.worn'], at: 'cistern', r: 400, n: 7, z: [20, 56] },
  { scatter: ['puddle.rim1', 'puddle.rim2', 'moss.2', 'sand.drift1'], at: 'cistern', r: 300, n: 5 },
  // Mid Street and the souk: the long sightline, blood and drifts
  { walls: ['holes.concrete-line', 'holes.concrete', 'crack.wall1', 'scorch.wall', 'gfx.xcode-4.worn', 'stn.military.worn'], at: 'mid', r: 700, n: 10, z: [24, 60] },
  { scatter: ['sand.drift1', 'sand.drift2', 'blood.drag', 'blood.splat3.dry', 'scorch.blast', 'litter.paper2'], at: 'mid', r: 700, n: 14 },
  { walls: ['gfx.tag-rust.worn', 'gfx.stayout.worn', 'holes.plaster', 'peel.white'], at: 'wellSquare', r: 400, n: 6, z: [26, 52] },
  { walls: ['holes.concrete', 'crack.wall2', 'stain.water', 'gfx.nowayout.worn'], at: 'longHall', r: 500, n: 7, z: [26, 56] },
  { scatter: ['sand.drift1', 'sand.drift2', 'litter.paper1', 'blood.pool.dry', 'oil.1'], at: 'souk', r: 600, n: 12 },
  { scatter: ['sand.drift2', 'tyre.tread', 'oil.2', 'scorch.small'], at: 'caravanYard', r: 500, n: 9 },
];

/** Lay Sandstone's decals (called at the end of its builder); the automatic pass adds the rest. */
export function sandstoneDecals(B) {
  B.map.decalTheme = 'desert';
  decalsOf(B.map);
  return placeDecals(B.map, SANDSTONE);
}
