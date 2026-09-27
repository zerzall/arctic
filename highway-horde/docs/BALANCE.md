# Highway Horde — balance

How the game is tuned, the numbers it is tuned to, and why each number changed. The
figures come from `scripts/balance.js`, a headless harness that plays whole games with AI
survivors. Re-run it after touching any number in `constants.js`, `weapons.js`, `zombies.js`,
`classes.js` or `items.js`.

## The harness

```
node scripts/balance.js --quick        # ~2 min on 4 cores: normal × 1/2/4/6 players × both
                                       #   profiles + 4 average players on easy/hard/nightmare
node scripts/balance.js                # full sweep, ~17 min: 4 maps × 4 difficulties × 2 profiles
                                       #   × 1/2/4/6 players × 3 seeds + mono-class teams
node scripts/balance.js --diffs normal --sizes 4 --profiles average --seeds 8
node scripts/balance.js --set 'WEAPONS.uzi.damage=20;ZOMBIES.boss.hp=9000' ...   # try numbers
```
Other options: `--maps`, `--waves N` (game length, default 15), `--workers N`, `--mono`,
`--detail all|none`, `--out report.md`, `--json runs.json`. It runs the real `Game` with only
bots, no rendering, on `worker_threads`. It reports:

* **per team setup:** how many runs clear waves 5, 10 and 15, how they are lost (wiped or
  objective), downs and revives per player per wave, wave length and hit rate;
* **per wave:** reached and cleared, time, damage taken, downs, deaths, revives, cash banked,
  earned and spent, objective hp, zombies alive at the peak, boss fight length;
* **overall:** guns bought, held and taken from crates, kills per weapon and kills per minute in
  hand, damage taken by source per wave band, objective damage by zombie type, per-class stats,
  mono-class teams, and a paper gun table (DPS, $/DPS, refill cost).

**Profiles.** `skilled` is the lobby bot (`botSkill` 1). `average` is `BOT_SKILL.AVERAGE` (0.4),
a stand-in for an average human, built from `skillProfile()` in `sim/bots.js`:
* about 2× slower reactions and about 1.8× the first aim error, which settles more slowly;
* a slower crosshair and trigger-happy firing: about 57% hits against 75% before this was added;
* less attention to priority threats, and lets zombies closer before backing off;
* moments of tunnel vision mid-wave, when it keeps shooting instead of backing off;
* reloads whenever the magazine is low, throws less;
* shops plainly: the best gun it can afford now, no saving up, armour when below 50.

**Read with care.**
* Bots ring the objective and see everything within 1000 px, so they never get cornered the
  way people do. The first four waves deal almost no damage to any bot team, however busy
  they look to a human (35-40 zombies alive at once with 4 players).
* Bots rate the grenade launcher and rocket low and never use them, so neither those two guns
  nor the demo class's explosives perk are measured.
* With 12 runs per cell a share has about ±14 points of noise. Decisions were made on 16-32
  run samples.

## Targets and results (normal unless noted; before = the numbers this pass started from)

The before column uses the same bot brain with the original numbers (8 runs per cell); after
is the full sweep (12 runs per cell; 32 runs for average 4 players on normal).

