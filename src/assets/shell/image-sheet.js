// A picture on the whole window. A reader and nothing else: it shows the element the page already holds, so there is no read, no write and no host command behind it — which is also why a published site gets it for free. Built inside `app`, like the full-window table and diagram, because everything in `app` is replaced on a render and that is what closes it when the document changes.
function imageSheetOverlayElement() {
  return app ? app.querySelector('.image-sheet-overlay') : null;
}

function closeImageSheet() {
  const overlay = imageSheetOverlayElement();
  if (!overlay) return;
  const opener = overlay.__imageSheetOpener;
  const scrim = overlay.__imageSheetScrim;
  overlay.remove();
  if (scrim) scrim.remove();
  leafFocusForKeyboard(opener);
}

// Opening is reading, so the padlock is not asked. A marked missing picture has nothing behind the mark to show, so it never gets here.
function openImageSheet(picture, opener) {
  if (!app || !picture || picture.dataset.imageMissing === 'true') return;
  closeImageSheet();
  const scrim = document.createElement('div');
  scrim.className = 'lt-backdrop';
  scrim.addEventListener('click', closeImageSheet);
  const overlay = document.createElement('section');
  overlay.className = 'image-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  // No header and no words on the glass, so the label is the only thing a screen reader has to go on.
  overlay.setAttribute('aria-label', picture.alt ? `${picture.alt} — full window` : 'Picture, full window');
  overlay.__imageSheetOpener = opener || null;
  overlay.__imageSheetScrim = scrim;
  const shown = document.createElement('img');
  shown.className = 'image-sheet-picture';
  shown.alt = picture.alt || '';
  // The element's live source, never a copy taken earlier: a local picture's address carries a per-render token that beats the web view's decoded-picture cache, so a stale one would still show the file as it was.
  shown.src = picture.currentSrc || picture.src;
  // The close mark is drawn only while the pointer is in this corner, so nothing sits over a picture somebody is looking at.
  const corner = document.createElement('div');
  corner.className = 'image-sheet-corner';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'leaf-sheet-close image-sheet-close';
  close.title = 'Close — or press Escape';
  close.setAttribute('aria-label', 'Close the full-window picture');
  close.innerHTML = `<span class="lt-icon lt-icon-close"></span>`;
  close.addEventListener('click', closeImageSheet);
  corner.appendChild(close);
  // The overlay is the ground, not a panel: the scrim shows through it, so a press anywhere but the picture closes it the way a press on the scrim does.
  overlay.addEventListener('click', (event) => {
    if (event.target !== shown) closeImageSheet();
  });
  overlay.append(shown, corner);
  app.append(scrim, overlay);
  window.requestAnimationFrame(() => {
    scrim.classList.add('open');
    overlay.classList.add('open');
  });
}

// ---- taking a picture out of the document ----------------------------------

// The formats a picture in a note can be written as. This is the page's copy of the same four the host lists in `PICTURE_EXPORT_FORMATS`, held to it by check-format-prose.mjs — here to draw the menu a Mac gets instead of a dropdown, to read the reader's chosen ending back, and to name them in the message when it is none of them. A row may permit more than one spelling; the first is what a file typed without an ending is named off.
const PICTURE_EXPORTS = [
  { id: 'png', endings: ['png'], label: 'PNG', hint: 'The picture, to paste anywhere' },
  { id: 'webp', endings: ['webp'], label: 'WebP', hint: 'The same picture, about half the file' },
  { id: 'jpg', endings: ['jpg', 'jpeg'], label: 'JPEG', hint: 'For anything that will not take a WebP' },
  { id: 'pdf', endings: ['pdf'], label: 'PDF', hint: 'The picture on a page of its own' },
  // Every spelling `src/format.rs` names for Markdown, written out because the browser host injects no format list at all.
  { id: 'md', endings: ['md', 'markdown', 'mdown'], label: 'Markdown', hint: 'A document with the picture in an imgs folder beside it' },
];

// Which picture was asked about, against the export that asked. The host answers with a path and nothing else, so the element has to be waiting here for it — and one entry is not enough: a reader can leave one save window standing and press Export on another picture.
const pictureExportsWaiting = new Map();
let pictureExportToken = 0;

