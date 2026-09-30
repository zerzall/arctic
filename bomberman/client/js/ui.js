// ui.js - every screen of Blast Party as plain DOM: title, lobby, game HUD, round-end card, results, menus (docs/SPEC.md 8.3).
//
// A PURE VIEW. It never touches the network or game state: main.js pushes data in through the render methods below and
// hears about what the player wants through the callbacks. Player-supplied strings (names, chat) only ever enter the DOM as
// text nodes / textContent, inside <bdi>, never as markup.
//
//   const ui = new UI(document.getElementById('app'), { onCreate, onJoin, ... });
//   const { wrap, canvas, touchRoot } = ui.getGameElements();
//
// CALLBACKS (all optional; a throwing callback is caught and logged)
//   onCreate(name)  onJoin(code, name)  onPractice(name)         title screen. `name` is already trimmed and never empty.
//   onProfile({ id?, name?, color?, team? })                     `id` only when the host edits a bot's team.
//   onSettings(patch)  onAddBot(level)  onRemoveBot(id)  onKick(id)  onStart()  onBackToLobby()   host controls
//   onChat(text)  onEmote(e 0..7)  onLeave()
//   onMute(bool)  onVolume(v 0..1)
//   onHost(name)  onJoinFriend(name)  onAddFriend()              the single-file download only (window.__BP_SINGLE__), see "P2P dialogs" below
//   onToggleEffects(reduce)   true = the player asked for REDUCED effects (the setting is called "Reduce effects").
//   onControlsSide('right' | 'left')                             not in the spec's list; input.js should swap joystick and BOMB.
//
// RENDER METHODS (SPEC 8.3 names first)
//   showTitle({ name?, code?, error? })  home screen; also forgets everything about the previous room. `code` (validated, else
//                                        ignored) pre-fills and highlights the Join box; `error` shows an alert in the card.
//   showConnecting(text | null, onCancel?) blocking "connecting" overlay with an elapsed-seconds counter (and a Cancel button when
//                                        `onCancel` is given); null hides it.
//   showLobby(lobbyMsg)                  ingest a `lobby` message. Safe to call on EVERY lobby frame in any phase: the lobby
//                                        screen is only shown when phase === 'lobby'; other phases just refresh what the menu and
//                                        results screen know.
//   showGame({ players })                show the game screen for a new round (`players` = the `round` message's list, used to
//                                        build the HUD chips) and reset the per-round HUD.
//   updateHud(hudModel)                  SPEC 8.6 hudModel; cheap enough for 10 Hz (only changed DOM is written).
//   setPing(ms | null)                   RTT in ms for the signal meters; "Local" is shown when lobby.local.
//   showCountdown('3' | '2' | '1' | 'GO!' | null)
//   showRoundEnd(roundEndMsg, lobbyPlayers)   winner/draw card with score pips and confetti; showRoundEnd(null) hides it.
//   showResults(matchEndMsg)             podium, awards, standings; screen 'results'.
//   toast(text, kind = 'info', { ms?, action?: { label, onClick } })   kind: 'info' | 'good' | 'warn' | 'error'
//   killfeed(text)  addChat({ from, name, text, old?, sys? })  showMenu(bool)  showReconnecting(secondsLeft | null)
//   getGameElements() -> { wrap, canvas, touchRoot }   wrap = #stage (observe this for resize), canvas = #arena, touchRoot = #touch
//   show(screen)                         'title' | 'lobby' | 'game' | 'results' (the methods above call it)
//
// EXTRAS (not in the spec list; all optional for main.js)
//   showDialog({ title, text?, tone?: 'info'|'error'|'good', dismissible?, actions?: [{ label, kind?: 'primary'|'glass'|'danger', onClick?, keepOpen? }] })
//                                        for "That party has ended", "Can't reach the server", kicked, paused ...   hideDialog()
//   banner(text, kind = 'info'|'danger'|'good', ms)   big banner over the arena (e.g. banner('Showdown in 15', 'danger') on the
//                                        `showdown` event). Sudden death gets its banner automatically when hudModel.suddenDeath turns true.
//   toggleEmoteBar(force?)               opens/closes the emote picker (what the T key and the touch emote button should call).
//   announce(text)                       screen-reader announcement.
//   showHowTo(bool)  showSettings(bool)  menuOpen (getter)  setTouchLayout(bool | null)  ready (promise: sprites.js / qr.js loaded or failed)
//   setSettings({ volume, muted, reduce, hand })   push saved audio/effects/controls state in; `ui.settings` holds the current values
//                                        (`reduce` and `hand` are persisted by the UI itself, `volume` and `muted` are audio.js's).
//
// PURE HELPERS exported for tests and main.js: extractRoomCode, isRoomCode, formatClock, pingQuality, startBlocker, computeAwards,
//   podiumGroups, describePlayer, spellCode, randomName, CODE_LETTERS. Importing this module touches no DOM.
//
// SHAPES (see SPEC 4.4 / 8.6): lobbyMsg = { code, phase, hostId, you, local?, settings, players: [{ id, name, color, team, isBot, level,
//   connected, isHost, wins, waiting }], round: { n, winsNeeded } }.  roundEndMsg = { n, winnerId, winnerTeam, draw, reason, scores: [{ id, wins,
//   team }], matchOver }.  matchEndMsg = { winnerId, winnerTeam, reason, standings: [{ id, name, color, team, wins, kills, deaths, selfKills, blocks,
//   items, place }] }.  hudModel = { roundNo, winsNeeded, timeLeftSec | null, suddenDeath, state, mode, players: [{ id, name, color, team, alive,
//   wins, bombsMax, range, speedLv, kick, glove, shield, curse, isBot, isMe, connected, waiting }] }.
//
// DOM CONTRACT: index.html ships the static game container (#game > #stage > canvas#arena, #hud, #touch), #overlays and #sr-live;
// anything missing is created. #hud is display:contents; its children are laid out by css/style.css. input.js owns everything inside
// #touch (this file and the stylesheet never style .bp-touch*).
//
// INTERPRETATIONS where the spec is ambiguous (also listed in the report):
//   * Awards: given only when exactly ONE fighter holds the best value; the "most" awards also need a value above zero, "Survivor"
//     (fewest deaths) may be 0. The spec says "distinct non-zero winners".
//   * The room-code limit of qr.js is 134 bytes (version 6-L), the spec says 106 (that is version 5-L); the QR is simply hidden
//     when qrMatrix() returns null.
//   * Title screen focus: the name field on a first visit is only focused with a fine pointer (a phone's keyboard must not pop up
//     unasked); coarse pointers get the heading focused instead.
//   * Optional modules (sprites.js for portraits and icons, shared/qr.js for the QR code) are loaded with dynamic import() inside
//     try/catch; without them CSS/SVG stand-ins are drawn.

import { PLAYER_COLORS, EMOTES, SETTINGS_DEFS, MAX_PLAYERS, MIN_TO_START, TIMEOUTS, SHIELD_FOREVER } from '../../shared/constants.js';

// ================================================================================================
// Pure helpers (no DOM; exported so they can be tested in Node)
// ================================================================================================

/** Letters a room code may contain (SPEC 1.2): no vowels, so a code never spells a word. */
export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** True for a well-formed room code. Used before a code is put anywhere in the DOM. */
export const isRoomCode = (code) => typeof code === 'string' && CODE_RE.test(code);

/**
 * Pulls a room code out of whatever the user typed or pasted: "kqxz", "KQXZ ", or a whole invite link.
 * Letters outside the code alphabet are dropped, so a typo never grows into an unjoinable code.
 */
export function extractRoomCode(raw) {
  const text = String(raw ?? '');
  const link = /\/r\/([A-Za-z]{4})(?![A-Za-z])/.exec(text);
  if (!link && text.includes('://')) return '';   // some other web address: nothing to salvage
  if (!link && /[^A-Za-z]/.test(text.trim())) {
    // A pasted sentence ("Join me: KQXZ"): take a standalone code-shaped word instead of every consonant in the text.
    const word = /(?:^|[^A-Za-z])([A-Za-z]{4})(?![A-Za-z])/g;
    for (let m = word.exec(text); m; m = word.exec(text)) if (CODE_RE.test(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  let code = '';
  for (const ch of (link ? link[1] : text).toUpperCase()) {
    if (CODE_LETTERS.includes(ch)) code += ch;
    if (code.length === 4) break;
  }
  return code;
}

/** "K, Q, X, Z": how a screen reader should spell a room code. */
export const spellCode = (code) => String(code).split('').join(', ');

/**
 * Whether a page address only works on the computer that shows it: localhost, 127.x.x.x, [::1], 0.0.0.0. An invite link built from
 * such an address (SPEC 1.2 derives it from location.origin) would send friends to THEIR OWN localhost, so the lobby explains instead.
 * @param {string} hostname `location.hostname` (IPv6 literals may arrive with their brackets)
 */
export function isLoopbackHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** The lobby's explanation when the page was opened through a loopback address, with the real port in the example. */
export const loopbackHint = (port) => `Others can't reach "localhost". Open this page through your computer's Wi-Fi address instead (for example http://192.168.x.x${port ? `:${port}` : ''}, printed in the server console), or run "npm run share" for a public link.`;

/** Seconds as m:ss ("2:05"); anything not a finite number of seconds gives the infinity sign. */
export function formatClock(sec) {
  if (!Number.isFinite(sec)) return '\u221e';
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The plain-object entries of a list from the network: a malformed message must not take the whole UI down. */
const records = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []);

/** Connection quality from a round-trip time in ms: 'good' | 'ok' | 'bad', or 'none' when unknown. */
export function pingQuality(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'none';
  return ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

/**
 * Why the host cannot start yet, or null when they can. Mirrors the Room's `need_players` / `need_teams` checks so the
 * button can say so before the server has to.
 */
export function startBlocker(lobby) {
  const players = records(lobby?.players);
  if (players.length < MIN_TO_START) return 'Add a bot or wait for a friend: you need at least 2 players.';
  if (lobby.settings?.mode === 'teams') {
    const sizes = [0, 0];
    for (const p of players) sizes[p.team === 1 ? 1 : 0]++;
    if (!sizes[0] || !sizes[1]) return 'Each team needs at least one player.';
  }
  return null;
}

/**
 * The podium steps of a finished match: up to three groups of fighters that share a place. Ranked by the `place` the server
 * sent; in team matches whole teams share a step (the winning team first), since every member carries the team's wins.
 * @returns {{place:number, people:object[]}[]}
 */
export function podiumGroups(standings, { byTeam = false } = {}) {
  const list = records(standings);
  if (!byTeam) {
    const places = [...new Set(list.map((s) => s.place))].sort((a, b) => a - b);
    return places.slice(0, 3).map((place) => ({ place, people: list.filter((s) => s.place === place) }));
  }
  const teams = new Map();
  for (const s of list) teams.set(s.team === 1 ? 1 : 0, [...(teams.get(s.team === 1 ? 1 : 0) ?? []), s]);
  const best = (people) => Math.max(...people.map((s) => Number(s.wins) || 0));
  const ordered = [...teams.values()].sort((a, b) => best(b) - best(a));
  const groups = [];
  ordered.forEach((people, i) => groups.push({ place: i > 0 && best(people) === best(ordered[i - 1]) ? groups[i - 1].place : i + 1, people }));
  return groups.slice(0, 3);
}

const AWARDS = [
  { stat: 'blocks', best: 'max', title: 'Demolition Expert', hint: 'Most blocks destroyed', icon: 'bomb', noun: ['block', 'blocks'] },
  { stat: 'kills', best: 'max', title: 'Terminator', hint: 'Most rivals blasted', icon: 'skull', noun: ['blast', 'blasts'] },
  { stat: 'items', best: 'max', title: 'Collector', hint: 'Most power-ups grabbed', icon: 'star', noun: ['power-up', 'power-ups'] },
  { stat: 'deaths', best: 'min', title: 'Survivor', hint: 'Fewest times blasted', icon: 'shield', noun: ['time blasted', 'times blasted'] },
  { stat: 'selfKills', best: 'max', title: 'Bomb Squad Casualty', hint: 'Most own goals', icon: 'ghost', noun: ['own goal', 'own goals'] },
];

/**
 * The awards of a finished match. An award is only given when exactly one fighter holds the best value, and (for the
 * "most" awards) that value is above zero. "Survivor" goes to the single fighter with the fewest deaths, which may be 0.
 * @returns {{stat:string,title:string,hint:string,icon:string,player:object,value:number,label:string}[]}
 */
export function computeAwards(standings) {
  const list = records(standings);
  if (list.length < 2) return [];
  const awards = [];
  for (const a of AWARDS) {
    const values = list.map((s) => Number(s[a.stat]) || 0);
    const target = a.best === 'max' ? Math.max(...values) : Math.min(...values);
    if (a.best === 'max' && target <= 0) continue;
    const holders = list.filter((s) => (Number(s[a.stat]) || 0) === target);
    if (holders.length !== 1) continue;
    awards.push({ stat: a.stat, title: a.title, hint: a.hint, icon: a.icon, player: holders[0], value: target, label: plural(target, a.noun[0], a.noun[1]) });
  }
  return awards;
}

const FUN_NAMES = ['Captain Boom', 'Fuse Fox', 'Pixel Pal', 'Zap Panda', 'Boom Bear', 'Turbo Toad', 'Spark Owl', 'Nova Newt', 'Dynamo Dan',
  'Kaboom Kid', 'Blasty', 'Sir Blastalot', 'Bomb Buddy', 'Cherry Bomb', 'Rocket Ron', 'Mighty Mo', 'Sunny Fuse', 'Wobble'];
/** A friendly default name, so nobody has to type before they can play. */
export const randomName = () => FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)];

const colorInfo = (index) => PLAYER_COLORS[index] ?? PLAYER_COLORS[0];
const teamLetter = (team) => (team === 1 ? 'B' : 'A');

/** "Ana, Blue with propeller, host, connected, 2 wins": the hidden text of a lobby row (SPEC 8.3). */
export function describePlayer(p, { you = -1 } = {}) {
  const c = colorInfo(p.color);
  const parts = [p.name, `${c.name} with ${c.accessory}`];
  if (p.id === you) parts.push('you');
  if (p.isHost) parts.push('host');
  if (p.isBot) parts.push(`bot${p.level ? `, ${p.level}` : ''}`);
  if (p.waiting) parts.push('watching this round');
  parts.push(p.connected === false ? 'reconnecting' : 'connected');
  parts.push(plural(p.wins | 0, 'win'));
  return parts.join(', ');
}

// ================================================================================================
// DOM helpers
// ================================================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds an element. `props`: class, text (textContent), value, on {event: fn}, dataset {k: v}, style (string or {--var: v}),
 * anything else becomes an attribute (true -> empty attribute, false/null/undefined -> skipped). Children may be nodes,
 * strings (always text, never markup), numbers, arrays or nothing. User-supplied strings only ever enter through here as text.
 */
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v == null || v === false) continue;
      if (key === 'class') node.className = v;
      else if (key === 'text') node.textContent = v;
      else if (key === 'value') node.value = v;
      else if (key === 'on') for (const ev of Object.keys(v)) node.addEventListener(ev, v[ev]);
      else if (key === 'dataset') Object.assign(node.dataset, v);
      else if (key === 'style') {
        if (typeof v === 'string') node.style.cssText = v;
        else for (const k of Object.keys(v)) node.style.setProperty(k, v[k]);
      } else node.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(node, kid);
    else node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/** A name or other user string inside <bdi>, so right-to-left text cannot reorder the text around it. */
const bdi = (text, cls = '') => el('bdi', { class: cls, text });

const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // private window or blocked storage: the setting simply does not stick
    }
  },
};

// ================================================================================================
// Icons: one inline SVG sprite sheet. Line icons draw with currentColor strokes, "glyph" icons fill with it.
// The game's own art (sprites.js) is preferred for items, curses and portraits; these are the fallbacks and the UI glyphs.
// ================================================================================================

