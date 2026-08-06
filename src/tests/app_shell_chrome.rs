//! The app shell's chrome: app bar, icons, CSP, the update bell, and theme bootstrap.

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
fn every_bottom_sheet_is_the_same_bottom_sheet() {
    // The glossary, the theme picker and the flowchart editor's shape picker all slide up from the bottom, and all differ only in what they are anchored to and filled with. A fourth that forgets the class gets no slide and no grip.
    let html = app_shell_page();
    let css = reading_mode_css();

    for sheet in ["glossarySheet", "themeSheet", "flowPicker"] {
        let at = html
            .find(&format!("id=\"{sheet}\""))
            .unwrap_or_else(|| panic!("{sheet} is in the shell"));
        // The whole opening tag: the class may be written either side of the id.
        let opens = html[..at].rfind('<').unwrap_or(0);
        let shuts = html[at..]
            .find('>')
            .map(|end| at + end)
            .unwrap_or(html.len());
        let tag = &html[opens..shuts];
        assert!(
            tag.contains("leaf-sheet"),
            "{sheet} is a bottom sheet but does not wear the class: {tag}"
        );
    }
    // One grab bar and one X, each defined once.
    assert_eq!(html.matches("class=\"leaf-sheet-grip\"").count(), 3);
    assert_eq!(html.matches("class=\"leaf-sheet-close\"").count(), 3);
    for bespoke in [
        ".glossary-sheet-grip",
        ".theme-sheet-grip",
        ".glossary-sheet-close",
        ".theme-sheet-close",
    ] {
        assert!(
            !css.contains(bespoke),
            "a sheet has grown its own `{bespoke}` again"
        );
    }
    assert_contains(&css, ".leaf-sheet-close {");
    assert_contains(&css, ".leaf-sheet-grip {");
    assert_contains(&css, ".leaf-sheet.open {");
    // And one scrim behind all three, rather than three identical ones. The flowchart picker opens over the flow sheet, so only its layer differs.
    assert_eq!(html.matches("class=\"lt-backdrop\"").count(), 3);
    assert_contains(&css, ".lt-backdrop {");
    assert_contains(
        rule_body(&css, "#flowBackdrop {"),
        "z-index: var(--lt-z-42);",
    );
    for gone in [
        ".glossary-backdrop",
        ".theme-sheet-backdrop",
        ".flow-sheet-backdrop",
    ] {
        assert!(
            !css.contains(gone),
            "a sheet has grown its own scrim again: {gone}"
        );
    }
    // One spinner shape and one turn, however many places spin.
    assert_contains(&css, ".lt-spinner {");
    assert_contains(&css, "@keyframes lt-spin {");
    for gone in ["leaf-reader-spin", "theme-item-spin", "library-sync-spin"] {
        let keyframe = format!("@keyframes {gone}");
        assert!(
            !css.contains(&keyframe),
            "a second spin keyframe is back: {gone}"
        );
    }
    // And the app's scrollbar is one definition too, worn by everything that draws one — a class where the markup is ours, a selector where it is rendered from Markdown.
    assert_contains(&css, ".leaf-scroll::-webkit-scrollbar-thumb,");
    for wearer in [
        ".library-scroll::-webkit-scrollbar-thumb,",
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb,",
        ".table-lane > table::-webkit-scrollbar-thumb {",
    ] {
        assert_contains(&css, wearer);
    }
    // A second definition is how the pane ended up with a bar 10px wide beside a reader's at 14.
    assert_eq!(css.matches("::-webkit-scrollbar-thumb").count(), 12);
    assert_contains(&html, "flow-picker-body leaf-scroll");
}

