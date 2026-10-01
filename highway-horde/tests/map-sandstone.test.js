// Sandstone (shared/maps-sandstone.js, SPEC §2 / §3.12): the Horde Elimination map. Its place in
// the lobby, determinism, the layout (the two sites, the raised terrace and how it is reached, the
// tunnels, the doors), the horde's entrances, reachability on the sim's own flow fields (walkers
// and heavies), anchors and spawns on open ground, and a round played on it by bots.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, buildMap, mapMeta } from '../public/js/shared/maps.js';
import { SANDSTONE, SANDSTONE_H, SANDSTONE_LANES } from '../public/js/shared/maps-sandstone.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { createCollisionWorld, stepPlayerMovement, MASK_HEAVY } from '../public/js/shared/movement.js';
import { terrainOf } from '../public/js/shared/terrain.js';
import { hordeLanes, hordeHold, HORDE } from '../public/js/shared/horde.js';
import { mapModes, fixModeCombo } from '../public/js/shared/zone.js';
import { mapTimes, resolveTime } from '../public/js/shared/timeofday.js';
import { resetVertical } from '../public/js/shared/jump.js';
import { buildDress } from '../public/js/shared/dress.js';
import { Game } from '../public/js/shared/sim.js';

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
  test('in the lobby for Horde Elimination (and Defend), day by default, a sandy town of about 4000 square', () => {
    const entry = MAP_LIST.find((m) => m.id === ID);
    assert.ok(entry && entry.name === 'Sandstone');
    assert.ok(!/dust/i.test(entry.name + entry.description), 'its own name');
    assert.deepEqual(mapModes(ID), ['horde', 'defend']);
    assert.equal(mapTimes(ID)[0], 'day');
    assert.equal(entry.defaultTime, 'day');
    assert.equal(resolveTime(ID, undefined), 'day');
    assert.equal(mapMeta(ID).name, 'Sandstone');
    // picking the mode on a map that doesn't play it lands here
    assert.deepEqual(fixModeCombo('harlan', 'horde', 'mode'), { mapId: ID, mode: 'horde' });
    const m = getMap();
    assert.ok(m.width >= 3500 && m.width <= 4500 && m.height >= 3500 && m.height <= 4500, `${m.width} x ${m.height}`);
    assert.ok(m.obstacles.length >= 120 && m.obstacles.length <= 260, `${m.obstacles.length} obstacles`);
    const kinds = new Set(m.obstacles.map((o) => o.kind));
    for (const k of ['building', 'wall', 'container', 'counter', 'booth', 'tree', 'car', 'hesco', 'parapet']) assert.ok(kinds.has(k), `has ${k}`);
    const styles = new Set(m.obstacles.map((o) => o.style).filter(Boolean));
    for (const s of ['house', 'courtwall', 'gatehouse', 'bigdoor', 'doorleaf', 'crate', 'lowcrate', 'barrels', 'stall', 'well', 'fountain', 'retain', 'parapet', 'sill', 'cart', 'planter']) assert.ok(styles.has(s), `style ${s}`);
    assert.ok(m.obstacles.some((o) => o.kind === 'car' && o.wrecked), 'a burnt-out car');
    assert.ok(m.obstacles.filter((o) => o.kind === 'tree').length >= 10, 'palms');
    assert.deepEqual(m.look.trees, ['palm']);
    assert.ok(m.sandArt.some((a) => a.t === 'arch') && m.sandArt.some((a) => a.t === 'tarp') && m.sandArt.some((a) => a.t === 'stairs'));
    assert.equal(m.roofs.length, 2, 'the two tunnels are roofed (dark inside)');
    for (const r of m.roofs) assert.ok(r.dark >= 0.8 && r.style === 'tunnel');
    assert.ok(m.lights.length >= 15 && m.fires.length >= 2, 'lanterns and braziers for the night');
  });

  test('deterministic for a seed; the layout is the same on every seed, only the dressing moves', () => {
    const a = buildMap(ID, 42), b = buildMap(ID, 42), c = buildMap(ID, 9001);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    for (const k of ['width', 'height', 'playerSpawns', 'zombieSpawns', 'objective', 'supply', 'pois', 'anchors', 'terrain', 'roofs', 'sandArt', 'horde', 'lights']) {
      assert.deepEqual(a[k], c[k], `${k} is fixed layout`);
    }
    const fixed = (m) => m.obstacles.filter((o) => o.kind !== 'tree' && o.kind !== 'car' && o.kind !== 'van' && o.kind !== 'pickup').map((o) => [o.kind, o.x, o.y, o.w, o.h, o.a, o.style || '']);
    assert.deepEqual(fixed(a), fixed(c));
    assert.notDeepEqual(a.decor, c.decor, 'the scatter follows the seed');
    assert.notDeepEqual(buildDress(a), buildDress(c), 'so does the set dressing');
    assert.deepEqual(buildDress(a), buildDress(b));
    assert.equal(a.dressItems, undefined, 'the set dressing stays out of the MapDef');
  });

  test('the raised terrace, the rampart walk over the Long Hall and the ways up', () => {
    const m = getMap();
    const t = terrainOf(m);
    const H = SANDSTONE_H;
    assert.equal(t.height(mid(SANDSTONE.terrace).x, mid(SANDSTONE.terrace).y), H);
    assert.equal(t.height(mid(SANDSTONE.rampart).x, mid(SANDSTONE.rampart).y), H);
    assert.equal(t.height(mid(SANDSTONE.long).x, mid(SANDSTONE.long).y), 0, 'the Long Hall is at street level');
    assert.equal(t.height(mid(SANDSTONE.square).x, mid(SANDSTONE.square).y), 0);
    // every flight climbs in small steps (a walker follows, the camera climbs smoothly)
    const S = SANDSTONE;
    const along = [
      ['A stairs', (u) => [S.aStairs.x0 - 10 + u * (S.aStairs.x1 - S.aStairs.x0 + 20), mid(S.aStairs).y]],
      ['short stairs', (u) => [S.shortStairs.x0 - 10 + u * (S.shortStairs.x1 - S.shortStairs.x0 + 20), mid(S.shortStairs).y]],
      ['back stairs', (u) => [S.backStairs.x1 + 10 - u * (S.backStairs.x1 - S.backStairs.x0 + 20), mid(S.backStairs).y]],
      ['ramp', (u) => [mid(S.ramp).x, S.ramp.y1 + 10 - u * (S.ramp.y1 - S.ramp.y0 + 20)]],
    ];
    for (const [name, at] of along) {
      let prev = null;
      for (let i = 0; i <= 400; i++) {
        const [x, y] = at(i / 400);
        const h = t.height(x, y);
        if (prev !== null) assert.ok(h - prev >= -0.01 && h - prev <= 6, `${name}: step ${(h - prev).toFixed(1)} at ${x.toFixed(0)},${y.toFixed(0)}`);
        prev = h;
      }
      assert.equal(prev, H, `${name} reaches the top`);
    }
    // walking it with the real movement code
    const world = createCollisionWorld(m);
    const up = walk(m, world, S.aStairs.x0 - 60, mid(S.aStairs).y, 0, 1, 0, 2.2);
    assert.ok(up.x > S.terrace.x0 && Math.abs(up.z - H) < 1, `up the A stairs onto the terrace (${up.x.toFixed(0)}, z ${up.z.toFixed(1)})`);
    const ramp = walk(m, world, mid(S.ramp).x, S.ramp.y1 + 120, 0, 0, -1, 3);
    assert.ok(ramp.y < S.ramp.y0 && Math.abs(ramp.z - H) < 1, `up the ramp (${ramp.y.toFixed(0)}, z ${ramp.z.toFixed(1)})`);
    // the rampart's edge over the hall: no stepping up from below, no walking off from above (shots pass)
    const below = walk(m, world, 3500, 1900, 0, -1, 0, 2.5);
    assert.ok(below.x >= S.rampart.x1 + 16 - 0.5 && below.z < 1, `stopped at the retaining wall (${below.x.toFixed(1)}, z ${below.z.toFixed(1)})`);
    const above = walk(m, world, 3290, 1900, H, 1, 0, 2.5);
    assert.ok(above.x <= S.rampart.x1 - 14 - 16 + 0.5 && Math.abs(above.z - H) < 1, `stopped at the parapet (${above.x.toFixed(1)})`);
    const parapets = m.obstacles.filter((o) => o.kind === 'parapet');
    assert.ok(parapets.length >= 5 && parapets.every((o) => !o.solid), 'the parapet is low cover: shoot over it');
    assert.ok(m.obstacles.filter((o) => o.kind === 'hesco').every((o) => t.height(o.x, o.y) === 0), 'the retaining wall stands in the hall');
  });

  test('two sites: the terrace (reached three ways) and the enclosed court (several entrances)', () => {
    const m = getMap();
    const S = SANDSTONE;
    const court = mid(S.court);
    const f = field(m, [court]);
    // the court's ways in: the upper tunnel, the double doorway, the West Breach, the North Arch side
    const ways = [[650, 1500], [1350, 720], [80, 950]];
    for (const [x, y] of ways) assert.ok(f.reachable(x, y), `${x},${y} reaches the court`);
    // each entrance on its own: block the others and the court is still reached
    const doorX = 1240, doorY = 720;
    const blocked = { ...m, obstacles: m.obstacles.concat([
      { id: 9001, kind: 'wall', x: doorX, y: doorY, w: 30, h: 170, a: 0, solid: true },
      { id: 9002, kind: 'wall', x: 650, y: 1300, w: 220, h: 30, a: 0, solid: true },
    ]) };
    const f2 = field(blocked, [court]);
    assert.ok(f2.reachable(80, 950), 'through the West Breach alone');
    // the terrace from the square (A stairs), from the Long Hall (the ramp), from Mid (the short stairs and the rampart)
    const ter = mid(S.terrace);
    const ft = field(m, [ter]);
    for (const [x, y, what] of [[2000, 500, 'the square'], [3500, 2500, 'the Long Hall'], [2600, 2290, 'the short alley'], [3940, 510, 'the East Stairs']]) {
      assert.ok(ft.reachable(x, y), `the terrace from ${what}`);
    }
  });

  test('the horde\'s entrances: six named lanes at the edges, spread around the town', () => {
    const m = getMap();
    const lanes = hordeLanes(m);
    assert.ok(lanes.length >= 5);
    assert.deepEqual(lanes.map((l) => l.name), SANDSTONE_LANES.map((l) => l.name));
    assert.ok(lanes.filter((l) => l.late).map((l) => l.name).join() === 'North Arch', 'only the North Arch opens late');
    for (const z of m.zombieSpawns) {
      assert.ok(Number.isInteger(z.lane) && z.lane >= 0 && z.lane < lanes.length, 'every rect has its lane');
      assert.ok(Math.min(z.x, z.y, m.width - z.x, m.height - z.y) <= 100, 'at an edge');
    }
    for (let i = 0; i < lanes.length; i++) {
      for (let j = i + 1; j < lanes.length; j++) {
        const d = Math.hypot(lanes[i].x - lanes[j].x, lanes[i].y - lanes[j].y);
        assert.ok(d >= 1000, `${lanes[i].name} and ${lanes[j].name} are ${d.toFixed(0)} apart`);
      }
    }
    const hold = hordeHold(m);
    assert.ok(Math.hypot(hold.x - 2000, hold.y - 470) < 1, 'the defenders hold Fountain Square');
    for (const z of m.zombieSpawns) assert.ok(Math.hypot(z.x - hold.x, z.y - hold.y) >= 700, 'no entrance inside the square');
  });

  test('every entrance reaches the defenders, both sites and the supply (walkers and heavies)', () => {
    const m = getMap(7);
    const targets = [m.playerSpawns[0], m.supply, mid(SANDSTONE.terrace), mid(SANDSTONE.court)];
    for (const tg of targets) {
      for (const heavy of [false, true]) {
        const f = field(m, [tg], heavy);
        for (const z of m.zombieSpawns) {
          assert.ok(f.reachable(z.x, z.y), `${heavy ? 'a heavy' : 'a walker'} from ${z.x},${z.y} reaches ${Math.round(tg.x)},${Math.round(tg.y)}`);
        }
      }
    }
    // and every place a survivor can stand that matters: POIs, anchors, player spawns
    const f = field(m, [m.zombieSpawns[0]]);
    for (const p of m.pois) assert.ok(f.reachable(p.x, p.y), p.name);
    for (const [n, a] of Object.entries(m.anchors)) assert.ok(f.reachable(a.x, a.y), n);
    for (const p of m.playerSpawns) assert.ok(f.reachable(p.x, p.y));
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

  test('defend layout: the mast in the square, the supply and the spawns beside it, the horde far out', () => {
    const m = getMap();
    const ob = m.objective;
    assert.equal(ob.kind, 'radio');
    const sd = Math.hypot(m.supply.x - ob.x, m.supply.y - ob.y);
    assert.ok(sd >= 250 && sd <= 450, `supply ${sd.toFixed(0)} from the mast`);
    for (const p of m.playerSpawns) assert.ok(Math.hypot(p.x - ob.x, p.y - ob.y) < 400);
    for (const z of m.zombieSpawns) assert.ok(Math.hypot(z.x - ob.x, z.y - ob.y) >= 800);
  });
});

