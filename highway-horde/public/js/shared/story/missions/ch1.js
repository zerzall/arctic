// CHAPTER 1 — DEAD HIGHWAY. No hideout yet: the night at the bus (highway) chains straight into the
// walk west at dawn (the Mill Road level), which ends at the Roadhouse gate.
// Zombies: walkers only at the bus; runners and the first crawlers on Mill Road (virtual wave 1-3).

import { radio, say, L, P, PS, A, arrive, kill, noteStep } from './lib.js';

export const CH1 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm1_1', chapter: 1, index: 1, title: 'Pileup',
    blurb: 'A school bus, a dead engine and a very long night. Stand between the dead and fourteen kids until sunrise.',
    map: 'highway', time: 'night', mode: 'defend', level: [1, 2], party: { min: 1, max: 6 },
    requires: [], hub: null, after: 'm1_2',
    briefing: [
      L('narrator', 'DAY {day}. HIGHWAY 9, FORTY MILES FROM ANYWHERE. DUSK.'),
      L('mara', 'You. With the gun. Are you here to help or to loot?'),
      L('mara', 'Never mind. Either way you\'re standing next to my bus, and that makes you my problem.'),
      L('june', 'Miss Mara! The radio man is doing his speech again!'),
      L('warden', 'Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you can carry.'),
      L('mara', 'Every night at dusk. Same words, same pause after "month." I\'ve heard it seven times and I still want it to be true.'),
      L('mara', 'Fourteen kids, one dead engine, two hundred yards of open road. Night is coming, and they walk toward any noise.'),
      L('mara', 'They\'re slow. That\'s the only kindness in this whole business. Back up while you shoot, keep your ammo honest, and never fight with your back to a car you haven\'t checked.'),
      L('june', 'Can I help? I\'m very good at shouting.'),
      L('mara', 'You\'re going to help by staying under the seats and shouting nothing. Deal?'),
      L('june', '...Deal.'),
      L('mara', 'Stand between them and that bus until sunrise. I\'m Mara. I fix people. Let\'s go and make a wall.'),
    ],
    steps: [
      kill('thin', 'walker', 8, 'Thin the herd around the bus', {
        pressure: P(1, 0.3),
        onStart: [
          radio('mara', 'Here they come. Slow ones first. Walk backwards and keep shooting, they can\'t catch you.'),
          radio('june', 'Miss Mara, one of them has no shoes. Is that allowed?'),
        ],
        onDone: [radio('mara', 'Good. Now do that a few hundred more times.')],
      }),
      {
        id: 'wave1', type: 'defend', target: 'bus', waves: 1, text: 'Defend the bus', pressure: P(1, 0.7),
        onStart: [radio('mara', 'That\'s the real crowd. The bus door is at your back, and nothing gets past you to it.')],
        onDone: [radio('mara', 'Clear. Reload, breathe, and please don\'t count your bullets out loud. June can hear you.')],
      },
      {
        id: 'horn', type: 'activate', at: ['bus'], hold: 8, text: 'Cut the horn wire under the bus dash (hold E)', pressure: P(1, 1.1),
        onStart: [
          radio('june', 'The horn is stuck! Tobias sat on it! I didn\'t do it, I swear!'),
          radio('mara', 'Everything within a mile just heard that. Get under the dash and cut the wire, go!'),
        ],
        onDone: [
          radio('mara', 'Silence. Thank you. Tobias is grounded.'),
          radio('june', 'We live on a bus, Miss Mara. Where would he go?'),
        ],
      },
      {
        id: 'wave2', type: 'defend', target: 'bus', waves: 1, text: 'Defend the bus: second herd', pressure: P(1, 1.0),
        onStart: [radio('mara', 'That truck alarm up the road is a dinner bell. Here comes the second herd, and it\'s hungrier.')],
        onDone: [radio('mara', 'Nobody down? Nobody down. I\'ll take that. I\'ll take that all day.')],
      },
      {
        id: 'dawn', type: 'survive', seconds: 45, text: 'Hold until first light', pressure: P(1, 0.35),
        onStart: [radio('mara', 'The sky is going grey. Forty-five seconds. You\'ve done the hard part.')],
        onDone: [radio('mara', 'Sun is up.'), radio('june', 'Miss Mara, the sky is orange. I made a wish.')],
      },
    ],
    bonus: [noteStep('n01', 'crossroadsE', 'Find the driver\'s clipboard (optional)', 'wave1')],
    rewards: {
      xp: 200, scrap: 40, upgradePoints: 0, flags: { met_mara: true, bus_saved: true }, unlockNpc: 'mara',
    },
    debrief: [
      L('mara', 'Everybody with a pulse, raise a hand.'),
      L('june', 'Mister, your gun is smoking.'),
      L('mara', 'That\'s a compliment, June. Sort of.'),
      L('mara', 'Fourteen children were alive at midnight and they\'re alive now. I\'m not thanking you properly, because if I start I\'ll cry, and I can\'t spare the water.'),
      L('june', 'How many people did you save before, Miss Mara?'),
      L('mara', 'I stopped counting on day nine, sweetheart. Go and eat something.'),
      L('mara', 'The bus is finished. There\'s a gas station two miles west with a tow truck painted on the sign. We walk at first light.'),
      L('mara', 'Fourteen. That\'s the only number I\'m keeping.'),
    ],
    stars: { time: 660, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  // The walk west: the jam, Mill Road Gas (Deke and his tow truck), Shady Acres (Ozzy and his
  // antenna), the Haskell corn and the Roadhouse gate. Mara keeps the kids on the bus and talks
  // the crew through it on a walkie-talkie; Deke fetches the bus with the truck at the end.
  {
    id: 'm1_2', chapter: 1, index: 2, title: 'Mill Road',
    blurb: 'Dawn after the pileup. Three miles of dead traffic, a gas station with a tow truck and a grumpy owner, a trailer park with an antenna, and a motel at the end of the corn.',
    map: 'millroad', time: 'day', mode: 'free', level: [2, 3], party: { min: 1, max: 6 },
    requires: ['m1_1'], hub: null, after: 'hideout:roadhouse',
    npcs: [{ id: 'deke', at: 'gas_office' }, { id: 'ozzy', at: 'trailer_radio' }],
    briefing: [
      L('narrator', 'DAY {day}. HIGHWAY 9 WESTBOUND, MILE 73. SUNRISE.'),
      L('mara', 'Morning. The bus is finished, and fourteen kids can\'t walk two hundred miles. They can ride two, if somebody tows them.'),
      L('mara', 'Mill Road Gas is two miles west. There\'s a tow truck painted on the sign. A sign is a kind of promise.'),
      L('june', 'Miss Mara, the cars go all the way to the sky.'),
      L('mara', 'Three miles of dead traffic, June. They go through it, not around. The kids stay on the bus with me until you call.'),
      L('mara', 'Daylight is on our side today. You can see them coming. Check every car before you pass it, and every car after.'),
      L('mara', 'Find the truck. Find whoever owns it. Be polite if they\'re alive and quick if they\'re not.'),
      L('june', 'Can I say the thing? Be careful, and come back, and bring snacks.'),
      L('mara', 'She\'s been practising that all night. Radios on. Go.'),
    ],
    steps: [
      // ---- THE JAM ---------------------------------------------------------------------
      kill('jam', 'walker', 10, 'Push into the jam: clear the first cars (0/10)', {
        pressure: PS('jam', 1, 0.5),
        onStart: [
          A.title('MILL ROAD', 'Highway 9 westbound. Sunrise'),
          A.music('tension'),
          radio('mara', 'Radio check. The cars on the shoulder are the ones that move. Mind the shoulder.'),
        ],
        onDone: [radio('mara', 'I can hear you from the bus. That\'s good shooting and bad news: so can everything else.')],
      }),
      {
        id: 'kit', type: 'collect', item: 'medkit', count: 2, at: ['jam_ambulance'], text: 'Search the ambulance for a trauma kit (0/2)', pressure: PS('jam', 1, 0.4),
        onStart: [
          A.horde('jam_semi', 6, 'walker'),
          radio('mara', 'An ambulance! If there\'s a trauma bag in it, it\'s mine. Tobias has a cut I don\'t like.'),
          radio('june', 'The big truck\'s doors just opened by themselves. That\'s never good, right?'),
        ],
        onDone: [radio('mara', 'Gauze. Real gauze. I could kiss that ambulance.')],
      },
      {
        id: 'shutter', type: 'dialogue', pressure: false, lines: [
          say('deke', 'Hey! You with the rifles! Read the sign on the shutter before you knock.'),
          radio('mara', 'What does the sign say?'),
          say('deke', 'It says GO AWAY in a very friendly font.'),
          radio('mara', 'We have fourteen kids and a dead bus, and you have a tow truck on your sign.'),
          say('deke', '...Then stop standing in the open. I\'m cranking the shutter. It\'s slow, it\'s loud and it\'s the only one I\'ve got.'),
        ],
      },
      {
        id: 'crank', type: 'survive', seconds: 40, text: 'Hold the jam while the old man cranks the shutter up', pressure: PS('jam', 1, 1.0),
        onStart: [A.music('battle'), A.hordeIn('jam', 8, 'walker'), say('deke', 'It squeals. Everything within a mile is going to hear it squeal.')],
        onDone: [A.gate('gas_shutter'), A.music('calm'), say('deke', 'In! In, in, in. Wipe your feet. Don\'t touch the jerky.')],
      },

      // ---- MILL ROAD GAS ----------------------------------------------------------------
      arrive('forecourt', 'gasstation', 'Duck under the shutter into Mill Road Gas', ['MILL ROAD GAS', 'Diesel. Tow. Live bait.'], {
        lines: [say('deke', 'Welcome to Mill Road Gas. The bait is live. The coffee is not. Office. Now.')],
      }),
      {
        id: 'deke', type: 'dialogue', npc: 'deke', talk: true, text: 'Talk to the old man in the office', pressure: false,
        lines: [
          L('deke', 'Deke Harlan. That isn\'t a joke. The county is named after my family. Long story, bad card game.'),
          L('deke', 'Tow truck\'s in bay two. She wants a battery and diesel, and I have neither, plus a bad hip.'),
          L('deke', 'Batteries are in the garage. Diesel is in the tank under the forecourt, and the hand pump is out there with the dead.'),
          L('deke', 'Bring me both and I\'ll hook your bus and tow your kids anywhere they point. Deal?'),
        ],
        onDone: [radio('mara', 'Deal. Tell him deal. Tell him I said please, and then tell him deal.')],
      },
      {
        id: 'battery', type: 'collect', item: 'battery', count: 1, at: ['gas_garage'], text: 'Pull a truck battery out of the garage', pressure: PS('gasstation', 1, 0.5),
        onStart: [A.horde('gas_garage', 5, 'walker'), say('deke', 'Big black box, two posts. Red is bad, black is worse. Carry it level.')],
        onDone: [say('deke', 'Heavy, isn\'t it? That\'s how you know it\'s honest.')],
      },
      {
        id: 'diesel', type: 'collect', item: 'fuel', count: 3, at: ['gas_tanks', 'gas_forecourt'], text: 'Hand-pump diesel from the underground tank (0/3)', pressure: PS('gasstation', 2, 0.6),
        onStart: [say('deke', 'Every stroke of that pump rings like a church bell. Sorry. I meant to oil it in April.')],
        onDone: [say('deke', 'Three cans. She\'ll drink every drop and ask for dessert.')],
      },
      {
        id: 'truck', type: 'defend', target: 'gas_tow', seconds: 60, text: 'Hold the forecourt while Deke gets the tow truck running', pressure: PS('gasstation', 2, 0.9),
        onStart: [
          A.music('battle'),
          say('deke', 'Twenty seconds and she catches! Probably forty. Could be a minute. Don\'t let them near my truck.'),
          radio('mara', 'One of them is RUNNING. Why is one of them running?'),
          say('deke', 'Don\'t panic. Panic uses fuel.'),
        ],
        onDone: [say('deke', 'That\'s the sound of a 1997 Ford refusing to die. Listen to that. That\'s spite.')],
      },
      {
        id: 'vent', type: 'activate', at: ['gas_tanks'], hold: 4, text: 'Drop a road flare down the old tank vent, then run (hold E)', pressure: PS('gasstation', 2, 1.1),
        onStart: [say('deke', 'The whole crowd\'s on my forecourt. Good. That tank has been breathing fumes since 1994. Give it a flare.')],
        onDone: [
          A.boom('gas_tanks', 280, 600, 2),
          A.shake(0.8, 2),
          say('deke', 'I have wanted to do that since the day I bought this place.', 2600),
        ],
      },
      {
        id: 'goodbye', type: 'dialogue', pressure: PS('gasstation', 1, 0.3), lines: [
          say('deke', 'Right. I\'m going back for your bus. Shady Acres is out back, and the road to the motel runs through it.'),
          say('deke', 'There\'s a kid in there with an antenna on his trailer. Talks all night. Tell him I said hello and to shut up.'),
          say('deke', 'Stand back from the gate. I don\'t have the key, but I do have a truck.'),
        ],
        onDone: [A.gate('trailer_gate', 1), A.shake(0.5, 1), radio('deke', 'That was the key. Go on. I\'ll meet you at the motel with fourteen kids and a bus.')],
      },

      // ---- SHADY ACRES --------------------------------------------------------------------
      arrive('acres', 'trailers', 'Through the gate into Shady Acres', ['SHADY ACRES', 'Mobile home park. Pop. 60, once'], {
        extra: { remove: ['deke'] },
        lines: [
          radio('ozzy', 'Hello? Hello! Is that a person? Please say a person. I get a lot of recordings.'),
          radio('mara', 'We\'re people. Who\'s this?'),
          radio('ozzy', 'Ozzy! The trailer with the antenna. The big antenna. Please hurry, they found my steps.'),
        ],
      }),
      {
        id: 'antenna', type: 'reach', at: 'trailer_radio', text: 'Get to the trailer with the big antenna', pressure: PS('trailers', 2, 0.6),
        onStart: [radio('ozzy', 'Lot 9. You can\'t miss it. It looks like a porcupine made of coat hangers.')],
      },
      {
        id: 'ozzy', type: 'dialogue', npc: 'ozzy', talk: true, text: 'Talk to the kid with the headset', pressure: false,
        lines: [
          L('ozzy', 'You\'re real. You\'re actually real. Hi! Ozzy. Oswald, technically, but nobody\'s called me that since the school secretary.'),
          L('ozzy', 'I\'ve logged the Haven message for nine nights. Same words, same pause, and on night six it coughed. Nobody records a cough.'),
          L('ozzy', 'I\'ve been trying to answer her with this rig. It isn\'t strong enough. Nothing I have is strong enough.'),
          L('ozzy', 'Can I come with you? I can bring the radio. I can\'t bring the antenna. I\'ll say goodbye to the antenna.'),
        ],
      },
      {
        id: 'pack', type: 'defend', target: 'trailer_radio', seconds: 70, text: 'Hold Ozzy\'s trailer while he packs the radio', pressure: PS('trailers', 2, 0.8),
        onStart: [
          A.music('battle'),
          A.horde('trailer_pool', 6, 'crawler'),
          radio('ozzy', 'The pool! The empty pool! They\'ve been living in the deep end! They CRAWL!'),
        ],
        onDone: [say('ozzy', 'Packed! Everything important fits in one bag if you sit on it.')],
      },
      {
        id: 'fence', type: 'activate', at: ['trailer_exit'], hold: 8, text: 'Cut through the farm fence at the back of the park (hold E)', pressure: PS('trailers', 2, 0.7),
        follow: ['ozzy'],
        onStart: [say('ozzy', 'The motel is on the other side of the Haskell corn. I can see its sign from my roof. NO VAC. Well. NO VAC-something.')],
        onDone: [A.gate('corn_fence'), A.music('tension'), say('ozzy', 'Bye, antenna. You were a good antenna.')],
      },

      // ---- HASKELL CORNFIELD --------------------------------------------------------------
      arrive('corn', 'corn', 'Push into the Haskell cornfield', ['HASKELL CORNFIELD', 'Corn taller than a mechanic'], {
        pressure: PS('corn', 2, 0.4),
        lines: [radio('mara', 'Tow truck just pulled up at the bus. He\'s hooking us. He says his name is Deke and I should stop saying please.')],
      }),
      kill('runners', 'runner', 4, 'Something is running through the corn (0/4)', {
        at: 'corn_scarecrow', pressure: PS('corn', 2, 0.6, ['runner']),
        onStart: [say('ozzy', 'Do you hear that? The corn is moving FAST. Corn shouldn\'t move fast.')],
        onDone: [say('ozzy', 'Runners. Some of them run. I had a theory about it. The theory was "please no."')],
      }),
      {
        id: 'silo', type: 'activate', at: ['corn_silo'], hold: 6, text: 'Climb the silo and wave a flare at the motel (hold E)', pressure: PS('corn', 2, 0.6),
        onStart: [say('ozzy', 'Somebody\'s at the motel! There\'s smoke from the kitchen chimney! Somebody is COOKING.')],
        onDone: [
          radio('roz', 'Whoever\'s waving that flare off Haskell\'s silo: you look ridiculous. You have kids with you? Then you have a room.'),
          radio('roz', 'Hold the corn. I\'m finding the gate key. It\'s on a ring with forty other keys.'),
        ],
      },
      {
        id: 'hold_corn', type: 'survive', seconds: 45, text: 'Hold the corn until the motel gate opens', pressure: PS('corn', 3, 1.0),
        onStart: [A.music('battle'), A.hordeIn('corn', 10)],
        onDone: [A.gate('motel_gate'), radio('roz', 'Gate\'s open! Move your feet, I\'m not heating the soup twice!')],
      },

      // ---- THE ROADHOUSE GATE -----------------------------------------------------------
      arrive('gate', 'motel', 'Through the gate onto the Roadhouse lot', ['THE ROADHOUSE', 'Motel. Kitchen. No vacancy'], {
        extra: { npcs: [{ id: 'roz', at: 'motel_sign' }] },
        lines: [say('roz', 'Roz Pruitt. I cook. Put your guns where the kids can\'t reach and your boots where I can\'t smell them.')],
      }),
      {
        id: 'bus', type: 'defend', target: 'motel_gate', seconds: 75, text: 'Hold the gate until Deke tows the bus in', pressure: PS('corn', 3, 0.9, ['runner']),
        onStart: [
          A.music('battle'),
          radio('deke', 'One tow truck, one bus, fourteen kids and a lot of noise coming up the farm road. Keep that gate clear!'),
          radio('june', 'We\'re going SO fast! Mister Deke says this is only second gear!'),
        ],
        onDone: [
          A.shut('motel_gate', 1),
          A.shake(0.4, 1),
          A.music('calm', 2),
          say('roz', '...And shut. Welcome to the Roadhouse.'),
        ],
      },
      {
        id: 'inside', type: 'reach', at: 'motel_lot', hold: 4, who: 'all', text: 'Everybody onto the motel lot', pressure: false,
        npcs: [{ id: 'mara', at: 'motel_lot' }, { id: 'deke', at: 'motel_lot' }],
        onDone: [say('june', 'Is it a hotel? Does it have a pool? Is the pool full of the crawly ones?'), say('roz', 'No pool, sweetheart. Just soup.')],
      },
    ],
    bonus: [
      noteStep('n02', 'gas_office', 'Read the sign taped inside the shutter (optional)', 'deke'),
      noteStep('n21', 'trailer_radio', 'Read Ozzy\'s radio log (optional)', 'pack'),
      {
        id: 'cb', type: 'collect', item: 'part', count: 1, at: ['jam_semi'], text: 'Pull the CB radio out of the semi\'s cab (optional)',
        since: 'kit', flags: { semi_cb: true }, todo: 'stepFlags',
        onDone: [radio('mara', 'A CB radio? Whoever we meet with an antenna is going to love you.')],
      },
    ],
    rewards: {
      xp: 360, scrap: 70, weapon: 'shotgun', upgradePoints: 1,
      flags: { met_deke: true, met_ozzy: true, tow_truck_running: true, road_open: true }, unlockNpc: 'deke',
    },
    debrief: [
      L('deke', 'Nobody has given me a job in thirty days. I forgot how much I missed being yelled at.'),
      L('mara', 'You\'re in our debt, Mr. Harlan.'),
      L('deke', 'I\'m in the debt of a very large bank, ma\'am. It has never once come to collect.'),
      L('deke', 'Here. Pump shotgun, from behind the register. I nailed it to the wall so nobody would steal it. Then I un-nailed it, because I\'m not an idiot.'),
      L('ozzy', 'The Haven voice is live. I have logs. Nine nights. I will show anyone the logs. I will show them twice.'),
      L('mara', 'Ozzy, it\'s a loop.'),
      L('ozzy', 'Loops don\'t clear their throats.'),
      L('june', 'Mister Deke, your truck smells like a birthday candle.'),
      L('deke', 'That\'s the clutch, kid. Don\'t tell her.'),
    ],
    stars: { time: 1080, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },
];
