// UI gallery (developer tooling, not part of the game).
//
// Mounts client/js/ui.js with fake data for every screen and state and exposes them as named scenes:
//   window.gallery.names            scene names
//   await window.gallery.show(name) put the UI into a scene, draw a mock arena behind the HUD, wait for it to settle
//   window.gallery.lint()           layout problems of the current scene (overflow, clipped text, small tap targets, HUD overlaps)
// scripts/dev/ui/shots.mjs drives it with Playwright; it can also be opened by hand: http://localhost:PORT/__ui/gallery.html#scene=lobby-host
//
// Uses the real sprites.js to paint the arena when it is available (add ?nosprites to see the UI's stand-in art instead).

import { UI } from '/js/ui.js';

// Deterministic "randomness": names on the title screen and confetti must not change between runs.
let seed = 20240601;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

try {
  localStorage.clear();
} catch {
  // storage may be blocked; the gallery does not depend on it
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => new Promise((resolve) => { const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });

const calls = [];
const record = (name) => (...args) => calls.push([name, ...args]);
const ui = new UI(document.getElementById('app'), Object.fromEntries(
  ['onCreate', 'onJoin', 'onPractice', 'onProfile', 'onSettings', 'onAddBot', 'onRemoveBot', 'onKick', 'onStart', 'onChat', 'onEmote', 'onLeave', 'onBackToLobby', 'onMute', 'onVolume', 'onToggleEffects', 'onControlsSide'].map((n) => [n, record(n)])));

// ---- Fake data ---------------------------------------------------------------------------------------

const ROUND_GRID = '################...+.....+...##.#+#+#.#.#+#.##.+++.+...+++.##.#+#.#+#.#.#.##..++++++++...##.#.#+#+#+#.#.##..++.+.++.+..##.#+#+#+#+#.#.##..+.++.+.+++.##.#+#+#.#.#+#.##.............################';

const settings = (over = {}) => ({ rounds: 3, roundTime: 120, suddenDeath: true, mode: 'ffa', theme: 'random', layout: 'classic', blocks: 'normal', items: 'normal', locked: false, ...over });
const person = (id, name, color, over = {}) => ({ id, name, color, team: id % 2, isBot: false, level: null, connected: true, isHost: false, wins: 0, waiting: false, ...over });
const bot = (id, name, color, level = 'normal', over = {}) => person(id, name, color, { isBot: true, level, ...over });
const lobby = ({ you = 0, players, opts, phase = 'lobby', local = false, code = 'KQXZ' }) => {
  const hostId = players.find((p) => p.isHost)?.id ?? players[0].id;
  return { t: 'lobby', code, phase, hostId, you, ...(local ? { local: true } : {}), settings: settings(opts), players, round: { n: phase === 'lobby' ? 0 : 2, winsNeeded: (opts?.rounds ?? 3) } };
};

const trio = () => [person(0, 'Alex', 0, { isHost: true }), bot(1, 'Boomer', 1), person(2, 'Mom', 2)];
const eight = () => [
  person(0, 'Alex', 0, { isHost: true, wins: 2 }), person(1, 'Mom', 1, { wins: 1 }), person(2, 'Dad', 2), bot(3, 'Bolt', 3, 'easy'),
  bot(4, 'Fuse', 4, 'normal', { wins: 1 }), bot(5, 'Pixel', 5, 'hard'), person(6, 'Grandma Rosalind', 6, { connected: false }), person(7, '\u0645\u062d\u0645\u062f', 7),
];

const ROUND_PLAYERS = eight().map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team, isBot: p.isBot }));
const fighter = (p, over = {}) => ({ id: p.id, name: p.name, color: p.color, team: p.team, isBot: p.isBot, alive: true, wins: p.wins ?? 0, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0, curse: null, isMe: p.id === 0, connected: p.connected !== false, waiting: false, ...over });
const hudModel = (players, over = {}, per = {}) => ({ roundNo: 2, winsNeeded: 3, timeLeftSec: 83, suddenDeath: false, state: 'playing', mode: 'ffa', players: players.map((p) => fighter(p, per[p.id])), ...over });

const chatLines = [
  { from: 1, name: 'Mom', text: 'Ready when you are!' }, { from: 2, name: 'Dad', text: 'I am going to win this time' },
  { from: 0, name: 'Alex', text: 'Sure you are \u{1F602}' }, { from: 1, name: 'Mom', text: 'https://not-a-link.example is never turned into a link, even a very long one that keeps going and going' },
  { sys: true, text: 'Boomer made room for Grandma' },
];

