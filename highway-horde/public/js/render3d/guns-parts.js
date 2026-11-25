// Detailed gun parts for the procedural gun models (actor-guns.js): the pieces real guns are
// made of — receivers with bevelled edges and their controls, Picatinny rails and M-LOK
// handguards, muzzle devices and suppressors, iron sights and optics, magazines, stocks,
// grips, belts and ammo boxes — so each model in guns-*.js is assembled from separate,
// correctly proportioned parts instead of box stacks. Gun space as in actor-guns.js: +X to the
// muzzle, +Y up, +Z to the gun's right (the first-person camera sees the left side, -Z, and
// the top); 1 unit ≈ 3 cm; the origin is where the firing hand wraps the grip.
//
// Every helper takes the GunBuilder first and an options object last ({ part, color, mat,
// fin, wear, ... } as for the kit's primitives). `gunParts(K)` binds them to the kit that
// actor-guns.js hands over (its primitives read the builder state: lite / cinematic).

/** @param {object} K the kit from actor-guns.js (primitives, surface classes, colours, state) */
export function gunParts(K) {
  const { THREE, GM, ext, rbox, cylX, latheX, sphere, torusX, tubePath, rail, dot, shadeHex } = K;
  const { STEEL, DARK, BLUED, BRASS, RUBBER } = K.C;
  const HALF_PI = Math.PI / 2, TAU = Math.PI * 2;
  const P = {};

  /** Shape from [x, y] points with optional quadratic ([cx, cy, x, y]) and bezier (6) segments. */
  function shapeOf(pts, Cls = THREE.Shape) {
    const s = new Cls();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 2) s.lineTo(p[0], p[1]);
      else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else s.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
    }
    return s;
  }

  /**
   * A cross-section [z, y] extruded along X from x0 to x1, bevelled (handguards, slides seen
   * end-on, rails, tubes with flats). z is to the gun's right.
   */
  P.extX = (gb, pts, x0, x1, o = {}) => {
    const shape = shapeOf(pts.map(([z, y]) => [-z, y]));
    if (o.holes) for (const h of o.holes) shape.holes.push(shapeOf(h.map(([z, y]) => [-z, y]), THREE.Path));
    const bev = K.lite() ? Math.min(0.06, o.bevel ?? 0.1) : o.bevel ?? 0.1;
    const depth = Math.max(0.01, x1 - x0 - bev * 2);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.8,
      bevelSegments: K.lite() ? 1 : (o.bevelSeg ?? 2) * (K.cin() ? 2 : 1), curveSegments: K.lite() ? 3 : (o.curve ?? 6) * (K.cin() ? 2 : 1),
    });
    g.rotateY(HALF_PI);
    g.translate(x0 + bev, 0, 0);
    gb.add(g, { capAxis: 0, ...o });
  };

  /** A rounded-rectangle cross-section [z, y] (half widths, corner radius) for extX. */
  P.rrect = (hz, y0, y1, r, cz = 0) => {
    const rr = Math.min(r, hz * 0.95, (y1 - y0) / 2 * 0.95);
    return [[cz - hz + rr, y0], [cz + hz - rr, y0], [cz + hz, y0, cz + hz, y0 + rr], [cz + hz, y1 - rr], [cz + hz, y1, cz + hz - rr, y1],
      [cz - hz + rr, y1], [cz - hz, y1, cz - hz, y1 - rr], [cz - hz, y0 + rr], [cz - hz, y0, cz - hz + rr, y0]];
  };

  // ---- small hardware ----------------------------------------------------------------------

  /** A pin through the receiver: a flush disc on both flanks (takedown / pivot / trigger pins). */
  P.pin = (gb, x, y, z, r = 0.12, o = {}) => {
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(r, r, 0.06, 10);
      g.rotateX(HALF_PI);
      gb.add(g, { at: [x, y, s * z], color: o.color || '#2a2b2d', mat: GM.STEEL, round: true, wear: 0.6, part: o.part });
      if (!K.lite() && r > 0.1) {
        const d = new THREE.CircleGeometry(r * 0.45, 8);
        if (s < 0) d.rotateY(Math.PI);
        gb.add(d, { at: [x, y, s * (z + 0.032)], color: '#0c0c0d', mat: GM.STEEL, part: o.part });
      }
    }
  };

  /** A row of dark recessed slots on both flanks at ±z (vents, M-LOK, lightening cuts). */
  P.slots = (gb, x0, x1, y0, y1, z, n, o = {}) => {
    const gap = (x1 - x0) / n;
    const w = gap * (o.fill ?? 0.62);
    for (let k = 0; k < n; k++) {
      const x = x0 + k * gap + (gap - w) / 2;
      for (const s of o.sides || [-1, 1]) rbox(gb, x, x + w, y0, y1, s * z - 0.05, s * z + 0.05, Math.min(0.12, (y1 - y0) / 2.2), { color: '#060607', seg: 1, part: o.part, detail: true });
    }
  };

  /** A sling swivel / QD point: a small ring on a stud. */
  P.swivel = (gb, x, y, z, o = {}) => {
    cylX(gb, x - 0.12, x + 0.12, y, z, 0.12, 0.12, { color: DARK, seg: 8, part: o.part });
    if (!K.lite()) {
      // the loop hangs in the gun's plane
      const g = new THREE.TorusGeometry(0.28, 0.05, 6, 12);
      g.translate(x, y - 0.36, z);
      gb.add(g, { color: '#3a3c3f', mat: GM.STEEL, round: true, part: o.part });
    }
  };

  // ---- grips and triggers ------------------------------------------------------------------

  /**
   * A modern pistol grip: raked, with a finger-groove front strap, a palm swell and a
   * beavertail, textured where the hand goes (the gun material's grip family). top: where it
   * meets the receiver; rake: how far the bottom sits back.
   */
  P.grip = (gb, x, top, o = {}) => {
    const h = o.h ?? 3.9, rake = o.rake ?? 1.0, w = o.w ?? 0.62, col = o.color || '#1d1e20';
    const b = top - h;
    ext(gb, [[x + 1.05, top], [x + 0.95, top - 0.5], [x + 0.75 - rake * 0.25, top - h * 0.3], [x + 0.95 - rake * 0.42, top - h * 0.42], [x + 0.62 - rake * 0.5, top - h * 0.52],
      [x + 0.78 - rake * 0.68, top - h * 0.66], [x + 0.45 - rake * 0.78, top - h * 0.78], [x + 0.55 - rake, b + 0.25], [x + 0.35 - rake, b], [x - 1.35 - rake, b],
      [x - 1.55 - rake, b + 0.35], [x - 1.25 - rake * 0.62, top - h * 0.45], [x - 1.15 - rake * 0.2, top - h * 0.15], [x - 1.6, top - 0.15], [x - 1.85, top + 0.25], [x - 1.2, top + 0.2]],
    -w, w, { color: col, mat: o.mat ?? GM.POLY, bevel: 0.22, bevelSeg: 3, part: o.part });
    // stippled side panels (the grip family on the flanks)
    if (!K.lite()) for (const s of [-1, 1]) {
      ext(gb, [[x + 0.3 - rake * 0.3, top - h * 0.28], [x - 0.15 - rake * 0.85, b + 0.55], [x - 1.05 - rake * 0.95, b + 0.55], [x - 0.9 - rake * 0.3, top - h * 0.3]],
        s * (w + 0.02) - 0.05, s * (w + 0.02) + 0.05, { color: shadeHex(col, -0.08), mat: o.mat ?? GM.POLY, bevel: 0.03, part: o.part, fin: o.panelFin });
    }
  };

  /** A trigger guard with a real opening and a curved trigger blade. */
  P.trigger = (gb, x, y, o = {}) => {
    const col = o.color || DARK, len = o.len ?? 2.9, depth = o.depth ?? 1.55;
    ext(gb, [[x - 0.35, y + 0.1], [x + len, y + 0.1], [x + len, y - 0.25], [x + len - 0.35, y - depth + 0.15], [x + len - 0.8, y - depth], [x + 0.6, y - depth], [x - 0.05, y - depth + 0.35], [x - 0.35, y - 0.3]],
      -0.3, 0.3, { color: col, mat: o.mat ?? GM.ALLOY, bevel: 0.07, holes: [[[x + 0.05, y - 0.12], [x + len - 0.3, y - 0.12], [x + len - 0.45, y - depth + 0.42], [x + len - 0.85, y - depth + 0.3], [x + 0.6, y - depth + 0.3], [x + 0.2, y - depth + 0.55]]], part: o.part });
    const tx = x + len * 0.42;
    ext(gb, [[tx, y + 0.05], [tx + 0.32, y + 0.05], [tx + 0.12, y - 0.55], [tx - 0.1, y - 1.05], [tx - 0.32, y - 1.0], [tx - 0.1, y - 0.5]], -0.13, 0.13, { color: '#4a4c50', mat: GM.STEEL, bevel: 0.04, part: o.part });
  };

  // ---- AR family -----------------------------------------------------------------------------

  /**
   * AR-15 lower receiver: the magwell with its flare, the oversized trigger guard, the bolt
   * catch and the selector on the left, the mag release on the right, the pins, the buffer
   * tube's receiver extension and castle nut. Returns the magwell's x range.
   */
  P.arLower = (gb, o = {}) => {
    const col = o.color || '#232527', mw = o.magwell ?? 2.0;
    ext(gb, [[-2.6, 1.0], [5.0, 1.0], [5.0, 0.35], [mw + 2.85, -0.75], [mw + 2.7, -1.35], [mw - 0.05, -1.35], [mw - 0.2, -0.55], [0.3, -0.35], [-1.6, -0.3], [-2.6, 0.2]],
      -0.82, 0.82, { color: col, mat: GM.ALLOY, bevel: 0.12, part: o.part });
    // magwell flare: a lip round the opening
    rbox(gb, mw - 0.18, mw + 2.86, -1.5, -1.2, -0.9, 0.9, 0.1, { color: shadeHex(col, -0.04), mat: GM.ALLOY });
    P.trigger(gb, -0.05, -0.3, { color: col, len: 2.95 });
    // bolt catch (left), mag release (right), selector lever (left) with its detent markings
    ext(gb, [[mw + 0.1, 0.55], [mw + 0.75, 0.55], [mw + 0.65, -0.25], [mw + 0.2, -0.25]], -0.98, -0.82, { color: DARK, mat: GM.STEEL, bevel: 0.03 });
    cylX(gb, -0.07, 0.07, 0, 0, 0.24, 0.24, { at: [mw + 0.75, -0.55, 0.86], rot: [0, HALF_PI, 0], color: '#151617', seg: 10 });
    ext(gb, [[-1.7, 0.36], [-0.7, 0.62], [-0.55, 0.45], [-1.55, 0.18]], -1.04, -0.82, { color: '#101112', mat: GM.STEEL, bevel: 0.03 });
    sphere(gb, -1.65, 0.28, -0.9, 0.2, { color: '#101112', seg: 8 });
    P.pin(gb, -1.75, 0.55, 0.84, 0.13);
    P.pin(gb, 4.55, 0.55, 0.84, 0.13);
    P.pin(gb, 0.75, -0.05, 0.84, 0.09);
    // receiver extension (buffer tube) ring and castle nut
    cylX(gb, -2.95, -2.6, 1.55, 0, 0.72, 0.72, { color: '#18191a', seg: 16 });
    if (!K.lite()) for (let k = 0; k < 6; k++) {
      const a = k * TAU / 6 + 0.3;
      rbox(gb, -2.93, -2.62, -0.06, 0.06, -0.12, 0.12, 0.02, { color: '#0a0a0b', at: [0, 1.55 + Math.cos(a) * 0.72, Math.sin(a) * 0.72], rot: [a, 0, 0], seg: 1 });
    }
    return [mw, mw + 2.85];
  };

  /**
   * AR-15 flat-top upper: the body with its rounded shoulders, the Picatinny rail, the
   * ejection port with the bolt carrier showing and the dust cover hinge, the brass deflector
   * and the forward assist, and the T charging handle (part 'bolt': it racks on a reload).
   */
  P.arUpper = (gb, xEnd, o = {}) => {
    const col = o.color || '#232527';
    P.extX(gb, [[-0.8, 1.0], [0.8, 1.0], [0.82, 1.9], [0.62, 2.3], [-0.62, 2.3], [-0.82, 1.9]], -2.6, xEnd, { color: col, mat: GM.ALLOY, bevel: 0.1 });
    rail(gb, -2.5, xEnd - 0.15, 2.3, 0, 0.92, { color: shadeHex(col, -0.05) });
    // ejection port: a recess with the bolt carrier's face behind it, the dust cover's hinge rod below
    rbox(gb, 0.5, 3.4, 1.22, 2.02, 0.84, 0.95, 0.06, { color: '#070708' });
    rbox(gb, 0.8, 3.0, 1.35, 1.88, 0.86, 0.955, 0.05, { color: '#7c7f84', mat: GM.STEEL, wear: 0.4 });
    cylX(gb, 0.3, 3.7, 1.2, 0.95, 0.07, 0.07, { color: '#2a2c2e', seg: 6 });
    // brass deflector and forward assist (right side, the inspect shows them)
    ext(gb, [[-0.2, 1.1], [0.35, 1.1], [0.35, 2.1], [-0.1, 2.2], [-0.25, 1.7]], 0.78, 1.18, { color: col, mat: GM.ALLOY, bevel: 0.06 });
    latheX(gb, [[-1.55, 0], [-1.55, 0.26], [-1.25, 0.3], [-0.6, 0.3], [-0.55, 0]], 1.72, 0.95, { color: col, mat: GM.ALLOY, seg: 12 });
    cylX(gb, -1.95, -1.55, 1.72, 0.95, 0.24, 0.24, { color: '#121314', seg: 12, fin: 'knurl' });
    // charging handle: shaft in the rail's slot, the T latch at the back
    const B = { part: 'bolt' };
    ext(gb, [[-2.45, 2.0], [-2.45, 2.42], [-3.05, 2.42], [-3.15, 2.3], [-3.15, 2.1], [-3.05, 2.0]], -0.95, 0.95, { ...B, color: '#18191b', mat: GM.ALLOY, bevel: 0.07 });
    ext(gb, [[-2.75, 2.42], [-2.35, 2.42], [-2.35, 2.5], [-2.75, 2.5]], -1.15, -0.55, { ...B, color: '#18191b', mat: GM.ALLOY, bevel: 0.03 });
    P.pin(gb, -0.9, 1.6, 0.82, 0.09);
  };

  /**
   * A free-floating M-LOK handguard: an octagonal tube with rows of slots on the flats, a
   * full-length top rail, an index-stop at the receiver and a slight taper at the front.
   */
  P.mlok = (gb, x0, x1, y, r, o = {}) => {
    const col = o.color || '#1f2123';
    const c = r * 0.41;      // octagon corner cut
    P.extX(gb, [[-r + c, y - r], [r - c, y - r], [r, y - r + c], [r, y + r - c], [r - c, y + r], [-r + c, y + r], [-r, y + r - c], [-r, y - r + c]], x0, x1, { color: col, mat: GM.ALLOY, bevel: 0.08, part: o.part, fin: o.fin });
    rail(gb, x0 + 0.1, x1 - 0.1, y + r - 0.02, 0, 0.92, { color: shadeHex(col, -0.08), part: o.part, fin: o.fin });
    if (!K.lite()) {
      const n = Math.max(2, Math.floor((x1 - x0 - 1.2) / 1.55));
      P.slots(gb, x0 + 0.7, x1 - 0.4, y - 0.32, y + 0.32, r + 0.075, n, { fill: 0.6, part: o.part });
      for (let k = 0; k < n; k++) {
        const x = x0 + 0.7 + k * ((x1 - x0 - 1.1) / n) + 0.25;
        rbox(gb, x, x + 0.9, y - r - 0.12, y - r - 0.01, -0.26, 0.26, 0.1, { color: "#060607", seg: 1, part: o.part });
      }
      // diagonal flats get their own slot row
      for (const s of [-1, 1]) for (let k = 0; k < n - 1; k++) {
        const x = x0 + 1.1 + k * ((x1 - x0 - 1.4) / (n - 1));
        rbox(gb, x, x + 0.7, -0.1, 0.1, -0.06, 0.06, 0.05, { color: '#060607', seg: 1, at: [0, y + (r - c * 0.5) * 0.78, s * (r - c * 0.5) * 0.78], rot: [s * Math.PI / 4, 0, 0], part: o.part });
      }
    }
    // the slip ring at the receiver end
    torusX(gb, x0 + 0.06, y, 0, r * 0.98, 0.1, { color: '#141516', seg: 16, part: o.part });
  };

  /** A plain round barrel with a step at the gas block / front of the handguard. */
  P.barrel = (gb, x0, x1, y, r, o = {}) => {
    cylX(gb, x0, x1, y, 0, r * 1.05, r, { color: o.color || BLUED, mat: GM.STEEL, seg: o.seg ?? 16, part: o.part });
  };

  /**
   * Muzzle devices at x (from x to x + len): 'a2' bird-cage flash hider, 'comp' compensator
   * with side ports, 'brake' a two-baffle muzzle brake, 'ak' the slant brake, 'cone' a
   * conical flash hider. Leaves the bore dark at the front.
   */
  P.muzzle = (gb, kind, x, y, r, len, o = {}) => {
    const col = o.color || '#151617';
    const x1 = x + len;
    if (kind === 'a2') {
      latheX(gb, [[x, 0], [x, r * 1.05], [x + len * 0.15, r * 1.2], [x1 - 0.05, r * 1.2], [x1, r * 1.05], [x1, 0]], y, 0, { color: col, seg: 14, part: o.part });
      if (!K.lite()) for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + HALF_PI;
        rbox(gb, x + len * 0.35, x1 - 0.12, -0.06, 0.06, -0.08, 0.08, 0.02, { color: '#040405', at: [0, y + Math.sin(a) * r * 1.18, Math.cos(a) * r * 1.18], rot: [a - HALF_PI, 0, 0], seg: 1, part: o.part });
      }
    } else if (kind === 'comp' || kind === 'brake') {
      P.extX(gb, P.rrect(r * 1.3, y - r * 1.25, y + r * 1.25, r * 0.5), x, x1, { color: col, mat: GM.STEEL, bevel: 0.08, part: o.part });
      const ports = kind === 'brake' ? 2 : 3;
      for (let k = 0; k < ports; k++) {
        const px = x + len * (0.22 + k * (0.62 / ports));
        rbox(gb, px, px + len * (kind === 'brake' ? 0.22 : 0.12), y - r * 0.85, y + r * 0.85, -r * 1.36, r * 1.36, 0.06, { color: '#040405', seg: 1, part: o.part });
        if (kind === 'comp') rbox(gb, px, px + len * 0.12, y + r * 1.2, y + r * 1.32, -r * 0.5, r * 0.5, 0.03, { color: '#040405', seg: 1, part: o.part });
      }
    } else if (kind === 'ak') {
      latheX(gb, [[x, 0], [x, r * 1.15], [x1 - 0.1, r * 1.1], [x1, r * 0.95], [x1, 0]], y, 0, { color: col, seg: 14, part: o.part });
      // the slant cut on top and the port on the left
      if (!K.lite()) {
        rbox(gb, x1 - len * 0.45, x1 + 0.02, y + r * 0.6, y + r * 1.2, -r * 1.2, r * 1.2, 0.04, { color: '#040405', rot: [0, 0, -0.35], seg: 1, part: o.part });
        rbox(gb, x + len * 0.35, x + len * 0.6, y - r * 0.2, y + r * 0.6, -r * 1.2, -r * 0.9, 0.04, { color: '#040405', seg: 1, part: o.part });
      }
    } else {
      latheX(gb, [[x, 0], [x, r * 1.0], [x1, r * 1.5], [x1, r * 1.2], [x1 - 0.2, 0]], y, 0, { color: col, seg: 16, part: o.part });
    }
    cylX(gb, x1 - 0.02, x1 + 0.015, y, 0, r * 0.55, r * 0.55, { color: '#020202', seg: 10, part: o.part });
  };

  /** A suppressor can from x (part 'silencer' unless o.part says otherwise). */
  P.suppressor = (gb, x, y, r, len, o = {}) => {
    const S = { part: o.part || 'silencer' };
    const col = o.color || '#2a2c2e';
    latheX(gb, [[x - 0.2, 0], [x - 0.2, r * 0.7], [x + 0.25, r * 0.98], [x1(), r], [x + len - 0.05, r * 0.98], [x + len, r * 0.82], [x + len, 0]], y, 0, { ...S, color: col, mat: GM.STEEL, seg: 22, fin: o.fin ?? 'cerakote' });
    function x1() { return x + len - 0.3; }
    if (!K.lite()) {
      // wrench flats and grip rings at the back, a serial band
      for (let k = 0; k < 4; k++) torusX(gb, x + 0.35 + k * 0.22, y, 0, r * 0.99, 0.045, { ...S, color: shadeHex(col, -0.25), seg: 22 });
      torusX(gb, x + len * 0.62, y, 0, r * 1.0, 0.03, { ...S, color: shadeHex(col, 0.18), seg: 22 });
    }
    cylX(gb, x + len - 0.02, x + len + 0.012, y, 0, r * 0.28, r * 0.28, { ...S, color: '#020202', seg: 12 });
  };

  // ---- sights and optics ---------------------------------------------------------------------

  /** A-frame front sight post with its protective ears (on the gas block). */
  P.frontSightA = (gb, x, y, o = {}) => {
    const col = o.color || '#151617';
    ext(gb, [[x - 0.55, y], [x + 0.55, y], [x + 0.32, y + 1.4], [x + 0.2, y + 2.1], [x - 0.2, y + 2.1], [x - 0.32, y + 1.4]], -0.42, 0.42,
      { color: col, mat: GM.STEEL, bevel: 0.06, fin: 'sight', holes: [[[x - 0.16, y + 1.45], [x + 0.16, y + 1.45], [x + 0.12, y + 1.95], [x - 0.12, y + 1.95]]], part: o.part });
    rbox(gb, x - 0.06, x + 0.06, y + 1.4, y + 1.95, -0.06, 0.06, 0.02, { color: '#0c0c0c', seg: 1, part: o.part, fin: 'sight' });
    if (o.dot !== false) dot(gb, x - 0.065, y + 1.88, 0, 0.045, o.dotColor || '#9dff6a', o.part);
  };

  /** A flip-up rear aperture sight on the rail. */
  P.rearSight = (gb, x, y, o = {}) => {
    rbox(gb, x - 0.6, x + 0.6, y, y + 0.45, -0.55, 0.55, 0.1, { color: '#151617', mat: GM.ALLOY, part: o.part });
    ext(gb, [[x - 0.12, y + 0.4], [x + 0.12, y + 0.4], [x + 0.12, y + 1.25], [x - 0.12, y + 1.25]], -0.5, 0.5,
      { color: '#151617', mat: GM.STEEL, bevel: 0.04, fin: 'sight', holes: [[[x - 0.13, y + 0.75], [x + 0.13, y + 0.75], [x + 0.13, y + 1.05], [x - 0.13, y + 1.05]]], part: o.part });
  };

  /**
   * A compact red-dot sight on a riser mount: the tube body, the hood, the lens with a glowing
   * dot floating in it, the brightness turret on the right.
   */
  P.redDot = (gb, x, y, o = {}) => {
    const col = o.color || '#17181a', glow = o.glow || '#ff3a2a';
    rbox(gb, x - 0.2, x + 2.2, y, y + 0.6, -0.6, 0.6, 0.12, { color: col, mat: GM.ALLOY, part: o.part });     // mount
    for (const s of [-1, 1]) rbox(gb, x + 0.5, x + 1.5, y + 0.05, y + 0.35, s * 0.62 - 0.08, s * 0.62 + 0.08, 0.04, { color: '#0e0e0f', part: o.part });
    latheX(gb, [[x, 0], [x, 0.62], [x + 0.15, 0.7], [x + 1.95, 0.7], [x + 2.15, 0.78], [x + 2.15, 0]], y + 1.3, 0, { color: col, mat: GM.ALLOY, seg: 20, part: o.part });
    cylX(gb, x + 0.8, x + 1.4, y + 1.3, 0.75, 0.32, 0.32, { color: '#101112', rot: [0, 0, 0], seg: 12, at: [0, 0, 0], part: o.part, fin: 'knurl' });
    const lg = new THREE.CircleGeometry(0.6, 20);
    lg.rotateY(-HALF_PI);
    gb.add(lg, { at: [x - 0.01, y + 1.3, 0], color: '#14202a', mat: GM.LENS, part: o.part });
    const lf = new THREE.CircleGeometry(0.66, 20);
    lf.rotateY(HALF_PI);
    gb.add(lf, { at: [x + 2.16, y + 1.3, 0], color: '#2a3a20', mat: GM.LENS, part: o.part });
    dot(gb, x + 0.3, y + 1.3, 0, 0.05, glow, o.part);
  };

  /**
   * A holographic box sight: a hooded window with a ring-and-dot reticle, the battery box and
   * buttons at the back, a quick-release lever.
   */
  P.holo = (gb, x, y, o = {}) => {
    const col = o.color || '#1c1d1f', glow = o.glow || '#ff3a2a';
    rbox(gb, x, x + 3.0, y, y + 0.7, -0.68, 0.68, 0.18, { color: col, mat: GM.POLY, part: o.part });       // battery box / base
    ext(gb, [[x + 0.5, y + 0.6], [x + 3.0, y + 0.6], [x + 3.0, y + 1.9], [x + 2.6, y + 2.2], [x + 0.9, y + 2.2], [x + 0.5, y + 1.85]], -0.78, 0.78,
      { color: col, mat: GM.POLY, bevel: 0.12, holes: [[[x + 0.75, y + 0.85], [x + 2.75, y + 0.85], [x + 2.75, y + 1.9], [x + 0.75, y + 1.9]]], part: o.part });
    rbox(gb, x + 1.7, x + 1.75, y + 0.85, y + 1.9, -0.6, 0.6, 0.01, { color: '#1a3040', mat: GM.LENS, seg: 1, part: o.part });
    for (const bx of [0.25, 0.55]) rbox(gb, x + bx - 0.1, x + bx + 0.1, y + 0.62, y + 0.75, -0.25, 0.25, 0.04, { color: '#2a2b2d', mat: GM.RUBBER, part: o.part });
    dot(gb, x + 1.8, y + 1.38, 0, 0.05, glow, o.part);
    if (!K.lite()) {
      const ring = new THREE.TorusGeometry(0.38, 0.016, 4, 24);
      ring.rotateY(HALF_PI);
      gb.add(ring, { glow: true, at: [x + 1.78, y + 1.38, 0], color: glow, round: true, part: o.part });
    }
    rbox(gb, x + 2.1, x + 2.8, y + 0.05, y + 0.45, 0.68, 0.95, 0.08, { color: '#121314', part: o.part });   // QD lever
  };

  /**
   * A riflescope from x0 to x1 at height y with tube radius r: the eyepiece and objective
   * bells, elevation / windage turrets, a side focus knob, two rings on their bases, lenses
   * (the objective glints) and a glowing reticle in the eyepiece. `mount`: the rail height.
   */
  P.scope = (gb, x0, x1, y, r, o = {}) => {
    const L = x1 - x0, col = o.color || '#131416';
    latheX(gb, [[x0, 0], [x0, r * 1.25], [x0 + L * 0.02, r * 1.36], [x0 + L * 0.17, r * 1.32], [x0 + L * 0.27, r * 0.86], [x0 + L * 0.62, r * 0.86],
      [x0 + L * 0.75, r * 1.52], [x1 - L * 0.03, r * 1.58], [x1, r * 1.45], [x1, 0]], y, 0, { color: col, mat: GM.ALLOY, seg: 26, part: o.part });
    // magnification ring with grip ribs
    if (!K.lite()) for (let k = 0; k < 6; k++) torusX(gb, x0 + L * (0.19 + k * 0.012), y, 0, r * 1.06, 0.04, { color: '#0d0d0e', seg: 20, part: o.part });
    const tx = x0 + L * 0.44;
    // turrets: elevation on top, windage on the right, focus on the left
    for (const [ax, ay, az, rot] of [[tx, y + r * 1.15, 0, [0, 0, 0]], [tx, y, r * 1.1, [HALF_PI, 0, 0]], [tx + L * 0.06, y, -r * 1.05, [-HALF_PI, 0, 0]]]) {
      const tg = new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.95, 18);
      gb.add(tg, { at: [ax, ay, az], rot, color: '#18191b', mat: GM.ALLOY, round: true, fin: 'knurl', part: o.part });
      const cap = new THREE.CylinderGeometry(r * 0.4, r * 0.48, r * 0.2, 18);
      const up = rot[0] === 0 ? [0, r * 0.55, 0] : [0, 0, Math.sign(rot[0]) * r * 0.55];
      gb.add(cap, { at: [ax + up[0], ay + up[1], az + up[2]], rot, color: '#2a2b2e', mat: GM.ALLOY, round: true, part: o.part });
    }
    rbox(gb, tx - r * 0.9, tx + r * 0.9, y - r * 0.9, y + r * 0.9, -r * 0.95, r * 0.95, r * 0.35, { color: col, mat: GM.ALLOY, part: o.part });   // turret housing
    // rings and bases down to the rail
    const base = o.mount ?? y - r * 1.6;
    for (const f of [0.31, 0.6]) {
      const rx = x0 + L * f;
      torusX(gb, rx, y, 0, r * 0.95, 0.16, { color: '#0f1011', seg: 22, part: o.part });
      rbox(gb, rx - 0.38, rx + 0.38, base, y - r * 0.75, -r * 0.7, r * 0.7, 0.12, { color: '#0f1011', mat: GM.ALLOY, part: o.part });
      cylX(gb, rx - 0.15, rx + 0.15, base + 0.25, r * 0.75, 0.16, 0.16, { color: '#2a2b2d', seg: 8, part: o.part });
    }
    const lg = new THREE.CircleGeometry(r * 1.42, 24);
    lg.rotateY(HALF_PI);
    gb.add(lg, { at: [x1 + 0.01, y, 0], color: '#173350', mat: GM.LENS, part: o.part });
    const lg2 = new THREE.CircleGeometry(r * 1.18, 24);
    lg2.rotateY(-HALF_PI);
    gb.add(lg2, { at: [x0 - 0.01, y, 0], color: '#0a1420', mat: GM.LENS, part: o.part });
    if (o.glint !== false) dot(gb, x1 + 0.02, y + r * 0.45, -r * 0.4, r * 0.16, '#9ad8ff', o.part);
    if (!K.lite()) {
      const rr = r * 0.9, rc = o.reticle || '#ff3a2a';
      gb.add(new THREE.BoxGeometry(0.012, rr * 1.7, 0.024), { glow: true, at: [x0 - 0.05, y, 0], color: rc, part: o.part });
      gb.add(new THREE.BoxGeometry(0.012, 0.024, rr * 1.7), { glow: true, at: [x0 - 0.05, y, 0], color: rc, part: o.part });
      dot(gb, x0 - 0.06, y, 0, 0.045, rc, o.part);
    }
  };

  // ---- magazines -----------------------------------------------------------------------------

  /**
   * A curved 30-round rifle magazine (polymer with ribs and a window, or steel with
   * reinforcing ribs), its feed lips and the top round, the floor plate with tabs. x: the front
   * of the magwell's back edge; curve: how far forward the bottom sweeps.
   */
  P.mag = (gb, x, y, len, curve, o = {}) => {
    const M = { part: o.part || 'mag' };
    const col = o.color || '#1b1c1d', w = o.w ?? 2.3, hz = o.hz ?? 0.55;
    const steel = !!o.steel;
    ext(gb, [[x, y + 0.2], [x + w, y + 0.2], [x + w + 0.08 + curve * 0.25, y - len * 0.4], [x + w - 0.1 + curve, y - len], [x - 0.25 + curve, y - len - 0.25], [x - 0.1 + curve * 0.25, y - len * 0.45]],
      -hz, hz, { ...M, color: col, mat: steel ? GM.STEEL : GM.POLY, bevel: 0.1, bevelSeg: 2 });
    if (!K.lite()) {
      // ribs along the body (steel mags: pressed ribs; polymer: grip texture bands)
      const n = steel ? 3 : 4;
      for (let k = 0; k < n; k++) {
        const t = 0.22 + k * (0.6 / n);
        const cx = x + curve * t * t;
        rbox(gb, cx + (steel ? 0.25 : 0.15), cx + w - (steel ? 0.25 : 0.15), y - len * t - 0.07, y - len * t + 0.07, -hz - 0.05, hz + 0.05, 0.04, { ...M, color: shadeHex(col, steel ? 0.06 : -0.18), mat: steel ? GM.STEEL : GM.POLY, seg: 1 });
      }
      if (steel) for (const s of [-1, 1]) ext(gb, [[x + 0.6, y - 0.5], [x + w - 0.5, y - 0.5], [x + w - 0.45 + curve * 0.7, y - len * 0.8], [x + 0.65 + curve * 0.7, y - len * 0.8]], s * hz - 0.04 * (s < 0 ? 1 : 0), s * hz + 0.04 * (s > 0 ? 1 : 0), { ...M, color: shadeHex(col, -0.08), mat: GM.STEEL, bevel: 0.02 });
    }
    // floor plate with a tab at the back
    rbox(gb, x - 0.4 + curve, x + w + 0.12 + curve, y - len - 0.55, y - len - 0.1, -hz - 0.1, hz + 0.1, 0.14, { ...M, color: shadeHex(col, -0.12), mat: steel ? GM.STEEL : GM.POLY, rot: [0, 0, curve * 0.05] });
    // the top round in the feed lips
    if (o.round !== false) cylX(gb, x + 0.25, x + w - 0.25, y + 0.28, 0, 0.2, 0.2, { ...M, color: BRASS, mat: GM.BRASS, seg: 10 });
  };

  /** A straight pistol / SMG magazine from the grip or magwell, with its base plate. */
  P.stickMag = (gb, x, y, len, o = {}) => {
    const M = { part: o.part || 'mag' };
    const col = o.color || '#1d1e20', w = o.w ?? 1.5, hz = o.hz ?? 0.42, rake = o.rake ?? 0;
    ext(gb, [[x, y], [x + w, y], [x + w - rake, y - len], [x - rake, y - len]], -hz, hz, { ...M, color: col, mat: o.mat ?? GM.STEEL, bevel: 0.08 });
    rbox(gb, x - rake - 0.2, x + w - rake + 0.15, y - len - 0.38, y - len + 0.02, -hz - 0.1, hz + 0.1, 0.12, { ...M, color: o.base || shadeHex(col, -0.08), mat: GM.POLY });
    if (o.round !== false) cylX(gb, x + 0.15, x + w - 0.2, y + 0.12, 0, 0.16, 0.16, { ...M, color: BRASS, mat: GM.BRASS, seg: 10 });
  };

  // ---- stocks ------------------------------------------------------------------------------

  /** A collapsible carbine stock on its buffer tube (sling slots, cheek weld, rubber pad). */
  P.carbineStock = (gb, x0, y, o = {}) => {
    const col = o.color || '#1d1e20';
    cylX(gb, x0 - 6.4, x0, y, 0, 0.6, 0.6, { color: '#18191a', mat: GM.ALLOY, seg: 18 });
    // the stock body slides on the tube; a release lever under it
    ext(gb, [[x0 - 3.6, y + 0.75], [x0 - 8.9, y + 0.95], [x0 - 9.3, y + 0.6], [x0 - 9.4, y - 3.8], [x0 - 8.6, y - 3.9], [x0 - 7.6, y - 2.4], [x0 - 5.8, y - 1.0], [x0 - 3.6, y - 0.75]],
      -0.82, 0.82, { color: col, mat: GM.POLY, bevel: 0.42, bevelSeg: 4, holes: [[[x0 - 5.9, y - 1.3], [x0 - 7.4, y - 2.4], [x0 - 8.25, y - 3.2], [x0 - 8.4, y - 1.4]]] });
    rbox(gb, x0 - 10.0, x0 - 9.25, y - 4.0, y + 1.0, -0.88, 0.88, 0.3, { color: RUBBER, mat: GM.RUBBER });
    rbox(gb, x0 - 6.0, x0 - 4.4, y - 1.1, y - 0.65, -0.3, 0.3, 0.1, { color: '#101112' });
    if (!K.lite()) P.slots(gb, x0 - 8.6, x0 - 6.6, y + 0.15, y + 0.5, 0.83, 2, { fill: 0.7 });
  };

  /** A fixed rifle stock (wood or polymer) with a comb, the grip wrist and a butt plate. */
  P.fixedStock = (gb, x0, y, o = {}) => {
    const col = o.color || '#5a3a22', wood = o.mat === GM.WOOD;
    ext(gb, [[x0, y + 0.85], [x0 - 2.5, y + 0.6], [x0 - 9.8, y + 0.9], [x0 - 10.2, y + 0.4], [x0 - 10.3, y - 3.5], [x0 - 9.6, y - 3.6], [x0 - 5.2, y - 1.9], [x0 - 2.2, y - 0.95], [x0, y - 0.7]],
      -0.82, 0.82, { color: col, mat: o.mat ?? GM.POLY, bevel: wood ? 0.48 : 0.42, bevelSeg: 4 });
    rbox(gb, x0 - 10.8, x0 - 10.15, y - 3.6, y + 0.95, -0.86, 0.86, 0.25, { color: o.plate || '#1a1a1a', mat: o.plate ? GM.STEEL : GM.RUBBER });
    P.swivel(gb, x0 - 8.2, y - 2.95, 0, {});
  };

  // ---- belts and boxes ---------------------------------------------------------------------

  /**
   * An ammunition belt along a curve (points [x, y, z]): brass rounds side by side, linked,
   * each lying across the curve. n rounds; tip: the bullet colour. `along`: 'z' (default) for
   * a belt running fore and aft (the rounds point to the gun's right), 'x' for one running up
   * or across into a side feed tray (the rounds point at the muzzle, as in a real belt).
   */
  P.belt = (gb, pts, n, o = {}) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const M = { part: o.part || 'mag' };
    const r = o.r ?? 0.2, half = o.half ?? 0.85;
    const _t = new THREE.Vector3(), _p = new THREE.Vector3();
    const fwd = o.along === 'x';
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : k / (n - 1);
      curve.getPointAt(u, _p);
      curve.getTangentAt(u, _t);
      const body = new THREE.CylinderGeometry(r, r * 1.05, half * 1.5, 8);
      const tip = K.lite() ? null : new THREE.ConeGeometry(r * 0.85, half * 0.55, 8);
      if (fwd) {
        // the round along +X; the link collar squared to the belt's path in the YZ plane
        body.rotateZ(-HALF_PI);
        gb.add(body, { ...M, at: [_p.x, _p.y, _p.z], color: BRASS, mat: GM.BRASS, round: true, wear: 0.4 });
        if (tip) {
          tip.rotateZ(-HALF_PI);
          gb.add(tip, { ...M, at: [_p.x + half, _p.y, _p.z], color: o.tip || '#b0703a', mat: GM.BRASS, round: true });
          const roll = Math.atan2(_t.z, _t.y);
          rbox(gb, -half * 0.3, half * 0.3, -r * 1.22, r * 1.22, -r * 1.22, r * 1.22, 0.04, { ...M, at: [_p.x - half * 0.25, _p.y, _p.z], rot: [roll, 0, 0], color: '#34363a', mat: GM.STEEL, seg: 1 });
        }
        continue;
      }
      // rounds lie along the gun's Z axis (side by side along the belt's path)
      const ang = Math.atan2(_t.y, _t.x);
      body.rotateX(HALF_PI);
      gb.add(body, { ...M, at: [_p.x, _p.y, _p.z], rot: [0, 0, ang], color: BRASS, mat: GM.BRASS, round: true, wear: 0.4 });
      if (tip) {
        tip.rotateX(HALF_PI);
        gb.add(tip, { ...M, at: [_p.x, _p.y, _p.z + half * 1.0], rot: [0, 0, ang], color: o.tip || '#b0703a', mat: GM.BRASS, round: true });
        // the steel link round each case
        rbox(gb, -0.06, 0.06, -r * 1.25, r * 1.25, -half * 0.35, half * 0.35, 0.03, { ...M, at: [_p.x, _p.y, _p.z - half * 0.2], rot: [0, 0, ang], color: '#34363a', mat: GM.STEEL, seg: 1 });
      }
    }
  };

  /** An ammo box (steel can or soft pouch) hung under / beside the gun. */
  P.ammoBox = (gb, x0, x1, y0, y1, z0, z1, o = {}) => {
    const M = { part: o.part || 'mag' };
    const col = o.color || '#4b5a2e';
    rbox(gb, x0, x1, y0, y1, z0, z1, o.soft ? 0.45 : 0.22, { ...M, color: col, mat: o.soft ? GM.RUBBER : GM.PAINT });
    if (!K.lite()) {
      rbox(gb, x0 - 0.05, x1 + 0.05, y1 - 0.5, y1 + 0.05, z0 - 0.05, z1 + 0.05, 0.12, { ...M, color: shadeHex(col, -0.12), mat: o.soft ? GM.RUBBER : GM.PAINT });   // lid
      rbox(gb, (x0 + x1) / 2 - 0.6, (x0 + x1) / 2 + 0.6, y0 + (y1 - y0) * 0.45, y0 + (y1 - y0) * 0.58, z0 - 0.08, z0, 0.04, { ...M, color: '#d8c890', mat: GM.PAINT });   // stencil band
      rbox(gb, x1 - 0.1, x1 + 0.25, y1 - 1.2, y1 - 0.3, (z0 + z1) / 2 - 0.4, (z0 + z1) / 2 + 0.4, 0.06, { ...M, color: '#2a2c2e', mat: GM.STEEL });   // latch
    }
  };

  // ---- misc ----------------------------------------------------------------------------------

  /** A folded bipod under the handguard (two legs with feet, the clamp). */
  P.bipod = (gb, x, y, o = {}) => {
    rbox(gb, x - 0.6, x + 0.6, y - 0.55, y + 0.1, -0.7, 0.7, 0.15, { color: '#151617', mat: GM.ALLOY, part: o.part });
    for (const s of [-1, 1]) {
      cylX(gb, x - (o.len ?? 6.5), x - 0.4, y - 0.4, s * 0.42, 0.17, 0.2, { color: '#18191a', mat: GM.ALLOY, seg: 10, part: o.part });
      rbox(gb, x - (o.len ?? 6.5) - 0.5, x - (o.len ?? 6.5) + 0.2, y - 0.62, y - 0.18, s * 0.42 - 0.24, s * 0.42 + 0.24, 0.12, { color: RUBBER, mat: GM.RUBBER, part: o.part });
    }
  };

  /** A vertical foregrip on the handguard's bottom rail. */
  P.vgrip = (gb, x, y, o = {}) => {
    rbox(gb, x - 0.9, x + 0.9, y - 0.4, y + 0.05, -0.5, 0.5, 0.12, { color: '#151617', mat: GM.ALLOY, part: o.part });
    latheX(gb, [[0, 0], [0, 0.55], [0.3, 0.6], [2.9, 0.52], [3.2, 0.42], [3.25, 0]], 0, 0, { color: o.color || '#1b1c1e', mat: GM.POLY, seg: 16, part: o.part, at: [x, y - 0.3, 0], rot: [0, 0, -HALF_PI - 0.08] });
  };

  void STEEL; void DARK; void sphere; void tubePath;
  return P;
}
