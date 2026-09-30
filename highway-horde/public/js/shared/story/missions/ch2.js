// CHAPTER 2 — LAST CHANCE (truckstop). The crew lives at the Roadhouse and drives out from the
// mission board. 2.2 and 2.3 can be played in either order once 2.1 is done.
// Zombies: walkers + runners + crawlers (virtual wave 2-3); still no bloaters or spitters.

import { radio, say, L, P, kill, noteStep } from './lib.js';

export const CH2 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm2_1', chapter: 2, index: 1, title: 'Diner Siege',
    blurb: 'Eleven survivors, nine days behind a diner counter and a hundred pounds of pie. Hold the forecourt until the road clears.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [4, 5], party: { min: 1, max: 6 },
    requires: ['m1_3'], hub: 'roadhouse', after: 'hideout:roadhouse',
    briefing: [
      L('narrator', 'DAY 44. THE ROADHOUSE. MORNING.'),
      L('ozzy', 'New signal! New signal! Forty-one megahertz, weak, from the Last Chance Truck Stop. Listen.'),
      L('quill', 'This is the Last Chance Diner. We are eleven persons, one hundred pounds of pie and a mounting sense of regret. Please attend.'),
      L('roz', 'Pie. He said pie.'),
      L('mara', 'Eleven people. How long have they been in there?'),
      L('quill', 'Nine days. Give or take a pie.'),
      L('deke', 'Truck stop is ninety minutes east if the road is clear. It will not be.'),
      L('ozzy', 'Also, if we go, we pass forty semis, and every semi has a CB, and I have been wanting to say this for a week: I need parts.'),
      L('mara', 'You are using a rescue to shop.'),
      L('ozzy', '...Efficiently.'),
      L('roz', 'Go save my pie people. I will hold supper. Do not make me hold it long.'),
    ],
    steps: [
      {
        id: 'approach', type: 'reach', at: 'truckLot', text: 'Cross the truck lot to the diner', pressure: P(2, 0.3),
        onStart: [radio('quill', 'I can see you! Wave! Not that hard, they can see you too.')],
        onDone: [radio('quill', 'Splendid. Please note the diner is not insured, and neither am I.')],
      },
      {
        id: 'wave1', type: 'defend', target: 'diner', waves: 1, text: 'Defend the diner: first wave', pressure: P(2, 0.8),
        onStart: [radio('ozzy', 'Runners! Heads up. I would say I told you, but nobody told ME.')],
        onDone: [radio('quill', 'That is nine pies saved. I am keeping count.')],
      },
      {
        id: 'sign', type: 'activate', at: ['diner'], hold: 5, text: 'Cut the OPEN sign (hold E)', pressure: P(3, 1.0, ['crawler']),
        onStart: [radio('quill', 'The OPEN sign is on the same switch as the fryer! Nine days it has said OPEN. The dead are taking it literally!')],
        onDone: [radio('quill', 'It is dark. It is beautiful. It is, dare I say, closed.')],
      },
      {
        id: 'wave2', type: 'defend', target: 'diner', waves: 1, text: 'Defend the diner: second wave', pressure: P(3, 1.0, ['runner']),
        onStart: [radio('quill', 'Crawlers! Under the trucks! I once saw a crawler steal a whole cheesecake. It was a Tuesday.')],
      },
      {
        id: 'bait', type: 'survive', seconds: 30, text: 'Draw the crowd onto the pump forecourt', pressure: P(3, 1.4),
        onStart: [radio('quill', 'A plan! Draw them onto the forecourt, stand well back, light the pump trail. I have wanted to say "light the pump trail" my whole life.')],
      },
      {
        id: 'blast', type: 'activate', at: ['pumps'], hold: 4, text: 'Light the fuel trail (hold E)',
        effect: 'explode', blast: { at: 'pumps', r: 260, damage: 400 }, todo: 'explode',
        onDone: [radio('quill', 'BEHOLD! Nobody appreciates a good plan until it explodes.'), radio('ozzy', 'That is the best thing I have ever seen. Please do it again.')],
      },
      {
        id: 'wave3', type: 'defend', target: 'diner', waves: 1, text: 'Defend the diner: last wave', pressure: P(3, 1.1, ['crawler', 'runner']),
        onStart: [radio('mara', 'Heads up, the smoke is drawing a third herd. This one is the last of the night.')],
      },
      {
        id: 'dawn', type: 'survive', seconds: 40, text: 'Hold until the road clears', pressure: P(2, 0.35),
        onDone: [radio('quill', 'Is it over? Is it truly over? I can smell the pie again. It smells like victory and cinnamon.')],
      },
    ],
    bonus: [
      noteStep('n05', 'diner', 'Find the waitress\'s order pad (optional)', 'wave1'),
      noteStep('n06', 'truckLot', 'Read the trucker\'s route sheet (optional)', 'approach'),
    ],
    rewards: {
      xp: 340, scrap: 90, weapon: 'tommy', upgradePoints: 1, flags: { met_quill: true, diner_saved: true }, unlockNpc: 'quill',
    },
    debrief: [
      L('quill', 'Silas Quill. Purveyor of Fine Goods, Rare Rumors and, until recently, Pie.'),
      L('quill', 'I have eaten pie for nine days. I am a changed man. I am also nine pies heavier.'),
      L('mara', 'Bitten? Scratched? Anything?'),
      L('quill', 'Only by my own poor choices, madam.'),
      L('ozzy', 'Do you have a CB?'),
      L('quill', 'Sir, I have nine. In different colors.'),
      L('deke', 'What do you charge for rumors?'),
      L('quill', 'For you? The first is free. The second costs the value of the first. Rumor one: a man at the truck lot has a whole tanker of diesel and no manners. Rumor two: he will want something.'),
      L('quill', 'I would like to come with you. I have a wagon of junk and no more pie.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm2_2', chapter: 2, index: 2, title: 'Radio Parts',
    blurb: 'Every trucker keeps a CB in the cab, and the lot is full of trailers. Some are locked, some are nests. Bring Ozzy the parts to make a real transmitter.',
    map: 'truckstop', time: 'day', mode: 'free', level: [5, 6], party: { min: 1, max: 6 },
    requires: ['m2_1'], hub: 'roadhouse', after: 'hideout:roadhouse',
    briefing: [
      L('ozzy', 'Okay. Okay okay okay. The Warden heard me once. ONCE. I cannot do it again with a beacon made of car batteries and prayer.'),
      L('deke', 'You want a real transmitter.'),
      L('ozzy', 'A linear amp, some tubes, an antenna coupler. Every trucker at Last Chance has one in the cab.'),
      L('quill', 'Which cabs, you ask? Allow me. Trailer A: ham gear, dubious. Trailer B: locked, sinister. Trailer C: a man named Dennis, who is no longer a conversationalist.'),
      L('mara', 'A locked trailer means something is inside.'),
      L('quill', 'Something is always inside. That is what trailers are for.'),
      L('deke', 'Six parts. Anything with a dial. And do not open a door you cannot close.'),
      L('ozzy', 'Also, if you find a micro-cassette player...'),
      L('deke', 'No.'),
      L('ozzy', 'I did not even say why.'),
      L('deke', 'No.'),
      L('mara', 'Daylight, everybody. Use it while we have it.'),
    ],
    steps: [
      {
        id: 'cabs', type: 'collect', item: 'part', count: 2, at: ['truckLot', 'motelRow'], text: 'Salvage CB gear from the cabs (0/2)', pressure: P(2, 0.4),
        onStart: [radio('ozzy', 'Look for anything with a dial, a knob or a wire coming out of it. If it beeps, it is mine.')],
      },
      {
        id: 'locks', type: 'activate', at: ['trailerA', 'trailerB', 'trailerC'], hold: 5, text: 'Break the trailer locks (hold E)', pressure: P(3, 0.9, ['crawler']),
        onStart: [radio('quill', 'Trailer B has three padlocks and a sign that says DO NOT. Do not what, it does not say.')],
        onDone: [radio('mara', 'They are opened. Whatever was in there is now out here.')],
      },
      {
        id: 'horn', type: 'activate', at: ['roadNorth'], hold: 6, text: 'Sound the air horn to pull the herd north (hold E)',
        effect: 'lure', lure: { to: 'roadNorth', seconds: 75 }, todo: 'lure', pressure: P(3, 0.6),
        onStart: [radio('deke', 'An air horn on a Peterbilt. You can hear it in the next county.'), radio('quill', 'That is the point, sir. That is the entire point.')],
        onDone: [radio('ozzy', 'They are turning! They are all turning around! It is beautiful and disgusting.'), radio('mara', 'They are slow. You have about ninety seconds. Move.')],
      },
      {
        id: 'strip', type: 'collect', item: 'part', count: 4, at: ['trailerA', 'trailerB', 'trailerC', 'pumps'], text: 'Strip the trailers while the herd is away (0/4)', pressure: P(3, 0.25),
        onStart: [radio('mara', 'They are all facing the wrong way and they walk like they have somewhere to be. Use it.')],
      },
      {
        id: 'back', type: 'survive', seconds: 25, text: 'The herd is coming back!', pressure: P(3, 1.3, ['runner', 'crawler']),
        onStart: [
          radio('deke', 'Told you the horn was a bad idea.'),
          radio('ozzy', 'It was YOUR idea!'),
          radio('deke', 'It was a fine idea. It just was not a quiet idea.'),
        ],
      },
      {
        id: 'out', type: 'reach', at: 'roadSouth', text: 'Carry the parts out to the south road', pressure: P(2, 0.3),
        onDone: [radio('ozzy', 'Six parts. SIX. I could cry. I could actually cry. Keep going, I will do it later.')],
      },
    ],
    bonus: [
      noteStep('n07', 'motelRow', 'Check the motel office for flyers (optional)', 'cabs'),
      {
        id: 'tape', type: 'collect', item: 'player', count: 1, at: ['trailerB'], text: 'Find a micro-cassette player in the cab (optional)',
        since: 'locks', flags: { has_tape_player: true }, todo: 'stepFlags',
        onDone: [radio('ozzy', 'You found one?! Do not tell Deke. Hide it. I have an idea and it is only a little bit sneaky.')],
      },
    ],
    rewards: {
      xp: 380, scrap: 100, weapon: 'burst_rifle', upgradePoints: 1, flags: { radio_repaired: true },
    },
    debrief: [
      L('ozzy', 'Coupler, tubes, a linear amp. Three hours and I will have a real station. With a mast!'),
      L('deke', 'A mast means the roof. Do not lean on it. I know you. You lean on things.'),
      L('ozzy', 'Haven, Haven, this is KD9-OZZ. Radio check.'),
      L('warden', 'KD9-OZZ, Haven. Loud and clear. You sound better.'),
      L('ozzy', 'It is the tubes!'),
      L('warden', 'Copy tubes. How is the road?'),
      L('ozzy', 'Long.'),
      L('warden', 'Long. Okay. Thank you for coming. Warden out.'),
      L('mara', 'She said thank you for coming. Not thank you for calling.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm2_3', chapter: 2, index: 3, title: 'Night Hauler',
    blurb: 'Dutch Kessler owns the last working diesel pump for fifty miles and will share, for a fee, if someone walks him and six barrels through the dark.',
    map: 'truckstop', time: 'night', mode: 'free', level: [6, 7], party: { min: 1, max: 6 },
    requires: ['m2_1'], hub: 'roadhouse', after: 'hideout:roadhouse',
    briefing: [
      L('quill', 'Rumor two, as promised. Dutch Kessler. He runs the Mile Marker crew out of the truck lot. Ran. They left. He did not.'),
      L('quill', 'He is sitting on a tanker of diesel and the last live pump in fifty miles. He will trade fuel for protection.'),
      L('deke', 'The tanker will not run, the engine is cooked. He wants to hand-carry barrels to the north road.'),
      L('mara', 'How much do we need?'),
      L('deke', 'Enough to power this motel for a month. Or a heavy truck for two hundred miles.'),
      L('dutch', 'I can hear you talking about my diesel! That is MY diesel! That is gonna cost you!'),
      L('ozzy', 'Hi! Sir! Can I say I love your handle? "Big Dutch."'),
      L('dutch', 'It is Dutch. Not Big. Never Big. Kid, how did you get on my channel?'),
      L('ozzy', 'It is... a gift.'),
      L('dutch', 'Fine. Escort me and six barrels from the pumps to the north road. Night only. Daylight is for people who can afford to be seen.'),
      L('mara', 'Deal.'),
      L('dutch', 'It is not a deal. It is an invoice.'),
    ],
    steps: [
      {
        id: 'meet', type: 'reach', at: 'pumps', text: 'Meet Dutch at the pumps', pressure: P(3, 0.3),
        onDone: [say('dutch', 'You are late. Everything is a toll, but lateness is double.')],
      },
      {
        id: 'terms', type: 'dialogue', lines: [
          L('dutch', 'Six barrels. One hand truck. My back, your guns. Nobody touches the diesel but me.'),
          L('dutch', 'I want it on the record that this is not a favor. Favors are how people get comfortable.'),
          L('ozzy', 'I wrote it on my arm!'),
          L('dutch', '...Is that kid on my channel again? Fine. Pump first. Try not to be slow about it. I have been slow all my life.'),
        ],
      },
      {
        id: 'fill', type: 'activate', at: ['pumps'], hold: 12, text: 'Run the pump and fill the barrels (hold E)', pressure: P(3, 0.8, ['crawler']),
        onStart: [say('dutch', 'Twenty gallons a barrel. You crank slower than a Tuesday.')],
        onDone: [say('dutch', 'Six barrels. That is eleven hundred dollars of diesel and I am giving it away and I hate it.')],
      },
      {
        id: 'legA', type: 'escort', npc: 'dutch', route: ['pumps', 'truckLot'], text: 'Escort Dutch and his hand truck: leg 1', pressure: P(3, 0.7, ['runner']),
        onStart: [say('dutch', 'Keep up. Keep in front. Keep the barrels level. Do not let anything bite the barrels.')],
      },
      {
        id: 'stack', type: 'survive', seconds: 30, text: 'The container stack is coming down: get clear!', pressure: P(3, 1.5, ['crawler']),
        onStart: [say('dutch', 'That was not me. That was wind.')],
        onDone: [say('dutch', 'Very strong wind. Very strong. Moving on.')],
      },
      kill('carpet', 'crawler', 8, 'Crawlers under the trailers (0/8)', {
        parallel: true, pressure: P(3, 0.6, ['crawler']),
        onStart: [say('dutch', 'Down low! They are under the trailers! Cover my ankles!')],
      }),
      {
        id: 'legB', type: 'escort', npc: 'dutch', route: ['truckLot', 'trailerB', 'roadNorth'], text: 'Escort Dutch and his hand truck: leg 2', pressure: P(3, 0.7, ['runner', 'crawler']),
      },
      {
        id: 'handoff', type: 'reach', at: 'roadNorth', hold: 6, text: 'Hand the fuel over to Deke', pressure: P(3, 0.4),
        onStart: [radio('deke', 'I can see you. Bring my diesel, and bring the man who does not like me.'), radio('dutch', 'I do not dislike you. I dislike everyone. It is not personal.')],
        onDone: [say('dutch', 'Sign here. Not here. Here. There.')],
      },
    ],
    bonus: [noteStep('n08', 'trailerB', 'Search Dutch\'s cab for his ledger (optional)', 'legA')],
    rewards: {
      xp: 440, scrap: 110, weapon: 'dual_smg', upgradePoints: 1, flags: { met_dutch: true, fuel_secured: true }, unlockNpc: 'dutch',
    },
    debrief: [
      L('dutch', 'Tell nobody I cried.'),
      L('deke', 'You did not cry.'),
      L('dutch', 'Then tell nobody.'),
      L('dutch', 'My crew left on Day 12. Took the trucks. Said the lake was the only place with a future. I said I would follow. I lied. I do not do lakes.'),
      L('mara', 'Then come with us.'),
      L('dutch', 'I am not coming with you. I am coming with my diesel. There is a difference. I will bill you for the ride.'),
      L('ozzy', 'He is coming.'),
      L('deke', 'He is coming.'),
      L('dutch', 'Stop looking at me like that.'),
    ],
    stars: { time: 720, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
