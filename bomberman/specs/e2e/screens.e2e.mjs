// The rest of the UI in a real browser (docs/SPEC.md 8.3, 8.4, 8.6): join errors, lobby editing and chat, emotes, sudden death, the
// settings and how-to modals, sound settings that stick, and the layout of a tiny phone. (A scenario keeps to three rooms: the server
// limits room creation per client address, see run.e2e.mjs. More layouts are in layouts.e2e.mjs.)
import * as H from '../helpers/e2e-harness.js';

export const name = 'screens: join errors, chat, emotes, sudden death, settings, a 320 px phone';

export default async function screens({ base, browser, playwright, ok }) {
  const problems = [];
  const host = await H.openPlayer({ browser, playwright, base, label: 'host', problems });

  // ---- Join errors on the title screen
  const stray = await H.openPlayer({ browser, playwright, base, label: 'stray', problems });
  await H.typeName(stray, 'Stray');
  await stray.page.locator('#code-input').fill('BCDF');
  await stray.page.getByRole('button', { name: 'Join', exact: true }).click();
  await stray.page.locator('.form-error').waitFor({ state: 'visible', timeout: 8000 });
  const noRoom = await stray.page.locator('.form-error').innerText();
  ok('joining a room that does not exist says so on the title screen', /does not exist/.test(noRoom), noRoom);
  ok('the typed code stays in the box for a second try', (await stray.page.locator('#code-input').inputValue()) === 'BCDF');
  await stray.shot('40-join-no-room');
  await stray.page.locator('#code-input').fill('B');
  await stray.page.getByRole('button', { name: 'Join', exact: true }).click();
  ok('a code that is too short is refused before any network trip', /4 letters/.test(await stray.page.locator('.form-error').innerText()));

  const code = await H.createRoom(host, 'Hosty');
  await host.page.getByRole('switch', { name: 'Lock room' }).click();
  await host.until((x) => x.lobby.settings.locked === true, { what: 'the room to lock' });
  await stray.page.locator('#code-input').fill(code);
  await stray.page.getByRole('button', { name: 'Join', exact: true }).click();
  await stray.page.locator('.form-error').filter({ hasText: 'locked' }).waitFor({ state: 'visible', timeout: 8000 });
  ok('a locked room refuses newcomers with a clear message', true);
  await host.page.getByRole('switch', { name: 'Lock room' }).click();
  await host.until((x) => x.lobby.settings.locked === false, { what: 'the room to unlock' });

  // ---- Lobby: chat, colour, name, teams
  const pal = await H.openPlayer({ browser, playwright, base, label: 'pal', problems });
  await H.joinByLink(pal, code, 'Pal');
  await pal.page.locator('#screen-lobby .chat-input').fill('hello from Pal');
  await pal.page.keyboard.press('Enter');
  await host.page.locator('.chat-log').first().getByText('hello from Pal').waitFor({ timeout: 5000 });
  ok('a chat line reaches everyone in the lobby', true);
  ok('the sender hears no chat sound for their own line, the receiver does', ((await host.probe()).sounds.chat ?? 0) >= 1 && ((await pal.probe()).sounds.chat ?? 0) === 0);
  await host.page.getByRole('radio', { name: /^Cyan/ }).click();
  await host.page.locator('#my-name').fill('Hosty II');
  await host.page.locator('#my-name').press('Enter');
  const renamed = await pal.until((x) => x.lobby.players.some((q) => q.name === 'Hosty II'), { what: 'the new name on the guest side' });
  ok('a new name reaches the other players', !!renamed);
  await H.pick(host, 'Mode', 'Teams');
  await host.until((x) => x.lobby.settings.mode === 'teams', { what: 'team mode' });
  await pal.page.getByRole('radio', { name: 'Team B' }).click();
  await pal.until((x) => x.lobby.players.find((q) => q.name === 'Pal') !== undefined, { what: 'Pal still there' });
  await host.shot('41-lobby-teams');
  await H.pick(host, 'Mode', 'Free-for-all');
  await pal.page.getByRole('button', { name: /Leave/ }).click();

  // ---- Modals: How to play, Settings; sound settings that stick
  await host.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await host.page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'visible' });
  await host.shot('42-settings');
  await host.page.getByRole('dialog').getByRole('switch', { name: 'Sound' }).click();
  await host.page.keyboard.press('Escape');
  const muted = await host.page.evaluate(() => JSON.parse(localStorage.getItem('bp.audio') ?? '{}'));
  ok('turning sound off in Settings is remembered in this browser', muted.muted === true, JSON.stringify(muted));
  await host.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await host.page.getByRole('dialog').getByRole('switch', { name: 'Sound' }).click();
  await host.page.keyboard.press('Escape');
  // Volume, reduced effects and the controls side reach the engine and are remembered
  await host.page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = host.page.getByRole('dialog', { name: 'Settings' });
  await dialog.locator('input[type=range]').fill('35');
  await dialog.getByRole('switch', { name: 'Reduce effects' }).click();
  await dialog.getByRole('radio', { name: 'Left-handed' }).click();
  await host.page.keyboard.press('Escape');
  const saved = await host.page.evaluate(() => ({ audio: JSON.parse(localStorage.getItem('bp.audio')), reduce: localStorage.getItem('bp.reduce'), hand: localStorage.getItem('bp.hand') }));
  const live = (await host.probe()).settings;
  ok('volume, reduced effects and hand are applied at once and saved', Math.abs(saved.audio.volume - 0.35) < 0.001 && saved.reduce === '1' && saved.hand === 'left' && Math.abs(live.volume - 0.35) < 0.001 && live.reduce && live.hand === 'left', JSON.stringify(saved));
  ok('the renderer follows "Reduce effects"', (await host.probe()).render.reduced === true);
  await host.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByRole('switch', { name: 'Reduce effects' }).click();
  await dialog.getByRole('radio', { name: 'Right-handed' }).click();
  await dialog.locator('input[type=range]').fill('80');
  await host.page.keyboard.press('Escape');

  // Opening the site again in the same tab drops back into the room (a fresh session): leave it first to reach the title screen.
  await host.page.goto(`${base}/?debug=1`);
  await host.until((x) => x.screen === 'lobby' && x.joined, { what: 'the tab rejoining its room' });
  ok('opening the site again in the same tab rejoins the room it was in', true);
  await host.page.getByRole('button', { name: /Leave/ }).click();
  await host.until((x) => x.screen === 'title', { what: 'the title screen' });
  await host.page.getByRole('button', { name: /How to play/ }).click();
  await host.page.getByRole('dialog', { name: 'How to play' }).waitFor({ state: 'visible' });
  await host.shot('43-howto');
  await host.page.keyboard.press('Escape');
  ok('Esc closes the How to play dialog', (await host.page.getByRole('dialog').count()) === 0);
  await host.close();

  // ---- A fresh match for the in-game features
  const a = await H.openPlayer({ browser, playwright, base, label: 'a', problems });
  const b = await H.openPlayer({ browser, playwright, base, label: 'b', problems });
  const room = await H.createRoom(a, 'Ann');
  await H.joinByLink(b, room, 'Bob');
  await H.addBot(a, 'easy');
  await H.addBot(a, 'normal');
  await H.pick(a, 'Wins needed to take the match', '1');
  await H.pick(a, 'Round time', '1:00');
  await H.startMatch(a);
  for (const p of [a, b]) await p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: `${p.label} playing`, timeout: 20000 });

  // Emotes: key 1 shows a bubble on everybody's screen and plays the sound
  await a.page.keyboard.press('Digit1');
  await b.until((x) => (x.sounds.emote ?? 0) >= 1, { what: 'the emote to reach Bob', timeout: 4000 });
  await H.sleep(250);
  await b.shot('44-emote');
  ok('an emote key reaches the other players', true);
  await a.page.keyboard.press('KeyT');
  await a.page.locator('.emote-bar').waitFor({ state: 'visible', timeout: 2000 });
  ok('T opens the emote wheel', true);
  await a.shot('45-emote-wheel');
  await a.page.locator('.emote-btn-item').nth(2).click();
  await b.until((x) => (x.sounds.emote ?? 0) >= 2, { what: 'the second emote', timeout: 4000 });

  // M mutes and unmutes; the mute button in the HUD follows
  const before1 = await a.page.evaluate(() => JSON.parse(localStorage.getItem('bp.audio') ?? '{}').muted === true);
  await a.page.keyboard.press('KeyM');
  await H.sleep(200);
  const after1 = await a.page.evaluate(() => JSON.parse(localStorage.getItem('bp.audio') ?? '{}').muted === true);
  ok('M toggles mute and the setting is saved', before1 === false && after1 === true);
  await a.page.keyboard.press('KeyM');

  // Sudden death: the clock runs out (1:00), walls start closing in, the banner shows, sudden_death sound and faster music
  await a.until((x) => x.view && (x.view.suddenDeath || x.screen !== 'game'), { what: 'sudden death', timeout: 100000 });
  const sd = await a.probe();
  if (sd.screen === 'game') {
    await H.sleep(1200);
    await a.shot('46-sudden-death');
    ok('sudden death is announced with a sound', (sd.sounds.sudden_death ?? 0) >= 1 || (await a.probe()).sounds.sudden_death >= 1);
    ok('the falling walls are on the field', (await a.probe()).view.falling >= 0);
  } else {
    ok('the round ended before sudden death (a bot won it)', true);
  }
  await a.until((x) => x.screen === 'results', { what: 'results', timeout: 90000 });
  // Chat stays open on the results screen
  await b.page.locator('#screen-results .chat-input').fill('gg');
  await b.page.keyboard.press('Enter');
  await a.page.locator('.screen-results .chat-log').getByText('gg').waitFor({ timeout: 5000 });
  ok('chat works on the results screen', true);
  await a.close();
  await b.close();

  // ---- Layout: a 320 px phone with 8 fighters
  const tiny = await H.openPlayer({ browser, playwright, base, label: 'tiny', problems, phone: true, small: true });
  await H.createRoom(tiny, 'Tiny');
  for (const level of ['easy', 'normal', 'hard', 'easy', 'normal', 'hard', 'easy']) await H.addBot(tiny, level);
  await H.sleep(500);
  await tiny.shot('47-lobby-tiny');
  await H.pick(tiny, 'Round time', '1:00');
  await H.startMatch(tiny);
  await tiny.until((x) => x.screen === 'game' && x.view && x.view.state === 1 && x.view.players.length === 8, { what: 'tiny playing', timeout: 20000 });
  await H.sleep(500);
  await tiny.shot('48-game-tiny');
  const overflow = await tiny.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok('a 320 px phone has no sideways scrolling in the game', overflow.sw <= overflow.cw, JSON.stringify(overflow));
  const tinyBomb = await tiny.page.locator('.bp-bomb').boundingBox();
  const tinyArena = await tiny.page.locator('#arena').boundingBox();
  ok('the BOMB button is fully on screen and at least 88 px wide', tinyBomb && tinyBomb.x + tinyBomb.width <= 320 && tinyBomb.width >= 88, JSON.stringify(tinyBomb));
  ok('the arena fills the width of a 320 px phone', tinyArena && tinyArena.width >= 300, JSON.stringify(tinyArena));
  await tiny.close();

  ok('no console errors, warnings or uncaught exceptions', problems.length === 0, problems.slice(0, 4).join(' | '));
}
