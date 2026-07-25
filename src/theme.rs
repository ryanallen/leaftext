use std::collections::HashSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The light or dark half of a theme family. A family (GitHub, Nightshade, Sage)
/// pairs one of each; the appearance is chosen by the Appearance setting.
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
    /// Family id shared by a light/dark pair, e.g. `github`. This is what the
    /// Theme picker selects; the Appearance picker chooses which half shows.
    pub(crate) family: &'static str,
    /// Family display name shown in the picker, e.g. `GitHub`.
    pub(crate) family_name: &'static str,
    /// Whether this source is the family's light or dark variant.
    pub(crate) appearance: Appearance,
    /// The CSS selector that activates this source. Every source keys off the
    /// Leaf-owned `data-leaf-theme` (family) and `data-leaf-appearance` attrs the
    /// bootstrap stamps on `:root`.
    pub(crate) selector: &'static str,
    pub(crate) tokens: &'static [(&'static str, &'static str)],
    /// Per-source token replacements layered over `tokens` (and winning over
    /// them), to nudge one palette without forking the shared token map.
    pub(crate) overrides: &'static [(&'static str, &'static str)],
    /// The theme's fonts. `heading`/`body`/`code` are CSS font-family stacks;
    /// `font_google` is a Google Fonts stylesheet URL fetched on activation, or
    /// empty for families that render in the OS's own fonts (e.g. GitHub).
    pub(crate) font_heading: &'static str,
    pub(crate) font_body: &'static str,
    pub(crate) font_code: &'static str,
    pub(crate) font_google: &'static str,
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
    /// Google Fonts stylesheet URL to fetch on activation; empty = system fonts,
    /// fetch nothing. For now custom fonts must be pointed at Google Fonts.
    pub(crate) google: String,
}

/// The on-disk / bundled form of a [`ThemeSource`]: the same data with owned
/// strings, so palettes live as data (`src/assets/themes.md`) instead of Rust
/// consts. Parsed once at startup and leaked to `&'static` by [`theme_sources`],
/// which keeps every downstream consumer working against `&'static` fields.
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
}

pub(crate) const LEAF_SEMANTIC_TOKEN_CONTRACT: &[&str] = &[
    "--leaf-background",
    "--leaf-foreground",
    "--leaf-surface",
    "--leaf-surface-raised",
    "--leaf-surface-elevated",
    "--leaf-surface-muted",
    "--leaf-surface-sunken",
    "--leaf-surface-inset",
    "--leaf-surface-card",
    "--leaf-border",
    "--leaf-border-strong",
    "--leaf-muted-background",
    "--leaf-muted-foreground",
    "--leaf-primary",
    "--leaf-primary-foreground",
    "--leaf-secondary",
    "--leaf-secondary-foreground",
    "--leaf-accent",
    "--leaf-accent-foreground",
    "--leaf-danger",
    "--leaf-danger-foreground",
    "--leaf-warning",
    "--leaf-warning-foreground",
    "--leaf-success",
    "--leaf-success-foreground",
    "--leaf-done",
    "--leaf-done-foreground",
    "--leaf-link",
    "--leaf-link-hover",
    "--leaf-shadow",
    "--leaf-editor-background",
    "--leaf-editor-foreground",
    "--leaf-editor-selection-background",
    "--leaf-editor-selection-foreground",
    "--leaf-editor-inline-code-background",
    "--leaf-editor-inline-code-foreground",
    "--leaf-editor-code-background",
    "--leaf-editor-code-foreground",
    "--leaf-editor-code-border",
    "--leaf-editor-code-selection-background",
    "--leaf-editor-code-selection-foreground",
    "--leaf-markdown-background",
    "--leaf-markdown-foreground",
    "--leaf-markdown-heading",
    "--leaf-markdown-heading-2",
    "--leaf-markdown-heading-3",
    "--leaf-markdown-heading-4",
    "--leaf-markdown-heading-5",
    "--leaf-markdown-heading-6",
    "--leaf-markdown-muted-foreground",
    "--leaf-markdown-border",
    "--leaf-markdown-rule",
    "--leaf-markdown-link",
    "--leaf-markdown-link-hover",
    "--leaf-markdown-inline-code-background",
    "--leaf-markdown-inline-code-foreground",
    "--leaf-markdown-blockquote-background",
    "--leaf-markdown-blockquote-border",
    "--leaf-markdown-blockquote-foreground",
    "--leaf-markdown-alert-note",
    "--leaf-markdown-alert-tip",
    "--leaf-markdown-alert-important",
    "--leaf-markdown-alert-warning",
    "--leaf-markdown-alert-caution",
    "--leaf-markdown-alert-done",
    "--leaf-markdown-badge-background",
    "--leaf-markdown-badge-foreground",
    "--leaf-markdown-table-border",
    "--leaf-markdown-table-header-background",
    "--leaf-markdown-thematic-break",
    "--leaf-markdown-math-inline-background",
    "--leaf-markdown-keyboard-background",
    "--leaf-markdown-keyboard-border",
    "--leaf-minimap-background",
    "--leaf-minimap-border",
    "--leaf-minimap-viewport-border",
    "--leaf-minimap-viewport-background",
    "--leaf-minimap-heading",
    "--leaf-minimap-paragraph",
    "--leaf-minimap-blank",
    "--leaf-minimap-list",
    "--leaf-minimap-blockquote",
    "--leaf-minimap-code",
    "--leaf-navigation-border",
    "--leaf-navigation-button-background",
    "--leaf-navigation-button-foreground",
    "--leaf-navigation-button-hover-background",
    "--leaf-navigation-button-disabled-background",
    "--leaf-navigation-button-disabled-foreground",
    "--leaf-navigation-recent-border",
    "--leaf-navigation-recent-item-foreground",
    "--leaf-navigation-recent-item-hover-foreground",
    "--leaf-focus-ring",
    "--leaf-focus-selection-background",
    "--leaf-focus-selection-foreground",
    "--leaf-syntax-background",
    "--leaf-syntax-foreground",
    "--leaf-syntax-comment",
    "--leaf-syntax-keyword",
    "--leaf-syntax-string",
    "--leaf-syntax-number",
    "--leaf-syntax-function",
    "--leaf-syntax-variable",
    "--leaf-syntax-type",
    "--leaf-syntax-operator",
    "--leaf-syntax-punctuation",
    "--leaf-syntax-inserted",
    "--leaf-syntax-inserted-background",
    "--leaf-syntax-deleted",
    "--leaf-syntax-deleted-background",
    "--leaf-syntax-changed",
    "--leaf-syntax-changed-background",
];

/// Leak an owned string to `&'static str`. Called only for the theme table,
/// which is parsed once and lives for the whole process, so the leak is bounded.
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
    }
}

/// The registered theme sources (each family's light/dark pair). Parsed once
/// from the bundled `src/assets/themes.md` and leaked to `&'static` so every
/// consumer keeps working against `&'static` fields. Palettes are data now: to
/// add or edit a theme, edit the per-family Markdown files under `themes/` and
/// run `just bundle-themes` — this function only loads the compiled bundle.
pub(crate) fn theme_sources() -> &'static [ThemeSource] {
    static SOURCES: OnceLock<Vec<ThemeSource>> = OnceLock::new();
    SOURCES.get_or_init(|| {
        let files = parse_theme_markdown(include_str!("assets/themes.md"));
        files.into_iter().map(theme_source_from_file).collect()
    })
}

/// The `--leaf-` prefix stripped from token names in the Markdown theme files
/// (for readability) and re-added here so downstream code keeps seeing the full
/// CSS custom-property names from [`LEAF_SEMANTIC_TOKEN_CONTRACT`].
const TOKEN_PREFIX: &str = "--leaf-";

/// Split a Markdown table row (`| a | b |`) into its trimmed cells, dropping the
/// empty leading/trailing fields the surrounding pipes produce.
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

/// True for a table's separator row (`| --- | :---: |`): every non-empty cell is
/// only dashes with optional alignment colons.
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

/// Unwrap a value cell's inline-code backticks (``` `#fff` ``` → `#fff`); an
/// empty cell (an unset Google URL) stays empty.
fn unwrap_value(cell: &str) -> String {
    let trimmed = cell.trim();
    trimmed
        .strip_prefix('`')
        .and_then(|s| s.strip_suffix('`'))
        .unwrap_or(trimmed)
        .to_string()
}

/// Parse the bundled Markdown theme file (`themes/*.md` concatenated by
/// `scripts/bundle-themes.mjs`) into one [`ThemeFile`] per light/dark source —
/// see any `themes/*.md` for the shape. Token names are stored without the
/// `--leaf-` prefix and get it back here; a malformed file fails loudly at the
/// startup contract check ([`assert_theme_sources_cover_contract`]).
fn parse_theme_markdown(md: &str) -> Vec<ThemeFile> {
    /// One family's accumulated data before it is split into light/dark sources.
    #[derive(Default)]
    struct FamilyAcc {
        name: String,
        id: String,
        fonts: ThemeFonts,
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
            });
        }
    }
    files
}

/// The theme families for the picker, in display order: `(family id, name)`,
/// each appearing once. Derived from [`theme_sources`], so registering a new
/// family's light/dark pair adds it here automatically.
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
        css.push_str("  --leaf-theme-source: ");
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
    // Per-family font blocks, keyed on the family (not the light/dark source, since
    // a family's fonts are shared). Emitted at family specificity so the locale
    // `[data-locale="zh-CN"]` rule (equal specificity, later in the sheet) can
    // still win the reading font for CJK readers.
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
        // Every source activates through the Leaf-owned family + appearance
        // attributes, so its selector must name both.
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
            assert!(
                theme_source_token_value(source, token).is_some(),
                "theme source {} missing required token {token}",
                source.id
            );
        }
    }

    // The picker needs at least two families, and every family must offer both a
    // light and a dark variant so the Appearance control always has both to pick.
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

pub(crate) fn theme_source_token_value(source: &ThemeSource, token: &str) -> Option<&'static str> {
    source
        .overrides
        .iter()
        .chain(source.tokens.iter())
        .find_map(|(name, value)| (*name == token).then_some(*value))
}

/// The registered theme family ids as a JSON array (registration order),
/// injected into the bootstrap so its `VALID_FAMILIES` set derives from the
/// registry rather than a hand-kept literal that can drift.
pub(crate) fn theme_family_ids_json() -> String {
    let ids: Vec<&str> = theme_families().iter().map(|(id, _)| *id).collect();
    serde_json::to_string(&ids).expect("theme family ids serialize")
}

/// Family → Google Fonts stylesheet URL for the bootstrap's on-activation font
/// loader, taken from each theme's declared `google` URL. Families that fetch
/// nothing (empty URL) are omitted, so the loader drops the link and the family
/// falls to its system stack.
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

