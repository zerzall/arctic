// Saint Mercy Hospital — story level (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "hospital",
  "name": "Saint Mercy Hospital",
  "chapter": 2,
  "time": "night",
  "owner": "C2",
  "description": "The hospital where the outbreak was first treated: the ambulance bay and car park, the emergency department, the wards, surgery, the stairwell and the rooftop helipad.",
  "sections": [
    {
      "id": "parking",
      "name": "Ambulance Bay"
    },
    {
      "id": "er",
      "name": "Emergency"
    },
    {
      "id": "wards",
      "name": "Ward C"
    },
    {
      "id": "surgery",
      "name": "Surgery"
    },
    {
      "id": "stairwell",
      "name": "Stair B"
    },
    {
      "id": "roof",
      "name": "Helipad"
    }
  ],
  "anchors": {
    "parking": [
      "start",
      "ambulance",
      "er_doors"
    ],
    "er": [
      "er_desk",
      "er_triage",
      "er_pharmacy"
    ],
    "wards": [
      "ward_nurses",
      "ward_records",
      "ward_generator"
    ],
    "surgery": [
      "surgery_theatre",
      "surgery_scrub",
      "surgery_lift"
    ],
    "stairwell": [
      "stair_bottom",
      "stair_top"
    ],
    "roof": [
      "roof_door",
      "helipad",
      "roof_radio"
    ]
  },
  "gates": [
    {
      "id": "er_doors",
      "kind": "door",
      "from": "parking",
      "to": "er",
      "label": "ER doors"
    },
    {
      "id": "ward_doors",
      "kind": "door",
      "from": "er",
      "to": "wards",
      "label": "Ward C doors"
    },
    {
      "id": "surgery_doors",
      "kind": "door",
      "from": "wards",
      "to": "surgery",
      "label": "Surgery doors"
    },
    {
      "id": "stair_door",
      "kind": "door",
      "from": "surgery",
      "to": "stairwell",
      "label": "Stair B door"
    },
    {
      "id": "roof_door",
      "kind": "shutter",
      "from": "stairwell",
      "to": "roof",
      "label": "Roof access"
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
