// Renders the procedural sound bank off the main thread, so unlocking audio never
// costs the game a frame. Receives { sr, jobs: [[id, variant], ...] } and posts one
// message per rendered buffer (transferred, not copied), then { done: true }.

import { renderSound, soundRate } from './sounds.js';

self.onmessage = (e) => {
  const { sr, jobs } = e.data || {};
  for (const [id, v] of jobs || []) {
    try {
      const data = renderSound(id, sr, v);
      self.postMessage({ id, v, rate: soundRate(id, sr), data }, [data.buffer]);
    } catch (err) {
      self.postMessage({ id, v, error: String(err && err.message || err) });
    }
  }
  self.postMessage({ done: true });
};
