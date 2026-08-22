// --- App-bar overflow -------------------------------------------------------
// The bar folds into the chevron's panel one item at a time, rightmost first, as the room runs out. Measured against real overflow rather than a width budget, so a long title costs a button instead of being sliced in half. The history controls go too, once the trailing ones have; the brand and the library button never do — on a narrow window that button is the only way to reach the library at all.
//
// Both the strip and the bar are asked, and neither replaces the other. The strip's test is what makes a long title cost a button; the bar's is the only one that answers with no document open, since an empty strip cannot overflow — and that is the case where close, minimize and maximize run off the right edge with nothing raised in their place.
//
// Listed last-to-fold first. Each entry names the container it came from, since they do not all share one, and restoring rebuilds each container's original order so a returning button lands in its own slot.
const overflowPanel = document.getElementById('appOverflowPanel');
const appTrailingItems = document.getElementById('appTrailingItems');
const historyActions = document.querySelector('.history-actions');
const appBarLead = document.querySelector('.app-bar-lead');
// dom.js has already stood the window buttons where the platform wants them — the bar's left end on a Mac, the trailing group on Windows — so their home is read off the page rather than named twice here. Naming it was what left them stuck in the menu on a Mac: unfolding put every button back with the container it started in, and theirs no longer held them.
const windowControls = document.getElementById('windowControls');
const overflowCandidates = [
  {
    el: windowControls,
    home: windowControls && windowControls.parentElement,
    inLead: !!windowControls && windowControls.parentElement === appBarLead,
  },
  { el: document.getElementById('backButton'), home: historyActions, inLead: true },
  { el: document.getElementById('forwardButton'), home: historyActions, inLead: true },
  ...Array.from(appActionsItems.children).map((el) => ({ el, home: appActionsItems })),
].filter((entry) => entry.el && entry.home);
// The menu's own order, separate from the order things fold in — items go in as they leave the bar, rightmost first, which would otherwise put close under the pointer of somebody who opened the menu to go back a page. The window buttons go to the foot; on a Mac they are hidden and the menu is the rest in this order.
const overflowMenuOrder = [
  ...overflowCandidates.filter((entry) => entry.el.id !== 'windowControls'),
  ...overflowCandidates.filter((entry) => entry.el.id === 'windowControls'),
].map((entry) => entry.el);
// Each affected container's children as they started, non-candidates included.
const overflowHomes = new Map();
for (const { home } of overflowCandidates) {
  if (!overflowHomes.has(home)) overflowHomes.set(home, Array.from(home.children));
}
let refittingAppBar = false;
// Whether the chevron was standing on the bar when it was last measured. Held here rather than read back off has-overflow, because the stand-in page the front-end check boots answers false to every classList.contains — a fold that read the class is a fold no test can watch working.
let overflowChevronUp = false;
function closeOverflowMenu() {
  appTrailing.classList.remove('overflow-open');
  overflowToggle.setAttribute('aria-expanded', 'false');
}
// One fold, start to finish. Answers whether this pass raised the chevron — the one case that measured a bar the chevron was not standing on.
function foldAppBar() {
  // Unfold everything first, rebuilding each container's original order, so a widening window returns the buttons exactly where they came from.
  for (const [home, children] of overflowHomes) {
    for (const child of children) home.appendChild(child);
  }
  // An open library pins the lead to the rail's width so the tabs line up with the pane's edge, so folding out of it frees nothing — leave it whole.
  const leadIsPinned = appBar.classList.contains('has-rail');
  for (let index = overflowCandidates.length - 1; index >= 0; index -= 1) {
    if (tabBar.scrollWidth <= tabBar.clientWidth + 1 && appBar.scrollWidth <= appBar.clientWidth + 1) break;
    const { el, inLead } = overflowCandidates[index];
    // A hidden action takes no width, so folding it frees nothing and would raise the chevron over an empty-looking menu.
    if (el.hidden || el.offsetParent === null) continue;
    if (inLead && leadIsPinned) continue;
    overflowPanel.prepend(el);
  }
  // Laid out only once folding has finished: each fold has to free real width before the next measurement, so the order things go in cannot also be the order they read in. appendChild on a child already here moves it, so one walk seats them all.
  for (const el of overflowMenuOrder) {
    if (el.parentElement === overflowPanel) overflowPanel.appendChild(el);
  }
  const folded = overflowPanel.childElementCount > 0;
  const raisedTheChevron = folded && !overflowChevronUp;
  overflowChevronUp = folded;
  appTrailing.classList.toggle('has-overflow', folded);
  if (!folded) closeOverflowMenu();
  return raisedTheChevron;
}
// The bar's left zone measured on its own buttons, with both the pane's width and the zone's own floor out of it: an open pane pins the zone to the rail and the floor below holds it at the last answer, so a plain read gives back one of those rather than what is standing in the zone. `width: auto` is the value the closed state already asks for, taken for one read and put straight back. Held between reads because reading it forces a layout and the answer only moves when the zone's contents do.
let appBarLeadOwnWidth = 0;
function appBarLeadWidth() {
  if (appBarLeadOwnWidth) return appBarLeadOwnWidth;
  if (!appBarLead) return 0;
  const pinned = appBarLead.style.width || '';
  const floored = appBarLead.style.minWidth || '';
  appBarLead.style.width = 'auto';
  appBarLead.style.minWidth = '0px';
  appBarLeadOwnWidth = appBarLead.getBoundingClientRect().width;
  appBarLead.style.width = pinned;
  appBarLead.style.minWidth = floored;
  return appBarLeadOwnWidth;
}
function forgetAppBarLeadWidth() {
  appBarLeadOwnWidth = 0;
}
// The zone's floor, written as the number just measured. The stylesheet asks for `fit-content` and the two web views do not answer it alike: Windows holds the zone at its buttons, a Mac gives it up to the pane and draws the tab strip over the leaf, the library button and both arrows — the button that closes the pane being dragged. A plain pixel value floors identically in every web view there is.
function floorAppBarLead() {
  if (!appBarLead) return;
  const width = appBarLeadWidth();
  if (width) appBarLead.style.minWidth = `${width}px`;
}
function refitAppBar() {
  // Moving the buttons relayouts the bar, which is what the ResizeObserver watches; without this the first fold would trigger the next.
  if (refittingAppBar) return;
  refittingAppBar = true;
  try {
    // The chevron is drawn only once something has folded, so the pass that raises it measured a bar it was not standing on — and it is a button wide. Nothing comes back to finish: the bar is pinned to both window edges, so its own box never changes size however its contents move, and the observer never fires. So that pass measures again, once — a pass can raise the chevron but never lower it, so the second settles the bar or changes nothing.
    if (foldAppBar()) foldAppBar();
  } finally {
    refittingAppBar = false;
    // A fold takes buttons out of the left zone and an unfold puts them back, so whatever was measured of it is stale — and the floor written from it with it. These are the only moments the zone's own width can move, so re-flooring here needs nothing new watching the bar. Never while the pane is easing: this read puts `width: auto` on the zone for a layout pass, and a width transition cannot start from `auto`, so the tab strip stands still while the page eases past it. The fold itself goes on running — it moves buttons and writes no width. Held on the motion rather than on the toggle because a finished render, the code view and the update menu all refit too. endLibraryMotion takes the read once the classes are off.
    if (!libraryPaneIsMoving()) {
      forgetAppBarLeadWidth();
      floorAppBarLead();
    }
  }
}
overflowToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = appTrailing.classList.toggle('overflow-open');
  overflowToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});
