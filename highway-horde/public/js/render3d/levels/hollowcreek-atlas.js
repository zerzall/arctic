// Hollow Creek's pictures in the level atlas (millroad-atlas.js holds the sheet; these cells join it while
// Hollow Creek is the level): the town's signs and fascias, the church's glass, the school's boards and
// drawings, the police liveries, the railroad's heralds, notices, menus and the graffiti of the last days.

import { addCells, PAINTERS } from './millroad-atlas.js';

const { fit, rrect, weather, board, paint, spray, poster, FONT, COND, HAND, SERIF } = PAINTERS;

const SIZES = {
  hc_welcome: [512, 256], hc_town: [512, 96], hc_crossbuck: [256, 48], hc_rrx: [128, 128], hc_rrname: [512, 64], hc_herald: [128, 128],
  hc_placard: [128, 128], hc_feed: [512, 96], hc_diner: [512, 128], hc_eat: [128, 64], hc_hardware: [512, 96], hc_aisles: [512, 64],
  hc_rexall: [512, 96], hc_rx: [256, 64], hc_meds: [256, 64], hc_bijou: [512, 128], hc_bijouv: [96, 384], hc_movie1: [128, 192],
  hc_movie2: [128, 192], hc_post: [512, 96], hc_bank: [512, 96], hc_laundry: [512, 96], hc_stanne: [256, 192], hc_glass1: [128, 256],
  hc_glass2: [128, 256], hc_glass3: [128, 256], hc_rose: [256, 256], hc_school: [512, 192], hc_hornet: [256, 256], hc_chalk: [512, 256],
  hc_kids: [256, 128], hc_abc: [512, 64], hc_police: [512, 96], hc_cruiser: [256, 64], hc_badge: [128, 128], hc_wanted: [256, 192],
  hc_sally: [256, 96], hc_banner: [512, 64], hc_plaque: [256, 128], hc_closed: [256, 128], hc_church_graf: [256, 96], hc_school_graf: [256, 96],
  hc_menu: [256, 192], hc_flag: [192, 128], hc_speed: [128, 160], hc_hymns: [128, 192], hc_notice2: [128, 160], hc_sale: [256, 64], hc_stand: [256, 64],
};

/** Letters with a drop shadow (a painted sign's raised letters). */
function raised(g, str, cx, cy, w, h, color, shadow, o = {}) {
  fit(g, str, cx + h * 0.05, cy + h * 0.06, w, h, { ...o, color: shadow });
  fit(g, str, cx, cy, w, h, { ...o, color });
}

/** A stained-glass lancet: a pointed arch of leaded panes around a figure-less motif. */
function lancet(g, w, h, r, hues) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.moveTo(4, h - 4);
  g.lineTo(4, h * 0.3);
  g.quadraticCurveTo(4, 6, w / 2, 4);
  g.quadraticCurveTo(w - 4, 6, w - 4, h * 0.3);
  g.lineTo(w - 4, h - 4);
  g.closePath();
  g.clip();
  // panes: a grid broken by diagonals, each pane its own tint
  const cols = 4, rows = 10;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i / cols) * w, y = (j / rows) * h;
      g.fillStyle = hues[Math.floor(r() * hues.length)];
      g.fillRect(x, y, w / cols + 1, h / rows + 1);
      g.fillStyle = `rgba(255,255,255,${r() * 0.18})`;
      g.fillRect(x, y, w / cols, h / rows / 2);
    }
  }
  // the motif: a cross in a medallion, a dove above, lilies below
  g.fillStyle = '#e8c860';
  g.beginPath(); g.arc(w / 2, h * 0.42, w * 0.3, 0, 6.3); g.fill();
  g.fillStyle = '#8a1a1a';
  g.beginPath(); g.arc(w / 2, h * 0.42, w * 0.24, 0, 6.3); g.fill();
  g.fillStyle = '#f0e8c8';
  g.fillRect(w / 2 - 4, h * 0.42 - w * 0.18, 8, w * 0.36);
  g.fillRect(w / 2 - w * 0.12, h * 0.42 - w * 0.07, w * 0.24, 8);
  g.fillStyle = '#f0f0f0';
  g.beginPath(); g.ellipse(w / 2, h * 0.16, 12, 6, 0, 0, 6.3); g.fill();
  g.fillStyle = '#3a8a4a';
  for (let k = 0; k < 3; k++) g.fillRect(w * 0.3 + k * w * 0.2, h * 0.7, 4, h * 0.2);
  g.fillStyle = '#f0f0e0';
  for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(w * 0.3 + k * w * 0.2 + 2, h * 0.7, 7, 10, 0, 0, 6.3); g.fill(); }
  // the leading
  g.strokeStyle = '#1a1614';
  g.lineWidth = 3;
  for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo((i / cols) * w, 0); g.lineTo((i / cols) * w, h); g.stroke(); }
  for (let j = 1; j < rows; j++) { g.beginPath(); g.moveTo(0, (j / rows) * h); g.lineTo(w, (j / rows) * h); g.stroke(); }
  g.beginPath(); g.arc(w / 2, h * 0.42, w * 0.3, 0, 6.3); g.stroke();
  g.restore();
  g.strokeStyle = '#2a2420';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(4, h - 4); g.lineTo(4, h * 0.3); g.quadraticCurveTo(4, 6, w / 2, 4); g.quadraticCurveTo(w - 4, 6, w - 4, h * 0.3); g.lineTo(w - 4, h - 4); g.closePath();
  g.stroke();
}

