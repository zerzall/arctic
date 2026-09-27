// Menu screens and dialogs: title (profile, class picker, colour), join / connecting /
// error / confirm dialogs, settings and how-to-play. A tiny modal stack handles Esc,
// focus and restoring focus to whatever opened the dialog.

import { CLASSES, CLASS_IDS, perksFor } from '../shared/classes.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } from '../shared/constants.js';
import { $, $$, h } from './dom.js';
import { cleanName } from './storage.js';

// ---- modal stack ------------------------------------------------------------------------

/**
 * @returns {{ open: Function, close: Function, isOpen: Function, top: Function }}
 */
export function createModals() {
  const stack = [];

  function focusFirst(el) {
    const target = el.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), .btn-primary:not([disabled]), button:not([disabled])');
    if (target) target.focus({ preventScroll: true });
  }

  function open(el, opts = {}) {
    if (stack.some((m) => m.el === el)) return;
    stack.push({ el, onClose: opts.onClose || null, restore: document.activeElement, dismissable: opts.dismissable !== false });
    el.hidden = false;
    el.classList.add('open');
    requestAnimationFrame(() => {
      if (!el.hidden) focusFirst(el);
    });
  }

  function close(el, reason = 'close') {
    const i = stack.findIndex((m) => m.el === el);
    if (i < 0) return;
    const [m] = stack.splice(i, 1);
    el.hidden = true;
    el.classList.remove('open');
    if (m.restore && m.restore.focus && document.contains(m.restore)) m.restore.focus({ preventScroll: true });
    if (m.onClose) m.onClose(reason);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    const m = stack[stack.length - 1];
    if (!m.dismissable) return;
    e.preventDefault();
    // Stop the game's Esc (pause toggle) from firing for the same key press.
    e.stopImmediatePropagation();
    close(m.el, 'escape');
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-close]');
    if (!btn) return;
    const m = stack.find((q) => q.el.contains(btn));
    if (m) close(m.el, 'button');
  });

  // Clicking the dimmed backdrop closes dismissable dialogs.
  document.addEventListener('mousedown', (e) => {
    const m = stack[stack.length - 1];
    if (m && m.dismissable && e.target === m.el) close(m.el, 'backdrop');
  });

  return {
    open,
    close,
    isOpen: (el) => stack.some((m) => m.el === el),
    top: () => (stack.length ? stack[stack.length - 1].el : null),
    get count() {
      return stack.length;
    },
  };
}

// ---- class descriptions ---------------------------------------------------------------

function pctText(mult) {
  return `${Math.round(Math.abs(mult - 1) * 100)}%`;
}

/** Human-readable perk list for a class. */
export function perkLines(classId) {
  const p = perksFor(classId);
  const out = [];
  if (p.maxHp !== 100) out.push(`${p.maxHp} max health`);
  if (p.startArmor > 0) out.push(`Starts with ${p.startArmor} armour`);
  if (p.damageMult !== 1) out.push(`+${pctText(p.damageMult)} gun damage`);
  if (p.reloadMult !== 1) out.push(`${pctText(p.reloadMult)} faster reloads`);
  if (p.reviveSpeed !== 1) out.push(`${p.reviveSpeed}× revive speed`);
  if (p.healAura > 0) out.push(`Heals allies nearby ${p.healAura} HP/s`);
  if (p.turretDiscount > 0) out.push(`Turrets ${Math.round(p.turretDiscount * 100)}% off`);
  if (p.turretDamage !== 1) out.push(`+${pctText(p.turretDamage)} turret damage`);
  if (p.startTurrets > 0) out.push(p.startTurrets === 1 ? 'Starts with a turret' : `Starts with ${p.startTurrets} turrets`);
  if (p.speedMult !== 1) out.push(`${p.speedMult > 1 ? '+' : '−'}${pctText(p.speedMult)} move speed`);
  if (p.staminaMult !== 1) out.push(`+${pctText(p.staminaMult)} stamina`);
  if (p.cashMult !== 1) out.push(`+${pctText(p.cashMult)} kill cash`);
  if (p.explosiveMult !== 1) out.push(`+${pctText(p.explosiveMult)} explosive damage`);
  if (p.selfExplosionImmune) out.push('Immune to own explosions');
  if (p.startFrags > 0) out.push(p.startFrags === 1 ? 'Starts with a frag' : `Starts with ${p.startFrags} frags`);
  if (p.extraFrags > 0) out.push(`Carries ${p.extraFrags} extra frags`);
  if (p.startMolotovs > 0) out.push(p.startMolotovs === 1 ? 'Starts with a molotov' : `Starts with ${p.startMolotovs} molotovs`);
  if (p.meleeMult !== 1) out.push(`${p.meleeMult}× shove power`);
  return out;
}

