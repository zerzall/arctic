/**
 * The page rail: thumbnails, multi-select, and drag-and-drop reordering.
 */
import { state, pages, page as pageAt, selectPages, reorderPages, on, emit } from './model.js';
import { viewSize } from './geometry.js';
import { drawAnnot } from './overlay.js';
import { scrollToPage, hasMoved } from './viewer.js';

const THUMB_WIDTH = 148;

let rail = null;
let items = [];
let observer = null;
let dragSlots = null;

export function mount(el) {
  rail = el;
  rail.addEventListener('dragover', onRailDragOver);
  rail.addEventListener('drop', onRailDrop);
  rail.addEventListener('dragleave', clearDropMarks);
}

export function rebuild() {
  if (!rail) return;
  if (observer) observer.disconnect();
  rail.innerHTML = '';
  items = [];

  if (!state.doc) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) renderThumb(Number(entry.target.dataset.slot));
      }
    },
    { root: rail, rootMargin: '300px 0px' }
  );

  pages().forEach((spec, slot) => {
    const item = document.createElement('div');
    item.className = 'thumb';
    item.dataset.slot = String(slot);
    item.draggable = true;

    const canvas = document.createElement('canvas');
    canvas.className = 'thumb-canvas';

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = String(slot + 1);

    item.append(canvas, label);
    rail.append(item);

    item.addEventListener('click', (e) => onThumbClick(e, slot));
    item.addEventListener('dragstart', (e) => onDragStart(e, slot));
    item.addEventListener('dragend', clearDropMarks);

    items.push({ item, canvas, rendered: false });
    observer.observe(item);
  });

  syncSelection();
}

function onThumbClick(event, slot) {
  if (event.shiftKey && state.selectedPages.size) {
    const anchor = Math.min(...state.selectedPages);
    const from = Math.min(anchor, slot);
    const to = Math.max(anchor, slot);
    const range = [];
    for (let i = from; i <= to; i += 1) range.push(i);
    selectPages(range);
  } else if (event.ctrlKey || event.metaKey) {
    if (state.selectedPages.has(slot) && state.selectedPages.size > 1) {
      state.selectedPages.delete(slot);
      emit('page-selection');
    } else {
      selectPages([slot], { additive: true });
    }
  } else {
    selectPages([slot]);
    scrollToPage(slot, 'smooth');
  }
}

/* ------------------------------ rendering ------------------------------ */

const queue = [];
let working = false;

function renderThumb(slot) {
  const entry = items[slot];
  if (!entry || entry.rendered) return;
  entry.rendered = true;
  queue.push(slot);
  pump();
}

async function pump() {
  if (working) return;
  working = true;
  while (queue.length) {
    const slot = queue.shift();
    // eslint-disable-next-line no-await-in-loop
    await paint(slot);
  }
  working = false;
}

async function paint(slot) {
  const entry = items[slot];
  const spec = pageAt(slot);
  if (!entry || !spec) return;

  const { w, h } = viewSize(spec);
  const scale = THUMB_WIDTH / w;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = entry.canvas;
  canvas.style.width = `${THUMB_WIDTH}px`;
  canvas.style.height = `${Math.round(h * scale)}px`;
  canvas.width = Math.round(w * scale * dpr);
  canvas.height = Math.round(h * scale * dpr);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const source = spec.src ? state.doc.sources[spec.src] : null;
  if (source) {
    try {
      const pdfPage = await source.pdfjs.getPage(spec.index + 1);
      const viewport = pdfPage.getViewport({ scale: scale * dpr, rotation: spec.rotate });
      await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
    } catch {
      /* a thumbnail is not worth reporting an error over */
    }
  }

  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

  // A moved picture has to be lifted from where the page draws it and put back
  // down elsewhere. Copy the page first: the source region and the destination
  // can overlap, and patching the original away would erase what we are about
  // to draw.
  const moved = spec.annots.filter((a) => a.type === 'imgedit' && hasMoved(a));
  let pageCopy = null;
  if (moved.length) {
    pageCopy = document.createElement('canvas');
    pageCopy.width = canvas.width;
    pageCopy.height = canvas.height;
    pageCopy.getContext('2d').drawImage(canvas, 0, 0);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const a of moved) {
      ctx.fillRect(a.origin.x - 1, a.origin.y - 1, a.origin.w + 2, a.origin.h + 2);
    }
    ctx.restore();
  }

  for (const annot of spec.annots) {
    drawAnnot(ctx, annot, { pageCanvas: pageCopy, pageScale: scale * dpr });
  }
}

/** Force a repaint of one thumbnail (after an edit). */
export function invalidate(slot) {
  const entry = items[slot];
  if (!entry) return;
  entry.rendered = false;
  renderThumb(slot);
}

export function invalidateAll() {
  items.forEach((entry, slot) => {
    entry.rendered = false;
    renderThumb(slot);
  });
}

/* ------------------------------ selection ------------------------------ */

export function syncSelection() {
  items.forEach((entry, slot) => {
    entry.item.classList.toggle('selected', state.selectedPages.has(slot));
    entry.item.classList.toggle('current', slot === state.currentPage);
  });
  const current = items[state.currentPage];
  if (current && rail) {
    const top = current.item.offsetTop;
    const bottom = top + current.item.offsetHeight;
    if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight) {
      rail.scrollTo({ top: top - rail.clientHeight / 3, behavior: 'smooth' });
    }
  }
}

/* --------------------------- drag reordering --------------------------- */

function onDragStart(event, slot) {
  if (!state.selectedPages.has(slot)) selectPages([slot]);
  dragSlots = [...state.selectedPages].sort((a, b) => a - b);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragSlots.join(','));
}

function slotBoundaryFromPoint(y) {
  for (let i = 0; i < items.length; i += 1) {
    const box = items[i].item.getBoundingClientRect();
    if (y < box.top + box.height / 2) return i;
  }
  return items.length;
}

function clearDropMarks() {
  for (const entry of items) {
    entry.item.classList.remove('drop-before', 'drop-after');
  }
}

function onRailDragOver(event) {
  if (!dragSlots) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const boundary = slotBoundaryFromPoint(event.clientY);
  clearDropMarks();
  if (boundary < items.length) items[boundary].item.classList.add('drop-before');
  else if (items.length) items[items.length - 1].item.classList.add('drop-after');
}

function onRailDrop(event) {
  if (!dragSlots) return;
  event.preventDefault();
  const boundary = slotBoundaryFromPoint(event.clientY);
  const slots = dragSlots;
  dragSlots = null;
  clearDropMarks();
  reorderPages(slots, boundary);
}

/* -------------------------------- wiring ------------------------------- */

on('page-selection', syncSelection);
on('current-page', syncSelection);
