// The story level director (JOURNEY.md §4): the run-time state of a level map inside a game and
// everything that follows from it. GameCore makes one on any level map (`game.level`, null on
// every other map), whatever the mode; every hook elsewhere is behind `game.level`.
//
//   gates        one open flag per gate in `map.gates` order and the tick it last changed.
//                setGate() switches the gate's colliders (shared/level.js), patches the three
//                flow fields' walk graphs (the zombies', the heavies' and the bots'), rebuilds
//                the zombie fields at once, pushes whatever stands in a gate that shuts out of
//                it, and emits `gate { id, open }`.
//   sections     `section`: the furthest section (by index) any living survivor has entered; the
//                first entry of each emits `area { id, name, i }` (the HUD's title card).
//   checkpoint   the section whose checkpoints respawns and late joiners use; it follows
//                `section` and the `checkpoint` action moves it.
//   lights       `dark`: bit i set = section i's map lights are out (the `lights` action).
//   defend point a `defend` step at an anchor: an objective without a collider (hp as the bus's,
//                the HUD bar, the zombies' target), see defendAt().
//   spawns       zombies come from the spawn rects of the current and the next section (a rect
//                behind a shut gate less often, and only while few are waiting there); zombies
//                left more than a section behind, far from everyone, are culled.
//
// Deterministic (game.rng and the game's own ticks); no DOM.

import { DT, PLAYER_RADIUS, OBJECTIVE_HP_PER_PLAYER } from '../constants.js';
import { makeObb, circleOverlapsObb } from '../geom.js';
import { TAU } from '../math.js';
import {
  levelGates, setGateColliders, sectionAt, nearestSection, checkpointsOf, sectionIndex, MAX_SECTIONS,
} from '../level.js';
import { walkComponents, componentAt } from './zone.js';
import { OBJECTIVE_BIAS } from './core.js';

/** Hit points of a level's defend point before the per-survivor share (the school bus's). */
export const DEFEND_HP = 5000;
/** Size of the (collider-less) box zombies attack at a defend point. */
const DEFEND_BOX = 64;
/** Ticks between two checks of the sections the survivors stand in. */
const SECTION_EVERY = 6;
/** Ticks between two passes over the zombies (cull, count the ones waiting behind a gate). */
const CULL_EVERY = 60;
/** A zombie more than a section behind the party is culled when nobody is this close. */
const CULL_FAR = 1500;
/** A spawn rect behind a shut gate is picked this much less often than an open one. */
const PEN_WEIGHT = 0.35;
/** Spawn rects this far from every survivor are preferred. */
const SPAWN_FAR = 600;

/** Runs one level map of a game; see the file comment. */
export class LevelDirector {
  /** @param {import('./core.js').GameCore} game */
  constructor(game) {
    this.game = game;
    this.map = game.map;
    this.gates = levelGates(game.map);
    const n = this.gates.length;
    this.open = new Uint8Array(n);
    /** Tick each gate last changed (0 = as built). */
    this.changed = new Int32Array(n);
    this.sections = (game.map.sections || []).slice(0, MAX_SECTIONS);
    /** Furthest section entered by a living survivor. */
    this.section = 0;
    /** Section whose checkpoints respawns and late joiners use. */
    this.checkpoint = 0;
    this.entered = new Uint8Array(Math.max(1, this.sections.length));
    /** Bit i = section i's lights are out. */
    this.dark = 0;
    /** The defend point of a `defend` step at an anchor: { name, anchor, x, y, r } or null. */
    this.defend = null;
    /** Bumped on every gate change (caches of spawn rects and walk components key on it). */
    this.version = 0;
    /** Zombies alive that cannot reach anyone (waiting behind a shut gate), counted every CULL_EVERY ticks. */
    this.penned = 0;
    this._rects = null;
    this._rectsKey = '';
    this._comp = null;
    this._compV = -1;
    this.begun = false;
    this.stats = { culled: 0, gates: 0, patchMs: 0 };
  }

  // -----------------------------------------------------------------------------------
  // Per tick

  /** One tick (GameCore.step, after the mission director). */
  update() {
    const g = this.game;
    if (!this.begun) {
      this.begun = true;
      // the section the crew starts in is "entered" at once: its title card opens the level
      const sp = this._partyPoint();
      this.section = Math.max(0, nearestSection(this.map, sp.x, sp.y));
      this.checkpoint = this.section;
      this._enter(this.section);
    }
    if (g.tick % SECTION_EVERY === 0) this._trackSections();
    if (g.tick % CULL_EVERY === 0) this._cull();
  }

