/**
 * The page view: pdf.js rasterisation, the annotation overlay, and every mouse
 * interaction the tools need.
 */
import {
  state,
  pages,
  page as pageAt,
  findAnnot,
  addAnnot,
  addAnnots,
  updateAnnot,
  select,
  setCurrentPage,
  pushHistory,
  afterAnnotChange,
  uid,
  emit,
} from './model.js';
import { viewSize, annotBounds, moveAnnot, resizeAnnot } from './geometry.js';
import {
  drawAnnot,
  drawSelection,
  handlesFor,
  hitTest,
  HANDLE_SIZE,
  HANDLE_CURSORS,
} from './overlay.js';
import { fontFor, cssFontStack } from './fonts.js';
import { measuredHeight, TEXT_PADDING, LINE_HEIGHT_RATIO } from './textlayout.js';
import {
  groupRuns,
  mapToStandardFont,
  buildReplacement,
  pickColors,
  runAt,
} from './textedit.js';
import { planRemoval, findImages } from './originals.js';
import { rectFromPdf } from './geometry.js';

/** 1pt at 100% zoom, matching the 96dpi convention other PDF viewers use. */
export const PT_TO_PX = 96 / 72;
/** Guard against absurd canvas allocations at very high zoom. */
const MAX_CANVAS_EDGE = 8192;

const bitmaps = new Map(); // imgId -> ImageBitmap

let container = null;
/** @type {Array<{wrap:HTMLElement, canvas:HTMLCanvasElement, overlay:HTMLCanvasElement, task:any, renderedAt:number}>} */
let views = [];
let observer = null;
let editor = null; // active <textarea>
let searchState = { byPage: new Map(), current: null };
let drag = null;

/* ------------------------------- helpers ------------------------------- */

function scaleFactor() {
  return state.zoom * PT_TO_PX;
}

function sourceFor(spec) {
  return spec && spec.src ? state.doc.sources[spec.src] : null;
}

function pointFromEvent(event, slot) {
  const view = views[slot];
  const rect = view.overlay.getBoundingClientRect();
  const s = scaleFactor();
  return {
    x: (event.clientX - rect.left) / s,
    y: (event.clientY - rect.top) / s,
  };
}

/* ------------------------------ image cache ---------------------------- */

export async function ensureBitmap(imgId) {
  if (!imgId || bitmaps.has(imgId)) return bitmaps.get(imgId);
  const rec = state.doc && state.doc.images[imgId];
  if (!rec) return null;
  const blob = new Blob([rec.bytes], { type: rec.mime || 'image/png' });
  const bmp = await createImageBitmap(blob);
  bitmaps.set(imgId, bmp);
  return bmp;
}

export async function ensureAllBitmaps() {
  const ids = new Set();
  for (const p of pages()) {
    for (const a of p.annots) if (a.type === 'image' && a.imgId) ids.add(a.imgId);
  }
  await Promise.all([...ids].map(ensureBitmap));
}

export function clearBitmaps() {
  bitmaps.clear();
}

/* --------------------------- existing page text ------------------------- */

/**
 * Recognised text runs per page, keyed so a rotation change re-reads them.
 * @type {Map<string, Array<object>>}
 */
const runCache = new Map();
/** The reader's raw text items per page, needed to plan a real deletion. */
const itemCache = new Map();
let hoverRun = null;
let hoverSlot = -1;

function runKey(slot, spec) {
  return `${slot}:${spec.src}:${spec.index}:${spec.rotate}`;
}

/**
 * Read the page's own text and stitch it into editable lines. Positions come
 * back in view space, matching everything else the editor works in.
 */
export async function runsForPage(slot) {
  const spec = pageAt(slot);
  if (!spec || !spec.src) return [];
  const key = runKey(slot, spec);
  if (runCache.has(key)) return runCache.get(key);

  const source = sourceFor(spec);
  if (!source) return [];

  const pdfPage = await source.pdfjs.getPage(spec.index + 1);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: spec.rotate });
  const content = await pdfPage.getTextContent();
  const { Util } = await import('../vendor/pdf.min.mjs');

  const items = [];
  content.items.forEach((item, srcIndex) => {
    if (typeof item.str !== 'string' || !item.str) return;
    const tx = Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 10;
    const style = content.styles && content.styles[item.fontName];
    items.push({
      str: item.str,
      srcIndex,
      x: tx[4],
      y: tx[5],
      width: item.width || 0,
      size,
      angle: Math.atan2(tx[1], tx[0]),
      fontKey: item.fontName,
      ascent: style && style.ascent > 0 ? style.ascent : undefined,
      fontFamily: style ? style.fontFamily : undefined,
    });
  });

  itemCache.set(key, content.items);
  const runs = groupRuns(items);

  // Resolve each run's real font name once, so the replacement can be given the
  // closest built-in font instead of defaulting to Helvetica for everything.
  for (const run of runs) {
    let rawName = '';
    try {
      const font = pdfPage.commonObjs.get(run.fontKey);
      rawName = (font && (font.name || font.fallbackName)) || '';
    } catch {
      // commonObjs only has the font once it has been rendered; the generic
      // family from the text layer is a good enough fallback.
    }
    const family = (items.find((i) => i.fontKey === run.fontKey) || {}).fontFamily;
    run.style = mapToStandardFont(rawName, family);
  }

  runCache.set(key, runs);
  return runs;
}

