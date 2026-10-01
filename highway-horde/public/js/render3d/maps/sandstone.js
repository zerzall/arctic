// The 3D art of Sandstone (shared/maps-sandstone.js), the Horde Elimination map: a sun-baked walled town
// of sandstone and adobe. The layout tags its obstacles with a `style` and lists its free pieces in
// `map.sandArt`; this module draws them through the world's geo builder (render3d/levels/index.js finds
// it by the MapDef's `art` name and hands it the same seams as a story level's art):
//   sandstone-kit.js    the houses (windows with shutters and rooms behind the glass, studded doors,
//                       shop fronts, roofs and their clutter), the court wall, the gatehouses, the great
//                       wooden doors and the painted leaves
//   sandstone-props.js  crates, barrels, carts, planters, the fountain, the well, the market stalls, the
//                       rampart's retaining wall and parapet; stairs, the ramp, the town gates, arches,
//                       tarps, signs, lanterns, doorways and the tunnels' vaults
//   sandstone-atlas.js  the painted pictures: awning stripes, rugs, zellige, signs, posters, graffiti
//
// Buckets of its own: 'sssign' (the atlas, lit, alpha-tested), 'ssdecal' (the atlas blended just off a
// surface: grime, cracks, the sites' marks) and 'sscloth' (the atlas on both faces: awnings, tarps,
// laundry). Detail follows the tier: low draws every model plainly, high adds frames, shutters and roof
// clutter, ultra the fine detail (studs, nosings, grime), cinematic rounder geometry.
//
// The interface is the one of render3d/levels/index.js (obstacle, roof, props, finish, update,
// setQuality, dispose, material, buckets).

import * as THREE from 'three';
import { makeSandTexture } from './sandstone-atlas.js';
import { house, courtWall, gatehouse, bigDoor, doorLeaf } from './sandstone-kit.js';
import { MODELS, ITEMS, tunnelVault } from './sandstone-props.js';

/** Extra geo-builder buckets of this map. */
export const BUCKETS = {
  sssign: { uv: true },
  ssdecal: { uv: true },
  sscloth: { uv: true, ao: false },
};

const WALLS = { house, courtwall: (P) => courtWall(P), gatehouse, bigdoor: bigDoor, doorleaf: doorLeaf };

/** Point in an oriented rectangle. */
function inRect(o, x, y, pad = 0) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  const dx = x - o.x, dy = y - o.y;
  return Math.abs(dx * c + dy * s) <= o.w / 2 + pad && Math.abs(-dx * s + dy * c) <= o.h / 2 + pad;
}

