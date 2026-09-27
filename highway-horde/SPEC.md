# Highway Horde — architecture & contracts

Top-down co-op zombie shooter for 1–6 players in the browser. One player hosts, friends
join with a 5-letter room code or an invite link. The host's browser runs the
authoritative simulation; everyone else sends inputs and renders snapshots.

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
- Only runtime dependency in the browser: `public/vendor/peerjs.min.js` (sets
  `window.Peer`). Only server dependency: `ws`. Dev dependencies: `playwright`, `peer`.
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
  public/index.html, public/css/game.css             (ui)
  public/config.js                                   (net — optional overrides, see §8)
  public/vendor/peerjs.min.js                        (vendored, do not edit)
  public/js/shared/constants.js math.js rng.js       (lead — read only)
  public/js/shared/weapons.js zombies.js classes.js items.js  (lead — data, read only)
  public/js/shared/maps.js                           (maps)
  public/js/shared/geom.js spatial.js flowfield.js movement.js sim.js  (sim)
  public/js/shared/protocol.js                       (net)
  public/js/net/*.js                                 (net)
  public/js/render/*.js                              (render)
  public/js/audio/*.js                               (audio)
  public/js/ui/*.js  (main.js, input.js, hud.js, menus, shop, chat, touch, ...) (ui)
  tests/<area>.test.js                               (each owner)
```

Data tables already written (read them — they are the source of truth):
`constants.js` (all tuning numbers), `weapons.js` (18 guns + throwables), `zombies.js`
(8 zombie types, `ZFLAG` bits), `classes.js` (6 survivor classes + perks), `items.js`
(shop items, pickups, drop tables).

---------------------------------------------------------------------------------------

## 2. Maps — `shared/maps.js`

```js
export const MAP_LIST;              // [{ id, name, description }] in lobby order
export function buildMap(id, seed); // → MapDef, deterministic for (id, seed); unknown id → throws
```

Four maps (ids fixed): `highway` (Highway 9 Pileup), `truckstop` (Last Chance Truck Stop),
`bridge` (Blackwater Bridge), `checkpoint` (Checkpoint Delta).

```js
MapDef = {
  id, name, width, height,               // world size, 2400..4000 x 1600..3000
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
                                         // s = scale (1 = normal)
  lights: [ { x, y, r, color, flicker } ],// static light sources (street lamps, burning wrecks);
                                         // flicker = 0..1 amplitude (0 = steady). A lit 'lamp_post'
                                         // decor has a light at exactly the same x, y.
  fires: [ { x, y, r } ],                // permanent burning spots (cosmetic flames + light; no damage)
  playerSpawns: [ {x, y} ],              // >= 6 clear points near the objective
  zombieSpawns: [ { x, y, w, h } ],      // rectangles near the map edges where zombies appear
                                         // (x, y = centre, like every other rect in the MapDef)
  objective: { kind, name, x, y, w, h, a, hp },  // thing the team defends; also a collider
                                         // kind: 'bus'|'diner'|'apc'|'radio'
  supply: { x, y },                      // supply station (ammo crates + shop mid-wave)
}

Obstacle = {
  id,                                    // index in obstacles array
  kind,                                  // 'car'|'suv'|'pickup'|'van'|'truck'|'semi'|'bus'|'tanker'
                                         // |'barrier'|'sandbags'|'building'|'wall'|'container'
                                         // |'pump'|'tree'|'rock'|'hesco'|'tent'|'booth'|'guardrail'|'pillar'
  x, y, w, h, a,                         // oriented rectangle: centre, full width/height, angle
  color,                                 // body colour (vehicles/buildings)
  solid,                                 // true = blocks bullets/beams/projectiles; false = low cover
  wrecked,                               // vehicles: burnt-out look
  roof,                                  // buildings: roof colour
}
```

Kind conventions used by maps.js (renderers rely on them): 'semi' is both the cab
(length ≤ 100) and the trailer (240 long) of a rig; 'tanker' is the tank body with a
'semi' cab; 'bus' is also used for RVs (draw with the obstacle colour, not always school-bus
yellow); 'container' also covers dumpsters, a propane cage and a generator; 'wall' with
h ≤ 8 is a thin fence (solid:false), thicker is masonry; 'pillar' = canopy posts; 'tree' is
the trunk with a 'tree_canopy' decor centred on it. Crosswalk lines run across the road
and `w` is the stripe length. `roof` is null for kinds without a roof. Water areas are
axis-aligned. Map sizes are within 2400..4000 x 1600..3000 (checkpoint is 3000 x 3000).

Rules: every `playerSpawn` and the `supply` point must be reachable from every
`zombieSpawn` for a 28 px-diameter walker; nothing spawns inside an obstacle or water;
the objective sits roughly central with open ground around it; 60–160 obstacles per map.
Guard rails, barriers and sandbags are `solid: false` (shots pass over them).

---------------------------------------------------------------------------------------

## 3. Simulation — `shared/sim.js` (+ geom, spatial, flowfield, movement)

### 3.1 API

```js
import { Game } from './sim.js';
const game = new Game({
  mapId, seed,                            // map built internally with buildMap(mapId, seed)
  settings: { difficulty, waves, objective, friendlyFire },   // see DEFAULT_SETTINGS
  players: [ { id, name, color, cls } ],  // id: 1..255 (host = 1), color: 0..5, cls: CLASS_IDS
});
game.map                  // MapDef
game.tick                 // ticks simulated so far
game.addPlayer({ id, name, color, cls })   // late join: mid-wave enters 'dead' and respawns at the
                          //   wave clear; during prep/intermission enters alive. Gets
                          //   wave × WAVE_CLEAR_BONUS catch-up cash.
game.removePlayer(id)
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
export function stepPlayerMovement(p, cmd, dt, world);
```
`p` needs `{ x, y, state, stamina, sprintLock, speedMult, moveMult }` (+ optional
`staminaMult`, class perk: drain ÷ it, regen × it) and is mutated
(x, y, stamina, sprintLock, sprinting). `speedMult` comes from the class perk,
`moveMult` from the held weapon. Players collide with static obstacles (solid or not),
water, the objective, barricades and the map bounds — **not** with zombies or other
players (so client prediction can be exact). Downed players move at DOWNED_SPEED and
cannot sprint. The host sim must use this very function for player movement.

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
}
```
Host applies one cmd per player per tick. If a player's queue is empty it repeats the
last cmd **with edge fields cleared**. If more than 6 are queued it drops the oldest
(but keeps any edge flags by OR-ing them into the next cmd).

### 3.4 Gameplay rules the sim implements

**Phases.** `prep` (PREP_TIME s, shop open) → `wave` → `intermission` (INTERMISSION_TIME s,
shop open, skipped early when every connected player sent `{type:'ready'}`) → `wave` → …
After the last wave (settings.waves, 0 = endless) is cleared → `victory`. Everyone
dead/downed at once (no one standing) → `gameover` (reason 'wiped'). Objective hp 0 while
settings.objective → `gameover` (reason 'objective'). The objective takes no damage and
isn't targeted when settings.objective is false. Game over/victory are terminal.

**Waves.** Zombie count for wave w:
`round((12 + 6w) * (1 + 0.6 * (players - 1)) * difficulty.count)`. Spawned over time at
the map's zombieSpawns, preferring spawn rectangles farther than 700 px from every living
player, never more than `difficulty.maxAlive` alive at once. Type picked by
`ZOMBIES[type].weight(w)`. 2% of non-boss spawns from wave 4 are ELITE (1.6x hp, +20% speed).
Every BOSS_EVERY-th wave also spawns `ceil(players / 3)` bosses about 10 s in.
HP scale: `hp * (1 + HP_GROWTH_PER_WAVE*(w-1)) * difficulty.hp`; speed scale capped at
SPEED_GROWTH_CAP; damage × difficulty.damage. `remaining` = alive + not yet spawned.
Wave clear → WAVE_CLEAR_BONUS cash to every connected player, dead players respawn
(RESPAWN_HP, pistol + their class weapon restored if they have no guns, cash kept) at a
playerSpawn, downed players are revived, and one weapon `crate` pickup drops near the
supply station.

**Zombie AI.** A flow field (grid NAV_CELL, 8-neighbour Dijkstra, rebuilt every
NAV_REBUILD_INTERVAL) toward all alive + downed players, living turrets, and (if enabled)
the objective. Obstacle cells impassable; barricade cells cost ×8 (zombies prefer to go
around but will smash through). Each zombie follows the field; within 200 px of its
current target (nearest of player/turret/objective with line of movement) it steers
directly at it. Separation via `spatial.js` grid so crowds spread instead of stacking.
In attack range it attacks at attackRate (damage to player: armour absorbs ARMOR_ABSORB
of it while armour lasts; to turrets/barricades/objective: raw). A zombie that bumps
into a barricade attacks the barricade. Specials: see comments in `zombies.js`
(bloater burst, spitter acid lob + pool, screamer buff, brute charge, boss slam).
Burning zombies take burn dps and run 15% faster.

**Players.** Classes from `classes.js` set maxHp, start armour, weapons, perks.
Slots: 3 (`WEAPON_SLOTS`). Start: slot0 pistol, slot1 class weapon, slot2 empty, cash
START_CASH. Firing: while `fire` is held and cooldown elapsed and mag > 0 and not
reloading. Empty mag + fire → auto-reload (emit 'empty' once). `reload` edge starts a
reload (reload time × perks.reloadMult); switching weapons cancels a reload. Minigun
needs `spinup` seconds of holding fire first. Hitscan: `pellets` rays with random spread,
each ray stops at the first `solid` obstacle, damages up to `pierce` zombies along it
(sorted by distance), damage × falloff × perks.damageMult, knockback. Friendly fire off
by default (on: 25% damage to players, never downed by it). `chain`/`rail`/`flame`/
`projectile` per weapons.js. Explosions: damage falls off linearly to 30% at the edge,
× perks.explosiveMult, hurt players at 35% (unless selfExplosionImmune and own), blocked
by solid obstacles (ray from centre). Melee: cone MELEE_ARC/MELEE_RANGE, MELEE_DAMAGE and
MELEE_KNOCKBACK (× meleeMult), cooldown MELEE_COOLDOWN. Frag (G): thrown at THROW_SPEED
toward the aim, bounces off obstacles, explodes after fuse. Molotov (F): shatters on
first obstacle/zombie contact or after 0.9 s, leaving a 'fire' hazard. Turret (T) /
barricade (C): placed BARRICADE.placeDistance in front if the spot is clear, requires an
owned unit (bought in the shop). Turrets auto-target the nearest zombie in range with
line of sight, have `ammo`, hp, can be destroyed. Medic heal aura regenerates teammates.

**Downed / revive.** hp ≤ 0 → 'downed' (emit 'down'), BLEEDOUT_TIME countdown, can move
at DOWNED_SPEED and fire only the pistol (slot 0 if it holds a pistol-category gun,
otherwise a free infinite pistol). A living teammate holding `interact` within
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
pistol + class weapon. Hits on downed players cost 0.12 s of bleedout per damage point.
Explosions hurt players at 35%; explosiveMult only boosts damage to zombies. Molotov fire
hurts players only with friendly fire (25%). Bosses bypass maxAlive; boss hp multiplier
per zombies.js (`hpBase + hpPerPlayer × players`). Heavies (bloater, brute, boss) crash
through low cover (solid:false). Zombies weigh the objective as farther away than it is,
so they prefer nearby players and chew on the objective when nobody is close.
**In a one-player game the survivor starts with a Self-Revive Kit** (solo would otherwise
end at the first knock-down).

### 3.5 Required tests (`tests/sim.test.js`, `tests/movement.test.js`, `tests/flowfield.test.js`)
- Determinism: two Games with the same seed and scripted inputs produce identical snapshots
  after 3000 ticks.
- Every map: zombies spawned at every zombieSpawn reach a player within 60 s of sim time
  (no zombie permanently stuck), and a scripted bot team with good guns clears waves 1–3.
- Wave flow, downed → revive, bleedout → dead → respawn on wave clear, game over when
  wiped, objective destruction, buy validation, each weapon kind damages zombies, bloater
  burst, spitter pool, brute charge, boss slam, turret kills credit the owner.
- Perf: 250 zombies + 6 bot players, 600 ticks, average `step()` under 4 ms in Node.

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
  } ],
  zombies: [ { id, type, x, y, angle, hp /*0..1*/, flags /*ZFLAG bits*/ } ],
  projectiles: [ { id, kind /*PROJECTILE_KINDS*/, x, y, angle } ],
  pickups: [ { id, kind /*PICKUP_KINDS*/, x, y, weapon /*crate gun id or null*/ } ],
  turrets: [ { id, owner, x, y, angle, hp /*0..1*/, ammo /*0..1*/, firing } ],
  barricades: [ { id, owner, x, y, angle, hp /*0..1*/ } ],
  hazards: [ { id, kind /*'fire'|'acid'*/, x, y, r, life /*0..1 remaining*/ } ],
  events: [ GameEvent ],
}
```
Entity ids are uint16, unique per entity type among live entities (they may be reused
after the entity is gone). Name/colour/class live in the roster (§6), not the snapshot.

### 4.1 GameEvent — `{ type, ... }`

All events carry the fields listed; consumers ignore unknown types.

| type | fields | meaning |
|---|---|---|
| `shot` | pid, turret, weapon, x, y, angle, rays: [{x, y, hit}] (+ `predicted` / `echo`, see below) | a gun fired. `pid` = shooter (0 if turret), `turret` = turret id (0 if player; turret shots use weapon 'rifle'). rays = end point of every pellet/beam/tracer; hit: 0 nothing/max range, 1 flesh, 2 obstacle. Projectile/flame/chain weapons send `rays: []`. |
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
| `drop` | x, y | supply crate landed |
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
u8. Weapon/zombie/projectile/pickup kinds as indices into the arrays in the data files.
Events may be packed as compact JSON (with numbers rounded to 1 decimal) inside the
buffer. A 6-player, 250-zombie snapshot with ~60 events must stay under 14 KB. First byte
of every binary message is a message-type tag so snapshots and inputs can share a channel.
Tests (`tests/protocol.test.js`): round-trip every field, every event type, empty arrays,
max sizes, and a snapshot produced by the real `Game` after a few hundred ticks.

## 6. Networking — `public/js/net/*`

### 6.1 Transports (implementation detail of net)
- **p2p** (`transport-peer.js`): PeerJS. Host peer id = `PEER_ID_PREFIX + code`. Two
  DataConnections per client: `ctl` (reliable, serialization 'json') for control messages
  and `state` (reliable:false → unordered, serialization 'raw') for binary snapshots/inputs.
  Signalling server defaults to the public PeerJS cloud; `window.HH_CONFIG.peer` (from
  `public/config.js`) may override host/port/path/secure/key and `config.iceServers`
  (TURN). JSON messages must stay under 16 KB.
- **relay** (`transport-relay.js` + `server/relay-server.js`): WebSocket to our own Node
  server at `/relay`, which forwards frames between room members. Available only when the
  page is served by the relay server (`GET api/info` → `{ relay: true }`).
- **local** (`transport-local.js`): in-memory, for solo play and tests.
- `auto` = relay when available, else p2p.

### 6.2 Session API (used by the UI) — `net/session.js`

```js
export async function getServerInfo()   // → { relay: boolean }
export async function hostGame({ name, color, cls, transport })  // → Session (resolves when joinable)
export async function joinGame({ code, via, name, color, cls })  // → Session; rejects Error(msg)
                                        // msgs: 'Room not found', 'Room is full',
                                        // 'Game version mismatch', 'Could not connect'

session.isHost, session.localId, session.code, session.inviteUrl, session.transport
session.roster      // [{ id, name, color, cls, ready, ping, host }]  (lobby + in game)
session.settings    // { mapId, difficulty, waves, objective, friendlyFire }
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
session.drainEvents()                 // → GameEvent[] due for presentation (client releases
                                      //   each snapshot's events when render time reaches it)
session.getMap()                      // MapDef of the running game
session.getPredictedLocal()           // {x, y, angle} of the local player right now (for aim)
session.stats                         // { ping, fps?, kbpsIn, kbpsOut, snapshotsPerSec }
session.leave()
session.kick(pid)                     // host only
   // Extras: returnToLobby() works at any time (host "end game"); getView()/drainEvents()
   // use the session's own clock (performance.now) whatever `now` is passed; decoded
   // snapshots may carry `match` and `echo` (netcode internals, ignore them).
```
Host: runs `Game`, stepping with a real-time accumulator driven by a Worker-based ticker
(`net/ticker.js`) so the game keeps running when the host's tab is in the background.
Snapshots every SNAPSHOT_EVERY ticks. Host's own input goes straight into
`game.setInput`. Handles hello/version check, MAX_PLAYERS, names made unique, colours
kept distinct where possible, chat relay, ping measurement, late join, player leave.
Client: fixed-step 60 Hz input sampling; each cmd applied to a local predicted copy of
the player via `stepPlayerMovement` and sent (with the previous 3 for redundancy) every
frame; on snapshot, reconcile from `lastSeq` and replay pending cmds; smooth visual
correction. Local shots may be shown immediately (cosmetic prediction) — then the
host's `shot` events for the local player must not be shown a second time.
Edge-triggered input (reload, frag, …) pressed in a frame that produces no tick must be
carried into the next produced cmd (never lost, never duplicated).

## 7. Client (browser)

### 7.1 Renderer — `render/renderer.js`

```js
export function createRenderer(canvas, { map, quality })  // quality 'high'|'low'
r.render(view, { localId, roster, now, dt, cursor /*{x,y} screen px*/, settings })
   // settings: { screenShake: bool, showNames: bool, lighting: bool }
