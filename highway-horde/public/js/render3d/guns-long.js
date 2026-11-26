// Long guns for actor-guns.js, assembled from guns-parts.js: the AR-pattern assault rifle and
// the M4 carbine, the AK-pattern rifle, the scoped bullpup, the scout / sniper / magnum /
// semi-auto rifles, the pump, combat and box-magazine shotguns. Each builder lays out real
// proportions in gun units (1 ≈ 3 cm, origin at the firing hand), names its moving parts
// (bolt, mag, pump, silencer) and fills `out` (muzzle, support-hand grip, ejection port,
// magwell, reload style, length).

import { gunParts } from './guns-parts.js';

/**
 * Register the builders.
 * @param {object} B the BUILDERS table of actor-guns.js (style → builder)
 * @param {object} K the kit (actor-guns.js)
 */
export function installLongGuns(B, K) {
  const P = gunParts(K);
  const { THREE, GM, ext, rbox, cylX, latheX, sphere, torusX, rail, dot, shadeHex, mixHex } = K;
  const { DARK, BLUED, BRASS, RUBBER, STEEL } = K.C;
  const HALF_PI = Math.PI / 2;

  /** Common `out` fields of a rifle. */
  function rifleOut(out, o) {
    out.length = o.muzzle[0];
    out.muzzle = o.muzzle;
    out.front = o.front;
    out.eject = o.eject || [2.0, 1.7, 0.95];
    out.magwell = o.magwell || [3.1, -1.2, 0];
    out.travel.bolt = o.bolt ?? 2.4;
    out.casing = o.casing || 'rifle';
    if (o.glow) out.glowColor = o.glow;
  }

  // ---- AR-pattern assault rifle (remake): flat-top upper, M-LOK rail, red dot, carbine stock ----
  B.rifle = (gb, L, sp, out) => {
    const rec = '#202224', acc = sp.accent;
    const [m0] = P.arLower(gb, { color: rec });
    P.arUpper(gb, 4.3, { color: rec });
    P.mlok(gb, 4.15, 13.8, 1.55, 0.95, { color: acc, fin: 'anod_od' });
    P.barrel(gb, 13.8, 19.0, 1.55, 0.3);
    rbox(gb, 13.85, 14.6, 1.0, 2.05, -0.42, 0.42, 0.12, { color: '#161718' });                 // gas block
    P.muzzle(gb, 'a2', 19.0, 1.55, 0.36, 1.75);
    P.rearSight(gb, -2.0, 2.66);
    P.frontSightA(gb, 12.9, 2.86, { dot: true });
    P.redDot(gb, 0.6, 2.66);
    P.grip(gb, -0.25, -0.15, { color: acc, h: 3.9, rake: 1.05 });
    P.carbineStock(gb, -2.95, 1.55, { color: acc });
    P.mag(gb, m0 + 0.1, -1.3, 5.7, 1.25, { color: '#1c1d1e' });
    P.swivel(gb, 13.0, 0.5, 0);
    rifleOut(out, { muzzle: [20.75, 1.55, 0], front: [9.6, 0.62, 0], magwell: [m0 + 1.2, -1.3, 0], glow: '#ff3a2a' });
  };

  // ---- M4 carbine: shorter rail, holographic sight, FDE furniture, a screw-on suppressor ----
  B.m4 = (gb, L, sp, out) => {
    const rec = sp.color, fde = sp.accent;
    const [m0] = P.arLower(gb, { color: rec });
    P.arUpper(gb, 4.3, { color: rec });
    P.mlok(gb, 4.15, 11.2, 1.55, 0.9, { color: fde, fin: 'anod_tan' });
    P.barrel(gb, 11.2, 15.6, 1.55, 0.29);
    P.muzzle(gb, 'a2', 15.6, 1.55, 0.35, 1.6);
    P.suppressor(gb, 15.7, 1.55, 0.62, 5.4, { color: '#26282a' });
    P.rearSight(gb, -2.0, 2.66);
    P.holo(gb, 0.4, 2.66);
    P.vgrip(gb, 8.6, 0.65, { color: '#1b1c1e' });
    P.grip(gb, -0.25, -0.15, { color: fde, h: 3.85, rake: 1.0 });
    P.carbineStock(gb, -2.95, 1.55, { color: fde });
    P.mag(gb, m0 + 0.1, -1.3, 5.7, 1.25, { color: '#1c1d1e' });
    rifleOut(out, { muzzle: [21.1, 1.55, 0], front: [8.6, -2.2, 0], magwell: [m0 + 1.2, -1.3, 0], glow: '#ff3a2a' });
    out.muzzleBare = [17.2, 1.55, 0];
  };

  // ---- AK-pattern rifle: stamped receiver, wood furniture, curved steel magazine, slant brake ----
  B.ak = (gb, L, sp, out) => {
    const steel = '#2a2b2c', wood = mixHex(sp.accent, '#8a4a22', 0.3);
    // receiver: a stamped box with the dust cover on top (ribbed), rivets, the side rail on the left
    ext(gb, [[-2.3, -0.25], [6.5, -0.25], [6.6, 0.1], [6.6, 1.55], [-2.3, 1.55]], -0.72, 0.72, { color: steel, mat: GM.STEEL, bevel: 0.08 });
    P.extX(gb, [[-0.74, 1.45], [0.74, 1.45], [0.74, 1.75], [0.5, 2.1], [-0.5, 2.1], [-0.74, 1.75]], -1.9, 6.0, { color: shadeHex(steel, 0.05), mat: GM.STEEL, bevel: 0.06 });
    if (!K.lite()) for (let k = 0; k < 5; k++) rbox(gb, -1.2 + k * 1.5, -0.7 + k * 1.5, 2.02, 2.14, -0.3, 0.3, 0.05, { color: shadeHex(steel, -0.1), mat: GM.STEEL, seg: 1 });
    rbox(gb, -2.15, -1.75, 1.6, 2.05, -0.3, 0.3, 0.06, { color: steel });                         // dust cover button
    for (const [x, y] of [[-1.7, 0.2], [-1.7, 1.1], [5.6, 0.3], [5.95, 0.3], [5.6, 1.15], [5.95, 1.15], [2.6, -0.05]]) P.pin(gb, x, y, 0.73, 0.09, { color: '#3a3b3c' });
    rbox(gb, 1.2, 5.2, 0.45, 1.2, -0.86, -0.72, 0.05, { color: '#1c1d1e', mat: GM.STEEL });      // side mount rail (left)
    // selector lever on the right (long), charging handle on the bolt carrier (right, racks)
    ext(gb, [[-1.8, 1.45], [4.6, 1.2], [4.6, 0.95], [-1.6, 1.12]], 0.72, 0.86, { color: '#1d1e1f', mat: GM.STEEL, bevel: 0.03 });
    rbox(gb, 4.1, 4.8, 1.25, 1.6, 0.72, 1.55, 0.12, { part: 'bolt', color: '#3a3b3d', mat: GM.STEEL });
    rbox(gb, 1.5, 4.4, 1.3, 1.5, 0.7, 0.76, 0.03, { color: '#060606' });                         // ejection slot
    // rear sight block with the tangent leaf, the trunnion
    ext(gb, [[6.5, 1.5], [7.6, 1.5], [7.6, 2.45], [7.1, 2.6], [6.5, 2.25]], -0.5, 0.5, { color: steel, mat: GM.STEEL, bevel: 0.07 });
    ext(gb, [[5.9, 2.3], [7.4, 2.45], [7.4, 2.6], [5.9, 2.48]], -0.28, 0.28, { color: '#141516', mat: GM.STEEL, bevel: 0.02, fin: 'sight' });
    // barrel, gas block with the front sight, the gas tube under the upper handguard
    P.barrel(gb, 7.5, 17.6, 0.95, 0.3, { seg: 14 });
    ext(gb, [[14.6, 0.55], [15.5, 0.55], [15.5, 2.3], [15.15, 2.45], [14.6, 2.3]], -0.42, 0.42, { color: steel, mat: GM.STEEL, bevel: 0.07 });   // gas block
    ext(gb, [[16.3, 0.55], [17.1, 0.55], [17.0, 1.35], [16.85, 2.75], [16.45, 2.75], [16.4, 1.35]], -0.38, 0.38, { color: steel, mat: GM.STEEL, bevel: 0.06,
      holes: [[[16.5, 1.95], [16.8, 1.95], [16.78, 2.6], [16.52, 2.6]]] });                         // front sight block (hooded)
    rbox(gb, 16.62, 16.7, 1.9, 2.5, -0.04, 0.04, 0.01, { color: '#0c0c0c', fin: 'sight', seg: 1 });
    cylX(gb, 7.6, 14.7, 2.0, 0, 0.3, 0.3, { color: shadeHex(steel, 0.04), seg: 12 });
    // wooden handguards: the lower one cradling the barrel, the upper over the gas tube
    P.extX(gb, [[-0.78, 0.2], [0.78, 0.2], [0.92, 0.6], [0.92, 1.45], [0.62, 1.6], [-0.62, 1.6], [-0.92, 1.45], [-0.92, 0.6]], 7.55, 12.3, { color: wood, mat: GM.WOOD, bevel: 0.14 });
    P.extX(gb, [[-0.52, 1.7], [0.52, 1.7], [0.6, 2.05], [0.4, 2.42], [-0.4, 2.42], [-0.6, 2.05]], 7.6, 12.0, { color: wood, mat: GM.WOOD, bevel: 0.1 });
    if (!K.lite()) for (let k = 0; k < 3; k++) rbox(gb, 8.4 + k * 1.15, 9.0 + k * 1.15, 1.75, 2.0, -0.62, 0.62, 0.05, { color: '#08080a', seg: 1 });
    rbox(gb, 12.25, 12.55, 0.15, 1.7, -0.95, 0.95, 0.06, { color: steel, mat: GM.STEEL });        // handguard retainer
    P.muzzle(gb, 'ak', 17.6, 0.95, 0.33, 1.15, { color: '#1a1a1b' });
    // trigger guard (stamped, flat), pistol grip, magazine catch
    ext(gb, [[-0.5, -0.2], [2.55, -0.2], [2.55, -0.45], [2.25, -1.25], [-0.1, -1.25], [-0.5, -0.6]], -0.22, 0.22, { color: steel, mat: GM.STEEL, bevel: 0.05,
      holes: [[[-0.15, -0.42], [2.25, -0.42], [2.0, -1.0], [0.1, -1.0]]] });
    ext(gb, [[0.95, -0.25], [1.2, -0.25], [1.05, -0.75], [0.85, -0.95], [0.7, -0.9], [0.95, -0.5]], -0.12, 0.12, { color: '#4a4c50', mat: GM.STEEL, bevel: 0.03 });
    P.grip(gb, -0.3, -0.2, { color: shadeHex(wood, -0.25), h: 3.6, rake: 1.25, w: 0.55, mat: GM.WOOD });
    rbox(gb, 2.15, 2.5, -1.2, -0.25, -0.18, 0.18, 0.05, { color: steel, mat: GM.STEEL });       // mag catch paddle
    P.mag(gb, 2.55, -0.25, 6.0, 2.7, { color: '#2b2c2d', steel: true, w: 2.4, hz: 0.5 });
    P.fixedStock(gb, -2.3, 1.15, { color: wood, mat: GM.WOOD, plate: '#2a2b2c' });
    rifleOut(out, { muzzle: [18.75, 0.95, 0], front: [9.8, 0.25, 0], eject: [3.0, 1.45, 0.9], magwell: [3.8, -0.4, 0], bolt: 2.6 });
  };

  // ---- scoped bullpup: a one-piece polymer shell, the magazine behind the grip, built-in optic ----
  B.bullpup = (gb, L, sp, out) => {
    const shell = sp.color, dark = '#1a1b1c';
    // the stock / receiver shell from the butt to the front of the action
    ext(gb, [[-12.2, 2.4], [-7.6, 2.6], [5.4, 2.6], [6.0, 2.1], [6.0, 0.35], [5.3, -0.1], [2.6, -0.1], [2.2, 0.3], [-0.6, 0.3], [-1.6, -0.35],
      [-7.2, -0.35], [-8.3, -1.3], [-11.9, -2.5], [-12.5, -2.3]], -1.0, 1.0, { color: shell, mat: GM.POLY, bevel: 0.5, bevelSeg: 4 });
    rbox(gb, -13.1, -12.25, -2.5, 2.55, -1.04, 1.04, 0.3, { color: RUBBER, mat: GM.RUBBER });
    // the closed hand guard round the grip (one moulding with the trigger guard)
    ext(gb, [[-1.1, 0.35], [2.7, 0.35], [3.0, -0.4], [2.4, -3.9], [1.9, -4.15], [-1.3, -4.15], [-1.55, -3.8], [-0.95, -3.55], [1.35, -3.55], [1.85, -0.55], [-0.6, -0.55]], -0.35, 0.35,
      { color: shell, mat: GM.POLY, bevel: 0.12 });
    P.grip(gb, -0.45, 0.25, { color: shadeHex(shell, -0.15), h: 3.7, rake: 0.55 });
    // ejection port by the cheek, the charging handle on the left, the magazine catch
    rbox(gb, -5.4, -2.2, 1.3, 2.1, 0.98, 1.08, 0.08, { color: '#070708' });
    rbox(gb, 1.2, 2.3, 1.6, 2.0, -1.3, -0.95, 0.1, { part: 'bolt', color: dark });
    rbox(gb, -3.4, -2.8, -0.6, -0.2, -1.05, 1.05, 0.06, { color: dark });
    // barrel out of the shell, a folding vertical grip, a cone flash hider
    P.barrel(gb, 6.0, 15.6, 1.25, 0.32);
    rbox(gb, 6.0, 7.2, 0.55, 1.95, -0.55, 0.55, 0.15, { color: dark, mat: GM.STEEL });
    P.vgrip(gb, 8.2, 0.72, { color: shell });
    P.muzzle(gb, 'cone', 15.6, 1.25, 0.33, 1.2);
    // integrated optic on its carry-handle mount, a backup iron sight on top
    ext(gb, [[-3.3, 2.5], [4.3, 2.5], [4.6, 3.1], [-3.6, 3.1]], -0.45, 0.45, { color: shell, mat: GM.POLY, bevel: 0.12 });
    P.scope(gb, -3.4, 4.6, 4.05, 0.62, { mount: 3.0 });
    rbox(gb, -0.6, 0.2, 5.0, 5.35, -0.2, 0.2, 0.05, { color: dark, fin: 'sight' });
    // the magazine behind the grip (translucent-looking smoke polymer: brass shows through the window)
    P.mag(gb, -6.6, -0.3, 5.0, 0.9, { color: '#2b2e30', w: 2.2 });
    if (!K.lite()) for (let k = 0; k < 4; k++) rbox(gb, -6.1 + k * 0.08, -4.9 + k * 0.08, -1.3 - k * 0.9, -0.8 - k * 0.9, -0.6, -0.56, 0.08, { part: 'mag', color: BRASS, mat: GM.BRASS, seg: 1 });
    rifleOut(out, { muzzle: [16.8, 1.25, 0], front: [8.2, -2.3, 0], eject: [-3.8, 1.9, 1.1], magwell: [-5.4, -0.5, 0], bolt: 1.4, glow: '#ff3a2a' });
  };

  // ---- bolt-action family -------------------------------------------------------------------

  /** A round bolt-action receiver with its bolt (part 'bolt': lifts and cycles) and a box magazine. */
  function boltAction(gb, x0, x1, y, r, o = {}) {
    cylX(gb, x0, x1, y, 0, r, r, { color: o.color || '#1d1e20', mat: GM.STEEL, seg: 22 });
    rbox(gb, x0 + 2.4, x0 + 5.6, y - r * 0.55, y + r * 0.6, r * 0.85, r * 1.02, 0.06, { color: '#060607' });       // ejection port
    rail(gb, x0 + 0.2, x1 - 0.3, y + r - 0.02, 0, 0.82, { color: '#121314' });
    const Bo = { part: 'bolt' };
    cylX(gb, x0 - 1.0, x0 + 0.1, y, 0, r * 0.82, r * 0.82, { ...Bo, color: '#9a9ea2', mat: GM.STEEL, seg: 16 });
    latheX(gb, [[x0 - 1.6, 0], [x0 - 1.6, r * 0.55], [x0 - 1.0, r * 0.75], [x0 - 1.0, 0]], y, 0, { ...Bo, color: '#1c1d1f', seg: 14 });
    const bh = new THREE.CylinderGeometry(0.15, 0.15, 1.9, 10);
    gb.add(bh, { ...Bo, at: [x0 + 0.1, y - 0.3, r + 0.75], rot: [HALF_PI - 0.5, 0, 0], color: '#2a2b2d', mat: GM.STEEL, round: true });
    sphere(gb, x0 + 0.1, y - 0.75, r + 1.5, 0.42, { ...Bo, color: '#141516', mat: GM.POLY, seg: 12 });
    // detachable box magazine
    const M = { part: 'mag' };
    rbox(gb, x0 + 3.0, x0 + 5.4, y - r - 2.2, y - r + 0.1, -0.55, 0.55, 0.14, { ...M, color: '#1c1d1e', mat: GM.STEEL });
    rbox(gb, x0 + 2.9, x0 + 5.5, y - r - 2.5, y - r - 2.1, -0.6, 0.6, 0.12, { ...M, color: '#121314', mat: GM.POLY });
    return { magX: x0 + 4.2, magY: y - r - 1.2 };
  }

  /** A sporter / precision stock with a pistol grip, forend and butt (profile in one piece). */
  function sporterStock(gb, y, fwd, o = {}) {
    ext(gb, [[fwd, y - 0.15], [fwd - 0.4, y - 1.15], [1.6, y - 1.3], [1.0, y - 1.0], [0.95, y - 4.0], [-0.55, y - 4.25], [-1.95, y - 3.7], [-2.4, y - 1.8],
      [-5.6, y - 2.1], [-11.9, y - 3.2], [-12.2, y + 1.0], [-7.8, y + 0.95], [-4.0, y + 0.75], [-2.2, y + 0.35], [-0.8, y - 0.35], [fwd - 1.2, y - 0.25]],
    -(o.w ?? 0.85), o.w ?? 0.85, { color: o.color, mat: o.mat ?? GM.POLY, bevel: 0.45, bevelSeg: 4 });
    rbox(gb, -12.85, -12.0, y - 3.25, y + 1.05, -0.9, 0.9, 0.3, { color: RUBBER, mat: GM.RUBBER });
    P.swivel(gb, -9.6, y - 2.85, 0);
    P.swivel(gb, fwd - 2.0, y - 1.25, 0);
  }

  // ---- scout rifle: light bolt-action, green sporter stock, compact scope, folded bipod ----
  B.scout = (gb, L, sp, out) => {
    const stock = sp.accent;
    sporterStock(gb, 1.35, 10.2, { color: stock, w: 0.78 });
    const m = boltAction(gb, -1.2, 5.4, 1.35, 0.6, { color: sp.color });
    cylX(gb, 5.4, 21.4, 1.35, 0, 0.45, 0.33, { color: BLUED, mat: GM.STEEL, seg: 16 });
    P.muzzle(gb, 'brake', 21.4, 1.35, 0.34, 1.3);
    P.trigger(gb, -0.25, 0.05, { color: '#1a1b1c', len: 2.6, depth: 1.35 });
    P.scope(gb, -2.4, 7.4, 3.45, 0.6, { mount: 2.0 });
    P.bipod(gb, 9.2, 0.0, { len: 5.5 });
    rifleOut(out, { muzzle: [22.7, 1.35, 0], front: [7.5, -0.1, 0], eject: [2.0, 1.6, 0.9], magwell: [m.magX, m.magY, 0], bolt: 2.6, glow: '#9ad8ff' });
    out.pivots.bolt = [-1.4, 1.35, 0];
    out.boltAction = true;
  };

  /** A precision chassis: aluminium spine, skeleton stock with an adjustable cheek riser, M-LOK forend. */
  function chassis(gb, y, fwd, o = {}) {
    const col = o.color || '#2a2c2e';
    ext(gb, [[-2.2, y - 0.75], [fwd, y - 0.75], [fwd, y + 0.15], [-2.2, y + 0.15]], -0.75, 0.75, { color: col, mat: GM.ALLOY, bevel: 0.12 });
    P.mlok(gb, 5.6, fwd, y + 0.35, 0.95, { color: col });
    P.grip(gb, -0.35, y - 0.85, { color: '#1b1c1e', h: 3.6, rake: 0.75, w: 0.6 });
    P.trigger(gb, -0.2, y - 0.75, { color: col, len: 2.6, depth: 1.4 });
    // skeleton stock: top tube, lower tube, upright, cheek riser, adjustable butt
    P.extX(gb, P.rrect(0.42, y - 0.2, y + 0.55, 0.2), -10.5, -2.2, { color: col, mat: GM.ALLOY });
    ext(gb, [[-2.4, y - 0.2], [-3.6, y - 1.6], [-10.3, y - 2.9], [-10.3, y - 2.4], [-3.9, y - 1.1], [-2.6, y + 0.2]], -0.4, 0.4, { color: col, mat: GM.ALLOY, bevel: 0.08 });
    rbox(gb, -10.9, -10.2, y - 3.6, y + 0.9, -0.8, 0.8, 0.25, { color: col, mat: GM.ALLOY });
    rbox(gb, -11.6, -10.9, y - 3.6, y + 0.9, -0.85, 0.85, 0.3, { color: RUBBER, mat: GM.RUBBER });
    rbox(gb, -9.4, -4.2, y + 0.55, y + 1.25, -0.6, 0.6, 0.22, { color: o.cheek || '#1b1c1e', mat: GM.POLY });
    for (const x of [-8.5, -5.2]) cylX(gb, x - 0.12, x + 0.12, y + 0.55, 0, 0.16, 0.16, { at: [0, 0, 0], color: '#5a5c60', seg: 8 });
    cylX(gb, -7.4, -5.0, y - 2.45, 0, 0.18, 0.18, { color: '#18191a', seg: 8 });              // monopod
  }

  // ---- sniper rifle (remake): heavy bolt-action on a black precision chassis ----
  B.sniper = (gb, L, sp, out) => {
    chassis(gb, 1.8, 11.6, { color: '#262829' });
    const m = boltAction(gb, -1.6, 6.2, 1.8, 0.88, { color: sp.color });
    cylX(gb, 11.6, 26.0, 1.8, 0, 0.6, 0.48, { color: BLUED, mat: GM.STEEL, seg: 18 });
    if (!K.lite()) for (let k = 0; k < 6; k++) rbox(gb, 12.4, 24.6, -0.05, 0.05, -0.05, 0.05, 0.01, { color: '#080808', at: [0, 1.8 + Math.sin(k * 1.047) * 0.53, Math.cos(k * 1.047) * 0.53], seg: 1 });
    P.muzzle(gb, 'brake', 26.0, 1.8, 0.48, 2.2);
    P.scope(gb, -2.8, 10.8, 4.75, 0.92, { mount: 2.68 });
    P.bipod(gb, 10.6, 0.9, { len: 6.4 });
    rifleOut(out, { muzzle: [28.2, 1.8, 0], front: [8.6, 0.55, 0], eject: [2.2, 2.2, 1.0], magwell: [m.magX, m.magY, 0], bolt: 3.2, glow: '#9ad8ff' });
    out.pivots.bolt = [-1.8, 1.8, 0];
    out.boltAction = true;
  };

  // ---- magnum sniper: .338 bolt-action on an FDE chassis, a huge brake and scope with sunshade ----
  B.magsniper = (gb, L, sp, out) => {
    const fde = sp.color;
    chassis(gb, 1.9, 12.4, { color: fde, cheek: shadeHex(fde, -0.3) });
    const m = boltAction(gb, -1.8, 6.6, 1.9, 0.95, { color: '#242526' });
    cylX(gb, 12.4, 28.6, 1.9, 0, 0.68, 0.54, { color: '#2a2b2c', mat: GM.STEEL, seg: 18, fin: 'cerakote' });
    if (!K.lite()) for (let k = 0; k < 8; k++) rbox(gb, 13.2, 27.0, -0.05, 0.05, -0.05, 0.05, 0.01, { color: '#080808', at: [0, 1.9 + Math.sin(k * 0.785) * 0.6, Math.cos(k * 0.785) * 0.6], seg: 1 });
    P.muzzle(gb, 'brake', 28.6, 1.9, 0.6, 2.6, { color: '#1c1d1e' });
    P.scope(gb, -3.4, 12.0, 5.05, 1.02, { mount: 2.86 });
    latheX(gb, [[12.0, 1.45], [12.0, 1.62], [14.4, 1.62], [14.4, 1.5]], 5.05, 0, { color: '#141516', mat: GM.ALLOY, seg: 26 });     // sunshade
    P.bipod(gb, 11.4, 0.95, { len: 6.8 });
    rifleOut(out, { muzzle: [31.2, 1.9, 0], front: [9.0, 0.6, 0], eject: [2.4, 2.3, 1.05], magwell: [m.magX, m.magY, 0], bolt: 3.4, glow: '#9ad8ff' });
    out.pivots.bolt = [-2.0, 1.9, 0];
    out.boltAction = true;
  };

  // ---- semi-auto sniper: a big AR-pattern .308 with a long rail, a 20-round mag, a big scope ----
  B.autosniper = (gb, L, sp, out) => {
    const rec = sp.color, od = sp.accent;
    const [m0] = P.arLower(gb, { color: rec, magwell: 2.1 });
    P.arUpper(gb, 4.6, { color: rec });
    P.mlok(gb, 4.45, 16.4, 1.55, 1.02, { color: od, fin: 'anod_od' });
    cylX(gb, 16.4, 22.6, 1.55, 0, 0.4, 0.36, { color: BLUED, mat: GM.STEEL, seg: 16 });
    P.muzzle(gb, 'comp', 22.6, 1.55, 0.42, 1.8);
    P.scope(gb, -2.6, 10.0, 4.55, 0.84, { mount: 2.66 });
    P.grip(gb, -0.25, -0.15, { color: od, h: 3.9, rake: 1.0 });
    P.carbineStock(gb, -2.95, 1.55, { color: od });
    rbox(gb, -11.6, -6.6, 2.45, 3.15, -0.6, 0.6, 0.2, { color: shadeHex(od, -0.25), mat: GM.POLY });      // cheek riser
    P.mag(gb, m0 + 0.1, -1.3, 4.6, 0.35, { color: '#1c1d1e', w: 2.5, steel: true });
    P.bipod(gb, 15.2, 0.4, { len: 6.6 });
    rifleOut(out, { muzzle: [24.4, 1.55, 0], front: [10.6, 0.55, 0], magwell: [m0 + 1.25, -1.3, 0], bolt: 2.4, glow: '#9ad8ff' });
  };

  // ---- shotguns ----------------------------------------------------------------------------

  /** A tube-fed shotgun receiver, barrel (vent rib, bead) and magazine tube to `x1`. */
  function tubeShotgun(gb, x1, o = {}) {
    const steel = o.steel || '#25272a';
    ext(gb, [[-1.2, 0.0], [6.8, 0.0], [6.8, 2.2], [6.4, 2.5], [0.6, 2.55], [-1.2, 2.1]], -0.95, 0.95, { color: steel, mat: GM.STEEL, bevel: 0.18 });
    rbox(gb, 1.0, 4.6, 1.05, 2.15, 0.86, 0.99, 0.08, { color: '#080808' });                  // ejection port
    rbox(gb, 1.2, 4.4, -0.06, 0.22, -0.55, 0.55, 0.05, { color: '#090909' });                 // loading port
    if (!K.lite()) for (const s of [-1, 1]) rbox(gb, 1.0, 5.6, 0.6, 1.8, s * 0.97 - 0.02, s * 0.97 + 0.02, 0.05, { color: shadeHex(steel, 0.12), mat: GM.STEEL, wear: 2 });   // machined flats
    P.pin(gb, 0.4, 0.5, 0.96, 0.11);
    P.pin(gb, 5.6, 0.5, 0.96, 0.11);
    cylX(gb, 6.6, x1, 1.75, 0, 0.6, 0.56, { color: steel, mat: GM.STEEL, seg: 20 });
    cylX(gb, x1 - 0.04, x1 + 0.01, 1.75, 0, 0.44, 0.44, { color: '#030303', seg: 14 });
    if (o.rib !== false) {
      rbox(gb, 6.8, x1 - 0.3, 2.3, 2.45, -0.2, 0.2, 0.04, { color: DARK });
      if (!K.lite()) for (let x = 7.2; x < x1 - 0.6; x += 1.3) rbox(gb, x, x + 0.25, 2.2, 2.35, -0.12, 0.12, 0.02, { color: DARK, seg: 1 });
      sphere(gb, x1 - 0.35, 2.58, 0, 0.13, { color: BRASS, mat: GM.BRASS, seg: 8 });
    }
    const tubeEnd = o.tubeEnd ?? x1 - 2.4;
    cylX(gb, 6.6, tubeEnd, 0.72, 0, 0.5, 0.5, { color: shadeHex(steel, -0.05), mat: GM.STEEL, seg: 16 });
    latheX(gb, [[tubeEnd - 0.05, 0], [tubeEnd - 0.05, 0.56], [tubeEnd + 0.5, 0.56], [tubeEnd + 0.65, 0.4], [tubeEnd + 0.65, 0]], 0.72, 0, { color: STEEL, seg: 16 });
    rbox(gb, tubeEnd - 0.1, tubeEnd + 0.7, 0.6, 1.9, -0.25, 0.25, 0.1, { color: steel });         // barrel clamp
  }

  // ---- pump shotgun (remake): ribbed walnut pump, a classic stock with a grip wrist and pad ----
  B.shotgun = (gb, L, sp, out) => {
    const wood = '#6e4526';
    const x1 = 28.5;
    tubeShotgun(gb, x1, {});
    const Pm = { part: 'pump' };
    latheX(gb, [[11.0, 0], [11.0, 0.78], [11.15, 0.96], [17.6, 0.96], [17.75, 0.78], [17.75, 0]], 0.72, 0, { ...Pm, color: wood, mat: GM.WOOD, seg: 20 });
    if (!K.lite()) for (let k = 0; k < 8; k++) torusX(gb, 11.6 + k * 0.78, 0.72, 0, 0.96, 0.085, { ...Pm, color: shadeHex(wood, -0.28), mat: GM.WOOD, seg: 20 });
    cylX(gb, 6.8, 11.0, 1.15, -0.3, 0.06, 0.06, { ...Pm, color: STEEL, seg: 6 });            // action bars
    P.trigger(gb, 0.1, 0.05, { color: '#25272a', len: 2.8, mat: GM.STEEL });
    // classic stock: grip wrist, comb, heel, toe, a rubber pad; checkering on the wrist
    ext(gb, [[-1.0, 2.15], [-2.6, 1.95], [-4.4, 1.6], [-11.6, 2.0], [-11.9, 1.6], [-12.0, -2.6], [-11.4, -2.7], [-7.2, -1.55], [-3.9, -0.95], [-2.7, -2.5], [-1.9, -2.9], [-1.2, -2.7], [-0.7, -0.9], [-0.3, -0.1]],
      -0.88, 0.88, { color: wood, mat: GM.WOOD, bevel: 0.5, bevelSeg: 4 });
    rbox(gb, -12.65, -11.85, -2.75, 2.05, -0.92, 0.92, 0.3, { color: RUBBER, mat: GM.RUBBER });
    if (!K.lite()) for (const s of [-1, 1]) ext(gb, [[-0.9, -0.6], [-1.4, -2.3], [-2.3, -2.3], [-2.2, -0.8]], s * 0.9 - 0.04, s * 0.9 + 0.04, { color: shadeHex(wood, -0.12), mat: GM.WOOD, bevel: 0.02, fin: 'checker' });
    P.swivel(gb, -9.5, -2.25, 0);
    out.length = x1;
    out.muzzle = [x1, 1.75, 0];
    out.front = [14.4, -0.25, 0];
    out.eject = [2.8, 1.8, 1.0];
    out.magwell = [2.8, -0.1, 0];
    out.reload = 'shells';
    out.casing = 'shell';
    out.pivots.pump = [0, 0, 0];
  };

  // ---- combat shotgun: semi-auto tube-fed, pistol-grip polymer stock, ghost-ring sights ----
  B.combatsg = (gb, L, sp, out) => {
    const black = sp.color, x1 = 25.0;
    tubeShotgun(gb, x1, { steel: '#202224', rib: false, tubeEnd: x1 - 0.8 });
    rail(gb, -0.8, 6.4, 2.5, 0, 0.9, { color: '#161718' });
    // ghost-ring rear sight with protective ears, a front post on the barrel
    ext(gb, [[0.2, 2.86], [1.4, 2.86], [1.35, 3.9], [1.0, 4.1], [0.6, 4.1], [0.25, 3.9]], -0.55, 0.55, { color: '#141516', mat: GM.STEEL, bevel: 0.05, fin: 'sight',
      holes: [[[0.5, 3.2], [1.1, 3.2], [1.05, 3.75], [0.55, 3.75]]] });
    P.frontSightA(gb, x1 - 1.2, 2.3, { dotColor: '#ff6a2a' });
    // a polymer forend round the tube (charging handle on the bolt, right side)
    P.extX(gb, P.rrect(0.95, -0.15, 1.45, 0.45), 7.0, 14.5, { color: black, mat: GM.POLY, bevel: 0.15 });
    if (!K.lite()) P.slots(gb, 7.8, 14.0, 0.25, 0.85, 0.96, 5, { fill: 0.55 });
    rbox(gb, 3.6, 4.4, 1.3, 1.75, 0.95, 1.6, 0.12, { part: 'bolt', color: '#3a3c3f', mat: GM.STEEL });
    P.trigger(gb, 0.1, 0.0, { color: '#1c1d1f', len: 2.8 });
    P.grip(gb, -0.4, 0.1, { color: black, h: 3.8, rake: 0.9 });
    P.carbineStock(gb, -1.2, 1.4, { color: black });
    out.length = x1;
    out.muzzle = [x1, 1.75, 0];
    out.front = [10.8, -0.2, 0];
    out.eject = [2.8, 1.8, 1.0];
    out.magwell = [2.8, -0.1, 0];
    out.reload = 'single';
    out.shellLoad = true;
    out.casing = 'shell';
    out.travel.bolt = 1.6;
  };

  // ---- box-magazine shotgun: AK-pattern action, a 10-round box magazine, a muzzle brake ----
  B.boxsg = (gb, L, sp, out) => {
    const od = sp.color, steel = '#262728';
    ext(gb, [[-2.3, -0.3], [6.6, -0.3], [6.7, 0.1], [6.7, 1.6], [-2.3, 1.6]], -0.8, 0.8, { color: steel, mat: GM.STEEL, bevel: 0.08 });
    P.extX(gb, [[-0.82, 1.5], [0.82, 1.5], [0.82, 1.8], [0.55, 2.2], [-0.55, 2.2], [-0.82, 1.8]], -1.9, 6.1, { color: shadeHex(steel, 0.05), mat: GM.STEEL, bevel: 0.06 });
    rail(gb, -1.6, 5.6, 2.2, 0, 0.88, { color: '#151617' });
    for (const [x, y] of [[-1.7, 0.2], [5.6, 0.3], [5.95, 1.15], [2.6, -0.05]]) P.pin(gb, x, y, 0.81, 0.09, { color: '#3a3b3c' });
    ext(gb, [[-1.8, 1.45], [4.6, 1.2], [4.6, 0.95], [-1.6, 1.12]], 0.8, 0.94, { color: '#1d1e1f', mat: GM.STEEL, bevel: 0.03 });
    rbox(gb, 4.1, 4.8, 1.25, 1.6, 0.8, 1.6, 0.12, { part: 'bolt', color: '#3a3b3d', mat: GM.STEEL });
    // a fat barrel in a polymer quad-rail forend, a big brake
    cylX(gb, 6.6, 20.6, 1.0, 0, 0.55, 0.5, { color: steel, mat: GM.STEEL, seg: 18 });
    P.extX(gb, P.rrect(1.0, 0.05, 1.95, 0.35), 6.8, 13.6, { color: od, mat: GM.POLY, bevel: 0.14 });
    rail(gb, 7.0, 13.4, 1.95, 0, 0.8, { color: '#151617' });
    if (!K.lite()) P.slots(gb, 7.6, 13.0, 0.6, 1.4, 1.01, 4, { fill: 0.55 });
    P.muzzle(gb, 'brake', 20.6, 1.0, 0.6, 1.9, { color: '#1a1b1c' });
    P.frontSightA(gb, 19.3, 1.5, {});
    P.rearSight(gb, 5.2, 2.56);
    ext(gb, [[-0.5, -0.25], [2.6, -0.25], [2.6, -0.5], [2.3, -1.3], [-0.1, -1.3], [-0.5, -0.65]], -0.22, 0.22, { color: steel, mat: GM.STEEL, bevel: 0.05,
      holes: [[[-0.15, -0.47], [2.3, -0.47], [2.05, -1.05], [0.1, -1.05]]] });
    ext(gb, [[0.95, -0.3], [1.2, -0.3], [1.05, -0.8], [0.85, -1.0], [0.7, -0.95], [0.95, -0.55]], -0.12, 0.12, { color: '#4a4c50', mat: GM.STEEL, bevel: 0.03 });
    P.grip(gb, -0.3, -0.25, { color: od, h: 3.7, rake: 1.1, w: 0.6 });
    // the 10-round box magazine: wide (shells side by side), nearly straight
    const M = { part: 'mag' };
    ext(gb, [[2.6, -0.2], [5.9, -0.2], [6.1, -3.6], [6.3, -4.9], [2.9, -5.1], [2.7, -3.6]], -0.62, 0.62, { ...M, color: '#1d1e1f', mat: GM.POLY, bevel: 0.14 });
    if (!K.lite()) for (let k = 0; k < 3; k++) rbox(gb, 3.0, 5.9, -1.4 - k * 1.1, -1.25 - k * 1.1, -0.67, 0.67, 0.04, { ...M, color: '#141516', seg: 1 });
    rbox(gb, 2.7, 6.5, -5.4, -4.95, -0.7, 0.7, 0.14, { ...M, color: '#141516', mat: GM.POLY });
    cylX(gb, 3.0, 5.6, -0.05, 0, 0.38, 0.38, { ...M, color: '#b02a1e', mat: GM.PAINT, seg: 12 });     // the top shell
    P.carbineStock(gb, -2.3, 1.2, { color: od });
    out.length = 22.5;
    out.muzzle = [22.5, 1.0, 0];
    out.front = [10.2, 0.05, 0];
    out.eject = [3.0, 1.45, 1.0];
    out.magwell = [4.4, -0.5, 0];
    out.casing = 'shell';
    out.travel.bolt = 2.6;
  };

  void dot; void torusX; void STEEL;
}
