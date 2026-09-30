// The story content registry: missions, cast and dialogue live in data modules written by
// other hands (STORY.md §5.4: shared/story/missions.js, cast.js, dialogue.js). The engine,
// the session and the UI never import those files directly; they ask this registry, which
// `setStoryContent()` fills once at start-up (ui/story-content.js is the single wiring
// point). Tests and the dev tools use the stub content in stub-content.js.
//
// Everything is optional: with no cast the portraits fall back to a generic card, with no
// dialogue a hideout conversation is a one-liner. Missing pieces never throw.

/** Chapters of the campaign (titles from STORY.md §2); content may replace them. */
export const DEFAULT_CHAPTERS = [
  { n: 1, title: 'Dead Highway' },
  { n: 2, title: 'Last Chance' },
  { n: 3, title: 'Blackwater' },
  { n: 4, title: 'Delta' },
  { n: 5, title: 'Harlan County' },
  { n: 6, title: 'Haven' },
];

/** Which hideout the crew rests in once a chapter is finished (chapter 6 is the epilogue). */
export const HIDEOUT_AFTER_CHAPTER = { 1: 'roadhouse', 2: 'roadhouse', 3: 'depot', 4: 'depot', 5: 'farmstead' };

/** The hideout the campaign starts in. */
export const FIRST_HIDEOUT = 'roadhouse';

/** Display names of the hideouts (the hub maps carry their own `name`). */
export const HIDEOUT_NAMES = { roadhouse: 'The Roadhouse', depot: 'Blackwater Depot', farmstead: 'Harlan Farmstead' };

/**
 * Speaking characters when the content has no cast of its own. `portrait` picks the class
 * card the portrait is drawn from (render/portrait.js), `color` tints the name.
 */
export const DEFAULT_CAST = {
  mara: { id: 'mara', name: 'Mara Voss', role: 'Field medic', portrait: 'medic', color: '#ff8a80', voice: { pitch: 1.25, rate: 1 } },
  deke: { id: 'deke', name: 'Deke Harlan', role: 'Mechanic', portrait: 'heavy', color: '#ffb74d', voice: { pitch: 0.6, rate: 0.9 } },
  ozzy: { id: 'ozzy', name: 'Ozzy', role: 'Radio', portrait: 'engineer', color: '#81d4fa', voice: { pitch: 1.5, rate: 1.15 } },
  okafor: { id: 'okafor', name: 'Sgt. Okafor', role: 'Army sergeant', portrait: 'soldier', color: '#a5d6a7', voice: { pitch: 0.75, rate: 0.95 } },
  priya: { id: 'priya', name: 'Priya Nair', role: 'Scout', portrait: 'scout', color: '#ce93d8', voice: { pitch: 1.35, rate: 1.05 } },
  june: { id: 'june', name: 'June', role: '', portrait: 'scout', color: '#fff59d', voice: { pitch: 1.8, rate: 1.1 } },
  warden: { id: 'warden', name: 'The Warden', role: 'Radio voice', portrait: 'radio', color: '#ffc400', voice: { pitch: 0.9, rate: 0.85 } },
  crew: { id: 'crew', name: 'The crew', role: '', portrait: 'soldier', color: '#eeebe3', voice: { pitch: 1, rate: 1 } },
};

let content = { missions: [], cast: {}, dialogue: null, chapters: DEFAULT_CHAPTERS };

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    for (const k of ['MISSIONS', 'missions', 'default', 'list']) if (Array.isArray(v[k])) return v[k];
  }
  return [];
}

function asMap(v) {
  if (Array.isArray(v)) {
    const out = {};
    for (const c of v) if (c && typeof c.id === 'string') out[c.id] = c;
    return out;
  }
  if (v && typeof v === 'object') {
    for (const k of ['CAST', 'cast', 'default']) if (v[k] && typeof v[k] === 'object') return asMap(v[k]);
    return v;
  }
  return {};
}

/**
 * Install the story content. Accepts the module namespaces (or plain arrays/objects):
 * `missions` = the mission array (or a module exporting MISSIONS), `cast` = characters by
 * id (or CAST), `dialogue` = whatever dialogue.js exports.
 * @param {{ missions?: *, cast?: *, dialogue?: *, chapters?: {n: number, title: string}[] }} c
 */
