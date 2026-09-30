// The story content registry: missions, cast, chapters and dialogue live in data modules
// written by other hands (shared/story/index.js and friends: missions.js, cast.js,
// dialogue.js). The engine, the session and the UI never import those files directly; they
// ask this registry, which `setStoryContent()` fills once at start-up (ui/story-content.js is
// the single wiring point). Tests and the dev tools use the stub content in stub-content.js.
//
// The registry understands the data model of STORY.md §5.4 and its extensions:
//   mission  { id, chapter, index, title, blurb, map, time, mode, level:[lo,hi], party, requires:[ids],
//              hub:null|hideoutId, after, briefing:[line], debrief:[line], rewards, stars, bonus, notes }
//   chapter  { n, title, missions:[ids], hub, arrival:{ hideout, flag, scene:[line] }|null, epilogue?:[line] }
//   line     { who, text, when?:{ flags, notFlags } }        {day} {crew} {scrap} are filled in
//   dialogue { talk: { [npc]: { [stage]: { greet:[text], topics:[{ id, prompt, lines, when?, once?, setFlags? }] } } },
//              stages, idle }  and the pure helpers conditionMet, stageFor, conversation, expandTokens
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

/** The hideout an old-style campaign starts in (when no content says otherwise). */
export const FIRST_HIDEOUT = 'roadhouse';

/** Display names of the hideouts (the hub maps carry their own `name`). */
export const HIDEOUT_NAMES = { roadhouse: 'The Roadhouse', depot: 'Blackwater Depot', farmstead: 'Harlan Farmstead' };

/** The hideout ids a world may be in. */
export const HIDEOUT_IDS_LIST = ['roadhouse', 'depot', 'farmstead'];

/** The day the story starts on; the bed and every won mission move it on. */
export const START_DAY = 41;

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
  narrator: { id: 'narrator', name: 'Narrator', role: '', portrait: 'narrator', color: '#c9c9c9', voice: { pitch: 0.8, rate: 0.9 } },
  crew: { id: 'crew', name: 'The crew', role: '', portrait: 'soldier', color: '#eeebe3', voice: { pitch: 1, rate: 1 } },
};

const EMPTY = () => ({
  missions: [], cast: {}, dialogue: null, chapters: DEFAULT_CHAPTERS, nextNodes: null, epilogue: null, epilogueFlag: 'seen_epilogue',
});
let content = EMPTY();

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
 * Install the story content. Accepts the module namespaces (or plain arrays/objects). The
 * whole `shared/story/index.js` namespace can be passed as `story` in one go:
 *   setStoryContent({ story: indexModule })
 * or piece by piece: missions (array or a module exporting MISSIONS), cast (an object by id
 * or CAST), dialogue (DIALOGUE), chapters (CHAPTERS), nextNodes(world), epilogue, and the
 * dialogue helpers conditionMet / stageFor / conversation / expandTokens.
 * @param {object} c
 */
