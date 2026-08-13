//! The compiled stylesheet's own rules.

use super::*;

#[test]
fn reading_mode_css_includes_light_dark_syntax_themes() {
    let css = reading_mode_css();

    // There is one name per color: the contract token itself, emitted per family. No alias layer sits over it, so a rule and a theme spell a color the same way.
    for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
        assert_contains(css, &format!("{token}:"));
    }

    // No fonts are bundled into the stylesheet: the app uses system fonts, and web-font themes fetch from Google Fonts on activation.
    assert!(
        !css.contains("@font-face") && !css.contains("data:font/woff2"),
        "reading-mode CSS must not embed bundled font faces"
    );
    // Every theme, github included, is a self-contained literal palette, so the compiled CSS carries no Primer primitive blocks and no `var(--bgColor-*)` indirection.
    assert!(!css.contains("--base-color-neutral-0"));
    assert!(!css.contains("var(--bgColor-default)"));
    assert!(!css.contains("var(--prettylights-syntax-comment)"));
    assert_contains(css, "/* Leaf semantic theme compiler output. */");
    assert_contains(css, "--lt-theme-source: github-light;");
    assert_contains(css, "--lt-theme-source: github-dark;");
    assert_contains(css, "--lt-theme-source: nightshade-light;");
    assert_contains(css, "--lt-theme-source: nightshade-dark;");
    assert_contains(css, "--lt-theme-source: amaranth-light;");
    assert_contains(css, "--lt-theme-source: amaranth-dark;");
    assert_contains(
        css,
        r#":root[data-leaf-theme="nightshade"][data-leaf-appearance="dark"]"#,
    );
    // GitHub's tokens are concrete hex, like every other family's.
    assert_contains(css, "--lt-background: #ffffff;");
    assert_contains(css, "--lt-syntax-comment: #59636e;");
    assert_contains(css, "--lt-syntax-inserted: #116329;");
    assert_contains(css, "--lt-syntax-inserted-background:");
    assert_contains(css, "--lt-syntax-deleted-background:");
    assert_contains(css, ".document-body input[type=\"checkbox\"]");
    assert_contains(css, ".document-body .math-display");
    assert_contains(css, ".document-body summary");
    assert_contains(css, ".document-body .syn-keyword");
    assert_contains(css, ".document-body .syn-inserted");
    assert_contains(css, "word-wrap: break-word;");
}

#[test]
fn every_element_starts_as_a_border_box_and_no_comment_denies_it() {
    let css = reading_mode_css();

    // The second rule in the stylesheet, and the reason a width cap below it counts the border and the padding. No comment may deny it: one claiming the stylesheet had no global rule talked a plan into a declaration it already had.
    assert_contains(rule_body(css, "\n* {"), "box-sizing: border-box;");
    assert!(
        !css.contains("no global"),
        "no comment may tell a reader this stylesheet has no global box-sizing"
    );
}

#[test]
fn reading_mode_css_consumes_theme_tokens_for_high_impact_surfaces() {
    let css = reading_mode_css();

    for rule in [
        "background: var(--lt-background);",
        "color: var(--lt-foreground);",
        "background-color: var(--lt-surface);",
        "color: var(--lt-muted-foreground);",
        "border: var(--lt-stroke-1) solid var(--lt-border);",
        "background: var(--lt-surface-elevated);",
        "outline: var(--lt-stroke-3) solid var(--lt-focus-ring);",
        "background: var(--lt-focus-selection-background);",
        "color: var(--lt-focus-selection-foreground);",
        "background: var(--lt-markdown-background);",
        "color: var(--lt-markdown-foreground);",
        "color: var(--lt-markdown-heading);",
        "background: var(--lt-editor-inline-code-background);",
        "color: var(--lt-editor-inline-code-foreground);",
        "border-left: 0.25em solid var(--lt-markdown-blockquote-border);",
        "color: var(--lt-markdown-blockquote-foreground);",
        "border-left-color: var(--lt-markdown-alert-warning);",
        "border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);",
        "background: var(--lt-markdown-table-header-background);",
        "background: var(--lt-markdown-thematic-break);",
        "background: var(--lt-editor-code-background);",
        "background-clip: padding-box;",
        "clip-path: inset(0 round 6px);",
        "color: var(--lt-editor-code-foreground);",
        "background: var(--lt-editor-code-selection-background);",
        "color: var(--lt-editor-code-selection-foreground);",
        "background: var(--lt-markdown-keyboard-background);",
        "border: var(--lt-stroke-1) solid var(--lt-minimap-viewport-border);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn the_home_screens_new_document_button_stays_readable_on_hover() {
    // With a color and no background of its own, the generic `button:hover` fill stays underneath and hover is one purple on another. Both states name a pair the theme compiler gates, so no theme can repeat it.
    let css = reading_mode_css();

    let rest = rule_body(&css, ".primary-new {");
    assert_contains(rest, "background: transparent;");
    assert_contains(rest, "color: var(--lt-markdown-foreground);");

    let hover = rule_body(&css, ".primary-new:hover {");
    assert_contains(
        hover,
        "background: var(--lt-navigation-button-hover-background);",
    );
    assert_contains(hover, "color: var(--lt-primary-foreground);");
}

#[test]
fn table_rows_are_grained_on_both_stripes_with_the_darker_row_darker() {
    let css = reading_mode_css();

    // Dark themes grain both stripes; light themes leave the untinted rows plain, because there a dot dark enough to see reads as a gray mesh over the table.
    assert_contains(css, "--reader-surface-grain: var(--app-bar-grain);");
    assert_contains(css, "--reader-row-grain: transparent;");
    // Lighter, not darker — the untinted row is the darkest surface in the app, so darkening it has nowhere to go and lands unevenly across theme families.
    assert_contains(css, "--reader-row-grain: var(--lt-grain-lift);");

    // The zeroed value must be the light default and the lift the dark override, not the reverse — that swap is exactly what this pins.
    let light = css
        .find("--reader-row-grain: transparent;")
        .expect("light themes zero the row grain");
    let dark = css
        .find("--reader-row-grain: var(--lt-grain-lift);")
        .expect("dark themes set the row grain");
    let dark_block = css
        .find("[data-theme=\"dark\"]")
        .expect("the dark override block");
    assert!(light < dark_block, "the zeroed value is the light default");
    assert!(dark > dark_block, "the lifted value is the dark override");

    let even = css
        .find("tr:nth-child(2n) td")
        .expect("the tinted rows are grained");
    let odd = css
        .find("tr:nth-child(2n + 1) td")
        .expect("the untinted rows are grained too");
    let frontmatter = css
        .find(".frontmatter tr td")
        .expect("the frontmatter table opts out");

    // The row grain belongs to the untinted stripe, not the tinted one.
    assert_contains(&css[odd..], "--lt-grain-dot: var(--reader-row-grain);");
    // Same 2px lattice on both, so the dots line up down the page across a stripe.
    assert_contains(&css[odd..], "background-size: 2px 2px;");

    // Source order is load-bearing: the row rules and the frontmatter opt-out tie on specificity, so the opt-out wins only by coming last.
    assert!(even < odd, "even-row grain should precede odd-row grain");
    assert!(
        odd < frontmatter,
        "the frontmatter opt-out must come after both row rules to win the tie"
    );
}

#[test]
fn a_note_that_asked_for_a_full_width_page_gets_the_whole_lane() {
    let css = reading_mode_css();

    // Two classes deep, so it out-specifies `.document-body`'s own measure without a `!important`.
    let wide = css
        .find(".document-body.document-body-wide {")
        .expect("the full-width page rule");
    let measure = css
        .find(".document-body {")
        .expect("the reading measure rule");
    assert!(
        measure < wide,
        "the wide rule has to come after the measure it overrides"
    );
    assert_contains(&css[wide..], "width: 100%;");

    // A list-valued field is reached through the table, because `class` does not survive the sanitizer on a `ul`.
    let list = css
        .find(".document-body .frontmatter td ul {")
        .expect("the list-valued field rule");
    assert_contains(&css[list..], "list-style: none;");
}

#[test]
fn every_hover_fills_with_the_one_wash() {
    // One strength for everything under the pointer, so a menu row, a file in the pane and a tool in the reading bar all lift by the same amount. A surface color instead is free to be the very value of the panel behind it, which is what left a right-click menu marking nothing in Pippin dark.
    let css = reading_mode_css();

    // The rule a selector opens, up to its closing brace. Named selectors are grouped (`.a:hover,\n.a:focus-visible {`), so the block is found from the name rather than from a whole selector list.
    let rule_after = |selector: &str| -> &str {
        let at = css
            .find(selector)
            .unwrap_or_else(|| panic!("expected a rule for {selector}"));
        let open = css[at..].find('{').expect("the rule opens");
        let close = css[at + open..].find('}').expect("the rule closes");
        &css[at + open..at + open + close]
    };

    for selector in [
        ".context-menu-item:hover",
        ".filter-menu-item.is-active",
        ".flow-menu-item:hover",
        ".library-file:hover",
        ".library-hit:hover",
        ".library-crumb:hover",
        ".library-vault-switch:hover",
        ".crumb-menu-edit:hover",
        ".reader-tool:hover",
        ".reader-subtool:hover",
        ".history-button:hover:not(:disabled)",
    ] {
        assert!(
            rule_after(selector).contains("background: var(--lt-wash-hover);"),
            "expected {selector} to fill with the hover wash"
        );
    }

    // And the wash is one mix of a color the family owns, so it can never come out the tone of what it sits on.
    assert_contains(
        css,
        "--lt-wash-hover: color-mix(in srgb, var(--lt-hover-tint) 16%, transparent);",
    );

    // The locked diagram canvas is the one rule left filling with the tinted-panel color, and it has to stay one: it is a panel, not a hover, and a transparent wash over the page would leave a locked diagram looking live.
    assert!(
        rule_after(".flow-canvas.is-disabled").contains("background: var(--lt-surface-muted);"),
        "the disabled diagram canvas is a panel and keeps its own fill"
    );
}

#[test]
fn reading_mode_css_keeps_one_name_per_color() {
    // A property whose whole value is one var() over a contract token is a second name for that color. Four such layers over 112 tokens is what this replaced, so the rule is: every rule reads the contract name.
    let css = reading_mode_css();

    let declarations: Vec<(&str, &str)> = css
        .lines()
        .map(str::trim)
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.starts_with("--"))
        .map(|(name, value)| (name, value.trim().trim_end_matches(';')))
        .collect();

    for (name, value) in &declarations {
        // A name declared twice takes its value from context — the code view swaps the tab fill and the edge fade — so it is not a second name for one color.
        if declarations
            .iter()
            .filter(|(other, _)| other == name)
            .count()
            > 1
        {
            continue;
        }
        let inner = value
            .strip_prefix("var(")
            .and_then(|rest| rest.strip_suffix(')'))
            .map(str::trim);
        assert!(
            !inner.is_some_and(|token| LEAF_SEMANTIC_TOKEN_CONTRACT.contains(&token)),
            "{name} is a second name for {}",
            inner.unwrap_or_default()
        );
    }
}

#[test]
fn reading_mode_css_defines_document_typography() {
    let css = reading_mode_css();

    for rule in [
            "--reader-content-pad: 32px;",
            "--type-measure-body: 75ch;",
            "--type-base: max(0.875rem, calc(1rem + (100vw - 1280px) / 140));",
            "--type-spacing: calc(var(--type-base) * 1.5);",
            "--type-spacing-sm: var(--type-base);",
            "--type-body-size: var(--type-base);",
            "--type-display-size: calc(var(--type-base) * 3.2);",
            "--type-h1-size: calc(var(--type-base) * 2.2);",
            "--type-h2-size: calc(var(--type-base) * 2);",
            "--type-h3-size: calc(var(--type-base) * 1.8);",
            "--type-h4-size: calc(var(--type-base) * 1.6);",
            "--type-h5-size: calc(var(--type-base) * 1.4);",
            "--type-h6-size: calc(var(--type-base) * 1.2);",
            "--type-caption-size: calc(var(--type-base) * 0.8125);",
            "--type-display-line: 1.2;",
            "--type-h1-line: 1.25;",
            "--type-h2-line: 1.25;",
            "--type-h3-line: 1.25;",
            "--type-h4-line: 1.25;",
            "--type-body-line: 1.6;",
            "--type-caption-line: 1.6;",
            ".reader-layout {\n  --reader-layout-padding-inline: var(--reader-content-pad);\n  container-type: inline-size;",
            "width: min(var(--type-measure-body), 100%);",
            "padding: var(--reader-content-pad) 0;",
            "font-size: var(--type-body-size);",
            "line-height: var(--type-body-line);",
            "word-wrap: break-word;",
            ".document-body h1,",
            ".document-body h6 {",
            "font-family: var(--heading-font);",
            "font-weight: var(--type-h1-weight);",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            "font-size: var(--type-h1-size);",
            "font-size: var(--type-h2-size);",
            "font-size: var(--type-h3-size);",
            "font-size: var(--type-h4-size);",
            "font-size: var(--type-h5-size);",
            "font-size: var(--type-h6-size);",
        ] {
            assert_contains(css, rule);
        }

    for old_reader_specific_layout in [
        "--type-h1-measure",
        "--type-h2-measure",
        "--type-h3-measure",
        "--type-heading-measure",
        "text-wrap: balance;",
        "text-box-trim: trim-both;",
    ] {
        assert!(
                !css.contains(old_reader_specific_layout),
                "rendered Markdown should keep the web reader layout instead of {old_reader_specific_layout}"
            );
    }
}

