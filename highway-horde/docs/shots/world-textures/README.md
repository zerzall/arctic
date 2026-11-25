# World textures and models — before / after

Screenshots of the "make the world look real" pass (SPEC §7.5.2 *Surfaces and models*): the same views
rendered from commit d653aac (before) and from this branch (after), on the 'high' tier with
`scripts/shot.js` (software GL: SwiftShader), 1280 × 720, zombies off. `*-before.jpg` / `*-after.jpg`.

## Audit (what looked flat, plastic or untextured)

Screenshots of every main map by day and by night (highway, Harlan County, Sandstone, the truck stop, Mill
Road, the hospital) and prop galleries (`fps-sandbox.html?gallery=…`) were reviewed; what the player sees
most, first:

| What | Where | Problem | Done |
| --- | --- | --- | --- |
| Tree line and map pines | every outdoor map | solid green cones with a few procedural cards: the horizon read as rows of cones | slim dark cores under whorls of photo needle cards (Poly Haven pine sapling rendered into the atlas); broadleaf / scrub / birch cells photo cards too |
| Drums, oil barrels | highway, truck stop, Harlan, Sandstone | flat painted cylinders with the rust plate's texture stretched | Poly Haven steel drums (3 models) instanced; procedural drums on painted / flaking steel sets |
| Crates, ammo / military crates | everywhere | boxes with the siding's planks (Sandstone: blue shutter boards) | Poly Haven wooden crates and military crate; rough-sawn lumber set for the procedural ones |
| Cardboard boxes | road debris, walk-ins | brown boxes with plank grain | Poly Haven cardboard box (stacks), kraft-fibre set on the procedural ones |
| Cones, bins, coolers, cases, tanks | road debris, street | the tarp weave on hard plastic | weathered moulded-plastic set |
| Cars, vans, pickups, fire engine | highway pileup, every road | a blue steel plate's blotches greyed over the paint; wrecks a camouflage-like char | car-paint set (road dust, streaks); wrecks blistered rusting paint |
| Sandbags | checkpoint walls, barricades, tents | the canvas weave | burlap set |
| Plywood, boarded doors | apocalypse dressing, boarded windows | planks texture | plywood and OSB sets, rough lumber |
| Hydrants, jerrycans, cylinders, generators, trash cans, bags, tyres, picnic tables, chairs, stumps, logs, boulders, wheelchairs | street furniture, camps, nature | primitive boxes and cylinders | Poly Haven models (21 in all; the park bench stays procedural: the scanned bench read as a backless box) |
| Furniture in walk-in buildings | every walk-in | the planks texture on desks, flat sofas | veneer, leather, linen sets; lumber for crates / pallets, kraft for the rack's boxes |
| Car seats (cinematic) | through the glass | canvas weave | leather / linen |

Left as they were: signs and posters (the painted atlas of `dress-atlas.js` has no real brands already),
Sandstone's awnings and stalls (painted atlas), chain link (the procedural mask), tyres on vehicles (the
procedural tread bake), the world decor's cones and loose tyres (`world-props.js`, merged into the static
world before the models arrive).

## Sources

All CC0 1.0 from Poly Haven: textures `public/textures/CREDITS.md`, models `public/models/CREDITS.md`,
foliage cards `public/textures/foliage/foliage.json`. (ambientCG's API answers here, but its download host
is not reachable from the build environment, so nothing came from it.)

## Shots (before → after)

| Pair | What changed most |
| --- | --- |
| `highway-objective-day`, `-night` | the tree line (firs instead of cones), cardboard and cases by the guard rail |
| `highway-pileup-day`, `-night` | the burnt-out tanker: blistered rusting paint instead of a camouflage-like char |
| `highway-junction-day`, `highway-treeline-day` | the tree line close up: needle boughs instead of solid cones |
| `harlan-objective-day` / `-night`, `harlan-road-day`, `harlan-treeline-day` | firs on the horizon, trash bags and jerrycans as models, the wreck's paint |
| `truckstop-forecourt-day` / `-night` | the wrecked pickup, trash bags, painted pumps |
| `millroad-jam-day`, `millroad-forecourt-day` | the horizon's pines, debris |
| `sandstone-supply-day`, `sandstone-objective-day` / `-night` | crates in rough lumber instead of the town's blue shutter boards, drums |
| `hospital-parking-day` | the parking lot's dressing |
| `vehicles-day` | car paint (subtle: the paint material keeps its own clear coat) |
| `pines-edge-day`, `pines-objective-day`, `pines-treeline-day` / `-night`, `pines-edge-low` | the pine fix: no black core spike over the crowns, a soft uneven leader, leaning trees of different density (`treeline` is an elevated view over the forest; `edge` the tree line close up; `low` the cheap tier) |
| `props-boxes-cones`, `props-drums-crates`, `props-street`, `props-military`, `props-nature` | the prop galleries: models and new surfaces side by side |

## Budget, performance and load time

Measured in this container (no GPU: SwiftShader, 4 CPU cores), so the absolute numbers are a
software rasteriser's; the comparison is what counts.

* New files: 43.4 MB of PNG (13 surface sets — 12 at 512², car paint at 1024² — 22 model texture
  layers at 512², the foliage atlas) and 0.8 MB of model geometry; their download copies 17.6 MB.
* `benchmark.html?q=high&scale=0.5&secs=30&warm=120` (highway fly-through, night, 3 bots + horde):
  before 148 draw calls, 0.72–0.73 M triangles, median frame 1333 ms (avg 1356 / 1398 in two runs);
  after 149 draw calls (every prop model is one BatchedMesh), 0.80 M triangles, median 1358 ms (avg
  1476). With `props=0` the median is the same as with them: the models cost triangles and a little JS
  (the level switch while the camera flies at 0.7 fps), the rest is the new textures' and the pine
  cards' fragment work on the CPU rasteriser.
* `npm run timing` (served build, ultra, median of 2): highway title 0.6 → 0.6 s, game shown 63.1 →
  68.5 s, all textures 66.2 → 71.3 s, 204 → 223 MB received; Sandstone game 58.2 → 61.2 s, 200 → 217
  MB. The extra seconds are the twelve more sets decoded and packed on the CPU before the loading
  screen goes; the models and foliage cards stream in afterwards.
