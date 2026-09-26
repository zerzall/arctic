# Rainbow Rails — architecture contract

Plain JavaScript, no build step, no modules: every file is a classic `<script>` that reads and
extends the global `window.RR` namespace. Three.js **r128** is the global `THREE`
(`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`). Post-processing comes from
`https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/...` (non-module files that attach to `THREE`).
Nothing else may be loaded from the network: every texture is drawn on a canvas, every model is built
from primitives, every sound is synthesised. Fonts: Google Fonts "Lilita One" (display) and "Fredoka" (UI).

The page is published as a multi-file artifact AND must work when `game/index.html` is opened from disk
(`file://`), so scripts are referenced with relative paths (`js/core.js`) and nothing uses `fetch`.

## Files and ownership

| File | Global | Owns |
|---|---|---|
| `index.html` | — | markup, CSS, `<script>` order |
| `js/core.js` | `RR.C`, helpers | constants, maths, events, save data, world palettes, atmosphere blend, canvas textures, `Prop`, `InstancedPool`, `Pool`, quality tiers (**already written — do not change signatures; additive changes only**) |
| `js/sky.js` | `RR.sky` | sky dome shader, sun/moon, stars, aurora, rainbow, clouds, far mountain ranges, distant flyers (balloons, birds, blimps), lights (hemisphere + sun with shadows), fog |
| `js/track.js` | `RR.track` | ground, the three tracks (ballast, sleepers, rails), trackside curbs/walls, water planes, per-world ground dressing, all streamed in 50 m chunks |
| `js/worlds.js` | `RR.worlds` | near/mid scenery per world, landmark set-pieces, the tunnel/portal between worlds |
| `js/obstacles.js` | `RR.obstacles` | obstacle pattern spawner with fairness guarantees, trains (static, ramped, moving), barriers, signs, blocks, coins, pickups, collision queries |
| `js/player.js` | `RR.player` | character skins, rig and animation, hoverboard and jetpack visuals |
| `js/fx.js` | `RR.fx` | particles (ambient per world, bursts, dust, speed lines, trails), post-processing, `render()` |
| `js/audio.js` | `RR.audio` | Web Audio music per world + all sound effects, driven by events |
| `js/ui.js` | `RR.ui` | every DOM screen: title, shop, missions, settings, HUD, pause, game over, revive, toasts, tutorial hints |
| `js/game.js` | `RR.game` | boot, renderer/scene/camera, main loop (fixed-step simulation), state machine, input, physics and collisions, power-ups, hoverboard, revive, scoring, missions, camera, `window.__RR` debug hook |

Script order in `index.html`: three.min.js → post-processing files → core → sky → track → worlds →
obstacles → player → fx → audio → ui → game. `game.js` boots on `DOMContentLoaded` (or immediately if
already loaded).

Each file is wrapped as `(function (RR) { 'use strict'; ... RR.register('sky', api); })(window.RR);`
and must not throw at load time if another module is missing (check `RR.xxx &&` before cross-calls).

## Coordinates and hard spatial rules

- Units are metres. The player runs toward **−z**. `dist = −pz`. `y` is up; the ground is `y = 0`.
- Lanes: `RR.C.LANES = [−2.6, 0, 2.6]`. Trains are 2.2 wide; their walkable roof is `RR.C.TRAIN_H = 3.0`.
- **Track corridor:** nothing except track pieces, obstacles, pickups and the player may occupy
  `|x| < RR.C.CORRIDOR (6.5)` below `y = RR.C.OVERHEAD_CLEAR (11)`. Every prop placement must check
  `|x| − its footprint radius ≥ 6.5`. Structures spanning the track (bridges, gantries, tunnels, portals,
  arches, wires) keep everything inside the corridor above y = 11, apart from supports placed outside it.
  **Far layers** (mountains, hills, big landmarks) must satisfy `|x| − radius ≥ 40` so no slope can ever
  cross the track. (The v1 "wall" bug was a mountain cone wider than its distance from the track.)
- Nothing may float or sink: bottoms sit on `y = 0` (or on water/terrain at their true height).
- Depth precision: camera near = 0.3, far = `RR.C.CAMERA_FAR` (1600). Coplanar layers must be separated
  by ≥ 0.05 m **and** use `polygonOffset` on the lower layer, or be merged into one surface. No two large
  planes may share a height.
- Content streams from `pz + RR.C.DESPAWN_BEHIND` (behind) to `pz − RR.C.SPAWN_AHEAD` (ahead). Pop-in must
  be hidden: spawn beyond the fog's opaque distance, or fade/scale in.
