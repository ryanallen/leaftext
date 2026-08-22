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
    // A second definition is how the pane ended up with a bar 10px wide beside a reader's at 14. Five wearers named in each of three blocks — the thumb, and the floor under its length per axis. Nothing else may paint a thumb: a private copy is how the app ends up with two answers to when a bar is there. The fade sits on the box, where the stylesheet's universal reduced-motion block reaches it, so the thumb needs none of its own.
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
    // Every icon in the page is a class rather than a drawing, so the scan below holds for whatever arrives next rather than for what is there.
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

/// The diagram's save window reads back the ending the reader typed and looks for the row that permits it, so the page's Markdown row has to permit every spelling the app opens — otherwise a name ending `.markdown` is refused in the same sentence that offers Markdown.
///
/// The page keeps its list written out rather than injected: nothing hands the browser host a format table, so a derived row would leave the published site's Markdown row empty and silent. This is what holds the written list to `src/format.rs` instead.
#[test]
fn the_diagram_export_menu_permits_every_spelling_of_markdown() {
    let script = app_shell_script();
    let at = script
        .find("{ id: 'md', endings: [")
        .expect("the page carries a Markdown row in its diagram export list");
    let opens = at + script[at..].find('[').expect("the row opens its endings");
    let shuts = opens + script[opens..].find(']').expect("the row shuts them again");
    let endings = &script[opens + 1..shuts];

    for spelling in DocumentFormat::Markdown.extensions() {
        assert!(
            endings.contains(&format!("'{spelling}'")),
            "the diagram export window refuses a name ending .{spelling}, which the app opens without complaint: {endings}"
        );
    }
    // First, because a bare name is given the row's first ending and a reader who typed none expects `.md`.
    assert!(
        endings.trim_start().starts_with("'md'"),
        "the Markdown row stopped leading with md, so a bare name comes out under another spelling: {endings}"
    );
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
fn app_bar_keeps_one_gap_between_visible_groups() {
    // The bar is one sequence of places to go, so every space it declares between the leaf, the history pair and the two trailing rows is the same 16px. Unequal gaps made the same row read as loosely assembled clusters. Three groups are the exceptions: the window buttons, below, where three read as one control set rather than three more stops along the row, back and forward, which are one paired control on that same tight gap, and the tab strip, which is a list of open documents rather than a run of unrelated controls. The leaf is a fourth of another kind: the gap it declares is the row's, and the gap a reader sees is 4px wider because its mark stops short of its box, so it is the one control that hands an inset back.
    let css = reading_mode_css();

    // The two that hold groups rather than buttons: the leaf beside the library button and the history pair, and the actions beside the window controls.
    for selector in ["\n.app-bar-lead {", "\n.app-trailing-items {"] {
        let body = rule_body(css, selector);
        assert!(
            body.contains("gap: var(--lt-space-16);"),
            "{selector} must run on the bar's one gap: {body}"
        );
    }

    // Back and forward are one control, not two stops along the row, so they close up to the same 4px the window buttons take. The theme switch, the folder, the plus and the page export are the same reading: one set of things to press, and the last run on the bar to join them.
    for selector in ["\n.history-actions {", "\n.app-actions-items {"] {
        let body = rule_body(css, selector);
        assert!(
            body.contains("gap: var(--lt-space-4);"),
            "{selector} is a run of buttons, so it closes up rather than taking the gap between groups: {body}"
        );
    }

    // Inside the strip the tabs close up to 4px so they read as one set, while each end of the strip keeps the row's 16px: that inset is what the flares below are capped by, and the strip carries it while the two zones either side add none.
    let strip = rule_body(css, "\n.tab-bar {");
    assert!(
        strip.contains("gap: var(--lt-space-4);"),
        "the tabs sit tight against each other rather than on the row's gap: {strip}"
    );
    assert!(
        strip.contains("padding: var(--lt-space-4) var(--lt-space-16) 0;"),
        "the strip's side insets stay on the bar's own gap: {strip}"
    );
    // The tighter gap takes 12px off each side of the active tab's flare, so the tab buys it back itself. Without that margin the flare's page-colored fill runs onto the neighbor and the three tabs read as one block; without it in the transition, every tab to the right jumps the moment the selection moves.
    let active = rule_body(css, "\n.tab-active {");
    assert!(
        active.contains("margin: 0 var(--lt-space-12);"),
        "the active tab buys back the room its flare turns in: {active}"
    );
    // At an end of the strip there is no neighbor, and the strip's own 16px inset is already wider than the 14px flare — so the margin there would only push the first tab past the 16px every other space in the row keeps. Both drop, which is also a one-tab strip losing both.
    let first = rule_body(css, "\n.tab-active:first-child {");
    assert!(
        first.contains("margin-left: 0;"),
        "a selected first tab leaves the strip's own inset to feed its flare: {first}"
    );
    let last = rule_body(css, "\n.tab-active:last-child {");
    assert!(
        last.contains("margin-right: 0;"),
        "a selected last tab leaves the strip's own inset to feed its flare: {last}"
    );
    let tab = rule_body(css, "\n.tab {");
    assert!(
        tab.contains("margin var(--lt-duration-120) var(--lt-ease-emphasized)"),
        "the tabs slide as that margin arrives and leaves: {tab}"
    );
    let lead = rule_body(css, "\n.app-bar-lead {");
    assert!(
        lead.contains("padding: 0 0 0 var(--lt-space-12);"),
        "the lead keeps its logo-aligning left inset and adds no right one: {lead}"
    );
    // Handing the inset back is a negative margin rather than less padding, so the controls after the leaf move and its own 32px hit area does not. The gap beside it measured 20.67px against every other space's 16px.
    let brand = rule_body(css, "\n.brand-button {");
    assert!(
        brand.contains("padding: var(--lt-space-4);")
            && brand.contains("margin-right: calc(-1 * var(--lt-space-4));"),
        "the leaf keeps its 32px box and gives its trailing inset back to the row: {brand}"
    );
    // The window buttons close up to 4px instead of taking the row's gap, so the three read as one set, and they add no lead-in of their own.
    let controls = rule_body(css, "\n.window-controls {");
    assert!(
        controls.contains("gap: var(--lt-space-4);") && controls.contains("margin-left: 0;"),
        "the window buttons sit tight against each other: {controls}"
    );

    // The close chip's own distance from the window edge is not part of the rhythm and does not move: 4px on a frameless window, matching the 4px the chip leaves above it.
    let trailing = rule_body(css, "\n.app-trailing {");
    assert!(
        trailing.contains("padding-left: 0;")
            && trailing.contains("padding-right: var(--lt-space-24);"),
        "the trailing group adds no left inset and stays off the window edge: {trailing}"
    );
    let frameless = rule_body(css, "\n.frameless:not(.mac-frame) .app-trailing {");
    assert!(
        frameless.contains("padding-right: var(--lt-space-4);"),
        "the close chip stays 4px off the window corner: {frameless}"
    );
    // A Mac's dot is a quarter of a Windows button, so the same 4px reads as a third of a dot and the three run together: they take twice the gap while the Windows three above keep theirs.
    let mac = rule_body(css, "\n.mac-frame .window-controls {");
    assert!(
        mac.contains("gap: var(--lt-space-8);") && mac.contains("margin-left: 0;"),
        "the Mac's dots take twice the Windows gap: {mac}"
    );
    // Folded into the chevron's menu the same three stack, still 12px on the same gap, so the Mac column follows the row and the shared column stays where Windows needs it.
    let mac_panel = rule_body(css, "\n.mac-frame .app-overflow-panel .window-controls {");
    assert!(
        mac_panel.contains("gap: var(--lt-space-8);"),
        "the Mac's stacked dots take the same widened gap: {mac_panel}"
    );
    let shared_panel = rule_body(css, "\n.app-overflow-panel .window-controls {");
    assert!(
        shared_panel.contains("gap: var(--lt-space-4);"),
        "the shared stacked column keeps the Windows gap: {shared_panel}"
    );

    // The room beside the active tab has to clear its flare on both sides — the strip's 4px gap plus the 12px margin above — and the strip scrolls, so a flare wider than the strip's own 16px side inset is clipped flat rather than drawn: 14px is the largest radius on the scale that still leaves daylight inside that 16px. Pinned by the declaration because the stylesheet opens .tab-active twice and a lookup by selector finds the wrong block.
    assert!(
        css.contains("--tab-flare: var(--lt-radius-2xl);")
            && !css.contains("--tab-flare: var(--lt-radius-md);")
            && !css.contains("--tab-flare: var(--lt-radius-lg);")
            && !css.contains("--tab-flare: var(--lt-radius-xl);"),
        "the join curve must be the largest that clears the bar's gap"
    );
}

#[test]
fn an_emptied_history_strip_stops_taking_a_gap() {
    // The gap above lands between every pair of the lead's children, so the strip the fold leaves behind is 16px spent on nothing at the one moment the bar has no room. `:empty` cannot see that state: the markup writes the strip over eight lines, so three whitespace text nodes stay when the two buttons go. The child combinator and the attribute are the actions group's shape rather than anything the strip needs — its arrows are `disabled` and never `hidden` — and both containers are written in it so a reader meets one question rather than two.
    let css = reading_mode_css();

    let emptied = rule_body(css, "\n.history-actions:not(:has(> *:not([hidden]))) {");
    assert!(
        emptied.contains("display: none;"),
        "a history strip with nothing drawn in it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".history-actions:empty") && !css.contains(".history-actions:not(:has(*))"),
        "the emptied strip must be found by drawn child, not by `:empty`, which the markup's whitespace defeats, nor by a bare `:has()`, which is the narrow shape this rule left behind"
    );
}

#[test]
fn an_emptied_actions_group_stops_taking_a_gap() {
    // The trailing zone's gap lands between the actions group and the window buttons, so the group the fold empties first is 16px spent on nothing at the one moment the bar has no room. The child combinator and the attribute are both load-bearing: the update bell stays in the group hidden, and its own summary and panel are descendants nothing marks hidden, so `:empty`, `:has(*)` and `:has(*:not([hidden]))` all fail to see the emptied group.
    let css = reading_mode_css();

    let emptied = rule_body(css, "\n.app-actions-items:not(:has(> *:not([hidden]))) {");
    assert!(
        emptied.contains("display: none;"),
        "an actions group with nothing drawn in it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".app-actions-items:empty") && !css.contains(".app-actions-items:not(:has(*))"),
        "the emptied group must be found by drawn child, not by `:empty` or a bare `:has()`, which the hidden update bell defeats"
    );
}

/// Every element the reader tool bar ships after its divider, as its opening tag. Depth-tracked, so the icon inside a button is not one of them.
fn reader_toolbar_tags_after_divider(html: &str) -> Vec<&str> {
    let bar = html
        .find("<div id=\"readerToolbar\"")
        .expect("the shell ships a reader tool bar");
    let rest = &html[bar..];
    let divider_at = rest
        .find("<span class=\"reader-tool-divider\"")
        .expect("the reader tool bar ships a divider");

    let mut tags = Vec::new();
    let mut depth = 0usize;
    let mut seen_divider = false;
    let mut at = 0usize;
    while let Some(open) = rest[at..].find('<') {
        let start = at + open;
        // A comment is not an element, and its text can hold a `>`.
        if rest[start..].starts_with("<!--") {
            match rest[start..].find("-->") {
                Some(shut) => at = start + shut + 3,
                None => break,
            }
            continue;
        }
        let Some(shut) = rest[start..].find('>') else {
            break;
        };
        let tag = &rest[start..start + shut + 1];
        at = start + shut + 1;
        if tag.starts_with("</") {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                break;
            }
            continue;
        }
        if depth == 1 && seen_divider {
            tags.push(tag);
        }
        if start == divider_at {
            seen_divider = true;
        }
        depth += 1;
    }
    tags
}

