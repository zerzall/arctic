# BLAST PARTY — Technical Spec (v1)

A Bomberman-style battle game for 2–8 fighters (humans and bots) that runs in any modern
browser — phones included — and is played online with a 4-letter room code.
Original name, characters and art (this is *not* a Konami product; never use the word
"Bomberman" in the UI, only in the README as "a Bomberman-style game").

**This document is the contract between agents that write code in parallel, and it is
COMPLETE for every wire format and every cross-module API** (§3 rules, §4 Room and protocol,
§5 netcode, §8 client APIs, Appendix A exact shapes). If code and this spec disagree, **THIS SPEC
WINS**. `docs/PROTOCOL.md` is generated from the code after implementation as a convenience
extract of §4.4 and Appendix A; it must not contradict this spec and never overrides it. Nobody
edits a cross-module shape unilaterally: implement the spec shape, and if you believe it is wrong,
write the problem in your file's header comment and in your report. If something is ambiguous,
pick the simplest reasonable reading and record it the same way.

---------------------------------------------------------------------------------------------

## 0. Non-negotiables

1. **Server-authoritative.** Clients send inputs; the server simulates; nobody can cheat by
   editing local state. Malformed / hostile messages must never crash or stall a room.
2. **Feels instant.** Local player movement is client-predicted with reconciliation
   (§5). 60 Hz fixed simulation, 20 Hz snapshots, ~100 ms interpolation for everything else.
3. **Zero build step.** Plain ES modules (`"type":"module"`), no bundler, no TypeScript, no
   framework. One runtime dependency: `ws`. Node ≥ 22 server; evergreen browsers + iOS
   Safari 16+ and Android Chrome for clients.
4. **Shared code is isomorphic.** Everything in `shared/` runs unchanged in Node and in the
   browser. The server serves `shared/` to the browser at `/shared/…`. Rules (enforced by
   `specs/unit/isomorphic.spec.js`, which greps the sources):
   * `shared/*.js` may import only sibling `./*.js` files. Forbidden anywhere in `shared/`: `node:` imports,
     `require`, `process`, `Buffer`, `document`, `window`, `localStorage`, `setImmediate`, `crypto.randomUUID`,
     `crypto.subtle`. Allowed globals: `Math`, `JSON`, `Intl`, `performance.now`, `queueMicrotask`,
     `globalThis.crypto.getRandomValues`; `setTimeout`/`clearTimeout` only in `room.js` through the injected
     `setTimer`/`clearTimer`.
   * Browser floor is Safari 16.0. Forbidden in `shared/` and `client/`: regex lookbehind (`(?<=` `(?<!`), the regex `v` flag,
     `static {` class blocks, `isWellFormed`/`toWellFormed`, `Array.fromAsync`, `Object.groupBy`/`Map.groupBy`,
     `Promise.withResolvers`, `Set` union/intersection/difference/isSubsetOf, top-level `await`. (`?.`, `??`, class fields are fine.)
     A SyntaxError in `shared/protocol.js` would kill the page on old phones and no Node test could notice, hence the grep.
   * No `eval`, `new Function`, inline `<script>` or `on*=` attributes anywhere in `client/` (CSP, §7).
5. **Deterministic sim.** `World` uses only its own seeded RNG (`shared/rng.js`, mulberry32),
   never `Math.random()` / `Date` / `performance`, iterates in a stable order (ascending ids), and produces identical
   results in Node and browsers. In `world.js`, `mapgen.js`, `rng.js` and `bots.js` the only allowed arithmetic is
   `+ - * / %` and `Math.floor/ceil/round/trunc/abs/min/max/sign/sqrt/imul` (everything else, e.g. `Math.pow`, `**`,
   `Math.hypot`, `Math.sin/cos/exp/log/atan2`, is banned; a unit test greps for it). Distances are compared squared
   (`dx*dx+dy*dy <= r*r`). All sim state is plain float64 JS numbers (no `Float32Array`, no `Math.fround`).
6. **Family-friendly & robust:** a room must survive players joining/leaving/reconnecting at
   any moment, flaky mobile networks, backgrounded tabs, and 8 people mashing buttons.
7. **Beautiful.** Procedural vector art (no image assets, except the app icons of §8.3), juicy effects, smooth animation,
   readable at phone size. Sound is synthesized (WebAudio) — no audio files.
8. **Testable.** Every module has tests under `specs/`; see §10. Time, randomness and I/O enter modules only through injected
   seams (`now`, `setTimer`, `seed`, `send`, `botFactory`, `timeouts`), never through globals.

---------------------------------------------------------------------------------------------

## 1. Repo layout & file ownership

All game code lives in `bomberman/` of the `arctic` repo (self-contained). Do not touch files
outside it except the two listed below (`render.yaml`, `.github/workflows/bomberman.yml`); in particular
never edit the root `package.json`, `src/`, `tests/` or `.github/workflows/build.yml` (an unrelated Electron app).

```
bomberman/
  package.json              scripts: start, dev, test, test:e2e, share            [lead, see 1.1]
  README.md                 how to play / host / deploy                          [docs]
  Dockerfile  fly.toml  .dockerignore                                            [ops]
  docs/SPEC.md              this file
  docs/PROTOCOL.md          generated from code after implementation             [core]
  shared/                   ISOMORPHIC — runs in Node and browser
    constants.js            every tunable number, enum and table (§3)            [core]
    rng.js                  makeRng(seed): next/int/pick/shuffle (mulberry32)    [core]
    mapgen.js               generateMap(): grid, spawns, drops                   [core]
    world.js                World (one round), movePlayer() and the pure helpers [core]
    protocol.js             message parsing, sanitizers, snapshot index maps     [core]
    qr.js                   qrMatrix(text) → boolean[][]  (optional, see §8.3)   [ui]
    bots.js                 BotBrain                                             [bots]
    room.js                 Room (lobby + match state machine), transport-free   [server]
  server/
    index.js                startServer(cfg) factory + boot from env, shutdown    [server]
    http.js                 static files, routes, /healthz, /api/stats, headers   [server]
    lobby.js                RoomManager: codes, create/find/cleanup, limits       [server]
    ws.js                   ws adapter → Room connection objects                  [server]
  client/                   (FLAT js/ directory, no subdirectories)
    index.html  manifest.webmanifest  css/style.css  icons/*                     [ui; icons: ops]
    js/boot.js  js/legacy.js  boot watchdog / too-old-browser message (§8.3)     [ui]
    js/ui.js                DOM screens (title, lobby, HUD, results, chat)        [ui]
    js/sprites.js           procedural sprite atlas/cache                         [render]
    js/render.js            arena canvas renderer + camera/shake                  [render]
    js/particles.js         particle & effect system                              [render]
    js/audio.js             WebAudio sfx + music                                  [audio]
    js/input.js             keyboard, touch, gamepad → intent                     [client]
    js/game.js              ClientGame: snapshots, interpolation, prediction      [client]
    js/net.js               WebSocketConnection + LoopbackConnection              [client]
    js/main.js              boot + glue (UI ⇄ net ⇄ game ⇄ render ⇄ audio)        [client]
  specs/
    unit/*.spec.js          node:test unit specs (fast, no network)
    integration/*.spec.js   node:test with real `ws` clients
    e2e/*.e2e.mjs           Playwright (headless Chromium), not part of `npm test`
    helpers/*.js            shared test helpers (owners in §10.1)
    fixtures/*.json         golden wire examples from Appendix A (written by the lead before implementation starts)
  scripts/share.js          `npm run share`: start server + public tunnel         [ops]
  scripts/make-icons.mjs    writes client/icons/*.png with a pure-Node PNG encoder [ops]
  ../render.yaml            (repo root) Render blueprint, rootDir: bomberman      [ops]
  ../.github/workflows/bomberman.yml   CI for bomberman/**                        [ops]
```

### 1.1 package.json and the test-file naming rule

The repo root's `npm test` is `node --test` with auto-discovery (also run by the existing root CI on every push) and
**must not** pick up our specs. Node 22 auto-discovers: a directory named `test`, and files named `test.js`,
`test-*.js`, `*-test.js`, `*_test.js`, `*.test.js` (also `.mjs`/`.cjs`). So: **do not create any file under `bomberman/` whose path
matches those patterns** (an empty `bomberman/test/` directory currently exists and must be removed). Use `specs/**/*.spec.js` and
`*.e2e.mjs`. `specs/unit/naming.spec.js` walks `bomberman/` (excluding `node_modules`) and fails on any matching path.

The lead fixes `bomberman/package.json` before the agents start:

```json
{ "name": "arctic-bomberman", "private": true, "type": "module", "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test": "node --test --test-timeout=30000 \"specs/unit/**/*.spec.js\" \"specs/integration/**/*.spec.js\"",
    "test:e2e": "node specs/e2e/run.e2e.mjs",
    "share": "node scripts/share.js" },
  "dependencies": { "ws": "^8.18.0" } }
```
The inner quotes are required so the shell does not expand `**`. Globs after `--test` need Node ≥ 21, hence `>=22`. Integration specs
listen on port 0 (test files run in parallel processes). The lockfile is regenerated only for the `engines` field.

### 1.2 Module & asset path conventions (normative)

* Every import uses a **relative specifier with an explicit `.js` extension**. `client/js/*` imports shared code as
  `'../../shared/x.js'` (browser: `/js/game.js` + `../../shared/x.js` = `/shared/x.js`; Node: the file, so `game.js` is testable in Node) and
  its siblings as `'./x.js'`. Never `'/shared/…'` specifiers (they fail in Node), never bare specifiers, never `node:` imports in `shared/` or `client/`.
  `server/*` imports shared code as `'../shared/x.js'`. `shared/` never imports from `client/` or `server/`.
* `client/index.html` references **every** asset root-absolute (`/css/style.css`, `/js/main.js`, `/manifest.webmanifest`, `/icons/…`) and has no
  `<base>`, because the same file is served at `/r/KQXZ` (a relative `js/main.js` would resolve to `/r/js/main.js`). Client code uses
  root-absolute paths for every `fetch`/`new URL`.
* The client derives the invite link as `location.origin + '/r/' + CODE`, never from server-supplied hosts. It reads the room code from
  `location.pathname.match(/^\/r\/([A-Za-z]{4})\/?$/)` or `location.hash`, uppercases it, and accepts it only if it matches
  `/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/` before putting it anywhere in the DOM.

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
| entry | a Room lobby entry (human or bot); a fighter is an entry that is in the current World |

Item kinds (string ids): `bomb`, `flame`, `speed`, `kick`, `glove`, `shield`, `skull`.
Curse kinds: `slow`, `rush`, `reverse`, `nobomb`, `spam`.
Themes: `meadow`, `frost`, `lava`, `candy`, `night`.
Bot levels: `easy`, `normal`, `hard`.
Player colors: indices `0..7` (see `PLAYER_COLORS` in §3 and §8.2). Teams: `0` and `1` (only in team mode).

---------------------------------------------------------------------------------------------

## 3. Rules & constants (`shared/constants.js` is the single source — export ALL of these; nobody else defines them)

```
TICK_RATE 60         DT 1/60          SNAP_EVERY 3 (→ 20 Hz snapshots)     WIRE_VERSION 1
GRID_W 15            GRID_H 13        MAX_PLAYERS 8     MIN_TO_START 2 (humans+bots)
PLAYER_HALF 0.34     // half-size of the square hitbox, tiles          EPS 1e-6
BASE_SPEED 3.6       SPEED_STEP 0.5   MAX_SPEED_LV 6     // tiles/s = 3.6 + 0.5*lv (max 6.6)
START_BOMBS 1        MAX_BOMBS 8      START_RANGE 2      MAX_RANGE 10
FUSE_TICKS 150       // 2.5 s
FLAME_TICKS 36       // 0.6 s a flame tile stays lethal (36 consecutive kill checks)
KICK_STEP_TICKS 7    // a kicked bomb advances one whole tile every 7 ticks (≈ 8.6 tiles/s)
THROW_DIST 3         THROW_TICKS 26    // glove throw: preferred landing 3 tiles away, flight lasts 26 ticks
SHIELD_TICKS 480     // 8 s (item)      SPAWN_SHIELD_TICKS 120 (2 s after GO)      SHIELD_FOREVER 65535 (never decremented)
SHIELDHIT_GAP_TICKS 12   // at most one `shieldhit` event per fighter per 12 ticks
CURSE_TICKS 600      // 10 s            CURSE_TOUCH_RADIUS 0.7   CURSE_XFER_COOLDOWN 60
CURSE_SLOW_SPEED 1.6 CURSE_RUSH_SPEED 7.5   SPAM_INTERVAL 24 (ticks between auto-bombs)
COUNTDOWN_TICKS 180  // 3,2,1 (60 each); "GO!" is a banner shown during the first 30 ticks of `playing`, play is live at once
COUNTDOWN_HOLD_TICKS 12   // the Room holds queued cmds during the last 12 countdown ticks (§5.1)
ENDING_TICKS 150     // 2.5 s after the round outcome is locked
OVER_HOLD_TICKS 120  // 2 s the Room waits after the World reaches `over` before matchEnd / next round
DEATH_ANIM_TICKS 60
SD_INTERVAL 8        // ticks between sudden-death tiles starting to fall
SD_WARN_TICKS 48     // a falling tile is telegraphed this long before it lands
MAX_ROUND_TICKS 36000    // 10 min hard cap of `playing` when roundTime is 0 (draw)
SHOWDOWN_TICKS 900   // 15 s: shortened clock once the last human is dead (§3.2)
INTERP_TICKS 6       // client render delay floor (100 ms)
INPUT_QUEUE_MAX 40   INPUT_CATCHUP_AT 2   CATCHUP_CREDIT_MAX 12   // server-side cmd queue (§5.1)
IN_MAX_CMDS 16       // max cmds in one `in` frame        IN_FLOOD_RATE 120 (cmds/s)   IN_FLOOD_BURST 60
MAX_NAME 14 (graphemes)   MAX_CHAT 120 (graphemes)
```

**Shared tables** (all exported from `constants.js`):

```js
export const SPAWN_SLOTS = [[1,1],[13,11],[13,1],[1,11],[7,1],[7,11],[1,6],[13,6]];      // [tx,ty] by slot
export const PLAYER_COLORS = [ {name:'Red',hex:'#ff4d5e',accessory:'antenna'}, {name:'Blue',hex:'#3d8bff',accessory:'propeller'},
  {name:'Green',hex:'#38c85a',accessory:'sprout'}, {name:'Yellow',hex:'#ffd23f',accessory:'crown'}, {name:'Purple',hex:'#a55eea',accessory:'horns'},
  {name:'Orange',hex:'#ff9f43',accessory:'flame'}, {name:'Pink',hex:'#ff7eb6',accessory:'bow'}, {name:'Cyan',hex:'#2ed9e6',accessory:'headphones'} ];
export const TEAM_COLORS = ['#ff6b5e', '#22c3b0'];                                         // team 0 coral, team 1 teal
export const EMOTES = ['\u{1F600}','\u{1F602}','\u{1F621}','\u{1F631}','\u{1F44D}','\u{1F389}','\u{1F4A3}','\u{1F480}'];  // wire value e = index; keys 1–6 send 0–5, the wheel offers all 8
export const THEMES = ['meadow','frost','lava','candy','night'];
export const ITEM_KINDS = ['bomb','flame','speed','kick','glove','shield','skull'];
export const CURSE_KINDS = ['slow','rush','reverse','nobomb','spam'];
export const BOT_LEVELS = ['easy','normal','hard'];
export const BOT_NAMES = ['Bolt','Fuse','Pixel','Zap','Boomer','Spark','Nova','Kaboom'];  // addBot picks the first unused (dedupe suffix as for humans)
export const ITEM_WEIGHTS = {bomb:22, flame:22, speed:14, kick:8, glove:7, shield:6, skull:8};   // weights, not percent
export const DROP_CHANCE = {none:0, few:0.22, normal:0.42, many:0.65};
export const BLOCK_DENSITY = {few:0.50, normal:0.72, many:0.90};
export const STATE = {COUNTDOWN:0, PLAYING:1, ENDING:2, OVER:3};
export const PHASES = ['lobby','match','results'];
export const SETTINGS_DEFS = {                     // protocol.js validates against it, Room takes defaults from it, ui.js builds the panel from it
  rounds:{values:[1,2,3,5,7],def:3}, roundTime:{values:[0,60,90,120,180,240],def:120}, suddenDeath:{values:[true,false],def:true},
  mode:{values:['ffa','teams'],def:'ffa'}, theme:{values:['random',...THEMES],def:'random'}, layout:{values:['classic','open'],def:'classic'},
  blocks:{values:['few','normal','many'],def:'normal'}, items:{values:['none','few','normal','many'],def:'normal'}, locked:{values:[true,false],def:false} };
export const TIMEOUTS = { GRACE_LOBBY_MS:120000, GRACE_MATCH_MS:30000, HOST_MIGRATE_MS:60000, EMPTY_CLOSE_MS:30000, RESULTS_AUTO_MS:30000,
  HELLO_MS:10000, PING_MS:15000, DEAD_MS:35000, IDLE_LOBBY_MS:1800000, IDLE_MATCH_MS:300000, ROOM_MAX_MS:21600000 };
```

**Spawn slots:** with N fighters use slots `0..N-1`, then assign who gets which (seeded, see `World` in Appendix A.1; in a 2-vs-2 team match team 0 gets
slots `{0,1}` and team 1 slots `{2,3}`, i.e. each team holds one diagonal, each shuffled inside its team). A player spawns at the centre of the
slot tile with `facing = 2` (down).

**Starting stats:** 1 bomb, range 2, speed level 0, no kick, no glove, no shield, no curse.

**Item drop weights** when a soft block is destroyed: `ITEM_WEIGHTS` above. Whether a block hides any item at all is decided at map
generation (§3.1), not during play. Effects: `bomb` +1 capacity (≤8), `flame` +1 range (≤10), `speed` +1 level (≤6), `kick` sets kick,
`glove` sets glove, `shield` sets shield ticks to `SHIELD_TICKS`, `skull` gives a random curse (§3.7). An item is consumed by the pickup even when
its stat is already at the cap.

### 3.1 Map generation (`mapgen.js`)

`generateMap({ layout, blocks, items, numFighters, rng })` → `{ grid: string(195), spawns:[{tx,ty}×8] (SPAWN_SLOTS order), drops: Array(195) }`.
`rng` is a `makeRng(seed)` object (§4.6). `drops[idx]` is an item kind or `null` for every soft block and is **server-only**: it never appears in `round`,
`snap` or any other message (it would reveal what is under each block).

* Border ring is `#`. **classic** layout: interior `#` pillars at every `(tx,ty)` with both `tx` and `ty` even (30 pillars, 113 non-wall cells).
  **open** layout: pillars where `tx%4==3 && ty%4==2` (`tx∈{3,7,11}`, `ty∈{2,6,10}`; 9 pillars, 134 non-wall cells) — a wide-open brawl. Both layouts are
  mirror-symmetric in x and in y, all their floor cells are connected, and every slot keeps at least one open neighbour.
* **Spawn safe zone** = every non-wall cell within Manhattan distance ≤ 2 of a slot tile. All 8 slots are always protected (whatever the player count) so the
  board is fair; `numFighters` is used only for the drop chance below. Safe-zone cells stay floor.
* **Soft blocks and their prizes are generated for the top-left quadrant only and mirrored 4-fold**, so every corner and mid-edge spawn sees identical
  surroundings and identical item prizes. RNG draw order (normative): for `ty=1..6`, for `tx=1..7` (row-major), for each floor cell that is not in a safe zone:
  `if (rng.next() < BLOCK_DENSITY[blocks])` plant `+` at `(tx,ty),(14-tx,ty),(tx,12-ty),(14-tx,12-ty)` and roll ONE prize for all four images:
  `kind = rng.next() < pDrop ? weightedPick(rng, ITEM_WEIGHTS /*cumulative in ITEM_KINDS order, one rng.next()*/) : null`.
  `pDrop = min(0.85, DROP_CHANCE[items] * max(1, numFighters/4))` — bigger rooms get proportionally more items (8 fighters at `normal`: 0.84, about 38 items; 2–4 fighters
  unchanged at 0.42, about 19 items).
* **First-bomb escape post-pass** (after all blocks are planted): the most natural first action is dropping a bomb on your own spawn tile, so it must be survivable. For each
  slot `s = 0..7`, repeat until it holds: `F` = flame set of a `START_RANGE` bomb on the slot (arms stop before `#`, stop inclusive at `+`), `R` = BFS (4-neighbour) over
  cells that are `.` starting at the slot. OK iff `R` contains a cell not in `F`. Otherwise clear (set to `.`, drop `null`) the first `+` in row-major order that is 4-adjacent to a cell of
  `R` and not in `F` (if none exists, the first `+` adjacent to `R`) **together with its 3 mirror images**, and re-evaluate. (Measured over 400 seeds: without this pass 6.8 % of
  slot checks at `normal` and 15.9 % at `many` on the classic layout are inescapable; with it 0 %.)
* Guarantees (tested over 200 seeds × 3 densities × 2 layouts): border complete; pillars exactly per layout; all 8 spawn tiles are floor; safe zones contain no `+`; grid and drops
  are 4-fold symmetric; with all `+` removed the floor is connected (hard walls never partition the board); every slot passes the first-bomb escape check; the result is a pure
  function of `(layout, blocks, items, numFighters, rng state)`.

### 3.2 Round lifecycle (inside `World`)

States: `STATE.COUNTDOWN` → `PLAYING` → `ENDING` → `OVER`.