  _trackSections() {
    let best = this.section;
    for (const p of this.game.players) {
      if (p.state !== 'alive' || p.escaped) continue;
      const i = sectionAt(this.map, p.x, p.y);
      if (i > best) best = i;
    }
    if (best > this.section) {
      this.section = best;
      if (this.checkpoint < best) this.checkpoint = best;
      this._enter(best);
    }
  }

  _enter(i) {
    if (i < 0 || i >= this.sections.length || this.entered[i]) return;
    this.entered[i] = 1;
    const s = this.sections[i];
    this.game.emit({ type: 'area', id: String(s.id), name: String(s.name || s.id), i });
  }

  /** Cull the zombies left far behind and count the ones waiting behind shut gates. */
  _cull() {
    const g = this.game;
    let penned = 0;
    for (const z of g.zombies) {
      if (z.dead || z.dummy) continue;
      if (!g.flow.reachable(z.x, z.y)) penned++;
      if (this.section < 2 || z.boss) continue;
      const zi = nearestSection(this.map, z.x, z.y);
      if (zi >= this.section - 1) continue;
      let far = true;
      for (const p of g.players) {
        if (p.state !== 'dead' && Math.hypot(p.x - z.x, p.y - z.y) < CULL_FAR) {
          far = false;
          break;
        }
      }
      if (!far) continue;
      // quietly gone: not a kill (no event, no credit, no loot)
      z.dead = true;
      z.culled = true;
      this.stats.culled++;
    }
    this.penned = penned;
  }

  // -----------------------------------------------------------------------------------
  // Gates

  /** Index of gate `id` (-1 when unknown). */
  gateIndex(id) {
    for (const gt of this.gates) if (gt.id === id) return gt.i;
    return -1;
  }

  /** True if gate `id` (or index) is open. */
  isOpen(ref) {
    const i = typeof ref === 'number' ? ref : this.gateIndex(ref);
    return i >= 0 && this.open[i] === 1;
  }

  /**
   * Open (or shut) gate `ref` (id or index) now. Its colliders stop (or start) blocking
   * everything, the flow fields are patched and rebuilt, whatever stands in a shutting gate is
   * pushed out of it, and `gate { id, open }` is emitted.
   * @returns {boolean} true when the gate changed
   */
  setGate(ref, open = true) {
    const i = typeof ref === 'number' ? ref : this.gateIndex(ref);
    const gt = this.gates[i];
    if (!gt || (this.open[i] === 1) === !!open) return false;
    const g = this.game;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.open[i] = open ? 1 : 0;
    this.changed[i] = g.tick;
    setGateColliders(g.world, this.map, i, !!open);
    for (const f of [g.flow, g.flowBig, g.botNav && g.botNav.field]) {
      if (f) f.patchRegion(gt.x0, gt.y0, gt.x1, gt.y1);
    }
    if (!open) this._pushOut(gt);
    this.version++;
    this._rects = null;
    g.rebuildFlowNow();
    if (typeof performance !== 'undefined') this.stats.patchMs = performance.now() - t0;
    this.stats.gates++;
    g.emit({ type: 'gate', id: String(gt.id), open: !!open });
    if (g.story) g.story.onGates();
    return true;
  }

  /** A gate shut on top of someone: everything standing in its footprint steps out of it. */
  _pushOut(gt) {
    const g = this.game, world = g.world;
    const boxes = gt.ids.map((id) => world.colliders[id]).filter(Boolean);
    const inside = (x, y, r) => boxes.some((b) => circleOverlapsObb(b, x, y, r));
    for (const p of g.players) {
      if (p.state === 'dead' || !inside(p.x, p.y, PLAYER_RADIUS)) continue;
      if (!world.unstick(p, PLAYER_RADIUS, p.z || 0)) world.resolveCircle(p, PLAYER_RADIUS);
    }
    for (const z of g.zombies) {
      if (!z.dead && inside(z.x, z.y, z.body)) world.resolveCircle(z, z.body, z.mask, z.z);
    }
    for (const n of g.npcs) {
      if (!n.dead && inside(n.x, n.y, n.radius)) world.resolveCircle(n, n.radius);
    }
  }