const line = (inner) => `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const fill = (inner) => `<g fill="currentColor">${inner}</g>`;
const SPEAKER = '<path d="M3.6 9.6v4.8h3.7l4.7 3.9V5.7L7.3 9.6z"/>';

const ICONS = {
  close: line('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>'),
  check: line('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  down: line('<path d="M6 9l6 6 6-6"/>'),
  left: line('<path d="M15 5l-7 7 7 7"/>'),
  right: line('<path d="M9 5l7 7-7 7"/>'),
  arrow: line('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  copy: line('<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V7a3 3 0 0 1 3-3h8"/>'),
  paste: line('<rect x="5" y="5" width="14" height="16" rx="3"/><path d="M9 5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v1M9 12h6M9 16h4"/>'),
  share: line('<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>'),
  qr: line('<rect x="4" y="4" width="6" height="6" rx="1.4"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><rect x="4" y="14" width="6" height="6" rx="1.4"/><path d="M14 14h2.5v2.5H14zM19.5 14v.01M14 19.5v.01M17.5 19.5H20M20 17v.01"/>'),
  sliders: line('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  menu: line('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  volume: fill(SPEAKER) + line('<path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.4 6.6a8 8 0 0 1 0 10.8"/>'),
  mute: fill(SPEAKER) + line('<path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  smile: line('<circle cx="12" cy="12" r="9"/><path d="M8.3 14.2c1 1.7 2.3 2.5 3.7 2.5s2.7-.8 3.7-2.5"/>') + fill('<circle cx="9" cy="9.8" r="1.4"/><circle cx="15" cy="9.8" r="1.4"/>'),
  lock: line('<rect x="5" y="11" width="14" height="9.5" rx="2.6"/><path d="M8 11V8.2a4 4 0 0 1 8 0V11"/>'),
  unlock: line('<rect x="5" y="11" width="14" height="9.5" rx="2.6"/><path d="M8 11V8.2a4 4 0 0 1 7.6-1.7"/>'),
  link: line('<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  send: fill('<path d="M3.4 11.2L20.2 4c.9-.4 1.7.4 1.3 1.3L14.6 21.2c-.4.9-1.7.8-2-.1L10.8 15 4 13.2c-.9-.3-1-1.6-.6-2z"/>'),
  leave: line('<path d="M10 4H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h3M15 8l4 4-4 4M19 12H9"/>'),
  users: line('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.3c2.3 0 4 1.4 4.5 4.2"/>'),
  help: line('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.6 2.6 0 1 1 3.7 2.3c-.9.5-1.3 1-1.3 1.9"/>') + fill('<circle cx="12" cy="17.3" r="1.3"/>'),
  fullscreen: line('<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>'),
  dice: line('<rect x="4" y="4" width="16" height="16" rx="4.5"/>') + fill('<circle cx="9" cy="9" r="1.4"/><circle cx="15" cy="9" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="9" cy="15" r="1.4"/><circle cx="15" cy="15" r="1.4"/>'),
  refresh: line('<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4.5v4.5H15"/>'),
  home: line('<path d="M4 11.5L12 4.5l8 7M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5"/>'),
  eye: line('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  swap: line('<path d="M7 8h11l-3-3.5M17 16H6l3 3.5"/>'),
  bot: line('<rect x="5" y="8.5" width="14" height="10.5" rx="3.2"/><path d="M12 8.5V5M3 13v3M21 13v3"/><circle cx="12" cy="3.8" r="1.2"/>') + fill('<circle cx="9" cy="13.5" r="1.4"/><circle cx="15" cy="13.5" r="1.4"/>'),
  // Fallbacks for the game's item, curse and badge art (sprites.js draws the real ones)
  bomb: fill('<circle cx="10.8" cy="14" r="7.6"/><circle cx="19.6" cy="4.4" r="1.8"/>') + line('<path d="M15.6 8.6L18.4 5.8"/>'),
  flame: fill('<path d="M12 2.4c.9 3.6 5.6 5.7 5.6 11.2A5.6 5.6 0 0 1 12 19.2a5.6 5.6 0 0 1-5.6-5.6c0-2.3 1-3.8 2.3-5 .4 1.7 1.2 2.5 2.1 2.8C10.3 8.5 10.7 5.2 12 2.4z"/>'),
  speed: fill('<path d="M13.6 2.4L5.4 13.4h5.4l-1.5 8.2 9.3-12H12.7z"/>'),
  kick: fill('<path d="M6 3.5h6.2v7.3l6.5 2.4c1.4.5 2.1 1.5 2.1 3V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V5.5a2 2 0 0 1 2-2z"/>'),
  glove: fill('<path d="M7.5 21v-5L5 12.4c-.7-1.2.5-2.7 1.9-2L9 11.6V5.8a1.6 1.6 0 0 1 3.2 0V10V4.6a1.6 1.6 0 0 1 3.2 0V10V6.2a1.6 1.6 0 0 1 3.2 0v8.4c0 3-1.6 5-4.1 6.4V21z"/>'),
  shield: fill('<path d="M12 2.5l8 3v6.2c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8V5.5z"/>'),
  skull: fill('<path fill-rule="evenodd" d="M12 2.8c4.6 0 8 3.1 8 7.7 0 2.4-.9 4-2.4 5.1V19a1 1 0 0 1-1 1H7.4a1 1 0 0 1-1-1v-3.4C4.9 14.5 4 12.9 4 10.5 4 5.9 7.4 2.8 12 2.8zM8.6 9.4a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm6.8 0a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z"/>'),
  crown: fill('<path d="M3 8.2l4.6 4L12 5l4.4 7.2 4.6-4-1.9 10.8H4.9z"/>'),
  star: fill('<path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8 6.6 19.7l1-6.1L3.2 9.3l6.1-.9z"/>'),
  ghost: fill('<path fill-rule="evenodd" d="M12 3c4 0 6.6 3 6.6 7v10.6l-2.3-1.8-2.1 1.8-2.2-1.8-2.2 1.8-2.1-1.8-2.3 1.8V10C5.4 6 8 3 12 3zM9.6 9.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm4.8 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/>'),
  heart: fill('<path d="M12 20.5C5 15.4 3 12.2 3 9a4.7 4.7 0 0 1 9-1.9A4.7 4.7 0 0 1 21 9c0 3.2-2 6.4-9 11.5z"/>'),
  slow: fill('<path d="M6.5 3h11v3.2c0 2-1.4 3.4-3.2 4.3L13.4 12l.9 1.5c1.8.9 3.2 2.3 3.2 4.3V21h-11v-3.2c0-2 1.4-3.4 3.2-4.3l.9-1.5-.9-1.5C7.9 9.6 6.5 8.2 6.5 6.2z"/>'),
  rush: line('<path d="M5 6l6 6-6 6M12.5 6l6 6-6 6"/>'),
  reverse: line('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  nobomb: fill('<circle cx="10.8" cy="14" r="7.6"/>') + line('<path d="M4 4l16 16"/>'),
  spam: fill('<circle cx="7" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="3.2"/><circle cx="11.5" cy="16.5" r="3.2"/>'),
};

// Bigger multi-colour drawings (own viewBox). The gradients live in <defs> once and are referenced by url(#...).
const ART = {
  bomb: {
    viewBox: '0 0 128 132',
    body: `<ellipse cx="58" cy="122" rx="38" ry="7" fill="#000" opacity=".28"/>
      <path d="M78 38c5-13 15-17 24-20" fill="none" stroke="#f3d29b" stroke-width="6" stroke-linecap="round"/>
      <circle cx="58" cy="82" r="42" fill="url(#g-bomb)" stroke="#0b0a22" stroke-width="5"/>
      <rect x="44" y="26" width="30" height="20" rx="7" fill="#5c5c92" stroke="#0b0a22" stroke-width="5"/>
      <ellipse cx="41" cy="64" rx="15" ry="9" transform="rotate(-38 41 64)" fill="#fff" opacity=".38"/>
      <g class="art-spark"><path d="M104 4l3.6 9.4 9.4 3.6-9.4 3.6-3.6 9.4-3.6-9.4-9.4-3.6 9.4-3.6z" fill="#ffe27a" stroke="#ff7a1a" stroke-width="3" stroke-linejoin="round"/></g>`,
  },
};

const GRADIENTS = `
  <radialGradient id="g-bomb" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="#8c8cc8"/><stop offset=".42" stop-color="#3a3a6e"/><stop offset="1" stop-color="#0f0f2a"/></radialGradient>`;

function parseSvg(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

/** Injects the sprite sheet once. Zero-size rather than display:none, which breaks gradient references in some browsers. */
function installSprites(root) {
  if (document.getElementById('bp-sprites')) return;
  const symbols = Object.keys(ICONS).map((name) => `<symbol id="ic-${name}" viewBox="0 0 24 24">${ICONS[name]}</symbol>`).join('');
  const sheet = parseSvg(`<svg xmlns="${SVG_NS}" id="bp-sprites" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${GRADIENTS}</defs>${symbols}</svg>`);
  root.insertBefore(sheet, root.firstChild);
}

/** A small icon that inherits its colour from the text (`<use>` of the sprite sheet). */
function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ic ic-${name} ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#ic-${name}`);
  svg.appendChild(use);
  return svg;
}

/** One of the larger drawings as a real inline <svg> (so CSS animations inside it work in every browser). */
function artSvg(name, cls = '') {
  const a = ART[name];
  return parseSvg(`<svg xmlns="${SVG_NS}" class="art art-${name} ${cls}" viewBox="${a.viewBox}" aria-hidden="true" focusable="false">${a.body}</svg>`);
}

// ================================================================================================
// Game art from sprites.js, with graceful fallbacks
// ================================================================================================

const art = { sprites: null };
const DEVICE_SIZES = [24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 384];

let rootPxCache = { px: 16, at: -Infinity };
/** The root font size (1 rem in px), re-read at most twice a second so building a screen does not force a style recalculation per portrait. */
function rootPx() {
  const now = performance.now();
  if (now - rootPxCache.at > 500) rootPxCache = { px: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, at: now };
  return rootPxCache.px;
}

function deviceSize(rem) {
  const need = rem * rootPx() * Math.min(window.devicePixelRatio || 1, 2);
  return DEVICE_SIZES.find((s) => s >= need) ?? 512;
}

/** Fills an avatar/icon placeholder: the sprite PNG when sprites.js is loaded, else a CSS/SVG stand-in. */
function paintArt(node) {
  const { art: kind, size } = node.dataset;
  clear(node);
  const rem = Number(size) || 2;
  if (kind === 'avatar') {
    const index = Number(node.dataset.color) || 0;
    const src = art.sprites?.avatarDataURL(index, deviceSize(rem));
    if (src) node.appendChild(el('img', { class: 'avatar-img', src, alt: '', draggable: 'false' }));
    else node.appendChild(el('span', { class: 'avatar-face', style: { '--c': colorInfo(index).hex } }));
  } else {
    const name = node.dataset.icon;
    const src = art.sprites?.ICON_NAMES?.includes(name) ? art.sprites.iconDataURL(name, deviceSize(rem)) : '';
    if (src) node.appendChild(el('img', { class: 'gicon-img', src, alt: '', draggable: 'false' }));
    else if (ICONS[name]) node.appendChild(icon(name));
    else node.textContent = name.startsWith('emote-') ? EMOTES[EMOTE_NAMES.indexOf(name)] ?? '' : '';
  }
}

const EMOTE_NAMES = ['emote-grin', 'emote-laugh', 'emote-angry', 'emote-scream', 'emote-thumbsup', 'emote-party', 'emote-bomb', 'emote-skull'];
const EMOTE_LABELS = ['Grin', 'Laugh', 'Angry', 'Scream', 'Thumbs up', 'Party', 'Bomb', 'Skull'];

/** A blastie portrait for a colour index (0-7). `sizeRem` is its width and height. */
function avatar(color, sizeRem, cls = '') {
  const node = el('span', { class: `avatar ${cls}`.trim(), 'aria-hidden': 'true', dataset: { art: 'avatar', color: String(color | 0), size: String(sizeRem) }, style: { '--s': `${sizeRem}rem` } });
  paintArt(node);
  return node;
}

/** An item, curse or badge icon by name (bomb, flame, speed, kick, glove, shield, skull, slow, rush, reverse, nobomb, spam, crown, star, ghost, bot, heart, emote-*). */
function gameIcon(name, sizeRem = 1.5, cls = '') {
  const node = el('span', { class: `gicon ${cls}`.trim(), 'aria-hidden': 'true', dataset: { art: 'icon', icon: name, size: String(sizeRem) }, style: { '--s': `${sizeRem}rem` } });
  paintArt(node);
  return node;
}

const repaintAllArt = (scope) => scope.querySelectorAll('[data-art]').forEach(paintArt);

// ================================================================================================
// Reusable widgets
// ================================================================================================

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const isShown = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
const focusables = (scope) => Array.from(scope.querySelectorAll(FOCUSABLE)).filter(isShown);

/** Stack of modal dialogs: focus trap, Esc to close, focus restored to the opener, background made inert. */
class Modals {
  constructor(ui) {
    this.ui = ui;
    this.stack = [];
    document.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get top() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /**
   * @param {HTMLElement} node the .modal element (role="dialog" aria-modal="true" and a label are set by the caller)
   * @param {{opener?:Element, dismissible?:boolean, onClose?:Function, focus?:Element}} opts
   */
  open(node, opts = {}) {
    const entry = {
      node,
      opener: opts.opener ?? document.activeElement,
      dismissible: opts.dismissible !== false,
      onClose: opts.onClose,
      backdrop: el('div', { class: 'modal-backdrop' }, node),
    };
    entry.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === entry.backdrop && entry.dismissible) this.close(entry);
    });
    if (this.top) this.top.backdrop.inert = true;   // a dialog opened from a dialog: the one underneath is out of reach
    this.ui.layers.modals.appendChild(entry.backdrop);
    this.stack.push(entry);
    this.ui.block(1);
    (opts.focus ?? focusables(node)[0] ?? node).focus({ preventScroll: true });
    return entry;
  }

  close(entry) {
    const at = this.stack.indexOf(entry);
    if (at < 0) return;
    this.stack.splice(at, 1);
    entry.backdrop.remove();
    if (this.top) this.top.backdrop.inert = false;
    this.ui.block(-1);
    try {
      entry.onClose?.();
    } finally {
      const back = entry.opener;
      if (this.stack.length === at && back?.isConnected && isShown(back)) back.focus({ preventScroll: true });
    }
  }

  closeAll() {
    while (this.top) this.close(this.top);
  }

  onKey(e) {
    const top = this.top;
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();   // the game's own Esc handler must not reopen what this closes
      if (top.dismissible) this.close(top);
    } else if (e.key === 'Tab') {
      const items = focusables(top.node);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !top.node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !top.node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

let dialogSeq = 0;
/** Builds the frame shared by every dialog: title, close button, body. Returns { node, body, titleId }. */
function dialogFrame({ title, cls = '', closable = true, onClose, icon: iconName, role = 'dialog' }) {
  const titleId = `dlg-title-${++dialogSeq}`;
  const body = el('div', { class: 'modal-body' });
  const node = el('div', { class: `modal ${cls}`.trim(), role, 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    el('header', { class: 'modal-head' },
      iconName ? el('span', { class: 'modal-icon' }, icon(iconName)) : null,
      el('h2', { id: titleId, class: 'modal-title', text: title }),
      closable ? el('button', { class: 'icon-btn modal-x', type: 'button', 'aria-label': 'Close', on: { click: () => onClose?.() } }, icon('close')) : null),
    body);
  return { node, body, titleId };
}

/** Toasts: short-lived messages at the top of the screen (a polite live region). */
class Toasts {
  constructor(host) {
    this.host = host;
  }

  show(text, kind = 'info', opts = {}) {
    if (kind === 'success') kind = 'good';
    const glyph = kind === 'error' ? 'close' : kind === 'good' ? 'check' : kind === 'warn' ? 'bomb' : 'star';
    const node = el('div', { class: `toast toast-${kind}` }, el('span', { class: 'toast-icon' }, icon(glyph)), el('span', { class: 'toast-text', text }));
    const dismiss = () => {
      clearTimeout(timer);
      node.remove();
    };
    if (opts.action) {
      node.appendChild(el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: opts.action.label, on: { click: () => { opts.action.onClick?.(); dismiss(); } } }));
    } else {
      node.addEventListener('click', dismiss);
    }
    const timer = setTimeout(dismiss, opts.ms ?? (kind === 'error' || opts.action ? 6500 : 3800));
    this.host.appendChild(node);
    while (this.host.children.length > 4) this.host.firstChild.remove();
    return dismiss;
  }
}

/**
 * A radio-group of chunky buttons. `options`: [{ value, label, title? }]. The selected option is `aria-checked`; arrow keys
 * move and pick like a native radio group. When `readOnly` the buttons stay readable but do nothing.
 */
function segmented({ label, options, value, onPick, cls = '' }) {
  const buttons = options.map((o) => el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', title: o.title, dataset: { v: String(o.value) } }, o.label));
  const node = el('div', { class: `seg${options.length > 5 ? ' seg-many' : ''} ${cls}`.trim(), role: 'radiogroup', 'aria-label': label }, buttons);
  let current;
  let readOnly = false;
  const set = (v) => {
    current = v;
    const at = Math.max(0, options.findIndex((o) => o.value === v));
    buttons.forEach((b, i) => {
      const on = i === at && options.some((o) => o.value === v);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = i === at ? 0 : -1;
      b.classList.toggle('is-on', on);
    });
  };
  const pick = (i) => {
    if (readOnly) return;
    buttons[i].focus();
    if (options[i].value !== current) onPick?.(options[i].value);
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => pick(i));
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pick((i + step + options.length) % options.length);
    });
  });
  set(value);
  return {
    node,
    set,
    setReadOnly(flag) {
      readOnly = flag;
      node.classList.toggle('is-readonly', flag);
      node.setAttribute('aria-disabled', String(flag));
    },
  };
}

let switchSeq = 0;
/** An on/off switch with a visible label (role="switch"; the label and hint are wired with aria-labelledby / aria-describedby). */
function switchControl({ label, hint, checked = false, onToggle }) {
  const id = `switch-${++switchSeq}`;
  const button = el('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-labelledby': `${id}-name`, 'aria-describedby': hint ? `${id}-hint` : null }, el('span', { class: 'switch-knob' }));
  const state = el('span', { class: 'switch-state', 'aria-hidden': 'true' });
  const node = el('div', { class: 'switch-row' },
    el('span', { class: 'switch-label' }, el('span', { id: `${id}-name`, class: 'switch-name', text: label }), hint ? el('span', { id: `${id}-hint`, class: 'switch-hint', text: hint }) : null),
    state, button);
  let value = checked;
  let readOnly = false;
  const paint = () => {
    button.setAttribute('aria-checked', String(value));
    state.textContent = value ? 'On' : 'Off';
  };
  button.addEventListener('click', () => {
    if (readOnly) return;
    value = !value;
    paint();
    onToggle?.(value);
  });
  paint();
  return {
    node,
    button,
    set(v) {
      value = !!v;
      paint();
    },
    setReadOnly(flag) {
      readOnly = flag;
      node.classList.toggle('is-readonly', flag);
      button.setAttribute('aria-disabled', String(flag));
    },
  };
}

/** Signal bars plus milliseconds. Colour is never the only cue: the number and an aria-label carry the meaning. */
function pingMeter() {
  const bars = [1, 2, 3, 4].map(() => el('i'));
  const text = el('span', { class: 'ping-text', text: '--' });
  const node = el('span', { class: 'ping', role: 'img', 'aria-label': 'Connection unknown', dataset: { q: 'none' } }, el('span', { class: 'ping-bars', 'aria-hidden': 'true' }, bars), text);
  return {
    node,
    set(ms, local = false, kind = '') {
      const q = local ? 'good' : pingQuality(ms);
      const shown = local ? 'Local' : q === 'none' ? '--' : `${Math.round(ms)} ms`;
      const word = { good: 'good', ok: 'fair', bad: 'poor', none: 'unknown' }[q];
      if (node.dataset.q !== q) node.dataset.q = q;
      if (text.textContent !== shown) text.textContent = shown;
      const label = local ? (kind === 'host' ? 'Hosting this game' : 'Practice, no network') : q === 'none' ? 'Connection unknown' : `Connection ${word}, ${Math.round(ms)} milliseconds`;
      if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
    },
  };
}

