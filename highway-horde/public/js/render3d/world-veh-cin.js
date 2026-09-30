// Cinematic-tier detail for the road vehicles of world-veh.js (WORLD): real wheels (a tyre with
// sidewall lettering ring and a bead, ten-spoke alloys with lug nuts, a centre cap, a valve, a
// vented brake disc and a caliper behind the spokes), headlamps built like headlamps (chrome
// bezel, reflector bowl, lens, bulb, turn signal), three-section tail lamps, a slatted grille
// with a badge and fog lamps, windshield wipers, door handles and a fuel flap, an undercarriage
// (axles, differential, exhaust with a muffler and tips, fuel tank) and a full cabin visible
// through the now see-through glass: seats with headrests, a dashboard with a cluster, a
// steering wheel, a centre console, a rear shelf. Everything is merged into the same buckets as
// the rest of the vehicle, so a map's vehicles stay a handful of draw calls.

import * as THREE from 'three';
import { T, shadeHex, mixHex, hash01 } from './world-geo.js';
import { DET } from './world-surf.js';
import { atlasUV } from './world-tex.js';

const CHROME = '#c9ced3';
const TRIM = '#222324';
const AMBER = '#ff9a1a';
const HEAD = '#fff3d6';
const TAIL = '#d01418';
const STEEL = '#3a3d42';

// ---- templates ------------------------------------------------------------------------------------

/** A ten-spoke alloy face, unit radius, facing +y, y = 0 at the barrel's middle (rimTemplate's frame). */
function alloyFace() {
  return T.custom('alloy10', () => {
    const parts = [];
    const barrel = new THREE.CylinderGeometry(1, 1, 0.9, 40, 1, true);
    parts.push(barrel);
    const lip = new THREE.TorusGeometry(0.975, 0.055, 6, 40);
    lip.rotateX(Math.PI / 2);
    lip.translate(0, 0.44, 0);
    parts.push(lip);
    const lip2 = new THREE.TorusGeometry(0.975, 0.04, 5, 40);
    lip2.rotateX(Math.PI / 2);
    lip2.translate(0, -0.44, 0);
    parts.push(lip2);
    // the dish behind the spokes, a hub with a raised centre cap
    const dish = new THREE.CylinderGeometry(0.34, 0.5, 0.16, 20);
    dish.translate(0, 0.2, 0);
    parts.push(dish);
    const cap = new THREE.CylinderGeometry(0.15, 0.2, 0.09, 20);
    cap.translate(0, 0.32, 0);
    parts.push(cap);
    const capTop = new THREE.SphereGeometry(0.15, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    capTop.translate(0, 0.36, 0);
    parts.push(capTop);
    // ten spokes: tapered, bevelled prisms from the hub to the rim
    const shape = new THREE.Shape();
    shape.moveTo(0.19, -0.05); shape.lineTo(0.95, -0.105); shape.lineTo(0.95, 0.105); shape.lineTo(0.19, 0.05); shape.closePath();
    const spokeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, steps: 1 });
    spokeGeo.rotateX(-Math.PI / 2);
    spokeGeo.translate(0, 0.22, 0);
    for (let k = 0; k < 10; k++) {
      const sp = spokeGeo.clone();
      sp.rotateY((k / 10) * Math.PI * 2);
      parts.push(sp);
    }
    // five lug nuts on the hub and the valve stem
    for (let k = 0; k < 5; k++) {
      const nut = new THREE.CylinderGeometry(0.038, 0.038, 0.07, 6);
      const a = (k / 5) * Math.PI * 2 + 0.3;
      nut.translate(Math.cos(a) * 0.29, 0.29, Math.sin(a) * 0.29);
      parts.push(nut);
    }
    const valve = new THREE.CylinderGeometry(0.02, 0.025, 0.14, 5);
    valve.rotateZ(Math.PI / 2 * 0.3);
    valve.translate(0.86, 0.2, 0.3);
    parts.push(valve);
    return mergeParts(parts);
  });
}

