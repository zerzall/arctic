// Blackpine's pictures in the level atlas (millroad-atlas.js holds the sheet; these cells join it while the
// forest is the level): routed state-forest signs, the trail map, the campground's boards and site numbers,
// the ranger station's map and radio, HARLAN LUMBER, the farm's painted board, notices, and the alpha-cut
// pictures of the forest floor (ferns, a moss patch).

import { addCells, PAINTERS } from './millroad-atlas.js';

const { fit, rrect, weather, board, paint, spray, poster, FONT, COND, HAND, SERIF } = PAINTERS;

const SIZES = {
  bp_forest: [512, 192], bp_camp: [512, 128], bp_trailmap: [512, 320], bp_trailsign: [256, 128], bp_rules: [128, 192], bp_danger: [256, 192],
  bp_bear: [128, 160], bp_sitenums: [640, 64], bp_host: [256, 64], bp_men: [128, 48], bp_women: [128, 48], bp_ranger: [512, 128],
  bp_topo: [256, 192], bp_radio: [256, 96], bp_harlan: [512, 128], bp_trespass: [256, 128], bp_gorge: [256, 128], bp_farm: [256, 160],
  bp_missing: [128, 192], bp_rv: [512, 64], bp_fern1: [256, 256], bp_fern2: [256, 256], bp_moss: [256, 128], bp_needles: [256, 256],
  bp_heli: [256, 256], bp_burnsign: [256, 96], bp_graf: [256, 96], bp_tally: [256, 128], bp_logends: [256, 128],
};

/** Routed letters in a timber sign: a dark groove, the paint inside it. */
function routed(g, str, cx, cy, w, h, color, o = {}) {
  fit(g, str, cx + 1.4, cy + 1.6, w, h, { ...o, color: 'rgba(20,10,4,0.75)' });
  fit(g, str, cx, cy, w, h, { ...o, color });
}

/** A fern frond picture (alpha-cut): a curved rachis with paired leaflets. */
function fern(g, w, h, r, dry) {
  g.clearRect(0, 0, w, h);
  for (let f = 0; f < 5; f++) {
    const base = [w / 2 + (r() - 0.5) * 20, h - 4];
    const ang = -Math.PI / 2 + (f - 2) * 0.42 + (r() - 0.5) * 0.2;
    const len = h * (0.7 + r() * 0.25);
    const bend = (f - 2) * 0.16;
    const col = dry ? [150 + r() * 40, 130 + r() * 30, 60] : [50 + r() * 30, 100 + r() * 40, 40 + r() * 20];
    g.strokeStyle = `rgb(${col[0] * 0.8},${col[1] * 0.8},${col[2]})`;
    g.lineWidth = 2.4;
    let px = base[0], py = base[1], a = ang;
    const step = len / 18;
    for (let k = 0; k < 18; k++) {
      const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      const t = k / 18, ll = (1 - Math.abs(t - 0.35) * 1.3) * 26 + 4;
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      for (const s of [-1, 1]) {
        const la = a + s * 1.2;
        g.beginPath();
        g.moveTo(nx, ny);
        g.quadraticCurveTo(nx + Math.cos(la - s * 0.3) * ll * 0.6, ny + Math.sin(la - s * 0.3) * ll * 0.6, nx + Math.cos(la) * ll, ny + Math.sin(la) * ll + 4);
        g.quadraticCurveTo(nx + Math.cos(la + s * 0.2) * ll * 0.5, ny + Math.sin(la + s * 0.2) * ll * 0.5 + 3, nx, ny + 2);
        g.fill();
      }
      px = nx; py = ny; a += bend * 0.12;
    }
  }
}

