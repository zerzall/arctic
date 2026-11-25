# Texture credits

The world's surface sets in this folder come from two places:

* **Photo-scanned materials from [Poly Haven](https://polyhaven.com)**, all released under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain; no attribution
  required — credited here anyway, with thanks to the authors). They were downloaded as 2K JPG
  maps and repacked into the game's own format by `scripts/fetch-photo-textures.js`
  (box-filtered to 1024², repeated a whole number of times across each set's tile so the tiling
  stays seamless, mean luminance matched to the game's lighting). Each set's manifest entry has a
  `source` field with the asset id, page, licence and the exact file URLs and md5 sums.
* **The game's own procedural bake** (`scripts/bake-textures.js`, MIT like the rest of the game)
  for the sets no photo material fits.

## Photo materials (CC0 1.0)

| Set | Source asset | Authors | Licence | Scale |
| --- | --- | --- | --- | --- |
| `brick_red` | [Red Brick](https://polyhaven.com/a/red_brick) (`red_brick`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.44 m (photo 1.4 m) |
| `brick_yellow` | [Yellow Bricks](https://polyhaven.com/a/yellow_bricks) (`yellow_bricks`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.44 m (photo 2 m) |
| `cinder_block` | [Concrete Block Wall 03](https://polyhaven.com/a/concrete_block_wall_03) (`concrete_block_wall_03`) | Charlotte Baglioni | CC0 1.0 | 1×1 over 2.4 m (photo 1.81 m) |
| `concrete` | [Dirty Concrete](https://polyhaven.com/a/dirty_concrete) (`dirty_concrete`) | Rob Tuytel | CC0 1.0 | 1×1 over 2.88 m (photo 3 m) |
| `concrete_dam` | [Concrete](https://polyhaven.com/a/concrete) (`concrete`) | Rob Tuytel | CC0 1.0 | 1×1 over 2.88 m (photo 4 m) |
| `concrete_slab` | [Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001) (`concrete_floor_worn_001`) | Dimitrios Savva, Rico Cilliers | CC0 1.0 | 1×1 over 3.84 m (photo 3 m) |
| `runway` | [Hangar Concrete Floor](https://polyhaven.com/a/hangar_concrete_floor) (`hangar_concrete_floor`) | Dimitrios Savva | CC0 1.0 | 2×2 over 3.84 m (photo 2 m) |
| `sidewalk` | [Concrete Pavement](https://polyhaven.com/a/concrete_pavement) (`concrete_pavement`) | Charlotte Baglioni | CC0 1.0 | 1×1 over 1.92 m (photo 1.8 m) |
| `stucco` | [White Stucco 02](https://polyhaven.com/a/white_stucco_02) (`white_stucco_02`) | Dimitrios Savva | CC0 1.0 | 1×1 over 1.2 m (photo 1.8 m) |
| `plaster` | [Worn Plaster Wall](https://polyhaven.com/a/worn_plaster_wall) (`worn_plaster_wall`) | Dimitrios Savva | CC0 1.0 | 1×1 over 1.92 m (photo 1.8 m) |
| `plaster_bleached` | [Coral Fort Wall 01](https://polyhaven.com/a/coral_fort_wall_01) (`coral_fort_wall_01`) | Dimitrios Savva, Rico Cilliers | CC0 1.0 | 1×1 over 1.92 m (photo 1.36 m) |
| `adobe` | [Rough Plaster Broken](https://polyhaven.com/a/rough_plaster_broken) (`rough_plaster_broken`) | Rob Tuytel | CC0 1.0 | 1×1 over 2.16 m (photo 1.5 m) |
| `asphalt` | [Worn Asphalt](https://polyhaven.com/a/worn_asphalt) (`worn_asphalt`) | Amal Kumar | CC0 1.0 | 1×1 over 0.9 m (photo 2 m) |
| `grass` | [Sparse Grass](https://polyhaven.com/a/sparse_grass) (`sparse_grass`) | Amal Kumar | CC0 1.0 | 1×1 over 1.2 m (photo 2 m) |
| `dirt` | [Brown Mud Dry](https://polyhaven.com/a/brown_mud_dry) (`brown_mud_dry`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.32 m (photo 1.3 m) |
| `mud` | [Brown Mud 02](https://polyhaven.com/a/brown_mud_02) (`brown_mud_02`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.32 m (photo 1.3 m) |
| `gravel` | [Ground Grey](https://polyhaven.com/a/ground_grey) (`ground_grey`) | Rob Tuytel | CC0 1.0 | 1×1 over 0.78 m (photo 1 m) |
| `ballast` | [Rock Ground](https://polyhaven.com/a/rock_ground) (`rock_ground`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.2 m (photo 1.5 m) |
| `sand` | [Sand 01](https://polyhaven.com/a/sand_01) (`sand_01`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.32 m (photo 1.5 m) |
| `rock` | [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry) (`rock_boulder_dry`) | Dimitrios Savva, Rico Cilliers | CC0 1.0 | 1×1 over 1.8 m (photo 1.8 m) |
| `sandstone` | [Cliff Side](https://polyhaven.com/a/cliff_side) (`cliff_side`) | James Ray Cock, Jenelle van Heerden, Dario Barresi | CC0 1.0 | 1×1 over 2.1 m (photo 1.83 m) |
| `cracked_earth` | [Mud Cracked Dry 03](https://polyhaven.com/a/mud_cracked_dry_03) (`mud_cracked_dry_03`) | Dario Barresi, Dimitrios Savva | CC0 1.0 | 2×2 over 2.7 m (photo 1.5 m) |
| `metal_painted` | [Blue Metal Plate](https://polyhaven.com/a/blue_metal_plate) (`blue_metal_plate`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.44 m (photo 2.5 m) |
| `corrugated` | [Corrugated Iron](https://polyhaven.com/a/corrugated_iron) (`corrugated_iron`) | Jenelle van Heerden, Dimitrios Savva | CC0 1.0 | 1×1 over 1.08 m (photo 1.12 m) |
| `corrugated_rust` | [Rusty Corrugated Iron](https://polyhaven.com/a/rusty_corrugated_iron) (`rusty_corrugated_iron`) | Charlotte Baglioni | CC0 1.0 | 1×1 over 1.08 m (photo 2 m) |
| `metal_roof` | [Box Profile Metal Sheet](https://polyhaven.com/a/box_profile_metal_sheet) (`box_profile_metal_sheet`) | Amal Kumar | CC0 1.0 | 1×1 over 1.92 m (photo 2 m) |
| `steel_rusted` | [Rusty Metal 05](https://polyhaven.com/a/rusty_metal_05) (`rusty_metal_05`) | Amal Kumar | CC0 1.0 | 1×1 over 1.32 m (photo 1.25 m) |
| `rail_rust` | [Rust Coarse 01](https://polyhaven.com/a/rust_coarse_01) (`rust_coarse_01`) | Dimitrios Savva, Rico Cilliers | CC0 1.0 | 1×1 over 1.32 m (photo 2.2 m) |
| `diamond_plate` | [Metal Plate](https://polyhaven.com/a/metal_plate) (`metal_plate`) | Rob Tuytel | CC0 1.0 | 2×2 over 1.2 m (photo 0.5 m) |
| `planks` | [Weathered Planks](https://polyhaven.com/a/weathered_planks) (`weathered_planks`) | Dario Barresi, Dimitrios Savva | CC0 1.0 | 1×1 over 1.2 m (photo 2 m) |
| `siding` | [Brown Planks 07](https://polyhaven.com/a/brown_planks_07) (`brown_planks_07`) | Rob Tuytel | CC0 1.0 | 2×2 over 1.92 m (photo 1 m) |
| `shutter_blue` | [Blue Painted Planks](https://polyhaven.com/a/blue_painted_planks) (`blue_painted_planks`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.2 m (photo 1 m) |
| `bark` | [Bark Brown 02](https://polyhaven.com/a/bark_brown_02) (`bark_brown_02`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.08 m (photo 1 m) |
| `shingles` | [Grey Roof Tiles 02](https://polyhaven.com/a/grey_roof_tiles_02) (`grey_roof_tiles_02`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.68 m (photo 1.5 m) |
| `linoleum` | [Old Linoleum Flooring 01](https://polyhaven.com/a/old_linoleum_flooring_01) (`old_linoleum_flooring_01`) | Charlotte Baglioni | CC0 1.0 | 1×1 over 2.4 m (photo 1.99 m) |
| `carpet` | [Dirty Carpet](https://polyhaven.com/a/dirty_carpet) (`dirty_carpet`) | Rohit Seervi | CC0 1.0 | 2×2 over 1.5 m (photo 0.6 m) |
| `drywall` | [Ceiling Interior](https://polyhaven.com/a/ceiling_interior) (`ceiling_interior`) | Dimitrios Savva | CC0 1.0 | 1×1 over 2.4 m (photo 2 m) |
| `wallpaper` | [Decrepit Wallpaper](https://polyhaven.com/a/decrepit_wallpaper) (`decrepit_wallpaper`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.44 m (photo 2.5 m) |
| `terrazzo` | [Terrazzo Tiles](https://polyhaven.com/a/terrazzo_tiles) (`terrazzo_tiles`) | Amal Kumar | CC0 1.0 | 1×1 over 1.2 m (photo 2 m) |
| `marble` | [Marble 01](https://polyhaven.com/a/marble_01) (`marble_01`) | Rob Tuytel | CC0 1.0 | 2×2 over 2.4 m (photo 1.5 m) |
| `tile_hospital` | [Interior Tiles](https://polyhaven.com/a/interior_tiles) (`interior_tiles`) | Charlotte Baglioni | CC0 1.0 | 1×1 over 1.2 m (photo 1.9 m) |
| `tile_metro` | [Long White Tiles](https://polyhaven.com/a/long_white_tiles) (`long_white_tiles`) | Jenelle van Heerden, Sergej Majboroda | CC0 1.0 | 1×1 over 1.2 m (photo 1.27 m) |
| `tile_ceramic` | [Floor Tiles 08](https://polyhaven.com/a/floor_tiles_08) (`floor_tiles_08`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.2 m (photo 1.5 m) |
| `terracotta` | [Roof Tiles 14](https://polyhaven.com/a/roof_tiles_14) (`roof_tiles_14`) | Rob Tuytel | CC0 1.0 | 1×1 over 1.2 m (photo 1.5 m) |
| `crate_wood` (new) | [Rough Wood](https://polyhaven.com/a/rough_wood) (`rough_wood`) | Rob Tuytel | CC0 1.0 | 2×2 over 1 m (photo 0.5 m) |
| `plywood` (new) | [Plywood](https://polyhaven.com/a/plywood) (`plywood`) | Rob Tuytel | CC0 1.0 | 2×2 over 1 m (photo 0.5 m) |
| `osb` (new) | [Oriented Strand Board](https://polyhaven.com/a/oriented_strand_board) (`oriented_strand_board`) | Dimitrios Savva | CC0 1.0 | 1×1 over 2.5 m (photo 2.51 m) |
| `paint_metal` (new) | [Green Metal Rust](https://polyhaven.com/a/green_metal_rust) (`green_metal_rust`) | Rob Tuytel | CC0 1.0 | 1×1 over 1 m (photo 1 m) |
| `paint_rust` (new) | [Rusty Painted Metal](https://polyhaven.com/a/rusty_painted_metal) (`rusty_painted_metal`) | Amal Kumar | CC0 1.0 | 1×1 over 2.2 m (photo 2.2 m) |
| `car_paint` (new) | [Container Side](https://polyhaven.com/a/container_side) (`container_side`) | Dimitrios Savva | CC0 1.0 | 1×1 over 2 m (photo 1.94 m) |
| `burlap` (new) | [Hessian 230](https://polyhaven.com/a/hessian_230) (`hessian_230`) | colormass, Rico Cilliers | CC0 1.0 | 1×1 over 0.27 m (photo 0.27 m) |
| `kraft` (new) | [Hessian 380](https://polyhaven.com/a/hessian_380) (`hessian_380`) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 0.54 m (photo 0.27 m) |
| `leather` (new) | [Fabric Leather 01](https://polyhaven.com/a/fabric_leather_01) (`fabric_leather_01`) | Rob Tuytel | CC0 1.0 | 1×1 over 0.4 m (photo 0.4 m) |
| `linen` (new) | [Rough Linen](https://polyhaven.com/a/rough_linen) (`rough_linen`) | colormass, Rico Cilliers | CC0 1.0 | 1×1 over 0.27 m (photo 0.27 m) |
| `veneer` (new) | [Kitchen Wood](https://polyhaven.com/a/kitchen_wood) (`kitchen_wood`) | Rob Tuytel | CC0 1.0 | 1×1 over 0.6 m (photo 0.6 m) |
| `bark_pine` (new) | [Pine Bark](https://polyhaven.com/a/pine_bark) (`pine_bark`) | Dimitrios Savva | CC0 1.0 | 1×1 over 2 m (photo 2 m) |
| `plastic_worn` (new) | [Weathered Pvc Tank](https://polyhaven.com/a/weathered_pvc_tank) (`weathered_pvc_tank`) | Amal Kumar | CC0 1.0 | 1×1 over 1 m (photo 0.99 m) |

Sets marked *new* are not replacements of a baked set: the props, vehicles, furniture and trees draw them
through surface ids of their own (`PHOTO_NEW` in the script); they keep the photo's own colour.

## Prop models and foliage cards (CC0 1.0)

* `models/` holds the texture layers (512² albedo, normal, AO / roughness / metalness) of the
  photo-scanned prop models in `../models/` (barrels, crates, cardboard boxes, cylinders, jerrycans, trash
  cans, a hydrant, a generator, tyres, trash bags, a picnic table, a chair, a stump, a log, a
  boulder, a wheelchair): Poly Haven models, CC0 1.0, converted by `scripts/fetch-models.js`; the
  credits per model are in `../models/CREDITS.md`.
* `foliage/leaves.png` holds the photo foliage cards of the leaf atlas, rendered by
  `scripts/bake-foliage.js` from Poly Haven plant models (CC0 1.0):
  * `pine`: [Pine Sapling Small](https://polyhaven.com/a/pine_sapling_small) (`pine_sapling_small`), Rob Tuytel, Rico Cilliers, CC0 1.0 — pine needles on twigs, a sapling seen from above
  * `scrub`: [Searsia Lucida](https://polyhaven.com/a/searsia_lucida) (`searsia_lucida`), James Ray Cock, Jenelle van Heerden, CC0 1.0 — a leafy shrub, another plant of the same bush, seen from the side
  * `broadA`: [Tree Small 02](https://polyhaven.com/a/tree_small_02) (`tree_small_02`), Rico Cilliers, CC0 1.0 — the crown of a young deciduous tree, seen from the side
  * `broadB`: [Island Tree 02](https://polyhaven.com/a/island_tree_02) (`island_tree_02`), Rob Tuytel, Rico Cilliers, CC0 1.0 — a round broadleaf crown, seen from the side
  * `birch`: [Searsia Lucida](https://polyhaven.com/a/searsia_lucida) (`searsia_lucida`), James Ray Cock, Jenelle van Heerden, CC0 1.0 — small glossy leaves on fine twigs, a bush seen from the side

## Procedurally baked (this repository)

`road_wear`, `road_paint`, `metal_camo`, `char`, `linoleum_hospital`, `ceiling_tile`, `canvas`, `tarp`, `rubber`, `glass_cracked`, `hesco`

The decals and guns folders are the game's own bakes as well.

## Zombies (`zombies/`, and the body in `public/js/render3d/actor-zbody-data.js`)

* **The body: [MakeHuman](http://www.makehumancommunity.org)** (Data Collection AB, Joel Palmius,
  Jonas Hauquier and the MakeHuman community), whose bundled assets were released under
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) in 2020
  ([licence](https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md)). Used: the base
  mesh `makehuman/data/3dobjs/base.obj` (with its eye, teeth and tongue helpers and its UV layout),
  the default skeleton `rigs/default.mhskel` and its weights `rigs/default_weights.mhw`, and the macro
  targets `targets/macrodetails/caucasian-{male,female}-{young,old}.target`,
  `universal-{male,female}-young-{averagemuscle-maxweight,minmuscle-minweight,maxmuscle-averageweight}.target`
  and `targets/stomach/stomach-pregnant-incr.target`, fetched from raw.githubusercontent.com by
  `scripts/build-zbody.js`, which poses, morphs, decimates and repacks them (MIT like the rest of the game).
* **The skin atlases** (`body-*`) are painted on that mesh's UV layout by `scripts/zbake/body.js`
  (procedural, this repository); the tiling skins (`skin-*`), the wound atlas and the grime masks
  by `scripts/zbake/skin.js` and `misc.js`.
* **The fabrics** (`cloth-*`) are photo-scanned materials from [Poly Haven](https://polyhaven.com),
  CC0 1.0, downloaded as 2K JPG maps (colour, OpenGL normal, roughness, occlusion) and repacked by
  `scripts/zbake/fabric.js` (a whole number of repeats across a 48 cm tile, the colour turned into a
  relative brightness the game tints per zombie, sun-bleached wear added):

| Set | Source asset | Authors | Licence | Scale |
| --- | --- | --- | --- | --- |
| `cloth-denim` | [Denim Fabric 03](https://polyhaven.com/a/denim_fabric_03) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 27 cm) |
| `cloth-flannel` | [Fabric Pattern 05](https://polyhaven.com/a/fabric_pattern_05) | Rob Tuytel | CC0 1.0 | 1×1 over 48 cm (photo 50 cm) |
| `cloth-tee` | [Cotton Jersey](https://polyhaven.com/a/cotton_jersey) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 26 cm) |
| `cloth-gown` | [Rough Linen](https://polyhaven.com/a/rough_linen) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 27 cm) |
| `cloth-police` | [Terlenka](https://polyhaven.com/a/terlenka) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 27 cm) |
| `cloth-military` | [Book Pattern](https://polyhaven.com/a/book_pattern) | Rob Tuytel | CC0 1.0 | 2×2 over 48 cm (photo 30 cm) |
| `cloth-work` | [Denim Fabric 06](https://polyhaven.com/a/denim_fabric_06) | Greg Zaal, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 25 cm) |
| `cloth-shirt` | [Stretch Poplin](https://polyhaven.com/a/stretch_poplin) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 29 cm) |
| `cloth-suit` | [Poly Wool Herringbone](https://polyhaven.com/a/poly_wool_herringbone) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 27 cm) |
| `cloth-hoodie` | [Jogging Melange](https://polyhaven.com/a/jogging_melange) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 27 cm) |
| `cloth-dress` | [Crepe Georgette](https://polyhaven.com/a/crepe_georgette) | colormass, Rico Cilliers | CC0 1.0 | 2×2 over 48 cm (photo 26 cm) |
