//! The compiled stylesheet's own rules.

use super::*;

#[test]
fn reading_mode_css_includes_light_dark_syntax_themes() {
    let css = reading_mode_css();

    for token in [
        "--background:",
        "--foreground:",
        "--surface:",
        "--surface-page:",
        "--surface-raised:",
        "--surface-elevated:",
        "--surface-muted:",
        "--surface-sunken:",
        "--surface-inset:",
        "--surface-card:",
        "--border:",
        "--border-strong:",
        "--muted:",
        "--muted-foreground:",
        "--primary:",
        "--primary-foreground:",
        "--secondary:",
        "--secondary-foreground:",
        "--accent:",
        "--accent-foreground:",
        "--danger:",
        "--danger-foreground:",
        "--warning:",
        "--warning-foreground:",
        "--success:",
        "--success-foreground:",
        "--done:",
        "--done-foreground:",
        "--link:",
        "--link-hover:",
        "--selection:",
        "--focus-ring:",
        "--shadow:",
        "--app-background:",
        "--app-foreground:",
        "--app-border:",
        "--app-surface:",
        "--app-surface-elevated:",
        "--app-muted-foreground:",
        "--app-action-background:",
        "--app-action-foreground:",
        "--app-focus-ring:",
        "--app-selection-background:",
        "--settings-label-foreground:",
        "--settings-control-background:",
        "--settings-control-border:",
        "--preview-background:",
        "--preview-foreground:",
        "--preview-heading:",
        "--preview-border:",
        "--markdown-inline-code-background:",
        "--markdown-inline-code-foreground:",
        "--markdown-blockquote-background:",
        "--markdown-alert-warning-border:",
        "--markdown-alert-done-border:",
        "--markdown-table-cell-border:",
        "--markdown-table-heading-background:",
        "--markdown-thematic-break:",
        "--minimap-background:",
        "--minimap-border:",
        "--minimap-viewport-border:",
        "--minimap-viewport-background:",
        "--minimap-heading:",
        "--minimap-paragraph:",
        "--minimap-blank:",
        "--minimap-list:",
        "--minimap-blockquote:",
        "--minimap-code:",
        "--code-block-background:",
        "--code-block-foreground:",
        "--code-block-border:",
        "--code-block-selection-background:",
        "--markdown-code-background:",
        "--markdown-code-foreground:",
        "--markdown-blockquote-border:",
        "--markdown-blockquote-foreground:",
        "--markdown-table-border:",
        "--markdown-table-header-background:",
        "--markdown-hr:",
        "--markdown-link:",
        "--markdown-link-hover:",
        "--syntax-background:",
        "--syntax-foreground:",
        "--syntax-comment:",
        "--syntax-keyword:",
        "--syntax-string:",
        "--syntax-number:",
        "--syntax-function:",
        "--syntax-variable:",
        "--syntax-type:",
        "--syntax-operator:",
        "--syntax-punctuation:",
        "--syntax-inserted:",
        "--syntax-deleted:",
        "--syntax-changed:",
    ] {
        assert_contains(css, token);
    }

    // No fonts are bundled into the stylesheet anymore — the app uses system
    // fonts, and web-font themes fetch from Google Fonts on activation.
    assert!(
        !css.contains("@font-face") && !css.contains("data:font/woff2"),
        "reading-mode CSS must not embed bundled font faces"
    );
    // The Primer primitive cascade is gone: every theme, github included, is now
    // a self-contained literal palette, so the compiled CSS carries no Primer
    // primitive blocks or `var(--bgColor-*)` indirection.
    assert!(!css.contains("--base-color-neutral-0"));
    assert!(!css.contains("var(--bgColor-default)"));
    assert!(!css.contains("var(--prettylights-syntax-comment)"));
    assert_contains(css, "/* Leaf semantic theme compiler output. */");
    assert_contains(css, "--leaf-theme-source: github-light;");
    assert_contains(css, "--leaf-theme-source: github-dark;");
    assert_contains(css, "--leaf-theme-source: nightshade-light;");
    assert_contains(css, "--leaf-theme-source: nightshade-dark;");
    assert_contains(css, "--leaf-theme-source: amaranth-light;");
    assert_contains(css, "--leaf-theme-source: amaranth-dark;");
    assert_contains(
        css,
        r#":root[data-leaf-theme="nightshade"][data-leaf-appearance="dark"]"#,
    );
    // GitHub's tokens are concrete hex now, like every other family.
    assert_contains(css, "--leaf-background: #ffffff;");
    assert_contains(css, "--leaf-syntax-comment: #59636e;");
    assert_contains(css, "--surface-page: var(--leaf-markdown-background);");
    assert_contains(css, "--syntax-comment: var(--leaf-syntax-comment);");
    assert_contains(css, "--leaf-syntax-inserted: #116329;");
    assert_contains(css, "--syntax-inserted: var(--leaf-syntax-inserted);");
    assert_contains(css, "--syntax-inserted-bg:");
    assert_contains(css, "--syntax-deleted-bg:");
    assert_contains(css, ".document-body input[type=\"checkbox\"]");
    assert_contains(css, ".document-body .math-display");
    assert_contains(css, ".document-body summary");
    assert_contains(css, ".document-body .syn-keyword");
    assert_contains(css, ".document-body .syn-inserted");
    assert_contains(css, r#":root[data-locale="zh-CN"]"#);
    assert_contains(css, "Noto Sans SC");
    assert_contains(css, "word-wrap: break-word;");
}

#[test]
fn reading_mode_css_consumes_theme_tokens_for_high_impact_surfaces() {
    let css = reading_mode_css();

    for rule in [
        "background: var(--app-background);",
        "color: var(--app-foreground);",
        "background-color: var(--chrome-surface);",
        "color: var(--settings-label-foreground);",
        "border: 1px solid var(--settings-control-border);",
        "background: var(--settings-control-background);",
        "outline: 3px solid var(--app-focus-ring);",
        "background: var(--app-selection-background);",
        "color: var(--app-selection-foreground);",
        "background: var(--preview-background);",
        "color: var(--preview-foreground);",
        "color: var(--preview-heading);",
        "background: var(--markdown-inline-code-background);",
        "color: var(--markdown-inline-code-foreground);",
        "border-left: 0.25em solid var(--markdown-blockquote-border);",
        "color: var(--markdown-blockquote-foreground);",
        "border-left-color: var(--markdown-alert-warning-border);",
        "border: 1px solid var(--markdown-table-cell-border);",
        "background: var(--markdown-table-heading-background);",
        "background: var(--markdown-thematic-break);",
        "background: var(--code-block-background);",
        "background-clip: padding-box;",
        "clip-path: inset(0 round 6px);",
        "color: var(--code-block-foreground);",
        "background: var(--code-block-selection-background);",
        "color: var(--code-block-selection-foreground);",
        "background: var(--keyboard-background);",
        "border-top: 1px solid var(--recent-border);",
        "border: 1px solid var(--minimap-viewport-border);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn table_rows_are_grained_on_both_stripes_with_the_darker_row_darker() {
    let css = reading_mode_css();

    // Dark themes grain both stripes; light themes leave the untinted rows plain,
    // because there a dot dark enough to see reads as a grey mesh over the table.
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.08);");
    assert_contains(css, "--reader-row-grain: transparent;");
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.3);");
    // Lighter, not darker — the untinted row is the darkest surface in the app, so
    // darkening it has nowhere to go and lands unevenly across theme families.
    assert_contains(css, "--reader-row-grain: rgba(255, 255, 255, 0.07);");

    // The zeroed value must be the light default and the lift the dark override,
    // not the reverse — that swap is exactly what this pins.
    let light = css
        .find("--reader-row-grain: transparent;")
        .expect("light themes zero the row grain");
    let dark = css
        .find("--reader-row-grain: rgba(255, 255, 255, 0.07);")
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
    assert_contains(
        &css[odd..],
        "radial-gradient(circle, var(--reader-row-grain)",
    );
    // Same 2px lattice on both, so the dots line up down the page across a stripe.
    assert_contains(&css[odd..], "background-size: 2px 2px;");

    // Source order is load-bearing: the row rules and the frontmatter opt-out tie
    // on specificity, so the opt-out wins only by coming last.
    assert!(even < odd, "even-row grain should precede odd-row grain");
    assert!(
        odd < frontmatter,
        "the frontmatter opt-out must come after both row rules to win the tie"
    );
}

