/**
 * Application controller: document lifecycle, menu and toolbar commands,
 * keyboard handling, and every file-level operation.
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
} from '../vendor/pdf-lib.esm.min.js';

import {
  state,
  on,
  emit,
  uid,
  pages,
  page as pageAt,
  setDocument,
  closeDocument,
  setTool,
  setZoom,
  select,
  selectPages,
  markDirty,
  undo,
  redo,
  canUndo,
  canRedo,
  pageSpecsFrom,
  rotatePages,
  deletePages,
  duplicatePages,
  movePages,
  insertBlankPage,
  insertPages,
  removeAnnot,
  addAnnot,
  exportModel,
} from './model.js';
import * as viewer from './viewer.js';
import * as thumbs from './thumbs.js';
import * as search from './search.js';
import { initPanels, syncStylePanel, syncPagePanel, syncMetaPanel, syncFormPanel } from './panels.js';
import { toast, initModals, openModal, closeModal, signaturePad, setBusy, isModalOpen } from './ui.js';
import { buildPdf, extractPages } from './export.js';
import { initFonts } from './fonts.js';
import { viewSize } from './geometry.js';

const $ = (id) => document.getElementById(id);

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const CMAP_URL = new URL('../vendor/cmaps/', import.meta.url).href;
const STANDARD_FONT_URL = new URL('../vendor/standard_fonts/', import.meta.url).href;

/* ------------------------------ document IO ----------------------------- */

/** pdf.js takes ownership of the buffer it is handed, so it always gets a copy. */
function loadingTask(bytes, password) {
  return pdfjsLib.getDocument({
    data: new Uint8Array(bytes).slice(),
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    password,
    isEvalSupported: false,
  });
}

async function openPdfjs(bytes) {
  let password;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return { doc: await loadingTask(bytes, password).promise, password };
    } catch (err) {
      const needsPassword =
        err && (err.name === 'PasswordException' || /password/i.test(err.message || ''));
      if (!needsPassword) throw err;
      // eslint-disable-next-line no-await-in-loop
      password = await askPassword(attempt > 0);
      if (password == null) return null;
    }
  }
  throw new Error('Incorrect password.');
}

function askPassword(retry) {
  return new Promise((resolve) => {
    const input = $('pw-input');
    const form = $('pw-form');
    input.value = '';
    $('pw-error').style.display = retry ? '' : 'none';

    const done = (value) => {
      form.removeEventListener('submit', onSubmit);
      $('pw-cancel').removeEventListener('click', onCancel);
      closeModal();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    const onCancel = () => done(null);

    form.addEventListener('submit', onSubmit);
    $('pw-cancel').addEventListener('click', onCancel);
    openModal('modal-password');
  });
}

/** Read metadata and interactive form fields with pdf-lib. */
async function inspectWithPdfLib(bytes) {
  const out = { meta: {}, fields: [], readable: false };
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    out.readable = true;
    out.meta = {
      title: doc.getTitle() || '',
      author: doc.getAuthor() || '',
      subject: doc.getSubject() || '',
      keywords: (doc.getKeywords() || '').toString(),
      creator: doc.getCreator() || '',
    };
    const form = doc.getForm();
    for (const field of form.getFields()) {
      const entry = { name: field.getName(), readOnly: false, value: null, options: [] };
      try {
        entry.readOnly = field.isReadOnly();
      } catch {
        /* not all fields expose this */
      }
      // instanceof, not constructor.name - the vendored pdf-lib is minified.
      if (field instanceof PDFTextField) {
        entry.type = 'text';
        entry.value = field.getText() || '';
      } else if (field instanceof PDFCheckBox) {
        entry.type = 'checkbox';
        entry.value = field.isChecked();
      } else if (field instanceof PDFDropdown) {
        entry.type = 'dropdown';
        entry.options = field.getOptions();
        entry.value = (field.getSelected() || [])[0] || '';
      } else if (field instanceof PDFOptionList) {
        entry.type = 'optionlist';
        entry.options = field.getOptions();
        entry.value = (field.getSelected() || [])[0] || '';
      } else if (field instanceof PDFRadioGroup) {
        entry.type = 'radio';
        entry.options = field.getOptions();
        entry.value = field.getSelected() || '';
      } else {
        continue;
      }
      out.fields.push(entry);
    }
  } catch {
    // Encrypted or malformed: the file can still be viewed, just not inspected.
  }
  return out;
}

