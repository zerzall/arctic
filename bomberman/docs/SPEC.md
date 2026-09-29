# BLAST PARTY — Technical Spec (v1)

A Bomberman-style battle game for 2–8 fighters (humans and bots) that runs in any modern
browser — phones included — and is played online with a 4-letter room code.
Original name, characters and art (this is *not* a Konami product; never use the word
"Bomberman" in the UI, only in the README as "a Bomberman-style game").

**This document is the contract between agents that write code in parallel.** If code and
spec disagree, the spec wins unless `docs/PROTOCOL.md` (written by the core agent, and more
detailed) says otherwise. If something here is ambiguous or wrong, pick the simplest
reasonable reading, write it down in your file's header comment, and report it.

---------------------------------------------------------------------------------------------

## 0. Non-negotiables

1. **Server-authoritative.** Clients send inputs; the server simulates; nobody can cheat by
   editing local state. Malformed / hostile messages must never crash or stall a room.
2. **Feels instant.** Local player movement is client-predicted with reconciliation
   (§7). 60 Hz fixed simulation, 20 Hz snapshots, ~100 ms interpolation for everything else.
3. **Zero build step.** Plain ES modules (`"type":"module"`), no bundler, no TypeScript, no
   framework. One runtime dependency: `ws`. Node ≥ 22 server; evergreen browsers + iOS
   Safari 16+ and Android Chrome for clients.
4. **Shared code is isomorphic.** Everything in `shared/` runs unchanged in Node and in the
   browser (no `fs`, no `process`, no DOM, no `Buffer`; only `performance.now()` /
   `Math` / standard JS). The server serves `shared/` to the browser at `/shared/…`.
5. **Deterministic sim.** `World` uses only its own seeded RNG (`shared/rng.js`, mulberry32),
   never `Math.random()` / `Date.now()`, iterates in a stable order, and produces identical
   results in Node and browsers (plain IEEE doubles — no `Math.sin` etc. in sim paths).
6. **Family-friendly & robust:** a room must survive players joining/leaving/reconnecting at
   any moment, flaky mobile networks, backgrounded tabs, and 8 people mashing buttons.
7. **Beautiful.** Procedural vector art (no image assets), juicy effects, smooth animation,
   readable at phone size. Sound is synthesized (WebAudio) — no audio files.
8. **Testable.** Every module has tests under `specs/`; see §13.

---------------------------------------------------------------------------------------------

## 1. Repo layout & file ownership

All game code lives in `bomberman/` of the `arctic` repo (self-contained; do not touch files
outside it except where §14 says so).

```
bomberman/
  package.json              (exists)  scripts: start, dev, test, test:e2e, share
  README.md                 how to play / host / deploy                        [docs agent]
  Dockerfile  fly.toml  .dockerignore                                         [ops agent]
  docs/SPEC.md              this file
  docs/PROTOCOL.md          exact wire formats, event list, snapshot keys       [core agent]
  shared/                   ISOMORPHIC — runs in Node and browser
    constants.js            every tunable number & enum                         [core]
    rng.js                  mulberry32 + helpers (int, pick, shuffle)           [core]
    mapgen.js               generateMap(): grid, spawns                         [core]
    world.js                World (one round), movePlayer(), snapshot()         [core]
    protocol.js             message constants, parseClientMessage(), sanitizers [core]
    bots.js                 BotBrain                                            [bots]
    room.js                 Room (lobby + match state machine), transport-free  [server]
  server/
    index.js                boot: env config, HTTP+WS, graceful shutdown        [server]
    http.js                 static files, /healthz, security headers            [server]
    lobby.js                RoomManager: codes, create/find/cleanup, limits     [server]
    ws.js                   ws adapter → Room connection objects                [server]
  client/
    index.html  manifest.webmanifest  css/style.css                             [ui]
    js/ui.js                DOM screens (title, lobby, HUD, results, chat)      [ui]
    js/sprites.js           procedural sprite atlas/cache                       [art]
    js/render.js            arena canvas renderer + camera/shake                [render]
    js/particles.js         particle & effect system                            [render]
    js/audio.js             WebAudio sfx + music                                [audio]
    js/input.js             keyboard, touch, gamepad → intent                   [client]
    js/game.js              ClientGame: snapshots, interpolation, prediction    [client]
    js/net.js               WebSocketConnection + LoopbackConnection            [client]
    js/main.js              boot + glue (UI ⇄ net ⇄ game ⇄ render ⇄ audio)      [client]
  specs/
    unit/*.spec.js          node:test unit specs (fast, no network)
    integration/*.spec.js   node:test with real `ws` clients
    e2e/*.e2e.mjs           Playwright (headless Chromium), not part of `npm test`
    helpers/*.js            shared test helpers
  scripts/share.js          `npm run share`: start server + public tunnel       [ops]
  ../render.yaml            (repo root) Render blueprint, rootDir: bomberman    [ops]
  ../.github/workflows/bomberman.yml   CI for bomberman/**                      [ops]
```

**Test file naming rule (important):** the repo root's `npm test` is `node --test` with
auto-discovery and *must not* pick up our specs. So: no directory named `test/`, no file
named `test.js`, `test-*.js`, `*.test.js`, `*_test.js` or `*-test.js` anywhere under
`bomberman/`. Use `specs/**/*.spec.js`. `bomberman/package.json` runs them with
`node --test "specs/unit/**/*.spec.js" "specs/integration/**/*.spec.js"`.

---------------------------------------------------------------------------------------------

## 2. Vocabulary

| Term | Meaning |
|---|---|
| tile | integer cell `(tx,ty)`, `0≤tx<15`, `0≤ty<13`; row-major index `ty*W+tx` |
| position | floats `(x,y)` in tile units. Tile `(tx,ty)` spans `[tx,tx+1)×[ty,ty+1)`, centre `(tx+.5,ty+.5)` |
| tick | one 1/60 s simulation step (`DT = 1/60`) |
| dir code | `0` none, `1` up, `2` right, `3` down, `4` left  (used in cmds) |
| facing | `0` up, `1` right, `2` down, `3` left (= dir code − 1) |
| grid | string of `W*H` chars: `.` floor, `#` hard wall, `+` soft block, `X` sudden-death wall (hard) |
| slot | spawn position index 0–7 |
| fighter | a human or bot taking part in the current round |