#[test]
fn reading_mode_css_maps_role_aliases_to_released_tokens() {
    let css = reading_mode_css();

    for alias in [
        "--app-background: var(--background);",
        "--app-foreground: var(--foreground);",
        "--app-border: var(--border);",
        "--app-surface: var(--surface);",
        "--app-surface-elevated: var(--surface-elevated);",
        "--app-action-background: var(--primary);",
        "--app-action-foreground: var(--primary-foreground);",
        "--settings-control-background: var(--surface-elevated);",
        "--settings-control-foreground: var(--foreground);",
        "--preview-background: var(--reading-background);",
        "--preview-foreground: var(--reading-ink);",
        "--preview-heading: var(--reading-heading);",
        "--markdown-inline-code-background: var(--markdown-code-background);",
        "--markdown-inline-code-foreground: var(--markdown-code-foreground);",
        "--markdown-table-cell-border: var(--markdown-table-border);",
        "--markdown-table-heading-background: var(--markdown-table-header-background);",
        "--code-block-background: var(--leaf-editor-code-background);",
        "--code-block-foreground: var(--leaf-editor-code-foreground);",
        "--code-block-selection-foreground: var(--leaf-editor-code-selection-foreground);",
        "--minimap-background: var(--leaf-minimap-background);",
        "--minimap-border: var(--leaf-minimap-border);",
        "--minimap-viewport-border: var(--leaf-minimap-viewport-border);",
        "--minimap-viewport-background: var(--leaf-minimap-viewport-background);",
        "--minimap-heading: var(--leaf-minimap-heading);",
        "--minimap-paragraph: var(--leaf-minimap-paragraph);",
        "--minimap-code: var(--leaf-minimap-code);",
    ] {
        assert_contains(css, alias);
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
            ".document-body strong {\n  font-weight: 600;\n}",
            ".document-body ul,\n.document-body ol {\n  padding-left: 2em;\n}",
            ".document-body li + li {\n  margin-top: 0.25em;\n}",
            ".document-body li > ul,\n.document-body li > ol {\n  margin: 0.25em 0 0;\n}",
            ".document-body input[type=\"checkbox\"] {\n  accent-color: var(--leaf-markdown-checkbox, #6e7681);\n  margin-right: 0.4em;\n}",
            ".document-body blockquote {\n  border-left: 0.25em solid var(--markdown-blockquote-border);\n  color: var(--markdown-blockquote-foreground);\n  padding: 0 1em;\n}",
            ".document-body blockquote:not(.markdown-alert) p {\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body blockquote:not(.markdown-alert) p.blockquote-lines {\n  padding-left: 0;\n  text-indent: 0;\n}",
            ".document-body blockquote:not(.markdown-alert) .blockquote-line {\n  display: block;\n  padding-left: 1.25em;\n  text-indent: -1.25em;\n}",
            ".document-body code {",
            "font-size: 0.875em;\n  padding: 0.2em 0.4em;",
            ".document-body pre {",
            "line-height: 1.45;",
            "padding: 1em;",
            ".document-body table {",
            "overflow: auto;",
            "width: max-content;",
            ".document-body th,\n.document-body td {\n  border: 1px solid var(--markdown-table-cell-border);\n  padding: 0.375em 0.8125em;\n}",
            ".document-body hr {\n  border: 0;\n  height: 1px;\n  margin: var(--type-spacing) 0;",
            "@media (max-width: 600px) {\n  :root {\n    --reader-content-pad: 16px;",
        ] {
            assert_contains(css, rule);
        }

    for old_rhythm in [
        ".document-body > * {\n  margin-block: 0 16px;\n}",
        "margin-block-start: calc(var(--type-base) * 4);",
        "margin-block-start: calc(var(--type-base) * 1.5);",
        "padding-top: 136px;",
        "padding: 320px 0 88px;",
    ] {
        assert!(
            !css.contains(old_rhythm),
            "rendered Markdown rhythm should match the web reader instead of {old_rhythm}"
        );
    }
}

