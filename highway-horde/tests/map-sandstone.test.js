// Sandstone (shared/maps-sandstone.js, SPEC §2 / §3.12): the Horde Elimination map, laid out like the
// classic two-site desert map. Its place in the lobby, determinism, the levels and the flights between
// them (walked with the real movement code: the ramps, the stairs, the catwalk drop, the pit), the
// sightlines (long doors, mid doors, the B window), both sites and their routes, the dark tunnels, the
// horde's T-side entrances and the bots' holding spots, reachability on the sim's own flow fields
// (walkers and heavies), anchors and spawns on open ground, a round played on it by bots and the art.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap, mapMeta } from '../public/js/shared/maps.js';
import { SANDSTONE, SANDSTONE_LEVELS, SANDSTONE_LANES, SANDSTONE_HOLDS } from '../public/js/shared/maps-sandstone.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { createCollisionWorld, stepPlayerMovement, MASK_HEAVY } from '../public/js/shared/movement.js';
import { terrainOf } from '../public/js/shared/terrain.js';
import { hordeLanes, hordeHold, hordeHoldFor, HORDE } from '../public/js/shared/horde.js';
import { mapModes, fixModeCombo } from '../public/js/shared/zone.js';
import { mapTimes, resolveTime } from '../public/js/shared/timeofday.js';
import { mergeSettings } from '../public/js/net/lobby-rules.js';
import { DEFAULT_SETTINGS } from '../public/js/shared/constants.js';
import { resetVertical } from '../public/js/shared/jump.js';
import { buildDress } from '../public/js/shared/dress.js';
import { Game } from '../public/js/shared/sim.js';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const ID = 'sandstone';
const cache = new Map();
function getMap(seed = 1) {
  if (!cache.has(seed)) cache.set(seed, buildMap(ID, seed));
  return cache.get(seed);
}
const mid = (R) => ({ x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 });

/** A walker's flow field (pad 3, like the sim's) or a heavy's (body 28, heavy mask) toward `targets`. */
function field(map, targets, heavy = false) {
  const colliders = mapColliders(map);
  const f = heavy ? new FlowField(map, { colliders, pad: 28, mask: MASK_HEAVY }) : new FlowField(map, { colliders, pad: 3 });
  f.update(targets);
  return f;
}

/** Walk a survivor with a fixed move input for `secs` seconds (the real movement code). */
function walk(map, world, x, y, z, mx, my, secs) {
  const p = { x, y, state: 'alive', stamina: 100, sprintLock: false, speedMult: 1, moveMult: 1 };
  resetVertical(p, Math.round(z / (48 / 324)));
  resetVertical(p, world.terrainQ(x, y));
  const cmd = { moveX: mx, moveY: my, sprint: false, jump: false, angle: 0 };
  for (let t = 0; t < Math.round(secs * 60); t++) stepPlayerMovement(p, cmd, 1 / 60, world);
  return p;
}

