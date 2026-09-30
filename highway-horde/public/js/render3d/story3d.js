// The Road to Haven story layer of the first-person view (STORY.md §5, SPEC §7.5):
//   - story items on the ground (fuel cans, batteries, radio parts, notes, medical crates, a
//     marine pump ...): small props that bob and turn over a soft ground ring and a faint light
//     shaft, so they can be found across a dark field
//   - hold-to-use devices the missions ask for (terminal, generator, beacon, repair kit, radio,
//     switch, valve, winch, pump, cache, post): a prop with a lamp that shows waiting / used, over a
//     ground ring that fills while somebody holds E. The hideout stations (board, workbench ...)
//     get only the ring: the hub map dresses them
//   - the objective's markers: a light shaft and, for an area, a ground ring; on the overlay an
//     icon with the distance in metres (pinned to the screen edge, with an arrow, when off screen)
// Built lazily: a game without a story pays nothing.

import * as THREE from 'three';
import { itemInfo, markColor, MARKER_COLORS } from '../shared/story-defs.js';

const TAU = Math.PI * 2;
const PX_PER_M = 32;
const FONT_FAMILY = '"Barlow Condensed", system-ui, sans-serif';
const STATIONS = new Set(['board', 'workbench', 'armory', 'infirmary', 'upgrades', 'bed', 'range', 'campfire']);
const MAX_MARKS = 16;

