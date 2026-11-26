// Holds the baked AudioBuffers. Baking runs in a module Worker when available (zero
// main-thread cost), otherwise in small idle-time slices; an offline/test context bakes
// synchronously. Buffers are cached per sample rate at module level, so every context
// running at the same rate (e.g. the offline level-measurement renders) shares them.

import { SOUNDS, SOUND_IDS, renderSound, soundRate } from './sounds.js';

// Sounds needed first: the player hears guns and hits within seconds of starting. The
// menu music's instruments (`early`) come right after guns, hits and the interface, so
// the score starts within a second or two of unlocking; the rest of the orchestra bakes last.
const CAT_ORDER = ['gun', 'impact', 'ui', 'early', 'weapon', 'zombie', 'player', 'explosion', 'pickup', 'loop', 'deploy', 'stinger', 'music'];
// Categories cheap enough to render synchronously on first use if their bake hasn't landed.
const SYNC_OK = new Set(['gun', 'impact', 'weapon', 'ui', 'pickup']);
const SLICE_MS = 6;

const CACHE = new Map();   // sampleRate → Map(id → AudioBuffer[] (sparse by variant))

const catOf = (id) => (SOUNDS[id].early ? 'early' : SOUNDS[id].cat);
// Music instruments use their variants as sample roots: a note needs the whole set.
const allVariants = (id) => SOUNDS[id].cat === 'music';

function bakeOrder() {
  const jobs = [];
  const ids = SOUND_IDS.slice().sort((a, b) => CAT_ORDER.indexOf(catOf(a)) - CAT_ORDER.indexOf(catOf(b)));
  // Variant 0 of everything first, then the extra variants: every sound is playable early.
  for (const id of ids) {
    const n = allVariants(id) ? SOUNDS[id].v || 1 : 1;
    for (let v = 0; v < n; v++) jobs.push([id, v]);
  }
  for (const id of ids) if (!allVariants(id)) for (let v = 1; v < (SOUNDS[id].v || 1); v++) jobs.push([id, v]);
  return jobs;
}

function makeBuffer(ctx, data, rate) {
  let buf;
  try {
    buf = new AudioBuffer({ length: data.length, sampleRate: rate, numberOfChannels: 1 });
  } catch {
    buf = ctx.createBuffer(1, data.length, rate);
  }
  if (buf.copyToChannel) buf.copyToChannel(data, 0);
  else buf.getChannelData(0).set(data);
  return buf;
}

/**
 * Create the sound bank for `ctx`.
 * @param {BaseAudioContext} ctx
 * @param {{ sync?: boolean }} opts  sync: bake everything now (offline rendering / tests)
 */
export function createBank(ctx, { sync = false } = {}) {
  const sr = ctx.sampleRate;
  if (!CACHE.has(sr)) CACHE.set(sr, new Map());
  const store = CACHE.get(sr);
  const total = SOUND_IDS.reduce((n, id) => n + (SOUNDS[id].v || 1), 0);
  let queue = [];
  let worker = null;
  let timer = 0;
  let idle = 0;
  let closed = false;

  const has = (id, v) => !!(store.get(id) && store.get(id)[v]);

  function put(id, v, data, rate) {
    let arr = store.get(id);
    if (!arr) store.set(id, (arr = []));
    if (!arr[v]) arr[v] = makeBuffer(ctx, data, rate);
  }

  function renderNow(id, v) {
    if (!has(id, v)) put(id, v, renderSound(id, sr, v), soundRate(id, sr));
  }

  function count() {
    let n = 0;
    for (const arr of store.values()) for (const b of arr) if (b) n++;
    return n;
  }

  // Main-thread fallback (e.g. the one-file build): a few milliseconds per slice so the
  // game keeps its frame rate, preferably in the browser's idle time between frames.
  function slice(deadline) {
    timer = 0;
    idle = 0;
    if (closed || !queue.length) return;
    const t0 = Date.now();
    const more = () => (deadline && !deadline.didTimeout ? deadline.timeRemaining() > 4 : Date.now() - t0 < SLICE_MS);
    do {
      const [id, v] = queue.shift();
      try {
        renderNow(id, v);
      } catch {
        // A broken recipe must not stop the rest of the bank from baking.
      }
    } while (queue.length && more());
    if (!queue.length) return;
    if (typeof requestIdleCallback === 'function') {
      idle = requestIdleCallback(slice, { timeout: 120 });
    } else {
      timer = setTimeout(slice, 16);
    }
  }

  function startWorker() {
    try {
      worker = new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
      return false;
    }
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.done) {
        worker.terminate();
        worker = null;
        // Anything the worker failed on gets another chance on the main thread.
        queue = queue.filter(([id, v]) => !has(id, v));
        if (queue.length) slice();
        return;
      }
      if (m.data) put(m.id, m.v, m.data, m.rate);
    };
    worker.onerror = () => {
      // Module workers unsupported or the script failed to load: bake here instead.
      if (worker) worker.terminate();
      worker = null;
      queue = queue.filter(([id, v]) => !has(id, v));
      slice();
    };
    worker.postMessage({ sr, jobs: queue });
    return true;
  }

  queue = bakeOrder().filter(([id, v]) => !has(id, v));
  if (queue.length) {
    if (sync) {
      for (const [id, v] of queue) renderNow(id, v);
      queue = [];
    } else if (typeof Worker === 'undefined' || !startWorker()) {
      slice();
    }
  }

  return {
    /** Random baked variant of `id` (or null if none is ready and it's too costly to render now). */
    get(id, rand = Math.random()) {
      const arr = store.get(id);
      if (arr && arr.length) {
        const n = arr.length;
        let i = Math.floor(rand * n);
        for (let k = 0; k < n; k++, i = (i + 1) % n) if (arr[i]) return arr[i];
      }
      const def = SOUNDS[id];
      if (!def || !SYNC_OK.has(def.cat)) return null;
      renderNow(id, 0);
      return store.get(id)[0];
    },
    /** Baked variant `v` of `id` exactly (music sample roots), or null while it is still baking. */
    variant(id, v) {
      const arr = store.get(id);
      return (arr && arr[v]) || null;
    },
    has(id) {
      const arr = store.get(id);
      return !!(arr && arr.some(Boolean));
    },
    progress() {
      return { done: count(), total };
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (idle && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      if (worker) worker.terminate();
      worker = null;
    },
  };
}
