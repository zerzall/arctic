// Everything that moves: zombies (vector art cached into per-type animation frames),
// survivors (drawn live — there are at most six), held weapons, turrets, barricades,
// pickups, projectiles and ground hazards.

import { ZOMBIES } from '../shared/zombies.js';
import { drawZombieShape } from './zombieart.js';
import { WEAPONS } from '../shared/weapons.js';
import { CLASSES } from '../shared/classes.js';
import {
  makeCanvas, releaseCanvas, createRng, mix, shade, rgba, vivid, fillCircle, fillEllipse,
  fillRoundRect,
} from './util.js';

export { drawZombieShape };
export const ZFRAMES = 8;
const TAU = Math.PI * 2;

// Walk-cycle speed (cycles per second) per zombie type.
const ANIM_RATE = {
  walker: 1.6, runner: 3.4, crawler: 2.2, bloater: 1.1, spitter: 1.4, screamer: 1.8, brute: 1.2, boss: 0.9,
};

/** Animation cycles per second for a zombie type (also used by the renderer). */
export function zombieAnimRate(type) {
  return ANIM_RATE[type] || ANIM_RATE.walker;
}

/**
 * Lazily built sprite frames for every zombie type/variant, at a given texel scale.
 */
export function createZombieSprites(spriteScale) {
  const cache = new Map();
  const corpses = new Map();
  function ext(type) {
    const def = ZOMBIES[type] || ZOMBIES.walker;
    return Math.ceil(def.radius * 1.9 + 8);
  }
  function build(type, variant, frame, corpse) {
    const e = ext(type);
    const size = Math.ceil(e * 2 * spriteScale);
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    g.setTransform(spriteScale, 0, 0, spriteScale, size / 2, size / 2);
    drawZombieShape(g, type, variant, (frame / ZFRAMES) * TAU, corpse);
    return c;
  }
  return {
    spriteScale,
    /** Frames array for (type, variant); built on first use. */
    frames(type, variant) {
      const key = type + variant;
      let arr = cache.get(key);
      if (!arr) {
        arr = [];
        for (let f = 0; f < ZFRAMES; f++) arr.push(build(type, variant, f, false));
        cache.set(key, arr);
      }
      return arr;
    },
    corpse(type, variant) {
      const key = type + variant;
      let c = corpses.get(key);
      if (!c) { c = build(type, variant, 0, true); corpses.set(key, c); }
      return c;
    },
    /** Build all frames of the common types up front so the first wave never hitches. */
    prewarm(types) {
      for (const t of types) {
        const n = (ZOMBIES[t] || ZOMBIES.walker).look.clothes.length;
        for (let v = 0; v < n; v++) this.frames(t, v);
      }
    },
    destroy() {
      for (const arr of cache.values()) arr.forEach(releaseCanvas);
      for (const c of corpses.values()) releaseCanvas(c);
      cache.clear();
      corpses.clear();
    },
  };
}

// ---- survivors ------------------------------------------------------------------------------

const SKIN = {
  soldier: '#c68e6a', medic: '#e3b899', engineer: '#8d5a3b', scout: '#b9835a', demo: '#d9a57c', heavy: '#6f4a33',
};
export function classSkin(cls) {
  return SKIN[cls] || '#c68e6a';
}

/**
 * Grip positions (x) for the rear and front hand of a weapon drawn from x0.
 */
function grips(style, len, x0) {
  switch (style) {
    case 'pistol': case 'revolver': return [x0 + 3, x0 + 3];
    case 'dual': return [x0 + 3, x0 + 3];
    case 'double': return [x0 + len * 0.25, x0 + len * 0.55];
    case 'smg': return [x0 + len * 0.3, x0 + len * 0.62];
    case 'flamethrower': case 'cryo': return [x0 + len * 0.3, x0 + len * 0.62];
    case 'minigun': return [x0 + len * 0.2, x0 + len * 0.38];
    case 'hmg': return [x0 + len * 0.22, x0 + len * 0.5];
    case 'crossbow': return [x0 + len * 0.22, x0 + len * 0.48];
    case 'flare': return [x0 + 3, x0 + 3];
    case 'tommy': return [x0 + len * 0.25, x0 + len * 0.55];
    case 'chainsaw': return [x0 + len * 0.02, x0 + len * 0.22];
    default: return [x0 + len * 0.28, x0 + len * 0.6];
  }
}

/**
 * Paint a held weapon lying along +x starting at x0.
 * @param {number} spin minigun barrel rotation phase
 */
