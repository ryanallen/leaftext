use std::collections::HashSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The light or dark half of a theme family. A family (GitHub, Nightshade, Sage) pairs one of each; the appearance is chosen by the Appearance setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Appearance {
    Light,
    Dark,
}

impl Appearance {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Appearance::Light => "light",
            Appearance::Dark => "dark",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ThemeSource {
    /// Stable id for this exact palette, e.g. `github-light`.
    pub(crate) id: &'static str,
    /// Family id shared by a light/dark pair, e.g. `github`. This is what the Theme picker selects; the Appearance picker chooses which half shows.
    pub(crate) family: &'static str,
    /// Family display name shown in the picker, e.g. `GitHub`.
    pub(crate) family_name: &'static str,
    /// Whether this source is the family's light or dark variant.
    pub(crate) appearance: Appearance,
    /// The CSS selector that activates this source. Every source keys off the Leaf-owned `data-leaf-theme` (family) and `data-leaf-appearance` attrs the bootstrap stamps on `:root`.
    pub(crate) selector: &'static str,
    pub(crate) tokens: &'static [(&'static str, &'static str)],
    /// Per-source token replacements layered over `tokens` (and winning over them), to nudge one palette without forking the shared token map.
    pub(crate) overrides: &'static [(&'static str, &'static str)],
    /// The theme's fonts. `heading`/`body`/`code` are CSS font-family stacks; `font_google` is a Google Fonts stylesheet URL fetched on activation, or empty for families that render in the OS's own fonts (e.g. GitHub).
    pub(crate) font_heading: &'static str,
    pub(crate) font_body: &'static str,
    pub(crate) font_code: &'static str,
    pub(crate) font_google: &'static str,
    /// The icon pack this family wears, e.g. `heroicons`. `leaftext` is the app's own drawings, which is what a family file written before packs existed gets.
    pub(crate) pack: &'static str,
}

/// A theme's fonts, as stored in the Markdown theme files.
#[derive(Debug, Clone, Default)]
pub(crate) struct ThemeFonts {
    /// Font-family stack for headings.
    pub(crate) heading: String,
    /// Font-family stack for body/reading and app chrome text.
    pub(crate) body: String,
    /// Font-family stack for code.
    pub(crate) code: String,
    /// Google Fonts stylesheet URL to fetch on activation; empty = system fonts, fetch nothing. For now custom fonts must be pointed at Google Fonts.
    pub(crate) google: String,
}

/// The on-disk / bundled form of a [`ThemeSource`]: the same data with owned strings, so palettes live as data (`src/assets/themes.md`) instead of Rust consts. Parsed once at startup and leaked to `&'static` by [`theme_sources`], which keeps every downstream consumer working against `&'static` fields.
#[derive(Debug, Clone)]
pub(crate) struct ThemeFile {
    pub(crate) id: String,
    pub(crate) family: String,
    pub(crate) family_name: String,
    pub(crate) appearance: Appearance,
    pub(crate) selector: String,
    pub(crate) tokens: Vec<(String, String)>,
    pub(crate) overrides: Vec<(String, String)>,
    pub(crate) fonts: ThemeFonts,
    pub(crate) pack: String,
}

// GENERATED from design/colors.md by `just bundle-tokens` — do not edit by hand.
pub(crate) const LEAF_SEMANTIC_TOKEN_CONTRACT: &[&str] = &[
    "--lt-background",
    "--lt-foreground",
    "--lt-surface",
    "--lt-surface-elevated",
    "--lt-surface-muted",
    "--lt-surface-sunken",
    "--lt-border",
    "--lt-border-strong",
    "--lt-muted-foreground",
    "--lt-hover-tint",
    "--lt-primary",
    "--lt-primary-foreground",
    "--lt-accent",
    "--lt-accent-foreground",
    "--lt-danger",
    "--lt-danger-foreground",
    "--lt-warning",
    "--lt-success",
    "--lt-success-foreground",
    "--lt-done",
    "--lt-link",
    "--lt-link-hover",
    "--lt-focus-ring",
    "--lt-focus-selection-background",
    "--lt-focus-selection-foreground",
    "--lt-markdown-background",
    "--lt-markdown-foreground",
    "--lt-markdown-heading",
    "--lt-markdown-heading-2",
    "--lt-markdown-heading-3",
    "--lt-markdown-heading-4",
    "--lt-markdown-heading-5",
    "--lt-markdown-heading-6",
    "--lt-markdown-rule",
    "--lt-markdown-link",
    "--lt-markdown-blockquote-border",
    "--lt-markdown-blockquote-foreground",
    "--lt-markdown-alert-note",
    "--lt-markdown-alert-tip",
    "--lt-markdown-alert-important",
    "--lt-markdown-alert-warning",
    "--lt-markdown-alert-caution",
    "--lt-markdown-badge-background",
    "--lt-markdown-badge-foreground",
    "--lt-markdown-table-border",
    "--lt-markdown-table-header-background",
    "--lt-markdown-thematic-break",
    "--lt-markdown-math-inline-background",
    "--lt-markdown-keyboard-background",
    "--lt-markdown-keyboard-border",
    "--lt-editor-inline-code-background",
    "--lt-editor-inline-code-foreground",
    "--lt-editor-code-background",
    "--lt-editor-code-foreground",
    "--lt-editor-code-border",
    "--lt-editor-code-selection-background",
    "--lt-editor-code-selection-foreground",
    "--lt-syntax-background",
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
    "--lt-syntax-inserted",
    "--lt-syntax-inserted-background",
    "--lt-syntax-deleted",
    "--lt-syntax-deleted-background",
    "--lt-syntax-changed",
    "--lt-syntax-changed-background",
    "--lt-navigation-button-hover-background",
    "--lt-navigation-button-disabled-background",
    "--lt-navigation-button-disabled-foreground",
    "--lt-navigation-recent-border",
    "--lt-navigation-recent-item-foreground",
    "--lt-navigation-recent-item-hover-foreground",
    "--lt-minimap-viewport-border",
    "--lt-minimap-viewport-background",
];

/// A contract color a family may leave out, paired with the one whose value is copied in when it does. Everything not listed here is required of every family.
#[rustfmt::skip]
pub(crate) const LEAF_SEMANTIC_TOKEN_DEFAULTS: &[(&str, &str)] = &[
    ("--lt-hover-tint", "--lt-muted-foreground"),
];
// END GENERATED

// GENERATED from design/icons.md by `just bundle-icons` — do not edit by hand.
/// Where each outside icon pack's block sits inside `assets/icons.css`, as `(pack, start, end)` byte offsets. Only true of the exact sheet beside them, which is why one generator writes both.
#[rustfmt::skip]
pub(crate) const LEAF_ICON_PACK_RANGES: &[(&str, usize, usize)] = &[
    ("feather", 32489, 54967),
    ("lucide", 54967, 84499),
    ("tabler", 84499, 114389),
    ("remix", 114389, 145223),
    ("phosphor", 145223, 168889),
    ("heroicons", 168889, 190448),
];
// END GENERATED ICON PACKS

/// Leak an owned string to `&'static str`. Called only for the theme table, which is parsed once and lives for the whole process, so the leak is bounded.
fn leak_str(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
}

/// Leak an owned `(token, value)` list to the `&'static` slice `ThemeSource` holds.
fn leak_pairs(pairs: Vec<(String, String)>) -> &'static [(&'static str, &'static str)] {
    let leaked: Vec<(&'static str, &'static str)> = pairs
        .into_iter()
        .map(|(token, value)| (leak_str(token), leak_str(value)))
        .collect();
    Box::leak(leaked.into_boxed_slice())
}

