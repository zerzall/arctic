// Remembers the player's profile (name, class, colour), client settings and the host's
// last lobby settings between visits. Every storage access is wrapped: private windows,
// blocked cookies and full quotas must never stop the game from starting.

import { CLASS_IDS } from '../shared/classes.js';
import { SENS_MIN, SENS_MAX } from './look.js';
import { NAME_MAX_LENGTH, DEFAULT_SETTINGS, DIFFICULTY_IDS, WAVE_OPTIONS } from '../shared/constants.js';
import { MODE_IDS } from '../shared/zone.js';
import { TIME_IDS } from '../shared/timeofday.js';

const KEY = 'highway-horde:prefs:v1';

/** Client-side options shown in the Settings dialog. */
export const DEFAULT_CLIENT_SETTINGS = {
  master: 0.8,
  sfx: 1,
  music: 0.6,
  muted: false,
  speech: false,     // story dialogue read aloud with speechSynthesis (off by default)
  // Graphics. quality goes to renderer.setQuality(); the rest rides along in the settings
  // object of every renderer.render() call (see gfx.js rendererSettings).
  quality: 'ultra',    // 'cinematic' | 'ultra' | 'high' | 'low'
  // Whether the player chose the quality (a click on a preset). Until then the first-run GPU
  // detection (ui/gpu.js) may raise the default to 'cinematic'; a chosen quality is never touched.
  qualityPicked: false,
  renderScale: 'auto', // 'auto' (dynamic resolution holding the display's refresh rate; may supersample: up to 1.5 on desktops, 2 on Cinematic) | 0.5..2
  bloom: true,
  ao: true,            // ambient occlusion
  antialias: 'smaa',   // 'smaa' | 'fxaa' | 'off'
  filmGrain: true,
  vignette: true,
  volumetrics: true,   // ground mist + lamps / fires glowing in the air ('high'/'ultra')
  reflections: true,   // wet-ground and water reflections ('high'/'ultra')
  gore: 'on',          // 'on' | 'low' (less blood, no limbs) | 'off' (dark ash instead of red, no gibs)
  // Cinematic extras (the Advanced panel; only the Cinematic tier honours them, every other
  // preset holds them off): MSAA samples on the HDR target, 4096 px cascaded sun shadows, screen-space
  // contact shadows, full-resolution AO, higher-quality reflections / light shafts, motion blur,
  // depth of field (hurt / downed), chromatic lens effects and shadow-casting lamps.
  msaa: 0,
  shadowsHigh: false,
  contactShadows: false,
  aoFull: false,
  fxHigh: false,
  motionBlur: false,
  dof: false,
  lensFx: false,
  lightShadows: false,
  lighting: true,
  screenShake: true,
  showNames: true,
  showStats: false,
  // Display: menus and HUD scale with the screen (uiscale.js); fullscreen is opt-in.
  // 'off' | 60 | 120 | 144: skip frames above this rate (the game otherwise follows the display's refresh)
  fpsCap: 'off',
  // Tone calibration for the display (× 1 = the game's own grade): exposure, contrast, colour
  displayBrightness: 1,
  displayContrast: 1,
  displaySaturation: 1,
  uiScale: 'auto',     // 'auto' | 0.75..1.5 (× the automatic, resolution-aware size)
  hudSafeArea: '16:9', // 'full' | '16:9' (ultrawide: HUD corners inside a centred 16:9 box)
  fullscreenOnStart: false,
  // First-person view (SPEC §7.5). 'fps' | 'topdown'; match.js falls back to top-down when
  // WebGL is unavailable, without touching the stored choice.
  view: 'fps',
  fov: 80,
  sensitivity: 1,     // mouse, × LOOK_RAD_PER_PX
  padLook: 1,         // gamepad right stick and touch look drag
  invertY: false,
  aimAssist: true,    // gamepad/touch only
  minimapRotate: true, // first person: the minimap turns so up = where you look
  rawMouse: true,     // pointer lock with unadjustedMovement (no OS acceleration) where supported
};

