/**
 * Content-stream surgery: genuinely removing text from a page.
 *
 * Covering old text with a patch is not editing it - the words stay in the file
 * and any other program can still read them. To actually delete text we have to
 * go into the page's content stream and take out the operators that draw it.
 *
 * pdf-lib has no parser for this, so this module is one: a tokeniser for the
 * PostScript-like syntax of a content stream, an operation splitter, and a
 * byte-range remover. It is deliberately conservative - every function here
 * would rather refuse than damage a document, and the caller falls back to
 * covering whenever a check fails.
 *
 * No DOM and no pdf.js, so the test suite drives it directly.
 */

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const isWhite = (b) => WHITESPACE.has(b);
const isDelim = (b) => DELIMITERS.has(b);
const isRegular = (b) => !isWhite(b) && !isDelim(b);

/** Operators that draw text. */
export const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);
/** Operators that (re)set where the next text goes. */
export const POSITION_OPS = new Set(['Tm', 'Td', 'TD', 'T*', 'BT', 'ET']);

/**
 * Split a content stream into tokens.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{type:string, start:number, end:number, value?:any}>}
 */
export function tokenize(bytes) {
  const tokens = [];
  let i = 0;
  const n = bytes.length;

  while (i < n) {
    const b = bytes[i];

    if (isWhite(b)) {
      i += 1;
      continue;
    }

    // Comment: runs to the end of the line.
    if (b === 0x25) {
      while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
      continue;
    }

    const start = i;

    // Literal string, with balanced parentheses and backslash escapes.
    if (b === 0x28) {
      i += 1;
      let depth = 1;
      const out = [];
      while (i < n && depth > 0) {
        const c = bytes[i];
        if (c === 0x5c) {
          i += 1;
          const e = bytes[i];
          if (e === undefined) break;
          if (e >= 0x30 && e <= 0x37) {
            // Up to three octal digits.
            let oct = 0;
            let digits = 0;
            while (digits < 3 && bytes[i] >= 0x30 && bytes[i] <= 0x37) {
              oct = oct * 8 + (bytes[i] - 0x30);
              i += 1;
              digits += 1;
            }
            out.push(oct & 0xff);
            continue;
          }
          const map = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
          if (map[e] !== undefined) out.push(map[e]);
          else if (e === 0x0a) {
            /* line continuation: nothing */
          } else out.push(e);
          i += 1;
          continue;
        }
        if (c === 0x28) depth += 1;
        if (c === 0x29) {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
        out.push(c);
        i += 1;
      }
      tokens.push({ type: 'string', start, end: i, value: Uint8Array.from(out) });
      continue;
    }

    // Dictionary delimiters, or a hex string.
    if (b === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2;
        tokens.push({ type: 'dict-open', start, end: i });
        continue;
      }
      i += 1;
      const digits = [];
      while (i < n && bytes[i] !== 0x3e) {
        const c = bytes[i];
        if (!isWhite(c)) digits.push(String.fromCharCode(c));
        i += 1;
      }
      i += 1; // closing '>'
      if (digits.length % 2) digits.push('0');
      const out = new Uint8Array(digits.length / 2);
      for (let k = 0; k < out.length; k += 1) {
        out[k] = parseInt(digits[k * 2] + digits[k * 2 + 1], 16) & 0xff;
      }
      tokens.push({ type: 'string', start, end: i, value: out });
      continue;
    }

    if (b === 0x3e && bytes[i + 1] === 0x3e) {
      i += 2;
      tokens.push({ type: 'dict-close', start, end: i });
      continue;
    }

    if (b === 0x5b) {
      i += 1;
      tokens.push({ type: 'array-open', start, end: i });
      continue;
    }
    if (b === 0x5d) {
      i += 1;
      tokens.push({ type: 'array-close', start, end: i });
      continue;
    }
    if (b === 0x7b || b === 0x7d) {
      i += 1;
      tokens.push({ type: 'brace', start, end: i });
      continue;
    }

    // Name.
    if (b === 0x2f) {
      i += 1;
      while (i < n && isRegular(bytes[i])) i += 1;
      tokens.push({
        type: 'name',
        start,
        end: i,
        value: latin1(bytes.subarray(start + 1, i)),
      });
      continue;
    }

    // Number or keyword/operator.
    while (i < n && isRegular(bytes[i])) i += 1;
    if (i === start) {
      // An unexpected delimiter; skip it rather than spin forever.
      i += 1;
      continue;
    }
    const text = latin1(bytes.subarray(start, i));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
      tokens.push({ type: 'number', start, end: i, value: Number(text) });
    } else {
      tokens.push({ type: 'operator', start, end: i, value: text });
      // Inline image: everything between ID and EI is raw binary that must not
      // be tokenised, or its bytes get mistaken for operators.
      if (text === 'ID') {
        const imageEnd = findInlineImageEnd(bytes, i);
        tokens.push({ type: 'inline-image-data', start: i, end: imageEnd });
        i = imageEnd;
      }
    }
  }

  return tokens;
}

