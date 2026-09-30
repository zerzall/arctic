// The hosting side of a story campaign (STORY.md §4/§5): owns the crew's World and every
// player's Profile for the session, chains the games (hideout → briefing → mission → debrief
// → hideout) without dropping anyone to the lobby, applies station actions, settles missions
// into rewards, and keeps every participant's copy of the world up to date.
//
// A HostSession owns exactly one of these when the room is a story room (`session.story`);
// it calls in at a handful of points (see host-session.js): start(), the hello handshake,
// `sact` messages, the events of each snapshot, a leaving peer.
//
// Control messages (JSON on 'ctl'), all new in protocol 9:
//   client → host  hello { ..., story:{ profile, worldId, worldRev } } · sact { a, ...args }
//   host → client  welcome { ..., story:{ world, profile, state } } · start { ..., story:{ stage, specs, ... } }
//                  world { world } · sprofile { profile } · sstate { ...state } · sdebrief { debrief }
//                  sres { a, ok, reason?, note? } · swant { id }   (send me your newer copy)
//   client → host  sact { a:'sync', world }                       (the answer to swant)

import { DIFFICULTIES } from '../shared/constants.js';
import { createProfile, acceptJoinProfile, sanitizeProfile, botStoryProfile, newId, touchProfile } from '../shared/story/profile.js';
import {
  createWorld, sanitizeWorld, touchMember, pickHighest, changeWorld, availableMissions, currentChapter,
  isCompleted,
} from '../shared/story/world.js';
import { resolveNext, pendingArrival, epiloguePending } from '../shared/story/graph.js';
import { applyAction } from '../shared/story/actions.js';
import { specFromProfile } from '../shared/story/mods.js';
import { settleMission } from '../shared/story/rewards.js';
import { getMissions, getMission } from '../shared/story/content.js';
import { createStoryGame } from '../shared/sim/story-shim.js';
import { StoryView } from './story-view.js';

/** Stub missions win after this many seconds when they say `stub.seconds`. */
const TICKS_PER_SECOND = 60;

function fail(reason) {
  return { ok: false, reason };
}

export class StoryHost extends StoryView {
  /**
   * @param {object} session the HostSession
   * @param {{ profile?: object, world?: object, newWorld?: { name?: string, difficulty?: string }, now?: () => number }} [opts]
   */
  constructor(session, opts = {}) {
    super(session);
    this.isHost = true;
    this.nowFn = opts.now || (() => Date.now());
    const me = session.roster[0];
    const seed = opts.profile ? sanitizeProfile(opts.profile).profile : null;
    let profile = seed || createProfile({ name: me.name, cls: me.cls, color: me.color });
    profile = { ...profile, cls: me.cls, color: me.color };
    /** pid → Profile of the human players. */
    this.profiles = new Map([[1, profile]]);
    this.profile = profile;
    let world = null;
    if (opts.world) world = sanitizeWorld(opts.world).world;
    if (!world) world = createWorld({ ...(opts.newWorld || {}), profile, now: this.nowFn() });
    this.world = touchMember(world, profile, this.nowFn());
    me.lvl = profile.level;
    /** The lobby's settings, restored when the crew returns to the lobby. */
    this.lobbySettings = null;
    this.finished = false;
    this.lastResult = null;
    this.stubTicks = 0;
    this.stageTick0 = -1;
    this.stageLaunch = null;
    /** True while the crew is being briefed on a road mission without a hideout in between. */
    this.direct = false;
    /** The peer that offered a newer copy of the world (asked for right after its welcome). */
    this.want = null;
  }

  // ---- state the messages carry -----------------------------------------------------------

  /** The lightweight stage state every player mirrors. */
  stateInfo() {
    return {
      stage: this.stage,
      mission: this.missionId,
      party: this.party.slice(),
      ready: this.ready.slice(),
      hideout: this.world.hideout.current,
      chapter: this.chapter(),
      direct: this.direct,
    };
  }

  /** The current chapter (1..6). */
  chapter() {
    return currentChapter(this.world, getMissions());
  }

  humans() {
    return this.session.roster.filter((r) => !r.bot);
  }

