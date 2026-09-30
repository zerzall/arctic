# THE JOURNEY: story levels for Road to Haven

This is the contract between the agents building the second version of the story campaign in parallel.
Read `STORY.md` first (the campaign, persistence, the mission script format, the hideouts), then `SPEC.md`
for the engine. Everything already there keeps working. Existing modes, maps, hideouts and the highway
mission with the bus stay as they are.

## 1. What the player gets

Players said the campaign "happens only around the bus". In the new version the crew **travels**. After the
bus they walk out of the pileup into nine new **story levels**. Each level is a long, hand-built route of
places, played like a Call of Duty or Battlefield campaign level:

* **A route of sections.** Each section is a place with its own look, for example a gas station, a trailer
  park, a hospital ER, a mall food court or a metro platform. The crew fights through it in order.
* **Gates between sections.** A shutter, door, fence, barricade, rubble, bars or a vehicle blocks the way.
  An objective opens it: hold E to start the forklift, find the key card, blow the rubble, or hold out
  while Priya cuts the chain. The zombies of the next section wait behind it and pour through when it opens.
* **Scripted beats.** Title cards when the crew enters a new area ("SAINT MERCY: EMERGENCY"), radio and
  in-person lines, horde bursts out of a doorway, an explosion, the lights going out, music swells, a
  checkpoint.
* **Interiors.** The hospital, mall, metro, police station, church and control rooms are real walkable
  spaces with ceilings and lamps. Rain, sun and moon stay outside.
* **Hideouts between chapters, as before.** Mill Road ends at the Roadhouse gate.
* **Two to four missions per chapter**, 12 to 25 minutes each, every one a different place.

Zombies stay slow (walkers 34–48 px/s). Tension comes from numbers, darkness, specials, pressure on an
objective and the crew splitting up to open a gate.

## 2. The campaign

| Ch | Title | Missions (map) | Hideout after |
|----|-------|----------------|---------------|
| 1 | Dead Highway | 1.1 **Pileup** (highway, kept as it is: defend the bus until dawn) · 1.2 **Mill Road** (millroad, day) | **The Roadhouse** |
| 2 | Hollow Creek | 2.1 **Hollow Creek** (hollowcreek, night) · 2.2 **Saint Mercy** (hospital, night) | (Roadhouse) |
| 3 | Blackwater | 3.1 **Westgate** (mall, night) · 3.2 **Blackwater Dam** (dam, day, storm) | **Blackwater Depot** |
| 4 | Delta | 4.1 **The Rail Yard** (railyard, dusk) · 4.2 **Fort Harlan** (airbase, night, rain) | (Depot) |
| 5 | Harlan County | 5.1 **Underground** (metro, night) · 5.2 **Blackpine** (forest, night, fog) | **Harlan Farmstead** |
| 6 | Haven | 6.1 **Last Stand** (harlan campaign: hill) · 6.2 **The Tower** (harlan campaign: tower, roof, zip line) | epilogue |

That is twelve main missions: the old 1.1, 6.1 and 6.2, plus nine new ones. The other old missions (Fuel
Run, Beacon, Diner Siege, Radio Parts, Night Hauler, The Crossing, Sunken Cargo, Hold the Tower, Broken
Line, Ghosts, Down the Interstate, Field Hospital) become **side jobs** on the hideout board. They are
optional, replayable, pay scrap, XP and loot, and never block the story. Agent W decides how the graph
expresses that and keeps every save working: an old save's `progress.node` must map onto the new graph.

Story beats per level. W writes the details; the level agents build the places for them.

