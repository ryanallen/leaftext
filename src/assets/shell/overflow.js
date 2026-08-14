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
function refitAppBar() {
  // Moving the buttons relayouts the bar, which is what the ResizeObserver watches; without this the first fold would trigger the next.
  if (refittingAppBar) return;
  refittingAppBar = true;
  try {
    // The chevron is drawn only once something has folded, so the pass that raises it measured a bar it was not standing on — and it is a button wide. Nothing comes back to finish: the bar is pinned to both window edges, so its own box never changes size however its contents move, and the observer never fires. So that pass measures again, once — a pass can raise the chevron but never lower it, so the second settles the bar or changes nothing.
    if (foldAppBar()) foldAppBar();
  } finally {
    refittingAppBar = false;
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
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
