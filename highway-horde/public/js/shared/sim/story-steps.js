// The step types of a mission script (STORY.md §5.4), one handler each. sim/story.js runs
// them; every handler is a plain object of optional functions:
//
//   start(dir, s)             once, when the step begins (place items, spawn a pack ...)
//   update(dir, s)            every tick while it runs → RUN | DONE | FAIL
//   stop(dir, s, result)      when it ends (or is cancelled by the step it ran beside)
//   label(dir, s)             the HUD line when the script gives no `text`
//   marks(dir, s, add)        objective markers: add(kind, x, y, r)
//   goal(dir, s, bot, index)  where a bot should go: { mode, x, y, r, use? } or null
//   onKill / onItem / onInteract / onTalk / onNpcDown / onNpcUp / onWaveClear   sim events
//   pressure                  the step's default stream of bursts (see StoryDirector.setPressure)
//
// `dir` is the StoryDirector, `s` the step's runtime record (`s.def` is the script's step:
// its parameters are documented in STORY.md §5.4 and checked by story/validate.js).

import { DT } from '../constants.js';
import { ZOMBIES } from '../zombies.js';
import { itemInfo } from '../story-defs.js';
import { TAU } from '../math.js';
import { componentAt } from './zone.js';
import { pickType } from './zombies.js';
import { createNpc, npcByKey } from './npcs.js';
import { SUB } from '../campaign.js';
import { explode } from './combat.js';

const RUN = 0, DONE = 1, FAIL = -1;
const REACH_MARGIN = 20;

function anchorsOf(dir, ref) {
  const list = Array.isArray(ref) ? ref : ref === undefined || ref === null ? [] : [ref];
  const out = [];
  for (const r of list) {
    const a = dir.anchor(r);
    if (a) out.push({ ref: r, ...a });
  }
  return out;
}

function alivePlayers(dir) {
  const out = [];
  for (const p of dir.game.players) if (p.state === 'alive' && !p.escaped) out.push(p);
  return out;
}

/** Text for the plural of an item ("fuel cans"). */
function itemPlural(id, n) {
  const nm = itemInfo(id).name.toLowerCase();
  return n === 1 ? nm : nm.endsWith('s') ? nm : `${nm}s`;
}

/**
 * The bots' leash: distance from (x, y) to the nearest living human, or 0 when there is
 * no human to stay near (an all-bot team, or every human is dead).
 */
function nearestHuman(dir, x, y) {
  let d = Infinity, any = false;
  for (const p of dir.game.players) {
    if (p.bot || p.state === 'dead') continue;
    any = true;
    d = Math.min(d, Math.hypot(p.x - x, p.y - y));
  }
  return any ? d : 0;
}

// -------------------------------------------------------------------------------------
// Waves (defend, waves)

/** `pressure:{ waves, pace, specials }` of a step that runs waves of its own (the first wave's number, their tempo, forced types). */
function waveFeel(dir, s) {
  const pr = s.def.pressure && typeof s.def.pressure === 'object' ? s.def.pressure : {};
  return {
    tier: Math.max(1, Math.round(pr.waves || pr.tier || s.def.tier || dir.tier)),
    pace: pr.pace > 0 ? pr.pace : s.def.pace > 0 ? s.def.pace : 1,
    specials: Array.isArray(pr.specials) ? pr.specials.filter((t) => typeof t === 'string' && ZOMBIES[t]) : [],
  };
}

/** The virtual wave a kill / boss step's own zombies are scaled for (its pressure's `waves`, else the mission's tier). */
function killTier(dir, s) {
  const pr = s.def.pressure && typeof s.def.pressure === 'object' ? s.def.pressure : null;
  return Math.max(1, Math.round((pr && (pr.waves || pr.tier)) || s.def.tier || dir.tier));
}

/** How many of a script's "for a party of four" things a party of this size faces (0.5 .. 1.5 x). */
function partyScale(dir) {
  return Math.max(0.5, Math.min(1.5, Math.max(1, dir.game.players.length) / 4));
}

