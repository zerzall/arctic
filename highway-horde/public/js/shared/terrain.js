// Terrain height field of a campaign map (SPEC §2.1). One smooth function of (x, y) that the
// simulation (player and zombie feet heights), the client prediction, the renderers
// (ground mesh, camera, actors, static props) and the tests all share, so nothing ever
// disagrees about where the ground is.
//
// A map's `terrain` record is plain data:
//   { hills:    [{ x, y, r, plateau, h, flank? }],       round hills: height h inside
//                                                          `plateau`, easing down to 0 at r
//     plateaus: [{ x0, y0, x1, y1, h, edge }] }           flat-topped rectangles (the tower's
//                                                          floors and roof), h inside, easing down
//                                                          to 0 over `edge` units past the rectangle
// The height is the highest of all features. Only + − × ÷ and sqrt are used (exactly rounded
// by IEEE 754 on every JavaScript engine), never sin/cos/exp, so the height — and the
// whole-Z_UNIT value the movement code stores (terrainQ) — is bit-identical on the host
// and on every client.
//
// The hill's slope factor (`flank`) drives the high-ground rules: 0 on the plateau and on
// the flat, 1 half way up the slope. Zombies climbing the flank are slowed and take extra
// damage (sim/zombies.js, sim/combat.js, `CAMPAIGN.slope`).

import { Z_UNIT } from './jump.js';

/** Smoothstep-style ease with zero slope at both ends (u clamped to 0..1). */
function ease(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * Build a terrain evaluator from a map's `terrain` record (null/undefined → flat).
 * @param {object|null} spec
 * @returns {{ flat: boolean, height(x: number, y: number): number, q(x: number, y: number): number, flank(x: number, y: number): number, spec: object|null, maxHeight: number }}
 */
export function makeTerrain(spec) {
  const hills = spec && Array.isArray(spec.hills) ? spec.hills : [];
  const plats = spec && Array.isArray(spec.plateaus) ? spec.plateaus : [];
  const flat = !hills.length && !plats.length;
  let maxHeight = 0;
  for (const h of hills) maxHeight = Math.max(maxHeight, h.h);
  for (const p of plats) maxHeight = Math.max(maxHeight, p.h);

  function height(x, y) {
    let best = 0;
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i];
      const dx = x - h.x, dy = y - h.y;
      if (dx > h.r || dx < -h.r || dy > h.r || dy < -h.r) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= h.r) continue;
      const v = d <= h.plateau ? h.h : h.h * ease(1 - (d - h.plateau) / (h.r - h.plateau));
      if (v > best) best = v;
    }
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      const ex = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0;
      const ey = y < p.y0 ? p.y0 - y : y > p.y1 ? y - p.y1 : 0;
      if (ex === 0 && ey === 0) {
        if (p.h > best) best = p.h;
        continue;
      }
      if (ex >= p.edge || ey >= p.edge) continue;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d >= p.edge) continue;
      const v = p.h * ease(1 - d / p.edge);
      if (v > best) best = v;
    }
    return best;
  }

  /** Height in whole Z_UNITs (what the player's vertical state stores). */
  function q(x, y) {
    if (flat) return 0;
    return Math.round(height(x, y) / Z_UNIT);
  }

  /** 0..1: how steep the hill's flank is here (0 on the plateau, on the flat and off any flank hill). */
  function flank(x, y) {
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i];
      if (!h.flank) continue;
      const dx = x - h.x, dy = y - h.y;
      if (dx > h.r || dx < -h.r || dy > h.r || dy < -h.r) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= h.r || d <= h.plateau) continue;
      const f = ease(1 - (d - h.plateau) / (h.r - h.plateau));
      return 4 * f * (1 - f);
    }
    return 0;
  }

  return { flat, height, q, flank, spec: spec || null, maxHeight };
}

const CACHE = new WeakMap();

/** Cached evaluator for a MapDef (or a bare terrain record). */
export function terrainOf(mapOrSpec) {
  if (!mapOrSpec) return FLAT;
  const spec = mapOrSpec.terrain !== undefined ? mapOrSpec.terrain : mapOrSpec;
  if (!spec || typeof spec !== 'object') return FLAT;
  let t = CACHE.get(spec);
  if (!t) {
    t = makeTerrain(spec);
    CACHE.set(spec, t);
  }
  return t;
}

const FLAT = makeTerrain(null);

/** Terrain height (world units) of a map at (x, y); 0 for a map without terrain. */
export function terrainHeight(map, x, y) {
  const t = terrainOf(map);
  return t.flat ? 0 : t.height(x, y);
}
