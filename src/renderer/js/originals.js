/**
 * Planning the removal of a document's own text.
 *
 * Deleting text means editing the page's content stream, and matching what the
 * reader sees to what the stream draws. That matching needs pdf.js, which only
 * exists in the editor - so the plan is made here, at the moment of the edit,
 * and reduced to a list of operation ordinals that the writer can act on later
 * without a text reader.
 */
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';
import { readPageContent, imageXObjectNames } from './pagestream.js';
import {
  planDeletion,
  tokenize,
  operations,
  imagePlacements,
  placementBounds,
  imageFingerprint,
  isAxisAligned,
} from './contentstream.js';

/** One pdf-lib document per source, loaded lazily and only for reading. */
const docCache = new Map();

export async function sourceDoc(key, bytes) {
  if (docCache.has(key)) return docCache.get(key);
  const promise = PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  }).catch(() => null);
  docCache.set(key, promise);
  return promise;
}

export function clearSourceDocs() {
  docCache.clear();
}

/**
 * Can the original of this run be removed from the file, and if so, how?
 *
 * @param {string} srcKey        which source document the page belongs to
 * @param {Uint8Array} srcBytes  that document's bytes
 * @param {number} pageIndex     page within that document
 * @param {Array} items          the reader's text items for the page, in order
 * @param {number[]} itemIndices which items make up the run being replaced
 * @returns {Promise<{ok:boolean, reason?:string, ordinals?:number[], fingerprint?:string}>}
 */
export async function planRemoval(srcKey, srcBytes, pageIndex, items, itemIndices) {
  if (!itemIndices || !itemIndices.length) {
    return { ok: false, reason: 'the line could not be traced back to the file' };
  }

  const doc = await sourceDoc(srcKey, srcBytes);
  if (!doc) return { ok: false, reason: 'the document could not be reopened for editing' };

  let page;
  try {
    page = doc.getPage(pageIndex);
  } catch {
    return { ok: false, reason: 'the page could not be reopened for editing' };
  }

  const content = readPageContent(doc, page);
  if (!content) return { ok: false, reason: "the page's drawing instructions could not be read" };

  return planDeletion(content, items, itemIndices);
}

/**
 * Every picture the page draws, with where it sits in PDF user space.
 *
 * @returns {Promise<{placements:Array, fingerprint:string}>}
 */
export async function findImages(srcKey, srcBytes, pageIndex) {
  const empty = { placements: [], fingerprint: '' };
  const doc = await sourceDoc(srcKey, srcBytes);
  if (!doc) return empty;

  let page;
  try {
    page = doc.getPage(pageIndex);
  } catch {
    return empty;
  }

  const content = readPageContent(doc, page);
  if (!content) return empty;

  const names = imageXObjectNames(doc, page);
  if (!names.size) return empty;

  const placements = imagePlacements(operations(tokenize(content)), (n) => names.has(n));
  return {
    fingerprint: imageFingerprint(placements),
    placements: placements.map((p) => ({
      ordinal: p.ordinal,
      name: p.name,
      matrix: p.matrix,
      bounds: placementBounds(p.matrix),
      // A rotated or skewed picture can be moved, but scaling it along the
      // screen axes would shear it, so the editor only offers moving.
      axisAligned: isAxisAligned(p.matrix),
    })),
  };
}
