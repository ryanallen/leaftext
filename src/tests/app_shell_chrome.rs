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
    // The glossary, the theme picker, the flowchart editor's shape picker and a folded start-screen list all slide up from the bottom, and all differ only in what they are anchored to and filled with. A fifth that forgets the class gets no slide and no grip.
    let html = app_shell_page();
    let css = reading_mode_css();

    for sheet in ["glossarySheet", "themeSheet", "flowPicker", "homeSheet"] {
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
    assert_eq!(html.matches("class=\"leaf-sheet-grip\"").count(), 4);
    assert_eq!(html.matches("class=\"leaf-sheet-close\"").count(), 4);
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
    // And one scrim behind all of them, rather than five identical ones — the four sheets plus the confirmation, which is not a sheet but dims the page the same way. The flowchart picker opens over the flow sheet, so only its layer differs.
    assert_eq!(html.matches("class=\"lt-backdrop\"").count(), 5);
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
        ".table-lane > table::-webkit-scrollbar-thumb,",
        ".document-body :is(pre, pre > code, .math-display, .frontmatter, table)::-webkit-scrollbar-thumb {",
    ] {
        assert_contains(&css, wearer);
    }
    // A second definition is how the pane ended up with a bar 10px wide beside a reader's at 14. Five wearers named in each of three blocks — the thumb, and the floor under its length per axis. Nothing else may paint a thumb: a private copy is how the app ends up with two answers to when a bar is there. There is no reduced-motion block of its own any more: the fade moved onto the box, where the stylesheet's universal one reaches it.
    assert_eq!(css.matches("::-webkit-scrollbar-thumb").count(), 15);
    // Where the markup is ours the box carries the class, which is the whole of joining: the shape picker, the theme picker's grid of cards, a glossary entry, the flowchart canvas and the code panel beside it. One of these missing it is a box drawing the platform's gray stripe in a window where nothing else does.
    for (id, what) in [
        ("flowPickerBody", "the shape picker"),
        ("themeSheetGrid", "the theme picker's grid of cards"),
        ("glossarySheetBody", "a glossary entry"),
        ("flowCanvas", "the flowchart canvas"),
        ("flowCode", "the code panel beside the canvas"),
    ] {
        let at = html
            .find(&format!("id=\"{id}\""))
            .unwrap_or_else(|| panic!("{what} is in the shell"));
        let opens = html[..at].rfind('<').unwrap_or(0);
        let shuts = html[at..]
            .find('>')
            .map(|end| at + end)
            .unwrap_or(html.len());
        let tag = &html[opens..shuts];
        assert!(
            tag.contains("leaf-scroll"),
            "{what} scrolls and wears the platform's bar instead of the app's: {tag}"
        );
    }
}

