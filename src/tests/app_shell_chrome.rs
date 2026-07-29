//! The app shell's chrome: app bar, icons, CSP, settings menu, theme and locale bootstrap.

use super::*;

#[test]
fn app_shell_csp_allows_bundled_data_fonts() {
    // Bundled fonts are `data:` URLs, so the CSP must grant `font-src ... data:`
    // or WebView2 silently blocks every one. Guard against that regression.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let font_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("font-src"))
        .expect("CSP declares an explicit font-src directive");
    assert!(
        font_src.contains("data:"),
        "font-src must allow data: URLs so bundled fonts load: {font_src}"
    );
}

#[test]
fn app_shell_stays_well_under_navigate_to_string_budget() {
    // WebView2 loads the shell through `ICoreWebView2::NavigateToString`, which
    // rejects content past ~2 MB with E_INVALIDARG (0x80070057) — the string is
    // measured as UTF-16, so the real ceiling is ~1M ASCII chars. Inlining the
    // ~1.3 MB reading-mode stylesheet blew past it (regression: "Leaf Text could
    // not start"). All heavy CSS now loads via `app.css` over the asset
    // protocol, so the shell is a small skeleton + inline bootstrap/app script.
    // This test fails loudly if any large blob is inlined back into the shell.
    let html = app_shell_html();
    let utf16_bytes = html.encode_utf16().count() * 2;
    const BUDGET_BYTES: usize = 1_400_000; // ~2/3 of the ~2 MB NavigateToString cap.
    assert!(
        utf16_bytes < BUDGET_BYTES,
        "app shell is {utf16_bytes} UTF-16 bytes, over the {BUDGET_BYTES}-byte \
         NavigateToString safety budget; do not inline large CSS/JS into the shell — \
         serve it over the leaf-asset:// protocol instead"
    );
    // NavigateToString takes a NUL-terminated wide string, so one stray NUL in a
    // string literal truncates the page there: a blank frame, no window controls.
    assert!(
        !html.contains('\0'),
        "app shell contains a NUL byte; NavigateToString would truncate the page there"
    );
}

