// Low-poly 3D guns built from boxes and cylinders, one model per weapons.js
// `sprite.style`, coloured from `sprite.color` / `sprite.accent`. Shared by the
// first-person viewmodel and the teammates' held weapons, so every gun reads the same
// in both views.
//
// Gun space: +X toward the muzzle, +Y up, +Z to the right; the origin is where the
// firing hand wraps the grip. Units are world units (1 ≈ 3 cm), so a rifle is ~34 long.

import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';
import { PartBuilder, shadeHex, mixHex } from './actor-kit.js';

const STEEL = '#3b3f44', DARK = '#1c1d1f', WOOD = '#6a4428', BRASS = '#b8903a';
const HALF_PI = Math.PI / 2;

// sprite.len (top-down pixels) → 3D length; small guns are drawn oversized top-down
const LEN_SCALE = {
  pistol: 0.62, revolver: 0.62, double: 1.0, smg: 0.8, dual: 0.72, shotgun: 0.98, rifle: 0.95,
  crossbow: 0.9, dmr: 0.95, sniper: 0.92, autoshotgun: 0.95, flamethrower: 0.95, lmg: 0.92,
  launcher: 0.9, rocket: 0.95, tesla: 0.95, minigun: 0.85, railgun: 0.9,
};

const cache = new Map();

/**
 * Geometry for one weapon (cached per id; callers must not dispose the geometries).
 * @param {string} weaponId
 * @returns {{ id, style, body: THREE.BufferGeometry, glow: THREE.BufferGeometry|null,
 *   spin: THREE.BufferGeometry|null, pump: THREE.BufferGeometry|null, tip: THREE.BufferGeometry|null,
 *   spinPivot: number[], muzzle: number[], front: number[], length: number, dual: boolean,
 *   glowColor: string, heavy: boolean, twoHanded: boolean }}
 */
export function gunModel(weaponId) {
  const id = WEAPONS[weaponId] ? weaponId : 'pistol';
  let m = cache.get(id);
  if (!m) {
    m = build(id);
    cache.set(id, m);
  }
  return m;
}