export function clearRunCache() {
  runCache.clear();
  itemCache.clear();
  imageCache.clear();
  hoverRun = null;
  hoverSlot = -1;
  hoverImage = null;
}

/* ------------------------- pictures already on a page -------------------- */

/** Image placements per page, in view space. */
const imageCache = new Map();
let hoverImage = null;

/**
 * Where the page's own pictures are, in the space the editor works in.
 * @returns {Promise<Array<{ordinal:number, rect:object, axisAligned:boolean}>>}
 */
export async function imagesForPage(slot) {
  const spec = pageAt(slot);
  if (!spec || !spec.src) return [];
  const key = runKey(slot, spec);
  if (imageCache.has(key)) return imageCache.get(key);

  const source = sourceFor(spec);
  if (!source) return [];

  const found = await findImages(spec.src, source.bytes, spec.index);
  const placements = found.placements.map((p) => ({
    ordinal: p.ordinal,
    name: p.name,
    axisAligned: p.axisAligned,
    fingerprint: found.fingerprint,
    rect: rectFromPdf(spec, p.bounds),
  }));
  imageCache.set(key, placements);
  return placements;
}

async function primeImages(slot) {
  try {
    await imagesForPage(slot);
    drawOverlay(slot);
  } catch {
    /* a page whose pictures cannot be located simply offers none to move */
  }
}

export function primeVisibleImages() {
  for (const slot of visibleSlots()) primeImages(slot);
}

function imageAt(placements, x, y) {
  // Smallest first, so a picture inside another can still be picked.
  const hits = placements.filter(
    (p) => x >= p.rect.x && x <= p.rect.x + p.rect.w && y >= p.rect.y && y <= p.rect.y + p.rect.h
  );
  hits.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);
  return hits[0] || null;
}

/**
 * Turn a picture into something the editor can move: an annotation holding the
 * placement it stands for. Once it exists, the ordinary selection machinery
 * drags and resizes it, and the writer turns its box back into a transform.
 */
function beginImageEdit(slot, placement) {
  const spec = pageAt(slot);
  const existing = (spec.annots || []).find(
    (a) => a.type === 'imgedit' && a.ordinal === placement.ordinal
  );
  if (existing) return existing;

  return addAnnot(slot, {
    type: 'imgedit',
    ordinal: placement.ordinal,
    name: placement.name,
    fingerprint: placement.fingerprint,
    axisAligned: placement.axisAligned,
    // Where it started, so the writer can work out how far it moved.
    origin: { ...placement.rect },
    x: placement.rect.x,
    y: placement.rect.y,
    w: placement.rect.w,
    h: placement.rect.h,
    opacity: 1,
  });
}

/** Warm the cache for a page and repaint, so outlines appear as you scroll. */
async function primeRuns(slot) {
  try {
    await runsForPage(slot);
    drawOverlay(slot);
  } catch {
    /* a page whose text cannot be read simply offers nothing to edit */
  }
}

export function primeVisibleRuns() {
  for (const slot of visibleSlots()) primeRuns(slot);
}

/**
 * Sample the page canvas to find what colour the glyphs are and what colour the
 * paper behind them is. Returns null when the page has not been rasterised yet.
 */
function sampleColors(slot, run) {
  const view = views[slot];
  if (!view || !view.canvas.width) return null;
  const spec = pageAt(slot);
  const { w: pw } = viewSize(spec);
  const scale = view.canvas.width / pw; // device pixels per point
  const ctx = view.canvas.getContext('2d', { willReadFrequently: true });

  const pad = Math.max(2, run.size * 0.35 * scale);
  const x = Math.max(0, Math.floor(run.x * scale));
  const y = Math.max(0, Math.floor(run.y * scale));
  const w = Math.max(1, Math.ceil(run.w * scale));
  const h = Math.max(1, Math.ceil(run.h * scale));

  const ox = Math.max(0, Math.floor(x - pad));
  const oy = Math.max(0, Math.floor(y - pad));
  const ow = Math.min(view.canvas.width - ox, Math.ceil(w + pad * 2));
  const oh = Math.min(view.canvas.height - oy, Math.ceil(h + pad * 2));
  if (ow <= 0 || oh <= 0) return null;

  try {
    const inside = ctx.getImageData(x, y, Math.min(w, view.canvas.width - x), Math.min(h, view.canvas.height - y));
    const outer = ctx.getImageData(ox, oy, ow, oh);
    // Blank the middle of the outer sample so only the surrounding ring counts.
    const ring = ringOf(outer, x - ox, y - oy, w, h);
    return pickColors(inside, ring);
  } catch {
    return null;
  }
}

/** Copy of `image` with the given rectangle removed (alpha zeroed). */
function ringOf(image, rx, ry, rw, rh) {
  const copy = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  for (let yy = Math.max(0, ry); yy < Math.min(image.height, ry + rh); yy += 1) {
    for (let xx = Math.max(0, rx); xx < Math.min(image.width, rx + rw); xx += 1) {
      copy.data[(yy * image.width + xx) * 4 + 3] = 0;
    }
  }
  return copy;
}

