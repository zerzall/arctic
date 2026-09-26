# Rainbow Rails — architecture contract (v2)

Plain JavaScript, no build step, no ES modules: every file is a classic `<script>` that reads and extends the
global `window.RR` namespace. Three.js **r128** is the global `THREE`
(`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`). Post-processing and geometry utils
come from `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/...` (non-module files that attach to
`THREE`); every module must work if they fail to load. Nothing else may be fetched: every texture is drawn
on a canvas, every model is built from primitives, every sound is synthesised. Fonts: Google Fonts
"Lilita One" (display) and "Fredoka" (UI) — draw canvas text only after `document.fonts.load(...)` resolves
(or redraw when it does).

The game ships as a multi-file artifact AND must work when `game/index.html` is opened from disk
(`file://`): scripts use relative paths (`js/core.js`), nothing uses `fetch`, no ES modules, Workers only from
Blob URLs.

## Files and ownership

| File | Global | Owns |
|---|---|---|
| `index.html` | — | markup, CSS, `<script>` order |
| `js/core.js` | `RR.C`, helpers | constants, maths, events, save data, world palettes, atmosphere blend, speed curve, tunnel ranges, canvas textures, `Prop`, `InstancedPool`, `Pool`, quality tiers. **Do not edit** — read it; keep per-module tuning tables in your own file. |
| `js/sky.js` | `RR.sky` | sky dome shader (gradient, sun, clouds, stars, rainbow, synthwave sun, aurora), horizon silhouette strips, near cloud banks, distant flyers (balloons, birds, blimp, planes, flying cars), lights (hemisphere + shadowed sun), fog |
| `js/track.js` | `RR.track` | terrain chunks (flat near the track, hills beyond), per-world ground materials, the three tracks (ballast, sleepers, rails), trackside dressing (curbs, fences, signals), animated water (sea, river, lake) |
| `js/worlds.js` | `RR.worlds` | near/mid scenery kits per world, landmark set pieces, the tunnel at every world boundary |
| `js/director.js` | `RR.director` | obstacle pattern library, difficulty ramp, fairness search, coin paths, pickup placement, tutorial script — pure data, no THREE |
| `js/obstacles.js` | `RR.obstacles` | turns director chunks into pooled 3D objects (trains, ramps, hurdles, bars, blocks, coins, pickups), moves oncoming trains, collision/probe queries |
| `js/player.js` | `RR.player` | character skins, rig and procedural animation, hoverboards, jetpack |
| `js/fx.js` | `RR.fx` | particles (ambient per world, bursts, dust, speed lines, trails), post-processing, `render()` |
| `js/audio.js` | `RR.audio` | Web Audio music per world + sound effects, driven by events |
| `js/ui.js` | `RR.ui` | every DOM screen: title, shop, missions & stats, settings, HUD, pause, revive, game over, toasts, tutorial hints |
| `js/game.js` | `RR.game` | boot, renderer/scene/camera, fixed-step loop, state machine, input, physics and collisions, power-ups, hoverboard, revive, scoring, combo, missions, stats, shop transactions, quality governor, camera, `window.__RR` |

Script order in `index.html`: three.min.js → jsdelivr `shaders/CopyShader.js`, `shaders/LuminosityHighPassShader.js`,
`shaders/FXAAShader.js`, `postprocessing/EffectComposer.js`, `postprocessing/RenderPass.js`,
`postprocessing/ShaderPass.js`, `postprocessing/UnrealBloomPass.js`, `utils/BufferGeometryUtils.js` → core →
sky → track → worlds → director → obstacles → player → fx → audio → ui → game. `game.js` boots on
`DOMContentLoaded` (or immediately if already loaded).

Each file is `(function (RR) { 'use strict'; ... RR.register('sky', api); })(window.RR);` and must not throw
at load time if another module is missing (guard cross-calls with `RR.xxx && ...`).

## Coordinates and hard spatial rules

- Metres. The player runs toward **−z**; `dist = −pz`; `y` up; the ground near the track is `y = 0`.
- Lanes `RR.C.LANES = [−2.6, 0, 2.6]`. Trains are 2.2 wide, walkable roof exactly `RR.C.TRAIN_H = 3.0`
  (the visual roof walkway top must be 3.0 ± 0.02 — no feet sinking, no lip at the ramp top).