const standings = (list) => list.map((s, i) => ({ id: s.id ?? i, name: s.name, color: s.color ?? i, team: i % 2, wins: 0, kills: 0, deaths: 0, selfKills: 0, blocks: 0, items: 0, place: i + 1, ...s }));

// ---- Mock arena (only so the HUD is judged over something that looks like the game) -----------------

let spritesModule = null;
try {
  if (!new URLSearchParams(location.search).has('nosprites')) spritesModule = await import('/js/sprites.js');
} catch {
  spritesModule = null;
}

let arenaRect = null;

function drawArena(theme = 'meadow') {
  const { wrap, canvas } = ui.getGameElements();
  const box = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  const g = canvas.getContext('2d');
  const tile = Math.max(8, Math.floor(Math.min(canvas.width / 15, canvas.height / 13)));
  const ox = Math.round((canvas.width - tile * 15) / 2);
  const oy = Math.round((canvas.height - tile * 13) / 2);
  arenaRect = { x: box.left + ox / dpr, y: box.top + oy / dpr, w: (tile * 15) / dpr, h: (tile * 13) / dpr, tile: tile / dpr };
  g.fillStyle = '#1d3b24';
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (!spritesModule) {
    g.fillStyle = '#3f8a45';
    g.fillRect(ox, oy, tile * 15, tile * 13);
    return;
  }
  const set = spritesModule.buildSpriteSet({ tile, theme, dpr });
  if (set.backdrop?.canvas) {
    g.fillStyle = g.createPattern(set.backdrop.canvas, 'repeat');
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  const at = (x, y) => [ox + x * tile, oy + y * tile];
  for (let ty = 0; ty < 13; ty++) for (let tx = 0; tx < 15; tx++) spritesModule.drawSprite(g, set.floorAt(tx, ty), ...at(tx, ty));
  for (let ty = 0; ty < 13; ty++) {
    for (let tx = 0; tx < 15; tx++) {
      const c = ROUND_GRID[ty * 15 + tx];
      const border = tx === 0 || ty === 0 || tx === 14 || ty === 12;
      if (c === '#') spritesModule.drawSprite(g, border ? set.borderAt(tx, ty) : set.hardWallAt(tx, ty), ...at(tx, ty));
      else if (c === '+') spritesModule.drawSprite(g, set.softBlockAt(tx, ty), ...at(tx, ty));
    }
  }
  for (const [i, [x, y]] of [[1.5, 1.5], [13.5, 11.5], [13.5, 1.5], [1.5, 11.5], [7.5, 1.5], [7.5, 11.5], [1.5, 6.5], [13.5, 6.5]].entries()) {
    spritesModule.drawSprite(g, set.character(i).idle[2], ...at(x, y));
  }
  set.dispose?.();
}

function fakeTouch() {
  const { touchRoot } = ui.getGameElements();
  if (touchRoot.querySelector('.fake-touch')) return;
  const node = document.createElement('div');
  node.className = 'fake-touch';
  node.innerHTML = '<div class="fake-joy"></div><div class="fake-bomb">BOMB</div>';
  touchRoot.appendChild(node);
}

// ---- Scenes ------------------------------------------------------------------------------------------

const click = (selector, scope = document) => scope.querySelector(selector)?.click();
const clickText = (text, scope = document) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))?.click();

function gameScene(players = eight(), over = {}, per = {}) {
  ui.showLobby(lobby({ players: eight(), phase: 'match' }));
  ui.showGame({ players: ROUND_PLAYERS.filter((p) => players.some((q) => q.id === p.id)) });
  ui.updateHud(hudModel(players, over, per));
}