  profileOf(pid) {
    return this.profiles.get(pid) || null;
  }

  /** The level the AI survivors of the party play at: the humans' average, at least 1. */
  partyLevel() {
    const hs = this.humans().map((r) => (this.profiles.get(r.id) || { level: 1 }).level);
    return Math.max(1, Math.round(hs.reduce((a, b) => a + b, 0) / Math.max(1, hs.length)));
  }

  /** The profile the sim uses for a roster entry (bots get one scaled to the party). */
  simProfile(entry) {
    if (!entry.bot) return this.profiles.get(entry.id) || createProfile({ name: entry.name, cls: entry.cls, color: entry.color });
    return botStoryProfile({ name: entry.name, cls: entry.cls, color: entry.color, level: this.partyLevel() });
  }

  /** The StorySpec of a roster entry for the current stage (the kit only rides into a mission). */
  specFor(entry, stage = this.stage) {
    const p = this.simProfile(entry);
    const kit = stage === 'mission' && !entry.bot ? p.kit || {} : {};
    return specFromProfile({ ...p, cls: entry.cls }, this.world.hideout.upgrades, kit);
  }

  // ---- handshake ------------------------------------------------------------------------------

  /**
   * A player joined (called from the hello handling, after the roster entry exists).
   * @param {number} pid
   * @param {object} entry the roster entry
   * @param {object} peer the peer record (to ask for a newer world copy)
   * @param {*} hello the `story` part of the hello (untrusted)
   */
  admit(pid, entry, peer, hello) {
    const raw = hello && typeof hello === 'object' ? hello.profile : null;
    let { profile } = acceptJoinProfile(raw, { now: this.nowFn() });
    if (!profile) profile = createProfile({ name: entry.name, cls: entry.cls, color: entry.color });
    for (const q of this.profiles.values()) {
      if (q.id === profile.id) {
        profile = { ...profile, id: newId() };
        break;
      }
    }
    profile = { ...profile, cls: entry.cls, color: entry.color };
    this.profiles.set(pid, profile);
    entry.lvl = profile.level;
    this._setWorld(touchMember(this.world, profile, this.nowFn()), false);
    // the joiner played this campaign with another host and has a newer copy: ask for it
    // (once the welcome is out: their story mirror does not exist before it)
    this.want = null;
    if (hello && typeof hello === 'object' && hello.worldId === this.world.id && Number(hello.worldRev) > this.world.rev) {
      this.want = peer;
    }
  }

  /** After the welcome went out: everyone (the newcomer included) gets the world with its new member. */
  afterWelcome() {
    this.session._sendAll('ctl', { t: 'world', world: this.world });
    this._emit('world', { world: this.world });
    if (this.want) {
      this.session._send(this.want, { t: 'swant', id: this.world.id });
      this.want = null;
    }
  }

  /** What the welcome message tells a new player about the story. */
  welcomeInfo(pid) {
    return {
      world: this.world, profile: this.profiles.get(pid), state: this.stateInfo(), pid,
      debrief: this.stage === 'debrief' ? this.debrief : null,
    };
  }

  /** The story part of a `start` message: which stage, and every survivor's spec. */
  startInfo() {
    const specs = {};
    for (const r of this.session.roster) specs[r.id] = this.specFor(r);
    const info = { ...this.stateInfo(), specs, map: this.stageLaunch ? this.stageLaunch.mapId : null };
    // a hideout visit may open with a scene: an arrival, or the ending
    if (this.stage === 'hideout') {
      const arrival = pendingArrival(this.world, this.world.hideout.current);
      if (arrival) info.arrival = { hideout: arrival.hideout, flag: arrival.flag };
      if (epiloguePending(this.world)) info.epilogue = true;
    }
    return info;
  }

  /** The spec a late joiner enters the running game with. */
  joinSpec(pid) {
    const e = this.session.roster.find((r) => r.id === pid);
    return e ? this.specFor(e) : undefined;
  }

  /** A player left the room. Their profile stays theirs; nothing is lost. */
  onLeave(pid) {
    this.profiles.delete(pid);
    const i = this.ready.indexOf(pid);
    if (i >= 0) {
      this.ready.splice(i, 1);
      this._broadcastState();
    }
    const j = this.party.indexOf(pid);
    if (j >= 0) this.party.splice(j, 1);
  }

