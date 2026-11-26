// Shared helpers for the story levels (JOURNEY.md). A level module exports its SPEC (the contract:
// section ids in travel order, the anchors each section must have, the gates between them) and a
// build(B) that lays the level out with the map builder (maps.js createBuilder) plus its level calls:
// B.section, B.gate, B.checkpoint, B.roof, B.zspawn(..., section), B.anchor.
//
// placeholderLevel(B, SPEC) builds a plain stand-in from the SPEC alone: the sections in a row along a
// road, a wall across the route between two sections with the gate in it, every anchor inside its
// section, spawns and checkpoints per section, a little cover. It keeps every name of the contract, so
// mission scripts and the engine can be built and tested against a level before its real art exists.

import { FlowField } from '../flowfield.js';
import { mapColliders, circleOverlapsObb, obbOverlap, makeObb, MASK_MOVE } from '../geom.js';

/** The kinds of gate the engine opens and draws (JOURNEY.md §3.2). */
export const GATE_KINDS = Object.freeze(['shutter', 'door', 'gate', 'fence', 'barricade', 'rubble', 'bars', 'vehicle']);

/** Roof / ceiling kinds the renderer knows (JOURNEY.md §3.3). */
export const ROOF_KINDS = Object.freeze(['plain', 'office', 'hospital', 'mall', 'metro', 'industrial', 'house']);

/** Section size of the placeholder layout. */
const SW = 1600, SH = 1400, PAD = 200;

/** Map size a placeholder of `n` sections needs (LEVEL_DEFS uses it until the real level sets its own). */
export function placeholderSize(n) {
  return { width: PAD * 2 + SW * n, height: SH + PAD * 2 };
}

/**
 * Lay out a stand-in level from its SPEC (see the header).
 * @param {object} B map builder
 * @param {object} spec the level's SPEC
 */
export function placeholderLevel(B, spec) {
  const { H, rng } = B;
  const n = spec.sections.length;
  const y0 = PAD, cy = PAD + SH / 2;
  B.box('asphalt', PAD * 0.5, cy - 110, PAD * 1.5 + SW * n, cy + 110);
  B.line('yellow', PAD * 0.5, cy, PAD * 1.5 + SW * n, cy, 3);
  spec.sections.forEach((sec, i) => {
    const x0 = PAD + i * SW;
    const cx = x0 + SW / 2;
    B.section(sec.id, sec.name, cx, cy, SW, SH);
    B.box(i % 2 ? 'dirt' : 'gravel', x0 + 80, y0 + 60, x0 + SW - 80, cy - 160);
    // anchors of the section on a loose grid (the first section's `start` near its west edge)
    const names = spec.anchors[sec.id] || [];
    names.forEach((name, k) => {
      if (name === 'start') { B.anchor(name, x0 + 220, cy + 60, 160); return; }
      const col = k % 4, row = Math.floor(k / 4);
      B.anchor(name, x0 + 300 + col * 330, y0 + 260 + row * 420 + (col % 2) * 120, 180);
    });
    B.checkpoint(sec.id, x0 + 180, cy + 90);
    B.checkpoint(sec.id, x0 + 180, cy - 90);
    // spawns: the section's far corners (its zombies come from ahead of the party)
    B.zspawn(x0 + SW - 140, y0 + 140, 180, 180, 1, sec.id);
    B.zspawn(x0 + SW - 140, y0 + SH - 140, 180, 180, 1, sec.id);
    B.zspawn(x0 + SW / 2, y0 + 120, 240, 120, 0.6, sec.id);
    // a little cover
    for (let k = 0; k < 5; k++) {
      const x = x0 + 300 + rng.range(0, SW - 600), y = y0 + 200 + rng.range(0, SH - 400);
      if (Math.abs(y - cy) < 140) continue;
      B.vehicle(rng.pick(['car', 'suv', 'van']), x, y, rng.range(-0.4, 0.4), { wrecked: rng.next() < 0.6 });
    }
    // the wall to the next section, with the gate in it
    if (i < n - 1) {
      const wx = x0 + SW;
      const gate = spec.gates.find((g) => g.from === sec.id) || null;
      const gapW = 220;
      B.ob('wall', wx, y0 + (SH / 2 - gapW / 2) / 2, 40, SH / 2 - gapW / 2, 0, { section: sec.id });
      B.ob('wall', wx, y0 + SH - (SH / 2 - gapW / 2) / 2, 40, SH / 2 - gapW / 2, 0, { section: sec.id });
      if (gate) B.gate(gate.id, gate.kind, wx, cy, 40, gapW, 0, { section: sec.id, label: gate.label || '' });
    }
  });
  // the edges of the world beyond the route
  B.ob('wall', PAD + (SW * n) / 2, PAD - 20, SW * n, 40, 0, {});
  B.ob('wall', PAD + (SW * n) / 2, H - PAD + 20, SW * n, 40, 0, {});
  // (and at both ends, or the margin outside the walls would be a way round every gate)
  B.ob('wall', PAD - 20, H / 2, 40, SH + 80, 0, {});
  B.ob('wall', PAD + SW * n + 20, H / 2, 40, SH + 80, 0, {});
  // the party starts at the west end of the first section
  for (let k = 0; k < 6; k++) B.pspawn(PAD + 140 + (k % 2) * 70, cy - 120 + Math.floor(k / 2) * 110);
  B.supply(PAD + 260, cy + 200);
}

