// Practice vs bots (docs/SPEC.md 8.1a): a Room running inside the page. Plays, pauses in a hidden tab, opens the menu with Esc,
// plays a whole match to the results screen, leaves, and plays again (the Renderer is reused across sessions).
import * as H from '../helpers/e2e-harness.js';

export const name = 'practice: in-page Room, hidden-tab pause, menu, a whole match, and again';

const hide = (page, hidden) => page.evaluate((h) => {
  if (h) {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  } else {
    delete document.hidden;
    delete document.visibilityState;
  }
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

export default async function practice({ base, browser, playwright, ok }) {
  const problems = [];
  const p = await H.openPlayer({ browser, playwright, base, label: 'solo', problems });
  await H.typeName(p, 'Solo');
  await p.page.getByRole('button', { name: /Practice vs bots/ }).click();
  const lobby = await p.until((x) => x.screen === 'lobby' && x.lobby && x.lobby.players.length === 4, { what: 'the practice lobby with three bots' });
  ok('Practice opens the ordinary lobby with three bots already added', lobby.practice && lobby.lobby.local && lobby.lobby.players.filter((q) => q.isBot).length === 3);
  ok('the address stays / in Practice', new URL(p.page.url()).pathname === '/');
  ok('Practice hides the invite link, the code and the QR code', (await p.page.locator('.code-card').isHidden()) && (await p.page.locator('.practice-card').isVisible()));
  await p.shot('20-practice-lobby');

  await H.pick(p, 'Wins needed to take the match', '1');
  await H.pick(p, 'Round time', '1:00');
  await H.startMatch(p);
  await p.until((x) => x.screen === 'game' && x.view && x.view.state === 0, { what: 'the countdown' });
  await p.until((x) => x.view.state === 1, { what: 'the round to go live', timeout: 8000 });
  await H.sleep(800);
  const stats = await H.canvasStats(p);
  ok('the Practice arena is drawn', stats.colours > 60 && stats.lit > 0.35, JSON.stringify(stats));
  await p.shot('21-practice-play');

  // The local blastie moves (whichever arrow is not into a wall) and a bomb explodes.
  let moved = false;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    const a = (await p.probe()).view.me;
    await p.page.keyboard.down(key);
    await H.sleep(400);
    await p.page.keyboard.up(key);
    const b = (await p.probe()).view.me;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.6) { moved = true; break; }
  }
  ok('the keyboard moves the blastie in Practice', moved);
  await p.page.keyboard.press('Space');
  const boom = await p.until((x) => (x.counts.boom ?? 0) > 0, { what: 'an explosion in Practice', timeout: 9000 });
  ok('a bomb placed with Space explodes in Practice', (boom.counts.boom ?? 0) > 0);

  // Esc opens the menu (the game keeps running), Esc closes it, and the arrow keys work inside it instead of steering.
  await p.page.keyboard.press('Escape');
  const menu = await p.until((x) => x.menuOpen, { what: 'the menu', timeout: 2000 });
  ok('Esc opens the menu and hands the keyboard to it', menu.menuOpen && !menu.inputActive);
  await p.shot('22-practice-menu');
  await p.page.keyboard.press('Escape');
  const closed = await p.until((x) => !x.menuOpen, { what: 'the menu to close', timeout: 2000 });
  ok('Esc closes the menu and the game takes the keys back', !closed.menuOpen);
  await p.until((x) => x.inputActive, { what: 'input active again', timeout: 2000 });

  // A game controller (a fake one, injected): the stick steers, A drops a bomb, Start opens the menu.
  await p.page.evaluate(() => {
    window.__pad = { connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    navigator.getGamepads = () => [window.__pad];
  });
  let padMoved = false;
  for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = (await p.probe()).view.me;
    await p.page.evaluate(([x, y]) => { window.__pad.axes = [x, y, 0, 0]; }, [ax, ay]);
    await H.sleep(400);
    await p.page.evaluate(() => { window.__pad.axes = [0, 0, 0, 0]; });
    const b = (await p.probe()).view.me;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.6) { padMoved = true; break; }
  }
  ok('the controller stick steers the blastie', padMoved);
  const bombsBefore = (await p.probe()).counts.bomb ?? 0;
  await p.page.evaluate(() => { window.__pad.buttons[0] = { pressed: true, value: 1 }; });
  await H.sleep(120);
  await p.page.evaluate(() => { window.__pad.buttons[0] = { pressed: false, value: 0 }; });
  const padBomb = await p.until((x) => (x.counts.bomb ?? 0) > bombsBefore || !x.view.me.alive, { what: 'a bomb from the controller', timeout: 3000 });
  ok('controller button A drops a bomb', (padBomb.counts.bomb ?? 0) > bombsBefore || !padBomb.view.me.alive);
  await p.page.evaluate(() => { window.__pad.buttons[9] = { pressed: true, value: 1 }; });
  await p.until((x) => x.menuOpen, { what: 'the menu from Start', timeout: 2000 });
  await p.page.evaluate(() => { window.__pad.buttons[9] = { pressed: false, value: 0 }; });
  ok('controller Start opens the menu', true);
  await p.page.keyboard.press('Escape');
  await p.until((x) => !x.menuOpen, { what: 'the menu closed', timeout: 2000 });
  await p.page.evaluate(() => { navigator.getGamepads = () => []; });

  // The browser's back gesture must not throw the player out of a match: it opens the menu instead and the page stays put.
  const urlBefore = p.page.url();
  await p.page.goBack();
  await H.sleep(300);
  const backed = await p.probe();
  ok('the back gesture in a match opens the menu and stays on the page', backed.screen === 'game' && backed.menuOpen && p.page.url() === urlBefore, `${backed.screen} menu=${backed.menuOpen} ${p.page.url()}`);
  await p.page.keyboard.press('Escape');
  await p.until((x) => !x.menuOpen && x.inputActive, { what: 'the menu closed after the back gesture', timeout: 2000 });

  // A hidden tab pauses the in-page Room: its clock stands still and a Paused dialog shows; visible again resumes.
  const t0 = (await p.probe()).view;
  await hide(p.page, true);
  await H.sleep(300);
  const pausedAt = (await p.probe()).view;
  await H.sleep(1500);
  const stillAt = (await p.probe()).view;
  ok('a hidden tab pauses Practice (the round clock stands still)', stillAt.timeLeft === pausedAt.timeLeft && pausedAt.timeLeft <= t0.timeLeft, `${t0.timeLeft} -> ${pausedAt.timeLeft} -> ${stillAt.timeLeft}`);
  ok('the Paused overlay shows while hidden', await p.page.getByRole('heading', { name: 'Paused' }).isVisible().catch(() => false));
  await p.shot('23-practice-paused');
  await hide(p.page, false);
  await H.sleep(1000);
  const resumed = (await p.probe()).view;
  ok('visible again resumes Practice and removes the overlay', resumed.timeLeft < stillAt.timeLeft && !(await p.page.getByRole('heading', { name: 'Paused' }).isVisible().catch(() => false)), `${stillAt.timeLeft} -> ${resumed.timeLeft}`);

  // A whole match: the human idles, the bots finish it (bot-only endgames are short, SPEC 3.2).
  const end = await p.until((x) => x.screen === 'results' || (x.view && x.view.state >= 2 && x.view.players.filter((q) => q.alive).length <= 1), { what: 'the round to end', timeout: 120000 });
  ok('the round ends with a winner card or a draw', end.screen === 'results' || (await p.page.locator('.roundend .re-card').isVisible()));
  await p.shot('24-practice-round-end');
  await p.until((x) => x.screen === 'results', { what: 'the results screen', timeout: 60000 });
  await p.shot('25-practice-results');
  ok('the results screen shows the standings of all four fighters', (await p.page.locator('.standings tbody tr').count()) === 4);
  await p.page.getByRole('button', { name: /Back to lobby/ }).click();
  await p.until((x) => x.screen === 'lobby' && x.lobby.phase === 'lobby', { what: 'back in the Practice lobby' });

  // Leave, and play a second Practice: the Renderer and Input are reused.
  await p.page.getByRole('button', { name: /Leave/ }).click();
  await p.until((x) => x.screen === 'title', { what: 'the title screen' });
  await p.page.getByRole('button', { name: /Practice vs bots/ }).click();
  await p.until((x) => x.screen === 'lobby' && x.lobby.players.length === 4, { what: 'a second Practice lobby' });
  await H.startMatch(p);
  await p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'the second round live', timeout: 15000 });
  await H.sleep(700);
  const again = await H.canvasStats(p);
  ok('a second Practice session draws the arena again', again.colours > 60 && again.lit > 0.35, JSON.stringify(again));
  const probe = await p.probe();
  ok('the renderer recorded no errors', probe.render.errors.length === 0, probe.render.errors.join(' | '));

  ok('no console errors, warnings, uncaught exceptions or failed requests', problems.length === 0, problems.join(' | '));
  await p.close();
}
