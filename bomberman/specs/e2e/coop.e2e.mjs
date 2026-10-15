// The co-op modes in Practice (docs/SPEC.md Appendix C): an Adventure played through its first level (monsters on the board, the
// shared lives and the door in the HUD, the level-clear sound, level 2 built with its intro), then a Co-op vs bots match of one wave
// played to the results screen (enemy bots in the round, the team card on the results).
//
// The helper bots do the playing; `__bp.fastForward(ticks)` (DEBUG builds, Practice only) runs the in-page Room ahead so a level takes
// seconds. A key press now and then stands in for a person at the keyboard (an idle match closes after 5 minutes of Room time).
import * as H from '../helpers/e2e-harness.js';

export const name = 'co-op: Adventure level 1 to level 2, and a Co-op vs bots wave to the results, in Practice';

async function openPractice(browser, playwright, base, label, problems) {
  const p = await H.openPlayer({ browser, playwright, base, label, problems });
  await H.typeName(p, 'Kid');
  await p.page.getByRole('button', { name: /Practice vs bots/ }).click();
  await p.until((x) => x.screen === 'lobby' && x.lobby && x.lobby.players.length === 4, { what: 'the practice lobby' });
  return p;
}

/** Runs the Room ahead in chunks until `done(probe)` holds; returns the last probe (or null after `max` chunks). */
async function playUntil(p, done, { chunk = 120, max = 300 } = {}) {
  for (let i = 0; i < max; i++) {
    const probe = await p.probe();
    if (done(probe)) return probe;
    if (i % 10 === 0 && probe.screen === 'game') await p.page.keyboard.press(i % 20 === 0 ? 'ArrowLeft' : 'ArrowRight');
    await p.page.evaluate((n) => window.__bp.fastForward(n), chunk);
    await H.sleep(40);
  }
  return null;
}

export default async function coop({ base, browser, playwright, ok }) {
  // ---- Adventure
  const problems = [];
  const a = await openPractice(browser, playwright, base, 'adventure', problems);
  await H.pick(a, 'Mode', 'Adventure');
  await a.until((x) => x.lobby.settings.mode === 'adventure', { what: 'adventure mode' });
  await H.pick(a, 'Difficulty', 'Easy');
  await a.until((x) => x.lobby.settings.difficulty === 'easy', { what: 'easy difficulty' });
  ok('Adventure hides the settings it does not use (wins needed, round time, layout)',
    (await a.page.getByRole('radiogroup', { name: 'Round time' }).isHidden()) && (await a.page.getByRole('radiogroup', { name: 'Arena layout' }).isHidden()));
  ok('the lobby explains the mode', /monsters/i.test(await a.page.locator('.mode-help').textContent()));
  ok('lobby bots become helpers', /Helper/.test(await a.page.locator('.lobby-card, .players-card, body').first().textContent()));
  await a.shot('60-adventure-lobby');

  await H.startMatch(a);
  const intro = await a.until((x) => x.screen === 'game' && x.round && x.round.coop, { what: 'level 1' });
  ok('the round message says level 1 of 8', intro.round.mode === 'adventure' && intro.round.coop.level === 1 && intro.round.coop.of === 8, JSON.stringify(intro.round.coop));
  ok('the intro card introduces the level', await a.page.locator('.stage-intro').isVisible().catch(() => false));
  const live = await a.until((x) => x.view && x.view.state === 1 && x.view.monsters > 0, { what: 'monsters on the board', timeout: 9000 });
  ok('monsters roam the level and the team shares lives', live.view.monsters >= 2 && live.view.coop && live.view.coop.lives >= 1, JSON.stringify(live.view.coop));
  ok('the HUD shows the co-op pills', await a.page.locator('.hud-coop').isVisible());
  await H.sleep(500);
  const stats = await H.canvasStats(a);
  ok('the adventure arena is drawn', stats.colours > 60 && stats.lit > 0.3, JSON.stringify(stats));
  await a.shot('61-adventure-play');

  const cleared = await playUntil(a, (x) => (x.sounds.level_clear ?? 0) > 0 || (x.sounds.game_over ?? 0) > 0);
  ok('the helpers clear level 1 (the level-clear jingle plays)', cleared && (cleared.sounds.level_clear ?? 0) > 0, JSON.stringify(cleared?.sounds ?? null));
  ok('monsters were popped on the way', cleared && (cleared.counts.mdeath ?? 0) >= 2 && (cleared.counts.exit ?? 0) === 1, JSON.stringify(cleared?.counts ?? null));
  await a.shot('62-adventure-clear');
  const next = await playUntil(a, (x) => x.round && x.round.coop && x.round.coop.level === 2 && x.view && x.view.state === 0, { chunk: 20, max: 200 });
  ok('level 2 follows with its intro', !!next && await a.page.locator('.stage-intro').isVisible().catch(() => false));
  await a.shot('63-adventure-level2');
  ok('no page errors in Adventure', problems.length === 0, problems.slice(0, 3).join(' | '));
  await a.page.close();

  // ---- Co-op vs bots
  const problems2 = [];
  const c = await openPractice(browser, playwright, base, 'coop', problems2);
  await H.pick(c, 'Mode', 'Co-op vs bots');
  await c.until((x) => x.lobby.settings.mode === 'coop', { what: 'coop mode' });
  await H.pick(c, 'Waves to beat', '1');
  await H.pick(c, 'Difficulty', 'Easy');
  await c.until((x) => x.lobby.settings.rounds === 1 && x.lobby.settings.difficulty === 'easy', { what: 'one easy wave' });
  await H.startMatch(c);
  const wave = await c.until((x) => x.screen === 'game' && x.round && x.round.coop, { what: 'wave 1' });
  ok('wave 1 adds enemy bots to the round', wave.round.mode === 'coop' && wave.round.coop.level === 1 && wave.round.fighters > 4, JSON.stringify(wave.round));
  await c.until((x) => x.view && x.view.state === 1, { what: 'the wave to go live', timeout: 9000 });
  await c.shot('64-coop-play');
  const over = await playUntil(c, (x) => x.screen === 'results', { chunk: 240, max: 200 });
  ok('the wave is played to the results screen', !!over);
  const won = over && (over.sounds.victory ?? 0) > 0;
  ok('the run ends in victory or game over, with its sound', over && ((over.sounds.victory ?? 0) + (over.sounds.game_over ?? 0)) === 1, JSON.stringify(over?.sounds ?? null));
  ok('the results show the team card with the waves', (await c.page.locator('.team-card').isVisible()) && /waves/i.test(await c.page.locator('.team-card').textContent()));
  ok('the results headline matches the outcome', (await c.page.locator('.results-head').textContent()).includes(won ? 'Victory' : 'Game over'),
    await c.page.locator('.results-head').textContent());
  await c.shot('65-coop-results');
  ok('no page errors in Co-op vs bots', problems2.length === 0, problems2.slice(0, 3).join(' | '));
  await c.page.close();
}