/**
 * Replace one recognised run with an editable copy of itself and open it for
 * typing. The original glyphs are covered by a patch in the sampled paper
 * colour; they are not removed from the file.
 */
export async function editRun(slot, run) {
  const spec = pageAt(slot);
  const colors = sampleColors(slot, run) || { background: '#ffffff', text: '#111111' };
  const { cover, text } = buildReplacement(
    run,
    run.style || { font: 'Helvetica', bold: false, italic: false },
    colors,
    uid('pair')
  );

  // Try to arrange for the original words to be deleted from the file rather
  // than merely hidden. The patch is added either way: the page on screen is
  // rendered from the unmodified source, so without it the old text would show
  // through underneath while editing.
  let removal = { ok: false, reason: 'this page is not from a source document' };
  if (spec && spec.src) {
    const source = state.doc.sources[spec.src];
    const items = itemCache.get(runKey(slot, spec));
    if (source && items) {
      removal = await planRemoval(spec.src, source.bytes, spec.index, items, run.itemIndices);
    }
  }
  if (removal.ok) {
    text.removeOriginal = { ordinals: removal.ordinals, fingerprint: removal.fingerprint };
  }

  const created = addAnnots(slot, [cover, text]);
  const textAnnot = created[1];
  if (!textAnnot) return;
  select(slot, textAnnot.id);
  openEditor(slot, textAnnot.id, false, { selectAll: true });
  emit('text-replaced', { removed: removal.ok, reason: removal.reason });
}

/* ------------------------------- layout -------------------------------- */

export function mount(el) {
  container = el;
  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('wheel', onWheel, { passive: false });
}

/** Rebuild every page wrapper. Call when the page list changes. */
export function rebuild() {
  if (!container) return;
  closeEditor(false);
  clearRunCache();
  if (observer) observer.disconnect();
  container.innerHTML = '';
  views = [];

  if (!state.doc) {
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');

  const specs = pages();
  observer = new IntersectionObserver(onIntersect, {
    root: container,
    rootMargin: '600px 0px',
  });

  specs.forEach((spec, slot) => {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.slot = String(slot);

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';

    const overlay = document.createElement('canvas');
    overlay.className = 'page-overlay';

    const label = document.createElement('div');
    label.className = 'page-number';
    label.textContent = String(slot + 1);

    wrap.append(canvas, overlay, label);
    container.append(wrap);

    const view = { wrap, canvas, overlay, task: null, renderedAt: 0 };
    views.push(view);
    attachPointerHandlers(view, slot);
    observer.observe(wrap);
  });

  applyZoom();
}

/** Resize all pages to the current zoom and re-rasterise what is on screen. */
export function applyZoom() {
  if (!state.doc || !views.length) return;
  const s = scaleFactor();
  pages().forEach((spec, slot) => {
    const { w, h } = viewSize(spec);
    const view = views[slot];
    if (!view) return;
    view.wrap.style.width = `${Math.round(w * s)}px`;
    view.wrap.style.height = `${Math.round(h * s)}px`;
    view.renderedAt = 0;
  });
  renderVisible();
  emit('zoom-applied');
}

export function fitZoom(mode) {
  if (!state.doc || !container) return;
  const specs = pages();
  const slot = Math.min(state.currentPage, specs.length - 1);
  const spec = specs[slot] || specs[0];
  if (!spec) return;
  const { w, h } = viewSize(spec);
  const availW = container.clientWidth - 56;
  const availH = container.clientHeight - 56;
  const zoom = mode === 'fit-page' ? Math.min(availW / w, availH / h) : availW / w;
  state.zoom = Math.max(0.1, Math.min(8, zoom / PT_TO_PX));
  state.zoomMode = mode;
  applyZoom();
  emit('zoom');
}

function onIntersect(entries) {
  for (const entry of entries) {
    const slot = Number(entry.target.dataset.slot);
    if (entry.isIntersecting) renderPage(slot);
    else releasePage(slot);
  }
}

function visibleSlots() {
  if (!container) return [];
  const top = container.scrollTop - 600;
  const bottom = container.scrollTop + container.clientHeight + 600;
  const out = [];
  views.forEach((v, slot) => {
    const y = v.wrap.offsetTop;
    if (y + v.wrap.offsetHeight >= top && y <= bottom) out.push(slot);
  });
  return out;
}

export function renderVisible() {
  for (const slot of visibleSlots()) renderPage(slot);
}

function releasePage(slot) {
  const view = views[slot];
  if (!view) return;
  if (view.task) {
    try {
      view.task.cancel();
    } catch {
      /* already finished */
    }
    view.task = null;
  }
  // Drop the backing store; the wrapper keeps its size so scrolling stays stable.
  view.canvas.width = 0;
  view.canvas.height = 0;
  view.renderedAt = 0;
}

/* ------------------------------ rendering ------------------------------ */

async function renderPage(slot) {
  const view = views[slot];
  const spec = pageAt(slot);
  if (!view || !spec) return;

  const s = scaleFactor();
  if (view.renderedAt === s) {
    drawOverlay(slot);
    return;
  }
  view.renderedAt = s;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = viewSize(spec);
  let deviceScale = s * dpr;
  const longest = Math.max(w, h) * deviceScale;
  if (longest > MAX_CANVAS_EDGE) deviceScale *= MAX_CANVAS_EDGE / longest;

  const cssW = Math.round(w * s);
  const cssH = Math.round(h * s);
  view.canvas.style.width = `${cssW}px`;
  view.canvas.style.height = `${cssH}px`;
  view.canvas.width = Math.max(1, Math.round(w * deviceScale));
  view.canvas.height = Math.max(1, Math.round(h * deviceScale));

  const ctx = view.canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, view.canvas.width, view.canvas.height);

  const source = sourceFor(spec);
  if (source) {
    try {
      if (view.task) view.task.cancel();
      const pdfPage = await source.pdfjs.getPage(spec.index + 1);
      const viewport = pdfPage.getViewport({ scale: deviceScale, rotation: spec.rotate });
      view.task = pdfPage.render({ canvas: view.canvas, canvasContext: ctx, viewport });
      await view.task.promise;
      view.task = null;
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') {
        ctx.fillStyle = '#b91c1c';
        ctx.font = `${14 * dpr}px sans-serif`;
        ctx.fillText(`Page could not be rendered: ${err.message}`, 12 * dpr, 24 * dpr);
      }
      view.renderedAt = 0;
    }
  }

  drawOverlay(slot);
  // Colour sampling reads this canvas, so runs are only worth collecting once
  // the page behind them exists.
  if (state.tool === 'edittext') primeRuns(slot);
}

