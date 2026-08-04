/**
 * Small UI services: toasts, modal plumbing and the signature pad.
 */

const toastHost = () => document.getElementById('toasts');

export function toast(message, kind = 'info', timeout = 3600) {
  const host = toastHost();
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

/* -------------------------------- modals ------------------------------- */

let openId = null;

export function openModal(id) {
  closeModal();
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.getElementById('modal-backdrop').classList.add('open');
  openId = id;
  const focusable = el.querySelector('input, textarea, select, button');
  if (focusable) requestAnimationFrame(() => focusable.focus());
}

export function closeModal() {
  if (!openId) return;
  const el = document.getElementById(openId);
  if (el) el.classList.remove('open');
  document.getElementById('modal-backdrop').classList.remove('open');
  openId = null;
}

export function isModalOpen() {
  return !!openId;
}

export function initModals() {
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });
}

/* ----------------------------- signature pad --------------------------- */

/**
 * Show the signature pad and resolve with PNG bytes, or null if cancelled.
 * @returns {Promise<{bytes:Uint8Array, mime:string, w:number, h:number}|null>}
 */
export function signaturePad() {
  return new Promise((resolve) => {
    const canvas = document.getElementById('sig-canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 520;
    const cssH = canvas.clientHeight || 200;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let drawing = false;
    let ink = null; // bounds of what has been drawn
    const colorInput = document.getElementById('sig-color');
    const widthInput = document.getElementById('sig-width');

    const mark = (x, y) => {
      const pad = ctx.lineWidth;
      if (!ink) ink = { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad };
      else {
        ink.x0 = Math.min(ink.x0, x - pad);
        ink.y0 = Math.min(ink.y0, y - pad);
        ink.x1 = Math.max(ink.x1, x + pad);
        ink.y1 = Math.max(ink.y1, y + pad);
      }
    };

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const down = (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      ctx.strokeStyle = colorInput.value;
      ctx.lineWidth = Number(widthInput.value) || 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      mark(p.x, p.y);
    };
    const move = (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      mark(p.x, p.y);
    };
    const up = () => {
      drawing = false;
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', up);

    const clearBtn = document.getElementById('sig-clear');
    const insertBtn = document.getElementById('sig-insert');
    const cancelBtn = document.getElementById('sig-cancel');

    const cleanup = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', up);
      clearBtn.removeEventListener('click', onClear);
      insertBtn.removeEventListener('click', onInsert);
      cancelBtn.removeEventListener('click', onCancel);
      closeModal();
    };

    function onClear() {
      ctx.clearRect(0, 0, cssW, cssH);
      ink = null;
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    async function onInsert() {
      if (!ink) {
        cleanup();
        resolve(null);
        return;
      }
      // Trim to the ink so the placed signature has no dead margin.
      const sx = Math.max(0, Math.floor(ink.x0 * dpr));
      const sy = Math.max(0, Math.floor(ink.y0 * dpr));
      const sw = Math.min(canvas.width - sx, Math.ceil((ink.x1 - ink.x0) * dpr));
      const sh = Math.min(canvas.height - sy, Math.ceil((ink.y1 - ink.y0) * dpr));

      const out = document.createElement('canvas');
      out.width = Math.max(1, sw);
      out.height = Math.max(1, sh);
      out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      cleanup();
      resolve({ bytes, mime: 'image/png', w: out.width / dpr, h: out.height / dpr });
    }

    clearBtn.addEventListener('click', onClear);
    insertBtn.addEventListener('click', onInsert);
    cancelBtn.addEventListener('click', onCancel);

    openModal('modal-signature');
  });
}

/* ------------------------------- progress ------------------------------ */

export function setBusy(busy, label) {
  const el = document.getElementById('busy');
  if (!el) return;
  el.classList.toggle('open', !!busy);
  if (label) el.querySelector('.busy-label').textContent = label;
}
