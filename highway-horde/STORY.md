# ROAD TO HAVEN — story co-op design contract

This document is the contract between the people (agents) building the story mode in parallel. Read
`SPEC.md` first for the engine (host-authoritative deterministic 2D sim, 60 Hz, prediction on
clients, binary snapshots, PeerJS/relay/local transports, FPS + top-down renderers). Story mode
is built ON TOP of that engine: existing modes (Defend / Evac Run / Campaign) keep working
exactly as before.

## 1. What the player gets

Friends (1–6, online or solo with AI survivors) play a **persistent story campaign**: twelve
story missions in six chapters that travel across the county (the bus on the highway, nine story
levels, the marina finale; JOURNEY.md), twelve optional **side jobs** on the hideout board, all
connected by **hideouts** — safe, walkable hub
areas where the crew heals, talks to survivors, upgrades weapons, spends supplies on improving
the hideout and picks the next mission. Progress is saved: the *world* (chapter, hideout
upgrades, story flags, stash) and each player's own *profile* (level, perks, weapon upgrades,
scrap). Any friend who was in the campaign can host it later.

Pillars: (1) fun moment to moment — varied objectives, not only "survive waves"; (2) a reason to
come back — levels, perks, weapon upgrades, a hideout that visibly grows; (3) a story with
characters you care about, told through short dialogue scenes and radio chatter; (4) it feels
good with 2–4 friends; (5) zombies are SLOW and menacing (walkers ~34–48 px/s vs the player's
190) — tension comes from numbers, ambushes, specials and objectives, not speed.

## 2. Story bible (authors may deepen; do not contradict)

Day 41 of the outbreak. A radio voice, **the Warden**, has been repeating a message for a week:
*"Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what
you can carry."* The crew — survivors thrown together at a wrecked highway pileup — decides to
make the two-hundred-mile trip. Each chapter is one stretch of the road; each act ends at a
hideout where the group rests. Themes: found family, small kindnesses, hope against numbers.
The last chapter is the escape from the marina tower by zip line onto the ferry deck. A twist
is welcome (e.g. the ferry needs fuel and parts the crew gathered along the way; the Warden
is one frightened teenager on a real radio).

Recurring cast (voice via portrait + name; authors may add): **Mara Voss** — field medic
(infirmary). **Deke Harlan** — old mechanic, gruff, kind (workbench). **Ozzy** — teenage radio
nerd (mission board / radio). **Sgt. Okafor** — army sergeant holding Checkpoint Delta
(armory). **Priya Nair** — scout/engineer who joins in chapter 3. **June** — a child from the
school bus (mascot; never in danger on screen). **The Warden** — radio only.

The road, deepened (the written campaign). The crew walks off the highway on Day 42: Deke is holed up
at Mill Road Gas with a tow truck, Ozzy has logged the Haven message for nine nights from a trailer
with an antenna, and Roz lets everybody into the Roadhouse. In Hollow Creek, June's teacher Ruth
Delaney wrote on a school chalkboard on Day 7 that the bus was on Highway 9 and that she had gone to
the lake for boats; Mara keeps it from June until she knows how the story ends. On Saint Mercy's
helipad the crew hears the Warden live for the first time: a frightened fifteen-year-old reading her
grandfather's script so it does not stop, who reads out his list for the ferry (fuel, a regulator,
injectors). The road fills the list without meaning to: a turbine regulator from the Blackwater
dam, locomotive injectors from the Harlan rail yard ("they put that engine in tugboats"), army JP-8
from Fort Harlan, medicine from Hollow Creek and Saint Mercy. Sgt. Okafor held Checkpoint Delta
until Day 47, then fell back to Fort Harlan airfield with eleven soldiers and said "Delta" into the
tower radio every ten minutes until someone answered. Under Harlan City and through the Blackpine
fog the crew reaches the Haskell farm; from the fire lookout they light a signal fire, and across the
lake the Warden leaves the harbor light on for them. On the tower she finally says her name: Wren
Alcott. Quill, Dutch and Wendell (with Biscuit) join only through side jobs, and the finale speaks
of them only when they came.