export function drawWeapon(g, weaponId, x0, spin = 0) {
  const w = WEAPONS[weaponId];
  if (!w) return;
  const sp = w.sprite;
  const L = sp.len, W = sp.width, col = sp.color, acc = sp.accent;
  const out = 'rgba(0,0,0,0.6)';
  const box = (x, y, l, h, c, r = 1) => {
    fillRoundRect(g, x - 0.6, y - 0.6, l + 1.2, h + 1.2, r, out);
    fillRoundRect(g, x, y, l, h, r, c);
  };
  switch (sp.style) {
    case 'pistol':
      box(x0, -W * 0.35, L * 0.95, W * 0.7, col);
      box(x0 - 1, -W * 0.3, 4, W * 0.6, acc);
      g.fillStyle = shade(col, 0.3);
      g.fillRect(x0 + 3, -0.5, L * 0.8, 1);
      break;
    case 'revolver':
      box(x0 - 1, -W * 0.3, 5, W * 0.6, acc, 2);
      fillCircle(g, x0 + L * 0.32, 0, W * 0.55, out);
      fillCircle(g, x0 + L * 0.32, 0, W * 0.48, col);
      box(x0 + L * 0.4, -W * 0.2, L * 0.6, W * 0.4, shade(col, 0.1));
      break;
    case 'double':
      box(x0 - 2, -W * 0.3, L * 0.35, W * 0.6, acc === '#777' ? '#5a3a22' : acc, 2);
      box(x0 + L * 0.25, -W * 0.45, L * 0.75, W * 0.44, '#555a5e');
      box(x0 + L * 0.25, W * 0.01, L * 0.75, W * 0.44, '#4a4f53');
      box(x0 + L * 0.25, -W * 0.5, L * 0.2, W, col, 2);
      break;
    case 'smg':
      box(x0, -W * 0.45, L * 0.7, W * 0.9, col);
      box(x0 + L * 0.7, -W * 0.18, L * 0.3, W * 0.36, shade(col, 0.2));
      box(x0 + L * 0.35, W * 0.4, 4, W * 0.7, acc);
      break;
    case 'dual':
      for (const y of [-6, 6]) {
        box(x0, y - W * 0.4, L * 0.72, W * 0.8, col);
        box(x0 + L * 0.72, y - W * 0.16, L * 0.28, W * 0.32, shade(col, 0.2));
        g.fillStyle = acc;
        g.fillRect(x0 + L * 0.2, y - 0.6, L * 0.4, 1.2);
      }
      break;
    case 'shotgun': case 'autoshotgun':
      box(x0 - 6, -W * 0.35, 10, W * 0.7, sp.style === 'shotgun' ? '#5a3a22' : '#1a1a1a', 2);
      box(x0 + 2, -W * 0.45, L * 0.3, W * 0.9, sp.style === 'shotgun' ? acc : col);
      box(x0 + L * 0.3, -W * 0.25, L * 0.7, W * 0.5, '#3a3d40');
      box(x0 + L * 0.5, -W * 0.42, L * 0.25, W * 0.84, sp.style === 'shotgun' ? col : acc, 2);
      if (sp.style === 'autoshotgun') {
        fillCircle(g, x0 + L * 0.28, W * 0.35, W * 0.62, out);
        fillCircle(g, x0 + L * 0.28, W * 0.35, W * 0.55, '#2e2e2e');
      }
      break;
    case 'crossbow': {
      box(x0 - 4, -2.5, L, 5, col, 2);
      const bx = x0 + L * 0.72;
      g.strokeStyle = out;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(bx - 5, -W / 2); g.quadraticCurveTo(bx + 5, 0, bx - 5, W / 2);
      g.stroke();
      g.strokeStyle = acc;
      g.lineWidth = 2.6;
      g.stroke();
      g.strokeStyle = 'rgba(230,230,210,0.8)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(bx - 5, -W / 2); g.lineTo(x0 + L * 0.35, 0); g.lineTo(bx - 5, W / 2);
      g.stroke();
      g.fillStyle = '#c8c8c8';
      g.fillRect(x0 + L * 0.35, -0.8, L * 0.65, 1.6);
      break;
    }
    case 'rifle': case 'dmr': case 'sniper': {
      const stock = sp.style === 'sniper' ? '#2a3238' : acc;
      box(x0 - 7, -W * 0.4, 10, W * 0.8, stock, 2);
      box(x0 + 2, -W * 0.5, L * 0.38, W, col);
      box(x0 + L * 0.38, -W * 0.36, L * 0.3, W * 0.72, sp.style === 'rifle' ? acc : shade(col, 0.1));
      box(x0 + L * 0.66, -W * 0.18, L * 0.34, W * 0.36, '#2a2c2e');
      if (sp.style !== 'rifle') {
        box(x0 + L * 0.12, -W * 0.3, L * 0.32, W * 0.6, '#151719', 2);
        fillCircle(g, x0 + L * 0.44, 0, W * 0.32, '#6fa0c8');
      } else {
        box(x0 + L * 0.2, W * 0.35, 4, W * 0.75, '#1e1e1e');
      }
      if (sp.style === 'sniper') box(x0 + L - 3, -W * 0.3, 4, W * 0.6, '#1a1a1a');
      break;
    }
    case 'flamethrower':
      box(x0 - 2, -W * 0.3, L * 0.7, W * 0.6, acc, 2);
      fillCircle(g, x0 + L * 0.3, W * 0.45, W * 0.48, out);
      fillCircle(g, x0 + L * 0.3, W * 0.45, W * 0.42, col);
      box(x0 + L * 0.6, -W * 0.2, L * 0.4, W * 0.4, '#3a3a3a');
      box(x0 + L - 3, -W * 0.28, 4, W * 0.56, '#777');
      break;
    case 'lmg':
      box(x0 - 7, -W * 0.3, 10, W * 0.6, '#1e1e1a', 2);
      box(x0 + 2, -W * 0.45, L * 0.42, W * 0.9, col);
      box(x0 + L * 0.2, W * 0.3, L * 0.22, W * 0.6, acc, 1);
      box(x0 + L * 0.42, -W * 0.28, L * 0.58, W * 0.56, '#2a2c2a');
      g.fillStyle = '#111';
      for (let x = x0 + L * 0.46; x < x0 + L * 0.9; x += 3.5) g.fillRect(x, -1, 1.5, 2);
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x0 + L * 0.85, -W * 0.3); g.lineTo(x0 + L * 0.75, -W * 0.8);
      g.moveTo(x0 + L * 0.85, W * 0.3); g.lineTo(x0 + L * 0.75, W * 0.8);
      g.stroke();
      break;
    case 'hmg': {
      box(x0 - 6, -W * 0.25, 8, W * 0.5, '#1e1e1a', 2);                 // butt
      box(x0 + 2, -W * 0.42, L * 0.36, W * 0.84, col, 2);             // receiver
      box(x0 + L * 0.36, -W * 0.3, L * 0.42, W * 0.6, '#262824');     // perforated jacket
      g.fillStyle = '#080808';
      for (let x = x0 + L * 0.4; x < x0 + L * 0.76; x += 3.2) g.fillRect(x, -W * 0.18, 1.4, W * 0.36);
      box(x0 + L * 0.78, -W * 0.14, L * 0.22, W * 0.28, '#1b1c1e');   // barrel + flash hider
      box(x0 + L * 0.3, -W * 0.08, L * 0.26, W * 0.16, '#161616');     // carry handle on top
      // belt chute curling off the left side toward the backpack
      g.strokeStyle = acc;
      g.lineWidth = W * 0.32;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x0 + L * 0.14, -W * 0.45);
      g.quadraticCurveTo(x0 + L * 0.02, -W * 1.1, x0 - L * 0.16, -W * 0.95);
      g.stroke();
      g.lineCap = 'butt';
      break;
    }
    case 'launcher':
      box(x0 - 4, -W * 0.25, 10, W * 0.5, acc, 2);
      fillCircle(g, x0 + L * 0.3, 0, W * 0.62, out);
      fillCircle(g, x0 + L * 0.3, 0, W * 0.56, shade(col, -0.1));
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU;
        fillCircle(g, x0 + L * 0.3 + Math.cos(a) * W * 0.32, Math.sin(a) * W * 0.32, W * 0.12, '#1b1b1b');
      }
      box(x0 + L * 0.45, -W * 0.34, L * 0.55, W * 0.68, col, 2);
      break;
    case 'rocket':
      box(x0 - 14, -W * 0.45, L + 4, W * 0.9, col, 3);
      g.fillStyle = shade(col, -0.35);
      g.fillRect(x0 - 14, -W * 0.45, 3, W * 0.9);
      g.fillStyle = acc;
      g.beginPath();
      g.moveTo(x0 + L - 10, -W * 0.4); g.lineTo(x0 + L + 2, 0); g.lineTo(x0 + L - 10, W * 0.4);
      g.fill();
      box(x0 + L * 0.1, W * 0.3, 4, 5, '#222');
      break;
    case 'tesla':
      box(x0 - 3, -W * 0.4, L * 0.75, W * 0.8, col, 3);
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = acc;
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(x0 + L * (0.25 + k * 0.12), 0, 1.8, W * 0.46, 0, 0, TAU);
        g.stroke();
      }
      g.strokeStyle = '#9aa';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x0 + L * 0.72, -W * 0.3); g.lineTo(x0 + L, -W * 0.12);
      g.moveTo(x0 + L * 0.72, W * 0.3); g.lineTo(x0 + L, W * 0.12);
      g.stroke();
      break;
    case 'minigun': {
      box(x0 - 6, -W * 0.45, L * 0.35, W * 0.9, col, 3);
      box(x0 + L * 0.1, W * 0.35, L * 0.2, W * 0.5, acc);
      const bx = x0 + L * 0.3;
      for (let k = 0; k < 6; k++) {
        const a = spin + k / 6 * TAU;
        const y = Math.sin(a) * W * 0.3;
        const lit = Math.cos(a);
        if (lit < -0.2) continue;
        box(bx, y - 1.4, L * 0.7, 2.8, mix('#3a3a3a', '#9e9e9e', (lit + 1) / 2), 1);
      }
      box(x0 + L * 0.55, -W * 0.4, 4, W * 0.8, '#2a2a2a');
      box(x0 + L - 4, -W * 0.4, 4, W * 0.8, '#2a2a2a');
      break;
    }
    case 'railgun':
      box(x0 - 5, -W * 0.45, L * 0.5, W * 0.9, col, 2);
      box(x0 + L * 0.3, -W * 0.5, L * 0.7, W * 0.28, '#3a3a48');
      box(x0 + L * 0.3, W * 0.22, L * 0.7, W * 0.28, '#3a3a48');
      g.fillStyle = acc;
      g.fillRect(x0 + L * 0.32, -W * 0.12, L * 0.66, W * 0.24);
      break;
    case 'burst':
      // bullpup: stock and mag behind the grip, long shroud ahead, top optic
      box(x0 - 9, -W * 0.45, L * 0.45, W * 0.9, col, 2);
      box(x0 - 5, W * 0.35, 4, W * 0.7, '#1c1c1c');
      box(x0 + L * 0.36, -W * 0.32, L * 0.4, W * 0.64, shade(col, 0.12));
      box(x0 + L * 0.76, -W * 0.16, L * 0.24, W * 0.32, '#232427');
      box(x0 + L * 0.02, -W * 0.22, L * 0.26, W * 0.44, acc, 1);
      break;
    case 'tommy':
      box(x0 - 8, -W * 0.3, 10, W * 0.6, acc, 2);
      box(x0 + 1, -W * 0.36, L * 0.4, W * 0.72, col);
      fillCircle(g, x0 + L * 0.28, W * 0.12, W * 0.62, out);
      fillCircle(g, x0 + L * 0.28, W * 0.12, W * 0.55, '#2d2a26');
      fillCircle(g, x0 + L * 0.28, W * 0.12, W * 0.2, '#555');
      box(x0 + L * 0.42, -W * 0.2, L * 0.58, W * 0.4, '#3a3632');
      g.fillStyle = '#1a1816';
      for (let x = x0 + L * 0.45; x < x0 + L * 0.8; x += 2.2) g.fillRect(x, -W * 0.26, 1, W * 0.52);
      box(x0 + L * 0.55, W * 0.18, 3.5, W * 0.55, acc, 1);
      break;
    case 'lever':
      box(x0 - 9, -W * 0.4, 12, W * 0.8, acc, 2);
      box(x0 + 2, -W * 0.5, L * 0.22, W, col, 1);
      box(x0 + L * 0.22, -W * 0.3, L * 0.78, W * 0.6, '#2e2a26');
      box(x0 + L * 0.3, -W * 0.3, L * 0.36, W * 0.6, acc, 1);
      g.strokeStyle = '#3a3530';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(x0 + L * 0.12, W * 0.55, 3.5, 2, 0, 0, TAU);
      g.stroke();
      break;
    case 'flare':
      box(x0 - 1, -W * 0.3, 5, W * 0.6, acc, 2);
      box(x0 + 3, -W * 0.45, L * 0.75, W * 0.9, col, 3);
      fillCircle(g, x0 + L * 0.78 + 1, 0, W * 0.34, '#2a1a12');
      g.fillStyle = shade(col, 0.25);
      g.fillRect(x0 + 5, -W * 0.36, L * 0.5, 1.2);
      break;
    case 'cryo':
      box(x0 - 2, -W * 0.3, L * 0.62, W * 0.6, shade(col, -0.25), 2);
      fillCircle(g, x0 + L * 0.28, W * 0.42, W * 0.5, out);
      fillCircle(g, x0 + L * 0.28, W * 0.42, W * 0.44, col);
      fillCircle(g, x0 + L * 0.28, W * 0.42, W * 0.2, acc);
      box(x0 + L * 0.58, -W * 0.28, L * 0.36, W * 0.56, '#5a6a72', 2);
      for (let k = 0; k < 3; k++) {
        g.fillStyle = acc;
        g.fillRect(x0 + L * (0.62 + k * 0.1), -W * 0.3, 1.4, W * 0.6);
      }
      box(x0 + L - 3, -W * 0.36, 4, W * 0.72, '#c9d6dc', 2);
      break;
    case 'chainsaw': {
      // engine block with the top handle, then the long bar with its running chain
      box(x0 - 6, -W * 0.55, L * 0.36, W * 1.1, col, 3);
      box(x0 - 2, -W * 0.18, L * 0.22, W * 0.36, acc, 2);
      box(x0 + L * 0.3, -W * 0.22, L * 0.72, W * 0.44, '#9ea3a8', 4);
      g.fillStyle = '#2a2a2a';
      const ph = (spin * 7) % 3;
      for (let x = x0 + L * 0.32 + ph; x < x0 + L; x += 3) {
        g.fillRect(x, -W * 0.3, 1.4, 1.2);
        g.fillRect(x, W * 0.3 - 1.2, 1.4, 1.2);
      }
      break;
    }
    case 'harpoon':
      box(x0 - 7, -W * 0.3, 10, W * 0.6, '#262a2c', 2);
      box(x0 + 1, -W * 0.42, L * 0.5, W * 0.84, col, 2);
      fillCircle(g, x0 + L * 0.2, W * 0.5, W * 0.34, acc);
      box(x0 + L * 0.5, -W * 0.22, L * 0.34, W * 0.44, '#4a555c', 1);
      g.fillStyle = '#c8ced2';
      g.fillRect(x0 + L * 0.5, -0.7, L * 0.5, 1.4);
      g.beginPath(); g.moveTo(x0 + L - 1, -W * 0.34); g.lineTo(x0 + L + 5, 0); g.lineTo(x0 + L - 1, W * 0.34); g.fill();
      break;
    case 'amr':
      box(x0 - 9, -W * 0.4, 12, W * 0.8, '#1d1f1b', 2);
      box(x0 + 2, -W * 0.5, L * 0.36, W, col, 1);
      box(x0 + L * 0.08, -W * 0.3, L * 0.28, W * 0.6, '#141516', 2);
      fillCircle(g, x0 + L * 0.37, 0, W * 0.3, '#6fa0c8');
      box(x0 + L * 0.38, -W * 0.22, L * 0.56, W * 0.44, '#232521');
      box(x0 + L * 0.92, -W * 0.5, 5, W, '#111', 1);
      g.strokeStyle = '#1a1a1a';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x0 + L * 0.7, -W * 0.25); g.lineTo(x0 + L * 0.62, -W * 0.9);
      g.moveTo(x0 + L * 0.7, W * 0.25); g.lineTo(x0 + L * 0.62, W * 0.9);
      g.stroke();
      break;
    default:
      box(x0, -W / 2, L, W, col);
  }
}