/** A step on the game's own wave machine (evac, campaignStage) bends its tempo and difficulty to `pressure`. */
function feelStart(dir, s) {
  const g = dir.game;
  const pr = s.def.pressure && typeof s.def.pressure === 'object' ? s.def.pressure : null;
  if (!pr) return;
  s.feel = { tierBonus: g.tierBonus, pace: g.spawnPace, force: g.forceTypes };
  if (pr.waves > 0) g.tierBonus = Math.max(0, Math.round(pr.waves) - 1);
  if (pr.pace > 0) g.spawnPace = pr.pace;
  const sp = Array.isArray(pr.specials) ? pr.specials.filter((t) => typeof t === 'string' && ZOMBIES[t]) : [];
  if (sp.length) g.forceTypes = sp;
}

function feelStop(dir, s) {
  if (!s.feel) return;
  const g = dir.game;
  g.tierBonus = s.feel.tierBonus;
  g.spawnPace = s.feel.pace;
  g.forceTypes = s.feel.force;
  s.feel = null;
}

function wavesStart(dir, s, total) {
  const feel = waveFeel(dir, s);
  s.tier = feel.tier;
  s.max = total;
  s.cur = 0;
  s.wv = { k: 0, state: 'pre', t: s.def.delay >= 0 ? s.def.delay : 3 };
  s.paceSaved = dir.game.spawnPace;
  dir.game.spawnPace = feel.pace;
  s.forceSaved = dir.game.forceTypes;
  dir.game.forceTypes = feel.specials.length ? feel.specials : null;
}

function wavesUpdate(dir, s) {
  const w = s.wv, g = dir.game;
  const startNext = () => {
    w.k++;
    dir.startWave(s.tier + w.k - 1, !!s.def.boss && w.k === s.max, 2, s.def.scale > 0 ? s.def.scale : 1);
    w.state = 'fight';
  };
  switch (w.state) {
    case 'pre':
      w.t -= DT;
      if (w.t <= 0) startNext();
      break;
    case 'fight':
      if (dir.fieldClear()) {
        s.cur = w.k;
        dir.waveCleared(g.wave);
        if (w.k >= s.max) return DONE;
        w.state = 'gap';
        w.t = s.def.gap >= 0 ? s.def.gap : 8;
        if (s.def.heal !== 0 && g.objective) g.objective.hp = Math.min(g.objective.maxHp, g.objective.hp + g.objective.maxHp * (s.def.heal > 0 ? s.def.heal : 0.15));
      }
      break;
    default:
      w.t -= DT;
      if (w.t <= 0) startNext();
  }
  return RUN;
}

function wavesStop(dir, s) {
  const g = dir.game;
  g.spawnPace = s.paceSaved || 1;
  g.forceTypes = s.forceSaved || null;
  // a cancelled step leaves nothing queued behind
  if (s.wv && s.wv.state === 'fight') {
    g.spawnQueue = 0;
    g.bossQueue = 0;
  }
}

// -------------------------------------------------------------------------------------

/**
 * What a finished `activate` does besides ticking the objective:
 *   effect 'lure'    { lure: { to: anchor, seconds } } the noise draws the horde to that place for a while
 *   effect 'explode' { blast: { at: anchor, r, damage } } a scripted explosion (three blasts in a second) that hurts zombies only
 */
function activateEffect(dir, s) {
  const d = s.def, g = dir.game;
  if (s.fx) return;
  s.fx = true;
  if (d.effect === 'lure' && d.lure) {
    const a = dir.anchor(d.lure.to);
    if (a) {
      const secs = Math.max(5, Math.min(600, Number(d.lure.seconds) || 60));
      g.lure = { x: a.x, y: a.y, until: dir.time + secs, target: { x: a.x, y: a.y } };
      g.rebuildFlowNow();
      g.emit({ type: 'drop', x: Math.round(a.x), y: Math.round(a.y) });
    }
  } else if (d.effect === 'explode' && d.blast) {
    const a = dir.anchor(d.blast.at);
    if (a) {
      const r = Math.max(60, Math.min(600, Number(d.blast.r) || 240)), dmg = Math.max(1, Number(d.blast.damage) || 300);
      const spread = r * 0.35;
      for (let k = 0; k < 3; k++) {
        const ang = k * 2.1 + 0.4;
        const x = a.x + Math.cos(ang) * spread * (k ? 1 : 0), y = a.y + Math.sin(ang) * spread * (k ? 1 : 0);
        dir.later(k * 0.4, () => explode(g, x, y, r, 0, null, 'rocket', { zombieDmg: dmg, playerDmg: 0, structDmg: 0, credit: s.by || 0 }));
      }
    }
  }
}