// Ask first, do after. The ending on the name that comes back is what gets written, so nothing is copied, drawn or printed until it does. `format` travels only where the reader has already been asked, and leaves the save window that one row to offer.
function exportPicture(picture, format) {
  if (!picture) return;
  closeFlowMenu();
  pictureExportToken += 1;
  pictureExportsWaiting.set(pictureExportToken, picture);
  const ask = { command: 'pickPicturePath', token: pictureExportToken, source: picture.getAttribute('src') || '' };
  if (format) ask.format = format;
  send(ask);
}

// The menu a Mac gets. It hangs off the reader's own surface, because the block holding the picture scrolls and would clip it.
function openPictureExportMenu(x, y, picture, host) {
  openFlowMenuWith(
    x,
    y,
    PICTURE_EXPORTS.map((kind) => ({
      label: kind.label,
      hint: kind.hint,
      run: () => exportPicture(picture, kind.id),
    })),
    host,
  );
}

// Which platform asks the format, and where — the same split the diagram export makes. Windows draws the formats as a dropdown inside the save window, so the window is the only question and nothing opens over the page. A Mac panel throws every label away and permits every ending at once, so the menu asks first and the window is then left the one format they picked.
function beginPictureExport(picture, button) {
  if (!picture) return;
  if (!isMacPlatform) {
    exportPicture(picture);
    return;
  }
  const spot = button.getBoundingClientRect();
  openPictureExportMenu(spot.left, spot.bottom + 6, picture, appSurface);
}

// The host's answer: where the reader said it goes. The format is the ending they left on the name, so a reader who types one gets it.
window.leafPicturePathPicked = (token, path) => {
  const picture = pictureExportsWaiting.get(token);
  if (picture === undefined) return;
  pictureExportsWaiting.delete(token);
  const text = String(path);
  const dot = text.lastIndexOf('.');
  const kind = dot < 0 ? '' : text.slice(dot + 1).toLowerCase();
  // Every spelling a row permits, not just the one that names it: Windows keeps a typed ending where the chosen filter allows it.
  const row = PICTURE_EXPORTS.find((one) => one.endings.includes(kind));
  if (!row) {
    const names = PICTURE_EXPORTS.map((one) => one.label).join(', ');
    leafToast('A picture is written as ' + names + '. Nothing was written.', 'error');
    return;
  }
  exportPictureAs(row.id, picture, path);
};

// Where a picture goes to be printed on a sheet of its own. A PDF is rendered rather than encoded, so nothing here can make its bytes: a copy of the picture goes in this box, `leaf-paper-picture` takes everything else off the sheet, and the host prints the page the way it prints a document.
const picturePrint = document.getElementById('picturePrint');

// Whether a print is standing, so the appearance hold is let go exactly once however the host answers.
let picturePrinting = false;

// Everything a print put on the page, taken back off. Run on the failed print as well as the written one, or a reader is left looking at a bare picture where their document was.
function clearPicturePrint() {
  if (picturePrint) picturePrint.innerHTML = '';
  document.body.classList.remove('leaf-paper-picture');
  if (!picturePrinting) return;
  picturePrinting = false;
  if (window.leafHoldAppearance) window.leafHoldAppearance(false);
}

// The host's answer, written or not: the page goes back to being the document.
window.leafPicturePrinted = () => clearPicturePrint();

// The picture on a sheet of its own. The path was answered before any of this ran; what is new is putting a copy somewhere the render can be pointed at.
//
// The size is the picture's own pixels, read off the element on screen rather than off the copy just made: the copy has not been laid out yet, and the reader's lane had the original squeezed to whatever fitted. An SVG with no size of its own falls back to the room it is taking on the page.
function printPictureAsPdf(picture, path) {
  if (!picturePrint) throw new Error('This window cannot print a picture.');
  const box = picture.getBoundingClientRect();
  const width = Math.max(Math.round(picture.naturalWidth || box.width), 1);
  const height = Math.max(Math.round(picture.naturalHeight || box.height), 1);
  const shown = document.createElement('img');
  shown.alt = picture.alt || '';
  shown.width = width;
  shown.height = height;
  // The element's live source, never a copy taken earlier: a local picture's address carries a per-render token that beats the web view's decoded-picture cache.
  shown.src = picture.currentSrc || picture.src;
  picturePrint.innerHTML = '';
  picturePrint.appendChild(shown);
  document.body.classList.add('leaf-paper-picture');
  // The paper rules are what the surface is laid out and measured under, and the hold is what keeps the render in the theme on screen rather than the light one a render emulates. The count is what lets the host's own hold and release sit inside this one without stripping it. Let go by the host's answer, whichever way the print goes.
  picturePrinting = true;
  if (window.leafHoldAppearance) window.leafHoldAppearance(true);
  send({ command: 'printPicturePdf', path, width, height });
}

