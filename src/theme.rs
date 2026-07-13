use std::collections::HashSet;
use std::sync::OnceLock;

pub(crate) const PRIMER_LIGHT_SELECTOR: &str = "[data-color-mode=\"light\"][data-light-theme=\"light\"],\n[data-color-mode=\"auto\"][data-light-theme=\"light\"]";
pub(crate) const PRIMER_DARK_SELECTOR: &str = "[data-color-mode=\"dark\"][data-dark-theme=\"dark\"],\n[data-color-mode=\"auto\"][data-light-theme=\"dark\"]";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThemeSourceKind {
    Primer,
    Dracula,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ThemeSource {
    pub(crate) id: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) selector: &'static str,
    pub(crate) kind: ThemeSourceKind,
    pub(crate) selectable: bool,
    pub(crate) tokens: &'static [(&'static str, &'static str)],
    /// Per-source token replacements layered over `tokens` (and winning over
    /// them), to nudge one palette without forking the shared token map.
    pub(crate) overrides: &'static [(&'static str, &'static str)],
}

pub(crate) const LEAF_SEMANTIC_TOKEN_CONTRACT: &[&str] = &[
    "--leaf-app-background",
    "--leaf-app-foreground",
    "--leaf-app-surface",
    "--leaf-app-surface-raised",
    "--leaf-app-surface-elevated",
    "--leaf-app-surface-muted",
    "--leaf-app-surface-sunken",
    "--leaf-app-surface-inset",
    "--leaf-app-surface-card",
    "--leaf-app-border",
    "--leaf-app-border-strong",
    "--leaf-app-muted-background",
    "--leaf-app-muted-foreground",
    "--leaf-app-primary",
    "--leaf-app-primary-foreground",
    "--leaf-app-secondary",
    "--leaf-app-secondary-foreground",
    "--leaf-app-accent",
    "--leaf-app-accent-foreground",
    "--leaf-app-danger",
    "--leaf-app-danger-foreground",
    "--leaf-app-warning",
    "--leaf-app-warning-foreground",
    "--leaf-app-success",
    "--leaf-app-success-foreground",
    "--leaf-app-done",
    "--leaf-app-done-foreground",
    "--leaf-app-link",
    "--leaf-app-link-hover",
    "--leaf-app-shadow",
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

pub(crate) const PRIMER_THEME_TOKENS: &[(&str, &str)] = &[
    ("--leaf-app-background", "var(--bgColor-default)"),
    ("--leaf-app-foreground", "var(--fgColor-default)"),
    ("--leaf-app-surface", "var(--bgColor-default)"),
    ("--leaf-app-surface-raised", "var(--bgColor-default)"),
    ("--leaf-app-surface-elevated", "var(--bgColor-default)"),
    ("--leaf-app-surface-muted", "var(--bgColor-muted)"),
    ("--leaf-app-surface-sunken", "var(--bgColor-inset)"),
    ("--leaf-app-surface-inset", "var(--bgColor-inset)"),
    ("--leaf-app-surface-card", "var(--bgColor-default)"),
    ("--leaf-app-border", "var(--borderColor-default)"),
    ("--leaf-app-border-strong", "var(--borderColor-emphasis)"),
    ("--leaf-app-muted-background", "var(--bgColor-muted)"),
    ("--leaf-app-muted-foreground", "var(--fgColor-muted)"),
    ("--leaf-app-primary", "var(--button-primary-bgColor-rest)"),
    (
        "--leaf-app-primary-foreground",
        "var(--button-primary-fgColor-rest)",
    ),
    ("--leaf-app-secondary", "var(--control-bgColor-rest)"),
    (
        "--leaf-app-secondary-foreground",
        "var(--control-fgColor-rest)",
    ),
    ("--leaf-app-accent", "var(--fgColor-accent)"),
    ("--leaf-app-accent-foreground", "var(--fgColor-onEmphasis)"),
    ("--leaf-app-danger", "var(--fgColor-danger)"),
    ("--leaf-app-danger-foreground", "var(--fgColor-onEmphasis)"),
    ("--leaf-app-warning", "var(--fgColor-attention)"),
    ("--leaf-app-warning-foreground", "var(--fgColor-default)"),
    ("--leaf-app-success", "var(--fgColor-success)"),
    ("--leaf-app-success-foreground", "var(--fgColor-onEmphasis)"),
    ("--leaf-app-done", "var(--fgColor-done)"),
    ("--leaf-app-done-foreground", "var(--fgColor-onEmphasis)"),
    ("--leaf-app-link", "var(--fgColor-accent)"),
    ("--leaf-app-link-hover", "var(--fgColor-accent)"),
    ("--leaf-app-shadow", "var(--shadow-resting-medium)"),
    ("--leaf-editor-background", "var(--bgColor-default)"),
    ("--leaf-editor-foreground", "var(--fgColor-default)"),
    (
        "--leaf-editor-selection-background",
        "var(--selection-bgColor)",
    ),
    (
        "--leaf-editor-selection-foreground",
        "var(--fgColor-default)",
    ),
    (
        "--leaf-editor-inline-code-background",
        "var(--bgColor-muted)",
    ),
    (
        "--leaf-editor-inline-code-foreground",
        "var(--fgColor-default)",
    ),
    ("--leaf-editor-code-background", "var(--bgColor-muted)"),
    ("--leaf-editor-code-foreground", "var(--fgColor-default)"),
    ("--leaf-editor-code-border", "var(--borderColor-default)"),
    (
        "--leaf-editor-code-selection-background",
        "var(--selection-bgColor)",
    ),
    (
        "--leaf-editor-code-selection-foreground",
        "var(--fgColor-default)",
    ),
    ("--leaf-markdown-background", "var(--bgColor-default)"),
    ("--leaf-markdown-foreground", "var(--fgColor-default)"),
    ("--leaf-markdown-heading", "var(--fgColor-default)"),
    ("--leaf-markdown-muted-foreground", "var(--fgColor-muted)"),
    ("--leaf-markdown-border", "var(--borderColor-default)"),
    ("--leaf-markdown-rule", "var(--borderColor-muted)"),
    ("--leaf-markdown-link", "var(--fgColor-accent)"),
    ("--leaf-markdown-link-hover", "var(--fgColor-accent)"),
    (
        "--leaf-markdown-inline-code-background",
        "var(--bgColor-muted)",
    ),
    (
        "--leaf-markdown-inline-code-foreground",
        "var(--fgColor-default)",
    ),
    (
        "--leaf-markdown-blockquote-background",
        "var(--bgColor-muted)",
    ),
    (
        "--leaf-markdown-blockquote-border",
        "var(--borderColor-default)",
    ),
    (
        "--leaf-markdown-blockquote-foreground",
        "var(--fgColor-muted)",
    ),
    ("--leaf-markdown-alert-note", "var(--fgColor-accent)"),
    ("--leaf-markdown-alert-tip", "var(--fgColor-success)"),
    (
        "--leaf-markdown-alert-important",
        "var(--button-primary-bgColor-rest)",
    ),
    ("--leaf-markdown-alert-warning", "var(--fgColor-attention)"),
    ("--leaf-markdown-alert-caution", "var(--fgColor-danger)"),
    ("--leaf-markdown-alert-done", "var(--fgColor-done)"),
    (
        "--leaf-markdown-badge-background",
        "var(--control-bgColor-rest)",
    ),
    (
        "--leaf-markdown-badge-foreground",
        "var(--control-fgColor-rest)",
    ),
    ("--leaf-markdown-table-border", "var(--borderColor-default)"),
    (
        "--leaf-markdown-table-header-background",
        "var(--bgColor-muted)",
    ),
    ("--leaf-markdown-thematic-break", "var(--borderColor-muted)"),
    (
        "--leaf-markdown-math-inline-background",
        "var(--control-bgColor-rest)",
    ),
    (
        "--leaf-markdown-keyboard-background",
        "var(--bgColor-default)",
    ),
    (
        "--leaf-markdown-keyboard-border",
        "var(--borderColor-default)",
    ),
    ("--leaf-minimap-background", "var(--bgColor-muted)"),
    ("--leaf-minimap-border", "var(--borderColor-default)"),
    ("--leaf-minimap-viewport-border", "var(--fgColor-accent)"),
    (
        "--leaf-minimap-viewport-background",
        "rgba(110, 118, 129, 0.14)",
    ),
    // Purple, so headings read apart from the green lists rather than collapsing
    // into one green wall in heading-dense documents. Matches Dracula.
    ("--leaf-minimap-heading", "var(--fgColor-done)"),
    ("--leaf-minimap-paragraph", "var(--fgColor-muted)"),
    ("--leaf-minimap-blank", "var(--borderColor-default)"),
    ("--leaf-minimap-list", "var(--fgColor-success)"),
    ("--leaf-minimap-blockquote", "var(--fgColor-accent)"),
    // Orange, so code stays distinct from the purple headings and green lists.
    ("--leaf-minimap-code", "var(--fgColor-severe)"),
    ("--leaf-navigation-border", "var(--borderColor-default)"),
    (
        "--leaf-navigation-button-background",
        "var(--button-primary-bgColor-rest)",
    ),
    (
        "--leaf-navigation-button-foreground",
        "var(--button-primary-fgColor-rest)",
    ),
    (
        "--leaf-navigation-button-hover-background",
        "var(--button-primary-bgColor-hover)",
    ),
    (
        "--leaf-navigation-button-disabled-background",
        "var(--control-bgColor-disabled)",
    ),
    (
        "--leaf-navigation-button-disabled-foreground",
        "var(--control-fgColor-disabled)",
    ),
    (
        "--leaf-navigation-recent-border",
        "var(--borderColor-default)",
    ),
    (
        "--leaf-navigation-recent-item-foreground",
        "var(--fgColor-default)",
    ),
    (
        "--leaf-navigation-recent-item-hover-foreground",
        "var(--button-primary-bgColor-rest)",
    ),
    ("--leaf-focus-ring", "var(--focus-outlineColor)"),
    (
        "--leaf-focus-selection-background",
        "var(--selection-bgColor)",
    ),
    (
        "--leaf-focus-selection-foreground",
        "var(--fgColor-default)",
    ),
    ("--leaf-syntax-background", "var(--bgColor-muted)"),
    ("--leaf-syntax-foreground", "var(--fgColor-default)"),
    (
        "--leaf-syntax-comment",
        "var(--prettylights-syntax-comment)",
    ),
    (
        "--leaf-syntax-keyword",
        "var(--prettylights-syntax-keyword)",
    ),
    ("--leaf-syntax-string", "var(--prettylights-syntax-string)"),
    (
        "--leaf-syntax-number",
        "var(--prettylights-syntax-constant)",
    ),
    (
        "--leaf-syntax-function",
        "var(--prettylights-syntax-entity)",
    ),
    (
        "--leaf-syntax-variable",
        "var(--prettylights-syntax-variable)",
    ),
    ("--leaf-syntax-type", "var(--prettylights-syntax-entity)"),
    (
        "--leaf-syntax-operator",
        "var(--prettylights-syntax-keyword)",
    ),
    ("--leaf-syntax-punctuation", "var(--fgColor-muted)"),
    (
        "--leaf-syntax-inserted",
        "var(--prettylights-syntax-markup-inserted-text)",
    ),
    (
        "--leaf-syntax-inserted-background",
        "var(--prettylights-syntax-markup-inserted-bg)",
    ),
    (
        "--leaf-syntax-deleted",
        "var(--prettylights-syntax-markup-deleted-text)",
    ),
    (
        "--leaf-syntax-deleted-background",
        "var(--prettylights-syntax-markup-deleted-bg)",
    ),
    (
        "--leaf-syntax-changed",
        "var(--prettylights-syntax-markup-changed-text)",
    ),
    (
        "--leaf-syntax-changed-background",
        "var(--prettylights-syntax-markup-changed-bg)",
    ),
];

pub(crate) const DRACULA_THEME_TOKENS: &[(&str, &str)] = &[
    ("--leaf-app-background", "#282a36"),
    ("--leaf-app-foreground", "#f8f8f2"),
    ("--leaf-app-surface", "#282a36"),
    ("--leaf-app-surface-raised", "#343746"),
    ("--leaf-app-surface-elevated", "#343746"),
    ("--leaf-app-surface-muted", "#3d4050"),
    ("--leaf-app-surface-sunken", "#1e2029"),
    ("--leaf-app-surface-inset", "#1e2029"),
    ("--leaf-app-surface-card", "#343746"),
    ("--leaf-app-border", "#6272a4"),
    ("--leaf-app-border-strong", "#bdc6f4"),
    ("--leaf-app-muted-background", "#3d4050"),
    ("--leaf-app-muted-foreground", "#d6d6d0"),
    ("--leaf-app-primary", "#bd93f9"),
    ("--leaf-app-primary-foreground", "#1e2029"),
    ("--leaf-app-secondary", "#44475a"),
    ("--leaf-app-secondary-foreground", "#f8f8f2"),
    ("--leaf-app-accent", "#8be9fd"),
    ("--leaf-app-accent-foreground", "#1e2029"),
    ("--leaf-app-danger", "#ff8f8f"),
    ("--leaf-app-danger-foreground", "#1e2029"),
    ("--leaf-app-warning", "#f1fa8c"),
    ("--leaf-app-warning-foreground", "#1e2029"),
    ("--leaf-app-success", "#50fa7b"),
    ("--leaf-app-success-foreground", "#1e2029"),
    ("--leaf-app-done", "#bd93f9"),
    ("--leaf-app-done-foreground", "#1e2029"),
    ("--leaf-app-link", "#8be9fd"),
    ("--leaf-app-link-hover", "#f1fa8c"),
    ("--leaf-app-shadow", "0 18px 42px #00000066"),
    ("--leaf-editor-background", "#282a36"),
    ("--leaf-editor-foreground", "#f8f8f2"),
    ("--leaf-editor-selection-background", "#44475a"),
    ("--leaf-editor-selection-foreground", "#ffffff"),
    ("--leaf-editor-inline-code-background", "#1e2029"),
    ("--leaf-editor-inline-code-foreground", "#f8f8f2"),
    ("--leaf-editor-code-background", "#1e2029"),
    ("--leaf-editor-code-foreground", "#f8f8f2"),
    ("--leaf-editor-code-border", "#6272a4"),
    ("--leaf-editor-code-selection-background", "#44475a"),
    ("--leaf-editor-code-selection-foreground", "#ffffff"),
    ("--leaf-markdown-background", "#282a36"),
    ("--leaf-markdown-foreground", "#f8f8f2"),
    ("--leaf-markdown-heading", "#ffffff"),
    ("--leaf-markdown-muted-foreground", "#d6d6d0"),
    ("--leaf-markdown-border", "#6272a4"),
    ("--leaf-markdown-rule", "#6272a4"),
    ("--leaf-markdown-link", "#8be9fd"),
    ("--leaf-markdown-link-hover", "#f1fa8c"),
    ("--leaf-markdown-inline-code-background", "#1e2029"),
    ("--leaf-markdown-inline-code-foreground", "#f8f8f2"),
    ("--leaf-markdown-blockquote-background", "#343746"),
    ("--leaf-markdown-blockquote-border", "#8be9fd"),
    ("--leaf-markdown-blockquote-foreground", "#f8f8f2"),
    ("--leaf-markdown-alert-note", "#8be9fd"),
    ("--leaf-markdown-alert-tip", "#50fa7b"),
    ("--leaf-markdown-alert-important", "#bd93f9"),
    ("--leaf-markdown-alert-warning", "#f1fa8c"),
    ("--leaf-markdown-alert-caution", "#ff8f8f"),
    ("--leaf-markdown-alert-done", "#bd93f9"),
    ("--leaf-markdown-badge-background", "#44475a"),
    ("--leaf-markdown-badge-foreground", "#f8f8f2"),
    ("--leaf-markdown-table-border", "#6272a4"),
    ("--leaf-markdown-table-header-background", "#343746"),
    ("--leaf-markdown-thematic-break", "#6272a4"),
    ("--leaf-markdown-math-inline-background", "#44475a"),
    ("--leaf-markdown-keyboard-background", "#343746"),
    ("--leaf-markdown-keyboard-border", "#6272a4"),
    ("--leaf-minimap-background", "#343746"),
    ("--leaf-minimap-border", "#6272a4"),
    ("--leaf-minimap-viewport-border", "#8be9fd"),
    (
        "--leaf-minimap-viewport-background",
        "rgba(110, 118, 129, 0.14)",
    ),
    ("--leaf-minimap-heading", "#bd93f9"),
    ("--leaf-minimap-paragraph", "#d6d6d0"),
    ("--leaf-minimap-blank", "#6272a4"),
    ("--leaf-minimap-list", "#50fa7b"),
    ("--leaf-minimap-blockquote", "#8be9fd"),
    ("--leaf-minimap-code", "#ff79c6"),
    ("--leaf-navigation-border", "#6272a4"),
    ("--leaf-navigation-button-background", "#bd93f9"),
    ("--leaf-navigation-button-foreground", "#1e2029"),
    ("--leaf-navigation-button-hover-background", "#d7baff"),
    ("--leaf-navigation-button-disabled-background", "#343746"),
    ("--leaf-navigation-button-disabled-foreground", "#a8adcf"),
    ("--leaf-navigation-recent-border", "#6272a4"),
    ("--leaf-navigation-recent-item-foreground", "#f8f8f2"),
    ("--leaf-navigation-recent-item-hover-foreground", "#8be9fd"),
    ("--leaf-focus-ring", "#f1fa8c"),
    ("--leaf-focus-selection-background", "#44475a"),
    ("--leaf-focus-selection-foreground", "#ffffff"),
    ("--leaf-syntax-background", "#1e2029"),
    ("--leaf-syntax-foreground", "#f8f8f2"),
    ("--leaf-syntax-comment", "#d6d6d0"),
    ("--leaf-syntax-keyword", "#ff79c6"),
    ("--leaf-syntax-string", "#f1fa8c"),
    ("--leaf-syntax-number", "#bd93f9"),
    ("--leaf-syntax-function", "#50fa7b"),
    ("--leaf-syntax-variable", "#f8f8f2"),
    ("--leaf-syntax-type", "#8be9fd"),
    ("--leaf-syntax-operator", "#ff79c6"),
    ("--leaf-syntax-punctuation", "#f8f8f2"),
    ("--leaf-syntax-inserted", "#50fa7b"),
    ("--leaf-syntax-inserted-background", "#1e3928"),
    ("--leaf-syntax-deleted", "#ff8f8f"),
    ("--leaf-syntax-deleted-background", "#4a252f"),
    ("--leaf-syntax-changed", "#f1fa8c"),
    ("--leaf-syntax-changed-background", "#3e3f27"),
];

// Primer Dark's neutral grey borders read as flat grey against the near-black
// page, so shift the border family to a desaturated slate blue at the same
// lightness for a cooler frame. Light and Dracula keep their own borders.
pub(crate) const PRIMER_DARK_BORDER_OVERRIDES: &[(&str, &str)] = &[
    ("--leaf-app-border", "#39435f"),
    ("--leaf-app-border-strong", "#5b6788"),
    ("--leaf-editor-code-border", "#39435f"),
    ("--leaf-markdown-border", "#39435f"),
    ("--leaf-markdown-rule", "#39435fb3"),
    ("--leaf-markdown-blockquote-border", "#39435f"),
    ("--leaf-markdown-table-border", "#39435f"),
    ("--leaf-markdown-thematic-break", "#39435fb3"),
    ("--leaf-markdown-keyboard-border", "#39435f"),
    ("--leaf-minimap-border", "#39435f"),
    ("--leaf-minimap-blank", "#39435f"),
    ("--leaf-navigation-border", "#39435f"),
    ("--leaf-navigation-recent-border", "#39435f"),
];

pub(crate) fn theme_sources() -> &'static [ThemeSource] {
    &[
        ThemeSource {
            id: "primer-light",
            display_name: "Primer Light",
            selector: PRIMER_LIGHT_SELECTOR,
            kind: ThemeSourceKind::Primer,
            selectable: true,
            tokens: PRIMER_THEME_TOKENS,
            overrides: &[],
        },
        ThemeSource {
            id: "primer-dark",
            display_name: "Primer Dark",
            selector: PRIMER_DARK_SELECTOR,
            kind: ThemeSourceKind::Primer,
            selectable: true,
            tokens: PRIMER_THEME_TOKENS,
            overrides: PRIMER_DARK_BORDER_OVERRIDES,
        },
        ThemeSource {
            id: "dracula",
            display_name: "Dracula",
            selector: ":root[data-leaf-theme-source=\"dracula\"]",
            kind: ThemeSourceKind::Dracula,
            selectable: true,
            tokens: DRACULA_THEME_TOKENS,
            overrides: &[],
        },
    ]
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
            !source.display_name.trim().is_empty(),
            "theme source {} must have a display name",
            source.id
        );
        // Dracula-kind palettes ship a full token set and activate through their
        // own source attribute, not the Primer color-mode selectors.
        if source.kind == ThemeSourceKind::Dracula {
            assert!(
                source.selector.contains("data-leaf-theme-source"),
                "Dracula-kind source {} must use its dedicated token-source selector",
                source.id
            );
        }
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

    // The theme picker needs at least a light and a dark option to function.
    assert!(
        sources.iter().filter(|source| source.selectable).count() >= 2,
        "expected at least two selectable theme sources for the picker"
    );
}

