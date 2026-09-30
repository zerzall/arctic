// Saint Mercy's picture atlas (render3d/levels/hospital.js): the wayfinding signs, the lit EMERGENCY
// letters, door plates, posters and notices, screens, labels of the shelves, the ambulance livery, the
// helipad markings, the army's stencils, and the blood, grime and graffiti the outbreak left. Painted once
// per page on a canvas (hospital-kit.js createAtlas).

import {
  createAtlas, text, rrect, weather, panelSign, arrow, blood, graffiti, grime, FONT, SANS, HAND, SERIF,
} from './hospital-kit.js';

const CELLS = {
  white: [16, 16],
  // signs and plates
  hs_emergency: [512, 96], hs_emergency_in: [320, 64], hs_treatment: [256, 64], hs_bay1: [128, 48], hs_bay2: [128, 48], hs_bay3: [128, 48], hs_bay4: [128, 48],
  hs_wardc: [320, 72], hs_or1: [192, 56], hs_or2: [192, 56], hs_inuse: [128, 40], hs_stairb: [192, 64], hs_exit: [128, 48], hs_sign: [512, 176],
  hs_quarantine: [256, 176], hs_bigsign: [1024, 128], hs_redcross: [128, 128], hs_biohazard: [96, 96], hs_star: [96, 96],
  hs_amb_side: [512, 96], hs_amb_front: [256, 64], hs_pharmacy: [256, 56], hs_xray: [256, 56], hs_staff: [192, 48], hs_records: [256, 48],
  hs_meds: [192, 48], hs_generator: [256, 112], hs_lift: [256, 64], hs_floor2: [128, 176], hs_floor3: [128, 176], hs_floorR: [128, 176],
  hs_helipad: [512, 512], hs_ambonly: [512, 96], hs_mainent: [256, 64], hs_nostop: [128, 128],
  // things on the walls
  hs_whiteboard: [256, 128], hs_notice: [192, 144], hs_poster1: [96, 136], hs_poster2: [96, 136], hs_poster3: [96, 136], hs_evac: [128, 96],
  hs_monitor: [96, 64], hs_monitor_off: [96, 64], hs_tv: [160, 96], hs_kids: [256, 128], hs_xrayfilm: [128, 96], hs_chart: [64, 96], hs_note: [192, 128],
  hs_clock: [64, 64], hs_handgel: [48, 64], hs_fireplan: [96, 128],
  // shelves and machine fronts
  hs_files: [256, 128], hs_medboxes: [256, 128], hs_supplies: [256, 128], hs_vend: [128, 256], hs_vend2: [128, 256], hs_gauges: [128, 64], hs_panel: [128, 128],
  hs_caution: [256, 32], hs_mesh: [128, 128], hs_plastic: [256, 256], hs_curtain: [128, 128], hs_vent: [64, 64],
  // blood, grime, graffiti
  blood_trail: [512, 128], blood_hand: [256, 256], blood_splat: [256, 256], blood_drip: [128, 256], blood_pool: [256, 256],
  grime: [256, 256], grime2: [256, 256], mold: [256, 256],
  g_roof: [256, 96], g_dead: [256, 96], g_help: [256, 96], g_tally: [128, 96], g_evac: [256, 96], g_notsafe: [256, 96],
};

function star(g, cx, cy, s, color) {
  g.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    g.save();
    g.translate(cx, cy);
    g.rotate((k * Math.PI) / 3);
    g.fillRect(-s * 0.16, -s * 0.5, s * 0.32, s);
    g.restore();
  }
  g.fillStyle = '#fff';
  g.fillRect(cx - s * 0.03, cy - s * 0.34, s * 0.06, s * 0.6);
  g.beginPath(); g.arc(cx, cy - s * 0.3, s * 0.05, 0, 6.3); g.fill();
}

function cross(g, cx, cy, s, color) {
  g.fillStyle = color;
  g.fillRect(cx - s * 0.16, cy - s * 0.5, s * 0.32, s);
  g.fillRect(cx - s * 0.5, cy - s * 0.16, s, s * 0.32);
}

function trefoil(g, cx, cy, s, fg, bg) {
  g.fillStyle = bg;
  g.beginPath(); g.arc(cx, cy, s, 0, 6.3); g.fill();
  g.fillStyle = fg;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, s * 0.85, a - 0.5, a + 0.5); g.closePath(); g.fill();
  }
  g.fillStyle = bg;
  g.beginPath(); g.arc(cx, cy, s * 0.26, 0, 6.3); g.fill();
  g.fillStyle = fg;
  g.beginPath(); g.arc(cx, cy, s * 0.14, 0, 6.3); g.fill();
}

