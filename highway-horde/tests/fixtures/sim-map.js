// Fixture MapDef for simulation tests (SPEC §2 shape), independent of shared/maps.js.
// A 3200x2400 highway stretch: a bus objective in the middle, scattered wrecks, a
// guard-rail line with gaps, a river with two crossings on the east side, a small
// container maze in the north-west, zombie spawns along every edge.

import { createRng } from '../../public/js/shared/rng.js';

/**
 * @param {number} [seed]
 * @param {object} [opts] { width, height, clutter } — clutter = number of random wrecks
 */
export function buildFixtureMap(seed = 7, { width = 3200, height = 2400, clutter = 70 } = {}) {
  const rng = createRng(seed);
  const cx = width / 2, cy = height / 2;
  const obstacles = [];
  const add = (kind, x, y, w, h, a, solid = true) => {
    obstacles.push({ id: obstacles.length, kind, x, y, w, h, a, color: '#777777', solid, wrecked: false, roof: null });
  };
  // Guard rail across the north with gaps (low cover: blocks walking, not shots).
  for (let x = 150; x < width - 150; x += 420) add('guardrail', x + 150, 640, 300, 10, 0, false);
  // Container maze north-west.
  add('container', 500, 300, 240, 60, 0);
  add('container', 500, 440, 240, 60, 0);
  add('container', 700, 370, 60, 200, 0);
  // A building south-west.
  add('building', 520, 1850, 360, 260, 0);
  // Sandbag arc near the bus (low cover).
  add('sandbags', cx - 260, cy + 120, 90, 24, 0.9, false);
  add('sandbags', cx + 260, cy - 120, 90, 24, 0.9, false);
  // Rotated semi near the east river.
  add('semi', 2250, 1500, 340, 70, 0.6);
  const areas = [
    { kind: 'asphalt', x: cx, y: cy, w: width, h: 900, a: 0 },
    // River with two crossings (gaps at y ~ 700 and ~ 1700).
    { kind: 'water', x: 2700, y: 300, w: 120, h: 600, a: 0 },
    { kind: 'water', x: 2700, y: 1200, w: 120, h: 800, a: 0 },
    { kind: 'water', x: 2700, y: 2100, w: 120, h: 600, a: 0 },
  ];
  const zombieSpawns = [
    { x: 100, y: cy, w: 120, h: 600 },
    { x: width - 90, y: cy, w: 100, h: 600 },
    { x: cx, y: 90, w: 800, h: 100 },
    { x: cx, y: height - 90, w: 800, h: 100 },
    { x: 150, y: 150, w: 160, h: 160 },
    { x: width - 150, y: height - 150, w: 160, h: 160 },
  ];
  const keepClear = (x, y, r) => {
    if (Math.hypot(x - cx, y - cy) < 430 + r) return false;
    for (const s of zombieSpawns) {
      if (Math.abs(x - s.x) < s.w / 2 + r + 40 && Math.abs(y - s.y) < s.h / 2 + r + 40) return false;
    }
    for (const a of areas) {
      if (a.kind === 'water' && Math.abs(x - a.x) < a.w / 2 + r + 30 && Math.abs(y - a.y) < a.h / 2 + r + 30) return false;
    }
    for (const o of obstacles) {
      const ro = Math.hypot(o.w, o.h) / 2;
      if (Math.hypot(x - o.x, y - o.y) < ro + r + 60) return false;
    }
    return true;
  };
  const kinds = [['car', 90, 44], ['suv', 100, 50], ['pickup', 110, 50], ['van', 120, 56], ['barrier', 80, 20]];
  let tries = 0;
  while (obstacles.length < clutter && tries++ < 5000) {
    const [kind, w, h] = rng.pick(kinds);
    const x = rng.range(150, width - 150), y = rng.range(150, height - 150);
    if (!keepClear(x, y, Math.hypot(w, h) / 2)) continue;
    add(kind, x, y, w, h, rng.range(-0.6, 0.6), kind !== 'barrier');
  }
  const playerSpawns = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    playerSpawns.push({ x: cx + Math.cos(a) * 230, y: cy + Math.sin(a) * 200 });
  }
  return {
    id: 'fixture', name: 'Fixture Flats', width, height, seed,
    ambient: { darkness: 0.6, tint: '#223344' },
    ground: '#2a2a2a',
    areas,
    lines: [{ kind: 'white_dashed', x1: 0, y1: cy, x2: width, y2: cy, w: 4 }],
    obstacles,
    decor: [],
    lights: [],
    fires: [],
    playerSpawns,
    zombieSpawns,
    objective: { kind: 'bus', name: 'School Bus', x: cx, y: cy, w: 240, h: 70, a: 0, hp: 5000 },
    supply: { x: cx, y: cy + 150 },
  };
}

/** A tiny empty arena (no obstacles) for focused unit tests. */
export function buildArenaMap({ width = 1600, height = 1200, objective = true } = {}) {
  const cx = width / 2, cy = height / 2;
  return {
    id: 'arena', name: 'Arena', width, height, seed: 1,
    ambient: { darkness: 0.5, tint: '#222222' },
    ground: '#333333',
    areas: [],
    lines: [],
    obstacles: [],
    decor: [], lights: [], fires: [],
    playerSpawns: [0, 1, 2, 3, 4, 5].map((i) => ({ x: cx - 150 + i * 60, y: cy + 150 })),
    zombieSpawns: [
      { x: 80, y: cy, w: 100, h: 300 },
      { x: width - 80, y: cy, w: 100, h: 300 },
    ],
    objective: objective ? { kind: 'radio', name: 'Radio Mast', x: cx, y: cy - 150, w: 80, h: 80, a: 0, hp: 3000 } : { kind: 'radio', name: 'Radio', x: cx, y: 60, w: 40, h: 40, a: 0, hp: 3000 },
    supply: { x: cx, y: cy + 250 },
  };
}