| target | before | after |
|---|---|---|
| Average 4p: waves 1-2 warm-up, no downs | 0 downs | 0 downs, 0 damage |
| Average 4p: waves 3-4 busy | 0 damage, ~33 alive at once | ~0 damage (bot limit, see above), 34-37 alive, waves ~70 s |
| Average 2-4p usually survive the first boss (wave 5) | 4p 75% / 2p 88% | 4p 100% / 2p 100%; 0.15 downs per player on the wave |
| Average 4p: waves 10+ tense, with downs and revives | 25% cleared 10; revives ~0 (a mauled downed player died in 3-5 s) | 92% clear 10; waves 12-15: 0.45-1.1 downs and 0.1-0.2 revives per player per wave |
| Average 4p: 30-50% finish 15 | 0% | 33% (12 runs); 31% and 38% in two 32-run samples |
| Average solo reaches wave 5-8 | median 6 | median 7.5 |
| Easy: most average teams finish 10 | 2-6p 88-100% | 2-6p 100% (solo: median 12) |
| Hard: average teams rarely pass 10 | 0%, all dead by wave 4-5 | 4p median 9, 25% clear 10 (6% in a 16-run sample) |
| Nightmare: brutal | median wave 4 | median wave 4 (skilled 4p: 9) |
| Skilled noticeably better | skilled 4p lost 7/8 to the objective (median 9) | skilled 4p 92% finish 15; hard 58% |
| 4p wave length 1.5-3 min | 50-80 s (boss waves 110-140 s) | waves 1-4 60-73 s; 6-15 83-112 s (lower edge, see open issues) |
| Objective threatened only when the team over-extends | lost in boss waves while the team kited bosses (skilled 4p: 7 of 8 games) | no average 4-6p run on normal lost it (2 of 96 on any difficulty); a team camping 600-800 px away loses it by wave 4-5 |

All difficulties and team sizes, average profile (share that cleared wave 10 / 15, and median waves cleared):

| diff | 1p | 2p | 4p | 6p |
|---|---|---|---|---|
| easy | 100% / 17%, 12 | 100% / 100%, 15 | 100% / 100%, 15 | 100% / 100%, 15 |
| normal | 8% / 0%, 7.5 | 83% / 8%, 11 | 92% / 33%, 14 | 100% / 75%, 15 |
| hard | 0% / 0%, 4.5 | 8% / 0%, 7 | 25% / 0%, 9 | 42% / 0%, 9 |
| nightmare | 0% / 0%, 3.5 | 0% / 0%, 4 | 0% / 0%, 4 | 0% / 0%, 4.5 |

### Per wave: average 4 players, normal (final)

| wave | reached | cleared | time s | dmg taken/pl | downs/pl | revives/pl | bank/pl $ | earned/pl $ | spent/pl $ | obj hp end | peak alive | boss s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 100% | 100% | 60 | 0 | 0 | 0 | 500 | 509 | 13 | 100% | 37 | |
| 2 | 100% | 100% | 66 | 0 | 0 | 0 | 146 | 569 | 850 | 100% | 34 | |
| 3 | 100% | 100% | 71 | 0 | 0 | 0 | 534 | 615 | 181 | 100% | 32 | |
| 4 | 100% | 100% | 73 | 0.3 | 0 | 0 | 750 | 708 | 403 | 100% | 37 | |
| 5B | 100% | 100% | 69 | 37 | 0.15 | 0.04 | 1101 | 1185 | 358 | 99% | 45 | 54 |
| 6 | 100% | 100% | 83 | 6 | 0.02 | 0.02 | 864 | 920 | 1423 | 99% | 42 | |
| 7 | 100% | 100% | 88 | 7 | 0 | 0 | 1346 | 965 | 438 | 99% | 43 | |
| 8 | 100% | 92% | 87 | 20 | 0.13 | 0.02 | 1720 | 1018 | 592 | 99% | 49 | |
| 9 | 92% | 92% | 87 | 20 | 0.05 | 0.02 | 1871 | 1138 | 861 | 99% | 50 | |
| 10B | 92% | 92% | 80 | 60 | 0.23 | 0.11 | 2253 | 1424 | 757 | 97% | 63 | 63 |
| 11 | 92% | 92% | 99 | 50 | 0.27 | 0.11 | 2254 | 1298 | 1423 | 96% | 55 | |
| 12 | 92% | 75% | 98 | 73 | 0.45 | 0.11 | 2679 | 1261 | 877 | 95% | 65 | |
| 13 | 75% | 67% | 103 | 110 | 0.72 | 0.22 | 3155 | 1434 | 908 | 90% | 72 | |
| 14 | 67% | 58% | 102 | 95 | 0.66 | 0.22 | 2444 | 1497 | 2174 | 95% | 68 | |
| 15B | 58% | 33% | 112 | 137 | 1.14 | 0.11 | 3080 | 1292 | 954 | 84% | 74 | 95 |

