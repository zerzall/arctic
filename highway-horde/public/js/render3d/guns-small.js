// Pistols and SMGs for actor-guns.js, assembled from guns-parts.js: the M9 (remade), the compact
// 9mm, the suppressed .45, the .50 hand cannon, the machine pistol, the micro SMG (remade), the
// compact roller-locked SMG, the bullpup PDW with its top magazine and the .45 SMG. Handguns are
// drawn about 1.2x real size (they sit in one hand close to the eye and read small otherwise).
// The slide is part 'slide' (it recoils and locks back on an empty magazine), the hammer
// 'hammer', the magazine 'mag', a suppressor 'silencer'.

import { gunParts } from './guns-parts.js';

/**
 * Register the builders.
 * @param {object} B the BUILDERS table of actor-guns.js (style → builder)
 * @param {object} K the kit (actor-guns.js)
 */
export function installSmallArms(B, K) {
  const P = gunParts(K);
  const { THREE, GM, ext, rbox, cylX, latheX, sphere, torusX, rail, dot, shadeHex } = K;
  const { DARK, BRASS, RUBBER, STEEL } = K.C;
  const HALF_PI = Math.PI / 2;

  /** A pistol's `out` fields. */
  function handgunOut(out, o) {
    out.length = o.muzzle[0];
    out.muzzle = o.muzzle;
    out.front = [0.2, -2.2, -1.2];
    out.eject = o.eject;
    out.magwell = o.magwell;
    out.twoHanded = false;
    out.travel.slide = o.slide ?? 1.5;
    out.casing = 'pistol';
    out.glowColor = o.glow || '#6dff8a';
  }

  /**
   * A pistol slide from x0 to x1 (bore at y = y0 + h * 0.5): bevelled top edges, rear (and
   * optional front) serrations, the ejection port on the right, sights with glowing inserts.
   */
  function slide(gb, x0, x1, y0, h, hz, o = {}) {
    const S = { part: 'slide' };
    const col = o.color || '#202124';
    const y1 = y0 + h;
    P.extX(gb, [[-hz, y0], [hz, y0], [hz, y1 - 0.32], [hz - 0.2, y1], [-hz + 0.2, y1], [-hz, y1 - 0.32]], x0, x1, { ...S, color: col, mat: o.mat ?? GM.STEEL, bevel: 0.1 });
    // front of the slide chamfered down to the muzzle
    if (!K.lite()) {
      for (let k = 0; k < (o.serr ?? 8); k++) {
        const x = x0 + 0.3 + k * 0.24;
        for (const s of [-1, 1]) rbox(gb, x, x + 0.1, y0 + 0.2, y1 - 0.25, s * (hz + 0.07) - 0.035, s * (hz + 0.07) + 0.035, 0.02, { ...S, color: shadeHex(col, -0.35), seg: 1 });
      }
      if (o.front) for (let k = 0; k < 5; k++) {
        const x = x1 - 2.2 + k * 0.24;
        for (const s of [-1, 1]) rbox(gb, x, x + 0.1, y0 + 0.3, y1 - 0.3, s * (hz + 0.07) - 0.035, s * (hz + 0.07) + 0.035, 0.02, { ...S, color: shadeHex(col, -0.35), seg: 1 });
      }
    }
    // ejection port (right) with the barrel's hood inside
    rbox(gb, x0 + 2.6, x0 + 4.8, y0 + 0.55, y1 + 0.02, hz - 0.02, hz + 0.1, 0.05, { ...S, color: '#070708' });
    rbox(gb, x0 + 2.8, x0 + 4.6, y0 + 0.6, y1 - 0.12, hz - 0.08, hz + 0.05, 0.04, { ...S, color: o.hood || '#8a8d91', mat: GM.STEEL });
    // sights: a dovetailed rear with two dots, a front post with one
    rbox(gb, x0 + 0.15, x0 + 0.75, y1, y1 + 0.42, -hz + 0.05, hz - 0.05, 0.06, { ...S, color: DARK, fin: 'sight' });
    rbox(gb, x0 + 0.2, x0 + 0.7, y1 + 0.18, y1 + 0.45, -0.07, 0.07, 0.01, { ...S, color: '#050505', seg: 1 });
    rbox(gb, x1 - 0.75, x1 - 0.3, y1, y1 + 0.4, -0.12, 0.12, 0.04, { ...S, color: DARK, fin: 'sight' });
    const g = o.glow || '#6dff8a';
    dot(gb, x1 - 0.76, y1 + 0.3, 0, 0.075, g, 'slide');
    dot(gb, x0 + 0.14, y1 + 0.33, -0.2, 0.065, g, 'slide');
    dot(gb, x0 + 0.14, y1 + 0.33, 0.2, 0.065, g, 'slide');
    // the muzzle: the barrel's crown in the slide's nose
    cylX(gb, x1 - 0.05, x1 + 0.05, y0 + h * 0.48, 0, 0.3, 0.3, { ...S, color: '#141516', seg: 14 });
    cylX(gb, x1 + 0.04, x1 + 0.07, y0 + h * 0.48, 0, 0.17, 0.17, { ...S, color: '#020202', seg: 10 });
  }

  /**
   * A polymer / alloy pistol frame: the dust cover with an accessory rail, a squared trigger
   * guard, the grip with stippled or checkered panels and finger grooves, a beavertail, the
   * slide stop and take-down lever on the left, the magazine release.
   */
  function frame(gb, xb, xf, o = {}) {
    const col = o.color || '#1c1d1f', top = 0.75;
    const mat = o.mat ?? GM.POLY;
    // dust cover + trigger guard in one piece
    ext(gb, [[xb + 0.2, top], [xf, top], [xf, 0.05], [xf - 0.35, -0.15], [3.35, -0.15], [3.15, -1.35], [2.75, -1.6], [0.55, -1.6], [0.15, -1.2], [0.05, 0.0], [xb + 0.6, 0.05]],
      -0.48, 0.48, { color: col, mat, bevel: 0.1, holes: [[[0.5, -0.12], [2.85, -0.12], [2.75, -1.25], [0.7, -1.25], [0.45, -1.0]]] });
    if (o.rail !== false) rail(gb, 3.6, xf - 0.25, -0.38, 0, 0.6, { color: shadeHex(col, -0.05), mat, rot: [Math.PI, 0, 0] });
    // trigger
    ext(gb, [[1.35, 0.0], [1.65, 0.0], [1.5, -0.6], [1.3, -1.0], [1.1, -0.95], [1.3, -0.5]], -0.12, 0.12, { color: '#3a3c3f', mat: GM.STEEL, bevel: 0.03 });
    // the grip: raked, a beavertail at the top, a slight palm swell, finger grooves on the front strap
    const h = o.h ?? 4.3, rake = o.rake ?? 0.75, w = o.w ?? 0.62;
    const b = top - h;
    ext(gb, [[0.25, 0.1], [0.12, -0.6], [0.3 - rake * 0.2, -1.1], [0.05 - rake * 0.4, -1.6], [0.25 - rake * 0.55, -2.15], [-0.02 - rake * 0.75, -2.7], [0.1 - rake * 0.85, -3.2], [-0.1 - rake, b + 0.25],
      [-0.25 - rake, b], [-2.0 - rake, b], [-2.1 - rake, b + 0.3], [-1.85 - rake * 0.5, -1.5], [-1.6, -0.1], [-1.95, 0.55], [-2.05, top + 0.15], [xb + 0.25, top + 0.1], [-0.6, top]],
    -w, w, { color: col, mat, bevel: 0.2, bevelSeg: 3 });
    if (!K.lite()) for (const s of [-1, 1]) {
      ext(gb, [[-0.15 - rake * 0.2, -0.75], [-0.35 - rake * 0.95, b + 0.45], [-1.65 - rake * 0.9, b + 0.45], [-1.45 - rake * 0.2, -0.65]], s * (w + 0.06) - 0.06, s * (w + 0.06) + 0.06,
        { color: o.panel || shadeHex(col, -0.06), mat: o.panelMat ?? mat, bevel: 0.04, fin: o.panelFin });
    }
    // slide stop (left), take-down lever (left), magazine release (left, behind the guard)
    ext(gb, [[0.6, 0.45], [2.7, 0.55], [2.75, 0.85], [0.6, 0.8]], -0.66, -0.48, { color: DARK, mat: GM.STEEL, bevel: 0.03 });
    rbox(gb, 3.1, 3.5, 0.1, 0.55, -0.64, -0.48, 0.05, { color: DARK, mat: GM.STEEL });
    rbox(gb, -0.1, 0.35, -0.55, -0.15, -0.66, 0.66, 0.08, { color: shadeHex(col, -0.1), mat });
    P.pin(gb, 2.2, -0.05, 0.5, 0.07);
    return { bottom: b, rake };
  }

  // ---- M9 (remake): the open-top slide over an exposed barrel, a hammer, wood-look panels ----
  B.pistol = (gb, L, sp, out) => {
    const col = '#1e1f22';
    const xb = -1.75, xf = 6.6;
    const f = frame(gb, xb, xf, { color: '#232427', mat: GM.ALLOY, rail: false, panel: '#2c2a28', panelMat: GM.POLY, h: 4.35, rake: 0.8, w: 0.66 });
    // the open-top slide: two side walls joined at the back and round the muzzle, the barrel in between
    const S = { part: 'slide' };
    const y0 = 0.72, h = 1.32;
    P.extX(gb, P.rrect(0.46, y0, y0 + h - 0.1, 0.18), xb, xb + 3.3, { ...S, color: col, mat: GM.STEEL, bevel: 0.1 });
    P.extX(gb, P.rrect(0.46, y0, y0 + 0.95, 0.18), xb + 3.3, xf + 0.25, { ...S, color: col, mat: GM.STEEL, bevel: 0.1 });
    for (const s of [-1, 1]) P.extX(gb, P.rrect(0.1, y0 + 0.8, y0 + h - 0.12, 0.05, s * 0.38), xb + 3.3, xf - 1.6, { ...S, color: col, mat: GM.STEEL, bevel: 0.05 });
    P.extX(gb, P.rrect(0.46, y0 + 0.75, y0 + h - 0.1, 0.18), xf - 1.6, xf + 0.25, { ...S, color: col, mat: GM.STEEL, bevel: 0.1 });
    cylX(gb, xb + 3.0, xf - 1.5, y0 + 0.95, 0, 0.3, 0.3, { ...S, color: '#8d9095', mat: GM.STEEL, seg: 14 });          // exposed barrel
    if (!K.lite()) for (let k = 0; k < 7; k++) {
      const x = xb + 0.35 + k * 0.26;
      for (const s of [-1, 1]) rbox(gb, x, x + 0.1, y0 + 0.2, y0 + h - 0.3, s * 0.54 - 0.035, s * 0.54 + 0.035, 0.02, { ...S, color: '#0c0c0d', seg: 1 });
    }
    // the slide-mounted safety / decocker levers, the sights, the muzzle
    for (const s of [-1, 1]) ext(gb, [[xb + 0.4, y0 + 0.75], [xb + 1.3, y0 + 0.75], [xb + 1.3, y0 + 1.05], [xb + 0.4, y0 + 1.1]], s * 0.5 - 0.09, s * 0.5 + 0.09, { ...S, color: DARK, mat: GM.STEEL, bevel: 0.04 });
    rbox(gb, xb + 0.15, xb + 0.75, y0 + h - 0.12, y0 + h + 0.32, -0.4, 0.4, 0.06, { ...S, color: DARK, fin: 'sight' });
    rbox(gb, xf - 0.65, xf - 0.25, y0 + h - 0.15, y0 + h + 0.25, -0.11, 0.11, 0.04, { ...S, color: DARK, fin: 'sight' });
    dot(gb, xf - 0.66, y0 + h + 0.15, 0, 0.07, '#6dff8a', 'slide');
    dot(gb, xb + 0.14, y0 + h + 0.2, -0.2, 0.06, '#6dff8a', 'slide');
    dot(gb, xb + 0.14, y0 + h + 0.2, 0.2, 0.06, '#6dff8a', 'slide');
    cylX(gb, xf + 0.2, xf + 0.32, y0 + 0.5, 0, 0.27, 0.27, { ...S, color: '#141516', seg: 14 });
    cylX(gb, xf + 0.31, xf + 0.34, y0 + 0.5, 0, 0.16, 0.16, { ...S, color: '#020202', seg: 10 });
    // hammer
    ext(gb, [[xb + 0.1, 0.8], [xb + 0.25, 1.55], [xb - 0.3, 1.85], [xb - 0.5, 1.6], [xb - 0.2, 0.9]], -0.2, 0.2, { part: 'hammer', color: DARK, bevel: 0.05 });
    // magazine: its base plate under the grip
    P.stickMag(gb, -1.55 - f.rake * 0.6, -0.3, 3.9, { w: 1.25, hz: 0.38, rake: f.rake * 0.35, color: '#2a2b2d', base: '#18191a' });
    out.pivots.hammer = [xb + 0.05, 0.85, 0];
    handgunOut(out, { muzzle: [xf + 0.35, y0 + 0.5, 0], eject: [xb + 4.0, y0 + 1.25, 0.55], magwell: [-1.6, -4.0, 0], slide: 1.6 });
  };

  // ---- compact 9mm: a blocky polymer striker pistol, no hammer, a finger-groove grip ----
  B.compact = (gb, L, sp, out) => {
    const xb = -1.55, xf = 5.65;
    const f = frame(gb, xb, xf, { color: sp.color, h: 4.0, rake: 0.7, w: 0.6 });
    slide(gb, xb, xf + 0.1, 0.72, 1.25, 0.48, { color: '#1e1f21', serr: 7, glow: '#ffffff' });
    P.stickMag(gb, -1.5 - f.rake * 0.55, -0.3, 3.6, { w: 1.2, hz: 0.36, rake: f.rake * 0.35, color: '#1a1b1c', mat: GM.POLY });
    // the selector for the burst mode, on the left of the slide's rear
    rbox(gb, -0.5, 0.0, 0.25, 0.55, -0.68, -0.5, 0.05, { color: '#3a3c3f', mat: GM.STEEL });
    handgunOut(out, { muzzle: [xf + 0.17, 0.72 + 0.6, 0], eject: [xb + 3.8, 1.75, 0.55], magwell: [-1.5, -3.6, 0], slide: 1.45, glow: '#ffffff' });
  };

  // ---- tactical .45: a long slide, a hammer, an accessory rail and a screw-on suppressor ----
  B.tac45 = (gb, L, sp, out) => {
    const xb = -1.75, xf = 6.7;
    const f = frame(gb, xb, xf, { color: '#1d1e20', h: 4.3, rake: 0.75, w: 0.64 });
    slide(gb, xb, xf, 0.72, 1.35, 0.5, { color: sp.color, serr: 8, front: true, glow: '#ffd24a' });
    cylX(gb, xf - 0.02, xf + 0.7, 0.72 + 0.65, 0, 0.26, 0.26, { color: '#2a2b2d', seg: 14 });            // threaded barrel
    if (!K.lite()) for (let k = 0; k < 4; k++) torusX(gb, xf + 0.15 + k * 0.14, 0.72 + 0.65, 0, 0.26, 0.03, { color: '#1a1b1c', seg: 12 });
    P.suppressor(gb, xf + 0.55, 0.72 + 0.65, 0.56, 6.2, { color: sp.accent });
    ext(gb, [[xb + 0.15, 0.8], [xb + 0.3, 1.5], [xb - 0.25, 1.82], [xb - 0.45, 1.55], [xb - 0.15, 0.9]], -0.2, 0.2, { part: 'hammer', color: DARK, bevel: 0.05 });
    P.stickMag(gb, -1.6 - f.rake * 0.6, -0.3, 3.9, { w: 1.3, hz: 0.4, rake: f.rake * 0.35, color: '#1e1f20', base: '#151617' });
    out.pivots.hammer = [xb + 0.05, 0.85, 0];
    handgunOut(out, { muzzle: [xf + 6.75, 1.37, 0], eject: [xb + 3.9, 1.8, 0.55], magwell: [-1.6, -3.9, 0], slide: 1.6, glow: '#ffd24a' });
    out.muzzleBare = [xf + 0.72, 1.37, 0];
  };

  // ---- hand cannon: a heavy stainless .50 with a ported compensator and a top rib ----
  B.handcannon = (gb, L, sp, out) => {
    const xb = -1.9, xf = 7.4;
    const ss = sp.color;
    const f = frame(gb, xb, xf - 0.6, { color: shadeHex(ss, -0.05), mat: GM.STEEL, rail: true, panel: '#1c1c1c', panelMat: GM.RUBBER, h: 4.5, rake: 0.85, w: 0.74 });
    slide(gb, xb, xf - 0.3, 0.75, 1.55, 0.58, { color: ss, serr: 9, glow: '#ff7a3a', hood: '#bfc3c7' });
    // top rib with lightening cuts over the slide, the compensator at the nose
    rbox(gb, xb + 1.4, xf - 0.5, 2.28, 2.52, -0.3, 0.3, 0.06, { part: 'slide', color: shadeHex(ss, -0.15), mat: GM.STEEL });
    if (!K.lite()) for (let k = 0; k < 5; k++) rbox(gb, xb + 2.0 + k * 1.05, xb + 2.55 + k * 1.05, 2.3, 2.54, -0.32, 0.32, 0.03, { part: 'slide', color: '#0a0a0b', seg: 1 });
    P.muzzle(gb, 'comp', xf - 0.32, 1.52, 0.42, 1.5, { color: shadeHex(ss, -0.12), part: 'slide' });
    ext(gb, [[xb + 0.15, 0.82], [xb + 0.3, 1.6], [xb - 0.3, 1.95], [xb - 0.52, 1.66], [xb - 0.18, 0.92]], -0.22, 0.22, { part: 'hammer', color: '#2a2b2d', bevel: 0.05 });
    P.stickMag(gb, -1.75 - f.rake * 0.6, -0.3, 4.0, { w: 1.45, hz: 0.45, rake: f.rake * 0.35, color: '#2c2d2f', base: '#1a1a1b' });
    out.pivots.hammer = [xb + 0.05, 0.88, 0];
    handgunOut(out, { muzzle: [xf + 1.2, 1.52, 0], eject: [xb + 4.2, 2.0, 0.65], magwell: [-1.8, -4.1, 0], slide: 1.9, glow: '#ff7a3a' });
  };

  // ---- machine pistol: an extended 20-round magazine, a compensator, a folding front grip ----
  B.mpistol = (gb, L, sp, out) => {
    const xb = -1.6, xf = 5.9;
    const f = frame(gb, xb, xf, { color: sp.color, h: 4.1, rake: 0.7, w: 0.6 });
    slide(gb, xb, xf, 0.72, 1.28, 0.48, { color: '#1c1d1f', serr: 7, glow: '#ff5a3a' });
    P.muzzle(gb, 'comp', xf, 0.72 + 0.62, 0.3, 1.1, { color: '#121314' });
    // the folding front grip under the dust cover (folded forward)
    rbox(gb, 3.9, 5.8, -0.6, -0.25, -0.35, 0.35, 0.1, { color: '#141516', mat: GM.POLY });
    rbox(gb, 4.1, 5.7, -0.95, -0.55, -0.3, 0.3, 0.12, { color: '#1b1c1d', mat: GM.POLY });
    // the selector switch (full-auto) on the left of the slide
    rbox(gb, -1.1, -0.5, 1.15, 1.5, -0.62, -0.46, 0.05, { color: '#c62828', mat: GM.PAINT });
    // extended magazine: a long stick out of the grip with a pinkie extension
    P.stickMag(gb, -1.5 - f.rake * 0.55, -0.3, 6.2, { w: 1.2, hz: 0.36, rake: f.rake * 0.55, color: '#1a1b1c', mat: GM.STEEL, base: '#121314' });
    out.front = [0.2, -2.2, -1.2];
    handgunOut(out, { muzzle: [xf + 1.1, 1.34, 0], eject: [xb + 3.8, 1.75, 0.55], magwell: [-1.5, -4.5, 0], slide: 1.35, glow: '#ff5a3a' });
  };

  // ---- SMGs ----------------------------------------------------------------------------------

  /** An SMG's `out` fields (two-handed, pistol-calibre casings). */
  function smgOut(out, o) {
    out.length = o.muzzle[0];
    out.muzzle = o.muzzle;
    out.front = o.front;
    out.eject = o.eject;
    out.magwell = o.magwell;
    out.travel.bolt = o.bolt ?? 1.2;
    out.casing = 'pistol';
    if (o.glow) out.glowColor = o.glow;
  }

  /** A folding / telescoping wire stock: two rods and a butt plate. */
  function wireStock(gb, x0, y, len, o = {}) {
    for (const z of [-0.5, 0.5]) cylX(gb, x0 - len, x0, y, z, 0.16, 0.16, { color: DARK, mat: GM.STEEL, seg: 10 });
    rbox(gb, x0 - len - 0.5, x0 - len + 0.1, y - 2.8, y + 0.5, -0.7, 0.7, 0.22, { color: o.pad || DARK, mat: GM.RUBBER });
    cylX(gb, x0 - len - 0.1, x0 - len + 0.4, y - 2.3, 0, 0.14, 0.14, { color: DARK, seg: 8 });
  }

  // ---- micro SMG (remake): a stamped box receiver, the magazine in the grip, a folded stock ----
  B.smg = (gb, L, sp, out) => {
    const col = '#202123';
    // receiver: a box with a grooved top cover, the cocking knob on top (part 'bolt')
    P.extX(gb, P.rrect(0.72, -0.25, 1.75, 0.22), -2.0, 6.4, { color: col, mat: GM.STEEL, bevel: 0.1 });
    P.extX(gb, P.rrect(0.62, 1.7, 2.15, 0.15), -1.6, 5.9, { color: shadeHex(col, 0.08), mat: GM.STEEL, bevel: 0.06 });
    if (!K.lite()) for (let k = 0; k < 7; k++) rbox(gb, -0.9 + k * 0.85, -0.55 + k * 0.85, 2.12, 2.24, -0.55, 0.55, 0.04, { color: '#0d0d0e', seg: 1 });
    rbox(gb, 1.6, 2.6, 2.2, 2.7, -0.22, 0.22, 0.1, { part: 'bolt', color: '#2e3033', mat: GM.STEEL });
    rbox(gb, 0.4, 3.9, 0.55, 1.35, 0.78, 0.86, 0.05, { color: '#070708' });                    // ejection port
    // rear and front sights (aperture and hooded post), the short barrel with a thread protector
    ext(gb, [[-1.85, 2.1], [-0.95, 2.1], [-1.0, 2.75], [-1.8, 2.75]], -0.42, 0.42, { color: DARK, bevel: 0.05, fin: 'sight', holes: [[[-1.6, 2.3], [-1.2, 2.3], [-1.22, 2.6], [-1.58, 2.6]]] });
    ext(gb, [[5.3, 2.1], [6.1, 2.1], [6.0, 2.85], [5.4, 2.85]], -0.4, 0.4, { color: DARK, bevel: 0.05, fin: 'sight', holes: [[[5.5, 2.25], [5.9, 2.25], [5.85, 2.7], [5.55, 2.7]]] });
    rbox(gb, 5.66, 5.74, 2.15, 2.6, -0.04, 0.04, 0.01, { color: '#0c0c0c', seg: 1 });
    cylX(gb, 6.4, 8.0, 0.75, 0, 0.32, 0.3, { color: '#1a1b1c', seg: 14 });
    cylX(gb, 7.6, 8.3, 0.75, 0, 0.38, 0.38, { color: '#111213', seg: 14, fin: 'knurl' });
    cylX(gb, 8.29, 8.32, 0.75, 0, 0.2, 0.2, { color: '#020202', seg: 10 });
    // a strap under the front as the support hand's grip
    rbox(gb, 4.2, 5.8, -0.55, -0.25, -0.45, 0.45, 0.1, { color: '#2a2622', mat: GM.RUBBER });
    // pistol grip with the magazine through it, the trigger guard
    P.trigger(gb, 0.0, -0.25, { color: col, len: 2.7, depth: 1.45, mat: GM.STEEL });
    ext(gb, [[0.6, -0.2], [0.35, -1.2], [0.1, -3.8], [-1.75, -3.8], [-1.5, -1.2], [-1.6, -0.2]], -0.6, 0.6, { color: '#1b1c1e', mat: GM.POLY, bevel: 0.18, bevelSeg: 3 });
    if (!K.lite()) for (const s of [-1, 1]) ext(gb, [[0.2, -0.6], [0.0, -3.4], [-1.45, -3.4], [-1.25, -0.6]], s * 0.66 - 0.05, s * 0.66 + 0.05, { color: '#141516', mat: GM.POLY, bevel: 0.03 });
    P.stickMag(gb, -1.35, -0.6, 4.6, { w: 1.3, hz: 0.42, rake: 0.25, color: '#1a1b1c' });
    // the wire stock folded along the right side
    for (const y of [0.25, 1.25]) cylX(gb, -2.0, 4.0, y, 0.95, 0.12, 0.12, { color: DARK, mat: GM.STEEL, seg: 8 });
    rbox(gb, 3.8, 4.3, -0.2, 1.7, 0.8, 1.15, 0.12, { color: DARK, mat: GM.RUBBER });
    smgOut(out, { muzzle: [8.32, 0.75, 0], front: [5.0, -0.25, 0], eject: [2.0, 1.2, 0.95], magwell: [-0.75, -4.6, 0], bolt: 1.0 });
    out.travel.bolt = 1.0;
  };

  // ---- compact SMG: a roller-locked receiver tube, a curved magazine, drum sight, slim stock ----
  B.csmg = (gb, L, sp, out) => {
    const col = sp.color;
    // receiver: a stamped body with the cocking tube above the barrel line
    ext(gb, [[-2.2, -0.25], [6.0, -0.25], [6.0, 1.75], [-2.2, 1.75]], -0.66, 0.66, { color: col, mat: GM.STEEL, bevel: 0.12 });
    P.extX(gb, P.rrect(0.58, 1.5, 2.3, 0.3), -2.0, 9.6, { color: shadeHex(col, 0.06), mat: GM.STEEL, bevel: 0.08 });
    rbox(gb, 6.9, 7.8, 2.0, 2.45, 0.45, 1.05, 0.1, { part: 'bolt', color: '#2a2c2e', mat: GM.STEEL });     // cocking handle (left-forward)
    rbox(gb, 0.6, 3.4, 0.45, 1.35, 0.68, 0.76, 0.05, { color: '#070708' });
    // the slim handguard, the barrel with its three lugs, a front sight hood
    P.extX(gb, P.rrect(0.75, -0.1, 1.45, 0.4), 6.0, 10.4, { color: '#1a1b1c', mat: GM.POLY, bevel: 0.12 });
    if (!K.lite()) P.slots(gb, 6.6, 10.0, 0.25, 0.95, 0.81, 4, { fill: 0.5 });
    cylX(gb, 10.4, 11.8, 0.75, 0, 0.3, 0.3, { color: '#151617', seg: 14 });
    if (!K.lite()) for (let k = 0; k < 3; k++) rbox(gb, 11.0, 11.6, -0.06, 0.06, -0.1, 0.1, 0.02, { color: '#1c1d1e', at: [0, 0.75 + Math.sin(k * 2.094) * 0.33, Math.cos(k * 2.094) * 0.33], seg: 1 });
    cylX(gb, 11.78, 11.82, 0.75, 0, 0.18, 0.18, { color: '#020202', seg: 10 });
    latheX(gb, [[9.2, 0], [9.2, 0.42], [9.9, 0.42], [9.9, 0]], 2.65, 0, { color: DARK, seg: 14 });               // front sight hood
    rbox(gb, 9.5, 9.6, 2.35, 2.85, -0.04, 0.04, 0.01, { color: '#0c0c0c', seg: 1 });
    // the rotary drum rear sight
    cylX(gb, -1.6, -0.9, 2.65, 0, 0.42, 0.42, { color: DARK, seg: 12, fin: 'knurl' });
    rbox(gb, -1.7, -0.8, 2.3, 2.45, -0.4, 0.4, 0.05, { color: DARK });
    // grip and trigger group (one moulding), the curved magazine ahead of it
    P.trigger(gb, 0.0, -0.25, { color: '#1b1c1e', len: 2.7, depth: 1.45, mat: GM.POLY });
    P.grip(gb, -0.25, -0.15, { color: '#1b1c1e', h: 3.7, rake: 0.75 });
    rbox(gb, 3.1, 5.6, -0.65, -0.2, -0.62, 0.62, 0.12, { color: col, mat: GM.STEEL });            // magwell
    P.mag(gb, 3.3, -0.55, 4.6, 1.6, { color: '#1c1d1e', steel: true, w: 1.95, hz: 0.42, round: false });
    // retractable stock: two rails into the receiver, a butt pad
    for (const z of [-0.45, 0.45]) cylX(gb, -6.6, -2.2, 1.2, z, 0.18, 0.18, { color: DARK, mat: GM.STEEL, seg: 10 });
    rbox(gb, -7.2, -6.5, -1.6, 1.9, -0.72, 0.72, 0.25, { color: RUBBER, mat: GM.RUBBER });
    smgOut(out, { muzzle: [11.82, 0.75, 0], front: [8.2, -0.1, 0], eject: [2.0, 1.0, 0.85], magwell: [4.3, -0.6, 0], bolt: 1.3 });
  };

  // ---- bullpup PDW: an angular shell with a thumbhole grip, the 50-round magazine along the top ----
  B.pdw = (gb, L, sp, out) => {
    const shell = sp.color, dark = '#18191a';
    // the shell: butt, body, the thumbhole and trigger guard in one moulding
    ext(gb, [[-8.6, 1.6], [-7.8, 2.0], [4.8, 2.0], [6.4, 1.4], [6.6, 0.3], [5.6, -0.4], [3.0, -0.4], [2.6, -1.6], [2.2, -3.2], [1.5, -3.7], [-1.4, -3.7],
      [-1.3, -2.7], [-0.2, -2.7], [0.7, -1.5], [0.3, -0.5], [-1.6, -0.5], [-2.6, -1.6], [-5.6, -2.4], [-8.4, -2.4], [-8.8, -1.6]], -0.9, 0.9,
    { color: shell, mat: GM.POLY, bevel: 0.36, bevelSeg: 3, holes: [[[-0.9, -1.0], [0.0, -0.9], [0.55, -1.55], [-0.1, -2.35], [-1.05, -2.3]]] });
    rbox(gb, -9.3, -8.6, -2.4, 1.9, -0.94, 0.94, 0.28, { color: RUBBER, mat: GM.RUBBER });
    // a second (support) thumbhole at the front
    ext(gb, [[3.3, -0.35], [5.4, -0.35], [5.0, -2.6], [4.4, -3.1], [3.6, -3.1], [3.5, -2.4], [4.1, -2.0], [3.9, -0.9]], -0.75, 0.75, { color: shell, mat: GM.POLY, bevel: 0.25, bevelSeg: 3 });
    // the top magazine: a long flat box lying on the receiver, rounds visible down its side
    const M = { part: 'mag' };
    P.extX(gb, P.rrect(0.82, 2.0, 3.0, 0.3), -6.8, 3.6, { ...M, color: '#2b2e2c', mat: GM.POLY, bevel: 0.1 });
    if (!K.lite()) for (let k = 0; k < 16; k++) rbox(gb, -6.2 + k * 0.6, -5.85 + k * 0.6, 2.25, 2.75, -0.88, -0.84, 0.08, { ...M, color: BRASS, mat: GM.BRASS, seg: 1 });
    rbox(gb, 2.9, 3.7, 2.1, 3.1, -0.6, 0.6, 0.1, { ...M, color: dark, mat: GM.POLY });          // the latch at the front
    // barrel, a short shroud, a reflex sight on a raised mount ahead of the magazine (the
    // magazine tips up at the back and lifts out under nothing)
    P.extX(gb, P.rrect(0.6, 0.15, 1.6, 0.3), 6.2, 8.2, { color: dark, mat: GM.POLY, bevel: 0.12 });
    cylX(gb, 8.2, 9.6, 0.85, 0, 0.28, 0.26, { color: '#151617', seg: 14 });
    P.muzzle(gb, 'cone', 9.6, 0.85, 0.26, 0.8, { color: '#151617' });
    ext(gb, [[3.75, 1.9], [5.2, 1.9], [5.6, 1.45], [6.0, 1.45], [5.9, 2.4], [5.6, 3.1], [3.75, 3.1]], -0.62, 0.62, { color: shell, mat: GM.POLY, bevel: 0.16 });
    P.redDot(gb, 3.85, 3.05, { glow: '#ffb02a' });
    rbox(gb, 1.6, 2.4, 1.6, 2.0, -1.2, -0.9, 0.1, { part: 'bolt', color: dark, mat: GM.POLY });       // charging handle (left)
    ext(gb, [[0.95, -0.55], [1.25, -0.55], [1.1, -1.05], [0.9, -1.3], [0.75, -1.25], [0.95, -0.85]], -0.12, 0.12, { color: '#3a3c3f', mat: GM.STEEL, bevel: 0.03 });
    smgOut(out, { muzzle: [10.4, 0.85, 0], front: [4.4, -2.3, 0], eject: [-3.0, -0.6, 0.3], magwell: [-1.5, 2.5, 0], bolt: 1.0, glow: '#ffb02a' });
    // the magazine turns about its front catch
    out.pivots.mag = [3.6, 3.0, 0];
    out.reload = 'topmag';
  };

  // ---- .45 SMG: a boxy polymer receiver, a straight 25-round magazine, side-folding stock ----
  B.smg45 = (gb, L, sp, out) => {
    const body = sp.color, tan = sp.accent;
    ext(gb, [[-2.4, -0.4], [7.4, -0.4], [7.8, 0.2], [7.8, 1.9], [7.2, 2.3], [-2.0, 2.3], [-2.4, 1.9]], -0.72, 0.72, { color: body, mat: GM.POLY, bevel: 0.18 });
    rail(gb, -1.8, 7.2, 2.3, 0, 0.88, { color: '#151617' });
    if (!K.lite()) P.slots(gb, 3.6, 7.2, 0.6, 1.4, 0.82, 4, { fill: 0.5 });
    rbox(gb, 0.4, 3.2, 0.8, 1.6, 0.78, 0.86, 0.05, { color: '#070708' });
    rbox(gb, 4.6, 5.4, 1.9, 2.3, -1.15, -0.75, 0.1, { part: 'bolt', color: '#2e3033', mat: GM.STEEL });     // cocking handle (left)
    cylX(gb, 7.8, 9.4, 0.85, 0, 0.32, 0.3, { color: '#151617', seg: 14 });
    P.muzzle(gb, 'a2', 9.4, 0.85, 0.32, 1.2);
    P.rearSight(gb, -1.3, 2.66);
    P.holo(gb, 1.0, 2.66, { glow: '#ff3a2a' });
    P.trigger(gb, 0.0, -0.35, { color: body, len: 2.7, depth: 1.45, mat: GM.POLY });
    P.grip(gb, -0.25, -0.3, { color: body, h: 3.7, rake: 0.8 });
    P.vgrip(gb, 6.0, -0.4, { color: tan });
    // straight 25-round magazine ahead of the trigger
    const M = { part: 'mag' };
    rbox(gb, 3.0, 5.0, -0.85, -0.3, -0.7, 0.7, 0.12, { color: body, mat: GM.POLY });            // magwell
    P.stickMag(gb, 3.15, -0.7, 4.8, { w: 1.7, hz: 0.5, rake: -0.35, color: '#1a1b1c', mat: GM.POLY });
    void M;
    // side-folding skeleton stock (extended)
    ext(gb, [[-2.4, 1.9], [-8.6, 1.7], [-9.0, 1.3], [-9.0, -2.4], [-8.2, -2.5], [-7.6, -1.0], [-3.6, 0.2], [-2.4, 0.2]], -0.45, 0.45,
      { color: body, mat: GM.POLY, bevel: 0.16, holes: [[[-3.4, 1.2], [-7.6, 1.1], [-7.8, -0.5], [-4.2, 0.6]]] });
    rbox(gb, -9.6, -8.9, -2.5, 1.7, -0.62, 0.62, 0.22, { color: RUBBER, mat: GM.RUBBER });
    smgOut(out, { muzzle: [10.6, 0.85, 0], front: [6.0, -2.5, 0], eject: [1.8, 1.2, 0.9], magwell: [4.0, -0.9, 0], bolt: 1.2, glow: '#ff3a2a' });
  };

  void THREE; void sphere; void latheX; void STEEL; void HALF_PI;
}
