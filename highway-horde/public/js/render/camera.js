// Follow camera: smoothed chase of the target with look-ahead toward the cursor, trauma
// based screen shake (shake = trauma², decays linearly) and clamping to the map.

import { clamp, damp } from '../shared/math.js';

// World px visible across a 1920x1080 screen; smaller windows show a bit less (not
// proportionally less, so phones still see enough to play).
const REF_VISIBLE = 1400;
const REF_WIDTH = 1920;
const SIZE_EXP = 0.55;
const LOOK_AHEAD = 0.28;       // share of the cursor offset the camera leans toward
const LOOK_MAX = 230;          // world px
const MAX_SHAKE = 22;          // world px at trauma 1

/** CSS px per world px for a viewport of cssW x cssH. */
export function zoomFor(cssW, cssH) {
  const ref = Math.sqrt(Math.max(1, cssW * cssH) * 16 / 9);
  const visible = REF_VISIBLE * Math.pow(ref / REF_WIDTH, SIZE_EXP);
  return ref / visible;
}

/**
 * @param {{width:number, height:number}} map
 */
export function createCamera(map) {
  const cam = {
    x: map.width / 2, y: map.height / 2,
    lookX: 0, lookY: 0,
    shakeX: 0, shakeY: 0,
    trauma: 0,
    snapped: false,
    t: 0,
  };

  cam.addTrauma = (amount) => {
    cam.trauma = Math.min(1, cam.trauma + Math.max(0, amount));
  };

  /**
   * @param {number} dt seconds
   * @param {number} tx, ty target world position
   * @param {number} cx, cy cursor offset from the screen centre in world px (0 if none)
   * @param {number} viewW, viewH visible world size
   * @param {boolean} shakeOn settings.screenShake
   * @param {boolean} snap jump straight to the target (first frame, spectate switch)
   */
  cam.update = (dt, tx, ty, cx, cy, viewW, viewH, shakeOn, snap) => {
    cam.t += dt;
    let lx = cx * LOOK_AHEAD, ly = cy * LOOK_AHEAD;
    const ll = Math.hypot(lx, ly);
    if (ll > LOOK_MAX) { lx *= LOOK_MAX / ll; ly *= LOOK_MAX / ll; }
    const kl = damp(5, dt);
    cam.lookX += (lx - cam.lookX) * kl;
    cam.lookY += (ly - cam.lookY) * kl;
    const gx = tx + cam.lookX, gy = ty + cam.lookY;
    if (snap || !cam.snapped) {
      cam.x = gx; cam.y = gy; cam.snapped = true;
    } else {
      const k = damp(9, dt);
      cam.x += (gx - cam.x) * k;
      cam.y += (gy - cam.y) * k;
    }
    // clamp so the view never shows outside the map (centre it if the map is smaller)
    const hw = viewW / 2, hh = viewH / 2;
    cam.x = map.width > viewW ? clamp(cam.x, hw, map.width - hw) : map.width / 2;
    cam.y = map.height > viewH ? clamp(cam.y, hh, map.height - hh) : map.height / 2;

    cam.trauma = Math.max(0, cam.trauma - dt * 1.6);
    if (shakeOn && cam.trauma > 0) {
      const s = cam.trauma * cam.trauma * MAX_SHAKE;
      // smooth pseudo-noise instead of white noise so the shake feels like a jolt
      const t = cam.t * 38;
      cam.shakeX = s * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1.7) * 0.4);
      cam.shakeY = s * (Math.sin(t * 1.7 + 0.5) * 0.6 + Math.sin(t * 3.3 + 2.1) * 0.4);
    } else {
      cam.shakeX = cam.shakeY = 0;
    }
  };
  return cam;
}
