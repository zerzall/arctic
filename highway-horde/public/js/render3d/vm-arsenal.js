// First-person animation of the arsenal's own moving parts (viewmodel.js hands over its
// state): the machine guns' belt change (feed cover up, the old box and belt out, a fresh
// box in, the belt laid in the tray, cover down, charging handle), the top-magazine PDW (the
// magazine tips up about its front catch and lifts out), the chainsaw's starter pull and the
// links turning round its nose, the saw-blade launcher's blade (it idles round, leaves on a
// shot and the next one rides up from the cassette), the Hollow Star's coil cage and captive
// core (they spin up and swell as it charges; the core is spent on a shot and grows back),
// the screw-on silencer (fitted while the slot's mode bit says so — `modes` in the local
// record, shared/handling.js MODE_SIL — and screwed on or off by the support hand), and the
// point the support hand racks each gun's charging handle, bolt or slide at after a
// magazine change.

/** Support-hand rack points (gun space) after a magazine change, per model style. */
export const RACK = {
  pistol: [-1, 1.4, -1.2], dual: [-1, 1.4, -1.2], compact: [-1, 1.4, -1.2], tac45: [-1, 1.4, -1.2], handcannon: [-1.1, 1.5, -1.25], mpistol: [-1, 1.4, -1.2],
  smg: [2.1, 3.0, -0.7], csmg: [7.3, 2.9, -0.3], pdw: [2.0, 1.8, -1.6], smg45: [5.0, 2.1, -1.6],
  sniper: [-1.6, 1.8, 1.8], scout: [-1.2, 1.5, 1.6], magsniper: [-1.8, 1.9, 1.9],
  ak: [4.5, 1.7, 1.9], bullpup: [1.7, 1.8, -1.7], boxsg: [4.4, 1.7, 1.9],
  tommy: [6.0, 3.4, -0.7], burst: [1.9, 3.1, -0.7], amr: [9.0, 2.4, 2.4], cryo: [3.4, 4.2, -0.8],
  minigun: [-3.0, 3.7, -1.9], sawblade: [9.0, 3.6, -1.0], hollowstar: [0.5, 3.4, -1.3],
};
/** The AR family's charging handle (and anything not listed). */
export const RACK_DEFAULT = [-2.6, 2.4, -1.4];

/** Mode bit of a fitted silencer in the snapshot's per-slot `modes` (shared/handling.js MODE_SIL). */
const MODE_SIL = 2;
/** Seconds the support hand takes to screw a silencer on or off (the sim's default time). */
const SIL_TIME = 1.4;