pub(crate) fn theme_source_token_value(source: &ThemeSource, token: &str) -> Option<&'static str> {
    source
        .overrides
        .iter()
        .chain(source.tokens.iter())
        .find_map(|(name, value)| (*name == token).then_some(*value))
}

pub(crate) fn reading_mode_css() -> &'static str {
    static READING_MODE_CSS: OnceLock<String> = OnceLock::new();

    READING_MODE_CSS.get_or_init(|| {
        let mut css = String::new();
        css.push_str(
            concat!(
        include_str!("assets/noto-fonts.css"),
        include_str!("assets/primer-primitives-11.9.0-light.css"),
        include_str!("assets/primer-primitives-11.9.0-dark.css"),
            ),
        );
        css.push_str(&compiled_theme_css());
        css.push_str(
            r#"
:root {
  color-scheme: light dark;
  --surface-page: var(--leaf-markdown-background);
  --surface-raised: var(--leaf-app-surface-raised);
  --surface-card: var(--leaf-app-surface-card);
  --surface-inset: var(--leaf-app-surface-inset);
  --background: var(--leaf-app-background);
  --foreground: var(--leaf-app-foreground);
  --surface: var(--leaf-app-surface);
  --surface-elevated: var(--leaf-app-surface-elevated);
  --surface-muted: var(--leaf-app-surface-muted);
  --surface-sunken: var(--leaf-app-surface-sunken);
  --border: var(--leaf-app-border);
  --border-strong: var(--leaf-app-border-strong);
  --muted: var(--leaf-app-muted-background);
  --muted-foreground: var(--leaf-app-muted-foreground);
  --primary: var(--leaf-app-primary);
  --primary-foreground: var(--leaf-app-primary-foreground);
  --secondary: var(--leaf-app-secondary);
  --secondary-foreground: var(--leaf-app-secondary-foreground);
  --accent: var(--leaf-app-accent);
  --accent-foreground: var(--leaf-app-accent-foreground);
  --danger: var(--leaf-app-danger);
  --danger-foreground: var(--leaf-app-danger-foreground);
  --warning: var(--leaf-app-warning);
  --warning-foreground: var(--leaf-app-warning-foreground);
  --success: var(--leaf-app-success);
  --success-foreground: var(--leaf-app-success-foreground);
  --done: var(--leaf-app-done);
  --done-foreground: var(--leaf-app-done-foreground);
  --link: var(--leaf-app-link);
  --link-hover: var(--leaf-app-link-hover);
  --selection: var(--leaf-focus-selection-background);
  --focus-ring: var(--leaf-focus-ring);
  --shadow: var(--leaf-app-shadow);
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
  --library-surface: var(--app-surface);
  --library-pane-edge-shadow: inset -7px 0 8px -8px color-mix(in srgb, black 40%, transparent);
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
:root[data-locale="zh-CN"] {
  --reading-font: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
}
.app-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  height: 56px;
  padding: 0 22px;
  background: linear-gradient(to bottom, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 85%, transparent) 100%);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: var(--app-font);
}
.app-bar::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 40px;
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
}
.app-bar::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 64px;
  pointer-events: none;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 65%);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 65%);
}
.brand {
  width: 28px;
  height: 28px;
  display: block;
  flex-shrink: 0;
}
.brand-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 8px;
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
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
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
  border-radius: 7px;
  background: color-mix(in srgb, var(--app-surface-elevated) 70%, black);
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
  background: var(--app-background);
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
  padding: 5px 6px;
  text-align: left;
  /* Long names fade out at the right edge instead of showing an ellipsis. */
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
}
.tab-active .tab-label {
  color: #fff;
  max-width: none;
  -webkit-mask-image: none;
  mask-image: none;
}
.tab-label:hover {
  background: transparent;
  border-color: transparent;
}
.tab-close {
  display: none;
  place-items: center;
  width: 20px;
  height: 20px;
  min-width: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--app-muted-foreground);
}
.tab-active .tab-close {
  display: inline-grid;
}
.tab-close svg {
  width: 12px;
  height: 12px;
  pointer-events: none;
}
.tab-close:hover {
  background: var(--app-action-hover-background);
  border-color: transparent;
  color: var(--app-foreground);
}
.history-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.app-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.context-menu {
  position: fixed;
  z-index: 50;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--app-border);
  border-radius: 8px;
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
  border-radius: 5px;
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
  border-radius: 8px;
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
  border-radius: 5px;
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
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  /* No resting fill; icon dimmed at rest, greens on hover like the other icons. */
  background: transparent;
  color: var(--app-muted-foreground);
  cursor: pointer;
  font: 700 13px var(--app-font);
  list-style: none;
  padding: 0;
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
.settings-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  display: grid;
  gap: 14px;
  width: min(290px, calc(100vw - 28px));
  border: 1px solid var(--app-border);
  border-radius: 8px;
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
  border-radius: 6px;
  background: var(--settings-control-background);
  color: var(--settings-control-foreground);
  font: 600 13px var(--app-font);
  padding: 7px 28px 7px 9px;
}
button {
  border: 1px solid var(--app-action-background);
  border-radius: 6px;
  background: var(--app-action-background);
  color: var(--app-action-foreground);
  cursor: pointer;
  font: 600 14px var(--app-font);
  padding: 8px 14px;
}
.icon-button {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  padding: 0;
}
.icon-button svg {
  width: 18px;
  height: 18px;
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
  border-radius: 6px;
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
  border-radius: 50%;
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
  /* Positioning context for the overlays it stacks (.library-scroll and
     .library-header). The pane itself doesn't scroll or clip; the inner
     .library-scroll owns the scroll, and leaving it unclipped lets the view
     dropdown open past its edge. */
  --library-app-bar: 56px;
  --library-header-height: 40px;
  position: relative;
  height: 100vh;
  background: var(--library-surface);
  color: var(--preview-foreground);
  font-family: var(--app-font);
  font-size: 13px;
  box-shadow: var(--library-pane-edge-shadow);
}
:root[data-theme="dark"]:not([data-leaf-theme-source="dracula"]) {
  --library-surface: color-mix(in srgb, var(--app-surface) 98%, black);
  --library-pane-edge-shadow: inset -7px 0 8px -8px color-mix(in srgb, black 55%, transparent);
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
.library-shell.library-closed .library-divider {
  display: none;
}
.library-open {
  display: none;
}
.library-shell.library-closed .library-header {
  /* Hide the header when snapped shut, or the unclipped pane would bleed it past
     the 0px column and show it behind the open button. */
  display: none;
}
.library-shell.library-closed .library-open {
  /* Pinned to the left edge below the app bar; left: 22px matches the app bar's
     padding so it lines up under the leaf logo. */
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: var(--library-open-top, 64px);
  left: 22px;
  z-index: 5;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--app-surface-elevated);
  color: var(--app-muted-foreground);
  cursor: pointer;
}
/* Scope hover/active to the collapsed selector so they outrank the collapsed
   display rule above, matching the settings button. */
