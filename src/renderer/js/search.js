/**
 * Full-document text search.
 *
 * Text is pulled with pdf.js and mapped into the same view space the overlay
 * draws in, so hits can be highlighted directly on the page canvas.
 */
import { state, pages } from './model.js';
import { Util } from '../vendor/pdf.min.mjs';

const cache = new Map(); // `${src}:${index}:${rotate}` -> {text, boxes}

export function clearCache() {
  cache.clear();
}

async function pageText(spec) {
  const key = `${spec.src}:${spec.index}:${spec.rotate}`;
  if (cache.has(key)) return cache.get(key);

  const empty = { text: '', boxes: [] };
  if (!spec.src) return empty;
  const source = state.doc.sources[spec.src];
  if (!source) return empty;

  const pdfPage = await source.pdfjs.getPage(spec.index + 1);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: spec.rotate });
  const content = await pdfPage.getTextContent();

  let text = '';
  const boxes = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    if (item.str.length) {
      const tx = Util.transform(viewport.transform, item.transform);
      const angle = Math.atan2(tx[1], tx[0]);
      const height = Math.hypot(tx[2], tx[3]) || 10;
      boxes.push({
        start: text.length,
        length: item.str.length,
        x: tx[4],
        y: tx[5],
        width: item.width || 0,
        height,
        angle,
      });
      text += item.str;
    }
    if (item.hasEOL) text += '\n';
  }

  const entry = { text, boxes };
  cache.set(key, entry);
  return entry;
}

/**
 * Convert a character range inside an item to an axis-aligned view-space rect.
 * Text runs are almost always horizontal once the page rotation is applied; for
 * anything else we fall back to the bounding box of the rotated rectangle.
 */
function rectFor(box, from, to) {
  const frac = box.length ? (from - box.start) / box.length : 0;
  const spanFrac = box.length ? (to - from) / box.length : 1;
  const along = box.width * frac;
  const width = Math.max(1, box.width * spanFrac);
  const h = box.height;

  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const ox = box.x + along * cos;
  const oy = box.y + along * sin;

  // Corners of the (possibly rotated) run, measured from the baseline.
  const corners = [
    [0, 0],
    [width, 0],
    [0, -h],
    [width, -h],
  ].map(([dx, dy]) => [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos]);

  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * @returns {Promise<Array<{page:number, rect:{x,y,w,h}, snippet:string}>>}
 */
export async function findAll(query, { matchCase = false, wholeWord = false } = {}) {
  const results = [];
  if (!state.doc || !query) return results;

  const needle = matchCase ? query : query.toLowerCase();
  const specs = pages();

  for (let slot = 0; slot < specs.length; slot += 1) {
    const spec = specs[slot];
    // eslint-disable-next-line no-await-in-loop
    const { text, boxes } = await pageText(spec);
    if (!text) continue;
    const hay = matchCase ? text : text.toLowerCase();

    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      from = at + Math.max(1, needle.length);

      if (wholeWord) {
        const before = hay[at - 1];
        const after = hay[at + needle.length];
        const isWord = (c) => c && /[\wÀ-ɏ]/.test(c);
        if (isWord(before) || isWord(after)) continue;
      }

      const end = at + needle.length;
      // A match can straddle items; emit one rect per item it touches.
      for (const box of boxes) {
        const bEnd = box.start + box.length;
        if (bEnd <= at || box.start >= end) continue;
        results.push({
          page: slot,
          rect: rectFor(box, Math.max(at, box.start), Math.min(end, bEnd)),
          snippet: text.slice(Math.max(0, at - 30), end + 30).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return results;
}

/** Group results by page for the overlay. */
export function groupByPage(results) {
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.page)) map.set(r.page, []);
    map.get(r.page).push(r.rect);
  }
  return map;
}

/** Plain text of the whole document, used by "copy page text". */
export async function textOfPage(slot) {
  const spec = pages()[slot];
  if (!spec) return '';
  const { text } = await pageText(spec);
  return text;
}
