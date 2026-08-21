// Where the vendored runtimes are served from. Injected rather than written into the fragments, because the asset scheme differs by platform and a fragment that carries a placeholder cannot be served as a static file.
window.__lt = Object.assign(window.__lt || {}, { assets: {{ASSET_URLS}} });
(() => {
  // Themes are two axes: a family (github/nightshade/amaranth/…) and an appearance mode. Light/dark pick a fixed variant, system follows the OS, and daylight is light between DAY_START and DAY_END local time, dark otherwise. The built-in theme families, injected from the theme registry (theme.rs theme_families) so this list can never drift from the registered sources.
  const VALID_FAMILIES = new Set({{VALID_FAMILIES}});
  // The concrete families the 'random' preference draws from, in registration order. 'random' is a preference, never itself a concrete family.
  const REAL_FAMILIES = Array.from(VALID_FAMILIES);
  const RANDOM = 'random';
  const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);
  const FAMILY_FALLBACK = 'fern';
  const MODE_FALLBACK = 'system';
  // Family -> Google Fonts stylesheet URL. Fonts are fetched from Google (never bundled); only the active family's font is requested and WebView2 caches it. Families absent from the map (e.g. github) use the OS's native fonts.
  const FAMILY_FONTS = {{FAMILY_FONTS}};
  const DAY_START = 9;
  const DAY_END = 18;
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = new Set();
  const normalizeFamily = (value) => (VALID_FAMILIES.has(value) ? value : FAMILY_FALLBACK);
  // The picker preference is a concrete family or the special 'random', which resolves to a concrete family at launch (and each time it is re-picked).
  const normalizePreference = (value) => (value === RANDOM ? RANDOM : normalizeFamily(value));
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  // The host injects the persisted theme as window.__leafSettings before this runs, so the theme resolves on the first paint. The host owns persistence; the app shell's opaque origin can't use localStorage.
  const settings = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
  // Families already shown in the current random cycle, persisted by the host so the no-repeat run survives restarts. Ask the host to save the bag whenever a draw mutates it; wry's window.ipc is ready before this inline script runs.
  let randomBag = Array.isArray(settings.themeRandomUsed)
    ? settings.themeRandomUsed.filter((fam) => VALID_FAMILIES.has(fam))
    : [];
  const persistRandomBag = () => {
    if (window.ipc && typeof window.ipc.postMessage === 'function') {
      window.ipc.postMessage(JSON.stringify({ command: 'setThemeRandomBag', used: randomBag }));
    }
  };
  // Draw the next family at random, not repeating until every family has shown, then reset — while avoiding an immediate repeat of the just-shown family across the reset. Mutates and persists the bag.
  const drawRandomFamily = () => {
    let available = REAL_FAMILIES.filter((fam) => !randomBag.includes(fam));
    if (available.length === 0) {
      const last = randomBag[randomBag.length - 1];
      randomBag = [];
      available = REAL_FAMILIES.filter((fam) => fam !== last);
      if (available.length === 0) { available = REAL_FAMILIES.slice(); }
    }
    const choice = available[Math.floor(Math.random() * available.length)];
    randomBag = randomBag.concat([choice]);
    persistRandomBag();
    return choice;
  };
  // Two axes of family state: the persisted preference (drives the picker and may be 'random') and the concrete family actually applied (drives the CSS).
  let familyPreference = normalizePreference(settings.themeFamily);
  let family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;
  let mode = normalizeMode(settings.themeMode);

  const isDaytime = () => {
    const hour = new Date().getHours();
    return hour >= DAY_START && hour < DAY_END;
  };
  const resolvedTheme = () => {
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';
    return media && media.matches ? 'dark' : 'light';
  };
  const snapshot = () => ({ family, mode, resolvedTheme: resolvedTheme() });
  // Point a single <link> at the active family's Google Fonts stylesheet, so the font is fetched and applied on activation and swaps when the theme changes. Families with no entry (system-font themes) get the link removed.
  const applyFamilyFont = (fam) => {
    const href = FAMILY_FONTS[fam];
    let link = document.getElementById('leafThemeFont');
    if (!href) { if (link) { link.remove(); } return; }
    if (!link) {
      link = document.createElement('link');
      link.id = 'leafThemeFont';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) { link.setAttribute('href', href); }
  };
  const apply = () => {
    const theme = snapshot();
    // The Leaf-owned attributes that drive the compiled theme CSS.
    root.dataset.leafTheme = family;
    root.dataset.leafAppearance = theme.resolvedTheme;
    root.dataset.themeMode = mode;
    root.dataset.themeFamily = family;
    root.dataset.theme = theme.resolvedTheme;
    root.style.colorScheme = theme.resolvedTheme;
    applyFamilyFont(family);
    listeners.forEach((listener) => listener(theme));
  };

  // Daylight boundary timer: re-apply at the next DAY_START/DAY_END crossing so the appearance flips without a restart. Rescheduled after each fire, and cleared whenever the mode leaves daylight.
  let daylightTimer = 0;
  const scheduleDaylight = () => {
    if (daylightTimer) { clearTimeout(daylightTimer); daylightTimer = 0; }
    if (mode !== 'daylight') return;
    const now = new Date();
    const next = new Date(now);
    const hour = now.getHours();
    if (hour < DAY_START) { next.setHours(DAY_START, 0, 0, 0); }
    else if (hour < DAY_END) { next.setHours(DAY_END, 0, 0, 0); }
    else { next.setDate(next.getDate() + 1); next.setHours(DAY_START, 0, 0, 0); }
    const delay = Math.max(1000, next.getTime() - now.getTime());
    daylightTimer = setTimeout(() => { apply(); scheduleDaylight(); }, delay);
  };

  // Held while a page is being rendered for paper. A print render emulates a light color scheme, which fires the system listener below and repaints the whole app in the light family for the duration — so a dark theme came out on white paper in dark ink. What is being printed is what is on screen, and the screen has not changed.
  //
  // The text size is held with it, and for the same reason. Every size in the app is a multiple of one that grows with the window, and the window a render lays out in is the sheet — so the paper came out in smaller type than the screen, a shorter document than the page had measured, and the difference as blank paper under the last line. Pinned to the size on screen for the render and let go after, so the sheet is the page as it stands.
  //
  // The room a lane has on the paper is written down with it. On screen a wide picture or table breaks out of the text measure through a container query, and in the print render that query is self-referential — the container spans whatever the layout overflows to, growing with the very overflow it causes — so the page does the container's arithmetic here and the paper rules read the one finished number.
  let holdingAppearance = 0;
  // A style element rather than inline properties on the root: the print render lays the page out from the stylesheets and never sees an inline style script wrote onto the root, which is how a pin that held on screen was silently ignored on paper.
  let paperStyle = null;
  window.leafHoldAppearance = (held) => {
    holdingAppearance = Math.max(0, holdingAppearance + (held ? 1 : -1));
    // The page as paper: the stylesheet's whole print block is on this class, so the same rules the render lays out under are the ones the page measured itself under.
    document.body.classList.toggle('leaf-paper', holdingAppearance > 0);
    if (!holdingAppearance) {
      if (paperStyle) paperStyle.remove();
      paperStyle = null;
      return;
    }
    if (paperStyle) return;
    // Read off the document rather than off the custom property: a property answers with the arithmetic it was written as, and what is wanted is what that came to.
    const drawn = document.querySelector('.document-body');
    const size = drawn && getComputedStyle(drawn).fontSize;
    const surface = document.getElementById('appSurface');
    let lane = 0;
    if (surface) {
      const worn = getComputedStyle(surface);
      const inset = parseFloat(worn.getPropertyValue('--reader-lane-inset')) || 0;
      const pad = parseFloat(worn.getPropertyValue('--reader-content-pad')) || 0;
      lane = surface.getBoundingClientRect().width - 2 * inset - 2 * pad;
    }
    paperStyle = document.createElement('style');
    paperStyle.textContent = `body.leaf-paper {${size ? ` --type-base: ${size};` : ''}${lane > 0 ? ` --leaf-paper-lane: ${lane}px;` : ''} }`;
    document.head.appendChild(paperStyle);
  };
  window.addEventListener('beforeprint', () => window.leafHoldAppearance(true));
  window.addEventListener('afterprint', () => window.leafHoldAppearance(false));

  window.leafTheme = {
    getMode: () => mode,
    getFamily: () => familyPreference,
    getResolvedTheme: resolvedTheme,
    // The picker loads each theme's font while open; hand it the same family -> stylesheet map this bootstrap uses for the active theme.
    getFamilyFontHref: (fam) => FAMILY_FONTS[fam] || '',
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      apply();
      scheduleDaylight();
    },
    setFamily(nextFamily) {
      familyPreference = normalizePreference(nextFamily);
      family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };

  if (media) {
    const onSystemThemeChange = () => { if (mode === 'system' && !holdingAppearance) { apply(); } };
    if (media.addEventListener) {
      media.addEventListener('change', onSystemThemeChange);
    } else if (media.addListener) {
      media.addListener(onSystemThemeChange);
    }
  }
  // A machine that slept across a boundary wakes with a stale appearance; re-run the clock check (and reschedule) when the window regains focus.
  window.addEventListener('focus', () => { if (mode === 'daylight') { apply(); scheduleDaylight(); } });

  apply();
  scheduleDaylight();
})();