/** Chat log + input. Two instances exist (lobby and results) and show the same history. */
class ChatPanel {
  constructor(ui, id) {
    this.ui = ui;
    this.log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Chat messages', tabindex: '0' });
    this.input = el('input', { class: 'text-input chat-input', type: 'text', maxlength: '240', placeholder: 'Say something nice...', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'send', 'aria-label': 'Chat message' });
    const form = el('form', { class: 'chat-form', on: { submit: (e) => { e.preventDefault(); this.send(); } } },
      this.input, el('button', { class: 'btn btn-blue btn-square', type: 'submit', 'aria-label': 'Send message' }, icon('send')));
    this.root = el('section', { class: 'card chat-card', 'aria-labelledby': id },
      el('h2', { id, class: 'card-title' }, icon('smile'), 'Chat'), this.log, form);
    this.empty = el('p', { class: 'chat-empty', text: 'No messages yet. Say hi!' });
    this.log.appendChild(this.empty);
    for (const line of ui.chatHistory) this.render(line);
  }

  send() {
    const text = this.input.value.trim();
    if (!text) return;
    this.ui.emit('onChat', text);
    this.input.value = '';
  }

  setLive(on) {
    this.log.setAttribute('aria-live', on ? 'polite' : 'off');
  }

  render(line) {
    this.empty.remove();
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48;
    const node = line.sys
      ? el('div', { class: 'chat-line is-sys' }, el('span', { class: 'chat-text', text: line.text }))
      : el('div', { class: `chat-line${line.old ? ' is-old' : ''}${line.from === this.ui.you ? ' is-me' : ''}` },
        el('span', { class: 'chat-dot', style: { '--c': colorInfo(line.color).hex }, 'aria-hidden': 'true' }),
        bdi(line.name, 'chat-name'), el('span', { class: 'chat-text', text: line.text }));
    this.log.appendChild(node);
    while (this.log.children.length > 100) this.log.firstChild.remove();
    if (nearBottom || line.from === this.ui.you) this.log.scrollTop = this.log.scrollHeight;
  }

  reset() {
    clear(this.log).appendChild(this.empty);
  }

  scrollToEnd() {
    this.log.scrollTop = this.log.scrollHeight;
  }
}

// ================================================================================================
// Title screen
// ================================================================================================

/** The honest one-paragraph version of how playing with friends works in the single-file download. */
const SINGLE_EXPLAINER = 'One person hosts and keeps this page open. Friends join with a code you send them (no account, no server). Works best on the same Wi-Fi, or with a normal home connection.';

