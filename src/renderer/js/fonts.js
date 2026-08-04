/**
 * A scratch pdf-lib document whose only job is to hand out embedded standard
 * fonts. The on-screen text layout measures with the very same font objects the
 * writer uses, so a text box wraps identically in the editor and in the file.
 */
import { PDFDocument, StandardFonts } from '../vendor/pdf-lib.esm.min.js';
import { standardFontFor } from './export.js';

const table = new Map();

export async function initFonts() {
  const doc = await PDFDocument.create();
  for (const name of Object.values(StandardFonts)) {
    if (/Symbol|ZapfDingbats/.test(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    table.set(name, await doc.embedFont(name));
  }
}

/** Synchronous lookup, safe once initFonts() has resolved. */
export function fontFor(family, bold, italic) {
  return (
    table.get(standardFontFor(family, bold, italic)) || table.get(StandardFonts.Helvetica)
  );
}

/** The CSS font stack that matches a standard font most closely on Windows. */
export function cssFontStack(family) {
  switch (family) {
    case 'Times':
      return '"Times New Roman", Times, serif';
    case 'Courier':
      return '"Courier New", Courier, monospace';
    default:
      return 'Arial, Helvetica, sans-serif';
  }
}

export function cssFont(annot) {
  const parts = [];
  if (annot.italic) parts.push('italic');
  if (annot.bold) parts.push('bold');
  parts.push(`${annot.fontSize || 12}px`);
  parts.push(cssFontStack(annot.font || 'Helvetica'));
  return parts.join(' ');
}
