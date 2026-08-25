//! The theme registry, the semantic token contract, and color maths over it.

use super::*;

#[test]
fn theme_compiler_requires_complete_semantic_sources_and_keeps_ui_controlled() {
    let css = reading_mode_css();
    let sources = theme_sources();

    assert_theme_sources_cover_contract(sources);
    // Eleven families (github, nightshade, amaranth, fern, sage, halcyon, arabica, goldenrod, ginger, pippin, bloodleaf), each a light/dark pair.
    assert_eq!(sources.len(), 22);
    assert!(sources.iter().any(|source| source.id == "nightshade-dark"));

    for source in sources {
        for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
            assert!(
                theme_source_token_value(source, token).is_some(),
                "expected {} to compile required token {token}",
                source.id
            );
        }
        assert_contains(css, source.selector);
    }

    // The picker's families come from the registered sources, sorted by display name (the theme bundle emits them alphabetically).
    assert_eq!(
        theme_families(),
        vec![
            ("amaranth", "Amaranth"),
            ("arabica", "Arabica"),
            ("bloodleaf", "Bloodleaf"),
            ("fern", "Fern"),
            ("ginger", "Ginger"),
            ("github", "GitHub"),
            ("goldenrod", "Goldenrod"),
            ("halcyon", "Halcyon"),
            ("nightshade", "Nightshade"),
            ("pippin", "Pippin"),
            ("sage", "Sage"),
        ]
    );

    let html = app_shell_page();
    // Theme controls live in a bottom-sheet selector, not inline dropdowns.
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert!(!html.contains(r#"id="themeMode""#));
    assert!(!html.contains(r#"id="themeFamily""#));
    assert_contains(&html, "const THEME_MODE_NAMES = { system: 'System', light: 'Light', dark: 'Dark', daylight: 'Daylight' };");
    // Every registered family is a pickable card in the selector sheet (name in a span, with the selected-state check badge). The card carries an inline style that paints it in the theme's own paper/ink, so attributes sit between the family id and the name span.
    for (family, name) in theme_families() {
        assert_contains(
            &html,
            &format!(r#"<button type="button" class="theme-item" data-family="{family}""#),
        );
        assert_contains(
            &html,
            &format!(r#"<span class="theme-item-name">{name}</span>"#),
        );
    }
    // Plus the special "Random" preference: its name is a span of its own inside the button, so the check SVG beside it is never part of the label. It is not a real family, so it never appears in theme_families()/the font map/the CSS.
    assert_contains(
        &html,
        r#"<button type="button" class="theme-item theme-item-random" data-family="random""#,
    );
    assert_contains(&html, r#"<span class="theme-item-name">Random</span>"#);
    assert!(!theme_families().iter().any(|(id, _)| *id == "random"));
    // Palettes are data-only token maps, not free-form author CSS.
    assert!(!html.contains("customTheme"));
}

#[test]
fn defaulted_colors_compile_to_a_copied_value_not_a_pointer() {
    // A `Default` in design/colors.md lets a family leave a row out. What it gets is the named row's *value*, written into its own block as a hex: a `var()` there would be a second name for that color, which src/tests/reading_css_tokens.rs refuses, and it would make a family's compiled block a mix of colors and indirection to read.
    let css = reading_mode_css();

    for source in theme_sources() {
        for (token, from) in LEAF_SEMANTIC_TOKEN_DEFAULTS {
            let value = theme_source_token_value(source, token)
                .unwrap_or_else(|| panic!("{} resolves {token}", source.id));
            assert!(
                value.starts_with('#'),
                "expected {} {token} to compile to a hex, got {value}",
                source.id
            );
            assert_contains(
                css_block(css, &format!("{} {{", source.selector)),
                &format!("{token}: {value};"),
            );
            // Silent by default: a family that says nothing lands on the row it copies.
            let copied = theme_source_token_value(source, from).expect("the copied row is set");
            assert!(
                value == copied
                    || source.tokens.iter().any(|(name, _)| name == token)
                    || source.overrides.iter().any(|(name, _)| name == token),
                "expected {} {token} to equal {from} unless the family sets it",
                source.id
            );
        }
    }
}

#[test]
fn a_family_that_names_a_defaulted_color_keeps_its_own_value() {
    // The other half of the default: setting the row wins over the copy, so a family can run its hovers in a hue of its own with no code change. Proved on a source built here rather than on whichever family happens to set one today.
    let quiet = "#6e6550";
    let mine = "#f0b400";
    let base: &'static [(&'static str, &'static str)] = &[("--lt-muted-foreground", "#6e6550")];
    let named: &'static [(&'static str, &'static str)] = &[
        ("--lt-muted-foreground", "#6e6550"),
        ("--lt-hover-tint", "#f0b400"),
    ];

    let mut source = ThemeSource {
        id: "test-light",
        family: "test",
        family_name: "Test",
        appearance: Appearance::Light,
        selector: ":root[data-leaf-theme=\"test\"][data-leaf-appearance=\"light\"]",
        tokens: base,
        overrides: &[],
        font_heading: "",
        font_body: "",
        font_code: "",
        font_google: "",
    };
    assert_eq!(
        theme_source_token_value(&source, "--lt-hover-tint"),
        Some(quiet)
    );

    source.tokens = named;
    assert_eq!(
        theme_source_token_value(&source, "--lt-hover-tint"),
        Some(mine)
    );

    // An Overrides block wins the same way, which is how a family layers one value over a shared table.
    source.tokens = base;
    source.overrides = &[("--lt-hover-tint", "#f0b400")];
    assert_eq!(
        theme_source_token_value(&source, "--lt-hover-tint"),
        Some(mine)
    );
}

#[test]
fn goldenrod_washes_its_hovers_in_its_own_gold() {
    // The door `hover-tint` opens, proved on the one family that walks through it. Every other family copies its quiet-text color, so Goldenrod's hovered row has to come out a different color from all of them over the same panel — otherwise the override is a row nobody reads.
    let css = reading_mode_css();
    let sources = theme_sources();

    // The wash is 16% of the tint over whatever is behind it, and the panel the three menus are drawn on is `surface-elevated`. Held to one family's panel so the comparison is of tints, not of eleven different panels.
    let panel = css_token_for_source(css, &sources[0], "--lt-surface-elevated");
    let washed = |source: &ThemeSource| {
        let tint = css_token_for_source(css, source, "--lt-hover-tint");
        // Back to the 0-255 the screen draws in: a channel is a byte, so two washes that round to the same byte are the same color to look at.
        [
            ((tint.red * 0.16 + panel.red * 0.84) * 255.0).round() as i64,
            ((tint.green * 0.16 + panel.green * 0.84) * 255.0).round() as i64,
            ((tint.blue * 0.16 + panel.blue * 0.84) * 255.0).round() as i64,
        ]
    };

    for appearance in [Appearance::Light, Appearance::Dark] {
        let gold = sources
            .iter()
            .find(|source| source.family == "goldenrod" && source.appearance == appearance)
            .expect("goldenrod ships both halves");
        for other in sources
            .iter()
            .filter(|source| source.family != "goldenrod" && source.appearance == appearance)
        {
            assert_ne!(
                washed(gold),
                washed(other),
                "expected goldenrod's {} wash to differ from {}'s",
                appearance.as_str(),
                other.id
            );
        }
        // And it is a set value, not the copy every other family takes.
        assert_ne!(
            theme_source_token_value(gold, "--lt-hover-tint"),
            theme_source_token_value(gold, "--lt-muted-foreground"),
            "goldenrod names its own tint rather than falling back"
        );
    }
}

#[test]
fn theme_preview_images_are_prose_the_parser_ignores() {
    // Every family file opens with a preview screenshot (`![…](../imgs/themes/…)`), carried into the bundle verbatim by scripts/bundle-themes.mjs. The parser reads only headings and tables, so those lines must be inert: they are not families, not tokens, and not part of any display name.
    let bundle = include_str!("../assets/themes.md");
    let preview_lines: Vec<&str> = bundle
        .lines()
        .filter(|line| line.starts_with("!["))
        .collect();
    assert_eq!(
        preview_lines.len(),
        theme_families().len(),
        "expected one preview image per family in the bundle"
    );

    let sources = theme_sources();
    for (family, name) in theme_families() {
        assert!(
            !name.contains('!') && !name.contains('['),
            "family {family} display name picked up image markup: {name}"
        );
        assert!(
            preview_lines
                .iter()
                .any(|line| line.contains(&format!("../imgs/themes/{family}.png"))),
            "expected a preview image line for {family}"
        );
        // Both variants still parse, with the full contract intact.
        for appearance in ["light", "dark"] {
            let source = sources
                .iter()
                .find(|source| source.id == format!("{family}-{appearance}"))
                .unwrap_or_else(|| panic!("{family}-{appearance} parses out of the bundle"));
            for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
                assert!(
                    theme_source_token_value(source, token).is_some(),
                    "expected {} to keep required token {token}",
                    source.id
                );
            }
        }
    }
}

#[test]
fn github_family_uses_github_markdown_fonts_not_noto() {
    let css = reading_mode_css();
    // The GitHub family swaps the document fonts for GitHub's own markdown stack: system sans (no serif) for body and headings, system mono for code.
    let block = css
        .split(":root[data-leaf-theme=\"github\"] {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("github family font override block exists");
    assert!(block.contains("--heading-font: -apple-system"));
    assert!(block.contains("--reading-font: -apple-system"));
    assert!(block.contains("--code-font: ui-monospace"));
    // The GitHub document fonts drop the app's bundled Noto serif/mono faces.
    assert!(!block.contains("Noto Serif"));
    assert!(!block.contains("Noto Sans Mono"));
}

#[test]
fn web_font_mechanism_fetches_noto_by_default_and_swaps_on_theme_change() {
    // Nothing is bundled: the stylesheet embeds no font faces.
    let css = reading_mode_css();
    assert!(
        !css.contains("@font-face") && !css.contains("data:font/woff2"),
        "fonts must be fetched from Google Fonts, not bundled into the stylesheet"
    );

    // The family -> Google Fonts URL map gives each non-system family its own web font (Fern keeps Noto; others pick their own vibe). GitHub is omitted, so its loader drops the font link and falls back to the OS stack.
    let map: serde_json::Value =
        serde_json::from_str(&theme_web_font_hrefs_json()).expect("font map is valid JSON");
    let map = map.as_object().expect("font map is an object");
    // A family is present with a Google Fonts URL, or absent (system fonts, fetch nothing).
    for (family, _) in theme_families() {
        if let Some(href) = map.get(family).and_then(|v| v.as_str()) {
            assert!(
                href.starts_with("https://fonts.googleapis.com/css2?family="),
                "{family} should fetch its font from Google Fonts, got {href:?}"
            );
        }
    }
    assert!(!map.contains_key("github"));
    assert!(map.contains_key("fern"));

    // The bootstrap injects the map and swaps a single <link> as the family changes (run on every apply — initial paint and switches alike).
    let html = app_shell_page();
    assert!(html.contains("const FAMILY_FONTS = {"));
    assert!(html.contains("fonts.googleapis.com/css2?family=Noto"));
    assert!(html.contains("const applyFamilyFont = (fam) => {"));
    assert!(html.contains("document.getElementById('leafThemeFont')"));
    assert!(html.contains("applyFamilyFont(family);"));

    // The CSP admits Google Fonts (stylesheet host + font-file host) and no more.
    assert!(html.contains(
        "style-src 'self' 'unsafe-inline' http://leaf-asset.local leaf-asset: https://fonts.googleapis.com"
    ));
    assert!(html.contains(
        "font-src 'self' data: http://leaf-asset.local leaf-asset: https://fonts.gstatic.com"
    ));
}

#[test]
fn theme_compiler_gates_readable_pairs_for_every_source() {
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            ("--lt-foreground", "--lt-background"),
            ("--lt-muted-foreground", "--lt-background"),
            ("--lt-primary-foreground", "--lt-primary"),
            ("--lt-markdown-foreground", "--lt-markdown-background"),
            ("--lt-markdown-heading", "--lt-markdown-background"),
            ("--lt-markdown-heading-2", "--lt-markdown-background"),
            ("--lt-markdown-heading-3", "--lt-markdown-background"),
            ("--lt-markdown-heading-4", "--lt-markdown-background"),
            ("--lt-markdown-heading-5", "--lt-markdown-background"),
            ("--lt-markdown-heading-6", "--lt-markdown-background"),
            ("--lt-editor-code-foreground", "--lt-editor-code-background"),
            (
                "--lt-editor-code-selection-foreground",
                "--lt-editor-code-selection-background",
            ),
            (
                "--lt-focus-selection-foreground",
                "--lt-focus-selection-background",
            ),
            ("--lt-syntax-foreground", "--lt-syntax-background"),
            ("--lt-syntax-comment", "--lt-syntax-background"),
            ("--lt-syntax-keyword", "--lt-syntax-background"),
            ("--lt-syntax-string", "--lt-syntax-background"),
            ("--lt-syntax-number", "--lt-syntax-background"),
            ("--lt-syntax-function", "--lt-syntax-background"),
            ("--lt-syntax-variable", "--lt-syntax-background"),
            ("--lt-syntax-type", "--lt-syntax-background"),
            ("--lt-syntax-operator", "--lt-syntax-background"),
            ("--lt-syntax-punctuation", "--lt-syntax-background"),
            ("--lt-syntax-inserted", "--lt-syntax-inserted-background"),
            ("--lt-syntax-deleted", "--lt-syntax-deleted-background"),
            ("--lt-syntax-changed", "--lt-syntax-changed-background"),
        ] {
            let ratio = contrast_ratio(
                css_token_for_source(css, source, foreground),
                css_token_for_source(css, source, background),
            );
            assert!(
                ratio >= 4.5,
                "expected {} {foreground} on {background} contrast {ratio:.2} to be at least 4.5",
                source.id
            );
        }
    }
}

#[test]
fn theme_compiler_gates_diagram_colors_for_every_source() {
    // Every pair a mermaid diagram puts together out of our tokens (MERMAID_COLOR_MAP and MERMAID_INK_MAP in decorate.js). A diagram is exactly as readable as these, and the mistake this catches is not a bad color — it is ink measured against the wrong background. A quadrant point's label is drawn on the quadrant, not on the point, and measuring it against the point shipped white text on a pale gray panel in v0.1.423.
    //
    // Text is gated at 4.5:1 (WCAG AA), a line or a border at 3:1 (WCAG 1.4.11) — except a node's outline against its own fill, which is a hairline both themes draw deliberately faint and which also stands against the page.
    let css = reading_mode_css();
    let text_pairs = [
        (
            "diagram text",
            "--lt-markdown-foreground",
            "--lt-markdown-background",
            4.5,
        ),
        (
            "title",
            "--lt-markdown-heading",
            "--lt-markdown-background",
            4.5,
        ),
        (
            "node label",
            "--lt-markdown-foreground",
            "--lt-surface-muted",
            4.5,
        ),
        (
            "subgraph label",
            "--lt-markdown-foreground",
            "--lt-surface-sunken",
            4.5,
        ),
        (
            "quadrant axis label",
            "--lt-muted-foreground",
            "--lt-markdown-background",
            4.5,
        ),
        (
            "arrows",
            "--lt-muted-foreground",
            "--lt-markdown-background",
            3.0,
        ),
        (
            "node outline",
            "--lt-border-strong",
            "--lt-markdown-background",
            1.2,
        ),
        (
            "subgraph outline",
            "--lt-border",
            "--lt-markdown-background",
            1.1,
        ),
    ];
    // A fill we chose, and the text printed inside it. The ink is measured against every fill in the group and the worst one decides, because one variable can serve several fills — `readableInk` in decorate.js picks the same way.
    let inked_fills: [(&str, &[&str]); 7] = [
        ("gantt bar", &["--lt-primary"]),
        ("gantt active bar", &["--lt-accent"]),
        ("gantt done bar", &["--lt-success"]),
        ("gantt critical bar", &["--lt-danger"]),
        ("sequence number", &["--lt-muted-foreground"]),
        ("error box", &["--lt-danger"]),
        (
            "quadrant point label",
            &["--lt-surface-muted", "--lt-surface-sunken"],
        ),
    ];
    // Every ink a diagram may print in — the page's two, plus the inks the theme picked for its colored surfaces. Mirrors MERMAID_INK_CANDIDATES.
    let inks = [
        "--lt-markdown-foreground",
        "--lt-markdown-background",
        "--lt-primary-foreground",
        "--lt-accent-foreground",
        "--lt-success-foreground",
        "--lt-danger-foreground",
    ];

    for source in theme_sources() {
        for (what, foreground, background, floor) in text_pairs {
            let ratio = contrast_ratio(
                css_token_for_source(css, source, foreground),
                css_token_for_source(css, source, background),
            );
            assert!(
                ratio >= floor,
                "expected {} diagram {what} ({foreground} on {background}) contrast {ratio:.2} to be at least {floor:.1}",
                source.id
            );
        }

        for (what, fills) in inked_fills {
            let best = inks
                .iter()
                .map(|ink| {
                    let ink_color = css_token_for_source(css, source, ink);
                    fills
                        .iter()
                        .map(|fill| {
                            contrast_ratio(ink_color, css_token_for_source(css, source, fill))
                        })
                        .fold(f64::INFINITY, f64::min)
                })
                .fold(0.0_f64, f64::max);
            assert!(
                best >= 4.5,
                "expected {} to have one ink readable on the {what} fill(s) {fills:?}: best worst-case contrast {best:.2}, wanted 4.5",
                source.id
            );
        }
    }
}

#[test]
fn theme_compiler_gates_interactive_chrome_contrast() {
    // Icons/controls on filled backgrounds, incl. hover. WCAG 1.4.11 gates non-text contrast at 3:1 (text is 4.5:1). The tab-close hover regressed here once (white icon on a light accent), so gate every theme's chrome to catch that class.
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            // Filled action buttons and their hover state (the tab close X reuses the action foreground on the action hover background).
            ("--lt-primary-foreground", "--lt-primary"),
            (
                "--lt-primary-foreground",
                "--lt-navigation-button-hover-background",
            ),
            (
                "--lt-markdown-badge-foreground",
                "--lt-markdown-badge-background",
            ),
        ] {
            let ratio = contrast_ratio(
                css_token_for_source(css, source, foreground),
                css_token_for_source(css, source, background),
            );
            assert!(
                ratio >= 3.0,
                "expected {} {foreground} on {background} contrast {ratio:.2} to be at least 3.0",
                source.id
            );
        }
    }
}

#[test]
fn bundled_asset_response_serves_known_assets_and_404s_unknown() {
    let js = bundled_asset_response("leaf-asset://local/mermaid.min.js");
    assert_eq!(js.status, 200);
    assert_eq!(js.content_type, "text/javascript; charset=utf-8");
    // The response half of the anonymous CORS pair: without it the browser masks every throw inside a bundled script as `Script error.` with no place.
    assert_eq!(js.allow_origin, "*");
    assert!(!js.body.is_empty());

    let css = bundled_asset_response("http://leaf-asset.local/katex/katex.min.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type, "text/css; charset=utf-8");

    let font = bundled_asset_response("leaf-asset://local/katex/fonts/KaTeX_Main-Regular.woff2");
    assert_eq!(font.status, 200);
    assert_eq!(font.content_type, "font/woff2");
    assert!(!font.body.is_empty());

    // The URLs the desktop hands the page carry a version query, so the lookup must not read one as part of the name.
    let versioned = bundled_asset_response("leaf-asset://local/mermaid.min.js?v=1.2.3");
    assert_eq!(versioned.status, 200);
    assert_eq!(versioned.allow_origin, "*");

    let missing = bundled_asset_response("leaf-asset://local/nope.js");
    assert_eq!(missing.status, 404);
    assert_eq!(missing.allow_origin, "*");
}

#[test]
fn theme_mode_always_resolves_from_system_preference() {
    assert_eq!(ThemeMode::parse("system"), Some(ThemeMode::System));
    assert_eq!(ThemeMode::parse("light"), None);
    assert_eq!(ThemeMode::parse("dark"), None);
    assert_eq!(ThemeMode::parse("night"), None);
    assert_eq!(ThemeMode::parse_or_system(Some("dark")), ThemeMode::System);
    assert_eq!(
        ThemeMode::parse_or_system(Some("not-a-theme")),
        ThemeMode::System
    );
    assert_eq!(ThemeMode::parse_or_system(None), ThemeMode::System);
    assert_eq!(ThemeMode::System.storage_value(), "system");
    assert_eq!(ThemeMode::System.resolve(false), ResolvedTheme::Light);
    assert_eq!(ThemeMode::System.resolve(true), ResolvedTheme::Dark);
}

#[test]
fn bundled_asset_serves_graph_runtimes() {
    let pixi = bundled_asset_response("leaf-asset://local/pixi.min.js");
    assert_eq!(pixi.status, 200);
    assert!(pixi.content_type.contains("javascript"));
    assert!(!pixi.body.is_empty());

    let d3 = bundled_asset_response("leaf-asset://local/d3-force.min.js");
    assert_eq!(d3.status, 200);
    assert!(d3.content_type.contains("javascript"));
    assert!(!d3.body.is_empty());

    let unsafe_eval = bundled_asset_response("leaf-asset://local/pixi-unsafe-eval.min.js");
    assert_eq!(unsafe_eval.status, 200);
    assert!(unsafe_eval.content_type.contains("javascript"));
    assert!(!unsafe_eval.body.is_empty());
}