Before, the same table ran 50-80 s regular waves with no damage at all until the first boss,
lost 25% of teams at wave 5 and 50% at wave 10 (bosses fought for 100-130 s), and nobody got
past 13.

**Economy.** Players earn about $500-700 per wave early (the $300 clear bonus plus kills) and
$1300-1500 late. The first gun is bought after wave 1 (uzi or magnum); after that a real
upgrade comes about every 1.5-2 waves (rifle or dual SMG around wave 4-6, DMR or LMG around
7-9, tesla or minigun late). Late banks settle at $2.5-3k, down from $3-5k (skilled) that sat
unspent. The sinks are the $2000-2400 refills of late guns, armour, and a $1500
Self-Revive Kit (330 bought across the sweep).

## Changes and why

Each row was one step followed by a re-run.

### Survival
| change | before → after | why |
|---|---|---|
| Bleedout cost of hits on a downed player | 0.12 s per damage point, uncapped → 0.05 s, drained at most 1 s per s on top of the clock, at most 3 s pending (`DOWNED_HIT_BLEED`, `_RATE`, `_BANK`) | A downed player in a swarm lost all 30 s in 3-5 s, so revives never happened (0.00-0.02 per player per wave) and every down became a death. A mauled player now lasts at least 15 s: 0.1-0.2 revives per player per wave from wave 10. |
| Zombies' preference for standing players over downed ones | 80 px → 150 px (`DOWNED_BIAS`, sim/zombies.js) | Same goal: the pack moves on to the reviver instead of finishing off the downed player. |

### Bosses
| change | before → after | why |
|---|---|---|
| Boss hp split between the wave's bosses | each boss got `hpBase + hpPerPlayer·n` → the bosses share it | A 4-player team met 2 bosses at 1.7× hp each (3.4× in total), against 1.4× for 3 players. Wave 10 was a wall. |
| hpBase / hpPerPlayer | 0.5 / 0.3 → 0.4 / 0.25 | Total boss hp for 4 players on wave 10: 41k → 13k. |
| Boss base hp, own hp growth, speed | 7000, +8%/wave (the zombie rate), 58 px/s → 8500, +4%/wave (`special.hpGrowth`), 62 px/s | Flatter across waves 5/10/15: a tougher first boss, and the wave-15 boss stopped being a wall (in that step: 38% of teams reached wave 15 and 13% cleared it before; 19% reached and 19% cleared after). |
| Regular zombies on boss waves | ×1 → ×0.65 (`WAVE_ZOMBIES.bossWave`) | The boss is the fight. A full wave plus bosses stacked the two hardest things (wave-10 clear rate 38% → 56% in that step). |

### Waves
| change | before → after | why |
|---|---|---|
| Zombies per wave | 12 + 6w → 22 + 5w (`WAVE_ZOMBIES`, ×(1 + 0.6(n−1)) as before) | Early waves were short and empty. Flatter: more zombies early, about the same at wave 10, fewer late. |
| Spawn pacing | groups of 3 to 5+w/3 every clamp(3.6 − 0.12(w−1), 1.2) s → groups of 4 to 6+w/4 every clamp(4.4 − 0.09(w−1), 2.2) s, both ÷ √crowd (`SPAWN_PACING`) | Bigger groups early and a longer spawn phase late. Waves last 60-110 s instead of 45-80 s, and late waves have fewer zombies alive at once (the chance of surviving each wave from 10 to 15 went from 0.64 to about 0.8). |
| HP growth per wave | 0.08 (tried 0.11 and 0.09, kept 0.08) | Higher growth made waves 9-12 a cliff for average teams. |
| Runner weight | 18 + 2.5w from wave 2 → 28 + 1.8w | More fast zombies early (they are the ones that reach players), the same share late. |
| Spitter | from wave 5, weight 5 + 0.5w, pool 14 dps, spit every 3.2 s → from wave 4, 4 + 0.4w, 10 dps, 3.8 s | Acid was 40-43% of the damage average teams took in the first tuning runs (it is the only ranged attack). Now 31%, starting a wave earlier. |
| Brute weight | 1 + 0.15w → 1.6 + 0.08w | The same number mid-game and fewer late (brutes did a quarter of late damage). |
| Hard difficulty | hp ×1.3, damage ×1.35 → ×1.25, ×1.3 | Average teams were dead by wave 4-5. Now median wave 9, rarely past 10. |

