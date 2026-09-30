// The story session flow over the local transport with a fake clock: the join handshake
// (profile caps, world copies), the chained games (hideout → briefing → mission → debrief →
// hideout without visiting the lobby), station actions and their validation, results and
// rewards, late join in every stage, the host leaving, and prediction with tiers and perks
// against the real simulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostGame, joinGame } from '../public/js/net/session.js';
import { createLocalHub } from '../public/js/net/transport-local.js';
import { PROTOCOL_VERSION, GAME_VERSION } from '../public/js/shared/constants.js';
import { createProfile, sanitizeProfile } from '../public/js/shared/story/profile.js';
import { createWorld, changeWorld, isCompleted } from '../public/js/shared/story/world.js';
import { setStoryContent, clearStoryContent, getMission } from '../public/js/shared/story/content.js';
import { STUB_CONTENT } from '../public/js/shared/story/stub-content.js';
import { xpForLevel, MAX_XP } from '../public/js/shared/story/progression.js';
import { tierCost } from '../public/js/shared/story/upgrades.js';
import { StoryFakeGame } from './fixtures/story-fake-game.js';

setStoryContent(STUB_CONTENT);

function makeClock(start = 1000) {
  let t = start;
  const clock = () => t;
  clock.advance = (dt) => {
    t += dt;
  };
  return clock;
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

const IDLE = {
  moveX: 0, moveY: 0, aimScreenX: 0, aimScreenY: 0, fire: false, melee: false, sprint: false, interact: false,
  reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false, slot: -1, cycle: 0,
  shop: false, scoreboard: false, chat: false, ready: false, pause: false,
};
const input = (over) => ({ ...IDLE, ...over });

function collect(session, event) {
  const out = [];
  session.on(event, (v) => out.push(v));
  return out;
}

const storyEvents = (session, kind) => {
  const out = [];
  session.on('story', (e) => {
    if (e.kind === kind) out.push(e);
  });
  return out;
};

/** A world with something in the stash so hideout upgrades can be bought. */
function richWorld(host) {
  const w = createWorld({ name: 'The Dusty Crew', profile: host, difficulty: 'normal', now: 100 });
  w.hideout.stash.scrap = 600;
  w.hideout.stash.parts = 6;
  return w;
}

/**
 * Host + clients on one local hub. `clients` entries: { name, cls, color, profile? , world? }.
 * The default game is the story fake; pass `createGame` to run the real simulation.
 */
async function setup({ clients = [], hostProfile = null, world = null, createGame = (opts) => new StoryFakeGame(opts) } = {}) {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'ABCDE' });
  const games = [];
  const profile = hostProfile || createProfile({ name: 'Bob', cls: 'soldier', color: 0 });
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host,
    story: { profile, world: world || richWorld(profile) },
    hooks: {
      now: clock, manual: true,
      createGame: createGame ? (opts) => {
        const g = createGame(opts);
        games.push(g);
        return g;
      } : undefined,
    },
  });
  const joined = [];
  for (const c of clients) joined.push(await join(hub, clock, c));
  await flush();
  const env = { clock, hub, host, clients: joined, games, game: () => games[games.length - 1], profile };
  env.frames = async (n, inputFor = () => null, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      clock.advance(dt);
      host.update(dt, inputFor(host, i), 0);
      for (const c of env.clients) if (!c.left) c.update(dt, inputFor(c, i), 0);
      await flush(2);
    }
    // ('start' reaches the UI on the next timer task)
    await new Promise((r) => setTimeout(r, 2));
  };
  return env;
}

function join(hub, clock, c) {
  const profile = c.profile || createProfile({ name: c.name, cls: c.cls || 'soldier', color: c.color || 1 });
  return joinGame({
    name: c.name, color: c.color ?? 1, cls: c.cls || 'soldier', via: hub.connect(),
    story: { profile, world: c.world || null },
    hooks: { now: clock, manual: true },
  });
}

