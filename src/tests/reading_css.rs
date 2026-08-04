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
        "border-top: var(--lt-stroke-1) solid var(--lt-navigation-recent-border);",
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

    // The cap needs the box-sizing beside it, or the bar's border and 10px inset fall outside the number.
    let bar = rule_body(css, ".find-bar {");
    assert_contains(bar, "max-width: calc(100% - var(--lt-space-16));");
    assert_contains(bar, "box-sizing: border-box;");

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
    // The wash behind the dot screen: one band per edge, opaque at each cut and gone by the far side. It sits here rather than on the bands because those are masked, and the mask would ramp it a second time.
    assert_contains(rule, "--reader-edge-fade-depth: 36px;");
    assert_contains(rule, "--reader-edge-fade-hold: 2px;");
    // The scrollbar belongs to the scroller, which paints it inside a box this overlay sits on top of — there is no z-index that puts it back on top, so the bands hold off its gutter instead. It closes with the minimap rail.
    assert_contains(
        rule,
        "margin: 0 calc(var(--reader-scrollbar) + var(--lt-space-1)) var(--lt-space-1) var(--lt-space-1);",
    );
    assert_contains(css, "  --reader-scrollbar: 14px;");
    let railed = rule_body(css, "body:has(.document-minimap) {");
    assert_contains(railed, "--reader-scrollbar: 0px;");
    // Same width the scrollbar itself is set to, which stays a literal there: Chromium won't re-resolve a scrollbar pseudo-element on a :has() flip.
    let bar = rule_body(css, ".reader-shell:not(.has-minimap)::-webkit-scrollbar {");
    assert_contains(bar, "width: 14px;");
    assert_eq!(rule.matches("linear-gradient(").count(), 2);
    // The wash spans the same depth as the screen over it, not its own. Given a shorter one its ramp ends where the screen's carries on, and the break in slope reads as a bright line at the halfway mark.
    assert_contains(rule, "background-size: 100% var(--reader-edge-fade-depth);");
    assert_contains(
        rule,
        "background-position: 0 var(--app-bar-height), 0 100%;",
    );
    assert_contains(
        css,
        ".reader-edge-fade::before {\n  top: var(--app-bar-height);",
    );
    assert_contains(css, ".reader-edge-fade::after {\n  bottom: 0;");
    // The code view repaints the card, so the fade has to follow that color.
    assert_contains(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
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
            "--minimap-track-height: 100%;",
            "height: var(--minimap-track-height);",
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
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: 0;\n  transform: translateY(var(--minimap-preview-top, 0px));\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "the minimap thumbnail lane fills the rail inside the exact 8px padding on both edges"
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
    // The thumb is inset by a transparent border with the fill clipped inside it; a bare width would put it flush against the card's border and corners.
    assert_contains(
        css,
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb",
    );
    assert_contains(
        css,
        "border: var(--lt-stroke-4) solid transparent;\n  background-clip: padding-box;",
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
    // And neither does the edge wash, which would otherwise put the page's color back under the top and bottom of the map.
    let fade = rule_body(css, ":root[data-code-view=\"true\"] .reader-edge-fade {");
    assert_contains(
        fade,
        "margin-right: calc(var(--cv-minimap-width, 0px) + var(--cv-minimap-standoff) + var(--lt-space-1));",
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
    let block = ".document-body pre.mermaid[data-processed=\"true\"]";

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
    assert_contains(css, &format!("{block} > svg {{"));
    assert_contains(css, &format!("{block}.is-moved > svg {{"));
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