### Objective
| change | before → after | why |
|---|---|---|
| Objective hp by team size | the map's hp → map hp × (1 + 0.25(n−1)) (`OBJECTIVE_HP_PER_PLAYER`) | The horde grows with the team (×2.8 with 4 players); the objective did not. |
| Zombie damage to the objective | ×1 → ×0.5 (`OBJECTIVE_DAMAGE_MULT`) | Skilled teams lost 5-7 of 8 games to the objective during boss waves: about 20 walkers destroyed it in about 20 s while the team kited the bosses 800-1200 px away. Now a few stragglers barely scratch it, and a team that camps 600-800 px away still loses it by wave 4-5. |

### Guns
Judged on the paper table below plus kills per minute in hand.

| gun | change | why |
|---|---|---|
| Magnum | $750 → $900 | Best $/DPS in the game (5.1) with pierce 3; 16-22% of average teams' kills. |
| Micro SMG | damage 16 → 18, spread 0.11 → 0.09 | No better than the free pistol in hand (15 vs 14 kills/min). |
| Pump shotgun | damage 18 → 20, rate 1.25 → 1.4, reload 2.4 → 2.1 | 120 sustained DPS for $1100, below the $900 SMG: strictly dominated. Now 150. (Pierce 2 was tried and dropped: a piercing pellet that hits a single zombie reports a miss, so hit markers vanished.) |
| Assault rifle | damage 34 → 36 | Behind the DMR for $700 less. |
| Twin Vipers | damage 15 → 17, spread 0.15 → 0.12 | 16 kills/min for $2100, the lowest of the mid-price guns. |
| Battle rifle (DMR) | $2600 → $2800 | The best mid-price gun (35 kills/min, pierce 3). |
| Tesla | damage 55 → 45, chains 6 → 5 | 57 kills/min, twice any other gun (48 now). |
| Minigun | spread 0.10 → 0.07 | 22 kills/min for $8000, below the $4400 LMG. |
| Railgun | rate 0.7 → 0.85, reload 3.0 → 2.6 | 29 kills/min for $9500, below the tesla. |

### Classes (teams of 4 average bots of one class, normal)
| class | change | why |
|---|---|---|
| Engineer (Sparks) | turret damage ×1.5 → ×1.25 | Four free turrets at 231 DPS each: mean wave 14.4, and 63% finished 15. |
| Scout (Swift) | kill cash ×1.15 → ×1.25 | Weakest (mean wave 11.1); now gears up sooner. |
| Soldier (Sarge) | gun damage ×1.15 → ×1.2 | None of the soldier teams finished 15 (mean wave 12.1). |

The class descriptions in `classes.js` were updated to match.

### Economy
| change | before → after | why |
|---|---|---|
| Wave clear bonus | $250 → $300 | Upgrades came every 2-3 waves early; now every 1.5-2. |

### Bots (sim/bots.js)
* `botSkill` 0..1 and `skillProfile()` (described above). The lobby's bots stay at 1, so they
  play exactly as before except for the next two points.
* Objective alarm: after seeing 4 or more zombies chewing on the objective, bots rank them
  above everything else, even far away.