class TitleScreen {
  constructor(ui) {
    this.ui = ui;
    this.code = '';
    this.firstVisit = !store.get('bp.name');

    this.nameInput = el('input', { id: 'name-input', class: 'text-input name-input', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Type your name', 'aria-describedby': 'name-hint', on: { focus: () => this.nameInput.select() } });
    this.codeInput = el('input', { id: 'code-input', class: 'text-input code-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'ABCD', 'aria-describedby': 'code-hint', 'aria-label': 'Room code' });
    this.error = el('p', { class: 'form-error', role: 'alert', hidden: true });
    this.inviteCode = el('span', { class: 'invite-code' });
    this.invite = el('div', { class: 'invite', hidden: true }, icon('users'), el('span', { text: 'You are invited to room ' }), this.inviteCode);
    this.joinLabel = el('label', { for: 'code-input', class: 'field-label', text: 'Got a room code?' });
    this.createBtn = el('button', { class: 'btn btn-primary btn-xl', type: 'button', on: { click: () => this.create() } }, icon('plus'), 'Create room');
    this.joinBtn = el('button', { class: 'btn btn-blue btn-lg', type: 'button', on: { click: () => this.join() } }, 'Join');
    const howto = el('button', { class: 'btn btn-glass', type: 'button', on: { click: (e) => ui.showHowTo(true, e.currentTarget) } }, icon('help'), 'How to play');
    const nameField = el('div', { class: 'field' },
      el('label', { for: 'name-input', class: 'field-label', text: 'Your name' }),
      el('div', { class: 'field-row' }, this.nameInput,
        el('button', { class: 'icon-btn', type: 'button', title: 'Pick a random name', 'aria-label': 'Pick a random name', on: { click: () => { this.nameInput.value = randomName(); this.nameInput.focus(); } } }, icon('dice'))),
      el('p', { id: 'name-hint', class: 'field-hint', text: 'This is what your friends will see.' }));
    if (ui.single) {
      // The downloaded single file has no server: no room codes. Practice always works; friends connect directly through codes they swap.
      this.hostBtn = el('button', { class: 'btn btn-blue btn-lg', type: 'button', on: { click: () => this.host() } }, icon('users'), 'Host a game');
      this.joinFriendBtn = el('button', { class: 'btn btn-green btn-lg', type: 'button', on: { click: () => this.joinFriend() } }, icon('link'), "Join a friend's game");
      this.card = el('div', { class: 'card title-card is-single' },
        nameField,
        this.error,
        el('div', { class: 'title-main' }, el('button', { class: 'btn btn-primary btn-xl', type: 'button', on: { click: () => this.practice() } }, icon('bot'), 'Practice vs bots')),
        el('div', { class: 'friends-box' },
          el('h2', { class: 'friends-title' }, icon('users'), 'Play with friends'),
          el('div', { class: 'friends-btns' }, this.hostBtn, this.joinFriendBtn),
          el('p', { class: 'friends-note', text: SINGLE_EXPLAINER })),
        el('div', { class: 'title-links' }, howto));
    } else {
      this.card = el('div', { class: 'card title-card' },
        this.invite,
        nameField,
        this.error,
        el('div', { class: 'title-main' }, this.createBtn),
        el('div', { class: 'join-box' },
          this.joinLabel,
          el('div', { class: 'field-row' }, this.codeInput, this.joinBtn),
          el('p', { id: 'code-hint', class: 'field-hint', text: '4 letters, no vowels. Pasting an invite link works too.' })),
        el('div', { class: 'title-links' },
          el('button', { class: 'btn btn-glass', type: 'button', on: { click: () => this.practice() } }, icon('bot'), 'Practice vs bots'),
          howto));
    }

    const words = el('span', { class: 'logo-words', 'aria-hidden': 'true' },
      el('span', { class: 'logo-word logo-blast', dataset: { text: 'BLAST' }, text: 'BLAST' }),
      el('span', { class: 'logo-word logo-party', dataset: { text: 'PARTY' }, text: 'PARTY' }));
    this.h1 = el('h1', { id: 'title-h1', class: 'logo', tabindex: '-1', 'aria-label': 'Blast Party' }, artSvg('bomb', 'logo-bomb'), words);
    this.parade = el('div', { class: 'parade', 'aria-hidden': 'true' }, PLAYER_COLORS.map((_, i) => el('span', { class: 'parade-item', style: { '--i': i } }, avatar(i, 3.4))));

    this.root = el('section', { id: 'screen-title', class: 'screen screen-title', hidden: true, 'aria-labelledby': 'title-h1' },
      el('button', { class: 'icon-btn title-cog', type: 'button', 'aria-label': 'Settings', title: 'Settings', on: { click: (e) => ui.showSettings(true, e.currentTarget) } }, icon('sliders')),
      el('div', { class: 'title-inner' },
        el('header', { class: 'title-head' }, this.h1, el('p', { class: 'tagline', text: 'Drop bombs. Blast blocks. Outlast your friends.' })),
        this.card),
      this.parade);

    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (ui.single ? this.practice() : this.code ? this.join() : this.create());
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join();
    });
    this.codeInput.addEventListener('input', () => {
      const code = extractRoomCode(this.codeInput.value);
      if (this.codeInput.value !== code) this.codeInput.value = code;
      this.joinBtn.classList.toggle('is-ready', code.length === 4);
      this.codeInput.classList.remove('is-invalid');
      this.setError('');
    });
    this.nameInput.value = store.get('bp.name') ?? randomName();
  }

  setError(text) {
    this.error.textContent = text || '';
    this.error.hidden = !text;
  }

  /** Reads the name field, filling in a friendly default when it was left empty. */
  takeName() {
    let name = this.nameInput.value.trim();
    if (!name) name = this.nameInput.value = randomName();
    store.set('bp.name', name);
    return name;
  }

  create() {
    this.ui.emit('onCreate', this.takeName());
  }

  practice() {
    this.ui.emit('onPractice', this.takeName());
  }

  host() {
    this.ui.emit('onHost', this.takeName());
  }

  joinFriend() {
    this.ui.emit('onJoinFriend', this.takeName());
  }

  join() {
    const code = extractRoomCode(this.codeInput.value);
    if (code.length !== 4) {
      this.codeInput.classList.add('is-invalid');
      this.setError('Room codes have 4 letters (no vowels). Ask your host for the code or invite link.');
      this.codeInput.focus();
      return;
    }
    this.ui.emit('onJoin', code, this.takeName());
  }

  /** @param {{name?:string, code?:string, error?:string}} [opts] */
  show({ name, code, error } = {}) {
    if (typeof name === 'string' && name.trim() && document.activeElement !== this.nameInput) this.nameInput.value = name;
    this.code = isRoomCode(code) ? code : '';
    if (this.code) this.codeInput.value = this.code;
    else if (code !== undefined || !this.codeInput.value) this.codeInput.value = '';
    this.inviteCode.textContent = this.code;
    this.invite.hidden = !this.code;
    this.card.classList.toggle('is-invited', !!this.code);
    this.joinLabel.textContent = this.code ? 'Ready to join?' : 'Got a room code?';
    this.joinBtn.classList.toggle('is-ready', extractRoomCode(this.codeInput.value).length === 4);
    this.codeInput.classList.remove('is-invalid');
    this.setError(typeof error === 'string' ? error : '');
  }

  /** Where keyboard focus goes when the screen appears (SPEC 8.3). */
  focusTarget() {
    const fine = matchMedia('(pointer: fine)').matches;
    if (this.code) return fine ? this.codeInput : this.joinBtn;
    return this.firstVisit && fine ? this.nameInput : this.h1;
  }
}

// ================================================================================================
// Lobby (also the home of the settings panel, chat and the start button)
// ================================================================================================

const SETTING_LABELS = {
  mode: { ffa: 'Free-for-all', teams: 'Teams' },
  layout: { classic: 'Classic', open: 'Open' },
  blocks: { few: 'Few', normal: 'Normal', many: 'Many' },
  items: { none: 'None', few: 'Few', normal: 'Normal', many: 'Many' },
  theme: { random: 'Random', meadow: 'Meadow', frost: 'Frost', lava: 'Lava', candy: 'Candy', night: 'Night' },
};
const roundTimeLabel = (s) => (s === 0 ? '\u221e' : formatClock(s));
const roundTimeName = (s) => (s === 0 ? 'Unlimited' : s < 120 ? `${s} seconds` : `${s / 60} minutes`);
const BOT_LEVEL_HELP = { easy: 'Wanders around and bombs blocks', normal: 'Hunts power-ups and rivals', hard: 'Sets traps and dodges everything' };
const TEAM_NAMES = ['Team A', 'Team B'];

class LobbyScreen {
  constructor(ui) {
    this.ui = ui;
    this.msg = null;
    this.cards = new Map();
    this.kickConfirm = null;
    this.settingsOpen = null;   // user's choice on narrow screens; null = follow the default (host open, guests closed)
    this.rows = {};
    this.build();
  }

  build() {
    const ui = this.ui;
    this.ping = pingMeter();
    this.title = el('h1', { id: 'lobby-h1', class: 'lobby-title', tabindex: '-1', text: 'Lobby' });
    this.bar = el('header', { class: 'lobby-bar' },
      el('button', { class: 'btn btn-glass btn-sm', type: 'button', on: { click: () => ui.emit('onLeave') } }, icon('leave'), 'Leave'),
      this.title,
      el('div', { class: 'lobby-bar-end' }, this.ping.node,
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', on: { click: (e) => ui.showSettings(true, e.currentTarget) } }, icon('sliders'))));

    // ---- Room code / invite
    this.letters = [0, 1, 2, 3].map((i) => el('span', { class: 'code-letter', style: { '--i': i } }));
    this.codeText = el('span', { class: 'sr-only' });
    this.roomCode = el('p', { class: 'room-code' }, this.codeText, el('span', { class: 'code-letters', 'aria-hidden': 'true' }, this.letters));
    this.inviteInput = el('input', { class: 'text-input invite-link', type: 'text', readonly: true, 'aria-label': 'Invite link', on: { focus: (e) => e.currentTarget.select() } });
    this.copyBtn = el('button', { class: 'btn btn-primary', type: 'button', on: { click: () => this.copyInvite() } }, icon('copy'), el('span', { text: 'Copy invite link' }));
    this.shareBtn = el('button', { class: 'btn btn-blue', type: 'button', hidden: typeof navigator.share !== 'function', on: { click: () => this.share() } }, icon('share'), 'Share');
    this.qrCanvas = el('canvas', { class: 'qr-canvas', role: 'img', 'aria-label': 'QR code of the invite link' });
    this.qrBox = el('div', { class: 'qr-box', hidden: true }, this.qrCanvas, el('p', { class: 'qr-caption', text: 'Scan with a phone camera' }));
    this.qrBtn = el('button', { class: 'btn btn-glass qr-toggle', type: 'button', 'aria-expanded': 'false', hidden: true, on: { click: () => this.toggleQr() } }, icon('qr'), el('span', { text: 'QR code' }));
    // A page opened as localhost/127.0.0.1 cannot produce a link anybody else can use: the invite row gives way to an explanation.
    this.loopbackNote = el('p', { class: 'code-warn', role: 'note', hidden: true });
    this.inviteRow = el('div', { class: 'invite-row' }, this.inviteInput, el('div', { class: 'invite-actions' }, this.copyBtn, this.shareBtn, this.qrBtn));
    this.codeCard = el('section', { class: 'card code-card', 'aria-labelledby': 'code-h' },
      el('h2', { id: 'code-h', class: 'card-title', text: 'Room code' }),
      el('div', { class: 'code-row' }, this.roomCode, this.qrBox),
      el('p', { class: 'code-hint', text: 'Friends open the link or type the code on the home screen.' }),
      this.loopbackNote,
      this.inviteRow);
    this.practiceCard = el('section', { class: 'card practice-card', hidden: true },
      el('h2', { class: 'card-title' }, icon('bot'), 'Practice mode'),
      el('p', { text: 'You are playing offline against bots. Add more bots or start when you are ready. Nobody else can join.' }));
    // Single-file download: no room code, no invite link, no QR (they would all be wrong). The host adds friends with codes instead.
    this.friendBtn = el('button', { class: 'btn btn-primary btn-xl', type: 'button', on: { click: () => ui.emit('onAddFriend') } }, icon('plus'), 'Add a friend');
    this.friendNote = el('p', { class: 'friend-note', text: 'You are the host. Keep this page open while you play: if you close it, the game ends for everybody.' });
    this.friendCard = el('section', { class: 'card friend-card', 'aria-labelledby': 'friend-h', hidden: true },
      el('h2', { id: 'friend-h', class: 'card-title' }, icon('users'), 'Friends'),
      el('p', { class: 'friend-text', text: 'Send each friend a code. They send one back. That is all it takes, and no room code is needed.' }),
      this.friendBtn, this.friendNote);
    this.guestNote = el('p', { class: 'friend-text' });
    this.guestCard = el('section', { class: 'card friend-card guest-card', 'aria-labelledby': 'guest-h', hidden: true },
      el('h2', { id: 'guest-h', class: 'card-title' }, icon('link'), 'Connected'),
      this.guestNote,
      el('p', { class: 'friend-note', text: 'If your connection drops, ask the host for a new code to jump back in with the same character.' }));

    // ---- Players
    this.count = el('span', { class: 'count-chip' });
    this.list = el('ul', { class: 'players', 'aria-label': 'Players' });
    this.addBotRow = el('div', { class: 'addbot', role: 'group', 'aria-label': 'Add a bot' }, el('span', { class: 'addbot-label' }, icon('bot'), 'Add a bot'),
      ['easy', 'normal', 'hard'].map((level) => el('button', { class: `btn btn-glass btn-sm bot-${level}`, type: 'button', title: BOT_LEVEL_HELP[level], 'aria-label': `Add ${level} bot. ${BOT_LEVEL_HELP[level]}`, dataset: { level }, on: { click: () => this.addBot(level) } }, level[0].toUpperCase() + level.slice(1))));
    this.playersCard = el('section', { class: 'card players-card', 'aria-labelledby': 'players-h' },
      el('h2', { id: 'players-h', class: 'card-title' }, icon('users'), 'Players', this.count), this.list, this.addBotRow);

    // ---- You
    this.nameField = el('input', { id: 'my-name', class: 'text-input', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'done', on: {
      change: () => this.commitName(),
      keydown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
    } });
    this.swatches = PLAYER_COLORS.map((c, i) => el('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'aria-label': `${c.name} - ${c.accessory}`, style: { '--c': c.hex }, on: { click: () => this.pickColor(i), keydown: (e) => this.swatchKey(e, i) } }, avatar(i, 2.6), el('span', { class: 'swatch-mark' }, icon('check'))));
    this.colorGroup = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Your color' }, this.swatches);
    this.team = segmented({ label: 'Your team', cls: 'seg-teams', options: [0, 1].map((t) => ({ value: t, label: [el('span', { class: 'team-badge', dataset: { team: String(t) }, text: teamLetter(t) }), el('span', { text: TEAM_NAMES[t] })] })), value: 0, onPick: (team) => ui.emit('onProfile', { team }) });
    this.teamBlock = el('div', { class: 'you-block', hidden: true }, el('span', { class: 'field-label', text: 'Your team' }), this.team.node);
    this.youCard = el('section', { class: 'card you-card', 'aria-labelledby': 'you-h' },
      el('h2', { id: 'you-h', class: 'card-title' }, icon('smile'), 'Your look'),
      el('div', { class: 'you-block' }, el('label', { for: 'my-name', class: 'field-label', text: 'Name' }), this.nameField),
      el('div', { class: 'you-block' }, el('span', { class: 'field-label', text: 'Color' }), this.colorGroup),
      this.teamBlock);

    // ---- Settings
    this.settingsSummary = el('span', { class: 'settings-summary' });
    this.settingsToggle = el('button', { class: 'card-toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'settings-body', on: { click: () => this.toggleSettings() } },
      el('span', { class: 'card-title' }, icon('sliders'), 'Game rules'), this.settingsSummary, icon('down', 'chev'));
    this.settingsBody = el('div', { id: 'settings-body', class: 'settings-body' });
    this.hostNote = el('p', { class: 'settings-note' });
    this.buildSettingRows();
    this.settingsCard = el('section', { class: 'card settings-card' }, this.settingsToggle, this.settingsBody);

    this.chat = new ChatPanel(ui, 'lobby-chat-h');
    ui.chatPanels.push(this.chat);

    // ---- Start bar
    this.startNote = el('p', { id: 'start-note', class: 'start-note', 'aria-live': 'polite' });
    this.startBtn = el('button', { class: 'btn btn-green btn-xl', type: 'button', 'aria-describedby': 'start-note', on: { click: () => this.start() } }, icon('bomb'), 'Start match');
    this.actionbar = el('div', { class: 'actionbar' }, this.startNote, this.startBtn);

    this.root = el('section', { id: 'screen-lobby', class: 'screen screen-lobby', hidden: true, 'aria-labelledby': 'lobby-h1' },
      el('div', { class: 'lobby-inner' }, this.bar,
        el('div', { class: 'lobby-grid' },
          el('div', { class: 'lobby-col' }, this.codeCard, this.practiceCard, this.friendCard, this.guestCard, this.playersCard, this.youCard),
          el('div', { class: 'lobby-col' }, this.settingsCard, this.chat.root)),
        this.actionbar));
  }

  buildSettingRows() {
    const ui = this.ui;
    const patch = (key) => (value) => ui.emit('onSettings', { [key]: value });
    const seg = (key, label, fmt, cls = '') => {
      const options = SETTINGS_DEFS[key].values.map((v) => ({ value: v, label: fmt(v) }));
      return segmented({ label, options, value: SETTINGS_DEFS[key].def, onPick: patch(key), cls });
    };
    const row = (key, label, control, hint) => {
      // A switch brings its own label; every other control gets one beside it.
      const node = control.button ? control.node : el('div', { class: 'setting-row' }, el('div', { class: 'setting-label' }, el('span', { class: 'setting-name', text: label }), hint ? el('span', { class: 'setting-hint', text: hint }) : null), control.node);
      node.classList.add('setting-row', `setting-${key}`);
      this.settingsBody.appendChild(node);
      this.rows[key] = { control, node };
    };
    row('mode', 'Mode', seg('mode', 'Mode', (v) => SETTING_LABELS.mode[v]));
    row('rounds', 'Wins needed', seg('rounds', 'Wins needed to take the match', String), 'First to this many round wins');
    row('roundTime', 'Round time', seg('roundTime', 'Round time', (v) => el('span', { title: roundTimeName(v), text: roundTimeLabel(v) })), 'Minutes per round (\u221E = no limit)');
    const sd = switchControl({ label: 'Sudden death', hint: 'Walls close in when time runs out', onToggle: patch('suddenDeath') });
    row('suddenDeath', 'Sudden death', sd);
    const themeOptions = SETTINGS_DEFS.theme.values.map((v) => ({ value: v, label: [el('span', { class: 'theme-swatch', dataset: { theme: v }, 'aria-hidden': 'true' }), el('span', { text: SETTING_LABELS.theme[v] })] }));
    row('theme', 'Arena theme', segmented({ label: 'Arena theme', cls: 'seg-tiles', options: themeOptions, value: 'random', onPick: patch('theme') }));
    row('layout', 'Layout', seg('layout', 'Arena layout', (v) => SETTING_LABELS.layout[v]), 'Classic has pillars, open is a wide brawl');
    row('blocks', 'Blocks', seg('blocks', 'Amount of blocks', (v) => SETTING_LABELS.blocks[v]));
    row('items', 'Power-ups', seg('items', 'Amount of power-ups', (v) => SETTING_LABELS.items[v]));
    const lock = switchControl({ label: 'Lock room', hint: 'Nobody new can join', onToggle: patch('locked') });
    row('locked', 'Lock room', lock);
    this.settingsBody.appendChild(this.hostNote);
  }

  // ---- Actions

  async copyInvite() {
    const url = this.inviteUrl();
    if (!url) return;
    const ok = await copyText(url);
    if (ok) this.ui.toast('Invite link copied!', 'good');
    else {
      this.inviteInput.focus();
      this.inviteInput.select();
      this.ui.toast('Press Ctrl+C (Cmd+C on a Mac) to copy the link', 'info');
    }
    if (ok) this.copyBtn.focus({ preventScroll: true });
  }

  share() {
    const url = this.inviteUrl();
    if (!url || typeof navigator.share !== 'function') return;
    // Called synchronously inside the click: browsers only allow sharing during a user gesture.
    const result = navigator.share({ title: 'Blast Party', text: `Join my Blast Party! Room ${this.msg.code}`, url });
    result?.catch?.(() => {});   // AbortError when the share sheet is dismissed
  }

  /** The shareable link, or '' when there is none to give (Practice, or an address only this computer can open). */
  inviteUrl() {
    const code = this.msg?.code;
    return isRoomCode(code) && !this.msg.local && !isLoopbackHost(location.hostname) ? `${location.origin}/r/${code}` : '';
  }

  toggleQr() {
    const open = this.qrBox.hidden;
    this.qrBox.hidden = !open;
    this.qrBtn.setAttribute('aria-expanded', String(open));
    this.root.classList.toggle('qr-open', open);
  }

  toggleSettings() {
    const open = this.settingsToggle.getAttribute('aria-expanded') !== 'true';
    this.settingsOpen = open;
    this.applySettingsOpen();
  }

  applySettingsOpen() {
    const isHost = this.msg && this.msg.you === this.msg.hostId;
    const open = this.settingsOpen ?? isHost;
    this.settingsToggle.setAttribute('aria-expanded', String(open));
    this.settingsCard.classList.toggle('is-collapsed', !open);
  }

  addBot(level) {
    if (this.msg && this.msg.players.length >= MAX_PLAYERS) {
      this.ui.toast('The room is full: remove someone to make space', 'warn');
      return;
    }
    this.ui.emit('onAddBot', level);
  }

  start() {
    const blocker = startBlocker(this.msg);
    if (blocker) {
      this.startNote.classList.remove('shake');
      void this.startNote.offsetWidth;   // restart the animation
      this.startNote.classList.add('shake');
      this.ui.announce(blocker);
      return;
    }
    this.ui.emit('onStart');
  }

  commitName() {
    const name = this.nameField.value.trim();
    const me = this.me();
    if (!name) {
      this.nameField.value = me?.name ?? '';
      return;
    }
    if (!me || name === me.name) return;
    store.set('bp.name', name);
    this.ui.emit('onProfile', { name });
  }

  pickColor(i) {
    const me = this.me();
    if (!me || me.color === i) return;
    const owner = this.msg.players.find((p) => p.color === i);
    if (owner) {
      this.ui.toast(`${owner.name} already has ${PLAYER_COLORS[i].name}`, 'warn');
      return;
    }
    this.ui.emit('onProfile', { color: i });
  }

  swatchKey(e, i) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    let next = i;
    for (let n = 0; n < this.swatches.length; n++) {
      next = (next + step + this.swatches.length) % this.swatches.length;
      if (this.swatches[next].getAttribute('aria-disabled') !== 'true') break;
    }
    this.swatches[next].focus();
    this.pickColor(next);
  }

  me() {
    return this.msg?.players.find((p) => p.id === this.msg.you) ?? null;
  }

  // ---- Rendering

  render(msg) {
    this.msg = msg;
    const isHost = msg.you === msg.hostId;
    const teams = msg.settings?.mode === 'teams';
    const local = !!msg.local;

    this.title.textContent = local ? 'Practice' : 'Lobby';
    this.renderCode(msg, local);
    this.renderPlayers(msg, isHost, teams);
    this.renderYou(msg, teams);
    this.renderSettings(msg, isHost);
    this.renderStart(msg, isHost);
    this.root.classList.toggle('is-host', isHost);
  }

  renderCode(msg, local) {
    const p2p = this.ui.p2p;
    this.codeCard.hidden = local || !!p2p;
    this.practiceCard.hidden = !local;
    this.friendCard.hidden = p2p !== 'host';
    if (p2p === 'host') {
      const note = msg.settings?.locked ? 'The game is locked, so nobody new can join. Switch off "Lock room" first.'
        : msg.players.length >= MAX_PLAYERS ? 'The game is full. Remove a bot or kick a player to make room.'
          : 'You are the host. Keep this page open while you play: if you close it, the game ends for everybody.';
      if (this.friendNote.textContent !== note) this.friendNote.textContent = note;
    }
    this.guestCard.hidden = p2p !== 'guest';
    if (p2p === 'guest') {
      const host = msg.players.find((p) => p.id === msg.hostId);
      const text = host ? `You are playing on ${host.name}'s computer. Wait for the host to start the match.` : 'You are playing on the host\'s computer.';
      if (this.guestNote.textContent !== text) this.guestNote.textContent = text;
    }
    if (local || p2p || !isRoomCode(msg.code)) return;
    const changed = this.codeText.textContent !== `Room code ${spellCode(msg.code)}`;
    if (changed) {
      this.codeText.textContent = `Room code ${spellCode(msg.code)}`;
      this.letters.forEach((node, i) => { node.textContent = msg.code[i]; });
      const url = this.inviteUrl();
      const loopback = isLoopbackHost(location.hostname);
      this.inviteInput.value = url;
      this.inviteRow.hidden = loopback;
      this.loopbackNote.hidden = !loopback;
      this.codeCard.classList.toggle('is-loopback', loopback);
      if (loopback) this.loopbackNote.textContent = loopbackHint(location.port);
      this.drawQr(url);
    }
  }

  drawQr(url) {
    const matrix = url ? this.ui.qr?.qrMatrix(url) ?? null : null;
    this.codeCard.classList.toggle('has-qr', !!matrix);
    this.qrBtn.hidden = !matrix;
    if (!matrix) {
      this.qrBox.hidden = true;
      return;
    }
    const quiet = 4;
    const scale = 6;
    const px = (matrix.length + quiet * 2) * scale;
    this.qrCanvas.width = this.qrCanvas.height = px;
    const g = this.qrCanvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, px, px);
    g.fillStyle = '#1a1033';
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
  }

  renderPlayers(msg, isHost, teams) {
    const players = msg.players;
    const seen = new Set();
    let anchor = null;
    for (const p of players) {
      seen.add(p.id);
      let card = this.cards.get(p.id);
      if (!card) {
        card = { li: el('li', { class: 'player-card' }), sig: '' };
        this.cards.set(p.id, card);
      }
      const sig = JSON.stringify([p.name, p.color, p.team, p.isBot, p.level, p.connected, p.isHost, p.wins, p.waiting, isHost, teams, p.id === msg.you, this.kickConfirm === p.id]);
      if (sig !== card.sig) {
        card.sig = sig;
        this.fillCard(card.li, p, { isHost, teams, you: msg.you });
      }
      const expected = anchor ? anchor.nextSibling : this.list.firstChild;
      if (card.li !== expected) this.list.insertBefore(card.li, expected);
      anchor = card.li;
    }
    for (const [id, card] of this.cards) {
      if (!seen.has(id)) {
        card.li.remove();
        this.cards.delete(id);
        if (this.kickConfirm === id) this.kickConfirm = null;
      }
    }
    this.list.querySelectorAll('.player-empty').forEach((n) => n.remove());
    for (let i = players.length; i < MAX_PLAYERS; i++) {
      this.list.appendChild(el('li', { class: 'player-empty', 'aria-hidden': 'true' }, icon('plus'), el('span', { text: i === players.length ? 'Waiting for players' : 'Open seat' })));
    }
    this.count.textContent = `${players.length}/${MAX_PLAYERS}`;
    this.count.setAttribute('aria-label', `${players.length} of ${MAX_PLAYERS} seats taken`);
    this.addBotRow.hidden = !isHost;
    const full = players.length >= MAX_PLAYERS;
    this.addBotRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-disabled', String(full)));
    this.addBotRow.classList.toggle('is-full', full);
  }

  fillCard(li, p, { isHost, teams, you }) {
    const ui = this.ui;
    const isMe = p.id === you;
    li.className = `player-card${isMe ? ' is-me' : ''}${p.connected === false ? ' is-away' : ''}${p.isBot ? ' is-bot' : ''}`;
    li.style.setProperty('--c', colorInfo(p.color).hex);
    clear(li);
    const tags = [];
    if (p.isHost) tags.push(el('span', { class: 'tag tag-host' }, icon('crown'), 'Host'));
    if (p.isBot) tags.push(el('span', { class: `tag tag-bot tag-${p.level ?? 'normal'}` }, icon('bot'), `Bot \u00b7 ${p.level ? p.level[0].toUpperCase() + p.level.slice(1) : 'Normal'}`));
    if (teams) tags.push(el('span', { class: 'tag tag-team', dataset: { team: String(p.team === 1 ? 1 : 0) }, text: TEAM_NAMES[p.team === 1 ? 1 : 0] }));
    if (p.waiting) tags.push(el('span', { class: 'tag tag-wait' }, icon('eye'), 'Watching'));
    if (p.connected === false) tags.push(el('span', { class: 'tag tag-away' }, 'Reconnecting'));

    const actions = [];
    if (isHost && teams && p.isBot) {
      actions.push(el('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: 'Move to the other team', 'aria-label': `Move ${p.name} to the other team`, on: { click: () => ui.emit('onProfile', { id: p.id, team: p.team === 1 ? 0 : 1 }) } }, icon('swap')));
    }
    if (isHost && !isMe) {
      if (p.isBot) {
        actions.push(el('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: 'Remove bot', 'aria-label': `Remove bot ${p.name}`, on: { click: () => ui.emit('onRemoveBot', p.id) } }, icon('close')));
      } else if (this.kickConfirm === p.id) {
        actions.push(el('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `Kick ${p.name} out of the room`, on: { click: () => { this.kickConfirm = null; ui.emit('onKick', p.id); } } }, 'Kick'),
          el('button', { class: 'btn btn-glass btn-sm', type: 'button', text: 'Keep', on: { click: () => { this.kickConfirm = null; this.render(this.msg); } } }));
      } else {
        actions.push(el('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: 'Kick from room', 'aria-label': `Kick ${p.name}`, on: { click: () => { this.kickConfirm = p.id; this.render(this.msg); } } }, icon('close')));
      }
    }
    append(li, [
      el('span', { class: 'sr-only', text: describePlayer(p, { you }) }),
      el('span', { class: 'pc-avatar', 'aria-hidden': 'true' }, avatar(p.color, 3)),
      el('span', { class: 'pc-main', 'aria-hidden': 'true' },
        el('span', { class: 'pc-name' }, bdi(p.name), isMe ? el('span', { class: 'you-tag', text: 'YOU' }) : null),
        tags.length ? el('span', { class: 'pc-tags' }, tags) : null),
      p.wins > 0 ? el('span', { class: 'pc-wins', 'aria-hidden': 'true' }, icon('star'), el('b', { text: String(p.wins) })) : null,
      actions.length ? el('span', { class: 'pc-actions' }, actions) : null]);
  }

  renderYou(msg, teams) {
    const me = this.me();
    if (me && document.activeElement !== this.nameField) this.nameField.value = me.name;
    const taken = new Map(msg.players.filter((p) => p.id !== msg.you).map((p) => [p.color, p.name]));
    this.swatches.forEach((b, i) => {
      const mine = me?.color === i;
      const other = taken.get(i);
      b.setAttribute('aria-checked', String(mine));
      b.setAttribute('aria-disabled', String(!!other));
      b.tabIndex = mine || (!me && i === 0) ? 0 : -1;
      b.classList.toggle('is-on', mine);
      b.classList.toggle('is-taken', !!other);
      b.title = other ? `${PLAYER_COLORS[i].name}: taken by ${other}` : `${PLAYER_COLORS[i].name} - ${PLAYER_COLORS[i].accessory}`;
    });
    this.teamBlock.hidden = !teams;
    if (teams && me) this.team.set(me.team === 1 ? 1 : 0);
  }

  renderSettings(msg, isHost) {
    const s = msg.settings ?? {};
    for (const key of Object.keys(this.rows)) {
      const { control, node } = this.rows[key];
      if (s[key] !== undefined) control.set(s[key]);
      control.setReadOnly(!isHost);
      node.classList.toggle('is-readonly', !isHost);
    }
    // No timer, no sudden death (SPEC 4.1): show it off and let nobody flip it.
    const sdRow = this.rows.suddenDeath;
    const noTimer = s.roundTime === 0;
    if (noTimer) sdRow.control.set(false);
    sdRow.control.setReadOnly(!isHost || noTimer);
    sdRow.node.classList.toggle('is-off', noTimer);
    sdRow.node.querySelector('.switch-hint').textContent = noTimer ? 'Needs a round timer' : 'Walls close in when time runs out';
    this.rows.locked.node.querySelector('.switch-hint').textContent = s.locked ? 'Nobody new can join' : this.ui.p2p ? 'You can still add friends' : 'Anyone with the code can join';

    const summary = [`First to ${s.rounds ?? '?'}`, roundTimeLabel(s.roundTime), SETTING_LABELS.mode[s.mode] ?? ''].filter(Boolean).join(' \u00b7 ');
    this.settingsSummary.textContent = summary;
    this.hostNote.textContent = isHost ? '' : 'Only the host can change the rules.';
    this.hostNote.hidden = isHost;
    this.applySettingsOpen();
  }

  renderStart(msg, isHost) {
    const blocker = startBlocker(msg);
    this.startBtn.hidden = !isHost;
    this.startBtn.setAttribute('aria-disabled', String(!!blocker));
    this.startBtn.classList.toggle('is-disabled', !!blocker);
    this.actionbar.classList.toggle('is-guest', !isHost);
    const host = msg.players.find((p) => p.id === msg.hostId);
    const sig = isHost ? `host|${blocker}|${msg.settings?.locked}` : `guest|${host?.name}`;
    if (sig === this.noteSig) return;   // an unchanged live region must not be re-announced on every lobby frame
    this.noteSig = sig;
    clear(this.startNote);
    this.startNote.classList.toggle('is-blocked', isHost && !!blocker);
    if (isHost) {
      this.startNote.textContent = blocker ?? (msg.settings?.locked ? 'Room is locked. Ready when you are!' : 'Everyone in? Start when you are ready.');
    } else {
      append(this.startNote, [el('span', { class: 'waiting-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), el('span', null, 'Waiting for ', host ? bdi(host.name) : 'the host', ' to start...')]);
    }
  }
}

// ================================================================================================
// Game screen: HUD around the canvas
// ================================================================================================

const CURSE_NAMES = { slow: 'Slowed', rush: 'Rushing', reverse: 'Reversed', nobomb: 'No bombs', spam: 'Bomb spam' };
const CURSE_HELP = { slow: 'You move slowly', rush: 'You cannot stop running', reverse: 'Your controls are flipped', nobomb: 'You cannot drop bombs', spam: 'Bombs drop by themselves' };
const iconButton = (name, label, onClick, cls = '') => el('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, on: { click: onClick } }, icon(name));

class GameScreen {
  constructor(ui, root) {
    this.ui = ui;
    this.chips = new Map();
    this.order = '';
    this.state = '';
    this.sd = false;
    this.winsNeeded = 0;
    this.meSig = '';
    this.timers = {};

    const existing = root.querySelector('#game');
    this.root = existing ?? el('section', { id: 'game', class: 'screen screen-game', hidden: true, 'aria-labelledby': 'game-title' },
      el('h1', { id: 'game-title', class: 'sr-only', tabindex: '-1', text: 'Match in progress' }));
    this.stage = this.root.querySelector('#stage') ?? this.root.appendChild(el('div', { id: 'stage' }));
    this.canvas = this.stage.querySelector('#arena') ?? this.stage.appendChild(el('canvas', { id: 'arena', role: 'img', 'aria-label': 'Game arena' }));
    this.hud = this.root.querySelector('#hud') ?? this.root.appendChild(el('div', { id: 'hud' }));
    this.touch = this.root.querySelector('#touch') ?? this.root.appendChild(el('div', { id: 'touch' }));
    if (!existing) root.appendChild(this.root);
    clear(this.hud);

    this.ping = pingMeter();
    this.muteBtn = iconButton('volume', 'Mute sound', () => ui.setMuted(!ui.settings.muted));
    this.emoteBtn = iconButton('smile', 'Emotes', () => this.toggleEmotes(), 'emote-btn');
    this.emoteBtn.setAttribute('aria-expanded', 'false');
    this.menuBtn = iconButton('menu', 'Menu', (e) => ui.showMenu(true, e.currentTarget));

    this.roundNo = el('span', { class: 'hud-round-no' });
    this.roundGoal = el('span', { class: 'hud-round-goal' });
    this.roundText = el('span', { class: 'hud-round' }, this.roundNo, this.roundGoal);
    this.timerText = el('span', { class: 'hud-time', text: '--' });
    this.timer = el('div', { class: 'hud-timer', 'aria-hidden': 'true' }, icon('clock'), this.timerText);
    this.sdChip = el('div', { class: 'hud-sd', hidden: true, 'aria-hidden': 'true' }, icon('bomb'), el('span', { text: 'Sudden death' }));
    this.center = el('div', { class: 'hud-center' }, this.roundText, this.timer, this.sdChip);
    this.chipList = el('ul', { class: 'hud-chips', 'aria-label': 'Fighters' });
    this.top = el('div', { class: 'hud-top' },
      el('div', { class: 'hud-tl' }, this.menuBtn, this.ping.node), this.center,
      el('div', { class: 'hud-tr' }, this.emoteBtn, this.muteBtn), this.chipList);

    this.feed = el('ul', { class: 'hud-feed', 'aria-live': 'polite', 'aria-label': 'Match events' });
    this.me = el('div', { class: 'hud-me', role: 'group', 'aria-label': 'Your status' });
    this.strip = el('div', { class: 'hud-strip' }, this.feed, this.me);

    this.count = el('div', { class: 'hud-count', 'aria-hidden': 'true' });
    this.banner = el('div', { class: 'hud-banner', 'aria-hidden': 'true' });
    this.roundEnd = el('div', { class: 'roundend', hidden: true });   // overlays the arena and everything below it
    this.emoteBar = el('div', { class: 'emote-bar', role: 'toolbar', 'aria-label': 'Emotes', hidden: true },
      EMOTES.map((glyph, i) => el('button', { class: 'emote-btn-item', type: 'button', 'aria-label': `${EMOTE_LABELS[i]} emote`, title: EMOTE_LABELS[i], on: { click: () => this.sendEmote(i) } },
        gameIcon(EMOTE_NAMES[i], 2.4), i < 6 ? el('kbd', { class: 'emote-key', 'aria-hidden': 'true', text: String(i + 1) }) : null)));
    this.layer = el('div', { class: 'hud-layer' }, this.count, this.banner);
    this.hud.append(this.top, this.layer, this.strip, this.emoteBar, this.roundEnd);

    document.addEventListener('pointerdown', (e) => {
      if (!this.emoteBar.hidden && !this.emoteBar.contains(e.target) && !this.emoteBtn.contains(e.target)) this.toggleEmotes(false);
    }, true);
    this.paintMute();
  }

  // ---- Round lifecycle

  begin(players) {
    this.showRoundEnd(null);
    this.showCountdown(null);
    this.toggleEmotes(false);
    clear(this.banner).className = 'hud-banner';
    clear(this.feed);
    this.sd = false;
    this.state = '';
    this.meSig = '';
    this.setSuddenDeath(false);
    if (Array.isArray(players)) this.buildChips(records(players));
  }

  end() {
    this.toggleEmotes(false);
    this.showCountdown(null);
  }

  // ---- Chips

  buildChips(players) {
    this.chips.clear();
    clear(this.chipList);
    const n = players.length;
    const left = Math.ceil(n / 2);
    this.chipList.dataset.count = String(n);
    this.root.style.setProperty('--rows', String(left));
    this.chipList.style.setProperty('--cols', String(Math.max(1, Math.min(n, 8))));
    players.forEach((p, i) => {
      const chip = this.makeChip(p);
      chip.li.dataset.side = i < left ? 'left' : 'right';
      chip.li.style.setProperty('--row', String(i < left ? i + 1 : i - left + 1));
      this.chips.set(p.id, chip);
      this.chipList.appendChild(chip.li);
    });
    this.order = players.map((p) => p.id).join(',');
  }

  makeChip(p) {
    const teamBadge = el('span', { class: 'team-badge chip-team', dataset: { team: String(p.team === 1 ? 1 : 0) }, hidden: true, 'aria-hidden': 'true', text: teamLetter(p.team) });
    const status = el('span', { class: 'chip-status', 'aria-hidden': 'true' });
    const winsText = el('b', { text: '0' });
    const stat = (name, label) => {
      const value = el('b', { text: '0' });
      const node = el('span', { class: `stat stat-${name}`, title: label }, gameIcon(name, 1.1), value);
      return { node, value };
    };
    const stats = { bomb: stat('bomb', 'Bombs at once'), flame: stat('flame', 'Blast range'), speed: stat('speed', 'Speed level') };
    const kick = el('span', { class: 'stat stat-kick', title: 'Can kick bombs', hidden: true }, gameIcon('kick', 1.1));
    const glove = el('span', { class: 'stat stat-glove', title: 'Can throw bombs', hidden: true }, gameIcon('glove', 1.1));
    const li = el('li', { class: 'chip', style: { '--c': colorInfo(p.color).hex }, dataset: { id: String(p.id) } },
      el('span', { class: 'chip-av' }, avatar(p.color, 2.1), teamBadge, status),
      el('span', { class: 'chip-body' },
        bdi(p.name, 'chip-name'),
        el('span', { class: 'chip-wins', title: 'Round wins' }, icon('star'), winsText),
        el('span', { class: 'chip-stats' }, stats.bomb.node, stats.flame.node, stats.speed.node, kick, glove)));
    return { li, status, teamBadge, winsText, stats, kick, glove, last: {}, name: p.name, color: p.color, team: p.team };
  }

  updateChip(chip, p, teams) {
    const last = chip.last;
    const shield = Math.max(0, p.shield | 0);
    const state = !p.alive ? 'out' : p.curse ? 'cursed' : shield > 0 ? 'shield' : 'ok';
    if (last.state !== state || last.curse !== p.curse) {
      chip.li.dataset.state = state;
      clear(chip.status);
      const glyph = state === 'out' ? 'ghost' : state === 'cursed' ? 'skull' : state === 'shield' ? 'shield' : '';
      if (glyph) chip.status.appendChild(gameIcon(glyph, 1));
      const words = { out: 'out of the round', cursed: `cursed: ${CURSE_NAMES[p.curse] ?? p.curse}`, shield: 'shielded', ok: '' };
      chip.li.title = `${chip.name}${words[state] ? `, ${words[state]}` : ''}`;
    }
    const label = `${chip.name}, ${plural(p.wins | 0, 'win')}${teams ? `, team ${teamLetter(p.team)}` : ''}${p.isMe ? ', you' : ''}${p.alive ? '' : ', out of the round'}${p.curse ? `, cursed: ${CURSE_NAMES[p.curse] ?? p.curse}` : shield > 0 ? ', shielded' : ''}`;
    if (last.label !== label) chip.li.setAttribute('aria-label', label);
    if (last.isMe !== !!p.isMe) chip.li.classList.toggle('is-me', !!p.isMe);
    if (last.teams !== teams) chip.teamBadge.hidden = !teams;
    if (last.wins !== p.wins) chip.winsText.textContent = String(p.wins | 0);
    if (last.bombsMax !== p.bombsMax) chip.stats.bomb.value.textContent = String(p.bombsMax);
    if (last.range !== p.range) chip.stats.flame.value.textContent = String(p.range);
    if (last.speedLv !== p.speedLv) chip.stats.speed.value.textContent = String(p.speedLv);
    if (last.kick !== !!p.kick) chip.kick.hidden = !p.kick;
    if (last.glove !== !!p.glove) chip.glove.hidden = !p.glove;
    const away = p.connected === false || p.waiting;
    if (last.away !== away) chip.li.classList.toggle('is-away', away);
    Object.assign(last, { state, curse: p.curse, label, isMe: !!p.isMe, teams, wins: p.wins, bombsMax: p.bombsMax, range: p.range, speedLv: p.speedLv, kick: !!p.kick, glove: !!p.glove, away });
  }

  update(m) {
    const ids = m.players.map((p) => p.id).join(',');
    if (ids !== this.order) {
      this.buildChips(m.players);
      this.meSig = '';
    }
    const teams = m.mode === 'teams';
    this.chipList.classList.toggle('is-teams', teams);
    let mine = null;
    for (const p of m.players) {
      const chip = this.chips.get(p.id);
      if (chip) this.updateChip(chip, p, teams);
      if (p.isMe) mine = p;
    }
    this.updateMe(mine);

    const timeText = m.timeLeftSec == null ? '\u221e' : formatClock(m.timeLeftSec);
    if (this.timerText.textContent !== timeText) this.timerText.textContent = timeText;
    const low = m.state === 'playing' && m.timeLeftSec != null && m.timeLeftSec <= 10 && !m.suddenDeath;
    this.timer.classList.toggle('is-low', low);
    const roundNo = `Round ${m.roundNo}`;
    if (this.roundNo.textContent !== roundNo) this.roundNo.textContent = roundNo;
    const goal = m.winsNeeded ? ` \u00b7 First to ${m.winsNeeded}` : '';
    if (this.roundGoal.textContent !== goal) this.roundGoal.textContent = goal;
    this.winsNeeded = m.winsNeeded;
    if (!!m.suddenDeath !== this.sd) {
      this.setSuddenDeath(!!m.suddenDeath);
      if (m.suddenDeath) {
        this.showBanner('Sudden death!', 'danger');
        this.ui.announce('Sudden death! The walls are closing in.');
      }
    }
    this.state = m.state;
  }

  setSuddenDeath(on) {
    this.sd = on;
    this.sdChip.hidden = !on;
    this.center.classList.toggle('is-sd', on);
  }

  updateMe(p) {
    if (!p) {
      if (this.meSig !== 'none') {
        this.meSig = 'none';
        clear(this.me).appendChild(el('span', { class: 'me-item me-watch' }, icon('eye'), 'You are watching this round'));
      }
      return;
    }
    const shield = Math.max(0, p.shield | 0);
    const shieldSec = shield >= SHIELD_FOREVER ? 0 : Math.ceil(shield / 60);
    const sig = [p.alive, p.bombsMax, p.range, p.speedLv, p.kick, p.glove, shield > 0, shieldSec, p.curse].join();
    if (sig === this.meSig) return;
    this.meSig = sig;
    clear(this.me);
    if (!p.alive) {
      append(this.me, [el('span', { class: 'me-item me-out' }, gameIcon('ghost', 1.4), el('span', { text: 'You are out. Watch the rest of the round!' }))]);
      return;
    }
    const item = (name, text, title, cls = '') => el('span', { class: `me-item ${cls}`.trim(), title }, gameIcon(name, 1.35), text ? el('b', { text }) : null);
    append(this.me, [
      item('bomb', `\u00d7${p.bombsMax}`, `Bombs at once: ${p.bombsMax}`),
      item('flame', String(p.range), `Blast range: ${p.range}`),
      item('speed', String(p.speedLv), `Speed level: ${p.speedLv}`),
      p.kick ? item('kick', '', 'You can kick bombs') : null,
      p.glove ? item('glove', '', 'Press the special button to throw a bomb') : null,
      shield > 0 ? item('shield', shieldSec ? `${shieldSec}s` : 'Shield', 'Shielded: flames cannot hurt you', 'me-shield') : null,
      p.curse ? el('span', { class: 'me-item me-curse', title: CURSE_HELP[p.curse] ?? 'Cursed' }, gameIcon(p.curse, 1.35), el('b', { text: CURSE_NAMES[p.curse] ?? 'Cursed' })) : null,
      p.curse ? el('p', { class: 'me-help', text: `${CURSE_HELP[p.curse] ?? 'Something odd is happening'}. Touch a friend to pass it on!` }) : null,
    ]);
  }

  // ---- Countdown, banners, feed

  showCountdown(text) {
    clearTimeout(this.timers.count);
    if (text == null || text === '') {
      this.count.className = 'hud-count';
      this.count.textContent = '';
      return;
    }
    const go = /^go/i.test(text);
    this.count.className = 'hud-count';
    void this.count.offsetWidth;   // restart the pop animation for a repeated call
    this.count.textContent = text;
    this.count.className = `hud-count is-on ${go ? 'is-go' : `n-${String(text).replace(/\W/g, '')}`}`;
    this.ui.announce(go ? 'Go!' : String(text));
    this.timers.count = setTimeout(() => this.showCountdown(null), go ? 1100 : 1400);
  }

  showBanner(text, kind = 'info', ms = 2400) {
    clearTimeout(this.timers.banner);
    this.banner.className = 'hud-banner';
    void this.banner.offsetWidth;
    this.banner.textContent = text;
    this.banner.className = `hud-banner is-on banner-${kind}`;
    this.timers.banner = setTimeout(() => { this.banner.className = 'hud-banner'; }, ms);
  }

  feedAdd(text, kind = 'kill') {
    const item = el('li', { class: `feed-item feed-${kind}` }, gameIcon(kind === 'chat' ? 'heart' : 'skull', 1.1), el('span', { text }));
    this.feed.appendChild(item);
    while (this.feed.children.length > 4) this.feed.firstChild.remove();
    setTimeout(() => item.remove(), kind === 'chat' ? 7000 : 5000);
  }

  // ---- Emotes

  toggleEmotes(force) {
    const open = force ?? this.emoteBar.hidden;
    this.emoteBar.hidden = !open;
    this.emoteBtn.setAttribute('aria-expanded', String(open));
    clearTimeout(this.timers.emote);
    if (open) this.timers.emote = setTimeout(() => this.toggleEmotes(false), 8000);
  }

  sendEmote(i) {
    this.ui.emit('onEmote', i);
    this.toggleEmotes(false);
  }

  paintMute() {
    const muted = this.ui.settings.muted;
    const label = muted ? 'Unmute sound' : 'Mute sound';
    this.muteBtn.setAttribute('aria-label', label);
    this.muteBtn.title = label;
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.muteBtn.replaceChildren(icon(muted ? 'mute' : 'volume'));
  }

  // ---- Round end card

  showRoundEnd(msg, players) {
    const box = this.roundEnd;
    if (!msg) {
      box.hidden = true;
      clear(box);
      return;
    }
    const byId = new Map(records(players ?? this.ui.lobbyMsg?.players).map((p) => [p.id, p]));
    // Somebody who left since the lobby message was sent is still on the scoreboard: the round's own roster remembers them.
    for (const [id, chip] of this.chips) if (!byId.has(id)) byId.set(id, { id, name: chip.name, color: chip.color, team: chip.team });
    const scores = records(msg.scores);
    const teams = this.ui.lobbyMsg?.settings?.mode === 'teams' || (msg.winnerTeam != null && msg.winnerId == null);
    const winner = msg.winnerId != null ? byId.get(msg.winnerId) : null;
    const me = this.ui.you;
    const draw = !!msg.draw || (!winner && msg.winnerTeam == null);
    const youWon = !draw && (winner ? winner.id === me : byId.get(me)?.team === msg.winnerTeam);
    const needed = this.winsNeeded || this.ui.lobbyMsg?.round?.winsNeeded || 0;
    const reasonText = { last: 'Last one standing', wipe: 'Everybody got blasted', timeout: 'Time ran out' }[msg.reason] ?? '';

    let title;
    let art;
    if (draw) {
      title = 'It is a draw!';
      art = el('div', { class: 're-draw' }, gameIcon('bomb', 4), gameIcon('ghost', 4));
    } else if (winner && !teams) {
      title = youWon ? 'You win the round!' : null;
      art = el('div', { class: 're-winner', style: { '--c': colorInfo(winner.color).hex } }, gameIcon('crown', 2.6, 're-crown'), avatar(winner.color, 6.5, 're-avatar'));
    } else {
      const t = msg.winnerTeam === 1 ? 1 : 0;
      title = youWon ? 'Your team wins the round!' : `${TEAM_NAMES[t]} wins the round!`;
      const members = [...byId.values()].filter((p) => p.team === t).slice(0, 4);
      art = el('div', { class: 're-team', dataset: { team: String(t) } }, members.map((p) => avatar(p.color, 4.4, 're-avatar')));
    }

    const scoreRows = [];
    const pips = (wins) => {
      const total = Math.max(needed, wins, 1);
      return el('span', { class: 're-pips', role: 'img', 'aria-label': `${wins} of ${needed || total} wins` },
        Array.from({ length: total }, (_, i) => el('span', { class: `pip${i < wins ? ' is-on' : ''}` }, icon('star'))));
    };
    if (teams) {
      for (const t of [0, 1]) {
        const wins = Math.max(0, ...scores.filter((s) => s.team === t).map((s) => s.wins | 0));
        scoreRows.push(el('li', { class: 're-score', dataset: { team: String(t) } }, el('span', { class: 'team-badge', dataset: { team: String(t) }, text: teamLetter(t) }), el('span', { class: 're-name', text: TEAM_NAMES[t] }), pips(wins)));
      }
    } else {
      for (const s of scores) {
        const p = byId.get(s.id);
        if (!p) continue;
        scoreRows.push(el('li', { class: `re-score${s.id === msg.winnerId ? ' is-winner' : ''}${s.id === me ? ' is-me' : ''}` }, avatar(p.color, 1.7), bdi(p.name, 're-name'), pips(s.wins | 0)));
      }
    }

    clear(box);
    box.hidden = false;
    box.dataset.kind = draw ? 'draw' : youWon ? 'you' : 'win';
    append(box, [el('div', { class: 're-card' },
      msg.n ? el('p', { class: 're-round', text: `Round ${msg.n}` }) : null,
      art,
      title ? el('h2', { class: 're-title', text: title }) : el('h2', { class: 're-title' }, bdi(winner.name), ' wins the round!'),
      reasonText ? el('p', { class: 're-reason', text: reasonText }) : null,
      scoreRows.length ? el('ul', { class: `re-scores${teams ? ' is-teams' : ''}`, 'aria-label': 'Scores' }, scoreRows) : null,
      el('p', { class: 're-next', text: msg.matchOver ? 'Match over! Final results next...' : 'Next round starting soon...' }))]);
    if (!draw) this.ui.confetti(box, youWon ? 46 : 26);
    const who = draw ? 'Draw' : winner ? winner.name : TEAM_NAMES[msg.winnerTeam === 1 ? 1 : 0];
    this.ui.announce(draw ? 'Round over: a draw.' : `Round over: ${who} wins.`);
  }
}

// ================================================================================================
// Match results: podium, awards, standings
// ================================================================================================

const MEDALS = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' };

class ResultsScreen {
  constructor(ui) {
    this.ui = ui;
    this.msg = null;
    this.deadline = 0;
    this.ping = pingMeter();
    this.title = el('h1', { id: 'results-h1', class: 'results-title', tabindex: '-1' });
    this.sub = el('p', { class: 'results-sub' });
    this.podium = el('div', { class: 'podium', role: 'list', 'aria-label': 'Podium' });
    this.awards = el('section', { class: 'card awards-card', 'aria-labelledby': 'awards-h' }, el('h2', { id: 'awards-h', class: 'card-title' }, icon('star'), 'Awards'));
    this.awardList = el('ul', { class: 'awards' });
    this.awards.appendChild(this.awardList);
    this.tbody = el('tbody');
    this.table = el('table', { class: 'standings' },
      el('caption', { class: 'sr-only', text: 'Final standings' }),
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', class: 'col-place', title: 'Place', 'aria-label': 'Place', text: '#' }), el('th', { scope: 'col', class: 'col-name', text: 'Player' }),
        el('th', { scope: 'col', class: 'col-num', title: 'Round wins', text: 'Wins' }), el('th', { scope: 'col', class: 'col-num', title: 'Rivals blasted', text: 'Kills' }),
        el('th', { scope: 'col', class: 'col-num hide-xs', title: 'Times blasted', text: 'Deaths' }),
        el('th', { scope: 'col', class: 'col-num hide-sm', title: 'Own goals: blasted by their own bomb', text: 'Oops' }),
        el('th', { scope: 'col', class: 'col-num hide-sm', title: 'Blocks destroyed', text: 'Blocks' }),
        el('th', { scope: 'col', class: 'col-num hide-sm', title: 'Power-ups collected', text: 'Items' }))),
      this.tbody);
    this.chat = new ChatPanel(ui, 'results-chat-h');
    ui.chatPanels.push(this.chat);
    this.note = el('p', { class: 'start-note', 'aria-live': 'polite' });
    this.againBtn = el('button', { class: 'btn btn-green btn-xl', type: 'button', on: { click: () => ui.emit('onStart') } }, icon('refresh'), 'Play again');
    this.lobbyBtn = el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: () => ui.emit('onBackToLobby') } }, icon('home'), 'Back to lobby');
    this.actionbar = el('div', { class: 'actionbar' }, this.note, el('div', { class: 'actionbar-buttons' }, this.lobbyBtn, this.againBtn));
    this.confettiHost = el('div', { class: 'confetti-host', 'aria-hidden': 'true' });

    this.root = el('section', { id: 'screen-results', class: 'screen screen-results', hidden: true, 'aria-labelledby': 'results-h1' },
      this.confettiHost,
      el('div', { class: 'results-inner' },
        el('header', { class: 'lobby-bar' },
          el('button', { class: 'btn btn-glass btn-sm', type: 'button', on: { click: () => ui.emit('onLeave') } }, icon('leave'), 'Leave'),
          el('span', { class: 'lobby-title-spacer' }),
          el('div', { class: 'lobby-bar-end' }, this.ping.node)),
        el('div', { class: 'results-head' }, this.title, this.sub),
        el('div', { class: 'results-grid' },
          el('div', { class: 'lobby-col' }, this.podium, this.awards),
          el('div', { class: 'lobby-col' }, el('section', { class: 'card standings-card', 'aria-labelledby': 'standings-h' }, el('h2', { id: 'standings-h', class: 'card-title' }, icon('users'), 'Standings'), this.table), this.chat.root)),
        this.actionbar));
  }

  render(msg) {
    this.msg = msg;
    const ui = this.ui;
    const standings = records(msg.standings);
    const teams = msg.winnerTeam != null;
    const teamMatch = teams || ui.lobbyMsg?.settings?.mode === 'teams';
    const me = ui.you;
    const notEnough = msg.reason === 'not_enough_players';
    const winners = standings.filter((s) => s.place === 1);
    const meWon = winners.some((s) => s.id === me);

    // ---- Headline
    let title;
    if (notEnough) title = 'Match ended';
    else if (teams) title = meWon ? 'Your team wins!' : `${TEAM_NAMES[msg.winnerTeam === 1 ? 1 : 0]} wins!`;
    else if (msg.winnerId != null) title = meWon ? 'You win!' : null;
    else title = 'It is a tie!';
    const champion = standings.find((s) => s.id === msg.winnerId);
    clear(this.title);
    if (title) this.title.textContent = title;
    else append(this.title, [bdi(champion?.name ?? 'Nobody'), ' wins!']);
    const shared = !teams && winners.length > 1;
    this.sub.textContent = notEnough ? 'Not enough players - match ended'
      : shared ? `The win is shared${msg.reason === 'cap' ? ': the round limit was reached with nothing to separate them.' : '.'}`
        : msg.reason === 'cap' ? 'Round limit reached: the best record wins.' : 'Great match, everybody!';
    this.title.dataset.tone = meWon && !notEnough ? 'win' : 'neutral';

    // ---- Podium: one step per distinct place (joint places share a step, whole teams share one in team matches)
    clear(this.podium);
    podiumGroups(standings, { byTeam: teamMatch }).forEach(({ place, people }, rank) => {
      const single = people.length === 1;
      const size = single ? (rank === 0 ? 5.2 : 4) : Math.max(2.8, 4 - people.length * 0.3);
      const step = el('div', { class: `podium-step step-${rank + 1}`, role: 'listitem', style: { '--n': people.length }, 'aria-label': `${MEDALS[place] ?? `Place ${place}`}: ${people.map((s) => s.name).join(', ')}` },
        el('div', { class: 'podium-people' }, people.slice(0, 4).map((s) => el('div', { class: `podium-person${s.id === me ? ' is-me' : ''}`, style: { '--c': colorInfo(s.color).hex } },
          rank === 0 ? gameIcon('crown', 1.9, 'podium-crown') : null, avatar(s.color, size, 'podium-avatar'), bdi(s.name, 'podium-name'),
          el('span', { class: 'podium-wins' }, icon('star'), el('b', { text: String(s.wins) })))),
          people.length > 4 ? el('span', { class: 'podium-more', text: `+${people.length - 4} more` }) : null),
        el('div', { class: 'podium-block' }, el('span', { class: 'podium-place', 'aria-hidden': 'true', text: String(place) })));
      this.podium.appendChild(step);
    });

    // ---- Awards
    const awards = computeAwards(standings);
    this.awards.hidden = awards.length === 0;
    clear(this.awardList);
    for (const a of awards) {
      this.awardList.appendChild(el('li', { class: 'award', title: a.hint, style: { '--c': colorInfo(a.player.color).hex } },
        el('span', { class: 'award-icon' }, gameIcon(a.icon, 2.2)),
        el('span', { class: 'award-text' }, el('b', { class: 'award-title', text: a.title }), el('span', { class: 'award-who' }, bdi(a.player.name), ` \u00b7 ${a.label}`))));
    }

    // ---- Standings
    clear(this.tbody);
    for (const s of standings) {
      this.tbody.appendChild(el('tr', { class: s.id === me ? 'is-me' : '', style: { '--c': colorInfo(s.color).hex } },
        el('td', { class: 'col-place' }, el('span', { class: `medal medal-${Math.min(s.place, 4)}`, title: MEDALS[s.place] ?? '', text: String(s.place) })),
        el('td', { class: 'col-name' }, el('span', { class: 'std-name' }, avatar(s.color, 2), bdi(s.name), s.id === me ? el('span', { class: 'you-tag', text: 'YOU' }) : null,
          teamMatch ? el('span', { class: 'team-badge', dataset: { team: String(s.team === 1 ? 1 : 0) }, text: teamLetter(s.team) }) : null)),
        el('td', { class: 'col-num' }, el('b', { text: String(s.wins) })), el('td', { class: 'col-num', text: String(s.kills) }), el('td', { class: 'col-num hide-xs', text: String(s.deaths) }),
        el('td', { class: 'col-num hide-sm', text: String(s.selfKills) }), el('td', { class: 'col-num hide-sm', text: String(s.blocks) }), el('td', { class: 'col-num hide-sm', text: String(s.items) })));
    }

    this.deadline = performance.now() + TIMEOUTS.RESULTS_AUTO_MS;
    this.renderActions();
    clear(this.confettiHost);
    if (!notEnough) ui.confetti(this.confettiHost, meWon ? 90 : 50);
    ui.announce(notEnough ? 'Not enough players. Match ended.' : title ?? `${champion?.name ?? 'Nobody'} wins the match.`);
  }

  /** Buttons depend on who is host, which can change while the results are up. */
  renderActions() {
    const lobby = this.ui.lobbyMsg;
    const isHost = !!lobby && lobby.you === lobby.hostId;
    this.againBtn.hidden = !isHost;
    this.lobbyBtn.hidden = !isHost;
    this.actionbar.classList.toggle('is-guest', !isHost);
    this.tick(isHost);
  }

  tick(isHost = this.ui.lobbyMsg && this.ui.lobbyMsg.you === this.ui.lobbyMsg.hostId) {
    const left = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
    const host = this.ui.lobbyMsg?.players.find((p) => p.id === this.ui.lobbyMsg.hostId);
    const text = left > 0 ? `Back to the lobby in ${left} s` : 'Heading back to the lobby...';
    if (isHost) {
      if (this.note.textContent !== text) this.note.textContent = text;
    } else {
      const sig = `${text}|${host?.name}`;
      if (this.note.dataset.sig !== sig) {
        this.note.dataset.sig = sig;
        clear(this.note);
        append(this.note, [el('span', null, 'Waiting for ', host ? bdi(host.name) : 'the host', ` to pick what is next. ${text}.`)]);
      }
    }
  }
}

// ================================================================================================
// Platform helpers
// ================================================================================================

/** Copies text; resolves false when the browser refuses (the caller then asks the user to press Ctrl/Cmd+C). SPEC 8.3. */
async function copyText(t) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    // fall through to the textarea trick
  }
  const ta = Object.assign(document.createElement('textarea'), { value: t, readOnly: true });
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, t.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

function toggleFullscreen() {
  try {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d)?.catch?.(() => {});
    else (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen)?.call(d.documentElement)?.catch?.(() => {});
  } catch {
    // fullscreen is a nicety; a refusal changes nothing
  }
}

// Positions of the drifting decorations behind the menus: [x %, y %, size rem, duration s, delay s, kind]
const DECOR = [
  [6, 12, 4.5, 46, -8, 'bomb'], [88, 8, 3, 38, -20, 'star'], [78, 46, 5.5, 58, -30, 'bomb'], [14, 62, 3.2, 40, -4, 'star'],
  [92, 78, 4, 52, -14, 'bomb'], [40, 88, 5, 62, -40, 'bomb'], [58, 6, 2.6, 34, -12, 'star'], [26, 34, 2.4, 44, -26, 'star'],
  [66, 70, 2.8, 36, -6, 'star'], [4, 90, 3.6, 48, -18, 'bomb'], [50, 46, 2.2, 42, -34, 'star'], [96, 30, 3, 50, -22, 'bomb'],
];

// ================================================================================================
// The UI
// ================================================================================================

/**
 * The whole DOM UI as a pure view. It owns no network and no game state: main.js pushes data in through the render
 * methods and receives user intent through the callbacks. See the file header for the exact API.
 */
export class UI {
  /**
   * @param {HTMLElement} root the app container (index.html: #app). Missing pieces of the static skeleton are created.
   * @param {object} [callbacks] onCreate(name) onJoin(code,name) onPractice(name) onProfile({id?,name?,color?,team?})
   *   onSettings(patch) onAddBot(level) onRemoveBot(id) onKick(id) onStart() onChat(text) onEmote(e) onLeave() onBackToLobby()
   *   onMute(bool) onVolume(v 0..1) onToggleEffects(reduce:bool) onControlsSide('right'|'left')
   */
  constructor(root = document.getElementById('app') ?? document.body, callbacks = {}) {
    this.root = root;
    this.cb = callbacks;
    /** The single-file download (no server): the title screen offers Practice / Host / Join instead of Create / Join by room code. */
    this.single = window.__BP_SINGLE__ === true;
    /** 'host' | 'guest' while in a room that lives in a browser (single-file play with friends), else null. */
    this.p2p = null;
    this.p2pDialog = null;
    /** How many friends are connected to this hosted game (main.js replaces it): the menu words "leave" differently for a host on their own. */
    this.friendCount = () => 0;
    this.current = '';
    this.you = -1;
    this.lobbyMsg = null;
    this.chatHistory = [];
    this.chatPanels = [];
    this.qr = null;
    this.blockers = 0;
    this.timers = {};
    this.lastPing = null;
    this.touchOverride = null;
    this.dialog = null;
    this.menuModal = null;
    this.howto = null;
    this.settingsModal = null;
    this.settings = {
      volume: 0.7,
      muted: false,
      reduce: (store.get('bp.reduce') ?? (matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0')) === '1',
      hand: store.get('bp.hand') === 'left' ? 'left' : 'right',
    };

    root.classList.add('app');
    this.backdrop = el('div', { class: 'backdrop', 'aria-hidden': 'true' }, DECOR.map(([x, y, s, dur, delay, kind]) =>
      el('span', { class: `deco deco-${kind}`, style: { '--x': `${x}%`, '--y': `${y}%`, '--s': `${s}rem`, '--dur': `${dur}s`, '--delay': `${delay}s` } }, icon(kind))));
    root.insertBefore(this.backdrop, root.firstChild);
    installSprites(root);

    const overlays = root.querySelector('#overlays') ?? root.appendChild(el('div', { id: 'overlays' }));
    this.layers = {
      live: root.querySelector('#sr-live') ?? root.appendChild(el('div', { id: 'sr-live', class: 'sr-only', role: 'status', 'aria-live': 'polite' })),
      toasts: overlays.appendChild(el('div', { class: 'toasts', 'aria-live': 'polite' })),
      modals: overlays.appendChild(el('div', { class: 'modal-layer' })),
      conn: overlays.appendChild(el('div', { class: 'conn-layer' })),
    };
    this.toasts = new Toasts(this.layers.toasts);
    this.modals = new Modals(this);

    this.title = new TitleScreen(this);
    this.lobby = new LobbyScreen(this);
    this.game = new GameScreen(this, root);
    this.results = new ResultsScreen(this);
    this.screens = { title: this.title, lobby: this.lobby, game: this.game, results: this.results };
    for (const s of [this.title, this.lobby, this.results]) root.insertBefore(s.root, overlays);
    this.headings = { title: this.title.h1, lobby: this.lobby.title, results: this.results.title, game: null };
    this.pings = [this.lobby.ping, this.results.ping, this.game.ping];

    this.connecting = null;
    this.reconnecting = null;
    this.applyEffects();
    this.applyHand();
    this.watchViewport();
    this.applyTouch();
    /** Resolves once the optional modules (sprites.js, qr.js) have loaded or failed: after it, portraits and the QR code are painted. */
    this.ready = this.loadOptionalModules();
  }

  // ---- Plumbing

  /** Runs a callback the host page registered; a throwing callback must never break the UI. */
  emit(name, ...args) {
    try {
      return this.cb[name]?.(...args);
    } catch (err) {
      console.error(`UI callback ${name} failed`, err);
      return undefined;
    }
  }

  /** Makes the screens inert (unfocusable, unclickable) while a modal or a blocking overlay is up. */
  block(delta) {
    this.blockers = Math.max(0, this.blockers + delta);
    for (const s of Object.values(this.screens)) s.root.inert = this.blockers > 0;
  }

  async loadOptionalModules() {
    // Both are optional: without sprites.js the UI draws CSS/SVG stand-ins, without qr.js the lobby has no QR code.
    const sprites = import('./sprites.js').then((m) => { art.sprites = m; repaintAllArt(this.root); }).catch(() => {});
    const qr = import('../../shared/qr.js').then((m) => { this.qr = m; const url = this.lobby.inviteUrl(); if (url) this.lobby.drawQr(url); }).catch(() => {});
    await Promise.all([sprites, qr]);
  }

  watchViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const style = document.documentElement.style;
      if (vv.scale > 1.01) {
        style.removeProperty('--app-h');
        style.removeProperty('--app-top');
      } else {
        style.setProperty('--app-h', `${vv.height}px`);   // shrinks with the on-screen keyboard so the chat box stays visible
        style.setProperty('--app-top', `${vv.offsetTop}px`);
      }
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  }

  applyTouch() {
    const coarse = matchMedia('(pointer: coarse)');
    const paint = () => { this.game.root.dataset.touch = (this.touchOverride ?? coarse.matches) ? '1' : '0'; };
    coarse.addEventListener?.('change', paint);
    this.paintTouch = paint;
    paint();
  }

  /** Forces the touch-controls layout on or off (null = follow the device's primary pointer). */
  setTouchLayout(flag) {
    this.touchOverride = flag;
    this.paintTouch();
  }

  applyEffects() {
    document.documentElement.classList.toggle('reduce-fx', this.settings.reduce);
  }

  applyHand() {
    document.documentElement.dataset.hand = this.settings.hand;
  }

  /** Screen-reader announcement (polite live region). */
  announce(text) {
    clearTimeout(this.timers.announce);
    this.layers.live.textContent = '';
    this.timers.announce = setTimeout(() => { this.layers.live.textContent = text; }, 40);
  }

  /** A short burst of confetti inside `host`, unless effects are reduced. */
  confetti(host, count = 40) {
    if (this.settings.reduce) return;
    const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < count; i++) {
      layer.appendChild(el('i', { style: {
        '--x': `${(Math.random() * 100).toFixed(1)}%`,
        '--delay': `${(Math.random() * 0.8).toFixed(2)}s`,
        '--fall': `${(2.4 + Math.random() * 2).toFixed(2)}s`,
        '--spin': `${Math.round(Math.random() * 900 - 450)}deg`,
        '--drift': `${Math.round(Math.random() * 80 - 40)}px`,
        '--c': PLAYER_COLORS[i % PLAYER_COLORS.length].hex,
        '--w': `${(0.35 + Math.random() * 0.4).toFixed(2)}rem`,
      } }));
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 5200);
  }

  // ---- Screens

  /** Shows one screen ('title' | 'lobby' | 'game' | 'results'), hides the rest and moves focus to its heading. */
  show(name) {
    const next = this.screens[name];
    if (!next) return;
    const from = this.current;
    this.current = name;
    for (const [key, s] of Object.entries(this.screens)) s.root.hidden = key !== name;
    this.root.dataset.screen = name;
    if (from === 'game' && name !== 'game') this.game.end();
    for (const chat of this.chatPanels) chat.setLive(name !== 'game');
    clearInterval(this.timers.results);
    if (name === 'results') this.timers.results = setInterval(() => this.results.tick(), 1000);
    if (from !== name) {
      next.root.scrollTop = 0;
      if (name === 'lobby') this.lobby.chat.scrollToEnd();
      if (name === 'results') this.results.chat.scrollToEnd();
      if (name === 'game') document.activeElement?.blur?.();
      else requestAnimationFrame(() => (name === 'title' ? this.title.focusTarget() : this.headings[name])?.focus({ preventScroll: true }));
    }
  }

  /** The elements main.js hands to the renderer and the input layer. */
  getGameElements() {
    return { wrap: this.game.stage, canvas: this.game.canvas, touchRoot: this.game.touch };
  }

  /** Resets everything tied to a room and shows the home screen. @param {{name?:string, code?:string, error?:string}} [opts] */
  showTitle(opts = {}) {
    this.modals.closeAll();
    this.hideDialog();
    this.showConnecting(null);
    this.showReconnecting(null);
    this.resetRoom();
    this.title.show(opts ?? {});
    this.show('title');
  }

  resetRoom() {
    this.p2p = null;
    this.p2pDialog?.close?.();
    this.lobbyMsg = null;
    this.you = -1;
    this.chatHistory = [];
    for (const chat of this.chatPanels) chat.reset();
    this.game.begin([]);
    this.game.order = '';
    this.lobby.kickConfirm = null;
    this.lobby.settingsOpen = null;
    this.lobby.noteSig = '';
    this.results.deadline = 0;
  }

  /**
   * Lobby data arrives in every phase. The lobby screen is only shown for phase 'lobby'; in 'match' and 'results' the message
   * just refreshes what the game menu and results screen know (host, names), so main.js can call this on every `lobby` frame.
   */
  showLobby(msg) {
    if (!msg || !Array.isArray(msg.players)) return;
    msg = { ...msg, players: records(msg.players) };
    const prev = this.lobbyMsg;
    this.lobbyMsg = msg;
    this.you = msg.you;
    if (prev && prev.code === msg.code) this.announceChanges(prev, msg);
    this.lobby.render(msg);
    this.setPing(this.lastPing);
    if (this.current === 'results') this.results.renderActions();
    if (msg.phase === 'lobby') this.show('lobby');
  }

  announceChanges(prev, next) {
    if (next.phase === 'match') return;
    const before = new Map(prev.players.map((p) => [p.id, p]));
    const after = new Map(next.players.map((p) => [p.id, p]));
    const said = [];
    for (const p of next.players) if (!before.has(p.id)) said.push(`${p.name} joined`);
    for (const p of prev.players) if (!after.has(p.id)) said.push(`${p.name} left`);
    if (prev.hostId !== next.hostId) {
      const host = after.get(next.hostId);
      if (host) said.push(next.hostId === next.you ? 'You are now the host' : `${host.name} is now the host`);
    }
    if (said.length) this.announce(said.join('. '));
  }

  /** @param {{players?: {id:number,name:string,color:number,team:number,isBot:boolean}[]}} [round] the `round` message (only its fighters are used) */
  showGame(round) {
    this.game.begin(round?.players);
    this.show('game');
    if (!fullscreenSupported() && matchMedia('(pointer: coarse)').matches && !store.get('bp.fshint')) {
      store.set('bp.fshint', '1');
      this.toast('Tap Share, then "Add to Home Screen" for full-screen play', 'info', { ms: 7000 });
    }
  }

  /** ~10 Hz. `m` is the hudModel of SPEC 8.6. */
  updateHud(m) {
    if (m && Array.isArray(m.players)) this.game.update({ ...m, players: records(m.players) });
  }

  /** Round-trip time in ms (null = unknown). In Practice the meters show "Local". */
  setPing(ms) {
    this.lastPing = ms ?? null;
    const local = !!this.lobbyMsg?.local || this.p2p === 'host';
    for (const meter of this.pings) meter.set(this.lastPing, local, this.p2p === 'host' ? 'host' : '');
  }

  /** "3", "2", "1", "GO!" or null to clear. */
  showCountdown(text) {
    this.game.showCountdown(text);
  }

  /** A big banner in the middle of the arena, e.g. banner('SHOWDOWN', 'danger'). kind: 'info' | 'danger' | 'good'. */
  banner(text, kind = 'info', ms) {
    this.game.showBanner(String(text), kind, ms);
    this.announce(String(text));
  }

  /** Card at the end of a round; showRoundEnd(null) hides it (showGame() does too). */
  showRoundEnd(msg, lobbyPlayers) {
    this.game.showRoundEnd(msg, lobbyPlayers);
  }

  showResults(msg) {
    if (!msg) return;
    this.game.end();
    this.game.showRoundEnd(null);
    this.results.render(msg);
    this.show('results');
  }

  // ---- Small feedback

  /** @param {string} text @param {'info'|'good'|'warn'|'error'} [kind] @param {{ms?:number, action?:{label:string,onClick:Function}}} [opts] */
  toast(text, kind = 'info', opts) {
    return this.toasts.show(String(text), kind, opts);
  }

  killfeed(text) {
    this.game.feedAdd(String(text), 'kill');
  }

  /** @param {{from?:number, name?:string, text:string, old?:boolean, sys?:boolean}} m `sys` (or a missing/negative `from`) makes a system line */
  addChat(m) {
    if (!m || typeof m.text !== 'string') return;
    const author = this.lobbyMsg?.players.find((p) => p.id === m.from);
    const line = { from: m.from ?? -1, name: String(m.name ?? author?.name ?? ''), text: m.text, old: !!m.old, sys: !!m.sys || !(m.from >= 0), color: author?.color ?? 0 };
    this.chatHistory.push(line);
    if (this.chatHistory.length > 100) this.chatHistory.shift();
    for (const chat of this.chatPanels) chat.render(line);
    if (!line.old && !line.sys && this.current === 'game') this.game.feedAdd(`${line.name}: ${line.text}`, 'chat');
  }

  /** Opens/closes the emote picker of the game HUD (also what the touch emote button and the T key should call). */
  toggleEmoteBar(force) {
    this.game.toggleEmotes(force);
  }

  // ---- Blocking overlays

  /**
   * "Connecting..." overlay with an elapsed-seconds counter after a few seconds; null hides it. It covers the whole page, and a free
   * host can take a minute to wake up, so `onCancel` (optional) adds a Cancel button: without one the only way out would be a reload.
   */
  showConnecting(text, onCancel) {
    if (text == null) {
      if (!this.connecting) return;
      clearInterval(this.timers.connecting);
      this.connecting.remove();
      this.connecting = null;
      this.block(-1);
      return;
    }
    if (!this.connecting) {
      const message = el('p', { class: 'conn-text' });
      const elapsed = el('p', { class: 'conn-time', hidden: true });
      const cancel = el('button', { class: 'btn btn-glass btn-lg', type: 'button', hidden: true, text: 'Cancel', on: { click: () => this.connecting?.onCancel?.() } });
      this.connecting = el('div', { class: 'conn-overlay', role: 'status' },
        el('div', { class: 'conn-card' }, artSvg('bomb', 'conn-bomb'), message, elapsed, cancel));
      this.connecting.message = message;
      this.connecting.elapsed = elapsed;
      this.connecting.cancel = cancel;
      const started = performance.now();
      this.timers.connecting = setInterval(() => {
        const s = Math.floor((performance.now() - started) / 1000);
        elapsed.hidden = s < 3;
        elapsed.textContent = `${s} s`;
      }, 1000);
      this.layers.conn.appendChild(this.connecting);
      this.block(1);
    }
    if (this.connecting.message.textContent !== text) this.connecting.message.textContent = text;
    const cancel = this.connecting.cancel;
    this.connecting.onCancel = typeof onCancel === 'function' ? onCancel : null;
    if (cancel.hidden === !!this.connecting.onCancel) {
      cancel.hidden = !this.connecting.onCancel;
      if (!cancel.hidden) cancel.focus({ preventScroll: true });     // a keyboard player must be able to get out
    }
  }

  /** Small banner while the connection is being re-established; the argument is the seconds left before giving up (null hides). */
  showReconnecting(secondsLeft) {
    if (secondsLeft === null || secondsLeft === undefined) {
      this.reconnecting?.remove();
      this.reconnecting = null;
      this.root.classList.remove('is-reconnecting');
      return;
    }
    if (!this.reconnecting) {
      this.reconnecting = el('div', { class: 'reconnect-bar' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { class: 'reconnect-text' }));
      this.layers.conn.appendChild(this.reconnecting);
      this.root.classList.add('is-reconnecting');
      this.announce('Connection lost. Reconnecting...');
    }
    const text = `Connection lost. Reconnecting${Number.isFinite(secondsLeft) ? ` (giving up in ${Math.max(0, Math.ceil(secondsLeft))} s)` : ''}...`;
    const target = this.reconnecting.lastChild;
    if (target.textContent !== text) target.textContent = text;
  }

  /**
   * A message box with buttons: "That party has ended", "Can't reach the server", kicked, paused ...
   * @param {{title:string, text?:string, tone?:'info'|'error'|'good', icon?:string, dismissible?:boolean,
   *   actions?:{label:string, kind?:'primary'|'glass'|'danger', onClick?:Function, keepOpen?:boolean}[]}} opts
   */
  showDialog(options) {
    const { title = '', text = '', tone = 'info', icon: iconName, dismissible = false, actions = [{ label: 'OK', kind: 'primary' }] } = options ?? {};
    this.hideDialog();
    const frame = dialogFrame({ title, cls: `modal-dialog tone-${tone}`, closable: false, icon: iconName ?? (tone === 'error' ? 'bomb' : tone === 'good' ? 'check' : 'help'), role: tone === 'error' ? 'alertdialog' : 'dialog' });
    if (text) frame.body.appendChild(el('p', { class: 'dialog-text', text }));
    const buttons = actions.map((a) => el('button', { class: `btn btn-${a.kind ?? 'glass'} btn-lg`, type: 'button', text: a.label, on: { click: () => {
      if (!a.keepOpen) this.hideDialog();
      a.onClick?.();
    } } }));
    frame.body.appendChild(el('div', { class: 'dialog-actions' }, buttons));
    this.dialog = this.modals.open(frame.node, { dismissible, focus: buttons[0], onClose: () => { this.dialog = null; } });
  }

  hideDialog() {
    if (this.dialog) this.modals.close(this.dialog);
  }


  // ---- P2P dialogs (single-file download)

  /** Marks the room as one that lives in a browser: 'host' | 'guest' | null. Call before the first lobby message. */
  setP2P(role) {
    this.p2p = role === 'host' || role === 'guest' ? role : null;
    if (this.lobbyMsg) this.lobby.render(this.lobbyMsg);
  }

  /**
   * "Add a friend" (host). Step 1: the invite code. Step 2: paste the friend's reply.
   * @param {{ onNewCode: (force: boolean) => Promise<string>, onReply: (text: string) => Promise<void>, onClose?: () => void }} ctl
   *   onNewCode / onReply may reject with an Error whose message is fit for the player.
   * @returns {{ setStatus: (kind: 'busy'|'good'|'error'|'info', text: string) => void, setBusy: (busy: boolean) => void, close: () => void }}
   */
  showAddFriend(ctl) {
    this.p2pDialog?.close();
    let out;
    let inp;
    let status;
    let connect;
    let fresh;
    let making = false;
    const newCode = async (force) => {
      if (making) return;                                        // (one code at a time: every extra click would leave another live invite behind)
      making = true;
      fresh.disabled = true;
      out.set('', 'Making your invite code...');
      status.set('busy', 'Making your invite code. This takes a few seconds.');
      inp.box.value = '';
      connect.disabled = true;
      try {
        const code = await ctl.onNewCode(force === true);
        out.set(code);
        status.set('', '');
        connect.disabled = false;
        if (document.activeElement !== inp.box) out.copy.focus({ preventScroll: true });     // (never pull focus out of the reply box the player is typing in)
      } catch (err) {
        out.set('', 'No code yet');
        status.set('error', err?.message || 'Could not make a code. Please try again.');
      } finally {
        making = false;
        fresh.disabled = false;
      }
    };
    const submit = async () => {
      const text = inp.box.value.trim();
      if (!text) {
        status.set('error', "Paste your friend's reply code first.");
        inp.box.focus();
        return;
      }
      connect.disabled = true;
      status.set('busy', 'Connecting to your friend...');
      try {
        await ctl.onReply(text);
      } catch (err) {
        status.set('error', err?.message || 'That code did not work.');
        connect.disabled = false;
        inp.box.focus();
      }
    };
    const handle = p2pModal(this, {
      title: 'Add a friend', iconName: 'users', ctl,
      build: (body, handle) => {
        out = codeOutput(this, { label: 'Your invite code', wrap: (code) => `Join my Blast Party game! Open your copy of blast-party.html (I can send you the file), tap "Join a friend's game" and paste this code:\n\n${code}` });
        inp = codeInput(this, { id: 'reply-input', label: "Your friend's reply code", placeholder: 'Paste the reply code here', onEnter: submit });
        status = statusLine();
        connect = el('button', { class: 'btn btn-green btn-lg', type: 'button', disabled: true, on: { click: submit } }, icon('check'), 'Connect');
        fresh = el('button', { class: 'btn btn-glass btn-sm', type: 'button', on: { click: () => newCode(true) } }, icon('refresh'), 'New code');
        const msg = this.lobbyMsg;
        const blocked = msg?.settings?.locked ? 'Your game is locked, so nobody new can join. Switch off "Lock room" in the lobby first.'
          : msg && msg.players.length >= MAX_PLAYERS ? 'Your game is full. Remove a bot or kick a player in the lobby first.' : '';
        body.append(
          el('p', { class: 'dialog-text', text: 'Two quick steps. Any chat app works: WhatsApp, iMessage, email, Discord... Your friend needs their own copy of the blast-party.html file too.' }),
          ...(blocked ? [el('p', { class: 'code-warn', role: 'note', text: blocked })] : []),
          step('1. Send this invite code to your friend', out.node, el('div', { class: 'p2p-more' }, fresh)),
          step('2. Paste the reply code they send back', inp.box, el('div', { class: 'code-actions' }, inp.paste, connect)),
          status.node,
          el('p', { class: 'field-hint', text: `${CODE_PRIVACY} One invite works for one friend; add more friends the same way.` }),
          el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-glass btn-lg', type: 'button', text: 'Close', on: { click: () => handle.dismiss() } })));
        newCode(false);
        return fresh;
      },
    });
    return Object.assign(handle, {
      setStatus: (kind, text) => status.set(kind, text),
      setBusy: (busy) => { connect.disabled = !!busy || !out.box.value; },
    });
  }

  /**
   * "Join a friend's game" (guest). Step 1: paste the host's invite. Step 2: send the reply back and wait.
   * @param {{ onInvite: (text: string) => Promise<{ code: string, host: string }>, onClose?: () => void }} ctl
   */
  showJoinFriend(ctl) {
    this.p2pDialog?.close();
    let status;
    let inp;
    let go;
    let stepOne;
    let stepTwo;
    let out;
    let again;
    let stepTitle;
    const submit = async () => {
      const text = inp.box.value.trim();
      if (!text) {
        status.set('error', "Paste your friend's invite code first.");
        inp.box.focus();
        return;
      }
      go.disabled = true;
      status.set('busy', 'Making your reply code. This takes a few seconds.');
      try {
        const { code, host } = await ctl.onInvite(text);
        stepOne.hidden = true;
        stepTwo.hidden = false;
        stepTitle.textContent = host ? `2. Send this reply code back to ${host}` : '2. Send this reply code back to the host';
        out.set(code);
        status.set('busy', `Waiting for ${host || 'the host'} to add you. Send them the reply code now.`);
        out.copy.focus({ preventScroll: true });
      } catch (err) {
        status.set('error', err?.message || 'That code did not work.');
        go.disabled = false;
        inp.box.focus();
      }
    };
    const handle = p2pModal(this, {
      title: "Join a friend's game", iconName: 'link', ctl,
      build: (body, h) => {
        inp = codeInput(this, { id: 'invite-input', label: "Your friend's invite code", placeholder: 'Paste the invite code here', onEnter: submit });
        out = codeOutput(this, { label: 'Your reply code', wrap: (code) => `Here is my Blast Party reply code. Paste it in "Add a friend":\n\n${code}` });
        status = statusLine();
        go = el('button', { class: 'btn btn-green btn-lg', type: 'button', on: { click: submit } }, icon('arrow'), 'Continue');
        stepTitle = el('h3', { class: 'p2p-step-title', text: '2. Send this reply code back' });
        again = el('button', { class: 'btn btn-glass btn-sm', type: 'button', on: { click: () => {
          stepOne.hidden = false;
          stepTwo.hidden = true;
          inp.box.value = '';
          go.disabled = false;
          status.set('', '');
          inp.box.focus();
        } } }, icon('refresh'), 'Start again');
        stepOne = step('1. Paste the invite code your friend sent you', inp.box, el('div', { class: 'code-actions' }, inp.paste, go));
        stepTwo = el('section', { class: 'p2p-step', hidden: true }, stepTitle, out.node, el('div', { class: 'p2p-more' }, again));
        body.append(
          el('p', { class: 'dialog-text', text: 'Ask the host to tap "Add a friend" and send you their invite code.' }),
          stepOne, stepTwo, status.node,
          el('p', { class: 'field-hint', text: CODE_PRIVACY }),
          el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-glass btn-lg', type: 'button', text: 'Cancel', on: { click: () => h.dismiss() } })));
        return inp.box;
      },
    });
    return Object.assign(handle, {
      setStatus: (kind, text) => status.set(kind, text),
      setBusy: () => {},
      /** The connection attempt is over: the reply code on show is dead, so it cannot be copied any more. */
      expireCode: () => { out.set('', 'This code is no longer valid'); },
    });
  }

  // ---- Settings shared by the title screen, lobby and menu

  /** Pushes audio/effects/controls state into the UI (main.js calls this once audio has loaded its saved values). */
  setSettings(s) {
    s ??= {};
    if (typeof s.volume === 'number') this.settings.volume = Math.min(1, Math.max(0, s.volume));
    if (typeof s.muted === 'boolean') this.settings.muted = s.muted;
    if (typeof s.reduce === 'boolean') {
      this.settings.reduce = s.reduce;
      this.applyEffects();
    }
    if (s.hand === 'left' || s.hand === 'right') {
      this.settings.hand = s.hand;
      this.applyHand();
    }
    this.game.paintMute();
    this.settingsModal?.refresh();
    this.menuModal?.refresh?.();
  }

  setMuted(muted) {
    this.settings.muted = !!muted;
    this.game.paintMute();
    this.settingsModal?.refresh();
    this.menuModal?.refresh?.();
    this.emit('onMute', this.settings.muted);
  }

  setVolume(v) {
    this.settings.volume = Math.min(1, Math.max(0, v));
    this.emit('onVolume', this.settings.volume);
  }

  setReduce(reduce) {
    this.settings.reduce = !!reduce;
    store.set('bp.reduce', reduce ? '1' : '0');
    this.applyEffects();
    this.emit('onToggleEffects', this.settings.reduce);
  }

  setHand(hand) {
    this.settings.hand = hand === 'left' ? 'left' : 'right';
    store.set('bp.hand', this.settings.hand);
    this.applyHand();
    this.emit('onControlsSide', this.settings.hand);
  }

  // ---- Modals

  get menuOpen() {
    return !!this.menuModal;
  }

  /** The in-room menu (resume, sound, help, leave). Also what Esc and the browser back gesture open. */
  showMenu(open = true, opener) {
    if (!open) {
      if (this.menuModal) this.modals.close(this.menuModal.entry);
      return;
    }
    if (this.menuModal) return;
    const inGame = this.current === 'game';
    const lobby = this.lobbyMsg;
    const isHost = !!lobby && lobby.you === lobby.hostId;
    const alone = this.p2p === 'host' && this.friendCount() === 0;
    const frame = dialogFrame({ title: 'Menu', cls: 'modal-menu', icon: 'menu', onClose: () => this.showMenu(false) });
    const sound = switchControl({ label: 'Sound', checked: !this.settings.muted, onToggle: (on) => this.setMuted(!on) });
    const resume = el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: () => this.showMenu(false) } }, icon('arrow'), inGame ? 'Back to the game' : 'Close');
    const items = [
      resume,
      sound.node,
      el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: (e) => this.showSettings(true, e.currentTarget) } }, icon('sliders'), 'Settings'),
      el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: (e) => this.showHowTo(true, e.currentTarget) } }, icon('help'), 'How to play'),
      fullscreenSupported() ? el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: toggleFullscreen } }, icon('fullscreen'), 'Full screen') : null,
      this.p2p === 'host' ? el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: () => { this.showMenu(false); this.emit('onAddFriend'); } } }, icon('plus'), 'Add a friend') : null,
      inGame && isHost && !lobby.local ? el('button', { class: 'btn btn-glass btn-lg', type: 'button', on: { click: () => { this.showMenu(false); this.emit('onBackToLobby'); } } }, icon('home'), alone ? 'End match' : 'End match for all') : null,
      el('button', { class: 'btn btn-danger btn-lg', type: 'button', on: { click: () => { this.showMenu(false); this.emit('onLeave'); } } }, icon('leave'), lobby?.local ? 'Leave practice' : this.p2p === 'host' ? (alone ? 'End the game' : 'End the game for everyone') : inGame ? 'Leave match' : 'Leave room'),
    ];
    if (inGame) frame.body.appendChild(el('p', { class: 'dialog-text', text: lobby?.local ? 'Practice keeps running while this menu is open.' : 'The game keeps running while this menu is open.' }));
    frame.body.appendChild(el('div', { class: 'menu-list' }, items));
    const entry = this.modals.open(frame.node, { opener, focus: resume, onClose: () => { this.menuModal = null; } });
    this.menuModal = { entry, refresh: () => sound.set(!this.settings.muted) };
  }

  showSettings(open = true, opener) {
    if (!open) {
      if (this.settingsModal) this.modals.close(this.settingsModal.entry);
      return;
    }
    if (this.settingsModal) return;
    const frame = dialogFrame({ title: 'Settings', cls: 'modal-settings', icon: 'sliders', onClose: () => this.showSettings(false) });
    const volume = el('input', { class: 'range', type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Volume', on: { input: (e) => { this.setVolume(e.currentTarget.value / 100); readout.textContent = `${e.currentTarget.value}%`; } } });
    const readout = el('output', { class: 'range-out' });
    const sound = switchControl({ label: 'Sound', hint: 'Effects and music', checked: !this.settings.muted, onToggle: (on) => this.setMuted(!on) });
    const reduce = switchControl({ label: 'Reduce effects', hint: 'Less shaking, flashing and confetti', checked: this.settings.reduce, onToggle: (on) => this.setReduce(on) });
    const hand = segmented({ label: 'Controls side', options: [{ value: 'right', label: 'Right-handed' }, { value: 'left', label: 'Left-handed' }], value: this.settings.hand, onPick: (h) => { this.setHand(h); hand.set(h); } });
    const fs = fullscreenSupported()
      ? el('button', { class: 'btn btn-glass', type: 'button', on: { click: toggleFullscreen } }, icon('fullscreen'), 'Toggle full screen')
      : el('p', { class: 'field-hint', text: 'Tap Share, then "Add to Home Screen" for full-screen play.' });
    frame.body.append(
      el('div', { class: 'setting-block' }, el('label', { class: 'setting-name' }, 'Volume'), el('div', { class: 'range-row' }, icon('volume'), volume, readout)),
      sound.node, reduce.node,
      el('div', { class: 'setting-block' }, el('span', { class: 'setting-name', text: 'Controls side' }), el('span', { class: 'setting-hint', text: 'Swaps the joystick and the BOMB button on touch screens' }), hand.node),
      el('div', { class: 'setting-block' }, fs),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: () => this.showSettings(false) } }, 'Done')));
    const refresh = () => {
      volume.value = String(Math.round(this.settings.volume * 100));
      readout.textContent = `${volume.value}%`;
      sound.set(!this.settings.muted);
      reduce.set(this.settings.reduce);
      hand.set(this.settings.hand);
    };
    refresh();
    const entry = this.modals.open(frame.node, { opener, focus: volume, onClose: () => { this.settingsModal = null; } });
    this.settingsModal = { entry, refresh };
  }

  showHowTo(open = true, opener) {
    if (!open) {
      if (this.howto) this.modals.close(this.howto);
      return;
    }
    if (this.howto) return;
    const frame = dialogFrame({ title: 'How to play', cls: 'modal-howto', icon: 'help', onClose: () => this.showHowTo(false) });
    frame.body.append(...howToSections());
    frame.body.appendChild(el('div', { class: 'dialog-actions' }, el('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: () => this.showHowTo(false) } }, 'Got it!')));
    this.howto = this.modals.open(frame.node, { opener, onClose: () => { this.howto = null; } });
  }
}


// ================================================================================================
// P2P dialogs (single-file download): "Add a friend" for the host, "Join a friend's game" for a guest
// ================================================================================================

const CODE_PRIVACY = 'Codes contain your network (IP) addresses, so only send them to people you trust.';

/** A status line under a form: kind 'busy' (spinner) | 'good' | 'error' | 'info'; an empty text hides it. */
function statusLine() {
  const spinner = el('span', { class: 'spinner', 'aria-hidden': 'true', hidden: true });
  const text = el('span', { class: 'p2p-status-text' });
  // (always in the page, only visually emptied: a live region that appears together with its text is not announced by screen readers)
  const node = el('p', { class: 'p2p-status is-empty', role: 'status', 'aria-live': 'polite' }, spinner, text);
  return {
    node,
    set(kind, message) {
      node.classList.toggle('is-empty', !message);
      node.dataset.kind = kind;
      spinner.hidden = kind !== 'busy';
      text.textContent = message || '';
      if (message && kind !== 'busy') node.scrollIntoView?.({ block: 'nearest' });     // a long dialog on a small phone: bring the answer into view
    },
  };
}

/** A read-only box showing a code, with Copy and Share buttons. `wrap(code)` is the friendly sentence Share puts around it. */
function codeOutput(ui, { label, wrap }) {
  const box = el('textarea', { class: 'text-input code-box', readonly: true, rows: '3', 'aria-label': label, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', on: { focus: (e) => e.currentTarget.select() } });
  const copyLabel = el('span', { text: 'Copy code' });
  let timer = 0;
  const copy = el('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: true, on: { click: async () => {
    const ok = await copyText(box.value);
    if (ok) {
      copyLabel.textContent = 'Copied!';
      clearTimeout(timer);
      timer = setTimeout(() => { copyLabel.textContent = 'Copy code'; }, 2200);
      ui.toast('Code copied. Now paste it into a chat.', 'good');
    } else {
      box.focus();
      box.select();
      ui.toast('Press Ctrl+C (Cmd+C on a Mac) to copy the code', 'info');
    }
  } } }, icon('copy'), copyLabel);
  const share = el('button', { class: 'btn btn-blue btn-lg', type: 'button', disabled: true, hidden: typeof navigator.share !== 'function', on: { click: () => {
    const result = navigator.share({ title: 'Blast Party', text: wrap(box.value) });
    result?.catch?.(() => {});
  } } }, icon('share'), 'Share');
  const node = el('div', { class: 'code-out' }, box, el('div', { class: 'code-actions' }, copy, share));
  return {
    node, box, copy,
    set(code, placeholder = '') {
      box.value = code || '';
      box.placeholder = placeholder;
      box.classList.toggle('is-busy', !code);
      copy.disabled = share.disabled = !code;
    },
  };
}

/** An editable box for a pasted code, with a Paste button where the browser allows reading the clipboard. */
function codeInput(ui, { id, label, placeholder, onEnter }) {
  const box = el('textarea', { id, class: 'text-input code-box', rows: '3', placeholder, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', 'aria-label': label });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter?.(); } });
  const canRead = typeof navigator.clipboard?.readText === 'function';
  const paste = el('button', { class: 'btn btn-glass', type: 'button', hidden: !canRead, on: { click: async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        box.value = text;
        box.dispatchEvent(new Event('input'));
        onEnter?.();
      } else ui.toast('Nothing to paste yet. Copy the code first.', 'info');
    } catch {
      box.focus();
      ui.toast('Press Ctrl+V (Cmd+V on a Mac) to paste', 'info');
    }
  } } }, icon('paste'), 'Paste');
  return { box, paste };
}