  // ---- stages -----------------------------------------------------------------------------------

  /** The host pressed Start in the story lobby: into the hideout. */
  begin() {
    if (this.stage !== 'lobby' || this.session.inGame) return false;
    this.lobbySettings = { ...this.session.settings };
    return this._enter();
  }

  /** Walk on to wherever the story goes next: a hideout, or straight into a road mission's briefing. */
  _enter() {
    const next = resolveNext(this.world);
    if (next.kind === 'briefing' && getMission(next.mission)) return this._launchStaging(next.mission);
    return this._launchHideout(next.hideout);
  }

  /** The crew returned to the lobby: stage back to the lobby, world and profiles stay. */
  onReturnToLobby() {
    this.stage = 'lobby';
    this.missionId = null;
    this.party = [];
    this.ready = [];
    this.debrief = null;
    this.finished = false;
    if (this.lobbySettings) this.session.settings = { ...this.lobbySettings };
  }

  _storySettings(nodeId) {
    const w = this.world;
    const party = this.session.roster.map((r) => ({ pid: r.id, profile: this.simProfile(r) }));
    return {
      worldId: w.id,
      nodeId,
      difficulty: w.difficulty,
      party,
      flags: { ...w.progress.flags },
      hideoutUpgrades: { ...w.hideout.upgrades },
      npcs: Object.keys(w.hideout.recruited),
    };
  }

  _launchHideout(hideoutId) {
    let w = this.world;
    if (hideoutId && hideoutId !== w.hideout.current) {
      w = changeWorld(w, (d) => { d.hideout.current = hideoutId; }, this.nowFn());
      this._setWorld(w, true);
    }
    this.stage = 'hideout';
    this.missionId = null;
    this.debrief = null;
    this.ready = [];
    this.finished = false;
    this.direct = false;
    this.party = this.session.roster.map((r) => r.id);
    const hideout = w.hideout.current;
    const stage = { stage: 'hideout', mapId: hideout, mapMode: 'defend' };
    this.stageLaunch = stage;
    const story = this._storySettings(`hideout:${hideout}`);
    return this._launch(stage, {
      mapId: hideout,
      ui: { mapId: hideout, mode: 'hideout', time: 'day', difficulty: w.difficulty },
      game: { difficulty: w.difficulty, waves: 0, objective: false, friendlyFire: false, mode: 'hideout', time: 'day', story },
    });
  }

  /** A road mission without a hideout in between: brief the crew on its map, frozen until they deploy. */
  _launchStaging(missionId) {
    const m = getMission(missionId);
    if (!m) return false;
    this.missionId = m.id;
    this.direct = true;
    this.debrief = null;
    this.finished = false;
    this.party = this.session.roster.map((r) => r.id);
    this.ready = this.session.roster.filter((r) => r.bot || r.host).map((r) => r.id);
    this.stage = 'briefing';
    const ok = this._launchMissionGame(m, true);
    if (ok) this.session._holdGame();
    return ok;
  }

  _launchMission() {
    const m = this.mission;
    if (!m) return false;
    this.stage = 'mission';
    this.finished = false;
    this.debrief = null;
    this.stageTick0 = -1;
    this.party = this.session.roster.map((r) => r.id);
    return this._launchMissionGame(m, false);
  }

  _launchMissionGame(m, staging) {
    const w = this.world;
    const mapMode = m.mode === 'campaign' ? 'campaign' : m.mode === 'zone' ? 'zone' : 'defend';
    const stage = { stage: 'mission', mapId: m.map, mapMode, stub: staging ? null : m.stub || null };
    this.stageLaunch = stage;
    const story = this._storySettings(m.id);
    const time = m.time === 'day' ? 'day' : 'night';
    return this._launch(stage, {
      mapId: m.map,
      ui: { mapId: m.map, mode: mapMode, time: mapMode === 'campaign' ? 'day' : time, difficulty: w.difficulty },
      game: {
        difficulty: w.difficulty, waves: 0, objective: false, friendlyFire: false, mode: 'mission', mapMode,
        time: mapMode === 'campaign' ? 'day' : time, story,
      },
    });
  }

