// CHAPTER 3 — BLACKWATER (bridge). The crew leaves the Roadhouse for good. 3.1 starts at the
// mission board, 3.2 follows on the road; the chapter ends by settling in the Blackwater Depot.
// Zombies: bloaters (3.1) and spitters (3.1/3.2) appear; crawlers live in the mud.

import { radio, say, L, P, kill, noteStep } from './lib.js';

export const CH3 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm3_1', chapter: 3, index: 1, title: 'The Crossing',
    blurb: 'A dead army APC in the middle of the only bridge, a surveyor with one wrench, and the whole county coming from both banks. Repair it while you defend it.',
    map: 'bridge', time: 'day', mode: 'defend', level: [7, 8], party: { min: 1, max: 6 },
    requires: ['m2_2', 'm2_3'], hub: 'roadhouse', after: 'm3_2',
    briefing: [
      L('narrator', 'DAY 48. THE ROADHOUSE. THE LAST MORNING.'),
      L('roz', 'Forty people, three crates of peaches and a cast-iron skillet older than the state. Nobody leaves a Roadhouse hungry.'),
      L('mara', 'Nobody leaves a Roadhouse at all, Roz. That\'s the point of today.'),
      L('roz', 'It\'s my kitchen, hon. I\'m allowed to get sentimental about it.'),
      L('deke', 'Tow truck is topped off. Fuel gets us to the river.'),
      L('dutch', 'I charged you at cost. Which means I lost money. Which means I\'m never doing this again.'),
      L('ozzy', 'The radio rides in the truck now. I call it Mobile Unit One. Deke calls it "the radio in the truck."'),
      L('mara', 'Highway 9 ends at Blackwater. One bridge, one river, nothing to go around.'),
      L('ozzy', 'There\'s a voice on the bridge frequency. Army band. Listen.'),
      L('priya', 'If anyone can hear this: I\'m not army. I\'m a surveyor with a wrench. The APC has been dead in the middle of the span for four days, and I\'ve run out of swearing.'),
      L('deke', 'I like her.'),
      L('mara', 'Then let\'s go and help her before she starts repeating herself.'),
    ],
    steps: [
      {
        id: 'cross', type: 'reach', at: 'bankW', text: 'Cross the west bank to the bridge', pressure: P(3, 0.3),
        onStart: [
          radio('priya', 'Stay off the left lane, it isn\'t there anymore.'),
          radio('priya', 'And the fat ones burst. Shoot them from far away, never next to anything you want to keep.'),
        ],
      },
      {
        id: 'repair1', type: 'activate', at: ['apc'], hold: 12, text: 'Repair the APC: fuel line (hold E)', pressure: P(4, 0.6),
        onStart: [radio('priya', 'Fuel line first. Hold the tool. Don\'t drop the tool. It\'s the only tool.')],
        onDone: [radio('priya', 'One down. Two to go. Don\'t celebrate, I can hear you celebrating.')],
      },
      {
        id: 'wave1', type: 'defend', target: 'apc', waves: 1, text: 'Defend the APC: first wave', pressure: P(4, 0.9),
        onStart: [radio('priya', 'They come from both banks. It\'s a funnel and you\'re the cork. Try to be a good cork.')],
      },
      {
        id: 'repair2', type: 'activate', at: ['apc'], hold: 12, text: 'Repair the APC: track links (hold E)', pressure: P(4, 1.0, ['spitter']),
        onStart: [radio('priya', 'East bank! Those are spitters. Stay out of the puddles and use cover, they only hit what they can see.')],
      },
      {
        id: 'wave2', type: 'defend', target: 'apc', waves: 1, text: 'Defend the APC: second wave', pressure: P(4, 1.0, ['spitter']),
        onStart: [radio('priya', 'Acid pools last four seconds. Count them. I like counting.')],
      },
      {
        id: 'crank', type: 'activate', at: ['apc'], hold: 15, text: 'Crank the engine (hold E)', pressure: P(4, 1.1, ['bloater']),
        onStart: [radio('priya', 'She\'s turning over! No, she isn\'t. She\'s turning over! Hold on, hold on, hold on!')],
        onDone: [radio('priya', 'Ha! Do you hear that? That\'s a real engine noise!')],
      },
      {
        id: 'surge', type: 'survive', seconds: 45, text: 'The engine is calling every dead thing for miles!', pressure: P(4, 1.6, ['runner']),
        onStart: [radio('priya', 'The east rail is going! Get off the edge! Get off the EDGE!')],
        onDone: [radio('deke', 'That guardrail is a memory now. Keep moving.')],
      },
      {
        id: 'board', type: 'reach', at: 'bankE', hold: 4, text: 'Get everyone aboard the APC', pressure: P(4, 0.4),
        onDone: [radio('priya', 'Everyone on. Hold on to something. I haven\'t tested the brakes.')],
      },
    ],
    bonus: [noteStep('n09', 'apc', 'Read the order taped inside the APC (optional)', 'cross')],
    rewards: {
      xp: 460, scrap: 120, weapon: 'dmr', upgradePoints: 1, flags: { met_priya: true, apc_running: true }, unlockNpc: 'priya',
    },
    debrief: [
      L('priya', 'Priya Nair. Surveyor. Formerly of a state that doesn\'t exist anymore.'),
      L('mara', 'How long have you been out here alone?'),
      L('priya', 'Forty-three days. Twelve places. I have them in a book. And before anyone asks, I\'m not staying.'),
      L('deke', 'Nobody asked.'),
      L('priya', 'You had the look. Everywhere I go, I get the look.'),
      L('priya', 'The APC will get us across. On the far bank there\'s a rail depot: six buildings, one roof that doesn\'t leak. Give me a day and I\'ll draw you a map.'),
      L('mara', 'You aren\'t staying, but you\'ll draw us a map.'),
      L('priya', 'It\'s a map. It isn\'t staying. It\'s geography.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm3_2', chapter: 3, index: 2, title: 'Sunken Cargo',
    blurb: 'A barge went aground under the bridge on Day 4 with its cargo still aboard. Someone\'s dog is in there. So, apparently, is the reason for the whole trip.',
    map: 'bridge', time: 'night', mode: 'free', level: [7, 8], party: { min: 1, max: 6 },
    requires: ['m3_1'], hub: null, after: 'hideout:depot',
    briefing: [
      L('narrator', 'DAY 48. BLACKWATER BRIDGE, EAST BANK. DUSK.'),
      L('priya', 'The APC held. The bridge held. Nobody is more surprised than me.'),
      L('priya', 'The depot is two hundred yards north. Before we move in: my map has a mark under the span. "Barge, grounded, unexplored, smells like regret."'),
      L('deke', 'What\'s in the barge?'),
      L('priya', 'Cargo. It went aground on Day 4 and nobody has been near it since. Could be nothing. Could be everything.'),
      L('wendell', 'Excuse me. Is that the crew with the tow truck? Sorry to butt in. I\'m a man with a small problem.'),
      L('wendell', 'My dog went into that barge on Day 6. Shepherd, brown, one ear up. His name is Biscuit. He knows "stay." He\'s terrible at it.'),
      L('mara', 'We\'ll look.'),
      L('wendell', 'Thank you. Good crew. Good crew.'),
      L('ozzy', 'The water is low and the banks are mud. It\'s going to be gross.'),
      L('priya', 'It\'s always gross. That\'s what a map is for.'),
    ],
    steps: [
      {
        id: 'shore', type: 'reach', at: 'cargoA', text: 'Wade out to the grounded barge', pressure: P(4, 0.35, ['crawler']),
        onStart: [radio('priya', 'Crawlers in the mud. Aim low. They can\'t climb the barge, so get up on it.')],
      },
      {
        id: 'crates1', type: 'collect', item: 'crate', count: 3, at: ['cargoA'], text: 'Search the crates on the bow (0/3)', pressure: P(4, 0.5),
        onDone: [radio('priya', 'Bandages, water, forty pounds of rice. Not what we came for, but I\'ll take rice.')],
      },
      {
        id: 'tilt', type: 'survive', seconds: 40, text: 'The barge lurches: the container stack is falling!', pressure: P(4, 1.5, ['spitter']),
        onStart: [radio('priya', 'The whole stern just shifted! Get to the high side, GET TO THE HIGH SIDE!')],
        onDone: [radio('priya', 'The stack went into the river. So did most of the crowd. Well done. Ish.')],
      },
      {
        id: 'crates2', type: 'collect', item: 'crate', count: 3, at: ['cargoB'], text: 'Search the midships holds (0/3)', pressure: P(4, 0.5, ['spitter']),
        onDone: [radio('ozzy', 'Hold on. I have somebody on the line. Everyone stay quiet. Please. Please stay quiet.')],
      },
      {
        id: 'call', type: 'wait', seconds: 2,
        onDone: [
          radio('warden', 'KD9-OZZ, Haven. Are you near Blackwater? There was a barge with parts for the ferry. It never came.', 4200),
          radio('ozzy', 'We are, uh, standing on it.', 2600),
          radio('warden', 'Oh. Oh! Is there a pump? About this big, it says MARINE. I\'m holding up my hands. You can\'t see that.', 5200),
          radio('mara', 'We can hear it. We\'ll find it.', 2600),
          radio('warden', 'Thank you. Thank you. I know you didn\'t sign up for a shopping list. Warden out.', 4200),
        ],
      },
      kill('bloaters', 'bloater', 3, 'Bloaters on the deck: pop them from range (0/3)', {
        parallel: true, pressure: P(4, 0.7, ['bloater', 'spitter']),
        onStart: [radio('priya', 'Big ones on the cargo deck. They burst. Shoot them from far away, or do it near a zombie you dislike.')],
      }),
      {
        id: 'pump', type: 'collect', item: 'pump', count: 1, at: ['cargoC'], text: 'Recover the marine injector pump', pressure: P(4, 0.9, ['spitter', 'bloater']),
        onDone: [radio('priya', 'MARINE. It says MARINE, in capital letters. Take it and go.')],
      },
      {
        id: 'out', type: 'reach', at: 'bankE', text: 'Get back to the east bank', pressure: P(4, 0.5),
      },
    ],
    bonus: [
      noteStep('n10', 'cargoB', 'Read the shipping manifest (optional)', 'crates1'),
      noteStep('n11', 'cargoC', 'Search the barge crew\'s locker (optional)', 'crates2'),
      {
        id: 'biscuit', type: 'reach', at: 'cargoB', hold: 4, text: 'Follow the barking (optional)', since: 'tilt',
        flags: { found_biscuit: true }, todo: 'stepFlags',
        onDone: [radio('wendell', 'That bark. That\'s HIS bark. Oh, you good boy. You good, terrible boy.')],
      },
    ],
    rewards: {
      xp: 480, scrap: 140, weapon: 'crossbow', upgradePoints: 1, flags: { marine_pump: true }, unlockNpc: 'wendell',
    },
    debrief: [
      L('priya', 'There\'s a shipping tag on the pump. Consignee: Lake Harlan Harbor Authority. For the ferry Halcyon. It\'s a ferry part.'),
      L('ozzy', 'The Warden\'s ferry. The Warden\'s ferry is REAL.'),
      L('deke', 'A boat. A real boat with a real engine. Listen to that.'),
      L('mara', 'A broken one.'),
      L('priya', 'Then the boat needs us as much as we need it.'),
      L('wendell', 'I\'d like to come along, if that\'s all right. I\'ll bring the leash either way.'),
      L('wendell', 'Some things you carry so that your hands remember. Good crew.'),
      L('deke', 'That man talks to us like a good dog.'),
      L('mara', 'It\'s working, Deke.'),
      L('deke', '...It\'s a little bit working.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
