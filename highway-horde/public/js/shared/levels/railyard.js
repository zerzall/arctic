// Harlan Rail Yard — story level (JOURNEY.md). Owner: agent C3.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "railyard",
  "name": "Harlan Rail Yard",
  "chapter": 4,
  "time": "night",
  "owner": "C3",
  "description": "Dusk over the tracks: the sidings, the engine sheds, the signal box, the rail bridge over the river, the freight yard and the line to Checkpoint Delta.",
  "sections": [
    {
      "id": "sidings",
      "name": "The Sidings"
    },
    {
      "id": "sheds",
      "name": "Engine Sheds"
    },
    {
      "id": "signalbox",
      "name": "Signal Box"
    },
    {
      "id": "bridge",
      "name": "Rail Bridge"
    },
    {
      "id": "freight",
      "name": "Freight Yard"
    },
    {
      "id": "mainline",
      "name": "The Main Line"
    }
  ],
  "anchors": {
    "sidings": [
      "start",
      "siding_wagon",
      "siding_tower"
    ],
    "sheds": [
      "shed_crane",
      "shed_pit",
      "shed_office"
    ],
    "signalbox": [
      "signal_lever",
      "signal_stairs"
    ],
    "bridge": [
      "bridge_mid",
      "bridge_far"
    ],
    "freight": [
      "freight_container",
      "freight_crane",
      "freight_switch"
    ],
    "mainline": [
      "locomotive",
      "line_gate"
    ]
  },
  "gates": [
    {
      "id": "shed_door",
      "kind": "shutter",
      "from": "sidings",
      "to": "sheds",
      "label": "Shed door"
    },
    {
      "id": "yard_gate",
      "kind": "gate",
      "from": "sheds",
      "to": "signalbox",
      "label": "Yard gate"
    },
    {
      "id": "bridge_gate",
      "kind": "bars",
      "from": "signalbox",
      "to": "bridge",
      "label": "Bridge gate"
    },
    {
      "id": "freight_gate",
      "kind": "fence",
      "from": "bridge",
      "to": "freight",
      "label": "Freight fence"
    },
    {
      "id": "line_gate",
      "kind": "vehicle",
      "from": "freight",
      "to": "mainline",
      "label": "A boxcar across the line"
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