/** Field-of-view range offered in the settings (degrees; 120 for ultrawide players). */
export const FOV_MIN = 60;
export const FOV_MAX = 120;
/** Fixed render scales offered next to 'auto' (fraction of the native resolution). */
export const RENDER_SCALES = [2, 1.5, 1.25, 1, 0.85, 0.7, 0.5];
export const RENDER_SCALE_MIN = 0.5;
/** Above 1 the world is drawn bigger than the screen and shrunk back (supersampling). */
export const RENDER_SCALE_MAX = 2;
/** "UI size" multipliers offered next to 'auto'. */
export const UI_SCALES = [0.75, 0.9, 1.1, 1.25, 1.5];
export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.5;
export const ANTIALIAS_MODES = ['smaa', 'fxaa', 'off'];
export const QUALITIES = ['cinematic', 'ultra', 'high', 'low'];
/** MSAA sample counts offered on Cinematic (0 = off; clamped to what the GPU supports). */
export const MSAA_MODES = [0, 2, 4, 8];
/** Frame-rate caps offered in Display settings. */
export const FPS_CAPS = ['off', 60, 120, 144];
/** Range of the display calibration sliders. */
export const CALIB_MIN = 0.7;
export const CALIB_MAX = 1.3;
/** Gore levels: 'off' replaces blood with dark ash and nobody is blown apart. */
export const GORE_MODES = ['on', 'low', 'off'];

/**
 * The effect toggles each graphics preset sets (the preset's name is the quality). Also the
 * fallback for effects missing from stored prefs: someone who picked Low before the panel
 * existed keeps a light Low setup instead of waking up with every effect on.
 */
const NO_CINEMATIC = { msaa: 0, shadowsHigh: false, contactShadows: false, aoFull: false, fxHigh: false, motionBlur: false, dof: false, lensFx: false, lightShadows: false };
export const GRAPHICS_PRESETS = {
  // Cinematic: everything Ultra does, plus the RTX-class extras (motion blur stays off: taste)
  cinematic: {
    bloom: true, ao: true, antialias: 'smaa', filmGrain: true, vignette: true, volumetrics: true, reflections: true,
    msaa: 4, shadowsHigh: true, contactShadows: true, aoFull: true, fxHigh: true, motionBlur: false, dof: true, lensFx: true, lightShadows: true,
  },
  ultra: { bloom: true, ao: true, antialias: 'smaa', filmGrain: true, vignette: true, volumetrics: true, reflections: true, ...NO_CINEMATIC },
  high: { bloom: true, ao: false, antialias: 'smaa', filmGrain: true, vignette: true, volumetrics: true, reflections: false, ...NO_CINEMATIC },
  low: { bloom: false, ao: false, antialias: 'fxaa', filmGrain: false, vignette: true, volumetrics: false, reflections: false, ...NO_CINEMATIC },
};

const NAME_POOL = [
  'Ranger', 'Dusty', 'Maverick', 'Boone', 'Ripley', 'Hollis', 'Rook', 'Nova', 'Jinx', 'Tex',
  'Mako', 'Rusty', 'Vega', 'Colt', 'Birdie', 'Knox', 'Sable', 'Wren', 'Diesel', 'Moss',
];

/** A friendly default callsign so nobody plays as "Player". */
export function randomName() {
  const n = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
  return `${n}${Math.floor(10 + Math.random() * 90)}`;
}

/** Trim, collapse whitespace and cap the length the way the session will. */
export function cleanName(name) {
  return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

/** Phones and tablets: a coarse primary pointer (false where matchMedia is missing). */
export function isCoarsePointer() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches);
  } catch {
    // no matchMedia (Node tests, old browsers): treat as a desktop
    return false;
  }
}