/// One CSS selector list split at its own commas. A comma inside `:is(...)` groups selectors within a single wearer, so depth is tracked; whitespace is squeezed because the stylesheet separates its entries with newlines and the script with spaces.
fn wearer_list(list: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in list.chars() {
        match ch {
            '(' => {
                depth += 1;
                current.push(ch);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                current.push(ch);
            }
            ',' if depth == 0 => {
                out.push(current.split_whitespace().collect::<Vec<_>>().join(" "));
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    let last = current.split_whitespace().collect::<Vec<_>>().join(" ");
    if !last.is_empty() {
        out.push(last);
    }
    out
}

#[test]
fn the_list_of_boxes_wearing_the_bar_is_the_same_list_in_both_files() {
    // The bar is painted from the stylesheet and raised from the script, and each holds its own copy of which boxes wear it. A box in one and not the other gets half of it: painted but impossible to aim at, or aimable and never drawn. Nothing held the two together, and the copy in the script is the one a stylesheet edit forgets.
    let css = reading_mode_css();
    let script = app_shell_script();

    let resting = rule_body(&css, "\n.leaf-scroll,");
    let painted = &resting[..resting.find('{').expect("the resting rule opens")];

    const NAMED: &str = "LEAF_SCROLL_WEARERS = '";
    let at = script
        .find(NAMED)
        .expect("the script names the boxes whose bar the pointer can raise");
    let rest = &script[at + NAMED.len()..];
    let aimable = &rest[..rest.find('\'').expect("the list is one quoted string")];

    let mut painted = wearer_list(painted);
    let mut aimable = wearer_list(aimable);
    painted.sort();
    aimable.sort();
    assert_eq!(
        painted, aimable,
        "the stylesheet and the front end disagree about which boxes wear the app's bar"
    );
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
            "send({ command: 'openLink', href: rawHref, scroll_anchor: currentScrollAnchor(), newPage });",
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
        "Files you open show up here.",
        r#"aria-label="Themes" title="Themes""#,
        r#"<span class="reader-subselect-label">Graph size</span>"#,
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
    // Hiding the cross at rest is every tab's rule now, held by `the_close_cross_waits_until_you_reach_the_tab`. A rule keyed on the active tab's hover resizes the tab, and covers only that one tab.
    assert!(
        !css.contains(".tab-active:hover .tab-dirty-dot"),
        "the hover rule that resized the tab is gone"
    );

    // Swapping one for the other costs no layout either way, both being out of flow — and the tab's inset is even, since neither corner is bought from the row.
    let tab = css
        .split("\n.tab {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines a tab");
    assert!(
        tab.contains("padding: 0 var(--lt-space-4);"),
        "the tab reserves nothing for either corner button: {tab}"
    );
}

#[test]
fn the_close_cross_waits_until_you_reach_the_tab() {
    // The cross was reserving a corner on every tab whether anyone was offering it or not. Hidden at rest it costs nothing, so the name gets the room back.
    let css = reading_mode_css();

    // Markup still builds one on every tab: hiding it is the stylesheet's job, never the renderer's, or the keyboard would have nothing to reach.
    assert_contains(
        &app_shell_page(),
        r#"<span class="lt-icon lt-icon-tab-close"></span>"#,
    );

    let close = css
        .split(".tab-close {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the close button");
    // A wash behind it, since it now lands on the last letters of the name rather than in cleared space.
    assert!(
        close.contains("background: var(--lt-surface);"),
        "the cross needs a wash to read over the name: {close}"
    );
    // In decelerating, out accelerating after a hold — the heart's timing in the opposite corner, every value a token.
    assert_contains(
        &close.to_string(),
        "transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate);",
    );
    assert_contains(
        css,
        ".tab:not(:hover):not(:focus-within) .tab-close {\n  opacity: 0;\n  transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300);\n}",
    );
    // Keyed on the tab, not on the modified tab: the narrow rule this generalizes must not survive beside it.
    assert!(
        !css.contains(".tab-modified:not(:hover):not(:focus-within) .tab-close"),
        "the modified-only hide rule is gone; one rule covers every tab"
    );
}

#[test]
fn a_tab_keeps_its_type_visible_when_its_name_clips() {
    let css = reading_mode_css();
    let rule = |head: &str| {
        css.split(head)
            .nth(1)
            .and_then(|rest| rest.split('}').next())
            .unwrap_or_else(|| panic!("stylesheet defines {head}"))
            .to_string()
    };
    let tab = rule("\n.tab {");
    let label = rule("\n.tab-label {");
    assert!(tab.contains("max-width: 132px;"), "{tab}");
    assert!(tab.contains("padding: 0 var(--lt-space-4);"), "{tab}");
    assert!(
        label.contains(
            "padding: var(--lt-space-6) var(--lt-space-24) var(--lt-space-6) var(--lt-space-14);"
        ),
        "{label}"
    );
    assert!(
        label.contains("display: flex;") && label.contains("gap: var(--lt-space-4);"),
        "{label}"
    );
    let name = rule("\n.file-name-stem {");
    assert!(
        name.contains("flex: 1;") && name.contains("overflow: hidden;"),
        "only the name may clip before the badge: {name}"
    );
    let stem = rule("\n.tab-label .file-name-stem,\n.library-file .file-name-stem {");
    assert!(
        stem.contains("mask-image: linear-gradient(to right, var(--lt-mask-opaque) calc(100% - 18px), transparent);"),
        "the name must fade before the badge: {stem}"
    );
    let active = rule("\n.tab-active .file-name-stem {");
    assert!(active.contains("mask-image: none;"), "{active}");
}

#[test]
fn both_corner_buttons_sit_above_the_name_they_cover() {
    // The name fades under the corner controls.
    let css = reading_mode_css();
    let script = app_shell_script();

    for corner in [".tab-favorite {", ".tab-close {"] {
        let rule = css
            .split(corner)
            .nth(1)
            .and_then(|rest| rest.split('}').next())
            .unwrap_or_else(|| panic!("stylesheet defines {corner}"));
        assert!(
            rule.contains("z-index: 1;"),
            "{corner} must outrank the masked label or its click goes to the tab: {rule}"
        );
    }
    // The filename stem carries the fade, so a corner control stays above it.
    let stem = css
        .split("\n.tab-label .file-name-stem,\n.library-file .file-name-stem {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the tab filename stem");
    assert!(
        stem.contains("mask-image: linear-gradient(to right,"),
        "{stem}"
    );

    // And the strip's one listener answers both corners before it answers the label, so a click that lands on either never falls through to switching tabs.
    let close_at = script
        .find("event.target.closest('[data-tab-close]')")
        .expect("the strip answers the close button");
    let mark_at = script
        .find("event.target.closest('[data-tab-favorite]')")
        .expect("the strip answers the heart");
    let label_at = script
        .find("event.target.closest('[data-tab-index]')")
        .expect("the strip answers the label");
    assert!(
        close_at < label_at && mark_at < label_at,
        "a corner button must be answered before the tab it sits on"
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
fn both_shells_draw_their_own_three_window_buttons() {
    // Two kinds of frameless, one flag each, and neither platform leaves us a native title bar to keep. Apple's dots are off, so the same three buttons and the same three commands serve both; only the look and the place differ, and the Mac's move to the bar's left end where Apple's were.
    let html = app_shell_page();
    assert_contains(
        &html,
        "if (window.__leafFrameless || window.__leafMacFrame) {",
    );
    assert_contains(
        &html,
        "if (window.__leafMacFrame) document.body.classList.add('mac-frame');",
    );

    // Revealed and wired for both, not behind the Windows flag: a Mac with them hidden has no way to close the window at all now that Apple's are gone. Read over the stretch that draws them rather than over the whole script, which has its own Windows-only branches for things a Mac frame answers itself.
    let drawing_them = html
        .split("if (window.__leafFrameless || window.__leafMacFrame) {")
        .nth(1)
        .and_then(|rest| rest.split("winButton('winClose', 'windowClose');").next())
        .expect("the shell draws the three window buttons");
    assert!(
        !drawing_them.contains("if (window.__leafFrameless) {"),
        "our own three are no longer Windows-only"
    );
    assert_contains(&html, "windowControls.hidden = false;");
    assert_contains(&html, "winButton('winClose', 'windowClose');");
    // Moved into the bar's left zone rather than written into the markup twice, and before the fold reads where things came from, so unfolding puts them back at the left.
    assert_contains(
        &html,
        "const lead = window.__leafMacFrame && document.querySelector('.app-bar-lead');",
    );

    // A full-screen Mac shows no window buttons, so ours go with them — but the Mac class stays on, because it says which shell this is and the dots keep their look and place underneath.
    assert_contains(&html, "window.leafSetFullscreen = (fullscreen) => {");
    assert_contains(
        &html,
        "document.body.classList.toggle('is-fullscreen', !!fullscreen);",
    );
    assert_contains(
        reading_mode_css(),
        "body.mac-frame.is-fullscreen .window-controls {\n  display: none;\n}",
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

#[test]
fn a_tab_carries_the_heart_and_the_menu_marks_everything_else() {
    let page = app_shell_page();

    // The tab of whatever you are reading, the right-click item for everything that is not open, and the Favorites column on the start screen, where the heart is the mark and the way off the list at once.
    for expected in [
        r#"<button type="button" class="tab-favorite${favorite ? ' is-on' : ''}""#,
        r#"<span class="lt-icon lt-icon-favorite-${favorite ? 'on' : 'off'}"></span>"#,
        "{ action: 'favorite', label: 'Favorite' },",
        "return { action: entry.action, label: 'Unfavorite' };",
        r#"<button type="button" class="home-row-heart" data-home-unfavorite="${attr}""#,
    ] {
        assert_contains(&page, expected);
    }
    // Not in the pane, where a row really is one button and a second control inside it is not markup.
    assert!(
        !page.contains("library-file-favorite"),
        "a mark in a pane row was turned down: each of those is one button"
    );
}

#[test]
fn marking_from_the_tab_and_from_the_menu_take_the_same_path() {
    let script = app_shell_script();

    // One function, so the heart and the menu item can never disagree about what marking means — and it flips the page's own copy before it tells the host, which is what makes the change instant.
    assert_eq!(script.matches("function toggleFavorite(").count(), 1);
    // The declaration, the tab heart's click, the menu item, and the favorite row's heart — which calls it twice, once to unfavorite and once to take that back. Three gestures, one path.
    assert_eq!(script.matches("toggleFavorite(").count(), 5);
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
    // A mark adds nothing to the tab's own padding, which is even: it is out of flow, and so is the cross in the opposite corner.
    let tab = css
        .split("\n.tab {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines a tab");
    assert_contains(&tab.to_string(), "padding: 0 var(--lt-space-4);");
}

#[test]
fn every_element_in_the_page_sits_inside_the_one_box_that_means_the_app() {
    // The app surface is what a `position: fixed` overlay is measured from and clipped to, so anything added beside it belongs to the window instead — and once the app's edge is inset, a sheet or a scrim placed against the window runs 20px past the app's corner and paints over the shadow. Nothing in `<body>` may stand next to it.
    const VOID: [&str; 8] = ["br", "hr", "img", "input", "link", "meta", "source", "wbr"];
    let html = app_shell_html();
    let body = html
        .split_once("<body>")
        .expect("the page has a body")
        .1
        .split_once("</body>")
        .expect("the body closes")
        .0;

    let mut depth = 0usize;
    let mut surfaces = 0usize;
    let mut rest = body;
    while let Some(at) = rest.find('<') {
        rest = &rest[at..];
        if let Some(after) = rest.strip_prefix("<!--") {
            let end = after.find("-->").expect("a comment closes");
            rest = &after[end + 3..];
            continue;
        }
        let end = rest.find('>').expect("a tag closes");
        let tag = &rest[..=end];
        rest = &rest[end + 1..];
        if tag.starts_with("</") {
            depth = depth.saturating_sub(1);
            continue;
        }
        if tag.contains("id=\"appSurface\"") {
            assert_eq!(depth, 0, "the app surface is the body's own child: {tag}");
            surfaces += 1;
            depth += 1;
            continue;
        }
        assert!(
            depth >= 1,
            "this stands beside the app surface rather than inside it, so it is placed against the window rather than against the app: {tag}"
        );
        let name = tag
            .trim_start_matches('<')
            .split([' ', '>', '/'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !tag.ends_with("/>") && !VOID.contains(&name.as_str()) {
            depth += 1;
        }
    }
    assert_eq!(surfaces, 1, "one box means the app, and only one");
    assert_eq!(depth, 0, "every tag in the page closes");
}

#[test]
fn nothing_in_the_front_end_adds_a_floating_thing_to_the_window() {
    // The menus, the growl, the rename box, the link tip, the first-run bubble, the drag ghost and the breadcrumb menu are all built in script rather than declared in the page, so the markup test above cannot see them. Added to `<body>` they belong to the window: not clipped by the app, and placed against the window's own corner, which is 20px outside the app's once the app's edge is a shadow. There is one box they all go in.
    let script = app_shell_script();
    assert!(
        !script.contains("document.body.appendChild"),
        "something is added beside the app surface rather than inside it, so it is the window's rather than the app's"
    );
    assert_contains(
        script,
        "const appSurface = document.getElementById('appSurface')",
    );
    // And no divider color rides to the frame with it: the frame draws none.
    assert!(
        !script.contains("borderR:"),
        "the page still works out a divider color for a frame that draws nothing with it"
    );
    assert_contains(script, "command: 'setWindowChrome',");
}
