// The distant skyline of the open maps and the town levels (3D only, no collision): rows of tall blocks
// past the tree line on the sides of the map where a town or a city would stand (the next town down the
// highway, Harlan city beyond the county, the river town over the bridge), drawn as one mesh by
// world-ridge.js makeSkyline (windows a storey apart). A campaign map has its own (map.campaign.skyline).
// A pure function of the map: the same blocks on every client.

import { seededRng } from './world-geo.js';

/**
 * Where each map's town stands: sides ('n' -y, 's' +y, 'w' -x, 'e' +x) with the blocks' height range,
 * how many a row and how far out the first row stands.
 */
const PRESETS = {
  highway: [{ side: 'w', n: 16, h: [180, 760], o: 1100 }, { side: 'e', n: 14, h: [160, 620], o: 1100 }, { side: 'n', n: 22, h: [120, 420], o: 1300, span: [0.05, 0.4] }],
  truckstop: [{ side: 'n', n: 14, h: [90, 320], o: 1500, span: [0.15, 0.6] }],
  bridge: [{ side: 'e', n: 18, h: [160, 640], o: 1000 }, { side: 'n', n: 12, h: [120, 380], o: 1200, span: [0.55, 1] }],
  checkpoint: [{ side: 'n', n: 20, h: [220, 980], o: 1100 }, { side: 'w', n: 12, h: [160, 520], o: 1200, span: [0, 0.5] }],
  harlan: [{ side: 'w', n: 20, h: [200, 900], o: 1200, span: [0.25, 0.75] }, { side: 'n', n: 14, h: [140, 480], o: 1300, span: [0.2, 0.6] }],
  hollowcreek: [{ side: 'n', n: 24, h: [160, 620], o: 1300 }, { side: 's', n: 18, h: [140, 480], o: 1300, span: [0.3, 0.9] }],
  railyard: [{ side: 'n', n: 22, h: [200, 860], o: 1300, span: [0.2, 1] }],
};

/**
 * The skyline blocks of a map: [{ x, y, w, d, h, s }] (centre, footprint, height, a hash seed), or [].
 * @param {object} map
 * @returns {object[]}
 */
export function skylineOf(map) {
  if (map.campaign) return [];
  const rows = PRESETS[map.id];
  if (!rows) return [];
  const W = map.width, H = map.height;
  const rng = seededRng(7919 + W * 3 + H);
  const out = [];
  for (const r of rows) {
    const [s0, s1] = r.span || [0, 1];
    const along = r.side === 'n' || r.side === 's';
    const len = (along ? W + 2 * r.o : H + 2 * r.o) * (s1 - s0);
    const start = (along ? -r.o : -r.o) + (along ? W + 2 * r.o : H + 2 * r.o) * s0;
    for (let row = 0; row < 2; row++) {
      const n = Math.round(r.n * (row ? 0.8 : 1));
      const off = r.o + row * 520 + rng.range(0, 120);
      for (let i = 0; i < n; i++) {
        const t = start + (len * (i + rng.range(0.15, 0.85))) / n;
        const w = rng.range(140, 320), d = rng.range(140, 280);
        // (the second row stands taller: the city's middle behind its edge)
        const h = rng.range(r.h[0], r.h[1]) * (row ? 1.25 : 1) * (rng.next() < 0.12 ? 1.5 : 1);
        const x = r.side === 'w' ? -off : r.side === 'e' ? W + off : t;
        const y = r.side === 'n' ? -off : r.side === 's' ? H + off : t;
        out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), d: Math.round(d), h: Math.round(h), s: Math.floor(rng.range(0, 1e6)) });
      }
    }
  }
  return out;
}
