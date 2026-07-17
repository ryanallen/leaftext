// settings.js
import { applySpeedReaderIfEnabled } from './speed-reader.js';

// ---------------------------------------------------------------------------
// The web settings menu: a gear button pinned to the top-right of the page,
// just to the left of the minimap rail (never a full-width header above it).
// Opening it reveals a small panel — the same idea as the desktop app's
// settings menu, ported to the static site.
//
// It controls five things:
//   - Theme: System / Light / Dark / Dracula (mirrors the desktop app).
//   - Speed Reader: quiet links, regularized emphasis, and lead anchors.
//   - Show minimap: hide the side-rail overview and reclaim its space.
//   - Line numbers: hide the gutter permalink number beside each block (the
//     blocks keep their ids, so #locus deep links still resolve).
//   - Show library: hide the docs navigation sidebar (only offered on pages
//     that have one — the /docs reader, not the single-README site).
//
// Choices persist in localStorage and apply to <html> via data- attributes that
// styles.css keys off of (data-theme / data-speed-reader / data-minimap /
// data-line-numbers / data-library). The same keys are read by a tiny inline script in each page's
// <head> so the right theme paints on first load with no flash. This module just
// adds the UI and keeps the stored choice and the live page in sync.
// ---------------------------------------------------------------------------

const STORE_THEME = 'leaf.theme'; // 'system' | 'light' | 'dark' | 'dracula'
const STORE_SPEED_READER = 'leaf.speedReader'; // '1' (on) | '0' (off)
const STORE_MINIMAP = 'leaf.minimap'; // '1' (show) | '0' (hide)
const STORE_LINE_NUMBERS = 'leaf.lineNumbers'; // '1' (show) | '0' (hide)
const STORE_LIBRARY = 'leaf.library'; // '1' (show) | '0' (hide)

// The adjustments-vertical icon, same glyph the desktop app uses for Settings.
// Inlined so the menu needs no extra fetch; it inherits the button's color.
const GEAR_SVG =
  '<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" ' +
  'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>';

const root = document.documentElement;
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* private mode / storage disabled — choice just won't persist */
  }
}

// 'system' resolves to the device preference; the three explicit modes pass
// through. Keep this in lockstep with the inline <head> bootstrap in each page.
function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'dracula') return mode;
  return darkQuery && darkQuery.matches ? 'dark' : 'light';
}

function applyTheme(mode) {
  root.dataset.theme = resolveTheme(mode);
}
function applySpeedReader(enabled) {
  if (enabled) root.dataset.speedReader = 'true';
  else root.removeAttribute('data-speed-reader');
  document.querySelectorAll('.markdown-body').forEach((content) => applySpeedReaderIfEnabled(content));
}
function applyMinimap(show) {
  if (show) root.removeAttribute('data-minimap');
  else root.dataset.minimap = 'off';
}
function applyLineNumbers(show) {
  if (show) root.removeAttribute('data-line-numbers');
  else root.dataset.lineNumbers = 'off';
}
function applyLibrary(show) {
  if (show) root.removeAttribute('data-library');
  else root.dataset.library = 'off';
}

// Build one inline checkbox setting (label + help text).
function checkbox(id, label, help, checked) {
  return (
    `<label class="site-setting site-setting-inline" for="${id}">` +
    `<input type="checkbox" id="${id}"${checked ? ' checked' : ''}>` +
    `<span class="site-setting-label">${label}</span>` +
    `<span class="site-setting-help">${help}</span>` +
    `</label>`
  );
}

