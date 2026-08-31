// The theme selector: a bottom sheet reached from Settings, with an appearance row (System/Light/Dark/Daylight) and the list of theme families. Picking either applies it live and asks the host to persist it. The family list is server-rendered into #themeSheetGrid from theme.rs, so it's the single source of truth; this only wires interaction and reflects the current selection.
function themeFamilyName(family) {
  const item = themeSheetGrid.querySelector('.theme-item[data-family="' + family + '"]');
  return item ? item.textContent.trim() : family;
}
// Matches the appearance row in the theme sheet.
const THEME_MODE_NAMES = { system: 'System', light: 'Light', dark: 'Dark', daylight: 'Daylight' };
function updateThemeSelection() {
  const mode = window.leafTheme.getMode();
  const family = window.leafTheme.getFamily();
  // The bar's palette button has no room for a label, so the theme in use rides its tooltip — the one place left to read it without opening the sheet.
  if (themeSheetOpen) {
    themeSheetOpen.title =
      'Themes — ' + themeFamilyName(family) + ' · ' + (THEME_MODE_NAMES[mode] || mode);
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
  openSheet(themeSheet, themeBackdrop);
  loadThemeCardFonts();
}
function closeThemeSheet(options) {
  unloadThemeCardFonts();
  closeSheet(themeSheet, themeBackdrop, options);
}
// Each card previews its theme's own heading font, but web fonts are loaded only while the picker is open and dropped on close, so the app doesn't hold every theme's font at rest. A card keeps the app font (and shows a spinner) until its font is ready, then swaps. Random borrows whichever family it is cycling to.
const themeCardFontLinks = new Map();
let themeRandomTimer = 0;
let themeRandomIndex = 0;
function firstFontName(stack) {
  const first = (stack || '').split(',')[0].trim();
  return first.replace(/^["']|["']$/g, '');
}
function themeCardFontReady(card) {
  card.classList.remove('is-loading');
  card.classList.add('font-ready');
}
function ensureThemeCardFont(card) {
  const name = firstFontName(card.style.getPropertyValue('--card-font'));
  // No custom font (system stack) or no Font Loading API: use it right away.
  if (!name || !document.fonts) {
    themeCardFontReady(card);
    return;
  }
  const spec = '700 1em "' + name + '"';
  if (document.fonts.check(spec)) {
    themeCardFontReady(card);
    return;
  }
  card.classList.add('is-loading');
  const load = () =>
    document.fonts.load(spec).then(() => themeCardFontReady(card)).catch(() => themeCardFontReady(card));
  const href = window.leafTheme.getFamilyFontHref(card.dataset.family);
  if (!href) {
    load();
    return;
  }
  let link = themeCardFontLinks.get(card.dataset.family);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    themeCardFontLinks.set(card.dataset.family, link);
    document.head.appendChild(link);
  }
  // The @font-face rules must exist before load() can resolve, so wait for the stylesheet unless it is already parsed.
  if (link.sheet) {
    load();
  } else {
    link.addEventListener('load', load, { once: true });
    link.addEventListener('error', () => themeCardFontReady(card), { once: true });
  }
}
function themeFamilyCards() {
  return Array.from(themeSheetGrid.querySelectorAll('.theme-item[data-family]')).filter(
    (card) => !card.classList.contains('theme-item-random'),
  );
}
function loadThemeCardFonts() {
  themeFamilyCards().forEach(ensureThemeCardFont);
  startThemeRandomCycle();
}
function unloadThemeCardFonts() {
  stopThemeRandomCycle();
  themeCardFontLinks.forEach((link) => link.remove());
  themeCardFontLinks.clear();
  themeSheetGrid.querySelectorAll('.theme-item').forEach((card) => {
    card.classList.remove('is-loading', 'font-ready');
  });
}
// Paint Random with one family's colors, ink and font — keeping Random's own name and only using the theme's font once it has loaded.
function paintThemeRandomFrom(card) {
  const random = themeSheetGrid.querySelector('.theme-item-random');
  if (!random || !card) return;
  ['--card-bg-light', '--card-bg-dark', '--card-fg-light', '--card-fg-dark', '--card-font'].forEach((name) => {
    random.style.setProperty(name, card.style.getPropertyValue(name));
  });
  const src = card.querySelectorAll('.theme-swatch');
  random.querySelectorAll('.theme-swatch').forEach((sw, i) => {
    const from = src[i];
    if (!from) return;
    sw.style.setProperty('--sw-light', from.style.getPropertyValue('--sw-light'));
    sw.style.setProperty('--sw-dark', from.style.getPropertyValue('--sw-dark'));
  });
  const name = firstFontName(random.style.getPropertyValue('--card-font'));
  const ready = !name || (document.fonts && document.fonts.check('700 1em "' + name + '"'));
  random.classList.remove('is-loading');
  random.classList.toggle('font-ready', !!ready);
}
function startThemeRandomCycle() {
  stopThemeRandomCycle();
  const cards = themeFamilyCards();
  if (cards.length === 0) return;
  themeRandomIndex = 0;
  paintThemeRandomFrom(cards[0]);
  themeRandomTimer = setInterval(() => {
    themeRandomIndex = (themeRandomIndex + 1) % cards.length;
    paintThemeRandomFrom(cards[themeRandomIndex]);
  }, 500);
}
function stopThemeRandomCycle() {
  if (themeRandomTimer) {
    clearInterval(themeRandomTimer);
    themeRandomTimer = 0;
  }
}
if (themeSheetOpen) {
  themeSheetOpen.addEventListener('click', openThemeSheet);
}
// Wrapped, not handed straight over: the close reads how the sheet was dismissed off its one argument, and a listener would pass it the click.
if (themeSheetClose) {
  themeSheetClose.addEventListener('click', () => closeThemeSheet());
}
if (themeBackdrop) {
  themeBackdrop.addEventListener('click', () => closeThemeSheet());
}
if (themeSheet) {
  makeSheetDraggable(themeSheet, themeSheet.querySelector('.leaf-sheet-grip'), closeThemeSheet);
}
leafOnEscape(() => {
  if (themeSheet && !themeSheet.hidden) closeThemeSheet();
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
// Tell the host what the page background resolves to so the native frame matches the page. Runs on every theme change, including system light/dark flips, so the OS chrome always tracks the document. No divider color: the app draws its own edge, and the frame is told to draw none — a line there would trace the outside of the shadow band rather than the app.
//
// Read and send are two functions rather than one, because the launch's first report goes through the settle pass, which takes every reading before it makes any write.
function readWindowChromeColor() {
  const shell = document.getElementById('app');
  return shell ? getComputedStyle(shell).backgroundColor : '';
}
function sendWindowChrome(color, theme) {
  const parts = String(color).match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) {
    return;
  }
  send({
    command: 'setWindowChrome',
    r: Math.round(Number(parts[0])),
    g: Math.round(Number(parts[1])),
    b: Math.round(Number(parts[2])),
    dark: theme.resolvedTheme === 'dark',
  });
}
function reportWindowChrome(theme) {
  sendWindowChrome(readWindowChromeColor(), theme);
}
// Everything a theme change does to the page, with the background it was told rather than one it reads for itself.
function applyThemeToPage(theme, color) {
  updateThemeSelection();
  sendWindowChrome(color, theme);
  refreshGraphColors();
  refreshFlowChipsForTheme();
  // The code view is Monaco; repaint it (and its minimap) from our palette so it tracks the theme and light/dark like everything else.
  reskinMonacoForTheme();
}
// `subscribe` calls its listener at once, and that first call lands while the fragments are still loading — so it goes to the settle pass instead, which reads the background with every other reading and writes with every other write. Every later call is a theme somebody chose, long after the page is settled.
let themeListenerArmed = false;
window.leafTheme.subscribe((theme) => {
  if (!themeListenerArmed) {
    onSettle({ read: readWindowChromeColor, apply: (color) => applyThemeToPage(theme, color) });
    return;
  }
  applyThemeToPage(theme, readWindowChromeColor());
});
themeListenerArmed = true;
// The same first call, and this one is dropped rather than moved: it renders the whole page, and the boot tail renders it again from the same state a moment later. The subscription is what matters — the minimap being switched off and on again is a real render.
let minimapListenerArmed = false;
window.leafMinimap.subscribe(() => {
  if (!minimapListenerArmed) return;
  renderState();
});
minimapListenerArmed = true;
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
  // Select-all in the reading view means the page, not the library and chrome around it. Editable fields and the code view keep their native select-all.
  //
  // With the caret in a block it widens a step per press instead: the block, then the block's section, then the page. The first press is still the browser's own, which is why the early return has to stay rather than being replaced.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
    if (codeViewActive) {
      return;
    }
    const caretBlock = caretBlockForSelectAll(event.target);
    if (!caretBlock && isEditableMouseTarget(event.target)) {
      return;
    }
    const body = app.querySelector('.document-body');
    // offsetParent is null while another view (the graph) sits in its place.
    if (!body || body.offsetParent === null) {
      return;
    }
    if (caretBlock) {
      const wanted = selectAllTargetFor(caretBlock);
      if (wanted.browser) {
        return;
      }
      if (wanted.section) {
        event.preventDefault();
        selectBlockRun(wanted.section);
        return;
      }
    }
    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  // Copy in the reading view means the words highlighted in the document, and the page owns the gesture rather than leaving it to the web view, which does nothing with it on a Mac. It reads the same selection the right-click menu's own Copy does, so the two cannot disagree about which words land on the clipboard.
  //
  // Anything with a copy of its own keeps it: the source view has the editor's, and a field or a block being typed in has the browser's. With nothing qualifying highlighted the key is left untouched, so the web view does whatever it would have done.
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    if (codeViewActive || isEditableMouseTarget(event.target)) {
      return;
    }
    const selected = selectionTextInReadingView();
    if (!selected) {
      return;
    }
    event.preventDefault();
    copyPlainText(selected);
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
    event.preventDefault();
    const tabCount = (currentState.tabs || []).length;
    if (tabCount > 0) {
      // Cycle through the home screen plus every open tab. Position 0 is the home screen; positions 1..=tabCount map to tab indices 0..tabCount-1.
      const stops = tabCount + 1;
      const current = currentState.active == null ? 0 : currentState.active + 1;
      const step = event.shiftKey ? -1 : 1;
      const next = (current + step + stops) % stops;
      if (next === 0) {
        send({ command: 'goHome' });
      } else {
        // The keyboard cycle always lands on a different tab, so its document load may be slow — show the spinner while the host renders it.
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