function findInlineImageEnd(bytes, from) {
  let i = from + 1; // the single whitespace after ID
  while (i < bytes.length - 1) {
    if (
      bytes[i] === 0x45 &&
      bytes[i + 1] === 0x49 &&
      (i === 0 || isWhite(bytes[i - 1])) &&
      (i + 2 >= bytes.length || isWhite(bytes[i + 2]) || isDelim(bytes[i + 2]))
    ) {
      return i; // leave EI itself to be tokenised as an operator
    }
    i += 1;
  }
  return bytes.length;
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Group tokens into operations: a run of operands terminated by an operator.
 *
 * @returns {Array<{operator:string, operands:Array, start:number, end:number}>}
 */
export function operations(tokens) {
  const ops = [];
  let operands = [];
  let start = -1;

  for (const token of tokens) {
    if (token.type === 'operator') {
      ops.push({
        operator: token.value,
        operands,
        start: start === -1 ? token.start : start,
        end: token.end,
      });
      operands = [];
      start = -1;
      continue;
    }
    if (token.type === 'inline-image-data') continue;
    if (start === -1) start = token.start;
    operands.push(token);
  }
  return ops;
}

/**
 * The text-showing operations of a stream, in order, with the bytes they draw.
 *
 * The bytes are the raw string operands. For a simple font with a Latin text
 * encoding they are the text itself, which is what makes matching possible; for
 * a CID font they are glyph indices and will not match, so the caller refuses
 * to operate rather than deleting the wrong thing.
 */
export function showOperations(ops) {
  const out = [];
  ops.forEach((op, index) => {
    if (!SHOW_OPS.has(op.operator)) return;
    const parts = [];
    for (const operand of op.operands) {
      if (operand.type === 'string') parts.push(operand.value);
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    out.push({ opIndex: index, operator: op.operator, start: op.start, end: op.end, bytes, text: latin1(bytes) });
  });
  return out;
}

/**
 * Would deleting these operations disturb text that stays?
 *
 * Removing `(x) Tj` leaves the text cursor where it was, so anything drawn
 * afterwards without its own positioning operator would slide backwards into
 * the gap. Deleting is only safe when every following show operation is
 * repositioned first.
 *
 * @param {Array} ops           all operations
 * @param {Set<number>} doomed  op indices to delete
 */
export function isSafeToDelete(ops, doomed) {
  for (const index of doomed) {
    for (let i = index + 1; i < ops.length; i += 1) {
      const op = ops[i];
      if (POSITION_OPS.has(op.operator)) break; // repositioned: later text is fine
      if (SHOW_OPS.has(op.operator)) {
        if (doomed.has(i)) continue; // that one is going too
        return false; // surviving text would move
      }
    }
  }
  return true;
}

/**
 * Remove byte ranges from a stream.
 * @param {Uint8Array} bytes
 * @param {Array<{start:number, end:number}>} ranges
 */
export function removeRanges(bytes, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const keep = [];
  let at = 0;
  for (const range of sorted) {
    if (range.start < at) continue; // overlapping; already dropped
    keep.push(bytes.subarray(at, range.start));
    at = range.end;
  }
  keep.push(bytes.subarray(at));

  let total = 0;
  for (const part of keep) total += part.length;
  const out = new Uint8Array(total + keep.length);
  let cursor = 0;
  for (const part of keep) {
    out.set(part, cursor);
    cursor += part.length;
    out[cursor] = 0x0a; // keep operators from running together
    cursor += 1;
  }
  return out.subarray(0, cursor);
}

/**
 * Normalise text for comparison: the same words drawn by two different
 * generators differ in whitespace far more often than in content.
 */
export function normalizeForMatch(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Images                                                              *
 * ------------------------------------------------------------------ */

/**
 * Affine matrices, in PDF's own convention: points are row vectors and
 * `a b c d e f cm` concatenates as CTM' = M x CTM.
 */
export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function matMul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function matApply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function matInvert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

/** True when a placement is rotated or skewed rather than merely scaled. */
export function isAxisAligned(m) {
  const scale = Math.max(Math.abs(m[0]), Math.abs(m[3]), 1e-6);
  return Math.abs(m[1]) < scale * 1e-6 && Math.abs(m[2]) < scale * 1e-6;
}

/**
 * Every image drawn by a page's own content stream, with the matrix that places
 * it. An image XObject is always drawn into the unit square, so that matrix is
 * the whole story: where it sits, how big it is, and any rotation.
 *
 * @param {Array} ops                    operations from `operations()`
 * @param {(name:string)=>boolean} isImage  which XObject names are images
 */
export function imagePlacements(ops, isImage) {
  const out = [];
  const stack = [];
  let ctm = IDENTITY;

  ops.forEach((op, index) => {
    switch (op.operator) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.length ? stack.pop() : IDENTITY;
        break;
      case 'cm': {
        const n = op.operands.slice(-6).map((o) => (o.type === 'number' ? o.value : NaN));
        if (n.length === 6 && n.every(Number.isFinite)) ctm = matMul(n, ctm);
        break;
      }
      case 'Do': {
        const operand = op.operands[op.operands.length - 1];
        if (!operand || operand.type !== 'name') break;
        if (!isImage(operand.value)) break;
        out.push({
          opIndex: index,
          ordinal: out.length,
          name: operand.value,
          matrix: ctm,
          start: op.start,
          end: op.end,
        });
        break;
      }
      default:
        break;
    }
  });

  return out;
}

/** The corners of a placement, in PDF user space. */
export function placementCorners(matrix) {
  return [
    matApply(matrix, 0, 0),
    matApply(matrix, 1, 0),
    matApply(matrix, 1, 1),
    matApply(matrix, 0, 1),
  ];
}

/** Axis-aligned bounds of a placement, in PDF user space. */
export function placementBounds(matrix) {
  const xs = placementCorners(matrix).map((p) => p.x);
  const ys = placementCorners(matrix).map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/** Identifies the set of placements a plan was made against. */
export function imageFingerprint(placements) {
  return placements
    .map((p) => `${p.name}@${p.matrix.map((v) => Math.round(v * 100) / 100).join(',')}`)
    .join('|');
}

/**
 * Rewrite image placements so each one lands where the user dragged it.
 *
 * A `Do` is replaced by `q <N> cm <name> Do Q`, which is self-contained: the
 * save/restore pair means the extra transform cannot leak into whatever the
 * page draws next. Since the wrapped matrix applies *before* the placement,
 * getting a movement of `t` in page space needs N = M x T x M-inverse.
 *
 * @param {Uint8Array} streamBytes
 * @param {Array<{ordinal:number, transform:number[]}>} edits  transform in page space
 * @param {(name:string)=>boolean} isImage
 * @param {string} expectedFingerprint
 */
export function applyImageTransforms(streamBytes, edits, isImage, expectedFingerprint) {
  const ops = operations(tokenize(streamBytes));
  const placements = imagePlacements(ops, isImage);

  if (expectedFingerprint && imageFingerprint(placements) !== expectedFingerprint) {
    return { ok: false, reason: 'the page changed since the move was planned' };
  }

  const replacements = [];
  for (const edit of edits) {
    const placement = placements[edit.ordinal];
    if (!placement) return { ok: false, reason: 'the picture is no longer where it was' };

    const inverse = matInvert(placement.matrix);
    if (!inverse) return { ok: false, reason: 'the picture has a matrix that cannot be inverted' };

    const n = matMul(matMul(placement.matrix, edit.transform), inverse);
    const numbers = n.map((v) => formatNumber(v)).join(' ');
    replacements.push({
      start: placement.start,
      end: placement.end,
      text: `q ${numbers} cm /${placement.name} Do Q`,
    });
  }

  return { ok: true, bytes: replaceRanges(streamBytes, replacements) };
}

/**
 * Format a matrix component for a content stream.
 *
 * Two traps here: PDF has no exponent notation, so `String(1e-7)` would emit
 * something no reader accepts; and the wrapped matrix divides by the picture's
 * size, so rounding too early shifts it visibly. Ten decimal places is well
 * inside both limits.
 */
function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1e-10) return '0';
  const fixed = value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '-0' ? '0' : fixed;
}

/**
 * Replace byte ranges with new text.
 * @param {Uint8Array} bytes
 * @param {Array<{start:number, end:number, text:string}>} edits
 */
export function replaceRanges(bytes, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const parts = [];
  let at = 0;
  for (const edit of sorted) {
    if (edit.start < at) continue;
    parts.push(bytes.subarray(at, edit.start));
    parts.push(Uint8Array.from([...`\n${edit.text}\n`].map((c) => c.charCodeAt(0))));
    at = edit.end;
  }
  parts.push(bytes.subarray(at));

  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** Cheap stable hash, used to check a stream is the one we planned against. */
export function fingerprint(showOps) {
  let h = 0x811c9dc5;
  const text = showOps.map((op) => normalizeForMatch(op.text)).join(' ');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${showOps.length}:${h.toString(16)}`;
}

/**
 * Line up a stream's show operations with the text items a PDF reader reports.
 *
 * Both sequences are in drawing order, so the useful case is a one-to-one
 * correspondence. Anything else - text inside form XObjects, a CID font whose
 * operand bytes are glyph indices, a generator that splits differently - shows
 * up as a length or content mismatch, and the caller then leaves the page alone.
 *
 * @param {Array<{text:string}>} showOps
 * @param {Array<{str:string}>} items  as returned by the reader, in order
 * @returns {{aligned:boolean, confidence:number, showForItem:Map<number, number>}}
 */
export function alignOpsToItems(showOps, items) {
  const useful = [];
  items.forEach((it, index) => {
    if (normalizeForMatch(it.str)) useful.push({ index, str: it.str });
  });

  const showForItem = new Map();
  if (!showOps.length || !useful.length || showOps.length !== useful.length) {
    return { aligned: false, confidence: 0, showForItem };
  }

  let matches = 0;
  for (let i = 0; i < useful.length; i += 1) {
    if (normalizeForMatch(showOps[i].text) === normalizeForMatch(useful[i].str)) matches += 1;
    showForItem.set(useful[i].index, i);
  }

  const confidence = matches / useful.length;
  return { aligned: confidence >= 0.9, confidence, showForItem };
}

/**
 * Work out which operations would have to go to delete some text items.
 *
 * Runs where pdf.js is available (the editor), because it needs the reader's
 * view of the text to line the two sequences up. The result is a list of
 * ordinals into the stream's show operations, which `applyDeletion` can act on
 * later without needing a text reader at all.
 *
 * @param {Uint8Array} streamBytes
 * @param {Array<{str:string}>} items  every text item on the page, in order
 * @param {number[]} itemIndices       which of them to remove
 */
export function planDeletion(streamBytes, items, itemIndices) {
  const ops = operations(tokenize(streamBytes));
  const shows = showOperations(ops);
  const alignment = alignOpsToItems(shows, items);

  if (!alignment.aligned) {
    return {
      ok: false,
      reason:
        alignment.confidence > 0
          ? `the page's drawing operations only matched its text ${(alignment.confidence * 100).toFixed(0)}%`
          : "the page's text is not laid out in a form this editor can rewrite",
    };
  }

  const ordinals = itemIndices
    .map((i) => alignment.showForItem.get(i))
    .filter((i) => i !== undefined);
  if (!ordinals.length) return { ok: false, reason: 'no matching operations' };

  if (!isSafeToDelete(ops, new Set(ordinals.map((o) => shows[o].opIndex)))) {
    return { ok: false, reason: 'removing it would move text that follows on the same line' };
  }

  return { ok: true, ordinals, fingerprint: fingerprint(shows) };
}

/**
 * Carry out a plan produced by `planDeletion` against a content stream.
 *
 * The fingerprint check is the safety catch: if the stream is not byte-for-byte
 * the one the plan was made against, the ordinals mean nothing and we must not
 * delete anything.
 *
 * @param {Uint8Array} streamBytes
 * @param {number[]} ordinals
 * @param {string} expectedFingerprint
 */
export function applyDeletion(streamBytes, ordinals, expectedFingerprint) {
  const ops = operations(tokenize(streamBytes));
  const shows = showOperations(ops);

  if (expectedFingerprint && fingerprint(shows) !== expectedFingerprint) {
    return { ok: false, reason: 'the page changed since the edit was planned' };
  }

  const chosen = ordinals.filter((o) => o >= 0 && o < shows.length);
  if (chosen.length !== ordinals.length) {
    return { ok: false, reason: 'the edit refers to operations that are no longer there' };
  }
  if (!isSafeToDelete(ops, new Set(chosen.map((o) => shows[o].opIndex)))) {
    return { ok: false, reason: 'removing it would move text that follows on the same line' };
  }

  const ranges = chosen.map((o) => ({ start: shows[o].start, end: shows[o].end }));
  return { ok: true, bytes: removeRanges(streamBytes, ranges) };
}