#[test]
fn reading_mode_css_uses_web_reader_document_rhythm() {
    let css = reading_mode_css();

    for rule in [
            ".document-body p,\n.document-body ul,\n.document-body ol,\n.document-body blockquote,\n.document-body table,\n.document-body pre {\n  margin: 0 0 var(--type-spacing);\n}",
            ".document-body h1,\n.document-body h2,\n.document-body h3,\n.document-body h4,\n.document-body h5,\n.document-body h6 {",
            "margin: var(--type-spacing) 0 var(--type-spacing);",
            ".document-body strong {\n  font-weight: var(--lt-weight-600);\n}",
            ".document-body ul,\n.document-body ol {\n  padding-left: 2em;\n}",
            ".document-body li + li {\n  margin-top: 0.25em;\n}",
            ".document-body li > ul,\n.document-body li > ol {\n  margin: 0.25em 0 0;\n}",
            ".document-body input[type=\"checkbox\"] {\n  accent-color: var(--lt-checkbox-accent);\n  margin-right: 0.4em;\n}",
            ".document-body blockquote {\n  border-left: 0.25em solid var(--lt-markdown-blockquote-border);\n  color: var(--lt-markdown-blockquote-foreground);\n  padding: 0 1em;\n}",
            ".document-body blockquote:not(.markdown-alert) p {\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body blockquote:not(.markdown-alert) p.blockquote-lines {\n  padding-left: 0;\n  text-indent: 0;\n}",
            ".document-body blockquote:not(.markdown-alert) .blockquote-line {\n  display: block;\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body code {",
            "font-size: 0.875em;\n  padding: 0.2em 0.4em;",
            ".document-body pre {",
            "line-height: var(--lt-leading-1-45);",
            "padding: 1em;",
            ".document-body table {",
            "overflow: auto;",
            "width: max-content;",
            ".document-body th,\n.document-body td {\n  border: var(--lt-stroke-1) solid var(--lt-markdown-table-border);\n  padding: 0.375em 0.8125em;\n}",
            ".document-body hr {\n  border: 0;\n  height: 1px;\n  margin: var(--type-spacing) 0;",
            "@media (max-width: 600px) {\n  :root {\n    --reader-content-pad: 16px;",
        ] {
            assert_contains(css, rule);
        }

    for old_rhythm in [
        ".document-body > * {\n  margin-block: 0 var(--lt-space-16);\n}",
        "margin-block-start: calc(var(--type-base) * 4);",
        "margin-block-start: calc(var(--type-base) * 1.5);",
        "padding-top: var(--lt-space-136);",
        "padding: var(--lt-space-320) 0 var(--lt-space-88);",
    ] {
        assert!(
            !css.contains(old_rhythm),
            "rendered Markdown rhythm should match the web reader instead of {old_rhythm}"
        );
    }
}

