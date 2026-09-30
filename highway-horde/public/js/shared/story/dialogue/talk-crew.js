// Hideout conversations: the core crew (Mara, Deke, Ozzy, June, Roz).
// Each NPC has up to five STAGES (dialogue.js STAGES); a stage has a `greet` (lines the NPC says when
// you walk up, one is picked) and `topics` (a menu: `prompt` is what the player picks, `lines` is the
// exchange). Topic conditions: when { flags, notFlags, done, notDone } (world flags / completed
// missions). `once:true` topics disappear after being heard; `setFlags` are set when heard.

const t = (id, prompt, lines, opts = {}) => ({ id, prompt, lines: lines.map(([who, text]) => ({ who, text })), ...opts });

export const TALK_CREW = {
  // =============================================================================== MARA (infirmary)
  mara: {
    rh1: {
      greet: [
        "Room six is the infirmary now. Don't touch the sign. Roz made it, and it's in glitter.",
        "You look fine. That's my professional opinion and I'm not charging.",
      ],
      topics: [
        t('mara_rh1_kids', "How are the kids?", [
          ['mara', "Fourteen kids, fourteen appetites. Roz is feeding them like she's been waiting her whole life to be needed."],
          ['mara', "I should be sleeping. I keep walking down the hall to check they're still breathing."],
        ]),
        t('mara_rh1_count', "You said you stopped counting.", [
          ['mara', "Day nine. A woman at a roadblock. A man in a car. I counted them. Then there were too many, so I stopped."],
          ['mara', "The number didn't go away. I just stopped looking at it."],
          ['mara', "Ask me something easier. Ask me what's in the first-aid kit."],
        ], { setFlags: ['heard_mara_count'] }),
        t('mara_rh1_kit', "What's in the first-aid kit?", [
          ['mara', "Gauze, a splint, four aspirin and half a pie. Don't ask which one is the medicine."],
        ]),
        t('mara_rh1_warden', "Do you believe the Warden?", [
          ['mara', "I believe somebody's very tired and very brave. And if it's a trap, it's the kindest trap I've ever heard."],
        ]),
        t('mara_rh1_tip', "Any advice?", [
          ['mara', "When you reload, breathe out. Your hands shake less. That's not medicine. That's just what works."],
        ]),
      ],
    },
    rh2: {
      greet: ["Fifteen new faces since Tuesday. I'm running out of clipboards.", "The Roadhouse is growing. So is the noise."],
      topics: [
        t('mara_rh2_diner', "How are the diner people?", [
          ['mara', "Eleven of them, nine of them truckers, and every one wants to know if there's pie left."],
          ['mara', "There isn't. Roz has been informed and is taking it personally."],
        ], { when: { done: ['m2_1'] } }),
        t('mara_rh2_quill', "What do you make of Quill?", [
          ['mara', "A fraud who's right about half the things he's wrong about. It's a kind of honesty."],
        ], { when: { done: ['m2_1'] } }),
        t('mara_rh2_dutch', "How's Dutch settling in?", [
          ['mara', "He invoiced me for a bandage. I invoiced him for the stitches. We're even."],
        ], { when: { done: ['m2_3'] } }),
        t('mara_rh2_june', "June says you don't count anymore.", [
          ['mara', "June says a lot of things. She's usually right, which is annoying."],
          ['mara', "Ask me again at the lake."],
        ]),
        t('mara_rh2_rest', "Do you ever rest?", [
          ['mara', "I rest when it's dark and quiet and nobody needs me. So, never. Sit down, though. I'll rest while I watch you rest."],
        ]),
      ],
    },
    dp1: {
      greet: ["The infirmary's the boxcar with the good floor. Priya labelled everything. Everything."],
      topics: [
        t('mara_dp1_priya', "What do you think of Priya?", [
          ['mara', "She draws a map of everywhere she's been, and never once where she's going. I think that means something."],
        ]),
        t('mara_dp1_ferry', "About the ferry...", [
          ['mara', "A boat's only a boat. It needs people who can steer it. I'd like to meet whoever's been steering this for us."],
        ], { when: { flags: ['marine_pump'] } }),
        t('mara_dp1_hurt', "Anyone hurt?", [
          ['mara', "Ozzy's got a blister from the antenna. Deke's got a splinter and an opinion. That's the whole ward."],
        ]),
        t('mara_dp1_bus', "Do you miss the bus?", [
          ['mara', "I miss having one job. Keep fourteen kids alive on one bus. Now I've got a hundred jobs and no bus."],
        ]),
      ],
    },
    dp2: {
      greet: ["Sergeant Okafor tried to enlist my patients. I told her they'd already joined the army of the recovering."],
      topics: [
        t('mara_dp2_okafor', "You and the Sergeant?", [
          ['mara', "She counts her soldiers every morning. I used to count my patients. We have a lot to not-talk about."],
        ], { when: { done: ['m4_1'] } }),
        t('mara_dp2_ghosts', "How's Okafor after the ridge?", [
          ['mara', "She said sixteen. She said it differently. That's how she cries."],
        ], { when: { done: ['m4_3'] } }),
        t('mara_dp2_danny', "Danny seems okay.", [
          ['mara', "Danny eats crackers when he's frightened. I told him he's allowed to be frightened without the crackers. He's eating crackers about it."],
        ], { when: { done: ['m4_2'] } }),
        t('mara_dp2_afraid', "What are you afraid of?", [
          ['mara', "Running out of gauze. Isn't that funny? Not the dead. The gauze."],
        ]),
      ],
    },
    fs: {
      greet: ["Last night on solid ground. Sleep if you can. I won't, but you can."],
      topics: [
        t('mara_fs_june', "What did you tell June?", [
          ['mara', "That I'd be on the deck. I don't make promises. I just say where I'll be. It's a technicality, but it holds up."],
        ]),
        t('mara_fs_count', "About that counting...", [
          ['mara', "Twenty-eight. I said it out loud. It didn't hurt as much as I thought. It hurt in a different place."],
        ], { when: { flags: ['hospital_saved'] } }),
        t('mara_fs_ready', "Are you ready?", [
          ['mara', "No. But I'm ready enough. Which is the best anyone gets."],
        ]),
        t('mara_fs_thanks', "Thank you, Mara.", [
          ['mara', "Don't. Not yet. When we're on the water, you can say it. Twice."],
        ]),
      ],
    },
  },

  // =============================================================================== DEKE (workbench)
  deke: {
    rh1: {
      greet: ["Workbench is in the laundry room. Don't put your drink on it. That's a lathe. Well, it's going to be a lathe."],
      topics: [
        t('deke_rh1_pocket', "What do you keep patting?", [
          ['deke', "Keys. To a shop that isn't mine anymore. Harlan & Son. It was a good shop."],
          ['deke', "Don't look at me like that. Go break something. I'll fix it."],
        ]),
        t('deke_rh1_bench', "What can you make?", [
          ['deke', "Give me scrap and a bad attitude and I'll upgrade any gun you own. Tiers one through five. Tier five costs more than you've got. It's a good tier."],
        ]),
        t('deke_rh1_tow', "That tow truck...", [
          ['deke', "Ford F-350. 1997. Two hundred and ninety thousand miles and a personality."],
        ]),
        t('deke_rh1_harlan', "About the county being named for you...", [
          ['deke', "Great-granddad Ezekiel. Won it in a card game in 1881. Lost the next hand. That's the entire family business: win big, lose the next hand."],
        ]),
        t('deke_rh1_roz', "Roz says your truck leaks.", [
          ['deke', "She's right. I let it leak. Keeps the lot honest."],
        ]),
      ],
    },
    rh2: {
      greet: ["Radio mast goes up Thursday. Ozzy's already named it. I've stopped asking."],
      topics: [
        t('deke_rh2_tape', "What's on that tape, Deke?", [
          ['deke', "My boy. Cal. He left a message on the shop machine on Day two. I pulled the tape before the power went. No player."],
          ['deke', "Ozzy keeps looking at me like a dog that wants to be told good. I'm not playing it. Not yet."],
        ], { setFlags: ['deke_tape_told'], when: { done: ['m2_2'] } }),
        t('deke_rh2_dutch', "You and Dutch?", [
          ['deke', "He's a pain. I've got a lot of respect for pains. They keep the trucks running."],
        ], { when: { done: ['m2_3'] } }),
        t('deke_rh2_mast', "How's the radio mast?", [
          ['deke', "Steel pipe, three guy wires, one ladder. It'll hold. Ozzy's very excited. It's alarming how excited he is."],
        ], { when: { done: ['m2_2'] } }),
        t('deke_rh2_fix', "What can you fix?", [
          ['deke', "Anything with a bolt in it. Not much I can do for feelings. Ask Mara."],
        ]),
      ],
    },
    dp1: {
      greet: ["That lathe. You seen that lathe? I could cry."],
      topics: [
        t('deke_dp1_lathe', "Enjoying the machine shop?", [
          ['deke', "A lathe, a drill press and a welder that hums a tune. I've been happy three hours straight. I don't know what to do with my face."],
        ]),
        t('deke_dp1_pump', "About the pump...", [
          ['deke', "Marine injector. Spotless. Somebody wrapped it in oilcloth and loved it. I'm going to carry it like a baby."],
        ], { when: { flags: ['marine_pump'] } }),
        t('deke_dp1_priya', "What do you think of Priya?", [
          ['deke', "An engineer who doesn't want to be one. Takes one to know the look."],
        ]),
        t('deke_dp1_cal', "Have you got family, Deke?", [
          ['deke', "A son. Cal. Twenty-two. Dumb as a bag of hammers and twice as useful."],
          ['deke', "That's all I'm saying."],
        ]),
      ],
    },
    dp2: {
      greet: ["Delta's regulator is on my bench. Beautiful piece of gear. Better than the boat needs."],
      topics: [
        t('deke_dp2_regulator', "What's that regulator for?", [
          ['deke', "Not sure yet. A marine-grade regulator on an army generator. Someone had the same idea as us. Just earlier."],
        ], { when: { done: ['m4_2'] } }),
        t('deke_dp2_okafor', "What do you think of the Sergeant?", [
          ['deke', "She can strip a rifle blind and can't say thank you sighted. I like her."],
        ], { when: { done: ['m4_1'] } }),
        t('deke_dp2_ghosts', "The ridge...", [
          ['deke', "Those were kids. I've been to a lot of funerals for old men. It's different."],
          ['deke', "Put a wrench in my hand. I'll go fix something."],
        ], { when: { done: ['m4_3'] } }),
        t('deke_dp2_bench', "Any upgrades?", [
          ['deke', "Anything that shoots can shoot better. Pick one, hand me scrap, come back in an hour. Don't watch. A watched wrench never turns."],
        ]),
      ],
    },
    fs: {
      greet: ["Generator's in the milk shed. It's the only building that smells worse than the barn. She'll do."],
      topics: [
        t('deke_fs_tape', "Ozzy says he's got something for you.", [
          ['deke', "He says a lot of things. He's right about most of them."],
          ['deke', "Not tonight. Maybe on the boat. Maybe when I can look at the water."],
        ], { setFlags: ['deke_tape_deferred'] }),
        t('deke_fs_engine', "Can you fix the ferry?", [
          ['deke', "I can fix anything if I'm allowed to yell at it. That boat and I are going to have a talk."],
        ]),
        t('deke_fs_harlan', "Last night in your county.", [
          ['deke', "Fifty-six days ago I was in a shop with my name on it. Now I'm in a county with my name on it. Funny how you end up."],
        ]),
        t('deke_fs_thanks', "Thanks for everything, Deke.", [
          ['deke', "Kiddo, I don't do thanks. But I'll keep your weapons humming until the day I die. That's a thank-you in my language."],
        ]),
      ],
    },
  },

  // =============================================================================== OZZY (board / radio)
  ozzy: {
    rh1: {
      greet: ["The board's in the office. I've labelled the map. Don't move the pins. THE PINS."],
      topics: [
        t('ozzy_rh1_warden', "Tell me about the Warden.", [
          ['ozzy', "Nine nights. Same script, same cough at two-fourteen, same pause. A recording wouldn't cough. A recording wouldn't apologise. She said sorry once. To nobody!"],
        ]),
        t('ozzy_rh1_snacks', "You eat a lot.", [
          ['ozzy', "I've been living on snack cakes since Day nine. I think my blood is frosting."],
        ]),
        t('ozzy_rh1_radio', "How does the radio work?", [
          ['ozzy', "Forty meters. Skywave. The signal bounces off the ionosphere and comes down somewhere else. It's like throwing a ball at the sky and hoping somebody catches it."],
        ]),
        t('ozzy_rh1_callsign', "KD9-OZZ?", [
          ['ozzy', "My license. I took the test at eleven. The examiner said I'd make an excellent lonely person. He meant it as a compliment."],
        ]),
        t('ozzy_rh1_mission', "Where next?", [
          ['ozzy', "Board's open. Pick a mission and I'll stop pretending I'm calm."],
        ]),
      ],
    },
    rh2: {
      greet: ["Good news: Last Chance is a goldmine. Bad news: I'm a goblin in a goldmine. Both, actually."],
      topics: [
        t('ozzy_rh2_radio', "How's the new radio?", [
          ['ozzy', "A beautiful monster. It hums. I named it Duchess. Don't tell Deke."],
        ], { when: { done: ['m2_2'] } }),
        t('ozzy_rh2_tape', "Deke's tape...", [
          ['ozzy', "I found a player! Okay. It's in my bag. He said no. I'm going to wait for a moment that isn't a no."],
        ], { when: { flags: ['has_tape_player'] }, setFlags: ['ozzy_holds_player'] }),
        t('ozzy_rh2_answer', "Does the Warden ever answer twice?", [
          ['ozzy', "If I ask a question she answers. Yesterday I asked what the weather was. She said 'grey.' Just like that. Grey."],
        ], { when: { flags: ['warden_contact'] } }),
        t('ozzy_rh2_dutch', "Dutch is on your channel.", [
          ['ozzy', "He's a legend. He calls himself Big Dutch when he thinks nobody's listening. I've never been so happy."],
        ], { when: { done: ['m2_3'] } }),
        t('ozzy_rh2_ok', "Are you okay, Ozzy?", [
          ['ozzy', "Yes. No. I've been right for nine nights and I don't know what to do when I'm right. I'm not built for it."],
        ]),
      ],
    },
    dp1: {
      greet: ["New band! Army! Somebody named Okafor keeps calling. I keep answering. I think I'm in love with her tower."],
      topics: [
        t('ozzy_dp1_okafor', "Tell me about Okafor.", [
          ['ozzy', "A tower, no power, and a voice that could strip paint. She said 'copy' at me and I nearly died."],
        ]),
        t('ozzy_dp1_pump', "The ferry needs a pump.", [
          ['ozzy', "I asked the Warden where she is. She said the tower. Then the harbor office. Then 'the harbor office is upstairs.' I got the feeling she's alone."],
        ], { when: { flags: ['marine_pump'] } }),
        t('ozzy_dp1_priya', "Priya keeps correcting your map.", [
          ['ozzy', "In pencil. She apologises in pencil too."],
        ]),
        t('ozzy_dp1_um', "The Warden said 'um.'", [
          ['ozzy', "She DID. Three times! A professional Warden doesn't say 'um.' So either she's new at this, or she's just a person."],
        ], { when: { flags: ['warden_contact'] } }),
      ],
    },
    dp2: {
      greet: ["Danny's teaching me army radio. I'm teaching him ham. We're becoming a single radio-shaped creature."],
      topics: [
        t('ozzy_dp2_danny', "You and Danny get along.", [
          ['ozzy', "He talks like every sentence is his last. It's fantastic. I'd follow him into a pit."],
        ], { when: { done: ['m4_2'] } }),
        t('ozzy_dp2_tower', "The Delta tower...", [
          ['ozzy', "It reaches the lake without the hiss. Which means I can hear her breathe. Which means I can hear how scared she is. That's a lot of responsibility for a guy who lived in a trailer."],
        ], { when: { done: ['m4_1'] } }),
        t('ozzy_dp2_ma', "She keeps saying she's not a ma'am.", [
          ['ozzy', "I know! I wrote it down! 'Not a ma'am.' Twice! I'm building a file."],
        ], { when: { done: ['m4_2'] }, setFlags: ['ozzy_file'] }),
        t('ozzy_dp2_ridge', "You okay after the ridge?", [
          ['ozzy', "I mostly did the radio. But I heard it. I heard Danny stop talking. He never stops talking."],
        ], { when: { done: ['m4_3'] } }),
      ],
    },
    fs: {
      greet: ["Tomorrow I meet her. On the deck. I've practised. 'Hello, Warden.' 'Hello, Warden.' It sounds worse every time."],
      topics: [
        t('ozzy_fs_nervous', "Nervous?", [
          ['ozzy', "I'm the kid who was right about the radio. If I'm wrong about her, I stop being that kid. Also, I'll be on a ferry. Brave and nervous at once. Efficient."],
        ]),
        t('ozzy_fs_player_have', "About that tape player...", [
          ['ozzy', "In my bag. He hasn't asked and he hasn't said yes. I'll hand it over on the boat. 'Here.' And walk away. Very cool."],
        ], { when: { flags: ['has_tape_player'] } }),
        t('ozzy_fs_player_build', "About that tape player...", [
          ['ozzy', "I'm building Deke one out of a walkie-talkie and a hairpin. Don't ask where I got the hairpin."],
        ], { when: { notFlags: ['has_tape_player'] } }),
        t('ozzy_fs_haven', "What do you think Haven is?", [
          ['ozzy', "A place where the person on the radio isn't alone anymore. I think that's the whole thing."],
        ]),
      ],
    },
  },

  // =============================================================================== JUNE (bed)
  june: {
    rh1: {
      greet: ["Hi! I'm in the bee room! It has a bee! It doesn't sting!"],
      topics: [
        t('june_rh1_caps', "What do you collect?", [
          ['june', "Bottle caps! I've got forty-one. This one's from a machine that didn't work. This one is lucky."],
        ]),
        t('june_rh1_count', "Why do you count?", [
          ['june', "Ms. Delaney said count to a thousand and wait. I'm on my third thousand. Then I'll count a fourth. It's not so bad. You get to know the numbers."],
        ]),
        t('june_rh1_question', "Can I ask you something?", [
          ['june', "Do the slow ones know they're slow? Are they sad about it?"],
          ['june', "I think they're sad. I think everybody who walks that slow is sad."],
        ]),
        t('june_rh1_bee', "How's the bee room?", [
          ['june', "It has a bee on the door. Roz said the bee is on the house. I don't get it but I love it."],
        ]),
        t('june_rh1_warden', "Do you like the Warden?", [
          ['june', "She says bring what you can carry. I brought my bottle caps. I carry them in a sock."],
        ]),
      ],
    },
    rh2: {
      greet: ["Mr. Quill let me touch the wagon! It has drawers! It has SO MANY drawers!"],
      topics: [
        t('june_rh2_quill', "What do you think of Quill?", [
          ['june', "He says he has a rumor for everything. I asked for one about Ms. Delaney. He said 'she's on a great adventure.' That's not a rumor. That's a guess."],
        ], { when: { done: ['m2_1'] } }),
        t('june_rh2_dutch', "Dutch is scary.", [
          ['june', "He's not scary. He's grumpy. Scary people don't give you barrel lids to draw on."],
        ], { when: { done: ['m2_3'] } }),
        t('june_rh2_draw', "What are you drawing?", [
          ['june', "You and Miss Mara and Mr. Deke on the road. I made Mr. Ozzy's hair too big. He said thank you."],
        ]),
        t('june_rh2_night', "Can't sleep?", [
          ['june', "I count. Sometimes backward. Sometimes the kids: fourteen. Then the grown-ups. Then you. You make the number nicer."],
        ]),
      ],
    },
    dp1: {
      greet: ["Miss Priya says I can hold the map if I don't spill. I never spill. I mostly spill."],
      topics: [
        t('june_dp1_map', "What's on Priya's map?", [
          ['june', "Dates! Every place has a date. She said it's so she doesn't forget. I asked what happens if she forgets. She said 'then I was nowhere.'"],
        ]),
        t('june_dp1_wendell', "Wendell's dog?", [
          ['june', "He put down a bowl in case. I put a bottle cap in it. For luck."],
        ]),
        t('june_dp1_boat', "There's a real boat.", [
          ['june', "A boat! With a horn? I hope it has a horn. I'm going to ask the Warden if she has a horn."],
        ], { when: { flags: ['marine_pump'] } }),
        t('june_dp1_depot', "Do you like the depot?", [
          ['june', "It has trains! They don't move but they have SEATS. I've decided I'm the conductor."],
        ]),
      ],
    },
    dp2: {
      greet: ["Danny gave me a cracker. Miss Mara said don't eat it. I ate half."],
      topics: [
        t('june_dp2_danny', "Danny is nice.", [
          ['june', "He writes letters to his mom and doesn't mail them. I said you could mail them to me. He said that's how he'd know she got them. I don't get it but I wrote back."],
        ], { when: { done: ['m4_2'] } }),
        t('june_dp2_okafor', "What about the Sergeant?", [
          ['june', "She's like a teacher but she doesn't yell. She just looks. It's so much worse."],
        ], { when: { done: ['m4_1'] } }),
        t('june_dp2_ghosts', "Are you okay, June?", [
          ['june', "Everybody was sad. I put a bottle cap on the wall for Kip. Danny said thank you. I said it's lucky."],
        ], { when: { done: ['m4_3'] } }),
        t('june_dp2_count', "How many of us now?", [
          ['june', "Lots. I keep a list. It's in my head. It's getting long. It's the good kind of long."],
        ]),
      ],
    },
    fs: {
      greet: ["I drew everybody a picture! It's a boat! It's all the same picture! Don't tell them!"],
      topics: [
        t('june_fs_mara', "Mara says she'll be on the deck.", [
          ['june', "She doesn't say promise. She says what she's going to do. That's better than a promise because it's a plan."],
        ]),
        t('june_fs_delaney', "Do you think Ms. Delaney is there?", [
          ['june', "I don't know. But if she is, I'm going to say 'I stayed put.' And if she isn't, I'll say it to the boat."],
        ]),
        t('june_fs_cap', "Want to trade caps?", [
          ['june', "I have a lucky one for tomorrow. It's green. From a soda that doesn't exist anymore. Here, hold it. Give it back after the tower."],
        ], { setFlags: ['june_lucky_cap'] }),
        t('june_fs_scared', "Are you scared?", [
          ['june', "A little. But I count when I'm scared. I'm at nine hundred and sixty. Then I start again. I'm always somewhere in between."],
        ]),
      ],
    },
  },

  // =============================================================================== ROZ (campfire / kitchen)
  roz: {
    rh1: {
      greet: ["Sit. Eat. You look like a suitcase somebody packed in a hurry."],
      topics: [
        t('roz_rh1_kitchen', "How's the kitchen?", [
          ['roz', "Thirty years I've cooked in this kitchen. The motel's shot but the kitchen is glorious. Six burners, one propane tank and a skillet older than the state."],
        ]),
        t('roz_rh1_menu', "What's for dinner?", [
          ['roz', "Tonight's special is canned peaches, rice and hope. It's my most popular dish. I've never sold out of hope."],
        ]),
        t('roz_rh1_spatula', "What's with the spatula?", [
          ['roz', "It's a spatula. It's for flipping. And gesturing. And occasionally making a point."],
        ]),
        t('roz_rh1_deke', "You and Deke...", [
          ['roz', "That man parked a leaking truck on my lot. I'll forgive him when he's fed."],
        ]),
        t('roz_rh1_start', "Were you here when it started?", [
          ['roz', "I was in the walk-in doing inventory. When I came out everything had changed and the lasagna was still warm. I've never forgiven the lasagna."],
        ]),
      ],
    },
    rh2: {
      greet: ["Nineteen mouths, and one of them's a trucker's. God help my pantry."],
      topics: [
        t('roz_rh2_quill', "Quill?", [
          ['roz', "He offered to 'consult' on my menu. I offered to 'consult' his ear with this spatula. We understand each other."],
        ], { when: { done: ['m2_1'] } }),
        t('roz_rh2_dutch', "Dutch eats a lot.", [
          ['roz', "He eats like a man who thinks food is a debt. I'm running a tab in my head. It's going to be emotional."],
        ], { when: { done: ['m2_3'] } }),
        t('roz_rh2_pie', "Did you get the pie?", [
          ['roz', "Eleven pies! I rationed them. One slice per person on Sunday, and we're going to pretend it's Sunday."],
        ], { when: { done: ['m2_1'] } }),
        t('roz_rh2_june', "June?", [
          ['roz', "That kid eats like a sparrow and asks like a lawyer. I gave her a wooden spoon. She's been guarding the peaches ever since."],
        ]),
        t('roz_rh2_leave', "Do you want to leave?", [
          ['roz', "I want to want to. I'm a cook. Cooks stay. But I've never been on a boat, and I've always wanted to."],
        ]),
      ],
    },
    dp1: {
      greet: ["The depot's got a stove. A real stove. I'm in love. Don't tell the Roadhouse."],
      topics: [
        t('roz_dp1_stove', "How's the new stove?", [
          ['roz', "Four burners, a working oven and a hiss like a snake. I'm making bread. I haven't made bread since Day one. Watch me cry over dough."],
        ]),
        t('roz_dp1_priya', "Priya doesn't eat.", [
          ['roz', "She eats standing up. Like she might have to leave. I made her sit. She sat like a cat in a bath."],
        ]),
        t('roz_dp1_bowl', "Wendell's bowl?", [
          ['roz', "I filled it. Rice and water. A grown man put down a dog bowl for a dog that isn't here. If I didn't fill it I'd have to say why."],
        ]),
        t('roz_dp1_menu', "What's on the menu?", [
          ['roz', "Rice with peaches. Peaches with rice. And the house special: peaches, rice and gravy. The gravy's a lie, but a comforting one."],
        ]),
      ],
    },
    dp2: {
      greet: ["Soldiers eat. Lord, they eat. I've never seen a stomach like Danny's. Bottomless."],
      topics: [
        t('roz_dp2_danny', "Danny.", [
          ['roz', "He asked if he could help. I gave him an onion. He cried. I said that's the onion. He said 'Yes, ma'am' and kept crying. Sweet child."],
        ], { when: { done: ['m4_2'] } }),
        t('roz_dp2_okafor', "Sergeant Okafor.", [
          ['roz', "She says grace like it's a roll call. I love it. Amen, Sergeant."],
        ], { when: { done: ['m4_1'] } }),
        t('roz_dp2_stew', "The ridge...", [
          ['roz', "I made the stew Kip liked. Danny gave me the recipe. It tastes like sadness and pepper. We ate it. Danny cried. Then he had seconds."],
        ], { when: { done: ['m4_3'] } }),
        t('roz_dp2_bread', "Any bread?", [
          ['roz', "Three loaves. It's a good loaf. It has holes and it has hope."],
        ]),
      ],
    },
    fs: {
      greet: ["Big kitchen. Big soup. Big night. Sit, hon. Sit."],
      topics: [
        t('roz_fs_soup', "What's the soup?", [
          ['roz', "Everything. The last peaches, the last rice, the last onion. It's called Farewell Soup."],
        ]),
        t('roz_fs_roadhouse', "Do you miss the Roadhouse?", [
          ['roz', "Every minute. I left the skillet on the wall. I like to think somebody will find it and know someone loved that kitchen."],
        ]),
        t('roz_fs_boat', "Boat food?", [
          ['roz', "The Warden told Ozzy the galley has a two-burner stove and a coffee pot the size of a tuba. I have never wanted anything more in my life."],
        ]),
        t('roz_fs_words', "Any words for the crew?", [
          ['roz', "Eat. Then win. In that order."],
        ]),
      ],
    },
  },
};