/**
 * @param {object} ctx renderer ctx (ctx.map is Sandstone)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object}
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  // (dusk: the day's machinery, the lanterns half lit)
  const day = !!deps.day && !ctx.dusk;
  const full = deps.full || deps.tier || 'high';
  const lod = full === 'low' ? 0 : full === 'high' ? 1 : full === 'ultra' ? 2 : 3;
  const gy = deps.gy || (() => 0);
  const tex = makeSandTexture(deps.aniso || 8);
  const own = {
    hi: {
      sssign: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, roughness: 0.75, metalness: 0, envMapIntensity: 0.5 }),
      ssdecal: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.4 }),
      sscloth: new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }),
    },
  };
  own.low = {
    sssign: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5 }),
    ssdecal: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sscloth: new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
  };

  // the buildings by cell, for the facades (which faces are open to the street) and the lanterns (the nearest wall)
  const CELL = 256;
  const grid = new Map();
  const blocks = map.obstacles.filter((o) => o.kind === 'building' || (o.kind === 'wall' && (o.style === 'courtwall' || o.style === 'gatehouse')));
  for (const o of blocks) {
    const r = Math.hypot(o.w, o.h) / 2;
    for (let gx = Math.floor((o.x - r) / CELL); gx <= Math.floor((o.x + r) / CELL); gx++) {
      for (let gz = Math.floor((o.y - r) / CELL); gz <= Math.floor((o.y + r) / CELL); gz++) {
        const k = gz * 1024 + gx;
        let l = grid.get(k);
        if (!l) grid.set(k, l = []);
        l.push(o);
      }
    }
  }
  const near = (x, y) => grid.get(Math.floor(y / CELL) * 1024 + Math.floor(x / CELL)) || [];
  /** Height of the building standing at (x, y), other than `self` (0 = open ground; the map's edge counts as a wall). */
  const blockTop = (x, y, self) => {
    if (x < 0 || y < 0 || x > map.width || y > map.height) return 400;
    let top = 0;
    for (const o of near(x, y)) {
      if (o === self || !inRect(o, x, y)) continue;
      top = Math.max(top, o.kind === 'building' ? o.top || 150 : 130);
    }
    return top;
  };
  /** The nearest building face within `maxD` of (x, y), as an offset [dx, dz] from the point, or null. */
  const nearWall = (x, y, maxD) => {
    let best = null, bd = maxD;
    for (const o of blocks) {
      if (Math.abs(o.x - x) > o.w / 2 + maxD || Math.abs(o.y - y) > o.h / 2 + maxD) continue;
      // the closest point of the (axis-aligned) block
      const px = Math.max(o.x - o.w / 2, Math.min(o.x + o.w / 2, x)), py = Math.max(o.y - o.h / 2, Math.min(o.y + o.h / 2, y));
      const d = Math.hypot(px - x, py - y);
      if (d > 0.5 && d < bd) { bd = d; best = [px - x, py - y]; }
    }
    return best;
  };
  /** Put the object frame at (x, y) on absolute heights (the terrain under it does not lift it). */
  const objAbs = (B, x, y, a, seed) => B.obj(x, y, a, seed, -gy(x, y));
  // the tunnels' vaults: a house face under one keeps its upper floors plain (they would pierce the vault)
  const vaults = (map.roofs || []).filter((r) => r.style === 'tunnel');
  /** Height where the vault over (x, y) springs (Infinity in the open); see sandstone-props.js tunnelVault. */
  const ceilAt = (x, y) => {
    let c = Infinity;
    for (const r of vaults) if (inRect(r, x, y, 2)) c = Math.min(c, (r.height || 120) - Math.min(r.w, r.h) / 4);
    return c;
  };

  const P0 = { day, lod, full, map, halos: deps.halos, shafts: deps.shafts, gy, blockTop, nearWall, objAbs, ceilAt };
  const warned = new Set();
  const run = (fn, key, P, it) => {
    try {
      fn(P, it);
    } catch (err) {
      if (!warned.has(key)) { warned.add(key); console.warn('sandstone art: model failed', key, err); }
    }
  };

  let seq = 0;
  const self = {
    buckets: BUCKETS,
    material(bucket, t) { return (t === 'low' ? own.low : own.hi)[bucket] || null; },
    obstacle(B, o) {
      const st = o.style;
      if (!st) return false;
      const fn = WALLS[st] || MODELS[st];
      if (!fn) return false;
      run(fn, st, { ...P0, B, o }, o);
      return true;
    },
    objective() { return false; },
    roof(B, r) {
      if (r.style !== 'tunnel') return false;
      objAbs(B, r.x, r.y, r.a || 0, 7000 + (seq++));
      B.setJitter(0.02);
      run(tunnelVault, 'tunnel', { ...P0, B, o: r }, r);
      return true;
    },
    props(B) {
      for (const it of map.sandArt || []) {
        const fn = ITEMS[it.t];
        if (!fn) {
          if (!warned.has(it.t)) { warned.add(it.t); console.warn('sandstone art: no model for', it.t); }
          continue;
        }
        B.obj(it.x, it.y, it.a || 0, 5000 + (seq++) * 7);
        B.setJitter(0.03);
        run(fn, it.t, { ...P0, B, o: it }, it);
      }
      run(ITEMS.marks, 'marks', { ...P0, B }, null);
    },
    finish() {},
    update() {},
    setQuality() {},
    dispose() {
      for (const set of [own.hi, own.low]) for (const m of Object.values(set)) m.dispose();
      tex.dispose();
    },
  };
  return self;
}
