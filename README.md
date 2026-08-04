# Arctic PDF Editor

A desktop PDF editor for Windows. Open a PDF, mark it up, rearrange its pages,
fill in its forms, and save a real PDF back out — no cloud service, no uploads,
no page limits.

Built with Electron, [pdf.js](https://mozilla.github.io/pdf.js/) for rendering
and [pdf-lib](https://pdf-lib.js.org/) for writing.

![The editor with a document open](build/screenshot.png)

## What it does

**Edit the text that is already there**

- Pick the **Edit Text** tool and every line the editor can recognise is
  outlined. Click one and it becomes an editable box, pre-filled with the
  original wording and pre-selected so typing replaces it
- The replacement keeps the original's position, size and style: it is placed on
  the very same baseline, in whichever built-in font is closest to the embedded
  one (bold and italic included), in the ink colour sampled from the page itself
- **The original words are removed from the file**, not just hidden: the
  operators that drew them are taken out of the page's content stream, so
  nothing is left for another program to extract
- When that cannot be done safely — the text is inside a form XObject, uses a
  font whose operands are glyph indices, or sits on a line where deleting it
  would shift text that stays — the editor says so and covers the original
  instead, rather than risking a damaged page
- Press <kbd>Delete</kbd> on a replaced line to put the original back

**Move the pictures that are already there**

- The **Move Pic** tool outlines every picture the page draws; drag one to move
  it, or use its handles to resize it
- The move is written into the page itself — the placement matrix is rewritten,
  so the picture is genuinely somewhere else in the file rather than covered and
  redrawn, and it keeps its original resolution
- A rotated or skewed picture can be moved but not resized, because scaling it
  along the screen axes would shear it
- Pictures inside a form XObject are not offered, and neither is anything the
  page draws that is not an image

**Annotate**

- Text boxes with the built-in PDF fonts (Helvetica/Arial, Times, Courier),
  bold/italic, size, colour and alignment — written as *real selectable text*,
  not a picture of text
- Freehand pen, highlighter, rectangles, ellipses, lines and arrows
- Images (PNG/JPEG) and a signature pad you draw with the mouse or a pen
- White-out and black-out boxes for covering content
- Select, move, resize, reorder (front/back), nudge with the arrow keys, delete
- Undo/redo across everything, including page operations

**Pages**

- Reorder by dragging thumbnails, move up/down, duplicate, delete
- Rotate one page or a whole selection
- Flatten a page to an image, which permanently destroys the text layer —
  the way to make a black-out box or a text replacement irreversible
- Insert blank pages, or insert pages from another PDF
- Merge several PDFs, extract a selection to a new file, or split one file per page

**Documents**

- Fill interactive form fields (text, checkbox, radio, dropdown, list) and
  optionally flatten them so the values become permanent
- Edit title, author, subject and keywords
- Find text across the document with match highlighting
- Print, and export any page as a 300 dpi PNG
- Opens password-protected PDFs (you are prompted for the password)

Files open by drag-and-drop, from the File menu, or by double-clicking a `.pdf`
once the installer has registered the file association.

## Install on Windows

Download `Arctic PDF Editor-<version>-x64.exe` from the
[releases page](https://github.com/zerzall/arctic/releases) and run it.

- Installs per user, so **no administrator rights are needed**
- Lets you choose the install directory, and creates Start-menu and desktop shortcuts
- Uninstall from *Settings → Apps* like any other program

There is also a `-portable.exe` build that runs straight from a folder or a USB
stick without installing anything.

> The installer is not code-signed, so Windows SmartScreen will show a
> "Windows protected your PC" notice the first time. Choose **More info →
> Run anyway**, or build it yourself from source with the steps below.

## Build it yourself

Requirements: [Node.js](https://nodejs.org/) 22 or newer (electron 43 and
pdfjs-dist 6 both require it). Building the Windows
installer must happen on Windows (electron-builder needs Windows tooling for the
NSIS target).

```bash
git clone https://github.com/zerzall/arctic.git
cd arctic
npm install          # also copies pdf.js/pdf-lib into src/renderer/vendor
npm start            # run the app from source
npm test             # 92 tests over the geometry, text, pictures and PDF writing
npm run dist:win     # -> dist/Arctic PDF Editor-1.0.0-x64.exe (+ portable)
```

`npm run icon` regenerates `build/icon.ico` (needs Python 3; the icon is drawn
by `scripts/make-icon.py` rather than committed as an opaque binary).

Pushing to this repository also builds the installer on a Windows runner — see
[`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml).
Tagging a commit `v1.0.0` attaches the installer to a GitHub release.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | Open / Save / Save As |
| `Ctrl+P` | Print |
| `Ctrl+F`, `F3`, `Shift+F3` | Find, next match, previous match |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+D` | Duplicate the selected object (or pages) |
| `Ctrl+[` / `Ctrl+]` | Rotate the selected pages |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / 100% |
| `Ctrl`+scroll | Zoom |
| `V X I T D H R E L A` | Select, Edit Text, Move Pic, Text box, Pen, Highlight, Rect, Ellipse, Line, Arrow |
| `Delete` | Delete the selected object, or the selected pages |
| Arrow keys | Nudge the selection (`Shift` for 10pt steps) |
| `F4` / `F8` | Toggle the thumbnail and properties panels |

## How it works

```
src/main/       Electron main process: window, menus, dialogs, file IO, printing
  main.js         also serves the UI over a custom app:// scheme
  preload.js      the only bridge the renderer gets (contextIsolation is on)
src/renderer/
  js/geometry.js  view space <-> PDF user space, for every page rotation
  js/textedit.js  recognising the page's own text, and replacing a line of it
  js/contentstream.js a content-stream parser: deleting text, moving pictures
  js/pagestream.js  reading and rewriting a page's raw drawing instructions
  js/textlayout.js line breaking, shared by the screen and the file
  js/export.js    the PDF writer (pdf-lib) - no DOM, so Node can test it
  js/overlay.js   the same shapes drawn on a canvas
  js/model.js     document model, undo history, event bus
  js/viewer.js    pdf.js rasterisation, mouse tools, text editing
  js/thumbs.js    page rail with drag-to-reorder
  js/panels.js    style / page / metadata / form-field inspector
  js/search.js    text extraction and match highlighting
```

Three design decisions are worth calling out:

**Annotations are stored in view space.** Coordinates are kept exactly as the
user sees them — top-left origin, in points, on the *rotated* page — and are
converted to PDF user space only when writing. `geometry.js` holds that
conversion for all four rotations, and `export.js` and `overlay.js` are twins:
one draws to a PDF, the other to a canvas, from the same numbers. That is what
makes the editor WYSIWYG on rotated pages.

**Saving prefers editing the original file over rebuilding it.** If you have not
changed the page order, the original document is loaded, annotated and written
back, so its bookmarks, links and interactive form fields survive untouched. If
pages were reordered, inserted or deleted, the document is rebuilt from copied
pages instead, and form fields are flattened first (with a warning) because
copied pages cannot carry an AcroForm with them.

**Deleting text is planned in the editor and carried out by the writer.**
Removing a word means taking operators out of a content stream, and knowing
*which* operators requires matching what a reader sees against what the stream
draws — which needs pdf.js, available only in the editor. So the editor does the
matching at the moment of the edit and reduces it to a list of operation
ordinals plus a fingerprint of the stream; at save time the writer re-parses the
stream, checks the fingerprint still matches, re-checks that deleting is safe,
and only then cuts the bytes. If any check fails the patch drawn over the
original is kept instead and the save reports it. `contentstream.js` is the
parser this rests on, and it is tested against escaped parentheses, nested
parentheses, octal escapes, `TJ` arrays and inline-image binary that contains
bytes spelling `Tj`.

## Known limitations

- **Text editing removes the original, but not on every page.** Usually the
  words you replace are deleted from the page's content stream and are gone. On
  pages where that cannot be done safely the editor falls back to covering them,
  and *tells you at the time* — those words remain extractable. The checks that
  trigger the fallback are deliberately strict, because the alternative to
  refusing is corrupting a page.
- **Black-out boxes are not redaction.** Unlike a text replacement, a black-out
  box only covers what is underneath; the content stays in the file.

  To make a black-out box permanent — or to be certain about a page that fell
  back to covering — use **Page → Flatten Page to Image**. That turns the page
  into a 200 dpi picture with no text layer at all. The trade-off is that the
  page stops being searchable and selectable, which is why it is a deliberate,
  confirmed action rather than something that happens on save.
- **Editing works line by line, and does not reflow paragraphs.** A replacement
  keeps the shape of the line it stands in for and grows sideways as you type;
  it will not push the following lines down or re-wrap a paragraph.
- **Moving a picture rewrites where it is drawn, not what it is.** The image
  data is untouched, so quality is unaffected; but a picture the page draws more
  than once is moved at each place it appears only if you move it there.
- **Only horizontal text is recognised.** Rotated or vertical runs, and text
  that is really an image (a scan without OCR), are not offered for editing.
- **Text uses the 14 built-in PDF fonts**, which are WinAnsi-encoded. Characters
  outside that range (CJK, for example) are replaced with `?` and the app warns
  you when it happens.
- **Saving a password-protected PDF writes an unprotected copy.** The editor can
  open encrypted files but does not re-encrypt on save.
- Reordering pages of a form document flattens the form (see above).

## Licence

MIT — see [LICENSE](LICENSE). pdf.js is Apache-2.0, pdf-lib is MIT; both are
vendored into `src/renderer/vendor` at install time by `scripts/copy-vendor.js`.