r.addEvents(events, { localId })     // particles, decals, tracers, shake, hit markers
r.screenToWorld(sx, sy) → {x, y}
r.worldToScreen(x, y)  → {x, y}
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
vignette for the local player.

### 7.2 Input — `ui/input.js`
```js
export function createInput(canvas)
input.sample() → InputState      // call once per frame; edges reported once
input.setEnabled(bool)           // false while typing in chat / in menus
input.cursor                     // {x, y} screen px
InputState = { moveX, moveY, aimScreenX, aimScreenY, fire, melee, sprint, interact,
               reload, frag, molotov, turret, barricade, lastWeapon, slot, cycle,
               shop, scoreboard, chat, ready, pause }   // last five are UI edges/helds
```
Keyboard + mouse (WASD/arrows, mouse aim, LMB fire, RMB/V melee, Shift sprint, E
interact, R reload, 1/2/3 slots, wheel cycle, Q last weapon, G frag, F molotov,
T turret, C barricade, B shop, Tab scoreboard (held), Enter chat, Space ready, Esc menu),
gamepad (standard mapping, right stick aim), touch (twin virtual sticks + buttons).
`session.update(dt, input, aimAngle)` receives the InputState plus the aim angle, which
the UI computes as the angle from `session.getPredictedLocal()` to
`renderer.screenToWorld(input.aimScreenX, input.aimScreenY)`.

