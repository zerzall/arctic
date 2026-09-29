# Highway Horde — architecture & contracts

First-person co-op zombie shooter for 1–6 players in the browser. One player hosts, friends
join with a 5-letter room code or an invite link. The host's browser runs the
authoritative simulation (2D, on a flat ground plane); everyone else sends inputs and
renders snapshots. The default view is first person in 3D (§7.5); the original top-down
view (§7.1) is a settings option and the fallback without WebGL 2.

This document is the contract between modules. **If you own a module, implement exactly
the API described here; if you consume one, rely only on what is written here.** Consumers
must ignore unknown fields/events gracefully.

---------------------------------------------------------------------------------------

## 0. Ground rules

- Plain ES modules, **no build step, no frameworks, no TypeScript**. The browser loads
  `public/index.html` → `public/js/ui/main.js` directly. Node 22 runs `shared/` for tests.
- `public/js/shared/**` must not touch `window`, `document`, `performance` or any DOM API
  (it runs in Node tests). Use only JS built-ins. No `Math.random()` inside the
  simulation — use `createRng()` from `shared/rng.js` so a seeded game is reproducible.
- 2-space indent, semicolons, single quotes, `const`/`let`, JSDoc on exported functions.
  Match the style of the files that already exist in `shared/`.
- Runtime dependencies in the browser, both vendored: `public/vendor/peerjs.min.js` (sets
  `window.Peer`) and three.js r186 under `public/vendor/three/` (imported only by
  `render3d/`, §7.5). Only server dependency: `ws`. Dev dependencies: `playwright`, `peer`.
