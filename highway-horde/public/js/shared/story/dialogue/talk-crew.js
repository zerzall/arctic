// Hideout conversations: the core crew (Mara, Deke, Ozzy, June, Roz).
// Each NPC has up to five STAGES (dialogue.js STAGES); a stage has a `greet` (lines the NPC says when
// you walk up, one is picked) and `topics` (a menu: `prompt` is what the player picks, `lines` is the
// exchange). Topic conditions: when { flags, notFlags, done, notDone } (world flags / completed
// missions and side jobs). `once:true` topics disappear after being heard; `setFlags` are set when heard.
//
// The road (JOURNEY.md §2): rh1 the Roadhouse after Mill Road and Hollow Creek, rh2 after Saint Mercy
// (the Warden is fifteen), dp1 Blackwater Depot after the dam, dp2 after the rail yard and Fort Harlan,
// fs the Haskell farm before the lake.

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
        t('mara_rh1_fever', "How are the kids?", [
          ['mara', "Six of them have a fever. Tobias's arm is hot to the touch. I need antibiotics, and I have aspirin and good intentions."],
          ['mara', "Ozzy says there's a pharmacy in Hollow Creek. Ozzy says a lot of things. This one I need to be true."],
        ], { when: { notDone: ['m2_1'] } }),
        t('mara_rh1_better', "How are the kids now?", [
          ['mara', "Fevers down. Tobias is asking for pancakes, which is how I know he'll live."],
          ['mara', "I sat with them all night and I didn't count once. Don't tell June. She'll make it a whole thing."],
        ], { when: { done: ['m2_1'] } }),
        t('mara_rh1_count', "You said you stopped counting.", [
          ['mara', "Day nine. A woman at a roadblock. A man in a car. I counted them. Then there were too many, so I stopped."],
          ['mara', "The number didn't go away. I just stopped looking at it."],
          ['mara', "Ask me something easier. Ask me what's in the first-aid kit."],
        ], { setFlags: ['heard_mara_count'] }),
        t('mara_rh1_kit', "What's in the first-aid kit?", [
          ['mara', "Gauze from a very generous ambulance, a splint, four aspirin and half a pie. Don't ask which one is the medicine."],
        ]),
        t('mara_rh1_warden', "Do you believe the Warden?", [
          ['mara', "I believe somebody's very tired and very brave. And if it's a trap, it's the kindest trap I've ever heard."],
        ]),
        t('mara_rh1_delaney', "About the chalkboard in Hollow Creek...", [
          ['mara', "Ms. Delaney walked twenty miles to write it on a school wall. She didn't leave those kids. She went for boats."],
          ['mara', "I'll tell June when I know how the story ends. I want to be able to say the end out loud."],
        ], { when: { done: ['m2_1'] } }),
        t('mara_rh1_mercy', "Saint Mercy?", [
          ['mara', "Six years of night shifts. I know every door and every drawer. Tobias's insulin pen is empty, and the good fridge is in Ward C."],
          ['mara', "I'd rather not go back. I'm going back."],
        ], { when: { done: ['m2_1'] } }),
        t('mara_rh1_tip', "Any advice?", [
          ['mara', "When you reload, breathe out. Your hands shake less. That's not medicine. That's just what works."],
        ]),
      ],
    },
    rh2: {
      greet: ["She's fifteen. I keep saying it to myself. Fifteen.", "Tobias sleeps with his insulin under his pillow. I don't have the heart to tell him it's a fridge thing."],
      topics: [
        t('mara_rh2_warden', "The Warden is a kid.", [
          ['mara', "Fifteen, reading her grandfather's script every night so it doesn't stop."],
          ['mara', "I've been a paramedic for eleven years. I know what a brave voice sounds like when it's holding on by its fingernails."],
        ]),
        t('mara_rh2_files', "What was in the case files?", [
          ['mara', "Patient one came in asleep at the wheel on Day 1. I brought him in. I didn't remember until I saw my own name on the form."],
          ['mara', "He woke on Day 3. He never said a word. He walked toward the nurses' voices. By Day 5 we were calling it the Quiet."],
        ], { setFlags: ['heard_mara_files'] }),
        t('mara_rh2_quill', "What do you make of Quill?", [
          ['mara', "A fraud who's right about half the things he's wrong about. It's a kind of honesty."],
        ], { when: { flags: ['met_quill'] } }),
        t('mara_rh2_dutch', "How's Dutch settling in?", [
          ['mara', "He invoiced me for a bandage. I invoiced him for the stitches. We're even."],
        ], { when: { flags: ['met_dutch'] } }),
        t('mara_rh2_june', "June says you don't count anymore.", [
          ['mara', "June says a lot of things. She's usually right, which is annoying."],
          ['mara', "Ask me again at the lake."],
        ]),
        t('mara_rh2_rest', "Do you ever rest?", [
          ['mara', "I rest when it's dark and quiet and nobody needs me. So, never. Sit down, though. I'll rest while I watch you rest."],
        ]),
        t('mara_rh2_leave', "Are we leaving the Roadhouse?", [
          ['mara', "The Roadhouse can't feed forty people through a winter. And there's a girl on a radio waiting for us."],
          ['mara', "West to the river, then north to the lake. When the board says Westgate, we go."],
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
          ['mara', "A boat's only a boat. It needs people who can steer it. The one steering it now is fifteen and says um."],
        ]),
        t('mara_dp1_dam', "Crossing the dam...", [
          ['mara', "I held that railing so hard my hand still has the pattern. Don't tell anyone. Tell Priya. She'll want it for the map."],
        ]),
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
        ]),
        t('mara_dp2_drop', "That supply drop...", [
          ['mara', "Antibiotics, saline and burn dressings from the sky. Somebody still flies a plane every fourth night. Hope is a pallet with a parachute."],
        ]),
        t('mara_dp2_ghosts', "How's Okafor after the ridge?", [
          ['mara', "She said sixteen. She said it differently. That's how she cries."],
        ], { when: { done: ['sj_ghosts'] } }),
        t('mara_dp2_danny', "Danny seems okay.", [
          ['mara', "Danny eats crackers when he's frightened. I told him he's allowed to be frightened without the crackers. He's eating crackers about it."],
        ]),
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
          ['mara', "Twenty-eight. I said it out loud at the field hospital. It didn't hurt as much as I thought. It hurt in a different place."],
        ], { when: { flags: ['hospital_saved'] } }),
        t('mara_fs_wren', "The Warden saw our fire.", [
          ['mara', "She left the harbor light on for us. Forty nights alone, and she still thought to leave a light on for strangers."],
        ]),
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
        t('deke_rh1_gas', "Do you miss Mill Road Gas?", [
          ['deke', "Thirty years of bait, tractors and tows. The shutter squeaked the whole time. I meant to oil it."],
          ['deke', "And I blew up my own fuel tank on the way out. Best day I've had in a month."],
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
        t('deke_rh2_list', "The Warden's list...", [
          ['deke', "Fuel, a regulator, injectors. A fifteen-year-old read me a shopping list for a marine diesel."],
          ['deke', "I haven't been this happy in a month. Don't tell her. She'll think I'm strange."],
        ]),
        t('deke_rh2_tape', "What's on that tape, Deke?", [
          ['deke', "My boy. Cal. He left a message on the shop machine on Day two. I pulled the tape before the power went. No player."],
          ['deke', "Ozzy keeps looking at me like a dog that wants to be told good. I'm not playing it. Not yet."],
        ], { setFlags: ['deke_tape_told'] }),
        t('deke_rh2_dutch', "You and Dutch?", [
          ['deke', "He's a pain. I've got a lot of respect for pains. They keep the trucks running."],
        ], { when: { flags: ['met_dutch'] } }),
        t('deke_rh2_mast', "How's the radio mast?", [
          ['deke', "Steel pipe, three guy wires, one ladder. It'll hold. Ozzy's very excited. It's alarming how excited he is."],
        ], { when: { flags: ['radio_repaired'] } }),
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
        t('deke_dp1_regulator', "The regulator from the dam...", [
          ['deke', "A turbine governor regulator, still in its box. One line of the kid's list. I've wrapped it in a blanket like a baby."],
        ]),
        t('deke_dp1_pump', "About the pump...", [
          ['deke', "Marine injector pump. Spotless. Somebody wrapped it in oilcloth and loved it. A spare. Spares are how you keep a boat alive."],
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
      greet: ["Locomotive 2217 is in the yard with my fingerprints all over her. Best week of my life."],
      topics: [
        t('deke_dp2_train', "You drove a train.", [
          ['deke', "Twenty-two miles in forty minutes. Stopping is still more of a theory. June blew the whistle and a bird fell over."],
        ]),
        t('deke_dp2_okafor', "What do you think of the Sergeant?", [
          ['deke', "She can strip a rifle blind and can't say thank you sighted. I like her."],
        ]),
        t('deke_dp2_injectors', "The injectors from the yard...", [
          ['deke', "EMD injectors. They put that engine in tugboats. Now it's going in a ferry, one part at a time. I'm a boat mechanic now. I hate water."],
        ]),
        t('deke_dp2_regulator', "The Delta regulator...", [
          ['deke', "Army regulator off generator C. Marine grade. Somebody at Delta had the same idea as us. Just earlier."],
        ], { when: { flags: ['delta_regulator'] } }),
        t('deke_dp2_ghosts', "The ridge...", [
          ['deke', "Those were kids. I've been to a lot of funerals for old men. It's different."],
          ['deke', "Put a wrench in my hand. I'll go fix something."],
        ], { when: { done: ['sj_ghosts'] } }),
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
          ['deke', "Injectors, regulator, fuel. Every part she asked for, in the back of my truck. I can fix anything if I'm allowed to yell at it."],
        ]),
        t('deke_fs_harlan', "Last night in your county.", [
          ['deke', "A month and a half ago I was in a shop with my name on it. Now I'm in a county with my name on it. Funny how you end up."],
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
          ['ozzy', "Nine nights. Same script, same pause, same cough after 'month.' A recording wouldn't cough. A recording wouldn't apologise. She said sorry once. To nobody!"],
        ]),
        t('ozzy_rh1_antenna', "Do you miss your antenna?", [
          ['ozzy', "Every day. It was the tallest thing in Shady Acres. It was my friend. Deke says it was coat hangers. Deke is wrong."],
        ]),
        t('ozzy_rh1_snacks', "You eat a lot.", [
          ['ozzy', "I lived on snack cakes in that trailer from Day nine. I think my blood is frosting."],
        ]),
        t('ozzy_rh1_radio', "How does the radio work?", [
          ['ozzy', "Forty meters. Skywave. The signal bounces off the ionosphere and comes down somewhere else. It's like throwing a ball at the sky and hoping somebody catches it."],
        ]),
        t('ozzy_rh1_callsign', "KD9-OZZ?", [
          ['ozzy', "My license. I took the test at eleven. The examiner said I'd make an excellent lonely person. He meant it as a compliment."],
        ]),
        t('ozzy_rh1_mission', "Where next?", [
          ['ozzy', "Board's open. Story on the left, side jobs on the right. Pick one and I'll stop pretending I'm calm."],
        ]),
      ],
    },
    rh2: {
      greet: ["She's fifteen. I'm seventeen. I've been talking to her like she's a lighthouse. She's a kid in a harbor office."],
      topics: [
        t('ozzy_rh2_answer', "Does she answer now?", [
          ['ozzy', "Every time. She says 'um' a lot. I told her Haven doesn't say um. She said Haven is her, so Haven says um now."],
        ]),
        t('ozzy_rh2_list', "What's on the Warden's list?", [
          ['ozzy', "Fuel, a regulator, injectors. She read it twice and apologised twice. I wrote it on the board in marker. The permanent kind."],
        ]),
        t('ozzy_rh2_ok', "Are you okay, Ozzy?", [
          ['ozzy', "I was right for nine nights and I didn't know what to do with it. Now I'm scared for her, which is a new kind of right."],
        ]),
        t('ozzy_rh2_radio', "How's the new radio?", [
          ['ozzy', "A beautiful monster. It hums. I named it Duchess. Don't tell Deke."],
        ], { when: { flags: ['radio_repaired'] } }),
        t('ozzy_rh2_beacon', "How's the beacon?", [
          ['ozzy', "She says goodnight now. On purpose. Every night at ten. I've never been on time for anything and I'm on time for that."],
        ], { when: { flags: ['beacon_lit'] } }),
        t('ozzy_rh2_tape', "Deke's tape...", [
          ['ozzy', "I found a player! Okay. It's in my bag. He said no. I'm going to wait for a moment that isn't a no."],
        ], { when: { flags: ['has_tape_player'] }, setFlags: ['ozzy_holds_player'] }),
        t('ozzy_rh2_dutch', "Dutch is on your channel.", [
          ['ozzy', "He's a legend. He calls himself Big Dutch when he thinks nobody's listening. I've never been so happy."],
        ], { when: { flags: ['met_dutch'] } }),
      ],
    },
    dp1: {
      greet: ["New band! Army! Somebody named Okafor on a loop. I keep answering a recording. I think I'm in love with her tower."],
      topics: [
        t('ozzy_dp1_okafor', "Tell me about Okafor.", [
          ['ozzy', "A tower, fuel, medicine, and a voice that could strip paint. The loop is four days old. The rail line goes right past her."],
        ]),
        t('ozzy_dp1_map', "The Warden drew Priya a map?", [
          ['ozzy', "Of the lake. In crayon, I think. Priya put it in the book. She didn't say anything. She just put it in the book, very carefully."],
        ]),
        t('ozzy_dp1_pump', "The ferry pump.", [
          ['ozzy', "The Warden asked me for a pump. A PUMP. At the end of the world. She said thank you four times. Nobody says thank you four times unless nobody's said it to them in a while."],
        ], { when: { flags: ['marine_pump'] } }),
        t('ozzy_dp1_priya', "Priya keeps correcting your map.", [
          ['ozzy', "In pencil. She apologises in pencil too."],
        ]),
        t('ozzy_dp1_um', "The Warden still says 'um.'", [
          ['ozzy', "She DOES. Three times a call. A professional Warden doesn't say um. So either she's new at this, or she's just a person. She's just a person."],
        ], { when: { flags: ['warden_contact'] } }),
      ],
    },
    dp2: {
      greet: ["Danny's teaching me army radio. I'm teaching him ham. We're becoming a single radio-shaped creature."],
      topics: [
        t('ozzy_dp2_danny', "You and Danny get along.", [
          ['ozzy', "He talks like every sentence is his last. It's fantastic. I'd follow him into a pit."],
        ]),
        t('ozzy_dp2_pilots', "The supply plane...", [
          ['ozzy', "There are PILOTS. Out there. Flying. I asked if they'd heard of Haven. They said they see the light at the marina every night."],
        ]),
        t('ozzy_dp2_tower', "The Delta tower...", [
          ['ozzy', "It reaches the lake without the hiss. I can hear her breathe. Which means I can hear how scared she is. That's a lot for a guy who lived in a trailer."],
        ], { when: { done: ['sj_tower'] } }),
        t('ozzy_dp2_ma', "She keeps saying she's not a ma'am.", [
          ['ozzy', "I know! I wrote it down! 'Not a ma'am.' Twice! I'm building a file."],
        ], { when: { done: ['sj_line'] }, setFlags: ['ozzy_file'] }),
        t('ozzy_dp2_ridge', "You okay after the ridge?", [
          ['ozzy', "I mostly did the radio. But I heard it. I heard Danny stop talking. He never stops talking."],
        ], { when: { done: ['sj_ghosts'] } }),
        t('ozzy_dp2_list', "How's the list?", [
          ['ozzy', "Injectors, check. Regulator, check. Fuel, check. Medicine, check. I read it to her and she cried a bit. Happy crying. I think."],
        ]),
      ],
    },
    fs: {
      greet: ["Tomorrow I meet her. On the deck. I've practised. 'Hello, Warden.' 'Hello, Warden.' It sounds worse every time."],
      topics: [
        t('ozzy_fs_nervous', "Nervous?", [
          ['ozzy', "I'm the kid who was right about the radio. If I'm wrong about her, I stop being that kid. Also, I'll be on a ferry. Brave and nervous at once. Efficient."],
        ]),
        t('ozzy_fs_light', "She saw our fire.", [
          ['ozzy', "And she left the harbor light on. For us. Nobody has ever left a light on for me. I didn't know it was a thing you could feel from forty miles."],
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
        t('june_rh1_sick', "Are you feeling okay?", [
          ['june', "I wasn't sick. Tobias was sick. I was worried, which Miss Mara says is a different department."],
        ], { when: { done: ['m2_1'] } }),
        t('june_rh1_warden', "Do you like the Warden?", [
          ['june', "She says bring what you can carry. I brought my bottle caps. I carry them in a sock."],
        ]),
      ],
    },
    rh2: {
      greet: ["Mister Deke is teaching me to change a tire. I'm not allowed to lift it. I'm allowed to point."],
      topics: [
        t('june_rh2_warden', "The Warden is a kid.", [
          ['june', "Ozzy says she's fifteen. That's six more than me. She's basically a grown-up. I'm going to ask her about her horn."],
        ]),
        t('june_rh2_wish', "Somebody made you a wish in Hollow Creek.", [
          ['june', "Ozzy told me! In a fountain! I'm not supposed to know what it was. I think it was a good one. I made one back. For you."],
        ], { when: { flags: ['june_wish'] } }),
        t('june_rh2_quill', "What do you think of Quill?", [
          ['june', "He says he has a rumor for everything. I asked for one about Ms. Delaney. He said 'she's on a great adventure.' That's not a rumor. That's a guess."],
        ], { when: { flags: ['met_quill'] } }),
        t('june_rh2_dutch', "Dutch is scary.", [
          ['june', "He's not scary. He's grumpy. Scary people don't give you barrel lids to draw on."],
        ], { when: { flags: ['met_dutch'] } }),
        t('june_rh2_draw', "What are you drawing?", [
          ['june', "You and Miss Mara and Mister Deke on the road. I made Mister Ozzy's hair too big. He said thank you."],
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
        t('june_dp1_robot', "The robot from the mall?", [
          ['june', "His name is Walter. He walks slower than the dead ones. He's my favourite. Don't tell the bottle caps."],
        ], { when: { flags: ['june_toy'] } }),
        t('june_dp1_wendell', "Wendell's dog?", [
          ['june', "He put down a bowl in case. I put a bottle cap in it. For luck."],
        ], { when: { flags: ['marine_pump'] } }),
        t('june_dp1_boat', "There's a real boat.", [
          ['june', "A boat! With a horn? I hope it has a horn. I'm going to ask the Warden if she has a horn."],
        ]),
        t('june_dp1_depot', "Do you like the depot?", [
          ['june', "It has trains! They don't move but they have SEATS. I've decided I'm the conductor."],
        ]),
      ],
    },
    dp2: {
      greet: ["Danny gave me a cracker. Miss Mara said don't eat it. I ate half."],
      topics: [
        t('june_dp2_train', "You blew the train whistle!", [
          ['june', "Mister Deke let me when he came back. It was so loud a bird fell over. It was okay after. It looked surprised."],
        ]),
        t('june_dp2_danny', "Danny is nice.", [
          ['june', "He writes letters to his mom and doesn't mail them. I said you could mail them to me. He said that's how he'd know she got them. I don't get it but I wrote back."],
        ]),
        t('june_dp2_okafor', "What about the Sergeant?", [
          ['june', "She's like a teacher but she doesn't yell. She just looks. It's so much worse."],
        ]),
        t('june_dp2_ghosts', "Are you okay, June?", [
          ['june', "Everybody was sad. I put a bottle cap on the wall for Kip. Danny said thank you. I said it's lucky."],
        ], { when: { done: ['sj_ghosts'] } }),
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
        t('roz_rh1_flare', "You saw our flare from the silo.", [
          ['roz', "I saw somebody waving a flare off Haskell's silo like a lunatic. I thought, well, lunatics get hungry too."],
        ]),
        t('roz_rh1_start', "Were you here when it started?", [
          ['roz', "I was in the walk-in doing inventory. When I came out everything had changed and the lasagna was still warm. I've never forgiven the lasagna."],
        ]),
      ],
    },
    rh2: {
      greet: ["Nineteen mouths, and one of them's a teenager with a radio. God help my pantry."],
      topics: [
        t('roz_rh2_tobias', "How's Tobias?", [
          ['roz', "Insulin in my fridge and a boy at my table asking for seconds. That's the best sentence I've said in a month."],
        ]),
        t('roz_rh2_warden', "The Warden is fifteen.", [
          ['roz', "Fifteen, alone in a harbor office. Who's feeding that child? Somebody tell me who's feeding that child."],
        ]),
        t('roz_rh2_quill', "Quill?", [
          ['roz', "He offered to 'consult' on my menu. I offered to 'consult' his ear with this spatula. We understand each other."],
        ], { when: { flags: ['met_quill'] } }),
        t('roz_rh2_dutch', "Dutch eats a lot.", [
          ['roz', "He eats like a man who thinks food is a debt. I'm running a tab in my head. It's going to be emotional."],
        ], { when: { flags: ['met_dutch'] } }),
        t('roz_rh2_pie', "Did you get the pie?", [
          ['roz', "Eleven pies! I rationed them. One slice per person on Sunday, and we're going to pretend it's Sunday."],
        ], { when: { flags: ['diner_saved'] } }),
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
          ['roz', "Four burners, a working oven and a hiss like a snake. And flour from the mall. I'm making bread. Watch me cry over dough."],
        ]),
        t('roz_dp1_mall', "The mall's kitchens?", [
          ['roz', "Twelve kitchens and not one cook. I took their flour personally."],
        ]),
        t('roz_dp1_priya', "Priya doesn't eat.", [
          ['roz', "She eats standing up. Like she might have to leave. I made her sit. She sat like a cat in a bath."],
        ]),
        t('roz_dp1_bowl', "Wendell's bowl?", [
          ['roz', "I filled it. Rice and water. A grown man put down a dog bowl for a dog that isn't here. If I didn't fill it I'd have to say why."],
        ], { when: { flags: ['marine_pump'] } }),
        t('roz_dp1_menu', "What's on the menu?", [
          ['roz', "Rice with peaches. Peaches with rice. And the house special: peaches, rice and gravy. The gravy's a lie, but a comforting one."],
        ]),
      ],
    },
    dp2: {
      greet: ["Soldiers eat. Lord, they eat. I've never seen a stomach like Danny's. Bottomless."],
      topics: [
        t('roz_dp2_drop', "The supply drop?", [
          ['roz', "Powdered eggs from the sky. Forty years I've cooked, and I've never been handed eggs by an airplane."],
        ]),
        t('roz_dp2_danny', "Danny.", [
          ['roz', "He asked if he could help. I gave him an onion. He cried. I said that's the onion. He said 'Yes, ma'am' and kept crying. Sweet child."],
        ]),
        t('roz_dp2_okafor', "Sergeant Okafor.", [
          ['roz', "She says grace like it's a roll call. I love it. Amen, Sergeant."],
        ]),
        t('roz_dp2_stew', "The ridge...", [
          ['roz', "I made the stew Kip liked. Danny gave me the recipe. It tastes like sadness and pepper. We ate it. Danny cried. Then he had seconds."],
        ], { when: { done: ['sj_ghosts'] } }),
        t('roz_dp2_bread', "Any bread?", [
          ['roz', "Three loaves. It's a good loaf. It has holes and it has hope."],
        ]),
      ],
    },
    fs: {
      greet: ["Big kitchen. Big soup. Big night. Sit, hon. Sit."],
      topics: [
        t('roz_fs_soup', "What's the soup?", [
          ['roz', "Everything. The last peaches, the last rice, the last onion. It's called Farewell Soup. The chickens are exempt. The chickens are coming on the boat."],
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
