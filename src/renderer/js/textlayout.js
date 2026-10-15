/**
 * Text box layout.
 *
 * The on-screen preview and the written PDF must break lines in exactly the same
 * places, otherwise a text box looks right in the editor and wrong in the file.
 * Both call this module, and both hand it a real pdf-lib font, so the width
 * measurements are identical rather than merely similar.
 */

/** Ascent used to place the first baseline. Shared so preview == output. */
export const ASCENT_RATIO = 0.75;
/** Multiple of the font size used as line spacing. */
export const LINE_HEIGHT_RATIO = 1.2;
/** Inset between the text box border and the text itself, in points. */
export const TEXT_PADDING = 3;

const WINANSI_FIXUPS = new Map(
  Object.entries({
    '‘': "'",
    '’': "'",
    '‚': ',',
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '-',
    '…': '...',
    ' ': ' ',
    '•': '-',
    '−': '-',
    '­': '-',
    '\t': '    ',
  })
);

/**
 * The 14 standard fonts are WinAnsi-encoded, so anything outside that repertoire
 * would make pdf-lib throw while saving. Normalise what we can and replace the
 * rest, reporting how many characters were substituted so the UI can say so.
 *
 * @returns {{text: string, dropped: number}}
 */
export function sanitizeForStandardFont(input) {
  let dropped = 0;
  let out = '';
  for (const ch of String(input ?? '')) {
    if (ch === '\n' || ch === '\r') {
      out += ch;
      continue;
    }
    const fix = WINANSI_FIXUPS.get(ch);
    if (fix !== undefined) {
      out += fix;
      continue;
    }
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else {
      out += '?';
      dropped += 1;
    }
  }
  return { text: out, dropped };
}

/**
 * Break `text` into display lines.
 *
 * @param {string} text
 * @param {{widthOfTextAtSize:(t:string,s:number)=>number}} font pdf-lib font
 * @param {number} size
 * @param {number} maxWidth available width in points; <= 0 disables wrapping
 * @returns {string[]}
 */
export function wrapLines(text, font, size, maxWidth) {
  const paragraphs = String(text ?? '').split(/\r?\n/);
  if (!(maxWidth > 0)) return paragraphs;

  const width = (s) => {
    try {
      return font.widthOfTextAtSize(s, size);
    } catch {
      // A character the font cannot measure should not take the whole layout
      // down; fall back to a rough average advance width.
      return s.length * size * 0.5;
    }
  };

  const lines = [];
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    // Keep the trailing spaces attached to each word so widths stay honest.
    const words = para.match(/\S+\s*/g) || [para];
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (current && width(candidate.trimEnd()) > maxWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
      // A single word longer than the box still has to go somewhere: split it.
      while (width(current.trimEnd()) > maxWidth && current.trim().length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && width(current.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

/**
 * Full layout for a text annotation: the wrapped lines plus the view-space
 * baseline position of each one.
 *
 * @returns {{lines:string[], lineHeight:number, baselines:number[], startX:number}}
 */
export function layoutTextAnnot(annot, font) {
  const size = annot.fontSize || 12;
  const lineHeight = size * LINE_HEIGHT_RATIO;
  // Replaced text keeps the shape of the line it stands in for, so it grows
  // sideways rather than reflowing into a paragraph.
  const maxWidth = annot.nowrap ? 0 : (annot.w || 0) - TEXT_PADDING * 2;
  const { text } = sanitizeForStandardFont(annot.text || '');
  const lines = wrapLines(text, font, size, maxWidth);
  const baselines = lines.map(
    (_l, i) => annot.y + TEXT_PADDING + size * ASCENT_RATIO + i * lineHeight
  );
  return { lines, lineHeight, baselines, startX: annot.x + TEXT_PADDING, size };
}

/**
 * X position of a line given the box alignment.
 */
export function alignedX(annot, font, line, size) {
  const align = annot.align || 'left';
  if (align === 'left') return annot.x + TEXT_PADDING;
  let w;
  try {
    w = font.widthOfTextAtSize(line, size);
  } catch {
    w = line.length * size * 0.5;
  }
  const inner = (annot.w || 0) - TEXT_PADDING * 2;
  if (align === 'center') return annot.x + TEXT_PADDING + Math.max(0, (inner - w) / 2);
  return annot.x + TEXT_PADDING + Math.max(0, inner - w);
}

/** Height a text box needs to show all of its content. */
export function measuredHeight(annot, font) {
  const { lines, lineHeight } = layoutTextAnnot(annot, font);
  return lines.length * lineHeight + TEXT_PADDING * 2;
}