Item kinds (string ids): `bomb`, `flame`, `speed`, `kick`, `glove`, `shield`, `skull`.
Curse kinds: `slow`, `rush`, `reverse`, `nobomb`, `spam`.
Themes: `meadow`, `frost`, `lava`, `candy`, `night`.
Bot levels: `easy`, `normal`, `hard`.
Player colors: indices `0..7` (see §9 for names/hues). Teams: `0` and `1` (only in team mode).

---------------------------------------------------------------------------------------------

## 3. Rules & constants (`shared/constants.js` is the single source — export all of these)

```
TICK_RATE 60         DT 1/60          SNAP_EVERY 3 (→ 20 Hz snapshots)
GRID_W 15            GRID_H 13        MAX_PLAYERS 8     MIN_TO_START 2 (humans+bots)
PLAYER_HALF 0.34     // half-size of the square hitbox, tiles
BASE_SPEED 3.6       SPEED_STEP 0.5   MAX_SPEED_LV 6     // tiles/s = 3.6 + 0.5*lv (max 6.6)
START_BOMBS 1        MAX_BOMBS 8      START_RANGE 2      MAX_RANGE 10
FUSE_TICKS 150       // 2.5 s
FLAME_TICKS 36       // 0.6 s a flame tile stays lethal
KICK_SPEED 9         // tiles/s a kicked bomb slides
THROW_DIST 3         THROW_TICKS 26    // glove throw: lands 3 tiles away after 26 ticks
KICK_ALIGN 0.35      // max perpendicular offset (tiles) from lane centre to kick a bomb
SHIELD_TICKS 480     // 8 s (item)      SPAWN_SHIELD_TICKS 120 (2 s after GO)
CURSE_TICKS 600      // 10 s            CURSE_TOUCH_RADIUS 0.7   CURSE_XFER_COOLDOWN 60
CURSE_SLOW_SPEED 1.6 CURSE_RUSH_SPEED 8.5   SPAM_INTERVAL 24 (ticks between auto-bombs)
COUNTDOWN_TICKS 210  // 3,2,1 (60 each) + GO (30)
ENDING_TICKS 150     // 2.5 s after the round outcome is locked
DEATH_ANIM_TICKS 60
SD_INTERVAL 5        // ticks between sudden-death tiles starting to fall
SD_WARN_TICKS 36     // a falling tile is telegraphed this long before it lands
INTERP_TICKS 6       // client render delay (100 ms)
INPUT_QUEUE_MAX 40   INPUT_CATCHUP_AT 4   // server-side cmd queue (see §7)
MAX_NAME 14          MAX_CHAT 120
```

**Spawn slots** `(tx,ty)` in priority order: `0:(1,1) 1:(13,11) 2:(13,1) 3:(1,11) 4:(7,1) 5:(7,11)
6:(1,6) 7:(13,6)`. With N fighters use slots `0..N-1`, then shuffle who gets which (seeded).
A player spawns at the centre of the slot tile.

**Starting stats:** 1 bomb, range 2, speed level 0, no kick, no glove, no shield, no curse.

**Item drop weights** when a soft block is destroyed (probability of *any* drop comes from the
`items` setting: none 0 / few .22 / normal .42 / many .65):
`bomb 22, flame 22, speed 14, kick 8, glove 7, shield 6, skull 8` (weights, not percent).
Effects: `bomb` +1 capacity (≤8), `flame` +1 range (≤10), `speed` +1 level (≤6), `kick` sets kick,
`glove` sets glove, `shield` sets shield ticks to `SHIELD_TICKS`, `skull` gives a random curse
(replacing any current one; picking up a skull while cursed re-rolls it).

### 3.1 Map generation (`mapgen.js`)

`generateMap({ layout, blocks, seed/rng, numSlots })` → `{ grid, spawns:[{tx,ty}×8] }`.

* Border ring is `#`. **classic** layout: interior `#` pillars at every `(tx,ty)` with both `tx` and
  `ty` even. **open** layout: pillars only where `tx%4==2 && ty%4==2` (so `(2,2),(6,2),(10,2),(2,6)…`), plus none
  elsewhere — a wide-open brawl.
* Soft blocks `+` fill each remaining floor cell with probability `few .50 / normal .72 / many .90`, **except** the
  *spawn safe zone*, which stays floor. Always all 8 slots are protected (whatever the player count) so the board is fair.
  **Safe zone = every non-wall cell within Manhattan distance ≤ 2 of a slot tile.** (Around a corner spawn that is an
  L-shape that can never be a trap.)
* Guarantees (tested): border complete; pillars exactly per layout; all 8 spawn tiles are floor;
  safe zones contain no `+`; with density `many` every spawn can reach every other spawn *if
  all `+` are removed* (i.e. hard walls never partition the board); result is a pure function of
  the seed.

### 3.2 Round lifecycle (inside `World`)

States: `countdown` → `playing` → `ending` → `over`.

* `countdown` (COUNTDOWN_TICKS): players frozen at spawns; cmds ignored. Snapshots flow so clients see the arena.
* `playing`: normal rules. Round timer = `roundTime*60` ticks (0 = unlimited & no sudden death).
  Everyone gets `SPAWN_SHIELD_TICKS` of shield when `playing` starts (visible, blinking).
* **Sudden death** when the timer hits 0 and `suddenDeath` setting is on: `world.suddenDeath=true`;
  every `SD_INTERVAL` ticks the next tile of a precomputed inward **spiral** (ring by ring from the
  outside, over every cell that is not `#`/`X`) becomes *falling*; `SD_WARN_TICKS` later it
  *lands*: cell becomes `X`, anything on it (player — **even shielded**, bomb, item, flame) is destroyed
  (bomb removed without exploding; player killed with `killer=-1`). Sudden-death completes in
  bounded time, so every round ends.
