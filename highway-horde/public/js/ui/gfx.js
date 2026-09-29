// Graphics presets and the settings object handed to the renderer every frame. Pure data
// and functions (no DOM) so the mapping is unit-tested.
//
// Contract with render3d (the WORLD owner implements it): renderer.setQuality(q) when the
// preset's quality changes, and every renderer.render(view, { ..., settings }) carries
//   { screenShake, showNames, lighting, fov, crosshair,
//     renderScale: 'auto' | 0.5..1   // 'auto' = dynamic resolution that holds 60 fps
//     bloom, ao, filmGrain, vignette, volumetrics, reflections: boolean,
//     antialias: 'smaa' | 'fxaa' | 'off' }
// and r.stats may report renderScale (the scale in use right now) and gpuMs.
// The top-down renderer ignores the fields it doesn't know.

import { ANTIALIAS_MODES, QUALITIES, RENDER_SCALE_MIN, GRAPHICS_PRESETS } from './storage.js';

/** The effect toggles each preset sets (defined next to the prefs they validate). */
export { GRAPHICS_PRESETS };

/** Settings a preset owns; any other value in the Advanced panel makes it "custom". */
export const PRESET_KEYS = ['bloom', 'ao', 'antialias', 'filmGrain', 'vignette', 'volumetrics', 'reflections'];

/**
 * Pick a preset: sets the quality and every effect toggle the preset owns. Resolution
 * (renderScale) is left alone: it is its own control, and on 'auto' it already trades
 * pixels for frame rate.
 * @param {object} settings prefs.settings (mutated)
 * @param {string} quality 'ultra' | 'high' | 'low'
 * @returns {object} settings
 */
export function applyPreset(settings, quality) {
  const q = QUALITIES.includes(quality) ? quality : 'ultra';
  settings.quality = q;
  Object.assign(settings, GRAPHICS_PRESETS[q]);
  return settings;
}

/** Whether the effect toggles still match the preset of the current quality. */
export function presetMatches(settings) {
  const p = GRAPHICS_PRESETS[settings.quality];
  if (!p) return false;
  return PRESET_KEYS.every((k) => settings[k] === p[k]);
}

/** Label for a render scale choice. */
export function renderScaleLabel(v) {
  if (v === 'auto') return 'Auto';
  return `${Math.round(v * 100)}%`;
}

/**
 * Fill the renderer's per-frame settings from prefs.settings (reusing `out`, which the
 * match loop passes to every render call; `crosshair` is set per frame by match.js).
 * @param {object} s prefs.settings (validated)
 * @param {object} [out]
 * @returns {object} out
 */
export function rendererSettings(s, out = {}) {
  out.screenShake = s.screenShake !== false;
  out.showNames = s.showNames !== false;
  out.lighting = s.lighting !== false;
  out.fov = Number.isFinite(s.fov) ? s.fov : 80;
  if (out.crosshair === undefined) out.crosshair = true;
  out.renderScale = s.renderScale === 'auto' ? 'auto'
    : Number.isFinite(s.renderScale) ? Math.min(1, Math.max(RENDER_SCALE_MIN, s.renderScale)) : 'auto';
  out.bloom = s.bloom !== false;
  out.ao = s.ao !== false;
  out.antialias = ANTIALIAS_MODES.includes(s.antialias) ? s.antialias : 'smaa';
  out.filmGrain = s.filmGrain !== false;
  out.vignette = s.vignette !== false;
  out.volumetrics = s.volumetrics !== false;
  out.reflections = s.reflections !== false;
  return out;
}

/**
 * One line for the in-game stats readout: frame rate, the renderer's current resolution
 * scale and GPU time when it reports them, then network numbers.
 * @param {{ fps: number, renderStats?: object, ping?: number, isHost?: boolean, snapshotsPerSec?: number }} o
 */
export function statsLine(o) {
  const parts = [`${Math.round(o.fps || 0)} FPS`];
  const r = o.renderStats;
  if (r && Number.isFinite(r.renderScale)) parts.push(`RES ${Math.round(r.renderScale * 100)}%`);
  if (r && Number.isFinite(r.gpuMs) && r.gpuMs > 0) parts.push(`GPU ${r.gpuMs.toFixed(1)} ms`);
  if (o.isHost) parts.push('HOST');
  else if (Number.isFinite(o.ping)) parts.push(`PING ${Math.round(o.ping)} ms`);
  if (o.snapshotsPerSec) parts.push(`${Math.round(o.snapshotsPerSec)} snap/s`);
  return parts.join(' · ');
}

/**
 * Whether the browser draws without a GPU (SwiftShader, llvmpipe, "Microsoft Basic Render":
 * hardware acceleration off, VMs, remote desktops). The menus then drop their animated
 * backdrop, which costs a full-screen repaint every frame on the CPU. Unknown → false.
 * Creates (and immediately releases) a tiny WebGL context: call it once, off the boot path.
 * @returns {boolean}
 */
export function probeSoftwareGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}