const PAINT = {
  bp_forest(g, w, h, r) {
    // the state forest's entrance sign: routed yellow letters in brown-stained timber
    board(g, w, h, '#5a3a22', r, 5);
    g.strokeStyle = '#d8b040'; g.lineWidth = 5;
    rrect(g, 10, 10, w - 20, h - 20, 10); g.stroke();
    routed(g, 'BLACKPINE', w / 2, h * 0.34, w * 0.8, h * 0.3, '#e8c450', { font: SERIF });
    routed(g, 'STATE FOREST', w / 2, h * 0.62, w * 0.6, h * 0.17, '#e8c450', { font: SERIF });
    routed(g, 'CAMPGROUND 1 MI  -  LOOKOUT 2 MI', w / 2, h * 0.84, w * 0.8, h * 0.1, '#e8c450', { font: COND });
    weather(g, w, h, r, 0.8);
  },
  bp_camp(g, w, h, r) {
    board(g, w, h, '#5a3a22', r, 3);
    routed(g, 'BLACKPINE CAMPGROUND', w / 2, h * 0.42, w * 0.88, h * 0.42, '#e8c450', { font: SERIF });
    routed(g, 'CHECK IN AT HOST  -  QUIET HOURS 10PM-6AM', w / 2, h * 0.8, w * 0.8, h * 0.15, '#e8c450', { font: COND });
    weather(g, w, h, r, 0.9);
  },
  bp_trailmap(g, w, h, r) {
    // the trailhead's map: green forest, blue river, trails in dashes, YOU ARE HERE, a legend
    g.fillStyle = '#e8e2cc'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a4a2e'; g.fillRect(0, 0, w, 40);
    fit(g, 'BLACKPINE STATE FOREST  -  TRAILS', w / 2, 21, w * 0.9, 24, { color: '#f0e8c8', font: SERIF });
    g.fillStyle = '#a8c098'; g.fillRect(16, 52, w - 140, h - 68);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(40,80,40,${0.15 + r() * 0.2})`; g.beginPath(); g.arc(16 + r() * (w - 140), 52 + r() * (h - 68), 3 + r() * 6, 0, 6.3); g.fill(); }
    g.strokeStyle = '#3a7ab8'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(260, 52); g.bezierCurveTo(240, 140, 300, 200, 270, h - 16); g.stroke();
    g.strokeStyle = '#8a2a1a'; g.lineWidth = 3; g.setLineDash([8, 6]);
    g.beginPath(); g.moveTo(40, 230); g.lineTo(110, 220); g.lineTo(170, 150); g.lineTo(230, 170); g.lineTo(300, 150); g.lineTo(350, 110); g.stroke();
    g.setLineDash([]);
    for (const [x, y, t] of [[110, 220, 'CAMP'], [170, 150, 'RANGER'], [265, 160, 'BRIDGE'], [350, 110, 'MILL']]) { g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x, y, 4, 0, 6.3); g.fill(); fit(g, t, x, y - 12, 60, 11, { color: '#1a1a1a' }); }
    g.fillStyle = '#c62828'; g.beginPath(); g.arc(40, 230, 7, 0, 6.3); g.fill();
    fit(g, 'YOU ARE HERE', 60, 252, 90, 11, { color: '#c62828' });
    g.fillStyle = '#c62828'; g.fillRect(150, 140, 40, 4);
    fit(g, 'CLOSED', 280, 220, 60, 12, { color: '#c62828' });
    const lx = w - 116;
    fit(g, 'LEGEND', lx + 50, 64, 90, 14, { color: '#2a4a2e' });
    ['TRAIL', 'ROAD', 'WATER', 'SHELTER'].forEach((t, i) => { g.fillStyle = ['#8a2a1a', '#6a6a6a', '#3a7ab8', '#2a4a2e'][i]; g.fillRect(lx, 86 + i * 24, 18, 10); fit(g, t, lx + 60, 91 + i * 24, 70, 11, { color: '#1a1a1a', align: 'center', font: COND }); });
    weather(g, w, h, r, 0.6);
  },
  bp_trailsign(g, w, h, r) {
    board(g, w, h, '#5a3a22', r, 3);
    routed(g, 'CAMPGROUND  ->', w / 2, h * 0.2, w * 0.86, h * 0.2, '#e8c450', { font: COND });
    routed(g, 'LOOKOUT  2', w / 2, h * 0.5, w * 0.86, h * 0.2, '#e8c450', { font: COND });
    routed(g, "CUTTER'S GORGE  3", w / 2, h * 0.8, w * 0.86, h * 0.2, '#e8c450', { font: COND });
    weather(g, w, h, r, 0.8);
  },
  bp_rules(g, w, h, r) {
    g.fillStyle = '#f0ecdc'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a4a2e'; g.fillRect(0, 0, w, 28);
    fit(g, 'CAMP RULES', w / 2, 15, w * 0.86, 18, { color: '#fff' });
    ['FIRES IN RINGS ONLY', 'STORE FOOD IN BOXES', 'PETS ON LEASH', 'CHECK OUT BY NOON', 'PACK IT OUT'].forEach((t, i) => fit(g, t, w / 2, 46 + i * 26, w * 0.86, 12, { color: '#1a1a1a', font: COND }));
    weather(g, w, h, r, 0.8);
  },
  bp_danger(g, w, h, r) {
    // a fire danger dial: a half-disc of bands, the arrow at EXTREME
    board(g, w, h, '#5a3a22', r, 3);
    fit(g, 'FIRE DANGER TODAY', w / 2, 22, w * 0.86, 20, { color: '#e8c450', font: SERIF });
    const cx = w / 2, cy = h - 24, R = 110;
    const bands = [['#2e8a3a', 'LOW'], ['#2a5ab0', 'MOD'], ['#e8c020', 'HIGH'], ['#e86a1a', 'V.HIGH'], ['#c62828', 'EXTREME']];
    bands.forEach(([c, t], i) => {
      const a0 = Math.PI + (i / 5) * Math.PI, a1 = Math.PI + ((i + 1) / 5) * Math.PI;
      g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
      const am = (a0 + a1) / 2;
      fit(g, t, cx + Math.cos(am) * R * 0.7, cy + Math.sin(am) * R * 0.7, 40, 11, { color: '#fff', font: COND });
    });
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(-0.35) * R * 0.9, cy + Math.sin(-0.35) * R * 0.9); g.stroke();
    weather(g, w, h, r, 0.7);
  },
  bp_bear(g, w, h, r) {
    g.fillStyle = '#f0d020'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
    fit(g, 'BEAR', w / 2, 26, w * 0.7, 24, { color: '#1a1a1a' });
    fit(g, 'COUNTRY', w / 2, 50, w * 0.8, 16, { color: '#1a1a1a' });
    g.fillStyle = '#1a1a1a';
    g.beginPath(); g.ellipse(w / 2, 104, 34, 20, 0, 0, 6.3); g.fill();
    g.beginPath(); g.arc(w / 2 + 34, 92, 12, 0, 6.3); g.fill();
    for (const x of [-22, -8, 12, 26]) g.fillRect(w / 2 + x, 110, 7, 18);
    fit(g, 'STORE FOOD SAFELY', w / 2, h - 16, w * 0.86, 11, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 0.5);
  },
  bp_sitenums(g, w, h, r) {
    // site numbers 1-10, each in its own 64-pixel slot (lvSub picks one)
    for (let k = 0; k < 10; k++) {
      g.fillStyle = '#5a3a22'; g.fillRect(k * 64 + 2, 2, 60, h - 4);
      routed(g, String(k + 1), k * 64 + 32, h / 2, 50, h * 0.66, '#e8c450', { font: SERIF });
    }
    void r;
  },
  bp_host(g, w, h, r) {
    board(g, w, h, '#2a4a2e', r, 1);
    routed(g, 'CAMP HOST', w / 2, h / 2, w * 0.8, h * 0.6, '#f0e8c8', { font: SERIF });
    weather(g, w, h, r, 0.6);
  },
  bp_men(g, w, h, r) { board(g, w, h, '#5a3a22', r, 1); routed(g, 'MEN', w / 2, h / 2, w * 0.6, h * 0.6, '#e8c450', { font: SERIF }); },
  bp_women(g, w, h, r) { board(g, w, h, '#5a3a22', r, 1); routed(g, 'WOMEN', w / 2, h / 2, w * 0.7, h * 0.6, '#e8c450', { font: SERIF }); },
  bp_ranger(g, w, h, r) {
    board(g, w, h, '#5a3a22', r, 3);
    g.fillStyle = '#e8c450';
    g.beginPath(); g.moveTo(54, 18); g.lineTo(26, 100); g.lineTo(82, 100); g.closePath(); g.fill();
    g.fillStyle = '#5a3a22'; g.fillRect(50, 96, 8, 14);
    routed(g, 'BLACKPINE RANGER STATION', w * 0.57, h * 0.4, w * 0.74, h * 0.34, '#e8c450', { font: SERIF });
    routed(g, 'STATE DEPARTMENT OF FORESTRY', w * 0.57, h * 0.76, w * 0.6, h * 0.14, '#e8c450', { font: COND });
    weather(g, w, h, r, 0.8);
  },
  bp_topo(g, w, h, r) {
    g.fillStyle = '#e8e4cc'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(140,90,40,${0.4 + (k % 5 === 0 ? 0.4 : 0)})`; g.lineWidth = k % 5 === 0 ? 1.6 : 0.8;
      g.beginPath();
      for (let a = 0; a <= 6.3; a += 0.2) { const rr = 10 + k * 7 + Math.sin(a * 3 + k) * 6; g.lineTo(w * 0.55 + Math.cos(a) * rr * 1.3, h * 0.5 + Math.sin(a) * rr); }
      g.stroke();
    }
    g.strokeStyle = '#3a7ab8'; g.lineWidth = 3; g.beginPath(); g.moveTo(w * 0.3, 0); g.bezierCurveTo(w * 0.25, h * 0.4, w * 0.35, h * 0.6, w * 0.28, h); g.stroke();
    for (let k = 0; k < 9; k++) { g.fillStyle = k < 6 ? '#c62828' : '#1a1a1a'; g.beginPath(); g.arc(20 + r() * (w - 40), 20 + r() * (h - 40), 4, 0, 6.3); g.fill(); }
    g.strokeStyle = '#c62828'; g.lineWidth = 2; g.beginPath(); g.arc(w * 0.3, h * 0.45, 22, 0, 6.3); g.stroke();
    fit(g, 'GONE', w * 0.3, h * 0.45 + 34, 60, 14, { color: '#c62828', font: HAND });
    weather(g, w, h, r, 0.4);
  },
  bp_radio(g, w, h, r) {
    g.fillStyle = '#2a2c2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0c2a14'; g.fillRect(14, 14, 110, 30);
    fit(g, '154.280 FIRE', 69, 29, 100, 16, { color: '#6aff8a', font: COND });
    for (let k = 0; k < 6; k++) { g.fillStyle = '#c8c4b8'; g.beginPath(); g.arc(150 + (k % 3) * 34, 26 + Math.floor(k / 3) * 36, 11, 0, 6.3); g.fill(); g.strokeStyle = '#1a1a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(150 + (k % 3) * 34, 26 + Math.floor(k / 3) * 36); g.lineTo(150 + (k % 3) * 34 + Math.cos(r() * 6) * 9, 26 + Math.floor(k / 3) * 36 + Math.sin(r() * 6) * 9); g.stroke(); }
    for (let k = 0; k < 8; k++) { g.fillStyle = k === 2 ? '#ff3a1a' : '#6a6a6a'; g.fillRect(16 + k * 13, 60, 9, 20); }
  },
  bp_harlan(g, w, h, r) {
    board(g, w, h, '#e8dcc0', r, 3);
    paint(g, 'HARLAN LUMBER CO.', w / 2, h * 0.38, w * 0.9, h * 0.42, '#6a1a12', r, { font: SERIF, drips: 0 });
    paint(g, 'SAWMILL  -  POLES  -  CEDAR  -  EST. 1931', w / 2, h * 0.78, w * 0.8, h * 0.15, '#2a2a2a', r, { font: SERIF, drips: 0 });
    weather(g, w, h, r, 1);
  },
  bp_trespass(g, w, h, r) {
    g.fillStyle = '#f0ece0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c62828'; g.fillRect(0, 0, w, 44);
    fit(g, 'NO TRESPASSING', w / 2, 23, w * 0.9, 30, { color: '#fff' });
    fit(g, 'HARD HATS REQUIRED', w / 2, 66, w * 0.9, 18, { color: '#1a1a1a', font: COND });
    fit(g, 'ALL VISITORS REPORT TO OFFICE', w / 2, 96, w * 0.9, 14, { color: '#1a1a1a', font: COND });
    weather(g, w, h, r, 0.7);
  },
  bp_gorge(g, w, h, r) {
    board(g, w, h, '#5a3a22', r, 3);
    routed(g, "CUTTER'S GORGE", w / 2, h * 0.3, w * 0.86, h * 0.26, '#e8c450', { font: SERIF });
    routed(g, 'FOOTBRIDGE - ONE AT A TIME', w / 2, h * 0.62, w * 0.86, h * 0.14, '#e8c450', { font: COND });
    routed(g, 'ROAD BRIDGE CLOSED', w / 2, h * 0.84, w * 0.7, h * 0.14, '#f0806a', { font: COND });
    weather(g, w, h, r, 0.8);
  },
  bp_farm(g, w, h, r) {
    board(g, w, h, '#e8e0cc', r, 4);
    paint(g, 'HARLAN FARM', w / 2, h * 0.22, w * 0.86, h * 0.22, '#1a1a1a', r);
    paint(g, 'WE ARE HERE', w / 2, h * 0.5, w * 0.8, h * 0.22, '#c62828', r);
    paint(g, 'HONK 3 TIMES - NO BITES', w / 2, h * 0.8, w * 0.86, h * 0.14, '#1a1a1a', r);
    weather(g, w, h, r, 0.7);
  },
  bp_missing(g, w, h, r) { poster(g, w, h, r, 'MISSING', '#c62828', 'HIKERS - 3 - LAST SEEN', 'NORTH LOOP 9/12'); },
  bp_rv(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(90,40,20,0)'); gr.addColorStop(0.2, '#8a3a1a'); gr.addColorStop(0.7, '#c8781a'); gr.addColorStop(1, '#e0a020');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, h * 0.7); g.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.1, w, h * 0.15); g.lineTo(w, h * 0.45); g.bezierCurveTo(w * 0.6, h * 0.4, w * 0.3, h * 0.9, 0, h * 0.95); g.fill();
    fit(g, 'Wanderer', w * 0.22, h * 0.36, w * 0.24, h * 0.5, { color: '#5a2a12', font: HAND, italic: true });
    void r;
  },
  bp_fern1(g, w, h, r) { fern(g, w, h, r, false); },
  bp_fern2(g, w, h, r) { fern(g, w, h, r, true); },
  bp_moss(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = w / 2 + (r() - 0.5) * w * 0.9 * r(), y = h / 2 + (r() - 0.5) * h * 0.8 * r();
      g.fillStyle = `rgba(${60 + r() * 40},${90 + r() * 50},${30 + r() * 20},${0.4 + r() * 0.5})`;
      g.beginPath(); g.arc(x, y, 2 + r() * 6, 0, 6.3); g.fill();
    }
  },
  bp_needles(g, w, h, r) {
    // a litter of pine needles and cones (alpha-cut, for the forest floor)
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const x = r() * w, y = r() * h, a = r() * 6.3, l = 6 + r() * 12;
      if (Math.hypot(x - w / 2, y - h / 2) > w * 0.48 * (0.6 + r() * 0.4)) continue;
      g.strokeStyle = `rgba(${110 + r() * 50},${70 + r() * 30},${30 + r() * 20},0.9)`;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 7; i++) { g.fillStyle = '#6a4424'; g.beginPath(); g.ellipse(w * 0.2 + r() * w * 0.6, h * 0.2 + r() * h * 0.6, 7, 12, r() * 3, 0, 6.3); g.fill(); }
  },
  bp_heli(g, w, h, r) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#f0ece0'; g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 12, 0, 6.3); g.stroke();
    g.fillStyle = '#f0ece0';
    g.fillRect(w * 0.3, h * 0.25, 22, h * 0.5); g.fillRect(w * 0.7 - 22, h * 0.25, 22, h * 0.5); g.fillRect(w * 0.3, h * 0.46, w * 0.4, 22);
    void r;
  },
  bp_burnsign(g, w, h, r) {
    g.fillStyle = '#f0d020'; g.fillRect(0, 0, w, h);
    fit(g, 'DANGER - HOT - KEEP CLEAR', w / 2, h / 2, w * 0.9, h * 0.4, { color: '#1a1a1a' });
    weather(g, w, h, r, 0.6);
  },
  bp_graf(g, w, h, r) { g.clearRect(0, 0, w, h); spray(g, 'FARM -> EAST', w / 2, h / 2, w * 0.9, h * 0.55, '#3aa0e8', r); },
  bp_logends(g, w, h, r) {
    // the cut ends of a log deck: pale discs with rings and checks, stacked, dark gaps between
    g.clearRect(0, 0, w, h);
    const rows = 4;
    for (let j = 0; j < rows; j++) {
      const rad = h / rows / 2 - 1;
      const n = Math.floor(w / (rad * 2));
      for (let i = 0; i < n - (j % 2); i++) {
        const cx = rad + i * rad * 2 + (j % 2) * rad, cy = h - rad - j * rad * 1.8;
        const rr = rad * (0.75 + r() * 0.25);
        g.fillStyle = '#4a3420'; g.beginPath(); g.arc(cx, cy, rr, 0, 6.3); g.fill();
        g.fillStyle = `rgb(${190 + r() * 30},${150 + r() * 25},${100 + r() * 20})`; g.beginPath(); g.arc(cx, cy, rr - 2, 0, 6.3); g.fill();
        g.strokeStyle = 'rgba(120,80,40,0.5)'; g.lineWidth = 1;
        for (let k = 1; k < 5; k++) { g.beginPath(); g.arc(cx + (r() - 0.5) * 2, cy + (r() - 0.5) * 2, (rr - 2) * (k / 5), 0, 6.3); g.stroke(); }
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (r() - 0.5) * rr * 1.6, cy + (r() - 0.5) * rr * 1.6); g.stroke();
      }
    }
  },
  bp_tally(g, w, h, r) {
    // a tally scratched on a board: days, five-bar gates, the last ones unfinished
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,20,10,0.9)'; g.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      const x0 = 14 + k * 40;
      for (let j = 0; j < (k === 5 ? 2 : 4); j++) { g.beginPath(); g.moveTo(x0 + j * 7, 30 + r() * 4); g.lineTo(x0 + j * 7 + (r() - 0.5) * 3, 80); g.stroke(); }
      if (k < 5) { g.beginPath(); g.moveTo(x0 - 4, 70); g.lineTo(x0 + 26, 40); g.stroke(); }
    }
    fit(g, 'DAY 28', w / 2, 108, w * 0.5, 18, { color: 'rgba(30,20,10,0.9)', font: HAND });
  },
};

addCells(SIZES, PAINT, 'forest');
void [FONT, spray];