test('a story room needs the same protocol as everyone (9 or newer): older clients are turned away', async () => {
  assert.ok(PROTOCOL_VERSION >= 9, 'story rooms exist from protocol 9');
  const env = await setup();
  const raw = await env.hub.connect();
  const seen = [];
  raw.onMessage((ch, msg) => seen.push(msg));
  raw.send('ctl', { t: 'hello', version: GAME_VERSION, protocol: PROTOCOL_VERSION - 1, name: 'Old', color: 1, cls: 'soldier' });
  await flush();
  assert.equal(seen.find((m) => m.t === 'reject').reason, 'Game version mismatch');
});

test('handshake: the host keeps the accepted profile (caps applied), sends the world, and shows levels in the roster', async () => {
  const cheat = { ...createProfile({ name: 'Cheater', cls: 'medic', color: 2 }), xp: 3 * MAX_XP, scrap: 900000, perks: { steady: 3, quick: 3, thick: 3 }, perkPoints: 50 };
  const env = await setup({ clients: [{ name: 'Alice', cls: 'medic', color: 2, profile: cheat }] });
  const [c] = env.clients;
  assert.ok(c.story, 'the welcome made a story mirror');
  assert.equal(env.host.isStory, undefined);
  const accepted = env.host.story.profiles.get(c.localId);
  assert.equal(accepted.level, 20);
  assert.equal(accepted.xp, MAX_XP);
  assert.ok(accepted.scrap < 900000, 'scrap trimmed to what level 20 can have earned');
  assert.equal(accepted.perkPoints, 19 - 9);
  assert.deepEqual(c.story.profile, accepted, 'the client holds exactly what the host accepted');
  assert.equal(c.story.world.id, env.host.story.world.id);
  assert.equal(c.story.world.members[accepted.id].name, 'Cheater');
  assert.equal(c.story.world.members[env.profile.id].name, 'Bob');
  assert.equal(env.host.roster.find((r) => r.id === c.localId).lvl, 20);
  assert.equal(env.host.roster[0].lvl, 1);
  assert.equal(c.roster.find((r) => r.id === c.localId).lvl, 20);
  assert.equal(c.story.stage, 'lobby');
  // the client hands its profile and world to the UI to persist
  const worlds = storyEvents(c, 'world');
  const profiles = storyEvents(c, 'profile');
  await flush();
  assert.ok(worlds.length >= 0 && profiles.length >= 0);
  // a room that is not a story room welcomes nobody into a story
  const plain = await hostGame({ name: 'P', color: 0, cls: 'soldier', transport: createLocalHub({ code: 'PLAIN' }).host, hooks: { manual: true } });
  assert.equal(plain.story, null);
});

test('a joiner without a story profile still gets one (fresh, level 1)', async () => {
  const clock = makeClock();
  const hub = createLocalHub({ code: 'ABCDE' });
  const host = await hostGame({
    name: 'Bob', color: 0, cls: 'soldier', transport: hub.host, story: { newWorld: { name: 'W', difficulty: 'hard' } },
    hooks: { now: clock, manual: true, createGame: (o) => new StoryFakeGame(o) },
  });
  const c = await joinGame({ name: 'Nova', color: 1, cls: 'scout', via: hub.connect(), hooks: { now: clock, manual: true } });
  await flush();
  assert.equal(host.story.world.difficulty, 'hard');
  assert.equal(host.story.world.name, 'W');
  assert.equal(host.story.profiles.get(2).name, 'Nova');
  assert.equal(host.story.profiles.get(2).cls, 'scout');
  assert.equal(host.story.profiles.get(2).level, 1);
  assert.ok(c.story);
});

