'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  net,
  shell,
} = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const { buildMenu } = require('./menu');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const IS_DEV = process.argv.includes('--dev');

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** Path handed to us by the shell (file association / "Open with"), if any. */
let pendingOpenPath = null;
/** Set by the renderer; lets us skip the "unsaved changes" prompt when clean. */
let isDirty = false;
/** Set while we are deliberately tearing the window down after confirmation. */
let forceQuit = false;

// Windows-only; a no-op elsewhere, but it is what groups the taskbar entry.
app.setAppUserModelId('com.arctic.pdfeditor');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/* ------------------------------------------------------------------ *
 * app:// protocol - serves the renderer from disk (works inside asar) *
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  // pdf.js decodes scanner formats (CCITT fax, JBIG2) and JPEG 2000 in
  // WebAssembly, and the streaming instantiation path refuses anything not
  // served as application/wasm.
  '.wasm': 'application/wasm',
};

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    // app://-/index.html  ->  <renderer>/index.html
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.join(RENDERER_DIR, rel === '' ? 'index.html' : rel);

    // Refuse anything that escapes the renderer directory.
    const normalized = path.normalize(target);
    if (!normalized.startsWith(path.normalize(RENDERER_DIR))) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const data = await fsp.readFile(normalized);
      const type = MIME[path.extname(normalized).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Window                                                              *
 * ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#14181d',
    show: false,
    title: 'Arctic PDF Editor',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      const p = pendingOpenPath;
      pendingOpenPath = null;
      openPathInRenderer(p);
    }
  });

  // Never let the page navigate away from the app, and open real links in the
  // user's browser instead of inside the editor.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (forceQuit || !isDirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: 'This document has unsaved changes.',
      detail: 'Do you want to save them before closing?',
    });
    if (choice === 2) return;
    if (choice === 1) {
      forceQuit = true;
      mainWindow.close();
      return;
    }
    // Ask the renderer to save, then close when it reports back.
    mainWindow.webContents.send('menu', 'file:save-then-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  Menu.setApplicationMenu(buildMenu(sendCommand));
  mainWindow.loadURL('app://-/index.html');
}

function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu', command);
  }
}

async function openPathInRenderer(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const data = await fsp.readFile(filePath);
    app.addRecentDocument(filePath);
    mainWindow.webContents.send('open-file', {
      path: filePath,
      name: path.basename(filePath),
      bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

function pdfPathFromArgv(argv) {
  return (
    argv
      .slice(1)
      .filter((a) => !a.startsWith('-'))
      .find((a) => a.toLowerCase().endsWith('.pdf') && fs.existsSync(a)) || null
  );
}

/* ------------------------------------------------------------------ *
 * Single instance / lifecycle                                         *
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const p = pdfPathFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (p) openPathInRenderer(p);
    }
  });

  // macOS "Open with" (harmless on Windows, keeps dev on other platforms sane).
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) openPathInRenderer(filePath);
    else pendingOpenPath = filePath;
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    pendingOpenPath = pdfPathFromArgv(process.argv);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // On macOS an application keeps running with no windows open, and comes
    // back via the dock; everywhere else closing the window means quitting.
    if (process.platform !== 'darwin') app.quit();
  });
}

/* ------------------------------------------------------------------ *
 * IPC                                                                 *
 * ------------------------------------------------------------------ */

const PDF_FILTER = [{ name: 'PDF Documents', extensions: ['pdf'] }];
const IMAGE_FILTER = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }];

function toTransferable(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

ipcMain.handle('dialog:open-pdf', async (_e, { multi = false } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: multi ? 'Select PDF files' : 'Open PDF',
    filters: PDF_FILTER,
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (res.canceled) return [];
  const out = [];
  for (const p of res.filePaths) {
    const data = await fsp.readFile(p);
    app.addRecentDocument(p);
    out.push({ path: p, name: path.basename(p), bytes: toTransferable(data) });
  }
  return out;
});

ipcMain.handle('dialog:open-image', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Insert image',
    filters: IMAGE_FILTER,
    properties: ['openFile'],
  });
  if (res.canceled) return null;
  const p = res.filePaths[0];
  const data = await fsp.readFile(p);
  return { path: p, name: path.basename(p), bytes: toTransferable(data) };
});

