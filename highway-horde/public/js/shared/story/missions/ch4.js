// CHAPTER 4 — DELTA (checkpoint). The crew lives in the Blackwater Depot and drives out to Sgt.
// Okafor's checkpoint. Screamers and the first Brute (a surprise at the gate) arrive here; the
// chapter ends with the Brute pack on the ridge.
// Zombies: virtual wave 5-7 (bloaters, spitters, screamers, brutes).

import { radio, say, L, P, kill, noteStep } from './lib.js';

export const CH4 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm4_1', chapter: 4, index: 1, title: 'Hold the Tower',
    blurb: 'Checkpoint Delta\'s radio tower can throw a signal three hundred miles, and its transmitter needs one quiet night to come back online. Keep the tower standing until dawn.',
    map: 'checkpoint', time: 'night', mode: 'defend', level: [8, 9], party: { min: 1, max: 6 },
    requires: ['m3_2'], hub: 'depot', after: 'hideout:depot',
    briefing: [
      L('narrator', 'DAY 51. BLACKWATER DEPOT. MORNING.'),
      L('okafor', 'Any civilian station on band six: this is Checkpoint Delta, Sergeant Okafor. We have a working tower. We have no power, no relief and no idea what day it is.'),
      L('ozzy', 'Day fifty-one!'),
      L('okafor', '...Copy. Day fifty-one. Thank you. That is a load off.'),
      L('okafor', 'Delta\'s tower can reach the lake. My techs need one quiet night to bring the transmitter back. I need someone to make it quiet.'),
      L('mara', 'How many soldiers do you have?'),
      L('okafor', 'Eleven at Delta. Average age nineteen. And five more I still count every morning. They went out on the ridge on Day ten.'),
      L('deke', 'Where\'s your relief, Sergeant?'),
      L('okafor', 'My orders say until relieved. I have not been relieved. I intend to be very patient.'),
      L('ozzy', 'A tower that reaches the lake means the Warden hears us without the hiss. Clean. Clear!'),
      L('mara', 'We\'ll be there by dark.'),
      L('okafor', 'Bring ammunition. I mean it. My soldiers have started throwing crackers.'),
    ],
    steps: [
      {
        id: 'gate', type: 'reach', at: 'gate', text: 'Reach the Checkpoint Delta gate', pressure: P(5, 0.35),
        onDone: [say('okafor', 'You are on time. I was not expecting that.')],
      },
      {
        id: 'meet', type: 'dialogue', lines: [
          L('okafor', 'Sergeant Amara Okafor. Delta is mine for as long as it stands, which at the current rate is forty-five minutes.'),
          L('danny', 'Ma\'am! Yes ma\'am! That isn\'t a rate, ma\'am, that\'s a guess!'),
          L('okafor', 'Private Ruiz, this is a briefing.'),
          L('danny', 'Sorry, ma\'am. I brought crackers.'),
          L('okafor', 'He brought crackers.'),
          L('okafor', 'The tower is in the center. Tech crew needs it alive until dawn. Hold the gate, hold the crossroads, and do not let anything touch the base of that tower.'),
        ],
      },
      {
        id: 'wave1', type: 'defend', target: 'tower', waves: 2, text: 'Defend the tower: waves 1-2', pressure: P(5, 0.9),
        onStart: [radio('okafor', 'Contact, north gate! Weapons free! Aim for the big ones first. Big ones are always first.')],
      },
      {
        id: 'warden_call', type: 'wait', seconds: 75, parallel: true,
        onDone: [
          radio('ozzy', 'Delta tower is up! The signal is CLEAN. Warden, Warden, this is KD9-OZZ, do you copy?', 4200),
          radio('warden', 'KD9-OZZ, Haven. That\'s so clear. Where are you? I can hear rifles.', 4000),
          radio('ozzy', 'An army checkpoint. Eleven soldiers and us!', 2800),
          radio('warden', 'Eleven soldiers. Okay. That\'s a lot of help. Is anyone hurt?', 3800),
          radio('mara', 'Not yet.', 1800),
          radio('warden', 'Please stay that way. Warden out.', 2800),
        ],
      },
      kill('brute', 'brute', 1, 'A Brute is breaking the gate!', {
        at: 'gate', pressure: P(5, 0.5),
        onStart: [
          radio('okafor', 'Gate! Something is at the gate. That is not a walker, that is a bad day with legs!'),
          radio('danny', 'I didn\'t know they came in extra-large!'),
          radio('mara', 'It charges when you get close. Step aside, don\'t back straight up. Then hit it from behind.'),
        ],
        onDone: [radio('okafor', 'Down. Good. Reload. If you see another one, do not tell me, just shoot it.')],
      }),
      {
        id: 'wave2', type: 'defend', target: 'tower', waves: 2, text: 'Defend the tower: waves 3-4', pressure: P(6, 1.0, ['screamer']),
        onStart: [radio('okafor', 'Screamer! The pale one. Kill it first, it makes everything around it faster!')],
      },
      {
        id: 'relay', type: 'survive', seconds: 45, text: 'Hold the tower until the relay finishes', pressure: P(6, 0.6),
        onStart: [radio('danny', 'Transmitter at eighty-six percent! Eighty-seven! Ma\'am, I\'m so excited I could scream! Please don\'t let me scream!')],
        onDone: [radio('okafor', 'Relay complete. Delta is on the air.'), radio('danny', 'We\'re ON THE AIR, ma\'am!')],
      },
    ],
    bonus: [noteStep('n12', 'tower', 'Read the orders pinned by the tower door (optional)', 'gate')],
    rewards: {
      xp: 500, scrap: 150, weapon: 'lmg', upgradePoints: 1, flags: { tower_held: true, met_okafor: true }, unlockNpc: 'okafor',
    },
    debrief: [
      L('okafor', 'You held my tower. I owe you, and I do not like owing.'),
      L('okafor', 'Eleven at the tower. Five on the ridge. Sixteen. I say it out loud every morning so somebody knows.'),
      L('mara', 'Does it help?'),
      L('okafor', 'It helps me. It is not required to help anyone else.'),
      L('okafor', 'Colonel Reese is not coming back. Nobody is relieving me. So. I am relieving myself.'),
      L('ozzy', 'Can you do that?'),
      L('okafor', 'I am a sergeant. I can do anything that is not a court-martial. Effective now, I am attached to your convoy.'),
      L('okafor', 'I will run your armory. My kids will follow. Where you go, we go.'),
      L('deke', 'I like her.'),
    ],
    stars: { time: 960, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm4_2', chapter: 4, index: 2, title: 'Broken Line',
    blurb: 'The tower is on the air, but Delta\'s three generators are cold and the floodlights are dark. Start them by hand, one at a time, while the whole county listens.',
    map: 'checkpoint', time: 'day', mode: 'free', level: [9, 10], party: { min: 1, max: 6 },
    requires: ['m4_1'], hub: 'depot', after: 'hideout:depot',
    briefing: [
      L('narrator', 'DAY 53. BLACKWATER DEPOT. MORNING.'),
      L('okafor', 'The tower works. The line does not. Delta\'s three generators went cold on Day nineteen, and without them the grid, the floodlights and the relay all sit in the dark.'),
      L('deke', 'Dutch\'s diesel.'),
      L('dutch', 'My diesel. My invoice.'),
      L('okafor', 'Three generators: one at the gate, one in the compound, one on the hill. Manual start, hold the crank, and every one of them is loud.'),
      L('danny', 'I can help! I can carry things! I carry a radio that weighs forty pounds and my sense of hope!'),
      L('okafor', 'Private Ruiz.'),
      L('danny', 'Sense of duty, ma\'am.'),
      L('mara', 'Loud means company.'),
      L('okafor', 'It does. That is why I am sending your crew. Ruiz goes as your radio, since he carries it anyway.'),
      L('danny', 'I\'ll be the best radio! I won\'t say anything unless it\'s very important, ma\'am! Almost nothing!'),
      L('okafor', 'Ruiz.'),
    ],
    steps: [
      {
        id: 'enter', type: 'reach', at: 'compound', text: 'Cross the dark compound to the fuel dump', pressure: P(6, 0.35),
        onStart: [radio('danny', 'All three generators are dry. Sergeant says there\'s a fuel dump in the compound. And crackers. Mostly fuel.')],
      },
      {
        id: 'fuel', type: 'collect', item: 'fuel', count: 3, at: ['compound', 'gate', 'hill'], text: 'Fill three jerry cans from the fuel dump (0/3)', pressure: P(6, 0.5),
        onDone: [radio('danny', 'Three cans! That\'s a generator each! Nobody tell Mr. Dutch we used his diesel for this. Wait, tell him. He\'ll want the invoice.')],
      },
      {
        id: 'genA', type: 'activate', at: ['genA'], hold: 15, text: 'Start generator A at the gate (hold E)', pressure: P(6, 0.7),
        onStart: [radio('danny', 'Generator A, at the gate! Everyone hold the crank and think about spring!')],
        onDone: [radio('danny', 'One! One is running! The gate lights are on! It\'s like Christmas but with more guns!')],
      },
      {
        id: 'genB', type: 'activate', at: ['genB'], hold: 15, text: 'Start generator B in the compound (hold E)', pressure: P(6, 0.9, ['screamer']),
        onStart: [radio('okafor', 'Compound is thick with them. Watch for screamers. They call the rest.')],
      },
      kill('screamers', 'screamer', 3, 'Silence the screamers on the wire (0/3)', {
        pressure: P(6, 0.7, ['screamer']),
        onStart: [radio('okafor', 'Three screamers on the wire. Kill them before they call the rest, and do not let them near the generator.')],
        onDone: [radio('danny', 'Quiet! Sweet, sweet quiet! I never thought I would miss quiet this much!')],
      }),
      {
        id: 'overload', type: 'survive', seconds: 30, text: 'The overload siren is calling the county!', pressure: P(6, 1.5, ['runner']),
        onStart: [
          radio('danny', 'Uh, ma\'am? The grid is complaining. There\'s a siren. A very old siren. It\'s very loud.'),
          radio('okafor', 'That is the compound alarm. Every dead thing within two miles just heard it. Hold your ground.'),
        ],
      },
      {
        id: 'genC', type: 'activate', at: ['genC'], hold: 20, text: 'Start generator C on the hill (hold E)', pressure: P(6, 1.0, ['bloater']),
        onStart: [radio('danny', 'C is on the hill, and it\'s a bit of a climb. It\'s also a bit of a big generator. Twenty seconds of crank!')],
        onDone: [radio('danny', 'THREE! Floodlights! All of them! Ma\'am, you can see the whole checkpoint! It\'s like daylight in the dark!')],
      },
      {
        id: 'lights', type: 'survive', seconds: 60, text: 'The floodlights are on: hold the perimeter!', pressure: P(7, 1.2),
        onStart: [radio('okafor', 'Floodlights are drawing them in like moths. Good. Now they cannot hide. Fire at will.')],
      },
      {
        id: 'breaker', type: 'activate', at: ['tower'], hold: 8, text: 'Throw the main breaker at the tower (hold E)', pressure: P(6, 0.6),
        onDone: [
          radio('danny', 'Main breaker is IN! Haven, Haven, this is Delta, do you copy? Ma\'am, where are you?', 4200),
          radio('warden', 'Delta, Haven. I\'m at the marina. In the tower, actually. The harbor office. Um, sorry, I\'m not a ma\'am.', 5200),
          radio('danny', 'Ma\'am— I mean. Sorry. Copy. Not a ma\'am. Noted!', 3200),
        ],
      },
    ],
    bonus: [noteStep('n13', 'genC', 'Check the generator shed on the hill (optional)', 'genB')],
    rewards: {
      xp: 520, scrap: 160, weapon: 'auto_shotgun', upgradePoints: 1, flags: { generators_online: true, met_danny: true }, unlockNpc: 'danny',
    },
    debrief: [
      L('danny', 'Reporting, ma\'am, I mean everyone. Sergeant says I\'m attached to your crew for radio support. Permanently.'),
      L('okafor', 'Private.'),
      L('danny', 'She said "don\'t get killed," ma\'am. It\'s the nicest thing she has ever said to me.'),
      L('okafor', 'It was an order.'),
      L('danny', 'It was very nice, ma\'am.'),
      L('deke', 'That Delta generator has a voltage regulator that would fit a marine diesel.'),
      L('priya', 'Deke.'),
      L('deke', 'I\'m just saying. I\'m just saying out loud.'),
      L('mara', 'Take it with us.'),
    ],
    stars: { time: 840, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm4_3', chapter: 4, index: 3, title: 'Ghosts',
    blurb: 'Five soldiers went out on the ridge on Day ten and never came back. Something enormous now walks the hill at night wearing their boots. Bring them home.',
    map: 'checkpoint', time: 'night', mode: 'free', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['m4_2'], hub: 'depot', after: 'hideout:depot',
    briefing: [
      L('narrator', 'DAY 54. BLACKWATER DEPOT. NIGHT.'),
      L('danny', 'Sarge? The ridge pinged again. Same as the last three nights.'),
      L('okafor', 'Show me.'),
      L('danny', 'Ghost Six. Faint. Squad frequency. Not a voice. A signal. Like a heartbeat.'),
      L('okafor', 'Ghost squad went out on the tenth day. Five soldiers, four rifles, one radio, and a promise to be back by dark.'),
      L('mara', 'They didn\'t come back.'),
      L('okafor', 'They did not. I have counted them every morning since.'),
      L('deke', 'Sergeant...'),
      L('okafor', 'I know what is out there, Mr. Harlan. Something big walks that ridge at night, and it wears our boots.'),
      L('danny', 'Kip was in Ghost squad, ma\'am. My best friend. He said it was probably cows.'),
      L('okafor', 'I want them found. I want them laid to rest. And I want whatever walks in their boots put down.'),
      L('okafor', 'That is not an order. It is a request, from a sergeant who has run out of orders.'),
    ],
    steps: [
      {
        id: 'ridge', type: 'reach', at: 'hill', text: 'Climb to the ridge above Delta', pressure: P(6, 0.4),
        onStart: [radio('danny', 'Ghost Six is pinging from the top of the hill. I\'ll keep you on it. It gets stronger the closer you are.')],
      },
      {
        id: 'watch', type: 'survive', seconds: 90, text: 'Hold the ridge until the pack comes', pressure: P(6, 0.6, ['screamer']),
        onStart: [radio('okafor', 'They come to sound. Make some.')],
      },
      {
        id: 'flare', type: 'activate', at: ['hill'], hold: 4, text: 'Fire the signal flare (hold E)', pressure: P(6, 0.8),
        onDone: [radio('okafor', 'Flare is up. Ghost Six, if you can see this, come home.')],
      },
      kill('pack1', 'brute', 2, 'Bring down the first Brutes (0/2)', {
        at: 'hill', pressure: P(6, 0.5, ['screamer']),
        onStart: [radio('danny', 'That\'s them. That\'s the boots. I\'d know those boots anywhere, Sarge. Kip glued the soles himself.')],
      }),
      {
        id: 'lull', type: 'dialogue', lines: [
          L('okafor', 'Corporal Ramos. Twenty-two. Would not stop humming.'),
          L('danny', 'Pfc Adeyemi. Nineteen. Taught me to iron a shirt.'),
          L('okafor', 'Pfc Marlowe. Nineteen. Wrote his name on his hat, his lunch and his rifle.'),
          L('danny', 'Kip.'),
          L('okafor', '...Ruiz. Eyes on the treeline.'),
        ],
      },
      kill('pack2', 'brute', 3, 'The rest of the pack (0/3)', {
        at: 'hill', pressure: P(7, 0.7, ['screamer']),
        onStart: [radio('okafor', 'Here they come. Nobody dies for this. We do this for them.')],
        onDone: [radio('okafor', 'That is all five. Stand down.')],
      }),
      {
        id: 'tags', type: 'collect', item: 'tag', count: 5, at: ['hill'], text: 'Recover the dog tags (0/5)', pressure: P(6, 0.3),
        onDone: [radio('danny', 'I have all five. I have all five, Sarge.')],
      },
      {
        id: 'lay', type: 'reach', at: 'hill', hold: 8, text: 'Lay the tags at the cairn on the hill',
        onStart: [say('okafor', 'Ghost squad. Stand down. You are relieved.')],
        onDone: [say('danny', 'Save me a seat, Kip. Save me a seat on the bus.')],
      },
    ],
    bonus: [
      noteStep('n14', 'hill', 'Check the ridge for the squad\'s radio log (optional)', 'ridge'),
      noteStep('n15', 'gate', 'Search Kip\'s helmet at the gate (optional)', 'ridge'),
    ],
    rewards: {
      xp: 580, scrap: 180, weapon: 'flare', upgradePoints: 1, flags: { ghosts_laid_to_rest: true },
    },
    debrief: [
      L('okafor', 'Eleven at the depot. Five at rest. I will keep saying sixteen. But I will say it differently now.'),
      L('okafor', 'Eleven who came home, five who are home. Sixteen.'),
      L('danny', 'Yes, ma\'am.'),
      L('danny', 'Sarge, do you think Kip is mad I brought the crackers?'),
      L('okafor', 'I think Kip would have wanted the crackers.'),
      L('danny', 'He said save him a seat.'),
      L('okafor', '...Then we will save him a seat.'),
      L('mara', 'You didn\'t have to do that.'),
      L('okafor', 'I did not. I am a sergeant, Doc. Nobody has to do anything. We just do it in the right order.'),
      L('mara', 'Then I\'ll stay for the order.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
