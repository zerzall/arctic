// Turns the per-frame InputState from ui/input.js (SPEC §7.2) into fixed-rate InputCmds
// (SPEC §3.3). Held buttons are sampled; edge-triggered presses are latched until the
// next produced cmd consumes them, so a press in a frame that happens to produce no
// tick is carried over — never lost, never sent twice. `jump` is both: set while the
// button is held (hold to keep hopping) and for one cmd after a tap shorter than a tick.

const EDGES = ['reload', 'frag', 'molotov', 'turret', 'barricade', 'lastWeapon'];
const MAX_PENDING_CYCLE = 3;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export class CmdBuilder {
  constructor() {
    this.seq = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.angle = 0;
    this.fire = false;
    this.melee = false;
    this.sprint = false;
    this.interact = false;
    this.jump = false;
    this.jumpTap = false;
    this.edges = {};
    for (const e of EDGES) this.edges[e] = false;
    this.slot = -1;
    this.cycle = 0;
  }

  /**
   * Record one frame of input.
   * @param {object|null} input InputState, or null for "no input" (menus, chat)
   * @param {number} [aimAngle] radians; keeps the previous aim when not finite
   */
  feed(input, aimAngle) {
    if (Number.isFinite(aimAngle)) this.angle = aimAngle;
    if (!input) {
      this.moveX = this.moveY = 0;
      this.fire = this.melee = this.sprint = this.interact = this.jump = false;
      return;
    }
    let mx = num(input.moveX), my = num(input.moveY);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;
    this.fire = !!input.fire;
    this.melee = !!input.melee;
    this.sprint = !!input.sprint;
    this.interact = !!input.interact;
    this.jump = !!input.jump;
    if (input.jump) this.jumpTap = true;
    for (const e of EDGES) if (input[e]) this.edges[e] = true;
    if (Number.isInteger(input.slot) && input.slot >= 0) this.slot = input.slot;
    const c = num(input.cycle);
    if (c !== 0) this.cycle = Math.max(-MAX_PENDING_CYCLE, Math.min(MAX_PENDING_CYCLE, this.cycle + Math.sign(c)));
  }

  /** The next InputCmd; consumes latched edges (one wheel notch per cmd). */
  next() {
    const cmd = {
      seq: this.nextSeq(),
      moveX: this.moveX,
      moveY: this.moveY,
      angle: this.angle,
      fire: this.fire,
      melee: this.melee,
      sprint: this.sprint,
      interact: this.interact,
      reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
      slot: this.slot,
      cycle: Math.sign(this.cycle),
      jump: this.jump || this.jumpTap,
    };
    this.jumpTap = false;
    for (const e of EDGES) {
      cmd[e] = this.edges[e];
      this.edges[e] = false;
    }
    this.slot = -1;
    this.cycle -= cmd.cycle;
    return cmd;
  }

  /**
   * A cmd holding nothing and not moving (input went stale, e.g. hidden tab). Latched
   * presses are discarded: acting on them minutes later would surprise the player.
   */
  idle() {
    for (const e of EDGES) this.edges[e] = false;
    this.slot = -1;
    this.cycle = 0;
    this.jumpTap = false;
    return {
      seq: this.nextSeq(),
      moveX: 0, moveY: 0, angle: this.angle,
      fire: false, melee: false, sprint: false, interact: false,
      reload: false, frag: false, molotov: false, turret: false, barricade: false, lastWeapon: false,
      slot: -1, cycle: 0, jump: false,
    };
  }

  /** Forget held buttons and latched presses (new game); seq and aim carry on. */
  reset() {
    this.moveX = this.moveY = 0;
    this.fire = this.melee = this.sprint = this.interact = this.jump = this.jumpTap = false;
    for (const e of EDGES) this.edges[e] = false;
    this.slot = -1;
    this.cycle = 0;
  }

  nextSeq() {
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }
}
