// Taking a flowchart out of the app: the picture, the source and the formats each is offered in. DIAGRAM_EXPORTS here is the page's copy of the host's list, held to it by check-format-prose.mjs. It reads FLOW_SVG_NS out of flow-pointer.js.

// ---- taking the diagram out ------------------------------------------------

// Five files, one diagram: the mermaid text as a Markdown document of its own, the drawing as a picture in any of three formats, or the drawing printed onto a sheet of its own. Nothing here touches the document the diagram came out of — an export is a file beside it, and Save is still the only thing that writes into the page.
//
// The drawing is always asked for again rather than lifted off the page: what is on screen carries whatever it has been zoomed and dragged to, and in the editor its selection ring and handles as well.
//
// **Don't add SVG.** Mermaid's SVG is a web page in an SVG's clothing — a stylesheet keyed to a generated id, labels that are HTML, a font list full of CSS keywords no font is named after — and a drawing program reads those as instructions it cannot follow.

// Twice life size, so a picture pasted somewhere and scaled up still reads.
const DIAGRAM_PNG_SCALE = 2;

// The endings a diagram can be saved under. The save window is what offers them on Windows, so this is the page's copy of the same five the host lists in `DIAGRAM_EXPORT_FORMATS` — held here to draw the menu a Mac gets instead, to read the reader's chosen ending back, and to name them in the message when it is none of them. A row may permit more than one spelling; the first is what a file typed without an ending is named off.
const DIAGRAM_EXPORTS = [
  // Every spelling `src/format.rs` names for Markdown, written out because the browser host injects no format list at all and a derived row there would permit nothing. A test holds this line to that table.
  { id: 'md', endings: ['md', 'markdown', 'mdown'], label: 'Markdown', hint: 'The mermaid text, in a document of its own' },
  { id: 'png', endings: ['png'], label: 'PNG', hint: 'The drawing as a picture, to paste anywhere' },
  { id: 'webp', endings: ['webp'], label: 'WebP', hint: 'The same picture, about half the file' },
  { id: 'pdf', endings: ['pdf'], label: 'PDF', hint: 'The drawing on one page, sharp at any size' },
  { id: 'jpg', endings: ['jpg', 'jpeg'], label: 'JPEG', hint: 'For anything that will not take a WebP' },
];

let diagramExportSeq = 0;

// The page color behind the diagram. A drawing on its own has no page to sit on, and a pale-ink theme on nothing is a file that looks blank.
function diagramExportBackground() {
  const style = window.getComputedStyle(document.documentElement);
  return (style.getPropertyValue('--lt-surface') || '').trim() || '#ffffff';
}

// Text as base64, through its own bytes: `btoa` takes one character per byte, so a label with an accent or an emoji in it has to be encoded first.
function diagramBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

// The room around the drawing, so the picture is not the boxes cropped to their own edges. The reading view pays the same in padding.
const DIAGRAM_EXPORT_MARGIN = 24;

// The drawing on its way to becoming pixels, and no further: a web view will only rasterize an SVG by loading it as an image, so one has to exist for a moment. It is never written to a file — see the header. `htmlLabels` off because an image-loaded SVG drops a `<foreignObject>`, leaving shapes with no text in them.
async function diagramDrawingSvg(source) {
  if (!source) return null;
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidRuntimeConfig({ htmlLabels: false }));
  const name = 'leafFlowExport' + (diagramExportSeq += 1);
  let drawn;
  try {
    drawn = (await mermaid.render(name, source)).svg;
  } catch (error) {
    // Mermaid leaves the element it was drawing into behind when it throws.
    const orphan = document.getElementById('d' + name);
    if (orphan && orphan.remove) orphan.remove();
    throw error;
  }
  const root = new DOMParser().parseFromString(drawn, 'image/svg+xml').documentElement;
  const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  // Anything unexpected and the drawing goes out exactly as mermaid wrote it, rather than half-edited by us.
  if (root.tagName !== 'svg' || box.length !== 4 || !(box[2] > 0)) return drawn;
  // The drawing keeps its own coordinates and the view widens around it, which is what puts the margin outside every box rather than moving anything.
  const left = box[0] - DIAGRAM_EXPORT_MARGIN;
  const top = box[1] - DIAGRAM_EXPORT_MARGIN;
  const width = box[2] + DIAGRAM_EXPORT_MARGIN * 2;
  const height = box[3] + DIAGRAM_EXPORT_MARGIN * 2;
  root.setAttribute('viewBox', left + ' ' + top + ' ' + width + ' ' + height);
  root.setAttribute('width', width);
  root.setAttribute('height', height);
  root.style.maxWidth = 'none';
  const behind = root.ownerDocument.createElementNS(FLOW_SVG_NS, 'rect');
  behind.setAttribute('x', left);
  behind.setAttribute('y', top);
  behind.setAttribute('width', width);
  behind.setAttribute('height', height);
  behind.setAttribute('fill', diagramExportBackground());
  root.insertBefore(behind, root.firstChild);
  return new XMLSerializer().serializeToString(root);
}