const step = (title, ...kids) => el('section', { class: 'p2p-step' }, el('h3', { class: 'p2p-step-title', text: title }), kids);

/** Shared frame of both dialogs. Returns the handle main.js keeps; `handle.close()` never calls `ctl.onClose` (only the player closing it does). */
function p2pModal(ui, { title, iconName, ctl, build }) {
  let entry;
  let done = false;
  const frame = dialogFrame({ title, cls: 'modal-p2p', icon: iconName, onClose: () => ui.modals.close(entry) });
  const handle = {
    /** Closes without telling `ctl.onClose` (the caller is the one closing it). */
    close() {
      done = true;
      if (entry) ui.modals.close(entry);
    },
    /** The player pressed Close / Cancel: same as the X button and Esc. */
    dismiss() {
      if (entry) ui.modals.close(entry);
    },
  };
  const focus = build(frame.body, handle);
  entry = ui.modals.open(frame.node, {
    focus,
    onClose: () => {
      if (ui.p2pDialog === handle) ui.p2pDialog = null;
      if (!done) {
        done = true;
        ctl.onClose?.();
      }
    },
  });
  ui.p2pDialog = handle;
  return handle;
}

// ================================================================================================
// How to play content
// ================================================================================================

const key = (label) => el('kbd', { class: 'key', text: label });
const keyRow = (keys, what) => el('div', { class: 'key-row' }, el('span', { class: 'key-set' }, keys), el('span', { class: 'key-what', text: what }));

