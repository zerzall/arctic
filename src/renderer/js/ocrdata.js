/**
 * Shaping OCR results, kept apart from the engine that produces them.
 *
 * Tesseract's browser bundle cannot be loaded outside a browser, so everything
 * here is deliberately free of it: the geometry and filtering can then be
 * tested directly, which is where the mistakes actually live.
 */

/**
 * Words below this confidence are usually speckle on a scan. Writing them into
 * the text layer is worse than dropping them, because a search then succeeds on
 * a word that is not on the page.
 */
export const MIN_CONFIDENCE = 40;

/** Pixel box from the recogniser -> view-space box, in points. */
export function boxToView(bbox, scale) {
  return {
    x: bbox.x0 / scale,
    y: bbox.y0 / scale,
    w: (bbox.x1 - bbox.x0) / scale,
    h: (bbox.y1 - bbox.y0) / scale,
  };
}

/** Keep the words worth writing down. */
export function usableWords(words, minConfidence = MIN_CONFIDENCE) {
  return words.filter(
    (w) =>
      w &&
      typeof w.text === 'string' &&
      w.text.trim() &&
      w.w > 0 &&
      w.h > 0 &&
      (w.confidence ?? 100) >= minConfidence
  );
}

/**
 * Turn recognised words into the item shape `groupRuns` expects, so OCR text
 * flows through exactly the same editing path as text that was already in the
 * file.
 */
export function wordsAsItems(words) {
  return words.map((w, index) => ({
    str: w.text,
    // Deliberately absent: a recognised word cannot be traced to a drawing
    // operator, because on a scan there is none - it is a picture.
    srcIndex: undefined,
    x: w.x,
    y: w.y + w.h, // baseline, near the bottom of the box
    width: w.w,
    size: w.h,
    angle: 0,
    fontKey: 'ocr',
    ocrIndex: index,
  }));
}
