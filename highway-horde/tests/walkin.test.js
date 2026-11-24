// Walk-in buildings of the open maps (shared/maps-walkin.js, render3d/world-walkin.js): every main open map
// has three to six buildings the crew can walk into, of varied kinds; their doorways are wide enough for the
// horde (walkers and heavies reach every room on the sim's own flow fields); the layout is the same for every
// seed; a stair climbs onto a roof terrace (walked with the real movement code) that the ground can't reach
// any other way; a roof keeps the sky out (the indoor mask) and the art builds on every tier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildMap } from '../public/js/shared/maps.js';
import { WALKIN_DOOR, WALKIN_T } from '../public/js/shared/maps-walkin.js';
import { FlowField } from '../public/js/shared/flowfield.js';
import { mapColliders } from '../public/js/shared/geom.js';
import { createCollisionWorld, stepPlayerMovement, MASK_HEAVY } from '../public/js/shared/movement.js';
import { terrainOf } from '../public/js/shared/terrain.js';
import { resetVertical } from '../public/js/shared/jump.js';

// three.js from the vendored copy (the renderer modules import it by its bare name)
const VENDOR = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/vendor/three') + path.sep).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: '${VENDOR}three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));

const OPEN = ['highway', 'truckstop', 'bridge', 'checkpoint', 'harlan', 'sandstone'];
const cache = new Map();
const getMap = (id, seed = 1) => {
  const k = id + ':' + seed;
  if (!cache.has(k)) cache.set(k, buildMap(id, seed));
  return cache.get(k);
};

/** Local (lx, ly) of a record → world. */
const toWorld = (rec, lx, ly) => {
  const c = Math.cos(rec.a), s = Math.sin(rec.a);
  return { x: rec.x + lx * c - ly * s, y: rec.y + lx * s + ly * c };
};
/** True when (x, y) is clear of every obstacle by `pad`. */
function clearOf(map, x, y, pad) {
  for (const o of map.obstacles) {
    const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0), dx = x - o.x, dy = y - o.y;
    if (Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad) return false;
  }
  return true;
}
/** Points on a grid over a record's interior that stand clear of walls and furniture. */
function roomPoints(map, rec, step = 16, pad = 18) {
  const out = [];
  const hw = rec.w / 2 - rec.t, hh = rec.h / 2 - rec.t;
  for (let ly = -hh + step / 2; ly < hh; ly += step) {
    for (let lx = -hw + step / 2; lx < hw; lx += step) {
      const p = toWorld(rec, lx, ly);
      if (clearOf(map, p.x, p.y, pad)) out.push(p);
    }
  }
  return out;
}
function field(map, targets, heavy = false) {
  const colliders = mapColliders(map);
  const f = heavy ? new FlowField(map, { colliders, pad: 28, mask: MASK_HEAVY }) : new FlowField(map, { colliders, pad: 3 });
  f.update(targets);
  return f;
}
function walk(world, x, y, mx, my, secs) {
  const p = { x, y, state: 'alive', stamina: 100, sprintLock: false, speedMult: 1, moveMult: 1 };
  resetVertical(p, world.terrainQ(x, y));
  const cmd = { moveX: mx, moveY: my, sprint: false, jump: false, angle: 0 };
  for (let t = 0; t < Math.round(secs * 60); t++) stepPlayerMovement(p, cmd, 1 / 60, world);
  return p;
}

