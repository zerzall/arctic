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

## Procedurally baked (this repository)

`road_wear`, `road_paint`, `metal_camo`, `char`, `linoleum_hospital`, `ceiling_tile`, `canvas`, `tarp`, `rubber`, `glass_cracked`, `hesco`

The decals, guns and zombies folders are the game's own bakes as well.
