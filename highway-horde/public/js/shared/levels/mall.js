// Westgate Mall — story level (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "mall",
  "name": "Westgate Mall",
  "chapter": 3,
  "time": "night",
  "owner": "C2",
  "description": "A two-level mall gone dark: the flooded car park, the atrium and its fountain, the food court, a department store, the parking garage and the loading dock.",
  "sections": [
    {
      "id": "lot",
      "name": "Car Park"
    },
    {
      "id": "atrium",
      "name": "Grand Atrium"
    },
    {
      "id": "foodcourt",
      "name": "Food Court"
    },
    {
      "id": "store",
      "name": "Harrow's Department Store"
    },
    {
      "id": "garage",
      "name": "Parking Garage"
    },
    {
      "id": "dock",
      "name": "Loading Dock"
    }
  ],
  "anchors": {
    "lot": [
      "start",
      "lot_cart",
      "mall_entrance"
    ],
    "atrium": [
      "atrium_fountain",
      "security_office",
      "atrium_escalator"
    ],
    "foodcourt": [
      "food_stage",
      "food_freezer",
      "food_kitchen"
    ],
    "store": [
      "store_electronics",
      "store_sporting",
      "store_pharmacy"
    ],
    "garage": [
      "garage_ramp",
      "garage_booth",
      "garage_car"
    ],
    "dock": [
      "dock_truck",
      "dock_office",
      "dock_exit"
    ]
  },
  "gates": [
    {
      "id": "mall_doors",
      "kind": "door",
      "from": "lot",
      "to": "atrium",
      "label": "Mall entrance"
    },
    {
      "id": "food_shutter",
      "kind": "shutter",
      "from": "atrium",
      "to": "foodcourt",
      "label": "Food court shutter"
    },
    {
      "id": "store_shutter",
      "kind": "shutter",
      "from": "foodcourt",
      "to": "store",
      "label": "Store shutter"
    },
    {
      "id": "garage_door",
      "kind": "door",
      "from": "store",
      "to": "garage",
      "label": "Garage door"
    },
    {
      "id": "dock_gate",
      "kind": "shutter",
      "from": "garage",
      "to": "dock",
      "label": "Dock door"
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