### 7.3 HUD & UI — `ui/*`
Screens: title (name, class picker with portraits, colour), host / join (code field,
join via link `?join=CODE` [&via=relay]), lobby (roster with class/colour/ready/ping,
host controls: map with preview, difficulty, waves, objective toggle; invite link copy;
chat; start), in-game (canvas + HUD + chat + shop modal + scoreboard + pause/settings),
end screen (victory/game over with per-player stats; host "Back to lobby"), settings
(volume, quality, lighting, screen shake, name tags), how-to-play.
HUD: health/armour/stamina, weapon slots with ammo, cash, wave + remaining + phase timer,
objective hp, boss hp bar, teammate list (hp, state, bleedout), minimap, kill feed, chat,
interaction prompts ("Hold E to revive Doc"), shop hint, notices (wave start, wave
cleared +$250, "Sparks is down!"), ping/fps (toggle).
`window.__HH = { session, renderer, hud, getView }` debug hook for end-to-end tests.

### 7.4 Audio — `audio/audio.js`
```js
export function createAudio()
audio.unlock()                               // on first user gesture
audio.addEvents(events, { x, y, localId })   // positional (pan + distance falloff)
audio.update(view, { localId, dt })          // loops: minigun spin, flamethrower, horde
                                             // ambience by nearby zombie count, low-hp heartbeat
audio.ui(name)  // 'click'|'hover'|'buy'|'deny'|'chat'|'join'|'leave'|'wave'|'waveclear'
                //  |'gameover'|'victory'|'countdown'|'ready'
audio.setVolume({ master, sfx, music })      // 0..1
audio.setMuted(bool)
audio.setMap(map)                            // permanent map fires crackle when nearby
// addEvents/update listener: opts {x, y} is the camera centre (the spectated teammate
// while dead). ui() is for menu/lobby sounds; in-game stingers come from events
// (audio dedupes overlaps anyway).
```
All sound synthesised with WebAudio (no files). Voice limiting (max ~24 concurrent,
per-sound rate limits) so a minigun into a horde doesn't clip. Music: optional
procedural low drone/percussion that intensifies during waves and boss fights.

## 8. Deployment
- Static: `public/` can be served by any static host (Netlify: `netlify.toml` publishes
  `public`). Uses the PeerJS cloud for signalling. Friends open the link, host clicks
  Host, shares the invite link.
- Self-hosted: `npm start` runs `server/relay-server.js` (PORT env, default 8080), which
  serves `public/` and a WebSocket relay; the client then prefers the relay (no NAT issues).
- `public/config.js` (optional, loaded before main.js) may set
  `window.HH_CONFIG = { peer: {...}, relayUrl: 'wss://…' }`.