- Tests: `node --test` files named `tests/<area>.test.js`, using `node:test` and
  `node:assert/strict`. **Unit tests must only import Node built-ins and project files**
  (the repo root CI runs `node --test` without installing this folder's dependencies).
  A test that needs `ws` must `await import('ws')` inside a try/catch and
  `test.skip` when it is missing.
- Units: world pixels, seconds, radians. Angle 0 points along +x, +PI/2 along +y
  (screen down). Positions are entity **centres**.
- Performance budget: host at 60 fps with 250 live zombies, 6 players, on a mid laptop.
  No per-frame allocation storms in hot loops (reuse arrays; avoid closures per zombie).

## 1. File ownership

```
highway-horde/
  package.json, README.md, SPEC.md, netlify.toml     (lead)
  server/relay-server.js                             (net)
  scripts/e2e.js                                     (integration)
  scripts/balance.js, docs/BALANCE.md                (balance — headless harness + tuning notes)
  public/index.html, public/css/game.css             (ui)
  public/config.js                                   (net — optional overrides, see §8)
  public/vendor/peerjs.min.js                        (vendored, do not edit)
  public/js/shared/constants.js math.js rng.js       (lead — read only)
  public/js/shared/weapons.js zombies.js classes.js items.js  (lead — data, read only)
  public/js/shared/maps.js                           (maps)
  public/js/shared/maps-campaign.js terrain.js campaign.js  (campaign — §2, §3.8; sim/campaign.js is its director)
  public/js/shared/geom.js spatial.js flowfield.js movement.js sim.js  (sim)
  public/js/shared/sim/bots.js                       (bots — AI survivors, §3.6)
  public/js/shared/protocol.js                       (net)
  public/js/net/*.js                                 (net)
  public/js/render/*.js                              (render)
  public/js/render3d/*.js                            (render3d — first-person view, §7.5)
  public/dev/*                                       (sandboxes, incl. fps-sandbox, actors3d-sandbox)
  public/vendor/three/                               (vendored three.js r186, do not edit)
  public/js/audio/*.js                               (audio)
  public/js/ui/*.js  (main.js, input.js, hud.js, menus, shop, chat, touch,
                     look.js, compass.js, minimap.js, ...) (ui)
  tests/<area>.test.js                               (each owner)
```

Data tables already written (read them — they are the source of truth):
`constants.js` (all tuning numbers), `weapons.js` (27 guns + throwables), `zombies.js`
(8 zombie types, `ZFLAG` bits), `classes.js` (6 survivor classes + perks), `items.js`
(shop items, pickups, drop tables).

---------------------------------------------------------------------------------------

## 2. Maps — `shared/maps.js`

```js
export const MAP_LIST;              // [{ id, name, description, modes?, time?, times? }] in lobby order;
                                    // modes: the game modes it plays (absent = every mode);
                                    // time: 'day' = a fixed time of day, times: [...] = a list of
                                    // them (absent = night and day, §7.5.1)
export function buildMap(id, seed, opts?); // → MapDef, deterministic for (id, seed[, opts]); unknown id → throws
                                    // opts.mode 'campaign' builds the campaign variant of a map that has one
```

Five maps (ids fixed): `highway` (Highway 9 Pileup), `truckstop` (Last Chance Truck Stop),
`bridge` (Blackwater Bridge), `checkpoint` (Checkpoint Delta) and `harlan` (Harlan County,
`modes: ['zone', 'campaign']`: the Evac Run map, §3.7, built in `shared/maps-harlan.js`).
`highway`, `checkpoint` and `harlan` have a **campaign extension** (§3.8, `modes` lists
`'campaign'`); `buildMap(id, seed, { mode: 'campaign' })` lays the map out as usual and then
adds the hill, the tower and its annex (`shared/maps-campaign.js`) on top: the default build
(no `opts`, or another mode) is exactly what it always was.

```js
MapDef = {
  id, name, width, height,               // world size, 2400..8000 x 1600..3000
  seed,
  ambient: { darkness: 0..1, tint: '#rrggbb' },  // night lighting mood for the renderer
  ground: '#rrggbb',                     // base fill under everything
  areas: [ { kind, x, y, w, h, a } ],    // painted in order. kind: 'asphalt'|'concrete'|'grass'
                                         // |'dirt'|'gravel'|'sand'|'water'. (x,y) = centre, a = angle.
                                         // 'water' is impassable for players and zombies (not for shots).
  lines: [ { kind, x1, y1, x2, y2, w } ],// road paint. kind: 'white'|'white_dashed'|'yellow'
                                         // |'yellow_double'|'crosswalk'|'parking'|'stop'
  obstacles: [ Obstacle ],               // static collision (see below)
  decor: [ { kind, x, y, a, s } ],       // no collision. kind: 'tree_canopy'|'bush'|'grass_tuft'
                                         // |'rock'|'cone'|'debris'|'tire'|'crack'|'oil'|'blood_old'
                                         // |'paper'|'skid'|'manhole'|'lamp_post'|'sign'|'flag'|'rubble'
                                         // |'signal'|'pylon'
                                         // s = scale (1 = normal). 'signal' = traffic signal pole whose
                                         // mast arm reaches 150·s px along a, heads facing a − π/2;
                                         // 'pylon' = roadside price sign on two posts
  lights: [ { x, y, r, color, flicker, h? } ],// static light sources (street lamps, burning wrecks);
                                         // flicker = 0..1 amplitude (0 = steady). A lit 'lamp_post'
                                         // decor has a light at exactly the same x, y. h (optional) =
                                         // height of a fixture that is neither (e.g. under an overpass)
  fires: [ { x, y, r } ],                // permanent burning spots (cosmetic flames + light; no damage)
  playerSpawns: [ {x, y} ],              // >= 6 clear points near the objective
  zombieSpawns: [ { x, y, w, h, weight? } ],// rectangles near the map edges where zombies appear
                                         // (x, y = centre, like every other rect in the MapDef);
                                         // weight (all of a map's rects or none): pick odds (§3.4)
  objective: { kind, name, x, y, w, h, a, hp },  // thing the team defends; also a collider
                                         // kind: 'bus'|'diner'|'apc'|'radio'
  supply: { x, y },                      // supply station (ammo crates + shop mid-wave)
  pois: [ { name, x, y, r } ],           // points of interest: the Evac Run's safe-zone centres and
                                         // radii (§3.7), fixed layout; every map has ≥ 5
  modes?: ['zone'],                      // only on maps that don't play every mode (copied from MAP_LIST)
  time?: 'day', times?: ['day'],         // maps that fix the time of day (copied from MAP_LIST; §7.5.1);
                                         // campaign variants are daytime maps (`time: 'day'`)
  terrain?: { hills: [...], plateaus: [...] },  // campaign variants: the height field (below)
  campaign?: CampaignExt,                // campaign variants only (below)
  overpass: null | {                     // elevated roads (visual; the sim sees only their piers
                                         // and ramp walls, which are ordinary obstacles)
    decks: [ { kind, w, pts: [[x, y, z], ...] } ], // kind 'viaduct'|'ramp'; road surface at height z
                                         // along the polyline, w wide; may run past the map bounds
    bents: [ { x, y, a, span, z } ],     // pier bents: two columns span apart along a, cap beam
    vehicles: [ { kind, x, y, a, w, h, color, wrecked, pitch, roll } ],  // wrecks up on a deck
    signs: [ { x, y, a, w } ],           // fascia signs on a deck edge, facing a
  },
}

Obstacle = {
  id,                                    // index in obstacles array
  kind,                                  // 'car'|'suv'|'pickup'|'van'|'truck'|'semi'|'bus'|'tanker'
                                         // |'barrier'|'sandbags'|'building'|'wall'|'container'
                                         // |'pump'|'tree'|'rock'|'hesco'|'tent'|'booth'|'guardrail'|'pillar'
                                         // |'pier'|'ramp'|'silo'|'grave'
  x, y, w, h, a,                         // oriented rectangle: centre, full width/height, angle
  color,                                 // body colour (vehicles/buildings)
  solid,                                 // true = blocks bullets/beams/projectiles; false = low cover
  wrecked,                               // vehicles: burnt-out look
  roof,                                  // buildings: roof colour
  top,                                   // 'pier'/'ramp': height of the piece (units); 'building':
                                         // optional explicit height (the church tower)
}
```

**Terrain** (campaign variants; `shared/terrain.js`, arithmetic only, so it is bit-identical
in the sim, the client prediction and every renderer): `hills: [{ x, y, r, plateau, h,
flank? }]` (flat `h` inside `plateau`, then a smootherstep down to 0 at `r`; `flank` marks a
hill whose slope slows and exposes zombies, §3.8) and `plateaus: [{ x0, y0, x1, y1, h, edge }]`
(a flat raised rectangle with an `edge`-wide steep skirt; the annex floors). `terrainOf(map)`
→ `{ flat, height(x, y), q(x, y), flank(x, y), maxHeight }` (cached per map);
`terrainHeight(map, x, y)`; the height of the highest piece wins. Ground under obstacles is the
terrain: an obstacle's top is `terrain(centre) + height` (`geom.js` colliders carry `baseQ`).
A standing body follows the terrain (snap ≤ `TERRAIN_SNAP_Q`), a zombie snaps by ≤ 12 units.

**CampaignExt** (`map.campaign`, all deterministic for (map id, seed)): `hill { x, y, r,
plateau, h, gate, spawns[] }` (the team's start on the plateau), `route [[x, y], ...]` +
`routeLen` (hill → tower door), `entrance { x, y, r }` (the door's circle), `tower { x, y, a, w,
h, top }`, `floors [{ id, name, n, x0, y0, x1, y1, base, ceil, arrive[], stairs { x, y, r },
spawns[] (zombie rects), supply { x, y }, doors[], skylight? }]` (lobby, offices, atrium: three
compact 1000 x 680 rooms on plateaus 0 / 100 / 200 units high, below the base map),
`roof { x0.., base 380, arrive[], supply, pad, zip { x, y, z, ix, iy, r }, spawns[] }`,
`landing { x0.., base 60, x, y, slots[], end { x, y, z } }` (the far end of the cable) and
`skyline[]` (the distant buildings). Sizes: Checkpoint Delta 4850 x 5860, Highway 9 Pileup
9500 x 5060, Harlan County 7200 x 10060 (the annex lies in the new ground below the old map);
315 / 470 / 747 obstacles. New obstacle kinds (`CAMPAIGN_KINDS`, heights in `CAMPAIGN_HEIGHT`):
'palisade' (74), 'watchtower' (230), 'tower' (440), 'iwall' (132), 'desk' (30, low cover),
'cabinet' (92), 'counter' (40, low cover), 'ipillar' (132), 'stairs' (132), 'hvac' (56),
'parapet' (44), 'rim' (an invisible edge), 'mast' (300).

Kind conventions used by maps.js (renderers rely on them): 'semi' is both the cab
(length ≤ 100) and the trailer (240 long) of a rig; 'tanker' is the tank body with a
'semi' cab; 'bus' is also used for RVs (draw with the obstacle colour, not always school-bus
yellow); 'container' also covers dumpsters, a propane cage and a generator; 'wall' with
h ≤ 8 is a thin fence (solid:false), thicker is masonry; 'pillar' = canopy posts ('pier' =
an overpass column up to its pier cap, `top` high; 'ramp' = a piece of ramp embankment, +x
climbing toward the deck, solid:false while it is below the eye); 'tree' is
the trunk with a 'tree_canopy' decor centred on it; 'silo' is a round grain silo (the smaller
side is its diameter, 300 high, solid); 'grave' a headstone (30 high, solid:false, low cover
heavies can't trample). Crosswalk lines run across the road
and `w` is the stripe length. `roof` is null for kinds without a roof. Water areas are
axis-aligned. Map sizes are within 2400..4000 x 1600..3000 (checkpoint is 3000 x 3000),
except the long highway (7600 x 2200) and Harlan County (7200 x 7200). `OVERPASS` (maps.js) holds the deck structure depths:
a deck of height z has slab + girders down to z − depth (36) and pier caps down to
z − depth − cap (62); a ramp embankment blocks walking from `walk` (8) units of rise and
shots from `low` (44). Walkable ground under a deck keeps ≥ 130 units of headroom.

Rules: every `playerSpawn` and the `supply` point must be reachable from every
`zombieSpawn` for a 28 px-diameter walker; nothing spawns inside an obstacle or water;
the objective sits roughly central with open ground around it; 60–160 obstacles per map
(the long highway: up to 300, Harlan County: up to 900). Zombie spawn rects hug the map edges
or sit at the foot of an overpass ramp. Evac Run maps (`modes: ['zone']`) skip the
defend-layout rules (central objective, supply 250–450 px from it); Harlan County's radio mast
is its objective collider and landmark, the team starts on Main Street next to the supply
station, and every POI is reachable from every other.
Guard rails, barriers and sandbags are `solid: false` (shots pass over them).

---------------------------------------------------------------------------------------

## 3. Simulation — `shared/sim.js` (+ geom, spatial, flowfield, movement)

### 3.1 API

```js
import { Game } from './sim.js';
const game = new Game({
  mapId, seed,                            // map built internally with buildMap(mapId, seed)
  settings: { difficulty, waves, objective, friendlyFire, mode, time },   // see DEFAULT_SETTINGS;
                                          // mode 'defend' (default) | 'zone' (§3.7);
                                          // time 'night' (default) | 'day' (§7.5.1; cosmetic: the
                                          // sim ignores it but `game.settings.time` is the resolved one)
  players: [ { id, name, color, cls, bot } ],  // id: 1..255 (host = 1), color: 0..5, cls: CLASS_IDS
                                          // bot: true = AI survivor (§3.6), optional;
                                          // botSkill: 0..1 (default 1) how well it plays
});
game.map                  // MapDef
game.tick                 // ticks simulated so far
game.addPlayer({ id, name, color, cls, bot })   // late join: mid-wave enters 'dead' and respawns at the
                          //   wave clear; during prep/intermission enters alive. A name that
                          //   left earlier gets its cash, stats and kit back (+ clear bonuses
                          //   paid meanwhile); a new name gets wave × WAVE_CLEAR_BONUS
                          //   catch-up cash (at most MAX_PLAYERS human newcomers per match;
                          //   bots always).
game.removePlayer(id)     // the leaver's turrets/barricades leave too (owned units on rejoin)
game.setInput(id, cmd)    // queue one InputCmd (§3.3). Host calls this for every received cmd.
game.command(id, cmd)     // reliable one-off requests: { type: 'buy', item } | { type: 'ready' }
game.step()               // advance exactly one tick (DT = 1/60 s)
game.snapshot()           // → Snapshot (§4). Returns ALL events emitted since the previous
                          //   snapshot() call and clears them.
game.phase                // mirrors Snapshot.phase
```

`Game` must be fully deterministic given (constructor args, sequence of setInput/command
calls per tick). All randomness from a seeded rng.

### 3.2 Movement shared with client prediction — `shared/movement.js`

```js
export function createCollisionWorld(map);   // static colliders (obstacles, objective, water, bounds)
world.setBarricades(list)                    // [{x, y, a}] or [{x, y, angle}] dynamic walls (BARRICADE size)
export function stepPlayerMovement(p, cmd, dt, world);  // → 1 took off, -1 landed (or climb done), 2 climb started, 0
```
`p` needs `{ x, y, state, stamina, sprintLock, speedMult, moveMult }` (+ optional
`staminaMult`, class perk: drain ÷ it, regen × it, and the vertical state below) and is
mutated (x, y, stamina, sprintLock, sprinting, zq, vzq, jumpCd, climbT, climbTo, z).
`speedMult` comes from the class perk, `moveMult` from the held weapon. Players collide with
static obstacles (solid or not), water, the objective, barricades and the map bounds —
**not** with zombies or other players (so client prediction can be exact) — except
obstacles their feet are above. Downed players move at DOWNED_SPEED and cannot sprint. The
host sim must use this very function for player movement.

**Vertical state** (`shared/jump.js`, numbers in constants.js). Heights are whole multiples
of `Z_UNIT` = JUMP_HEIGHT / (JUMP_TICKS / 2)² (≈ 0.148 units), so the state is five integers
that travel exactly in snapshots: `zq` feet height in Z_UNITs (`z = zq × Z_UNIT` world
units), `vzq` vertical speed in Z_UNITs per tick (0 = standing, on the ground or on top of
something; airborne it is always odd, so never 0), `jumpCd` landing-cooldown ticks, `climbT`
mantle ticks left and `climbTo` the collider being climbed (index into
`world.colliders`, the same list on host and clients; -1 when not climbing). Each tick
(`stepJump`, then the move): `zq += vzq; vzq -= 2`, landing on the highest standable top
under the centre that the feet were above on the previous tick (0 = the ground); a jump
from standing sets `vzq = JUMP_TICKS - 1 = 35`, which traces exactly the old fixed parabola
(after n ticks zq = n × (36 − n): JUMP_HEIGHT 48 at the apex, down after JUMP_TIME 0.6 s),
then JUMP_COOLDOWN (0.1 s, 6 ticks) before the next (holding the button hops again). A fall
starts at `vzq = -1` (n² Z_UNITs after n ticks), speed capped at -127. No double jump, full
air control, no fall damage; only 'alive' players take off (a player downed mid-air still
comes down; the dead are settled onto whatever is under them — a corpse stays on a roof).

**Tops.** Every map collider has `top` (world units, exactly `topQ × Z_UNIT`), `topQ` and
`stand` (geom.js `mapColliders`, from jump.js `standTop` / `jumpClearance`):
- standable (CLIMB_TOP, the rendered heights of render3d/world.js, a car a little under
  its roof line): barrier 26, sandbags 30, rock 16..30 (by size), car 40, suv 54, pickup
  52, van 70, hesco 70, container 62 (dumpster-sized) / 84 (shipping container), truck
  100, bus 100, tanker 110, semi 108 (cab) / 124 (trailer);
- pass-over only (JUMP_CLEAR, too thin to stand on): guardrail 22, chain-link fence (a
  'wall' ≤ 8 thick) 40;
- `Infinity` for everything else: buildings, real walls, trees, pumps, tents, booths,
  pillars, overpass piers and ramps, water, the objective, player barricades.

`world.resolveCircle(pos, r, mask, z)` / `moveCircle(pos, r, dx, dy, mask, z)` /
`circleBlockedAt(x, y, r, z)` skip static colliders with `top ≤ z`: the feet above an
obstacle pass over it, and on top of something it no longer blocks (a taller neighbour
still does; a lower one is simply walked onto). **Standing**: `world.groundQ(x, y, zq)` is
the highest standable `topQ ≤ zq` whose footprint (grown by STAND_PAD 10) contains the
centre; a standing player whose ground drops below its feet (walked off the edge) starts to
fall next tick. A landing (and every airborne tick) checks `circleBlockedAt`; a player
coming down inside something wedged against something else is moved by
`world.unstick(pos, r, z)` to the nearest free spot (rings every 4 px up to 96 px in 8 fixed
directions — exact constants, so every engine agrees). Knockback moves use the player's `z`.

**Terrain** (campaign variants, §2): the map's height field is an always-there floor: `world.terrainQ(x, y)`
= round(height / Z_UNIT) (`terrainH` in units, bit-identical in every engine). `groundQ` starts
from it (standables above it still win), a standing body follows it after every move (it is lifted onto a higher ground at once; a drop of at most
`TERRAIN_SNAP_Q` = 12 units onto the terrain itself is followed down; a bigger one, like walking off a
plateau's edge, is an ordinary fall), an obstacle's `topQ` is `toZq(clear) + baseQ` (`baseQ` =
the terrain under its centre; `MIN_Q` climbing tests use `topQ − baseQ`), and jump / climb / fall
work as on a roof. A `frozen` player (a zip-line ride, §3.8) skips `stepPlayerMovement`.

**Mantling.** After the move, an 'alive' player who is airborne or pressing `jump`, and
moving, climbs the nearest standable collider (`findLedge`) that the body touches (within
3 px) and the move input pushes into (within ~60° of straight in), whose top is higher
than MANTLE_MIN (32: low cover is vaulted or landed on, not climbed) and than the feet, by
at most MANTLE_REACH (40), with room for the body on top (`circleBlockedAt` at its top).
From the ground: a car right away, a van, hesco or shipping container from the top of a
jump (≤ 48 + 40 = 88); trucks, buses, trailers only from a perch next to them. The climb
takes MANTLE_TICKS (24, 0.4 s): the feet rise to the top by 8 ticks before the end, the
body moves over onto the spot `mantleSpot` (18 px in from the edge) in the last 12 — no
collisions, no walking or sprinting meanwhile — then it stands on top with the landing
cooldown. Bots never jump or climb.

Zombies collide with obstacles/water/objective/barricades/bounds, and are separated from
each other (soft push) and from players (they stop at attack distance; players are not
pushed by walkers — the brute charge and boss slam apply explicit knockback impulses to
players that the host applies after movement).

### 3.3 InputCmd

```js
InputCmd = {
  seq,              // uint32, increasing per player
  moveX, moveY,     // -1..1 (length ≤ 1)
  angle,            // aim angle, radians
  fire, melee, sprint, interact,   // held buttons (booleans)
  reload, frag, molotov, turret, barricade, lastWeapon,  // edge-triggered (true on one cmd only)
  slot,             // -1 = no change, 0..2 = switch to slot
  cycle,            // 0, +1 (next weapon), -1 (previous)
  jump,             // jump button held (or tapped since the last cmd); see §3.2
}
```
Host applies one cmd per player per tick. If a player's queue is empty it repeats the
last cmd **with edge fields cleared** (`jump` counts as one here: a repeat never jumps).
The queue holds at most 6: queuing a 7th drops the oldest (but keeps any edge flags,
`jump` included, by OR-ing them into the next cmd). A standing backlog
drains: when a player's queue held ≥ 2 cmds at every tick of a 20-tick window, one extra
cmd is dropped the same way (so a burst of late inputs doesn't add latency for good).

### 3.4 Gameplay rules the sim implements

**Phases.** `prep` (PREP_TIME s, shop open) → `wave` → `intermission` (INTERMISSION_TIME s,
shop open, skipped early when every connected player sent `{type:'ready'}`) → `wave` → …
After the last wave (settings.waves, 0 = endless) is cleared → `victory`. Everyone
dead/downed at once (no one standing) → `gameover` (reason 'wiped'), unless the wave is
cleared in that same tick (the clear wins: it revives the downed). Objective hp 0 while
settings.objective → `gameover` (reason 'objective'). The objective takes no damage and
isn't targeted when settings.objective is false. Game over/victory are terminal.

**Waves.** Zombie count for wave w (`waveZombieCount()` in constants.js, numbers in
`WAVE_ZOMBIES`): `round((base + perWave·w) * (1 + perPlayer * (players - 1)) * difficulty.count)`,
× `bossWave` on boss waves (the boss is the fight). Spawned in groups (`SPAWN_PACING`) at
the map's zombieSpawns, preferring spawn rectangles farther than 700 px from every living
player (picked uniformly, or by their `weight` when the map gives them one: the long highway
favours rects near the bus so a wave's first zombies arrive in good time and its far ends
send stragglers), never more than `difficulty.maxAlive` alive at once. Type picked by
`ZOMBIES[type].weight(w)`. 2% of non-boss spawns from wave 4 are ELITE (1.6x hp, +20% speed).
Every BOSS_EVERY-th wave also spawns `ceil(players / 3)` bosses about 10 s in; they share
the boss hp multiplier `hpBase + hpPerPlayer × players` and grow by their own `hpGrowth`
(players and bosses counted at the wave's start: joins/leaves before they spawn change neither).
HP scale: `hp * (1 + HP_GROWTH_PER_WAVE*(w-1)) * difficulty.hp`; speed scale capped at
SPEED_GROWTH_CAP; damage × difficulty.damage. `remaining` = alive + not yet spawned.
Wave clear → WAVE_CLEAR_BONUS cash to every connected player, dead players respawn
(RESPAWN_HP, pistol + their class weapon restored if they have no guns, cash kept) at a
playerSpawn, downed players are revived, and one weapon `crate` pickup drops near the
supply station.

**Zombie AI.** A flow field (grid NAV_CELL, 8-neighbour Dijkstra, rebuilt every
NAV_REBUILD_INTERVAL) toward all alive + downed players, living turrets, and (if enabled)
the objective. Obstacle cells impassable; barricade cells cost ×8 (zombies prefer to go
around but will smash through). A field's static walk graph (blocked cells, edges, wall
costs) depends only on the colliders and grid options and is shared by every later field
built for identical ones (the next game on the same map skips building it). Each zombie follows the field; within 200 px of its
current target (nearest of player/turret/objective with line of movement) it steers
directly at it. Separation via `spatial.js` grid so crowds spread instead of stacking.
In attack range it attacks at attackRate (damage to player: armour absorbs ARMOR_ABSORB
of it while armour lasts; to turrets/barricades/objective: raw). A zombie that bumps
into a barricade attacks the barricade. Specials: see comments in `zombies.js`
(bloater burst, spitter acid lob + pool, screamer buff, brute charge, boss slam).
Burning zombies take burn dps and run 15% faster.

**Survivors up on things.** A swipe (checked when it starts and when it lands) reaches a
player whose feet are at most `reach` above the zombie's own: CRAWLER_REACH_Z 14 for
crawlers (jumping over them works), HEAVY_REACH_Z 90 for brutes and the boss, else
ZOMBIE_REACH_Z 50 (anyone mid-jump, and a car roof). The horizontal reach to a standing
player is measured to the player or to the edge of what they stand on, whichever is nearer
(a walker at the bonnet grabs the legs of someone in the middle of the roof). A brute or
the boss hitting a player more than ZOMBIE_REACH_Z above it shoves them (HEAVY_SHOVE 420
px/s of knockback) off the perch. A player out of reach: the zombie's line of movement
ignores obstacles no taller than the player's feet, so it walks straight at the perch;
walkers, runners and screamers pressed against a standable collider (topped above their
feet, no higher than the player's) for `climb.delay` s (walker 1.4, runner 0.4, screamer
1.0; zombies.js) climb it in `climb.time` s (0.8 / 0.45 / 0.7) — the one the player stands
on, else the highest (a stepping stone). Crawlers, bloaters and spitters never climb
(spitter acid still reaches: its line of sight passes over whatever the target stands on).
Zombies have a height `z` (float, host only): they move and collide at it, stand on the
highest top under them and fall off edges with the players' gravity (no damage); a zombie
whose target is lower walks straight off. Zombies more than 30 apart in height don't
separate each other; more than 40 from a player's feet, they don't bump into them.

**Players.** Classes from `classes.js` set maxHp, start armour, weapons, perks.
Slots: 3 (`WEAPON_SLOTS`). Start: slot0 pistol, slot1 class weapon, slot2 empty, cash
START_CASH. Firing: while `fire` is held and cooldown elapsed and mag > 0 and not
reloading. Empty mag + fire → auto-reload (emit 'empty' once). `reload` edge starts a
reload (reload time × perks.reloadMult); switching weapons cancels a reload. Minigun
needs `spinup` seconds of holding fire first. Hitscan: `pellets` rays with random spread,
each ray stops at the first `solid` obstacle, damages up to `pierce` zombies along it
(sorted by distance), damage × falloff × perks.damageMult, knockback. **From up high**
(the 2D rule, the same on host and client prediction): a shooter's rays, rails, chains,
melee/saw line of sight and projectiles (`pr.above`, kept for the projectile's life) pass
over every obstacle no taller than the shooter's feet (`raycastSolid(…, above)`), so from a
roof the SUV next door no longer blocks; a zombie standing on the obstacle that stopped a
ray (its `z` ≥ that top, `roofReach()` in combat.js) is still hit — it is above the wall.
Bots and spitters see over whatever the higher of the two stands on. Friendly fire off
by default (on: 25% damage to players, never downed by it). `chain`/`rail`/`flame`/
`projectile` per weapons.js. Weapon extras (all in weapons.js, client prediction mirrors
the fire timing): `burst` fires that many rounds per trigger pull at `rate`, then waits
`burstDelay` (a burst finishes even if the trigger is let go; `effectiveRate()` gives the
average rate); `reloadOne` reloads one round per `reload` seconds and chains until full, and
a fresh trigger pull with a round loaded interrupts it; `penetrate: {walls, thick, loss}`
lets a hitscan round pass through up to `walls` obstacles no thicker than `thick` px along
the ray, losing `loss` of its damage at each (`traceRound()` in combat.js). Kind `cryo`
throws frost puffs like the flamethrower that add `chill` (0..1) instead of fire: a chilled
zombie moves and attacks up to `FROST.slow` slower, at 1 it freezes solid for
`FROST.freezeTime` s (no moving or attacking, takes ×`FROST.brittle` damage), then thaws
to `FROST.afterThaw` chill; bosses cap at `FROST.bossCap`, heavies chill slower; fire
thaws and frost puts fire out. Kind `melee` (chainsaw) cuts every zombie in an `arc`
cone within `range` with line of sight each shot, the magazine is fuel with no reserve
(it regenerates by reloading, free). Projectile extras: `flare` ignites what it hits and
lands as a 'flare' hazard (burns like fire, at most 24 alive, lights the area in both
renderers); `drag`/`pin` (harpoon) carries up to `drag` pierced zombies along, slowed, and
pins them for `pin` s at the wall or where it stops (bosses are never dragged).
Explosions: damage falls off linearly to 30% at the edge,
× perks.explosiveMult, hurt players at 35% (unless selfExplosionImmune and own), blocked
by solid obstacles (ray from centre). Melee: cone MELEE_ARC/MELEE_RANGE, MELEE_DAMAGE and
MELEE_KNOCKBACK (× meleeMult), cooldown MELEE_COOLDOWN. Frag (G): thrown at THROW_SPEED
toward the aim, bounces off obstacles, explodes after fuse. Molotov (F): shatters on
first obstacle/zombie contact or after 0.9 s, leaving a 'fire' hazard. Turret (T) /
barricade (C): placed BARRICADE.placeDistance in front if the spot is clear, else at the nearest clear
spot of a fixed set of nearby distances/small turns (`findPlacement()`), requires an
owned unit (bought in the shop). Turrets auto-target the nearest zombie in range with
line of sight, have `ammo`, hp, can be destroyed. Medic heal aura regenerates teammates.

**Downed / revive.** hp ≤ 0 → 'downed' (emit 'down'), BLEEDOUT_TIME countdown, can move
at DOWNED_SPEED and fire only the pistol (slot 0 if it holds a pistol-category gun with
any ammo left, otherwise a free infinite pistol) and reload it. A living teammate holding `interact` within
REVIVE_RADIUS for REVIVE_TIME / reviveSpeed revives them at REVIVE_HP (+REVIVE_BONUS cash
to the reviver). A self-revive kit revives after SELF_REVIVE_DELAY automatically.
Bleedout reaching 0 → 'dead' (emit 'died'); dead players spectate and respawn at the next
wave clear. Zombies ignore dead players but do attack downed ones.

**Economy.** Kill cash = `ZOMBIES[type].cash × difficulty.cash × perks.cashMult`
(elites ×2) to the killer (the player who dealt the killing blow; turret kills go to the
turret owner). Pickups per `items.js` (drop chance per kill; ammo/health/cash/armor/frag
auto-collected within PICKUP_RADIUS; crates need `interact` within INTERACT_RADIUS and
give the gun like a purchase). Pickups expire after PICKUP_LIFETIME.
`command(id, {type:'buy', item})` validates phase / supply-station proximity, price,
limits (FRAG_MAX + extraFrags, MOLOTOV_MAX, TURRET.maxPerPlayer placed+owned,
BARRICADE.maxPerPlayer, one self-revive), and cash; emits 'buy' or 'buyfail'
(reason: 'cash'|'closed'|'max'|'invalid'|'owned').
Stats per player: kills, damage dealt, revives, downs, cash earned.

**Rules settled during the build.** Shop guns are buyable when
`unlockWave <= (phase === 'wave' ? wave : wave + 1)` (exported as `shopWave()`; the shop UI
uses the same rule). Buyfail reasons: 'max' (ammo/armour/medkit/repair already full,
throwable/turret/barricade limits), 'owned' (owned gun already full, second self-revive
kit), 'invalid' (repair with objective off, unknown id, pistol), 'cash', 'closed'. Buying
'ammo' also refills the buyer's placed turrets. Death drops the loadout; respawn restores
pistol + class weapon. Hits on downed players cost DOWNED_HIT_BLEED s of bleedout per damage
point, drained at most DOWNED_HIT_BLEED_RATE extra s per s (a mauled survivor bleeds out at most
twice as fast). The objective's hp is the map's × (1 + OBJECTIVE_HP_PER_PLAYER × (players − 1))
at game start; zombie hits on it do OBJECTIVE_DAMAGE_MULT of their damage.
Explosions hurt players at 35%; explosiveMult only boosts damage to zombies. Molotov fire
hurts players only with friendly fire (25%). Bosses bypass maxAlive; boss hp multiplier
per zombies.js (`(hpBase + hpPerPlayer × players) / bosses`, own `hpGrowth`). Heavies (bloater, brute, boss) crash
through low cover (solid:false). Zombies weigh the objective as farther away than it is,
so they prefer nearby players and chew on the objective when nobody is close.
**In a one-player game (exactly one player, bots included) the survivor starts with a Self-Revive Kit** (solo would otherwise
end at the first knock-down); only at game start, respawns never hand out a kit. Nobody
fires once the game is over (`gameover`/`victory`); clients' shot prediction agrees.

**Flow field range.** `FlowField.maxDist` (default Infinity) stops a rebuild's expansion at
that path distance; cells beyond stay unreached and lead to the nearest reached cell
(`sample`), so a very big map rebuilds only around its targets (§3.7 sets it).

### 3.5 Required tests (`tests/sim.test.js`, `tests/movement.test.js`, `tests/flowfield.test.js`)
- Determinism: two Games with the same seed and scripted inputs produce identical snapshots
  after 3000 ticks.
- Every map: zombies spawned at every zombieSpawn reach a player within 60 s of sim time
  (no zombie permanently stuck), and a scripted bot team with good guns clears waves 1–3.
- Wave flow, downed → revive, bleedout → dead → respawn on wave clear, game over when
  wiped, objective destruction, buy validation, each weapon kind damages zombies, bloater
  burst, spitter pool, brute charge, boss slam, turret kills credit the owner.
- Perf: 250 zombies + 6 bot players, 600 ticks, average `step()` under 4 ms in Node.

### 3.6 AI survivors — `shared/sim/bots.js`
A player given `bot: true` (constructor list or `addPlayer`) is an AI survivor; `game.bots`
holds one brain per bot in join order (`removePlayer` drops it; `brain.holding` is true while
it stands still on purpose). Every tick, after the zombie grid is rebuilt and before inputs
are applied, each brain produces one InputCmd and queues it with `game.setInput`: the same
movement, firing, reviving and pickup rules as a human; purchases and the ready vote go
through `game.command`. No stat changes, no shooting at what it can't see (line of sight),
every random choice from `game.rng` (a game with bots stays deterministic). `botSkill`
(default 1 = everything below) scales it through `skillProfile()`: lower = slower reactions,
larger and slower-settling aim error, looser trigger, less threat awareness, zombies let closer,
fewer throws, moments of tunnel vision mid-wave (no backing off), reloading whenever low and
plain shopping (best gun affordable now, no saving). `BOT_SKILL.AVERAGE` stands in for an
average human in `scripts/balance.js` (docs/BALANCE.md). Behaviour:
- **Anchor**: a living human (bots spread over the humans), or the objective when no human is
  alive, when the humans are holding the objective anyway (within 260 px of it) or there are
  none. Each bot takes a free, reachable defend spot on its own bearing around the anchor,
  kept ≥ 90 px from teammates. Players never collide with each other, so bots can't block a
  human; they place barricades only in open ground ≥ 180 px from any human.
- **Targets** (every 6 ticks): the best-scoring zombie in sight — closer, mauling a teammate
  (humans first) or the objective, spitters/screamers at range, charging brutes, bosses;
  bloaters only when no teammate is within 130 px; out of weapon range scores below zero.
  When it saw ≥ 4 zombies chewing on the objective, those outrank everything, even far away.
- **Aim**: 0.08–0.32 s reaction after a new target, an aim error of 0.05–0.15 rad that decays
  while tracking, a finite turn speed; fires only with the crosshair on the target, in bursts
  with automatic guns beyond 260 px. With friendly fire on it never fires through a
  teammate, and never an explosive near one.
- **Movement**: kites back from zombies closing in (bosses, brutes and bloaters by their
  reach) by probing 12 directions with the real collide-and-slide (walls, cars, the map
  edge, other zombies, acid), follows A* paths over its own player-sized nav grid (at most
  one search per tick for all bots), and wiggles free in a random open direction when it
  makes no progress. After 3 s with nothing in sight mid-wave it hunts the nearest zombie
  (within 950 px of the anchor unless ≤ 8 are left).
- **Weapons**: the best gun for the range, reload when the magazine is low and nothing is
  within 250 px (or top up in a lull), shove when touched or surrounded, a frag into a pack
  of ≥ 6 at 260–440 px (molotov: ≥ 5 at 160–380 px) with no teammate within 210/160 px.
- **Support**: the nearest standing bot revives a downed teammate (≥ 3 zombies around them:
  clears the area first unless the bleedout is nearly over), grabs pickups it needs (a hurt
  human closer to a first-aid kit gets it) and crates better than its weakest gun; a
  downed bot crawls toward the nearest teammate firing its pistol.
- **Between waves**: walks to the supply station and buys one item every ~0.5 s: ammo
  (< 50 % reserve), medkit (< 60 % hp), repair (objective < 45 %), the best unlocked gun
  upgrade into its weakest slot (saving up when a better gun is within $450), a self-revive
  kit with $1500 to spare, armour, turrets (engineer), frags. Buys at once when the humans are ready or < 4 s are left. It
  votes ready once done shopping and every human has (at once when no human is alive), and
  places owned turrets at its spot facing out.
- **Cost**: sensing every 6 ticks, strategy every 30, steering every 3, staggered per bot,
  buffers reused; the nav grid is built on the first bot tick. 5 bots stay well under 0.5 ms
  per tick. Tests: `tests/bots.test.js` (brain, every map with an idle human + 3 bots
  clearing waves 1–3 with no bot stuck, determinism, cost), `tests/bots-session.test.js`.

### 3.7 Evac Run — settings.mode 'zone' (`shared/zone.js`, `shared/sim/zone.js`)

`shared/zone.js` holds the shared part: `MODE_LIST` / `MODE_IDS` (`'defend'` first, the
default), `mapModes(map)`, `mapSupportsMode`, `fixModeCombo(mapId, mode, changed)`, the tuning
table `ZONE`, `moveTime(d, first)`, `fogDps(outside, wave)`, `shrinkCircle`, and the view
helpers `zoneEdgeDist`, `insideZone`, `zoneName`, `nearSupply`. `game.mode` is the mode
played: the one asked for when the map plays it (else the map's first) and 'defend' on a map
without ≥ 2 POIs; a zone game has no objective (`settings.objective` false). `game.zone` is a
`ZoneDirector` (null in defend):

- **Sequence.** The team starts at the POI nearest the first player spawn. Each announcement
  picks the next POI from the director's own seeded stream (`zoneSequence(map, seed, start, n)`
  gives the same order): never the current one, uniformly among POIs `ZONE.pick.near..far`
  (3000..6200) px away, or (a small map with none that far) among the farther half of the
  others; never straight back to the zone before the current one unless nothing else is left.
- **Move** (prep and every intermission, zone stage 0): the announced circle is the POI's
  (x, y, r); the phase lasts `moveTime(d)` = clamp(12 + d / 170, 22, 60) s rounded (+12 s
  before wave 1), d = distance from the last zone. The ready vote only ends it early when
  every living survivor is inside the circle. A supply drop lands at an open spot near the
  centre (`zone.supply`, a 'drop' event): a weapon crate (next wave's pool), armour, a frag,
  1 + ⌊n/2⌋ ammo and 1 + ⌊n/3⌋ first-aid pickups that last the move + 60 s; mid-wave the
  shop also works within SUPPLY_RADIUS of it. Harassers: from 4 s in, every ~5 s a group of
  2–5 walkers/runners/crawlers 620–950 px from a random living survivor (toward the zone, a
  third of the groups from a flank, ≥ 600 px from everyone), round((4 + 1.4 × wave) × crowd) of them per move (crowd = (1 + 0.3 (n − 1))
  × difficulty.count), at most 20. No blight while moving.
- **Hold** (the wave starts: stage 1): the circle locks for `ZONE.hold` (38) s, then
  **shrinks** (stage 2) over `ZONE.shrink` (22) s, eased, to `shrinkTo` (0.58; on boss
  waves 0.75 but never below `bossMinR` 480 px, the Abomination needs room) × r around a
  new open, connected centre inside it; then **final** (stage 3) until the clear.
- **Blight** (wave phase only): outside the live circle a survivor loses
  `fogDps(t, wave)` = min(22, 4 + 1.6 t) × (1 + 0.05 (wave − 1)) hp/s, t = seconds outside
  (decays 2× as fast inside), straight off hp (armour doesn't absorb it), reported like acid;
  a downed survivor outside bleeds out 1.5× as fast instead (never instantly).
- **Spawns.** Wave zombies and bosses (and stuck zombies' re-entries) use spawn boxes on
  open, connected ground in a ring 380–880 px past the circle the team heads for (28
  bearings), preferring boxes ≥ 700 px from every survivor; from the shrink on, 35 % of the
  groups use a ring 140–320 px past the new circle's edge (≥ 420 px from survivors).
  A zombie stuck for 12 s out in the blight (> 60 px past the live circle) re-enters that
  way unless a survivor is within 300 px (650 elsewhere), so a wave can't stall on it.
- **Respawn / late join.** `spawnPointFor` puts respawns and late joiners on free spots
  inside the live circle (players built with the game still start at the map's spawns).
  The wave clear drops no weapon crate at the station (the drop is the reward).
- **Nav.** On maps over 30 M px² the zombie fields get `maxDist = ZONE.navRange` (2800).
- **Bots**: during the move they shop wherever they are, then head for a spot in the circle
  (sprinting; pickups only inside it, or when time allows), anchor on the circle (a human
  well inside it is anchored on instead), follow the shrink target, never hunt or revive deep
  in the blight, never kite out of the circle (near its edge they slide along it; mid-wave
  they keep inside the shrink target),
  and resupply at the nearest of the station and the drop inside the circle.
- Events: `zone` (stage 'next' | 'lock' | 'shrink', poi, x, y, r, time in whole s).
  `game.zone.stats` = { fog, harassed } running totals for tools.
- Tests: `tests/zone.test.js` (modes, POIs and their reachability on every map, the sequence,
  move time, lock/shrink timing, the blight, spawn rings, stuck re-entry, the drop, respawns,
  harassers, the wire, lobby rules and prefs, bot teams through the zones, determinism, the
  host tick on Harlan County vs the highway).

### 3.8 Campaign — settings.mode 'campaign' (`shared/campaign.js`, `shared/sim/campaign.js`, `shared/maps-campaign.js`, `shared/terrain.js`)

An extension of Highway 9 Pileup, Checkpoint Delta and Harlan County, picked with the lobby's
Mode row (`fixModeCombo` keeps map and mode compatible); a daytime game (`map.time 'day'`) on
the campaign variant of the map (§2). No objective to defend (`settings.objective` false), no
edge spawns: the director places every zombie. One wave counter runs through four stages
(`wavePlan(waves, floors)`: `hill = max(3, round(0.6 × waves))` hill waves, then the breakout,
one wave per floor, the roof; `totalWaves` in the snapshot is that total). `shared/campaign.js`
holds the tuning table `CAMPAIGN` (numbers below), `SUB`, `wavePlan`/`stageOfWave`/`killQuota`,
the route helpers and `stageBanner`; `game.campaign` is a `CampaignDirector` (null in the other
modes), whose hooks core.js calls (`begin`, `next`, `onIntermissionEnd`, `onWaveStart`,
`holdsWave`, `checkEnd`, `spawnRects`, `spawnPoint`, `aliveCap`, `pace`, `slowMult`,
`damageMult`, `onKill`, `tryZip`, `update`, `snapshot`).

- **Stage 1, HILLTOP** (waves 1..N). The team starts on the plateau of a real hill (r 980,
  plateau 350, 110 units high) ringed by a palisade with eight gates, sandbag funnels, a
  watchtower, the supply station, a truck and cover. Ordinary waves and intermissions, but the
  horde comes up the slope: zombies attack from a spiral of directions (2, 3, 3, then 4 at a
  time, turning `hillRing.spinRate` rad/s) out of a ring 40..340 px past the foot. **Slope:**
  a zombie on the flank moves (1 − 0.4 × flank) as fast and takes (1 + 0.3 × flank) damage
  (`flank` = 4f(1 − f), 0 on the plateau and at the foot); a shooter ≥ 24 units above its
  target deals +12 %. The last hill wave ends with a boss (ceil(n/3), 15 % fewer zombies), then
  an 18 s breather (shop open) announces the breakout (`brief`).
- **Stage 2, BREAKOUT** (wave N + 1, `holdsWave`: it does not end by killing everything). The
  hill's gates blow, a first wave pours over the far palisade, and a **horde front** starts
  330 px behind the hill's centre and walks the route at clamp(length / 64 s, 54, 96) px/s
  (`frontSpeed`). Anyone behind it (`routeProgress` arclength < front) takes
  `frontDps(t)` = min(26, 6 + 2.4 t) hp/s, t = seconds behind (it decays 2× as fast ahead of
  it), straight off hp, armour or not (reported like acid); a downed survivor bleeds out 1.6×
  as fast instead. Wave zombies (600 queued, at most 70 + 10 n alive, spawn interval × 0.7)
  spawn at the front (weight 3), ahead of the team's lead (1.6) and out of the side streets
  (0.8). The stage ends when every survivor standing is inside the entrance circle (r 120) for
  2.5 s (`enter`), or the front has passed the door with anyone inside: the field is cleared,
  the team moves to floor 1 (`arrive()`), the stage counts as a cleared wave (bonus, respawns,
  revives).
- **Stage 3, ASCENT** (waves N + 2 .. N + 1 + F, F = 3: Lobby, Offices, Atrium). One wave
  per floor of 0.5 × a normal wave's zombies (min 8), out of the floor's doors and vents
  (at most 24 + 7 n alive, pace × 0.85); the last floor also has a boss (ceil(n/3)). When the
  floor is clear the **stairs open** (`SUB.OPEN`) for 24 s (2.5 s once everyone stands on them;
  bots go when the team is ready or 14 s are left); at the end everyone is moved up (`moveUp`:
  the field — zombies, loot, projectiles, hazards, turrets, barricades — is cleared, the team
  stands on the next floor's arrival slots at the floor's height) and a 9 s breather starts
  with a supply drop (ammo, first aid, armour, from the last floor a weapon crate).
- **Stage 4, ROOFTOP** (the last wave, `holdsWave`). Kill `killQuota(n)` = round((44 + 26 (n − 1))
  × difficulty.count) zombies (spawn queue endless, at most 30 + 9 n alive, pace × 0.75;
  ceil(n/2) bosses walk in 26 s (+ 12 s per survivor a team lacks of three) after the start).
  At the quota `zip` turns true (`SUB.ZIP`, event 'zip'): **interact within the gantry
  circle** (r 100) to ride. A ride (`tryZip`) freezes the survivor (`frozen`, `riding` counts
  `RIDE_TICKS` = 4.8 s down): they swing to the cable, slide along it (eased) hanging 66 units
  below it, and land on the far pad as `escaped` (invulnerable and untargetable throughout,
  not shooting, taking no damage or pickups; event 'ride' then 'escape'). **Victory** when
  someone has escaped and nobody standing is left (alive, or downed with a self-revive kit,
  and not escaped) — a downed teammate left behind bleeds out; **defeat** when nobody
  standing is left and nobody escaped, as in every mode.
- **Late join / respawn.** A joiner enters alive in the breakout and on the roof (no wave clear
  to wait for), else as in §3.4; `spawnPoint(i)` = the hill's spawns (stage 1), beside the
  survivor farthest along the route but never behind the front (stage 2), the floor's arrival
  slots (3, 4). Everyone standing when a stage changes is teleported with the team.
- **Nav.** The zombie flow fields get `maxDist = ZONE.navRange` (2800) as on any big map; a
  zombie wedged far from everyone for 4 s is relocated (`STUCK_FAR_WEDGED`).
- **Bots** play the whole run: the hill's spots around the top, the breakout's spots inside the
  door circle (each on its own bearing), the stairs once the floor is clear, the gantry once the
  line is live (`errand` modes 'zip' and 'stairs'); they shop at the stage's supply point and
  never run ahead of the front's pressure.
- **Snapshot**: `campaign { stage, floor, sub, x, y, r (the stage's circle), t, total (a timed
  part: the door hold), front (route arclength or −1e9), kills, quota, zip, sx, sy (the current
  supply point) }`, players `esc` and `ride` (0..1), events 'campaign' (§4.1). `game.campaign.stats`
  = { blight, rides, escaped, arrivals } for tools.
- **Balance** (docs/BALANCE.md): average bots on Normal escape ≈ 20 % solo, 65 % as a pair, 55 %
  with three or four, 75 % with six; skilled bots win nearly every run from three up. Hard is a
  real fight (≈ 10 % for four average bots), Easy is walked through.
- Tests: `tests/campaign.test.js` (map extension and connectivity on the sim's own navigation
  field, terrain agreement, slow zones, floor transitions, quota / zip / escape / victory /
  defeat, late join, bots through a whole run and the breakout on every map, the wire, lobby
  rules, determinism, host tick), the e2e scenario `k`.

---------------------------------------------------------------------------------------

## 4. Snapshot (render state)

Produced by `game.snapshot()` on the host, encoded by `protocol.js`, decoded on clients,
interpolated by `net/session.js`, consumed by renderer / HUD / audio. The host renders
its own snapshots directly. **Field names are fixed.**

```js
Snapshot = {
  tick,                     // sim tick of this snapshot
  phase,                    // 'prep'|'wave'|'intermission'|'gameover'|'victory'
  wave,                     // current (or just-cleared) wave number, 0 during prep
  totalWaves,               // settings.waves (0 = endless)
  timer,                    // seconds left in prep/intermission, else 0
  remaining,                // zombies left this wave (alive + queued)
  bossHp,                   // 0..1 combined hp of living bosses, or -1 if none
  objective,                // { hp, maxHp } or null when disabled
  readyCount,               // players ready to skip intermission
  zone,                     // Evac Run (§3.7), else null: { stage 0 move|1 hold|2 shrink|3 final,
                            //   poi (announced/locked POI index), from (the previous one),
                            //   x, y, r (live circle; while moving the announced one),
                            //   nx, ny, nr (the circle it heads for: the shrink target),
                            //   t, total (s left in the stage and its length), sx, sy (supply drop) }
  campaign,                 // Campaign (§3.8), else null: { stage 1..4, floor (0 outside the tower, 1..3,
                            //   4 = roof), sub (SUB: 0 fight|1 rest|2 brief|3 stairs open|4 arrived|5 zip),
                            //   x, y, r (the stage's circle), t, total (s of a timed part), front (px along
                            //   the route, -1e9 = none), kills, quota, zip (0|1), sx, sy (supply point) }
  players: [ {
    id, x, y, angle,
    state,                  // 'alive'|'downed'|'dead'
    hp, maxHp, armor, stamina, sprinting,
    slot,                   // 0..2 current slot
    slots,                  // [weaponId|null, weaponId|null, weaponId|null]
    ammo,                   // [[mag, reserve], [mag, reserve], [mag, reserve]] (-1 reserve = infinite; [0,0] for empty)
    reloading,              // 0 = not reloading, else progress 0..1
    spin,                   // minigun spin 0..1
    firing,                 // fired within the last 0.1 s (muzzle/animation)
    meleeing,               // 0..1 swing progress, 0 = none
    cash, kills, damage, revives, downs,
    frags, molotovs,
    turrets, barricades,    // owned but not yet placed
    selfRevive,             // has a kit
    bleedout,               // seconds left while downed, else 0
    revive,                 // 0..1 progress of someone reviving this player
    reviver,                // id of the player reviving them, else 0
    respawn,                // true while dead and waiting for the wave to end
    ready,                  // voted to skip intermission
    lastSeq,                // last InputCmd seq applied
    earned,                 // total cash earned this game (end-screen stat)
    sprintLock,             // true while exhausted (must regain STAMINA_MIN_TO_SPRINT) — for exact prediction
    freeMag,                // rounds in the free pistol (fired while downed with no pistol) — for exact prediction
    z,                      // feet height (world units): jumping, climbing, on top of something, the terrain's
                            //   height on a campaign map (§2); 0 on the ground of the other maps
    esc, ride,              // Campaign: escaped down the zip line / 0..1 progress of a ride (0 = not riding)
    zq, vzq, jumpCd, climbT, climbTo,  // vertical state (§3.2), exact integers — for exact prediction
  } ],
  zombies: [ { id, type, x, y, angle, hp /*0..1*/, flags /*ZFLAG bits*/, z /*feet height, 0 on the ground*/ } ],
  projectiles: [ { id, kind /*PROJECTILE_KINDS*/, x, y, angle } ],
  pickups: [ { id, kind /*PICKUP_KINDS*/, x, y, weapon /*crate gun id or null*/ } ],
  turrets: [ { id, owner, x, y, angle, hp /*0..1*/, ammo /*0..1*/, firing } ],
  barricades: [ { id, owner, x, y, angle, hp /*0..1*/ } ],
  hazards: [ { id, kind /*'fire'|'acid'|'flare'*/, x, y, r, life /*0..1 remaining*/ } ],
  events: [ GameEvent ],
}
```
Entity ids are uint16, unique per entity type among live entities (they may be reused
after the entity is gone). Name/colour/class live in the roster (§6), not the snapshot.

### 4.1 GameEvent — `{ type, ... }`

All events carry the fields listed; consumers ignore unknown types.

| type | fields | meaning |
|---|---|---|
| `shot` | pid, turret, weapon, x, y, angle, rays: [{x, y, hit}] (+ `predicted` / `echo`, see below) | a gun fired. `pid` = shooter (0 if turret), `turret` = turret id (0 if player; turret shots use weapon 'rifle'). rays = end point of every pellet/beam/tracer: its last victim once its `pierce` budget is spent, else the first solid obstacle or max range; hit: 1 flesh (it hit at least one target), else 2 obstacle, 0 nothing/max range. Projectile/flame/cryo/chain weapons send `rays: []`; the chainsaw (kind 'melee') sends one ray per zombie cut (at most 6, hit 1), or none. |
| `placefail` | pid, kind | turret/barricade could not be placed (spot blocked) |
| `chain` | pid, points: [{x, y}] | tesla arc path (muzzle → first zombie → …) |
| `melee` | pid, x, y, angle, hits | shove swing (hits = zombies struck) |
| `zdie` | id, ztype, x, y, angle, by, gib | zombie died; by = killer pid (0 = none/turret owner unknown); gib = blown apart by explosion/rail |
| `zattack` | id, ztype, x, y, angle | zombie swung |
| `spit` | id, x, y, angle | spitter lobbed acid |
| `scream` | id, x, y | screamer buff |
| `charge` | id, x, y, angle | brute started charging |
| `slam` | id, x, y, r | boss ground slam landed |
| `explosion` | x, y, r, kind | kind: 'frag'|'grenade'|'rocket'|'bloater' |
| `ignite` | x, y, r | molotov burst into fire |
| `freeze` | id, x, y | cryo froze a zombie solid (cosmetic) |
| `pdamage` | pid, amount, x, y | player took damage (x,y = where from) |
| `down` / `revived` / `died` / `respawn` | pid (+ `by` for revived) | player state changes |
| `pickup` | pid, kind, x, y, weapon | collected |
| `buy` | pid, item | purchase succeeded |
| `buyfail` | pid, item, reason | purchase refused |
| `reload` | pid, weapon, time | reload started; time = its duration in seconds (perks applied) |
| `switch` | pid, weapon | weapon changed |
| `empty` | pid | dry fire |
| `throw` | pid, kind | 'frag' or 'molotov' thrown |
| `place` | pid, kind, x, y | 'turret' or 'barricade' placed |
| `destroyed` | kind, id, x, y | turret/barricade broken |
| `objhit` | x, y | objective damaged (at most 4/s) |
| `wave` | wave, boss | wave started (boss = boss wave) |
| `bossspawn` | id, x, y | boss appeared |
| `waveclear` | wave, bonus | wave cleared |
| `drop` | x, y | supply crate landed (Evac Run: the zone's supply drop) |
| `zone` | stage, poi, x, y, r, time | Evac Run: a zone was announced ('next'), locked ('lock') or started to shrink ('shrink') |
| `campaign` | what, stage, floor, pid | Campaign: what = 'stage' (a wave of the stage started or the stairs opened), 'brief' (the hill will fall), 'breakout', 'floor' (the team moved to that floor / the roof / the tower), 'zip' (the line is live), 'ride' / 'escape' (pid) |
| `gameover` | reason | 'wiped'|'objective' |
| `victory` | — | all waves cleared |

**Client-side shot prediction.** On a client, the session emits the local player's own
shots immediately as `shot` events with `predicted: true` (rays traced locally against
solid obstacles and the rendered zombies; `hit` is a guess). When the host's authoritative
`shot` for the local player later arrives it is passed on with `echo: true`: renderer and
audio must NOT draw/play an `echo` shot again (no tracer, flash, casing or sound) but the
renderer uses its rays' `hit` for the hit marker. On the host nothing is predicted and no
event carries either flag.

The sim must not emit more than ~200 events per snapshot; hitscan `shot` events from one
shooter in one tick are merged.

---------------------------------------------------------------------------------------

## 5. Wire protocol — `shared/protocol.js`

```js
export function encodeSnapshot(snap) → ArrayBuffer
export function decodeSnapshot(buf)  → Snapshot   // quantised copy of the original
export function encodeInputs(cmds)   → ArrayBuffer // last N (≤ 4) InputCmds, redundancy
export function decodeInputs(buf)    → InputCmd[]
```
Binary (DataView), positions quantised to 0.25–0.5 px, angles to u8/u16, 0..1 values to
u8. PROTOCOL_VERSION 8 (the Campaign: a header flag (8) and a 26-byte block after the zone
one — stage, floor, sub u8, the circle as x, y positions and a radius at 0.25 px, the timer and
its length at 0.01 s, the horde front as an f32 (−1e9 = none), kills and quota u16, the zip flag,
the supply point — bit 64 of a player's flags byte (`esc`) and a trailing `ride` u8 per player,
zombie heights as u16 (the floors reach 380 units; 2 bytes per zombie up high) and the
binary `campaign` event; 7 was climbing / the Evac Run; 3 added the jump state and, separately, the new guns' fields; both
together are 4; 5 appends the belt-fed HMG to the weapon table; 6 was used twice, by
the Evac Run zone and by climbing, which merged as 7). The Evac Run zone: a header flag and
a 25-byte block after the objective — stage, poi, from u8, the two circles' centres as
positions and radii at 0.25 px, the stage timer and length at 0.01 s, the drop's position —
and the binary `zone` event. Climbing: an InputCmd's buttons carry a `jump` bit (the climb key
too); each snapshot player ends with its vertical state, exact — `zq` u16, `vzq` i8,
`jumpCd` u8, `climbT` u8 and, only while climbing, `climbTo` u16 (`z` = zq × Z_UNIT on
decode); a zombie off the ground sets bit 128 of its flags byte (above every ZFLAG) and
appends its height as a u8 of whole units (5–6 bytes a player, 1 per zombie up high).
Weapon/zombie/projectile/pickup kinds as indices into the arrays in the data files.
Events may be packed as compact JSON (with numbers rounded to 1 decimal) inside the
buffer; an event whose JSON exceeds `MAX_JSON_EVENT_BYTES` (1 KB) is dropped. A 6-player, 250-zombie snapshot with ~60 events must stay under 14 KB. First byte
of every binary message is a message-type tag so snapshots and inputs can share a channel.
Tests (`tests/protocol.test.js`): round-trip every field, every event type, empty arrays,
max sizes, and a snapshot produced by the real `Game` after a few hundred ticks.

## 6. Networking — `public/js/net/*`

### 6.1 Transports (implementation detail of net)
- **p2p** (`transport-peer.js`): PeerJS. Host peer id = `PEER_ID_PREFIX + code`. Two
  DataConnections per client: `ctl` (reliable, serialization 'json') for control messages
  and `state` (reliable:false → unordered but still retransmitted, serialization 'raw') for
  binary snapshots/inputs. p2p and relay both skip a state message to a peer while a few
  are already queued for it (slow link), so snapshots echo their important events (§6.2).
  Signalling server defaults to the public PeerJS cloud; `window.HH_CONFIG.peer` (from
  `public/config.js`) may override host/port/path/secure/key and `config.iceServers`
  (TURN). JSON messages must stay under 16 KB.
- **relay** (`transport-relay.js` + `server/relay-server.js`): WebSocket to our own Node
  server at `/relay`, which forwards frames between room members. Available only when the
  page is served by the relay server (`GET api/info` → `{ relay: true }`). Static hosts serve
  the file `public/api/info` (`{"relay":false}`) instead, so the probe never 404s; the relay
  server's live route takes precedence over that file. Anything but JSON `relay: true` = no.
- **local** (`transport-local.js`): in-memory, for solo play and tests.
- `auto` = relay when available, else p2p.

### 6.2 Session API (used by the UI) — `net/session.js`

```js
export async function getServerInfo()   // → { relay: boolean }
export async function hostGame({ name, color, cls, transport })  // → Session (resolves when joinable)
export async function joinGame({ code, via, name, color, cls })  // → Session; rejects Error(msg)
                                        // msgs: 'Room not found', 'Room is full',
                                        // 'Game version mismatch', 'Could not connect',
                                        // 'Room is locked', 'You were kicked from this room'

session.isHost, session.localId, session.code, session.inviteUrl, session.transport
session.roster      // [{ id, name, color, cls, ready, ping, host, bot? }]  (lobby + in game;
                    //   bot: true on AI survivors, see "Bots" below)
session.settings    // { mapId, mode, time, difficulty, waves, objective, friendlyFire } (mergeSettings
                    //   in net/lobby-rules.js keeps map + mode and map + time compatible: the pick wins;
                    //   travels as JSON in the settings / start control messages: no wire change)
session.inGame      // true between 'start' and 'lobby'
session.on(event, fn) / session.off(event, fn)
   // 'roster' (roster), 'settings' (settings), 'chat' ({ pid, name, text, system }),
   // 'start' ({ mapId, seed, settings }), 'lobby' (), 'disconnected' ({ reason }),
   // 'notice' ({ text })
session.setProfile({ name, color, cls, ready })   // any subset; lobby only for cls
session.setSettings(partial)          // host only, lobby only
session.start()                       // host only: builds Game, broadcasts start (late joiners get it too)
session.returnToLobby()               // host only, after gameover/victory
session.sendChat(text)
session.buy(itemId)                   // → game.command(localId, {type:'buy', item})
session.ready()                       // vote to skip intermission
session.update(frameDt, input, aimAngle) // every animation frame while in game (input: §7.2;
                                      //   aimAngle computed by the UI, see §7.2)
session.getView(nowSeconds)           // → Snapshot for rendering (host: latest sim state;
                                      //   client: interpolated at now - INTERP_DELAY, with the
                                      //   local player replaced by its predicted state), or null
                                      //   Client local record: x, y, angle, stamina, sprinting,
                                      //   spin, firing AND the weapon state — slot, ammo,
                                      //   reloading — come from prediction (the ammo counter drops
                                      //   the frame a shot is fired; matches the host once acked).
                                      //   Downed with no pistol its `freeMag` (the free pistol's
                                      //   mag) is predicted too.
session.drainEvents()                 // → GameEvent[] due for presentation (client releases
                                      //   each snapshot's events when render time reaches it;
                                      //   presentation-only events more than 1 s old — e.g.
                                      //   after a hidden tab — are dropped, see net/event-rules.js)
session.getMap()                      // MapDef of the running game
session.getPredictedLocal()           // {x, y, angle} of the local player right now (for aim)
session.stats                         // { ping, fps?, kbpsIn, kbpsOut, snapshotsPerSec }
session.leave()
session.kick(pid)                     // host only; the player (same tab or same name) is
                                      //   refused for the rest of the session
session.setLocked(bool)               // host only: refuse every new player; session.locked
session.addBot()                      // host only, lobby only → the new roster entry, or null
                                      //   (room full / in game); works in solo too
session.removeBot(pid)                // host only, lobby only → true if a bot was removed
   // Extras: returnToLobby() works at any time (host "end game"); getView()/drainEvents()
   // use the session's own clock (performance.now) whatever `now` is passed; decoded
   // snapshots may carry `match` and `echo` (netcode internals, ignore them).
```
Host: runs `Game`, stepping with a real-time accumulator driven by a Worker-based ticker
(`net/ticker.js`) so the game keeps running when the host's tab is in the background.
Snapshots every SNAPSHOT_EVERY ticks. Host's own input goes straight into
`game.setInput`. Handles hello/version check, MAX_PLAYERS, names made unique, colours
kept distinct where possible, chat relay, ping measurement, late join, player leave.
Everything a client sends is untrusted: `buy` only with a real shop id, and each peer has
a control-message budget (20/s, burst 40; pong/bye exempt) — excess is dropped, a peer
that keeps flooding is disconnected ('Disconnected: too many messages'). Roster updates
from peers' profile changes are coalesced (≤ 10/s). The hello carries a per-tab `token`
(sessionStorage) so a kick also refuses the same tab under another name.
**Liveness.** The client gives up after 10 s without any host message, the host drops a
peer after 15 s of silence; right after 'start' (or a late joiner's 'start') both allow
30 s, because every page builds its 3D world then and a slow one can freeze for seconds.
The real (Worker-driven) housekeeping timers credit their own page's freezes (a tick gap
over 1.5 s) instead of counting them as the other side's silence — the messages from that
time are still queued behind the timer callback. The p2p transport's heartbeat timeout
(35 s) is only a backstop behind these watchdogs.
**Bots** (AI survivors, §3.6): roster entries `{ id, name, color, cls, ready: true, ping: 0,
host: false, bot: true }` with a name from `BOT_NAMES` (lobby-rules.js; fictional, never real
people), a free colour and preferably a class no one has. They count toward MAX_PLAYERS,
are ready by definition (start/returnToLobby keep them ready), are passed to `Game` with
`bot: true` and keep their slot through repeated games until removed. A human joining a
full room with bots in it makes the newest bot leave (lobby: roster only; mid-game: also
`game.removePlayer`) — the joiner enters normally (a late joiner mid-wave), taking over
nothing; with room to spare the bots just stay. A human who asks for a colour a bot has
gets it (the bot takes the human's old colour, or any free one on join).
Client: fixed-step 60 Hz input sampling; each cmd applied to a local predicted copy of
the player via `stepPlayerMovement` and sent (with the previous 3 for redundancy) every
frame; on snapshot, reconcile from `lastSeq` and replay pending cmds; smooth visual
correction. Local shots may be shown immediately (cosmetic prediction) — then the
host's `shot` events for the local player must not be shown a second time.
Edge-triggered input (reload, frag, …) pressed in a frame that produces no tick must be
carried into the next produced cmd (never lost, never duplicated).

## 7. Client (browser)

### 7.1 Classic top-down renderer — `render/renderer.js`

```js
export function createRenderer(canvas, { map, quality, mode, time })  // quality 'high'|'low'; mode 'zone' (§3.7);
                                                                       // time 'day' (§7.5.1): sunlit haze, no darkness
r.render(view, { localId, roster, now, dt, cursor /*{x,y} screen px*/, settings })
   // settings: { screenShake: bool, showNames: bool, lighting: bool }