#[test]
fn the_front_end_is_served_beside_the_shell_not_inside_it() {
    // The page goes to WebView2 as one string with a ceiling on it, and the script was 88% of it. So it is linked, and the link has to be there: a tag pointing at nothing is a window that opens and does nothing, with nothing to say why.
    let page = app_shell_html();
    let script = app_shell_script();

    assert_contains(&page, "<script src=\"");
    assert_contains(&page, "app.js\"></script>");
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
    // The flowchart pair leads the script, where its own tag used to sit.
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
            "event.preventDefault();",
            "const isBackShortcut = event.altKey && !event.ctrlKey && !event.metaKey && key === 'ArrowLeft';",
            "const isMacBackShortcut = event.metaKey && !event.altKey && !event.ctrlKey && key === 'ArrowLeft';",
            "event.key.toLowerCase() === 'w' && currentState.active != null",
            "send({ command: 'closeTab', index: currentState.active });",
            "command: 'switchTab',",
            "code_scroll: codeViewActive ? viewScrollFraction() : null,",
            "send({ command: 'closeTab', index: Number(close.dataset.tabClose) });",
            "send({ command: 'openLink', href: fragmentHref, scroll_anchor: currentScrollAnchor() });",
            "send({ command: 'openLink', href: documentLinkHref(link), scroll_anchor: currentScrollAnchor(), newPage });",
            "function bindDocumentLinks() {",
            "function documentLinkFor(target) {",
            "const link = target && target.closest ? target.closest('a[href]') : null;",
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

/// The header logomark and the library's per-file badge are the same glyph, and neither may carry a color of its own: both inherit the theme through `currentColor`, which is what keeps the library leaves in step with the header when the theme changes.
#[test]
fn app_shell_inlines_one_leaf_mark_that_tracks_the_theme() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The glyph is drawn once, as a mask class, and named twice: the header logomark and the library row template. The drawing itself is in the stylesheet, so neither site can carry a color of its own.
    assert_eq!(
        html.matches("lt-icon-leaf").count(),
        2,
        "the leaf mark should be named exactly twice: header logomark + library row template"
    );
    assert_eq!(
        css.matches(r#"<path d=\'M59.7,60.1c-7.9-20.9"#).count(),
        0,
        "the mask URI escapes its quotes, so the drawing is never a raw attribute"
    );
    assert_contains(css, ".lt-icon-leaf {");
    // A mask is alpha only: the visible color is the control's own, painted on by the base class, which is what keeps the library leaves in step with the header.
    let base = rule_body(css, ".lt-icon {");
    assert_contains(base, "background-color: currentColor;");

    // Both sites point that inherited color at the theme's primary token.
    for selector in [".brand-button > .lt-icon", ".library-file > .lt-icon"] {
        let rule_start = css
            .find(selector)
            .unwrap_or_else(|| panic!("{selector} is styled"));
        let rule_end = css[rule_start..]
            .find('}')
            .map(|offset| rule_start + offset)
            .expect("rule closes");
        assert!(
            css[rule_start..rule_end].contains("color: var(--lt-primary)"),
            "{selector} should take the theme's primary color"
        );
    }
}

#[test]
fn app_shell_normalizes_literal_svg_icon_colors_to_current_color() {
    let icon = r##"<svg><path fill="#fff" stroke="#FFFFFF"/><path fill='white' stroke='none'/><path fill="#fff0eb" stroke="currentColor"/><path fill="rgb(255, 255, 255)" stroke="rebeccapurple"/><path fill-rule="evenodd"/><path style="fill:#fff; stroke: hsl(0 0% 100%); fill-opacity: var(--lt-opacity-50)"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="currentColor" stroke="currentColor"/><path fill='currentColor' stroke='none'/><path fill="currentColor" stroke="currentColor"/><path fill="currentColor" stroke="currentColor"/><path fill-rule="evenodd"/><path style="fill:currentColor; stroke: currentColor; fill-opacity: var(--lt-opacity-50)"/></svg>"##
    );
}

#[test]
fn app_shell_preserves_tokenized_svg_icon_colors() {
    let icon = r##"<svg><path fill="var(--lt-icon-base)" stroke='var(--lt-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##;

    assert_eq!(
        normalize_svg_icon_colors(icon),
        r##"<svg><path fill="var(--lt-icon-base)" stroke='var(--lt-icon-accent)'/><path fill="transparent" stroke="inherit"/></svg>"##
    );
}

