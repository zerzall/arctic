// Browser harness for input.js (developer tooling, not part of the game): builds the game-screen skeleton of client/index.html, draws a
// stand-in arena with the centre-60% band marked, starts the real Input and prints its intent every frame.
//   window.__input  the Input      window.__seen  { bombs, specials, wheel, menu, mute, emotes[], maxD }
import { Input } from '/js/input.js';

const canvas = document.getElementById('arena');
const touchRoot = document.getElementById('touch');
const readout = document.getElementById('readout');
Object.assign(readout.style, { position: 'fixed', top: '4px', left: '4px', margin: 0, zIndex: 99, color: '#7CFC00', font: '12px/1.2 monospace', pointerEvents: 'none', textShadow: '0 0 3px #000' });

function drawArena() {
  const box = canvas.getBoundingClientRect();
  const dpr = 1;
  canvas.width = Math.max(1, Math.round(box.width * dpr));
  canvas.height = Math.max(1, Math.round(box.height * dpr));
  const g = canvas.getContext('2d');
  g.fillStyle = '#1b1440';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const tile = Math.floor(Math.min(canvas.width / 15, canvas.height / 13));
  const w = tile * 15;
  const h = tile * 13;
  const x0 = Math.floor((canvas.width - w) / 2);
  const y0 = canvas.height > canvas.width ? 0 : Math.floor((canvas.height - h) / 2);
  for (let ty = 0; ty < 13; ty++) {
    for (let tx = 0; tx < 15; tx++) {
      const wall = tx === 0 || ty === 0 || tx === 14 || ty === 12 || (tx % 2 === 0 && ty % 2 === 0);
      g.fillStyle = wall ? '#5a4d8f' : (tx + ty) % 2 ? '#2f7d4f' : '#348a57';
      g.fillRect(x0 + tx * tile, y0 + ty * tile, tile, tile);
    }
  }
  g.strokeStyle = 'rgba(255,220,0,.85)';                 // the centre 60 % of the play field: controls must not reach into it
  g.setLineDash([6, 4]);
  g.strokeRect(x0 + w * 0.2, y0, w * 0.6, h);
}

const input = new Input({ canvas, touchRoot });
window.__input = input;
const seen = { bombs: 0, specials: 0, wheel: 0, menu: 0, mute: 0, emotes: [], maxD: 0 };
window.__seen = seen;
input.onWheel(() => seen.wheel++);
input.onMenu(() => seen.menu++);
input.onMute(() => seen.mute++);
input.onEmote((n) => seen.emotes.push(n));
input.enableTouch(true);
input.setActive(true);
input.setHasGlove(new URLSearchParams(location.search).get('glove') !== '0');
if (new URLSearchParams(location.search).get('hand') === 'left') input.setHand('left');

let last = { d: 0 };
function frame() {
  const i = input.getIntent();
  if (i.bomb) seen.bombs++;
  if (i.special) seen.specials++;
  last = { d: i.d };
  readout.textContent = `d=${last.d} bombs=${seen.bombs} special=${seen.specials} wheel=${seen.wheel} ${innerWidth}x${innerHeight}`;
  requestAnimationFrame(frame);
}
new ResizeObserver(drawArena).observe(canvas);
drawArena();
frame();