// Dismiss on outside click / Escape, like the other menus.
document.addEventListener('click', (event) => {
  if (appTrailing.classList.contains('overflow-open') && !appTrailing.contains(event.target)) {
    closeOverflowMenu();
  }
});
leafOnEscape(closeOverflowMenu);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => refitAppBar()).observe(appBar);
}
window.addEventListener('resize', refitAppBar);
// Served over leaf-asset://, whose spelling is the host's to decide, so the URLs are injected on window.__lt rather than substituted into this file.
const {
  mermaid: MERMAID_SCRIPT_URL,
  katex: KATEX_SCRIPT_URL,
  pixi: PIXI_SCRIPT_URL,
  pixiUnsafeEval: PIXI_UNSAFE_EVAL_SCRIPT_URL,
  d3Force: D3_FORCE_SCRIPT_URL,
  monaco: MONACO_SCRIPT_URL,
  monacoCss: MONACO_CSS_URL,
} = window.__lt.assets;
let mermaidLoadPromise = null;
let katexLoadPromise = null;
// Nothing to wire on a published site: dom.js has taken both out, the way it takes Back and Forward out, because neither command has an answer a static site could give.
const openButton = document.getElementById('openButton');
const newButton = document.getElementById('newButton');
if (openButton) openButton.addEventListener('click', () => send({ command: 'open' }));
if (newButton) newButton.addEventListener('click', () => send({ command: 'newDocument' }));
// What Export writes. The save window is what offers these — a row here is a row in that window's own dropdown, never a menu over the page, except on a Mac where the panel shows no format at all.
const PAGE_EXPORTS = [
  { id: 'pdf', label: 'PDF', hint: 'The whole document as one continuous page, in the theme on screen' },
  { id: 'html', label: 'Web page', hint: 'The page as it looks here, with its stylesheet and pictures in a folder beside it' },
];
// The sheet the document needs, read off the page wearing the paper rules rather than worked out from the screen.
//
// Three rounds were spent subtracting things from the reader's own measurement — the app bar's room, the toolbar's room, the strip at the foot — and every one of them left blank paper under the last line, because what the render lays out is a different layout and not the screen's minus a list. So the page puts the paper class on, reads the one box that is the whole sheet, and takes it off again: the surface, which under those rules is static, uncontained and as tall as everything it holds.
//
// The class is `leafHoldAppearance`'s, so the render that follows is laid out under exactly the rules this measured.
function pageExportSize() {
  const surface = document.getElementById('appSurface');
  if (!surface) return { width: 1, height: 1 };
  const held = document.body.classList.contains('leaf-paper');
  if (!held && window.leafHoldAppearance) window.leafHoldAppearance(true);
  const box = surface.getBoundingClientRect();
  const size = { width: Math.max(Math.round(box.width), 1), height: Math.max(box.height, 1) };
  if (!held && window.leafHoldAppearance) window.leafHoldAppearance(false);
  return size;
}
// Ask where the page goes, and in which format. The hold goes on before the send and is released by the host's answer: it is what makes a print lay the page out under the same paper rules the size was measured under, and what stops the render's own light color scheme repainting the app for as long as the file is being written. `format` travels only where the reader has already been asked, and leaves the save window that one row to offer.
function askPageExport(format) {
  if (window.leafHoldAppearance) window.leafHoldAppearance(true);
  const size = pageExportSize();
  send({ command: 'exportPdf', format: format || '', width: size.width, height: size.height });
}
if (exportPdfButton) {
  // Which platform asks the format, and where — the same split the diagram export takes. Windows draws the formats as a dropdown inside the save window, so the window is the only question and nothing opens over the page. A Mac panel throws every label away and permits every ending at once, so the menu asks first and the window is then left the one format they picked.
  exportPdfButton.addEventListener('click', () => {
    if (!isMacPlatform) {
      askPageExport();
      return;
    }
    const spot = exportPdfButton.getBoundingClientRect();
    openFlowMenuWith(
      spot.left,
      spot.bottom + 6,
      PAGE_EXPORTS.map((kind) => ({ label: kind.label, hint: kind.hint, run: () => askPageExport(kind.id) })),
      appSurface,
    );
  });
}
// The app's own controls inside a rendered document: the code blocks' copy buttons, the picture's opener, and the diagram's tools, zoom strip and closer. Every one of them does nothing on somebody else's machine, so none of them travels.
const PAGE_EXPORT_CONTROLS = '.code-copy, .image-sheet-open, .mermaid-tools, .mermaid-view-controls, .mermaid-zoom, .diagram-close';
// The document as a page of its own: a copy of what is drawn, its controls taken out, wrapped in the ancestors every rule in the stylesheet is keyed on.
//
// The chain is not decoration — a body without it renders unstyled. It is written here rather than cloned off the page because two of the classes on screen must not travel: the shell's `has-minimap` and the layout's rail, which set and spend the column the rail stands in, and the export carries no rail for it to hold.
const PAGE_EXPORT_WRAPPER_OPEN = '<div class="app-surface"><main class="reader-shell has-document"><div class="reader-layout reader-layout-no-minimap">';
const PAGE_EXPORT_WRAPPER_CLOSE = '</div></main></div>';
function pageExportMarkup() {
  const drawn = app ? app.querySelector('.document-body') : null;
  if (!drawn) return '';
  const copy = drawn.cloneNode(true);
  copy.querySelectorAll(PAGE_EXPORT_CONTROLS).forEach((control) => control.remove());
  // A picture the app could not load is not a picture in this markup: its source was replaced with a transparent pixel and our own broken-picture mark put over it, with its address parked on the element. Put the address back, so the export names the file the document asked for and the browser draws its own mark if it is still not there.
  copy.querySelectorAll('img').forEach(restoreMissingImage);
  return PAGE_EXPORT_WRAPPER_OPEN + copy.outerHTML + PAGE_EXPORT_WRAPPER_CLOSE;
}
// The host's answer for the Web page row: where the reader said it goes. The drawings' own stylesheet travels with the markup — mermaid writes one per drawing and the page hoists them into a single element in its head, so it is neither in the stylesheet nor inside the SVG, and a copy of the document alone comes out a page of black boxes.
window.leafExportPageHtml = (path) => {
  const markup = pageExportMarkup();
  if (!markup) return;
  const sheet = document.getElementById('leaf-mermaid-sheets');
  const root = document.documentElement;
  send({
    command: 'exportPageHtml',
    path: String(path),
    markup,
    sheet: sheet ? sheet.textContent || '' : '',
    theme: root.dataset.leafTheme || '',
    appearance: root.dataset.leafAppearance || '',
    title: (currentState && currentState.document && currentState.document.title) || '',
  });
};
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