export async function openDocument({ bytes, name, path }) {
  setBusy(true, `Opening ${name}...`);
  try {
    const raw = new Uint8Array(bytes);
    const loaded = await openPdfjs(raw);
    if (!loaded) {
      setBusy(false);
      return;
    }
    const { doc: pdfjsDoc, password } = loaded;

    const specs = await pageSpecsFrom(pdfjsDoc, 'main');
    const inspected = await inspectWithPdfLib(raw);

    viewer.clearBitmaps();
    search.clearCache();

    setDocument({
      name,
      path: path || null,
      sources: { main: { bytes: raw, pdfjs: pdfjsDoc } },
      pages: specs,
      images: {},
      meta: inspected.meta,
      formFields: inspected.fields,
      formValues: {},
      flattenForms: false,
      originalPageCount: specs.length,
      encrypted: !!password,
      nextSource: 1,
    });

    if (password) {
      toast('Opened a password-protected file. Saving writes an unprotected copy.', 'warn', 6000);
    }
    if (!inspected.readable) {
      toast('Metadata and form fields could not be read from this file.', 'warn', 5000);
    }
  } catch (err) {
    await window.api.errorBox('Could not open PDF', `${name}\n\n${err.message}`);
  } finally {
    setBusy(false);
  }
}

async function openViaDialog() {
  const files = await window.api.openPdfDialog();
  if (!files.length) return;
  if (!(await confirmDiscard())) return;
  await openDocument(files[0]);
}

async function confirmDiscard() {
  if (!state.dirty) return true;
  const choice = await window.api.messageBox({
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'This document has unsaved changes.',
    detail: 'Do you want to save them first?',
  });
  if (choice === 2) return false;
  if (choice === 0) return saveDocument(false);
  return true;
}

/* -------------------------------- saving -------------------------------- */

async function produceBytes() {
  const model = exportModel();
  const result = await buildPdf(model);
  for (const warning of result.warnings) toast(warning, 'warn', 6000);
  return result.bytes;
}

/** @returns {Promise<boolean>} whether the document ended up saved */
async function saveDocument(saveAs) {
  if (!state.doc) return false;
  let target = state.doc.path;
  if (saveAs || !target) {
    target = await window.api.savePdfDialog({
      defaultPath: state.doc.path || state.doc.name.replace(/\.pdf$/i, '') + '-edited.pdf',
    });
    if (!target) return false;
  }
  setBusy(true, 'Saving...');
  try {
    const bytes = await produceBytes();
    const saved = await window.api.writeFile(target, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    state.doc.path = saved.path;
    state.doc.name = saved.name;
    markDirty(false);
    updateTitle();
    toast(`Saved ${saved.name}`, 'ok');
    return true;
  } catch (err) {
    await window.api.errorBox('Could not save', err.message);
    return false;
  } finally {
    setBusy(false);
  }
}

/* ---------------------------- multi-file tools --------------------------- */

async function addSource(bytes, label) {
  const key = `s${state.doc.nextSource}`;
  state.doc.nextSource += 1;
  const pdfjsDoc = await loadingTask(bytes).promise;
  state.doc.sources[key] = { bytes: new Uint8Array(bytes), pdfjs: pdfjsDoc, label };
  return { key, pdfjsDoc };
}

async function importPdf({ at }) {
  if (!state.doc) return;
  const files = await window.api.openPdfDialog({ multi: true });
  if (!files.length) return;
  setBusy(true, 'Importing pages...');
  try {
    const incoming = [];
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const { key, pdfjsDoc } = await addSource(file.bytes, file.name);
      // eslint-disable-next-line no-await-in-loop
      incoming.push(...(await pageSpecsFrom(pdfjsDoc, key)));
    }
    const slot = at === 'end' ? state.doc.pages.length : state.currentPage + 1;
    insertPages(incoming, slot);
    toast(`Inserted ${incoming.length} page(s)`, 'ok');
  } catch (err) {
    await window.api.errorBox('Could not import', err.message);
  } finally {
    setBusy(false);
  }
}

