/**
 * Canvas rendering of annotations.
 *
 * This is the screen twin of export.js: it draws the same shapes with the same
 * geometry, only in view space scaled by the zoom factor instead of PDF space.
 * Keeping the two in one-to-one correspondence is what makes the editor WYSIWYG.
 */
import { annotBounds } from './geometry.js';
import { layoutTextAnnot, alignedX } from './textlayout.js';
import { fontFor, cssFont } from './fonts.js';
import { arrowHead } from './export.js';

export const HANDLE_SIZE = 8;

function stroke(ctx, annot) {
  ctx.strokeStyle = annot.color || '#e03131';
  ctx.lineWidth = Math.max(0.5, (annot.lineWidth || 2));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/**
 * @param {CanvasRenderingContext2D} ctx  already scaled so 1 unit == 1 point
 * @param {object} annot
 * @param {{bitmaps?: Map<string, CanvasImageSource>}} [opts]
 */
export function drawAnnot(ctx, annot, opts = {}) {
  if (annot.hidden) return;
  ctx.save();
  ctx.globalAlpha = annot.opacity == null ? 1 : annot.opacity;

  switch (annot.type) {
    case 'text': {
      const font = fontFor(annot.font || 'Helvetica', annot.bold, annot.italic);
      const { lines, baselines, size } = layoutTextAnnot(annot, font);
      if (annot.boxFill) {
        ctx.fillStyle = annot.boxFill;
        ctx.fillRect(annot.x, annot.y, annot.w, annot.h);
      }
      ctx.fillStyle = annot.color || '#111111';
      ctx.font = cssFont(annot);
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.beginPath();
      ctx.rect(annot.x, annot.y, annot.w, annot.h);
      ctx.clip();
      lines.forEach((line, i) => {
        if (!line) return;
        ctx.fillText(line, alignedX(annot, font, line, size), baselines[i]);
      });
      ctx.restore();
      break;
    }

    case 'highlight':
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = annot.color || '#ffe14d';
      ctx.fillRect(annot.x, annot.y, annot.w, annot.h);
      break;

    case 'rect':
    case 'whiteout':
    case 'blackout':
    case 'cover':
      if (annot.fill) {
        ctx.fillStyle = annot.fill;
        ctx.fillRect(annot.x, annot.y, annot.w, annot.h);
      }
      if (annot.lineWidth > 0 && annot.color) {
        stroke(ctx, annot);
        ctx.strokeRect(annot.x, annot.y, annot.w, annot.h);
      }
      break;

    case 'ellipse': {
      ctx.beginPath();
      ctx.ellipse(
        annot.x + annot.w / 2,
        annot.y + annot.h / 2,
        Math.abs(annot.w) / 2,
        Math.abs(annot.h) / 2,
        0,
        0,
        Math.PI * 2
      );
      if (annot.fill) {
        ctx.fillStyle = annot.fill;
        ctx.fill();
      }
      if (annot.lineWidth > 0 && annot.color) {
        stroke(ctx, annot);
        ctx.stroke();
      }
      break;
    }

    case 'line':
    case 'arrow': {
      stroke(ctx, annot);
      ctx.beginPath();
      ctx.moveTo(annot.x1, annot.y1);
      ctx.lineTo(annot.x2, annot.y2);
      ctx.stroke();
      if (annot.type === 'arrow') {
        for (const [from, to] of arrowHead(annot)) {
          ctx.beginPath();
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(to[0], to[1]);
          ctx.stroke();
        }
      }
      break;
    }

    case 'draw': {
      const pts = annot.points || [];
      if (!pts.length) break;
      stroke(ctx, annot);
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = annot.color || '#e03131';
        ctx.fill();
        break;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      break;
    }

    case 'imgedit': {
      // A picture that belongs to the page, shown where it has been dragged to.
      // The pixels are lifted straight off the rendered page, so the preview
      // stays sharp at whatever zoom the page was last drawn at.
      const source = opts.pageCanvas;
      const scale = opts.pageScale;
      const o = annot.origin;
      if (!source || !scale || !o) break;
      const sx = Math.max(0, Math.round(o.x * scale));
      const sy = Math.max(0, Math.round(o.y * scale));
      const sw = Math.min(source.width - sx, Math.round(o.w * scale));
      const sh = Math.min(source.height - sy, Math.round(o.h * scale));
      if (sw <= 0 || sh <= 0) break;
      ctx.drawImage(source, sx, sy, sw, sh, annot.x, annot.y, annot.w, annot.h);
      break;
    }

    case 'image': {
      const img = opts.bitmaps && opts.bitmaps.get(annot.imgId);
      if (img) ctx.drawImage(img, annot.x, annot.y, annot.w, annot.h);
      else {
        ctx.strokeStyle = '#7aa2f7';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(annot.x, annot.y, annot.w, annot.h);
      }
      break;
    }

    default:
      break;
  }
  ctx.restore();
}

/** Selection outline plus the handles used for resizing. */
export function drawSelection(ctx, annot, scale) {
  const b = annotBounds(annot);
  const px = 1 / scale; // keep chrome a constant width on screen
  ctx.save();
  ctx.setLineDash([4 * px, 3 * px]);
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = '#4c8dff';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);

  const size = HANDLE_SIZE * px;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1 * px;
  for (const h of handlesFor(annot)) {
    ctx.beginPath();
    ctx.rect(h.x - size / 2, h.y - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Handle positions in view space, tagged with the resize behaviour. */
export function handlesFor(annot) {
  if (annot.type === 'line' || annot.type === 'arrow') {
    return [
      { id: 'p1', x: annot.x1, y: annot.y1 },
      { id: 'p2', x: annot.x2, y: annot.y2 },
    ];
  }
  const b = annotBounds(annot);
  const mid = (a, c) => (a + c) / 2;
  const list = [
    { id: 'nw', x: b.x, y: b.y },
    { id: 'ne', x: b.x + b.w, y: b.y },
    { id: 'se', x: b.x + b.w, y: b.y + b.h },
    { id: 'sw', x: b.x, y: b.y + b.h },
  ];
  if (annot.type !== 'draw') {
    list.push(
      { id: 'n', x: mid(b.x, b.x + b.w), y: b.y },
      { id: 'e', x: b.x + b.w, y: mid(b.y, b.y + b.h) },
      { id: 's', x: mid(b.x, b.x + b.w), y: b.y + b.h },
      { id: 'w', x: b.x, y: mid(b.y, b.y + b.h) }
    );
  }
  return list;
}

export const HANDLE_CURSORS = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  p1: 'move',
  p2: 'move',
};

/* ------------------------------ hit testing ---------------------------- */

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** True when a view-space point is on the annotation (with a small tolerance). */
export function hitTest(annot, x, y, tolerance = 4) {
  if (annot.hidden) return false;
  switch (annot.type) {
    case 'line':
    case 'arrow':
      return (
        distToSegment(x, y, annot.x1, annot.y1, annot.x2, annot.y2) <=
        tolerance + (annot.lineWidth || 2) / 2
      );
    case 'draw': {
      const pts = annot.points || [];
      const tol = tolerance + (annot.lineWidth || 2) / 2;
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= tol;
      for (let i = 1; i < pts.length; i += 1) {
        if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) {
          return true;
        }
      }
      return false;
    }
    default: {
      const b = annotBounds(annot);
      return (
        x >= b.x - tolerance &&
        x <= b.x + b.w + tolerance &&
        y >= b.y - tolerance &&
        y <= b.y + b.h + tolerance
      );
    }
  }
}
