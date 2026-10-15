// Graphics presets and the settings object handed to the renderer every frame. Pure data
// and functions (no DOM) so the mapping is unit-tested.
//
// Contract with render3d (the WORLD owner implements it): renderer.setQuality(q) when the
// preset's quality changes, and every renderer.render(view, { ..., settings }) carries
//   { screenShake, showNames, lighting, fov, crosshair,
//     renderScale: 'auto' | 0.5..2   // 'auto' = dynamic resolution that holds the display's refresh rate
//     bloom, ao, filmGrain, vignette, volumetrics, reflections: boolean,
//     antialias: 'smaa' | 'fxaa' | 'off',
//     gore: 'on' | 'low' | 'off',    // blood, gibs and decals (off = dark ash, no gibs)
//     // Cinematic-tier extras (ignored below Cinematic): msaa 0|2|4|8, shadowsHigh, contactShadows,
//     // aoFull, fxHigh, motionBlur, dof, lensFx, lightShadows: boolean
//     // display calibration (multipliers around 1): brightness, contrast, saturation
//     // timing: boolean (per-pass GPU timings for the stats overlay) }
// and r.stats may report renderScale (the scale in use right now), gpuMs and passMs.
// The top-down renderer ignores the fields it doesn't know.

import {
  ANTIALIAS_MODES, QUALITIES, RENDER_SCALE_MIN, RENDER_SCALE_MAX, GRAPHICS_PRESETS, GORE_MODES, MSAA_MODES, CALIB_MIN, CALIB_MAX,
} from './storage.js';

/** A display-calibration multiplier: a finite number inside its range, else 1. */
const calib = (v) => (Number.isFinite(v) ? Math.min(CALIB_MAX, Math.max(CALIB_MIN, v)) : 1);

/** The effect toggles each preset sets (defined next to the prefs they validate). */
export { GRAPHICS_PRESETS };

/** Settings a preset owns; any other value in the Advanced panel makes it "custom". */
export const PRESET_KEYS = [
  'bloom', 'ao', 'antialias', 'filmGrain', 'vignette', 'volumetrics', 'reflections',
  'msaa', 'shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'motionBlur', 'dof', 'lensFx', 'lightShadows',
];

/**
 * Pick a preset: sets the quality and every effect toggle the preset owns. Resolution
 * (renderScale) is left alone: it is its own control, and on 'auto' it already trades
 * pixels for frame rate.
 * @param {object} settings prefs.settings (mutated)
 * @param {string} quality 'cinematic' | 'ultra' | 'high' | 'low'
 * @param {{ picked?: boolean }} [o] picked: whether this is the player's own choice (default true);
 *   the first-run GPU detection passes false so a later detection may still refine it
 * @returns {object} settings
 */
export function applyPreset(settings, quality, o = {}) {
  const q = QUALITIES.includes(quality) ? quality : 'ultra';
  settings.quality = q;
  Object.assign(settings, GRAPHICS_PRESETS[q]);
  settings.qualityPicked = o.picked !== false;
  return settings;
}

/** The Cinematic-only settings among the preset keys. */
const CINEMATIC_KEYS = ['msaa', 'shadowsHigh', 'contactShadows', 'aoFull', 'fxHigh', 'motionBlur', 'dof', 'lensFx', 'lightShadows'];

/**
 * First-run default from GPU detection (ui/gpu.js recommendedTier): moves a profile whose quality was
 * never picked to the recommended tier. A picked quality is never touched. When the player changed some
 * effect toggles without picking a preset, only the tier (and the Cinematic extras) move.
 * @param {object} settings prefs.settings (mutated)
 * @param {'cinematic'|'ultra'|null} tier
 * @returns {boolean} whether anything changed
 */
export function applyDetectedTier(settings, tier) {
  if (!QUALITIES.includes(tier) || settings.qualityPicked || settings.quality === tier) return false;
  if (presetMatches(settings)) {
    applyPreset(settings, tier, { picked: false });
  } else {
    settings.quality = tier;
    for (const k of CINEMATIC_KEYS) settings[k] = GRAPHICS_PRESETS[tier][k];
  }
  return true;
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
    : Number.isFinite(s.renderScale) ? Math.min(RENDER_SCALE_MAX, Math.max(RENDER_SCALE_MIN, s.renderScale)) : 'auto';
  out.bloom = s.bloom !== false;
  out.ao = s.ao !== false;
  out.antialias = ANTIALIAS_MODES.includes(s.antialias) ? s.antialias : 'smaa';
  out.filmGrain = s.filmGrain !== false;
  out.vignette = s.vignette !== false;
  out.volumetrics = s.volumetrics !== false;
  out.reflections = s.reflections !== false;
  out.gore = GORE_MODES.includes(s.gore) ? s.gore : 'on';
  out.msaa = MSAA_MODES.includes(s.msaa) ? s.msaa : 0;
  out.shadowsHigh = s.shadowsHigh === true;
  out.contactShadows = s.contactShadows === true;
  out.aoFull = s.aoFull === true;
  out.fxHigh = s.fxHigh === true;
  out.motionBlur = s.motionBlur === true;
  out.dof = s.dof === true;
  out.lensFx = s.lensFx === true;
  out.lightShadows = s.lightShadows === true;
  out.brightness = calib(s.displayBrightness);
  out.contrast = calib(s.displayContrast);
  out.saturation = calib(s.displaySaturation);
  out.timing = s.showStats === true;
  return out;
}

/**
 * The in-game stats readout: frame rate, the renderer's current resolution scale and GPU time
 * when it reports them, then network numbers; a second line names the tier, the internal
 * resolution, MSAA and the display's refresh rate; a third (GPU timer available) the milliseconds
 * of each pass of the post chain.
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
  const lines = [parts.join(' · ')];
  if (r && r.tier && r.width) {
    lines.push(`${String(r.tier).toUpperCase()} · ${r.width}×${r.height}${r.msaa ? ` · MSAA ${r.msaa}×` : ''}${r.refreshHz ? ` · ${r.refreshHz} Hz` : ''}`);
  }
  if (r && r.passMs) {
    const list = Object.entries(r.passMs).filter(([, v]) => Number.isFinite(v) && v >= 0.05).map(([k, v]) => `${k} ${v.toFixed(1)}`);
    if (list.length) lines.push(`${list.join(' · ')} ms`);
  }
  return lines.join('\n');
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
