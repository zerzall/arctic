// The mission director (STORY.md §5.1, §5.4): runs a mission script inside a Game whose
// settings.mode is 'mission', and the calm of a hideout when it is 'hideout'.
//
// A mission is a list of steps (defend, waves, survive, collect, reach, activate, escort,
// kill, boss, evac, campaignStage, wait, dialogue; sim/story-steps.js has each one). Steps
// run one after the other; a step flagged `parallel` starts together with the next one and
// is cancelled when that one ends; an `optional` step runs alongside without blocking (and
// counts for the "collect everything" star). The director decides what pressure exists
// during every step (ambient bursts of zombies for the ones without waves of their own),
// speaks the radio / say lines through a timed queue, owns the story items (fuel cans, ...),
// the terminals, the NPCs of the mission, the respawn rule and the end of the mission
// (`storyend` with the stars and the per-player stats).
//
// Missions that run on the game's own directors (`mission.mode` 'zone' → sim/zone.js,
// 'campaign' → sim/campaign.js) keep the wave machine of those modes; the director then only
// bends it (the stops of an `evac`, the stages of a `campaignStage`) and watches it.
//
// Deterministic: the director's own seeded stream plus game.rng; it never touches the DOM.

import {
  DT, PLAYER_RADIUS, RESPAWN_HP, OBJECTIVE_HP_PER_PLAYER, PICKUP_LIFETIME, WAVE_CLEAR_BONUS, waveZombieCount,
  SPAWN_PACING, BOSS_EVERY, WAVE_ZOMBIES,
} from '../constants.js';
import { createRng, hashString } from '../rng.js';
import { MASK_MOVE } from '../geom.js';
import { TAU } from '../math.js';
import { WEAPONS } from '../weapons.js';
import { ZOMBIES } from '../zombies.js';
import {
  ITEM_PICKUP_RADIUS, isItemId, missionTier, normLine, STEP_KINDS, MARKER_KINDS,
} from '../story-defs.js';
import { missionOf, simModeOf } from '../story/registry.js';
import { walkComponents, componentAt } from './zone.js';
import { addInteractable } from './interact.js';
import { createNpc, npcByKey } from './npcs.js';
import { revivePlayer, respawnPlayer, spawnPickup, setSlot } from './players.js';
import { wavePlan } from '../campaign.js';
import { STEP_IMPL, defaultText } from './story-steps.js';

/** Seconds a dead survivor waits before returning next to a living teammate (mission.respawn overrides). */
export const RESPAWN_DELAY = 40;
const MAX_ACTIVE_SHOWN = 4;
const MAX_MARKS = 14;
const MAX_ITEMS_SNAP = 24;
/** Step results. */
export const RUN = 0, DONE = 1, FAIL = -1;

/** Resolve the mission a set of game settings asks for (re-export for the session layer and tools). */
export { missionOf, simModeOf };