- **Track corridor:** nothing but track pieces, obstacles, pickups and the player may occupy
  `|x| < RR.C.CORRIDOR (6.5)` below `y = RR.C.OVERHEAD_CLEAR (11)`. Every prop placement checks
  `|x| − footprintRadius ≥ 6.5`. Things spanning the track (bridges, gantries, arches, wires, tunnel roofs)
  keep all geometry inside the corridor above y = 11 (and must never cut the camera path — the camera can
  reach y ≈ 10 on roofs/jetpack). Supports stand outside the corridor.
- **Far layers** (mountains, hills, big landmarks): `|x| − radius ≥ RR.C.FAR_CLEAR (40)`. (v1's "wall" was a
  mountain cone wider than its distance from the track.) Distant silhouettes that follow the camera like the
  sky (horizon strips) can never be reached and are the preferred way to show far mountains/skylines.
- **Terrain** is exactly flat (y = 0) for `|x| < RR.C.TERRAIN_FLAT (18)`; hills rise beyond it.
  `RR.track.heightAt(x, z)` is the deterministic terrain height used by everyone placing things there.
- Nothing floats or sinks: bottoms sit on `heightAt(x, z)` (or on water at its level).
- Depth: camera near `RR.C.CAMERA_NEAR (0.3)`, far `RR.C.CAMERA_FAR (1600)`. Never stack large coplanar
  surfaces; separate layers by ≥ 0.05 m and use `polygonOffset` on the lower one, or merge them.
- Streaming: content exists between `pz + RR.C.DESPAWN_BEHIND` and `pz − RR.C.SPAWN_AHEAD (520)`. Nothing may
  visibly pop in: spawn beyond where fog is effectively opaque for that object, or fade/scale it in.
  Near-camera items (coins, pickups) are hidden once `z > pz + 2`.
- **Worlds change spatially.** World k (absolute count, k ≥ 0) occupies `z ∈ (−(k+1)·1000, −k·1000]`,
  `RR.worldIndexAt(z)` gives its palette index (0–4). Terrain, track and scenery chunks (50 m, aligned to
  multiples of 50 so a chunk never straddles a boundary) are styled by the world at their own z.
- **Tunnels.** Every boundary k ≥ 1 has a tunnel spanning `z ∈ [−k·1000 − 60, −k·1000 + 60]`
  (`RR.inTunnel(z)`), interior clear height ≥ 11, clear width ≥ 14 (|x| ≤ 7), themed portal on each end
  (entrance themed for the world being left, exit for the world entered) with the new world's name on a
  sign at the entrance, ring lights inside. The sky/lighting blend happens while the player is inside.
  The director spawns **no trains inside tunnels** (hurdles/bars/coins only). The jetpack ends (descends)
  before a tunnel.
- Jetpack flight: feet at `RR.C.JETPACK_Y` (7.5).

## Lifecycle (every scene module)

```js
init(ctx)            // once. ctx = { renderer, scene, camera, quality }  (quality = a RR.QUALITY tier object)
reset(pz)            // (re)build all streamed content around z = pz (title uses 0; __RR.warp uses any z)
update(dt, frame)    // every rendered frame, after the simulation
setQuality(q)        // quality tier changed (any time)
```

`frame` (built by game.js each rendered frame; treat as read-only):

```js
frame = {
  t, dt,                        // seconds since boot, frame delta (≤ 0.1)
  state,                        // 'title' | 'run' | 'paused' | 'dying' | 'revive' | 'over'
  pz, px, py,                   // player feet (interpolated)
  speed, dist,                  // m/s, metres
  world, worldCount,            // RR.worldIndexAt(pz) (0..4), floor(dist / 1000)
  inTunnel,                     // RR.inTunnel(pz)
  camera,                       // THREE.PerspectiveCamera (already positioned for this frame)
  player: { lane, grounded, rolling, jetpack, board, sneakers, magnet, double, invulnerable }
}
```

Modules must be frame-rate independent (`dt`, `RR.damp`), must not allocate in `update` (reuse
vectors/objects), and must not create geometries/materials/textures per spawned object (build variants once,
pool, use `RR.InstancedPool`).