/** A vented brake disc with its hat, unit radius, facing +y, sat inboard of the spokes. */
function brakeDisc() {
  return T.custom('brake-disc', () => {
    const parts = [];
    const disc = new THREE.CylinderGeometry(0.66, 0.66, 0.05, 32);
    disc.translate(0, 0.02, 0);
    parts.push(disc);
    const rim = new THREE.TorusGeometry(0.66, 0.025, 4, 32);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 0.02, 0);
    parts.push(rim);
    const hat = new THREE.CylinderGeometry(0.26, 0.3, 0.14, 20);
    hat.translate(0, 0.08, 0);
    parts.push(hat);
    for (let k = 0; k < 12; k++) {
      const slot = new THREE.BoxGeometry(0.02, 0.06, 0.2);
      slot.translate(0.5, 0.03, 0);
      slot.rotateY((k / 12) * Math.PI * 2);
      parts.push(slot);
    }
    return mergeParts(parts);
  });
}

/** A tyre with a bead, a sidewall band (the lettering ring) and shoulder ribs, unit radius, axis y. */
function tyreCin() {
  return T.custom('tyre-cin', () => {
    // [radius, y]: bead, lower sidewall, the raised letter band, shoulder, crown
    const half = [[0.6, -0.5], [0.66, -0.53], [0.73, -0.505], [0.79, -0.485], [0.82, -0.5], [0.86, -0.51], [0.9, -0.49], [0.945, -0.465], [0.98, -0.43], [0.995, -0.38], [1.0, -0.3]];
    const pts = [];
    for (const p of half) pts.push(new THREE.Vector2(p[0], p[1]));
    for (let i = half.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(half[i][0], -half[i][1]));
    return new THREE.LatheGeometry(pts, 48);
  });
}

