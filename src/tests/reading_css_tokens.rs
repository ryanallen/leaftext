//! The stylesheet's tokens: one name per color, the border box, the spacing scale, and how it is served.

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
    assert_contains(rule_body(css, "* {"), "box-sizing: border-box;");
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
        // The heading row draws in the alternating row's own fill, so the grid reads as one even rhythm with the labels as its darkest band. The header fill every family still declares is spent by nothing in this stylesheet.
        "background: var(--lt-markdown-table-row-background);",
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
fn no_rule_asks_for_a_code_face_by_a_name_no_theme_sets() {
    // `--lt-code-font` shipped for months on the block being typed into: nothing declares it, so the rule resolved to its inline fallback and the block drew in a generic monospace on ten of the eleven families. The name is dead and must stay dead, whichever rule reaches for it next.
    let css = reading_mode_css();

    assert!(
        !css.contains("--lt-code-font"),
        "the theme sets --code-font, not --lt-code-font; a rule naming the second one resolves to nothing"
    );
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
        ".crumb-menu-item {",
        ".flow-menu-item {",
        ".library-file,\n.library-nav-folder {",
        ".reader-graph-legend {",
        ".primary-new {",
        ".library-sync {",
    ] {
        let rule = rule_body(css, selector);
        assert_contains(rule, "gap: var(--lt-space-6);");
    }

    // The one place it cannot land: the switcher and the name beside it share one pill, so the room between its icon and its word is the two halves' own edges meeting rather than a gap of its own.
    let switcher = rule_body(css, ".library-vault-switch {");
    assert_contains(switcher, "gap: var(--lt-space-2);");
    assert_contains(switcher, "padding: 0 var(--lt-space-4);");
}