#[test]
fn app_css_is_served_over_the_asset_protocol_not_inlined() {
    // The reading-mode stylesheet is delivered as a linked stylesheet, so the
    // shell links it and the protocol serves the full CSS. Keeping it out of the
    // inlined shell is what keeps `NavigateToString` under WebView2's size cap.
    let html = app_shell_html();
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
    // The route serves the whole compiled stylesheet: fonts, semantic tokens,
    // and app layout all resolve here.
    let body = std::str::from_utf8(&css.body).expect("app.css is utf-8");
    assert_eq!(body, reading_mode_css());
    assert!(body.contains("--leaf-background"));
    assert!(body.contains(".app-bar"));
}

#[test]
fn reading_surfaces_carry_the_chrome_dot_grain() {
    let css = reading_mode_css();

    // Its own token, lighter than the chrome's: body text sits on these.
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.08);");
    assert_contains(css, "--reader-surface-grain: rgba(0, 0, 0, 0.3);");

    // Every tinted reading surface takes the grain, on the chrome's lattice.
    for expected in [
        ".document-body .document-outline,",
        ".document-body .tei-front,",
        ".document-body pre,",
        ".document-body th,",
        ".document-body tr:nth-child(2n) td,",
        ".code-view {",
        "radial-gradient(circle, var(--reader-surface-grain) 0 0.6px, transparent 0.7px);",
        "background-size: 2px 2px;",
        "background-attachment: fixed;",
    ] {
        assert_contains(css, expected);
    }

    // The grain rule has to follow the fills it grains: at equal specificity a
    // `background:` shorthand declared later blanks the image again.
    let grain = css
        .find("var(--reader-surface-grain)")
        .expect("reader grain rule");
    for fill in [
        ".document-body .document-outline {",
        ".document-body pre {",
        ".document-body th {",
        ".code-view {",
    ] {
        let at = css.find(fill).unwrap_or_else(|| panic!("{fill} rule"));
        assert!(at < grain, "{fill} must be declared before the grain rule");
    }
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
fn reading_mode_css_pins_reader_to_its_grid_cell() {
    // The reader must be explicitly placed in the library-shell grid. When it
    // was auto-placed, unhiding the .reader-loading overlay (explicitly at
    // column 2, row 1) evicted the reader into an implicit row in the 0px
    // library column, reflowing the whole document at zero width and turning
    // every in-flight scroll computation into garbage — the "page jumps all
    // over the place" bug.
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
            // The rail is chrome, not page: its own shell column, a lead-in
            // holding the card's right border off it, the window gutter beyond
            // it, and no bleed or sticky, because it no longer lives in the
            // scroller it tracks.
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
            !css.contains("border-left: 1px solid var(--minimap-border);"),
            "minimap track border must not consume layout width because the preview lane needs exactly 8px from both minimap edges"
        );
    assert!(
        css.contains(".document-minimap-viewport {\n  position: absolute;\n  inset-inline: 0;"),
        "minimap viewport must span the full rail width"
    );
    assert!(
            css.contains(".document-minimap-content {\n  position: absolute;\n  top: var(--minimap-preview-top, 0px);\n  right: var(--minimap-padding-inline);\n  left: var(--minimap-padding-inline);"),
            "the minimap thumbnail lane fills the rail inside the exact 8px padding on both edges"
        );
    // The reader renders the whole document up front, so it must NOT use
    // content-visibility (which flashed blocks blank and jumped the minimap box).
    assert!(
        !css.contains("content-visibility: auto"),
        "the reader must render in full (no content-visibility) so scrolling matches the web"
    );
    // Same invariant, enforced from the other side now that the rail is chrome:
    // its column is exactly the rail plus the lead-in, so no dead strip can open
    // up between the page's right border and the rail, or past it.
    assert_contains(
        css,
        "--reader-minimap-column: calc(var(--minimap-width) + var(--reader-minimap-gap));",
    );
    assert_contains(css, "width: var(--minimap-width);");

    // The rail is the only thing showing position while it is there, so the
    // native bar is hidden — and has to come back when it isn't. The two branches
    // must stay apart: `scrollbar-width` anywhere on the element would kill the
    // ::-webkit-scrollbar rules the visible branch is built from.
    assert_contains(
        css,
        ".reader-shell.has-minimap {\n  scrollbar-width: none;\n}",
    );
    // The thumb is inset by a transparent border with the fill clipped inside it;
    // a bare width would put it flush against the card's border and corners.
    assert_contains(
        css,
        ".reader-shell:not(.has-minimap)::-webkit-scrollbar-thumb",
    );
    assert_contains(
        css,
        "border: 4px solid transparent;\n  background-clip: padding-box;",
    );
    // Keyed off the renderer's class, never :has() — scrollbar styles do not
    // re-resolve when a :has() match flips, so the bar outlives the rail.
    assert!(
        !css.contains(":has(.document-minimap) .reader-shell::-webkit-scrollbar"),
        "scrollbar visibility must not hang off :has()"
    );
    assert_contains(
        &app_shell_html(),
        "app.classList.toggle('has-minimap', Boolean(html));",
    );

    // The corner overlay paints chrome over the card's square corner and masks
    // the arc back out. The mask must be unconditional: on a rule only some
    // states match, the rest render a plain block in the corner.
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
            ".reader-shell {\n  background: var(--preview-background);\n  scrollbar-width: none;"
        ),
        "scrollbar-width must not sit on the base rule, or the thin bar can never be styled"
    );
}