function mergeParts(parts) {
  const pos = [], nor = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// ---- wheels ---------------------------------------------------------------------------------------

/**
 * A complete road wheel at (x, r, z), axle along local z; sd = +1 right side, -1 left.
 * @param {object} o { rim, flat, spokes } rim colour override, flat tyre
 */
export function cinWheel(B, x, r, z, width, sd, o = {}) {
  const rot = [sd > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0];
  const flat = !!o.flat;
  const cy = flat ? r * 0.7 : r;
  const sy = flat ? [r * 1.02, width * 1.08, r * 0.72] : [r, width, r];
  B.add('std', tyreCin(), [x, cy, z], sy, rot, '#1b1b1c', { surf: [DET.rubber, 0.8, 0], map: 'cyl' });
  // rim: spokes only on the passenger cars (spokes 0 = a dished steel wheel)
  const rf = r * (flat ? 0.56 : 0.6);
  const zc = z + sd * width * 0.02;
  if ((o.spokes ?? 5) > 0) {
    B.add('std', alloyFace(), [x, cy - (flat ? r * 0.04 : 0), zc], [rf, width * 0.9, rf], rot, o.rim || CHROME, { surf: [DET.panel, 0.3, 0.9], map: 'cyl' });
    // brake: a disc behind the spokes and a caliper on its upper rear
    B.add('std', brakeDisc(), [x, cy, z - sd * width * 0.12], [rf * 0.97, width * 0.6, rf * 0.97], rot, '#4a4d52', { surf: [DET.rust, 0.5, 0.85], map: 'cyl' });
    B.rbox('std', x - rf * 0.35, cy + rf * 0.42, z - sd * width * 0.12, rf * 0.34, rf * 0.28, width * 0.26, 0.3, '#8a2222', null, { surf: [DET.panel, 0.45, 0.4] });
  } else {
    // steel wheel of the trucks: a dished disc with ten hand holes, lug nuts and a hub
    B.add('std', alloyFace(), [x, cy, zc], [rf, width * 0.9, rf], rot, o.rim || '#8a8f94', { surf: [DET.panel, 0.4, 0.85], map: 'cyl' });
  }
}

// ---- lamps ------------------------------------------------------------------------------------------

/**
 * Head and tail lamps for a car-like front/rear: bezel, reflector bowl, lens, bulb, a turn-signal
 * strip, a three-section tail lamp with a ribbed lens.
 */
export function cinLamps(B, v, frontX, rearX, yF, yR, spread, sizeF, sizeR) {
  const lit = v.lightsOn;
  const [fd, fh, fw] = sizeF, [rd, rh, rw] = sizeR;
  for (const sd of [-1, 1]) {
    const z = sd * spread;
    // ---- head lamp: chrome bezel, reflector bowl, bulb, clear lens over it, amber signal below
    B.rbox('std', frontX - 0.35, yF, z, fd + 0.5, fh + 1.6, fw + 1.6, 0.6, CHROME, null, { surf: [0, 0.14, 1] });
    B.add('std', T.cyl(20, 0.35, false), [frontX - 0.5, yF, z], [Math.min(fh, fw) * 0.5 + 0.2, fd * 1.3, Math.min(fh, fw) * 0.5 + 0.2], [0, 0, -Math.PI / 2], '#b9bec4', { surf: [0, 0.18, 1], map: 'cyl' });
    B.add('glow', T.sphere(10, 8), [frontX - 0.05, yF, z], [0.7, 0.9, 0.9], null, HEAD, { emissive: lit ? 6 : 0.22, uv: atlasUV('white'), noAO: true });
    B.rbox('glow', frontX + 0.15, yF, z, fd * 0.3, fh * 0.9, fw * 0.92, 0.4, HEAD, null, { emissive: lit ? 2.2 : 0.16, uv: atlasUV('white') });
    B.rbox('vglass', frontX + 0.3, yF, z, fd * 0.45, fh + 0.4, fw + 0.4, 0.45, '#cfd8de', null, { uv: atlasUV('white') });
    B.rbox('glow', frontX + 0.05, yF - fh * 0.5 - 1.5, z * 1.02, fd * 0.5, 1.6, fw * 0.8, 0.3, AMBER, null, { emissive: v.hazards ? 0.3 : 0.4, uv: atlasUV('white') });
    // fog lamp low in the bumper
    B.add('std', T.cyl(16, 1, false), [frontX - 0.2, yF - fh * 0.5 - 6.4, z * 0.82], [1.5, 0.8, 1.5], [0, 0, -Math.PI / 2], CHROME, { surf: [0, 0.15, 1], map: 'cyl' });
    B.add('glow', T.cyl(14, 1, false), [frontX + 0.25, yF - fh * 0.5 - 6.4, z * 0.82], [1.15, 0.2, 1.15], [0, 0, -Math.PI / 2], HEAD, { emissive: lit ? 1.2 : 0.14, uv: atlasUV('white'), noAO: true });
    // ---- tail lamp: brake (red), turn (amber), reverse (white) sections behind a ribbed lens
    B.rbox('std', rearX + 0.2, yR, z, rd + 0.6, rh + 1, rw + 1, 0.4, '#141416', null, { surf: [DET.plastic, 0.5, 0.1] });
    const wsec = rw / 3;
    const cols = [[TAIL, lit ? 3 : 0.7], [AMBER, 0.35], ['#ffffff', 0.2]];
    for (let s = 0; s < 3; s++) {
      const zz = z + sd * (s - 1) * wsec * (s === 0 ? 1.25 : 1) * -1;
      B.box('glow', rearX - 0.2, yR, zz, rd * 0.5, rh * 0.95, wsec * 0.92, cols[s][0], null, { emissive: cols[s][1], uv: atlasUV('white') });
    }
    B.rbox('vglass', rearX - 0.5, yR, z, rd * 0.5, rh + 0.2, rw + 0.3, 0.4, '#d6a0a0', null, { uv: atlasUV('white') });
    for (let k = 0; k < 4; k++) B.box('std', rearX - 0.8, yR, z + sd * (k - 1.5) * (rw / 4.2), 0.25, rh + 0.1, 0.22, '#3a1416', null, { surf: [0, 0.4, 0.1], noAO: true });
    if (v.hazards) {
      B.box('blink', frontX + 0.2, yF - fh * 0.5 - 1.5, z * 1.02, 0.6, 1.4, 3.2, AMBER, null, { emissive: 3.2 });
      B.box('blink', rearX - 0.3, yR + rh * 0.5 + 1.1, z, 0.6, 1.4, 3.2, AMBER, null, { emissive: 3.2 });
    }
  }
}

/** Radiator grille (slats, badge, lower intake with mesh), plus a rear reflector strip. */
export function cinGrille(B, L, W, frontY, hw) {
  const gz = W * 0.36;
  B.rbox('std', L / 2 - 0.1, frontY - 1, 0, 1.2, 6.4, gz + 1.6, 0.5, CHROME, null, { surf: [0, 0.16, 1] });
  B.box('std', L / 2 + 0.05, frontY - 1, 0, 1, 5.2, gz, '#0b0c0d', null, { surf: [DET.corrugated, 0.5, 0.6] });
  for (let k = 0; k < 5; k++) B.box('std', L / 2 + 0.45, frontY - 3 + k * 1.1, 0, 0.5, 0.42, gz - 0.4, k % 2 ? '#2a2c2e' : CHROME, null, { surf: [0, 0.22, 1], noAO: true });
  B.add('std', T.sphere(12, 6), [L / 2 + 0.7, frontY - 1, 0], [0.5, 1.5, 2.2], null, CHROME, { surf: [0, 0.12, 1], noAO: true });
  // lower intake
  B.box('std', L / 2 + 0.2, frontY - 8.4, 0, 1, 2.6, gz * 1.45, '#0a0a0b', null, { surf: [DET.corrugated, 0.5, 0.5] });
  void hw;
}

/** Two wipers resting along the base of the windshield. */
export function cinWipers(B, spec, W) {
  if (!spec.wind || !spec.wind[0]) return;
  const [xa, xb] = spec.wind[0];
  const pw = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
    return pts[pts.length - 1][1];
  };
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  const y0 = pw(spec.belt, hi), y1 = pw(spec.top, lo);
  // bars across the car lying on the glass: the box's thin axis is the glass's outward normal
  const dx = hi - lo, dy = y1 - y0, len = Math.hypot(dx, dy);
  const nx = dy / len, ny = dx / len;
  const phi = Math.atan2(ny, nx);
  const t = 0.09;
  const px = hi - dx * t + nx * 0.4, py = y0 + dy * t + ny * 0.4;
  for (const [z0, z1] of [[-0.36, -0.03], [-0.01, 0.31]]) {
    B.box('std', px, py, W * (z0 + z1) / 2, 0.3, 0.55, W * (z1 - z0), '#0e0f10', [0, 0, phi], { surf: [DET.rubber, 0.6, 0], noAO: true, noJitter: true });
  }
}