export const STEP_IMPL = {
  // ---- defend ------------------------------------------------------------------------
  defend: {
    supply: true,
    ownWaves: true,
    label(dir, s) {
      const o = dir.map.objective;
      const nm = o ? o.name : 'the objective';
      return s.def.seconds > 0 ? `Defend ${nm}` : `Defend ${nm}: wave ${Math.min(s.max, s.cur + 1)} of ${s.max}`;
    },
    start(dir, s) {
      const d = s.def;
      dir.enableObjective();
      if (d.seconds > 0) {
        s.timed = true;
        s.max = d.seconds;
        s.total = d.seconds;
        s.t = d.seconds;
        s.tier = Math.max(1, Math.round(d.tier || dir.tier));
        dir.setPressure(s, d.pressure || { pace: 0.4, tier: s.tier });
      } else {
        wavesStart(dir, s, Math.max(1, Math.floor(d.waves) || 3));
      }
    },
    update(dir, s) {
      if (s.timed) {
        const el = dir.time - s.t0;
        s.cur = Math.min(s.max, Math.floor(el));
        s.t = Math.max(0, s.max - el);
        return el >= s.max ? DONE : RUN;
      }
      return wavesUpdate(dir, s);
    },
    stop(dir, s) {
      if (!s.timed) wavesStop(dir, s);
      dir.disableObjective();
    },
    marks(dir, s, add) {
      const o = dir.map.objective;
      if (o) add('defend', o.x, o.y, Math.max(o.w, o.h) / 2);
    },
    goal() {
      return null;
    },
  },

  // ---- waves -------------------------------------------------------------------------
  waves: {
    supply: true,
    ownWaves: true,
    label(dir, s) {
      return `Survive the waves: ${Math.min(s.max, s.cur + 1)} of ${s.max}`;
    },
    start(dir, s) {
      wavesStart(dir, s, Math.max(1, Math.floor(s.def.count) || 3));
    },
    update: wavesUpdate,
    stop: wavesStop,
    marks(dir, s, add) {
      if (s.def.at !== undefined) {
        const a = dir.anchor(s.def.at);
        if (a) add('reach', a.x, a.y, a.r);
      }
    },
    goal() {
      return null;
    },
  },

  // ---- survive -----------------------------------------------------------------------
  survive: {
    timed: true,
    pressure: { pace: 0.4 },
    label(dir, s) {
      return 'Survive';
    },
    start(dir, s) {
      const secs = Math.max(1, Number(s.def.seconds) || 60);
      s.max = secs;
      s.total = secs;
      s.t = secs;
    },
    update(dir, s) {
      const el = dir.time - s.t0;
      s.cur = Math.min(s.max, Math.floor(el));
      s.t = Math.max(0, s.max - el);
      return el >= s.max ? DONE : RUN;
    },
    marks(dir, s, add) {
      if (s.def.at !== undefined) {
        const a = dir.anchor(s.def.at);
        if (a) add('reach', a.x, a.y, a.r);
      }
    },
    goal(dir, s, b, index) {
      if (s.def.at === undefined) return null;
      const a = dir.anchor(s.def.at);
      if (!a) return null;
      const ang = ((index + 0.5) / Math.max(1, dir.game.bots.length)) * TAU;
      return { mode: 'quest', x: a.x + Math.cos(ang) * a.r * 0.4, y: a.y + Math.sin(ang) * a.r * 0.4, r: 60 };
    },
  },

  // ---- collect -----------------------------------------------------------------------
  collect: {
    pressure: { pace: 0.3 },
    label(dir, s) {
      return `Collect ${itemPlural(s.item, s.max)}`;
    },
    start(dir, s) {
      const d = s.def, g = dir.game;
      s.item = String(d.item || 'crate');
      const anchors = anchorsOf(dir, d.at);
      if (!anchors.length) anchors.push({ ref: null, ...dir.centre(), r: 300 });
      const count = Math.max(1, Math.floor(d.count) || 4);
      s.max = count;
      s.cur = 0;
      const rng = dir.rng;
      for (let i = 0; i < count; i++) {
        const a = anchors[i % anchors.length];
        const spread = (d.scatter > 0 ? d.scatter : a.r) * 0.8;
        let spot = null;
        for (let tries = 0; tries < 16 && !spot; tries++) {
          const ang = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * spread;
          const x = a.x + Math.cos(ang) * rr, y = a.y + Math.sin(ang) * rr;
          if (g.world.isCircleFree(x, y, 22, false) && componentAt(g.flow, dir.comp, x, y) === dir.mainComp) spot = { x, y };
        }
        if (!spot) spot = dir.freeNear(a.x, a.y, 120, 22);
        dir.addItem(s.item, spot.x, spot.y, s, d.note);
      }
    },
    update(dir, s) {
      return s.cur >= s.max ? DONE : RUN;
    },
    onItem(dir, s, it) {
      if (it.item === s.item) s.cur++;
    },
    stop(dir, s) {
      dir.clearItems(s);
    },
    marks(dir, s, add) {
      let n = 0;
      for (const it of dir.items) {
        if (it.step !== s) continue;
        add('item', it.x, it.y, 0);
        if (++n >= 8) break;
      }
    },
    goal(dir, s, b, index) {
      const p = b.p;
      let list = dir.items.filter((it) => it.step === s);
      if (!list.length) return null;
      list.sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y));
      // spread the bots over the items so they don't all crowd one can
      const pick = list[(index % Math.min(list.length, 3))] || list[0];
      if (nearestHuman(dir, pick.x, pick.y) > 1300) return null;
      return { mode: 'quest', x: pick.x, y: pick.y, r: 14 };
    },
  },

  // ---- reach -------------------------------------------------------------------------
  reach: {
    timed: true,
    pressure: { pace: 0.25 },
    label(dir, s) {
      return s.def.hold > 0 ? 'Hold the position' : 'Get to the marker';
    },
    start(dir, s) {
      const a = dir.anchor(s.def.at);
      s.at = a || { ...dir.centre(), r: 200 };
      s.radius = (s.def.radius > 0 ? s.def.radius : s.at.r) + 0;
      s.hold = Math.max(0, Number(s.def.hold) || 0);
      s.held = 0;
      s.total = s.hold;
      s.t = s.hold;
      s.max = s.hold > 0 ? Math.round(s.hold) : 1;
      s.cur = 0;
    },
    update(dir, s) {
      const list = alivePlayers(dir);
      if (!list.length) return RUN;
      const R = s.radius + REACH_MARGIN * 0;
      let inside = 0;
      for (const p of list) if (Math.hypot(p.x - s.at.x, p.y - s.at.y) <= R) inside++;
      const ok = s.def.who === 'any' ? inside > 0 : inside === list.length;
      if (ok) s.held += DT;
      else s.held = Math.max(0, s.held - DT * 2);
      if (s.hold > 0) {
        s.cur = Math.min(s.max, Math.floor(s.held));
        s.t = Math.max(0, s.hold - s.held);
        return s.held >= s.hold ? DONE : RUN;
      }
      s.cur = ok ? 1 : 0;
      return ok ? DONE : RUN;
    },
    marks(dir, s, add) {
      add('reach', s.at.x, s.at.y, s.radius);
    },
    goal(dir, s, b, index) {
      const n = Math.max(1, dir.game.bots.length);
      const ang = ((index + 0.5) / n) * TAU;
      const rr = Math.max(30, s.radius * 0.45);
      return { mode: 'quest', x: s.at.x + Math.cos(ang) * rr, y: s.at.y + Math.sin(ang) * rr, r: Math.max(40, s.radius * 0.3) };
    },
  },

  // ---- activate ----------------------------------------------------------------------
  activate: {
    pressure: { pace: 0.3 },
    label(dir, s) {
      const k = s.kind;
      return k === 'generator' ? 'Start the generators' : k === 'beacon' ? 'Light the beacon' : k === 'repair' ? 'Repair it' : 'Activate the terminals';
    },
    start(dir, s) {
      const d = s.def, g = dir.game;
      s.kind = d.kind || 'use';
      // the prompt reads like the objective ("Cut the horn wire under the bus dash"), without its "(hold E)"
      const label = d.label || (typeof d.text === 'string' ? d.text.replace(/\s*\(hold [^)]*\)\s*$/i, '').replace(/[.:]+$/, '').slice(0, 38) : '');
      s.its = [];
      const refs = Array.isArray(d.at) ? d.at : d.at === undefined ? [] : [d.at];
      for (const ref of refs) {
        const stat = g.interactables.find((q) => q.id === ref);
        if (stat) {
          stat.on = true;
          stat.done = false;
          stat.once = true;
          stat.step = s;
          if (d.hold >= 0 && d.hold !== undefined) stat.hold = d.hold;
          s.its.push(stat);
          continue;
        }
        const a = dir.anchor(ref);
        if (!a) continue;
        const pos = dir.freeNear(a.x, a.y, 90, 34);
        s.its.push(dir.addTerminal(s, pos.x, pos.y, { kind: s.kind, hold: d.hold, label, r: d.radius > 0 ? d.radius : 64 }));
      }
      s.max = s.its.length;
      s.cur = 0;
    },
    update(dir, s) {
      if (s.cur < s.max) return RUN;
      activateEffect(dir, s);
      return DONE;
    },
    onInteract(dir, s, it, p) {
      s.cur++;
      s.by = p ? p.id : 0;
      if (s.def.burst > 0) dir.burst(it.x, it.y, Math.round(s.def.burst), Math.max(1, Math.round(s.def.tier || dir.tier)), s.def.specials || []);
    },
    stop(dir, s) {
      for (const it of s.its) {
        if (it.step === s && !it.done) it.on = false;
      }
    },
    marks(dir, s, add) {
      for (const it of s.its) if (it.on && !it.done) add('use', it.x, it.y, it.r);
    },
    goal(dir, s, b, index) {
      const todo = s.its.filter((it) => it.on && !it.done);
      if (!todo.length) return null;
      const it = todo[index % todo.length];
      if (nearestHuman(dir, it.x, it.y) > 1500) return null;
      return { mode: 'use', x: it.x, y: it.y, r: Math.max(20, it.r * 0.35), use: it };
    },
  },

  // ---- escort ------------------------------------------------------------------------
  escort: {
    timed: true,
    pressure: { pace: 0.3 },
    label(dir, s) {
      return `Escort ${s.npc ? s.npc.name : 'the survivor'}`;
    },
    start(dir, s) {
      const d = s.def, g = dir.game;
      const key = String(d.npc || 'survivor');
      const pts = anchorsOf(dir, d.route).map((a) => ({ x: a.x, y: a.y, r: a.r }));
      let n = npcByKey(g, key);
      if (!n) {
        const at = pts.length ? pts[0] : dir.centre();
        const cast = (dir.mission.npcs || []).find((q) => (q.id || q.key) === key) || { id: key };
        n = createNpc(g, { ...cast, key, x: at.x, y: at.y, angle: 0, hp: d.hp || cast.hp });
        if (n) {
          const f = dir.freeNear(n.x, n.y, 80);
          n.x = f.x;
          n.y = f.y;
        }
      }
      s.npc = n;
      if (!n) {
        s.max = 100;
        return;
      }
      // walk the route from where the NPC stands: skip the first point when it is right here
      let route = pts;
      if (route.length && Math.hypot(route[0].x - n.x, route[0].y - n.y) < 110) route = route.slice(1);
      n.route = route.map((p) => ({ x: p.x, y: p.y }));
      n.routeI = 0;
      n.arrived = route.length === 0;
      n.mode = 'escort';
      n.critical = d.fail !== false;
      if (d.invulnerable) n.invulnerable = true;
      if (d.hp > 0) {
        n.maxHp = Math.round(d.hp * (1 + 0.15 * (Math.max(1, g.players.length) - 1)));
        n.hp = n.maxHp;
      }
      s.dest = route.length ? route[route.length - 1] : { x: n.x, y: n.y, r: 120 };
      s.total0 = pathLeft(n);
      s.max = 100;
      s.cur = 0;
    },
    update(dir, s) {
      const n = s.npc;
      if (!n) return DONE;
      if (n.dead) return FAIL;
      if (n.arrived) {
        s.cur = 100;
        return DONE;
      }
      const left = pathLeft(n);
      s.cur = s.total0 > 1 ? Math.max(0, Math.min(99, Math.round(100 * (1 - left / s.total0)))) : 0;
      return RUN;
    },
    stop(dir, s, result) {
      const n = s.npc;
      if (!n) return;
      n.critical = false;
      if (result === DONE) {
        n.mode = 'idle';
        n.home.x = n.x;
        n.home.y = n.y;
        n.home.angle = n.angle;
      }
    },
    onNpcDown(dir, s, n) {
      if (n === s.npc) dir.say([{ who: n.name, text: 'I\'m hit! Help me!' }], 'say');
    },
    marks(dir, s, add) {
      const n = s.npc;
      if (!n) return;
      add('escort', n.x, n.y, 0);
      if (s.dest) add('reach', s.dest.x, s.dest.y, s.dest.r || 120);
    },
    goal(dir, s, b, index) {
      const n = s.npc;
      if (!n || n.dead) return null;
      const next = n.route && n.route[n.routeI];
      let gx = n.x, gy = n.y;
      if (next && !n.down) {
        const dx = next.x - n.x, dy = next.y - n.y, d = Math.hypot(dx, dy) || 1;
        const lead = 90 + (index % 3) * 30;
        gx += (dx / d) * lead + (-dy / d) * ((index % 2 ? 1 : -1) * 40);
        gy += (dy / d) * lead + (dx / d) * ((index % 2 ? 1 : -1) * 40);
      }
      return { mode: 'quest', x: gx, y: gy, r: 50 };
    },
  },

  // ---- kill --------------------------------------------------------------------------
  kill: {
    label(dir, s) {
      return s.type === 'any' ? 'Kill the horde' : `Kill the ${ZOMBIES[s.type] ? ZOMBIES[s.type].name.toLowerCase() : s.type}s`;
    },
    start(dir, s) {
      const d = s.def;
      // (the step's own `type` is 'kill': the zombie type is `zombie`, alias `enemy`)
      s.type = String(d.zombie || d.enemy || 'any');
      // a script counts for a party of four
      s.max = Math.max(1, Math.round((Math.floor(d.count) || 10) * partyScale(dir)));
      s.cur = 0;
      s.topT = 4;
      if (s.type !== 'any' && d.spawn !== false && ZOMBIES[s.type]) {
        s.pack = packSpawn(dir, s, s.type, s.max, d.at, killTier(dir, s));
      }
      if (s.type === 'any' && !d.pressure) dir.setPressure(s, { pace: 0.6 });
    },
    update(dir, s) {
      if (s.cur >= s.max) return DONE;
      // the director makes up the numbers when the stream has not brought enough of the kind
      if (s.type !== 'any' && s.def.spawn !== false && ZOMBIES[s.type] && (s.topT -= DT) <= 0) {
        s.topT = 5;
        let alive = 0;
        for (const z of dir.game.zombies) if (!z.dead && z.type === s.type) alive++;
        const short = s.max - s.cur - alive;
        if (short > 0) packSpawn(dir, s, s.type, Math.min(short, 6), s.def.at, killTier(dir, s));
      }
      return RUN;
    },
    onKill(dir, s, z) {
      if (s.type === 'any' || z.type === s.type) s.cur++;
    },
    marks(dir, s, add) {
      let n = 0;
      for (const z of dir.game.zombies) {
        if (z.dead || (s.type !== 'any' && z.type !== s.type)) continue;
        add('enemy', z.x, z.y, 0);
        if (++n >= 4) break;
      }
    },
    goal(dir, s, b) {
      const p = b.p;
      let best = null, bd = Infinity;
      for (const z of dir.game.zombies) {
        if (z.dead || (s.type !== 'any' && z.type !== s.type)) continue;
        const d = Math.hypot(z.x - p.x, z.y - p.y);
        if (d < bd) {
          bd = d;
          best = z;
        }
      }
      if (!best || nearestHuman(dir, best.x, best.y) > 1300) return null;
      return { mode: 'hunt', x: best.x, y: best.y, r: 220 };
    },
  },

  // ---- boss --------------------------------------------------------------------------
  boss: {
    supply: true,
    label(dir, s) {
      const t = s.def.enemy || s.def.zombie || 'boss';
      return `Kill the ${ZOMBIES[t] ? ZOMBIES[t].name : 'boss'}`;
    },
    start(dir, s) {
      const d = s.def, g = dir.game;
      const want = d.enemy || d.zombie;
      const type = ZOMBIES[want] ? want : 'boss';
      const count = Math.max(1, Math.floor(d.count) || 1);
      s.max = count;
      s.cur = 0;
      const savedB = g.waveBosses, savedP = g.wavePlayers;
      g.waveBosses = count;
      g.wavePlayers = Math.max(1, g.players.length);
      s.bosses = packSpawn(dir, s, type, count, d.at, killTier(dir, s), true);
      g.waveBosses = savedB;
      g.wavePlayers = savedP;
      for (const z of s.bosses) g.emit({ type: 'bossspawn', id: z.id, x: Math.round(z.x), y: Math.round(z.y) });
    },
    update(dir, s) {
      let alive = 0;
      for (const z of s.bosses) if (!z.dead) alive++;
      s.cur = s.max - alive;
      return alive === 0 ? DONE : RUN;
    },
    marks(dir, s, add) {
      for (const z of s.bosses) if (!z.dead) add('enemy', z.x, z.y, 0);
    },
    goal(dir, s, b) {
      for (const z of s.bosses) {
        if (z.dead || nearestHuman(dir, z.x, z.y) > 1300) continue;
        return { mode: 'hunt', x: z.x, y: z.y, r: 320 };
      }
      return null;
    },
  },

  // ---- evac (the zone director: sim/zone.js) -----------------------------------------
  evac: {
    ownWaves: true,
    label(dir, s) {
      return `Reach the safe zone ${Math.min(s.max, s.cur + 1)} of ${s.max}`;
    },
    start(dir, s) {
      s.max = Math.max(1, (dir.game.zone && dir.game.zone.stops ? dir.game.zone.stops.length : (s.def.stops || []).length) || 1);
      s.cur = 0;
      feelStart(dir, s);
    },
    stop(dir, s) {
      feelStop(dir, s);
    },
    update(dir, s) {
      return s.cur >= s.max || s.finished ? DONE : RUN;
    },
    onWaveClear(dir, s, w) {
      s.cur = Math.min(s.max, w);
      if (s.cur < s.max) return false;
      dir.game.zone = null;
      s.finished = true;
      return true;
    },
    marks(dir, s, add) {
      const z = dir.game.zone;
      if (z) add('reach', z.circle.x, z.circle.y, z.circle.r);
    },
    goal() {
      return null;
    },
  },

  // ---- campaignStage (the campaign director: sim/campaign.js) ------------------------
  campaignStage: {
    supply: true,
    ownWaves: true,
    label(dir, s) {
      const c = dir.game.campaign;
      switch (s.def.stage) {
        case 'hill': return `Hold the hill: wave ${Math.min(s.max, Math.max(1, dir.game.wave))} of ${s.max}`;
        case 'breakout': return 'Break out: reach the tower';
        case 'tower': return `Fight up the tower${c && c.floor ? ` (floor ${c.floor})` : ''}`;
        case 'roof': return 'Hold the roof';
        default: return 'Ride the zip line';
      }
    },
    start(dir, s) {
      const c = dir.game.campaign;
      s.max = s.def.stage === 'hill' && c ? c.plan.hill : 1;
      s.cur = 0;
      s.lastStep = !dir.steps.some((q) => q.i > s.i && !q.optional && !q.parallel);
      feelStart(dir, s);
    },
    stop(dir, s) {
      feelStop(dir, s);
    },
    update(dir, s) {
      const c = dir.game.campaign;
      if (!c || s.finished) return DONE;
      switch (s.def.stage) {
        case 'hill':
          s.cur = Math.min(s.max, Math.max(0, dir.game.wave - (dir.game.phase === 'wave' ? 1 : 0)));
          return c.stage >= 2 ? DONE : RUN;
        case 'breakout': return c.stage >= 3 ? DONE : RUN;
        case 'tower': return c.stage >= 4 ? DONE : RUN;
        case 'roof': return c.zip || c.stage > 4 ? DONE : RUN;
        default: return c.checkEnd() === 'victory' ? DONE : RUN;
      }
    },
    onWaveClear(dir, s, w) {
      const c = dir.game.campaign;
      if (!c || s.def.stage !== 'hill') return false;
      if (c.stage === 1 && w >= c.plan.hill && s.lastStep) {
        s.cur = s.max;
        s.finished = true;
        return true;
      }
      return false;
    },
    marks(dir, s, add) {
      const c = dir.game.campaign;
      if (c && c.sub !== SUB.BRIEF) add('reach', c.circle.x, c.circle.y, c.circle.r);
    },
    goal() {
      return null;
    },
  },

  // ---- wait --------------------------------------------------------------------------
  wait: {
    label() {
      return '';
    },
    start(dir, s) {
      s.total = Math.max(0, Number(s.def.seconds) || 3);
      s.t = s.total;
      s.max = 0;
    },
    update(dir, s) {
      const el = dir.time - s.t0;
      s.t = Math.max(0, s.total - el);
      return el >= s.total ? DONE : RUN;
    },
    goal() {
      return null;
    },
  },

  // ---- dialogue ----------------------------------------------------------------------
  dialogue: {
    label(dir, s) {
      if (!s.def.talk) return '';
      const n = npcByKey(dir.game, s.def.npc);
      return `Talk to ${n ? n.name : String(s.def.npc || 'them')}`;
    },
    start(dir, s) {
      s.waitTalk = !!(s.def.talk && s.def.npc);
      s.max = 0;
      if (!s.waitTalk) dir.say(s.def.lines || [], 'say');
    },
    update(dir, s) {
      if (s.waitTalk) return RUN;
      return dir.lineBusy() ? RUN : DONE;
    },
    onTalk(dir, s, n) {
      if (s.waitTalk && n.key === s.def.npc) {
        s.waitTalk = false;
        dir.say(s.def.lines || [], 'say');
      }
    },
    marks(dir, s, add) {
      if (!s.waitTalk) return;
      const n = npcByKey(dir.game, s.def.npc);
      if (n) add('npc', n.x, n.y, 0);
    },
    goal(dir, s) {
      if (!s.waitTalk) return null;
      const n = npcByKey(dir.game, s.def.npc);
      return n ? { mode: 'quest', x: n.x, y: n.y, r: 50 } : null;
    },
  },

  // ---- anything else: finishes at once (the validator reports it) ---------------------
  custom: {
    start(dir, s) {
      s.max = 0;
    },
    update() {
      return DONE;
    },
  },
};