export function setStoryContent(c = {}) {
  const s = c.story || {};
  const pick = (a, b) => (a !== undefined ? a : b);
  const missions = asArray(pick(c.missions, s.MISSIONS)).filter((m) => m && typeof m.id === 'string');
  missions.sort((a, b) => (a.chapter - b.chapter) || (a.index - b.index));
  const dialogue = pick(c.dialogue, s.DIALOGUE) || null;
  const chapters = pick(c.chapters, s.CHAPTERS);
  content = {
    missions,
    cast: asMap(pick(c.cast, s.CAST)),
    dialogue,
    chapters: Array.isArray(chapters) && chapters.length ? chapters : DEFAULT_CHAPTERS,
    nextNodes: typeof pick(c.nextNodes, s.nextNodes) === 'function' ? pick(c.nextNodes, s.nextNodes) : null,
    epilogue: pick(c.epilogue, s.EPILOGUE) || null,
    epilogueFlag: pick(c.epilogueFlag, s.EPILOGUE_FLAG) || 'seen_epilogue',
    helpers: {
      conditionMet: pick(c.conditionMet, s.conditionMet),
      stageFor: pick(c.stageFor, s.stageFor),
      conversation: pick(c.conversation, s.conversation),
      expandTokens: pick(c.expandTokens, s.expandTokens),
    },
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

/** The chapter list ({ n, title, ... }). */
export function getChapters() {
  return content.chapters;
}

/** A chapter by number, or null. */
export function getChapter(n) {
  return content.chapters.find((q) => q.n === n) || null;
}

/** Title of chapter `n`. */
export function chapterTitle(n) {
  const c = getChapter(n);
  return c ? c.title : `Chapter ${n}`;
}

/** The content's own next-node function (S4's index.js nextNodes), or null. */
export function getNextNodesOverride() {
  return content.nextNodes;
}

/** The epilogue scene lines and the flag that marks it as seen. */
export function getEpilogue() {
  return { lines: content.epilogue, flag: content.epilogueFlag };
}

/**
 * A speaking character: the content's cast entry, else a default one, else a generic card.
 * The portrait comes from `portrait` (a class id or 'radio' / 'narrator'), else the `look.cls`
 * of an NPC model, else a soldier.
 * @param {string} id
 */
export function castOf(id) {
  const key = String(id || 'crew');
  const own = Object.hasOwn(content.cast, key) ? content.cast[key] : null;
  const base = Object.hasOwn(DEFAULT_CAST, key) ? DEFAULT_CAST[key] : null;
  const src = { ...(base || {}), ...(own || {}) };
  const accent = own && own.portrait && typeof own.portrait === 'object' ? own.portrait.accent : null;
  let portrait = typeof src.portrait === 'string' ? src.portrait : null;
  if (own && own.portrait && typeof own.portrait === 'object') {
    // (a content portrait is a set of hints: the class card comes from the NPC model)
    if (own.radioOnly || own.portrait.pose === 'radio') portrait = 'radio';
    else if (own.system || own.portrait.pose === 'none') portrait = 'narrator';
    else portrait = (own.look && own.look.cls) || (base && base.portrait) || 'soldier';
  }
  if (!portrait) portrait = (src.look && src.look.cls) || src.cls || 'soldier';
  return {
    id: key,
    name: typeof src.name === 'string' && src.name ? src.name : key.charAt(0).toUpperCase() + key.slice(1),
    role: typeof src.role === 'string' ? src.role : '',
    portrait,
    color: typeof accent === 'string' ? accent : typeof src.color === 'string' ? src.color : '#eeebe3',
    voice: { pitch: Number(src.voice && src.voice.pitch) || 1, rate: Number(src.voice && src.voice.rate) || 1 },
  };
}

/** The dialogue module as installed (or null). */
export function getDialogue() {
  return content.dialogue;
}

// ---- the pure dialogue helpers (content's own, else these) ----------------------------------------

const doneOf = (w) => (w && w.progress && w.progress.completed) || {};
const flagsOf = (w) => (w && w.progress && w.progress.flags) || {};

/** Does a `when` condition ({ flags, notFlags, done, notDone }) hold in this world? No condition = yes. */
export function conditionMet(when, world) {
  const f = content.helpers && content.helpers.conditionMet;
  if (typeof f === 'function') return f(when, world);
  if (!when) return true;
  const done = doneOf(world), flags = flagsOf(world);
  if (when.flags && !when.flags.every((k) => flags[k])) return false;
  if (when.notFlags && when.notFlags.some((k) => flags[k])) return false;
  if (when.done && !when.done.every((id) => done[id])) return false;
  if (when.notDone && when.notDone.some((id) => done[id])) return false;
  return true;
}

/**
 * Fill {day} {crew} {scrap} in a text.
 * @param {string} text
 * @param {{ day?: number, crew?: string, scrap?: number }} ctx
 */
export function expandTokens(text, ctx = {}) {
  const f = content.helpers && content.helpers.expandTokens;
  if (typeof f === 'function') return f(text, ctx);
  return String(text).replace(/\{(day|crew|scrap)\}/g, (_, k) => (ctx[k] !== undefined ? String(ctx[k]) : ''));
}

/** The values {day} {crew} {scrap} stand for in this world. */
export function sceneContext(world) {
  return {
    day: world && Number.isFinite(world.day) ? world.day : START_DAY,
    crew: world && world.name ? world.name : 'the crew',
    scrap: world && world.hideout && world.hideout.stash ? world.hideout.stash.scrap | 0 : 0,
  };
}

/**
 * Scene lines ready to play: lines whose `when` fails are dropped, tokens are filled in.
 * @param {object[]} lines
 * @param {object|null} world
 * @param {{ crew?: string, day?: number, scrap?: number }} [ctx]
 */
export function playableLines(lines, world, ctx = null) {
  if (!Array.isArray(lines)) return [];
  if (!ctx) ctx = sceneContext(world);
  const out = [];
  for (const l of lines) {
    if (!l || typeof l.text !== 'string') continue;
    if (l.when && !conditionMet(l.when, world)) continue;
    out.push({ ...l, text: expandTokens(l.text, ctx) });
  }
  return out;
}

/** The visit stage of a hideout (S4's `stageFor`), or null. */
export function stageFor(hideoutId, world) {
  const f = content.helpers && content.helpers.stageFor;
  if (typeof f === 'function') return f(hideoutId, world);
  const stages = content.dialogue && content.dialogue.stages;
  if (!stages) return null;
  let found = null;
  for (const id of Object.keys(stages)) {
    const s = stages[id];
    if (s.hideout === hideoutId && conditionMet(s.when, world)) found = id;
  }
  return found;
}

/**
 * What an NPC says when a survivor walks up to them in the hideout:
 * { greet: string, topics: [{ id, prompt, lines, once?, setFlags? }] }.
 * @param {string} npc cast id
 * @param {string} hideoutId
 * @param {object} world
 * @param {Set<string>|object|null} heard topic ids already heard this visit
 * @param {number} pick 0..1 choosing the greeting
 */
export function conversationFor(npc, hideoutId, world, heard = null, pick = 0) {
  const d = content.dialogue;
  try {
    const f = content.helpers && content.helpers.conversation;
    if (typeof f === 'function') return f(npc, stageFor(hideoutId, world), world, heard, pick);
    const stage = stageFor(hideoutId, world);
    const tree = d && d.talk && d.talk[npc] && d.talk[npc][stage];
    const wasHeard = (id) => (heard ? (typeof heard.has === 'function' ? heard.has(id) : !!heard[id]) : false);
    if (tree && Array.isArray(tree.greet) && tree.greet.length) {
      return {
        greet: tree.greet[Math.floor(pick * tree.greet.length) % tree.greet.length],
        topics: (tree.topics || []).filter((tp) => conditionMet(tp.when, world) && !(tp.once && wasHeard(tp.id))),
      };
    }
    const idle = d && d.idle && d.idle[npc];
    if (idle && idle.length) return { greet: idle[Math.floor(pick * idle.length) % idle.length], topics: [] };
  } catch {
    // bad content never stops the game
  }
  const c = castOf(npc);
  return { greet: c.role ? `${c.name} nods. "Keep your head down out there."` : 'Keep your head down out there.', topics: [] };
}

/** Every world flag that dialogue topics may set (the host lets a player set these, and only these, from a talk). */
export function contentFlags() {
  const out = new Set();
  const talk = content.dialogue && content.dialogue.talk;
  if (talk) {
    for (const npc of Object.keys(talk)) {
      for (const stage of Object.keys(talk[npc] || {})) {
        for (const tp of (talk[npc][stage] && talk[npc][stage].topics) || []) {
          for (const f of Object.keys(tp.setFlags || {})) out.add(f);
        }
      }
    }
  }
  return out;
}

/** Look up a named scene ("intro") in the content's `scenes` if it has any. */
export function getScene(id) {
  const d = content.dialogue;
  if (!d) return null;
  for (const k of ['scenes', 'SCENES']) {
    const map = d[k];
    if (map && Object.hasOwn(map, id)) {
      const s = map[id];
      return Array.isArray(s) ? s : Array.isArray(s && s.lines) ? s.lines : null;
    }
  }
  return null;
}

/** The pre-mission pep talk of a mission (lines) or null. */
export function pepFor(missionId) {
  const pep = content.dialogue && content.dialogue.pep;
  return pep && Object.hasOwn(pep, missionId) && Array.isArray(pep[missionId]) ? pep[missionId] : null;
}

/**
 * A quip for the retry screen (one line, as a scene of one) or null.
 * @param {string} missionId
 * @param {number} pick 0..1
 */
export function retryQuip(missionId, pick = 0) {
  const r = content.dialogue && content.dialogue.retry;
  if (!r) return null;
  const own = r.byMission && Object.hasOwn(r.byMission, missionId) ? r.byMission[missionId] : null;
  const pool = [...(Array.isArray(own) ? own : []), ...(Array.isArray(r.general) ? r.general : [])];
  if (!pool.length) return null;
  return pool[Math.floor(Math.min(0.999, Math.max(0, pick)) * pool.length)];
}

/** A line of station flavour ("Scrap in, damage out. You have {scrap}."), or null. */
export function stationLine(kind, pick = 0) {
  const s = content.dialogue && content.dialogue.stations;
  const e = s && Object.hasOwn(s, kind) ? s[kind] : null;
  if (!e || !Array.isArray(e.lines) || !e.lines.length) return null;
  return e.lines[Math.floor(Math.min(0.999, Math.max(0, pick)) * e.lines.length)];
}

/** Reset to no content (tests). */
export function clearStoryContent() {
  content = EMPTY();
}