#[test]
fn app_shell_back_icon_uses_current_color_and_keeps_no_square_fallback() {
    let html = app_shell_page();

    // The back arrow is a mask class now, so the page names it and the stylesheet holds the drawing. `currentColor` still governs, one level out: the base class paints the mask in the control's own color.
    assert_contains(&html, r#"class="lt-icon lt-icon-back""#);
    let css = reading_mode_css();
    assert_contains(
        css,
        "%3Cpath d='M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18' fill='none' stroke='%23000'",
    );
    assert_contains(
        rule_body(css, ".lt-icon {"),
        "background-color: currentColor;",
    );
    // Nothing in the page is drawn any more — every icon is a class — so the scan below holds for whatever arrives next rather than for what is there.
    assert!(
        !app_shell_html().contains("<svg"),
        "an icon is inlined into the page again; it belongs in design/icons.md"
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

/// `A@{ icon: "leaf:back" }` in a diagram draws the app's own back arrow, out of a set generated from the same rows as the stylesheet — so an icon is named in one place and mermaid never falls back to its own glyph, an 80x80 square in a hardcoded #087ebf.
#[test]
fn every_icon_row_reaches_the_diagram_icon_set_and_nothing_else_does() {
    let rows: Vec<String> = include_str!("../../design/icons.md")
        .lines()
        .filter(|line| line.starts_with('|'))
        .filter_map(|line| {
            let cells: Vec<&str> = line.split('|').map(str::trim).collect();
            let name = cells.get(1).copied().unwrap_or_default();
            let file = cells.get(2).copied().unwrap_or_default();
            (file.ends_with(".svg") && !name.is_empty()).then(|| name.to_string())
        })
        .collect();
    assert!(rows.len() > 30, "only found {} icon rows", rows.len());

    let set = include_str!("../assets/mermaid-icons.js");
    for name in &rows {
        assert_contains(set, &format!("'{name}': {{ body:"));
    }
    let entries = set.matches("': { body:").count();
    assert_eq!(
        entries,
        rows.len(),
        "the generated set has {entries} icons and design/icons.md has {} rows",
        rows.len()
    );
    // The mark a box with an icon or a picture we cannot draw falls back to, so it has to be in the set the fallback names.
    assert_contains(set, "'missing-image': { body:");
    // Every drawing keeps `currentColor`, so an icon in a diagram takes the ink of the page rather than a color of its own.
    assert!(
        !set.contains("#087ebf") && !set.contains(r#"fill=\"black\""#),
        "a drawing in the diagram icon set carries a color of its own"
    );
    // The set is a fragment of the page's one script, so it reaches mermaid without a fetch.
    assert_contains(app_shell_script(), "const LEAF_MERMAID_ICONS = {");
    assert_contains(app_shell_script(), "mermaid.registerIconPacks([");
}

#[test]
fn app_shell_styles_history_controls_with_neutral_icon_treatment() {
    let css = reading_mode_css();

    for expected in [
        ".history-button {",
        "border-color: transparent;",
        "background: var(--lt-surface-elevated);",
        "color: var(--lt-foreground);",
        ".history-button:hover:not(:disabled)",
        ".history-button:disabled,\n.history-button:disabled:hover",
        "color: var(--lt-muted-foreground);",
        "opacity: var(--lt-opacity-46);",
    ] {
        assert_contains(css, expected);
    }
}

#[test]
fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
    let css = reading_mode_css();

    // Open and New are the same button twice, so they share both rules rather than repeating them.
    let rest = rule_body(
        css,
        ".open-button,
.new-button {",
    );
    assert_contains(rest, "border-color: transparent;");
    assert_contains(rest, "background: transparent;");
    assert_contains(rest, "color: var(--lt-muted-foreground);");

    let hover = rule_body(
        css,
        ".open-button:hover,
.new-button:hover {",
    );
    assert_contains(
        hover,
        "background: var(--lt-navigation-button-hover-background);",
    );
    assert_contains(hover, "color: var(--lt-primary-foreground);");
}

#[test]
fn app_shell_header_keeps_one_chrome_shade_with_dividers() {
    let css = reading_mode_css();

    for expected in [
        // One flat chrome shade under the dot grid. No translucent fill or backdrop blur: either makes the bar's tone depend on what sits behind it.
        "background-color: var(--lt-surface);",
        // The circles are written here rather than pulled from a variable holding the finished gradient: the ink has to resolve on the element that draws it, or a surface setting its own would silently get this one's.
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "--lt-grain-dot: var(--app-bar-grain);",
        "background-size: 2px 2px;",
        // The grain tiles from the window, so every grained surface shares one lattice and no seam between them reads as a hairline.
        "background-attachment: fixed;",
        // The bar keeps a hairline top divider in the outer border color.
        "border-top: var(--lt-stroke-1) solid var(--lt-border);",
        // The bottom divider is drawn by ::after (not border-bottom) so the active tab can paint over it and read as joined to the page below.
        ".app-bar::after {",
        "background: var(--lt-border);",
    ] {
        assert_contains(css, expected);
    }

    // No blurred fade elements hanging below the bar, and no scroll shadow.
    for absent in [".app-bar::before", ".app-bar.is-scrolled"] {
        assert!(!css.contains(absent), "app header must not draw {absent}");
    }

    // No surface derives its own shade from the token — a tint on one shows up as a tone seam where it meets its neighbor.
    assert!(!css.contains("--library-surface"));
    for tinted in [
        "color-mix(in srgb, var(--lt-surface)",
        "color-mix(in srgb, var(--lt-surface) 98%, black)",
    ] {
        assert!(!css.contains(tinted), "chrome must not tint {tinted}");
    }
}

#[test]
fn the_minimap_is_always_on_and_still_one_switch() {
    let html = app_shell_page();

    // Not a choice any more: nothing turns it off, so the seed is a constant. The switch stays because the rail still comes and goes with the document, and everything that draws it asks here rather than keeping its own copy.
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

    // The rail still comes and goes with the document, so the subscription has to re-render the page — that is the whole of what it does now the checkbox is gone.
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
    assert_contains(&html, "subscribe(listener)");
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
fn the_palette_stands_in_the_bar_where_the_gear_did() {
    let html = app_shell_page();

    // Themes were the one thing anybody opened that menu for, so they are one click. A plain icon button in the same slot, opening the same sheet.
    assert_contains(
        &html,
        r#"<button type="button" id="themeSheetOpen" class="icon-button theme-button" aria-label="Themes" title="Themes" aria-haspopup="dialog">"#,
    );
    assert_icon(&html, "theme");
    assert_contains(
        &html,
        "themeSheetOpen.addEventListener('click', openThemeSheet);",
    );
    // No label beside it, so the theme in use rides the tooltip.
    assert_contains(
        &html,
        "'Themes — ' + themeFamilyName(family) + ' · ' + (THEME_MODE_NAMES[mode] || mode);",
    );
    assert_contains(&html, r#"id="themeSheet""#);
    assert_contains(&html, r#"<span class="theme-sheet-title">Themes</span>"#);
    // No language row: the interface ships in one language.
    assert!(!html.contains("localeMode"));
    assert!(!html.contains("leafLocale"));
}

#[test]
fn the_palette_color_marks_are_wide_enough_to_see_in_the_app_bar() {
    // One viewBox unit is 0.67px inside the bar's 16px icon box, so the marks it shipped with — half-unit dots — were thinner than the outline around them. Radius, not the old string: a test that only refused `r=".5"` would pass by finding nothing.
    let svg = include_str!("../assets/theme.svg");
    let mut radii: Vec<f64> = Vec::new();

    for circle in svg.split("<circle").skip(1) {
        let r = circle
            .split("r=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("a circle carries a radius");
        radii.push(r.parse().expect("a radius is a number"));
    }
    for path in svg.split("<path").skip(1) {
        let d = path
            .split("d=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("a path carries a d");
        // A mark is a ring: nothing but a move and arcs. The palette outline draws curves too, and its size is not what this is about.
        if !d
            .chars()
            .all(|c| !c.is_alphabetic() || matches!(c, 'M' | 'm' | 'A' | 'a'))
        {
            continue;
        }
        for arc in d.split(['a', 'A']).skip(1) {
            let r = arc
                .split_whitespace()
                .next()
                .expect("an arc opens with its radius");
            radii.push(r.parse().expect("an arc radius is a number"));
        }
    }

    assert!(
        radii.len() >= 3,
        "found {} color marks in theme.svg, so this test is passing by finding nothing",
        radii.len()
    );
    for r in radii {
        assert!(
            r >= 1.0,
            "a color mark is {r} units of radius, under the 1 that reaches a visible width at 16px"
        );
    }
}

#[test]
fn the_update_bell_keeps_the_menu_keyboard_and_pointer_polish() {
    let html = app_shell_page();

    for expected in [
        r#"<summary id="updateSummary" class="icon-button" aria-label="Update" title="Update">"#,
        r#"<div class="update-panel" role="group" aria-labelledby="updateSummary">"#,
        "updateMenu.querySelector('summary').focus();",
        "if (updateMenu.open && !updateMenu.contains(event.target)) updateMenu.open = false;",
    ] {
        assert_contains(&html, expected);
    }
    assert_icon(&html, "update");

    let css = reading_mode_css();

    // The box, the radius and the focus ring the settings summary had, on the bell's.
    for expected in [
        ".update-menu summary::-webkit-details-marker",
        ".update-panel {",
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
        "const onSystemThemeChange = () => { if (mode === 'system') { apply(); } };",
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
        "<h1>Refine your mind.</h1>",
        "<p class=\"empty-subtitle\">Your thoughts, secure and free.</p>",
        ">Choose file</button>",
        "Open a file and read it in peace. It stays on your device, in plain text you own.",
        "Files you open show up here, so you can pick up where you left off.",
        r#"aria-label="Themes" title="Themes""#,
        r#"<span class="reader-subselect-label">Graph size</span>"#,
    ] {
        assert_contains(&html, expected);
    }

    let initial_state_position = html
        .find("window.leafSetState(window.__leafInitialState || { recent: [], document: null });")
        .expect("app shell renders the initial empty state");
    let state_declaration = html
        .find("let currentState = { recent: [], tabs: [], active: null, document: null };")
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
fn an_unsaved_tab_does_not_resize_when_you_reach_for_it() {
    // The dot was in the tab's row and hidden on hover, so pointing at a modified tab deleted 13px of content: the tab shrank and its label jumped, and the dot had been shoving the close button away from the name the whole time. Sharing the button's corner means the swap costs no layout.
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
    // A rule keyed on the active tab's hover resizes the tab, and covers only that one tab.
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
        tab.contains("padding: 0 var(--lt-space-12) 0 var(--lt-space-4);"),
        "a short name would otherwise end under the close button: {tab}"
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
fn the_mac_shell_takes_the_drag_bar_but_not_our_window_buttons() {
    // Two kinds of frameless, one flag each. Mac keeps Apple's three dots, so unhiding ours as well would put six buttons on one bar; the drag region and the dropped top border belong to both.
    let html = app_shell_page();
    assert_contains(
        &html,
        "if (window.__leafFrameless || window.__leafMacFrame) {",
    );
    assert_contains(
        &html,
        "if (window.__leafMacFrame) document.body.classList.add('mac-frame');",
    );

    // Everything the Windows-only branch holds, from its `if` to the closing brace at the same indent.
    let windows_only = html
        .split_once("  if (window.__leafFrameless) {\n")
        .expect("our own window buttons are wired behind the Windows flag")
        .1;
    let windows_only = &windows_only[..windows_only
        .find("\n  }")
        .expect("the Windows-only branch closes")];
    assert!(
        windows_only.contains("windowControls.hidden = false")
            && windows_only.contains("winButton('winClose', 'windowClose')"),
        "our buttons are revealed and wired only where we draw them: {windows_only}"
    );
    assert!(
        !windows_only.contains("dragWindowFrom"),
        "the drag region belongs to both kinds of frameless window"
    );

    // macOS takes the dots away in full screen, so the bar takes its room back. The flag, not the class, says what to restore — the class is what is being toggled.
    assert_contains(&html, "window.leafSetFullscreen = (fullscreen) => {");
    assert_contains(
        &html,
        "document.body.classList.toggle('mac-frame', !!window.__leafMacFrame && !fullscreen);",
    );
}

#[test]
fn the_app_bar_maximizes_from_the_second_press_not_from_a_dblclick() {
    // A drag hands the window to a Windows move loop that swallows every later mouse event, so an app-bar dblclick listener is dead code.
    let html = app_shell_page();
    assert!(
        !html.contains("appBar.addEventListener('dblclick'"),
        "an app-bar dblclick can never fire once a drag starts; decide on mousedown"
    );
    let handler = html
        .split_once("bar.addEventListener('mousedown'")
        .expect("a drag bar decides window drags on mousedown")
        .1;
    let handler = &handler[..handler.find("\n    });").expect("the handler closes")];
    // The app bar is one of them. The flowchart sheet covers the whole window, so its header is the other — without it the window cannot be moved until the diagram is put away.
    assert_contains(&html, "dragWindowFrom(appBar);");
    assert_contains(
        &html,
        "dragWindowFrom(document.getElementById('flowSheetHead'));",
    );
    assert!(
        handler.contains("windowToggleMaximize") && handler.contains("event.detail === 2"),
        "the second press is what maximizes: {handler}"
    );
    // A dragged window carries the page under the cursor, so a press just after a quick drag also counts as 2. Only the window's corner tells them apart.
    assert!(
        handler.contains("window.screenX"),
        "detail alone maximizes after a fast drag; check the window stayed put: {handler}"
    );
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

#[test]
fn the_front_end_shares_its_repeated_plumbing() {
    // Three things every part of the front-end needed and each used to write for itself. A second copy is how two menus end up clamping to different margins, or one drag losing the pointer where another keeps it.
    let script = app_shell_script();

    // Escape closes what is open: four callers, one listener each, no key checks of their own.
    assert_contains(script, "function leafOnEscape(close, target) {");
    assert_eq!(script.matches("leafOnEscape(").count(), 6);

    // Holding the pointer through a drag, wrapped because a browser may refuse.
    assert_contains(script, "function leafHoldPointer(el, pointerId) {");
    assert_eq!(script.matches("leafHoldPointer(").count(), 9);
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

#[test]
fn a_tab_carries_the_heart_and_the_menu_marks_everything_else() {
    let page = app_shell_page();

    // The tab of whatever you are reading, and the right-click item for everything that is not open — the two places the drawing approved, and no mark in any list.
    for expected in [
        r#"<button type="button" class="tab-favorite${kept ? ' is-on' : ''}""#,
        r#"<span class="lt-icon lt-icon-favorite-${kept ? 'on' : 'off'}"></span>"#,
        "{ action: 'favorite', label: 'Favorite' },",
        "return { action: entry.action, label: 'Unfavorite' };",
    ] {
        assert_contains(&page, expected);
    }
    assert!(
        !page.contains("library-file-favorite") && !page.contains("recent-favorite"),
        "a mark in a list row was turned down: each row is one button"
    );
}

#[test]
fn marking_from_the_tab_and_from_the_menu_take_the_same_path() {
    let script = app_shell_script();

    // One function, so the heart and the menu item can never disagree about what marking means — and it flips the page's own copy before it tells the host, which is what makes the change instant.
    assert_eq!(script.matches("function toggleFavorite(").count(), 1);
    // The declaration, the heart's click, and the menu item: two gestures, one path.
    assert_eq!(script.matches("toggleFavorite(").count(), 3);
    assert_contains(
        script,
        "send({ command: 'toggleFavorite', path, kind: kind || 'document' });",
    );
    assert_contains(
        script,
        "  renderTabs(currentState);\n  send({ command: 'toggleFavorite'",
    );
}

#[test]
fn a_marked_tab_is_the_width_of_an_unmarked_one() {
    let css = reading_mode_css();

    // Out of the label's flow, like the close button in the corner opposite, so a mark costs the tab nothing.
    let mark = css
        .split(".tab-favorite {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the tab's heart");
    assert!(mark.contains("position: absolute;"));
    assert!(mark.contains("top: 2px;") && mark.contains("left: 2px;"));
    assert!(
        !mark.contains("margin"),
        "an out-of-flow heart has no margin to push the row with: {mark}"
    );
    // Never drawn at rest, and every value of the fade a token: in decelerating, then a hold, then a shorter exit that accelerates.
    assert!(mark.contains("opacity: 0;"));
    assert_contains(
        &mark.to_string(),
        "transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300);",
    );
    assert_contains(
        css,
        ".tab:hover .tab-favorite,\n.tab:focus-within .tab-favorite {\n  opacity: 1;\n  transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate);\n}",
    );
    // The tab's own padding is untouched: the right inset still reserves the close button's corner, and the left is what it always was.
    let tab = css
        .split("\n.tab {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines a tab");
    assert_contains(
        &tab.to_string(),
        "padding: 0 var(--lt-space-12) 0 var(--lt-space-4);",
    );
}
