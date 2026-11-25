// Where the texture files come from (public/textures/: the world library, guns, zombies, decals).
//
// The bakers write lossless PNGs; scripts/compress-textures.js writes a smaller download copy of
// each (JPEG 4:4:4 for colour and normal / packed maps, lossless WebP where an alpha channel or a
// mask must stay exact, and halved copies of the maps larger than 1024² for the tiers that never
// sample them at full size) and lists them in textures/compressed.json. Every loader asks here by
// the PNG's path (and the size it will use): it gets the copy when one is listed, else the PNG, and
// falls back to the PNG when a copy fails to arrive.
//
// The one-file build (scripts/build-standalone.js) carries the files in script elements after the
// game's code (window.__HH_TEX: the manifest, the index and one element per file, read once and
// released); the served game fetches them next to itself.
//
// The order: the world's library comes first (the loading screen waits for it); the decals, zombie
// and gun sets wait for it (holdTextureQueue / textureQueue) so they do not compete for the network
// and the decoders, at most QUEUE_MAX_WAIT ms.

const BASE = (() => {
  try { return new URL('../../textures/', import.meta.url).href; } catch { return 'textures/'; }
})();

/** The one-file build's embedded store, or null. */
export function embeddedStore() {
  const s = typeof window !== 'undefined' ? window.__HH_TEX : null;
  return s && typeof s.blob === 'function' ? s : null;
}

/** MIME type of a texture file by its extension. */
export function mimeOf(file) {
  const ext = String(file).split('.').pop().toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'avif' ? 'image/avif' : 'image/png';
}

/** Absolute URL of a file under textures/ (the served game). */
export function textureURL(file) {
  return BASE + file;
}

let indexP = null;
let indexNow;   // the index once it has arrived (null: there is none), undefined until then
/** Tests: forget the cached index (and use `idx` instead when given). */
export function setTextureIndex(idx) { indexP = idx === undefined ? null : Promise.resolve(idx); indexNow = idx === undefined ? undefined : idx; }

/** The index if it has already arrived (null when there is none), else undefined. */
export function textureIndexNow() { return indexNow; }

/** The copies' index ({ files: { 'set/albedo.png': { file, la?, variants? } } }), null when there is none. */
export function textureIndex() {
  if (!indexP) {
    const emb = embeddedStore();
    indexP = (emb && typeof emb.index === 'function'
      ? Promise.resolve().then(() => emb.index())
      : typeof fetch === 'function'
        ? fetch(BASE + 'compressed.json').then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null))
      .then((ix) => (ix && ix.files ? ix : null))
      .catch(() => null)
      .then((ix) => { indexNow = ix; return ix; });
  }
  return indexP;
}

/**
 * The file to load for a PNG path at a size: the smallest listed copy at least `size` wide (the
 * full-size copy when none is), else the PNG. → { file, png, la }.
 * @param {object|null} index
 * @param {string} path the PNG's path under textures/ ('grass/albedo.png')
 * @param {number} [size] the size the loader will use (0: full)
 */
export function pickFile(index, path, size = 0) {
  const e = index && index.files ? index.files[path] : null;
  if (!e || !e.file) return { file: path, png: true, la: false };
  let file = e.file;
  if (size > 0 && Array.isArray(e.variants)) {
    let best = null;
    for (const v of e.variants) if (v.size >= size && (!best || v.size < best.size)) best = v;
    if (best) file = best.file;
  }
  const png = /\.png$/i.test(file);
  return { file, png, la: !!e.la && !png };
}

async function fetchBlob(file) {
  const emb = embeddedStore();
  if (emb) return emb.blob(file);
  const r = await fetch(BASE + file);
  if (!r.ok) throw new Error(`textures: ${file} ${r.status}`);
  const b = await r.blob();
  // (a server that does not know the type would make it unreadable for ImageDecoder)
  return b.type ? b : new Blob([b], { type: mimeOf(file) });
}

/**
 * Where a worker can get a file itself: { url } for the served game, { blob } from the one-file
 * build's store; plus { file, png, la, fallback } (fallback: the PNG's own source, when it is not
 * the file picked).
 */
export async function textureSource(path, size = 0) {
  const pick = pickFile(await textureIndex(), path, size);
  const emb = embeddedStore();
  const src = async (file) => (emb ? { blob: await emb.blob(file) } : { url: BASE + file, type: mimeOf(file) });
  const out = { ...pick, ...(await src(pick.file)) };
  if (!pick.png && !emb) out.fallback = { file: path, png: true, la: false, url: BASE + path, type: 'image/png' };
  return out;
}

/**
 * textureSource without waiting, for a loader that hands its jobs to a worker while the page is
 * still busy (the world's library is queued in the middle of the world's build): null when the
 * index has not arrived yet or a file cannot be had at once (then the loader waits for textureSource).
 * From the one-file build's store it takes the file's base64 text ({ b64, type }).
 */
export function textureSourceNow(path, size = 0) {
  if (indexNow === undefined) return null;
  const pick = pickFile(indexNow, path, size);
  const emb = embeddedStore();
  if (emb) {
    const t = typeof emb.take === 'function' ? emb.take(pick.file) : null;
    return t ? { ...pick, b64: t.b64, type: t.type } : null;
  }
  const out = { ...pick, url: BASE + pick.file, type: mimeOf(pick.file) };
  if (!pick.png) out.fallback = { file: path, png: true, la: false, url: BASE + path, type: 'image/png' };
  return out;
}

/**
 * A texture file as a Blob, by its PNG's path: the copy for `size` when one is listed, else (or when
 * the copy fails) the PNG. → { blob, file, png, la }.
 */
export async function textureBlob(path, size = 0) {
  const pick = pickFile(await textureIndex(), path, size);
  try {
    return { ...pick, blob: await fetchBlob(pick.file) };
  } catch (err) {
    if (pick.png) throw err;
    return { file: path, png: true, la: false, blob: await fetchBlob(path) };
  }
}

// ---- the order ------------------------------------------------------------------------------------

/** The longest the queue waits for the world's library (ms). */
export const QUEUE_MAX_WAIT = 20000;
let held = null;

/** The world's library is loading: later sets wait for `p` (or QUEUE_MAX_WAIT) before they start. */
export function holdTextureQueue(p) {
  const mine = Promise.race([
    Promise.resolve(p).then(() => {}, () => {}),
    new Promise((r) => { const t = setTimeout(r, QUEUE_MAX_WAIT); if (t && t.unref) t.unref(); }),
  ]).then(() => { if (held === mine) held = null; });
  held = mine;
  return mine;
}

/**
 * Resolves when the decals, zombie and gun sets may start loading. (It looks after the current
 * task's synchronous code: the renderer makes the world, whose library holds the queue, in the same
 * call that makes the sub-systems asking here.)
 */
export function textureQueue() {
  return Promise.resolve().then(() => held);
}
