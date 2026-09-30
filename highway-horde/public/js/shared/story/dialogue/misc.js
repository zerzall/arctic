// Everything that is not a mission or a hideout topic tree: campfire banter, station flavour,
// pre-mission pep talks, retry quips, loading tips, the title tagline and the credits.
// Tokens allowed in any text: {day} (world day), {crew} (crew name), {scrap} (stash scrap).

const b = (id, a, x, opts = {}) => ({ id, lines: [{ who: a[0], text: a[1] }, { who: x[0], text: x[1] }], ...opts });

// ---- campfire banter: two-liners. The campfire picks a pair whose speakers are both in the hideout
// and whose `when` holds (done = completed missions, flags = world flags).
export const BANTER = [
  b('b01', ['deke', "This soup is exactly the temperature of a lukewarm apology."], ['roz', "Then eat it like you mean it."]),
  b('b02', ['june', "Ozzy, what's a megahertz?"], ['ozzy', "It's how many times per second the sky goes ping. Roughly. Metaphorically. Sort of."]),
  b('b03', ['mara', "You've been staring at that wrench for an hour."], ['deke', "It's staring back."]),
  b('b04', ['priya', "Your map has the river on the wrong side."], ['ozzy', "It's the river's fault."]),
  b('b05', ['roz', "You eating that?"], ['dutch', "It's invoiced."], { when: { done: ['m2_3'] } }),
  b('b06', ['quill', "I have a rumor about your truck."], ['deke', "Don't."], { when: { done: ['m2_1'] } }),
  b('b07', ['june', "Miss Mara, if you were a bottle cap, what kind would you be?"], ['mara', "The kind at the bottom of the drawer."]),
  b('b08', ['danny', "Sarge, permission to say something?"], ['okafor', "Denied."], { when: { done: ['m4_2'] } }),
  b('b09', ['wendell', "Ever had a dog, June?"], ['june', "I had a goldfish."], { when: { done: ['m3_2'] } }),
  b('b10', ['deke', "Where's next on the map?"], ['priya', "Somewhere with fewer bridges."], { when: { done: ['m3_1'] } }),
  b('b11', ['ozzy', "Do you think the Warden gets tired?"], ['mara', "Yes. Say goodnight to her."], { when: { flags: ['warden_contact'] } }),
  b('b12', ['roz', "Why the top hat, Mr. Quill?"], ['quill', "Gravitas, madam."], { when: { done: ['m2_1'] } }),
  b('b13', ['danny', "Mr. Dutch, what's it like driving a big rig?"], ['dutch', "Like herding a building. Don't tell anyone I love it."], { when: { done: ['m4_2'] } }),
  b('b14', ['okafor', "How many did you lose, Doc?"], ['mara', "I stopped counting."], { when: { done: ['m4_1'] } }),
  b('b15', ['june', "Danny, do you have a mom?"], ['danny', "She once fought a raccoon for a sandwich."], { when: { done: ['m4_2'] } }),
  b('b16', ['ozzy', "Deke, tell me about cars."], ['deke', "They go."], { when: { done: ['m1_2'] } }),
  b('b17', ['june', "Miss Roz, the peaches are looking at me."], ['roz', "Then you eat them first."]),
  b('b18', ['priya', "Do you ever stop looking for him?"], ['wendell', "No. Do you ever stop drawing where you've been?"], { when: { done: ['m3_2'] } }),
  b('b19', ['okafor', "Sergeant Okafor requests seconds."], ['roz', "Sergeant Okafor requests a bigger plate."], { when: { done: ['m4_1'] } }),
  b('b20', ['danny', "Ozzy, what's your favorite frequency?"], ['ozzy', "Seven-oh-seven-four. It sounds like a nice place to be lonely."], { when: { done: ['m4_2'] } }),
  b('b21', ['dutch', "You owe me for that hat, Quill."], ['quill', "I've never worn your hat."], { when: { done: ['m2_3'] } }),
  b('b22', ['june', "Miss Mara, do the sad ones count too?"], ['mara', "The sad ones count the most."]),
  b('b23', ['priya', "You keep patting your pocket, Deke."], ['deke', "It's nothing."], { when: { done: ['m3_1'] } }),
  b('b24', ['deke', "I fixed your stove, Roz."], ['roz', "It wasn't broken."]),
  b('b25', ['ozzy', "Danny, what does 'Ruiz' mean in army radio?"], ['danny', "It means the person you call when everyone else is busy."], { when: { done: ['m4_2'] } }),
  b('b26', ['quill', "Anyone need a lucky compass?"], ['priya', "It points at your wagon."], { when: { done: ['m3_1'] } }),
];

