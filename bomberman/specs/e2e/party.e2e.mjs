// A whole party in real browsers (docs/SPEC.md section 10, E2E):
//   host (desktop) creates a room, a second desktop and a phone (touch, mobile emulation) join through /r/CODE links, the host adds
//   two bots and starts a one-round match; everybody sees the arena; the host plays with the keyboard, the phone with the joystick and
//   BOMB button; the match is played to its results screen and back to the lobby. Screenshots of every screen go to $E2E_SHOTS.
import * as H from '../helpers/e2e-harness.js';

export const name = 'party: 3 browsers (one phone) + 2 bots, keyboard and touch play, a whole match';

export default async function party({ base, browser, playwright, ok }) {
  const problems = [];
  const host = await H.openPlayer({ browser, playwright, base, label: 'host', problems });
  const guest = await H.openPlayer({ browser, playwright, base, label: 'guest', problems });
  const phone = await H.openPlayer({ browser, playwright, base, label: 'phone', problems, phone: true });

  // ---- Title
  ok('the boot screen is gone and the title screen shows', (await host.probe()).screen === 'title' && (await host.page.locator('#boot').count()) === 0);
  await host.shot('01-title');

  // ---- Lobby: create, join via link, bots, rules
  const code = await H.createRoom(host, 'Ana');
  ok('Create room lands in a lobby with a 4-letter consonant code', /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(code), code);
  ok('the address became the invite link /r/CODE', new URL(host.page.url()).pathname === `/r/${code}`, host.page.url());
  const letters = (await host.page.locator('.code-letters').innerText()).replace(/\s/g, '');
  ok('the room code is visible on the lobby screen', letters === code, letters);
  const hint = await host.page.locator('.code-warn').innerText().catch(() => '');
  ok('opened as localhost, the lobby explains that the link cannot be shared instead of offering it', /Others can't reach "localhost"/.test(hint) && (await host.page.locator('.invite-row').isHidden()), hint.slice(0, 60));
  await host.shot('02-lobby-host-alone');

  await guest.page.goto(`${base}/r/${code}?debug=1`);
  await guest.page.waitForFunction(() => window.__bpReady === true);
  ok('a /r/CODE link pre-fills the code and shows the invitation', (await guest.page.locator('.invite-code').innerText()) === code && (await guest.page.locator('#code-input').inputValue()) === code);
  await guest.shot('03-title-invited');
  await H.typeName(guest, 'Ben');
  await guest.page.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.until((p) => p.screen === 'lobby' && p.code === code, { what: 'guest in the lobby' });
  await H.joinByLink(phone, code, 'Cleo');
  await H.addBot(host, 'normal');
  await H.addBot(host, 'hard');
  await H.pick(host, 'Wins needed to take the match', '1');
  await H.pick(host, 'Round time', '1:00');
  await host.until((p) => p.lobby.players.length === 5 && p.lobby.settings.rounds === 1 && p.lobby.settings.roundTime === 60, { what: '5 players and the rules' });
  ok('everyone sees all five players', (await guest.probe()).lobby.players.length === 5 && (await phone.probe()).lobby.players.length === 5);
  ok('a guest sees the rules read-only', (await guest.page.locator('.settings-note').innerText()).includes('Only the host'));
  await host.shot('04-lobby-host');
  await guest.shot('05-lobby-guest');
  await phone.shot('06-lobby-phone');

  // ---- Start: everybody sees the arena
  await H.startMatch(host);
  for (const p of [host, guest, phone]) await p.until((x) => x.screen === 'game' && x.view && x.view.players.length === 5, { what: `${p.label} in the arena` });
  await host.shot('07-countdown-host');
  for (const p of [host, guest, phone]) await p.until((x) => x.view.state === 1, { what: `${p.label} playing`, timeout: 15000 });
  await H.sleep(700);
  for (const p of [host, guest, phone]) {
    const stats = await H.canvasStats(p);
    ok(`${p.label}: the canvas is not blank and shows a whole arena`, stats.colours > 60 && stats.lit > 0.35 && stats.w > 200, JSON.stringify(stats));
  }
  ok('the touch client shows joystick and BOMB, the desktop does not', (await phone.page.locator('.bp-bomb').isVisible()) && !(await host.page.locator('.bp-bomb').isVisible()));

  // ---- Keyboard play (host). The spawn corner is random, so try the four arrows until one is not into a wall.
  let moved = null;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    const a = (await host.probe()).view.me;
    await host.page.keyboard.down(key);
    await H.sleep(400);
    await host.page.keyboard.up(key);
    const b = (await host.probe()).view.me;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.6) { moved = { key, a, b }; break; }
  }
  ok('an arrow key moves the local blastie', !!moved, moved ? `${moved.key}: ${moved.a.x.toFixed(2)},${moved.a.y.toFixed(2)} -> ${moved.b.x.toFixed(2)},${moved.b.y.toFixed(2)}` : 'no arrow moved it');
  const hostBefore = await host.probe();
  await host.page.keyboard.press('Space');
  const placed = await host.until((p) => p.view.bombs + p.view.ghosts > (hostBefore.view.bombs + hostBefore.view.ghosts) && (p.counts.bomb ?? 0) > (hostBefore.counts.bomb ?? 0), { what: 'a bomb after Space', timeout: 3000 });
  ok('Space places a bomb at once (the ghost or the server bomb) with its sound', !!placed && (placed.sounds.place ?? 0) > 0);
  await host.page.keyboard.down('ArrowDown');
  await H.sleep(600);
  await host.page.keyboard.up('ArrowDown');
  const exploded = await host.until((p) => (p.counts.boom ?? 0) > 0, { what: 'an explosion', timeout: 8000 });
  ok('the bomb explodes (boom event, explosion sound)', (exploded.counts.boom ?? 0) > 0 && (exploded.sounds.explode ?? 0) > 0);
  await host.shot('08-hud-host');

  // ---- Touch play (phone)
  const box = await phone.page.locator('.bp-zone').boundingBox();
  const cdp = await phone.context.newCDPSession(phone.page);
  let dragged = null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.6;
  for (const [dx, dy] of [[-60, 0], [60, 0], [0, -60], [0, 60]]) {
    const a = (await phone.probe()).view.me;
    if (!a.alive) break;
    await H.touchDrag(phone, cdp, cx, cy, dx, dy, { hold: 450 });
    const b = (await phone.probe()).view.me;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) { dragged = { a, b }; break; }
  }
  ok('a joystick drag moves the phone blastie', !!dragged || !(await phone.probe()).view.me.alive, dragged ? `${dragged.a.x.toFixed(2)},${dragged.a.y.toFixed(2)} -> ${dragged.b.x.toFixed(2)},${dragged.b.y.toFixed(2)}` : 'it did not move');
  const bombBox = await phone.page.locator('.bp-bomb').boundingBox();
  const beforeBombs = (await phone.probe()).counts.bomb ?? 0;
  await phone.page.touchscreen.tap(bombBox.x + bombBox.width / 2, bombBox.y + bombBox.height / 2);
  const tapped = await phone.until((p) => (p.counts.bomb ?? 0) > beforeBombs || !p.view.me.alive, { what: 'a bomb from the BOMB button', timeout: 3000 });
  ok('tapping BOMB places a bomb', (tapped.counts.bomb ?? 0) > beforeBombs || !tapped.view.me.alive);
  await phone.shot('09-hud-phone');

  // ---- Round end, results
  await host.until((p) => p.screen === 'game' && p.view && p.view.state >= 2, { what: 'the round to end', timeout: 120000 });
  await H.sleep(600);
  ok('the winner card shows when the round ends', await host.page.locator('.roundend .re-card').isVisible());
  await host.shot('10-round-end-host');
  await phone.shot('11-round-end-phone');
  for (const p of [host, guest, phone]) await p.until((x) => x.screen === 'results', { what: `${p.label} on the results screen`, timeout: 60000 });
  ok('the match ends on the results screen for everyone', true);
  await host.shot('12-results-host');
  await guest.shot('13-results-guest');
  await phone.shot('14-results-phone');
  ok('the host gets Play again and Back to lobby, a guest does not', (await host.page.getByRole('button', { name: /Play again/ }).isVisible()) && !(await guest.page.getByRole('button', { name: /Play again/ }).isVisible()));
  const standings = await host.page.locator('.standings tbody tr').count();
  ok('the standings list all five fighters', standings === 5, String(standings));

  // ---- Back to lobby
  await host.page.getByRole('button', { name: /Back to lobby/ }).click();
  for (const p of [host, guest, phone]) await p.until((x) => x.screen === 'lobby' && x.lobby.phase === 'lobby', { what: `${p.label} back in the lobby` });
  ok('Back to lobby returns everybody to the lobby with the room intact', (await guest.probe()).lobby.players.length === 5);

  // ---- Leave
  await guest.page.getByRole('button', { name: /Leave/ }).click();
  await guest.until((p) => p.screen === 'title', { what: 'the guest on the title screen' });
  await host.until((p) => p.lobby.players.length === 4, { what: 'the host seeing the guest leave' });
  ok('leaving frees the seat at once and returns to the title', new URL(guest.page.url()).pathname === '/');

  // ---- Opened through a name that is not localhost, over plain http (like a phone on the Wi-Fi), the lobby offers a real invite link
  // and the whole game still works without the secure-context APIs (clipboard, wake lock, crypto.subtle, gamepads).
  const lanPort = 21000 + Math.floor(Math.random() * 15000);
  const lanBase = `http://${H.INSECURE_HOST}:${lanPort}`;
  const lanServer = await H.startServer({ port: lanPort, env: { ALLOWED_ORIGINS: lanBase } });
  const viaLan = await H.openPlayer({ browser, playwright, base: lanBase, label: 'lan', problems });
  ok('the plain-http page is an insecure context, as on a home network', (await viaLan.page.evaluate(() => window.isSecureContext)) === false);
  const lanCode = await H.createRoom(viaLan, 'Wifi');
  const link = await viaLan.page.locator('.invite-link').inputValue();
  ok('through a non-loopback address the invite link is the room address, ready to copy', link === `${lanBase}/r/${lanCode}`, link);
  ok('and there is no "localhost" warning', await viaLan.page.locator('.code-warn').isHidden());
  ok('the QR code of that link is drawn', await viaLan.page.locator('.qr-canvas').isVisible());
  await viaLan.page.getByRole('button', { name: /Copy invite link/ }).click();
  await viaLan.page.locator('.toast').first().waitFor({ state: 'visible', timeout: 3000 });
  const copyToast = await viaLan.page.locator('.toast').first().innerText();
  ok('Copy invite link answers with a toast (copied, or "press Ctrl+C" when the browser refuses)', /copied|Ctrl/i.test(copyToast), copyToast);
  await viaLan.shot('15-lobby-lan-invite');
  await H.addBot(viaLan, 'normal');
  await H.startMatch(viaLan);
  await viaLan.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'a match over plain http', timeout: 20000 });
  await H.sleep(1000);
  const lanStats = await H.canvasStats(viaLan);
  ok('a match plays over plain http too (no secure-context API is required)', lanStats.colours > 60 && lanStats.lit > 0.35, JSON.stringify(lanStats));
  await viaLan.close();
  await lanServer.stop();

  ok('no console errors, warnings, uncaught exceptions or failed requests on any page', problems.length === 0, problems.join(' | '));
  await Promise.all([host.close(), guest.close(), phone.close()]);
}
