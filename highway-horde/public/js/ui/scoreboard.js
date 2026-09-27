// Player stats tables: the live scoreboard (hold Tab) and the end-of-match table.

import { PLAYER_COLORS } from '../shared/constants.js';
import { CLASSES } from '../shared/classes.js';
import { h, formatCash, formatShort, setShown } from './dom.js';

const REFRESH = 0.25;

/**
 * Merge roster entries with their snapshot stats, best first.
 * @param {object|null} view Snapshot
 * @param {Array} roster session roster
 * @returns {Array<{id, name, color, cls, host, ping, state, kills, damage, revives, downs, cash, earned}>}
 */
export function statRows(view, roster) {
  const byId = new Map();
  for (const p of (view && view.players) || []) byId.set(p.id, p);
  const rows = [];
  for (const r of roster || []) {
    const p = byId.get(r.id);
    rows.push({
      id: r.id, name: r.name, color: r.color, cls: r.cls, host: !!r.host, ping: r.ping | 0,
      state: p ? p.state : 'dead',
      kills: p ? p.kills | 0 : 0,
      damage: p ? p.damage | 0 : 0,
      revives: p ? p.revives | 0 : 0,
      downs: p ? p.downs | 0 : 0,
      cash: p ? p.cash | 0 : 0,
      // `earned` is an extra snapshot field (total cash earned); fall back to cash in hand.
      earned: p ? (Number.isFinite(p.earned) ? p.earned : p.cash) | 0 : 0,
    });
  }
  rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage || a.id - b.id);
  return rows;
}

function nameCell(row, localId) {
  const kids = [
    h('span.sb-dot', { style: { background: PLAYER_COLORS[row.color] || '#fff' } }),
    h('span.sb-name', { text: row.name }),
  ];
  if (row.host) kids.push(h('span.sb-crown', { title: 'Host', 'aria-label': 'Host', text: '♛' }));
  if (row.id === localId) kids.push(h('span.sb-you', { text: 'YOU' }));
  return h('td.sb-player', null, kids);
}

function stateTag(state) {
  if (state === 'downed') return h('span.sb-state.down', { text: 'DOWN' });
  if (state === 'dead') return h('span.sb-state.dead', { text: 'DEAD' });
  return null;
}

/**
 * Fill a <table> with stat rows.
 * @param {HTMLTableElement} table
 * @param {Array} rows from statRows()
 * @param {number} localId
 * @param {{ ping?: boolean, final?: boolean }} [opts] final: the end screen (MVP badge,
 *   earned cash instead of cash in hand)
 */
export function fillStatsTable(table, rows, localId, opts = {}) {
  const head = ['Survivor', 'Class', 'Kills', 'Damage', 'Revives', 'Downs', opts.final ? 'Earned' : 'Cash'];
  if (opts.ping) head.push('Ping');
  const thead = h('thead', null, h('tr', null, head.map((t, i) => h(i < 2 ? 'th' : 'th.num', { scope: 'col', text: t }))));
  const tbody = h('tbody');
  const mvp = opts.final && rows.length > 1 && rows[0].kills > 0 ? rows[0].id : -1;
  for (const r of rows) {
    const c = CLASSES[r.cls];
    const tr = h('tr', { class: r.id === localId ? 'me' : null }, [
      nameCell(r, localId),
      h('td.sb-class', null, [c ? c.role : '', stateTag(opts.final ? 'alive' : r.state)]),
      h('td.num', null, [String(r.kills), r.id === mvp ? h('span.sb-mvp', { text: 'MVP' }) : null]),
      h('td.num', { text: formatShort(r.damage) }),
      h('td.num', { text: String(r.revives) }),
      h('td.num', { text: String(r.downs) }),
      h('td.num.money', { text: formatCash(opts.final ? r.earned : r.cash) }),
    ]);
    if (opts.ping) tr.appendChild(h('td.num.ping', { text: r.host ? 'host' : `${r.ping} ms` }));
    tbody.appendChild(tr);
  }
  table.replaceChildren(thead, tbody);
}

/**
 * The hold-Tab scoreboard overlay.
 * @param {HTMLElement} root container (the HUD)
 */
export function createScoreboard(root) {
  const title = h('div.sb-title', null, [h('span', { text: 'SCOREBOARD' }), h('span.sb-meta')]);
  const table = h('table.stats-table');
  const el = h('div.scoreboard.panel', { hidden: true, role: 'dialog', 'aria-label': 'Scoreboard' }, [title, table]);
  root.appendChild(el);
  let visible = false;
  let acc = REFRESH;
  return {
    el,
    get visible() {
      return visible;
    },
    setVisible(b) {
      if (visible === !!b) return;
      visible = !!b;
      setShown(el, visible);
      acc = REFRESH;
    },
    update(view, roster, localId, dt, meta) {
      if (!visible) return;
      acc += dt;
      if (acc < REFRESH) return;
      acc = 0;
      fillStatsTable(table, statRows(view, roster), localId, { ping: true });
      title.lastChild.textContent = meta || '';
    },
    destroy() {
      el.remove();
    },
  };
}
