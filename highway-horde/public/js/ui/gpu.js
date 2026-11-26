// GPU detection for the first-run graphics default (SPEC §7.5.3). The renderer string of
// WEBGL_debug_renderer_info (UNMASKED_RENDERER) is matched against a CONSERVATIVE table: only
// GPUs known to be strong enough for the Cinematic tier at 1080p-4K are recommended it, known
// mid-range discrete GPUs get Ultra, and everything else (integrated, phones, software
// rasterisers, unknown or masked strings) gets no recommendation, i.e. the existing default.
// Pure functions (no DOM) so the table is unit-tested; probeGpu() is the one browser call.
//
// Strings look like
//   ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)
//   ANGLE (AMD, AMD Radeon RX 7900 XTX (0x0000744C) Direct3D11 vs_5_0 ps_5_0, D3D11)
//   ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)
//   ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54)
//   NVIDIA GeForce RTX 3060/PCIe/SSE2            (Firefox)
//   AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49, 5.19.0)   (Mesa)

/**
 * The readable GPU name out of a WebGL renderer string.
 * @param {string} raw UNMASKED_RENDERER_WEBGL
 * @returns {string} e.g. 'NVIDIA GeForce RTX 4070 Ti SUPER' ('' for nothing usable)
 */
export function cleanGpuName(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const angle = /^ANGLE\s*\((.*)\)\s*$/is.exec(s);
  if (angle) {
    // "vendor, renderer, backend": the renderer is the middle part (it may hold parentheses, not ", ")
    const parts = angle[1].split(/,\s+/);
    s = parts.length >= 2 ? parts[1] : parts[0];
  }
  s = s
    .replace(/^ANGLE\s+Metal\s+Renderer:\s*/i, '')
    .replace(/^Mesa\s+/i, '')
    .replace(/\s*\((?:radeonsi|iris|crocus|zink|llvmpipe|nvc|nouveau)[^)]*\)\s*$/i, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s+Direct3D\d+\w*(\s+vs_\d_\d)?(\s+ps_\d_\d)?/gi, '')
    .replace(/\/PCIe\/SSE2/gi, '')
    .replace(/\/SSE2/gi, '')
    .replace(/,\s*or similar\s*$/i, '')
    .replace(/\(TM\)|\(R\)|™|®/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|lavapipe/i;

/** Model number of a GeForce / Radeon name ("RTX 4070 Ti" → 4070), else NaN. */
function num(re, name) {
  const m = re.exec(name);
  return m ? Number(m[1]) : NaN;
}

/**
 * Classify a GPU by its (cleaned or raw) name.
 * @param {string} rawName renderer string or cleaned name
 * @returns {{ name: string, vendor: string, class: 'high'|'mid'|'integrated'|'software'|'unknown', tier: 'cinematic'|'ultra'|null }}
 *   class 'high' = a recommended Cinematic GPU, 'mid' = a discrete GPU of Ultra class, tier = the recommendation
 */
export function classifyGpu(rawName) {
  const name = cleanGpuName(rawName) || String(rawName || '').trim();
  const out = (cls, tier, vendor) => ({ name, vendor, class: cls, tier });
  if (!name) return out('unknown', null, 'unknown');
  if (SOFTWARE.test(name) || SOFTWARE.test(String(rawName))) return out('software', null, 'software');
  const laptop = /laptop|max-?q|mobile/i.test(name);

  // ---- NVIDIA ----
  if (/nvidia|geforce|\bRTX\b|\bGTX\b|quadro|titan/i.test(name)) {
    const v = 'NVIDIA';
    // RTX 50 / 40 / 30 / 20 series: (number, desktop threshold for Cinematic, laptop threshold)
    let m = /\bRTX\s*(50|40|30|20)(\d)0\b/i.exec(name);
    if (m) {
      const series = Number(m[1]), tierDigit = Number(m[2]);   // 4070 → series 40, digit 7
      const need = { 50: [6, 7], 40: [6, 7], 30: [6, 7], 20: [7, 8] }[series];
      const min = laptop ? need[1] : need[0];
      return tierDigit >= min ? out('high', 'cinematic', v) : out('mid', 'ultra', v);
    }
    // workstation: RTX A4000 and up, RTX 4000 Ada and up
    m = /\bRTX\s*A(\d)000\b/i.exec(name);
    if (m) return Number(m[1]) >= 4 ? out('high', 'cinematic', v) : out('mid', 'ultra', v);
    if (/\bRTX\s*(4000|4500|5000|5880|6000)\s*Ada/i.test(name)) return out('high', 'cinematic', v);
    if (/\bTITAN\s*(RTX|V|Xp?)\b/i.test(name)) return out('high', 'cinematic', v);
    // GTX: the 1080 / 1080 Ti and up; the 16 series and 1050-1070 are Ultra class
    m = /\bGTX\s*(\d{3,4})/i.exec(name);
    if (m) {
      const n = Number(m[1]);
      if (n === 1080 && !laptop) return out('high', 'cinematic', v);
      if (n >= 1050 || (n >= 1630 && n <= 1660)) return out('mid', 'ultra', v);
      return out('unknown', null, v);
    }
    return out('unknown', null, v);
  }

  // ---- AMD ----
  if (/\bamd\b|radeon|\bRX\b/i.test(name)) {
    const v = 'AMD';
    if (/radeon\s*(pro\s*)?w(6800|6900|7800|7900)/i.test(name)) return out('high', 'cinematic', v);
    const m = /\bRX\s*(\d{4})\s*(XTX|XT|GRE|M)?\b/i.exec(name);
    if (m) {
      const n = Number(m[1]), suffix = (m[2] || '').toUpperCase();
      const lap = laptop || suffix === 'M';
      // 9000: 9060 XT and up; 7000: 7600 XT and up; 6000: 6700 and up (laptop parts one step higher)
      const strong = n >= 9060 ? true
        : n >= 7000 && n < 8000 ? (n >= 7700 || (n === 7600 && suffix === 'XT')) && !(lap && n < 7800)
          : n >= 6000 && n < 7000 ? n >= 6700 && !(lap && n < 6800)
            : false;
      if (strong) return out('high', 'cinematic', v);
      if (n >= 5500) return out('mid', 'ultra', v);
      return out('unknown', null, v);
    }
    if (/vega\s*(vii|64|56)|radeon\s*vii/i.test(name)) return out('mid', 'ultra', v);
    return out('integrated', null, v);   // "AMD Radeon(TM) Graphics", 780M, Vega 8 ...
  }

  // ---- Apple ----
  const ap = /\bApple\s+M(\d)(\s+(Pro|Max|Ultra))?/i.exec(name);
  if (ap) {
    const gen = Number(ap[1]);
    const big = !!ap[3];
    // M1 Pro / Max / Ultra and every M2+ (base included) get Cinematic; a bare M1 is Ultra
    if (gen >= 2 || big) return out('high', 'cinematic', 'Apple');
    return out('mid', 'ultra', 'Apple');
  }
  if (/^Apple\b/i.test(name)) return out('unknown', null, 'Apple');   // "Apple GPU": Safari hides the model

  // ---- Intel ----
  if (/intel/i.test(name)) {
    // Arc discrete cards: A750 / A770 / B570 / B580 / B770 are Cinematic class, the small ones Ultra
    const arc = /\bArc\b.*?\b([AB])(\d{3})\b/i.exec(name);
    if (arc) {
      const n = Number(arc[2]);
      return (arc[1].toUpperCase() === 'A' ? n >= 750 : n >= 570) ? out('high', 'cinematic', 'Intel') : out('mid', 'ultra', 'Intel');
    }
    return out('integrated', null, 'Intel');   // UHD, Iris (Xe), HD, "Arc(TM) Graphics" (the iGPU)
  }

  // ---- Qualcomm / ARM / Imagination: phones, tablets and the Snapdragon X iGPU ----
  if (/adreno|mali|powervr|immortalis|videocore/i.test(name)) return out('integrated', null, /adreno/i.test(name) ? 'Qualcomm' : 'ARM');
  return out('unknown', null, 'unknown');
}

// ---- phones and tablets ---------------------------------------------------------------------------
//
// A phone's browser tab gets a small fraction of a desktop's memory (iOS kills a WebKit tab at a few
// hundred MB to ~1.5 GB, and WebGL textures count against it), so phones and tablets start on 'low'
// and the renderer runs them on the phone profile (render3d/tier.js setPhoneProfile: capped pixel
// ratio, no MSAA, small texture sets) whatever tier the player picks.

/** Shortest side (CSS px) of a touch-first screen that still counts as a phone or tablet. */
export const MOBILE_SHORT_SIDE = 1100;

/**
 * Is this a phone or tablet? Pure: every input is passed in (mobileEnv() reads them in a browser).
 * iOS / iPadOS (an iPad in desktop mode claims to be a Mac: a "Macintosh" with several touch points),
 * Android and other mobile user agents, a touch-first (coarse pointer) small screen, and Safari's
 * "Apple GPU" on a touch device all count. Desktop browsers (also Safari on a Mac: no touch) do not.
 * @param {{ ua?: string, platform?: string, maxTouchPoints?: number, coarse?: boolean, screenW?: number, screenH?: number, gpu?: string }} e
 * @returns {{ mobile: boolean, ios: boolean, reason: string }}
 */
export function detectMobile(e = {}) {
  const ua = String(e.ua || '');
  const tp = Number(e.maxTouchPoints) || 0;
  const mac = /Macintosh|MacIntel/i.test(ua) || /^MacIntel$/i.test(String(e.platform || ''));
  const ios = /\b(iPhone|iPad|iPod)\b/i.test(ua) || /^(iPhone|iPad|iPod)/i.test(String(e.platform || '')) || (mac && tp > 1);
  if (ios) return { mobile: true, ios: true, reason: 'ios' };
  if (/Android|Mobi|Silk|Kindle|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return { mobile: true, ios: false, reason: 'ua' };
  const sw = Number(e.screenW) || 0, sh = Number(e.screenH) || 0;
  const short = sw > 0 && sh > 0 ? Math.min(sw, sh) : Infinity;
  if (e.coarse && short <= MOBILE_SHORT_SIDE) return { mobile: true, ios: false, reason: 'touch' };
  if (tp > 1 && /^Apple GPU$/i.test(String(e.gpu || '').trim())) return { mobile: true, ios: true, reason: 'apple-gpu' };
  return { mobile: false, ios: false, reason: '' };
}

/** detectMobile's inputs read from this browser (screen size in CSS px; gpu = the probed renderer string). */
export function mobileEnv(gpu = '') {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const nav = g.navigator || {};
  let coarse = false;
  try { coarse = !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches); } catch { coarse = false; }
  const scr = g.screen || {};
  return { ua: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0, coarse, screenW: scr.width || 0, screenH: scr.height || 0, gpu };
}

let mobileCached = null;
/**
 * This browser: a phone or tablet? `?mobile=1` / `?mobile=0` in the page address forces it (tests,
 * screenshots). Cached; resetGpuProbe() forgets it.
 */
export function isMobileDevice() {
  if (mobileCached) return mobileCached.mobile;
  let force = null;
  try {
    const m = /[?&]mobile=([01])\b/.exec((globalThis.location && globalThis.location.search) || '');
    if (m) force = m[1] === '1';
  } catch { force = null; }
  mobileCached = force !== null ? { mobile: force, ios: false, reason: 'forced' } : detectMobile(mobileEnv(cached ? cached.raw : ''));
  return mobileCached.mobile;
}

/**
 * The graphics tier to start a first-time profile on, or null for "keep the existing default".
 * Phones and tablets get 'low' (their tab's memory, see detectMobile); other touch devices are never
 * raised; desktops get the table's recommendation.
 * @param {{ tier: 'cinematic'|'ultra'|null }} info classifyGpu() result
 * @param {{ coarse?: boolean, mobile?: boolean }} [o] coarse: a touch device: never raised; mobile: a phone or tablet: 'low'
 * @returns {'cinematic'|'ultra'|'low'|null}
 */
export function recommendedTier(info, o = {}) {
  if (o.mobile) return 'low';
  if (!info || o.coarse) return null;
  return info.tier === 'cinematic' || info.tier === 'ultra' ? info.tier : null;
}

/** "NVIDIA GeForce RTX 4070 Ti SUPER — Cinematic recommended" (or just the name when nothing is recommended). */
export function gpuLabel(info, o = {}) {
  if (!info || !info.name) return '';
  const rec = recommendedTier(info, o);
  const label = rec === 'cinematic' ? 'Cinematic' : rec === 'ultra' ? 'Ultra' : rec === 'low' ? 'Low' : '';
  if (o.mobile) {
    return o.quality && o.quality !== 'low'
      ? `${info.name} — phone or tablet: presets above Low use much more memory and may make the browser reload the page`
      : `${info.name} — phone or tablet: Low recommended`;
  }
  if (info.class === 'software') return `${info.name} — software rendering (no graphics card): the Low preset fits best`;
  return label ? `${info.name} — ${label} recommended` : info.name;
}

let cached = null;

/**
 * Read the GPU of this browser once (a WebGL context is created and released at once).
 * @returns {{ raw: string, name: string, vendor: string, class: string, tier: string|null, software: boolean, webgl: boolean }}
 */
export function probeGpu() {
  if (cached) return cached;
  let raw = '', webgl = false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      webgl = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      raw = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch {
    raw = '';
  }
  const info = classifyGpu(raw);
  cached = { raw, ...info, software: !webgl || info.class === 'software', webgl };
  // (the renderer string can now take part in the phone check)
  if (mobileCached && mobileCached.reason !== 'forced') mobileCached = null;
  cached.mobile = isMobileDevice();
  return cached;
}

/** Test hook: forget the cached probe. */
export function resetGpuProbe() {
  cached = null;
  mobileCached = null;
}
