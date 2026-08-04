/**
 * Recognising the text that is already on a page, so it can be edited.
 *
 * pdf.js hands back one item per show-text operator, which is rarely a useful
 * editing unit - a single sentence can arrive as a dozen items. This module
 * stitches those items back into lines, works out which of the built-in PDF
 * fonts each line is closest to, and computes where a replacement text box has
 * to sit so its baseline lands exactly on the original one.
 *
 * The grouping and mapping are pure functions, so the test suite can pin them
 * down without a browser.
 */
import { ASCENT_RATIO, TEXT_PADDING } from './textlayout.js';

/**
 * Pick the closest of the 14 built-in PDF fonts for an embedded font.
 *
 * @param {string} rawName  e.g. "ABCDEF+TimesNewRomanPS-BoldItalicMT"
 * @param {string} [family] pdf.js's generic family: serif / sans-serif / monospace
 */
export function mapToStandardFont(rawName, family) {
  const name = String(rawName || '').replace(/^[A-Z]{6}\+/, '');
  const lower = name.toLowerCase();

  const bold = /bold|black|heavy|semibold|demibold|-bd\b|,bold/.test(lower);
  const italic = /italic|oblique|-it\b|,italic/.test(lower);

  let font;
  if (/courier|mono|consol/.test(lower)) font = 'Courier';
  else if (/times|serif|georgia|garamond|book|roman|minion|cambria/.test(lower) && !/sans/.test(lower)) {
    font = 'Times';
  } else if (/helvetica|arial|sans|calibri|verdana|tahoma|segoe|roboto|open/.test(lower)) {
    font = 'Helvetica';
  } else if (family === 'monospace') font = 'Courier';
  else if (family === 'serif') font = 'Times';
  else font = 'Helvetica';

  return { font, bold, italic };
}

/**
 * A text box draws its first baseline at `y + padding + size * ascentRatio`.
 * Invert that so a replacement lands on the baseline it is replacing.
 */
export function annotYForBaseline(baselineY, fontSize) {
  return baselineY - TEXT_PADDING - fontSize * ASCENT_RATIO;
}

/** The inverse, used when a run's box is resized. */
export function baselineForAnnotY(y, fontSize) {
  return y + TEXT_PADDING + fontSize * ASCENT_RATIO;
}

/**
 * Merge pdf.js text items into editable lines.
 *
 * Items join a run when they share a baseline, a font and a size, and sit close
 * enough horizontally that they are visibly the same line of text. A wider gap
 * starts a new run, so columns in a table stay separately editable instead of
 * being welded into one unusable line.
 *
 * @param {Array<{str:string, x:number, y:number, width:number, size:number,
 *                angle:number, fontKey:string, ascent?:number}>} items
 *        Positions are in view space (top-left origin), `y` is the baseline.
 * @returns {Array<object>} runs
 */
export function groupRuns(items) {
  const usable = items.filter((it) => it.str && it.str.trim() && Math.abs(it.angle) < 0.02);
  usable.sort((a, b) => a.y - b.y || a.x - b.x);

  const runs = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (current.text.trim()) runs.push(finalizeRun(current));
    current = null;
  };

  for (const it of usable) {
    if (current && joins(current, it)) {
      const gap = it.x - (current.x + current.width);
      // A visible gap between two items is a space that was never in the string.
      const needsSpace =
        gap > current.size * 0.16 &&
        !/\s$/.test(current.text) &&
        !/^\s/.test(it.str);
      current.text += (needsSpace ? ' ' : '') + it.str;
      current.width = it.x + it.width - current.x;
      current.items.push(it);
    } else {
      flush();
      current = {
        x: it.x,
        baseline: it.y,
        width: it.width,
        size: it.size,
        angle: it.angle,
        fontKey: it.fontKey,
        ascent: it.ascent,
        text: it.str,
        items: [it],
      };
    }
  }
  flush();
  return runs;
}

function joins(run, it) {
  if (it.fontKey !== run.fontKey) return false;
  if (Math.abs(it.size - run.size) > Math.max(0.4, run.size * 0.06)) return false;
  if (Math.abs(it.y - run.baseline) > run.size * 0.3) return false;
  const gap = it.x - (run.x + run.width);
  // Overlapping (kerning games) or a gap smaller than roughly one space.
  return gap > -run.size * 0.6 && gap < run.size * 0.9;
}