## Rendering conventions

- `renderer.outputEncoding = LinearEncoding`, `toneMapping = NoToneMapping` (colours are authored as seen).
  Canvas textures stay default (linear). This keeps the pastel palette predictable.
- Lighting budget: hemisphere + sun intensities are tuned per world so a lit, sun-facing surface of albedo
  ≤ 0.85 peaks near 1.0 — ground and track must keep their hue (v1 blew candy/sand/snow out to white).
- Glow parts (lamps, neon, headlights, lit windows, ring lights, sun) use `RR.mats.glow` (vertex colours) or
  their own MeshBasicMaterial. When post-processing is on, `RR.fx` sets `RR.mats.glow.color` to
  `RR.C.GLOW_BOOST_POST` (and should boost other emissive materials similarly) so only they exceed the
  bloom threshold (~1.0, half-float targets). Ordinary lit surfaces must not bloom.
- Shadows: only player, trains, obstacles cast; the sun's shadow box covers ~10 m behind to ~45 m ahead of
  the player, texel-snapped. Low tier: no shadow map (blob shadows in obstacles/player).
- Draw-call budget (high tier): ≤ 250 calls, ≤ 600k triangles. Low: ≤ 150 calls, ≤ 250k triangles.
  Scenery per 50 m chunk should be 2–3 draw calls (merged per material) or instanced per prototype.
- Transparent things that sit near the camera (particles, pickups) set `renderOrder` so far transparent
  layers (clouds, sky effects) never paint over them. Particles never come within ~4 m of the camera and
  their on-screen size is capped.

## Module APIs

### RR.sky
`init, reset, update, setQuality`; `sunLight` (DirectionalLight with shadow; `update` keeps it and its
target around the player), `hemiLight`. Reads `RR.atmo` each frame (game.js blends it with
`RR.atmoUpdate(dt, frame.world, rate)`), sets `scene.fog` colour to the horizon colour and fog range per
world. The sky dome and horizon strips follow the camera and ignore fog.

### RR.track
`init, reset, update, setQuality`, `heightAt(x, z)`, `waterAt(x, z) → level or null`.

### RR.worlds
`init, reset, update, setQuality`. Scenery chunks per world, landmarks, tunnels (uses `RR.inTunnel`).

### RR.director (pure logic, no THREE)
```js
reset(z0, opts)              // opts = { seed, tutorial: bool, clearUntil: z }  start generating from z0 (toward −z)
frontier                     // z of the far end of generated content
next() → chunk | null        // generate the next chunk (one fairness check per call; call until frontier < target)
clearAhead(pz, metres)       // forget content from pz to pz − metres and regenerate from there (all lanes safe)
PATTERNS, TUTORIAL           // exposed for tests
```
`chunk = { id, pattern, zStart, zEnd, D, items: [...], coins: [...], pickups: [...], path: [...], tutorial? }`
- path: the witness safe path found by the fairness search, `[{ z, lane, action: 'none'|'jump'|'roll'|'left'|'right' }]`
  in order of decreasing z (used by `__RR.autopilot`).
- item: `{ type: 'train'|'ramp'|'hurdle'|'bar'|'block', lane, zF, zB, vz, cars, meetZ? }` — `zF` is the end
  nearest the player (larger z), `zB` the far end; `vz` is 0 or `RR.C.ONCOMING_VZ` (toward +z, oncoming
  trains are created at their spawn position and meet the player at `meetZ`); a ramp is `RR.C.RAMP_L` long
  and its `zB` equals its train's `zF`.
- coin: `{ lane, y, z }` (y = path height + 1.0; roof coins at TRAIN_H + 0.9); pickup: `{ kind, lane, y, z }`.
- tutorial (first run only): `{ step, action: 'jump'|'roll'|'left'|'right'|'ramp'|'coins'|'magnet', hint, zAct }`
  where `zAct` is the z at which the action must have happened.
- Fairness guarantee (from the prototype, fuzz-verified): from every entry lane of every chunk there is an
  input sequence with inputs ≥ 0.30 s apart that survives with ±0.12 s timing slack; generation never stalls
  (after 6 rejections it emits a breather); no trains inside tunnels; nothing within 60 m of the player at
  run start or after `clearAhead`.

