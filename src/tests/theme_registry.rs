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

    // The picker's families come from the registered sources, sorted by display
    // name (the theme bundle emits them alphabetically).
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

    let html = app_shell_html();
    // Theme controls live in a bottom-sheet selector, not inline dropdowns.
    assert_contains(&html, r#"id="themeSheetOpen""#);
    assert_contains(&html, r#"id="themeSheetGrid""#);
    assert!(!html.contains(r#"id="themeMode""#));
    assert!(!html.contains(r#"id="themeFamily""#));
    assert_contains(&html, "settings.theme.");
    // Every registered family is a pickable card in the selector sheet (name in a
    // span, with the selected-state check badge).
    for (family, name) in theme_families() {
        assert_contains(
            &html,
            &format!(
                r#"<button type="button" class="theme-item" data-family="{family}" aria-pressed="false"><span class="theme-item-name">{name}</span>"#
            ),
        );
    }
    // Plus the special "Random" preference, localized via data-i18n on the name
    // span (not the button, so localization can't wipe the check SVG). It is not a
    // real family, so it never appears in theme_families()/the font map/the CSS.
    assert_contains(
        &html,
        r#"<button type="button" class="theme-item theme-item-random" data-family="random" aria-pressed="false"><span class="theme-item-name" data-i18n="settings.theme.family.random">Random</span>"#,
    );
    assert!(!theme_families().iter().any(|(id, _)| *id == "random"));
    // Palettes are data-only token maps, not free-form author CSS.
    assert!(!html.contains("customTheme"));
}

#[test]
fn theme_preview_images_are_prose_the_parser_ignores() {
    // Every family file opens with a preview screenshot (`![…](../imgs/themes/…)`),
    // carried into the bundle verbatim by scripts/bundle-themes.mjs. The parser
    // reads only headings and tables, so those lines must be inert: they are not
    // families, not tokens, and not part of any display name.
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
    // The GitHub family swaps the document fonts for GitHub's own markdown stack:
    // system sans (no serif) for body and headings, system mono for code.
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

    // The family -> Google Fonts URL map gives each non-system family its own web
    // font (Fern keeps Noto; others pick their own vibe). GitHub is omitted, so its
    // loader drops the font link and falls back to the OS stack.
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

    // The bootstrap injects the map and swaps a single <link> as the family
    // changes (run on every apply — initial paint and switches alike).
    let html = app_shell_html();
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
            ("--leaf-foreground", "--leaf-background"),
            ("--leaf-muted-foreground", "--leaf-background"),
            ("--leaf-primary-foreground", "--leaf-primary"),
            ("--leaf-markdown-foreground", "--leaf-markdown-background"),
            ("--leaf-markdown-heading", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-2", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-3", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-4", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-5", "--leaf-markdown-background"),
            ("--leaf-markdown-heading-6", "--leaf-markdown-background"),
            (
                "--leaf-markdown-inline-code-foreground",
                "--leaf-markdown-inline-code-background",
            ),
            (
                "--leaf-editor-code-foreground",
                "--leaf-editor-code-background",
            ),
            (
                "--leaf-editor-code-selection-foreground",
                "--leaf-editor-code-selection-background",
            ),
            (
                "--leaf-focus-selection-foreground",
                "--leaf-focus-selection-background",
            ),
            ("--leaf-syntax-foreground", "--leaf-syntax-background"),
            ("--leaf-syntax-comment", "--leaf-syntax-background"),
            ("--leaf-syntax-keyword", "--leaf-syntax-background"),
            ("--leaf-syntax-string", "--leaf-syntax-background"),
            ("--leaf-syntax-number", "--leaf-syntax-background"),
            ("--leaf-syntax-function", "--leaf-syntax-background"),
            ("--leaf-syntax-variable", "--leaf-syntax-background"),
            ("--leaf-syntax-type", "--leaf-syntax-background"),
            ("--leaf-syntax-operator", "--leaf-syntax-background"),
            ("--leaf-syntax-punctuation", "--leaf-syntax-background"),
            (
                "--leaf-syntax-inserted",
                "--leaf-syntax-inserted-background",
            ),
            ("--leaf-syntax-deleted", "--leaf-syntax-deleted-background"),
            ("--leaf-syntax-changed", "--leaf-syntax-changed-background"),
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
fn theme_compiler_gates_interactive_chrome_contrast() {
    // Icons/controls on filled backgrounds, incl. hover. WCAG 1.4.11 gates non-text
    // contrast at 3:1 (text is 4.5:1). The tab-close hover regressed here once (white
    // icon on a light accent), so gate every theme's chrome to catch that class.
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in [
            // Filled action buttons and their hover state (the tab close X reuses
            // the action foreground on the action hover background).
            ("--leaf-primary-foreground", "--leaf-primary"),
            (
                "--leaf-primary-foreground",
                "--leaf-navigation-button-hover-background",
            ),
            (
                "--leaf-navigation-button-foreground",
                "--leaf-navigation-button-background",
            ),
            (
                "--leaf-navigation-button-foreground",
                "--leaf-navigation-button-hover-background",
            ),
            (
                "--leaf-markdown-badge-foreground",
                "--leaf-markdown-badge-background",
            ),
            ("--leaf-secondary-foreground", "--leaf-secondary"),
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
    assert!(!js.body.is_empty());

    let css = bundled_asset_response("http://leaf-asset.local/katex/katex.min.css");
    assert_eq!(css.status, 200);
    assert_eq!(css.content_type, "text/css; charset=utf-8");

    let font = bundled_asset_response("leaf-asset://local/katex/fonts/KaTeX_Main-Regular.woff2");
    assert_eq!(font.status, 200);
    assert_eq!(font.content_type, "font/woff2");
    assert!(!font.body.is_empty());

    let missing = bundled_asset_response("leaf-asset://local/nope.js");
    assert_eq!(missing.status, 404);
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
