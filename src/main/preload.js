'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The entire surface the renderer gets. No node, no fs, no ipcRenderer - just
 * these calls, each of which is validated on the main-process side.
 */
contextBridge.exposeInMainWorld('api', {
  openPdfDialog: (opts) => ipcRenderer.invoke('dialog:open-pdf', opts || {}),
  openImageDialog: () => ipcRenderer.invoke('dialog:open-image'),
  savePdfDialog: (opts) => ipcRenderer.invoke('dialog:save-pdf', opts || {}),
  saveImageDialog: (opts) => ipcRenderer.invoke('dialog:save-image', opts || {}),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),

  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, bytes) => ipcRenderer.invoke('file:write', { filePath, bytes }),
  joinPath: (dir, name) => ipcRenderer.invoke('file:join', { dir, name }),

  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:open-path', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  messageBox: (opts) => ipcRenderer.invoke('dialog:message', opts),
  errorBox: (title, content) => ipcRenderer.invoke('dialog:error', { title, content }),

  print: (pages) => ipcRenderer.invoke('print:pages', { pages }),

  appInfo: () => ipcRenderer.invoke('app:info'),
  vendorVersions: () => ipcRenderer.invoke('app:vendor-versions'),

  setDirty: (dirty) => ipcRenderer.send('window:dirty', dirty),
  setTitle: (title) => ipcRenderer.send('window:title', title),
  closeNow: () => ipcRenderer.send('window:close-now'),

  onMenuCommand: (handler) => {
    ipcRenderer.on('menu', (_event, command) => handler(command));
  },
  onOpenFile: (handler) => {
    ipcRenderer.on('open-file', (_event, payload) => handler(payload));
  },
});