- Worlds: `RR.worldIndexAt(z)` gives the world (0–4) at a z. World k (absolute count) starts at
  `z = −k·1000`. The world changes **spatially** at those boundaries: ground, track and scenery chunks
  belong to the world at their own z, never to "the current world". A tunnel/portal spans every boundary
  (`z ∈ [−k·1000 + 40, −k·1000 − 40]` for k ≥ 1, interior clear height ≥ 11, clear width ≥ 13) so the sky
  and lighting blend happens while the player is inside it. Obstacles may appear inside tunnels.
- Jetpack flight: feet at `RR.C.JETPACK_Y` (7.5); head ≈ 9.3 < 11.

## Lifecycle (every scene module)

```js
init(ctx)            // once. ctx = { renderer, scene, camera, quality }  (quality = RR.QUALITY tier object)
reset(pz)            // build/rebuild all streamed content around z = pz (title uses 0; __RR.warp uses any z)
update(dt, frame)    // every rendered frame, after the simulation
setQuality(q)        // quality tier changed (may be called any time)
```

`frame` is created by `game.js` each rendered frame:

```js
frame = {
  t, dt,                        // seconds since boot, frame delta (already clamped ≤ 0.1)
  state,                        // 'title' | 'run' | 'paused' | 'dying' | 'over'
  pz, px, py,                   // player feet position
  speed, dist,                  // m/s, metres
  world,                        // RR.worldIndexAt(pz): 0..4
  worldCount,                   // absolute world count floor(dist / 1000)
  camera,
  player: { lane, grounded, rolling, jetpack, board, sneakers, magnet, double, invulnerable }
}
```

Modules must be frame-rate independent (use `dt` and `RR.damp`), must not allocate in `update`
(reuse vectors), and must not assume `update` runs at 60 fps.

## Module APIs

### RR.sky
`init, reset, update, setQuality` plus `sunLight` (DirectionalLight with shadow; `update` moves it and its
target with the player so the shadow camera covers `px, pz`), `hemiLight`. Reads `RR.atmo` every frame
(game.js blends it with `RR.atmoUpdate`) and applies fog colour = `RR.atmo.horizon`, fog far = `RR.C.FOG_FAR`.

### RR.track
`init, reset, update, setQuality`. Chunks of 50 m; each chunk styled by the world at its z.
Ballast top is y = 0.05, sleepers top ≈ 0.14, rail top ≈ 0.28 (for visuals only; physics uses y = 0).

### RR.worlds
`init, reset, update, setQuality`. Scenery chunks of 50 m, styled by the world at their z. Owns the
portal/tunnel at every world boundary (k ≥ 1). Exposes `tunnelAt(z) → boolean` (is z inside a tunnel).

### RR.obstacles
```js
init, reset(pz), update(dt, frame), setQuality
list                         // active obstacle records
groundAt(px, py, pz)         // height of the walkable surface under the player (0, a ramp height, or TRAIN_H)
hit(px, py, pz, rolling)     // obstacle record the player collides with, or null
laneBlocked(lane, py, pz)    // true if moving into `lane` now would hit a train side
collect(px, py, pz, magnet, dt) // attracts (magnet) and collects coins/pickups; returns { coins, pickups: [kind...] }
spawnSkyCoins(z0, z1)        // coin trail at jetpack height between z0 and z1 (z0 > z1)
clearAhead(pz, metres)       // remove obstacles from pz to pz − metres (after revive / board crash)
nearMisses(px, pz)           // obstacles passed since last call with |x − px| < 3.2 in an adjacent lane → array
```
Obstacle record: `{ id, type, lane, x, zF, zB, top, bottom, vz, obj }` where `type` ∈
`'train' | 'ramp' | 'hurdle' | 'bar' | 'block'`, `zF` is the end nearest the player (larger z) and `zB` the far
end. `hurdle` = low barrier (jump, top 1.05), `bar` = overhead sign (roll; bottom 1.42, top 2.3),
`block` = tall barrier (dodge; top 3.2), `train` top = 3.05 (walkable at 3.0), `ramp` = slope in front of a
train from 0 to TRAIN_H. Pickup kinds: `'magnet' | 'sneakers' | 'double' | 'jetpack' | 'board'`.