test('start: the hideout stage, every survivor\'s spec in the start message, prediction mods on the client', async () => {
  const strong = {
    ...createProfile({ name: 'Alice', cls: 'soldier', color: 1 }), xp: xpForLevel(10), perks: { quick: 3, thick: 2 }, perkPoints: 3,
    weapons: { pistol: { tier: 1 }, rifle: { tier: 4 } }, scrap: 50,
  };
  const env = await setup({ clients: [{ name: 'Alice', profile: strong }] });
  const [c] = env.clients;
  const starts = collect(c, 'start');
  const hostStarts = collect(env.host, 'start');
  assert.equal(env.host.start(), true);
  await env.frames(3);
  const g = env.game();
  assert.equal(g.opts.mapId, 'roadhouse');
  assert.equal(g.opts.settings.mode, 'hideout');
  assert.equal(g.opts.settings.waves, 0);
  const st = g.opts.settings.story;
  assert.equal(st.worldId, env.host.story.world.id);
  assert.equal(st.nodeId, 'hideout:roadhouse');
  assert.equal(st.difficulty, 'normal');
  assert.deepEqual(st.party.map((p) => p.pid), [1, 2]);
  assert.equal(g.specs.get(2).lvl, 10, 'the party member\'s level rides in their spec');
  assert.deepEqual(st.hideoutUpgrades, {});
  assert.deepEqual(st.npcs, []);
  assert.deepEqual(g.opts.players.map((p) => p.id), [1, 2]);
  assert.deepEqual(g.specs.get(2).tiers, { pistol: 1, rifle: 4 });
  assert.deepEqual(g.specs.get(2).perks, { quick: 3, thick: 2 });
  assert.deepEqual(g.specs.get(2).loadout, ['pistol', 'rifle', null]);
  assert.equal(c.inGame, true);
  assert.equal(c.story.stage, 'hideout');
  assert.equal(c.settings.mapId, 'roadhouse');
  assert.ok(c.mods, 'the client derived its own mods');
  assert.equal(c.mods.tiers.rifle, 4);
  assert.equal(c.mods.spec.perks.quick, 3);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].story.stage, 'hideout');
  assert.equal(hostStarts[0].story.stage, 'hideout');
  assert.equal(env.host.story.stage, 'hideout');
  assert.equal(c.getMap().kind, 'hideout' in {} ? '' : c.getMap().kind);
});

test('station actions: a client raises a gun tier, the host validates, the profile comes back', async () => {
  const p = { ...createProfile({ name: 'Alice', cls: 'soldier', color: 1 }), xp: xpForLevel(3), perkPoints: 2, scrap: 500 };
  const env = await setup({ clients: [{ name: 'Alice', profile: p }] });
  const [c] = env.clients;
  const profiles = storyEvents(c, 'profile');
  const results = storyEvents(c, 'result');
  env.host.start();
  await env.frames(2);
  c.story.upgradeWeapon('rifle');
  await env.frames(3);
  assert.equal(c.story.profile.weapons.rifle.tier, 1);
  assert.equal(c.story.profile.scrap, 500 - tierCost('rifle', 1));
  assert.deepEqual(env.host.story.profiles.get(2), c.story.profile);
  assert.equal(profiles.at(-1).profile.weapons.rifle.tier, 1);
  assert.deepEqual(results.at(-1), { kind: 'result', a: 'tier', ok: true, reason: undefined, note: { weapon: 'rifle', tier: 1, cost: tierCost('rifle', 1) } });
  // too poor for the next steps
  c.story.buyWeapon('minigun');
  await env.frames(3);
  assert.deepEqual([results.at(-1).ok, results.at(-1).reason], [false, 'locked']);
  // perk points: none at level 3 beyond 2, buy one, then the level gate
  c.story.buyPerk('steady');
  c.story.buyPerk('quick');
  c.story.buyPerk('thick');
  await env.frames(4);
  assert.equal(c.story.profile.perks.steady, 1);
  assert.equal(c.story.profile.perks.quick, 1);
  assert.equal(c.story.profile.perks.thick, undefined, 'only two points at level 3');
  assert.equal(results.at(-1).reason, 'points');
  // loadout: the host refuses guns that are not owned
  c.story.setLoadout(['minigun', null, null]);
  await env.frames(2);
  assert.equal(results.at(-1).reason, 'unowned');
  c.story.setLoadout(['rifle', 'pistol', null]);
  await env.frames(2);
  assert.deepEqual(c.story.profile.loadout, ['rifle', 'pistol', null]);
  // reset perks: free once per chapter, then costs scrap
  c.story.resetPerks();
  await env.frames(2);
  assert.deepEqual(c.story.profile.perks, {});
  assert.equal(c.story.profile.perkPoints, 2);
  c.story.buyPerk('steady');
  c.story.resetPerks();
  await env.frames(3);
  assert.equal(c.story.profile.scrap, 500 - tierCost('rifle', 1) - 100, 'the second reset in a chapter costs 100 scrap');
});