/** Redraw just the annotation layer of one page. */
export function drawOverlay(slot) {
  const view = views[slot];
  const spec = pageAt(slot);
  if (!view || !spec) return;

  const s = scaleFactor();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = viewSize(spec);
  const cssW = Math.round(w * s);
  const cssH = Math.round(h * s);

  view.overlay.style.width = `${cssW}px`;
  view.overlay.style.height = `${cssH}px`;
  view.overlay.width = Math.max(1, Math.round(cssW * dpr));
  view.overlay.height = Math.max(1, Math.round(cssH * dpr));

  const ctx = view.overlay.getContext('2d');
  ctx.clearRect(0, 0, view.overlay.width, view.overlay.height);
  ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);

  // The page underneath still shows every picture where the file puts it, so a
  // moved one has to be patched out of its old position and redrawn here.
  const moved = spec.annots.filter((a) => a.type === 'imgedit' && hasMoved(a));
  for (const annot of moved) coverOriginalImage(ctx, slot, annot);

  for (const annot of spec.annots) {
    if (editor && editor.dataset.annotId === annot.id) continue; // being typed into
    drawAnnot(ctx, annot, { bitmaps, pageCanvas: view.canvas, pageScale: canvasScale(view, spec) });
  }

  if (drag && drag.slot === slot && drag.preview) {
    drawAnnot(ctx, drag.preview, { bitmaps });
  }

  // With the picture tool active, outline what can be moved.
  if (state.tool === 'editimage') {
    const placements = imageCache.get(runKey(slot, spec));
    if (placements) {
      const px = 1 / s;
      const lifted = new Set(
        spec.annots.filter((a) => a.type === 'imgedit').map((a) => a.ordinal)
      );
      ctx.save();
      for (const placement of placements) {
        if (lifted.has(placement.ordinal)) continue;
        const isHover = hoverSlot === slot && hoverImage === placement;
        ctx.fillStyle = isHover ? 'rgba(46,204,113,0.18)' : 'rgba(46,204,113,0.07)';
        ctx.fillRect(placement.rect.x, placement.rect.y, placement.rect.w, placement.rect.h);
        ctx.strokeStyle = isHover ? '#2ecc71' : 'rgba(46,204,113,0.5)';
        ctx.lineWidth = (isHover ? 1.5 : 1) * px;
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeRect(placement.rect.x, placement.rect.y, placement.rect.w, placement.rect.h);
      }
      ctx.restore();
    }
  }

  // With the text tool active, show what the editor can actually recognise -
  // guessing where a click will land is the worst part of editors like this.
  if (state.tool === 'edittext') {
    const runs = runCache.get(runKey(slot, spec));
    if (runs) {
      const px = 1 / s;
      ctx.save();
      for (const run of runs) {
        const isHover = hoverSlot === slot && hoverRun === run;
        ctx.fillStyle = isHover ? 'rgba(76,141,255,0.22)' : 'rgba(76,141,255,0.08)';
        ctx.fillRect(run.x, run.y, run.w, run.h);
        ctx.strokeStyle = isHover ? '#4c8dff' : 'rgba(76,141,255,0.45)';
        ctx.lineWidth = (isHover ? 1.5 : 1) * px;
        ctx.strokeRect(run.x, run.y, run.w, run.h);
      }
      ctx.restore();
    }
  }

  const hits = searchState.byPage.get(slot);
  if (hits) {
    for (const r of hits) {
      const isCurrent =
        searchState.current &&
        searchState.current.page === slot &&
        searchState.current.rect === r;
      ctx.save();
      ctx.globalAlpha = isCurrent ? 0.55 : 0.3;
      ctx.fillStyle = isCurrent ? '#ff9f1a' : '#ffe14d';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }

  if (state.selection && state.selection.page === slot) {
    const annot = findAnnot(slot, state.selection.id);
    if (annot && !(editor && editor.dataset.annotId === annot.id)) {
      drawSelection(ctx, annot, s);
    }
  }
}

