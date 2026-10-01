// Harlan Metro's picture atlas (render3d/levels/metro.js): the roundel and the station's name, the line
// map, the wayfinding (TO TRAINS, WAY OUT, MIND THE GAP), the danger plates of the tunnels and the works,
// the shops' fascias, the adverts on the platform wall, the train's destination blind and number, the
// ticket machines' and the departure board's screens, the newsstand's papers, and the blood, grime,
// water stains and graffiti. Painted once per page on a canvas (hospital-kit.js createAtlas).

import { createAtlas, text, rrect, weather, panelSign, arrow, blood, graffiti, grime, FONT, SANS, HAND, SERIF } from './hospital-kit.js';

const CELLS = {
  white: [16, 16],
  // the line's identity
  mt_roundel: [256, 256], mt_name: [768, 112], mt_station: [512, 80], mt_linemap: [512, 112], mt_map: [256, 320],
  // wayfinding
  mt_trains: [256, 64], mt_wayout: [256, 64], mt_exit: [128, 48], mt_tickets: [256, 64], mt_staff: [192, 56], mt_noentry: [192, 56],
  mt_platform2: [384, 64], mt_mind: [384, 48], mt_danger: [256, 96], mt_track: [256, 96], mt_bulkhead: [256, 64], mt_pump: [256, 64],
  mt_works: [256, 64], mt_hv: [128, 128], mt_lift: [256, 64], mt_square: [256, 64], mt_ticketoffice: [256, 56], mt_closed: [256, 64],
  // shops
  mt_cafe: [384, 64], mt_florist: [384, 64], mt_news: [384, 64], mt_papers: [256, 128], mt_menu: [256, 96], mt_flowers: [256, 96],
  // adverts and posters
  mt_ad1: [320, 160], mt_ad2: [320, 160], mt_ad3: [320, 160], mt_ad4: [320, 160], mt_poster: [128, 176], mt_notice: [160, 128],
  // the train, the machines
  mt_dest: [256, 48], mt_carno: [128, 48], mt_cabpanel: [256, 96], mt_tvm: [96, 128], mt_dep: [320, 64], mt_gauges: [128, 64], mt_breaker: [256, 128],
  // textures that tile in pieces
  mt_grille: [128, 128], mt_mesh: [128, 128], mt_caution: [256, 32], mt_vent: [64, 64], mt_plaque: [192, 96],
  // blood, grime, graffiti
  blood_trail: [512, 128], blood_hand: [256, 256], blood_splat: [256, 256], blood_drip: [128, 256], blood_pool: [256, 256],
  grime: [256, 256], grime2: [256, 256], mold: [256, 256], wstain: [128, 256], mud: [256, 256], soot: [256, 256],
  g_tag1: [256, 96], g_tag2: [256, 96], g_help: [256, 96], g_dead: [256, 96], g_square: [256, 96], g_tally: [128, 96], g_quarantine: [320, 96],
};

const BLUE = '#1d3f7a', YELLOW = '#f2c21a';

/** The line's roundel: a ring with a bar across, the M. */
function roundel(g, cx, cy, r) {
  g.lineWidth = r * 0.26;
  g.strokeStyle = '#2a7a4a';
  g.beginPath(); g.arc(cx, cy, r * 0.8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = BLUE;
  g.fillRect(cx - r, cy - r * 0.2, r * 2, r * 0.4);
  text(g, 'METRO', cx, cy + 1, r * 1.7, r * 0.32, { color: '#fff', font: SANS });
}

function advert(g, w, h, r, o) {
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, o.c0); grd.addColorStop(1, o.c1);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  if (o.shape === 'bottle') { g.fillStyle = o.fg; rrect(g, w * 0.72, h * 0.18, w * 0.12, h * 0.66, 10); g.fill(); g.fillRect(w * 0.75, h * 0.08, w * 0.06, h * 0.14); }
  if (o.shape === 'phone') { g.fillStyle = '#111'; rrect(g, w * 0.7, h * 0.12, w * 0.18, h * 0.76, 10); g.fill(); g.fillStyle = o.fg; g.fillRect(w * 0.72, h * 0.18, w * 0.14, h * 0.6); }
  if (o.shape === 'sun') { g.fillStyle = o.fg; g.beginPath(); g.arc(w * 0.78, h * 0.4, h * 0.25, 0, 6.3); g.fill(); }
  if (o.shape === 'face') { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(w * 0.78, h * 0.5, w * 0.12, h * 0.34, 0, 0, 6.3); g.fill(); }
  text(g, o.title, w * 0.34, h * 0.36, w * 0.6, h * 0.26, { color: o.tc || '#fff', font: o.font || FONT });
  text(g, o.sub, w * 0.34, h * 0.66, w * 0.6, h * 0.12, { color: o.tc || '#fff', font: SANS, weight: 'normal' });
  weather(g, w, h, r, 0.9);
  // torn corners and a scrawl
  g.fillStyle = 'rgba(230,226,214,0.9)';
  g.beginPath(); g.moveTo(w, h); g.lineTo(w - 30 - r() * 30, h); g.lineTo(w, h - 20 - r() * 30); g.fill();
}

