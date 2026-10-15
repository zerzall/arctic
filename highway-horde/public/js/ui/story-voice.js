// Optional spoken dialogue through the browser's speechSynthesis API. OFF by default (the
// Settings → Audio toggle "Spoken dialogue"); each character gets a pitch and rate of their
// own (shared/story/content.js castOf().voice) and a stable voice from the ones installed.

import { castOf } from '../shared/story/content.js';

function synth() {
  try {
    return typeof globalThis.speechSynthesis === 'object' && globalThis.speechSynthesis ? globalThis.speechSynthesis : null;
  } catch {
    return null;
  }
}

/** True when this browser can speak at all. */
export function speechSupported() {
  return !!synth() && typeof globalThis.SpeechSynthesisUtterance === 'function';
}

function hash(s) {
  let n = 0;
  for (const ch of String(s)) n = (n * 33 + ch.charCodeAt(0)) >>> 0;
  return n;
}

/**
 * @param {() => { speech?: boolean, master?: number, muted?: boolean }} getSettings the client settings
 */
export function createVoice(getSettings) {
  let current = null;

  function pickVoice(who) {
    const s = synth();
    if (!s || typeof s.getVoices !== 'function') return null;
    const all = s.getVoices().filter((v) => /^en/i.test(v.lang));
    if (!all.length) return null;
    return all[hash(who) % all.length];
  }

  return {
    /** Speak one line in the character's voice (a no-op unless the setting is on). */
    speak(text, who) {
      const set = getSettings();
      if (!set || !set.speech || set.muted || !speechSupported()) return;
      this.cancel();
      try {
        const c = castOf(who);
        const u = new globalThis.SpeechSynthesisUtterance(String(text));
        u.pitch = Math.min(2, Math.max(0, c.voice.pitch));
        u.rate = Math.min(2, Math.max(0.5, c.voice.rate));
        u.volume = Math.min(1, Math.max(0, Number.isFinite(set.master) ? set.master : 0.8));
        const v = pickVoice(c.id);
        if (v) u.voice = v;
        current = u;
        synth().speak(u);
      } catch {
        // speech is best-effort
      }
    },
    cancel() {
      current = null;
      try {
        const s = synth();
        if (s) s.cancel();
      } catch {
        // ignore
      }
    },
    get speaking() {
      try {
        const s = synth();
        return !!(s && s.speaking);
      } catch {
        return false;
      }
    },
  };
}
