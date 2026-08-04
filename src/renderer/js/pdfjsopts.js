/**
 * The options every pdf.js document load needs.
 *
 * pdf.js does not bundle its side assets: character maps for CJK text, the 14
 * standard fonts, and - easy to miss until a real document arrives - the
 * WebAssembly image codecs. Scanners emit CCITT fax and JBIG2, and pdf.js
 * decodes both in WebAssembly, so a viewer that omits `wasmUrl` opens scanned
 * PDFs to a blank page while reporting no error at all.
 *
 * Kept in one module so the paths cannot drift apart, and so the test suite can
 * assert they are all present.
 */

/** Absolute URL of a file or directory inside the vendored pdf.js assets. */
export function vendorUrl(relative) {
  return new URL(`../vendor/${relative}`, import.meta.url).href;
}

export const WORKER_URL = vendorUrl('pdf.worker.min.mjs');

/**
 * Asset locations. The directory entries keep their trailing slash because
 * pdf.js concatenates a filename onto them directly.
 */
export const ASSET_URLS = {
  cMapUrl: vendorUrl('cmaps/'),
  standardFontDataUrl: vendorUrl('standard_fonts/'),
  wasmUrl: vendorUrl('wasm/'),
};

/**
 * Build the argument for `pdfjsLib.getDocument`.
 *
 * @param {Uint8Array|ArrayBuffer} bytes  pdf.js takes ownership, so pass a copy
 * @param {string} [password]
 */
export function documentOptions(bytes, password) {
  return {
    data: bytes,
    ...ASSET_URLS,
    cMapPacked: true,
    password,
    isEvalSupported: false,
  };
}
