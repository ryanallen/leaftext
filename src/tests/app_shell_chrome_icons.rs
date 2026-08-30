//! The marks the page inlines and the colors they take.

use super::*;

/// The header logomark and the library's per-file badge are the same glyph, and neither may carry a color of its own: both inherit the theme through `currentColor`, which is what keeps the library leaves in step with the header when the theme changes.
#[test]
fn app_shell_inlines_one_leaf_mark_that_tracks_the_theme() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The glyph is drawn once, as a mask class, and named three times: the header logomark, the library row template, and the startup card the window comes up holding. The drawing itself is in the stylesheet, so no site can carry a color of its own.
    assert_eq!(
        html.matches("lt-icon-leaf").count(),
        3,
        "the leaf mark should be named exactly three times: header logomark, library row template, startup card"
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

    // The back arrow is a mask class, so the page names it and the stylesheet holds the drawing. `currentColor` governs one level out: the base class paints the mask in the control's own color.
    assert_contains(&html, r#"class="lt-icon lt-icon-back-long""#);
    let css = reading_mode_css();
    // The drawing is a value the page root declares and the class reads, which is what a theme pack replaces. Both halves are asserted: the same arrow reaching the root, and the class still taking it — either one alone passes on a drawing that never arrives.
    assert_contains(
        css,
        "--lt-icon-back-long: url(\"data:image/svg+xml,%3Csvg aria-hidden='true' focusable='false' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6.75 15.75 3 12m0 0 3.75-3.75M3 12h18' fill='none' stroke='%23000'",
    );
    assert_contains(
        rule_body(css, ".lt-icon-back-long {"),
        "mask-image: var(--lt-icon-back-long);",
    );
    // The app bar wears the small head on a full shaft, the folder menu's up row the full head. Both ends are pinned, or swapping the two passes.
    assert!(
        !html.contains(r#"class="lt-icon lt-icon-back""#),
        "the app bar took the folder menu's plain back arrow"
    );
    assert_contains(
        css,
        "--lt-icon-back: url(\"data:image/svg+xml,%3Csvg aria-hidden='true' focusable='false' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18' fill='none' stroke='%23000'",
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

/// A drawing is a value the page root declares and the class reads, which is the whole hook a theme pack hangs on: a family selector on the root redeclares the ones its pack covers and every class follows without being touched. A class that went back to carrying its own drawing would still look right in the window and would silently stop answering the theme.
#[test]
fn every_icon_is_a_value_the_root_declares_and_the_class_reads() {
    let rows = icon_rows();
    assert!(rows.len() > 30, "only found {} icon rows", rows.len());

    let css = reading_mode_css();
    for name in &rows {
        assert_contains(
            css,
            &format!("  --lt-icon-{name}: url(\"data:image/svg+xml,"),
        );
        let body = rule_body(css, &format!(".lt-icon-{name} {{"));
        assert_contains(body, &format!("-webkit-mask-image: var(--lt-icon-{name});"));
        assert_contains(body, &format!("mask-image: var(--lt-icon-{name});"));
    }
    // Nothing is left drawing its own: a rule holding a `data:` URI is a class the root cannot reach.
    let baked = css
        .lines()
        .filter(|line| line.contains("mask-image: url(\"data:"))
        .count();
    assert_eq!(
        baked, 0,
        "{baked} icon rules still bake in their own drawing"
    );
    // The bolder masks the view buttons swap to work the same way and are declared in the same block, so the file holds one pattern rather than two.
    for name in ["code-view", "document", "graph"] {
        assert_contains(
            css,
            &format!("  --lt-icon-{name}-heavy: url(\"data:image/svg+xml,"),
        );
    }
}

/// `A@{ icon: "leaf:back" }` in a diagram draws the app's own back arrow, out of a set generated from the same rows as the stylesheet — so an icon is named in one place and mermaid never falls back to its own glyph, an 80x80 square in a hardcoded #087ebf.
#[test]
fn every_icon_row_reaches_the_diagram_icon_set_and_nothing_else_does() {
    let rows = icon_rows();
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

/// The diagram's save window reads back the ending the reader typed and looks for the row that permits it, so the page's Markdown row has to permit every spelling an export may write — otherwise a name ending `.markdown` is refused in the same sentence that offers Markdown. Not every spelling the app opens: `.mdc` is a Cursor rule, which this window never writes.
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

    for spelling in MARKDOWN_EXPORT_EXTENSIONS {
        assert!(
            endings.contains(&format!("'{spelling}'")),
            "the diagram export window refuses a name ending .{spelling}, which it offers to write: {endings}"
        );
    }
    // First, because a bare name is given the row's first ending and a reader who typed none expects `.md`.
    assert!(
        endings.trim_start().starts_with("'md'"),
        "the Markdown row stopped leading with md, so a bare name comes out under another spelling: {endings}"
    );
    // And not `.mdc`: the app opens a Cursor rule, and this window writes an ordinary document with no frontmatter.
    assert!(
        !endings.contains("'mdc'"),
        "the diagram export menu offers .mdc, which names a Cursor rule over a file that is not one: {endings}"
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