* **1.2 Mill Road** (day). Dawn after the pileup. The bus is dead, so the crew walks west through miles of
  dead traffic. Deke is holed up at Mill Road Gas with a tow truck that needs a battery and fuel. Cross the
  Shady Acres trailer park (Ozzy's radio shack is there, and he joins) and the Haskell cornfield, then take
  the Roadhouse gate.
* **2.1 Hollow Creek** (night). The kids are sick (off screen) and need antibiotics. The town is overrun:
  Main Street, the pharmacy (looted, the back room isn't), St. Anne's church (the bell rings on its own and
  draws a horde), the elementary school (a message from June's teacher), the police station (armory
  keys, bars).
* **2.2 Saint Mercy** (night). Where the outbreak was first treated. Mara worked here. Get the case files
  and the insulin and restart the generator. Surgery, then the stairwell (the power cuts), then the roof,
  where the helipad radio reaches the Warden for the first time. It turns out the Warden is a kid.
* **3.1 Westgate** (night). The mall gone dark. Priya is barricaded in the security office. Food court
  horde, a department store blackout, the parking garage, the loading dock truck.
* **3.2 Blackwater Dam** (day, storm). The bridge is out, so the dam is the only crossing. Open the
  spillway, cross the crest in the wind, restart a turbine for the depot's power, and ride the river
  village road to Blackwater Depot.
* **4.1 The Rail Yard** (dusk). Get a locomotive running to reach Checkpoint Delta. Engine sheds, signal
  box levers, the rail bridge, the freight yard crane, the mainline. The finale is a horde chasing the
  train.
* **4.2 Fort Harlan** (night, rain). Sgt. Okafor's unit fell back to the airbase. Barracks, the hangars with
  a cargo plane, the control tower radio, then light the runway flares for the supply drop.
* **5.1 Underground** (night). The interstate is jammed solid, so the way into Harlan city is under it:
  concourse, a platform with a dead train, the tunnels, the flooded section (pumps), maintenance, then up
  into Harlan Square.
* **5.2 Blackpine** (night, fog). Out of the city through the pines: campground, ranger station and fire
  lookout (the signal fire), the gorge footbridge, a lumber mill, then the Harlan farm fence (the
  Farmstead).

## 3. Level data (shared, pure): `shared/levels/*`

A level is an ordinary map built by `buildMap(id, seed)` with `kind: 'level'`. It is not in `MAP_LIST`, so
the lobby never offers it. `LEVEL_LIST`, `LEVEL_DEFS`, `LEVEL_BUILDERS` and `LEVEL_SPECS` come from
`shared/levels/index.js`. Each level is one module, `shared/levels/<id>.js`, which exports:

* `SPEC`: **the contract**. It holds `id`, `name`, `chapter`, `time`, `owner`, `description`,
  `sections[{id, name}]` in travel order, `anchors{[section]: [names]}` and
  `gates[{id, kind, from, to, label}]`. Mission scripts, the engine and tests depend on these names.
  **Never rename or remove a section, anchor or gate of the SPEC, and keep the section order.** Adding is
  fine: new sections (append them, or ask W), anchors, gates and props.
* `DEF`: `{ width, height, darkness, tint, ground }`, the size and mood.
* `build(B)`: lays the level out with the map builder. Until a level agent replaces it,
  `placeholderLevel(B, SPEC)` (`shared/levels/kit.js`) stands in with a straight road of equal sections
  and a wall with the gate in it between each two.

`checkLevelSpec(map, spec)` (kit.js) lists what is missing. `tests/levels.test.js` runs it on every level.

### 3.1 Builder calls (maps.js `createBuilder`; everything the other maps use works too)

| Call | What |
|------|------|
| `B.section(id, name, x, y, w, h)` | A section: its rectangle (x, y = **centre**), in travel order. Anything of the section should be inside it. Sections may touch or overlap a little at the gates. |
| `B.gate(id, kind, x, y, w, h, a, {section, label, style, top, color})` | A **gate**: a solid `wall` obstacle tagged `o.gate = id`, `o.gateKind = kind`. Calling it again with the same id adds another piece (double doors, a two-part fence). It returns the obstacle. `map.gates[{id, kind, obstacles:[ids], label}]`. |
| `B.checkpoint(section, x, y)` | A respawn and late-join point of a section. Use at least two per section, in the open, never behind that section's gate. |
| `B.roof(x, y, w, h, a, {kind, height, section, dark})` | An **indoor space**. The renderer puts a ceiling at `height` (default 150) with fixtures by `kind` and a roof above it, and keeps sun, moon and rain out. `dark` 0..1 is how much of the sky light is lost inside (default 0.75). The sim ignores it. The walls are your own `wall` obstacles. |
| `B.zspawn(x, y, w, h, weight, section)` | Zombie spawn rectangles **tagged with their section**. Each section needs some, off the route and ideally out of sight: doorways, alleys, the treeline, behind a truck. |
| `B.anchor(name, x, y, r)` | Named places for the scripts (every SPEC name must exist). |
| `B.ob(kind, x, y, w, h, a, {style, prop, label, section, top, color, solid, ...})` | Any obstacle. `style` and `prop` are free-form tags that **your level art reads** to draw a bespoke model (`o.style === 'er-desk'`). `section` says where it stands. Use tags; do not add new obstacle kinds or edit `KIND_DEFAULTS`. |
| `B.light(...)`, `B.decor(...)`, `B.box(...)`, `B.line(...)`, `B.vehicle(...)`, `B.pspawn(...)`, `B.supply(...)`, `B.keep(...)`, `B.interact(...)` | As on every map (see maps.js). |

A few rules follow from how the sim works:

* **Solid obstacles are the walls.** An interior is built from thin `wall` obstacles, 8–20 thick, with
  gaps for doorways at least 70 wide (players are 32 wide, and a crowd needs more). Walls are not climbable
  (`CLIMB_TOP` lists what is), so a room is a room.
* **Keep the route readable and wide.** The main path is at least 160 wide everywhere. Give it side rooms
  and loops, not dead-end mazes: zombies path with a flow field, and bots follow the route.
* **Gate footprints fill their gap completely.** When a gate opens, its obstacles stop being solid, so
  nothing else may block that gap.
* **Size.** Up to about 12000 × 4000 world units (1 unit ≈ 3 cm; a room is 300–600 across, a street
  400–900 wide). A route may bend, fold back and use the whole rectangle; the width is not required to be
  the long side.
* **`start`** is an anchor in the first section, and `B.pspawn` places up to six player spawns there.
  `B.supply` (the ammo crate) goes near the start. More supply crates can be placed as
  `B.ob('crate', ..., {prop: 'supply'})` (E makes them refill ammo).
* **Water** (`B.box('water', ...)`, the dam and the flooded metro) works as on the bridge map.
* **Time** comes from the mission (`mission.time`). `SPEC.time` is the level's default. Night levels need
  their own lights (`B.light`): street lamps, fires, fluorescent tubes, emergency lights.

### 3.2 Gate kinds (`GATE_KINDS`)

| Kind | Looks like / opens by |
|------|-----------------------|
| `shutter` | A roller shutter or garage door that rolls **up** |
| `door` | A single or double door that **swings** open (hinge at the obstacle's −x end, or both ends for double doors) |
| `gate` | A chain-link or steel yard gate that **slides** sideways along its long axis |
| `fence` | A chain-link fence panel that is **cut and falls** flat |
| `barricade` | Planks, cars and sandbags that are **blown or pulled apart** (debris burst) |
| `rubble` | A collapsed pile that **explodes** and leaves a low mound |
| `bars` | A cell gate, turnstiles or a portcullis that **rises** into the ceiling |
| `vehicle` | A bus, truck or train car blocking the way that is **pushed or rolls** away along its long axis |

### 3.3 Roof kinds (`ROOF_KINDS`)

`plain` (a bare ceiling and bulbs) · `office` (ceiling tiles and fluorescent panels) · `hospital` (tiles,
long tubes, a clean cold light) · `mall` (high ceiling, skylights, spot rows) · `metro` (a vaulted concrete
tunnel with strip lights) · `industrial` (trusses, sodium high-bays, corrugated roof) · `house` (plaster and
a pendant lamp). A level's own art may draw its ceilings itself and set `o.style` on them. E's generic
renderer draws the rest.

## 4. The engine (agent E)

E owns the sim, net and UI side of the levels. **Protocol version becomes 11.** Every feature is a no-op
on the other maps.

### 4.1 Gates
* Sim state: one open flag per gate in `map.gates` order (plus the tick it changed, for the animation).
  Opening a gate makes its obstacles non-solid for players, zombies, bullets and grenades, and patches the
  **flow field** (the zombies waiting behind it now path through). Shutting a gate makes them solid again
  and pushes anything standing in the footprint out.
* Snapshot: the open bits (host → clients). The clients' prediction collision world follows them.
* Rendering (3D, `render3d/gates3d.js`): gate obstacles leave the static merged meshes and become
  separate meshes, animated by `gateKind` (§3.2) over about 1.2 s, with sound. A level art module can
  supply a gate's model (`art.gateModel(B, gate, o)`) and E animates it. Otherwise E draws a good generic
  model per kind. Top-down renderer: closed gates are drawn, open ones are not.
* Bots and the HUD: the objective marker points at the next gate while it is the way forward.

### 4.2 Sections, spawns and checkpoints
* The host tracks `section`: the furthest section (by index) that any living player has entered. On first
  entry it emits `{type:'area', id, name, i}`. The HUD shows a **title card** (the section name large, the
  level name small) and the compass marks the next section.
* **Spawns on a level** come from the spawn rects of the current and the next section only. That means
  from ahead, never from behind the party. `pressure.section` and the horde action override this. Zombies
  left more than a section behind and far from everyone are culled.
* **Checkpoints**: downed-and-dead players respawn (mission `respawn`), and late joiners appear, at a
  checkpoint of the current section. The `checkpoint` action sets the section.
* `reach { section }` is done when the party is in that section (`who`: `'any'` by default, or `'all'`).
* `defend { target: <anchor> }` on a level puts a **defend point** at that anchor, with hp as on the bus,
  a HUD bar and a marker. Losing it fails the mission. The level art usually has a model standing there
  (the tow truck, the generator), so E draws only the marker.
* Supply crates tagged `prop: 'supply'` work like `map.supply`.

### 4.3 Scripted actions (`LEVEL_ACTIONS`, `shared/story-defs.js`)
A step's `onStart` and `onDone` may list actions beside its lines. They run in order, and `delay` is in
seconds. The validator already knows them (see `shared/story/validate.js`).

| Action | Fields | Does |
|--------|--------|------|
| `gate` | `id`, `open` (true by default), `delay` | Opens or shuts a gate (§4.1) |
| `horde` | `at` (anchor) or `section`, `count`, `zombie` (a type or `'any'`), `delay` | A burst of zombies from that spot, or from the section's spawn rects |
| `explode` | `at`, `r`, `damage`, `delay` | A blast: the grenade/barrel effects scaled up, damage to zombies, shake and knockback for players (no player damage) |
| `lights` | `section`, `on`, `delay` | That section's map lights go out, and the renderer darkens its roofs, or come back. Players still have flashlights. |
| `title` | `text`, `sub`, `delay` | A title card for everyone |
| `music` | `state`, `delay` | Pushes the score to a state (`audio/music.js`) |
| `shake` | `k` (0..1), `delay` | Camera shake for every player near |
| `checkpoint` | `section`, `delay` | Moves the respawn point |

Actions reach the clients as sim events, like radio lines do, so late joiners do not replay them. Only
their lasting results (gate bits, lights off, the checkpoint) are state.

### 4.4 Renderer and UI support
* **Roofs and interiors** (`map.roofs`, 3D): a ceiling and roof mesh per roof by kind, with fixtures. The
  roofs cast sun and moon shadows. Rain does not fall under them (`rain.setRoofs`). A world-space **indoor
  mask** lowers the sky, hemisphere and sun light under a roof by `dark`, so the lamps light the room.
  Fixture lights are map lights the level placed, plus a few added by kind if the level placed none.
  Top-down: roofs are drawn translucent over the rooms.
* The map lookups of the UI (`ui/story-flow.js`, `ui/story-panels.js`, `timeofday`, `zone`) know levels
  (add a `mapMeta(id)` to maps.js). The minimap works on long levels (sections, gates, the route).
* Performance: a 12000 × 4000 level with its zombie cap runs its sim step in under 4 ms, and the flow field
  update on a gate opening takes under 30 ms.
* `validateLevel(map)` in `shared/levels/kit.js` (E writes it, the level agents use it in their tests):
  1. The route is walkable. With every gate open, every section's checkpoints are reachable from `start`,
     through the flow field or the movement grid.
  2. Gates block. With a section's gate shut, the next section is not reachable from the start without
     passing another gate.
  3. No anchor or checkpoint is inside a solid obstacle.
  4. No spawn rect lies inside a roofed room of an earlier section.
* e2e scenario `n`: a level mission played by bots from start to the second gate.

## 5. Level art (agents C1, C2 and C3)

Each level agent owns three levels, and only these files: `shared/levels/<id>.js`,
`render3d/levels/<id>.js` (plus any `render3d/levels/<id>-*.js` it splits them into) and
`tests/level-<id>.test.js`. `render3d/levels/index.js` and world.js already call the art modules through
the same seams as the hideouts (world-hideout.js):

```js
export const BUCKETS = { /* extra geo-builder buckets, if any */ };
export function createLevelArt(ctx, deps) {   // deps: { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder, matOf }
  return {
    obstacle(B, o) { /* draw o (by o.style / o.prop / o.gate) with B; return true, or false for the default model */ },
    objective(B, ob) { return false; },
    props(B) { /* free props, drawn once into the static meshes */ },
    finish() {}, update(view, frame) {}, setQuality(full) {}, dispose() {},
    material(bucket, t) {},   // for your BUCKETS
    gateModel(B, gate, o) {}, // optional: the model E animates for a gate (§4.1)
  };
}
```

The goal is **stunning, distinct places**. Every section should be recognisable in a screenshot:

* Use the geo builder (`world-geo.js`), the surface layers (`world-surf.js` `DET.*`, including the
  interior names `linoleum`, `carpet`, `drywall`, `ceiltile`, `wallpaper` and `terrazzo`, which agent T turns
  into real layers), the existing building and prop models (`world-bld*.js`, `world-props*.js`,
  `dress-*.js`) and the set-dressing items (`shared/dress.js` via `B.decor` and dress kinds).
* Interiors carry the look: floors, skirting, doors and frames, counters, shelves, signage, posters,
  blood, overturned furniture, debris, emergency lighting, broken windows showing the night outside.
* Exteriors: façades with depth, signage, vehicles, fences, vegetation, set-dressing clutter.
* Lights: warm and cold pools, flicker, emergency red, fire barrels. Fewer, well-placed lights beat many.
* Budget: under about 1.5 M static triangles on `ultra` and under about 400 draw calls per level. The
  `low` tier must work and stay light, since it is the fallback for weak machines.
* Keep the SPEC names (§3), use `o.style` / `o.prop` tags, and don't edit shared engine files. If you need
  something from the engine, write it in your report and don't change it yourself.
* Review with screenshots: `node scripts/shot.js <dir> "map=<id>&q=ultra&time=night&zombies=0" sec:<section> a:<anchor> '{"x":..,"y":..,"yaw":..,"pitch":..}'`.
  Check day and night if the level can be played at both (it is played at `SPEC.time`), and check the
  `low` and `high` tiers too.
* Tests (`tests/level-<id>.test.js`): the SPEC check, determinism, doorways wide enough, the route
  reachable through the flow field with gates open (use `validateLevel` once E's lands; until then do your
  own reachability check with `shared/flowfield.js`), gates blocking, and the art module building on every
  tier in node (as `tests/hideouts.test.js` does for the hideouts).

## 6. The other agents

* **W (writer)**: the campaign in §2. Owns `shared/story/missions/*`, `shared/story/dialogue/*`,
  `cast.js`, `missions.js`, `registry.js`, `graph.js`, `validate.js` and `story-defs.js`'s mission-side
  vocabulary, plus their tests (`story-data`, `story-missions`, `story-graph`, `story-real-content`).
  Writes the nine level missions against the SPECs (anchors, sections and gates by name) using the step
  types and the actions of §4.3. Each mission has a briefing, a debrief, notes and bonus steps, and every
  section has its own beat. The existing missions become side jobs. Old saves keep working.
* **Z (zombies)**: "the zombies look like dolls". Owns `render3d/actor-z*.js` and `actor-zlook.js`, and
  zombie parts of `actor-tex.js`/`actor-rig*.js` when a change there is needed and doesn't change the
  survivors. The zombies should read as rotting human corpses at every tier:
  * gaunt anatomy and proportions, sunken eyes, jaw and teeth;
  * desaturated, mottled, grimy skin with bruising, veins and wounds;
  * torn and bloodied clothes of different kinds (work, casual, hospital gowns, uniforms, business);
  * a lurching, uneven gait and asymmetry;
  * the specials unmistakable.
  No plastic sheen and no toy colours.
* **T (textures)**: world textures a level higher. Owns `render3d/world-surf.js` (the layer recipes and the
  interior layers), `world-tex.js`, `ground*.js`, `surfaces.js` and `world-mat.js` (material response
  only). Gives the interior names of `DET` real layers (linoleum, carpet, drywall, ceiling tile,
  wallpaper, terrazzo). Improves the existing layers' detail, the normal and roughness response and the
  macro variation that breaks up tiling, and the 512² cinematic path. The names of `DET` stay.

## 7. Ownership and merge order

Merge order: **E → C1 → C2 → C3 → W → Z → T**. The coordinator reconciles `PROTOCOL_VERSION`, `index.html`,
`SPEC.md`, `README.md`, this file and the e2e scenario letters. Each agent works in its own worktree,
commits often, and never pushes. At the end it reports what it did, the files it changed, the test
results, screenshots, and anything it needs from another agent.
