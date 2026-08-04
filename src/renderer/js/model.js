/**
 * Document model, undo history and a tiny event bus.
 *
 * Everything the editor knows about the open document lives here as plain data,
 * which is what makes undo (structured clone of the page list) and saving
 * (hand the same data to export.js) so cheap.
 */
import { normRotation } from './geometry.js';

let seq = 0;
export function uid(prefix = 'a') {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

/* ----------------------------- event bus ----------------------------- */

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (set) for (const fn of [...set]) fn(payload);
}

/* ------------------------------- state ------------------------------- */

export const state = {
  /** @type {null | object} */
  doc: null,
  tool: 'select',
  style: {
    color: '#e03131',
    fill: '',
    lineWidth: 2,
    opacity: 1,
    fontSize: 12,
    font: 'Helvetica',
    bold: false,
    italic: false,
    align: 'left',
    textColor: '#111111',
    highlightColor: '#ffe14d',
  },
  zoom: 1,
  zoomMode: 'fit-width',
  currentPage: 0,
  /** @type {Set<number>} page slots selected in the thumbnail rail */
  selectedPages: new Set([0]),
  /** @type {{page:number, id:string}|null} */
  selection: null,
  dirty: false,
  history: { undo: [], redo: [] },
  clipboard: null,
  /** @type {{imgId:string, w:number, h:number}|null} image waiting to be placed */
  pendingImage: null,
  panels: { thumbs: true, props: true },
};

const HISTORY_LIMIT = 60;

export function hasDoc() {
  return !!state.doc;
}

export function pages() {
  return state.doc ? state.doc.pages : [];
}

export function page(i) {
  return state.doc ? state.doc.pages[i] : null;
}

export function findAnnot(pageIndex, id) {
  const p = page(pageIndex);
  if (!p) return null;
  return p.annots.find((a) => a.id === id) || null;
}

export function selectedAnnot() {
  return state.selection ? findAnnot(state.selection.page, state.selection.id) : null;
}

/* ------------------------------ history ------------------------------ */

function snapshot() {
  return JSON.stringify({
    pages: state.doc.pages,
    meta: state.doc.meta,
    formValues: state.doc.formValues,
    flattenForms: state.doc.flattenForms,
  });
}

function restore(json) {
  const data = JSON.parse(json);
  state.doc.pages = data.pages;
  state.doc.meta = data.meta;
  state.doc.formValues = data.formValues;
  state.doc.flattenForms = data.flattenForms;
}

/**
 * Record the current document state so the next mutation can be undone.
 * Call this *before* mutating.
 */
export function pushHistory() {
  if (!state.doc) return;
  state.history.undo.push(snapshot());
  if (state.history.undo.length > HISTORY_LIMIT) state.history.undo.shift();
  state.history.redo.length = 0;
}

export function undo() {
  if (!state.doc || !state.history.undo.length) return false;
  state.history.redo.push(snapshot());
  restore(state.history.undo.pop());
  afterStructuralChange();
  return true;
}

export function redo() {
  if (!state.doc || !state.history.redo.length) return false;
  state.history.undo.push(snapshot());
  restore(state.history.redo.pop());
  afterStructuralChange();
  return true;
}

export function canUndo() {
  return state.history.undo.length > 0;
}

export function canRedo() {
  return state.history.redo.length > 0;
}

/* ------------------------------ mutations ---------------------------- */

export function markDirty(dirty = true) {
  state.dirty = dirty;
  emit('dirty', dirty);
}

/** Page content changed but the page list did not. */
export function afterAnnotChange(pageIndex) {
  markDirty();
  emit('annots', pageIndex);
}

