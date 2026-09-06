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

    // The rows themselves, so dropping one from design/colors.md fails here rather than leaving the walk below with nothing to walk. `primary-ink` is the one that would go quietly: the stylesheet would still name a token nobody compiles, and every word and mark the role paints would fall back to nothing.
    assert_eq!(
        LEAF_SEMANTIC_TOKEN_DEFAULTS,
        [
            ("--lt-hover-tint", "--lt-muted-foreground"),
            ("--lt-primary-ink", "--lt-primary"),
            ("--lt-markdown-table-row-background", "--lt-surface-sunken"),
        ]
    );

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
        pack: LEAFTEXT_ICON_PACK,
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
fn the_action_color_paints_words_and_marks_out_of_the_ink_token() {
    // `--lt-primary` is a fill, a wash and a border; `--lt-primary-ink` is what the same role looks like as words or a thin mark. A family whose two demands do not overlap — Goldenrod's gold is light enough to print `#1c1a15` on and far too light to read as a heading — can only be fixed by the two being separate tokens, so a rule that goes back to spending the fill as `color:` puts the family back under its floor with nothing to say so. Written against the composed sheet rather than the parts, because that is what the web view is handed.
    let css = reading_mode_css();

    for (number, line) in css.lines().enumerate() {
        assert!(
            !line.trim_start().starts_with("color: var(--lt-primary)"),
            "line {} paints the role's fill as ink; spend --lt-primary-ink: {line}",
            number + 1
        );
    }

    // And the ink is really spent, so the check above cannot pass on a sheet that dropped the token altogether. Ten rules: the start screen's headings, Show all, the heart and a document's buttons in `home.css`, the folded sheet's title, the outline and ghost buttons, the app-bar logomark, the startup card's mark and the leaf beside a file name.
    assert_eq!(
        css.lines()
            .filter(|line| line
                .trim_start()
                .starts_with("color: var(--lt-primary-ink)"))
            .count(),
        10
    );

    // The inactive window quiets the ink with everything else it quiets, and it does that by filtering the whole surface rather than by naming this token — so what is checked here is that no rule has gone back to naming it, which is how the logomark and the leaf would come to step back on a different beat from the chrome around them.
    assert!(
        !css.contains("--lt-primary-ink: var(--lt-muted-foreground)"),
        "a rule quiets the action ink on its own again, and the whole window already quiets together"
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
    // The GitHub family swaps the document fonts for GitHub's own markdown stack: system sans (no serif) for body and headings, system mono for code. The family opens two rules — its own colors, and the icon pack it wears — so the fonts one is named by a declaration only it carries.
    let block = rule_body(
        css,
        ":root[data-leaf-theme=\"github\"] {
  --heading-font:",
    );
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
        "style-src 'self' 'unsafe-inline' http://leaf-asset.local leaf-asset: http://leaf-site.local leaf-site: https://fonts.googleapis.com"
    ));
    assert!(html.contains(
        "font-src 'self' data: http://leaf-asset.local leaf-asset: http://leaf-site.local leaf-site: https://fonts.gstatic.com"
    ));
}

/// Every ink a family declares a surface for, paired with that surface. A token here has a partner the family itself wrote down — `primary-foreground` with `primary`, a syntax color with the code background it is read on — which is what makes the pair a fact about the palette rather than a guess about where a rule puts something.
///
/// Two gates walk it: the one below at 4.5:1 with the window as it normally is, and the inactive-window gate at 3:1 with the whole window filtered. Neither invents a pair, which is the only way either can say something true about a family added later.
const READABLE_PAIRS: &[(&str, &str)] = &[
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
];