describe('Sandstone: the map', () => {
  test('in the lobby for Horde Elimination (and Defend), day by default, a desert town of about 3300 x 3200', () => {
    const entry = MAP_LIST.find((m) => m.id === ID);
    assert.ok(entry && entry.name === 'Sandstone');
    assert.ok(!/dust/i.test(entry.name + entry.description), 'its own name');
    assert.deepEqual(mapModes(ID), ['horde', 'defend']);
    assert.equal(mapTimes(ID)[0], 'day');
    assert.equal(entry.defaultTime, 'day');
    assert.equal(resolveTime(ID, undefined), 'day');
    assert.equal(mapMeta(ID).name, 'Sandstone');
    // picking the mode on a map that doesn't play it lands here, by day
    assert.deepEqual(fixModeCombo('harlan', 'horde', 'mode'), { mapId: ID, mode: 'horde' });
    const s = mergeSettings({ ...DEFAULT_SETTINGS, mapId: 'harlan', mode: 'zone' }, { mode: 'horde' });
    assert.deepEqual([s.mapId, s.mode, s.time], [ID, 'horde', 'day']);
    assert.equal(mergeSettings(s, { time: 'dusk' }).time, 'dusk', 'and at dusk when asked');
    assert.equal(mergeSettings({ ...DEFAULT_SETTINGS }, { mode: 'zone' }).time, 'night', 'other maps keep the time');
    // switching to Horde goes to Sandstone even from a map that plays it; picking another map then stays
    const h = mergeSettings({ ...DEFAULT_SETTINGS }, { mode: 'horde' });
    assert.deepEqual([h.mapId, h.mode, h.time], [ID, 'horde', 'day']);
    const t = mergeSettings(h, { mapId: 'truckstop' });
    assert.deepEqual([t.mapId, t.mode], ['truckstop', 'horde']);
    assert.equal(mergeSettings(t, { mode: 'horde' }).mapId, 'truckstop', 'the same mode again changes nothing');
    assert.equal(mergeSettings(t, { mode: 'horde', mapId: 'bridge' }).mapId, 'bridge');
    const m = getMap();
    assert.ok(m.width >= 3000 && m.width <= 3600 && m.height >= 3000 && m.height <= 3600, `${m.width} x ${m.height}`);
    assert.ok(m.obstacles.length >= 120 && m.obstacles.length <= 300, `${m.obstacles.length} obstacles`);
    const kinds = new Set(m.obstacles.map((o) => o.kind));
    for (const k of ['building', 'wall', 'container', 'counter', 'desk', 'tree', 'car']) assert.ok(kinds.has(k), `has ${k}`);
    const styles = new Set(m.obstacles.map((o) => o.style).filter(Boolean));
    for (const s2 of ['house', 'courtwall', 'gatehouse', 'bigdoor', 'crate', 'lowcrate', 'barrels', 'retain', 'stairwall', 'platedge', 'sill', 'cart', 'planter']) assert.ok(styles.has(s2), `style ${s2}`);
    assert.equal(m.obstacles.filter((o) => o.kind === 'car').length, 2, 'the long corner car and the B car');
    assert.ok(m.obstacles.filter((o) => o.kind === 'tree').length >= 10, 'palms');
    assert.deepEqual(m.look.trees, ['palm']);
    for (const t2 of ['arch', 'tarp', 'stairs', 'ramp', 'doorway', 'window', 'tunnel', 'sitemark', 'lantern', 'gatearch', 'step', 'awning']) assert.ok(m.sandArt.some((a) => a.t === t2), `art piece ${t2}`);
    assert.equal(m.roofs.length, 4, 'the tunnels are roofed (dark inside)');
    for (const r of m.roofs) assert.ok(r.dark >= 0.8 && r.style === 'tunnel');
    assert.ok(m.lights.length >= 15 && m.fires.length >= 2, 'lanterns and braziers for the night');
  });

  test('deterministic for a seed; the layout is the same on every seed, only the dressing moves', () => {
    const a = buildMap(ID, 42), b = buildMap(ID, 42), c = buildMap(ID, 9001);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    for (const k of ['width', 'height', 'playerSpawns', 'zombieSpawns', 'objective', 'supply', 'pois', 'anchors', 'terrain', 'roofs', 'sandArt', 'horde', 'lights']) {
      assert.deepEqual(a[k], c[k], `${k} is fixed layout`);
    }
    const fixed = (m) => m.obstacles.filter((o) => o.kind !== 'tree').map((o) => [o.kind, o.x, o.y, o.w, o.h, o.a, o.style || '']);
    assert.deepEqual(fixed(a), fixed(c));
    assert.notDeepEqual(a.decor, c.decor, 'the scatter follows the seed');
    assert.notDeepEqual(buildDress(a), buildDress(c), 'so does the set dressing');
    assert.deepEqual(buildDress(a), buildDress(b));
    assert.equal(a.dressItems, undefined, 'the set dressing stays out of the MapDef');
  });

  test('the levels: CT spawn, long, B and the catwalk up top, the A site higher, mid and the pit below', () => {
    const m = getMap();
    const t = terrainOf(m);
    const S = SANDSTONE, Lv = SANDSTONE_LEVELS;
    const at = (R) => t.height(mid(R).x, mid(R).y);
    for (const k of ['ctSpawn', 'long', 'longBottom', 'longDoors', 'outsideLong', 'catwalk', 'catwalkN', 'short', 'bSite', 'ctB', 'upperTunnel', 'bTunnel']) assert.equal(at(S[k]), Lv.up, k);
    for (const k of ['lowerMid', 'ctMid', 'pit', 'lowerTunnel', 'xboxPocket']) assert.equal(at(S[k]), Lv.low, k);
    for (const k of ['tSpawn', 'topMid', 'midAlley', 'outsideTunnels']) assert.equal(at(S[k]), Lv.t, k);
    assert.equal(t.height(2300, 600), Lv.a, 'A site');
    assert.equal(t.height(2800, 300), Lv.aPlat, 'the A platform');
    assert.equal(t.height(300, 280), Lv.bPlat, 'B platform');
    assert.ok(Lv.a > Lv.up && Lv.up > Lv.low && Lv.t > Lv.up);
    // every flight climbs in small steps from its foot to its head (a walker follows, the camera climbs smoothly)
    const flights = Object.entries(S).filter(([, R]) => R.axis);
    assert.ok(flights.length >= 10);
    for (const [name, F] of flights) {
      const alongX = F.axis === 'x';
      const a0 = alongX ? F.x0 : F.y0, a1 = alongX ? F.x1 : F.y1, c = alongX ? mid(F).y : mid(F).x;
      // from the foot (outside it, 10 units) to the head
      const foot = F.dir > 0 ? a0 - 10 : a1 + 10, head = F.dir > 0 ? a1 + 10 : a0 - 10;
      let prev = null;
      for (let i = 0; i <= 400; i++) {
        const u = foot + (head - foot) * (i / 400);
        const h = alongX ? t.height(u, c) : t.height(c, u);
        if (prev !== null) assert.ok(h - prev >= -0.01 && h - prev <= 6, `${name}: step ${(h - prev).toFixed(1)} at ${u.toFixed(0)}`);
        prev = h;
      }
      assert.equal(prev, F.h1, `${name} reaches its head`);
      assert.equal(alongX ? t.height(foot, c) : t.height(c, foot), F.h0, `${name} starts at its foot`);
    }
  });

  test('walking it: up the ramps and stairs, off the catwalk and into the pit, but not back up their walls', () => {
    const m = getMap();
    const world = createCollisionWorld(m);
    const S = SANDSTONE, Lv = SANDSTONE_LEVELS;
    // up the A ramp from long onto the site
    const ramp = walk(m, world, 2810, 1060, Lv.up, 0, -1, 3);
    assert.ok(ramp.y < S.aSite.y1 && Math.abs(ramp.z - Lv.a) < 1, `up the A ramp (${ramp.y.toFixed(0)}, z ${ramp.z.toFixed(1)})`);
    // up the catwalk stairs from the xbox pocket
    const cat = walk(m, world, 1750, 1920, 0, 0, -1, 2.5);
    assert.ok(cat.y < S.catwalk.y1 && Math.abs(cat.z - Lv.up) < 1, `up the catwalk stairs (${cat.y.toFixed(0)}, z ${cat.z.toFixed(1)})`);
    // the CT ramp out of CT mid into CT spawn
    const ct = walk(m, world, 1530, 1250, 0, 0, -1, 3);
    assert.ok(ct.y < S.ctSpawn.y1 && Math.abs(ct.z - Lv.up) < 1, `up the CT ramp (${ct.y.toFixed(0)}, z ${ct.z.toFixed(1)})`);
    // the pit's stairs out onto long
    const pit = walk(m, world, 3080, 2200, 0, 0, -1, 3);
    assert.ok(pit.y < S.pitStairs.y0 && Math.abs(pit.z - Lv.up) < 1, `out of the pit (${pit.y.toFixed(0)}, z ${pit.z.toFixed(1)})`);
    // the catwalk drop: walk off west into lower mid
    const drop = walk(m, world, 1750, 1520, Lv.up, -1, 0, 2);
    assert.ok(drop.x < S.catwalk.x0 - 20 && drop.z < 1, `dropped into mid (${drop.x.toFixed(0)}, z ${drop.z.toFixed(1)})`);
    // ... but walking back from mid stops at the catwalk's wall
    const back = walk(m, world, 1520, 1520, 0, 1, 0, 2);
    assert.ok(back.x < S.catwalk.x0 - 6 && back.z < 1, `stopped under the catwalk (${back.x.toFixed(1)}, z ${back.z.toFixed(1)})`);
    // long into the pit, and the pit's wall from below
    const into = walk(m, world, 2900, 2200, Lv.up, 1, 0, 2);
    assert.ok(into.x > S.pit.x0 + 12 && into.z < 1, `dropped into the pit (${into.x.toFixed(0)}, z ${into.z.toFixed(1)})`);
    const wallP = walk(m, world, 3080, 2250, 0, -1, 0, 2);
    assert.ok(wallP.x > S.pit.x0 + 12 && wallP.z < 1, `stopped at the pit's wall (${wallP.x.toFixed(1)})`);
    // up the B platform's stairs, and its edge from the site
    const plat = walk(m, world, 640, 250, Lv.up, -1, 0, 2.5);
    assert.ok(plat.x < S.bPlat.x1 && Math.abs(plat.z - Lv.bPlat) < 1, `up the B platform stairs (${plat.x.toFixed(0)}, z ${plat.z.toFixed(1)})`);
    const edge = walk(m, world, 350, 460, Lv.up, 0, -1, 2);
    assert.ok(edge.y > S.bPlat.y1 && Math.abs(edge.z - Lv.up) < 1, `stopped at the B platform's edge (${edge.y.toFixed(0)})`);
    // the retaining walls stand on the low side (low cover seen from above, a wall from below)
    const t = terrainOf(m);
    for (const o of m.obstacles.filter((q) => q.style === 'retain')) assert.equal(t.height(o.x, o.y), 0, 'a retaining wall stands on the low side');
  });

  test('sightlines: down long from the long doors, through the mid doors from top mid into CT, the window over B', () => {
    const m = getMap();
    const world = createCollisionWorld(m);
    // through the long doors' gap, up long and the ramp onto the A site
    assert.ok(world.lineOfSight(2800, 2490, 2800, 700), 'long doors → A ramp → A site');
    assert.ok(world.lineOfSight(2800, 2380, 3060, 2150), 'out of the long doors under the pit\'s eye');
    assert.ok(world.lineOfSight(3060, 2280, 2760, 1500), 'from the pit up long (over its low wall)');
    assert.ok(world.lineOfSight(3060, 2280, 2760, 1500), 'from the pit up long (over its low wall)');
    // from top mid through the mid doors' gap, CT mid and up the CT ramp into CT spawn
    assert.ok(world.lineOfSight(1505, 2500, 1515, 800), 'top mid → mid doors → CT spawn');
    assert.ok(!world.lineOfSight(1380, 2500, 1380, 1200), 'the mid doors\' walls block the sides');
    // the B window looks over B site from the window room (and is shot through)
    assert.ok(world.lineOfSight(1020, 380, 600, 400), 'B window → B site');
    // catwalk overlooks lower mid
    assert.ok(world.lineOfSight(1760, 1500, 1450, 1480), 'catwalk → lower mid');
  });

  test('two sites: A reached by long, short and CT; B by the tunnel and the B doors; the tunnels dark', () => {
    const m = getMap();
    const S = SANDSTONE;
    const block = (extra) => ({ ...m, obstacles: m.obstacles.concat(extra.map(([x, y, w, h], i) => ({ id: 9000 + i, kind: 'wall', x, y, w, h, a: 0, solid: true }))) });
    const reach = (mm, to, from) => field(mm, [to]).reachable(from.x, from.y);
    const A = mid(S.aSite), Bs = mid(S.bSite);
    // A from long alone (short and the CT ramp shut)
    const longOnly = block([[2310, 855, 180, 30], [2125, 500, 30, 240]]);
    assert.ok(reach(longOnly, A, { x: 2840, y: 1600 }), 'A from long');
    // A from the catwalk alone (the ramps shut)
    const shortOnly = block([[2810, 880, 180, 30], [2125, 500, 30, 240]]);
    assert.ok(reach(shortOnly, A, { x: 1750, y: 1500 }), 'A from short');
    // A from CT alone
    const ctOnly = block([[2810, 880, 180, 30], [2310, 855, 180, 30]]);
    assert.ok(reach(ctOnly, A, mid(S.ctSpawn)), 'A from CT spawn');
    // B from the tunnel alone, and from CT through the B doors alone
    assert.ok(reach(block([[920, 700, 40, 160]]), Bs, mid(S.upperTunnel)), 'B from the tunnels');
    assert.ok(reach(block([[750, 1200, 200, 30]]), Bs, mid(S.ctSpawn)), 'B from CT through the B doors');
    // mid from the lower tunnels alone
    assert.ok(reach(block([[750, 1200, 200, 30]]), mid(S.lowerMid), mid(S.upperTunnel)), 'lower tunnels into mid');
    // the tunnels are dark: roofed with a dark vault
    const under = (x, y) => m.roofs.some((r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(y - r.y) < r.h / 2 && r.dark >= 0.8);
    for (const k of ['upperTunnel', 'tunnelRoom', 'lowerTunnel', 'bTunnel', 'lowerStairs']) assert.ok(under(mid(S[k]).x, mid(S[k]).y), `${k} is under a roof`);
    assert.ok(!under(mid(S.bSite).x, mid(S.bSite).y) && !under(mid(S.lowerMid).x, mid(S.lowerMid).y), 'the sites and mid are open to the sky');
  });

  test('the horde\'s entrances: the four T-side lanes at the south edges, each with its holding spot', () => {
    const m = getMap();
    const lanes = hordeLanes(m);
    assert.deepEqual(lanes.map((l) => l.name), ['T Spawn', 'Outside Long', 'Top of Tunnels', 'Top Mid']);
    assert.deepEqual(lanes.map((l) => l.name), SANDSTONE_LANES.map((l) => l.name));
    assert.ok(lanes.every((l) => !l.late), 'no late flank: the CT side is the crew\'s');
    for (const z of m.zombieSpawns) {
      assert.ok(Number.isInteger(z.lane) && z.lane >= 0 && z.lane < lanes.length, 'every rect has its lane');
      assert.ok(Math.min(z.x, z.y, m.width - z.x, m.height - z.y) <= 100, 'at an edge');
      assert.ok(z.y > m.height * 0.75, 'on the T side');
    }
    for (let i = 0; i < lanes.length; i++) {
      for (let j = i + 1; j < lanes.length; j++) {
        const d = Math.hypot(lanes[i].x - lanes[j].x, lanes[i].y - lanes[j].y);
        assert.ok(d >= 500, `${lanes[i].name} and ${lanes[j].name} are ${d.toFixed(0)} apart`);
      }
    }
    // the compass marker of a lane is its rect
    for (const l of lanes) assert.ok(l.rects.some((r) => Math.hypot(r.x - l.x, r.y - l.y) < 1), `${l.name}'s marker`);
    // where the bots hold: CT spawn by default; A against long, B against tunnels, CT mid against mid
    const hold = hordeHold(m);
    assert.ok(Math.hypot(hold.x - SANDSTONE_HOLDS.ct.x, hold.y - SANDSTONE_HOLDS.ct.y) < 1, 'the defenders hold CT spawn');
    const by = (name) => 1 << lanes.find((l) => l.name === name).i;
    const near = (p, R) => p.x >= R.x0 && p.x <= R.x1 && p.y >= R.y0 && p.y <= R.y1;
    assert.ok(near(hordeHoldFor(m, by('Outside Long')), SANDSTONE.aSite), 'long → A site');
    assert.ok(near(hordeHoldFor(m, by('Top of Tunnels')), SANDSTONE.bSite), 'tunnels → B site');
    assert.ok(near(hordeHoldFor(m, by('Top Mid')), SANDSTONE.ctMid), 'mid → CT mid');
    assert.ok(near(hordeHoldFor(m, by('T Spawn')), SANDSTONE.ctSpawn), 'T spawn → CT spawn');
    assert.ok(near(hordeHoldFor(m, by('Outside Long') | by('Top of Tunnels')), SANDSTONE.ctSpawn), 'two sides → CT spawn, between them');
    assert.ok(near(hordeHoldFor(m, 0), SANDSTONE.ctSpawn));
    const w = createCollisionWorld(m);
    for (const k of Object.keys(SANDSTONE_HOLDS)) assert.ok(w.isCircleFree(SANDSTONE_HOLDS[k].x, SANDSTONE_HOLDS[k].y, 20, false), `hold ${k} in the open`);
    for (const z of m.zombieSpawns) assert.ok(Math.hypot(z.x - hold.x, z.y - hold.y) >= 1500, 'the entrances are far from CT');
  });

  test('every entrance reaches the defenders, both sites, CT mid and the supply (walkers and heavies)', () => {
    const m = getMap(7);
    const S = SANDSTONE;
    const targets = [m.playerSpawns[0], m.supply, mid(S.aSite), mid(S.bSite), { x: 2800, y: 320 }, { x: 330, y: 280 }, mid(S.ctMid), mid(S.long), mid(S.pit)];
    for (const tg of targets) {
      for (const heavy of [false, true]) {
        const f = field(m, [tg], heavy);
        for (const z of m.zombieSpawns) {
          assert.ok(f.reachable(z.x, z.y), `${heavy ? 'a heavy' : 'a walker'} from ${z.x},${z.y} reaches ${Math.round(tg.x)},${Math.round(tg.y)}`);
        }
      }
    }
    // and every place a survivor can stand that matters: POIs, anchors, player spawns, every walkable rect
    const f = field(m, [m.zombieSpawns[0]]);
    for (const p of m.pois) assert.ok(f.reachable(p.x, p.y), p.name);
    for (const [n, a] of Object.entries(m.anchors)) assert.ok(f.reachable(a.x, a.y), n);
    for (const p of m.playerSpawns) assert.ok(f.reachable(p.x, p.y));
    for (const [k, R] of Object.entries(S)) {
      if (k === 'bWindow') continue;
      const c = mid(R);
      assert.ok([[0, 0], [-40, 0], [40, 0], [0, -40], [0, 40]].some(([dx, dy]) => f.reachable(c.x + dx, c.y + dy)), `${k} reachable`);
    }
  });

  test('anchors, player spawns, the supply and the spawn rects stand in the open (every seed)', () => {
    for (const seed of [1, 7, 4242]) {
      const m = getMap(seed);
      const world = createCollisionWorld(m);
      for (const [n, a] of Object.entries(m.anchors)) assert.ok(world.isCircleFree(a.x, a.y, 16, false), `anchor ${n}`);
      for (const p of m.playerSpawns) assert.ok(world.isCircleFree(p.x, p.y, 18, false), `spawn ${p.x},${p.y}`);
      assert.ok(world.isCircleFree(m.supply.x, m.supply.y, 20, false), 'supply');
      for (const z of m.zombieSpawns) {
        let free = 0;
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (world.isCircleFree(z.x - z.w / 2 + (z.w * i) / 4, z.y - z.h / 2 + (z.h * j) / 4, 14, false)) free++;
        assert.equal(free, 25, `spawn rect ${z.x},${z.y} is open`);
      }
      for (let i = 0; i < m.playerSpawns.length; i++) for (let j = i + 1; j < m.playerSpawns.length; j++) {
        assert.ok(Math.hypot(m.playerSpawns[i].x - m.playerSpawns[j].x, m.playerSpawns[i].y - m.playerSpawns[j].y) >= 40);
      }
    }
  });

  test('defend layout: the mast in CT spawn, the supply and the spawns beside it, the horde far out', () => {
    const m = getMap();
    const ob = m.objective;
    assert.equal(ob.kind, 'radio');
    const sd = Math.hypot(m.supply.x - ob.x, m.supply.y - ob.y);
    assert.ok(sd >= 250 && sd <= 450, `supply ${sd.toFixed(0)} from the mast`);
    for (const p of m.playerSpawns) assert.ok(Math.hypot(p.x - ob.x, p.y - ob.y) < 600);
    for (const z of m.zombieSpawns) assert.ok(Math.hypot(z.x - ob.x, z.y - ob.y) >= 800);
  });
});

describe('Sandstone: a horde round', () => {
  test('bots start a round, the horde comes through the entrances and dies; deterministic; the bots hold the CT side', () => {
    const players = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `B${i}`, color: i, cls: ['soldier', 'medic', 'assault'][i], bot: true }));
    const mk = () => new Game({ mapId: ID, seed: 11, settings: { mode: 'horde', difficulty: 'normal' }, players });
    const a = mk(), b = mk();
    assert.equal(a.mode, 'horde');
    assert.equal(a.settings.time, 'day');
    let peak = 0;
    const holds = new Set();
    for (let t = 0; t < 60 * 100; t++) {
      a.step();
      b.step();
      peak = Math.max(peak, a.zombies.length);
      holds.add(`${a.horde.hold.x},${a.horde.hold.y}`);
      if (t % 600 === 599) assert.deepEqual(a.snapshot(), b.snapshot(), `tick ${t}`);
    }
    assert.equal(a.phase, 'wave');
    assert.ok(a.horde.surge >= 2, `surge ${a.horde.surge}`);
    assert.ok(a.horde.left() < a.horde.total, 'zombies died');
    assert.ok(a.players.reduce((s, p) => s + p.kills, 0) > 10, 'the bots fight');
    assert.ok(peak > 5);
    // the bots stay on the CT half (the sites, CT spawn, CT mid), not out at the T side
    for (const p of a.players) if (p.state === 'alive') assert.ok(p.y < 2100, `${p.name} at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    const spots = Object.values(SANDSTONE_HOLDS).map((h) => `${h.x},${h.y}`);
    for (const h of holds) assert.ok(spots.includes(h), `the director holds a named spot (${h})`);
    assert.ok(HORDE.surges >= 6);
  });
});

// ---- the art, headless ----------------------------------------------------------------------------

let THREE = null, geoMod = null;

/** three.js and the geo builder with a fake canvas (the atlas painter draws into nothing). */
async function loadRenderer() {
  if (THREE) return { THREE, geoMod };
  globalThis.document = globalThis.document || {
    createElement: () => {
      const c = { width: 1, height: 1, style: {} };
      const grad = { addColorStop() {} };
      const methods = {
        createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        measureText: () => ({ width: 10 }),
      };
      c.getContext = () => new Proxy({ canvas: c }, { get: (t, p) => (p in methods ? methods[p] : p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
      return c;
    },
  };
  THREE = await import('three');
  geoMod = await import('../public/js/render3d/world-geo.js');
  return { THREE, geoMod };
}

/** Build the map's art the way world.js does (obstacles, roofs, props, finish) on a tier, headless. */
async function buildArt(map, tier, day) {
  const { THREE: T3, geoMod: G } = await loadRenderer();
  const levels = await import('../public/js/render3d/levels/index.js');
  const { createWorldMaterials } = await import('../public/js/render3d/world-mat.js');
  const { setDetailLevel } = await import('../public/js/render3d/world-arch.js');
  const terr = terrainOf(map);
  const gy = terr.flat ? () => 0 : (x, y) => terr.height(x, y);
  const buckets = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true }, ...levels.levelBuckets(map),
  };
  const newBuilder = () => { const b = G.createGeoBuilder({ cell: 1600, buckets }); if (!terr.flat) b.setGround(gy); return b; };
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  setDetailLevel(tier === 'low' ? 0 : tier === 'high' ? 1 : tier === 'ultra' ? 2 : 3);
  try {
    const tex = new T3.DataTexture(new Uint8Array(4), 1, 1);
    const mats = createWorldMaterials({ detail: tex, atlas: tex, chain: tex, leaves: tex });
    const root = new T3.Group();
    const halos = [], shafts = [];
    const ctx = { map, quality: tier, groundY: gy, terrain: terr };
    const art = levels.createLevelArt(ctx, { root, mats, fx: null, halos, shafts, day, aniso: 1, gy, tier: tier === 'cinematic' ? 'ultra' : tier, full: tier, newBuilder, matOf: (b, t) => (art && art.buckets[b] ? art.material(b, t) : mats.get(b, t)) });
    assert.ok(art, 'the map has art');
    const B = newBuilder();
    let drawn = 0;
    for (const o of map.obstacles) {
      B.obj(o.x, o.y, o.a || 0, o.id * 31);
      if (art.obstacle(B, o)) drawn++;
    }
    let roofs = 0;
    for (const r of map.roofs) if (art.roof(B, r)) roofs++;
    art.props(B);
    const parts = B.finish();
    let tris = 0;
    for (const { bucket, geometry } of parts) {
      tris += geometry.attributes.position.count / 3;
      assert.ok(art.buckets[bucket] || mats.get(bucket, 'high'), `material for ${bucket}`);
      const p = geometry.attributes.position.array;
      for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error(`NaN vertex in ${bucket}`);
    }
    art.finish();
    art.update({ players: [], zombies: [] }, { dt: 0.016, camX: 2000, camY: 500 });
    art.setQuality(tier === 'low' ? 'high' : 'low');
    art.dispose();
    mats.dispose();
    return { tris, meshes: parts.length, warnings, drawn, roofs, halos: halos.length };
  } finally {
    console.warn = warn;
  }
}

describe('Sandstone: the art', () => {
  test('the art seam finds the map\'s module by its art name (and only for it)', async () => {
    await loadRenderer();
    const levels = await import('../public/js/render3d/levels/index.js');
    const m = getMap();
    assert.equal(m.art, 'sandstone');
    assert.ok(levels.artModuleOf(m), 'Sandstone has an art module');
    assert.ok(Object.keys(levels.levelBuckets(m)).includes('sssign'));
    assert.equal(levels.artModuleOf(buildMap('truckstop', 1)), null, 'the other match maps have none');
    assert.equal(levels.artModuleOf({ ...m, art: 'nowhere' }), null);
    assert.equal(levels.artModuleOf({ ...m, art: { corn: [] } }), null, 'a non-level map with art data is not an art name');
    assert.ok(levels.artModuleOf(buildMap('millroad', 1)), 'a level is found by its id, as before');
  });

  test('the art builds on every tier, by day and by night, within budget', async (t) => {
    const m = getMap(7);
    const out = {};
    for (const tier of ['low', 'high', 'ultra', 'cinematic']) {
      for (const day of [true, false]) {
        const r = await buildArt(m, tier, day);
        assert.deepEqual(r.warnings, [], `${tier}${day ? ' day' : ''}: ${r.warnings.join(' | ')}`);
        assert.equal(r.roofs, 4, 'the art draws every tunnel vault');
        out[tier + (day ? '-day' : '')] = r;
      }
    }
    for (const [k, r] of Object.entries(out)) t.diagnostic(`${k}: ${Math.round(r.tris)} tris in ${r.meshes} meshes, ${r.drawn} obstacles drawn, ${r.halos} halos`);
    const styled = m.obstacles.filter((o) => o.style).length;
    assert.equal(out['ultra-day'].drawn, styled, 'every styled obstacle has a model');
    assert.ok(out['ultra-day'].tris < 1500000, `ultra: ${out['ultra-day'].tris} triangles`);
    assert.ok(out['low-day'].tris < out['high-day'].tris && out['high-day'].tris <= out['ultra-day'].tris, 'detail grows with the tier');
    assert.ok(out['cinematic-day'].meshes < 200, `cinematic: ${out['cinematic-day'].meshes} meshes`);
    assert.ok(out.ultra.halos > out['ultra-day'].halos, 'the lanterns glow at night');
  });
});