#[test]
fn the_reader_bar_divider_goes_when_nothing_beside_it_is_drawn() {
    // The divider stands between the view buttons and the editing ones, so an editing half with nothing drawn in it leaves the divider dividing nothing. Naming each button that can stand to its right is the markup's own list kept twice: Redo reached the markup a commit before it reached that list, and the bar drew Redo alone with no divider while every check passed. Asking whether any sibling after the divider is drawn needs no list — what it needs instead is that every element shipped after the divider can be hidden, which is what the last assertion holds and nothing else in the tree would notice.
    let css = reading_mode_css();
    let html = app_shell_html();

    let emptied = rule_body(
        css,
        "\n.reader-toolbar:not(:has(.reader-tool-divider ~ *:not([hidden]))) .reader-tool-divider {",
    );
    assert!(
        emptied.contains("display: none;"),
        "a divider with nothing drawn beside it is not drawn: {emptied}"
    );
    assert!(
        !css.contains(".undo-button[hidden]") && !css.contains(".redo-button[hidden]"),
        "the divider must be found by drawn sibling, not by naming each button, which the next button added beside it defeats"
    );

    let after = reader_toolbar_tags_after_divider(&html);
    assert!(
        !after.is_empty(),
        "the reader tool bar ships editing buttons after its divider"
    );
    for tag in after {
        assert!(
            tag.contains(" hidden"),
            "an element after the reader bar's divider must ship hidden, or the divider can never go: {tag}"
        );
    }
}