const scenes = {
  'title': { run: () => { ui.showTitle({}); ui.title.nameInput.value = 'Captain Boom'; } },
  'title-invited': { run: () => ui.showTitle({ name: 'Alex', code: 'KQXZ' }) },
  'title-error': { run: () => ui.showTitle({ name: 'Alex', error: 'Room BCDF was not found. Check the code and try again.' }) },
  'title-howto': { run: () => { ui.showTitle({ name: 'Alex' }); ui.showHowTo(true); }, settle: 700 },
  'title-settings': { run: () => { ui.showTitle({ name: 'Alex' }); ui.setSettings({ volume: 0.6 }); ui.showSettings(true); }, settle: 700 },
  'connecting': { run: () => { ui.showTitle({ name: 'Alex' }); ui.showConnecting('Waking up the server... free hosting sleeps when nobody is playing. This can take up to a minute.'); }, settle: 3400 },
  'reconnecting': { run: () => { ui.showLobby(lobby({ players: trio() })); ui.showReconnecting(42); ui.toast('Nice! The link works', 'good'); }, settle: 700 },
  'dialog-ended': { run: () => { ui.showTitle({ name: 'Alex' }); ui.showDialog({ title: 'That party has ended', text: 'The server may have restarted. Rooms only live in memory, so start a new one.', tone: 'error', actions: [{ label: 'Create new room', kind: 'primary' }, { label: 'Home', kind: 'glass' }] }); }, settle: 700 },
  'toasts': { run: () => { ui.showLobby(lobby({ players: trio() })); ui.toast('Invite link copied!', 'good'); ui.toast('Ana already has Green', 'warn'); ui.toast('You were removed from the match', 'error'); ui.toast('A new version is available', 'info', { action: { label: 'Reload' } }); }, settle: 800 },

  'lobby-host': { run: () => { ui.showLobby(lobby({ players: trio() })); chatLines.forEach((m) => ui.addChat(m)); ui.setPing(38); } },
  'lobby-host-teams': { run: () => { ui.showLobby(lobby({ players: [person(0, 'Alex', 0, { isHost: true, team: 0 }), bot(1, 'Boomer', 1, 'normal', { team: 1 }), person(2, 'Mom', 2, { team: 0 }), person(3, 'Dad', 3, { team: 1, connected: false }), person(4, 'Pip', 4, { team: 1, waiting: true })], opts: { mode: 'teams', rounds: 5 } })); ui.setPing(120); } },
  'lobby-guest': { run: () => { ui.showLobby(lobby({ you: 2, players: trio() })); ui.setPing(210); } },
  'lobby-guest-rules': { run: () => { ui.showLobby(lobby({ you: 2, players: trio(), opts: { locked: true, roundTime: 0 } })); clickText('Game rules'); } },
  'lobby-full': { run: () => { ui.showLobby(lobby({ players: eight(), opts: { locked: true } })); chatLines.slice(0, 3).forEach((m) => ui.addChat(m)); ui.setPing(64); } },
  'lobby-practice': { run: () => { ui.showLobby(lobby({ players: [person(0, 'Alex', 0, { isHost: true }), bot(1, 'Bolt', 1, 'easy'), bot(2, 'Fuse', 2), bot(3, 'Pixel', 3)], local: true, code: 'LOCAL' })); ui.setPing(0); } },
  'lobby-blocked': { run: () => ui.showLobby(lobby({ players: [person(0, 'Alex', 0, { isHost: true })] })) },
  'lobby-qr': { run: () => { ui.showLobby(lobby({ players: trio() })); click('.qr-toggle'); }, settle: 900 },
  'lobby-kick': { run: () => { ui.showLobby(lobby({ players: trio() })); click('[aria-label="Kick Mom"]'); } },

  'game-3': { run: () => { gameScene(trio(), {}, { 0: { bombsMax: 2, range: 3 } }); ui.showCountdown(null); }, settle: 600 },
  'game-countdown': { run: () => { gameScene(eight(), { state: 'countdown', timeLeftSec: 120 }); ui.showCountdown('3'); }, settle: 350 },
  'game-go': { run: () => { gameScene(eight(), { state: 'playing', timeLeftSec: 120 }); ui.showCountdown('GO!'); }, settle: 300 },
  'game-playing': { run: () => {
    gameScene(eight(), {}, {
      0: { bombsMax: 3, range: 4, speedLv: 2, kick: true, glove: true, shield: 300, curse: 'reverse' }, 1: { alive: false }, 2: { shield: 200 },
      3: { curse: 'spam' }, 4: { bombsMax: 2, range: 3 }, 5: { alive: false }, 6: { connected: false, waiting: true },
    });
    ui.killfeed('Dad blasted Mom');
    ui.killfeed('Pixel blew themself up');
    ui.killfeed('Grandma Rosalind left');
  }, settle: 800 },
  'game-lowtime': { run: () => gameScene(trio(), { timeLeftSec: 7 }, { 0: { shield: 65535 } }) },
  'game-sudden': { run: () => { gameScene(eight().slice(0, 4), { suddenDeath: true, timeLeftSec: 0 }, { 0: { curse: 'slow' } }); }, settle: 900 },
  'game-showdown': { run: () => { gameScene(eight().slice(0, 4), { timeLeftSec: 15 }); ui.banner('Showdown in 15', 'danger'); }, settle: 800 },
  'game-dead': { run: () => gameScene(eight().slice(0, 5), {}, { 0: { alive: false } }) },
  'game-teams': { run: () => {
    const players = [person(0, 'Alex', 0, { team: 0, wins: 1 }), person(1, 'Mom', 1, { team: 1, wins: 1 }), person(2, 'Dad', 2, { team: 0, wins: 1 }), bot(3, 'Bolt', 3, 'normal', { team: 1, wins: 1 })];
    gameScene(players, { mode: 'teams' });
  } },
  'game-emotes': { run: () => { gameScene(eight().slice(0, 4)); ui.toggleEmoteBar(true); }, settle: 700 },
  'game-menu': { run: () => { gameScene(eight().slice(0, 4)); ui.showMenu(true); }, settle: 700 },
  'game-chat-toast': { run: () => { gameScene(eight().slice(0, 4)); ui.addChat({ from: 1, name: 'Mom', text: 'Watch out behind you!' }); ui.toast('Rate limited: slow down', 'warn'); }, settle: 700 },

  'roundend-win': { run: () => { gameScene(eight().slice(0, 4)); ui.showRoundEnd({ n: 2, winnerId: 2, winnerTeam: null, draw: false, reason: 'last', scores: [{ id: 0, wins: 2, team: 0 }, { id: 1, wins: 0, team: 1 }, { id: 2, wins: 2, team: 0 }, { id: 3, wins: 1, team: 1 }], matchOver: false }, eight().slice(0, 4)); }, settle: 1300 },
  'roundend-you': { run: () => { gameScene(eight()); ui.showRoundEnd({ n: 3, winnerId: 0, winnerTeam: null, draw: false, reason: 'last', scores: eight().map((p) => ({ id: p.id, wins: p.wins, team: p.team })), matchOver: true }, eight()); }, settle: 1300 },
  'roundend-draw': { run: () => { gameScene(eight().slice(0, 3)); ui.showRoundEnd({ n: 2, winnerId: null, winnerTeam: null, draw: true, reason: 'wipe', scores: [{ id: 0, wins: 1, team: 0 }, { id: 1, wins: 1, team: 1 }, { id: 2, wins: 0, team: 0 }], matchOver: false }, eight().slice(0, 3)); }, settle: 1000 },
  'roundend-team': { run: () => {
    const players = [person(0, 'Alex', 0, { team: 0 }), person(1, 'Mom', 1, { team: 1 }), person(2, 'Dad', 2, { team: 0 }), bot(3, 'Bolt', 3, 'normal', { team: 1 })];
    ui.showLobby(lobby({ players, phase: 'match', opts: { mode: 'teams' } }));
    gameScene(players, { mode: 'teams' });
    ui.showRoundEnd({ n: 2, winnerId: null, winnerTeam: 0, draw: false, reason: 'last', scores: players.map((p) => ({ id: p.id, wins: p.team === 0 ? 2 : 1, team: p.team })), matchOver: false }, players);
  }, settle: 1300 },

  'results-podium': { run: () => {
    ui.showLobby(lobby({ players: eight().slice(0, 5), phase: 'results' }));
    ui.showResults({ winnerId: 2, winnerTeam: null, reason: 'wins', standings: standings([
      { id: 2, name: 'Dad', color: 2, wins: 3, kills: 7, deaths: 2, selfKills: 0, blocks: 21, items: 9 },
      { id: 0, name: 'Alex', color: 0, wins: 2, kills: 5, deaths: 3, selfKills: 2, blocks: 14, items: 6 },
      { id: 4, name: 'Fuse', color: 4, wins: 1, kills: 3, deaths: 3, selfKills: 0, blocks: 9, items: 4 },
      { id: 1, name: 'Mom', color: 1, wins: 0, kills: 1, deaths: 4, selfKills: 3, blocks: 30, items: 3 },
      { id: 3, name: 'Bolt', color: 3, wins: 0, kills: 0, deaths: 5, selfKills: 1, blocks: 4, items: 1 },
    ]) });
  }, settle: 1800 },
  'results-you': { run: () => {
    ui.showLobby(lobby({ players: trio(), phase: 'results' }));
    ui.showResults({ winnerId: 0, winnerTeam: null, reason: 'wins', standings: standings([
      { id: 0, name: 'Alex', color: 0, wins: 3, kills: 6, deaths: 1, selfKills: 0, blocks: 18, items: 5 },
      { id: 2, name: 'Mom', color: 2, wins: 1, kills: 2, deaths: 3, selfKills: 1, blocks: 11, items: 5 },
      { id: 1, name: 'Boomer', color: 1, wins: 0, kills: 1, deaths: 3, selfKills: 0, blocks: 2, items: 0 },
    ]) });
  }, settle: 1800 },
  'results-guest-joint': { run: () => {
    ui.showLobby(lobby({ you: 2, players: eight().slice(0, 6), phase: 'results' }));
    ui.showResults({ winnerId: null, winnerTeam: null, reason: 'cap', standings: standings([
      { id: 0, name: 'Alex', color: 0, wins: 2, kills: 4, deaths: 3, place: 1 }, { id: 1, name: 'Mom', color: 1, wins: 2, kills: 4, deaths: 3, place: 1 },
      { id: 2, name: 'Dad', color: 2, wins: 1, kills: 2, deaths: 4, place: 3 }, { id: 3, name: 'Bolt', color: 3, wins: 1, kills: 2, deaths: 4, place: 3 },
      { id: 4, name: 'Fuse', color: 4, wins: 0, kills: 0, deaths: 5, place: 5 }, { id: 5, name: 'Pixel', color: 5, wins: 0, kills: 0, deaths: 5, place: 5 },
    ]) });
  }, settle: 1800 },
  'results-team': { run: () => {
    const players = [person(0, 'Alex', 0, { team: 0, isHost: true }), person(1, 'Mom', 1, { team: 1 }), person(2, 'Dad', 2, { team: 0 }), bot(3, 'Bolt', 3, 'normal', { team: 1 })];
    ui.showLobby(lobby({ players, phase: 'results', opts: { mode: 'teams' } }));
    ui.showResults({ winnerId: null, winnerTeam: 1, reason: 'wins', standings: standings([
      { id: 1, name: 'Mom', color: 1, team: 1, wins: 3, kills: 4, deaths: 1, blocks: 12, items: 3 }, { id: 3, name: 'Bolt', color: 3, team: 1, wins: 3, kills: 3, deaths: 2, blocks: 5, items: 6 },
      { id: 0, name: 'Alex', color: 0, team: 0, wins: 1, kills: 1, deaths: 3, selfKills: 1, blocks: 9, items: 2 }, { id: 2, name: 'Dad', color: 2, team: 0, wins: 1, kills: 1, deaths: 3, blocks: 4, items: 2 },
    ]) });
  }, settle: 1800 },
  'results-notenough': { run: () => {
    ui.showLobby(lobby({ players: [person(0, 'Alex', 0, { isHost: true })], phase: 'results' }));
    ui.showResults({ winnerId: null, winnerTeam: null, reason: 'not_enough_players', standings: standings([{ id: 0, name: 'Alex', color: 0, wins: 1, place: 1 }]) });
  }, settle: 1200 },
};