#[test]
fn app_shell_renders_history_controls_and_intercepts_document_links() {
    let html = app_shell_html();

    for expected in [
            r#"<button type="button" id="backButton""#,
            r#"<button type="button" id="forwardButton""#,
            r#"<button type="button" id="homeButton" class="brand-button" data-i18n-aria-label="actions.home" data-i18n-title="actions.home.title" aria-label="Home" title="Home">"#,
            r#"<div class="tab-bar" id="tabBar" role="tablist" aria-label="Open documents"></div>"#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.back""#,
            r#"class="icon-button history-button" data-i18n-aria-label="actions.forward""#,
            r#"<svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">"#,
            r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
            r#"<path d="M18 6 6 18"/><path d="m6 6 12 12"/>"#,
            "backButton.addEventListener('click', () => sendNavigationCommand('goBack'))",
            "forwardButton.addEventListener('click', () => sendNavigationCommand('goForward'))",
            "homeButton.addEventListener('click', () => send({ command: 'goHome' }))",
            "function sendNavigationCommand(command) {",
            "function isEditableMouseTarget(target) {",
            "function navigationCommandForMouseButton(event) {",
            "event.button === 3",
            "return 'goBack';",
            "event.button === 4",
            "return 'goForward';",
            "window.addEventListener('mousedown', (event) => {",
            "event.preventDefault();",
            "const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';",
            "const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';",
            "event.key.toLowerCase() === 'w' && currentState.active != null",
            "send({ command: 'closeTab', index: currentState.active });",
            "command: 'switchTab',",
            "code_scroll: codeViewActive ? viewScrollFraction() : null,",
            "send({ command: 'closeTab', index: Number(button.dataset.tabClose) });",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'openLink', href: link.href || rawHref, scroll_anchor: currentScrollAnchor() });",
            "function bindDocumentLinks() {",
            "const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;",
            "window.leafSetNavigation({ canGoBack: false, canGoForward: false });",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
        "Back button must use the vendored arrow-left icon instead of the fallback chevron"
    );

    let forward_position = html
        .find(r#"<button type="button" id="forwardButton""#)
        .expect("app shell renders forward button");
    let nav_end_position = html
        .find("</nav>")
        .expect("app shell closes history navigation");
    let tab_bar_position = html
        .find(r#"<div class="tab-bar" id="tabBar""#)
        .expect("app shell renders the open-document tab bar");

    assert!(
        forward_position < nav_end_position && nav_end_position < tab_bar_position,
        "Tab bar should follow the history navigation controls"
    );
}

/// The header logomark and the library's per-file badge are the same glyph, and
/// neither may carry a color of its own: both inherit the theme through
/// `currentColor`, which is what keeps the library leaves in step with the
/// header when the theme changes.
#[test]
fn app_shell_inlines_one_leaf_mark_that_tracks_the_theme() {
    let html = app_shell_html();
    let leaf_path_prefix = r#"<path d="M59.7,60.1c-7.9-20.9"#;

    assert_eq!(
        html.matches(leaf_path_prefix).count(),
        2,
        "the leaf glyph should be inlined exactly twice: header logomark + library row template"
    );
    for (index, _) in html.match_indices(leaf_path_prefix) {
        let element_end = html[index..]
            .find("/>")
            .map(|offset| index + offset)
            .expect("inlined leaf path closes");
        assert!(
            html[index..element_end].contains(r#"fill="currentColor""#),
            "every inlined leaf mark fills with currentColor so it inherits the theme"
        );
    }
    assert!(
        !html.contains("#3fb950"),
        "the leaf mark must not ship a baked-in green; it inherits the theme color"
    );

    // Both sites point that inherited color at the theme's primary token.
    let css = reading_mode_css();
    for selector in [".brand-button > svg", ".library-file > svg"] {
        let rule_start = css
            .find(selector)
            .unwrap_or_else(|| panic!("{selector} is styled"));
        let rule_end = css[rule_start..]
            .find('}')
            .map(|offset| rule_start + offset)
            .expect("rule closes");
        assert!(
            css[rule_start..rule_end].contains("color: var(--primary)"),
            "{selector} should take the theme's primary color"
        );
    }
}

#[test]
fn app_shell_normalizes_literal_svg_icon_colors_to_current_color() {
    let icon = r##"<svg><path fill="#fff" stroke="#FFFFFF"/><path fill='white' stroke='none'/><path fill="#fff0eb" stroke="currentColor"/><path fill="rgb(255, 255, 255)" stroke="rebeccapurple"/><path fill-rule="evenodd"/><path style="fill:#fff; stroke: hsl(0 0% 100%); fill-opacity: 0.5"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="currentColor" stroke="currentColor"/><path fill='currentColor' stroke='none'/><path fill="currentColor" stroke="currentColor"/><path fill="currentColor" stroke="currentColor"/><path fill-rule="evenodd"/><path style="fill:currentColor; stroke: currentColor; fill-opacity: 0.5"/></svg>"##
    );
}

#[test]
fn app_shell_preserves_tokenized_svg_icon_colors() {
    let icon = r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="var(--leaf-icon-base)" stroke='var(--leaf-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##
    );
}