  _launch(stage, { mapId, ui, game }) {
    const session = this.session;
    // The session's own settings describe the stage while it runs (the map, the mode of its
    // map, the time of day); the lobby's are restored when the crew returns to the lobby.
    session.settings = { ...session.settings, ...ui };
    for (const r of session.roster) {
      const p = this.profiles.get(r.id);
      if (p) {
        this.profiles.set(r.id, { ...p, cls: r.cls, color: r.color });
        r.lvl = p.level;
      }
    }
    const players = session.roster.map((r) => ({
      id: r.id, name: r.name, color: r.color, cls: r.cls, bot: !!r.bot, story: this.specFor(r),
    }));
    const create = session.hooks.createGame || ((opts) => createStoryGame(opts, stage));
    const info = this.startInfo();
    const ok = session._launchGame({ mapId, gameSettings: game, players, create, story: info });
    if (ok) {
      this.stageInfo = { map: info.map || null, arrival: info.arrival || null, epilogue: !!info.epilogue };
      this._emit('state', this.stateInfo());
    }
    return ok;
  }

  // ---- results ----------------------------------------------------------------------------------------

  /** The events of one snapshot: a `storyend`, or the stub mission's classic win/loss. */
  onEvents(events) {
    if (this.stage !== 'mission' || this.finished) return;
    const g = this.session.game;
    const real = !!g && !!g.settings && g.settings.mode === 'mission';
    for (const ev of events) {
      if (!ev) continue;
      if (ev.type === 'storyend') {
        this._finish(ev);
        return;
      }
      if (!real && ev.type === 'victory') {
        this._finish(this._synth('victory'));
        return;
      }
      if (!real && ev.type === 'gameover') {
        this._finish(this._synth('defeat'));
        return;
      }
    }
  }

  /** Each snapshot: the stub mission's timer. */
  onSnapshot(snap) {
    if (this.stage !== 'mission' || this.finished) return;
    const stub = this.stageLaunch && this.stageLaunch.stub;
    if (!stub || !(stub.seconds > 0)) return;
    if (this.stageTick0 < 0) this.stageTick0 = snap.tick;
    if (snap.tick - this.stageTick0 >= stub.seconds * TICKS_PER_SECOND) this._finish(this._synth('victory'));
  }

  /** A storyend for a mission the fallback runner played. */
  _synth(result) {
    const m = this.mission;
    const g = this.session.game;
    const stats = {};
    let downs = 0;
    if (g) {
      for (const p of g.players) {
        stats[p.id] = { kills: p.kills | 0, downs: p.downs | 0, revives: p.revives | 0 };
        downs += p.downs | 0;
      }
    }
    const secs = g ? Math.round(g.tick / TICKS_PER_SECOND) : 0;
    let stars = 0;
    if (result === 'victory') {
      stars = 1;
      if (m && m.stars && m.stars.noDowns && downs === 0) stars++;
      if (m && m.stars && m.stars.time && secs <= m.stars.time) stars++;
    }
    return { type: 'storyend', result, stars, stats, time: secs };
  }