r.addEvents(events, { localId })     // particles, decals, tracers, shake, hit markers
r.screenToWorld(sx, sy) → {x, y}
r.worldToScreen(x, y)  → {x, y}
r.getCamera()          → {x, y}       // world point at the screen centre (read-only copy):
                                      //   the UI passes it to audio as the listener
   // A jumping / climbing player is drawn up to 16 % bigger with its shadow shrunk, faded
   // and pushed away from the body; one standing on top of something (z > 0) up to 14 %
   // bigger with the shadow at its feet; a zombie up on something up to 16 % bigger.
r.resize()                            // call on window resize (handles devicePixelRatio)
r.setQuality(q)
r.destroy()
export function renderMapPreview(canvas, map)   // static thumbnail for the lobby
export function renderClassPortrait(canvas, classId, colorIndex)  // survivor portrait for the lobby/HUD
```
Top-down, canvas 2D, all art procedural (no image files). Night atmosphere: darkness
overlay with player flashlight cones, muzzle flashes, map lights, fires, explosions.
Persistent blood/scorch decals and corpses. Camera follows the local player with a
look-ahead toward the cursor; spectating dead players follow a living teammate.
Draws: map layers (pre-rendered), obstacles (cars etc. by kind), objective, supply
station, pickups, barricades, turrets, hazards, zombies (distinct look per type, walk
animation, elites glow, burning flames), players (class look + colour + held weapon
sprite), projectiles, tracers, name tags + hp bars over teammates, revive rings,
off-screen teammate arrows, crosshair at the cursor (spread + hit marker), damage
vignette for the local player. Overhead, above the entities: tree canopies, lamp and
traffic-signal arms, and the overpass decks (MapDef.overpass) as a see-through layer with
their shadow, lane paint, parapets and deck wrecks, fading further while a player stands
under a deck so everyone beneath stays visible. `renderMapPreview` shows a very long map
(the highway) as the stretch around its objective, and an Evac Run map with its POI rings
instead of the objective and the spawn zones. Evac Run (`render/zone2d.js`, from
`view.zone`): the safe circle as a glowing teal ring (dashed while only announced), the white
dashed circle it shrinks to, a violet haze over the blight during a wave, the supply drop
with a pulsing beacon (and a light), and while the player is outside the circle an edge
arrow with the zone's name and distance; the objective's corner brackets are not drawn.

The Campaign (top-down): `render/campaign2d.js` shades the terrain (the hill as a lit dome with
contour rings, plateaus with a cliff line) under the obstacles, draws the stage's circle (amber;
dashed green once the zip line is live), the horde front (a red wall and tint over the route
behind it), the zip cable with its pulse, the stage's supply beacon and an edge arrow to the
circle, plus the lobby thumbnail extras; `render/obstacles-campaign.js` draws the new kinds.
The old objective is scenery there (no glow, no marker).

### 7.2 Input — `ui/input.js`
```js
export function createInput(canvas)
input.sample() → InputState      // call once per frame; edges reported once
input.setEnabled(bool)           // false while typing in chat / in menus
input.cursor                     // {x, y} screen px
InputState = { moveX, moveY, aimScreenX, aimScreenY, fire, melee, sprint, interact, jump,
               reload, frag, molotov, turret, barricade, lastWeapon, slot, cycle,
               shop, scoreboard, chat, ready, pause }   // last five are UI edges/helds
