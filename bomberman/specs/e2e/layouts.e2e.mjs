// More layouts and roles in a real browser (docs/SPEC.md 8.3, 8.6): a phone on its side with 8 fighters and left-handed controls,
// the host leaving in the middle of a match, and a system that asks for reduced motion.
import * as H from '../helpers/e2e-harness.js';

export const name = 'layouts: landscape phone, left-handed controls, host leaves mid-match, reduced motion';

export default async function layouts({ base, browser, playwright, ok }) {
  const problems = [];

  const land = await H.openPlayer({ browser, playwright, base, label: 'land', problems, device: { viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: playwright.devices['Pixel 5'].userAgent } });
  await H.createRoom(land, 'Side');
  for (const level of ['easy', 'normal', 'hard', 'easy', 'normal', 'hard', 'easy']) await H.addBot(land, level);
  await H.startMatch(land);
  await land.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'landscape playing', timeout: 20000 });
  await H.sleep(500);
  await land.shot('49-game-landscape');
  const emoteHidden = await land.page.locator('.bp-emote').isHidden();
  ok('on a short landscape screen the touch emote button steps aside for the chips (the HUD has its own)', emoteHidden);
  const hudEmote = await land.page.locator('.emote-btn').isVisible();
  ok('the HUD emote button is still there', hudEmote);
  // left-handed: the joystick and BOMB swap sides
  await land.page.getByRole('button', { name: 'Menu' }).click();
  await land.page.getByRole('button', { name: 'Settings' }).click();
  await land.page.getByRole('radio', { name: 'Left-handed' }).click();
  await land.page.getByRole('button', { name: 'Done' }).click();
  await land.page.getByRole('button', { name: 'Back to the game' }).click();
  await H.sleep(300);
  const bombBox = await land.page.locator('.bp-bomb').boundingBox();
  ok('left-handed play moves BOMB to the left half of the screen', bombBox && bombBox.x + bombBox.width / 2 < 370, JSON.stringify(bombBox));
  await land.shot('50-game-landscape-left');
  await land.close();

  // ---- The host leaves in the middle of a match: the next player becomes host and is told
  const h1 = await H.openPlayer({ browser, playwright, base, label: 'h1', problems });
  const h2 = await H.openPlayer({ browser, playwright, base, label: 'h2', problems });
  const hostRoom = await H.createRoom(h1, 'Old host');
  await H.joinByLink(h2, hostRoom, 'Heir');
  await H.addBot(h1, 'easy');
  await H.pick(h1, 'Round time', '4:00');
  await H.startMatch(h1);
  for (const p of [h1, h2]) await p.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: `${p.label} playing`, timeout: 20000 });
  // A latecomer joins the running match: they watch this round (a "waiting" spectator) and fight from the next one.
  const late = await H.openPlayer({ browser, playwright, base, label: 'late', problems });
  await H.joinByLink(late, hostRoom, 'Late', { screen: 'game' });
  const watching = await late.until((x) => x.screen === 'game' && x.view && x.view.players.length === 3, { what: 'the latecomer to see the running round', timeout: 15000 });
  ok('a latecomer sees the running match as a spectator (not one of its fighters)', watching.view.me === null && watching.lobby.players.find((q) => q.name === 'Late')?.waiting === true);
  ok('and is told they are only watching', await late.page.getByText('You are watching this round').isVisible());
  await H.sleep(600);
  const spectatorCanvas = await H.canvasStats(late);
  ok('the spectator sees the arena drawn', spectatorCanvas.colours > 60 && spectatorCanvas.lit > 0.35, JSON.stringify(spectatorCanvas));
  await late.page.keyboard.press('Space');
  await late.page.keyboard.down('ArrowRight');
  await H.sleep(300);
  await late.page.keyboard.up('ArrowRight');
  ok('a spectator sends no moves or bombs (nothing to predict)', (await late.probe()).view.ghosts === 0);
  await late.shot('52-spectator');
  await h1.page.keyboard.press('Escape');
  await h1.page.getByRole('button', { name: 'Leave match' }).click();
  await h1.until((x) => x.screen === 'title', { what: 'the old host on the title screen' });
  const heir = await h2.until((x) => x.lobby.hostId === x.me, { what: 'the heir to be host', timeout: 8000 });
  ok('when the host leaves mid-match the next human becomes host', heir.lobby.hostId === heir.me);
  ok('the new host is told with a toast', await h2.page.locator('.toast').filter({ hasText: 'is now the host' }).first().isVisible().catch(() => false));
  // The round ends (bots against idle humans), the next one starts and the latecomer is a fighter now.
  const next = await late.until((x) => x.round && x.round.n >= 2 && x.view && x.view.me !== null, { what: 'the latecomer to become a fighter in round 2', timeout: 150000 }).catch(() => null);
  ok('the latecomer becomes a fighter when the next round starts', !!next && next.lobby.players.find((q) => q.name === 'Late')?.waiting === false);
  await late.shot('53-late-fighter');
  await late.close();
  await h2.page.keyboard.press('Escape');
  ok('and gets the host-only menu entry', await h2.page.getByRole('button', { name: /End match for all/ }).isVisible());
  await h2.shot('51-new-host-menu');
  await h2.page.keyboard.press('Escape');
  await h1.close();
  await h2.close();

  // ---- A system that asks for reduced motion starts with reduced effects
  const calm = await H.openPlayer({ browser, playwright, base, label: 'calm', problems, device: { viewport: { width: 1000, height: 700 }, reducedMotion: 'reduce' } });
  const calmSettings = (await calm.probe()).settings;
  ok('prefers-reduced-motion starts the game with "Reduce effects" on', calmSettings.reduce === true);
  await H.typeName(calm, 'Calm');
  await calm.page.getByRole('button', { name: /Practice vs bots/ }).click();
  await calm.until((x) => x.screen === 'lobby' && x.lobby.players.length === 4, { what: 'the practice lobby' });
  await H.startMatch(calm);
  await calm.until((x) => x.screen === 'game' && x.view && x.view.state === 1, { what: 'the calm player in the arena', timeout: 15000 });
  await H.sleep(500);
  const calmProbe = await calm.probe();
  ok('the renderer honours it', calmProbe.render.reduced === true && calmProbe.render.errors.length === 0);
  await calm.close();

  ok('no console errors, warnings or uncaught exceptions', problems.length === 0, problems.slice(0, 4).join(' | '));
}
