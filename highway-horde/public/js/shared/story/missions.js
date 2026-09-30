// ROAD TO HAVEN — the fifteen missions, the six chapters, the three hideouts and the finale.
// Pure data (STORY.md §5.4). The mission files live in ./missions/ch1..ch6.js; this module puts them
// in campaign order and adds the chapter cards, hideout arrival scenes and the epilogue.
//
// The graph (see index.js nextNodes):
//   m1_1 -> m1_2 -> m1_3 => [Roadhouse] -> m2_1 -> {m2_2, m2_3} (either order, back to the Roadhouse
//   after each) -> m3_1 -> m3_2 => [Depot] -> m4_1 -> m4_2 -> m4_3 (back to the Depot after each)
//   -> m5_1 -> m5_2 => [Farmstead] -> m6_1 -> m6_2 => epilogue
// `=>` = a hideout arrival scene; plain `->` between road missions has no hub.
// Mission fields beyond STORY.md §5.4 (`requires`, `hub`, `after`, `bonus`) are listed in
// TODO_REQUESTS (missions/lib.js).
//
// Scenes are arrays of { who, text }. A scene line may carry `when: { flags:[...], notFlags:[...] }`;
// the dialogue player skips lines whose condition fails. Nothing else in a scene is conditional.

import { L } from './missions/lib.js';
import { NOTES, NOTE_IDS } from './missions/notes.js';
import { CH1 } from './missions/ch1.js';
import { CH2 } from './missions/ch2.js';
import { CH3 } from './missions/ch3.js';
import { CH4 } from './missions/ch4.js';
import { CH5 } from './missions/ch5.js';
import { CH6 } from './missions/ch6.js';

export { NOTES, NOTE_IDS };
export { TODO_REQUESTS, ITEM_KINDS, STEP_TYPES, ANCHORS } from './missions/lib.js';

/** The fifteen missions in campaign order. Each also gets `notes`: the ids of the lore notes hidden in it. */
export const MISSIONS = [...CH1, ...CH2, ...CH3, ...CH4, ...CH5, ...CH6];
for (const m of MISSIONS) m.notes = (m.bonus || []).filter((s) => s.item === 'note').map((s) => s.note);

// ---- hideouts ----------------------------------------------------------------------------------
/** Hub maps are built by S3 as buildMap(id); `residents` are NPCs who live there from the first visit. */
export const HIDEOUTS = {
  roadhouse: {
    id: 'roadhouse', name: 'The Roadhouse', kind: 'motel', firstChapter: 1, lastChapter: 3, residents: ['roz', 'june'],
    blurb: 'A two-storey highway motel with sixteen rooms, a working kitchen and a sign that reads NO VAC. Home for chapters one and two.',
  },
  depot: {
    id: 'depot', name: 'Blackwater Depot', kind: 'rail depot', firstChapter: 3, lastChapter: 5, residents: [],
    blurb: 'A rail yard on the far side of the river: a signal tower, a machine shop, two dry boxcars and a stove. Home for chapters three and four.',
  },
  farmstead: {
    id: 'farmstead', name: 'Harlan Farmstead', kind: 'farm', firstChapter: 5, lastChapter: 6, residents: [],
    blurb: 'The Haskell place: a barn that stands, a house with a roof and a milk shed for the generator. The last night before the lake.',
  },
};

// ---- arrival scenes (one per hideout, played on the first visit) -------------------------------
const ARRIVE_ROADHOUSE = [
  L('narrator', 'DAY 44. THE ROADHOUSE MOTEL, MILE MARKER 71.'),
  L('roz', 'Sixteen rooms, twelve mattresses, one cook. No refunds, no pets, no exceptions. Wipe your boots. I mean it.'),
  L('mara', 'We have fourteen children, a medic and a very large tow truck.'),
  L('roz', 'Then you want the rooms with bathtubs. Hon, is that a tow truck in my parking lot?'),
  L('deke', 'Emergency vehicle.'),
  L('roz', 'It\'s leaking on my lot.'),
  L('deke', 'It\'s leaking on your lot, and you\'re welcome.'),
  L('june', 'Can I have the room with the bee on the door?'),
  L('roz', 'That room has a bee on the door because the last guest was afraid of bees. You can have it, sweetheart. The bee is on the house.'),
  L('ozzy', 'Everyone shush! Shush! It\'s happening again!'),
  L('warden', 'Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you can carry.'),
  L('ozzy', 'Same words. Same three-second pause after "month." And there. The cough. Nobody records a cough.'),
  L('mara', 'It\'s a loop, Ozzy.'),
  L('ozzy', 'Loops don\'t clear their throats.'),
  L('deke', 'How far is the lake?'),
  L('ozzy', 'Two hundred miles. Give or take a bridge.'),
  L('mara', 'Then we rest. Tomorrow we find out what this place can be.'),
  L('roz', 'Tomorrow I find out what you people eat. Sit.'),
];

