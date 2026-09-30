// CHAPTER 3 — BLACKWATER. The crew leaves the Roadhouse for good. 3.1 starts at the mission board
// (the Westgate mall, where Priya has been holed up in the security office); 3.2 follows straight on
// (the Blackwater dam in a storm, the only crossing left), and the chapter ends at Blackwater Depot.
// Zombies: bloaters and spitters join the mix (virtual wave 4-5).

import { radio, say, L, PS, A, arrive, kill, noteStep } from './lib.js';

export const CH3 = [
  // ------------------------------------------------------------------------------------------
  // Westgate by day: the flooded car park, the Grand Atrium under its skylights (Priya), the food
  // court, Harrow's department store gone dark, the parking garage and the loading dock's box truck.
  {
    id: 'm3_1', chapter: 3, index: 1, title: 'Westgate',
    blurb: 'The convoy leaves the Roadhouse for the lake. On the way, a voice on the Westgate Mall\'s speakers: a surveyor with a wrench, twelve days in the security office, and a map of the only way across the river.',
    map: 'mall', time: 'day', mode: 'free', level: [6, 7], party: { min: 1, max: 6 },
    requires: ['m2_2'], hub: 'roadhouse', after: 'm3_2',
    npcs: [{ id: 'priya', at: 'security_office' }],
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. THE LAST MORNING.'),
      L('roz', 'Forty people, three crates of peaches and a cast-iron skillet older than the state. Nobody leaves a Roadhouse hungry.'),
      L('mara', 'Nobody leaves a Roadhouse at all, Roz. That\'s the point of today.'),
      L('roz', 'It\'s my kitchen, hon. I\'m allowed to get sentimental about it.'),
      L('deke', 'Tow truck, the bus and the laundry van. Highway 9 west to the river, then the lake road north.'),
      L('ozzy', 'There\'s a voice on the Westgate Mall\'s speakers. It\'s been on a loop since yesterday. Listen.'),
      L('priya', 'If anyone can hear this: I\'m in the mall security office. I\'m not army. I\'m a surveyor with a wrench, and I\'m out of wrench.'),
      L('priya', 'Also, the Blackwater bridge is gone. If you\'re heading west, you\'ll want my map. I\'ll trade it for a way out.'),
      L('deke', 'I like her.'),
      L('mara', 'Westgate is on the way. The convoy waits on the highway. We go in, we get her, we get out.'),
      L('june', 'Can we go to the toy store?'),
      L('mara', 'We\'re going to a mall full of the dead, June. It\'s a very bad toy store.'),
    ],
    steps: [
      // ---- CAR PARK -----------------------------------------------------------------------
      kill('lot', 'any', 12, 'Clear the car park (0/12)', {
        pressure: PS('lot', 4, 0.5),
        onStart: [
          A.title('WESTGATE MALL', 'The car park. Late morning'),
          A.music('tension'),
          radio('ozzy', 'The car park flooded when the drains died. Watch the water. The fat ones like the water.'),
        ],
      }),
      {
        id: 'doors', type: 'activate', at: ['mall_entrance'], hold: 8, text: 'Cut the chain on the mall doors (hold E)', pressure: PS('lot', 4, 0.8),
        onStart: [A.horde('lot_cart', 6)],
        onDone: [A.gate('mall_doors'), radio('priya', 'I heard that. I saw that on camera nine. Hello! Straight on, up the atrium, the door with the badge on it.')],
      },

      // ---- GRAND ATRIUM ------------------------------------------------------------------
      arrive('atrium', 'atrium', 'Into the Grand Atrium', ['THE GRAND ATRIUM', 'Sun through the skylights'], {
        music: 'calm',
        lines: [radio('priya', 'Mind the fountain. It\'s not a fountain now. It\'s a very large bath for things I don\'t want to describe.')],
      }),
      {
        id: 'office', type: 'reach', at: 'security_office', text: 'Get to the security office', pressure: PS('atrium', 4, 0.5),
      },
      {
        id: 'priya', type: 'dialogue', npc: 'priya', talk: true, text: 'Talk to the woman behind the desk barricade', pressure: false,
        lines: [
          L('priya', 'Priya Nair. Surveyor. Formerly of a county that doesn\'t exist anymore. Twelve days in this office. I\'ve named the cameras.'),
          L('priya', 'The river bridge dropped a span on Day 30. I was on it with a clipboard. The dam is the only crossing left, and I know the dam.'),
          L('priya', 'There\'s a box truck at the loading dock with half a tank. Food court, Harrow\'s, the garage, the dock. That\'s the way out.'),
          L('priya', 'The food court shutter runs off this panel. Everything in the food court is waiting on the other side of it.'),
        ],
      },
      {
        id: 'panel', type: 'activate', at: ['security_office'], hold: 5, text: 'Raise the food court shutter from the security panel (hold E)', pressure: false,
        follow: ['priya'],
        onDone: [
          A.gate('food_shutter'),
          A.hordeIn('foodcourt', 14),
          A.music('battle'),
          say('priya', 'Here they come. The fat ones burst. Shoot them from far away, never next to anything you want to keep.'),
        ],
      },
      {
        id: 'hold_atrium', type: 'survive', seconds: 50, text: 'Hold the atrium while the food court empties', pressure: PS('foodcourt', 4, 1.1, ['bloater']),
        onDone: [say('priya', 'That\'s the worst of them. Probably. Maybe. I\'m a surveyor, not a statistician.')],
      },

      // ---- FOOD COURT ----------------------------------------------------------------------
      arrive('food', 'foodcourt', 'Through the shutter into the food court', ['THE FOOD COURT', 'Twelve kitchens, no cooks'], {
        lines: [say('priya', 'Twelve kitchens and a stage for the Christmas choir. I watched them on camera for twelve days. Don\'t look at the stage.')],
      }),
      {
        id: 'stores', type: 'collect', item: 'crate', count: 4, at: ['food_kitchen', 'food_freezer'], text: 'Carry out the kitchen stores for Roz (0/4)', pressure: PS('foodcourt', 4, 0.7),
        onStart: [radio('roz', 'Kitchens! Real kitchens! Tins, flour, oil. Bring me flour and I\'ll bring you bread.')],
      },
      {
        id: 'freezer', type: 'survive', seconds: 35, text: 'Something is coming out of the walk-in freezer', pressure: PS('foodcourt', 4, 1.2, ['crawler']),
        onStart: [A.horde('food_freezer', 8, 'crawler'), A.shake(0.3), say('priya', 'The freezer door! I TOLD camera four not to open the freezer!')],
      },
      {
        id: 'firepanel', type: 'activate', at: ['food_stage'], hold: 6, text: 'Trip the fire release on the stage panel (hold E)', pressure: PS('foodcourt', 4, 0.8, ['spitter']),
        onStart: [say('priya', 'Harrow\'s shutter is on the fire panel behind the stage. Watch the ones that spit. Stay behind something.')],
        onDone: [A.gate('store_shutter'), say('priya', 'Harrow\'s is open. The power in there died on Day 20. It\'s the darkest room in the county.')],
      },

      // ---- HARROW'S -----------------------------------------------------------------------
      arrive('harrows', 'store', 'Into Harrow\'s Department Store', ['HARROW\'S', 'Department store. No lights'], {
        onStart: [A.dark('store')],
        music: 'tension',
        lines: [say('priya', 'Flashlights. The only light in here is the exit sign, and it\'s lying.')],
      }),
      {
        id: 'batteries', type: 'collect', item: 'battery', count: 2, at: ['store_electronics'], text: 'Take batteries from electronics for Ozzy\'s radio (0/2)',
        pressure: PS('store', 4, 0.7, ['spitter']),
        onStart: [radio('ozzy', 'D cells! Big ones! The radio eats D cells like June eats peaches!')],
      },
      {
        id: 'sporting', type: 'collect', item: 'ammo', count: 3, at: ['store_sporting'], text: 'Clear out sporting goods (0/3)', pressure: PS('store', 4, 0.8),
        onStart: [A.horde('store_sporting', 8), say('priya', 'Sporting goods. Ammunition, fishing line, and a spear gun somebody left in its box.')],
        onDone: [say('priya', 'The garage stairs are through the pharmacy corner. I can see the exit sign. It\'s the only light in here.')],
      },
      {
        id: 'garagedoor', type: 'activate', at: ['store_pharmacy'], hold: 6, text: 'Force the garage door by the pharmacy counter (hold E)', pressure: PS('store', 4, 1.0),
        onDone: [A.gate('garage_door'), A.light('store', 2)],
      },

      // ---- PARKING GARAGE ---------------------------------------------------------------
      arrive('garage', 'garage', 'Down into the parking garage', ['PARKING GARAGE', 'Level P1'], {
        lines: [say('priya', 'Concrete, oil stains and forty cars nobody came back for. Don\'t touch the cars.')],
      }),
      {
        id: 'alarm', type: 'survive', seconds: 40, text: 'A car alarm is screaming through the garage', pressure: PS('garage', 4, 1.2),
        onStart: [A.music('battle'), A.horde('garage_ramp', 10), say('priya', 'Who touched a car? Somebody touched a car.')],
      },
      {
        id: 'booth', type: 'activate', at: ['garage_booth'], hold: 8, text: 'Raise the dock door from the attendant\'s booth (hold E)', pressure: PS('garage', 4, 0.8),
        onDone: [A.boom('garage_car', 240, 500), A.shake(0.6), A.gate('dock_gate', 1), say('priya', 'That car was leaking fuel onto a wire. It was going to do that anyway. Probably.')],
      },

      // ---- LOADING DOCK -----------------------------------------------------------------
      arrive('dock', 'dock', 'Out onto the loading dock', ['THE LOADING DOCK', 'Bay 4'], {
        lines: [say('priya', 'There she is. A box truck with half a tank and a dent shaped like somebody\'s bad day. The keys are in the office.')],
      }),
      {
        id: 'truckkeys', type: 'collect', item: 'key', count: 1, at: ['dock_office'], text: 'Find the box truck\'s keys in the dock office', pressure: PS('dock', 4, 0.6),
      },
      {
        id: 'truck', type: 'defend', target: 'dock_truck', seconds: 80, text: 'Hold the dock while Priya gets the box truck running', pressure: PS('garage', 4, 1.0, ['bloater']),
        onStart: [A.music('battle'), say('priya', 'Half a tank. Cold engine. Give me a minute and a half and nobody touching my truck.')],
        onDone: [say('priya', 'She\'s running! She\'s running! I\'m keeping her. I\'m not keeping her. She\'s geography.')],
      },
      {
        id: 'out', type: 'reach', at: 'dock_exit', hold: 4, who: 'all', text: 'Everyone on the truck: out to the convoy', pressure: PS('dock', 4, 0.5),
        onDone: [A.music('calm'), radio('deke', 'Box truck, coming up the ramp. Is that yours? It\'s ours now. Welcome to the convoy.')],
      },
    ],
    bonus: [
      noteStep('n26', 'security_office', 'Read Priya\'s camera log (optional)', 'priya'),
      noteStep('n27', 'store_pharmacy', 'Read the note on Harrow\'s pharmacy counter (optional)', 'sporting'),
      {
        id: 'toy', type: 'collect', item: 'crate', count: 1, at: ['store_electronics'], text: 'Find a toy for June in Harrow\'s (optional)',
        since: 'batteries', flags: { june_toy: true }, todo: 'stepFlags',
        onDone: [radio('mara', 'A wind-up robot? It still walks. It walks slower than they do. She\'s going to love it.')],
      },
    ],
    rewards: {
      xp: 540, scrap: 120, weapon: 'harpoon', upgradePoints: 1, flags: { met_priya: true, box_truck: true }, unlockNpc: 'priya',
    },
    debrief: [
      L('priya', 'Forty-three days out here. Twelve of them in an office chair. I have a map, and I\'m not staying.'),
      L('deke', 'Nobody asked.'),
      L('priya', 'You had the look. Everywhere I go, I get the look.'),
      L('priya', 'The bridge is out. The Blackwater dam has a road across the crest, and a control room that works if you ask it nicely.'),
      L('mara', 'You aren\'t staying, but you\'ll show us the dam.'),
      L('priya', 'It\'s a dam. It isn\'t staying. It\'s geography.'),
      L('ozzy', 'I told the Warden about you on the new batteries. She said "a surveyor, that\'s so useful." She sounded so happy.'),
      L('priya', '...Tell her the dam is two hours. Tell her I said hello.'),
    ],
    stars: { time: 1260, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },

  // ------------------------------------------------------------------------------------------
  // The Blackwater dam in a storm: the canyon road, the spillway, the control room, the crest in the
  // wind, the turbine hall (power for the depot, and a regulator for the ferry) and the river village
  // road to the depot gate.
  {
    id: 'm3_2', chapter: 3, index: 2, title: 'Blackwater Dam',
    blurb: 'The bridge is gone and a storm is coming down the valley. The only crossing left is the road over the crest of the Blackwater dam, and the reservoir is already lapping at it.',
    map: 'dam', time: 'day', mode: 'free', level: [7, 8], party: { min: 1, max: 6 },
    requires: ['m3_1'], hub: null, after: 'hideout:depot',
    npcs: [{ id: 'priya', at: 'start', mode: 'follow' }],
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER CANYON. NOON, AND DARK AS EVENING.'),
      L('priya', 'The storm filled the reservoir overnight. It\'s over the crest road. We open the spillway, the water drops, the convoy drives across.'),
      L('deke', 'You want to open a dam.'),
      L('priya', 'A little. A controlled amount. Dams are made to be opened. That\'s the whole idea of a dam.'),
      L('mara', 'And the far side?'),
      L('priya', 'The river village, and past it a rail depot: six buildings, a machine shop, one roof that doesn\'t leak. I\'ve slept there. It has doors.'),
      L('ozzy', 'The Warden says the storm will be over the lake by tonight. She said to tell you "go around the lightning." I said I\'d pass it on.'),
      L('priya', 'We can\'t go around the lightning. We\'re going over a dam in it.'),
      L('deke', 'I\'ll hold the convoy at the tunnel mouth. When the crest is dry, radio me. Don\'t radio me before. I\'ll just drive into a lake.'),
      L('mara', 'Priya goes with you. Bring her back. She has the map.'),
    ],
    steps: [
      // ---- CANYON ROAD ------------------------------------------------------------------
      kill('tunnel', 'any', 12, 'Clear the road tunnel (0/12)', {
        pressure: PS('road', 4, 0.6),
        onStart: [
          A.title('BLACKWATER DAM', 'Canyon road. A storm coming in'),
          A.music('tension'),
          say('priya', 'The tunnel lights died with the grid. Everything in there has been waiting in the dark for a month.'),
        ],
      }),
      {
        id: 'padlock', type: 'survive', seconds: 40, text: 'Hold the road while Priya picks the spillway gate padlock', pressure: PS('road', 4, 1.0),
        onStart: [A.horde('road_truck', 8), say('priya', 'I do this with a bobby pin and bad language. Mostly bad language. Keep them off my back.')],
        onDone: [A.gate('spill_gate'), say('priya', 'Open. Don\'t tell the county. I used to work for the county.')],
      },

      // ---- SPILLWAY -------------------------------------------------------------------------
      arrive('spill', 'spillway', 'Through the gate down to the spillway', ['THE SPILLWAY', 'Blackwater Dam. Storm'], {
        lines: [say('priya', 'The valve wheel is on the platform. It takes two people and a lot of feelings.')],
      }),
      {
        id: 'valve', type: 'activate', at: ['spill_valve'], hold: 16, text: 'Open the spillway valve (hold E, together is faster)', kind: 'valve', pressure: PS('spillway', 4, 1.0, ['spitter']),
        onStart: [A.music('battle'), A.horde('spill_bridge', 10)],
        onDone: [A.shake(0.8), say('priya', 'Listen to that. That\'s eighty thousand tons of storm going somewhere else.')],
      },
      {
        id: 'spillbridge', type: 'activate', at: ['spill_bridge'], hold: 6, text: 'Force the control room door across the spill bridge (hold E)', pressure: PS('spillway', 4, 0.8),
        onDone: [A.gate('control_door'), say('priya', 'Control room. The crest gates are run from in here, and so is everything else.')],
      },

      // ---- CONTROL ROOM -----------------------------------------------------------------
      arrive('control', 'control', 'Into the control room', ['THE CONTROL ROOM', 'Blackwater Dam, 1962'], {
        lines: [say('priya', 'Dials, levers and a coffee cup somebody left on Day 20. The crest barriers are on the big panel.')],
      }),
      {
        id: 'panel', type: 'activate', at: ['control_panel'], hold: 10, text: 'Lower the crest road barriers from the panel (hold E)', pressure: PS('control', 4, 0.7),
        onStart: [A.dark('control'), A.light('control', 3), say('priya', 'The lights flicker when the turbines idle. It isn\'t haunted. I checked. Twice.')],
      },
      {
        id: 'storm_call', type: 'dialogue', pressure: PS('control', 4, 0.5), lines: [
          radio('ozzy', 'Crew, crew, I\'ve got her on the dam\'s radio. It\'s scratchy. She wants to say something.'),
          radio('warden', 'Hi. Um. Ozzy says you\'re on a dam. In the storm. That\'s so brave it\'s actually a bit stupid.'),
          say('priya', 'That\'s the Warden? She sounds about fifteen.'),
          radio('warden', 'I am fifteen. Is that Priya? Hi, Priya. I\'ve got a map of the lake for you. I drew it. It\'s not to scale.'),
          say('priya', '...Nobody has ever drawn me a map.'),
          radio('warden', 'Please get off the dam soon. Warden out.'),
        ],
        onDone: [A.gate('crest_gate'), say('priya', 'The crest is open. Now the part where we walk across a dam in the wind.')],
      },

      // ---- DAM CREST ----------------------------------------------------------------------
      arrive('crest', 'crest', 'Out onto the crest', ['THE CREST', 'Six hundred feet of road. Wind'], {
        pressure: PS('crest', 4, 0.5),
        onStart: [A.shake(0.3)],
        music: 'battle',
        lines: [say('priya', 'Stay off the railing and keep low. The wind up here has opinions about people.')],
      }),
      kill('fatones', 'bloater', 3, 'Bloaters on the crest road: pop them from range (0/3)', {
        at: 'crest_mid', pressure: PS('crest', 4, 0.8, ['spitter']),
        onStart: [say('priya', 'Big ones in the middle of the road. If one pops against the railing, the railing goes with it.')],
      }),
      {
        id: 'crane', type: 'activate', at: ['crest_crane'], hold: 12, text: 'Swing the gantry crane clear of the turbine hall door (hold E)', pressure: PS('crest', 4, 1.2),
        onStart: [A.shake(0.4), A.hordeIn('crest', 10)],
        onDone: [A.gate('turbine_door'), say('priya', 'Turbine hall. Downstairs, out of the wind. Thank God. Thank concrete.')],
      },

      // ---- TURBINE HALL -----------------------------------------------------------------
      arrive('turbines', 'turbines', 'Down into the turbine hall', ['THE TURBINE HALL', 'Four generators. One will do'], {
        music: 'tension',
        lines: [say('priya', 'Turbine two feeds the line to the depot. If we restart it, the depot has lights tonight.')],
      }),
      {
        id: 'fuses', type: 'collect', item: 'fuse', count: 3, at: ['turbine_floor', 'turbine_breaker'], text: 'Find three good fuses for the breaker (0/3)',
        pressure: PS('turbines', 4, 0.8),
      },
      {
        id: 'regulator', type: 'collect', item: 'part', count: 1, at: ['turbine_floor'], text: 'Take the spare voltage regulator from the stores: it\'s on the Warden\'s list',
        pressure: PS('turbines', 4, 0.7), flags: { ferry_regulator: true },
        onStart: [radio('deke', 'A turbine governor regulator. Spare, in a box, in the stores. That\'s one line of that kid\'s list. Bring it.')],
      },
      {
        id: 'restart', type: 'defend', target: 'turbine_breaker', seconds: 75, text: 'Hold the breaker while turbine two spins up', pressure: PS('turbines', 4, 1.2, ['spitter']),
        onStart: [A.dark('turbines'), A.music('battle'), say('priya', 'Breaker in. It takes a minute to come up to speed. It\'s going to be the loudest minute of your life.')],
        onDone: [A.light('turbines'), A.shake(0.5), A.gate('river_gate', 2), say('priya', 'Power on the line! There. Across the river. Those are the depot\'s lights.')],
      },

      // ---- RIVERSIDE ----------------------------------------------------------------------
      arrive('river', 'riverside', 'Down the river village road', ['THE RIVER ROAD', 'Blackwater village. Evening'], {
        lines: [radio('deke', 'Crest is dry! We\'re rolling across! Clear me a road through that village!')],
      }),
      {
        id: 'depotgate', type: 'defend', target: 'depot_gate', seconds: 70, text: 'Open the depot gate and hold it for the convoy', pressure: PS('riverside', 4, 1.3, ['bloater']),
        onStart: [A.horde('river_boat', 10), A.music('battle')],
        onDone: [A.boom('river_boat', 220, 400), A.shake(0.4), radio('deke', 'Through! All of us! Every truck and every kid!')],
      },
      {
        id: 'inside', type: 'reach', at: 'depot_gate', hold: 4, who: 'all', text: 'Into Blackwater Depot', pressure: false,
        onDone: [A.music('calm'), say('priya', 'Blackwater Depot. It isn\'t a hotel. But it has doors.')],
      },
    ],
    bonus: [
      noteStep('n28', 'control_radio', 'Read the dam keeper\'s last log (optional)', 'panel'),
      noteStep('n29', 'river_boat', 'Search the boat on the village slip (optional)', 'depotgate'),
      {
        id: 'tunnellights', type: 'activate', at: ['road_tunnel'], hold: 6, text: 'Switch on the tunnel\'s emergency lights for the convoy (optional)',
        since: 'tunnel', flags: { tunnel_lights: true }, todo: 'stepFlags',
        onDone: [radio('deke', 'Tunnel lights! Now I can see what I\'m running over. I preferred not knowing.')],
      },
    ],
    rewards: {
      xp: 580, scrap: 130, weapon: 'chainsaw', upgradePoints: 1, flags: { dam_crossed: true, depot_power: true },
    },
    debrief: [
      L('priya', 'We opened a dam in a storm and walked across it. I\'m writing that down. Nobody will believe it, but it\'ll be written down.'),
      L('deke', 'The maintenance crew left a chainsaw in the turbine hall. Clears branches, clears spillways. Clears other things.'),
      L('deke', 'And a turbine governor regulator, still in its box. The kid\'s list said a regulator. That\'s a regulator.'),
      L('mara', 'One line of her list. We\'re shopping for a boat.'),
      L('priya', 'You\'re shopping. I\'m drawing. There\'s a difference.'),
      L('ozzy', 'The depot has LIGHTS. Our lights. We made them. Look at them!'),
    ],
    stars: { time: 1200, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },
];
