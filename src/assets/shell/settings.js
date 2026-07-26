let currentState = { recent: [], tabs: [], active: null, document: null };
let navigationState = { canGoBack: false, canGoForward: false };
// Subtext under the home-screen hero: one of several palm-leaf facts, chosen at
// random per showing. The chosen key is kept so a language switch re-translates
// the same fact rather than re-rolling.
const EMPTY_DESCRIPTION_KEYS = [
  'empty.description',
  'empty.description.incised',
  'empty.description.stylus',
  'empty.description.bound',
  'empty.description.lifespan',
  'empty.description.roundLetters',
  'empty.description.lontar',
  'empty.description.coldDry',
  'empty.description.bali',
  'empty.description.printing',
];
function pickEmptyDescriptionKey() {
  return EMPTY_DESCRIPTION_KEYS[Math.floor(Math.random() * EMPTY_DESCRIPTION_KEYS.length)];
}
let emptyDescriptionKey = pickEmptyDescriptionKey();
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
// Gutter permalink numbers. A data-attribute on <html> shows/hides them via CSS
// (no re-render); hiding drops only the visible number, blocks keep their ids so
// #locus links still resolve. Off by default.
let lineNumbersEnabled =
  typeof LEAF_SETTINGS.lineNumbersEnabled === 'boolean' ? LEAF_SETTINGS.lineNumbersEnabled : false;
function applyLineNumbersEnabled() {
  document.documentElement.dataset.lineNumbersEnabled = String(lineNumbersEnabled);
}
applyLineNumbersEnabled();
lineNumbersEnabledControl.checked = lineNumbersEnabled;
lineNumbersEnabledControl.addEventListener('change', () => {
  lineNumbersEnabled = lineNumbersEnabledControl.checked;
  applyLineNumbersEnabled();
  send({ command: 'setLineNumbersEnabled', enabled: lineNumbersEnabled });
});
// Whether the reading view is a live editor. On by default; off keeps the page a
// pure reader (no click-to-edit, checkboxes inert). The code view still edits
// source. Toggling just re-renders the open document to apply it.
let readerEditingEnabled =
  typeof LEAF_SETTINGS.readerEditingEnabled === 'boolean' ? LEAF_SETTINGS.readerEditingEnabled : true;
readerEditingEnabledControl.checked = readerEditingEnabled;
readerEditingEnabledControl.addEventListener('change', () => {
  // Commit any block being edited before flipping, so it isn't silently dropped.
  commitActiveEditingBlock();
  readerEditingEnabled = readerEditingEnabledControl.checked;
  send({ command: 'setReaderEditingEnabled', enabled: readerEditingEnabled });
  renderState();
});