* **Outcome lock:** at the end of any tick, if fighters alive form ≤ 1 team (FFA: ≤ 1 fighter),
  the outcome locks *that tick*: `winnerId` (FFA) / `winnerTeam` (teams) or draw if nobody is alive.
  State → `ending` for ENDING_TICKS; survivors get infinite shield (they may still walk); flames/bombs keep
  resolving; then `over`. In teams mode all remaining team members win together.
* A fighter that is removed mid-round (human left) dies silently (`killer=-2`, event `left`).

### 3.3 Players in the sim

Player fields (public on `world.players[id]`; `id` = small int assigned by the Room, stable for the match):
`id, name, color, team, isBot, slot, x, y, facing, moving, alive, bombsMax, range, speedLv, kick,
glove, shield (ticks), spawnShield, curse (kind|null), curseTicks, curseCooldown, lastSeq,
deathTick, stats {kills, deaths, selfKills, blocks, items}`.

### 3.4 Cmd (input for one tick)

`cmd = { s: seq, d: 0..4, b: 0|1, x: 0|1 }` — `s` monotonically increasing int per player (the
client's tick counter, wraps never in practice), `d` dir code (client resolves multi-key input to
one direction; last pressed axis wins; no diagonals), `b` = "bomb pressed *this tick*" (edge, the
client latches taps so none are lost between ticks), `x` = "special pressed this tick" (edge).
`World.applyCmd(id, cmd)`:
1. ignored unless state is `playing` (or `ending` and player alive) and the player is alive;
   `lastSeq = cmd.s` is **always** updated (even when ignored) so clients can ack.
2. curse `reverse` flips `d` (1↔3, 2↔4). `slow`/`rush` override speed; `nobomb` blocks `b`;
   `spam` auto-places a bomb whenever possible every SPAM_INTERVAL ticks.
3. `movePlayer(p, d, env)` (below).
4. `b`: place bomb (below). `x`: glove action (below).

### 3.5 `movePlayer(p, d, env)` — the ONE movement function (shared by server and client prediction)

`env = { W, H, isSolid(tx,ty,p) → boolean }` where `isSolid` is true for `#`,`X`,`+` and for a
non-flying bomb tile unless the bomb lists `p.id` in its `pass` array. Pure w.r.t. `p` (mutates
only `p.x,p.y,p.facing,p.moving`); returns `{ moved: boolean, blocked: boolean }`.

```
if d==0: p.moving=false; return {moved:false, blocked:false}
p.facing=d-1; step = effectiveSpeed(p)*DT;  axis = (d==2||d==4) ? x : y;  sgn = (d==2||d==3) ? +1 : -1
perp = the other coordinate;  lo = floor(perp-HALF+EPS), hi = floor(perp+HALF-EPS)   // 1 or 2 lanes
newPos = axisPos + sgn*step
edgeNew = newPos + sgn*HALF ;  edgeOld = axisPos + sgn*HALF
tileNew = floor(edgeNew) ; tileOld = floor(edgeOld)  (use EPS so touching a boundary counts as *not yet* inside)
if tileNew==tileOld or none of {tiles at (tileNew, lo..hi)} is solid → axisPos=newPos; moved
else if lo!=hi and exactly one of the two lane tiles at tileNew is free and floor(perp)==that free lane
        (player centre is already over the free lane):
     slide: perp moves toward that lane's centre by min(step,|delta|); axisPos unchanged; moved (perp only)
else: clamp axisPos flush against the solid tile (tileNew - sgn side, offset by HALF+EPS); blocked=true
```
`EPS = 1e-6`. After the move `p.moving = moved`. Corner-slide gives the classic "glide around the
corner" feel. Diagonal input does not exist. **Kick** is handled by `World.applyCmd` after
`movePlayer` returns `blocked`: if `p.kick`, the blocking tile at the player's centre lane is a
*stationary* bomb, `|perp offset from lane centre| ≤ KICK_ALIGN`, and the tile beyond the bomb is free
(not solid, no other bomb) → bomb starts sliding in direction `d`. Emits event `kick`.

### 3.6 Bombs

* Place (`b`): tile = `(floor(p.x),floor(p.y))`; allowed if bombs owned & alive < `bombsMax`, tile has no bomb and is not solid.
  Bomb: `{id, owner, tx/ty→x,y (centre), range (owner's range NOW), fuse: FUSE_TICKS, dir:0, pass:[ids of every
  fighter whose hitbox overlaps that tile now], fly:null}`. Each tick a bomb removes from `pass` every id whose hitbox no
  longer overlaps the bomb's tile (`|px-cx| < .5+HALF && |py-cy| < .5+HALF`). Bomb ids are increasing ints.
* Sliding (kicked) bomb: moves `KICK_SPEED*DT` per tick along `dir` and stops (snapping to the tile centre) when the *next*
  tile is solid, contains another bomb, or overlaps any alive player's hitbox. Its "tile" for collisions/flames is
  `(floor(x),floor(y))`. Players cannot walk through it. It can be re-kicked after stopping. Fuse keeps burning while sliding.
* **Glove** (`x`, requires `p.glove`): find target bomb = the stationary bomb on the player's tile, else on the adjacent tile in
  their facing. It becomes *flying* for `THROW_TICKS`: leaves the grid (not solid, immune to flames, fuse paused), travels in a
  straight line and lands `THROW_DIST` tiles from the player's tile in the facing direction — if that landing tile is
  out-of-board/solid/occupied by a bomb, keep going one more tile in the same direction (up to the board edge); if nothing
  valid is found, land back on its origin tile (if occupied, on the nearest free floor tile by BFS). Landing adds
  overlapping players to `pass`. Emits `throw` then `land`.
* Explosion (`explode(bomb)`): remove bomb; **flame set**: centre tile + up to `range` tiles each of 4 arms. An arm stops (inclusive) at:
  `#`/`X` → stops *before* it; `+` → destroys the block (grid→`.`, maybe drops item) and stops there (the tile still gets
  a flame); another (non-flying) bomb → that tile gets a flame and the bomb chain-explodes **in the same tick** (iterate until no
  new explosions); items on flame tiles are destroyed **only if the item existed before this tick** (freshly revealed items
  survive) and flames do not stop at items. Flame tiles record `{x,y,ticks: FLAME_TICKS, mask, owner}`; `mask` bits
  `1 up, 2 right, 4 down, 8 left` = which neighbours this flame tile connects to (centre = OR of arms with length ≥ 1; arm
  interior = both ends; arm tip = only toward the centre; overlapping flames OR their masks & refresh ticks).