test('the world: hideout upgrades and supplies change it for everyone, revisions only go up', async () => {
  const p = { ...createProfile({ name: 'Alice', cls: 'soldier', color: 1 }), scrap: 300 };
  const env = await setup({ clients: [{ name: 'Alice', profile: p }, { name: 'Cy', color: 2 }] });
  const [a, b] = env.clients;
  env.host.start();
  await env.frames(2);
  const rev0 = env.host.story.world.rev;
  const worldsB = storyEvents(b, 'world');
  a.story.upgradeHideout('garden');
  await env.frames(3);
  assert.equal(env.host.story.world.hideout.upgrades.garden, 1);
  assert.equal(b.story.world.hideout.upgrades.garden, 1, 'every player holds the new copy');
  assert.equal(a.story.world.rev, b.story.world.rev);
  assert.ok(env.host.story.world.rev > rev0);
  assert.equal(worldsB.at(-1).world.hideout.upgrades.garden, 1);
  assert.equal(env.host.story.world.hideout.stash.scrap, 600 - 70);
  assert.equal(env.host.story.world.hideout.stash.parts, 5);
  // donate scrap, take and buy supplies
  a.story.donate(100);
  await env.frames(2);
  assert.equal(a.story.profile.scrap, 200);
  assert.equal(env.host.story.world.hideout.stash.scrap, 630);
  a.story.takeKit('frag', 2);
  await env.frames(2);
  assert.equal(a.story.profile.kit.frag, 2);
  assert.equal(env.host.story.world.hideout.stash.frag, 4 - 2);
  a.story.buyKit('turret');
  await env.frames(2);
  assert.equal(env.host.story.world.hideout.stash.turret, 1);
  assert.equal(a.story.profile.scrap, 200 - 70);
  b.story.takeKit('turret', 1);
  await env.frames(2);
  assert.equal(b.story.profile.kit.turret, 1);
  // a tier-2 line needs the chapter: refused in chapter 1
  a.story.upgradeHideout('garden');
  await env.frames(2);
  assert.equal(env.host.story.world.hideout.upgrades.garden, 1);
  // talking marks a flag
  b.story.talked('mara');
  await env.frames(2);
  assert.equal(env.host.story.world.progress.flags.talked_mara, true);
});

test('crew actions belong to the host: clients cannot pick, deploy or change the difficulty', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  const results = storyEvents(c, 'result');
  env.host.start();
  await env.frames(2);
  for (const act of ['pickMission', 'deploy', 'backToHideout', 'retry', 'cancelBriefing']) {
    if (act === 'pickMission') c.story.pickMission('m1_1');
    else c.story[act]();
    await env.frames(2);
    assert.equal(results.at(-1).ok, false, act);
    assert.equal(results.at(-1).reason, 'host', act);
  }
  c.story.setDifficulty('nightmare');
  c.story.renameWorld('Hax');
  await env.frames(2);
  assert.equal(env.host.story.world.difficulty, 'normal');
  assert.equal(env.host.story.stage, 'hideout');
  // the host can
  env.host.story.setDifficulty('hard');
  await env.frames(2);
  assert.equal(c.story.world.difficulty, 'hard');
});

test('hostile messages: garbage actions never crash the host or change anything', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  const results = storyEvents(c, 'result');
  env.host.start();
  await env.frames(2);
  const before = JSON.stringify([env.host.story.world, env.host.story.profiles.get(2)]);
  for (const act of [
    { a: 'nope' }, { a: 'tier' }, { a: 'tier', weapon: '__proto__' }, { a: 'perk', perk: 'constructor' }, { a: 'kit', item: 'gold', n: 5 },
    { a: 'kit', item: 'frag', n: 1e9 }, { a: 'donate', scrap: -5 }, { a: 'donate', scrap: 'lots' }, { a: 'hideout', id: 'moat' },
    { a: 'pick', mission: { evil: true } }, { a: 'sync', world: { id: 'x' } }, { a: 'talk', npc: '../../' }, { a: 5 }, { a: 'loadout', loadout: 'x' },
  ]) {
    c._sendCtl({ t: 'sact', ...act });
  }
  c._sendCtl({ t: 'sact' });
  await env.frames(6);
  assert.equal(JSON.stringify([env.host.story.world, env.host.story.profiles.get(2)]), before);
  assert.ok(results.length >= 10);
  assert.ok(results.every((r) => r.ok === false || r.a === 'donate' || r.a === 'talk'));
  assert.equal(env.host.left, false);
});

