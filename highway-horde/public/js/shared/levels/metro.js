// Harlan Metro — story level (JOURNEY.md). Owner: agent C2.
//
// SPEC is the contract other parts depend on (the mission scripts, the engine, the tests): keep every
// section id (in this order), anchor name and gate id. Change the layout, the size, add sections,
// anchors, gates and props freely; build(B) is yours to replace. Until then a placeholder stands in.

import { placeholderLevel, placeholderSize } from './kit.js';

export const SPEC = Object.freeze({
  "id": "metro",
  "name": "Harlan Metro",
  "chapter": 5,
  "time": "night",
  "owner": "C2",
  "description": "Under the city: the street entrance, the ticket concourse, a platform with a dead train, the tunnels, a flooded section, the maintenance works and the stairs up into Harlan Square.",
  "sections": [
    {
      "id": "street",
      "name": "Station Street"
    },
    {
      "id": "concourse",
      "name": "Concourse"
    },
    {
      "id": "platform",
      "name": "Line 2 Platform"
    },
    {
      "id": "tunnel",
      "name": "Tunnel 2"
    },
    {
      "id": "flooded",
      "name": "The Sump"
    },
    {
      "id": "maintenance",
      "name": "Maintenance Works"
    },
    {
      "id": "exit",
      "name": "Harlan Square"
    }
  ],
  "anchors": {
    "street": [
      "start",
      "metro_entrance",
      "newsstand"
    ],
    "concourse": [
      "concourse_gates",
      "ticket_office",
      "concourse_shops"
    ],
    "platform": [
      "platform_train",
      "platform_cab",
      "platform_end"
    ],
    "tunnel": [
      "tunnel_junction",
      "tunnel_signal"
    ],
    "flooded": [
      "pump_room",
      "sump_valve"
    ],
    "maintenance": [
      "breaker",
      "workshop",
      "maint_lift"
    ],
    "exit": [
      "exit_stairs",
      "square_statue"
    ]
  },
  "gates": [
    {
      "id": "turnstiles",
      "kind": "bars",
      "from": "street",
      "to": "concourse",
      "label": "Turnstile gate"
    },
    {
      "id": "platform_door",
      "kind": "door",
      "from": "concourse",
      "to": "platform",
      "label": "Staff door"
    },
    {
      "id": "tunnel_gate",
      "kind": "gate",
      "from": "platform",
      "to": "tunnel",
      "label": "Tunnel gate"
    },
    {
      "id": "sump_door",
      "kind": "door",
      "from": "tunnel",
      "to": "flooded",
      "label": "Bulkhead"
    },
    {
      "id": "maint_shutter",
      "kind": "shutter",
      "from": "flooded",
      "to": "maintenance",
      "label": "Works shutter"
    },
    {
      "id": "exit_gate",
      "kind": "gate",
      "from": "maintenance",
      "to": "exit",
      "label": "Exit gate"
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
