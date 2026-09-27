// Fixtures for the render sandbox: a small highway MapDef following SPEC §2 that uses
// every area/line/obstacle/decor kind, and an animated Snapshot generator (SPEC §4) with
// every player class, zombie type and flag, projectile, pickup, deployable, hazard and
// GameEvent type. It is a puppet show, not a simulation: zombies walk at the players,
// die on a timer and respawn at the edges, and events are emitted to exercise the
// renderer. Deterministic for a given seed.

import { createRng } from '../js/shared/rng.js';
import { WEAPONS } from '../js/shared/weapons.js';
import { ZOMBIES, ZFLAG } from '../js/shared/zombies.js';
import { CLASSES, CLASS_IDS } from '../js/shared/classes.js';
import { PICKUP_KINDS } from '../js/shared/items.js';
import { BLEEDOUT_TIME } from '../js/shared/constants.js';

const TAU = Math.PI * 2;

/**
 * A 2600 x 1700 stretch of night highway with a bit of everything on it.
 * @param {'bus'|'diner'|'apc'|'radio'} objectiveKind
 */
export function createFixtureMap(objectiveKind = 'bus') {
  const rng = createRng(4242);
  const W = 2600, H = 1700;
  const map = {
    id: 'fixture', name: 'Fixture Highway', width: W, height: H, seed: 4242,
    ambient: { darkness: 0.68, tint: '#2c4a7a' },
    ground: '#34452a',
    areas: [], lines: [], obstacles: [], decor: [], lights: [], fires: [],
    playerSpawns: [], zombieSpawns: [], objective: null, supply: null,
  };
  const area = (kind, x, y, w, h, a = 0) => map.areas.push({ kind, x, y, w, h, a });
  // verges and fields
  area('grass', 1300, 250, 2600, 500);
  area('grass', 1300, 1470, 2600, 460);
  for (let i = 0; i < 10; i++) area('dirt', rng.range(100, 2500), rng.range(80, 420), rng.range(120, 260), rng.range(80, 160), rng.range(-3, 3));
  for (let i = 0; i < 6; i++) area('dirt', rng.range(100, 2500), rng.range(1320, 1640), rng.range(120, 260), rng.range(80, 160), rng.range(-3, 3));
  area('gravel', 1300, 575, 2600, 50);
  area('gravel', 1300, 1225, 2600, 50);
  area('asphalt', 1300, 900, 2600, 600);
  area('concrete', 380, 300, 520, 300);
  area('sand', 2200, 300, 360, 220, 0.2);
  area('water', 2350, 1500, 420, 260);
  // road paint
  const line = (kind, x1, y1, x2, y2, w) => map.lines.push({ kind, x1, y1, x2, y2, w });
  line('white', 0, 614, W, 614, 4);
  line('white', 0, 1186, W, 1186, 4);
  line('yellow_double', 0, 900, W, 900, 3);
  for (const y of [757, 1043]) line('white_dashed', 0, y, W, y, 3);
  line('crosswalk', 1900, 618, 1900, 1182, 40);
  line('stop', 1855, 620, 1855, 895, 6);
  for (let x = 160; x <= 600; x += 58) line('parking', x, 190, x, 270, 3);
  // obstacles
  let id = 0;
  const ob = (kind, x, y, w, h, a, extra = {}) => {
    const o = { id: id++, kind, x, y, w, h, a, color: extra.color || '#777777', solid: extra.solid ?? true, wrecked: !!extra.wrecked, roof: extra.roof || null };
    map.obstacles.push(o);
    return o;
  };
  const colors = ['#6b2d2a', '#2f4858', '#5b5f63', '#8a8d8f', '#3b4a3a', '#7a6a4f', '#355c7d', '#9a9c98'];
  // pileup on the westbound lanes
  ob('car', 600, 700, 84, 42, 0.3, { color: colors[0] });
  ob('car', 700, 760, 84, 42, -0.5, { color: colors[1], wrecked: true });
  ob('suv', 820, 690, 92, 46, 0.1, { color: colors[2] });
  ob('pickup', 960, 740, 100, 46, 2.9, { color: colors[3] });
  ob('van', 1090, 700, 104, 50, 0.2, { color: colors[4], wrecked: true });
  ob('truck', 480, 1060, 136, 56, Math.PI, { color: '#4b5320' });
  ob('car', 1500, 1100, 84, 42, Math.PI + 0.2, { color: colors[5] });
  ob('car', 1630, 1040, 84, 42, Math.PI - 0.4, { color: colors[6], wrecked: true });
  ob('suv', 2250, 1080, 92, 46, Math.PI + 0.05, { color: colors[7] });
  // semi: trailer + jackknifed cab
  ob('semi', 2200, 720, 240, 62, 0.15, { color: '#cfcac0' });
  ob('semi', 2340, 790, 60, 56, 0.9, { color: '#8a2f2a' });
  ob('bus', 300, 760, 250, 62, 0.05, { color: '#3f6a8a', wrecked: true });
  ob('tanker', 1300, 1110, 230, 60, Math.PI, { color: '#b9bcbf', wrecked: false });
  // barriers & cover
  for (let i = 0; i < 4; i++) ob('barrier', 1480 + i * 48, 820, 48, 14, 0, { color: '#9a9890', solid: false });
  ob('sandbags', 1200, 840, 90, 24, 0.5, { color: '#8a7a55', solid: false });
  for (let i = 0; i < 5; i++) ob('guardrail', 250 + i * 250, 600, 250, 8, 0, { color: '#8f979c', solid: false });
  ob('building', 380, 300, 260, 170, 0, { color: '#9a8f7e', roof: '#5b5048' });
  ob('booth', 700, 330, 50, 40, 0, { color: '#5b6150', roof: '#44493c' });
  ob('wall', 1000, 520, 300, 6, 0, { color: '#6b5433', solid: false });
  ob('wall', 1300, 420, 200, 14, Math.PI / 2, { color: '#77736b' });
  ob('container', 1600, 350, 120, 50, 0.1, { color: '#7a3b2e', roof: '#7a3b2e' });
  ob('pump', 450, 520, 40, 22, 0, { color: '#c9c4b6' });
  ob('hesco', 1850, 470, 114, 44, 0, { color: '#a08a62' });
  ob('tent', 2100, 420, 110, 70, 0.1, { color: '#5a6340', roof: '#6b7449' });
  ob('pillar', 1450, 520, 18, 18, 0, { color: '#8d8a82' });
  ob('rock', 900, 1400, 50, 36, 0.4, { color: '#6d6a63' });
  ob('rock', 1700, 1500, 38, 30, 1.2, { color: '#6d6a63' });
  for (const [x, y, s] of [[150, 1400, 1], [520, 1500, 1.2], [1150, 1450, 0.9], [2000, 1400, 1.1], [2500, 150, 1], [1900, 150, 1.2], [1200, 180, 0.9]]) {
    ob('tree', x, y, 20 + 10 * s, 20 + 10 * s, rng.range(0, TAU), { color: '#4a3826' });
    map.decor.push({ kind: 'tree_canopy', x, y, a: rng.range(0, TAU), s: 0.85 + s * 0.55 });
  }
  // decor
  const decor = (kind, x, y, a = 0, s = 1) => map.decor.push({ kind, x, y, a, s });
  for (let i = 0; i < 120; i++) decor('grass_tuft', rng.range(0, W), rng.pick([rng.range(0, 560), rng.range(1250, H)]), rng.range(0, TAU), rng.range(0.7, 1.3));
  for (let i = 0; i < 40; i++) decor('bush', rng.range(0, W), rng.pick([rng.range(0, 540), rng.range(1270, H)]), rng.range(0, TAU), rng.range(0.6, 1.2));
  for (let i = 0; i < 20; i++) decor('rock', rng.range(0, W), rng.pick([rng.range(0, 540), rng.range(1270, H)]), rng.range(0, TAU), rng.range(0.6, 1.4));
  for (let i = 0; i < 30; i++) decor('crack', rng.range(0, W), rng.range(640, 1160), rng.range(0, TAU), rng.range(0.7, 1.5));
  for (let i = 0; i < 25; i++) decor('debris', rng.range(0, W), rng.range(640, 1160), rng.range(0, TAU), rng.range(0.7, 1.3));
  for (let i = 0; i < 14; i++) decor('oil', rng.range(0, W), rng.range(640, 1160), rng.range(0, TAU), rng.range(0.6, 1.4));
  for (let i = 0; i < 16; i++) decor('blood_old', rng.range(0, W), rng.range(620, 1180), rng.range(0, TAU), rng.range(0.6, 1.3));
  for (let i = 0; i < 20; i++) decor('paper', rng.range(0, W), rng.range(600, 1200), rng.range(0, TAU), 1);
  for (let i = 0; i < 12; i++) decor('skid', rng.range(0, W), rng.range(650, 1150), rng.range(-0.3, 0.3), rng.range(0.8, 1.8));
  for (let i = 0; i < 8; i++) decor('tire', rng.range(0, W), rng.range(620, 1180), 0, rng.range(0.8, 1.2));
  for (let i = 0; i < 10; i++) decor('cone', 1400 + i * 30, 640 + (i % 2) * 20, 0, 1);
  for (let i = 0; i < 6; i++) decor('rubble', rng.range(200, 2400), rng.range(400, 600), 0, rng.range(0.7, 1.3));
  decor('manhole', 1700, 960, 0, 1);
  decor('manhole', 700, 1000, 0, 1);
  decor('sign', 300, 1250, 0, 1.2);
  decor('flag', 1340, 560, 0, 1);
  const lamp = (x, y, on = true) => {
    decor('lamp_post', x, y, 0, 1);
    if (on) map.lights.push({ x, y, r: 230, color: '#ffcf8a', flicker: 0 });
  };
  for (const x of [200, 700, 1200, 1700, 2200]) lamp(x, 590, x !== 1200);
  for (const x of [450, 950, 1450, 1950, 2450]) lamp(x, 1210);
  map.lights.push({ x: 2380, y: 1500, r: 200, color: '#9fd8ff', flicker: 0.2 });
  // burning wrecks
  for (const [x, y, r] of [[1110, 690, 30], [712, 750, 22], [2330, 790, 26]]) {
    map.fires.push({ x, y, r });
    map.lights.push({ x, y, r: 200 + r * 2, color: '#ff8a33', flicker: 0.55 });
  }
  // objective + supply
  const objSize = { bus: [250, 62], diner: [260, 160], apc: [150, 70], radio: [70, 70] }[objectiveKind] || [250, 62];
  const objName = { bus: 'School Bus', diner: 'The Diner', apc: 'Army APC', radio: 'Radio Tower' }[objectiveKind] || 'School Bus';
  map.objective = { kind: objectiveKind, name: objName, x: 1300, y: 900, w: objSize[0], h: objSize[1], a: objectiveKind === 'bus' ? -0.04 : 0, hp: 5000 };
  map.supply = { x: 1300, y: 690 };
  for (let i = 0; i < 6; i++) map.playerSpawns.push({ x: 1180 + i * 48, y: 1010 });
  map.zombieSpawns.push({ x: 60, y: 900, w: 100, h: 500 }, { x: W - 60, y: 900, w: 100, h: 500 },
    { x: 1300, y: 60, w: 1600, h: 90 }, { x: 1000, y: H - 60, w: 1400, h: 90 });
  return map;
}

