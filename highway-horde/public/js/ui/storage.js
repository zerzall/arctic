// Remembers the player's profile (name, class, colour), client settings and the host's
// last lobby settings between visits. Every storage access is wrapped: private windows,
// blocked cookies and full quotas must never stop the game from starting.

import { CLASS_IDS } from '../shared/classes.js';
import { SENS_MIN, SENS_MAX } from './look.js';
import { NAME_MAX_LENGTH, DEFAULT_SETTINGS, DIFFICULTY_IDS, WAVE_OPTIONS } from '../shared/constants.js';

const KEY = 'highway-horde:prefs:v1';

/** Client-side options shown in the Settings dialog. */
export const DEFAULT_CLIENT_SETTINGS = {
  master: 0.8,
  sfx: 1,
  music: 0.6,
  muted: false,
  quality: 'high',
  lighting: true,
  screenShake: true,
  showNames: true,
  showStats: false,
  // First-person view (SPEC §7.5). 'fps' | 'topdown'; match.js falls back to top-down when
  // WebGL is unavailable, without touching the stored choice.
  view: 'fps',
  fov: 80,
  sensitivity: 1,     // mouse, × LOOK_RAD_PER_PX
  padLook: 1,         // gamepad right stick and touch look drag
  invertY: false,
  aimAssist: true,    // gamepad/touch only
  minimapRotate: true, // first person: the minimap turns so up = where you look
};

/** Field-of-view range offered in the settings (degrees). */
export const FOV_MIN = 60;
export const FOV_MAX = 110;

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

/**
 * Phones and tablets start on 'ultra' (native resolution, every effect; they will run
 * hot) until the player picks a quality in Settings; desktops start on
 * DEFAULT_CLIENT_SETTINGS.quality.
 */
export function defaultQuality() {
  try {
    if (globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches) return 'ultra';
  } catch {
    // no matchMedia (Node tests, old browsers): use the desktop default
  }
  return DEFAULT_CLIENT_SETTINGS.quality;
}

function defaults() {
  return {
    name: '',
    cls: CLASS_IDS[0],
    color: 0,
    settings: { ...DEFAULT_CLIENT_SETTINGS, quality: defaultQuality() },
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
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const ds = DEFAULT_CLIENT_SETTINGS;
  out.settings = {
    master: num01(s.master, ds.master),
    sfx: num01(s.sfx, ds.sfx),
    music: num01(s.music, ds.music),
    muted: bool(s.muted, ds.muted),
    quality: s.quality === 'low' || s.quality === 'high' || s.quality === 'ultra' ? s.quality : defaultQuality(),
    lighting: bool(s.lighting, ds.lighting),
    screenShake: bool(s.screenShake, ds.screenShake),
    showNames: bool(s.showNames, ds.showNames),
    showStats: bool(s.showStats, ds.showStats),
    view: s.view === 'fps' || s.view === 'topdown' ? s.view : ds.view,
    fov: Math.round(numIn(s.fov, FOV_MIN, FOV_MAX, ds.fov)),
    sensitivity: numIn(s.sensitivity, SENS_MIN, SENS_MAX, ds.sensitivity),
    padLook: numIn(s.padLook, SENS_MIN, SENS_MAX, ds.padLook),
    invertY: bool(s.invertY, ds.invertY),
    aimAssist: bool(s.aimAssist, ds.aimAssist),
    minimapRotate: bool(s.minimapRotate, ds.minimapRotate),
  };
  const l = raw.lobby && typeof raw.lobby === 'object' ? raw.lobby : {};
  out.lobby = {
    mapId: typeof l.mapId === 'string' ? l.mapId : DEFAULT_SETTINGS.mapId,
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
