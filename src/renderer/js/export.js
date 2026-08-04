/**
 * The PDF writer.
 *
 * Takes the editor's plain-data document model and produces real PDF bytes with
 * pdf-lib. Deliberately free of DOM references so the same code path can be
 * exercised from Node in the test suite.
 */
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  BlendMode,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
} from '../vendor/pdf-lib.esm.min.js';
import {
  normRotation,
  toPdfPoint,
  boxAnchor,
  pdfAngle,
  hexToRgb01,
} from './geometry.js';
import { layoutTextAnnot, alignedX, sanitizeForStandardFont } from './textlayout.js';

const FONT_TABLE = {
  Helvetica: {
    '': StandardFonts.Helvetica,
    b: StandardFonts.HelveticaBold,
    i: StandardFonts.HelveticaOblique,
    bi: StandardFonts.HelveticaBoldOblique,
  },
  Times: {
    '': StandardFonts.TimesRoman,
    b: StandardFonts.TimesRomanBold,
    i: StandardFonts.TimesRomanItalic,
    bi: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    '': StandardFonts.Courier,
    b: StandardFonts.CourierBold,
    i: StandardFonts.CourierOblique,
    bi: StandardFonts.CourierBoldOblique,
  },
};

/** Resolve a family/bold/italic triple to a StandardFonts member. */
export function standardFontFor(family, bold, italic) {
  const table = FONT_TABLE[family] || FONT_TABLE.Helvetica;
  const key = `${bold ? 'b' : ''}${italic ? 'i' : ''}`;
  return table[key] || table[''];
}

/** Lazily embeds and caches the standard fonts inside one document. */
export function createFontCache(doc) {
  const cache = new Map();
  return {
    async get(family, bold, italic) {
      const name = standardFontFor(family, bold, italic);
      if (!cache.has(name)) cache.set(name, await doc.embedFont(name));
      return cache.get(name);
    },
  };
}

function color(hex) {
  const c = hexToRgb01(hex);
  return rgb(c.r, c.g, c.b);
}

/* ------------------------------------------------------------------ *
 * Drawing                                                             *
 * ------------------------------------------------------------------ */

async function drawAnnotation(page, spec, annot, ctx) {
  const opacity = annot.opacity == null ? 1 : annot.opacity;
  const angle = degrees(pdfAngle(spec));

  switch (annot.type) {
    case 'text': {
      const font = await ctx.fonts.get(annot.font || 'Helvetica', annot.bold, annot.italic);
      const { lines, size, baselines } = layoutTextAnnot(annot, font);
      if (annot.boxFill) {
        const anchor = boxAnchor(spec, annot);
        page.drawRectangle({
          x: anchor.x,
          y: anchor.y,
          width: annot.w,
          height: annot.h,
          rotate: angle,
          color: color(annot.boxFill),
          opacity,
        });
      }
      const textColor = color(annot.color || '#111111');
      lines.forEach((line, i) => {
        if (!line) return;
        const p = toPdfPoint(spec, alignedX(annot, font, line, size), baselines[i]);
        page.drawText(line, {
          x: p.x,
          y: p.y,
          size,
          font,
          color: textColor,
          rotate: angle,
          opacity,
        });
      });
      break;
    }

    case 'highlight': {
      const anchor = boxAnchor(spec, annot);
      page.drawRectangle({
        x: anchor.x,
        y: anchor.y,
        width: annot.w,
        height: annot.h,
        rotate: angle,
        color: color(annot.color || '#ffe14d'),
        opacity: opacity,
        blendMode: BlendMode.Multiply,
      });
      break;
    }

    case 'rect':
    case 'whiteout':
    case 'blackout': {
      const anchor = boxAnchor(spec, annot);
      const opts = {
        x: anchor.x,
        y: anchor.y,
        width: annot.w,
        height: annot.h,
        rotate: angle,
        opacity,
      };
      if (annot.fill) opts.color = color(annot.fill);
      if (annot.lineWidth > 0 && annot.color) {
        opts.borderColor = color(annot.color);
        opts.borderWidth = annot.lineWidth;
        opts.borderOpacity = opacity;
      }
      page.drawRectangle(opts);
      break;
    }

    case 'ellipse': {
      const cx = annot.x + annot.w / 2;
      const cy = annot.y + annot.h / 2;
      const c = toPdfPoint(spec, cx, cy);
      const opts = {
        x: c.x,
        y: c.y,
        xScale: Math.abs(annot.w) / 2,
        yScale: Math.abs(annot.h) / 2,
        rotate: angle,
        opacity,
      };
      if (annot.fill) opts.color = color(annot.fill);
      if (annot.lineWidth > 0 && annot.color) {
        opts.borderColor = color(annot.color);
        opts.borderWidth = annot.lineWidth;
        opts.borderOpacity = opacity;
      }
      page.drawEllipse(opts);
      break;
    }

    case 'line':
    case 'arrow': {
      const a = toPdfPoint(spec, annot.x1, annot.y1);
      const b = toPdfPoint(spec, annot.x2, annot.y2);
      const stroke = {
        thickness: annot.lineWidth || 2,
        color: color(annot.color || '#e03131'),
        opacity,
      };
      page.drawLine({ start: a, end: b, ...stroke });
      if (annot.type === 'arrow') {
        for (const head of arrowHead(annot)) {
          page.drawLine({
            start: toPdfPoint(spec, head[0][0], head[0][1]),
            end: toPdfPoint(spec, head[1][0], head[1][1]),
            ...stroke,
          });
        }
      }
      break;
    }

    case 'draw': {
      const pts = annot.points || [];
      const stroke = {
        thickness: annot.lineWidth || 2,
        color: color(annot.color || '#e03131'),
        opacity,
      };
      if (pts.length === 1) {
        const p = toPdfPoint(spec, pts[0][0], pts[0][1]);
        page.drawCircle({
          x: p.x,
          y: p.y,
          size: (annot.lineWidth || 2) / 2,
          color: stroke.color,
          opacity,
        });
        break;
      }
      for (let i = 1; i < pts.length; i += 1) {
        page.drawLine({
          start: toPdfPoint(spec, pts[i - 1][0], pts[i - 1][1]),
          end: toPdfPoint(spec, pts[i][0], pts[i][1]),
          ...stroke,
        });
      }
      break;
    }

    case 'image': {
      const img = await ctx.image(annot.imgId);
      if (!img) break;
      const anchor = boxAnchor(spec, annot);
      page.drawImage(img, {
        x: anchor.x,
        y: anchor.y,
        width: annot.w,
        height: annot.h,
        rotate: angle,
        opacity,
      });
      break;
    }

    default:
      break;
  }
}