pub(crate) fn reading_mode_css() -> &'static str {
    static READING_MODE_CSS: OnceLock<String> = OnceLock::new();

    READING_MODE_CSS.get_or_init(|| {
        let mut css = String::new();
        css.push_str(&compiled_theme_css());
        css.push_str(
            r#"
:root {
  color-scheme: light dark;
  /* App bar height, shared by the bar itself and everything that offsets content
     below the fixed bar (document padding, library pane, minimap). */
  --app-bar-height: 40px;
  --surface-page: var(--leaf-markdown-background);
  --surface-raised: var(--leaf-surface-raised);
  --surface-card: var(--leaf-surface-card);
  --surface-inset: var(--leaf-surface-inset);
  --background: var(--leaf-background);
  --foreground: var(--leaf-foreground);
  --surface: var(--leaf-surface);
  --surface-elevated: var(--leaf-surface-elevated);
  --surface-muted: var(--leaf-surface-muted);
  --surface-sunken: var(--leaf-surface-sunken);
  --border: var(--leaf-border);
  --border-strong: var(--leaf-border-strong);
  --muted: var(--leaf-muted-background);
  --muted-foreground: var(--leaf-muted-foreground);
  --primary: var(--leaf-primary);
  --primary-foreground: var(--leaf-primary-foreground);
  --secondary: var(--leaf-secondary);
  --secondary-foreground: var(--leaf-secondary-foreground);
  --accent: var(--leaf-accent);
  --accent-foreground: var(--leaf-accent-foreground);
  --danger: var(--leaf-danger);
  --danger-foreground: var(--leaf-danger-foreground);
  --warning: var(--leaf-warning);
  --warning-foreground: var(--leaf-warning-foreground);
  --success: var(--leaf-success);
  --success-foreground: var(--leaf-success-foreground);
  --done: var(--leaf-done);
  --done-foreground: var(--leaf-done-foreground);
  --link: var(--leaf-link);
  --link-hover: var(--leaf-link-hover);
  --selection: var(--leaf-focus-selection-background);
  --focus-ring: var(--leaf-focus-ring);
  --shadow: var(--leaf-shadow);
  --reading-background: var(--leaf-markdown-background);
  --reading-ink: var(--leaf-markdown-foreground);
  --reading-heading: var(--leaf-markdown-heading);
  --reading-link: var(--leaf-markdown-link);
  --reading-rule: var(--leaf-markdown-rule);
  --reading-code-bg: var(--leaf-editor-inline-code-background);
  --reading-quote-bar: var(--leaf-markdown-blockquote-border);
  --markdown-code-background: var(--leaf-editor-inline-code-background);
  --markdown-code-foreground: var(--leaf-editor-inline-code-foreground);
  --markdown-blockquote-border: var(--leaf-markdown-blockquote-border);
  --markdown-blockquote-foreground: var(--leaf-markdown-blockquote-foreground);
  --markdown-table-border: var(--leaf-markdown-table-border);
  --markdown-table-header-background: var(--leaf-markdown-table-header-background);
  --markdown-hr: var(--leaf-markdown-thematic-break);
  --markdown-link: var(--leaf-markdown-link);
  --markdown-link-hover: var(--link-hover);
  --syntax-background: var(--leaf-syntax-background);
  --syntax-foreground: var(--leaf-syntax-foreground);
  --syntax-comment: var(--leaf-syntax-comment);
  --syntax-keyword: var(--leaf-syntax-keyword);
  --syntax-string: var(--leaf-syntax-string);
  --syntax-number: var(--leaf-syntax-number);
  --syntax-function: var(--leaf-syntax-function);
  --syntax-variable: var(--leaf-syntax-variable);
  --syntax-type: var(--leaf-syntax-type);
  --syntax-operator: var(--leaf-syntax-operator);
  --syntax-punctuation: var(--leaf-syntax-punctuation);
  --syntax-inserted: var(--leaf-syntax-inserted);
  --syntax-deleted: var(--leaf-syntax-deleted);
  --syntax-changed: var(--leaf-syntax-changed);
  --syntax-inserted-bg: var(--leaf-syntax-inserted-background);
  --syntax-deleted-bg: var(--leaf-syntax-deleted-background);
  --syntax-changed-bg: var(--leaf-syntax-changed-background);
  --app-background: var(--background);
  --app-foreground: var(--foreground);
  --app-border: var(--border);
  --app-border-strong: var(--border-strong);
  --app-surface: var(--surface);
  --app-surface-raised: var(--surface-raised);
  --app-surface-elevated: var(--surface-elevated);
  --app-surface-muted: var(--surface-muted);
  --app-surface-inset: var(--surface-inset);
  /* One shade for every piece of app chrome — top bar, library pane, its two
     bands, the search field. No per-surface tint or mix: any variant shows up as a
     tone seam where two of them meet. */
  --chrome-surface: var(--app-surface);
  --app-muted-foreground: var(--muted-foreground);
  --app-action-background: var(--primary);
  --app-action-foreground: var(--primary-foreground);
  --app-action-hover-background: var(--leaf-navigation-button-hover-background);
  --app-action-disabled-background: var(--leaf-navigation-button-disabled-background);
  --app-action-disabled-foreground: var(--leaf-navigation-button-disabled-foreground);
  --app-error-border: var(--danger);
  --app-error-foreground: var(--danger);
  --app-focus-ring: var(--focus-ring);
  --app-selection-background: var(--selection);
  --app-selection-foreground: var(--leaf-focus-selection-foreground);
  --settings-label-foreground: var(--muted-foreground);
  --settings-control-background: var(--surface-elevated);
  --settings-control-foreground: var(--foreground);
  --settings-control-border: var(--border);
  --preview-background: var(--reading-background);
  --preview-foreground: var(--reading-ink);
  --preview-heading: var(--reading-heading);
  /* Per-level heading colors. h1 uses --preview-heading (the base); h2–h6 pull
     their own token so a theme can tint deeper levels (or leave them equal). */
  --preview-heading-2: var(--leaf-markdown-heading-2);
  --preview-heading-3: var(--leaf-markdown-heading-3);
  --preview-heading-4: var(--leaf-markdown-heading-4);
  --preview-heading-5: var(--leaf-markdown-heading-5);
  --preview-heading-6: var(--leaf-markdown-heading-6);
  --preview-rule: var(--reading-rule);
  --preview-border: var(--border);
  --preview-muted-foreground: var(--muted-foreground);
  --reader-content-pad: 32px;
  --type-measure-body: 75ch;
  --type-base: max(0.875rem, calc(1rem + (100vw - 1280px) / 140));
  --type-spacing: calc(var(--type-base) * 1.5);
  --type-spacing-sm: var(--type-base);
  --type-body-size: var(--type-base);
  --type-display-size: calc(var(--type-base) * 3.2);
  --type-h1-size: calc(var(--type-base) * 2.2);
  --type-h2-size: calc(var(--type-base) * 2);
  --type-h3-size: calc(var(--type-base) * 1.8);
  --type-h4-size: calc(var(--type-base) * 1.6);
  --type-h5-size: calc(var(--type-base) * 1.4);
  --type-h6-size: calc(var(--type-base) * 1.2);
  --type-caption-size: calc(var(--type-base) * 0.8125);
  --type-display-line: 1.2;
  --type-h1-line: 1.25;
  --type-h2-line: 1.25;
  --type-h3-line: 1.25;
  --type-h4-line: 1.25;
  --type-body-line: 1.6;
  --type-caption-line: 1.6;
  --type-display-weight: 900;
  --type-h1-weight: 850;
  --type-h2-weight: 800;
  --type-h3-weight: 750;
  --type-h4-weight: 700;
  --type-h5-weight: 650;
  --type-h6-weight: 600;
  --markdown-inline-code-background: var(--markdown-code-background);
  --markdown-inline-code-foreground: var(--markdown-code-foreground);
  --markdown-blockquote-background: var(--leaf-markdown-blockquote-background);
  --markdown-alert-note-border: var(--leaf-markdown-alert-note);
  --markdown-alert-tip-border: var(--leaf-markdown-alert-tip);
  --markdown-alert-important-border: var(--leaf-markdown-alert-important);
  --markdown-alert-warning-border: var(--leaf-markdown-alert-warning);
  --markdown-alert-caution-border: var(--leaf-markdown-alert-caution);
  --markdown-alert-done-border: var(--leaf-markdown-alert-done);
  --markdown-badge-background: var(--leaf-markdown-badge-background);
  --markdown-badge-foreground: var(--leaf-markdown-badge-foreground);
  --markdown-table-cell-border: var(--markdown-table-border);
  --markdown-table-heading-background: var(--markdown-table-header-background);
  --markdown-thematic-break: var(--markdown-hr);
  --math-inline-background: var(--leaf-markdown-math-inline-background);
  --keyboard-background: var(--leaf-markdown-keyboard-background);
  --keyboard-border: var(--leaf-markdown-keyboard-border);
  --empty-heading: var(--reading-heading);
  --recent-border: var(--leaf-navigation-recent-border);
  --recent-item-foreground: var(--leaf-navigation-recent-item-foreground);
  --recent-item-hover-foreground: var(--leaf-navigation-recent-item-hover-foreground);
  --minimap-background: var(--leaf-minimap-background);
  --minimap-border: var(--leaf-minimap-border);
  --minimap-viewport-border: var(--leaf-minimap-viewport-border);
  --minimap-viewport-background: var(--leaf-minimap-viewport-background);
  --minimap-heading: var(--leaf-minimap-heading);
  --minimap-paragraph: var(--leaf-minimap-paragraph);
  --minimap-blank: var(--leaf-minimap-blank);
  --minimap-list: var(--leaf-minimap-list);
  --minimap-blockquote: var(--leaf-minimap-blockquote);
  --minimap-code: var(--leaf-minimap-code);
  --code-block-background: var(--leaf-editor-code-background);
  --code-block-foreground: var(--leaf-editor-code-foreground);
  --code-block-border: var(--leaf-editor-code-border);
  --code-block-selection-background: var(--leaf-editor-code-selection-background);
  --code-block-selection-foreground: var(--leaf-editor-code-selection-foreground);
  /* Cassette-style grain dot shared by the app bar and library surfaces: a faint
     dark speckle on the light surface, overridden heavier for dark themes. */
  --app-bar-grain: rgba(0, 0, 0, 0.1);
  /* A heavier grain for inactive tabs, so one reads as a darker dotted cell set
     apart from its neighbours without any outline. Overridden darker still for
     dark themes. */
  --library-header-grain: rgba(0, 0, 0, 0.3);
  /* Corner radii — one scale every surface pulls from, so rounding swaps in a
     single place. Sizes map onto the values the components historically used. */
  --leaf-radius-xs: 2px;
  --leaf-radius-sm: 4px;
  --leaf-radius-md: 6px;
  --leaf-radius-lg: 8px;
  --leaf-radius-xl: 10px;
  --leaf-radius-2xl: 14px;
  --leaf-radius-pill: 999px;
  --leaf-radius-full: 50%;
  /* Elevation shadows by role, so overlays swap in one place. The resting card
     shadow stays per-theme as --shadow (from --leaf-shadow); these cover the
     overlays that were previously baked inline. */
  --leaf-shadow-popover: 0 6px 18px -6px color-mix(in srgb, black 55%, transparent),
    0 0 0 1px color-mix(in srgb, var(--app-muted-foreground) 20%, transparent);
  --leaf-shadow-sheet: 0 -10px 40px rgba(0, 0, 0, 0.5);
  --leaf-shadow-tooltip: 0 10px 24px rgba(0, 0, 0, 0.35);
  --heading-font: "Noto Serif", Georgia, Cambria, "Times New Roman", serif;
  --app-font: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, "Microsoft YaHei UI", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --reading-font: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, "Microsoft YaHei UI", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --code-font: "Noto Sans Mono", ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}
* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--app-background);
  color: var(--app-foreground);
  font-family: var(--reading-font);
}
body {
  overflow: hidden;
}
::selection {
  background: var(--app-selection-background);
  color: var(--app-selection-foreground);
}
/* Per-family fonts are emitted by the theme compiler (from themes.md) above.
   This locale rule follows them so a Chinese reader's CJK reading font still wins
   (equal specificity to the family rule, later in the sheet). */
:root[data-locale="zh-CN"] {
  --reading-font: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
}
:root[data-theme="dark"] {
  /* Dark themes use a darker grain so the surface reads
     as speckled darker, not lighter — needs a heavier alpha than light mode to
     show against the already-dark surface. */
  --app-bar-grain: rgba(0, 0, 0, 0.35);
  --library-header-grain: rgba(0, 0, 0, 0.72);
}
.app-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: grid;
  /* Zones: a left lead sized to the library rail (so tabs begin at the library's
     right edge and get pushed when it resizes), the tab strip, and the trailing
     group (actions + window controls, which fold into an overflow dropdown when
     the bar is too narrow to show them inline). */
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0;
  align-items: center;
  height: var(--app-bar-height);
  padding: 0;
  /* The chrome shade under a fine dithered dot grid, for a rough old-cassette
     texture. Flat and opaque, not the frosted translucent fill it used to be: a
     translucent bar takes its tone from whatever sits behind it, so it can never
     match the pane it meets. */
  background-color: var(--chrome-surface);
  background-image: radial-gradient(circle, var(--app-bar-grain) 0 0.6px, transparent 0.7px);
  background-size: 2px 2px;
  background-repeat: repeat;
  /* Tile the grain from the window, not this element's box, so every grained
     surface shares one lattice. Box-anchored grids fall out of phase wherever two
     meet — a 1px border is enough — and the seam reads as a faint hairline. */
  background-attachment: fixed;
  /* Hairline top divider in the window's outer border color, separating the
     reader from the native title bar above it. The bottom divider is drawn by
     ::after (not border-bottom) so the active tab can paint over it and appear
     connected to the page below. */
  border-top: 1px solid var(--app-border);
  font-family: var(--app-font);
}
.frameless .app-bar {
  /* On frameless Windows the app bar IS the title bar, so the OS already draws
     the window's top edge. Our own border-top would stack on that native frame
     and read as a double-thick (~2px) stroke at the top only, while the other
     three sides show a single 1px frame. Drop it so all four edges match. */
  border-top: 0;
}
.app-bar::after {
  /* The reader divider. Sits behind the tabs (z-index 0); the active tab, which
     is page-colored and z-index 1, covers this line so it reads as joined to the
     document, while inactive tabs meet it with their own bottom border. */
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--app-border);
  z-index: 0;
}
.app-bar.has-rail::after {
  /* Don't run the reader divider across the library column: the rail is one
     unbroken surface from the window's top edge down through the file list, so a
     line here would cut it in two. Start the divider at the rail's right edge,
     where it meets the pane's vertical border. */
  left: var(--library-rail-width, 0px);
}
.app-bar-lead {
  /* The header's left zone, sized to the library rail so the tab strip begins at
     the library's right edge and is pushed when the pane is resized. No right
     border: the top bar reads as one continuous surface, with only the library
     pane below carrying the rail's vertical stroke. */
  display: flex;
  align-items: center;
  gap: 16px;
  align-self: stretch;
  box-sizing: border-box;
  width: var(--library-rail-width, 240px);
  /* Never let the rail clip the brand + history controls: floor the zone at their
     natural width when the library is narrow. */
  min-width: fit-content;
  /* Left inset matches the library header's 12px so the logo lines up with the
     GRAPH/search controls directly below it. */
  padding: 0 16px 0 12px;
}
.app-bar:not(.has-rail) .app-bar-lead {
  /* Library closed: no rail to align to, so the lead is just its controls. */
  width: auto;
}
.brand-button > svg {
  width: 22px;
  height: 22px;
  display: block;
  flex-shrink: 0;
  /* The logomark is an inline SVG filled with currentColor, so it takes the
     theme's primary color and recolors whenever the theme changes. */
  color: var(--primary);
}
.brand-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: var(--leaf-radius-lg);
  background: transparent;
  cursor: pointer;
}
.brand-button:hover {
  background: transparent;
  border-color: transparent;
}
.tab-bar {
  display: flex;
  gap: 6px;
  min-width: 0;
  /* Fill the full header height so tabs read as full-height cells. */
  align-self: stretch;
  align-items: stretch;
  overflow-x: auto;
  scrollbar-width: none;
  /* Horizontal inset only (vertical stays 0 for full-height cells): space the
     first tab off the rail stroke and hold a gap before the app actions. */
  padding: 0 12px;
}
.tab-bar::-webkit-scrollbar {
  height: 0;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  max-width: 132px;
  padding: 0 4px;
  /* Full-height cell above the reader divider (z-index 1) so the active tab can
     cover it. The transparent side borders reserve the width the active tab
     paints in, keeping every tab the same size. */
  position: relative;
  z-index: 1;
  border-left: 1px solid transparent;
  border-right: 1px solid transparent;
  border-bottom: 1px solid var(--app-border);
  /* An inactive tab reads as a darker cell by tiling the header's cassette grain
     at its heavier weight — denser ink, no outline needed. */
  background-image: radial-gradient(circle, var(--library-header-grain) 0 0.6px, transparent 0.7px);
  background-size: 2px 2px;
  background-repeat: repeat;
  cursor: grab;
  user-select: none;
  transition: max-width 0.12s ease, transform 0.12s ease;
}
.tab-active {
  max-width: none;
}
.tab-dragging {
  position: relative;
  z-index: 2;
  opacity: 0.85;
  cursor: grabbing;
  box-shadow: var(--shadow);
  transition: none;
}
.tab-bar.tabs-settling .tab {
  transition: none;
}
.tab-active {
  /* Drop the bottom stroke so the page-colored fill flows over the reader
     divider and the tab looks joined to the document below. The side strokes
     are the selection cue — only the active tab frames itself. */
  background: var(--app-background);
  border-left-color: var(--app-border);
  border-right-color: var(--app-border);
  border-bottom-color: transparent;
}
:root[data-code-view="true"] .tab-active {
  /* In code view the page below is the code surface, not the reading background;
     match it so the active tab still reads as joined to the document. */
  background: var(--code-block-background, var(--preview-background));
}
.tab-label {
  flex: 1;
  min-width: 0;
  max-width: 124px;
  overflow: hidden;
  white-space: nowrap;
  border: 1px solid transparent;
  background: transparent;
  color: var(--app-muted-foreground);
  font: 600 13px var(--app-font);
  padding: 5px 14px;
  text-align: left;
  /* Long names fade out instead of showing an ellipsis. The fade ends at the
     content edge, not the border box: overflow clips at the padding box, so
     only the mask can keep text out of the right inset. */
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 33px), transparent calc(100% - 15px));
  mask-image: linear-gradient(to right, #000 calc(100% - 33px), transparent calc(100% - 15px));
}
.tab-active .tab-label {
  /* Full-strength foreground so the active tab's name stays legible in every
     theme (a hardcoded white vanished on the light page-colored tab). */
  color: var(--app-foreground);
  max-width: none;
  -webkit-mask-image: none;
  mask-image: none;
}
.tab-label:hover {
  background: transparent;
  border-color: transparent;
}
.tab:hover .tab-label {
  /* Text-only hover so the inactive grain and the active frame both stay put. */
  color: var(--app-foreground);
}
.tab-close {
  /* Pinned to the top-right corner of every tab, out of the label's flow, so it
     no longer sits inline with the (vertically centered) name. */
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  min-width: 18px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--leaf-radius-sm);
  background: transparent;
  color: var(--app-muted-foreground);
}
.tab-close svg {
  width: 12px;
  height: 12px;
  pointer-events: none;
}
.tab-close:hover {
  background: var(--app-action-hover-background);
  border-color: transparent;
  /* The contrast color that pairs with the action background — white icons on a
     light accent (Fern green, Amaranth lavender) were unreadable. */
  color: var(--app-action-foreground);
}
.history-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
/* The trailing group: the action buttons plus the window controls. Anchors the
   collapsed overflow dropdown; padded off the window edge (frameless windows let
   the flush window controls own that edge instead — see below). */
