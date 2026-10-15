/**
 * Optical character recognition, for pages that are pictures of text.
 *
 * A scan has no text layer: nothing to search, nothing to select, and nothing
 * for the Edit Text tool to offer. This runs Tesseract over a rendered page and
 * turns the result into word boxes in the editor's own view space, which the
 * writer later lays down as invisible text so the saved file is searchable
 * everywhere, not only here.
 *
 * The engine, its WebAssembly core and the English language data are all
 * vendored: recognition works with no network, which is the point of a desktop
 * editor holding someone's bank statements.
 */
// The vendored build is a CommonJS bundle wrapped as ESM, so everything comes
// through the default export rather than as named ones.
import Tesseract from '../vendor/tesseract/tesseract.esm.min.js';
import { vendorUrl } from './pdfjsopts.js';

import { boxToView, usableWords, MIN_CONFIDENCE } from './ocrdata.js';

const { createWorker, OEM } = Tesseract;

export { wordsAsItems, MIN_CONFIDENCE } from './ocrdata.js';

/** Tesseract is slow to start, so one worker is kept for the session. */
let workerPromise = null;
let progressHandler = null;

function options() {
  return {
    workerPath: vendorUrl('tesseract/worker.min.js'),
    // Directories: Tesseract appends the filename it has chosen, picking a core
    // build to match the CPU's SIMD support.
    corePath: vendorUrl('tesseract/'),
    langPath: vendorUrl('tessdata/'),
    gzip: true,
    // Load the worker straight from the vendored file. The blob URL route trips
    // over the app's content security policy.
    workerBlobURL: false,
    logger: (m) => {
      if (progressHandler && m && typeof m.progress === 'number') progressHandler(m);
    },
  };
}

/** Start (or reuse) the recognition engine. */
export function startEngine() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', OEM.LSTM_ONLY, options()).catch((err) => {
      workerPromise = null; // let a later attempt retry rather than wedge
      throw err;
    });
  }
  return workerPromise;
}

export async function stopEngine() {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* nothing useful to do if it never started */
  }
}

export function isEngineRunning() {
  return !!workerPromise;
}

/**
 * Recognise the text in a rendered page.
 *
 * @param {string} imageDataUrl  the page, rasterised
 * @param {number} scale         device pixels per point in that image
 * @param {(fraction:number, status:string)=>void} [onProgress]
 * @returns {Promise<{words:Array, lines:Array, text:string}>} boxes in view space
 */
export async function recognizePage(imageDataUrl, scale, onProgress) {
  const worker = await startEngine();
  progressHandler = onProgress
    ? (m) => onProgress(m.progress, m.status)
    : null;

  try {
    const { data } = await worker.recognize(imageDataUrl, {}, { blocks: true, text: true });
    return {
      words: wordsFrom(data, scale),
      lines: linesFrom(data, scale),
      text: data.text || '',
    };
  } finally {
    progressHandler = null;
  }
}

/** Walk the block/paragraph/line/word tree Tesseract returns. */
function eachWord(data, fn) {
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) fn(word, line, para, block);
      }
    }
  }
}

function wordsFrom(data, scale) {
  const out = [];
  eachWord(data, (word) => {
    const text = (word.text || '').trim();
    if (!text) return;
    out.push({ text, confidence: word.confidence ?? 0, ...boxToView(word.bbox, scale) });
  });
  return usableWords(out);
}

/** Lines, for the editor's own text tools. */
function linesFrom(data, scale) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+$/, '');
        if (!text.trim()) continue;
        const box = boxToView(line.bbox, scale);
        out.push({ text, confidence: line.confidence, ...box });
      }
    }
  }
  return out;
}