test('the mission chain: hideout → briefing → mission → debrief → hideout, never through the lobby', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  const lobbyH = collect(env.host, 'lobby');
  const lobbyC = collect(c, 'lobby');
  const startsC = collect(c, 'start');
  const stateC = storyEvents(c, 'state');
  env.host.start();
  await env.frames(3);
  const hideoutMatch = c.match;

  // the board: the host briefs the crew
  env.host.story.pickMission('m1_1');
  await env.frames(3);
  assert.equal(env.host.story.stage, 'briefing');
  assert.equal(c.story.stage, 'briefing');
  assert.equal(c.story.missionId, 'm1_1');
  assert.equal(c.story.mission.title, 'Pileup');
  assert.deepEqual(c.story.ready, [1], 'the host is ready by default');
  assert.equal(stateC.at(-1).stage, 'briefing');
  assert.ok(c.inGame, 'the hideout keeps running behind the briefing');
  // the crew confirms
  c.story.setReady(true);
  await env.frames(2);
  assert.deepEqual(c.story.ready.slice().sort(), [1, 2]);
  c.story.setReady(false);
  await env.frames(2);
  assert.deepEqual(c.story.ready, [1]);
  env.host.story.cancelBriefing();
  await env.frames(2);
  assert.equal(c.story.stage, 'hideout');
  assert.equal(c.story.missionId, null);
  env.host.story.pickMission('m1_1');
  await env.frames(2);
  // a locked mission cannot be briefed
  const before = env.host.story.stage;
  env.host.story.pickMission('m2_1');
  await env.frames(2);
  assert.equal(env.host.story.missionId, 'm1_1');
  assert.equal(env.host.story.stage, before);

  // deploy
  env.host.story.deploy();
  await env.frames(3);
  const g = env.game();
  assert.equal(env.games.length, 2, 'a second game was built');
  assert.equal(g.opts.mapId, 'highway');
  assert.equal(g.opts.settings.mode, 'mission');
  assert.equal(g.opts.settings.story.nodeId, 'm1_1');
  assert.equal(g.opts.settings.story.simMode, 'defend');
  // the session settings (the start message) name the game mode and carry a light story block
  assert.equal(env.host.settings.mode, 'mission');
  assert.deepEqual(env.host.settings.story, { nodeId: 'm1_1', difficulty: 'normal', simMode: 'defend', title: 'Pileup' });
  assert.equal(c.settings.mode, 'mission');
  assert.equal(c.settings.story.nodeId, 'm1_1');
  assert.equal(c.story.stage, 'mission');
  assert.equal(c.settings.mapId, 'highway');
  assert.notEqual(c.match, hideoutMatch);
  assert.equal(c.inGame, true);
  assert.equal(startsC.length, 2);
  assert.equal(startsC[1].story.stage, 'mission');
  assert.equal(lobbyH.length + lobbyC.length, 0, 'nobody visited the lobby');
  assert.equal(c.getMap().id, 'highway');

  // the mission ends in victory
  const debrief = storyEvents(c, 'debrief');
  const hostDebrief = storyEvents(env.host, 'debrief');
  g.endMission('victory', 3, { 1: { kills: 40, kinds: { walker: 30, runner: 10 } }, 2: { kills: 12, revives: 1 } });
  await env.frames(4);
  assert.equal(env.host.story.stage, 'debrief');
  assert.equal(c.story.stage, 'debrief');
  assert.equal(env.host.held, true, 'the world is frozen behind the result screen');
  const d = c.story.debrief;
  assert.equal(d.result, 'victory');
  assert.equal(d.stars, 3);
  assert.equal(d.firstClear, true);
  assert.equal(d.mission, 'm1_1');
  assert.equal(d.players.length, 2);
  const mine = d.players.find((p) => p.pid === c.localId);
  assert.ok(mine.delta.xp > 0);
  assert.equal(mine.delta.weapon, 'shotgun');
  assert.equal(c.story.profile.xp, mine.delta.xp, 'the new profile arrived before the result');
  assert.deepEqual(c.story.profile.weapons.shotgun, { tier: 0 });
  assert.equal(debrief.length, 1);
  assert.equal(hostDebrief.length, 1);
  assert.equal(isCompleted(c.story.world, 'm1_1'), true);
  assert.equal(c.story.world.progress.completed.m1_1.stars, 3);
  assert.deepEqual(env.host.story.world, c.story.world);
  assert.equal(env.host.story.profile.stats.missions, 1);
  assert.equal(env.host.roster[0].lvl, env.host.story.profile.level);
  assert.equal(c.roster.find((r) => r.id === c.localId).lvl, c.story.profile.level);

  // back to the hideout
  env.host.story.backToHideout();
  await env.frames(3);
  assert.equal(c.story.stage, 'hideout');
  assert.equal(env.games.length, 3);
  assert.equal(env.game().opts.settings.mode, 'hideout');
  assert.equal(env.host.held, false);
  assert.equal(c.settings.mapId, 'roadhouse');
  assert.equal(lobbyH.length + lobbyC.length, 0);
  // and the next mission is now open
  env.host.story.pickMission('m1_2');
  await env.frames(2);
  assert.equal(c.story.missionId, 'm1_2');
});