### RR.obstacles
```js
init, reset(pz), update(dt, frame), setQuality
list                          // live obstacle records
probe(px, pzPrev, pz) → out   // reused object (no allocation):
                              //   out.rampH  ramp surface height at pz in the player's lane, or −1;  out.ramp (record)
                              //   out.train  record of a train overlapping [pz − HALF_D, pz + HALF_D] in the lane, or null
                              //   out.hits   array (reused) of records whose z-extent overlaps the swept
                              //              interval [pz − HALF_D, pzPrev + HALF_D] and |x − px| < HALF_W
                              //              (moving trains: their swept extent too)
laneBlocked(lane, py, pz)     // moving into `lane` now would hit a train/block side (py below its top)
collect(px, py, pz, magnet, dt) → { coins, pickups: [kind...] }   // reused result object
spawnSkyCoins(z0, z1)         // coin trail at JETPACK_Y + 1 between z0 > z1, switching lanes every 45–70 m
clearAhead(pz, metres)        // removes objects from pz to pz − metres with a quick poof; calls director.clearAhead
markNear(fromLane, pz, speed) // on lane change: flag close obstacles in the lane being left as near-miss candidates
passed(pz) → records          // records newly passed since last call (each once), with .nearCand
```
Record: `{ id, type, lane, x, zF, zB, top, bottom, vz, cars, passed, nearCand }`. Hit shapes use core
constants (`HURDLE_TOP/CLEAR`, `BAR_BOTTOM/TOP`, `BLOCK_TOP`, `TRAIN_H`, `TRAIN_KILL_Y`). Visuals must be honest
to the hit shapes (a bar's sign/gantry fills 1.42–3.4, a block is 3.2 tall). Obstacle skins may differ per
world, hit shapes never do. Oncoming trains: warning livery, headlights, beacon.

### RR.player
```js
init, reset, setQuality
group                         // THREE.Group in the scene; feet at group.position; faces −z
SKINS  [{ id, name, price, blurb, unlock? }]   // first is free ('nova')
BOARDS [{ id, name, price }]                   // first is free ('classic')
setSkin(id), setBoard(id)
update(dt, pose)              // pose = { x, y, z, laneVel (−1..1), grounded, vy, rolling, rollT (0..1),
                              //   jetpack, jetpackY01, board, sneakers, magnet, invulnerable, speed,
                              //   state, deathT, stumbleT, landT, celebrate }
```
Casts shadows. Title screen: idle look-around + wave. Roll pivots around the torso (never through the ground).

### RR.fx
```js
init, reset, update, setQuality
burst(kind, x, y, z)          // 'coin' | 'pickup' | 'crash' | 'dust' | 'land' | 'board-break' | 'portal' | 'sparkle' | 'poof'
render()                      // composer when quality.post, else renderer.render
resize(w, h, pixelRatio)
flash(cssColor, ms)           // brief full-screen tint (DOM overlay)
setGrade({ saturation, vignette })  // e.g. death desaturation
```

### RR.audio
`init()` (call from a user gesture), `setSound(on)`, `setMusic(on)`, `update(frame)` (music scheduler),
`setWorld(index)`, `pauseAll()`, `resumeAll()`. Subscribes to the events below itself.

### RR.ui
```js
init()
show(screen, data)            // 'title' | 'run' | 'pause' | 'over' | 'shop' | 'missions' | 'settings' | 'revive' | 'countdown'
hud(data)                     // while running; cheap, only touches the DOM when values change:
                              //   { score, coins, mult, dist, world, powers: [{ kind, left, dur }], boards, boardActive,
                              //     combo: { n, left, dur }, bestDist }
toastWorld(index), toast(text, kind), hint(text, ms), clearHint()
```
UI never changes game state; it emits `ui:*` events and reads `RR.store.data`, `RR.game.SHOP`,
`RR.game.missions`, `RR.game.stats`, `RR.player.SKINS/BOARDS`. It re-renders on `shop-update`,
`missions-update`.

### RR.game
Boot, loop, state machine, input, physics (swept collisions, fixed 1/120 s step with accumulator, max 12
steps/frame), power-ups, board, revive, scoring, combo, missions, stats, shop transactions, quality governor,
camera. Exposes (read-only for UI):

```js
RR.game.SHOP = {
  skins:  RR.player.SKINS,    // [{ id, name, price, blurb, unlock?: { type: 'world'|'level', value, text } }]
  boards: RR.player.BOARDS,   // [{ id, name, price, blurb }]
  upgrades: [{ kind: 'magnet'|'sneakers'|'double'|'jetpack', name, blurb, durations: [6 values, level 0..5], costs: [5 values] }],
  items:  [{ id: 'board1'|'board5'|'headstart'|'token', name, blurb, price, qty }]
}
RR.game.missions = { level, list: [{ id, text, have, target, done, reward }], skipCost }   // 3 active missions
RR.game.stats = RR.store.data.stats
RR.game.lastRun = { score, dist, coins, cause, world, newBest, missionsDone: [...], levelUp }  // for the game-over screen
```
Ownership/balances are read from `RR.store.data` (`bank`, `owned`, `skin`, `ownedBoards`, `board`, `boards`,
`upgrades`, `tokens`, `headStarts`, `best`, `bestDist`, `missionLevel`, `settings`, `history`, `daily`).

## Events (`RR.emit(name, data)` / `RR.on(name, fn)`)

Gameplay (emitted by game.js): `run-start`, `run-end {score, dist, coins, cause}`, `coin {n}`, `pickup {kind}`,
`power-end {kind}`, `jump`, `roll`, `land {hard}`, `lane {dir}`, `stumble`, `crash {cause}`, `board-on`,
`board-break`, `jetpack-start`, `jetpack-end`, `world {index, count}`, `tunnel-enter`, `tunnel-exit`,
`near-miss`, `stunt {kind, points}`, `combo {n}`, `combo-end {n}`, `mission-progress {mission}`,
`mission-done {mission}`, `level-up {level}`, `revive`, `pause`, `resume`, `countdown {n}`, `new-best`,
`shop-update`, `missions-update`, `quality-change {tier}`, `tutorial-step {i}`.

UI → game: `ui:start`, `ui:daily`, `ui:pause`, `ui:resume`, `ui:quit`, `ui:restart`, `ui:revive`,
`ui:decline-revive`, `ui:board`, `ui:skin-select {id}`, `ui:skin-buy {id}`, `ui:board-select {id}`,
`ui:board-buy {id}`, `ui:upgrade-buy {kind}`, `ui:item-buy {id}`, `ui:skip-mission {i}`,
`ui:setting {key, value}`, `ui:reset-progress`, `ui:replay-tutorial`, `ui:click`, `ui:screen {name}`.

## Debug hook (required; automated tests use it)

```js
window.__RR = {
  start(opts),             // start a run like pressing Play (no audio). opts: { tutorial: false, seed }
  freeze(on),              // stop/restart the requestAnimationFrame loop
  step(seconds, fps),      // run the real frame body `seconds*fps` times with dt = 1/fps, render once at the end
  warp(metres),            // teleport the run to that distance; every module is reset(pz)
  god(on),                 // crashes never end the run (still counted in info().wouldDie)
  autopilot(on),           // AI that follows the director's safe path (or reacts) to survive
  give(kind),              // 'magnet' | 'sneakers' | 'double' | 'jetpack' | 'board'
  setQuality(name), setSkin(id), setBoard(id),
  info(),                  // { state, dist, speed, world, inTunnel, fps, drawCalls, triangles, geometries, textures,
                           //   programs, sceneObjects, obstacles, coins, score, quality, wouldDie, py, lane }
  render(), screen(name)   // render one frame now; show a UI screen
}
```

## Look and feel

Saturated low-poly worlds (flat-shaded vertex-coloured Lambert, baked height gradients/AO in vertex colours),
glowing parts that bloom, soft shadows near the player, fog that meets the sky horizon seamlessly, a huge open
sky with layered horizon silhouettes. The UI keeps the v1 identity: indigo glass panels (`#1b1340` at 72%),
gold primary buttons (`#ffc233`), Lilita One headings, Fredoka text.