/** Muzzle distance from the player's centre for a weapon (for flashes/tracers). */
export function muzzleOffset(weaponId) {
  const w = WEAPONS[weaponId];
  if (!w) return 22;
  return 5 + w.sprite.len;
}

/**
 * Paint a survivor facing +x at the origin (alive pose). Caller sets the transform.
 * @param {object} a {cls, color, weapon, spin, walk (phase), move (0..1), recoil (0..1),
 *   melee (0..1), reload (0..1), sprint}
 */
export function drawSurvivor(g, a) {
  const cls = CLASSES[a.cls] ? a.cls : 'soldier';
  const look = CLASSES[cls].look;
  const pc = a.color;
  const skin = classSkin(cls);
  const outfit = vivid(look.outfit, 0.15, 0.1);
  const vest = look.vest;
  const out = 'rgba(0,0,0,0.65)';
  const sw = Math.sin(a.walk) * a.move;

  // feet stepping
  fillEllipse(g, -2 + sw * 7, -6, 5, 3.2, '#1b1b1b');
  fillEllipse(g, -2 - sw * 7, 6, 5, 3.2, '#1b1b1b');

  // backpack
  fillRoundRect(g, -15, -7.5, 8, 15, 3, out);
  fillRoundRect(g, -14.5, -7, 7, 14, 3, shade(vest, -0.1));

  // melee swing rotates the upper body
  const swing = a.melee > 0 ? Math.sin(a.melee * Math.PI) * 0.9 - 0.3 : 0;
  g.save();
  g.rotate(swing);
  // shoulders
  fillEllipse(g, 0, 0, 9.5, 14.5, out);
  const grad = g.createLinearGradient(0, -14, 0, 14);
  grad.addColorStop(0, shade(outfit, -0.3));
  grad.addColorStop(0.5, shade(outfit, 0.12));
  grad.addColorStop(1, shade(outfit, -0.3));
  fillEllipse(g, 0, 0, 8.5, 13.5, grad);
  // vest
  fillRoundRect(g, -6.5, -8.5, 12, 17, 4, vest);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(-5, -7, 3, 14);
  if (cls === 'medic') {
    g.fillStyle = '#ffffff';
    g.fillRect(-2.5, -1, 5, 2);
    g.fillRect(-1, -2.5, 2, 5);
  }
  // shoulder pads in the player colour: the main team-readability cue
  fillCircle(g, -1, -11.5, 4.4, out);
  fillCircle(g, -1, 11.5, 4.4, out);
  fillCircle(g, -1, -11.5, 3.7, pc);
  fillCircle(g, -1, 11.5, 3.7, pc);

  // weapon + arms
  const w = WEAPONS[a.weapon];
  const style = w ? w.sprite.style : 'pistol';
  const len = w ? w.sprite.len : 14;
  const reloadDip = a.reload > 0 ? Math.sin(a.reload * Math.PI) : 0;
  const x0 = 6 - a.recoil * 3.5 - reloadDip * 3;
  g.save();
  if (reloadDip) g.rotate(reloadDip * 0.35);
  if (w) drawWeapon(g, a.weapon, x0, a.spin);
  g.restore();
  const [rear, front] = grips(style, len, x0);
  const hand = (sx, sy, hx, hy) => {
    g.strokeStyle = out;
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(hx, hy); g.stroke();
    g.strokeStyle = outfit;
    g.lineWidth = 4.6;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo((sx + hx) / 2, (sy + hy) / 2); g.stroke();
    g.strokeStyle = skin;
    g.lineWidth = 4;
    g.beginPath(); g.moveTo((sx + hx) / 2, (sy + hy) / 2); g.lineTo(hx, hy); g.stroke();
    fillCircle(g, hx, hy, 2.6, shade(skin, -0.1));
  };
  g.lineCap = 'round';
  if (style === 'dual') {
    hand(1, 10, x0 + 3, 6);
    hand(1, -10, x0 + 3, -6);
  } else if (style === 'pistol' || style === 'revolver') {
    hand(1, 10, rear, 1.5);
    hand(1, -10, front, -1.5);
  } else {
    hand(1, 10, rear, 2);
    hand(1, -10, front - reloadDip * 6, -1.5 + reloadDip * 5);
  }
  g.restore();

  // head + hat
  const hx = 1;
  fillCircle(g, hx, 0, 7.6, out);
  const hg = g.createRadialGradient(hx + 2, -2, 1, hx, 0, 7.2);
  hg.addColorStop(0, shade(skin, 0.25));
  hg.addColorStop(1, shade(skin, -0.2));
  fillCircle(g, hx, 0, 6.9, hg);
  drawHat(g, look.hat, hx, pc, outfit);
}

