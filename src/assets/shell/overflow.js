// --- App-bar overflow -------------------------------------------------------
// The bar folds into the chevron's panel one item at a time, rightmost first, as
// the tab strip runs out of room. Measured against the tabs' own overflow rather
// than a width budget, so a long title costs a button instead of being sliced in
// half. The history controls go too, once the trailing ones have; the brand and
// the library button never do — on a narrow window that button is the only way
// to reach the library at all.
//
// Listed last-to-fold first. Each entry names the container it came from, since
// they do not all share one, and restoring rebuilds each container's original
// order so a returning button lands in its own slot.
const overflowPanel = document.getElementById('appOverflowPanel');
const appTrailingItems = document.getElementById('appTrailingItems');
const historyActions = document.querySelector('.history-actions');
const appBarLead = document.querySelector('.app-bar-lead');
const overflowCandidates = [
  { el: document.getElementById('windowControls'), home: appTrailingItems },
  { el: document.getElementById('backButton'), home: historyActions, inLead: true },
  { el: document.getElementById('forwardButton'), home: historyActions, inLead: true },
  ...Array.from(appActionsItems.children).map((el) => ({ el, home: appActionsItems })),
].filter((entry) => entry.el && entry.home);
// Each affected container's children as they started, non-candidates included.
const overflowHomes = new Map();
for (const { home } of overflowCandidates) {
  if (!overflowHomes.has(home)) overflowHomes.set(home, Array.from(home.children));
}
let refittingAppBar = false;
function closeOverflowMenu() {
  appTrailing.classList.remove('overflow-open');
  overflowToggle.setAttribute('aria-expanded', 'false');
}
function refitAppBar() {
  // Moving the buttons relayouts the bar, which is what the ResizeObserver
  // watches; without this the first fold would trigger the next.
  if (refittingAppBar) return;
  refittingAppBar = true;
  try {
    // Unfold everything first, rebuilding each container's original order, so a
    // widening window returns the buttons exactly where they came from.
    for (const [home, children] of overflowHomes) {
      for (const child of children) home.appendChild(child);
    }
    // An open library pins the lead to the rail's width so the tabs line up with
    // the pane's edge, so folding out of it frees nothing — leave it whole.
    const leadIsPinned = appBar.classList.contains('has-rail');
    for (let index = overflowCandidates.length - 1; index >= 0; index -= 1) {
      if (tabBar.scrollWidth <= tabBar.clientWidth + 1) break;
      const { el, inLead } = overflowCandidates[index];
      // A hidden action takes no width, so folding it frees nothing and would
      // raise the chevron over an empty-looking menu.
      if (el.hidden || el.offsetParent === null) continue;
      if (inLead && leadIsPinned) continue;
      overflowPanel.prepend(el);
    }
    const folded = overflowPanel.childElementCount > 0;
    appTrailing.classList.toggle('has-overflow', folded);
    if (!folded) closeOverflowMenu();
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
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverflowMenu();
});
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => refitAppBar()).observe(appBar);
}
window.addEventListener('resize', refitAppBar);
const MERMAID_SCRIPT_URL = '{{MERMAID_SCRIPT_URL}}';
const KATEX_SCRIPT_URL = '{{KATEX_SCRIPT_URL}}';
const PIXI_SCRIPT_URL = '{{PIXI_SCRIPT_URL}}';
const PIXI_UNSAFE_EVAL_SCRIPT_URL = '{{PIXI_UNSAFE_EVAL_SCRIPT_URL}}';
const D3_FORCE_SCRIPT_URL = '{{D3_FORCE_SCRIPT_URL}}';
let mermaidLoadPromise = null;
let katexLoadPromise = null;
document.getElementById('openButton').addEventListener('click', () => send({ command: 'open' }));
homeButton.addEventListener('click', () => send({ command: 'goHome' }));