/** Door handles, a fuel flap and an antenna base (chrome, proud of the body). */
export function cinDoorFurniture(B, body, xs, y, color) {
  for (const x of xs) {
    const h = body.halfW(x);
    for (const sd of [-1, 1]) {
      B.rbox('std', x, y, sd * (h + 0.35), 3.8, 0.9, 0.55, 0.25, CHROME, null, { surf: [0, 0.16, 1], noAO: true });
      B.rbox('std', x - 2.3, y, sd * (h + 0.22), 0.7, 1.3, 0.5, 0.2, CHROME, null, { surf: [0, 0.16, 1], noAO: true });
      B.rbox('std', x + 1.0, y + 1.7, sd * (h + 0.18), 2.4, 0.5, 0.3, 0.1, shadeHex(color, -0.35), null, { surf: [0, 0.4, 0.5], noAO: true });   // the lock plate
    }
  }
}

// ---- undercarriage ------------------------------------------------------------------------------------

/** What you see under a car: axles, differential, exhaust with muffler and tips, tank, control arms. */
export function cinUnder(B, L, W, R, xs, rocker = 10) {
  const dark = '#141415', rust = { surf: [DET.rust, 0.7, 0.5], noAO: true };
  const hw = W / 2 - 4;
  for (const x of xs) {
    B.cylZ('std', x, R, 0, 1.3, hw * 2, dark, 10, rust);
    B.add('std', T.sphere(12, 8), [x, R - 0.4, 0], [3.6, 2.8, 3.6], null, '#26272a', { surf: [DET.rust, 0.6, 0.6], noAO: true });
    for (const sd of [-1, 1]) {
      B.box('std', x + 1.2, R + 1.4, sd * (hw * 0.5), 1, 0.9, hw * 0.9, dark, [0, sd * 0.14, 0], rust);
      B.cyl('std', x - 2.0, R - 2.2, sd * (hw - 3), 0.7, 5.2, '#cfd3d6', 8, 1, null, { surf: [0, 0.2, 1], noAO: true });   // shock absorber
    }
  }
  // exhaust: pipe along the right, muffler, a chrome tip at the rear
  const ez = W * 0.2;
  B.cylX('std', -L * 0.06, rocker - 3.4, ez, 0.75, L * 0.52, '#3c3a37', 8, rust);
  B.add('std', T.cyl(14), [-L * 0.36, rocker - 3, ez], [2.6, 15, 2.6], [0, 0, Math.PI / 2], '#4a4744', { surf: [DET.rust, 0.7, 0.7], map: 'cyl', noAO: true });
  B.cylX('std', -L / 2 + 0.6, rocker - 2.6, ez, 1.05, 3.4, CHROME, 12, { surf: [0, 0.15, 1], noAO: true });
  // fuel tank and driveshaft
  B.rbox('std', -L * 0.2, rocker - 1, -W * 0.16, 17, 4, 15, 1.2, '#1c1d20', null, { surf: [DET.rust, 0.7, 0.4], noAO: true });
  B.cylX('std', L * 0.05, rocker - 2.4, 0, 0.9, L * 0.36, '#202124', 8, rust);
}