function drawHat(g, hat, hx, pc, outfit) {
  switch (hat) {
    case 'helmet': {
      const grad = g.createRadialGradient(hx + 2, -2, 1, hx, 0, 8.4);
      grad.addColorStop(0, shade(outfit, 0.25));
      grad.addColorStop(1, shade(outfit, -0.35));
      fillCircle(g, hx - 0.5, 0, 8.2, grad);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 0.8;
      g.beginPath(); g.arc(hx - 0.5, 0, 8.2, 0, TAU); g.stroke();
      g.fillStyle = pc;
      g.fillRect(hx - 7.5, -1.4, 13, 2.8);
      // strapped goggles on the back
      g.fillStyle = '#222';
      g.fillRect(hx - 8.5, -3, 2, 6);
      break;
    }
    case 'cap': {
      fillEllipse(g, hx + 7, 0, 4.5, 6, pc);
      fillCircle(g, hx - 0.5, 0, 7.2, '#f2f2f2');
      g.fillStyle = '#c62828';
      g.fillRect(hx - 3.5, -1, 5, 2);
      g.fillRect(hx - 2, -2.5, 2, 5);
      break;
    }
    case 'hardhat': {
      fillEllipse(g, hx, 0, 9, 8.6, shade('#f2a900', -0.2));
      const grad = g.createRadialGradient(hx + 2, -2, 1, hx, 0, 7.5);
      grad.addColorStop(0, '#ffd54f');
      grad.addColorStop(1, '#e09a00');
      fillCircle(g, hx, 0, 7.3, grad);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(hx - 7, -1, 14, 2);
      fillCircle(g, hx - 3, 3.5, 1.8, pc);
      // head lamp
      fillCircle(g, hx + 6.8, 0, 1.8, '#fff6c0');
      break;
    }
    case 'bandana': {
      g.fillStyle = '#2a1a10';
      fillCircle(g, hx - 0.5, 0, 6.8);
      g.fillStyle = pc;
      g.beginPath();
      g.arc(hx, 0, 7.1, Math.PI * 0.5, Math.PI * 1.5, true);
      g.closePath();
      g.fill();
      // knot tails
      g.strokeStyle = pc;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hx - 6, 0); g.lineTo(hx - 11, -2.5);
      g.moveTo(hx - 6, 0); g.lineTo(hx - 11, 2.5);
      g.stroke();
      break;
    }
    case 'beanie': {
      const grad = g.createRadialGradient(hx + 1, -1, 1, hx, 0, 7.5);
      grad.addColorStop(0, '#3a3a3a');
      grad.addColorStop(1, '#141414');
      fillCircle(g, hx - 0.5, 0, 7.4, grad);
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 0.8;
      g.beginPath();
      for (let k = -5; k <= 5; k += 2.5) { g.moveTo(hx - 6, k); g.lineTo(hx + 6, k); }
      g.stroke();
      fillCircle(g, hx - 1, 0, 2.6, pc);
      break;
    }
    default: {
      // shaved head with ear defenders in the player colour
      g.fillStyle = 'rgba(20,14,10,0.45)';
      fillCircle(g, hx - 1, 0, 6);
      fillRoundRect(g, hx - 2.5, -8.8, 5, 3.5, 1.5, pc);
      fillRoundRect(g, hx - 2.5, 5.3, 5, 3.5, 1.5, pc);
      g.fillStyle = '#222';
      g.fillRect(hx - 0.8, -6, 1.6, 12);
    }
  }
}