* `COUNTDOWN` (`COUNTDOWN_TICKS` = 180): players frozen at spawns; cmds ignored (the Room additionally holds queued cmds in the last `COUNTDOWN_HOLD_TICKS`, §5.1). Snapshots flow
  so clients see the arena. When the counter reaches 0 the state becomes `PLAYING` in that same tick: event `go`, every fighter gets `spawnShield = SPAWN_SHIELD_TICKS` (visible, blinking).
  The first live cmd is applied just before the next tick.
* `PLAYING`: normal rules. Round clock `timeLeft` = `roundTime*60` ticks (−1 when `roundTime` is 0) counts down only in `PLAYING`.
* **Round end conditions**, evaluated ONCE per tick (§3.2a step 10) on the alive set after that tick's deaths were applied:
  1. fighters alive form ≤ 1 team (FFA: ≤ 1 fighter): lock a winner (`reason:'last'`), or a draw if nobody is alive (`reason:'wipe'`; two fighters dying on the same tick is a draw);
  2. the clock reached 0: with `suddenDeath` on, sudden death starts (§3.2.1); with it off, lock a **draw** (`reason:'timeout'`; nobody wins even if several fighters are alive) unless
     condition 1 holds on the same tick (a kill on the last tick still wins);
  3. `roundTime == 0`: hard safety cap `MAX_ROUND_TICKS` of `playing` → draw `timeout`. Sudden death is disabled when `roundTime` is 0.
  Draw rounds award nothing (§3.8).
* **Showdown:** when the last alive *human* fighter dies (a human who has left does not count; in team mode evaluated across both teams), at least 2 fighters remain alive, `suddenDeath` is on and
  `roundTime > 0`: `if (timeLeft > SHOWDOWN_TICKS) timeLeft = SHOWDOWN_TICKS` and event `showdown` (HUD banner "Showdown in 15"). Bot-only endgames therefore last at most 15 s plus sudden death.
* **Outcome lock** (§3.2b) freezes the outcome; a fighter removed mid-round (human left) is handled by §4.3a.

#### 3.2.1 Sudden death

`SD_INTERVAL` 8, `SD_WARN_TICKS` 48. Classic total: 113 cells × 8 + 48 = 952 ticks (15.9 s); open: 134 × 8 + 48 = 1120 ticks (18.7 s). Sudden death guarantees every round ends within
`roundTime*60 + 952` (classic) ticks.

* When it starts: `world.suddenDeath = true`, `sdStart = tickNo`, event `sdstart`, and `sdOrder` (array of tile indices) is built once from the current grid: for ring `r = 1,2,3,…` with
  `x0=y0=r`, `x1=GRID_W-1-r`, `y1=GRID_H-1-r`, stop when `x0>x1 || y0>y1`: visit the top row (`x0..x1`, `y0`); the right column (`x1`, `y0+1..y1`); if `y1>y0` the bottom row (`x1-1` down to `x0`, `y1`);
  if `x1>x0` the left column (`x0`, `y1-1` down to `y0+1`). Skip cells whose grid char is `#` or `X`. Clockwise from the top-left of each ring, deterministic, every non-wall cell exactly once.
* Schedule: cell `i` (0-based) starts falling at tick `sdStart + i*SD_INTERVAL` (`falling` entry `{tx,ty,ticksLeft: SD_WARN_TICKS}`, snapshot `fall`) and lands `SD_WARN_TICKS` ticks later.
  `world.sdNext` is the index of the next cell to start; `world.landTick(tx,ty)` is the absolute tick at which that cell becomes `X` (`Infinity` if not scheduled). Bots and the renderer read these.
* **Landing** (§3.2a step 5): every alive fighter whose **hitbox overlaps** the tile square dies (`killer = -1`, shield **ignored**; killing hitbox-overlappers, not only the centre tile, is what prevents a
  fighter from being left inside a wall: `movePlayer` only tests solidity when a leading edge crosses a tile boundary); non-flying bombs on the tile (logical tile, sliding included) are removed without exploding (a flying bomb keeps flying and re-resolves its landing, §3.6b)
  (event `bombgone`); items on it are removed (`itemgone`); flames on it are removed; a `+` is removed **without** a drop; `grid[t]='X'`; `gridVer++`; event `sdland`.
* Safety net (step 8): any alive fighter whose centre tile is `#`, `X` or `+` dies with `killer=-1`.
* On outcome lock, `sdNext` is frozen and every falling tile is cancelled (removed, no landing), so survivors cannot be crushed during `ENDING`.
* Any mutation that makes a tile solid under a fighter must put the overlapping fighters into that bomb's `pass` list (§3.6): bomb placement, landing and stopping do; kick refuses to enter an overlapped tile.

#### 3.2a Tick order (normative — `World.tick()`; every fighter's `applyCmd` for this tick already ran, in ascending fighter id)

`t = ++tickNo`. If `state == OVER` return. Steps marked (P) run only in `PLAYING`.

```
 0. COUNTDOWN: if (--countdown == 0) { state = PLAYING; spawn shields; event go }.  Nothing below runs in COUNTDOWN.
 1. (P) auto-actions, alive fighters by id: the `spam` curse (§3.7).
 2. (P) round clock: playTicks++; if timeLeft > 0 and --timeLeft == 0 → start sudden death, or (SD off) set timeUp;
        if roundTime == 0 and playTicks >= MAX_ROUND_TICKS → timeUp.
        While sudden death is active: decrement every falling tile's ticksLeft, then start the tile(s) due this tick.
 3. Bombs, four full passes in ascending bomb id:  (a) fuse-- for every non-flying bomb;  (b) slide step (§3.6c);
        (c) flying bombs: left--, land at 0 (§3.6b);  (d) drop from `pass` every id whose hitbox no longer overlaps (strict test, §3.6).
 4. resolveExplosions (§3.6a).
 5. (P) sudden-death landings due this tick (§3.2.1).
 6. Pickups (PLAYING and ENDING), fighters by id (§3.7).
 7. (P) curse touch transfers (§3.7).
 8. (P) kill check: collect ALL deaths of the tick first, then apply them together (§3.6d).
 9. Ageing: every flame ticks-- (removed at 0, so a flame created on tick t is lethal on exactly FLAME_TICKS = 36 consecutive kill checks t..t+35);
        (P) shield--, spawnShield--, curseCooldown--, curseTicks-- (0 → cured, event curse)  (shield == SHIELD_FOREVER is never decremented; spamCd is handled in step 1);
        every fighter that did not run movePlayer since the previous tick gets moving = false.
10. (P) outcome lock, evaluated once on the alive set after step 8 (§3.2 end conditions).  ENDING: --endingLeft; at 0 → OVER.
```
A bomb placed by a cmd applied just before tick `t` has `fuse = FUSE_TICKS`; step 3a decrements it on tick `t` itself, so it explodes in the `FUSE_TICKS`-th `tick()` after placement.
Events are appended in step order, so clients get a stable sequence. Curse timers, the spam timer and the shield counters change only inside `tick()`, never in `applyCmd`.

#### 3.2b Ending and the round-to-round timeline

* **Lock on tick L** (step 10): `outcome` is set (once); `state = ENDING` for `ENDING_TICKS`; the round clock stops; sudden death frozen and falling tiles cancelled; every curse cleared (event `curse [id,0,-1]`);
  alive fighters get `shield = SHIELD_FOREVER` (a JSON-safe number, never `Infinity`) and `spawnShield = 0`. From now on nothing can kill a survivor (kill check and sudden death no longer run), so the outcome cannot change.
  Survivors may keep walking, placing bombs and picking up items; bombs and flames keep resolving. Bots stop thinking. A survivor leaving after the lock changes nothing.