// ---- interiors --------------------------------------------------------------------------------------------

/** A closed room seen from inside: the outward faces are the walls' visible sides. */
function roomGeo() {
  // the greenhouse narrows toward the roof (the side glass leans in): the top of the room is 76 % as wide
  return T.custom('room-in', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setZ(i, p.getZ(i) * (y > 0 ? 0.76 : 1));
      const nx = -n.getX(i), ny = -n.getY(i), nz = -n.getZ(i);
      n.setXYZ(i, nx, ny, nz);
    }
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.computeVertexNormals();       // (with the winding reversed the normals now point into the room)
    return g;
  });
}

const SEAT_COLS = ['#3a2f26', '#26282c', '#5a4a38', '#3a3e46', '#6a5a46', '#2c2a28', '#4a2f2a'];
const DASH_COLS = ['#1c1c1e', '#2a2622', '#26282c', '#302c28'];

/**
 * The cabin of a road vehicle.
 * @param {object} c { x0, x1 (cabin rear/front), floor, roof, hw (half width), rows: [x...] seat rows (front first),
 *   bench: rear seat is a bench, dashX (front of the cabin) }
 */
export function cinInterior(B, id, c, lit = false) {
  const seat = SEAT_COLS[Math.floor(hash01(id * 5 + 2) * SEAT_COLS.length)];
  const dash = DASH_COLS[Math.floor(hash01(id * 7 + 3) * DASH_COLS.length)];
  const cw = c.hw * 2;
  const S = { surf: [DET.fabric, 0.9, 0], noAO: true };
  const P = { surf: [DET.plastic, 0.55, 0], noAO: true };
  // the room: floor, ceiling and the far walls seen through the glass
  const cx = (c.x0 + c.x1) / 2, cl = c.x1 - c.x0, ch = c.roof - c.floor;
  B.add('std', roomGeo(), [cx, c.floor + ch / 2, 0], [cl, ch, cw], null, shadeHex(dash, 0.08), { surf: [DET.fabric, 0.92, 0], noAO: true, noJitter: true });
  // floor carpet and headliner tones
  B.box('std', cx, c.floor + 0.25, 0, cl * 0.98, 0.5, cw * 0.98, shadeHex(seat, -0.35), null, { surf: [DET.fabric, 0.95, 0], noAO: true });
  B.box('std', cx, c.roof - 0.3, 0, cl * 0.98, 0.5, cw * 0.72, '#8a8478', null, { surf: [DET.fabric, 0.95, 0], noAO: true });
  // dashboard: a wedge under the windshield with a binnacle over the driver's side
  const dx = c.x1 - 1;
  B.rbox('std', dx - 4, c.floor + 9, 0, 9, 7, cw * 0.98, 1.2, dash, null, P);
  B.rbox('std', dx - 3, c.floor + 12.6, -c.hw * 0.42, 6, 3.4, c.hw * 0.62, 1.1, shadeHex(dash, 0.05), null, P);
  B.box('glow', dx - 6.2, c.floor + 13, -c.hw * 0.42, 0.25, 2.2, c.hw * 0.42, lit ? '#9cff9c' : '#1c3a2a', null, { emissive: lit ? 1.4 : 0.12, uv: atlasUV('white'), noAO: true });
  B.rbox('std', dx - 5.2, c.floor + 9.5, c.hw * 0.05, 3, 5, c.hw * 0.3, 0.5, shadeHex(dash, 0.1), null, P);
  // steering wheel on the driver's (left, -z) side and its column
  const wz = -c.hw * 0.42;
  B.add('std', T.torus(20, 0.16, 6), [dx - 9.6, c.floor + 13.6, wz], [2.2, 2.2, 2.2], [0, Math.PI / 2 + 0.25, 0.9], '#141416', { surf: [DET.rubber, 0.6, 0], noAO: true });
  B.cyl('std', dx - 8.4, c.floor + 11.2, wz, 0.55, 5.4, '#18181a', 8, 1, [0, 0, -0.9], P);
  B.add('std', T.cyl(12), [dx - 9.5, c.floor + 13.5, wz], [0.9, 0.6, 0.9], [0, 0, Math.PI / 2 - 0.9], '#2a2b2e', P);
  // centre console with a shifter
  B.rbox('std', dx - 11, c.floor + 4.2, 0, 14, 4.4, 4.4, 1, shadeHex(dash, 0.06), null, P);
  B.cyl('std', dx - 12, c.floor + 6.2, 0, 0.5, 3, '#0e0e10', 6, 0.8, null, P);
  // seats
  const rows = c.rows || [];
  rows.forEach((x, ri) => {
    const bench = ri > 0 && c.bench !== false;
    const zs = bench ? [-c.hw * 0.5, c.hw * 0.5] : [-c.hw * 0.44, c.hw * 0.44];
    for (const z of zs) {
      B.rbox('std', x, c.floor + 4.4, z, 9, 3.6, c.hw * 0.62, 1.2, seat, null, S);
      B.rbox('std', x - 3.6, c.floor + 12.2, z, 2.6, 11.4, c.hw * 0.58, 1.1, seat, [0, 0, 0.14], S);
      B.rbox('std', x - 4.4, c.floor + 20.2, z, 2, 4.6, c.hw * 0.28, 0.8, shadeHex(seat, 0.06), [0, 0, 0.1], S);
    }
  });
  // rear shelf
  B.box('std', c.x0 + 3, c.floor + 17, 0, 6, 0.9, cw * 0.96, shadeHex(dash, -0.1), null, P);
}