.library-shell.library-closed .library-open:hover {
  background: var(--app-action-hover-background);
  color: var(--app-action-foreground);
}
.library-shell.library-closed .library-open:active {
  background: var(--app-action-background);
  color: var(--app-action-foreground);
}
.library-open svg {
  width: 18px;
  height: 18px;
}
/* While dragging the divider, lock the cursor and kill text selection window-wide. */
body.library-resizing {
  cursor: col-resize;
  user-select: none;
  -webkit-user-select: none;
}
.library-scroll {
  /* Scroll container filling the pane. Top padding clears the app bar and the
     header, so the list starts below both but scrolls up under their blur.
     NOTE: no `scrollbar-width`/`scrollbar-color` — in Chromium either standard
     property silently disables all `::-webkit-scrollbar` pseudo-elements. */
  position: absolute;
  inset: 0;
  overflow: auto;
  box-sizing: border-box;
  padding-top: calc(var(--library-app-bar) + var(--library-header-height));
}
.library-scroll::-webkit-scrollbar {
  width: 10px;
}
.library-scroll::-webkit-scrollbar-track {
  background: var(--library-surface);
  /* Keep the bar clear of the app bar AND the header that sits under it. */
  margin-top: calc(var(--library-app-bar) + var(--library-header-height));
}
.library-scroll::-webkit-scrollbar-thumb {
  border-radius: 6px;
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
  top: calc(var(--library-app-bar) + var(--library-header-height));
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
  border-radius: 6px;
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
  border-radius: 2px;
}
/* The search field fills the rest of the pinned header, beside the view chip. */
.library-search {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  box-sizing: border-box;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--app-muted-foreground) 25%, transparent);
  background: var(--library-surface);
  color: inherit;
  font-family: inherit;
  font-size: 12px;
}
.library-search:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--app-action-background, #2f81f7) 60%, transparent);
}
.library-header {
  /* Pinned below the app bar — absolute against the pane, not sticky, so it
     never drifts with the list, which slides up under its blur. */
  position: absolute;
  top: var(--library-app-bar);
  left: 0;
  right: 0;
  z-index: 2;
  box-sizing: border-box;
  height: var(--library-header-height);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 12px;
  font-weight: 600;
  /* Continues the app bar's fade: it ends at 85% surface, so this picks up at
     85% and fades to 75%, reading as one continuous ramp. */
  background: linear-gradient(to bottom, color-mix(in srgb, var(--library-surface) 85%, transparent) 0%, color-mix(in srgb, var(--library-surface) 75%, transparent) 100%);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.library-header::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 40px;
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%);
}
.library-header::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 64px;
  pointer-events: none;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  mask-image: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 65%);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 65%);
}
.library-view-select {
  position: relative;
  /* The view switcher keeps its size; only the search field beside it shrinks. */
  flex: 0 0 auto;
}
.library-search-scope {
  /* Sits at the end of the header next to the search field, keeping its size. */
  flex: 0 0 auto;
}
.library-search-scope[aria-pressed="true"] {
  /* Focus mode on: tint the chip with the accent so the narrowed scope is
     obvious at a glance. */
  background: color-mix(in srgb, var(--app-action-background, #2f81f7) 32%, transparent);
  color: var(--app-foreground);
}
.library-search-scope[aria-pressed="true"]:hover {
  background: color-mix(in srgb, var(--app-action-background, #2f81f7) 42%, transparent);
}
.library-header button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  /* All-caps monospace so the active view reads as a compact code-style tag. */
  font-family: var(--code-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px 3px 10px;
  border-radius: 6px;
  border: 0;
  /* A filled chip, same fill in every view state. A translucent neutral reads
     as "a little lighter" and stays visible in light themes too. */
  background: color-mix(in srgb, var(--app-muted-foreground) 14%, transparent);
  color: inherit;
  cursor: pointer;
}
.library-header button:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 22%, transparent);
}
.library-view-caret {
  color: var(--app-muted-foreground);
  font-size: 10px;
  line-height: 1;
}
.library-view-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 100%;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 6px;
  background: var(--library-surface);
  box-shadow: 0 6px 18px -6px color-mix(in srgb, black 55%, transparent),
    0 0 0 1px color-mix(in srgb, var(--app-muted-foreground) 20%, transparent);
}
.library-view-menu[hidden] {
  display: none;
}
.library-view-option {
  padding: 4px 10px;
  border-radius: 4px;
  font-family: var(--code-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}
.library-view-option:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 14%, transparent);
}
.library-view-option[aria-selected="true"] {
  background: color-mix(in srgb, var(--app-muted-foreground) 22%, transparent);
}
.library-folder > summary {
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  /* Long names fade out at the right edge instead of showing an ellipsis,
     matching the tab labels. */
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
}
/* Shrink and dim the native disclosure triangle, which is oversized and bright
   next to 13px folder names. (-webkit- form is the legacy fallback.) */