fn theme_source_from_file(file: ThemeFile) -> ThemeSource {
    ThemeSource {
        id: leak_str(file.id),
        family: leak_str(file.family),
        family_name: leak_str(file.family_name),
        appearance: file.appearance,
        selector: leak_str(file.selector),
        tokens: leak_pairs(file.tokens),
        overrides: leak_pairs(file.overrides),
        font_heading: leak_str(file.fonts.heading),
        font_body: leak_str(file.fonts.body),
        font_code: leak_str(file.fonts.code),
        font_google: leak_str(file.fonts.google),
        pack: leak_str(file.pack),
    }
}

/// The registered theme sources (each family's light/dark pair). Parsed once from the bundled `src/assets/themes.md` and leaked to `&'static` so every consumer keeps working against `&'static` fields. Palettes are data: to add or edit a theme, edit the per-family Markdown files under `themes/` and run `just bundle-themes` — this function only loads the compiled bundle.
pub(crate) fn theme_sources() -> &'static [ThemeSource] {
    static SOURCES: OnceLock<Vec<ThemeSource>> = OnceLock::new();
    SOURCES.get_or_init(|| {
        let files = parse_theme_markdown(include_str!("assets/themes.md"));
        files.into_iter().map(theme_source_from_file).collect()
    })
}