function biohazard(g, cx, cy, s) {
  g.fillStyle = '#f2a51a';
  g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s * 0.95, cy + s * 0.72); g.lineTo(cx - s * 0.95, cy + s * 0.72); g.closePath(); g.fill();
  g.strokeStyle = '#111';
  g.lineWidth = s * 0.08;
  g.stroke();
  g.lineWidth = s * 0.07;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
    g.beginPath(); g.arc(cx + Math.cos(a) * s * 0.2, cy + 0.1 * s + Math.sin(a) * s * 0.2, s * 0.24, 0, 6.3); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy + 0.1 * s, s * 0.08, 0, 6.3); g.fillStyle = '#111'; g.fill();
}

function paperLines(g, x, y, w, h, r, n = 8) {
  g.fillStyle = '#f0ece0';
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(40,40,60,0.55)';
  for (let i = 0; i < n; i++) g.fillRect(x + w * 0.1, y + h * (0.16 + i * (0.7 / n)), w * (0.5 + r() * 0.35), Math.max(1, h * 0.025));
}

function paint(g, name, w, h, r) {
  switch (name) {
    case 'white': g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); return;
    case 'hs_emergency': {
      // lit box letters: white acrylic on a red face (unlit bucket)
      g.fillStyle = '#b3120e';
      g.fillRect(0, 0, w, h);
      text(g, 'EMERGENCY', w / 2, h / 2 + 2, w * 0.92, h * 0.78, { color: '#fff7f2', font: FONT });
      return;
    }
    case 'hs_emergency_in': return panelSign(g, w, h, r, { bg: '#b31d19', text: 'EMERGENCY', sub: 'ENTRANCE · AMBULANCES', arrow: 'd' });
    case 'hs_treatment': return panelSign(g, w, h, r, { bg: '#20507f', text: 'TREATMENT AREA', sub: 'STAFF ONLY BEYOND THIS POINT' });
    case 'hs_bay1': case 'hs_bay2': case 'hs_bay3': case 'hs_bay4':
      return panelSign(g, w, h, r, { bg: '#e8e6de', fg: '#1d3f66', text: 'BAY ' + name.slice(-1), dirt: 0.5 });
    case 'hs_wardc': return panelSign(g, w, h, r, { bg: '#2a6a5a', text: 'WARD C', sub: 'MEDICAL · 24 BEDS', arrow: 'r' });
    case 'hs_or1': return panelSign(g, w, h, r, { bg: '#1f5e56', text: 'THEATRE 1', sub: 'STERILE AREA' });
    case 'hs_or2': return panelSign(g, w, h, r, { bg: '#1f5e56', text: 'THEATRE 2', sub: 'STERILE AREA' });
    case 'hs_inuse': {
      g.fillStyle = '#220606';
      rrect(g, 0, 0, w, h, 6); g.fill();
      text(g, 'IN USE', w / 2, h / 2 + 1, w * 0.8, h * 0.62, { color: '#ff3a2a', font: FONT, glow: '#ff2a1a' });
      return;
    }
    case 'hs_stairb': return panelSign(g, w, h, r, { bg: '#1c7a3c', text: 'STAIR B', sub: 'FIRE EXIT · ROOF ACCESS' });
    case 'hs_exit': {
      g.fillStyle = '#0f7a34';
      rrect(g, 1, 1, w - 2, h - 2, 5); g.fill();
      // the running man
      g.fillStyle = '#e8fff0';
      const s = h * 0.7, x = h * 0.2, y = h * 0.15;
      g.beginPath(); g.arc(x + s * 0.55, y + s * 0.12, s * 0.1, 0, 6.3); g.fill();
      g.lineWidth = s * 0.12; g.strokeStyle = '#e8fff0'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + s * 0.5, y + s * 0.28); g.lineTo(x + s * 0.38, y + s * 0.6); g.lineTo(x + s * 0.12, y + s * 0.92); g.moveTo(x + s * 0.38, y + s * 0.6); g.lineTo(x + s * 0.62, y + s * 0.78); g.lineTo(x + s * 0.55, y + s * 1.0); g.moveTo(x + s * 0.48, y + s * 0.35); g.lineTo(x + s * 0.2, y + s * 0.45); g.moveTo(x + s * 0.48, y + s * 0.35); g.lineTo(x + s * 0.75, y + s * 0.5); g.stroke();
      text(g, 'EXIT', w * 0.66, h / 2 + 1, w * 0.5, h * 0.62, { color: '#e8fff0', font: FONT });
      return;
    }
    case 'hs_sign': {
      g.fillStyle = '#e9e5da';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#123e6b';
      g.fillRect(0, 0, w, h * 0.12);
      g.fillRect(0, h * 0.88, w, h * 0.12);
      cross(g, h * 0.42, h * 0.46, h * 0.46, '#c01c18');
      text(g, 'SAINT MERCY', h * 0.8 + (w - h * 0.9) / 2, h * 0.36, w - h * 0.95, h * 0.3, { color: '#123e6b', font: SERIF });
      text(g, 'HOSPITAL & MEDICAL CENTER', h * 0.8 + (w - h * 0.9) / 2, h * 0.6, w - h * 0.95, h * 0.13, { color: '#123e6b', font: SANS });
      text(g, 'EMERGENCY  →', h * 0.8 + (w - h * 0.9) / 2, h * 0.77, w - h * 0.95, h * 0.1, { color: '#c01c18', font: SANS });
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'hs_quarantine': {
      g.fillStyle = '#e8e2cf';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b01212';
      g.fillRect(0, 0, w, h * 0.26);
      text(g, 'WARNING', w / 2, h * 0.13, w * 0.8, h * 0.2, { color: '#fff', font: FONT });
      text(g, 'QUARANTINE ZONE', w / 2, h * 0.42, w * 0.92, h * 0.16, { color: '#1a1a1a', font: FONT });
      text(g, 'NO ENTRY', w / 2, h * 0.6, w * 0.6, h * 0.16, { color: '#b01212', font: FONT });
      text(g, 'BY ORDER OF THE U.S. ARMY · USE OF FORCE AUTHORIZED', w / 2, h * 0.8, w * 0.92, h * 0.07, { color: '#1a1a1a', font: SANS });
      biohazard(g, w * 0.88, h * 0.62, h * 0.1);
      weather(g, w, h, r, 1.2);
      return;
    }
    case 'hs_bigsign': {
      g.clearRect(0, 0, w, h);
      text(g, 'SAINT  MERCY', w / 2, h / 2 + 4, w * 0.96, h * 0.86, { color: '#f4f6ff', font: SERIF, glow: '#b8d4ff' });
      return;
    }
    case 'hs_redcross': {
      g.clearRect(0, 0, w, h);
      g.save(); g.shadowColor = '#ff2a1a'; g.shadowBlur = 14; cross(g, w / 2, h / 2, w * 0.8, '#ff3326'); g.restore();
      cross(g, w / 2, h / 2, w * 0.66, '#ffd6d0');
      return;
    }
    case 'hs_biohazard': g.clearRect(0, 0, w, h); biohazard(g, w / 2, h * 0.55, w * 0.44); return;
    case 'hs_star': g.clearRect(0, 0, w, h); star(g, w / 2, h / 2, w * 0.9, '#1d5ec8'); return;
    case 'hs_amb_side': {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#d8231b';
      g.fillRect(0, h * 0.55, w, h * 0.16);
      g.fillStyle = '#f08a1a';
      g.fillRect(0, h * 0.73, w, h * 0.07);
      text(g, 'AMBULANCE', w * 0.44, h * 0.3, w * 0.62, h * 0.36, { color: '#c01c18', font: FONT });
      star(g, w * 0.88, h * 0.3, h * 0.5, '#1d5ec8');
      text(g, 'SAINT MERCY EMS  ·  UNIT 14', w * 0.4, h * 0.63, w * 0.5, h * 0.1, { color: '#fff', font: SANS });
      return;
    }
    case 'hs_amb_front': {
      g.clearRect(0, 0, w, h);
      g.save(); g.translate(w, 0); g.scale(-1, 1);
      text(g, 'AMBULANCE', w / 2, h / 2, w * 0.92, h * 0.7, { color: '#c01c18', font: FONT });
      g.restore();
      return;
    }
    case 'hs_pharmacy': return panelSign(g, w, h, r, { bg: '#1d6b3a', text: 'PHARMACY', sub: 'CONTROLLED DRUGS · KEYCARD', icon: (gg, x, y, s) => cross(gg, x + s / 2, y + s / 2, s * 0.8, '#bfffc8') });
    case 'hs_xray': return panelSign(g, w, h, r, { bg: '#2a2a2a', text: 'X-RAY', sub: 'RADIATION · DO NOT ENTER', icon: (gg, x, y, s) => trefoil(gg, x + s / 2, y + s / 2, s * 0.45, '#111', '#f2c21a') });
    case 'hs_staff': return panelSign(g, w, h, r, { bg: '#555c63', text: 'STAFF ROOM' });
    case 'hs_records': return panelSign(g, w, h, r, { bg: '#555c63', text: 'MEDICAL RECORDS', sub: 'AUTHORISED STAFF' });
    case 'hs_meds': return panelSign(g, w, h, r, { bg: '#1d6b3a', text: 'MEDICATION' });
    case 'hs_generator': {
      g.fillStyle = '#f2c21a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111';
      g.fillRect(0, 0, w, h * 0.34);
      text(g, 'DANGER', w / 2, h * 0.17, w * 0.6, h * 0.26, { color: '#f2c21a', font: FONT });
      text(g, 'GENERATOR ROOM', w / 2, h * 0.54, w * 0.9, h * 0.2, { color: '#111', font: FONT });
      text(g, 'HIGH VOLTAGE · AUTHORISED PERSONS ONLY', w / 2, h * 0.8, w * 0.9, h * 0.1, { color: '#111', font: SANS });
      weather(g, w, h, r, 0.9);
      return;
    }
    case 'hs_lift': return panelSign(g, w, h, r, { bg: '#4a4f55', text: 'FREIGHT LIFT', sub: 'BEDS & EQUIPMENT · 2500 KG' });
    case 'hs_floor2': case 'hs_floor3': case 'hs_floorR': {
      // stencilled on the block wall: a big number and a band
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(28,110,60,0.92)';
      g.fillRect(0, h * 0.78, w, h * 0.08);
      const n = name.slice(-1);
      text(g, n, w / 2, h * 0.4, w * 0.9, h * 0.62, { color: 'rgba(28,110,60,0.95)', font: FONT });
      text(g, n === 'R' ? 'ROOF' : 'FLOOR', w / 2, h * 0.92, w * 0.8, h * 0.1, { color: 'rgba(28,110,60,0.95)', font: FONT });
      return;
    }
    case 'hs_helipad': {
      g.clearRect(0, 0, w, h);
      g.translate(w / 2, h / 2);
      g.fillStyle = 'rgba(46,52,58,0.96)';
      g.beginPath(); g.arc(0, 0, w * 0.49, 0, 6.3); g.fill();
      g.strokeStyle = '#f2c230';
      g.lineWidth = w * 0.035;
      g.beginPath(); g.arc(0, 0, w * 0.44, 0, 6.3); g.stroke();
      g.strokeStyle = 'rgba(238,240,242,0.8)';
      g.lineWidth = w * 0.012;
      g.beginPath(); g.arc(0, 0, w * 0.38, 0, 6.3); g.stroke();
      g.fillStyle = '#eef0f2';
      g.fillRect(-w * 0.16, -w * 0.2, w * 0.065, w * 0.4);
      g.fillRect(w * 0.095, -w * 0.2, w * 0.065, w * 0.4);
      g.fillRect(-w * 0.16, -w * 0.033, w * 0.32, w * 0.066);
      // the hospital's red cross in the ring and a weight limit
      cross(g, 0, w * 0.3, w * 0.07, '#d8231b');
      g.font = `bold ${w * 0.045}px ${FONT}`;
      g.fillStyle = '#eef0f2';
      g.textAlign = 'center';
      g.fillText('6.5', 0, -w * 0.27);
      g.translate(-w / 2, -h / 2);
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'hs_ambonly': {
      g.clearRect(0, 0, w, h);
      text(g, 'AMBULANCE ONLY', w / 2, h / 2, w * 0.96, h * 0.7, { color: 'rgba(240,200,40,0.85)', font: FONT });
      return;
    }
    case 'hs_mainent': return panelSign(g, w, h, r, { bg: '#123e6b', text: 'MAIN ENTRANCE', sub: 'CLOSED · USE EMERGENCY', arrow: 'l' });
    case 'hs_nostop': {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#1d4f9a'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 6.3); g.fill();
      g.strokeStyle = '#c62828'; g.lineWidth = w * 0.09; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, 6.3); g.stroke();
      g.beginPath(); g.moveTo(w * 0.22, h * 0.22); g.lineTo(w * 0.78, h * 0.78); g.moveTo(w * 0.78, h * 0.22); g.lineTo(w * 0.22, h * 0.78); g.stroke();
      return;
    }
    case 'hs_whiteboard': {
      g.fillStyle = '#f2f3ef'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8a8f94'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(40,60,120,0.4)'; g.lineWidth = 1;
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(6, i * h / 6); g.lineTo(w - 6, i * h / 6); g.stroke(); }
      g.beginPath(); g.moveTo(w * 0.18, 4); g.lineTo(w * 0.18, h - 4); g.stroke();
      const rows = ['C1  HARRIS   obs 4h', 'C2  --', 'C3  NOVAK   ISOLATE', 'C4  REYES   ISOLATE', 'C5  ?????'];
      g.font = `15px ${HAND}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      rows.forEach((t, i) => { g.fillStyle = i > 1 ? '#b3261e' : '#1d2f6a'; g.fillText(t, 8, (i + 0.5) * h / 6 + 2); });
      g.fillStyle = '#b3261e'; g.font = `bold 17px ${HAND}`;
      g.fillText('ALL STAFF TO WARD C', w * 0.08, h * 0.92);
      g.strokeStyle = 'rgba(179,38,30,0.7)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w * 0.2, h * 0.3); g.lineTo(w * 0.95, h * 0.62); g.stroke();
      return;
    }
    case 'hs_notice': {
      g.fillStyle = '#9c7a4a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '70,48,24' : '200,170,120'},0.3)`; g.fillRect(r() * w, r() * h, 2, 2); }
      const cols = ['#f0ece0', '#fff59d', '#f8d0d0', '#d0e4f8'];
      for (let i = 0; i < 7; i++) {
        const x = 8 + (i % 4) * 46, y = 8 + Math.floor(i / 4) * 68;
        g.save(); g.translate(x + 20, y + 30); g.rotate((r() - 0.5) * 0.2);
        g.fillStyle = cols[i % 4]; g.fillRect(-20, -28, 40, 56);
        g.fillStyle = 'rgba(40,40,60,0.5)'; for (let k = 0; k < 6; k++) g.fillRect(-15, -20 + k * 8, 20 + r() * 10, 2);
        g.fillStyle = '#c62828'; g.beginPath(); g.arc(0, -25, 2.5, 0, 6.3); g.fill();
        g.restore();
      }
      return;
    }
    case 'hs_poster1': case 'hs_poster2': case 'hs_poster3': {
      const spec = {
        hs_poster1: ['#ffffff', '#1d5ec8', 'WASH', 'YOUR HANDS', 'Stop the spread'],
        hs_poster2: ['#fff3d0', '#b3261e', 'OUTBREAK', 'PROTOCOL', 'Isolate · Report · Wait'],
        hs_poster3: ['#e4f4ea', '#1d6b3a', 'FLU SHOTS', 'AVAILABLE', 'Ask at the desk'],
      }[name];
      g.fillStyle = spec[0]; g.fillRect(0, 0, w, h);
      g.fillStyle = spec[1]; g.fillRect(0, 0, w, h * 0.3);
      text(g, spec[2], w / 2, h * 0.12, w * 0.88, h * 0.14, { color: '#fff', font: FONT });
      text(g, spec[3], w / 2, h * 0.23, w * 0.88, h * 0.08, { color: '#fff', font: FONT });
      g.fillStyle = spec[1];
      if (name === 'hs_poster1') { for (let k = 0; k < 4; k++) g.fillRect(w * 0.3 + k * w * 0.1, h * 0.4, w * 0.07, h * 0.28); g.fillRect(w * 0.25, h * 0.6, w * 0.5, h * 0.14); }
      else if (name === 'hs_poster2') { biohazard(g, w / 2, h * 0.55, w * 0.28); }
      else { g.fillRect(w * 0.45, h * 0.38, w * 0.1, h * 0.32); g.fillRect(w * 0.3, h * 0.5, w * 0.4, h * 0.06); }
      text(g, spec[4], w / 2, h * 0.84, w * 0.86, h * 0.07, { color: '#222', font: SANS, weight: 'normal' });
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'hs_evac': case 'hs_fireplan': {
      g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h * 0.16);
      text(g, name === 'hs_evac' ? 'EVACUATION PLAN' : 'FIRE ACTION', w / 2, h * 0.08, w * 0.9, h * 0.12, { color: '#fff', font: FONT });
      g.strokeStyle = '#333'; g.lineWidth = 1.5;
      g.strokeRect(w * 0.1, h * 0.25, w * 0.8, h * 0.6);
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w * 0.1 + i * w * 0.16, h * 0.25); g.lineTo(w * 0.1 + i * w * 0.16, h * 0.45); g.stroke(); }
      g.strokeStyle = '#1c9a4c'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(w * 0.3, h * 0.6); g.lineTo(w * 0.8, h * 0.6); g.lineTo(w * 0.8, h * 0.8); g.stroke();
      g.fillStyle = '#c62828'; g.beginPath(); g.arc(w * 0.3, h * 0.6, 4, 0, 6.3); g.fill();
      text(g, 'YOU ARE HERE', w * 0.35, h * 0.93, w * 0.6, h * 0.07, { color: '#c62828', font: SANS });
      return;
    }
    case 'hs_monitor': {
      g.fillStyle = '#031008'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#3aff7a'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x < w; x++) { const p = (x % 40) / 40; const y = p > 0.4 && p < 0.46 ? -18 : p > 0.46 && p < 0.5 ? 10 : 0; if (x === 0) g.moveTo(x, h * 0.4 + y); else g.lineTo(x, h * 0.4 + y); }
      g.stroke();
      g.fillStyle = '#ffd24a'; g.font = `bold 13px ${SANS}`; g.textAlign = 'left'; g.fillText('HR 142', 4, h * 0.82);
      g.fillStyle = '#5ac8ff'; g.fillText('SpO2 71', w * 0.5, h * 0.82);
      return;
    }
    case 'hs_monitor_off': {
      g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(120,140,160,0.5)'; g.font = `bold 10px ${SANS}`; g.textAlign = 'center'; g.fillText('NO SIGNAL', w / 2, h / 2);
      return;
    }
    case 'hs_tv': {
      g.fillStyle = '#0a1a4a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c62828'; g.fillRect(0, h * 0.12, w, h * 0.22);
      text(g, 'EMERGENCY ALERT', w / 2, h * 0.23, w * 0.9, h * 0.16, { color: '#fff', font: FONT });
      text(g, 'STAY INDOORS · AVOID HOSPITALS', w / 2, h * 0.52, w * 0.9, h * 0.1, { color: '#fff', font: SANS });
      text(g, 'DO NOT APPROACH THE INFECTED', w / 2, h * 0.68, w * 0.9, h * 0.1, { color: '#ffd24a', font: SANS });
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.12})`; g.fillRect(r() * w, r() * h, 2, 1); }
      return;
    }
    case 'hs_kids': {
      g.fillStyle = '#bfe3f0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#8cc56a'; g.fillRect(0, h * 0.7, w, h * 0.3);
      g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(w * 0.85, h * 0.2, h * 0.12, 0, 6.3); g.fill();
      // a giraffe, an elephant, a lion
      g.fillStyle = '#f2b03a'; g.fillRect(w * 0.14, h * 0.25, w * 0.04, h * 0.45); g.fillRect(w * 0.08, h * 0.5, w * 0.14, h * 0.14);
      g.fillStyle = '#9aa4b0'; g.beginPath(); g.ellipse(w * 0.45, h * 0.58, w * 0.1, h * 0.12, 0, 0, 6.3); g.fill();
      g.fillStyle = '#e8943a'; g.beginPath(); g.arc(w * 0.72, h * 0.58, h * 0.12, 0, 6.3); g.fill();
      text(g, 'KIDS CORNER', w / 2, h * 0.12, w * 0.5, h * 0.12, { color: '#d8231b', font: HAND });
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'hs_xrayfilm': {
      g.fillStyle = '#dfe8f0'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 2; k++) {
        const x0 = 6 + k * (w / 2);
        g.fillStyle = '#0c0f14'; g.fillRect(x0, 6, w / 2 - 12, h - 12);
        g.strokeStyle = 'rgba(220,230,240,0.8)'; g.lineWidth = 2;
        for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(x0 + (w / 2 - 12) / 2, 20 + i * 11, 18 - i, 4, 0, Math.PI, 0); g.stroke(); }
        g.fillStyle = 'rgba(220,230,240,0.7)'; g.fillRect(x0 + (w / 2 - 12) / 2 - 2, 14, 4, h - 30);
      }
      return;
    }
    case 'hs_chart': paperLines(g, 0, 0, w, h, r, 10); g.fillStyle = '#5a6a7a'; g.fillRect(w * 0.3, 0, w * 0.4, h * 0.08); return;
    case 'hs_note': {
      g.fillStyle = '#f4f0dc'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d2f6a'; g.font = `bold 20px ${HAND}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      ['EVAC FROM THE', 'ROOF - HELIPAD', 'RADIO STILL', 'WORKS. GO UP!'].forEach((t, i) => g.fillText(t, 10, 22 + i * 27));
      g.fillStyle = 'rgba(200,180,120,0.5)'; g.fillRect(w * 0.35, 0, w * 0.3, 10);
      weather(g, w, h, r, 0.5);
      return;
    }
    case 'hs_clock': {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 6.3); g.fill();
      g.strokeStyle = '#222'; g.lineWidth = 3; g.stroke();
      g.lineWidth = 2.5; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + w * 0.2, h / 2 - w * 0.12); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - w * 0.05, h / 2 - w * 0.34); g.stroke();
      return;
    }
    case 'hs_handgel': { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d5ec8'; g.fillRect(0, h * 0.7, w, h * 0.3); text(g, 'GEL', w / 2, h * 0.3, w * 0.8, h * 0.2, { color: '#1d5ec8', font: FONT }); return; }
    case 'hs_files': {
      g.fillStyle = '#3a3f44'; g.fillRect(0, 0, w, h);
      const cols = ['#c9a23a', '#3a78b8', '#b8443a', '#4a9a5a', '#e8e0c8', '#8a5ab8', '#d87a2a'];
      for (let row = 0; row < 3; row++) {
        let x = 2;
        while (x < w - 4) {
          const fw = 4 + r() * 7, fh = h / 3 - 8 - r() * 8;
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(x, row * h / 3 + (h / 3 - fh - 3), fw, fh);
          g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 1, row * h / 3 + (h / 3 - fh) + 4, fw - 2, 3);
          x += fw + (r() < 0.12 ? 10 : 0.8);
        }
        g.fillStyle = '#8a9096'; g.fillRect(0, (row + 1) * h / 3 - 3, w, 3);
      }
      return;
    }
    case 'hs_medboxes': case 'hs_supplies': {
      g.fillStyle = '#2e3236'; g.fillRect(0, 0, w, h);
      const cols = name === 'hs_medboxes' ? ['#f4f4f0', '#e8eef8', '#f8e8e8', '#e8f4e8', '#fff4d8'] : ['#c8b89a', '#d8d0c0', '#a8c0d8', '#f0f0e8', '#8ab0c8'];
      for (let row = 0; row < 4; row++) {
        let x = 2;
        while (x < w - 6) {
          const bw = 10 + r() * 18, bh = h / 4 - 6 - r() * 10;
          if (r() < 0.2) { x += bw; continue; }   // gaps: looted
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(x, row * h / 4 + (h / 4 - bh - 2), bw, bh);
          g.fillStyle = ['#c62828', '#1d5ec8', '#1d6b3a', '#e8943a'][Math.floor(r() * 4)];
          g.fillRect(x + 2, row * h / 4 + (h / 4 - bh) + 2, bw - 4, 3);
          x += bw + 1;
        }
        g.fillStyle = '#9aa0a6'; g.fillRect(0, (row + 1) * h / 4 - 2, w, 2);
      }
      return;
    }
    case 'hs_vend': case 'hs_vend2': {
      g.fillStyle = name === 'hs_vend' ? '#20242a' : '#b3121e'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0a0d10'; g.fillRect(w * 0.08, h * 0.08, w * 0.62, h * 0.7);
      for (let row = 0; row < 6; row++) for (let c = 0; c < 4; c++) {
        if (r() < 0.3) continue;
        g.fillStyle = ['#e8943a', '#c62828', '#3a78b8', '#f2c21a', '#4a9a5a', '#8a5ab8'][Math.floor(r() * 6)];
        g.fillRect(w * 0.1 + c * w * 0.15, h * 0.1 + row * h * 0.11, w * 0.12, h * 0.08);
      }
      g.fillStyle = 'rgba(160,200,255,0.12)'; g.fillRect(w * 0.08, h * 0.08, w * 0.3, h * 0.7);
      g.fillStyle = '#3a3f44'; g.fillRect(w * 0.74, h * 0.2, w * 0.2, h * 0.3);
      g.fillStyle = '#6ad0ff'; g.fillRect(w * 0.76, h * 0.22, w * 0.16, h * 0.05);
      g.fillStyle = '#0a0d10'; g.fillRect(w * 0.1, h * 0.84, w * 0.55, h * 0.1);
      if (name === 'hs_vend2') text(g, 'COLD DRINKS', w * 0.4, h * 0.04, w * 0.7, h * 0.05, { color: '#fff', font: FONT });
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'hs_gauges': {
      g.fillStyle = '#d8d4c4'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 3; k++) {
        const cx = w * (0.18 + k * 0.32), cy = h * 0.45;
        g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(cx, cy, h * 0.3, 0, 6.3); g.fill();
        g.strokeStyle = '#222'; g.lineWidth = 2; g.stroke();
        g.strokeStyle = '#c62828'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(-2.4 + r() * 1.2) * h * 0.25, cy + Math.sin(-2.4 + r() * 1.2) * h * 0.25); g.stroke();
      }
      text(g, 'kW   V   Hz', w / 2, h * 0.9, w * 0.9, h * 0.14, { color: '#222', font: SANS });
      return;
    }
    case 'hs_panel': {
      g.fillStyle = '#c9c6b8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) {
        const x = 10 + (i % 4) * 28, y = 12 + Math.floor(i / 4) * 36;
        g.fillStyle = '#2a2d30'; g.fillRect(x, y, 16, 24);
        g.fillStyle = i % 5 === 2 ? '#c62828' : '#e8e4d8'; g.fillRect(x + 4, y + (i % 3 ? 3 : 13), 8, 8);
      }
      text(g, 'MAIN SWITCHBOARD', w / 2, h * 0.94, w * 0.9, h * 0.08, { color: '#222', font: SANS });
      return;
    }
    case 'hs_caution': {
      for (let x = -h; x < w + h; x += h) {
        g.fillStyle = '#f2c21a'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h / 2, 0); g.lineTo(x + h / 2 - h, h); g.lineTo(x - h, h); g.closePath(); g.fill();
        g.fillStyle = '#141414'; g.beginPath(); g.moveTo(x + h / 2, 0); g.lineTo(x + h, 0); g.lineTo(x, h); g.lineTo(x + h / 2 - h, h); g.closePath(); g.fill();
      }
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'hs_mesh': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(150,158,164,1)'; g.lineWidth = 2.2;
      for (let k = -w; k < w * 2; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke(); }
      g.lineWidth = 5; g.strokeRect(0, 0, w, h);
      return;
    }
    case 'hs_plastic': {
      g.fillStyle = 'rgba(225,235,240,0.5)'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        const x = r() * w;
        const grd = g.createLinearGradient(x - 8, 0, x + 8, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, `rgba(255,255,255,${0.2 + r() * 0.35})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(x - 8, 0, 16, h);
      }
      for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(90,70,40,${0.05 + r() * 0.12})`; g.fillRect(r() * w, h * (0.6 + r() * 0.4), 20 + r() * 40, 4 + r() * 20); }
      g.fillStyle = 'rgba(140,10,10,0.55)';
      for (let i = 0; i < 3; i++) { const x = r() * w; g.fillRect(x, h * r() * 0.5, 3, h * 0.3); }
      text(g, 'QUARANTINE', w / 2, h * 0.3, w * 0.8, h * 0.08, { color: 'rgba(200,30,20,0.7)', font: FONT });
      return;
    }
    case 'hs_curtain': {
      g.fillStyle = '#9fc4c2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9e0da';
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { g.beginPath(); g.moveTo(x + 8, y); g.lineTo(x + 16, y + 8); g.lineTo(x + 8, y + 16); g.lineTo(x, y + 8); g.fill(); }
      return;
    }
    case 'hs_vent': {
      g.fillStyle = '#b8bab6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a2c2e'; for (let y = 6; y < h - 4; y += 6) g.fillRect(4, y, w - 8, 3);
      return;
    }
    case 'blood_trail': return blood(g, w, h, r, 'trail');
    case 'blood_hand': return blood(g, w, h, r, 'hand');
    case 'blood_splat': return blood(g, w, h, r, 'splat');
    case 'blood_drip': return blood(g, w, h, r, 'drip');
    case 'blood_pool': return blood(g, w, h, r, 'pool');
    case 'grime': return grime(g, w, h, r, '40,30,18');
    case 'grime2': return grime(g, w, h, r, '60,50,30');
    case 'mold': return grime(g, w, h, r, '30,40,20');
    case 'g_roof': graffiti(g, w, h, r, 'ROOF ↑ HELI', '#d8231b'); return;
    case 'g_dead': graffiti(g, w, h, r, 'DEAD INSIDE', '#d8231b'); return;
    case 'g_help': graffiti(g, w, h, r, 'HELP US', '#1a1a1a'); return;
    case 'g_evac': graffiti(g, w, h, r, 'NO EVAC. RUN', '#2a5ac4'); return;
    case 'g_notsafe': graffiti(g, w, h, r, 'NOT SAFE', '#d8231b', { tilt: -0.1 }); return;
    case 'g_tally': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = 3; g.lineCap = 'round';
      for (let grp = 0; grp < 4; grp++) {
        const x0 = 8 + grp * 30, y0 = 20 + (grp % 2) * 30;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x0 + k * 5, y0); g.lineTo(x0 + k * 5, y0 + 22); g.stroke(); }
        g.beginPath(); g.moveTo(x0 - 3, y0 + 18); g.lineTo(x0 + 20, y0 + 4); g.stroke();
      }
      return;
    }
    default: {
      g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
      void arrow; void SERIF;
    }
  }
}

/** The hospital's atlas (shared by every renderer on the page). */
export function hospitalAtlas() {
  return createAtlas('hospital', CELLS, paint, 2048);
}