// ---- Layout lint -------------------------------------------------------------------------------------

const rectOf = (n) => n.getBoundingClientRect();
const visible = (n) => {
  const r = rectOf(n);
  if (r.width < 1 || r.height < 1) return false;
  for (let e = n; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
  }
  return true;
};
const describe = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}${n.textContent && n.children.length < 3 ? ` "${n.textContent.trim().slice(0, 24)}"` : ''}`;
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

function lint() {
  const issues = [];
  const push = (kind, node, extra = '') => issues.push(`${kind}: ${describe(node)}${extra ? ` ${extra}` : ''}`);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const screen = [...document.querySelectorAll('.screen')].find((s) => !s.hidden);
  const modal = document.querySelector('.modal');
  const scope = modal ?? screen;
  if (document.documentElement.scrollWidth > W + 1) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${W})`);
  if (screen && screen.scrollWidth > screen.clientWidth + 1) issues.push(`screen scrolls horizontally (${screen.scrollWidth} > ${screen.clientWidth})`);
  const isGame = screen?.id === 'game';

  for (const n of scope?.querySelectorAll('*') ?? []) {
    if (!visible(n) || n.closest('.confetti, .backdrop, canvas, .fake-touch, svg, .sr-only')) continue;
    const r = rectOf(n);
    const s = getComputedStyle(n);
    const inScroller = (() => { for (let e = n.parentElement; e && e !== scope.parentElement; e = e.parentElement) { const o = getComputedStyle(e); if (/(auto|scroll)/.test(o.overflowY) && e !== document.body) return e; } return null; })();
    const clipped = (() => { for (let e = n.parentElement; e && e !== document.body; e = e.parentElement) { if (/(hidden|clip)/.test(getComputedStyle(e).overflowX)) { const c = rectOf(e); if (r.left >= c.right - 1 || r.right <= c.left + 1) return true; } } return false; })();
    if (!clipped && (r.right > W + 1 || r.left < -1)) push('outside viewport (x)', n, `[${Math.round(r.left)}..${Math.round(r.right)}]`);
    if (isGame && !modal && (r.bottom > H + 1 || r.top < -1) && !n.closest('.hud-layer')) push('outside viewport (y)', n, `[${Math.round(r.top)}..${Math.round(r.bottom)}]`);
    if (!inScroller && !isGame && (r.bottom > H + 1) && !n.closest('.actionbar')) { /* whole screen scrolls: fine */ }
    // Text that does not fit its box
    if (n.children.length === 0 && n.textContent.trim() && s.textOverflow !== 'ellipsis' && n.scrollWidth > n.clientWidth + 2 && n.clientWidth > 0 && !['inline'].includes(s.display)) push('text overflows its box', n, `(${n.scrollWidth} > ${n.clientWidth})`);
    if (s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && n.scrollHeight > n.clientHeight + 2 && n.clientHeight > 0 && !n.matches('.hud-layer, .roundend, .confetti, .hud-me, #stage, .screen-game')) push('content clipped', n, `(${n.scrollHeight} > ${n.clientHeight})`);
    // Tap targets (spec: at least 48 css px)
    if (n.matches('button, [role="radio"], [role="switch"], a[href], input:not([type="hidden"]), select') && !n.closest('.fake-touch')) {
      if (r.width < 47 || r.height < 47) push('small tap target', n, `${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  if (isGame) {
    const pieces = [...document.querySelectorAll('.chip, .hud-tl, .hud-tr, .hud-center, .hud-me, .hud-feed')].filter(visible);
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        if (pieces[i].contains(pieces[j]) || pieces[j].contains(pieces[i])) continue;
        if (overlap(rectOf(pieces[i]), rectOf(pieces[j])) > 4) push('HUD pieces overlap', pieces[i], `<-> ${describe(pieces[j])}`);
      }
    }
    if (arenaRect) {
      const t = arenaRect.tile;
      const inner = { left: arenaRect.x + t * 1.02, right: arenaRect.x + arenaRect.w - t * 1.02, top: arenaRect.y + t * 1.02, bottom: arenaRect.y + arenaRect.h - t * 1.02 };
      for (const n of document.querySelectorAll('.chip, .hud-me, .hud-tl, .hud-tr, .hud-center, .hud-timer, .hud-sd')) {
        if (!visible(n) || n.contains(document.querySelector('.hud-timer')) && n.matches('.hud-center')) continue;
        const area = overlap(rectOf(n), inner);
        if (area > 6) push('HUD covers the play field', n, `(${Math.round(area)} px2)`);
      }
      const bomb = document.querySelector('.fake-bomb');
      if (bomb && visible(bomb)) {
        const centre = { left: arenaRect.x + arenaRect.w * 0.2, right: arenaRect.x + arenaRect.w * 0.8, top: arenaRect.y, bottom: arenaRect.y + arenaRect.h };
        if (overlap(rectOf(bomb), centre) > 4) push('touch control over the centre 60% of the play field', bomb);
      }
    }
  }
  return issues;
}

// ---- Public handle -------------------------------------------------------------------------------------

function reset() {
  ui.modals.closeAll();
  ui.hideDialog();
  ui.showConnecting(null);
  ui.showReconnecting(null);
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  ui.toggleEmoteBar(false);
  ui.setPing(null);
  calls.length = 0;
}

window.gallery = {
  names: Object.keys(scenes),
  calls,
  ui,
  async show(name) {
    const scene = scenes[name];
    if (!scene) throw new Error(`unknown scene ${name}`);
    await ui.ready;
    reset();
    ui.showTitle({ name: 'Alex' });
    scene.run();
    await frames(3);
    if (ui.current === 'game') {
      fakeTouch();
      drawArena(['meadow', 'frost', 'lava', 'candy', 'night'][name.length % 5]);
    }
    await sleep(scene.settle ?? 1100);
    return ui.current;
  },
  lint,
};

const initial = new URLSearchParams(location.hash.slice(1)).get('scene');
if (initial) window.gallery.show(initial);
document.documentElement.dataset.galleryReady = '1';