// The drawing, painted at export size, which both picture rows start from. The markup goes in as a data URL, which is why the page's img-src allows `data:`.
function diagramCanvas(svgText) {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * DIAGRAM_PNG_SCALE));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * DIAGRAM_PNG_SCALE));
      const ink = canvas.getContext('2d');
      if (!ink) {
        reject(new Error('This window cannot make a picture.'));
        return;
      }
      // Painted again here: a picture has no transparency to fall back on once it is dropped into something with a page color of its own.
      ink.fillStyle = diagramExportBackground();
      ink.fillRect(0, 0, canvas.width, canvas.height);
      ink.drawImage(picture, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    picture.onerror = () => reject(new Error('The drawing could not be turned into a picture.'));
    picture.src = 'data:image/svg+xml;base64,' + diagramBase64(svgText);
  });
}

// The drawing, as pixels for the host to encode. `toDataURL('image/png')` writes 32-bit color with a per-row filter, and on a real diagram that is 153 KB where ours is 77 KB. See src/png.rs.
async function diagramPngBase64(svgText) {
  const canvas = await diagramCanvas(svgText);
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let text = '';
  for (let at = 0; at < pixels.length; at += 8192) {
    text += String.fromCharCode.apply(null, pixels.subarray(at, at + 8192));
  }
  return { width: canvas.width, height: canvas.height, pixels: btoa(text) };
}

// WebP holds no more than this many pixels a side, and an ordinary diagram reaches it: a fifty-step left-to-right flowchart is 16,872 across at export size. Past it the canvas answers an empty URL rather than failing, so the refusal has to be ours.
const DIAGRAM_WEBP_LIMIT = 16383;

// The drawing, as a finished file this time: the canvas writes the WebP itself. No quality argument on purpose — that is the encoder's own default and the smallest file it writes, 41 KB on a real diagram against 77 KB for the same pixels as PNG. Every named quality is larger: 44 KB at 82, 54 KB at 90, and asking for 1 switches to lossless at 265 KB, which is three times the PNG.
async function diagramWebpBase64(svgText) {
  const canvas = await diagramCanvas(svgText);
  if (canvas.width > DIAGRAM_WEBP_LIMIT || canvas.height > DIAGRAM_WEBP_LIMIT) {
    throw new Error('This diagram is too big for WebP to hold. Export it as PNG instead.');
  }
  const url = canvas.toDataURL('image/webp');
  // A canvas asked for a type it cannot write answers a PNG instead, so the type in the answer is the only thing that says a WebP was written rather than a PNG about to be saved under the wrong name. Second, so the too-wide case above keeps its own words.
  if (!/^data:image\/webp[;,]/.test(url)) {
    throw new Error('This window cannot write WebP. Export it as PNG instead.');
  }
  return url.slice(url.indexOf(',') + 1);
}

// This web view writes no more than this many pixels a side, and past it the canvas answers an empty URL rather than failing. Bisected on a running window rather than taken from the format: 65,500 answers a JPEG and 65,501 answers `data:,`, so the specification's own 65,535 is thirty-five pixels this engine never reaches and tidying the number up to it puts a drawing straight through the guard. Without this the type check below catches it instead and says this window cannot write JPEG, which sends a reader after a broken app rather than a diagram too wide.
const DIAGRAM_JPEG_LIMIT = 65500;