const ARRIVE_DEPOT = [
  L('narrator', 'DAY 49. BLACKWATER DEPOT. A RAIL YARD, SIX BUILDINGS, ONE ROOF THAT DOES NOT LEAK.'),
  L('priya', 'Signal tower, water tank, machine shop, two boxcars and an office with a stove. It isn\'t a hotel. But it has doors.'),
  L('roz', 'It has a stove. I forgive it everything.'),
  L('deke', 'The machine shop has a lathe. A LATHE. Give me a lathe and a week and I\'ll build you a second engine.'),
  L('quill', 'May I present the Depot Bazaar, opening tomorrow? Three lamps, a vase, and something I found that may be a kidney.'),
  L('mara', 'Please don\'t put that anywhere near the infirmary.'),
  L('wendell', 'The boxcars are dry. I\'ve put down blankets. And a bowl. Habit.'),
  L('mara', 'Wendell...'),
  L('wendell', 'Good habit. Never hurt anybody.'),
  L('ozzy', 'New signal! Army band! Somebody keeps saying "any civilian station."'),
  L('okafor', 'Civilian station, this is Checkpoint Delta. Anyone on band six? I have a tower and nobody to talk to.'),
  L('ozzy', 'Sergeant Okafor! Hi! I\'m Ozzy! I love your tower!'),
  L('okafor', 'Copy. Stand by, civilian. I will call back.'),
  L('priya', 'She sounds terrifying.'),
  L('mara', 'She sounds tired. That\'s different.'),
  L('deke', 'Same thing, in my experience.'),
];

const ARRIVE_FARMSTEAD = [
  L('narrator', 'DAY 57. HASKELL FARM. THE LAST HIDEOUT.'),
  L('deke', 'Barn is sound. House has a roof. I\'m putting the generator in the milk shed.'),
  L('roz', 'This kitchen is bigger than the Roadhouse\'s. I may weep. I won\'t weep. I have soup.'),
  L('ozzy', 'Everyone, everyone, come here. Gather round the tailgate. I did the math.'),
  L('ozzy', 'Fuel: Dutch\'s diesel, six barrels. A marine injector pump from the barge. A regulator from Delta\'s generator. A real radio. And a truckload of medical crates.'),
  L('priya', 'That\'s a ferry\'s worth of parts.'),
  L('deke', 'We\'ve been shopping for a boat for two weeks and didn\'t know it.'),
  L('dutch', 'I\'d like it noted that I didn\'t know it either.'),
  L('ozzy', 'The Warden never asked for any of it. She only said "bring what you can carry."'),
  L('mara', 'Maybe that\'s all Haven ever was. A list of what people bring.'),
  L('priya', 'Then the map is finished. Sixteen places. Seventeen, counting this one.'),
  L('june', 'You\'re keeping this one?'),
  L('priya', '...I\'m writing it down. Writing it down isn\'t keeping it.'),
  L('june', 'It\'s a little bit keeping.'),
  L('priya', 'It\'s a very little bit.'),
  L('okafor', 'Convoy leaves at dawn on the lake road. Non-shooters by truck. Shooters take the ridge and draw the dead.'),
  L('danny', 'Ma\'am, what do we call the ridge?'),
  L('okafor', 'Radio Hill.'),
  L('danny', 'Ma\'am, that sounds like a place where someone plays music.'),
  L('okafor', 'Ruiz, it is a hill. It has a radio. Do not name the hill.'),
];