.app-trailing {
  display: flex;
  align-items: center;
  align-self: stretch;
  position: relative;
  padding-right: 22px;
}
.app-trailing-items {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 8px;
}
.app-actions-items {
  display: flex;
  gap: 10px;
  align-items: center;
}
/* Overflow chevron: hidden inline (the `.app-trailing` prefix outranks the
   later `.icon-button { display: inline-grid }`), shown only when collapsed.
   Rests muted, greens on hover like the other toolbar icons. */
.app-trailing .overflow-toggle {
  display: none;
  border-color: transparent;
  background: transparent;
  color: var(--app-muted-foreground);
}
.overflow-toggle:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
.app-trailing.collapsed .overflow-toggle {
  display: inline-grid;
}
/* Collapsed: everything trailing (actions + window controls) folds into a
   dropdown, leaving just the chevron on the bar. */
.app-trailing.collapsed .app-trailing-items {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  display: none;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--app-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--app-surface-elevated);
  box-shadow: var(--shadow);
  z-index: 30;
}
.app-trailing.collapsed.overflow-open .app-trailing-items {
  display: flex;
}
.app-trailing.collapsed .app-actions-items {
  gap: 4px;
}
/* In the dropdown the window controls are ordinary icon buttons, not the
   full-height flush caption buttons they are on the bar. */
.app-trailing.collapsed .window-controls {
  margin-left: 0;
}
.app-trailing.collapsed .window-control {
  width: 32px;
  height: 32px;
  border-radius: var(--leaf-radius-lg);
}
/* Custom window controls for frameless windows (Windows). Hidden until the
   frontend reveals them; they sit flush in the top-right corner and act as the
   native minimize/maximize/close buttons, since there's no OS title bar. */
.window-controls {
  display: flex;
  align-self: stretch;
  margin-left: 2px;
}
.window-control {
  width: 46px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  /* Square, full-bleed hover fills (overriding the global button radius) so they
     read as native caption buttons; the window's own rounded top-right corner
     clips the close button's fill to the corner. */
  border-radius: 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.window-control svg {
  width: 12px;
  height: 12px;
}
/* Maximize shows a single square; when the window is maximized the restore-down
   glyph (two offset squares) takes its place. Exactly one is ever displayed, so
   the grid button keeps a single centered child. */
.window-control .wc-restore {
  display: none;
}
body.is-maximized #winMaximize .wc-maximize {
  display: none;
}
body.is-maximized #winMaximize .wc-restore {
  display: block;
}
/* Neutral, square caption-button hover — a translucent overlay so it stays
   visible in every theme (a plain surface token read the same as the bar).
   border-radius: 0 defeats the global button radius; close keeps its own. */
.window-control:hover {
  background: color-mix(in srgb, var(--foreground) 12%, transparent);
  color: var(--foreground);
  border-radius: 0;
}
.window-control-close:hover {
  background: #e81123;
  color: #ffffff;
}
/* Frameless: the flush window controls own the right edge, so the trailing group
   drops its inset (the controls sit at the very corner). */
.frameless .app-trailing {
  padding-right: 0;
}
/* Only frameless windows carry the in-app window controls; hide them otherwise
   so no empty gap shows where they'd sit. */
.window-controls[hidden] {
  display: none;
}
.context-menu {
  position: fixed;
  z-index: 50;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--app-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--app-surface-elevated);
  box-shadow: var(--shadow);
  font-family: var(--app-font);
}
.context-menu[hidden] {
  display: none;
}
.context-menu-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  border: 0;
  border-radius: var(--leaf-radius-sm);
  background: transparent;
  color: var(--settings-control-foreground);
  font: 600 13px var(--app-font);
  text-align: left;
  cursor: pointer;
}
.context-menu-item:hover,
.context-menu-item:focus-visible {
  background: var(--app-surface-muted);
  outline: none;
}
.context-menu-item.is-danger {
  color: var(--danger);
}
.context-menu-item.is-danger:hover,
.context-menu-item.is-danger:focus-visible {
  background: var(--danger);
  color: var(--danger-foreground);
}
.context-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--app-border);
}
.rename-box {
  position: fixed;
  z-index: 51;
  width: 232px;
  padding: 4px;
  border: 1px solid var(--app-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--app-surface-elevated);
  box-shadow: var(--shadow);
}
.rename-box[hidden] {
  display: none;
}
.rename-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--accent);
  border-radius: var(--leaf-radius-sm);
  background: var(--app-surface);
  color: var(--settings-control-foreground);
  font: 600 13px var(--app-font);
}
.rename-input:focus {
  outline: none;
}
.settings-menu {
  position: relative;
  font-family: var(--app-font);
}
.settings-menu summary {
  /* Box size, radius, and icon come from .icon-button (which this also carries)
     so every toolbar icon button matches; only the summary-specific bits and the
     rest colors live here. `position: relative` anchors the update-alert dot. */
  border: 1px solid transparent;
  /* No resting fill; icon dimmed at rest, greens on hover like the other icons. */
  background: transparent;
  color: var(--app-muted-foreground);
  cursor: pointer;
  font: 700 13px var(--app-font);
  list-style: none;
  position: relative;
}
.settings-menu summary::-webkit-details-marker {
  display: none;
}
.settings-menu summary:hover {
  background: var(--app-action-hover-background);
  border-color: transparent;
  color: var(--app-action-foreground);
}
/* Update-available dot over the settings button, revealed by the frontend's
   version check. The ring keeps it legible on the bar's textured/hover fill. */
.settings-alert-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: var(--leaf-radius-full);
  background: var(--app-action-background);
  box-shadow: 0 0 0 2px var(--app-surface);
}
/* Green "update to vX" call-to-action pinned above the settings controls. Takes
   the primary-action fill; spans the panel. */
.settings-update {
  width: 100%;
  font-weight: 700;
}
.settings-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  display: grid;
  gap: 14px;
  width: min(290px, calc(100vw - 28px));
  border: 1px solid var(--app-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--app-surface-elevated);
  box-shadow: var(--shadow);
  padding: 14px;
}
.setting-control {
  display: grid;
  gap: 6px;
  color: var(--settings-label-foreground);
}
.setting-label {
  color: var(--settings-control-foreground);
  font-size: 13px;
  font-weight: 800;
}
.setting-help {
  color: var(--app-muted-foreground);
  font-size: 12px;
  line-height: 1.35;
}
.setting-control-inline {
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 10px;
  align-items: start;
}
.setting-control-inline input {
  width: 16px;
  height: 16px;
  margin: 1px 0 0;
  accent-color: var(--primary);
}
.setting-control-inline .setting-help {
  grid-column: 2;
}
.setting-control select {
  width: 100%;
  border: 1px solid var(--settings-control-border);
  border-radius: var(--leaf-radius-md);
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
  font: 600 13px var(--app-font);
  padding: 7px 28px 7px 9px;
}
button {
  border: 1px solid var(--app-action-background);
  border-radius: var(--leaf-radius-md);
  background: var(--app-action-background);
  color: var(--app-action-foreground);
  cursor: pointer;
  font: 600 14px var(--app-font);
  padding: 8px 14px;
}
/* The one true toolbar icon button: every square icon control in the app bar
   (history, code view, settings, open) shares this box, radius, and icon size so
   their hover chips are identical. The floating library-open button matches it
   too. */
.icon-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: var(--leaf-radius-lg);
  padding: 0;
}
.icon-button svg {
  width: 16px;
  height: 16px;
  pointer-events: none;
}
/* Rests muted like the other secondary toolbar icons, greens on hover. */
.open-button {
  border-color: transparent;
  background: transparent;
  color: var(--app-muted-foreground);
}
.open-button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
/* Code-view toggle: rests muted, greens on hover. The icon carries the state
   (brackets in the reading view, a document while the code view is open). */
.code-view-button {
  border-color: transparent;
  background: transparent;
  color: var(--app-muted-foreground);
}
.code-view-button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
.cv-icon {
  display: inline-flex;
}
.code-view-button .cv-icon-doc,
.code-view-button.is-active .cv-icon-code {
  display: none;
}
.code-view-button.is-active .cv-icon-doc {
  display: inline-flex;
}
.code-view-button[hidden],
.save-button[hidden],
.undo-button[hidden] {
  display: none;
}
/* Undo: Save's quieter sibling — same green, dimmed below the solid Save fill
   so the pair reads as one action and its undo. */