/// The `--lt-` prefix stripped from token names in the Markdown theme files (for readability) and re-added here so downstream code keeps seeing the full CSS custom-property names from [`LEAF_SEMANTIC_TOKEN_CONTRACT`].
const TOKEN_PREFIX: &str = "--lt-";

/// Split a Markdown table row (`| a | b |`) into its trimmed cells, dropping the empty leading/trailing fields the surrounding pipes produce.
fn table_row_cells(line: &str) -> Vec<&str> {
    let mut cells: Vec<&str> = line.split('|').map(str::trim).collect();
    if cells.first().is_some_and(|c| c.is_empty()) {
        cells.remove(0);
    }
    if cells.last().is_some_and(|c| c.is_empty()) {
        cells.pop();
    }
    cells
}

/// True for a table's separator row (`| --- | :---: |`): every non-empty cell is only dashes with optional alignment colons.
fn is_table_separator(cells: &[&str]) -> bool {
    let mut saw_dash = false;
    for cell in cells {
        if cell.is_empty() {
            continue;
        }
        if !cell.chars().all(|c| c == '-' || c == ':') || !cell.contains('-') {
            return false;
        }
        saw_dash = true;
    }
    saw_dash
}

/// Unwrap a value cell's inline-code backticks (``` `#fff` ``` → `#fff`); an empty cell (an unset Google URL) stays empty.
fn unwrap_value(cell: &str) -> String {
    let trimmed = cell.trim();
    trimmed
        .strip_prefix('`')
        .and_then(|s| s.strip_suffix('`'))
        .unwrap_or(trimmed)
        .to_string()
}