ipcMain.handle('dialog:save-pdf', async (_e, { defaultPath, title } = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: title || 'Save PDF as',
    defaultPath,
    filters: PDF_FILTER,
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});

ipcMain.handle('dialog:save-image', async (_e, { defaultPath } = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export page as image',
    defaultPath,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});

ipcMain.handle('dialog:choose-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a destination folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('file:read', async (_e, filePath) => {
  const data = await fsp.readFile(filePath);
  return { path: filePath, name: path.basename(filePath), bytes: toTransferable(data) };
});

ipcMain.handle('file:write', async (_e, { filePath, bytes }) => {
  await fsp.writeFile(filePath, Buffer.from(bytes));
  app.addRecentDocument(filePath);
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('file:join', async (_e, { dir, name }) => path.join(dir, name));

ipcMain.handle('shell:show-item', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('shell:open-path', async (_e, filePath) => shell.openPath(filePath));

ipcMain.handle('shell:open-external', async (_e, url) => {
  if (/^https?:/.test(url)) await shell.openExternal(url);
});

ipcMain.handle('app:info', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.on('window:dirty', (_e, dirty) => {
  isDirty = !!dirty;
});

ipcMain.on('window:title', (_e, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(title);
});

ipcMain.on('window:close-now', () => {
  forceQuit = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('dialog:message', async (_e, opts) => {
  const res = await dialog.showMessageBox(mainWindow, {
    type: opts.type || 'question',
    buttons: opts.buttons || ['OK'],
    defaultId: opts.defaultId ?? 0,
    cancelId: opts.cancelId ?? (opts.buttons ? opts.buttons.length - 1 : 0),
    title: opts.title || 'Arctic PDF Editor',
    message: opts.message || '',
    detail: opts.detail,
  });
  return res.response;
});

ipcMain.handle('dialog:error', async (_e, { title, content }) => {
  dialog.showErrorBox(title || 'Error', content || '');
});

/**
 * Printing. The renderer rasterises the *edited* document to page images, which
 * we lay out in a hidden window and hand to the system print dialog. Going
 * through images means what is printed is exactly what is on screen, including
 * every annotation, without depending on a PDF plugin being present.
 */
ipcMain.handle('print:pages', async (_e, { pages }) => {
  if (!pages || !pages.length) return { ok: false, reason: 'No pages to print.' };

  const body = pages
    .map(
      (p) =>
        `<div class="page" style="width:${p.width}pt;height:${p.height}pt">` +
        `<img src="${p.dataUrl}" style="width:${p.width}pt;height:${p.height}pt">` +
        `</div>`
    )
    .join('');

  const html = `<!doctype html><meta charset="utf-8"><title>Print</title><style>
    @page { margin: 0; }
    html,body { margin:0; padding:0; background:#fff; }
    .page { page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    img { display:block; }
  </style><body>${body}</body>`;

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, javascript: false },
  });

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const result = await new Promise((resolve) => {
      win.webContents.print(
        { silent: false, printBackground: true, margins: { marginType: 'none' } },
        (success, failureReason) => resolve({ ok: success, reason: failureReason })
      );
    });
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// Used by the About box to display the vendored library versions.
ipcMain.handle('app:vendor-versions', async () => {
  try {
    const raw = await fsp.readFile(path.join(RENDERER_DIR, 'vendor', 'versions.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
});

// Exposed only so the renderer can show a file:// path in a tooltip.
ipcMain.handle('path:to-url', (_e, p) => pathToFileURL(p).toString());
