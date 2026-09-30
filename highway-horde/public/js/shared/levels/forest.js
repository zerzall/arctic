// Blackpine Forest — story level (JOURNEY.md). Owner: agent C1.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "forest",
  "name": "Blackpine Forest",
  "chapter": 5,
  "time": "night",
  "owner": "C1",
  "description": "Fog in the pines: a trailhead, a campground, the ranger station and fire lookout, a river gorge with a swinging footbridge, a dead lumber mill and the fence of the Harlan farm.",
  "sections": [
    {
      "id": "trailhead",
      "name": "Trailhead"
    },
    {
      "id": "campground",
      "name": "Blackpine Campground"
    },
    {
      "id": "ranger",
      "name": "Ranger Station"
    },
    {
      "id": "gorge",
      "name": "Cutter's Gorge"
    },
    {
      "id": "lumbermill",
      "name": "Harlan Lumber"
    },
    {
      "id": "farmgate",
      "name": "The Farm Fence"
    }
  ],
  "anchors": {
    "trailhead": [
      "start",
      "trail_map",
      "trail_car"
    ],
    "campground": [
      "camp_fire",
      "camp_rv",
      "camp_showers"
    ],
    "ranger": [
      "ranger_radio",
      "ranger_lookout",
      "ranger_truck"
    ],
    "gorge": [
      "gorge_bridge",
      "gorge_winch",
      "gorge_far"
    ],
    "lumbermill": [
      "mill_saw",
      "mill_yard",
      "mill_office"
    ],
    "farmgate": [
      "farm_gate",
      "farm_signal"
    ]
  },
  "gates": [
    {
      "id": "camp_gate",
      "kind": "gate",
      "from": "trailhead",
      "to": "campground",
      "label": "Campground gate"
    },
    {
      "id": "ranger_gate",
      "kind": "fence",
      "from": "campground",
      "to": "ranger",
      "label": "Ranger compound"
    },
    {
      "id": "gorge_rubble",
      "kind": "rubble",
      "from": "ranger",
      "to": "gorge",
      "label": "Rockfall"
    },
    {
      "id": "mill_gate",
      "kind": "gate",
      "from": "gorge",
      "to": "lumbermill",
      "label": "Mill gate"
    },
    {
      "id": "farm_fence",
      "kind": "fence",
      "from": "lumbermill",
      "to": "farmgate",
      "label": "Farm fence"
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