/** The HUD line a step shows when the script gives no `text`. */
export function defaultText(dir, s) {
  return s.impl && s.impl.label ? s.impl.label(dir, s) : '';
}

/** Path length left for an escorted NPC (straight legs through its remaining route points). */
function pathLeft(n) {
  let x = n.x, y = n.y, len = 0;
  const r = n.route || [];
  for (let i = n.routeI; i < r.length; i++) {
    len += Math.hypot(r[i].x - x, r[i].y - y);
    x = r[i].x;
    y = r[i].y;
  }
  return len;
}

/**
 * Spawn `count` zombies of `type` as a pack on a ring around anchor `at` (or the team),
 * heavies included. Returns the zombies.
 */
function packSpawn(dir, s, type, count, at, tier, far = false) {
  const g = dir.game;
  const a = at !== undefined ? dir.anchor(at) : null;
  const c = a || dir.centre();
  const lo = far ? 900 : 700, hi = far ? 1300 : 1000;
  const spot = dir.ringSpot(c.x, c.y, a ? 60 : lo, a ? Math.max(a.r, 200) : hi, a ? 0 : 560) || dir.ringSpot(c.x, c.y, 500, 900, 300) || dir.freeNear(c.x + 500, c.y, 200, 40);
  const saved = g.wave;
  g.wave = tier - g.tierBonus;
  const out = [];
  const heavy = ZOMBIES[type].radius >= 20;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * TAU, rr = heavy ? 60 : 36 + (i % 3) * 22;
    const x = spot.x + Math.cos(ang) * rr * (count > 1 ? 1 : 0), y = spot.y + Math.sin(ang) * rr * (count > 1 ? 1 : 0);
    const ok = g.world.isCircleFree(x, y, heavy ? 30 : 16, false);
    const z = g.spawnZombieAt(type, ok ? x : spot.x, ok ? y : spot.y);
    out.push(z);
  }
  g.wave = saved;
  dir.stats.spawned += out.length;
  return out;
}

export { pickType };
