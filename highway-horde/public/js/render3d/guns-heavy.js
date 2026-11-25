// Heavy weapons for actor-guns.js, assembled from guns-parts.js: the machine-gun family (the
// light MG, the M60 and the Barrage MG with their belts and boxes, the belt-fed heavy MG and
// the minigun), the chainsaw (engine, bar, a chain that runs right round the nose), the
// saw-blade launcher and the Hollow Star. Moving parts: 'cover' (an MG's feed cover, hinged at
// its front: it opens on a belt change), 'mag' (box + belt), 'bolt' (the charging handle),
// 'spin' (the minigun's barrels), 'chainA' / 'chainB' / 'nose' (the chainsaw's chain: the top
// and bottom runs slide, the links round the nose turn), 'blade' (the loaded saw blade),
// 'orb' and 'rings' (the Hollow Star's captive singularity and its coil cage).

import { gunParts } from './guns-parts.js';

/**
 * Register the builders.
 * @param {object} B the BUILDERS table of actor-guns.js (style → builder)
 * @param {object} K the kit (actor-guns.js)
 */
export function installHeavyArms(B, K) {
  const P = gunParts(K);
  const { THREE, GM, ext, rbox, cylX, latheX, sphere, torusX, tubePath, rail, shadeHex, mixHex } = K;
  const { BLUED, RUBBER, STEEL } = K.C;
  const HALF_PI = Math.PI / 2, TAU = Math.PI * 2;

  /** A circle as a shape outline for ext (four bezier quarters). */
  function circle(cx, cy, r) {
    const k = 0.5523 * r;
    return [[cx + r, cy], [cx + r, cy + k, cx + k, cy + r, cx, cy + r], [cx - k, cy + r, cx - r, cy + k, cx - r, cy],
      [cx - r, cy - k, cx - k, cy - r, cx, cy - r], [cx + k, cy - r, cx + r, cy - k, cx + r, cy]];
  }

  /** A dark round hole on a tube along X (radius R about (y, 0)) at angle a. */
  function tubeHole(gb, x, y, R, a, r, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, 0.06, 10);
    gb.add(g, { at: [x, y + Math.sin(a) * R, Math.cos(a) * R], rot: [a - HALF_PI, 0, 0], color: '#040405', mat: GM.STEEL, part: o.part });
  }

  function mgOut(out, o) {
    out.length = o.muzzle[0];
    out.muzzle = o.muzzle;
    out.front = o.front;
    out.eject = o.eject;
    out.magwell = o.magwell;
    out.heavy = true;
    out.travel.bolt = 0;
    out.casing = 'rifle';
    out.reload = o.reload || 'belt';
    if (o.rc) {
      out.pivots.cover = o.rc.cover;
      out.feed = o.rc.feed;
      out.latch = o.rc.latch;
      out.handle = o.rc.handle;
    }
    if (o.pack) out.beltPack = true;
    if (o.glow) out.glowColor = o.glow;
  }

  /**
   * A belt-fed receiver with its feed cover (part 'cover', hinged at the front edge so it
   * swings up on a belt change) carrying the top rail, the feed tray opening on the left, the
   * ejection port underneath and the charging handle on the right. Returns the cover's pivot
   * and the feed opening (where a belt goes in).
   */
  function mgReceiver(gb, x0, x1, y0, y1, hz, o = {}) {
    const col = o.color || '#202224';
    P.extX(gb, P.rrect(hz, y0, y1, 0.18), x0, x1, { color: col, mat: GM.STEEL, bevel: 0.12 });
    const C = { part: 'cover' };
    const cx1 = o.coverEnd ?? x1 - 1.2;
    ext(gb, [[x0 + 0.5, y1 - 0.05], [cx1, y1 - 0.05], [cx1, y1 + 0.35], [cx1 - 0.6, y1 + 0.55], [x0 + 1.0, y1 + 0.6], [x0 + 0.5, y1 + 0.35]], -hz + 0.05, hz - 0.05,
      { ...C, color: shadeHex(col, 0.06), mat: GM.STEEL, bevel: 0.1 });
    rail(gb, x0 + 1.2, cx1 - 0.7, y1 + 0.58, 0, 0.86, { ...C, color: '#141516' });
    rbox(gb, x0 + 0.55, x0 + 1.1, y1 + 0.15, y1 + 0.55, -hz - 0.04, -hz + 0.15, 0.06, { ...C, color: '#1a1b1c' });        // cover latch
    if (!K.lite()) for (let k = 0; k < 3; k++) rbox(gb, x0 + 1.8 + k * 1.2, x0 + 2.5 + k * 1.2, y1 + 0.05, y1 + 0.32, -hz - 0.0, -hz + 0.1, 0.04, { ...C, color: '#0d0e0f', seg: 1 });
    // the feed tray opening on the left, the ejection port underneath, the charging handle on the right
    const fx0 = x0 + 2.3, fx1 = x0 + 5.1;
    rbox(gb, fx0, fx1, y1 - 0.8, y1 - 0.12, -hz - 0.1, -hz + 0.06, 0.08, { color: '#060607' });
    rbox(gb, fx0 - 0.1, fx1 + 0.1, y1 - 0.9, y1 - 0.78, -hz - 0.16, -hz + 0.04, 0.03, { color: '#2a2c2e', mat: GM.STEEL, seg: 1 });          // the tray lip
    rbox(gb, x0 + 2.0, x0 + 4.2, y0 - 0.05, y0 + 0.2, -0.45, 0.45, 0.06, { color: '#060607' });
    rbox(gb, x1 - 2.2, x1 - 1.4, y0 + 0.6, y0 + 1.1, hz, hz + 0.75, 0.12, { part: 'bolt', color: '#2c2e30', mat: GM.STEEL });
    if (!K.lite()) for (const x of [x0 + 0.4, x1 - 0.5]) P.pin(gb, x, y0 + 0.5, hz + 0.08, 0.12);
    // (the reload's hand points: the cover latch, the feed tray, the charging handle)
    return { cover: [cx1, y1 + 0.2, 0], feed: [(fx0 + fx1) / 2, y1 - 0.45, -hz - 0.1], latch: [x0 + 0.85, y1 + 0.45, -hz - 0.3], handle: [x1 - 1.8, y0 + 0.85, hz + 0.9] };
  }

  // ---- light machine gun (remake): a soft 100-round pouch, carry handle, folded bipod --------
  B.lmg = (gb, L, sp, out) => {
    const col = '#222426', od = sp.accent;
    const rc = mgReceiver(gb, -1.6, 7.2, -0.2, 2.35, 0.95, { color: col });
    P.rearSight(gb, 0.4, 3.2, { part: 'cover' });
    // the handguard under the barrel with its vents, the barrel, gas tube and block, the carry handle
    P.extX(gb, P.rrect(0.82, -0.35, 1.25, 0.35), 7.2, 12.4, { color: '#1b1c1d', mat: GM.POLY, bevel: 0.12 });
    if (!K.lite()) P.slots(gb, 7.8, 12.0, 0.15, 0.8, 0.9, 4, { fill: 0.5 });
    cylX(gb, 7.2, 19.4, 1.5, 0, 0.46, 0.42, { color: BLUED, mat: GM.STEEL, seg: 16 });
    cylX(gb, 12.4, 15.6, 0.45, 0, 0.28, 0.28, { color: '#1c1d1e', seg: 12 });
    rbox(gb, 15.4, 16.2, 0.2, 1.95, -0.48, 0.48, 0.15, { color: '#18191a' });
    tubePath(gb, [[8.6, 1.95, 0], [9.0, 3.6, 0], [11.6, 3.7, 0], [12.0, 1.95, 0]], 0.28, { color: '#1a1b1c', mat: GM.RUBBER, seg: 16 });
    P.muzzle(gb, 'a2', 19.4, 1.5, 0.48, 1.9);
    P.frontSightA(gb, 18.0, 1.92, { dot: false });
    P.bipod(gb, 15.8, 0.2, { len: 3.2 });
    P.grip(gb, -0.25, -0.15, { color: '#1c1d1f', h: 3.8, rake: 1.0 });
    P.trigger(gb, -0.05, -0.25, { color: col, len: 2.8, mat: GM.STEEL });
    // skeleton stock with a rubber pad
    ext(gb, [[-1.6, 2.1], [-10.6, 1.8], [-11.0, 1.4], [-11.0, -2.1], [-10.2, -2.2], [-9.4, -0.6], [-4.8, 0.0], [-1.6, -0.1]], -0.7, 0.7,
      { color: '#1e1f21', mat: GM.POLY, bevel: 0.24, bevelSeg: 3, holes: [[[-2.8, 1.35], [-9.2, 1.2], [-9.3, -0.3], [-4.9, 0.45]]] });
    rbox(gb, -11.7, -10.9, -2.25, 1.95, -0.78, 0.78, 0.28, { color: RUBBER, mat: GM.RUBBER });
    // the soft pouch on the left under the receiver, the belt up into the feed tray
    P.ammoBox(gb, 1.2, 6.2, -4.4, -0.4, -2.6, -0.6, { color: od, soft: true });
    P.belt(gb, [[2.7, -0.5, -1.75], [2.4, 0.6, -1.6], [2.1, 1.7, -1.2]], 5, { r: 0.18, half: 0.8, along: 'x' });
    mgOut(out, { muzzle: [21.3, 1.5, 0], front: [9.8, -0.3, 0], eject: [3.0, -0.2, 0.6], magwell: [3.7, -2.4, -1.6], rc });
  };

  // ---- M60: a long slim GPMG, the carry handle on the barrel, a steel ammo can with its belt ----
  B.m60 = (gb, L, sp, out) => {
    const col = sp.color, od = sp.accent;
    const rc = mgReceiver(gb, -1.4, 7.8, -0.1, 2.2, 0.9, { color: col, coverEnd: 6.6 });
    P.rearSight(gb, 0.6, 3.05, { part: 'cover' });
    // the ribbed forend round the gas cylinder
    P.extX(gb, P.rrect(0.9, -0.55, 1.35, 0.45), 7.8, 12.4, { color: '#1d1e1f', mat: GM.POLY, bevel: 0.16 });
    if (!K.lite()) for (let k = 0; k < 6; k++) rbox(gb, 8.3 + k * 0.7, 8.6 + k * 0.7, -0.78, -0.6, -0.62, 0.62, 0.04, { color: '#0e0e0f', mat: GM.POLY, seg: 1 });
    cylX(gb, 7.8, 23.2, 1.4, 0, 0.44, 0.38, { color: BLUED, mat: GM.STEEL, seg: 16 });
    cylX(gb, 12.4, 16.2, 0.35, 0, 0.36, 0.36, { color: '#1a1b1c', seg: 14 });
    // the carry handle clamped on the barrel, the front sight, a long flared flash hider
    for (const x of [11.0, 14.0]) rbox(gb, x - 0.4, x + 0.4, 1.0, 2.0, -0.52, 0.52, 0.14, { color: '#1c1d1e' });
    tubePath(gb, [[14.0, 1.9, 0], [13.8, 3.5, 0], [11.4, 3.6, 0], [11.0, 1.9, 0]], 0.24, { color: '#1b1c1d', mat: GM.STEEL, seg: 14 });
    P.frontSightA(gb, 22.4, 1.8, { dot: false });
    latheX(gb, [[23.2, 0], [23.2, 0.42], [24.6, 0.5], [25.0, 0.55], [25.0, 0]], 1.4, 0, { color: '#141516', seg: 16 });
    if (!K.lite()) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      rbox(gb, 23.8, 24.9, -0.05, 0.05, -0.06, 0.06, 0.02, { color: '#030303', at: [0, 1.4 + Math.sin(a) * 0.5, Math.cos(a) * 0.5], rot: [a - HALF_PI, 0, 0], seg: 1 });
    }
    cylX(gb, 24.98, 25.02, 1.4, 0, 0.25, 0.25, { color: '#020202', seg: 10 });
    // the bipod folded under the gas cylinder, its clamp
    rbox(gb, 15.9, 16.7, -0.45, 0.75, -0.55, 0.55, 0.14, { color: '#18191a', mat: GM.STEEL });
    for (const s of [-1, 1]) {
      cylX(gb, 12.6, 16.2, -0.25, s * 0.4, 0.16, 0.18, { color: '#18191a', mat: GM.STEEL, seg: 8 });
      rbox(gb, 12.2, 12.8, -0.45, -0.05, s * 0.4 - 0.22, s * 0.4 + 0.22, 0.1, { color: RUBBER, mat: GM.RUBBER });
    }
    P.grip(gb, -0.25, -0.1, { color: '#1c1d1f', h: 3.8, rake: 1.1 });
    P.trigger(gb, -0.05, -0.15, { color: col, len: 2.8, mat: GM.STEEL });
    // the fixed stock, sloping to the butt, a shoulder rest
    ext(gb, [[-1.4, 1.9], [-9.8, 2.0], [-10.0, 1.6], [-10.0, -2.5], [-9.4, -2.6], [-4.8, -0.9], [-1.4, -0.7]], -0.75, 0.75, { color: '#1e1f20', mat: GM.POLY, bevel: 0.4, bevelSeg: 4 });
    rbox(gb, -10.8, -9.9, -2.6, 2.05, -0.82, 0.82, 0.3, { color: RUBBER, mat: GM.RUBBER });
    rbox(gb, -10.9, -10.3, 1.6, 3.0, -0.25, 0.25, 0.1, { color: '#1a1b1c', mat: GM.STEEL });
    // a 100-round steel can hung on the left, its belt up into the tray
    P.ammoBox(gb, 0.8, 5.6, -5.2, -1.2, -3.0, -0.9, { color: od });
    P.belt(gb, [[3.0, -1.2, -1.95], [2.7, 0.2, -1.75], [2.4, 1.5, -1.15]], 6, { r: 0.2, half: 0.85, along: 'x' });
    mgOut(out, { muzzle: [25.0, 1.4, 0], front: [10.2, -0.55, 0], eject: [3.2, -0.1, 0.6], magwell: [3.2, -3.0, -1.9], rc });
  };

  // ---- Barrage MG: a compact 150-round MG, a perforated heat shield, a red dot, a front grip ----
  B.barrage = (gb, L, sp, out) => {
    const col = sp.color;
    const rc = mgReceiver(gb, -1.5, 6.8, -0.3, 2.3, 0.95, { color: col });
    P.redDot(gb, 0.7, 3.1, { glow: '#ff4a2a', part: 'cover' });
    // the barrel under a perforated heat shield, a long conical flash hider
    cylX(gb, 6.8, 19.6, 1.45, 0, 0.48, 0.42, { color: BLUED, mat: GM.STEEL, seg: 16 });
    P.extX(gb, [[-0.9, 0.7], [0.9, 0.7], [0.95, 1.9], [0.6, 2.3], [-0.6, 2.3], [-0.95, 1.9]], 6.8, 13.6, { color: '#26282a', mat: GM.STEEL, bevel: 0.1 });
    if (!K.lite()) for (let k = 0; k < 7; k++) for (const y of [1.0, 1.6]) for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10);
      g.rotateX(HALF_PI);
      gb.add(g, { at: [7.45 + k * 0.85, y, s * 1.0], color: '#050506', mat: GM.STEEL });
    }
    P.vgrip(gb, 9.4, 0.65, { color: '#1b1c1e' });
    P.muzzle(gb, 'cone', 19.6, 1.45, 0.46, 1.6);
    P.grip(gb, -0.25, -0.25, { color: '#1c1d1f', h: 3.8, rake: 1.0 });
    P.trigger(gb, -0.05, -0.35, { color: col, len: 2.8, mat: GM.STEEL });
    // folding skeleton stock with a pad, its hinge
    ext(gb, [[-1.5, 2.0], [-10.0, 1.7], [-10.4, 1.3], [-10.4, -2.2], [-9.6, -2.3], [-8.8, -0.7], [-4.0, 0.0], [-1.5, -0.2]], -0.6, 0.6,
      { color: '#1e1f21', mat: GM.POLY, bevel: 0.22, bevelSeg: 3, holes: [[[-2.6, 1.3], [-8.7, 1.15], [-8.8, -0.4], [-4.2, 0.45]]] });
    rbox(gb, -11.1, -10.3, -2.3, 1.85, -0.72, 0.72, 0.26, { color: RUBBER, mat: GM.RUBBER });
    if (!K.lite()) P.pin(gb, -1.9, 1.5, 0.62, 0.16);
    // the 150-round box: a big polymer box clipped under the left side, a window on the belt
    P.ammoBox(gb, 2.6, 7.4, -5.6, -0.5, -2.4, 0.4, { color: sp.accent });
    if (!K.lite()) {
      rbox(gb, 3.2, 6.8, -3.4, -1.4, -2.5, -2.38, 0.08, { part: 'mag', color: '#0b0c0d', mat: GM.LENS, seg: 1 });
      for (let k = 0; k < 6; k++) cylX(gb, 3.4, 4.6, -1.7 - k * 0.32, -2.36, 0.12, 0.12, { part: 'mag', color: '#b08a3a', mat: GM.BRASS, seg: 8 });
    }
    P.belt(gb, [[3.0, -0.6, -1.65], [2.8, 0.5, -1.55], [2.5, 1.6, -1.15]], 5, { r: 0.18, half: 0.8, along: 'x' });
    mgOut(out, { muzzle: [21.2, 1.45, 0], front: [9.4, -2.3, 0], eject: [3.0, -0.3, 0.6], magwell: [5.0, -3.0, -1.0], rc, glow: '#ff4a2a' });
  };

  // ---- belt-fed heavy MG (remake): hip-carried, a perforated jacket, the chute to the backpack ----
  B.hmg = (gb, L, sp, out) => {
    const col = sp.color, acc = sp.accent;
    const rc = mgReceiver(gb, -1.8, 9.6, -0.6, 2.8, 1.35, { color: col, coverEnd: 8.0 });
    if (!K.lite()) for (let k = 0; k < 4; k++) rbox(gb, 4.4 + k * 1.2, 5.0 + k * 1.2, 0.0, 2.3, -1.52, -1.42, 0.06, { color: '#101112', seg: 1 });
    // a perforated barrel jacket, end bands, the heavy barrel and a bird-cage
    cylX(gb, 9.6, 26.0, 1.4, 0, 1.25, 1.2, { color: '#262824', mat: GM.STEEL, seg: 24 });
    if (!K.lite()) for (let r = 0; r < 5; r++) for (let k = 0; k < 9; k++) tubeHole(gb, 10.6 + k * 1.65 + (r % 2) * 0.8, 1.4, 1.23, -1.6 + r * 0.8, 0.28);
    for (const x of [9.8, 25.8]) torusX(gb, x, 1.4, 0, 1.24, 0.15, { color: '#1b1c1e', seg: 24 });
    cylX(gb, 26.0, 28.0, 1.4, 0, 0.62, 0.58, { color: BLUED, seg: 16 });
    P.muzzle(gb, 'a2', 28.0, 1.4, 0.7, 2.2);
    // the top handle and the support grip under the jacket
    tubePath(gb, [[6.6, 3.2, 0], [7.4, 6.2, 0], [12.8, 6.4, 0], [13.6, 2.7, 0]], 0.4, { color: RUBBER, mat: GM.RUBBER, seg: 20 });
    P.vgrip(gb, 13.6, 0.15, { color: RUBBER });
    P.grip(gb, -0.45, -0.6, { color: '#1c1d1f', h: 3.9, rake: 1.0 });
    P.trigger(gb, -0.25, -0.7, { color: col, len: 2.8, mat: GM.STEEL });
    // short skeleton butt
    ext(gb, [[-1.7, 2.6], [-8.6, 2.2], [-8.8, -1.8], [-7.6, -1.9], [-4.4, -0.4], [-1.7, -0.3]], -0.9, 0.9, { color: '#1e1e1a', mat: GM.POLY, bevel: 0.22, holes: [[[-2.8, 1.8], [-7.4, 1.6], [-7.4, -0.6], [-4.8, 0.4]]] });
    rbox(gb, -9.6, -8.6, -2.0, 2.4, -1.0, 1.0, 0.3, { color: RUBBER, mat: GM.RUBBER });
    // the flexible chute down and back to the backpack (ribbed), the belt up into the tray
    const M = { part: 'mag' };
    const chute = [[1.6, -0.8, -2.1], [0.4, -2.9, -3.3], [-2.6, -4.9, -4.5], [-7.0, -5.7, -5.3]];
    tubePath(gb, chute, 0.95, { ...M, color: acc, mat: GM.RUBBER, seg: 28, radial: 14 });
    if (!K.lite()) {
      const curve = new THREE.CatmullRomCurve3(chute.map((p) => new THREE.Vector3(...p)));
      const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _z = new THREE.Vector3(0, 0, 1), _one = new THREE.Vector3(1, 1, 1);
      for (let k = 1; k < 10; k++) {
        curve.getPointAt(k / 10, _p);
        curve.getTangentAt(k / 10, _t);
        _q.setFromUnitVectors(_z, _t);
        _m.compose(_p, _q, _one);
        gb.add(new THREE.TorusGeometry(0.97, 0.09, 6, 18), { ...M, matrix: _m.clone(), color: shadeHex(acc, -0.25), mat: GM.RUBBER, round: true });
      }
    }
    P.belt(gb, [[2.6, 2.3, -1.75], [2.2, 0.9, -2.05], [1.7, -0.5, -2.3]], 5, { r: 0.22, half: 0.95, along: 'x' });
    mgOut(out, { muzzle: [30.2, 1.4, 0], front: [13.6, -2.9, 0], eject: [3.2, -0.6, 0.8], magwell: [-1.5, -4.2, -4.2], rc, pack: true });
  };

  // ---- minigun (remake): six barrels in clamps, a finned motor housing, the feed chute ----------
  B.minigun = (gb, L, sp, out) => {
    const col = sp.color, acc = sp.accent;
    // the gun housing with cooling fins on top, the drive motor at the back
    P.extX(gb, P.rrect(1.75, -1.45, 3.2, 0.6), -7.2, 5.2, { color: col, mat: GM.STEEL, bevel: 0.2 });
    if (!K.lite()) for (let k = 0; k < 8; k++) rbox(gb, -6.6 + k * 0.9, -6.2 + k * 0.9, 3.15, 3.6, -1.4, 1.4, 0.08, { color: '#121314', seg: 1 });
    latheX(gb, [[-9.0, 0], [-9.0, 1.2], [-8.7, 1.45], [-7.2, 1.5], [-7.2, 0]], 0.9, 0, { color: '#1b1c1e', seg: 22 });
    if (!K.lite()) for (let k = 0; k < 6; k++) torusX(gb, -8.6 + k * 0.24, 0.9, 0, 1.48, 0.05, { color: '#0c0c0d', seg: 22 });
    if (!K.lite()) for (const s of [-1, 1]) rbox(gb, -5.8, 3.6, 0.2, 0.45, s * 1.88 - 0.05, s * 1.88 + 0.05, 0.04, { color: '#0d0e0f', seg: 1 });
    // the delinker / ejector under the front, the battery cable on the left
    rbox(gb, 3.2, 5.0, -1.9, -1.3, -0.9, 0.9, 0.15, { color: '#161718' });
    tubePath(gb, [[-4.0, 0.0, -1.95], [-5.6, -1.6, -2.4], [-7.6, -2.6, -2.6]], 0.16, { color: '#101010', mat: GM.RUBBER, seg: 14 });
    // the top carry handle, the grip and its trigger
    tubePath(gb, [[-2.5, 3.2, 0], [-2.0, 5.3, 0], [3.2, 5.7, 0], [3.8, 3.2, 0]], 0.36, { color: '#1b1c1e', mat: GM.RUBBER, seg: 18 });
    P.grip(gb, -0.2, -1.35, { color: '#1c1d1f', h: 3.6, rake: 0.6 });
    P.trigger(gb, 0.1, -1.45, { color: '#1a1b1c', len: 2.6, mat: GM.STEEL });
    // the feed chute with its belt, curving off to the left and back
    const M = { part: 'mag' };
    tubePath(gb, [[0.5, -1.2, -1.9], [-0.5, -3.2, -3.2], [-3.0, -4.6, -4.2]], 0.75, { ...M, color: acc, mat: GM.RUBBER, seg: 22, radial: 12 });
    P.belt(gb, [[-3.3, -4.85, -4.2], [-4.6, -5.3, -4.4], [-5.8, -5.8, -4.6]], 5, { ...M, r: 0.2, half: 0.75 });
    // the barrel cluster (spins): six barrels, the rotor, two clamps and the muzzle ring
    const Sp = { part: 'spin' };
    const bx0 = 5.0, bx1 = 21.5;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      cylX(gb, bx0, bx1, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.36, 0.33, { ...Sp, color: k % 2 ? '#34373a' : '#3c3f42', mat: GM.STEEL, seg: 12 });
      cylX(gb, bx1 - 0.05, bx1 + 0.02, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.19, 0.19, { ...Sp, color: '#020202', seg: 8 });
    }
    latheX(gb, [[bx0, 0], [bx0, 1.85], [bx0 + 0.3, 1.95], [bx0 + 2.2, 1.95], [bx0 + 2.4, 1.7], [bx0 + 2.4, 0]], 0, 0, { ...Sp, color: '#1b1c1e', seg: 26 });
    for (const f of [0.52, 0.8]) {
      const x = bx0 + (bx1 - bx0) * f;
      latheX(gb, [[x, 0], [x, 1.72], [x + 0.15, 1.82], [x + 0.85, 1.82], [x + 1.0, 1.72], [x + 1.0, 0]], 0, 0, { ...Sp, color: '#2a2b2c', seg: 26 });
    }
    latheX(gb, [[bx1 - 1.2, 0], [bx1 - 1.2, 1.7], [bx1 - 0.15, 1.75], [bx1, 1.62], [bx1, 0.0]], 0, 0, { ...Sp, color: '#232323', seg: 26 });
    out.pivots.spin = [0, 0, 0];
    out.length = bx1;
    out.muzzle = [bx1, 0, 0];
    out.front = [0.6, 5.3, 0];
    out.eject = [4.1, -1.9, 0.6];
    out.magwell = [-2.5, -4.4, -4];
    out.heavy = true;
    out.reload = 'mag';
  };

  // ---- chainsaw (remake) ------------------------------------------------------------------------

  /**
   * A two-stroke chainsaw. The engine: the crankcase, the orange top cover with the air filter
   * cover and choke, the cylinder's cooling fins showing on the right, the spark plug boot, the
   * recoil starter on the left with its handle and cord, fuel and bar-oil caps, the muffler.
   * The handles: the rear handle (a pistol grip in a closed loop, the throttle trigger in front
   * of it, the lockout on top) and the wrap-round top handle with the chain-brake guard. The
   * cutting end: bucking spikes, the guide bar (a long tapering plate with its nose rivet and
   * print) and the chain: drive links with cutters on alternating sides along the top and bottom
   * runs (parts 'chainA' / 'chainB': they slide along the bar, a pitch at a time) and round the
   * nose (part 'nose': it turns a link at a time), so the running chain loops the whole bar.
   */
  B.chainsaw = (gb, L, sp, out) => {
    const orange = sp.color, dark = '#1e1f20', grey = '#3a3c3f';
    const e0 = 1.9, e1 = 11.3;
    // crankcase and the orange top cover
    P.extX(gb, P.rrect(1.85, -1.6, 2.4, 0.7), e0, e1, { color: dark, mat: GM.POLY, bevel: 0.25 });
    ext(gb, [[e0 + 0.2, 1.6], [e1 - 0.2, 1.6], [e1 + 0.1, 2.6], [e1 - 0.6, 4.3], [e0 + 6.0, 4.75], [e0 + 2.0, 4.6], [e0 + 0.5, 3.6]], -1.95, 1.95,
      { color: orange, mat: GM.PAINT, bevel: 0.45, bevelSeg: 3 });
    // air filter cover with its vent grille, the choke knob at the back
    ext(gb, [[e0 + 2.0, 4.55], [e0 + 6.2, 4.7], [e0 + 6.0, 5.3], [e0 + 2.6, 5.25]], -1.35, 1.35, { color: dark, mat: GM.POLY, bevel: 0.2 });
    if (!K.lite()) for (let k = 0; k < 7; k++) rbox(gb, e0 + 2.75 + k * 0.45, e0 + 2.97 + k * 0.45, 5.3, 5.52, -0.95, 0.95, 0.05, { color: '#0b0b0c', seg: 1 });
    cylX(gb, e0 - 0.5, e0 + 0.6, 3.0, 1.1, 0.26, 0.26, { color: '#d8d0c0', mat: GM.POLY, seg: 10 });
    // the cylinder's cooling fins (right side), the spark plug boot on top
    if (!K.lite()) for (let k = 0; k < 7; k++) rbox(gb, e0 + 4.6 + k * 0.42, e0 + 4.8 + k * 0.42, 1.9, 3.8, 1.88, 2.05, 0.05, { color: '#151617', seg: 1 });
    cylX(gb, e0 + 6.6, e0 + 7.8, 4.5, 0, 0.3, 0.36, { color: '#1a1a1a', mat: GM.RUBBER, seg: 12 });
    // the recoil starter on the left, its handle and cord
    const scx = e0 + 4.2;
    gb.add(new THREE.CylinderGeometry(2.1, 2.1, 0.5, 30), { at: [scx, 1.0, -2.2], rot: [HALF_PI, 0, 0], color: dark, mat: GM.POLY, round: true });
    if (!K.lite()) for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      rbox(gb, -0.08, 0.08, -0.55, 0.55, -0.03, 0.03, 0.02, { color: '#070708', at: [scx + Math.cos(a) * 1.3, 1.0 + Math.sin(a) * 1.3, -2.47], rot: [0, 0, a - HALF_PI], seg: 1 });
    }
    gb.add(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), { at: [scx, 1.0, -2.47], rot: [HALF_PI, 0, 0], color: grey, mat: GM.POLY, round: true });
    rbox(gb, scx - 0.9, scx + 0.9, 3.5, 4.1, -2.95, -2.35, 0.22, { color: '#121212', mat: GM.RUBBER });
    tubePath(gb, [[scx, 3.55, -2.6], [scx, 2.5, -2.5]], 0.07, { color: '#d8d0c0', mat: GM.RUBBER, radial: 4 });
    // fuel cap (yellow) and bar-oil cap, the brand stripes
    gb.add(new THREE.CylinderGeometry(0.62, 0.62, 0.45, 16), { at: [e0 + 1.0, -0.5, -2.0], rot: [HALF_PI, 0, 0], color: '#f2c200', mat: GM.PAINT, round: true });
    gb.add(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), { at: [e1 - 2.7, -0.7, -2.0], rot: [HALF_PI, 0, 0], color: dark, mat: GM.POLY, round: true });
    for (const s of [-1, 1]) rbox(gb, e0 + 1.0, e0 + 8.2, 2.0, 2.45, s * 2.05 - 0.05, s * 2.05 + 0.05, 0.06, { color: '#f2f2f2', mat: GM.PAINT });
    // the muffler on the front right with its outlet slots
    rbox(gb, e1 - 2.5, e1 - 0.7, -0.9, 1.9, 1.75, 2.7, 0.35, { color: '#5c5f62', mat: GM.STEEL });
    if (!K.lite()) for (let k = 0; k < 4; k++) rbox(gb, e1 - 2.2 + k * 0.38, e1 - 2.0 + k * 0.38, -0.6, 1.6, 2.65, 2.75, 0.05, { color: '#050505', seg: 1 });
    // the rear handle: a beam back over the hand, the grip under it, a loop round it
    ext(gb, [[e0 + 0.5, 1.4], [-2.2, 1.2], [-2.8, 0.7], [-2.5, 0.1], [e0 + 0.5, 0.1]], -0.62, 0.62, { color: dark, mat: GM.POLY, bevel: 0.25 });
    P.grip(gb, -0.3, 0.3, { color: '#202122', h: 3.7, rake: 0.5, w: 0.56, mat: GM.RUBBER });
    tubePath(gb, [[-2.6, 0.6, 0], [-3.5, -0.9, 0], [-3.3, -3.0, 0], [-2.0, -3.9, 0], [0.6, -3.7, 0], [e0 + 0.4, -1.7, 0]], 0.42, { color: dark, mat: GM.POLY, seg: 26 });
    ext(gb, [[0.95, 0.15], [1.5, 0.15], [1.55, -0.5], [1.3, -1.3], [1.05, -1.25], [1.15, -0.5]], -0.16, 0.16, { color: grey, mat: GM.POLY, bevel: 0.05 });
    rbox(gb, -1.6, -0.4, 1.45, 1.75, -0.22, 0.22, 0.08, { color: grey, mat: GM.POLY });
    // the wrap-round top handle and the chain-brake guard in front of it
    tubePath(gb, [[e0 + 1.4, 4.3, 1.25], [e0 + 2.5, 6.0, 0.6], [e0 + 4.8, 6.35, -0.2], [e0 + 6.6, 5.7, -1.6], [e0 + 7.3, 2.6, -2.6], [e0 + 7.1, -1.3, -2.45]], 0.5,
      { color: dark, mat: GM.RUBBER, seg: 32 });
    ext(gb, [[e1 - 0.75, 3.5], [e1 - 0.3, 3.5], [e1 + 0.3, 5.9], [e1 - 0.05, 6.3], [e1 - 0.45, 5.8]], -1.6, 1.6, { color: '#141414', mat: GM.POLY, bevel: 0.1 });
    // the bar's clutch cover on the right, its nuts; bucking spikes on the left
    rbox(gb, e1 - 0.4, e1 + 1.0, -0.8, 2.0, 0.82, 1.7, 0.3, { color: orange, mat: GM.PAINT });
    for (const x of [e1 + 0.1, e1 + 0.6]) gb.add(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 6), { at: [x, 0.6, 1.76], rot: [HALF_PI, 0, 0], color: STEEL, mat: GM.STEEL, round: true });
    for (let k = 0; k < 2; k++) ext(gb, [[e1 - 0.1, -1.0 + k * 1.5], [e1 + 1.1, -0.7 + k * 1.5], [e1 - 0.1, -0.2 + k * 1.5]], -1.5, -1.3, { color: '#8a8e92', mat: GM.STEEL, bevel: 0.03 });
    // the guide bar: a thin plate with a rounded nose, its print and the nose sprocket's rivets
    const by = 0.6, bh = 1.3;
    const bx0 = e1 - 0.8, bx1 = 29.0, nose = bx1 - bh;
    ext(gb, [[bx0, by + bh], [nose, by + bh * 0.88], [nose + bh * 0.97, by + bh * 0.88, bx1, by + bh * 0.5, bx1, by], [bx1, by - bh * 0.5, nose + bh * 0.97, by - bh * 0.88, nose, by - bh * 0.88], [bx0, by - bh]],
      0.45, 0.8, { color: '#a4a9ae', mat: GM.STEEL, bevel: 0.05, wear: 1.4, fin: 'brushed' });
    if (!K.lite()) {
      rbox(gb, bx0 + 4.0, bx0 + 10.0, by - 0.32, by + 0.32, 0.41, 0.46, 0.04, { color: '#2a2c2e', mat: GM.PAINT, seg: 1 });
      rbox(gb, bx0 + 4.2, bx0 + 6.4, by - 0.18, by + 0.18, 0.395, 0.42, 0.02, { color: orange, mat: GM.PAINT, seg: 1 });
      for (const [x, y, r] of [[nose, by, 0.3], [nose - 1.2, by + 0.55, 0.14], [nose - 1.2, by - 0.55, 0.14]]) {
        const g = new THREE.CylinderGeometry(r, r, 0.06, 12);
        g.rotateX(HALF_PI);
        gb.add(g, { at: [x, y, 0.43], color: '#d0d4d8', mat: GM.STEEL, round: true });
      }
    }
    // the chain: drive links, and cutters on alternating sides, along the top and bottom runs
    const pitch = 0.62, cr = bh * 0.97;
    const link = (part, x, y, dir, i, at, rot) => {
      rbox(gb, x, x + 0.57, y - 0.12, y + 0.12, 0.42, 0.84, 0.03, { part, color: '#2e3134', mat: GM.STEEL, seg: 1, at, rot });
      if (!K.lite()) rbox(gb, x + 0.2, x + 0.37, y - 0.06, y + 0.06, 0.4, 0.86, 0.02, { part, color: '#8a8e92', mat: GM.STEEL, seg: 1, at, rot });   // rivet
      if (i % 2 === 0) {
        const zc = i % 4 === 0 ? 0.5 : 0.76;
        ext(gb, [[x + 0.05, y + dir * 0.1], [x + 0.42, y + dir * 0.1], [x + 0.38, y + dir * 0.36], [x + 0.15, y + dir * 0.32]], zc - 0.12, zc + 0.12,
          { part, color: '#c8ccd0', mat: GM.STEEL, bevel: 0.02, detail: true, at, rot });
      }
    };
    for (const [part, y, dir] of [['chainA', by + cr, 1], ['chainB', by - cr, -1]]) {
      let i = 0;
      for (let x = e1 + 1.1; x < nose - 0.3; x += pitch, i++) link(part, x, y, dir, i);
    }
    // round the nose: a link every 30° from the top round to the bottom; the part turns a link's
    // angle while the runs slide a pitch, then starts over, so the chain seems to run on round
    const NOSE_N = 7, step = Math.PI / (NOSE_N - 1);
    for (let k = 0; k < NOSE_N; k++) {
      const a = HALF_PI - k * step;
      link('nose', -0.285, 0, 1, k, [nose + Math.cos(a) * cr, by + Math.sin(a) * cr, 0], [0, 0, a - HALF_PI]);
    }
    out.pivots.nose = [nose, by, 0];
    out.muzzle = [bx1 - 0.3, by, 0.6];
    out.length = bx1;
    out.front = [e0 + 4.6, 6.25, -0.1];
    // (the support arm comes over the saw from low on the left, clear of the engine's side)
    out.supportElbow = [-1, -4, -17];
    out.magwell = [scx, 3.8, -2.65];
    out.eject = [2, 2, 1];
    out.heavy = true;
    out.reload = 'pull';
    out.casing = null;
    out.chain = { pitch, y: by, r: cr, step, nose: [nose, by] };
    out.glowColor = null;
  };

  // ---- saw-blade launcher -------------------------------------------------------------------------

  /**
   * An industrial launcher: a stamped yellow receiver with the drive motor on top, the launch
   * rails in front with a blade riding between them (part 'blade': it idles round and leaves on
   * a shot), stop lips at their ends, a pressure gauge, a cassette of blades under the receiver
   * (part 'mag'), a skeleton stock, a top handle with a reflex sight.
   */
  B.sawblade = (gb, L, sp, out) => {
    const yellow = sp.color, dark = '#1f2022';
    // the receiver with its vents, the drive motor on top
    ext(gb, [[-1.6, -0.3], [6.4, -0.3], [6.8, 0.4], [6.8, 2.6], [6.2, 3.1], [-1.2, 3.1], [-1.6, 2.6]], -1.1, 1.1, { color: yellow, mat: GM.PAINT, bevel: 0.3, bevelSeg: 3 });
    if (!K.lite()) for (let k = 0; k < 4; k++) rbox(gb, 0.2 + k * 1.1, 0.75 + k * 1.1, 1.0, 2.4, -1.24, -1.14, 0.05, { color: '#151515', seg: 1 });
    latheX(gb, [[2.2, 0], [2.2, 0.75], [2.4, 0.9], [5.4, 0.9], [5.6, 0.75], [5.6, 0]], 3.1, 0, { color: dark, mat: GM.STEEL, seg: 20 });
    if (!K.lite()) for (let k = 0; k < 6; k++) torusX(gb, 2.6 + k * 0.5, 3.1, 0, 0.9, 0.05, { color: '#0e0e0f', seg: 20 });
    // the launch rails either side of the blade with their stop lips, the hazard stripes on the left one
    for (const s of [-1, 1]) {
      ext(gb, [[6.0, -0.3], [12.2, 0.1], [12.5, 0.6], [12.4, 1.9], [11.7, 1.9], [11.6, 1.1], [6.0, 1.1]], s * 0.62 - 0.12, s * 0.62 + 0.12,
        { color: dark, mat: GM.STEEL, bevel: 0.05, holes: [[[7.0, 0.0], [8.4, 0.05], [8.4, 0.7], [7.0, 0.7]], [[9.0, 0.08], [10.4, 0.15], [10.4, 0.7], [9.0, 0.7]]] });
    }
    rbox(gb, 6.0, 12.3, -0.3, -0.05, -0.62, 0.62, 0.06, { color: '#2a2c2e', mat: GM.STEEL });
    if (!K.lite()) for (let k = 0; k < 4; k++) rbox(gb, 10.55 + k * 0.28 - 0.06, 10.55 + k * 0.28 + 0.06, 0.74, 1.02, -0.77, -0.73, 0.02, { color: k % 2 ? '#1a1a1a' : '#f2c200', mat: GM.PAINT, seg: 1, rot: [0, 0, 0.5] });
    // a pressure gauge on the left of the receiver
    gb.add(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 18), { at: [5.55, 1.75, -1.25], rot: [HALF_PI, 0, 0], color: STEEL, mat: GM.STEEL, round: true });
    if (!K.lite()) {
      const dial = new THREE.CircleGeometry(0.45, 18);
      dial.rotateY(Math.PI);
      gb.add(dial, { at: [5.55, 1.75, -1.41], color: '#e8e4d0', mat: GM.PAINT });
      const needle = new THREE.BoxGeometry(0.05, 0.36, 0.02);
      needle.translate(0, 0.16, 0);
      gb.add(needle, { at: [5.55, 1.75, -1.43], rot: [0, 0, 0.9], color: '#c62828', mat: GM.PAINT });
    }
    // the loaded blade: a toothed disc with lightening holes and an arbor nut (it spins; it leaves on a shot)
    const Bl = { part: 'blade' };
    const bcx = 9.0, bcy = 2.3, R = 2.0;
    const holes = [];
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; holes.push(circle(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0.3)); }
    ext(gb, circle(0, 0, R * 0.93), -0.06, 0.06, { ...Bl, at: [bcx, bcy, 0], holes, color: '#b8bcc0', mat: GM.STEEL, bevel: 0.02, wear: 1.6, fin: 'brushed', curve: 10 });
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * TAU;
      ext(gb, [[0, 0], [0.42, 0], [0.1, 0.3]], -0.05, 0.05, { ...Bl, color: '#d8dce0', mat: GM.STEEL, bevel: 0.01, at: [bcx + Math.cos(a) * R * 0.9, bcy + Math.sin(a) * R * 0.9, 0], rot: [0, 0, a - HALF_PI] });
    }
    cylX(gb, -0.12, 0.12, 0, 0, 0.5, 0.5, { ...Bl, at: [bcx, bcy, 0], rot: [0, HALF_PI, 0], color: '#2a2c2e', seg: 14 });
    // the blade cassette under the receiver: a drum of discs side by side, its latch
    const M = { part: 'mag' };
    const mcx = 4.6, mcy = -2.1;
    latheX(gb, [[0, 0], [0, 1.6], [0.15, 1.72], [1.85, 1.72], [2.0, 1.6], [2.0, 0]], 0, 0, { ...M, color: '#2a2b2d', mat: GM.STEEL, seg: 26, at: [mcx, mcy, -1.0], rot: [0, -HALF_PI, 0] });
    if (!K.lite()) for (let k = 0; k < 5; k++) torusX(gb, 0, 0, 0, 1.72, 0.05, { ...M, color: '#c8ccd0', seg: 26, at: [mcx, mcy, -0.75 + k * 0.38], rot: [0, -HALF_PI, 0] });
    rbox(gb, mcx - 1.0, mcx + 1.0, -0.7, 0.0, -0.7, 0.7, 0.15, { ...M, color: dark, mat: GM.STEEL });
    // grip, trigger, a skeleton stock, a top carry handle with a reflex sight
    P.grip(gb, -0.4, -0.15, { color: dark, h: 3.8, rake: 0.85, mat: GM.RUBBER });
    P.trigger(gb, -0.15, -0.25, { color: dark, len: 2.7, mat: GM.STEEL });
    ext(gb, [[-1.6, 2.6], [-9.2, 2.2], [-9.4, -1.8], [-8.4, -1.9], [-7.8, 0.0], [-1.6, 0.4]], -0.55, 0.55,
      { color: dark, mat: GM.STEEL, bevel: 0.12, holes: [[[-2.6, 1.9], [-7.6, 1.6], [-7.4, 0.8], [-2.7, 1.0]]] });
    rbox(gb, -10.0, -9.1, -1.9, 2.4, -0.8, 0.8, 0.28, { color: RUBBER, mat: GM.RUBBER });
    tubePath(gb, [[-0.6, 3.0, 0], [-0.1, 4.6, 0], [1.6, 4.8, 0], [2.1, 3.9, 0]], 0.3, { color: dark, mat: GM.RUBBER, seg: 16 });
    P.redDot(gb, -0.1, 5.0, { glow: '#ffb02a' });
    out.pivots.blade = [bcx, bcy, 0];
    out.length = 12.5;
    out.muzzle = [12.0, bcy, 0];
    out.front = [7.4, -0.5, 0];
    out.eject = [4, 2, 1];
    out.magwell = [mcx, mcy, -1.0];
    out.heavy = true;
    out.reload = 'mag';
    out.casing = null;
    out.blade = { at: [bcx, bcy, 0], r: R };
    out.glowColor = '#ffb02a';
  };

  // ---- Hollow Star: the super weapon -----------------------------------------------------------

  /**
   * A dark gunmetal bullpup frame, armoured spine plates with glowing seams, side panels with
   * glowing vents, a power cell behind the grip with glowing level bands (part 'mag'), and at
   * the front the containment cage: two end rings with glowing rims and six magnetic coils
   * between them (part 'rings': they turn, faster as it charges) round a captive singularity —
   * a black core in a white-hot accretion ring with a violet halo (part 'orb') — and three
   * prongs converging on the emitter. The viewmodel brightens the glow parts with the charge.
   */
  B.hollowstar = (gb, L, sp, out) => {
    // (the glow parts are drawn ×2.6 in HDR: a saturated violet so they stay violet, not white)
    const body = sp.color, glow = '#7c3cff', metal = '#2a2833';
    // frame and stock: one long armoured shell, a rubber butt pad
    ext(gb, [[-10.8, 2.2], [-6.0, 2.6], [5.6, 2.8], [6.6, 2.0], [6.6, 0.2], [5.4, -0.6], [2.6, -0.6], [2.2, 0.1], [-0.6, 0.1], [-1.6, -0.6],
      [-6.8, -0.6], [-8.0, -1.6], [-10.4, -2.4], [-11.0, -2.1]], -1.15, 1.15, { color: body, mat: GM.PAINT, bevel: 0.45, bevelSeg: 3 });
    rbox(gb, -11.6, -10.8, -2.3, 2.3, -1.15, 1.15, 0.32, { color: '#141218', mat: GM.RUBBER });
    // armoured spine plates with glowing seams between them
    for (let k = 0; k < 5; k++) {
      const x = -6.2 + k * 2.4;
      ext(gb, [[x, 2.6], [x + 2.1, 2.7], [x + 1.9, 3.25], [x + 0.2, 3.2]], -0.85, 0.85, { color: metal, mat: GM.ALLOY, bevel: 0.12 });
      if (k) rbox(gb, x - 0.24, x - 0.08, 2.7, 3.1, -0.6, 0.6, 0.03, { glow: true, color: glow });
    }
    // side panels with glowing vents
    for (const s of [-1, 1]) {
      ext(gb, [[-5.4, 0.3], [-0.2, 0.4], [0.6, 1.2], [0.4, 2.2], [-5.2, 2.2], [-5.8, 1.4]], s * 1.35 - 0.12, s * 1.35 + 0.12, { color: metal, mat: GM.ALLOY, bevel: 0.08 });
      for (let k = 0; k < 4; k++) rbox(gb, -4.6 + k * 1.2, -4.0 + k * 1.2, 0.75, 1.85, s * 1.48 - 0.03, s * 1.48 + 0.03, 0.04, { glow: true, color: mixHex(glow, '#ffffff', 0.15) });
    }
    // the power cell behind the grip (swapped on a reload) with its level bands
    const M = { part: 'mag' };
    const ca = -HALF_PI + 0.12, cdx = Math.cos(ca), cdy = Math.sin(ca);
    latheX(gb, [[0, 0], [0, 0.85], [0.2, 0.95], [3.6, 0.95], [3.8, 0.85], [3.8, 0]], 0, 0, { ...M, color: '#16141c', mat: GM.ALLOY, seg: 20, at: [-6.6, -0.4, 0], rot: [0, 0, ca] });
    for (let k = 0; k < 3; k++) {
      const d = 1.0 + k * 0.9;
      torusX(gb, 0, 0, 0, 0.97, 0.06, { ...M, glow: true, color: glow, seg: 20, at: [-6.6 + cdx * d, -0.4 + cdy * d, 0], rot: [0, 0, ca] });
    }
    // grip, trigger, a vertical front grip
    P.grip(gb, -0.4, 0.1, { color: '#18161d', h: 3.9, rake: 0.8, mat: GM.RUBBER });
    P.trigger(gb, -0.15, 0.0, { color: metal, len: 2.7, mat: GM.ALLOY });
    P.vgrip(gb, 4.4, -0.55, { color: '#18161d' });
    // the containment cage: two end rings with glowing rims, six coils between them
    const cx0 = 6.6, cx1 = 12.6, cy = 1.25;
    for (const [x, face] of [[cx0, 1], [cx1, -1]]) {
      latheX(gb, [[x - 0.4, 1.4], [x - 0.4, 2.1], [x + 0.4, 2.1], [x + 0.4, 1.4], [x - 0.4, 1.4]], cy, 0, { color: metal, mat: GM.ALLOY, seg: 28 });
      torusX(gb, x, cy, 0, 1.4, 0.07, { glow: true, color: glow, seg: 28 });
      torusX(gb, x + face * 0.42, cy, 0, 1.75, 0.06, { glow: true, color: mixHex(glow, '#ffffff', 0.3), seg: 28 });
    }
    const Rg = { part: 'rings' };
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const y = cy + Math.sin(a) * 1.75, z = Math.cos(a) * 1.75;
      cylX(gb, cx0 + 0.3, cx1 - 0.3, y, z, 0.22, 0.22, { ...Rg, color: '#3a3644', mat: GM.ALLOY, seg: 10 });
      if (!K.lite()) for (let q = 0; q < 5; q++) torusX(gb, cx0 + 1.0 + q * 0.95, y, z, 0.26, 0.07, { ...Rg, color: '#b8683a', mat: GM.BRASS, seg: 10 });
    }
    // the captive singularity: a black core, a white-hot accretion ring, a violet halo
    const O = { part: 'orb' };
    const ox = (cx0 + cx1) / 2;
    sphere(gb, ox, cy, 0, 0.72, { ...O, color: '#020203', mat: GM.LENS, seg: 18 });
    const disk = new THREE.TorusGeometry(1.05, 0.12, 6, 36);
    disk.rotateX(1.2);
    disk.translate(ox, cy, 0);
    gb.add(disk, { ...O, glow: true, color: '#fff2ff', round: true });
    const halo = new THREE.TorusGeometry(1.25, 0.05, 4, 36);
    halo.rotateX(1.2);
    halo.rotateY(0.6);
    halo.translate(ox, cy, 0);
    gb.add(halo, { ...O, glow: true, color: glow, round: true });
    // three prongs converging on the emitter in front of the cage
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + HALF_PI;
      tubePath(gb, [[cx1, cy + Math.sin(a) * 1.75, Math.cos(a) * 1.75], [cx1 + 1.4, cy + Math.sin(a) * 1.5, Math.cos(a) * 1.5], [cx1 + 2.6, cy + Math.sin(a) * 0.55, Math.cos(a) * 0.55]],
        0.16, { color: '#48445a', mat: GM.ALLOY, radial: 6, seg: 10 });
    }
    sphere(gb, cx1 + 2.7, cy, 0, 0.32, { glow: true, color: '#efe2ff', seg: 12 });
    // a compact projected-reticle sight on the spine
    P.holo(gb, -2.2, 3.25, { glow, color: '#18161d' });
    out.pivots.orb = [ox, cy, 0];
    out.pivots.rings = [ox, cy, 0];
    out.length = cx1 + 2.8;
    out.muzzle = [cx1 + 2.8, cy, 0];
    out.front = [4.4, -2.7, 0];
    out.magwell = [-6.4, -1.6, 0];
    out.eject = [0, 2, 1];
    out.heavy = true;
    out.casing = null;
    out.glowColor = sp.accent;
  };
}