/** Device pixels per point on a page's rendered canvas. */
function canvasScale(view, spec) {
  if (!view.canvas.width) return 0;
  const { w } = viewSize(spec);
  return view.canvas.width / w;
}

/** Has a picture been dragged away from where the file draws it? */
export function hasMoved(annot) {
  const o = annot.origin;
  if (!o) return false;
  return (
    Math.abs(annot.x - o.x) > 0.01 ||
    Math.abs(annot.y - o.y) > 0.01 ||
    Math.abs(annot.w - o.w) > 0.01 ||
    Math.abs(annot.h - o.h) > 0.01
  );
}

/**
 * Paint over where a picture used to be, using the colour of the paper around
 * it. Only a preview: the saved file simply draws the picture in its new place,
 * with nothing left behind to hide.
 */
function coverOriginalImage(ctx, slot, annot) {
  const o = annot.origin;
  if (!o) return;
  const colors = sampleColors(slot, {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    size: Math.max(6, Math.min(o.w, o.h) * 0.1),
  });
  // A little beyond the edges: a picture's outermost pixels are anti-aliased
  // into the paper, and without the bleed they survive as a ghost outline.
  const bleed = 1;
  ctx.save();
  ctx.fillStyle = (colors && colors.background) || '#ffffff';
  ctx.fillRect(o.x - bleed, o.y - bleed, o.w + bleed * 2, o.h + bleed * 2);
  ctx.restore();
}

export function refreshPage(slot) {
  drawOverlay(slot);
}

export function refreshAll() {
  views.forEach((_v, slot) => drawOverlay(slot));
}

/**
 * Rasterise one page including annotations, for printing and PNG export.
 * @returns {Promise<{dataUrl:string, width:number, height:number}>}
 */
export async function renderPageImage(slot, targetScale = 2) {
  const spec = pageAt(slot);
  if (!spec) return null;
  await ensureAllBitmaps();
  const { w, h } = viewSize(spec);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * targetScale));
  canvas.height = Math.max(1, Math.round(h * targetScale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const source = sourceFor(spec);
  if (source) {
    const pdfPage = await source.pdfjs.getPage(spec.index + 1);
    const viewport = pdfPage.getViewport({ scale: targetScale, rotation: spec.rotate });
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
  }

  ctx.setTransform(targetScale, 0, 0, targetScale, 0, 0);

  // Same dance as the thumbnails: copy the page before patching a moved
  // picture out of it, because the copy is where the picture comes from.
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
    drawAnnot(ctx, annot, { bitmaps, pageCanvas: pageCopy, pageScale: targetScale });
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

/* ------------------------------ navigation ----------------------------- */

let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const centre = container.scrollTop + container.clientHeight / 2;
    let best = 0;
    let bestDist = Infinity;
    views.forEach((v, slot) => {
      const mid = v.wrap.offsetTop + v.wrap.offsetHeight / 2;
      const d = Math.abs(mid - centre);
      if (d < bestDist) {
        bestDist = d;
        best = slot;
      }
    });
    setCurrentPage(best);
    if (state.tool === 'edittext') primeVisibleRuns();
  });
}

function onWheel(event) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.zoom = Math.max(0.1, Math.min(8, state.zoom * factor));
  state.zoomMode = 'custom';
  applyZoom();
  emit('zoom');
}

export function scrollToPage(slot, behavior = 'auto') {
  const view = views[slot];
  if (!view || !container) return;
  container.scrollTo({ top: view.wrap.offsetTop - 16, behavior });
}

export function scrollToRect(slot, rect) {
  const view = views[slot];
  if (!view || !container) return;
  const s = scaleFactor();
  const top = view.wrap.offsetTop + rect.y * s - container.clientHeight / 3;
  container.scrollTo({ top, behavior: 'smooth' });
}

/* ------------------------------ interaction ---------------------------- */

/** Tools that are created by dragging a box. */
const BOX_TOOLS = new Set(['highlight', 'rect', 'ellipse', 'whiteout', 'blackout', 'text']);

function styleForTool(tool) {
  const st = state.style;
  switch (tool) {
    case 'highlight':
      return { color: st.highlightColor, opacity: 0.4 };
    case 'whiteout':
      return { fill: '#ffffff', color: '', lineWidth: 0, opacity: 1 };
    case 'blackout':
      return { fill: '#000000', color: '', lineWidth: 0, opacity: 1 };
    case 'text':
      return {
        color: st.textColor,
        fontSize: st.fontSize,
        font: st.font,
        bold: st.bold,
        italic: st.italic,
        align: st.align,
        opacity: 1,
      };
    default:
      return {
        color: st.color,
        fill: st.fill || undefined,
        lineWidth: st.lineWidth,
        opacity: st.opacity,
      };
  }
}

function attachPointerHandlers(view, slot) {
  view.overlay.addEventListener('pointerdown', (e) => onPointerDown(e, slot));
  view.overlay.addEventListener('pointermove', (e) => onPointerHover(e, slot));
  view.overlay.addEventListener('dblclick', (e) => onDoubleClick(e, slot));
}

