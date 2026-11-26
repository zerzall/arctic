// Sheet 'signs': stamped and printed signage. Hazard, biohazard, flammable and high-voltage plates,
// exit and no-entry signs, the army's "military installation" warning, hospital wayfinding (wards,
// ICU, emergency, radiology, surgery, Stair B), metro line maps and platform signs, street name
// plates, rail warnings and a crossbuck, road signs, a fire evacuation plan, the ranger station's
// fire-danger board and the dam's spillway warning. Clean, worn and damaged (rust, scratches,
// bullet holes, dents) variants.

import {
  plate, print, textMask, fitSize, age, biohazard, runningMan, arrowPoly, ngon, para, screw,
  C, hex, mix3, mul3, fbm, hash2, smoothstep, clamp01,
} from './kit.js';

const S = 'signs';
const V3 = ['clean', 'worn', 'damaged'];
const V2 = ['clean', 'worn'];
const lvl = (v) => (v === 'clean' ? 0 : v === 'worn' ? 1 : 2);
const done = (c, rng, v) => age(c, lvl(v), rng, { kind: 'metal' });

/** Text centred at (cx, y) fitted to width w. */
function line(c, str, cx, y, w, max, col, o = {}) {
  const size = fitSize(str, w, max, o.gap ?? 1.1, o.squash ?? 1);
  return print(c, str, cx, y, size, col, { align: 'center', weight: o.weight ?? 0.17, squash: o.squash, gap: o.gap, emboss: o.emboss });
}