async function extractSelected() {
  if (!state.doc || !state.selectedPages.size) return;
  const slots = [...state.selectedPages].sort((a, b) => a - b);
  const target = await window.api.savePdfDialog({
    title: 'Save extracted pages',
    defaultPath: `${baseName()}-pages-${slots[0] + 1}-${slots[slots.length - 1] + 1}.pdf`,
  });
  if (!target) return;
  setBusy(true, 'Extracting...');
  try {
    const { bytes, warnings } = await extractPages(exportModel(), slots);
    warnings.forEach((w) => toast(w, 'warn', 5000));
    await window.api.writeFile(target, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    toast(`Extracted ${slots.length} page(s)`, 'ok');
    window.api.showItemInFolder(target);
  } catch (err) {
    await window.api.errorBox('Could not extract pages', err.message);
  } finally {
    setBusy(false);
  }
}

async function splitToFiles() {
  if (!state.doc) return;
  const dir = await window.api.chooseFolder();
  if (!dir) return;
  setBusy(true, 'Splitting...');
  try {
    const model = exportModel();
    const width = String(model.pages.length).length;
    for (let i = 0; i < model.pages.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { bytes } = await extractPages(model, [i]);
      const fileName = `${baseName()}-${String(i + 1).padStart(width, '0')}.pdf`;
      // eslint-disable-next-line no-await-in-loop
      const target = await window.api.joinPath(dir, fileName);
      // eslint-disable-next-line no-await-in-loop
      await window.api.writeFile(target, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      setBusy(true, `Splitting... ${i + 1}/${model.pages.length}`);
    }
    toast(`Wrote ${model.pages.length} files`, 'ok');
    window.api.openPath(dir);
  } catch (err) {
    await window.api.errorBox('Could not split', err.message);
  } finally {
    setBusy(false);
  }
}

function baseName() {
  return (state.doc.name || 'document').replace(/\.pdf$/i, '');
}

/* ------------------------------ images / sign ---------------------------- */

function registerImage(bytes, mime) {
  const id = uid('img');
  state.doc.images[id] = { bytes: new Uint8Array(bytes), mime };
  return id;
}

async function insertImage() {
  if (!state.doc) return;
  const file = await window.api.openImageDialog();
  if (!file) return;
  const mime = /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : 'image/png';
  const id = registerImage(file.bytes, mime);
  const bmp = await viewer.ensureBitmap(id);
  if (!bmp) {
    toast('That image could not be decoded.', 'error');
    return;
  }
  // Scale so a big photo lands at a sensible size on the page.
  const spec = pageAt(state.currentPage);
  const { w: pageW } = viewSize(spec);
  const scale = Math.min(1, (pageW * 0.5) / bmp.width);
  viewer.setPendingImage({ imgId: id, w: bmp.width * scale, h: bmp.height * scale });
  setTool('image');
  toast('Click on the page to place the image', 'info');
}

async function insertSignature() {
  if (!state.doc) return;
  const sig = await signaturePad();
  if (!sig) return;
  const id = registerImage(sig.bytes, sig.mime);
  await viewer.ensureBitmap(id);
  viewer.setPendingImage({ imgId: id, w: sig.w, h: sig.h });
  setTool('image');
  toast('Click on the page to place your signature', 'info');
}

/* --------------------------------- print --------------------------------- */

async function printDocument() {
  if (!state.doc) return;
  setBusy(true, 'Preparing print preview...');
  try {
    const out = [];
    for (let i = 0; i < state.doc.pages.length; i += 1) {
      setBusy(true, `Preparing page ${i + 1} of ${state.doc.pages.length}...`);
      // eslint-disable-next-line no-await-in-loop
      const img = await viewer.renderPageImage(i, 150 / 72);
      if (img) out.push(img);
    }
    setBusy(false);
    const result = await window.api.print(out);
    if (result && result.ok === false && result.reason && result.reason !== 'cancelled') {
      toast(`Print failed: ${result.reason}`, 'error');
    }
  } catch (err) {
    await window.api.errorBox('Could not print', err.message);
  } finally {
    setBusy(false);
  }
}

async function exportPagePng() {
  if (!state.doc) return;
  const slot = state.currentPage;
  const target = await window.api.saveImageDialog({
    defaultPath: `${baseName()}-page-${slot + 1}.png`,
  });
  if (!target) return;
  setBusy(true, 'Rendering...');
  try {
    const img = await viewer.renderPageImage(slot, 300 / 72);
    const bin = atob(img.dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    await window.api.writeFile(target, bytes.buffer);
    toast('Page exported', 'ok');
  } catch (err) {
    await window.api.errorBox('Could not export', err.message);
  } finally {
    setBusy(false);
  }
}

/* --------------------------------- find ---------------------------------- */

let findResults = [];
let findIndex = -1;

async function runFind() {
  const query = $('find-input').value;
  if (!state.doc || !query) {
    findResults = [];
    findIndex = -1;
    viewer.clearSearch();
    $('find-count').textContent = '';
    return;
  }
  findResults = await search.findAll(query, {
    matchCase: $('find-case').checked,
    wholeWord: $('find-word').checked,
  });
  findIndex = findResults.length ? 0 : -1;
  paintFind();
}

function paintFind() {
  const byPage = search.groupByPage(findResults);
  const current = findIndex >= 0 ? findResults[findIndex] : null;
  viewer.setSearch(byPage, current);
  $('find-count').textContent = findResults.length
    ? `${findIndex + 1} of ${findResults.length}`
    : 'No matches';
  if (current) viewer.scrollToRect(current.page, current.rect);
}

function stepFind(delta) {
  if (!findResults.length) return;
  findIndex = (findIndex + delta + findResults.length) % findResults.length;
  paintFind();
}

function toggleFindBar(show) {
  const bar = $('find-bar');
  const visible = show === undefined ? bar.classList.contains('open') === false : show;
  bar.classList.toggle('open', visible);
  if (visible) {
    $('find-input').focus();
    $('find-input').select();
  } else {
    viewer.clearSearch();
    findResults = [];
    findIndex = -1;
    $('find-count').textContent = '';
  }
}

/* ------------------------------- commands -------------------------------- */

function selectedSlots() {
  return [...state.selectedPages].sort((a, b) => a - b);
}

const commands = {
  'file:open': openViaDialog,
  'file:save': () => saveDocument(false),
  'file:save-as': () => saveDocument(true),
  'file:close': async () => {
    if (!state.doc) return;
    if (!(await confirmDiscard())) return;
    closeDocument();
  },
  'file:save-then-close': async () => {
    const ok = await saveDocument(false);
    if (ok) window.api.closeNow();
  },
  'file:merge': () => importPdf({ at: 'end' }),
  'file:insert-pdf': () => importPdf({ at: 'here' }),
  'file:extract': extractSelected,
  'file:split': splitToFiles,
  'file:export-png': exportPagePng,
  'file:print': printDocument,

  'edit:undo': () => {
    if (viewer.isEditing()) return;
    if (undo()) toast('Undo', 'info', 1000);
  },
  'edit:redo': () => {
    if (viewer.isEditing()) return;
    if (redo()) toast('Redo', 'info', 1000);
  },
  'edit:delete': () => {
    if (state.selection) removeAnnot(state.selection.page, state.selection.id);
    else if (state.selectedPages.size) deletePages(selectedSlots());
  },
  'edit:duplicate': () => {
    if (state.selection) duplicateAnnot();
    else duplicatePages(selectedSlots());
  },
  'edit:select-all-pages': () => selectPages(pages().map((_p, i) => i)),
  'edit:find': () => toggleFindBar(true),
  'edit:properties': () => {
    state.panels.props = true;
    applyPanels();
    document.querySelector('#section-doc').scrollIntoView({ behavior: 'smooth' });
  },

  'page:rotate-left': () => rotatePages(selectedSlots(), -90),
  'page:rotate-right': () => rotatePages(selectedSlots(), 90),
  'page:move-up': () => movePages(selectedSlots(), -1),
  'page:move-down': () => movePages(selectedSlots(), 1),
  'page:duplicate': () => duplicatePages(selectedSlots()),
  'page:insert-blank': () => insertBlankPage(state.currentPage),
  'page:delete': () => {
    if (state.doc && state.selectedPages.size >= state.doc.pages.length) {
      toast('A document must keep at least one page.', 'warn');
      return;
    }
    deletePages(selectedSlots());
  },

  'tool:image': insertImage,
  'tool:signature': insertSignature,
  'tool:flatten-forms': () => {
    if (!state.doc) return;
    state.doc.flattenForms = !state.doc.flattenForms;
    markDirty();
    syncFormPanel();
    toast(
      state.doc.flattenForms
        ? 'Form fields will be flattened on save.'
        : 'Form fields will stay interactive.',
      'info'
    );
  },

  'view:zoom-in': () => setZoomAndApply(state.zoom * 1.25),
  'view:zoom-out': () => setZoomAndApply(state.zoom / 1.25),
  'view:zoom-100': () => setZoomAndApply(1),
  'view:fit-width': () => viewer.fitZoom('fit-width'),
  'view:fit-page': () => viewer.fitZoom('fit-page'),
  'view:toggle-thumbs': () => {
    state.panels.thumbs = !state.panels.thumbs;
    applyPanels();
  },
  'view:toggle-props': () => {
    state.panels.props = !state.panels.props;
    applyPanels();
  },

  'help:shortcuts': () => openModal('modal-shortcuts'),
  'help:about': showAbout,
};

for (const tool of ['select', 'text', 'draw', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'whiteout', 'blackout']) {
  commands[`tool:${tool}`] = () => setTool(tool);
}

function duplicateAnnot() {
  const { page: slot, id } = state.selection;
  const spec = pageAt(slot);
  const original = spec.annots.find((a) => a.id === id);
  if (!original) return;
  const copy = structuredClone(original);
  delete copy.id;
  const offset = 12;
  if (copy.points) copy.points = copy.points.map(([x, y]) => [x + offset, y + offset]);
  else if (copy.x1 != null) {
    copy.x1 += offset;
    copy.y1 += offset;
    copy.x2 += offset;
    copy.y2 += offset;
  } else {
    copy.x += offset;
    copy.y += offset;
  }
  const created = addAnnot(slot, copy);
  if (created) select(slot, created.id);
}

function setZoomAndApply(zoom) {
  setZoom(zoom);
  viewer.applyZoom();
}

async function showAbout() {
  const info = await window.api.appInfo();
  const vendored = await window.api.vendorVersions();
  $('about-body').innerHTML = `
    <p><b>Arctic PDF Editor</b> ${info.app}</p>
    <p class="muted">Electron ${info.electron} &middot; Chromium ${info.chrome} &middot; Node ${info.node}<br>
    pdf.js ${vendored['pdfjs-dist'] || '?'} &middot; pdf-lib ${vendored['pdf-lib'] || '?'}<br>
    ${info.platform} ${info.arch}</p>
    <p class="muted">Rendering by pdf.js, writing by pdf-lib. Both MIT/Apache licensed.</p>`;
  openModal('modal-about');
}

function run(command) {
  const fn = commands[command];
  if (!fn) return;
  if (!state.doc && !['file:open', 'help:about', 'help:shortcuts'].includes(command)) {
    toast('Open a PDF first.', 'info', 1800);
    return;
  }
  Promise.resolve(fn()).catch((err) => window.api.errorBox('Something went wrong', err.message));
}

/* -------------------------------- chrome --------------------------------- */

function applyPanels() {
  document.body.classList.toggle('no-thumbs', !state.panels.thumbs);
  document.body.classList.toggle('no-props', !state.panels.props);
  requestAnimationFrame(() => {
    if (state.zoomMode !== 'custom') viewer.fitZoom(state.zoomMode);
  });
}

function updateTitle() {
  const dirtyMark = state.dirty ? '*' : '';
  const name = state.doc ? state.doc.name : null;
  const title = name
    ? `${dirtyMark}${name} - Arctic PDF Editor`
    : 'Arctic PDF Editor';
  window.api.setTitle(title);
  $('doc-name').textContent = name ? `${dirtyMark}${name}` : 'No document open';
  $('doc-path').textContent = state.doc && state.doc.path ? state.doc.path : '';
}

function syncToolbar() {
  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === state.tool);
  });
  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
  const has = !!state.doc;
  document.querySelectorAll('[data-needs-doc]').forEach((el) => {
    el.disabled = !has;
  });
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  const total = state.doc ? state.doc.pages.length : 0;
  $('page-total').textContent = total ? `/ ${total}` : '';
  $('page-input').value = total ? state.currentPage + 1 : '';
}

