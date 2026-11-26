// SIDE JOBS — the hideout mission board's optional jobs (JOURNEY.md §2). These were the campaign's
// missions before the crew started to travel; now they are short trips out from a hideout on the
// classic maps (the highway, the truck stop, the bridge, the checkpoint, Harlan County). Each one:
//
//   side: true, chapter: SIDE_CHAPTER (7, "Side Jobs"), index 1..12 in board order
//   opens      the story chapter it belongs to (the board groups it there)
//   requires   the story mission (or side job) that puts it on the board
//   hub        the hideout where it first appears; it can be picked at any hideout after that
//   after      'hideout': the crew comes back to the hideout it left from
//
// They never block the story: nextNodes() leaves them out, and they can be replayed for scrap, XP and
// loot. Some bring people home: Quill (Diner Siege), Dutch (Night Hauler) and Wendell with Biscuit
// (Sunken Cargo) join the crew only through a side job.

import { SIDE_CHAPTER } from '../../story-defs.js';
import { radio, say, L, P, kill, boss, noteStep } from './lib.js';

const SIDE = { side: true, chapter: SIDE_CHAPTER, after: 'hideout' };

export const SIDE_JOBS = [
  // ============================================================================ opens in chapter 2
  {
    ...SIDE, id: 'sj_fuel', index: 1, opens: 2, title: 'Fuel Run',
    blurb: 'The Roadhouse generator and Deke\'s tow truck both drink diesel. Highway 9 back east is still full of wrecks with fuel in their tanks, and an old station with a bowser trailer.',
    map: 'highway', time: 'night', mode: 'free', level: [3, 4], party: { min: 1, max: 6 },
    requires: ['m1_2'], hub: 'roadhouse',
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. DUSK.'),
      L('deke', 'Generator\'s on fumes. The truck\'s on fumes and prayer. I\'m on coffee, which is the same thing.'),
      L('deke', 'Highway 9, back toward the pileup. Every wreck out there has a tank, and some of them still have something in it.'),
      L('mara', 'At night?'),
      L('deke', 'At night the siphon hose doesn\'t shine. Six red cans. Then the old station by the crossroads has a bowser trailer. We tow it home.'),
      L('roz', 'If you bring back diesel, I\'ll bring back the fryer. Nobody has had a fried anything in forty days.'),
      L('june', 'Mister Deke, can you bring back a fried anything?'),
      L('deke', 'Kid, I\'m bringing back six cans and my own back. Fried is Roz\'s department.'),
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
        id: 'cans2', type: 'collect', item: 'fuel', count: 3, at: ['gasStation', 'westEnd'], text: 'Find the last three cans (0/3)', pressure: P(2, 0.6),
        onStart: [radio('deke', 'Three more. Then the station. Deals are the last thing I have, and this is a deal with a generator.')],
      },
      {
        id: 'door', type: 'reach', at: 'gasStation', hold: 3, text: 'Bring the cans to the station by the crossroads', pressure: P(1, 0.4),
        onDone: [say('deke', 'Six. Huh. I didn\'t think you\'d manage two. Don\'t tell me how. I like mysteries.')],
      },
      {
        id: 'bowser', type: 'dialogue', lines: [
          L('deke', 'There she is. A bowser trailer, four hundred gallons, half full. Somebody filled it and never came back for it.'),
          L('deke', 'Prime the line and hold the forecourt. I\'ll hitch her. Don\'t touch anything that\'s clicking.'),
        ],
      },
      {
        id: 'prime', type: 'activate', at: ['gasStation'], hold: 14, text: 'Prime the bowser\'s pump line (hold E)', pressure: P(2, 0.7),
        onStart: [say('deke', 'Twenty seconds! Twenty seconds and she flows!')],
        onDone: [say('deke', 'That\'s the sound of four hundred gallons deciding to cooperate. Listen to that. That\'s generosity.')],
      },
      {
        id: 'tow', type: 'escort', npc: 'deke', route: ['gasStation', 'crossroadsW', 'bus'], text: 'Cover Deke and the bowser back to the old bus', pressure: P(2, 0.5, ['runner']),
        onStart: [
          say('deke', 'Nice and slow. She only has two speeds and one of them is off.'),
          radio('mara', 'One of them is running! Deke, one of them is running at you!'),
          say('deke', 'Don\'t panic. Panic uses fuel.'),
        ],
        onDone: [say('deke', 'There\'s my truck, right where I left it by the old bus. Nobody fall off anything.')],
      },
      {
        id: 'hook', type: 'survive', seconds: 40, text: 'Hold the line while Deke hitches the bowser to the truck', pressure: P(2, 0.6),
        onStart: [say('deke', 'The truck is where I left it, by the old bus. Give me forty seconds and a small miracle.')],
        onDone: [say('deke', 'Hitched. Small miracle delivered. Roz gets her fryer.')],
      },
    ],
    bonus: [
      noteStep('n03', 'westEnd', 'Search the roadblock for orders (optional)', 'cans1'),
      {
        id: 'busbag', type: 'collect', item: 'crate', count: 1, at: ['bus'], text: 'Fetch June\'s bottle-cap sock from the old bus (optional)',
        since: 'cans2', flags: { june_sock: true }, todo: 'stepFlags',
        onDone: [radio('mara', 'Her bottle caps! She\'s been looking for those for a week. Forty-one caps in a sock. Don\'t lose it.')],
      },
    ],
    rewards: { xp: 220, scrap: 60, weapon: 'sawedoff', upgradePoints: 1, flags: { fuel_run: true } },
    debrief: [
      L('deke', 'Four hundred gallons. The generator runs, the truck runs, and I nearly ran. Nobody saw that.'),
      L('roz', 'The fryer is ON. Tonight we fry. I don\'t know what yet. Something.'),
      L('deke', 'Found this under the station counter. Sawed-off. Somebody\'s idea of customer service.'),
      L('mara', 'The old bus is still out there, you know. Just sitting on the highway.'),
      L('deke', 'Good bus. Did its job. Let it rest.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_beacon', index: 2, opens: 2, title: 'Beacon',
    blurb: 'Now that everybody knows the Warden is fifteen, Ozzy wants a beacon on the I-44 overpass, so the Roadhouse can hear her every night, and she can hear somebody back.',
    map: 'highway', time: 'night', mode: 'free', level: [5, 6], party: { min: 1, max: 6 },
    requires: ['m2_2'], hub: 'roadhouse',
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. NIGHT.'),
      L('ozzy', 'She\'s alone every night. She reads the script to nobody. The helipad radio was one night. I want every night.'),
      L('ozzy', 'The I-44 overpass is the highest point on Highway 9. A beacon up there, and the Roadhouse can talk to her whenever she\'s scared.'),
      L('deke', 'There\'s a jackknifed semi on that overpass. Three lanes wide. The tow truck can shift it. Slowly. Loudly.'),
      L('mara', 'Loudly is a problem.'),
      L('ozzy', 'It needs three car batteries and somebody to keep the dead off it for a few minutes.'),
      L('mara', '"A few minutes."'),
      L('ozzy', '...Ten. Maybe ten.'),
      L('deke', 'Kid, you\'re paying for the batteries.'),
      L('ozzy', 'With what?'),
      L('deke', 'Gratitude. Lots of it.'),
    ],
    steps: [
      {
        id: 'climb', type: 'reach', at: 'overpass', text: 'Reach the I-44 overpass', pressure: P(2, 0.3),
        onStart: [radio('ozzy', 'The left lane is more of a suggestion than a lane. Hug the right. Please hurry, I\'ve been talking to a sandwich.')],
        onDone: [radio('ozzy', 'You\'re up! Okay. Deep breath. This is where the magic happens. The magic is mostly duct tape.')],
      },
      {
        id: 'batteries', type: 'collect', item: 'battery', count: 3, at: ['overpass', 'crossroadsE', 'crossroadsW'], text: 'Pull car batteries (0/3)', pressure: P(2, 0.4),
        onStart: [radio('deke', 'Under the hood, black box, two terminals. Red is bad, black is worse. Just grab them and go.')],
      },
      {
        id: 'rig', type: 'dialogue', lines: [
          L('ozzy', 'This is the rig. A dipole, three batteries and, uh, mostly duct tape.'),
          L('deke', 'Duct tape. On a transmitter.'),
          L('ozzy', 'It\'s load-bearing duct tape.'),
          L('ozzy', 'Batteries in, ten minutes. I do the talking, you do the not dying. Everyone gets a job.'),
        ],
      },
      {
        id: 'wire', type: 'activate', at: ['overpass'], hold: 10, text: 'Wire the beacon to the batteries (hold E)', pressure: P(2, 0.5),
        onStart: [say('ozzy', 'Red to red, black to black. If it sparks, that\'s normal. If it screams, that isn\'t.')],
        onDone: [say('ozzy', 'Oh. Oh no. It\'s working. It\'s actually working.')],
      },
      {
        id: 'warden_call', type: 'wait', seconds: 40, parallel: true,
        onDone: [
          radio('warden', '...KD9-OZZ? Is that you? You\'re so LOUD. Over.', 3000),
          radio('ozzy', 'KD9-OZZ on the I-44 overpass! New beacon! I can hear you from home now. Every night.', 3800),
          radio('warden', 'Every night? You don\'t have to. I mean. You don\'t have to. Um.', 3200),
          radio('mara', 'He wants to, sweetheart. We all do. Tell us about your day.', 3200),
          radio('warden', 'My day. Okay. I fixed a door. I fed a cat that isn\'t mine. I read the script. That\'s my day.', 4600),
          radio('ozzy', 'That\'s a great day. That\'s a very good door.', 2600),
          radio('warden', 'Warden out. ...Over. Sorry. Goodnight. That\'s what I meant. Goodnight.', 3600),
        ],
      },
      {
        id: 'hold', type: 'survive', seconds: 90, text: 'Keep the beacon lit: hold the overpass', pressure: P(3, 0.55, ['crawler']),
        onStart: [radio('ozzy', 'CQ, CQ, CQ. Haven, Haven, this is KD9-OZZ on the Highway 9 overpass. Do you copy? Over.')],
      },
      {
        id: 'surge', type: 'survive', seconds: 45, text: 'The beacon is calling every dead thing for miles!', pressure: P(3, 1.5, ['runner']),
        onStart: [
          radio('ozzy', 'So the beacon is very loud. That is, technically, the point.'),
          radio('mara', 'Runners! A whole crowd of them!'),
          radio('deke', 'Kid, you said ten minutes.'),
        ],
        onDone: [radio('mara', 'Nobody tell me it gets worse. I want to believe it doesn\'t.')],
      },
      {
        id: 'winch', type: 'activate', at: ['crossroadsE'], hold: 8, text: 'Winch the jackknifed semi clear of the overpass (hold E)', pressure: P(3, 0.8),
        onStart: [radio('deke', 'Hook is on the trailer. When it goes, it goes all at once. Stand clear.')],
        onDone: [radio('deke', 'Timber.')],
      },
      {
        id: 'collapse', type: 'survive', seconds: 25, text: 'The pileup gives way: get clear!', pressure: P(3, 1.5, ['crawler']),
        onStart: [radio('mara', 'Whatever was pinned under that trailer just got unpinned.')],
      },
      {
        id: 'home', type: 'reach', at: 'motel', hold: 6, text: 'Back to the Roadhouse', pressure: P(2, 0.4),
        onDone: [radio('roz', 'The sign still says NO VAC. You\'re still welcome. Boots.')],
      },
    ],
    bonus: [noteStep('n04', 'overpass', 'Read the trucker\'s log in the cab (optional)', 'batteries')],
    rewards: { xp: 260, scrap: 70, weapon: 'lever', upgradePoints: 1, flags: { beacon_lit: true } },
    debrief: [
      L('ozzy', 'She said goodnight. On purpose. She\'s never said goodnight to anybody on that radio.'),
      L('mara', 'Then say it back every night, Ozzy. That\'s the whole job now.'),
      L('deke', 'Found a lever-action rifle in the semi\'s sleeper cab. Cowboy gun. It\'ll outlive all of us.'),
      L('june', 'Can I say goodnight to her too?'),
      L('ozzy', 'June. You can say goodnight first.'),
    ],
    stars: { time: 840, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_diner', index: 3, opens: 2, title: 'Diner Siege',
    blurb: 'Eleven survivors, nine days behind a diner counter and a hundred pounds of pie. Hold the forecourt of the Last Chance Truck Stop until the road clears.',
    map: 'truckstop', time: 'night', mode: 'defend', level: [3, 5], party: { min: 1, max: 6 },
    requires: ['m1_2'], hub: 'roadhouse',
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. MORNING.'),
      L('ozzy', 'New signal! New signal! Forty-one megahertz, weak, from the Last Chance Truck Stop. Listen.'),
      L('quill', 'This is the Last Chance Diner. We are eleven persons, one hundred pounds of pie and a mounting sense of regret. Please attend.'),
      L('roz', 'Pie. He said pie.'),
      L('mara', 'Eleven people. How long have they been in there?'),
      L('quill', 'Nine days. Give or take a pie.'),
      L('deke', 'Truck stop is ninety minutes east if the road is clear. It won\'t be.'),
      L('ozzy', 'Also, if we go, we pass forty semis, and every semi has a CB, and I need parts.'),
      L('mara', 'You\'re using a rescue to shop.'),
      L('ozzy', '...Efficiently.'),
      L('roz', 'Go save my pie people. I\'ll hold supper. Don\'t make me hold it long.'),
    ],
    steps: [
      {
        id: 'approach', type: 'reach', at: 'truckLot', text: 'Cross the truck lot to the diner', pressure: P(2, 0.3),
        onStart: [radio('quill', 'I can see you! Wave! Not that hard, they can see you too.')],
        onDone: [radio('quill', 'Splendid. Please note the diner is not insured, and neither am I.')],
      },
      {
        id: 'wave1', type: 'defend', target: 'diner', waves: 1, text: 'Defend the diner: first wave', pressure: P(2, 0.8),
        onStart: [radio('ozzy', 'Runners! Heads up. I\'d say I told you, but nobody told ME.')],
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
        onDone: [radio('quill', 'BEHOLD! Nobody appreciates a good plan until it explodes.'), radio('ozzy', 'That\'s the best thing I have ever seen. Please do it again.')],
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
    rewards: { xp: 240, scrap: 70, weapon: 'tommy', upgradePoints: 1, flags: { met_quill: true, diner_saved: true }, unlockNpc: 'quill' },
    debrief: [
      L('quill', 'Silas Quill. Purveyor of Fine Goods, Rare Rumors and, until recently, Pie.'),
      L('quill', 'I have eaten pie for nine days. I am a changed man. I am also nine pies heavier.'),
      L('mara', 'Bitten? Scratched? Anything?'),
      L('quill', 'Only by my own poor choices, madam.'),
      L('ozzy', 'Do you have a CB?'),
      L('quill', 'Sir, I have nine. In different colors.'),
      L('quill', 'Rumor one, free: a man at the truck lot sits on a whole tanker of diesel and has no manners. Rumor two costs the value of the first.'),
      L('quill', 'I would like to come with you. I have a wagon of junk and no more pie.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_radio', index: 4, opens: 2, title: 'Radio Parts',
    blurb: 'The helipad radio reached the Warden once. Ozzy wants a real transmitter at the Roadhouse, and every trucker at the Last Chance kept a CB in the cab. Some trailers are locked. Some are nests.',
    map: 'truckstop', time: 'day', mode: 'free', level: [5, 6], party: { min: 1, max: 6 },
    requires: ['m2_2', 'sj_diner'], hub: 'roadhouse',
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. MORNING.'),
      L('ozzy', 'She heard us from a hospital roof. ONCE. I can\'t take the crew up a hospital every time she\'s lonely.'),
      L('deke', 'You want a real transmitter.'),
      L('ozzy', 'A linear amp, some tubes, an antenna coupler. Every trucker at Last Chance has one in the cab.'),
      L('quill', 'Which cabs, you ask? Allow me. Trailer A: ham gear, dubious. Trailer B: locked, sinister. Trailer C: a man named Dennis, who is no longer a conversationalist.'),
      L('mara', 'A locked trailer means something is inside.'),
      L('quill', 'Something is always inside. That is what trailers are for.'),
      L('deke', 'Six parts. Anything with a dial. And don\'t open a door you can\'t close.'),
      L('ozzy', 'Also, if you find a micro-cassette player...'),
      L('deke', 'No.'),
      L('ozzy', 'I didn\'t even say why.'),
      L('deke', 'No.'),
    ],
    steps: [
      {
        id: 'cabs', type: 'collect', item: 'part', count: 2, at: ['truckLot', 'motelRow'], text: 'Salvage CB gear from the cabs (0/2)', pressure: P(2, 0.4),
        onStart: [radio('ozzy', 'Look for anything with a dial, a knob or a wire coming out of it. If it beeps, it\'s mine.')],
      },
      {
        id: 'locks', type: 'activate', at: ['trailerA', 'trailerB', 'trailerC'], hold: 5, text: 'Break the trailer locks (hold E)', pressure: P(3, 0.9, ['crawler']),
        onStart: [radio('quill', 'Trailer B has three padlocks and a sign that says DO NOT. Do not what, it does not say.')],
        onDone: [radio('mara', 'They\'re open. Whatever was in there is out here now.')],
      },
      {
        id: 'horn', type: 'activate', at: ['roadNorth'], hold: 6, text: 'Sound the air horn to pull the herd north (hold E)',
        effect: 'lure', lure: { to: 'roadNorth', seconds: 75 }, todo: 'lure', pressure: P(3, 0.6),
        onStart: [radio('deke', 'An air horn on a Peterbilt. You can hear it in the next county.'), radio('quill', 'That is the point, sir. That is the entire point.')],
        onDone: [radio('ozzy', 'They\'re turning! They\'re all turning around! It\'s beautiful and disgusting.'), radio('mara', 'They\'re slow. You have about ninety seconds. Move.')],
      },
      {
        id: 'strip', type: 'collect', item: 'part', count: 4, at: ['trailerA', 'trailerB', 'trailerC', 'pumps'], text: 'Strip the trailers while the herd is away (0/4)', pressure: P(3, 0.25),
        onStart: [radio('mara', 'They\'re all facing the wrong way and they walk like they have somewhere to be. Use it.')],
      },
      {
        id: 'back', type: 'survive', seconds: 25, text: 'The herd is coming back!', pressure: P(3, 1.3, ['runner', 'crawler']),
        onStart: [
          radio('deke', 'Told you the horn was a bad idea.'),
          radio('ozzy', 'It was YOUR idea!'),
          radio('deke', 'It was a fine idea. It just wasn\'t a quiet idea.'),
        ],
      },
      {
        id: 'out', type: 'reach', at: 'roadSouth', text: 'Carry the parts out to the south road', pressure: P(2, 0.3),
        onDone: [radio('ozzy', 'Six parts. SIX. I could cry. I could actually cry. Keep going, I\'ll do it later.')],
      },
    ],
    bonus: [
      noteStep('n07', 'motelRow', 'Check the motel office for flyers (optional)', 'cabs'),
      {
        id: 'tape', type: 'collect', item: 'player', count: 1, at: ['trailerB'], text: 'Find a micro-cassette player in the cab (optional)',
        since: 'locks', flags: { has_tape_player: true }, todo: 'stepFlags',
        onDone: [radio('ozzy', 'You found one?! Don\'t tell Deke. Hide it. I have an idea and it\'s only a little bit sneaky.')],
      },
    ],
    rewards: { xp: 270, scrap: 75, weapon: 'burst_rifle', upgradePoints: 1, flags: { radio_repaired: true } },
    debrief: [
      L('ozzy', 'Coupler, tubes, a linear amp. Three hours and I\'ll have a real station. With a mast!'),
      L('deke', 'A mast means the roof. Don\'t lean on it. I know you. You lean on things.'),
      L('ozzy', 'Haven, Haven, this is KD9-OZZ. Radio check.'),
      L('warden', 'KD9-OZZ, Haven. Loud and clear. You sound better. You sound like you\'re in the room.'),
      L('ozzy', 'It\'s the tubes!'),
      L('warden', 'Copy tubes. How\'s the road?'),
      L('ozzy', 'Long.'),
      L('warden', 'Long. Okay. Thank you for coming. Warden out.'),
      L('mara', 'She said thank you for coming. Not thank you for calling.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_hauler', index: 5, opens: 2, title: 'Night Hauler',
    blurb: 'Dutch Kessler owns the last working diesel pump for fifty miles and will share, for a fee, if someone walks him and six barrels through the dark.',
    map: 'truckstop', time: 'night', mode: 'free', level: [4, 6], party: { min: 1, max: 6 },
    requires: ['sj_diner'], hub: 'roadhouse',
    briefing: [
      L('quill', 'Rumor two, as promised, and worth every penny of the first. His name is Dutch Kessler. He ran the Mile Marker crew out of the truck lot. Ran. They left. He did not.'),
      L('quill', 'He is sitting on a tanker of diesel and the last live pump in fifty miles. He will trade fuel for protection.'),
      L('deke', 'The tanker won\'t run, the engine is cooked. He wants to hand-carry barrels to the north road.'),
      L('mara', 'How much do we need?'),
      L('deke', 'Enough to run the motel for a month. Or a heavy truck for two hundred miles.'),
      L('dutch', 'I can hear you talking about my diesel! That\'s MY diesel! That\'s gonna cost you!'),
      L('ozzy', 'Hi! Sir! Can I say I love your handle? "Big Dutch."'),
      L('dutch', 'It\'s Dutch. Not Big. Never Big. Kid, how did you get on my channel?'),
      L('ozzy', 'It is... a gift.'),
      L('dutch', 'Fine. Escort me and six barrels from the pumps to the north road. Night only. Daylight is for people who can afford to be seen.'),
      L('mara', 'Deal.'),
      L('dutch', 'It isn\'t a deal. It\'s an invoice.'),
    ],
    steps: [
      {
        id: 'meet', type: 'reach', at: 'pumps', text: 'Meet Dutch at the pumps', pressure: P(3, 0.3),
        onDone: [say('dutch', 'You\'re late. Everything is a toll, but lateness is double.')],
      },
      {
        id: 'terms', type: 'dialogue', lines: [
          L('dutch', 'Six barrels. One hand truck. My back, your guns. Nobody touches the diesel but me.'),
          L('dutch', 'I want it on the record that this isn\'t a favor. Favors are how people get comfortable.'),
          L('ozzy', 'I wrote it on my arm!'),
          L('dutch', '...Is that kid on my channel again? Fine. Pump first. Try not to be slow about it. I\'ve been slow all my life.'),
        ],
      },
      {
        id: 'fill', type: 'activate', at: ['pumps'], hold: 12, text: 'Run the pump and fill the barrels (hold E)', pressure: P(3, 0.8, ['crawler']),
        onStart: [say('dutch', 'Twenty gallons a barrel. You crank slower than a Tuesday.')],
        onDone: [say('dutch', 'Six barrels. That\'s eleven hundred dollars of diesel and I\'m giving it away and I hate it.')],
      },
      {
        id: 'legA', type: 'escort', npc: 'dutch', route: ['pumps', 'truckLot'], text: 'Escort Dutch and his hand truck: leg 1', pressure: P(3, 0.7, ['runner']),
        onStart: [say('dutch', 'Keep up. Keep in front. Keep the barrels level. Don\'t let anything bite the barrels.')],
      },
      {
        id: 'stack', type: 'survive', seconds: 30, text: 'The container stack is coming down: get clear!', pressure: P(3, 1.5, ['crawler']),
        onStart: [say('dutch', 'That wasn\'t me. That was wind.')],
        onDone: [say('dutch', 'Very strong wind. Very strong. Moving on.')],
      },
      kill('carpet', 'crawler', 8, 'Crawlers under the trailers (0/8)', {
        parallel: true, pressure: P(3, 0.6, ['crawler']),
        onStart: [say('dutch', 'Down low! They\'re under the trailers! Cover my ankles!')],
      }),
      {
        id: 'legB', type: 'escort', npc: 'dutch', route: ['truckLot', 'trailerB', 'roadNorth'], text: 'Escort Dutch and his hand truck: leg 2', pressure: P(3, 0.7, ['runner', 'crawler']),
      },
      {
        id: 'handoff', type: 'reach', at: 'roadNorth', hold: 6, text: 'Hand the fuel over to Deke', pressure: P(3, 0.4),
        onStart: [radio('deke', 'I can see you. Bring my diesel, and bring the man who doesn\'t like me.'), radio('dutch', 'I don\'t dislike you. I dislike everyone. It isn\'t personal.')],
        onDone: [say('dutch', 'Sign here. Not here. Here. There.')],
      },
    ],
    bonus: [noteStep('n08', 'trailerB', 'Search Dutch\'s cab for his ledger (optional)', 'legA')],
    rewards: { xp: 260, scrap: 75, weapon: 'dual_smg', upgradePoints: 1, flags: { met_dutch: true, fuel_secured: true }, unlockNpc: 'dutch' },
    debrief: [
      L('dutch', 'Tell nobody I cried.'),
      L('deke', 'You didn\'t cry.'),
      L('dutch', 'Then tell nobody.'),
      L('dutch', 'My crew left on Day 12. Took the trucks. Said the lake was the only place with a future. I said I\'d follow. I lied. I don\'t do lakes.'),
      L('mara', 'Then come with us.'),
      L('dutch', 'I\'m not coming with you. I\'m coming with my diesel. There\'s a difference. I\'ll bill you for the ride.'),
      L('ozzy', 'He\'s coming.'),
      L('deke', 'He\'s coming.'),
      L('dutch', 'Stop looking at me like that.'),
    ],
    stars: { time: 720, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ============================================================================ opens in chapter 3
  {
    ...SIDE, id: 'sj_crossing', index: 6, opens: 3, title: 'The Crossing',
    blurb: 'The Blackwater bridge is closed to trucks, not to people: a dead army APC sits in the middle of the cracked span. It still has armour, a radio and an engine that Priya swears will turn over.',
    map: 'bridge', time: 'day', mode: 'defend', level: [8, 9], party: { min: 1, max: 6 },
    requires: ['m3_2'], hub: 'depot',
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. MORNING.'),
      L('priya', 'I was surveying the Blackwater bridge on Day 30 when the middle span cracked. The APC was already dead on it. It\'s still there.'),
      L('priya', 'Armour plate, an army radio and a diesel engine. The span won\'t take a convoy. It\'ll take one APC, driven gently, by me.'),
      L('deke', 'You want to repair an army vehicle in the middle of a broken bridge.'),
      L('priya', 'I want to repair it while you stop the county from eating me. Fuel line, track links, then the crank. Three jobs.'),
      L('mara', 'Both banks will hear it.'),
      L('priya', 'Both banks always hear it. It\'s a funnel and you\'re the cork. Try to be a good cork.'),
      { ...L('okafor', 'If it is army, it has a radio that can talk to anyone. Bring me that radio.'), when: { done: ['m4_2'] } },
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
        onStart: [radio('priya', 'They come from both banks. Be a good cork.')],
      },
      {
        id: 'repair2', type: 'activate', at: ['apc'], hold: 12, text: 'Repair the APC: track links (hold E)', pressure: P(4, 1.0, ['spitter']),
        onStart: [radio('priya', 'East bank! Spitters. Stay out of the puddles and use cover, they only hit what they can see.')],
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
        id: 'board', type: 'reach', at: 'bankE', hold: 4, text: 'Bring the APC home to the depot bank', pressure: P(4, 0.4),
        onDone: [radio('priya', 'Everyone on. Hold on to something. I haven\'t tested the brakes.')],
      },
    ],
    bonus: [noteStep('n09', 'apc', 'Read the order taped inside the APC (optional)', 'cross')],
    rewards: { xp: 330, scrap: 90, weapon: 'dmr', upgradePoints: 1, flags: { apc_running: true } },
    debrief: [
      L('priya', 'One armoured personnel carrier, parked in the depot yard, with a working radio. I\'m not attached to it. I\'ve named it.'),
      L('mara', 'What did you name it?'),
      L('priya', 'The Cork.'),
      { ...L('okafor', 'An army radio. Long range. Ruiz will cry.'), when: { done: ['m4_2'] } },
      { ...L('ozzy', 'An army radio! Long range! I\'m going to cry!'), when: { notDone: ['m4_2'] } },
      L('deke', 'There was a battle rifle clipped inside the hatch. The army leaves things in the strangest places.'),
      L('priya', 'The bridge is on my map twice now. Once for falling, once for giving something back.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_cargo', index: 7, opens: 3, title: 'Sunken Cargo',
    blurb: 'A barge went aground under the Blackwater bridge on Day 4 with its cargo still aboard. Someone\'s dog is in there. So, apparently, is a part the ferry was waiting for.',
    map: 'bridge', time: 'night', mode: 'free', level: [8, 9], party: { min: 1, max: 6 },
    requires: ['m3_2'], hub: 'depot',
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. DUSK.'),
      L('priya', 'My map has a mark under the bridge span. "Barge, grounded, unexplored, smells like regret."'),
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
          radio('warden', 'Thank you. It\'s a spare, Grandpa said. Spares are how you keep a boat alive. Warden out.', 4200),
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
    rewards: { xp: 340, scrap: 95, weapon: 'crossbow', upgradePoints: 1, flags: { marine_pump: true, met_wendell: true }, unlockNpc: 'wendell' },
    debrief: [
      L('priya', 'There\'s a shipping tag on the pump. Consignee: Lake Harlan Harbor Authority. For the ferry Halcyon.'),
      L('deke', 'A spare marine pump, and the injectors from the yard on top. That boat is going to be the best-kept engine on the lake.'),
      L('wendell', 'I\'d like to come along, if that\'s all right. I\'ll bring the leash either way.'),
      L('wendell', 'Some things you carry so that your hands remember. Good crew.'),
      L('deke', 'That man talks to us like a good dog.'),
      L('mara', 'It\'s working, Deke.'),
      L('deke', '...It\'s a little bit working.'),
    ],
    stars: { time: 780, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ============================================================================ opens in chapter 4
  {
    ...SIDE, id: 'sj_tower', index: 8, opens: 4, title: 'Hold the Tower',
    blurb: 'Checkpoint Delta\'s radio tower can throw a signal three hundred miles, and its transmitter needs one quiet night to come back online. Okafor wants her old post on the air.',
    map: 'checkpoint', time: 'night', mode: 'defend', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['m4_2'], hub: 'depot',
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. MORNING.'),
      L('okafor', 'Delta\'s tower reaches the lake without the hiss. My techs need one quiet night to bring the transmitter back. I need someone to make it quiet.'),
      L('ozzy', 'A tower that reaches the lake means the Warden hears us clean. Clear! No more "um, you\'re breaking up"!'),
      L('mara', 'You left Delta for a reason, Sergeant.'),
      L('okafor', 'I left Delta with eleven soldiers and no fuel. I go back with a train and your crew. Different arithmetic.'),
      L('danny', 'Ma\'am, the crackers are still in the tower. I left a whole box. For emergencies.'),
      L('okafor', 'Then it will be an emergency, Ruiz.'),
      L('deke', 'Take ammunition. I mean it. Her soldiers have started throwing crackers.'),
    ],
    steps: [
      {
        id: 'gate', type: 'reach', at: 'gate', text: 'Reach the Checkpoint Delta gate', pressure: P(5, 0.35),
        onDone: [say('okafor', 'Delta. It looks smaller when you come back to it.')],
      },
      {
        id: 'post', type: 'dialogue', lines: [
          L('okafor', 'The tower is in the center. Tech crew needs it alive until dawn.'),
          L('danny', 'Transmitter at zero percent, ma\'am! That\'s the most room for improvement I\'ve ever seen!'),
          L('okafor', 'Hold the gate, hold the crossroads, and do not let anything touch the base of that tower.'),
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
    rewards: { xp: 380, scrap: 110, weapon: 'lmg', upgradePoints: 1, flags: { tower_held: true } },
    debrief: [
      L('okafor', 'Delta is on the air. Three hundred miles, clean. I did not think I would hear that tower again.'),
      L('okafor', 'Eleven at the depot. Five on the ridge. Sixteen. I say it out loud every morning so somebody knows.'),
      L('mara', 'Does it help?'),
      L('okafor', 'It helps me. It is not required to help anyone else.'),
      L('danny', 'The crackers were still there, ma\'am. The whole box.'),
      L('okafor', 'Then the emergency is over, Ruiz.'),
      L('deke', 'There was a light machine gun on the tower platform. Nobody\'s using it. Now somebody is.'),
    ],
    stars: { time: 960, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_line', index: 9, opens: 4, title: 'Broken Line',
    blurb: 'Delta\'s tower is on the air, but its three generators are cold and the floodlights are dark. Start them by hand, one at a time, while the whole county listens.',
    map: 'checkpoint', time: 'day', mode: 'free', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['sj_tower'], hub: 'depot',
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. MORNING.'),
      L('okafor', 'The tower works. The line does not. Delta\'s three generators went cold on Day 19, and without them the floodlights and the relay sit in the dark.'),
      L('okafor', 'Three generators: one at the gate, one in the compound, one on the hill. Manual start, hold the crank, and every one of them is loud.'),
      L('danny', 'I can help! I can carry things! I carry a radio that weighs forty pounds and my sense of hope!'),
      L('okafor', 'Private Ruiz.'),
      L('danny', 'Sense of duty, ma\'am.'),
      L('mara', 'Loud means company.'),
      L('okafor', 'It does. That is why I am sending your crew. Ruiz goes as your radio, since he carries it anyway.'),
      L('deke', 'And bring me the regulator off generator C. Army regulators are built like bank vaults. The ferry deserves a spare.'),
    ],
    steps: [
      {
        id: 'enter', type: 'reach', at: 'compound', text: 'Cross the dark compound to the fuel dump', pressure: P(6, 0.35),
        onStart: [radio('danny', 'All three generators are dry. Sarge says there\'s a fuel dump in the compound. And crackers. Mostly fuel.')],
      },
      {
        id: 'fuel', type: 'collect', item: 'fuel', count: 3, at: ['compound', 'gate', 'hill'], text: 'Fill three jerry cans from the fuel dump (0/3)', pressure: P(6, 0.5),
        onDone: [radio('danny', 'Three cans! That\'s a generator each! It\'s like Christmas, if Christmas was diesel!')],
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
        onDone: [radio('danny', 'THREE! Floodlights! All of them! Ma\'am, you can see the whole checkpoint!')],
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
          radio('danny', 'Ma\'am... I mean. Sorry. Copy. Not a ma\'am. Noted!', 3200),
        ],
      },
    ],
    bonus: [noteStep('n13', 'genC', 'Check the generator shed on the hill (optional)', 'genB')],
    rewards: { xp: 390, scrap: 110, weapon: 'auto_shotgun', upgradePoints: 1, flags: { generators_online: true, delta_regulator: true } },
    debrief: [
      L('danny', 'Reporting, ma\'am, I mean everyone. The floodlights are on at Delta and I didn\'t get killed.'),
      L('okafor', 'Private.'),
      L('danny', 'She said "don\'t get killed," ma\'am. It\'s the nicest thing she has ever said to me.'),
      L('okafor', 'It was an order.'),
      L('danny', 'It was very nice, ma\'am.'),
      L('deke', 'Generator C\'s regulator is on my bench. Marine grade. Somebody at Delta had the same idea as us, just earlier.'),
      L('mara', 'Take it with us. Spares are how you keep a boat alive. Wren\'s grandfather said so.'),
    ],
    stars: { time: 840, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_ghosts', index: 10, opens: 4, title: 'Ghosts',
    blurb: 'Five soldiers went up the ridge above Delta on Day 10 and never came back. Something enormous now walks the hill at night wearing their boots. Bring them home.',
    map: 'checkpoint', time: 'night', mode: 'free', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['m4_2'], hub: 'depot',
    briefing: [
      L('narrator', 'DAY {day}. BLACKWATER DEPOT. NIGHT.'),
      L('danny', 'Sarge? The ridge pinged again. Same as the last three nights.'),
      L('okafor', 'Show me.'),
      L('danny', 'Ghost Six. Faint. Squad frequency. Not a voice. A signal. Like a heartbeat.'),
      L('okafor', 'Ghost squad went out on the tenth day. Five soldiers, four rifles, one radio, and a promise to be back by dark.'),
      L('mara', 'They didn\'t come back.'),
      L('okafor', 'They did not. I have counted them every morning since.'),
      L('okafor', 'Something big walks that ridge at night, Doc. And it wears our boots.'),
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
    rewards: { xp: 400, scrap: 120, weapon: 'flare', upgradePoints: 1, flags: { ghosts_laid_to_rest: true } },
    debrief: [
      L('okafor', 'Eleven with the convoy. Five at rest. I will keep saying sixteen. But I will say it differently now.'),
      L('okafor', 'Eleven who came home, five who are home. Sixteen.'),
      L('danny', 'Sarge, do you think Kip is mad I brought the crackers?'),
      L('okafor', 'I think Kip would have wanted the crackers.'),
      L('danny', 'He said save him a seat.'),
      L('okafor', '...Then we will save him a seat.'),
      L('mara', 'That\'s the kindest order I\'ve ever heard you give.'),
      L('okafor', 'It was not an order. We just do the next thing, in the right order.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ============================================================================ opens in chapter 5
  {
    ...SIDE, id: 'sj_interstate', index: 11, opens: 5, title: 'Down the Interstate',
    blurb: 'Fifty miles of open county and a safe zone that will not stand still. Run the interstate from the farm to Main Street, one refuge to the next, for the fuel and food the lake road will need.',
    map: 'harlan', time: 'day', mode: 'zone', level: [12, 13], party: { min: 1, max: 6 },
    requires: ['m5_2'], hub: 'farmstead',
    briefing: [
      L('narrator', 'DAY {day}. HARLAN FARMSTEAD. MORNING.'),
      L('priya', 'The convoy needs one more tank of fuel and three days of food before the lake road. The interstate has both, in pieces.'),
      L('deke', 'Harlan County. Named for my great-granddad. He won it in a card game and lost it in the next one. Don\'t touch anything, it\'s all mortgaged.'),
      L('okafor', 'The interstate is the fastest route and the worst. Nothing on it is friendly and nothing moves in a straight line. Keep moving.'),
      L('priya', 'Four stops. The interchange, the quarry, the Gas-N-Go, Main Street. Everything between them is open ground.'),
      L('okafor', 'Every safe zone shrinks. Do not linger.'),
      L('june', 'Miss Priya? Can I hold the map?'),
      L('priya', 'You can hold it. You can\'t draw on it.'),
      L('june', 'I\'d draw on it nicely.'),
      L('priya', 'That\'s what they all say.'),
    ],
    steps: [
      {
        id: 'radio1', type: 'wait', seconds: 50, parallel: true,
        onDone: [radio('okafor', 'Screamers on your flank! Pale ones. Kill them first or the rest will double their speed.')],
      },
      {
        id: 'radio2', type: 'wait', seconds: 140, parallel: true,
        onDone: [radio('deke', 'The Gas-N-Go sign is on fire. Just so you know. Not my fault. I wasn\'t there.')],
      },
      {
        id: 'radio3', type: 'wait', seconds: 230, parallel: true,
        onDone: [radio('warden', 'KD9-OZZ, Haven. The storm front is on the barometer. It\'s close. Please don\'t be long.')],
      },
      {
        id: 'run', type: 'evac', stops: ['i70Interchange', 'millerQuarry', 'gasNGo', 'mainStreet'], text: 'Run the interstate: reach each safe zone',
        pressure: P(5, 0.9, ['spitter']),
        onStart: [radio('priya', 'First stop, the interchange. The zone will move. Stay inside it, or the fog will take its cut.')],
      },
      kill('brutes', 'brute', 2, 'Two Brutes hold Main Street (0/2)', {
        at: 'mainStreet', pressure: P(6, 0.5),
        onStart: [radio('okafor', 'Main Street. Two large contacts holding the middle of the road. Nothing here is subtle.')],
      }),
      {
        id: 'regroup', type: 'reach', at: 'mainStreet', hold: 6, text: 'Regroup on Main Street', pressure: P(5, 0.3),
        onDone: [radio('priya', 'Main Street. Population: us. The trucks can load here and go home.')],
      },
    ],
    bonus: [noteStep('n16', 'i70Interchange', 'Look at the overpass sign (optional)', 'run')],
    rewards: { xp: 420, scrap: 130, weapon: 'hmg', upgradePoints: 1, flags: { interstate_cleared: true } },
    debrief: [
      L('priya', 'Main Street. I\'m entering it in the book. Population: us.'),
      L('mara', 'That\'s a joke.'),
      L('priya', 'It\'s a map entry.'),
      L('june', 'The sign said forty-one miles to the water. Forty-one is the day you found our bus.'),
      L('ozzy', 'June. Nobody else noticed that. Nobody.'),
      L('june', 'I count things. It\'s my whole personality.'),
      L('okafor', 'Fuel and food for the lake road. The convoy is ready. We only need a morning.'),
    ],
    stars: { time: 720, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },

  // ------------------------------------------------------------------------------------------
  {
    ...SIDE, id: 'sj_hospital', index: 12, opens: 5, title: 'Field Hospital',
    blurb: 'An army field hospital on the east side of the county: tents full of patients and a pharmacy full of what a boat full of children will need. Something large has been feeding there.',
    map: 'harlan', time: 'night', mode: 'free', level: [12, 13], party: { min: 1, max: 6 },
    requires: ['m5_2'], hub: 'farmstead',
    briefing: [
      L('narrator', 'DAY {day}. HARLAN FARMSTEAD. DUSK.'),
      L('mara', 'There\'s a field hospital on the east side. Army tents, medical crates and, if the radio is right, a surgeon with a beard and a stubborn streak.'),
      L('ozzy', 'Dr. Ellery. He\'s been on a loop asking for anyone with a truck, a generator, or a sense of humor.'),
      L('mara', 'We have two out of three.'),
      L('deke', 'We have a truck.'),
      L('mara', 'I spent six years in an ER. I know what a field hospital looks like at the end. It looks like a hand held out.'),
      L('priya', 'I mapped the route. Six crates split between the tents and Main Street\'s pharmacy.'),
      L('okafor', 'Move quickly. Something large has been feeding at that hospital. My scouts found the tracks.'),
      L('mara', 'I know. Let\'s go.'),
    ],
    steps: [
      {
        id: 'approach', type: 'reach', at: 'fieldHospital', text: 'Cross town to the field hospital', pressure: P(6, 0.4),
        onStart: [radio('ozzy', 'Dr. Ellery says: come in through the ambulance bay. He says: mind the tent flaps. He says: they all look asleep.')],
      },
      {
        id: 'gather1', type: 'collect', item: 'medkit', count: 3, at: ['mainStreet', 'fieldHospital'], text: 'Search the pharmacy and tents (0/3)', pressure: P(6, 0.5, ['spitter']),
        onDone: [radio('mara', 'Antibiotics, gauze, insulin. I could weep. Not now. Later.')],
      },
      {
        id: 'triage', type: 'reach', at: 'fieldHospital', hold: 45, text: 'Hold the triage circle while patients are moved', pressure: P(7, 0.8, ['screamer']),
        onStart: [radio('mara', 'Patients are being moved to the trucks. Forty-five seconds. Don\'t let anything through the circle.')],
        onDone: [radio('mara', 'Trucks loaded. Every patient who could walk, walked.')],
      },
      {
        id: 'gather2', type: 'collect', item: 'medkit', count: 3, at: ['fieldHospital', 'mainStreet'], text: 'Load the medical crates (0/3)', pressure: P(7, 0.6, ['bloater']),
        onDone: [radio('mara', 'Wait. Do you feel that? The ground is... something is coming.')],
      },
      boss('abomination', 'Bring down the Abomination', {
        pressure: P(7, 0.4),
        onStart: [
          radio('mara', 'That isn\'t a patient.'),
          radio('priya', 'Definitely not a patient.'),
          radio('okafor', 'It is slow. Use the slow. Keep moving, never stand still, and hit it with everything you have.'),
        ],
        onDone: [radio('okafor', 'Target down. Twice now. I am starting to dislike that phrase.')],
      }),
      {
        id: 'lead', type: 'reach', at: 'haskellFarm', text: 'Lead the trucks back to the Haskell farm', pressure: P(5, 0.3),
        onDone: [radio('deke', 'Barn\'s full of patients, and Roz is making soup for thirty. Good night\'s work.')],
      },
    ],
    bonus: [
      noteStep('n17', 'fieldHospital', 'Read the chart at the triage desk (optional)', 'approach'),
      noteStep('n18', 'mainStreet', 'Check the pharmacy counter (optional)', 'approach'),
      {
        id: 'ward', type: 'activate', at: ['fieldHospital'], hold: 10, text: 'Unlock the isolation ward (optional)', since: 'gather1',
        flags: { saved_patients: true }, todo: 'stepFlags',
        onDone: [radio('mara', 'Three more. Behind the locked door. They\'ve been in there for weeks. Get them to the trucks!')],
      },
    ],
    rewards: { xp: 440, scrap: 140, weapon: 'cryo', upgradePoints: 1, flags: { hospital_saved: true, med_supplies: true } },
    debrief: [
      L('mara', 'Twenty-eight on the trucks. Twenty-eight who weren\'t going to see the boat.'),
      L('june', 'Are you counting, Miss Mara?'),
      L('mara', 'No.'),
      L('june', 'You said twenty-eight.'),
      L('mara', 'I said... twenty-eight. Yes.'),
      L('june', 'Ms. Delaney said counting is how you keep people from disappearing.'),
      L('mara', 'She did, didn\'t she. She wrote it on a wall once, in a way.'),
      L('mara', 'Then I suppose I\'ll count.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,side',
  },
];
