// A fixed-rate callback that keeps firing while the tab is in the background.
//
// Browsers throttle main-thread timers in hidden tabs to about once per second (or
// less), which would freeze the host's simulation for everybody. Timers inside a
// dedicated Worker are not throttled that way, so the worker just posts a message at
// the requested rate and the callback runs on the main thread. Where Workers are not
// available (Node tests, strict CSP) it falls back to setInterval.

const WORKER_SOURCE = `
let timer = null;
onmessage = (e) => {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (e.data > 0) timer = setInterval(() => postMessage(0), e.data);
};
`;

function createWorker() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    return { worker: new Worker(url), url };
  } catch (err) {
    if (url) URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * Call `cb` about `hz` times per second until stopped. Starts immediately.
 * @param {number} hz
 * @param {Function} cb called with no arguments; exceptions are logged, never fatal
 * @returns {{ start: Function, stop: Function, running: boolean, usesWorker: boolean }}
 */
export function createTicker(hz, cb) {
  const ms = Math.max(1, Math.round(1000 / hz));
  let running = false;
  let interval = null;
  let w = null;

  const fire = () => {
    if (!running) return;
    try {
      cb();
    } catch (err) {
      console.error('[net] ticker callback failed:', err);
    }
  };

  const ticker = {
    get running() {
      return running;
    },
    get usesWorker() {
      return w !== null;
    },
    start() {
      if (running) return;
      running = true;
      if (!w) w = createWorker();
      if (w) {
        w.worker.onmessage = fire;
        w.worker.onerror = () => {
          // The worker died (e.g. blocked by CSP after creation): keep ticking anyway.
          w.worker.terminate();
          URL.revokeObjectURL(w.url);
          w = null;
          if (running && interval === null) interval = setInterval(fire, ms);
        };
        w.worker.postMessage(ms);
      } else {
        interval = setInterval(fire, ms);
      }
    },
    stop() {
      running = false;
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (w) {
        w.worker.postMessage(0);
        w.worker.terminate();
        URL.revokeObjectURL(w.url);
        w = null;
      }
    },
  };
  ticker.start();
  return ticker;
}