// ---- a bus interior --------------------------------------------------------------------------------------

/** Rows of bench seats down both sides of a bus, a driver's seat, a centre aisle. */
export function cinBusInterior(B, id, L, W, sag, x0, x1, hood) {
  const seat = mixHex('#3a3428', '#5a2f26', hash01(id * 3 + 1) * 0.5);
  const S = { surf: [DET.fabric, 0.9, 0], noAO: true };
  const floor = 18 + sag, roof = 86 + sag, hw = W / 2 - 2.5;
  B.add('std', roomGeo(), [(x0 + x1) / 2, (floor + roof) / 2, 0], [x1 - x0, roof - floor, hw * 2], null, '#2a2724', { surf: [DET.fabric, 0.92, 0], noAO: true, noJitter: true });
  B.box('std', (x0 + x1) / 2, floor + 0.3, 0, (x1 - x0) * 0.98, 0.6, hw * 2 * 0.98, '#1c1b19', null, { surf: [DET.rubber, 0.9, 0], noAO: true });
  for (let x = x0 + 8; x < x1 - 12; x += 13.5) {
    for (const sd of [-1, 1]) {
      B.rbox('std', x, floor + 7, sd * hw * 0.62, 3, 9, hw * 0.72, 0.8, seat, [0, 0, -0.06], S);
      B.rbox('std', x + 2.2, floor + 3.6, sd * hw * 0.62, 6.6, 3.2, hw * 0.72, 0.9, seat, null, S);
      B.box('std', x - 0.4, floor + 6, sd * hw * 0.98, 0.8, 5, 0.9, '#8a8a88', null, { surf: [0, 0.5, 0.8], noAO: true });
    }
  }
  // the driver's seat and wheel at the front
  const fx = x1 - 12 - hood * 0.0;
  B.rbox('std', fx, floor + 4.5, -hw * 0.5, 8, 4.4, 9, 1, '#26262a', null, S);
  B.rbox('std', fx - 3.6, floor + 12.5, -hw * 0.5, 2.6, 12, 9, 1, '#26262a', [0, 0, 0.1], S);
  B.add('std', T.torus(22, 0.2, 6), [fx + 9.5, floor + 15, -hw * 0.5], [4.6, 4.6, 4.6], [0, Math.PI / 2, 0.55], '#141416', { surf: [DET.rubber, 0.6, 0], noAO: true });
  B.rbox('std', x1 - 2, floor + 8, 0, 4, 12, hw * 2 * 0.96, 1, '#1f1e1c', null, { surf: [DET.plastic, 0.55, 0], noAO: true });
}