// ---- station flavour: what the hideout stations say when you step up. `{day}`, `{scrap}` tokens.
export const STATIONS = {
  board: {
    name: 'Mission Board',
    lines: [
      "Pick a mission. Ozzy will pretend to be calm.",
      "Pins in the map. Don't move the pins.",
      "Radio's warm. Whenever you're ready.",
      "Who's going? Everyone in the ready circle goes.",
    ],
  },
  workbench: {
    name: 'Workbench',
    lines: [
      "Scrap in, damage out. You have {scrap}.",
      "Deke's rule: never upgrade a gun you don't trust. Trust it first.",
      "Tier one is cheap. Tier five costs more than you've got. It's a good tier.",
      "Bring it here broken, leave it better. That's the deal.",
    ],
  },
  armory: {
    name: 'Armory',
    lines: [
      "Three weapons. Choose like you mean it.",
      "Long gun, short gun, and something for the big ones.",
      "Take what you need. Leave what you don't. Ammo's counted.",
      "Every rifle here has a name written inside. Try to bring them back.",
    ],
  },
  infirmary: {
    name: 'Infirmary',
    lines: [
      "Sit. Breathe. This won't take long, and I'll only be a little rude.",
      "Mara's rule: no one leaves hurt. Perks reset once a chapter.",
      "First aid is a conversation. You're supposed to answer.",
      "Everyone gets patched. Even Dutch. Especially Dutch.",
    ],
  },
  upgrades: {
    name: 'Upgrade Board',
    lines: [
      "Priya drew this to scale. Everything is to scale.",
      "Generator, watchtower, infirmary, armory, mast, garden, palisade. Pick one.",
      "Every upgrade shows up in the yard. Look around after.",
      "Supplies and points in. Geometry out.",
    ],
  },
  bed: {
    name: 'Bed',
    prompt: ["Rest until morning? Day {day}", "Sleep on it? Day {day}", "Turn in for the night? Day {day}"],
    morning: [
      "Day {day}. The sun's up. The dead aren't in a hurry.",
      "Day {day}. Coffee is a rumor. Roz says it's a rumor with eggs.",
      "Day {day}. Somebody made the bed. It wasn't you. It was June.",
      "Day {day}. Ozzy's already on the radio.",
    ],
  },
  range: {
    name: 'Shooting Range',
    lines: [
      "Cans on a fence. Honest targets.",
      "Shoot, watch the numbers, get better. It's the same as training a dog.",
      "Walk backward while you shoot. It's a habit worth having.",
      "No ammo is used up on the range. Only pride.",
    ],
  },
  campfire: {
    name: 'Campfire',
    lines: [
      "Sit. The fire won't bite. Roz might.",
      "Somebody's telling a story. Listen for the punchline.",
      "It's warm here. That's the whole point.",
    ],
  },
};