// A diagram is text on flat fill, the one thing JPEG handles worst, so what a reader sees is ringing around glyphs rather than kilobytes: measured on the export's own canvas, the worst error on a lettered pixel is 32 of 255 at 0.82 against 17 at 0.92, for 18 KB. Named rather than left to the encoder's default, which is this same number today and could move under a web view update.
const DIAGRAM_JPEG_QUALITY = 0.92;

// The drawing as a finished JPEG, the way the WebP row makes a finished WebP.
async function diagramJpegBase64(svgText) {
  const canvas = await diagramCanvas(svgText);
  if (canvas.width > DIAGRAM_JPEG_LIMIT || canvas.height > DIAGRAM_JPEG_LIMIT) {
    throw new Error('This diagram is too big for JPEG to hold. Export it as PNG instead.');
  }
  const url = canvas.toDataURL('image/jpeg', DIAGRAM_JPEG_QUALITY);
  // A canvas asked for a type it cannot write answers a PNG instead, so the type in the answer is the only thing that says a JPEG was written rather than a PNG about to be saved under the wrong name. Second, so the too-wide case above keeps its own words.
  if (!/^data:image\/jpeg[;,]/.test(url)) {
    throw new Error('This window cannot write JPEG. Export it as PNG instead.');
  }
  return url.slice(url.indexOf(',') + 1);
}

// Where a diagram goes to be printed on a sheet of its own. A PDF is rendered rather than encoded, so nothing here can make its bytes: the copy is put in this box, `leaf-paper-diagram` takes everything else off the sheet, and the host prints the page the way it prints a document.
const diagramPrint = document.getElementById('diagramPrint');

// Whether a print is standing, so the appearance hold is let go exactly once however the host answers.
let diagramPrinting = false;

// Everything a print put on the page, taken back off. Run on the failed print as well as the written one, or a reader is left looking at a bare drawing where their document was.
function clearDiagramPrint() {
  if (diagramPrint) diagramPrint.innerHTML = '';
  document.body.classList.remove('leaf-paper-diagram');
  if (!diagramPrinting) return;
  diagramPrinting = false;
  if (window.leafHoldAppearance) window.leafHoldAppearance(false);
}

// The host's answer, written or not: the page goes back to being the document.
window.leafDiagramPrinted = () => clearDiagramPrint();

// The drawing on a sheet of its own. The path was answered before anything was drawn and the copy is the one the picture rows are made from; what is new is putting it somewhere the render can be pointed at.
//
// The size is the drawing's own, read off the drawing rather than off the box around it: under the paper rules a container is as wide as the surface, and a sheet made to that comes out window-wide with the drawing stranded in the middle of it.
function printDiagramAsPdf(drawing, path) {
  if (!diagramPrint) throw new Error('This window cannot print a diagram.');
  diagramPrint.innerHTML = drawing;
  const drawn = diagramPrint.firstElementChild;
  if (!drawn) {
    clearDiagramPrint();
    throw new Error('That diagram could not be printed.');
  }
  document.body.classList.add('leaf-paper-diagram');
  // The paper rules are what the surface is laid out and measured under, and the hold is what keeps the render in the theme on screen rather than the light one a render emulates. Let go by the host's answer, whichever way the print goes.
  diagramPrinting = true;
  if (window.leafHoldAppearance) window.leafHoldAppearance(true);
  const box = drawn.getBoundingClientRect();
  send({
    command: 'printDiagramPdf',
    path,
    width: Math.max(Math.round(box.width), 1),
    height: Math.max(box.height, 1),
  });
}

// Where a diagram was asked to go, against the export that asked. The host answers with a path and nothing else, so the source has to be waiting here for it — and one entry is not enough: a reader can leave one save window standing and press Export on another diagram.
const diagramExportsWaiting = new Map();
let diagramExportToken = 0;

// Ask first, draw after. The ending on the name that comes back is what gets encoded, so nothing is drawn until it does. The source is passed in, because the same export serves the editor's own session and a diagram drawn in the page, which has no session at all. `format` travels only where the reader has already been asked, and leaves the save window that one row to offer.
function exportDiagram(source, format) {
  if (!source) return;
  closeFlowMenu();
  diagramExportToken += 1;
  diagramExportsWaiting.set(diagramExportToken, source);
  const ask = { command: 'pickDiagramPath', token: diagramExportToken };
  if (format) ask.format = format;
  send(ask);
}

