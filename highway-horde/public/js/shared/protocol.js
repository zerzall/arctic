// Binary wire format for the two high-rate messages: host → client snapshots and
// client → host input commands (SPEC §5). Everything else (lobby, chat, buy, ping)
// travels as small JSON objects on the reliable 'ctl' channel.
//
// Every binary message starts with [type tag u8][PROTOCOL_VERSION u8], so snapshots and
// inputs can share a channel and a client built from another version fails loudly
// instead of misreading bytes. Multi-byte values are little-endian.
//
// Quantisation (decoded values are a "quantised copy" of the original):
//   player / barricade positions  f32 (client prediction replays from them, keep exact)
//   other entity positions        u16, 0.25 px, offset so -1024..15359 fits
//   event positions               i16, 0.5 px (tracer end points may lie off the map)
//   player / turret / event angles u16; zombie / projectile angles u8
//   0..1 values                   u8 (reloading/meleeing never round a non-zero to 0)
//   player vertical state         exact integers (jump.js): zq u16, vzq i8, jumpCd u8,
//                                 climbT u8 (+ climbTo u16 while climbing); z = zq × Z_UNIT
//   zombie height                 u16 whole units, only for zombies off the ground (flag bit 128)
//   kinds and ids of data tables  u8 indices into WEAPON_IDS, ZOMBIE_IDS, ...
// Events use a per-type binary schema; an event this file does not know (or one whose
// values do not fit its schema) is sent as JSON instead, so nothing is dropped unless
// that JSON is over MAX_JSON_EVENT_BYTES.

import { PROTOCOL_VERSION } from './constants.js';
import { TAU, wrapAngle } from './math.js';
import { WEAPON_IDS, PROJECTILE_KINDS } from './weapons.js';
import { ZOMBIE_IDS } from './zombies.js';
import { PICKUP_KINDS } from './items.js';
import { Z_UNIT } from './jump.js';
import { CAMPAIGN_EVENTS } from './campaign.js';

/** Message type tags (first byte of every binary message). */
export const MSG = {
  SNAPSHOT: 1,
  INPUTS: 2,
};

export const PHASES = ['prep', 'wave', 'intermission', 'gameover', 'victory'];
export const PLAYER_STATES = ['alive', 'downed', 'dead'];
export const HAZARD_KINDS = ['fire', 'acid', 'flare'];
/** Maximum InputCmds carried by one inputs message. */
export const MAX_INPUTS_PER_MESSAGE = 8;

const NONE = 255;
/** Zombie flags bit (wire only, above every ZFLAG): a height byte follows. */
const ZF_HIGH = 128;
const POS_OFFSET = 1024;
const JSON_EVENT = 255;
/**
 * An event that only fits as JSON and is bigger than this is sent as `null` (dropped by
 * the decoder): no single event may blow a snapshot past a transport's message limit.
 */
export const MAX_JSON_EVENT_BYTES = 1024;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const JSON_NULL = TEXT_ENCODER.encode('null');

// ---- index lookups (Map beats indexOf for the 26-entry weapon list in hot loops)

function indexMap(list) {
  const m = new Map();
  list.forEach((v, i) => m.set(v, i));
  return m;
}
const WEAPON_INDEX = indexMap(WEAPON_IDS);
const ZOMBIE_INDEX = indexMap(ZOMBIE_IDS);
const PROJECTILE_INDEX = indexMap(PROJECTILE_KINDS);
const PICKUP_INDEX = indexMap(PICKUP_KINDS);
const PHASE_INDEX = indexMap(PHASES);
const STATE_INDEX = indexMap(PLAYER_STATES);
const HAZARD_INDEX = indexMap(HAZARD_KINDS);

function kindIndex(map, v) {
  const i = map.get(v);
  return i === undefined ? NONE : i;
}

function kindAt(list, i) {
  return i < list.length ? list[i] : null;
}

// ---- growable little-endian writer, reused between messages

class Writer {
  constructor(size) {
    this.off = 0;
    this.alloc(size);
  }

  alloc(size) {
    const old = this.bytes;
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    if (old) this.bytes.set(old.subarray(0, this.off));
  }

  reset() {
    this.off = 0;
  }

  ensure(n) {
    if (this.off + n > this.buf.byteLength) this.alloc(Math.max(this.buf.byteLength * 2, this.off + n + 1024));
  }

  u8(v) {
    this.ensure(1);
    this.view.setUint8(this.off, v);
    this.off += 1;
  }

  i8(v) {
    this.ensure(1);
    this.view.setInt8(this.off, v);
    this.off += 1;
  }

  u16(v) {
    this.ensure(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }

  i16(v) {
    this.ensure(2);
    this.view.setInt16(this.off, v, true);
    this.off += 2;
  }

  u32(v) {
    this.ensure(4);
    this.view.setUint32(this.off, v, true);
    this.off += 4;
  }

  f32(v) {
    this.ensure(4);
    this.view.setFloat32(this.off, v, true);
    this.off += 4;
  }

  bytesOf(arr) {
    this.ensure(arr.length);
    this.bytes.set(arr, this.off);
    this.off += arr.length;
  }

  /** A fresh ArrayBuffer holding exactly the bytes written (safe to hand to a transport). */
  finish() {
    return this.buf.slice(0, this.off);
  }
}

class Reader {
  constructor(buf) {
    if (buf instanceof ArrayBuffer) {
      this.view = new DataView(buf);
    } else if (ArrayBuffer.isView(buf)) {
      this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      throw new TypeError('Binary message must be an ArrayBuffer or a typed array');
    }
    this.off = 0;
  }