function paint(g, name, w, h, r) {
  switch (name) {
    case 'white': g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); return;
    case 'mt_roundel': g.clearRect(0, 0, w, h); roundel(g, w / 2, h / 2, w * 0.46); return;
    case 'mt_name': {
      g.fillStyle = '#1a1c20'; g.fillRect(0, 0, w, h);
      roundel(g, h * 0.62, h / 2, h * 0.44);
      text(g, 'HARLAN METRO', w * 0.58, h / 2 + 2, w * 0.7, h * 0.62, { color: '#f4f0e6', font: FONT });
      weather(g, w, h, r, 0.5);
      return;
    }
    case 'mt_station': {
      g.fillStyle = BLUE; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.fillRect(4, 4, w - 8, h - 8);
      g.fillStyle = BLUE; g.fillRect(8, 8, w - 16, h - 16);
      text(g, 'MARKET STREET', w / 2, h / 2 + 2, w * 0.85, h * 0.52, { color: '#fff', font: SANS });
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'mt_linemap': {
      g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a7a4a'; g.fillRect(20, h * 0.5 - 5, w - 40, 10);
      const st = ['WESTFIELD', 'CANAL', 'MARKET ST', 'HARLAN SQ', 'DOCKS', 'EASTGATE'];
      st.forEach((s, i) => {
        const x = 30 + (i * (w - 60)) / (st.length - 1);
        g.fillStyle = i === 2 ? '#d8231b' : '#fff'; g.strokeStyle = '#1a1c20'; g.lineWidth = 3;
        g.beginPath(); g.arc(x, h * 0.5, 9, 0, 6.3); g.fill(); g.stroke();
        text(g, s, x, i % 2 ? h * 0.8 : h * 0.2, 80, 14, { color: '#1a1c20', font: SANS });
      });
      text(g, 'LINE 2', 40, 14, 60, 14, { color: '#2a7a4a', font: FONT });
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'mt_map': {
      g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#c8c0b0'; g.lineWidth = 6;
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(r() * w, 0); g.lineTo(r() * w, h); g.stroke(); g.beginPath(); g.moveTo(0, r() * h); g.lineTo(w, r() * h); g.stroke(); }
      g.strokeStyle = '#2a7a4a'; g.lineWidth = 5; g.beginPath(); g.moveTo(10, h * 0.6); g.bezierCurveTo(w * 0.3, h * 0.3, w * 0.6, h * 0.8, w - 10, h * 0.4); g.stroke();
      g.fillStyle = '#d8231b'; g.beginPath(); g.arc(w * 0.45, h * 0.55, 8, 0, 6.3); g.fill();
      text(g, 'YOU ARE HERE', w * 0.45, h * 0.62, 110, 12, { color: '#d8231b', font: SANS });
      g.fillStyle = BLUE; g.fillRect(0, 0, w, 34);
      text(g, 'LOCAL AREA', w / 2, 17, w * 0.8, 20, { color: '#fff', font: SANS });
      weather(g, w, h, r, 0.7);
      return;
    }
    case 'mt_trains': return panelSign(g, w, h, r, { bg: BLUE, text: 'TO TRAINS', sub: 'LINE 2 · PLATFORMS 1 & 2', arrow: 'd' });
    case 'mt_wayout': return panelSign(g, w, h, r, { bg: YELLOW, fg: '#111', fg2: '#111', text: 'WAY OUT', sub: 'STATION STREET', arrow: 'u' });
    case 'mt_exit': {
      g.fillStyle = '#0f7a34'; rrect(g, 1, 1, w - 2, h - 2, 5); g.fill();
      text(g, 'EXIT', w / 2 + 12, h / 2 + 1, w * 0.56, h * 0.62, { color: '#e8fff0', font: FONT });
      arrow(g, 20, h / 2, 12, 'l', '#e8fff0');
      return;
    }
    case 'mt_tickets': return panelSign(g, w, h, r, { bg: BLUE, text: 'TICKETS', sub: 'MACHINES · OFFICE' });
    case 'mt_staff': return panelSign(g, w, h, r, { bg: '#5a5e62', text: 'STAFF ONLY' });
    case 'mt_noentry': return panelSign(g, w, h, r, { bg: '#b3120e', text: 'NO ENTRY' });
    case 'mt_platform2': return panelSign(g, w, h, r, { bg: BLUE, text: 'PLATFORM 2', sub: 'LINE 2 · EASTBOUND · EASTGATE', arrow: 'r' });
    case 'mt_mind': {
      g.clearRect(0, 0, w, h);
      text(g, 'MIND THE GAP', w / 2, h / 2, w * 0.95, h * 0.8, { color: 'rgba(240,236,220,0.9)', font: FONT });
      return;
    }
    case 'mt_danger': case 'mt_track': {
      g.fillStyle = YELLOW; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111'; g.fillRect(4, 4, w - 8, 6); g.fillRect(4, h - 10, w - 8, 6);
      g.beginPath(); g.moveTo(h * 0.5, 16); g.lineTo(h * 0.86, h - 16); g.lineTo(h * 0.14, h - 16); g.closePath(); g.fill();
      text(g, '!', h * 0.5, h * 0.62, 20, h * 0.4, { color: YELLOW, font: FONT });
      text(g, name === 'mt_danger' ? 'DANGER' : 'NO ACCESS', w * 0.62, h * 0.36, w * 0.6, h * 0.28, { color: '#111', font: FONT });
      text(g, name === 'mt_danger' ? 'LIVE RAIL · 750 V' : 'TRACK · AUTHORISED STAFF', w * 0.62, h * 0.68, w * 0.62, h * 0.16, { color: '#111', font: SANS });
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'mt_bulkhead': return panelSign(g, w, h, r, { bg: '#5a5e62', text: 'BULKHEAD 3', sub: 'SUMP · FLOOD DOOR · KEEP SHUT' });
    case 'mt_pump': return panelSign(g, w, h, r, { bg: '#2a5a7a', text: 'PUMP ROOM', sub: 'SUMP 2 · DRAINAGE' });
    case 'mt_works': return panelSign(g, w, h, r, { bg: '#c8583a', text: 'MAINTENANCE WORKS', sub: 'HARD HATS MUST BE WORN' });
    case 'mt_hv': {
      g.fillStyle = YELLOW; g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 6, h - 10); g.lineTo(6, h - 10); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#111';
      g.beginPath(); g.moveTo(w * 0.55, h * 0.3); g.lineTo(w * 0.4, h * 0.6); g.lineTo(w * 0.52, h * 0.6); g.lineTo(w * 0.44, h * 0.84); g.lineTo(w * 0.64, h * 0.5); g.lineTo(w * 0.52, h * 0.5); g.closePath(); g.fill();
      return;
    }
    case 'mt_lift': return panelSign(g, w, h, r, { bg: '#5a5e62', text: 'FREIGHT LIFT', sub: '2000 kg · STAFF ONLY' });
    case 'mt_square': return panelSign(g, w, h, r, { bg: YELLOW, fg: '#111', fg2: '#111', text: 'HARLAN SQUARE', sub: 'WAY OUT', arrow: 'u' });
    case 'mt_ticketoffice': return panelSign(g, w, h, r, { bg: BLUE, text: 'TICKET OFFICE' });
    case 'mt_closed': return panelSign(g, w, h, r, { bg: '#b3120e', text: 'STAIRS CLOSED', sub: 'USE STAFF ROUTE · BY ORDER' });
    case 'mt_cafe': case 'mt_florist': case 'mt_news': {
      const [str, bg, fg, font] = { mt_cafe: ['DEPOT CAFÉ', '#3a2a1c', '#f0d8a8', SERIF], mt_florist: ['PETAL & STEM', '#e8e0d4', '#3a6a3a', SERIF], mt_news: ['NEWS · MAGAZINES', '#c8231b', '#fff', FONT] }[name];
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      text(g, str, w / 2, h / 2 + 1, w * 0.86, h * 0.6, { color: fg, font, italic: font === SERIF });
      weather(g, w, h, r, 0.5);
      return;
    }
    case 'mt_papers': {
      g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        const x = 4 + (i % 4) * 63, y = 4 + Math.floor(i / 4) * 62;
        g.fillStyle = '#f0ece0'; g.fillRect(x, y, 58, 58);
        text(g, ['HARLAN POST', 'THE DAILY', 'EVENING NEWS', 'CITY TIMES'][i % 4], x + 29, y + 8, 54, 9, { color: '#111', font: SERIF });
        text(g, ['OUTBREAK', 'QUARANTINE', 'STAY HOME', 'ARMY IN'][(i + 1) % 4], x + 29, y + 24, 54, 14, { color: '#b3120e', font: FONT });
        for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(30,30,30,0.5)'; g.fillRect(x + 4, y + 36 + k * 5, 50, 2); }
      }
      weather(g, w, h, r, 0.6);
      return;
    }
    case 'mt_menu': {
      g.fillStyle = '#1a1816'; g.fillRect(0, 0, w, h);
      text(g, 'COFFEE · TEA · PASTRIES', w / 2, 12, w * 0.9, 14, { color: '#f0d8a8', font: SANS });
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(240,232,210,0.8)'; g.fillRect(14, 28 + i * 10, 120 + r() * 60, 3); text(g, '$' + (2 + i), w - 26, 30 + i * 10, 30, 9, { color: '#f0d8a8', font: SANS }); }
      return;
    }
    case 'mt_flowers': {
      g.fillStyle = '#3a4a2a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { g.fillStyle = ['#d8231b', '#f2c21a', '#e8288a', '#f4f0e8', '#8a3ab0', '#e87a1a'][Math.floor(r() * 6)]; g.globalAlpha = 0.5 + r() * 0.3; g.beginPath(); g.arc(r() * w, r() * h * 0.8, 3 + r() * 6, 0, 6.3); g.fill(); }
      g.globalAlpha = 1;
      return;
    }
    case 'mt_ad1': return advert(g, w, h, r, { c0: '#e8b83a', c1: '#c8583a', title: 'SUNNY DAYS', sub: 'Fly to the coast from $49', fg: '#fff4c8', shape: 'sun' });
    case 'mt_ad2': return advert(g, w, h, r, { c0: '#1a1c20', c1: '#2a3a5a', title: 'NOVA X', sub: 'The phone that does more', fg: '#5ab8ff', shape: 'phone' });
    case 'mt_ad3': return advert(g, w, h, r, { c0: '#c8231b', c1: '#7a1210', title: 'Cool Cola', sub: 'Ice cold. Always.', fg: '#3a1a0a', shape: 'bottle', font: HAND });
    case 'mt_ad4': return advert(g, w, h, r, { c0: '#d8d0c0', c1: '#a89880', title: 'NIGHTFALL', sub: 'At cinemas everywhere', fg: '#111', tc: '#1a1a1a', shape: 'face' });
    case 'mt_poster': {
      g.fillStyle = '#f0ece0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#b3120e'; g.fillRect(0, 0, w, h * 0.2);
      text(g, 'NOTICE', w / 2, h * 0.1, w * 0.8, h * 0.12, { color: '#fff', font: FONT });
      text(g, 'SERVICE SUSPENDED', w / 2, h * 0.3, w * 0.9, h * 0.08, { color: '#111', font: SANS });
      for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(30,30,40,0.6)'; g.fillRect(w * 0.1, h * (0.4 + i * 0.06), w * (0.5 + r() * 0.3), 2); }
      weather(g, w, h, r, 0.9);
      return;
    }
    case 'mt_notice': {
      g.fillStyle = '#f4f0e2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a7a4a'; g.fillRect(0, 0, w, h * 0.18);
      text(g, 'EVACUATION ROUTE', w / 2, h * 0.09, w * 0.9, h * 0.12, { color: '#fff', font: SANS });
      for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(30,30,40,0.6)'; g.fillRect(w * 0.08, h * (0.28 + i * 0.08), w * (0.5 + r() * 0.35), 2); }
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'mt_dest': {
      g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, w, h);
      text(g, '2  EASTGATE', w / 2, h / 2 + 1, w * 0.86, h * 0.6, { color: '#ffb030', font: SANS });
      return;
    }
    case 'mt_carno': {
      g.clearRect(0, 0, w, h);
      text(g, '2' + Math.floor(100 + r() * 800), w / 2, h / 2, w * 0.8, h * 0.6, { color: '#f4f0e6', font: SANS });
      return;
    }
    case 'mt_cabpanel': {
      g.fillStyle = '#2a2d30'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) { g.fillStyle = '#0a0c0e'; g.beginPath(); g.arc(30 + i * 40, 30, 15, 0, 6.3); g.fill(); g.strokeStyle = '#d8d8d0'; g.lineWidth = 2; g.beginPath(); g.moveTo(30 + i * 40, 30); g.lineTo(30 + i * 40 + Math.cos(r() * 6) * 12, 30 + Math.sin(r() * 6) * 12); g.stroke(); }
      for (let i = 0; i < 12; i++) { g.fillStyle = ['#d8231b', '#3aba5a', '#f2c21a', '#d8d8d0'][i % 4]; g.fillRect(14 + i * 19, 64, 12, 10); }
      g.fillStyle = '#0a1a2a'; g.fillRect(180, 10, 66, 44);
      return;
    }
    case 'mt_tvm': {
      g.fillStyle = '#1d3f7a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0a0e14'; g.fillRect(8, 10, w - 16, h * 0.45);
      text(g, 'OUT OF', w / 2, h * 0.24, w * 0.7, 12, { color: '#ff5a3a', font: SANS });
      text(g, 'SERVICE', w / 2, h * 0.36, w * 0.7, 12, { color: '#ff5a3a', font: SANS });
      for (let i = 0; i < 6; i++) { g.fillStyle = '#c8ccd0'; g.fillRect(12 + (i % 3) * 25, h * 0.62 + Math.floor(i / 3) * 16, 20, 12); }
      return;
    }
    case 'mt_dep': {
      g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, w, h);
      text(g, '1  EASTGATE    SUSPENDED', w / 2, h * 0.3, w * 0.92, h * 0.28, { color: '#ffb030', font: SANS, align: 'center' });
      text(g, '2  WESTFIELD   CANCELLED', w / 2, h * 0.72, w * 0.92, h * 0.28, { color: '#ffb030', font: SANS, align: 'center' });
      return;
    }
    case 'mt_gauges': {
      g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3; i++) { g.fillStyle = '#f4f0e8'; g.beginPath(); g.arc(22 + i * 42, 30, 18, 0, 6.3); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke(); g.beginPath(); g.moveTo(22 + i * 42, 30); g.lineTo(22 + i * 42 + 12 * Math.cos(-0.5 - r() * 2), 30 + 12 * Math.sin(-0.5 - r() * 2)); g.stroke(); }
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'mt_breaker': {
      g.fillStyle = '#8a9096'; g.fillRect(0, 0, w, h);
      for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) {
        const x = 12 + i * 40, y = 12 + j * 38;
        g.fillStyle = '#2a2c2e'; g.fillRect(x, y, 30, 28);
        g.fillStyle = r() < 0.7 ? '#d8d8d0' : '#d8231b'; g.fillRect(x + 10, y + (r() < 0.5 ? 4 : 14), 10, 10);
      }
      weather(g, w, h, r, 0.7);
      return;
    }
    case 'mt_grille': {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#c8ccd0';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
      for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4);
      return;
    }
    case 'mt_mesh': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#a8acb0'; g.lineWidth = 2.4;
      for (let k = -h; k < w + h; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
      return;
    }
    case 'mt_caution': {
      for (let x = -h; x < w + h; x += 24) {
        g.fillStyle = YELLOW; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 12 - h, h); g.lineTo(x - h, h); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.moveTo(x + 12, 0); g.lineTo(x + 24, 0); g.lineTo(x + 24 - h, h); g.lineTo(x + 12 - h, h); g.fill();
      }
      weather(g, w, h, r, 0.8);
      return;
    }
    case 'mt_vent': {
      g.fillStyle = '#6d7378'; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h - 4; y += 8) { g.fillStyle = '#1a1c1e'; g.fillRect(6, y, w - 12, 4); }
      return;
    }
    case 'mt_plaque': {
      g.fillStyle = '#5a4a2a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#b89a5a'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
      text(g, 'ELIAS HARLAN', w / 2, h * 0.36, w * 0.8, h * 0.22, { color: '#d8c08a', font: SERIF });
      text(g, 'FOUNDER · 1871', w / 2, h * 0.66, w * 0.7, h * 0.14, { color: '#d8c08a', font: SERIF });
      return;
    }
    case 'blood_trail': return blood(g, w, h, r, 'trail');
    case 'blood_hand': return blood(g, w, h, r, 'hand');
    case 'blood_splat': return blood(g, w, h, r, 'splat');
    case 'blood_drip': return blood(g, w, h, r, 'drip');
    case 'blood_pool': return blood(g, w, h, r, 'pool');
    case 'grime': return grime(g, w, h, r);
    case 'grime2': return grime(g, w, h, r, '22,26,20');
    case 'mold': return grime(g, w, h, r, '34,44,24');
    case 'mud': return grime(g, w, h, r, '58,48,30');
    case 'soot': return grime(g, w, h, r, '12,12,12');
    case 'wstain': {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 18; i++) {
        const x = w * (0.15 + r() * 0.7), len = h * (0.3 + r() * 0.7), wd = 2 + r() * 8;
        const grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, 'rgba(60,50,30,0.35)'); grd.addColorStop(1, 'rgba(60,50,30,0)');
        g.fillStyle = grd; g.fillRect(x, 0, wd, len);
      }
      return;
    }
    case 'g_tag1': return graffiti(g, w, h, r, 'RATZ', '#5ab8ff', { font: FONT });
    case 'g_tag2': return graffiti(g, w, h, r, 'K-ONE', '#e8288a', { font: FONT, tilt: -0.1 });
    case 'g_help': return graffiti(g, w, h, r, 'HELP US', '#d8231b');
    case 'g_dead': return graffiti(g, w, h, r, 'THEY CAME UP', '#d8231b');
    case 'g_square': return graffiti(g, w, h, r, 'SQUARE →', '#6cff4a');
    case 'g_quarantine': return graffiti(g, w, h, r, 'QUARANTINE ZONE', YELLOW, { font: FONT });
    case 'g_tally': {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(230,230,220,0.9)'; g.lineWidth = 3;
      for (let k = 0; k < 4; k++) {
        const x0 = 8 + k * 30;
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x0 + i * 5, 20); g.lineTo(x0 + i * 5 + 1, 70); g.stroke(); }
        g.beginPath(); g.moveTo(x0 - 3, 60); g.lineTo(x0 + 22, 28); g.stroke();
      }
      return;
    }
    default: g.fillStyle = '#888'; g.fillRect(0, 0, w, h);
  }
}

/** Harlan Metro's atlas (created once per page). */
export function metroAtlas() {
  return createAtlas('metro', CELLS, paint, 2048);
}