/** Downed survivor: slumped on the ground, pistol raised toward the aim. */
export function drawDownedSurvivor(g, a) {
  const cls = CLASSES[a.cls] ? a.cls : 'soldier';
  const look = CLASSES[cls].look;
  const skin = classSkin(cls);
  const outfit = vivid(look.outfit, 0.15, 0.1);
  const out = 'rgba(0,0,0,0.65)';
  // legs splayed behind
  g.strokeStyle = shade(outfit, -0.35);
  g.lineCap = 'round';
  g.lineWidth = 5.5;
  g.beginPath();
  g.moveTo(-6, -4); g.lineTo(-22, -9);
  g.moveTo(-6, 4); g.lineTo(-21, 8);
  g.stroke();
  fillEllipse(g, -2, 0, 11, 9, out);
  fillEllipse(g, -2, 0, 10, 8.2, outfit);
  fillRoundRect(g, -8, -5.5, 10, 11, 3, look.vest);
  fillCircle(g, -3, -9, 3.3, a.color);
  fillCircle(g, -3, 9, 3.3, a.color);
  // arm + pistol forward
  if (a.weapon) drawWeapon(g, a.weapon, 8, 0);
  g.strokeStyle = skin;
  g.lineWidth = 3.6;
  g.beginPath(); g.moveTo(-1, 6); g.lineTo(9, 1); g.stroke();
  // other hand clutching the wound
  fillCircle(g, -1, -4, 2.4, shade(skin, -0.1));
  fillCircle(g, 4, 0, 6.6, out);
  fillCircle(g, 4, 0, 6, skin);
  drawHat(g, look.hat, 4, a.color, outfit);
}