/** Every device starts on 'ultra' until the player picks a quality in Settings. */
export function defaultQuality() {
  return DEFAULT_CLIENT_SETTINGS.quality;
}

/**
 * Every device starts on dynamic resolution ('auto' holds 60 fps). Phones still get the
 * full Ultra preset (the owner wants them at maximum and accepts that they run hot), but
 * Ultra at a fixed 3x pixel ratio with the detailed world drops most phones to single-digit
 * frame rates, so the resolution adapts instead; 100% stays one tap away in Settings.
 */
export function defaultRenderScale() {
  return DEFAULT_CLIENT_SETTINGS.renderScale;
}

/** Default client settings for this device (a fresh copy). */
export function defaultClientSettings() {
  return { ...DEFAULT_CLIENT_SETTINGS, quality: defaultQuality(), renderScale: defaultRenderScale() };
}

function defaults() {
  return {
    name: '',
    cls: CLASS_IDS[0],
    color: 0,
    settings: defaultClientSettings(),
    lobby: { ...DEFAULT_SETTINGS },
    seenHowTo: false,
  };
}

function readRaw() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function num01(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

function numIn(v, lo, hi, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

/** 'auto' or a finite number inside [lo, hi] (rounded to 0.01); anything else → fallback. */
function autoOrNum(v, lo, hi, fallback) {
  if (v === 'auto') return v;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo - 1e-9 || v > hi + 1e-9) return fallback;
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

/**
 * Validate a stored settings object field by field (garbage → this device's default).
 * @param {object} s raw settings (possibly from an older build or edited by hand)
 * @returns {object} a complete, valid settings object
 */
export function validateSettings(s) {
  if (!s || typeof s !== 'object') s = {};
  const ds = defaultClientSettings();
  let quality = oneOf(s.quality, QUALITIES, ds.quality);
  // Builds before the graphics panel saved the old desktop default ('high') with every
  // profile, whether or not the player chose it; those prefs have no renderScale. Treat
  // that 'high' as unpicked so desktops move up to the new default.
  const legacyHigh = s.renderScale === undefined && s.quality === 'high';
  if (legacyHigh) quality = ds.quality;
  // A quality counts as chosen when the profile says so; profiles from before the flag were
  // saved with the default 'ultra' whether or not it was picked, so only another value
  // (someone changed it on purpose) counts.
  const qualityPicked = !legacyHigh && (typeof s.qualityPicked === 'boolean' ? s.qualityPicked : s.quality !== undefined && s.quality !== 'ultra' && QUALITIES.includes(s.quality));
  // Missing or broken effect toggles follow the preset of the quality in use.
  const fx = GRAPHICS_PRESETS[quality];
  return {
    master: num01(s.master, ds.master),
    sfx: num01(s.sfx, ds.sfx),
    music: num01(s.music, ds.music),
    muted: bool(s.muted, ds.muted),
    speech: bool(s.speech, ds.speech),
    quality,
    qualityPicked,
    renderScale: autoOrNum(s.renderScale, RENDER_SCALE_MIN, RENDER_SCALE_MAX, ds.renderScale),
    bloom: bool(s.bloom, fx.bloom),
    ao: bool(s.ao, fx.ao),
    antialias: oneOf(s.antialias, ANTIALIAS_MODES, fx.antialias),
    filmGrain: bool(s.filmGrain, fx.filmGrain),
    vignette: bool(s.vignette, fx.vignette),
    volumetrics: bool(s.volumetrics, fx.volumetrics),
    reflections: bool(s.reflections, fx.reflections),
    gore: oneOf(s.gore, GORE_MODES, ds.gore),
    msaa: oneOf(s.msaa, MSAA_MODES, fx.msaa),
    shadowsHigh: bool(s.shadowsHigh, fx.shadowsHigh),
    contactShadows: bool(s.contactShadows, fx.contactShadows),
    aoFull: bool(s.aoFull, fx.aoFull),
    fxHigh: bool(s.fxHigh, fx.fxHigh),
    motionBlur: bool(s.motionBlur, fx.motionBlur),
    dof: bool(s.dof, fx.dof),
    lensFx: bool(s.lensFx, fx.lensFx),
    lightShadows: bool(s.lightShadows, fx.lightShadows),
    lighting: bool(s.lighting, ds.lighting),
    screenShake: bool(s.screenShake, ds.screenShake),
    showNames: bool(s.showNames, ds.showNames),
    showStats: bool(s.showStats, ds.showStats),
    fpsCap: oneOf(s.fpsCap, FPS_CAPS, ds.fpsCap),
    displayBrightness: Math.round(numIn(s.displayBrightness, CALIB_MIN, CALIB_MAX, ds.displayBrightness) * 100) / 100,
    displayContrast: Math.round(numIn(s.displayContrast, CALIB_MIN, CALIB_MAX, ds.displayContrast) * 100) / 100,
    displaySaturation: Math.round(numIn(s.displaySaturation, CALIB_MIN, CALIB_MAX, ds.displaySaturation) * 100) / 100,
    uiScale: autoOrNum(s.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, ds.uiScale),
    hudSafeArea: oneOf(s.hudSafeArea, ['full', '16:9'], ds.hudSafeArea),
    fullscreenOnStart: bool(s.fullscreenOnStart, ds.fullscreenOnStart),
    view: oneOf(s.view, ['fps', 'topdown'], ds.view),
    fov: Math.round(numIn(s.fov, FOV_MIN, FOV_MAX, ds.fov)),
    sensitivity: numIn(s.sensitivity, SENS_MIN, SENS_MAX, ds.sensitivity),
    padLook: numIn(s.padLook, SENS_MIN, SENS_MAX, ds.padLook),
    invertY: bool(s.invertY, ds.invertY),
    aimAssist: bool(s.aimAssist, ds.aimAssist),
    minimapRotate: bool(s.minimapRotate, ds.minimapRotate),
    rawMouse: bool(s.rawMouse, ds.rawMouse),
  };
}

/**
 * Load preferences, validating every field (storage may hold data from an older build
 * or something a player edited by hand).
 * @returns {{name: string, cls: string, color: number, settings: object, lobby: object, seenHowTo: boolean}}
 */
export function loadPrefs() {
  const d = defaults();
  const raw = readRaw();
  if (!raw || typeof raw !== 'object') return d;
  const out = d;
  if (typeof raw.name === 'string') out.name = cleanName(raw.name);
  if (CLASS_IDS.includes(raw.cls)) out.cls = raw.cls;
  if (Number.isInteger(raw.color) && raw.color >= 0 && raw.color < 6) out.color = raw.color;
  out.seenHowTo = bool(raw.seenHowTo, false);
  out.settings = validateSettings(raw.settings);
  const l = raw.lobby && typeof raw.lobby === 'object' ? raw.lobby : {};
  out.lobby = {
    mapId: typeof l.mapId === 'string' ? l.mapId : DEFAULT_SETTINGS.mapId,
    mode: oneOf(l.mode, MODE_IDS, DEFAULT_SETTINGS.mode),
    time: oneOf(l.time, TIME_IDS, DEFAULT_SETTINGS.time),
    difficulty: DIFFICULTY_IDS.includes(l.difficulty) ? l.difficulty : DEFAULT_SETTINGS.difficulty,
    waves: WAVE_OPTIONS.includes(l.waves) ? l.waves : DEFAULT_SETTINGS.waves,
    objective: bool(l.objective, DEFAULT_SETTINGS.objective),
    friendlyFire: bool(l.friendlyFire, DEFAULT_SETTINGS.friendlyFire),
  };
  return out;
}

/**
 * Persist the given preferences object (as returned by loadPrefs, possibly modified).
 * @returns {boolean} whether it was written
 */
export function savePrefs(prefs) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