/** The page list itself changed (order, count, rotation). */
export function afterStructuralChange() {
  if (state.doc) {
    const n = state.doc.pages.length;
    state.selectedPages = new Set(
      [...state.selectedPages].filter((i) => i < n)
    );
    if (!state.selectedPages.size && n) state.selectedPages.add(Math.min(state.currentPage, n - 1));
    if (state.currentPage >= n) state.currentPage = Math.max(0, n - 1);
    if (state.selection && !findAnnot(state.selection.page, state.selection.id)) {
      state.selection = null;
    }
  }
  markDirty();
  emit('pages');
  emit('selection');
}

export function setTool(tool) {
  state.tool = tool;
  emit('tool', tool);
}

export function setZoom(zoom, mode = 'custom') {
  state.zoom = Math.min(8, Math.max(0.1, zoom));
  state.zoomMode = mode;
  emit('zoom');
}

export function select(pageIndex, id) {
  state.selection = id ? { page: pageIndex, id } : null;
  emit('selection');
}

export function setCurrentPage(i) {
  if (i === state.currentPage) return;
  state.currentPage = i;
  emit('current-page', i);
}

export function selectPages(indices, { additive = false } = {}) {
  if (!additive) state.selectedPages.clear();
  for (const i of indices) state.selectedPages.add(i);
  emit('page-selection');
}

/* --------------------------- page operations -------------------------- */

export function rotatePages(indices, delta) {
  if (!indices.length) return;
  pushHistory();
  for (const i of indices) {
    const p = page(i);
    if (p) p.rotate = normRotation(p.rotate + delta);
  }
  afterStructuralChange();
}

export function deletePages(indices) {
  const doomed = new Set(indices);
  if (!doomed.size) return;
  if (doomed.size >= state.doc.pages.length) return;
  pushHistory();
  state.doc.pages = state.doc.pages.filter((_p, i) => !doomed.has(i));
  const first = Math.min(...doomed);
  state.selectedPages = new Set([Math.max(0, Math.min(first, state.doc.pages.length - 1))]);
  afterStructuralChange();
}

export function duplicatePages(indices) {
  if (!indices.length) return;
  pushHistory();
  const sorted = [...indices].sort((a, b) => b - a);
  for (const i of sorted) {
    const src = state.doc.pages[i];
    if (!src) continue;
    const copy = structuredClone(src);
    copy.uid = uid('p');
    copy.annots = copy.annots.map((a) => ({ ...a, id: uid() }));
    state.doc.pages.splice(i + 1, 0, copy);
  }
  afterStructuralChange();
}

export function movePages(indices, delta) {
  if (!indices.length) return;
  const list = state.doc.pages;
  const sorted = [...indices].sort((a, b) => (delta < 0 ? a - b : b - a));
  if (delta < 0 && sorted[0] === 0) return;
  if (delta > 0 && sorted[0] === list.length - 1) return;
  pushHistory();
  const moved = new Set();
  for (const i of sorted) {
    const target = i + delta;
    if (target < 0 || target >= list.length) continue;
    const [item] = list.splice(i, 1);
    list.splice(target, 0, item);
    moved.add(target);
  }
  state.selectedPages = moved;
  afterStructuralChange();
}

/** Drag-and-drop reorder in the thumbnail rail. */
export function reorderPages(indices, targetSlot) {
  const picked = [...indices].sort((a, b) => a - b);
  if (!picked.length) return;
  pushHistory();
  const list = state.doc.pages;
  const items = picked.map((i) => list[i]);
  const before = picked.filter((i) => i < targetSlot).length;
  const remaining = list.filter((_p, i) => !indices.includes(i));
  const insertAt = Math.max(0, Math.min(remaining.length, targetSlot - before));
  remaining.splice(insertAt, 0, ...items);
  state.doc.pages = remaining;
  state.selectedPages = new Set(items.map((_it, k) => insertAt + k));
  afterStructuralChange();
}