.undo-button {
  border-color: transparent;
  background: color-mix(in srgb, var(--app-action-background) 45%, transparent);
  color: var(--app-action-foreground);
}
.undo-button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
/* Save: the affirmative action. A solid green button shown only when there are
   unsaved edits, deepening to the hover green when pointed at. */
.save-button {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--leaf-radius-md);
  background: var(--app-action-background);
  color: var(--app-action-foreground);
  font: 600 13px var(--app-font);
  cursor: pointer;
  white-space: nowrap;
}
.save-button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
/* Unsaved-edits dot on a tab. Sits between the label and the (active-tab-only)
   close button; hidden unless the tab is modified. */
.tab-dirty-dot {
  display: none;
  width: 7px;
  height: 7px;
  min-width: 7px;
  margin: 0 3px;
  border-radius: var(--leaf-radius-full);
  background: var(--accent);
}
.tab-modified .tab-dirty-dot {
  display: inline-block;
}
/* On the active tab the close button replaces the dot on hover. */
.tab-active:hover .tab-dirty-dot {
  display: none;
}
button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
}
button:disabled {
  border-color: var(--app-action-disabled-background);
  background: var(--app-action-disabled-background);
  color: var(--app-action-disabled-foreground);
  cursor: default;
}
button:disabled:hover {
  border-color: var(--app-action-disabled-background);
  background: var(--app-action-disabled-background);
}
.history-button {
  border-color: transparent;
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
}
.close-button {
  border-color: transparent;
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
}
.history-button:hover:not(:disabled) {
  border-color: transparent;
  background: var(--settings-control-background);
}
.close-button:hover:not(:disabled) {
  border-color: transparent;
  background: var(--settings-control-background);
}
.history-button:disabled,
.history-button:disabled:hover {
  border-color: transparent;
  background: var(--settings-control-background);
  color: var(--app-muted-foreground);
  opacity: 0.46;
}
button:focus-visible,
select:focus-visible,
input:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 3px solid var(--app-focus-ring);
  outline-offset: 3px;
}
.library-shell {
  display: grid;
  grid-template-columns: var(--library-width, 240px) minmax(0, 1fr);
  height: 100vh;
  /* Positioning context for the open-library button, pinned to the left edge so
     it stays reachable when the pane collapses to 0. */
  position: relative;
}
.library-shell.library-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}
.library-pane {
  /* Positioning context for the overlays it stacks (.library-scroll,
     .library-crumbs, .library-header). The pane itself doesn't scroll or clip;
     the inner .library-scroll owns the scroll. */
  --library-app-bar: var(--app-bar-height);
  --library-header-height: 40px;
  /* The breadcrumb band between the app bar and the search row. Fixed height
     whatever the path is, so entering a folder never shifts the list. */
  --library-crumbs-height: 28px;
  --library-chrome-height: calc(var(--library-app-bar) + var(--library-crumbs-height) + var(--library-header-height));
  position: relative;
  height: 100vh;
  /* The app bar's shade and grain, so the pane continues the bar rather than
     sitting under it. The tree rows on top are transparent, so the whole pane
     carries the texture. */
  background-color: var(--chrome-surface);
  background-image: radial-gradient(circle, var(--app-bar-grain) 0 0.6px, transparent 0.7px);
  background-size: 2px 2px;
  background-attachment: fixed;
  color: var(--preview-foreground);
  font-family: var(--app-font);
  font-size: 13px;
  /* Hairline in the outer border color marking the pane's right edge, so the
     boundary against the reader is legible in every theme. */
  border-right: 1px solid var(--app-border);
}
.library-divider {
  /* An invisible grab strip straddling the pane's right edge, wide enough to
     catch the pointer. Overhangs into the reader a few px. */
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 8px;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
}
.library-shell.library-closed .library-pane {
  /* Drop the right-edge hairline when snapped shut, or it shows as a stray line
     against the reader's left edge at 0 width. */
  border-right: 0;
}
.library-shell.library-closed .library-divider {
  display: none;
}
.library-shell.library-closed .library-header,
.library-shell.library-closed .library-crumbs {
  /* Hide the header bands when snapped shut, or the unclipped pane would bleed
     them past the 0px column and show them behind the reader. */
  display: none;
}
/* The library toggle sits in the app bar's lead, left of Back. Rests muted like
   the other secondary toolbar icons, greens on hover. */
.library-open {
  border-color: transparent;
  background: transparent;
  color: var(--app-muted-foreground);
}
.library-open:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
.library-open svg {
  width: 16px;
  height: 16px;
}
/* While dragging the divider, lock the cursor and kill text selection window-wide. */
body.library-resizing {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}
.library-scroll {
  /* Scroll container filling the pane. Top padding clears the app bar, the
     breadcrumb band, and the search row, so the list starts below all three but
     scrolls up under their blur.
     NOTE: no `scrollbar-width`/`scrollbar-color` — in Chromium either standard
     property silently disables all `::-webkit-scrollbar` pseudo-elements. */
  position: absolute;
  inset: 0;
  overflow: auto;
  box-sizing: border-box;
  padding-top: var(--library-chrome-height);
}
.library-scroll::-webkit-scrollbar {
  width: 10px;
}
.library-scroll::-webkit-scrollbar-track {
  /* Transparent, not the pane color: an opaque track masks the grain and leaves an
     ungrained strip down the pane's right edge. */
  background: transparent;
  /* Keep the bar clear of the app bar AND the two bands under it. */
  margin-top: var(--library-chrome-height);
}
.library-scroll::-webkit-scrollbar-thumb {
  border-radius: var(--leaf-radius-md);
  background: color-mix(in srgb, var(--app-muted-foreground) 35%, transparent);
  /* Floor the grabber so a huge file list can't shrink it to a sliver. */
  min-height: 128px;
}
.library-tree {
  padding: 0 6px 12px;
}
/* Fills the pane below the header; the Pixi canvas owns pan/zoom, so this never
   scrolls. */
.library-graph {
  position: absolute;
  inset: 0;
  top: var(--library-chrome-height);
  overflow: hidden;
}
.library-graph-canvas {
  width: 100%;
  height: 100%;
}
.library-graph-canvas canvas {
  display: block;
}
.library-graph-status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  margin: 0;
  padding: 0 12px;
  text-align: center;
  font-size: 11px;
  color: var(--app-muted-foreground);
  pointer-events: none;
}
.library-results {
  padding: 0 6px 12px;
}
.library-results-count {
  margin: 2px 6px 6px;
  font-size: 11px;
  color: var(--app-muted-foreground);
}
/* A search hit: the file's title on top, the match snippet below it. */
.library-hit {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: var(--leaf-radius-md);
  padding: 6px 8px;
  margin: 0 0 2px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
}
.library-hit:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 14%, transparent);
}
.library-hit-title {
  display: block;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.library-hit-snippet {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--app-muted-foreground);
}
.library-hit-mark {
  background: color-mix(in srgb, var(--app-action-background, #2f81f7) 40%, transparent);
  color: inherit;
  border-radius: var(--leaf-radius-xs);
}
/* The search box fills the rest of the pinned header, beside the view chip; its
   min-width floors the controls so a narrow pane clips them (see .library-header)
   rather than squashing the field away. */
.library-search-wrap {
  flex: 1 1 auto;
  min-width: 72px;
  display: flex;
  align-items: center;
  height: 24px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: var(--leaf-radius-md);
  border: 1px solid color-mix(in srgb, var(--app-muted-foreground) 25%, transparent);
  /* The chrome shade again, but flat: the border is what reads as the field, and
     an ungrained fill keeps dots out from behind the search text. */
  background-color: var(--chrome-surface);
}
.library-search-wrap:focus-within {
  /* A neutral white focus border rather than the accent, which reads green in
     the Primer themes. */
  border-color: color-mix(in srgb, #ffffff 85%, transparent);
}
:root[data-theme="light"] .library-search-wrap:focus-within {
  /* White vanishes on the light field, so key the focus off the ink instead. */
  border-color: color-mix(in srgb, var(--app-foreground) 45%, transparent);
}
.library-search {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 12px;
}
.library-search:focus {
  outline: none;
}
/* The two pinned bands: the breadcrumb directly under the app bar, the search row
   under that. Both absolute against the pane (not sticky) so neither drifts with
   the list, which slides up behind them. Same treatment on both — the pane's own
   surface and grain, on the same lattice — so the chrome is one continuous texture.
   Opaque, so the list never shows through. */
.library-crumbs,
.library-header {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  box-sizing: border-box;
  /* Clip at the pane's right edge (the divider) so a narrow drag slides the
     controls under it instead of squashing or spilling past it. */
  overflow: hidden;
  display: flex;
  align-items: center;
  background-color: var(--chrome-surface);
  background-image: radial-gradient(circle, var(--app-bar-grain) 0 0.6px, transparent 0.7px);
  background-size: 2px 2px;
  background-repeat: repeat;
  background-attachment: fixed;
}
.library-crumbs {
  top: var(--library-app-bar);
  height: var(--library-crumbs-height);
  gap: 6px;
  padding: 0 6px 0 12px;
}
.library-header {
  top: calc(var(--library-app-bar) + var(--library-crumbs-height));
  height: var(--library-header-height);
  justify-content: flex-start;
  gap: 8px;
  padding: 0 12px;
  font-weight: 600;
}
.library-crumb-trail {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
}
.library-crumb {
  flex: 0 0 auto;
  max-width: 55%;
  padding: 1px 4px;
  border: 0;
  border-radius: var(--leaf-radius-sm);
  background: transparent;
  color: var(--app-muted-foreground);
  font-family: inherit;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.library-crumb:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 16%, transparent);
  color: var(--app-foreground);
}
/* The folder you are in: full ink, and it gets the leftover room — the ancestors
   above it give way first. */
.library-crumb.is-current {
  flex: 0 1 auto;
  max-width: none;
  cursor: default;
  color: var(--app-foreground);
  font-weight: 600;
}
.library-crumb.is-current:hover {
  background: transparent;
  color: var(--app-foreground);
}
.library-crumb.is-elided {
  padding: 1px 2px;
  cursor: default;
}
.library-crumb-sep {
  flex: none;
  color: color-mix(in srgb, var(--app-muted-foreground) 60%, transparent);
  font-size: 10px;
}
/* The graph toggle: muted at rest, accent-filled while the graph is up, so which
   of the two views is on screen is legible without opening anything. */
.library-graph-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--leaf-radius-sm);
  background: transparent;
  color: var(--app-muted-foreground);
  cursor: pointer;
}
.library-graph-toggle svg {
  width: 15px;
  height: 15px;
}
.library-graph-toggle:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 18%, transparent);
  color: var(--app-foreground);
}
.library-graph-toggle[aria-pressed="true"] {
  background: color-mix(in srgb, var(--accent) 28%, transparent);
  color: var(--app-foreground);
}
.library-file,
.library-nav-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 3px 6px;
  /* A hair of vertical space so adjacent row highlights don't touch. */
  margin-bottom: 2px;
  border: 0;
  border-radius: var(--leaf-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.library-file:hover,
.library-nav-folder:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 12%, transparent);
}
/* The currently-open file: accent-tinted, outranking hover so it holds while
   pointing elsewhere. */
.library-file.is-selected,
.library-file.is-selected:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
/* The leaf mark before Markdown file names. Same inline glyph as the header
   logomark, so it tracks the theme's primary color instead of a baked-in one. */
.library-file > svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--primary);
}
/* Folder glyph before folder names, dimmed to the muted tone so the name stays
   primary. The row is a flex box with its own gap, so it needs no margin. */
.library-folder-icon {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--app-muted-foreground);
}
.library-file-label {
  /* Fill the row so the fade lands on empty space until the name overflows;
     without flex:1 the label hugs its text and the mask clips every name. */
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  /* Long names fade out at the right edge instead of showing an ellipsis,
     matching the tab labels. */
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
}
/* Folder rows: name left, a muted chevron pinned to the right edge marking the
   row as something you can enter. */
