/**
 * The right-hand inspector: style controls, page information, document
 * metadata and interactive form fields.
 *
 * The style controls edit the current selection when there is one, and the
 * defaults for the next annotation when there is not.
 */
import {
  state,
  page as pageAt,
  selectedAnnot,
  updateAnnot,
  removeAnnot,
  raiseAnnot,
  pushHistory,
  markDirty,
  on,
} from './model.js';
import { viewSize } from './geometry.js';
import { updateSelectedStyle, refreshPage, editSelection } from './viewer.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);

const STYLE_IDS = [
  'style-color',
  'style-fill',
  'style-fill-on',
  'style-width',
  'style-opacity',
  'style-font',
  'style-size',
  'style-bold',
  'style-italic',
  'style-align',
];

/** Which controls make sense for a given annotation type. */
function relevance(type) {
  switch (type) {
    case 'text':
      return { color: true, fill: false, width: false, opacity: true, text: true };
    case 'highlight':
      return { color: true, fill: false, width: false, opacity: true, text: false };
    case 'image':
      return { color: false, fill: false, width: false, opacity: true, text: false };
    case 'whiteout':
    case 'blackout':
      return { color: false, fill: true, width: false, opacity: true, text: false };
    default:
      return { color: true, fill: true, width: true, opacity: true, text: false };
  }
}

export function initPanels() {
  // --- style ---------------------------------------------------------
  $('style-color').addEventListener('input', (e) => applyStyle({ color: e.target.value }));
  $('style-fill').addEventListener('input', (e) => applyStyle({ fill: e.target.value }));
  $('style-fill-on').addEventListener('change', (e) =>
    applyStyle({ fill: e.target.checked ? $('style-fill').value : '' })
  );
  $('style-width').addEventListener('input', (e) =>
    applyStyle({ lineWidth: Number(e.target.value) })
  );
  $('style-opacity').addEventListener('input', (e) =>
    applyStyle({ opacity: Number(e.target.value) / 100 })
  );
  $('style-font').addEventListener('change', (e) => applyStyle({ font: e.target.value }));
  $('style-size').addEventListener('input', (e) =>
    applyStyle({ fontSize: Number(e.target.value) })
  );
  $('style-bold').addEventListener('click', () => toggleFontFlag('bold'));
  $('style-italic').addEventListener('click', () => toggleFontFlag('italic'));
  $('style-align').addEventListener('change', (e) => applyStyle({ align: e.target.value }));

  $('annot-edit-text').addEventListener('click', () => editSelection());
  $('annot-front').addEventListener('click', () => {
    if (state.selection) raiseAnnot(state.selection.page, state.selection.id, true);
  });
  $('annot-back').addEventListener('click', () => {
    if (state.selection) raiseAnnot(state.selection.page, state.selection.id, false);
  });
  $('annot-delete').addEventListener('click', () => {
    if (state.selection) removeAnnot(state.selection.page, state.selection.id);
  });

  // --- metadata ------------------------------------------------------
  for (const key of ['title', 'author', 'subject', 'keywords']) {
    $(`meta-${key}`).addEventListener('change', (e) => {
      if (!state.doc) return;
      pushHistory();
      state.doc.meta[key] = e.target.value;
      markDirty();
    });
  }

  $('form-flatten').addEventListener('change', (e) => {
    if (!state.doc) return;
    state.doc.flattenForms = e.target.checked;
    markDirty();
  });

  // Collapsible sections.
  document.querySelectorAll('.panel-section > h3').forEach((h) => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
  });

  on('selection', syncStylePanel);
  on('annots', syncStylePanel);
  on('pages', syncPagePanel);
  on('current-page', syncPagePanel);
  on('page-selection', syncPagePanel);
  on('doc', () => {
    syncStylePanel();
    syncPagePanel();
    syncMetaPanel();
    syncFormPanel();
  });
}

function toggleFontFlag(flag) {
  const annot = selectedAnnot();
  const value = annot ? !annot[flag] : !state.style[flag];
  applyStyle({ [flag]: value });
}

function applyStyle(patch) {
  const annot = selectedAnnot();
  if (annot) {
    updateSelectedStyle(patch);
  } else {
    // Remember it as the default for the next annotation.
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'color' && (state.tool === 'text' || state.tool === 'select')) {
        state.style.textColor = v;
      } else if (k === 'color' && state.tool === 'highlight') {
        state.style.highlightColor = v;
      } else {
        state.style[k] = v;
      }
    }
  }
  syncStylePanel();
}