// ---- pre-mission pep talks (at the board / on the radio, right before the briefing) -------
export const PEP = {
  m1_1: [{ who: 'mara', text: "Sunrise is the finish line. Stay on your feet." }],
  m1_2: [{ who: 'deke', text: "Six cans. Try not to set off any more alarms than strictly necessary." }],
  m1_3: [{ who: 'ozzy', text: "Ten minutes. It's only ten minutes. It's probably ten minutes." }],
  m2_1: [{ who: 'roz', text: "Bring back the pie people. I'll hold supper." }, { who: 'quill', text: "And bring back the pie." }],
  m2_2: [{ who: 'ozzy', text: "Anything with a dial. If it beeps, it's mine." }],
  m2_3: [{ who: 'dutch', text: "Keep my barrels upright and my ankles intact. It's an invoice." }],
  m3_1: [{ who: 'priya', text: "Don't stand next to the fat ones when they pop. I've learned this the hard way." }],
  m3_2: [{ who: 'wendell', text: "If you hear a bark, follow it. Good crew." }],
  m4_1: [{ who: 'okafor', text: "Hold the tower. Do not let anything touch its base. Move fast, aim slow." }],
  m4_2: [{ who: 'danny', text: "Hold the crank and think about spring, ma'am! Everyone!" }],
  m4_3: [{ who: 'okafor', text: "Bring them home. That's the whole order." }],
  m5_1: [{ who: 'priya', text: "Keep inside the circle. It moves. So do you." }],
  m5_2: [{ who: 'mara', text: "Don't stop moving. And breathe out when you reload." }],
  m6_1: [{ who: 'okafor', text: "Hold the hill. Give them something to climb." }],
  m6_2: [{ who: 'ozzy', text: "See you on the deck. KD9-OZZ, out. Wait, that's the wrong way to say it. See you on the deck." }],
};

// ---- retry screen quips (mission failed). `general` for any; `byMission` when the mission has its own.
export const RETRY = {
  general: [
    { who: 'deke', text: "Well, that's a problem." },
    { who: 'mara', text: "Breathe. Reload. Again." },
    { who: 'ozzy', text: "Technically that wasn't a win. But it was interesting." },
    { who: 'okafor', text: "Noted. Try again." },
    { who: 'june', text: "That's okay! You can count to ten and try again." },
    { who: 'roz', text: "Eat something, then go back out." },
    { who: 'quill', text: "A setback is only a sale you haven't closed yet." },
    { who: 'dutch', text: "That's going to cost you." },
    { who: 'priya', text: "Adjust the route. Try again." },
    { who: 'wendell', text: "Good crew. Again." },
    { who: 'danny', text: "Ma'am! We can do this, ma'am!" },
    { who: 'narrator', text: "The dead are slow. The dead are patient. So are you." },
    { who: 'deke', text: "Nobody ever fixed anything on the first try. I've been fixing this truck for thirty years." },
    { who: 'mara', text: "Nobody's counting. Well. I'm not." },
    { who: 'ozzy', text: "I've heard worse. Once I heard a dial tone for an hour." },
    { who: 'okafor', text: "Retreat is a plan, if you planned it." },
  ],
  byMission: {
    m1_1: [{ who: 'june', text: "The bus is my home. Please save it." }],
    m2_1: [{ who: 'quill', text: "The diner was a lovely place. Please try to keep it." }],
    m3_1: [{ who: 'priya', text: "The APC needs its cork. Be a better cork." }],
    m4_1: [{ who: 'okafor', text: "The tower is standing or it is not. Go back and make it standing." }],
    m4_3: [{ who: 'danny', text: "Kip's still up there, Sarge. Let's go back." }],
    m6_2: [{ who: 'june', text: "I'm counting! I'm at three hundred! Hurry!" }],
  },
};

