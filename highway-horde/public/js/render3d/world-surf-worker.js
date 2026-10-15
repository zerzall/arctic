// Generates the cinematic 512² surface layers (world-surf-gen.js) off the main thread. Receives
// { n } and posts { data, ms } with the texel buffer transferred (not copied), or { error }.

import { generateLayers, now } from './world-surf-gen.js';

self.onmessage = (e) => {
  const n = (e.data && e.data.n) || 512;
  try {
    const t0 = now();
    const data = generateLayers(n);
    self.postMessage({ data, ms: Math.round(now() - t0) }, [data.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