export function syncStylePanel() {
  const annot = selectedAnnot();
  const src = annot || state.style;
  const type = annot ? annot.type : state.tool;
  const rel = relevance(type);

  $('style-scope').textContent = annot
    ? `Selected ${labelFor(annot.type)}`
    : state.tool === 'select'
      ? 'Nothing selected - showing defaults'
      : `Defaults for the ${labelFor(state.tool)} tool`;

  const color = annot
    ? annot.color || annot.fill || '#000000'
    : state.tool === 'text'
      ? state.style.textColor
      : state.tool === 'highlight'
        ? state.style.highlightColor
        : state.style.color;
  $('style-color').value = normHex(color);
  $('style-fill').value = normHex(src.fill || '#ffffff');
  $('style-fill-on').checked = !!src.fill;
  $('style-width').value = src.lineWidth == null ? 2 : src.lineWidth;
  $('style-width-out').textContent = `${$('style-width').value}pt`;
  const op = src.opacity == null ? 1 : src.opacity;
  $('style-opacity').value = Math.round(op * 100);
  $('style-opacity-out').textContent = `${Math.round(op * 100)}%`;
  $('style-font').value = src.font || 'Helvetica';
  $('style-size').value = src.fontSize || 12;
  $('style-align').value = src.align || 'left';
  $('style-bold').classList.toggle('active', !!src.bold);
  $('style-italic').classList.toggle('active', !!src.italic);

  toggleRow('row-color', rel.color || type === 'text');
  toggleRow('row-fill', rel.fill);
  toggleRow('row-width', rel.width);
  toggleRow('row-opacity', rel.opacity);
  toggleRow('row-text', rel.text);
  $('annot-actions').style.display = annot ? '' : 'none';
  $('annot-edit-text').style.display = annot && annot.type === 'text' ? '' : 'none';

  for (const id of STYLE_IDS) {
    const el = $(id);
    if (el) el.disabled = !state.doc;
  }
}

function toggleRow(id, on_) {
  const el = $(id);
  if (el) el.style.display = on_ ? '' : 'none';
}

function normHex(v) {
  return /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000';
}

function labelFor(type) {
  return (
    {
      select: 'selection',
      text: 'text box',
      draw: 'pen stroke',
      highlight: 'highlight',
      rect: 'rectangle',
      ellipse: 'ellipse',
      line: 'line',
      arrow: 'arrow',
      image: 'image',
      whiteout: 'white-out box',
      blackout: 'black-out box',
    }[type] || type
  );
}

/* -------------------------------- page --------------------------------- */

export function syncPagePanel() {
  const spec = pageAt(state.currentPage);
  const info = $('page-info');
  if (!spec) {
    info.textContent = 'No page';
    return;
  }
  const { w, h } = viewSize(spec);
  const mm = (pt) => (pt * 25.4) / 72;
  info.innerHTML =
    `<div><span>Page</span><b>${state.currentPage + 1} of ${state.doc.pages.length}</b></div>` +
    `<div><span>Size</span><b>${w.toFixed(0)} x ${h.toFixed(0)} pt</b></div>` +
    `<div><span></span><b>${mm(w).toFixed(0)} x ${mm(h).toFixed(0)} mm</b></div>` +
    `<div><span>Rotation</span><b>${spec.rotate}&deg;</b></div>` +
    `<div><span>Annotations</span><b>${spec.annots.length}</b></div>` +
    `<div><span>Selected</span><b>${state.selectedPages.size} page(s)</b></div>`;
}

/* ------------------------------ metadata -------------------------------- */

export function syncMetaPanel() {
  const meta = state.doc ? state.doc.meta : {};
  for (const key of ['title', 'author', 'subject', 'keywords']) {
    const el = $(`meta-${key}`);
    el.value = meta[key] || '';
    el.disabled = !state.doc;
  }
  $('meta-extra').textContent = state.doc
    ? `${state.doc.pages.length} pages - ${formatBytes(state.doc.sources.main.bytes.byteLength)}` +
      (state.doc.encrypted ? ' - password protected' : '')
    : '';
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------ form fields ------------------------------ */

export function syncFormPanel() {
  const host = $('form-fields');
  host.innerHTML = '';
  const fields = (state.doc && state.doc.formFields) || [];
  $('form-empty').style.display = fields.length ? 'none' : '';
  $('form-flatten').disabled = !fields.length;
  $('form-flatten').checked = !!(state.doc && state.doc.flattenForms);

  for (const field of fields) {
    const row = document.createElement('label');
    row.className = 'field-row';

    const name = document.createElement('span');
    name.className = 'field-name';
    name.textContent = field.name;
    name.title = `${field.name} (${field.type})`;

    let input;
    if (field.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!currentValue(field);
      input.addEventListener('change', () => setValue(field, input.checked));
    } else if (field.type === 'dropdown' || field.type === 'radio' || field.type === 'optionlist') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '--';
      input.append(blank);
      for (const opt of field.options || []) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        input.append(o);
      }
      input.value = currentValue(field) ?? '';
      input.addEventListener('change', () => setValue(field, input.value));
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = currentValue(field) ?? '';
      input.placeholder = field.readOnly ? 'read only' : '';
      input.addEventListener('change', () => setValue(field, input.value));
    }
    input.disabled = !!field.readOnly;
    input.className = 'field-input';

    row.append(name, input);
    host.append(row);
  }
}

function currentValue(field) {
  const v = state.doc.formValues[field.name];
  return v === undefined ? field.value : v;
}

function setValue(field, value) {
  pushHistory();
  state.doc.formValues[field.name] = value;
  markDirty();
  toast(`${field.name} set`, 'info', 1200);
}

/** Redraw whichever page owns the current selection. */
export function refreshSelectionPage() {
  if (state.selection) refreshPage(state.selection.page);
}

on('annots', (slot) => {
  if (typeof slot === 'number') refreshPage(slot);
});