The campaign as written (JOURNEY.md §2; `shared/story/missions.js`). `->` a mission that follows
at once on the road, `=>` a hideout arrival scene. Day or night is the mission's own; the
"Daylight only" option (§3) plays everything by day.

| Ch | Title | Missions (map, time): the beat | Hideout after |
|----|-------|--------------------------------|---------------|
| 1 | Dead Highway | 1.1 **Pileup** (highway, night): defend the bus until dawn -> 1.2 **Mill Road** (millroad, day): walk west through the jam, meet Deke at Mill Road Gas and Ozzy at Shady Acres, reach the Roadhouse gate | => **The Roadhouse** (motel) |
| 2 | Hollow Creek | 2.1 **Hollow Creek** (hollowcreek, day): antibiotics from the Rexall's back room, St. Anne's bell, Ms. Delaney's chalkboard, the police lot · 2.2 **Saint Mercy** (hospital, night): Mara's old hospital, case files, insulin, the generator, the helipad radio: the Warden is fifteen | (Roadhouse) |
| 3 | Blackwater | 3.1 **Westgate** (mall, day): Priya in the security office, the food court, Harrow's in the dark, the box truck -> 3.2 **Blackwater Dam** (dam, day, storm): the spillway, the crest in the wind, turbine two (a regulator for the ferry), the river road | => **Blackwater Depot** (rail depot) |
| 4 | Delta | 4.1 **The Rail Yard** (railyard, day to sunset): injectors from the sheds, the signal box, the first Brute on the rail bridge, locomotive 2217 -> 4.2 **Fort Harlan** (airbase, night, rain): Okafor's eleven in the tower, JP-8 for the ferry, the runway lit for the supply drop | (Depot) |
| 5 | Harlan County | 5.1 **Underground** (metro, day): under the jammed interchange, the dead train, the sump, the Abomination in the works, daylight in Harlan Square -> 5.2 **Blackpine** (forest, day, fog): the signal fire the Warden sees across the lake, the gorge, the mill, the farm gate | => **Harlan Farmstead** |
| 6 | Haven | 6.1 **Last Stand** (harlan campaign, day): the hill -> 6.2 **The Tower** (harlan campaign, day): tower, roof, zip line; the Warden says her name | epilogue |
| 7 | Side Jobs | Fuel Run, Beacon, Diner Siege, Radio Parts, Night Hauler (from ch. 2) · The Crossing, Sunken Cargo (ch. 3) · Hold the Tower, Broken Line, Ghosts (ch. 4) · Down the Interstate, Field Hospital (ch. 5) | back to the hideout |

Twelve story missions and twelve side jobs. The side jobs are the first campaign's missions on the
classic maps (highway, truckstop, bridge, checkpoint, harlan): `side: true`, filed under chapter 7
so they never hold the story's chapter back, `opens` = the story chapter they belong to,
`requires` = what puts them on the board, `after: 'hideout'` = back to the hideout the crew is in.
They are optional and replayable, never a node of `nextNodes()`, and three of them bring people home
(Quill, Dutch, Wendell). Difficulty ramps with chapter; recommended player levels are in the mission
data (the story alone takes a party from level 1 to ~14; side jobs add on top; cap 20).

Old saves: the story missions kept the first campaign's ids by chapter and position (m1_1 .. m6_2),
so an old World's `completed` already names the matching point of the new road (`index.js
LEGACY_MISSIONS`, `tests/story-legacy.test.js`).

## 3. Persistence (all client-side; the game has no server)

Keys in `localStorage` (wrap every access in try/catch; must degrade gracefully if unavailable):
`highway-horde:story:profile:v1` (this browser's player profile) and
`highway-horde:story:worlds:v1` (map of `worldId → World`, this browser's copies of every
campaign world it has played).

```js
Profile = { v:1, id:'uuid', name, xp, level, perkPoints, perks:{[perkId]:rank}, scrap,
  weapons:{ [weaponId]:{ tier:0..5 } },          // owned + upgraded (persistent)
  loadout:[weaponId, weaponId|null, weaponId|null], cls, color,
  stats:{ kills, missions, deaths, revives, playtime }, cosmetics:{}, updatedAt }