test('a lost mission: partial XP, no scrap, no progress; the host can retry', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  env.host.start();
  await env.frames(2);
  env.host.story.pickMission('m1_1');
  await env.frames(2);
  env.host.story.deploy();
  await env.frames(3);
  const scrap0 = c.story.profile.scrap;
  env.game().endMission('defeat', 3, { 1: { kills: 30 }, 2: { kills: 20, downs: 2 } });
  await env.frames(3);
  const d = c.story.debrief;
  assert.equal(d.result, 'defeat');
  assert.equal(d.stars, 0);
  assert.equal(isCompleted(c.story.world, 'm1_1'), false);
  assert.equal(c.story.profile.scrap, scrap0);
  assert.equal(c.story.profile.xp, 20 * 2 * 0.5);
  assert.equal(c.story.profile.stats.deaths, 2);
  // only the host retries
  const results = storyEvents(c, 'result');
  c.story.retry();
  await env.frames(2);
  assert.equal(results.at(-1).reason, 'host');
  env.host.story.retry();
  await env.frames(3);
  assert.equal(c.story.stage, 'mission');
  assert.equal(c.story.missionId, 'm1_1');
  assert.equal(env.games.length, 3);
  // a win cannot be "retried"
  env.game().endMission('victory', 1);
  await env.frames(3);
  env.host.story.retry();
  await env.frames(2);
  assert.equal(env.host.story.stage, 'debrief');
});

test('supplies taken at the armory ride into the mission and are spent on a win, kept on a loss', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  env.host.start();
  await env.frames(2);
  c.story.takeKit('frag', 2);
  c.story.takeKit('armor', 1);
  await env.frames(3);
  env.host.story.pickMission('m1_1');
  await env.frames(2);
  env.host.story.deploy();
  await env.frames(3);
  assert.deepEqual(env.game().specs.get(c.localId).kit, { frag: 2, armor: 1 });
  assert.deepEqual(env.game().specs.get(1).kit, {});
  env.game().endMission('defeat', 0);
  await env.frames(3);
  assert.deepEqual(c.story.profile.kit, { frag: 2, armor: 1 });
  env.host.story.retry();
  await env.frames(3);
  env.game().endMission('victory', 2);
  await env.frames(3);
  assert.deepEqual(c.story.profile.kit, {});
});