  _finish(ev) {
    if (this.finished || this.stage !== 'mission') return;
    this.finished = true;
    const m = this.mission;
    const world = this.world;
    const party = this.humans().filter((r) => this.profiles.has(r.id)).map((r) => ({ pid: r.id, profile: this.profiles.get(r.id), human: true }));
    const res = settleMission({ world, mission: m, result: ev, party, now: this.nowFn() });
    const players = [];
    for (const r of this.session.roster) {
      const pr = res.players[r.id];
      if (!pr) continue;
      this.profiles.set(r.id, pr.profile);
      r.lvl = pr.profile.level;
      players.push({ pid: r.id, name: r.name, level: pr.profile.level, delta: pr.delta, breakdown: pr.breakdown });
    }
    this.lastResult = ev.result;
    // freeze the world behind the result screen
    this.session._holdGame();
    this.stage = 'debrief';
    this.ready = [];
    this.debrief = {
      mission: m.id,
      title: m.title,
      result: res.victory ? 'victory' : 'defeat',
      stars: res.stars,
      firstClear: res.firstClear,
      replay: res.replay,
      stash: res.stash,
      unlocks: res.unlocks,
      next: res.unlocks.next,
      players,
      time: Math.floor(Number(ev.time) || 0),
    };
    if (res.world !== world) this._setWorld(res.world, false);
    // profiles first (each player persists its own), then the world, then the result
    for (const r of this.humans()) {
      const p = this.profiles.get(r.id);
      if (p) this._sendProfile(r.id, p);
    }
    this.session._sendAll('ctl', { t: 'world', world: this.world });
    this.session._sendAll('ctl', { t: 'sdebrief', debrief: this.debrief });
    this._emit('world', { world: this.world });
    this._emit('debrief', { debrief: this.debrief });
    this.session._rosterChanged();
    this._emit('state', this.stateInfo());
  }

  // ---- actions ---------------------------------------------------------------------------------------------

  _act(act) {
    this.onAction(1, act);
  }

  /**
   * One action from a player (the host's own come through `_act`). Answers with an `sres`.
   * @param {number} pid
   * @param {object} act untrusted
   */
  onAction(pid, act) {
    if (!act || typeof act !== 'object' || typeof act.a !== 'string') return;
    let res;
    try {
      res = this._dispatch(pid, act);
    } catch (err) {
      console.warn('[story] action failed', act.a, err);
      res = fail('error');
    }
    this._reply(pid, act.a, res);
  }

  _reply(pid, a, res) {
    const msg = { a, ok: !!res.ok };
    if (!res.ok) msg.reason = res.reason || 'invalid';
    else if (res.note) msg.note = res.note;
    if (pid === 1) this._emit('result', msg);
    else {
      const peer = this.session.pidToPeer.get(pid);
      if (peer !== undefined) this.session.net.send(peer, 'ctl', { t: 'sres', ...msg });
    }
  }

  _dispatch(pid, act) {
    const isHost = pid === 1;
    switch (act.a) {
      case 'pick': return this._pick(isHost, act.mission);
      case 'unpick': return this._unpick(isHost);
      case 'ready': return this._ready(pid, act.ready);
      case 'deploy': return this._deploy(isHost);
      case 'back': return this._back(isHost);
      case 'retry': return this._retry(isHost);
      case 'heal': return this._heal(pid);
      case 'bed': return this._bed(pid, isHost);
      case 'sync': return this._sync(pid, act.world);
      default: break;
    }
    const profile = this.profiles.get(pid);
    if (!profile) return fail('unknown');
    if (act.a === 'diff' && this.stage !== 'lobby' && this.stage !== 'hideout') return fail('busy');
    const r = applyAction({ profile, world: this.world, actor: { isHost }, chapter: this.chapter(), now: this.nowFn() }, act);
    if (!r.ok) return r;
    if (r.profile !== profile) this._setProfile(pid, r.profile);
    if (r.world !== this.world) this._setWorld(r.world, true);
    return r;
  }

  _pick(isHost, missionId) {
    if (!isHost) return fail('host');
    if (this.stage !== 'hideout' && this.stage !== 'briefing') return fail('busy');
    const m = getMission(missionId);
    if (!m || !availableMissions(this.world, getMissions()).some((q) => q.id === m.id)) return fail('locked');
    this.stage = 'briefing';
    this.missionId = m.id;
    this.direct = false;
    this.party = this.session.roster.map((r) => r.id);
    // AI survivors and the host are ready by definition; everyone else confirms
    this.ready = this.session.roster.filter((r) => r.bot || r.host).map((r) => r.id);
    this._broadcastState();
    return { ok: true };
  }

  _unpick(isHost) {
    if (!isHost) return fail('host');
    if (this.stage !== 'briefing') return fail('busy');
    if (this.direct) return fail('busy');
    this.stage = 'hideout';
    this.missionId = null;
    this.ready = [];
    this._broadcastState();
    return { ok: true };
  }