.library-nav-chevron {
  margin-left: auto;
  padding-left: 8px;
  color: var(--app-muted-foreground);
}
.library-project {
  display: flex;
  flex-direction: column;
}
.library-progress,
.library-empty {
  padding: 8px 12px;
  color: var(--app-muted-foreground);
  font-size: 12px;
}
.reader-shell {
  background: var(--preview-background);
  /* Pin the reader to its grid cell. Auto-placed, it gets evicted into the 0px
     library column when the .reader-loading overlay (which claims column 2, row 1)
     is unhidden — the document then reflows at zero width and every scroll
     computation made while the spinner is up lands wrong. */
  grid-column: 2;
  grid-row: 1;
  height: 100vh;
  overflow: auto;
  /* The reader pins its own scroll anchor across re-renders; the browser's
     native scroll anchoring fights that and causes transient jumps. */
  overflow-anchor: none;
  padding-top: var(--app-bar-height);
  position: relative;
  scroll-padding-top: var(--app-bar-height);
  scrollbar-width: none;
}
.reader-shell::-webkit-scrollbar {
  width: 0;
}
.reader-shell.has-document:has(.document-minimap) {
  background: var(--preview-background);
}
.reader-loading {
  /* Overlays the reader cell so a spinner can show over the current document
     during a slow load. Pointer events pass through; sits below the app bar. */
  grid-column: 2;
  grid-row: 1;
  align-self: stretch;
  justify-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: var(--app-bar-height);
  pointer-events: none;
  background: color-mix(in srgb, var(--preview-background) 62%, transparent);
  z-index: 6;
}
.reader-loading[hidden] {
  display: none;
}
.reader-loading-spinner {
  width: 34px;
  height: 34px;
  border-radius: var(--leaf-radius-full);
  border: 3px solid color-mix(in srgb, var(--preview-foreground) 22%, transparent);
  border-top-color: var(--accent);
  animation: leaf-reader-spin 0.8s linear infinite;
}
@keyframes leaf-reader-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .reader-loading-spinner {
    animation-duration: 1.6s;
  }
}
.reader-layout {
  --reader-layout-padding-inline: var(--reader-content-pad);
  container-type: inline-size;
  --minimap-padding-inline: 8px;
  --minimap-preview-width: 68px;
  --minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  min-height: 100%;
  padding: 0 var(--reader-layout-padding-inline);
  position: relative;
  /* Heading permalinks sit in the left gutter via negative positioning; clip
     stops them widening the horizontal scroll without making this a scroll
     container. */
  overflow-x: clip;
}
/* Reserve the minimap's footprint as right-only padding so the document centers
   between the left edge and the minimap, not across the whole reader width. */
.reader-layout:has(.document-minimap) {
  padding-right: calc(var(--reader-layout-padding-inline) + var(--minimap-width));
}
.reader-layout-no-minimap {
  justify-items: center;
}
.app-error {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  max-width: min(520px, calc(100vw - 36px));
  border: 1px solid var(--app-error-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--app-surface-elevated);
  box-shadow: var(--shadow);
  color: var(--app-error-foreground);
  font: 600 14px/1.45 var(--app-font);
  padding: 12px 14px;
}
.document-body {
  width: min(var(--type-measure-body), 100%);
  margin: calc(-1 * var(--reader-scroll-origin, 0px)) 0 0;
  padding: var(--reader-content-pad) 0;
  color: var(--preview-foreground);
  font-size: var(--type-body-size);
  line-height: var(--type-body-line);
  word-wrap: break-word;
  word-break: normal;
}
:root[data-locale="zh-CN"] .document-body {
  line-height: var(--type-body-line);
}
/* The reader lays the whole document out up front (like the web reader), which
   keeps scrolling smooth: content-visibility skipping made off-screen blocks
   flash blank and the minimap box jump as heights re-estimated. */
.docs-pager {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: var(--app-bar-height);
  padding-top: 24px;
  border-top: 1px solid var(--reading-rule);
}
:root[data-pager-enabled="false"] .docs-pager {
  display: none;
}
.docs-pager a {
  flex: 1 1 0;
  min-width: 0;
  text-decoration: none;
  padding: 12px 16px;
  border: 1px solid var(--reading-rule);
  border-radius: var(--leaf-radius-lg);
  color: var(--preview-foreground);
}
.docs-pager-skeleton {
  flex: 1 1 0;
  min-width: 0;
  padding: 12px 16px;
  border: 1px solid var(--reading-rule);
  border-radius: var(--leaf-radius-lg);
}
.docs-pager-label-skeleton,
.docs-pager-title-skeleton {
  display: block;
  border-radius: var(--leaf-radius-pill);
  background: var(--reading-rule);
  animation: pager-skeleton-pulse 1.25s ease-in-out infinite;
}
.docs-pager-label-skeleton {
  width: 72px;
  height: 0.74rem;
  margin-bottom: 8px;
}
.docs-pager-title-skeleton {
  width: min(220px, 80%);
  height: 1rem;
}
.docs-pager-next .docs-pager-label-skeleton,
.docs-pager-next .docs-pager-title-skeleton {
  margin-left: auto;
}
@keyframes pager-skeleton-pulse {
  0%,
  100% {
    opacity: 0.38;
  }
  50% {
    opacity: 0.78;
  }
}
@media (prefers-reduced-motion: reduce) {
  .docs-pager-label-skeleton,
  .docs-pager-title-skeleton {
    animation: none;
    opacity: 0.55;
  }
}
.docs-pager a:hover {
  border-color: var(--reading-link);
  color: var(--reading-link);
  text-decoration: none;
}
.docs-pager .docs-pager-next {
  text-align: right;
}
.docs-pager-label {
  display: block;
  font-size: 0.74rem;
  color: var(--muted-foreground);
  margin-bottom: 2px;
}
@media (max-width: 700px) {
  .docs-pager {
    flex-direction: column;
  }
  .docs-pager .docs-pager-next {
    text-align: left;
  }
}
.document-body :target,
.document-body [id] {
  scroll-margin-top: 16px;
}
.document-body h1,
.document-body h2,
.document-body h3,
.document-body h4,
.document-body h5,
.document-body h6 {
  color: var(--preview-heading);
  font-family: var(--heading-font);
  letter-spacing: 0;
  margin: var(--type-spacing) 0 var(--type-spacing);
}
.document-body h1 {
  border-bottom: 1px solid var(--preview-rule);
  font-size: var(--type-h1-size);
  font-weight: var(--type-h1-weight);
  line-height: var(--type-h1-line);
  padding-bottom: 0.3em;
}
.document-body h1:first-of-type {
  font-size: var(--type-display-size);
  font-weight: var(--type-display-weight);
  line-height: var(--type-display-line);
}
.document-body h2 {
  color: var(--preview-heading-2);
  border-bottom: 1px solid var(--preview-rule);
  font-size: var(--type-h2-size);
  font-weight: var(--type-h2-weight);
  line-height: var(--type-h2-line);
  padding-bottom: 0.3em;
}
.document-body h3 {
  color: var(--preview-heading-3);
  font-size: var(--type-h3-size);
  font-weight: var(--type-h3-weight);
  line-height: var(--type-h3-line);
}
.document-body h4 {
  color: var(--preview-heading-4);
  font-size: var(--type-h4-size);
  font-weight: var(--type-h4-weight);
  line-height: var(--type-h4-line);
}
.document-body h5 {
  color: var(--preview-heading-5);
  font-size: var(--type-h5-size);
  font-weight: var(--type-h5-weight);
  line-height: var(--type-h4-line);
}
.document-body h6 {
  color: var(--preview-heading-6);
  font-size: var(--type-h6-size);
  font-weight: var(--type-h6-weight);
  line-height: var(--type-caption-line);
}
.document-body p,
.document-body ul,
.document-body ol,
.document-body blockquote,
.document-body table,
.document-body pre {
  margin: 0 0 var(--type-spacing);
}
.document-body [align="left"] {
  text-align: left;
}
.document-body [align="center"] {
  margin: var(--type-spacing-sm) 0;
  text-align: center;
}
.document-body [align="center"] > table {
  margin-left: auto;
  margin-right: auto;
}
.document-body [align="right"] {
  text-align: right;
}
.document-body [align="justify"] {
  text-align: justify;
}
.document-body a {
  color: var(--markdown-link);
  text-decoration: none;
}
.document-body a:hover {
  color: var(--markdown-link-hover);
  text-decoration: underline;
}
/* Leaf custom Markdown buttons: a link wrapped in braces renders as a button
   styled like the app's action controls (the zero-state "Choose file"). The base
   rule is the filled variant, from `{{{[Label](url)}}}`. */
.document-body a.leaf-md-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-action-background);
  border-radius: var(--leaf-radius-md);
  background: var(--app-action-background);
  color: var(--app-action-foreground);
  font: 600 15px var(--app-font);
  padding: 11px 18px;
  text-decoration: none;
  cursor: pointer;
}
.document-body a.leaf-md-button:hover {
  background: var(--app-action-hover-background);
  border-color: var(--app-action-hover-background);
  color: var(--app-action-foreground);
  text-decoration: none;
}
/* Outline, from `{{[Label](url)}}`: an outline at rest that fills on hover. */
.document-body a.leaf-md-button--secondary {
  background: transparent;
  border-color: var(--app-action-background);
  color: var(--app-action-background);
}
.document-body a.leaf-md-button--secondary:hover {
  background: var(--app-action-background);
  border-color: var(--app-action-background);
  color: var(--app-action-foreground);
}
/* Ghost, from `{[Label](url)}`: no fill or outline until hover, when it fills. */
.document-body a.leaf-md-button--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--app-action-background);
}
.document-body a.leaf-md-button--ghost:hover {
  background: var(--app-action-background);
  border-color: var(--app-action-background);
  color: var(--app-action-foreground);
}
.document-body strong {
  font-weight: 600;
}
/* Outline: a collapsed <details> built from the headings, dropped in under the
   title (see buildDocumentOutline). Closed by default. */
.document-body .document-outline {
  margin: 1.5em 0;
  border: 1px solid var(--preview-border);
  border-radius: var(--leaf-radius-md);
  background: var(--code-block-background);
}
.document-body .document-outline-summary {
  cursor: pointer;
  padding: 0.5em 0.9em;
  font-weight: 600;
  color: var(--preview-foreground);
  list-style: none;
  user-select: none;
}
.document-body .document-outline-summary::-webkit-details-marker {
  display: none;
}
.document-body .document-outline-summary::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  margin-right: 0.55em;
  border-left: 0.4em solid currentColor;
  border-top: 0.32em solid transparent;
  border-bottom: 0.32em solid transparent;
  vertical-align: middle;
  transition: transform 0.15s ease;
}
.document-body .document-outline[open] > .document-outline-summary::before {
  transform: rotate(90deg);
}
.document-body .document-outline-summary:hover {
  color: var(--markdown-link-hover);
}
/* The document's total line count, stamped in after the numbering pass. */
.document-body .document-outline-count {
  margin-left: 0.45em;
  font-weight: 400;
  color: var(--preview-muted-foreground);
}
/* Bulleted, not numbered: a deep outline runs a counter into the hundreds and
   the wide markers overflow the panel's left edge. */
.document-body .document-outline > ul {
  margin: 0;
  padding: 0 1.4em 0.7em 2.4em;
}
.document-body .document-outline ul {
  margin: 0;
  padding-left: 1.6em;
  list-style: disc;
}
.document-body .document-outline li {
  margin: 0.15em 0;
  color: var(--preview-muted-foreground);
}
.document-body .document-outline-link {
  color: var(--preview-muted-foreground);
}
.document-body .document-outline-link:hover {
  color: var(--markdown-link-hover);
}
/* Alternate-language title lines under a TEI main title. Muted and tight, and
   pulled up toward the h1, so the stack reads as one title block. */
.document-body .tei-doc-subtitles {
  margin: calc(-0.5 * var(--type-spacing)) 0 var(--type-spacing);
  color: var(--preview-muted-foreground);
}
.document-body .tei-doc-subtitles .tei-doc-subtitle {
  margin: 0 0 0.3em;
}
.document-body .tei-doc-subtitles .tei-doc-subtitle:last-child {
  margin-bottom: 0;
}
/* TEI front matter (summary, acknowledgements, introduction) rendered as a
   collapsed <details> before the body — mirrors the outline toggle above. */
.document-body .tei-front {
  margin: 1.5em 0;
  border: 1px solid var(--preview-border);
  border-radius: var(--leaf-radius-md);
  background: var(--code-block-background);
}
.document-body .tei-front-summary {
  cursor: pointer;
  padding: 0.5em 0.9em;
  font-weight: 600;
  color: var(--preview-foreground);
  list-style: none;
  user-select: none;
}
.document-body .tei-front-summary::-webkit-details-marker {
  display: none;
}
.document-body .tei-front-summary::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  margin-right: 0.55em;
  border-left: 0.4em solid currentColor;
  border-top: 0.32em solid transparent;
  border-bottom: 0.32em solid transparent;
  vertical-align: middle;
  transition: transform 0.15s ease;
}
.document-body .tei-front[open] > .tei-front-summary::before {
  transform: rotate(90deg);
}
.document-body .tei-front-summary:hover {
  color: var(--markdown-link-hover);
}
.document-body .tei-front-body {
  padding: 0 1.4em 0.7em;
  border-top: 1px solid var(--preview-border);
}
.document-body .tei-front-body > :first-child {
  margin-top: 0.7em;
}
/* Generic (non-TEI) XML: label/value rows share one two-column grid, so the
   labels line up down the page. */
.document-body .xml-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.3em 1.2em;
  margin: var(--type-spacing) 0;
}
.document-body .xml-fields dt {
  color: var(--preview-muted-foreground);
  font-family: var(--app-font);
  font-size: 0.9em;
  font-weight: 600;
  line-height: inherit;
  padding-top: 0.12em;
}
.document-body .xml-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}
/* An element's attributes sit tighter under its heading than its content does. */
.document-body .xml-attributes {
  margin-top: calc(-0.4 * var(--type-spacing));
}
/* Attributes carried alongside a value, shown after it. */
.document-body .xml-value-attrs {
  color: var(--preview-muted-foreground);
  font-size: 0.9em;
}
/* Repeated records (a sitemap's urls, a POM's dependencies) become a table.
   Long URL cells wrap rather than pushing the table into a scroll. */