describe('Sandstone: a horde round', () => {
  test('bots start a round, the horde comes through the entrances and dies; deterministic', () => {
    const players = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `B${i}`, color: i, cls: ['soldier', 'medic', 'assault'][i], bot: true }));
    const mk = () => new Game({ mapId: ID, seed: 11, settings: { mode: 'horde', difficulty: 'normal' }, players });
    const a = mk(), b = mk();
    assert.equal(a.mode, 'horde');
    assert.equal(a.settings.time, 'day');
    let peak = 0;
    for (let t = 0; t < 60 * 100; t++) {
      a.step();
      b.step();
      peak = Math.max(peak, a.zombies.length);
      if (t % 600 === 599) assert.deepEqual(a.snapshot(), b.snapshot(), `tick ${t}`);
    }
    assert.equal(a.phase, 'wave');
    assert.ok(a.horde.surge >= 2, `surge ${a.horde.surge}`);
    assert.ok(a.horde.left() < a.horde.total, 'zombies died');
    assert.ok(a.players.reduce((s, p) => s + p.kills, 0) > 10, 'the bots fight');
    assert.ok(peak > 5);
    // the bots stay with the crew around the square / sites, not out at the gates
    for (const p of a.players) if (p.state === 'alive') assert.ok(p.y < 2600, `${p.name} at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    assert.ok(HORDE.surges >= 6);
  });
});