World = { v:1, id:'uuid', name:'Crew name', rev:int, createdAt, updatedAt, difficulty,
  progress:{ node:'m1_1'|'hideout:roadhouse', completed:{[missionId]:{ stars:1..3, time }}, flags:{[k]:true} },
  hideout:{ current:'roadhouse', upgrades:{[upgradeId]:tier}, recruited:{[npcId]:true}, stash:{ scrap, medkit, ammo... } },
  members:{[profileId]:{ name, lastSeen }}, settings:{ daylight:false } }
```
`settings` are the crew's campaign options: `daylight` ("Daylight only", set by the host in the story
lobby) plays every mission and side job by day (`shared/story/daylight.js missionTime()`); worlds saved
before it read as all options off.
**Every participant keeps a copy of the World** (host broadcasts it after each save;
`rev` increases on every change). Whoever hosts later picks the highest-`rev` copy it has, so
the campaign survives its original host leaving. Profiles are per browser; a joining player sends
theirs in the join handshake and the host sanity-checks it (level ≤ 20, xp/scrap/perk points
consistent with level, tiers ≤ 5, weapons that exist). Saves can be exported/imported as JSON
files. There must be a "New campaign / Continue / Import / Export" flow.

## 4. Game flow

Main menu **Story** → Story screen (continue / new campaign / import; solo-with-bots, host
online or join with the usual invite link/room code) → **Story lobby** (party, world summary,
difficulty for new campaigns) → the crew starts in the **hideout** (a `Game` on a hub map,
`settings.mode === 'hideout'`) → at the mission board/radio the host picks the next mission
(party ready check) → **briefing** dialogue → the **mission** (`Game`, `settings.mode ===
'mission'`, a normal map with the mission director active) → **debrief** (XP, scrap, loot,
level-ups, stars, story dialogue) → back to the hideout. Each hideout visit and each mission
is its own `Game` instance driven by the host; the session chains them without dropping
players to the plain lobby. Losing a mission = retry or return to hideout (no permadeath; lose
the mission's unbanked loot). Leaving mid-mission keeps the player's profile intact.

Hideout stations (interactables, press E): **mission board / radio** (start mission, host),
**workbench** (spend scrap: weapon tiers 1–5 — damage, magazine, reload, spread), **armory /
stash** (choose the 3-weapon loadout from owned weapons; store/take supplies),
**infirmary** (heal, revive perks, reset perks once per chapter), **upgrade board** (spend
stash scrap/supplies on hideout upgrades, visible in 3D), **bed** (advance to the next
day/night, autosave), **shooting range** (practice targets), **campfire** (ambient NPC banter).

Hideout upgrades (each has tiers 1–3 and is visible in the hub): Generator (lights, power),
Watchtower (turret during raids / ambient guard), Infirmary (start missions with armor, faster
revive), Armory (more starting ammo), Radio Mast (side missions/hints), Garden (more scrap and
supplies per mission), Palisade (walls; hideout raid defence). *(Optional stretch: an
occasional night raid on the hideout, defended with those upgrades.)*

Progression: XP per kill/objective/mission; level 1–20; a perk point per level (perks:
Steady Hands, Quick Hands, Thick Skin, Field Medic, Scavenger, Ammo Hoarder, Sprinter, Iron
Will, Demolition, Marksman, Lucky Loot, Second Wind — 3 ranks each; final list is S1's).
Weapons come from mission rewards/crates/blueprints; **all 27 guns exist**; unowned guns can
be found or bought at the workbench with scrap.

Difficulty: the world has Easy / Normal / Hard / Nightmare (existing difficulty table). Zombie
count scales with party size; rewards scale with difficulty.

## 5. Interfaces between the parts (the contract)

### 5.1 Game settings & phases
`new Game({ map, settings: { mode:'mission'|'hideout', story:{ nodeId | mission, simMode?, difficulty, title?, party:[{pid, loadout?, perks?, armor?}], npcs:[{id, name?, look?, x, y, mode?}], worldId, flags, hideoutUpgrades, ... }, ... } })`.
`nodeId` is a mission id (the written story missions and side jobs are always known: `shared/story/registry.js`, after the content the session installed); `mission` is the script itself
(tests, tools); `simMode` overrides the script's `mode`. The host and every client build the map with
`buildMap(id, seed, mapBuildOptions(settings))` (a campaign mission uses the campaign variant of its map). `party[]`
is what a survivor's profile gives them in the sim: `loadout` (up to three weapon ids), `perks` (a `perks` object as
in classes.js) and `armor`. SPEC §3.9 is the executor's reference.
Existing modes are untouched. In `'hideout'` mode there are no waves and no zombies (unless a
raid is scripted); players can walk, jump, shoot the range targets, interact. In `'mission'`
mode the **mission director** (`shared/sim/story.js`, owned by S2) runs the mission script.
When a mission ends the sim emits `{ type:'storyend', result:'victory'|'defeat', reason, mission, stars (0 on defeat,
else 1 + time + clean run), met:{time,noDowns,optional,perfect}, time, downs, stats:{[pid]:{name,kills,downs,revives,damage,items}},
items:{[id]:n}, flags:{k:true} (the flags the steps set) }` and stops spawning; the host session handles rewards
(`mission.rewards`) and merges `flags` into the world.

### 5.2 Map extensions (data on the map object)
* `map.anchors = { [name]:{x,y,r} }` — named places mission scripts refer to (S2 adds them to
  the maps; the names below are the vocabulary authors may use):
  - highway: `bus`, `crossroadsW`, `crossroadsE`, `gasStation`, `overpass`, `westEnd`, `eastEnd`, `motel`, `diner`
  - truckstop: `diner`, `pumps`, `truckLot`, `motelRow`, `roadNorth`, `roadSouth`, `trailerA`, `trailerB`, `trailerC`
  - bridge: `apc`, `bankW`, `bankE`, `deckMid`, `cargoA`, `cargoB`, `cargoC`
  - checkpoint: `tower`, `gate`, `compound`, `genA`, `genB`, `genC`, `hill`
  - harlan: the ten POI names in camelCase (`mainStreet`, `gasNGo`, `haskellFarm`, `stJudes`, `fieldHospital`, `i70Interchange`, `millerQuarry`, `radioHill`, `shadyPines`, `lakeMarina`) + campaign: `ridgeHill`, `breakout`, `towerDoor`, `roof`, `zipStart`, `landing`
* `map.interactables = [{ id, kind, x, y, r, label, hold }]` — generic press-E spots. `hold` =
  seconds of holding E (0 = tap). Sim emits `{type:'interact', pid, id, kind}` on completion
  and tracks hold progress (snapshot). Owner: S2. Hideout stations and mission terminals use it. A hub map that lists
  only `map.hub.stations` gets a tap-only spot per station (`{id, kind, x, y, r}`); mission devices (`activate` steps)
  are created by the director at their anchor.
* `map.hub = { id, name, stations:[{ id, kind:'board'|'workbench'|'armory'|'infirmary'|'upgrades'|'bed'|'range'|'campfire', x, y, r }], npcs:[{ id, role, x, y, angle }], upgradeSlots:{...} }` — owner: S3.
* Hub maps are ordinary map objects built by `buildMap('roadhouse'|'depot'|'farmstead')` with
  `kind:'hideout'`, not listed in the normal lobby map list, size ≈ 2200×1600, a safe boundary,
  day/night per world time, no spawn zones.

### 5.3 NPCs (owner: S2)
`snapshot.npcs = [{ id, key, name, look, x, y, z, angle, state, hp }]` (`key` = cast id, `hp` 0..1, -1 = invulnerable;
`look = { cls, skin, hair, hairStyle, outfit:[1..3 hex], accessory, scale }`, the vocabularies are `NPC_ACCESSORIES` and
`NPC_HAIR_STYLES` in story-defs.js; the people themselves are `shared/story/cast.js`). States: `idle`, `talk`,
`walk` (follow a route), `follow` (follows the players), `escort` (walks its route when players
are near), `down`. Rendered in 3D and top-down with the survivor character kit (each has a
distinct outfit), a name tag and an "E — Talk" prompt within range. A hub's `hub.npcs[{id, x, y, angle, mode?}]` spawn as
NPCs whose `id` is the cast key (name and look from `shared/story/cast.js`; `settings.story.npcs` entries with the same id
override them); a mission's `npcs` and an `escort` step's `npc` do the same. Talking emits
`{type:'talk', pid, npc}`; the UI (S1) shows dialogue from story data.

### 5.4 Mission script format (data, owner S4 writes, S2 executes; see `shared/story/missions.js`)
```js
{ id:'m1_1', chapter:1, index:1, title, blurb, map:'highway', time:'night'|'day',
  mode:'defend'|'zone'|'campaign'|'free', level:[1,3], party:{min:1,max:6},
  briefing:[{ who:'mara', text }...],            // dialogue scene before the mission
  steps:[ { id, type, text /*HUD line*/, ...params, onStart:[radio|say...], onDone:[...] } ... ],
  rewards:{ xp, scrap, weapon?:id, upgradePoints?, flags?:{k:true}, unlockNpc?:id },
  debrief:[{ who, text }...], stars:{ time:secs, noDowns:true, optional?:'collectAll' } }
