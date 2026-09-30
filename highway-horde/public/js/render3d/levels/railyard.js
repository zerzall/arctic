// The 3D art of the story level "railyard", the Harlan Rail Yard (JOURNEY.md §5). Owner: agent C3.
//
// world.js hands this module the level's obstacles, its free props and a finish/update/quality/dispose
// cycle, like the hideouts. The layout is shared/levels/railyard.js; the pieces live in
//   dam-kit.js / dam-atlas.js  the C3 kit and sign atlas (shared with the dam and the airbase)
//   railyard-stock.js          rails and sleepers, the rolling stock, the water tower, masts, catenary, gantries
//   railyard-build.js          the engine shed, the signal box, the truss bridge, fences, gates, yard furniture
//   railyard-freight.js        container stacks, the gantry crane, the grain elevator, the Delta sign
//   railyard-fx.js             sunbeams in the shed by day, the live locomotive's exhaust

import { C3_BUCKETS, createC3Materials, setKitDay, at, S, CONC, STEEL, WOOD, COL, pic, tubeLamp } from './dam-kit.js';
import { YARD } from '../../shared/levels/railyard.js';
import { tracks, wagon, waterTower, mast, catenary, gantry } from './railyard-stock.js';
import { engineShed, shedRoof, shedOffice, yardWall, signalBox, leverFrame, trussBridge, yardGate, yardProp } from './railyard-build.js';
import { containerStack, rmgCrane, grainElevator, backdrop } from './railyard-freight.js';
import { createYardFx } from './railyard-fx.js';

/** Extra geo-builder buckets of this level: the C3 atlas lit, emissive and blended. */
export const BUCKETS = C3_BUCKETS;

const ROOF_STYLES = new Set(['shed', 'shedoffice', 'leverroom']);

/**
 * @param {object} ctx renderer ctx (ctx.map is the built level)
 * @param {object} deps { root, mats, fx, halos, shafts, day, aniso, gy, tier, full, newBuilder(), matOf(bucket, tier) }
 */
export function createLevelArt(ctx, deps) {
  const map = ctx.map;
  const mats = createC3Materials(deps);
  const art = map.levelArt || { rails: [], flights: [], marks: [], pits: [] };
  const SH = YARD.shed;
  const exhaust = [];
  const P = {
    B: null, gy: deps.gy, halos: deps.halos, tier: deps.full || deps.tier, day: !!deps.day, map, ctx, pits: art.pits || [], dyn: exhaust,
    // stock standing in the shed stands on its raised floor (over a pit the terrain is the ground)
    floorAt: (o) => (o.x > SH.x0 && o.x < SH.x1 && o.y > SH.y0 && o.y < SH.y1 ? SH.floor : 0),
  };
  P.wagon = (o) => wagon(P, o);
  setKitDay(P.day);
  let fx = null;
  const use = (B) => { P.B = B; return P; };

  return {
    buckets: BUCKETS,
    material(bucket, t) { return mats.material(bucket, t) || deps.mats.get('std', t); },

    obstacle(B, o) {
      use(B);
      if (o.gate) return yardGate(P, o);
      const s = o.style;
      if (!s) return false;
      if (s === 'nodraw' || s === 'rmgleg') return true;
      if (o.kind === 'bus' || o.kind === 'tanker') return wagon(P, o);
      if (s === 'stack') return containerStack(P, o);
      if (s === 'mast') return mast(P, o);
      if (s === 'leverframe') return leverFrame(P, o);
      if (s === 'foremandesk') {
        B.rblock('std', 0, 28, 0, o.w, 3, o.h, 1, '#6a5a44', null, WOOD);
        for (const x of [-o.w / 2 + 6, o.w / 2 - 6]) B.block('std', x, 0, 0, 8, 28, o.h - 6, '#4a4e52', null, STEEL);
        pic(B, 'timetable', -20, 31.5, 0, 22, 0, { rx: -Math.PI / 2 });
        pic(B, 'clipboard', 30, 31.6, 4, 12, 0, { rx: -Math.PI / 2 });
        return true;
      }
      if (s === 'filecab') { B.rblock('std', 0, 0, 0, o.w, 70, o.h, 1, '#6a7076', null, STEEL); return true; }
      return yardWall(P, o) || yardProp(P, o) || false;
    },

    objective() { return false; },
    roof(B, r) { return ROOF_STYLES.has(r.style); },
    gateModel(B, gate, o) { use(B); return yardGate(P, o); },

    props(B) {
      use(B);
      const step = (name, fn) => {
        try { fn(); } catch (err) { console.warn('railyard art:', name, err); }
        B.setAO(34, 0.42);
      };
      step('tracks', () => tracks(P, art.rails));
      step('shed', () => { engineShed(P); shedRoof(P); });
      step('shed steps', () => {
        for (const fl of art.flights) {
          if (fl.h1 > 40) continue;
          const n = fl.n, run = (fl.x1 - fl.x0) / n, rise = (fl.h1 - fl.h0) / n;
          for (let k = 0; k < n; k++) {
            const x = fl.up === 'e' ? fl.x0 + run * (k + 0.5) : fl.x1 - run * (k + 0.5);
            at(B, deps.gy, x, (fl.y0 + fl.y1) / 2, 0, 0, 77 + k);
            B.block('std', 0, 0, 0, run + 0.5, rise * (k + 1), fl.y1 - fl.y0, COL.concD, null, CONC);
            B.box('std', (fl.up === 'e' ? -run / 2 : run / 2) + (fl.up === 'e' ? 1 : -1), rise * (k + 1), 0, 2, 0.8, fl.y1 - fl.y0 - 4, COL.yellow, null, STEEL);
          }
        }
      });
      step('signal box', () => signalBox(P, art.flights.find((f) => f.h1 > 40)));
      step('marks', () => {
        for (const m of art.marks) {
          if (m.t === 'watertower') waterTower(P, m);
          else if (m.t === 'catenary') catenary(P, m);
          else if (m.t === 'gantry') gantry(P, m, deps.halos);
          else if (m.t === 'bridge') trussBridge(P, m);
          else if (m.t === 'rmg') rmgCrane(P, m);
          else if (m.t === 'elevator') grainElevator(P, m);
        }
        backdrop(P, art.marks);
      });
      step('rooms', () => { for (const r of map.roofs) if (r.style === 'shedoffice') shedOffice(P, r); });
      void S; void tubeLamp;
    },

    finish() {
      try { fx = createYardFx(ctx, deps, exhaust); } catch (err) { console.warn('railyard art: fx failed', err); }
    },
    update(view, frame) { if (fx) fx.update(view, frame); },
    setQuality(q) { P.tier = q; if (fx) fx.setQuality(q); },
    dispose() {
      if (fx) fx.dispose();
      mats.dispose();
    },
  };
}
