// Hollow Creek — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "hollowcreek",
  "name": "Hollow Creek",
  "chapter": 2,
  "time": "night",
  "owner": "C1",
  "description": "A small town at night: the edge of town, Main Street and its diner, the pharmacy, St. Anne's church and bell tower, Hollow Creek Elementary and the police station.",
  "sections": [
    {
      "id": "outskirts",
      "name": "Town Line"
    },
    {
      "id": "mainstreet",
      "name": "Main Street"
    },
    {
      "id": "pharmacy",
      "name": "Rexall Pharmacy"
    },
    {
      "id": "church",
      "name": "St. Anne's"
    },
    {
      "id": "school",
      "name": "Hollow Creek Elementary"
    },
    {
      "id": "police",
      "name": "Police Station"
    }
  ],
  "anchors": {
    "outskirts": [
      "start",
      "welcome_sign",
      "water_tower"
    ],
    "mainstreet": [
      "main_diner",
      "main_hardware",
      "main_fountain",
      "main_barricade"
    ],
    "pharmacy": [
      "pharmacy_door",
      "pharmacy_counter",
      "pharmacy_back"
    ],
    "church": [
      "church_doors",
      "church_bell",
      "church_yard"
    ],
    "school": [
      "school_bus",
      "school_gym",
      "school_office",
      "school_roof"
    ],
    "police": [
      "police_lot",
      "police_armory",
      "police_cells",
      "police_exit"
    ]
  },
  "gates": [
    {
      "id": "main_barricade",
      "kind": "barricade",
      "from": "outskirts",
      "to": "mainstreet",
      "label": "The Main Street barricade"
    },
    {
      "id": "pharmacy_gate",
      "kind": "shutter",
      "from": "mainstreet",
      "to": "pharmacy",
      "label": "Pharmacy roll-down"
    },
    {
      "id": "church_gate",
      "kind": "gate",
      "from": "pharmacy",
      "to": "church",
      "label": "Churchyard gate"
    },
    {
      "id": "school_fence",
      "kind": "fence",
      "from": "church",
      "to": "school",
      "label": "School fence"
    },
    {
      "id": "police_gate",
      "kind": "bars",
      "from": "school",
      "to": "police",
      "label": "Police sally port"
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