const BEAM_VS = /* glsl */`
varying float vY;
varying float vDepth;
void main() {
  vY = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const BEAM_FS = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
varying float vY;
varying float vDepth;
void main() {
  float a = uStrength * pow(1.0 - vY, 1.4) * smoothstep(50.0, 420.0, vDepth);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * @param {object} ctx renderer ctx (SPEC §7.5)
 */
export function createStory3D(ctx) {
  const THREE_ = ctx.THREE || THREE;
  const root = new THREE_.Group();
  root.name = 'story3d';
  ctx.scene.add(root);
  const disposables = [];
  const own = (o) => { disposables.push(o); return o; };

  // ---- shared geometry and materials ----------------------------------------------------
  const G = {
    box: own(new THREE_.BoxGeometry(1, 1, 1)),
    cyl: own(new THREE_.CylinderGeometry(0.5, 0.5, 1, 16)),
    ball: own(new THREE_.SphereGeometry(1, 14, 10)),
    ring: own(new THREE_.RingGeometry(0.9, 1, 56)),
    disc: own(new THREE_.CircleGeometry(1, 40)),
    beam: own((() => { const g = new THREE_.CylinderGeometry(1, 1, 1, 12, 1, true); g.translate(0, 0.5, 0); return g; })()),
    torus: own(new THREE_.TorusGeometry(1, 0.14, 8, 24)),
  };
  const solid = new Map();
  function mat(hex, extra = {}) {
    const key = hex + JSON.stringify(extra);
    let m = solid.get(key);
    if (!m) {
      m = own(new THREE_.MeshStandardMaterial({ color: hex, roughness: 0.72, metalness: 0.12, ...extra }));
      solid.set(key, m);
    }
    return m;
  }
  const glows = new Map();
  function glow(hex, k = 1.6) {
    const key = hex + k;
    let m = glows.get(key);
    if (!m) {
      m = own(new THREE_.MeshStandardMaterial({ color: '#101010', emissive: hex, emissiveIntensity: k, roughness: 0.5 }));
      glows.set(key, m);
    }
    return m;
  }
  const adds = new Map();
  const addShared = (hex, opacity) => {
    const key = hex + opacity;
    let m = adds.get(key);
    if (!m) {
      m = addMat(hex, opacity);
      adds.set(key, m);
    }
    return m;
  };
  const beamMats = new Map();
  const beamShared = (hex, strength) => {
    const key = hex + strength;
    let m = beamMats.get(key);
    if (!m) {
      m = beamMat(hex, strength);
      beamMats.set(key, m);
    }
    return m;
  };
  const addMat = (hex, opacity) => own(new THREE_.MeshBasicMaterial({
    color: hex, transparent: true, opacity, blending: THREE_.AdditiveBlending, depthWrite: false, side: THREE_.DoubleSide, fog: true,
  }));
  function beamMat(hex, strength) {
    return own(new THREE_.ShaderMaterial({
      uniforms: { uColor: { value: new THREE_.Color(hex) }, uStrength: { value: strength } },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS,
      transparent: true, depthWrite: false, blending: THREE_.AdditiveBlending, side: THREE_.DoubleSide, fog: false,
    }));
  }

  function part(g, geo, m, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const me = new THREE_.Mesh(geo, m);
    me.position.set(x, y, z);
    me.scale.set(sx, sy, sz);
    me.rotation.set(rx, ry, rz);
    me.castShadow = ctx.quality !== 'low';
    g.add(me);
    return me;
  }

  // ---- items ----------------------------------------------------------------------------
  const items = new Map();       // id → { g, y0, seed, beam, ring }
  function buildItem(it) {
    const info = itemInfo(it.item);
    const g = new THREE_.Group();
    const c = info.color;
    switch (info.shape) {
      case 'can':
        part(g, G.cyl, mat(c), 0, 0, 0, 10, 13, 10);
        part(g, G.cyl, mat('#222'), 1.5, 8.3, 0, 4, 3, 4);
        part(g, G.box, mat(c), 0, 4.5, 4.6, 5, 2, 1.2);
        part(g, G.cyl, mat('#e8e4d8'), 0, 0.5, 0, 10.4, 2.6, 10.4);
        break;
      case 'box':
        part(g, G.box, mat(c), 0, 0, 0, 14, 10, 11);
        part(g, G.box, mat(info.mark || '#444'), 0, 0, 5.6, 10, 2, 0.6);
        part(g, G.box, mat(info.mark || '#444'), 0, 0, 5.62, 2, 8, 0.6);
        part(g, G.box, mat('#3a3a3a'), 0, 5.2, 0, 14.4, 0.8, 4);
        break;
      case 'part':
        part(g, G.box, mat('#1c3a34'), 0, 0, 0, 10, 1.4, 7);
        part(g, G.box, glow(c, 1.4), 2, 1.3, 0, 3, 1.4, 3);
        part(g, G.box, mat('#222'), -2.5, 1.2, 1.6, 3.2, 1.2, 2);
        part(g, G.box, mat('#c8b060'), -4.8, 0.8, 0, 0.8, 0.8, 5);
        break;
      case 'note': {
        const p = part(g, G.box, glow('#f4ecd0', 0.9), 0, 0, 0, 8, 0.5, 10);
        p.rotation.set(0.15, 0.2, 0.08);
        part(g, G.box, mat('#3a3a3a'), 0.4, 0.5, 0, 5, 0.12, 0.5);
        part(g, G.box, mat('#3a3a3a'), 0.4, 0.5, 2, 5, 0.12, 0.5);
        break;
      }
      case 'sack':
        part(g, G.ball, mat(c), 0, 0, 0, 7.5, 6.5, 7.5);
        part(g, G.ball, mat(c), 0, 6, 0, 2.6, 2.2, 2.6);
        break;
      case 'case':
        part(g, G.box, mat(c), 0, 0, 0, 15, 7, 9);
        part(g, G.box, mat('#c8c090'), 0, 3.6, 0, 6, 0.8, 1.6);
        part(g, G.box, mat('#222'), 7.6, 0.4, 0, 0.8, 2, 2);
        break;
      case 'tape':
        part(g, G.box, mat('#4a4a52'), 0, 0, 0, 10, 3.4, 7);
        part(g, G.cyl, mat('#d0d0d0'), -2, 1.9, 0, 3, 0.8, 3);
        part(g, G.cyl, mat('#d0d0d0'), 2.4, 1.9, 0, 3, 0.8, 3);
        part(g, G.box, glow('#7be07b', 1), 0, 1.8, 2.6, 1.6, 0.5, 0.9);
        break;
      case 'tag':
        part(g, G.cyl, mat(c, { metalness: 0.7 }), 0, 0, 0, 5.4, 0.7, 4);
        part(g, G.torus, mat('#9a9a9a', { metalness: 0.8 }), 0, 0.2, -3.6, 2.4, 2.4, 2.4, Math.PI / 2, 0, 0);
        break;
      case 'pump':
        part(g, G.cyl, mat(c), 0, 0, 0, 10, 10, 10);
        part(g, G.cyl, mat('#556'), 0, 6.6, 0, 6, 3.4, 6);
        part(g, G.cyl, mat('#778'), 6.4, 1.6, 0, 3.2, 8, 3.2, 0, 0, Math.PI / 2);
        break;
      default:
        part(g, G.box, mat(c), 0, 0, 0, 12, 10, 10);
    }
    root.add(g);
    const beam = new THREE_.Mesh(G.beam, beamShared(c, 0.5));
    beam.scale.set(2.2, 260, 2.2);
    beam.frustumCulled = false;
    root.add(beam);
    const ring = new THREE_.Mesh(G.ring, addShared(c, 0.4));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(20);
    root.add(ring);
    return { g, beam, ring, seed: (it.id * 0.7) % TAU, x: it.x, y: it.y };
  }

  function updateItems(list, time) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let o = items.get(it.id);
      if (!o) {
        o = buildItem(it);
        items.set(it.id, o);
      }
      const gy = ctx.groundY(it.x, it.y);
      const bob = Math.sin(time * 2.1 + o.seed) * 1.8;
      o.g.position.set(it.x, gy + 11 + bob, it.y);
      o.g.rotation.y = time * 0.9 + o.seed;
      o.beam.position.set(it.x, gy, it.y);
      o.ring.position.set(it.x, gy + 1.2, it.y);
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + o.seed);
      o.ring.scale.setScalar(19 + pulse * 3);
    }
    for (const [id, o] of items) {
      if (seen.has(id)) continue;
      root.remove(o.g, o.beam, o.ring);
      items.delete(id);
    }
  }

  // ---- devices ---------------------------------------------------------------------------
  const devs = new Map();        // id → { g, ring, lamp, kind, ... }
  const LAMP_OFF = new THREE_.Color('#2a2c30');
  const LAMP_ON = new THREE_.Color('#ffb03a');
  const LAMP_DONE = new THREE_.Color('#5cff8a');

  function lampMat() {
    return own(new THREE_.MeshStandardMaterial({ color: '#181818', emissive: '#000', emissiveIntensity: 1.6, roughness: 0.4 }));
  }

  function buildDevice(it) {
    const g = new THREE_.Group();
    const lamps = [];
    const lamp = (x, y, z, sx, sy, sz) => {
      const m = lampMat();
      part(g, G.box, m, x, y, z, sx, sy, sz);
      lamps.push(m);
    };
    const metal = mat('#3a3f46'), dark = mat('#22252a');
    switch (it.kind) {
      case 'terminal':
        part(g, G.box, metal, 0, 10, 0, 13, 20, 17);
        part(g, G.box, dark, 3.5, 22, 0, 4, 12, 16, 0, 0, -0.5);
        lamp(6.3, 22.5, 0, 0.8, 9.5, 13);
        break;
      case 'generator':
        part(g, G.box, mat('#b8901e'), 0, 11, 0, 30, 20, 17);
        part(g, G.box, dark, 0, 21.5, 0, 26, 2.5, 14);
        part(g, G.cyl, dark, -9, 28, 0, 4.4, 14, 4.4);
        part(g, G.box, mat('#8a6a10'), 0, 3, 0, 34, 4, 21);
        lamp(15.5, 14, 5, 1, 4, 4);
        break;
      case 'beacon':
        part(g, G.cyl, dark, 0, 2, 0, 16, 4, 16);
        part(g, G.cyl, metal, 0, 32, 0, 3, 60, 3);
        part(g, G.box, metal, 0, 20, 0, 12, 1.2, 1.2, 0, 0, 0);
        lamp(0, 66, 0, 9, 9, 9);
        break;
      case 'repair':
        part(g, G.box, mat('#a33228'), 0, 5, 0, 18, 10, 10);
        part(g, G.box, dark, 0, 10.4, 0, 20, 1.6, 4);
        part(g, G.cyl, mat('#9a9ea4'), 0, 12.5, 0, 1.6, 22, 1.6, 0, 0, 1.15);
        lamp(9.2, 5, 0, 0.8, 3, 3);
        break;
      case 'radio':
        part(g, G.box, mat('#4a5238'), 0, 6, 0, 16, 12, 10);
        part(g, G.cyl, dark, 0, 24, -4, 0.7, 36, 0.7);
        part(g, G.cyl, dark, 3, 9, 4.8, 3.6, 1, 3.6, Math.PI / 2, 0, 0);
        lamp(8.2, 8, -2, 0.8, 3, 5);
        break;
      case 'switch':
        part(g, G.box, metal, 0, 10, 0, 4, 22, 14);
        part(g, G.box, dark, 2.4, 10, 0, 1, 14, 8);
        {
          const lev = part(g, G.cyl, mat('#c8402a'), 3.2, 12, 0, 1.6, 10, 1.6);
          lev.userData.lever = true;
          g.userData.lever = lev;
        }
        lamp(2.6, 19, 0, 1, 2, 2);
        break;
      case 'valve':
        part(g, G.cyl, mat('#6a6f75'), 0, 6, 0, 5, 26, 5, Math.PI / 2, 0, 0);
        part(g, G.torus, mat('#b84a2a'), 0, 12, 0, 8, 8, 8);
        part(g, G.cyl, mat('#b84a2a'), 0, 12, 0, 1.4, 14, 1.4);
        lamp(0, 18, 6, 2, 2, 2);
        break;
      case 'winch':
        part(g, G.box, mat('#555a60'), 0, 3, 0, 22, 6, 16);
        part(g, G.cyl, mat('#8a8f95'), 0, 12, 0, 12, 18, 12, Math.PI / 2, 0, 0);
        part(g, G.cyl, mat('#c8b060'), 0, 12, 0, 13, 4, 13, Math.PI / 2, 0, 0);
        lamp(0, 22, 8, 3, 2, 2);
        break;
      case 'pump':
        part(g, G.cyl, mat('#3a78a0'), 0, 8, 0, 12, 16, 12);
        part(g, G.cyl, metal, 0, 18, 0, 6, 5, 6);
        part(g, G.cyl, mat('#8a8f95'), 9, 9, 0, 3.4, 16, 3.4, 0, 0, Math.PI / 2);
        lamp(6.4, 14, 0, 1, 2, 2);
        break;
      case 'cache':
        part(g, G.box, mat('#6a5a38'), 0, 7, 0, 22, 14, 14);
        part(g, G.box, mat('#3a3a3a'), 0, 14.4, 0, 23, 1.6, 6);
        lamp(11.2, 8, 0, 0.8, 3, 3);
        break;
      case 'door':
        part(g, G.box, dark, 0, 14, 0, 4, 28, 3);
        lamp(0, 30, 0, 4, 1.6, 2);
        break;
      default:
        part(g, G.cyl, metal, 0, 12, 0, 4, 24, 4);
        part(g, G.ball, dark, 0, 26, 0, 4, 4, 4);
    }
    root.add(g);
    const ring = new THREE_.Mesh(G.ring, addMat('#6ee7b7', 0.5));
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
    const fill = new THREE_.Mesh(G.disc, addMat('#6ee7b7', 0.1));
    fill.rotation.x = -Math.PI / 2;
    root.add(fill);
    return { g, ring, fill, lamps, kind: it.kind, station: STATIONS.has(it.kind), spin: hashf(it.id) };
  }
  function hashf(s) {
    let h = 0;
    for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000;
  }

  const _c = new THREE_.Color();
  function updateDevices(list, time) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let o = devs.get(it.id);
      if (!o) {
        o = buildDevice(it);
        devs.set(it.id, o);
      }
      const gy = ctx.groundY(it.x, it.y);
      o.g.position.set(it.x, gy, it.y);
      o.g.rotation.y = -0.6 + o.spin * 1.2;
      const showRing = it.on || it.done;
      const live = it.on && !it.done;
      const rad = Math.max(22, Math.min(64, it.r * 0.55));
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + o.spin * 9);
      o.ring.visible = o.fill.visible = showRing && !(o.station && it.done);
      o.ring.position.set(it.x, gy + 1.1, it.y);
      o.fill.position.set(it.x, gy + 1.0, it.y);
      o.ring.scale.setScalar(rad * (live ? 1 + pulse * 0.04 : 1));
      o.fill.scale.setScalar(rad * 0.9 * Math.max(0.02, it.prog || 0));
      _c.set(it.done ? '#7fdc5a' : '#6ee7b7');
      o.ring.material.color.copy(_c);
      o.fill.material.color.copy(_c);
      o.ring.material.opacity = it.done ? 0.22 : live ? 0.32 + pulse * 0.28 : 0.18;
      o.fill.material.opacity = 0.16 + (it.prog || 0) * 0.3;
      // lamps: waiting = amber pulse, used = green, idle = dark
      const lc = it.done ? LAMP_DONE : live ? LAMP_ON : LAMP_OFF;
      for (const m of o.lamps) {
        m.emissive.copy(lc);
        m.emissiveIntensity = it.done ? 1.6 : live ? 0.7 + pulse * 1.6 : 0.2;
      }
      const lev = o.g.userData.lever;
      if (lev) lev.rotation.x = it.done ? 1.1 : -0.5;
    }
    for (const [id, o] of devs) {
      if (seen.has(id)) continue;
      root.remove(o.g, o.ring, o.fill);
      devs.delete(id);
    }
  }

  // ---- objective markers -------------------------------------------------------------------
  const beams = [], rings = [];
  for (let k = 0; k < MAX_MARKS; k++) {
    const b = new THREE_.Mesh(G.beam, beamMat('#ffc400', 0.55));
    b.frustumCulled = false;
    b.visible = false;
    root.add(b);
    beams.push(b);
    const r = new THREE_.Mesh(G.ring, addMat('#ffc400', 0.4));
    r.rotation.x = -Math.PI / 2;
    r.visible = false;
    root.add(r);
    rings.push(r);
  }
  const colorCache = new Map();
  function colorOf(kind) {
    let c = colorCache.get(kind);
    if (!c) {
      c = new THREE_.Color(markColor(kind));
      colorCache.set(kind, c);
    }
    return c;
  }

  function updateMarks(marks, time) {
    const n = Math.min(marks.length, MAX_MARKS);
    for (let k = 0; k < MAX_MARKS; k++) {
      const b = beams[k], r = rings[k];
      if (k >= n) {
        b.visible = r.visible = false;
        continue;
      }
      const m = marks[k];
      const c = colorOf(m.kind);
      const gy = ctx.groundY(m.x, m.y);
      b.visible = true;
      b.position.set(m.x, gy, m.y);
      const small = m.kind === 'item' || m.kind === 'enemy';
      b.scale.set(small ? 2 : 3.4, small ? 180 : 620, small ? 2 : 3.4);
      b.material.uniforms.uColor.value.copy(c);
      b.material.uniforms.uStrength.value = small ? 0.35 : 0.6;
      if (m.r > 30) {
        r.visible = true;
        r.position.set(m.x, gy + 1.4, m.y);
        r.scale.setScalar(m.r);
        r.material.color.copy(c);
        r.material.opacity = 0.28 + 0.14 * Math.sin(time * 3 + k);
      } else {
        r.visible = false;
      }
    }
  }

  // ---- overlay: icons with distances -----------------------------------------------------
  let ui = 1;
  function icon(g, kind, x, y, s, col, pulse) {
    g.save();
    g.translate(x, y);
    g.lineJoin = 'round';
    g.lineWidth = 3 * ui;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.fillStyle = col;
    const path = () => {
      g.beginPath();
      switch (kind) {
        case 'item':
        case 'enemy':
        case 'objective':
          g.moveTo(0, -s); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0); g.closePath();
          break;
        case 'reach':
        case 'exit':
          g.arc(0, 0, s * 0.85, 0, TAU);
          break;
        case 'use':
          g.rect(-s * 0.7, -s * 0.7, s * 1.4, s * 1.4);
          break;
        case 'defend':
          g.moveTo(-s * 0.8, -s * 0.7); g.lineTo(s * 0.8, -s * 0.7); g.lineTo(s * 0.8, 0); g.lineTo(0, s); g.lineTo(-s * 0.8, 0); g.closePath();
          break;
        case 'escort':
        case 'npc':
          g.moveTo(0, -s); g.lineTo(s * 0.9, s * 0.8); g.lineTo(-s * 0.9, s * 0.8); g.closePath();
          break;
        default:
          g.arc(0, 0, s * 0.8, 0, TAU);
      }
    };
    g.scale(1 + pulse * 0.08, 1 + pulse * 0.08);
    path();
    g.stroke();
    g.globalAlpha *= 0.92;
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.font = `800 ${Math.round(s * 1.15)}px ${FONT_FAMILY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const glyph = kind === 'use' ? 'E' : kind === 'npc' ? '!' : kind === 'enemy' ? 'x' : '';
    if (glyph) g.fillText(glyph, 0, s * 0.06);
    g.restore();
  }

  const shown = [];
  function drawOverlay(view, frame, time) {
    const g = ctx.overlay;
    if (!g) return;
    const local = frame.local;
    const st = view && view.story;
    if (!local || local.state === 'dead') return;
    const settings = frame.settings || {};
    if (settings.crosshair === false) return;
    const k0 = Number(settings.uiScale);
    ui = Number.isFinite(k0) && k0 > 0 ? Math.max(0.5, Math.min(4, k0)) : 1;
    const c = g.canvas;
    const W = c.clientWidth || parseFloat(c.style.width) || c.width;
    const H = c.clientHeight || parseFloat(c.style.height) || c.height;
    g.save();
    // hold rings over the devices somebody works on
    for (const it of (view && view.interactables) || []) {
      if (!(it.prog > 0.001) || it.done) continue;
      const p = ctx.project(it.x, it.y, 46);
      if (!p.visible) continue;
      const r = 13 * ui;
      g.lineWidth = 5 * ui;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TAU);
      g.stroke();
      g.strokeStyle = '#6ee7b7';
      g.lineWidth = 3 * ui;
      g.beginPath();
      g.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, it.prog));
      g.stroke();
    }
    if (st && st.marks && st.marks.length) {
      // the icons: on screen where they are; off screen only the nearest of each kind, pinned to the edge
      const mx = Math.min(W * 0.3, 90 * ui), my = Math.min(H * 0.3, 150 * ui);
      shown.length = 0;
      const nearestOff = new Map();
      const beat = 0.5 + 0.5 * Math.sin(time * 4);
      for (const m of st.marks) {
        const d = Math.hypot(m.x - local.x, m.y - local.y);
        const p = ctx.project(m.x, m.y, m.kind === 'item' ? 26 : m.kind === 'npc' ? 96 : 84);
        const inside = p.visible && p.x >= mx && p.x <= W - mx && p.y >= my && p.y <= H - my;
        if (m.kind === 'npc' && inside && d < 500) continue;   // (the NPC's own "!" says it)
        if (inside) {
          shown.push({ m, p, d, off: false });
        } else {
          const best = nearestOff.get(m.kind);
          if (!best || d < best.d) nearestOff.set(m.kind, { m, p, d, off: true });
        }
      }
      for (const v of nearestOff.values()) shown.push(v);
      for (const v of shown) {
        const { m, p, d } = v;
        const col = MARKER_COLORS[m.kind] || MARKER_COLORS.objective;
        let x = p.x, y = p.y, ang = 0;
        if (v.off) {
          const cx = W / 2, cy = H / 2;
          ang = Math.atan2(y - cy, x - cx);
          const dx = Math.cos(ang), dy = Math.sin(ang);
          const s = Math.min((W / 2 - mx) / Math.max(1e-6, Math.abs(dx)), (H / 2 - my) / Math.max(1e-6, Math.abs(dy)));
          x = cx + dx * s;
          y = cy + dy * s;
        }
        // fade a little when very close (the ground ring and the prompt say the rest)
        g.globalAlpha = Math.max(0.35, Math.min(1, d / 160));
        const s = (m.kind === 'item' ? 7.5 : 9.5) * ui;
        icon(g, m.kind, x, y, s, col, m.kind === 'item' ? 0 : beat);
        if (v.off) {
          g.save();
          g.translate(x, y);
          g.rotate(ang);
          g.fillStyle = col;
          g.strokeStyle = 'rgba(0,0,0,0.7)';
          g.lineWidth = 2 * ui;
          g.beginPath();
          g.moveTo(s * 2.1, 0); g.lineTo(s * 1.35, -s * 0.65); g.lineTo(s * 1.35, s * 0.65); g.closePath();
          g.stroke();
          g.fill();
          g.restore();
        }
        const label = `${Math.max(0, Math.round(d / PX_PER_M))} m`;
        g.font = `700 ${Math.round(13 * ui)}px ${FONT_FAMILY}`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.lineWidth = 3 * ui;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        const ly = y + s + 3 * ui;
        g.strokeText(label, x, ly);
        g.fillStyle = '#f4f1e6';
        g.fillText(label, x, ly);
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  // ---- frame -------------------------------------------------------------------------------
  function update(view, frame) {
    const time = frame.now || 0;
    const st = view && view.story;
    const has = !!st || (view && view.interactables && view.interactables.length);
    if (!has && !items.size && !devs.size) {
      root.visible = false;
      return;
    }
    root.visible = true;
    updateItems((st && st.items) || [], time);
    updateDevices((view && view.interactables) || [], time);
    updateMarks((st && st.marks) || [], time);
    drawOverlay(view, frame, time);
  }

  return {
    update,
    dispose() {
      root.removeFromParent();
      for (const d of disposables) if (d.dispose) d.dispose();
    },
  };
}