/// Parse the bundled Markdown theme file (`themes/*.md` concatenated by `scripts/bundle-themes.mjs`) into one [`ThemeFile`] per light/dark source — see any `themes/*.md` for the shape. Token names are stored without the `--lt-` prefix and get it back here; a malformed file fails loudly at the startup contract check ([`assert_theme_sources_cover_contract`]).
fn parse_theme_markdown(md: &str) -> Vec<ThemeFile> {
    /// One family's accumulated data before it is split into light/dark sources.
    #[derive(Default)]
    struct FamilyAcc {
        name: String,
        id: String,
        fonts: ThemeFonts,
        pack: String,
        light_tokens: Vec<(String, String)>,
        light_overrides: Vec<(String, String)>,
        dark_tokens: Vec<(String, String)>,
        dark_overrides: Vec<(String, String)>,
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Section {
        None,
        Fonts,
        Light,
        Dark,
    }
    #[derive(Clone, Copy, PartialEq)]
    enum Bucket {
        Tokens,
        Overrides,
    }

    let mut families: Vec<FamilyAcc> = Vec::new();
    let mut section = Section::None;
    let mut bucket = Bucket::Tokens;
    let mut in_table_body = false;

    for raw in md.lines() {
        let line = raw.trim_end();

        if let Some(name) = line.strip_prefix("# ") {
            families.push(FamilyAcc {
                name: name.trim().to_string(),
                ..Default::default()
            });
            section = Section::None;
            bucket = Bucket::Tokens;
            in_table_body = false;
            continue;
        }
        let Some(family) = families.last_mut() else {
            continue; // preamble before the first family heading (e.g. the comment)
        };

        if let Some(rest) = line.strip_prefix("**Family ID:**") {
            family.id = unwrap_value(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("**Pack:**") {
            family.pack = unwrap_value(rest);
            continue;
        }
        if let Some(heading) = line.strip_prefix("## ") {
            in_table_body = false;
            section = match heading.trim().to_ascii_lowercase().as_str() {
                "fonts" => Section::Fonts,
                "light" => {
                    bucket = Bucket::Tokens;
                    Section::Light
                }
                "dark" => {
                    bucket = Bucket::Tokens;
                    Section::Dark
                }
                _ => Section::None,
            };
            continue;
        }
        if let Some(heading) = line.strip_prefix("### ") {
            in_table_body = false;
            bucket = match heading.trim().to_ascii_lowercase().as_str() {
                "overrides" => Bucket::Overrides,
                _ => Bucket::Tokens,
            };
            continue;
        }
        if line.starts_with('|') {
            let cells = table_row_cells(line);
            if is_table_separator(&cells) {
                in_table_body = true;
                continue;
            }
            if !in_table_body {
                continue; // the header row, above the separator
            }
            let key = cells.first().copied().unwrap_or("").trim();
            let value = cells.get(1).map(|c| unwrap_value(c)).unwrap_or_default();
            match section {
                Section::Fonts => match key.to_ascii_lowercase().as_str() {
                    "heading" => family.fonts.heading = value,
                    "body" => family.fonts.body = value,
                    "code" => family.fonts.code = value,
                    "google" => family.fonts.google = value,
                    _ => {}
                },
                Section::Light | Section::Dark => {
                    let token = format!("{TOKEN_PREFIX}{key}");
                    let target = match (section, bucket) {
                        (Section::Light, Bucket::Tokens) => &mut family.light_tokens,
                        (Section::Light, Bucket::Overrides) => &mut family.light_overrides,
                        (Section::Dark, Bucket::Tokens) => &mut family.dark_tokens,
                        (Section::Dark, Bucket::Overrides) => &mut family.dark_overrides,
                        _ => unreachable!(),
                    };
                    target.push((token, value));
                }
                Section::None => {}
            }
            continue;
        }
        // Any other line (prose, blank) ends the current table.
        in_table_body = false;
    }

    let mut files = Vec::with_capacity(families.len() * 2);
    for family in families {
        assert!(
            !family.id.is_empty(),
            "theme family {:?} is missing its **Family ID:** line",
            family.name
        );
        for (appearance, tokens, overrides) in [
            (
                Appearance::Light,
                family.light_tokens,
                family.light_overrides,
            ),
            (Appearance::Dark, family.dark_tokens, family.dark_overrides),
        ] {
            let appearance_str = appearance.as_str();
            files.push(ThemeFile {
                id: format!("{}-{appearance_str}", family.id),
                family: family.id.clone(),
                family_name: family.name.clone(),
                appearance,
                selector: format!(
                    ":root[data-leaf-theme=\"{}\"][data-leaf-appearance=\"{appearance_str}\"]",
                    family.id
                ),
                tokens,
                overrides,
                fonts: family.fonts.clone(),
                // A file written before packs existed names none and wears the app's own set, which is what it is already drawn with — the same fallback `scripts/bundle-icons.mjs` applies when it compiles the sheet.
                pack: match family.pack.is_empty() {
                    true => LEAFTEXT_ICON_PACK.to_string(),
                    false => family.pack.clone(),
                },
            });
        }
    }
    files
}

/// The theme families for the picker, in display order: `(family id, name)`, each appearing once. Derived from [`theme_sources`], so registering a new family's light/dark pair adds it here automatically.
#[allow(dead_code)]
pub(crate) fn theme_families() -> Vec<(&'static str, &'static str)> {
    let mut families: Vec<(&'static str, &'static str)> = Vec::new();
    for source in theme_sources() {
        if !families.iter().any(|(id, _)| *id == source.family) {
            families.push((source.family, source.family_name));
        }
    }
    families
}

pub(crate) fn compiled_theme_css() -> String {
    let sources = theme_sources();
    assert_theme_sources_cover_contract(sources);

    let mut css = String::new();
    css.push_str("/* Leaf semantic theme compiler output. */\n");
    for source in sources {
        css.push_str(source.selector);
        css.push_str(" {\n");
        css.push_str("  --lt-theme-source: ");
        css.push_str(source.id);
        css.push_str(";\n");
        for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
            let value = theme_source_token_value(source, token)
                .unwrap_or_else(|| panic!("theme source {} missing {token}", source.id));
            css.push_str("  ");
            css.push_str(token);
            css.push_str(": ");
            css.push_str(value);
            css.push_str(";\n");
        }
        css.push_str("}\n");
    }
    // Per-family font blocks, keyed on the family (not the light/dark source, since a family's fonts are shared).
    let mut seen_families: Vec<&str> = Vec::new();
    for source in sources {
        if seen_families.contains(&source.family) {
            continue;
        }
        seen_families.push(source.family);
        css.push_str(":root[data-leaf-theme=\"");
        css.push_str(source.family);
        css.push_str("\"] {\n");
        css.push_str("  --heading-font: ");
        css.push_str(source.font_heading);
        css.push_str(";\n  --reading-font: ");
        css.push_str(source.font_body);
        css.push_str(";\n  --app-font: ");
        css.push_str(source.font_body);
        css.push_str(";\n  --code-font: ");
        css.push_str(source.font_code);
        css.push_str(";\n}\n");
    }
    css
}

pub(crate) fn assert_theme_sources_cover_contract(sources: &[ThemeSource]) {
    let mut ids = HashSet::new();

    for source in sources {
        assert!(
            ids.insert(source.id),
            "duplicate theme source {}",
            source.id
        );
        assert!(
            !source.family_name.trim().is_empty(),
            "theme source {} must have a family name",
            source.id
        );
        // Every source activates through the Leaf-owned family + appearance attributes, so its selector must name both.
        assert!(
            source.selector.contains(source.family)
                && source.selector.contains(source.appearance.as_str()),
            "theme source {} selector must key off its family and appearance",
            source.id
        );
        let mut seen = HashSet::new();
        for (token, _) in source.tokens {
            assert!(
                seen.insert(*token),
                "theme source {} declares duplicate token {token}",
                source.id
            );
        }
        for token in LEAF_SEMANTIC_TOKEN_CONTRACT {
            // Only the rows with no default are demanded: a defaulted one resolves through the row it copies, so a family that leaves it out is complete.
            assert!(
                theme_source_token_value(source, token).is_some(),
                "theme source {} missing required token {token}",
                source.id
            );
        }
    }

    // The picker needs at least two families, and every family must offer both a light and a dark variant so the Appearance control always has both to pick.
    let mut families: Vec<&str> = Vec::new();
    for source in sources {
        if !families.contains(&source.family) {
            families.push(source.family);
        }
    }
    assert!(
        families.len() >= 2,
        "expected at least two theme families for the picker"
    );
    for family in families {
        let has_light = sources
            .iter()
            .any(|source| source.family == family && source.appearance == Appearance::Light);
        let has_dark = sources
            .iter()
            .any(|source| source.family == family && source.appearance == Appearance::Dark);
        assert!(
            has_light && has_dark,
            "theme family {family} must define both a light and a dark variant"
        );
    }
}

/// What this family itself says a token is, overrides winning over the base table. `None` means it never named the token at all.
fn declared_token_value(source: &ThemeSource, token: &str) -> Option<&'static str> {
    source
        .overrides
        .iter()
        .chain(source.tokens.iter())
        .find_map(|(name, value)| (*name == token).then_some(*value))
}

/// The value a family compiles a token to. A token with a default in [`LEAF_SEMANTIC_TOKEN_DEFAULTS`] may go unnamed, and copies the value of the row it defaults to — the value itself, so the compiled block stays a flat list of colors rather than one name pointing at another.
pub(crate) fn theme_source_token_value(source: &ThemeSource, token: &str) -> Option<&'static str> {
    declared_token_value(source, token).or_else(|| {
        LEAF_SEMANTIC_TOKEN_DEFAULTS
            .iter()
            .find(|(name, _)| *name == token)
            .and_then(|(_, from)| declared_token_value(source, from))
    })
}