// ---- loading-screen tips (real gameplay advice) ---------------------------------------------
export const TIPS = [
  "Zombies are slow and you are not. Walk backward while you shoot and you'll rarely be touched.",
  "Reload behind cover, not in the open. Breathe out on R; steady hands are everything.",
  "Sprint (Shift) drains stamina. Use it to reposition, not to run forever.",
  "Shoot the fat ones from far away. Bloaters burst and hurt everything nearby, including your feet.",
  "Screamers make the whole crowd faster. Shoot the pale one first.",
  "A Brute charges once you're close. Sidestep at the last second and hit it in the back.",
  "Spitters keep their distance. Break their line of sight and stay out of the green puddles.",
  "Crawlers stay low. Jump (Space) and they can't reach you while you're in the air.",
  "Runners are rare but quick. Meet them at a corner with a shotgun, not in the open with a pistol.",
  "Hold E next to a downed teammate to revive them. They have 30 seconds. Never leave anyone behind.",
  "Climb onto a car roof with Space. It buys time, not safety: walkers climb up after a few seconds.",
  "Turrets (T) cover your back and barricades (C) buy you seconds. The Engineer places both at half price.",
  "Stick near your Medic. The heal aura only works while you're close.",
  "Frags (G) and molotovs (F) are for crowds in doorways and for anything big.",
  "Slow zombies walk in lines. Kite them along a wall and one shotgun blast hits five.",
  "Switch guns with 1, 2, 3 or Q for the last one. Swapping is quicker than reloading.",
  "Every mission hides bonus objectives. Collect the notes to learn who the Warden really is.",
  "The compass ◆ always points at your current objective. Trust it.",
  "Three stars: finish fast, keep everyone standing, grab the optional pickups.",
  "Hold your ground on hills. Zombies climbing a slope move slower and take more damage.",
  "In an Evac Run leave for the next zone as soon as it's announced. The fog hurts more the longer you wait outside.",
  "Spend scrap at Deke's workbench. Tier 1 upgrades are cheap, and they add up.",
  "The armory holds three weapons. Bring a long gun, a short gun and something for Brutes.",
  "Sleep at the bed to advance the day. The radio chatter changes with it.",
  "Talk to everyone at the hideout. Half the funniest lines are in the third conversation.",
  "Friendly fire is off by default. Still, never stand in front of the rocket launcher.",
];

// ---- title screen ------------------------------------------------------------------------------
export const TITLE = {
  name: 'ROAD TO HAVEN',
  tagline: "Two hundred miles. One radio. Slow dead, fast friends.",
  alt: [
    "Bring what you can carry.",
    "The dead are slow. The road is long.",
    "Everybody's counting something.",
    "Haven is open. Somebody has to get there.",
  ],
  menuButton: 'Story',
  menuBlurb: "A story campaign for 1 to 6 friends. Fifteen missions, three hideouts, one boat.",
  newCampaign: "Start a new campaign",
  continueCampaign: "Continue the road",
};

// ---- credits --------------------------------------------------------------------------------------
export const CREDITS = [
  { type: 'title', text: 'ROAD TO HAVEN' },
  { type: 'heading', text: 'THE CREW' },
  { type: 'line', text: 'You, and whoever you brought' },
  { type: 'heading', text: 'FEATURING' },
  { type: 'line', text: 'Mara Voss, Field Medic' },
  { type: 'line', text: 'Deke Harlan, Mechanic' },
  { type: 'line', text: 'Ozzy, Radio Operator' },
  { type: 'line', text: 'Sgt. Amara Okafor, Checkpoint Delta' },
  { type: 'line', text: 'Priya Nair, Scout and Engineer' },
  { type: 'line', text: 'June, of the School Bus' },
  { type: 'line', text: 'Roz Pruitt, the Roadhouse Kitchen' },
  { type: 'line', text: 'Silas Quill, Fine Goods and Rare Rumors' },
  { type: 'line', text: 'Dutch Kessler, Mile Marker Crew' },
  { type: 'line', text: 'Wendell Pike, and Biscuit' },
  { type: 'line', text: 'Pvt. Danny Ruiz, Radio' },
  { type: 'line', text: 'Wren Alcott, the Warden' },
  { type: 'heading', text: 'IN MEMORY' },
  { type: 'line', text: 'Cpl. Ramos, Pfc. Adeyemi, Pfc. Kip Marlowe, Ghost Squad' },
  { type: 'line', text: 'Everyone who was counted' },
  { type: 'heading', text: 'FOR' },
  { type: 'line', text: 'Captain Elias Alcott, who wrote it first' },
  { type: 'line', text: 'Everyone who kept counting' },
  { type: 'heading', text: 'A HIGHWAY HORDE STORY' },
  { type: 'line', text: 'Bring what you can carry.' },
  { type: 'title', text: 'Haven is open.' },
];