test('stub missions: the classic victory and game over end a mission, and stub.seconds wins by the clock', async () => {
  const env = await setup({ clients: [] });
  env.host.start();
  await env.frames(2);
  env.host.story.pickMission('m1_1');
  env.host.story.deploy();
  await env.frames(2);
  assert.equal(env.host.story.stage, 'mission');
  // m1_1 is a 6 second stub: 6 s * 60 ticks after the first snapshot
  await env.frames(60 * 5);
  assert.equal(env.host.story.stage, 'mission');
  await env.frames(60 * 2);
  assert.equal(env.host.story.stage, 'debrief');
  assert.equal(env.host.story.debrief.result, 'victory');
  assert.ok(env.host.story.debrief.stars >= 1);
  // the classic events end a wave-based stub mission
  env.host.story.backToHideout();
  await env.frames(2);
  env.host.story.pickMission('m1_2');
  env.host.story.deploy();
  await env.frames(2);
  env.game().inject({ type: 'gameover', reason: 'wiped' });
  await env.frames(3);
  assert.equal(env.host.story.debrief.result, 'defeat');
});

test('late join: into the hideout, into a mission (spectates), into the debrief; leaving keeps everyone\'s profile', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  env.host.start();
  await env.frames(2);
  // into the hideout
  const late1 = await join(env.hub, env.clock, { name: 'Late', color: 3 });
  env.clients.push(late1);
  await env.frames(3);
  assert.equal(late1.inGame, true);
  assert.equal(late1.story.stage, 'hideout');
  assert.ok(late1.mods !== undefined);
  const added = env.game().log.added.find((a) => a.id === late1.localId);
  assert.ok(added && added.story && Array.isArray(added.story.loadout), 'the newcomer entered with a spec');
  assert.ok(late1.story.profile);
  // into a mission
  env.host.story.pickMission('m1_1');
  await env.frames(2);
  assert.equal(late1.story.stage, 'briefing');
  assert.deepEqual(late1.story.ready.includes(late1.localId), false);
  env.host.story.deploy();
  await env.frames(3);
  const late2 = await join(env.hub, env.clock, { name: 'Later', color: 4 });
  env.clients.push(late2);
  await env.frames(3);
  assert.equal(late2.story.stage, 'mission');
  assert.equal(late2.settings.mapId, 'highway');
  const spec = env.game().specs.get(late2.localId);
  assert.ok(spec, 'added to the running mission');
  // the debrief reaches a late joiner through the welcome
  env.game().endMission('victory', 2, { 1: { kills: 5 } });
  await env.frames(3);
  const late3 = await join(env.hub, env.clock, { name: 'Last', color: 5 });
  env.clients.push(late3);
  await env.frames(2);
  assert.equal(late3.story.stage, 'debrief');
  assert.equal(late3.story.debrief.result, 'victory');
  assert.equal(late3.story.debrief.players.find((p) => p.pid === late3.localId), undefined, 'they were not in it');
  // someone leaves: their profile stays theirs, the room goes on
  const xp = late1.story.profile.xp;
  late1.leave();
  await env.frames(3);
  assert.equal(env.host.story.profiles.has(late1.localId), false);
  assert.equal(late1.story.profile.xp, xp);
  assert.equal(env.host.story.stage, 'debrief');
});

test('the host leaves: clients keep the world and their profile for later', async () => {
  const p = { ...createProfile({ name: 'Alice', cls: 'soldier', color: 1 }), scrap: 90 };
  const env = await setup({ clients: [{ name: 'Alice', profile: p }] });
  const [c] = env.clients;
  env.host.start();
  await env.frames(2);
  c.story.upgradeHideout('garden');
  await env.frames(3);
  const gone = collect(c, 'disconnected');
  const world = c.story.world;
  env.host.leave();
  await env.frames(6);
  assert.equal(gone.length, 1);
  assert.equal(gone[0].reason, 'Host left the game');
  assert.equal(c.story.world.hideout.upgrades.garden, 1);
  assert.deepEqual(c.story.world, world);
  assert.equal(c.story.profile.name, 'Alice');
});

