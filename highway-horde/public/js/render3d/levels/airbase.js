// The 3D art of the story level "airbase", Fort Harlan Airfield (JOURNEY.md §5). Owner: agent C3.
//
// world.js hands this module the level's obstacles, its free props and a finish/update/quality/dispose
// cycle, like the hideouts. The layout is shared/levels/airbase.js (BASE); the pieces live in
//   dam-kit.js / dam-atlas.js  the C3 kit and sign atlas (shared with the dam and the rail yard)
//   airbase-build.js           the guardhouse, Barracks B, the armory, the Quonset dining facility
//   airbase-props.js           fences, gates, the guard/search/floodlight towers, signs, furniture
//   airbase-air.js             the cargo plane, Black Hawks (whole and wrecked), Humvees, apron vehicles
//   airbase-field.js           hangars, the fuel depot, the control tower, the fire station, the runway
//   airbase-fx.js              the searchlights' sweep and the beacon by night, sunbeams in the hangars by day

import { C3_BUCKETS, createC3Materials, setKitDay, ammoCrate } from './dam-kit.js';
import { BASE } from '../../shared/levels/airbase.js';
import { buildingWall, partitionWall, guardhouse, barracksRoof, armoryRoof, messHall } from './airbase-build.js';
import { fencePiece, gatePiece, lightTower, prop } from './airbase-props.js';
import { cargoPlane, helicopter, humvee, refueler, crashTender, apronMachine, planeWreck } from './airbase-air.js';
import { hangar, hangarDoor, fuelPiece, tower, fireStation, shelterRoof, runway, flarePath, fieldProp } from './airbase-field.js';
import { createBaseFx } from './airbase-fx.js';

/** Extra geo-builder buckets of this level: the C3 atlas lit, emissive and blended. */
export const BUCKETS = C3_BUCKETS;

const ROOF_STYLES = new Set(['guardroom', 'barracks', 'armory', 'mess', 'shelter', 'hangar', 'towerbase']);
const SKIP = new Set(['nodraw', 'hwall', 'messwall']);

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  const mats = createC3Materials(deps);
  const art = map.levelArt || { marks: [] };
  const P = { B: null, gy: deps.gy, halos: deps.halos, shafts: deps.shafts, tier: deps.full || deps.tier, day: !!deps.day, map, ctx };
  setKitDay(P.day);
  let fx = null;
  const use = (B) => { P.B = B; return P; };

  function drawObstacle(o) {
    const s = o.style;
    if (!s) return false;
    if (SKIP.has(s)) return true;
    switch (s) {
      case 'crate': ammoCrate(P.B, o); return true;
      case 'guardwall': case 'bwall': case 'armwall': case 'twall': return buildingWall(P, o);
      case 'bpart': case 'tinner': case 'trail': return partitionWall(P, o);
      case 'perimfence': case 'taxigate': return fencePiece(P, o);
      case 'guardtower': case 'searchtower': case 'lighttower': return lightTower(P, o);
      case 'c27': return cargoPlane(P, o);
      case 'uh60': case 'helowreck': return helicopter(P, o);
      case 'humvee': return humvee(P, o);
      case 'refueler': return refueler(P, o);
      case 'crashtender': return crashTender(P, o);
      case 'tug': case 'kloader': case 'reefer': return apronMachine(P, o);
      case 'hdoor': return hangarDoor(P, o);
      case 'bund': case 'fueltank': case 'pumphouse': case 'fuelpump': return fuelPiece(P, o);
      case 'firestation': return fireStation(P, o);
      case 'windsock': case 'papi': case 'glideslope': return fieldProp(P, o);
      default: return prop(P, o);
    }
  }

  function drawRoof(r) {
    switch (r.style) {
      case 'guardroom': return guardhouse(P, r);
      case 'barracks': return barracksRoof(P, r);
      case 'armory': return armoryRoof(P, r);
      case 'mess': return messHall(P, r);
      case 'shelter': return shelterRoof(P, r);
      case 'towerbase': return tower(P, r);
      case 'hangar': {
        const h = BASE.hangars.find((q) => Math.abs((q.x0 + q.x1) / 2 - r.x) < 2 && Math.abs((q.y0 + q.y1) / 2 - r.y) < 2);
        return h ? hangar(P, h) : null;
      }
      default: return null;
    }
  }

  return {
    buckets: BUCKETS,
    material(bucket, t) { return mats.material(bucket, t) || deps.mats.get('std', t); },

    obstacle(B, o) {
      use(B);
      if (o.gate) return gatePiece(P, o);
      return drawObstacle(o);
    },

    objective() { return false; },
    // (the styled ceilings are drawn with the props: the engine's generic ones are skipped for them)
    roof(B, r) { return ROOF_STYLES.has(r.style); },
    gateModel(B, gate, o) { use(B); return gatePiece(P, o); },

    props(B) {
      use(B);
      const step = (name, fn) => {
        try { fn(); } catch (err) { console.warn('airbase art:', name, err); }
        B.setAO(34, 0.42);
      };
      for (const r of map.roofs) if (ROOF_STYLES.has(r.style)) step('roof ' + r.style, () => drawRoof(r));
      step('marks', () => {
        for (const m of art.marks || []) {
          if (m.t === 'runway') runway(P, m);
          else if (m.t === 'flares') flarePath(P, m);
          else if (m.t === 'planewreck') planeWreck(P, m);
        }
      });
    },

    finish() {
      try { fx = createBaseFx(ctx, deps); } catch (err) { console.warn('airbase art: fx failed', err); }
    },
    update(view, frame) { if (fx) fx.update(view, frame); },
    setQuality(q) { P.tier = q; if (fx) fx.setQuality(q); },
    dispose() {
      if (fx) fx.dispose();
      mats.dispose();
    },
  };
}
