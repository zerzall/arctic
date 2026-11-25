// Buy menu lab: the real buy menu (js/ui/shop.js) over a stand-in scene, with a fake session
// (purchases are logged, not made) and a made-up player between waves. Query flags:
//   ?wave=N    the wave whose stock is on sale (default 3)
//   ?cash=N    the player's cash (default 6400)
//   ?sec=ID    open on a section (pistols, smgs, heavy, rifles, snipers, specials, gear)
//   ?touch=1   the touch layout (body.touch-ui)
// window.__shop is the menu (scripts/shop-shot.js presses keys at it).

import { createShop } from '../js/ui/shop.js';

const params = new URLSearchParams(location.search);
if (params.get('touch') === '1') document.body.classList.add('touch-ui');
const bought = [];
const shop = createShop(document.getElementById('shop-root'), {
  session: { buy: (id) => { bought.push(id); console.log('buy', id); } },
  audio: { ui: () => {} },
  map: { supply: { x: 0, y: 0 } },
});
const wave = Number(params.get('wave') || 3);
const view = { phase: 'intermission', wave: wave - 1, objective: { hp: 620, maxHp: 1000 }, turrets: [], barricades: [], players: [] };
const me = {
  id: 1, x: 0, y: 0, state: 'alive', hp: 78, maxHp: 100, armor: 25, cash: Number(params.get('cash') || 6400),
  slots: ['pistol', 'ak', null], slot: 1, ammo: [[12, -1], [30, 120], [0, 0]],
  frags: 1, molotovs: 0, turrets: 0, barricades: 0, selfRevive: false,
};
shop.update(view, me, 'soldier', 1);
shop.open(params.get('sec') || undefined);
setInterval(() => shop.update(view, me, 'soldier', 0.25), 250);
window.__shop = { shop, bought };
document.documentElement.dataset.ready = '1';
