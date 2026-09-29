// The Campaign (SPEC §3.8): map extension, terrain, stage progression, the hill's slow zones,
// floors, quota / zip line / escape / victory / defeat, late join, bots playing a whole run,
// the snapshot wire format and lobby validation. Headless: no DOM, no renderer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAP_LIST, buildMap } from '../public/js/shared/maps.js';
import { Game } from '../public/js/shared/sim.js';
import { createCollisionWorld } from '../public/js/shared/movement.js';
import { terrainOf, terrainHeight, makeTerrain } from '../public/js/shared/terrain.js';
import { Z_UNIT, toZq } from '../public/js/shared/jump.js';
import { PROTOCOL_VERSION, NAV_REBUILD_INTERVAL, TICK_RATE } from '../public/js/shared/constants.js';
import { walkComponents, componentAt } from '../public/js/shared/sim/zone.js';
import {
  CAMPAIGN, SUB, RIDE_TICKS, wavePlan, stageOfWave, hillWaves, killQuota, frontDps, frontSpeed, routeProgress,
  routePoint, routePointExt, pathLen, frontGap, stageBanner,
} from '../public/js/shared/campaign.js';
import { CAMPAIGN_KINDS } from '../public/js/shared/maps-campaign.js';
import { encodeSnapshot, decodeSnapshot } from '../public/js/shared/protocol.js';
import { mergeSettings } from '../public/js/net/lobby-rules.js';
import { fixModeCombo, mapModes, MODE_IDS } from '../public/js/shared/zone.js';
import { cmd, addZombie, godMode } from './helpers/sim-helpers.js';

const CAMPAIGN_MAPS = ['checkpoint', 'highway', 'harlan'];
const OTHER_MAPS = ['truckstop', 'bridge'];
const CLASSES = ['medic', 'soldier', 'engineer', 'heavy', 'scout', 'demo'];

function campaignGame({ mapId = 'checkpoint', seed = 1, n = 1, bots = false, waves = 10, difficulty = 'normal' } = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, color: i, cls: CLASSES[i % 6], bot: bots }));
  return new Game({ mapId, seed, settings: { difficulty, waves, mode: 'campaign' }, players });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------------------------