```
Keyboard + mouse (WASD/arrows, mouse aim, LMB fire, RMB/V melee, Shift sprint, Space
jump, E interact, R reload, 1/2/3 slots, wheel cycle, Q last weapon, G frag, F molotov,
T turret, C barricade, B shop, Tab scoreboard (held), Enter chat, N ready, Esc menu),
gamepad (standard mapping, right stick aim; A jump, RB interact, LT melee, RT fire, X
reload, Y next weapon, LB frag, B molotov, D-pad ▲ turret / ▼ barricade / ▶ last weapon /
◀ ready, L3 sprint toggle, R3 shop, Back scoreboard, Start menu; A also accepts in menus),
touch (twin virtual sticks + buttons, JUMP next to FIRE in first person). `jump` is held
like `sprint`, and is also true in the one sample after a press too short to be seen held
(a tap between frames is never lost); the cmd builder carries such a tap into the next cmd.
`session.update(dt, input, aimAngle)` receives the InputState plus the aim angle, which
the UI computes as the angle from `session.getPredictedLocal()` to
`renderer.screenToWorld(input.aimScreenX, input.aimScreenY)` (top-down) or takes as the
camera yaw (first person, §7.5).
First-person additions: `createInput(canvas, { view: 'fps'|'topdown', onLockChange(locked),
touchRoot, forceTouch })`; InputState also carries `lookDX, lookDY` (CSS px since the last
sample: pointer-locked mouse movement, touch look-pad drags × TOUCH_LOOK_GAIN, the right
stick via `padLookDelta()`; 0 while disabled; a locked move > 400 px is dropped as a browser
glitch). `input.view` / `input.setView(v)`, `input.locked`, `input.lockSupported`,
`input.requestLock()` / `input.exitLock()`, `input.addLook(dx, dy)` (test hook). In fps
view a click on the canvas without the lock requests it and does not fire (a tap's
compatibility mousedown never asks), and losing the lock releases the held mouse buttons.
The look maths lives in `ui/look.js` (pure, unit-tested): `applyLook`, `moveToWorld`,
`padLookDelta`, `aimAssist`, `wrapAngle`, `clampPitch`, `headingDeg`, `LOOK_RAD_PER_PX`.

### 7.3 HUD & UI — `ui/*`
Screens: title (name, class picker with portraits, colour), host / join (code field,
join via link `?join=CODE` [&via=relay]), lobby (roster with class/colour/ready/ping,
host controls: map with preview, difficulty, waves, objective toggle; invite link copy;
chat; start; "+ Add Bot" under the roster (host only, solo too, disabled when full) and
a ✕ on bot rows (`removeBot`); bot rows show a BOT tag instead of the ping, read-only
for non-hosts), in-game (canvas + HUD + chat + shop modal + scoreboard + pause/settings),
end screen (victory/game over with per-player stats; host "Back to lobby"), settings
(view, field of view, mouse sensitivity, stick/touch look, invert Y, aim assist, rotating
minimap, volume, quality, lighting, screen shake, name tags), how-to-play.
Pause menu: Resume, Settings, How to Play, **End Game (host only**: confirm "Return everyone
to the lobby?" → `session.returnToLobby()`), Leave Game. Online games (not solo) show the
room code + "Copy invite link" (late join works) in the pause menu and in the scoreboard
header; the scoreboard is mounted on `#screen-game` above the touch layer, letting
everything but that button through. A touch button that opens the shop or pause menu
swallows the tap's trailing click (it would land on what just opened, e.g. buy a card).
The HUD weapon panel shows the weapon actually in hand (`activeWeapon()`: a downed
survivor's pistol).
Lobby: a Mode row (Defend / Evac Run / Campaign, with the mode's description) above difficulty; a
map card that does not play both standard modes carries a tag ("Evac Run · Campaign only" on
Harlan County) and picking it switches the mode; maps with the campaign extension carry a
CAMPAIGN badge over their preview, and in Campaign mode every such card previews the campaign
variant (hill, route, zip line); the objective toggle is disabled (Off) in Evac Run and the
Campaign; `prefs.lobby.mode` is stored and validated (`ui/storage.js`).
A Time segmented control (Night / Day, `#opt-time`) sits next to the Mode row, works like it (a
day-only map card carries a "Day only" tag, picking it switches the time, picking Night leaves it
for a night map) and is stored in `prefs.lobby.time`; choosing the Campaign mode sets Day.
Campaign HUD (`ui/campaignhud.js`, `createHud(…, { mode: 'campaign' })`, mode chosen by
`map.campaign`): the stage panel under the compass ("HILLTOP STAND · WAVE 3/9 — high ground:
+12% damage", "BREAKOUT · REACH THE TOWER — 103 m to the tower door · 5 m ahead of the horde",
"HOLD THE DOOR", "FLOOR 2 · OFFICES — clear the floor: 9 left", "stairs open, 19 m away · up in
24 s", "ROOFTOP · 12/96", "ZIP LINE LIVE", "ESCAPED — waiting for the others"), with a progress
bar; the wave panel names the stage counters (HILL WAVE n / N, STAGE 2 / 4, FLOOR n / 3,
ROOFTOP kills / quota); a pulsing "THE HORDE HAS YOU" warning, a red screen edge and a tone
every 1.6 s while you are behind the front; a full-screen title card over a short fade
(FLOOR 1 / LOBBY, ROOFTOP) when the team moves; banners for the hilltop, the breakout, the zip
line waking up and your escape; toasts for teammates' rides and escapes; the interact prompt at
the gantry; the end screen says "Escaped" (or where the team fell). The compass shows the
stage's circle (amber ring; green once the line is live) and the stage's supply point (green
+); the minimap / radar draws the hill, the route, the zip cable, the circle, the red band
behind the horde front and the supply point; mid-wave shopping works at that supply point
(`view.campaign.sx, sy`, as the sim's `shopOpen`).
Evac Run HUD (`ui/zonehud.js`, `createHud(…, { mode: 'zone' })`): a panel under the compass
("MOVE TO GAS-N-GO · Zone locks in 42 s · 80 m away", "HOLD …", "THE ZONE IS SHRINKING",
"FINAL CIRCLE", with a timer bar; green once you're in), a banner + sting for each new zone
and each shrink, and while you stand in the blight a pulsing "YOU ARE OUTSIDE THE SAFE ZONE"
warning with the distance, a violet screen edge and a warning tone every 1.6 s. The compass
shows the zone as a teal ring with the distance to its edge (no objective ◆) and the drop as a
green +; the minimap/radar draws the live circle (dashed while announced), the shrink
target, the tinted blight and the drop, pinning the zone and the drop to the radar's rim.
HUD: health/armour/stamina, weapon slots with ammo, cash, wave + remaining + phase timer,
objective hp, boss hp bar, teammate list (hp, state, bleedout), minimap, kill feed, chat,
interaction prompts ("Hold E to revive Doc"), shop hint, notices (wave start, wave
cleared +$250, "Sparks is down!"), ping/fps (toggle).
`window.__HH = { session, renderer, hud, input, getView, getLocal, view, look(dx, dy),
getLook() }` debug hook for end-to-end tests (`view` = 'fps'|'topdown' of the running
match; `getLook()` → `{ yaw, pitch, ready, locked, view, frames }`; documented in
scripts/e2e.js). Between games it is a module-level frozen null object — never a closure
created inside a match, which would keep the finished match reachable.
First-person HUD (`createHud(root, { …, view: 'fps', minimapRotate })`, `#hud[data-view=fps]`):
no cursor crosshair (the renderer's overlay draws it), a compass strip at the top centre
(`ui/compass.js`: heading tape, objective ◆ with distance in metres, supply +, teammates,
edge arrows for markers off the arc), the minimap as a rotating radar (up = facing; redrawn
at ≤ 30 Hz unless the view turns; settings.minimapRotate false = whole map north-up, or on a
map more than 2.6× wider than tall a full-height window that follows the player), the
interaction prompt just under the crosshair and the shop hint at the bottom. `hud.update`
info adds `yaw` and `camPos`. A "Click to play · Mouse to look · Esc releases the mouse"
hint shows while playing with keyboard/mouse unlocked; the pause menu's resume button
reads "Click to Resume".
Touch HUD: the HUD columns sit along the top edges and the touch button rows go right
below them. Their heights vary, so `hud.js` measures the boxes (5×/s) and publishes
`--hud-col-top`, `--touch-util-top` and `--touch-gear-top` on `#screen-game`; the CSS
falls back to fixed offsets without them. No HUD panel or touch button may overlap
another at phone sizes (checked by the e2e phone scenario, portrait and landscape).
Large screens: the stylesheet is in rem and `<html>` font-size is 16px × `--ui-scale`
(`ui/uiscale.js`: clamp(min(h/1000, w/1200), 1, 3), always 1 on touch; × the "UI size"
setting 75–150 %), so the HUD and menus keep their proportions from 720p to 4K; with
`hudSafeArea: '16:9'` (default) the HUD sits in a centred 16:9 box on ultrawide screens.
Settings dialog tabs: Graphics (preset, resolution, Advanced effect toggles — §7.5),
Display & HUD (UI size, safe area, view, fov, name tags, stats, minimap), Controls
(sensitivity, invert, raw mouse, aim assist), Audio. Fullscreen buttons on the title,
pause menu and settings (`ui/fullscreen.js`; in Chromium the game claims Esc while
fullscreen so Esc only releases the mouse); `fullscreenOnStart` (off by default).

### 7.4 Audio — `audio/audio.js`
```js
export function createAudio()
audio.unlock()                               // on first user gesture
audio.addEvents(events, { x, y, localId })   // positional (pan + distance falloff)
audio.update(view, { localId, dt })          // loops: minigun spin, flamethrower, horde
                                             // ambience by nearby zombie count, low-hp heartbeat
audio.ui(name)  // 'click'|'hover'|'buy'|'deny'|'chat'|'join'|'leave'|'wave'|'waveclear'
                //  |'gameover'|'victory'|'countdown'|'ready'
                //  |'zone' (a new safe zone / the shrink: radio click + bright two-note call)
                //  |'zonewarn' (short double beep while standing in the blight)
                //  |'stage' (the hilltop / breakout: low horns and timpani) |'floor' (a lift chime over a
                //  falling rumble) |'zipline' (the line waking up) |'escape' (a short fanfare)
audio.setVolume({ master, sfx, music })      // 0..1
audio.setMuted(bool)
audio.setMap(map)                            // permanent map fires crackle when nearby (null clears)
// update() also plays 'jump' / 'land' (synthesised grunt + scuff, boot thud + grit) when a
// player leaves / returns to its feet (vzq), 'climb' (palms on the ledge, a strained grunt,
// boots scrabbling) when a climb starts, 'land_roof' (a hollow sheet-metal thunk) for a
// landing up on something and 'roofstep' every ~60 px walked on a roof — the local one
// from its predicted view at once. Heights are relative to the map's terrain (`setMap`): on
// the campaign's hill and floors nothing is "up on a roof". A ride starts 'zip_ride' (ratchet,
// sheave whine, rushing wind; 5.2 s) at the rider, an escape a landing thunk, and walking up
// the campaign's stairs plays a clanking 'stairstep' every ~34 px.
// First person: pass `yaw` in addEvents/update opts (see §7.5 "Audio orientation";
// exported helpers orientedPan(dx, dy, yaw) and rearShade(behind, maxLp) are unit-tested).
// addEvents/update listener: opts {x, y} is the camera centre (the spectated teammate
// while dead); update(view, { localId, dt, x, y }) falls back to the local player without them.
// 'reload' sounds are timed from the event's `time` (weapon table when absent). ui() is for menu/lobby sounds; in-game stingers come from events
// (audio dedupes overlaps anyway).
```
All sound synthesised with WebAudio (no files). Voice limiting (max ~24 concurrent,
per-sound rate limits) so a minigun into a horde doesn't clip.

**Music** (`audio/music.js`, orchestra in `audio/instruments.js`): an original, heroic
Nordic-fantasy orchestral score in D minor / D Dorian (low male choir on "aah"/"ooh",
string ensemble, horns, harp, wooden flute, taiko war drums, timpani, cymbal swells),
played by a small sequencer from baked instrument samples (one seamless loop or one-shot
per sample root, transposed by at most ±2 semitones; sustained notes are the loop with an
attack/release envelope). States follow the game: `menu` and `calm` (prep/intermission,
70 bpm 3/4: harp, strings, choir, a flute or horn melody, the main theme), `tension` (last
seconds before a wave, 112 bpm), `battle` (112 bpm 4/4 string ostinatos and drums; horns,
choir, a chant and high strings join as the horde grows, gated by the smoothed intensity),
`boss` (6/8, galloping drums, full choir), and the cues `waveclear` (VI–VII–I into D
major, then calm), `victory` (fanfare, then `glory`, a calm loop in D major) and `gameover`
(sombre, then a slow `lament`). Each looping state has 60–120 s of phrases played in a
seeded random order (`createAudio({ musicSeed })`, random by default); changes land on the
next beat (urgent) or bar and fade the outgoing phrase. The score has its own long hall
reverb, sits under the effects and ducks up to ~3 dB under heavy fire; the music volume
applies as usual. `audio.stats().musicState` reports the state. The menu's instruments
bake first (`early`), the rest of the orchestra after the effects.

### 7.5 First-person 3D view — `render3d/*` (the default view)

The game is a **first-person shooter**. The simulation stays 2D (a flat ground plane,
like classic Doom-style shooters): aim is the camera yaw, bullets travel horizontally,
so vertical aim never matters for hits. The 3D renderer turns snapshots into a
first-person scene. The old top-down renderer (§7.1) stays as a "Classic top-down" view
option and as the fallback when WebGL is unavailable.

**Library.** three.js r186, vendored: `public/vendor/three/three.module.js` (imports
`./three.core.js`) and addons under `public/vendor/three/addons/` (e.g.
`addons/utils/BufferGeometryUtils.js`). `index.html` declares an import map
`{ "three": "./vendor/three/three.module.js", "three/addons/": "./vendor/three/addons/" }`
before any module script. Only `render3d/` imports `three`. Unit tests must not import
render3d (Node can't resolve it without installing three) — test it in the browser.

**Coordinates & scale.** Sim point (x, y) ↦ three.js `Vector3(x, height, y)`; +Y is up.
1 world unit = 1 sim px ≈ 1/32 m. Sim angle `a` (0 = +x, +π/2 = +y) is the direction
`(cos a, 0, sin a)`; a three.js camera looking along angle `a` with pitch `p` has
`rotation.order = 'YXZ'`, `rotation.y = -a - π/2`, `rotation.x = p`.
Canonical heights (units) — keep visibility consistent with the sim's `solid` flag
(shots pass over solid:false cover, so it must sit below the eye):
eye 52 (downed 16) · car 44 · rock 16–30 · guardrail 22 · barrier 26 · sandbags 30 ·
fence (thin wall) 40 · pump 52 · suv 56 · pickup 58 (bed 34) · hesco 70 · van 72 ·
tent 80 · container 84 · wall (thick) 90 · booth 90 · bus 100 · truck 100 · tanker 112 ·
semi cab 110 / trailer 124 · pillar 150 · overpass pier `top` (138 under a 200 deck: deck
underside 164, parapet top 230) · ramp embankment = its deck · building 150–260 · tree trunk 70 + canopy up
to 180–300 · lamp post 230 · zombie walker ~56 (scaled by `look.scale`) · player ~56.

**Module layout** (all ES modules under `public/js/render3d/`):
```
renderer3d.js   createRenderer3D(canvas, { map, quality }) — the public API below; owns the
                WebGLRenderer, scene, camera rig, fog, sky, light pool, ground, overlay canvas,
                frame loop plumbing; creates the sub-systems with the shared ctx
world.js        static world from the MapDef: ground, obstacles, objective, supply, decor,
                trees, lamps, fires, water, sky dome
ground.js       ground textures painted with render/maplayer.js `paintGround` into chunked
                canvases + the decal API (blood, scorch, acid, corpses' pools)
lights.js       fixed pool of PointLights + the flashlight SpotLight
zombies3d.js    instanced zombies (+ corpses, gibs)
players3d.js    teammates (third person), their weapons and flashlight cones
items3d.js      projectiles, pickups, turrets, barricades, hazards
effects3d.js    particles, tracers, muzzle flashes per weapon class, impacts by surface, explosions
                (multi-stage), arcs, beams, shake requests; orchestrates blood3d / gore3d / casings3d
fx-decals.js    the decal layer (one draw call, two ring buffers: blood etc. and marks) and its atlas
blood3d.js      blood on walls / cars / ground: exit-wound sprays, drips, pools, footprints, drag smears
gore3d.js       severed limbs, torsos and heads with tumbling physics that smear where they slide
casings3d.js    ejected shell casings (pooled instanced mesh)
surfaces.js     obstacle faces (normal, top, extent) and ground materials derived from the map data
ambient3d.js    motes, fireflies, leaves / paper, wind-blown ash, rain splashes, far lightning, birds
viewmodel.js    the first-person gun + hands (own scene/camera, drawn after the world)
overlay.js      2D overlay canvas: crosshair, hit/kill markers, name tags, revive rings,
                damage-direction arcs, off-screen arrows, low-hp vignette
zone3d.js       Evac Run (ctx.mode 'zone', built at creation so the warm-up compiles it): the
                zone wall (a 560-unit teal curtain on the circle with rising streaks and a
                bright ground seam, fading to 10 % within ~50–520 units of the camera and
                ignoring most of the fog), the low white curtain of the shrink target, the
                violet blight haze on the ground outside during a wave, light columns over
                the announced zone and the supply drop (+ the crate, lit through the pool),
                violet thicker fog while the player stands in the blight (the HUD adds the violet edge), and
                overlay markers: the zone (name + distance, pinned to the screen edge with an
                arrow) and a SUPPLY tag; hides the objective marker
world-rural.js  Harlan County's kinds: grain silos (300) and headstones (30)
campaign3d.js   the Campaign (built whenever the map has `campaign`; ctx.mode 'campaign'): an
                amber (green once the line is live) ring and a soft light column over the stage's
                circle (thin near the eye, never a slab when you stand in it), the tower's blue
                beacon during the breakout, the horde front (a churning dust wall + red-hot foot
                across the street, brown thicker fog while you are behind it), a pulse and
                trolleys on the zip cable, an overlay marker for the circle (TOWER / STAIRS /
                GANTRY / ZIP LINE with the distance); the camera rolls and widens its FOV while
                riding (renderer3d.js updateCamera)
world-ridge.js  the campaign's kinds and dressing: the palisade, watchtower, tower (curtain wall,
                sign, red beacon), the annex (curtain-wall shells around the plateaus, offices with
                desks / cabinets / counters / columns, the stairs), the roof (parapet, plant,
                helipad, antenna, the zip gantry and cable), the landing pad, a painted skyline
  terrain in the renderers: `ctx.terrain` / `ctx.groundY(x, y)` (shared/terrain.js): the ground
  tile mesh is subdivided with the heights (`ground.js`), every world object is lifted onto
  `groundY(centre)` (`world-geo.js setGround`), the grass shader follows the hill, map lights
  and light sprites are lifted, and the sub-systems add the ground height under an effect
  (`effects3d.js` / `items3d.js` wrappers, gibs and corpses in `zombies3d.js`).
  helpers (no ctx sub-system of their own):
world-geo.js    merges world primitives into per-material, per-cell vertex-coloured meshes
world-tex.js    procedural world textures (window/neon atlas, chain-link mask, water normals)
world-overpass.js  MapDef.overpass: decks (slab, girders, parapets, lane paint, deck lamps),
                pier bents, ramp embankments, fascia signs, fixtures under the deck, deck wrecks;
                deckHeightAt(map, x, y) (fires on a deck burn up there), deckRoofs(map) (no rain
                under a viaduct)
world-fx.js     one-draw-call GPU-animated world pieces (sky, fires, embers, smoke, halos,
                light shafts, fake far light pools, objective marker)
actor-kit.js    PartBuilder (merge primitives into one vertex-coloured geometry), colours
actor-rig.js    GPU-skinned InstancedMesh rig (pose rows in a float DataTexture per type)
actor-guns.js   low-poly gun per weapons.js sprite style, shared by viewmodel + teammates
fx-core.js      shared particle / streak / glow pools (3 draw calls), acquireFx(ctx)
post.js         post-processing chain, dynamic resolution, GPU timer (see below)
post-atmos.js   atmosphere + wet-ground reflections pass of the chain (see below)
```
Each sub-system is created as `createX(ctx)` and returns
`{ update(view, frame), addEvents?(events, opts), setQuality?(q), dispose() }`.
`ctx` (built by renderer3d.js, read-only for sub-systems):
```
ctx = { THREE, scene, camera, map, quality,           // quality 'ultra' | 'high' | 'low'
        overlay,                                       // CanvasRenderingContext2D of the overlay (CSS px)
        lights: { flash(x, y, h, color, intensity, radius, life),   // transient light (muzzle, explosion)
                  steady(key, x, y, h, color, intensity, radius) }, // per-frame persistent source
        ground: { decal(kind, x, y, r, angle, alpha) },  // kind 'blood'|'scorch'|'acid'|'oil'|'gore'
        project(x, y, h) → { x, y, visible },          // world → overlay CSS px
        shake(amount),                                 // camera shake request (0..1)
        heightOf(kind, obstacle) → units,              // canonical heights above
        rng }                                          // cosmetic randomness (Math.random is fine here)
frame = { dt, now, localId, roster, local /* view record of the local player or null */,
          camX, camY, yaw, pitch, settings }