* With spare cash, bots buy a Self-Revive Kit: skilled bots at $3000, average bots at $3500.
  Average bots also keep their armour topped up (they buy a vest when below 50 armour and
  $300 would still be left); the first version of the profile never bought armour and died
  of attrition.

## Final tables

### Guns: paper numbers
`sustained` includes reloads. Tesla chains, shotgun spread and explosions are not modelled:
pellets are counted as all hitting, and explosive damage as landing once.

| gun | price | unlock | burst dps | sustained dps | range | pierce | $ per sust. dps | refill $ | dmg per refill $ | move |
|---|---|---|---|---|---|---|---|---|---|---|
| pistol | 0 | 1 | 125 | 86 | 900 | 1 | - | - | inf | 1 |
| magnum | 900 | 1 | 242 | 146 | 1100 | 3 | 6.2 | 250 | 24 | 1 |
| sawedoff | 700 | 1 | 680 | 162 | 360 | 1 | 4.3 | 200 | 36 | 1 |
| uzi | 900 | 1 | 270 | 163 | 750 | 1 | 5.5 | 250 | 23 | 1 |
| shotgun | 1100 | 1 | 224 | 150 | 480 | 1 | 7.3 | 300 | 29 | 0.97 |
| rifle | 1900 | 1 | 360 | 220 | 1100 | 1 | 8.6 | 500 | 22 | 0.95 |
| dual_smg | 2100 | 3 | 408 | 224 | 700 | 1 | 9.4 | 550 | 16 | 1 |
| crossbow | 2400 | 3 | 288 | 188 | 1400 | 8 | 12.8 | 600 | 20 | 1 |
| dmr | 2800 | 3 | 298 | 215 | 1300 | 3 | 13.0 | 700 | 22 | 0.95 |
| sniper | 3200 | 4 | 405 | 269 | 2400 | 10 | 11.9 | 800 | 25 | 0.9 |
| auto_shotgun | 3600 | 5 | 448 | 272 | 450 | 1 | 13.3 | 900 | 16 | 0.93 |
| flamethrower | 4200 | 5 | 295 | 203 | 330 | all | 20.6 | 1050 | 6 | 0.9 |
| lmg | 4400 | 6 | 432 | 292 | 1100 | 2 | 15.1 | 1100 | 16 | 0.82 |
| grenade_launcher | 4600 | 6 | 420 | 240 | 900 | 1 | 19.2 | 1150 | 10 | 0.93 |
| rocket | 6200 | 8 | 648 | 247 | 1600 | 1 | 25.1 | 1550 | 7 | 0.85 |
| tesla | 6800 | 8 | 270 | 196 | 600 | 1 | 34.6 | 1700 | 6 | 0.95 |
| minigun | 8000 | 9 | 900 | 600 | 1000 | 1 | 13.3 | 2000 | 14 | 0.62 |
| railgun | 9500 | 10 | 765 | 493 | 3000 | all | 19.3 | 2400 | 12 | 0.9 |

Every gun has a niche at its price:
* **Close-range bursts:** sawed-off and shotgun.
* **Cheap all-rounders:** uzi and magnum.
* **Mid-price:** the rifle is accurate; the dual SMGs spray hardest; the crossbow and DMR
  pierce lines; the sniper rifle kills bosses.
* **Late:** the LMG and minigun give sustained fire, the auto shotgun is a close-range
  shredder, and the tesla and flamethrower clear crowds.

Late guns have the highest DPS but cost 25% of their price to refill, so their damage per
refill dollar is 2-5× worse than early guns'.