/// The registered theme family ids as a JSON array (registration order), injected into the bootstrap so its `VALID_FAMILIES` set derives from the registry rather than a hand-kept literal that can drift.
pub(crate) fn theme_family_ids_json() -> String {
    let ids: Vec<&str> = theme_families().iter().map(|(id, _)| *id).collect();
    serde_json::to_string(&ids).expect("theme family ids serialize")
}

/// Family → Google Fonts stylesheet URL for the bootstrap's on-activation font loader, taken from each theme's declared `google` URL. Families that fetch nothing (empty URL) are omitted, so the loader drops the link and the family falls to its system stack.
pub(crate) fn theme_web_font_hrefs_json() -> String {
    let mut map = serde_json::Map::new();
    for source in theme_sources() {
        if !source.font_google.is_empty() {
            map.entry(source.family.to_string())
                .or_insert_with(|| serde_json::Value::String(source.font_google.to_string()));
        }
    }
    serde_json::to_string(&map).expect("theme web font map serializes")
}

/// The app's own drawings: a pack a family may name, and the one every family that names none wears.
pub(crate) const LEAFTEXT_ICON_PACK: &str = "leaftext";

// Assets, not Rust literals, so they stay editable as CSS. Every `var(--lt-*)` resolves against what came before it: the per-theme colors, then the app-wide scales, then the rules that spend both.
const TOKENS_CSS: &str = include_str!("assets/tokens.css");
const ICONS_CSS: &str = include_str!("assets/icons.css");
// The stylesheet as ordered parts, one per component group, joined with nothing between them. Order is the cascade — at equal specificity the later rule wins — so a part is a contiguous run of lines and never a rule lifted out of one, and a separator here would put a character in the sheet that no part holds. `scripts/reading-css.mjs` reads this array, so a part added to the app is a part every check sees.
const READING_CSS_PARTS: &[&str] = &[
    // The reset, the theme root, the window frame and the reduced-motion opt-out. First because everything below resolves against it.
    include_str!("assets/reading/base.css"),
    // The bar across the top: the brand, the tabs and their hearts, the overflow fold and the window controls.
    include_str!("assets/reading/app-bar.css"),
    // What floats over the app: the context menu, the rename box, the updater panel — and the one grouped rule that gives every one of them its shadow.
    include_str!("assets/reading/panels.css"),
    // The spinner and every button the bars press, including the app-wide `button:hover` the design system holds each control against.
    include_str!("assets/reading/buttons.css"),
    // The pane down the left: its frame, its scroll, the search and its hits, the breadcrumbs and their menu, the files and folders. One part rather than two, because `.library-hit-title` is written twice inside it — a block that clips near the top and a flex row that does not near the foot, 443 lines apart and decided by nothing but their order.
    include_str!("assets/reading/library.css"),
    // The map, in the reader's own cell and wearing the page's frame because it stands in for the page.
    include_str!("assets/reading/reader-graph.css"),
    // The floating bar over the foot of the page: the views, then the edits.
    include_str!("assets/reading/reader-toolbar.css"),
    // The page itself — its cell, its edges, its scroller and what it says while it loads — and the toast and first-run bubble that sit over it.
    include_str!("assets/reading/reader-page.css"),
    // A rendered document's own typography: headings, links, lists, the outline, the data and TEI blocks, and what the speed reader does to all of it.
    include_str!("assets/reading/document.css"),
    // The handle you drag a block by and the plus that writes a new one, in the page's left margin.
    include_str!("assets/reading/block-gutter.css"),
    // The bar that appears over selected text.
    include_str!("assets/reading/selection-toolbar.css"),
    // Quotes, alerts, code and an undrawn diagram — everything in a document that comes in a block of its own, and the syntax colors inside it.
    include_str!("assets/reading/document-code.css"),
    // The source view: the Monaco editor and the heading trail pinned over it.
    include_str!("assets/reading/code-view.css"),
    // Math, footnotes, tables, pictures and a note's own field block, and the openers that put a table or a picture on the whole window.
    include_str!("assets/reading/document-tables.css"),
    // The rail down the right, in the shell's own column so nothing in it can bleed onto the page.
    include_str!("assets/reading/minimap.css"),
    // The start screen: the empty state, the recent and favorite lists, and the rows they hold.
    include_str!("assets/reading/home.css"),
    // Everything that rises from the bottom of the window — the scrim, the sheet itself, the glossary, home and theme sheets — plus the scroll areas and the link preview.
    include_str!("assets/reading/sheets.css"),
    // The flowchart editor: its panes, its canvas, the handles laid over the drawing and the menus they open.
    include_str!("assets/reading/flow-sheet.css"),
    // A drawn diagram's own corner controls.
    include_str!("assets/reading/diagram-tools.css"),
    // A diagram, a table or a picture opened over the whole window.
    include_str!("assets/reading/full-window.css"),
    // Find in this document: the bar over both views, and the wash every match takes.
    include_str!("assets/reading/find.css"),
    // Last, and last on purpose: the page as it is handed to paper unwinds the window frame every rule above it sets up.
    include_str!("assets/reading/print.css"),
];

