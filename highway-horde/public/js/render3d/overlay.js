// PLACEHOLDER (created by WORLD so renderer3d.js loads; ACTORS owns and replaces this file).
// Sub-system contract (SPEC §7.5): createX(ctx) → { update(view, frame), addEvents?, setQuality?, dispose() }.

/** No-op placeholder sub-system. */
export function createOverlay(ctx) {
  void ctx;
  return {
    update() {},
    addEvents() {},
    setQuality() {},
    dispose() {},
  };
}
