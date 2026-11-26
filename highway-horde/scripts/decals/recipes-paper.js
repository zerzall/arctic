// Sheet 'paper': posters and notices. Missing-person flyers with photocopied portraits and tear-off
// tabs, the county's evacuation notice, the "Haven is open" radio flyer, the army's curfew and the
// CDC's quarantine notice, government propaganda, the old world's ads and gig posters, torn layers of
// paper, handwritten notes the survivors left (Deke at the gas station, Ruth Delaney at the school,
// Okafor's unit at the airfield), polaroids and a kid's drawing. Clean, worn and torn variants.

import {
  paper, tape, portrait, para, print, textMask, fitSize, regionMap, age, spray, biohazard, arrowPoly, ngon,
  C, hex, mix3, mul3, fbm, hash2, smoothstep, clamp01,
} from './kit.js';

const S = 'paper';
const POSTER = { sheet: S, px: [320, 448], size: [15, 21], surf: 'wall', variants: ['clean', 'worn', 'torn'] };
const FLYER = { sheet: S, px: [288, 384], size: [12, 16], surf: 'wall', variants: ['clean', 'worn', 'torn'] };

/** Text centred across the sheet, fitted to `wf` of its width. */
function head(c, str, y, maxSize, col, o = {}) {
  const size = fitSize(str, c.w * (o.wf ?? 0.84), maxSize, o.gap ?? 1.1, o.squash ?? 1);
  return print(c, str, c.w / 2, y, size, col, { align: 'center', style: o.style || 'sign', rng: o.rng, weight: o.weight, squash: o.squash, gap: o.gap });
}

const wearOf = (v) => (v === 'clean' ? 0 : v === 'worn' ? 1 : 2);

/** Sheet + content + tape + wear: the common frame of a poster. */
function sheet(c, rng, v, col, draw, o = {}) {
  const { w, h } = c;
  const pm = paper(c, w / 2, h / 2, w - 4, h - 4, { rng, color: col, wrinkle: o.wrinkle ?? (v === 'clean' ? 0.25 : 0.6), edge: v === 'clean' ? 0.3 : 1.2 });
  draw(pm);
  if (o.tape !== false) tape(c, w / 2, h / 2, w - 18, h - 18, 0, rng, o.tapeAt || [0, 1]);
  if (o.staples) for (const [x, y] of [[0.08, 0.04], [0.92, 0.04], [0.5, 0.96]]) { const m = c.mask().capsule(w * x - 4, h * y, w * x + 4, h * y, 1.2); c.paint(m, [0.7, 0.7, 0.72], 1, { rough: 0.3 }); c.lift(m, 1); }
  age(c, wearOf(v), rng, { kind: 'paper' });
  return pm;
}

/** Tear-off tabs along the bottom: vertical strips with a phone number; some torn off. */
function tabs(c, rng, y0, number, v) {
  const { w, h } = c;
  const n = 7, tw = (w - 10) / n;
  for (let i = 0; i < n; i++) {
    const x = 5 + i * tw;
    const cut = c.mask().rect(x, (y0 + h) / 2, 1.1, h - y0, 0);
    c.paint(cut, [0.45, 0.43, 0.4], 0.8);
    const m = textMask(c, number, x + tw / 2, y0 + 6, Math.min(tw * 0.55, 13), 'thin', { rng, rot: Math.PI / 2, weight: 0.13 });
    c.paint(m, C.ink, 0.85);
    if ((v !== 'clean' && rng.chance(0.45)) || rng.chance(0.15)) c.erase(c.mask().rect(x + tw / 2, (y0 + h) / 2 + 3, tw - 1, h - y0 + 2, 0).warp(1.2, 0.3, rng.seed()));
  }
}