.library-folder > summary::marker,
.library-folder > summary::-webkit-details-marker {
  font-size: 0.65em;
  color: var(--app-muted-foreground);
}
.library-folder > summary:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 12%, transparent);
}
.library-children {
  padding-left: 2px;
}
.library-file,
.library-nav-folder,
.library-nav-up {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.library-file:hover,
.library-nav-folder:hover,
.library-nav-up:hover {
  background: color-mix(in srgb, var(--app-muted-foreground) 12%, transparent);
}
/* The currently-open file: accent-tinted, outranking hover so it holds while
   pointing elsewhere. */
.library-file.is-selected,
.library-file.is-selected:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.library-file-icon {
  flex: none;
  width: 14px;
  height: 14px;
  object-fit: contain;
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
/* Folders in Project view: name left, a muted chevron pinned to the right edge
   marking the row as something you can drill into. */
.library-nav-chevron {
  margin-left: auto;
  padding-left: 8px;
  color: var(--app-muted-foreground);
}
.library-nav-up {
  color: var(--app-muted-foreground);
}
.library-nav-arrow {
  flex: none;
}
.library-flat,
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
  height: 100vh;
  overflow: auto;
  padding-top: 56px;
  position: relative;
  scroll-padding-top: 56px;
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
  padding-top: 56px;
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
  border-radius: 50%;
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
  border-radius: 8px;
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
  margin-top: 56px;
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
  border-radius: 8px;
  color: var(--preview-foreground);
}
.docs-pager-skeleton {
  flex: 1 1 0;
  min-width: 0;
  padding: 12px 16px;
  border: 1px solid var(--reading-rule);
  border-radius: 8px;
}
.docs-pager-label-skeleton,
.docs-pager-title-skeleton {
  display: block;
  border-radius: 999px;
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
  border-bottom: 1px solid var(--preview-rule);
  font-size: var(--type-h2-size);
  font-weight: var(--type-h2-weight);
  line-height: var(--type-h2-line);
  padding-bottom: 0.3em;
}
.document-body h3 {
  font-size: var(--type-h3-size);
  font-weight: var(--type-h3-weight);
  line-height: var(--type-h3-line);
}
.document-body h4 {
  font-size: var(--type-h4-size);
  font-weight: var(--type-h4-weight);
  line-height: var(--type-h4-line);
}
.document-body h5 {
  font-size: var(--type-h5-size);
  font-weight: var(--type-h5-weight);
  line-height: var(--type-h4-line);
}
.document-body h6 {
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
.document-body strong {
  font-weight: 600;
}
/* Outline: a collapsed <details> built from the headings, dropped in under the
   title (see buildDocumentOutline). Closed by default. */
.document-body .document-outline {
  margin: 1.5em 0;
  border: 1px solid var(--preview-border);
  border-radius: 6px;
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
  border-radius: 6px;
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
  border-radius: 999px;
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
  border-radius: 3px;
}
.document-body .leaf-editing-source {
  font-family: var(--leaf-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  white-space: pre-wrap;
  background: var(--markdown-code-background, rgba(127, 127, 127, 0.12));
  border-radius: 4px;
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
  border-radius: 6px;
  color: var(--markdown-inline-code-foreground);
  font-family: var(--code-font);
  font-size: 0.875em;
  padding: 0.2em 0.4em;
}
.document-body pre {
  position: relative;
  background: var(--code-block-background);
  background-clip: padding-box;
  border-radius: 6px;
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
  border-radius: 6px;
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
  /* Larger top padding so the first lines start below the floating library-open
     button (viewport top 64px, 32px tall) rather than under it. Content still
     scrolls up beneath the button; it just doesn't begin there. */
  --cv-pad-top: 48px;
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
  min-height: calc(100vh - 56px);
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
  border-radius: 4px;
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
  border-radius: 4px;
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
  border-top-left-radius: 14px;
  border-top-right-radius: 14px;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
  transform: translateY(100%);
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
}
.glossary-sheet.open {
  transform: translateY(0);
}
.link-hover-tip {
  position: fixed;
  z-index: 60;
  max-width: min(34rem, calc(100vw - 24px));
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: color-mix(in srgb, var(--background) 92%, black);
  color: var(--foreground);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
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
  border-radius: 2px;
  background: var(--border-strong);
}
.glossary-sheet-close {
  position: absolute;
  top: 8px;
  right: 12px;
  display: flex;
  padding: 6px;
  border: 0;
  border-radius: 6px;
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
  .glossary-sheet {
    left: 50%;
    right: auto;
    width: min(680px, 92vw);
    transform: translateX(-50%) translateY(100%);
  }
  .glossary-sheet.open {
    transform: translateX(-50%) translateY(0);
  }
}
"#
        );
        css
    })
}
