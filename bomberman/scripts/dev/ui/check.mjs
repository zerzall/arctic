// UI behaviour checker (developer tooling, not part of the game or of `npm test`).
//
//   node scripts/dev/ui/check.mjs
//
// Drives ui.js through the gallery page in headless Chromium and asserts what screenshots cannot show: that every control fires
// the right callback with the right data, that dialogs trap focus and give it back, that hostile names cannot inject markup,
// that keyboard operation works, and that the accessibility contract of SPEC 8.3 holds (one h1 per screen, named controls,
// radio groups, live regions). Prints one line per failure and exits 1 when anything failed.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../../specs/helpers/pw.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob: data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";   // SPEC 7, verbatim: the UI must run under it
const MOUNTS = [['/__ui/', here], ['/shared/', path.join(repo, 'shared')], ['/', path.join(repo, 'client')]];

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const [prefix, dir] = MOUNTS.find(([p]) => pathname.startsWith(p));
  try {
    const body = await fs.readFile(path.join(dir, pathname.slice(prefix.length)));
    res.writeHead(200, { 'content-type': MIME[path.extname(pathname)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const { browser, reason } = await launchChromium();
if (!browser) {
  console.log(`SKIP: ${reason}`);
  server.close();
  process.exit(0);
}

let passed = 0;
let failed = 0;
const check = (cond, message) => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL ${message}`);
  }
};
const same = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), `${message}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => {
    // A share sheet stand-in that records whether it was called inside the click.
    window.__shared = [];
    navigator.share = (data) => { window.__shared.push({ data, inClick: !!navigator.userActivation?.isActive }); return Promise.resolve(); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/__ui/gallery.html`);
  await page.waitForFunction(() => document.documentElement.dataset.galleryReady === '1');

  const calls = () => page.evaluate(() => window.gallery.calls.map((c) => [...c]));
  const clear = () => page.evaluate(() => { window.gallery.calls.length = 0; });
  const scene = (name) => page.evaluate((n) => window.gallery.show(n), name);
  const last = async (name) => (await calls()).filter((c) => c[0] === name).at(-1);
  const count = async (name) => (await calls()).filter((c) => c[0] === name).length;
  const visibleText = (selector) => page.locator(selector).first().innerText();

  // ---- Pure helpers ------------------------------------------------------------------------------------
  const helpers = await page.evaluate(async () => {
    const m = await import('/js/ui.js');
    return {
      link: m.extractRoomCode('https://party.example/r/kqxz'), plain: m.extractRoomCode(' kqxz '), vowels: m.extractRoomCode('abcd'), web: m.extractRoomCode('https://example.com/'),
      clock: [m.formatClock(0), m.formatClock(83), m.formatClock(120), m.formatClock(null)],
      awards: m.computeAwards([{ id: 1, name: 'A', blocks: 5, kills: 2, items: 0, deaths: 1, selfKills: 0 }, { id: 2, name: 'B', blocks: 5, kills: 1, items: 0, deaths: 2, selfKills: 3 }]).map((a) => [a.stat, a.player.id, a.value]),
      blocker: [m.startBlocker({ players: [{}], settings: {} }), m.startBlocker({ players: [{ team: 0 }, { team: 0 }], settings: { mode: 'teams' } }), m.startBlocker({ players: [{ team: 0 }, { team: 1 }], settings: { mode: 'teams' } })],
      teamPodium: m.podiumGroups([{ team: 0, wins: 1, name: 'a' }, { team: 1, wins: 3, name: 'b' }, { team: 1, wins: 3, name: 'c' }], { byTeam: true }).map((g) => [g.place, g.people.length]),
      sharedPodium: m.podiumGroups([{ place: 1, name: 'a' }, { place: 1, name: 'b' }, { place: 3, name: 'c' }]).map((g) => [g.place, g.people.length]),
      ping: [m.pingQuality(20), m.pingQuality(120), m.pingQuality(400), m.pingQuality(null)],
    };
  });
  same(helpers.link, 'KQXZ', 'code from an invite link');
  same(helpers.plain, 'KQXZ', 'code from padded text');
  same(helpers.vowels, 'BCD', 'vowels are dropped from codes');
  same(helpers.web, '', 'a foreign web address yields no code');
  same(helpers.clock, ['0:00', '1:23', '2:00', '∞'], 'formatClock');
  same(helpers.awards, [['blocks', 0, 0]].slice(1).concat([['kills', 1, 2], ['deaths', 1, 1], ['selfKills', 2, 3]]), 'awards need a single best holder');
  same(helpers.blocker.map((b) => !!b), [true, true, false], 'start blockers');
  same(helpers.teamPodium, [[1, 2], [2, 1]], 'team podium groups whole teams');
  same(helpers.sharedPodium, [[1, 2], [3, 1]], 'joint places share a podium step');
  same(helpers.ping, ['good', 'ok', 'bad', 'none'], 'ping quality');

  // ---- Title -------------------------------------------------------------------------------------------
  await scene('title');
  check((await page.inputValue('#name-input')).length > 0, 'title: a friendly default name is pre-filled');
  await page.fill('#name-input', '  Zed  ');
  await clear();
  await page.click('text=Create room');
  same(await last('onCreate'), ['onCreate', 'Zed'], 'title: create sends the trimmed name');
  check((await page.evaluate(() => localStorage.getItem('bp.name'))) === 'Zed', 'title: the name is remembered');
  await page.fill('#name-input', '');
  await clear();
  await page.click('text=Create room');
  check((await last('onCreate'))?.[1]?.length > 0 && (await page.inputValue('#name-input')).length > 0, 'title: an empty name is replaced by a default');
  await page.fill('#name-input', 'Zed');
  await page.fill('#code-input', 'https://party.example/r/kqxz');
  same(await page.inputValue('#code-input'), 'KQXZ', 'title: pasted invite link becomes the code');
  await clear();
  await page.keyboard.press('Enter');
  same(await last('onJoin'), ['onJoin', 'KQXZ', 'Zed'], 'title: Enter in the code box joins');
  await page.fill('#code-input', 'ab');
  await clear();
  await page.click('.join-box .btn');
  check((await count('onJoin')) === 0, 'title: an incomplete code does not join');
  check(await page.locator('.form-error').isVisible(), 'title: an incomplete code shows an error');
  await clear();
  await page.click('text=Practice vs bots');
  same(await last('onPractice'), ['onPractice', 'Zed'], 'title: practice');
  await page.evaluate(() => window.gallery.ui.showTitle({ name: 'Zed', error: '<img src=x onerror=window.__pwned=1>' }));
  check(await page.evaluate(() => !window.__pwned && !document.querySelector('.form-error img')), 'title: an error message is text, never markup');
  await page.evaluate(() => window.gallery.ui.showTitle({ name: 'Zed', code: 'KQXZ' }));
  check(await page.locator('.title-card.is-invited').count() === 1 && (await page.inputValue('#code-input')) === 'KQXZ', 'title: an invite pre-fills and highlights the join box');
  await page.evaluate(() => window.gallery.ui.showTitle({ name: 'Zed', code: '"><script>x' }));
  check(await page.locator('.title-card.is-invited').count() === 0, 'title: an invalid code from the URL is ignored');

  // ---- Dialog focus handling ---------------------------------------------------------------------------
  await scene('title');
  await page.focus('.title-cog');
  await page.keyboard.press('Enter');
  check(await page.locator('.modal[role="dialog"][aria-modal="true"]').count() === 1, 'settings: opens a labelled modal dialog');
  check(await page.evaluate(() => !!document.querySelector('.modal').contains(document.activeElement)), 'settings: focus moves into the dialog');
  check(await page.evaluate(() => document.getElementById('screen-title').inert), 'settings: the page behind is inert');
  let escaped = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    if (!(await page.evaluate(() => document.querySelector('.modal')?.contains(document.activeElement)))) escaped++;
  }
  check(escaped === 0, 'settings: Tab never leaves the dialog');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(() => document.querySelector('.modal')?.contains(document.activeElement)), 'settings: Shift+Tab stays inside too');
  await clear();
  await page.locator('.range').focus();
  await page.keyboard.press('ArrowLeft');
  check((await count('onVolume')) > 0, 'settings: the volume slider reports changes');
  await page.locator('.modal .switch').nth(1).click();
  same(await last('onToggleEffects'), ['onToggleEffects', true], 'settings: reduce effects');
  check(await page.evaluate(() => document.documentElement.classList.contains('reduce-fx')), 'settings: reduce effects applies at once');
  await page.locator('.modal .seg-btn', { hasText: 'Left-handed' }).click();
  same(await last('onControlsSide'), ['onControlsSide', 'left'], 'settings: controls side');
  await page.keyboard.press('Escape');
  check(await page.locator('.modal').count() === 0, 'settings: Esc closes the dialog');
  check(await page.evaluate(() => document.activeElement?.classList.contains('title-cog')), 'settings: focus returns to the opener');
  check(await page.evaluate(() => !document.getElementById('screen-title').inert), 'settings: the page is live again');
  await page.evaluate(() => window.gallery.ui.setReduce(false));

  // ---- Lobby: host ---------------------------------------------------------------------------------------
  await scene('lobby-host');
  const rule = (group, text) => page.locator(`[role="radiogroup"][aria-label="${group}"] .seg-btn`, { hasText: text }).first();
  await clear();
  await rule('Mode', 'Teams').click();
  same(await last('onSettings'), ['onSettings', { mode: 'teams' }], 'lobby: mode patch');
  await rule('Wins needed to take the match', '5').click();
  same(await last('onSettings'), ['onSettings', { rounds: 5 }], 'lobby: rounds patch');
  await rule('Round time', '1:00').click();
  same(await last('onSettings'), ['onSettings', { roundTime: 60 }], 'lobby: round time patch');
  await rule('Arena theme', 'Lava').click();
  same(await last('onSettings'), ['onSettings', { theme: 'lava' }], 'lobby: theme patch');
  await rule('Arena layout', 'Open').click();
  same(await last('onSettings'), ['onSettings', { layout: 'open' }], 'lobby: layout patch');
  await rule('Amount of blocks', 'Many').click();
  same(await last('onSettings'), ['onSettings', { blocks: 'many' }], 'lobby: blocks patch');
  await rule('Amount of power-ups', 'None').click();
  same(await last('onSettings'), ['onSettings', { items: 'none' }], 'lobby: items patch');
  await page.locator('.setting-suddenDeath .switch').click();
  same(await last('onSettings'), ['onSettings', { suddenDeath: false }], 'lobby: sudden death toggle');
  await page.locator('.setting-locked .switch').click();
  same(await last('onSettings'), ['onSettings', { locked: true }], 'lobby: lock toggle');
  await rule('Mode', 'Free-for-all').focus();
  await clear();
  await page.keyboard.press('ArrowRight');
  same(await last('onSettings'), ['onSettings', { mode: 'teams' }], 'lobby: arrow keys move through a radio group');

  await clear();
  await page.click('.addbot .bot-hard');
  same(await last('onAddBot'), ['onAddBot', 'hard'], 'lobby: add bot');
  await page.click('[aria-label="Remove bot Boomer"]');
  same(await last('onRemoveBot'), ['onRemoveBot', 1], 'lobby: remove bot');
  await page.click('[aria-label="Kick Mom"]');
  check(await page.locator('[aria-label="Kick Mom out of the room"]').count() === 1, 'lobby: kick asks first');
  check((await count('onKick')) === 0, 'lobby: nobody is kicked by the first click');
  await page.click('text=Keep');
  check(await page.locator('[aria-label="Kick Mom"]').count() === 1, 'lobby: keep cancels the kick');
  await page.click('[aria-label="Kick Mom"]');
  await page.click('[aria-label="Kick Mom out of the room"]');
  same(await last('onKick'), ['onKick', 2], 'lobby: confirmed kick');

  await clear();
  await page.evaluate(() => window.gallery.ui.showLobby({ t: 'lobby', code: 'KQXZ', phase: 'lobby', hostId: 0, you: 0, settings: { rounds: 3, roundTime: 120, suddenDeath: true, mode: 'ffa', theme: 'random', layout: 'classic', blocks: 'normal', items: 'normal', locked: false }, players: [{ id: 0, name: 'Alex', color: 0, team: 0, isBot: false, level: null, connected: true, isHost: true, wins: 0, waiting: false }, { id: 1, name: 'Bea', color: 1, team: 1, isBot: false, level: null, connected: true, isHost: false, wins: 0, waiting: false }], round: { n: 0, winsNeeded: 3 } }));
  await page.locator('.swatch[aria-label="Green - sprout"]').click();
  same(await last('onProfile'), ['onProfile', { color: 2 }], 'lobby: pick a free colour');
  await clear();
  await page.locator('.swatch[aria-label="Blue - propeller"]').click({ force: true });
  check((await count('onProfile')) === 0 && await page.locator('.toast', { hasText: 'Bea already has Blue' }).count() === 1, 'lobby: a taken colour explains itself and sends nothing');
  check(await page.locator('.swatch[aria-label="Blue - propeller"]').getAttribute('aria-disabled') === 'true', 'lobby: taken colours are aria-disabled');
  check(await page.locator('.swatch[aria-checked="true"]').count() === 1, 'lobby: exactly one colour is checked');
  await page.fill('#my-name', 'Alexander');
  await page.keyboard.press('Enter');
  same(await last('onProfile'), ['onProfile', { name: 'Alexander' }], 'lobby: rename with Enter');

  await clear();
  await page.evaluate(() => window.gallery.ui.showLobby({ t: 'lobby', code: 'KQXZ', phase: 'lobby', hostId: 0, you: 0, settings: { rounds: 3, roundTime: 120, suddenDeath: true, mode: 'ffa', theme: 'random', layout: 'classic', blocks: 'normal', items: 'normal', locked: false }, players: [{ id: 0, name: 'Alex', color: 0, team: 0, isBot: false, level: null, connected: true, isHost: true, wins: 0, waiting: false }], round: { n: 0, winsNeeded: 3 } }));
  await page.click('#screen-lobby .actionbar .btn-green', { force: true });
  check((await count('onStart')) === 0, 'lobby: start is refused with a single player');
  check((await visibleText('#start-note')).includes('at least 2'), 'lobby: the reason is shown');
  check(await page.locator('#screen-lobby .actionbar .btn-green').getAttribute('aria-disabled') === 'true', 'lobby: the start button says it is disabled');
  await scene('lobby-host');
  await clear();
  await page.click('#screen-lobby .actionbar .btn-green');
  check((await count('onStart')) === 1, 'lobby: start fires when allowed');

  // chat and copy/share
  await page.fill('.lobby-col .chat-input', '<b>hello</b> friends');
  await page.keyboard.press('Enter');
  same(await last('onChat'), ['onChat', '<b>hello</b> friends'], 'lobby: chat');
  check((await page.inputValue('.lobby-col .chat-input')) === '', 'lobby: chat box empties after sending');
  await page.evaluate(() => window.gallery.ui.addChat({ from: 1, name: '<i>Mom</i>', text: '<img src=x onerror=window.__pwned=2> https://evil.example' }));
  check(await page.evaluate(() => !window.__pwned && !document.querySelector('.chat-log img, .chat-log i, .chat-log a')), 'lobby: chat text and names are text, never markup or links');
  await page.click('text=Copy invite link');
  await page.waitForSelector('.toast');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied === `http://127.0.0.1:${server.address().port}/r/KQXZ`, `lobby: invite link is built from the page origin (${copied})`);
  await page.click('.invite-actions >> text=Share');
  const shared = await page.evaluate(() => window.__shared);
  check(shared.length === 1 && shared[0].data.url.endsWith('/r/KQXZ') && shared[0].inClick, 'lobby: Share calls navigator.share inside the click');
  await clear();
  await page.click('text=Leave');
  check((await count('onLeave')) === 1, 'lobby: leave');

  // ---- Lobby: guest, practice, teams ---------------------------------------------------------------------
  await scene('lobby-guest-rules');
  await clear();
  await rule('Mode', 'Teams').click({ force: true });
  check((await count('onSettings')) === 0, 'guest: settings are read-only');
  check(await rule('Mode', 'Teams').evaluate((b) => b.closest('[role="radiogroup"]').getAttribute('aria-disabled')) === 'true', 'guest: read-only groups are aria-disabled');
  check(await page.locator('#screen-lobby .actionbar .btn-green').isHidden(), 'guest: no start button');
  check((await visibleText('#start-note')).includes('Waiting for'), 'guest: waits for the host');
  await scene('lobby-practice');
  check(await page.locator('.code-card').isHidden() && await page.locator('.practice-card').isVisible(), 'practice: no invite or QR');
  await scene('lobby-host-teams');
  await clear();
  await page.locator('.seg-teams .seg-btn', { hasText: 'Team B' }).click();
  same(await last('onProfile'), ['onProfile', { team: 1 }], 'teams: pick a team');
  await page.locator('[aria-label="Move Boomer to the other team"]').click();
  same(await last('onProfile'), ['onProfile', { id: 1, team: 0 }], 'teams: the host moves a bot');

  // ---- Game ----------------------------------------------------------------------------------------------
  await scene('game-playing');
  check(await page.locator('.hud-chips .chip').count() === 8, 'game: one chip per fighter');
  check(await page.locator('.chip.is-me').count() === 1, 'game: exactly one chip is mine');
  await page.evaluate(() => {
    const ui = window.gallery.ui;
    const m = { roundNo: 3, winsNeeded: 3, timeLeftSec: 9, suddenDeath: false, state: 'playing', mode: 'ffa', players: [{ id: 0, name: 'Alex', color: 0, team: 0, alive: true, wins: 0, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0, curse: null, isBot: false, isMe: true, connected: true, waiting: false }, { id: 5, name: 'Pixel', color: 5, team: 1, alive: false, wins: 0, bombsMax: 1, range: 2, speedLv: 0, kick: false, glove: false, shield: 0, curse: null, isBot: true, isMe: false, connected: true, waiting: false }] };
    ui.updateHud(m);
  });
  check(await page.locator('.hud-chips .chip').count() === 2 && await page.locator('.hud-timer.is-low').count() === 1, 'game: the HUD follows the model (fewer fighters, low time)');
  await page.evaluate(() => window.gallery.ui.updateHud({ roundNo: 3, winsNeeded: 3, timeLeftSec: 0, suddenDeath: true, state: 'playing', mode: 'ffa', players: [] }));
  check(await page.locator('.hud-sd').isVisible(), 'game: sudden death shows its chip');
  check(await page.locator('.hud-banner.is-on').count() === 1, 'game: sudden death raises a banner');
  await page.evaluate(() => window.gallery.ui.showCountdown('3'));
  await page.waitForTimeout(120);
  check((await visibleText('#sr-live')) === '3', 'game: countdown digits are announced');
  await page.evaluate(() => window.gallery.ui.killfeed('Dad blasted <b>Mom</b>'));
  check(await page.locator('.hud-feed .feed-item').count() >= 1 && await page.locator('.hud-feed b').count() === 0, 'game: kill feed is text');
  await clear();
  await page.locator('.emote-btn').click();
  check(await page.locator('.emote-bar').isVisible(), 'game: emote button opens the bar');
  await page.locator('.emote-btn-item').nth(2).click();
  same(await last('onEmote'), ['onEmote', 2], 'game: emote index');
  check(await page.locator('.emote-bar').isHidden(), 'game: the bar closes after choosing');
  await clear();
  await page.locator('.hud-tr .icon-btn').nth(1).click();
  same(await last('onMute'), ['onMute', true], 'game: mute button');
  check(await page.locator('.hud-tr .icon-btn').nth(1).getAttribute('aria-pressed') === 'true', 'game: mute button shows its state');
  await page.locator('.hud-tl .icon-btn').click();
  check(await page.evaluate(() => window.gallery.ui.menuOpen), 'game: menu button opens the menu');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !window.gallery.ui.menuOpen), 'game: Esc closes the menu');
  await page.evaluate(() => window.gallery.ui.showMenu(true));
  await clear();
  await page.click('.modal-menu >> text=Leave match');
  check((await count('onLeave')) === 1 && await page.evaluate(() => !window.gallery.ui.menuOpen), 'game: leaving from the menu');
  await page.evaluate(() => window.gallery.ui.showMenu(true));
  await page.click('.modal-menu >> text=End match for all');
  check((await count('onBackToLobby')) === 1, 'game: the host can end the match');

  // ---- Results and round end ----------------------------------------------------------------------------
  await scene('results-you');
  await clear();
  await page.click('text=Play again');
  check((await count('onStart')) === 1, 'results: play again');
  await page.click('text=Back to lobby');
  check((await count('onBackToLobby')) === 1, 'results: back to lobby');
  check(await page.locator('.podium-step').count() === 3, 'results: three podium steps');
  await scene('results-notenough');
  check((await visibleText('.results-sub')).includes('Not enough players - match ended'), 'results: not enough players message');
  await scene('roundend-draw');
  check((await visibleText('.re-title')).includes('draw'), 'round end: a draw is announced');

  // ---- Accessibility contract ---------------------------------------------------------------------------
  for (const [width, height, label] of [[1280, 800, 'desktop'], [320, 568, 'small phone']]) for (const name of ['title', 'lobby-host', 'game-playing', 'results-podium']) {
    await page.setViewportSize({ width, height });
    await scene(name);
    const report = await page.evaluate(() => {
      const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
      const screens = [...document.querySelectorAll('.screen')].filter((s) => !s.hidden);
      const unnamed = [...document.querySelectorAll('.screen:not([hidden]) button, .screen:not([hidden]) input, .screen:not([hidden]) [role="radio"], .screen:not([hidden]) [role="switch"]')]
        .filter(shown).filter((n) => !(n.getAttribute('aria-label') || n.textContent.trim() || n.title || document.querySelector(`label[for="${n.id}"]`) || document.getElementById(n.getAttribute('aria-labelledby') ?? '')?.textContent.trim())).map((n) => n.outerHTML.slice(0, 80));
      return {
        screens: screens.length, h1: screens[0].querySelectorAll('h1').length, labelled: screens[0].hasAttribute('aria-labelledby'), unnamed,
        imagesWithoutAlt: [...document.querySelectorAll('img:not([alt])')].length, live: !!document.querySelector('#sr-live[aria-live="polite"]'),
        radiosChecked: [...document.querySelectorAll('.screen:not([hidden]) [role="radiogroup"]')].filter((g) => !g.querySelector('[aria-checked="true"]') && !g.closest('[hidden]')).length,
        smallText: [...document.querySelectorAll('.screen:not([hidden]) *')].filter((n) => n.children.length === 0 && n.textContent.trim() && shown(n) && !n.closest('.sr-only, svg') && parseFloat(getComputedStyle(n).fontSize) < 13.5).map((n) => `${n.className || n.tagName}:${getComputedStyle(n).fontSize}`).slice(0, 5),
      };
    });
    check(report.screens === 1 && report.h1 === 1 && report.labelled, `a11y ${label} ${name}: one screen, one h1, labelled (${JSON.stringify([report.screens, report.h1, report.labelled])})`);
    check(report.unnamed.length === 0, `a11y ${label} ${name}: every control has a name ${JSON.stringify(report.unnamed)}`);
    check(report.imagesWithoutAlt === 0 && report.live, `a11y ${label} ${name}: images have alt, live region exists`);
    check(report.radiosChecked === 0, `a11y ${label} ${name}: every radio group has a checked option`);
    check(report.smallText.length === 0, `a11y ${label} ${name}: text below 13.5px ${JSON.stringify(report.smallText)}`);
  }

  check(errors.length === 0, `no console errors or exceptions: ${errors.join(' | ')}`);
  await context.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