/// The stylesheet, composed over one icon sheet: the theme colors, the app-wide scales, those drawings, then the rules that spend all three. Every `var(--lt-*)` resolves against what came before it, so the order is the whole of it.
///
/// Taking the drawings as an argument is what lets an exported page get a sheet of its own without a second copy of this order — the window is composed over the complete sheet, an export over the same sheet with the five packs it can never wear cut out.
fn compose_reading_css(icons: &str) -> String {
    let mut css = compiled_theme_css();
    css.push('\n');
    css.push_str(TOKENS_CSS);
    css.push('\n');
    css.push_str(icons);
    css.push('\n');
    for part in READING_CSS_PARTS {
        css.push_str(part);
    }
    css
}

pub fn reading_mode_css() -> &'static str {
    static READING_MODE_CSS: OnceLock<String> = OnceLock::new();
    // Every pack, because the window has a theme picker in it: whichever family the reader lands on next, its drawings are already here.
    READING_MODE_CSS.get_or_init(|| compose_reading_css(ICONS_CSS))
}

/// The icon pack a theme family wears. A family nothing declares wears the app's own set, which is what it is already drawn with.
pub fn icon_pack_for_theme(family: &str) -> &'static str {
    theme_sources()
        .iter()
        .find(|source| source.family == family)
        .map_or(LEAFTEXT_ICON_PACK, |source| source.pack)
}