```

**Public API** (same shape as §7.1 so `ui/match.js` can use either renderer):
```js
import { createRenderer3D } from './render3d/renderer3d.js';
const r = createRenderer3D(canvas, { map, quality, mode, time });   // mode 'defend' | 'zone' (→ ctx.mode);
                                                                     // time 'night' | 'day' (→ ctx.time, §7.5.1; default: the map's own time, else night)
r.render(view, { localId, roster, now, dt, look: { yaw, pitch }, settings })
   // settings: { screenShake, showNames, lighting,
   //   fov: horizontal degrees measured on a 4:3 frame (Hor+; default 80 → 64.4° vertical,
   //        wider screens see more at the sides; narrower than 4:3 keeps the horizontal
   //        angle, vertical capped at 100°),
   //   crosshair: bool (false = a menu covers the view / dead: hide crosshair + markers) }
r.addEvents(events, { localId })
r.screenToWorld(sx, sy) → {x, y}   // ground point under a screen point (for API compatibility)
r.worldToScreen(x, y, h = 0) → {x, y, visible}
r.getCamera() → { x, y, yaw }      // camera position/orientation (listener for audio)
r.resize(); r.setQuality(q); r.destroy(); r.stats; r.mode === 'fps'
   // r.stats = { drawCalls, triangles, jsMs, updateMs, submitMs, fps, lights,
   //             staticTriangles, frames }   (ms are rolling averages)
   // r.debug = { renderer, scene, camera, world, lights, subs, ctx, createMs } — dev tools
   //             and tests only, not API
