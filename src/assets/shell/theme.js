// The theme selector: a bottom sheet reached from Settings, with an appearance
// row (System/Light/Dark/Daylight) and the list of theme families. Picking
// either applies it live and asks the host to persist it. The family list is
// server-rendered into #themeSheetGrid from theme.rs, so it's the single source
// of truth; this only wires interaction and reflects the current selection.
function themeFamilyName(family) {
  const item = themeSheetGrid.querySelector('.theme-item[data-family="' + family + '"]');
  return item ? item.textContent.trim() : family;
}
// Matches the appearance row in the theme sheet.
const THEME_MODE_NAMES = { system: 'System', light: 'Light', dark: 'Dark', daylight: 'Daylight' };
function updateThemeSelection() {
  const mode = window.leafTheme.getMode();
  const family = window.leafTheme.getFamily();
  if (themeCurrentLabel) {
    themeCurrentLabel.textContent =
      themeFamilyName(family) + ' · ' + (THEME_MODE_NAMES[mode] || mode);
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
window.leafTheme.subscribe((theme) => {
  updateThemeSelection();
  reportWindowChrome(theme);
  refreshGraphColors();
  // The code view is Monaco; repaint it (and its minimap) from our palette so it
  // tracks the theme and light/dark like everything else.
  reskinMonacoForTheme();
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
