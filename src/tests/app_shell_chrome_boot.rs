//! What the page brings before a script runs: the policy, the budget, the placeholders and the theme bootstrap.

use super::*;

#[test]
fn app_shell_csp_allows_bundled_data_fonts() {
    // Bundled fonts are `data:` URLs, so the CSP must grant `font-src ... data:` or WebView2 silently blocks every one. Guard against that regression.
    let html = app_shell_page();
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
fn the_front_end_is_served_beside_the_shell_not_inside_it() {
    // The page goes to WebView2 as one string with a ceiling on it, and the script was 88% of it. So it is linked, and the link has to be there: a tag pointing at nothing is a window that opens and does nothing, with nothing to say why.
    let page = app_shell_html();
    let script = app_shell_script();

    assert_contains(&page, "<script src=\"");
    // Anonymous mode is the request half of the CORS pair that lets a throw inside the script reach window.onerror with its place instead of the masked `Script error.`. The version query keeps a new binary out of an old binary's cache entry, whose stored headers would re-mask every throw.
    assert_contains(&page, "app.js?v=");
    assert_contains(&page, "\" crossorigin=\"anonymous\"></script>");
    // One tag, and no inline script: the fragments are one shared scope, so a second tag would be a second scope.
    assert_eq!(page.matches("<script src=").count(), 1);
    assert!(
        !page.contains(
            "
<script>
"
        ),
        "the front-end is inlined into the shell again"
    );
    assert!(
        !page.contains("function parseFlow("),
        "the flowchart grammar is inlined into the shell again"
    );
    assert_contains(script, "function parseFlow(");
    assert_contains(script, "function openFlowSheet(");
    // The flowchart pair leads the script, ahead of everything that calls into it.
    assert!(
        script.find("function parseFlow(") < script.find("function leafToast("),
        "the flowchart grammar must come before the fragments that call it"
    );
    // Served, and served as script: a wrong content type is a silent no-op.
    let (content_type, body) =
        bundled_asset_bytes("leaf-asset://local/app.js").expect("app.js is a bundled asset");
    assert_eq!(content_type, "text/javascript; charset=utf-8");
    assert_eq!(body, script.as_bytes());
    // Nothing answers to the old name.
    assert!(bundled_asset_bytes("leaf-asset://local/flow.js").is_none());
}

#[test]
fn app_shell_stays_well_under_navigate_to_string_budget() {
    // WebView2 loads the shell through `ICoreWebView2::NavigateToString`, which rejects content past ~2 MB with E_INVALIDARG (0x80070057) — the string is measured as UTF-16, so the real ceiling is ~1M ASCII chars. Inlining the ~1.3 MB reading-mode stylesheet blew past it (regression: "Leaftext could not start"). The stylesheet and the front-end script both load over the asset protocol now, so the page is a skeleton and the theme bootstrap. This test fails loudly if any large blob is inlined back into it.
    let html = app_shell_html();
    let utf16_bytes = html.encode_utf16().count() * 2;
    const BUDGET_BYTES: usize = 1_400_000; // ~2/3 of the ~2 MB NavigateToString cap.
    assert!(
        utf16_bytes < BUDGET_BYTES,
        "app shell is {utf16_bytes} UTF-16 bytes, over the {BUDGET_BYTES}-byte \
         NavigateToString safety budget; do not inline large CSS/JS into the shell — \
         serve it over the leaf-asset:// protocol instead"
    );
    // NavigateToString takes a NUL-terminated wide string, so one stray NUL in a string literal truncates the page there: a blank frame, no window controls.
    assert!(
        !html.contains('\0'),
        "app shell contains a NUL byte; NavigateToString would truncate the page there"
    );
}

#[test]
fn app_shell_renders_history_controls_and_intercepts_document_links() {
    let html = app_shell_page();

    for expected in [
            r#"<button type="button" id="backButton""#,
            r#"<button type="button" id="forwardButton""#,
            r#"<button type="button" id="homeButton" class="brand-button" aria-label="Home" title="Home">"#,
            r#"<div class="tab-bar" id="tabBar" role="tablist" aria-label="Open documents"></div>"#,
            r#"class="icon-button history-button" aria-label="Back""#,
            r#"class="icon-button history-button" aria-label="Forward""#,
            r#"<span class="lt-icon lt-icon-back"></span>"#,
            r#"<span class="lt-icon lt-icon-forward"></span>"#,
            r#"<span class="lt-icon lt-icon-tab-close"></span>"#,
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
            "const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';",
            "const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';",
            "event.key.toLowerCase() === 'w' && currentState.active != null",
            "send({ command: 'closeTab', index: currentState.active });",
            "send({ command: 'closeTab', index: Number(close.dataset.tabClose) });",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });",
            "function bindDocumentLinks() {",
            "function documentLinkFor(target) {",
            "const link = target && target.closest ? target.closest('a[href]') : null;",
            "window.leafSetNavigation({ canGoBack: false, canGoForward: false });",
        ] {
            assert_contains(&html, expected);
        }

    // The page holds all three of these lines in several places, so which block each is in is the claim: the press swallows the browser's own answer to a mouse button, and Ctrl+Tab switches tabs carrying the place in the source view with it.
    assert_in(
        &html,
        "window.addEventListener('mousedown', (event) => {",
        "event.preventDefault();",
    );
    for expected in [
        "command: 'switchTab',",
        "code_scroll: codeViewActive ? viewScrollFraction() : null,",
    ] {
        assert_in(
            &html,
            "if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {",
            expected,
        );
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

#[test]
fn the_minimap_is_always_on_and_still_one_switch() {
    let html = app_shell_page();

    // Nothing turns the rail off, so the seed is a constant. The switch stays because the rail still comes and goes with the document, and everything that draws it asks here rather than keeping its own copy.
    for expected in [
        "let minimapEnabled = true;",
        "getEnabled: () => minimapEnabled",
        "setEnabled(nextEnabled)",
        "document.documentElement.dataset.minimapEnabled = String(minimapEnabled);",
        "window.leafMinimap.setEnabled(minimapEnabled);",
    ] {
        assert_contains(&html, expected);
    }

    // The checkbox, the command it sent, and the saved value are all gone.
    for gone in [
        "minimapEnabledControl",
        "setMinimapEnabled",
        "LEAF_SETTINGS.minimapEnabled",
        "setPagerEnabled",
        "pagerEnabled",
    ] {
        assert!(!html.contains(gone), "the toggle is back: {gone}");
    }

    // The host owns persistence: no localStorage-backed settings.
    assert!(
        !html.contains("createBooleanStorage"),
        "settings must be persisted by the host, not the non-durable localStorage shim"
    );
}

#[test]
fn app_shell_persists_and_applies_speed_reader_setting() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The setting persists and applies, but the reading toolbar's own control is what drives it — there is no Settings checkbox to read back from.
    for expected in [
        "let speedReaderEnabled = LEAF_SETTINGS.speedReaderEnabled === true;",
        "function setSpeedReaderEnabled(enabled) {",
        "document.documentElement.dataset.speedReader = String(speedReaderEnabled);",
        "send({ command: 'setSpeedReaderEnabled', enabled: speedReaderEnabled });",
        "function leadAnchorPrefixLength(count) {",
        "anchor.className = 'speed-reader-anchor';",
    ] {
        assert_contains(&html, expected);
    }
    // A render applies it too, so turning it on is what has to reach the document that is already open.
    assert_in(
        &html,
        "function setSpeedReaderEnabled(enabled) {",
        "applySpeedReaderToDocument();",
    );

    // The Settings checkbox and everything that fed it are gone.
    assert!(!html.contains(r#"id="speedReaderEnabled""#));
    assert!(!html.contains("speedReaderEnabledControl"));

    for expected in [
        r#":root[data-speed-reader="true"] .document-body a,"#,
        "color: inherit;",
        "text-decoration: none;",
        r#":root[data-speed-reader="true"] .document-body a:hover,"#,
        "color: var(--lt-link-hover);",
        r#":root[data-speed-reader="true"] .document-body .speed-reader-anchor"#,
        "font-weight: var(--lt-weight-700);",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_hides_the_minimaps_decorative_marks_from_accessibility() {
    let html = app_shell_page();

    for expected in [
        "aria-label=\"Document minimap\"",
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
    let html = app_shell_page();

    // The rail still comes and goes with the document, so the subscription has to re-render the page — which is the whole of what it does.
    assert_contains(
        &html,
        "window.leafMinimap.subscribe(() => {\n  renderState();",
    );
    assert_contains(&html, "window.leafTheme.subscribe((theme) => {");
    assert_contains(&html, "window.leafTheme.setMode(btn.dataset.mode)");
    assert_contains(&html, "window.leafTheme.setFamily(btn.dataset.family)");
}

#[test]
fn app_shell_theme_bootstrap_supports_system_light_dark_modes() {
    let html = app_shell_page();

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
        r#"["amaranth","arabica","bloodleaf","fern","ginger","github","goldenrod","halcyon","nightshade","pippin","sage"]"#
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
    // The Random preference draws a non-repeating family per launch, persisting the bag through the host so the cycle survives restarts.
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
    // And no Primer color-mode attributes beside them.
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
    // The page's own settings object holds that line too, so the bootstrap's is named by what it does with the listener.
    assert_contains(
        &html,
        "      listeners.add(listener);
      listener(snapshot());",
    );
    assert_contains(&html, "listeners.forEach((listener) => listener(theme))");
    assert_contains(
        &html,
        "media.addEventListener('change', onSystemThemeChange)",
    );
    assert_contains(&html, "media.addListener(onSystemThemeChange)");
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert_contains(&html, "const THEME_MODE_NAMES = { system: 'System', light: 'Light', dark: 'Dark', daylight: 'Daylight' };");
    assert!(!html.contains("themeVariant"));
    assert!(!html.contains("customTheme"));
    assert!(!html.contains("leafThemeSource"));
    assert!(!html.contains("getLightTheme"));
    assert!(!html.contains("getDarkTheme"));
}

#[test]
fn app_shell_theme_bootstrap_resolves_manual_and_system_modes() {
    let html = app_shell_page();

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
        "const onSystemThemeChange = () => { if (mode === 'system' && !holdingAppearance) { apply(); } };",
    );
    assert_contains(&html, "root.dataset.themeMode = mode;");
    assert_contains(&html, "root.dataset.theme = theme.resolvedTheme;");
    assert_contains(&html, "root.style.colorScheme = theme.resolvedTheme;");
}

#[test]
fn app_shell_theme_bootstrap_seeds_from_host_injected_settings() {
    let html = app_shell_page();

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

    // The theme path never touches localStorage; the host owns persistence via setThemeMode / setThemeFamily.
    assert!(!html.contains("leaf.themeMode"));
    assert!(!html.contains("modeStorage"));
    assert!(html.contains("send({ command: 'setThemeMode', mode: btn.dataset.mode });"));
    assert!(html.contains("send({ command: 'setThemeFamily', family: btn.dataset.family });"));
}

#[test]
fn app_shell_guards_shortcuts_while_a_character_is_being_composed() {
    let html = app_shell_page();

    // An input method (and the emoji picker, and accented letters) sends keydown while a character is still being assembled. Acting on those keystrokes steals them from the composition, so every shortcut waits for it to end.
    assert_contains(&html, "window.addEventListener('compositionstart'");
    assert_contains(&html, "window.addEventListener('compositionupdate'");
    assert_contains(&html, "window.addEventListener('compositionend'");
    assert_contains(&html, "if (event.isComposing || composing)");
}

#[test]
fn app_shell_markup_carries_its_own_text_before_any_script_runs() {
    let html = app_shell_page();

    // Every label is in the markup or in the fragment that writes it, so the first frame is never a shell of blank buttons waiting on script.
    for expected in [
        r#"aria-label="Open" title="Open Markdown file""#,
        // The home screen's three top lines are chosen per visit, so the page carries the slots and the whole registry rather than one fixed slogan.
        "<h1>${escapeText(homeMessage.hero)}</h1>",
        r#"<p class="empty-subtitle">${escapeText(homeMessage.subtitle)}</p>"#,
        r#"<p class="empty-description">${escapeText(homeMessage.description)}</p>"#,
        ">Choose file</button>",
        "Files you open show up here.",
        r#"aria-label="Themes" title="Themes""#,
        // The window behind this press offers a PDF and a web page, so the button names the window rather than either format.
        r#"aria-label="Export" title="Export the page""#,
        r#"<span class="reader-subselect-label">Graph size</span>"#,
    ] {
        assert_contains(&html, expected);
    }

    // One approved headline, subtitle and sentence per family, so a line dropped out of the registry fails here rather than on somebody's home screen.
    for expected in [
        // The registry's own spelling: the words alone are also a blank block's placeholder.
        "hero: 'Turn over a new leaf.',",
        "Knowledge kept, leaf by leaf.",
        "A palm-leaf book was threaded through a single hole and bound between wooden covers. Open yours.",
        "Refine your mind.",
        "Your thoughts, secure and free.",
        "A quiet place for clear thinking.",
        "Your files stay files.",
        "Open what you already own.",
        "Open a file and read it in peace. It stays on your device, in plain text you own.",
    ] {
        assert_contains(&html, expected);
    }

    let initial_state_position = html
        .find(
            "window.leafSetState(window.__leafInitialState || { recent: [], favorites: [], document: null });",
        )
        .expect("app shell renders the initial empty state");
    let state_declaration = html
        .find("let currentState = { recent: [], favorites: [], tabs: [], active: null, document: null };")
        .expect("app shell declares reader state");
    assert!(
        state_declaration < initial_state_position,
        "reader state must exist before the first render"
    );
}

#[test]
fn app_shell_csp_allows_github_api_for_update_check() {
    // The update check fetches api.github.com; without a connect-src grant the webview's default-src 'self' blocks it. Guard against that regression.
    let html = app_shell_page();
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
    // Three ways this has gone wrong, each showing up as a code view that never appears: a raw custom-scheme URL (Windows cannot route one), a CSP that does not name the origin, and a response without CORS — the scheme is a different origin from the page, so the fetch is refused before the first byte.
    let url = source_payload_url("leaf-source", 7);

    if cfg!(any(target_os = "windows", target_os = "android")) {
        assert_eq!(url, "http://leaf-source.local/payload/7");
    } else {
        assert_eq!(url, "leaf-source://local/payload/7");
    }

    let html = app_shell_page();
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
fn app_shell_fills_every_placeholder() {
    // Every `{{...}}` in the template must be filled, or it ships as braces.
    let html = app_shell_page();
    let mut rest = crate::APP_SHELL_HTML;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start..];
        let end = after.find("}}").expect("template placeholder closes") + 2;
        let placeholder = &after[..end];
        assert!(
            !html.contains(placeholder),
            "app_shell_html leaves {placeholder} unfilled"
        );
        rest = &after[end..];
    }
}

#[test]
fn document_extensions_ride_to_the_page_from_the_format_table() {
    // The boot script must carry every extension the format table declares.
    let script = initial_document_exts_script();
    assert!(script.starts_with("window.__leafDocumentExts = ["));
    for extension in all_document_extensions() {
        assert!(
            script.contains(&format!("\"{extension}\"")),
            "extension {extension} missing from {script}"
        );
    }
}

/// The menu a Mac gets before its save window opens, which is the only place those formats are ever said there — so what the page draws is the format table itself, in its own order, and never a list written beside it.
#[test]
fn readable_formats_ride_to_the_page_from_the_format_table() {
    let script = initial_document_formats_script();
    assert!(script.starts_with("window.__leafDocumentFormats = ["));
    let listed: serde_json::Value = serde_json::from_str(
        script
            .trim_start_matches("window.__leafDocumentFormats = ")
            .trim_end_matches(';'),
    )
    .expect("the page is handed a list it can read");
    let expected: Vec<serde_json::Value> = DocumentFormat::ALL
        .iter()
        .map(|format| {
            serde_json::json!({ "label": format.display_name(), "ext": format.extensions()[0] })
        })
        .collect();
    assert_eq!(
        listed,
        serde_json::Value::Array(expected),
        "the menu offers a format the app cannot read, misses one it can, or names it something the rest of the app does not"
    );
    // The ending each row writes is the canonical one, not an accepted spelling: a note saved as YAML gets .yaml.
    assert!(
        script.contains("\"ext\":\"yaml\"") && !script.contains("\"ext\":\"yml\""),
        "a row would write a file under a spelling the app only accepts: {script}"
    );
}

#[test]
fn the_front_end_shares_its_repeated_plumbing() {
    // Three things every part of the front-end needs, written once. A second copy is how two menus end up clamping to different margins, or one drag losing the pointer where another keeps it.
    let script = app_shell_script();

    // Escape closes what is open: every caller one listener, no key checks of their own.
    assert_contains(script, "function leafOnEscape(close, target) {");
    assert_eq!(script.matches("leafOnEscape(").count(), 7);

    // Holding the pointer through a drag, wrapped because a browser may refuse.
    assert_contains(script, "function leafHoldPointer(el, pointerId) {");
    assert_eq!(script.matches("leafHoldPointer(").count(), 11);
    assert_eq!(
        script.matches(".setPointerCapture(").count(),
        1,
        "capture is the helper's job; a fragment calling it directly loses the guard"
    );

    // Placing a floating thing inside the window.
    assert_contains(script, "function leafPlaceFloating(el, x, y) {");
    assert_eq!(script.matches("leafPlaceFloating(").count(), 3);
    assert!(
        !script.contains("window.innerWidth - contextMenu.offsetWidth"),
        "a menu is clamping itself again"
    );
}

#[test]
fn the_app_carries_no_gallery_of_its_own() {
    // Looking at every color and component is a job for the page at leaftext.com, built by `just bundle-gallery` from the same `design/` files. It is a tool for building the app, so it has no business in a reader's settings menu — and the app would have had to write a file and hand it to a browser to show it.
    let page = app_shell_page();

    for gone in ["settingsGallery", "openGallery", "Design gallery"] {
        assert!(
            !page.contains(gone),
            "the gallery is back in the app: {gone}"
        );
    }
    // What the app does owe the gallery is its stylesheet, which only Rust can compile — that is what `--dump-css` is for.
    assert_contains(reading_mode_css(), "--lt-background:");
}