```
Step types (all implemented in `shared/sim/story-steps.js`; `shared/story/validate.js` checks every field):
`defend` {target:anchor (the map's objective), waves | seconds, scale, boss, gap, heal} · `waves` {count, scale, boss, gap}
(plain waves, no objective) · `survive` {seconds} · `collect` {item, count, at:[anchors], scatter, note} ·
`reach` {at, hold?, radius?, who?:'all'|'any'} · `activate` {at:[anchors|ids], hold, kind?, label?, effect?:'lure'|'explode',
lure:{to,seconds}, blast:{at,r,damage}} · `escort` {npc, route:[anchors], hp?, fail?, invulnerable?} ·
`kill` {zombie (alias `enemy`; the step's own `type` is 'kill'), count (written for a party of four), at?} ·
`boss` {zombie, count?, at?} · `evac` {stops:[anchors]} (zone missions) · `campaignStage` {stage, waves?} (hill / breakout /
tower / roof / zip; campaign missions) · `wait` {seconds} · `dialogue` {lines, npc?, talk?}.
Every `radio`/`say` line is `{ type?, who, text, ms? }` shown as subtitles (`radio` adds static). Mission fields beyond the
example: `startAt`, `npcs:[{id, at, mode}]`, `bonus:[steps]` (optional steps live from the start or from the step named by
`since`; never block), `requires`, `hub`, `after`, `notes` (S4's graph), `tier`, `respawn`, `timeLimit`, `waveScale`.
Step fields: `parallel` (runs beside the next step, cancelled when it ends unless `required`), `optional`, `flags:{k:true}`
(set when done), `follow` / `unfollow` / `remove` / `npcs` (NPC housekeeping), `timeout`, `pressure`.
**Pressure** (`pressure:{ waves, pace, specials }`, or `false`) is how zombies come during steps without waves of their
own: `waves` is the virtual wave number (hp, speed, type mix), `pace` the tempo relative to a wave's, `specials` types
forced into the mix; on `defend`/`waves` it is the first wave's number, on `evac`/`campaignStage` it sets the game's own
difficulty for the step. **Stars:** 1 for the win, +1 for `stars.time`, +1 for `noDowns` (and, with `optional:'collectAll'`,
every optional and bonus step). Anything an author needs that is missing: note it in a `todo` field and in the report.

### 5.5 Session/UI events (owner S1)
The host session emits to the UI: `story` state changes (`hub`, `briefing`, `mission`,
`debrief`), `profile` updates to save, `world` updates to store, `dialogue` scenes. Clients
persist `profile` and `world` copies when told to. Station panels are UI overlays opened by
the sim's `interact` events; all persistent changes (upgrades, loadout, stash) are handled by
the story layer (`shared/story/*`, pure functions, unit-tested) and applied by the host.

## 6. Ownership (avoid stepping on each other)

* **S1 — engine/persistence/UI:** `shared/story/{profile,world,progression,perks,upgrades,rewards,save}.js`,
  `net/*` story handshake/results/sync, `ui/story*.js` (story screen, lobby, briefing/debrief,
  dialogue player, station panels, perk tree, save/load/export), `index.html`/css additions,
  `tests/story-*.test.js`, e2e scenario `l`. Bumps PROTOCOL_VERSION to 9 if control messages change.
* **S2 — mission director/sim entities:** `shared/sim/story.js`, `shared/sim/npcs.js`,
  interactables/hold, objective entities & HUD tracker (`ui/storyhud.js`), radio subtitles,
  bots' behaviour in story, map anchors (`maps*.js` additive), NPC/interactable snapshot fields
  and rendering (`render3d/npcs3d.js`, `render/npcs2d.js`), `tests/story-sim.test.js`,
  e2e scenario `m`. Bumps PROTOCOL_VERSION to 10.
* **S3 — hideouts:** three hub maps (`shared/maps-hideouts.js`), 3D/2D world content for
  them (`render3d/world-hideout*.js`) including visible upgrade tiers, lighting/ambience,
  stations' 3D props, shooting-range targets, tests. Consumes S2's interactables/NPC API.
* **S4 — narrative content:** `shared/story/missions.js` (the missions and side jobs), `shared/story/cast.js`
  (characters), `shared/story/dialogue.js` (hideout conversations per chapter, idle banter,
  lore notes, radio chatter), title/credits text. Pure data + a validator test
  (`tests/story-data.test.js`: schema, anchors exist, ids unique, rewards sane).
* **V1 — cinematic tier, 4K, display:** see the brief; owns post/renderer/lights/tier tables.
* **V2 — asset quality:** characters, guns, vehicles, buildings, props; owns actor-*, viewmodel,
  world-veh/bld/props/dress/flora files.

Merge order will be S1 → S2 → S3 → S4 → V1 → V2 by the coordinator, who reconciles
`PROTOCOL_VERSION`, `index.html`, `SPEC.md`, `README.md` and e2e scenario letters.

## S1 seams

What S1 built and where it meets the other parts. Implemented and tested (`tests/story-*.test.js`,
e2e scenario `l`); merged on top of S2's mission director and S4's data. The only stand-in left is the
hideout map: until S3's hub maps exist, `buildStoryMap()` builds a stub hub on the truck stop.

### Pure layer (`shared/story/*`)

`profile.js` (Profile + sanitisers + join caps), `world.js` (World, `day`, revisions, mission board),
`progression.js` (XP curve exactly `round(90·(L−1)^1.7)`, cap 20, 1 perk point per level), `perks.js`
(12 perks × 3 ranks), `upgrades.js` (weapon tiers 0–5, supplies, hideout upgrades × 3 tiers),
`mods.js` (Profile → `StorySpec` → `StoryMods`, the numbers the sim uses), `rewards.js`
(`settleMission`), `actions.js` (station actions as pure functions), `graph.js` (unlock graph),
`content.js` (the content registry), `save.js` (localStorage, export/import, migrations).
Extra Profile fields: `kit` (supplies carried), `perkReset` (chapter of the last free reset).
Extra World fields: `day` (starts at 41, +1 per won mission and per night at the bed),
`hideout.current`, `hideout.stash` (`scrap`, `parts` and the supply ids).

### 1. Content wiring: one file, two lines

Nothing imports S4's data directly; `shared/story/content.js` is a registry filled once by
**`ui/story-content.js`**, which installs the written campaign:

```js
import * as story from '../shared/story/index.js';
setStoryContent({ story });
```

`shared/story/stub-content.js` (five small missions with a `stub` field) is only for unit tests and
tools (`setStoryContent(STUB_CONTENT)`). `tests/story-real-content.test.js` fails if the written
campaign is in the tree but `ui/story-content.js` does not install it; it also walks the whole
campaign through `graph.js` / `rewards.js` and compares `nextNodes` with S4's own.
What S1 reads from S4: `MISSIONS` (`requires`, `hub`, `after`, `rewards {xp, scrap, weapon,
upgradePoints, flags, unlockNpc}`, `briefing`, `debrief`, `stars`), `CHAPTERS` (`arrival {hideout,
flag, scene}`, `epilogue`), `CAST` (name, role, `look.cls`, `portrait.accent/pose`, `voice`,
`radioOnly`, `system`), `DIALOGUE` (`talk`, `stages`, `idle`, `pep`, `retry`, `stations`),
`EPILOGUE`, `EPILOGUE_FLAG`, `nextNodes`, `conversation`, `stageFor`, `conditionMet`, `expandTokens`.
UI behaviour: lines whose `when` fails are skipped, `{day} {crew} {scrap}` are expanded, an arrival
scene / the epilogue plays when the hideout stage starts and the viewer sets `seen_arrival_<hideout>` /
`seen_epilogue` when it ends, hideout talk = greeting + topic menu (`conversation()`; a topic's
`setFlags` become world flags, `once` topics vanish for the visit), the briefing plays `briefing`
then the mission's `PEP` line, a lost mission shows a `RETRY` quip, road missions (`hub: null`)
chain briefing → mission → debrief → next briefing with no hideout in between (`story.direct`).

### 2. Games of a story stage (S2's settings, S1's session)

The host launches every stage as `new Game` with S2's settings (§5.1, SPEC §3.9):

```js
settings: { mode:'hideout'|'mission', difficulty, waves:0, time,
  story:{ nodeId /* missionId | 'hideout:<id>' */, simMode, title, difficulty,
          party:[{ pid }], worldId, flags, hideoutUpgrades, npcs:[], absent:[cast ids not with the crew yet] } }