function build(id) {
  const w = WEAPONS[id];
  const sp = w.sprite;
  const style = sp.style;
  const L = sp.len * (LEN_SCALE[style] || 0.9);
  const col = sp.color, acc = sp.accent;
  const body = new PartBuilder(), glow = new PartBuilder(), spin = new PartBuilder(), pump = new PartBuilder(), tip = new PartBuilder();
  const out = {
    id, style, length: L, muzzle: [L, 1.5, 0], front: [L * 0.55, 0.6, 0], spinPivot: [0, 0, 0],
    dual: style === 'dual', glowColor: acc, heavy: false, twoHanded: true,
  };

  // helpers (all dimensions in gun space)
  // Guns are drawn a bit thicker than life: seen from behind in first person a true-to-
  // scale receiver reads as a stick, and chunky guns feel better to hold.
  const TH = 1.35;
  const box = (pb, x0, x1, y0, y1, zw, color, z = 0, extra = {}) =>
    pb.add('box', { at: [(x0 + x1) / 2, (y0 + y1) / 2, z * TH], size: [x1 - x0, y1 - y0, zw * TH], color, ao: 0.3, ...extra });
  const tube = (pb, x0, x1, y, r, color, z = 0, seg = 'cyl8') =>
    pb.add(seg, { at: [(x0 + x1) / 2, y, z * TH], rot: [0, 0, -HALF_PI], size: [r * 2.3, x1 - x0, r * 2.3], color, ao: 0.1 });
  const grip = (pb, x, color, len = 3.4, tilt = 0.28, wz = 1.2) =>
    pb.add('box', { at: [x - Math.sin(tilt) * len * 0.5, -len * 0.5, 0], rot: [0, 0, tilt], size: [1.5, len, wz], color, ao: 0.35 });
  const trigger = (pb, x) => {
    box(pb, x + 0.4, x + 2.2, -0.9, -0.7, 0.5, DARK);
    box(pb, x + 1.0, x + 1.25, -0.8, 0, 0.3, DARK);
  };
  const dot = (x, y, z, s, color) => glow.add('box', { at: [x, y, z], size: [s, s, s], color, ao: 0 });

  switch (style) {
    case 'pistol': {
      box(body, -1.2, L - 0.6, 0.35, 1.9, 1.25, col);                 // slide
      box(body, -0.6, L * 0.62, -0.25, 0.4, 1.15, shadeHex(col, 0.08)); // frame
      box(body, L * 0.2, L - 0.6, 0.95, 1.05, 1.3, shadeHex(col, 0.18)); // slide serration highlight
      grip(body, 0.3, acc);
      trigger(body, 0);
      tube(body, L - 0.8, L - 0.3, 1.2, 0.3, DARK);
      dot(-1.0, 2.05, -0.35, 0.28, '#7dff9a');
      dot(-1.0, 2.05, 0.35, 0.28, '#7dff9a');
      dot(L - 1.2, 2.05, 0, 0.28, '#7dff9a');
      out.muzzle = [L - 0.3, 1.2, 0];
      out.twoHanded = false;
      out.glowColor = '#7dff9a';
      break;
    }
    case 'revolver': {
      grip(body, 0.2, acc, 3.6, 0.4, 1.3);
      box(body, -1.0, 2.2, -0.3, 1.9, 1.1, col);                       // frame
      tube(body, 1.0, 3.6, 1.2, 1.15, shadeHex(col, -0.1), 0, 'cyl6');  // cylinder
      tube(body, 3.4, L, 1.45, 0.5, col);                              // barrel
      box(body, 3.4, L, 1.8, 2.2, 0.6, shadeHex(col, 0.1));           // top rib
      box(body, -1.4, -0.6, 1.4, 2.1, 0.5, DARK);                      // hammer
      trigger(body, -0.2);
      box(body, L - 0.8, L - 0.4, 2.2, 2.6, 0.3, DARK);
      out.muzzle = [L, 1.45, 0];
      out.twoHanded = false;
      break;
    }
    case 'double': {
      const wood = acc === '#777' ? '#5a3a22' : acc;
      grip(body, 0.3, wood, 3.4, 0.5, 1.4);
      box(body, -3.5, 0.5, -0.4, 1.2, 1.4, wood, 0, { taper: [1, 0.9] });
      box(body, 0, 3.4, 0.2, 2.1, 1.9, STEEL);
      tube(body, 3.0, L, 1.35, 0.62, '#555a5e', -0.62);
      tube(body, 3.0, L, 1.35, 0.62, '#4a4f53', 0.62);
      box(body, 3.4, L * 0.62, -0.1, 0.9, 1.8, col);                   // forend
      trigger(body, 0);
      out.muzzle = [L, 1.35, 0];
      out.front = [L * 0.45, 0, 0];
      break;
    }
    case 'smg': case 'dual': {
      box(body, -1.5, L * 0.66, 0.1, 2.0, 1.5, col);
      tube(body, L * 0.6, L, 1.2, 0.45, shadeHex(col, 0.15));
      box(body, 0.6, 1.9, -4.2, 0.2, 1.0, acc, 0, { rot: [0, 0, 0.12] }); // mag in the grip
      grip(body, 0.3, shadeHex(col, -0.1), 3.0, 0.15);
      trigger(body, 0.1);
      box(body, L * 0.2, L * 0.45, 2.0, 2.5, 0.35, style === 'dual' ? acc : DARK);
      if (style === 'smg') {
        box(body, -6, -1.5, 1.4, 1.7, 0.3, DARK, -0.6);                // wire stock
        box(body, -6, -1.5, 1.4, 1.7, 0.3, DARK, 0.6);
        box(body, -6.3, -5.7, -0.2, 1.7, 1.5, DARK);
      } else {
        box(body, 0, L * 0.6, 1.0, 1.25, 1.55, acc);                   // gold inlay
      }
      out.muzzle = [L, 1.2, 0];
      out.front = [L * 0.5, 0.2, 0];
      out.twoHanded = style === 'smg';
      break;
    }
    case 'shotgun': case 'autoshotgun': {
      const auto = style === 'autoshotgun';
      const stockCol = auto ? '#1a1a1a' : WOOD;
      box(body, -12, -0.8, -0.4, 1.7, 1.5, stockCol, 0, { rot: [0, 0, -0.08], taper: [1, 0.85] });
      grip(body, 0.2, stockCol, 3.2, 0.35, 1.3);
      box(body, -1, 6.5, 0.1, 2.4, 1.9, auto ? col : acc);
      tube(body, 6, L, 1.75, 0.6, STEEL);
      trigger(body, 0);
      if (auto) {
        body.add('cyl12', { at: [3.0, -1.6, 0], rot: [HALF_PI, 0, 0], size: [5.0, 2.6, 5.0], color: '#2e2e2e', ao: 0.2 }); // drum
        box(body, 6, L - 1, 0.6, 2.5, 2.1, acc);                        // shroud
        box(body, 0, 6, 2.4, 2.9, 0.6, DARK);                           // rail
        out.front = [L * 0.52, 0.2, 0];
      } else {
        tube(body, 6, L - 2.5, 0.75, 0.48, '#2b2d30');                  // magazine tube
        box(pump, L * 0.42, L * 0.64, 0.1, 1.5, 1.9, col);              // pump
        box(body, L - 0.8, L - 0.4, 2.3, 2.7, 0.3, DARK);               // bead sight
        out.front = [L * 0.53, 0.2, 0];
      }
      out.muzzle = [L, 1.75, 0];
      break;
    }
    case 'rifle': case 'dmr': case 'sniper': {
      const stock = style === 'sniper' ? '#2a3238' : acc;
      box(body, -12, -0.8, -0.8, 1.9, 1.5, stock, 0, { taper: [1, 0.85] });     // stock
      box(body, -12.2, -11.4, -1.4, 2.0, 1.6, DARK);                            // butt pad
      grip(body, 0.2, DARK, 3.4, 0.3, 1.2);
      box(body, -1, L * 0.38, 0.0, 2.2, 1.6, col);                              // receiver
      box(body, L * 0.36, L * 0.68, 0.3, 2.0, 1.8, style === 'rifle' ? acc : shadeHex(col, 0.1)); // handguard
      tube(body, L * 0.66, L, 1.3, 0.36, '#2a2c2e');
      tube(body, L - 1.2, L, 1.3, 0.55, DARK);                                  // flash hider
      trigger(body, 0);
      if (style === 'rifle') {
        box(body, 2.2, 4.2, -3.2, 0.1, 1.1, '#1e1e1e', 0, { rot: [0, 0, 0.2] });  // curved mag
        box(body, 3.0, 5.0, -5.4, -2.9, 1.1, '#1e1e1e', 0, { rot: [0, 0, 0.42] });
        box(body, -0.5, 4, 2.2, 3.4, 0.8, DARK);                                // carry handle
        box(body, L * 0.62, L * 0.66, 2.0, 3.6, 0.4, DARK);                      // front sight
        dot(L * 0.64, 3.7, 0, 0.3, '#ff6a3a');
        out.glowColor = '#ff6a3a';
      } else {
        box(body, 2.2, 4.2, -3.6, 0.1, 1.1, '#1e1e1e');                         // straight mag
        const sr = style === 'sniper' ? 1.1 : 0.85;
        tube(body, L * 0.02, L * 0.42, 3.4, sr, '#151719');                     // scope
        tube(body, L * 0.02, L * 0.08, 3.4, sr * 1.25, '#151719');
        tube(body, L * 0.36, L * 0.43, 3.4, sr * 1.35, '#151719');
        box(body, L * 0.1, L * 0.14, 2.1, 3.0, 0.7, DARK);
        box(body, L * 0.3, L * 0.34, 2.1, 3.0, 0.7, DARK);
        glow.add('cyl8', { at: [L * 0.432, 3.4, 0], rot: [0, 0, -HALF_PI], size: [sr * 2.2, 0.15, sr * 2.2], color: '#4f8fd0', ao: 0 });
        glow.add('cyl8', { at: [L * 0.018, 3.4, 0], rot: [0, 0, -HALF_PI], size: [sr * 1.6, 0.1, sr * 1.6], color: '#203850', ao: 0 });
        out.glowColor = '#6fa0c8';
        if (style === 'sniper') {
          box(body, 1.6, 2.2, 1.6, 2.4, 3.2, STEEL, 1.3);                        // bolt handle
          body.add('ico0', { at: [1.9, 1.9, 3.0], size: [0.9, 0.9, 0.9], color: STEEL });
          box(body, L - 2.4, L - 1.6, -0.4, 1.3, 2.0, DARK);                     // muzzle brake
          box(body, L * 0.62, L * 0.66, -2.5, 0.4, 0.4, DARK, -0.5, { rot: [0.3, 0, 0] }); // folded bipod
          box(body, L * 0.62, L * 0.66, -2.5, 0.4, 0.4, DARK, 0.5, { rot: [-0.3, 0, 0] });
        }
      }
      out.muzzle = [L, 1.3, 0];
      out.front = [L * 0.52, 0.3, 0];
      break;
    }
    case 'crossbow': {
      box(body, -10, 0, -0.3, 1.6, 1.3, col, 0, { taper: [1, 0.9] });           // stock
      grip(body, 0.2, col, 3.0, 0.35);
      box(body, -0.5, L * 0.85, 0.6, 1.8, 1.4, shadeHex(col, 0.1));             // tiller
      box(body, 0, L * 0.8, 1.8, 2.1, 0.5, acc);                                // rail
      const bx = L * 0.8, half = sp.width * 0.42;
      for (const s of [-1, 1]) {
        body.add('box', { at: [bx - 1.2, 1.6, s * half * 0.55], rot: [0, s * 0.35, 0], size: [1.0, 0.8, half * 1.05], color: acc });
        box(body, bx - 5.6, bx - 2.2, 1.95, 2.05, 0.12, '#e6e0cc', s * half * 0.55, { rot: [0, -s * 0.9, 0] }); // string
      }
      tube(body, 2.5, L * 0.95, 2.35, 0.2, '#c8c8c8');                          // bolt
      body.add('cone6', { at: [L * 0.97, 2.35, 0], rot: [0, 0, -HALF_PI], size: [0.7, 1.4, 0.7], color: '#e0e0e0' });
      trigger(body, 0);
      out.muzzle = [L, 2.35, 0];
      out.front = [L * 0.45, 0.4, 0];
      break;
    }
    case 'flamethrower': {
      box(body, -8, 1, -0.3, 2.0, 1.6, acc, 0, { taper: [1, 0.9] });
      grip(body, 0.2, DARK, 3.2, 0.25);
      tube(body, 0, L * 0.72, 0.1, 1.7, col, 0, 'cyl12');                      // fuel tank
      box(body, L * 0.15, L * 0.2, -1.8, 1.9, 3.6, BRASS);                     // strap bands
      box(body, L * 0.52, L * 0.57, -1.8, 1.9, 3.6, BRASS);
      tube(body, L * 0.3, L, 2.2, 0.55, '#3a3a3a');                            // nozzle pipe
      tube(body, L - 1.8, L, 2.2, 0.85, '#777');
      box(body, L * 0.45, L * 0.52, -3.6, 0.1, 1.2, DARK, 0, { rot: [0, 0, 0.2] }); // front grip
      trigger(body, 0);
      glow.add('ico0', { at: [L + 0.6, 1.5, 0], size: [0.8, 1.1, 0.8], color: '#6aa8ff', ao: 0 }); // pilot light
      out.muzzle = [L + 0.4, 2.2, 0];
      out.front = [L * 0.48, -3.2, 0];
      out.glowColor = '#ff9a40';
      out.heavy = true;
      break;
    }
    case 'lmg': {
      box(body, -11, -0.8, -0.6, 1.8, 1.6, '#1e1e1a', 0, { taper: [1, 0.85] });
      grip(body, 0.2, DARK, 3.4, 0.3);
      box(body, -1, L * 0.42, -0.2, 2.6, 2.2, col);
      box(body, 1.0, 6.0, -4.6, -0.2, 2.6, acc, -0.6);                          // box mag
      box(body, 1.4, 5.6, -0.5, -0.2, 2.8, shadeHex(acc, -0.2), -0.6);
      box(body, L * 0.4, L * 0.72, 0.6, 2.4, 1.9, '#2a2c2a');                    // barrel shroud
      for (let k = 0; k < 5; k++) box(body, L * 0.44 + k * 2.2, L * 0.44 + k * 2.2 + 0.9, 2.35, 2.45, 1.95, '#101010');
      tube(body, L * 0.7, L, 1.4, 0.45, '#2a2c2a');
      tube(body, L - 1.4, L, 1.4, 0.65, DARK);
      box(body, 2, 6, 2.6, 3.8, 0.5, DARK);                                      // carry handle
      box(body, L * 0.8, L * 0.84, -3.6, 1.2, 0.4, DARK, -0.8, { rot: [0.35, 0, 0] });
      box(body, L * 0.8, L * 0.84, -3.6, 1.2, 0.4, DARK, 0.8, { rot: [-0.35, 0, 0] });
      trigger(body, 0);
      out.muzzle = [L, 1.4, 0];
      out.front = [L * 0.5, 0.2, 0];
      out.heavy = true;
      break;
    }
    case 'launcher': {
      box(body, -8, -0.6, 0.4, 1.4, 1.0, acc);                                   // folding stock
      box(body, -8.5, -7.6, -1.4, 1.5, 1.4, acc);
      grip(body, 0.2, DARK, 3.2, 0.25);
      box(body, -1, 3.5, -0.2, 2.2, 2.0, shadeHex(col, -0.15));
      tube(body, 3, 9.5, 1.6, 2.6, shadeHex(col, -0.1), 0, 'cyl12');            // drum
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        tube(body, 9.3, 9.7, 1.6 + Math.sin(a) * 1.5, 0.6, '#101010', Math.cos(a) * 1.5, 'cyl6');
      }
      tube(body, 9.5, L, 1.6, 1.25, col, 0, 'cyl12');                           // barrel
      box(body, L * 0.62, L * 0.68, -3.2, 0.4, 1.2, DARK, 0, { rot: [0, 0, 0.15] }); // foregrip
      box(body, 1, 5, 4.0, 4.8, 0.6, DARK);                                      // sight
      trigger(body, 0);
      out.muzzle = [L, 1.6, 0];
      out.front = [L * 0.64, -2.8, 0];
      out.heavy = true;
      break;
    }
    case 'rocket': {
      tube(body, -14, L - 4, 2.4, 2.1, col, 0, 'cyl12');                        // launch tube
      tube(body, -14.5, -12.5, 2.4, 2.4, shadeHex(col, -0.35), 0, 'cyl12');      // rear flare
      tube(body, L - 5, L - 3.5, 2.4, 2.3, shadeHex(col, -0.3), 0, 'cyl12');
      grip(body, 0.2, DARK, 3.4, 0.2);
      box(body, 5.5, 7, -2.8, 0.6, 1.2, DARK, 0, { rot: [0, 0, 0.1] });          // front grip
      box(body, -2, 3, 3.6, 5.6, 1.0, DARK, -1.6);                               // optic box on the left
      glow.add('box', { at: [3.05, 4.6, -1.6], size: [0.1, 1.2, 0.7], color: '#ff5a3a', ao: 0 });
      trigger(body, 0);
      tip.add('cone8', { at: [L - 1.0, 2.4, 0], rot: [0, 0, -HALF_PI], size: [3.4, 6.0, 3.4], color: acc });
      tube(tip, L - 5.2, L - 3.9, 2.4, 1.75, shadeHex(acc, -0.2));
      out.muzzle = [L - 3.5, 2.4, 0];
      out.front = [6.2, -2.4, 0];
      out.glowColor = '#ff5a3a';
      out.heavy = true;
      break;
    }
    case 'tesla': {
      box(body, -6, 1, -0.2, 2.2, 1.8, col, 0, { taper: [1, 0.9] });
      grip(body, 0.2, DARK, 3.2, 0.25);
      box(body, -1, L * 0.7, 0.2, 3.2, 2.4, col);
      tube(body, L * 0.2, L * 0.78, 1.7, 0.7, '#2a3a50');
      for (let k = 0; k < 4; k++) {
        glow.add('torus', { at: [L * (0.28 + k * 0.12), 1.7, 0], rot: [0, HALF_PI, 0], size: [3.4, 3.4, 3.4], color: acc, ao: 0 });
      }
      for (const s of [-1, 1]) {
        box(body, L * 0.72, L, 0.9 + s * 0.2, 1.3 + s * 0.2, 0.4, '#9aa', s * 0.9, { rot: [0, s * 0.12, 0] });
      }
      glow.add('ico1', { at: [L * 0.95, 1.7, 0], size: [1.4, 1.4, 1.4], color: '#e0f7ff', ao: 0 });
      box(body, L * 0.35, L * 0.45, -3.2, 0.2, 1.2, DARK);
      trigger(body, 0);
      out.muzzle = [L, 1.7, 0];
      out.front = [L * 0.4, -2.8, 0];
      out.glowColor = acc;
      break;
    }
    case 'minigun': {
      box(body, -7, 5, -1.2, 3.2, 3.4, col);                                     // motor housing
      box(body, -3, 4, 3.2, 3.8, 0.8, DARK);
      box(body, -2, 3, 3.8, 5.6, 0.7, DARK, 0, { rot: [0, 0, 0.2] });            // carry handle
      box(body, -7.5, -6, -0.8, 2.6, 2.6, DARK);
      grip(body, 0.2, DARK, 3.2, 0.2);
      box(body, -2, 4, -4.5, -1.2, 1.6, acc, -1.6);                               // feed chute
      trigger(body, 0);
      const bx0 = 5;
      out.spinPivot = [0, 1.0, 0];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        tube(spin, bx0, L, Math.sin(a) * 1.15, 0.38, k % 2 ? '#3a3a3a' : '#555', Math.cos(a) * 1.15, 'cyl6');
      }
      tube(spin, bx0, bx0 + 2, 0, 1.8, '#2a2a2a', 0, 'cyl8');
      tube(spin, L * 0.62, L * 0.62 + 1.2, 0, 1.75, '#2a2a2a', 0, 'cyl8');
      tube(spin, L - 1.2, L, 0, 1.7, '#222', 0, 'cyl8');
      out.muzzle = [L, 1.0, 0];
      out.front = [3.5, 5.0, 0];
      out.heavy = true;
      break;
    }
    case 'railgun': {
      box(body, -9, 0, -0.3, 2.0, 1.6, col, 0, { taper: [1, 0.85] });
      grip(body, 0.2, DARK, 3.2, 0.25);
      box(body, -1, L * 0.45, -0.3, 2.8, 2.4, col);
      box(body, L * 0.3, L, 2.4, 3.3, 1.2, '#3a3a48');                          // top rail
      box(body, L * 0.3, L, -0.4, 0.5, 1.2, '#3a3a48');                         // bottom rail
      glow.add('box', { at: [L * 0.66, 1.45, 0], size: [L * 0.68, 0.6, 0.35], color: acc, ao: 0 });
      for (let k = 0; k < 3; k++) {
        glow.add('box', { at: [L * 0.05 + k * 3, 2.9, 0], size: [1.6, 0.35, 2.5], color: mixHex(acc, '#ffffff', 0.3), ao: 0 });
      }
      box(body, L * 0.4, L * 0.48, -3.4, -0.3, 1.2, DARK);
      trigger(body, 0);
      out.muzzle = [L, 1.45, 0];
      out.front = [L * 0.44, -3.0, 0];
      out.glowColor = acc;
      out.heavy = true;
      break;
    }
    default:
      box(body, 0, L, 0, 2, 1.5, col);
  }

  out.body = body.build();
  out.glow = glow.count ? glow.build() : null;
  out.spin = spin.count ? spin.build() : null;
  out.pump = pump.count ? pump.build() : null;
  out.tip = tip.count ? tip.build() : null;
  return out;
}

/** Shared lit material for guns (vertex coloured, a little specular sheen). */
let sharedMats = null;
/**
 * Free the GPU copies of the cached gun geometries and shared materials in every renderer
 * that drew them (renderer3d calls this from destroy()). The objects stay cached and valid:
 * the next renderer uploads them again. Without it each finished game left its
 * WebGLRenderer reachable through the dispose listeners on these module-level objects,
 * with its GPU buffers still allocated on the reused canvas' context.
 */
export function releaseSharedGuns() {
  for (const m of cache.values()) {
    for (const k of ['body', 'glow', 'spin', 'pump', 'tip']) if (m[k]) m[k].dispose();
  }
  if (sharedMats) for (const k in sharedMats) sharedMats[k].dispose();
}

export function gunMaterials() {
  if (sharedMats) return sharedMats;
  sharedMats = {
    body: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 48, specular: new THREE.Color('#3a3a3a') }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    lambert: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };
  return sharedMats;
}