  u8() {
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }

  i8() {
    const v = this.view.getInt8(this.off);
    this.off += 1;
    return v;
  }

  u16() {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  i16() {
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }

  u32() {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  f32() {
    const v = this.view.getFloat32(this.off, true);
    this.off += 4;
    return v;
  }

  bytes(n) {
    if (this.off + n > this.view.byteLength) throw new RangeError('Truncated message');
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.off, n);
    this.off += n;
    return out;
  }
}

// ---- scalar quantisers

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function qInt(v, max) {
  v = Math.round(num(v));
  return v < 0 ? 0 : v > max ? max : v;
}

function qPos(v) {
  return qInt((num(v) + POS_OFFSET) * 4, 65535);
}

function dqPos(q) {
  return q / 4 - POS_OFFSET;
}

function qEventPos(v) {
  const q = Math.round(num(v) * 2);
  return q < -32768 ? -32768 : q > 32767 ? 32767 : q;
}

function qAngle16(a) {
  return Math.round((num(a) / TAU) * 65536) & 0xffff;
}

function dqAngle16(q) {
  return wrapAngle((q / 65536) * TAU);
}

function qAngle8(a) {
  return Math.round((num(a) / TAU) * 256) & 0xff;
}

function dqAngle8(q) {
  return wrapAngle((q / 256) * TAU);
}

function qUnit(v) {
  return qInt(num(v) * 255, 255);
}

/** 0..1 where any positive value must stay distinguishable from "none". */
function qUnitNz(v) {
  v = num(v);
  if (v <= 0) return 0;
  return Math.max(1, qInt(v * 255, 255));
}

function qFixed(v, scale, max) {
  return qInt(num(v) * scale, max);
}

function qWeapon(id) {
  if (id === null || id === undefined) return NONE;
  return kindIndex(WEAPON_INDEX, id);
}

function dqWeapon(i) {
  return i === NONE ? null : kindAt(WEAPON_IDS, i);
}

// ---- event schemas
//
// Field codecs: pid u8 | id u16 | u16 | u32 | pos (event position) | ang (u16 angle)
// | amt/rad (u16, 0.1 units) | dur (u16, 1 ms: durations ≤ 65 s) | bool | wpn (weapon index, nullable) | ztype | pkind
// | str (≤ 60 chars) | enum list | rays | points.

const ENUMS = {
  explosion: ['frag', 'grenade', 'rocket', 'bloater'],
  throwKind: ['frag', 'molotov'],
  deployable: ['turret', 'barricade'],
  gameover: ['wiped', 'objective'],
  buyfail: ['cash', 'closed', 'max', 'invalid', 'owned'],
  zone: ['next', 'lock', 'shrink'],
  campaign: CAMPAIGN_EVENTS,
};

const EVENT_SCHEMAS = [
  ['shot', [['pid', 'pid'], ['turret', 'id'], ['weapon', 'wpn'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang'], ['rays', 'rays']]],
  ['chain', [['pid', 'pid'], ['points', 'points']]],
  ['melee', [['pid', 'pid'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang'], ['hits', 'u16']]],
  ['zdie', [['id', 'id'], ['ztype', 'ztype'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang'], ['by', 'pid'], ['gib', 'bool']]],
  ['zattack', [['id', 'id'], ['ztype', 'ztype'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang']]],
  ['spit', [['id', 'id'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang']]],
  ['scream', [['id', 'id'], ['x', 'pos'], ['y', 'pos']]],
  ['charge', [['id', 'id'], ['x', 'pos'], ['y', 'pos'], ['angle', 'ang']]],
  ['slam', [['id', 'id'], ['x', 'pos'], ['y', 'pos'], ['r', 'rad']]],
  ['explosion', [['x', 'pos'], ['y', 'pos'], ['r', 'rad'], ['kind', ENUMS.explosion]]],
  ['ignite', [['x', 'pos'], ['y', 'pos'], ['r', 'rad']]],
  ['pdamage', [['pid', 'pid'], ['amount', 'amt'], ['x', 'pos'], ['y', 'pos']]],
  ['down', [['pid', 'pid']]],
  ['revived', [['pid', 'pid'], ['by', 'pid']]],
  ['died', [['pid', 'pid']]],
  ['respawn', [['pid', 'pid']]],
  ['pickup', [['pid', 'pid'], ['kind', 'pkind'], ['x', 'pos'], ['y', 'pos'], ['weapon', 'wpn']]],
  ['buy', [['pid', 'pid'], ['item', 'str']]],
  ['buyfail', [['pid', 'pid'], ['item', 'str'], ['reason', ENUMS.buyfail]]],
  ['reload', [['pid', 'pid'], ['weapon', 'wpn'], ['time', 'dur']]],
  ['switch', [['pid', 'pid'], ['weapon', 'wpn']]],
  ['empty', [['pid', 'pid']]],
  ['throw', [['pid', 'pid'], ['kind', ENUMS.throwKind]]],
  ['place', [['pid', 'pid'], ['kind', ENUMS.deployable], ['x', 'pos'], ['y', 'pos']]],
  ['placefail', [['pid', 'pid'], ['kind', ENUMS.deployable]]],
  ['destroyed', [['kind', ENUMS.deployable], ['id', 'id'], ['x', 'pos'], ['y', 'pos']]],
  ['objhit', [['x', 'pos'], ['y', 'pos']]],
  ['wave', [['wave', 'u16'], ['boss', 'bool']]],
  ['bossspawn', [['id', 'id'], ['x', 'pos'], ['y', 'pos']]],
  ['waveclear', [['wave', 'u16'], ['bonus', 'u32']]],
  ['drop', [['x', 'pos'], ['y', 'pos']]],
  ['gameover', [['reason', ENUMS.gameover]]],
  ['victory', []],
  ['freeze', [['id', 'id'], ['x', 'pos'], ['y', 'pos']]],
  // Evac Run (SPEC §3.7): a zone was announced / locked / started to shrink; time in whole s
  ['zone', [['stage', ENUMS.zone], ['poi', 'u16'], ['x', 'pos'], ['y', 'pos'], ['r', 'rad'], ['time', 'u16']]],
  // Campaign (SPEC §3.8): a stage or floor change, the breakout, the zip line waking up, a ride, an escape
  ['campaign', [['what', ENUMS.campaign], ['stage', 'pid'], ['floor', 'pid'], ['pid', 'pid']]],
];

/** Event types with a compact binary encoding (anything else travels as JSON). */
export const EVENT_TYPES = EVENT_SCHEMAS.map((s) => s[0]);
const EVENT_INDEX = indexMap(EVENT_TYPES);
const EVENT_FIELDS = EVENT_SCHEMAS.map((s) => s[1]);
const ENUM_INDEX = new Map(Object.values(ENUMS).map((list) => [list, indexMap(list)]));

function isInt(v, max) {
  return Number.isInteger(v) && v >= 0 && v <= max;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPoint(p) {
  return p !== null && typeof p === 'object' && isNum(p.x) && isNum(p.y);
}

/** True when `v` survives `codec` without changing meaning. */
function fits(codec, v) {
  if (Array.isArray(codec)) return ENUM_INDEX.get(codec).has(v);
  switch (codec) {
    case 'pid': return isInt(v, 255);
    case 'id': case 'u16': return isInt(v, 65535);
    case 'u32': return isInt(v, 0xffffffff);
    case 'pos': case 'ang': return isNum(v);
    case 'amt': case 'rad': return isNum(v) && v >= 0 && v <= 6553.5;
    case 'dur': return isNum(v) && v >= 0 && v <= 65.535;
    case 'bool': return typeof v === 'boolean';
    case 'wpn': return v === null || WEAPON_INDEX.has(v);
    case 'ztype': return ZOMBIE_INDEX.has(v);
    case 'pkind': return PICKUP_INDEX.has(v);
    case 'str': return typeof v === 'string' && v.length <= 60;
    case 'rays':
      if (!Array.isArray(v) || v.length > 255) return false;
      for (const r of v) if (!isPoint(r) || !isInt(r.hit, 255)) return false;
      return true;
    case 'points':
      if (!Array.isArray(v) || v.length > 255) return false;
      for (const p of v) if (!isPoint(p)) return false;
      return true;
    default: return false;
  }
}

function writeField(w, codec, v) {
  if (Array.isArray(codec)) {
    w.u8(ENUM_INDEX.get(codec).get(v));
    return;
  }
  switch (codec) {
    case 'pid': w.u8(v); break;
    case 'id': case 'u16': w.u16(v); break;
    case 'u32': w.u32(v); break;
    case 'pos': w.i16(qEventPos(v)); break;
    case 'ang': w.u16(qAngle16(v)); break;
    case 'amt': case 'rad': w.u16(qFixed(v, 10, 65535)); break;
    case 'dur': w.u16(qFixed(v, 1000, 65535)); break;
    case 'bool': w.u8(v ? 1 : 0); break;
    case 'wpn': w.u8(qWeapon(v)); break;
    case 'ztype': w.u8(ZOMBIE_INDEX.get(v)); break;
    case 'pkind': w.u8(PICKUP_INDEX.get(v)); break;
    case 'str': {
      const b = TEXT_ENCODER.encode(v);
      w.u8(b.length);
      w.bytesOf(b);
      break;
    }
    case 'rays':
      w.u8(v.length);
      for (const r of v) {
        w.i16(qEventPos(r.x));
        w.i16(qEventPos(r.y));
        w.u8(r.hit);
      }
      break;
    case 'points':
      w.u8(v.length);
      for (const p of v) {
        w.i16(qEventPos(p.x));
        w.i16(qEventPos(p.y));
      }
      break;
  }
}

function readField(r, codec) {
  if (Array.isArray(codec)) return kindAt(codec, r.u8());
  switch (codec) {
    case 'pid': return r.u8();
    case 'id': case 'u16': return r.u16();
    case 'u32': return r.u32();
    case 'pos': return r.i16() / 2;
    case 'ang': return dqAngle16(r.u16());
    case 'amt': case 'rad': return r.u16() / 10;
    case 'dur': return r.u16() / 1000;
    case 'bool': return r.u8() !== 0;
    case 'wpn': return dqWeapon(r.u8());
    case 'ztype': return kindAt(ZOMBIE_IDS, r.u8());
    case 'pkind': return kindAt(PICKUP_KINDS, r.u8());
    case 'str': return TEXT_DECODER.decode(r.bytes(r.u8()));
    case 'rays': {
      const n = r.u8();
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = { x: r.i16() / 2, y: r.i16() / 2, hit: r.u8() };
      return out;
    }
    case 'points': {
      const n = r.u8();
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = { x: r.i16() / 2, y: r.i16() / 2 };
      return out;
    }
    default: return null;
  }
}

function roundJson(key, v) {
  return typeof v === 'number' ? Math.round(v * 100) / 100 : v;
}

/** Index of the binary schema that represents `ev` exactly, or -1 (→ JSON). */
function schemaFor(ev) {
  const idx = EVENT_INDEX.get(ev.type);
  if (idx === undefined) return -1;
  const fields = EVENT_FIELDS[idx];
  let keys = 0;
  for (const k in ev) keys++;
  if (keys !== fields.length + 1) return -1;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!fits(f[1], ev[f[0]])) return -1;
  }
  return idx;
}

function writeEvents(w, events) {
  const list = Array.isArray(events) ? events : [];
  const n = Math.min(list.length, 65535);
  w.u16(n);
  for (let i = 0; i < n; i++) {
    const ev = list[i];
    const idx = ev && typeof ev === 'object' ? schemaFor(ev) : -1;
    if (idx < 0) {
      let b = TEXT_ENCODER.encode(JSON.stringify(ev ?? null, roundJson));
      if (b.length > MAX_JSON_EVENT_BYTES) b = JSON_NULL;
      w.u8(JSON_EVENT);
      w.u32(b.length);
      w.bytesOf(b);
      continue;
    }
    w.u8(idx);
    const fields = EVENT_FIELDS[idx];
    for (let f = 0; f < fields.length; f++) writeField(w, fields[f][1], ev[fields[f][0]]);
  }
}

function readEvents(r) {
  const n = r.u16();
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = r.u8();
    if (idx === JSON_EVENT) {
      const ev = JSON.parse(TEXT_DECODER.decode(r.bytes(r.u32())));
      if (ev && typeof ev === 'object') out.push(ev);
      continue;
    }
    const fields = EVENT_FIELDS[idx];
    if (!fields) throw new RangeError(`Unknown event tag ${idx}`);
    const ev = { type: EVENT_TYPES[idx] };
    for (let f = 0; f < fields.length; f++) ev[fields[f][0]] = readField(r, fields[f][1]);
    out.push(ev);
  }
  return out;
}

// ---- snapshot

const P_SPRINTING = 1, P_FIRING = 2, P_SELF_REVIVE = 4, P_RESPAWN = 8, P_READY = 16, P_SPRINT_LOCK = 32, P_ESCAPED = 64;
const H_OBJECTIVE = 1, H_ECHO = 2, H_ZONE = 4, H_CAMPAIGN = 8;

const snapWriter = new Writer(32 * 1024);

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function header(w, tag) {
  w.u8(tag);
  w.u8(PROTOCOL_VERSION);
}

function checkHeader(r, tag) {
  const t = r.u8();
  if (t !== tag) throw new Error(`Expected message type ${tag}, got ${t}`);
  const v = r.u8();
  if (v !== PROTOCOL_VERSION) {
    throw new Error(`Protocol version mismatch (got ${v}, expected ${PROTOCOL_VERSION})`);
  }
}

function writePlayer(w, p) {
  w.u8(qInt(p.id, 255));
  w.f32(num(p.x));
  w.f32(num(p.y));
  w.u16(qAngle16(p.angle));
  w.u8(kindIndex(STATE_INDEX, p.state));
  w.u8((p.sprinting ? P_SPRINTING : 0) | (p.firing ? P_FIRING : 0) | (p.selfRevive ? P_SELF_REVIVE : 0)
    | (p.respawn ? P_RESPAWN : 0) | (p.ready ? P_READY : 0) | (p.sprintLock ? P_SPRINT_LOCK : 0) | (p.esc ? P_ESCAPED : 0));
  w.u16(qFixed(p.hp, 10, 65535));
  w.u16(qFixed(p.maxHp, 10, 65535));
  w.u16(qFixed(p.armor, 10, 65535));
  w.u16(qFixed(p.stamina, 100, 65535));
  w.u8(qInt(p.slot, 255));
  const slots = arr(p.slots);
  const ammo = arr(p.ammo);
  const ns = Math.min(slots.length, 8);
  w.u8(ns);
  for (let i = 0; i < ns; i++) {
    w.u8(qWeapon(slots[i]));
    const a = Array.isArray(ammo[i]) ? ammo[i] : [0, 0];
    w.u16(qInt(a[0], 65535));
    w.u16(num(a[1]) < 0 ? 0xffff : qInt(a[1], 65534));
  }
  w.u8(qUnitNz(p.reloading));
  w.u8(qUnit(p.spin));
  w.u8(qUnitNz(p.meleeing));
  w.u32(qInt(p.cash, 0xffffffff));
  w.u32(qInt(p.kills, 0xffffffff));
  w.u32(qInt(p.damage, 0xffffffff));
  w.u16(qInt(p.revives, 65535));
  w.u16(qInt(p.downs, 65535));
  w.u32(qInt(p.earned, 0xffffffff));
  w.u8(qInt(p.frags, 255));
  w.u8(qInt(p.molotovs, 255));
  w.u8(qInt(p.turrets, 255));
  w.u8(qInt(p.barricades, 255));
  w.u16(qFixed(p.bleedout, 100, 65535));
  w.u8(qUnit(p.revive));
  w.u8(qInt(p.reviver, 255));
  w.u32(qInt(p.lastSeq, 0xffffffff));
  // The free pistol's mag (SPEC §4): NONE when the sender does not publish it.
  w.u8(Number.isInteger(p.freeMag) && p.freeMag >= 0 && p.freeMag < NONE ? p.freeMag : NONE);
  // Vertical state (jump.js), exact: feet height, vertical speed, landing cooldown, climb.
  w.u16(qInt(p.zq, 65535));
  w.i8(qSmall(p.vzq, -128, 127));
  w.u8(qInt(p.jumpCd, 255));
  const climbT = qInt(p.climbT, 255);
  w.u8(climbT);
  if (climbT) w.u16(qInt(p.climbTo, 65535));
  // Campaign: zip-line ride progress (0 = not riding); `esc` travels in the flags byte.
  w.u8(qUnitNz(p.ride));
}

function readPlayer(r) {
  const id = r.u8();
  const x = r.f32();
  const y = r.f32();
  const angle = dqAngle16(r.u16());
  const state = kindAt(PLAYER_STATES, r.u8()) || 'alive';
  const flags = r.u8();
  const hp = r.u16() / 10;
  const maxHp = r.u16() / 10;
  const armor = r.u16() / 10;
  const stamina = r.u16() / 100;
  const slot = r.u8();
  const ns = r.u8();
  const slots = new Array(ns);
  const ammo = new Array(ns);
  for (let i = 0; i < ns; i++) {
    slots[i] = dqWeapon(r.u8());
    const mag = r.u16();
    const res = r.u16();
    ammo[i] = [mag, res === 0xffff ? -1 : res];
  }
  const rec = {
    id, x, y, angle, state,
    hp, maxHp, armor, stamina,
    sprinting: (flags & P_SPRINTING) !== 0,
    slot, slots, ammo,
    reloading: r.u8() / 255,
    spin: r.u8() / 255,
    firing: (flags & P_FIRING) !== 0,
    meleeing: r.u8() / 255,
    cash: r.u32(),
    kills: r.u32(),
    damage: r.u32(),
    revives: r.u16(),
    downs: r.u16(),
    earned: r.u32(),
    frags: r.u8(),
    molotovs: r.u8(),
    turrets: r.u8(),
    barricades: r.u8(),
    selfRevive: (flags & P_SELF_REVIVE) !== 0,
    bleedout: r.u16() / 100,
    revive: r.u8() / 255,
    reviver: r.u8(),
    respawn: (flags & P_RESPAWN) !== 0,
    ready: (flags & P_READY) !== 0,
    lastSeq: r.u32(),
    sprintLock: (flags & P_SPRINT_LOCK) !== 0,
  };
  const freeMag = r.u8();
  if (freeMag !== NONE) rec.freeMag = freeMag;
  rec.zq = r.u16();
  rec.vzq = r.i8();
  rec.jumpCd = r.u8();
  rec.climbT = r.u8();
  rec.climbTo = rec.climbT ? r.u16() : -1;
  rec.z = rec.zq * Z_UNIT;
  rec.ride = r.u8() / 255;
  rec.esc = (flags & P_ESCAPED) !== 0;
  return rec;
}

/**
 * Evac Run zone state (SPEC §4 `zone`, 25 bytes): stage, POI indices, the live circle and
 * the circle it heads for (0.25 px), the stage timer and its length (0.01 s) and the
 * supply drop.
 */
function writeZone(w, z) {
  w.u8(qInt(z.stage, 255));
  w.u8(qInt(z.poi, 255));
  w.u8(qInt(z.from, 255));
  w.u16(qPos(z.x));
  w.u16(qPos(z.y));
  w.u16(qFixed(z.r, 4, 65535));
  w.u16(qPos(z.nx));
  w.u16(qPos(z.ny));
  w.u16(qFixed(z.nr, 4, 65535));
  w.u16(qFixed(z.t, 100, 65535));
  w.u16(qFixed(z.total, 100, 65535));
  w.u16(qPos(z.sx));
  w.u16(qPos(z.sy));
}

function readZone(r) {
  return {
    stage: r.u8(), poi: r.u8(), from: r.u8(),
    x: dqPos(r.u16()), y: dqPos(r.u16()), r: r.u16() / 4,
    nx: dqPos(r.u16()), ny: dqPos(r.u16()), nr: r.u16() / 4,
    t: r.u16() / 100, total: r.u16() / 100,
    sx: dqPos(r.u16()), sy: dqPos(r.u16()),
  };
}

/**
 * Campaign state (SPEC §4 `campaign`, 26 bytes): stage, floor, sub-state, the objective circle
 * (0.25 px), the stage timer and its length (0.01 s), the horde front (f32 px along the route,
 * -1e9 when none), the roof kill count and quota, the zip flag and the current supply point.
 */
function writeCampaign(w, c) {
  w.u8(qInt(c.stage, 255));
  w.u8(qInt(c.floor, 255));
  w.u8(qInt(c.sub, 255));
  w.u16(qPos(c.x));
  w.u16(qPos(c.y));
  w.u16(qFixed(c.r, 4, 65535));
  w.u16(qFixed(c.t, 100, 65535));
  w.u16(qFixed(c.total, 100, 65535));
  w.f32(num(c.front) < -1e8 ? -1e9 : num(c.front));
  w.u16(qInt(c.kills, 65535));
  w.u16(qInt(c.quota, 65535));
  w.u8(c.zip ? 1 : 0);
  w.u16(qPos(c.sx));
  w.u16(qPos(c.sy));
}

function readCampaign(r) {
  return {
    stage: r.u8(), floor: r.u8(), sub: r.u8(),
    x: dqPos(r.u16()), y: dqPos(r.u16()), r: r.u16() / 4,
    t: r.u16() / 100, total: r.u16() / 100,
    front: r.f32(),
    kills: r.u16(), quota: r.u16(), zip: r.u8(),
    sx: dqPos(r.u16()), sy: dqPos(r.u16()),
  };
}

/**
 * Encode a Snapshot (SPEC §4) into a fresh ArrayBuffer.
 *
 * Besides the SPEC fields it carries two netcode extras: `match` (u8 game counter, so a
 * late snapshot of the previous game is never mistaken for the new one) and an optional
 * `echo: [{ tick, events }]` list repeating important events of earlier snapshots (the
 * state channel may drop messages). Unknown top-level fields are not transmitted.
 * @param {object} snap
 * @returns {ArrayBuffer}
 */
export function encodeSnapshot(snap) {
  const w = snapWriter;
  w.reset();
  header(w, MSG.SNAPSHOT);
  const echo = arr(snap.echo);
  const obj = snap.objective;
  const zone = snap.zone && typeof snap.zone === 'object' ? snap.zone : null;
  const campaign = snap.campaign && typeof snap.campaign === 'object' ? snap.campaign : null;
  w.u8((obj ? H_OBJECTIVE : 0) | (echo.length ? H_ECHO : 0) | (zone ? H_ZONE : 0) | (campaign ? H_CAMPAIGN : 0));
  w.u8(qInt(snap.match, 255));
  w.u32(qInt(snap.tick, 0xffffffff));
  w.u8(kindIndex(PHASE_INDEX, snap.phase));
  w.u16(qInt(snap.wave, 65535));
  w.u16(qInt(snap.totalWaves, 65535));
  w.u16(qFixed(snap.timer, 100, 65535));
  w.u32(qInt(snap.remaining, 0xffffffff));
  w.u16(num(snap.bossHp) < 0 ? 0xffff : qFixed(Math.min(1, num(snap.bossHp)), 65534, 65534));
  if (obj) {
    w.f32(num(obj.hp));
    w.f32(num(obj.maxHp));
  }
  w.u8(qInt(snap.readyCount, 255));
  if (zone) writeZone(w, zone);
  if (campaign) writeCampaign(w, campaign);

  const players = arr(snap.players);
  const np = Math.min(players.length, 255);
  w.u8(np);
  for (let i = 0; i < np; i++) writePlayer(w, players[i]);

  const zombies = arr(snap.zombies);
  const nz = Math.min(zombies.length, 65535);
  w.u16(nz);
  w.ensure(nz * 11);
  for (let i = 0; i < nz; i++) {
    const z = zombies[i];
    w.u16(qInt(z.id, 65535));
    w.u8(kindIndex(ZOMBIE_INDEX, z.type));
    w.u16(qPos(z.x));
    w.u16(qPos(z.y));
    w.u8(qAngle8(z.angle));
    w.u8(qUnit(z.hp));
    const h = qInt(z.z, 65535);
    w.u8((qInt(z.flags, 255) & ~ZF_HIGH) | (h > 0 ? ZF_HIGH : 0));
    if (h > 0) w.u16(h);
  }

  const projectiles = arr(snap.projectiles);
  const npr = Math.min(projectiles.length, 65535);
  w.u16(npr);
  for (let i = 0; i < npr; i++) {
    const pr = projectiles[i];
    w.u16(qInt(pr.id, 65535));
    w.u8(kindIndex(PROJECTILE_INDEX, pr.kind));
    w.u16(qPos(pr.x));
    w.u16(qPos(pr.y));
    w.u8(qAngle8(pr.angle));
  }

  const pickups = arr(snap.pickups);
  const npk = Math.min(pickups.length, 65535);
  w.u16(npk);
  for (let i = 0; i < npk; i++) {
    const k = pickups[i];
    w.u16(qInt(k.id, 65535));
    w.u8(kindIndex(PICKUP_INDEX, k.kind));
    w.u16(qPos(k.x));
    w.u16(qPos(k.y));
    w.u8(qWeapon(k.weapon));
  }

  const turrets = arr(snap.turrets);
  const nt = Math.min(turrets.length, 65535);
  w.u16(nt);
  for (let i = 0; i < nt; i++) {
    const t = turrets[i];
    w.u16(qInt(t.id, 65535));
    w.u8(qInt(t.owner, 255));
    w.u16(qPos(t.x));
    w.u16(qPos(t.y));
    w.u16(qAngle16(t.angle));
    w.u8(qUnit(t.hp));
    w.u8(qUnit(t.ammo));
    w.u8(t.firing ? 1 : 0);
  }

  const barricades = arr(snap.barricades);
  const nb = Math.min(barricades.length, 65535);
  w.u16(nb);
  for (let i = 0; i < nb; i++) {
    const b = barricades[i];
    w.u16(qInt(b.id, 65535));
    w.u8(qInt(b.owner, 255));
    w.f32(num(b.x));
    w.f32(num(b.y));
    w.u16(qAngle16(b.angle));
    w.u8(qUnit(b.hp));
  }

  const hazards = arr(snap.hazards);
  const nh = Math.min(hazards.length, 65535);
  w.u16(nh);
  for (let i = 0; i < nh; i++) {
    const h = hazards[i];
    w.u16(qInt(h.id, 65535));
    w.u8(kindIndex(HAZARD_INDEX, h.kind));
    w.u16(qPos(h.x));
    w.u16(qPos(h.y));
    w.u16(qFixed(h.r, 10, 65535));
    w.u8(qUnit(h.life));
  }

  writeEvents(w, snap.events);
  if (echo.length) {
    const ne = Math.min(echo.length, 255);
    w.u8(ne);
    for (let i = 0; i < ne; i++) {
      w.u32(qInt(echo[i].tick, 0xffffffff));
      writeEvents(w, echo[i].events);
    }
  }
  return w.finish();
}

/**
 * Decode a snapshot message. Throws on a wrong tag, a protocol version mismatch or a
 * truncated/corrupt buffer.
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @returns {object} Snapshot
 */
export function decodeSnapshot(buf) {
  const r = new Reader(buf);
  checkHeader(r, MSG.SNAPSHOT);
  const flags = r.u8();
  const match = r.u8();
  const snap = {
    match,
    tick: r.u32(),
    phase: kindAt(PHASES, r.u8()) || 'prep',
    wave: r.u16(),
    totalWaves: r.u16(),
    timer: r.u16() / 100,
    remaining: r.u32(),
    bossHp: 0,
    objective: null,
    readyCount: 0,
    zone: null,
    campaign: null,
    players: null,
    zombies: null,
    projectiles: null,
    pickups: null,
    turrets: null,
    barricades: null,
    hazards: null,
    events: null,
  };
  const boss = r.u16();
  snap.bossHp = boss === 0xffff ? -1 : boss / 65534;
  if (flags & H_OBJECTIVE) snap.objective = { hp: r.f32(), maxHp: r.f32() };
  snap.readyCount = r.u8();
  snap.zone = flags & H_ZONE ? readZone(r) : null;
  snap.campaign = flags & H_CAMPAIGN ? readCampaign(r) : null;

  const np = r.u8();
  const players = new Array(np);
  for (let i = 0; i < np; i++) players[i] = readPlayer(r);
  snap.players = players;

  const nz = r.u16();
  const zombies = new Array(nz);
  for (let i = 0; i < nz; i++) {
    const z = {
      id: r.u16(),
      type: kindAt(ZOMBIE_IDS, r.u8()),
      x: dqPos(r.u16()),
      y: dqPos(r.u16()),
      angle: dqAngle8(r.u8()),
      hp: r.u8() / 255,
      flags: r.u8(),
      z: 0,
    };
    if (z.flags & ZF_HIGH) {
      z.flags &= ~ZF_HIGH;
      z.z = r.u16();
    }
    zombies[i] = z;
  }
  snap.zombies = zombies;

  const npr = r.u16();
  const projectiles = new Array(npr);
  for (let i = 0; i < npr; i++) {
    projectiles[i] = {
      id: r.u16(),
      kind: kindAt(PROJECTILE_KINDS, r.u8()),
      x: dqPos(r.u16()),
      y: dqPos(r.u16()),
      angle: dqAngle8(r.u8()),
    };
  }
  snap.projectiles = projectiles;

  const npk = r.u16();
  const pickups = new Array(npk);
  for (let i = 0; i < npk; i++) {
    pickups[i] = {
      id: r.u16(),
      kind: kindAt(PICKUP_KINDS, r.u8()),
      x: dqPos(r.u16()),
      y: dqPos(r.u16()),
      weapon: dqWeapon(r.u8()),
    };
  }
  snap.pickups = pickups;

  const nt = r.u16();
  const turrets = new Array(nt);
  for (let i = 0; i < nt; i++) {
    turrets[i] = {
      id: r.u16(),
      owner: r.u8(),
      x: dqPos(r.u16()),
      y: dqPos(r.u16()),
      angle: dqAngle16(r.u16()),
      hp: r.u8() / 255,
      ammo: r.u8() / 255,
      firing: r.u8() !== 0,
    };
  }
  snap.turrets = turrets;

  const nb = r.u16();
  const barricades = new Array(nb);
  for (let i = 0; i < nb; i++) {
    barricades[i] = {
      id: r.u16(),
      owner: r.u8(),
      x: r.f32(),
      y: r.f32(),
      angle: dqAngle16(r.u16()),
      hp: r.u8() / 255,
    };
  }
  snap.barricades = barricades;

  const nh = r.u16();
  const hazards = new Array(nh);
  for (let i = 0; i < nh; i++) {
    hazards[i] = {
      id: r.u16(),
      kind: kindAt(HAZARD_KINDS, r.u8()),
      x: dqPos(r.u16()),
      y: dqPos(r.u16()),
      r: r.u16() / 10,
      life: r.u8() / 255,
    };
  }
  snap.hazards = hazards;

  snap.events = readEvents(r);
  if (flags & H_ECHO) {
    const ne = r.u8();
    const echo = new Array(ne);
    for (let i = 0; i < ne; i++) echo[i] = { tick: r.u32(), events: readEvents(r) };
    snap.echo = echo;
  }
  return snap;
}

// ---- inputs

const B_FIRE = 1, B_MELEE = 2, B_SPRINT = 4, B_INTERACT = 8, B_RELOAD = 16, B_FRAG = 32,
  B_MOLOTOV = 64, B_TURRET = 128, B_BARRICADE = 256, B_LAST_WEAPON = 512, B_JUMP = 1024;

const inputWriter = new Writer(256);

function qMove(v) {
  const q = Math.round(num(v) * 127);
  return q < -127 ? -127 : q > 127 ? 127 : q;
}

function qSmall(v, lo, hi) {
  v = Math.round(num(v));
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Encode the last ≤ MAX_INPUTS_PER_MESSAGE InputCmds (SPEC §3.3), oldest first. Sending
 * the previous few again with every message makes a lost packet harmless.
 * @param {object[]} cmds
 * @returns {ArrayBuffer}
 */
export function encodeInputs(cmds) {
  const list = arr(cmds);
  const start = Math.max(0, list.length - MAX_INPUTS_PER_MESSAGE);
  const w = inputWriter;
  w.reset();
  header(w, MSG.INPUTS);
  w.u8(list.length - start);
  for (let i = start; i < list.length; i++) {
    const c = list[i];
    w.u32(qInt(c.seq, 0xffffffff));
    w.i8(qMove(c.moveX));
    w.i8(qMove(c.moveY));
    w.u16(qAngle16(c.angle));
    w.u16((c.fire ? B_FIRE : 0) | (c.melee ? B_MELEE : 0) | (c.sprint ? B_SPRINT : 0)
      | (c.interact ? B_INTERACT : 0) | (c.reload ? B_RELOAD : 0) | (c.frag ? B_FRAG : 0)
      | (c.molotov ? B_MOLOTOV : 0) | (c.turret ? B_TURRET : 0) | (c.barricade ? B_BARRICADE : 0)
      | (c.lastWeapon ? B_LAST_WEAPON : 0) | (c.jump ? B_JUMP : 0));
    w.i8(qSmall(c.slot ?? -1, -1, 127));
    w.i8(qSmall(c.cycle, -1, 1));
  }
  return w.finish();
}

/**
 * Decode an inputs message into InputCmds, oldest first.
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @returns {object[]}
 */
export function decodeInputs(buf) {
  const r = new Reader(buf);
  checkHeader(r, MSG.INPUTS);
  const n = r.u8();
  // Honest clients never send more (encodeInputs caps it); anything bigger is a flood.
  if (n > MAX_INPUTS_PER_MESSAGE) throw new Error(`Too many inputs in one message: ${n}`);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const seq = r.u32();
    const moveX = r.i8() / 127;
    const moveY = r.i8() / 127;
    const angle = dqAngle16(r.u16());
    const b = r.u16();
    out[i] = {
      seq, moveX, moveY, angle,
      fire: (b & B_FIRE) !== 0,
      melee: (b & B_MELEE) !== 0,
      sprint: (b & B_SPRINT) !== 0,
      interact: (b & B_INTERACT) !== 0,
      reload: (b & B_RELOAD) !== 0,
      frag: (b & B_FRAG) !== 0,
      molotov: (b & B_MOLOTOV) !== 0,
      turret: (b & B_TURRET) !== 0,
      barricade: (b & B_BARRICADE) !== 0,
      lastWeapon: (b & B_LAST_WEAPON) !== 0,
      slot: r.i8(),
      cycle: r.i8(),
      jump: (b & B_JUMP) !== 0,
    };
  }
  return out;
}

/**
 * Round a cmd's analogue values exactly as the wire does, in place. The client predicts
 * with the quantised cmd so its replay matches what the host simulates bit for bit.
 * @param {object} cmd InputCmd
 * @returns {object} the same cmd
 */
export function quantizeInput(cmd) {
  cmd.moveX = qMove(cmd.moveX) / 127;
  cmd.moveY = qMove(cmd.moveY) / 127;
  cmd.angle = dqAngle16(qAngle16(cmd.angle));
  return cmd;
}

/**
 * Message type tag of a binary message (MSG.*), or -1 if it is empty / not binary.
 * @param {ArrayBuffer|ArrayBufferView} buf
 * @returns {number}
 */
export function messageType(buf) {
  if (buf instanceof ArrayBuffer) return buf.byteLength ? new Uint8Array(buf)[0] : -1;
  if (ArrayBuffer.isView(buf)) return buf.byteLength ? new Uint8Array(buf.buffer, buf.byteOffset, 1)[0] : -1;
  return -1;
}