// The menu a Mac gets, on any diagram: the corner of a drawn block in the page, the full-window view, or the editor's own bar. Its rows only ever need the text, which is why one menu serves all three.
function openDiagramExportMenu(x, y, source, host) {
  openFlowMenuWith(
    x,
    y,
    DIAGRAM_EXPORTS.map((kind) => ({
      label: kind.label,
      hint: kind.hint,
      run: () => exportDiagram(source, kind.id),
    })),
    host,
  );
}

// The same menu for a note with no file, drawn off the formats the host injected at boot rather than a list kept here — so a sixth readable format appears in it the day `src/format.rs` gains one. It lives beside the export's menu because both are the one menu the app draws, and it opens on a Mac for the same reason: that panel shows no format at all.
function openSaveFormatMenu(button, pick) {
  const formats = window.__leafDocumentFormats || [];
  if (!formats.length) return false;
  const spot = button.getBoundingClientRect();
  openFlowMenuWith(
    spot.left,
    spot.bottom + 6,
    formats.map((format) => ({ label: format.label, run: () => pick(format.ext) })),
    appSurface,
  );
  return true;
}

// Which platform asks the format, and where. Windows draws the formats as a dropdown inside the save window, so the window is the only question and nothing opens over the page. A Mac panel throws every label away and permits every ending at once, so a reader there is shown a name with no ending and nothing to change it with — the menu asks first, and the window is then left the one format they picked. `host` is what that menu hangs off and is clamped inside; the editor's own bar wants none, and gets the sheet.
function beginDiagramExport(source, button, host) {
  if (!source) return;
  if (!isMacPlatform) {
    exportDiagram(source);
    return;
  }
  const spot = button.getBoundingClientRect();
  openDiagramExportMenu(spot.left, spot.bottom + 6, source, host);
}

// The host's answer: where the reader said it goes. The format is the ending they left on the name, so a reader who types one gets it.
window.leafDiagramPathPicked = (token, path) => {
  const source = diagramExportsWaiting.get(token);
  if (source === undefined) return;
  diagramExportsWaiting.delete(token);
  const text = String(path);
  const dot = text.lastIndexOf('.');
  const kind = dot < 0 ? '' : text.slice(dot + 1).toLowerCase();
  // Every spelling a row permits, not just the one that names it: Windows keeps a typed `.jpeg` where the chosen filter allows it, so the row that offers both has to answer to both.
  const row = DIAGRAM_EXPORTS.find((one) => one.endings.includes(kind));
  if (!row) {
    const names = DIAGRAM_EXPORTS.map((one) => one.label).join(', ');
    leafToast('A diagram is written as ' + names + '. Nothing was written.', 'error');
    return;
  }
  exportDiagramAs(row.id, source, path);
};

// The one format the reader named, handed to the host with the path it already answered with: bytes for four of them, and for the PDF a page to print and the size to print it at.
async function exportDiagramAs(kind, source, path) {
  try {
    if (kind === 'md') {
      send({ command: 'exportDiagram', format: 'md', path, data: '```mermaid\n' + source + '\n```\n' });
      return;
    }
    const drawing = await diagramDrawingSvg(source);
    if (!drawing) return;
    if (kind === 'pdf') {
      printDiagramAsPdf(drawing, path);
      return;
    }
    if (kind === 'webp') {
      send({ command: 'exportDiagram', format: 'webp', path, data: await diagramWebpBase64(drawing) });
      return;
    }
    if (kind === 'jpg') {
      send({ command: 'exportDiagram', format: 'jpg', path, data: await diagramJpegBase64(drawing) });
      return;
    }
    const picture = await diagramPngBase64(drawing);
    send({
      command: 'exportDiagram',
      format: 'png',
      path,
      data: picture.pixels,
      width: picture.width,
      height: picture.height,
    });
  } catch (error) {
    leafToast((error && error.message) || 'That diagram could not be exported.', 'error');
  }
}

if (flowSheetExport) {
  flowSheetExport.addEventListener('click', () => {
    if (!flowSession) return;
    // Flushed at the press: the code pane's last keystroke is still unparsed until it is, and the session's text is what gets written out.
    closeFlowLabelBox(true);
    flushFlowCode();
    beginDiagramExport(flowSession.text, flowSheetExport);
  });
}
