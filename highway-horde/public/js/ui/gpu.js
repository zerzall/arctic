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

/**
 * The graphics tier to start a first-time profile on, or null for "keep the existing default".
 * @param {{ tier: 'cinematic'|'ultra'|null }} info classifyGpu() result
 * @param {{ coarse?: boolean }} [o] coarse: a phone or tablet (touch): never raised
 * @returns {'cinematic'|'ultra'|null}
 */
export function recommendedTier(info, o = {}) {
  if (!info || o.coarse) return null;
  return info.tier === 'cinematic' || info.tier === 'ultra' ? info.tier : null;
}

/** "NVIDIA GeForce RTX 4070 Ti SUPER — Cinematic recommended" (or just the name when nothing is recommended). */
export function gpuLabel(info, o = {}) {
  if (!info || !info.name) return '';
  const rec = recommendedTier(info, o);
  const label = rec === 'cinematic' ? 'Cinematic' : rec === 'ultra' ? 'Ultra' : '';
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
  return cached;
}

/** Test hook: forget the cached probe. */
export function resetGpuProbe() {
  cached = null;
}
