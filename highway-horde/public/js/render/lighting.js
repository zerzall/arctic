// Night lighting. A small canvas (a quarter of the CSS resolution — light is soft, so
// that is plenty) is filled with the ambient darkness; every light cuts a soft hole into
// it with 'destination-out' (flashlight cones, lamps, fires, muzzle flashes, explosions)
// and coloured lights then paint a faint wash of their colour back into the hole, so a
// fire tints the ground orange and a sodium lamp yellow. A vignette darkens the corners.
// The result goes over the scene in one ordinary drawImage: only coefficient blend modes
// are used, which every GPU (and software rasteriser) handles cheaply.

import { makeCanvas, releaseCanvas, hexToRgb } from './util.js';
import { glowSprite, coneSprite, tintedGlow } from './textures.js';

const LIGHT_RES = 0.25;   // light-map texels per CSS px
const WASH = 0.2;         // strength of the coloured wash inside a light pool

/**
 * Darkness colour + opacity for a map mood.
 * @returns {{color: string, alpha: number}}
 */
export function nightFor(tint, darkness) {
  const [r, g, b] = hexToRgb(tint || '#223344');
  // a deep version of the tint: moonlit blue on the highway, dusty amber at the truck stop
  const k = 0.3;
  const color = `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  const d = darkness == null ? 0.6 : darkness;
  const alpha = Math.max(0.35, Math.min(0.9, 0.18 + d * 0.95));
  return { color, alpha };
}

export function createLighting() {
  let canvas = null, g = null;
  let lw = 0, lh = 0;
  let f = 1;            // light texels per device px
  let kk = 1, tx = 0, ty = 0;
  let vignette = null;
  let fill = 'rgba(0,0,0,0.7)';
  let fillKey = '';
  const glow = glowSprite();
  const cone = coneSprite();

  return {
    resize(cssW, cssH, deviceW) {
      const w = Math.max(16, Math.ceil(cssW * LIGHT_RES));
      const h = Math.max(16, Math.ceil(cssH * LIGHT_RES));
      if (!canvas) { canvas = makeCanvas(w, h); g = canvas.getContext('2d'); }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      lw = w; lh = h;
      f = w / Math.max(1, deviceW);
      const r = Math.hypot(w, h) / 2;
      vignette = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    },
    /**
     * Start a frame. `k` is the world→device transform {k, tx, ty}.
     * @param {{color: string, alpha: number}} night from nightFor()
     */
    begin(k, night) {
      kk = k.k * f; tx = k.tx * f; ty = k.ty * f;
      const key = night.color + night.alpha;
      if (key !== fillKey) {
        fillKey = key;
        const [r, gg, b] = night.color.match(/\d+/g).map(Number);
        fill = `rgba(${r},${gg},${b},${night.alpha})`;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'copy';
      g.globalAlpha = 1;
      g.fillStyle = fill;
      g.fillRect(0, 0, lw, lh);
      g.globalCompositeOperation = 'destination-out';
    },
    /** Radial light of radius r (world px), intensity 0..1; `color` adds a tinted wash. */
    point(x, y, r, intensity, color) {
      if (intensity <= 0.01) return;
      const sx = tx + x * kk, sy = ty + y * kk, sr = r * kk;
      if (sx + sr < 0 || sy + sr < 0 || sx - sr > lw || sy - sr > lh) return;
      g.globalAlpha = intensity > 1 ? 1 : intensity;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(glow, sx - sr, sy - sr, sr * 2, sr * 2);
      if (color) {
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = Math.min(1, intensity) * WASH;
        g.drawImage(tintedGlow(color), sx - sr * 0.8, sy - sr * 0.8, sr * 1.6, sr * 1.6);
        g.globalCompositeOperation = 'destination-out';
      }
    },
    /** Flashlight cone from (x, y) along angle a, `range` world px long. */
    cone(x, y, a, range, intensity) {
      const sx = tx + x * kk, sy = ty + y * kk, sr = range * kk;
      if (sx + sr < 0 || sy + sr < 0 || sx - sr > lw || sy - sr > lh) return;
      const s = sr / 256;
      const c = Math.cos(a) * s, sn = Math.sin(a) * s;
      g.globalAlpha = intensity > 1 ? 1 : intensity;
      g.setTransform(c, sn, -sn, c, sx, sy);
      g.drawImage(cone, 0, -128);
    },
    /** Composite the darkness over the main canvas (device transform). */
    end(ctx, deviceW, deviceH, vignetteOn = true) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      if (vignetteOn) {
        g.fillStyle = vignette;
        g.fillRect(0, 0, lw, lh);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, 0, lw, lh, 0, 0, deviceW, deviceH);
    },
    destroy() {
      releaseCanvas(canvas);
      canvas = null;
      g = null;
    },
  };
}