function bindChrome() {
  document.querySelectorAll('[data-command]').forEach((el) => {
    el.addEventListener('click', () => run(el.dataset.command));
  });
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.addEventListener('click', () => setTool(el.dataset.tool));
  });

  $('page-input').addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n >= 1 && state.doc && n <= state.doc.pages.length) {
      viewer.scrollToPage(n - 1, 'smooth');
      selectPages([n - 1]);
    } else {
      syncToolbar();
    }
  });
  $('page-prev').addEventListener('click', () => {
    const n = Math.max(0, state.currentPage - 1);
    viewer.scrollToPage(n, 'smooth');
  });
  $('page-next').addEventListener('click', () => {
    const n = Math.min((state.doc ? state.doc.pages.length : 1) - 1, state.currentPage + 1);
    viewer.scrollToPage(n, 'smooth');
  });

  $('zoom-select').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'fit-width' || v === 'fit-page') viewer.fitZoom(v);
    else setZoomAndApply(Number(v));
  });

  $('find-input').addEventListener('input', debounce(runFind, 220));
  $('find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (findResults.length) stepFind(e.shiftKey ? -1 : 1);
      else runFind();
    }
    if (e.key === 'Escape') toggleFindBar(false);
  });
  $('find-next').addEventListener('click', () => stepFind(1));
  $('find-prev').addEventListener('click', () => stepFind(-1));
  $('find-close').addEventListener('click', () => toggleFindBar(false));
  $('find-case').addEventListener('change', runFind);
  $('find-word').addEventListener('change', runFind);

  // Drag a PDF anywhere onto the window to open it.
  const dropZone = document.body;
  dropZone.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      document.body.classList.add('dropping');
    }
  });
  dropZone.addEventListener('dragleave', (e) => {
    if (e.target === dropZone) document.body.classList.remove('dropping');
  });
  dropZone.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    document.body.classList.remove('dropping');
    const file = e.dataTransfer.files[0];
    if (!/\.pdf$/i.test(file.name)) {
      toast('Only PDF files can be opened.', 'warn');
      return;
    }
    if (!(await confirmDiscard())) return;
    await openDocument({ bytes: await file.arrayBuffer(), name: file.name, path: file.path || null });
  });
}