  _ready(pid, ready) {
    if (this.stage !== 'briefing') return fail('busy');
    const i = this.ready.indexOf(pid);
    if (ready && i < 0) this.ready.push(pid);
    else if (!ready && i >= 0) this.ready.splice(i, 1);
    else return { ok: true };
    this._broadcastState();
    return { ok: true };
  }

  _deploy(isHost) {
    if (!isHost) return fail('host');
    if (this.stage !== 'briefing') return fail('busy');
    return this._launchMission() ? { ok: true } : fail('error');
  }

  _back(isHost) {
    if (!isHost) return fail('host');
    if (this.stage !== 'debrief') return fail('busy');
    return this._enter() ? { ok: true } : fail('error');
  }

  _retry(isHost) {
    if (!isHost) return fail('host');
    if (this.stage !== 'debrief' || this.lastResult !== 'defeat') return fail('busy');
    return this._launchMission() ? { ok: true } : fail('error');
  }

  _heal(pid) {
    const g = this.session.game;
    if (this.stage !== 'hideout' || !g) return fail('busy');
    const p = g.getPlayer(pid);
    if (!p || p.state === 'dead') return fail('busy');
    if (p.state === 'downed') {
      p.state = 'alive';
      p.bleedout = 0;
      p.revive = 0;
      p.reviver = 0;
    }
    p.hp = p.maxHp;
    p.armor = Math.max(p.armor, p.perks.startArmor);
    return { ok: true };
  }

  /** The bed: anyone gets patched up; the host also moves the day on. */
  _bed(pid, isHost) {
    const healed = this._heal(pid);
    if (!healed.ok) return healed;
    if (isHost) {
      const day = (this.world.day | 0) + 1;
      this._setWorld(changeWorld(this.world, (d) => { d.day = Math.min(999, day); }, this.nowFn()), true);
      return { ok: true, note: { day } };
    }
    return { ok: true };
  }

  /** A joiner with a newer copy of this world answered our `swant`. */
  _sync(pid, raw) {
    const { world } = sanitizeWorld(raw, { now: this.nowFn() });
    if (!world || world.id !== this.world.id) return fail('invalid');
    if (pickHighest(this.world, world) !== world) return { ok: true };
    const p = this.profiles.get(pid);
    this._setWorld(p ? touchMember(world, p, this.nowFn()) : world, true);
    return { ok: true, note: { adopted: true } };
  }

  // ---- committing changes ----------------------------------------------------------------------------------------

  _setProfile(pid, profile) {
    const p = touchProfile(profile, {}, this.nowFn());
    this.profiles.set(pid, p);
    const entry = this.session.roster.find((r) => r.id === pid);
    if (entry && entry.lvl !== p.level) {
      entry.lvl = p.level;
      this.session._rosterChanged();
    }
    this._sendProfile(pid, p);
  }

  _sendProfile(pid, p) {
    if (pid === 1) {
      this.profile = p;
      this._emit('profile', { profile: p });
      return;
    }
    const peer = this.session.pidToPeer.get(pid);
    if (peer !== undefined) this.session.net.send(peer, 'ctl', { t: 'sprofile', profile: p });
  }

  /** Make `world` the crew's world and tell everyone (and the host's own storage). */
  _setWorld(world, announce = true) {
    this.world = world;
    if (announce) this.session._sendAll('ctl', { t: 'world', world });
    this._emit('world', { world });
  }

  _broadcastState() {
    const s = this.stateInfo();
    this.session._sendAll('ctl', { t: 'sstate', ...s });
    this._emit('state', s);
  }

  /** Difficulty label for the lobby. */
  difficultyName() {
    return (DIFFICULTIES[this.world.difficulty] || DIFFICULTIES.normal).name;
  }

  /** True when a mission has been won at least once (first-clear rewards are gone). */
  wasCleared(missionId) {
    return isCompleted(this.world, missionId);
  }

  /** Change the campaign before it starts (lobby): difficulty and name go through actions. */
  swapWorld(world) {
    const w = sanitizeWorld(world).world;
    if (!w) return false;
    this.world = touchMember(w, this.profile, this.nowFn());
    this._emit('world', { world: this.world });
    return true;
  }
}