function ease(t) {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
function smoothPulse(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x < b) return ease((x - a) / (b - a));
  if (x > c) return ease((d - x) / (d - c));
  return 1;
}
/** out = a + (b - a) * t (a, b: arrays), returns out. */
function mix(out, a, b, t) {
  return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
const add = (a, dx, dy, dz) => [a[0] + dx, a[1] + dy, a[2] + dz];

/** A per-instance view of a shared gun model: the viewmodel may swap its muzzle (silencer off). */
export function vmModel(m) {
  return Object.create(m);
}

/**
 * Where the support hand is during a reload of one of the arsenal's own kinds (gun space),
 * or null for the viewmodel's own reloads.
 * @param {object} m gun model
 * @param {number} rl reload progress 0..1
 * @param {THREE.Vector3} rest the hand's rest point
 * @param {THREE.Vector3} out
 */
export function arsenalSupport(m, rl, rest, out) {
  const R = rest.toArray();
  if (m.reload === 'belt') {
    const latch = m.latch, up = add(m.latch, 0.6, 2.2, 0);
    const box = m.beltPack ? add(m.feed, -0.6, -2.4, -0.9) : add(m.magwell, 0, -0.5, -0.6);
    const pouch = m.beltPack ? box : add(m.magwell, -4, -14, -6);
    const feed = add(m.feed, 0, 0.3, -0.4);
    const top = add(m.latch, 1.5, 1.5, 0.8), down = add(m.latch, 1.5, 0.75, 0.8);
    const handle = m.handle, back = add(m.handle, -2, 0, 0);
    if (rl < 0.1) return mix(out, R, latch, ease(rl / 0.1));
    if (rl < 0.2) return mix(out, latch, up, ease((rl - 0.1) / 0.1));
    if (rl < 0.3) return mix(out, up, box, ease((rl - 0.2) / 0.1));
    if (rl < 0.46) return mix(out, box, pouch, ease((rl - 0.3) / 0.16));
    if (rl < 0.62) return mix(out, pouch, box, ease((rl - 0.46) / 0.16));
    if (rl < 0.7) return mix(out, box, feed, ease((rl - 0.62) / 0.08));
    if (rl < 0.74) return mix(out, feed, top, ease((rl - 0.7) / 0.04));
    if (rl < 0.8) return mix(out, top, down, ease((rl - 0.74) / 0.06));
    if (rl < 0.85) return mix(out, down, handle, ease((rl - 0.8) / 0.05));
    if (rl < 0.92) return mix(out, handle, back, Math.sin(((rl - 0.85) / 0.07) * Math.PI));
    return mix(out, handle, R, ease((rl - 0.92) / 0.08));
  }
  if (m.reload === 'topmag') {
    const rear = add(m.magwell, -3.7, 0.9, -0.7), lifted = add(rear, -1.2, 4.6, -1.6);
    const pouch = add(m.magwell, -4, -14, -6), rack = RACK[m.style] || RACK_DEFAULT, pulled = add(rack, -1.8, 0, 0);
    if (rl < 0.1) return mix(out, R, rear, ease(rl / 0.1));
    if (rl < 0.24) return mix(out, rear, lifted, ease((rl - 0.1) / 0.14));
    if (rl < 0.36) return mix(out, lifted, pouch, ease((rl - 0.24) / 0.12));
    if (rl < 0.56) return mix(out, pouch, lifted, ease((rl - 0.36) / 0.2));
    if (rl < 0.68) return mix(out, lifted, rear, ease((rl - 0.56) / 0.12));
    if (rl < 0.76) return mix(out, rear, rack, ease((rl - 0.68) / 0.08));
    if (rl < 0.88) return mix(out, rack, pulled, Math.sin(((rl - 0.76) / 0.12) * Math.PI));
    return mix(out, rack, R, ease((rl - 0.88) / 0.12));
  }
  if (m.reload === 'pull' && m.chain && m.chain.nose) {
    // chainsaw: a hand to the starter handle on the left, a hard yank on the cord, twice
    const cord = add(m.magwell, 0, 0.2, -0.5), yank = add(cord, -4, 2.8, -9);
    if (rl < 0.18) return mix(out, R, cord, ease(rl / 0.18));
    if (rl < 0.88) {
      const k = ((rl - 0.18) / 0.7) * 2;
      const f = k - Math.floor(k);
      return mix(out, cord, yank, f < 0.4 ? ease(f / 0.4) : 1 - ease((f - 0.4) / 0.6));
    }
    return mix(out, cord, R, ease((rl - 0.88) / 0.12));
  }
  return null;
}

/** Whether the local player's silencer is fitted (no mode data: as modelled, fitted). */
function silencerOn(local) {
  const md = local && local.modes;
  if (!Array.isArray(md)) return true;
  return ((md[local.slot] | 0) & MODE_SIL) !== 0;
}

/**
 * Animate the arsenal's own parts. Called by the viewmodel after its own part animation.
 * @param {object} gun the gunObject group
 * @param {object} m its (per-instance) model
 * @param {object} st viewmodel animation state (chainPh, spin, lastShot, alt, altT, bladeA)
 * @param {{ dt: number, now: number, rl: number, local: object, mag: number, hand: THREE.Vector3 }} o
 */
export function animateArsenal(gun, m, st, o) {
  const parts = gun.userData.parts;
  const { dt, now, rl } = o;
  const base = Object.getPrototypeOf(m);
  // the chainsaw's links round the nose turn a link's angle while the runs slide a pitch
  if (parts.nose && m.chain) parts.nose.rotation.z = -(st.chainPh / m.chain.pitch) * m.chain.step;
  // ---- the belt change ----
  if (m.reload === 'belt') {
    const open = rl > 0 ? smoothPulse(rl, 0.1, 0.2, 0.72, 0.8) : 0;
    if (parts.cover) parts.cover.rotation.z = -open * 1.15;
    if (parts.bolt) parts.bolt.position.x = rl > 0.85 && rl < 0.92 ? -Math.sin(((rl - 0.85) / 0.07) * Math.PI) * 1.6 : 0;
    const mp = parts.mag;
    if (mp && !m.beltPack) {
      mp.rotation.set(0, 0, 0);
      mp.visible = true;
      if (rl <= 0.22 || rl >= 0.66) mp.position.set(0, 0, 0);
      else if (rl < 0.34) {
        const k = (rl - 0.22) / 0.12;
        mp.position.set(-k * 0.5, -k * k * 16 - k * 1.5, -k * 1.5);
        mp.rotation.set(-k * 0.6, 0, -k * 0.4);
        mp.visible = k < 0.95;
      } else if (rl < 0.46) mp.visible = false;
      else if (rl < 0.62) {
        const h = o.hand;
        mp.position.set(h.x - m.magwell[0], h.y - m.magwell[1] - 1.2, h.z - m.magwell[2]);
      } else {
        const k = ease((rl - 0.62) / 0.04);
        const h = o.hand;
        mp.position.set((h.x - m.magwell[0]) * (1 - k), (h.y - m.magwell[1] - 1.2) * (1 - k), (h.z - m.magwell[2]) * (1 - k));
      }
    }
  }
  // ---- the top magazine: tips up about its front catch, lifts out, a fresh one goes in ----
  if (m.reload === 'topmag' && parts.mag) {
    const mp = parts.mag, pv = m.pivots.mag || [0, 0, 0];
    const rear = [m.magwell[0] - 3.7, m.magwell[1] + 0.9, m.magwell[2] - 0.7];
    const h = o.hand;
    mp.visible = true;
    mp.position.set(pv[0], pv[1], pv[2]);
    mp.rotation.set(0, 0, 0);
    if (rl > 0.1 && rl < 0.2) mp.rotation.z = -0.42 * ease((rl - 0.1) / 0.1);
    else if (rl >= 0.2 && rl < 0.68) {
      // in the hand (held by its back end): out, away, a fresh one back
      if (rl >= 0.3 && rl < 0.4) mp.visible = false;
      mp.rotation.z = -0.42;
      const k = rl < 0.56 ? 1 : 1 - ease((rl - 0.56) / 0.12);
      mp.position.set(pv[0] + (h.x - rear[0]) * k, pv[1] + (h.y - rear[1]) * k, pv[2] + (h.z - rear[2]) * k);
      mp.rotation.z = -0.42 * (rl < 0.56 ? 1 : 1 - ease((rl - 0.56) / 0.12));
    }
    if (parts.bolt) parts.bolt.position.x = rl > 0.76 && rl < 0.88 ? -Math.sin(((rl - 0.76) / 0.12) * Math.PI) * 1.0 : 0;
  }
  // ---- the saw-blade launcher: the loaded blade idles round; a shot sends it, the next rides up ----
  if (parts.blade) {
    st.bladeA = ((st.bladeA || 0) + dt * (o.local && o.local.firing ? 34 : 11)) % (Math.PI * 2);
    const bp = parts.blade, pv = m.pivots.blade;
    bp.rotation.z = -st.bladeA;
    const since = now - st.lastShot;
    let up = 1;
    if (since >= 0 && since < 0.55) up = since < 0.1 ? 0 : ease((since - 0.1) / 0.45);
    if (rl > 0) up = rl < 0.1 ? 1 - ease(rl / 0.1) : rl > 0.78 ? ease((rl - 0.78) / 0.14) : 0;
    if (o.mag <= 0 && rl <= 0) up = 0;
    bp.visible = up > 0.02;
    bp.position.set(pv[0], pv[1] - (1 - up) * 3.2, pv[2]);
  }
  // ---- the Hollow Star: the coil cage spins up with the charge; the core swells, is spent, grows back ----
  if (parts.rings) {
    st.ringA = ((st.ringA || 0) + dt * (1.2 + st.spin * 16)) % (Math.PI * 2);
    parts.rings.rotation.x = st.ringA;
  }
  if (parts.orb) {
    const since = now - st.lastShot;
    const grow = since >= 0 && since < 0.9 ? ease((since - 0.12) / 0.78) : 1;
    const s = Math.max(0.001, grow * (1 + st.spin * 0.35 + Math.sin(now * 23) * 0.04 * st.spin));
    parts.orb.scale.setScalar(s);
    parts.orb.rotation.y += dt * (1.6 + st.spin * 7);
    parts.orb.rotation.x = Math.sin(now * 1.3) * 0.3;
  }
  // ---- the screw-on silencer ----
  if (parts.silencer || base.muzzleBare) {
    const on = silencerOn(o.local);
    st.altT = (st.altT ?? 9) + dt;
    let shown = on ? 1 : 0;
    if ((st.alt === 'silencer_on' || st.alt === 'silencer_off') && st.altT < SIL_TIME) {
      // threaded on (or off) over the second half of the change, spinning
      const k = ease((st.altT / SIL_TIME - 0.3) / 0.55);
      shown = st.alt === 'silencer_on' ? k : 1 - k;
    }
    if (parts.silencer) {
      parts.silencer.visible = shown > 0.02;
      parts.silencer.position.set((1 - shown) * 7, -(1 - shown) * 1.2, -(1 - shown) * 1.5);
      parts.silencer.rotation.x = (1 - shown) * 14;
    }
    if (base.muzzleBare) m.muzzle = shown > 0.5 ? base.muzzle : base.muzzleBare;
  }
}

/**
 * The support hand off the gun for something that is not a reload (the silencer being
 * screwed on or off): positions the pivot and returns true, or returns false.
 */
export function arsenalHand(m, st, pivot, rest) {
  if (!(st.alt === 'silencer_on' || st.alt === 'silencer_off') || !(st.altT < SIL_TIME)) return false;
  const base = Object.getPrototypeOf(m);
  if (!base.muzzleBare) return false;
  const k = st.altT / SIL_TIME;
  const at = base.muzzleBare;
  const grip = [at[0] + 2.2, at[1] - 0.9, at[2] - 1.0];
  const away = [at[0] + 6, at[1] - 3, at[2] - 4];
  const R = rest.toArray();
  const toward = st.alt === 'silencer_on' ? away : grip;
  if (k < 0.2) mix(pivot.position, R, toward, ease(k / 0.2));
  else if (k < 0.32) mix(pivot.position, toward, grip, ease((k - 0.2) / 0.12));
  else if (k < 0.85) mix(pivot.position, grip, grip, 0);
  else mix(pivot.position, grip, R, ease((k - 0.85) / 0.15));
  // the wrist turns while it threads the can
  const twist = k > 0.32 && k < 0.85 ? Math.sin((k - 0.32) * 30) * 0.35 : 0;
  pivot.rotation.set(twist, 0, 0.3 * smoothPulse(k, 0.1, 0.3, 0.8, 0.95));
  return true;
}