players: [{ id, name, color, cls, bot, story: <StorySpec> }]
```
* The **session settings** (what the lobby and the `start` message call `settings`) carry `mode:'hideout'|'mission'`
  and a light `story` block `{ nodeId, difficulty, simMode?, title? }`, so every client builds the same map
  (`mapBuildOptions(settings)`) and the story HUD. The full block (party, flags, upgrades) stays on the host.
* `createStoryGame(opts)` (`shared/sim/story-shim.js`) is `new Game({ ...opts, map })` with the map from
  **`buildStoryMap(id, seed, opts)`** (`shared/story/stub-hub.js`): `buildMap()` first, and only when the id is
  `roadhouse` / `depot` / `farmstead` and unknown does it build the stub hub (truck stop + five stations as
  `interactables`). **When S3's maps exist they win by themselves** (host and clients both call `buildStoryMap`).
* **`applyProfileToPlayer(game, p, spec)`** (`shared/sim/profile-mods.js`) runs in `createPlayer` when `info.story`
  is set (also for a late joiner). It sets `p.story` (StoryMods), adds to `p.perks` (`maxHp`, `startArmor`,
  `speedMult`, `staminaMult`, `reviveSpeed`, `healAura`, `cashMult`, `explosiveMult` and the optional `explosiveRadius`,
  `bleedoutMult`, `dropMult`, `crateMult`, `reviveDelayMult`, `reviveHpBonus`, read as 1/0 when absent) and fills the
  slots from the loadout. **Anything that shoots, reloads or buys ammo for a player must use `weaponOf(p, id)`**.
  S2's own `party[]` hook (`perks` / `armor` / `loadout` per pid) is not used: the profile reaches the sim through
  the players' specs, which the client derives the same way for prediction.
* `settings.story.absent`: S2's director skips these cast ids when it places `map.hub.npcs` (S1 fills it from
  S4's `npcAvailable(id, world)`, so the Roadhouse shows only the people who have joined).
* Bots get a profile scaled to the party level (`botStoryProfile`) and a spec like anybody else.
* A road mission's briefing (no hideout in between) is a frozen mission game (`_holdGame`); Deploy builds a
  fresh one, so the director starts only when the crew goes.

### 3. Events S1 consumes from the sim

* `storyend` (§5.1): result, stars (the director's), `stats[pid]` (`kills`, `downs`, `revives` feed the XP), `time`,
  `flags` (merged into the world by `rewards.settleMission`). Stats are clamped host-side; a fixture game that
  emits classic `victory` / `gameover` instead gets a synthesised `storyend` (tests only).
* `interact {pid, id, kind}`: `board` / `radio`, `workbench`, `armory` / `stash`, `infirmary`, `upgrades` open that
  station's panel for that player only; `bed` sleeps (heals anybody, the host also moves the day on); `range`,
  `campfire` and mission devices (`use`, `terminal`, `generator` ...) are ignored (`ui/story.js` `STATION_PANELS`).
  Panels open only in the hideout stage.
* `talk {pid, npc}`: the conversation with that cast id (greeting + topics). The station panels show whoever tends
  the station in this world (`cast.station` + `npcAvailable`).
* The "E — station" prompt and hold rings are S2's HUD (`ui/storyhud.js`); S1 draws none.

### 4. Session and protocol (PROTOCOL_VERSION = 10)

A story room is a normal room with `session.story` (host: `StoryHost`, client: `StoryClient`, both `StoryView`; see
the header of `net/story-view.js`). PROTOCOL 9 (S1) added the story control messages, S2's binary changes made it 10;
S1 adds no binary layout. Control messages (all `ctl`, JSON):
`hello.story {profile, worldId, worldRev}` · `welcome.story {world, profile, state, pid, debrief?}` ·
`start.story {stage, mission, party, ready, hideout, chapter, direct, specs:{[pid]:StorySpec}, map, arrival?, epilogue?}` ·
`world {world}` · `sprofile {profile}` · `sstate {...}` · `sdebrief {debrief}` · `sres {a, ok, reason?, note?}` ·
`swant {id}` (the host asks for a newer world copy) · client `sact {a, ...}`.
Station actions (`loadout, tier, buygun, perk, reset, hideout, donate, kit, buykit, talk, flag, diff, rename, heal, bed`)
and crew actions (`pick, unpick, ready, deploy, back, retry, sync`) are all validated on the host; a client `flag` may
only set `talked_*`, `seen_*` or a flag a dialogue topic declares. The host accepts a joiner's Profile through
`acceptJoinProfile` (level <= 20, XP/scrap/perk points consistent with the level, tiers <= 5, known guns) and answers
with the accepted one. The host session builds each stage's game through `HostSession._launchGame()` and freezes a
finished mission behind its result with `_holdGame()`; stages chain hideout -> briefing -> mission -> debrief -> hideout
without the lobby, late joiners enter the running stage, and when the host leaves clients keep their World copy and
Profile. `ClientSession` builds the map from `mapBuildOptions(settings)` (or `buildStoryMap` in a story room).

### 5. UI files, flags and hooks

`ui/story.js` (controller, created by `ui/app.js`), `story-screen.js`, `story-lobby.js`, `story-dialogue.js`,
`story-panels.js`, `story-flow.js` (briefing and debrief), `story-kit.js`, `story-voice.js`, `css/story.css`
(inlined by `scripts/build-standalone.js`). `ui/match.js` calls `ctx.story.matchBegin/matchEvents/matchFrame/
matchEnd`, disables the cash shop and the ready vote in the hideout (`storyHub()`), routes Esc/pad edges to
open story overlays and never shows the classic end screen for a story stage. `dom.js`'s `h()` now accepts
an id (`'div.a#id'`). Speech is off by default (Settings → Spoken story dialogue, `speech` in the prefs;
per-character pitch/rate from the cast `voice`). Debug: `window.__HH_STORY` (`open(kind)`, `close()`,
`skipScene()`, `stage`, `panel`, `session`); e2e `l` uses it.
World flags S1 sets itself: `seen_intro`, `seen_arrival_<hideout>`, `seen_epilogue`, `talked_<npc>`.
`rewards.flags` from a mission are copied to the world (`^[a-z][A-Za-z0-9_.:-]{0,39}$`, at most `MAX_FLAGS`).