#[test]
fn reading_mode_css_keeps_markdown_and_code_ready_for_theme_tokens() {
    let css = reading_mode_css();

    for rule in [
        ".document-body code {",
        "background: var(--markdown-inline-code-background);",
        "color: var(--markdown-inline-code-foreground);",
        ".document-body pre {",
        "background: var(--code-block-background);",
        "color: var(--code-block-foreground);",
        ".document-body pre code {",
        "background: transparent;",
        "color: inherit;",
        ".document-body .syn-comment",
        "color: var(--syntax-comment);",
        ".document-body .syn-keyword",
        "color: var(--syntax-keyword);",
        ".document-body .syn-string",
        "color: var(--syntax-string);",
        ".document-body .syn-numeric",
        "color: var(--syntax-number);",
        ".document-body .syn-function",
        "color: var(--syntax-function);",
        ".document-body .syn-type",
        "color: var(--syntax-type);",
        ".document-body .syn-variable",
        "color: var(--syntax-variable);",
        ".document-body .syn-punctuation",
        "color: var(--syntax-punctuation);",
        ".document-body .syn-inserted",
        "background: var(--syntax-inserted-bg);",
        "color: var(--syntax-inserted);",
        ".document-body .syn-deleted",
        "background: var(--syntax-deleted-bg);",
        "color: var(--syntax-deleted);",
        ".document-body .syn-changed",
        "background: var(--syntax-changed-bg);",
        "color: var(--syntax-changed);",
    ] {
        assert_contains(css, rule);
    }
}

#[test]
fn reading_mode_css_keeps_code_surfaces_readable_in_light_and_dark() {
    let css = reading_mode_css();

    for theme in [ResolvedTheme::Light, ResolvedTheme::Dark] {
        for foreground in [
            "--syntax-foreground",
            "--syntax-comment",
            "--syntax-keyword",
            "--syntax-string",
            "--syntax-number",
            "--syntax-function",
            "--syntax-variable",
            "--syntax-type",
            "--syntax-operator",
            "--syntax-punctuation",
            "--markdown-code-foreground",
        ] {
            let background = if foreground == "--markdown-code-foreground" {
                "--markdown-code-background"
            } else {
                "--syntax-background"
            };
            assert_contrast_at_least(css, theme, foreground, background, 4.5);
        }

        assert_contrast_at_least(css, theme, "--syntax-foreground", "--selection", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-inserted", "--syntax-inserted-bg", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-deleted", "--syntax-deleted-bg", 4.5);
        assert_contrast_at_least(css, theme, "--syntax-changed", "--syntax-changed-bg", 4.5);
    }
}
