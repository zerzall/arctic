// Lit previews of baked materials for reviewing the art (not part of the library): each map set is
// shaded flat under a low raking sun plus a sky fill, using the albedo, the normal, the occlusion and
// the roughness (a cheap specular lobe), and written as a PNG. A contact sheet puts many side by side.

import { encodePNG } from './png.js';
import { toLin, toSrgb } from './surface.js';

/**
 * Shade a finished material (Surface.finish() output) at `out` px (a crop of `crop` of the tile, or
 * the whole tile downsampled). Returns RGB bytes.
 */
export function shade(maps, N, out = 768, o = {}) {
  const crop = o.crop ?? 1;   // fraction of the tile shown
  const L = norm(o.light || [-0.55, 0.45, 0.7]);
  const V = [0, 0, 1];
  const H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const px = new Uint8Array(out * out * 3);
  const step = (N * crop) / out;
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      // box-filter the texels under the pixel (2 × 2 taps when downsampling)
      let cr = 0, cg = 0, cb = 0;
      const taps = step > 1.5 ? 2 : 1;
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          const sx = Math.min(N - 1, Math.floor((x + (tx + 0.5) / taps) * step));
          const sy = Math.min(N - 1, Math.floor((y + (ty + 0.5) / taps) * step));
          const p = (sy * N + sx) * 3;
          const n = norm([maps.normal[p] / 127.5 - 1, maps.normal[p + 1] / 127.5 - 1, maps.normal[p + 2] / 127.5 - 1]);
          // (image rows run down, the normal's green runs up: flip the light's y with the rows)
          const nl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
          const nh = Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]);
          const rough = maps.rah[p] / 255, ao = maps.rah[p + 1] / 255, met = maps.mask[p] / 255;
          const a = Math.max(0.02, rough * rough), a2 = a * a;
          const d = nh * nh * (a2 - 1) + 1;
          const spec = (a2 / (Math.PI * d * d)) * 0.25 * nl;
          const alb = [toLin(maps.albedo[p] / 255), toLin(maps.albedo[p + 1] / 255), toLin(maps.albedo[p + 2] / 255)];
          const f0 = 0.04 * (1 - met);
          const sun = 2.6, sky = 0.32;
          for (let c = 0; c < 3; c++) {
            const base = alb[c];
            const diff = base * (1 - met) * (nl * sun + sky * ao);
            const sp = (f0 + base * met) * (spec * sun + sky * ao * 0.5);
            const v = diff + sp;
            if (c === 0) cr += v; else if (c === 1) cg += v; else cb += v;
          }
        }
      }
      const k = 1 / (taps * taps), q = (y * out + x) * 3;
      px[q] = tone(cr * k); px[q + 1] = tone(cg * k); px[q + 2] = tone(cb * k);
    }
  }
  return px;
}

function tone(v) {
  const t = v / (1 + v * 0.35);   // (a soft shoulder)
  return Math.max(0, Math.min(255, Math.round(toSrgb(Math.min(1, t)) * 255)));
}
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/** A contact sheet of shaded tiles (RGB `size` × `size` each) in `cols` columns → PNG buffer. */
export function sheet(tiles, size, cols) {
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * size, H = rows * size;
  const px = new Uint8Array(W * H * 3);
  tiles.forEach((t, k) => {
    const ox = (k % cols) * size, oy = Math.floor(k / cols) * size;
    for (let y = 0; y < size; y++) px.set(t.subarray(y * size * 3, (y + 1) * size * 3), ((oy + y) * W + ox) * 3);
  });
  return encodePNG(px, W, H, 3, { level: 6 });
}