// ---------------------------------------------------------------------------------------------

const ZTYPE_MIX = [
  ['walker', 44], ['runner', 16], ['crawler', 10], ['bloater', 7], ['spitter', 7], ['screamer', 6], ['brute', 4], ['boss', 1],
];
const PLAYER_WEAPONS = [
  ['rifle', 'dmr', 'minigun'], ['uzi', 'dual_smg', 'tesla'], ['shotgun', 'auto_shotgun', 'flamethrower'],
  ['magnum', 'sniper', 'railgun'], ['sawedoff', 'grenade_launcher', 'rocket'], ['lmg', 'crossbow', 'pistol'],
];

/**
 * Animated Snapshot + event stream for the sandbox.
 * @param {object} map MapDef
 * @param {{zombies?:number, seed?:number, spam?:boolean, states?:boolean}} opts
 */
export function createFixtureScene(map, opts = {}) {
  const rng = createRng(opts.seed || 7);
  let spam = !!opts.spam;
  const zCount = opts.zombies ?? 250;
  const ob = map.objective;
  const cx = ob ? ob.x : map.width / 2, cy = ob ? ob.y + ob.h / 2 + 90 : map.height / 2;
  let tick = 0, time = 0;
  const roster = CLASS_IDS.map((cls, i) => ({ id: i + 1, name: ['Hawk', 'Doc', 'Sparks', 'Swift', 'Boom', 'Tank'][i], color: i, cls, ready: false, ping: 40 + i * 9, host: i === 0 }));
  const players = roster.map((r, i) => {
    const a = (i / 6) * TAU;
    const w = CLASSES[r.cls].startWeapon;
    return {
      id: r.id, x: cx + Math.cos(a) * 130, y: cy + Math.sin(a) * 90, angle: a,
      state: 'alive', hp: 100, maxHp: CLASSES[r.cls].perks.maxHp || 100, armor: i === 5 ? 50 : 20, stamina: 100, sprinting: false,
      slot: 1, slots: ['pistol', w, null], ammo: [[12, -1], [20, 100], [0, 0]], reloading: 0, spin: 0, firing: false, meleeing: 0,
      cash: 500, kills: 0, damage: 0, revives: 0, downs: 0, frags: 2, molotovs: 1, turrets: 0, barricades: 0,
      selfRevive: false, bleedout: 0, revive: 0, reviver: 0, respawn: false, ready: false, lastSeq: 0,
      // fixture-only
      _home: a, _wi: i, _cool: 0,
    };
  });
  const local = players[0];
  local.x = cx; local.y = cy + 20;

  const spawns = map.zombieSpawns.length ? map.zombieSpawns : [{ x: 50, y: map.height / 2, w: 60, h: 400 }];
  const zombies = [];
  let nextZid = 1;
  function pickType() {
    let total = 0;
    for (const [, w] of ZTYPE_MIX) total += w;
    let r = rng.next() * total;
    for (const [t, w] of ZTYPE_MIX) { r -= w; if (r < 0) return t; }
    return 'walker';
  }
  function placeZombie(z, near) {
    if (near) {
      const a = rng.range(0, TAU), d = rng.range(160, 700);
      z.x = cx + Math.cos(a) * d * 1.3;
      z.y = cy + Math.sin(a) * d * 0.9;
    } else {
      const s = rng.pick(spawns);
      z.x = s.x + (rng.next() - 0.5) * s.w;
      z.y = s.y + (rng.next() - 0.5) * s.h;
    }
    z.x = Math.max(20, Math.min(map.width - 20, z.x));
    z.y = Math.max(20, Math.min(map.height - 20, z.y));
  }
  function newZombie(near) {
    const type = zombies.filter((z) => z.type === 'boss').length >= 2 && rng.chance(0.9) ? 'walker' : pickType();
    const def = ZOMBIES[type];
    const z = {
      id: nextZid, type, x: 0, y: 0, angle: 0, hp: 1, flags: 0,
      _speed: rng.range(def.speed[0], def.speed[1]) * 0.6, _life: rng.range(4, 30), _cool: rng.range(0, 3), _charge: 0,
    };
    nextZid = (nextZid % 65000) + 1;
    placeZombie(z, near);
    if (rng.chance(0.05)) z.flags |= ZFLAG.BURNING;
    if (rng.chance(0.08)) z.flags |= ZFLAG.BUFFED;
    if (type !== 'boss' && rng.chance(0.04)) z.flags |= ZFLAG.ELITE;
    z.hp = rng.range(0.3, 1);
    return z;
  }
  for (let i = 0; i < zCount; i++) zombies.push(newZombie(true));

  const projectiles = [];
  let nextPid = 1;
  const pickups = PICKUP_KINDS.map((kind, i) => ({ id: i + 1, kind, x: cx - 150 + i * 60, y: cy + 150, weapon: kind === 'crate' ? 'rocket' : null }));
  const turrets = [
    { id: 1, owner: 3, x: cx - 230, y: cy - 30, angle: 0, hp: 0.9, ammo: 0.7, firing: false },
    { id: 2, owner: 3, x: cx + 240, y: cy - 20, angle: Math.PI, hp: 0.3, ammo: 0.15, firing: false },
  ];
  const barricades = [
    { id: 1, owner: 3, x: cx - 330, y: cy + 60, angle: Math.PI / 2, hp: 1 },
    { id: 2, owner: 3, x: cx + 340, y: cy + 60, angle: Math.PI / 2, hp: 0.55 },
    { id: 3, owner: 2, x: cx, y: cy + 250, angle: 0, hp: 0.2 },
  ];
  const hazards = [
    { id: 1, kind: 'fire', x: cx - 420, y: cy - 150, r: 110, life: 1 },
    { id: 2, kind: 'acid', x: cx + 380, y: cy + 180, r: 60, life: 1 },
  ];
  let nextHid = 3;
  let events = [];
  let objHp = 4200;

  function nearestZombie(x, y, maxD = 900) {
    let best = null, bd = maxD * maxD;
    for (const z of zombies) {
      const d = (z.x - x) ** 2 + (z.y - y) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  function killZombie(z, by, gib) {
    events.push({ type: 'zdie', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle, by, gib: !!gib });
    if (z.type === 'bloater') events.push({ type: 'explosion', x: z.x, y: z.y, r: 115, kind: 'bloater' });
    const i = zombies.indexOf(z);
    if (i >= 0) zombies[i] = newZombie(false);
  }

  function fireWeapon(p, target) {
    const wid = p.slots[p.slot];
    const w = WEAPONS[wid];
    if (!w) return;
    const ang = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.angle;
    p.angle = ang;
    const mx = p.x + Math.cos(ang) * 22, my = p.y + Math.sin(ang) * 22;
    const ev = { type: 'shot', pid: p.id, turret: 0, weapon: wid, x: mx, y: my, angle: ang, rays: [] };
    if (w.kind === 'hitscan' || w.kind === 'rail') {
      for (let k = 0; k < w.pellets; k++) {
        const a = ang + (rng.next() - 0.5) * 2 * w.spread;
        let d = w.kind === 'rail' ? 1400 : Math.min(w.range, rng.range(200, w.range));
        let hit = rng.chance(0.3) ? 2 : 0;
        if (target) {
          const td = Math.hypot(target.x - mx, target.y - my);
          if (k === 0 || rng.chance(0.5)) { d = td; hit = 1; }
        }
        ev.rays.push({ x: mx + Math.cos(a) * d, y: my + Math.sin(a) * d, hit });
      }
      if (target && rng.chance(w.kind === 'rail' ? 1 : 0.12 + w.damage / 600)) killZombie(target, p.id, w.kind === 'rail' || rng.chance(0.15));
    } else if (w.kind === 'chain') {
      const pts = [{ x: mx, y: my }];
      let cur = target;
      const used = new Set();
      for (let k = 0; k < 5 && cur; k++) {
        pts.push({ x: cur.x, y: cur.y });
        used.add(cur);
        let nb = null, nd = 180 * 180;
        for (const z of zombies) {
          if (used.has(z)) continue;
          const dd = (z.x - cur.x) ** 2 + (z.y - cur.y) ** 2;
          if (dd < nd) { nd = dd; nb = z; }
        }
        cur = nb;
      }
      if (pts.length > 1) events.push({ type: 'chain', pid: p.id, points: pts });
      if (target && rng.chance(0.2)) killZombie(target, p.id, false);
    } else if (w.kind === 'flame') {
      for (let k = 0; k < 2; k++) {
        projectiles.push({ id: nextPid++, kind: 'flame', x: mx, y: my, angle: ang + (rng.next() - 0.5) * 0.25, _v: 620, _life: 0.5 });
      }
    } else if (w.kind === 'projectile') {
      projectiles.push({ id: nextPid++, kind: w.projectile.kind, x: mx, y: my, angle: ang, _v: w.projectile.speed * 0.6, _life: w.projectile.life });
    }
    events.push(ev);
  }

  function step(dt, aim) {
    tick++;
    time += dt;
    events = [];
    const rate = spam ? 3 : 1;

    // players
    for (const p of players) {
      if (p !== local) {
        p.x = cx + Math.cos(p._home + time * 0.1) * 150;
        p.y = cy + Math.sin(p._home + time * 0.1) * 100;
      }
      // cycle every player through all weapons so every sprite is exercised
      const wi = Math.floor(time / 5 + p._wi) % 3;
      const wid = PLAYER_WEAPONS[p._wi][wi];
      if (p.slots[1] !== wid) {
        p.slots[1] = wid;
        events.push({ type: 'switch', pid: p.id, weapon: wid });
      }
      p.spin = wid === 'minigun' ? 1 : 0;
      p.firing = false;
      p.meleeing = Math.max(0, p.meleeing - dt * 3);
      if (p.state !== 'alive') continue;
      const t = nearestZombie(p.x, p.y, 700);
      if (p === local && aim != null) p.angle = aim;
      else if (t) p.angle = Math.atan2(t.y - p.y, t.x - p.x);
      p._cool -= dt;
      const w = WEAPONS[wid];
      if (p._cool <= 0 && t && (p !== local || opts.localFires !== false)) {
        p._cool = 1 / Math.min(w.rate, 12) / rate * (0.8 + rng.next() * 0.6);
        p.firing = true;
        fireWeapon(p, p === local ? null : t);
        if (p === local) {
          // local shots go where the cursor aims; hit whatever is near that line
          const ev = events[events.length - 1];
          if (ev && ev.type === 'shot' && ev.rays.length) {
            const r0 = ev.rays[0];
            const z = nearestZombie(r0.x, r0.y, 80);
            if (z) { r0.x = z.x; r0.y = z.y; r0.hit = 1; if (rng.chance(0.15)) killZombie(z, p.id, false); }
          }
        }
      }
      if (rng.chance(0.004 * rate)) {
        p.meleeing = 1;
        events.push({ type: 'melee', pid: p.id, x: p.x, y: p.y, angle: p.angle, hits: rng.int(0, 3) });
      }
      p.reloading = ((time + p._wi * 1.3) % 6) < 1.2 ? ((time + p._wi * 1.3) % 6) / 1.2 : 0;
      if (p.reloading > 0 && p.reloading < dt * 1.5) events.push({ type: 'reload', pid: p.id, weapon: wid });
      p.ammo[1][0] = Math.max(0, Math.round(20 - ((time * 3) % 21)));
      p.hp = Math.max(8, 100 - ((time * 7 + p._wi * 20) % 95));
    }
    // player state cycles: #5 goes down and gets revived, #6 dies and respawns
    const cyc = time % 24;
    const p5 = players[4], p6 = players[5];
    if (opts.states !== false) {
      if (cyc < 12) {
        if (p5.state !== 'downed') { p5.state = 'downed'; events.push({ type: 'down', pid: p5.id }); }
        p5.bleedout = BLEEDOUT_TIME - cyc * 2;
        p5.revive = cyc > 6 ? (cyc - 6) / 6 : 0;
        p5.reviver = cyc > 6 ? 2 : 0;
      } else if (p5.state === 'downed') {
        p5.state = 'alive'; p5.bleedout = 0; p5.revive = 0; p5.reviver = 0;
        events.push({ type: 'revived', pid: p5.id, by: 2 });
      }
      if (cyc > 14 && cyc < 22) {
        if (p6.state !== 'dead') { p6.state = 'dead'; p6.respawn = true; events.push({ type: 'died', pid: p6.id }); }
      } else if (p6.state === 'dead') {
        p6.state = 'alive'; p6.respawn = false;
        events.push({ type: 'respawn', pid: p6.id });
      }
    }

    // zombies shamble at the nearest player
    for (const z of zombies) {
      let best = null, bd = Infinity;
      for (const p of players) {
        if (p.state === 'dead') continue;
        const d = (p.x - z.x) ** 2 + (p.y - z.y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      const def = ZOMBIES[z.type];
      z.flags &= ~(ZFLAG.ATTACKING | ZFLAG.CHARGING);
      if (best) {
        const d = Math.sqrt(bd);
        const target = Math.atan2(best.y - z.y, best.x - z.x);
        z.angle = target;
        const stop = def.radius + 16 + 8 + (z.type === 'spitter' ? 220 : 0) + (z.id % 5) * 12;
        let sp = z._speed;
        if (z.type === 'brute') {
          z._charge -= dt;
          if (z._charge < -6 && d < 320) { z._charge = 1.1; events.push({ type: 'charge', id: z.id, x: z.x, y: z.y, angle: z.angle }); }
          if (z._charge > 0) { z.flags |= ZFLAG.CHARGING; sp = 330 * 0.6; }
        }
        if (d > stop) {
          z.x += Math.cos(target) * sp * dt;
          z.y += Math.sin(target) * sp * dt;
        } else {
          z.flags |= ZFLAG.ATTACKING;
          z._cool -= dt;
          if (z._cool <= 0) {
            z._cool = 1 / def.attackRate;
            if (z.type === 'spitter') {
              events.push({ type: 'spit', id: z.id, x: z.x, y: z.y, angle: z.angle });
              projectiles.push({ id: nextPid++, kind: 'acid', x: z.x, y: z.y, angle: z.angle, _v: 420 * 0.6, _life: d / (420 * 0.6) });
            } else if (z.type === 'boss') {
              events.push({ type: 'slam', id: z.id, x: z.x, y: z.y, r: 190 });
            } else if (z.type === 'screamer') {
              events.push({ type: 'scream', id: z.id, x: z.x, y: z.y });
            } else {
              events.push({ type: 'zattack', id: z.id, ztype: z.type, x: z.x, y: z.y, angle: z.angle });
              if (best === local && rng.chance(0.3)) events.push({ type: 'pdamage', pid: local.id, amount: def.damage, x: z.x, y: z.y });
            }
          }
        }
      }
      z._life -= dt * rate;
      if (z._life <= 0 && z.hp > 0) killZombie(z, rng.pick(players).id, rng.chance(0.12));
      else if (rng.chance(0.01 * rate)) z.hp = Math.max(0.05, z.hp - rng.range(0.05, 0.3));
    }

    // turrets track the nearest zombie
    for (const t of turrets) {
      const z = nearestZombie(t.x, t.y, 520);
      t.firing = false;
      if (z) {
        t.angle = Math.atan2(z.y - t.y, z.x - t.x);
        if (rng.chance(0.12 * rate)) {
          t.firing = true;
          const mx = t.x + Math.cos(t.angle) * 24, my = t.y + Math.sin(t.angle) * 24;
          events.push({ type: 'shot', pid: 0, turret: t.id, weapon: 'rifle', x: mx, y: my, angle: t.angle, rays: [{ x: z.x, y: z.y, hit: 1 }] });
        }
      }
    }

    // thrown stuff and periodic set pieces
    if (rng.chance(0.006 * rate)) {
      const p = rng.pick(players.filter((q) => q.state === 'alive'));
      if (p) {
        const kind = rng.chance(0.5) ? 'frag' : 'molotov';
        projectiles.push({ id: nextPid++, kind, x: p.x, y: p.y, angle: p.angle, _v: 380, _life: kind === 'frag' ? 1.4 : 0.9 });
        events.push({ type: 'throw', pid: p.id, kind });
      }
    }
    if (rng.chance(0.004 * rate)) events.push({ type: 'objhit', x: cx + rng.range(-100, 100), y: (ob ? ob.y : cy) + rng.range(-30, 30) });
    if (tick % 600 === 300) events.push({ type: 'drop', x: map.supply ? map.supply.x + 60 : cx, y: map.supply ? map.supply.y : cy });
    if (tick % 900 === 450) {
      const z = zombies.find((q) => q.type === 'boss');
      if (z) events.push({ type: 'bossspawn', id: z.id, x: z.x, y: z.y });
    }
    if (tick % 480 === 100) events.push({ type: 'place', pid: 3, kind: 'barricade', x: barricades[2].x, y: barricades[2].y });
    if (tick % 720 === 360) events.push({ type: 'destroyed', kind: rng.chance(0.5) ? 'turret' : 'barricade', id: 9, x: cx + rng.range(-300, 300), y: cy + 220 });
    if (tick % 420 === 200) {
      const pk = rng.pick(pickups);
      events.push({ type: 'pickup', pid: 1, kind: pk.kind, x: pk.x, y: pk.y, weapon: pk.weapon });
    }
    if (tick % 1200 === 1) events.push({ type: 'wave', wave: 5, boss: true });
    if (tick % 300 === 150) events.push({ type: 'empty', pid: 1 });
    if (spam && tick % 20 === 0) {
      events.push({ type: 'explosion', x: cx + rng.range(-500, 500), y: cy + rng.range(-350, 350), r: rng.pick([130, 150, 180]), kind: rng.pick(['frag', 'grenade', 'rocket']) });
    }

    // projectiles fly
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p._life -= dt;
      const v = p.kind === 'frag' || p.kind === 'molotov' ? p._v * Math.max(0.1, p._life) : p._v;
      p.x += Math.cos(p.angle) * v * dt;
      p.y += Math.sin(p.angle) * v * dt;
      if (p._life > 0) continue;
      projectiles.splice(i, 1);
      if (p.kind === 'rocket' || p.kind === 'grenade' || p.kind === 'frag') {
        events.push({ type: 'explosion', x: p.x, y: p.y, r: p.kind === 'rocket' ? 180 : p.kind === 'grenade' ? 130 : 150, kind: p.kind });
        for (const z of zombies) if ((z.x - p.x) ** 2 + (z.y - p.y) ** 2 < 90 * 90 && rng.chance(0.5)) killZombie(z, 5, true);
      } else if (p.kind === 'molotov') {
        events.push({ type: 'ignite', x: p.x, y: p.y, r: 110 });
        hazards.push({ id: nextHid++, kind: 'fire', x: p.x, y: p.y, r: 110, life: 1, _dur: 7 });
      } else if (p.kind === 'acid') {
        hazards.push({ id: nextHid++, kind: 'acid', x: p.x, y: p.y, r: 60, life: 1, _dur: 4 });
      }
    }
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      if (!h._dur) continue;
      h.life -= dt / h._dur;
      if (h.life <= 0) hazards.splice(i, 1);
    }
    if (hazards.length > 14) hazards.splice(2, hazards.length - 14);

    objHp = 1500 + (Math.sin(time * 0.05) * 0.5 + 0.5) * 3500;
    return {
      view: {
        tick, phase: 'wave', wave: 5, totalWaves: 15, timer: 0, remaining: zombies.length,
        bossHp: zombies.some((z) => z.type === 'boss') ? 0.6 : -1,
        objective: ob ? { hp: objHp, maxHp: 5000 } : null,
        readyCount: 0,
        players, zombies, projectiles, pickups, turrets, barricades, hazards, events: [],
      },
      events,
    };
  }

  return {
    roster,
    localId: 1,
    get local() { return local; },
    setSpam(v) { spam = !!v; },
    step,
    /** Move the local player by (dx, dy) world px (sandbox WASD). */
    moveLocal(dx, dy) {
      local.x = Math.max(20, Math.min(map.width - 20, local.x + dx));
      local.y = Math.max(20, Math.min(map.height - 20, local.y + dy));
    },
  };
}

/** Every event type from SPEC §4.1 once, positioned around (x, y) — for unit checks. */
export function allEventsSample(x, y) {
  return [
    { type: 'shot', pid: 1, turret: 0, weapon: 'shotgun', x, y, angle: 0, rays: [{ x: x + 200, y, hit: 1 }, { x: x + 180, y: y + 30, hit: 2 }, { x: x + 400, y: y - 40, hit: 0 }] },
    { type: 'shot', pid: 1, turret: 0, weapon: 'railgun', x, y, angle: 0.3, rays: [{ x: x + 900, y: y + 270, hit: 1 }] },
    { type: 'shot', pid: 0, turret: 1, weapon: 'rifle', x, y, angle: 1, rays: [{ x: x + 100, y: y + 150, hit: 1 }] },
    { type: 'shot', pid: 2, turret: 0, weapon: 'flamethrower', x, y, angle: 2, rays: [] },
    { type: 'shot', pid: 2, turret: 0, weapon: 'rocket', x, y, angle: 2, rays: [] },
    { type: 'chain', pid: 1, points: [{ x, y }, { x: x + 100, y: y + 20 }, { x: x + 180, y: y + 80 }] },
    { type: 'melee', pid: 1, x, y, angle: 0, hits: 2 },
    { type: 'zdie', id: 5, ztype: 'walker', x: x + 50, y, angle: 0, by: 1, gib: false },
    { type: 'zdie', id: 6, ztype: 'brute', x: x + 90, y, angle: 0, by: 1, gib: true },
    { type: 'zdie', id: 7, ztype: 'bloater', x: x + 90, y: y + 40, angle: 0, by: 0, gib: false },
    { type: 'zattack', id: 8, ztype: 'runner', x, y, angle: 1 },
    { type: 'spit', id: 9, x, y, angle: 0 },
    { type: 'scream', id: 10, x, y },
    { type: 'charge', id: 11, x, y, angle: 0 },
    { type: 'slam', id: 12, x, y, r: 190 },
    { type: 'explosion', x, y, r: 150, kind: 'frag' },
    { type: 'explosion', x, y, r: 115, kind: 'bloater' },
    { type: 'ignite', x, y, r: 110 },
    { type: 'pdamage', pid: 1, amount: 12, x: x - 20, y },
    { type: 'down', pid: 2 }, { type: 'revived', pid: 2, by: 1 }, { type: 'died', pid: 3 }, { type: 'respawn', pid: 3 },
    { type: 'pickup', pid: 1, kind: 'health', x, y, weapon: null },
    { type: 'buy', pid: 1, item: 'ammo' }, { type: 'buyfail', pid: 1, item: 'turret', reason: 'cash' },
    { type: 'reload', pid: 1, weapon: 'rifle' }, { type: 'switch', pid: 1, weapon: 'rifle' }, { type: 'empty', pid: 1 },
    { type: 'throw', pid: 1, kind: 'frag' },
    { type: 'place', pid: 1, kind: 'turret', x, y }, { type: 'destroyed', kind: 'turret', id: 1, x, y },
    { type: 'destroyed', kind: 'barricade', id: 2, x, y },
    { type: 'objhit', x, y }, { type: 'wave', wave: 3, boss: false }, { type: 'bossspawn', id: 99, x, y },
    { type: 'waveclear', wave: 3, bonus: 250 }, { type: 'drop', x, y }, { type: 'gameover', reason: 'wiped' }, { type: 'victory' },
    { type: 'some_future_event', foo: 1 },
  ];
}

