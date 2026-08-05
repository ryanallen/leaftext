// A drawn diagram, on the whole window. The reading column is narrow on purpose,
// so anything wider is read today by leaning into a box the height of a paragraph
// and dragging around inside it. Here it is drawn again at the overlay's size
// rather than carried across as an SVG — mermaid lays a diagram out to whatever
// room it is given, and that is the entire point of the button.
//
// It is built here rather than in app-shell.html because everything inside `app`
// is replaced on every render. Inside `app` is also what makes it work: the pan,
// the wheel, the click and the double-click are all delegated off that element,
// and the stage is the `pre.mermaid[data-processed="true"]` they already look for.

// No variable holds it: a `let` in this fragment is still in its dead zone while
// theme.js runs the first render, and the first render is one of the things that
// closes the overlay.
function diagramOverlayElement() {
  return app ? app.querySelector('.diagram-overlay') : null;
}

function openDiagramOverlay(diagram, opener) {
  if (!app || !diagram || diagram.__mermaidSource == null) return;
  closeDiagramOverlay();
  const scrim = document.createElement('div');
  scrim.className = 'lt-backdrop';
  scrim.addEventListener('click', closeDiagramOverlay);
  const overlay = document.createElement('div');
  overlay.className = 'diagram-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Diagram, full window');
  // Where focus goes back to. On the element, not in a variable of ours, for the
  // same reason the overlay itself is found by query.
  overlay.__diagramOpener = opener || null;
  overlay.__diagramScrim = scrim;
  // The block this is a picture of. Both edit buttons act on that, never on the
  // stage: the stage has no place in the file behind it.
  overlay.__diagramBlock = diagram;
  const stage = document.createElement('pre');
  stage.className = 'mermaid diagram-stage';
  // Read by both sweeps in decorate.js, which must leave this one alone: it draws
  // itself, and an overlay-sized SVG in the render memo comes back in the page at
  // that size.
  stage.dataset.diagramStage = 'true';
  stage.__mermaidSource = diagram.__mermaidSource;
  overlay.appendChild(stage);
  app.appendChild(scrim);
  app.appendChild(overlay);
  window.requestAnimationFrame(() => {
    scrim.classList.add('open');
    overlay.classList.add('open');
  });
  drawDiagramStage(stage);
}

function closeDiagramOverlay() {
  if (!app) return;
  const overlay = diagramOverlayElement();
  if (!overlay) return;
  overlay.remove();
  if (overlay.__diagramScrim) overlay.__diagramScrim.remove();
  leafFocusForKeyboard(overlay.__diagramOpener);
}

// Escape, in the capture pass: it has to beat the handlers registered before this
// fragment, or closing the overlay also closes whatever is under it.
function onDiagramOverlayKey(event) {
  if (event.key !== 'Escape' || !diagramOverlayElement()) return;
  event.preventDefault();
  event.stopPropagation();
  closeDiagramOverlay();
}
document.addEventListener('keydown', onDiagramOverlayKey, true);

// Straight through mermaid, never through mermaidRenderCache: the memo is keyed on
// the source and the theme, so a picture drawn for this box would be handed back
// to the page.
function drawDiagramStage(stage) {
  const source = stage.__mermaidSource;
  if (source == null) return;
  // Fit, at this box's size. Zoom counts from what the page laid out, so the
  // numbers the block in the document is holding mean a different size here.
  stage.__mermaidNatural = null;
  stage.__mermaidView = null;
  stage.classList.remove('is-moved');
  stage.style.removeProperty('--mermaid-box-height');
  stage.style.removeProperty('--mermaid-pan-x');
  stage.style.removeProperty('--mermaid-pan-y');
  stage.textContent = source;
  delete stage.dataset.processed;
  delete stage.dataset.mermaidRender;
  loadMermaid()
    .then(async (mermaid) => {
      if (!stage.isConnected) return;
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (!stage.isConnected) return;
      mermaid.initialize(mermaidRuntimeConfig());
      try {
        await mermaid.run({ nodes: [stage] });
      } catch (error) {
        console.error(error);
        stage.dataset.mermaidRender = 'failed';
      }
    })
    .catch((error) => {
      console.error(error);
    })
    .then(() => {
      addDiagramStageControls(stage);
    });
}

// After the drawing, always: mermaid replaces the stage's contents with the SVG
// it made, error and all, so anything put in first is gone.
function addDiagramStageControls(stage) {
  if (!stage.isConnected || stage.querySelector('.mermaid-zoom')) return;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'leaf-sheet-close diagram-close';
  close.title = 'Close — or press Escape';
  close.setAttribute('aria-label', 'Close the full-window diagram');
  close.innerHTML = `<span class="lt-icon lt-icon-close"></span>`;
  close.addEventListener('click', closeDiagramOverlay);
  stage.appendChild(close);
  stage.appendChild(mermaidZoomGroup(MERMAID_ZOOM_BUTTONS, 'Zoom'));
  addDiagramStageTools(stage);
}

// The same two corner buttons a drawn diagram carries in the page, under the same
// conditions — and they are listened to here rather than left to the delegated
// handler in decorate.js, which would hand it the stage. Both of them give the
// document back to the page, so the overlay goes first: editing the text puts a
// caret in the block, and the flowchart editor is a second modal above this one.
function addDiagramStageTools(stage) {
  const overlay = stage.parentElement;
  const block = overlay ? overlay.__diagramBlock : null;
  if (!block || currentDocumentFormat !== 'markdown' || !readerEditingAllowed()) return;
  if (!Number.isFinite(Number(block.dataset.srcStart)) || !Number.isFinite(Number(block.dataset.srcEnd))) return;
  const tools = document.createElement('div');
  tools.className = 'mermaid-tools';
  tools.appendChild(mermaidToolButton('source', 'Edit the Mermaid text of this diagram', `<span class="lt-icon lt-icon-code-view"></span>`));
  tools.appendChild(mermaidToolButton('sheet', 'Open in the flowchart editor, to draw it', `<span class="lt-icon lt-icon-workflow"></span>`));
  tools.addEventListener('click', (event) => {
    const tool = event.target && event.target.closest ? event.target.closest('.mermaid-tool') : null;
    if (!tool) return;
    event.preventDefault();
    event.stopPropagation();
    closeDiagramOverlay();
    if (tool.dataset.mermaidTool === 'source') startBlockSourceEdit(block);
    else openMermaidBlockSheet(block);
  });
  stage.appendChild(tools);
}

// A theme change recolors nothing in an SVG, so the stage is drawn again — the
// repaint sweep skips it, and decorate.js calls this instead.
function repaintDiagramOverlay() {
  const overlay = diagramOverlayElement();
  const stage = overlay ? overlay.querySelector('.diagram-stage') : null;
  if (stage) drawDiagramStage(stage);
}