export function isWebGLAvailable()
export function verticalFov(fovSetting, aspect) → degrees   // the Hor+ conversion above
```
The renderer creates its overlay canvas as a sibling right after `canvas` (same CSS box,
`pointer-events: none`) and removes it in `destroy()`.

**Camera.** At the local player's rendered position (the view's local record, already
predicted on clients) at eye height, looking along `look.yaw` / `look.pitch`, with walk
bob, landing of recoil kicks and screen shake (respect settings.screenShake). Jumping: the
eye rides `z` (no walk bob in the air) and a touch-down kicks a ~3-unit spring dip; the
viewmodel dips a little on take-off and more on landing, then springs back; teammates
(players3d) are lifted by `z` with their knees tucked. Climbing: the eye rides `z` up the
0.4 s climb (no bob) with the view dipped ~6° toward the ledge and rolled a little, a
smaller dip when it ends; the gun drops ~7 units and tilts down out of the way, then comes
back. On top of something the eye is `z` + 52 as usual; teammates and zombies (zombies3d)
standing up there are lifted by their `z` (standing: legs straight; a zombie killed up
there falls on the roof), and name tags follow. The HUD prompt shows "SPACE — climb"
(the jump key per input mode) while facing, within 40 px, a ledge a jump would mantle
(movement.js `ledgeAhead`). Downed:
eye 16, slight roll. Dead/spectating: a smooth third-person chase camera behind a living
teammate (their angle), or a slow orbit over the objective when nobody is alive.

**Look & movement (UI side, `ui/match.js` + `ui/input.js`).** In fps view the UI owns
`yaw`/`pitch` (radians; pitch clamped to ±1.35). `input.sample()` also returns
`lookDX, lookDY` (mouse/touch deltas in CSS px since the last sample; gamepad right stick
is converted to an equivalent delta per frame). The UI applies sensitivity/invert-Y and
updates yaw/pitch, rotates the local WASD vector into world space
(`forward = (cos yaw, sin yaw)`, `right = (cos(yaw + π/2), sin(yaw + π/2))`) before
calling `session.update(dt, input, yaw)`. Pointer lock: clicking the canvas requests it;
losing it (Esc, alt-tab) opens the pause menu ("Click to resume"). The initial yaw is the
local player's snapshot angle. Settings (stored in prefs): view 'fps' | 'topdown'
(default 'fps'; a match runs top-down when WebGL 2 is unavailable or the 3D module failed
to load, without changing the stored choice; a change applies from the next game), fov
60–120 (80, see settings.fov above), mouse sensitivity 0.2–3 (default 1.0 ≈ 0.0022 rad/px),
padLook 0.2–3 (right stick and touch look), invert Y, aim assist for gamepad/touch (light
yaw magnetism toward the zombie nearest the crosshair, `look.js` AIM_ASSIST), minimapRotate
(default true). `ui/main.js` imports render3d (three.js, ~1.3 MB) in the background after
the title screen is up; a game that starts before it arrives waits for it (`app.js`).

**First-person look & feel.** Night atmosphere: sky dome with stars/moon, two distant mountain ridges and a dead
city skyline (sparse lit windows, orange glow) over the tree line, fog tinted by
`map.ambient`, dim moonlight + hemisphere light, the local flashlight (SpotLight from the
camera; shadows only on 'high'; a hot centre fading softly to the rim, irradiance capped
inside ~2 m so near walls never wash out — patched into three's light chunk in lights.js), teammates' flashlights as cheap additive cones, map
lights/fires/muzzle flashes/explosions through the fixed light pool (never add/remove
lights at runtime — shader recompiles). Everything procedural (no model or texture files):
PBR materials with generated detail textures (wet asphalt with reflective puddles,
concrete, grass, brick), rounded vehicles with clearcoat paint and glass, buildings with
lit windows, alpha-tested foliage, instanced grass, sculpted zombies/survivors with LODs. Viewmodel: a gun built from `weapons.js` `sprite` params per weapon style,
gloved hands in the class outfit colour, idle sway, walk/sprint bob, recoil kick on each
own `shot` (predicted shots included; `echo` shots ignored), reload dip over
`reloading`, weapon switch lower/raise, melee swing, throw motion, minigun barrel spin,
flamethrower pilot light; drawn in its own pass so it never clips into walls.
Zombies: one InstancedMesh per body part per type (≤ ~60 draw calls for 300 zombies),
walk/run/crawl cycles phased by id, distinct silhouettes per type, flags shown
(burning, attacking lunge, charging, buffed, elite eyes). Performance target: 60 fps at
1080p with 250 zombies on a mid laptop at 'high'; 'low' = no shadows, 4 pool lights,
fewer particles, render scale 0.75; 'ultra' = native resolution (pixel ratio up to 3),
12 pool lights, 2048² flashlight shadows, full-density ground textures, 16x anisotropy,
more particles, denser grass, light rain. Every device defaults to 'ultra' with
renderScale 'auto' (phones included, at the owner's request — they run hot; 'auto' keeps
them playable). Sub-systems treat any quality other than 'low' as high.

**Post-processing & graphics settings** (`render3d/post.js`). The world renders into a
linear half-float target: world → GTAO at half resolution (high/ultra, `ao`) → atmosphere
(high/ultra: `volumetrics` = analytic ground mist drifting in patches + the light pool
scattering in the air, integrated in closed form per light up to the depth, lamps only
below their shade, and on ultra the flashlight beam marched through it — half resolution
on ultra, quarter on high; `reflections` = screen-space reflections on puddles (the ground
shader's own puddle mask rebuilt from depth), wet asphalt (vertical streak blur) and water,
rays that escape picking up the brightest sky pixels they crossed — half res / 28 steps on
ultra, quarter / 16 on high; a depth-aware upsampling composite; 2–3 draw calls) → viewmodel
(depth cleared) → bloom (threshold 1.2, soft knee from ~0.75: glowing things use values
2–6) → grade (ACES + sRGB, contrast/saturation/lift-gamma-gain, `vignette`, `filmGrain`,
dither, and colour fringes + desaturation at the edges while the local player is hurt,
not on low) → SMAA or FXAA (`antialias` 'smaa' | 'fxaa' | 'off'; low forces FXAA unless off)
→ upscale + sharpen when the internal resolution is below 1. `settings.renderScale` is
'auto' (dynamic resolution in 0.05 steps holding 58–60 fps, with hysteresis) or a fixed
0.5–1 fraction of the tier's pixel-ratio cap (ultra min(dpr, 3), high min(dpr, 2), low
0.75 × min(dpr, 1)); the canvas keeps its size and only the internal targets scale. All
settings apply live; an unchanged settings object costs a few comparisons; `render()`
never throws (a failing chain falls back to a direct render, and is dropped after 3
failures). `settings.uiScale` (from the UI) scales the overlay. `r.stats` exposes
drawCalls/triangles (post passes included), sceneCalls/sceneTriangles, fps, renderScale,
pixelRatio and gpuMs (with EXT_disjoint_timer_query_webgl2). UI presets: Ultra (all
effects), High (AO and reflections off), Low (no bloom/AO/grain/volumetrics/reflections,
FXAA); prefs validate every field.
Measured (SwiftShader, 1600x900, 250 zombies + bots fighting): 65–81 draw calls and
235k–295k triangles on 'high', 55 calls / 185k on 'low'; scene update ~3 ms. The world
splits its static meshes into 1600-unit cells (the heavy 'std'/'paint' buckets into 1000 on
a map wider than 6000) and skips any cell or ground tile wholly past the fog (where it
passes < 0.2 % of a surface), so a long map costs about what a short one does: the
7600-wide highway draws 84–104 calls / 385k–540k triangles on 'ultra' at 1600x900 with no
zombies (the old 3600-wide one: 85–107 / 510k–540k). Ground canvases keep a texel budget
per tier (ultra 10 M, high 6 M, low 3 M texels; every other map fits at full density).
The viewmodel is drawn with its own fixed 64° vertical camera (matching the default fov).

**Effects, gore and ambient life** (`effects3d.js`, `fx-core.js`, `fx-decals.js`, `blood3d.js`,
`gore3d.js`, `casings3d.js`, `ambient3d.js`; five effect draw calls in all: particles (alpha),
particles (additive), beams, decals, plus the bird / limb / casing meshes only while they exist).
- **Decals** are quads lying on a surface (a wall's face normal from the map's obstacle
  rectangles, or the ground), lit by the scene lights with the sun's and flashlight's shadows,
  clipped to the top and the ends of the surface they are on. They live in two ring buffers
  (`gore` 1600 / 800 / 160 and `marks` 700 / 360 / 80 on ultra / high / low): the oldest is
  recycled, nothing is allocated. Ageing runs on the GPU from each decal's birth time: pools
  spread over ~5 s, blood dries from bright wet red to a dark crust (~75 s) and loses its gloss,
  drips run down walls, everything fades at the end of its life.
- **Blood.** A hit on flesh sprays the wall / car / ground behind it along the bullet (reach
  by weapon class), splats on it, drips; a corpse pools and leaves a drag smear where it was
  moving; wounded zombies and anyone walking through a fresh pool leave footprints. Heavy
  finishing hits tear a limb off; a zombie that is blown apart (`zdie.gib`) throws limbs, a
  torso and a head (≤ 110 / 64 / 0 pieces), which trail drops, splat and smear as they slide.
- **Impacts by surface**: concrete / stone (chips, dust, pale spall patch), metal (sparks,
  ricochet streaks, dent; a car window shatters into glass), wood (splinters), dirt / sand
  (puffs, clods, grains), water (splash, ring), each with a hole decal (marks ring).
  Shell casings (brass, red shotgun hulls) eject, bounce, tumble and rest for ~40 s
  (≤ 140 / 80 / 22).
- **Explosions** run in stages (flash, fireball, shockwave ring + screen refraction, shrapnel
  streaks, dust ring, black plume and cap, crater and soot decals, lingering embers and a
  smouldering fire); fires shimmer with screen-space heat distortion (post.js).
- **Gore setting** `settings.gore` 'on' | 'low' | 'off' (prefs default 'on', Advanced graphics
  panel, passed to `render()` every frame): low halves the blood and drops limbs and drips; off
  paints dark ash instead of red, no limbs, no drips, and nobody is blown apart (the renderer
  strips `zdie.gib` before the sub-systems see it). The top-down view recolours too.
- **Ambient life** (`ambient3d.js`): dust / pollen motes (day), fireflies over grass (night),
  leaves and paper on a slowly turning wind, ash and embers downwind of fires, rain
  splashes under the night rain (ultra), rare far lightning behind the clouds (night, high /
  ultra) and birds that take off from lamp posts, trees and roofs when gunfire starts (day).
- **Post**: lens flare of the sun / moon (only where the HDR disc is visible), heat and
  shockwave distortion, desaturation as health runs out, per-map night grades
  (`nightGradeFor`), a flashlight cookie with a slight flicker and hand sway.

**GPU rules learned during the build** (every render3d module follows them):
- Never toggle `visible` on a light or add/remove one: that changes the light count and
  recompiles every lit material. Switch a light off with `intensity = 0` (the flashlight
  of a dead player included).
- renderer3d compiles every program at creation (`renderer.compile` on the world and the
  viewmodel scenes, plus one render with shadow casters unculled; cost in
  `r.debug.createMs.warm`). Meshes created later should reuse existing material
  parameters so they hit the program cache.
- Only actors (zombies, teammates, turrets, barricades) cast flashlight shadows; static
  world meshes have `castShadow = false` (a light next to the eye puts their shadow right
  behind them, invisible from the eye, at ~25 % of the triangles).
- A module-level cache of GPU objects shared between renderers must export a release
  function that `destroy()` calls (`releaseSharedGuns()`, `releaseFxAtlas()`; destroy also
  disposes three's shared DFG lookup texture): three's dispose listeners on shared objects
  otherwise keep every finished game's WebGLRenderer and scene alive.
- Ground decal textures upload at most one chunk every 3 frames.
- Rigged actors add glow (eyes, hit flash, burning) and rim light after fog, so eyes and
  silhouettes read through the fog at range.

**Overlay rules.** Off-screen arrows only for downed teammates and for the objective while
it is being hit (4 s after an `objhit`) or below 30 % hp — the compass and radar show the
rest; they sit on a ring around the crosshair ("behind" clamped to the lower sides) so
they never cover the HUD panels, the prompt or the gun. Name tags fade out within 70–160
units of the camera and in the outer 13–21 % of the screen width (the HUD columns); a
teammate within 30 units of the camera is not drawn at all. The shotgun crosshair gap is
capped at 7.5 % of the screen height (a design cap, not the exact spread).

**Audio orientation.** `audio.addEvents/update(…, { x, y, yaw })`: when `yaw` is given,
pan by the angle between the sound and the facing direction and muffle/soften sounds
behind the listener; without `yaw` (top-down) keep screen-relative panning. The listener
is `r.getCamera()` (the spectated teammate's chase camera while dead).

### 7.5.1 Time of day — `settings.time` 'night' | 'day' (`shared/timeofday.js`, `render3d/daylight*.js`)

Every map has a **night** look (the original: moon, stars, darkness, flashlights, lamps and
fires) and a **day** look, a lobby setting next to the mode. Day is cosmetic: the simulation,
bots and balance are identical (`tests/timeofday.test.js` checks it), only the two renderers
change.

**Data and rules.** `DEFAULT_SETTINGS.time = 'night'` (every existing map keeps it).
`shared/timeofday.js`: `TIME_LIST`/`TIME_IDS`, `mapTimes(map)` (a MAP_LIST entry, MapDef or id;
`time: 'day'` = fixed, `times: [...]` = list, none = both), `mapSupportsTime`, `fixTimeCombo(mapId,
time, changed)` (mirrors `fixModeCombo`: picking a map that doesn't play the time switches the time,
picking a time the map doesn't play switches to the first map that does), `resolveTime(map,
requested)` (what a game really plays; `Game` stores it in `game.settings.time`).
**A day-only map** just declares `time: 'day'` in its `MAP_LIST`
entry (or `times: ['day']`); `buildMap` copies it onto the MapDef, `mergeSettings` keeps
map + time compatible, the lobby card shows a "Day only" tag, and both renderers read `map.time`
when no `time` option is given. Settings travel as JSON (`settings` / `start` control messages),
so the time itself needs **no PROTOCOL_VERSION bump** (the protocol is 8 because of the Campaign, §3.8); old peers without a time read `night`. The Campaign (`mode: 'campaign'`) is a daytime game: `buildMap(id, seed, { mode: 'campaign' })` sets `map.time = 'day'`, `mergeSettings` forces `time: 'day'` while the mode is Campaign (the lobby's Time row shows Day, disabled), and the renderers therefore draw the campaign maps with the daylight look. `ui/match.js`
passes `resolveTime(map, session.settings.time)` to `createRenderer(3D)`.

**First person by day** (`ctx.time === 'day'`; `lights.js` `ambientFor(map, time)` returns
`daylight.js` `dayAmbientFor(map)`, whose per-map numbers are plain data in `daylight-look.js`;
a map without an entry gets the default look tinted by its `ambient.tint`):
- **Sky** (`world-sky-day.js`, used by `makeSky` and the reflection probe): gradient dome with a
  pale horizon band that equals the fog colour, HDR sun disc + glow, two moving cloud layers
  (fair-weather clouds lit from the sun's side + thin cirrus), two mountain ridges tinted by the
  haze, optional horizon shimmer. No stars, no moon.
- **Light**: the "moon" DirectionalLight is the sun (low angle, warm, ~4 lux; the same shadow map
  that follows the camera and is re-rendered on demand for the static world, so the cost is the
  night's), a HemisphereLight from the blue sky / warm ground, `scene.environmentIntensity` 0.7 for the
  sky probe. The flashlight is off (and its shadow pass dropped). Street lamps are ~off, fires
  weaker (`fireK`), muzzle flashes and explosions keep 80 %. `sunshadow.js` lays one instanced
  streak per zombie / survivor away from the sun (the sun map only holds the static world).
- **Fog / haze**: exp² fog of the haze colour (0.00022–0.0003: aerial perspective, ~2.5x thinner
  than night), the atmosphere pass runs a thin low mist of the same colour and almost no light
  scattering; puddles and wet asphalt reflect the (capped) sky; ground wetness is per map (`wet`).
- **Grade**: exposure 1.0 (night 1.15), saturation 1.08, light vignette, less grain, bloom 0.2 with a
  1.6 threshold (only the sun and flames glow).
- **World**: lit windows, neon, tubes and lamp heads are multiplied down (dark glass), no lamp halos,
  light shafts or fake light pools (fires and mast beacons keep faint halos), no rain on 'ultra',
  water is teal and reflects the sky, per-map skies (`daylight-look.js`: highway hazy tarmac, truck
  stop bleached desert, bridge cool river valley, checkpoint more cloud, Harlan deep blue with
  cumulus and green haze).
- Cost: same tiers; the far cull distance follows the thinner fog, so the longest views on the
  highway draw ~1.6x the night's calls (about 170 vs 105; triangles 0.78 M vs 0.49 M).

**Top-down by day** (`render/renderer.js`, `time` option): no darkness overlay and no light holes,
one warm haze + vignette gradient; the map preview of a day-only map is drawn without the night tint.

Sandbox: `public/dev/fps-sandbox.html?time=day` (`__fps` views incl. `zone-out` / `zone-in` on an
Evac Run map). Possible follow-up: a `dusk` time (the sun parameters and `lampK` already allow it).

## 8. Deployment
- Static: `public/` can be served by any static host (Netlify: `netlify.toml` publishes
  `public`). Uses the PeerJS cloud for signalling. Friends open the link, host clicks
  Host, shares the invite link.
- Self-hosted: `npm start` runs `server/relay-server.js` (PORT env, default 8080), which
  serves `public/` and a WebSocket relay; the client then prefers the relay (no NAT issues).
- `public/config.js` (optional, loaded before main.js) may set
  `window.HH_CONFIG = { peer: {...}, relayUrl: 'wss://…' }`.

## 9. Testing & CI
- `npm test`: unit tests (`node --test`, Node built-ins and project files only, see §0).
- `npm run e2e` (`scripts/e2e.js`, plain Node): starts `server/relay-server.js` and a local
  PeerJS server on free ports (`E2E_PORT` / `E2E_PEER_PORT` to pin them), then drives headless
  Chromium through ten scenarios in fresh browser contexts (a–f force the classic
  top-down view in localStorage; g and h play first person at quality 'low', 960x540): solo with a scripted player,
  3-player relay game (invite link, roster, chat, settings, movement replication and
  prediction, shot/kill credit, a player leaving, back to lobby via the host's pause-menu
  End Game, second game), late join
  (prep → alive, mid-wave → spectating), p2p via the local PeerJS server (config.js and
  api/info are routed), and a 390x844 touch phone (layout, left stick, SHOP tap buys
  nothing, rotation). Any
  console error or page error fails a scenario; Google Fonts requests are answered
  locally. Screenshots go to `e2e-output/` (gitignored). `E2E_ONLY=a,c` runs a subset.
  Scenario f (bots): Play Solo, Add Bot ×3 (BOT tags), ✕ removes one, the human readies,
  the two bots ready after them and both score kills while the human stands still.
  Scenario a readies up with N and checks that Space lifts the player (Space was 'ready'
  before jumping existed).
  Scenario g (fps-solo, 330 s budget): pointer lock (clicking again if a busy page lets
  the first request lapse), W walks along the view, Space jumps (the view's
  local z and the camera rise, then land), W + Space into the nearest car / van /
  container with a clear run climbs onto it (the climb shows in the view, the player
  stays on the roof and the camera sits ~52 above it), losing the lock opens the
  pause menu, turn toward the nearest zombie through `__HH.look` and kill it, End Game and
  a second game (no leaked overlay canvases). Scenario h (fps-relay): 2 players over the
  relay in first person — each camera sees the other, the client's W moves it along
  its own yaw on the host, and the host sees the client jump. Headless Chromium renders WebGL with SwiftShader (software), so
  g/h are written to hold at a few frames per second.
  Scenario k (campaign, 420 s budget): the lobby's Mode row (three modes), CAMPAIGN badges on
  the three extended maps only, a map without the extension leaving Campaign mode, then Play Solo
  with two bots on Checkpoint Delta (top-down): the stage panel names the hilltop and the team
  stands up the hill, a hill wave; the host's game is driven to the breakout (horde front in the
  snapshot), the door (a FLOOR 1 title card), the roof, the quota (banner, prompt), the local
  survivor rides (E) and the bots after, the end screen says "Escaped"; then a first-person game
  (quality 'low') checks the campaign group in the scene, the hill, floor 1 and the roof heights.
  Scenario i (zone): Play Solo (top-down), the lobby's Mode row and the Evac Run-only Harlan
  County card keep map and mode compatible (the pick wins), two bots; the zone is announced
  (snapshot, zone panel), the player walks toward it with the WASD combination the shared
  movement code says gets closest, the wave locks the circle and the player, still outside,
  gets the warning and loses health to the blight; then a first-person game on Harlan County
  (quality 'low') checks the 3D zone wall on the announced circle, the compass and the panel.
  (Software WebGL draws the big map well under 1 fps here, and a host rendering that rarely
  feeds its own survivor idle input, so the walking part plays top-down.)
  Scenario j (day): the lobby's Time row (Night first, Day, saved in `prefs.lobby.time`, kept across a
  map change), a first-person solo game by day (`ctx.time` 'day', sun on, flashlight off) and a
  top-down one, no console errors.
- `node scripts/balance.js [--quick]` (not a test, not in CI): headless balance harness —
  whole games of bot teams (skilled and average profiles, §3.6) over maps × difficulties ×
  team sizes × seeds on worker threads, reporting per-wave survival, time, damage, downs,
  economy, guns, classes and objective numbers. `--quick` ≈ 2 min on 4 cores. See
  docs/BALANCE.md for the options, the tuning targets and the current tables.
- CI: `.github/workflows/highway-horde.yml` at the repo root (paths `highway-horde/**`)
  runs `npm ci`, `npm test`, installs Chromium and runs `npm run e2e`, uploading
  `e2e-output/` as an artifact. The repo root's own `node --test` also discovers
  `tests/*.test.js` without this folder's node_modules: those tests pass or skip (the
  relay tests skip without `ws`).