function debounce(fn, ms) {
  let handle = 0;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------- keyboard -------------------------------- */

const TOOL_KEYS = {
  v: 'select',
  t: 'text',
  d: 'draw',
  h: 'highlight',
  r: 'rect',
  e: 'ellipse',
  l: 'line',
  a: 'arrow',
};

function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    if (isModalOpen()) {
      closeModal();
      return;
    }
    if (viewer.isEditing()) {
      viewer.commitEditor();
      return;
    }
    if ($('find-bar').classList.contains('open')) {
      toggleFindBar(false);
      return;
    }
    if (state.selection) {
      select(state.selection.page, null);
      viewer.refreshAll();
    }
    return;
  }

  if (isTyping() || isModalOpen()) return;
  if (!state.doc) return;

  const key = event.key.toLowerCase();

  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) {
    event.preventDefault();
    removeAnnot(state.selection.page, state.selection.id);
    return;
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey && TOOL_KEYS[key]) {
    event.preventDefault();
    setTool(TOOL_KEYS[key]);
    return;
  }

  if (event.key === 'F3') {
    event.preventDefault();
    stepFind(event.shiftKey ? -1 : 1);
    return;
  }

  if (state.selection && event.key.startsWith('Arrow')) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const map = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const [dx, dy] = map[event.key];
    viewer.nudgeSelection(dx, dy);
    return;
  }

  if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
    event.preventDefault();
    viewer.scrollToPage(Math.min(state.doc.pages.length - 1, state.currentPage + 1), 'smooth');
  } else if (event.key === 'PageUp') {
    event.preventDefault();
    viewer.scrollToPage(Math.max(0, state.currentPage - 1), 'smooth');
  } else if (event.key === 'Home') {
    event.preventDefault();
    viewer.scrollToPage(0, 'smooth');
  } else if (event.key === 'End') {
    event.preventDefault();
    viewer.scrollToPage(state.doc.pages.length - 1, 'smooth');
  }
}

