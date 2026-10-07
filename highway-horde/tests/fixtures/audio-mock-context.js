// Minimal stand-in for a WebAudio context so the audio engine's bookkeeping (voice
// slots, stealing, rate limits, loops, spatialisation) can be tested in Node. Nodes only
// record what was done to them; `time` is advanced by hand.

class Param {
  constructor(v) {
    this.value = v;
    this.events = 0;
    /** Automation as scheduled: [kind, value, time, timeConstant?] (for offline mixdowns in tests). */
    this.log = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events++;
    this.log.push(['set', v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events++;
    this.log.push(['lin', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.events++;
    this.log.push(['exp', v, t]);
  }
  setTargetAtTime(v, t, tc) {
    this.value = v;
    this.events++;
    this.log.push(['target', v, t, tc]);
  }
  cancelScheduledValues() {}
}

class Node {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = new Set();
    ctx.nodes[kind] = (ctx.nodes[kind] || 0) + 1;
  }
  connect(n) {
    this.outputs.add(n);
    return n;
  }
  disconnect() {
    this.outputs.clear();
  }
}

class Source extends Node {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.playbackRate = new Param(1);
    this.frequency = new Param(440);
    this.detune = new Param(0);
    this.loop = false;
    this.buffer = null;
    this.started = null;
    this.offset = 0;
    this.stopped = null;
    this.onended = null;
  }
  start(t = 0, offset = 0) {
    if (this.started !== null) throw new Error('InvalidStateError: start twice');
    this.started = t;
    this.offset = offset;
    this.ctx.sources.push(this);
  }
  stop(t = 0) {
    if (this.started === null) throw new Error('InvalidStateError: stop before start');
    this.stopped = t;
  }
}

export class MockAudioContext {
  constructor(sampleRate = 8000) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'running';
    this.nodes = {};
    this.sources = [];
    this.destination = new Node(this, 'destination');
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createGain() {
    const n = new Node(this, 'gain');
    n.gain = new Param(1);
    return n;
  }
  createBiquadFilter() {
    const n = new Node(this, 'biquad');
    n.frequency = new Param(350);
    n.Q = new Param(1);
    n.type = 'lowpass';
    return n;
  }
  createStereoPanner() {
    const n = new Node(this, 'panner');
    n.pan = new Param(0);
    return n;
  }
  createConvolver() {
    const n = new Node(this, 'convolver');
    n.buffer = null;
    return n;
  }
  createDynamicsCompressor() {
    const n = new Node(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    return n;
  }
  createWaveShaper() {
    const n = new Node(this, 'shaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }
  createOscillator() {
    const n = new Source(this, 'oscillator');
    n.type = 'sine';
    return n;
  }
  createBufferSource() {
    return new Source(this, 'bufferSource');
  }
  createBuffer(channels, length, sampleRate) {
    const data = [];
    for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
    return {
      length, sampleRate, numberOfChannels: channels, duration: length / sampleRate,
      getChannelData: (i) => data[i],
      copyToChannel: (src, i) => data[i].set(src),
    };
  }
  /** Sources that are started and not yet finished at `currentTime`. */
  playing() {
    return this.sources.filter((s) => {
      if (s.started === null || s.started > this.currentTime) return false;
      if (s.stopped !== null && s.stopped <= this.currentTime) return false;
      if (s.loop || !s.buffer) return true;
      return s.started + s.buffer.duration / s.playbackRate.value > this.currentTime;
    });
  }
}