export function register(R) {
  // ---- hazard family ----------------------------------------------------------------------------
  R('sign.hazard', { sheet: S, px: [320, 288], size: [14, 12.6], surf: 'wall', tags: ['sign', 'hazard'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    const tri = (s) => [[w / 2, h * 0.5 - s * 0.55], [w / 2 + s * 0.62, h * 0.5 + s * 0.5], [w / 2 - s * 0.62, h * 0.5 + s * 0.5]];
    const outer = c.mask().poly(tri(h * 0.98)).blur(4).thresh(0.5, 0.15);
    c.paint(outer, C.black, 1, { rough: 0.4 });
    c.lift(outer.clone().blur(2), 3);
    const inner = c.mask().poly(tri(h * 0.78)).blur(3).thresh(0.5, 0.15);
    c.paint(inner, C.yellow, 1, { rough: 0.4 });
    const ex = c.mask().poly([[w / 2 - h * 0.045, h * 0.34], [w / 2 + h * 0.045, h * 0.34], [w / 2 + h * 0.025, h * 0.66], [w / 2 - h * 0.025, h * 0.66]]).circle(w / 2, h * 0.75, h * 0.045);
    c.paint(ex, C.black);
    c.lift(ex, 1);
    done(c, rng, v);
  });
  R('sign.biohazard', { sheet: S, px: [320, 400], size: [12, 15], surf: 'wall', tags: ['sign', 'hazard', 'biohazard', 'hospital', 'military'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    const { inner } = plate(c, w / 2, h / 2, w - 6, h - 6, C.yellow, { rng, rimCol: C.black });
    void inner;
    c.paint(biohazard(c, w / 2, h * 0.38, w * 0.36), C.black);
    c.paint(c.mask().rect(w / 2, h * 0.8, w - 30, h * 0.2, 4), C.black);
    line(c, 'BIOHAZARD', w / 2, h * 0.745, w * 0.78, h * 0.1, C.yellow, { weight: 0.2 });
    done(c, rng, v);
  });
  R('sign.flammable', { sheet: S, px: [320, 320], size: [12, 12], surf: 'wall', tags: ['sign', 'hazard', 'industrial'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    const dia = c.mask().poly(ngon(w / 2, h / 2, w * 0.48, 4, 0)).blur(3).thresh(0.5, 0.1);
    c.paint(dia, hex('#c8201e'), 1, { rough: 0.4 });
    c.lift(dia.clone().blur(2), 3);
    const rim = c.mask().poly(ngon(w / 2, h / 2, w * 0.44, 4, 0)).cut(c.mask().poly(ngon(w / 2, h / 2, w * 0.415, 4, 0)));
    c.paint(rim, C.white);
    // the flame
    const f = c.mask();
    f.poly([[w * 0.5, h * 0.18], [w * 0.62, h * 0.36], [w * 0.6, h * 0.48], [w * 0.4, h * 0.48], [w * 0.38, h * 0.36]]).ellipse(w / 2, h * 0.45, w * 0.11, h * 0.06);
    f.cut(c.mask().ellipse(w / 2, h * 0.44, w * 0.035, h * 0.06));
    c.paint(f.blur(1), C.white);
    c.paint(c.mask().rect(w / 2, h * 0.52, w * 0.3, h * 0.015, 0), C.white);
    line(c, 'FLAMMABLE', w / 2, h * 0.58, w * 0.5, h * 0.07, C.white, { weight: 0.18 });
    line(c, '3', w / 2, h * 0.7, w * 0.2, h * 0.12, C.white, { weight: 0.2 });
    done(c, rng, v);
  });
  R('sign.highvoltage', { sheet: S, px: [416, 288], size: [20, 13.8], surf: 'wall', tags: ['sign', 'hazard', 'rail', 'industrial'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 6, rim: false });
    c.paint(c.mask().rect(w / 2, h * 0.24, w - 22, h * 0.34, 3), C.black);
    c.paint(c.mask().ellipse(w / 2, h * 0.24, w * 0.4, h * 0.13), hex('#c8201e'));
    c.paint(c.mask().ellipse(w / 2, h * 0.24, w * 0.36, h * 0.105).cut(c.mask().ellipse(w / 2, h * 0.24, w * 0.34, h * 0.09)), C.white);
    line(c, 'DANGER', w / 2, h * 0.17, w * 0.5, h * 0.14, C.white, { weight: 0.2 });
    line(c, 'HIGH VOLTAGE', w / 2, h * 0.5, w * 0.8, h * 0.14, C.black, { weight: 0.2 });
    line(c, 'KEEP OUT', w / 2, h * 0.72, w * 0.5, h * 0.11, C.black, { weight: 0.18 });
    const bolt = c.mask().poly([[w * 0.12, h * 0.5], [w * 0.2, h * 0.5], [w * 0.15, h * 0.66], [w * 0.22, h * 0.66], [w * 0.1, h * 0.9], [w * 0.13, h * 0.72], [w * 0.07, h * 0.72]]);
    c.paint(bolt, hex('#c8201e'));
    done(c, rng, v);
  });

  // ---- exit and entry ---------------------------------------------------------------------------
  R('sign.exit', { sheet: S, px: [384, 192], size: [16, 8], surf: 'wall', tags: ['sign', 'exit', 'interior'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.signGreen, { rng, radius: 6, rimCol: C.white, screws: 2, rough: 0.3 });
    c.paint(runningMan(c, w * 0.08, h * 0.18, h * 0.62), C.white);
    c.paint(c.mask().poly([[w * 0.32, h * 0.2], [w * 0.38, h * 0.2], [w * 0.38, h * 0.8], [w * 0.32, h * 0.8]]), C.white, 0.9);
    line(c, 'EXIT', w * 0.6, h * 0.27, w * 0.32, h * 0.46, C.white, { weight: 0.2 });
    c.paint(c.mask().poly(arrowPoly(w * 0.79, h / 2, w * 0.93, h / 2, h * 0.12, h * 0.36, h * 0.18)), C.white);
    done(c, rng, v);
  });
  R('sign.noentry', { sheet: S, px: [288, 288], size: [12, 12], surf: 'wall', tags: ['sign', 'noentry', 'road'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    const d = c.mask().circle(w / 2, h / 2, w * 0.47);
    c.paint(d, hex('#c8201e'), 1, { rough: 0.35 });
    c.lift(d.clone().blur(2), 3);
    c.paint(c.mask().circle(w / 2, h / 2, w * 0.47).cut(c.mask().circle(w / 2, h / 2, w * 0.44)), C.white);
    const bar = c.mask().rect(w / 2, h / 2, w * 0.66, h * 0.16, 2);
    c.paint(bar, C.white);
    c.lift(bar, 1);
    done(c, rng, v);
  });
  R('sign.donotenter', { sheet: S, px: [384, 256], size: [16, 10.7], surf: 'wall', tags: ['sign', 'noentry', 'interior'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#c8201e'), { rng, radius: 8, rimCol: C.white });
    line(c, 'DO NOT', w / 2, h * 0.2, w * 0.7, h * 0.28, C.white, { weight: 0.2 });
    line(c, 'ENTER', w / 2, h * 0.53, w * 0.72, h * 0.3, C.white, { weight: 0.21 });
    done(c, rng, v);
  });
  R('sign.military', { sheet: S, px: [448, 320], size: [26, 18.6], surf: 'wall', tags: ['sign', 'military'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 4, rim: false });
    c.paint(c.mask().rect(w / 2, h * 0.14, w - 20, h * 0.2, 2), hex('#c8201e'));
    line(c, 'WARNING', w / 2, h * 0.07, w * 0.5, h * 0.15, C.white, { weight: 0.2 });
    line(c, 'MILITARY INSTALLATION', w / 2, h * 0.3, w * 0.86, h * 0.1, C.black, { weight: 0.18 });
    line(c, 'AUTHORIZED PERSONNEL ONLY', w / 2, h * 0.46, w * 0.82, h * 0.07, C.black, { weight: 0.16 });
    para(c, w * 0.12, h * 0.6, w * 0.76, h * 0.03, 2, mul3(C.black, 1), rng, { full: true });
    c.paint(c.mask().rect(w / 2, h * 0.84, w - 20, h * 0.15, 2), C.black);
    line(c, 'USE OF DEADLY FORCE AUTHORIZED', w / 2, h * 0.8, w * 0.86, h * 0.07, C.white, { weight: 0.16 });
    done(c, rng, v);
  });
  R('sign.restricted', { sheet: S, px: [384, 256], size: [20, 13.3], surf: 'wall', tags: ['sign', 'military', 'industrial'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 4, rimCol: hex('#c8201e') });
    line(c, 'RESTRICTED', w / 2, h * 0.16, w * 0.8, h * 0.24, hex('#c8201e'), { weight: 0.2 });
    line(c, 'AREA', w / 2, h * 0.43, w * 0.4, h * 0.2, hex('#c8201e'), { weight: 0.2 });
    line(c, 'KEEP OUT', w / 2, h * 0.7, w * 0.6, h * 0.14, C.black, { weight: 0.18 });
    done(c, rng, v);
  });

  // ---- hospital wayfinding ------------------------------------------------------------------------
  const HOSP = [
    ['sign.ward-c', 'WARD C', '>', 'BEDS 1-24'],
    ['sign.icu', 'ICU', '<', 'INTENSIVE CARE'],
    ['sign.radiology', 'RADIOLOGY', '<', 'X-RAY · CT · MRI'],
    ['sign.surgery', 'SURGERY', '^', 'THEATRES 1-2'],
    ['sign.stairb', 'STAIR B', '^', 'ROOF ACCESS'],
    ['sign.pharmacy', 'PHARMACY', '>', 'STAFF ONLY'],
  ];
  for (const [id, title, arrow, sub] of HOSP) {
    R(id, { sheet: S, px: [448, 160], size: [24, 8.6], surf: 'wall', tags: ['sign', 'hospital', 'interior'], variants: V2 }, (c, rng, v) => {
      const { w, h } = c;
      plate(c, w / 2, h / 2, w - 6, h - 6, C.hospBlue, { rng, radius: 6, rim: false, screws: 2, rough: 0.35 });
      c.paint(c.mask().rect(w * 0.13, h / 2, h * 0.66, h * 0.66, 6), C.white);
      print(c, arrow, w * 0.13, h * 0.26, h * 0.46, C.hospBlue, { align: 'center', weight: 0.2 });
      const size = fitSize(title, w * 0.66, h * 0.36);
      print(c, title, w * 0.27, h * 0.16, size, C.white, { weight: 0.18 });
      print(c, sub, w * 0.27, h * 0.62, Math.min(h * 0.18, fitSize(sub, w * 0.6, h * 0.18)), hex('#cfe0f4'), { weight: 0.15 });
      done(c, rng, v);
    });
  }
  R('sign.emergency', { sheet: S, px: [512, 160], size: [32, 10], surf: 'wall', tags: ['sign', 'hospital'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 6, rim: false, screws: 2 });
    c.paint(c.mask().rect(w * 0.09, h / 2, h * 0.5, h * 0.14, 1).rect(w * 0.09, h / 2, h * 0.14, h * 0.5, 1), C.red);
    line(c, 'EMERGENCY', w * 0.56, h * 0.22, w * 0.76, h * 0.5, C.red, { weight: 0.2 });
    done(c, rng, v);
  });
  R('sign.evacplan', { sheet: S, px: [320, 256], size: [12, 9.6], surf: 'wall', tags: ['sign', 'interior', 'hospital', 'office'], variants: V2 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#f2f0ea'), { rng, radius: 3, rim: false, rough: 0.2 });
    c.paint(c.mask().rect(w / 2, h * 0.09, w - 16, h * 0.12, 0), C.signGreen);
    line(c, 'FIRE EVACUATION PLAN', w / 2, h * 0.055, w * 0.8, h * 0.08, C.white, { weight: 0.16 });
    // the floor plan: rooms and a corridor, the escape route in green arrows, YOU ARE HERE
    const pl = c.mask();
    const x0 = w * 0.08, y0 = h * 0.2, x1 = w * 0.92, y1 = h * 0.9;
    pl.strokeButt([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], 2);
    for (let k = 1; k < 5; k++) pl.bar(x0 + (x1 - x0) * k / 5, y0, x0 + (x1 - x0) * k / 5, y0 + (y1 - y0) * 0.38, 1);
    for (let k = 1; k < 4; k++) pl.bar(x0 + (x1 - x0) * k / 4, y1, x0 + (x1 - x0) * k / 4, y1 - (y1 - y0) * 0.35, 1);
    pl.bar(x0, y0 + (y1 - y0) * 0.38, x1, y0 + (y1 - y0) * 0.38, 1).bar(x0, y1 - (y1 - y0) * 0.35, x1, y1 - (y1 - y0) * 0.35, 1);
    c.paint(pl, hex('#3a3a3a'));
    const ym = (y0 + y1) / 2 + 2;
    c.paint(c.mask().poly(arrowPoly(w * 0.5, ym, w * 0.16, ym, 4, 12, 10)).poly(arrowPoly(w * 0.55, ym, w * 0.86, ym, 4, 12, 10)), C.green);
    c.paint(c.mask().circle(w * 0.52, ym, 6), C.red);
    print(c, 'YOU ARE HERE', w * 0.4, ym + 10, 8, C.red, { weight: 0.15 });
    done(c, rng, v);
  });

  // ---- metro --------------------------------------------------------------------------------------
  const METRO = [
    ['sign.metro-map', [['#d8352a', ['UNION', 'HARLAN SQ', 'MERCY', 'WESTGATE', 'DEPOT']], ['#1f6fc9', ['AIRPORT', 'UNION', 'CIVIC CTR', 'HOLLOW CR']], ['#2a9a48', ['STADIUM', 'HARLAN SQ', 'RIVERSIDE']]]],
    ['sign.metro-map2', [['#f2a516', ['NORTH', 'CANAL ST', 'HARLAN SQ', 'SOUTH']], ['#8a3ab9', ['DAM RD', 'UNION', 'MARKET']], ['#d8352a', ['UNION', 'MERCY', 'DEPOT']]]],
  ];
  for (const [id, lines] of METRO) {
    R(id, { sheet: S, px: [640, 320], size: [44, 22], surf: 'wall', tags: ['sign', 'metro', 'interior'], variants: V2 }, (c, rng, v) => {
      const { w, h } = c;
      plate(c, w / 2, h / 2, w - 6, h - 6, hex('#f4f4f0'), { rng, radius: 4, rim: false, rough: 0.15 });
      c.paint(c.mask().rect(w / 2, h * 0.08, w - 14, h * 0.12, 0), hex('#1b2230'));
      print(c, 'HARLAN METRO · SYSTEM MAP', w * 0.05, h * 0.045, h * 0.07, C.white, { weight: 0.16 });
      lines.forEach(([col, stations], li) => {
        const y = h * (0.32 + li * 0.22);
        const x0 = w * 0.07 + li * w * 0.04, x1 = w * 0.93 - (2 - li) * w * 0.03;
        const pts = [[x0, y], [x0 + (x1 - x0) * 0.3, y], [x0 + (x1 - x0) * 0.4, y + (li === 1 ? -h * 0.1 : h * 0.06)], [x1, y + (li === 1 ? -h * 0.1 : h * 0.06)]];
        c.paint(c.mask().stroke(pts, h * 0.035), hex(col));
        stations.forEach((st, k) => {
          const t = stations.length > 1 ? k / (stations.length - 1) : 0;
          const px = x0 + (x1 - x0) * t, py = t < 0.3 ? y : t < 0.4 ? y + (li === 1 ? -h * 0.1 : h * 0.06) * (t - 0.3) / 0.1 : y + (li === 1 ? -h * 0.1 : h * 0.06);
          const hub = st === 'UNION' || st === 'HARLAN SQ';
          c.paint(c.mask().circle(px, py, h * (hub ? 0.03 : 0.022)), C.black);
          c.paint(c.mask().circle(px, py, h * (hub ? 0.02 : 0.013)), C.white);
          print(c, st, px - 4, py + h * 0.035, h * 0.035, hex('#222'), { weight: 0.14 });
        });
      });
      done(c, rng, v);
    });
  }
  R('sign.metro-platform', { sheet: S, px: [512, 128], size: [40, 10], surf: 'wall', tags: ['sign', 'metro', 'interior'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#1b2230'), { rng, radius: 4, rim: false, screws: 2, rough: 0.3 });
    c.paint(c.mask().circle(w * 0.07, h / 2, h * 0.32), hex('#d8352a'));
    print(c, 'R', w * 0.07, h * 0.3, h * 0.4, C.white, { align: 'center', weight: 0.2 });
    print(c, 'PLATFORM 2', w * 0.15, h * 0.2, h * 0.3, C.white, { weight: 0.17 });
    print(c, 'TO HARLAN SQ >', w * 0.15, h * 0.58, h * 0.24, hex('#f2c315'), { weight: 0.16 });
    done(c, rng, v);
  });
  R('sign.metro-line', { sheet: S, px: [448, 128], size: [36, 10], surf: 'wall', tags: ['sign', 'metro', 'interior'], variants: V2 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#f2c315'), { rng, radius: 3, rim: false, screws: false, rough: 0.4 });
    line(c, 'STAND BEHIND THE YELLOW LINE', w / 2, h * 0.3, w * 0.9, h * 0.38, C.black, { weight: 0.17 });
    done(c, rng, v);
  });

  // ---- street name plates ---------------------------------------------------------------------
  const STREETS = [['sign.street-mill', 'MILL RD'], ['sign.street-main', 'MAIN ST'], ['sign.street-church', 'CHURCH ST'], ['sign.street-harlan', 'HARLAN AVE'], ['sign.street-depot', 'DEPOT RD']];
  for (const [id, name] of STREETS) {
    R(id, { sheet: S, px: [384, 96], size: [26, 6.5], surf: 'wall', tags: ['sign', 'street'], variants: V3 }, (c, rng, v) => {
      const { w, h } = c;
      plate(c, w / 2, h / 2, w - 6, h - 6, C.signGreen, { rng, radius: 6, rimCol: C.white, screws: 2, rough: 0.35, rimInset: 0.08 });
      line(c, name, w / 2, h * 0.24, w * 0.74, h * 0.52, C.white, { weight: 0.18 });
      done(c, rng, v);
    });
  }

  // ---- rail ----------------------------------------------------------------------------------------
  R('sign.rail-danger', { sheet: S, px: [384, 288], size: [20, 15], surf: 'wall', tags: ['sign', 'rail'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 4, rim: false });
    c.paint(c.mask().rect(w / 2, h * 0.17, w - 20, h * 0.26, 2), hex('#c8201e'));
    line(c, 'DANGER', w / 2, h * 0.08, w * 0.6, h * 0.19, C.white, { weight: 0.2 });
    line(c, 'KEEP OFF', w / 2, h * 0.36, w * 0.6, h * 0.15, C.black, { weight: 0.19 });
    line(c, 'THE TRACKS', w / 2, h * 0.53, w * 0.7, h * 0.13, C.black, { weight: 0.19 });
    line(c, 'TRAINS CAN COME FROM EITHER DIRECTION', w / 2, h * 0.74, w * 0.86, h * 0.06, C.black, { weight: 0.15 });
    line(c, 'TRESPASSERS WILL BE PROSECUTED', w / 2, h * 0.84, w * 0.8, h * 0.05, C.black, { weight: 0.14 });
    done(c, rng, v);
  });
  R('sign.crossbuck', { sheet: S, px: [416, 416], size: [30, 30], surf: 'wall', tags: ['sign', 'rail', 'road'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    for (const [a, word] of [[-Math.PI / 4, 'CROSSING'], [Math.PI / 4, 'RAILROAD']]) {
      const b = c.mask().rect(w / 2, h / 2, w * 0.96, h * 0.17, 4, a);
      c.paint(b, C.white, 1, { rough: 0.4 });
      c.lift(b.clone().blur(1.5), 3);
      c.paint(c.mask().rect(w / 2, h / 2, w * 0.96, h * 0.17, 4, a).cut(c.mask().rect(w / 2, h / 2, w * 0.93, h * 0.135, 4, a)), C.black);
      c.paint(textMask(c, word, w / 2, h / 2, h * 0.085, 'sign', { align: 'center', valign: 'middle', rot: a, weight: 0.2, gap: 2.2 }), C.black);
    }
    screw(c, w / 2, h / 2, 6);
    done(c, rng, v);
  });

  // ---- road --------------------------------------------------------------------------------------
  R('sign.speed35', { sheet: S, px: [256, 320], size: [12, 15], surf: 'wall', tags: ['sign', 'road'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 10, rimCol: C.black, screws: 2 });
    line(c, 'SPEED', w / 2, h * 0.12, w * 0.6, h * 0.14, C.black, { weight: 0.18 });
    line(c, 'LIMIT', w / 2, h * 0.3, w * 0.6, h * 0.14, C.black, { weight: 0.18 });
    line(c, '35', w / 2, h * 0.5, w * 0.6, h * 0.36, C.black, { weight: 0.2 });
    done(c, rng, v);
  });
  R('sign.roadclosed', { sheet: S, px: [448, 224], size: [30, 15], surf: 'wall', tags: ['sign', 'road', 'military'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 4, rim: false });
    const st = c.mask();
    for (let k = -4; k < 12; k++) st.poly([[k * 40, h * 0.66], [k * 40 + 20, h * 0.66], [k * 40 + 20 + 30, h * 0.96], [k * 40 + 30, h * 0.96]]);
    st.min(c.mask().rect(w / 2, h * 0.81, w - 14, h * 0.28, 0));
    c.paint(st, C.orange);
    line(c, 'ROAD CLOSED', w / 2, h * 0.14, w * 0.86, h * 0.3, C.black, { weight: 0.2 });
    line(c, 'BY ORDER OF THE NATIONAL GUARD', w / 2, h * 0.5, w * 0.8, h * 0.07, C.black, { weight: 0.15 });
    done(c, rng, v);
  });

  // ---- places -----------------------------------------------------------------------------------
  R('sign.spillway', { sheet: S, px: [416, 288], size: [22, 15], surf: 'wall', tags: ['sign', 'dam', 'hazard'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, C.white, { rng, radius: 4, rim: false });
    c.paint(c.mask().rect(w / 2, h * 0.17, w - 20, h * 0.26, 2), C.black);
    c.paint(c.mask().ellipse(w / 2, h * 0.17, w * 0.38, h * 0.1), hex('#c8201e'));
    line(c, 'DANGER', w / 2, h * 0.115, w * 0.42, h * 0.12, C.white, { weight: 0.2 });
    line(c, 'SPILLWAY', w / 2, h * 0.37, w * 0.66, h * 0.15, C.black, { weight: 0.19 });
    line(c, 'STRONG CURRENTS', w / 2, h * 0.55, w * 0.7, h * 0.09, C.black, { weight: 0.17 });
    line(c, 'GATES MAY OPEN WITHOUT WARNING', w / 2, h * 0.7, w * 0.84, h * 0.06, C.black, { weight: 0.15 });
    line(c, 'BLACKWATER DAM AUTHORITY', w / 2, h * 0.84, w * 0.6, h * 0.05, hex('#444'), { weight: 0.14 });
    done(c, rng, v);
  });
  R('sign.firedanger', { sheet: S, px: [384, 320], size: [22, 18], surf: 'wall', tags: ['sign', 'forest'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#5a3a22'), { rng, radius: 6, rimCol: hex('#e8d9b0'), rough: 0.8 });
    line(c, 'FIRE DANGER', w / 2, h * 0.08, w * 0.76, h * 0.13, hex('#e8d9b0'), { weight: 0.18 });
    line(c, 'TODAY', w / 2, h * 0.24, w * 0.3, h * 0.08, hex('#e8d9b0'), { weight: 0.16 });
    // the gauge: a half disc of five bands and a needle at EXTREME
    const cx = w / 2, cy = h * 0.84, R0 = w * 0.36;
    const cols = ['#2a9a48', '#1f6fc9', '#f2c315', '#e8641a', '#c8201e'];
    cols.forEach((col, k) => {
      const a0 = Math.PI + (k / 5) * Math.PI, a1 = Math.PI + ((k + 1) / 5) * Math.PI;
      const pts = [[cx, cy]];
      for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; pts.push([cx + Math.cos(a) * R0, cy + Math.sin(a) * R0]); }
      c.paint(c.mask().poly(pts), hex(col));
    });
    c.paint(c.mask().circle(cx, cy, R0 * 0.35), hex('#5a3a22'));
    const na = Math.PI * 1.9;
    c.paint(c.mask().capsule(cx, cy, cx + Math.cos(na) * R0 * 0.95, cy + Math.sin(na) * R0 * 0.95, 4, 2).circle(cx, cy, 9), C.black);
    line(c, 'EXTREME', w / 2, h * 0.88, w * 0.36, h * 0.07, hex('#e8d9b0'), { weight: 0.17 });
    done(c, rng, v);
  });
  R('sign.airfield', { sheet: S, px: [512, 256], size: [36, 18], surf: 'wall', tags: ['sign', 'military', 'airbase'], variants: V3 }, (c, rng, v) => {
    const { w, h } = c;
    plate(c, w / 2, h / 2, w - 6, h - 6, hex('#2b3a24'), { rng, radius: 4, rimCol: hex('#e8e2d0') });
    const st = [];
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? h * 0.08 : h * 0.2; st.push([w * 0.15 + Math.cos(a) * r, h * 0.48 + Math.sin(a) * r]); }
    c.paint(c.mask().poly(st), hex('#e8e2d0'));
    print(c, 'FORT HARLAN', w * 0.3, h * 0.18, fitSize('FORT HARLAN', w * 0.62, h * 0.22), hex('#e8e2d0'), { weight: 0.19 });
    print(c, 'ARMY AIRFIELD', w * 0.3, h * 0.46, fitSize('ARMY AIRFIELD', w * 0.62, h * 0.15), hex('#f2c315'), { weight: 0.17 });
    print(c, 'ALL VISITORS REPORT TO GATE 1', w * 0.3, h * 0.7, fitSize('ALL VISITORS REPORT TO GATE 1', w * 0.62, h * 0.08), hex('#e8e2d0'), { weight: 0.14 });
    done(c, rng, v);
  });
  R('sign.mallsale', { sheet: S, px: [320, 320], size: [14, 14], surf: 'wall', tags: ['sign', 'mall', 'interior'], variants: V2 }, (c, rng, v) => {
    const { w, h } = c;
    const st = [];
    for (let k = 0; k < 28; k++) { const a = (k / 28) * Math.PI * 2, r = k % 2 ? w * 0.41 : w * 0.48; st.push([w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]); }
    const m = c.mask().poly(st);
    c.paint(m, hex('#e81e4a'), 1, { rough: 0.5 });
    c.lift(m.clone().blur(1), 1.5);
    line(c, 'SALE', w / 2, h * 0.27, w * 0.6, h * 0.22, C.white, { weight: 0.2 });
    line(c, '50% OFF', w / 2, h * 0.52, w * 0.56, h * 0.16, hex('#ffe14a'), { weight: 0.2 });
    age(c, lvl(v), rng, { kind: 'paper' });
  });
}
