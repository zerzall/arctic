// Connection trouble and its recovery (docs/SPEC.md 5.4, Appendix A.4 F4/F5): a cut socket mid-match resumes the same character,
// a longer outage shows the reconnecting banner, a page reload rejoins by token, a server restart ends the party politely,
// and a kick sends the player home. Real Chromium, real server processes.
import * as H from '../helpers/e2e-harness.js';

export const name = 'reconnect: cut socket, outage banner, reload rejoin, server restart, kick';

const cutSocket = (p, { block = false } = {}) => p.page.evaluate((b) => {
  if (b) window.__ws.blocked = true;
  for (const s of window.__ws.sockets) if (s.readyState < 2) s.close(4000, 'e2e');
}, block);
const unblock = (p) => p.page.evaluate(() => { window.__ws.blocked = false; });

export default async function reconnect({ base, browser, playwright, ok }) {
  const problems = [];
  // Errors that a cut connection legitimately logs are collected separately: the browser reports failed WebSocket handshakes as console errors.
  const expected = [];

  const host = await H.openPlayer({ browser, playwright, base, label: 'host', problems });
  const guest = await H.openPlayer({ browser, playwright, base, label: 'guest', problems: expected });
  const code = await H.createRoom(host, 'Hana');
  await H.joinByLink(guest, code, 'Gus');
  await H.addBot(host, 'easy');
  await H.pick(host, 'Wins needed to take the match', '1');
  await H.pick(host, 'Round time', '4:00');
  await H.startMatch(host);
  await guest.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'guest playing', timeout: 15000 });
  const me = (await guest.probe()).me;

  // ---- 1. The socket dies and comes straight back
  const joinedBefore = (await guest.probe()).msgs.joined;
  await cutSocket(guest);
  const back = await guest.until((x) => (x.msgs.joined ?? 0) > joinedBefore && x.ws === 1 && x.screen === 'game', { what: 'guest reconnected', timeout: 15000 });
  ok('a cut socket reconnects by itself and resumes the same character', back.me === me && back.joined);
  const snapsA = (await guest.probe()).stats.snapshots;
  await H.sleep(700);
  ok('snapshots flow again after the reconnect', (await guest.probe()).stats.snapshots > snapsA + 5);
  const hostView = await host.until((x) => x.lobby.players.find((q) => q.name === 'Gus')?.connected === true, { what: 'the host seeing Gus connected' });
  ok('the host sees Gus connected again', hostView.lobby.players.find((q) => q.name === 'Gus').connected);
  // The host watches the server's copy of Gus: it must move when Gus presses a key after the reconnect.
  const walked = await H.nudge(guest);
  const gusOnHost = async () => H.fighter(await host.probe(), me);
  const moved = walked ? await gusOnHost() : null;
  ok('input works after the reconnect (the server applies the numbered cmds again)', !!walked && !!moved && Math.hypot(moved.x - walked.from.x, moved.y - walked.from.y) > 0.3,
    walked ? `${walked.key}: ${walked.from.x.toFixed(2)},${walked.from.y.toFixed(2)} -> host sees ${moved?.x.toFixed(2)},${moved?.y.toFixed(2)}` : 'no arrow moved Gus (dead?)');

  // ---- 1b. A hidden tab (phone locked, other app in front): the socket stays open, input stops, and play resumes on return
  const hideTab = (hidden) => guest.page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const joinedHidden = (await guest.probe()).msgs.joined;
  await hideTab(true);
  await H.sleep(2500);
  await hideTab(false);
  await H.sleep(600);
  const shown = await guest.probe();
  ok('a hidden tab keeps its connection and its seat (no reconnect needed)', shown.ws === 1 && shown.msgs.joined === joinedHidden && shown.screen === 'game');
  const walkedAgain = await H.nudge(guest, { keys: [walked ? walked.key : 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'] });
  const seen = walkedAgain ? await gusOnHost() : null;
  ok('after returning to the tab the player can move again', !!walkedAgain && !!seen && Math.hypot(seen.x - walkedAgain.from.x, seen.y - walkedAgain.from.y) > 0.3,
    walkedAgain ? `${walkedAgain.key}` : 'no arrow moved the player (dead?)');

  // ---- 2. An outage of a few seconds: the banner shows, the host sees Gus away and standing still, then everything recovers
  const joinedMid = (await guest.probe()).msgs.joined;
  await guest.page.keyboard.down(walked ? walked.key : 'ArrowDown');       // a held key must not keep walking through the outage
  await cutSocket(guest, { block: true });
  await guest.page.locator('.reconnect-bar').waitFor({ state: 'visible', timeout: 8000 });
  const barText = await guest.page.locator('.reconnect-text').innerText();
  ok('an outage shows "Connection lost. Reconnecting" with a countdown', /Connection lost\. Reconnecting.*giving up in \d+ s/.test(barText), barText);
  await guest.shot('30-reconnecting');
  await host.until((x) => x.lobby.players.find((q) => q.name === 'Gus')?.connected === false, { what: 'the host seeing Gus drop', timeout: 8000 });
  const still0 = await gusOnHost();
  await H.sleep(1500);
  const still1 = await gusOnHost();
  ok('the others see the player as away, standing still', !!still0 && !!still1 && Math.hypot(still1.x - still0.x, still1.y - still0.y) < 0.05, `${still0?.x},${still0?.y} -> ${still1?.x},${still1?.y}`);
  await guest.page.keyboard.up(walked ? walked.key : 'ArrowDown');
  await H.sleep(1000);
  await unblock(guest);
  const healed = await guest.until((x) => (x.msgs.joined ?? 0) > joinedMid && x.ws === 1, { what: 'guest reconnected after the outage', timeout: 20000 });
  ok('the client reconnects once the network is back and the banner goes', healed.joined && (await guest.page.locator('.reconnect-bar').count()) === 0);
  await host.until((x) => x.lobby.players.find((q) => q.name === 'Gus')?.connected === true, { what: 'the host seeing Gus back', timeout: 8000 });

  // ---- 3. A reload in the middle of a match lands back in the match (token in sessionStorage)
  const before = await guest.probe();
  await guest.page.reload();
  await guest.page.waitForFunction(() => window.__bpReady === true);
  const rejoined = await guest.until((x) => x.screen === 'game' && x.view && x.joined, { what: 'guest rejoined after a reload', timeout: 20000 });
  ok('a reload mid-match rejoins the same room', rejoined.code === code && new URL(guest.page.url()).pathname === `/r/${code}`, `${rejoined.code} ${guest.page.url()}`);
  ok('a reload mid-match keeps the same character', rejoined.me === before.me, `${before.me} -> ${rejoined.me}`);

  // ---- 4. Kick: the host removes Gus
  await host.page.evaluate(() => { document.querySelector('.hud-top'); });
  await host.until((x) => x.screen === 'game', { what: 'host still in the game' });
  // (kicking is a lobby action: end the match first)
  await host.page.keyboard.press('Escape');
  await host.page.getByRole('button', { name: /End match for all/ }).click();
  await host.until((x) => x.screen === 'lobby' && x.lobby.phase === 'lobby', { what: 'host back in the lobby' });
  await guest.until((x) => x.screen === 'lobby', { what: 'guest back in the lobby' });
  await host.page.getByRole('button', { name: /^Kick Gus/ }).click();
  await host.page.getByRole('button', { name: /^Kick Gus out/ }).click();
  await guest.until((x) => x.screen === 'title', { what: 'the kicked guest on the title screen', timeout: 8000 });
  ok('a kicked player sees why and is sent home', await guest.page.getByRole('heading', { name: 'You were removed' }).isVisible());
  await guest.shot('31-kicked');
  const storedAfterKick = await guest.page.evaluate(() => sessionStorage.getItem('bp.session'));
  ok('a kicked player does not auto-rejoin (the session is cleared)', storedAfterKick === null);
  ok('no unexpected console problems on the host', problems.length === 0, problems.join(' | '));
  await Promise.all([host.close(), guest.close()]);

  // ---- 5. The server restarts: reconnecting fails with "no room", and the party ends politely
  const mine = await H.startServer();
  const a = await H.openPlayer({ browser, playwright, base: mine.url, label: 'a', problems: expected });
  const b = await H.openPlayer({ browser, playwright, base: mine.url, label: 'b', problems: expected });
  const room = await H.createRoom(a, 'Ada');
  await H.joinByLink(b, room, 'Bo');
  await mine.stop();
  await b.page.locator('.reconnect-bar').waitFor({ state: 'visible', timeout: 15000 });
  ok('when the server goes away the players see the reconnecting banner', true);
  const revived = await H.startServer({ port: mine.port });
  await b.page.getByRole('heading', { name: 'That party has ended' }).waitFor({ state: 'visible', timeout: 30000 });
  ok('after a restart the party is over: "That party has ended" with Create new room and Home', (await b.page.getByRole('button', { name: 'Create new room' }).isVisible()) && (await b.page.getByRole('button', { name: 'Home' }).isVisible()));
  await b.shot('32-party-ended');
  await b.page.getByRole('button', { name: 'Create new room' }).click();
  const fresh = await b.until((x) => x.screen === 'lobby' && x.code.length === 4 && x.code !== room, { what: 'a fresh room after the restart', timeout: 10000 });
  ok('Create new room starts a new lobby', fresh.lobby.players.length === 1);
  await Promise.all([a.close(), b.close()]);
  await revived.stop();

  // ---- 6. Nothing to reach: Cancel gets out of the connecting screen, and "Waking up the server" shows after a few seconds
  const lost = await H.openPlayer({ browser, playwright, base, label: 'lost', problems: expected });
  await lost.page.evaluate(() => { window.__ws.blocked = true; });
  await H.typeName(lost, 'Lost');
  await lost.page.getByRole('button', { name: /Create room/ }).click();
  await lost.page.getByText(/Waking up the server/).waitFor({ state: 'visible', timeout: 15000 });
  ok('with no server answering, "Waking up the server" appears with a seconds counter', await lost.page.locator('.conn-time').isVisible());
  await lost.shot('33-waking');
  await lost.page.getByRole('button', { name: 'Cancel' }).click();
  await lost.until((x) => x.screen === 'title', { what: 'the title screen after Cancel', timeout: 5000 });
  ok('Cancel leaves the connecting screen', (await lost.page.locator('.conn-overlay').count()) === 0);
  await lost.close();
}