#[test]
fn app_shell_styles_open_button_like_other_secondary_toolbar_icons() {
    let css = reading_mode_css();

    // Open, New and Export are the same button three times over, and share both rules with the theme switch rather than repeating them.
    let rest = rule_body(
        css,
        ".open-button,
.new-button,
.export-button {",
    );
    assert_contains(rest, "border-color: transparent;");
    assert_contains(rest, "background: transparent;");
    assert_contains(rest, "color: var(--lt-muted-foreground);");

    let hover = rule_body(
        css,
        ".open-button:hover,
.new-button:hover,
.export-button:hover {",
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
        "Turn over a new leaf.",
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
    // In decelerating, out accelerating after a hold — the heart's timing in the opposite corner, every value a token. The colors ride behind the opacity leg; `a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot` holds those.
    assert_contains(
        &close.to_string(),
        "transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate),",
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
fn tabs_keep_full_filenames_and_balanced_padding() {
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
        label.contains("padding: var(--lt-space-6) var(--lt-space-14);"),
        "{label}"
    );
    assert!(
        label.contains("overflow: hidden;"),
        "an inactive tab must clip its label: {label}"
    );
    assert!(
        label.contains("mask-image: linear-gradient(to right, var(--lt-mask-opaque) calc(100% - 33px), transparent calc(100% - 15px));"),
        "an inactive tab must fade to the same right inset as its left inset: {label}"
    );
    let name = rule("\n.file-name-stem {");
    assert!(
        name.contains("flex: 1;") && name.contains("overflow: hidden;"),
        "only a library filename may clip before its badge: {name}"
    );
    let stem = rule("\n.library-file .file-name-stem {");
    assert!(
        stem.contains("mask-image: linear-gradient(to right, var(--lt-mask-opaque) calc(100% - 18px), transparent);"),
        "a library filename must fade before its badge: {stem}"
    );
    let active = rule("\n.tab-active .tab-label {");
    assert!(active.contains("max-width: none;"), "{active}");
    assert!(active.contains("mask-image: none;"), "{active}");
}

#[test]
fn both_corner_buttons_sit_above_the_name_they_cover() {
    // The whole label fades under the corner controls.
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
    let label = css
        .split("\n.tab-label {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines the tab label");
    assert!(
        label.contains("mask-image: linear-gradient(to right,"),
        "{label}"
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
    assert_contains(&html, "function dragWindowFrom(bar) {");
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
    // Never drawn at rest, and every value of the fade a token: in decelerating, then a hold, then a shorter exit that accelerates. The colors ride behind the opacity leg in both rules; `a_hover_fades_from_one_shared_rule_and_by_name_where_it_cannot` holds those.
    assert!(mark.contains("opacity: 0;"));
    assert_contains(
        &mark.to_string(),
        "transition: opacity var(--lt-duration-100) var(--lt-ease-accelerate) var(--lt-duration-300),",
    );
    assert_contains(
        css,
        ".tab:hover .tab-favorite,\n.tab:focus-within .tab-favorite {\n  opacity: 1;\n  transition: opacity var(--lt-duration-120) var(--lt-ease-decelerate),",
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

/// Every action in the app bar rests the same way. A button that carries only the icon-button component takes that component's own fill, which is the filled primary look the bar spends on saying which view you are in — so a new action ships reading as the one thing already pressed, which is what the fourth one did. The list is read off the markup rather than written here, so the fifth is held to it without anybody remembering to add a name.
#[test]
fn every_action_in_the_app_bar_rests_muted_rather_than_filled() {
    let css = reading_mode_css();
    let html = crate::APP_SHELL_HTML;

    let group = html
        .split_once(r#"id="appActionsItems""#)
        .and_then(|(_, rest)| rest.split_once(r#"<div class="window-controls""#))
        .map(|(group, _)| group)
        .expect("the actions group");

    // Every button standing in the group. The update bell is a `<summary>` inside its own component and is only ever there when there is something to install, so it is not one of these.
    let mut found = 0;
    for piece in group.split(r#"class="icon-button "#).skip(1) {
        let classes = piece.split('"').next().expect("the class list closes");
        let class = classes.split_whitespace().next().expect("a second class");
        found += 1;
        for state in ["", ":hover"] {
            let listed = format!(".{class}{state},");
            let alone = format!(".{class}{state} {{");
            assert!(
                css.contains(&listed) || css.contains(&alone),
                ".{class} rests on the bar's own muted fill rather than the filled primary the views wear"
            );
        }
    }
    assert!(found >= 4, "the actions group holds {found} buttons");
}

/// The theme survives being printed. A print render emulates a light color scheme, and the bootstrap follows the system scheme whenever the mode is `system` — so the listener fired mid-print and repainted the whole app in the light family for exactly as long as the picture was being taken, which is how a dark theme came out on white paper in dark ink. The hold is what stops it, and it is read here because the bootstrap is an inline script the front-end check never boots.
#[test]
fn the_theme_is_held_while_a_page_is_being_rendered_for_paper() {
    let boot = include_str!("../assets/theme-bootstrap.js");

    // The guard itself, on the one listener that can change the appearance without anybody asking.
    assert_contains(boot, "mode === 'system' && !holdingAppearance");

    // A browser's own print says when it starts and stops. The desktop renders the page without the page hearing about it at all, so the press turns the hold on and the host's answer turns it off — which is why it is a count rather than a flag.
    assert_contains(boot, "window.addEventListener('beforeprint'");
    assert_contains(boot, "window.addEventListener('afterprint'");
    assert_contains(boot, "Math.max(0, holdingAppearance + (held ? 1 : -1))");

    // Both ends of the desktop pair: the press holds, and every way out of the export releases.
    assert_contains(
        include_str!("../assets/shell/overflow.js"),
        "window.leafHoldAppearance(true)",
    );
    let export = include_str!("../app/fileops.rs");
    assert_contains(
        export,
        "window.leafHoldAppearance && window.leafHoldAppearance(false);",
    );
    assert!(
        export.matches("release(page)").count() >= 3,
        "the appearance is released on the cancel, the write and the failure alike"
    );
}

/// The page an export writes: the document as the page drew it, in the theme it was drawn in, naming the one stylesheet in the folder beside it.
///
/// Nothing is fetched and nothing runs. A theme is two attributes on the root and every theme's colors are in that one stylesheet, so the page opens in the right theme with no script at all. The drawings' own stylesheet is the exception that has to travel: mermaid writes one per drawing and the page hoists them into a single element in its head, so it is neither in the stylesheet nor inside the SVG — watched in a real browser, a page written without it is a page of black boxes with clipped labels.
#[test]
fn an_exported_page_names_its_stylesheet_and_pins_the_theme_it_was_written_in() {
    let page = exported_page_document(
        "moss",
        "dark",
        "Release notes",
        ".lt-mmd-0 .node rect { fill: #123; }",
        "<div class=\"app-surface\">the document</div>",
    );

    assert_contains(&page, "<!DOCTYPE html>");
    assert_contains(&page, "data-leaf-theme=\"moss\"");
    assert_contains(&page, "data-leaf-appearance=\"dark\"");
    assert_contains(&page, "<title>Release notes</title>");
    // The folder the pictures go in is the same one, so the two are named together and nowhere else.
    assert_eq!(EXPORTED_PAGE_STYLESHEET, "assets/app.css");
    assert_contains(&page, "<link rel=\"stylesheet\" href=\"assets/app.css\">");
    // What drops the app's own frame off the sheet, and what makes the browser scroll the body rather than the page carrying a scroller of its own.
    assert_contains(&page, "<body class=\"leaf-paper\">");
    assert_contains(&page, "<div class=\"app-surface\">the document</div>");

    // Inline, as the one element the page already holds it as: a second file in the folder would buy a fetch and another name for nothing.
    assert_contains(&page, "<style id=\"leaf-mermaid-sheets\">");
    assert_contains(&page, ".lt-mmd-0 .node rect { fill: #123; }");

    // A document with no drawing in it carries no empty element for one.
    let plain = exported_page_document("dusk", "light", "", "", "<p>hello</p>");
    assert!(
        !plain.contains("leaf-mermaid-sheets"),
        "a document with no drawing carried a stylesheet for one: {plain}"
    );
    assert_contains(&plain, "<title>Document</title>");

    // The three values the page hands over are a theme name, an appearance and somebody's document title, and a title is whatever they called their file.
    let named = exported_page_document("moss", "dark", "Q1 \"final\" <notes>", "", "");
    assert_contains(&named, "<title>Q1 &quot;final&quot; &lt;notes&gt;</title>");
}