#[test]
fn theme_compiler_gates_readable_pairs_for_every_source() {
    let css = reading_mode_css();

    for source in theme_sources() {
        for (foreground, background) in READABLE_PAIRS {
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

/// One thing the reader is meant to read, the surface the rule that paints it puts it on, the floor that rule owes, and the rule itself.
///
/// The three gates beside this one pair a token with its own partner — `primary-foreground` with `primary`. These inks have no partner: what an ink sits on is decided by a rule in a stylesheet, and what floor it owes by whether that rule paints words or a drawing. So a row is ink, surface, floor and the rule that pairs them, and the rule travels into the failure, because a token name leaves whoever reads it hunting for where the color is spent.
struct PaintedInk {
    what: &'static str,
    ink: &'static str,
    surface: &'static str,
    floor: f64,
    rule: &'static str,
}

/// Every rule in `src/assets/reading/` that paints a role color onto something a reader looks at. A new rule spending one of these tokens as `color:`, `fill:` or `stroke:` owes a row here.
///
/// WCAG AA is 4.5:1 for words and 3:1 for a drawing, which is the split the diagram gate beside this one already uses row by row.
const PAINT_LIST: &[PaintedInk] = &[
    PaintedInk {
        what: "a link in the document",
        ink: "--lt-markdown-link",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document.css `.document-body a`",
    },
    PaintedInk {
        what: "the Note label",
        ink: "--lt-markdown-alert-note",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document-code.css `.markdown-alert-note::before`",
    },
    PaintedInk {
        what: "the Tip label",
        ink: "--lt-markdown-alert-tip",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document-code.css `.markdown-alert-tip::before`",
    },
    PaintedInk {
        what: "the Important label",
        ink: "--lt-markdown-alert-important",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document-code.css `.markdown-alert-important::before`",
    },
    PaintedInk {
        what: "the Warning label",
        ink: "--lt-markdown-alert-warning",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document-code.css `.markdown-alert-warning::before`",
    },
    PaintedInk {
        what: "the Caution label",
        ink: "--lt-markdown-alert-caution",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/document-code.css `.markdown-alert-caution::before`",
    },
    PaintedInk {
        what: "the start screen's list headings, Show all, Repair and a document's buttons",
        ink: "--lt-primary-ink",
        surface: "--lt-markdown-background",
        floor: 4.5,
        rule: "src/assets/reading/home.css `.recent h2`",
    },
    PaintedInk {
        what: "the heart on a favorite row",
        ink: "--lt-primary-ink",
        surface: "--lt-markdown-background",
        floor: 3.0,
        rule: "src/assets/reading/home.css `.home-row-heart`",
    },
    PaintedInk {
        what: "the folded list sheet's title",
        ink: "--lt-primary-ink",
        surface: "--lt-background",
        floor: 4.5,
        rule: "src/assets/reading/sheets.css `.home-sheet-title`",
    },
    PaintedInk {
        what: "the startup card's mark",
        ink: "--lt-primary-ink",
        surface: "--lt-background",
        floor: 3.0,
        rule: "src/assets/reading/base.css `.startup-card-mark`",
    },
    PaintedInk {
        what: "the leaf beside a file name and the app-bar logomark",
        ink: "--lt-primary-ink",
        surface: "--lt-surface",
        floor: 3.0,
        rule: "src/assets/reading/library.css `.library-file > .lt-icon` and app-bar.css `.app-brand-mark`",
    },
    PaintedInk {
        what: "the warning under a filter naming a field nobody set",
        ink: "--lt-warning",
        surface: "--lt-surface",
        floor: 4.5,
        rule: "src/assets/reading/library.css `.library-search-unknown`",
    },
    PaintedInk {
        what: "the failed save, the breadcrumb note, a failed diagram and Delete",
        ink: "--lt-danger",
        surface: "--lt-surface-elevated",
        floor: 4.5,
        rule: "src/assets/reading/reader-page.css `.app-toast.is-error`",
    },
];

/// Back to the spelling a theme file is written in, so a failure hands over the value somebody has to change rather than three floats.
fn hex_of(color: Rgb) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        (color.red * 255.0).round() as u8,
        (color.green * 255.0).round() as u8,
        (color.blue * 255.0).round() as u8
    )
}

/// Every row of the list that reads under its floor on this source, as the sentence the failure prints. A surface no source declares is not skipped — `css_token_for_source` panics on it, which is how a mistyped token stays loud instead of quietly dropping a row from the walk.
fn painted_ink_failures(css: &str, source: &ThemeSource, list: &[PaintedInk]) -> Vec<String> {
    let mut failures = Vec::new();

    for row in list {
        let ink = css_token_for_source(css, source, row.ink);
        let surface = css_token_for_source(css, source, row.surface);
        let ratio = contrast_ratio(ink, surface);
        if ratio < row.floor {
            failures.push(format!(
                "{} {}: {} reads {ratio:.2}, wanted {:.1} — {} {} on {} {}, at {}",
                source.family,
                source.appearance.as_str(),
                row.what,
                row.floor,
                row.ink,
                hex_of(ink),
                row.surface,
                hex_of(surface),
                row.rule
            ));
        }
    }

    failures
}

#[test]
fn theme_compiler_gates_every_painted_ink_for_every_source() {
    // Nine role colors the app paints as words or as thin marks — a link, the five alert labels, the action color's ink, the filter warning and the failed save — measured against the surface the rule that paints each one puts it on. The three gates beside this one walk twenty-eight token pairs and not one of them is a role ink on a page, which is how twenty-six pairs across nine families shipped under the same floor everything else is held to with every suite green.
    let css = reading_mode_css();
    let failures: Vec<String> = theme_sources()
        .iter()
        .flat_map(|source| painted_ink_failures(css, source, PAINT_LIST))
        .collect();

    assert!(
        failures.is_empty(),
        "{} painted inks read under their floor:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// The two amounts an inactive window is painted at, read out of the compiled stylesheet so this gate cannot drift from the rule that spends them.
fn inactive_amounts(css: &str) -> (f64, f64) {
    let blocks = css_blocks(css, ":root {");
    let read = |name: &str| {
        css_token_value(&blocks, name)
            .parse::<f64>()
            .unwrap_or_else(|_| panic!("expected {name} to be a plain number"))
    };

    (
        read("--lt-inactive-saturation"),
        read("--lt-inactive-contrast"),
    )
}

/// A color as an inactive window paints it: `saturate()` and then `contrast()`, in that order and in sRGB, which is what the browser does with the shorthand in `base.css`.
///
/// The saturation matrix is the Filter Effects specification's, and `contrast(c)` is a linear transfer of slope `c` about the 0.5 pivot. Both are here because the filter changes no token value, so every other contrast gate in this file is blind to the whole state: the ink and the paper each come out somewhere they were never written, and the ratio between them is the only one a reader ever sees.
fn as_an_inactive_window_paints_it(color: Rgb, saturation: f64, contrast: f64) -> Rgb {
    let saturated = Rgb {
        red: (0.213 + 0.787 * saturation) * color.red
            + (0.715 - 0.715 * saturation) * color.green
            + (0.072 - 0.072 * saturation) * color.blue,
        green: (0.213 - 0.213 * saturation) * color.red
            + (0.715 + 0.285 * saturation) * color.green
            + (0.072 - 0.072 * saturation) * color.blue,
        blue: (0.213 - 0.213 * saturation) * color.red
            + (0.715 - 0.715 * saturation) * color.green
            + (0.072 + 0.928 * saturation) * color.blue,
    };
    let pivot = 0.5 - 0.5 * contrast;
    let transfer = |channel: f64| (channel * contrast + pivot).clamp(0.0, 1.0);

    Rgb {
        red: transfer(saturated.red),
        green: transfer(saturated.green),
        blue: transfer(saturated.blue),
    }
}

/// The floor for this one state, and it is not the 4.5:1 the rest of the palette answers.
///
/// With nothing applied at all the tightest legible pair in the twenty-two sources reads 4.515:1, so any softening a reader can see drops something under 4.5 — `contrast(0.99)` alone reaches 4.453. 3:1 is the ratio the app already accepts for a border, an icon and large text, and a window another app is holding is a window the reader has stepped away from and is one click from restoring.
const INACTIVE_FLOOR: f64 = 3.0;

/// Every ink-and-surface pair the tree already declares: `READABLE_PAIRS`, where a family names the surface itself, and `PAINT_LIST`, where a stylesheet rule does.
///
/// The inactive-window gate walks these and invents none of its own. A cross product over every ink and every surface reads pairs the app never draws — it puts `--lt-danger` on `--lt-surface-muted`, which no rule paints, and calls three families unreadable on a combination nobody can see.
fn declared_pairs() -> Vec<(&'static str, &'static str, &'static str)> {
    READABLE_PAIRS
        .iter()
        .map(|(ink, surface)| (*ink, *surface, "the pair the family declares"))
        .chain(
            PAINT_LIST
                .iter()
                .map(|row| (row.ink, row.surface, row.what)),
        )
        .collect()
}

/// Every one of those pairs that reads under the floor once the window's filter is applied to both halves, as the sentence the failure prints.
fn inactive_ink_failures(
    css: &str,
    source: &ThemeSource,
    pairs: &[(&str, &str, &str)],
    floor: f64,
) -> Vec<String> {
    let (saturation, contrast) = inactive_amounts(css);
    let painted = |name: &str| {
        as_an_inactive_window_paints_it(
            css_token_for_source(css, source, name),
            saturation,
            contrast,
        )
    };
    let mut failures = Vec::new();

    for (ink_name, surface_name, what) in pairs {
        let ink = painted(ink_name);
        let surface = painted(surface_name);
        let ratio = contrast_ratio(ink, surface);
        if ratio < floor {
            failures.push(format!(
                "{} {}: {what} reads {ratio:.2} while another app has the window, wanted {floor:.1} — {ink_name} painted {} on {surface_name} painted {}, at src/assets/reading/base.css `body.is-window-inactive`",
                source.family,
                source.appearance.as_str(),
                hex_of(ink),
                hex_of(surface)
            ));
        }
    }

    failures
}

#[test]
fn the_arithmetic_this_gate_measures_with_is_the_arithmetic_the_window_paints() {
    // Read off the running window at the shipped amounts, which is the only thing that can say this model is the browser's: the document's darkest pixel, its paper, and the leaf in the app bar.
    let painted = |color: Rgb| as_an_inactive_window_paints_it(color, 0.5, 0.9);
    let rgb = |red: u8, green: u8, blue: u8| Rgb {
        red: red as f64 / 255.0,
        green: green as f64 / 255.0,
        blue: blue as f64 / 255.0,
    };

    for (before, after, what) in [
        (rgb(21, 24, 28), "#212224", "the document's darkest ink"),
        (rgb(255, 255, 255), "#f2f2f2", "the document's paper"),
        (rgb(216, 30, 40), "#8e3a3e", "the leaf in the app bar"),
    ] {
        assert_eq!(hex_of(painted(before)), after, "{what}");
    }
}

#[test]
fn every_family_stays_legible_while_another_app_has_the_window() {
    let css = reading_mode_css();
    let failures: Vec<String> = theme_sources()
        .iter()
        .flat_map(|source| inactive_ink_failures(css, source, &declared_pairs(), INACTIVE_FLOOR))
        .collect();

    assert!(
        failures.is_empty(),
        "{} pairs wash out while another app has the window:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn a_family_the_state_would_wash_out_is_named_rather_than_shipped() {
    // The shipping tree is green on purpose, so this is the only place the rejection half of the gate runs at all. `#8a8f94` on `#ffffff` reads 3.13 untouched and 2.86 once the window has painted both, which is the whole point: a pair that clears the floor before the filter can fail after it.
    const SELECTOR: &str = ":root[data-leaf-theme=\"test\"][data-leaf-appearance=\"light\"]";
    let css = format!(
        "{SELECTOR} {{\n  --lt-background: #ffffff;\n  --lt-foreground: #8a8f94;\n}}\n:root {{\n  --lt-inactive-saturation: 0.5;\n  --lt-inactive-contrast: 0.9;\n}}\n"
    );
    let source = ThemeSource {
        id: "test-light",
        family: "test",
        family_name: "Test",
        appearance: Appearance::Light,
        selector: SELECTOR,
        tokens: &[],
        overrides: &[],
        font_heading: "",
        font_body: "",
        font_code: "",
        font_google: "",
        pack: LEAFTEXT_ICON_PACK,
    };

    let failures = inactive_ink_failures(
        &css,
        &source,
        &[(
            "--lt-foreground",
            "--lt-background",
            "the chrome's own writing",
        )],
        INACTIVE_FLOOR,
    );

    assert_eq!(failures.len(), 1, "{failures:?}");
    // The family, the half, both painted values, the ratio, the floor and the rule — everything somebody needs to go and change a color without first finding where the token is spent.
    for part in [
        "test light",
        "the chrome's own writing",
        "wanted 3.0",
        "--lt-foreground painted",
        "src/assets/reading/base.css `body.is-window-inactive`",
    ] {
        assert_contains(&failures[0], part);
    }
}

#[test]
fn the_state_re_points_no_color_and_the_rail_keeps_no_list_of_its_own() {
    let css = reading_mode_css();

    // One rule, and one declaration in it. A hand-kept subset of tokens growing back beside the filter is the split this ticket closed: the chrome had eighteen colors and the rail thirty-two, and the document — the thing a reader came for — was in neither.
    assert_eq!(
        css.matches("body.is-window-inactive").count(),
        1,
        "more than one rule answers a window another app has taken, and the whole state is one filter"
    );
    let state = rule_body(
        css,
        "body.is-window-inactive:not(.leaf-paper):not(.leaf-paper-diagram):not(.leaf-paper-picture) .app-surface {",
    );
    assert!(
        !state.lines().any(|line| line.trim_start().starts_with("--lt-")),
        "the inactive state re-points a color again, so the document and the frame can part company: {state}"
    );

    // The rail draws its miniature in the document's own tokens, and under one filter over the whole surface that is what makes the two resolve to the same painted value for the same source color. A token re-pointed on the rail is the two lists coming back.
    for rule in css.split(".reader-minimap") {
        let Some(body) = rule.strip_prefix(" {").or_else(|| rule.strip_prefix(",")) else {
            continue;
        };
        let body = &body[..body.find('}').unwrap_or(body.len())];
        assert!(
            !body.contains("--lt-markdown")
                && !body.contains("--lt-syntax")
                && !body.contains("--lt-editor"),
            "the rail re-points a document color, so its miniature and the page it copies no longer paint alike: {body}"
        );
    }
}

/// A source built here rather than a family that happens to sit near a floor today, so the rule is pinned at its boundary in both directions and a re-tint cannot move what the check means.
fn a_source_painting(ink: &str) -> (String, ThemeSource) {
    const SELECTOR: &str = ":root[data-leaf-theme=\"test\"][data-leaf-appearance=\"light\"]";
    let css = format!(
        "{SELECTOR} {{\n  --lt-markdown-background: #ffffff;\n  --lt-markdown-link: {ink};\n}}\n"
    );

    (
        css,
        ThemeSource {
            id: "test-light",
            family: "test",
            family_name: "Test",
            appearance: Appearance::Light,
            selector: SELECTOR,
            tokens: &[],
            overrides: &[],
            font_heading: "",
            font_body: "",
            font_code: "",
            font_google: "",
            pack: LEAFTEXT_ICON_PACK,
        },
    )
}

/// The one row the two boundary tests measure: words at 4.5:1, which is where every failing pair in the list sits.
const ONE_LINK_ROW: &[PaintedInk] = &[PaintedInk {
    what: "a link in the document",
    ink: "--lt-markdown-link",
    surface: "--lt-markdown-background",
    floor: 4.5,
    rule: "src/assets/reading/document.css `.document-body a`",
}];

#[test]
fn a_painted_ink_a_hair_over_its_floor_is_accepted() {
    // `#767676` on white is 4.54:1 — the darkest gray that clears AA and the value the boundary is conventionally drawn at. A check that only ever sees inks far above its floor is one nobody has proved knows where the floor is.
    let (css, source) = a_source_painting("#767676");

    assert_eq!(
        painted_ink_failures(&css, &source, ONE_LINK_ROW),
        Vec::<String>::new()
    );
}

#[test]
fn a_painted_ink_a_step_under_its_floor_is_rejected_and_names_its_rule() {
    // One byte lighter: `#777777` on white is 4.48:1. The shipping tree proves nothing here — the walk above is red on purpose — so this is the only place the rejection half of the check is exercised at all.
    let (css, source) = a_source_painting("#777777");
    let failures = painted_ink_failures(&css, &source, ONE_LINK_ROW);

    assert_eq!(failures.len(), 1, "{failures:?}");
    // The family, the half, both values, the ratio, the floor and the rule — everything somebody needs to go to the line and change a color, without going and finding where the token is spent first.
    for part in [
        "test light",
        "a link in the document",
        "4.48",
        "wanted 4.5",
        "--lt-markdown-link #777777",
        "--lt-markdown-background #ffffff",
        "src/assets/reading/document.css `.document-body a`",
    ] {
        assert_contains(&failures[0], part);
    }
}

#[test]
#[should_panic(expected = "--lt-not-a-token")]
fn a_paint_row_naming_a_surface_no_source_declares_fails_loudly() {
    // A mistyped surface must not read as a row with nothing to measure. Skipping it would take that ink out of the walk on every source at once, and the list would stay green while nothing held it.
    const MISTYPED: &[PaintedInk] = &[PaintedInk {
        what: "a link in the document",
        ink: "--lt-markdown-link",
        surface: "--lt-not-a-token",
        floor: 4.5,
        rule: "src/assets/reading/document.css `.document-body a`",
    }];

    painted_ink_failures(reading_mode_css(), &theme_sources()[0], MISTYPED);
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

/// Every rule in the sheet that declares an icon drawing under a theme family — the pack blocks, and nothing else — as its selector and its declarations. Families sharing a pack share one block, so a selector here can name several.
fn pack_blocks(css: &str) -> impl Iterator<Item = (String, &str)> {
    css.split("\n}").filter_map(|rule| {
        let (head, body) = rule.rsplit_once(" {\n")?;
        // A selector list runs over several lines, so the selector is every line of the head that is not a comment.
        let selector: String = head
            .lines()
            .filter(|line| !line.trim_start().starts_with("/*"))
            .collect::<Vec<_>>()
            .join("");
        (selector.contains("[data-leaf-theme=") && body.contains("--lt-icon-"))
            .then_some((selector, body))
    })
}

/// Which pack each family wears is a `**Pack:**` line in its own file, and the stylesheet is what carries it to the page: a family naming an outside pack gets a block redeclaring the drawings that pack covers, and a family naming none is left with the drawings at the root — the ones it wears today. A pack that compiled into no block is a theme the reader would see no change from.
#[test]
fn a_family_naming_a_pack_wears_it_and_a_family_naming_none_wears_what_it_wears_today() {
    let css = reading_mode_css();
    let mut wearing = 0;
    let mut plain = 0;
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/themes")).expect("themes/")
    {
        let path = entry.expect("a theme file").path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("README.md") {
            continue;
        }
        let family = std::fs::read_to_string(&path).expect("a theme file reads");
        let id = family
            .lines()
            .find_map(|line| line.strip_prefix("**Family ID:** `"))
            .and_then(|rest| rest.split('`').next())
            .expect("every family declares its id");
        let named = family
            .lines()
            .find_map(|line| line.strip_prefix("**Pack:** `"))
            .and_then(|rest| rest.split('`').next());
        // Every family already opens a rule for its own colors, so the question is only whether one of its rules declares a drawing. Read off the selector rather than by name: families sharing a pack share one block, and the second one in that list starts mid-line.
        let drawings = pack_blocks(css)
            .any(|(selector, _)| selector.contains(&format!("[data-leaf-theme=\"{id}\"]")));
        match named {
            Some("leaftext") | None => {
                assert!(
                    !drawings,
                    "{id} names no outside pack and still has a block of drawings, so it is not wearing the set it wears today"
                );
                plain += 1;
            }
            Some(pack) => {
                assert!(
                    drawings,
                    "{id} wears {pack} and no block of drawings reaches it, so the theme would change nothing"
                );
                wearing += 1;
            }
        }
    }
    assert!(
        wearing > 0,
        "no family wears an outside pack, so nothing here is proved"
    );
    assert!(
        plain > 0,
        "every family wears an outside pack, so the fallback half is not proved"
    );
}

/// A pack covers the jobs it has a drawing for and no others, and the rest are not blanked — nothing is declared for them, so the value at the root stands and the reader sees the drawing they already know. An uncovered job that declared an empty value would be a control with no icon in it.
#[test]
fn an_icon_a_pack_does_not_cover_keeps_the_drawing_it_has() {
    let css = reading_mode_css();
    let block = pack_blocks(css)
        .next()
        .expect("a family wears an outside pack")
        .1;
    let covered: Vec<&str> = block
        .lines()
        .filter_map(|line| line.trim().strip_prefix("--lt-icon-"))
        .filter_map(|rest| rest.split(':').next())
        .collect();
    assert!(!covered.is_empty(), "the pack block declares nothing");

    let rows = icon_rows();
    let uncovered: Vec<&String> = rows
        .iter()
        .filter(|name| !covered.contains(&name.as_str()))
        .collect();
    assert!(
        !uncovered.is_empty(),
        "this pack covers every job, so the fallback it exists to prove never happens"
    );
    for name in uncovered {
        // Nothing declared for it under the family, and a drawing declared for it at the root: that pair is the fallback.
        assert!(
            css.contains(&format!("\n  --lt-icon-{name}: url(\"data:image/svg+xml,")),
            "{name} has no drawing at the root, so a family that does not cover it would show an empty box"
        );
    }
}

/// `icon: "leaf:back"` is something a document's author wrote, so it has to draw the same for every reader. A pack that reached the diagram set would redraw somebody else's document when they picked a theme.
#[test]
fn no_pack_drawing_reaches_the_diagram_icon_set() {
    let set = include_str!("../assets/mermaid-icons.js");
    let packs = std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/assets/icon-packs"
    ));
    let mut read = 0;
    if let Ok(folders) = std::fs::read_dir(packs) {
        for folder in folders.flatten() {
            for drawing in std::fs::read_dir(folder.path())
                .expect("a pack folder")
                .flatten()
            {
                let svg = std::fs::read_to_string(drawing.path()).expect("a drawing reads");
                let body = svg
                    .split_once('>')
                    .map(|(_, rest)| rest.trim_end().trim_end_matches("</svg>"))
                    .unwrap_or_default();
                assert!(
                    body.len() < 12 || !set.contains(body),
                    "{} reached the diagram icon set, so a document would redraw when its reader changes theme",
                    drawing.path().display()
                );
                read += 1;
            }
        }
    }
    assert!(
        read > 0,
        "no pack drawing was read, so nothing here is proved"
    );
}

/// Whichever pack a family wears, every one of the sixty-three controls has a drawing: the pack's own where it has one, and the root's where it does not. A family that resolved nothing for a job would draw an empty box in the window, and the reader has no way to ask what went missing.
#[test]
fn every_family_resolves_a_drawing_for_every_icon_by_pack_or_by_fallback() {
    let css = reading_mode_css();
    let names = icon_rows();
    let root: Vec<&String> = names
        .iter()
        .filter(|name| css.contains(&format!("\n  --lt-icon-{name}: url(\"data:image/svg+xml,")))
        .collect();
    assert_eq!(
        root.len(),
        names.len(),
        "the page root declares {} of {} drawings, so a family with no pack would already be short",
        root.len(),
        names.len()
    );

    for (family, _) in theme_families() {
        // A pack block may declare some, all or none of them; whatever it leaves out, the root above it answers. So the only way a control goes blank is a name the root never declared, which the count above rules out.
        let covered: Vec<&str> = pack_blocks(css)
            .filter(|(selector, _)| selector.contains(&format!("[data-leaf-theme=\"{family}\"]")))
            .flat_map(|(_, body)| {
                body.lines()
                    .filter_map(|line| line.trim().strip_prefix("--lt-icon-"))
                    .filter_map(|rest| rest.split(':').next())
                    .collect::<Vec<_>>()
            })
            .collect();
        for name in &names {
            assert!(
                covered.contains(&name.as_str()) || root.contains(&name),
                "{family} resolves no drawing for {name}, so that control would be an empty box"
            );
        }
    }
}

/// A page written out pins one theme on its root and carries no picker, so the five packs it is not wearing are drawings nothing on it can ever reach. The sheet beside it carries one, and everything else about the sheet is untouched.
///
/// Four things, and they fail apart. The pack a family wears has to survive the trip from its own file into the registry; the sheet handed to an export has to hold that pack's block; it has to hold no other; and the window's own sheet has to still hold all six, because the window is where a reader changes theme.
#[test]
fn an_exported_sheet_carries_the_one_pack_its_theme_wears() {
    // The comment the generator opens each block with, which is the one mark that block is in a sheet at all.
    let block_of = |pack: &str| format!("/* The {pack} pack,");
    let packs = icon_packs();
    assert_eq!(
        packs.len(),
        6,
        "the sheet compiled {} pack blocks",
        packs.len()
    );

    // Every family's declared pack, read off its own file, is the one the registry answers.
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/themes")).expect("themes/")
    {
        let path = entry.expect("a theme file").path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if !name.ends_with(".md") || name == "README.md" {
            continue;
        }
        let family = name.trim_end_matches(".md");
        let file = std::fs::read_to_string(&path).expect("the theme file reads");
        let declared = file
            .lines()
            .find_map(|line| line.strip_prefix("**Pack:**"))
            .map(|rest| rest.trim().trim_matches('`').to_string())
            .unwrap_or_else(|| LEAFTEXT_ICON_PACK.to_string());
        assert_eq!(
            icon_pack_for_theme(family),
            declared,
            "{family} wears {declared} in its own file"
        );
    }
    // A name no family has is the app's own set rather than a theme with no drawings at all.
    assert_eq!(icon_pack_for_theme("no-such-family"), LEAFTEXT_ICON_PACK);

    let window = reading_mode_css();
    for pack in &packs {
        assert!(
            window.contains(&block_of(pack)),
            "the window's sheet lost the {pack} block, and the window is where a theme is changed"
        );
    }

    // A family wearing an outside pack: its own block travels, and only its own.
    for wanted in &packs {
        let family = theme_families()
            .into_iter()
            .map(|(family, _)| family)
            .find(|family| icon_pack_for_theme(family) == *wanted)
            .unwrap_or_else(|| panic!("no family wears {wanted}"));
        let sheet = exported_page_css(family);
        assert!(
            sheet.contains(&block_of(wanted)),
            "a page pinned to {family} lost the {wanted} drawings it is wearing"
        );
        for other in packs.iter().filter(|pack| *pack != wanted) {
            assert!(
                !sheet.contains(&block_of(other)),
                "a page pinned to {family} carries the {other} block it can never wear"
            );
        }
        // Only the packs come out. Everything the sheet is otherwise made of stays whole, because which rules a document needs is a guess.
        assert!(
            sheet.contains(".app-surface"),
            "{family} lost the reading rules"
        );
        assert!(
            sheet.contains("--lt-icon-back:"),
            "{family} lost the drawings the root declares"
        );
        assert!(
            sheet.contains(".lt-icon-back {"),
            "{family} lost the icon classes"
        );
        assert!(
            sheet.contains(&format!("[data-leaf-theme=\"{family}\"]")),
            "{family} lost its own colors"
        );
        assert!(
            sheet.len() < window.len(),
            "the sheet for {family} is no smaller than the window's"
        );
    }

    // A family wearing the app's own set names no block at all, so its sheet carries none of the six.
    let plain = theme_families()
        .into_iter()
        .map(|(family, _)| family)
        .find(|family| icon_pack_for_theme(family) == LEAFTEXT_ICON_PACK)
        .expect("a family wearing the app's own drawings");
    let sheet = exported_page_css(plain);
    for pack in &packs {
        assert!(
            !sheet.contains(&block_of(pack)),
            "a page pinned to {plain} carries the {pack} block, and {plain} wears the app's own drawings"
        );
    }
    assert!(
        sheet.contains("--lt-icon-back:"),
        "{plain} lost the drawings it wears"
    );
}

#[test]
fn the_alternating_table_row_resolves_on_every_family_and_copies_the_recess() {
    // The stripe a reader follows one row along, across to its last column. It is one of the two colors a family may leave out, so what a silent family lands on is its own recess against its own page — not the one gray for everybody that left a dark table with no bands in it at all.
    assert!(
        LEAF_SEMANTIC_TOKEN_DEFAULTS
            .iter()
            .any(|(name, from)| *name == "--lt-markdown-table-row-background"
                && *from == "--lt-surface-sunken"),
        "the alternating row copies the recess when a family says nothing"
    );

    let sources = theme_sources();
    assert_eq!(sources.len(), 22, "eleven families in two appearances");

    for source in sources {
        let stripe = theme_source_token_value(source, "--lt-markdown-table-row-background")
            .unwrap_or_else(|| panic!("{} resolves the alternating row", source.id));
        let recess = theme_source_token_value(source, "--lt-surface-sunken")
            .unwrap_or_else(|| panic!("{} resolves the recess", source.id));

        let set = source
            .tokens
            .iter()
            .chain(source.overrides.iter())
            .any(|(name, _)| *name == "--lt-markdown-table-row-background");
        if !set {
            assert_eq!(
                stripe, recess,
                "expected {} to stripe with its own recess",
                source.id
            );
        }
    }
}