.document-body .xml-table {
  font-size: 0.95em;
  width: 100%;
}
.document-body .xml-table td {
  overflow-wrap: anywhere;
  vertical-align: top;
}
:root[data-speed-reader="true"] .document-body {
  color: color-mix(in srgb, var(--preview-foreground) 80%, var(--reading-background));
  font-weight: 400;
}
:root[data-speed-reader="true"] .document-body h1,
:root[data-speed-reader="true"] .document-body h2,
:root[data-speed-reader="true"] .document-body h3,
:root[data-speed-reader="true"] .document-body h4,
:root[data-speed-reader="true"] .document-body h5,
:root[data-speed-reader="true"] .document-body h6,
:root[data-speed-reader="true"] .document-body strong,
:root[data-speed-reader="true"] .document-body b,
:root[data-speed-reader="true"] .document-body .github-mention,
:root[data-speed-reader="true"] .document-body .markdown-alert-note::before,
:root[data-speed-reader="true"] .document-body .markdown-alert-tip::before,
:root[data-speed-reader="true"] .document-body .markdown-alert-important::before,
:root[data-speed-reader="true"] .document-body .markdown-alert-warning::before,
:root[data-speed-reader="true"] .document-body .markdown-alert-caution::before {
  color: color-mix(in srgb, var(--preview-foreground) 80%, var(--reading-background));
  font-weight: 400;
}
:root[data-speed-reader="true"] .document-body em,
:root[data-speed-reader="true"] .document-body i {
  font-style: italic;
  font-weight: 400;
}
:root[data-speed-reader="true"] .document-body a,
:root[data-speed-reader="true"] .document-body .github-ref,
:root[data-speed-reader="true"] .document-body .github-mention {
  color: inherit;
  /* Quiet, dim underline so links stay findable without competing with the
     bold lead anchors. */
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 0.18em;
}
:root[data-speed-reader="true"] .document-body a:hover,
:root[data-speed-reader="true"] .document-body a:focus-visible,
:root[data-speed-reader="true"] .document-body .github-ref:hover,
:root[data-speed-reader="true"] .document-body .github-mention:hover {
  color: var(--markdown-link-hover);
  text-decoration: underline;
}
:root[data-speed-reader="true"] .document-body .speed-reader-anchor {
  color: var(--preview-foreground);
  font-weight: 700;
}
/* Glossary term links: a quiet dotted underline in the surrounding text's
   colour (not the accent), so a term stays discoverable without standing out.
   Matches both `glossary:slug` and a `…/GLOSSARY.md#slug` link; placed last so
   it wins ties against the generic link/hover rules above. */
.document-body a[href^="glossary:" i],
.document-body a[href*="GLOSSARY.md#" i],
.document-body a[href^="glossary:" i]:hover,
.document-body a[href*="GLOSSARY.md#" i]:hover,
:root[data-speed-reader="true"] .document-body a[href^="glossary:" i],
:root[data-speed-reader="true"] .document-body a[href*="GLOSSARY.md#" i] {
  color: inherit;
  text-decoration: underline dotted;
  text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  text-underline-offset: 0.18em;
}
.document-body .github-ref,
.document-body .github-mention {
  border: 1px solid var(--preview-border);
  border-radius: var(--leaf-radius-pill);
  background: var(--markdown-badge-background);
  color: var(--markdown-badge-foreground);
  font-family: var(--app-font);
  font-size: 0.82em;
  font-weight: 700;
  padding: 0.08em 0.42em;
  text-decoration: none;
}
.document-body .commit-ref code {
  background: transparent;
  color: inherit;
  font-size: 0.95em;
  padding: 0;
}
.document-body .emoji {
  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;
}
.document-body ul,
.document-body ol {
  padding-left: 2em;
}
.document-body li + li {
  margin-top: 0.25em;
}
.document-body li > ul,
.document-body li > ol {
  margin: 0.25em 0 0;
}
/* Ordered lists follow the classic outline sequence by depth (I, A, 1, a, i)
   rather than restarting at decimal each level. */