/** The two short strokes that make an arrow head, in view space. */
export function arrowHead(annot) {
  const dx = annot.x2 - annot.x1;
  const dy = annot.y2 - annot.y1;
  const len = Math.hypot(dx, dy) || 1;
  const size = Math.max(6, (annot.lineWidth || 2) * 4);
  const ux = dx / len;
  const uy = dy / len;
  const spread = 0.45;
  const left = [
    annot.x2 - size * (ux * Math.cos(spread) - uy * Math.sin(spread)),
    annot.y2 - size * (uy * Math.cos(spread) + ux * Math.sin(spread)),
  ];
  const right = [
    annot.x2 - size * (ux * Math.cos(spread) + uy * Math.sin(spread)),
    annot.y2 - size * (uy * Math.cos(spread) - ux * Math.sin(spread)),
  ];
  return [
    [[annot.x2, annot.y2], left],
    [[annot.x2, annot.y2], right],
  ];
}

/* ------------------------------------------------------------------ *
 * Form fields                                                         *
 * ------------------------------------------------------------------ */

/**
 * Apply the values collected in the Forms panel. Errors on individual fields are
 * swallowed on purpose: one malformed widget in a third-party PDF should not
 * cost the user the whole save.
 */
export function applyFormValues(doc, values, flatten) {
  if (!values && !flatten) return { applied: 0, flattened: false };
  let applied = 0;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return { applied: 0, flattened: false };
  }

  for (const [name, value] of Object.entries(values || {})) {
    try {
      const field = form.getField(name);
      if (!field) continue;
      // instanceof rather than constructor.name: the vendored pdf-lib build is
      // minified, so class names are mangled but the exports are not.
      if (field instanceof PDFTextField) field.setText(String(value ?? ''));
      else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
      else if (
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList ||
        field instanceof PDFRadioGroup
      ) {
        if (value) field.select(String(value));
        else field.clear();
      } else continue;
      applied += 1;
    } catch {
      /* keep going */
    }
  }

  let flattened = false;
  if (flatten) {
    try {
      form.flatten();
      flattened = true;
    } catch {
      /* a form that refuses to flatten is left interactive */
    }
  }
  return { applied, flattened };
}