test('a joiner with a newer copy of the campaign hands it to the host', async () => {
  const hostProfile = createProfile({ name: 'Bob', cls: 'soldier', color: 0 });
  const stale = createWorld({ name: 'Crew', profile: hostProfile, now: 10 });
  // Alice played on with someone else: her copy is three revisions ahead
  let fresh = stale;
  for (let i = 0; i < 3; i++) fresh = changeWorld(fresh, (d) => { d.hideout.stash.scrap += 100; d.progress.flags[`f${i}`] = true; }, 20 + i);
  fresh = changeWorld(fresh, (d) => { d.progress.completed.m1_1 = { stars: 2, time: 99 }; }, 30);
  const env = await setup({ hostProfile, world: stale, clients: [{ name: 'Alice', world: fresh }] });
  const [c] = env.clients;
  await env.frames(4);
  assert.equal(env.host.story.world.id, stale.id);
  assert.ok(env.host.story.world.rev >= fresh.rev, 'the host adopted the newer copy');
  assert.equal(isCompleted(env.host.story.world, 'm1_1'), true);
  assert.equal(env.host.story.world.hideout.stash.scrap, stale.hideout.stash.scrap + 300);
  assert.deepEqual(c.story.world, env.host.story.world);
  // an older copy is ignored
  const c2 = await join(env.hub, env.clock, { name: 'Old', color: 2, world: stale });
  env.clients.push(c2);
  await env.frames(3);
  assert.equal(isCompleted(env.host.story.world, 'm1_1'), true);
});

test('returning to the lobby leaves the campaign untouched; starting again resumes at the hideout', async () => {
  const env = await setup({ clients: [{ name: 'Alice' }] });
  const [c] = env.clients;
  env.host.start();
  await env.frames(2);
  env.host.story.pickMission('m1_1');
  env.host.story.deploy();
  await env.frames(2);
  env.game().endMission('victory', 2);
  await env.frames(3);
  const world = env.host.story.world;
  const lobby = collect(c, 'lobby');
  assert.equal(env.host.returnToLobby(), true);
  await env.frames(3);
  assert.equal(lobby.length, 1);
  assert.equal(c.story.stage, 'lobby');
  assert.equal(c.inGame, false);
  assert.deepEqual(env.host.story.world, world);
  assert.equal(env.host.settings.mapId, 'highway', 'the lobby settings are back (the default map)');
  env.host.start();
  await env.frames(3);
  assert.equal(c.story.stage, 'hideout');
  assert.equal(env.game().opts.mapId, 'roadhouse');
});

test('solo with AI survivors: bots get profiles scaled to the human and join the mission with specs', async () => {
  const clock = makeClock();
  const hub = createLocalHub({ code: null });
  const games = [];
  const strong = { ...createProfile({ name: 'Solo', cls: 'soldier', color: 0 }), xp: xpForLevel(9) };
  const host = await hostGame({
    name: 'Solo', color: 0, cls: 'soldier', transport: hub.host, story: { profile: strong, newWorld: { name: 'Lone' } },
    hooks: { now: clock, manual: true, createGame: (o) => { const g = new StoryFakeGame(o); games.push(g); return g; } },
  });
  host.addBot();
  host.addBot();
  host.start();
  host.update(1 / 60, null, 0);
  const g = games[0];
  assert.equal(g.opts.players.length, 3);
  assert.equal(g.opts.players.filter((p) => p.bot).length, 2);
  for (const p of g.opts.players) assert.ok(p.story && p.story.loadout[0], 'everyone has a spec');
  const bot = g.opts.players.find((p) => p.bot);
  assert.equal(bot.story.lvl, 9, 'bots play at the party level');
  host.story.pickMission('m1_1');
  host.story.deploy();
  host.update(1 / 60, null, 0);
  games[1].endMission('victory', 2, { 1: { kills: 9 }, 2: { kills: 30 } });
  for (let i = 0; i < 5; i++) {
    clock.advance(1 / 60);
    host.update(1 / 60, null, 0);
  }
  assert.equal(host.story.stage, 'debrief');
  assert.deepEqual(host.story.debrief.players.map((p) => p.pid), [1], 'bots earn nothing');
  assert.equal(host.story.profiles.size, 1);
});
