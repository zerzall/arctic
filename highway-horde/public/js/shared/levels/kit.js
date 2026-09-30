// Shared helpers for the story levels (JOURNEY.md). A level module exports its SPEC (the contract:
// section ids in travel order, the anchors each section must have, the gates between them) and a
// build(B) that lays the level out with the map builder (maps.js createBuilder) plus its level calls:
// B.section, B.gate, B.checkpoint, B.roof, B.zspawn(..., section), B.anchor.
//
// placeholderLevel(B, SPEC) builds a plain stand-in from the SPEC alone: the sections in a row along a
// road, a wall across the route between two sections with the gate in it, every anchor inside its
// section, spawns and checkpoints per section, a little cover. It keeps every name of the contract, so
// mission scripts and the engine can be built and tested against a level before its real art exists.

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
