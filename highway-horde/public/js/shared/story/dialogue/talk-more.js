// Hideout conversations: Priya, Okafor, Quill, Dutch, Wendell and Danny. Same shape as talk-crew.js.

const t = (id, prompt, lines, opts = {}) => ({ id, prompt, lines: lines.map(([who, text]) => ({ who, text })), ...opts });

export const TALK_MORE = {
  // =============================================================================== PRIYA (upgrade board)
  priya: {
    dp1: {
      greet: ["The upgrade board is mine. I've drawn it to scale. Everything's to scale. It helps."],
      topics: [
        t('priya_dp1_map', "Can I see your map?", [
          ['priya', "Twelve places. Each has a date and a reason I left. Some of the reasons are good."],
          ['priya', "Don't ask about the bridge. The bridge is a good reason I stayed longer than planned."],
        ]),
        t('priya_dp1_staying', "Are you staying?", [
          ['priya', "I'm here. That's not the same as staying. It's a temporary noun."],
        ]),
        t('priya_dp1_upgrades', "What can we build?", [
          ['priya', "Generator, watchtower, infirmary beds, armory racks, a radio mast, a garden and a palisade. Give me supplies and points. I'll give you geometry."],
        ]),
        t('priya_dp1_apc', "You fixed the APC alone?", [
          ['priya', "Four-fifths alone. The last fifth was you. It counts."],
        ]),
      ],
    },
    dp2: {
      greet: ["Delta's on my map. First army checkpoint I've drawn. It's mostly hesco."],
      topics: [
        t('priya_dp2_okafor', "Does Okafor scare you?", [
          ['priya', "She doesn't scare me. She terrifies me in a way I respect."],
        ], { when: { done: ['m4_1'] } }),
        t('priya_dp2_ferry', "The ferry parts.", [
          ['priya', "Injector pump, regulator, fuel, a radio. If I were the Warden I'd be very quiet right now and hope nobody noticed I'd lost my mind."],
        ], { when: { flags: ['marine_pump'] } }),
        t('priya_dp2_map', "New entries?", [
          ['priya', "Blackwater Depot. Delta. Two new places in a week. I'm running out of ink and I don't mind."],
        ]),
        t('priya_dp2_ghosts', "Are you all right?", [
          ['priya', "I wrote their names on the back of the map. Five names, by Delta. On the back, where nobody has to look unless they want to."],
        ], { when: { done: ['m4_3'] } }),
      ],
    },
    fs: {
      greet: ["The farmstead's on the map. Thirteen. I'm calling it provisional."],
      topics: [
        t('priya_fs_stay', "About staying...", [
          ['priya', "I never stayed anywhere because if I stay, I have to be there when it ends. I've been thinking about that. I'd rather be there when it ends. With you lot."],
        ]),
        t('priya_fs_thirteen', "Thirteen places.", [
          ['priya', "Unlucky number. I've decided not to believe in luck. Luck is a variable I can't measure."],
        ]),
        t('priya_fs_june', "June asked to draw on the map.", [
          ['priya', "I let her draw a small boat in the corner. A very small boat. It's the best thing on the page."],
        ]),
        t('priya_fs_lake', "The lake?", [
          ['priya', "It's on the map. It's blank inside. First time I'll go somewhere without knowing what's on the far shore. I'm frightened. I'm looking forward to it."],
        ]),
      ],
    },
  },

  // =============================================================================== OKAFOR (armory)
  okafor: {
    dp2: {
      greet: ["Armory's open. Weapons cleaned, counted and labelled. That last part is for Ruiz."],
      topics: [
        t('okafor_dp2_count', "You count your soldiers.", [
          ['okafor', "Every morning. Out loud. Somebody should say their names."],
        ]),
        t('okafor_dp2_age', "They're very young.", [
          ['okafor', "Nineteen. Twenty. One of them is eighteen and lied about it. I let him lie. What is the point of the truth at the end of the world?"],
        ]),
        t('okafor_dp2_armory', "What's in the armory?", [
          ['okafor', "Everything we have found, in racks. Choose three weapons for your loadout. Take what you need. Leave what you do not."],
        ]),
        t('okafor_dp2_orders', "About your orders...", [
          ['okafor', "'Hold until relieved.' I relieved myself. It feels like taking off boots."],
        ]),
        t('okafor_dp2_ghosts', "Are you all right?", [
          ['okafor', "No. But I am functional. In my experience those are separate departments."],
        ], { when: { done: ['m4_3'] } }),
      ],
    },
    fs: {
      greet: ["Rifles cleaned. Boots dry. All soldiers accounted for. Tomorrow is a long day."],
      topics: [
        t('okafor_fs_plan', "Tomorrow.", [
          ['okafor', "Convoy on the lake road, you on the hill. Kessler leads, I bring up the rear. If it goes wrong, I do not want anyone to feel it was theirs."],
        ]),
        t('okafor_fs_kip', "About Kip.", [
          ['okafor', "I have his tag. I gave Ruiz his letter. It said 'save me a seat.' Ruiz asked if I would sit next to him. I said yes. I have never sat next to anyone."],
        ], { when: { done: ['m4_3'] } }),
        t('okafor_fs_mara', "You and Mara...", [
          ['okafor', "We are both counting. We do it differently. I do not think either of us knows how to stop."],
        ]),
        t('okafor_fs_thanks', "Thank you, Sergeant.", [
          ['okafor', "Noted. And received. And appreciated. In that order."],
        ]),
      ],
    },
  },

  // =============================================================================== QUILL (trader)
  quill: {
    rh2: {
      greet: ["Quill's Quality Goods and Rare Rumors! Open for business. And by open I mean standing here."],
      topics: [
        t('quill_rh2_rumor', "Got a rumor?", [
          ['quill', "I have four. One of them is true. Unfortunately I have forgotten which. Shall I recite all four?"],
        ]),
        t('quill_rh2_wagon', "What's in the wagon?", [
          ['quill', "Everything a person could need and several things nobody ever would. Item: a jar of buttons. Item: a signed photograph of a man I don't know. Item: a pie tin. The pie is gone. The tin remains."],
        ]),
        t('quill_rh2_pie', "Do you miss the pie?", [
          ['quill', "Sir, I have never been so sick of a thing in my life, and I miss it dearly."],
        ], { when: { done: ['m2_1'] } }),
        t('quill_rh2_lake', "Have you been to the lake?", [
          ['quill', "Never. But I heard of it from a man who heard from a woman who drove a bus. It has water. It has a boat. It has an unreasonable number of gulls."],
        ]),
      ],
    },
    dp1: {
      greet: ["The Depot Bazaar is open for business. Every price is negotiable. Every price is also wrong."],
      topics: [
        t('quill_dp1_bazaar', "The Bazaar?", [
          ['quill', "A reasonable business model. You give me scrap, I give you optimism at an affordable rate."],
        ]),
        t('quill_dp1_kidney', "Was that a kidney?", [
          ['quill', "It was a kidney-shaped rock. I am a trader, not a monster."],
        ]),
        t('quill_dp1_rumor', "Any new rumors?", [
          ['quill', "There is an army checkpoint to the south where a sergeant has never smiled. I don't say it is true. I say a man told me."],
        ]),
      ],
    },
    dp2: {
      greet: ["Business is slow. The world is ending. It is very inconsiderate of it."],
      topics: [
        t('quill_dp2_okafor', "Have you met the Sergeant?", [
          ['quill', "I tried to sell her a hat. She looked at me. I gave her the hat."],
        ], { when: { done: ['m4_1'] } }),
        t('quill_dp2_deal', "Anything for sale?", [
          ['quill', "A lucky bottle cap, a broken compass and the hope of a good night. Pay what you can."],
        ]),
        t('quill_dp2_scared', "Are you scared?", [
          ['quill', "Terrified. But it is easier to be scared behind a counter."],
        ]),
      ],
    },
    fs: {
      greet: ["Tomorrow the great expedition! I have packed the wagon. I have packed the other wagon. There is no other wagon."],
      topics: [
        t('quill_fs_wagon', "Bringing the wagon?", [
          ['quill', "The wagon comes. The wagon has never not come. It is the only thing I own that is loyal."],
        ]),
        t('quill_fs_truth', "Your rumors...", [
          ['quill', "Every rumor I ever told you was a guess. Every guess was a wish. And every wish, so far, has come true. I am reconsidering my career."],
        ]),
        t('quill_fs_last', "One last rumor?", [
          ['quill', "The lake is warm. The gulls are polite. Someone is waiting on the pier with a hot drink. It's a rumor. It's free."],
        ]),
      ],
    },
  },

  // =============================================================================== DUTCH
  dutch: {
    rh2: {
      greet: ["My diesel. My rig. My rules. Which of those is the problem?"],
      topics: [
        t('dutch_rh2_invoice', "Have you invoiced us?", [
          ['dutch', "Eleven hundred for the fuel, four hundred for the escort, two hundred for emotional support. Nineteen hundred. Payable in nothing, because money died on Day six. But I keep the ledger."],
        ]),
        t('dutch_rh2_crew', "What happened to your crew?", [
          ['dutch', "They went to the lake. Said it was the only place with a future. I said wait for me. Then I sat in a truck stop for a month."],
        ]),
        t('dutch_rh2_rig', "The rig?", [
          ['dutch', "Peterbilt. Older than you. Never missed a delivery. Missed the last forty days."],
        ]),
        t('dutch_rh2_big', "Big Dutch?", [
          ['dutch', "Nobody calls me that. Say it again and it's a hundred dollars."],
        ]),
      ],
    },
    dp1: {
      greet: ["You're standing on my parking space. It's a rail yard. I've parked here nineteen minutes and I'm already territorial."],
      topics: [
        t('dutch_dp1_ferry', "About the ferry...", [
          ['dutch', "I've hauled everything. Cattle, cars, cargo. Never a boat. It's a truck with a wet bottom."],
        ], { when: { flags: ['marine_pump'] } }),
        t('dutch_dp1_pay', "You still charge us?", [
          ['dutch', "I charge to feel normal. You keep existing, which is a service. Balance it out."],
        ]),
        t('dutch_dp1_priya', "Priya?", [
          ['dutch', "She measured my rig with a tape and said 'oh.' Nobody's said 'oh' about my rig in twenty years."],
        ]),
      ],
    },
    dp2: {
      greet: ["Fuel gauge says half. Fuel gauge lies. Everything lies. Except the ledger."],
      topics: [
        t('dutch_dp2_okafor', "The Sergeant?", [
          ['dutch', "She stood at attention while I explained my rates. I felt seen. And investigated."],
        ], { when: { done: ['m4_1'] } }),
        t('dutch_dp2_fuel', "How's the fuel?", [
          ['dutch', "Half a tank and a prayer. I haven't prayed since '09."],
        ]),
        t('dutch_dp2_danny', "Danny?", [
          ['dutch', "Kid makes me want to be a better person. I resent him for it."],
        ], { when: { done: ['m4_2'] } }),
      ],
    },
    fs: {
      greet: ["Tomorrow I lead the convoy. Twenty tons of diesel, forty souls and one very loud horn."],
      topics: [
        t('dutch_fs_convoy', "Ready to lead the convoy?", [
          ['dutch', "I've led worse. I led a parade once. It went into a lake. I mean... never mind."],
        ]),
        t('dutch_fs_bill', "And the bill?", [
          ['dutch', "I've decided to forgive the whole thing. Don't tell anyone. It ruins my reputation."],
        ]),
        t('dutch_fs_crew', "Your old crew...", [
          ['dutch', "If they're at the lake, I'll drive up to the pier honking. They'll say 'Dutch, you're late.' I'll say 'it's an invoice.'"],
        ]),
      ],
    },
  },

  // =============================================================================== WENDELL (range)
  wendell: {
    dp1: {
      greet: ["The range is out back. Cans on a fence. Honest targets. I'll hold your coat."],
      topics: [
        t('wendell_dp1_biscuit', "Tell me about Biscuit.", [
          ['wendell', "German shepherd. Nine years. I trained him to find things. Turned out what he was best at finding was trouble."],
        ], { when: { notFlags: ['found_biscuit'] } }),
        t('wendell_dp1_found', "About Biscuit...", [
          ['wendell', "You found him. You found my dog. I... give me a moment."],
          ['wendell', "He's asleep in the boxcar with one ear up. He's still terrible at 'stay.' It's the best thing that's happened to me all year."],
        ], { when: { flags: ['found_biscuit'] } }),
        t('wendell_dp1_range', "How does the range work?", [
          ['wendell', "Shoot the targets. Watch the numbers. Get better. It's the same as training a dog, except the dog is you."],
        ]),
        t('wendell_dp1_slow', "Any advice on the slow ones?", [
          ['wendell', "Treat 'em like a stubborn old dog. Don't run. Don't turn your back. Walk backward, keep your eyes on them, and let them come to you."],
        ]),
        t('wendell_dp1_bowl', "About the bowl...", [
          ['wendell', "Habit. Good habit. Never hurt anyone."],
        ]),
      ],
    },
    dp2: {
      greet: ["Good crew. Good crew. Range's open whenever you are."],
      topics: [
        t('wendell_dp2_bond', "How's Biscuit?", [
          ['wendell', "Biscuit has decided the boxcar is his. He's asleep on Priya's map. She's letting him."],
        ], { when: { flags: ['found_biscuit'] } }),
        t('wendell_dp2_nodog', "Still no sign of him?", [
          ['wendell', "No. But he knows 'stay.' He's terrible at it. So if he's staying somewhere, he's staying for a reason."],
        ], { when: { notFlags: ['found_biscuit'] } }),
        t('wendell_dp2_k9', "Were you a police handler?", [
          ['wendell', "Thirty-one years. Best partner I ever had was on four legs. Best partner I ever lost was on four legs too."],
        ]),
        t('wendell_dp2_ghosts', "The ridge...", [
          ['wendell', "I've buried three dogs and a partner. I won't tell you it gets easier. I'll tell you it gets more shared."],
        ], { when: { done: ['m4_3'] } }),
      ],
    },
    fs: {
      greet: ["Barn's got good hay. Some dogs would give up a kidney for a barn like that."],
      topics: [
        t('wendell_fs_leash', "Why the leash?", [
          ['wendell', "It's not for holding him. It's for holding me. Habit."],
        ]),
        t('wendell_fs_boat', "Coming on the ferry?", [
          ['wendell', "I go where the good crew goes. Good crew. Good crew."],
        ]),
        t('wendell_fs_hope', "Do you still hope?", [
          ['wendell', "Hope's a dog at the door. You don't have to hear it bark. You just leave the door open."],
        ]),
      ],
    },
  },

  // =============================================================================== DANNY (armory assistant)
  danny: {
    dp2: {
      greet: ["Reporting, ma'am! I mean everyone! Radio room's ready and I've eaten ten crackers!"],
      topics: [
        t('danny_dp2_letters', "Do you write letters?", [
          ['danny', "Every night. To my mom, in Fresno. I don't mail them. There's no mail. But she'll read them all at once someday. It'll be like a novel."],
        ]),
        t('danny_dp2_kip', "Tell me about Kip.", [
          ['danny', "He wrote his name on his hat, his lunch and his rifle. He said if he died at least everybody would know whose lunch it was."],
        ], { when: { done: ['m4_3'] } }),
        t('danny_dp2_okafor', "What's the Sergeant like?", [
          ['danny', "The best. She'd die before she said it. She knows every name, every birthday. She wrote my mom's address inside her helmet. In case."],
        ]),
        t('danny_dp2_crackers', "Why the crackers?", [
          ['danny', "Kip said crackers are a kind of hope you can eat."],
        ]),
      ],
    },
    fs: {
      greet: ["Last letter before the boat, ma'am! I mean, everyone!"],
      topics: [
        t('danny_fs_letter', "What does it say?", [
          ['danny', "'Dear Mom, I'm going to a boat tomorrow. It has a horn. I'll try to blow it. Don't worry. Love, Danny.'"],
        ]),
        t('danny_fs_hill', "Radio Hill...", [
          ['danny', "Sarge said don't name the hill. So it's just 'the Hill.' In my head it's called Music Mountain."],
        ]),
        t('danny_fs_scared', "Nervous?", [
          ['danny', "Yes, ma'am. I mean... yes. But Sarge is driving the rear truck, so it's fine."],
        ]),
      ],
    },
  },
};
