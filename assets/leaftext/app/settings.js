// What a reader chose, kept in the browser's own storage.
//
// The desktop keeps its settings in a file its host owns and injects them before any page script runs — the app shell is served on an opaque origin, where `localStorage` throws, which is why it has to. A published site has a real origin and can read its own store, so this is the browser's half of the same job: merge what was kept over the defaults the page was handed, before the theme resolves. The two stores never meet — a browser cannot see the file, and the desktop's page cannot read storage at all — so this cannot move into `src/assets/shell/`, where it would run on both.
//
// A classic script, not a module: it has to block and run before the page's own theme bootstrap paints. Every touch of storage is wrapped, so a browser with it refused leaves the site on defaults rather than failing to boot.

(() => {
  const KEY = 'leaftext.settings';

  const kept = () => {
    try {
      const stored = window.localStorage.getItem(KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      // Storage refused, or the store holds something this version cannot read. Either way the defaults stand.
      return {};
    }
  };

  const defaults =
    window.__leafSettings && typeof window.__leafSettings === 'object' ? window.__leafSettings : {};
  const settings = Object.assign({}, defaults, kept());
  window.__leafSettings = settings;

  // The marks are state rather than a setting — the page reads them off the state it was handed, not off its settings — so they are merged into that state here, beside the merge above and before the first render, which is the only place either of them can happen.
  if (Array.isArray(settings.favorites) && window.__leafInitialState && typeof window.__leafInitialState === 'object') {
    window.__leafInitialState.favorites = settings.favorites;
  }

  // The one save. The browser's own host calls it with the keys a command owns, and nothing else writes the store.
  window.__leafSaveSettings = (changed) => {
    if (!changed || typeof changed !== 'object') return;
    Object.assign(settings, changed);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (error) {
      // The choice still holds for this reading; it just will not survive the reload.
    }
  };
})();