#[test]
fn app_shell_back_icon_uses_current_color_and_keeps_no_square_fallback() {
    let html = app_shell_html();

    assert_contains(&html, r#"stroke="currentColor""#);
    assert_contains(
        &html,
        r#"<path d="M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18" fill="none" stroke="currentColor""#,
    );
    assert!(
        !html.contains(r##"stroke="#fff""##)
            && !html.contains(r##"stroke="#ffffff""##)
            && !html.contains(r#"stroke="white""#),
        "app-owned icon SVGs must inherit the surrounding control color"
    );
    for hardcoded_color in [
        r##"fill="#fff0eb""##,
        r#"fill="rgb("#,
        r#"stroke="rgb("#,
        r#"fill="hsl("#,
        r#"stroke="hsl("#,
        r#"fill="black""#,
        r#"stroke="black""#,
        r#"fill="white""#,
        r#"stroke="white""#,
    ] {
        assert!(
            !html.contains(hardcoded_color),
            "app-owned icon SVGs must not contain hardcoded theme colors: {hardcoded_color}"
        );
    }
    assert!(
        !html.contains(r#"<path d="m15 18-6-6 6-6"/>"#),
        "Back button must not regress to the generic fallback chevron"
    );
}

#[test]
fn app_shell_styles_history_controls_with_neutral_icon_treatment() {
    let css = reading_mode_css();

    for expected in [
        ".history-button {",
        "border-color: transparent;",
        "background: var(--settings-control-background);",
        "color: var(--settings-control-foreground);",
        ".history-button:hover:not(:disabled)",
        ".history-button:disabled,\n.history-button:disabled:hover",
        "color: var(--app-muted-foreground);",
        "opacity: 0.46;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
    let css = reading_mode_css();

    for expected in [
        ".open-button {",
        "border-color: transparent;",
        "background: transparent;",
        "color: var(--app-muted-foreground);",
        ".open-button:hover {",
        "color: var(--app-action-foreground);",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_header_keeps_one_chrome_shade_with_dividers() {
    let css = reading_mode_css();

    for expected in [
        // One flat chrome shade under the dot grid. No translucent fill or backdrop
        // blur: either makes the bar's tone depend on what sits behind it.
        "background-color: var(--chrome-surface);",
        "radial-gradient(circle, var(--app-bar-grain) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        // The grain tiles from the window, so every grained surface shares one
        // lattice and no seam between them reads as a hairline.
        "background-attachment: fixed;",
        // The bar keeps a hairline top divider in the outer border color.
        "border-top: 1px solid var(--app-border);",
        // The bottom divider is drawn by ::after (not border-bottom) so the
        // active tab can paint over it and read as joined to the page below.
        ".app-bar::after {",
        "background: var(--app-border);",
    ] {
        assert_contains(css, expected);
    }

    // No blurred fade elements hanging below the bar, and no scroll shadow.
    for absent in [".app-bar::before", ".app-bar.is-scrolled"] {
        assert!(!css.contains(absent), "app header must not draw {absent}");
    }

    // No surface derives its own shade from the token — a tint on one shows up as a
    // tone seam where it meets its neighbor.
    assert!(!css.contains("--library-surface"));
    for tinted in [
        "color-mix(in srgb, var(--chrome-surface)",
        "color-mix(in srgb, var(--app-surface) 98%, black)",
    ] {
        assert!(!css.contains(tinted), "chrome must not tint {tinted}");
    }
}

#[test]
fn app_shell_persists_minimap_enabled_setting() {
    let html = app_shell_html();

    for expected in [
            "const minimapEnabledControl = document.getElementById('minimapEnabled');",
            "let minimapEnabled = typeof LEAF_SETTINGS.minimapEnabled === 'boolean' ? LEAF_SETTINGS.minimapEnabled : true;",
            "getEnabled: () => minimapEnabled",
            "setEnabled(nextEnabled)",
            "document.documentElement.dataset.minimapEnabled = String(minimapEnabled);",
            "window.leafMinimap.setEnabled(minimapEnabled);",
            "minimapEnabledControl.checked = window.leafMinimap.getEnabled();",
            "send({ command: 'setMinimapEnabled', enabled: minimapEnabledControl.checked });",
        ] {
            assert_contains(&html, expected);
        }

    // The host owns persistence now: no localStorage-backed settings remain.
    assert!(
        !html.contains("createBooleanStorage"),
        "settings must be persisted by the host, not the non-durable localStorage shim"
    );
}

#[test]
fn app_shell_persists_and_applies_speed_reader_setting() {
    let html = app_shell_html();
    let css = reading_mode_css();

    // The setting persists and applies, but it is driven from the reading
    // toolbar's own control now, not a Settings checkbox -- that row was removed
    // once the toolbar carried the toggle, so nothing here reads back from it.
    for expected in [
        "let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;",
        "function setSpeedReaderEnabled(enabled) {",
        "document.documentElement.dataset.speedReader = String(speedReaderEnabled);",
        "send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });",
        "applySpeedReaderToDocument();",
        "function leadAnchorPrefixLength(count) {",
        "anchor.className = 'speed-reader-anchor';",
    ] {
        assert_contains(&html, expected);
    }
    // The Settings checkbox and everything that fed it are gone.
    assert!(!html.contains(r#"id="speedReaderEnabled""#));
    assert!(!html.contains("speedReaderEnabledControl"));

    for expected in [
        r#":root[data-speed-reader="true"] .document-body a,"#,
        "color: inherit;",
        "text-decoration: none;",
        r#":root[data-speed-reader="true"] .document-body a:hover,"#,
        "color: var(--markdown-link-hover);",
        r#":root[data-speed-reader="true"] .document-body .speed-reader-anchor"#,
        "font-weight: 700;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_labels_minimap_setting_and_hides_decorative_marks_from_accessibility() {
    let html = app_shell_html();

    for expected in [
            r#"<label class="setting-control setting-control-inline" for="minimapEnabled">"#,
            r#"<input type="checkbox" id="minimapEnabled" aria-label="Show document minimap" aria-describedby="minimapEnabledHelp">"#,
            r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
            "minimapEnabledControl.setAttribute('aria-label', window.leafLocale.t('settings.minimap.aria'));",
            "aria-label=\"${escapeAttr(window.leafLocale.t('minimap.aria'))}\"",
            "document-minimap-track\" aria-hidden=\"true\"",
            "document-minimap-content\" aria-hidden=\"true\"",
            "document-minimap-viewport\" aria-hidden=\"true\"",
        ] {
            assert_contains(&html, expected);
        }

    assert!(
        !html.contains("document-minimap-track\" tabindex"),
        "minimap track should not enter the tab order"
    );
    assert!(
        !html.contains("document-minimap\" tabindex"),
        "minimap aside should not enter the tab order"
    );
}

#[test]
fn app_shell_reacts_to_minimap_and_theme_settings() {
    let html = app_shell_html();

    let minimap_subscription_position = html
        .find("window.leafMinimap.subscribe((enabled) => {")
        .expect("app shell subscribes to minimap changes");
    let minimap_render_position = html
        .find("minimapEnabledControl.checked = enabled;\n  renderState();")
        .expect("minimap subscription rerenders document state");

    assert!(
        minimap_subscription_position < minimap_render_position,
        "minimap visibility should remain a WebView setting"
    );
    assert_contains(&html, "window.leafTheme.subscribe((theme) => {");
    assert_contains(&html, "window.leafTheme.setMode(btn.dataset.mode)");
    assert_contains(&html, "window.leafTheme.setFamily(btn.dataset.family)");
}

#[test]
fn app_shell_theme_bootstrap_supports_system_light_dark_modes() {
    let html = app_shell_html();

    assert_contains(&html, r#"<meta name="color-scheme" content="light dark">"#);
    // Injected from the registry, so it can't drift from the registered sources.
    assert_contains(
        &html,
        &format!(
            "const VALID_FAMILIES = new Set({});",
            theme_family_ids_json()
        ),
    );
    assert_eq!(
        theme_family_ids_json(),
        r#"["amaranth","arabica","fern","ginger","github","goldenrod","halcyon","nightshade","pippin","sage"]"#
    );
    assert_contains(
        &html,
        "const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);",
    );
    // Seeded from the host-injected global, not localStorage (non-durable here).
    assert_contains(
        &html,
        "let familyPreference = normalizePreference(settings.themeFamily);",
    );
    assert_contains(
        &html,
        "let family = familyPreference === RANDOM ? drawRandomFamily() : familyPreference;",
    );
    assert_contains(&html, "let mode = normalizeMode(settings.themeMode);");
    // The Random preference draws a non-repeating family per launch, persisting
    // the bag through the host so the cycle survives restarts.
    assert_contains(&html, "const REAL_FAMILIES = Array.from(VALID_FAMILIES);");
    assert_contains(&html, "const RANDOM = 'random';");
    assert_contains(&html, "const drawRandomFamily = () => {");
    assert_contains(
        &html,
        "window.ipc.postMessage(JSON.stringify({ command: 'setThemeRandomBag', used: randomBag }));",
    );
    // The Leaf-owned attributes that drive the compiled theme CSS.
    assert_contains(&html, "root.dataset.leafTheme = family;");
    assert_contains(&html, "root.dataset.leafAppearance = theme.resolvedTheme;");
    assert_contains(&html, "root.dataset.themeMode = mode");
    // The dead Primer color-mode attributes are gone from the bootstrap.
    assert!(!html.contains("root.dataset.colorMode"));
    assert!(!html.contains("root.dataset.resolvedColorMode"));
    assert_contains(&html, "root.dataset.themeFamily = family;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme");
    assert_contains(&html, "getMode: () => mode");
    assert_contains(&html, "getFamily: () => familyPreference");
    assert_contains(&html, "getResolvedTheme: resolvedTheme");
    assert_contains(&html, "mode = normalizeMode(nextMode);");
    assert_contains(&html, "familyPreference = normalizePreference(nextFamily);");
    // Daylight flips light/dark by the local clock, on a rescheduling timer.
    assert_contains(
        &html,
        "if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';",
    );
    assert_contains(&html, "const scheduleDaylight = () => {");
    assert_contains(&html, "subscribe(listener)");
    assert_contains(&html, "listeners.forEach((listener) => listener(theme))");
    assert_contains(
        &html,
        "media.addEventListener('change', onSystemThemeChange)",
    );
    assert_contains(&html, "media.addListener(onSystemThemeChange)");
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert_contains(&html, "settings.theme.");
    assert!(!html.contains("themeVariant"));
    assert!(!html.contains("customTheme"));
    assert!(!html.contains("leafThemeSource"));
    assert!(!html.contains("getLightTheme"));
    assert!(!html.contains("getDarkTheme"));
}

#[test]
fn app_shell_groups_settings_menu_with_accessible_descriptions() {
    let html = app_shell_html();

    assert_contains(
        &html,
        r#"<details class="settings-menu" id="settingsMenu">"#,
    );
    assert_contains(
        &html,
        r#"<summary id="settingsSummary" class="icon-button" data-i18n-aria-label="settings.heading" data-i18n-title="settings.heading" aria-label="Settings" title="Settings">"#,
    );
    assert_contains(
        &html,
        r#"<path d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/>"#,
    );
    assert_contains(
        &html,
        r#"<div class="settings-panel" role="group" aria-labelledby="settingsSummary">"#,
    );
    // Theme lives in a bottom sheet opened from a single settings row.
    assert_contains(
        &html,
        r#"<button type="button" class="setting-theme-open" id="themeSheetOpen" aria-haspopup="dialog">"#,
    );
    assert_contains(
        &html,
        r#"<span class="setting-help" id="minimapEnabledHelp" data-i18n="settings.minimap.help">Show a scrollable document overview on wider windows.</span>"#,
    );
    assert_contains(
        &html,
        "const settingsMenu = document.getElementById('settingsMenu');",
    );
    assert_contains(&html, "if (event.key === 'Escape')");
    assert_contains(&html, "settingsMenu.querySelector('summary').focus();");
    assert_contains(
        &html,
        "if (settingsMenu.open && !settingsMenu.contains(event.target))",
    );
    assert_contains(&html, r#"id="themeSheet""#);
    assert_contains(&html, r#"data-i18n="settings.theme.sheet.title""#);
    assert!(!html.contains("localeModeHelp"));
    assert!(!html.contains(r#"for="localeMode""#));
}

#[test]
fn app_shell_keeps_settings_menu_keyboard_and_pointer_polish() {
    let html = app_shell_html();

    for expected in [
        "settingsMenu.addEventListener('keydown', (event) => {",
        "if (event.key === 'Escape') {",
        "settingsMenu.open = false;",
        "settingsMenu.querySelector('summary').focus();",
        "document.addEventListener('click', (event) => {",
        "if (settingsMenu.open && !settingsMenu.contains(event.target)) {",
        "minimapEnabledControl.addEventListener('change'",
    ] {
        assert_contains(&html, expected);
    }

    let css = reading_mode_css();

    for expected in [
        ".settings-menu summary::-webkit-details-marker",
        ".settings-panel {",
        ".setting-control-inline",
        ".setting-control-inline input",
        "input:focus-visible",
        "right: 0;",
        "width: min(290px, calc(100vw - 28px));",
        "summary:focus-visible",
        ".icon-button {",
        "place-items: center;",
        "min-width: 32px;",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_theme_bootstrap_resolves_manual_and_system_modes() {
    let html = app_shell_html();

    assert_contains(&html, "if (mode === 'light') return 'light';");
    assert_contains(&html, "if (mode === 'dark') return 'dark';");
    assert_contains(
        &html,
        "if (mode === 'daylight') return isDaytime() ? 'light' : 'dark';",
    );
    assert_contains(&html, "return media && media.matches ? 'dark' : 'light';");
    assert_contains(&html, "setMode(nextMode) {");
    assert_contains(&html, "setFamily(nextFamily) {");
    assert_contains(
        &html,
        "const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };",
    );
    assert_contains(&html, "root.dataset.themeMode = mode;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme;");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme;");
}

#[test]
fn app_shell_theme_bootstrap_seeds_from_host_injected_settings() {
    let html = app_shell_html();

    for expected in [
        "const VALID_MODES = new Set(['system', 'light', 'dark', 'daylight']);",
        "const settings = (window.__leafSettings && typeof window.__leafSettings === 'object') ? window.__leafSettings : {};",
        "let familyPreference = normalizePreference(settings.themeFamily);",
        "let mode = normalizeMode(settings.themeMode);",
        "mode = normalizeMode(nextMode);",
        "familyPreference = normalizePreference(nextFamily);",
        "listeners.forEach((listener) => listener(theme));",
    ] {
        assert_contains(&html, expected);
    }

    // The theme path no longer touches localStorage; the host owns persistence
    // via setThemeMode / setThemeFamily. (The locale bootstrap keeps its own
    // storage, so we check theme-specific markers.)
    assert!(!html.contains("leaf.themeMode"));
    assert!(!html.contains("modeStorage"));
    assert!(html.contains("send({ command: 'setThemeMode', mode: btn.dataset.mode });"));
    assert!(html.contains("send({ command: 'setThemeFamily', family: btn.dataset.family });"));
}

#[test]
fn app_shell_locale_persistence_adapter_normalizes_state_transitions() {
    let html = app_shell_html();

    for expected in [
            "const STORAGE_KEY = 'leaf.localeMode';",
            "const MODE_FALLBACK = 'system';",
            "const createModeStorage = (storageKey) => ({",
            "const normalizeMode = (value) => (VALID_MODES.has(value) ? value : MODE_FALLBACK);",
            "const storage = createModeStorage(STORAGE_KEY);\n  let mode = normalizeMode(storage.read());",
            "mode = normalizeMode(nextMode);\n      storage.write(mode);\n      apply();",
            "window.addEventListener('languagechange', () => {",
            "if (mode === 'system') {\n      apply();\n    }",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_exposes_locale_settings_translations_and_ime_guard() {
    let html = app_shell_html();

    assert_contains(&html, "leaf.localeMode");
    assert_contains(&html, "VALID_MODES = new Set(['system', 'en', 'zh-CN'])");
    assert_contains(&html, "root.lang = locale.resolvedLocale");
    assert_contains(&html, "root.dataset.localeMode = locale.mode");
    assert_contains(&html, "root.dataset.locale = locale.resolvedLocale");
    assert_contains(&html, "let mode = normalizeMode(storage.read());");
    assert_contains(&html, "mode = normalizeMode(nextMode);");
    assert_contains(&html, "const TRANSLATIONS = {");
    assert_contains(&html, "'actions.open': 'Open'");
    assert_contains(&html, "'actions.close': 'Close file'");
    assert_contains(&html, "'actions.open': '打开'");
    assert_contains(&html, "'actions.close': '关闭文件'");
    assert_contains(&html, "'settings.heading': 'Settings'");
    assert_contains(&html, "'settings.heading': '设置'");
    assert_contains(&html, "'settings.theme.label': 'Theme'");
    assert_contains(&html, "'settings.theme.system': 'System'");
    assert_contains(&html, "'settings.theme.light': 'Light'");
    assert_contains(&html, "'settings.theme.dark': 'Dark'");
    assert_contains(
        &html,
        "'errors.openFailed': 'Failed to open {path}: {reason}'",
    );
    assert_contains(&html, "'errors.openFailed': '无法打开 {path}：{reason}'");
    assert_contains(&html, "TRANSLATIONS.en[key] || key");
    assert_contains(&html, "Object.prototype.hasOwnProperty.call(values, name)");
    assert_contains(&html, "new Intl.NumberFormat(resolveLocale(), options)");
    assert_contains(&html, "new Intl.DateTimeFormat(resolveLocale(), options)");
    assert_contains(
        &html,
        "new Intl.RelativeTimeFormat(resolveLocale(), options)",
    );
    assert_contains(&html, "formatFileSize(bytes)");
    assert_contains(&html, "window.addEventListener('compositionstart'");
    assert_contains(&html, "window.addEventListener('compositionupdate'");
    assert_contains(&html, "window.addEventListener('compositionend'");
    assert_contains(&html, "if (event.isComposing || composing)");
    assert_contains(&html, "renderState();");
    assert_contains(&html, "state.document.html");
}

#[test]
fn app_shell_initializes_reader_state_before_locale_subscription_renders() {
    let html = app_shell_html();
    let state_position = html
        .find("let currentState = { recent: [], tabs: [], active: null, document: null };")
        .expect("app shell declares reader state");
    let locale_subscription_position = html
        .find("window.leafLocale.subscribe(() => {")
        .expect("app shell subscribes to locale changes");

    assert!(
        state_position < locale_subscription_position,
        "locale subscription renders immediately, so reader state must exist first"
    );
}

#[test]
fn app_shell_locale_bootstrap_keeps_initial_text_nonblank() {
    let html = app_shell_html();

    let subscription_position = html
        .find("window.leafLocale.subscribe(() => {")
        .expect("app shell subscribes to locale changes");
    let static_text_position = html
        .find("  renderStaticText();")
        .expect("locale subscription refreshes static text");
    // Anchor to the renderState() right after renderStaticText(), since other
    // renderState() calls appear elsewhere.
    let state_render_position = html[static_text_position..]
        .find("  renderState();")
        .map(|offset| static_text_position + offset)
        .expect("locale subscription renders reader state");
    let initial_state_position = html
        .find("window.leafSetState(window.__leafInitialState || { recent: [], document: null });")
        .expect("app shell renders the initial empty state");

    assert!(
        subscription_position < static_text_position
            && static_text_position < state_render_position
            && state_render_position < initial_state_position,
        "locale bootstrap must refresh shell copy before the initial empty state render"
    );

    for expected in [
            "'actions.open': 'Open'",
            "'actions.chooseFile': 'Choose file'",
            "'actions.close': 'Close file'",
            "'empty.description': 'Open a file and read it in peace. It stays on your device, in plain text you own.'",
            "'empty.kicker': 'Leaf Text'",
            "'empty.title': 'Refine your mind.'",
            "'empty.subtitle': 'Your thoughts, secure and free.'",
            "'empty.noRecent': 'Files you open show up here, so you can pick up where you left off.'",
            "'settings.heading': 'Settings'",
            "TRANSLATIONS.en[key] || key",
        ] {
            assert_contains(&html, expected);
        }
}

#[test]
fn app_shell_csp_allows_github_api_for_update_check() {
    // The update check fetches api.github.com; without a connect-src grant the
    // webview's default-src 'self' blocks it. Guard against that regression.
    let html = app_shell_html();
    let csp_line = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy");
    let connect_src = csp_line
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src"))
        .expect("CSP declares an explicit connect-src directive");
    assert!(
        connect_src.contains("https://api.github.com"),
        "connect-src must allow the GitHub API for the update check: {connect_src}"
    );
}

#[test]
fn the_code_view_payload_url_is_one_the_page_is_allowed_to_fetch() {
    // Three ways this has gone wrong, each showing up as a code view that never
    // appears: a raw custom-scheme URL (Windows cannot route one), a CSP that does
    // not name the origin, and a response without CORS — the scheme is a different
    // origin from the page, so the fetch is refused before the first byte.
    let url = source_payload_url("leaf-source", 7);

    if cfg!(any(target_os = "windows", target_os = "android")) {
        assert_eq!(url, "http://leaf-source.local/payload/7");
    } else {
        assert_eq!(url, "leaf-source://local/payload/7");
    }

    let html = app_shell_html();
    let connect_src = html
        .lines()
        .find(|line| line.contains("Content-Security-Policy"))
        .expect("shell declares a Content-Security-Policy")
        .split(';')
        .map(str::trim)
        .find(|directive| directive.starts_with("connect-src"))
        .expect("CSP declares an explicit connect-src directive")
        .to_string();

    // Derived from the URL rather than spelled out again, so the two cannot drift.
    let (scheme, rest) = url.split_once("://").expect("the payload URL has a scheme");
    let origin = format!("{scheme}://{}", rest.split('/').next().unwrap_or_default());
    assert!(
        connect_src.contains(&origin),
        "connect-src must allow {origin} or the code view cannot fetch its source: {connect_src}"
    );
}

#[test]
fn an_unsaved_tab_does_not_resize_when_you_reach_for_it() {
    // The dot was in the tab's row and hidden on hover, so pointing at a modified
    // tab deleted 13px of content: the tab shrank and its label jumped, and the
    // dot had been shoving the close button away from the name the whole time.
    // Sharing the button's corner means the swap costs no layout.
    let css = reading_mode_css();

    let dot = css
        .split(".tab-dirty-dot {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the unsaved-edits dot");
    assert!(
        dot.contains("position: absolute;"),
        "the dot must be out of flow or showing it resizes the tab: {dot}"
    );
    assert!(
        !dot.contains("margin"),
        "an out-of-flow dot has no margin to push the row with: {dot}"
    );
    assert!(
        dot.contains("pointer-events: none;"),
        "the close button underneath stays the click target: {dot}"
    );

    // The close button sits in the same corner, so the two swap in place.
    let close = css
        .split(".tab-close {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the close button");
    assert!(close.contains("position: absolute;"));
    assert!(close.contains("top: 2px;") && close.contains("right: 2px;"));

    // One corner, one occupant — and the keyboard can still get to the button.
    assert_contains(
        css,
        ".tab-modified:hover .tab-dirty-dot,\n.tab-modified:focus-within .tab-dirty-dot {\n  display: none;\n}",
    );
    assert_contains(
        css,
        ".tab-modified:not(:hover):not(:focus-within) .tab-close {\n  opacity: 0;\n}",
    );
    // The old rule resized the tab and only ever covered the active one.
    assert!(
        !css.contains(".tab-active:hover .tab-dirty-dot"),
        "the hover rule that resized the tab is gone"
    );

    // And the tab reserves that corner, since an absolute button buys no room.
    let tab = css
        .split("\n.tab {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines a tab");
    assert!(
        tab.contains("padding: 0 12px 0 4px;"),
        "a short name would otherwise end under the close button: {tab}"
    );
}