const PAINT = {
  hc_welcome(g, w, h, r) {
    // the town's welcome board: green field, cream border, a covered bridge over the creek, the motto
    board(g, w, h, '#2a4a36', r, 4);
    g.strokeStyle = '#efe4c4';
    g.lineWidth = 8;
    rrect(g, 10, 10, w - 20, h - 20, 18);
    g.stroke();
    fit(g, 'WELCOME TO', w / 2, 44, w * 0.5, 26, { color: '#efe4c4', font: SERIF });
    raised(g, 'Hollow Creek', w / 2, 100, w * 0.8, 70, '#f4e8c4', '#10200f', { font: SERIF, italic: true });
    fit(g, 'EST. 1868   -   POP. 2,140', w / 2, 150, w * 0.6, 20, { color: '#e8c060', font: SERIF });
    // the creek and the bridge
    g.fillStyle = '#4a7aa0';
    g.beginPath(); g.moveTo(40, 210); g.bezierCurveTo(140, 190, 200, 230, 300, 205); g.bezierCurveTo(380, 190, 430, 220, 472, 205); g.lineTo(472, 222); g.lineTo(40, 226); g.fill();
    g.fillStyle = '#8a2a22';
    g.fillRect(200, 176, 110, 26);
    g.beginPath(); g.moveTo(194, 178); g.lineTo(255, 158); g.lineTo(316, 178); g.fill();
    g.fillStyle = '#1a1a1a';
    g.fillRect(236, 184, 38, 18);
    fit(g, 'A NICE PLACE TO CALL HOME', w / 2, h - 30, w * 0.7, 16, { color: '#efe4c4', font: SERIF });
    weather(g, w, h, r, 0.9);
  },
  hc_town(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    fit(g, 'HOLLOW CREEK', w / 2, h / 2, w * 0.96, h * 0.8, { color: '#1a2a4a', font: FONT });
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 140; i++) { g.globalAlpha = r() * 0.6; g.fillRect(r() * w, r() * h, 2 + r() * 8, 1 + r() * 3); }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  },
  hc_crossbuck(g, w, h, r) {
    g.fillStyle = '#f0eee6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
    fit(g, 'RAILROAD CROSSING', w / 2, h / 2 + 1, w * 0.9, h * 0.62, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 0.5);
  },
  hc_rrx(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f0d020';
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 3, 0, 6.3); g.fill();
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 5;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 7, 0, 6.3); g.stroke();
    g.lineWidth = 8;
    g.beginPath(); g.moveTo(w * 0.24, h * 0.24); g.lineTo(w * 0.76, h * 0.76); g.moveTo(w * 0.76, h * 0.24); g.lineTo(w * 0.24, h * 0.76); g.stroke();
    fit(g, 'R', w * 0.25, h / 2, 26, 30, { color: '#1a1a1a' });
    fit(g, 'R', w * 0.75, h / 2, 26, 30, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.5);
  },
  hc_rrname(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    fit(g, 'HOLLOW CREEK & WESTERN', w * 0.4, h * 0.5, w * 0.74, h * 0.55, { color: '#ece6d6', font: SERIF });
    fit(g, 'HC&W 54312', w * 0.89, h * 0.5, w * 0.2, h * 0.34, { color: '#ece6d6', font: COND });
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) { g.globalAlpha = r() * 0.5; g.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 2); }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  },
  hc_herald(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ece6d6'; g.lineWidth = 6;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, 6.3); g.stroke();
    fit(g, 'HC', w / 2, h * 0.42, w * 0.6, h * 0.36, { color: '#ece6d6', font: SERIF });
    fit(g, '& W', w / 2, h * 0.7, w * 0.4, h * 0.18, { color: '#ece6d6', font: SERIF });
    void r;
  },
  hc_placard(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4);
    g.fillStyle = '#d8281e'; g.fillRect(-42, -42, 84, 84);
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(-38, -38, 76, 76);
    g.restore();
    g.fillStyle = '#fff'; g.fillRect(w * 0.2, h * 0.42, w * 0.6, h * 0.18);
    fit(g, '1203', w / 2, h * 0.515, w * 0.5, h * 0.15, { color: '#1a1a1a' });
    void r;
  },
  hc_feed(g, w, h, r) {
    board(g, w, h, '#8a2a22', r, 3);
    raised(g, 'CREEK FEED & SEED', w / 2, h * 0.42, w * 0.9, h * 0.5, '#f0e6cc', '#3a100c', { font: SERIF });
    fit(g, 'FEED - FENCING - GRAIN - PROPANE', w / 2, h * 0.8, w * 0.8, h * 0.16, { color: '#f0d890', font: COND });
    weather(g, w, h, r, 0.9);
  },
  hc_diner(g, w, h, r) {
    // cream enamel with a red border; the name in script (neon tubes are 3D, the paint reads by day)
    g.fillStyle = '#efe6d0';
    rrect(g, 2, 2, w - 4, h - 4, 18); g.fill();
    g.strokeStyle = '#b3261e'; g.lineWidth = 7;
    rrect(g, 8, 8, w - 16, h - 16, 14); g.stroke();
    raised(g, 'Hollow Creek', w / 2, h * 0.38, w * 0.8, h * 0.44, '#b3261e', '#5a100c', { font: HAND, italic: true });
    fit(g, 'D I N E R', w / 2, h * 0.76, w * 0.5, h * 0.2, { color: '#1a4a6a' });
    weather(g, w, h, r, 0.5);
  },
  hc_eat(g, w, h, r) {
    g.fillStyle = '#b3261e'; g.fillRect(0, 0, w, h);
    fit(g, 'EAT', w / 2, h / 2 + 2, w * 0.8, h * 0.74, { color: '#fff4d8' });
    weather(g, w, h, r, 0.4);
  },
  hc_hardware(g, w, h, r) {
    g.fillStyle = '#1f3a5a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8c060'; g.fillRect(0, 6, w, 3); g.fillRect(0, h - 9, w, 3);
    raised(g, "MILLER'S HARDWARE", w / 2, h * 0.46, w * 0.84, h * 0.48, '#f0ead8', '#0a1420');
    fit(g, 'SINCE 1946  -  HONEST VALUE FOR THE VALLEY', w / 2, h * 0.8, w * 0.7, h * 0.13, { color: '#e8c060', font: COND });
    weather(g, w, h, r, 0.7);
  },
  hc_aisles(g, w, h, r) {
    const words = ['PAINT', 'PLUMBING', 'TOOLS', 'GARDEN'];
    words.forEach((t, i) => {
      g.fillStyle = ['#c62828', '#1a5aa0', '#e0a020', '#2f7a3a'][i];
      g.fillRect(i * (w / 4) + 2, 2, w / 4 - 4, h - 4);
      fit(g, t, i * (w / 4) + w / 8, h / 2, w / 4 - 16, h * 0.5, { color: '#fff' });
    });
    weather(g, w, h, r, 0.3);
  },
  hc_rexall(g, w, h, r) {
    g.fillStyle = '#f2eee4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a4a8a'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
    g.fillStyle = '#e06a1a';
    rrect(g, 16, 16, w * 0.46, h - 32, 10); g.fill();
    fit(g, 'Rexall', 16 + w * 0.23, h / 2, w * 0.4, h * 0.56, { color: '#fff', font: SERIF, italic: true });
    fit(g, 'DRUGS', w * 0.76, h / 2, w * 0.4, h * 0.56, { color: '#1a4a8a' });
    weather(g, w, h, r, 0.5);
  },
  hc_rx(g, w, h, r) {
    g.fillStyle = '#1a4a8a'; g.fillRect(0, 0, w, h);
    fit(g, 'Rx', 34, h / 2, 50, h * 0.7, { color: '#e06a1a', font: SERIF, italic: true });
    fit(g, 'PRESCRIPTIONS', w * 0.6, h / 2, w * 0.7, h * 0.4, { color: '#fff' });
    weather(g, w, h, r, 0.3);
  },
  hc_meds(g, w, h, r) {
    // a shelf of boxed medicine and bottles, half of it gone
    g.fillStyle = '#e8ecec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9aa2a6'; g.fillRect(0, h - 6, w, 6);
    let x = 3;
    while (x < w - 6) {
      const bw = 10 + r() * 12, bh = 20 + r() * 26;
      if (r() < 0.45) { x += bw + 3; continue; }
      g.fillStyle = ['#e8e8e8', '#2a6ab0', '#c62828', '#f0c020', '#3a9a5a', '#8a4ab0', '#f08a2a'][Math.floor(r() * 7)];
      if (r() < 0.3) { rrect(g, x, h - 6 - bh * 0.7, bw * 0.8, bh * 0.7, 3); g.fill(); g.fillStyle = '#fff'; g.fillRect(x + 1, h - 6 - bh * 0.72, bw * 0.8 - 2, 4); }
      else { g.fillRect(x, h - 6 - bh, bw, bh); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 2, h - 6 - bh * 0.7, bw - 4, bh * 0.25); }
      x += bw + 3;
    }
  },
  hc_bijou(g, w, h, r) {
    // the marquee's letterboard: CLOSED UNTIL FURTHER NOTICE in black letters on lit white
    g.fillStyle = '#f4f0e0'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += h / 3) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, w, 2); }
    fit(g, 'CLOSED UNTIL', w / 2, h * 0.2, w * 0.9, h * 0.26, { color: '#1a1a1a', font: COND });
    fit(g, 'FURTHER NOTICE', w / 2, h * 0.52, w * 0.9, h * 0.26, { color: '#1a1a1a', font: COND });
    fit(g, 'GOD BLESS HOLLOW CREEK', w / 2, h * 0.84, w * 0.9, h * 0.22, { color: '#8a1a1a', font: COND });
    weather(g, w, h, r, 0.4);
  },
  hc_bijouv(g, w, h, r) {
    g.fillStyle = '#8a1a1a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8c060'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    'BIJOU'.split('').forEach((c, i) => fit(g, c, w / 2, 44 + i * 72, w * 0.7, 62, { color: '#f4e8c8' }));
    weather(g, w, h, r, 0.5);
  },
  hc_movie1(g, w, h, r) { poster(g, w, h, r, 'NOW SHOWING', '#6a1a6a', 'THE LONG HARVEST', 'FRI - SAT 7PM'); },
  hc_movie2(g, w, h, r) { poster(g, w, h, r, 'COMING SOON', '#1a3a6a', 'RIVER OF STARS', 'MATINEE SUN'); },
  hc_post(g, w, h, r) {
    g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, w, h);
    raised(g, 'UNITED STATES POST OFFICE', w / 2, h * 0.4, w * 0.9, h * 0.34, '#1a2a4a', '#8a8478', { font: SERIF });
    fit(g, 'HOLLOW CREEK  -  65409', w / 2, h * 0.76, w * 0.5, h * 0.2, { color: '#1a2a4a', font: SERIF });
    weather(g, w, h, r, 0.6);
  },
  hc_bank(g, w, h, r) {
    g.fillStyle = '#cfc6b2'; g.fillRect(0, 0, w, h);
    fit(g, 'FIRST NATIONAL BANK', w / 2 + 1.5, h * 0.44 + 1.5, w * 0.92, h * 0.46, { color: '#8a826e', font: SERIF });
    fit(g, 'FIRST NATIONAL BANK', w / 2, h * 0.44, w * 0.92, h * 0.46, { color: '#3a3428', font: SERIF });
    fit(g, 'OF HOLLOW CREEK  -  MEMBER FDIC', w / 2, h * 0.82, w * 0.6, h * 0.16, { color: '#3a3428', font: SERIF });
    weather(g, w, h, r, 0.7);
  },
  hc_laundry(g, w, h, r) {
    g.fillStyle = '#2a8a9a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2; g.beginPath(); g.arc(r() * w, r() * h, 4 + r() * 8, 0, 6.3); g.stroke(); }
    raised(g, 'SPIN CYCLE  COIN LAUNDRY', w / 2, h * 0.5, w * 0.9, h * 0.5, '#fff', '#0a3a44');
    weather(g, w, h, r, 0.6);
  },
  hc_stanne(g, w, h, r) {
    // the church's roadside board: a cream frame on a brick sign, changeable letters under glass
    g.fillStyle = '#efe8d6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a1a1a'; g.fillRect(0, 0, w, 48);
    fit(g, "ST. ANNE'S", w / 2, 18, w * 0.8, 24, { color: '#f4e8c8', font: SERIF });
    fit(g, 'CATHOLIC CHURCH  -  EST. 1889', w / 2, 39, w * 0.84, 11, { color: '#e8c060', font: SERIF });
    g.fillStyle = '#1a1a1a';
    g.fillRect(12, 56, w - 24, h - 68);
    const lines = ['MASS SUNDAY 9 AM', 'ALL ARE WELCOME', 'PRAY FOR US'];
    lines.forEach((t, i) => fit(g, t, w / 2, 78 + i * 36, w * 0.84, 22, { color: i === 2 ? '#f0d060' : '#f0f0e8', font: COND }));
    weather(g, w, h, r, 0.6);
  },
  hc_glass1(g, w, h, r) { lancet(g, w, h, r, ['#1a3a8a', '#2a5ab0', '#8a1a2a', '#c8a020', '#1a6a4a', '#3a2a7a']); },
  hc_glass2(g, w, h, r) { lancet(g, w, h, r, ['#8a1a2a', '#b02a2a', '#c8a020', '#2a5ab0', '#6a2a8a', '#e0c060']); },
  hc_glass3(g, w, h, r) { lancet(g, w, h, r, ['#1a6a4a', '#2a8a5a', '#c8a020', '#1a3a8a', '#e06a1a', '#3a2a7a']); },
  hc_rose(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = w / 2 - 6;
    const hues = ['#1a3a8a', '#8a1a2a', '#c8a020', '#1a6a4a', '#6a2a8a', '#2a5ab0'];
    for (let ring = 3; ring >= 1; ring--) {
      const n = ring * 8;
      for (let k = 0; k < n; k++) {
        g.fillStyle = hues[(k + ring) % hues.length];
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, (R * ring) / 3, (k / n) * 6.283, ((k + 1) / n) * 6.283); g.closePath(); g.fill();
      }
    }
    g.fillStyle = '#e8c860'; g.beginPath(); g.arc(cx, cy, R * 0.18, 0, 6.3); g.fill();
    g.strokeStyle = '#1a1614'; g.lineWidth = 3;
    for (let ring = 1; ring <= 3; ring++) { g.beginPath(); g.arc(cx, cy, (R * ring) / 3, 0, 6.3); g.stroke(); }
    for (let k = 0; k < 24; k++) { const a = (k / 24) * 6.283; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.18, cy + Math.sin(a) * R * 0.18); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); }
    g.lineWidth = 8; g.strokeStyle = '#2a2420'; g.beginPath(); g.arc(cx, cy, R, 0, 6.3); g.stroke();
    void r;
  },
  hc_school(g, w, h, r) {
    // the brick monument sign: the name on a cream panel, the letterboard under it
    g.fillStyle = '#efe8d6'; g.fillRect(0, 0, w, 88);
    raised(g, 'HOLLOW CREEK ELEMENTARY', w / 2, 34, w * 0.9, 34, '#1a3a6a', '#8a8478', { font: SERIF });
    fit(g, 'HOME OF THE HORNETS', w / 2, 70, w * 0.5, 18, { color: '#c89a10', font: SERIF });
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 92, w, h - 92);
    fit(g, 'SHELTER FULL', w / 2, 118, w * 0.8, 30, { color: '#f0f0e8', font: COND });
    fit(g, 'GO WEST - POLICE STATION', w / 2, 162, w * 0.9, 30, { color: '#f0d060', font: COND });
    weather(g, w, h, r, 0.5);
  },
  hc_hornet(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#1a3a6a'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 6.3); g.fill();
    g.fillStyle = '#e8b820'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 16, 0, 6.3); g.fill();
    // the hornet: striped body, wings, a scowl
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.ellipse(w / 2, h * 0.55, 40, 60, -0.3, 0, 6.3); g.fill();
    g.fillStyle = '#e8b820'; for (let k = 0; k < 3; k++) { g.save(); g.translate(w / 2, h * 0.55); g.rotate(-0.3); g.fillRect(-40, -20 + k * 26, 80, 11); g.restore(); }
    g.fillStyle = 'rgba(230,240,255,0.85)'; g.beginPath(); g.ellipse(w * 0.33, h * 0.36, 34, 16, -0.6, 0, 6.3); g.ellipse(w * 0.66, h * 0.33, 34, 16, 0.5, 0, 6.3); g.fill();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(w * 0.56, h * 0.3, 24, 0, 6.3); g.fill();
    g.fillStyle = '#fff'; g.fillRect(w * 0.5, h * 0.27, 10, 5); g.fillRect(w * 0.58, h * 0.27, 10, 5);
    fit(g, 'HORNETS', w / 2, h * 0.88, w * 0.6, 24, { color: '#1a3a6a' });
    void r;
  },
  hc_chalk(g, w, h, r) {
    g.fillStyle = '#2a3a30'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 40 + r() * 120, 8 + r() * 30); }
    const chalk = (t, x, y, s, c = '#e8e8e0', o = {}) => fit(g, t, x, y, w * 0.9, s, { color: c, font: HAND, align: 'left', weight: 'normal', ...o });
    chalk('Tuesday, September 14', 20, 26, 22);
    chalk('Spelling:  harvest  bridge  family  quiet', 20, 62, 18);
    chalk('Homework: page 42 (all)', 20, 94, 18);
    chalk('STAY INSIDE', 250, 150, 40, '#f0a0a0', { weight: 'bold' });
    chalk("Mrs. Park went for help - wait for her", 30, 200, 20, '#f0e080');
    chalk('she did not come back', 250, 232, 18, '#e8e8e0');
    g.fillStyle = '#8a6a48'; g.fillRect(0, h - 6, w, 6);
  },
  hc_kids(g, w, h, r) {
    // three crayon drawings taped up: a house and sun, a family, a school bus
    for (let k = 0; k < 3; k++) {
      const x = 4 + k * 84, y = 6 + (k % 2) * 8;
      g.fillStyle = '#f4f0e6'; g.fillRect(x, y, 78, 108);
      g.lineWidth = 3; g.lineCap = 'round';
      if (k === 0) {
        g.strokeStyle = '#d83a2a'; g.strokeRect(x + 18, y + 50, 40, 36); g.beginPath(); g.moveTo(x + 14, y + 52); g.lineTo(x + 38, y + 30); g.lineTo(x + 62, y + 52); g.stroke();
        g.strokeStyle = '#f0c020'; g.beginPath(); g.arc(x + 62, y + 18, 8, 0, 6.3); g.stroke();
      } else if (k === 1) {
        g.strokeStyle = '#2a5ab0';
        for (let p = 0; p < 4; p++) { const px = x + 14 + p * 16, s = p < 2 ? 1 : 0.7; g.beginPath(); g.arc(px, y + 40 + (1 - s) * 20, 5 * s, 0, 6.3); g.moveTo(px, y + 45 + (1 - s) * 20); g.lineTo(px, y + 70); g.moveTo(px - 7, y + 55); g.lineTo(px + 7, y + 55); g.moveTo(px, y + 70); g.lineTo(px - 5, y + 84); g.moveTo(px, y + 70); g.lineTo(px + 5, y + 84); g.stroke(); }
        g.strokeStyle = '#3a9a3a'; g.beginPath(); g.moveTo(x + 4, y + 88); g.lineTo(x + 74, y + 88); g.stroke();
      } else {
        g.fillStyle = '#f0b020'; g.fillRect(x + 8, y + 48, 62, 28);
        g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x + 22, y + 78, 6, 0, 6.3); g.arc(x + 56, y + 78, 6, 0, 6.3); g.fill();
        g.fillStyle = '#8ac0f0'; for (let q = 0; q < 4; q++) g.fillRect(x + 12 + q * 14, y + 52, 10, 9);
      }
      g.fillStyle = 'rgba(220,210,170,0.7)'; g.fillRect(x + 30, y - 2, 18, 7);
      fit(g, ['Emma', 'Noah', 'Lily'][k], x + 39, y + 100, 60, 11, { color: '#3a3a3a', font: HAND, weight: 'normal' });
    }
    void r;
  },
  hc_abc(g, w, h, r) {
    g.fillStyle = '#f4f0e6'; g.fillRect(0, 0, w, h);
    const s = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm';
    fit(g, s, w / 2, h / 2, w * 0.96, h * 0.6, { color: '#2a5ab0', font: SERIF, weight: 'normal' });
    g.fillStyle = '#c62828'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
    void r;
  },
  hc_police(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    raised(g, 'HOLLOW CREEK POLICE', w / 2, h * 0.38, w * 0.94, h * 0.44, '#d8d4c8', '#2a2a2a', { font: SERIF });
    fit(g, 'DEPARTMENT', w / 2, h * 0.8, w * 0.4, h * 0.22, { color: '#d8d4c8', font: SERIF });
    void r;
  },
  hc_cruiser(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    fit(g, 'POLICE', w * 0.4, h * 0.44, w * 0.6, h * 0.66, { color: '#f0f0f0', stroke: '#1a3a6a', strokeW: 2 });
    fit(g, 'HOLLOW CREEK', w * 0.4, h * 0.88, w * 0.5, h * 0.2, { color: '#e8c060', font: COND });
    fit(g, '911', w * 0.86, h * 0.5, w * 0.2, h * 0.5, { color: '#f0f0f0' });
    void r;
  },
  hc_badge(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#d8b040';
    g.beginPath();
    for (let k = 0; k < 14; k++) { const a = -Math.PI / 2 + (k / 14) * 6.283, rr = k % 2 ? 36 : 58; g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); }
    g.closePath(); g.fill();
    g.fillStyle = '#1a3a6a'; g.beginPath(); g.arc(w / 2, h / 2, 28, 0, 6.3); g.fill();
    fit(g, 'HCPD', w / 2, h / 2, 44, 16, { color: '#e8c860' });
    void r;
  },
  hc_wanted(g, w, h, r) {
    // the station's cork board: notices, a map with pins, mugshots, a shift roster
    g.fillStyle = '#a8804a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,40,20' : '200,170,120'},0.3)`; g.fillRect(r() * w, r() * h, 2, 2); }
    const sheet = (x, y, sw, sh, c = '#f0ece0', rot = 0) => { g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c; g.fillRect(-sw / 2, -sh / 2, sw, sh); g.fillStyle = '#c62828'; g.beginPath(); g.arc(0, -sh / 2 + 4, 3, 0, 6.3); g.fill(); g.restore(); };
    sheet(46, 50, 70, 84, '#f0ece0', -0.05);
    fit(g, 'WANTED', 46, 20, 60, 12, { color: '#c62828' });
    g.fillStyle = '#6a6a66'; g.fillRect(24, 30, 44, 40);
    sheet(128, 48, 80, 70, '#e8e4d0', 0.04);
    g.fillStyle = '#7aa0c0'; g.fillRect(96, 22, 64, 48);
    g.strokeStyle = '#f0f0e0'; g.lineWidth = 2; g.beginPath(); g.moveTo(96, 50); g.lineTo(160, 40); g.moveTo(120, 22); g.lineTo(126, 70); g.stroke();
    for (let k = 0; k < 6; k++) { g.fillStyle = k < 4 ? '#c62828' : '#2a5ab0'; g.beginPath(); g.arc(104 + r() * 50, 28 + r() * 36, 3, 0, 6.3); g.fill(); }
    sheet(210, 60, 70, 100, '#f0ece0', 0.02);
    for (let l = 0; l < 10; l++) { g.fillStyle = 'rgba(30,30,40,0.6)'; g.fillRect(182, 22 + l * 8, 40 + r() * 14, 2); }
    sheet(70, 148, 110, 70, '#f2e08a', -0.03);
    fit(g, 'ROSTER', 70, 124, 60, 11, { color: '#1a1a1a' });
    for (let l = 0; l < 5; l++) { g.fillStyle = 'rgba(30,30,40,0.6)'; g.fillRect(24, 136 + l * 9, 80, 2); g.fillStyle = 'rgba(200,30,30,0.8)'; if (l > 1) g.fillRect(24, 137 + l * 9, 80, 1.4); }
    sheet(190, 150, 90, 60, '#f0ece0', 0.06);
    fit(g, 'ALL UNITS', 190, 132, 70, 12, { color: '#1a1a1a' });
    fit(g, 'HOLD THE STATION', 190, 150, 80, 10, { color: '#c62828' });
    weather(g, w, h, r, 0.4);
  },
  hc_sally(g, w, h, r) {
    g.fillStyle = '#f0eee6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c62828'; g.fillRect(0, 0, w, 34);
    fit(g, 'SALLY PORT', w / 2, 18, w * 0.8, 24, { color: '#fff' });
    fit(g, 'AUTHORIZED VEHICLES ONLY', w / 2, 52, w * 0.9, 14, { color: '#1a1a1a', font: COND });
    fit(g, 'NO WEAPONS BEYOND THIS POINT', w / 2, 74, w * 0.9, 12, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 0.5);
  },
  hc_banner(g, w, h, r) {
    g.fillStyle = '#f0e8d0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c86a1a'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    fit(g, 'HOLLOW CREEK HARVEST FESTIVAL  -  SEPT 18-20', w / 2, h / 2, w * 0.94, h * 0.5, { color: '#7a2a12', font: SERIF });
    weather(g, w, h, r, 0.5);
  },
  hc_plaque(g, w, h, r) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#6a5028'); gr.addColorStop(0.5, '#8a6a34'); gr.addColorStop(1, '#5a4020');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8a860'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    fit(g, 'IN HONOR OF', w / 2, 22, w * 0.6, 12, { color: '#e8d090', font: SERIF });
    fit(g, 'THOSE WHO SERVED', w / 2, 40, w * 0.8, 16, { color: '#e8d090', font: SERIF });
    for (let l = 0; l < 7; l++) { g.fillStyle = 'rgba(232,208,144,0.7)'; g.fillRect(30, 58 + l * 9, 80 + r() * 10, 2); g.fillRect(140, 58 + l * 9, 70 + r() * 10, 2); }
  },
  hc_closed(g, w, h, r) {
    board(g, w, h, '#b9955a', r, 4);
    paint(g, 'TOWN CLOSED', w / 2, h * 0.3, w * 0.9, h * 0.3, '#c62828', r);
    paint(g, 'TURN BACK', w / 2, h * 0.62, w * 0.7, h * 0.24, '#1a1a1a', r);
    paint(g, 'infected shot on sight', w / 2, h * 0.86, w * 0.7, h * 0.12, '#1a1a1a', r, { drips: 0 });
    weather(g, w, h, r, 0.7);
  },
  hc_church_graf(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'SAFE AT CHURCH ->', w / 2, h / 2, w * 0.92, h * 0.5, '#3a8ae8', r); },
  hc_school_graf(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'NOT SAFE', w / 2, h / 2, w * 0.8, h * 0.6, '#d8281e', r); },
  hc_menu(g, w, h, r) {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a6a48'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    fit(g, 'TODAY', w / 2, 24, w * 0.5, 18, { color: '#f0d060' });
    const items = [['MEATLOAF', '6.95'], ['CHICKEN FRIED STEAK', '7.50'], ['PATTY MELT', '5.25'], ['PIE (ASK)', '2.50'], ['COFFEE', '.75']];
    items.forEach(([n, p], i) => { fit(g, n, 22, 54 + i * 26, w * 0.6, 14, { color: '#f0f0e8', font: COND, align: 'left' }); fit(g, p, w - 22, 54 + i * 26, 50, 14, { color: '#f0f0e8', font: COND, align: 'right' }); });
    weather(g, w, h, r, 0.3);
  },
  hc_flag(g, w, h, r) {
    for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#f2f0ea' : '#b3261e'; g.fillRect(0, (k * h) / 13, w, h / 13 + 1); }
    g.fillStyle = '#1a2a5a'; g.fillRect(0, 0, w * 0.42, h * 0.54);
    g.fillStyle = '#f2f0ea';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) { g.beginPath(); g.arc(8 + i * 13 + (j % 2) * 6, 7 + j * 13, 2.2, 0, 6.3); g.fill(); }
    weather(g, w, h, r, 0.4);
  },
  hc_speed(g, w, h, r) {
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4; rrect(g, 6, 6, w - 12, h - 12, 8); g.stroke();
    fit(g, 'SPEED', w / 2, 30, w * 0.7, 22, { color: '#1a1a1a' });
    fit(g, 'LIMIT', w / 2, 56, w * 0.7, 22, { color: '#1a1a1a' });
    fit(g, '25', w / 2, 110, w * 0.7, 60, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.5);
  },
  hc_hymns(g, w, h, r) {
    // the hymn board: numbers in slots
    g.fillStyle = '#5a3a22'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8a060'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    ['112', '47', '305', '19'].forEach((t, i) => { g.fillStyle = '#1a1410'; g.fillRect(16, 20 + i * 42, w - 32, 32); fit(g, t, w / 2, 37 + i * 42, w * 0.6, 26, { color: '#f0e8d0', font: SERIF }); });
    weather(g, w, h, r, 0.4);
  },
  hc_notice2(g, w, h, r) { poster(g, w, h, r, 'SHELTER', '#2f6a3a', "ST. ANNE'S HALL", 'COTS - WATER - FOOD'); },
  hc_stand(g, w, h, r) {
    board(g, w, h, '#e8e0cc', r, 2);
    paint(g, 'FRESH PIES - SWEET CORN', w / 2, h * 0.4, w * 0.9, h * 0.42, '#7a2418', r, { drips: 0 });
    paint(g, 'honor box - thank you', w / 2, h * 0.8, w * 0.6, h * 0.2, '#2a2a2a', r, { drips: 0 });
    weather(g, w, h, r, 0.7);
  },
  hc_sale(g, w, h, r) {
    g.fillStyle = '#f0d020'; g.fillRect(0, 0, w, h);
    fit(g, 'SALE  -  ALL PAINT 20% OFF', w / 2, h / 2, w * 0.9, h * 0.5, { color: '#c62828' });
    void r;
  },
};

// the flag and the hand-painted CLOSED board are the other levels' too (Blackpine's flagpole, its gates)
const COMMON = ['hc_flag', 'hc_closed'];
addCells(Object.fromEntries(Object.entries(SIZES).filter(([k]) => !COMMON.includes(k))), PAINT, 'hollowcreek');
addCells(Object.fromEntries(COMMON.map((k) => [k, SIZES[k]])), {}, null);
void [HAND, FONT];
