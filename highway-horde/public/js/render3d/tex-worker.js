// Texture decoding off the main thread: a worker made from self-contained functions' source (a blob
// URL, so the one-file build has it too) that fetches a loader's files itself (or takes the Blobs the
// one-file build's store hands over), decodes them with the browser's decoders and packs them into
// the loader's layers. The main thread only posts the jobs and uploads what comes back: on a slow
// machine every turn of the main thread is a whole frame, so a file that needed five of them (fetch,
// body, decode, pack, upload) arrives in one, and the game never stutters for a texture.
//
// A file is { url | blob | buf | b64, type?, fallback? } (tex-files.js textureSource /
// textureSourceNow). decodeRGBA returns { w, h, px } (RGBA, rows top first): ImageDecoder where it
// can (CPU pixels as stored: no colour management, alpha untouched; halved by a box filter when the
// file is a power-of-two multiple of the size asked for), else createImageBitmap and a 2D canvas
// (also any other resize: the browser's 'high' resampling, as the loaders always had).

/* The worker-side helpers: stringified into the worker, so no imports and no outside names. */

export async function texBytes(f) {
  if (f.buf) return f.buf;
  if (f.blob) return f.blob.arrayBuffer();
  if (f.b64) return (await fetch(`data:${f.type || 'application/octet-stream'};base64,${f.b64}`)).arrayBuffer();
  const r = await fetch(f.url);
  if (!r.ok) throw new Error(`${r.status} ${f.url}`);
  return r.arrayBuffer();
}

/** Halve an RGBA image (2 × 2 box, every channel on its own: one mip level). */
function texHalve(px, w, h) {
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const r0 = y * 2 * w * 4, r1 = r0 + w * 4, o = y * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      const a = r0 + x * 2, b = r1 + x * 2;
      for (let c = 0; c < 4; c++) out[o + x + c] = (px[a + c] + px[a + 4 + c] + px[b + c] + px[b + 4 + c] + 2) >> 2;
    }
  }
  return out;
}

async function texDecodeOnce(f, size) {
  const buf = await texBytes(f);
  const type = f.type || (f.blob && f.blob.type) || 'image/png';
  // ImageDecoder first: plain CPU pixels (a canvas or an ImageBitmap may go through the GPU process,
  // which a busy game keeps waiting), alpha untouched; a map stored at a power-of-two multiple of
  // the size asked for is box-filtered down here
  if (typeof ImageDecoder === 'function') {
    let dec = null, image = null;
    try {
      dec = new ImageDecoder({ data: buf, type, premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      image = (await dec.decode()).image;
      let w = image.displayWidth, h = image.displayHeight;
      let k = 0;
      while (size && (w >> k) > size && (w >> k) % 2 === 0 && (h >> k) % 2 === 0) k++;
      if (!size || ((w >> k) === size && (h >> k) === size)) {
        let px = new Uint8Array(w * h * 4);
        await image.copyTo(px, { format: 'RGBA' });
        for (; k > 0; k--) { px = texHalve(px, w, h); w >>= 1; h >>= 1; }
        return { w, h, px };
      }
    } catch { /* the canvas below */ } finally {
      if (image) image.close();
      if (dec) dec.close();
    }
  }
  const o = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  if (size) Object.assign(o, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  const bmp = await createImageBitmap(new Blob([buf], { type }), o);
  const w = bmp.width, h = bmp.height;
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.globalCompositeOperation = 'copy';
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { w, h, px: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer) };
}

/** Decode a file to RGBA at size² (0: as stored); a copy that fails falls back to its PNG. */
export async function decodeRGBA(f, size) {
  try {
    return await texDecodeOnce(f, size);
  } catch (err) {
    if (f.fallback) return texDecodeOnce(f.fallback, size);
    throw err;
  }
}

const HELPERS = [texBytes, texHalve, texDecodeOnce, decodeRGBA];

/**
 * Start a worker running `handler(data) → Promise<{ out, transfer }>` (plus `fns` it calls, all
 * self-contained) on every message, `limit` at a time. → { run(data, transfer) → Promise<out>,
 * close() } or null where there are no workers (a node test) or it cannot start.
 */
export function makeTexWorker(handler, fns = [], limit = 3) {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  if (typeof OffscreenCanvas === 'undefined' && typeof ImageDecoder === 'undefined') return null;
  const src = [...HELPERS, ...fns, handler].map(String).join('\n') + `
const queue = [];
let busy = 0;
function pump() {
  while (busy < ${Math.max(1, limit | 0)} && queue.length) {
    const { id, data } = queue.shift();
    busy++;
    Promise.resolve().then(() => ${handler.name}(data)).then((r) => self.postMessage({ id, out: r.out }, r.transfer || []))
      .catch((err) => self.postMessage({ id, error: String((err && err.message) || err) })).finally(() => { busy--; pump(); });
  }
}
self.onmessage = (e) => { queue.push(e.data); pump(); };`;
  let w;
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    w = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    return null;
  }
  let n = 0, broken = null;
  const wait = new Map();
  w.onmessage = (e) => { const m = e.data, p = wait.get(m.id); if (!p) return; wait.delete(m.id); if (m.error) p.reject(new Error(m.error)); else p.resolve(m.out); };
  w.onerror = (e) => { broken = new Error((e && e.message) || 'texture worker failed'); for (const p of wait.values()) p.reject(broken); wait.clear(); };
  return {
    run(data, transfer = []) {
      if (broken) return Promise.reject(broken);
      return new Promise((resolve, reject) => {
        const id = ++n;
        wait.set(id, { resolve, reject });
        w.postMessage({ id, data }, transfer);
      });
    },
    close() { w.terminate(); for (const p of wait.values()) p.reject(new Error('closed')); wait.clear(); },
  };
}

const kept = new Map();
/**
 * A worker kept for the page's lifetime (made ahead, while the menus are up): a worker started in
 * the middle of a long task only begins once that task is over (its script is a blob URL the page
 * has to hand over), so a loader that queues jobs during the world's build needs one already
 * running. close() leaves it running for the next game. null where there are no workers.
 */
export function keptTexWorker(handler, fns = [], limit = 3) {
  if (kept.has(handler)) return kept.get(handler);
  const w = makeTexWorker(handler, fns, limit);
  const k = w ? { run: w.run, close() {} } : null;
  kept.set(handler, k);
  return k;
}

