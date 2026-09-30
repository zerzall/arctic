// CHAPTER 2 — HOLLOW CREEK. The crew lives at the Roadhouse and goes out from the mission board:
// a town by day for the kids' antibiotics, then Mara's old hospital by night, where the helipad radio
// reaches the Warden for the first time.
// Zombies: walkers, runners, crawlers (virtual wave 2-3); one swollen patient in surgery is the first bloater.

import { radio, say, L, PS, A, arrive, kill, noteStep } from './lib.js';

export const CH2 = [
  // ------------------------------------------------------------------------------------------
  // Hollow Creek by day: the town line, Main Street, the Rexall (looted, the back room isn't), St. Anne's
  // (the bell rings on its own), the elementary school (Ms. Delaney's message) and the police station,
  // where Deke picks the crew up in the tow truck.
  {
    id: 'm2_1', chapter: 2, index: 1, title: 'Hollow Creek',
    blurb: 'Six of the kids have a fever. The nearest pharmacy is on Main Street in Hollow Creek, six miles north, in a town of two thousand that is not two thousand people any more.',
    map: 'hollowcreek', time: 'day', mode: 'free', level: [3, 4], party: { min: 1, max: 6 },
    requires: ['m1_2'], hub: 'roadhouse', after: 'hideout:roadhouse',
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. MORNING.'),
      L('mara', 'Six of the kids have a fever. Tobias\'s cut is infected. I have aspirin and good intentions, and neither one is an antibiotic.'),
      L('ozzy', 'Hollow Creek is six miles north. Rexall pharmacy on Main Street. It has a sign shaped like a mortar and pestle.'),
      L('deke', 'Hollow Creek was two thousand people. It won\'t be two thousand people now. It\'ll be two thousand of something.'),
      L('mara', 'Amoxicillin. Cephalexin. Anything that ends in "cillin." The front shelves will be empty. The back room never is.'),
      L('roz', 'Pharmacists lock the back room. Every pharmacist I ever met locked everything, including their feelings.'),
      L('deke', 'I\'ll drop you at the town line and circle round. I pick you up at the police station on the far side, where the road out is.'),
      L('june', 'Is Tobias going to be okay?'),
      L('mara', 'He\'s going to be fine, because these people are going to be quick.'),
      L('ozzy', 'Radios on channel three. I\'ll be your eyes. My eyes are a map from a gas station. It\'s a very good map.'),
    ],
    steps: [
      // ---- TOWN LINE ----------------------------------------------------------------------
      kill('townline', 'walker', 10, 'Clear the town line (0/10)', {
        pressure: PS('outskirts', 2, 0.5),
        onStart: [
          A.title('HOLLOW CREEK', 'Town line. Pop. 2,210'),
          A.music('tension'),
          radio('deke', 'Out you get. I\'ll circle round to the police station. If I\'m not there, I\'m late. If I\'m late, I\'m fine.'),
        ],
      }),
      {
        id: 'watertower', type: 'reach', at: 'water_tower', hold: 4, text: 'Climb the water tower and look over the town', pressure: PS('outskirts', 2, 0.4),
        onStart: [radio('ozzy', 'The water tower. Get up high and tell me what\'s between you and the pharmacy.')],
        onDone: [
          radio('ozzy', 'You see the church steeple? The pharmacy is past the fountain, left side. The police station is behind the school.'),
          radio('mara', 'And Main Street is blocked with cars and planks. Somebody built a wall. Somebody lost it.'),
        ],
      },
      {
        id: 'winch', type: 'activate', at: ['welcome_sign'], hold: 10, text: 'Run the fire truck\'s winch cable to the barricade (hold E)', kind: 'winch', pressure: PS('outskirts', 2, 0.9),
        onStart: [
          A.hordeIn('outskirts', 8, 'walker'),
          radio('ozzy', 'There\'s a fire truck by the welcome sign with a winch on the front. The internet says winches fix everything.'),
        ],
        onDone: [A.gate('main_barricade', 1), A.shake(0.5, 1), radio('ozzy', 'It came apart! Planks everywhere! That was so satisfying I need to sit down.')],
      },

      // ---- MAIN STREET --------------------------------------------------------------------
      arrive('main', 'mainstreet', 'Through the wreck of the barricade onto Main Street', ['MAIN STREET', 'Hollow Creek. Est. 1871'], {
        lines: [radio('ozzy', 'Main Street. Diner on the left, hardware store, a fountain, and the Rexall with the mortar and pestle. Go.')],
      }),
      kill('street', 'any', 16, 'Clear Main Street (0/16)', {
        pressure: PS('mainstreet', 2, 0.8),
        onStart: [
          A.music('battle'),
          A.horde('main_diner', 8),
          radio('ozzy', 'The diner! They\'re coming out of the diner! Somebody propped the door with a chair!'),
        ],
        onDone: [radio('mara', 'The pharmacy shutter is down. Electric. No power on the street.')],
      }),
      {
        id: 'power', type: 'activate', at: ['main_hardware'], hold: 10, text: 'Start the hardware store generator: the pharmacy shutter is electric (hold E)', kind: 'generator',
        pressure: PS('mainstreet', 2, 1.0),
        onStart: [A.horde('main_fountain', 6), radio('ozzy', 'Generators are loud. Loud is bad. Loud is also the only plan we have. Go.')],
        onDone: [A.gate('pharmacy_gate', 2), A.music('tension', 2), radio('mara', 'It\'s rolling up! Go, go, before something else hears it.')],
      },

      // ---- REXALL PHARMACY ---------------------------------------------------------------
      arrive('rexall', 'pharmacy', 'Under the shutter into the Rexall', ['REXALL PHARMACY', 'Looted. Mostly.'], {
        lines: [radio('mara', 'Front counter first. Then the back room. And mind the shelves, somebody always hides behind the shelves.')],
      }),
      {
        id: 'shelves', type: 'collect', item: 'medicine', count: 2, at: ['pharmacy_counter'], text: 'Search behind the counter (0/2)', pressure: PS('pharmacy', 2, 0.5),
        onDone: [radio('mara', 'Aspirin and cough syrup. That\'s a start, not a cure. The back room. It\'s always the back room.')],
      },
      {
        id: 'backroom', type: 'activate', at: ['pharmacy_back'], hold: 12, text: 'Pry open the back room door (hold E)', pressure: PS('pharmacy', 3, 0.8, ['crawler']),
        onStart: [A.music('battle'), radio('roz', 'I told you. Locked. Pharmacists and their feelings.')],
        onDone: [A.horde('pharmacy_back', 6, 'crawler'), radio('ozzy', 'Something in there was waiting behind the door! Low! Low! They\'re LOW!')],
      },
      {
        id: 'antibiotics', type: 'collect', item: 'medicine', count: 3, at: ['pharmacy_back'], text: 'Take the antibiotics from the back room (0/3)', pressure: PS('pharmacy', 3, 0.6),
        onDone: [
          radio('mara', 'Amoxicillin. Cephalexin. Oh, you beautiful people. That\'s Tobias\'s arm saved.'),
          A.gate('church_gate', 3),
          radio('ozzy', 'Deke says Main Street is filling up behind you. Out the back, through St. Anne\'s churchyard.'),
        ],
      },

      // ---- ST. ANNE'S --------------------------------------------------------------------
      arrive('stanne', 'church', 'Out the back door into St. Anne\'s churchyard', ['ST. ANNE\'S', 'Churchyard. Very quiet.'], {
        music: 'calm',
        lines: [radio('ozzy', 'St. Anne\'s. Nice and quiet. I don\'t trust nice and quiet. Nothing in this county is nice and quiet.')],
      }),
      {
        id: 'bell', type: 'survive', seconds: 45, text: 'The bell is ringing on its own! Hold the churchyard', pressure: PS('church', 3, 1.2),
        onStart: [
          A.music('battle'),
          A.shake(0.3),
          A.horde('church_doors', 10),
          radio('mara', 'Is that the BELL? Who is ringing the bell?'),
          radio('ozzy', 'Nobody! There\'s nobody in the tower! It\'s ringing by itself, and the whole town can hear it!'),
        ],
      },
      {
        id: 'rope', type: 'activate', at: ['church_bell'], hold: 10, text: 'Climb into the bell tower and cut the rope (hold E)', pressure: PS('church', 3, 0.9),
        onDone: [
          A.music('tension'),
          radio('mara', 'Somebody was tangled in the rope. The sexton, I think. Every time he moved, he rang.'),
          radio('mara', 'He was ringing for help on Day 6. He\'s been ringing ever since. Let him go.'),
        ],
      },
      {
        id: 'schoolfence', type: 'activate', at: ['church_yard'], hold: 6, text: 'Cut through the school fence behind the graves (hold E)', pressure: PS('church', 3, 0.7),
        onDone: [A.gate('school_fence')],
      },

      // ---- HOLLOW CREEK ELEMENTARY -------------------------------------------------------
      arrive('elementary', 'school', 'Through the fence onto the school field', ['HOLLOW CREEK ELEMENTARY', 'Go Hornets'], {
        lines: [radio('mara', 'A school. There\'s a yellow bus in the lot. It isn\'t ours. I keep thinking it\'s ours.')],
      }),
      kill('gym', 'any', 14, 'The gym doors burst open: fight them off (0/14)', {
        pressure: PS('school', 3, 0.9),
        onStart: [
          A.horde('school_gym', 12),
          A.music('battle'),
          radio('ozzy', 'The gym was the shelter. The flyers all said "go to the school gym." Oh no. Oh, no.'),
        ],
      }),
      {
        id: 'office', type: 'reach', at: 'school_office', hold: 3, text: 'Search the school office', pressure: PS('school', 2, 0.4),
        onStart: [radio('ozzy', 'The office. Schools keep keys for everything. Schools are basically key museums.')],
      },
      {
        id: 'chalk', type: 'dialogue', pressure: false, lines: [
          L('narrator', 'On the office chalkboard, in a teacher\'s neat capitals:'),
          L('narrator', 'RIVERBEND BUS 9-C IS ON HIGHWAY 9, MILE 71. FOURTEEN CHILDREN. SEND HELP. GONE TO THE LAKE FOR BOATS. R. DELANEY, DAY 7.'),
          radio('mara', 'That\'s June\'s teacher. That\'s Ms. Delaney.'),
          radio('mara', 'She didn\'t leave them. She went for boats. She walked all the way here to write it on a wall.'),
          radio('ozzy', 'Do we tell June?'),
          radio('mara', 'Not until I know how the story ends. Take a picture of it. Take ten.'),
        ],
      },
      {
        id: 'keys', type: 'collect', item: 'key', count: 1, at: ['school_office'], text: 'Take the school officer\'s key ring: one opens the police sally port',
        pressure: PS('school', 3, 0.7),
        onDone: [A.gate('police_gate', 2), radio('ozzy', 'The school had a police officer, and the police officer had a key ring. America is a strange country.')],
      },

      // ---- POLICE STATION ----------------------------------------------------------------
      arrive('station', 'police', 'Through the sally port into the police station', ['POLICE STATION', 'Hollow Creek P.D.'], {
        lines: [radio('deke', 'Police station, back lot. That\'s my pickup. The armory is inside, if the town left you anything.')],
      }),
      {
        id: 'armory', type: 'activate', at: ['police_armory'], hold: 10, text: 'Open the armory cage (hold E)', pressure: PS('police', 3, 0.7),
        onStart: [A.dark('police'), radio('deke', 'Two minutes out. Whatever you\'re doing in there, do it faster.')],
        onDone: [radio('mara', 'Patrol rifles. Clean ones. Take them. The town won\'t mind.')],
      },
      {
        id: 'cells', type: 'survive', seconds: 40, text: 'The cell doors are opening! Hold the station', pressure: PS('police', 3, 1.3, ['runner', 'crawler']),
        onStart: [
          A.light('police'),
          A.horde('police_cells', 10),
          A.music('battle'),
          radio('ozzy', 'The power just came back on. The cell doors are on the power. The cell doors are OPENING.'),
        ],
      },
      {
        id: 'pickup', type: 'defend', target: 'police_lot', seconds: 60, text: 'Hold the lot until Deke\'s truck pulls in', pressure: PS('police', 3, 1.0),
        onStart: [radio('deke', 'I see the station. I see a lot of them round the station. Hold the lot, I\'m coming in hot.')],
        onDone: [radio('deke', 'Get in! Mind the medicine! Mind my seats! Mostly the medicine!')],
      },
      {
        id: 'out', type: 'reach', at: 'police_exit', hold: 3, who: 'all', text: 'Everyone into the truck', pressure: PS('police', 2, 0.4),
        onDone: [A.music('calm'), radio('mara', 'Medicine in the truck. Crew in the truck. Home.')],
      },
    ],
    bonus: [
      noteStep('n22', 'pharmacy_counter', 'Read the pharmacist\'s note by the till (optional)', 'shelves'),
      noteStep('n23', 'police_cells', 'Read the last entry in the cell log (optional)', 'armory'),
      {
        id: 'wish', type: 'activate', at: ['main_fountain'], hold: 2, text: 'Toss a coin in the fountain for June (optional)',
        since: 'street', flags: { june_wish: true }, todo: 'stepFlags',
        onDone: [radio('ozzy', 'Did you just make a wish? For June? That\'s so nice I\'m going to pretend I didn\'t hear it.')],
      },
    ],
    rewards: {
      xp: 420, scrap: 90, weapon: 'rifle', upgradePoints: 1, flags: { antibiotics: true, delaney_message: true },
    },
    debrief: [
      L('mara', 'Tobias\'s fever broke at two in the morning. The others by breakfast. I sat with them all night and didn\'t count once.'),
      L('june', 'Miss Mara was humming. She never hums.'),
      L('mara', 'I was not humming.'),
      L('june', 'You were humming the dentist song.'),
      L('deke', 'Rifles from the police armory. Clean, oiled, and one of them has a sticker of a cat on it. That one\'s yours.'),
      L('ozzy', 'About the chalkboard...'),
      L('mara', 'Not yet, Ozzy.'),
      L('ozzy', 'Not yet. Okay. I\'ll keep the pictures safe. They\'re in the bag I sit on.'),
    ],
    stars: { time: 1200, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },

  // ------------------------------------------------------------------------------------------
  // Saint Mercy by night: Mara's old hospital, where the first sleepers were treated. The ambulance bay,
  // the ER, Ward C (case files, the generator, the insulin), surgery, Stair B in the dark and the helipad,
  // whose radio reaches the Warden for the first time. She is fifteen.
  {
    id: 'm2_2', chapter: 2, index: 2, title: 'Saint Mercy',
    blurb: 'Mara\'s old hospital, where the first sleepers were brought on Day 2. Insulin for Tobias, the case files, a generator, and a radio mast on the roof that reaches all the way to the lake.',
    map: 'hospital', time: 'night', mode: 'free', level: [5, 6], party: { min: 1, max: 6 },
    requires: ['m2_1'], hub: 'roadhouse', after: 'hideout:roadhouse',
    npcs: [{ id: 'mara', at: 'start', mode: 'follow' }],
    briefing: [
      L('narrator', 'DAY {day}. THE ROADHOUSE. LATE.'),
      L('mara', 'Saint Mercy. I worked nights in that emergency room for six years. It\'s where they took the first sleepers, on Day 2.'),
      L('mara', 'Tobias is diabetic and his pen is empty. Ward C has a fridge on its own generator. If it\'s running, so is he.'),
      L('mara', 'And the case files. Somebody in that building knew what this was before it had a name. I want to read it.'),
      L('ozzy', 'And the helipad has a radio mast. The tallest antenna in the county. If we talk from up there, she\'d HEAR us.'),
      L('deke', 'At night. You want to walk into a hospital at night.'),
      L('mara', 'I know how that building breathes. I know where every door goes. And the kids can\'t wait for morning.'),
      L('roz', 'Then take a thermos. Nobody walks into a hospital without coffee. It\'s the law.'),
      L('mara', 'I\'m coming with you this time. Don\'t argue. I know where they keep everything, including the exits.'),
      L('june', 'Miss Mara, bring back a lollipop from the doctor place.'),
    ],
    steps: [
      // ---- AMBULANCE BAY ----------------------------------------------------------------
      kill('bay', 'walker', 10, 'Clear the ambulance bay (0/10)', {
        pressure: PS('parking', 3, 0.5),
        onStart: [
          A.title('SAINT MERCY', 'Ambulance bay. Night'),
          A.music('tension'),
          say('mara', 'The ambulances used to queue right here. Four deep on a bad night. Five on a full moon.'),
        ],
      }),
      {
        id: 'bags', type: 'collect', item: 'medkit', count: 2, at: ['ambulance'], text: 'Search the ambulances for trauma bags (0/2)', pressure: PS('parking', 3, 0.4),
        onDone: [say('mara', 'Somebody restocked these on Day 1. Somebody did their job right up to the end.')],
      },
      {
        id: 'chain', type: 'activate', at: ['er_doors'], hold: 8, text: 'Cut the chain on the ER doors (hold E)', pressure: PS('parking', 3, 0.8),
        onStart: [say('mara', 'Someone chained the ER from the outside. That\'s either a warning or a promise.')],
        onDone: [A.gate('er_doors'), A.horde('er_doors', 10), A.music('battle'), say('mara', 'A warning. It was a warning. Back up!')],
      },

      // ---- EMERGENCY -------------------------------------------------------------------
      arrive('er', 'er', 'Fight your way into the emergency department', ['EMERGENCY', 'Saint Mercy Hospital'], {
        lines: [say('mara', 'Triage is left. The nurses\' desk is straight on. The pharmacy is locked, always.')],
      }),
      kill('triage', 'any', 14, 'The gurneys in triage are moving (0/14)', {
        pressure: PS('er', 3, 0.9, ['crawler']),
        onStart: [A.horde('er_triage', 10), say('mara', 'Those were my patients. Were. Don\'t look at their faces. I will.')],
      }),
      {
        id: 'code', type: 'activate', at: ['er_pharmacy'], hold: 6, text: 'Punch Mara\'s old code into the ER pharmacy lock (hold E)', pressure: PS('er', 3, 0.6),
        onDone: [say('mara', 'Four four one nine. The fire station\'s number. Six years, and nobody ever changed it.')],
      },
      {
        id: 'keycard', type: 'collect', item: 'keycard', count: 1, at: ['er_desk'], text: 'Take the charge nurse\'s key card from the desk', pressure: PS('er', 3, 0.5),
        onDone: [A.gate('ward_doors', 1), say('mara', 'Ward C. The generator ward. If the fridge is running, Tobias has his insulin.')],
      },

      // ---- WARD C ---------------------------------------------------------------------
      arrive('ward', 'wards', 'Through the doors into Ward C', ['WARD C', 'Isolation. Authorised staff only'], {
        lines: [say('mara', 'Isolation. This is where they put the first ones. We thought it was a sleeping sickness. For two days, it was.')],
      }),
      {
        id: 'files', type: 'collect', item: 'files', count: 3, at: ['ward_records'], text: 'Take the case files from records (0/3)', pressure: PS('wards', 3, 0.6),
        onDone: [say('mara', 'Patient one. Brought in asleep on Day 1. Woke on Day 3. Never spoke. Walked toward the nurses\' voices.')],
      },
      {
        id: 'generator', type: 'activate', at: ['ward_generator'], hold: 14, text: 'Restart the ward generator (hold E)', kind: 'generator', pressure: PS('wards', 3, 1.0),
        onStart: [A.dark('wards'), A.music('battle'), say('mara', 'And the lights just went. The generator coughed out. Flashlights up, and get it running.')],
        onDone: [A.light('wards'), A.light('surgery'), A.music('tension'), say('mara', 'Lights. Oh, I missed that hum.')],
      },
      {
        id: 'insulin', type: 'collect', item: 'insulin', count: 1, at: ['ward_nurses'], text: 'Get the insulin from the nurses\' fridge', pressure: PS('wards', 3, 0.6),
        onDone: [
          say('mara', 'Cold. Still cold. Tobias, you lucky boy.'),
          A.gate('surgery_doors', 2),
          say('mara', 'Surgery is the way up. The roof stairs are behind the theatres.'),
        ],
      },

      // ---- SURGERY ----------------------------------------------------------------------
      arrive('surgery', 'surgery', 'Through the doors into Surgery', ['SURGERY', 'Theatres one to four'], {
        lines: [say('mara', 'Theatre two has its light on. Nobody leaves a theatre light on. Stay behind me.')],
      }),
      kill('table', 'bloater', 1, 'The patient on the table is not asleep', {
        at: 'surgery_theatre', pressure: PS('surgery', 3, 0.5),
        onStart: [A.music('boss'), say('mara', 'Don\'t shoot it close! The swollen ones burst. Back up. Further. FURTHER.')],
        onDone: [A.music('tension'), say('mara', 'Dr. Pham\'s last patient. His notes are on the tray. He stayed with him until the end.')],
      }),
      {
        id: 'alarm', type: 'activate', at: ['surgery_scrub'], hold: 4, text: 'Pull the fire alarm to release the stairwell door (hold E)', pressure: PS('surgery', 3, 1.2, ['crawler']),
        onStart: [say('mara', 'Stair B is on the fire circuit. Pull the alarm and the magnets let go. So will everything else in the building.')],
        onDone: [A.gate('stair_door'), A.hordeIn('surgery', 12), A.shake(0.3), A.music('battle')],
      },

      // ---- STAIR B ---------------------------------------------------------------------
      arrive('stairs', 'stairwell', 'Into Stair B', ['STAIR B', 'Roof access. Six floors'], {
        lines: [
          A.dark('stairwell'),
          A.dark('surgery'),
          A.dark('wards'),
          say('mara', 'And there goes the generator. The alarm drained it. Flashlights. Up. Keep going up.'),
        ],
      }),
      {
        id: 'climb', type: 'reach', at: 'stair_top', text: 'Climb Stair B in the dark', pressure: PS('stairwell', 3, 0.8, ['crawler']),
        onStart: [radio('ozzy', 'Six floors. The roof door is a shutter with a hand crank. Sorry. I read the fire plan.')],
      },
      {
        id: 'crank', type: 'activate', at: ['stair_top'], hold: 12, text: 'Crank the roof shutter open by hand (hold E)', pressure: PS('stairwell', 3, 1.1, ['crawler', 'runner']),
        onDone: [A.gate('roof_door'), A.music('tension')],
      },

      // ---- THE HELIPAD ------------------------------------------------------------------
      arrive('roof', 'roof', 'Out onto the helipad', ['THE HELIPAD', 'Saint Mercy roof. Night wind'], {
        lines: [say('mara', 'Look at that. You can see the Roadhouse sign from here. NO VAC. Somebody left it on for us.')],
      }),
      {
        id: 'mast', type: 'activate', at: ['roof_radio'], hold: 10, text: 'Power the helipad radio (hold E)', kind: 'radio', pressure: PS('roof', 3, 0.7),
        onStart: [radio('ozzy', 'The helipad radio! Tune it to seven point zero seven four. That\'s where she lives.')],
      },
      {
        id: 'call', type: 'wait', seconds: 2, parallel: true,
        onDone: [
          radio('mara', 'Haven, Haven. This is Saint Mercy Hospital. Anyone at all. Over.', 3400),
          radio('warden', '...Haven is open. Lake Harlan Marina. The last ferry sails at the end of the...', 4200),
          radio('warden', 'Oh. Oh! Somebody\'s there. Hi. Um. Hello. This is Haven. Over.', 3400),
          radio('mara', 'Who am I talking to?', 2000),
          radio('warden', 'The Warden. That\'s what the... that\'s what the radio calls me.', 3200),
          radio('mara', 'You sound young.', 2000),
          radio('warden', '...I\'m fifteen. My grandpa did the broadcast. He wrote it. I read it every night, so it doesn\'t stop.', 5200),
          radio('mara', 'Is there a ferry, sweetheart?', 2400),
          radio('warden', 'There is. It doesn\'t run. Grandpa left a list. Fuel, a regulator, injectors. I don\'t know what those are.', 5200),
          radio('ozzy', 'We\'ll find out what they are. We\'ll bring the list.', 2800),
          radio('warden', 'You would? Um. Okay. How many of you are there?', 3000),
          radio('mara', 'Fourteen kids and a very stubborn crew.', 2600),
          radio('warden', 'Fourteen. Okay. I\'ll count you in. Please hurry. Warden out. ...Over. Sorry. Over and out.', 5200),
        ],
      },
      {
        id: 'hold', type: 'defend', target: 'roof_radio', seconds: 110, text: 'Hold the helipad while the radio talks to Haven', pressure: PS('stairwell', 3, 1.0, ['runner']),
        onStart: [A.music('battle'), say('mara', 'They followed us up the stairs. Keep them off that radio. Nobody touches that radio.')],
      },
      {
        id: 'escape', type: 'reach', at: 'helipad', hold: 4, who: 'all', text: 'Down the fire escape to Deke\'s truck', pressure: PS('roof', 3, 0.6),
        onStart: [radio('deke', 'North side of the roof. There\'s a fire escape, and at the bottom of it there\'s me.')],
        onDone: [A.music('calm'), say('mara', 'Fifteen. She\'s fifteen.')],
      },
    ],
    bonus: [
      noteStep('n24', 'ward_records', 'Read the admission log for Day 1 (optional)', 'files'),
      noteStep('n25', 'er_desk', 'Read the visitor book at the ER desk (optional)', 'triage'),
      {
        id: 'lollipop', type: 'collect', item: 'supplies', count: 1, at: ['er_triage'], text: 'Find June a lollipop in the triage drawers (optional)',
        since: 'code', flags: { june_lollipop: true }, todo: 'stepFlags',
        onDone: [say('mara', 'Cherry. The whole drawer is full. Nobody took the lollipops. In a whole hospital.')],
      },
    ],
    rewards: {
      xp: 480, scrap: 100, weapon: 'uzi', upgradePoints: 1, flags: { warden_contact: true, warden_is_kid: true, insulin_found: true, case_files: true },
    },
    debrief: [
      L('mara', 'Fifteen. She\'s fifteen, and she has been reading that script alone every night.'),
      L('ozzy', 'I knew it was live. I didn\'t know it was a kid. I think I\'d rather it was a trap. A trap can look after itself.'),
      L('deke', 'A kid with a boat and a shopping list. Fuel, a regulator, injectors. I know what all three of those are.'),
      L('mara', 'Then we go to her. Not because Haven is open. Because she is.'),
      L('june', 'Did you get my lollipop?'),
      { ...L('mara', 'Cherry. Nobody in that whole hospital took the lollipops, June. Not one.'), when: { flags: ['june_lollipop'] } },
      { ...L('mara', 'I forgot. I\'m sorry, sweetheart. I\'ll owe you a lollipop and a story.'), when: { notFlags: ['june_lollipop'] } },
      L('roz', 'Tobias is asleep with his insulin under his pillow. He says it\'s his treasure. I didn\'t have the heart to say fridge.'),
    ],
    stars: { time: 1260, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph,level',
  },
];