// ---- the finale -----------------------------------------------------------------------------
export const EPILOGUE = [
  L('narrator', 'DAY 58. THE FERRY HALCYON. THE LAKE, AT SUNSET.'),
  L('wren', 'Is everyone... is everybody accounted for? Sorry. I don\'t know the word. Is there a word?'),
  L('okafor', 'Muster, Miss Alcott. The word is muster.'),
  L('wren', 'Muster. Okay. Sergeant, would you?'),
  L('okafor', 'With pleasure. All hands, call out.'),
  L('mara', 'Here.'),
  L('deke', 'Here. Regrettably.'),
  L('ozzy', 'Here! Present! KD9-OZZ, present and accounted for!'),
  L('priya', 'Here. Provisionally.'),
  L('dutch', 'Present. And billing.'),
  L('quill', 'Present, madam, and available for parties.'),
  { ...L('wendell', 'Present. And so is somebody with a very strong opinion about the word "stay."'), when: { flags: ['found_biscuit'] } },
  { ...L('narrator', 'From below deck, a bark.'), when: { flags: ['found_biscuit'] } },
  { ...L('wendell', 'Present. Leash in my pocket. Habit.'), when: { notFlags: ['found_biscuit'] } },
  L('danny', 'Here, ma\'am! Also for Kip!'),
  L('okafor', 'Also for Kip. And Ramos. And Adeyemi.'),
  L('june', 'Here! I\'m the smallest, but I counted, and I\'m here!'),
  L('roz', 'Here, and supper in ten minutes. Nobody is allowed to be sad on an empty stomach.'),
  L('wren', 'That\'s everyone. That\'s everyone.'),
  L('mara', 'Wren. Do you keep a list?'),
  L('wren', 'The manifest. Everyone who reached the water. Grandpa started it. I finished it. Two hundred and twelve names went across before me.'),
  L('wren', 'I keep it in case someone asks. Nobody comes back to ask.'),
  L('june', 'Is Ms. Delaney on it?'),
  L('wren', 'Ruth Delaney. Teacher. Day eight, second boat, with a Mr. Abernathy who drove a bus. She asked for a yellow bus at the pier every single day.'),
  L('june', 'I told her I\'d stay put. I counted to a thousand three times.'),
  L('mara', 'You did. You stayed.'),
  { ...L('june', 'You can keep the green cap. It worked.'), when: { flags: ['june_lucky_cap'] } },
  L('deke', 'Would there be a Harlan on that list?'),
  L('wren', 'Harlan. Harlan... Calvin. Cal. Day fourteen, third boat. Mechanic\'s apprentice. He fixed our generator with a hairpin and told everybody his dad could do it better.'),
  L('deke', '...'),
  L('deke', 'He\'s right. I can.'),
  L('ozzy', 'I\'ve got a player, Deke. It\'s been in my bag for days. I was waiting for the right moment.'),
  L('deke', 'I never played it. I was afraid it said goodbye.'),
  L('ozzy', 'This is the right moment. Right?'),
  L('cal', 'Dad, it\'s me. I know you\'re at the shop, so don\'t be. Go where the people are, okay? I\'ll find you. I love you. Bye. And don\'t play side B, it\'s just me singing.'),
  L('deke', 'He can\'t carry a tune in a bucket.'),
  L('deke', 'Side B.'),
  L('cal', 'Ninety-nine bottles of oil on the wall, ninety-nine bottles of oil...'),
  L('deke', 'Terrible. Absolutely terrible.'),
  L('wren', 'The crossing is four hours, sir. He\'s on the north shore.'),
  L('deke', 'Four hours. I can do four hours. I\'ve done fifty-six days.'),
  L('mara', 'Wren. How many are aboard?'),
  L('wren', 'Counting... counting all of you... ninety-one.'),
  L('mara', 'I stopped counting the ones I lost on day nine. I count the ones on the boat now. It\'s a much better hobby.'),
  L('priya', 'Eighteen places. Counting this boat.'),
  L('june', 'You\'re keeping it!'),
  L('priya', 'It moves. Maps don\'t have to hold still to be kept.'),
  L('ozzy', 'Wren. What do we say now? Do we say Haven is open?'),
  L('wren', 'It\'s your speech, too.'),
  L('ozzy', 'It\'s yours. It always was.'),
  L('wren', 'Haven is open. It\'s a boat, and ninety-one people, and a lot of strong opinions. Bring what you can carry.'),
  L('narrator', 'ROAD TO HAVEN'),
];