  /** Walk components of the zombies' field and the one the party stands in. */
  components() {
    const g = this.game;
    if (this._compV !== this.version || !this._comp || this._comp.edges !== g.flow.edges) {
      const comp = walkComponents(g.flow);
      const at = this._partyPoint();
      let main = componentAt(g.flow, comp, at.x, at.y);
      if (main < 0) {
        const cp = checkpointsOf(this.map, this.checkpoint)[0];
        if (cp) main = componentAt(g.flow, comp, cp.x, cp.y);
      }
      this._comp = { comp, main, edges: g.flow.edges };
      this._compV = this.version;
    }
    return this._comp;
  }

  /** A living survivor's spot (the first one), else the checkpoint, else the first player spawn. */
  _partyPoint() {
    for (const p of this.game.players) if (p.state === 'alive' && !p.escaped) return p;
    for (const p of this.game.players) if (p.state === 'downed') return p;
    const cp = checkpointsOf(this.map, this.checkpoint)[0];
    if (cp) return cp;
    const sp = this.map.playerSpawns && this.map.playerSpawns[0];
    return sp || { x: this.map.width / 2, y: this.map.height / 2 };
  }

  // -----------------------------------------------------------------------------------
  // Sections, checkpoints, lights

  /** Move the respawn point to section `ref` (id or index); a section further on becomes the current one. */
  setCheckpoint(ref) {
    const i = typeof ref === 'number' ? ref : sectionIndex(this.map, ref);
    if (i < 0 || i >= this.sections.length) return false;
    this.checkpoint = i;
    if (i > this.section) {
      this.section = i;
      this._rects = null;
      this._enter(i);
    }
    this.game.emit({ type: 'checkpoint', section: String(this.sections[i].id) });
    return true;
  }

  /** Cut (on = false) or restore section `ref`'s lights. */
  setLights(ref, on) {
    const i = typeof ref === 'number' ? ref : sectionIndex(this.map, ref);
    if (i < 0 || i >= MAX_SECTIONS) return false;
    const bit = 1 << i;
    const was = (this.dark & bit) !== 0;
    if (on) this.dark &= ~bit;
    else this.dark |= bit;
    this.dark >>>= 0;
    if (was !== !on) this.game.emit({ type: 'lights', section: String(this.sections[i] ? this.sections[i].id : i), on: !!on });
    return true;
  }

  /**
   * Where a respawn or a late joiner appears: at a checkpoint of the checkpoint section (the one
   * nearest the survivors still standing), spread around it by `i`.
   */
  spawnPoint(i) {
    const g = this.game;
    let cps = checkpointsOf(this.map, this.checkpoint);
    for (let k = this.checkpoint; !cps.length && k >= 0; k--) cps = checkpointsOf(this.map, k);
    if (!cps.length) return null;
    const at = this._partyPoint();
    let best = cps[0], bd = Infinity;
    for (const c of cps) {
      const d = Math.hypot(c.x - at.x, c.y - at.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    const a0 = (i * TAU) / 6 + 0.3;
    for (let ring = 0; ring < 4; ring++) {
      const d = ring === 0 && i === 0 ? 0 : 36 + ring * 34;
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k * TAU) / 8;
        const x = best.x + Math.cos(a) * d, y = best.y + Math.sin(a) * d;
        if (g.world.isCircleFree(x, y, PLAYER_RADIUS + 4, true)) return { x, y };
      }
    }
    return { x: best.x, y: best.y };
  }

  // -----------------------------------------------------------------------------------
  // The defend point of a `defend` step at an anchor

  /**
   * Put the game's objective at anchor `name` (a level has no objective of its own): an hp
   * pool like the bus's, a flow-field goal and a box the zombies attack, without a collider.
   * @returns {object|null} game.objective
   */
  defendAt(name, label = '') {
    const g = this.game;
    const a = this.map.anchors && this.map.anchors[name];
    if (!a) return null;
    this.defend = { name: String(label || humanize(name)).slice(0, 40), anchor: String(name), x: a.x, y: a.y, r: a.r || 120 };
    g.objObb = makeObb(a.x, a.y, DEFEND_BOX, DEFEND_BOX, 0, 0, this.defend);
    g.objTarget = { x: a.x, y: a.y, w: DEFEND_BOX, h: DEFEND_BOX, a: 0, bias: OBJECTIVE_BIAS };
    if (!g.objective) {
      const hp = Math.round(DEFEND_HP * (1 + OBJECTIVE_HP_PER_PLAYER * (Math.max(1, g.players.length) - 1)));
      g.objective = { hp, maxHp: hp };
    }
    g.rebuildFlowNow();
    return g.objective;
  }

  /** The defend step ended: no objective any more. */
  clearDefend() {
    const g = this.game;
    this.defend = null;
    g.objective = null;
    g.objObb = null;
    g.objTarget = null;
    g.rebuildFlowNow();
  }