/// Every outside icon pack the sheet carries a block for, in the order it carries them. `leaftext` is not one: the app's own drawings are what the root declares, so a family wearing them needs no block.
pub fn icon_packs() -> Vec<&'static str> {
    LEAF_ICON_PACK_RANGES
        .iter()
        .map(|(pack, _, _)| *pack)
        .collect()
}

/// The stylesheet an exported page gets: the whole of the window's sheet but for the icon packs the page can never wear.
///
/// A page written out pins one theme and carries no picker, so five of the six outside packs are drawings it can never reach. Only those blocks come out: which reading rules a document needs is a guess, and a rule missed is a page that looks wrong in a way nobody sees coming.
pub fn exported_page_css(family: &str) -> String {
    compose_reading_css(&icons_css_for_pack(icon_pack_for_theme(family)))
}

/// The icon sheet with every outside pack's block cut out but the one named, sliced by the byte ranges the generator wrote beside the sheet itself. `leaftext` names no block, so it keeps only the drawings the root declares.
fn icons_css_for_pack(pack: &str) -> String {
    let mut css = String::with_capacity(ICONS_CSS.len());
    let mut at = 0;
    // In ascending order and never overlapping, because the generator counted them as it wrote the lines.
    for (name, start, end) in LEAF_ICON_PACK_RANGES {
        if *name == pack {
            continue;
        }
        css.push_str(&ICONS_CSS[at..*start]);
        at = *end;
    }
    css.push_str(&ICONS_CSS[at..]);
    css
}