export function register(R) {
  // ---- missing persons -----------------------------------------------------------------------
  const MISSING = [
    ['poster.missing-reyes', 'DANIEL REYES', 'AGE 34 · 5\'11" · LAST SEEN DAY 3 ON HWY 9', { hair: 0.1 }, '555-0142'],
    ['poster.missing-hart', 'LILY HART', 'AGE 8 · RED COAT · LAST SEEN AT THE SCHOOL', { child: true, long: true, hair: 0.55 }, '555-0179'],
    ['poster.missing-okoye', 'GRACE OKOYE', 'AGE 71 · NEEDS HER MEDICINE · PLEASE', { hair: 0.75, smile: false }, '555-0110'],
  ];
  for (const [id, name, detail, look, num] of MISSING) {
    R(id, { ...POSTER, tags: ['poster', 'missing', 'paper'] }, (c, rng, v) => {
      const { w, h } = c;
      sheet(c, rng, v, C.paper, () => {
        head(c, 'MISSING', h * 0.035, h * 0.12, C.red, { rng, weight: 0.2 });
        portrait(c, w * 0.17, h * 0.18, w * 0.66, h * 0.4, { rng, ...look });
        head(c, name, h * 0.61, h * 0.06, C.ink, { rng, weight: 0.17 });
        head(c, detail, h * 0.69, h * 0.025, C.ink, { rng, wf: 0.9, weight: 0.13 });
        para(c, w * 0.1, h * 0.74, w * 0.8, h * 0.017, 2, C.ink, rng);
        head(c, 'CALL ' + num, h * 0.8, h * 0.035, C.ink, { rng, weight: 0.16 });
        tabs(c, rng, h * 0.86, num, v);
      });
    });
  }
  // a handwritten one, on lined paper, a photo taped on
  R('poster.missing-hand', { ...FLYER, tags: ['poster', 'missing', 'paper', 'note'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#f1eee2'), () => {
      for (let y = h * 0.12; y < h - 8; y += h * 0.055) c.paint(c.mask().bar(6, y, w - 6, y, 0.6), hex('#8fb3d9'), 0.7);
      c.paint(c.mask().bar(w * 0.12, 4, w * 0.12, h - 4, 0.7), hex('#d98f8f'), 0.7);
      print(c, 'HAVE YOU', w * 0.18, h * 0.04, h * 0.06, hex('#1d2a6e'), { style: 'marker', rng });
      print(c, 'SEEN MY SON?', w * 0.18, h * 0.12, h * 0.06, hex('#1d2a6e'), { style: 'marker', rng });
      // the photo
      const px = w * 0.2, py = h * 0.24, pw = w * 0.6, ph = h * 0.38;
      paper(c, px + pw / 2, py + ph / 2, pw + 12, ph + 12, { rng, color: hex('#f4f2ec'), wrinkle: 0.1 });
      portrait(c, px, py, pw, ph, { rng, child: true, hair: 0.3, contrast: 1.2 });
      regionMap(c, px, py, px + pw, py + ph, (rgb) => mix3(rgb, [rgb[0] * 1.05, rgb[1] * 0.95, rgb[2] * 0.8], 0.6));
      tape(c, px + pw / 2, py + ph / 2, pw, ph, 0.05, rng, [0, 2]);
      print(c, 'TOMMY, 6', w * 0.18, h * 0.67, h * 0.055, hex('#1d2a6e'), { style: 'marker', rng });
      print(c, 'WE ARE AT THE', w * 0.18, h * 0.76, h * 0.045, hex('#1d2a6e'), { style: 'marker', rng });
      print(c, 'CHURCH. PLEASE', w * 0.18, h * 0.83, h * 0.045, hex('#1d2a6e'), { style: 'marker', rng });
    }, { tapeAt: [0, 1, 2, 3] });
  });

  // ---- official notices ---------------------------------------------------------------------
  R('notice.evac', { ...POSTER, tags: ['poster', 'notice', 'official', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, C.paper, () => {
      c.paint(c.mask().rect(w / 2, h * 0.075, w - 16, h * 0.11, 0), hex('#1c3a6b'));
      head(c, 'EVACUATION NOTICE', h * 0.045, h * 0.05, C.white, { rng, wf: 0.86, weight: 0.17 });
      // county seal
      const sm = c.mask().circle(w / 2, h * 0.24, h * 0.07).cut(c.mask().circle(w / 2, h * 0.24, h * 0.06));
      sm.circle(w / 2, h * 0.24, h * 0.035);
      c.paint(sm, hex('#1c3a6b'), 0.9);
      head(c, 'HARLAN COUNTY OFFICE OF EMERGENCY MANAGEMENT', h * 0.33, h * 0.022, C.ink, { rng, wf: 0.9, weight: 0.13 });
      head(c, 'ALL RESIDENTS MUST', h * 0.39, h * 0.04, C.red, { rng, weight: 0.18 });
      head(c, 'LEAVE IMMEDIATELY', h * 0.445, h * 0.04, C.red, { rng, weight: 0.18 });
      para(c, w * 0.1, h * 0.52, w * 0.8, h * 0.016, 5, C.ink, rng);
      // the route map
      const mx = w * 0.12, my = h * 0.69, mw = w * 0.76, mh = h * 0.18;
      c.paint(c.mask().rect(mx + mw / 2, my + mh / 2, mw, mh, 0), hex('#e2ddcf'));
      const ln = c.mask();
      ln.stroke([[mx + 6, my + mh * 0.7], [mx + mw * 0.4, my + mh * 0.6], [mx + mw * 0.7, my + mh * 0.3], [mx + mw - 6, my + mh * 0.25]], 2.4);
      ln.stroke([[mx + mw * 0.2, my + 4], [mx + mw * 0.3, my + mh - 4]], 1.6);
      c.paint(ln, hex('#6b6a66'));
      c.paint(c.mask().poly(arrowPoly(mx + mw * 0.15, my + mh * 0.55, mx + mw * 0.85, my + mh * 0.12, 4, 12, 12)), C.red, 0.9);
      c.paint(c.mask().rect(mx + mw / 2, my + mh / 2, mw, mh, 0).cut(c.mask().rect(mx + mw / 2, my + mh / 2, mw - 3, mh - 3, 0)), C.ink);
      head(c, 'SHELTER: HARLAN HIGH SCHOOL', h * 0.9, h * 0.026, C.ink, { rng, weight: 0.15 });
    }, { staples: true, tape: false });
  });
  R('notice.curfew', { ...POSTER, tags: ['poster', 'notice', 'official', 'military', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#efe9da'), () => {
      c.paint(c.mask().rect(w / 2, h * 0.11, w - 16, h * 0.17, 0), C.red);
      head(c, 'CURFEW', h * 0.05, h * 0.11, C.white, { rng, weight: 0.22 });
      head(c, '6 PM - 6 AM', h * 0.25, h * 0.08, C.ink, { rng, weight: 0.2 });
      head(c, 'BY ORDER OF THE', h * 0.37, h * 0.03, C.ink, { rng, weight: 0.15 });
      head(c, 'NATIONAL GUARD', h * 0.415, h * 0.045, C.ink, { rng, weight: 0.18 });
      para(c, w * 0.1, h * 0.5, w * 0.8, h * 0.016, 7, C.ink, rng);
      head(c, 'VIOLATORS WILL BE DETAINED', h * 0.78, h * 0.03, C.red, { rng, weight: 0.17 });
      // the star
      const st = [];
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? h * 0.025 : h * 0.06; st.push([w / 2 + Math.cos(a) * r, h * 0.89 + Math.sin(a) * r]); }
      c.paint(c.mask().poly(st), hex('#2b3a24'));
    }, { staples: true, tape: false });
  });
  R('notice.quarantine', { ...POSTER, tags: ['poster', 'notice', 'official', 'quarantine', 'hospital', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#f4f0e2'), () => {
      c.paint(c.mask().rect(w / 2, h / 2, w - 14, h - 14, 0).cut(c.mask().rect(w / 2, h / 2, w - 26, h - 26, 0)), hex('#f2c315'));
      const bio = biohazard(c, w / 2, h * 0.2, h * 0.13);
      c.paint(bio, C.ink);
      head(c, 'QUARANTINE', h * 0.36, h * 0.07, C.ink, { rng, weight: 0.2 });
      head(c, 'IN EFFECT', h * 0.45, h * 0.045, C.red, { rng, weight: 0.18 });
      head(c, 'THIS FACILITY IS SEALED BY ORDER OF THE CDC', h * 0.53, h * 0.022, C.ink, { rng, wf: 0.86, weight: 0.13 });
      para(c, w * 0.12, h * 0.6, w * 0.76, h * 0.016, 6, C.ink, rng);
      head(c, 'DO NOT ENTER · DO NOT LEAVE', h * 0.84, h * 0.03, C.ink, { rng, weight: 0.16 });
    }, { tapeAt: [0, 1, 2, 3] });
  });
  R('notice.boilwater', { ...FLYER, tags: ['poster', 'notice', 'official', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, C.paper, () => {
      head(c, 'BOIL WATER', h * 0.06, h * 0.08, hex('#1f4f9a'), { rng, weight: 0.2 });
      head(c, 'ADVISORY', h * 0.16, h * 0.06, hex('#1f4f9a'), { rng, weight: 0.18 });
      // a drop
      const d = c.mask().circle(w / 2, h * 0.38, h * 0.08).poly([[w / 2 - h * 0.075, h * 0.36], [w / 2, h * 0.24], [w / 2 + h * 0.075, h * 0.36]]);
      c.paint(d, hex('#2a6fd6'));
      para(c, w * 0.1, h * 0.52, w * 0.8, h * 0.02, 8, C.ink, rng);
    });
  });

  // ---- the Haven flyer: photocopied, hand drawn ----------------------------------------------
  R('flyer.haven', { ...POSTER, tags: ['poster', 'haven', 'paper', 'story'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#efe2a6'), () => {
      const ink = hex('#1b1a18');
      const m = c.mask();
      textMask(c, 'HAVEN', w / 2, h * 0.04, fitSize('HAVEN', w * 0.8, h * 0.13), 'marker', { align: 'center', rng, into: m, weight: 0.13, slant: 0.05 });
      textMask(c, 'IS OPEN', w / 2, h * 0.18, fitSize('IS OPEN', w * 0.7, h * 0.08), 'marker', { align: 'center', rng, into: m, weight: 0.12, slant: 0.05 });
      // radio mast with waves
      const mx = w * 0.3, my = h * 0.33;
      m.stroke([[mx - 22, my + 90], [mx, my], [mx + 22, my + 90]], 3);
      for (let k = 1; k < 4; k++) m.stroke([[mx - 22 + k * 5.5, my + 90 - k * 22], [mx + 22 - k * 5.5, my + 90 - k * 22]], 2);
      for (let k = 1; k <= 3; k++) {
        const arcPts = (s) => { const out = []; for (let i = 0; i <= 10; i++) { const a = -0.7 + (i / 10) * 1.4; out.push([mx + s * Math.cos(a) * k * 13, my + Math.sin(a) * k * 13]); } return out; };
        m.stroke(arcPts(1), 2.2); m.stroke(arcPts(-1), 2.2);
      }
      // the lake and a ferry
      const lx = w * 0.68, ly = h * 0.42;
      m.stroke([[lx - 50, ly], [lx - 30, ly - 5], [lx, ly + 2], [lx + 30, ly - 4], [lx + 52, ly + 1]], 2);
      m.stroke([[lx - 30, ly - 8], [lx + 28, ly - 8], [lx + 20, ly + 2], [lx - 22, ly + 2], [lx - 30, ly - 8]], 2.4);
      m.stroke([[lx - 8, ly - 8], [lx - 8, ly - 22], [lx + 10, ly - 22], [lx + 10, ly - 8]], 2.2);
      const s2 = h * 0.04;
      textMask(c, 'LAKE HARLAN MARINA', w / 2, h * 0.56, fitSize('LAKE HARLAN MARINA', w * 0.86, s2), 'marker', { align: 'center', rng, into: m, weight: 0.13 });
      textMask(c, 'FOOD · DOCTORS · BOATS', w / 2, h * 0.63, fitSize('FOOD · DOCTORS · BOATS', w * 0.84, s2 * 0.9), 'marker', { align: 'center', rng, into: m, weight: 0.13 });
      textMask(c, 'LAST FERRY END OF MONTH', w / 2, h * 0.7, fitSize('LAST FERRY END OF MONTH', w * 0.86, s2 * 0.9), 'marker', { align: 'center', rng, into: m, weight: 0.13 });
      textMask(c, 'BRING WHAT YOU CAN CARRY', w / 2, h * 0.77, fitSize('BRING WHAT YOU CAN CARRY', w * 0.86, s2 * 0.8), 'marker', { align: 'center', rng, into: m, weight: 0.13 });
      m.poly(arrowPoly(w * 0.18, h * 0.89, w * 0.84, h * 0.89, 6, 22, 22));
      textMask(c, 'WEST', w * 0.4, h * 0.82, h * 0.03, 'marker', { rng, into: m, weight: 0.14 });
      c.paint(m.blur(0.5), ink, 0.92);
      // photocopy toner speckle and a dark copier edge
      const sp = c.mask().map((x, y) => (hash2(x, y, 77) > 0.996 ? 1 : 0) + smoothstep(0.85, 1, Math.abs(x / w - 0.5) * 2) * 0.35 * fbm(x * 0.05, y * 0.05, 2, 3));
      c.paint(sp.min(c.alphaMask()), ink, 0.7);
    });
  });
  R('flyer.haven-small', { ...FLYER, tags: ['poster', 'haven', 'paper', 'story'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, C.paper, () => {
      const m = c.mask();
      textMask(c, 'HAVEN IS', w / 2, h * 0.08, fitSize('HAVEN IS', w * 0.8, h * 0.12), 'stencil', { align: 'center', rng, into: m });
      textMask(c, 'OPEN', w / 2, h * 0.24, fitSize('OPEN', w * 0.6, h * 0.14), 'stencil', { align: 'center', rng, into: m });
      c.paint(m, hex('#1f6b33'));
      head(c, 'LISTEN ON THE RADIO', h * 0.48, h * 0.04, C.ink, { rng, weight: 0.15 });
      head(c, 'THE WARDEN IS CALLING', h * 0.55, h * 0.04, C.ink, { rng, weight: 0.15 });
      para(c, w * 0.1, h * 0.65, w * 0.8, h * 0.02, 4, C.ink, rng);
      const ar = c.mask().poly(arrowPoly(w * 0.2, h * 0.9, w * 0.82, h * 0.9, 8, 26, 26));
      c.paint(ar, hex('#1f6b33'));
    });
  });

  // ---- propaganda ---------------------------------------------------------------------------
  R('poster.stayinside', { ...POSTER, tags: ['poster', 'propaganda', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#1d3f73'), () => {
      // a sunburst behind a house
      const sb = c.mask();
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; sb.poly([[w / 2, h * 0.36], [w / 2 + Math.cos(a) * w, h * 0.36 + Math.sin(a) * w], [w / 2 + Math.cos(a + 0.18) * w, h * 0.36 + Math.sin(a + 0.18) * w]]); }
      sb.min(c.mask().rect(w / 2, h / 2, w - 10, h - 10, 0));
      c.paint(sb, hex('#2b5596'), 0.9);
      const house = c.mask().poly([[w * 0.3, h * 0.38], [w * 0.5, h * 0.22], [w * 0.7, h * 0.38], [w * 0.66, h * 0.38], [w * 0.66, h * 0.52], [w * 0.34, h * 0.52], [w * 0.34, h * 0.38]]);
      c.paint(house, hex('#f2efe4'));
      c.paint(c.mask().rect(w * 0.5, h * 0.47, w * 0.08, h * 0.1, 0), hex('#c62828'));
      head(c, 'STAY INSIDE.', h * 0.6, h * 0.08, hex('#f2efe4'), { rng, weight: 0.2 });
      head(c, 'STAY ALIVE.', h * 0.72, h * 0.08, hex('#f2c315'), { rng, weight: 0.2 });
      head(c, 'LOCK YOUR DOORS · WAIT FOR INSTRUCTIONS', h * 0.86, h * 0.022, hex('#d8d6cc'), { rng, wf: 0.86, weight: 0.13 });
    });
  });
  R('poster.reportbites', { ...POSTER, tags: ['poster', 'propaganda', 'paper', 'hospital'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#efe9da'), () => {
      c.paint(c.mask().rect(w / 2, h * 0.3, w - 16, h * 0.5, 0), hex('#121212'));
      // a hand with a bite mark
      const hand = c.mask().ellipse(w / 2, h * 0.33, w * 0.16, h * 0.1);
      for (let k = 0; k < 4; k++) hand.capsule(w * (0.4 + k * 0.065), h * 0.28, w * (0.39 + k * 0.07), h * (0.14 + (k === 0 || k === 3 ? 0.03 : 0)), w * 0.03);
      hand.capsule(w * 0.62, h * 0.35, w * 0.74, h * 0.27, w * 0.032);
      hand.rect(w / 2, h * 0.47, w * 0.22, h * 0.12, 6);
      c.paint(hand, hex('#e8e2d4'));
      const bite = c.mask();
      for (let k = 0; k < 7; k++) { const a = Math.PI * (0.15 + k * 0.1); bite.ellipse(w * 0.5 + Math.cos(a) * w * 0.08, h * 0.34 + Math.sin(a) * h * 0.04, 3, 2.4); }
      c.paint(bite, C.red);
      head(c, 'REPORT', h * 0.58, h * 0.09, C.red, { rng, weight: 0.22 });
      head(c, 'ALL BITES', h * 0.69, h * 0.07, C.ink, { rng, weight: 0.2 });
      head(c, 'ISOLATE · BANDAGE · CALL 211', h * 0.82, h * 0.028, C.ink, { rng, weight: 0.15 });
    });
  });
  R('poster.trustguard', { ...FLYER, tags: ['poster', 'propaganda', 'military', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#4a5232'), () => {
      const st = [];
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? h * 0.06 : h * 0.15; st.push([w / 2 + Math.cos(a) * r, h * 0.27 + Math.sin(a) * r]); }
      c.paint(c.mask().poly(st), hex('#efe8d2'));
      head(c, 'TRUST', h * 0.5, h * 0.1, hex('#efe8d2'), { rng, weight: 0.2 });
      head(c, 'THE GUARD', h * 0.64, h * 0.075, hex('#f2c315'), { rng, weight: 0.2 });
      head(c, 'FOLLOW ALL ORDERS', h * 0.8, h * 0.035, hex('#efe8d2'), { rng, weight: 0.15 });
    });
  });

  // ---- the old world: ads and gigs ------------------------------------------------------------
  R('poster.cola', { ...POSTER, tags: ['poster', 'ad', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#c4161c'), () => {
      const wave = c.mask();
      const pts = [];
      for (let k = 0; k <= 20; k++) pts.push([k / 20 * w, h * 0.7 + Math.sin(k / 20 * Math.PI * 2) * h * 0.04]);
      wave.stroke(pts, h * 0.05);
      c.paint(wave, hex('#f6f2e8'));
      // the bottle
      const bx = w / 2, by = h * 0.36;
      const b = c.mask().rect(bx, by + h * 0.08, w * 0.2, h * 0.3, 18).rect(bx, by - h * 0.1, w * 0.08, h * 0.14, 6).rect(bx, by - h * 0.18, w * 0.1, h * 0.02, 2);
      c.paint(b, (x) => mix3(hex('#3a1608'), hex('#7a3a1a'), clamp01(1 - Math.abs(x - bx + w * 0.04) / (w * 0.1))), 1, { rough: 0.3 });
      c.paint(c.mask().rect(bx, by + h * 0.08, w * 0.2, h * 0.08, 0), hex('#f6f2e8'));
      print(c, 'RR', bx, by + h * 0.055, h * 0.05, C.red, { align: 'center', weight: 0.2 });
      c.paint(c.mask().rect(bx - w * 0.06, by + h * 0.05, w * 0.025, h * 0.22, 6).blur(2), [1, 1, 1], 0.35);
      head(c, 'RED ROCKET', h * 0.75, h * 0.08, hex('#f6f2e8'), { rng, weight: 0.2, style: 'sign' });
      head(c, 'ICE COLD · SINCE 1952', h * 0.87, h * 0.035, hex('#f6d36b'), { rng, weight: 0.15 });
    }, { tape: false, staples: true });
  });
  R('poster.movie', { ...POSTER, tags: ['poster', 'ad', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#0d0f16'), () => {
      const glow = c.mask().circle(w / 2, h * 0.4, w * 0.45).blur(w * 0.15);
      c.paint(glow, hex('#7a2a10'), 0.9);
      const moon = c.mask().circle(w / 2, h * 0.32, w * 0.2);
      c.paint(moon, hex('#e9d9b0'));
      // a figure in front of the moon, arms out
      const f = c.mask().ellipse(w / 2, h * 0.27, w * 0.035, w * 0.045).rect(w / 2, h * 0.38, w * 0.08, h * 0.14, 4);
      f.capsule(w * 0.47, h * 0.33, w * 0.36, h * 0.3, 4).capsule(w * 0.53, h * 0.33, w * 0.64, h * 0.29, 4);
      f.capsule(w * 0.48, h * 0.44, w * 0.45, h * 0.56, 5).capsule(w * 0.52, h * 0.44, w * 0.56, h * 0.56, 5);
      c.paint(f, hex('#08090c'));
      head(c, 'NIGHT', h * 0.6, h * 0.1, hex('#e8e4d8'), { rng, weight: 0.16, gap: 1.6 });
      head(c, 'SHIFT', h * 0.71, h * 0.1, hex('#d23a1a'), { rng, weight: 0.16, gap: 1.6 });
      head(c, 'THEY NEVER CLOCK OUT', h * 0.83, h * 0.026, hex('#c9c3b3'), { rng, weight: 0.13 });
      para(c, w * 0.12, h * 0.89, w * 0.76, h * 0.012, 2, hex('#8b877c'), rng, { full: true });
    }, { tape: false, staples: true });
  });
  R('poster.gig', { ...FLYER, tags: ['poster', 'ad', 'paper'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#ef8a1a'), () => {
      const m = c.mask();
      for (let k = 0; k < 5; k++) { const st = []; const cx = w * (0.15 + k * 0.175), cy = h * 0.12; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i / 10 * Math.PI * 2, r = i % 2 ? 6 : 14; st.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } m.poly(st); }
      c.paint(m, C.ink);
      head(c, 'THE HOLLOW', h * 0.24, h * 0.08, C.ink, { rng, weight: 0.2 });
      head(c, 'CREEK HOUNDS', h * 0.34, h * 0.08, C.ink, { rng, weight: 0.2 });
      head(c, 'LIVE AT THE ROADHOUSE', h * 0.5, h * 0.045, hex('#fff3d8'), { rng, weight: 0.16 });
      head(c, 'SATURDAY 9 PM', h * 0.6, h * 0.06, C.ink, { rng, weight: 0.18 });
      head(c, 'NO COVER · COLD BEER', h * 0.74, h * 0.035, C.ink, { rng, weight: 0.15 });
    });
  });
  R('flyer.church', { ...FLYER, tags: ['poster', 'ad', 'paper', 'church'] }, (c, rng, v) => {
    const { w, h } = c;
    sheet(c, rng, v, hex('#f2efe6'), () => {
      const cr = c.mask().rect(w / 2, h * 0.15, w * 0.05, h * 0.16, 1).rect(w / 2, h * 0.12, w * 0.16, h * 0.035, 1);
      c.paint(cr, hex('#5a3a8a'));
      head(c, "ST. ANNE'S", h * 0.27, h * 0.07, hex('#5a3a8a'), { rng, weight: 0.17 });
      head(c, 'PANCAKE BREAKFAST', h * 0.37, h * 0.05, C.ink, { rng, weight: 0.16 });
      head(c, 'SUNDAY AFTER SERVICE', h * 0.46, h * 0.035, C.ink, { rng, weight: 0.14 });
      para(c, w * 0.12, h * 0.56, w * 0.76, h * 0.02, 5, C.ink, rng);
      head(c, 'ALL ARE WELCOME', h * 0.86, h * 0.04, hex('#5a3a8a'), { rng, weight: 0.16 });
    });
  });

  // ---- torn layers (years of posters on one board) ------------------------------------------
  for (const [id, cols] of [['poster.torn-layers', ['#c4161c', '#ece6d6', '#1d3f73', '#ef8a1a']], ['poster.torn-layers2', ['#ece6d6', '#4a5232', '#efe2a6', '#0d0f16']]]) {
    R(id, { sheet: S, px: [448, 384], size: [24, 20], surf: 'wall', tags: ['poster', 'torn', 'paper'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      const { w, h } = c;
      cols.forEach((hc, i) => {
        const pw = w * rng.range(0.4, 0.62), ph = h * rng.range(0.55, 0.85);
        const cx = w * rng.range(0.28, 0.72), cy = h * rng.range(0.4, 0.6);
        const pm = paper(c, cx, cy, pw, ph, { rng, color: hex(hc), wrinkle: 0.5, edge: 1 });
        // some print on it
        para(c, cx - pw * 0.4, cy - ph * 0.3, pw * 0.8, ph * 0.04, 3, i % 2 ? C.ink : C.white, rng);
        print(c, ['SALE', 'LIVE', 'VOTE', 'OPEN'][i], cx, cy + ph * 0.05, ph * 0.16, i % 2 ? C.red : C.ink, { align: 'center', weight: 0.2 });
        // torn: most of it ripped away along a ragged line (a slow wave plus a fine tear)
        const keep = c.mask();
        const ph0 = rng.range(0, 6), fr = rng.range(1.5, 3.5) / pw, amp = ph * rng.range(0.12, 0.25), base = cy + rng.range(-0.25, 0.2) * ph, sd = rng.seed();
        const up = rng.chance(0.5);
        keep.map((x, y) => {
          const edge = base + Math.sin(x * fr * Math.PI * 2 + ph0) * amp + (fbm(x * 0.05, 0, 3, sd) - 0.5) * ph * 0.25 + (hash2(x, 1, sd) - 0.5) * 2;
          return Math.max(0, Math.min(1, (up ? edge - y : y - edge) + 0.5));
        });
        const lost = pm.clone().cut(keep);
        const rim = lost.clone().cut(lost.clone().grow(-2.5));
        c.erase(lost, 0.97);
        c.paint(rim.min(pm), [0.92, 0.9, 0.85], 0.8);
      });
      for (let i = 0; i < 6; i++) { const x = w * rng.range(0.1, 0.9), y = h * rng.range(0.1, 0.9); const m = c.mask().capsule(x - 4, y, x + 4, y, 1.1); c.paint(m, [0.7, 0.7, 0.72], 1); c.lift(m, 1); }
      age(c, v === 'clean' ? 1 : 2, rng, { kind: 'paper' });
    });
  }

  // ---- notes the survivors left ----------------------------------------------------------------
  const NOTES = [
    ['note.deke', ['BACK BY DARK', 'NEED BATTERY', '+ FUEL FOR TOW', 'DONT TOUCH', 'THE TRUCK -D'], hex('#f1eee2'), hex('#1a1a1a'), true],
    ['note.ruth', ['ROOM 4 KIDS:', 'BUS IS ON HWY 9', 'I WENT TO THE', 'LAKE FOR BOATS', '- MS DELANEY'], hex('#f1eee2'), hex('#1d2a6e'), true],
    ['note.delta', ['CHECKPOINT DELTA', 'FELL BACK TO', 'FORT HARLAN', 'DAY 47', 'SGT OKAFOR'], hex('#c9b48a'), hex('#1a1a1a'), false],
    ['note.water', ["DON'T DRINK", 'THE WATER', 'BOIL IT', 'OR DIE'], hex('#ece6d6'), hex('#8a1010'), false],
    ['note.4alive', ['4 ALIVE', 'NO BITES', 'PLEASE HELP', 'WE HAVE', 'KIDS'], hex('#b48f5e'), hex('#141414'), false],
    ['note.wentup', ['WENT UP', 'TO THE ROOF', 'STAIR B', 'DONT FOLLOW', 'IF BIT'], hex('#f4f4f0'), hex('#1a1a1a'), true],
  ];
  for (const [id, lines, col, ink, lined] of NOTES) {
    R(id, { sheet: S, px: [256, 320], size: [13, 16.3], surf: 'wall', tags: ['note', 'paper', 'story'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      const { w, h } = c;
      const cardboard = id === 'note.4alive' || id === 'note.delta';
      paper(c, w / 2, h / 2, w - 6, h - 6, { rng, color: col, wrinkle: cardboard ? 0.2 : 0.7, edge: 1.5 });
      if (cardboard) {
        // corrugation lines
        const cm = c.mask();
        for (let x = 6; x < w - 6; x += 7) cm.bar(x, 4, x, h - 4, 1.2);
        c.multiply(cm.blur(1.5).min(c.alphaMask()), [0.82, 0.78, 0.72], 0.4);
        c.lift(cm, 0.6);
      }
      if (lined) {
        for (let y = h * 0.16; y < h - 6; y += h * 0.105) c.paint(c.mask().bar(5, y + h * 0.075, w - 5, y + h * 0.075, 0.5), hex('#8fb3d9'), 0.6);
      }
      const m = c.mask();
      const size = Math.min(h * 0.12, ...lines.map((l) => fitSize(l, w * 0.84, h * 0.12, 1.1)));
      lines.forEach((l, i) => textMask(c, l, w * 0.08, h * 0.1 + i * h * 0.165, size, 'marker', { rng, into: m, weight: cardboard ? 0.14 : 0.1, slant: 0.06 }));
      c.paint(m.blur(0.4), ink, 0.92);
      tape(c, w / 2, h / 2, w - 20, h - 20, 0, rng, [0]);
      age(c, v === 'clean' ? 0 : 2, rng, { kind: 'paper' });
    });
  }
  // a kid's crayon drawing (the school)
  R('note.drawing', { sheet: S, px: [320, 256], size: [12, 9.6], surf: 'wall', tags: ['note', 'paper', 'school'], variants: ['clean', 'worn'] }, (c, rng, v) => {
    const { w, h } = c;
    paper(c, w / 2, h / 2, w - 6, h - 6, { rng, color: C.white, wrinkle: 0.4 });
    const cr = (pts, col, wd = 5) => { const m = c.mask().stroke(pts, wd).mulBy((x, y) => 0.55 + 0.45 * (hash2(x >> 1, y >> 1, 4) > 0.3 ? 1 : 0)); c.paint(m, hex(col), 0.9); };
    cr([[w * 0.05, h * 0.82], [w * 0.95, h * 0.8]], '#3aa83a', 7);
    cr([[w * 0.1, h * 0.8], [w * 0.1, h * 0.45], [w * 0.25, h * 0.28], [w * 0.4, h * 0.45], [w * 0.4, h * 0.8], [w * 0.1, h * 0.8]], '#c0392b');
    cr([[w * 0.2, h * 0.8], [w * 0.2, h * 0.62], [w * 0.28, h * 0.62], [w * 0.28, h * 0.8]], '#7a4a1a');
    const sun = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2; sun.push([w * 0.85 + Math.cos(a) * 20, h * 0.18 + Math.sin(a) * 20]); }
    cr(sun, '#f2b21a', 6);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; cr([[w * 0.85 + Math.cos(a) * 28, h * 0.18 + Math.sin(a) * 28], [w * 0.85 + Math.cos(a) * 40, h * 0.18 + Math.sin(a) * 40]], '#f2b21a', 4); }
    // stick family
    for (const [x, col] of [[0.55, '#2a5bd6'], [0.66, '#c2398f'], [0.75, '#2a5bd6']]) {
      const s = x === 0.75 ? 0.7 : 1;
      cr([[w * x, h * (0.8 - 0.25 * s)], [w * x, h * (0.8 - 0.1 * s)]], col, 4);
      cr([[w * x - 10 * s, h * 0.8], [w * x, h * (0.8 - 0.1 * s)], [w * x + 10 * s, h * 0.8]], col, 4);
      cr([[w * x - 12 * s, h * (0.8 - 0.2 * s)], [w * x + 12 * s, h * (0.8 - 0.2 * s)]], col, 4);
      const hd = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 2; hd.push([w * x + Math.cos(a) * 9 * s, h * (0.8 - 0.3 * s) + Math.sin(a) * 9 * s]); }
      cr(hd, col, 4);
    }
    print(c, 'MY FAMILY', w * 0.08, h * 0.05, h * 0.1, hex('#2a2a2a'), { style: 'marker', rng, weight: 0.12 });
    tape(c, w / 2, h / 2, w - 20, h - 20, 0, rng, [0, 1]);
    age(c, v === 'clean' ? 0 : 1, rng, { kind: 'paper' });
  });
  // polaroids
  for (const [id, warm] of [['note.polaroid', true], ['note.polaroid2', false]]) {
    R(id, { sheet: S, px: [192, 224], size: [5, 6], surf: 'wall', tags: ['note', 'paper', 'photo'], variants: ['clean', 'worn'] }, (c, rng, v) => {
      const { w, h } = c;
      paper(c, w / 2, h / 2, w - 6, h - 6, { rng, color: hex('#f4f2ec'), wrinkle: 0.15, rot: rng.range(-0.04, 0.04) });
      const px = w * 0.1, py = h * 0.08, pw = w * 0.8, ph = h * 0.66;
      portrait(c, px, py, pw, ph, { rng, child: !warm, long: warm, contrast: 1.1 });
      regionMap(c, px, py, px + pw, py + ph, (rgb, x, y) => (warm ? [rgb[0] * 1.08 + 0.04, rgb[1] * 0.98, rgb[2] * 0.78] : [rgb[0] * 0.9, rgb[1] * 0.98, rgb[2] * 1.08]));
      print(c, warm ? 'MOM + ME' : 'BEN SUMMER', w * 0.12, h * 0.8, h * 0.07, hex('#1d2a6e'), { style: 'marker', rng });
      age(c, v === 'clean' ? 0 : 1, rng, { kind: 'paper' });
    });
  }
}