/** Dead survivor lying flat (desaturated). */
export function drawDeadSurvivor(g, a) {
  const cls = CLASSES[a.cls] ? a.cls : 'soldier';
  const look = CLASSES[cls].look;
  const outfit = mix(look.outfit, '#222', 0.45);
  const skin = mix(classSkin(cls), '#556', 0.35);
  g.strokeStyle = shade(outfit, -0.3);
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(-6, -4); g.lineTo(-22, -10);
  g.moveTo(-6, 4); g.lineTo(-22, 7);
  g.moveTo(2, -8); g.lineTo(10, -20);
  g.moveTo(2, 8); g.lineTo(14, 14);
  g.stroke();
  fillEllipse(g, -2, 0, 10, 12, outfit);
  fillRoundRect(g, -8, -6, 11, 12, 3, mix(look.vest, '#222', 0.4));
  fillCircle(g, -3, -10, 3, mix(a.color, '#333', 0.5));
  fillCircle(g, -3, 10, 3, mix(a.color, '#333', 0.5));
  fillCircle(g, 11, 1, 6.2, skin);
}

// ---- deployables ------------------------------------------------------------------------------

/** Turret at the origin; `angle` = barrel angle (world), drawn with its own rotation. */
export function drawTurret(g, t, ownerColor, time) {
  // tripod
  g.strokeStyle = '#1c1e20';
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + 0.5;
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 21, Math.sin(a) * 21);
  }
  g.stroke();
  g.strokeStyle = '#4a4e52';
  g.lineWidth = 1.6;
  g.stroke();
  fillCircle(g, 0, 0, 12.5, 'rgba(0,0,0,0.6)');
  const grad = g.createRadialGradient(-3, -3, 1, 0, 0, 12);
  grad.addColorStop(0, '#6b7176');
  grad.addColorStop(1, '#2c3033');
  fillCircle(g, 0, 0, 11.5, grad);
  // head
  g.save();
  g.rotate(t.angle);
  const kick = t.firing ? Math.sin(time * 70) * 1.5 : 0;
  fillRoundRect(g, -9, -8, 18, 16, 3, 'rgba(0,0,0,0.6)');
  fillRoundRect(g, -8.5, -7.5, 17, 15, 3, '#4d5a42');
  g.fillStyle = '#3a4432';
  g.fillRect(-8.5, 4, 17, 3.5);
  fillRoundRect(g, 6 - kick, -2.6, 22, 5.2, 1.5, 'rgba(0,0,0,0.7)');
  fillRoundRect(g, 6 - kick, -2, 21, 4, 1.5, '#2a2c2e');
  fillRoundRect(g, 24 - kick, -3, 5, 6, 1, '#1a1a1a');
  // ammo box
  fillRoundRect(g, -6, 7.5, 10, 6, 1, '#4b5320');
  // sensor eye in the owner's colour
  fillCircle(g, 2, -3.5, 2.2, ownerColor);
  g.restore();
}

/** Barricade (BARRICADE.width x height) centred, with damage states from hp 0..1. */
export function drawBarricade(g, w, h, hp, id) {
  const hl = w / 2, hh = h / 2;
  const rng = createRng(id * 7 + 3);
  // steel feet
  g.fillStyle = '#2c2f31';
  for (const x of [-hl + 10, hl - 10]) g.fillRect(x - 3, -hh - 4, 6, h + 8);
  const planks = 3;
  const ph = h / planks;
  const broken = hp < 0.33 ? 2 : hp < 0.66 ? 1 : 0;
  for (let i = 0; i < planks; i++) {
    const y = -hh + i * ph;
    const missing = (broken === 2 && (i === 0 || i === 2)) || (broken === 1 && i === 1);
    if (missing) {
      // splintered stubs only
      g.fillStyle = '#5a4026';
      g.fillRect(-hl + 4, y + 1, 12 + rng.next() * 6, ph - 2);
      g.fillRect(hl - 18, y + 1, 10 + rng.next() * 6, ph - 2);
      continue;
    }
    const c = mix('#8a6238', '#6b4a2a', rng.next());
    const grad = g.createLinearGradient(0, y, 0, y + ph);
    grad.addColorStop(0, shade(c, 0.2));
    grad.addColorStop(1, shade(c, -0.3));
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(-hl - 0.5, y + 0.2, w + 1, ph);
    g.fillStyle = grad;
    g.fillRect(-hl + (rng.next() * 3), y + 0.8, w - rng.next() * 5, ph - 1.6);
    // wood grain
    g.strokeStyle = 'rgba(40,25,10,0.35)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(-hl + 4, y + ph * 0.4); g.lineTo(hl - 6, y + ph * 0.5);
    g.stroke();
    // nails
    g.fillStyle = '#bbb';
    g.fillRect(-hl + 9, y + ph / 2 - 0.8, 1.6, 1.6);
    g.fillRect(hl - 11, y + ph / 2 - 0.8, 1.6, 1.6);
  }
  // metal strap across
  g.fillStyle = '#6b7075';
  g.fillRect(-4, -hh - 1, 8, h + 2);
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.fillRect(-4, -hh - 1, 2, h + 2);
  if (broken) {
    g.strokeStyle = 'rgba(20,10,0,0.7)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k < broken * 3; k++) {
      const x = rng.range(-hl + 10, hl - 10);
      g.moveTo(x, -hh + 1); g.lineTo(x + rng.range(-6, 6), hh - 1);
    }
    g.stroke();
  }
}

