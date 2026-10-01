// Blackpine's wall looks (added to the kit's tables, millroad-kit.js): the rock of the ridges and of the
// gorge's canyon walls, the campground's log stockade, the Harlan farm's board fence, the ranger station's
// board-and-batten and knotty pine, the saw hall's rusted corrugated steel.

import { LOOKS, WALL_DRAW, T, S, WOOD, RUSTY, CONC, HALF, PI, shadeHex, mixHex, DET, decal } from './millroad-kit.js';

const F = (c, l, r = 0.86, m = 0) => ({ c, l, r, m });
const ROCK = (c) => ({ noJitter: true, surf: [DET.rock, 0.92, 0] , c });

Object.assign(LOOKS, {
  cliff: { h: 200, draw: 'cliff' },
  canyon: { h: 380, draw: 'cliff', canyon: true },
  stockade: { h: 130, draw: 'stockade' },
  farmfence: { h: 70, draw: 'farmfence' },
  ranger: { h: 130, ext: F('#6a4a30', DET.siding, 0.88), int: F('#b8864a', DET.wood, 0.7), plinth: '#6a665e', cap: '#2f4a32', skirt: '#4a3020', crown: 124, win: { w: 44, h: 40, sill: 44, pitch: 120, margin: 60, state: 'mix', shutters: '#2f4a32' } },
  rangerint: { h: 130, ext: F('#b8864a', DET.wood, 0.7), int: F('#b8864a', DET.wood, 0.7), skirt: '#4a3020', crown: 124 },
  mill: { h: 190, ext: F('#7a6656', DET.corrugated, 0.6, 0.45), int: F('#5e5650', DET.corrugated, 0.65, 0.4), plinth: '#7a766c', cap: '#4a4440', win: { w: 90, h: 30, sill: 140, pitch: 220, margin: 110, state: 'mix' } },
});

