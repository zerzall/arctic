# ROAD TO HAVEN — story co-op design contract

This document is the contract between the people (agents) building the story mode in parallel. Read
`SPEC.md` first for the engine (host-authoritative deterministic 2D sim, 60 Hz, prediction on
clients, binary snapshots, PeerJS/relay/local transports, FPS + top-down renderers). Story mode
is built ON TOP of that engine: existing modes (Defend / Evac Run / Campaign) keep working
exactly as before.

## 1. What the player gets

Friends (1–6, online or solo with AI survivors) play a **persistent story campaign**: fifteen
missions in six chapters across the game's maps, connected by **hideouts** — safe, walkable hub
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

| Ch | Title | Map (mode) | Missions | Hideout after |
|----|-------|-----------|----------|---------------|
| 1 | Dead Highway | highway (night) | 1.1 Pileup (defend the bus) · 1.2 Fuel Run (collect) · 1.3 Beacon (hold the overpass) | **The Roadhouse** (motel) |
| 2 | Last Chance | truckstop | 2.1 Diner Siege · 2.2 Radio Parts (collect from trucks) · 2.3 Night Hauler (escort) | (Roadhouse) |
| 3 | Blackwater | bridge | 3.1 The Crossing (repair the APC while defending) · 3.2 Sunken Cargo (collect) | **Blackwater Depot** (rail depot) |
| 4 | Delta | checkpoint | 4.1 Hold the Tower · 4.2 Broken Line (activate 3 generators) · 4.3 Ghosts (survive + kill the Brute pack) | (Depot) |
| 5 | Harlan County | harlan (Evac Run) | 5.1 Down the Interstate (zone run) · 5.2 Field Hospital (collect + defend) | **Harlan Farmstead** |
| 6 | Haven | harlan (Campaign) | 6.1 Last Stand (hill) · 6.2 The Tower (ascent, roof, zip line) | — (epilogue) |

Fifteen missions. Difficulty ramps with chapter; recommended player levels are in the mission
data (level 1 → ~14 by the end; cap 20 for replays and "Heroic" difficulty).

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
  members:{[profileId]:{ name, lastSeen }} }
```
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
`nodeId` is a mission id (the written fifteen are always known: `shared/story/registry.js`); `mission` is the script itself
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
* **S4 — narrative content:** `shared/story/missions.js` (15 missions), `shared/story/cast.js`
  (characters), `shared/story/dialogue.js` (hideout conversations per chapter, idle banter,
  lore notes, radio chatter), title/credits text. Pure data + a validator test
  (`tests/story-data.test.js`: schema, anchors exist, ids unique, rewards sane).
* **V1 — cinematic tier, 4K, display:** see the brief; owns post/renderer/lights/tier tables.
* **V2 — asset quality:** characters, guns, vehicles, buildings, props; owns actor-*, viewmodel,
  world-veh/bld/props/dress/flora files.

Merge order will be S1 → S2 → S3 → S4 → V1 → V2 by the coordinator, who reconciles
`PROTOCOL_VERSION`, `index.html`, `SPEC.md`, `README.md` and e2e scenario letters.
