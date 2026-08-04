/**
 * Reading and rewriting the raw content stream of a page with pdf-lib.
 *
 * pdf-lib models pages well but gives no way to edit what is drawn on them, so
 * this reaches down to the objects underneath: decode the stream (or streams -
 * a page may have several, which readers treat as one), and put a single
 * replacement back when we are done.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from '../vendor/pdf-lib.esm.min.js';

/** Every content stream of a page, resolved to objects. */
function contentStreamsOf(doc, page) {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFArray) {
    return contents
      .asArray()
      .map((ref) => doc.context.lookup(ref))
      .filter(Boolean);
  }
  return [contents];
}

function decodeOne(stream) {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  if (typeof stream.getContents === 'function') return stream.getContents();
  return null;
}

/**
 * The page's drawing instructions as one decoded byte string.
 *
 * Multiple streams are joined with newlines, exactly as a reader concatenates
 * them, so byte offsets computed here line up with what a reader sees.
 *
 * @returns {Uint8Array|null} null when nothing could be decoded
 */
export function readPageContent(doc, page) {
  const streams = contentStreamsOf(doc, page);
  if (!streams.length) return null;

  const parts = [];
  for (const stream of streams) {
    let bytes;
    try {
      bytes = decodeOne(stream);
    } catch {
      return null; // an encoding we cannot read: leave the page alone
    }
    if (!bytes) return null;
    parts.push(bytes);
  }

  if (parts.length === 1) return parts[0];

  let total = 0;
  for (const p of parts) total += p.length + 1;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    out[at] = 0x0a;
    at += 1;
  }
  return out;
}

/**
 * Replace everything the page draws with `bytes`.
 *
 * The replacement is written uncompressed: it is a little larger on disk, but
 * it keeps this operation free of any dependency on how the original was
 * encoded, and PDF writers are free to re-compress later.
 */
/**
 * The names a page's content stream uses for image XObjects.
 *
 * `Do` draws both images and form XObjects, and only the former can be moved as
 * a picture - a form is a nested content stream, which is a different problem.
 *
 * @returns {Set<string>}
 */
export function imageXObjectNames(doc, page) {
  const names = new Set();
  let resources;
  try {
    resources = page.node.Resources();
  } catch {
    return names;
  }
  if (!resources) return names;

  const xobjects = resources.lookup(PDFName.of('XObject'));
  if (!xobjects || typeof xobjects.entries !== 'function') return names;

  for (const [key, value] of xobjects.entries()) {
    try {
      const target = doc.context.lookup(value);
      const dict = target instanceof PDFDict ? target : target && target.dict;
      if (!dict) continue;
      const subtype = dict.lookup(PDFName.of('Subtype'));
      if (subtype && subtype.asString && subtype.asString() === '/Image') {
        names.add(key.asString().replace(/^\//, ''));
      }
    } catch {
      /* an entry we cannot resolve is simply not offered for moving */
    }
  }
  return names;
}

export function writePageContent(doc, page, bytes) {
  const stream = doc.context.stream(bytes);
  const ref = doc.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}
