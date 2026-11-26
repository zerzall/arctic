// The first-person crosshair (SPEC §7.5): four lines around a gap, an optional centre dot and
// a dark outline, in one of a few colours, each part sized in the settings (Settings →
// Controls → Crosshair). 'dynamic' opens the gap with the gun's inaccuracy (moving, jumping,
// firing) and the part of the spray the view doesn't show; 'static' keeps it fixed. Pure
// canvas drawing: the 3D overlay draws it every frame, the settings dialog draws a preview.

/** Colour choices (id → CSS colour). */
export const XH_COLORS = Object.freeze({
  green: '#4cf04c', yellow: '#f5e642', cyan: '#46e6f0', white: '#ffffff', pink: '#ff6ad5', red: '#ff4b4b',
});
export const XH_STYLES = ['dynamic', 'static'];

/** Defaults and ranges of the crosshair settings (prefs.settings keys). */
export const XH_DEFAULTS = Object.freeze({
  xhStyle: 'dynamic', xhColor: 'green', xhSize: 5, xhThick: 1.5, xhGap: 1, xhDot: false, xhOutline: true, xhAlpha: 0.9,
});
export const XH_RANGES = Object.freeze({
  xhSize: [1, 14], xhThick: [0.5, 4], xhGap: [-3, 10], xhAlpha: [0.3, 1],
});

function num(v, [lo, hi], d) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

/** The crosshair fields of a settings object, validated (garbage → the default). */
export function crosshairSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    xhStyle: XH_STYLES.includes(o.xhStyle) ? o.xhStyle : XH_DEFAULTS.xhStyle,
    xhColor: Object.prototype.hasOwnProperty.call(XH_COLORS, o.xhColor) ? o.xhColor : XH_DEFAULTS.xhColor,
    xhSize: Math.round(num(o.xhSize, XH_RANGES.xhSize, XH_DEFAULTS.xhSize) * 10) / 10,
    xhThick: Math.round(num(o.xhThick, XH_RANGES.xhThick, XH_DEFAULTS.xhThick) * 10) / 10,
    xhGap: Math.round(num(o.xhGap, XH_RANGES.xhGap, XH_DEFAULTS.xhGap) * 10) / 10,
    xhDot: typeof o.xhDot === 'boolean' ? o.xhDot : XH_DEFAULTS.xhDot,
    xhOutline: typeof o.xhOutline === 'boolean' ? o.xhOutline : XH_DEFAULTS.xhOutline,
    xhAlpha: Math.round(num(o.xhAlpha, XH_RANGES.xhAlpha, XH_DEFAULTS.xhAlpha) * 100) / 100,
  };
}

/** The gap (CSS px before the UI scale) with nothing opening it: 4 px + the setting. */
export function baseGap(o) {
  return Math.max(0, 4 + (o.xhGap || 0));
}

/**
 * The gap of a dynamic crosshair (CSS px, UI scale included): the base gap plus the
 * inaccuracy cone's radius on screen (`inaccPx`, already in px) plus a share of the spray the
 * camera doesn't show (`sprayPx`), capped at `maxPx`.
 */
export function dynamicGap(o, ui, inaccPx, sprayPx, maxPx) {
  const g = baseGap(o) * ui;
  if (o.xhStyle !== 'dynamic') return g;
  return Math.min(maxPx, g + (Math.max(0, inaccPx) * 0.9 + Math.max(0, sprayPx) * 0.5) * BLOOM_GAIN);
}

/**
 * How much louder than the true cone the dynamic gap grows. Even a pistol's small moving
 * penalty (about 5x its standing cone) must be plainly visible in the first magazine, so the
 * crosshair exaggerates the cone; the relative sizes between guns and states are unchanged.
 */
export const BLOOM_GAIN = 2.2;
/** Open / close speeds (1/s) of the smoothed gap: it blooms almost at once and settles back more slowly. */
const BLOOM_OPEN = 28;
const BLOOM_CLOSE = 7;

/**
 * Move the displayed gap toward `target` over `dt` seconds: fast out (the penalty is felt the moment
 * you move, jump or fire), slower back (the bloom lingers a beat, so a tap-fire rhythm reads).
 * @returns {number} the new displayed gap
 */
export function easeBloom(prev, target, dt) {
  if (!Number.isFinite(prev)) return target;
  const k = 1 - Math.exp(-(target > prev ? BLOOM_OPEN : BLOOM_CLOSE) * Math.max(0, dt));
  return prev + (target - prev) * k;
}

/**
 * Draw the crosshair centred on (cx, cy).
 * @param {CanvasRenderingContext2D} g
 * @param {object} o crosshairSettings()
 * @param {number} gap the gap in CSS px (dynamicGap)
 * @param {number} ui UI scale
 * @param {object} [extra] { alpha (× the setting), top (false: no top line, e.g. snipers) }
 */
export function drawCrosshair(g, cx, cy, o, gap, ui, extra = {}) {
  const color = XH_COLORS[o.xhColor] || XH_COLORS.green;
  const len = o.xhSize * ui;
  const th = Math.max(0.5, o.xhThick * ui);
  const ol = o.xhOutline ? Math.max(1, ui) : 0;
  const a = o.xhAlpha * (extra.alpha === undefined ? 1 : extra.alpha);
  if (!(a > 0.01)) return;
  // snap to the pixel grid so 1 px lines stay crisp
  const sx = Math.round(cx), sy = Math.round(cy);
  const off = (th % 2) / 2 > 0.24 ? 0.5 : 0;
  const rects = [];
  if (len > 0) {
    rects.push([sx - gap - len, sy - th / 2, len, th]);      // left
    rects.push([sx + gap, sy - th / 2, len, th]);            // right
    rects.push([sx - th / 2, sy + gap, th, len]);            // bottom
    if (extra.top !== false) rects.push([sx - th / 2, sy - gap - len, th, len]);
  }
  if (o.xhDot) rects.push([sx - th / 2, sy - th / 2, th, th]);
  g.save();
  g.globalAlpha = a;
  if (ol > 0) {
    g.fillStyle = 'rgba(0,0,0,0.85)';
    for (const [x, y, w, h] of rects) g.fillRect(x - ol + off, y - ol + off, w + ol * 2, h + ol * 2);
  }
  g.fillStyle = color;
  for (const [x, y, w, h] of rects) g.fillRect(x + off, y + off, w, h);
  g.restore();
}