function topmostAt(slot, x, y) {
  const spec = pageAt(slot);
  if (!spec) return null;
  for (let i = spec.annots.length - 1; i >= 0; i -= 1) {
    if (hitTest(spec.annots[i], x, y, 4 / scaleFactor() + 2)) return spec.annots[i];
  }
  return null;
}

function handleAt(annot, x, y) {
  const tol = (HANDLE_SIZE / scaleFactor()) * 0.9;
  for (const h of handlesFor(annot)) {
    if (Math.abs(x - h.x) <= tol && Math.abs(y - h.y) <= tol) return h;
  }
  return null;
}

function onPointerHover(event, slot) {
  if (drag) return; // the window-level listener drives an active drag
  const view = views[slot];

  if (state.tool === 'editimage') {
    const { x, y } = pointFromEvent(event, slot);
    const spec = pageAt(slot);
    const placements = (spec && imageCache.get(runKey(slot, spec))) || [];
    const lifted = topmostAt(slot, x, y);
    const hit = lifted && lifted.type === 'imgedit' ? lifted : imageAt(placements, x, y);
    if (hit !== hoverImage || slot !== hoverSlot) {
      const previous = hoverSlot;
      hoverImage = hit;
      hoverSlot = slot;
      if (previous >= 0 && previous !== slot) drawOverlay(previous);
      drawOverlay(slot);
    }
    view.overlay.style.cursor = hit ? 'move' : 'default';
    return;
  }

  if (state.tool === 'edittext') {
    const { x, y } = pointFromEvent(event, slot);
    const spec = pageAt(slot);
    const runs = (spec && runCache.get(runKey(slot, spec))) || [];
    const hit = runAt(runs, x, y);
    if (hit !== hoverRun || slot !== hoverSlot) {
      const previous = hoverSlot;
      hoverRun = hit;
      hoverSlot = slot;
      if (previous >= 0 && previous !== slot) drawOverlay(previous);
      drawOverlay(slot);
    }
    view.overlay.style.cursor = hit ? 'text' : 'default';
    return;
  }

  if (state.tool !== 'select') {
    view.overlay.style.cursor = state.tool === 'draw' ? 'crosshair' : 'crosshair';
    return;
  }
  const { x, y } = pointFromEvent(event, slot);
  let cursor = 'default';
  if (state.selection && state.selection.page === slot) {
    const annot = findAnnot(slot, state.selection.id);
    const h = annot && handleAt(annot, x, y);
    if (h) cursor = HANDLE_CURSORS[h.id] || 'move';
    else if (annot && hitTest(annot, x, y)) cursor = 'move';
  }
  if (cursor === 'default' && topmostAt(slot, x, y)) cursor = 'move';
  view.overlay.style.cursor = cursor;
}

function onPointerDown(event, slot) {
  if (event.button !== 0) return;
  const view = views[slot];
  const { x, y } = pointFromEvent(event, slot);
  view.overlay.setPointerCapture(event.pointerId);
  commitEditor();

  const tool = state.tool;

  if (tool === 'edittext') {
    const spec = pageAt(slot);
    const runs = (spec && runCache.get(runKey(slot, spec))) || [];
    const hit = runAt(runs, x, y);
    if (hit) {
      editRun(slot, hit);
    } else {
      emit('edittext-miss');
    }
    return;
  }

  if (tool === 'editimage') {
    const spec = pageAt(slot);
    const placements = (spec && imageCache.get(runKey(slot, spec))) || [];
    const existing = topmostAt(slot, x, y);

    // Already lifted out for editing: fall through to the normal move/resize.
    if (existing && existing.type === 'imgedit') {
      const handle = handleAt(existing, x, y);
      select(slot, existing.id);
      pushHistory();
      drag = handle
        ? {
            kind: 'resize',
            slot,
            id: existing.id,
            handle: handle.id,
            start: { x, y },
            origin: structuredClone(existing),
            bounds: annotBounds(existing),
            moved: false,
          }
        : { kind: 'move', slot, id: existing.id, start: { x, y }, last: { x, y }, moved: false };
      drawOverlay(slot);
      return;
    }

    const hit = imageAt(placements, x, y);
    if (!hit) {
      emit('editimage-miss');
      return;
    }
    const annot = beginImageEdit(slot, hit);
    if (!annot) return;
    select(slot, annot.id);
    // Press and drag in one gesture, the way moving anything else works.
    pushHistory();
    drag = { kind: 'move', slot, id: annot.id, start: { x, y }, last: { x, y }, moved: false };
    drawOverlay(slot);
    return;
  }

  if (tool === 'select') {
    const selected =
      state.selection && state.selection.page === slot
        ? findAnnot(slot, state.selection.id)
        : null;

    if (selected) {
      const handle = handleAt(selected, x, y);
      if (handle) {
        pushHistory();
        drag = {
          kind: 'resize',
          slot,
          id: selected.id,
          handle: handle.id,
          start: { x, y },
          origin: structuredClone(selected),
          bounds: annotBounds(selected),
          moved: false,
        };
        return;
      }
    }

    const hit = selected && hitTest(selected, x, y) ? selected : topmostAt(slot, x, y);
    if (hit) {
      select(slot, hit.id);
      pushHistory();
      drag = { kind: 'move', slot, id: hit.id, start: { x, y }, last: { x, y }, moved: false };
      drawOverlay(slot);
      return;
    }
    select(slot, null);
    drawOverlay(slot);
    return;
  }

  if (tool === 'image' && state.pendingImage) {
    placePendingImage(slot, x, y);
    return;
  }

  if (tool === 'draw') {
    drag = {
      kind: 'draw',
      slot,
      preview: { type: 'draw', points: [[x, y]], ...styleForTool('draw') },
    };
    return;
  }

  if (tool === 'line' || tool === 'arrow') {
    drag = {
      kind: 'linear',
      slot,
      preview: { type: tool, x1: x, y1: y, x2: x, y2: y, ...styleForTool(tool) },
    };
    return;
  }

  if (BOX_TOOLS.has(tool)) {
    drag = {
      kind: 'box',
      slot,
      start: { x, y },
      preview: { type: tool, x, y, w: 0, h: 0, ...styleForTool(tool) },
    };
  }
}