// ---- chapters ------------------------------------------------------------------------------------
/**
 * Chapter cards + the hideout arrival scenes.
 *   hub          hideout the missions of this chapter start from (null = they chain along the road)
 *   endsAt       hideout id of the arrival scene that follows the chapter (null = none / the epilogue)
 *   arrival      { hideout, flag, scene } - played on the first visit; `flag` is set once seen
 */
export const CHAPTERS = [
  {
    n: 1, id: 'ch1', title: 'Dead Highway', subtitle: 'Highway 9, forty miles from anywhere', map: 'highway', time: 'night',
    card: 'Day 41. A school bus in a pileup, a voice on the radio, and a night that does not end quickly.',
    epigraph: L('warden', 'Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you can carry.'),
    missions: ['m1_1', 'm1_2', 'm1_3'], hub: null, endsAt: 'roadhouse',
    arrival: { hideout: 'roadhouse', flag: 'seen_arrival_roadhouse', scene: ARRIVE_ROADHOUSE },
  },
  {
    n: 2, id: 'ch2', title: 'Last Chance', subtitle: 'A truck stop in the desert', map: 'truckstop', time: 'night',
    card: 'The Roadhouse is a home now. A home needs parts, fuel and one or two friends who are not entirely reasonable.',
    epigraph: L('quill', 'The first rumor is free. The second costs the value of the first.'),
    missions: ['m2_1', 'm2_2', 'm2_3'], hub: 'roadhouse', endsAt: null, arrival: null,
  },
  {
    n: 3, id: 'ch3', title: 'Blackwater', subtitle: 'One bridge, one river', map: 'bridge', time: 'day',
    card: 'The road ends at a river. There is one bridge, and an army vehicle is sitting dead in the middle of it.',
    epigraph: L('priya', 'It\'s a map. It isn\'t staying. It\'s geography.'),
    missions: ['m3_1', 'm3_2'], hub: 'roadhouse', endsAt: 'depot',
    arrival: { hideout: 'depot', flag: 'seen_arrival_depot', scene: ARRIVE_DEPOT },
  },
  {
    n: 4, id: 'ch4', title: 'Delta', subtitle: 'Checkpoint Delta', map: 'checkpoint', time: 'night',
    card: 'An army checkpoint that has never been relieved. A sergeant who counts her soldiers every morning.',
    epigraph: L('okafor', 'Eleven at the tower. Five on the ridge. Sixteen. I say it out loud so somebody knows.'),
    missions: ['m4_1', 'm4_2', 'm4_3'], hub: 'depot', endsAt: null, arrival: null,
  },
  {
    n: 5, id: 'ch5', title: 'Harlan County', subtitle: 'Fifty miles of open country', map: 'harlan', time: 'day',
    card: 'Farmland, three towns and an interstate. Every safe place keeps moving, and the storm front is closing on the lake.',
    epigraph: L('deke', 'Named for my great-granddad. Lost it in a card game. Don\'t touch anything, it\'s all mortgaged.'),
    missions: ['m5_1', 'm5_2'], hub: 'depot', endsAt: 'farmstead',
    arrival: { hideout: 'farmstead', flag: 'seen_arrival_farmstead', scene: ARRIVE_FARMSTEAD },
  },
  {
    n: 6, id: 'ch6', title: 'Haven', subtitle: 'Lake Harlan Marina', map: 'harlan', time: 'day',
    card: 'One hill to hold, one tower to climb, one cable to ride. The boat is waiting at the other end.',
    epigraph: L('mara', 'I don\'t promise. I tell you what I\'m going to do. I\'m going to be on that deck.'),
    missions: ['m6_1', 'm6_2'], hub: 'farmstead', endsAt: null, arrival: null, epilogue: EPILOGUE,
  },
];

export const EPILOGUE_FLAG = 'seen_epilogue';