function applyMetadata(doc, meta) {
  if (!meta) return;
  const set = (fn, v) => {
    if (typeof v === 'string') {
      try {
        fn.call(doc, v);
      } catch {
        /* ignore */
      }
    }
  };
  set(doc.setTitle, meta.title);
  set(doc.setAuthor, meta.author);
  set(doc.setSubject, meta.subject);
  set(doc.setCreator, meta.creator);
  set(doc.setProducer, meta.producer || 'Arctic PDF Editor');
  if (Array.isArray(meta.keywords)) {
    try {
      doc.setKeywords(meta.keywords);
    } catch {
      /* ignore */
    }
  } else if (typeof meta.keywords === 'string' && meta.keywords.trim()) {
    try {
      doc.setKeywords(
        meta.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      );
    } catch {
      /* ignore */
    }
  }
  try {
    doc.setModificationDate(meta.modified instanceof Date ? meta.modified : new Date());
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Model helpers                                                       *
 * ------------------------------------------------------------------ */

/**
 * True when the page list is still exactly the source document's pages, in
 * order. In that case we can edit the original document in place and keep its
 * bookmarks, links and interactive form fields instead of rebuilding it.
 */
export function isStructurallyUnchanged(model) {
  const src = model.sources && model.sources.main;
  if (!src) return false;
  if (model.originalPageCount == null) return false;
  if (model.pages.length !== model.originalPageCount) return false;
  return model.pages.every((p, i) => p.src === 'main' && p.index === i);
}

function imageLoader(doc, images) {
  const cache = new Map();
  return async (id) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    const rec = images && images[id];
    if (!rec) return null;
    const bytes = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
    const embedded = /jpe?g/i.test(rec.mime || '')
      ? await doc.embedJpg(bytes)
      : await doc.embedPng(bytes);
    cache.set(id, embedded);
    return embedded;
  };
}

/* ------------------------------------------------------------------ *
 * Entry point                                                         *
 * ------------------------------------------------------------------ */

/**
 * Build the finished PDF.
 *
 * @param {object} model
 * @param {Record<string, Uint8Array>} model.sources  keyed page sources ('main' plus imports)
 * @param {Array} model.pages                          ordered page specs
 * @param {Record<string, {bytes:Uint8Array, mime:string}>} [model.images]
 * @param {object} [model.meta]
 * @param {Record<string, any>} [model.formValues]
 * @param {boolean} [model.flattenForms]
 * @param {number} [model.originalPageCount]
 * @returns {Promise<{bytes: Uint8Array, rebuilt: boolean, warnings: string[]}>}
 */
export async function buildPdf(model) {
  const warnings = [];
  const rebuilt = !isStructurallyUnchanged(model);

  let doc;
  const pageFor = [];

  if (!rebuilt) {
    doc = await PDFDocument.load(model.sources.main, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const pages = doc.getPages();
    model.pages.forEach((_spec, i) => pageFor.push(pages[i]));
    applyFormValues(doc, model.formValues, !!model.flattenForms);
  } else {
    // Page order changed, so build a fresh document and copy pages in.
    const srcDocs = {};
    for (const [key, bytes] of Object.entries(model.sources)) {
      srcDocs[key] = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
    }

    // Field values have to be baked into the sources before copying: copied
    // pages keep their widget appearances but lose the AcroForm that drives them.
    const needsFlatten =
      !!model.flattenForms || (model.formValues && Object.keys(model.formValues).length > 0);
    for (const [key, srcDoc] of Object.entries(srcDocs)) {
      const res = applyFormValues(
        srcDoc,
        key === 'main' ? model.formValues : null,
        needsFlatten
      );
      if (res.flattened && key === 'main') {
        warnings.push('Form fields were flattened because the page order changed.');
      }
    }

    doc = await PDFDocument.create();

    const groups = new Map();
    model.pages.forEach((spec, i) => {
      if (!spec.src) return;
      if (!groups.has(spec.src)) groups.set(spec.src, []);
      groups.get(spec.src).push({ slot: i, index: spec.index });
    });

    const copiedBySlot = new Map();
    for (const [src, list] of groups) {
      const srcDoc = srcDocs[src];
      if (!srcDoc) {
        warnings.push(`Skipped ${list.length} page(s) from a source that is no longer available.`);
        continue;
      }
      const max = srcDoc.getPageCount();
      const valid = list.filter((l) => l.index >= 0 && l.index < max);
      const copies = await doc.copyPages(
        srcDoc,
        valid.map((l) => l.index)
      );
      valid.forEach((l, k) => copiedBySlot.set(l.slot, copies[k]));
    }

    model.pages.forEach((spec, i) => {
      const copied = copiedBySlot.get(i);
      pageFor.push(copied ? doc.addPage(copied) : doc.addPage([spec.baseW, spec.baseH]));
    });
  }

  const ctx = {
    fonts: createFontCache(doc),
    image: imageLoader(doc, model.images),
  };

  let droppedChars = 0;
  for (let i = 0; i < model.pages.length; i += 1) {
    const spec = model.pages[i];
    const page = pageFor[i];
    if (!page) continue;

    page.setRotation(degrees(normRotation(spec.rotate)));

    for (const annot of spec.annots || []) {
      if (annot.hidden) continue;
      if (annot.type === 'text') {
        droppedChars += sanitizeForStandardFont(annot.text || '').dropped;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await drawAnnotation(page, spec, annot, ctx);
      } catch (err) {
        warnings.push(`An annotation on page ${i + 1} could not be written: ${err.message}`);
      }
    }
  }

  if (droppedChars > 0) {
    warnings.push(
      `${droppedChars} character(s) outside the built-in font's character set were replaced with "?".`
    );
  }

  applyMetadata(doc, model.meta);

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, rebuilt, warnings };
}

/**
 * Extract a subset of pages (in the given order) into a standalone document.
 * Used by "Extract selected pages" and "Split into single pages".
 */
export async function extractPages(model, slots) {
  const subset = {
    ...model,
    originalPageCount: -1, // force the rebuild path
    pages: slots.map((s) => model.pages[s]).filter(Boolean),
  };
  return buildPdf(subset);
}