function clampText(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Runs one mission (or one hideout visit) of a game; see the file comment. */
export class StoryDirector {
  /**
   * @param {import('./core.js').GameCore} game
   * @param {boolean} hideout true for settings.mode 'hideout'
   */
  constructor(game, hideout) {
    this.game = game;
    this.map = game.map;
    this.hideout = !!hideout;
    this.cfg = (game.settings.story && typeof game.settings.story === 'object') ? game.settings.story : {};
    this.mission = hideout ? null : missionOf(game.settings);
    this.missionId = this.mission ? String(this.mission.id || '') : '';
    this.rng = createRng((hashString('story:' + this.missionId + ':' + game.map.id) ^ (game.seed >>> 0) ^ 0x2f6b1c3d) >>> 0);
    this.tier = missionTier(this.mission);
    /** Multiplier on the size of every wave of this mission (the script's `waveScale`; tests use small ones). */
    this.waveScale = this.mission && this.mission.waveScale > 0 ? Math.min(3, this.mission.waveScale) : 1;
    this.respawnDelay = this.mission && Number.isFinite(this.mission.respawn) ? Math.max(0, this.mission.respawn) : RESPAWN_DELAY;
    /** Steps as runtime records, in script order. */
    this.steps = [];
    /** Steps that have started and not ended, in start order. */
    this.active = [];
    this.cursor = 0;
    this.lead = null;
    this.lineQ = [];
    this.lineT = 0;
    /** Story pickups lying on the ground: { id, item, x, y, step }. */
    this.items = [];
    this._itemId = 1;
    this.itemCount = {};
    this.flags = {};
    this.time = 0;
    this.started = false;
    this.ended = null;
    this.comp = null;
    this.mainComp = 0;
    this.stats = { bursts: 0, spawned: 0 };
    this._objCfg = null;
    this._marks = [];
    /** Set once the mission has run out of steps. */
    this.complete = false;
    if (this.mission && Array.isArray(this.mission.steps)) {
      this.steps = this.mission.steps.map((def, i) => this._makeStep(def, i));
    }
    /** `mission.bonus[]`: optional steps that never block the end (they start with the mission or with the step named by `since`). */
    this.bonusSteps = [];
    if (this.mission && Array.isArray(this.mission.bonus)) {
      const n0 = this.steps.length;
      this.bonusSteps = this.mission.bonus.slice(0, 24).map((def, k) => {
        const s = this._makeStep({ ...(def && typeof def === 'object' ? def : {}), optional: true }, n0 + k);
        s.bonus = true;
        return s;
      });
    }
    /** Timed callbacks (scripted blasts): { t, fn } in sim seconds. */
    this.timers = [];
  }

  _makeStep(def, i) {
    const d = def && typeof def === 'object' ? def : {};
    const type = STEP_IMPL[d.type] ? d.type : 'custom';
    return {
      i, def: d, type,
      kindIdx: Math.max(0, STEP_KINDS.indexOf(type)),
      id: String(d.id || `s${i}`),
      text: '',
      parallel: !!d.parallel,
      optional: !!d.optional,
      required: !!d.required,
      state: 'wait',
      cur: 0, max: 0, t: 0, total: 0,
      t0: 0, shownCur: -1,
      press: null,
      impl: STEP_IMPL[type] || null,
    };
  }

  // -----------------------------------------------------------------------------------
  // Lifecycle

  /** Called by the game once its players exist: set the scene and start the first step. */
  begin() {
    const g = this.game;
    this.started = true;
    this.comp = walkComponents(g.flow);
    const sp = this.map.playerSpawns && this.map.playerSpawns[0];
    this.mainComp = sp ? Math.max(0, componentAt(g.flow, this.comp, sp.x, sp.y)) : 0;
    this._loadInteractables();
    this._applyParty();
    this._spawnStoryNpcs();
    if (this.hideout || !this.mission) return;
    this._prepareUnderlying();
    // bonus steps that wait for no step of the script start with the mission
    const ids = new Set(this.steps.map((q) => q.id));
    for (const b of this.bonusSteps) if (!b.def.since || !ids.has(b.def.since)) this._startStep(b);
    this._startNext();
  }

  _loadInteractables() {
    const g = this.game;
    const list = this.map.interactables;
    if (Array.isArray(list) && list.length) {
      for (const d of list) addInteractable(g, d);
    } else if (this.map.hub && Array.isArray(this.map.hub.stations)) {
      // a hub map that lists only stations: every station is a tap-only spot
      for (const s of this.map.hub.stations) addInteractable(g, { id: s.id, kind: s.kind, x: s.x, y: s.y, r: s.r || 70, hold: s.hold });
    }
  }

  /** settings.story.party[]: { pid, loadout?, perks?, armor?, hp? } — what the profile gives that survivor. */
  _applyParty() {
    const g = this.game;
    const party = this.cfg.party;
    if (!Array.isArray(party)) return;
    for (const e of party) {
      if (!e || typeof e !== 'object') continue;
      const p = g.getPlayer(e.pid | 0);
      if (!p) continue;
      const src = e.sim && typeof e.sim === 'object' ? e.sim : e;
      if (src.perks && typeof src.perks === 'object') {
        for (const k of Object.keys(src.perks)) if (Number.isFinite(src.perks[k]) && k in p.perks) p.perks[k] = src.perks[k];
        p.maxHp = Math.max(1, p.perks.maxHp);
        p.hp = p.maxHp;
        p.speedMult = p.perks.speedMult;
        p.staminaMult = p.perks.staminaMult;
        p.armor = Math.max(p.armor, p.perks.startArmor);
        p.frags = Math.max(p.frags, p.perks.startFrags | 0);
        p.molotovs = Math.max(p.molotovs, p.perks.startMolotovs | 0);
      }
      if (Number.isFinite(src.armor)) p.armor = Math.max(0, Math.min(100, src.armor));
      if (Array.isArray(src.loadout)) {
        const ids = src.loadout.filter((id) => typeof id === 'string' && WEAPONS[id]).slice(0, 3);
        if (ids.length) {
          for (let i = 0; i < 3; i++) setSlot(p, i, ids[i] || null);
          p.slot = 0;
          p.lastSlot = ids.length > 1 ? 1 : 0;
        }
      }
    }
  }

  /** NPCs of the hideout (map.hub.npcs + settings.story.npcs) and of the mission (mission.npcs). */
  _spawnStoryNpcs() {
    const g = this.game;
    const fromCfg = Array.isArray(this.cfg.npcs) ? this.cfg.npcs : [];
    const hub = this.map.hub && Array.isArray(this.map.hub.npcs) ? this.map.hub.npcs : [];
    const seen = new Set();
    for (const h of hub) {
      const key = String(h.id || h.role || '');
      if (!key) continue;
      const listed = fromCfg.find((c) => c && (c.id === key || c.key === key));
      const over = listed || {};
      // a hub NPC that has to be recruited first (`recruit`, S3's hideouts) appears once the host lists it in story.npcs
      if (h.recruit && Array.isArray(this.cfg.npcs) && !listed) continue;
      seen.add(key);
      createNpc(g, { ...over, key, name: over.name, look: over.look, x: h.x, y: h.y, angle: h.angle || 0, mode: over.mode || h.mode || 'idle', route: h.route, loop: h.loop });
    }
    for (const c of fromCfg) {
      const key = String(c.id || c.key || '');
      if (!key || seen.has(key)) continue;
      if (this.hideout && !this._hasPos(c)) continue;
      if (this._hasPos(c)) createNpc(g, { ...c, key });
    }
    if (!this.hideout && this.mission && Array.isArray(this.mission.npcs)) {
      for (const d of this.mission.npcs) this.spawnNpcDef(d);
    }
  }

  _hasPos(c) {
    return Number.isFinite(c.x) && Number.isFinite(c.y) || !!c.at;
  }

  /** Create an NPC from a script definition ({ id|key, at: anchor|{x,y}, mode, ... }); returns it (or the existing one). */
  spawnNpcDef(d) {
    if (!d || typeof d !== 'object') return null;
    const key = String(d.id || d.key || '');
    if (!key) return null;
    const have = npcByKey(this.game, key);
    if (have) return have;
    const at = d.at !== undefined ? this.anchor(d.at) : Number.isFinite(d.x) ? { x: d.x, y: d.y } : this.centre();
    const pos = this.freeNear(at.x, at.y, 40);
    return createNpc(this.game, { ...d, key, x: pos.x, y: pos.y, angle: d.angle || 0 });
  }

  /**
   * Waves the game's own `settings.waves` should hold: the number of stops of an `evac` step,
   * the wave count that gives a `campaignStage` its hill waves; else `dflt`.
   */
  plannedWaves(dflt) {
    if (this.hideout) return 0;
    const evac = this.steps.find((s) => s.type === 'evac');
    if (evac) return Math.max(1, (evac.def.stops || []).length);
    const hill = this.steps.find((s) => s.type === 'campaignStage' && s.def.stage === 'hill');
    const floors = this.map.campaign ? this.map.campaign.floors.length : 3;
    if (hill && hill.def.waves > 0) {
      const want = Math.max(3, Math.floor(hill.def.waves));
      for (let w = 1; w <= 60; w++) if (wavePlan(w, floors).hill === want) return w;
    }
    if (this.steps.some((s) => s.type === 'campaignStage')) return dflt || 15;
    return 0;
  }

  /** The game built its zone director: give it the mission's stops (before its first announcement). */
  configureZone(zone) {
    const evac = this.steps.find((s) => s.type === 'evac');
    if (!evac) return;
    const stops = (evac.def.stops || []).map((a) => this.anchor(a)).filter(Boolean);
    if (stops.length) zone.setStops(stops);
  }

  /** Bend the game's own directors to the mission (the stage a campaign mission starts on). */
  _prepareUnderlying() {
    const g = this.game;
    if (g.campaign) {
      const first = this.steps.find((s) => s.type === 'campaignStage');
      if (first) g.campaign.startAt(String(first.def.stage || 'hill'));
      g.timer = Math.max(g.timer, 8);
    }
  }

  /**
   * Spawn rectangles for the game's wave spawner (zombies.js pickSpawnRect) while a `waves` /
   * `defend` step has an `at` anchor: boxes on a ring around it. Null = the map's own spawns.
   */
  spawnRects() {
    for (const s of this.active) {
      if ((s.type !== 'waves' && s.type !== 'defend') || s.def.at === undefined) continue;
      const a = this.anchor(s.def.at);
      if (!a) continue;
      if (!s.ring) s.ring = this._ring(a.x, a.y);
      if (s.ring.length) return { rects: s.ring, far: 500 };
    }
    return null;
  }

  _ring(cx, cy) {
    const g = this.game, out = [];
    for (let k = 0; k < 28; k++) {
      const a = ((k + 0.5) / 28) * TAU;
      for (let j = 0; j < 3; j++) {
        const d = 560 + j * 130;
        const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
        if (x < 90 || y < 90 || x > this.map.width - 90 || y > this.map.height - 90) continue;
        if (!g.world.isCircleFree(x, y, 36, false, MASK_MOVE)) continue;
        if (componentAt(g.flow, this.comp, x, y) !== this.mainComp) continue;
        out.push({ x, y, w: 72, h: 72 });
        break;
      }
    }
    return out;
  }

  /** True when the game's zone / campaign director drives the waves (the mission only watches). */
  ownsWaves() {
    return !!(this.game.zone || this.game.campaign);
  }

  // -----------------------------------------------------------------------------------
  // The step chain

  _startNext() {
    while (this.cursor < this.steps.length) {
      const s = this.steps[this.cursor++];
      this._startStep(s);
      if (s.state === 'done') continue;
      if (s.parallel || s.optional) continue;
      this.lead = s;
      return;
    }
    this.lead = null;
  }

  _startStep(s) {
    s.state = 'active';
    s.t0 = this.time;
    s.press = null;
    const d = s.def;
    this.active.push(s);
    if (!s.impl) {
      s.state = 'done';
      this.active.splice(this.active.indexOf(s), 1);
      return;
    }
    this._stepNpcs(d);
    s.impl.start(this, s);
    s.text = d.text !== undefined ? clampText(d.text, 88) : clampText(defaultText(this, s), 88);
    if (d.onStart) this.say(d.onStart);
    if (s.text) this._objective(s, 'start');
    // zombies while the step has no waves of its own (bonus steps add none of their own)
    if (s.press === null && d.pressure !== false && !s.impl.ownWaves && !s.bonus) {
      if (d.pressure) this.setPressure(s, d.pressure);
      else if (s.impl.pressure && !s.optional) this.setPressure(s, s.impl.pressure);
    }
    // bonus steps that were waiting for this one
    if (this.bonusSteps.length && !s.bonus) {
      for (const b of this.bonusSteps) if (b.state === 'wait' && b.def.since === s.id) this._startStep(b);
    }
  }

  /** NPC housekeeping every step may carry: npcs (spawn), follow, unfollow, remove. */
  _stepNpcs(d) {
    const g = this.game;
    if (Array.isArray(d.npcs)) for (const nd of d.npcs) this.spawnNpcDef(nd);
    if (Array.isArray(d.follow)) for (const key of d.follow) {
      const n = npcByKey(g, key) || this.spawnNpcDef({ id: key });
      if (n) {
        n.mode = 'follow';
        n.arrived = false;
      }
    }
    if (Array.isArray(d.unfollow)) for (const key of d.unfollow) {
      const n = npcByKey(g, key);
      if (n) {
        n.mode = 'idle';
        n.home.x = n.x;
        n.home.y = n.y;
      }
    }
    if (Array.isArray(d.remove)) for (const key of d.remove) {
      const n = npcByKey(g, key);
      if (n) g.removeNpc(n);
    }
  }

  _endStep(s, result) {
    if (s.state !== 'active') return;
    s.state = result === DONE ? 'done' : result === FAIL ? 'failed' : 'cancelled';
    const i = this.active.indexOf(s);
    if (i >= 0) this.active.splice(i, 1);
    if (s.impl && s.impl.stop) s.impl.stop(this, s, result);
    s.press = null;
    if (result === DONE) {
      const d = s.def;
      if (d.onDone) this.say(d.onDone);
      if (d.flags && typeof d.flags === 'object') for (const k of Object.keys(d.flags)) this.flags[k] = !!d.flags[k];
      if (typeof d.setFlag === 'string') this.flags[d.setFlag] = true;
      if (s.text) this._objective(s, 'done');
      if (d.supply !== false && s.impl && s.impl.supply !== false && !s.optional) this.checkpoint(s);
    }
  }

  /** A step that finished: everyone standing is patched up a little, the fallen return. */
  checkpoint(s) {
    const g = this.game;
    let i = 0;
    for (const p of g.players) {
      if (p.state === 'dead') respawnPlayer(g, p, i);
      else if (p.state === 'downed') revivePlayer(g, p, 0);
      i++;
    }
  }

  _objective(s, what) {
    this.game.emit({
      type: 'objective', what, step: s.i, id: s.id, text: s.text, cur: Math.round(s.cur), max: Math.round(s.max),
    });
  }

  /** Mission over: victory. */
  _victory() {
    if (this.ended) return;
    this.game._victory();
  }

  // -----------------------------------------------------------------------------------
  // Per tick

  /** One tick (after the phase update, before the players move). */
  update() {
    const g = this.game;
    if (!this.started) return;
    this.time += DT;
    if (this.hideout) return;
    if (this.ended || g.over) {
      return;
    }
    this._speak();
    this._pickupItems();
    this._respawns();
    this._timers();
    const act = this.active;
    for (let k = 0; k < act.length; k++) {
      const s = act[k];
      if (s.state !== 'active') continue;
      const impl = s.impl;
      const r = impl.update(this, s);
      if (s.press) this._pressure(s);
      if (s.def.timeout > 0 && this.time - s.t0 > s.def.timeout && r === RUN) {
        this._objective(s, 'fail');
        g._gameOver('timeout');
        return;
      }
      if (s.cur !== s.shownCur) {
        // (counts only: a timer, a hold or a percentage is in the snapshot every frame anyway)
        if (s.shownCur >= 0 && s.text && s.max > 0 && s.max <= 30 && !impl.timed) this._objective(s, 'progress');
        s.shownCur = s.cur;
      }
      if (r === DONE) this._endStep(s, DONE);
      else if (r === FAIL) {
        this._objective(s, 'fail');
        this._endStep(s, FAIL);
        g._gameOver('failed');
        return;
      }
      if (g.over) return;
    }
    this._advance();
  }

  _advance() {
    const act = this.active;
    if (this.lead && this.lead.state !== 'active') {
      // the lead is over: background steps end with it (except the ones that must finish)
      let waiting = false;
      for (const s of act.slice()) {
        if (s.optional) continue;
        if (s.required) waiting = true;
        else this._endStep(s, RUN);
      }
      if (!waiting) this._startNext();
    } else if (!this.lead && this.cursor >= this.steps.length) {
      let blocking = false;
      for (const s of act) if (!s.optional) blocking = true;
      if (!blocking) this.complete = true;
    }
    if (this.complete || (!this.lead && this.cursor >= this.steps.length && !act.some((s) => !s.optional))) {
      this.complete = true;
      this._victory();
    }
  }

  /** Scripted things that happen a moment later (the blasts of an `explode` activation) and the end of a lure. */
  _timers() {
    const g = this.game;
    if (g.lure && this.time >= g.lure.until) {
      g.lure = null;
      g.rebuildFlowNow();
    }
    const list = this.timers;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.t -= DT;
      if (q.t > 0) continue;
      list.splice(i, 1);
      q.fn();
    }
  }

  /** Run `fn` after `sec` seconds of mission time. */
  later(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  /** The game asks each tick whether the mission has ended (true = handled). */
  checkEnd() {
    const g = this.game;
    if (this.hideout) return true;
    if (this.ended) return true;
    if (this.mission && this.mission.timeLimit > 0 && this.time > this.mission.timeLimit) {
      g._gameOver('timeout');
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------------------
  // Radio / say lines

  /** Queue subtitle lines: [{ who, text, ms?, kind? }, ...] (kind 'say' = spoken in person). */
  say(lines, defaultKind = 'radio') {
    const list = Array.isArray(lines) ? lines : [lines];
    for (const l of list) {
      const n = normLine(l, defaultKind);
      if (n) this.lineQ.push(n);
    }
  }

  /** True while lines are still being shown. */
  lineBusy() {
    return this.lineQ.length > 0 || this.lineT > 0;
  }

  _speak() {
    if (this.lineT > 0) this.lineT -= DT;
    if (this.lineT <= 0 && this.lineQ.length) {
      const l = this.lineQ.shift();
      this.game.emit({ type: 'radio', who: l.who, text: l.text, ms: l.ms, kind: l.kind });
      this.lineT = l.ms / 1000 + 0.3;
    }
  }

  // -----------------------------------------------------------------------------------
  // Anchors and places

  /** {x, y, r} of an anchor name, a map interactable id or a point; null when unknown. */
  anchor(ref) {
    if (ref && typeof ref === 'object' && Number.isFinite(ref.x) && Number.isFinite(ref.y)) return { x: ref.x, y: ref.y, r: ref.r || 120 };
    const a = this.map.anchors && this.map.anchors[ref];
    if (a) return a;
    const it = this.game.interactables.find((q) => q.id === ref);
    if (it) return { x: it.x, y: it.y, r: it.r };
    return null;
  }

  /** Alive survivors (standing or downed, not escaped). */
  crew() {
    const out = [];
    for (const p of this.game.players) if (p.state !== 'dead' && !p.escaped) out.push(p);
    return out;
  }

  /** Centre of the survivors still on their feet (else of everyone; else the first player spawn). */
  centre() {
    let x = 0, y = 0, n = 0;
    for (const p of this.game.players) {
      if (p.state !== 'alive' || p.escaped) continue;
      x += p.x;
      y += p.y;
      n++;
    }
    if (!n) {
      for (const p of this.game.players) {
        if (p.state === 'dead' || p.escaped) continue;
        x += p.x;
        y += p.y;
        n++;
      }
    }
    if (n) return { x: x / n, y: y / n };
    const sp = this.map.playerSpawns && this.map.playerSpawns[0];
    return sp ? { x: sp.x, y: sp.y } : { x: this.map.width / 2, y: this.map.height / 2 };
  }

  /** A clear spot within `r` of (x, y) (the point itself when clear), spiralling outward. */
  freeNear(x, y, r = 60, pad = PLAYER_RADIUS + 6) {
    const w = this.game.world;
    if (w.isCircleFree(x, y, pad, false)) return { x, y };
    for (let d = 16; d <= Math.max(r, 200); d += 16) {
      const n = Math.max(6, Math.round((TAU * d) / 28));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
        if (w.isCircleFree(cx, cy, pad, false)) return { x: cx, y: cy };
      }
    }
    return { x, y };
  }

  /** Where the first survivors stand: around `mission.startAt` (an anchor), else the map's spawns. */
  startPoint(i) {
    const m = this.mission;
    if (!m || m.startAt === undefined) return null;
    const a = this.anchor(m.startAt);
    if (!a) return null;
    const ang = (i * TAU) / 6 + 0.5;
    const d = i === 0 ? 0 : 46 + Math.floor(i / 6) * 40;
    const p = this.freeNear(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d, 120);
    return { x: p.x, y: p.y };
  }

  /** Where respawns and late joiners appear: beside a survivor on their feet. */
  spawnPoint(i) {
    const g = this.game;
    let best = null;
    for (const p of g.players) {
      if (p.state === 'alive' && !p.escaped) {
        best = p;
        break;
      }
    }
    if (!best) for (const p of g.players) if (p.state === 'downed') { best = p; break; }
    if (!best) {
      const s = this.startPoint(i);
      if (s) return s;
      const sp = this.map.playerSpawns;
      return sp && sp.length ? sp[i % sp.length] : { x: this.map.width / 2, y: this.map.height / 2 };
    }
    const a0 = (i * TAU) / 6 + 0.4;
    for (let ring = 0; ring < 4; ring++) {
      const d = 50 + ring * 36;
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k * TAU) / 8;
        const x = best.x + Math.cos(a) * d, y = best.y + Math.sin(a) * d;
        if (!g.world.isCircleFree(x, y, PLAYER_RADIUS + 4, true)) continue;
        return { x, y };
      }
    }
    return { x: best.x, y: best.y };
  }

  _respawns() {
    const g = this.game;
    if (this.respawnDelay <= 0) return;
    let alive = false;
    for (const p of g.players) if (p.state === 'alive') alive = true;
    let i = 0;
    for (const p of g.players) {
      if (p.state !== 'dead') {
        p.deadT = 0;
      } else {
        p.deadT = (p.deadT || 0) + DT;
        if (alive && p.deadT >= this.respawnDelay) {
          respawnPlayer(g, p, i);
          p.deadT = 0;
          p.hp = Math.min(p.maxHp, Math.max(p.hp, RESPAWN_HP * 0.6));
        }
      }
      i++;
    }
  }

  // -----------------------------------------------------------------------------------
  // Story items

  /** Put a story pickup on the ground; returns its record. */
  addItem(item, x, y, step, note = '') {
    const it = { id: this._itemId++, item: isItemId(item) ? item : 'crate', x, y, step: step || null, note: String(note || '').slice(0, 24) };
    this.items.push(it);
    return it;
  }

  /** Remove every story item that belongs to `step`. */
  clearItems(step) {
    this.items = this.items.filter((it) => it.step !== step);
  }

  _pickupItems() {
    const items = this.items;
    if (!items.length) return;
    const g = this.game;
    const R2 = ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      for (const p of g.players) {
        if (p.state !== 'alive' || p.escaped) continue;
        const dx = p.x - it.x, dy = p.y - it.y;
        if (dx * dx + dy * dy > R2) continue;
        items.splice(i, 1);
        p.storyItems = (p.storyItems | 0) + 1;
        this.itemCount[it.item] = (this.itemCount[it.item] | 0) + 1;
        const step = it.step;
        if (step && step.impl && step.impl.onItem) step.impl.onItem(this, step, it, p);
        const of = step && step.max ? Math.round(step.max) : 0;
        g.emit({ type: 'item', pid: p.id, item: it.item, note: it.note || '', x: Math.round(it.x), y: Math.round(it.y), n: step ? Math.round(step.cur) : this.itemCount[it.item], of });
        break;
      }
    }
  }

  /** A terminal / generator / repair spot at (x, y): an interactable the step owns. */
  addTerminal(step, x, y, def = {}) {
    return addInteractable(this.game, { ...def, x, y, step, once: def.once !== false });
  }

  // -----------------------------------------------------------------------------------
  // Pressure: zombies while a step has no waves of its own

  /**
   * Give step `s` a stream of zombies. cfg (STORY.md §5.4 `pressure`):
   *   waves     the VIRTUAL WAVE NUMBER the zombies are scaled for (hp, speed, the type mix: walkers at 1,
   *             runners from 2, crawlers 3, bloaters + spitters 4, brutes 5, screamers 6); `tier` is an alias
   *   pace      spawn tempo as a multiple of a normal wave's at that number (1 = a wave's tempo)
   *   specials  zombie types forced into the mix
   *   at        anchor the zombies come towards (default: the survivors)   cap  most zombies alive at once
   *   delay     seconds before the first group
   * The stream sends groups the way a wave does (4..6+ at a time from one spot on open ground 650..1000 px
   * away); with `size` / `every` / `scale` / `bursts` set it sends fixed bursts instead ({size or scale x a
   * wave} every `every` s, `bursts` of them, unlimited by default).
   */
  setPressure(s, cfg) {
    if (!cfg || typeof cfg !== 'object') {
      s.press = null;
      return;
    }
    const g = this.game;
    const tier = Math.max(1, Math.min(30, Math.round(cfg.tier || cfg.waves || s.def.tier || this.tier)));
    const players = Math.max(1, g.players.length);
    const pace = cfg.pace > 0 ? cfg.pace : 1;
    const specials = Array.isArray(cfg.specials) ? cfg.specials.filter((t) => typeof t === 'string') : [];
    const burst = cfg.size > 0 || cfg.every > 0 || cfg.scale > 0 || cfg.bursts >= 0;
    const pr = {
      tier, pace, specials, burst,
      at: cfg.at !== undefined ? cfg.at : null,
      cap: cfg.cap > 0 ? cfg.cap : Math.min(g.diff.maxAlive, 18 + 8 * players),
      t: cfg.delay >= 0 ? cfg.delay : 5 + this.rng.range(0, 5),
      left: Number.isFinite(cfg.bursts) && cfg.bursts >= 0 ? Math.floor(cfg.bursts) : Infinity,
      size: 0, every: 0,
    };
    if (burst) {
      const wave = waveZombieCount(tier, players, g.diff);
      pr.size = Math.max(2, Math.round(cfg.size > 0 ? cfg.size : wave * (cfg.scale > 0 ? cfg.scale : 0.3)));
      pr.every = Math.max(4, (cfg.every > 0 ? cfg.every : 30) / pace);
    }
    s.press = pr;
  }

  /** Seconds between two groups of a stream at virtual wave `w` and `pace` (a wave's own rhythm, sim/zombies.js). */
  _groupGap(w, pace) {
    const g = this.game, sp = SPAWN_PACING;
    const crowd = (1 + WAVE_ZOMBIES.perPlayer * (Math.max(1, g.players.length) - 1)) * g.diff.count;
    const base = Math.max(sp.min, Math.min(sp.start, sp.start - sp.perWave * (w - 1)));
    return (base / Math.pow(Math.max(1, crowd), sp.crowdExp)) * this.rng.range(0.75, 1.25) / pace;
  }

  _pressure(s) {
    const pr = s.press;
    if (!pr) return;
    pr.t -= DT;
    if (pr.t > 0 || pr.left <= 0) return;
    const g = this.game;
    let alive = 0;
    for (const z of g.zombies) if (!z.dead) alive++;
    if (alive >= pr.cap) {
      pr.t = 1.5;
      return;
    }
    const at = pr.at !== null ? this.anchor(pr.at) : null;
    const c = at || this.centre();
    if (pr.burst) {
      this.burst(c.x, c.y, pr.size, pr.tier, pr.specials, at ? 200 : 0);
      pr.left--;
      pr.t = pr.every * this.rng.range(0.8, 1.25);
    } else {
      const sp = SPAWN_PACING;
      const n = Math.min(this.rng.int(sp.groupMin, sp.groupMax + Math.floor(pr.tier / sp.groupPerWaves)), pr.cap - alive);
      this.burst(c.x, c.y, n, pr.tier, pr.specials, at ? 200 : 0, 0.25);
      pr.t = this._groupGap(pr.tier, pr.pace);
    }
    this.stats.bursts++;
  }

  /**
   * Send `n` zombies (types by the mix of virtual wave `tier`) at (fx, fy) from a ring of open ground
   * 650..1000 px away, behind the survivors' backs when possible. `specials` are forced into the mix:
   * `share` > 0 makes that fraction of the group one of them, else one of each is added to the group.
   */
  burst(fx, fy, n, tier, specials, inner = 0, share = 0) {
    const g = this.game;
    const spot = this.ringSpot(fx, fy, 650 + inner, 1000 + inner, 560);
    if (!spot) return 0;
    const saved = g.wave;
    g.wave = tier - g.tierBonus;
    let made = 0;
    const list = [];
    for (let i = 0; i < n; i++) {
      if (share > 0 && specials.length && this.rng.chance(share)) list.push(specials[this.rng.int(0, specials.length - 1)]);
      else list.push(g.pickZombieType(tier));
    }
    if (!(share > 0)) for (const t of specials) list.push(t);
    for (const type of list) {
      if (!ZOMBIES[type]) continue;
      const x = spot.x + this.rng.range(-70, 70), y = spot.y + this.rng.range(-70, 70);
      const ok = g.world.isCircleFree(x, y, 26, true);
      g.spawnZombieAt(type, ok ? x : spot.x, ok ? y : spot.y);
      made++;
    }
    g.wave = saved;
    this.stats.spawned += made;
    return made;
  }

  /** A clear, connected spot on a ring around (fx, fy) at least `far` px from every survivor, else null. */
  ringSpot(fx, fy, lo, hi, far) {
    const g = this.game, rng = this.rng;
    const W = this.map.width, H = this.map.height;
    let best = null, bd = -1;
    for (let tries = 0; tries < 14; tries++) {
      const a = rng.range(0, TAU), d = rng.range(lo, hi);
      const x = fx + Math.cos(a) * d, y = fy + Math.sin(a) * d;
      if (x < 80 || y < 80 || x > W - 80 || y > H - 80) continue;
      if (!g.world.isCircleFree(x, y, 40, true)) continue;
      if (componentAt(g.flow, this.comp, x, y) !== this.mainComp) continue;
      let nearest = Infinity;
      for (const p of g.players) {
        if (p.state === 'dead') continue;
        nearest = Math.min(nearest, Math.hypot(p.x - x, p.y - y));
      }
      if (nearest >= far) return { x, y };
      if (nearest > bd) {
        bd = nearest;
        best = { x, y };
      }
    }
    return bd >= far * 0.7 ? best : null;
  }

  /** Ammo, first aid and armour on the ground near (x, y). */
  dropSupplies(x, y) {
    const g = this.game;
    const n = g.players.length;
    const loot = ['armor'];
    for (let i = 0; i < 1 + (n >> 1); i++) loot.push('ammo');
    for (let i = 0; i < 1 + Math.floor(n / 3); i++) loot.push('health');
    loot.forEach((kind, i) => {
      const a = (i / loot.length) * TAU + 0.5;
      const p = this.freeNear(x + Math.cos(a) * 60, y + Math.sin(a) * 60, 80, 14);
      spawnPickup(g, kind, p.x, p.y, null, Math.max(PICKUP_LIFETIME, 90));
    });
    g.emit({ type: 'drop', x: Math.round(x), y: Math.round(y) });
  }

  // -----------------------------------------------------------------------------------
  // Objective (a defend step) and waves of the step runner

  /** Turn the map's objective on (a defend step); returns it. */
  enableObjective() {
    const g = this.game, o = this.map.objective;
    if (!o) return null;
    if (!g.objective) {
      const hp = Math.round(o.hp * (1 + OBJECTIVE_HP_PER_PLAYER * (Math.max(1, g.players.length) - 1)));
      g.objective = { hp, maxHp: hp };
    }
    g.rebuildFlowNow();
    return g.objective;
  }

  disableObjective() {
    const g = this.game;
    g.objective = null;
    g.rebuildFlowNow();
  }

  /** A wave is on: aim `count` zombies at the game's spawner (game.spawnQueue). */
  startWave(tier, boss, gapSpawn = 2, scale = 1) {
    const g = this.game;
    g.wave = tier - g.tierBonus;
    const players = Math.max(1, g.players.length);
    g.wavePlayers = players;
    // (a script's waves never get the automatic every-fifth-wave discount: bosses come from `boss` steps)
    const auto = tier % BOSS_EVERY === 0 ? WAVE_ZOMBIES.bossWave : 1;
    g.waveTotal = Math.max(3, Math.round((waveZombieCount(tier, players, g.diff) / auto) * (boss ? 0.65 : 1) * scale * this.waveScale));
    g.waveBosses = boss ? Math.ceil(players / 3) : 0;
    g.bossQueue = g.waveBosses;
    g.bossTimer = 10;
    g.spawnQueue = g.waveTotal;
    g.spawnTimer = gapSpawn;
    g.emit({ type: 'wave', wave: g.wave, boss: g.waveBosses > 0 });
  }

  /** True when nothing more will spawn and nothing is alive. */
  fieldClear() {
    const g = this.game;
    if (g.spawnQueue > 0 || g.bossQueue > 0) return false;
    for (const z of g.zombies) if (!z.dead) return false;
    return true;
  }

  /** A wave of a step ended: bonus cash, the fallen return, a little loot. */
  waveCleared(wave) {
    const g = this.game;
    g.emit({ type: 'waveclear', wave, bonus: WAVE_CLEAR_BONUS });
    for (const p of g.players) {
      p.cash += WAVE_CLEAR_BONUS;
      p.earned += WAVE_CLEAR_BONUS;
    }
    this.checkpoint(null);
    for (const h of g.hazards) if (h.kind === 'acid') h.life = 0;
    const c = this.centre();
    this.dropSupplies(c.x, c.y);
  }

  // -----------------------------------------------------------------------------------
  // Events from the sim

  /** A zombie died. */
  onKill(z, by) {
    if (this.hideout || this.ended) return;
    for (const s of this.active) if (s.impl && s.impl.onKill) s.impl.onKill(this, s, z, by);
  }

  /** A survivor finished an interactable. */
  onInteract(it, p) {
    const s = it.step;
    if (s && s.state === 'active' && s.impl && s.impl.onInteract) s.impl.onInteract(this, s, it, p);
  }

  /** A survivor talked to an NPC. */
  onTalk(n, p) {
    if (this.hideout) return;
    for (const s of this.active) if (s.impl && s.impl.onTalk) s.impl.onTalk(this, s, n, p);
  }

  onNpcDown(n) {
    if (this.hideout) return;
    for (const s of this.active) if (s.impl && s.impl.onNpcDown) s.impl.onNpcDown(this, s, n);
  }

  onNpcUp(n) {
    if (this.hideout) return;
    for (const s of this.active) if (s.impl && s.impl.onNpcUp) s.impl.onNpcUp(this, s, n);
  }

  onNpcDead(n) {
    if (this.hideout || this.ended) return;
    if (n.critical) this.game._gameOver('npc');
  }

  /**
   * A wave of the game's own director was cleared. Returns true when the mission takes over
   * (the phase is left to it), false to let the game go on to its next wave.
   */
  onWaveClear(w) {
    if (this.hideout || this.ended) return false;
    let handled = false;
    for (const s of this.active.slice()) {
      if (s.impl && s.impl.onWaveClear && s.impl.onWaveClear(this, s, w)) handled = true;
    }
    return handled;
  }

  /** The game ended (victory, or a game over of any kind): announce the result once. */
  onEnd(result, reason = '') {
    if (this.ended || this.hideout) return;
    const g = this.game;
    this.ended = result;
    for (const s of this.active.slice()) this._endStep(s, RUN);
    const stats = {};
    let downs = 0;
    for (const p of g.players) {
      stats[p.id] = {
        name: p.name, kills: p.kills, downs: p.downs, revives: p.revives, damage: Math.round(p.damage), items: p.storyItems | 0,
      };
      downs += p.downs;
    }
    // "collect everything": every optional step and every bonus step of the script is done
    let optionalDone = true;
    for (const s of this.steps) if (s.optional && s.state !== 'done') optionalDone = false;
    for (const s of this.bonusSteps) if (s.state !== 'done') optionalDone = false;
    const st = (this.mission && this.mission.stars) || {};
    let stars = 0;
    const met = { time: false, noDowns: false, optional: false, perfect: false };
    if (result === 'victory') {
      // 1 star for the win, 1 for beating the time, 1 for the clean run (no downs and, when asked, every bonus)
      if (st.time > 0 && this.time <= st.time) met.time = true;
      if (st.noDowns && downs === 0) met.noDowns = true;
      if (st.optional && optionalDone) met.optional = true;
      met.perfect = !!(st.noDowns || st.optional) && (!st.noDowns || met.noDowns) && (!st.optional || met.optional);
      stars = 1 + (met.time ? 1 : 0) + (met.perfect ? 1 : 0);
    }
    g.emit({
      type: 'storyend', result, reason: result === 'victory' ? '' : String(reason || 'wiped'), mission: this.missionId,
      stars, met, time: Math.round(this.time * 10) / 10, downs, stats, items: { ...this.itemCount }, flags: { ...this.flags },
    });
  }

  // -----------------------------------------------------------------------------------
  // Snapshot

  /** Snapshot.story (STORY.md §5.1): the objective tracker, the markers, the items on the ground. */
  snapshot() {
    const g = this.game;
    const out = { mode: this.hideout ? 'hideout' : 'mission', time: Math.round(this.time * 10) / 10, steps: [], marks: [], items: [], downs: 0 };
    if (this.hideout) return out;
    for (const p of g.players) out.downs += p.downs;
    const show = [];
    for (const s of this.active) if (s.state === 'active' && s.text) show.push(s);
    show.sort((a, b) => Number(a.optional) - Number(b.optional) || a.i - b.i);
    for (const s of show) {
      if (out.steps.length >= MAX_ACTIVE_SHOWN) break;
      out.steps.push({
        i: s.i, kind: s.type === 'custom' ? 'custom' : s.type, text: s.text,
        cur: Math.round(s.cur), max: Math.round(s.max), t: Math.round(Math.max(0, s.t) * 10) / 10, total: Math.round(s.total * 10) / 10,
        opt: s.optional,
      });
    }
    // markers
    const marks = this._marks;
    marks.length = 0;
    const add = (kind, x, y, r = 0) => {
      if (marks.length < MAX_MARKS) marks.push({ kind, x: Math.round(x), y: Math.round(y), r: Math.round(r) });
    };
    for (const s of show) if (s.impl && s.impl.marks) s.impl.marks(this, s, add);
    for (const m of marks) out.marks.push(m);
    const cx = this.centre();
    const near = this.items.slice();
    if (near.length > MAX_ITEMS_SNAP) near.sort((a, b) => Math.hypot(a.x - cx.x, a.y - cx.y) - Math.hypot(b.x - cx.x, b.y - cx.y));
    for (let i = 0; i < near.length && i < MAX_ITEMS_SNAP; i++) out.items.push({ id: near[i].id, item: near[i].item, x: near[i].x, y: near[i].y });
    return out;
  }

  // -----------------------------------------------------------------------------------
  // Bots

  /**
   * A goal for bot `b` from the active steps: { mode, x, y, r, use? } or null (defend / fight as usual).
   * Bots keep within `LEASH` of the humans when there are any.
   */
  botGoal(b, index) {
    if (this.hideout || this.ended) return null;
    // the lead first, then the steps that run beside it, the optional ones last
    let goal = null;
    for (const pass of [0, 1]) {
      for (const s of this.active) {
        if (s.state !== 'active' || !s.impl || !s.impl.goal || Number(s.optional) !== pass) continue;
        goal = s.impl.goal(this, s, b, index);
        if (goal) return goal;
      }
    }
    return null;
  }
}

export { MARKER_KINDS };
