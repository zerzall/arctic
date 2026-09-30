// CHAPTER 6 — HAVEN (harlan, Campaign). 6.1 is the campaign director's HILLTOP stage on Radio Hill,
// 6.2 is BREAKOUT -> ASCENT (three floors) -> ROOFTOP -> ZIP. The story is told over the radio: the
// convoy (trucks, soldiers, kids) slips down the lake road while the crew keeps the whole county
// looking at the hill. Timed radio events use the wait chain: `parallel:true` waits that start
// together with the next step and speak when their seconds are up.

import { radio, say, L, noteStep } from './lib.js';

export const CH6 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm6_1', chapter: 6, index: 1, title: 'Last Stand',
    blurb: 'Radio Hill is the highest ground in the county. Light it up, make noise, and give the convoy on the lake road every dead thing in Harlan County to look at instead.',
    map: 'harlan', time: 'day', mode: 'campaign', level: [12, 13], party: { min: 1, max: 6 },
    requires: ['m5_2'], hub: 'farmstead', after: 'm6_2',
    briefing: [
      L('narrator', 'DAY 57. HASKELL FARM. THE NIGHT BEFORE.'),
      L('okafor', 'Plan. The lake road runs along the north ridge. Two miles of open ground, and every dead thing in the county between us and the water.'),
      L('priya', 'I counted. Ish.'),
      L('okafor', 'The convoy takes the lake road at dawn: the tow truck, Kessler\'s rig, both buses, my soldiers. We need the horde looking the other way.'),
      L('mara', 'That\'s us.'),
      L('okafor', 'That is you. Radio Hill. Highest ground in the county. Light it up, make noise, hold it. Every dead thing will climb that hill to find you.'),
      L('deke', 'Nice.'),
      L('okafor', 'They are slow. That is the one gift we have. It will take them an hour to climb the hill. By then the convoy is on the water.'),
      L('june', 'Miss Mara, are you coming on the truck with me?'),
      L('mara', 'I\'ll be on the radio, June. And then I\'ll be on the deck of a boat, waiting for these people.'),
      L('june', 'Do you promise?'),
      L('mara', 'I don\'t promise. I tell you what I\'m going to do. I\'m going to be on that deck.'),
      L('june', 'That\'s better than a promise.'),
      L('ozzy', 'KD9-OZZ, all channels, all night. If you hear static, that\'s me being nervous.'),
    ],
    steps: [
      {
        id: 't1', type: 'wait', seconds: 20, parallel: true,
        onDone: [radio('okafor', 'Convoy is rolling. Kessler leads. He is complaining. That is how we know it is working.')],
      },
      {
        id: 't2', type: 'wait', seconds: 100, parallel: true,
        onDone: [radio('dutch', 'For the record, the lake road is beautiful and I hate it. Three cornfields and a horse.')],
      },
      {
        id: 't3', type: 'wait', seconds: 200, parallel: true,
        onDone: [
          radio('june', 'Miss Mara! I can see the hill from the truck! It looks like a candle!', 3600),
          radio('mara', 'It\'s a very big candle, June. Keep your head down.', 3200),
        ],
      },
      {
        id: 't4', type: 'wait', seconds: 330, parallel: true,
        onDone: [radio('priya', 'Convoy at the quarry bend. It\'s working. The dead are climbing your hill, all of them. Every last one.')],
      },
      {
        id: 't5', type: 'wait', seconds: 450, parallel: true,
        onDone: [radio('okafor', 'Two miles to the marina. Hold the hill until the trucks reach the water. Do not give up the high ground.')],
      },
      {
        id: 't6', type: 'wait', seconds: 560, parallel: true,
        onDone: [radio('ozzy', 'Lake road is clear! Convoy is at the docks! You did it, you did it, hang on, there\'s something big coming up your slope.')],
      },
      {
        id: 'hill', type: 'campaignStage', stage: 'hill', waves: 4, text: 'Hold Radio Hill: keep the horde looking at you', todo: 'campaignWaves',
        onStart: [say('okafor', 'Palisade is yours. Gate by gate, wave by wave. Give them something to climb.')],
      },
      {
        id: 'after', type: 'dialogue', lines: [
          L('ozzy', 'Convoy is on the ferry! Everyone is on the ferry! Even Quill\'s wagon, God help us.'),
          L('okafor', 'Your turn. The tower is ahead, the dead are behind. Move like you mean it.'),
          L('mara', 'I\'m on the deck. Don\'t make me wait.'),
        ],
      },
    ],
    bonus: [noteStep('n19', 'ridgeHill', 'Check the transmitter console on the hill (optional)', 'hill')],
    rewards: {
      xp: 700, scrap: 200, weapon: 'rocket', upgradePoints: 1, flags: { convoy_through: true },
    },
    debrief: [
      L('okafor', 'The convoy reached the water. Every truck, every soldier, every child.'),
      L('okafor', 'I counted them off the docks. All present. First time in fifty-seven days I have not lost a number.'),
      L('mara', 'Say it again.'),
      L('okafor', 'All present, Doc.'),
      L('mara', 'I needed to hear that in a sergeant\'s voice.'),
      L('okafor', 'Now the hard part. The dead are still between you and the boat. There is a tower with a cable on the roof, and the ferry is waiting at the other end of it.'),
      L('deke', 'A zip line. Of course it\'s a zip line.'),
      L('okafor', 'Nothing about this has been sensible, Mr. Harlan. I see no reason to start now.'),
    ],
    stars: { time: 960, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm6_2', chapter: 6, index: 2, title: 'The Tower',
    blurb: 'Break out across the county, climb the marina tower floor by floor, hold the roof, and ride the cable down to the ferry deck. Everyone you love is waiting at the other end.',
    map: 'harlan', time: 'day', mode: 'campaign', level: [13, 14], party: { min: 1, max: 6 },
    requires: ['m6_1'], hub: null, after: 'epilogue',
    briefing: [
      L('narrator', 'DAY 58. THE LAKE ROAD. NOON.'),
      L('ozzy', 'The convoy is at the marina. Everyone is on the ferry. Everyone except you.'),
      L('deke', 'The engine caught. Cough, cough, cough, and it caught. She isn\'t pretty, but she runs.'),
      L('priya', 'The docks are packed with the dead. The only way onto the boat is the tower: the roof, the cable, the ferry deck.'),
      L('okafor', 'The boiler needs the pressure and the storm front needs the sky. The ferry has to cast off by mid-afternoon. It cannot wait.'),
      L('dutch', 'You have my diesel and my invoice. Come get them.'),
      L('warden', 'Hello? Hello, KD9-OZZ? I can see the hill from the tower. I saw the candle. It was... thank you.'),
      L('mara', 'Warden, this is Mara. We\'ll be on the roof in an hour.'),
      L('warden', 'Copy. Mara. Copy. The cable will hold. Grandpa rigged it. It\'ll hold.'),
      L('ozzy', 'Grandpa?'),
      L('warden', '...The old Warden. Never mind. Over.'),
      L('mara', 'See you on the deck.'),
      L('june', 'Miss Mara, don\'t be slow!'),
    ],
    steps: [
      {
        id: 'b1', type: 'wait', seconds: 45, parallel: true,
        onDone: [radio('dutch', 'The dead are all facing your direction. You\'re very popular. It isn\'t a compliment.')],
      },
      {
        id: 'breakout', type: 'campaignStage', stage: 'breakout', text: 'Break out: run for the tower door',
        onStart: [radio('okafor', 'Gates blow in three, two, one. Do not stop. Do not look back. Do not stop.')],
        onDone: [radio('ozzy', 'You\'re at the door! You\'re at the DOOR! Go up! Go UP!')],
      },
      {
        id: 'door', type: 'dialogue', lines: [
          L('priya', 'That is the door. Three floors, one roof, one cable. Please do not die in the lobby. It has the worst carpet I have ever mapped.'),
          L('deke', 'You do this, you get to say you did it. Now go. Be quick about being brave.'),
          L('ozzy', 'I\'m on channel one, channel two and channel nine. Talk to me. Talk to anyone. Talk to the sandwich.'),
        ],
      },
      {
        id: 'a1', type: 'wait', seconds: 25, parallel: true,
        onDone: [radio('deke', 'Pressure is climbing. Nine hundred pounds. She likes it. She likes being run hard.')],
      },
      {
        id: 'a2', type: 'wait', seconds: 90, parallel: true,
        onDone: [
          radio('ozzy', 'Warden, you keep saying "um." Just so you know.', 3200),
          radio('warden', 'It\'s a radio! People say um on a radio!', 3200),
          radio('ozzy', 'Not on Haven. Haven says "stand by." Haven says "over." You\'ve said "um" eleven times tonight.', 4600),
          radio('warden', '...You counted?', 2200),
          radio('ozzy', 'I count everything.', 2200),
          radio('warden', 'I\'m not a Warden. I mean, I am, sort of. I\'m Wren. I\'m fifteen. My grandfather was the Warden.', 5400),
          radio('wren', 'He went to check the north pier on the eighteenth. He said back before dark. He wrote the script and left it on the console.', 5600),
          radio('wren', 'It says "Haven is open." It isn\'t. But if I say it enough nights, somebody might come and make it true.', 5600),
          radio('mara', 'Wren. It\'s Mara. How long have you been alone?', 3600),
          radio('wren', 'Forty days. Forty and a half.', 3000),
          radio('ozzy', 'You had me.', 2000),
          radio('wren', '...I had you.', 2400),
          radio('priya', 'Nobody is alone on my map, Wren. Not anymore.', 3600),
          radio('dutch', 'You\'re the ferry LADY? You\'re the ferry lady. I need to renegotiate my rate.', 4200),
        ],
      },
      {
        id: 'a3', type: 'wait', seconds: 200, parallel: true,
        onDone: [radio('june', 'Miss Mara, Wren showed me the horn! It\'s a REAL boat horn! It goes BWAAAAMP!', 4600)],
      },
      {
        id: 'tower', type: 'campaignStage', stage: 'tower', text: 'Climb the tower: lobby, offices, atrium',
        onStart: [radio('priya', 'Three floors. Stairs open when the floor is clear. Don\'t linger. The building won\'t miss you.')],
      },
      {
        id: 'r1', type: 'wait', seconds: 20, parallel: true,
        onDone: [radio('okafor', 'The storm front is visible from the docks. Grey wall, forty miles wide. You have less time than you think.')],
      },
      {
        id: 'r2', type: 'wait', seconds: 85, parallel: true,
        onDone: [radio('deke', 'Boiler is at pressure. She\'s ready to cast off. Say the word, Wren.')],
      },
      {
        id: 'r3', type: 'wait', seconds: 120, parallel: true,
        onDone: [radio('wren', 'Not yet. Not yet. They aren\'t on the cable. I\'m not casting off without you. I\'m not doing it.', 5200)],
      },
      {
        id: 'roof', type: 'campaignStage', stage: 'roof', text: 'Hold the roof until the line is ready',
        onStart: [radio('mara', 'You\'re on the roof. Steady. Everyone breathe. Then shoot everything.')],
      },
      {
        id: 'z1', type: 'wait', seconds: 6, parallel: true,
        onDone: [
          radio('june', 'Miss Mara! They\'re coming down the line! They\'re coming!', 3400),
          radio('june', 'Ten! Nine! Eight!', 2600),
        ],
      },
      {
        id: 'zip', type: 'campaignStage', stage: 'zip', text: 'Ride the cable to the ferry deck (hold E at the gantry)',
        onStart: [radio('wren', 'Clip in! It\'ll hold! It\'ll hold! It held for my grandfather!', 4200)],
      },
    ],
    bonus: [noteStep('n20', 'roof', 'Find the script page on the roof (optional)', 'tower')],
    rewards: {
      xp: 900, scrap: 220, weapon: 'railgun', upgradePoints: 2, flags: { haven_reached: true, campaign_complete: true },
    },
    debrief: [
      L('wren', 'You made it. You actually made it.'),
      L('mara', 'You said we would.'),
      L('wren', 'I said it every night for twenty-five nights. I didn\'t know if anyone was listening.'),
      L('ozzy', 'I was listening.'),
      L('wren', 'I know. I noticed. You said "copy" like it mattered.'),
      L('ozzy', 'It did matter.'),
      L('dutch', 'The engine is running. The storm isn\'t. Somebody cast off this boat.'),
      L('wren', 'Yes. Yes, sir. Casting off. Everyone hold on.'),
    ],
    stars: { time: 1200, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
