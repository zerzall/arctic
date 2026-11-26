// The Campaign mode (settings.mode 'campaign', SPEC §3.8): the tuning numbers and the pure
// helpers the simulation, the HUD, the minimap and both renderers share. The rules that run
// the stages live in sim/campaign.js; the map data (hill, tower, floors, roof, zip line) is
// built by maps-campaign.js and travels nowhere — every peer builds the same MapDef.
//
// Four stages, one wave counter:
//   1  HILLTOP     waves 1..N     hold the fortified hill (N = 60 % of the lobby's wave count)
//   2  BREAKOUT    wave N+1       fight down the far side and along the street to the tower
//                                  while a horde front advances along the route behind you
//   3  ASCENT      waves N+2..    one wave per floor (lobby, offices, atrium); the stairs open
//                                  when the floor is clear
//   4  ROOFTOP     the last wave  a kill quota; then the zip line: ride it to escape
//
// Nothing here touches the DOM or keeps state.

/** Tuning. Distances in world px, times in seconds. (Not frozen: scripts/balance.js --set 'CAMPAIGN.cap.roof=24' tries numbers.) */
export const CAMPAIGN = {
  /** Share of the lobby's wave count spent on the hill, and the least it can be. */
  hillShare: 0.6,
  hillMin: 3,
  /**
   * The slope: zombies on the hill's flank move (1 - slow × flank) as fast and take
   * (1 + exposed × flank) damage; a shooter at least `highDz` above its target deals
   * (1 + high) (the ground under both is the terrain, shared/terrain.js).
   */
  slope: { slow: 0.4, exposed: 0.3, high: 0.12, highDz: 24 },
  /** Breather after the last hill wave (the shop is open), before the breakout. */
  brief: 18,
  /** Breather after arriving on a floor (shop + supply drop). */
  arrive: 9,
  /** How long the stairs stay open after a floor is cleared (less when everyone is on them). */
  stairs: 24,
  /** Seconds the whole team must stand in the entrance circle to open the tower door. */
  enter: 2.5,
  /**
   * The horde front: starts `lead` px behind the hill's centre and walks the route at
   * length / time px/s (clamped to speedMin..speedMax); anyone behind it takes
   * dps0 + ramp × seconds behind (at most dpsMax), armour or not, and the horde walks in at
   * their backs.
   */
  front: { time: 64, speedMin: 54, speedMax: 96, lead: 330, dps0: 6, ramp: 2.4, dpsMax: 26, downedBleed: 0.6 },
  /** Wave zombies of a floor, relative to a normal wave of the same number. */
  floorShare: 0.5,
  /** Most zombies alive at once per stage (× the difficulty's maxAlive share). */
  cap: { breakout: 70, floor: 24, floorPerPlayer: 7, roof: 30, roofPerPlayer: 9 },
  /** Spawn-rate multiplier on the usual pacing (below 1 = faster). */
  pace: { breakout: 0.7, floor: 0.85, roof: 0.75 },
  /** Seconds into a floor's / the roof's wave before its boss(es) walk in (+ `small` per survivor a team lacks of three). */
  bossDelay: { floor: 14, roof: 26, small: 12 },
  /** Survivors per boss on the last floor and on the roof (bosses = ceil(players / this)). */
  bossPlayers: { floor: 3, roof: 2 },
  /** Roof kill quota: round((base + perPlayer × (players − 1)) × difficulty.count). */
  quota: { base: 44, perPlayer: 26 },
  /** The zip line: seconds a ride takes, the hang below the cable (units) and the pull radius. */
  zip: { ride: 4.8, hang: 66, radius: 100 },
  /** Supply left on arrival at each floor: ammo, health, armour. */
  drop: { life: 90 },
  /** Hill spawns: ring radius past the foot and how many attack directions per wave. */
  hillRing: { lo: 40, hi: 340, dirs: [2, 3, 3, 4], spinRate: 0.09 },
};

/** Ticks a zip-line ride takes. */
export const RIDE_TICKS = Math.round(CAMPAIGN.zip.ride * 60);

/** Sub-states of a stage (snapshot `campaign.sub`). */
export const SUB = Object.freeze({ FIGHT: 0, REST: 1, BRIEF: 2, OPEN: 3, ARRIVE: 4, ZIP: 5 });

export const STAGE_SHORT = ['', 'HILLTOP', 'BREAKOUT', 'ASCENT', 'ROOFTOP'];
export const CAMPAIGN_EVENTS = ['stage', 'brief', 'breakout', 'floor', 'zip', 'ride', 'escape'];

/** Number of hill waves for a lobby wave setting (0 = endless counts as 10). */
export function hillWaves(wavesSetting) {
  const w = wavesSetting > 0 ? wavesSetting : 10;
  return Math.max(CAMPAIGN.hillMin, Math.round(w * CAMPAIGN.hillShare));
}

/**
 * The wave plan for a lobby wave setting and a map: { hill, breakout, floors, roof, total }
 * where breakout/roof are wave numbers and floors the wave number of each floor.
 */
