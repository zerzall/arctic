// CHAPTER 4 — DELTA. The crew lives in Blackwater Depot. An army loop from Checkpoint Delta offers
// fuel and medicine by rail: 4.1 gets a locomotive out of the Harlan rail yard (and the injectors off
// the list), and at dusk the train finds Delta empty; 4.2 follows straight on to Fort Harlan airfield,
// where Sgt. Okafor's unit fell back, and the train brings everyone home to the depot.
// Zombies: the first screamer and the first Brute; virtual wave 5-7.

import { radio, say, L, PS, A, arrive, kill, noteStep } from './lib.js';

export const CH4 = [
  // ------------------------------------------------------------------------------------------
  // The Harlan rail yard by day, sunset by the end: the sidings, the engine sheds (injectors), the
  // signal box levers, the rail bridge, the freight yard crane and the main line, where locomotive 2217
  // pulls out with the yard's dead running after it.
  {
    id: 'm4_1', chapter: 4, index: 1, title: 'The Rail Yard',
    blurb: 'An army loop from Checkpoint Delta offers fuel and medicine to anyone who comes by rail. Across the river sits a rail yard with a mainline locomotive nobody has started since Day 11.',
    map: 'railyard', time: 'day', mode: 'free', level: [8, 9], party: { min: 1, max: 6 },
    requires: ['m3_2'], hub: 'depot', after: 'm4_2',
    npcs: [{ id: 'deke', at: 'start', mode: 'follow' }],
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. MORNING.'),
      L('ozzy', 'The army loop again. It\'s on band six every hour. Listen.'),
      L('okafor', 'Any civilian station, this is Checkpoint Delta, Sergeant Okafor. We have fuel, medicine and a working tower. Come by rail. Delta out.'),
      L('ozzy', 'It\'s a recording. Four days old. But the rail line runs right past Delta. Priya checked.'),
      L('priya', 'Twenty-two miles of track, if the yard gives us an engine. There\'s a mainline locomotive at the far end. It hasn\'t moved since Day 11.'),
      L('deke', 'An EMD. Sixteen cylinders. They put those engines in tugboats.'),
      L('deke', 'In tugboats. Same injectors as a ferry. That\'s a line off the Warden\'s list sitting in a shed.'),
      L('mara', 'Fuel at Delta, injectors in the yard. We\'re not shopping for a boat, apparently. We\'re building one.'),
      L('deke', 'I\'m coming. Don\'t argue. I\'ve waited sixty-four years to drive a locomotive.'),
      L('roz', 'Take sandwiches. A locomotive has no kitchen. I checked. I asked Priya.'),
      L('june', 'Can I blow the train whistle?'),
      L('deke', 'When we come back, kid. As loud as you like.'),
    ],
    steps: [
      // ---- THE SIDINGS ----------------------------------------------------------------
      kill('yard', 'any', 14, 'Clear the sidings (0/14)', {
        pressure: PS('sidings', 5, 0.6),
        onStart: [
          A.title('HARLAN RAIL YARD', 'The sidings. Morning'),
          A.music('tension'),
          say('deke', 'Rolling stock as far as you can see. Watch between the wagons. Wagons are just hallways with wheels.'),
        ],
      }),
      {
        id: 'wagon', type: 'survive', seconds: 35, text: 'A cattle wagon is rocking on its springs: hold the sidings', pressure: PS('sidings', 5, 1.1),
        onStart: [A.horde('siding_wagon', 12), A.shake(0.3), say('deke', 'Why is that wagon rocking? Oh. Oh, that\'s why.')],
      },
      {
        id: 'shedkey', type: 'collect', item: 'key', count: 1, at: ['siding_tower'], text: 'Get the shed key from the yard tower', pressure: PS('sidings', 5, 0.6),
        onDone: [A.gate('shed_door', 1), say('deke', 'Engine shed. Stand back from the door. Sheds hold their breath.')],
      },

      // ---- THE ENGINE SHEDS -----------------------------------------------------------
      arrive('sheds', 'sheds', 'Into the engine sheds', ['THE ENGINE SHEDS', 'Harlan Rail. Est. 1909'], {
        lines: [say('deke', 'Smell that? Diesel, grease and a hundred years of men swearing at engines. I\'m home.')],
      }),
      {
        id: 'injectors', type: 'collect', item: 'injector', count: 2, at: ['shed_pit', 'shed_crane'], text: 'Pull spare injectors out of the inspection pit (0/2)',
        pressure: PS('sheds', 5, 0.8, ['crawler']), flags: { ferry_injectors: true },
        onStart: [A.horde('shed_pit', 8, 'crawler'), say('deke', 'The pit! They\'re down in the pit. Of course they\'re in the pit. It\'s the lowest place in the building.')],
        onDone: [say('deke', 'EMD injectors, still in grease paper. They fit a tugboat, they\'ll fit a ferry. That\'s a line off the list.')],
      },
      {
        id: 'batteries', type: 'collect', item: 'battery', count: 2, at: ['shed_office'], text: 'Carry the starter batteries out of the shed office (0/2)', pressure: PS('sheds', 5, 0.6),
      },
      {
        id: 'gantry', type: 'activate', at: ['shed_crane'], hold: 10, text: 'Lift the derailed wagon off the yard gate with the gantry (hold E)', kind: 'winch', pressure: PS('sheds', 5, 1.0),
        onDone: [A.gate('yard_gate'), A.shake(0.5), say('deke', 'Lifted her like a teacup. I love a gantry. Don\'t tell my truck.')],
      },

      // ---- THE SIGNAL BOX --------------------------------------------------------------
      arrive('signal', 'signalbox', 'Through the yard gate to the signal box', ['THE SIGNAL BOX', 'Levers one to forty'], {
        lines: [say('deke', 'Forty levers and a diagram. Points for the main line are the red ones. They\'re always the red ones.')],
      }),
      kill('screamer', 'screamer', 1, 'Kill the pale one on the signal box stairs', {
        at: 'signal_stairs', pressure: PS('signalbox', 6, 0.6),
        onStart: [
          A.music('battle'),
          say('deke', 'That one\'s screaming. What is it screaming at?'),
          radio('mara', 'At the others. The pale ones make everything around them faster. Kill it first. Always first.'),
        ],
        onDone: [say('deke', 'Quiet. I prefer quiet. I\'m a mechanic.')],
      }),
      {
        id: 'levers', type: 'activate', at: ['signal_lever', 'signal_stairs'], hold: 6, text: 'Throw the points levers for the main line (0/2)', kind: 'switch', pressure: PS('signalbox', 6, 0.8),
        onDone: [A.gate('bridge_gate'), say('deke', 'Points set. Main line, over the river, all the way to Delta. Just like the timetable.')],
      },

      // ---- THE RAIL BRIDGE ------------------------------------------------------------
      arrive('railbridge', 'bridge', 'Out onto the rail bridge', ['THE RAIL BRIDGE', 'Over the Blackwater. Afternoon'], {
        lines: [say('deke', 'Walk the sleepers, not the gaps. The river is a long way down and it doesn\'t care who you are.')],
      }),
      kill('brute', 'brute', 1, 'Something huge is walking across the bridge', {
        at: 'bridge_mid', pressure: PS('bridge', 6, 0.4),
        onStart: [
          A.music('boss'),
          A.shake(0.5),
          say('deke', 'That isn\'t a walker. That\'s a bad day with legs.'),
          radio('mara', 'It charges when you get close. Step aside, don\'t back straight up. Then hit it from behind.'),
        ],
        onDone: [A.music('tension'), say('deke', 'Down. I\'m going to need a minute. I\'m sixty-four.')],
      }),
      {
        id: 'fence', type: 'activate', at: ['bridge_far'], hold: 6, text: 'Cut the freight yard fence at the end of the bridge (hold E)', pressure: PS('bridge', 6, 0.8),
        onDone: [A.gate('freight_gate')],
      },

      // ---- THE FREIGHT YARD -----------------------------------------------------------
      arrive('freight', 'freight', 'Into the freight yard', ['THE FREIGHT YARD', 'Containers, a crane, a switch'], {
        lines: [say('deke', 'There\'s a boxcar sitting across the main line. Of course there is. Somebody fetch me a crane.')],
      }),
      {
        id: 'diesel', type: 'collect', item: 'fuel', count: 3, at: ['freight_container'], text: 'Fill cans from the fuel tank container (0/3)', pressure: PS('freight', 6, 0.8),
        onStart: [A.horde('freight_container', 10), say('deke', 'Container seven is a fuel tank on a frame. The locomotive is thirsty and so are we.')],
      },
      {
        id: 'switch', type: 'activate', at: ['freight_switch'], hold: 6, text: 'Set the freight switch so the boxcar can roll (hold E)', kind: 'switch', pressure: PS('freight', 6, 0.9),
      },
      {
        id: 'crane', type: 'activate', at: ['freight_crane'], hold: 12, text: 'Run the crane and shove the boxcar off the main line (hold E)', pressure: PS('freight', 6, 1.1, ['screamer']),
        onDone: [A.gate('line_gate'), A.shake(0.6), say('deke', 'There she goes. Somebody tell that boxcar I\'m sorry.')],
      },

      // ---- THE MAIN LINE --------------------------------------------------------------
      arrive('mainline', 'mainline', 'Out to the main line and the locomotive', ['THE MAIN LINE', 'Locomotive 2217. Sunset'], {
        music: 'tension',
        lines: [say('deke', 'Look at her. Two hundred tons of stubborn in the last of the sun. Hello, gorgeous.')],
      }),
      {
        id: 'start', type: 'activate', at: ['locomotive'], hold: 14, text: 'Help Deke start locomotive 2217 (hold E)', kind: 'repair', pressure: PS('mainline', 6, 0.8),
        onStart: [say('deke', 'Batteries in. Fuel in. Injectors in my pocket where they\'re safe. Now we find out if she wants to live.')],
        onDone: [A.shake(0.6), say('deke', 'Listen to her! Sixteen cylinders and every one of them is angry!')],
      },
      {
        id: 'air', type: 'defend', target: 'locomotive', seconds: 80, text: 'Hold the engine while the brake air builds', pressure: PS('freight', 7, 1.2),
        onStart: [A.music('battle'), A.hordeIn('freight', 14), say('deke', 'She needs air in the brakes before she rolls. Everything in the yard just heard her. Everything is coming.')],
      },
      {
        id: 'rolling', type: 'survive', seconds: 45, text: 'The train is rolling: hold the rear platform!', pressure: PS('mainline', 7, 1.5, ['runner']),
        onStart: [A.hordeIn('mainline', 12, 'runner'), say('deke', 'Brakes off! We\'re moving! Get on, get ON!')],
        onDone: [A.music('calm'), say('deke', 'Nothing runs forever. Not even them. Next stop, Checkpoint Delta.')],
      },
    ],
    bonus: [
      noteStep('n30', 'siding_tower', 'Read the yardmaster\'s board in the tower (optional)', 'wagon'),
      noteStep('n31', 'signal_lever', 'Read the signalman\'s log (optional)', 'levers'),
      {
        id: 'lifejackets', type: 'collect', item: 'crate', count: 1, at: ['freight_crane'], text: 'Open the container stencilled HALCYON (optional)',
        since: 'diesel', flags: { ferry_lifejackets: true }, todo: 'stepFlags',
        onDone: [say('deke', 'Life jackets. Two hundred of them, addressed to the ferry Halcyon. Somebody was planning ahead.')],
      },
    ],
    rewards: {
      xp: 620, scrap: 150, weapon: 'grenade_launcher', upgradePoints: 1, flags: { train_running: true },
    },
    debrief: [
      L('deke', 'Twenty-two miles in forty minutes. I drove a train. I\'m going to say that at every meal for the rest of my life.'),
      L('priya', 'I mapped the whole line from the cab window. It\'s the fastest map I have ever drawn.'),
      L('deke', 'There was a grenade launcher in a crate marked MACHINE PARTS. Somebody in the army had a sense of humour.'),
      L('ozzy', 'The Delta loop just stopped. Mid-word. It said "come by" and nothing else.'),
      L('mara', 'Delta\'s ahead. No lights.'),
      L('mara', 'Then we go and see why.'),
    ],
    stars: { time: 1320, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },

  // ------------------------------------------------------------------------------------------
  // Fort Harlan by night, in the rain: the perimeter and the guard post, the barracks, hangar row with
  // its cargo plane and the fuel depot (JP-8, the fuel off the list), the control tower (Okafor and
  // her eleven) and Runway 27, lit for the coastal supply drop.
  {
    id: 'm4_2', chapter: 4, index: 2, title: 'Fort Harlan',
    blurb: 'Checkpoint Delta is empty, with a note on the gate: fell back to Fort Harlan. Three miles on, an airfield in the rain, one light on in the control tower, and a voice that says one word every ten minutes.',
    map: 'airbase', time: 'night', mode: 'free', level: [9, 10], party: { min: 1, max: 6 },
    requires: ['m4_1'], hub: null, after: 'hideout:depot',
    npcs: [{ id: 'okafor', at: 'tower_radio' }, { id: 'danny', at: 'tower_stairs' }],
    briefing: [
      L('narrator', 'DAY {day}. CHECKPOINT DELTA. NIGHTFALL. RAIN.'),
      L('priya', 'Delta is empty. Hesco walls, a dead tower, and a note on the gate.'),
      L('narrator', 'On the gate, in marker, on a cardboard box: FELL BACK TO FORT HARLAN AIRFIELD, DAY 47. CIVILIANS WELCOME. SGT. A. OKAFOR.'),
      L('deke', 'Fort Harlan is three miles on. The line runs past the perimeter fence. I can stop the train at the fence. Stopping is the part I haven\'t practised.'),
      L('ozzy', 'Something on the army band from the airfield. Not a loop. A person. She says one word every ten minutes. "Delta." Then nothing.'),
      L('mara', 'Somebody is counting the minutes. Let\'s go and be counted.'),
      L('priya', 'An airfield is a perimeter, barracks, hangars, a control tower and a runway. The tower is where I\'d hide if I were a sergeant.'),
      L('deke', 'And every airfield has a fuel depot. JP-8. A diesel will drink it and say thank you. That\'s the fuel line of the kid\'s list.'),
      L('mara', 'Fuel, then. And whoever keeps saying Delta.'),
    ],
    steps: [
      // ---- PERIMETER --------------------------------------------------------------------
      kill('perimeter', 'any', 14, 'Clear the perimeter road in the rain (0/14)', {
        pressure: PS('perimeter', 6, 0.6),
        onStart: [
          A.title('FORT HARLAN', 'Army airfield. Night. Rain'),
          A.music('tension'),
          radio('okafor', '...Delta.'),
          say('priya', 'There. The tower. One light on the top floor.'),
        ],
      }),
      {
        id: 'guardpost', type: 'activate', at: ['guard_post'], hold: 8, text: 'Open the main gate from the guard post (hold E)', kind: 'switch', pressure: PS('perimeter', 6, 0.9),
        onStart: [A.horde('guard_post', 8)],
        onDone: [
          A.gate('base_gate'),
          radio('okafor', 'Unidentified civilians at my main gate. Who taught you to open my gate? Identify.'),
          radio('mara', 'Mara Voss. Medic. We have a train, a mechanic and fourteen kids at a depot. We came for Delta.'),
          radio('okafor', '...You came for Delta. Nobody comes for Delta. Get to the tower. I will open the doors as you reach them.'),
        ],
      },

      // ---- BARRACKS ---------------------------------------------------------------------
      arrive('barracks', 'barracks', 'Through the main gate into the barracks', ['THE BARRACKS', 'Fort Harlan. Block C'], {
        lines: [say('priya', 'Beds made, boots lined up, a calendar stopped on the tenth. Somebody here counts things.')],
      }),
      {
        id: 'ammo', type: 'collect', item: 'ammo', count: 4, at: ['barracks_armory', 'barracks_mess'], text: 'Carry the barracks ammunition out (0/4)', pressure: PS('barracks', 6, 0.7),
        onStart: [radio('okafor', 'My armory is in Block C. We left in a hurry. Bring what you can carry. I understand that phrase is going around.')],
      },
      {
        id: 'mess', type: 'survive', seconds: 40, text: 'The mess hall doors are giving way', pressure: PS('barracks', 6, 1.2, ['screamer']),
        onStart: [
          A.horde('barracks_mess', 12),
          A.music('battle'),
          radio('danny', 'Not the mess! Sarge says they were eating when it happened! Don\'t go in the mess!'),
        ],
      },
      {
        id: 'flightline', type: 'activate', at: ['barracks_yard'], hold: 6, text: 'Cut through the flight line fence (hold E)', pressure: PS('barracks', 6, 0.8),
        onDone: [A.gate('hangar_fence')],
      },

      // ---- HANGAR ROW -------------------------------------------------------------------
      arrive('hangars', 'hangars', 'Out onto hangar row', ['HANGAR ROW', 'Rain on the runway lights'], {
        lines: [radio('okafor', 'Hangar row. The cargo plane never took off. The fuel depot is at the end. Mind the plane.')],
      }),
      {
        id: 'plane', type: 'survive', seconds: 40, text: 'The cargo plane\'s ramp is coming down', pressure: PS('hangars', 7, 1.2),
        onStart: [
          A.horde('hangar_plane', 14),
          A.shake(0.3),
          radio('danny', 'The cargo plane! The ramp is opening! Sarge, the plane is full, the plane has been full the whole time!'),
        ],
      },
      {
        id: 'jp8', type: 'collect', item: 'fuel', count: 4, at: ['fuel_depot'], text: 'Fill cans at the fuel depot: JP-8 for the ferry (0/4)',
        pressure: PS('hangars', 7, 0.8), flags: { ferry_fuel: true },
        onStart: [radio('deke', 'JP-8! The army runs everything on it, and a diesel will drink it. That\'s the fuel on the kid\'s list.')],
      },
      kill('brutes', 'brute', 2, 'Two Brutes are coming out of hangar two (0/2)', {
        at: 'hangar_doors', pressure: PS('hangars', 7, 0.5, ['screamer']),
        onDone: [A.gate('tower_door', 2), radio('okafor', 'Tower door is open. Up the stairs. Slowly. My soldiers are nervous and armed.')],
      }),

      // ---- CONTROL TOWER ----------------------------------------------------------------
      arrive('tower', 'tower', 'Into the control tower', ['THE CONTROL TOWER', 'Fort Harlan'], {
        lines: [radio('danny', 'Top of the stairs, ma\'am! I mean, whoever you are! Sarge says come up slowly and say hello loudly!')],
      }),
      {
        id: 'okafor', type: 'dialogue', npc: 'okafor', talk: true, text: 'Report to the sergeant', pressure: false,
        lines: [
          L('okafor', 'Sergeant Amara Okafor. Delta, now Fort Harlan, for as long as it stands. At the current rate, an hour.'),
          L('danny', 'Ma\'am! That isn\'t a rate, ma\'am, that\'s a guess!'),
          L('okafor', 'Private Ruiz, this is a briefing.'),
          L('danny', 'Sorry, ma\'am. I brought crackers.'),
          L('okafor', 'Eleven soldiers in this tower, average age nineteen. And five more I still count. They went up the ridge above Delta on Day 10.'),
          L('okafor', 'A supply plane flies the coast every fourth night and drops to any lit runway. Tonight is the fourth night. My runway is dark.'),
          L('okafor', 'Ruiz raises the plane on this radio. You light my runway. Then we talk about your train.'),
        ],
      },
      {
        id: 'call', type: 'wait', seconds: 20, parallel: true,
        onDone: [
          radio('danny', 'Ma\'am! Somebody else is on the band. A kid. She says she\'s the Warden.', 3600),
          radio('warden', 'Hi. Um. Is that an army? Ozzy said you\'d find an army. Is it a real army?', 4200),
          radio('okafor', 'It is eleven soldiers and a train. It is the most army there is in this county. Who is this?', 4600),
          radio('warden', 'The Warden. From Haven. From the marina. I\'m fifteen. Please don\'t tell me to stay indoors.', 4800),
          radio('okafor', '...I would never. Stay on this band, Warden. We are coming to you.', 3800),
        ],
      },
      {
        id: 'radio', type: 'defend', target: 'tower_radio', seconds: 90, text: 'Hold the tower while Danny raises the supply plane', pressure: PS('hangars', 7, 1.0),
        onStart: [
          A.dark('tower'),
          A.music('battle'),
          radio('danny', 'Coastal Supply, Coastal Supply, this is Fort Harlan tower, do you copy? Please copy. Ma\'am, they\'re not copying.'),
        ],
        onDone: [
          A.light('tower'),
          A.gate('runway_gate', 2),
          radio('danny', 'Coastal Supply copies, ma\'am! Twenty minutes out! They want a lit runway!'),
        ],
      },

      // ---- RUNWAY 27 ------------------------------------------------------------------
      arrive('runway', 'runway', 'Out onto Runway 27', ['RUNWAY 27', 'Fort Harlan. Midnight. Rain'], {
        extra: { follow: ['okafor', 'danny'] },
        lines: [say('okafor', 'Runway 27. Two miles of wet concrete and nothing to hide behind. Stay in pairs.')],
      }),
      {
        id: 'flares', type: 'activate', at: ['runway_flares', 'runway_end'], hold: 6, text: 'Light the runway flares (0/2)', kind: 'beacon', pressure: PS('runway', 7, 1.0),
        onStart: [
          A.music('battle'),
          radio('okafor', 'Flares at both ends. Every dead thing on this base will walk toward that light. That is the point, and that is the problem.'),
        ],
      },
      {
        id: 'drop', type: 'survive', seconds: 60, text: 'Hold the runway until the supply plane passes over', pressure: PS('runway', 7, 1.3, ['screamer']),
        onStart: [A.hordeIn('runway', 14), radio('danny', 'I hear engines! Big ones! Coming in low over the trees!')],
        onDone: [A.shake(0.7), A.boom('runway_end', 200, 500), radio('danny', 'PALLETS! Three pallets on the runway! One landed right on a walker, ma\'am!')],
      },
      {
        id: 'pallets', type: 'collect', item: 'supplies', count: 3, at: ['runway_end'], text: 'Recover the drop pallets (0/3)', pressure: PS('runway', 7, 0.8),
      },
      {
        id: 'home', type: 'reach', at: 'runway_end', hold: 5, who: 'all', text: 'Everyone back to the train', pressure: PS('runway', 6, 0.5),
        onDone: [A.music('calm'), radio('deke', 'All aboard. I\'ve been practising stopping. I\'m very good at starting.')],
      },
    ],
    bonus: [
      noteStep('n32', 'barracks_armory', 'Read the duty roster in the armory (optional)', 'ammo'),
      noteStep('n33', 'tower_radio', 'Read the supply plane schedule by the radio (optional)', 'okafor'),
      {
        id: 'medcrates', type: 'collect', item: 'medicine', count: 2, at: ['hangar_plane'], text: 'Carry the medical crates out of the cargo plane (optional)',
        since: 'plane', flags: { plane_medicine: true }, todo: 'stepFlags',
        onDone: [radio('mara', 'Antibiotics, saline, burn dressings. Put them on the train like they\'re made of glass.')],
      },
    ],
    rewards: {
      xp: 680, scrap: 160, weapon: 'minigun', upgradePoints: 2, flags: { met_okafor: true, met_danny: true, supply_drop: true }, unlockNpc: 'okafor',
    },
    debrief: [
      L('okafor', 'Eleven soldiers, one train, and an airfield lit up like a birthday. Nobody lost. I will say it again. Nobody lost.'),
      L('okafor', 'Colonel Reese is not coming back. Nobody is relieving me. So I am relieving myself. My unit is attached to your convoy.'),
      L('danny', 'Ma\'am, can I ride in the locomotive?'),
      L('okafor', 'Ask the engineer.'),
      L('deke', 'You can shovel coal, kid. We don\'t have coal. You can shovel feelings.'),
      L('okafor', 'The door gun from the helicopter in hangar two. It fires more than you can carry. That is a gift, not a loan.'),
      L('mara', 'And the Warden?'),
      L('okafor', 'A fifteen-year-old on a harbor radio asked me not to tell her to stay indoors. I have been told to stay put for forty days. I understand her.'),
    ],
    stars: { time: 1260, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },
];