// ---- pickups ------------------------------------------------------------------------------------

export const PICKUP_GLOW = {
  ammo: '#ffcf4a', health: '#ff5a5a', cash: '#6cff7a', armor: '#6ab8ff', frag: '#ffa040', crate: '#ffd27a',
};

/** Pickup icon centred at the origin (~22 px). */
export function drawPickup(g, kind, weaponShort) {
  const out = 'rgba(0,0,0,0.7)';
  switch (kind) {
    case 'ammo':
      fillRoundRect(g, -10, -7, 20, 14, 2, out);
      fillRoundRect(g, -9, -6, 18, 12, 2, '#5b6a2a');
      g.fillStyle = '#7b8a3a';
      g.fillRect(-9, -6, 18, 3);
      for (let i = 0; i < 4; i++) {
        fillRoundRect(g, -6 + i * 3.6, -3, 2.6, 8, 1.2, '#d9a93a');
        fillCircle(g, -4.7 + i * 3.6, -3, 1.2, '#b87a2a');
      }
      break;
    case 'health':
      fillRoundRect(g, -10, -8, 20, 16, 3, out);
      fillRoundRect(g, -9, -7, 18, 14, 3, '#f0f0ea');
      g.fillStyle = '#d32f2f';
      g.fillRect(-2, -5, 4, 10);
      g.fillRect(-5, -2, 10, 4);
      break;
    case 'cash':
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate(-0.25 + i * 0.22);
        fillRoundRect(g, -10, -5 + i * 1.2, 20, 10, 1.5, out);
        fillRoundRect(g, -9.5, -4.5 + i * 1.2, 19, 9, 1.5, i === 2 ? '#5a9a4a' : '#3f7a35');
        g.restore();
      }
      g.fillStyle = '#e8ffd8';
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$', 0, 2.5);
      break;
    case 'armor':
      g.beginPath();
      g.moveTo(-8, -8); g.lineTo(8, -8); g.lineTo(8, 1); g.quadraticCurveTo(8, 8, 0, 10); g.quadraticCurveTo(-8, 8, -8, 1);
      g.closePath();
      g.fillStyle = out;
      g.lineWidth = 3;
      g.strokeStyle = out;
      g.stroke();
      g.fillStyle = '#4a6a8a';
      g.fill();
      g.fillStyle = '#7fa8d0';
      g.fillRect(-5, -6, 4, 10);
      break;
    case 'frag':
      fillCircle(g, 0, 1, 7.5, out);
      fillCircle(g, 0, 1, 6.5, '#4b5a2a');
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(-6, 1); g.lineTo(6, 1); g.moveTo(0, -5); g.lineTo(0, 7);
      g.stroke();
      fillRoundRect(g, -2, -8, 4, 4, 1, '#999');
      g.strokeStyle = '#ccc';
      g.lineWidth = 1;
      g.beginPath(); g.arc(3.5, -7, 2.2, 0, TAU); g.stroke();
      break;
    case 'crate': {
      fillRoundRect(g, -17, -12, 34, 24, 2, out);
      const grad = g.createLinearGradient(-16, -11, 16, 11);
      grad.addColorStop(0, '#5a6a3a');
      grad.addColorStop(1, '#3b4726');
      fillRoundRect(g, -16, -11, 32, 22, 2, grad);
      g.strokeStyle = '#2a3218';
      g.lineWidth = 1.5;
      g.strokeRect(-14.5, -9.5, 29, 19);
      g.fillStyle = '#c9b458';
      g.fillRect(-16, -2, 3, 4);
      g.fillRect(13, -2, 3, 4);
      g.fillStyle = '#f0e2a0';
      g.font = 'bold 8px "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(weaponShort || '?', 0, 0.5);
      break;
    }
    default:
      fillCircle(g, 0, 0, 7, '#aaa');
  }
}

// ---- hazards ------------------------------------------------------------------------------------

