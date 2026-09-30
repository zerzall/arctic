// The one-file download (scripts/build-single.mjs), opened as file:// with the network blocked: no server, no requests.
//   1. Practice vs bots, a whole match to the results screen.
//   2. Online without a server: a host page and two friends (one on a phone) swap invite and reply codes and play a match against a bot
//      over WebRTC data channels; the host's Room keeps its pace when the page's own timers are throttled like a hidden tab's.
//   3. A friend's link is cut: "Connection lost", a fresh code, and the same character comes back (same token).
//   4. Bad codes get friendly answers, the host ending the game tells the friends, and a browser without Workers still hosts.
// The browser is launched here (not shared) because two contexts on one machine need host candidates: mDNS hiding is switched off.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import * as H from '../helpers/e2e-harness.js';
import { launchChromium } from '../helpers/pw.js';
import { buildSingle } from '../../scripts/build-single.mjs';

export const name = 'single: the one-file download over file:// - offline Practice, host and friends over WebRTC, a phone, a re-handshake';

const OUT = join(tmpdir(), 'blast-party-single-e2e', 'blast-party.html');
const isExternal = (url) => !/^(?:file|data|blob|about|chrome-extension):/i.test(url);

export default async function single({ ok }) {
  const built = await buildSingle({ out: OUT });
  const url = `${pathToFileURL(built.out).href}?debug=1`;
  console.log(`   built ${(built.bytes / 1024).toFixed(0)} KB (${(built.gzip / 1024).toFixed(0)} KB gzipped)`);

  const { browser, playwright, reason } = await launchChromium({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  if (!browser) throw new Error(reason);
  const problems = [];
  const external = [];
  const requests = [];
  const contexts = [];

  /** One player: its own context (so its own storage), network blocked, every request and console problem recorded. */
  async function open(label, { phone = false, noWorker = false, init = null, small = false, extra = {} } = {}) {
    const device = phone
      ? (small ? { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: playwright.devices['Pixel 5'].userAgent } : playwright.devices['Pixel 5'])
      : { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 };
    const context = await browser.newContext({ ...device, permissions: [] });
    contexts.push(context);
    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (isExternal(u)) {
        external.push(`[${label}] ${u}`);
        route.abort();
      } else route.continue();
    });
    if (noWorker) await context.addInitScript(() => { delete window.Worker; });
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[${label}] uncaught: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`[${label}] request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__bpReady === true, null, { timeout: 20000 });
    const p = {
      label, context, page, phone, ...extra,
      probe: () => page.evaluate(() => window.__bp.probe()),
      until: async (fn, { timeout = 20000, what = 'condition' } = {}) => {
        const t0 = Date.now();
        let last = null;
        for (;;) {
          last = await p.probe().catch(() => null);
          if (last && fn(last)) return last;
          if (Date.now() - t0 > timeout) throw new Error(`[${label}] timed out waiting for ${what}; last probe: ${JSON.stringify(last)?.slice(0, 700)}`);
          await H.sleep(100);
        }
      },
      shot: (name) => page.screenshot({ path: join(H.SHOTS, `${name}.png`) }),
    };
    return p;
  }

  const setName = (p, name) => p.page.locator('#name-input').fill(name);
  const codeOf = async (locator) => {
    await locator.waitFor({ timeout: 25000 });
    await locator.page().waitForFunction((el) => el.value.startsWith('BP1-'), await locator.elementHandle(), { timeout: 25000 });
    return locator.inputValue();
  };

  /** The whole ceremony from the host's lobby: host opens "Add a friend", the friend joins with what was sent, the reply goes back. */
  async function addFriend(host, guest, guestName, { phrasing = true } = {}) {
    await host.page.getByRole('button', { name: 'Add a friend' }).click();
    const invite = await codeOf(host.page.locator('.modal-p2p .code-box[readonly]'));
    if (guest.page.url() !== url && (await guest.probe()).screen !== 'title') throw new Error('the friend must be on the title screen');
    await setName(guest, guestName);
    await guest.page.getByRole('button', { name: /Join a friend's game/ }).click();
    // What a chat app does to a code: a sentence around it, and a line break in the middle of it.
    const pasted = phrasing ? `Hi! Here is my code:\n${invite.slice(0, 200)}\n${invite.slice(200)}\nsee you soon` : invite;
    await guest.page.locator('#invite-input').fill(pasted);
    await guest.page.getByRole('button', { name: 'Continue' }).click();
    const reply = await codeOf(guest.page.locator('.modal-p2p .code-box[readonly]'));
    await host.page.locator('#reply-input').fill(reply);
    const t0 = Date.now();
    await host.page.getByRole('button', { name: 'Connect' }).click();
    await guest.until((x) => x.screen === 'lobby' && x.joined, { what: `${guestName} in the lobby`, timeout: 40000 });
    return { ms: Date.now() - t0, invite, reply };
  }

  try {
    // ================================================================================================
    // 1. Practice, offline
    // ================================================================================================
    const solo = await open('solo');
    const title = await solo.probe();
    ok('the file opens from file:// and reaches the title screen', title.screen === 'title' && new URL(solo.page.url()).protocol === 'file:');
    ok('the title screen offers Practice, Host, Join a friend and How to play', await Promise.all(
      ['Practice vs bots', 'Host a game', "Join a friend's game", 'How to play'].map((n) => solo.page.getByRole('button', { name: n }).isVisible()),
    ).then((r) => r.every(Boolean)));
    ok('and none of the server-only controls', (await solo.page.getByRole('button', { name: /Create room/ }).count()) === 0 && (await solo.page.locator('#code-input').count()) === 0);
    ok('the honest explainer is on the title screen', /keeps this page open/.test(await solo.page.locator('.friends-note').innerText()) && /Wi-Fi/.test(await solo.page.locator('.friends-note').innerText()));
    await solo.shot('60-single-title');
    await setName(solo, 'Solo');
    await solo.page.getByRole('button', { name: /Practice vs bots/ }).click();
    const lobby = await solo.until((x) => x.screen === 'lobby' && x.lobby && x.lobby.players.length === 4, { what: 'the practice lobby' });
    ok('Practice works offline: the lobby has three bots', lobby.practice && lobby.lobby.players.filter((q) => q.isBot).length === 3);
    ok('the address bar keeps the file path (no /r/CODE)', new URL(solo.page.url()).protocol === 'file:' && !/\/r\//.test(solo.page.url()));
    await H.addBot(solo, 'hard');
    await H.addBot(solo, 'hard');
    await H.pick(solo, 'Wins needed to take the match', '1');
    await H.pick(solo, 'Round time', '1:00');
    await H.startMatch(solo);
    await solo.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'the Practice round live', timeout: 15000 });
    await H.sleep(500);
    const arena = await H.canvasStats(solo);
    ok('the arena is drawn from the single file', arena.colours > 60 && arena.lit > 0.35, JSON.stringify(arena));
    // The back gesture must not throw the player out of a match: it opens the menu instead (history.pushState works on file:// pages).
    const urlBefore = solo.page.url();
    await solo.page.goBack();
    await H.sleep(300);
    const backed = await solo.probe();
    ok('the back gesture in a match opens the menu and stays on the file', backed.screen === 'game' && backed.menuOpen && solo.page.url() === urlBefore, `${backed.screen} menu=${backed.menuOpen} ${solo.page.url()}`);
    await solo.page.keyboard.press('Escape');
    await solo.until((x) => !x.menuOpen, { what: 'the menu closed', timeout: 2000 });
    await solo.page.keyboard.press('Space');
    await solo.until((x) => x.screen === 'results', { what: 'the results of an offline Practice match', timeout: 170000 });
    ok('an offline Practice match plays through to the results screen', (await solo.page.locator('.standings tbody tr').count()) === 6);
    await solo.shot('61-single-practice-results');
    ok('a whole offline session made no request outside the file', requests.every((u) => !isExternal(u)) && external.length === 0, external.join(', '));
    await solo.context.close();

    // ================================================================================================
    // 2. Host and two friends
    // ================================================================================================
    const host = await open('host');
    const ann = await open('ann');
    const ben = await open('ben', { phone: true });
    await setName(host, 'Hosty');
    await host.page.getByRole('button', { name: /Host a game/ }).click();
    const hl = await host.until((x) => x.screen === 'lobby' && x.joined, { what: 'the host lobby' });
    ok('hosting seats the host in an ordinary lobby', hl.p2p === 'host' && hl.lobby.hostId === hl.me && hl.lobby.players.length === 1 && !hl.lobby.local);
    ok('the host lobby has no room code, invite link or QR, but an "Add a friend" button',
      (await host.page.locator('.code-card').isHidden()) && (await host.page.getByRole('button', { name: 'Add a friend' }).isVisible()));
    ok('the Room clock runs in a Web Worker (file:// Blob workers work)', hl.ticker === 'worker', hl.ticker);
    await host.shot('62-single-host-lobby');

    // First: bad input gets friendly answers (nothing is sent anywhere).
    await host.page.getByRole('button', { name: 'Add a friend' }).click();
    const invite0 = await codeOf(host.page.locator('.modal-p2p .code-box[readonly]'));
    await host.shot('63-single-add-friend');
    await host.page.locator('#reply-input').fill(invite0);
    await host.page.getByRole('button', { name: 'Connect' }).click();
    ok('pasting the invite where the reply belongs says so', /This code is for joining/.test(await host.page.locator('.modal-p2p .p2p-status').innerText()));
    await host.page.locator('#reply-input').fill('hello, not a code');
    await host.page.getByRole('button', { name: 'Connect' }).click();
    ok('pasting nonsense says it is not a Blast Party code', /doesn't look like a Blast Party code/.test(await host.page.locator('.modal-p2p .p2p-status').innerText()));
    await host.page.locator('#reply-input').fill('');
    await host.page.getByRole('button', { name: 'Connect' }).click();
    ok('pressing Connect with nothing pasted asks for the code', /Paste your friend's reply code first/.test(await host.page.locator('.modal-p2p .p2p-status').innerText()));
    await host.page.locator('.modal-p2p .dialog-actions button').click();

    // A guest that pastes the wrong things.
    await setName(ann, 'Ann');
    await ann.page.getByRole('button', { name: /Join a friend's game/ }).click();
    await ann.page.locator('#invite-input').fill('BP1-abcdefghijk.ABCD');
    await ann.page.getByRole('button', { name: 'Continue' }).click();
    await ann.page.locator('.modal-p2p .p2p-status').waitFor();
    ok('a cut-off code is reported as damaged', /cut short|changed on the way/.test(await ann.page.locator('.modal-p2p .p2p-status').innerText()), await ann.page.locator('.modal-p2p .p2p-status').innerText());
    await ann.shot('64-single-join-error');
    await ann.page.locator('.modal-p2p .dialog-actions button').click();
    await ann.until((x) => x.screen === 'title', { what: 'Ann back on the title screen' });

    const annJoin = await addFriend(host, ann, 'Ann');
    const benJoin = await addFriend(host, ben, 'Ben');
    console.log(`   handshakes: Ann ${annJoin.ms} ms, Ben ${benJoin.ms} ms after "Connect"; invite ${annJoin.invite.length} chars, reply ${annJoin.reply.length} chars`);
    ok('a friend gets into the lobby within a few seconds of "Connect"', annJoin.ms < 8000 && benJoin.ms < 8000, `${annJoin.ms} / ${benJoin.ms} ms`);
    ok('codes are one line of unambiguous text and fit a chat message', annJoin.invite.length < 1500 && annJoin.reply.length < 1500 && !/\s/.test(annJoin.invite + annJoin.reply));
    const hl2 = await host.until((x) => x.lobby.players.length === 3 && x.friends === 2, { what: 'three players in the host lobby' });
    ok('the host sees both friends connected', hl2.lobby.players.every((q) => q.connected) && hl2.lobby.players.map((q) => q.name).sort().join() === 'Ann,Ben,Hosty');
    const al = await ann.until((x) => x.lobby.players.length === 3, { what: 'Ann sees three players' });
    ok('a friend is a normal guest: not the host, no Start button, no room code', al.lobby.hostId !== al.me && (await ann.page.getByRole('button', { name: /Start match/ }).isHidden()) && (await ann.page.locator('.code-card').isHidden()));
    ok('and is told plainly what this game is', /Hosty's computer/.test(await ann.page.locator('.guest-card').innerText()));
    await ann.shot('65-single-guest-lobby');
    await ben.shot('66-single-phone-lobby');
    await host.shot('67-single-host-lobby-full');
    const pingSeen = await ann.until((x) => x.rtt > 0, { what: 'a measured round trip', timeout: 8000 });
    ok('guests measure a round trip over the data channel', pingSeen.rtt > 0 && pingSeen.rtt < 200, `${pingSeen.rtt.toFixed(1)} ms`);

    // Chat travels both ways.
    await ann.page.locator('.screen-lobby .chat-input').fill('hello from Ann');
    await ann.page.locator('.screen-lobby .chat-input').press('Enter');
    await host.page.locator('.screen-lobby .chat-line', { hasText: 'hello from Ann' }).waitFor({ timeout: 5000 });
    await ben.page.locator('.screen-lobby .chat-line', { hasText: 'hello from Ann' }).waitFor({ timeout: 5000 });
    ok('chat reaches the host and the other friend', true);

    // A match: rules, one bot, start.
    await H.addBot(host, 'hard');
    await H.addBot(host, 'hard');
    await H.pick(host, 'Wins needed to take the match', '1');
    await H.pick(host, 'Round time', '1:00');
    await ann.until((x) => x.lobby.settings.rounds === 1 && x.lobby.settings.roundTime === 60 && x.lobby.players.length === 5, { what: 'the rules and bots to reach Ann' });
    await H.startMatch(host);
    await Promise.all([host, ann, ben].map((p) => p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: `${p.label} in a live round`, timeout: 20000 })));
    await H.sleep(600);
    ok('every screen draws the arena', (await Promise.all([host, ann, ben].map((p) => H.canvasStats(p)))).every((s) => s.colours > 60 && s.lit > 0.3));
    await ann.shot('68-single-guest-game');
    await ben.shot('69-single-phone-game');

    // Ticks: the Room runs at 60 Hz and every friend gets ~20 snapshots a second.
    const before = await Promise.all([host, ann, ben].map((p) => p.probe()));
    await H.sleep(3000);
    const after = await Promise.all([host, ann, ben].map((p) => p.probe()));
    const tickRate = (after[0].hostTick - before[0].hostTick) / 3;
    const snapRate = [1, 2].map((i) => (after[i].stats.snapshots - before[i].stats.snapshots) / 3);
    console.log(`   host Room ${tickRate.toFixed(1)} ticks/s, snapshots ${snapRate.map((r) => r.toFixed(1)).join(' / ')} per second`);
    ok('the hosted Room ticks at 60 per second', tickRate > 54 && tickRate < 66, tickRate.toFixed(1));
    ok('each friend receives about 20 snapshots a second', snapRate.every((r) => r > 15 && r < 25), snapRate.join(' / '));

    // A friend's input reaches the host's Room: Ann's blastie moves as the host sees it, and so does the phone's.
    const moved = await H.nudge(ann);
    ok('Ann\'s keyboard moves her blastie (prediction + host Room agree)', moved !== null);
    const seenByHost = moved ? await host.until((x) => {
      const a = x.view?.players.find((q) => q.name === 'Ann');
      return a && Math.hypot(a.x - moved.from.x, a.y - moved.from.y) > 0.4;
    }, { what: 'the host seeing Ann move', timeout: 5000 }).catch(() => null) : null;
    ok('the host sees Ann move', seenByHost !== null);
    const benCdp = await ben.context.newCDPSession(ben.page);
    const benStart = (await ben.probe()).view.me;
    const box = await ben.page.locator('.bp-zone').boundingBox();
    let benMoved = false;
    for (const [dx, dy] of [[-60, 0], [60, 0], [0, -60], [0, 60]]) {
      const a = (await ben.probe()).view.me;
      if (!a.alive) break;
      await H.touchDrag(ben, benCdp, box.x + box.width / 2, box.y + box.height * 0.6, dx, dy, { hold: 450 });
      const b = (await ben.probe()).view.me;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) { benMoved = true; break; }
    }
    ok('the phone joystick moves the phone player over WebRTC', benMoved || !(await ben.probe()).view.me.alive, `${benStart.x.toFixed(1)},${benStart.y.toFixed(1)}`);

    // The host page's own timers throttled to once a second (what a hidden tab gets): the worker keeps the Room and the friends going.
    await host.page.evaluate(() => {
      const st = window.setTimeout.bind(window);
      const si = window.setInterval.bind(window);
      window.setTimeout = (fn, ms, ...a) => st(fn, Math.max(ms || 0, 1000), ...a);
      window.setInterval = (fn, ms, ...a) => si(fn, Math.max(ms || 0, 1000), ...a);
      window.requestAnimationFrame = (fn) => st(() => fn(performance.now()), 1000);
    }).catch(() => {});
    const t1 = (await host.probe()).hostTick;
    const s1 = (await ann.probe()).stats.snapshots;
    await H.sleep(3000);
    const t2 = (await host.probe()).hostTick;
    const s2 = (await ann.probe()).stats.snapshots;
    console.log(`   host page throttled to 1 Hz: Room ${((t2 - t1) / 3).toFixed(1)} ticks/s, Ann ${((s2 - s1) / 3).toFixed(1)} snapshots/s`);
    ok('with the host page throttled like a hidden tab, the Room still ticks at full pace', (t2 - t1) / 3 > 50, `${((t2 - t1) / 3).toFixed(1)} ticks/s`);
    ok('and friends still get their snapshots', (s2 - s1) / 3 > 14, `${((s2 - s1) / 3).toFixed(1)} per second`);

    // Play it out.
    await Promise.all([host, ann, ben].map((p) => p.until((x) => x.screen === 'results', { what: `${p.label} on the results screen`, timeout: 170000 })));
    const rows = await Promise.all([host, ann, ben].map((p) => p.page.locator('.standings tbody tr').count()));
    ok('all three screens reach the same results table', rows.every((n) => n === 5), rows.join(','));
    await ann.shot('70-single-guest-results');
    await host.page.getByRole('button', { name: /Back to lobby/ }).click();
    await Promise.all([host, ann, ben].map((p) => p.until((x) => x.screen === 'lobby' && x.lobby.phase === 'lobby', { what: `${p.label} back in the lobby`, timeout: 20000 })));

    // ================================================================================================
    // 3. A friend's link is cut
    // ================================================================================================
    const annBefore = await ann.probe();
    const hostPlayersBefore = (await host.probe()).lobby.players.length;
    await ann.page.evaluate(() => window.__bp.dropLink());
    await ann.page.getByRole('heading', { name: 'Connection lost' }).waitFor({ timeout: 8000 });
    ok('a cut link says "Connection lost" and offers a new code instead of spinning', await ann.page.getByRole('button', { name: /Rejoin with a new code/ }).isVisible());
    await ann.shot('71-single-connection-lost');
    const away = await host.until((x) => x.lobby.players.find((q) => q.name === 'Ann')?.connected === false, { what: 'the host noticing Ann is gone', timeout: 10000 });
    ok('the host sees Ann as reconnecting, her seat is kept', away.lobby.players.length === hostPlayersBefore);
    await ann.page.getByRole('button', { name: /Rejoin with a new code/ }).click();
    await host.page.getByRole('button', { name: 'Add a friend' }).click();
    const invite2 = await codeOf(host.page.locator('.modal-p2p .code-box[readonly]'));
    await ann.page.locator('#invite-input').fill(invite2);
    await ann.page.getByRole('button', { name: 'Continue' }).click();
    const reply2 = await codeOf(ann.page.locator('.modal-p2p .code-box[readonly]'));
    await host.page.locator('#reply-input').fill(reply2);
    const t3 = Date.now();
    await host.page.getByRole('button', { name: 'Connect' }).click();
    const back = await ann.until((x) => x.screen === 'lobby' && x.joined && x.ws === 1, { what: 'Ann back in the lobby', timeout: 40000 });
    console.log(`   re-handshake ${Date.now() - t3} ms`);
    ok('the same token brings the same character back', back.me === annBefore.me, `${annBefore.me} -> ${back.me}`);
    const hostAgain = await host.until((x) => x.lobby.players.find((q) => q.name === 'Ann')?.connected === true, { what: 'the host seeing Ann again' });
    ok('the host still has three players, no duplicate Ann', hostAgain.lobby.players.length === hostPlayersBefore && hostAgain.lobby.players.filter((q) => q.name === 'Ann').length === 1);
    await ann.shot('72-single-rejoined');

    // ================================================================================================
    // 4. A friend leaves, then the host ends the game
    // ================================================================================================
    await ben.page.getByRole('button', { name: /Leave/ }).first().click();
    await ben.until((x) => x.screen === 'title', { what: 'the phone back on the title screen' });
    const humans = (x) => x.lobby.players.filter((q) => !q.isBot);
    const left = await host.until((x) => humans(x).length === 2, { what: 'the host seeing Ben leave', timeout: 8000 });
    ok('a friend who presses Leave frees the seat at once (no "reconnecting" ghost)', humans(left).map((q) => q.name).sort().join() === 'Ann,Hosty');
    await host.page.getByRole('button', { name: /Leave/ }).first().click();
    await host.shot('73-single-host-end-confirm');
    await host.page.getByRole('button', { name: 'End the game' }).click();
    await host.until((x) => x.screen === 'title', { what: 'the host back on the title screen' });
    await ann.page.getByRole('heading', { name: 'The host ended the game' }).waitFor({ timeout: 10000 });
    ok('when the host leaves, the friends get "The host ended the game"', true);
    await ann.shot('74-single-host-ended');
    await ann.page.getByRole('button', { name: 'OK' }).click();
    ok('and land on the title screen', (await ann.until((x) => x.screen === 'title', { what: 'Ann on the title screen' })).screen === 'title');

    for (const p of [host, ann, ben]) await p.context.close();

    // ================================================================================================
    // 5. A reply that never connects: the friend went away after making the code (a strict network looks the same)
    // ================================================================================================
    const h2 = await open('host2', { init: () => { window.__BP_P2P_TEST__ = { connectMs: 5000 }; } });
    const ghost = await open('ghost');
    await setName(h2, 'Hosty2');
    await h2.page.getByRole('button', { name: /Host a game/ }).click();
    await h2.until((x) => x.screen === 'lobby' && x.joined, { what: 'the second host lobby' });
    await h2.page.getByRole('button', { name: 'Add a friend' }).click();
    const inviteX = await codeOf(h2.page.locator('.modal-p2p .code-box[readonly]'));
    await setName(ghost, 'Ghost');
    await ghost.page.getByRole('button', { name: /Join a friend's game/ }).click();
    await ghost.page.locator('#invite-input').fill(inviteX);
    await ghost.page.getByRole('button', { name: 'Continue' }).click();
    const replyX = await codeOf(ghost.page.locator('.modal-p2p .code-box[readonly]'));
    await ghost.context.close();
    await h2.page.locator('#reply-input').fill(replyX);
    await h2.page.getByRole('button', { name: 'Connect' }).click();
    await h2.page.locator('.modal-p2p .p2p-status[data-kind="error"]').waitFor({ timeout: 20000 });
    const failText = await h2.page.locator('.modal-p2p .p2p-status').innerText();
    ok('a connection that never happens ends with a plain explanation and the server-mode advice', /does not work on every network/.test(failText) && /npm start/.test(failText) && /New code/.test(failText), failText);
    await h2.shot('75-single-connect-failed');
    await h2.page.getByRole('button', { name: 'New code' }).click();
    const inviteY = await codeOf(h2.page.locator('.modal-p2p .code-box[readonly]'));
    ok('"New code" makes a different invite so the player can try again', inviteY !== inviteX);
    await h2.context.close();

    // ================================================================================================
    // 6. No Workers at all: the host still works with plain timers, and says what that costs
    // ================================================================================================
    const plain = await open('plain', { noWorker: true });
    await setName(plain, 'Plain');
    await plain.page.getByRole('button', { name: /Host a game/ }).click();
    const pl = await plain.until((x) => x.screen === 'lobby' && x.joined, { what: 'a host lobby without Workers' });
    ok('without Web Workers hosting falls back to plain timers', pl.ticker === 'timers', pl.ticker);
    await H.addBot(plain, 'easy');
    await H.pick(plain, 'Round time', '1:00');
    await H.startMatch(plain);
    await plain.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'a live round on plain timers', timeout: 20000 });
    const p1 = (await plain.probe()).hostTick;
    await H.sleep(2000);
    const p2 = (await plain.probe()).hostTick;
    ok('and the Room still ticks (visible page)', (p2 - p1) / 2 > 50, `${((p2 - p1) / 2).toFixed(1)} ticks/s`);
    await plain.context.close();

    // ================================================================================================
    // 8. The reply is pasted late; a locked game turns the friend away and the host is told; a friend dropped MID-MATCH is added back
    //    from the in-game menu; the host closing the page tells the friend
    // ================================================================================================
    const h3 = await open('host3');
    const late = await open('late', { init: () => { window.__BP_P2P_TEST__ = { connectMs: 4000 }; } });     // (a friend whose connect clock is only 4 s long)
    h3.page.on('dialog', (d) => d.accept().catch(() => {}));                                             // (the leave-page prompt of a host with friends)
    await setName(h3, 'Hosty3');
    await h3.page.getByRole('button', { name: /Host a game/ }).click();
    await h3.until((x) => x.screen === 'lobby' && x.joined, { what: 'the third host lobby' });
    await h3.page.getByRole('button', { name: 'Add a friend' }).click();
    const invite3 = await codeOf(h3.page.locator('.modal-p2p .code-box[readonly]'));
    ok('the Add a friend dialog tells the host the friend needs the file too', /own copy of the blast-party\.html/.test(await h3.page.locator('.modal-p2p').innerText()));
    await setName(late, 'Late');
    await late.page.getByRole('button', { name: /Join a friend's game/ }).click();
    await late.page.locator('#invite-input').fill(invite3);
    await late.page.getByRole('button', { name: 'Continue' }).click();
    const reply3 = await codeOf(late.page.locator('.modal-p2p .code-box[readonly]'));
    await H.sleep(11000);                                                                                // a chat-app round trip: far longer than the friend's own 4 s connect clock
    const lateStatus = await late.page.locator('.modal-p2p .p2p-status').innerText();
    ok('a friend still waiting after 11 s is not told the network failed', !(await late.page.locator('.modal-p2p .p2p-status[data-kind="error"]').count()) && !/does not work on every network/.test(lateStatus), lateStatus);
    await late.shot('80-single-late-waiting');
    await h3.page.locator('#reply-input').fill(reply3);
    await h3.page.getByRole('button', { name: 'Connect' }).click();
    const lateIn = await late.until((x) => x.screen === 'lobby' && x.joined, { what: 'Late in the lobby after pasting 11 s late', timeout: 40000 });
    ok('and a reply pasted 11 s late still joins', lateIn.joined === true);

    // A locked game: the friend hears "locked", and so does the host (their dialog used to hang on "Getting your friend into the lobby").
    await h3.page.locator('.switch-row', { hasText: 'Lock room' }).getByRole('switch').click();
    await h3.until((x) => x.lobby.settings.locked === true, { what: 'the game locked' });
    ok('the lobby says why "Add a friend" is pointless while locked', /locked/.test(await h3.page.locator('.friend-card:not(.guest-card) .friend-note').innerText()));
    const turned = await open('turned');
    await h3.page.getByRole('button', { name: 'Add a friend' }).click();
    ok('and so does the dialog', (await h3.page.locator('.modal-p2p .code-warn').count()) === 1);
    const invite4 = await codeOf(h3.page.locator('.modal-p2p .code-box[readonly]'));
    await setName(turned, 'Turned');
    await turned.page.getByRole('button', { name: /Join a friend's game/ }).click();
    await turned.page.locator('#invite-input').fill(invite4);
    await turned.page.getByRole('button', { name: 'Continue' }).click();
    await h3.page.locator('#reply-input').fill(await codeOf(turned.page.locator('.modal-p2p .code-box[readonly]')));
    await h3.page.getByRole('button', { name: 'Connect' }).click();
    await turned.page.locator('.form-error').waitFor({ timeout: 20000 });                                // (the join dialog sat on the title screen; the error appears once the Room said no)
    ok('a friend turned away by a locked game is told so', /locked/.test(await turned.page.locator('.form-error').innerText()), await turned.page.locator('.form-error').innerText());
    await h3.page.locator('.modal-p2p .p2p-status[data-kind="error"]').waitFor({ timeout: 10000 });
    const refusedText = await h3.page.locator('.modal-p2p .p2p-status').innerText();
    ok('the host is told too, with what to do', /locked/.test(refusedText) && /Lock room/.test(refusedText), refusedText);
    ok('and can press Connect again', await h3.page.getByRole('button', { name: 'Connect' }).isEnabled());
    await h3.shot('81-single-host-refused');
    await h3.page.locator('.modal-p2p .dialog-actions button').click();
    await turned.context.close();
    await h3.page.locator('.switch-row', { hasText: 'Lock room' }).getByRole('switch').click();

    // Mid-match: the friend's link dies, the host adds them back from the in-game menu, the same character returns.
    await H.addBot(h3, 'hard');
    await H.pick(h3, 'Wins needed to take the match', '1');
    await H.pick(h3, 'Round time', '1:00');
    await H.startMatch(h3);
    await Promise.all([h3, late].map((p) => p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: `${p.label} in a live round`, timeout: 20000 })));
    const lateId = (await late.probe()).me;
    await late.page.evaluate(() => window.__bp.dropLink());
    await late.page.getByRole('heading', { name: 'Connection lost' }).waitFor({ timeout: 8000 });
    ok('the Connection lost text names the real possibilities', /closed or reloaded/.test(await late.page.locator('.dialog-text').innerText()));
    await late.page.getByRole('button', { name: /Rejoin with a new code/ }).click();
    await h3.page.keyboard.press('Escape');
    await h3.page.locator('.modal-menu').getByRole('button', { name: 'Add a friend' }).click();
    const invite5 = await codeOf(h3.page.locator('.modal-p2p .code-box[readonly]'));
    await h3.shot('82-single-host-menu-add-friend');
    await late.page.locator('#invite-input').fill(invite5);
    await late.page.getByRole('button', { name: 'Continue' }).click();
    await h3.page.locator('#reply-input').fill(await codeOf(late.page.locator('.modal-p2p .code-box[readonly]')));
    await h3.page.getByRole('button', { name: 'Connect' }).click();
    const lateBack = await late.until((x) => x.screen === 'game' && x.joined && x.ws === 1, { what: 'Late back in the running match', timeout: 40000 });
    ok('a friend dropped mid-match is added back from the host menu and keeps the same character', lateBack.me === lateId, `${lateId} -> ${lateBack.me}`);
    await late.shot('83-single-rejoined-mid-match');

    // The host closes the page: the friend is told the game is over (not "you will get your character back").
    await h3.page.reload().catch(() => {});
    const endedAt = Date.now();
    await late.page.getByRole('heading', { name: /The host ended the game|Connection lost/ }).waitFor({ timeout: 15000 });
    const endedHeading = await late.page.getByRole('heading', { name: /The host ended the game|Connection lost/ }).innerText();
    ok('when the host reloads the page the friend hears "The host ended the game"', endedHeading === 'The host ended the game', `${endedHeading} after ${Date.now() - endedAt} ms`);
    await late.context.close();
    await h3.context.close();

    // ================================================================================================
    // 7. The smallest phone (320 px): nothing runs off the side, the code dialogs scroll instead
    // ================================================================================================
    const tiny = await open('tiny', { phone: true, small: true });
    const overflow = (p) => p.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    ok('the title screen fits 320 px wide', (await overflow(tiny)) <= 0, String(await overflow(tiny)));
    await tiny.shot('76-single-tiny-title');
    await setName(tiny, 'Tiny');
    await tiny.page.getByRole('button', { name: /Host a game/ }).click();
    await tiny.until((x) => x.screen === 'lobby' && x.joined, { what: 'the tiny host lobby' });
    ok('the host lobby fits 320 px wide', (await overflow(tiny)) <= 0, String(await overflow(tiny)));
    await tiny.shot('77-single-tiny-lobby');
    await tiny.page.getByRole('button', { name: 'Add a friend' }).click();
    await codeOf(tiny.page.locator('.modal-p2p .code-box[readonly]'));
    const modalBox = await tiny.page.locator('.modal-p2p').boundingBox();
    ok('the Add a friend dialog fits 320 px wide and the page behind it does not scroll sideways', modalBox.x >= 0 && modalBox.x + modalBox.width <= 320 && (await overflow(tiny)) <= 0, JSON.stringify(modalBox));
    ok('its buttons are big enough to tap (at least 44 px tall)', await tiny.page.evaluate(() => [...document.querySelectorAll('.modal-p2p .btn-lg')].filter((b) => b.getClientRects().length > 0).every((b) => b.getBoundingClientRect().height >= 44)));
    await tiny.shot('78-single-tiny-add-friend');
    await tiny.context.close();

    ok('the whole session made no request outside the file', requests.every((u) => !isExternal(u)) && external.length === 0, external.slice(0, 3).join(', '));
    ok('no console errors, warnings or uncaught exceptions on any page', problems.length === 0, problems.slice(0, 6).join(' | '));
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
  }
}