// ---- title screen ------------------------------------------------------------------------

/**
 * @param {object} ctx app context: { prefs, savePrefs, deps, audio, onSolo, onHost, onJoin, onSettings, onHowTo }
 */
export function createTitle(ctx) {
  const { prefs, deps } = ctx;
  const nameInput = $('#name-input');
  const grid = $('#class-grid');
  const detail = $('#class-detail');
  const swatches = $('#color-swatches');
  const cards = new Map();
  const detailCanvas = h('canvas.detail-portrait', { width: 176, height: 176, 'aria-hidden': 'true' });
  const detailName = h('div.detail-name');
  const detailRole = h('div.detail-role');
  const detailDesc = h('p.detail-desc');
  const detailPerks = h('ul.perk-list');
  const detailGear = h('div.detail-gear');
  detail.replaceChildren(
    h('div.detail-portrait-wrap', null, detailCanvas),
    h('div.detail-info', null, [h('div.detail-title', null, [detailName, detailRole]), detailDesc, detailPerks, detailGear]),
  );

  nameInput.value = prefs.name;
  nameInput.addEventListener('input', () => {
    prefs.name = cleanName(nameInput.value);
    ctx.savePrefs();
  });
  nameInput.addEventListener('blur', () => {
    nameInput.value = cleanName(nameInput.value);
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.blur();
    }
  });

  function drawPortrait(canvas, cls) {
    try {
      deps.renderClassPortrait(canvas, cls, prefs.color);
    } catch (err) {
      console.warn('[ui] portrait failed', err);
    }
  }

  CLASS_IDS.forEach((id) => {
    const c = CLASSES[id];
    const canvas = h('canvas.class-portrait', { width: 112, height: 112, 'aria-hidden': 'true' });
    const btn = h('button.class-card', { type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { cls: id }, title: `${c.name} — ${c.role}` }, [
      canvas,
      h('span.class-name', { text: c.name }),
      h('span.class-role', { text: c.role }),
    ]);
    btn.addEventListener('click', () => {
      ctx.audio.ui('click');
      selectClass(id);
    });
    grid.appendChild(btn);
    cards.set(id, { btn, canvas });
  });

  // Arrow keys move between radio options, the way a native radio group behaves.
  function radioKeys(container, selector, pick) {
    container.addEventListener('keydown', (e) => {
      const items = $$(selector, container);
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      if (j < 0) return;
      e.preventDefault();
      items[j].focus();
      pick(items[j]);
    });
  }
  radioKeys(grid, '.class-card', (b) => selectClass(b.dataset.cls));

  PLAYER_COLORS.forEach((col, i) => {
    const b = h('button.swatch', {
      type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': PLAYER_COLOR_NAMES[i], title: PLAYER_COLOR_NAMES[i],
      style: { '--sw': col }, dataset: { color: String(i) },
    });
    b.addEventListener('click', () => {
      ctx.audio.ui('click');
      selectColor(i);
    });
    swatches.appendChild(b);
  });
  radioKeys(swatches, '.swatch', (b) => selectColor(Number(b.dataset.color)));

  function renderDetail() {
    const id = prefs.cls;
    const c = CLASSES[id];
    drawPortrait(detailCanvas, id);
    detailName.textContent = c.name;
    detailRole.textContent = c.role;
    detailDesc.textContent = c.desc;
    detailPerks.replaceChildren(...perkLines(id).map((t) => h('li', { text: t })));
    const w = WEAPONS[c.startWeapon];
    detailGear.replaceChildren(h('span.gear-label', { text: 'Loadout' }), h('span.gear-item', { text: w ? w.name : c.startWeapon }), h('span.gear-item', { text: WEAPONS.pistol.name }));
  }

  function selectClass(id) {
    if (!CLASSES[id]) return;
    prefs.cls = id;
    ctx.savePrefs();
    for (const [cid, c] of cards) {
      c.btn.setAttribute('aria-checked', cid === id ? 'true' : 'false');
      c.btn.tabIndex = cid === id ? 0 : -1;
    }
    renderDetail();
  }

  function selectColor(i) {
    prefs.color = i;
    ctx.savePrefs();
    for (const b of $$('.swatch', swatches)) {
      const on = Number(b.dataset.color) === i;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    for (const [cid, c] of cards) drawPortrait(c.canvas, cid);
    renderDetail();
  }

  $('#btn-solo').addEventListener('click', () => ctx.onSolo());
  $('#btn-host').addEventListener('click', () => ctx.onHost());
  $('#btn-join').addEventListener('click', () => ctx.onJoin());
  $('#btn-settings').addEventListener('click', () => ctx.onSettings());
  $('#btn-howto').addEventListener('click', () => ctx.onHowTo());

  selectColor(prefs.color);
  selectClass(prefs.cls);

  return {
    /** Current name, generating one if the field is empty. */
    ensureName() {
      let n = cleanName(nameInput.value);
      if (!n) {
        n = ctx.randomName();
        nameInput.value = n;
      }
      prefs.name = n;
      ctx.savePrefs();
      return n;
    },
    refresh() {
      nameInput.value = prefs.name;
      selectColor(prefs.color);
      selectClass(prefs.cls);
    },
    setServerStatus(text) {
      $('#server-status').textContent = text;
    },
  };
}