.document-body ol {
  list-style-type: upper-roman;
}
.document-body ol ol {
  list-style-type: upper-alpha;
}
.document-body ol ol ol {
  list-style-type: decimal;
}
.document-body ol ol ol ol {
  list-style-type: lower-alpha;
}
.document-body ol ol ol ol ol {
  list-style-type: lower-roman;
}
.document-body .task-list-item {
  list-style: none;
}
.document-body input[type="checkbox"] {
  accent-color: var(--leaf-markdown-checkbox, #6e7681);
  margin-right: 0.4em;
}
/* A task checkbox the reading view has made interactive (its `disabled`
   attribute removed) reads as clickable. */
.document-body input[type="checkbox"]:not([disabled]) {
  cursor: pointer;
}
/* Live editing affordances: text caret on hover, a focus ring while editing,
   and the monospace source font for XML blocks edited as raw source. */
.document-body .leaf-editable {
  cursor: text;
}
.document-body .leaf-editable:focus,
.document-body .leaf-editable:focus-visible {
  outline: 2px solid var(--leaf-accent, var(--markdown-blockquote-border));
  outline-offset: 2px;
  border-radius: var(--leaf-radius-xs);
}
.document-body .leaf-editing-source {
  font-family: var(--leaf-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  background: var(--markdown-code-background, rgba(127, 127, 127, 0.12));
  border-radius: var(--leaf-radius-sm);
}
/* The fresh empty paragraph Enter opens below a block: give it a line's height
   so the caret has somewhere to blink (Markdown has no empty block). */
.document-body .leaf-insert-block {
  min-height: 1.5em;
}
/* Links inside an editable block keep the pointer cursor, not the text caret. */
.document-body .leaf-editable a {
  cursor: pointer;
}
.document-body blockquote {
  border-left: 0.25em solid var(--markdown-blockquote-border);
  color: var(--markdown-blockquote-foreground);
  padding: 0 1em;
}
.document-body blockquote:not(.markdown-alert) p {
  padding-left: 1.25em;
  text-indent: -1.25em;
}
.document-body blockquote:not(.markdown-alert) p.blockquote-lines {
  padding-left: 0;
  text-indent: 0;
}
.document-body blockquote:not(.markdown-alert) .blockquote-line {
  display: block;
  padding-left: 1.25em;
  text-indent: -1.25em;
}
.document-body blockquote > :first-child {
  margin-top: 0;
}
.document-body blockquote > :last-child {
  margin-bottom: 0;
}
.document-body .markdown-alert-note,
.document-body .markdown-alert-tip,
.document-body .markdown-alert-important,
.document-body .markdown-alert-warning,
.document-body .markdown-alert-caution {
  border-left-width: 6px;
  font-family: var(--app-font);
  font-size: 0.92em;
  line-height: 1.55;
  position: relative;
}
.document-body .markdown-alert-note::before,
.document-body .markdown-alert-tip::before,
.document-body .markdown-alert-important::before,
.document-body .markdown-alert-warning::before,
.document-body .markdown-alert-caution::before {
  display: block;
  font-weight: 700;
  letter-spacing: 0;
  margin-bottom: 0.15em;
}
.document-body .markdown-alert-note {
  border-left-color: var(--markdown-alert-note-border);
}
.document-body .markdown-alert-note::before {
  color: var(--markdown-alert-note-border);
  content: "Note";
}
.document-body .markdown-alert-tip {
  border-left-color: var(--markdown-alert-tip-border);
}
.document-body .markdown-alert-tip::before {
  color: var(--markdown-alert-tip-border);
  content: "Tip";
}
.document-body .markdown-alert-important {
  border-left-color: var(--markdown-alert-important-border);
}
.document-body .markdown-alert-important::before {
  color: var(--markdown-alert-important-border);
  content: "Important";
}
.document-body .markdown-alert-warning {
  border-left-color: var(--markdown-alert-warning-border);
}
.document-body .markdown-alert-warning::before {
  color: var(--markdown-alert-warning-border);
  content: "Warning";
}
.document-body .markdown-alert-caution {
  border-left-color: var(--markdown-alert-caution-border);
}
.document-body .markdown-alert-caution::before {
  color: var(--markdown-alert-caution-border);
  content: "Caution";
}
.document-body code {
  background: var(--markdown-inline-code-background);
  border-radius: var(--leaf-radius-md);
  color: var(--markdown-inline-code-foreground);
  font-family: var(--code-font);
  font-size: 0.875em;
  padding: 0.2em 0.4em;
}
.document-body pre {
  position: relative;
  background: var(--code-block-background);
  background-clip: padding-box;
  border-radius: var(--leaf-radius-md);
  clip-path: inset(0 round 6px);
  color: var(--code-block-foreground);
  line-height: 1.45;
  overflow: auto;
  padding: 1em;
  tab-size: 4;
}
.document-body pre code {
  background: transparent;
  color: inherit;
  font-size: 0.875em;
  padding: 0;
  white-space: pre;
  word-break: normal;
}
.document-body pre ::selection {
  background: var(--code-block-selection-background);
  color: var(--code-block-selection-foreground);
}
.document-body pre.highlight,
.document-body pre.mermaid {
  position: relative;
}
.document-body pre.highlight::before,
.document-body pre.mermaid::before {
  content: attr(data-language);
  position: absolute;
  top: 8px;
  right: 12px;
  color: var(--preview-muted-foreground);
  font: 700 11px var(--app-font);
  letter-spacing: 0;
  text-transform: uppercase;
}
/* On highlighted blocks the copy button sits top-right, so nudge the language
   label left to make room. */
.document-body pre.highlight::before {
  right: 44px;
}
/* "Copy all" button on code blocks: muted at rest, brightening on hover/focus,
   swapping to a check mark briefly on copy. */
.document-body pre > .code-copy {
  position: absolute;
  top: 6px;
  right: 8px;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--leaf-radius-md);
  background: color-mix(in srgb, var(--code-block-background) 65%, transparent);
  color: var(--preview-muted-foreground);
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease,
    border-color 0.12s ease;
}
.document-body pre:hover > .code-copy,
.document-body pre > .code-copy:focus-visible {
  opacity: 1;
}
.document-body pre > .code-copy:hover {
  background: var(--code-block-background);
  border-color: var(--code-block-border);
  color: var(--preview-foreground);
}
.document-body pre > .code-copy.is-copied {
  opacity: 1;
  color: var(--success, currentColor);
}
.code-copy-mark {
  width: 16px;
  height: 16px;
  pointer-events: none;
}
.code-copy-check {
  display: none;
}
.code-copy.is-copied .code-copy-copy {
  display: none;
}
.code-copy.is-copied .code-copy-check {
  display: block;
}
/* Permalink number for any anchor-addressable block. Out of flow, hidden until
   the block is hovered or the number focused (always visible on touch/narrow —
   see the media query below). */
.document-body .has-anchor-link {
  position: relative;
}
/* The number hangs in the margin left of its block (right: 100%) so the block's
   box — and a list item's ::marker — stays where normal flow puts it. The anchor
   inherits the block's font metrics, so the small number sits on the block's
   first-line baseline rather than floating like a superscript. */
.document-body .heading-anchor {
  position: absolute;
  right: 100%;
  top: 0;
  display: block;
  width: 40px;
  padding-right: 8px;
  font-size: inherit;
  line-height: inherit;
  text-align: right;
  white-space: nowrap;
  background: transparent;
  color: var(--preview-muted-foreground);
  opacity: 0;
  pointer-events: auto;
  user-select: none;
  transition: opacity 0.12s ease, color 0.12s ease;
}
/* The visible glyph: a small monospace number on the block's first-line baseline. */
.document-body .heading-anchor-num {
  font-family: var(--code-font);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  vertical-align: baseline;
}
/* "Line numbers" off hides the visible number; blocks keep their ids and locus
   aliases, so #locus deep links still resolve. */
:root[data-line-numbers-enabled="false"] .document-body .heading-anchor {
  display: none;
}
/* A list item's number steps 2em further left to clear the ::marker and align
   on the same gutter column as every other number. */
.document-body li.has-anchor-link > .heading-anchor {
  right: calc(100% + 2em);
}
/* pre and table are overflow containers, so a number hung outside is clipped.
   Seat it inside a 40px left padding pulled back with a negative margin instead;
   neither has a ::marker to drag out of place. */
.document-body pre.has-anchor-link,
.document-body table.has-anchor-link {
  padding-left: 40px;
  margin-left: -40px;
}
.document-body pre.has-anchor-link > .heading-anchor,
.document-body table.has-anchor-link > .heading-anchor {
  right: auto;
  left: 0;
}
/* A zero-size alias that carries a heading's #locus without disturbing its
   layout (the heading keeps its slug id for the table of contents). */
.document-body .locus-alias {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
/* Anchorable blocks nest, so hovering a deep block also hovers its ancestors.
   The :not(:has(...)) guard reveals only the innermost hovered/focused block's
   number, not a stack of ghost numbers in the shared gutter. */
.document-body .has-anchor-link:hover:not(:has(.has-anchor-link:hover)) > .heading-anchor,
.document-body .has-anchor-link:focus-within:not(:has(.has-anchor-link:focus-within)) > .heading-anchor,
.document-body .has-anchor-link > .heading-anchor:hover,
.document-body .has-anchor-link > .heading-anchor:focus-visible {
  opacity: 1;
  color: var(--reading-link);
}
.document-body .heading-anchor:hover {
  color: var(--reading-link);
}
/* Confirms a click copied the #locus: hold the number lit for the timeout
   decorateAnchorLinks sets. */
.document-body .heading-anchor.is-copied {
  opacity: 1;
  color: var(--reading-link);
}
/* Narrow/touch has little left margin, so tuck the numbers tighter and shrink
   them. Kept always-visible (no hover to reveal), so one tap copies and jumps. */
@media (hover: none), (max-width: 600px) {
  .document-body .heading-anchor {
    padding-right: 3px;
    opacity: 0.4;
  }
  .document-body .heading-anchor-num {
    font-size: 11px;
  }
}
.document-body pre.mermaid[data-processed="true"] {
  background: transparent;
  border: 0;
  color: var(--preview-foreground);
  padding: 0;
  text-align: center;
}
.document-body pre.mermaid[data-processed="true"]::before {
  content: none;
}
.document-body pre.mermaid[data-processed="true"] svg {
  display: inline-block;
  height: auto;
  max-width: 100%;
}
.document-body .syn-comment {
  color: var(--syntax-comment);
  font-style: italic;
}
.document-body .syn-keyword,
.document-body .syn-storage,
.document-body .syn-control {
  color: var(--syntax-keyword);
  font-weight: 700;
}
.document-body .syn-operator {
  color: var(--syntax-operator);
  font-weight: 700;
}
.document-body .syn-string {
  color: var(--syntax-string);
}
.document-body .syn-constant,
.document-body .syn-numeric,
.document-body .syn-boolean,
.document-body .syn-character,
.document-body .syn-language {
  color: var(--syntax-number);
}
.document-body .syn-entity,
.document-body .syn-tag,
.document-body .syn-attribute,
.document-body .syn-heading {
  color: var(--syntax-function);
}
.document-body .syn-function,
.document-body .syn-method {
  color: var(--syntax-function);
}
.document-body .syn-type,
.document-body .syn-class,
.document-body .syn-support {
  color: var(--syntax-type);
}
.document-body .syn-variable,
.document-body .syn-parameter,
.document-body .syn-property {
  color: var(--syntax-variable);
}
.document-body .syn-punctuation {
  color: var(--syntax-punctuation);
}
.document-body .syn-invalid,
.document-body .syn-illegal {
  color: var(--syntax-deleted);
  text-decoration: underline;
}
.document-body .syn-inserted {
  background: var(--syntax-inserted-bg);
  color: var(--syntax-inserted);
  text-decoration: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}
.document-body .syn-deleted {
  background: var(--syntax-deleted-bg);
  color: var(--syntax-deleted);
  text-decoration: line-through;
  text-decoration-thickness: 0.08em;
}
.document-body .syn-changed {
  background: var(--syntax-changed-bg);
  color: var(--syntax-changed);
  font-style: italic;
}
/* ---- Code view (raw source editing) -------------------------------------
   Wrapped source drawn as three aligned layers: the colour layer (the reader's
   Rust highlighter), a transparent per-line mirror carrying wrap-aware line
   numbers, and a transparent textarea owning caret/selection/IME/undo. All
   share identical metrics so their wrapping and line positions match exactly. */
/* The reader shell is the scroller (its scrollbar is hidden); no sideways scroll. */
.reader-shell.code-view-shell {
  overflow-x: hidden;
  overflow-y: auto;
}
/* Laid out like .reader-layout: one grid cell with the reader's .document-minimap
   overlaid at the right edge, so the shared minimap machinery works unchanged. */
.code-view {
  --cv-gutter: 3.75em;
  --cv-pad-x: 20px;
  --cv-pad-y: 16px;
  --cv-pad-top: 16px;
  --minimap-padding-inline: 8px;
  --minimap-preview-width: 68px;
  --minimap-width: calc(var(--minimap-preview-width) + (var(--minimap-padding-inline) * 2));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 100%;
  background: var(--code-block-background, var(--preview-background));
  font-family: var(--code-font);
  font-size: 13.5px;
  line-height: 1.6;
  tab-size: 4;
}
/* As tall as its content (the colour layer sets height), but at least a viewport. */
.code-view-doc {
  grid-area: 1 / 1;
  min-width: 0;
  margin-right: var(--minimap-width);
  position: relative;
  min-height: calc(100vh - var(--app-bar-height));
}
/* Here the document reserves the rail's space with margin, so the rail sits
   flush at the cell edge (the reading view bleeds it across padding instead). */
.code-view .document-minimap {
  margin-right: 0;
}
.code-view-highlight,
.code-view-highlight code,
.code-view-linenums,
.code-view-input {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  tab-size: inherit;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}
.code-view-highlight {
  position: relative;
  z-index: 0;
  margin: 0;
  /* Extra bottom room so the layer stays at least as tall as the textarea and
     never clips the last line. */
  padding: var(--cv-pad-top) var(--cv-pad-x) calc(var(--cv-pad-y) + 1.6em)
    var(--cv-gutter);
  color: var(--code-block-foreground, var(--preview-foreground));
  background: transparent;
  pointer-events: none;
}
.code-view-highlight code {
  display: block;
  margin: 0;
  padding: 0;
  background: none;
  color: inherit;
}
/* One block per source line so a keystroke recolours only the edited line. Wraps
   exactly like the textarea and gutter row beside it (rules inherited above). */
.cv-line {
  display: block;
  margin: 0;
  padding: 0;
}
.code-view-linenums {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: var(--cv-pad-top) var(--cv-pad-x) var(--cv-pad-y) 0;
  color: transparent;
  z-index: 1;
  pointer-events: none;
}
.cv-lnrow {
  display: flex;
  align-items: flex-start;
}
.cv-lnnum {
  box-sizing: border-box;
  flex: 0 0 var(--cv-gutter);
  padding-right: 14px;
  text-align: right;
  color: var(--preview-muted-foreground);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.cv-lntxt {
  flex: 1 1 auto;
  min-width: 0;
}
.code-view-input {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: block;
  width: 100%;
  margin: 0;
  border: 0;
  padding: var(--cv-pad-top) var(--cv-pad-x) calc(var(--cv-pad-y) + 1.6em)
    var(--cv-gutter);
  box-sizing: border-box;
  color: transparent;
  caret-color: var(--preview-foreground);
  background: transparent;
  resize: none;
  outline: none;
  overflow: hidden;
}
.code-view-input::selection {
  background: var(--code-block-selection-background);
  color: transparent;
}
.code-view .syn-comment {
  color: var(--syntax-comment);
  font-style: italic;
}
.code-view .syn-keyword,
.code-view .syn-storage,
.code-view .syn-control {
  color: var(--syntax-keyword);
  font-weight: 700;
}
.code-view .syn-operator {
  color: var(--syntax-operator);
  font-weight: 700;
}
.code-view .syn-string {
  color: var(--syntax-string);
}
.code-view .syn-constant,
.code-view .syn-numeric,
.code-view .syn-boolean,
.code-view .syn-character,
.code-view .syn-language {
  color: var(--syntax-number);
}
.code-view .syn-entity,
.code-view .syn-tag,
.code-view .syn-attribute,
.code-view .syn-heading {
  color: var(--syntax-function);
}
.code-view .syn-function,
.code-view .syn-method {
  color: var(--syntax-function);
}
.code-view .syn-type,
.code-view .syn-class,
.code-view .syn-support {
  color: var(--syntax-type);
}
.code-view .syn-variable,
.code-view .syn-parameter,
.code-view .syn-property {
  color: var(--syntax-variable);
}
.code-view .syn-punctuation {
  color: var(--syntax-punctuation);
}
.code-view .syn-invalid,
.code-view .syn-illegal {
  color: var(--syntax-deleted);
  text-decoration: underline;
}
/* Markdown markup scopes. The rules above cover programming-language scopes,
   but raw Markdown is mostly markup.* (bold, italic, links, code, quotes),
   which would otherwise sit unstyled. Each construct's delimiter carries a
   punctuation.definition.* scope; pairing each markup rule with its sibling (at
   higher specificity than the generic .syn-punctuation) colours the marker to
   match its construct, the way an editor does. */
.code-view .syn-markup.syn-heading,
.code-view .syn-section,
.code-view .syn-punctuation.syn-definition.syn-heading {
  color: var(--syntax-function);
  font-weight: 700;
}
.code-view .syn-markup.syn-bold,
.code-view .syn-punctuation.syn-definition.syn-bold {
  color: var(--syntax-keyword);
  font-weight: 700;
}
.code-view .syn-markup.syn-italic,
.code-view .syn-punctuation.syn-definition.syn-italic {
  color: var(--syntax-keyword);
  font-style: italic;
}
.code-view .syn-markup.syn-raw,
.code-view .syn-punctuation.syn-definition.syn-raw {
  color: var(--syntax-string);
}
.code-view .syn-markup.syn-underline.syn-link,
.code-view .syn-meta.syn-link {
  color: var(--syntax-number);
}
/* Link/image delimiters (`[ ]` label, `( )` destination): colour them the link
   hue so `[label](url)` reads as one unit, not grey brackets. */
.code-view .syn-punctuation.syn-definition.syn-link,
.code-view .syn-punctuation.syn-definition.syn-metadata,
.code-view .syn-punctuation.syn-definition.syn-image {
  color: var(--syntax-number);
}
.code-view .syn-markup.syn-quote,
.code-view .syn-punctuation.syn-definition.syn-blockquote {
  color: var(--syntax-comment);
  font-style: italic;
}
/* The list marker (`-`, `*`, `1.`) is punctuation.definition.list_item; the
   markup.list scopes wrap the whole item, so colouring those would tint text. */
.code-view .syn-punctuation.syn-list_item {
  color: var(--syntax-keyword);
  font-weight: 700;
}
.code-view .syn-markup.syn-strikethrough {
  text-decoration: line-through;
}
/* XML: give attribute names their own hue (both name and tag are entity.* and
   would otherwise share a colour) and bold the element name, editor-style. */
.code-view .syn-entity.syn-name.syn-tag {
  font-weight: 700;
}
.code-view .syn-entity.syn-attribute-name {
  color: var(--syntax-variable);
  font-weight: 400;
}
.document-body .math {
  font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif;
}
.document-body .math-inline {
  background: var(--math-inline-background);
  border-radius: var(--leaf-radius-sm);
  padding: 0.08em 0.24em;
}
.document-body .math-display {
  display: block;
  overflow-x: auto;
  text-align: center;
}
.document-body .footnote-reference,
.document-body .footnote-definition-label {
  font-family: var(--app-font);
}
.document-body .footnote-definition {
  border-top: 1px solid var(--preview-rule);
  color: var(--preview-muted-foreground);
  font-size: var(--type-caption-size);
  line-height: var(--type-caption-line);
  margin-top: 32px;
  padding-top: 0.8em;
}
.document-body .footnote-backref {
  align-items: center;
  display: inline-flex;
  font-family: var(--app-font);
  font-size: 0.82em;
  height: 1em;
  line-height: 1;
  margin-left: 0.3em;
  text-decoration: none;
  vertical-align: -0.12em;
}
.document-body .footnote-backref svg {
  display: block;
  height: 1em;
  width: 1em;
}
.document-body table {
  border-collapse: collapse;
  display: block;
  font-family: var(--app-font);
  line-height: 1.45;
  overflow: auto;
  width: max-content;
  max-width: 100%;
}
.document-body th,
.document-body td {
  border: 1px solid var(--markdown-table-cell-border);
  padding: 0.375em 0.8125em;
}
.document-body th {
  background: var(--markdown-table-heading-background);
  color: var(--preview-heading);
  font-weight: 600;
}
.document-body tr:nth-child(2n) td {
  background: rgba(110, 118, 129, 0.08);
}
.document-body kbd {
  border: 1px solid var(--keyboard-border);
  border-bottom-width: 2px;
  border-radius: var(--leaf-radius-sm);
  background: var(--keyboard-background);
  font-family: var(--code-font);
  font-size: 0.8em;
  padding: 0.08em 0.32em;
}
.document-body summary {
  cursor: pointer;
  font-family: var(--app-font);
  font-weight: 700;
}
/* The leading frontmatter block renders as a compact metadata table: small
   Noto Sans (the UI font), tight rows, no table chrome — distinct from body. */
.document-body .frontmatter {
  margin: 0 0 var(--type-spacing);
  overflow-x: auto;
}
.document-body .frontmatter table {
  border-collapse: collapse;
  font-family: var(--app-font);
  font-size: 12px;
  line-height: 1.5;
}
.document-body .frontmatter th,
.document-body .frontmatter td {
  text-align: left;
  vertical-align: top;
  padding: 1px 12px 1px 0;
  border: 0;
  background: none;
}
.document-body .frontmatter th {
  font-weight: 600;
  white-space: nowrap;
  color: var(--preview-muted-foreground);
}
.document-body img {
  display: block;
  height: auto;
  margin: 0 auto var(--type-spacing);
  max-width: 100%;
}
.document-body hr {
  border: 0;
  height: 1px;
  margin: var(--type-spacing) 0;
  background: var(--markdown-thematic-break);
}
.document-body figcaption,
.document-body .caption,
.document-body .metadata {
  color: var(--preview-muted-foreground);
  font-family: var(--app-font);
  font-size: var(--type-caption-size);
  line-height: var(--type-caption-line);
  margin-block-start: 0;
}
.document-minimap {
  --minimap-viewport-top: 0%;
  --minimap-viewport-height: 100%;
  --minimap-track-height: 100%;
  align-self: start;
  grid-area: 1 / 1;
  justify-self: end;
  position: sticky;
  top: 0;
  width: var(--minimap-width);
  /* Bleed back across the reserved right padding so the rail stays flush to the
     reader's right edge. */
  margin-right: calc(-1 * (var(--reader-layout-padding-inline) + var(--minimap-width)));
  z-index: 5;
}
.document-minimap-track {
  box-sizing: border-box;
  position: relative;
  width: 100%;
  height: var(--minimap-track-height);
  cursor: default;
  opacity: 0.92;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}
/* Holds the scaled document clone; slides within the clipped track (JS sets top
   via --minimap-preview-top) when the document is taller than the rail. */
.document-minimap-content {
  position: absolute;
  top: var(--minimap-preview-top, 0px);
  right: var(--minimap-padding-inline);
  left: var(--minimap-padding-inline);
  overflow: visible;
  pointer-events: none;
  will-change: top;
}
/* The clone: a shrunken rendering of the document. JS sets its width and a
   translateY + scale transform (origin top-left). Zero the .document-body
   scroll-origin margin (JS positions it) but keep its padding so the internal
   layout matches the page. */
.document-minimap-preview {
  box-sizing: border-box;
  margin: 0 !important;
  transform-origin: 0 0;
  pointer-events: none;
}
/* The clone is inert; clicks belong to the rail, which handles jump/drag. */
.document-minimap-preview,
.document-minimap-preview * {
  pointer-events: none !important;
}
/* The clone strips hrefs, so the href-based glossary blend no longer matches and
   terms would show accent-blue. updateDocumentMinimapPreview tags them
   .glossary-term before stripping; re-blend them to body text here. */
.document-minimap-preview a.glossary-term {
  color: inherit;
}
.document-minimap-viewport {
  position: absolute;
  inset-inline: 0;
  top: var(--minimap-viewport-top);
  z-index: 1;
  height: var(--minimap-viewport-height);
  min-height: 22px;
  border: 1px solid var(--minimap-viewport-border);
  background: var(--minimap-viewport-background);
  pointer-events: none;
}
.empty-state {
  width: min(720px, calc(100% - 40px));
  margin: 0 auto;
  padding: 14vh 0;
}
.empty-state .kicker,
.recent h2 {
  color: var(--primary);
  font: 700 13px var(--app-font);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.empty-state h1 {
  color: var(--empty-heading);
  font: 700 clamp(2.6rem, 7vw, 5.2rem) / 1.04 var(--heading-font);
  letter-spacing: -0.01em;
  margin: 0 0 18px;
}
.empty-description {
  color: var(--preview-muted-foreground);
  font: 500 16px/1.6 var(--app-font);
  margin: 0 0 26px;
  max-width: 54ch;
}
.empty-help {
  color: var(--preview-muted-foreground);
  font: 500 15px/1.6 var(--app-font);
  margin: 18px 0 0;
}
.primary-open {
  font-size: 15px;
  padding: 11px 18px;
}
.recent {
  border-top: 1px solid var(--recent-border);
  margin-top: 54px;
  padding-top: 24px;
}
.recent ol {
  list-style: none;
  margin: 0;
  padding: 0;
}
.recent li + li {
  margin-top: 8px;
}
.recent button {
  width: 100%;
  border-color: transparent;
  background: transparent;
  color: var(--recent-item-foreground);
  overflow-wrap: anywhere;
  padding: 10px 0;
  text-align: left;
}
.recent button:hover {
  color: var(--recent-item-hover-foreground);
}
@media (max-width: 900px) {
  :root {
    --type-display-size: calc(var(--type-base) * 2.4);
    --type-h1-size: calc(var(--type-base) * 1.9);
    --type-h2-size: calc(var(--type-base) * 1.7);
    --type-h3-size: calc(var(--type-base) * 1.55);
    --type-h4-size: calc(var(--type-base) * 1.4);
    --type-h5-size: calc(var(--type-base) * 1.3);
    --type-h6-size: calc(var(--type-base) * 1.15);
  }
  .reader-layout {
    --minimap-preview-width: 46px;
  }
}
@media (max-width: 640px) {
  .app-bar {
    gap: 8px;
    padding: 0 12px;
  }
  .tab {
    max-width: 104px;
  }
  .tab-active {
    max-width: 200px;
  }
  .tab-label {
    max-width: 96px;
  }
  .tab-active .tab-label {
    max-width: 184px;
  }
}
@media (max-width: 600px) {
  :root {
    --reader-content-pad: 16px;
    --type-display-size: calc(var(--type-base) * 2);
    --type-h1-size: calc(var(--type-base) * 1.6);
    --type-h2-size: calc(var(--type-base) * 1.45);
    --type-h3-size: calc(var(--type-base) * 1.35);
    --type-h4-size: calc(var(--type-base) * 1.25);
    --type-h5-size: calc(var(--type-base) * 1.2);
    --type-h6-size: calc(var(--type-base) * 1.1);
  }
  .reader-layout {
    --minimap-preview-width: 38px;
  }
}

/* ---- Glossary bottom sheet ---------------------------------------------
   A glossary link opens the term here, sliding up over the reading view; the
   document keeps its place underneath. The body reuses .document-body so the
   entry is styled like ordinary Markdown. See window.leafShowGlossary. */
.glossary-backdrop[hidden],
.glossary-sheet[hidden] {
  display: none;
}
.glossary-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 40;
}
.glossary-backdrop.open {
  opacity: 1;
}
.glossary-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 41;
  display: flex;
  flex-direction: column;
  max-height: 78vh;
  background: var(--background);
  color: var(--foreground);
  border-top-left-radius: var(--leaf-radius-2xl);
  border-top-right-radius: var(--leaf-radius-2xl);
  box-shadow: var(--leaf-shadow-sheet);
  transform: translateY(100%);
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}
.glossary-sheet.open {
  transform: translateY(0);
}
/* Settings row that opens the theme selector: label on the left, the current
   "Family · Appearance" summary and a chevron on the right. */
.setting-theme-open {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--settings-control-border);
  border-radius: var(--leaf-radius-md);
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.setting-theme-open:hover {
  border-color: var(--border-strong);
  background: var(--surface-muted);
}
.setting-theme-open .setting-label {
  font-size: 13px;
  font-weight: 800;
}
.setting-theme-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-muted-foreground);
  font-size: 12px;
  text-align: right;
}
.setting-theme-chevron {
  color: var(--app-muted-foreground);
  font-size: 18px;
  line-height: 1;
}
/* Theme selector bottom sheet — same slide-up pattern as the glossary sheet. */
.theme-sheet-backdrop[hidden],
.theme-sheet[hidden] {
  display: none;
}
.theme-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 40;
}
.theme-sheet-backdrop.open {
  opacity: 1;
}
.theme-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 41;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 78vh;
  padding: 0 20px 24px;
  background: var(--surface-elevated);
  color: var(--foreground);
  border-top-left-radius: var(--leaf-radius-2xl);
  border-top-right-radius: var(--leaf-radius-2xl);
  box-shadow: var(--leaf-shadow-sheet);
  font-family: var(--app-font);
  transform: translateY(100%);
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}
.theme-sheet.open {
  transform: translateY(0);
}
.theme-sheet-grip {
  width: 40px;
  height: 4px;
  margin: 10px auto 2px;
  border-radius: var(--leaf-radius-pill);
  background: var(--border-strong);
}
.theme-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.theme-sheet-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--foreground);
}
.theme-sheet-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--leaf-radius-lg);
  background: transparent;
  color: var(--app-muted-foreground);
  cursor: pointer;
}
.theme-sheet-close:hover {
  background: var(--surface-muted);
  border-color: transparent;
  color: var(--foreground);
}
.theme-sheet-close svg {
  width: 18px;
  height: 18px;
}
.theme-sheet-modes {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.theme-mode-btn {
  padding: 8px 6px;
  border: 1px solid var(--settings-control-border);
  border-radius: var(--leaf-radius-lg);
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
  font: 600 12px var(--app-font);
  cursor: pointer;
}
.theme-mode-btn:hover {
  background: var(--surface-muted);
  border-color: var(--border-strong);
}
.theme-mode-btn.is-active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--primary-foreground);
}
.theme-sheet-divider {
  height: 1px;
  margin: 0;
  border: 0;
  background: var(--border);
}
.theme-sheet-grid {
  list-style: none;
  margin: 0;
  padding: 2px;
  /* Equal-column grid so every card is the same width. auto-fit (not auto-fill)
     collapses empty tracks, so the cards grow to fill the row instead of sitting
     at their min width with big gaps. */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  overflow-y: auto;
}
.theme-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 54px;
  padding: 14px 18px;
  border: 0;
  border-radius: var(--leaf-radius-xl);
  /* Flat tiles: a faint ink tint over the sheet fill (which the cards would
     otherwise match exactly), so they read without a stroke. */
  background: color-mix(in srgb, var(--foreground) 5%, var(--surface-elevated));
  color: var(--settings-control-foreground);
  font: 700 13.5px var(--app-font);
  text-align: center;
  cursor: pointer;
  transition: background 0.12s ease;
}
.theme-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.theme-item:hover {
  background: color-mix(in srgb, var(--foreground) 10%, var(--surface-elevated));
}
.theme-item.is-active {
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-elevated));
}
/* Selected badge: the check-circle, tinted with the theme accent, pinned to the
   card's top-right corner. Hidden until the card is active. */