const POWERUPS = [
  ['bomb', 'Extra bomb', 'Drop one more bomb at a time.'],
  ['flame', 'Fire', 'Your blasts reach one tile further.'],
  ['speed', 'Speed', 'Run faster.'],
  ['kick', 'Kick', 'Walk into a bomb to send it sliding.'],
  ['glove', 'Glove', 'Press the special button to throw a bomb three tiles away.'],
  ['shield', 'Shield', 'Blast-proof for 8 seconds.'],
  ['skull', 'Skull', 'A random curse for 10 seconds. Touch a friend to pass it on!'],
];
const CURSES = [
  ['slow', 'Slow', 'You crawl.'],
  ['rush', 'Rush', 'You run non-stop.'],
  ['reverse', 'Reverse', 'Left is right, up is down.'],
  ['nobomb', 'No bombs', 'Your hands are tied.'],
  ['spam', 'Bomb spam', 'Bombs drop all by themselves.'],
];

function howToSections() {
  const section = (title, ...kids) => el('section', { class: 'howto-section' }, el('h3', { text: title }), kids);
  const itemList = (rows) => el('ul', { class: 'howto-items' }, rows.map(([name, title, text]) => el('li', null, gameIcon(name, 2.2), el('span', null, el('b', { text: title }), ' ', text))));
  return [
    section('Goal', el('p', { text: 'Drop bombs, blow up blocks, grab power-ups and blast your rivals. The last blaster standing wins the round, and the first to win enough rounds takes the match. When the clock runs out, the walls start closing in!' })),
    section('Controls', el('div', { class: 'controls-grid' },
      el('div', { class: 'controls-card' }, el('h4', null, icon('menu'), 'Keyboard'),
        keyRow([key('\u2191'), key('\u2190'), key('\u2193'), key('\u2192'), ' or ', key('W'), key('A'), key('S'), key('D')], 'Move (French keyboard: Z Q S D)'),
        keyRow([key('Space'), ' or ', key('Enter')], 'Drop a bomb'),
        keyRow([key('E'), ' or ', key('Shift')], 'Special: throw a bomb (needs the glove)'),
        keyRow([key('1'), '\u2013', key('6'), ' or ', key('T')], 'Emotes'),
        keyRow([key('M'), key('Esc')], 'Mute sound, open the menu')),
      el('div', { class: 'controls-card' }, el('h4', null, icon('smile'), 'Touch'),
        el('p', { text: 'Slide your thumb on the left half of the screen to steer. Tap the big BOMB button. Grab a glove and the throw button appears.' }),
        el('p', { text: 'Prefer the other hand? Settings can swap the sides.' })),
      el('div', { class: 'controls-card' }, el('h4', null, icon('star'), 'Controller'),
        el('p', { text: 'Stick or D-pad to move, A or B to drop a bomb, X or Y for the special, Start for the menu.' }),
        isSecure() ? null : el('p', { class: 'howto-warn', text: 'Controllers need the https link (use npm run share) or localhost.' })))),
    section('Power-ups', itemList(POWERUPS)),
    section('Curses', itemList(CURSES)),
    section('Good to know',
      el('ul', { class: 'howto-tips' },
        el('li', { text: 'Flames hurt everyone, including you and your team, so run for cover.' }),
        el('li', { text: 'Bombs chain: a blast sets off every bomb it touches.' }),
        el('li', { text: 'No sound on iPhone? Turn off the silent switch.' }),
        el('li', { text: window.__BP_SINGLE__ === true ? 'The host can lock the game once everyone has joined.' : 'The host can lock the room once everyone has joined.' }))),
  ];
}

const isSecure = () => window.isSecureContext !== false || window.__BP_SINGLE__ === true;