function onPointerMove(event) {
  if (!drag) return;
  const { x, y } = pointFromEvent(event, drag.slot);

  switch (drag.kind) {
    case 'move': {
      const annot = findAnnot(drag.slot, drag.id);
      if (!annot) return;
      moveAnnot(annot, x - drag.last.x, y - drag.last.y);
      drag.last = { x, y };
      drag.moved = true;
      break;
    }
    case 'resize': {
      const annot = findAnnot(drag.slot, drag.id);
      if (!annot) return;
      applyResize(annot, drag, x, y);
      drag.moved = true;
      break;
    }
    case 'draw': {
      const pts = drag.preview.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) > 0.6) pts.push([x, y]);
      break;
    }
    case 'linear':
      drag.preview.x2 = x;
      drag.preview.y2 = y;
      if (event.shiftKey) {
        const dx = x - drag.preview.x1;
        const dy = y - drag.preview.y1;
        if (Math.abs(dx) > Math.abs(dy)) drag.preview.y2 = drag.preview.y1;
        else drag.preview.x2 = drag.preview.x1;
      }
      break;
    case 'box': {
      let w = x - drag.start.x;
      let h = y - drag.start.y;
      if (event.shiftKey) {
        const size = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * size;
        h = Math.sign(h || 1) * size;
      }
      drag.preview.x = Math.min(drag.start.x, drag.start.x + w);
      drag.preview.y = Math.min(drag.start.y, drag.start.y + h);
      drag.preview.w = Math.abs(w);
      drag.preview.h = Math.abs(h);
      break;
    }
    default:
      break;
  }
  drawOverlay(drag.slot);
}

function applyResize(annot, info, x, y) {
  if (annot.type === 'line' || annot.type === 'arrow') {
    if (info.handle === 'p1') {
      annot.x1 = x;
      annot.y1 = y;
    } else {
      annot.x2 = x;
      annot.y2 = y;
    }
    return;
  }
  const b = info.bounds;
  const box = { x: b.x, y: b.y, w: b.w, h: b.h };
  const right = b.x + b.w;
  const bottom = b.y + b.h;
  const h = info.handle;

  if (h.includes('w')) {
    box.x = Math.min(x, right - 4);
    box.w = right - box.x;
  }
  if (h.includes('e')) box.w = Math.max(4, x - b.x);
  if (h.includes('n')) {
    box.y = Math.min(y, bottom - 4);
    box.h = bottom - box.y;
  }
  if (h.includes('s')) box.h = Math.max(4, y - b.y);

  const fresh = structuredClone(info.origin);
  resizeAnnot(fresh, info.bounds, box);
  Object.assign(annot, fresh);
}

function onPointerUp(event) {
  if (!drag) return;
  const info = drag;
  drag = null;

  const slot = info.slot;
  switch (info.kind) {
    case 'move':
    case 'resize':
      if (info.moved) afterAnnotChange(slot);
      else state.history.undo.pop(); // nothing actually changed
      break;

    case 'draw': {
      // A single click is a legitimate dot, so there is no minimum length here.
      const created = addAnnot(slot, info.preview);
      if (created) select(slot, created.id);
      break;
    }

    case 'linear': {
      const p = info.preview;
      if (Math.hypot(p.x2 - p.x1, p.y2 - p.y1) < 2) break;
      const created = addAnnot(slot, p);
      if (created) select(slot, created.id);
      break;
    }

    case 'box': {
      const p = info.preview;
      if (p.type === 'text') {
        if (p.w < 24 || p.h < 14) {
          p.x = info.start.x;
          p.y = info.start.y;
          p.w = 220;
          p.h = (state.style.fontSize || 12) * LINE_HEIGHT_RATIO + TEXT_PADDING * 2;
        }
        p.text = '';
        const created = addAnnot(slot, p);
        if (created) {
          select(slot, created.id);
          openEditor(slot, created.id, true);
        }
        break;
      }
      if (p.w < 3 || p.h < 3) break;
      const created = addAnnot(slot, p);
      if (created) select(slot, created.id);
      break;
    }

    default:
      break;
  }

  drawOverlay(slot);
  emit('selection');
}

window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
window.addEventListener('pointermove', (e) => {
  if (drag) onPointerMove(e);
});