describe('walk-in buildings: the maps', () => {
  test('every main open map has three to six of them, of many kinds; one stair onto a roof terrace on Highway 9 and Sandstone', () => {
    const types = new Set();
    for (const id of OPEN) {
      const m = getMap(id);
      assert.ok(m.walkins && m.walkins.length >= 3 && m.walkins.length <= 6, `${id}: ${m.walkins ? m.walkins.length : 0} walk-ins`);
      for (const r of m.walkins) types.add(r.type);
      assert.equal(new Set(m.walkins.map((r) => r.id)).size, m.walkins.length, `${id}: ids are unique`);
    }
    for (const t of ['kiosk', 'shop', 'house', 'office', 'warehouse', 'apartment', 'garage', 'sandhouse']) assert.ok(types.has(t), `a ${t}`);
    assert.ok(getMap('highway').walkins.some((r) => r.stair), 'Highway 9: a stair up to a roof terrace');
    assert.ok(getMap('sandstone').walkins.some((r) => r.stair), 'Sandstone: the B house\'s roof terrace');
  });

  test('records, obstacles and roofs agree; doorways and partitions\' doors let a crowd through; taller than one storey somewhere', () => {
    for (const id of OPEN) {
      const m = getMap(id);
      m.walkins.forEach((r, i) => {
        assert.equal(r.i, i, `${id}: record index`);
        assert.ok(r.doors.length >= 1, `${r.id}: a way in`);
        for (const d of r.doors) assert.ok(d.w >= WALKIN_DOOR, `${r.id}: door ${d.w} wide`);
        for (const p of r.parts) for (const [g0, g1] of p.gaps) assert.ok(g1 - g0 >= WALKIN_DOOR, `${r.id}: inner door ${g1 - g0} wide`);
        const obs = m.obstacles.filter((o) => o.walkin === i);
        assert.ok(obs.filter((o) => o.style === 'wi:ext').length >= 4, `${r.id}: outer walls`);
        for (const o of obs) assert.ok(typeof o.style === 'string' && o.style.startsWith('wi:'), `${r.id}: styled ${o.style}`);
        for (const o of obs.filter((q) => q.kind === 'wall')) assert.ok(o.solid && o.h > 8 && Number.isFinite(o.top), `${r.id}: masonry walls`);
        const roofs = m.roofs.filter((q) => q.shell === i);
        assert.equal(roofs.length, 1, `${r.id}: one roof`);
        assert.ok(Math.abs(roofs[0].w - (r.w - 2 * WALKIN_T)) < 0.5 && roofs[0].height === r.ceil, `${r.id}: the ceiling covers the rooms`);
        assert.ok(r.H >= r.ceil, `${r.id}: height`);
      });
      assert.ok(m.walkins.some((r) => r.storeys >= 2) || id === 'sandstone', `${id}: a building of several storeys`);
    }
  });

  test('the layout is the same for every seed (only the dressing changes)', () => {
    for (const id of OPEN) {
      const a = getMap(id, 1), b = getMap(id, 77);
      assert.equal(JSON.stringify(a.walkins), JSON.stringify(b.walkins), `${id}: records`);
      const pick = (m) => JSON.stringify(m.obstacles.filter((o) => o.walkin !== undefined).map((o) => [o.kind, o.x, o.y, o.w, o.h, o.a, o.style]));
      assert.equal(pick(a), pick(b), `${id}: walls and furniture`);
    }
  });

  test('walkers reach every room and heavies every doorway from where the horde spawns (the sim\'s flow fields)', () => {
    for (const id of OPEN) {
      const m = getMap(id);
      const tg = m.objective || m.supply;
      const fw = field(m, [{ x: tg.x, y: tg.y }]);
      const fh = field(m, [{ x: tg.x, y: tg.y }], true);
      // (the horde comes from the spawn rects: the objective must be reachable from them, so is every room)
      for (const z of m.zombieSpawns.slice(0, 3)) assert.ok(fw.reachable(z.x, z.y), `${id}: the objective from a spawn`);
      let near = null;
      for (const r of m.walkins) {
        const pts = roomPoints(m, r);
        assert.ok(pts.length >= 8, `${r.id}: open floor (${pts.length} points)`);
        // (a point counts when its cell or a neighbouring one has a path: cells are 32 units, hugging a wall blocks one)
        near = (f, p) => [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]].some(([dx, dy]) => f.reachable(p.x + dx, p.y + dy));
        const lost = pts.filter((p) => !near(fw, p));
        assert.ok(lost.length === 0, `${r.id}: unreachable floor at ${lost.slice(0, 3).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
        for (const d of r.doors) {
          // just inside the doorway
          const L = d.side === 'n' || d.side === 's';
          // (in the doorway, just inside the wall's inner face)
          const inward = r.h / 2 - r.t - 8, across = r.w / 2 - r.t - 8;
          const lp = L ? { lx: d.at, ly: (d.side === 's' ? 1 : -1) * inward } : { lx: (d.side === 'e' ? 1 : -1) * across, ly: d.at };
          const p = toWorld(r, lp.lx, lp.ly);
          assert.ok(near(fh, p), `${r.id}: a heavy gets in by the ${d.side} door`);
        }
      }
    }
  });

  test('the stair climbs onto the roof terrace, and the terrace is reached only by it', () => {
    for (const id of ['highway', 'sandstone']) {
      const m = getMap(id);
      const world = createCollisionWorld(m);
      const terr = terrainOf(m);
      for (const r of m.walkins.filter((q) => q.stair)) {
        const s = r.stair, base = s.base || 0;
        const lane = (s.sx0 + s.sx1) / 2;
        // up the flight from the street
        const p = walk(world, lane, s.y1 + 40, 0, -1, 4);
        assert.ok(p.y < s.top, `${r.id}: walked up past the top step (${Math.round(p.y)})`);
        assert.ok(Math.abs(p.z - (base + s.rise)) < 2, `${r.id}: on the terrace (${p.z.toFixed(1)})`);
        // across the terrace to the far side, and back down
        const q = walk(world, lane, s.top - 30, s.side === 'w' ? 1 : -1, 0, 2);
        assert.ok(Math.abs(q.z - (base + s.rise)) < 2, `${r.id}: still up there`);
        const d = walk(world, lane, s.top - 20, 0, 1, 4);
        assert.ok(d.y > s.y1 && Math.abs(d.z - base) < 2, `${r.id}: back down on the street (${Math.round(d.y)}, ${d.z.toFixed(1)})`);
        // the flight rises in fine steps, the terrace is level
        let prev = terr.height(lane, s.y1 + 5);
        for (let y = s.y1 - 2; y > s.top; y -= 3) {
          const h = terr.height(lane, y);
          assert.ok(h >= prev - 1e-6 && h - prev <= 8, `${r.id}: a step of ${h - prev} at ${y}`);
          prev = h;
        }
        assert.equal(terr.height((s.x0 + s.x1) / 2, (s.y0 + s.top) / 2), base + s.rise);
        // walking into the wing's front wall beside the flight from the street gets nowhere
        const fx = s.side === 'w' ? (s.sx1 + s.x1) / 2 : (s.x0 + s.sx0) / 2;
        const blocked = walk(world, fx, s.y1 + 40, 0, -1, 2);
        assert.ok(Math.abs(blocked.z - base) < 2 && blocked.y > s.y1, `${r.id}: the wing's walls keep the street off the terrace`);
        // the horde finds the way up
        const f = field(m, [{ x: (s.x0 + s.x1) / 2 + (s.side === 'w' ? 30 : -30), y: (s.y0 + s.top) / 2 + 10 }]);
        assert.ok(f.reachable(lane, s.y1 + 60), `${r.id}: zombies path up the stair`);
      }
    }
  });
});