/** Acid puddle base (non-emissive): drawn under actors. */
export function drawAcidPuddle(g, h, time) {
  const a = Math.min(1, h.life * 2.5);
  const rng = createRng(h.id * 31 + 7);
  g.globalAlpha = 0.75 * a;
  for (let i = 0; i < 5; i++) {
    const ang = rng.next() * TAU, d = h.r * 0.35 * rng.next();
    const rr = h.r * (0.45 + rng.next() * 0.35);
    const x = h.x + Math.cos(ang) * d, y = h.y + Math.sin(ang) * d;
    const grad = g.createRadialGradient(x, y, rr * 0.2, x, y, rr);
    grad.addColorStop(0, 'rgba(150,230,40,0.75)');
    grad.addColorStop(0.7, 'rgba(90,160,20,0.5)');
    grad.addColorStop(1, 'rgba(60,110,10,0)');
    g.fillStyle = grad;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // bubbles popping
  for (let i = 0; i < 7; i++) {
    const cyc = (time * (0.8 + rng.next() * 0.7) + rng.next()) % 1;
    const ang = rng.next() * TAU, d = h.r * 0.7 * Math.sqrt(rng.next());
    const x = h.x + Math.cos(ang) * d, y = h.y + Math.sin(ang) * d;
    g.strokeStyle = `rgba(210,255,120,${(1 - cyc) * 0.8})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, 1 + cyc * 4, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Scorched ground under a fire hazard (non-emissive part). */
export function drawFireBase(g, h) {
  const a = Math.min(1, h.life * 3);
  const grad = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r * 1.05);
  grad.addColorStop(0, `rgba(10,6,4,${0.6 * a})`);
  grad.addColorStop(1, 'rgba(10,6,4,0)');
  g.fillStyle = grad;
  g.fillRect(h.x - h.r * 1.1, h.y - h.r * 1.1, h.r * 2.2, h.r * 2.2);
}

/** A burning road flare lying on the ground (the glow is drawn in the emissive pass). */
export function drawFlareBase(g, h) {
  const a = Math.min(1, h.life * 6);
  const grad = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, h.r * 0.8);
  grad.addColorStop(0, `rgba(20,8,4,${0.5 * a})`);
  grad.addColorStop(1, 'rgba(20,8,4,0)');
  g.fillStyle = grad;
  g.fillRect(h.x - h.r, h.y - h.r, h.r * 2, h.r * 2);
  const ang = hash01(h.id) * TAU;
  g.save();
  g.translate(h.x, h.y);
  g.rotate(ang);
  fillRoundRect(g, -7, -1.8, 10, 3.6, 1.5, '#b3261e');
  fillRoundRect(g, -8, -1.9, 2.2, 3.8, 0.8, '#2a2a2a');
  g.restore();
}

// ---- projectiles --------------------------------------------------------------------------------

/**
 * Non-emissive projectile bodies (bolt shaft, grenade shells, bottles). Called with the
 * world transform set; uses save/restore since there are only a handful in flight.
 */
export function drawProjectileBody(g, p, time) {
  switch (p.kind) {
    case 'harpoon':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      // the line trails back toward the gun
      g.strokeStyle = 'rgba(200,205,210,0.55)';
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(-70, Math.sin(time * 30 + p.id) * 1.5); g.stroke();
      g.strokeStyle = '#8a9296';
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(8, 0); g.stroke();
      g.fillStyle = '#d8dde0';
      g.beginPath(); g.moveTo(6, -3.2); g.lineTo(14, 0); g.lineTo(6, 3.2); g.lineTo(8, 0); g.fill();
      g.fillStyle = '#f2a900';
      g.fillRect(-16, -1.8, 3, 3.6);
      g.restore();
      break;
    case 'flare':
      fillCircle(g, p.x, p.y, 3.2, '#3a1a10');
      break;
    case 'frost':
      break;
    case 'bolt':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      g.strokeStyle = '#6b4a2a';
      g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(6, 0); g.stroke();
      g.fillStyle = '#cfd8dc';
      g.beginPath(); g.moveTo(6, -2.2); g.lineTo(11, 0); g.lineTo(6, 2.2); g.fill();
      g.fillStyle = '#c62828';
      g.beginPath(); g.moveTo(-16, 0); g.lineTo(-12, -3); g.lineTo(-10, 0); g.lineTo(-12, 3); g.fill();
      g.restore();
      break;
    case 'grenade':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      fillEllipse(g, 0, 0, 5.5, 4, 'rgba(0,0,0,0.7)');
      fillEllipse(g, 0, 0, 4.8, 3.4, '#556b2f');
      g.fillStyle = '#c9b458';
      g.fillRect(1, -3.4, 1.2, 6.8);
      g.restore();
      break;
    case 'rocket':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      fillRoundRect(g, -10, -3.2, 18, 6.4, 3, 'rgba(0,0,0,0.7)');
      fillRoundRect(g, -9.5, -2.7, 17, 5.4, 2.5, '#6b7a45');
      g.fillStyle = '#8d6e63';
      g.beginPath(); g.moveTo(7, -2.7); g.lineTo(12, 0); g.lineTo(7, 2.7); g.fill();
      g.fillStyle = '#333';
      g.beginPath(); g.moveTo(-9, -2.5); g.lineTo(-12, -6); g.lineTo(-6, -2.5); g.fill();
      g.beginPath(); g.moveTo(-9, 2.5); g.lineTo(-12, 6); g.lineTo(-6, 2.5); g.fill();
      g.restore();
      break;
    case 'frag':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(time * 9 + p.id);
      fillCircle(g, 0, 0, 5.4, 'rgba(0,0,0,0.7)');
      fillCircle(g, 0, 0, 4.6, '#44502a');
      g.fillStyle = '#9e9e9e';
      g.fillRect(-1, -6.5, 2, 3);
      g.restore();
      break;
    case 'molotov':
      g.save();
      g.translate(p.x, p.y);
      g.rotate(time * 12 + p.id);
      fillRoundRect(g, -6, -3.5, 12, 7, 3, 'rgba(0,0,0,0.6)');
      fillRoundRect(g, -5.5, -3, 9, 6, 3, '#4a6a2a');
      fillRoundRect(g, 3, -1.5, 4, 3, 1, '#3a5a22');
      g.fillStyle = '#d9d0b0';
      g.fillRect(6, -1.2, 3, 2.4);
      g.restore();
      break;
    case 'acid':
      fillCircle(g, p.x, p.y, 5.5, 'rgba(40,70,10,0.8)');
      fillCircle(g, p.x, p.y, 4.4, '#8ee03a');
      fillCircle(g, p.x - 1.2, p.y - 1.2, 1.5, '#e8ffb0');
      break;
    default:
      break;
  }
}