### Guns in the hands of average teams (full sweep)
| gun | kill share | kills/min in hand | | gun | kill share | kills/min in hand |
|---|---|---|---|---|---|---|
| rifle | 16% | 24.5 | | uzi | 4% | 14.2 |
| lmg | 14% | 31.4 | | minigun | 3% | 20.2 |
| dmr | 13% | 29.5 | | railgun | 2% | 29.9 |
| tesla | 8% | 47.5 | | auto_shotgun | 1% | 25.8 |
| pistol | 7% | 12.4 | | flamethrower | 1% | 36.5 |
| dual_smg | 6% | 18.6 | | sawedoff | 1% | 22.5 |
| turret | 5% | — | | shotgun | 0.5% | 14.6 |
| crossbow | 5% | 32.1 | | frag | 1% | — |
| magnum | 4% | 24.2 | | sniper | 4% | 25.0 |

Kills per minute favour late guns (more zombies on screen) and bots barely use shotguns
(they fight at range), so the shotgun rows understate them.

### Classes
Per player per wave played, in mixed teams:

| class | kills | dmg dealt | dmg taken | downs | earned $ |
|---|---|---|---|---|---|
| soldier | 44.1 | 7027 | 14.3 | 0.07 | 1074 |
| medic | 34.5 | 5658 | 16.8 | 0.06 | 912 |
| engineer | 51.0 | 7905 | 13.3 | 0.07 | 1205 |
| scout | 38.2 | 6031 | 14.4 | 0.09 | 1117 |
| demo | 36.3 | 5839 | 15.2 | 0.09 | 941 |
| heavy | 35.2 | 5709 | 18.3 | 0.07 | 929 |

Mono-class teams (4 average bots, normal, 8 runs each), mean waves cleared, before → after the class changes:

| class | before → after |
|---|---|
| soldier | 12.1 → 13.5 |
| medic | 13.3 → 14.0 |
| engineer | 14.4 → 14.5 |
| scout | 11.1 → 11.6 |
| demo | 12.6 → 11.6 |
| heavy | 13.1 → 11.8 |

The spread is about 3 waves, and about ±1 of that is noise at 8 runs. No class dominates.
Demo is understated because bots don't use its explosives.

### Where the damage comes from (all runs, share of damage taken)
| source | before | after | waves 1-4 | waves 5-9 | waves 10+ |
|---|---|---|---|---|---|
| acid pools | 33% | 31% | (tiny) | 29% | 32% |
| boss | 30% | 17% | — | 23% | 15% |
| brute | 14% | 22% | — | 23% | 23% |
| bloater burst | 6% | 8% | | 7% | 9% |
| runner, walker, crawler | 12% | 15% | | 13% | 15% |

The objective takes 59% of its damage from walkers, 18% from runners and 10% from crawlers,
which is the small fry by design: heavies hunt people.

## Open issues
* **6-player teams have it easiest:** 75% of average 6p teams finish 15, against 33% for 4p.
  More zombies per player (0.7) and faster spawns for big crowds (`SPAWN_PACING.crowdExp`
  0.75) didn't change it; the edge is structural (every class including the medic, and six
  revivers). If human playtests agree, scaling zombie hp per player (as Left 4 Dead does) is
  the next lever.
* **Hard at 6 players:** 42% clear wave 10, against the target of rarely.
* **Waves 1-4 and 6-9 are near-damage-free for bot teams.** Whether they feel busy needs a human
  playtest, looking at wave length (60-90 s) and 35-50 zombies alive at once with 4 players.
* **Wave length** sits at the lower edge of 1.5-3 min (83-112 s from wave 6 with 4 players).
  Slowing spawns further also makes waves easier; waves should run longer with human
  players, who kill more slowly than bots.
* **Skilled bots are strong** (hard 4p: 58% finish 15). That is fine for teammates. A lobby
  setting for bot skill could use `botSkill` (not exposed in the UI).
* **Hit reporting on piercing guns:** a pierce > 1 ray that hits fewer zombies than its
  pierce reports `hit: 0` or `2`, so the magnum, DMR, LMG and sniper show no hit marker on a
  single target (combat.js `fireHitscan`). This is the reason the shotgun buff avoided pierce.