* Flame kills: at the end of each tick every alive player whose centre tile has a flame dies unless `shield>0 || spawnShield>0`
  (then event `shieldhit`). Kill credit = flame `owner` (kills count only if owner ≠ victim and (FFA or different team);
  own goal → `selfKills`).

### 3.7 Items, curses

* Item: `{id, x/tx, ty, kind, born: tick}`. Picked up when an alive player's *centre tile* == item tile (checked after movement).
* **Curse transfer:** if a cursed player's centre is within `CURSE_TOUCH_RADIUS` of another alive fighter's centre and
  `curseCooldown==0` for both, the curse (with fresh `CURSE_TICKS`) moves to the other; the giver is cured; both get
  `curseCooldown = CURSE_XFER_COOLDOWN`. Curse expiry → cured. Event `curse`.
* `effectiveSpeed(p)`: curse `slow` → `CURSE_SLOW_SPEED`, `rush` → `CURSE_RUSH_SPEED`, else `BASE_SPEED + SPEED_STEP*speedLv`.
  Exported (the client predictor needs it) along with `MOVE_STATES`.

### 3.8 Scoring & stats

Round winner (or winning team members) each get +1 win in the Room. Match ends when a fighter/team reaches `rounds`
wins (setting; options 1,2,3,5,7; default 3). Draw rounds score nothing. Per-player stats accumulated over the match in the
Room: `kills, deaths, selfKills, blocks, items, roundsWon`.

---------------------------------------------------------------------------------------------

## 4. Room, lobby and match (`shared/room.js`) — transport-free

`Room` is the whole multiplayer brain. It is used by the Node server (one per room code) **and** by the browser for
"Practice vs bots" (`LoopbackConnection`, no server at all). It knows nothing about sockets:

```js
const room = new Room({ code, now = () => performance.now(), onEmpty, log })
const conn = { send(str){…}, close(reason){…} }         // provided by transport
const pid  = room.join(conn, { name, color?, token?, wantHost? })  // → { ok, id, token } | { ok:false, error }
room.receive(pid, rawStringOrObject)                    // validated with protocol.parseClientMessage
room.disconnect(pid)                                    // socket dropped (keeps slot for the grace period)
room.pump(nowMs)                                        // run due ticks (used by loop); room.step() = exactly 1 tick (tests)
room.startLoop()/stopLoop()                             // setTimeout-based self-correcting loop (Node & browser)
room.close()
```
All outbound traffic is JSON strings via `conn.send`. Rooms are fully deterministic given `seed` option + injected `now`.

### 4.1 Settings (host-editable in lobby / results)

```
rounds      1|2|3|5|7           default 3     (wins needed)
roundTime   0|60|90|120|180|240 default 120   (seconds; 0 = unlimited, disables sudden death)
suddenDeath true|false          default true
mode        'ffa'|'teams'       default 'ffa'
theme       'random'|meadow|frost|lava|candy|night   default 'random' (random per round, seeded)
layout      'classic'|'open'    default 'classic'
blocks      'few'|'normal'|'many'  default 'normal'
items       'none'|'few'|'normal'|'many' default 'normal'
```
Server validates every key/value; unknown ignored.

### 4.2 Lobby entries (`players[]` in the `lobby` message)

`{ id, name, color(0-7), team(0|1), isBot, level('easy'|'normal'|'hard'|null), connected, isHost, wins, waiting }`
* Names sanitized (`protocol.sanitizeName`): trim, collapse whitespace, strip control/bidi chars, ≤ MAX_NAME code points, default `Player N`.
  Duplicate names get ` 2`, ` 3`… suffix.
* Colors unique among entries: auto-assign lowest free at join; a `profile` request for a taken color is ignored (client sees
  unchanged lobby). Team mode: default team = alternate by entry order; players may change their team; `start` in team
  mode requires both teams non-empty (else error `need_teams`).
* First human is host. Host leaves/drops > 10 s → next human (oldest join) becomes host. No humans for 30 s → room closes.
* Capacity: MAX_PLAYERS entries (humans+bots). Joining mid-match is allowed if there's room: the entry has `waiting:true`
  (spectates) and becomes a fighter next round. Joining a full room → error `full`.
