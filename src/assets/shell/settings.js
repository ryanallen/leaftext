let currentState = { recent: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// Subtext under the home-screen hero: one of several palm-leaf facts, chosen at
// random per showing. The chosen one is kept so a re-render shows the same fact
// rather than re-rolling.
const EMPTY_DESCRIPTIONS = [
  'Open a file and read it in peace. It stays on your device, in plain text you own.',
  'For two thousand years knowledge was incised on palm leaves — talipot and palmyra, dried and smoke-cured. Turn over a new one.',
  'Scribes cut letters into palm leaves with a stylus, then rubbed in soot so the words rose to the surface. Read on.',
  'A palm-leaf book was threaded through a single hole and bound between wooden covers. Open yours.',
  'A palm leaf holds its text for a few decades — six hundred years at most — so temples recopied the old ones before they wore away.',
  'The round letters of Devanagari, Kannada, and Telugu curved that way so sharp strokes would not tear the leaf.',
  'In Indonesia these leaf-books were called lontar, from the old words for “leaf” and “palmyra palm.”',
  'The oldest palm-leaf manuscripts survived in cold, dry places — Nepal, Tibet, the high passes of central Asia.',
  'In Bali, Brahmin scribes still rewrite the sacred texts onto palm leaves by hand.',
  'The printing press ended the long cycle of copying palm leaf to palm leaf in the early 1800s.',
];
function pickEmptyDescription() {
  return EMPTY_DESCRIPTIONS[Math.floor(Math.random() * EMPTY_DESCRIPTIONS.length)];
}
let emptyDescription = pickEmptyDescription();
// UI toggles are persisted by the host, injected as window.__leafSettings before
// any page script (the app shell's opaque origin can't use localStorage). We seed
// from them synchronously here and report every change back so it can save them.
const LEAF_SETTINGS = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;
const minimapListeners = new Set();
window.leafMinimap = {
  getEnabled: () => minimapEnabled,
  setEnabled(nextEnabled) {
    minimapEnabled = Boolean(nextEnabled);
    document.documentElement.dataset.minimapEnabled = String(minimapEnabled);
    minimapListeners.forEach((listener) => listener(minimapEnabled));
  },
  subscribe(listener) {
    minimapListeners.add(listener);
    listener(minimapEnabled);
    return () => minimapListeners.delete(listener);
  },
};
window.leafMinimap.setEnabled(minimapEnabled);
minimapEnabledControl.checked = window.leafMinimap.getEnabled();
minimapEnabledControl.addEventListener('change', () => {
  window.leafMinimap.setEnabled(minimapEnabledControl.checked);
  send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });
});
// Previous/Next pager visibility. A data-attribute on <html> shows/hides the
// host-emitted markup via CSS, so toggling never re-renders. On by default.
let pagerEnabled = typeof LEAF_SETTINGS.pagerEnabled === 'boolean' ? LEAF_SETTINGS.pagerEnabled : true;
function applyPagerEnabled() {
  document.documentElement.dataset.pagerEnabled = String(pagerEnabled);
}
applyPagerEnabled();
pagerEnabledControl.checked = pagerEnabled;
pagerEnabledControl.addEventListener('change', () => {
  pagerEnabled = pagerEnabledControl.checked;
  applyPagerEnabled();
  send({ command: 'setPagerEnabled', enabled: pagerEnabled });
});