export function wavePlan(wavesSetting, floorCount = 3) {
  const hill = hillWaves(wavesSetting);
  const floors = [];
  for (let i = 0; i < floorCount; i++) floors.push(hill + 2 + i);
  return { hill, breakout: hill + 1, floors, roof: hill + floorCount + 2, total: hill + floorCount + 2 };
}

/** { stage, floor } of wave `w` in `plan` (floor: 0 outside the tower, 1..3, 4 on the roof). */
export function stageOfWave(plan, w) {
  if (w <= plan.hill) return { stage: 1, floor: 0 };
  if (w === plan.breakout) return { stage: 2, floor: 0 };
  if (w >= plan.roof) return { stage: 4, floor: plan.floors.length + 1 };
  return { stage: 3, floor: w - plan.breakout };
}

/** Roof kill quota for `players` survivors at a difficulty's `count` factor. */
export function killQuota(players, count = 1) {
  const q = CAMPAIGN.quota;
  return Math.max(10, Math.round((q.base + q.perPlayer * (Math.max(1, players) - 1)) * count));
}

/** Damage per second of the horde front after `t` seconds behind it. */
export function frontDps(t) {
  const f = CAMPAIGN.front;
  return Math.min(f.dpsMax, f.dps0 + f.ramp * Math.max(0, t));
}

/** Front speed (px/s) for a route of `len` px. */
export function frontSpeed(len) {
  const f = CAMPAIGN.front;
  return Math.max(f.speedMin, Math.min(f.speedMax, len / f.time));
}

const _rp = { s: 0, d: 0, x: 0, y: 0 };

/**
 * Where (x, y) is along the route polyline `pts` ([[x, y], ...]): arclength `s` of the
 * nearest point, its distance `d`, and the nearest point itself. Writes into `out`
 * (a shared scratch object when omitted).
 */
export function routeProgress(pts, x, y, out = _rp) {
  let best = Infinity, bs = 0, base = 0, bx = pts[0][0], by = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx2 = pts[i][0], by2 = pts[i][1];
    const dx = bx2 - ax, dy = by2 - ay;
    const l2 = dx * dx + dy * dy;
    const len = Math.sqrt(l2);
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      bs = base + len * t;
      bx = px;
      by = py;
    }
    base += len;
  }
  out.s = bs;
  out.d = best;
  out.x = bx;
  out.y = by;
  return out;
}

/** Point at arclength `s` on the route (clamped to its ends), with the heading there. */
export function routePoint(pts, s, out = { x: 0, y: 0, a: 0 }) {
  let base = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
    const len = Math.hypot(bx - ax, by - ay);
    if (s <= base + len || i === pts.length - 1) {
      const t = len > 0 ? Math.max(0, Math.min(1, (s - base) / len)) : 0;
      out.x = ax + (bx - ax) * t;
      out.y = ay + (by - ay) * t;
      out.a = Math.atan2(by - ay, bx - ax);
      return out;
    }
    base += len;
  }
  out.x = pts[0][0];
  out.y = pts[0][1];
  out.a = 0;
  return out;
}

/** Like routePoint, but past either end the route goes on straight (the horde front starts behind the hill). */
export function routePointExt(pts, s, out = { x: 0, y: 0, a: 0 }) {
  const len = pathLen(pts);
  if (s >= 0 && s <= len) return routePoint(pts, s, out);
  const i = s < 0 ? 0 : pts.length - 1;
  const j = s < 0 ? 1 : pts.length - 2;
  const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
  const l = Math.hypot(dx, dy) || 1;
  const over = s < 0 ? -s : s - len;
  out.x = pts[i][0] + (dx / l) * over;
  out.y = pts[i][1] + (dy / l) * over;
  out.a = Math.atan2(s < 0 ? -dy : dy, s < 0 ? -dx : dx);
  return out;
}

/** Length of a polyline in px. */
export function pathLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Distance in px from (x, y) to the front (positive: ahead of it, negative: behind). */
export function frontGap(pts, front, x, y) {
  if (!(front > -1e8)) return Infinity;
  return routeProgress(pts, x, y).s - front;
}

/** Title and subtitle of the stage banner shown when a stage or floor starts. */
export function stageBanner(map, c) {
  const camp = map && map.campaign;
  switch (c && c.stage) {
    case 1: return { title: 'HILLTOP STAND', sub: 'Hold the hill. The high ground is yours: the slope slows them and they take more damage' };
    case 2: return { title: 'BREAKOUT', sub: 'The hill is overrun! Fight to the tower before the horde front catches you' };
    case 3: {
      const f = camp && camp.floors[c.floor - 1];
      return { title: `FLOOR ${c.floor}`, sub: f ? f.name.toUpperCase() : '' };
    }
    case 4: return { title: 'ROOFTOP', sub: 'Hold the roof. Kill the quota, then ride the zip line out' };
    default: return { title: '', sub: '' };
  }
}