describe('walk-in buildings: rendering', () => {
  let THREE, geo, arch, walkMod, roofsMod, indoorMod;
  const load = async () => {
    if (THREE) return;
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
    geo = await import('../public/js/render3d/world-geo.js');
    arch = await import('../public/js/render3d/world-arch.js');
    walkMod = await import('../public/js/render3d/world-walkin.js');
    roofsMod = await import('../public/js/render3d/roofs3d.js');
    indoorMod = await import('../public/js/render3d/indoor.js');
  };
  const BUCKETS = {
    std: { det: true }, paint: { det: true }, glass: { det: true }, vglass: { uv: true, ao: false }, decal: { uv: true }, glow: { uv: true, ao: false },
    neon: { uv: true, ao: false }, blink: { ao: false }, flicker: { uv: true, ao: false }, fence: { uv: true }, leaves: { uv: true, ao: false },
    sign: { uv: true }, room: { det: true, ao: false }, stain: { uv: true },
  };

  test('the shells, rooms, furniture and stairs build on every tier, every walk-in obstacle drawn, within budget', async (t) => {
    await load();
    for (const id of OPEN) {
      const m = getMap(id);
      const terr = terrainOf(m);
      const gy = terr.flat ? () => 0 : (x, y) => terr.height(x, y);
      for (const [tier, lvl] of [['low', 0], ['high', 1], ['ultra', 2], ['cinematic', 3]]) {
        arch.setDetailLevel(lvl);
        const warnings = [];
        const warn = console.warn;
        console.warn = (...a) => warnings.push(a.map(String).join(' '));
        try {
          const B = geo.createGeoBuilder({ cell: 1600, buckets: BUCKETS });
          if (!terr.flat) B.setGround(gy);
          const W = walkMod.createWalkins({ map: m }, { gy });
          let drawn = 0;
          for (const o of m.obstacles) {
            B.obj(o.x, o.y, o.a || 0, o.id * 31);
            if (W.obstacle(B, o)) drawn++;
          }
          const roofs = roofsMod.createRoofs({ map: m }, { level: null, newBuilder: () => geo.createGeoBuilder({ cell: 1600, buckets: BUCKETS }), matOf: () => new THREE.MeshBasicMaterial(), root: new THREE.Group(), tier, day: true, halos: [] });
          roofs.build(B);
          W.build(B);
          const parts = B.finish();
          for (const { geometry } of parts) {
            const p = geometry.attributes.position.array;
            for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error('NaN vertex');
          }
          assert.deepEqual(warnings, [], `${id} ${tier}: ${warnings.join(' | ')}`);
          assert.equal(drawn, m.obstacles.filter((o) => o.walkin !== undefined).length, `${id}: every walk-in obstacle drawn here`);
          const per = W.stats.triangles / m.walkins.length;
          assert.ok(per < 40000, `${id} ${tier}: ${Math.round(per)} triangles a building`);
          if (tier === 'ultra') t.diagnostic(`${id}: ${m.walkins.length} walk-ins, ${Math.round(W.stats.triangles / 1000)}k triangles on ultra`);
          roofs.dispose();
        } finally {
          console.warn = warn;
        }
      }
    }
  });

  test('indoors is indoors: the mask darkens the rooms, not the street or the storeys above the ceiling', async () => {
    await load();
    const m = getMap('highway');
    const { obstacleHeight } = await import('../public/js/render3d/world.js');
    const ind = indoorMod.createIndoor(m, { heightOf: (kind, o) => obstacleHeight(kind, o), sectionOf: () => -1, gateObstacles: new Set(), sunK: 0.35 });
    for (const r of m.walkins) {
      const deep = toWorld(r, 0, -(r.h / 2 - r.t - 20));
      // (a deep spot away from the doors: the back wall's middle, unless a door is there)
      const pts = [deep, toWorld(r, -(r.w / 2 - r.t - 20), 0), toWorld(r, r.w / 2 - r.t - 20, 0)];
      assert.ok(Math.max(...pts.map((p) => ind.at(p.x, p.y))) > 0.45, `${r.id}: dark inside`);
      const out = toWorld(r, 0, r.h / 2 + 160);
      assert.equal(ind.at(out.x, out.y), 0, `${r.id}: the street is outside`);
      assert.equal(ind.at(r.x, r.y, r.ceil + 40), 0, `${r.id}: above the ceiling`);
    }
    // the walls are as tall as the building for the mask and the decals
    for (const o of m.obstacles.filter((q) => q.style === 'wi:ext')) assert.equal(obstacleHeight('wall', o), o.top);
    ind.dispose();
  });
});
