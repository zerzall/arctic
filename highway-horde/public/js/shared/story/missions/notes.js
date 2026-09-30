// The lore notes: found paper, chalk, receipts and radio logs that tell the first days of the outbreak
// and, a little at a time, who the Warden is. One or two per mission and side job, always optional
// (each is collected by a `bonus` collect step with item:'note', note:<id>). n01..n20 were written for
// the first campaign and travelled with their missions (most of them are side jobs now); n21..n37 are
// the notes of the story levels.
//
//   id      n01..n37                          mission  the mission or side job that hides it
//   at      the anchor it lies near           day      the outbreak day it was written
//   title / text  (text is 1-3 sentences)

export const NOTES = {
  n01: {
    id: 'n01', mission: 'm1_1', at: 'crossroadsE', day: 6, title: 'Clipboard, Route 9-C',
    text: 'Route 9-C, Riverbend Elementary to Lake Harlan Marina, Operation Haven: fourteen kids, two adults. Day 6, R. Abernathy: Delaney and I are going for help, so tell June to count to a thousand and stay put.',
  },
  n02: {
    id: 'n02', mission: 'm1_2', at: 'gas_office', day: 12, title: 'Sign inside the shutter',
    text: 'No diesel, no gas, no change. If you need a tow, knock twice and step back. If you need sympathy, try roadside assistance. — D.H.',
  },
  n03: {
    id: 'n03', mission: 'sj_fuel', at: 'westEnd', day: 3, title: 'Highway memo',
    text: 'Sector command, 2100 hours: close I-44 at mile marker 62 and do not use the word "outbreak" on open channels. Say "fainting incidents" until further notice.',
  },
  n04: {
    id: 'n04', mission: 'sj_beacon', at: 'overpass', day: 5, title: 'CB log, channel 9',
    text: 'They are calling it the Quiet, because the sleepers wake up and do not say a word. They only walk toward sound. Turn your radio down, friends.',
  },
  n05: {
    id: 'n05', mission: 'sj_diner', at: 'diner', day: 2, title: 'Order pad, Last Chance Diner',
    text: 'Table 4: two sleepers in the corner booth, no order, said they were "just resting." Left a very good tip and did not blink once.',
  },
  n06: {
    id: 'n06', mission: 'sj_diner', at: 'truckLot', day: 3, title: 'Trucker\'s route sheet',
    text: 'Hauling forty thousand pounds of refrigerated pie filling to Riverbend. Dispatcher says the roads are closed. Dispatcher says a lot of things, and pie waits for no one.',
  },
  n07: {
    id: 'n07', mission: 'sj_radio', at: 'motelRow', day: 9, title: 'Operation Haven flyer',
    text: 'Operation Haven: ferries leave Lake Harlan Marina at 6 a.m., bring three days of food. Handwritten below: "Buses can\'t pass Highway 9, but the ferries still run, so walk if you can. — E. Alcott, Harbor Warden."',
  },
  n08: {
    id: 'n08', mission: 'sj_hauler', at: 'trailerB', day: 12, title: 'Toll ledger, Mile Marker crew',
    text: 'Toll schedule: three cans, one pistol or one good joke. Dutch says be nice. We are nice. We are a very nice toll.',
  },
  n09: {
    id: 'n09', mission: 'sj_crossing', at: 'apc', day: 5, title: 'Field order, APC 6',
    text: 'APC 6 will hold Blackwater Bridge until relieved. Relief is not scheduled. Under it, in another hand: "Relieved of what, exactly?"',
  },
  n10: {
    id: 'n10', mission: 'sj_cargo', at: 'cargoB', day: 3, title: 'Shipping manifest',
    text: 'Consignee: Lake Harlan Harbor Authority, attention Captain Alcott. One marine injector pump, two fuel filters and spare gaskets for the ferry Halcyon. Rush.',
  },
  n11: {
    id: 'n11', mission: 'sj_cargo', at: 'cargoC', day: 4, title: 'Barge crew letter',
    text: 'To Capt. Alcott: the parts barge leaves Blackwater on Day 4 and reaches you by Day 8. Underneath, in pencil, someone has written: "Sank on Day 4. Sorry, Captain."',
  },
  n12: {
    id: 'n12', mission: 'sj_tower', at: 'tower', day: 6, title: 'Orders, Checkpoint Delta',
    text: 'Orders from Colonel Reese: hold the crossroads and the tower until relieved, and do not abandon the tower. Underneath, in pen: "The Colonel left on Day 8 with the trucks. Nobody relieved us. — Okafor"',
  },
  n13: {
    id: 'n13', mission: 'sj_line', at: 'genC', day: 27, title: 'Unsent letter',
    text: 'Dear Mom, we have a tower and a hill and a sergeant who counts us every morning like we might have wandered off. I am eating crackers like a champion. Don\'t worry, I have never felt safer. — D.',
  },
  n14: {
    id: 'n14', mission: 'sj_ghosts', at: 'hill', day: 10, title: 'Ghost squad radio log',
    text: 'Ghost Six to Delta: movement on the ridge, we are going to look. Kip says it is probably cows. Kip has been wrong about cows before.',
  },
  n15: {
    id: 'n15', mission: 'sj_ghosts', at: 'gate', day: 9, title: 'Note in a helmet liner',
    text: 'Danny, if you find this, save me a seat on the bus home and keep the crackers coming. I am going to be hungry. — Kip',
  },
  n16: {
    id: 'n16', mission: 'sj_interstate', at: 'i70Interchange', day: 30, title: 'Painted on the overpass',
    text: 'HAVEN 41 MI, in spray paint; below it, in careful chalk capitals: "BRING WATER. BE KIND. THE FERRY WAITS." Two exclamation marks were rubbed out and replaced with periods.',
  },
  n17: {
    id: 'n17', mission: 'sj_hospital', at: 'fieldHospital', day: 6, title: 'Chart, Dr. Ellery',
    text: 'Day 3: four hundred sleepers in the tents. Day 6: they woke up. Recommend nobody enters the tents without a plan, a partner and a very good reason.',
  },
  n18: {
    id: 'n18', mission: 'sj_hospital', at: 'mainStreet', day: 29, title: 'Discharge slip',
    text: 'Discharge slip, patient Alcott, age 15, dehydration. Declined to stay; asked for D batteries "for the radio at home" and whether we had seen a man in a captain\'s cap. We had not, and she said she would be quick.',
  },
  n19: {
    id: 'n19', mission: 'm6_1', at: 'ridgeHill', day: 31, title: 'Card on the transmitter',
    text: 'The Radio Hill transmitter repeated STAY INDOORS, HELP IS COMING from Day 2 until its batteries died on Day 31. Someone taped a card to the console: "Help is people. Go find them."',
  },
  n20: {
    id: 'n20', mission: 'm6_2', at: 'roof', day: 34, title: 'Script page, in two hands',
    text: 'The evening broadcast, in a steady old hand: "Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month." In the margin, in a younger hand: "It isn\'t open yet. I\'ll say it until it is. — W."',
  },

  // ---- the story levels ----------------------------------------------------------------------------
  n21: {
    id: 'n21', mission: 'm1_2', at: 'trailer_radio', day: 40, title: 'Radio log, KD9-OZZ',
    text: 'Night 1: "Haven is open" on seven point zero seven four, 8:02 p.m. Night 6: the voice coughed after "month." Night 9: I answered. Nobody heard. Trying again tomorrow. — KD9-OZZ',
  },
  n22: {
    id: 'n22', mission: 'm2_1', at: 'pharmacy_counter', day: 5, title: 'Note by the till, Rexall',
    text: 'Back room is locked and the key is on me. If you are reading this and I am not here, I\'m sorry. The good stuff is behind the insulin fridge. Children first. — Walt, pharmacist',
  },
  n23: {
    id: 'n23', mission: 'm2_1', at: 'police_cells', day: 6, title: 'Cell log, Hollow Creek P.D.',
    text: 'Three sleepers brought in for their own safety. At 2 a.m. they woke and stood at the bars, facing the radio. Deputy Tate carried the radio outside, and they turned to follow it.',
  },
  n24: {
    id: 'n24', mission: 'm2_2', at: 'ward_records', day: 1, title: 'Admission, Ward C',
    text: 'Day 1, 23:40: male, forties, found asleep at the wheel on the I-44, unrousable, vitals normal. Admitted to Ward C for observation. Brought in by M. Voss, paramedic.',
  },
  n25: {
    id: 'n25', mission: 'm2_2', at: 'er_desk', day: 9, title: 'Visitor book, Emergency',
    text: 'Day 9. Name: E. Alcott, harbor master, Lake Harlan. Visiting: nobody. Purpose: "Inhalers for my granddaughter, and a boat for anyone who wants one."',
  },
  n26: {
    id: 'n26', mission: 'm3_1', at: 'security_office', day: 40, title: 'Camera log, Westgate security',
    text: 'Day 33, the power died in Harrow\'s, and by Day 35 a crowd was waiting at the food court shutter, because they wait at doors. Day 40, a voice on the radio says Haven is open, and I have started talking back. — P.N.',
  },
  n27: {
    id: 'n27', mission: 'm3_1', at: 'store_pharmacy', day: 4, title: 'Sign on Harrow\'s pharmacy counter',
    text: 'Sorry, we are out of everything. The ferries at Lake Harlan are taking families. Go north, stay together, and be kind at the checkpoints. — the Harrow\'s staff',
  },
  n28: {
    id: 'n28', mission: 'm3_2', at: 'control_radio', day: 20, title: 'Dam keeper\'s log',
    text: 'Reservoir at ninety-four percent and nobody to call, so I opened spill gate two by hand. Tomorrow I walk to the lake. Whoever comes next: the valve sticks on the third turn. — Hal Dawes, keeper',
  },
  n29: {
    id: 'n29', mission: 'm3_2', at: 'river_boat', day: 15, title: 'Note in a jar on the boat slip',
    text: 'To anyone downriver: the ferry Halcyon took us across on Day 15. The captain says there is room for everyone who comes. Tell the Riverbend folks. — the Mendozas',
  },
  n30: {
    id: 'n30', mission: 'm4_1', at: 'siding_tower', day: 11, title: 'Yardmaster\'s board',
    text: 'Loco 2217, main line, fueled, crew missing. Day 11: the army wants her for Delta; later the same day, the army isn\'t coming. Leave her ready, because somebody will need her.',
  },
  n31: {
    id: 'n31', mission: 'm4_1', at: 'signal_lever', day: 12, title: 'Signalman\'s log',
    text: 'Points set for the main line to Delta and left that way. Line clear to Fort Harlan as of 1600. If you are going somewhere, go safely, and wave at the box.',
  },
  n32: {
    id: 'n32', mission: 'm4_2', at: 'barracks_armory', day: 47, title: 'Duty roster, Fort Harlan',
    text: 'Sixteen names in a sergeant\'s hand. Five are crossed out, then written again underneath, very neatly.',
  },
  n33: {
    id: 'n33', mission: 'm4_2', at: 'tower_radio', day: 30, title: 'Coastal Supply schedule',
    text: 'Drop every fourth night to any lit runway on the coast road. In pencil, from a pilot: "We see a light at the Lake Harlan marina every night. Somebody is keeping it on."',
  },
  n34: {
    id: 'n34', mission: 'm5_1', at: 'ticket_office', day: 3, title: 'Station announcement, Line 2',
    text: 'Due to fainting incidents, Line 2 is suspended. Please do not wake sleeping passengers and move calmly to the exits. Someone has added underneath: "Do not go back for the train."',
  },
  n35: {
    id: 'n35', mission: 'm5_1', at: 'workshop', day: 25, title: 'Maintenance log, Crew C',
    text: 'Built a gun from the third-rail test rig to keep the big one in the workshop. It works, just not enough. The big one hates the lights, so keep the breaker off. — Crew C',
  },
  n36: {
    id: 'n36', mission: 'm5_2', at: 'camp_rv', day: 22, title: 'Diary in a camper van',
    text: 'Still here. The kids think it is a holiday. From the lookout we saw a light across the lake, same time every night. Tomorrow we walk to it.',
  },
  n37: {
    id: 'n37', mission: 'm5_2', at: 'ranger_lookout', day: 18, title: 'Fire lookout log',
    text: 'Day 17: the ferry Halcyon crossed three times, the last at dusk. Day 18: one crossing out, none back. The harbor light stayed on all night. Somebody is still there.',
  },
};

export const NOTE_IDS = Object.keys(NOTES);