/* -------------------------------- wiring --------------------------------- */

function wireModel() {
  on('doc', () => {
    viewer.rebuild();
    thumbs.rebuild();
    updateTitle();
    syncToolbar();
    syncPagePanel();
    syncMetaPanel();
    syncFormPanel();
    syncStylePanel();
    $('empty-state').style.display = state.doc ? 'none' : '';
    if (state.doc) requestAnimationFrame(() => viewer.fitZoom('fit-width'));
  });

  on('pages', () => {
    viewer.rebuild();
    thumbs.rebuild();
    syncToolbar();
    syncPagePanel();
    syncMetaPanel();
  });

  on('annots', (slot) => {
    if (typeof slot === 'number') thumbs.invalidate(slot);
    syncToolbar();
    syncPagePanel();
  });

  on('selection', () => {
    syncStylePanel();
    viewer.refreshAll();
  });

  on('tool', (tool) => {
    if (tool !== 'image') state.pendingImage = null;
    syncToolbar();
    syncStylePanel();
    document.body.dataset.tool = tool;
  });

  on('dirty', () => {
    window.api.setDirty(state.dirty);
    updateTitle();
    syncToolbar();
  });

  on('zoom', syncToolbar);
  on('current-page', () => {
    syncToolbar();
    syncPagePanel();
  });
  on('page-selection', syncPagePanel);
  on('image-placed', () => setTool('select'));
}

async function boot() {
  initModals();
  initPanels();
  bindChrome();
  wireModel();
  viewer.mount($('page-area'));
  thumbs.mount($('thumb-rail'));

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', debounce(() => {
    if (state.doc && state.zoomMode !== 'custom') viewer.fitZoom(state.zoomMode);
  }, 150));

  window.api.onMenuCommand(run);
  window.api.onOpenFile(async (payload) => {
    if (!(await confirmDiscard())) return;
    await openDocument(payload);
  });

  await initFonts();

  applyPanels();
  updateTitle();
  syncToolbar();
  syncStylePanel();
  emit('tool', state.tool);
}

boot().catch((err) => {
  // Boot failures are silent otherwise, and an editor that never appears is
  // worse than one that explains why.
  document.body.innerHTML = `<pre style="padding:24px;color:#f88">Startup failed:\n${err.stack}</pre>`;
});
