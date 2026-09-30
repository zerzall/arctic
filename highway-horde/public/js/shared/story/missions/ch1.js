// CHAPTER 1 — DEAD HIGHWAY (highway, night). No hideout yet: the crew moves along the road and
// the three missions chain straight into each other; chapter 1 ends at the Roadhouse.
// Zombies: walkers only in 1.1, the first runners at the end of 1.2, crawlers in 1.3.

import { radio, say, L, P, kill, noteStep } from './lib.js';

export const CH1 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm1_1', chapter: 1, index: 1, title: 'Pileup',
    blurb: 'A school bus, a dead engine and a very long night. Stand between the dead and fourteen kids until sunrise.',
    map: 'highway', time: 'night', mode: 'defend', level: [1, 2], party: { min: 1, max: 6 },
    requires: [], hub: null, after: 'm1_2',
    briefing: [
      L('narrator', 'DAY 41. HIGHWAY 9, FORTY MILES FROM ANYWHERE. DUSK.'),
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
      L('mara', 'The bus is finished. The nearest wheels are a tow truck at Mill Road Gas, two miles west, if anyone is still there. It\'ll take us all day to sneak that far.'),
      L('mara', 'Fourteen. That\'s the only number I\'m keeping.'),
    ],
    stars: { time: 660, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm1_2', chapter: 1, index: 2, title: 'Fuel Run',
    blurb: 'The bus will never drive again, but a tow truck sits two miles west with a locked door and an empty tank. Six red cans is all it asks.',
    map: 'highway', time: 'night', mode: 'free', level: [2, 3], party: { min: 1, max: 6 },
    requires: ['m1_1'], hub: null, after: 'm1_3',
    briefing: [
      L('narrator', 'DAY 42. MILL ROAD GAS, TWO MILES WEST. DUSK.'),
      L('mara', 'You made it to the station. The sign says DIESEL. The pumps say otherwise.'),
      L('deke', 'Read the other sign. The one on the door. I\'m not opening it.'),
      L('mara', 'That\'s a man. A live one. Sir, we have kids on a bus and we need a truck.'),
      L('deke', 'I have a tow truck, no fuel and a bad hip. You have kids and a bus. I can do arithmetic.'),
      L('deke', 'Six cans. Red ones. Any car on that road with a tank and no owner. I\'ll open up when I hear the sixth can hit the concrete.'),
      L('mara', 'He\'s charming. Bring back six cans, and we\'ll find out what he\'s like when he isn\'t being charming.'),
      L('deke', 'I heard that.'),
    ],
    steps: [
      {
        id: 'cans1', type: 'collect', item: 'fuel', count: 3, at: ['crossroadsW', 'westEnd'], text: 'Siphon fuel from the wrecks (0/3)', pressure: P(1, 0.4),
        onStart: [radio('deke', 'Red cans. Trunks, back seats, sometimes the front seat. Look for the ones that aren\'t moving.')],
        onDone: [radio('deke', 'Is that an alarm? That\'s an alarm. You set off an alarm.')],
      },
      {
        id: 'alarm', type: 'activate', at: ['crossroadsW'], hold: 5, text: 'Silence the semi\'s alarm (hold E)', pressure: P(1, 1.2),
        onStart: [radio('mara', 'That\'s a truck alarm. That\'s a very loud truck alarm, and they can hear it in the next county.')],
        onDone: [radio('deke', 'Thank you. My ears will send a card.')],
      },
      {
        id: 'cans2', type: 'collect', item: 'fuel', count: 3, at: ['gasStation', 'westEnd'], text: 'Find the last three cans (0/3)', pressure: P(1, 0.6),
        onStart: [radio('deke', 'Three more. Sixth can hits the concrete, I open the door. That\'s the deal. Deals are the last thing I have.')],
      },
      {
        id: 'door', type: 'reach', at: 'gasStation', hold: 3, text: 'Bring the cans to the station door', pressure: P(1, 0.4),
        onDone: [say('deke', 'Six. Huh. I didn\'t think you\'d manage two.')],
      },
      {
        id: 'meet', type: 'dialogue', lines: [
          L('deke', 'Deke Harlan. That isn\'t a joke. The county is named after my family. Long story, bad card game.'),
          L('mara', 'Open the door, Mr. Harlan.'),
          L('deke', 'Deke. Mister Harlan is dead, and he was a lousy mechanic.'),
          L('deke', 'Truck is in bay two. Prime the line and hold the door, I\'ll handle the pump. Don\'t touch anything that\'s clicking.'),
        ],
      },
      {
        id: 'prime', type: 'activate', at: ['gasStation'], hold: 14, text: 'Prime the tow truck\'s fuel line (hold E)', pressure: P(1, 0.7),
        onStart: [say('deke', 'Twenty seconds! Twenty seconds and she catches!')],
        onDone: [say('deke', 'That\'s the sound of a 1997 Ford refusing to die. Listen to that. That\'s spite.')],
      },
      {
        id: 'tow', type: 'escort', npc: 'deke', route: ['gasStation', 'crossroadsW', 'bus'], text: 'Cover Deke and the tow truck back to the bus', pressure: P(2, 0.5, ['runner']),
        onStart: [
          say('deke', 'Nice and slow. She only has two speeds and one of them is off.'),
          radio('mara', 'Deke, one of them is running. Why is one of them RUNNING?'),
          say('deke', 'Don\'t panic. Panic uses fuel.'),
        ],
        onDone: [radio('mara', 'I can see the truck! I can see the truck, June, sit down!')],
      },
      {
        id: 'hook', type: 'survive', seconds: 40, text: 'Hold the line while Deke hooks the bus', pressure: P(1, 0.5),
        onStart: [say('deke', 'Hook is on. Give me forty seconds and a small miracle.')],
        onDone: [say('deke', 'Chain is set. Small miracle delivered.')],
      },
    ],
    bonus: [
      noteStep('n02', 'gasStation', 'Read the sign on the pump (optional)', 'cans1'),
      noteStep('n03', 'westEnd', 'Search the roadblock for orders (optional)', 'cans1'),
    ],
    rewards: {
      xp: 240, scrap: 60, weapon: 'shotgun', upgradePoints: 0, flags: { met_deke: true, tow_truck_running: true }, unlockNpc: 'deke',
    },
    debrief: [
      L('deke', 'Nobody has given me a job in thirty days. I forgot how much I missed being yelled at.'),
      L('mara', 'You\'re in our debt, Mr. Harlan.'),
      L('deke', 'I\'m in the debt of a very large bank, ma\'am. It has never once come to collect.'),
      L('deke', 'Take this. Pump shotgun, from behind the register. I nailed it to the wall so nobody would steal it. Then I un-nailed it, because I\'m not an idiot.'),
      L('mara', 'You pat that pocket a lot.'),
      L('deke', 'It\'s a habit. It\'s nothing. Where\'s this bus going?'),
      L('mara', 'A lake.'),
      L('deke', 'Everybody has a lake. Fine. Show me the lake.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm1_3', chapter: 1, index: 3, title: 'Beacon',
    blurb: 'A jackknifed semi blocks the I-44 overpass. A boy in a trailer says he can prove the Haven message is live, if you keep his beacon burning long enough.',
    map: 'highway', time: 'night', mode: 'free', level: [3, 4], party: { min: 1, max: 6 },
    requires: ['m1_2'], hub: null, after: 'hideout:roadhouse',
    briefing: [
      L('narrator', 'DAY 43. THE I-44 OVERPASS. NIGHT.'),
      L('deke', 'Jackknifed semi, three lanes wide. The tow truck can shift it. Slowly. Loudly.'),
      L('mara', 'Loudly is a problem.'),
      L('ozzy', 'Uh. Hello? Is that a person? Please say a person and not a recording. I get a lot of recordings.'),
      L('mara', 'We\'re people. Who\'s this?'),
      L('ozzy', 'Ozzy! Oswald! Ozzy. I\'m on top of the overpass. I live in a trailer. It has an antenna.'),
      L('deke', 'Of course it does.'),
      L('ozzy', 'I\'ve logged the Haven message for nine nights and it\'s LIVE. Somebody is speaking it. If my beacon hits full power, she\'ll hear me and answer.'),
      L('ozzy', 'It needs three car batteries and somebody to keep the dead off it for a few minutes.'),
      L('mara', '"A few minutes."'),
      L('ozzy', '...Ten. Maybe ten.'),
      L('deke', 'Kid, you\'re hired.'),
    ],
    steps: [
      {
        id: 'climb', type: 'reach', at: 'overpass', text: 'Reach the I-44 overpass', pressure: P(1, 0.3),
        onStart: [radio('ozzy', 'The left lane is more of a suggestion than a lane. Hug the right. Please hurry, I\'ve been talking to a sandwich.')],
        onDone: [radio('ozzy', 'You\'re real. You\'re actually real. Okay. Deep breath. Hello!')],
      },
      {
        id: 'batteries', type: 'collect', item: 'battery', count: 3, at: ['overpass', 'crossroadsE', 'crossroadsW'], text: 'Pull car batteries (0/3)', pressure: P(1, 0.4),
        onStart: [radio('deke', 'Under the hood, black box, two terminals. Red is bad, black is worse. Just grab them and go.')],
      },
      {
        id: 'meet', type: 'dialogue', lines: [
          L('ozzy', 'That\'s a lot of gun. Hi! Ozzy. Oswald, technically, but nobody has called me that since the school secretary.'),
          L('ozzy', 'This is the rig. A dipole, a truck battery and, uh, mostly duct tape.'),
          L('deke', 'Duct tape. On a transmitter.'),
          L('ozzy', 'It\'s load-bearing duct tape.'),
          L('ozzy', 'Batteries in, ten minutes. I do the talking, you do the not dying. Everyone gets a job.'),
        ],
      },
      {
        id: 'wire', type: 'activate', at: ['overpass'], hold: 10, text: 'Wire the beacon to the batteries (hold E)', pressure: P(1, 0.5),
        onStart: [say('ozzy', 'Red to red, black to black. If it sparks, that\'s normal. If it screams, that isn\'t.')],
        onDone: [say('ozzy', 'Oh. Oh no. It\'s working. It\'s actually working.')],
      },
      {
        id: 'warden_call', type: 'wait', seconds: 40, parallel: true,
        onDone: [
          radio('warden', '...KD9... I hear you. This is Haven. Say again your call sign. Over.', 3400),
          radio('ozzy', 'KD9-OZZ! Ozzy! Highway 9, the I-44 overpass! You\'re REAL!', 2800),
          radio('warden', 'I\'m real. It\'s loud. Um. How many are you? Over.', 3200),
          radio('mara', 'Twenty-two. Fourteen are children.', 2600),
          radio('warden', 'Copy. Fourteen. Okay. Come to the marina. Come as fast as you can.', 3600),
          radio('ozzy', 'SEE? Live! Nobody records a hiccup!', 2600),
          radio('warden', 'Warden out. ...Over. Sorry. Warden, over and out.', 3400),
        ],
      },
      {
        id: 'hold', type: 'survive', seconds: 90, text: 'Keep the beacon lit: hold the overpass', pressure: P(2, 0.55, ['crawler']),
        onStart: [radio('ozzy', 'CQ, CQ, CQ. Haven, Haven, this is KD9-OZZ on the Highway 9 overpass. Do you copy? Over.')],
      },
      {
        id: 'surge', type: 'survive', seconds: 45, text: 'The beacon is calling every dead thing for miles!', pressure: P(2, 1.5, ['runner']),
        onStart: [
          radio('ozzy', 'So the beacon is very loud. That is, technically, the point.'),
          radio('mara', 'Runners! A whole crowd of them!'),
          radio('deke', 'Kid, you said ten minutes.'),
        ],
        onDone: [radio('mara', 'Nobody tell me it gets worse. I want to believe it doesn\'t.')],
      },
      {
        id: 'winch', type: 'activate', at: ['crossroadsE'], hold: 8, text: 'Winch the jackknifed semi clear (hold E)', pressure: P(2, 0.8),
        onStart: [radio('deke', 'Hook is on the trailer. When it goes, it goes all at once. Stand clear.')],
        onDone: [radio('deke', 'Timber.')],
      },
      {
        id: 'collapse', type: 'survive', seconds: 25, text: 'The pileup gives way: get clear!', pressure: P(3, 1.5, ['crawler']),
        onStart: [radio('mara', 'Whatever was pinned under that trailer just got unpinned.')],
      },
      {
        id: 'motel', type: 'reach', at: 'motel', hold: 6, text: 'Secure the Roadhouse motel', pressure: P(2, 0.4),
        onDone: [radio('deke', 'Well. A motel. The sign says NO VAC and the rest burnt out.'), radio('ozzy', 'I\'m choosing to read that as vacancy.')],
      },
    ],
    bonus: [noteStep('n04', 'overpass', 'Read the trucker\'s log in the cab (optional)', 'batteries')],
    rewards: {
      xp: 300, scrap: 80, weapon: 'lever', upgradePoints: 1, flags: { met_ozzy: true, warden_contact: true, road_open: true }, unlockNpc: 'ozzy',
    },
    debrief: [
      L('mara', 'Twenty-two of us and one motel. It has a roof and a lock. Tonight that\'s a palace.'),
      L('ozzy', 'She answered. You all heard it. I\'m not saying I told you so. I\'m saying it once, slowly, so nobody can accuse me of rushing.'),
      L('mara', 'I heard a very nervous person on a radio, Ozzy.'),
      L('ozzy', 'A very nervous Warden on a radio.'),
      L('deke', 'She said fourteen children and then she said copy. Nobody says copy to a recording.'),
      L('mara', 'Maybe. Maybe there\'s a boat.'),
      L('mara', 'Two hundred miles is a long way to hope.'),
      L('june', 'Two hundred is smaller than a thousand.'),
      L('mara', '...It is, June. It is.'),
    ],
    stars: { time: 840, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
