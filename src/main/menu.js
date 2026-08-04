'use strict';

const { Menu, app, shell } = require('electron');

/**
 * The application menu. Every item either performs a stock Electron role or
 * sends a command string to the renderer, which owns all document state.
 *
 * @param {(command: string) => void} send
 * @returns {Menu}
 */
function buildMenu(send) {
  const cmd = (label, command, accelerator, extra = {}) => ({
    label,
    accelerator,
    click: () => send(command),
    ...extra,
  });

  const template = [
    {
      label: '&File',
      submenu: [
        cmd('Open...', 'file:open', 'CmdOrCtrl+O'),
        cmd('Open Recent', 'file:open-recent', undefined, { visible: false }),
        { type: 'separator' },
        cmd('Save', 'file:save', 'CmdOrCtrl+S'),
        cmd('Save As...', 'file:save-as', 'CmdOrCtrl+Shift+S'),
        cmd('Close Document', 'file:close', 'CmdOrCtrl+W'),
        { type: 'separator' },
        cmd('Merge PDFs...', 'file:merge'),
        cmd('Insert Pages From PDF...', 'file:insert-pdf'),
        cmd('Extract Selected Pages...', 'file:extract'),
        cmd('Split Into Single Pages...', 'file:split'),
        { type: 'separator' },
        cmd('Export Page as PNG...', 'file:export-png'),
        cmd('Print...', 'file:print', 'CmdOrCtrl+P'),
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        cmd('Undo', 'edit:undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'edit:redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        // Stock roles so cut/copy/paste keep working inside text fields.
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // No accelerator: the Delete key is handled in the renderer, which knows
        // whether the user is typing into a text box or has an object selected.
        cmd('Delete Selection', 'edit:delete'),
        cmd('Duplicate Selection', 'edit:duplicate', 'CmdOrCtrl+D'),
        cmd('Select All Pages', 'edit:select-all-pages'),
        { type: 'separator' },
        cmd('Find...', 'edit:find', 'CmdOrCtrl+F'),
        cmd('Document Properties...', 'edit:properties'),
      ],
    },
    {
      label: '&Page',
      submenu: [
        cmd('Rotate Left', 'page:rotate-left', 'CmdOrCtrl+['),
        cmd('Rotate Right', 'page:rotate-right', 'CmdOrCtrl+]'),
        { type: 'separator' },
        cmd('Move Up', 'page:move-up'),
        cmd('Move Down', 'page:move-down'),
        cmd('Duplicate', 'page:duplicate'),
        cmd('Insert Blank Page', 'page:insert-blank'),
        cmd('Delete Page', 'page:delete'),
        { type: 'separator' },
        cmd('Flatten Page to Image...', 'page:rasterize'),
      ],
    },
    {
      label: '&Tools',
      submenu: [
        // Single-letter shortcuts live in the renderer (see app.js) so they do
        // not fire while the user is typing into a text box or the find bar.
        cmd('Select  (V)', 'tool:select'),
        cmd('Edit Existing Text  (X)', 'tool:edittext'),
        cmd('Text Box  (T)', 'tool:text'),
        cmd('Freehand Draw  (D)', 'tool:draw'),
        cmd('Highlight  (H)', 'tool:highlight'),
        cmd('Rectangle  (R)', 'tool:rect'),
        cmd('Ellipse  (E)', 'tool:ellipse'),
        cmd('Line  (L)', 'tool:line'),
        cmd('Arrow  (A)', 'tool:arrow'),
        { type: 'separator' },
        cmd('Insert Image...', 'tool:image'),
        cmd('Signature...', 'tool:signature'),
        cmd('White-out Box', 'tool:whiteout'),
        cmd('Black-out Box', 'tool:blackout'),
        { type: 'separator' },
        cmd('Flatten Form Fields', 'tool:flatten-forms'),
      ],
    },
    {
      label: '&View',
      submenu: [
        cmd('Zoom In', 'view:zoom-in', 'CmdOrCtrl+='),
        cmd('Zoom Out', 'view:zoom-out', 'CmdOrCtrl+-'),
        cmd('Actual Size', 'view:zoom-100', 'CmdOrCtrl+0'),
        cmd('Fit Width', 'view:fit-width'),
        cmd('Fit Page', 'view:fit-page'),
        { type: 'separator' },
        cmd('Toggle Page Thumbnails', 'view:toggle-thumbs', 'F4'),
        cmd('Toggle Properties Panel', 'view:toggle-props', 'F8'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'reload', visible: false },
        { role: 'toggleDevTools', accelerator: 'F12' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        cmd('Keyboard Shortcuts', 'help:shortcuts', 'F1'),
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/zerzall/arctic/issues'),
        },
        { type: 'separator' },
        cmd(`About ${app.getName()}`, 'help:about'),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