function finalizeRun(run) {
  const ascent = run.ascent && run.ascent > 0 ? run.ascent : ASCENT_RATIO;
  const descent = 0.22;
  return {
    text: run.text,
    x: run.x,
    y: run.baseline - ascent * run.size,
    w: run.width,
    h: (ascent + descent) * run.size,
    baseline: run.baseline,
    size: run.size,
    fontKey: run.fontKey,
    itemCount: run.items.length,
  };
}

/**
 * Build the two annotations that replace a run: an opaque patch over the
 * original glyphs, and an editable text box on the baseline they sat on.
 *
 * The original text is *covered*, not deleted - see the note in the README.
 *
 * @param {object} run          from groupRuns()
 * @param {object} style        {font, bold, italic} from mapToStandardFont()
 * @param {{text:string, background:string}} colors sampled from the page
 * @param {string} pairId       links the two so they delete together
 */
export function buildReplacement(run, style, colors, pairId) {
  // A little bleed stops anti-aliased edges of the original glyphs surviving
  // around the patch.
  const bleed = Math.max(0.6, run.size * 0.08);

  const cover = {
    type: 'cover',
    pairId,
    x: run.x - bleed,
    y: run.y - bleed,
    w: run.w + bleed * 2,
    h: run.h + bleed * 2,
    fill: colors.background,
    lineWidth: 0,
    opacity: 1,
  };

  const text = {
    type: 'text',
    pairId,
    replaced: true,
    // No wrapping: a replaced line keeps its shape as it is retyped, and grows
    // to the right rather than reflowing into a paragraph.
    nowrap: true,
    x: run.x - TEXT_PADDING,
    y: annotYForBaseline(run.baseline, run.size),
    w: Math.max(run.w + TEXT_PADDING * 2, 24),
    h: run.size * 1.2 + TEXT_PADDING * 2,
    text: run.text,
    fontSize: run.size,
    font: style.font,
    bold: style.bold,
    italic: style.italic,
    color: colors.text,
    align: 'left',
    opacity: 1,
    // Resizing the box should not rescale the glyphs of replaced text.
    scaleFont: false,
  };

  return { cover, text };
}

/**
 * Choose a fill for the patch and an ink colour for the replacement from pixels
 * sampled around and inside the original run.
 *
 * The background is the most common colour in a ring just outside the glyphs;
 * the ink is the pixel furthest from that background. Sampling beats assuming
 * black-on-white, which is wrong on every coloured or scanned page.
 *
 * @param {ImageData} inside    pixels of the run's box
 * @param {ImageData} ring      pixels of a band around the run's box
 */
export function pickColors(inside, ring) {
  const background = dominantColor(ring) || { r: 255, g: 255, b: 255 };
  const text = farthestColor(inside, background) || { r: 17, g: 17, b: 17 };
  return { background: toHex(background), text: toHex(text) };
}

function dominantColor(image) {
  if (!image || !image.data.length) return null;
  const counts = new Map();
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    // Quantise so near-identical pixels count as the same colour.
    const key =
      ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const entry = counts.get(key);
    if (entry) {
      entry.n += 1;
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
    } else {
      counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  let best = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best) return null;
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

function farthestColor(image, from) {
  if (!image || !image.data.length) return null;
  const { data } = image;
  let best = null;
  let bestDist = -1;
  // Average the darkest tail rather than taking one pixel, so anti-aliasing
  // does not pick a colour no glyph actually uses.
  const candidates = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const d =
      (data[i] - from.r) ** 2 + (data[i + 1] - from.g) ** 2 + (data[i + 2] - from.b) ** 2;
    candidates.push({ d, r: data[i], g: data[i + 1], b: data[i + 2] });
    if (d > bestDist) {
      bestDist = d;
      best = { r: data[i], g: data[i + 1], b: data[i + 2] };
    }
  }
  if (!best) return null;
  candidates.sort((a, b) => b.d - a.d);
  const top = candidates.slice(0, Math.max(1, Math.floor(candidates.length * 0.08)));
  const near = top.filter((c) => c.d > bestDist * 0.55);
  const use = near.length ? near : top;
  return {
    r: Math.round(use.reduce((s, c) => s + c.r, 0) / use.length),
    g: Math.round(use.reduce((s, c) => s + c.g, 0) / use.length),
    b: Math.round(use.reduce((s, c) => s + c.b, 0) / use.length),
  };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Is this point inside a run's box? */
export function runAt(runs, x, y) {
  for (const run of runs) {
    if (x >= run.x && x <= run.x + run.w && y >= run.y && y <= run.y + run.h) return run;
  }
  return null;
}