Fairness guarantees (the spawner's job): at every z there is at least one lane the player can occupy
without an unavoidable crash, reachable from the previous safe lane with at least
`0.35 + 0.25·lanesToCross` seconds of reaction time at the current speed; moving trains never share a
stretch with a double block; nothing spawns closer than 60 m ahead of the player at run start or after
`clearAhead`.

### RR.player
```js
init, reset, setQuality
group                        // THREE.Group placed in the scene
SKINS                        // [{ id, name, price, blurb, colors... }] first one is free
setSkin(id)
update(dt, pose)             // pose = { x, y, z, laneVel (−1..1), grounded, vy, rolling, rollT (0..1),
                             //   jetpack, board, sneakers, magnet, invulnerable, speed,
                             //   state: 'title'|'run'|'paused'|'dying'|'over', deathT, stumbleT }
```
Feet at `group.position`. Faces −z. Casts shadows. Idle/wave animation on the title screen.

### RR.fx
```js
init, reset, update, setQuality
burst(kind, x, y, z)         // 'coin' | 'pickup' | 'crash' | 'dust' | 'land' | 'board-break' | 'portal' | 'sparkle'
render()                     // renders the frame (composer when quality.post, else renderer.render)
resize(w, h)
flash(cssColor, ms)          // brief full-screen tint
```
If the post-processing globals are missing, `render()` falls back to `renderer.render(scene, camera)`.

### RR.audio
`init()` (call from a user gesture), `setSound(on)`, `setMusic(on)`, `update(frame)` (music scheduler),
`setWorld(index)`, `pauseAll()`, `resumeAll()`. It subscribes to the events below itself.

### RR.ui
```js
init()
show(screen, data)           // 'title' | 'run' | 'pause' | 'over' | 'shop' | 'missions' | 'settings' | 'revive'
hud(data)                    // every frame while running: { score, coins, mult, dist, world, powers: [{ kind, left, dur }],
                             //   boards, boardActive, combo, missions }
toastWorld(index), toastMission(text), hint(text, ms), flashNewBest()
```
UI never touches game state directly; it emits events (below) and reads `RR.store.data`,
`RR.player.SKINS`, `RR.game.missions`.

### RR.game
Boot, loop, state, input, physics, missions, `window.__RR` (below). Owns the camera.

## Events (`RR.emit(name, data)` / `RR.on(name, fn)`)

Gameplay (emitted by game.js): `run-start`, `run-end` `{ score, dist, coins, cause }`, `coin` `{ n }`,
`pickup` `{ kind }`, `power-end` `{ kind }`, `jump`, `roll`, `land` `{ hard }`, `lane` `{ dir }`,
`stumble`, `crash` `{ cause }`, `board-on`, `board-break`, `jetpack-start`, `jetpack-end`,
`world` `{ index, count }`, `near-miss`, `combo` `{ n }`, `mission-progress` `{ mission }`,
`mission-done` `{ mission }`, `level-up` `{ level }`, `revive`, `pause`, `resume`, `new-best`.

UI → game: `ui:start`, `ui:pause`, `ui:resume`, `ui:quit`, `ui:restart`, `ui:revive`, `ui:decline-revive`,
`ui:board`, `ui:skin-select` `{ id }`, `ui:skin-buy` `{ id }`, `ui:board-buy`, `ui:setting` `{ key, value }`,
`ui:reset-progress`, `ui:click` (for the click sound).

## Debug hook (required; used by automated tests)

`game.js` exposes:

```js
window.__RR = {
  start(),                 // start a run exactly like pressing Start (no audio)
  freeze(on),              // stop/restart the requestAnimationFrame loop (tests freeze, then step)
  step(seconds, fps),      // advance simulation + visuals deterministically at dt = 1/fps (default 60), then render once
  warp(metres),            // teleport the run to that distance; every module is reset(pz) around it
  god(on),                 // crashes never end the run
  autopilot(on),           // simple AI: changes lane / jumps / rolls to survive
  give(kind),              // 'magnet' | 'sneakers' | 'double' | 'jetpack' | 'board'
  setQuality(name), setSkin(id),
  info(),                  // { state, dist, speed, world, fps, drawCalls, triangles, geometries, textures,
                           //   sceneObjects, obstacles, coins, score, quality }
  render()
}
```

## Look and feel

Low-poly, flat-shaded, saturated pastel worlds (vertex-coloured Lambert), bright unlit "glow" parts that
bloom, soft shadows near the player, deep fog-to-horizon blend, huge open sky. The UI keeps the v1
identity: indigo glass panels (`#1b1340` at 72%), gold primary buttons (`#ffc233`), Lilita One headings
and Fredoka text.

## Performance budget

Measured on the `high` tier at 1280×760: ≤ 300 draw calls, ≤ 800k triangles, zero per-frame allocations
in hot paths, no spawn hitch > 4 ms. `low` tier: ≤ 150 draw calls, ≤ 300k triangles, no shadows, no post.
Prefer `RR.InstancedPool` (one draw call per prop variant) over per-object meshes; share materials; never
create materials, textures or geometries per spawned object (build variants once at init).