function onDoubleClick(event, slot) {
  const { x, y } = pointFromEvent(event, slot);
  const hit = topmostAt(slot, x, y);
  if (hit && hit.type === 'text') {
    select(slot, hit.id);
    openEditor(slot, hit.id, false);
  }
}

/* ------------------------------ image tool ----------------------------- */

export function setPendingImage(spec) {
  state.pendingImage = spec;
}

async function placePendingImage(slot, x, y) {
  const spec = state.pendingImage;
  if (!spec) return;
  state.pendingImage = null;
  await ensureBitmap(spec.imgId);
  const created = addAnnot(slot, {
    type: 'image',
    imgId: spec.imgId,
    x: Math.max(0, x - spec.w / 2),
    y: Math.max(0, y - spec.h / 2),
    w: spec.w,
    h: spec.h,
    opacity: 1,
  });
  if (created) select(slot, created.id);
  emit('image-placed');
  drawOverlay(slot);
}

/* ----------------------------- text editing ---------------------------- */

export function openEditor(slot, id, isNew, opts = {}) {
  const annot = findAnnot(slot, id);
  const view = views[slot];
  if (!annot || !view || annot.type !== 'text') return;
  closeEditor(false);

  const s = scaleFactor();
  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.dataset.annotId = id;
  ta.dataset.slot = String(slot);
  ta.dataset.isNew = isNew ? '1' : '';
  ta.value = annot.text || '';
  ta.spellcheck = false;
  Object.assign(ta.style, {
    left: `${annot.x * s}px`,
    top: `${annot.y * s}px`,
    width: `${annot.w * s}px`,
    height: `${annot.h * s}px`,
    padding: `${TEXT_PADDING * s}px`,
    fontSize: `${(annot.fontSize || 12) * s}px`,
    lineHeight: `${(annot.fontSize || 12) * LINE_HEIGHT_RATIO * s}px`,
    fontFamily: cssFontStack(annot.font || 'Helvetica'),
    fontWeight: annot.bold ? '700' : '400',
    fontStyle: annot.italic ? 'italic' : 'normal',
    color: annot.color || '#111111',
    textAlign: annot.align || 'left',
  });

  ta.addEventListener('input', () => {
    annot.text = ta.value;
    growEditor(ta, annot, s);
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      commitEditor();
    }
  });
  ta.addEventListener('blur', () => commitEditor());

  view.wrap.append(ta);
  editor = ta;
  drawOverlay(slot);
  requestAnimationFrame(() => {
    ta.focus();
    // Replacing existing text: select it all, so typing overwrites the line the
    // way it would in any other editor.
    if (opts.selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

function growEditor(ta, annot, s) {
  const needed = measuredHeight(annot, fontFor(annot.font, annot.bold, annot.italic));
  if (needed > annot.h) {
    annot.h = needed;
    ta.style.height = `${annot.h * s}px`;
  }
}

export function commitEditor() {
  if (!editor) return;
  const ta = editor;
  editor = null;
  const slot = Number(ta.dataset.slot);
  const id = ta.dataset.annotId;
  const wasNew = ta.dataset.isNew === '1';
  const annot = findAnnot(slot, id);
  ta.remove();

  if (annot) {
    annot.text = ta.value;
    const font = fontFor(annot.font, annot.bold, annot.italic);
    annot.h = Math.max(annot.h, measuredHeight(annot, font));
    if (!annot.text.trim()) {
      // An empty box is just clutter - drop it (and the history entry if it was
      // created by this very interaction).
      const spec = pageAt(slot);
      const idx = spec.annots.findIndex((a) => a.id === id);
      if (idx >= 0) spec.annots.splice(idx, 1);
      if (wasNew) state.history.undo.pop();
      select(slot, null);
    }
    afterAnnotChange(slot);
  }
  drawOverlay(slot);
}

export function closeEditor(commit = true) {
  if (!editor) return;
  if (commit) commitEditor();
  else {
    editor.remove();
    editor = null;
  }
}

export function isEditing() {
  return !!editor;
}

/** Re-open the editor for the current selection, if it is a text box. */
export function editSelection() {
  if (!state.selection) return;
  const annot = findAnnot(state.selection.page, state.selection.id);
  if (annot && annot.type === 'text') openEditor(state.selection.page, state.selection.id, false);
}

/* -------------------------------- search ------------------------------- */

export function setSearch(byPage, current) {
  searchState = { byPage: byPage || new Map(), current: current || null };
  refreshAll();
}

export function clearSearch() {
  searchState = { byPage: new Map(), current: null };
  refreshAll();
}

/** Nudge the selected annotation with the arrow keys. */
export function nudgeSelection(dx, dy) {
  if (!state.selection) return;
  const annot = findAnnot(state.selection.page, state.selection.id);
  if (!annot) return;
  pushHistory();
  moveAnnot(annot, dx, dy);
  afterAnnotChange(state.selection.page);
  drawOverlay(state.selection.page);
}

export function updateSelectedStyle(patch) {
  if (!state.selection) return;
  updateAnnot(state.selection.page, state.selection.id, patch);
  const annot = findAnnot(state.selection.page, state.selection.id);
  if (annot && annot.type === 'text') {
    const font = fontFor(annot.font, annot.bold, annot.italic);
    annot.h = Math.max(annot.h, measuredHeight(annot, font));
  }
  drawOverlay(state.selection.page);
}