/**
 * Check a level against its SPEC: every section, anchor and gate of the contract exists. Returns a
 * list of problems (empty = fine). Used by tests and by the level modules' own checks.
 * @param {object} map built map (buildMap)
 * @param {object} spec the level's SPEC
 */
export function checkLevelSpec(map, spec) {
  const out = [];
  if (map.kind !== 'level') out.push('map.kind is not "level"');
  const secIds = (map.sections || []).map((s) => s.id);
  spec.sections.forEach((s, i) => {
    if (secIds[i] !== s.id) out.push(`section ${i} should be "${s.id}", is "${secIds[i]}"`);
  });
  for (const [sec, names] of Object.entries(spec.anchors)) {
    for (const name of names) if (!map.anchors[name]) out.push(`anchor "${name}" (${sec}) is missing`);
  }
  for (const g of spec.gates) {
    const mg = (map.gates || []).find((e) => e.id === g.id);
    if (!mg) out.push(`gate "${g.id}" is missing`);
    else if (!GATE_KINDS.includes(mg.kind)) out.push(`gate "${g.id}" has an unknown kind "${mg.kind}"`);
  }
  for (const s of spec.sections) {
    if (!(map.checkpoints || []).some((c) => c.section === s.id)) out.push(`section "${s.id}" has no checkpoint`);
    if (!map.zombieSpawns.some((z) => z.section === s.id)) out.push(`section "${s.id}" has no zombie spawns`);
  }
  if (!map.playerSpawns.length) out.push('no player spawns');
  return out;
}

/** Walk-graph pad of validateLevel: a survivor (radius 16) through the gaps bots plan with. */
const WALK_PAD = 12;
/** A checkpoint or anchor must keep a survivor-sized circle clear of every collider. */
const SPOT_R = 16;

/**
 * Check a built level the way the engine plays it (JOURNEY.md §4.4). Returns a list of
 * problems (empty = fine); the level modules' tests assert it is empty.
 *   1. The route is walkable: with every gate open, every section's checkpoints (and every
 *      anchor, unless `opts.anchors === false`) are reachable from `start` (the anchor, else
 *      the first player spawn) on a survivor-sized walk graph (shared/flowfield.js).
 *   2. Gates block: for each gate from section A to a later section B, with the gates leading
 *      up to A open and every other gate shut, A's checkpoints are reachable from `start` and
 *      none of B's are.
 *   3. No anchor or checkpoint stands inside an obstacle (any obstacle, a shut gate included)
 *      or in water.
 *   4. No zombie spawn rect lies inside a roofed room (`map.roofs`) of an earlier section.
 * @param {object} map built level (buildMap)
 * @param {object} [spec] the level's SPEC: each gate's `from` / `to` sections come from it (else
 *   from where the gate stands: between the two sections whose rectangles hold it)
 * @param {object} [opts] { pad = 12 (walk-graph pad), anchors = true }
 * @returns {string[]}
 */