Object.assign(WALL_DRAW, {
  /**
   * A ridge of rock (or a canyon wall): a dark core, slabs and boulders stacked up both faces, ledges, moss;
   * the canyon's walls taller, banded, wet at the foot.
   */
  cliff(P, look) {
    const { B, o } = P;
    const L = o.w, t = o.h, r = B.rng;
    const H0 = look.h;
    const seed = Math.round(o.x * 0.37 + o.y * 0.73);
    const hAt = (x) => H0 * (0.72 + 0.28 * Math.sin(x * 0.011 + seed) * Math.cos(x * 0.004 + seed * 0.3)) + (look.canyon ? 0 : 20);
    const base = look.canyon ? '#6a645a' : '#6e6a60';
    B.box('std', 0, H0 * 0.42, 0, L + 10, H0 * 0.84, t * 0.7, shadeHex(base, -0.25), null, { noJitter: true, surf: [look.canyon ? DET.strata : DET.rock, 0.95, 0] });
    const lod = P.lod;
    const step = lod === 0 ? 110 : lod === 1 ? 70 : 52;
    if (look.canyon) {
      // the canyon: layered rock, ledges of strata stepping back up the wall, the faces streaked and wet below
      for (const f of [-1, 1]) {
        for (let y = 0; y < H0 * 1.05; y += r.range(16, 30)) {
          let x = -L / 2 - 10;
          const back = (y / H0) * t * 0.12;
          while (x < L / 2 + 10) {
            const sw = r.range(50, 130), sh = r.range(16, 30);
            if (y + sh * 0.5 > hAt(x + sw / 2) + 20) { x += sw; continue; }
            const c = mixHex(base, r.chance(0.35) ? '#8a7e6a' : '#5a5448', r.next() * 0.7);
            B.box('std', x + sw / 2, y + sh / 2, f * (t * 0.36 - back + r.range(-4, 5)), sw, sh, t * 0.3, c, [0, r.range(-0.05, 0.05), r.range(-0.03, 0.03)], { noJitter: true, surf: [r.chance(0.6) ? DET.strata : DET.rock, 0.92, 0] });
            x += sw - r.range(0, 8);
          }
        }
        if (lod >= 1) for (let k = 0; k < Math.round(L / 120); k++) decal(B, r.chance(0.5) ? 'grime' : 'bp_moss', r.range(-L / 2 + 40, L / 2 - 40), r.range(20, 120), f * (t * 0.52 + 2), r.range(60, 120), r.range(60, 160), f > 0 ? 0 : PI);
      }
      return;
    }
    for (const f of [-1, 1]) {
      for (let x = -L / 2; x < L / 2 + 10; x += step * r.range(0.8, 1.2)) {
        const top = hAt(x);
        for (let y = 0; y < top; y += step * r.range(0.6, 0.9)) {
          const s = step * r.range(0.55, 0.95) * (y < 20 ? 1.2 : 1);
          const c = mixHex(base, r.chance(0.3) ? '#8a8478' : '#5a564e', r.next() * 0.7);
          const lean = (1 - y / top) * t * 0.18;
          B.add('std', T.dodeca(), [x + r.range(-10, 10), y + s * 0.4, f * (t * 0.3 + lean + r.range(-4, 6))], [s * r.range(0.8, 1.3), s * r.range(0.5, 0.8), s * r.range(0.45, 0.7)], [r.range(-0.3, 0.3), r.range(0, 6), r.range(-0.3, 0.3)], c, { noJitter: true, surf: [look.canyon && r.chance(0.5) ? DET.strata : DET.rock, 0.92, 0] });
        }
        // a cap of rock along the crest
        B.add('std', T.dodeca(), [x, top, r.range(-t * 0.2, t * 0.2)], [step * 0.8, step * 0.4, t * 0.45], [0, r.range(0, 6), 0], mixHex(base, '#8a8478', r.next() * 0.5), { noJitter: true, surf: [DET.rock, 0.92, 0] });
      }
      // moss and wet streaks
      if (lod >= 1) {
        for (let k = 0; k < Math.round(L / 160); k++) decal(B, look.canyon && r.chance(0.5) ? 'grime' : 'bp_moss', r.range(-L / 2 + 40, L / 2 - 40), r.range(10, 70), f * (t * 0.36 + 6), r.range(60, 120), r.range(40, 70), f > 0 ? 0 : PI);
      }
    }
  },
  /** The campground's stockade: peeled logs side by side with sharpened tops, two rails behind. */
  stockade(P, look) {
    const { B, o } = P;
    const L = o.w, r = B.rng;
    const H = look.h;
    for (const y of [24, H - 30]) B.add('std', T.cyl(8), [0, y, 6], [4, L, 4], [0, 0, HALF], '#6a4a30', { ...WOOD, map: 'cyl' });
    const d = P.lod === 0 ? 16 : 9.5;
    for (let x = -L / 2 + d / 2; x < L / 2; x += d) {
      const h = H - r.range(0, 14);
      const c = mixHex('#8a6a48', '#6a5038', r.next());
      B.add('std', T.cyl(P.lod >= 2 ? 8 : 6), [x, h / 2, 0], [d / 2, h, d / 2], [0, r.range(0, 6), r.range(-0.02, 0.02)], c, { noJitter: true, surf: [DET.bark, 0.9, 0], map: 'cyl' });
      B.add('std', T.cyl(6, 0), [x, h + 5, 0], [d / 2, 10, d / 2], null, shadeHex(c, 0.15), { noJitter: true, ...WOOD });
    }
  },
  /** The Harlan farm's fence: posts and four boards, white paint gone grey, a board down here and there. */
  farmfence(P, look) {
    const { B, o } = P;
    const L = o.w, r = B.rng;
    const H = look.h;
    const n = Math.max(1, Math.round(L / 90));
    for (let i = 0; i <= n; i++) B.box('std', -L / 2 + (i * L) / n, H / 2 + 2, 0, 7, H + 4, 7, '#8a8478', null, WOOD);
    for (const y of [14, 30, 46, 62]) {
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + ((i + 0.5) * L) / n;
        if (r.chance(0.04)) { B.add('std', T.box(), [x, 2, -12], [L / n, 1.6, 10], [0, r.range(-0.3, 0.3), 0.05], '#c8c4b8', WOOD); continue; }
        B.box('std', x, y, -4, L / n + 2, 9, 1.6, mixHex('#d8d4c8', '#a8a498', r.next()), [0, 0, r.range(-0.01, 0.01)], { noJitter: true, ...WOOD });
      }
    }
  },
});

void [RUSTY, CONC, ROCK];
