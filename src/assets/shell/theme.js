// The theme selector: a bottom sheet reached from Settings, with an appearance
// row (System/Light/Dark/Daylight) and the list of theme families. Picking
// either applies it live and asks the host to persist it. The family list is
// server-rendered into #themeSheetGrid from theme.rs, so it's the single source
// of truth; this only wires interaction and reflects the current selection.
function themeFamilyName(family) {
  const item = themeSheetGrid.querySelector('.theme-item[data-family="' + family + '"]');
  return item ? item.textContent.trim() : family;
}
function updateThemeSelection() {
  const mode = window.leafTheme.getMode();
  const family = window.leafTheme.getFamily();
  if (themeCurrentLabel) {
    themeCurrentLabel.textContent =
      themeFamilyName(family) + ' · ' + window.leafLocale.t('settings.theme.' + mode);
  }
  themeSheetModes.querySelectorAll('.theme-mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  themeSheetGrid.querySelectorAll('.theme-item').forEach((btn) => {
    const active = btn.dataset.family === family;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
function openThemeSheet() {
  const settingsMenu = document.getElementById('settingsMenu');
  if (settingsMenu) {
    settingsMenu.open = false;
  }
  themeBackdrop.hidden = false;
  themeSheet.hidden = false;
  requestAnimationFrame(() => {
    themeBackdrop.classList.add('open');
    themeSheet.classList.add('open');
  });
}
function closeThemeSheet() {
  themeBackdrop.classList.remove('open');
  themeSheet.classList.remove('open');
  setTimeout(() => {
    themeBackdrop.hidden = true;
    themeSheet.hidden = true;
  }, 200);
}
if (themeSheetOpen) {
  themeSheetOpen.addEventListener('click', openThemeSheet);
}
if (themeSheetClose) {
  themeSheetClose.addEventListener('click', closeThemeSheet);
}
if (themeBackdrop) {
  themeBackdrop.addEventListener('click', closeThemeSheet);
}
if (themeSheet) {
  makeSheetDraggable(themeSheet, themeSheet.querySelector('.theme-sheet-grip'), closeThemeSheet);
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && themeSheet && !themeSheet.hidden) {
    closeThemeSheet();
  }
});
themeSheetModes.querySelectorAll('.theme-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.leafTheme.setMode(btn.dataset.mode);
    send({ command: 'setThemeMode', mode: btn.dataset.mode });
  });
});
themeSheetGrid.querySelectorAll('.theme-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.leafTheme.setFamily(btn.dataset.family);
    send({ command: 'setThemeFamily', family: btn.dataset.family });
  });
});
if (themeSheetBrowse) {
  themeSheetBrowse.addEventListener('click', (event) => {
    event.preventDefault();
    send({ command: 'openExternal', url: THEME_REPO_URL });
  });
}
// Tell the host what the page background and divider color resolve to so it can
// paint the native title bar to match the page and the window border to the
// theme's divider color (a darker line on light themes, a colored rule on
// themes like Nightshade). Runs on every theme change, including system light/dark flips, so
// the OS chrome always tracks the document.
function reportWindowChrome(theme) {
  const shell = document.getElementById('app');
  if (!shell) {
    return;
  }
  const parts = getComputedStyle(shell).backgroundColor.match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) {
    return;
  }
  // Resolve the divider color (a var() chain) to concrete rgb via a probe.
  const probe = document.createElement('span');
  probe.style.color = 'var(--app-border)';
  shell.appendChild(probe);
  const borderParts = getComputedStyle(probe).color.match(/\d+(?:\.\d+)?/g);
  probe.remove();
  const border = borderParts && borderParts.length >= 3 ? borderParts : parts;
  send({
    command: 'setWindowChrome',
    r: Math.round(Number(parts[0])),
    g: Math.round(Number(parts[1])),
    b: Math.round(Number(parts[2])),
    borderR: Math.round(Number(border[0])),
    borderG: Math.round(Number(border[1])),
    borderB: Math.round(Number(border[2])),
    dark: theme.resolvedTheme === 'dark',
  });
}
// Editing (code view + save) state. Declared here — before the subscriptions
// below, which invoke renderState() synchronously on load — so it is out of the
// temporal dead zone by the time renderState() first reads it. The functions
// that use it are defined further down (near the rest of the editing code).
const saveButton = document.getElementById('saveButton');
const undoButton = document.getElementById('undoButton');
// Whether each document has a reading-view edit to undo. Set optimistically
// when an edit is sent, then overwritten by the host's authoritative answer in
// leafBlocksResynced and cleared on save. The host owns the undo stack, so the
// button can never linger after undoing all the way back or saving a baseline.
const undoableByPath = new Map();
// Whether the reader is currently showing raw source instead of the rendered
// document. Reset by renderState(), set by leafShowCodeView().
let codeViewActive = false;
// The large-document code editor's state and its one hidden input (see
// code-editor.js). Declared here with the other editing globals because
// renderState() — which tears the editor down — runs synchronously on load,
// before code-editor.js's own top level has executed.
let cvEd = null;
let cvInput = null;
// Monaco now backs the code view (see code-view.js). The editor instance, its
// content-change subscription, and the one-time bundle loader promise live here
// with the other editing globals because renderState() tears the editor down
// synchronously on load, before code-view.js's own top level has run.
let monacoEditor = null;
let monacoChangeSub = null;
// The editor's layout-change subscription, which re-derives the bounded wrap
// column (see applyCodeViewWrapColumn) whenever the editor's width changes, and
// the column it last set — kept here so teardown disposes/resets them.
let monacoLayoutSub = null;
let codeViewWrapColumn = 0;
// The `document.fonts` listener that re-fits that column when a face finishes
// loading. A font arriving changes no geometry, so no layout event announces it —
// see refitCodeViewToFont. Held here so teardown can unsubscribe: it outlives the
// editor otherwise, and would re-fit a disposed one.
let monacoFontsDoneHandler = null;
// Watches the minimap for Monaco moving its viewport box, so the box can be kept
// inside the rail — see clampMinimapSliderToRail. Held here so teardown
// disconnects it: an observer outlives the editor it was watching.
let monacoSliderObserver = null;
let monacoLoadPromise = null;
// The last textarea value, mirrored so a save (and the debounced re-highlight)
// send the current buffer even if a keystroke is still within the debounce.
let codeViewText = '';
let sourceUpdateTimer = 0;
// Unsaved-edits state per document path, so the tab dot and Save button survive
// the tab bar being re-rendered. Absent / false means clean.
const dirtyByPath = new Map();
// Scroll fraction captured when toggling between the reading and code views, so
// the destination view opens at the same relative position (top stays top,
// mid-document stays mid-document). Consumed (and cleared) by the next render.
// Declared here, above the subscriptions that run renderState() on load.
let pendingViewScrollFraction = null;
// Byte offset of the block at the top of the reading viewport when the code view
// opens, so it lands on the line you were reading rather than a height fraction
// (rendered height and source length diverge). Consumed by the next renderCodeView.
let pendingCodeViewSrcOffset = null;
// The mirror for leaving the code view: byte offset of the top source line,
// consumed by the next reading render so it lands on that block. Replaces a racy
// fraction hand-off that dropped the reader to the top of the document.
let pendingReadingSrcOffset = null;
// True when the source view was scrolled to the very top as the toggle fired, so
// the destination lands flush at the top instead of aligning the first block just
// below the edge (which read as an unwanted little scroll-down). Consumed by the
// next render in either direction.
let pendingViewAtTop = false;
// Live reading-view editing. The source buffer stays authoritative in Rust; the
// reading view anchors each edit to a source byte range and asks the host to
// splice it. These hold what the frontend needs between renders. Declared here,
// above the subscriptions that run renderState() on load.
let currentDocumentFormat = 'markdown';
let currentDocumentSource = '';
// Where the caret should land after the next render, carrying it across the
// re-render a structural edit (Enter/Backspace) triggers so typing flows on.
// `srcStart` names the block by its post-splice source offset, `textOffset` the
// position inside it; `insertBelow` opens a fresh empty paragraph after it.
let pendingCaret = null;
// A reader anchor the next leafReloadDocument should restore instead of its own
// top-visible capture. Set when committing a source-edited block (e.g. an image)
// whose own height swings across the re-render: it points at the stable block
// ABOVE the edit, so the reader holds its place rather than snapping to the top.
let pendingEditAnchor = null;
window.leafTheme.subscribe((theme) => {
  updateThemeSelection();
  reportWindowChrome(theme);
  refreshGraphColors();
  // The code view is Monaco; repaint it (and its minimap) from our palette so it
  // tracks the theme and light/dark like everything else.
  reskinMonacoForTheme();
});
window.leafLocale.subscribe(() => {
  renderStaticText();
  renderState();
  renderLibrary();
  updateThemeSelection();
  renderUpdateButton();
});
window.leafMinimap.subscribe((enabled) => {
  minimapEnabledControl.checked = enabled;
  renderState();
});
let composing = false;
window.addEventListener('compositionstart', () => {
  composing = true;
});
window.addEventListener('compositionupdate', () => {
  composing = true;
});
window.addEventListener('compositionend', () => {
  composing = false;
});
window.addEventListener('keydown', (event) => {
  if (event.isComposing || composing) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    send({ command: 'open' });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w' && currentState.active != null) {
    event.preventDefault();
    send({ command: 'closeTab', index: currentState.active });
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault();
    const tabCount = (currentState.tabs || []).length;
    if (tabCount > 0) {
      // Cycle through the home screen plus every open tab. Position 0 is the
      // home screen; positions 1..=tabCount map to tab indices 0..tabCount-1.
      const stops = tabCount + 1;
      const current = currentState.active == null ? 0 : currentState.active + 1;
      const step = event.shiftKey ? -1 : 1;
      const next = (current + step + stops) % stops;
      if (next === 0) {
        send({ command: 'goHome' });
      } else {
        // The keyboard cycle always lands on a different tab, so its document
        // load may be slow — show the spinner while the host renders it.
        beginReaderLoading();
        send({
          command: 'switchTab',
          index: next - 1,
          scroll_anchor: currentScrollAnchor(),
          code_scroll: codeViewActive ? viewScrollFraction() : null,
        });
      }
    }
    return;
  }
  const key = event.key;
  const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';
  const isForwardShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowRight';
  const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';
  const isMacForwardShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowRight';
  if (isBackShortcut || isMacBackShortcut) {
    event.preventDefault();
    sendNavigationCommand('goBack');
    return;
  }
  if (isForwardShortcut || isMacForwardShortcut) {
    event.preventDefault();
    sendNavigationCommand('goForward');
  }
});
// Above this many characters of view HTML, building the DOM (innerHTML plus
// the layout-forcing decoration passes) blocks this thread long enough that
// the spinner should be painted on screen before the work starts.
const READER_LOADING_HEAVY_HTML = 250000;
// Invalidates a deferred heavy render when a newer render supersedes it.
let readerRenderToken = 0;
