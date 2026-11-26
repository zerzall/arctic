// The stub hideout map: until the real hub maps (S3: roadhouse, depot, farmstead) exist,
// a story hideout is the Last Chance truck stop with press-E stations (`interactables`) and
// a coloured light on each so they can be found. `buildStoryMap()` is used by the host's
// game and by every client's session (which builds the map from the start message), and
// tries the real map list first, so the real hub maps take over by themselves.

import { buildMap } from '../maps.js';
import { createCollisionWorld } from '../movement.js';
import { HIDEOUT_NAMES } from './content.js';

/** Hideout map ids the stub can stand in for. */
export const STUB_HUB_IDS = ['roadhouse', 'depot', 'farmstead'];
/** The map a stub hideout is built on. */
export const STUB_HUB_BASE = 'truckstop';

/** Stations of the stub hub: id, kind, label and the offset (angle, distance) from the spawn. */
const STATIONS = [
  { id: 'board', kind: 'board', label: 'Mission board', a: -2.2, d: 210, color: '#ffc400' },
  { id: 'workbench', kind: 'workbench', label: 'Workbench', a: -0.7, d: 220, color: '#ff9a3c' },
  { id: 'armory', kind: 'armory', label: 'Armory', a: 0.5, d: 230, color: '#7fdc5a' },
  { id: 'infirmary', kind: 'infirmary', label: 'Infirmary', a: 1.7, d: 215, color: '#ff6b6b' },
  { id: 'upgrades', kind: 'upgrades', label: 'Upgrade board', a: 2.9, d: 225, color: '#5db6ff' },
];

/**
 * A map for a story stage. Real maps are built as usual; a hideout id the map list does not
 * know yet becomes the stub hub.
 * @param {string} id map id
 * @param {number} seed
 * @param {object} [opts] { mode } as for buildMap()
 */
export function buildStoryMap(id, seed, opts = null) {
  try {
    return buildMap(id, seed, opts);
  } catch (err) {
    if (!STUB_HUB_IDS.includes(id)) throw err;
  }
  const map = buildMap(STUB_HUB_BASE, seed);
  const world = createCollisionWorld(map);
  const spawn = map.playerSpawns[0];
  const interactables = [];
  const stations = [];
  const lights = map.lights.slice();
  for (const s of STATIONS) {
    let pos = null;
    // the first free spot on a widening arc around the intended place
    for (let k = 0; k < 40 && !pos; k++) {
      const a = s.a + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.12;
      const d = s.d + Math.floor(k / 4) * 24;
      const x = spawn.x + Math.cos(a) * d, y = spawn.y + Math.sin(a) * d;
      if (world.isCircleFree(x, y, 40)) pos = { x, y };
    }
    pos = pos || { x: spawn.x + Math.cos(s.a) * s.d, y: spawn.y + Math.sin(s.a) * s.d };
    const x = Math.round(pos.x), y = Math.round(pos.y);
    interactables.push({ id: s.id, kind: s.kind, x, y, r: 64, label: s.label, hold: 0 });
    stations.push({ id: s.id, kind: s.kind, x, y, r: 64 });
    lights.push({ x, y, r: 170, color: s.color, flicker: 0.04 });
  }
  return {
    ...map,
    name: HIDEOUT_NAMES[id] || 'Hideout',
    kind: 'hideout',
    stub: true,
    hub: { id, name: HIDEOUT_NAMES[id] || 'Hideout', stations, npcs: [], upgradeSlots: {} },
    interactables,
    lights,
    zombieSpawns: [],
    playerSpawns: map.playerSpawns.slice(0, 8),
  };
}

