// Fort Harlan Airfield — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "airbase",
  "name": "Fort Harlan Airfield",
  "chapter": 4,
  "time": "night",
  "owner": "C3",
  "description": "Rain on an abandoned airbase: the perimeter fence, the barracks, the hangars and a cargo plane, the control tower and the runway lights.",
  "sections": [
    {
      "id": "perimeter",
      "name": "Perimeter"
    },
    {
      "id": "barracks",
      "name": "Barracks"
    },
    {
      "id": "hangars",
      "name": "Hangar Row"
    },
    {
      "id": "tower",
      "name": "Control Tower"
    },
    {
      "id": "runway",
      "name": "Runway 27"
    }
  ],
  "anchors": {
    "perimeter": [
      "start",
      "perimeter_gate",
      "guard_post"
    ],
    "barracks": [
      "barracks_armory",
      "barracks_mess",
      "barracks_yard"
    ],
    "hangars": [
      "hangar_doors",
      "hangar_plane",
      "fuel_depot"
    ],
    "tower": [
      "tower_radio",
      "tower_stairs"
    ],
    "runway": [
      "runway_flares",
      "runway_end"
    ]
  },
  "gates": [
    {
      "id": "base_gate",
      "kind": "gate",
      "from": "perimeter",
      "to": "barracks",
      "label": "Main gate"
    },
    {
      "id": "hangar_fence",
      "kind": "fence",
      "from": "barracks",
      "to": "hangars",
      "label": "Flight line fence"
    },
    {
      "id": "tower_door",
      "kind": "door",
      "from": "hangars",
      "to": "tower",
      "label": "Tower door"
    },
    {
      "id": "runway_gate",
      "kind": "gate",
      "from": "tower",
      "to": "runway",
      "label": "Runway gate"
    }
  ]
});

/** World size and mood (maps.js MAP_DEFS). */
export const DEF = { ...placeholderSize(SPEC.sections.length), darkness: 0.62, tint: '#3a4a60', ground: '#3f4a33' };

/**
 * Lay the level out.
 * @param {object} B map builder (maps.js createBuilder) with the level calls of JOURNEY.md §3
 */
export function build(B) {
  placeholderLevel(B, SPEC);
}