// ---- turning a picture into another kind of picture ------------------------

// WebP holds no more than this many pixels a side. Past it the canvas answers an empty URL rather than failing, so the refusal has to be ours.
const PICTURE_WEBP_LIMIT = 16383;

// The format a picture on disk is already in, read off its own address. The query the render stamps on is dropped first, and the answer is only ever held against a row's own endings — the three picture rows, each of which would otherwise re-encode a file that is already what was asked for.
function pictureSourceEnding(picture) {
  const src = (picture.getAttribute('src') || '').split(/[?#]/)[0];
  const dot = src.lastIndexOf('.');
  return dot < 0 ? '' : src.slice(dot + 1).toLowerCase();
}

// The picture on a canvas, at its own pixels, which every conversion row starts from. `background` is a color to fill before the picture is drawn, or nothing to leave the canvas as it came.
//
// Asked for again in anonymous cross-origin mode rather than drawn off the element on the page: the page's own origin is opaque, so the copy on screen taints the canvas and no pixel of it can be read back. The picture responder answers `*` for a picture and for nothing else, which is what makes this request succeed where it used to be blocked before it loaded.
function pictureCanvas(picture, background) {
  return new Promise((resolve, reject) => {
    const asked = new Image();
    asked.crossOrigin = 'anonymous';
    asked.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, asked.naturalWidth || picture.naturalWidth || 1);
      canvas.height = Math.max(1, asked.naturalHeight || picture.naturalHeight || 1);
      const ink = canvas.getContext('2d');
      if (!ink) {
        reject(new Error('This window cannot make a picture.'));
        return;
      }
      // Nothing painted underneath unless the row asked for it: a picture that came with transparency keeps it in PNG and WebP, and loses it to the page's own surface color in JPEG, which has none to keep.
      if (background) {
        ink.fillStyle = background;
        ink.fillRect(0, 0, canvas.width, canvas.height);
      }
      ink.drawImage(asked, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    asked.onerror = () => reject(new Error('That picture could not be read, so nothing was written.'));
    asked.src = picture.currentSrc || picture.src;
  });
}

// What a JPEG of a picture is written at. Named rather than left to the encoder's default, which is this same number today and could move under a web view update — quietly, under every file the app has already written. It is the diagram export's number too, so one quality covers every JPEG this app writes. Measured on a photograph: 659 KB here against 254 KB at 0.6, where the PNG of the same pixels is 7.8 MB.
const PICTURE_JPEG_QUALITY = 0.92;

// The picture as a finished file in the format asked for. The canvas writes all three, PNG included: the host's own encoder leaves every row unfiltered and reaches for a palette, and both of those are chosen against what a photograph is.
async function pictureFileBase64(picture, type) {
  // JPEG holds no alpha, and an unpainted canvas encodes as solid black rather than as white or as nothing — read back off a running window at `0, 0, 0, 255`. So a picture with transparency is drawn onto the page it was read on, and nothing is said about it: that is what a JPEG is everywhere, and the reader picked the format.
  const canvas = await pictureCanvas(picture, type === 'image/jpeg' ? leafExportBackground() : null);
  if (type === 'image/webp' && (canvas.width > PICTURE_WEBP_LIMIT || canvas.height > PICTURE_WEBP_LIMIT)) {
    throw new Error('This picture is too big for WebP to hold. Export it as PNG instead.');
  }
  const url = type === 'image/jpeg' ? canvas.toDataURL(type, PICTURE_JPEG_QUALITY) : canvas.toDataURL(type);
  // A canvas asked for a type it cannot write answers a PNG instead, so the type in the answer is the only thing that says a WebP was written rather than a PNG about to be saved under the wrong name. Second, so the too-wide case above keeps its own words.
  if (url.indexOf('data:' + type + ';') !== 0 && url.indexOf('data:' + type + ',') !== 0) {
    throw new Error('This window cannot write ' + type.slice(6).toUpperCase() + '. Export it as PNG instead.');
  }
  return url.slice(url.indexOf(',') + 1);
}

// The one format the reader named, handed to the host with the path it already answered with.
async function exportPictureAs(kind, picture, path) {
  try {
    if (kind === 'pdf') {
      printPictureAsPdf(picture, path);
      return;
    }
    const row = PICTURE_EXPORTS.find((one) => one.id === kind);
    if (kind === 'png' || kind === 'webp' || kind === 'jpg') {
      const source = picture.getAttribute('src') || '';
      // Already this format, so nothing is drawn at all: the host copies the file, which is smaller, lossless and exact where a round trip through the canvas is none of the three. Held against every spelling the row permits, so a `.jpeg` picked as a `.jpg` is copied rather than re-encoded — which on a lossy source would lose quality to make a bigger file.
      if (row.endings.includes(pictureSourceEnding(picture))) {
        send({ command: 'exportPicture', format: kind, path, source });
        return;
      }
      // `jpg` is this app's word for the row and `jpeg` is the engine's for the type, which is the one place the two spellings differ.
      const data = await pictureFileBase64(picture, kind === 'jpg' ? 'image/jpeg' : 'image/' + kind);
      send({ command: 'exportPicture', format: kind, path, source, data });
      return;
    }
    if (kind === 'md') {
      // No pixels and no conversion: the host copies the file the picture is drawn from, so this row works for every kind of picture the reading view draws.
      send({
        command: 'exportPicture',
        format: 'md',
        path,
        source: picture.getAttribute('src') || '',
        alt: picture.alt || '',
      });
    }
  } catch (error) {
    leafToast((error && error.message) || 'That picture could not be exported.', 'error');
  }
}

// The corner of a widened picture: open it on the whole window, and write it out. Appearing on hover and on keyboard focus. It rides inside the paragraph and only ever there: a paragraph holding a picture is refused WYSIWYG, so every edit takes it whole by its source range and its DOM is never turned back into Markdown.
function bindImageSheet(root = app) {
  if (!root) return;
  // The reader's own body, not the minimap's: the rail draws a scaled copy of the page carrying the same marks, and a control in it is one nobody can press.
  root.querySelectorAll('.reader-layout > .document-body > p.image-lane').forEach((block) => {
    if (block.querySelector(':scope > .image-lane-corner')) return;
    const picture = block.querySelector(':scope > img');
    if (!picture || picture.dataset.imageMissing === 'true') return;
    // Two controls in one row rather than two pinned at the same spot, the way the diagram's own pair sits.
    const corner = document.createElement('div');
    corner.className = 'image-lane-corner';
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.className = 'image-sheet-open';
    opener.title = 'Open picture on the whole window';
    opener.setAttribute('aria-label', 'Open picture on the whole window');
    opener.innerHTML = `<span class="lt-icon lt-icon-expand"></span>`;
    opener.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImageSheet(picture, opener);
    });
    corner.appendChild(opener);
    // Only a picture on this disk gets one: every row needs the file, and a control that always failed on a picture served from the web would read as a broken app rather than as a picture that is not here.
    if (isLocalImageSrc(picture.getAttribute('src') || '')) {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'image-export-open';
      save.title = 'Export this picture';
      save.setAttribute('aria-label', 'Export this picture');
      save.innerHTML = `<span class="lt-icon lt-icon-export"></span>`;
      save.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginPictureExport(picture, save);
      });
      corner.appendChild(save);
    }
    block.appendChild(corner);
  });
}

function onImageSheetKey(event) {
  if (event.key !== 'Escape' || !imageSheetOverlayElement()) return;
  event.preventDefault();
  event.stopPropagation();
  closeImageSheet();
}
document.addEventListener('keydown', onImageSheetKey, true);