export function validateLevel(map, spec = null, opts = {}) {
  const out = [];
  if (!map || map.kind !== 'level') return ['map.kind is not "level"'];
  const sections = map.sections || [];
  const secIdx = (id) => sections.findIndex((s) => s.id === id);
  const colliders = mapColliders(map);
  // ---- the gates: their colliders and the sections they join
  const gates = (map.gates || []).map((g) => {
    const ids = (g.obstacles || []).filter((id) => colliders[id] && colliders[id].ref && colliders[id].ref.gate === g.id);
    let x = 0, y = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const c = colliders[id];
      x += c.x / ids.length;
      y += c.y / ids.length;
      x0 = Math.min(x0, c.minX);
      y0 = Math.min(y0, c.minY);
      x1 = Math.max(x1, c.maxX);
      y1 = Math.max(y1, c.maxY);
    }
    const sg = spec && Array.isArray(spec.gates) ? spec.gates.find((e) => e.id === g.id) : null;
    let from = sg ? secIdx(sg.from) : -1, to = sg ? secIdx(sg.to) : -1;
    if (from < 0 || to < 0) {
      const holding = [];
      sections.forEach((s, k) => {
        if (Math.abs(x - s.x) <= s.w / 2 + 80 && Math.abs(y - s.y) <= s.h / 2 + 80) holding.push(k);
      });
      if (from < 0) from = holding.length ? holding[0] : -1;
      if (to < 0) to = holding.length > 1 ? holding[holding.length - 1] : from >= 0 && from + 1 < sections.length ? from + 1 : -1;
    }
    if (!ids.length) out.push(`gate "${g.id}" has no obstacles`);
    return { id: g.id, ids, from, to, x0, y0, x1, y1, mask0: ids.map((id) => colliders[id].mask) };
  });
  const setGate = (g, open) => {
    g.ids.forEach((id, k) => {
      colliders[id].mask = open ? 0 : g.mask0[k];
    });
  };

  // ---- 3. anchors and checkpoints on clear ground (every gate shut)
  const blockedAt = (x, y) => {
    for (const c of colliders) if ((c.mask & MASK_MOVE) && circleOverlapsObb(c, x, y, SPOT_R)) return c;
    return null;
  };
  const what = (c) => (c.ref && c.ref.gate ? `gate "${c.ref.gate}"` : c.ref && c.ref.kind ? `a ${c.ref.kind} obstacle` : 'an obstacle');
  for (const [name, a] of Object.entries(map.anchors || {})) {
    const c = blockedAt(a.x, a.y);
    if (c) out.push(`anchor "${name}" stands inside ${what(c)}`);
  }
  for (const cp of map.checkpoints || []) {
    const c = blockedAt(cp.x, cp.y);
    if (c) out.push(`a checkpoint of "${cp.section}" (${Math.round(cp.x)}, ${Math.round(cp.y)}) stands inside ${what(c)}`);
  }

  // ---- 1. the route with every gate open
  for (const g of gates) setGate(g, true);
  const field = new FlowField(map, { colliders, pad: opts.pad > 0 ? opts.pad : WALK_PAD, inflate: 0 });
  const startA = (map.anchors && map.anchors.start) || (map.playerSpawns && map.playerSpawns[0]) || null;
  if (!startA) return out.concat(['no "start" anchor and no player spawn']);
  const reach = new Uint8Array(field.n);
  const flood = () => {
    reach.fill(0);
    let s = field.cellAt(startA.x, startA.y);
    if (field.blocked[s] || !field.edges[s]) s = field.escape[s];
    if (s < 0) return;
    const stack = [s];
    reach[s] = 1;
    while (stack.length) {
      const c = stack.pop();
      const e = field.edges[c];
      for (let k = 0; k < 8; k++) {
        if (!(e & (1 << k))) continue;
        const nc = c + field.offs[k];
        if (!reach[nc]) {
          reach[nc] = 1;
          stack.push(nc);
        }
      }
    }
  };
  // a spot counts as reached when its own cell is, or (a cell hugging a wall) the open cell next to it
  const reached = (x, y) => {
    const c = field.cellAt(x, y);
    if (reach[c]) return true;
    const e = field.escape[c];
    if (e < 0 || !reach[e]) return false;
    const ex = ((e % field.cols) + 0.5) * field.cell, ey = (Math.floor(e / field.cols) + 0.5) * field.cell;
    return Math.hypot(ex - x, ey - y) <= field.cell * 1.5;
  };
  flood();
  for (const cp of map.checkpoints || []) {
    if (!reached(cp.x, cp.y)) out.push(`a checkpoint of "${cp.section}" (${Math.round(cp.x)}, ${Math.round(cp.y)}) cannot be reached from the start with every gate open`);
  }
  if (opts.anchors !== false) {
    for (const [name, a] of Object.entries(map.anchors || {})) {
      if (!reached(a.x, a.y)) out.push(`anchor "${name}" cannot be reached from the start with every gate open`);
    }
  }

  // ---- 2. every gate blocks the way into the section it leads to
  const open = gates.map(() => true);
  const cpsOf = (i) => (map.checkpoints || []).filter((c) => c.section === (sections[i] && sections[i].id));
  for (const g of gates) {
    if (g.from < 0 || g.to < 0) {
      out.push(`gate "${g.id}": cannot tell which sections it joins`);
      continue;
    }
    if (g.to <= g.from || !g.ids.length) continue;
    const changed = [];
    gates.forEach((h, k) => {
      const want = h !== g && h.to >= 0 && h.to <= g.from && h.to > h.from;
      if (open[k] !== want) {
        open[k] = want;
        setGate(h, want);
        changed.push(h);
      }
    });
    for (const h of changed) field.patchRegion(h.x0, h.y0, h.x1, h.y1);
    flood();
    if (!cpsOf(g.from).some((c) => reached(c.x, c.y))) {
      out.push(`gate "${g.id}": section "${sections[g.from].id}" cannot be reached with the gates before it open`);
    }
    for (const c of cpsOf(g.to)) {
      if (reached(c.x, c.y)) {
        out.push(`gate "${g.id}" does not block: a checkpoint of "${sections[g.to].id}" can be reached with it shut`);
        break;
      }
    }
  }
  for (const g of gates) setGate(g, false);

  // ---- 4. no spawn inside a roofed room of an earlier section
  const roofSec = (r) => {
    const i = r.section !== undefined ? secIdx(r.section) : -1;
    if (i >= 0) return i;
    for (let k = sections.length - 1; k >= 0; k--) {
      const s = sections[k];
      if (Math.abs(r.x - s.x) <= s.w / 2 && Math.abs(r.y - s.y) <= s.h / 2) return k;
    }
    return -1;
  };
  const roofs = (map.roofs || []).map((r) => ({ i: roofSec(r), box: makeObb(r.x, r.y, r.w, r.h, r.a || 0) }));
  map.zombieSpawns.forEach((z, k) => {
    const i = z.section !== undefined ? secIdx(z.section) : -1;
    if (i < 0) return;
    const box = makeObb(z.x, z.y, z.w, z.h, 0);
    for (const r of roofs) {
      if (r.i >= 0 && r.i < i && obbOverlap(r.box, box)) {
        out.push(`zombie spawn ${k} of "${z.section}" lies inside a roofed room of "${sections[r.i].id}"`);
        break;
      }
    }
  });
  return out;
}
