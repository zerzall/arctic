// The twenty lore notes: found paper, chalk, receipts and radio logs that tell the first days of the
// outbreak and, a little at a time, who the Warden is. One or two per mission, always optional
// (each is collected by a `bonus` collect step with item:'note', note:<id>).
//
//   id      n01..n20 in campaign order
//   mission the mission that hides it        at    the anchor it lies near
//   day     the outbreak day it was written  title / text  (text is 1-3 sentences)

export const NOTES = {
  n01: {
    id: 'n01', mission: 'm1_1', at: 'crossroadsE', day: 6, title: 'Clipboard, Route 9-C',
    text: 'Route 9-C, Riverbend Elementary to Lake Harlan Marina, Operation Haven: fourteen kids, two adults. Day 6, R. Abernathy: Delaney and I are going for help, so tell June to count to a thousand and stay put.',
  },
  n02: {
    id: 'n02', mission: 'm1_2', at: 'gasStation', day: 12, title: 'Sign on the pump',
    text: 'No diesel, no gas, no change. If you need a tow, knock twice and step back. If you need sympathy, try roadside assistance. — D.H.',
  },
  n03: {
    id: 'n03', mission: 'm1_2', at: 'westEnd', day: 3, title: 'Highway memo',
    text: 'Sector command, 2100 hours: close I-44 at mile marker 62 and do not use the word "outbreak" on open channels. Say "fainting incidents" until further notice.',
  },
  n04: {
    id: 'n04', mission: 'm1_3', at: 'overpass', day: 5, title: 'CB log, channel 9',
    text: 'They are calling it the Quiet, because the sleepers wake up and do not say a word. They only walk toward sound. Turn your radio down, friends.',
  },
  n05: {
    id: 'n05', mission: 'm2_1', at: 'diner', day: 2, title: 'Order pad, Last Chance Diner',
    text: 'Table 4: two sleepers in the corner booth, no order, said they were "just resting." Left a very good tip and did not blink once.',
  },
  n06: {
    id: 'n06', mission: 'm2_1', at: 'truckLot', day: 3, title: 'Trucker\'s route sheet',
    text: 'Hauling forty thousand pounds of refrigerated pie filling to Riverbend. Dispatcher says the roads are closed. Dispatcher says a lot of things, and pie waits for no one.',
  },
  n07: {
    id: 'n07', mission: 'm2_2', at: 'motelRow', day: 9, title: 'Operation Haven flyer',
    text: 'Operation Haven: ferries leave Lake Harlan Marina at 6 a.m., bring three days of food. Handwritten below: "Buses can\'t pass Highway 9, but the ferries still run, so walk if you can. — E. Alcott, Harbor Warden."',
  },
  n08: {
    id: 'n08', mission: 'm2_3', at: 'trailerB', day: 12, title: 'Toll ledger, Mile Marker crew',
    text: 'Toll schedule: three cans, one pistol or one good joke. Dutch says be nice. We are nice. We are a very nice toll.',
  },
  n09: {
    id: 'n09', mission: 'm3_1', at: 'apc', day: 5, title: 'Field order, APC 6',
    text: 'APC 6 will hold Blackwater Bridge until relieved. Relief is not scheduled. Under it, in another hand: "Relieved of what, exactly?"',
  },
  n10: {
    id: 'n10', mission: 'm3_2', at: 'cargoB', day: 3, title: 'Shipping manifest',
    text: 'Consignee: Lake Harlan Harbor Authority, attention Captain Alcott. One marine injector pump, two fuel filters and spare gaskets for the ferry Halcyon. Rush.',
  },
  n11: {
    id: 'n11', mission: 'm3_2', at: 'cargoC', day: 4, title: 'Barge crew letter',
    text: 'To Capt. Alcott: the parts barge leaves Blackwater on Day 4 and reaches you by Day 8. Underneath, in pencil, someone has written: "Sank on Day 4. Sorry, Captain."',
  },
  n12: {
    id: 'n12', mission: 'm4_1', at: 'tower', day: 6, title: 'Orders, Checkpoint Delta',
    text: 'Orders from Colonel Reese: hold the crossroads and the tower until relieved, and do not abandon the tower. Underneath, in pen: "The Colonel left on Day 8 with the trucks. Nobody relieved us. — Okafor"',
  },
  n13: {
    id: 'n13', mission: 'm4_2', at: 'genC', day: 27, title: 'Unsent letter',
    text: 'Dear Mom, we have a tower and a hill and a sergeant who counts us every morning like we might have wandered off. I am eating crackers like a champion. Don\'t worry, I have never felt safer. — D.',
  },
  n14: {
    id: 'n14', mission: 'm4_3', at: 'hill', day: 10, title: 'Ghost squad radio log',
    text: 'Ghost Six to Delta: movement on the ridge, we are going to look. Kip says it is probably cows. Kip has been wrong about cows before.',
  },
  n15: {
    id: 'n15', mission: 'm4_3', at: 'gate', day: 9, title: 'Note in a helmet liner',
    text: 'Danny, if you find this, save me a seat on the bus home and keep the crackers coming. I am going to be hungry. — Kip',
  },
  n16: {
    id: 'n16', mission: 'm5_1', at: 'i70Interchange', day: 30, title: 'Painted on the overpass',
    text: 'HAVEN 41 MI, in spray paint; below it, in careful chalk capitals: "BRING WATER. BE KIND. THE FERRY WAITS." Two exclamation marks were rubbed out and replaced with periods.',
  },
  n17: {
    id: 'n17', mission: 'm5_2', at: 'fieldHospital', day: 6, title: 'Chart, Dr. Ellery',
    text: 'Day 3: four hundred sleepers in the tents. Day 6: they woke up. Recommend nobody enters the tents without a plan, a partner and a very good reason.',
  },
  n18: {
    id: 'n18', mission: 'm5_2', at: 'mainStreet', day: 29, title: 'Discharge slip',
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
};

export const NOTE_IDS = Object.keys(NOTES);
