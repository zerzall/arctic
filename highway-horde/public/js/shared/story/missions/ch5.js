// CHAPTER 5 — HARLAN COUNTY (harlan). The crew leaves the Depot for the long road to the lake.
// 5.1 is an Evac Run (moving safe zones); 5.2 is a collect-and-hold with the first boss.
// The chapter ends at the Harlan Farmstead. Zombies: the full mix, virtual wave 5-7.

import { radio, L, P, kill, boss, noteStep } from './lib.js';

export const CH5 = [
  // ------------------------------------------------------------------------------------------
  {
    id: 'm5_1', chapter: 5, index: 1, title: 'Down the Interstate',
    blurb: 'Fifty miles of open county and a safe zone that will not stand still. Run the interstate from one refuge to the next before the dead close the gap.',
    map: 'harlan', time: 'day', mode: 'zone', level: [10, 11], party: { min: 1, max: 6 },
    requires: ['m4_3'], hub: 'depot', after: 'm5_2',
    briefing: [
      L('narrator', 'DAY 56. BLACKWATER DEPOT. DEPARTURE.'),
      L('priya', 'County line at mile eleven. Harlan County. Fifty miles of farmland, three towns, one interstate, and a map with a lot of blank spaces.'),
      L('deke', 'Harlan County. Named for my great-granddad. He won it in a card game and lost it in the next one. Don\'t touch anything, it\'s all mortgaged.'),
      L('dutch', 'The rig will follow at a distance. I charge by the mile and by the fear.'),
      L('okafor', 'The interstate is the fastest route and the worst. Nothing on it is friendly and nothing moves in a straight line. Keep moving.'),
      L('ozzy', 'The Warden says the storm front hits the lake on Day fifty-eight. The ferry was going to wait until sixty. It can\'t anymore.'),
      L('mara', 'Then we don\'t stop.'),
      L('priya', 'Actually, we do stop. Four times. The interchange, the quarry, the Gas-N-Go, Main Street. Everything between them is open ground.'),
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
        onDone: [radio('dutch', 'The Gas-N-Go sign is on fire. Just so you know. Not my fault. I wasn\'t there.')],
      },
      {
        id: 'radio3', type: 'wait', seconds: 230, parallel: true,
        onDone: [radio('warden', 'KD9-OZZ, Haven. The storm front is on the radar. It\'s on the... on the barometer. It\'s close. Please hurry.')],
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
        onDone: [radio('priya', 'Main Street. Day fifty-six. Population: us.')],
      },
    ],
    bonus: [noteStep('n16', 'i70Interchange', 'Look at the overpass sign (optional)', 'run')],
    rewards: {
      xp: 600, scrap: 180, weapon: 'hmg', upgradePoints: 1, flags: { interstate_cleared: true },
    },
    debrief: [
      L('priya', 'Main Street. I\'m entering it in the book. Day fifty-six. Population: us.'),
      L('mara', 'That\'s a joke.'),
      L('priya', 'It\'s a map entry.'),
      L('june', 'The sign said forty-one miles to the water. Forty-one is the day you found our bus.'),
      L('ozzy', 'June. Nobody else noticed that. Nobody.'),
      L('june', 'I count things. It\'s my whole personality.'),
      L('deke', 'Forty-one miles. I\'ve done worse in a bad truck.'),
      L('okafor', 'Ten miles of that is cornfield. Nobody has ever won a war in a cornfield.'),
      L('mara', 'We aren\'t going to war, Sergeant. We\'re going to a boat.'),
    ],
    stars: { time: 720, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },

  // ------------------------------------------------------------------------------------------
  {
    id: 'm5_2', chapter: 5, index: 2, title: 'Field Hospital',
    blurb: 'An army field hospital on the east side, tents full of patients and a pharmacy full of everything the ferry will need. Something large has been feeding there.',
    map: 'harlan', time: 'night', mode: 'free', level: [11, 12], party: { min: 1, max: 6 },
    requires: ['m5_1'], hub: null, after: 'hideout:farmstead',
    briefing: [
      L('narrator', 'DAY 57. MAIN STREET. DUSK.'),
      L('mara', 'There\'s a field hospital on the east side. Army tents, medical crates and, if the radio is right, a surgeon with a beard and a stubborn streak.'),
      L('ozzy', 'Dr. Ellery. He has been on a loop asking for anyone with a truck, a generator, or a sense of humor.'),
      L('mara', 'We have two out of three.'),
      L('deke', 'We have a truck.'),
      L('mara', 'I spent six years in an ER. I know what a field hospital looks like on Day fifty-seven. It looks like a hand held out.'),
      L('mara', 'They need supplies. We need supplies. A boat with children on it needs a medicine chest and somebody who can use one.'),
      L('priya', 'I mapped the route. Six crates split between the tents and Main Street\'s pharmacy.'),
      L('dutch', 'Is the pharmacy going to be full of bloaters?'),
      L('priya', 'The pharmacy will be full of whatever it wants to be full of.'),
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
        onDone: [radio('okafor', 'Target down. Enemy neutralised. And I am done using that phrase for the next hour.')],
      }),
      {
        id: 'lead', type: 'reach', at: 'haskellFarm', text: 'Lead the convoy to Haskell Farm', pressure: P(5, 0.3),
        onDone: [radio('dutch', 'I\'m parking the rig in the barn. Send the bill to the farm.')],
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
    rewards: {
      xp: 640, scrap: 190, weapon: 'cryo', upgradePoints: 2, flags: { hospital_saved: true, med_supplies: true },
    },
    debrief: [
      L('mara', 'Twenty-eight on the trucks. Twenty-eight who weren\'t going to see Day fifty-eight.'),
      L('june', 'Are you counting, Miss Mara?'),
      L('mara', 'No.'),
      L('june', 'You said twenty-eight.'),
      L('mara', 'I said... twenty-eight. Yes.'),
      L('june', 'Ms. Delaney said counting is how you keep people from disappearing.'),
      L('mara', 'Did she.'),
      L('june', 'She said it in the third grade. About sheep.'),
      L('mara', 'Then I suppose I\'ll count sheep.'),
    ],
    stars: { time: 900, noDowns: true, optional: 'collectAll' },
    todo: 'bonus,graph',
  },
];
