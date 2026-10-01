// Rolling one-second network counters for session.stats.

export class NetStats {
  constructor() {
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.snapshots = 0;
    this.frames = 0;
    this.windowStart = null;
    /** Public, updated in place about once per second. */
    this.view = { ping: 0, fps: 0, kbpsIn: 0, kbpsOut: 0, snapshotsPerSec: 0 };
  }

  addIn(bytes) {
    this.bytesIn += bytes;
  }

  addOut(bytes) {
    this.bytesOut += bytes;
  }

  addSnapshot() {
    this.snapshots++;
  }

  addFrame() {
    this.frames++;
  }

  /** Close the window if a second has passed. @param {number} now seconds */
  roll(now) {
    if (this.windowStart === null) {
      this.windowStart = now;
      return;
    }
    const elapsed = now - this.windowStart;
    if (elapsed < 1) return;
    const v = this.view;
    v.kbpsIn = Math.round((this.bytesIn * 8) / 1000 / elapsed * 10) / 10;
    v.kbpsOut = Math.round((this.bytesOut * 8) / 1000 / elapsed * 10) / 10;
    v.snapshotsPerSec = Math.round((this.snapshots / elapsed) * 10) / 10;
    v.fps = Math.round(this.frames / elapsed);
    this.bytesIn = this.bytesOut = this.snapshots = this.frames = 0;
    this.windowStart = now;
  }
}
