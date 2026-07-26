(() => {
  // Themes are two axes: a family (github/nightshade/amaranth/…) and an appearance
  // mode. Light/dark pick a fixed variant, system follows the OS, and daylight
  // is light between DAY_START and DAY_END local time, dark otherwise.
  // The built-in theme families, injected from the theme registry (theme.rs
  // theme_families) so this list can never drift from the registered sources.
  const VALID_FAMILIES = new Set({{VALID_FAMILIES}});
  // The concrete families the 'random' preference draws from, in registration
  // order. 'random' is a preference, never itself a concrete family.
  const REAL_FAMILIES = Array.from(VALID_FAMILIES);
  const RANDOM = 'random';
  const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);
  const FAMILY_FALLBACK = 'fern';
  const MODE_FALLBACK = 'system';
  // Family -> Google Fonts stylesheet URL. Fonts are fetched from Google (never
  // bundled); only the active family's font is requested and WebView2 caches it.
  // Families absent from the map (e.g. github) use the OS's native fonts.
  const FAMILY_FONTS = {{FAMILY_FONTS}};
  const DAY_START = 9;
  const DAY_END = 18;
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = new Set();
  const normalizeFamily = (value) => (VALID_FAMILIES.has(value) ? value : FAMILY_FALLBACK);
  // The picker preference is a concrete family or the special 'random', which
  // resolves to a concrete family at launch (and each time it is re-picked).
  const normalizePreference = (value) => (value === RANDOM ? RANDOM : normalizeFamily(value));
  const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);
  // The host injects the persisted theme as window.__leafSettings before this
  // runs, so the theme resolves on the first paint. The host owns persistence;
  // the app shell's opaque origin can't use localStorage.
  const settings = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};
  // Families already shown in the current random cycle, persisted by the host so
  // the no-repeat run survives restarts. Ask the host to save the bag whenever a
  // draw mutates it; wry's window.ipc is ready before this inline script runs.
  let randomBag = Array.isArray(settings.themeRandomUsed)
    ? settings.themeRandomUsed.filter((fam) => VALID_FAMILIES.has(fam))
    : [];
  const persistRandomBag = () => {
    if (window.ipc && typeof window.ipc.postMessage === 'function') {
      window.ipc.postMessage(JSON.stringify({ command: 'setThemeRandomBag', used: randomBag }));
    }
  };
  // Draw the next family at random, not repeating until every family has shown,
  // then reset — while avoiding an immediate repeat of the just-shown family
  // across the reset. Mutates and persists the bag.
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
  // Two axes of family state: the persisted preference (drives the picker and may
  // be 'random') and the concrete family actually applied (drives the CSS).
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
  // Point a single <link> at the active family's Google Fonts stylesheet, so the
  // font is fetched and applied on activation and swaps when the theme changes.
  // Families with no entry (system-font themes) get the link removed.
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

  // Daylight boundary timer: re-apply at the next DAY_START/DAY_END crossing so
  // the appearance flips without a restart. Rescheduled after each fire, and
  // cleared whenever the mode leaves daylight.
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

  window.leafTheme = {
    getMode: () => mode,
    getFamily: () => familyPreference,
    getResolvedTheme: resolvedTheme,
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
    const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };
    if (media.addEventListener) {
      media.addEventListener('change', onSystemThemeChange);
    } else if (media.addListener) {
      media.addListener(onSystemThemeChange);
    }
  }
  // A machine that slept across a boundary wakes with a stale appearance; re-run
  // the clock check (and reschedule) when the window regains focus.
  window.addEventListener('focus', () => { if (mode === 'daylight') { apply(); scheduleDaylight(); } });

  apply();
  scheduleDaylight();
})();