export function setStoryContent(c = {}) {
  const missions = asArray(c.missions).filter((m) => m && typeof m.id === 'string');
  missions.sort((a, b) => (a.chapter - b.chapter) || (a.index - b.index));
  content = {
    missions,
    cast: asMap(c.cast),
    dialogue: c.dialogue || null,
    chapters: Array.isArray(c.chapters) && c.chapters.length ? c.chapters : DEFAULT_CHAPTERS,
  };
}

/** Every mission, in campaign order. */
export function getMissions() {
  return content.missions;
}

/** A mission by id, or null. */
export function getMission(id) {
  return content.missions.find((m) => m.id === id) || null;
}

/** The chapter list ({ n, title }). */
export function getChapters() {
  return content.chapters;
}

/** Title of chapter `n`. */
export function chapterTitle(n) {
  const c = content.chapters.find((q) => q.n === n);
  return c ? c.title : `Chapter ${n}`;
}

/**
 * A speaking character: the content's cast entry, else a default one, else a generic card.
 * @param {string} id
 * @returns {{ id: string, name: string, role: string, portrait: string, color: string, voice: {pitch: number, rate: number} }}
 */
export function castOf(id) {
  const key = String(id || 'crew');
  const own = Object.hasOwn(content.cast, key) ? content.cast[key] : null;
  const base = Object.hasOwn(DEFAULT_CAST, key) ? DEFAULT_CAST[key] : null;
  const src = { ...(base || {}), ...(own || {}) };
  return {
    id: key,
    name: typeof src.name === 'string' && src.name ? src.name : key.charAt(0).toUpperCase() + key.slice(1),
    role: typeof src.role === 'string' ? src.role : '',
    portrait: typeof src.portrait === 'string' ? src.portrait : typeof src.cls === 'string' ? src.cls : 'soldier',
    color: typeof src.color === 'string' ? src.color : '#eeebe3',
    voice: { pitch: Number(src.voice && src.voice.pitch) || 1, rate: Number(src.voice && src.voice.rate) || 1 },
  };
}

/** The dialogue module as installed (or null). */
export function getDialogue() {
  return content.dialogue;
}

/** A named scene from the content's dialogue (`scenes[id]` or `SCENES[id]`), as an array of lines, or null. */
export function getScene(id) {
  const d = content.dialogue;
  if (!d) return null;
  for (const k of ['scenes', 'SCENES']) {
    const map = d[k] || (d.default && d.default[k]);
    if (map && Object.hasOwn(map, id)) {
      const s = map[id];
      return Array.isArray(s) ? s : Array.isArray(s && s.lines) ? s.lines : null;
    }
  }
  return null;
}

/**
 * What an NPC says when a survivor talks to them in the hideout. Asks the content
 * (`dialogue.talk(npc, ctx)` when it has one, else `dialogue.talks[npc]`), falls back to
 * a one-line greeting.
 * @param {string} npc NPC id (the cast id)
 * @param {{ chapter?: number, flags?: object, completed?: object }} [ctx]
 * @returns {{ who: string, text: string, ms?: number }[]}
 */
export function talkLines(npc, ctx = {}) {
  const d = content.dialogue;
  try {
    if (d && typeof d.talk === 'function') {
      const r = d.talk(npc, ctx);
      if (Array.isArray(r) && r.length) return r;
    } else if (d && d.talks && Array.isArray(d.talks[npc]) && d.talks[npc].length) {
      const list = d.talks[npc];
      const r = list[((ctx.chapter || 1) - 1) % list.length];
      return Array.isArray(r) ? r : [{ who: npc, text: String(r) }];
    }
  } catch {
    // bad content never stops the game
  }
  const c = castOf(npc);
  return [{ who: npc, text: c.role ? `${c.name} nods. "Keep your head down out there."` : 'Keep your head down out there.' }];
}

/** Reset to no content (tests). */
export function clearStoryContent() {
  content = { missions: [], cast: {}, dialogue: null, chapters: DEFAULT_CHAPTERS };
}
