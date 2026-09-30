// Mill Road — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "millroad",
  "name": "Mill Road",
  "chapter": 1,
  "time": "day",
  "owner": "C1",
  "description": "Dawn after the pileup. Walk west through miles of dead traffic, strip Mill Road Gas for a tow truck, cross the Shady Acres trailer park and the Haskell cornfield to the gates of the Roadhouse motel.",
  "sections": [
    {
      "id": "jam",
      "name": "The Jam"
    },
    {
      "id": "gasstation",
      "name": "Mill Road Gas"
    },
    {
      "id": "trailers",
      "name": "Shady Acres"
    },
    {
      "id": "corn",
      "name": "Haskell Cornfield"
    },
    {
      "id": "motel",
      "name": "The Roadhouse Gate"
    }
  ],
  "anchors": {
    "jam": [
      "start",
      "jam_wreck",
      "jam_semi",
      "jam_ambulance"
    ],
    "gasstation": [
      "gas_forecourt",
      "gas_office",
      "gas_garage",
      "gas_tow",
      "gas_tanks"
    ],
    "trailers": [
      "trailer_office",
      "trailer_radio",
      "trailer_pool",
      "trailer_exit"
    ],
    "corn": [
      "corn_scarecrow",
      "corn_tractor",
      "corn_silo"
    ],
    "motel": [
      "motel_sign",
      "motel_gate",
      "motel_lot"
    ]
  },
  "gates": [
    {
      "id": "gas_shutter",
      "kind": "shutter",
      "from": "jam",
      "to": "gasstation",
      "label": "Mill Road Gas: the forecourt barricade"
    },
    {
      "id": "trailer_gate",
      "kind": "gate",
      "from": "gasstation",
      "to": "trailers",
      "label": "Shady Acres gate"
    },
    {
      "id": "corn_fence",
      "kind": "fence",
      "from": "trailers",
      "to": "corn",
      "label": "The farm fence"
    },
    {
      "id": "motel_gate",
      "kind": "gate",
      "from": "corn",
      "to": "motel",
      "label": "The Roadhouse gate"
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
