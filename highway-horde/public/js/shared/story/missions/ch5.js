// CHAPTER 5 — HARLAN COUNTY. The convoy leaves the depot for the lake. The interchange at Harlan City
// is a wall of cars, so 5.1 goes under it (the Line 2 metro, from Station Street to Harlan Square,
// where the crew opens the square for the trucks); 5.2 follows straight on through the Blackpine
// forest to the Haskell farm, the last hideout.
// Zombies: the full mix, virtual wave 6-8; the Abomination lives in the metro works.

import { radio, say, L, PS, A, arrive, kill, boss, noteStep } from './lib.js';

export const CH5 = [
  // ------------------------------------------------------------------------------------------
  // Under Harlan City by day: Station Street, the concourse, the Line 2 platform with its dead train,
  // Tunnel 2, the flooded sump, the maintenance works (the Abomination) and daylight in Harlan Square.
  {
    id: 'm5_1', chapter: 5, index: 1, title: 'Underground',
    blurb: 'The interchange at Harlan City is eleven lanes of cars stacked three high. The trucks go round by the ring road; the crew goes under, through the metro, to open Harlan Square from the inside.',
    map: 'metro', time: 'day', mode: 'free', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['m4_2'], hub: 'depot', after: 'm5_2',
    npcs: [{ id: 'priya', at: 'start', mode: 'follow' }],
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. DEPARTURE.'),
      L('okafor', 'The convoy moves today. Every truck, both buses, and the train as far as the line goes. The line ends at Harlan Central.'),
      L('priya', 'And Harlan Central ends at the interchange: eleven lanes of cars, three high. Nothing drives through that.'),
      L('priya', 'Line 2 of the metro runs under it, Station Street to Harlan Square. The trucks go round by the ring road if someone opens the square from inside.'),
      L('deke', 'So you want to walk under a city.'),
      L('priya', 'I want to walk under the part of the city that\'s on fire. It\'s different.'),
      L('danny', 'Ma\'am, Sarge says the tunnels flooded when the pumps died. She says bring a friend who can swim.'),
      L('okafor', 'I said bring a friend. The swimming was implied.'),
      L('ozzy', 'The Warden says the storm front reaches the lake in two days. She\'s never sounded that scared. She\'s counting the hours now.'),
      L('mara', 'Then we\'re under the city today and in the pines tomorrow. Priya, lead.'),
    ],
    steps: [
      // ---- STATION STREET ---------------------------------------------------------------
      kill('street', 'any', 14, 'Clear Station Street under the overpass (0/14)', {
        pressure: PS('street', 6, 0.6),
        onStart: [
          A.title('HARLAN CITY', 'Station Street, under the I-70'),
          A.music('tension'),
          say('priya', 'Eleven lanes of cars over our heads. Down here it\'s just us and a newsstand.'),
        ],
      }),
      {
        id: 'grille', type: 'activate', at: ['metro_entrance'], hold: 10, text: 'Wind up the metro\'s security grille (hold E)', kind: 'winch', pressure: PS('street', 6, 1.0),
        onStart: [A.horde('newsstand', 10)],
        onDone: [A.gate('turnstiles'), say('priya', 'Down we go. The daylight stops at the third step. Say goodbye to it.')],
      },

      // ---- CONCOURSE ----------------------------------------------------------------------
      arrive('concourse', 'concourse', 'Down into the concourse', ['THE CONCOURSE', 'Harlan Metro. Line 2'], {
        onStart: [A.dark('concourse')],
        lines: [say('priya', 'Ticket office on the left, shops on the right, and the staff door at the end. Key cards live in ticket offices.')],
      }),
      {
        id: 'keycard', type: 'collect', item: 'keycard', count: 1, at: ['ticket_office'], text: 'Find a staff key card in the ticket office', pressure: PS('concourse', 6, 0.7),
        onStart: [A.horde('concourse_shops', 10)],
        onDone: [A.gate('platform_door'), say('priya', 'Staff door. The platform is through there. So is the train nobody got off.')],
      },

      // ---- LINE 2 PLATFORM ----------------------------------------------------------------
      arrive('platform', 'platform', 'Through the staff door onto the platform', ['LINE 2 PLATFORM', 'Next train: never'], {
        lines: [say('priya', 'The 8:14 to Harlan Square. The doors are shut and the windows are fogged. From the inside.')],
      }),
      {
        id: 'train', type: 'survive', seconds: 45, text: 'The train doors are opening', pressure: PS('platform', 7, 1.2),
        onStart: [A.horde('platform_train', 14), A.music('battle'), say('priya', 'Every car of that train was full. Is emptying. Back up!')],
      },
      {
        id: 'cab', type: 'activate', at: ['platform_cab'], hold: 8, text: 'Open the tunnel gate from the train cab (hold E)', kind: 'switch', pressure: PS('platform', 7, 0.8),
        onDone: [A.gate('tunnel_gate'), say('priya', 'Tunnel 2. Walk between the rails, never on them. The third rail is dead. Probably. Don\'t test probably.')],
      },

      // ---- TUNNEL 2 ----------------------------------------------------------------------
      arrive('tunnel', 'tunnel', 'Into Tunnel 2', ['TUNNEL 2', 'Station Street to Harlan Square'], {
        onStart: [A.dark('tunnel')],
        music: 'tension',
        lines: [radio('ozzy', 'I lost you for a second. Concrete eats radio. Keep talking so I know you\'re there.')],
      }),
      kill('brute', 'brute', 1, 'Something is filling the tunnel ahead', {
        at: 'tunnel_junction', pressure: PS('tunnel', 7, 0.5, ['crawler']),
        onStart: [A.shake(0.4), say('priya', 'That isn\'t an echo. Those are footsteps. Very big footsteps.')],
      }),
      {
        id: 'signal', type: 'activate', at: ['tunnel_signal'], hold: 8, text: 'Reset the tunnel signal to release the bulkhead (hold E)', kind: 'switch', pressure: PS('tunnel', 7, 0.9),
        onDone: [A.gate('sump_door'), say('priya', 'Bulkhead\'s open. Past it is the sump. Wet feet from here on.')],
      },

      // ---- THE SUMP ----------------------------------------------------------------------
      arrive('sump', 'flooded', 'Through the bulkhead into the flooded section', ['THE SUMP', 'Knee deep and rising'], {
        lines: [say('priya', 'The pump room is up the ladder. The valve is down in the water. Everybody guess which one I\'m taking.')],
      }),
      {
        id: 'pumps', type: 'activate', at: ['pump_room'], hold: 16, text: 'Start the sump pumps (hold E, together is faster)', kind: 'pump', pressure: PS('flooded', 7, 1.0, ['spitter']),
        onStart: [A.music('battle'), A.horde('sump_valve', 8)],
      },
      {
        id: 'drain', type: 'activate', at: ['sump_valve'], hold: 8, text: 'Open the drain valve (hold E)', kind: 'valve', pressure: PS('flooded', 7, 0.9),
        onDone: [A.shake(0.4), A.gate('maint_shutter'), say('priya', 'Hear that? That\'s the river going back where it belongs.')],
      },

      // ---- THE WORKS --------------------------------------------------------------------
      arrive('works', 'maintenance', 'Into the maintenance works', ['THE WORKS', 'Harlan Metro maintenance'], {
        music: 'tension',
        lines: [say('priya', 'Somebody built a wall of lockers across the workshop door. From this side. Let\'s not open the workshop.')],
      }),
      {
        id: 'breaker', type: 'activate', at: ['breaker'], hold: 10, text: 'Throw the main breaker for the exit lift (hold E)', kind: 'switch', pressure: PS('maintenance', 7, 0.8),
        onDone: [A.light('maintenance'), A.light('tunnel'), A.shake(0.6), say('priya', 'Lights. And... something in the workshop just woke up with them.')],
      },
      boss('abomination', 'Bring down the thing in the workshop', {
        at: 'workshop', pressure: PS('maintenance', 6, 0.4),
        onStart: [
          A.music('boss'),
          A.shake(0.8),
          say('priya', 'That isn\'t a Brute. That\'s what Brutes have nightmares about.'),
          radio('okafor', 'It is slow. Use the slow. Keep moving, never stand still, and hit it with everything you have.'),
        ],
        onDone: [A.music('tension'), radio('okafor', 'Target down. I will be using that phrase once, and that was the once.')],
      }),
      {
        id: 'lift', type: 'activate', at: ['maint_lift'], hold: 8, text: 'Call the service lift up to the exit gate (hold E)', pressure: PS('maintenance', 7, 0.7),
        onDone: [A.gate('exit_gate'), say('priya', 'Daylight. Up there. Actual daylight.')],
      },

      // ---- HARLAN SQUARE ------------------------------------------------------------------
      arrive('square', 'exit', 'Up the stairs into Harlan Square', ['HARLAN SQUARE', 'Daylight'], {
        music: 'calm',
        lines: [say('priya', 'Oh. The sky. I forgot the sky was that colour.')],
      }),
      {
        id: 'barricade', type: 'defend', target: 'square_statue', seconds: 90, text: 'Hold the square while Priya opens the barricade for the trucks', pressure: PS('exit', 7, 1.1),
        onStart: [A.music('battle'), A.hordeIn('exit', 14), radio('deke', 'Ring road, three minutes out! Open that square!')],
        onDone: [radio('deke', 'Through! Every truck! Honk if you love Priya!')],
      },
      {
        id: 'trucks', type: 'reach', at: 'square_statue', hold: 4, who: 'all', text: 'Climb onto the trucks', pressure: false,
        onDone: [A.music('calm'), say('priya', 'Harlan Square. Population: us, and a man on a horse who looks disappointed.')],
      },
    ],
    bonus: [
      noteStep('n34', 'ticket_office', 'Read the station master\'s announcement script (optional)', 'keycard'),
      noteStep('n35', 'workshop', 'Read the maintenance log on the workbench (optional)', 'abomination'),
      {
        id: 'newspaper', type: 'collect', item: 'crate', count: 1, at: ['newsstand'], text: 'Take the last newspaper from the stand (optional)',
        since: 'street', flags: { last_newspaper: true }, todo: 'stepFlags',
        onDone: [say('priya', 'Harlan Courier, Day 3. "Fainting cases rise; officials urge calm." I\'m keeping it. For the map. Not for me.')],
      },
    ],
    rewards: {
      xp: 720, scrap: 180, weapon: 'tesla', upgradePoints: 1, flags: { metro_cleared: true },
    },
    debrief: [
      L('priya', 'Harlan Square. I\'m entering it in the book. Population: us, and a statue.'),
      L('okafor', 'The convoy is through the square and on the county road. We are forty miles from the lake.'),
      L('danny', 'Ma\'am, the thing in the workshop...'),
      L('okafor', 'Is dead, Ruiz. Eat a cracker.'),
      L('deke', 'The maintenance crew built a gun out of a third-rail test rig. It throws lightning. Ozzy wants to marry it.'),
      L('ozzy', 'I don\'t want to MARRY it. I want to take it to dinner and see how things go.'),
      L('mara', 'Tomorrow the pines. The Haskell farm is on the far side. One more night on the road.'),
    ],
    stars: { time: 1380, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },

  // ------------------------------------------------------------------------------------------
  // Blackpine by day, in the morning fog: the trailhead, the campground, the ranger station and the fire
  // lookout (the signal fire the Warden sees across the lake), Cutter's Gorge, the lumber mill and the
  // Haskell farm fence.
  {
    id: 'm5_2', chapter: 5, index: 2, title: 'Blackpine',
    blurb: 'The trucks go round by the county road. The crew goes straight through the Blackpine forest to reach the Haskell farm first: fog, a fire lookout, a gorge, a dead mill, and at the far side, the last house before the lake.',
    map: 'forest', time: 'day', mode: 'free', level: [11, 12], party: { min: 1, max: 6 },
    requires: ['m5_1'], hub: null, after: 'hideout:farmstead',
    npcs: [{ id: 'okafor', at: 'start', mode: 'follow' }, { id: 'danny', at: 'start', mode: 'follow' }],
    briefing: [
      L('narrator', 'DAY {day}. BLACKPINE STATE FOREST. DAWN.'),
      L('okafor', 'The trucks take the county road round the forest. Forty miles. We walk through it. Eleven.'),
      L('priya', 'The Haskell farm is on the far side. Trailhead, campground, ranger station, Cutter\'s Gorge, the old lumber mill, the farm fence.'),
      L('deke', 'Old Haskell sold his corn to the county and kept the farm. Good barn. Better well. He won\'t mind. He\'s been dead since spring.'),
      L('danny', 'Ma\'am, the fog. I can\'t see past the second tree.'),
      L('okafor', 'Then look at the first tree very carefully.'),
      L('ozzy', 'The ranger station has a fire lookout. Light the signal fire and the trucks can steer by it. So could somebody across the lake.'),
      L('mara', 'She\'d see us. Before we ever get there, she\'d see us coming.'),
      L('priya', 'If the gorge footbridge is down, we winch it up. If we can\'t winch it up, I\'ll think of something expensive.'),
    ],
    steps: [
      // ---- TRAILHEAD -------------------------------------------------------------------
      kill('fog', 'any', 12, 'Shapes in the fog: clear the trailhead (0/12)', {
        pressure: PS('trailhead', 7, 0.6),
        onStart: [
          A.title('BLACKPINE', 'State forest. Morning fog'),
          A.music('tension'),
          say('okafor', 'Fog is a friend and an enemy. They cannot see you. You cannot see them. Listen.'),
        ],
      }),
      {
        id: 'trailmap', type: 'reach', at: 'trail_map', hold: 3, text: 'Read the trail map at the trailhead', pressure: PS('trailhead', 7, 0.4),
        onDone: [say('priya', 'Campground, ranger station, the gorge, the mill. Somebody has drawn a skull on the gorge in pen. Helpful.')],
      },
      {
        id: 'carkey', type: 'collect', item: 'key', count: 1, at: ['trail_car'], text: 'Find the campground gate key in the ranger\'s car', pressure: PS('trailhead', 7, 0.7),
        onStart: [A.horde('trail_car', 8)],
        onDone: [A.gate('camp_gate')],
      },

      // ---- CAMPGROUND ------------------------------------------------------------------
      arrive('camp', 'campground', 'Through the gate into the campground', ['BLACKPINE CAMPGROUND', 'Sites one to forty'], {
        lines: [say('danny', 'Ma\'am, there are tents with sleeping bags still in them. Ma\'am, I\'m not going to look in the sleeping bags.')],
      }),
      {
        id: 'supplies', type: 'collect', item: 'supplies', count: 3, at: ['camp_rv', 'camp_showers'], text: 'Search the campground for supplies (0/3)',
        pressure: PS('campground', 7, 0.8, ['crawler']),
        onStart: [A.horde('camp_showers', 10, 'crawler'), say('okafor', 'The shower block. Low ones. Mind your ankles.')],
      },
      {
        id: 'horn', type: 'survive', seconds: 40, text: 'An RV horn is stuck: the whole valley is coming', pressure: PS('campground', 7, 1.2),
        onStart: [A.music('battle'), A.hordeIn('campground', 12), say('danny', 'It wasn\'t me, ma\'am! I leaned on it! Leaning isn\'t pressing!')],
        onDone: [
          say('okafor', 'Ruiz. Cutters. The ranger fence.'),
          say('danny', 'Cutting, ma\'am! Cutting like the wind!'),
          A.gate('ranger_gate', 3),
        ],
      },

      // ---- RANGER STATION ----------------------------------------------------------------
      arrive('ranger', 'ranger', 'Into the ranger compound', ['RANGER STATION', 'Fire lookout. Elevation 2,400'], {
        lines: [say('okafor', 'Radio in the station, lookout on the ridge, a truck in the yard. Somebody ran this place well. Let us borrow it.')],
      }),
      {
        id: 'rangerradio', type: 'activate', at: ['ranger_radio'], hold: 6, text: 'Call the trucks on the ranger radio (hold E)', kind: 'radio', pressure: PS('ranger', 7, 0.6),
        onDone: [radio('deke', 'Trucks here. The county road is slow and the fog is thick. Give us something to steer by.')],
      },
      {
        id: 'lookout', type: 'activate', at: ['ranger_lookout'], hold: 12, text: 'Climb the lookout and light the signal fire (hold E)', kind: 'beacon', pressure: PS('ranger', 7, 0.9),
        onDone: [
          A.music('tension'),
          radio('deke', 'I see it! A light on the ridge! We\'re steering by you!'),
          radio('warden', 'I see a fire on the ridge. Across the water. Is that... is that you?'),
          radio('ozzy', 'That\'s us, Warden. That\'s the crew.'),
          radio('warden', 'Okay. Okay. I\'ll leave the harbor light on. Every night. Until you get here.'),
        ],
      },
      {
        id: 'beacon', type: 'survive', seconds: 50, text: 'The signal fire is calling everything in the forest', pressure: PS('ranger', 8, 1.4, ['runner']),
        onStart: [A.hordeIn('ranger', 14), A.music('battle')],
      },
      {
        id: 'charges', type: 'collect', item: 'charge', count: 2, at: ['ranger_truck'], text: 'Take the stump charges from the ranger truck (0/2)', pressure: PS('ranger', 7, 0.7),
        onDone: [
          say('okafor', 'Rockfall on the gorge trail. Charges set. Everybody behind the truck. Fire in the hole.'),
          A.gate('gorge_rubble', 3),
          A.shake(0.8, 3),
        ],
      },

      // ---- CUTTER'S GORGE ----------------------------------------------------------------
      arrive('gorge', 'gorge', 'Through the rockfall to Cutter\'s Gorge', ['CUTTER\'S GORGE', 'Footbridge. Long way down'], {
        lines: [say('danny', 'The bridge is hanging off the far side, ma\'am. There\'s a winch. I\'m not saying I want to use the winch.')],
      }),
      {
        id: 'winch', type: 'activate', at: ['gorge_winch'], hold: 14, text: 'Winch the footbridge back up (hold E, together is faster)', kind: 'winch', pressure: PS('gorge', 8, 1.0),
        onStart: [A.horde('gorge_far', 10)],
        onDone: [A.shake(0.4), say('priya', 'It\'s up. It sways. Everything that\'s any good sways a bit.')],
      },
      {
        id: 'cross', type: 'reach', at: 'gorge_far', who: 'all', text: 'Cross the footbridge', pressure: PS('gorge', 8, 0.8),
        onDone: [A.gate('mill_gate'), say('okafor', 'Mill gate is open. Keep together. Mills are loud places, even dead ones.')],
      },

      // ---- HARLAN LUMBER ------------------------------------------------------------------
      arrive('mill', 'lumbermill', 'Through the gate into the lumber mill', ['HARLAN LUMBER', 'Closed Sundays, and forever'], {
        lines: [say('okafor', 'The farm is on the far side of this yard. Something big is moving between the log stacks. Two somethings.')],
      }),
      kill('brutes', 'brute', 2, 'Brutes in the log yard (0/2)', {
        at: 'mill_yard', pressure: PS('lumbermill', 8, 0.5, ['screamer']),
        onStart: [A.music('boss'), say('danny', 'Ma\'am, those are the biggest ones I\'ve ever seen, ma\'am.')],
        onDone: [A.music('tension'), say('okafor', 'And now they are the biggest ones you have ever put down.')],
      }),
      {
        id: 'saw', type: 'activate', at: ['mill_saw'], hold: 8, text: 'Start the head saw to pull the dead away from the farm (hold E)',
        effect: 'lure', lure: { to: 'mill_saw', seconds: 60 }, pressure: PS('lumbermill', 8, 0.6), todo: 'lure',
        onDone: [say('okafor', 'Noise. Everything in this forest is walking toward that saw. Good. Now we walk the other way.')],
      },
      {
        id: 'cutters', type: 'activate', at: ['mill_office'], hold: 6, text: 'Take the chain cutters from the mill office (hold E)', pressure: PS('lumbermill', 7, 0.5),
        onDone: [A.gate('farm_fence', 2), say('danny', 'The fence is down! I can see a barn! A real barn, ma\'am!')],
      },

      // ---- THE FARM FENCE ----------------------------------------------------------------
      arrive('farm', 'farmgate', 'Through the fence onto the Harlan farm', ['THE HARLAN FARM', 'The Haskell place. Last stop'], {
        lines: [say('okafor', 'A barn, a house, a well. And the lake, past the ridge. We hold the gate until the trucks are in.')],
      }),
      {
        id: 'hold_gate', type: 'defend', target: 'farm_gate', seconds: 90, text: 'Hold the farm gate until the trucks arrive', pressure: PS('lumbermill', 8, 1.2),
        onStart: [A.music('battle'), radio('deke', 'County road! We\'re on the farm road! Hold that gate!')],
      },
      {
        id: 'signal', type: 'activate', at: ['farm_signal'], hold: 4, text: 'Signal the trucks in (hold E)', kind: 'beacon', pressure: false,
        onDone: [
          A.shut('farm_fence'),
          A.music('calm'),
          radio('deke', 'Every truck. Every kid. Every chicken Roz picked up on the way, which is four.'),
        ],
      },
    ],
    bonus: [
      noteStep('n36', 'camp_rv', 'Read the family diary in the RV (optional)', 'supplies'),
      noteStep('n37', 'ranger_lookout', 'Read the fire lookout\'s log (optional)', 'lookout'),
      {
        id: 'deed', type: 'collect', item: 'crate', count: 1, at: ['mill_office'], text: 'Find the old Haskell deed in the mill office (optional)',
        since: 'brutes', flags: { haskell_deed: true }, todo: 'stepFlags',
        onDone: [radio('deke', 'The Haskell deed? Signed over to one Ezekiel Harlan, 1881, lost in a card game, 1881. My family has been here before.')],
      },
    ],
    rewards: {
      xp: 780, scrap: 190, weapon: 'sniper', upgradePoints: 2, flags: { farmstead_reached: true, lookout_fire: true },
    },
    debrief: [
      L('okafor', 'Eleven soldiers, one sergeant, one crew, one forest. All present.'),
      L('priya', 'Blackpine is on the map. The fog is not. You can\'t map fog. I tried.'),
      L('deke', 'The ranger station had a scoped rifle in a locker marked FOR BEARS. There aren\'t any bears. There\'s you.'),
      L('mara', 'She saw our fire. The Warden saw our fire from across the lake.'),
      L('ozzy', 'She left the harbor light on. She said she\'d leave it on every night until we get there.'),
      L('june', 'Is this the last house before the boat?'),
      L('mara', 'It\'s the last house before the boat.'),
    ],
    stars: { time: 1380, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },
];