export function insertBlankPage(afterSlot, size) {
  pushHistory();
  const ref = page(afterSlot);
  const w = size ? size.w : ref ? ref.baseW : 595.28;
  const h = size ? size.h : ref ? ref.baseH : 841.89;
  state.doc.pages.splice(afterSlot + 1, 0, {
    uid: uid('p'),
    src: null,
    index: -1,
    rotate: 0,
    baseW: w,
    baseH: h,
    cropX: 0,
    cropY: 0,
    annots: [],
  });
  state.selectedPages = new Set([afterSlot + 1]);
  afterStructuralChange();
}

export function insertPages(specs, atSlot) {
  if (!specs.length) return;
  pushHistory();
  state.doc.pages.splice(atSlot, 0, ...specs);
  state.selectedPages = new Set(specs.map((_s, k) => atSlot + k));
  afterStructuralChange();
}

/* ------------------------- annotation operations ---------------------- */

export function addAnnot(pageIndex, annot) {
  const p = page(pageIndex);
  if (!p) return null;
  pushHistory();
  const withId = { id: uid(), ...annot };
  p.annots.push(withId);
  afterAnnotChange(pageIndex);
  return withId;
}

export function updateAnnot(pageIndex, id, patch, { history = true } = {}) {
  const a = findAnnot(pageIndex, id);
  if (!a) return;
  if (history) pushHistory();
  Object.assign(a, patch);
  afterAnnotChange(pageIndex);
}

export function removeAnnot(pageIndex, id) {
  const p = page(pageIndex);
  if (!p) return;
  const idx = p.annots.findIndex((a) => a.id === id);
  if (idx < 0) return;
  pushHistory();
  p.annots.splice(idx, 1);
  if (state.selection && state.selection.id === id) state.selection = null;
  afterAnnotChange(pageIndex);
  emit('selection');
}

export function raiseAnnot(pageIndex, id, toFront) {
  const p = page(pageIndex);
  if (!p) return;
  const idx = p.annots.findIndex((a) => a.id === id);
  if (idx < 0) return;
  pushHistory();
  const [a] = p.annots.splice(idx, 1);
  if (toFront) p.annots.push(a);
  else p.annots.unshift(a);
  afterAnnotChange(pageIndex);
}

/* ----------------------------- doc lifecycle -------------------------- */

/**
 * Build page specs from a loaded pdf.js document.
 * @param {*} pdfjsDoc
 * @param {string} srcKey key into doc.sources
 */
export async function pageSpecsFrom(pdfjsDoc, srcKey) {
  const out = [];
  for (let i = 1; i <= pdfjsDoc.numPages; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const p = await pdfjsDoc.getPage(i);
    const box = p.view; // [x0, y0, x1, y1] of the crop box
    out.push({
      uid: uid('p'),
      src: srcKey,
      index: i - 1,
      rotate: normRotation(p.rotate),
      baseW: box[2] - box[0],
      baseH: box[3] - box[1],
      cropX: box[0],
      cropY: box[1],
      annots: [],
    });
  }
  return out;
}

export function setDocument(doc) {
  state.doc = doc;
  state.history.undo.length = 0;
  state.history.redo.length = 0;
  state.selection = null;
  state.currentPage = 0;
  state.selectedPages = new Set([0]);
  markDirty(false);
  // 'doc' listeners rebuild the viewer and rail already; emitting 'pages' here
  // as well would just make them do it twice.
  emit('doc', doc);
}

export function closeDocument() {
  state.doc = null;
  state.history.undo.length = 0;
  state.history.redo.length = 0;
  state.selection = null;
  state.selectedPages = new Set();
  markDirty(false);
  emit('doc', null);
}

/** The plain-data model handed to export.js. */
export function exportModel() {
  const d = state.doc;
  const sources = {};
  for (const [key, src] of Object.entries(d.sources)) sources[key] = src.bytes;
  return {
    sources,
    pages: d.pages,
    images: d.images,
    meta: d.meta,
    formValues: d.formValues,
    flattenForms: d.flattenForms,
    originalPageCount: d.originalPageCount,
  };
}
