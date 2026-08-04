/**
 * Coordinate math shared by the on-screen overlay and the PDF writer.
 *
 * Annotations are stored in "view space": the space the user actually sees, with
 * the origin at the top-left of the *rotated* page and units in PDF points.
 * That is the only space in which a mouse position is meaningful, so storing it
 * there means the editor never has to guess. Everything below converts view
 * space into the page's own unrotated PDF user space at write time.
 */

/** Normalise any rotation to one of 0 / 90 / 180 / 270. */
export function normRotation(r) {
  const n = Math.round((Number(r) || 0) / 90) * 90;
  return ((n % 360) + 360) % 360;
}

/**
 * Dimensions of a page as the user sees it (i.e. with rotation applied).
 * @param {{baseW:number, baseH:number, rotate:number}} page
 */
export function viewSize(page) {
  const r = normRotation(page.rotate);
  return r % 180 === 0
    ? { w: page.baseW, h: page.baseH }
    : { w: page.baseH, h: page.baseW };
}

/**
 * View space (top-left origin, y down) -> PDF user space (bottom-left, y up).
 *
 * Derivation: the viewer rotates the page image clockwise by `rotate`, so we
 * undo that rotation and then flip the y axis. `cropX`/`cropY` are the lower-left
 * corner of the crop box, because content-stream coordinates are absolute while
 * the visible region starts at the crop box.
 */
export function toPdfPoint(page, x, y) {
  const r = normRotation(page.rotate);
  const pw = page.baseW;
  const ph = page.baseH;
  let px;
  let py;
  switch (r) {
    case 90:
      px = y;
      py = x;
      break;
    case 180:
      px = pw - x;
      py = y;
      break;
    case 270:
      px = pw - y;
      py = ph - x;
      break;
    default:
      px = x;
      py = ph - y;
  }
  return { x: px + (page.cropX || 0), y: py + (page.cropY || 0) };
}

/**
 * Counter-clockwise angle, in degrees, that content drawn in PDF space needs so
 * it comes out horizontal on a rotated page. Conveniently equal to the rotation.
 */
export function pdfAngle(page) {
  return normRotation(page.rotate);
}

/**
 * pdf-lib anchors rectangles, images and text at a corner and rotates about it.
 * For a view-space box the matching anchor is its *bottom-left on screen*.
 */
export function boxAnchor(page, box) {
  return toPdfPoint(page, box.x, box.y + box.h);
}

/** Axis-aligned bounding box of an annotation, in view space. */
export function annotBounds(a) {
  switch (a.type) {
    case 'draw': {
      const pts = a.points || [];
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of pts) {
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      const pad = (a.lineWidth ?? 1) / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const pad = (a.lineWidth ?? 1) / 2 + 3;
      return {
        x: Math.min(a.x1, a.x2) - pad,
        y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2,
        h: Math.abs(a.y2 - a.y1) + pad * 2,
      };
    }
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

/** Move an annotation by a view-space delta. */
export function moveAnnot(a, dx, dy) {
  if (a.type === 'draw') {
    a.points = a.points.map(([x, y]) => [x + dx, y + dy]);
  } else if (a.type === 'line' || a.type === 'arrow') {
    a.x1 += dx;
    a.y1 += dy;
    a.x2 += dx;
    a.y2 += dy;
  } else {
    a.x += dx;
    a.y += dy;
  }
}

/** Scale an annotation into a new bounding box (used by the resize handles). */
export function resizeAnnot(a, from, to) {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mapX = (x) => to.x + (x - from.x) * sx;
  const mapY = (y) => to.y + (y - from.y) * sy;

  if (a.type === 'draw') {
    a.points = a.points.map(([x, y]) => [mapX(x), mapY(y)]);
  } else if (a.type === 'line' || a.type === 'arrow') {
    const x1 = mapX(a.x1);
    const y1 = mapY(a.y1);
    const x2 = mapX(a.x2);
    const y2 = mapY(a.y2);
    a.x1 = x1;
    a.y1 = y1;
    a.x2 = x2;
    a.y2 = y2;
  } else {
    a.x = to.x;
    a.y = to.y;
    a.w = Math.max(4, to.w);
    a.h = Math.max(4, to.h);
    if (a.type === 'text' && a.scaleFont !== false) {
      a.fontSize = Math.max(4, (a.fontSize || 12) * sy);
    }
  }
}

/** `#rrggbb` -> `{r,g,b}` in the 0..1 range pdf-lib wants. */
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return {
    r: ((v >> 16) & 255) / 255,
    g: ((v >> 8) & 255) / 255,
    b: (v & 255) / 255,
  };
}
