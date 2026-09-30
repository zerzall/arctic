# Road to Haven: story guide for playtesters

Spoilers ahead. This is the reference for the story campaign (contract: `STORY.md`; data:
`public/js/shared/story/`, validated by `tests/story-data.test.js`).

**Premise.** Day 41. A calm voice, the Warden, has read the same message on the radio every dusk for a
week: *"Haven is open. Lake Harlan Marina. The last ferry sails at the end of the month. Bring what you
can carry."* A crew of strangers, a school bus of kids and a growing convoy make the two-hundred-mile
trip in fifteen missions. The zombies are slow (walkers 34-48 px/s); the tension is numbers, ambushes,
specials and objectives. Everybody in this story is counting something.

## The road, chapter by chapter

**1. Dead Highway** (highway, night; road missions chain with no hub, then the **Roadhouse** motel).
Mara Voss, a medic with fourteen kids and a dead school bus, needs the crew to hold the pileup
(*1.1 Pileup*: defend the bus; a stuck horn calls a second herd). Diesel for Deke Harlan's tow truck
(*1.2 Fuel Run*: collect cans, kill a truck alarm, escort the tow truck) and a teenage radio nerd's
beacon on the I-44 overpass (*1.3 Beacon*: the Warden answers live, a runner surge, a jackknifed semi
collapses). Arrival: Roz Pruitt's Roadhouse kitchen. Walkers only; runners and crawlers are teased.

**2. Last Chance** (truckstop; hub: Roadhouse). *2.1 Diner Siege*: silence the OPEN sign, blow the fuel
pumps (Silas Quill and ten survivors, and their pie). *2.2 Radio Parts* (day): break trailer locks,
sound an air horn to pull the herd north, strip the cabs before it comes back. *2.3 Night Hauler*:
escort Dutch Kessler and six barrels of diesel through a collapsing container stack. 2.2 and 2.3 can be
played in either order.

**3. Blackwater** (bridge; then the **Blackwater Depot** rail yard). *3.1 The Crossing*: engineer
Priya Nair fixes an APC while the crew corks a bridge; first bloaters and spitters. *3.2 Sunken
Cargo* (night): a grounded barge, a lurching container stack, a Warden call asking for a marine pump,
and (optional) Wendell Pike's dog Biscuit. The pump is stamped for the ferry *Halcyon*.

**4. Delta** (checkpoint; hub: Depot). *4.1 Hold the Tower*: Sgt. Okafor's radio tower, a Brute through
the gate, first screamers. *4.2 Broken Line*: fuel dump, three generators, screamers, a compound siren,
floodlights, then the breaker; the Warden says "I'm not a ma'am." *4.3 Ghosts*: the missing Ghost squad,
a signal flare, a roll call of names and a five-Brute pack on the ridge.

**5. Harlan County** (harlan; then **Harlan Farmstead**). *5.1 Down the Interstate*: Evac Run through
four safe zones and two Brutes on Main Street. *5.2 Field Hospital* (night): triage circle, the isolation
ward (optional) and the first boss, the Abomination. Arrival: Ozzy tallies the stash. Fuel, a marine
pump, a generator regulator, a radio and medicine make a ferry's worth of parts.