  /** An objective-like box the bots hold around: the defend point, else null. */
  anchorBox() {
    const d = this.defend;
    return d ? { x: d.x, y: d.y, w: DEFEND_BOX * 2, h: DEFEND_BOX * 2 } : null;
  }

  // -----------------------------------------------------------------------------------
  // Spawns

  /**
   * The spawn rects zombies come from now, for zombies.js pickSpawnRect: `{ rects, far }`.
   * Those of the current and the next section (or of section `hint` alone); a rect behind a
   * shut gate (not in the party's walk component) weighs PEN_WEIGHT and is left out while
   * enough zombies already wait behind gates. `all` keeps every rect of the sections.
   */
  spawnRects(hint = -1, all = false) {
    const cur = this.section;
    const lo = hint >= 0 ? hint : cur;
    const hi = hint >= 0 ? hint : Math.min(this.sections.length - 1, cur + 1);
    const penFull = this.penned >= 8 + 3 * Math.max(1, this.game.players.length);
    const key = `${lo}:${hi}:${this.version}:${penFull ? 1 : 0}:${all ? 1 : 0}`;
    if (this._rects && this._rectsKey === key) return this._rects;
    const { comp, main } = this.components();
    const f = this.game.flow;
    const pick = (from, to, strict) => {
      const out = [];
      for (const r of this.map.zombieSpawns) {
        const si = sectionIndex(this.map, r.section);
        if (si < from || si > to) continue;
        const behind = main >= 0 && componentAt(f, comp, r.x, r.y) !== main;
        if (behind && strict && penFull) continue;
        const w = (r.weight > 0 ? r.weight : 1) * (behind && !all ? PEN_WEIGHT : 1);
        out.push({ x: r.x, y: r.y, w: r.w, h: r.h, weight: w, section: r.section });
      }
      return out;
    };
    let rects = pick(lo, hi, !all);
    // nothing tagged for these sections: anything up to the next one, then every rect
    if (!rects.length) rects = pick(0, Math.max(hi, cur + 1), !all);
    if (!rects.length) rects = this.map.zombieSpawns.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, weight: r.weight > 0 ? r.weight : 1 }));
    this._rects = { rects, far: SPAWN_FAR };
    this._rectsKey = key;
    return this._rects;
  }

  /**
   * A spot to put a group of zombies (the mission director's bursts): a free point in one of
   * spawnRects(hint), preferring rects SPAWN_FAR from every survivor. Null when there is none.
   */
  spawnSpot(rng, hint = -1, all = false, r = 40) {
    const { rects } = this.spawnRects(hint, all);
    if (!rects.length) return null;
    const g = this.game;
    const far = [];
    for (const q of rects) {
      let ok = true;
      for (const p of g.players) {
        if (p.state !== 'dead' && Math.hypot(p.x - q.x, p.y - q.y) < SPAWN_FAR) {
          ok = false;
          break;
        }
      }
      if (ok) far.push(q);
    }
    const list = far.length ? far : rects;
    let total = 0;
    for (const q of list) total += q.weight;
    let k = rng.next() * total, rect = list[list.length - 1];
    for (const q of list) {
      k -= q.weight;
      if (k < 0) {
        rect = q;
        break;
      }
    }
    for (let t = 0; t < 10; t++) {
      const x = rect.x + rng.range(-rect.w / 2, rect.w / 2), y = rect.y + rng.range(-rect.h / 2, rect.h / 2);
      if (g.world.isCircleFree(x, y, r, true)) return { x, y };
    }
    return { x: rect.x, y: rect.y };
  }

  // -----------------------------------------------------------------------------------
  // Snapshot

  /**
   * Snapshot.level: `{ section, checkpoint, dark (bits), gates: [{ open, t (tick it changed) }],
   * defend ('' or the defend point's name) }`.
   */
  snapshot() {
    const gates = new Array(this.gates.length);
    for (let i = 0; i < gates.length; i++) gates[i] = { open: this.open[i] === 1, t: this.changed[i] };
    return {
      section: this.section,
      checkpoint: this.checkpoint,
      dark: this.dark >>> 0,
      gates,
      defend: this.defend ? this.defend.name : '',
    };
  }
}

/** "gas_tow" → "Gas tow" (a defend point's HUD name when the step gives none). */
export function humanize(name) {
  const s = String(name || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : 'Objective';
}

/** Seconds → ticks helper for tools. */
export function secondsToTicks(s) {
  return Math.round(s / DT);
}
