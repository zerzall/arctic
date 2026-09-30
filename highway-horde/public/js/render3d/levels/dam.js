// The 3D art of the story level "dam", Blackwater Dam (JOURNEY.md §5). Owner: agent C3.
//
// world.js hands this module the level's obstacles, its free props and a finish/update/quality/dispose
// cycle, like the hideouts (world-hideout.js). The layout is shared/levels/dam.js; the pieces live in
//   dam-kit.js    the C3 kit: buckets and materials, frames on the terrain, pictures, rock faces, stair shafts
//   dam-atlas.js  the painted signs, screens, decals of the C3 levels
//   dam-set.js    the dam body, the spillway, the crest's parapets, lamps, towers, hoists and gantry crane
//   dam-rooms.js  the control building and its rooms, the turbine hall and its machines, gates, walls
//   dam-misc.js   the fallen bridge, the dock and boat, the depot gate, the road signs
//   dam-fx.js     the reservoir, the chute's water, white water, spray, the day rain and lightning

import { C3_BUCKETS, createC3Materials, rockFaces, stairShaft, at } from './dam-kit.js';
import { DAM, DAM_Z } from '../../shared/levels/dam.js';
import { damBody, spillway, parapet, crestLamps, stairTower, hoistHouse, craneLeg, gantryCrane } from './dam-set.js';
import {
  controlBuilding, controlInterior, furniture, partition, turbineHall, hallRoof, gateModel, styledWall, tunnel, flatCeiling,
} from './dam-rooms.js';
import { bridgeRuin, dockAndBoat, depotGate, signage } from './dam-misc.js';
import { createDamFx } from './dam-fx.js';

/** Extra geo-builder buckets of this level: the C3 atlas lit, emissive and blended. */
export const BUCKETS = C3_BUCKETS;

/** Obstacle styles drawn by a bigger model (or nothing at all: invisible colliders). */
const DRAWN_ELSEWHERE = new Set(['nodraw', 'cext', 'cwindows', 'shaft', 'hallwall', 'craneleg']);

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 * @returns {object}
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  const mats = createC3Materials(deps);
  const art = map.levelArt || { cliffs: [], flights: [], marks: [] };
  const P = { B: null, gy: deps.gy, halos: deps.halos, tier: deps.full || deps.tier, day: !!deps.day, map, ctx };
  let fx = null;
  const use = (B) => { P.B = B; return P; };

  return {
    buckets: BUCKETS,
    material(bucket, t) { return mats.material(bucket, t) || deps.mats.get('std', t); },

    obstacle(B, o) {
      use(B);
      if (o.gate) return gateModel(P, o);
      const s = o.style;
      if (!s) return false;
      if (DRAWN_ELSEWHERE.has(s)) return true;
      switch (s) {
        case 'parapetN': case 'parapetS': return parapet(P, o);
        case 'hoist': return hoistHouse(P, o);
        case 'cwall': return partition(P, o);
        case 'toewall': {
          B.block('std', 0, 0, 0, o.w, 120, o.h, '#8a857a', null, { surf: [2, 0.9, 0] });
          return true;
        }
        default: return styledWall(P, o) || furniture(P, o) || craneLeg(P, o) || false;
      }
    },

    objective() { return false; },

    roof(B, r) {
      use(B);
      switch (r.style) {
        case 'shaft': return true;   // the stair shafts draw their own sloped ceilings (props)
        case 'tunnel': tunnel(P, r); return true;
        case 'hall': hallRoof(P); return true;
        case 'controlroom':
          flatCeiling(P, r, { h: 150, tiles: true, lamps: map.lights.filter((l) => l.h === 140 && Math.abs(l.x - r.x) < r.w / 2 && Math.abs(l.y - r.y) < r.h / 2).map((l) => [l.x, l.y, true, l.flicker]) });
          return true;
        case 'stairhall': flatCeiling(P, r, { h: 150 }); return true;
        default: return false;
      }
    },

    gateModel(B, gate, o) {
      use(B);
      return gateModel(P, o);
    },

    props(B) {
      use(B);
      const step = (name, fn) => {
        try { fn(); } catch (err) { console.warn('dam art:', name, err); }
        B.setAO(34, 0.42);
      };
      step('cliffs', () => rockFaces(B, deps.gy, art.cliffs, P.tier));
      step('dam body', () => damBody(P));
      step('spillway', () => spillway(P));
      step('crest lamps', () => crestLamps(P, map));
      step('towers', () => { stairTower(P, (DAM.westStair.x0 + DAM.westStair.x1) / 2, false); stairTower(P, (DAM.eastStair.x0 + DAM.eastStair.x1) / 2, true); });
      step('crane', () => gantryCrane(P));
      step('shafts', () => { for (const fl of art.flights) stairShaft(B, deps.gy, deps.halos, fl, { seed: fl.x0 }); });
      step('control', () => { controlBuilding(P); controlInterior(P); });
      step('hall', () => turbineHall(P));
      step('bridge', () => bridgeRuin(P, art.marks));
      step('dock', () => dockAndBoat(P, art.marks));
      step('depot', () => { const m = art.marks.find((q) => q.t === 'depotgate'); if (m) depotGate(P, m); });
      step('signs', () => signage(P));
      void at; void DAM_Z;
    },

    finish() {
      try { fx = createDamFx(ctx, deps); } catch (err) { console.warn('dam art: fx failed', err); }
    },
    update(view, frame) { if (fx) fx.update(view, frame); },
    setQuality(q) { P.tier = q; if (fx) fx.setQuality(q); },
    dispose() {
      if (fx) fx.dispose();
      mats.dispose();
    },
  };
}
