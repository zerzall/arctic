// ROAD TO HAVEN — the cast (pure data, no DOM; runs in Node and the browser).
//
// Every character that can speak, walk a hideout or appear on the radio.
//
//   id        stable key used by missions.js / dialogue.js (`who:'mara'`), the NPC snapshot and saves
//   name      display name (name tag, dialogue box)
//   role      one-line job title
//   station   the hideout station the character tends (hint for S3's hub layouts; may be null)
//   joins     when the character becomes available: { mission } = reward.unlockNpc of that mission,
//             { hideout } = lives at that hideout from the first visit, { start } = with the crew
//             from the start, { reveal } = only exists after the finale twist
//   bio       1-3 sentences (journal / cast screen)
//   voice     { pitch, rate } for optional speechSynthesis (pitch 0..2, rate 0.1..10)
//   look      the NPC model: { cls, skin, hair, hairStyle, outfit:[hex...], accessory, scale }
//             cls is one of the survivor kit classes (soldier, medic, engineer, scout, demo, heavy)
//   portrait  hints for the dialogue box: { mood, expression, pose, bg, accent }
//   radioOnly true = never gets a model in the world (the Warden until the finale)
//
// System speakers (`narrator`) have no model and no portrait; they render as a caption.

export const CAST = {
  narrator: {
    id: 'narrator', name: '', role: 'Caption', station: null, system: true, joins: null,
    bio: 'Title cards and place names.',
    voice: { pitch: 0.8, rate: 0.9 },
    look: null,
    portrait: { mood: 'neutral', expression: 'none', pose: 'none', bg: '#000000', accent: '#c9c9c9' },
  },

  mara: {
    id: 'mara', name: 'Mara Voss', role: 'Field Medic', station: 'infirmary', age: 38,
    joins: { mission: 'm1_1' },
    bio: 'A paramedic who found a school bus on Highway 9 and made it her whole job. She stopped counting the people she could not save on day nine; she is not ready to say what she counts instead.',
    voice: { pitch: 1.05, rate: 0.95 },
    look: { cls: 'medic', skin: '#c8a07c', hair: '#3b2a20', hairStyle: 'bun', outfit: ['#e8ecef', '#b23a3a', '#4a5560'], accessory: 'stethoscope', scale: 1 },
    portrait: { mood: 'tired', expression: 'steady', pose: 'arms-crossed', bg: '#2f4250', accent: '#e57373' },
  },

  deke: {
    id: 'deke', name: 'Deke Harlan', role: 'Mechanic', station: 'workbench', age: 64,
    joins: { mission: 'm1_2' },
    bio: 'Sixty-four, one bad hip, one tow truck. His shop, Harlan & Son Auto, is gone; his son Cal\'s last message is on a micro-cassette in his shirt pocket, and he has no way to play it. Yes, the county is named after his family. It was a card game.',
    voice: { pitch: 0.7, rate: 0.88 },
    look: { cls: 'heavy', skin: '#d9a984', hair: '#9a9a96', hairStyle: 'buzz', outfit: ['#2f4b7c', '#8a6d3b', '#3a3a3a'], accessory: 'wrench-belt', scale: 1.05 },
    portrait: { mood: 'gruff', expression: 'squint', pose: 'wiping-hands', bg: '#3b3a2c', accent: '#f4a300' },
  },

  ozzy: {
    id: 'ozzy', name: 'Ozzy', role: 'Radio Operator', station: 'board', age: 17,
    joins: { mission: 'm1_3' },
    bio: 'Oswald Pryce, seventeen, licensed ham (call sign KD9-OZZ) and the only person who insisted the Warden was a live human being. Lives on snacks, static and being right.',
    voice: { pitch: 1.3, rate: 1.15 },
    look: { cls: 'scout', skin: '#8d5a3b', hair: '#1c1410', hairStyle: 'curly', outfit: ['#6d4c9f', '#2e2e2e', '#d8d8d8'], accessory: 'headset', scale: 0.96 },
    portrait: { mood: 'wired', expression: 'grin', pose: 'leaning-forward', bg: '#2d2a45', accent: '#b39ddb' },
  },

  okafor: {
    id: 'okafor', name: 'Sgt. Okafor', role: 'Army Sergeant', station: 'armory', age: 36,
    joins: { mission: 'm4_1' },
    bio: 'Holds Checkpoint Delta on orders nobody has cancelled. Her soldiers are nineteen years old and she counts them every morning out loud, in case anyone is listening.',
    voice: { pitch: 0.9, rate: 1.0 },
    look: { cls: 'soldier', skin: '#5a3a28', hair: '#161616', hairStyle: 'cropped', outfit: ['#4e5b31', '#3b4424', '#2b2b2b'], accessory: 'beret', scale: 1.02 },
    portrait: { mood: 'stern', expression: 'deadpan', pose: 'attention', bg: '#2f3524', accent: '#9ccc65' },
  },

  priya: {
    id: 'priya', name: 'Priya Nair', role: 'Scout & Engineer', station: 'upgrades', age: 29,
    joins: { mission: 'm3_1' },
    bio: 'A surveyor turned scout who keeps a hand-drawn map of every place she has been, with the date next to each. She fixes things so she does not have to stay, and has never once stayed.',
    voice: { pitch: 1.1, rate: 1.05 },
    look: { cls: 'engineer', skin: '#a86f4b', hair: '#1a1210', hairStyle: 'braid', outfit: ['#00838f', '#37474f', '#e0a030'], accessory: 'map-satchel', scale: 1 },
    portrait: { mood: 'dry', expression: 'raised-brow', pose: 'holding-map', bg: '#20393d', accent: '#4dd0e1' },
  },

  june: {
    id: 'june', name: 'June', role: 'The Kid from the Bus', station: 'bed', age: 9,
    joins: { hideout: 'roadhouse' },
    bio: 'Nine years old, collects bottle caps, asks the questions the adults are avoiding. Ms. Delaney told her to count to a thousand and wait. She is on her third thousand.',
    voice: { pitch: 1.6, rate: 1.1 },
    look: { cls: 'scout', skin: '#7a4b2f', hair: '#231610', hairStyle: 'pigtails', outfit: ['#f9a825', '#3949ab', '#ffffff'], accessory: 'backpack', scale: 0.7 },
    portrait: { mood: 'bright', expression: 'wide-eyed', pose: 'waving', bg: '#4a3b1c', accent: '#ffd54f' },
  },

  warden: {
    id: 'warden', name: 'The Warden', role: 'Voice on the Radio', station: null, age: null, radioOnly: true,
    joins: null,
    bio: 'Every night at dusk: "Haven is open." A calm voice, three seconds of silence after the word month, and once in a while a cough.',
    voice: { pitch: 1.2, rate: 0.85 },
    look: null,
    portrait: { mood: 'static', expression: 'none', pose: 'radio', bg: '#12181c', accent: '#80cbc4' },
  },

  roz: {
    id: 'roz', name: 'Roz Pruitt', role: 'Roadhouse Cook', station: 'campfire', age: 57,
    joins: { hideout: 'roadhouse' },
    bio: 'Ran the Roadhouse kitchen for thirty years and will run it until the sun burns out. Feeds everybody, threatens everybody, and keeps a spatula within reach for both.',
    voice: { pitch: 0.95, rate: 1.0 },
    look: { cls: 'heavy', skin: '#e0b590', hair: '#b0403a', hairStyle: 'curls', outfit: ['#f5f0e6', '#c1493a', '#5b3a29'], accessory: 'apron', scale: 1.0 },
    portrait: { mood: 'warm', expression: 'smirk', pose: 'hands-on-hips', bg: '#4a2f22', accent: '#ff8a65' },
  },

  quill: {
    id: 'quill', name: 'Silas Quill', role: 'Trader', station: null, age: 52,
    joins: { mission: 'm2_1' },
    bio: 'Purveyor of Fine Goods, Rare Rumors and, until recently, Pie. Half of what he says is a lie and the other half is a sales pitch, but he always knows where the good stuff is.',
    voice: { pitch: 0.85, rate: 1.1 },
    look: { cls: 'scout', skin: '#c99a70', hair: '#5a4b3c', hairStyle: 'slicked', outfit: ['#6a1b3d', '#d7c49e', '#2a2a2a'], accessory: 'top-hat', scale: 1.0 },
    portrait: { mood: 'showman', expression: 'wink', pose: 'flourish', bg: '#3a1f2d', accent: '#f48fb1' },
  },

  dutch: {
    id: 'dutch', name: 'Dutch Kessler', role: 'Road Crew Boss', station: null, age: 45,
    joins: { mission: 'm2_3' },
    bio: 'Runs the Mile Marker crew, which is now mostly Dutch. Bills for everything, hoards diesel, and would never admit that the invoices are how he says he cares.',
    voice: { pitch: 0.6, rate: 1.0 },
    look: { cls: 'heavy', skin: '#e8bd98', hair: '#7a3f1b', hairStyle: 'bald-beard', outfit: ['#a1301f', '#37474f', '#d0c3a0'], accessory: 'trucker-cap', scale: 1.1 },
    portrait: { mood: 'blustery', expression: 'scowl', pose: 'thumbs-in-belt', bg: '#3d2a24', accent: '#ef5350' },
  },

  wendell: {
    id: 'wendell', name: 'Wendell Pike', role: 'Retired K-9 Handler', station: 'range', age: 68,
    joins: { mission: 'm3_2' },
    bio: 'Thirty-one years handling police dogs. His last partner, a shepherd named Biscuit, ran off in the first week. Wendell talks to everyone the way he talks to a good dog, which turns out to work.',
    voice: { pitch: 0.75, rate: 0.85 },
    look: { cls: 'soldier', skin: '#f0c9a6', hair: '#d8d8d8', hairStyle: 'thin', outfit: ['#37474f', '#5c6b3a', '#2a2a2a'], accessory: 'leash', scale: 1.0 },
    portrait: { mood: 'gentle', expression: 'soft-smile', pose: 'kneeling-hand-out', bg: '#2c3a34', accent: '#a5d6a7' },
  },

  danny: {
    id: 'danny', name: 'Pvt. Danny Ruiz', role: 'Radio Operator, Checkpoint Delta', station: 'armory', age: 19,
    joins: { mission: 'm4_2' },
    bio: 'Nineteen, from Fresno, writes a letter to his mother every night and mails none of them. Sergeant Okafor\'s radio man and her unofficial youngest.',
    voice: { pitch: 1.2, rate: 1.1 },
    look: { cls: 'soldier', skin: '#b9825a', hair: '#1b1b1b', hairStyle: 'cropped', outfit: ['#4e5b31', '#3b4424', '#1f1f1f'], accessory: 'radio-pack', scale: 0.98 },
    portrait: { mood: 'eager', expression: 'nervous-smile', pose: 'salute', bg: '#2b3320', accent: '#c5e1a5' },
  },

  // Revealed in the finale. Same person as the Warden; the crew only learns her name on the roof.
  wren: {
    id: 'wren', name: 'Wren Alcott', role: 'Harbor Warden (acting)', station: null, age: 15, spoiler: true,
    joins: { reveal: 'm6_2' },
    bio: 'Fifteen. Captain Elias Alcott\'s granddaughter, alone at Lake Harlan Marina, reading her grandfather\'s script into a real radio every night because somebody might be listening.',
    voice: { pitch: 1.35, rate: 1.0 },
    look: { cls: 'scout', skin: '#e6b99a', hair: '#7b4a2a', hairStyle: 'ponytail', outfit: ['#1a237e', '#f5f5f5', '#546e7a'], accessory: 'captain-cap', scale: 0.9 },
    portrait: { mood: 'brave', expression: 'red-eyed-smile', pose: 'clutching-headset', bg: '#1c2a3a', accent: '#90caf9' },
  },
};

export const CAST_IDS = Object.keys(CAST);
/** Characters that can be recruited into a hideout (everyone with a body and a bio, minus the caption). */
export const NPC_IDS = CAST_IDS.filter((id) => !CAST[id].system && !CAST[id].radioOnly && !CAST[id].spoiler);
/** The classes an NPC model may use (mirrors classes.js). */
export const LOOK_CLASSES = ['soldier', 'medic', 'engineer', 'scout', 'demo', 'heavy'];

export function castMember(id) {
  return Object.prototype.hasOwnProperty.call(CAST, id) ? CAST[id] : null;
}
