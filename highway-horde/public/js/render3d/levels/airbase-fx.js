// Fort Harlan's moving light: by night the searchlights sweep the wire from their towers (a soft beam each
// and a pool of light that follows the nearest one across the ground), and the tower's beacon turns,
// throwing its white and green beams over the field; by day the sun slants through the hangars' skylights
// and doors in dusty shafts. Each piece is one draw call; the sweeps are mesh rotations per frame.

import * as THREE from 'three';
import { BASE } from '../../shared/levels/airbase.js';
import { makeBeams } from './railyard-fx.js';
import { hangarDims } from './airbase-field.js';

/** One beam along local +x from the origin (a beam mesh to be placed and turned). */
function beamAt(fx, len, w, color, k, tilt = 0) {
  const d = [Math.cos(tilt), -Math.sin(tilt), 0];
  return makeBeams([{ p: [0, 0, 0], d, len, w }], fx, color, k);
}

/**
 * @param {object} ctx renderer ctx
 * @param {object} deps level art deps (root, fx, day, full)
 */
export function createBaseFx(ctx, deps) {
  const { root, fx, day } = deps;
  const own = [];
  const add = (m) => { root.add(m); own.push(m); return m; };
  const sweeps = [];
  let beacon = null;
  let full = deps.full;
  const map = ctx.map;

  if (!day) {
    // searchlights: the gate's two towers and the outer checkpoint's guard tower
    for (const o of map.obstacles) {
      if (o.style !== 'searchtower' && o.style !== 'guardtower') continue;
      const h = o.style === 'guardtower' ? 336 : 318;
      const m = add(beamAt(fx, 1100, 90, [0.85, 0.9, 1.0], 0.12, 0.3));
      m.position.set(o.x, h, o.y);
      m.name = 'c3-searchbeam';
      // each sweeps its own arc outward over the wire, out of step with the others
      const base = o.style === 'guardtower' ? 0 : Number(o.label) ? 0.5 : -0.5;
      sweeps.push({ m, x: o.x, y: o.y, h, base, amp: o.style === 'guardtower' ? 1.2 : 0.7, speed: 0.22 + sweeps.length * 0.05, ph: sweeps.length * 2.1, tilt: 0.3 });
    }
    // the tower's beacon: a white and a green beam back to back, turning about 12 times a minute
    const g = new THREE.Group();
    g.position.set(8730, 600 + 84 + 74, 1580);
    const white = beamAt(fx, 2200, 80, [1, 1, 0.95], 0.1, -0.03);
    const green = beamAt(fx, 2200, 80, [0.4, 1, 0.55], 0.1, -0.03);
    green.rotation.y = Math.PI;
    g.add(white, green);
    g.name = 'c3-beacon';
    beacon = add(g);
  } else {
    // daylight through the hangars: shafts from the skylight strips and the open doors down to the floor
    const look = (map.look && map.look.day) || { az: 235, el: 26 };
    const az = (look.az * Math.PI) / 180, el = (look.el * Math.PI) / 180;
    const d = [-Math.cos(el) * Math.cos(az), -Math.sin(el), -Math.cos(el) * Math.sin(az)];
    const beams = [];
    for (const h of BASE.hangars) {
      const { Hs, rise } = hangarDims(h);
      const W = h.x1 - h.x0, cx = (h.x0 + h.x1) / 2;
      const inside = (x, z) => x > h.x0 + 20 && x < h.x1 - 20 && z > h.y0 + 20 && z < h.y1 - 20;
      for (const k of [0.35, 0.65]) {
        const a = Math.PI * k;
        const x = cx + Math.cos(a) * W / 2, y = Hs + Math.sin(a) * rise - 6;
        for (let z = h.y0 + 80; z < h.y1 - 60; z += 150) {
          // as long as it stays in the hangar, at most down to the floor
          let len = y / -d[1];
          while (len > 60 && !inside(x + d[0] * len, z + d[2] * len)) len -= 40;
          if (len > 60) beams.push({ p: [x, y, z], d, len, w: 46 });
        }
      }
    }
    if (beams.length && full !== 'low') add(makeBeams(beams, fx, [1.0, 0.95, 0.85], 0.1));
  }

  let t = 0;
  let near = null;
  function setQuality(q) {
    full = q;
    for (const m of own) m.visible = q !== 'low' || m.name === 'c3-beacon';
  }
  setQuality(full);
  return {
    update(view, frame) {
      const dt = Math.min(0.1, (frame && frame.dt) || 0.016);
      t += dt;
      for (const s of sweeps) {
        s.yaw = s.base + Math.sin(t * s.speed + s.ph) * s.amp;
        s.m.rotation.y = -s.yaw;
      }
      if (beacon) beacon.rotation.y = -t * 1.25;
      // a pool of light under the beam nearest the camera, where it meets the ground
      const cam = ctx.camera;
      if (sweeps.length && cam && ctx.lights && ctx.lights.steady && full !== 'low') {
        let best = null, bd = Infinity;
        for (const s of sweeps) {
          const dd = (s.x - cam.position.x) ** 2 + (s.y - cam.position.z) ** 2;
          if (dd < bd) { bd = dd; best = s; }
        }
        if (best && bd < 2200 * 2200) {
          const reach = best.h / Math.tan(best.tilt);
          const gx = best.x + Math.cos(best.yaw) * reach, gz = best.y + Math.sin(best.yaw) * reach;
          ctx.lights.steady('airbase:search', gx, gz, 160, '#e8f0ff', 3.2, 520);
          near = best;
        } else near = null;
      }
      void near;
    },
    setQuality,
    dispose() {
      for (const m of own) {
        root.remove(m);
        m.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
      }
    },
  };
}