// ---- join dialog ---------------------------------------------------------------------------

/**
 * Pull a room code (and transport hint) out of whatever the player typed or pasted:
 * a bare code, "abc de", or a full invite URL with ?join=CODE[&via=relay].
 * @returns {{ code: string, via: string|undefined }}
 */
export function parseJoinInput(raw) {
  const text = String(raw || '').trim();
  let code = text;
  let via;
  const m = /[?&#]join=([A-Za-z0-9 -]+)/.exec(text);
  if (m) {
    code = m[1];
    const v = /[?&#]via=(relay|p2p)/i.exec(text);
    if (v) via = v[1].toLowerCase();
  }
  const clean = code.toUpperCase().split('').filter((ch) => ROOM_CODE_ALPHABET.includes(ch)).join('').slice(0, ROOM_CODE_LENGTH);
  return { code: clean, via };
}

/**
 * @param {object} ctx { modals, audio, onSubmit(code, via) }
 */
export function createJoinDialog(ctx) {
  const dlg = $('#dlg-join');
  const input = $('#join-code');
  const err = $('#join-error');
  const form = $('#join-form');
  let via;

  input.addEventListener('input', () => {
    const raw = input.value;
    const parsed = parseJoinInput(raw);
    if (parsed.via) via = parsed.via;
    // Keep the caret sane: only rewrite the field when the normalised text differs.
    if (raw !== parsed.code) input.value = parsed.code;
    err.textContent = '';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { code } = parseJoinInput(input.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      err.textContent = `Room codes have ${ROOM_CODE_LENGTH} letters — check with your host.`;
      ctx.audio.ui('deny');
      input.focus();
      return;
    }
    ctx.modals.close(dlg, 'submit');
    ctx.onSubmit(code, via);
  });

  return {
    open(prefill = '', prefillVia) {
      input.value = parseJoinInput(prefill).code;
      via = prefillVia;
      err.textContent = '';
      ctx.modals.open(dlg);
    },
    close() {
      ctx.modals.close(dlg);
    },
  };
}

// ---- connecting / error / confirm -------------------------------------------------------

export function createStatusDialogs(ctx) {
  const conn = $('#dlg-connecting');
  const connTitle = $('#connecting-title');
  const connText = $('#connecting-text');
  const errDlg = $('#dlg-error');
  const errTitle = $('#error-title');
  const errText = $('#error-text');
  const confirmDlg = $('#dlg-confirm');
  let onCancel = null;
  let onErrorOk = null;
  let onYes = null;

  $('#connecting-cancel').addEventListener('click', () => {
    ctx.modals.close(conn, 'cancel');
  });
  $('#error-ok').addEventListener('click', () => ctx.modals.close(errDlg, 'ok'));
  $('#confirm-no').addEventListener('click', () => ctx.modals.close(confirmDlg, 'no'));
  $('#confirm-yes').addEventListener('click', () => {
    const fn = onYes;
    onYes = null;
    ctx.modals.close(confirmDlg, 'yes');
    if (fn) fn();
  });

  return {
    connecting(title, text, cancel) {
      connTitle.textContent = title;
      connText.textContent = text || '';
      onCancel = cancel;
      if (ctx.modals.isOpen(conn)) return;
      ctx.modals.open(conn, {
        onClose: (reason) => {
          const fn = onCancel;
          onCancel = null;
          if (reason !== 'done' && fn) fn();
        },
      });
    },
    doneConnecting() {
      onCancel = null;
      ctx.modals.close(conn, 'done');
    },
    error(title, text, ok) {
      errTitle.textContent = title;
      errText.textContent = text || '';
      onErrorOk = ok || null;
      ctx.modals.open(errDlg, {
        onClose: () => {
          const fn = onErrorOk;
          onErrorOk = null;
          if (fn) fn();
        },
      });
    },
    confirm(title, text, yesLabel, yes) {
      $('#confirm-title').textContent = title;
      $('#confirm-text').textContent = text;
      $('#confirm-yes').textContent = yesLabel || 'Leave';
      onYes = yes;
      ctx.modals.open(confirmDlg);
    },
  };
}

// ---- settings ---------------------------------------------------------------------------------

/**
 * @param {object} ctx { prefs, savePrefs, modals, audio, applySettings() }
 */
export function createSettingsDialog(ctx) {
  const dlg = $('#dlg-settings');
  const s = ctx.prefs.settings;
  const ranges = $$('input[type=range][data-setting]', dlg);
  const checks = $$('input[type=checkbox][data-setting]', dlg);
  const quality = $$('#set-quality .seg-btn', dlg);

  function sync() {
    for (const r of ranges) {
      r.value = String(Math.round(s[r.dataset.setting] * 100));
      r.nextElementSibling.textContent = `${r.value}%`;
    }
    for (const c of checks) c.checked = !!s[c.dataset.setting];
    for (const b of quality) b.setAttribute('aria-checked', b.dataset.value === s.quality ? 'true' : 'false');
  }

  for (const r of ranges) {
    r.addEventListener('input', () => {
      s[r.dataset.setting] = Number(r.value) / 100;
      r.nextElementSibling.textContent = `${r.value}%`;
      ctx.applySettings();
      ctx.savePrefs();
    });
    r.addEventListener('change', () => ctx.audio.ui('click'));
  }
  for (const c of checks) {
    c.addEventListener('change', () => {
      s[c.dataset.setting] = c.checked;
      ctx.audio.ui('click');
      ctx.applySettings();
      ctx.savePrefs();
    });
  }
  for (const b of quality) {
    b.addEventListener('click', () => {
      s.quality = b.dataset.value;
      ctx.audio.ui('click');
      sync();
      ctx.applySettings();
      ctx.savePrefs();
    });
  }

  return {
    open(onClose) {
      sync();
      ctx.modals.open(dlg, { onClose });
    },
  };
}

export function createHowTo(ctx) {
  const dlg = $('#dlg-howto');
  return {
    open(onClose) {
      ctx.modals.open(dlg, {
        onClose: () => {
          if (!ctx.prefs.seenHowTo) {
            ctx.prefs.seenHowTo = true;
            ctx.savePrefs();
          }
          if (onClose) onClose();
        },
      });
      const body = dlg.querySelector('.howto-body');
      if (body) body.scrollTop = 0;
    },
  };
}

/** Small transient message at the bottom of the screen (copy confirmations etc.). */
export function flashToast(text, tone = '') {
  const root = $('#toast-root');
  const el = h('div.flash-toast', { class: tone || null, text });
  root.appendChild(el);
  setTimeout(() => el.classList.add('out'), 1800);
  setTimeout(() => el.remove(), 2300);
}
