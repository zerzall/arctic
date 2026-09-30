// Blackwater Dam — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "dam",
  "name": "Blackwater Dam",
  "chapter": 3,
  "time": "day",
  "owner": "C3",
  "description": "A storm over the river: the canyon road, the spillway, the control room, the walkway along the crest, the turbine hall and the river village below the depot.",
  "sections": [
    {
      "id": "road",
      "name": "Canyon Road"
    },
    {
      "id": "spillway",
      "name": "Spillway"
    },
    {
      "id": "control",
      "name": "Control Room"
    },
    {
      "id": "crest",
      "name": "Dam Crest"
    },
    {
      "id": "turbines",
      "name": "Turbine Hall"
    },
    {
      "id": "riverside",
      "name": "Riverside"
    }
  ],
  "anchors": {
    "road": [
      "start",
      "road_tunnel",
      "road_truck"
    ],
    "spillway": [
      "spill_valve",
      "spill_bridge"
    ],
    "control": [
      "control_panel",
      "control_door",
      "control_radio"
    ],
    "crest": [
      "crest_mid",
      "crest_crane"
    ],
    "turbines": [
      "turbine_breaker",
      "turbine_floor",
      "turbine_exit"
    ],
    "riverside": [
      "river_boat",
      "depot_gate"
    ]
  },
  "gates": [
    {
      "id": "spill_gate",
      "kind": "gate",
      "from": "road",
      "to": "spillway",
      "label": "Spillway gate"
    },
    {
      "id": "control_door",
      "kind": "door",
      "from": "spillway",
      "to": "control",
      "label": "Control room door"
    },
    {
      "id": "crest_gate",
      "kind": "bars",
      "from": "control",
      "to": "crest",
      "label": "Crest gate"
    },
    {
      "id": "turbine_door",
      "kind": "shutter",
      "from": "crest",
      "to": "turbines",
      "label": "Turbine hall door"
    },
    {
      "id": "river_gate",
      "kind": "gate",
      "from": "turbines",
      "to": "riverside",
      "label": "River gate"
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