.theme-item-check {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 16px;
  height: 16px;
  display: none;
  color: var(--accent);
  pointer-events: none;
}
.theme-item.is-active .theme-item-check {
  display: block;
}
.theme-sheet-footer {
  display: flex;
  justify-content: center;
}
.theme-sheet-browse {
  color: var(--link);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
.theme-sheet-browse:hover {
  color: var(--link-hover);
  text-decoration: underline;
}
.link-hover-tip {
  position: fixed;
  z-index: 60;
  max-width: min(34rem, calc(100vw - 24px));
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--leaf-radius-xl);
  background: color-mix(in srgb, var(--background) 92%, black);
  color: var(--foreground);
  box-shadow: var(--leaf-shadow-tooltip);
  pointer-events: none;
}
.link-hover-tip-kind {
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.2;
}
.link-hover-tip-detail {
  margin-top: 3px;
  color: var(--muted-foreground);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.link-hover-tip-lines {
  margin-top: 4px;
  color: var(--foreground);
  font-weight: 600;
  font-size: 0.74rem;
  line-height: 1.2;
}
.glossary-sheet-grip {
  flex: none;
  width: 36px;
  height: 4px;
  margin: 10px auto 2px;
  border-radius: var(--leaf-radius-xs);
  background: var(--border-strong);
}
.glossary-sheet-close {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  padding: 6px;
  border: 0;
  border-radius: var(--leaf-radius-md);
  background: none;
  color: var(--muted-foreground);
  cursor: pointer;
}
.glossary-sheet-close svg {
  width: 22px;
  height: 22px;
}
.glossary-sheet-close:hover {
  color: var(--foreground);
  background: var(--surface-elevated);
}
.glossary-sheet-body {
  /* Override .document-body's reading-measure width + scroll-origin margin so
     the entry fills the sheet and its scrollbar sits at the right edge. */
  width: auto;
  margin: 0;
  overflow-y: auto;
  padding: 6px 16px 4px 28px;
}
.glossary-sheet-body > :first-child {
  margin-top: 0;
}
.glossary-sheet-footer {
  flex: none;
  padding: 12px 28px 20px;
  border-top: 1px solid var(--border);
}
.glossary-sheet-fulllink {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.85rem;
  color: var(--link);
  cursor: pointer;
}
.glossary-sheet-fulllink:hover {
  /* Reset the global button:hover green fill so this reads as a plain link. */
  background: none;
  border-color: transparent;
  color: var(--link-hover);
  text-decoration: underline;
}
@media (min-width: 760px) {
  .glossary-sheet,
  .theme-sheet {
    left: 50%;
    right: auto;
    width: min(680px, 92vw);
    transform: translateX(-50%) translateY(100%);
  }
  .glossary-sheet.open,
  .theme-sheet.open {
    transform: translateX(-50%) translateY(0);
  }
}
"#
        );
        css
    })
}
