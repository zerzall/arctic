// Roadhouse-only models (world-hideout.js registry): the diner's and the office's extras.

import { T, S, WOOD, METAL, C, DET, pic, neonWord, lantern, post } from './world-hideout-kit.js';

const HALF = Math.PI / 2;

/** World position of a point in an obstacle's frame. */
function toWorld(o, lx, lz) {
  const c = Math.cos(o.a || 0), s = Math.sin(o.a || 0);
  return [o.x + lx * c - lz * s, o.y + lx * s + lz * c];
}

/** Extras on the diner (the objective): OPEN in the window, the day's soup on a chalkboard, a vent that smokes. */
function rhdiner(P) {
  const { B, it, halos, dyn } = P;
  const L = it.w, W = it.h;
  neonWord(B, 'n_open', -L * 0.31, 58, W / 2 + 1.7, 40, 15, 0, 3, false);
  neonWord(B, 'n_cafe', L * 0.3, 60, W / 2 + 1.7, 40, 15, 0, 2.6, false);
  const [hx, hy] = toWorld(it, -L * 0.31, W / 2 + 6);
  halos.push({ x: hx, y: hy, h: 58, color: '#5dff8a', size: 70, strength: 0.4 });
  // the chalkboard specials leaning on the wall by the door
  B.box('std', L * 0.12, 22, W / 2 + 5, 26, 34, 1.6, C.woodD, [-0.12, 0, 0], WOOD);
  pic(B, 'chalk', L * 0.12, 22.4, W / 2 + 5.9, 23, 12, 0, { rx: -0.12 });
  // a bench and a pot of geraniums by the door
  B.rblock('std', -L * 0.12, 0, W / 2 + 12, 46, 14, 10, 0.5, '#7a5a38', null, WOOD);
  B.cyl('std', -L * 0.12 + 24, 0, W / 2 + 12, 4.6, 7, '#a0522d', 9, 0.8, null, S(DET.tile, 0.8, 0));
  const [lx, ly] = toWorld(it, -L * 0.12 - 12, W / 2 + 12);
  lantern(B, halos, -L * 0.12 - 12, 14, W / 2 + 12, lx, ly, { h: 9, halo: 44, strength: 0.45 });
  const [sx, sy] = toWorld(it, -L * 0.3, -W * 0.25);
  dyn.smoke.push({ x: sx, y: sy, h: 118, rate: 2.2, r: 3, warm: 0 });
}

/** Extras on the office: its sign, a lantern by the door and a stack of firewood. */
function rhoffice(P) {
  const { B, it, halos } = P;
  const L = it.w, W = it.h;
  pic(B, 'p_office', 0, 60, W / 2 + 0.8, 36, 9, 0);
  const [lx, ly] = toWorld(it, 24, W / 2 + 4);
  lantern(B, halos, 24, 26, W / 2 + 4, lx, ly, { h: 9, halo: 44, strength: 0.45 });
  // firewood stacked against the side wall
  for (let i = 0; i < 10; i++) {
    const row = Math.floor(i / 4);
    B.cyl('std', -L / 2 - 6, row * 5.2 + 2.6, -W * 0.3 + (i % 4) * 5.4 - row * 2.6, 2.6, 22, '#6b4a2c', 7, 1, [HALF, 0, 0], S(DET.bark, 0.9, 0));
  }
  void T; void METAL; void post;
}

export const ROADHOUSE_MODELS = { rhdiner, rhoffice };