* `start`: host only, phase `lobby`/`results`, ≥ MIN_TO_START entries (a lone human may start if they've added ≥1 bot).

### 4.3 Phases

`lobby` → `match` (repeated: World countdown/playing/ending per round) → `results` → (host `lobby` msg, or auto after 30 s) → `lobby`.
Rooms send `lobby` state on every change (join/leave/profile/settings/bots/phase/host change/wins change). Late joiners in a
`match` get `joined`, `lobby`, `round`, then normal `snap`s (first one includes the full grid).

### 4.4 Wire protocol (JSON text frames; full detail in docs/PROTOCOL.md)

Client → server:
```
{t:'create', v:1, name, color?, token?}          {t:'join', v:1, code, name, color?, token?}
{t:'profile', name?, color?, team?}              {t:'settings', patch:{…}}       (host)
{t:'addBot', level}  {t:'removeBot', id}  {t:'kick', id}  {t:'start'}  {t:'lobby'} (host: back to lobby)
{t:'in', c:[[seq,d,b,x], …]}                     {t:'chat', text}   {t:'emote', e:0..7}
{t:'ping', ts}   {t:'leave'}
```
Server → client:
```
{t:'joined', id, token, code, v:1}     {t:'lobby', code, phase, hostId, you, settings, players, round:{n,winsNeeded}}
{t:'round', n, seed, theme, mode, w, h, grid, players:[{id,name,color,team,slot,isBot,x,y}], winsNeeded, roundTime, serverTick}
{t:'snap', …}                          {t:'roundEnd', winnerId, winnerTeam, draw, scores:[{id,wins,team?}]}
{t:'matchEnd', winnerId, winnerTeam, standings:[{id,name,color,team,wins,kills,deaths,selfKills,blocks,items}]}
{t:'chat', from, name, text}  {t:'emote', from, e}  {t:'sys', text}  {t:'pong', ts}
{t:'error', code, msg}  (codes: bad_msg, no_room, full, not_host, need_players, need_teams, rate_limited, version, kicked, closed)
{t:'kicked'}
```
Rate limits (per connection): chat 5 per 5 s, emote 1 per 700 ms, profile 4 per 2 s, `in` ≤ 90 cmds/s sustained (burst 40),
all messages ≤ 4 KB, everything else ≤ 30/s. Violations: drop message (and `rate_limited` error for chat/emote).

### 4.5 Snapshot (`t:'snap'`) — sent every SNAP_EVERY ticks to every connected client (incl. waiting/spectators)

Built **once per broadcast** (single JSON string). Short keys, documented exactly in PROTOCOL.md. Contents:
`k` server tick, `st` world state (0 countdown,1 playing,2 ending,3 over), `cd` countdown ticks left, `r` round ticks left
(−1 unlimited), `sd` 0/1 sudden death, `ack` `{playerId: lastSeq}` for humans, `p` players[], `b` bombs[], `f` flames[],
`i` items[], `fall` falling sudden-death tiles `[tx,ty,ticksLeft]`, `g` grid string **only if changed since the previous snapshot
or once per second (every 60th tick-aligned snapshot) or on request**, `e` events list since previous snapshot.
Player entry includes position, facing, moving, alive, shield ticks, curse kind & ticks, stats (bombsMax, range, speedLv, kick, glove)
and `dt` (ticks since death). There is no "carrying" state: a glove throw is a single action.
Bomb entry: id, x, y, owner, fuse ticks left, range, dir (0 none/1-4), fly `[fromX,fromY,toX,toY,ticksLeft,total]` or 0, pass ids array (omit if empty).
Events (all arrays `[code, …args]`): `bomb` placed, `boom` explosion (`x,y,range,[[tx,ty]…tiles],[[tx,ty]…blocks destroyed]`),
`block`, `itemspawn`, `pickup`, `itemgone`, `death` (`id, killerId`; killer −1 sudden death/none, −2 left), `kick`, `throw`, `land`, `curse`, `shieldhit`,
`sdstart`, `sdland` (`tx,ty`), `left`, `spawnshield` … Exact list lives in PROTOCOL.md and MUST be complete for renderer/audio.

---------------------------------------------------------------------------------------------

## 5. Netcode

**Server tick loop** (`room.startLoop`): self-correcting `setTimeout` at 60 Hz using `now()`, at most 5 catch-up ticks per wake
(if the process stalls longer, drop time rather than spiral). Each tick:
1. for each human fighter: pop up to **1** cmd from its queue (**2** if queue length > `INPUT_CATCHUP_AT`) and `world.applyCmd`;
   if the queue is empty do nothing (player keeps their state, `lastSeq` unchanged);
2. for each bot: `cmd = brain.think(world, id)` → `world.applyCmd` (bot seq = increasing counter);
3. `world.tick()` (bombs, flames, items, curses, sudden death, outcome…);
4. every `SNAP_EVERY`th tick broadcast a snapshot; also run Room state transitions (`roundEnd`, next round, `matchEnd`).
Input queue: bounded by `INPUT_QUEUE_MAX` (drop oldest beyond it) and a token-bucket cap (≤ 66 cmds/s refill, burst 40): excess cmds dropped.
Cmds with `seq` ≤ the last accepted seq are discarded (dup/reorder). Sanitize `d∈0..4`, `b,x∈{0,1}`.

**Client prediction** (`game.js`): fixed 60 Hz accumulator (max 6 ticks/frame; if the tab was backgrounded > 250 ms, discard the
backlog). Every tick the client builds a cmd (`seq++`), immediately applies `movePlayer` to its own predicted player (using
`effectiveSpeed`, the same `isSolid` rule built from the *latest snapshot's* grid + bombs + local ghost bombs), appends the cmd to
`pending`, and queues it for sending; queued cmds flush to the socket at ≥ 30 Hz (`{t:'in', c:[[s,d,b,x]…]}`). On every snapshot:
`ack = snap.ack[me]`; drop pending cmds with `s ≤ ack`; reset predicted player to the server's state for me; replay remaining pending
cmds via `movePlayer`; if the resulting position differs from what was displayed by < 2 tiles, keep a visual
**error offset** that decays exponentially (τ ≈ 80 ms) instead of snapping; ≥ 2 tiles → snap. Bomb placement is shown instantly
as a **ghost bomb** (dropped when the server's bomb at that tile arrives). Death, pickups, kicks, throws, curses etc. are server truth only.
The predictor is disabled when the local player is dead, in `countdown`, or not a fighter.

**Interpolation** (everything except the local player): keep the last ≥ 12 snapshots with arrival times. Render time in ticks =
`latest.k + (now − latest.arrival)·0.06 − INTERP_TICKS`, clamped to `[oldest.k, latest.k + 2]`; lerp positions of entities with the
same id between the bracketing snapshots (snap instead of lerp when the distance > 3 tiles or when `alive` flips). Bomb fuse, flame
age, timers come straight from the newest snapshot minus elapsed ticks.

**Reconnect:** `joined` carries a random `token`; the client stores `{code,token,name}` in `sessionStorage`. On unexpected close it retries
with backoff (0.5, 1, 2, 3, 3… s, give up after 45 s) sending `{t:'join', code, token, name}`; server re-attaches the same entry and re-sends
`joined`, `lobby`, and (if a round is running) `round` + a full snapshot. Grace: 10 s in lobby, 30 s in a match (character stands still and is
vulnerable meanwhile). Keep-alive: server pings each socket every 15 s, terminates after 35 s without pong; client sends `ping` every 2 s
(latency display) and treats 8 s of silence as a dead link → reconnect.

**Clock/latency HUD:** RTT from `ping/pong`, smoothed; shown as a small signal indicator in the HUD.

---------------------------------------------------------------------------------------------

## 6. Bots (`shared/bots.js`)

`class BotBrain { constructor({ level, seed }); think(world, playerId) → { s, d, b, x } }` — pure, deterministic given seed,
uses only public `World` state + exported helpers, and produces the *same kind of cmd a human would* (no cheating: bots obey movement,
bomb and cooldown rules; `think` may run at a lower frequency by holding the previous decision between ticks — `easy` re-plans every 14
ticks, `normal` every 7, `hard` every 3; `hard`/`normal` re-plan immediately when danger appears).

Behaviour tiers:
* **all levels**: never step into flame or into a tile where a bomb will explode before they can leave; always keep an escape route
  before placing a bomb (BFS over walkable tiles with a time-aware danger map that includes chain reactions); flee when threatened.
* **easy**: wanders toward soft blocks, bombs blocks, picks up adjacent items, ~8 % random mistakes, ignores enemies unless adjacent, never kicks/throws.
* **normal**: seeks items (safe path), bombs blocks and enemies within reach when a safe escape exists, avoids dead-ends, uses `kick` when it has it.
* **hard**: predicts other players' escape options and tries to trap them (bomb when the enemy's escape set is small),
  uses kick/glove deliberately, camps safe pockets during sudden death, prefers shield/speed pickups, avoids curse pickups (skull) unless desperate,
  runs away from cursed neighbours.
Quality gates (tested by headless bot-only matches, §13): over 30 seeded 4-bot rounds no exception, < 12 % of deaths are self-kills for `hard`,
< 25 % for `easy`; 90 % of rounds end before sudden death completes; a `hard` bot beats an `easy` bot more than 65 % of 1v1 rounds.

---------------------------------------------------------------------------------------------

## 7. Server (`server/*`)

* `node server/index.js` — env: `PORT` (default 3000), `HOST` (default `0.0.0.0`), `MAX_ROOMS` (200), `MAX_CONN_PER_IP` (24), `LOG_LEVEL`.
  Prints friendly startup text: local URL, LAN URLs (all non-internal IPv4), and a hint about `npm run share`.
* HTTP: static files from `client/` at `/` and `shared/` at `/shared/` **only** (path-traversal safe, no dotfiles, no directory listings,
  correct MIME incl. `.mjs .js .css .html .webmanifest .png .svg .json .woff2`), `ETag` + `Cache-Control: no-cache`, gzip for text if
  the client accepts it (cache compressed bytes), `GET /healthz` → `200 ok`, `GET /api/stats` → `{rooms, players}` JSON,
  `GET /r/:CODE` → serves index.html (so invite links `https://host/r/KQXZ` deep-link; the client reads the code from the path), 404 otherwise.
  Headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP
  `default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'`.
* WebSocket at `/ws` via `ws` (`maxPayload: 4096`, `perMessageDeflate: false`). Adapter turns each socket into a Room `conn`; the first
  valid `create`/`join` within 10 s or the socket is closed. Per-IP connection cap (respect `X-Forwarded-For` first hop only when
  `TRUST_PROXY=1`, which the Render/Fly configs set).
* `RoomManager`: codes are 4 letters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels → no accidental words), unique, case-insensitive on join;
  rooms deleted 30 s after their last human leaves; graceful `SIGTERM/SIGINT` (notify clients `{t:'error',code:'closed'}`, close sockets, exit 0).
* One `setTimeout` loop **per room** (not a global tick) so an idle server burns ~0 CPU. Exceptions inside a room tick are caught and logged;
  the room ends its match gracefully (back to lobby with a `sys` message) rather than killing the process.

---------------------------------------------------------------------------------------------

## 8. Client architecture

Data flow: `net` (WebSocket or Loopback) → `main.js` routes messages → `ClientGame` (state/prediction/interp) → `getView()` →
`Renderer.render(view)`; events → `Renderer` (particles/shake) + `Audio`; lobby/HUD data → `UI`; input → `Input` → `ClientGame` (cmds).

### 8.1 Interfaces (all ES modules, no globals except what's noted)

```js
// net.js
export class WebSocketConnection { constructor(url); send(obj); close(); onopen/onmessage(obj)/onclose(info) ; readyState }
export class LoopbackConnection  { constructor(); … same interface, runs a Room in-page, code 'LOCAL' }

// game.js  (NO DOM access — must be importable and testable in Node)
export class ClientGame {
  constructor({ me /*player id*/, send /*fn(obj)*/, now /*fn ms*/ })
  reset(roundMsg)                      // on 'round'
  onSnapshot(snap, arrivalMs)
  setIntent({ d, bomb, special })      // from input; bomb/special are *latched taps* (true until consumed by the next tick)
  update(nowMs)                        // run fixed ticks: predict + queue + flush cmds
  getView(nowMs) → View                // interpolated, ready to draw
  takeEvents() → event[]               // world events since last call
  rtt
}
// View = { w,h, grid, state, countdown /*ticks*/, timeLeft /*ticks or -1*/, suddenDeath, me,
//          players:[{id,x,y,facing,moving,alive,shield,spawnShield,curse,deadT,isMe,color,team,name,bombsMax,range,speedLv,kick,glove}],
//          bombs:[{id,x,y,fuse,owner,dir,fly}], flames:[{x,y,mask,ticksLeft}], items:[{id,x,y,kind,born}],
//          falling:[{tx,ty,ticksLeft}], ghostBombs:[{x,y}], theme, shake?:… }

// render.js
export class Renderer {
  constructor(canvas)
  setTheme(name); setPlayers(playersInfo); resize(cssW, cssH, dpr)
  render(view, dtMs, nowMs)
  handleEvents(events, view)          // spawn particles, shake, flashes, popups ("+1"), emote bubbles
  showEmote(playerId, emoteIndex)
  stats: { fps }
}

// audio.js
export const audio = { unlock(), play(name, {pan?, vol?, rate?}), music(name|null), setVolume(v), setMuted(b), muted, volume }

// input.js
export class Input { constructor({ canvas, touchRoot }); getIntent() → {d, bomb, special}; onEmote(fn); onMenu(fn); enableTouch(bool); destroy() }

// ui.js  — pure view, NEVER touches network or game state
export class UI { constructor(root, callbacks); show(screen); … see §8.3 }
```

### 8.2 Rendering (render.js + sprites.js + particles.js)

* Canvas 2D, **vector cartoon style, pre-rendered sprites**: `sprites.js` builds offscreen canvases at the current tile pixel size (device
  pixels) and rebuilds them on `resize`/theme change. Draw loop only `drawImage`s cached sprites plus a few gradients — 60 fps on a mid-range phone.
* Fit: the arena is 15×13 tiles; tile size = `floor(min(availW/15, availH/13))` device px; letterbox/center; the canvas fills its container.
  A themed decorative frame/backdrop surrounds the arena. Portrait phones: arena on top full width, touch controls under it.
* 2.5-D look: hard walls & soft blocks are drawn taller than a tile (extruded with a lighter top face and darker front face); everything
  y-sorted (`y + 0.5*height`) so characters pass behind/in front of blocks correctly. Soft, colored drop shadows under everything.
* **Themes** (5): `meadow` (green grass checker, stone pillars, wooden crates), `frost` (ice blue, snowy pillars, ice cubes),
  `lava` (dark basalt, glowing cracks, magma-rock blocks), `candy` (pastel pink, candy-cane pillars, gummy blocks), `night` (deep blue, neon
  edge-lit pillars, glowing crates). Each theme = palette + a few decorations (grass tufts / snowflakes / embers / sprinkles / stars) drawn in the floor
  variants and as ambient particles.
* **Characters** — "blasties": round chunky mascots, one per color index, each color also has a distinct accessory so colour-blind players can tell
  them apart. Color names & hues: `0 Red, 1 Blue, 2 Green, 3 Yellow, 4 Purple, 5 Orange, 6 Pink, 7 Cyan`; accessories (top-of-head): `0 antenna-ball, 1 propeller,
  2 leaf sprout, 3 crown, 4 horns, 5 flame tuft, 6 bow, 7 headphones`. Animations: idle bob & blink, 4-direction walk cycle with squash/stretch and
  little dust puffs, place-bomb pop, hurt flash, **death** (spin + poof + ghost float up), win cheer (jump + confetti), shield bubble (shimmer, blinks last 2 s),
  curse aura (purple skulls orbiting, screen-space tint on the local player), team ring (team 0 = coral ring, team 1 = teal ring) under feet in team mode,
  name tag above (local player highlighted), emote bubbles.
* **Bombs**: glossy black with a highlight, pulsing scale that speeds up as the fuse burns, fuse spark particles, blinking red at the last 30 ticks; rolling
  animation while sliding; arc + shadow while flying (parabola height); owner-colour band.
* **Flames**: animated flame sprites per mask (centre, arm, tip), hot white core → yellow → orange → red gradient, flicker, glow (additive `lighter` composite)
  , ember particles, brief screen flash + camera shake scaled by range.
* **Items**: little rounded tokens with icon + colored glow + bobbing, spawn pop animation, sparkle; skull is purple/menacing.
* **Sudden death**: falling blocks telegraphed with a growing shadow + warning marker, land with a shake + dust; banner "SUDDEN DEATH!".
* **HUD** is DOM in `ui.js` (crisp text): top timer, player chips (avatar swatch with accessory glyph, name, wins ★, power stats icons, skull/shield status, dead greyed),
  ping indicator, round banner, big countdown numbers 3-2-1-GO, "WINNER" banner with confetti, kill-feed toasts ("Dad blasted Mom", "Ana blew herself up"), emote wheel button,
  mute button.

### 8.3 UI screens (ui.js, index.html, style.css)

Look & feel: bold, rounded, friendly, colorful; big tap targets; works from 320 px wide phones to 4K TVs; light gradients & subtle animated background
(floating bombs / confetti); respects `prefers-reduced-motion`; no external fonts or assets (system font stack with a heavy rounded feel:
`"Baloo 2","Fredoka","Trebuchet MS","Avenir Next Rounded",system-ui,sans-serif` — fallback is fine); dark theme by default.

Screens:
1. **Title/Home**: logo "BLAST PARTY" (CSS-styled with bomb), name field (remembered), buttons: **Create room**, **Join room** (4-letter code input, auto-uppercase,
   paste-friendly), **Practice vs bots**, **How to play** (modal with controls for keyboard/touch/gamepad and item guide), settings (volume, mute, reduce effects).
   If the URL is `/r/CODE` (or `#CODE`): the Join box is pre-filled and focused.
2. **Lobby**: room code huge + **Copy invite link** / **Share** (Web Share API when present) / QR code (tiny inline QR generator, optional), player list with colored avatars
   (accessory glyph), host crown, bots with level chips, kick (host), color picker (taken colors dimmed), team picker (team mode), name edit, **Add bot** (easy/normal/hard),
   settings panel (host edits; others see read-only), chat, **Start match** (host; disabled with reason), **Leave**. Connection/ping indicator.
3. **Game HUD** overlaying the canvas (see above) + pause-free (multiplayer) **menu button** (leave match, mute, how to play) — Esc toggles.
4. **Round end overlay**: winner card with confetti; scores.
5. **Match results / podium**: standings with medals, awards ("Demolition Expert" most blocks, "Bomb Squad Casualty" most self-kills, "Terminator" most kills,
   "Collector" most items, "Survivor" fewest deaths — show only awards with distinct non-zero winners), buttons **Play again** (host) / **Back to lobby**, chat stays open.
6. Toasts/dialogs: connecting…, reconnecting (with countdown), kicked, room not found/full, host changed.

`UI` callbacks (all optional-chained): `onCreate(name)`, `onJoin(code,name)`, `onPractice(name)`, `onProfile({name?,color?,team?})`, `onSettings(patch)`, `onAddBot(level)`,
`onRemoveBot(id)`, `onKick(id)`, `onStart()`, `onChat(text)`, `onEmote(e)`, `onLeave()`, `onBackToLobby()`, `onMute(bool)`, `onVolume(v)`, `onToggleEffects(bool)`.
Render methods (called by main.js): `showTitle({name,code,error})`, `showConnecting(text)`, `showLobby(lobbyMsg)`, `showGame({players})`, `updateHud(hudModel)`,
`setPing(ms)`, `showCountdown(text|null)`, `showRoundEnd(roundEndMsg, lobbyPlayers)`, `showResults(matchEndMsg)`, `toast(text, kind)`, `killfeed(text)`, `addChat({from,name,text})`,
`showMenu(bool)`, `showReconnecting(secondsLeft|null)`.
`hudModel = { roundNo, winsNeeded, timeLeftSec|null, suddenDeath, state:'countdown'|'playing'|'ending', mode, players:[{id,name,color,team,alive,wins,bombsMax,range,speedLv,kick,glove,shield,curse,isBot,isMe,connected,waiting}] }`.

### 8.4 Input

* Keyboard: move = Arrow keys **or** WASD (last pressed axis wins; opposite keys cancel); bomb = `Space` (also `Enter`, `J`); special (glove) = `Shift`, `E`, `K`;
  emotes = `1`–`6` (or `T` opens the wheel); `M` mute; `Esc` menu. Ignore keys while an `<input>` is focused. Release all keys on blur/visibilitychange.
* Touch: left **floating joystick** (appears where the thumb lands in the left 45 % of the screen, 4-direction with hysteresis & dead-zone), right **BOMB** button (big, bottom-right,
  haptic `navigator.vibrate(10)` where supported) and a smaller **special** button (only shown when the player owns the glove) and an emote button; multi-touch safe;
  `touch-action:none`; prevent scroll/zoom/long-press menus; safe-area insets.
* Gamepad: Gamepad API standard mapping: D-pad / left stick (dead-zone .5) move, A/B bomb, X/Y special. Poll each frame.

### 8.5 Audio (audio.js) — all synthesized

Sound names (must all exist; unknown names are silently ignored): `place, explode, block, pickup, pickup_bad, kick, throw, land, death, shield, curse, countdown,
go, win_round, win_match, lose_match, sudden_death, warning (last-10-seconds tick), click, join, leave, emote, chat, error`. Music tracks `menu`, `battle`,
`battle_fast` (sudden death), `victory`: procedurally sequenced chiptune loops (square/triangle/noise, look-ahead scheduler), cheerful, ≤ 18 % master gain by default.
Autoplay-policy safe (`unlock()` on first gesture; resumes on visibility change), master gain + mute persisted in `localStorage` (try/catch), voice limiting (≤ 24 concurrent),
stereo pan from arena x-position, tiny random pitch variation. Never throws if `AudioContext` is unavailable.

---------------------------------------------------------------------------------------------

## 9. Security & robustness checklist

* `parseClientMessage` validates type, shape, ranges, string lengths, and rejects prototype-pollution keys (`__proto__`, `constructor`); unknown types ignored.
* Names/chat rendered with `textContent` only (never `innerHTML` with user data).
* Bounded everything: rooms, players, queue lengths, chat history (last 50), per-IP connections, message size.
* A throwing handler never kills the process; `uncaughtException` logs and continues; `unhandledRejection` logs.
* Static server: no path escapes (`..`, encoded `%2e`, backslashes, NUL), GET/HEAD only.
* Room codes are not secrets; tokens (`randomBytes(8).toString('hex')`) are required to reclaim an existing entry.
* No PII stored; nothing persisted to disk.

---------------------------------------------------------------------------------------------

## 10. Testing (`specs/`) — what "done" means

Unit (`node:test`, no network): rng determinism; mapgen invariants (§3.1) over 200 seeds; `movePlayer` (free move, wall clamp, corner slide both ways, bomb solid/pass,
speed scaling, EPS edge cases, no tunnelling at max speed); bomb/flame rules (range, wall stop, block destroy, item drop, fresh-item survival, chain reaction in one tick, shield,
kill credit, own goal); kick, glove landing rules; curses & transfer; sudden death spiral covers every non-hard cell & terminates; outcome lock (draw, team win, last-second double-KO);
snapshot completeness & JSON round-trip; protocol fuzz (10 000 random/malformed payloads never throw); Room state machine (join/leave/host migration/team mode/settings/start/rounds/match end/rejoin/
waiting spectators/rate limits) using fake `conn`s and `room.step()`; bots (gates in §6); prediction (ClientGame + a lag/jitter-simulating fake link against a real Room: predicted vs
server position error < 0.05 tile in steady state, converges within 300 ms after a forced teleport).
Integration (real `ws`): full flow create → join ×3 → bots → start → play scripted inputs → match end → back to lobby; reconnect with token; host migration; kicked; invalid messages;
oversize payload; per-IP cap; graceful shutdown; static server security (traversal attempts) and `/healthz`, `/r/CODE`.
E2E (Playwright, headless Chromium from `/opt/pw-browsers`): 3 browsers in one room incl. a mobile-emulated touch client; screenshots of every screen; canvas pixel sanity (non-blank,
arena visible); no console errors/uncaught exceptions; keyboard play moves the local blastie and places a bomb that explodes; 60 s soak with 8 participants measuring server tick time.
`npm test` must be green and complete in < 60 s.

---------------------------------------------------------------------------------------------

## 11. Deployment & docs (`ops`, `docs` agents)

* `Dockerfile` (node:22-alpine, non-root user, `npm ci --omit=dev`, `EXPOSE 3000`, healthcheck), `.dockerignore`, `fly.toml` (internal_port 3000, `/healthz` check,
  force_https, `auto_stop_machines`/`min_machines_running` sensible), repo-root `render.yaml` (free web service, `rootDir: bomberman`, `healthCheckPath: /healthz`, env `TRUST_PROXY=1`, `NODE_VERSION=22`),
  `.github/workflows/bomberman.yml` (on push/PR touching `bomberman/**`: Node 22, `npm ci`, `npm test`).
* `npm run share` (`scripts/share.js`): starts the server, then tries to open a public HTTPS tunnel: `cloudflared tunnel --url` if installed, else `ssh -R 80:localhost:PORT nokey@localhost.run`,
  else prints manual instructions. Parses the public URL from the tool's output, prints it big with a QR-ish box and the invite link format. Cleans up children on exit.
* README: what it is, screenshot(s), controls, items/curses, rules, **3 ways to play with family** (same Wi-Fi / `npm run share` / deploy to Render or Fly in 5 minutes), config env vars, architecture overview,
  how netcode works (short), testing, troubleshooting, credits/licence. Written for a non-expert.