#[test]
fn app_css_is_served_over_the_asset_protocol_not_inlined() {
    // The reading-mode stylesheet is delivered as a linked stylesheet, so the shell links it and the protocol serves the full CSS. Keeping it out of the inlined shell is what keeps `NavigateToString` under WebView2's size cap.
    let html = app_shell_page();
    assert!(
        html.contains(r#"<link rel="stylesheet" href="#) && html.contains("app.css"),
        "shell must link app.css rather than inline a <style> block"
    );
    assert!(
        !html.contains("<style>"),
        "reading-mode CSS must not be inlined into the shell"
    );

    let css = bundled_asset_response("http://leaf-asset.local/app.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type, "text/css; charset=utf-8");
    // The route serves the whole compiled stylesheet: fonts, semantic tokens, and app layout all resolve here.
    let body = std::str::from_utf8(&css.body).expect("app.css is utf-8");
    assert_eq!(body, reading_mode_css());
    assert!(body.contains("--lt-background"));
    assert!(body.contains(".app-bar"));
}

#[test]
fn reading_surfaces_carry_the_chrome_dot_grain() {
    let css = reading_mode_css();

    // The chrome's own value, not one of its own: a lighter screen made the reading panels a second texture, brighter than the pane beside them.
    assert_contains(css, "--reader-surface-grain: var(--app-bar-grain);");
    assert!(
        !css.contains("--reader-surface-grain: rgba"),
        "the reader grain must stay one value with the chrome's, not a table of its own"
    );

    // Every tinted reading surface takes the grain, on the chrome's lattice.
    for expected in [
        ".document-body .document-outline,",
        ".document-body .tei-front,",
        ".document-body pre,",
        ".document-body th,",
        ".document-body tr:nth-child(2n) td {",
        "--lt-grain-dot: var(--reader-surface-grain);",
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
    ] {
        assert_contains(css, expected);
    }

    // The grain rule has to follow the fills it grains: at equal specificity a `background:` shorthand declared later blanks the image again. Found by its own selector list, not by the first mention of the token — a surface that outranks this rule restates the grain for itself, and the first mention is one of those.
    let shared = css
        .find(".document-body tr:nth-child(2n) td {")
        .expect("the shared grain rule");
    let grain = shared
        + css[shared..]
            .find("var(--reader-surface-grain)")
            .expect("reader grain rule");
    for fill in [
        ".document-body .document-outline {",
        ".document-body pre {",
        ".document-body th {",
    ] {
        let at = css.find(fill).unwrap_or_else(|| panic!("{fill} rule"));
        assert!(at < grain, "{fill} must be declared before the grain rule");
    }

    // The code view is a whole page, not a cell — graining it dithers the editor.
    let selectors = css[..grain]
        .rfind("*/")
        .map(|at| &css[at..grain])
        .expect("the grain rule is commented");
    assert!(
        !selectors.contains(".code-view"),
        "the code view must not be in the grain rule's selector list"
    );
}

#[test]
fn the_pager_button_grains_under_the_pointer_and_keeps_its_label_unmarked() {
    let css = reading_mode_css();

    // The fill is the page's own lattice in the one ink a hover has, on the same window-anchored grid every grained surface uses — a box-anchored one falls out of phase with the code block above it at the button's edge.
    let hover = rule_body(
        css,
        ".document-body .docs-pager a:hover,\n.document-body .docs-pager a:focus-visible {",
    );
    for expected in [
        "--lt-grain-dot: var(--lt-grain-hover);",
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
        "text-decoration: none;",
    ] {
        assert_contains(hover, expected);
    }

    // The ink is black at an alpha like every other grain, so the button sinks on a light family and a dark one alike rather than lifting on one of them.
    assert_contains(css, "--lt-grain-hover: rgba(0, 0, 0, 0.55);");

    // Both pager rules are scoped under the document. Unscoped they weigh the same as the blanket link rule and lose to it for sitting earlier, which underlines the page name and takes its color.
    for scoped in [
        ".document-body .docs-pager a {",
        ".document-body .docs-pager a:hover,",
    ] {
        assert_contains(css, scoped);
    }
    assert!(
        !css.contains("\n.docs-pager a"),
        "an unscoped pager rule loses the underline fight to .document-body a:hover"
    );

    // And nothing may set a background after it: at equal weight a later `background:` shorthand blanks the image.
    let at = css
        .find(".document-body .docs-pager a:hover,")
        .expect("the pager hover rule");
    assert!(
        !css[at..].contains(".docs-pager a {"),
        "a later pager fill would blank the lattice"
    );
}

#[test]
fn reading_mode_css_offsets_document_by_measured_scroll_origin() {
    let css = reading_mode_css();

    assert_contains(
        css,
        "margin: calc(-1 * var(--reader-scroll-origin, 0px)) 0 0;",
    );
}

#[test]
fn find_matches_are_painted_without_touching_the_document() {
    let css = reading_mode_css();

    // Both names twice over: the reading view paints them through the CSS Custom Highlight API (no DOM mutation, no reflow) and the source view as Monaco decorations, which are ordinary classes.
    for expected in [
        "::highlight(leaf-find-match),\n.leaf-find-match {",
        "::highlight(leaf-find-current),\n.leaf-find-current {",
        // The match wash is the accent a search hit already takes in the pane; the one you are on is the primary, so stepping is a moving mark.
        "background-color: color-mix(in srgb, var(--lt-accent) 45%, transparent);",
        "background-color: color-mix(in srgb, var(--lt-primary) 45%, transparent);",
    ] {
        assert_contains(css, expected);
    }

    // The bar holds its place while the document scrolls under it, and its box is padded rather than being the tightest thing on screen.
    let bar_start = css
        .find(".find-bar {")
        .expect("reading-mode CSS should define .find-bar");
    let bar_rule =
        &css[bar_start..bar_start + css[bar_start..].find('}').expect(".find-bar closes")];
    assert_contains(bar_rule, "grid-column: 2;");
    assert_contains(bar_rule, "grid-row: 1;");
    assert_contains(bar_rule, "padding: var(--lt-space-10);");
}

#[test]
fn find_bar_controls_are_the_app_bars_own_button_size() {
    // The bar's buttons wear .icon-button for their 32px box, and this rule is 4,650 lines later at the same one-class depth — so a height, a min-width or a padding here would silently win and put them back at 16px, which is an icon with no button around it.
    let css = reading_mode_css();
    let start = css
        .find(".find-flag,\n.find-step,\n.find-action {")
        .expect("the find bar's buttons share one face rule");
    let rule = &css[start..start + css[start..].find('}').expect("the rule closes")];

    for absent in ["height:", "min-width:", "padding:"] {
        assert!(
            !rule.contains(absent),
            "the shared find-button rule must not set {absent} — .icon-button owns the box:\n{rule}"
        );
    }
    // The text on them matches the rest of the chrome rather than being a size smaller.
    assert_contains(rule, "font-size: var(--lt-text-12);");

    // The ones holding text win their width back, because .icon-button sets a width and 32px clips `ab|`. Anchored on the declaration: `.find-action {` on its own also matches the end of the shared selector list above.
    assert_contains(css, ".find-flag {\n  width: auto;");
    assert_contains(css, ".find-action {\n  width: auto;");

    // And the box they defer to is the 32px one, so "same as the app bar's" is a number and not a hope. At the start of a line, or the comment that quotes the selector matches first.
    let box_rule = rule_body(css, "\n.icon-button {");
    assert_contains(box_rule, "height: 32px;");
    assert_contains(box_rule, "min-width: 32px;");
}

#[test]
fn the_find_bar_throws_the_same_dot_shadow_as_every_other_floating_panel() {
    // In the shared list, not a tenth copy of it: the spread is a fixed inset and the punch is that inset taken back off, so it fits any size of box. The reader toolbar's own copy is not a precedent — it has one mask, no punch, having no opaque face to clear.
    let css = reading_mode_css();
    let shared = css
        .find(".app-overflow-panel::before,")
        .expect("the shared dot-shadow rule");
    let selectors = &css[shared..shared + css[shared..].find('{').expect("the rule opens")];
    assert_contains(selectors, ".find-bar::before,");

    // The dots have to be the ::before and the opaque face the ::after: both children sit at --lt-z-below, so tree order is what puts the face over the dots that fall on it, and swapping them would draw a screen of dots across the bar.
    assert_contains(
        rule_body(css, ".find-bar::after {"),
        "background: var(--lt-surface-elevated);",
    );
}

#[test]
fn the_find_bar_gives_way_rather_than_running_off_a_narrow_page() {
    // Three answers, smallest step first: the field shrinks, then the row wraps, then the bar stops floating. The reading column can be 360px (MIN_READER_WIDTH) and the row wants about 370, so without these the part clipped is the field you type into.
    let css = reading_mode_css();

    let field = rule_body(css, ".find-field {");
    assert_contains(field, "flex: 1 1 auto;");
    assert_contains(field, "min-width: 120px;");
    assert_contains(rule_body(css, ".find-row {"), "flex-wrap: wrap;");

    // The cap holds the bar's border and 10px inset inside the number because the rule at the top of the stylesheet already gave it a border box.
    let bar = rule_body(css, ".find-bar {");
    assert_contains(bar, "max-width: calc(100% - var(--lt-space-16));");

    // The full-width block is the reader's own 600px, not a second number nobody can defend.
    let phone = css
        .find("@media (max-width: 600px) {\n  .find-bar {")
        .expect("the find bar spans the page at a phone's width");
    let block = &css[phone..phone + css[phone..].find('}').expect("the rule closes")];
    assert_contains(block, "justify-self: stretch;");
    assert_contains(block, "max-width: none;");
}

#[test]
fn reading_mode_css_pins_reader_to_its_grid_cell() {
    // The reader must be explicitly placed in the library-shell grid. Auto-placed, unhiding the .reader-loading overlay (explicitly at column 2, row 1) evicts the reader into an implicit row in the 0px library column, reflowing the whole document at zero width and turning every in-flight scroll computation into garbage — the "page jumps all over the place" bug.
    let css = reading_mode_css();
    let shell_rule_start = css
        .find(".reader-shell {")
        .expect("reading-mode CSS should define .reader-shell");
    let shell_rule_end = css[shell_rule_start..]
        .find('}')
        .map(|offset| shell_rule_start + offset)
        .expect(".reader-shell rule should close");
    let shell_rule = &css[shell_rule_start..shell_rule_end];

    assert_contains(shell_rule, "grid-column: 2;");
    assert_contains(shell_rule, "grid-row: 1;");
}

#[test]
fn reading_mode_css_softens_the_readers_top_and_bottom_edges() {
    // The wash has to be a sibling in the reader's grid cell, hung off the app bar's height at the top. Inside the scroller it would be positioned against the scrolled content and slide away with the document; drawn from the cell's top it would sit behind the opaque bar and never show.
    let css = reading_mode_css();
    let rule_start = css
        .find(".reader-edge-fade {")
        .expect("reading-mode CSS should define .reader-edge-fade");
    let rule_end = css[rule_start..]
        .find('}')
        .map(|offset| rule_start + offset)
        .expect(".reader-edge-fade rule should close");
    let rule = &css[rule_start..rule_end];

    assert_contains(rule, "grid-column: 2;");
    assert_contains(rule, "grid-row: 1;");
    assert_contains(rule, "pointer-events: none;");
    // The wash behind the dot screen: one band per edge, opaque at each cut and gone by the far side. It sits here rather than on the bands because those are masked, and the mask would ramp it a second time. At :root, not on this element: a widened table dissolves its own sliced ends with the same depth and the same hold, so every edge in the app is one profile.
    assert_contains(css, "  --reader-edge-fade-depth: 36px;");
    assert_contains(css, "  --reader-edge-fade-hold: 2px;");
    // The card's three hairlines are reserved with a transparent border, never a spacing value: a border width is snapped to whole device pixels and a margin is not, so a margin of the same width leaves half a device pixel of the last line un-faded at any scaling that is not a whole number.
    assert_contains(rule, "border: 0 solid transparent;");
    assert_contains(
        rule,
        "border-width: 0 var(--lt-stroke-1) var(--lt-stroke-1);",
    );
    // Which leaves the margin holding only what is not a hairline. The scrollbar belongs to the scroller, which paints it inside a box this overlay sits on top of — there is no z-index that puts it back on top, so the bands hold off its gutter instead. It closes with the minimap rail.
    assert_contains(rule, "margin-right: var(--reader-scrollbar);");
    assert!(
        !rule.contains("--lt-space-1"),
        "the edge fade should reserve the card's hairlines with a border, not a spacing value"
    );
    // The inner corner is the outer one less the border, worked out from a border snapped the way the card's is — so no hand-written correction.
    assert_contains(
        rule,
        "border-radius: 0 0 var(--lt-radius-md) var(--lt-radius-md);",
    );
    // With no rail to sit against the card is held off the left frame, and that margin is the gutter alone for the same reason.
    let closed = rule_body(css, ".library-shell.library-closed .reader-edge-fade {");
    assert_contains(closed, "margin-left: var(--reader-gutter);");
    assert_contains(css, "  --reader-scrollbar: 14px;");
    let railed = rule_body(css, "body:has(.document-minimap) {");
    assert_contains(railed, "--reader-scrollbar: 0px;");
    // Same width the scrollbar itself is set to, which stays a literal there: Chromium won't re-resolve a scrollbar pseudo-element on a :has() flip. The block is named by its first selector, not its last, because the wearer list grows at the end and a box joining it read as this rule having been deleted.
    let bar = rule_body(css, "\n.leaf-scroll::-webkit-scrollbar,");
    assert_contains(bar, "width: 14px;");
    // Two cuts, two washes.
    assert_eq!(rule.matches("linear-gradient(").count(), 2);
    // The wash spans the same depth as the screen over it, not its own. Given a shorter one its ramp ends where the screen's carries on, and the break in slope reads as a bright line at the halfway mark.
    assert_contains(
        rule,
        "background-size: 100% var(--reader-edge-fade-depth), 100% var(--reader-edge-fade-depth);",
    );
    assert_contains(
        rule,
        "background-position: 0 var(--app-bar-height), 0 100%;",
    );
    assert_contains(
        css,
        ".reader-edge-fade::before {\n  top: var(--app-bar-height);",
    );
    assert_contains(css, ".reader-edge-fade::after {\n  bottom: 0;");
    // No band down the sides, and nothing to hang one on. Nothing is cut there: a widened table stops 62px inside the page edge and dissolves its own ends, so a side band only ever veiled the first and last letter of every line, which is what v0.1.469 shipped.
    for gone in [
        ".reader-edge-fade-side",
        ".reader-edge-fade-left",
        ".reader-edge-fade-right",
    ] {
        assert!(
            !css.contains(gone),
            "the reader's side bands must stay out of the stylesheet: {gone} is back"
        );
        assert!(
            !app_shell_page().contains(gone),
            "the reader's side bands must stay out of the page: {gone} is back"
        );
    }
    // The code view repaints the card, so the fade has to follow that color.
    assert_contains(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
}

#[test]
fn the_pages_two_bottom_corners_keep_their_stroke() {
    // The clip is the half of this that is easy to drop: the transparent border reserves the card's straight edges, the padding-box clip reserves its curve. Without it the wash is cut at the border box and paints over both bottom arcs — the bottom-left one always, the bottom-right one whenever a minimap takes its scrollbar reserve to zero.
    let css = reading_mode_css();
    let rule = rule_body(css, ".reader-edge-fade {");
    assert_contains(rule, "background-clip: padding-box;");
    // Both halves, or the corner comes back the other way round.
    assert_contains(
        rule,
        "border-width: 0 var(--lt-stroke-1) var(--lt-stroke-1);",
    );
    // And the curve being reserved has to be the card's own, or the clip is cut to a shape nothing draws.
    let radius = "border-radius: 0 0 var(--lt-radius-md) var(--lt-radius-md);";
    let card = rule_body(css, ".reader-shell {");
    assert_contains(
        card,
        "border-bottom: var(--lt-stroke-1) solid var(--lt-border);",
    );
    assert_contains(card, radius);
    assert_contains(rule, radius);
}

#[test]
fn the_readers_edges_reuse_the_chromes_grain_and_fade_it_by_opacity() {
    // The edge is the chrome's dot screen in the page's color, so it has to be the same circle on the same lattice as the bar — and each rule has to write the circles itself. A custom property holding the whole gradient resolves its ink where it is declared, so one at `:root` outranks every `--lt-grain-dot` below it: v0.1.439 screened the chrome's dark ink over a light page, 239-255 gray where the page is 255.
    let css = reading_mode_css();
    let grain = "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);";
    assert!(
        !css.contains("--lt-grain-image:"),
        "the lattice must not go through a variable holding the whole gradient: the ink \
         inside it would resolve at the root and no override could reach it"
    );
    let bar = rule_body(css, ".app-bar {");
    assert_contains(bar, grain);
    assert_contains(bar, "background-size: 2px 2px;");

    let shared = rule_body(css, ".reader-edge-fade::before,");
    assert_contains(shared, grain);
    assert_contains(shared, "background-size: 2px 2px;");
    // And the ink is the page's own color, which is the whole point: over a flat page the screen cannot be seen, and over a tinted block at the edge it still carries the lattice.
    assert_contains(shared, "--lt-grain-dot: var(--reader-edge-fade-surface);");
    assert_contains(
        rule_body(css, ".reader-edge-fade {"),
        "--reader-edge-fade-surface: var(--lt-markdown-background);",
    );
    assert_contains(
        rule_body(css, ".reader-shell {"),
        "background: var(--lt-markdown-background);",
    );
    // Depth is one number, shared with the wash under the screen.
    assert_contains(shared, "height: var(--reader-edge-fade-depth);");
    // One window-anchored lattice across every grained surface.
    assert_contains(shared, "background-attachment: fixed;");
    // One even screen. A second dot layer is a size ramp, which reads as stacked bands. One even screen. A second dot layer is a size ramp, which reads as stacked bands.
    assert_eq!(shared.matches("radial-gradient(").count(), 1);

    // Opposite directions, and both taking their hold from the same variable the wash does: the two fades cover one span, and any daylight between their profiles comes back as a bright line where the slopes part. A transform would flip the box but also make it the containing block for its own fixed background, knocking it off the shared lattice. Anchored past the shared rule, whose own selector list ends in the same `.reader-edge-fade::after {` the bottom band's rule opens with.
    let standalone = &css[css
        .find(".reader-edge-fade::before {")
        .expect("the top band should have its own rule")..];
    let top = rule_body(standalone, ".reader-edge-fade::before {");
    let bottom = rule_body(standalone, ".reader-edge-fade::after {");
    assert_contains(top, "mask-image: linear-gradient(\n    to bottom,");
    assert_contains(bottom, "mask-image: linear-gradient(\n    to top,");
    for edge in [top, bottom] {
        assert_contains(
            edge,
            "var(--lt-mask-opaque) 0 var(--reader-edge-fade-hold),",
        );
        // WebView2 is Chromium, but WKWebView wants the prefix.
        assert_contains(edge, "-webkit-mask-image:");
        assert!(!edge.contains("transform:"));
    }
}

#[test]
fn app_shell_hosts_the_reader_edge_fade() {
    let html = app_shell_page();

    assert_contains(&html, "class=\"reader-edge-fade\"");
}

#[test]
fn reading_mode_css_keeps_minimap_stable_wide_enough_and_responsive() {
    let css = reading_mode_css();

    for expected in [
            ".reader-layout {",
            "--reader-layout-padding-inline: var(--reader-content-pad);",
            "grid-template-columns: minmax(0, 1fr);",
            "justify-items: center;",
            "padding: 0 var(--reader-layout-padding-inline);",
            "position: relative;",
            ".reader-layout-no-minimap",
            "justify-items: center;",
            ".document-minimap {",
            "--minimap-padding-inline: 8px;",
            "--minimap-preview-width: 68px;",
            "--minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));",
            "width: var(--minimap-width);",
            ".document-minimap-track {",
            ".document-minimap-content",
            ".document-minimap-preview",
            "left: var(--minimap-padding-inline);",
            "right: var(--minimap-padding-inline);",
            "cursor: default;",
            "touch-action: none;",
            "user-select: none;",
            "@media (max-width: 900px)",
            "--minimap-preview-width: 46px;",
            // The rail is chrome, not page: its own shell column, a lead-in holding the card's right border off it, the window gutter beyond it, and no bleed or sticky, because it does not live in the scroller it tracks.
            ".reader-minimap {",
            "grid-column: 3;",
            "padding-left: var(--reader-minimap-gap);",
            "--reader-minimap-gap: 4px;",
            "body:has(.document-minimap) {",
            "--reader-minimap-column: calc(var(--minimap-width) + var(--reader-minimap-gap));",
        ] {
            assert_contains(css, expected);
        }

    for gone in [
        "margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));",
        ".reader-layout:has(.document-minimap)",
        "position: sticky;\n  top: 0;\n  width: var(--minimap-width);",
    ] {
        assert!(
            !css.contains(gone),
            "the rail sits outside the page now, so {gone} should be gone"
        );
    }

    assert!(
        !css.contains(".document-minimap {\n    display: none;"),
        "minimap must stay visible on narrow windows so it remains the scroll affordance"
    );

    for removed_fixed_height in [
        "height: calc(100vh - 150px);",
        "min-height: 180px;",
        "max-height: 720px;",
    ] {
        assert!(
            !css.contains(removed_fixed_height),
            "minimap rail should use measured reader viewport height, not {removed_fixed_height}"
        );
    }

    assert!(
        !css.contains("--reader-layout-padding-inline: 14px;"),
        "reader side padding should follow the web reader content pad token"
    );

    assert!(
            !css.contains("padding-inline: var(--minimap-padding-inline);"),
            "minimap track padding would double-inset the preview lane and keep the viewport overlay from reading as edge-to-edge"
        );
    assert!(
            !rule_body(&css, ".document-minimap-track {").contains("border-left"),
            "minimap track border must not consume layout width because the preview lane needs exactly 8px from both minimap edges"
        );
    assert!(
        css.contains(".document-minimap-viewport {\n  position: absolute;\n  inset-inline: 0;"),
        "minimap viewport must span the full rail width"
    );
    assert!(
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: 0;\n  transform: translateY(0px);\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "the minimap thumbnail lane fills the rail inside the exact 8px padding on both edges"
        );
    // The clone is laid out inside a frame carrying the same container query the reading layout carries, so a wide table in the thumbnail measures the room the page gives it instead of the whole window — which is what left the thumbnail a fifth short of the bottom.
    assert!(
        css.contains(
            ".document-minimap-frame {\n  container-type: inline-size;\n  transform-origin: 0 0;\n}"
        ),
        "the clone's frame must carry the reading layout's container query, and the scale with it"
    );
    assert_eq!(
        css.matches("  container-type:").count(),
        3,
        "only the reading layout, the clone's frame and the start screen declare a container query"
    );
    // The frame is the transformed element now, so the clone needs a containing block of its own or every absolutely positioned part of a rendered document measures off a box the width of the layout.
    assert!(
        rule_body(&css, ".document-minimap-preview {").contains("position: relative;"),
        "the clone must stay the containing block for a document's absolutely positioned parts"
    );
    assert!(
        !rule_body(&css, ".document-minimap-preview {").contains("transform-origin"),
        "the scale is the frame's now, so the clone should not keep a transform origin"
    );
    // The slide is a transform, not `top`: the lane moves every frame, and as a layout property `top` makes the browser re-lay-out the page to move it — 128ms worst frame on a 4MB glossary against 44ms, the no-rail floor.
    assert!(
        css.contains("  will-change: transform;"),
        "the thumbnail lane must be promoted for its transform, not for `top`"
    );
    // The reader renders the whole document up front, so it must NOT use content-visibility, which flashes blocks blank and jumps the minimap box.
    assert!(
        !css.contains("content-visibility: auto"),
        "the reader must render in full (no content-visibility) so scrolling matches the web"
    );
    // Same invariant from the other side: the rail is chrome, so its column is exactly the rail plus the lead-in, and no dead strip can open up between the page's right border and the rail, or past it.
    assert_contains(
        css,
        "--reader-minimap-column: calc(var(--minimap-width) + var(--reader-minimap-gap));",
    );
    assert_contains(css, "width: var(--minimap-width);");

    // The rail is the only thing showing position while it is there, so the native bar is hidden — and has to come back when it isn't. The two branches must stay apart: `scrollbar-width` anywhere on the element would kill the ::-webkit-scrollbar rules the visible branch is built from.
    assert_contains(
        css,
        ".reader-shell.has-minimap {\n  scrollbar-width: none;\n}",
    );
    // The thumb is inset by a transparent border with the fill clipped inside it; a bare width would put it flush against the card's border and corners. How deep the inset goes is a property the pointer shrinks, so the thumb thickens under an aim.
    assert_contains(
        css,
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb",
    );
    assert_contains(
        css,
        "border: var(--lt-scroll-thumb-inset) solid transparent;\n  background-clip: padding-box;",
    );
    // Keyed off the renderer's class, never :has() — scrollbar styles do not re-resolve when a :has() match flips, so the bar outlives the rail.
    assert!(
        !css.contains(":has(.document-minimap) .reader-shell::-webkit-scrollbar"),
        "scrollbar visibility must not hang off :has()"
    );
    assert_contains(
        &app_shell_page(),
        "app.classList.toggle('has-minimap', Boolean(html));",
    );

    // The corner overlay paints chrome over the card's square corner and masks the arc back out. The mask must be unconditional: on a rule only some states match, the rest render a plain block in the corner.
    let corner = css
        .split(".reader-corner-tr {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("stylesheet defines .reader-corner-tr");
    assert!(
        corner.contains("mask-image: radial-gradient(circle at 0 100%"),
        "the corner's mask must sit on its base rule: {corner}"
    );
    // And it follows the card in when the rail takes a column beside it.
    assert!(
        corner.contains("right: calc(var(--reader-gutter) + var(--reader-minimap-column));"),
        "the corner must track the card's right edge: {corner}"
    );
    assert!(
        !css.contains(
            ".reader-shell {\n  background: var(--lt-markdown-background);\n  scrollbar-width: none;"
        ),
        "scrollbar-width must not sit on the base rule, or the thin bar can never be styled"
    );
}

#[test]
fn an_undrawn_diagram_does_not_spin_in_the_rail() {
    let css = reading_mode_css();

    // The rail's copy is a clone of `.document-body` keeping its classes, so every rule that paints an undrawn diagram matches inside it — the spinner included. A pseudo-element survives stripMinimapClone's removal of nodes, so only a rule reaches it.
    assert_contains(
        css,
        ".document-minimap-preview pre.mermaid::after {\n  content: none;\n}",
    );
    // The block itself must stay in the copy: its source text is transparent in the page and is the only thing holding the block at the height the real one has.
    assert_contains(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]) {",
    );
    let undrawn = rule_body(
        css,
        ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-mermaid-render=\"failed\"]) {",
    );
    assert!(
        undrawn.contains("color: transparent;"),
        "an undrawn diagram's source must stay laid out and unreadable, not removed: {undrawn}"
    );
    assert!(
        !css.contains(".document-minimap-preview pre.mermaid {\n  display: none;"),
        "hiding the block in the copy would collapse the rail's height for it"
    );
}

#[test]
fn reading_mode_css_keeps_markdown_and_code_ready_for_theme_tokens() {
    let css = reading_mode_css();

    for rule in [
        ".document-body code {",
        "background: var(--lt-editor-inline-code-background);",
        "color: var(--lt-editor-inline-code-foreground);",
        ".document-body pre {",
        "background: var(--lt-editor-code-background);",
        "color: var(--lt-editor-code-foreground);",
        ".document-body pre code {",
        "background: transparent;",
        "color: inherit;",
        ".document-body .syn-comment",
        "color: var(--lt-syntax-comment);",
        ".document-body .syn-keyword",
        "color: var(--lt-syntax-keyword);",
        ".document-body .syn-string",
        "color: var(--lt-syntax-string);",
        ".document-body .syn-numeric",
        "color: var(--lt-syntax-number);",
        ".document-body .syn-function",
        "color: var(--lt-syntax-function);",
        ".document-body .syn-type",
        "color: var(--lt-syntax-type);",
        ".document-body .syn-variable",
        "color: var(--lt-syntax-variable);",
        ".document-body .syn-punctuation",
        "color: var(--lt-syntax-punctuation);",
        ".document-body .syn-inserted",
        "background: var(--lt-syntax-inserted-background);",
        "color: var(--lt-syntax-inserted);",
        ".document-body .syn-deleted",
        "background: var(--lt-syntax-deleted-background);",
        "color: var(--lt-syntax-deleted);",
        ".document-body .syn-changed",
        "background: var(--lt-syntax-changed-background);",
        "color: var(--lt-syntax-changed);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn reading_mode_css_keeps_code_surfaces_readable_in_light_and_dark() {
    let css = reading_mode_css();

    for theme in [ResolvedTheme::Light, ResolvedTheme::Dark] {
        for foreground in [
            "--lt-syntax-foreground",
            "--lt-syntax-comment",
            "--lt-syntax-keyword",
            "--lt-syntax-string",
            "--lt-syntax-number",
            "--lt-syntax-function",
            "--lt-syntax-variable",
            "--lt-syntax-type",
            "--lt-syntax-operator",
            "--lt-syntax-punctuation",
            "--lt-editor-inline-code-foreground",
        ] {
            let background = if foreground == "--lt-editor-inline-code-foreground" {
                "--lt-editor-inline-code-background"
            } else {
                "--lt-syntax-background"
            };
            assert_contrast_at_least(css, theme, foreground, background, 4.5);
        }

        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-foreground",
            "--lt-focus-selection-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-inserted",
            "--lt-syntax-inserted-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-deleted",
            "--lt-syntax-deleted-background",
            4.5,
        );
        assert_contrast_at_least(
            css,
            theme,
            "--lt-syntax-changed",
            "--lt-syntax-changed-background",
            4.5,
        );
    }
}

#[test]
fn the_page_ends_above_the_floating_bar() {
    let css = reading_mode_css();

    // The bar floats over the foot of the page, so the page has to stop short of it — otherwise the last thing on the page sits underneath, which the Previous/Next pager makes obvious by being both last and a target.
    assert_contains(
        css,
        "  padding-bottom: calc(var(--reader-content-pad) + var(--reader-toolbar-space, 0px));",
    );
    // Room only while the bar is up: no bar, no gap at the bottom of the page.
    assert_contains(css, "  --reader-toolbar-space: 0px;");
    assert_contains(
        css,
        "body:has(#readerToolbar:not([hidden])) {\n  --reader-toolbar-space: 52px;\n}",
    );
    // The pager's own top margin still clears the app bar; this is added below it, not instead of it.
    assert_contains(css, "margin-top: var(--app-bar-height);");
}

// Monaco sizes the line-number gutter to fit the widest number and right-aligns the numbers in it, so at five digits — its minimum width — the number's left edge lands exactly on the page frame's border and the two touch. The stand-off has to be a transform: the gutter's width is something Monaco measures and re-lays-out from, so anything that changes the box feeds back into its own layout.
#[test]
fn the_code_views_line_numbers_stand_off_the_page_frame() {
    let css = reading_mode_css();

    assert_contains(css, "  --cv-line-number-pad: 8px;");
    let numbers = rule_body(
        css,
        ".code-view-monaco .monaco-editor .margin-view-overlays .line-numbers {",
    );
    assert_contains(numbers, "transform: translateX(var(--cv-line-number-pad));");
    // Not padding or width — see above.
    assert!(
        !numbers.contains("padding") && !numbers.contains("width:"),
        "the stand-off must not change the box Monaco measures: {numbers}"
    );
}

// The square drawn before a color in the source is a mark, not a control: the color picker's hover participant is not in the vendored bundle, so a click on it does nothing. Monaco's own style promises otherwise with a pointer, and a hand over something that will not respond is the app lying — in a view that stands behind a padlock at that.
#[test]
fn the_code_views_color_squares_do_not_promise_a_picker() {
    let css = reading_mode_css();

    let square = rule_body(
        css,
        ".code-view-monaco .monaco-editor .colorpicker-color-decoration {",
    );
    assert_contains(square, "cursor: text;");
    // The hairline around it is the editor's and stays: it is what keeps a white or a black swatch visible against the editor's own background, on every theme.
    assert!(
        !square.contains("border"),
        "the square's hairline is the editor's, not ours: {square}"
    );
}

// The minimap rail is chrome, not page: the shell's grain runs behind it. Monaco's minimap canvas paints only the pixels its glyphs land in — it fills no background of its own — so anything opaque behind the rail is something of ours, and a page fill crossing into it is what makes the rail read as page-colored. Every layer carrying that color has to stop at the page frame's right border.
#[test]
fn the_code_views_minimap_rail_shows_the_shells_grain() {
    let css = reading_mode_css();
    let frame_edge = "calc(var(--cv-minimap-width, 0px) + var(--cv-minimap-standoff))";

    // The shell holds no fill of its own — it spans the rail as well as the page.
    let shell = rule_body(css, ".reader-shell.code-view-monaco-shell {");
    assert_contains(shell, "background: transparent;");
    // It is painted by ::before instead, which ends where the frame's border is drawn.
    let fill = rule_body(css, ".reader-shell.code-view-monaco-shell::before {");
    assert_contains(fill, &format!("inset: 0 {frame_edge} 0 0;"));
    assert_contains(fill, "background: var(--lt-syntax-background);");
    // Nor does either box of Monaco's that carries it: the editor's root, and the lines layer, whose 16,777,216px square is bounded only by the guard around the editor.
    let editor = rule_body(css, ".code-view-monaco .monaco-editor,");
    assert_contains(editor, ".monaco-editor .monaco-editor-background {");
    assert_contains(editor, "background-color: transparent;");
    // And neither does the edge wash, which would otherwise put the page's color back under the top and bottom of the map. The frame's own measure and nothing else: the border it is drawn with is reserved by the fade's own transparent one, which is snapped to device pixels where a spacing value is not.
    let fade = rule_body(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
    assert_contains(
        fade,
        "margin-right: calc(var(--cv-minimap-width, 0px) + var(--cv-minimap-standoff));",
    );
    // Monaco's own scrolled-content shadow spans the editor's whole top edge, the map included; over the rail it read as a smudge on the chrome. The theme turns it off, and widget shadows with it.
    let html = app_shell_page();
    assert!(html.contains("'scrollbar.shadow': '#00000000',"));
    assert!(html.contains("'widget.shadow': '#00000000',"));
}

#[test]
fn the_map_takes_the_column_the_minimap_is_not_using() {
    let html = app_shell_page();
    let css = reading_mode_css();

    // The minimap hides in graph view, but its track is a fixed width and stays reserved — leaving an empty strip down the right of the canvas that reads as a rendering fault. Column 4 is the gutter and stays: the map is held off the window frame the way the page is.
    assert!(css.contains("grid-column: 2 / 4;"));
    assert!(html.contains(
        "document.documentElement.dataset.graphView = graphViewOpen ? 'true' : 'false';"
    ));
    assert!(css.contains(":root[data-graph-view=\"true\"] .reader-toolbar,"));
    // The floating bar has to be measured against the same width or it centers on the page's middle and sits visibly left of the map's.
    assert!(css.contains(":root[data-graph-view=\"true\"] .reader-loading {"));
    assert!(css.contains(":root[data-graph-view=\"true\"] .reader-edge-fade {"));

    // And the chrome that draws the top of the card has to reach the map's right edge, not the page's. Both the bar's divider and the top-right arc are positioned off the minimap column, so the column closes in this view rather than each of them learning about the map: the stroke used to stop a rail's width short and the arc turned down in mid-air over the top of the canvas.
    assert_contains(
        css,
        ":root[data-graph-view=\"true\"] > body {\n  --reader-minimap-column: 0px;\n}",
    );
    // Set on `body`, where the rule that opens the column sets it. A custom property on an element beats one inherited from :root, however specific the :root selector is — the override would simply never apply.
    let opens = css
        .find("body:has(.document-minimap) {")
        .expect("stylesheet opens the minimap column on body");
    let closes = css
        .find(":root[data-graph-view=\"true\"] > body {")
        .expect("stylesheet closes it again in graph view");
    assert!(
        opens < closes,
        "the graph-view override has to come after the rule it overrides"
    );
}

#[test]
fn anything_that_hides_itself_is_allowed_to() {
    // `display` on a class outranks the user agent's `[hidden] { display: none }`, so an element that sets one and relies on the other is simply always visible. That is how the floating toolbar came to sit over the home screen: the attribute was set, the rule ignored it, and nothing failed.
    let html = app_shell_page();
    let css = reading_mode_css();

    for element in html.split('<').skip(1) {
        let Some(tag) = element.split('>').next() else {
            continue;
        };
        // Only elements that start hidden — the ones a stale `display` would strand on screen.
        if !(tag.ends_with(" hidden") || tag.contains(" hidden ")) {
            continue;
        }
        let Some(classes) = tag
            .split_once("class=\"")
            .and_then(|(_, rest)| rest.split_once('"').map(|(classes, _)| classes.to_string()))
        else {
            continue;
        };
        for class in classes.split_whitespace() {
            let rule = format!(".{class} {{");
            let Some(body) = css
                .split(&rule)
                .nth(1)
                .and_then(|rest| rest.split('}').next())
            else {
                continue;
            };
            if !body.contains("display:") {
                continue;
            }
            let escape = format!(".{class}[hidden]");
            assert!(
                css.contains(&escape),
                ".{class} sets `display`, so the `hidden` attribute on it does \
                 nothing. Add `{escape} {{ display: none; }}`."
            );
        }
    }
}

#[test]
fn a_diagrams_own_drawing_is_moved_and_its_button_icons_are_not() {
    // A drawn diagram is a block holding two things that are both SVG: its own drawing, and the icons inside the corner buttons. Every rule that sizes or moves the drawing has to say `> svg`, because the descendant form takes the icons too — they fly to the pan offset and the buttons are left empty, which is what shipped the first time this was written.
    let css = reading_mode_css();
    // The full-window stage is the same shape and carries the same buttons, so it is held to the same rule.
    for block in [
        ".document-body pre.mermaid[data-processed=\"true\"]",
        ".diagram-stage",
    ] {
        for rule in css.split(block).skip(1) {
            let Some(selector) = rule.split('{').next() else {
                continue;
            };
            // Only the rules that reach an SVG inside the block.
            if !selector.contains("svg") {
                continue;
            }
            assert!(
                selector.contains("> svg"),
                "`{block}{selector}` reaches every SVG in the block, including the \
                 corner buttons' icons. Say `> svg` so it is the drawing alone."
            );
        }

        // And the rules themselves are still here to be checked.
        assert_contains(css, &format!("{block} > svg"));
        assert_contains(css, &format!("{block}.is-moved > svg"));
    }
}

#[test]
fn the_flowchart_canvas_is_dragged_by_the_stage_not_by_its_scrollbars() {
    // A diagram smaller than the pane has nothing to scroll, so scroll-panning did nothing for exactly the diagrams most likely to be hidden under the picker. The stage is moved instead, and the handles ride along because the overlay is inside it.
    let css = reading_mode_css();

    assert_contains(
        &css,
        "transform: translate(var(--flow-pan-x, 0px), var(--flow-pan-y, 0px));",
    );
    // The sheet's own corners: the panes fill it, so it has to clip them.
    let sheet = css
        .split(".flow-sheet {")
        .nth(1)
        .expect("the flowchart sheet has a rule");
    let sheet = &sheet[..sheet.find('}').expect("the rule closes")];
    assert!(
        sheet.contains("border-radius") && sheet.contains("overflow: hidden"),
        "the flowchart sheet must clip its rounded corners: {sheet}"
    );
}

#[test]
fn anything_marked_hidden_is_actually_hidden() {
    // A rule that matches `[hidden]` and then sets a `display` of its own beats the browser's own `[hidden] { display: none }` and leaves the thing on the page — laid out, invisible, and still taking clicks. That is how a stray comment between two selectors put the glossary backdrop across the bottom fifth of the home screen and ate every link under it.
    let css = reading_mode_css();

    for rule in css.split('}') {
        let Some((selector, body)) = rule.split_once('{') else {
            continue;
        };
        // Only the selector itself, never a comment sitting above it. Comments are cut out of the selector rather than cut off before it: a comment *between* two selectors is exactly how this went wrong, and reading only what follows it would hide the half that matters.
        let mut selector = selector.to_string();
        while let Some(opens) = selector.find("/*") {
            let Some(shuts) = selector[opens..].find("*/") else {
                break;
            };
            selector.replace_range(opens..opens + shuts + 2, " ");
        }
        let selector = selector.trim();
        // `:not([hidden])` is the opposite claim — it matches what is showing.
        if !selector.replace(":not([hidden])", "").contains("[hidden]") {
            continue;
        }
        let display = body
            .split(';')
            .map(str::trim)
            .find(|line| line.starts_with("display:"));
        assert_eq!(
            display,
            Some("display: none"),
            "`{selector}` matches a hidden element but sets {display:?}"
        );
    }
}

#[test]
fn every_box_shadow_is_a_stroke_a_ring_or_a_recess() {
    // Nothing in the app casts a smooth blur: a floating surface throws the dot halftone below instead. What is left in a `box-shadow` draws an edge, a focus ring, or the one recess in the reader's tool bar.
    const DRAWN_WITH: &[&str] = &[
        "var(--lt-shadow-raised)",
        "var(--lt-shadow-inset)",
        "var(--lt-shadow-hairline)",
        "var(--lt-shadow-hairline-strong)",
        "var(--lt-shadow-focus)",
        "var(--lt-shadow-ring)",
        "var(--lt-shadow-edge-strong)",
        "var(--lt-shadow-edge-accent)",
        "var(--lt-shadow-edge-link)",
        "none",
    ];
    let css = reading_mode_css();
    for (at, _) in css.match_indices("box-shadow:") {
        let value = css[at + "box-shadow:".len()..]
            .split(';')
            .next()
            .expect("a declaration should end")
            .trim();
        assert!(
            DRAWN_WITH.contains(&value),
            "box-shadow: {value} is a hand-written or blurred shadow; the app's shadow is \
             the dot halftone, and the rest of this list is strokes"
        );
    }
}

#[test]
fn every_floating_surface_throws_the_dot_halftone() {
    let css = reading_mode_css();
    // One rule for all of them, so a new panel cannot pick a different shadow.
    for surface in [
        ".app-overflow-panel::before,",
        ".context-menu::before,",
        ".rename-box::before,",
        ".update-panel::before,",
        ".app-toast::before,",
        ".flow-menu::before,",
        ".link-hover-tip::before,",
        ".block-drag-ghost::before,",
        ".find-bar::before,",
        ".leaf-sheet::before {",
    ] {
        assert_contains(css, surface);
    }
    let halftone = rule_body(css, ".app-overflow-panel::before,");
    assert_contains(
        halftone,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(halftone, "--lt-grain-dot: var(--lt-grain-dot-strong);");
    // The second mask layer punches the surface's own box out, or the dots land on its face: a negative-layer child paints above its parent's background. Subtract, not xor -- xor is the punch inside out, and a stale one would win by coming last.
    assert_contains(halftone, "mask-composite: subtract;");
    assert_contains(halftone, "-webkit-mask-composite: source-out;");
    assert!(
        !halftone.contains("mask-composite: exclude;")
            && !halftone.contains("-webkit-mask-composite: xor;"),
        "xor/exclude is the punch inside out"
    );
    assert_contains(halftone, "z-index: var(--lt-z-below);");
}

#[test]
fn the_sheet_scrim_dims_and_dots_the_page_behind_it() {
    let scrim = rule_body(reading_mode_css(), ".lt-backdrop {");
    assert_contains(scrim, "background-color: var(--lt-tint-backdrop);");
    assert_contains(
        scrim,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(scrim, "background-attachment: fixed;");
}

#[test]
fn reduce_motion_is_answered_once_and_won_back_by_name() {
    let css = reading_mode_css();

    // One blanket rule instead of a block per component, which is how fifteen of the eighteen moving transitions came to answer this setting nowhere.
    let blanket = rule_body(
        css,
        "@media (prefers-reduced-motion: reduce) {\n  *,\n  *::before,\n  *::after {",
    );
    // `!important` or nothing: `*` has no specificity, so every class rule in the file outranks it and the block would change nothing on screen.
    assert_contains(
        blanket,
        "transition-duration: var(--lt-duration-0) !important;",
    );
    assert_contains(
        blanket,
        "animation-duration: var(--lt-duration-0) !important;",
    );
    // Never the shorthand — it sets `animation-name: none`, and the glossary sheet's waiting panel and the table's edge bands both reach their resting state through an animation rather than despite one.
    assert!(
        !blanket.contains("animation:") && !blanket.contains("transition:"),
        "the blanket rule must cut durations, not whole animations: {blanket}"
    );
    // And never the iteration count: pinned to 1, every spinner turns once and stops, which reads as a hang.
    assert!(
        !blanket.contains("animation-iteration-count"),
        "pinning the iteration count stops every spinner after one turn: {blanket}"
    );

    // What must keep moving wins it back on specificity, both being important. One rule for every .lt-spinner: six elements carry the class and three had no answer of their own.
    for won_back in [
        ".lt-spinner {\n    animation-duration: var(--lt-duration-1600) !important;",
        ".update-alert-dot.is-downloading {\n    animation-duration: var(--lt-duration-1600) !important;",
        ".library-sync.is-busy .lt-icon {\n    animation-duration: var(--lt-duration-2400) !important;",
    ] {
        assert_contains(css, won_back);
    }
    assert_contains(
        rule_body(
            css,
            ".document-body pre.mermaid:not([data-processed=\"true\"]):not([data-diagram-wait=\"far\"])::after {\n    animation-duration:",
        ),
        "animation-duration: var(--lt-duration-1600) !important;",
    );

    // The edge bands run on the table's own sideways scroll, not a clock. A zero duration lands a scroll-driven animation on its last keyframe and holds it there — `opacity: 0` for the ahead band — so the cut edge would go unmarked on exactly the tables that need it. `auto` hands progress back to the scroll.
    assert_contains(
        css,
        ".table-lane::before,\n  .table-lane::after {\n    animation-duration: auto !important;\n  }",
    );

    // The pager skeleton keeps its own block: the blanket rule carries no opacity and the bars have none, so bars stopped at full strength read as loaded content.
    let skeleton = rule_body(
        css,
        ".docs-pager-label-skeleton,\n  .docs-pager-title-skeleton {",
    );
    assert_contains(skeleton, "animation: none;");
    assert_contains(skeleton, "opacity: var(--lt-opacity-55);");

    // The blocks the blanket rule replaced are gone rather than left to say the same thing twice.
    for gone in [
        ".library-shell.library-narrow .library-pane {\n    transition: none;",
        ".library-sync.is-leaving {\n    transition: none;",
        ".app-toast {\n    transition: none;",
        ".reader-loading-spinner {\n    animation-duration:",
        ".document-minimap-spinner {\n    animation-duration:",
        ".glossary-sheet-spinner {\n    animation-duration:",
    ] {
        assert!(
            !css.contains(gone),
            "the blanket rule covers this now, so it should be gone: {gone}"
        );
    }
}

#[test]
fn a_curve_says_which_way_a_move_is_going() {
    let css = reading_mode_css();

    // Material Design 3's three, at its values: arriving, leaving, and staying put while it changes shape or place.
    for curve in [
        "--lt-ease-emphasized: cubic-bezier(0.2, 0, 0, 1);",
        "--lt-ease-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);",
        "--lt-ease-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);",
        // Arriving with spring: runs about a tenth past its mark and settles back.
        "--lt-ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);",
        // Motion off is a duration like any other, so the reduce rule reads a token.
        "--lt-duration-0: 0ms;",
    ] {
        assert_contains(css, curve);
    }
    // The drag-tuned curve stays on the sheet's rise; only its dismiss changes.
    assert_contains(css, "--lt-ease-sheet: cubic-bezier(0.32, 0.72, 0, 1);");
}

#[test]
fn every_move_is_drawn_on_the_curve_its_direction_asks_for() {
    let css = reading_mode_css();

    // A direction per curve means the transition is declared twice: the base rule is where a thing rests and where it goes back to, so it carries the exit, and the state class carries the way in. One transition serving both directions cannot honor the rule.
    for (selector, expected) in [
        (
            ".lt-backdrop {",
            "transition: opacity var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".lt-backdrop.open {",
            "transition: opacity var(--lt-duration-200) var(--lt-ease-decelerate);",
        ),
        (
            ".leaf-sheet {\n  left: 0;",
            "transition: transform var(--lt-duration-200) var(--lt-ease-accelerate);",
        ),
        // The rise keeps the curve tuned against a real drag, which is the gesture it has to feel continuous with.
        (
            ".leaf-sheet.open {",
            "transition: transform var(--lt-duration-260) var(--lt-ease-sheet);",
        ),
        (
            ".app-toast {",
            "transition: opacity var(--lt-duration-120) var(--lt-ease-accelerate), transform var(--lt-duration-120) var(--lt-ease-accelerate);",
        ),
        (
            ".app-toast.is-shown {",
            "transition: opacity var(--lt-duration-200) var(--lt-ease-decelerate), transform var(--lt-duration-200) var(--lt-ease-decelerate);",
        ),
        (
            ".library-shell.library-narrow .library-pane {",
            "transition: transform var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".library-shell.library-narrow.library-overlay .library-pane {",
            "transition: transform var(--lt-duration-220) var(--lt-ease-decelerate);",
        ),
        (
            ".flow-sheet {",
            "transition: transform var(--lt-duration-160) var(--lt-ease-accelerate), opacity var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            ".flow-sheet.open {",
            "transition: transform var(--lt-duration-220) var(--lt-ease-sheet), opacity var(--lt-duration-220) var(--lt-ease-decelerate);",
        ),
        // Neither arriving nor leaving: the strip rearranges around a tab, a caret turns in place, and a block steps aside without leaving the page.
        (
            ".tab {",
            "transition: max-width var(--lt-duration-120) var(--lt-ease-emphasized), transform var(--lt-duration-120) var(--lt-ease-emphasized);",
        ),
        (
            "body.is-block-dragging .document-body [data-src-start] {",
            "transition: transform var(--lt-duration-140) var(--lt-ease-emphasized);",
        ),
        (
            ".document-body .document-outline-summary::before {",
            "transition: transform var(--lt-duration-150) var(--lt-ease-emphasized);",
        ),
    ] {
        assert_contains(rule_body(css, selector), expected);
    }

    // The sheet's drag exemption ties with `.open` on specificity, so it wins only by coming after it — the drag has to track the pointer exactly.
    let open = css
        .find(".leaf-sheet.open {")
        .expect("the sheet has an open state");
    let dragging = css
        .find(".leaf-sheet.is-dragging {")
        .expect("the sheet exempts its own drag");
    assert!(
        open < dragging,
        "the drag exemption must follow .open to win the tie"
    );

    // A hover has no direction, so it keeps the symmetric curve. Anything that started saying `ease-emphasized` here would be claiming a hover arrives.
    for hover in [
        ".block-gutter .block-insert-option {",
        ".document-body pre > .code-copy {",
        ".mermaid-zoom {",
    ] {
        assert_contains(rule_body(css, hover), "var(--lt-ease)");
    }
}

#[test]
fn the_normal_width_library_toggle_rides_the_motion_rail() {
    let css = reading_mode_css();

    // The pane's grid track, the bar's lead and the reader divider's left end all read --library-rail-width, so one var write moves the three of them — and the toggle's body classes carry the transitions: opening springs past its mark on the overshoot curve, closing slams on the accelerate one, and the settle class carries the close's bounce-out and settle-shut legs.
    for (selector, expected) in [
        (
            "body.is-library-opening .library-shell {",
            "transition: grid-template-columns var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .library-shell {",
            "transition: grid-template-columns var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .library-shell {",
            "transition: grid-template-columns var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
        (
            "body.is-library-opening .app-bar-lead {",
            "transition: width var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .app-bar-lead {",
            "transition: width var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .app-bar-lead {",
            "transition: width var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
        (
            "body.is-library-opening .app-bar::after {",
            "transition: left var(--lt-duration-220) var(--lt-ease-overshoot);",
        ),
        (
            "body.is-library-closing .app-bar::after {",
            "transition: left var(--lt-duration-160) var(--lt-ease-accelerate);",
        ),
        (
            "body.is-library-settling .app-bar::after {",
            "transition: left var(--lt-duration-120) var(--lt-ease-decelerate);",
        ),
    ] {
        assert_contains(rule_body(css, selector), expected);
    }

    // The wide grid spends the rail width itself, so the transition above has one property to interpolate; the closed state is the same rule with the var at 0px, not a second track list.
    assert_contains(
        rule_body(css, "\n.library-shell {"),
        "grid-template-columns: var(--library-rail-width, 240px) minmax(0, 1fr) var(--reader-minimap-column) var(--reader-gutter);",
    );
    assert!(!css.contains(".library-shell.library-closed {\n  grid-template-columns:"));

    // Never the rail: registering it as an inherited length and transitioning it off :root crashed the whole app in this web view — library-sidebar-motion's phase 0 measured it, twice. What killed it was a track relaying the window out on every frame, so the ban is on this property rather than on registration itself; the scrollbar's two are registered and drive paint only, measured in the same window (scrollbar-fade-and-hover, phase 0).
    assert!(!css.contains("@property --library-rail-width"));

    // The reader divider's left end spends the bare rail value — the same number the grid track spends — so its left transition and the grid's interpolate the same span on the same curve and the line stays attached to the pane's corner arc on every frame. A gutter floor here changed the span and detached them near zero, right where the close's bounce lives.
    assert_contains(
        rule_body(css, ".app-bar::after {"),
        "left: calc(var(--library-rail-width, 0px) + var(--lt-radius-md) - 1px);",
    );
    // The closed resting place is its own rule, landing in the same layout pass as the pane's closed corner rule, so the line and the arc jump to rest together.
    assert_contains(
        rule_body(css, ".app-bar:not(.has-rail)::after {"),
        "left: calc(var(--reader-gutter) + var(--lt-radius-md) - 1px);",
    );
    assert!(!css.contains(".app-bar.has-rail::after {"));

    // The pane's list clips sideways: rows truncate themselves, so a horizontal scrollbar on a narrow pane is noise — and it popped in and out while the pane animates.
    let scroll = rule_body(css, "\n.library-scroll {");
    assert_contains(scroll, "overflow-y: auto;");
    assert_contains(scroll, "overflow-x: hidden;");

    // The pane's contents fade with the travel — out over the close, and back in at the same pace on the open, where an animation is needed because the bands were display:none while closed.
    let fade_out = rule_body(css, "body.is-library-closing .library-header,");
    assert_contains(fade_out, "opacity: 0;");
    assert_contains(
        fade_out,
        "transition: opacity var(--lt-duration-260) var(--lt-ease);",
    );
    assert_contains(fade_out, "body.is-library-settling .library-scroll {");
    let fade_in = rule_body(css, "body.is-library-opening .library-header,");
    assert_contains(
        fade_in,
        "animation: leaf-document-arrive var(--lt-duration-260) var(--lt-ease);",
    );
    assert_contains(fade_in, "body.is-library-opening .library-scroll {");

    // A grid item's min-width is its content, which would hold the shrinking track open; the pane itself still never clips, because the corner arc on its right edge is real geometry.
    assert_contains(rule_body(css, "\n.library-pane {"), "min-width: 0;");

    // No component Reduce Motion block: the file's blanket rule zeroes these transitions like every other, so each motion rule appears exactly once.
    assert_eq!(
        css.matches("body.is-library-opening .library-shell {")
            .count(),
        1
    );
    assert_eq!(
        css.matches("body.is-library-closing .library-shell {")
            .count(),
        1
    );
}

#[test]
fn the_macs_three_dots_are_ours_and_take_the_themes_colors() {
    let css = reading_mode_css();

    // The bar reserves nothing for Apple's dots any more. It used to hold 86px at the left zone whether the bar had the room or not, because a native view pinned to the window cannot fold — and with the zone sized from its content that was a quarter of a narrow bar spent on nothing, pushing the tab strip right.
    assert!(
        !css.contains("--app-bar-mac-dots"),
        "the bar must not reserve room for dots it draws itself"
    );

    // Round, and in the theme's own stop, careful and good — never three fixed hex values, which was the one thing Apple's dots got wrong.
    let dot = rule_body(css, ".mac-frame .window-control {");
    assert_contains(dot, "border-radius: 50%;");
    assert_contains(dot, "background: var(--lt-warning);");
    // No mark until the pointer is on it, the way a Mac's has none.
    assert_contains(dot, "color: transparent;");
    assert_contains(
        rule_body(css, ".mac-frame .window-control-close {"),
        "background: var(--lt-danger);",
    );
    assert_contains(
        rule_body(css, ".mac-frame #winMaximize {"),
        "background: var(--lt-success);",
    );
    // Apple's order out of markup that runs minimize, maximize, close: only the close moves.
    assert_contains(
        rule_body(css, ".mac-frame .window-control-close {"),
        "order: -1;",
    );
    // Stacked in the chevron menu they read top to bottom, so that order turns over: zoom at the top, close at the foot and farthest from the pointer that opened it.
    assert_contains(
        rule_body(css, ".mac-frame .app-overflow-panel #winMaximize {"),
        "order: -1;",
    );
    assert_contains(
        rule_body(
            css,
            ".mac-frame .app-overflow-panel .window-control-close {",
        ),
        "order: 1;",
    );
    // Hovering shows the mark in the bar's own color, and the dot keeps its own — the square Windows chip must not take over.
    assert_contains(
        rule_body(css, ".mac-frame .window-control:hover {"),
        "color: var(--lt-surface);",
    );

    // The flush close chip owns the window's corner only where we are the ones drawing it; on a Mac that end of the bar is an ordinary toolbar.
    assert_contains(css, ".frameless:not(.mac-frame) .app-trailing {");
    assert!(
        !css.contains("\n.frameless .app-trailing {"),
        "the frameless trailing inset must exempt the Mac shell"
    );
}

#[test]
fn the_spacing_scale_is_thirteen_even_steps() {
    let css = reading_mode_css();

    // Every whole pixel from 1 to 14 and then a scatter is not a scale — it cannot be picked from, so a value gets chosen by eye and frozen as a token. Thirteen steps, 2px apart to 16, 4px to 24, then 32 and 48.
    let mut defined: Vec<u32> = css
        .lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("--lt-space-")?;
            let (name, value) = rest.split_once(':')?;
            value.trim().strip_suffix("px;")?;
            name.parse::<u32>().ok()
        })
        .collect();
    defined.sort_unstable();
    defined.dedup();
    assert_eq!(
        defined,
        vec![1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48],
        "the spacing scale has drifted off its steps"
    );

    // The 1px hairline is the width of a line rather than a step of the scale; everything above it is even, so no rule can land on an odd pixel.
    for step in defined.iter().skip(1) {
        assert_eq!(step % 2, 0, "--lt-space-{step} is not even");
    }

    // And nothing spends a step the table does not define, which is the half `check-tokens` cannot see: it compares the two generated files, not what the rules ask for.
    let mut used: Vec<u32> = Vec::new();
    let mut rest = css;
    while let Some(at) = rest.find("var(--lt-space-") {
        rest = &rest[at + "var(--lt-space-".len()..];
        let name = &rest[..rest.find(')').expect("the token reference closes")];
        used.push(name.parse().expect("a spacing token is named by its value"));
    }
    for step in used {
        assert!(
            defined.contains(&step),
            "--lt-space-{step} is spent but not defined"
        );
    }
}

#[test]
fn every_icon_sits_the_same_distance_from_its_label() {
    let css = reading_mode_css();

    // The commonest relationship in the interface — a small drawing, then the word for it — is one value everywhere, so a seventh control cannot pick its own out of the scale.
    for selector in [
        "\n.crumb-menu-item {",
        "\n.flow-menu-item {",
        "\n.library-file,\n.library-nav-folder {",
        "\n.reader-graph-legend {",
        "\n.primary-new {",
        "\n.library-sync {",
    ] {
        let rule = rule_body(css, selector);
        assert_contains(rule, "gap: var(--lt-space-6);");
    }

    // The one place it cannot land: the vault switcher and the name beside it are two controls sharing one pill, so each owes its own hover shape an edge and the joint between them is two 4px paddings plus the trail's seam.
    assert_contains(css, "padding: 0 var(--lt-space-4) 0 var(--lt-space-8);");
}

#[test]
fn the_first_run_bubble_never_takes_the_pointer() {
    let css = reading_mode_css();

    // The owner asked for this by name, on the built thing: the box is a message with nothing in it to press, so a pointer crossing it on the way somewhere else must not lose the words mid-sentence, and it must not stand between the pointer and whatever it is laid over. The bubble registers no listeners of its own either — see `the vault hint shows once, and being met is permanent` in the front-end check — and this is the half of the rule that lives in the stylesheet.
    let rule = rule_body(css, "\n.hint-bubble {");
    assert_contains(rule, "pointer-events: none;");
    // Over everything, and out of the layout: wedged into a row it would be pinched against the pane's edge, and nothing on screen may move to make room for it.
    assert_contains(rule, "position: fixed;");
    assert_contains(rule, "z-index: var(--lt-z-60);");

    // The chevron carries the box's own edge and fill rather than a second set, so the two cannot drift apart.
    let tail = rule_body(css, "\n.hint-bubble-tail {");
    assert_contains(tail, "background: var(--lt-surface-elevated);");
    assert_contains(
        tail,
        "border-left: var(--lt-stroke-1) solid var(--lt-border);",
    );

    // One placement class per side, each aiming the chevron at the edge that faces the target.
    for side in ["is-right", "is-left", "is-above", "is-below"] {
        assert_contains(css, &format!(".hint-bubble.{side} .hint-bubble-tail {{"));
    }
}

#[test]
fn the_confirmation_throws_the_shared_dot_shadow_rather_than_a_blur_of_its_own() {
    // Nothing in this app casts a smooth shadow: every floating surface is a name in one dot-lattice rule, and none of the shadow tokens is a cast shadow. A new surface growing its own `box-shadow` beside that rule is the drift this pins.
    let css = reading_mode_css();
    let shared = css
        .find(".app-overflow-panel::before,")
        .expect("the shared dot-shadow rule");
    let selectors = &css[shared..shared + css[shared..].find('{').expect("the rule opens")];
    assert_contains(selectors, ".confirm-dialog::before,");

    let dialog = rule_body(css, "\n.confirm-dialog {");
    assert!(
        !dialog.contains("box-shadow"),
        "the confirmation takes the shared lattice, not a shadow of its own"
    );
    // On the layer already named for a sheet over the sheets' own scrim, so it needs no new token.
    assert_contains(dialog, "z-index: var(--lt-z-41);");
}

/// Every `@media` block whose condition is about width, with the CSS inside it. Written by hand because the check is exactly "does any of these mention that screen".
fn width_media_blocks(css: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut rest = css;
    while let Some(at) = rest.find("@media") {
        let after = &rest[at..];
        let open = after.find('{').expect("a media block opens");
        if after[..open].contains("width") {
            let mut depth = 0usize;
            let mut end = open;
            for (offset, byte) in after[open..].bytes().enumerate() {
                if byte == b'{' {
                    depth += 1;
                } else if byte == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        end = open + offset;
                        break;
                    }
                }
            }
            blocks.push(&after[open..end]);
        }
        rest = &after[open..];
    }
    blocks
}

#[test]
fn the_start_screen_folds_on_its_own_width_and_never_on_the_windows() {
    // The library pane is a remembered width the reader column shrinks under, and it can be dragged to the window less the reader's minimum — so a 1160px window can leave this section 320px wide while an 880px one with the pane shut leaves it 720px. A window breakpoint would call both of those the same thing. One container query on the section sets the column count, and it is the only thing allowed to.
    let css = reading_mode_css();
    let column = rule_body(&css, "\n.reader-shell.empty {");
    assert_contains(column, "container-type: inline-size;");
    assert_contains(column, "container-name: home;");
    assert_contains(&css, "@container home (min-width: 600px) {");
    let grid = rule_body(&css, "\n.home-list-grid {");
    // One column until the query says two, so the fold and the column count are one number in one place.
    assert_contains(grid, "grid-template-columns: minmax(0, 1fr);");
    // The writing's own width, growing past it only where a path needs the room and never past the reader. Stretched to the reader it left two thin columns at opposite edges of an empty screen; held to its content it was narrower than the writing above it.
    assert_contains(grid, "width: max-content;");
    assert_contains(grid, "min-width: 100%;");
    assert_contains(
        grid,
        "max-width: max(100%, calc(100cqi - 2 * var(--reader-table-lane-inset)));",
    );
    // And the list fills its column, so the fill under the pointer ends where the list ends.
    assert_contains(
        rule_body(
            &css,
            "
.home-list {",
        ),
        "width: 100%;",
    );
    assert_contains(grid, "transform: translateX(-50%);");
    // Each list is a box of its own rather than a section of the writing, so nothing draws a rule across the screen above them.
    let card = rule_body(&css, "\n.home-list {");
    assert_contains(card, "border: var(--lt-stroke-1) solid var(--lt-border);");
    assert_contains(card, "border-radius: var(--lt-radius-lg);");
    // With nothing kept the screen is prod's own: the plain recent block, its own rules, its own color.
    assert_contains(
        rule_body(
            &css,
            "
.recent {",
        ),
        "border-top: var(--lt-stroke-1) solid var(--lt-navigation-recent-border);",
    );
    assert_contains(
        rule_body(
            &css,
            "
.recent button {",
        ),
        "overflow-wrap: anywhere;",
    );

    for block in width_media_blocks(&css) {
        for named in [".home-list", ".home-row", ".home-list-grid", ".empty-state"] {
            assert!(
                !block.contains(named),
                "a width media block names {named}; this screen measures itself"
            );
        }
    }
}

#[test]
fn a_home_lists_bar_and_edges_answer_the_scroll_not_the_pointer() {
    // Asked for by name: the bar is there while the list is moving and gone a moment after it stops. Never on hover — pointing at a list on the way somewhere else is not asking to be told how long it is.
    let css = reading_mode_css();
    let box_ = rule_body(&css, "\n.home-list-scroll {");
    // The bar's width is held whether or not there is one, so a list too short to need it keeps the same inset as the one beside it.
    assert_contains(box_, "scrollbar-gutter: stable;");
    assert!(
        !box_.contains("scrollbar-width:") && !box_.contains("scrollbar-color:"),
        "either of those silently kills every rule painting this box's bar"
    );
    assert!(
        !css.contains(".home-list-scroll:hover") && !css.contains(".home-list-scroll:focus-within"),
        "the bar is back on the pointer"
    );
    // The list has no bar of its own: it wears .leaf-scroll, so the shared one paints it, on the same class and the same timer as the pane, the reader and a wide table.
    assert!(
        !css.contains("--home-list-thumb") && !css.contains(".home-list-box.is-scrolling"),
        "the start screen keeps a private answer to the same question"
    );

    // The soft edge is the reader's own ramp to the surface the start screen paints. It takes no pointer events, and it stops short of the right edge — a wash laid over the bar would bury the thumb, which starts at that same edge.
    let fade = rule_body(&css, "\n.home-list-fade {");
    assert_contains(fade, "pointer-events: none;");
    assert_contains(fade, "inset: 0 var(--reader-scrollbar) 0 0;");
    // Neither edge until there is list past it: a soft top on a list sitting at its first row says something is above it that is not.
    assert_contains(fade, "--home-list-fade-top: 0px;");
    assert_contains(fade, "--home-list-fade-bottom: 0px;");
    assert_contains(
        fade,
        "background-size: 100% var(--home-list-fade-top), 100% var(--home-list-fade-bottom);",
    );
    assert_contains(fade, "background-position: 0 0, 0 100%;");
    assert_contains(
        rule_body(&css, "\n.home-list-box.has-above .home-list-fade {"),
        "--home-list-fade-top: var(--reader-edge-fade-depth);",
    );
    assert_contains(
        rule_body(&css, "\n.home-list-box.has-below .home-list-fade {"),
        "--home-list-fade-bottom: var(--reader-edge-fade-depth);",
    );
}

#[test]
fn every_bar_in_the_app_is_painted_only_while_its_box_is_moving() {
    // Five wearers, one answer: the library pane, a document with no picture down its side, a widened table's sideways bar, any box marked .leaf-scroll — the shape picker, the theme cards, a glossary entry and the flowchart's two panes among them — and the boxes a document brings, which have nowhere to carry a class.
    let css = reading_mode_css();
    const WEARERS: [&str; 5] = [
        ".leaf-scroll",
        ".library-scroll",
        ".reader-shell:not(.has-minimap)",
        ".table-lane > table",
        ".document-body :is(pre, pre > code, .math-display, .frontmatter, table)",
    ];
    // The block is nine rules and every wearer is in all of them, named here by the first selector of each. Six paint the bar; the three in the middle sit on the box and are the only place the thumb's color and inset come from, so a wearer in the pseudo rules alone reserves a 14px gutter and never draws anything in it — `--lt-scroll-thumb` is registered with an initial value of `transparent`, which looks exactly like the work not having been done.
    const RULES: [&str; 9] = [
        "\n.leaf-scroll::-webkit-scrollbar,",
        "\n.leaf-scroll::-webkit-scrollbar-track,",
        "\n.leaf-scroll,",
        "\n.leaf-scroll.is-scrolling,",
        "\n.leaf-scroll.is-pointing,",
        "\n.leaf-scroll::-webkit-scrollbar-thumb,",
        "\n.leaf-scroll::-webkit-scrollbar-thumb:vertical,",
        "\n.leaf-scroll::-webkit-scrollbar-thumb:horizontal,",
        "\n.leaf-scroll::-webkit-scrollbar-corner,",
    ];
    for rule in RULES {
        let block = rule_body(&css, rule);
        for wearer in WEARERS {
            assert!(
                block.contains(wearer),
                "{wearer} is missing from the rule opening `{}`, so it wears part of the bar and not the rest",
                rule.trim_start()
            );
        }
    }

    // At rest the thumb is painted in nothing at all. A scrollbar pseudo has no box of its own to fade, so what moves is a property the thumb rule reads — which is also why the bar's width is reserved either way and nothing on the page reflows when one appears.
    let resting = rule_body(&css, "\n.leaf-scroll,\n.library-scroll,");
    assert_contains(resting, "--lt-scroll-thumb: transparent;");
    let moving = rule_body(&css, "\n.leaf-scroll.is-scrolling,");
    assert_contains(moving, "--lt-scroll-thumb: color-mix(");
    let pointed = rule_body(&css, "\n.leaf-scroll.is-pointing,");
    assert_contains(pointed, "--lt-scroll-thumb: color-mix(");
    for wearer in WEARERS {
        assert_contains(resting, wearer);
        assert!(
            css.contains(&format!("\n{wearer}.is-scrolling,"))
                || css.contains(&format!("\n{wearer}.is-scrolling {{")),
            "{wearer} never gets the class the watcher stamps, so its bar can never come up"
        );
        // The second reason the bar is up: the pointer in that box's own gutter.
        assert!(
            css.contains(&format!("\n{wearer}.is-pointing,"))
                || css.contains(&format!("\n{wearer}.is-pointing {{")),
            "{wearer} never gets the class the pointer stamps, so aiming at its bar does nothing"
        );
        // Never the pointer. Asked for twice: a bar on hover is still a bar nobody asked for.
        assert!(
            !css.contains(&format!("{wearer}:hover::-webkit-scrollbar"))
                && !css.contains(&format!("{wearer}:focus-within::-webkit-scrollbar")),
            "{wearer} brings its bar back on the pointer"
        );
    }

    // Either standard scrollbar property silently kills every ::-webkit-scrollbar rule on the element it sits on. Only the two boxes meaning to draw no bar at all set one: the tab strip, and the reader while the picture down its side is up.
    assert!(
        !css.contains("scrollbar-color:"),
        "scrollbar-color kills every rule painting the bar it is set on"
    );
    assert_eq!(
        css.matches("scrollbar-width:").count(),
        2,
        "a third box took a standard scrollbar property, so its bar can never be painted at all"
    );
    assert_contains(rule_body(&css, "\n.tab-bar {"), "scrollbar-width: none;");
    assert_contains(
        rule_body(&css, "\n.reader-shell.has-minimap {"),
        "scrollbar-width: none;",
    );

    let thumb = rule_body(&css, "\n.leaf-scroll::-webkit-scrollbar-thumb,");
    assert_contains(thumb, "background-color: var(--lt-scroll-thumb);");
    // A transition here is the bug this fixes, not the fix: measured in the app's own web view, nothing written on a scrollbar part animates, so the bar blinked for as long as the fade lived on this rule.
    assert!(
        !thumb.contains("transition"),
        "the fade is back on the bar, where this engine will not run it"
    );

    // The thumb is inset by a property too, so the thickening rides the same fade rather than being a second mechanism painting the same bar.
    assert_contains(
        thumb,
        "border: var(--lt-scroll-thumb-inset) solid transparent;",
    );

    // Registered or they cannot be animated at all — an unregistered custom property has no type to interpolate. Inherited, because the thumb pseudo has no declarations of its own and reads the box's value; `inherits: false` would leave every bar painting the initial value.
    assert_contains(
        &css,
        "@property --lt-scroll-thumb {\n  syntax: \"<color>\";\n  inherits: true;\n  initial-value: transparent;\n}",
    );
    assert_contains(
        &css,
        "@property --lt-scroll-thumb-inset {\n  syntax: \"<length>\";\n  inherits: true;\n  initial-value: 0px;\n}",
    );

    // A direction per curve is declared twice: the exit in the resting rule, the enter on the state class. Both on the box, which is the whole of the fix.
    assert_contains(
        resting,
        "transition: --lt-scroll-thumb var(--lt-duration-160) var(--lt-ease-accelerate), --lt-scroll-thumb-inset var(--lt-duration-160) var(--lt-ease-accelerate);",
    );
    assert_contains(
        moving,
        "transition: --lt-scroll-thumb var(--lt-duration-200) var(--lt-ease-decelerate), --lt-scroll-thumb-inset var(--lt-duration-160) var(--lt-ease-accelerate);",
    );
    assert_contains(
        pointed,
        "transition: --lt-scroll-thumb var(--lt-duration-200) var(--lt-ease-decelerate), --lt-scroll-thumb-inset var(--lt-duration-200) var(--lt-ease-decelerate);",
    );

    // The thickening is the pointer's alone: a bar that swells every time the page moves draws attention to itself while somebody is reading. So only the pointing rule shortens the inset, and it does it inside the gutter that is reserved either way.
    assert_contains(resting, "--lt-scroll-thumb-inset: var(--lt-stroke-4);");
    assert_contains(pointed, "--lt-scroll-thumb-inset: var(--lt-stroke-2);");
    assert!(
        !moving.contains("--lt-scroll-thumb-inset:"),
        "the bar swells on every scroll, not just under the pointer"
    );
    // The pointing rule comes last, so a box that is both scrolling and pointed at keeps the thicker thumb.
    assert!(
        css.find("\n.leaf-scroll.is-pointing,") > css.find("\n.leaf-scroll.is-scrolling,"),
        "a box that is scrolling as well as pointed at loses the thickening it was aimed at"
    );

    // The pane's own fade declares a transition on the same element from a more specific rule, so it is pinned here: a later edit that drops it would take the pane's opacity ramp with it.
    assert_contains(
        rule_body(&css, "body.is-library-settling .library-scroll {"),
        "transition: opacity var(--lt-duration-260) var(--lt-ease);",
    );

    // With the fade on the box, the stylesheet's one reduced-motion block reaches it — `*` matches an element where it never matched a scrollbar part. The named block that existed only for that is dead CSS.
    assert!(
        !css.contains(
            "@media (prefers-reduced-motion: reduce) {\n  .leaf-scroll::-webkit-scrollbar-thumb,"
        ),
        "a reduced-motion block still names a scrollbar part, which the universal one now covers"
    );
}

#[test]
fn a_folded_list_shows_five_and_hands_the_rest_to_the_sheet() {
    // The way out is drawn only where the columns have folded: wide, the box scrolls and a button saying "show all" would be offering what is already on screen. The button is in the markup either way, so this rule is the whole of the mode.
    let css = reading_mode_css();
    assert_contains(rule_body(&css, "\n.home-showall {"), "display: none;");
    let folded = css
        .find("@container home (max-width: 599px) {")
        .map(|at| &css[at..])
        .expect("the folded layout is a container query on the section");
    let folded = &folded[..folded.find("\n}\n").expect("the query closes")];
    assert_contains(folded, "display: block;");
    // Five rows, and no scroll box: a nested scroller inside a page that also scrolls takes a wheel meant for the page.
    assert_contains(folded, "max-height: calc(var(--home-row-height) * 5);");
    assert_contains(folded, "overflow-y: hidden;");
    // And no soft edge either — a fade over a box that cannot scroll says there is more below when there is not.
    assert_contains(folded, ".home-list-fade {\n    display: none;\n  }");

    // In the sheet the same box is uncapped, because the sheet's own ceiling is what bounds it.
    let inside = rule_body(&css, "\n.home-sheet .home-list-scroll {");
    assert_contains(inside, "max-height: none;");
    // The sheet dissolves to its own surface rather than the reader's, or the ramp ends on a color that is not under it.
    assert_contains(
        rule_body(&css, "\n.home-sheet .home-list-fade {"),
        "--home-list-surface: var(--lt-background);",
    );
}

#[test]
fn the_app_is_one_contained_box_and_nothing_takes_the_whole_window() {
    // `contain: paint` is the whole of what makes this element mean "the app": it is what a fixed child is positioned from and what one is clipped to. Without it every overlay in the page goes back to being placed against the window, and the shadow band would have sheets and scrims sitting on top of it.
    let css = reading_mode_css();
    let surface = rule_body(&css, ".app-surface {");
    assert_contains(surface, "position: fixed;");
    assert_contains(surface, "contain: paint;");
    // Nothing measures itself against the window: past the app's own inset the window is edge the app does not paint, so a box given the window's height is a box hanging into the shadow.
    assert!(
        !css.contains("100vh"),
        "something still takes the whole window's height rather than the app surface's"
    );
}

#[test]
fn every_grained_surface_still_tiles_from_one_lattice_inside_the_app() {
    // The grain is anchored rather than tiled from each box, so two surfaces meeting share one lattice and the seam between them cannot show. `contain: paint` moves what "anchored" means for everything inside it — from the window to the app surface — which costs nothing while every anchored surface is inside that box, and puts one lattice out of phase with all the others the moment one is not. Four boxes tile from themselves on purpose and are named here, so a fifth is a decision somebody made rather than a drift.
    const OWN_BOX: [&str; 4] = [
        ".tab",
        ".table-lane::before",
        ".table-lane::after",
        ".home-list-scroll li.is-dropzone",
    ];
    let css = reading_mode_css();
    let lattice = "background-image: radial-gradient(circle, var(--lt-grain-dot)";
    let mut anchored = 0;
    for (at, _) in css.match_indices(lattice) {
        let opens = css[..at].rfind('}').map_or(0, |brace| brace + 1);
        let shuts = at + css[at..].find('}').expect("the rule closes");
        let rule = &css[opens..shuts];
        let selector = strip_css_comments(rule);
        let selector = selector.split('{').next().unwrap_or_default().trim();
        if !rule.contains("background-attachment: fixed;") {
            assert!(
                OWN_BOX.contains(&selector),
                "a new grained surface tiles from its own box rather than the shared lattice: {selector}"
            );
            continue;
        }
        anchored += 1;
        // The shadow band is the one grained surface outside the app, so it is the one anchored to the window: it falls on the strip of page the app is held off the window by, never meets a surface inside the app, and so has nothing to show a seam against.
        if selector == "body::before" {
            continue;
        }
        // Everything else is inside the contained box, and grain anchored to the window there would be the one lattice anchored somewhere else.
        for window in ["html", "body", ":root"] {
            assert!(
                !selector.split(',').any(|one| one.trim() == window),
                "{selector} anchors its grain to the window rather than to the app, so it falls out of phase with every surface inside the app"
            );
        }
    }
    assert!(
        anchored >= 10,
        "the stylesheet should still anchor the dot lattice on the app's surfaces ({anchored} found)"
    );
}

#[test]
fn the_window_throws_the_dot_halftone_rather_than_a_smooth_halo() {
    // The outermost edge in the app follows the same rule as every floating surface inside it: the dot lattice, never the operating system's smooth blur onto whatever is behind the window.
    let css = reading_mode_css();
    let band = rule_body(&css, "body::before {");
    // The lattice every other surface throws, in shadow ink.
    assert_contains(band, "--lt-grain-dot: var(--lt-grain-dot-strong);");
    assert_contains(
        band,
        "background-image: radial-gradient(circle, var(--lt-grain-dot) 0 0.6px, transparent 0.7px);",
    );
    assert_contains(band, "background-size: 2px 2px;");
    // Four edge gradients, intersected: nothing at the window's edge, full where the app starts, and each corner the product of two. Not the shared panel recipe's ellipse — on a box the size of a window its falloff is measured in hundreds of pixels and the band lands in the tail, where there is nothing left to draw.
    assert_eq!(band.matches("linear-gradient(to ").count(), 8);
    assert_contains(band, "mask-composite: intersect;");
    assert_contains(
        band,
        "-webkit-mask-composite: source-in, source-in, source-in;",
    );
    assert!(
        !band.contains("ellipse"),
        "the band borrowed the panel recipe's ellipse, which has nothing left to draw at this size"
    );
    // No punch layer: this is a sibling of the app surface rather than a child, so the opaque surface paints over the middle on its own.
    assert!(
        !band.contains("mask-composite: subtract;"),
        "the band punches a box out of itself, which is a child's problem and not a sibling's"
    );

    // One spread, said once, and the same one every panel inside the app throws. One class for both platforms: a Mac carries `frameless` as well as `mac-frame`.
    let frame = rule_body(&css, "body.frameless {");
    assert_contains(frame, "--app-shadow-top: 13px;");
    assert_contains(frame, "--app-shadow-side: 20px;");
    assert_contains(frame, "--app-shadow-bottom: 10px;");

    // Nothing behind a maximized window to cast onto, and a band there would show the desktop through a frame inside the screen edge.
    let maxed = rule_body(
        &css,
        "body.frameless:not(.mac-frame).is-maximized,\nbody.mac-frame.is-fullscreen {",
    );
    // A bare `body {` matches the `html, body` rule further up, so the page's own rule is anchored on its first declaration instead.
    let page_rule = rule_body(
        &css,
        "body {
  overflow: hidden;",
    );
    for zero in [
        "--app-shadow-top: 0px;",
        "--app-shadow-side: 0px;",
        "--app-shadow-bottom: 0px;",
    ] {
        assert_contains(maxed, zero);
        // And the same three on `body` itself, which is what a page carrying neither frame class gets: a browser has no window to cast a shadow off.
        assert_contains(page_rule, zero);
    }
    // Drawn nowhere rather than masked to nothing, in all three cases.
    assert_contains(
        &css,
        "body:not(.frameless)::before,\nbody.frameless:not(.mac-frame).is-maximized::before,\nbody.mac-frame.is-fullscreen::before {\n  content: none;\n}",
    );
    // A Mac carries `frameless` too, and it reports maximized for a zoomed window — one that still floats over what is behind it and still casts a shadow. So every rule that takes the band away for a screen-filling window has to say `:not(.mac-frame)`.
    for flush in ["::before", " .app-surface"] {
        assert!(
            !css.contains(&format!("body.frameless.is-maximized{flush}"))
                && !css.contains(&format!("body.is-maximized{flush}")),
            "a zoomed Mac window loses its band, where there is still something behind it to cast onto"
        );
    }

    // Whatever the platform stops drawing, the app starts: the page color, the edge and the corner are all the surface's now, and `<body>` paints nothing over the whole window.
    let surface = rule_body(&css, ".app-surface {");
    assert_contains(surface, "background: var(--lt-background);");
    assert_contains(
        surface,
        "border: var(--lt-stroke-1) solid var(--lt-border);",
    );
    assert_contains(surface, "border-radius: var(--lt-radius-lg);");
    assert_contains(
        surface,
        "inset: var(--app-shadow-top) var(--app-shadow-side) var(--app-shadow-bottom);",
    );
    assert_contains(page_rule, "background: transparent;");
    assert!(
        !rule_body(&css, "html,\nbody {").contains("background:"),
        "the window is painted a page color again, which is the app drawing its own halo out to the frame"
    );
    // Maximized and in a browser the app is the whole window, so it draws neither edge nor corner — both would be a frame inside the screen edge.
    let flush = rule_body(
        &css,
        "body:not(.frameless) .app-surface,\nbody.frameless:not(.mac-frame).is-maximized .app-surface,",
    );
    assert_contains(flush, "border: 0;");
    assert_contains(flush, "border-radius: 0;");
}