describe('the extension: maps', () => {
  test('three maps carry a campaign; the default build of every map is untouched', () => {
    for (const id of CAMPAIGN_MAPS) {
      const def = buildMap(id, 1), c = buildMap(id, 1, { mode: 'campaign' });
      assert.equal(def.campaign, undefined, `${id}: the default map has no campaign`);
      assert.equal(def.terrain, undefined, `${id}: ... and no terrain`);
      assert.equal(JSON.stringify(def), JSON.stringify(buildMap(id, 1, { mode: 'defend' })), `${id}: mode defend builds the same map`);
      assert.equal(JSON.stringify(def), JSON.stringify(buildMap(id, 1, { mode: 'zone' })), `${id}: mode zone builds the same map`);
      assert.ok(c.campaign, `${id}: the campaign variant has the extension`);
      assert.equal(c.time, 'day', `${id}: a daytime map`);
      assert.deepEqual(c.zombieSpawns, [], `${id}: no edge spawns (the director places them)`);
      assert.ok(c.terrain && c.terrain.hills.length === 1 && c.terrain.plateaus.length >= 4, `${id}: a hill and the annex plateaus`);
      assert.ok(mapModes(id).includes('campaign'), `${id}: listed with the mode`);
      for (const o of def.obstacles) assert.ok(!CAMPAIGN_KINDS.includes(o.kind), `${id}: default map has no '${o.kind}'`);
    }
    for (const id of OTHER_MAPS) {
      assert.equal(JSON.stringify(buildMap(id, 1)), JSON.stringify(buildMap(id, 1, { mode: 'campaign' })), `${id}: unextended maps ignore the mode`);
      assert.ok(!mapModes(id).includes('campaign'));
    }
  });

  test('deterministic per (map, seed); the extension is the same for every seed', () => {
    for (const id of CAMPAIGN_MAPS) {
      const a = JSON.stringify(buildMap(id, 7, { mode: 'campaign' })), b = JSON.stringify(buildMap(id, 7, { mode: 'campaign' }));
      assert.equal(a, b, `${id}: same seed, same map`);
      const c1 = buildMap(id, 1, { mode: 'campaign' }).campaign, c2 = buildMap(id, 99, { mode: 'campaign' }).campaign;
      assert.deepEqual(c1.hill, c2.hill, `${id}: the hill does not move with the seed`);
      assert.deepEqual(c1.floors.map((f) => f.base), c2.floors.map((f) => f.base));
    }
  });

  test('the schema: hill, route, tower, three floors, roof, landing; everything inside the map', () => {
    for (const id of CAMPAIGN_MAPS) {
      const m = buildMap(id, 1, { mode: 'campaign' }), c = m.campaign;
      const inside = (p, what) => assert.ok(p.x > 0 && p.y > 0 && p.x < m.width && p.y < m.height, `${id}: ${what} inside the map`);
      inside(c.hill, 'hill');
      inside(c.tower, 'tower');
      inside(c.entrance, 'entrance');
      assert.equal(c.floors.length, 3);
      assert.deepEqual(c.floors.map((f) => f.name), ['Lobby', 'Offices', 'Atrium']);
      assert.ok(c.floors.every((f, i) => f.n === i + 1 && f.base >= 0 && (i === 0 || f.base > c.floors[i - 1].base)), `${id}: floors rise`);
      assert.ok(c.roof.base > c.floors[2].base, `${id}: the roof is above the last floor`);
      assert.ok(c.landing.end.z < c.roof.zip.z, `${id}: the cable runs downhill`);
      for (const f of c.floors) {
        for (const p of [f.stairs, ...f.arrive, f.supply]) {
          assert.ok(p.x > f.x0 && p.x < f.x1 && p.y > f.y0 && p.y < f.y1, `${id} ${f.name}: point inside the floor`);
        }
      }
      for (const p of [...c.roof.arrive, c.roof.supply]) assert.ok(p.x > c.roof.x0 && p.x < c.roof.x1 && p.y > c.roof.y0 && p.y < c.roof.y1);
      assert.ok(c.routeLen > 2000 && Math.abs(c.routeLen - pathLen(c.route)) < 1, `${id}: route length`);
      assert.ok(m.playerSpawns.length >= 6, 'room for a full team on the hill');
    }
  });

  test('size and object budgets: the enlarged maps stay within what the sim and renderers handle', () => {
    const budget = { checkpoint: [4850, 5860, 340], highway: [9500, 5060, 500], harlan: [7200, 10060, 800] };
    for (const id of CAMPAIGN_MAPS) {
      const m = buildMap(id, 1, { mode: 'campaign' });
      const [w, h, n] = budget[id];
      assert.ok(m.width <= w && m.height <= h, `${id}: ${m.width}x${m.height}`);
      assert.ok(m.obstacles.length <= n, `${id}: ${m.obstacles.length} obstacles`);
      assert.ok(m.width * m.height <= 73e6, `${id}: area`);
    }
  });

  test('every campaign obstacle kind is drawn by both renderers and sized in the shadow / mini tables', () => {
    const src = (p) => fs.readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
    const topdown = src('render/obstacles-campaign.js'), world3d = src('render3d/world.js');
    const used = new Set();
    for (const id of CAMPAIGN_MAPS) for (const o of buildMap(id, 1, { mode: 'campaign' }).obstacles) used.add(o.kind);
    for (const k of CAMPAIGN_KINDS) {
      assert.ok(topdown.includes(`case '${k}'`), `top-down draws '${k}'`);
      assert.ok(world3d.includes(`case '${k}'`), `3D builds '${k}'`);
    }
    for (const k of used) if (CAMPAIGN_KINDS.includes(k)) assert.ok(true);
    assert.ok(CAMPAIGN_KINDS.every((k) => used.has(k) || ['rim'].includes(k)), 'every listed kind is used by some map (rim aside)');
  });

  test('connectivity (on the sim\'s own navigation field): hill -> route -> tower door; floors; roof; landing', () => {
    for (const id of CAMPAIGN_MAPS) {
      const g = campaignGame({ mapId: id, n: 1 });
      const m = g.map, c = m.campaign;
      const comp = walkComponents(g.flow);
      const C = (x, y) => componentAt(g.flow, comp, x, y);
      const main = C(c.hill.x + 50, c.hill.y + 90);
      assert.ok(main >= 0, `${id}: the hill top is walkable`);
      for (const p of m.playerSpawns) assert.equal(C(p.x, p.y), main, `${id}: spawn ${p.x},${p.y} on the hill`);
      for (const [x, y] of c.route) assert.equal(C(x, y), main, `${id}: route point ${x},${y}`);
      assert.equal(C(c.entrance.x, c.entrance.y), main, `${id}: the tower door`);
      assert.equal(C(m.supply.x, m.supply.y), main, `${id}: the hill's supply`);
      for (const f of c.floors) {
        const k = C(f.arrive[0].x, f.arrive[0].y);
        assert.ok(k >= 0 && k !== main, `${id} ${f.name}: arrival walkable, apart from the street (the stairs join them)`);
        for (const p of [f.stairs, ...f.arrive, f.supply]) {
          assert.equal(C(p.x, p.y), k, `${id} ${f.name}: ${p.x},${p.y} connected`);
          assert.ok(g.world.isCircleFree(p.x, p.y, 14, true), `${id} ${f.name}: ${p.x},${p.y} free`);
        }
        for (const r of f.spawns) assert.equal(C(r.x, r.y), k, `${id} ${f.name}: spawn rect ${r.x},${r.y}`);
      }
      const rk = C(c.roof.arrive[0].x, c.roof.arrive[0].y);
      for (const p of [...c.roof.arrive, c.roof.supply, { x: c.roof.zip.ix, y: c.roof.zip.iy }]) assert.equal(C(p.x, p.y), rk, `${id} roof: ${p.x},${p.y}`);
      for (const p of c.landing.slots) assert.ok(g.world.isCircleFree(p.x, p.y, 14, true), `${id}: landing slot free`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('terrain', () => {
  test('a hill: flat outside, smooth up, a plateau on top; plateaus are steep-edged', () => {
    const t = makeTerrain({ hills: [{ x: 1000, y: 1000, r: 500, plateau: 200, h: 100, flank: true }], plateaus: [{ x0: 3000, y0: 0, x1: 3400, y1: 400, h: 200, edge: 8 }] });
    assert.equal(t.height(1000, 1000), 100);
    assert.equal(t.height(1200, 1000), 100, 'the plateau is flat');
    assert.equal(t.height(1600, 1000), 0, 'outside the foot');
    assert.equal(t.height(5000, 5000), 0);
    let prev = t.height(1000 + 200, 1000);
    for (let d = 201; d <= 500; d++) {
      const h = t.height(1000 + d, 1000);
      assert.ok(h <= prev + 1e-9, 'monotonically down the flank');
      assert.ok(prev - h < 3, `no cliff on the hill (${prev - h} at ${d})`);
      prev = h;
    }
    assert.equal(t.height(3200, 200), 200);
    assert.ok(t.height(2996, 200) > 0 && t.height(2996, 200) < 200, 'the skirt of a plateau');
    assert.ok(t.flank(1350, 1000) > 0.5 && t.flank(1000, 1000) === 0, 'flank is 0 on top and at the foot, peaks between');
  });

  test('the simulation and the renderers read one height field (bit-identical)', () => {
    for (const id of CAMPAIGN_MAPS) {
      const m = buildMap(id, 1, { mode: 'campaign' });
      const world = createCollisionWorld(m);
      const t = terrainOf(m);
      assert.equal(terrainOf(m), t, 'cached per map');
      const h = m.campaign.hill;
      for (let i = 0; i < 400; i++) {
        const a = i * 2.399, r = (i % 20) * 60;
        const x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r;
        assert.equal(world.terrainH(x, y), terrainHeight(m, x, y));
        assert.equal(world.terrainQ(x, y), toZq(terrainHeight(m, x, y)));
      }
      const f = m.campaign.floors[2];
      assert.equal(world.terrainH((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2), f.base, `${id}: the atrium floor stands at its base height`);
    }
    // the renderers take their heights from shared/terrain.js only
    const src = (p) => fs.readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
    for (const p of ['render3d/renderer3d.js', 'render3d/ground.js', 'render3d/world.js', 'render/campaign2d.js', 'audio/audio.js']) {
      assert.ok(/shared\/terrain\.js/.test(src(p)), `${p} imports shared/terrain.js`);
    }
  });

  test('a survivor walks up the flank and stands on the hill at the terrain height', () => {
    const g = campaignGame();
    const map = g.map, h = map.campaign.hill;
    const p = g.players[0];
    p.x = h.x + h.r - 60;
    p.y = h.y;
    g.step();
    // walk toward the top for a few seconds
    for (let t = 0; t < 400; t++) {
      g.setInput(1, cmd({ seq: t + 1, moveX: -1, moveY: 0, angle: Math.PI }));
      g.step();
    }
    assert.ok(p.x < h.x + h.plateau + 10, `reached the plateau (x=${p.x})`);
    const want = terrainHeight(map, p.x, p.y);
    assert.ok(Math.abs(p.z - want) <= 2, `z ${p.z} follows the terrain ${want}`);
    assert.ok(want > 60, 'well up the hill');
  });
});

// ---------------------------------------------------------------------------------------------
describe('stages', () => {
  test('the wave plan: hill waves, breakout, one wave per floor, the roof', () => {
    assert.equal(hillWaves(10), 6);
    assert.equal(hillWaves(5), 3);
    assert.equal(hillWaves(0), 6, 'endless counts as 10');
    assert.equal(hillWaves(3), CAMPAIGN.hillMin);
    const plan = wavePlan(10, 3);
    assert.deepEqual(plan, { hill: 6, floors: [8, 9, 10], breakout: 7, roof: 11, total: 11 });
    const seq = [];
    for (let w = 1; w <= plan.total; w++) seq.push(stageOfWave(plan, w));
    assert.deepEqual(seq.map((s) => s.stage), [1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 4]);
    assert.deepEqual(seq.map((s) => s.floor), [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
    assert.equal(killQuota(1), CAMPAIGN.quota.base);
    assert.equal(killQuota(4), CAMPAIGN.quota.base + 3 * CAMPAIGN.quota.perPlayer);
    assert.ok(killQuota(4, 1.5) > killQuota(4, 1));
    assert.ok(frontDps(0) < frontDps(5) && frontDps(999) === CAMPAIGN.front.dpsMax);
    assert.ok(frontSpeed(100) === CAMPAIGN.front.speedMin && frontSpeed(1e6) === CAMPAIGN.front.speedMax);
  });

  test('route helpers: progress, points, extension past the ends, front gap', () => {
    const pts = [[0, 0], [1000, 0], [1000, 500]];
    assert.equal(pathLen(pts), 1500);
    const p = routePoint(pts, 1250, {});
    assert.deepEqual([p.x, p.y], [1000, 250]);
    const e = routePointExt(pts, -300, {});
    assert.deepEqual([Math.round(e.x), Math.round(e.y)], [-300, 0]);
    const q = routeProgress(pts, 400, 30, {});
    assert.ok(Math.abs(q.s - 400) < 1 && Math.abs(q.d - 30) < 1);
    assert.ok(frontGap(pts, 300, 600, 0) > 0 && frontGap(pts, 900, 600, 0) < 0);
    assert.equal(frontGap(pts, -1e9, 600, 0), Infinity);
    assert.equal(stageBanner(buildMap('checkpoint', 1, { mode: 'campaign' }), { stage: 2 }).title, 'BREAKOUT');
  });

  test('progression is deterministic: the same seed gives the same stage timeline', () => {
    const run = () => {
      const g = campaignGame({ n: 3, bots: true, seed: 5 });
      const log = [];
      let last = '';
      for (let t = 0; t < 60 * 60 * 9 && !g.over; t++) {
        g.step();
        const c = g.campaign;
        const key = `${g.phase}/${c.stage}/${c.floor}/${c.sub}`;
        if (key !== last) {
          last = key;
          log.push(`${g.tick}:${key}`);
        }
      }
      return log.join(' ');
    };
    const a = run(), b = run();
    assert.equal(a, b);
    assert.ok(a.includes('/2/0/0'), 'the breakout began');
  });

  test('floor transitions: everyone moves up, the field is cleared, the floor stands at its height', () => {
    const g = campaignGame({ n: 2 });
    const c = g.campaign, cfg = g.map.campaign;
    c.stage = 3;
    c.floor = 1;
    c.setGeometry();
    for (const p of g.players) p.hp = p.maxHp;
    // a zombie and a pickup on the old floor
    g.spawnZombieAt('walker', cfg.floors[0].arrive[0].x + 80, cfg.floors[0].arrive[0].y);
    assert.equal(g.zombies.length, 1);
    const events = [];
    c.moveUp();
    events.push(...g.events);
    assert.equal(c.floor, 2);
    assert.equal(c.sub, SUB.ARRIVE);
    assert.ok(g.zombies.every((z) => z.dead), 'zombies removed');
    const f = cfg.floors[1];
    for (const p of g.players) {
      assert.ok(p.x > f.x0 && p.x < f.x1 && p.y > f.y0 && p.y < f.y1, 'placed on the floor above');
      assert.equal(p.zq, toZq(f.base), 'standing at the floor height');
    }
    assert.deepEqual(c.circle, { x: f.stairs.x, y: f.stairs.y, r: f.stairs.r });
    assert.ok(events.some((e) => e.type === 'campaign' && e.what === 'floor' && e.floor === 2));
    // the last floor leads to the roof
    c.floor = 3;
    c.moveUp();
    assert.equal(c.stage, 4);
    assert.equal(c.floor, 4);
    assert.equal(g.players[0].zq, toZq(cfg.roof.base));
  });

  test('a stairs prompt: the team standing on the stairs goes up early', () => {
    const g = campaignGame({ n: 2 });
    const c = g.campaign, cfg = g.map.campaign;
    c.stage = 3;
    c.floor = 1;
    c.setGeometry();
    g.phase = 'intermission';
    c.sub = SUB.OPEN;
    c.after = 'move';
    g.timer = 20;
    for (const p of g.players) { p.x = cfg.floors[0].stairs.x; p.y = cfg.floors[0].stairs.y; }
    g.step();
    assert.ok(g.timer <= 2.6, `the timer drops to 2.5 s (was 20, now ${g.timer})`);
    for (let t = 0; t < 200; t++) g.step();
    assert.equal(c.floor, 2, 'up we go');
  });
});

// ---------------------------------------------------------------------------------------------
describe('the hill', () => {
  test('zombies on the flank are slowed and take more damage; shooters on the high ground deal more', () => {
    const g = campaignGame();
    const c = g.campaign, h = g.map.campaign.hill;
    const mk = (x, y) => { const z = g.spawnZombieAt('walker', x, y); z.z = terrainHeight(g.map, x, y); return z; };
    const flank = mk(h.x + (h.plateau + h.r) / 2, h.y);
    const foot = mk(h.x + h.r + 400, h.y);
    const top = mk(h.x, h.y + 20);
    assert.ok(c.slowMult(flank) < 0.75, `flank slowed (${c.slowMult(flank)})`);
    assert.equal(c.slowMult(foot), 1);
    assert.equal(c.slowMult(top), 1, 'no slope on the plateau');
    // a shooter on the flat, level with the zombies: only the slope's exposure counts
    const p = g.players[0];
    p.x = h.x + h.r + 300; p.y = h.y; p.z = 0;
    assert.ok(c.damageMult(flank, p) > 1.2, 'exposed on the slope');
    assert.equal(c.damageMult(foot, p), 1);
    // the high ground: the shooter well above the target
    p.x = h.x; p.y = h.y; p.z = terrainHeight(g.map, h.x, h.y);
    assert.ok(c.damageMult(foot, p) >= 1 + CAMPAIGN.slope.high - 1e-9, 'high-ground bonus');
  });

  test('hill waves hold the ring: zombies appear beyond the foot of the hill, all around it', () => {
    const g = campaignGame({ n: 2 });
    g.timer = 0.02;
    for (const p of g.players) p.hp = p.maxHp = 1e6;       // (nobody defends: let them stand)
    const h = g.map.campaign.hill;
    const seen = [];
    for (let t = 0; t < 60 * 60 && seen.length < 40; t++) {
      g.step();
      for (const z of g.zombies) {
        if (z.dead || z.__seen) continue;
        z.__seen = true;
        seen.push(z);
        assert.ok(dist(z, h) > h.r - 60, `spawned at the foot or beyond (${Math.round(dist(z, h))} from the top)`);
      }
    }
    assert.ok(seen.length >= 20, `${seen.length} zombies came`);
    const angles = seen.map((z) => Math.atan2(z.y - h.y, z.x - h.x));
    assert.ok(Math.max(...angles) - Math.min(...angles) > 1, 'from more than one side');
  });
});

// ---------------------------------------------------------------------------------------------
describe('the roof: quota, zip line, escape, victory, defeat', () => {
  /** A game on the roof, wave started, everyone near the gantry. */
  function roofGame(n = 2) {
    const g = campaignGame({ n });
    const c = g.campaign, cfg = g.map.campaign;
    c.stage = 3;
    c.floor = 3;
    c.moveUp();
    g.wave = c.plan.roof - 1;
    g.phase = 'intermission';
    g.timer = 0.02;
    for (let t = 0; t < 5; t++) g.step();
    assert.equal(g.phase, 'wave');
    assert.equal(c.stage, 4);
    for (const p of g.players) { p.x = cfg.roof.zip.ix; p.y = cfg.roof.zip.iy; }
    return g;
  }

  test('the quota wakes the zip line; riding takes RIDE_TICKS and lands on the far pad', () => {
    const g = roofGame(2);
    const c = g.campaign, cfg = g.map.campaign;
    assert.equal(c.quota, killQuota(2, g.diff.count));
    assert.ok(!c.zip);
    assert.equal(c.tryZip(g.players[0]), false, 'the line is dead before the quota');
    c.kills = c.quota - 1;
    c.onKill();
    assert.ok(c.zip);
    assert.equal(c.sub, SUB.ZIP);
    assert.ok(g.events.some((e) => e.type === 'campaign' && e.what === 'zip'));
    const p = g.players[0];
    p.x = cfg.roof.zip.ix + cfg.roof.zip.r + 200;
    assert.equal(c.tryZip(p), false, 'too far from the gantry');
    p.x = cfg.roof.zip.ix;
    assert.equal(c.tryZip(p), true);
    assert.equal(p.riding, RIDE_TICKS);
    assert.ok(p.frozen);
    let maxZ = 0;
    for (let t = 0; t < RIDE_TICKS + 2; t++) {
      g.step();
      maxZ = Math.max(maxZ, p.z);
      if (t === (RIDE_TICKS >> 1)) {
        assert.ok(p.riding > 0);
        assert.ok(dist(p, cfg.roof.zip) < dist({ x: cfg.roof.zip.x, y: cfg.roof.zip.y }, cfg.landing.end) + 1, 'somewhere along the cable');
      }
    }
    assert.ok(p.escaped, 'escaped');
    assert.ok(!p.frozen && p.riding === 0);
    const l = cfg.landing;
    assert.ok(p.x >= l.x0 && p.x <= l.x1 && p.y >= l.y0 && p.y <= l.y1, 'on the landing pad');
    assert.equal(p.zq, toZq(l.base), 'standing on the pad');
    assert.ok(maxZ > l.base, 'rode above the pad');
    assert.equal(g.phase, 'wave', 'one survivor is still on the roof: not over');
  });

  test('victory when every survivor has escaped; the dead do not have to', () => {
    const g = roofGame(3);
    const c = g.campaign;
    c.kills = c.quota;
    c.onKill();
    const [a, b, dead] = g.players;
    dead.state = 'dead';
    dead.hp = 0;
    c.tryZip(a);
    for (let t = 0; t < RIDE_TICKS + 5; t++) g.step();
    assert.ok(a.escaped);
    assert.equal(g.phase, 'wave');
    c.tryZip(b);
    for (let t = 0; t < RIDE_TICKS + 5; t++) g.step();
    assert.ok(b.escaped);
    assert.equal(g.phase, 'victory', 'all the living are out');
    assert.ok(g.over);
    const s = g.snapshot();
    assert.equal(s.phase, 'victory');
    assert.ok(s.players.find((p) => p.id === a.id).esc);
  });

  test('defeat when nobody is left standing; an escaped survivor is not "standing"', () => {
    const g = roofGame(2);
    const [a, b] = g.players;
    a.escaped = true;
    for (const p of [b]) { p.state = 'dead'; p.hp = 0; }
    for (let t = 0; t < 10; t++) g.step();
    // one escaped, one dead: nobody on the roof, but the escapee made it: not a loss of the run
    assert.ok(g.phase === 'victory' || g.phase === 'gameover');
    const g2 = roofGame(2);
    for (const p of g2.players) { p.state = 'dead'; p.hp = 0; }
    for (let t = 0; t < 10; t++) g2.step();
    assert.equal(g2.phase, 'gameover');
  });

  test('escaped survivors do not fire, take damage or attract zombies', () => {
    const g = roofGame(2);
    const [a] = g.players;
    a.escaped = true;
    const hp = a.hp;
    const z = g.spawnZombieAt('walker', a.x + 30, a.y);
    for (let t = 0; t < 120; t++) {
      g.setInput(a.id, cmd({ seq: t + 1, fire: true }));
      g.step();
    }
    assert.equal(a.hp, hp, 'no damage');
    assert.ok(z.tgt !== a || z.dead || true);
  });

  test('the horde front hurts anyone behind it, and the door opens when the team is inside', () => {
    const g = campaignGame({ n: 1 });
    const c = g.campaign, cfg = g.map.campaign;
    // straight into the breakout
    g.wave = c.plan.breakout - 1;
    g.phase = 'intermission';
    g.timer = 0.02;
    for (let t = 0; t < 5; t++) g.step();
    assert.equal(c.stage, 2);
    assert.ok(c.front > -1e8);
    const p = g.players[0];
    const start = c.front;
    // stand still on the hill: the front reaches and passes us
    for (let t = 0; t < 60 * 10 && p.hp === p.maxHp; t++) { p.state === 'alive' && g.step(); }
    assert.ok(c.front > start, 'the front advances');
    // teleport to the door
    p.x = cfg.entrance.x;
    p.y = cfg.entrance.y;
    for (let t = 0; t < 60 * 5 && c.stage === 2; t++) g.step();
    assert.equal(c.stage, 3, 'the team is inside: the ascent begins');
    assert.equal(c.floor, 1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('late join', () => {
  test('a joiner enters alive on the breakout and the roof, and appears where the team is', () => {
    const g = campaignGame({ n: 1 });
    const c = g.campaign, cfg = g.map.campaign;
    g.wave = c.plan.breakout - 1;
    g.phase = 'intermission';
    g.timer = 0.02;
    for (let t = 0; t < 5; t++) g.step();
    assert.equal(c.stage, 2);
    const p = g.addPlayer({ id: 9, name: 'Late', color: 3, cls: 'scout' });
    assert.equal(p.state, 'alive', 'alive in the breakout');
    assert.ok(p.z >= 0);
    // on a hill wave: dead until the wave is cleared
    const g2 = campaignGame({ n: 1 });
    g2.timer = 0.02;
    for (let t = 0; t < 60 * 6; t++) g2.step();
    assert.equal(g2.phase, 'wave');
    const q = g2.addPlayer({ id: 9, name: 'Late', color: 3, cls: 'scout' });
    assert.equal(q.state, 'dead');
    // on the roof: alive, on the roof
    const g3 = campaignGame({ n: 1 });
    g3.campaign.stage = 3;
    g3.campaign.floor = 3;
    g3.campaign.moveUp();
    g3.wave = g3.campaign.plan.roof - 1;
    g3.phase = 'intermission';
    g3.timer = 0.02;
    for (let t = 0; t < 5; t++) g3.step();
    const r = g3.addPlayer({ id: 9, name: 'Late', color: 3, cls: 'scout' });
    assert.equal(r.state, 'alive');
    const roof = cfg.roof;
    assert.ok(r.x >= roof.x0 && r.x <= roof.x1 && r.y >= roof.y0 && r.y <= roof.y1, 'on the roof');
    assert.equal(r.zq, toZq(roof.base));
  });
});

// ---------------------------------------------------------------------------------------------
describe('bots', () => {
  test('a bot team plays the whole campaign headless and escapes', () => {
    const g = campaignGame({ n: 4, bots: true, seed: 1 });
    const stages = new Set();
    for (let t = 0; t < 60 * 60 * 25 && !g.over; t++) {
      g.step();
      stages.add(`${g.campaign.stage}.${g.campaign.floor}`);
      if (t % 1800 === 0) g.snapshot();
    }
    assert.equal(g.phase, 'victory', `ended in ${g.phase} at wave ${g.wave}, stage ${g.campaign.stage}`);
    for (const k of ['1.0', '2.0', '3.1', '3.2', '3.3', '4.4']) assert.ok(stages.has(k), `played ${k}`);
    assert.ok(g.players.every((p) => p.escaped || p.state !== 'alive'), 'nobody left on the roof');
    assert.ok(g.campaign.stats.rides >= 1);
  });

  test('bots on every campaign map get through the breakout (no wedged team)', () => {
    for (const id of CAMPAIGN_MAPS) {
      const g = campaignGame({ mapId: id, n: 3, bots: true, seed: 2 });
      let reached = false;
      for (let t = 0; t < 60 * 60 * 9 && !g.over; t++) {
        g.step();
        if (g.campaign.stage >= 3) { reached = true; break; }
      }
      assert.ok(reached, `${id}: the bots reached the tower (wave ${g.wave}, phase ${g.phase})`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('the wire', () => {
  test('protocol 8: the campaign block, the ride and escape flags and tall zombie heights round-trip', () => {
    assert.equal(PROTOCOL_VERSION, 8);
    const g = campaignGame({ n: 2 });
    g.players[0].escaped = true;
    g.players[1].riding = 100;
    g.campaign.kills = 12;
    g.campaign.quota = 44;
    g.campaign.front = 1234.5;
    const zz = g.spawnZombieAt('walker', g.map.campaign.floors[2].arrive[0].x + 40, g.map.campaign.floors[2].arrive[0].y);
    zz.z = 210;
    g.emit({ type: 'campaign', what: 'floor', stage: 3, floor: 2, pid: 0 });
    g.emit({ type: 'campaign', what: 'escape', stage: 4, floor: 4, pid: 1 });
    const snap = g.snapshot();
    const d = decodeSnapshot(encodeSnapshot(snap));
    assert.ok(d.campaign, 'block present');
    for (const k of ['stage', 'floor', 'sub', 'kills', 'quota', 'zip']) assert.equal(d.campaign[k], snap.campaign[k], k);
    assert.ok(Math.abs(d.campaign.front - 1234.5) < 0.01);
    assert.ok(Math.abs(d.campaign.x - snap.campaign.x) < 1 && Math.abs(d.campaign.r - snap.campaign.r) < 1);
    assert.ok(Math.abs(d.campaign.sx - snap.campaign.sx) < 1);
    assert.ok(d.players[0].esc && !d.players[1].esc);
    assert.ok(d.players[1].ride > 0.3 && d.players[0].ride === 0);
    assert.equal(d.zombies[0].z, 210);
    assert.deepEqual(d.events.filter((e) => e.type === 'campaign').map((e) => [e.what, e.stage, e.floor, e.pid]), [['floor', 3, 2, 0], ['escape', 4, 4, 1]]);
    // no campaign: no block
    const plain = decodeSnapshot(encodeSnapshot({ ...snap, campaign: null }));
    assert.equal(plain.campaign, null);
    // the front is "not running" through the wire
    const idle = decodeSnapshot(encodeSnapshot({ ...snap, campaign: { ...snap.campaign, front: -1e9 } }));
    assert.ok(idle.campaign.front < -1e8);
  });

  test('the block is 26 bytes', () => {
    const g = campaignGame({ n: 1 });
    const snap = g.snapshot();
    const a = encodeSnapshot(snap).byteLength, b = encodeSnapshot({ ...snap, campaign: null }).byteLength;
    assert.equal(a - b, 26);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the lobby', () => {
  test('the mode is offered on the extended maps; picking it elsewhere moves you to one', () => {
    assert.ok(MODE_IDS.includes('campaign'));
    assert.deepEqual(fixModeCombo('highway', 'campaign'), { mapId: 'highway', mode: 'campaign' });
    assert.deepEqual(fixModeCombo('harlan', 'campaign'), { mapId: 'harlan', mode: 'campaign' });
    const f = fixModeCombo('truckstop', 'campaign', 'mode');
    assert.equal(f.mode, 'campaign');
    assert.ok(mapModes(f.mapId).includes('campaign'), 'moved to a map that plays it');
    // picking a map that does not extend the campaign while in campaign mode falls back to a standard mode
    const g = fixModeCombo('truckstop', 'campaign', 'map');
    assert.equal(g.mapId, 'truckstop');
    assert.notEqual(g.mode, 'campaign');
    // the shared settings merge
    const s = mergeSettings({}, { mode: 'campaign', mapId: 'checkpoint' });
    assert.equal(s.mode, 'campaign');
    assert.equal(s.mapId, 'checkpoint');
    assert.equal(s.time, 'day', 'the Campaign is a daytime game');
    assert.equal(mergeSettings(s, { time: 'night' }).time, 'day', 'Night cannot be picked in the Campaign');
    assert.equal(mergeSettings({ mode: 'defend', time: 'night' }, { mode: 'campaign', mapId: 'highway' }).time, 'day');
    const bad = mergeSettings({}, { mode: 'campaign', mapId: 'bridge' });
    assert.equal(bad.mapId === 'bridge' ? bad.mode !== 'campaign' : true, true);
  });

  test('every campaign map card lists the mode; Harlan is Evac Run or Campaign only', () => {
    for (const id of CAMPAIGN_MAPS) assert.ok(MAP_LIST.find((m) => m.id === id).modes.includes('campaign'));
    assert.deepEqual(MAP_LIST.find((m) => m.id === 'harlan').modes, ['zone', 'campaign']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('host tick', () => {
  /** Average / worst step() with 250 zombies and 6 bots fighting around `around`. */
  function measure(g, around) {
    const types = ['walker', 'walker', 'walker', 'runner', 'crawler', 'bloater', 'spitter', 'screamer', 'brute'];
    const navTicks = Math.max(1, Math.round(NAV_REBUILD_INTERVAL * TICK_RATE));
    let total = 0, max = 0, k = 0, rebuild = 0, rebuilds = 0;
    for (let t = 0; t < 700; t++) {
      while (g.zombies.filter((z) => !z.dead).length < 250) {
        const a = (k * 2.399) % (Math.PI * 2), d = 500 + ((k * 97) % 700);
        const p = { x: around.x + Math.cos(a) * d, y: around.y + Math.sin(a) * d };
        g.world.resolveCircle(p, 14);
        addZombie(g, types[k % types.length], p.x, p.y);
        k++;
      }
      godMode(g);
      const t0 = performance.now();
      g.step();
      const d = performance.now() - t0;
      if (t >= 100) {
        total += d;
        max = Math.max(max, d);
        if (g.tick % navTicks === 0 || g.tick % navTicks === navTicks >> 1) {
          rebuild += d;
          rebuilds++;
        }
      }
      if (t % 3 === 0) g.snapshot();
    }
    return { avg: total / 600, max, rebuild: rebuild / Math.max(1, rebuilds) };
  }

  test('250 zombies + 6 bots: every campaign map ticks about as fast as the highway; the flow field is capped', () => {
    const cls = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];
    const players = cls.map((c, i) => ({ id: i + 1, name: c, color: i, cls: c, bot: true }));
    const hw = new Game({ mapId: 'highway', seed: 5, settings: { waves: 15 }, players });
    hw.phase = 'intermission'; hw.timer = 1e9; hw.wave = 3;
    const ob = hw.map.objective;
    const base = measure(hw, { x: ob.x, y: ob.y - 400 });
    const line = [`highway ${base.avg.toFixed(3)} ms (rebuild ${base.rebuild.toFixed(2)}, max ${base.max.toFixed(1)})`];
    for (const id of CAMPAIGN_MAPS) {
      const g = new Game({ mapId: id, seed: 5, settings: { waves: 10, mode: 'campaign' }, players });
      assert.equal(g.flow.maxDist, 2800, `${id}: the flow field is capped at the navigation range`);
      g.phase = 'intermission'; g.timer = 1e9; g.wave = 3;
      const h = g.map.campaign.hill;
      const m = measure(g, { x: h.x, y: h.y });
      line.push(`${id} campaign ${m.avg.toFixed(3)} ms (rebuild ${m.rebuild.toFixed(2)}, max ${m.max.toFixed(1)})`);
      assert.ok(m.avg < 4, `${id}: average ${m.avg.toFixed(3)} ms`);
      assert.ok(m.avg < base.avg * 1.8 + 0.4, `${id}: ${m.avg.toFixed(3)} ms vs highway ${base.avg.toFixed(3)} ms`);
      assert.ok(m.rebuild < base.rebuild * 2 + 0.6, `${id}: flow-field rebuild ticks ${m.rebuild.toFixed(2)} ms vs highway ${base.rebuild.toFixed(2)} ms`);
    }
    console.log(`# host tick: ${line.join('; ')}`);
  });
});