* The Room sends `roundEnd` on tick L (after flushing the snapshot that carries that tick's final `death` events) so the winner banner plays during `ENDING`.
* At `OVER` (tick L + `ENDING_TICKS`) the World stops ticking and the Room stops broadcasting snapshots. After `OVER_HOLD_TICKS` Room steps: if the match is decided → `matchEnd` (phase `results`);
  otherwise the next round is built (`round` message, then countdown).
* `shieldhit` is throttled to one event per fighter per `SHIELDHIT_GAP_TICKS`.

### 3.3 Players in the sim

Player fields (public on `world.player(id)`; `id` = small int assigned by the Room, stable for the match, never reused in that Room):
`id, name, color, team, isBot, slot, x, y, facing, moving, alive, removed, bombsMax, range, speedLv, kick, glove, shield (ticks), spawnShield, curse (kind|null), curseTicks, curseCooldown,
spamCd, lastShieldHit, lastSeq, deathTick, killer, stats {kills, deaths, selfKills, blocks, items}`. `killer` = flame owner id (own id for a self-kill), `-1` sudden death / no credit,
`-2` left; `-1` also while alive. Initial values per §3 (Starting stats).

### 3.4 Cmd (input for one tick)

`cmd = { s: seq, d: 0..4, b: 0|1, x: 0|1 }` — `s` strictly increasing int per entry (§5.1), `d` dir code (client resolves multi-key input to one direction; last pressed axis wins; no diagonals),
`b` = "bomb pressed *this tick*" (edge; the client latches taps so none are lost between ticks), `x` = "special pressed this tick" (edge).
`World.applyCmd(id, cmd)` (never throws; unknown id is a no-op):
1. `p.lastSeq = max(p.lastSeq, cmd.s)` **always** (even when the cmd is otherwise ignored) so clients can ack.
2. Ignored unless the state is `PLAYING` (or `ENDING`) and the player is alive and not removed.
3. `d = effectiveDir(p, cmd.d)` (§3.7: curses `reverse` and `rush`).
4. `r = movePlayer(p, d, env)`; if `r.blocked && p.kick` → try to start a kick (§3.6c).
5. `b`: place a bomb (§3.6; blocked by curse `nobomb`). `x`: glove action (§3.6b).

### 3.5 `movePlayer(p, d, env)` — the ONE movement function (shared by server and client prediction)

`env = { W, H, isSolid(tx,ty,p) → boolean }`. `isSolid` **must** return `true` for `tx<0||ty<0||tx>=W||ty>=H`, for `#`, `X`, `+`, and for a non-flying bomb's logical tile unless the bomb lists `p.id` in its `pass`
(`makeEnv`, Appendix A.1, builds it). `movePlayer` is pure w.r.t. `p` (mutates only `p.x,p.y,p.facing,p.moving`) and returns `{ moved, blocked }`. This exact algorithm
(verified by fuzzing: 0 wall penetrations in 600 000 ticks including 3-decimal rounding; the wrong-sign readings walk players into walls):

```js
export function movePlayer(p, d, env) {
  if (d === 0) { p.moving = false; return { moved: false, blocked: false }; }
  const horiz = d === 2 || d === 4, sgn = (d === 2 || d === 3) ? 1 : -1;
  p.facing = d - 1;
  const step = effectiveSpeed(p) * DT;                      // multiply by DT = 1/60; never divide by 60
  const a = horiz ? 'x' : 'y', q = horiz ? 'y' : 'x';       // axis of travel, perpendicular axis
  const ap = p[a], pp = p[q];
  const lo = Math.floor(pp - PLAYER_HALF + EPS), hi = Math.floor(pp + PLAYER_HALF - EPS);   // the 1 or 2 lanes the hitbox covers
  const np = ap + sgn * step;
  // tile containing a LEADING edge; an edge exactly on a boundary still counts as in the tile BEHIND it
  const edgeTile = (e) => sgn > 0 ? Math.floor(e - EPS) : Math.floor(e + EPS);
  const tOld = edgeTile(ap + sgn * PLAYER_HALF), tNew = edgeTile(np + sgn * PLAYER_HALF);
  const solid = (t, lane) => horiz ? env.isSolid(t, lane, p) : env.isSolid(lane, t, p);
  let sLo = false, sHi = false;
  if (tNew !== tOld) { sLo = solid(tNew, lo); sHi = lo === hi ? sLo : solid(tNew, hi); }
  let r;
  if (!sLo && !sHi) { p[a] = np; r = { moved: true, blocked: false }; }                      // free move
  else if (lo !== hi && sLo !== sHi && Math.floor(pp) === (sLo ? hi : lo)) {                 // corner slide: centre is over the free lane
    const delta = (sLo ? hi : lo) + 0.5 - pp;
    p[q] = pp + Math.sign(delta) * Math.min(step, Math.abs(delta));                          // perpendicular move only, axis unchanged
    r = { moved: true, blocked: false };
  } else {                                                                                   // clamp flush against the solid tile
    p[a] = sgn > 0 ? tNew - PLAYER_HALF - EPS : tNew + 1 + PLAYER_HALF + EPS;
    r = { moved: false, blocked: true };
  }
  p.moving = r.moved; return r;
}
```
Notes: `effectiveSpeed`, `effectiveDir`, `overlapsTile`, `makeEnv` are exported from `world.js` (the client predictor and bots import them; re-implementing any of them is a spec violation). Snapshots may round
`x,y` to 3 decimals: this is safe because every flush line `k±0.34` is a multiple of 0.01 and `EPS` ≪ 5e-4 (1 decimal is NOT safe). The maximum step is 0.125 tile (rush 7.5 t/s), so no tunnelling.
Diagonal input does not exist. Required tests: for every tile side and each of the 7 speed levels plus 1.6 and 7.5, pushing into a wall for 100 ticks is stable and never penetrates; a 50 000-tick random walk on 200 seeded maps
(with random bombs) never overlaps a solid tile (strict overlap depth < 1e-9); the same walk with `x,y` rounded to 3 decimals every 3 ticks gives no overlap either; corner slides work in both directions; a player
whose centre is 0.0–0.49 off the bomb lane centre is blocked (and can kick), never stuck without feedback.

### 3.6 Bombs

* **Place** (`b`): tile = `(floor(p.x), floor(p.y))`. Allowed if the player is alive, curse ≠ `nobomb`, bombs owned that have not yet exploded (flying and sliding included) < `bombsMax`, the tile is `.`, and no non-flying bomb
  has that tile as its logical tile. A live flame on the tile does not prevent it (the bomb then explodes in the same tick, §3.6a). Two fighters placing on one tile in one tick: the lower id places, the other is refused.
  Bomb: `{id (increasing per World), owner, x, y (visual centre), tx, ty (the tile it OCCUPIES), range (owner's range NOW), fuse: FUSE_TICKS, dir: 0, step: 0, pass, fly: null}`, `pass` = ids of **every** alive fighter (any owner)
  whose hitbox overlaps the tile now (`overlapsTile`). Event `bomb`.
* **`overlapsTile(p,tx,ty)`** = `p.x+HALF>tx && p.x-HALF<tx+1 && p.y+HALF>ty && p.y-HALF<ty+1` (strict). The same function is used everywhere (pass update, kick, slide, glove, sudden death).
* **`pass` semantics:** a list of fighter ids that may walk through this bomb until their hitbox stops overlapping its tile (strict test, every tick, §3.2a step 3d). Once an id is removed it is never re-added. Dead/removed fighters are ignored.
  Whenever a bomb becomes stationary (placed, landed, stopped) its `pass` is recomputed as above (a stopping slide bomb has none, because its tile was reserved while nobody overlapped it).

#### 3.6a Explosions and chain reactions — `resolveExplosions(w)` (§3.2a step 4)

Resolved **once per tick**, and all bombs stay in `w.bombs` until the whole chain is resolved, so the outcome never depends on processing order.

```
due   = every non-flying bomb with fuse <= 0, PLUS every non-flying bomb whose logical tile has a flame that already existed at the start of this tick
        (fire ignites bombs that are placed, kicked or landed into lingering flame, in that same tick)
queue = due sorted by bomb id ascending;  boom = Set(ids in queue);  blocks = Set();  F = Map(tileIdx -> {mask, owners:[]})
for each bomb b taken from the queue (the queue may grow while iterating):
    addFlame(b.tile, b.owner)                                        // centre
    for dir in [up, right, down, left]:
        for k in 1..b.range:
            t = b.tile + k*dirVec ; c = grid[t]
            if c == '#' or c == 'X': break                           // stops BEFORE it
            addFlame(t, b.owner)                                     // every tile reached gets a flame
            if c == '+': blocks.add(t); break                        // a block absorbs the arm; N arms on one block = ONE destruction, ONE drop
            ob = non-flying bomb whose logical tile is t
            if ob: if !boom.has(ob.id) { boom.add(ob.id); queue.push(ob) }  break     // the arm ends AT the bomb; the bomb's own arms take over
            // items and players never stop an arm; flying bombs are ignored
```
Masks: bits `1 up, 2 right, 4 down, 8 left` = which neighbours the flame tile connects to. Arm interior = both bits of its axis (an up-arm interior is `1|4`), arm tip = only the bit toward the centre (an up-arm tip is `4`),
centre = OR of the arm bits with length ≥ 1. `addFlame` ORs masks, appends the owner id to `owners[]` if new (first-seen order), and sets `ticks = FLAME_TICKS`.
Then apply, in this order: (1) every item that exists NOW on any tile of `F` is destroyed (event `itemgone`) — items are destroyed **only here**, lingering flames never destroy items, and the drops of this tick's
blocks do not exist yet, so a revealed item can never be destroyed by the blast that revealed it; (2) remove all bombs in `boom` (event `boom`, one per bomb, in queue order, carrying that bomb's own flame tiles); (3) for `t` in `blocks` ascending:
`grid[t]='.'`, `gridVer++`, `blocks` stat to `owners[0]` of that tile, spawn `drops[t]` (pre-rolled at map generation; **no RNG call here**) as an item with `born = tickNo` (events `block`, `itemspawn`); (4) merge `F` into `w.flames`
(existing flame tiles OR their masks, union their owners, refresh ticks). `computeBlast(grid, bombs, bomb)` (Appendix A.1) is the pure single-bomb version of the arm loop; `World` uses it inside this algorithm and bots use it for danger maps.
Required tests: two flames on one block in the same tick = one destruction and one drop; bomb A (range 5) and bomb B (range 1) in a row give the same flame set whichever is listed first; a kicked bomb entering a lingering flame explodes in that tick.

#### 3.6b Glove / throw (`x`, requires `p.glove`)

* **Target:** the stationary bomb (`dir==0`, not flying, **any** owner) on the player's centre tile, else the one on the tile in front (`p.facing`). No target → nothing happens (no event). A sliding or flying bomb cannot be thrown.
* **Destination** (chosen at throw time so snapshots carry a fixed target): candidate distances, in tiles from the **player's** tile along `p.facing`, in order `[3, 4, 5, …, last in-board tile]`, then `[2, 1, 0]`. `dest` = the first candidate tile that is in the board,
  has `grid=='.'`, holds no non-flying bomb (the thrown bomb excluded) and is not the `dest` of another bomb already in flight. Players, items and flames on the tile do **not** disqualify it. If no candidate qualifies, `dest` = the bomb's origin tile.
  (Facing a wall therefore lands the bomb on the last free tile before it; a target on the adjacent tile travels 2 tiles, one from your own tile 3.)
* **Launch:** `dir=0`, `pass=[]`, `fly={fx,fy (origin centre), tx,ty (dest tile), left: THROW_TICKS, total: THROW_TICKS}`; `bomb.tx,ty` = dest; fuse paused while `fly != null`; not solid; ignored by flames; keeps owner and range. Event `throw [playerId,bombId,fromTx,fromTy,toTx,toTy]`.
* **Landing** (tick step 3c, ascending bomb id): if `dest` is no longer valid (an `X` landed, another bomb settled there) → the nearest valid tile by BFS over 4-neighbours from `dest` (expansion order up, right, down, left, max 6 steps; valid = `grid=='.'` and no non-flying bomb),
  else BFS without a step limit from the origin. Then `x,y` = tile centre, `pass` = ids of ALL alive fighters whose hitbox overlaps that tile (thrower and enemies alike, so nobody is trapped), `fly=null`, event `land [bombId,tx,ty]`.
  Two bombs due on one tile: the lower id lands, the other re-resolves with the BFS. A bomb landing on a lingering flame explodes in that tick (§3.6a).

#### 3.6c Kick and sliding bombs

* **Kick start** (in `applyCmd`, after `movePlayer` returned `blocked=true`, and `p.kick`): `kt` = the tile directly in front of the player on the lane that contains the player's centre (`floor(perp)`; there is no alignment threshold, so no dead zone). Require ALL of: a bomb at `kt`
  with `dir==0`, not flying, `pass` empty (nobody standing in it), and `enterable(kt + dirVec)`. Then `bomb.dir = d`, `bomb.step = 0`, event `kick [playerId,bombId,dir]`. Otherwise nothing happens and no event is emitted.
* `enterable(N)` = in-board AND `grid[N]=='.'` AND no other non-flying bomb whose logical tile is N AND no alive fighter with `overlapsTile(fighter, N)`.
* **Slide step** (tick step 3b, ascending id, bombs with `dir != 0`): `if (step > 0) step--; if (step == 0) { N = tile + dirVec; if enterable(N) { bomb.tx,ty = N; bomb.step = KICK_STEP_TICKS } else { bomb.dir = 0; bomb.pass = [] } }`.
  Reservation model: the bomb occupies (is solid on, and explodes on) the tile it is heading into from the moment it is reserved; its visual position is `x = centre(tx) - dx*(step/KICK_STEP_TICKS)` (same for y), which glides continuously
  from the old tile centre to the new one over 7 ticks. A fighter can therefore never end up inside a sliding bomb, and a bomb never jumps backwards. Two bombs entering one tile on one tick: the lower id moves, the other stops.
  Items and flames do not stop a bomb (a flame on its tile ignites it in that tick). The fuse keeps burning while sliding. A stopped bomb can be kicked again.
* Snapshot bomb entries carry both `x,y` (visual) and `tx,ty` (occupied tile); collision, flames and the client predictor use `tx,ty` only.

#### 3.6d Flame kills and kill credit

* Kill check (§3.2a step 8, PLAYING only): an alive fighter dies if its **centre tile** has a flame and `shield==0 && spawnShield==0`; if shielded the flame is absorbed (event `shieldhit`, throttled). A fighter whose hitbox overlaps a flame tile by less than
  its half size survives — deliberate leniency; players never collide with each other. Deaths of one tick are collected first and applied together (so two fighters dying on the same tick is a draw).
* A flame tile record is `{tx,ty,ticks,mask,owners:[ids in first-seen order]}`. When a fighter dies to a flame on tile `t`: `killer` = the first id in `t.owners` that is an ENEMY of the victim (`id != victim && (mode=='ffa' || team differs)`); if there is none:
  `killer = victim` if the victim is in `owners` (`selfKills++`), else `owners[0]` (a teammate: no kills/selfKills credit, killfeed "blasted their teammate"). `kills++` only for an enemy killer. `deaths++` always.
  The event is `death [victim, killer, x, y]` (`killer == victim` for a self-kill, `-1` for sudden death or an orphaned bomb).
* Bombs of dead fighters stay on the board and explode normally (dead owners still get credit). A fighter who is removed (left) orphans their bombs: `owner = -1`, they explode normally and credit nobody.
  Bombs owned by a fighter (flying and sliding included) count against `bombsMax` until they explode. The `blocks` stat goes to `owners[0]` of the flame tile that first reached the block.

### 3.7 Items, curses

* Item: `{id, tx, ty, kind, born: tick}`. **Pickup** (tick step 6): for each item (ascending id), among alive fighters whose centre tile is the item's tile, the one whose centre is nearest the tile centre takes it (ties → lowest id). The item is consumed even
  when the stat is capped (event `pickup`, `stats.items++`). Pickups run before the kill check, so a fighter stepping onto an item on a flame tile takes it and then dies.
* **Skull pickup:** `curse` = uniform random (world RNG) of `[slow,rush,reverse,nobomb,spam]` **excluding the current one**, `curseTicks = CURSE_TICKS`, `spamCd = 0`. Events `pickup`, `curse [id,kind,-1]`.
* **Curse touch transfer** (tick step 7): for each giver `g` in ascending id with `g.curse != null && g.curseCooldown == 0`: target = the nearest alive fighter `h != g` with `h.curse == null && h.curseCooldown == 0` and
  `dx*dx+dy*dy <= CURSE_TOUCH_RADIUS²` (centre positions; ties → lowest id). If found: `h.curse = g.curse`, `h.curseTicks = CURSE_TICKS`, `g.curse = null`, both `curseCooldown = CURSE_XFER_COOLDOWN`, event `curse [h.id,kind,g.id]`.
  Two cursed fighters touching do nothing; shields do not block a curse; teammates are included; because the receiver now has a cooldown a curse moves at most one hop per tick. Curses are cleared on death and at outcome lock; expiry → cured (event `curse [id,0,-1]`).
* **`effectiveSpeed(p)`:** `slow` → `CURSE_SLOW_SPEED`, `rush` → `CURSE_RUSH_SPEED`, else `BASE_SPEED + SPEED_STEP*speedLv`.
* **`effectiveDir(p, d)`** (exported; `applyCmd`, the client predictor and bots all use it; `movePlayer` itself stays curse-agnostic):
  ```js
  export function effectiveDir(p, d) {
    if (p.curse === 'reverse') d = [0, 3, 4, 1, 2][d];        // 1<->3, 2<->4 (an involution)
    if (p.curse === 'rush' && d === 0) d = p.facing + 1;      // autorun: keep running in the facing direction until blocked
    return d;
  }
  ```
* `spam` runs in tick step 1 (not in `applyCmd`, so lag or an empty input queue cannot dodge it): while `curse=='spam'`: `if (spamCd > 0) spamCd--; if (spamCd == 0 && canPlaceBomb(p)) { place a bomb on the centre tile; spamCd = SPAM_INTERVAL }`.
  `nobomb` blocks `b` and `spam`; glove and kick keep working.

### 3.8 Scoring, teams & stats

* The Room keeps `entry.wins`, `teamWins[0..1]` and per-entry `matchStats`. **FFA:** the round winner's `wins++`. **Teams:** `teamWins[winnerTeam]++`, and every entry of that team (alive, dead, bot, waiting) displays `wins = teamWins[team]`; individual wins are
  not tracked in team mode. Draw rounds (`wipe`, `timeout`) score nothing. Stats per fighter (`kills, deaths, selfKills, blocks, items`) are copied from `world.player(id).stats` into `matchStats` when a round reaches `OVER` (removed fighters' entries are deleted, §4.3a). The field is called `wins` everywhere.
* **Match end:** a fighter (FFA) or team reaches `rounds` wins → decided (`matchOver` is computed at outcome lock and sent in `roundEnd`). The match also ends when `roundsPlayed == 4 * rounds` (draws included): winner = most wins (teams: `teamWins`), ties broken by kills, then fewer deaths;
  if still tied all tied entries are joint winners (`matchEnd.winnerId = null`, equal `place` in `standings`). `start` always resets wins, teamWins, matchStats and `roundsPlayed`.
* **Friendly fire is ON**: flames kill teammates (credit rules in §3.6d). Curse touch, kick and glove work across teams normally.
* **Team assignment** for a new human, a new bot, a late joiner: the team with FEWER entries; tie → fewer `teamWins`; tie → team 0. Switching the mode to `teams` sets `team = index % 2` by entry order. `team` via `profile` is honoured only in phases `lobby`/`results`.
  `start` in team mode requires ≥ 1 entry per team (`need_teams`); every round build re-checks (§4.3a).

### 3.9 World API

The complete public API of `World` (constructor, state, methods, pure exports) is **Appendix A.1**. Room, BotBrain, ClientGame and the tests use only that API.

### 3.10 Small deterministic details

1. Simultaneous requests on one tile or item: lowest id wins (§3.6, §3.7). Fighters are always iterated in ascending id (humans and bots interleaved).
2. Blocks destroyed by sudden death drop nothing; items and flames on a landing tile vanish (§3.2.1).
3. A leaver emits ONE event `left [id]` (no `death` event, no `deaths`/`selfKills` change); the renderer plays a poof, the killfeed says "X left".
4. Bombs may be placed on a tile with a live flame (they explode in that tick).
5. The kill test uses the centre tile only; the client interpolation and bots must not assume players collide.
6. Standings entries: `{id,name,color,team,wins,kills,deaths,selfKills,blocks,items,place}`.

---------------------------------------------------------------------------------------------

## 4. Room, lobby and match (`shared/room.js`) — transport-free

`Room` is the whole multiplayer brain. It is used by the Node server (one per room code) **and** by the browser for "Practice vs bots" (`LoopbackConnection`, no server at all, §8.1a).
It knows nothing about sockets and never touches a global clock, timer or RNG:

```js
const room = new Room({ code, seed, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
                        onEmpty = () => {}, log = () => {}, botFactory = (o) => new BotBrain(o), genToken, timeouts = TIMEOUTS, local = false })
// seed: uint32, the ONLY source of randomness (default: globalThis.crypto.getRandomValues(new Uint32Array(1))[0]).
// log(level:'debug'|'info'|'warn'|'error', msg:string, extra?:object).  genToken(): default = 16 random bytes as 32 hex chars from globalThis.crypto.getRandomValues (works in insecure http contexts too).
// local: true only for Practice: the `lobby` message then carries local:true and the UI hides invite/QR/share.
const conn = { send(str){…}, close(reason){…} }               // provided by the transport; all outbound traffic is JSON strings via conn.send

room.join(conn, { name, color?, token? })   // → { ok:true, id, token, resumed:boolean } | { ok:false, error:'full'|'kicked'|'closed'|'locked' }
   // Room ITSELF sends joined, lobby and the replays of Appendix A.4 to `conn` BEFORE returning. Adapters never send joined/lobby.
   // token matches an entry → re-attach (resumed:true). No match → fresh join (an unknown or expired token is ignored, a new token is issued).
room.receive(pid, raw, conn)                // raw = string | plain object, parsed with protocol.parseClientMessage; NEVER throws; unknown pid ignored;
                                            // frames whose `conn` is not the entry's current conn are ignored; `create`/`join` arriving here are ignored (they belong to the adapter)
room.disconnect(pid, conn)                  // socket dropped: a no-op unless entry.conn === conn (this fixes the replaced-socket race); the entry keeps its slot for the grace period
room.step()                                 // exactly one 1/60 s match tick (if phase is 'match') AND housekeeping(this.now()), §5.0
room.pump(nowMs)                            // accumulator driver, §5.0
room.startLoop() / stopLoop()               // self-correcting timer loop, §5.0
room.close(reason = 'closed')               // idempotent: sends {t:'error',code:'closed'} to everyone, closes every conn, clears every timer, stops the loop, calls onEmpty once
room.info()                                 // → { code, phase, humans, connected, entries } (read-only, for /api/stats and tests)
```
Rooms are fully deterministic given `seed` + injected `now` + the cmd stream. **Every** public method is wrapped in `try/catch` (errors go to `log('error', …)`); a failure inside `step()` ends the match gracefully
(`sys` "Round crashed", phase `lobby`). All fan-out goes through `send(entry, str) { try { entry.conn?.send(str) } catch { entry.conn = null; entry.connected = false } }` so one dead socket never stops the others.
Before replacing an entry's conn (re-attach) or removing an entry, the old conn is closed inside `try/catch`. All timers owned by the Room live in one `_timers` set so `close()` can clear them.

### 4.1 Settings (host-editable in lobby / results; the table is `SETTINGS_DEFS`, §3)

```
rounds      1|2|3|5|7           default 3     (wins needed)
roundTime   0|60|90|120|180|240 default 120   (seconds; 0 = unlimited, disables sudden death, capped by MAX_ROUND_TICKS)
suddenDeath true|false          default true
mode        'ffa'|'teams'       default 'ffa'
theme       'random'|meadow|frost|lava|candy|night   default 'random' (random per round, seeded, resolved by the Room; the World only ever sees a concrete theme)
layout      'classic'|'open'    default 'classic'
blocks      'few'|'normal'|'many'  default 'normal'
items       'none'|'few'|'normal'|'many' default 'normal'
locked      true|false          default false (a join without a matching token gets error `locked`)
```
The server validates every key and value against `SETTINGS_DEFS`; unknown keys and invalid values are ignored per key.

### 4.2 Lobby entries, joining, host

`players[]` in the `lobby` message: `{ id, name, color(0-7), team(0|1), isBot, level('easy'|'normal'|'hard'|null), connected, isHost, wins, waiting }`.

* **Names** are sanitized by `protocol.sanitizeText(raw, max, fallback)` (below): NFC, controls/private-use/lone surrogates → space, zero-width/bidi/tag characters removed (**ZWJ is kept** so family/profession emoji survive), invisible filler letters → space, at most 2 combining
  marks in a row (anti-zalgo), whitespace collapsed and trimmed, truncated to `MAX_NAME` **graphemes** (never in the middle of an emoji sequence), fallback `Player N` (N = id + 1). Duplicate names (compared as `s.normalize('NFKC').toLocaleLowerCase('en')`) get ` 2`, ` 3`… suffix
  AFTER truncation (a final name may exceed `MAX_NAME` by 2; the UI must not assume ≤ 14). Chat text uses the same function with `MAX_CHAT` and fallback `''` (an empty chat message is dropped). Bot names come from `BOT_NAMES`.

  ```js
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const ZWJ = '\u200D';
  export function sanitizeText(raw, max, fallback = '') {
    if (typeof raw !== 'string') return fallback;
    let s = raw.slice(0, max * 12).normalize('NFC')
      .replace(/[\p{Cc}\p{Cs}\p{Co}]/gu, ' ')                                              // controls, lone surrogates, private use
      .replace(/\p{Cf}/gu, (m) => m === ZWJ ? m : '')                                       // zero-width / bidi / tag chars; keep ZWJ
      .replace(/[\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/g, ' ')                  // invisible filler letters
      .replace(/(\p{M}{2})\p{M}+/gu, '$1')                                                  // at most 2 combining marks in a row
      .replace(/\u200D{2,}/g, ZWJ).replace(/\s+/gu, ' ').trim().replace(/^\u200D+|\u200D+$/g, '');
    const g = seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);
    s = g.slice(0, max).join('').replace(/\u200D+$/, '').trim();
    return s || fallback;
  }
  ```
  (Tested in Node 22: RLO attack, all-ZWSP, all-U+3164, lone surrogate, 3× family emoji, 30-mark zalgo, flag sequences, keycaps.) `<input maxlength>` counts UTF-16 units, so the client uses `maxlength="40"` and lets the sanitizer truncate.
* **Colors** are unique among entries: auto-assign the lowest free at join; a `profile` request for a taken color is ignored (the client sees an unchanged lobby). Teams: §3.8.
* **Host:** the first human in the room is host (there is no `wantHost`). Host changes: an explicit leave / kick / removal / grace expiry of the host → the next host immediately; a host whose socket dropped keeps the role until it has been
  disconnected ≥ `HOST_MIGRATE_MS` (60 s) AND another human is connected. New host = the oldest-joined CONNECTED human; if none is connected the host is unchanged. A returning ex-host is an ordinary player (no flip-flop). Event `sys` "X is now the host".
* **Capacity:** `MAX_PLAYERS` entries (humans + bots; waiting entries count). A human joining a full room in phase `lobby`/`results` evicts the most recently added bot (`sys` "Boomer made room for Grandma"); with no bot → error `full`. During a `match` → `full`.
  Joining mid-match otherwise is allowed: the entry has `waiting:true` (spectates: it receives snapshots, may chat/emote, its `in` frames are ignored) and becomes a fighter when the next round is built (§4.3a).
* **Connection states:** `connected` | `grace` (socket dropped, entry kept) | gone. Grace is `GRACE_LOBBY_MS` (120 s) in phases `lobby`/`results` and `GRACE_MATCH_MS` (30 s) in a `match` (the character stands still and is vulnerable). The long lobby grace exists because a host who switches to a messaging
  app to paste the invite gets frozen by the phone OS. A `leave` message, a kick, or grace expiry removes the entry at once. **Room liveness:** the room lives while ≥ 1 human entry is connected or in grace; when the last human entry is gone the room closes after `EMPTY_CLOSE_MS` (30 s) unless a human joins meanwhile
  (a room with only bots closes the same way). `lastActive` is refreshed by every client message except `ping`/`pong`/`leave`; a room in `lobby`/`results` idle for `IDLE_LOBBY_MS` (30 min) and a `match` in which no human sent a cmd with `d≠0||b||x` for `IDLE_MATCH_MS` (5 min) are closed with `sys`
  "Room closed after inactivity"; hard cap `ROOM_MAX_MS` (6 h). Bounds: chat history 50, banned tokens 16, events per snapshot 128.
* **Re-attach with a token:** if an old conn is still attached, it is closed with code 4001 `replaced` without changing the entry's state, and its late `close` event is ignored by `disconnect(pid, conn)`. Re-attaching clears the entry's input queue (`q.length = 0`) and cancels its grace timer.
* **Kick:** the target gets `{t:'kicked'}`, its conn is closed, the entry is removed as in §4.3a, and its token joins `room.banned` (a join with that token gets error `kicked`; a fresh join without it is allowed — hosts who need to keep strangers out use `locked`).
* **Phase gating:** `settings`, `addBot`, `removeBot`, `team`, `color` and host edits of others are honoured ONLY in phases `lobby`/`results` (silently ignored in `match`); self name change, chat, emote, leave always work; kick works in any phase.
* **Bots:** name = first unused of `BOT_NAMES`, lowest free color, team by §3.8, level chip. The host edits bots with `{t:'profile', id, name?, color?, team?}` (`id` is honoured only from the host and only for bot entries; without `id` the message edits the sender). `removeBot` on a non-bot id is ignored.
* `start`: host only, phase `lobby`/`results`, ≥ `MIN_TO_START` entries (a lone human may start if they added ≥ 1 bot). Error order: `not_host`, `bad_phase`, `need_players`, `need_teams`. It resets wins, teamWins, matchStats and roundsPlayed, clears every `waiting` flag and starts round 1.

### 4.3 Phases

`lobby` → `match` (repeated: World countdown/playing/ending per round) → `results` → (host `lobby` msg, or automatically after `RESULTS_AUTO_MS` 30 s) → `lobby`. A host `lobby` message during a `match` aborts it (`sys` "Host ended the match"). "Play again" = host `start` from `results`.
The `lobby` message is re-sent to everyone on: join, leave, connected change, profile, settings, bots, phase, host change, wins change, waiting change. Late joiners and reconnecters get the replays of Appendix A.4 (F2–F4).

#### 4.3a Fighters, leavers and match end (normative)

* Player ids come from a per-Room counter and are **never reused** in that Room.
* **Building a round:** fighters = entries with (`isBot` or `connected`) and not `waiting`. Humans with `connected=false` (in grace) are `waiting` for that round and become fighters again at the next round if they are back. Every connected human's `waiting` flag is cleared when a round is built.
  Preconditions: FFA needs ≥ 2 fighters; teams need ≥ 1 fighter in EACH team; ≥ 1 connected human fighter. If there is no connected human the Room returns to phase `lobby` (no `matchEnd`; `sys` "Waiting for players"). If another precondition fails the match ends:
  phase `results`, `matchEnd{reason:'not_enough_players'}`, `sys` "Not enough players - match ended"; aborted rounds award nothing.
* **Leaver mid-round** (`leave`, kick, grace expiry, close): `World.removeFighter(id)`: if alive it dies now with event `left [id]` (only that event; no `deaths`/`selfKills` change); its bombs are orphaned (`owner=-1`, they still explode and credit nobody). The Room deletes the entry from `players[]` (its wins disappear from standings) and sends `lobby`.
  The outcome lock is evaluated as usual at the end of the next tick.
* If, after a removal, no human entry (connected or in grace) remains, the Room stops the World at once and returns to phase `lobby` (no `matchEnd`); the `EMPTY_CLOSE_MS` timer keeps running. Bots never play alone for longer than a grace period.
* Match end and scoring: §3.8.

### 4.4 Wire protocol (JSON text frames)

Client → server:
```
{t:'create', v:1, name, color?}                 {t:'join', v:1, code, name, color?, token?}          (handled by the adapter / RoomManager, never by Room.receive)
{t:'profile', id?, name?, color?, team?}        {t:'settings', patch:{…}}                             (host; `id` is host-only and for bots)
{t:'addBot', level}  {t:'removeBot', id}  {t:'kick', id}  {t:'start'}  {t:'lobby'}                     (host; `lobby` = back to lobby / abort match)
{t:'in', c:[[seq,d,b,x], …]}                    {t:'chat', text}   {t:'emote', e:0..7}
{t:'ping', ts}   {t:'sync'}   {t:'leave'}
```
Server → client (exact field lists; `snap` and events are in Appendix A.2/A.3):
```
{t:'joined', v:1, id, token, code, seq, build}    // seq = entry.lastSeq (0 for a fresh entry): the client sets its seq counter to it (§5.1); build = server package version
{t:'lobby', code, phase, hostId, you, local?:true, settings, players:[entry], round:{n, winsNeeded}}
      // entry = {id,name,color,team,isBot,level,connected,isHost,wins,waiting}; `you` = the recipient's own id (Room builds the body once and prefixes `you`);
      // round.n = 0 in phase lobby, else the last built round number; `settings` includes `locked`
{t:'round', n, seed, theme, mode, w:15, h:13, grid, players:[{id,name,color,team,slot,isBot,x,y}], winsNeeded, roundTime, suddenDeath, serverTick}
      // n = 1-based round number in this match. seed is cosmetic only (clients MUST use `grid`, never re-derive it). theme is concrete, never 'random'.
      // grid = the 195-char grid AT SEND TIME (initial grid for a new round; the LIVE grid for late joiners and reconnects). players = this round's fighters in fighter order (the SAME order as `p` in snapshots);
      // x,y = spawn tile centre. A client whose id is not in `players` is a spectator. roundTime in seconds. serverTick = world.tickNo at send time (0 for a new round).
{t:'snap', …}                                     // Appendix A.2
{t:'roundEnd', n, winnerId, winnerTeam, draw, reason:'last'|'wipe'|'timeout', scores:[{id,wins,team}], matchOver}     // winnerId/winnerTeam null when not applicable; sent at outcome lock
{t:'matchEnd', winnerId, winnerTeam, reason:'wins'|'cap'|'not_enough_players', standings:[{id,name,color,team,wins,kills,deaths,selfKills,blocks,items,place}]}
      // standings sorted by wins desc, kills desc, deaths asc; joint winners share `place`; sent when the final round's OVER hold ends
{t:'chat', from, name, text, old?:true}  {t:'emote', from, e}  {t:'sys', text}  {t:'pong', ts}
{t:'kicked'}                                      // the ONLY form of a kick notification
{t:'error', code, msg}
```
Error codes: `bad_msg, version, no_room, full, locked, busy (MAX_ROOMS/MAX_CONNS/IP cap), not_host, bad_phase, need_players, need_teams, rate_limited, kicked (only for a banned token trying to rejoin), closed`. Errors that end a join attempt
(`version, no_room, full, locked, busy, kicked, closed`) are followed by the server closing the socket.

**Limits — one table, enforced ONLY inside `Room.receive` using the injected `now()`** (`ws.js` enforces only `maxPayload` 4096 bytes, the hello timeout and the per-IP caps of §7):

| type | limit |
|---|---|
| `in` | flood guard only: token bucket refilling `IN_FLOOD_RATE` = 120 cmds/s, burst `IN_FLOOD_BURST` = 60; a frame costs its cmd count; too few tokens → the WHOLE frame is dropped silently. Exempt from the generic limit. |
| `chat` | 5 per 5 s (excess → error `rate_limited`); a text identical to the sender's previous one within 10 s is dropped silently |
| `emote` | 1 per 700 ms (→ error `rate_limited`) |
| `profile` | 4 per 2 s |
| `ping` | 4 per s |
| `sync` | 1 per s |
| every other type | 30 per s |

Violations are dropped silently unless stated. `protocol.parseClientMessage(raw) → { ok:true, msg } | { ok:false, code:'bad_msg'|'version' }` never throws and enforces: whole raw ≤ 4096 UTF-16 units; `in.c` a non-empty array of ≤ `IN_MAX_CMDS` (16) cmds, each exactly `[s,d,b,x]` integers with `s` in
0..2147483647, `d` 0..4, `b,x` ∈ {0,1} (anything else invalidates the whole frame); `chat.text` a string (sanitized to ≤ `MAX_CHAT` graphemes); `emote.e` integer 0..7; `settings.patch` only keys of `SETTINGS_DEFS` with allowed values;
`addBot.level` ∈ `BOT_LEVELS`; ids are integers; `v` ≠ `WIRE_VERSION` on create/join → `version`; keys `__proto__`, `constructor`, `prototype` are rejected at any depth.

### 4.5 Snapshot (`t:'snap'`) — rules (exact shape: Appendix A.2, events: A.3)

Sent every `SNAP_EVERY` ticks to every connected client (including waiting/spectators) while the World state is not `OVER`. The Room does `JSON.stringify(world.snapshot({grid, evFrom}))` **once per broadcast**. `world.snapshot()` is a **pure read**: it resets nothing and drains nothing.

* **Grid (`gv` / `g`).** `World.gridVer` increments whenever ANY cell changes; every snapshot carries `gv`. The Room keeps `lastSentGv`, updated only inside `broadcast()`, and includes `g` (the 195-char grid string) iff
  `world.gridVer !== lastSentGv || world.tickNo % 60 === 0` (60 TICKS = 1 s). A joiner, a reconnecter, or a client that sent `sync` gets `world.snapshot({grid:true, evFrom:null})` **unicast** (it touches neither `lastSentGv` nor the event cursor).
  Client: `if (snap.g) { grid = snap.g; gv = snap.gv } else if (snap.gv !== gv) send({t:'sync'})` (at most 1/s; a client skipped by backpressure heals the same way).
* **Events.** `World.events` are appended in order and counted by `world.evCount`. The Room keeps `evCursor`; a broadcast sends `e = world.eventsSince(evCursor)` (at most 128, the newest are kept), then `evCursor = world.evCount; world.trimEvents(evCursor)`. With no client connected the events are dropped every tick.
  Unicast snapshots send `e:[]`.
* **Quantisation and budget.** `x,y` of players and bombs are rounded to 1/1000. Repeated entities are arrays, not objects (Appendix A.2). **Budget (asserted in an integration test with 4 humans + 4 bots):** mean snapshot ≤ 1.2 KB, p99 ≤ 4 KB.
* `ack` is `{ '<humanFighterId>': lastSeq }` (string keys; bots and spectators absent). There is no "carrying" state: a glove throw is a single action.

### 4.6 Seed flow

* `rng.js`: `makeRng(seed) → { next() /* float in [0,1) */, int(n) /* 0..n-1 */, pick(arr), shuffle(arr) /* in place, Fisher-Yates from the end using int; returns arr */ }` — mulberry32, no global state.
* Room: `roomSeed = opts.seed ?? crypto.getRandomValues(...)`. `roundSeed(n) = (roomSeed + Math.imul(n, 0x9E3779B1)) >>> 0`. `theme = settings.theme !== 'random' ? settings.theme : makeRng((roundSeed ^ 0xA5A5A5A5) >>> 0).pick(THEMES)` (a separate stream, so the theme
  choice never perturbs the World stream). The World gets `seed = roundSeed(n)`. Bot seeds: `(roundSeed ^ Math.imul(id + 1, 0x85EBCA6B)) >>> 0`. Tokens never derive from seeds.

---------------------------------------------------------------------------------------------

## 5. Netcode

### 5.0 Tick order and clocks (`Room.step`, `pump`, `startLoop`)

```
step():
  1. housekeeping(this.now()): grace expiry, host migration, empty-room and idle timers, results auto-return, rate-limit bucket refill.
     ALL wall-clock logic uses this.now() only (never Date.now).
  2. if phase !== 'match' or !world: return.
  3. inputs, for each fighter in ascending id:
       human → the input policy of §5.1 (pop cmds, world.applyCmd, entry.appliedSeq = cmd.s); skipped once world.state === OVER
       alive bot AND world.state === PLAYING → cmd = brain.think(world, id); cmd.s = ++entry.botSeq; world.applyCmd(id, cmd)
  4. world.tick()
  5. if world.state !== OVER and world.tickNo % SNAP_EVERY === 0 → broadcastSnap()
  6. if world.outcome && !outcomeHandled: outcomeHandled = true; if step 5 did not broadcast, broadcastSnap() first (the final death events must arrive BEFORE roundEnd);
     apply scoring (§3.8); send roundEnd, then lobby.
  7. if world.state === OVER: count OVER_HOLD_TICKS steps, then endRound() → matchEnd (phase results) or startRound(n+1) (sends `round`, then snap(full) to all).
```
Within one step the order of messages is always: `snap` → `roundEnd` → `lobby` → `round`/`matchEnd`.
`pump(nowMs)`: `acc += clamp(nowMs - lastPumpMs, 0, 5*1000/60); lastPumpMs = nowMs; while (acc >= 1000/60) { step(); acc -= 1000/60 }` — at most 5 catch-up ticks per wake (if the process stalls longer, time is dropped rather than spiralling).
`startLoop()`: self-correcting timer `h = setTimer(wake, max(0, nextDue - now()))`, `wake() { pump(now()); reschedule }`. In phase `match` the interval is 1000/60; in every other phase the loop only runs housekeeping at 4 Hz (250 ms), so an idle server burns ~0 CPU.
After creating a timer call `h?.unref?.()` (Node returns an object, browsers a number). Timer callbacks are wrapped in `try/catch`. Tests never use real timers: they advance a fake clock and call `room.step()`.

### 5.1 Seq / ack and the input queue (normative)

* `seq` is per ENTRY, strictly increasing over the entire life of the entry and **NEVER reset** at a `round` or on reconnect. The Room stores `entry.lastSeq` (highest seq accepted into the queue), `entry.appliedSeq` (highest seq popped and passed to `applyCmd`), `entry.q` (queue), `entry.credit`.
* The client sets `seq = joined.seq` every time it receives `joined` (create, join, or reconnect) and clears `pending`; afterwards it only does `seq++` per built cmd. `reset(roundMsg)` clears grid/snapshots/pending/ghosts/predicted state but does **not** touch `seq`.
* Room → World: at `startRound`, `entry.q.length = 0; entry.appliedSeq = entry.lastSeq; entry.credit = 0`, and the World is built with `lastSeq: entry.appliedSeq` for that fighter, so `ack` is continuous across rounds. `ack[id]` in a snapshot = `world.player(id).lastSeq` = highest seq passed to `applyCmd`
  (also when the cmd was ignored because of countdown/death).
* **Receive** (`in` from a human entry that is a current fighter; ignored for anyone else): after the flood guard of §4.4, per cmd: accept iff `Number.isSafeInteger(s) && s > entry.lastSeq`; then `entry.lastSeq = s` and enqueue. Gaps are legal (the client drops its backlog after a background pause). Enqueue with `q.length >= INPUT_QUEUE_MAX`:
  drop the oldest but keep its taps: `const o = q.shift(); q[0].b |= o.b; q[0].x |= o.x`. A frame from a non-current connection of the entry is ignored (`Room.receive` checks `conn`).
* **Consume** (step 3, per human fighter per tick), a catch-up policy that can never process more cmds than ticks elapsed on average:
  ```
  hold = world.state === COUNTDOWN && world.countdown <= COUNTDOWN_HOLD_TICKS
  if (hold)            { credit = min(CATCHUP_CREDIT_MAX, credit + 1) }             // cmds wait in the queue; each held tick earns one catch-up
  else {
    if (q.length)      { apply(q.shift()) } else { credit = min(CATCHUP_CREDIT_MAX, credit + 1) }   // an idle tick earns one catch-up
    if (q.length > INPUT_CATCHUP_AT && credit > 0) { credit--; apply(q.shift()) }   // ≤ 2 per tick
  }
  ```
  (Simulated: 1.000 cmds/tick at 66 cmds/s sent, 1.000 with 60 ms arrival jitter. A modified client cannot speed-hack.) When a fighter's queue is empty the World clears `moving` itself (§3.2a step 9), so remote clients do not animate a walking, stationary player. Cmds are also popped for dead players and in `ENDING`
  (the World ignores them but records `lastSeq`) so queues never back up. `waiting` entries have no queue.
* **Countdown fairness:** the last `COUNTDOWN_HOLD_TICKS` (12) countdown ticks the server holds queued cmds instead of consuming them, and the client starts sending live cmds slightly before its estimate of GO (§5.2), so a 150 ms-RTT player is not ~200 ms behind a bot or a low-latency player in the first-bomb race.

### 5.2 Client prediction (`game.js`)

* **Loop:** fixed 60 Hz accumulator: `acc += min(frameDt, 250 ms); run ≤ 6 ticks; then acc = min(acc, DT)` (the excess is dropped; never carry more than one tick). If the tab was backgrounded > 250 ms the backlog is discarded and `pending = []`.
* **Sending window.** `estCd = snap.cd − (now − snap.arrival)·0.06` (ticks) from the newest snapshot; `lead = min(COUNTDOWN_HOLD_TICKS, rtt·0.03 + 2)`. The client builds and sends cmds while it is an alive fighter and (`st ∈ {1,2}` or (`st == 0` and `estCd ≤ lead`)). The **predictor** is active iff
  alive fighter and (`st ∈ {1,2}` or (`st == 0` and `estCd ≤ 0`)); otherwise the interpolated server state is drawn. Cmds are never sent by dead players, spectators or in `over`. `pending` is capped at 180 cmds (oldest dropped).
* **Each tick:** `cmd = {s: ++seq, d, b, x}` (bomb/special are latched taps cleared by the tick that consumes them). Apply it to the predicted player: `movePlayer(pred, effectiveDir(pred, cmd.d), env)` where `env.isSolid` is `solidFor` below; append to `pending`, queue for sending.
  Flush: **once per rAF frame in which ≥ 1 tick ran**, `{t:'in', c:[[s,d,b,x]…]}` (1–6 cmds; at most 60 msg/s). This replaces any "≥ 30 Hz" rule.
* **Replay contract** (on every snapshot; `movePlayer`, `effectiveDir`, `overlapsTile` are the shared exports):
  ```
  ack = snap.ack[me];  pending = pending.filter(c => c.s > ack);  ghosts = ghosts.filter(g => g.s > ack)
  me  = COPY of my snapshot player entry (id,x,y,facing,speedLv,curse,curseTicks,alive)
  left = {}                                         // bombKey -> true once my hitbox no longer overlaps that bomb
  for c of pending (seq order):
      movePlayer(me, effectiveDir(me, c.d), { W, H, isSolid: (tx,ty) => solidFor(tx,ty,c.s) })
      for each bomb b (server bombs + ghosts with g.s <= c.s) with me.id in b.pass and !left[key(b)]:
          if (!overlapsTile(me, b.tx, b.ty)) left[key(b)] = true         // same rule and same order as World.tick: move first, then the pass update
      if (me.curseTicks > 0 && --me.curseTicks === 0) me.curse = null
  solidFor(tx,ty,s): out of range → solid; grid char !== '.' → solid ('#','X','+' from the latest grid; a FALLING sudden-death tile is NOT solid until `g` shows X);
                     a non-flying bomb at (b.tx,b.ty) → solid unless (b.pass includes me.id && !left[key(b)]); a ghost g with g.s <= s is such a bomb with pass [me]
  ```
  The `left` map carries on into the live prediction until the next snapshot. `grid` = `round.grid`, replaced by `snap.g` whenever present. Sliding bombs are solid at their snapshot `(tx,ty)`; flying bombs are never solid.
* **Reconciliation:** the replayed result becomes the predicted state. If it differs from what was displayed by < 2 tiles, keep a visual **error offset** that decays exponentially (τ ≈ 80 ms) instead of snapping; ≥ 2 tiles → snap. Kicks, throws, pickups, curses, deaths and explosions are server truth only (never predicted).
* **Ghost bombs:** `ghost = { s: cmd.s, tx, ty, pass: [me] }` with the tile at that cmd. Created iff `cmd.b && me.curse !== 'nobomb' && me.alive && (server bombs owned by me + ghosts) < bombsMax && !solidOrBombOrGhost(tx,ty)`.
  Removed iff `snap.ack[me] >= ghost.s` (the snapshot is atomic: if the server accepted the cmd, its bomb is in THIS snapshot's `b`; otherwise it was rejected), and also on `reset()`, death and `ending → over`. Ghosts are drawn until removed and swapped for the server bomb without restarting the pop animation.
  Never match ghosts to server bombs by tile (except for sound dedupe, §5.3).
* The predicted player object is a plain `{id, x, y, facing, moving, speedLv, curse /* string|null, snapshot 0 → null */, alive}` rebuilt from the snapshot entry on every snapshot.

### 5.3 Interpolation, render clock and events

* Keep a ring of the last ≥ 12 snapshots with arrival times (`if (snap.k <= lastK) return; lastK = snap.k` — `reset()` sets `lastK = -1`). **Render clock** (monotonic; smoothed against arrival jitter):
  ```js
  onSnapshot(snap, arrivalMs) {
    if (snap.k <= this.lastK) return;  this.lastK = snap.k;  push(snap, arrivalMs);
    const sample = snap.k - arrivalMs * 0.06;                               // server tick at wall-clock 0
    this.off = this.off == null ? sample
             : sample < this.off ? sample                                   // late arrival: adopt at once (buffer more)
             : this.off + 0.05 * (sample - this.off);                       // early arrival: recover slowly
  }
  getView(now) {
    let rt = now * 0.06 + this.off - INTERP_TICKS;
    rt = Math.max(rt, this.rt ?? rt);                                       // never go backwards
    rt = Math.min(Math.max(rt, buf[0].k), latest.k + 2);                    // clamp; beyond latest+2 hold still
    this.rt = rt;                                                           // then interpolate players and moving bombs at render tick rt
  }
  ```
  `INTERP_TICKS = 6` is the floor; the effective delay is 6 ticks plus the recent worst lateness. (Measured: 0 backward steps at ±0/20/40/80 ms arrival jitter; the naive re-anchoring formula stepped back up to 58 ms.)
* **What is interpolated:** only positions of players (except the local player) and of moving bombs, lerped between the bracketing snapshots by id (snap instead of lerp when the distance > 3 tiles or when `alive` flips). **Discrete state** (bombs, flames, items, falling tiles, alive, timers) comes from the NEWEST snapshot; bomb fuse and flame age are that value minus the ticks elapsed since arrival.
* **Events are dispatched IMMEDIATELY on snapshot arrival** (not at interpolated render time), in order, as copies of the wire arrays; `main.js` drains them with `takeEvents()`. A remote `death` or `left` event starts the death/poof animation at once and suppresses interpolation for that id.
  If the snapshot arrives more than 500 ms after the previous one (stall, background resume), only `go, death, left, curse, sdstart, sdland, showdown` events are kept. While `document.hidden`, `onSnapshot` keeps state but clears the event list; `takeEvents()` returns at most 200.
* **Sound dedupe for the local bomb:** when the predictor creates a ghost it queues a synthetic `['bomb', -1, me, tx, ty]` that `takeEvents()` returns at once (main.js plays `place`); a later server `bomb` event with `owner == me` whose tile matches a ghost (existing, or removed within the last 30 ticks) is dropped.

### 5.4 Connection layer (`net.js` / `main.js`), reconnect, keep-alive

* **URL:** `const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'`. Session: `sessionStorage['bp.session'] = {code, token, name, ts}` (try/catch).
* **Connect attempt:** an 8 s connect timer calls `ws.close()` if `onopen` has not fired. Backoff between attempts: 0.5, 1, 2, 3, 3, … s. **Give-up budgets:** never joined during this page load, or the last close was `closed`/1012/1001: 120 s (free hosts wake slowly); previously joined: 60 s. After that show
  "Can't reach the server" with [Try again] [Home]. UI: no `onopen` after 3 s → `showConnecting("Waking up the server… free hosting sleeps when nobody is playing. This can take up to a minute.")` with an elapsed-seconds counter; otherwise `showReconnecting(secondsLeft)`.
  A reconnect sends `{t:'join', v:1, code, token, name}`; the server re-attaches the entry and sends `joined`, `lobby`, and (if a round is running) `round` (live grid) + a full snapshot (Appendix A.4 F4).
* **Liveness:** `lastRx` is updated on ANY inbound frame. The server pings each socket every `PING_MS` (15 s) and terminates after `DEAD_MS` (35 s) without pong; the client sends `ping` every 2 s (RTT display) and declares the link dead when `now − max(lastRx, lastVisibleAt) > 8000`. The check runs in `ws.onmessage`, in the rAF loop and in a 1 s timer, and is skipped while `document.hidden`.
* **Hidden tab / resume.** `visibilitychange → hidden`: `input.releaseAll(); game.pauseSending()` (the socket stays open; WS-level ping/pong is answered by the browser). `visibilitychange → visible` / `pageshow` / `online`: `acc = 0; lastFrame = now; lastVisibleAt = now; pending = []; game.off = null`, keep only the newest 2 snapshots in the interpolation
  buffer, reset the backoff and give-up budget; if `ws.readyState !== OPEN` reconnect immediately, else send `ping` and reconnect if no `pong` within 2500 ms.
* **Server-initiated ends:** `error no_room` after a token join → clear the session; dialog "That party has ended (the server may have restarted)." [Create new room] [Home]. `closed` or close code 1012/1001 → keep retrying with the 120 s budget, then the same dialog. `version` → `location.reload()` once (guard `sessionStorage['bp.reloaded']` < 60 s old → show
  "Please refresh the page"). `full`, `locked`, `kicked` → clear the session (`kicked` never auto-rejoins). `rate_limited` → toast. A `joined` with a NEW id after a token join (the token expired) → toast "You were removed from the match" and continue as a waiting spectator. A `joined.build` different from the one the page booted with → toast "A new version is available" with a reload button.
* **Boot-time rejoin:** if `bp.session` is < 10 min old and (the URL has no code or equals `session.code`), auto-send `join` with the token and show "Rejoining…". On `joined`, `history.replaceState(null,'','/r/'+code)`; on leave, `replaceState(null,'','/')` and clear the session.
* **Keep-warm:** while in a room, `setInterval(() => fetch('/healthz', {cache:'no-store'}).catch(()=>{}), 240000)` (guarantees inbound HTTP traffic for hosts that sleep on idle).
* **HUD RTT:** from `ping/pong`, smoothed; shown as a small signal indicator. In Practice `rtt = 0`; Loopback has no ping, watchdog or reconnect.

---------------------------------------------------------------------------------------------

## 6. Bots (`shared/bots.js`)

`class BotBrain { constructor({ level, seed }); think(world, playerId) → { d, b, x } }` — pure, deterministic given the seed, and it produces the *same kind of cmd a human would* (no cheating: bots obey movement, bomb and cooldown rules). The Room stamps `s = ++entry.botSeq`.
`think` may re-plan at a lower frequency and hold its previous movement decision between ticks — `easy` re-plans every 14 ticks, `normal` every 7, `hard` every 3; `normal`/`hard` re-plan immediately when danger appears — but `b` and `x` are edge signals: they are 1 ONLY on the tick where
the action starts (held decisions return `b:0, x:0`).

Behaviour tiers:
* **all levels**: never step into flame or into a tile where a bomb will explode before they can leave; always keep an escape route before placing a bomb (BFS over walkable tiles with a time-aware danger map that includes chain reactions, built with `computeBlast`); flee when threatened.
* **easy**: wanders toward soft blocks, bombs blocks, picks up adjacent items, ~8 % random mistakes, ignores enemies unless adjacent, never kicks/throws, does not compensate for curses (funny, and covered by its self-kill allowance).
* **normal**: seeks items (safe path), bombs blocks and enemies within reach when a safe escape exists, avoids dead-ends, uses `kick` when it has it; emits its intended direction through `effectiveDir` (an involution) while its own curse is `reverse`, and never relies on standing still while `rush` (autorun).
* **hard**: predicts other players' escape options and tries to trap them (bomb when the enemy's escape set is small), uses kick/glove deliberately, camps safe pockets during sudden death (it reads `world.sdOrder`, `sdNext`, `landTick`), prefers shield/speed pickups, avoids curse pickups (skull) unless desperate, runs away from cursed neighbours; same curse compensation as `normal`.

Quality gates (tested by headless bot-only matches, §10): over 30 seeded 4-bot rounds no exception, < 12 % of deaths are self-kills for `hard`, < 25 % for `easy`; 90 % of rounds end before sudden death completes; a `hard` bot beats an `easy` bot more than 65 % of 1v1 rounds.

### 6.1 BotBrain / Room contract

* The Room creates one BotBrain per bot fighter per ROUND in `startRound` (`botFactory({ level, seed })`, seeds per §4.6) and drops it at `OVER`: no state is carried across rounds. It calls `think` once per tick, only while `world.state === STATE.PLAYING` and the bot is alive.
* `think` may read only: `world.grid, bombs, flames, items, falling, player(id), players, suddenDeath, sdOrder, sdNext, landTick, timeLeft, state, tickNo, W, H` plus the pure exports `makeEnv, computeBlast, effectiveSpeed, effectiveDir, movePlayer` (look-ahead on a COPY of the player) and constants.
  It must not mutate what it reads and must not use `Math.random`/`Date`/`performance` (it owns a `makeRng(seed)`).
* The Room wraps `think()` in `try/catch`: on an exception it uses `{d:0,b:0,x:0}` and logs once per bot per round.
* Budget: average `think()` ≤ 0.25 ms for `hard` (measured in `bots.spec.js` over a 4-bot round); 8 bots × 60 Hz must stay under 15 % of one core.
* `World` never calls BotBrain; `bots.js` never imports `room.js`. Import graph (no cycles): `constants ← rng ← mapgen ← world ← bots ← room`; `protocol ← room`.

---------------------------------------------------------------------------------------------

## 7. Server (`server/*`)

* **Factory.** `server/index.js` exports `async function startServer({ port = 0, host = '127.0.0.1', maxRooms = 200, maxConns = 400, maxConnPerIp = 24, trustProxy = 0, timeouts = TIMEOUTS, seedFn, log } = {}) → { port, url, server, wss, rooms /*RoomManager*/, close() /*graceful, awaitable*/ }`.
  The file's last lines run `startServer(fromEnv())` only when `import.meta.url === pathToFileURL(process.argv[1]).href`. Every integration spec calls `startServer({ port: 0, timeouts: { HELLO_MS: 300, PING_MS: 200, DEAD_MS: 600 } })`; `ws.js` takes its timeouts from the option, never from module constants.
* **Env** (`fromEnv`): `PORT` (default 3000; **always honour `process.env.PORT`**, Render injects it), `HOST` (`0.0.0.0`), `MAX_ROOMS` (200), `MAX_CONNS` (400), `MAX_CONN_PER_IP` (24), `TRUST_PROXY` (integer number of trusted proxy hops, default 0; `1`/`true` = 1), `LOG_LEVEL` (`info`), `ALLOWED_ORIGINS` (comma list), `ORIGIN_CHECK` (`0` disables it).
  The server refuses to start with `WEB_CONCURRENCY` > 1 or under Node `cluster`: rooms live in one process's memory. Prints friendly startup text: local URL, LAN URLs (all non-internal IPv4), and a hint about `npm run share`.
* **Routing table (exact, first match wins; GET/HEAD only, else 405):** `/` and `/index.html` → `client/index.html`; `/r/:CODE` where CODE matches `^[A-Za-z]{4}$` (one optional trailing `/`) → the same index.html bytes with `Cache-Control: no-cache` (any other `/r/*` → 404; **never** fall back to index.html for unknown paths);
  `/healthz` → `200 ok` (`503 {"status":"draining"}` while shutting down); `/api/stats` → JSON below; `/favicon.ico` → 204 with an empty body; `/shared/*` → `shared/` (only `*.js`); everything else → `client/` (whitelisted extensions only, no dotfiles, no directory listings).
  Query strings are stripped before lookup. Decoded paths containing `..`, `\`, NUL or a leading dot-segment → 400.
* **Static details:** correct MIME (text types with `; charset=utf-8`): `.js/.mjs` `text/javascript`, `.css` `text/css`, `.html` `text/html`, `.json` `application/json`, `.webmanifest` `application/manifest+json`, `.svg` `image/svg+xml`, `.png` `image/png`, `.woff2` `font/woff2`.
  `ETag` (weak) + `Cache-Control: no-cache` (`/healthz` and `/api/stats`: `no-store`; both support HEAD), gzip for text if the client accepts it (cache compressed bytes; compressed responses include `Vary: Accept-Encoding`).
* **Headers on every response, including 404s and `/api/*`:**
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob: data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
  X-Content-Type-Options: nosniff    Referrer-Policy: no-referrer    X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=(), gamepad=(self), screen-wake-lock=(self)
  Strict-Transport-Security: max-age=15552000      (ONLY when X-Forwarded-Proto is https and TRUST_PROXY is set; the app never redirects http→https itself)
  ```
  Keep `ws: wss:` in `connect-src` (Safari historically does not match same-origin ws under `'self'`). There is no inline `<script>`, no `on*=` attribute, no `eval`/`new Function`, and no blob workers.
* **HTTP hardening:** `http.createServer({ maxHeaderSize: 8192, keepAliveTimeout: 5000, headersTimeout: 10000, requestTimeout: 15000, connectionsCheckingInterval: 5000 }, handler)`; `server.maxRequestsPerSocket = 200; server.maxConnections = maxConns + 50`.
* **WebSocket at `/ws`** via `ws` with `noServer: true`, `maxPayload: 4096`, `perMessageDeflate: false`:
  ```js
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});                                          // pre-handshake resets must not crash the process
    if (pathname(req) !== '/ws') return reject(socket, 404);               // reject = write a minimal HTTP/1.1 response + socket.destroy()
    if (draining || conns >= maxConns) return reject(socket, 503);
    if (ipConns(ip) >= maxConnPerIp || prejoin(ip) >= 4) return reject(socket, 429);
    if (!originOk(req)) return reject(socket, 403);                        // log ev:'origin_mismatch'
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => { ws.on('error', () => {}); /* MANDATORY first line: an oversize frame otherwise becomes an uncaughtException */ … });
  ```
  **Origin check:** if the request has an `Origin` header, allow only when `new URL(origin).hostname` equals the `Host` header hostname (or the `X-Forwarded-Host` hostname when `trustProxy > 0`) or the origin is in `ALLOWED_ORIGINS`; otherwise 403. No `Origin` (Node test clients, curl) → allowed. The check is lenient on purpose (tunnels rewrite `Host` in some setups).
  The adapter turns each socket into a Room `conn`: the first valid `create`/`join` must arrive within `HELLO_MS` (10 s) or the socket is closed; `create` → `RoomManager.create()` then `room.join(conn, …)`; `join` → `RoomManager.find(code)` (else error `no_room`); every later frame → `room.receive(pid, frameString, conn)`;
  socket `close` → `room.disconnect(pid, conn)`; `conn.close(reason)` → `ws.close(1000, reason)` (code 4001 for `replaced`). The adapter never sends `joined`/`lobby` (the Room does).
* **Client IP.** `TRUST_PROXY` is the number of trusted proxy hops. `first-hop X-Forwarded-For` is attacker-controlled, so:
  ```js
  function clientIp(req) {
    const sock = normalize(req.socket.remoteAddress);
    if (!TRUST_PROXY) return sock;
    const h = req.headers;
    if (process.env.FLY_APP_NAME && h['fly-client-ip']) return normalize(h['fly-client-ip']);  // Fly overwrites it
    if (h['cf-connecting-ip']) return normalize(h['cf-connecting-ip']);                         // Cloudflare / cloudflared overwrite it
    const xff = String(h['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    return xff.length >= TRUST_PROXY ? normalize(xff[xff.length - TRUST_PROXY]) : sock;         // RIGHTMOST-N: entries added by our own proxies
  }   // normalize: strip '::ffff:' from IPv4-mapped addresses; key IPv6 by its /64
  ```
  The Render/Fly configs and **`scripts/share.js` set `TRUST_PROXY=1`** (tunnels add XFF and connect from 127.0.0.1). At `LOG_LEVEL=debug` the first request's raw `x-forwarded-for`/`cf-connecting-ip` is logged so the hop count can be verified. A wrong choice degrades per-IP limits only; it never breaks play.
* **Limits** (`ipKey = clientIp(req)`; the Room's per-type limits are in §4.4): `maxConns` 400 global; `maxConnPerIp` 24 counted AT UPGRADE (including sockets that never join); at most 4 pre-join sockets per IP (over → HTTP 429). **Room creation:** at most 3 live rooms created by one IP and a token bucket (burst 3, refill 1 per 20 s); over →
  `{t:'error',code:'rate_limited',msg:'Too many rooms. Wait a moment.'}`. **Failed joins** per IP (`no_room`, bad code format, `full`): more than 15 in 60 s blocks all `join` from that IP for 30 s (`rate_limited`); successful joins do not reset the counter. `maxRooms` (Render free config: 30) reached →
  error `busy` "Server is busy, try again in a minute." Household members share one public IP, so there are no IP bans; a kick revokes the token only.
* **Backpressure (per client, before each snapshot send):** `ws.bufferedAmount > 128*1024` → skip this snapshot for that client (it heals through `gv`/`sync`, §4.5; missed events are cosmetic); `> 1024*1024` → `ws.terminate()`. Critical messages (`joined, lobby, round, roundEnd, matchEnd, error`) are always sent unless the terminate threshold is hit.
  Integration test: a raw TCP client that completes the handshake and never reads is terminated within 30 s and RSS stays flat.
* **`RoomManager`:** codes are 4 letters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels → no accidental words), generated with `node:crypto` `randomInt(20)` per letter (server-only), unique (retry on collision), case-insensitive on join. It has **no timer of its own**: `Room.onEmpty` deletes the room. One self-correcting timer loop **per room** (`Room.startLoop`, not a global tick).
  Exceptions inside a room are caught and logged; the room ends its match gracefully (back to lobby with a `sys` message) rather than killing the process.
* **Logs:** one JSON line per event on stdout `{"t":ISO,"lvl":"info","ev":"…",…}`; levels `error|warn|info|debug`. Events: `boot{version,node,port,trustProxy,maxRooms}`, `conn_open/conn_close{ipk,code,ms,rx,tx}`, `room_open/room_close{room,humans,bots,rounds,ageS,reason}`, `rate_limit{ipk,kind}`, `tick_slow{room,ms}` (a tick > 8 ms, at most 1 per 10 s per room),
  `room_error{room,stack}`, `origin_mismatch`, `shutdown{reason}`. `ipk` = first 8 hex chars of `sha256(ip + bootSalt)`. **Raw IPs, names and chat text are never logged.**
* **`GET /api/stats`** (`no-store`; never includes room codes): `{"v":"1.0.0","upS":1234,"rooms":3,"players":9,"humans":6,"conns":7,"maxRooms":30,"tickMs":{"avg":0.4,"p99":1.9,"max":6.2},"droppedTicks":0,"loopLagMs":{"p99":3},"rssMB":74,"heapMB":31}` — `tickMs` over a rolling 10 s window across all rooms,
  loop lag via `perf_hooks.monitorEventLoopDelay`. The package version is `joined.build` and `/api/stats.v`.
* **Graceful shutdown.** First `SIGTERM`/`SIGINT`: `draining = true` (`/healthz` → 503, new upgrades → 503); `server.close()`; every ws gets `{t:'error',code:'closed',msg:'Server restarting'}` then `ws.close(1012,'restart')`; stop every room loop and timer (`room.close()`); after 1500 ms terminate remaining sockets; exit 0 as soon as all sockets are closed, or
  unconditionally after 8000 ms (unref'd timer). A second signal → `process.exit(1)`. `uncaughtException`/`unhandledRejection`: log with stack and keep going, but more than 5 within 60 s → log `crash loop` and `process.exit(1)` so the platform restarts a clean process.
  Test: spawn the server as a child process, connect a `ws` client, send `SIGTERM`, assert it receives `closed` and close code 1012 and that the child exits 0 in < 3 s.

---------------------------------------------------------------------------------------------

## 8. Client architecture

Data flow: `net` (WebSocket or Loopback) → `main.js` routes messages → `ClientGame` (state/prediction/interp) → `getView()` → `Renderer.render(view)`; events → `Renderer` (particles/shake) + `Audio`; lobby/HUD data → `UI`; input → `Input` → `ClientGame` (cmds). `main.js` owns all wiring (§8.6).

### 8.1 Interfaces (all ES modules, no globals except what's noted)

```js
// net.js
export class WebSocketConnection { constructor(url); send(obj); close(); onopen/onmessage(obj)/onclose(info) ; readyState }
export class LoopbackConnection  { constructor(); … same interface, plus pump(realNow)/pause()/resume(realNow), runs a Room in-page (§8.1a) }

// game.js  (NO DOM access — must be importable and testable in Node; imports movePlayer/effectiveSpeed/effectiveDir/overlapsTile/makeEnv from ../../shared/world.js)
export class ClientGame {
  constructor({ me /*player id*/, send /*fn(obj)*/, now /*fn ms*/ })
  reset(roundMsg)                      // on 'round': clears grid/snapshots/pending/ghosts/predicted state/lastK/off; does NOT touch seq (§5.1)
  setSeq(n)                            // on 'joined': seq = joined.seq, pending = []
  onSnapshot(snap, arrivalMs)
  setIntent({ d, bomb, special })      // d is overwritten each call; bomb/special are OR-latched and cleared only by the tick that consumes them, so one tap = exactly one b:1 cmd
  update(nowMs)                        // run fixed ticks: predict + queue + flush cmds (once per frame in which ≥ 1 tick ran)
  getView(nowMs) → View                // interpolated, ready to draw; fills a preallocated View (no per-frame allocation)
  takeEvents() → event[]               // events dispatched since the last call (immediate on arrival, §5.3), plus synthetic local ones
  pauseSending()                       // hidden tab (§5.4)
  rtt
}
// View: exact shape and the snapshot → View mapping are in Appendix A.2.

// render.js  (owns sprites.js and particles.js; no frozen sprite API: one agent owns all three files)
export class Renderer {
  constructor(canvas)
  resize(cssW, cssH, dpr)             // dpr already capped by main.js; rebuilds the sprite atlas when the tile size changes
  render(view, dtMs, nowMs)           // reads theme and players FROM `view` every frame and rebuilds the atlas when view.theme or the tile size changes
  handleEvents(events, view)          // spawn particles, shake, flashes, popups ("+1"), emote bubbles
  showEmote(playerId, emoteIndex)
  setTheme(name); setPlayers(info)    // optional prewarm hints, never the source of truth
  setQuality(q /*0..2*/)  stats: { fps }
}

// audio.js
export const audio = { unlock(), play(name, {pan?, vol?, rate?}), music(name|null), setVolume(v), setMuted(b), muted, volume }

// input.js
export class Input { constructor({ canvas, touchRoot }); getIntent() → {d, bomb, special}; onEmote(fn); onMenu(fn); onMute(fn); onWheel(fn);
                     setHasGlove(bool); setActive(bool); enableTouch(bool); releaseAll(); destroy() }

// ui.js  — pure view, NEVER touches network or game state
export class UI { constructor(root, callbacks); show(screen); getGameElements() → {wrap, canvas, touchRoot}; … see §8.3 }
```

#### 8.1a Loopback / Practice mode (contract)

`LoopbackConnection` implements exactly the `WebSocketConnection` interface (`send(obj)`, `close()`, `onopen`, `onmessage(obj)`, `onclose(info)`, `readyState`) and is **pump-driven and pausable**, because a hidden tab stops `requestAnimationFrame` and throttles timers:

```js
class LoopbackConnection {
  constructor() { this.virtualMs = 0; this.paused = false; this.last = performance.now(); this.outbox = [];
    this.room = new Room({ code: 'LOCAL', local: true, now: () => this.virtualMs, seed: cryptoSeed() /* crypto.getRandomValues(new Uint32Array(1))[0] */ });
    this.conn = { send: (str) => { this.outbox.push(str); queueMicrotask(() => this.drain()); }, close: (r) => queueMicrotask(() => this.onclose?.({ code: 1000, reason: r })) };
    queueMicrotask(() => this.onopen?.()); }
  send(obj) { if (obj.t === 'create') { this.pid = this.room.join(this.conn, { name: obj.name, color: obj.color }).id; } else this.room.receive(this.pid, JSON.stringify(obj), this.conn); }
  pump(realNow) {                                   // called from main.js frame() BEFORE game.update(realNow)
    if (this.paused) { this.last = realNow; return; }
    const n = Math.min(5, Math.floor((realNow - this.last) / (1000 / 60)));
    if (realNow - this.last > 100) this.last = realNow; else this.last += n * (1000 / 60);
    for (let i = 0; i < n; i++) { this.virtualMs += 1000 / 60; this.room.step(); }
    this.drain();                                    // deliver AFTER the Room finished stepping
  }
  drain() { while (this.outbox.length) { const s = this.outbox.shift(); try { this.onmessage?.(JSON.parse(s)); } catch (e) { console.error(e); } } }
  pause() { this.paused = true }   resume(realNow) { this.last = realNow; this.paused = false }
  close() { this.room.close(); }
}
```
* The Room's clock is the injected virtual `now`, so pausing freezes every timer (grace, 30 s auto-lobby, countdown pacing). Loopback **never** calls `room.startLoop()`.
* Messages are delivered outside Room code (in `drain`, never synchronously inside `Room.step` or `ClientGame.update`), so no callback re-enters the Room. `client → room` is synchronous (`Room.receive` only enqueues).
* `main.js`: `document.hidden` or `pagehide` → `loopback.pause()` and a "Paused" overlay; visible → `loopback.resume(performance.now())`. Loopback has no ping, watchdog or reconnect; `rtt = 0`; `onopen` fires (async) right after construction like a real socket.
* **Practice flow** (no special code path elsewhere): `new LoopbackConnection` → on open send `create{v:1,name}` → after `joined` send `addBot easy`, `addBot normal`, `addBot normal` → the player sees the ordinary Lobby screen (host, Add bot/Start available). `lobby.local === true` hides invite link/QR/share/copy; the code `LOCAL` is never validated by the UI.
  Leave in Practice = `close()`.

### 8.2 Rendering (render.js + sprites.js + particles.js — one owner)

* Canvas 2D, **vector cartoon style, pre-rendered sprites**: `sprites.js` builds offscreen canvases at the current tile pixel size (device pixels) and rebuilds them on `resize`/theme change. The draw loop only `drawImage`s cached sprites plus a few gradients — 60 fps on a mid-range phone.
* Fit: the arena is 15×13 tiles; `dpr = min(devicePixelRatio || 1, 2)`; `tilePx = min(96, floor(min(availWpx/15, availHpx/13)))` device px (arena backing store ≤ 1440×1248); letterbox/center; the canvas fills its container. Total canvas backing store ≤ 2.5 Mpx (else lower dpr, then tilePx).
  A themed decorative frame/backdrop surrounds the arena. Portrait phones: arena on top full width, touch controls under it.
* **Adaptive quality:** keep an EMA of frame time; if > 24 ms over 120 frames → `quality--` (0..2, never up again in the same match). Level 2 = dpr cap 2; 1 = dpr 1.5 and fewer particles; 0 = dpr 1, no glow / `'lighter'`, particle cap 60. `Renderer.setQuality(q)`.
* **Memory:** ONE atlas canvas per theme (≤ 2048×2048); at most 2 atlases alive (current + next theme); when discarding a canvas set `canvas.width = canvas.height = 0` (iOS Safari's total canvas memory limit otherwise blanks canvases); build the next round's atlas during the countdown, not on the frame that draws it.
  No per-frame allocation in render paths (`getView` fills a preallocated View; no `map/filter/spread/Object.assign/Array.from/template strings` per frame); particles live in a fixed pool (400; 200 at quality 1; 60 at quality 0); HUD DOM is updated only when a value changes, at most 10 Hz.
  A `?debug=1` overlay shows fps, rtt, dpr, tilePx, quality, atlas count, ws state and the last 5 errors.
* 2.5-D look: hard walls & soft blocks are drawn taller than a tile (extruded with a lighter top face and darker front face); everything y-sorted (`y + 0.5*height`) so characters pass behind/in front of blocks correctly. Soft, colored drop shadows under everything.
* **Themes** (5): `meadow` (green grass checker, stone pillars, wooden crates), `frost` (ice blue, snowy pillars, ice cubes), `lava` (dark basalt, glowing cracks, magma-rock blocks), `candy` (pastel pink, candy-cane pillars, gummy blocks), `night` (deep blue, neon edge-lit pillars, glowing crates).
  Each theme = palette + a few decorations (grass tufts / snowflakes / embers / sprinkles / stars) drawn in the floor variants and as ambient particles.
* **Characters** — "blasties": round chunky mascots, one per color index (`PLAYER_COLORS` in `constants.js`: `0 Red, 1 Blue, 2 Green, 3 Yellow, 4 Purple, 5 Orange, 6 Pink, 7 Cyan`; accessories on top of the head `antenna, propeller, sprout, crown, horns, flame, bow, headphones`) so colour-blind players can tell them apart.
  Animations: idle bob & blink, 4-direction walk cycle with squash/stretch and little dust puffs, place-bomb pop, hurt flash, **death** (spin + poof + ghost float up, drawn while `deadT < DEATH_ANIM_TICKS`; `left` = poof only), win cheer (jump + confetti), shield bubble (shimmer, blinks last 2 s),
  curse aura (purple skulls orbiting, screen-space tint on the local player), team ring (team 0 = coral solid ring, team 1 = teal dashed ring) under feet in team mode, name tag above (local player highlighted; `fillText(text,x,y,maxWidth=3*tile)`), emote bubbles.
* **Bombs**: glossy black with a highlight, pulsing scale that speeds up as the fuse burns, fuse spark particles, blinking red at the last 30 ticks; rolling animation while sliding; arc + shadow while flying (parabola height); owner-colour band (grey for an orphaned bomb, `owner = -1`).
* **Flames**: animated flame sprites per mask (centre, arm, tip), hot white core → yellow → orange → red gradient, flicker (≤ 8 Hz), glow (additive `lighter` composite), ember particles, brief screen flash + camera shake scaled by range.
* **Items**: little rounded tokens with icon + colored glow + bobbing, spawn pop animation, sparkle; skull is purple/menacing.
* **Sudden death**: falling blocks telegraphed with a growing shadow + warning marker, land with a shake + dust; banner "SUDDEN DEATH!"; banner "SHOWDOWN" on the `showdown` event.
* **Reduced motion and flash safety.** `reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches` (listen for changes); the "Reduce effects" setting defaults to it and is user-overridable (persisted, try/catch). When reduced: no camera shake, no screen flash, no confetti, no ambient background particles, no parallax; flames = static 2-frame animation at ≤ 4 Hz;
  particle cap 60; banners only fade; countdown digits fade (no bounce). **Always**, even when not reduced: `FLASH_MAX_ALPHA` 0.18 (white/orange overlay), ramp 100 ms, decay 250 ms, `FLASH_MIN_GAP_MS` 400 (≤ 2.5 flashes/s); no red↔white alternation; no full-screen strobe; `SHAKE_MAX_PX` 6 css px, ≤ 250 ms, decaying.
  Unit test: a Renderer fed 20 `boom` events within 1 s emits at most 3 flashes.
* **HUD** is DOM in `ui.js` (crisp text): top timer, player chips (avatar swatch with accessory glyph, name, wins ★, power stats icons, skull/shield status, dead greyed), ping indicator, round banner, big countdown numbers 3-2-1 and a "GO!" banner, "WINNER" banner with confetti, kill-feed toasts
  ("Dad blasted Mom", "Ana blew herself up"), emote wheel button, mute button.

### 8.3 UI screens (ui.js, index.html, style.css)

Look & feel: bold, rounded, friendly, colorful; big tap targets; works from 320 px wide phones to 4K TVs; light gradients & subtle animated background (floating bombs / confetti); no external fonts or assets (system font stack with a heavy rounded feel:
`"Baloo 2","Fredoka","Trebuchet MS","Avenir Next Rounded",system-ui,sans-serif` — fallback is fine); dark theme by default. App icons are the only image assets (below).

Screens:
1. **Title/Home**: logo "BLAST PARTY" (CSS-styled with bomb), name field (remembered), buttons: **Create room**, **Join room** (4-letter code input, auto-uppercase, paste-friendly), **Practice vs bots**, **How to play** (modal with controls for keyboard/touch/gamepad and item guide), settings (volume, mute, reduce effects, controls side).
   If the URL is `/r/CODE` (or `#CODE`): the Join box is pre-filled and focused.
2. **Lobby**: room code huge + **Copy invite link** / **Share** (Web Share API when present) / QR code (an optional feature: the lobby draws it only when `shared/qr.js` exists; if implemented it exports `qrMatrix(text) → boolean[][]`, byte mode, ECC L, versions 1–6 = up to 106 bytes, hidden for longer text; the same module is used by `scripts/share.js`), player list with colored avatars (accessory glyph), host crown, bots with level chips,
   kick (host), color picker (taken colors dimmed), team picker (team mode), name edit, **Add bot** (easy/normal/hard), settings panel (host edits; others see read-only) including a **Lock room** toggle, chat, **Start match** (host; disabled with reason), **Leave**. Connection/ping indicator.
3. **Game HUD** overlaying the canvas (see above) + pause-free (multiplayer) **menu button** (leave match, mute, how to play) — Esc toggles.
4. **Round end overlay**: winner card with confetti; scores.
5. **Match results / podium**: standings with medals, awards ("Demolition Expert" most blocks, "Bomb Squad Casualty" most self-kills, "Terminator" most kills, "Collector" most items, "Survivor" fewest deaths — show only awards with distinct non-zero winners),
   buttons **Play again** (host) / **Back to lobby**, chat stays open. A `matchEnd` with `reason:'not_enough_players'` shows "Not enough players - match ended".
6. Toasts/dialogs: connecting…, waking up the server, reconnecting (with countdown), kicked, room not found/full/locked, host changed, "That party has ended", "Paused" (Practice, hidden tab).

`UI` callbacks (all optional-chained): `onCreate(name)`, `onJoin(code,name)`, `onPractice(name)`, `onProfile({name?,color?,team?})`, `onSettings(patch)`, `onAddBot(level)`, `onRemoveBot(id)`, `onKick(id)`, `onStart()`, `onChat(text)`, `onEmote(e)`, `onLeave()`, `onBackToLobby()`, `onMute(bool)`, `onVolume(v)`, `onToggleEffects(bool)`.
Render methods (called by main.js): `showTitle({name,code,error})`, `showConnecting(text)`, `showLobby(lobbyMsg)`, `showGame({players})`, `updateHud(hudModel)`, `setPing(ms)`, `showCountdown(text|null)`, `showRoundEnd(roundEndMsg, lobbyPlayers)`, `showResults(matchEndMsg)`, `toast(text, kind)`, `killfeed(text)`, `addChat({from,name,text})`, `showMenu(bool)`, `showReconnecting(secondsLeft|null)`, `getGameElements()`.
`hudModel` and the glue rules are in §8.6.

**index.html / CSS contract (mobile).**
```html
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#14102a"><meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Blast Party">
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/icons/icon.svg"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<div id="boot" role="status">Loading Blast Party...</div>
<script src="/js/boot.js"></script>                 <!-- classic ES5 script, no modules, no eval -->
<script type="module" src="/js/main.js"></script>
<script nomodule src="/js/legacy.js"></script>      <!-- replaces #boot text with the too-old-browser message -->
```
Do NOT set `maximum-scale`/`user-scalable=no` (blocks low-vision zoom). The game container is `<div id="game"><canvas id="arena"></canvas><div id="touch"></div></div>`.
```css
html,body{margin:0;height:100%;overscroll-behavior:none;background:#14102a;-webkit-text-size-adjust:100%}
.app{position:fixed;inset:0;height:100vh;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.screen{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}            /* lobby/results scroll; the game does not */
button,a,label,select{touch-action:manipulation}                                                /* kills double-tap zoom in menus */
#game,.touch-zone{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
input,textarea,select{font-size:16px}                                                            /* <16px triggers iOS focus-zoom */
.room-code,.invite-link{user-select:all}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}
```
* **Sizing:** the canvas container uses a `ResizeObserver` (not `window.resize`); on `orientationchange` re-measure after two rAFs and again after 300 ms; also listen to `visualViewport.resize` and set `--app-h` from `visualViewport.height` so the chat input stays above the iOS keyboard.
* **Back gesture guard:** when entering a room call `history.pushState({bp:1},'',location.href)`; on `popstate` while in a room push again and `ui.showMenu(true)`; never leave the page. The joystick activation zone starts at `max(28px, env(safe-area-inset-left))` from the left edge and ends 28 px from the right edge; `gesturestart` is `preventDefault`ed only while the game screen is active.
* **Layout:** portrait = arena on top, controls below. Landscape = arena centered with joystick and BOMB overlaying the left/right margins (their hit areas may overlap empty letterbox only, never the centre 60 % of the play field).
* **Feature-detect everything** (the "same Wi-Fi" URL `http://192.168.x.x:3000` is NOT a secure context: `navigator.clipboard`, `share`, `wakeLock`, `crypto.randomUUID`, `crypto.subtle`, `serviceWorker` and the Gamepad API may be missing). Client code must not use `crypto.randomUUID`, `crypto.subtle`, `clipboard.readText`, `Notification` or `serviceWorker`
  unguarded; `crypto.getRandomValues` is allowed.
  ```js
  async function copyText(t) {
    try { if (window.isSecureContext && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true; } } catch {}
    const ta = Object.assign(document.createElement('textarea'), { value: t, readOnly: true });
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, t.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;          // on false: select the visible readonly invite <input> and toast "Press Ctrl/Cmd+C"
  }
  ```
  The invite link and room code are always shown as selectable text. The **Share** button is rendered only if `typeof navigator.share === 'function'` and calls `navigator.share({title,text,url})` synchronously inside the click handler (no `await` before it; swallow `AbortError`). Wake lock: if `'wakeLock' in navigator` request `'screen'` when a match starts,
  re-request on `visibilitychange → visible`, wrapped in try/catch. Gamepad only if `navigator.getGamepads` exists (How-to-play says "Controllers need the https link (use `npm run share`) or localhost" when `!isSecureContext`). Fullscreen button only if `document.fullscreenEnabled || document.webkitFullscreenEnabled`
  (absent on iPhone; show a one-time hint "Tap Share, then Add to Home Screen for full-screen play"). Never call `screen.orientation.lock`; support both orientations.
* **Accessibility contract.** Each screen is a `<section hidden aria-labelledby=…>` with an `<h1 tabindex="-1">`; `ui.show(screen)` unhides one, hides the others and focuses the new h1 (title screen: the name input on first visit). Modals are `role="dialog" aria-modal="true"` with a focus trap, Esc to close, focus restored to the opener.
  One `<div role="status" aria-live="polite" class="sr-only">` receives join/leave/host change, countdown "3, 2, 1, Go", "You were blasted by X", "Sudden death", round winner, reconnecting; kill feed and toasts are polite; chat is `role="log" aria-live="polite"` in lobby/results and `aria-live="off"` during a match.
  The player list is a `<ul aria-label="Players">` whose `<li>`s carry visually hidden text such as "Ana, Blue with propeller, host, connected, 2 wins"; swatches are `aria-hidden`; the colour picker is `role="radiogroup"` with `role="radio"` + `aria-checked`, taken colours `aria-disabled="true"`, labels like "Blue - propeller".
  `<canvas role="img" aria-label="Game arena">`; the HUD is DOM text. **Never colour alone:** team 0 ring solid + letter "A" in the HUD chip, team 1 ring dashed + "B"; shield/curse/dead each have an icon AND text (`title` + `aria-label`). Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text/icons; `:focus-visible{outline:3px solid #ffd23f;outline-offset:2px}` on all controls.
  Targets ≥ 48×48 css px with ≥ 8 px gaps; BOMB button diameter `clamp(88px, 22vmin, 128px)`; setting "Controls side: right-handed (default) | left-handed" swaps joystick and BOMB (persisted); HUD text ≥ 14 px at 320 px width, scaled with `clamp()` up to 4K/TV. All controls are real `<button>`s so a TV remote's spatial navigation works.
  User text is rendered with `textContent` inside `<bdi>` (or `unicode-bidi:isolate`); chips use `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`; chat uses `overflow-wrap:anywhere;unicode-bidi:plaintext`; chat is never linkified.
* **Boot fallback (CSP-safe).** `boot.js` (ES5 only): `window.addEventListener('error', fn, true)` records `e.message` and shows it in `#boot`; an 8 s watchdog: if `window.__bpReady` is not set (`main.js` sets it and removes `#boot` when the title screen is shown), replace `#boot` with "Blast Party could not start. It needs iPhone/iPad iOS 16+, Chrome 90+, Firefox 100+ or Edge 90+. Please update your browser."
  plus the recorded error text in a `<pre>`. `legacy.js` (nomodule) shows the same message at once. `?debug=1` toggles the small on-screen overlay of §8.2.
* **Manifest and icons.** `manifest.webmanifest`: `{"name":"Blast Party","short_name":"Blast Party","id":"/","start_url":"/","scope":"/","display":"standalone","display_override":["fullscreen","standalone"],"orientation":"any","background_color":"#14102a","theme_color":"#14102a","icons":[{"src":"/icons/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"/icons/icon-512.png","sizes":"512x512","type":"image/png"},{"src":"/icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"},{"src":"/icons/icon.svg","sizes":"any","type":"image/svg+xml"}]}`.
  iOS needs a PNG `apple-touch-icon` (180×180). The ops agent writes `scripts/make-icons.mjs` (pure Node PNG encoder with `zlib` + CRC32, drawing a bomb glyph) and commits the outputs under `client/icons/` (exception to the "no image assets" rule: app icons only). No service worker in v1.

### 8.4 Input

* **Keyboard — match on `e.code`, never `e.key`** (AZERTY, Shift-uppercase and Android `Unidentified` all break `key`): Up `ArrowUp|KeyW`, Right `ArrowRight|KeyD`, Down `ArrowDown|KeyS`, Left `ArrowLeft|KeyA` (last pressed axis wins; opposite keys cancel; `KeyW/A/S/D` are physical positions, so AZERTY players use Z Q S D);
  Bomb `Space|Enter|NumpadEnter|KeyJ|Numpad0`; Special (glove) `KeyE|KeyK|ShiftLeft|ShiftRight` (How-to-play lists E as primary because mashing Shift 5× triggers Windows Sticky Keys); Emote n `Digit1..Digit6|Numpad1..Numpad6`; Wheel `KeyT`; Mute `KeyM`; Menu `Escape`.
  If `e.code` is empty (old TV browsers) map `e.keyCode`: 37–40 arrows, 87/65/83/68 WASD, 13 Enter, 32 Space, 69 E, 16 Shift, 27 Esc, TV back 10009 (Tizen) / 461 (webOS) → Menu. Ignore the event if `e.repeat` (edge actions), `e.isComposing`, `e.ctrlKey||e.metaKey||e.altKey`, or the target is `input/textarea/select/[contenteditable]`.
  While the game screen is active `preventDefault()` every mapped key and call `document.activeElement?.blur()` on entering the game (so a focused button cannot receive Space/Enter). Release all keys on `blur`, `visibilitychange`, `pagehide`, `contextmenu`.
* **Touch:** left **floating joystick** (appears where the thumb lands in the left 45 % of the screen, 4-direction with hysteresis & dead-zone), right **BOMB** button (big, bottom-right, haptic `navigator.vibrate(10)` where supported), a smaller **special** button (shown only when the player owns the glove: `setHasGlove`) and an emote button. Pointer Events with `setPointerCapture`, tracked per `pointerId`; multi-touch safe;
  `touch-action:none`; `contextmenu` and `selectstart` are `preventDefault`ed on the game screen. On `pointercancel`, `lostpointercapture`, `touchcancel`, `blur` and `visibilitychange`: release the joystick (`d=0`) and clear latched bomb/special.
* **Gamepad** (`navigator.getGamepads?.()` each rAF, first connected pad): `buttons[0]`,`[1]` bomb; `[2]`,`[3]` special; `[9]` Start → menu; `[12..15]` D-pad up/down/left/right; `axes[0..1]` pick the dominant axis, engage when |v| > 0.5, release when |v| < 0.35 (hysteresis); bomb/special are edge-triggered. When `mapping !== 'standard'` use the same indices best-effort, no error.

### 8.5 Audio (audio.js) — all synthesized

Sound names (must all exist; unknown names are silently ignored): `place, explode, block, pickup, pickup_bad, kick, throw, land, death, shield, curse, countdown, go, win_round, win_match, lose_match, sudden_death, warning (last-10-seconds tick), click, join, leave, emote, chat, error`.
Music tracks `menu`, `battle`, `battle_fast` (sudden death), `victory`: procedurally sequenced chiptune loops (square/triangle/noise, look-ahead scheduler), cheerful, ≤ 18 % master gain by default. Master gain + mute persisted in `localStorage` (try/catch), voice limiting (≤ 24 concurrent), stereo pan from arena x-position, tiny random pitch variation. Never throws if `AudioContext` is unavailable.
**Autoplay policy / iOS:**
```js
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];          // NOT touchstart / pointerdown (iOS does not treat them as unlock gestures)
function arm() { GESTURES.forEach((e) => document.addEventListener(e, tryUnlock, { capture: true, passive: true })); }
function tryUnlock() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  ctx.resume?.();
  const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);   // iOS needs a started source inside the gesture
  if (ctx.state === 'running') GESTURES.forEach((e) => document.removeEventListener(e, tryUnlock, true));
}
ctx.onstatechange = () => { if (ctx.state !== 'running') arm(); };      // covers 'suspended' and iOS 'interrupted'
document.addEventListener('visibilitychange', () => document.hidden ? (music.pause(), ctx?.suspend()) : (arm(), ctx?.resume()));
if (navigator.audioSession) navigator.audioSession.type = 'playback';   // where supported: plays even with the iPhone silent switch on
```
`play()` before the context is running is silently dropped, never queued; the music look-ahead scheduler is paused while hidden; the first unlock gesture must not depend on a sound, and UI clicks still work if audio is unavailable. How-to-play text: "No sound on iPhone? Turn off the silent switch."

### 8.6 Glue contract (`main.js` owns all wiring)

* `ui.getGameElements()` → `{wrap, canvas, touchRoot}`. `main.js` creates `Renderer(canvas)`, `Input({canvas, touchRoot})` and a `ResizeObserver` on `wrap` that calls `renderer.resize(w, h, Math.min(devicePixelRatio, 2))`. `input.js` creates its own touch DOM inside `touchRoot` and injects its own `<style id="bp-input-style">`; `style.css` must not style `.bp-touch*`.
  `main.js` calls `input.setHasGlove(view.me.glove)` and `input.setActive(false)` on non-game screens (no key capture, touch hidden).
* `hudModel` is built by `main.js`: `players` in `round.players` order; static `name,color,team,isBot` from `round`; `alive,bombsMax,range,speedLv,kick,glove,curse` from `View.players`; `shield = max(shield, spawnShield)`; `wins,connected,waiting` from the latest `lobby` entry with the same id; `isMe = (id === me)`;
  `timeLeftSec = r < 0 ? null : Math.ceil(r/60)`; `state = ['countdown','playing','ending','ending'][st]`. Full shape: `hudModel = { roundNo, winsNeeded, timeLeftSec|null, suddenDeath, state:'countdown'|'playing'|'ending', mode, players:[{id,name,color,team,alive,wins,bombsMax,range,speedLv,kick,glove,shield,curse,isBot,isMe,connected,waiting}] }`.
* `lobby.players[].wins` is authoritative for wins. The server always sends `roundEnd` BEFORE the `lobby` that carries the new wins (§5.0). `showRoundEnd` may use `roundEnd.scores` for the overlay and never for the HUD.
* **Sound triggers (main.js):** events per Appendix A.3 (`bomb→place, boom→explode (pan by x), block, pickup→pickup or pickup_bad when kind==='skull', kick, throw, land, death, shieldhit→shield, curse (kind≠0), go, sdstart→sudden_death`); `roundEnd → win_round`; `matchEnd → win_match` (me among the winners) else `lose_match`;
  `cd` crossing 180/120/60 → `countdown`; `r` crossing 600, 540, …, 60 (last 10 s) → `warning`; `lobby` diff → `join`/`leave`; UI callbacks → `click`/`error`; `chat`, `emote` → `chat`, `emote`. `audio.unlock()` is armed at boot (§8.5).

---------------------------------------------------------------------------------------------

## 9. Security & robustness checklist

* `parseClientMessage` validates type, shape, ranges, string lengths and array sizes (§4.4), and rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`) at any depth; unknown types are ignored.
* Names/chat are sanitized by `sanitizeText` (§4.2) and rendered with `textContent` only (never `innerHTML` with user data), inside `<bdi>`; chat is never linkified.
* Bounded everything: rooms, connections (global, per IP, pre-join), players, queue lengths (`INPUT_QUEUE_MAX`), chat history (last 50), banned tokens (16), events per snapshot (128), message size (4 KB), `ws.bufferedAmount` (§7).
* A throwing handler never kills the process or stalls a room: every public `Room` method, every timer callback and every fan-out send is wrapped in `try/catch` (§4); `ws` sockets always have an `'error'` listener; `uncaughtException`/`unhandledRejection` are logged (crash-loop guard in §7).
* Static server: no path escapes (`..`, encoded `%2e`, backslashes, NUL), GET/HEAD only, whitelisted extensions, no dotfiles (§7).
* Room codes are not secrets (20⁴ = 160 000 possibilities, rate-limited enumeration, `locked` setting). **Tokens** are 16 random bytes as 32 hex chars from `globalThis.crypto.getRandomValues` (works in Node ≥ 20 and in browsers including plain-http contexts; `room.js` must not import `node:crypto` or use `Buffer`; `Room` accepts an injectable `genToken`).
  Room codes are generated in `server/lobby.js` with `node:crypto` `randomInt`. Token comparison is case-sensitive exact match; tokens are never logged and never sent in `lobby` or `snap`; tokens are never derived from seeds.
* Cross-site abuse: WebSocket `Origin` check (§7). Logs contain no raw IPs, names or chat.
* No PII stored; nothing persisted to disk.

---------------------------------------------------------------------------------------------

## 10. Testing (`specs/`) — what "done" means

**Unit** (`node:test`, no network, fake clock, `room.step()`): 
* `constants`: every name of §3 is exported. `rng`: determinism. `mapgen`: invariants of §3.1 over 200 seeds × 3 densities × 2 layouts (border, pillars, safe zones, 4-fold symmetry of grid and drops, connectivity, first-bomb escape for all 8 slots).
* `movePlayer` (§3.5 tests: free move, wall clamp for every tile side and speed level, corner slide both ways, bomb solid/pass, speed scaling, EPS edge cases, no tunnelling at max speed, 50 000-tick random walks incl. 3-decimal rounding).
* Tick order and bombs/flames (§3.2a, §3.6a–d): range, wall stop, block destroy, drop, fresh-item survival, chain reaction in one tick, order-independent chains, one destruction per block, flame lethal for exactly 36 consecutive kill checks, a placed bomb explodes in the 150th tick, a bomb placed/kicked/landed onto a lingering flame explodes in that tick,
  shield boundary, two deaths on one tick = draw, kill credit (enemy vs own goal vs teammate vs orphaned bomb), spam curse still fires with an empty input queue.
* Kick (player standing on a bomb cannot kick it; kick refused when a fighter overlaps the far tile; offsets 0.0–0.49 all kick; a fighter stepping in front of a sliding bomb stops it at a tile centre without overlap or backwards jump; holding the key against a bomb with a player behind it emits no repeated `kick` events), glove landing rules (wall in front, occupied target, BFS fallback, two bombs one tile),
  curses & transfer (one hop per tick, skull never re-rolls to the same curse), `effectiveDir` (predicted position equals server position over 300 ticks of `reverse` and of `rush`).
* Sudden death: the spiral covers every non-wall cell exactly once and terminates; landing kills hitbox-overlappers (a fighter overlapping a tile that lands never walks through it); survivors are never crushed during `ENDING`; total duration 952 ticks (classic). Outcome lock (draw, team win, last-second double-KO, timeout with `suddenDeath` off, `roundTime` 0 with two idle fighters → draw at `MAX_ROUND_TICKS`), showdown (1 human + 3 bots, human dies at tick 600 of a 120 s round → `timeLeft` becomes 900).
* `snapshot`: completeness, JSON round-trip, `snapshot()` is a pure read (calling it between two broadcasts while a block is destroyed still leaves `g` in the next broadcast; events are not stolen), mean ≤ 1.2 KB / p99 ≤ 4 KB with 4 humans + 4 bots.
* Protocol: fuzz (10 000 random/malformed payloads never throw); `sanitizeText` against hostile inputs (RLO attack, all-ZWSP, all-U+3164, lone surrogate, 3× family emoji, 30-mark zalgo, flag sequences).
* `determinism.spec.js`: two Worlds with the same seed and the same scripted cmd stream produce byte-identical `JSON.stringify(snapshot())` at every tick over 1800 ticks, and the SHA-1 of the concatenation equals `specs/fixtures/determinism.sha1` (regenerated deliberately when rules change). `isomorphic.spec.js` and `naming.spec.js` (§0.4, §0.5, §1.1).
* Room state machine (join/leave/host migration/team mode/settings/start/rounds/match end/rejoin/waiting spectators/rate limits/`locked`/kick+ban/capacity eviction/grace/leavers §4.3a/not_enough_players/match cap/idle close/timers cleared on `close()`) using fake `conn`s; a `conn` whose `send()` throws does not stop the others; a stale `close` does not mark a reattached entry disconnected;
  seq continuity across rounds and reconnects (a client can never be frozen), stale `in` frames from a replaced socket are ignored, input policy (1.000 cmds/tick at 66 cmds/s, countdown hold).
* Bots (gates in §6, budget of §6.1). Client: `ClientGame` prediction (with a lag/jitter-simulating fake link against a real Room: predicted vs server position error < 0.05 tile in steady state, converges within 300 ms after a forced teleport; replay with `pass`/`left`; ghost lifecycle incl. a rejected placement; `reverse` for 300 ticks),
  render clock (0 backward steps at ±0/20/40/80 ms jitter), event dispatch/dedupe, `Renderer` flash limit (§8.2).

**Integration** (real `ws`, `startServer({port:0, timeouts:{HELLO_MS:300, PING_MS:200, DEAD_MS:600}})`): full flow create → join ×3 → bots → start → play scripted inputs → match end → back to lobby; reconnect with token (also: a lone host disconnected for 100 s in lobby reconnects and is still host of the same room; a second socket with the same token replaces the first);
host migration; kicked; invalid messages; oversize payload (no crash); per-IP cap, room-creation and failed-join limiters (4th `create` in a row from one IP fails; 25 `join`s to a nonexistent code hit the limiter); graceful shutdown (child process); static server security (traversal attempts), `/healthz`, `/r/CODE`, and `static.spec.js`:
`GET /r/KQXZ` returns index.html and every URL referenced from it starts with `/` and returns 200 with the right MIME; a raw TCP client that never reads is terminated (§7); leak test (run with `--expose-gc`): create/close 500 rooms and play 20 short matches, assert `rooms.size === 0`, no room timers left and heap growth < 20 MB after `gc()`.
`npm test` must be green and complete in < 60 s.

**E2E** (Playwright, headless Chromium from `/opt/pw-browsers`, launched with `--no-sandbox`; not part of `npm test`, not run in CI): 3 browsers in one room incl. a mobile-emulated touch client; screenshots of every screen; canvas pixel sanity (non-blank, arena visible); no console errors/uncaught exceptions;
keyboard play moves the local blastie and places a bomb that explodes; Practice mode plays and pauses in a hidden tab; **cross-engine determinism**: a scripted 5000-tick, 4-player-plus-bots match run in Node and in headless Chromium yields the same SHA-256 of the concatenated JSON snapshots;
60 s soak with 8 participants: server tick p99 < 4 ms on the dev machine, `/api/stats.tickMs.p99` reported.

### 10.1 Seams, helpers and ownership

* Seams: `Room` takes `now/setTimer/clearTimer/botFactory/seed/genToken/timeouts`; `ClientGame` takes `now/send`; `startServer` takes `timeouts/seedFn/log`; nothing in `shared/` or `client/game.js` reads a global clock or RNG.
* One owner per file (two agents must never write the same spec file; node runs spec files in parallel processes). Unit specs are named after the module: `specs/unit/{constants,rng,mapgen,world,protocol,snapshot,determinism,naming,isomorphic}.spec.js` = core; `room.spec.js, lobby.spec.js, http.spec.js` = server; `bots.spec.js` = bots;
  `game.spec.js, input.spec.js, net.spec.js` = client (`game.spec.js` includes prediction against a real Room); sprite/render specs only if they run under Node with a fake canvas (render). Integration `specs/integration/{flow,reconnect,security,static,shutdown}.spec.js` = server. E2E `specs/e2e/*.e2e.mjs` + `run.e2e.mjs` = ui.
* Helpers (nobody else creates files in `specs/helpers`): `fake-conn.js` (`class FakeConn {sent:string[], closed:false, send(s), close(r), msgs(type)}`), `fake-clock.js` (`now()`, `advance(ms)`), `room-fixtures.js` (`makeRoom({seed:1})`, `joinN(room,n)`, `runUntil(room, pred, maxTicks)`), `ws-client.js` = server; `fake-link.js` (latency/jitter/loss link between `ClientGame` and `Room`, driven by `fake-clock`) = client;
  `pw.js` = ui.
* **Playwright loader** (ESM `import 'playwright'` fails because the only install is global and ESM ignores `NODE_PATH`): `specs/helpers/pw.js` uses `createRequire` and resolves `playwright` from `[process.env.PLAYWRIGHT_MODULE_DIR, execSync('npm root -g').toString().trim(), '/opt/node22/lib/node_modules']`, with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`;
  if the module or the browser is missing, `run.e2e.mjs` prints `SKIP` and exits 0.
* Golden fixtures `specs/fixtures/{snap,round,lobby}.example.json` (from Appendix A) are written by the lead before implementation starts, so client and bot agents can test their parsers without waiting for `World`.

---------------------------------------------------------------------------------------------

## 11. Deployment & docs (`ops`, `docs` agents)

Rooms live in one process's memory: **Blast Party requires exactly ONE instance.**

* `Dockerfile`:
  ```dockerfile
  FROM node:22-alpine
  ENV NODE_ENV=production PORT=3000
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci --omit=dev && npm cache clean --force
  COPY client ./client
  COPY server ./server
  COPY shared ./shared
  USER node
  EXPOSE 3000
  HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD sh -c 'wget -qO- http://127.0.0.1:${PORT:-3000}/healthz >/dev/null || exit 1'
  CMD ["node","server/index.js"]
  ```
  `.dockerignore` excludes `node_modules docs specs scripts .git *.md`.
* `fly.toml`:
  ```toml
  kill_signal = "SIGTERM"
  kill_timeout = 10
  [env]
    PORT = "3000"
    TRUST_PROXY = "1"
    MAX_ROOMS = "100"
  [deploy]
    strategy = "immediate"                 # never run old+new side by side (rooms are per-process)
  [http_service]
    internal_port = 3000
    force_https = true
    auto_stop_machines = "stop"
    auto_start_machines = true
    min_machines_running = 0               # open WS connections keep the machine up
    [http_service.concurrency]
      type = "connections"
      soft_limit = 200
      hard_limit = 250
    [[http_service.checks]]
      method = "GET"
      path = "/healthz"
      interval = "15s"
      timeout = "3s"
      grace_period = "10s"
  [[vm]]
    size = "shared-cpu-1x"
    memory = "256mb"
  ```
  README step: `fly launch --ha=false --no-deploy`, then `fly scale count 1`.
* Repo-root `render.yaml`:
  ```yaml
  services:
    - type: web
      name: blast-party
      runtime: node
      plan: free
      rootDir: bomberman
      buildCommand: npm ci --omit=dev
      startCommand: node server/index.js
      healthCheckPath: /healthz
      autoDeploy: true
      buildFilter: { paths: ["bomberman/**"] }      # repo-root-relative: ignore commits to the Electron app
      envVars:
        - { key: NODE_VERSION, value: "22" }
        - { key: TRUST_PROXY, value: "1" }
        - { key: MAX_ROOMS, value: "30" }           # the free instance has ~0.1 vCPU
        - { key: LOG_LEVEL, value: info }
        # do NOT set PORT: Render provides it and the server honours process.env.PORT
  ```
* `.github/workflows/bomberman.yml` (never modify the root `build.yml`):
  ```yaml
  on:
    push:         { paths: ['bomberman/**', '.github/workflows/bomberman.yml'] }
    pull_request: { paths: ['bomberman/**', '.github/workflows/bomberman.yml'] }
  jobs:
    test:
      runs-on: ubuntu-latest
      defaults: { run: { working-directory: bomberman } }
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm, cache-dependency-path: bomberman/package-lock.json }
        - run: npm ci
        - run: npm test
  ```
* `npm run share` (`scripts/share.js`):
  1. Spawn `node server/index.js` with env `{PORT, TRUST_PROXY:'1'}`; poll `GET http://127.0.0.1:PORT/healthz` until 200 (≤ 10 s).
  2. Pick a tunnel (skip a candidate when `spawnSync(cmd,['--version'])` reports ENOENT): (a) `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:PORT` — read BOTH stdout and stderr (the URL is on stderr), URL regex `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i`; if nothing connects within 15 s retry once with `--protocol http2` (QUIC/UDP 7844 is blocked on many networks);
     (b) `ssh -T -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 80:127.0.0.1:PORT nokey@localhost.run`, URL regex on the merged output `/https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)/i` (do not depend on the surrounding sentence).
  3. After a URL is found, poll `GET <url>/healthz` every 1.5 s (≤ 60 s) and print the banner ONLY after it returns 200 (the URL is printed by the tool before it is reachable).
  4. Banner: the base URL in large text, a real terminal QR (`shared/qr.js`, half-block characters `▀ ▄ █`, 2-module quiet zone; omitted when `shared/qr.js` is not implemented), and "Start a room, then share the invite link the lobby shows (`<url>/r/XXXX`)" (the room code does not exist yet, so no full invite link is printed).
  5. If the tunnel process exits: print "Tunnel closed: the public link is dead. Press Ctrl-C and run again." (free tunnel URLs change on every start, so no auto-restart).
  6. Cleanup on SIGINT/SIGTERM/exit: kill both children (`child.kill('SIGTERM')`; on win32 also `spawnSync('taskkill',['/pid',pid,'/t','/f'])`).
  7. If no tunnel tool is found print per-OS install hints (macOS `brew install cloudflared`, Windows `winget install Cloudflare.cloudflared`, Debian/Ubuntu: link to the cloudflared `.deb` release, plus the ssh option) and the same-Wi-Fi URLs.
* README: what it is, screenshot(s), controls, items/curses, rules, **3 ways to play with family** (same Wi-Fi / `npm run share` / deploy to Render or Fly in 5 minutes), config env vars, architecture overview, how netcode works (short), testing, troubleshooting, credits/licence. Written for a non-expert. It must state the real limits and pitfalls:
  same Wi-Fi: the OS firewall prompt (allow Node), guest/"client isolation" Wi-Fi blocks phones, use the printed `192.168.x.x` URL, and on plain `http://` there is no clipboard/share/controller support (copy the link manually); iPhone: sound needs the silent switch off, use Add to Home Screen for full screen (no fullscreen API on iPhone), open the invite link in Safari if an in-app browser misbehaves;
  Render free: sleeps after 15 min idle, the first load takes up to a minute (open the link about a minute before playtime), free CPU is small (keep to a few rooms); Fly: needs a card (a few dollars a month) and must be a single machine (`--ha=false`); `npm run share`: tunnel URLs change every run, needs `cloudflared` or `ssh`;
  "The party ended" after a deploy/restart = rooms live in memory, create a new room; browser support (iOS 16+, Chrome 90+, Firefox 100+, Edge 90+) and the `?debug=1` overlay; privacy: nothing is stored, IPs are hashed in logs, room codes can be guessed so use the Lock room toggle once everyone has joined.
* E2E soak pass criterion is in §10.

---------------------------------------------------------------------------------------------

## Appendix A: World API / snapshot / events / flows

### A.1 World API (`shared/world.js`) — normative; Room, BotBrain, ClientGame and tests use ONLY this

Exports: `World, movePlayer, effectiveSpeed, effectiveDir, overlapsTile, makeEnv, computeBlast` (`STATE` lives in `constants.js`).

```
new World({ seed, fighters, mode, layout, blocks, items, theme, roundTime, suddenDeath })
  seed: uint32 round seed.  theme: a concrete theme, never 'random' (the Room resolves it).  roundTime: seconds, 0 = unlimited.
  fighters: [{ id, name, color, team, isBot, lastSeq }], 2..8 entries, distinct non-negative ints in lobby order; lastSeq = entry.appliedSeq (§5.1).
  Constructor order (RNG draw order is normative, so runs are reproducible):
    rng = makeRng(seed); { grid, spawns, drops } = generateMap({ layout, blocks, items, numFighters: fighters.length, rng });
    slots = rng.shuffle([0..N-1]) → fighter i gets slots[i]; EXCEPT team mode with exactly two teams of two: team 0's fighters are shuffled over [0,1], then team 1's over [2,3] (team 0 first);
    a fighter starts at the centre of SPAWN_SLOTS[slot] with facing 2; state = COUNTDOWN; countdown = COUNTDOWN_TICKS; tickNo = 0.
  Later draws from the same rng: only the skull curse pick (rng.pick(CURSE_KINDS without the current one)). Block drops are pre-rolled by mapgen, so no other RNG call exists.

Read-only state (plain data; nobody outside world.js mutates it)
  W, H (15, 13)      grid: Array of 195 one-char strings ('.', '#', '+', 'X')      gridVer: uint, ++ on every cell change
  tickNo: ticks executed, incremented FIRST in tick(), 0 right after construction (snapshot `k`; NOT the same as the method tick())
  state: STATE.*      countdown: ticks left (0 after GO)      timeLeft: ticks left, -1 unlimited, 0 once time is up      suddenDeath: bool      sdOrder: number[], sdNext: int, sdStart: int
  players: Player[] in fighter order (NOT indexed by id; use world.player(id)); removed fighters STAY in the array with removed=true, alive=false
  bombs: Bomb[] ascending id.   Bomb = { id, owner /*-1 orphaned*/, x, y /*visual centre*/, tx, ty /*occupied tile*/, range, fuse, dir /*0..4*/, step, pass: number[], fly: null | { fx, fy, tx, ty, left, total } }
  flames: { tx, ty, ticks, mask, owners: number[] }[] ascending (ty,tx)      items: { id, tx, ty, kind, born }[] ascending id      falling: { tx, ty, ticksLeft }[]
  outcome: null until locked, then { winnerId: int|null, winnerTeam: 0|1|null, draw: boolean, reason: 'last'|'wipe'|'timeout', tick: int }, set exactly once, in the same tick the state becomes ENDING
  evCount: total events pushed this round
  Player = §3.3 fields (stats, killer, removed, …)

Methods
  player(id) → Player | undefined
  applyCmd(id, cmd)       cmd = {s,d,b,x}, already sanitised ints; §3.4; call BEFORE tick() of the same step; never throws
  tick()                  advance exactly one tick in the order of §3.2a; no-op when state === OVER
  removeFighter(id)       alive=false, removed=true, killer=-2; its bombs become owner=-1; pushes ['left', id] (NO 'death' event); the outcome is re-checked at the end of the next tick()
  snapshot({ grid = false, evFrom = null } = {}) → plain object exactly as A.2. A PURE READ: it resets and drains nothing. `g` is present iff grid===true; `e` = eventsSince(evFrom) if evFrom is a number, else [].
  eventsSince(n) → event[] (absolute index ≥ n, at most the newest 128)      trimEvents(n)   drop events before absolute index n
  landTick(tx, ty) → absolute tick at which that cell becomes 'X' (Infinity if not scheduled)

Pure exported functions (the ONLY implementations; the client predictor and bots import them)
  effectiveSpeed(p) → tiles/s              effectiveDir(p, d) → d2   (§3.7)              overlapsTile(p, tx, ty) → boolean   (§3.6)
  makeEnv(grid, bombs, W = 15, H = 13, left = null) → { W, H, isSolid(tx, ty, p) }
      isSolid: out of range → true; grid[ty*W+tx] !== '.' → true; else true iff some bomb b with !b.fly && b.tx === tx && b.ty === ty && !(b.pass && b.pass.includes(p.id) && !(left && left[b.id])).
      `grid` = string or array; `bombs` = World bombs, decoded snapshot bombs or ghosts ({id,tx,ty,fly,pass}; `fly` null/0 when not flying); `left` = the replay's "no longer overlapping" map (§5.2).
  movePlayer(p, d, env) → { moved, blocked }   (§3.5)
  computeBlast(grid, bombs, bomb) → { tiles: [[tx,ty]…] /*incl. centre*/, blocks: [[tx,ty]…], hitBombs: [id…] }
      pure: the flame set of ONE bomb with all arm-stop rules of §3.6a; hitBombs = non-flying bombs standing on `tiles` (chain). World.resolveExplosions uses it; bots build danger maps with it.
```

### A.2 Snapshot (exact) and the View mapping

Room does `JSON.stringify(world.snapshot(opts))` ONCE per broadcast (rules in §4.5). Repeated entities are **arrays** (bandwidth); `protocol.js` exports frozen index maps `P` (player fields), `PF` (flag bits) and `B` (bomb fields); `World.snapshot` builds and `game.js` decodes ONLY through them.

```
{ t:'snap',
  k,          // world.tickNo — resets to 0 each round
  st,         // 0 countdown, 1 playing, 2 ending, 3 over
  cd,         // countdown ticks left (0 unless st == 0)
  r,          // round ticks left (-1 unlimited, 0 time up)
  sd,         // 0/1 sudden death active
  gv,         // world.gridVer
  ack,        // { '<humanFighterId>': lastSeq } string keys; bots and spectators absent
  p,          // players, ONE per fighter in round.players order, dead and removed included
  b, f, i, fall,
  g?,         // 195-char grid string; present per §4.5
  e }         // events since the Room's cursor (A.3); [] for unicast snapshots
```

| `p[n]` index | name | meaning |
|---|---|---|
| 0 `P.ID` | id | fighter id |
| 1, 2 | x, y | CENTRE in tile units, 3 decimals |
| 3 | f | facing 0..3 |
| 4 | fl | flags: `1` moving, `2` alive, `4` kick, `8` glove |
| 5 | sh | item shield ticks (`SHIELD_FOREVER` after the outcome lock) |
| 6 | ss | spawn shield ticks |
| 7 | cu | curse kind string, or `0` |
| 8 | ct | curse ticks left |
| 9, 10, 11 | bm, rg, sp | bombsMax, range, speedLv |
| 12 | dt | ticks since death (0 while alive, saturates at 255) |

| `b[n]` index | name | meaning |
|---|---|---|
| 0 | i | bomb id |
| 1 | o | owner id (`-1` orphaned) |
| 2, 3 | x, y | VISUAL centre (a sliding bomb glides, §3.6c; a flying bomb: the current point on the straight line from→to, the renderer adds the arc height) |
| 4, 5 | tx, ty | the tile the bomb OCCUPIES (sliding: the tile it is heading into; flying: the landing tile) — collision, flames and the predictor use these |
| 6 | fu | fuse ticks left |
| 7 | rg | range |
| 8 | d | dir 0..4 |
| 9 | fl | `0`, or `[fromX,fromY,toX,toY,ticksLeft,total]` (tile-centre coords) |
| 10 | ps | array of fighter ids allowed to walk through it (`[]` when empty) |

`f` = `[[tx,ty,mask,ticksLeft], …]`; `i` = `[[id,tx,ty,kind,age], …]` (`age = k − born`); `fall` = `[[tx,ty,ticksLeft], …]`. `kind` strings are `ITEM_KINDS` ids, `cu` strings are `CURSE_KINDS` ids.

Canonical example (also `specs/fixtures/snap.example.json`):
```json
{"t":"snap","k":183,"st":1,"cd":0,"r":6417,"sd":0,"gv":12,"ack":{"0":181,"2":180},
 "p":[[0,1.5,3.213,2,3,0,0,"slow",312,1,2,0,0],[2,13.5,1.5,0,4,0,0,0,0,2,3,1,40]],
 "b":[[7,0,1.5,1.5,1,1,121,2,0,0,[0]]],
 "f":[[3,1,4,30]], "i":[[4,5,3,"flame",12]], "fall":[],
 "e":[["bomb",7,0,1,1]]}
```
(fighter 0 is alive and moving with a `slow` curse; fighter 2 is dead, 40 ticks ago, and owns a kick; the bomb was placed by fighter 0 who is still allowed to walk through it.)

**Snapshot → View mapping** (`ClientGame.getView`; ALL View `x,y` are CENTRE coords in tile units, `tx/ty` are integer tile indices; the `View` object is preallocated and refilled each frame):
```
View = { w, h, grid /*string*/, state, countdown, timeLeft, suddenDeath, me, theme,
         players:[{id,x,y,facing,moving,alive,shield,spawnShield,curse,curseTicks,deadT,isMe,color,team,name,isBot,bombsMax,range,speedLv,kick,glove}],
         bombs:[{id,owner,x,y,tx,ty,fuse,range,dir,fly,pass}], flames:[{x,y,mask,ticksLeft}], items:[{id,x,y,kind,born}],
         falling:[{tx,ty,ticksLeft}], ghostBombs:[{x,y}] }
players[]: id=p[0], x,y, facing=f, moving=!!(fl&1), alive=!!(fl&2), kick=!!(fl&4), glove=!!(fl&8), shield=sh, spawnShield=ss, curse=(cu||null), curseTicks=ct, deadT=dt, bombsMax=bm, range=rg, speedLv=sp, isMe=(id===me);
           name,color,team,isBot come from `round.players` (static)
bombs[]:   {id=i, owner=o, x, y, tx, ty, fuse=fu, range=rg, dir=d, fly = fl ? {fx,fy,tx,ty,left,total} : null, pass=ps}
flames[]:  {x:tx+.5, y:ty+.5, mask, ticksLeft}     items[]: {id, x:tx+.5, y:ty+.5, kind, born:k-age}     falling[]: {tx,ty,ticksLeft}
View also has: w,h,grid (latest), state=st, countdown=cd, timeLeft=r, suddenDeath=!!sd, me, theme (from `round`), ghostBombs (§5.2).
```
There is no `shake` field: the Renderer derives shake from events.

### A.3 Events (complete and closed list)

Event = `[code, ...args]`; ids are ints, `tx/ty` ints, `x/y` floats (1e-3, centre coords). Order inside `e` = order of occurrence (§3.2a step order).
```
['go']                                            countdown finished, state -> PLAYING (spawn shields start)
['bomb', bombId, ownerId, tx, ty]                 bomb placed (manual or `spam` curse)
['boom', bombId, ownerId, tx, ty, range, tiles]   tiles = [[tx,ty]…] = every flame tile of THIS bomb incl. centre; one `boom` per bomb of a chain, in explosion order
['block', tx, ty, ownerId]                        one per destroyed soft block (`boom` does NOT list blocks)
['itemspawn', itemId, tx, ty, kind]               drop revealed (same tick as its `block`)
['pickup', itemId, playerId, kind, tx, ty]        kind = ITEM_KINDS id (a `skull` additionally emits `curse`)
['itemgone', itemId, tx, ty, kind]                item destroyed by an explosion or a sudden-death tile
['bombgone', bombId, tx, ty]                      bomb removed WITHOUT exploding (sudden-death landing)
['death', playerId, killerId, x, y]               killerId >= 0 = flame owner (== playerId for an own goal), -1 = sudden death / orphaned bomb
['left', playerId]                                fighter removed (leave/kick/grace expiry); NO `death` event is emitted for it
['shieldhit', playerId, x, y]                     flame absorbed by a shield or spawn shield (throttled per fighter)
['kick', playerId, bombId, dir]                   dir 1..4
['throw', playerId, bombId, fromTx, fromTy, toTx, toTy]    toTx/toTy = the already-resolved landing tile
['land', bombId, tx, ty]
['curse', playerId, kind, fromId]                 kind = CURSE_KINDS id, or 0 when cured (expiry / transferred away / death / lock); fromId = giver id, -1 for pickup, expiry or clearing
['sdstart']                                       sudden death began
['sdland', tx, ty]                                a falling tile landed, the cell is now 'X'
['showdown']                                      the round clock was shortened (§3.2)
```
There are no other event codes. The countdown numbers and the last-10-seconds warning are derived by the client from `cd` and `r`.

### A.4 Message flows (`→` = to that client only, `⇒` = to every connected client)

Within one Room step the message order is always `snap` → `roundEnd` → `lobby` → `round`/`matchEnd`.

* **F1 create:** C: `create{v:1,name,color?}` → adapter: `RoomManager.create()` → `room.join(conn,{name,color})`; Room: → `joined`, → `lobby`. Errors `version|bad_msg|busy|rate_limited` ⇒ `error` then the socket is closed.
* **F2 join (phase lobby|results):** C: `join{v:1,code,name,color?,token?}` → `RoomManager.find` (else `no_room`) → `room.join`. Room: → `joined{seq:0}`, → `lobby`, → chat replay (≤ 50, each `old:true`), (phase results: → the last `matchEnd`); to others: ⇒ `lobby`, ⇒ `sys` "<name> joined". Full room: `error full` + close (a bot is evicted first, §4.2). A `locked` room without a matching token: `error locked` + close.
* **F3 join mid-match:** as F2, but `entry.waiting = true`, then → `round` (LIVE grid, `serverTick = world.tickNo`, current fighters), → `snap` (full, `world.snapshot({grid:true})`). At the next round build the entry becomes a fighter (`waiting=false`, ⇒ `lobby`). Waiting entries may chat/emote; their `in` frames are ignored.
* **F4 reconnect:** C: `join{code,token,name}`. `room.join` finds the entry by token: the old conn (if any) is closed with 4001 `replaced` (its late `close` event is ignored); `connected = true`; the grace timer is cancelled; → `joined{seq: entry.lastSeq}`, → `lobby`; phase `match`: → `round` (LIVE), → `snap` (full), and if `world.outcome` → the stored `roundEnd`; phase `results`: → the stored `matchEnd`. Others: ⇒ `lobby`.
  Unknown or expired token = fresh join (F2/F3, new token and id); a banned token → `error kicked` + close; the room does not exist → `no_room`.
* **F5 socket drop:** `room.disconnect(pid, conn)` → `connected = false`, queue cleared, ⇒ `lobby`. A fighter in a match stands still and is vulnerable. Grace `GRACE_LOBBY_MS` (lobby/results) / `GRACE_MATCH_MS` (match); on expiry `removeEntry()`.
* **F6 leave:** `{t:'leave'}` → immediate `removeEntry()`, `conn.close('left')`. `removeEntry()`: in a match `world.removeFighter(id)`; frees the colour; if the entry was host → F7; ⇒ `lobby`, ⇒ `sys` "<name> left".
* **F7 host:** §4.2 rules; recomputed (a) immediately when the host leaves/is kicked/is removed, (b) when the host has been disconnected ≥ `HOST_MIGRATE_MS` and another human is connected. ⇒ `lobby`, ⇒ `sys` "<name> is now the host".
* **F8 kick:** `{t:'kick',id}`: non-host → `error not_host`; `id` = self or unknown → ignored; bot → same as `removeBot`; human → target gets `{t:'kicked'}`, its conn is closed, `removeEntry()`, token banned; ⇒ `lobby`, ⇒ `sys`.
* **F9 start:** host, phases lobby|results; errors in order `not_host, bad_phase, need_players, need_teams`. Then reset wins/teamWins/matchStats/roundsPlayed, `waiting=false`, phase `match`, `startRound()`: ⇒ `lobby`, ⇒ `round`, ⇒ `snap` (full).
* **F10 rounds:** outcome lock: ⇒ `snap` (flush), ⇒ `roundEnd{matchOver}`, ⇒ `lobby` (wins). When the World reaches `OVER` and `OVER_HOLD_TICKS` passed: if `matchOver` → ⇒ `matchEnd`, phase `results`, ⇒ `lobby`; else `startRound()` (⇒ `round`, ⇒ `snap` full). If the preconditions of §4.3a fail at a round boundary: `matchEnd{not_enough_players}` or back to lobby.
* **F11 back to lobby:** host `{t:'lobby'}` in phase results (or after `RESULTS_AUTO_MS`): phase `lobby`, wins = 0, `waiting = false`, ⇒ `lobby`. In phase `match` it aborts the match (world dropped, ⇒ `sys` "Host ended the match", phase `lobby`, ⇒ `lobby`). Non-host: `not_host`.
* **F12 gating:** `profile, settings, addBot, removeBot` are honoured only in phases lobby|results (otherwise ignored). `removeBot` on a non-bot id is ignored. Settings: unknown keys ignored, invalid values ignored per key.
* **F13 empty room:** no human entry connected or in grace for `EMPTY_CLOSE_MS` ⇒ Room calls `onEmpty()` once and closes itself; `RoomManager` deletes the room in `onEmpty` and has no timer of its own.
* **F15 sync:** `{t:'sync'}` (≤ 1/s) → the Room answers with a unicast `world.snapshot({grid:true, evFrom:null})` (phase `match` only; otherwise ignored).
* **F14 `lobby` re-send:** on join, leave, connected change, profile, settings, bots, phase, host change, wins change, waiting change. The Room stores the last `roundEnd`, `matchEnd` and the last 50 chat lines for replays.


---------------------------------------------------------------------------------------------

## Appendix Z: Changelog of the review

Four reviews (netcode `N1–N15`, gameplay `G1–G18`, architecture `A1–A25`, ops/UX `O1–O27`) raised 85 issues (16 blockers, 52 majors, 17 minors). Result: 84 accepted (34 of them with modifications or merged with a competing proposal, marked `*`) and 1 rejected in full (G15); in addition 12 sub-proposals or alternative fixes inside accepted issues were rejected (listed below). Contested claims were verified with Node prototypes before deciding: the direction-aware EPS rule (0 wall penetrations in 600 000 fuzzed ticks incl. 3-decimal rounding; the other readings walk into walls), the kick dead zone at lane offsets 0.36–0.5 (reproduced), the sudden-death wall-walk
(reproduced: a fighter overlapping a tile that turns solid walks through it), the queue catch-up credit policy (1.000 cmds/tick even at 66 cmds/s), the corrected sanitizer (hostile inputs), 4-fold symmetric map generation with the first-bomb post-pass (classic 6.8 % → 0 % inescapable spawns at `normal`, 15.9 % → 0 % at `many`), spiral coverage and durations (113/134 cells, 952/1120 ticks) and the array snapshot size (about 0.95 KB busy, 1.15 KB with `g`).

### Accepted changes (one line each)

**Contract, layout, conventions**
* [A1] The spec is declared COMPLETE and winning; PROTOCOL.md is generated from code afterwards; golden fixtures come from Appendix A and are written by the lead first (header, §1, §10.1).
* [A10*, O17*] `package.json` fixed (engines ≥ 22, quoted globs, `test:e2e`), the empty `test/` dir removed, `naming.spec.js`, `startServer()` factory, path-filtered CI workflow, Playwright loaded through `createRequire` with SKIP fallback (§1.1, §7, §10, §11).
* [A12, O1] Relative `.js` import specifiers, root-absolute assets, flat `client/js`, invite link from `location.origin`, exact routing table with `/favicon.ico` 204 and no SPA fallback (§1.2, §7).
* [A11*] Every shared table (`SPAWN_SLOTS`, `PLAYER_COLORS`, `EMOTES`, `ITEM_WEIGHTS`, `SETTINGS_DEFS`, `TIMEOUTS`, …) lives in `constants.js`; timeouts re-tuned by O2 (§3).
* [O26, A23] Dangling references (§13, §14, §7, §9) fixed; the `g` cadence is 60 TICKS = 1 s, not 60 snapshots (§4.5).
* [N15*, A13*] Isomorphism and determinism rules: sibling-only imports, forbidden APIs, sim math whitelist, Safari 16 syntax floor, grep-based specs; the cross-engine SHA test lives in e2e (§0.4, §0.5, §10).
* [A15*] `sprites.js`, `render.js`, `particles.js` get ONE owner instead of a frozen SpriteAtlas API (§1, §8.1).

**Rules (§3)**
* [G1] Order-independent explosion resolver `resolveExplosions` (queue by id, one destruction and one drop per block, items destroyed only by explosions, flames ignite bombs in the same tick, owners list per flame tile) (§3.6a).
* [G2] Normative tick order §3.2a: fuse timing, exactly 36 lethal checks per flame, deaths collected then applied, spam in tick step 1, one outcome evaluation.
* [G3*] Sudden death: `SD_INTERVAL` 8 / `SD_WARN_TICKS` 48, defined spiral, landing kills hitbox-overlappers (fixes the wall-walk), safety net, cancelled on outcome lock, `sdOrder/sdNext/landTick` for bots (§3.2.1).
* [G4] Round end conditions: timeout draw with sudden death off, `MAX_ROUND_TICKS` cap when `roundTime` is 0, `outcome.reason` / `roundEnd.reason` (§3.2).
* [G5*] Leavers and match end: ids never reused, round preconditions, `removeFighter` emits only `left`, entry deleted, no-humans stops the World, match cap `4 × rounds`, tie-breaks (§4.3a, §3.8).
* [G6, A20*] Teams: `teamWins`, friendly fire, team assignment rule, host-edited bots, 2v2 diagonal spawns; scoring/`wins` naming unified (§3.8).
* [G7] Glove: fixed destination chosen at throw time with an explicit candidate order, landing re-resolution by BFS, pass for all overlappers (§3.6b).
* [G8*, N3*, N13] Kick/slide: reservation model with discrete `KICK_STEP_TICKS` 7, `enterable()`, `tx,ty` in bomb entries, no `KICK_ALIGN` (centre lane; the dead zone is gone by construction), pass semantics restated (§3.6c).
* [G9] Kill credit from a per-tile owners list (enemy > self > teammate), orphaned bombs, `blocks` credit (§3.6d).
* [G10] Curses: skull never re-rolls to the same curse, deterministic nearest-target transfer, no chain hops, cleared on death/lock, `spam` cannot be dodged by lag (§3.7).
* [G11] `effectiveDir` (reverse + rush autorun) shared by server, predictor and bots; `CURSE_RUSH_SPEED` 8.5 → 7.5; bots compensate (§3.7, §6).
* [G12] Ending timeline: `SHIELD_FOREVER` (JSON-safe), `roundEnd` at lock, `OVER_HOLD_TICKS`, `COUNTDOWN_TICKS` 180 with the GO banner in play, throttled `shieldhit` (§3.2b).
* [G13] First-bomb escape post-pass (§3.1). [G14] Open layout pillars fixed to `tx%4==3` (mirror-symmetric), 4-fold symmetric blocks and prizes, `pDrop` scales with fighter count, `drops[]` server-only, `numSlots` removed (§3.1).
* [G16] Showdown: shortened clock when the last human is dead (§3.2). [G18*] Small deterministic details (§3.10); the leaver emits `left` only.
* [N2] `movePlayer` with the direction-aware EPS rule as a listing, out-of-range solidity, float64 only, multiply by `DT`, 3-decimal rounding note and tests (§3.5).

**Netcode (§4.5, §5)**
* [N1*, A6] Seq is per entry, monotonic and never reset; `joined.seq`; World built with a continuous `lastSeq`; per-cmd dedupe; conn identity checked on `receive`/`disconnect` (§5.1, §4).
* [N6*, A22*] Input policy: idle/held ticks earn catch-up credit (no speed hack), oldest-drop keeps taps, 120 cmds/s flood guard, one flush per frame, single limits table owned by `Room.receive` (§5.1, §4.4).
* [N12*] Countdown fairness, simplified: the server holds cmds in the last 12 ticks, the client starts sending shortly before its GO estimate (§5.1, §5.2).
* [N4, N5, A18*] Prediction: ghost lifecycle keyed by ack, replay contract with `pass`/`left`, curse-aware direction, exported shared helpers, plain predicted-player shape, `pending` cap (§5.2).
* [N7] `gv`/`g`/`sync` design; `snapshot()` is a pure read; joiners get a unicast full snapshot (§4.5). [N8*, A17*] Event cursor and `eventsSince`, immediate dispatch, `lastK` dedupe, stale filter, ghost-sound dedupe (§4.5, §5.3).
* [N9] Monotonic, jitter-smoothed render clock (§5.3). [N10, O3*] Connection layer: URL derivation, connect timer, budgets, cold-start UX, liveness rules for hidden tabs, resume, server-initiated ends, boot rejoin, keep-warm, accumulator leftover (§5.2, §5.4).
* [N11*, A14*] Practice/Loopback is pump-driven, pausable, on a virtual clock, with an outbox drained outside Room code (§8.1a).
* [N14*] Array snapshot entries with shared index maps and a size budget test (§4.5, Appendix A.2).
* [A9] `Room.step` order, `pump`, `startLoop` semantics and clocks (§5.0).

**Cross-module APIs (Appendix A, §4, §8)**
* [A2*] Complete World API (constructor order, state, methods, pure exports) (Appendix A.1). [A3*] Exact snapshot and View mapping (A.2). [A4] Closed event list (A.3). [A5*] Complete server→client messages and error codes (§4.4).
* [A7*, A8*, O2*] Room/transport contract (Room sends `joined`/`lobby`, conn identity), message flows F1–F14, long lobby grace (120 s), 60 s host migration, room liveness rules, token re-attach and fresh-join fallback (§4, Appendix A.4).
* [A16] Glue contract: DOM ownership, Input API additions, latched taps, `hudModel` sources, event→sound mapping (§8.6). [A19] Bot/Room contract (§6.1). [A21] Test seams, file ownership, helpers (§10.1). [A24*] Seed flow and `makeRng` API (§4.6). [A25] Robustness wrappers around every Room entry point, dead-socket-safe fan-out, backpressure (§4, §7, §9).

**Lobby, server, security**
* [G17*] Lobby rules: host migration, capacity eviction of bots, phase gating, bot names, waiting flag, kick with token ban (§4.2).
* [O5] Abuse limits (global/per-IP/pre-join, room creation, failed joins) and the host-only `locked` setting (§4.1, §7). [O4] Rightmost-N client IP derivation, `TRUST_PROXY` as hop count, share.js sets it (§7).
* [O6] HTTP hardening, WS upgrade handler with mandatory `'error'` listener, backpressure thresholds (§7). [O25] Origin check (§7). [O18] Ordered graceful shutdown and crash-loop guard (§7). [O19] JSON logs without PII and `/api/stats` (§7). [O20] Idle/hard-cap reapers, bounded structures, idempotent `Room.close()`, client-side caps (§4.2, §5.3).
* [O21] 32-hex tokens from `getRandomValues`, room codes via `randomInt` (§9). [O12*] Sanitizer rewritten and tested (dropped `\p{Cn}` to avoid Unicode-version skew, ZWJ kept, grapheme truncation, dedupe key, chat dedupe) (§4.2).
* [O23*] Full CSP/header set and MIME table (§7). [O16*] Robust `share.js` (stderr URL, reachability poll, http2 fallback, cleanup on Windows); QR made optional via `shared/qr.js` (§11, §8.3). [O15] Ready-to-use Dockerfile / fly.toml / render.yaml with single-instance rules (§11). [O27] README pitfalls (§11).

**Client UX, accessibility, devices**
* [O7] Secure-context feature detection, `copyText`, synchronous `navigator.share`, wake lock, gamepad/fullscreen guards (§8.3). [O8] iOS-safe audio unlock (`touchend/click`, interrupted state, `audioSession`) (§8.5). [O9] Viewport/safe-area/`dvh`/16 px inputs/back-gesture guard/sizing rules (§8.3).
* [O10] Keyboard by `e.code`, TV keycodes, Sticky-Keys note, focus blur, pointer-cancel handling, gamepad indices with hysteresis (§8.4). [O11] dpr cap, tile cap, adaptive quality, canvas memory release, no per-frame allocation, particle pools, debug overlay (§8.2).
* [O13] Reduced-motion behaviour and flash-safety numbers (§8.2). [O14] Accessibility contract (§8.3). [O22] CSP-safe boot watchdog and too-old-browser message (§8.3). [O24] Manifest, PNG icons and `make-icons.mjs` (§8.3).

### Rejected

* [G15] Ghost mischief (dead humans spawning skulls) and the `catchUp` underdog boost — rejected in full: two new gameplay systems (rules, snapshot field, UI button, renderer effect, setting) that balloon v1 scope; the showdown rule already shortens the dead player's wait. Revisit after playtests.
* [N1] The per-entry epoch (`ep`) scheme — replaced by never-reset seq (A6): an epoch needs a new field on every `in` and creates reset races; a monotonic per-entry seq has no race.
* [A17] Delaying event dispatch to the interpolated render time via per-snapshot queues — replaced by immediate dispatch (N8), which is consistent with discrete state being drawn from the newest snapshot; only ghost-sound dedupe was taken from it.
* [A22] The 66 cmds/s token bucket with burst 40 — it permits a measured ~10 % speed hack; replaced by the credit policy and a 120 cmds/s flood guard. The `c.length ≤ 40` cap of N6 is replaced by 16 (a frame carries ≤ 6 cmds).
* [A2, A3] `snapshot()` that drains events, and object-keyed player/bomb entries — replaced by the pure-read snapshot with an event cursor and by array entries (bandwidth budget).
* [N14] The `psv` power-up-stats counter — arrays already meet the budget without another versioned field.
* [O23] `Link: modulepreload` headers generated from a directory scan — premature optimisation; add later only if the import waterfall proves slow.
* [O12] Chat auto-mute after repeated violations — the rate limit, identical-message dedupe and host kick suffice for v1.
* [G18] Leaver emitting both `death [id,-2]` and `left` — one event (`left`) is enough and avoids double bookkeeping.
* [A20, A8] `MAX_ROUNDS = rounds × 3`, keeping removed entries in standings, a 10 s host-migration/lobby grace and a "no CONNECTED human for 30 s" room timer — replaced by `4 × rounds`, deleted entries, and the O2 timings, which survive a phone switching apps.
* [A7] A `wantHost` join option — dropped: the first human in the room is host.
* [A13] The regex-based `sanitizeName` variant — replaced by the tested `sanitizeText` (zalgo/invisible-name/grapheme handling).
* [N3] Continuous bomb sliding at `KICK_SPEED` 9 tiles/s — the reservation idea was kept, but movement is discrete (`KICK_STEP_TICKS` 7), which removes partial-overlap cases.