**6. Haven** (harlan campaign). *6.1 Last Stand*: hold Radio Hill while the convoy slips down the lake
road (radio events on a timeline; "it looks like a candle"). *6.2 The Tower*: breakout, three floors,
roof, zip line. On the way up the Warden confesses she is **Wren Alcott, fifteen**, alone for forty
days with her grandfather's script. Epilogue: a muster on the ferry, a manifest with two hundred and
twelve names (a teacher; Deke's son Cal), a micro-cassette, and the message, rewritten.

## Missions, rewards and unlocks

`Level` is the recommended band from the XP curve `round(90·(L−1)^1.7)`. Total mission XP 7,280
(a party of level 14), scrap 2,020, 15 hideout upgrade points. Stars: win, beat the par time, then
"flawless" (nobody downed and every bonus objective, e.g. all notes).

| Mission | Map, time (mode) | Level | XP | Scrap | Weapon | NPC | Flags set | Notes |
|---|---|---|---|---|---|---|---|---|
| 1.1 Pileup | highway night (defend) | 1-2 | 200 | 40 | - | Mara | met_mara, bus_saved | n01 |
| 1.2 Fuel Run | highway night (free) | 2-3 | 240 | 60 | shotgun | Deke | met_deke, tow_truck_running | n02 n03 |
| 1.3 Beacon | highway night (free) | 3-4 | 300 | 80 | lever | Ozzy | met_ozzy, warden_contact, road_open | n04 |
| 2.1 Diner Siege | truckstop night (defend) | 4-5 | 340 | 90 | tommy | Quill | met_quill, diner_saved | n05 n06 |
| 2.2 Radio Parts | truckstop day (free) | 5-6 | 380 | 100 | burst_rifle | - | radio_repaired | n07 |
| 2.3 Night Hauler | truckstop night (free) | 6-7 | 440 | 110 | dual_smg | Dutch | met_dutch, fuel_secured | n08 |
| 3.1 The Crossing | bridge day (defend) | 7-8 | 460 | 120 | dmr | Priya | met_priya, apc_running | n09 |
| 3.2 Sunken Cargo | bridge night (free) | 7-8 | 480 | 140 | crossbow | Wendell | marine_pump | n10 n11 |
| 4.1 Hold the Tower | checkpoint night (defend) | 8-9 | 500 | 150 | lmg | Okafor | tower_held, met_okafor | n12 |
| 4.2 Broken Line | checkpoint day (free) | 9-10 | 520 | 160 | auto_shotgun | Danny | generators_online, met_danny | n13 |
| 4.3 Ghosts | checkpoint night (free) | 10-11 | 580 | 180 | flare | - | ghosts_laid_to_rest | n14 n15 |
| 5.1 Down the Interstate | harlan day (zone) | 10-11 | 600 | 180 | hmg | - | interstate_cleared | n16 |
| 5.2 Field Hospital | harlan night (free) | 11-12 | 640 | 190 | cryo | - | hospital_saved, med_supplies | n17 n18 |
| 6.1 Last Stand | harlan day (campaign) | 12-13 | 700 | 200 | rocket | - | convoy_through | n19 |
| 6.2 The Tower | harlan day (campaign) | 13-14 | 900 | 220 | railgun | - | haven_reached, campaign_complete | n20 |

Bonus objectives that set flags (change the epilogue and hideout talk): `found_biscuit` (3.2, follow
the barking), `has_tape_player` (2.2, a micro-cassette player from trailer B), `saved_patients` (5.2,
isolation ward). Twenty lore notes (`n01`-`n20`) tell the first days of the outbreak and, in order,
who the Warden is: Captain Alcott's Operation Haven flyer, the ferry manifest, the girl who bought
D batteries, the margin note on the roof.

**Unlock chain.** 1.1 → 1.2 → 1.3 → *Roadhouse arrival* → 2.1 → {2.2, 2.3} → 3.1 → 3.2 → *Depot
arrival* → 4.1 → 4.2 → 4.3 → 5.1 → 5.2 → *Farmstead arrival* → 6.1 → 6.2 → *epilogue*. Roz and June
live at the Roadhouse from the start; everyone else joins as listed under NPC.

## What to check when you play

- **Pacing.** Pressure numbers assume walkers at 34-48 px/s: a surge (pace 1.4-1.6, 25-45 s) needs ~15 s
  to arrive. If a step feels empty, raise its `pace`; if it feels like a wall, lower it or the virtual
  wave (`pressure.waves`).
- **Gradual specials.** Ch1 walkers (runners and crawlers teased at the end), ch2 runners and crawlers,
  ch3 bloaters and spitters, ch4 screamers and Brutes, ch5 the first boss. No natural Brutes before Delta.
- **Set pieces worth watching:** the horn (1.1), Warden's live answer (1.3), pump explosion (2.1), air-horn
  lure (2.2), container collapse (2.3, 3.2), Brute at the gate (4.1), roll call on the ridge (4.3),
  Abomination at the hospital (5.2), Wren's confession while you climb the tower (6.2).
- **Text.** Radio lines are at most 140 characters, dialogue at most 200. Hideout talk has five stages
  (Roadhouse arrival, Roadhouse ch2, Depot arrival, Depot ch4, Farmstead); the bed says "Rest until morning?
  Day {day}".