export function installSettings({ hasLibrary = false } = {}) {
  // Idempotent: the docs reader is a single-page app and may call this more than
  // once across re-renders, but the menu should exist exactly once.
  if (document.getElementById('siteSettings')) return;

  const themeMode = readStore(STORE_THEME, 'system');
  const speedReaderOn = readStore(STORE_SPEED_READER, '0') === '1';
  const minimapOn = readStore(STORE_MINIMAP, '1') !== '0';
  const lineNumbersOn = readStore(STORE_LINE_NUMBERS, '0') !== '0';
  const libraryOn = readStore(STORE_LIBRARY, '1') !== '0';

  // Make sure the live page matches the stored choices (the head bootstrap
  // already did this on first paint; this also covers storage written in
  // another tab and the very first visit with no stored values).
  applyTheme(themeMode);
  applySpeedReader(speedReaderOn);
  applyMinimap(minimapOn);
  applyLineNumbers(lineNumbersOn);
  if (hasLibrary) applyLibrary(libraryOn);

  const themeControl =
    '<label class="site-setting" for="siteSettingsTheme">' +
    '<span class="site-setting-label">Theme</span>' +
    '<select id="siteSettingsTheme" aria-label="Theme">' +
    '<option value="system">System</option>' +
    '<option value="light">Light</option>' +
    '<option value="dark">Dark</option>' +
    '<option value="dracula">Dracula</option>' +
    '</select>' +
    '<span class="site-setting-help">System follows your device preference.</span>' +
    '</label>';

  const details = document.createElement('details');
  details.className = 'site-settings';
  details.id = 'siteSettings';
  details.innerHTML =
    '<summary class="site-settings-button" aria-label="Settings" title="Settings">' +
    GEAR_SVG +
    '</summary>' +
    '<div class="site-settings-panel" role="group" aria-label="Settings">' +
    themeControl +
    checkbox(
      'siteSettingsSpeedReader',
      'Speed Reader',
      'Make prose quieter and add bold lead anchors for faster scanning.',
      speedReaderOn
    ) +
    checkbox(
      'siteSettingsMinimap',
      'Show minimap',
      'Show the scrollable document overview on wider screens.',
      minimapOn
    ) +
    checkbox(
      'siteSettingsLineNumbers',
      'Line numbers',
      'Number each block in the left margin as a copyable permalink.',
      lineNumbersOn
    ) +
    (hasLibrary
      ? checkbox(
          'siteSettingsLibrary',
          'Show library',
          'Show the navigation sidebar listing every page.',
          libraryOn
        )
      : '') +
    '</div>';
  document.body.appendChild(details);

  const themeSelect = details.querySelector('#siteSettingsTheme');
  themeSelect.value = themeMode;
  themeSelect.addEventListener('change', () => {
    writeStore(STORE_THEME, themeSelect.value);
    applyTheme(themeSelect.value);
  });

  const speedReaderCheck = details.querySelector('#siteSettingsSpeedReader');
  speedReaderCheck.addEventListener('change', () => {
    writeStore(STORE_SPEED_READER, speedReaderCheck.checked ? '1' : '0');
    applySpeedReader(speedReaderCheck.checked);
  });

  const minimapCheck = details.querySelector('#siteSettingsMinimap');
  minimapCheck.addEventListener('change', () => {
    writeStore(STORE_MINIMAP, minimapCheck.checked ? '1' : '0');
    applyMinimap(minimapCheck.checked);
  });

  const lineNumbersCheck = details.querySelector('#siteSettingsLineNumbers');
  lineNumbersCheck.addEventListener('change', () => {
    writeStore(STORE_LINE_NUMBERS, lineNumbersCheck.checked ? '1' : '0');
    applyLineNumbers(lineNumbersCheck.checked);
  });

  if (hasLibrary) {
    const libraryCheck = details.querySelector('#siteSettingsLibrary');
    libraryCheck.addEventListener('change', () => {
      writeStore(STORE_LIBRARY, libraryCheck.checked ? '1' : '0');
      applyLibrary(libraryCheck.checked);
    });
  }

  // When the theme is 'system', track live OS light/dark flips.
  if (darkQuery) {
    const onChange = () => {
      if ((readStore(STORE_THEME, 'system')) === 'system') applyTheme('system');
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onChange);
    else if (darkQuery.addListener) darkQuery.addListener(onChange);
  }

  // Close the menu when clicking outside it or pressing Escape — a <details>
  // otherwise stays open until its own summary is clicked again.
  document.addEventListener('click', (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && details.open) details.open = false;
  });
}
